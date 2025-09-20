"""Simple, fast query router using BGE-M3 similarity to decide RAG vs conversational."""

import logging
from typing import Dict, List, Optional, Tuple
import requests
import numpy as np

logger = logging.getLogger(__name__)


class QueryRouter:
    """Decides whether a query needs RAG retrieval or can be handled conversationally."""

    def __init__(self, bge_url: str = "http://localhost:8001", similarity_threshold: float = 0.4):
        self.bge_url = bge_url.rstrip('/')
        self.similarity_threshold = similarity_threshold

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

                logger.debug(
                    "Query router: '%s' -> RAG=%s (sim=%.3f)",
                    query[:50], should_rag, max_similarity
                )

                return should_rag, max_similarity, reasoning
            else:
                # No corpus sample available - use conversation-based heuristics
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

    def _fallback_decision(
        self,
        query: str,
        conversation_context: Optional[List[Dict[str, str]]] = None
    ) -> Tuple[bool, float, str]:
        """Fallback decision when similarity check is not available."""
        query_lower = query.lower().strip()

        # Strong conversational indicators
        conversational_patterns = [
            "are you sure", "is that correct", "is that right", "verify that",
            "can you confirm", "double check", "are you certain",
            "what do you mean", "can you explain", "clarify", "rephrase that",
            "tell me more", "elaborate", "be more specific",
            "that answer", "your response", "what you said", "the previous"
        ]

        for pattern in conversational_patterns:
            if pattern in query_lower:
                return False, 0.8, f"Conversational pattern detected: '{pattern}'"

        # If very short and looks like follow-up
        if len(query.split()) <= 3 and conversation_context and len(conversation_context) > 1:
            return False, 0.7, "Short query in conversation context"

        # Default to RAG for safety
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