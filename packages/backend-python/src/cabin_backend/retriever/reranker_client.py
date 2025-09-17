"""HTTP client for the reranker sidecar with heuristic fallback."""

from __future__ import annotations

import logging
import os
from typing import Dict, List, Tuple
from urllib.parse import urlsplit, urlunsplit

import requests

from ..config import settings

logger = logging.getLogger(__name__)


class RerankerClient:
    """Best-effort reranker caller with environment-aware fallbacks."""

    def __init__(self) -> None:
        self.top_n = settings.app_config.reranker.top_n
        self.timeout = settings.app_config.reranker.timeout_s
        self._candidate_urls = self._build_url_candidates()

    def rerank(self, query: str, candidates: Dict[str, str]) -> List[Tuple[str, float]]:
        if not candidates:
            logger.info("Reranker skipped: no candidates for query '%s'", query)
            return []

        payload = {
            "query": query,
            "candidates": [{"id": cid, "text": text} for cid, text in candidates.items()],
            "top_n": self.top_n,
        }

        last_error: Exception | None = None
        for index, url in enumerate(self._candidate_urls, start=1):
            try:
                response = requests.post(url, json=payload, timeout=self.timeout)
                response.raise_for_status()
                data = response.json()
                results = [(item["id"], float(item["score"])) for item in data.get("results", [])]
                logger.info(
                    "Reranker success via %s (attempt %d/%d): %d results",
                    url,
                    index,
                    len(self._candidate_urls),
                    len(results),
                )
                return results
            except Exception as exc:  # pragma: no cover - network path
                last_error = exc
                logger.debug("Reranker attempt %d failed for %s: %s", index, url, exc)

        if last_error is not None:
            logger.warning("Reranker sidecar unavailable (%s); using heuristic fallback", last_error)
        fallback = self._heuristic_fallback(query, candidates)
        logger.info(
            "Reranker heuristic fallback returning %d results for query '%s'",
            len(fallback),
            query,
        )
        return fallback

    def _build_url_candidates(self) -> List[str]:
        """Build an ordered list of URLs to attempt for reranking."""

        candidates: List[str] = []

        # Environment overrides take precedence.
        env_override = os.getenv("RERANKER_URL") or os.getenv("CABIN_RERANKER_URL")
        if env_override:
            candidates.append(env_override.rstrip("/"))

        configured = settings.app_config.reranker.url.rstrip("/")
        if configured and configured not in candidates:
            candidates.append(configured)

        # Automatic localhost fallback when the hostname is the default docker-style alias.
        fallback_host = os.getenv("RERANKER_FALLBACK_HOST", "localhost")
        for url in list(candidates):
            swapped = self._swap_host(url, fallback_host)
            if swapped and swapped not in candidates:
                candidates.append(swapped)

        return candidates or ["http://localhost:8000/rerank"]

    @staticmethod
    def _swap_host(url: str, host: str) -> str | None:
        try:
            parts = urlsplit(url)
        except Exception:  # pragma: no cover - invalid URL
            return None

        if not parts.scheme or not parts.netloc:
            return None

        if parts.hostname != "reranker":
            return None

        port_fragment = f":{parts.port}" if parts.port else ""
        netloc = f"{host}{port_fragment}"
        swapped = urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
        return swapped.rstrip("/")

    @staticmethod
    def _heuristic_fallback(query: str, candidates: Dict[str, str]) -> List[Tuple[str, float]]:
        query_terms = set(query.lower().split())
        scored: List[Tuple[str, float]] = []
        for cid, text in candidates.items():
            overlap = query_terms.intersection(text.lower().split())
            score = len(overlap) / max(len(query_terms), 1)
            scored.append((cid, score))
        return sorted(scored, key=lambda item: item[1], reverse=True)
