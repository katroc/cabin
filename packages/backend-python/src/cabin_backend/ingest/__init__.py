"""Ingestion pipeline helpers."""

from .dedup import Deduplicator, DeduplicationResult

__all__ = ["Deduplicator", "DeduplicationResult"]
