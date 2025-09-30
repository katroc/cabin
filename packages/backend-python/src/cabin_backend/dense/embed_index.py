"""Embedding client utilities for LM Studio / OpenAI-compatible endpoints."""

from __future__ import annotations

import asyncio
import logging
import math
import time
from collections import OrderedDict
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import openai

from ..telemetry.metrics import metrics


logger = logging.getLogger(__name__)


class EmbeddingClient:
    """Batched embedding helper with optional L2 normalisation."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        dimensions: int,
        batch_size: int = 16,
        l2_normalize: bool = True,
        cache_enabled: bool = False,
        cache_max_items: int = 0,
        cache_ttl_seconds: int = 600,
    ) -> None:
        self._client = openai.OpenAI(api_key=api_key, base_url=base_url)
        self._async_client = openai.AsyncOpenAI(api_key=api_key, base_url=base_url)
        self._model = model
        self._dimensions = dimensions
        self._batch_size = max(1, batch_size)
        self._l2_normalize = l2_normalize
        self._cache_enabled = cache_enabled and cache_max_items > 0
        self._cache_max_items = max(1, cache_max_items) if cache_max_items else 0
        self._cache_ttl = max(0, cache_ttl_seconds)
        self._cache: "OrderedDict[str, Tuple[List[float], float]]" = OrderedDict()

    def embed(self, texts: Sequence[str]) -> List[List[float]]:
        if not texts:
            return []

        results: Dict[int, List[float]] = {}
        to_fetch: List[Tuple[int, str]] = []

        if self._cache_enabled:
            now = time.time()
            for index, text in enumerate(texts):
                cached = self._cache_get(text, now)
                if cached is not None:
                    results[index] = cached
                else:
                    to_fetch.append((index, text))
        else:
            to_fetch = list(enumerate(texts))

        if to_fetch:
            fetch_texts = [text for _, text in to_fetch]
            fetched_embeddings = self._fetch_embeddings(fetch_texts)
            for (index, text), vector in zip(to_fetch, fetched_embeddings):
                results[index] = vector
                if self._cache_enabled:
                    self._cache_set(text, vector)

        ordered = [results[idx] for idx in range(len(texts))]
        if self._cache_enabled:
            hits = len(texts) - len(to_fetch)
            misses = len(to_fetch)
            metrics.increment("embedding.cache.hits", hits)
            metrics.increment("embedding.cache.misses", misses)
        return ordered

    async def embed_async(self, texts: Sequence[str]) -> List[List[float]]:
        """Async version of embed for concurrent operations."""
        if not texts:
            return []

        results: Dict[int, List[float]] = {}
        to_fetch: List[Tuple[int, str]] = []

        if self._cache_enabled:
            now = time.time()
            for index, text in enumerate(texts):
                cached = self._cache_get(text, now)
                if cached is not None:
                    results[index] = cached
                else:
                    to_fetch.append((index, text))
        else:
            to_fetch = list(enumerate(texts))

        if to_fetch:
            fetch_texts = [text for _, text in to_fetch]
            fetched_embeddings = await self._fetch_embeddings_async(fetch_texts)
            for (index, text), vector in zip(to_fetch, fetched_embeddings):
                results[index] = vector
                if self._cache_enabled:
                    self._cache_set(text, vector)

        ordered = [results[idx] for idx in range(len(texts))]
        if self._cache_enabled:
            hits = len(texts) - len(to_fetch)
            misses = len(to_fetch)
            metrics.increment("embedding.cache.hits", hits)
            metrics.increment("embedding.cache.misses", misses)
        return ordered

    def health_check(self) -> bool:
        try:
            self.embed(["ping"])
            return True
        except Exception as exc:  # pragma: no cover - network path
            logger.error("Embedding health check failed: %s", exc)
            return False

    def _fetch_embeddings(self, texts: Sequence[str]) -> List[List[float]]:
        embeddings: List[List[float]] = []
        for batch in _batched(texts, self._batch_size):
            # Only include dimensions parameter if it's > 0 and model supports it
            # BGE-M3 and similar models have fixed dimensions and don't support this parameter
            embedding_args = {
                "input": list(batch),
                "model": self._model,
            }
            if self._dimensions > 0 and not self._model.startswith(("bge-", "text-embedding-bge")):
                embedding_args["dimensions"] = self._dimensions

            response = self._client.embeddings.create(**embedding_args)
            for item in response.data:
                vector = list(item.embedding)
                if self._l2_normalize:
                    vector = _l2_normalise(vector)
                embeddings.append(vector)
        return embeddings

    async def _fetch_embeddings_async(self, texts: Sequence[str]) -> List[List[float]]:
        """Async version of _fetch_embeddings for concurrent API calls."""
        embeddings: List[List[float]] = []
        for batch in _batched(texts, self._batch_size):
            embedding_args = {
                "input": list(batch),
                "model": self._model,
            }
            if self._dimensions > 0 and not self._model.startswith(("bge-", "text-embedding-bge")):
                embedding_args["dimensions"] = self._dimensions

            response = await self._async_client.embeddings.create(**embedding_args)
            for item in response.data:
                vector = list(item.embedding)
                if self._l2_normalize:
                    vector = _l2_normalise(vector)
                embeddings.append(vector)
        return embeddings

    def _cache_get(self, key: str, now: float) -> Optional[List[float]]:
        entry = self._cache.get(key)
        if not entry:
            return None
        vector, timestamp = entry
        if self._cache_ttl and now - timestamp > self._cache_ttl:
            del self._cache[key]
            return None
        # Move to end (recently used)
        self._cache.move_to_end(key)
        return list(vector)

    def _cache_set(self, key: str, vector: List[float]) -> None:
        if not self._cache_enabled:
            return
        if key in self._cache:
            self._cache.move_to_end(key)
        self._cache[key] = (list(vector), time.time())
        if len(self._cache) > self._cache_max_items:
            self._cache.popitem(last=False)


def _batched(iterable: Sequence[str], batch_size: int) -> Iterable[Sequence[str]]:
    for index in range(0, len(iterable), batch_size):
        yield iterable[index : index + batch_size]


def _l2_normalise(vector: List[float]) -> List[float]:
    norm = math.sqrt(sum(component * component for component in vector))
    if norm == 0:
        return vector
    return [component / norm for component in vector]
