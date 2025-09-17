"""Embedding client utilities for LM Studio / OpenAI-compatible endpoints."""

from __future__ import annotations

import logging
import math
from typing import Iterable, List, Sequence

import openai


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
    ) -> None:
        self._client = openai.OpenAI(api_key=api_key, base_url=base_url)
        self._model = model
        self._dimensions = dimensions
        self._batch_size = max(1, batch_size)
        self._l2_normalize = l2_normalize

    def embed(self, texts: Sequence[str]) -> List[List[float]]:
        if not texts:
            return []

        embeddings: List[List[float]] = []
        for batch in _batched(texts, self._batch_size):
            response = self._client.embeddings.create(
                input=list(batch),
                model=self._model,
                dimensions=self._dimensions,
            )
            for item in response.data:
                vector = list(item.embedding)
                if self._l2_normalize:
                    vector = _l2_normalise(vector)
                embeddings.append(vector)
        return embeddings

    def health_check(self) -> bool:
        try:
            self.embed(["ping"])
            return True
        except Exception as exc:  # pragma: no cover - network path
            logger.error("Embedding health check failed: %s", exc)
            return False


def _batched(iterable: Sequence[str], batch_size: int) -> Iterable[Sequence[str]]:
    for index in range(0, len(iterable), batch_size):
        yield iterable[index : index + batch_size]


def _l2_normalise(vector: List[float]) -> List[float]:
    norm = math.sqrt(sum(component * component for component in vector))
    if norm == 0:
        return vector
    return [component / norm for component in vector]
