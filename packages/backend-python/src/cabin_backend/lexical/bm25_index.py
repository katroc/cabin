"""Chunk-level BM25 indexer with stemming/stopwords and refresh logic."""

from __future__ import annotations

import logging
from typing import Iterable, List, Sequence

from rank_bm25 import BM25Okapi


logger = logging.getLogger(__name__)


class BM25Index:
    """Simple BM25 wrapper that handles incremental corpus updates."""

    def __init__(self, *, language_stopwords: Sequence[str] | None = None, min_token_length: int = 3) -> None:
        self._language_stopwords = set(language_stopwords or [])
        self._min_token_length = max(1, min_token_length)
        self._corpus_tokens: List[List[str]] = []
        self._bm25: BM25Okapi | None = None

    def build(self, corpus_tokens: Iterable[Iterable[str]]) -> None:
        self._corpus_tokens = [list(tokens) for tokens in corpus_tokens]
        self._bm25 = BM25Okapi(self._corpus_tokens)
        logger.debug("BM25 index built with %d documents", len(self._corpus_tokens))

    def update(self, corpus_tokens: Iterable[Iterable[str]]) -> None:
        # For now rebuild; future work could do incremental updates.
        self.build(corpus_tokens)

    def scores(self, query_tokens: Sequence[str]) -> List[float]:
        if not self._bm25 or not self._corpus_tokens:
            return [0.0] * len(self._corpus_tokens)
        if not query_tokens:
            return [0.0] * len(self._corpus_tokens)
        raw_scores = self._bm25.get_scores(list(query_tokens))
        if not len(raw_scores):
            return [0.0] * len(self._corpus_tokens)
        max_score = float(raw_scores.max())
        if max_score <= 0:
            return [0.0] * len(self._corpus_tokens)
        return [float(score) / max_score for score in raw_scores]

    @property
    def corpus_size(self) -> int:
        return len(self._corpus_tokens)
