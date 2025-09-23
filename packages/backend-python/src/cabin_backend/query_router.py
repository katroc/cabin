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
            # Process & Procedures
            "what is the deployment process?", "can you explain the procedure?",
            "how do I configure the service?", "what are the setup steps?",
            "walk me through the installation", "what's the workflow?",
            "how does the approval process work?", "what's the standard procedure?",

            # Documentation & Guides
            "where can I find the installation guide?", "tell me about the compliance requirements",
            "give me the policy details", "what are the guidelines?",
            "show me the documentation", "where is the manual?",
            "what are the requirements?", "what do the docs say?",

            # Architecture & Technical
            "describe the system architecture", "how is this designed?",
            "what's the technical stack?", "how does this component work?",
            "explain the data flow", "what's the infrastructure?",
            "how are services connected?", "what's the API structure?",

            # Features & Functionality
            "what features are available?", "what can this do?",
            "how does the authentication work?", "what are the capabilities?",
            "what integrations are supported?", "what options do I have?",
            "what's included in this package?", "what functionality exists?",

            # Configuration & Settings
            "how do I change the settings?", "what configuration options exist?",
            "how do I customize this?", "what parameters can I adjust?",
            "where are the config files?", "how do I modify the behavior?",
            "what environment variables are needed?", "how do I tune performance?",

            # Troubleshooting & Support
            "how do I fix this error?", "what causes this issue?",
            "why isn't this working?", "how do I troubleshoot?",
            "what's the solution for?", "how do I resolve?",
            "what steps should I take?", "how do I debug this?",

            # Policies & Compliance
            "what are the security policies?", "what compliance standards apply?",
            "what are the data retention rules?", "what permissions are required?",
            "what are the access controls?", "what audit requirements exist?",
            "what privacy policies apply?", "what regulations must we follow?",
        ],
        "analytics": [
            # Performance Metrics
            "do we have p95 latency results?", "what is the p99 for api latency?",
            "show me the latest availability metrics", "can you pull the response time percentiles?",
            "give me the dashboard stats for uptime", "what's the current throughput?",
            "how's the response time trending?", "what are the performance numbers?",

            # Error & Reliability Metrics
            "what are our error budgets this week?", "show me the error rates",
            "what's the failure rate?", "how many incidents this month?",
            "what's the MTTR?", "show me the downtime statistics",
            "what are the SLA metrics?", "how's our reliability?",

            # Usage & Traffic Analytics
            "how many users are active?", "what's the traffic volume?",
            "show me the usage patterns", "what are the peak hours?",
            "how many requests per second?", "what's the load distribution?",
            "show me the user engagement metrics", "what's the session duration?",

            # Business & Revenue Analytics
            "what are the conversion rates?", "show me the sales numbers",
            "what's the revenue growth?", "how many signups today?",
            "what's the churn rate?", "show me the retention metrics",
            "what are the customer acquisition costs?", "how's the ARR trending?",

            # System Resource Analytics
            "what's the CPU utilization?", "show me memory usage",
            "how's the disk space?", "what's the network bandwidth?",
            "show me the resource consumption", "what are the capacity metrics?",
            "how's the database performance?", "what's the cache hit rate?",

            # Observability Requests
            "summarize the observability metrics for checkout", "pull the monitoring data",
            "what do the logs show?", "check the traces", "show me the spans",
            "what alerts fired?", "give me the health check status",
            "what's in the metrics dashboard?", "show me the telemetry data",
        ],
        "conversational": [
            # Greetings & Basic Interactions
            "hello", "hi", "hey", "good morning", "good afternoon", "good evening",
            "how are you?", "how are you doing?", "how are you today?", "how's it going?",
            "what's up?", "hey there", "hello there", "hi there", "greetings",

            # Politeness & Social
            "thank you", "thanks", "thank you very much", "thanks a lot", "much appreciated",
            "you're welcome", "no problem", "please", "excuse me", "sorry",
            "nice to meet you", "pleasure to meet you", "good to see you",

            # Farewells
            "goodbye", "bye", "see you later", "catch you later", "take care",
            "have a good day", "have a great day", "see you soon", "until next time",

            # Conversational Flow & Clarification
            "are you sure about that?", "is that correct?", "can you explain that again?",
            "what do you mean by that?", "tell me more about your previous answer",
            "elaborate on what you just said", "rephrase that response for me",
            "I don't understand", "that doesn't make sense", "can you clarify?",
            "what?", "huh?", "pardon?", "come again?", "could you repeat that?",

            # Confirmation & Agreement
            "okay", "ok", "alright", "sure", "yes", "yeah", "yep", "right",
            "I see", "I understand", "got it", "makes sense", "fair enough",
            "absolutely", "exactly", "definitely", "of course", "indeed",

            # Small Talk & Personal
            "how's your day?", "what's new?", "anything interesting happening?",
            "how was your weekend?", "what are you up to?", "keeping busy?",
            "how's work?", "how's life?", "what's going on?", "how have you been?",

            # Expressions & Reactions
            "wow", "amazing", "incredible", "that's great", "awesome", "cool",
            "interesting", "really?", "no way", "seriously?", "you're kidding",
            "that's funny", "haha", "lol", "that's weird", "strange",
        ],
    }

    _RAG_INTENTS = {"information", "analytics"}
    _INTENT_MIN_SCORE = 0.35  # Lowered from 0.45 for better detection
    _INTENT_MIN_MARGIN = 0.08  # Lowered from 0.12 for better detection

    def __init__(self, bge_url: str = "http://localhost:8001", similarity_threshold: float = 0.4, embedding_model: str = "bge-m3"):
        self.bge_url = bge_url.rstrip('/')
        self.similarity_threshold = similarity_threshold
        self.embedding_model = embedding_model
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

            # Check for conversational intent FIRST using embeddings
            intent_prediction = self._classify_intent(query)
            if intent_prediction:
                intent_label, intent_score, intent_margin = intent_prediction
                if intent_label == "conversational" and intent_score > 0.3:  # Lower threshold for conversational
                    return False, intent_score, f"Conversational intent: score={intent_score:.3f}, margin={intent_margin:.3f}"

            # If we have a corpus sample, check similarity
            if corpus_sample and len(corpus_sample) > 0:
                max_similarity, similarity_gap = self._compute_max_similarity(query_embedding, corpus_sample)

                should_rag = bool(max_similarity >= self.similarity_threshold)
                reasoning = f"Max similarity: {max_similarity:.3f} vs threshold {self.similarity_threshold}"

                # Add gap information for debugging
                if similarity_gap > 0:
                    reasoning += f" (gap: {similarity_gap:.3f})"

                # Use gap analysis for edge cases
                # If similarity is close to threshold but gap is very small,
                # it might indicate a generic query that matches many docs weakly
                if (should_rag and
                    max_similarity < self.similarity_threshold + 0.1 and  # Close to threshold
                    similarity_gap < 0.05):  # Very small gap between top matches
                    should_rag = False
                    reasoning += "; small gap suggests generic query"

                heuristic_signal = None

                if not should_rag:
                    # Try fallback conversational patterns
                    conversational_fallback = self._looks_like_conversational_fallback(query_lower)
                    if conversational_fallback:
                        should_rag = False
                        reasoning += f"; conversational fallback ('{conversational_fallback}')"
                    else:
                        # Try intent classification for remaining cases
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
                    "model": self.embedding_model
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
    ) -> Tuple[float, float]:
        """Compute maximum cosine similarity and gap against a corpus sample."""
        try:
            # Get embeddings for corpus sample
            corpus_embeddings = self._get_embeddings_batch(corpus_sample)
            if not corpus_embeddings:
                return 0.0, 0.0

            query_vec = np.array(query_embedding)
            similarities = []

            for corpus_embedding in corpus_embeddings:
                corpus_vec = np.array(corpus_embedding)
                similarity = self._cosine_similarity(query_vec, corpus_vec)
                similarities.append(similarity)

            if not similarities:
                return 0.0, 0.0

            # Sort similarities in descending order
            similarities.sort(reverse=True)
            max_sim = similarities[0]

            # Calculate gap between first and second best
            gap = 0.0
            if len(similarities) > 1:
                second_best = similarities[1]
                gap = max_sim - second_best

            return max_sim, gap

        except Exception as e:
            logger.warning("Error computing similarity: %s", e)
            return 0.0, 0.0

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
                    "model": self.embedding_model
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

    def _looks_like_conversational_fallback(self, query_lower: str) -> Optional[str]:
        """Minimal fallback patterns for high-confidence conversational queries."""

        # Only keep the most obvious, unambiguous patterns
        obvious_conversational = {
            # Single word greetings
            "hi": "greeting", "hello": "greeting", "hey": "greeting",
            # Single word confirmations
            "ok": "confirmation", "okay": "confirmation", "yes": "confirmation", "no": "confirmation",
            # Single word politeness
            "thanks": "politeness", "bye": "farewell",
            # Internet slang (very unlikely to be in documentation)
            "lol": "expression", "haha": "expression"
        }

        # Strip punctuation for exact matching
        clean_query = query_lower.replace("!", "").replace(".", "").replace("?", "")

        if clean_query in obvious_conversational:
            return f"{obvious_conversational[clean_query]}:{clean_query}"

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
