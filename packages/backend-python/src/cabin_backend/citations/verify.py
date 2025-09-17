"""Utilities for verifying that quoted snippets match source chunks."""

from __future__ import annotations

from rapidfuzz import fuzz


class QuoteVerifier:
    """Validates that a quoted snippet appears in the original chunk text."""

    def __init__(self, *, threshold: int = 90) -> None:
        self.threshold = threshold

    def verify(self, quote: str, chunk_text: str) -> bool:
        snippet = quote.strip()
        if not snippet or not chunk_text:
            return False
        if snippet in chunk_text:
            return True
        score = fuzz.partial_ratio(snippet, chunk_text)
        return score >= self.threshold
