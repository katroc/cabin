"""Chunk-level deduplication helpers using Jaccard similarity."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from ..models import ChildChunk
from ..telemetry.metrics import metrics


@dataclass
class DeduplicationResult:
    kept: List[ChildChunk]
    dropped: List[Tuple[ChildChunk, ChildChunk, float]]  # (dropped, kept, score)


class Deduplicator:
    """Detects near-duplicate chunks via shingled Jaccard similarity."""

    def __init__(self, *, threshold: float = 0.92, shingle_size: int = 5) -> None:
        self.threshold = threshold
        self.shingle_size = max(1, shingle_size)

    def deduplicate(self, chunks: Sequence[ChildChunk]) -> DeduplicationResult:
        kept: List[ChildChunk] = []
        dropped: List[Tuple[ChildChunk, ChildChunk, float]] = []
        signatures: Dict[str, set[str]] = {}

        for chunk in chunks:
            shingles = self._shingle(chunk.text)
            best_match: Optional[Tuple[ChildChunk, float]] = None

            for existing in kept:
                existing_shingles = signatures.get(existing.id)
                if existing_shingles is None:
                    existing_shingles = self._shingle(existing.text)
                    signatures[existing.id] = existing_shingles

                score = self._jaccard(shingles, existing_shingles)
                if score >= self.threshold:
                    if not best_match or score > best_match[1]:
                        best_match = (existing, score)

            if best_match:
                preferred = self._prefer_newer_chunk(best_match[0], chunk)
                if preferred is chunk:
                    kept.remove(best_match[0])
                    kept.append(chunk)
                    signatures[chunk.id] = shingles
                    dropped.append((best_match[0], chunk, best_match[1]))
                else:
                    dropped.append((chunk, best_match[0], best_match[1]))
            else:
                kept.append(chunk)
                signatures[chunk.id] = shingles

        if dropped:
            metrics.increment("ingest.dedup.dropped", value=len(dropped))
        metrics.increment("ingest.dedup.kept", value=len(kept))
        return DeduplicationResult(kept=kept, dropped=dropped)
        

    def _shingle(self, text: str) -> set[str]:
        normalized = " ".join(text.split()).lower()
        if len(normalized) <= self.shingle_size:
            return {normalized}
        return {
            normalized[i : i + self.shingle_size]
            for i in range(len(normalized) - self.shingle_size + 1)
        }

    @staticmethod
    def _jaccard(a: Iterable[str], b: Iterable[str]) -> float:
        set_a = set(a)
        set_b = set(b)
        if not set_a and not set_b:
            return 1.0
        if not set_a or not set_b:
            return 0.0
        intersection = len(set_a & set_b)
        union = len(set_a | set_b)
        return intersection / union if union else 0.0

    @staticmethod
    def _prefer_newer_chunk(existing: ChildChunk, candidate: ChildChunk) -> ChildChunk:
        existing_time = Deduplicator._parse_datetime(existing.metadata.updated_at)
        candidate_time = Deduplicator._parse_datetime(candidate.metadata.updated_at)
        if candidate_time and existing_time:
            return candidate if candidate_time >= existing_time else existing
        return candidate

    @staticmethod
    def _parse_datetime(value: Optional[str | datetime]) -> Optional[datetime]:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str) and value:
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None
        return None
