"""Placeholder RM3 query expansion module guarded by feature flag."""

from __future__ import annotations

from typing import Iterable, List


class RM3Expander:
    """Stub RM3 expander; to be implemented when FEATURE_RM3 is enabled."""

    def expand(self, query_tokens: List[str], top_documents: Iterable[List[str]]) -> List[str]:
        # Placeholder implementation; return original tokens.
        return query_tokens
