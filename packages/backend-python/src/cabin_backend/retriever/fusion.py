"""Fusion and diversification utilities for retrieval candidates."""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, Iterable, List, Sequence, Tuple


def reciprocal_rank_fusion(
    rankings: Sequence[Sequence[str]],
    *,
    k: int,
) -> Dict[str, float]:
    """Applies Reciprocal Rank Fusion to multiple ranked lists."""
    scores: Dict[str, float] = defaultdict(float)
    for ranked_list in rankings:
        for rank, item_id in enumerate(ranked_list, start=1):
            scores[item_id] += 1.0 / (k + rank)
    return scores


def max_marginal_relevance(
    *,
    candidates: List[Tuple[str, float]],
    similarity_matrix: Dict[Tuple[str, str], float],
    lambda_param: float,
    limit: int,
) -> List[str]:
    """Performs Max Marginal Relevance diversification over candidates."""
    if not candidates:
        return []

    selected: List[str] = []
    candidate_scores = {item_id: score for item_id, score in candidates}

    while len(selected) < limit and candidate_scores:
        next_item = None
        best_score = float("-inf")

        for item_id, relevance in candidate_scores.items():
            diversity = 0.0
            if selected:
                diversity = max(
                    similarity_matrix.get((item_id, prev), 0.0) for prev in selected
                )
            mmr_score = lambda_param * relevance - (1 - lambda_param) * diversity
            if mmr_score > best_score:
                best_score = mmr_score
                next_item = item_id

        if next_item is None:
            break

        selected.append(next_item)
        candidate_scores.pop(next_item)

    return selected
