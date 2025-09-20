"""Simple, fast query router using BGE-M3 similarity to decide RAG vs conversational."""

import logging
from typing import Dict, List, Optional, Tuple
import requests
import numpy as np

logger = logging.getLogger(__name__)


class QueryRouter:
    """Decides whether a query needs RAG retrieval or can be handled conversationally."""

    _INTENT_LABEL_EXAMPLES: Dict[str, List[str]] = {
        "information": [
            "what is the deployment process?",
            "can you explain the procedure?",
            "tell me about the compliance requirements",
            "where can i find the installation guide?",
            "how do i configure the service?",
            "describe the system architecture",
            "give me the policy details",
        ],
        "analytics": [
            "do we have p95 latency results?",
            "show me the latest availability metrics",
            "what are our error budgets this week?",
            "can you pull the response time percentiles?",
            "give me the dashboard stats for uptime",
            "what is the p99 for api latency?",
            "summarize the observability metrics for checkout",
        ],
        "conversational": [
            "are you sure about that?",
            "is that correct?",
            "can you explain that again?",
            "what do you mean by that?",
            "tell me more about your previous answer",
            "elaborate on what you just said",
            "rephrase that response for me",
        ],
    }

    _RAG_INTENTS = {"information", "analytics"}
    _INTENT_MIN_SCORE = 0.45
    _INTENT_MIN_MARGIN = 0.12

    def __init__(self, bge_url: str = "http://localhost:8001", similarity_threshold: float = 0.4):
        self.bge_url = bge_url.rstrip('/')
        self.similarity_threshold = similarity_threshold
        self._intent_label_embeddings: Optional[Dict[str, np.ndarray]] = None

    def should_use_rag(
        self,
        query: str,
        conversation_context: Optional[List[Dict[str, str]]] = None,
        corpus_sample: Optional[List[str]] = None
    ) -> Tuple[bool, float, str]:
        """
        Determine if query should use RAG based on similarity to corpus.

        Args:
            query: User's query
            conversation_context: Previous conversation messages
            corpus_sample: Sample of documents to check similarity against

        Returns:
            Tuple of (should_use_rag, max_similarity, reasoning)
        """

        query_lower = query.lower().strip()

        try:
            # Enhance query with conversation context for better similarity matching
            enhanced_query = self._build_contextual_query(query, conversation_context)

            # Get embedding for the enhanced query
            query_embedding = self._get_embedding(enhanced_query)
            if query_embedding is None:
                return True, 0.0, "BGE embedding failed, defaulting to RAG"

            # If we have a corpus sample, check similarity
            if corpus_sample and len(corpus_sample) > 0:
                max_similarity = self._compute_max_similarity(query_embedding, corpus_sample)

                should_rag = max_similarity >= self.similarity_threshold
                reasoning = f"Max similarity: {max_similarity:.3f} vs threshold {self.similarity_threshold}"

                heuristic_signal = None

                if not should_rag:
                    intent_prediction = self._classify_intent(query)
                    if intent_prediction:
                        intent_label, intent_score, intent_margin = intent_prediction
                        reasoning += (
                            f"; intent '{intent_label}'"
                            f" (score={intent_score:.3f}, margin={intent_margin:.3f})"
                        )
                        if intent_label in self._RAG_INTENTS:
                            should_rag = True
                    else:
                        heuristic_signal = self._looks_like_information_request(query_lower)
                        if heuristic_signal:
                            should_rag = True
                            reasoning += f"; heuristic information request ('{heuristic_signal}')"

                logger.debug(
                    "Query router: '%s' -> RAG=%s (sim=%.3f)",
                    query[:50], should_rag, max_similarity
                )

                return should_rag, max_similarity, reasoning
            else:
                # No corpus sample available - rely on intent classification / heuristics
                return self._fallback_decision(query, conversation_context)

        except Exception as e:
            logger.error("Query routing failed: %s", e)
            return True, 0.0, f"Router error: {str(e)}, defaulting to RAG"

    def _build_contextual_query(
        self,
        query: str,
        conversation_context: Optional[List[Dict[str, str]]] = None
    ) -> str:
        """Build enhanced query with conversation context for better similarity matching."""
        if not conversation_context or len(conversation_context) < 2:
            return query

        # Look for recent conversation that might give context
        context_parts = [query]

        # Add the last user message if it's different from current query
        for msg in reversed(conversation_context):
            if msg.get('role') == 'user' and msg.get('content', '').strip() != query.strip():
                context_parts.append(f"Previous question: {msg.get('content', '')[:100]}")
                break

        return " ".join(context_parts)

    def _get_embedding(self, text: str) -> Optional[List[float]]:
        """Get embedding from BGE-M3 endpoint."""
        try:
            response = requests.post(
                f"{self.bge_url}/v1/embeddings",
                json={
                    "input": [text],
                    "model": "bge-m3"
                },
                timeout=5  # Fast timeout for routing
            )

            if response.status_code == 200:
                data = response.json()
                return data["data"][0]["embedding"]
            else:
                logger.warning("BGE embedding request failed: %s", response.status_code)
                return None

        except Exception as e:
            logger.warning("Error getting BGE embedding: %s", e)
            return None

    def _compute_max_similarity(
        self,
        query_embedding: List[float],
        corpus_sample: List[str]
    ) -> float:
        """Compute maximum cosine similarity against a corpus sample."""
        try:
            # Get embeddings for corpus sample
            corpus_embeddings = self._get_embeddings_batch(corpus_sample)
            if not corpus_embeddings:
                return 0.0

            query_vec = np.array(query_embedding)
            similarities = []

            for corpus_embedding in corpus_embeddings:
                corpus_vec = np.array(corpus_embedding)
                similarity = self._cosine_similarity(query_vec, corpus_vec)
                similarities.append(similarity)

            return max(similarities) if similarities else 0.0

        except Exception as e:
            logger.warning("Error computing similarity: %s", e)
            return 0.0

    def _get_embeddings_batch(self, texts: List[str]) -> Optional[List[List[float]]]:
        """Get embeddings for multiple texts."""
        try:
            # Limit batch size for performance
            batch_size = min(len(texts), 10)
            sample_texts = texts[:batch_size]

            response = requests.post(
                f"{self.bge_url}/v1/embeddings",
                json={
                    "input": sample_texts,
                    "model": "bge-m3"
                },
                timeout=8  # Slightly longer for batch
            )

            if response.status_code == 200:
                data = response.json()
                return [item["embedding"] for item in data["data"]]
            else:
                logger.warning("BGE batch embedding failed: %s", response.status_code)
                return None

        except Exception as e:
            logger.warning("Error getting batch embeddings: %s", e)
            return None

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Calculate cosine similarity between two vectors."""
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    def _ensure_intent_embeddings(self) -> bool:
        """Ensure intent label embeddings are available."""
        if self._intent_label_embeddings is not None:
            return True

        label_embeddings: Dict[str, np.ndarray] = {}

        for label, examples in self._INTENT_LABEL_EXAMPLES.items():
            embeddings = self._embed_texts(examples)
            if not embeddings:
                continue

            matrix = np.array(embeddings)
            averaged = matrix.mean(axis=0)
            norm = np.linalg.norm(averaged)
            if norm == 0:
                continue

            label_embeddings[label] = averaged / norm

        if not label_embeddings:
            logger.warning("Intent label embeddings unavailable; skipping intent classification")
            return False

        self._intent_label_embeddings = label_embeddings
        return True

    def _embed_texts(self, texts: List[str]) -> Optional[List[List[float]]]:
        """Embed a list of texts, chunking requests for the BGE endpoint."""
        if not texts:
            return []

        embeddings: List[List[float]] = []
        index = 0

        while index < len(texts):
            batch = texts[index:index + 10]
            batch_embeddings = self._get_embeddings_batch(batch)
            if not batch_embeddings:
                return None
            embeddings.extend(batch_embeddings)
            index += len(batch)

        return embeddings

    def _classify_intent(self, query: str) -> Optional[Tuple[str, float, float]]:
        """Classify the query intent using BGE embeddings."""
        query = query.strip()
        if not query:
            return None

        if not self._ensure_intent_embeddings():
            return None

        embedding = self._get_embedding(query)
        if not embedding:
            return None

        query_vec = np.array(embedding)
        query_norm = np.linalg.norm(query_vec)
        if query_norm == 0:
            return None

        query_vec /= query_norm

        best_label: Optional[str] = None
        best_score = -1.0
        second_score = -1.0

        for label, label_vec in self._intent_label_embeddings.items():
            score = float(np.dot(query_vec, label_vec))
            if score > best_score:
                second_score = best_score
                best_label = label
                best_score = score
            elif score > second_score:
                second_score = score

        if best_label is None:
            return None

        if best_score < self._INTENT_MIN_SCORE:
            return None

        margin = best_score if second_score <= -1 else best_score - second_score
        if margin < self._INTENT_MIN_MARGIN:
            return None

        return best_label, best_score, margin

    def _looks_like_information_request(self, query_lower: str) -> Optional[str]:
        """Lightweight heuristic to flag likely information-seeking queries."""
        prefixes = (
            "what is", "what are", "what's", "help me understand",
            "explain", "define", "tell me about", "give me an overview",
            "provide an overview", "can you explain"
        )

        for prefix in prefixes:
            if query_lower.startswith(prefix):
                return prefix

        mid_signals = (
            " meaning of", " definition of", " overview of", " breakdown of"
        )

        for signal in mid_signals:
            if signal in query_lower:
                return signal.strip()

        metrics_keywords = (
            "p90", "p95", "p99", "percentile", "slo", "error budget",
            "latency", "availability", "uptime", "metrics", "response time",
            "throughput", "apdex", "lighthouse", "dashboard", "results"
        )

        analytics_prompts = (
            "do we have", "show me", "can you pull", "give me", "fetch",
            "what are", "what is", "provide", "share", "list", "report"
        )

        if any(keyword in query_lower for keyword in metrics_keywords):
            if any(prompt in query_lower for prompt in analytics_prompts) or '?' in query_lower:
                for keyword in metrics_keywords:
                    if keyword in query_lower:
                        return f"metrics:{keyword}"

        return None

    def _fallback_decision(
        self,
        query: str,
        conversation_context: Optional[List[Dict[str, str]]] = None
    ) -> Tuple[bool, float, str]:
        """Fallback decision when similarity check is not available."""
        intent_prediction = self._classify_intent(query)
        if intent_prediction:
            intent_label, intent_score, intent_margin = intent_prediction
            if intent_label in self._RAG_INTENTS:
                return True, intent_score, (
                    f"Intent '{intent_label}' (score={intent_score:.3f}, margin={intent_margin:.3f})"
                )
            return False, intent_score, (
                f"Intent '{intent_label}' (score={intent_score:.3f}, margin={intent_margin:.3f})"
            )

        heuristic_signal = self._looks_like_information_request(query.lower().strip())
        if heuristic_signal:
            return True, 0.52, f"Heuristic information request ('{heuristic_signal}')"

        # Default to RAG for safety when classification is unavailable
        return True, 0.5, "Fallback: defaulting to RAG"

    def is_available(self) -> bool:
        """Check if BGE endpoint is available."""
        try:
            response = requests.get(f"{self.bge_url}/health", timeout=3)
            return response.status_code == 200
        except:
            return False

    def get_stats(self) -> Dict[str, any]:
        """Get router statistics and configuration."""
        return {
            "bge_url": self.bge_url,
            "similarity_threshold": self.similarity_threshold,
            "is_available": self.is_available()
        }


# Utility function for easy integration
def should_query_use_rag(
    query: str,
    conversation_context: Optional[List[Dict[str, str]]] = None,
    corpus_sample: Optional[List[str]] = None,
    similarity_threshold: float = 0.4,
    bge_url: str = "http://localhost:8001"
) -> Tuple[bool, float, str]:
    """
    Utility function to determine if a query should use RAG.

    Returns:
        Tuple of (should_use_rag, similarity_score, reasoning)
    """
    router = QueryRouter(bge_url=bge_url, similarity_threshold=similarity_threshold)
    return router.should_use_rag(query, conversation_context, corpus_sample)
