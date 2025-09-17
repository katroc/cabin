"""Hygiene filters for retrieval candidates."""

from __future__ import annotations

from typing import Dict, Iterable, List


def filter_by_cosine_floor(
    scores: Dict[str, float],
    *,
    cosine_floor: float,
) -> Dict[str, float]:
    return {item_id: score for item_id, score in scores.items() if score >= cosine_floor}


def filter_by_keyword_overlap(
    *,
    candidates: Dict[str, Dict[str, int]],
    min_overlap: int,
    content_types_permissive: Iterable[str] = (),
) -> List[str]:
    selected: List[str] = []
    permissive = set(content_types_permissive)
    for item_id, meta in candidates.items():
        overlap = meta.get("keyword_overlap", 0)
        content_type = meta.get("content_type")
        if overlap >= min_overlap or (content_type and content_type in permissive):
            selected.append(item_id)
    return selected
