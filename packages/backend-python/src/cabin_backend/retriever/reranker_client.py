"""HTTP client for the external Docker reranker with heuristic fallback."""

from __future__ import annotations

import logging
import os
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlsplit, urlunsplit

import requests

from ..config import settings
from ..telemetry.metrics import metrics

logger = logging.getLogger(__name__)


class RerankerClient:
    """Best-effort reranker caller with environment-aware fallbacks."""

    def __init__(self, base_url: Optional[str] = None) -> None:
        self.top_n = settings.app_config.reranker.top_n
        self.timeout = settings.app_config.reranker.timeout_s
        self._explicit_url = base_url.rstrip("/") if base_url else None
        self._candidate_urls = self._build_url_candidates()
        api_key = settings.app_config.reranker.api_key or os.getenv("RERANKER_API_KEY")
        self._headers = {"X-API-Key": api_key} if api_key else None

    def rerank(
        self,
        query: str,
        candidates: Dict[str, str],
        *,
        allow_fallback: bool = True,
    ) -> List[Tuple[str, float]]:
        if not candidates:
            logger.info("Reranker skipped: no candidates for query '%s'", query)
            metrics.increment("retrieval.reranker.skipped")
            return []

        last_error: Exception | None = None
        for index, url in enumerate(self._candidate_urls, start=1):
            try:
                # Detect if this is a vLLM endpoint and adapt the payload accordingly
                if self._is_vllm_endpoint(url):
                    payload = self._build_vllm_payload(query, candidates)
                    resolved_url = self._resolve_vllm_url(url)
                    logger.debug("Sending vLLM reranker request to %s with payload keys: %s", resolved_url, list(payload.keys()))
                    logger.debug("Documents count: %d, query length: %d", len(payload.get('documents', [])), len(payload.get('query', '')))
                    response = requests.post(
                        resolved_url,
                        json=payload,
                        timeout=self.timeout,
                        headers=self._headers,
                    )
                    logger.debug("Reranker response status: %d", response.status_code)
                    if response.status_code != 200:
                        logger.error("Reranker error response: %s", response.text[:500])
                    response.raise_for_status()
                    data = response.json()
                    results = self._parse_vllm_response(data, candidates)
                else:
                    # Original format for custom reranker service
                    payload = {
                        "query": query,
                        "candidates": [{"id": cid, "text": text} for cid, text in candidates.items()],
                        "top_n": self.top_n,
                    }
                    response = requests.post(
                        url,
                        json=payload,
                        timeout=self.timeout,
                        headers=self._headers,
                    )
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
                metrics.increment("retrieval.reranker.success", len(results))
                return results
            except Exception as exc:  # pragma: no cover - network path
                last_error = exc
                logger.debug("Reranker attempt %d failed for %s: %s", index, url, exc)

        if last_error is not None:
            logger.warning("Reranker sidecar unavailable (%s); using heuristic fallback", last_error)
        if not allow_fallback:
            logger.info("Heuristic fallback disabled for reranker; returning empty results")
            metrics.increment("retrieval.reranker.disabled")
            return []
        fallback = self._heuristic_fallback(query, candidates)
        logger.info(
            "Reranker heuristic fallback returning %d results for query '%s'",
            len(fallback),
            query,
        )
        metrics.increment("retrieval.reranker.fallback", len(fallback))
        return fallback

    def _build_url_candidates(self) -> List[str]:
        """Build an ordered list of URLs to attempt for reranking."""

        candidates: List[str] = []

        if self._explicit_url:
            candidates.append(self._explicit_url)

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

        return candidates or ["http://localhost:8002/rerank"]

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

        # Force use port 8002 for vLLM reranker instead of original port
        port_fragment = ":8002"
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

    def _is_vllm_endpoint(self, url: str) -> bool:
        """Detect if this is a vLLM reranker endpoint."""
        # vLLM typically runs on ports 8000+ and has /rerank endpoint
        return "8002" in url or "vllm" in url.lower() or "external-vllm" in url

    def _resolve_vllm_url(self, url: str) -> str:
        """Resolve external-vllm hostname to localhost for actual API calls."""
        return url.replace("external-vllm", "localhost")

    def _build_vllm_payload(self, query: str, candidates: Dict[str, str]) -> Dict:
        """Build payload for vLLM reranker API."""
        # Truncate documents to prevent reranker errors with very long content
        # Reranker has 2048 token limit, use conservative char limit to stay under token limit
        # Assuming ~1.2 chars per token on average, use ~6000 chars to stay under 2048 tokens
        max_doc_length = 6000  # Conservative limit for 2048 token reranker models
        processed_docs = []

        for doc_text in candidates.values():
            # Clean problematic characters that might cause issues
            cleaned_text = doc_text.encode('utf-8', errors='ignore').decode('utf-8')

            if len(cleaned_text) > max_doc_length:
                # Truncate but try to end at a sentence boundary
                truncated = cleaned_text[:max_doc_length]
                last_period = truncated.rfind('.')
                if last_period > max_doc_length // 2:  # Only if we find a reasonable cutoff point
                    truncated = truncated[:last_period + 1]
                processed_docs.append(truncated)
                logger.debug("Truncated document from %d to %d chars for reranker", len(doc_text), len(truncated))
            else:
                processed_docs.append(cleaned_text)

        return {
            "model": settings.app_config.reranker.model,
            "query": query,
            "documents": processed_docs,
            "top_n": self.top_n,
        }

    def _parse_vllm_response(self, data: Dict, candidates: Dict[str, str]) -> List[Tuple[str, float]]:
        """Parse vLLM reranker response and map back to candidate IDs."""
        results = []
        candidate_list = list(candidates.items())

        for result in data.get("results", []):
            index = result.get("index", 0)
            score = result.get("relevance_score", 0.0)

            # Map index back to candidate ID
            if 0 <= index < len(candidate_list):
                candidate_id = candidate_list[index][0]
                results.append((candidate_id, float(score)))

        return results
