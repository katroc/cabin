"""LLM-powered semantic query router using Qwen3-4B-AWQ-router for intent classification."""

import logging
import json
from typing import Dict, List, Optional, Tuple
from enum import Enum
import requests
from pydantic import BaseModel, ValidationError

from .config import settings

logger = logging.getLogger(__name__)


class QueryIntent(str, Enum):
    """Query intent classifications."""
    RAG_QUERY = "rag_query"
    GENERAL_QUERY = "general_query"
    HYBRID_QUERY = "hybrid_query"


class RouterResponse(BaseModel):
    """Structured response from the LLM router."""
    intent: QueryIntent
    confidence: float
    reason: str

    class Config:
        use_enum_values = True


class LLMQueryRouter:
    """
    LLM-powered semantic query router that classifies user queries into:
    - rag_query: Needs document retrieval from knowledge base
    - general_query: Can be answered with LLM's base knowledge
    - hybrid_query: Needs both retrieval and general knowledge
    """

    ROUTER_SYSTEM_PROMPT = """You are a query classification API. Return only JSON with these exact values:

ALLOWED VALUES for intent:
- "rag_query" (needs company/internal documents)
- "general_query" (greetings, coding, math, public knowledge)
- "hybrid_query" (combination of both)

Format: {"intent": "exact_value_above", "confidence": 0.0-1.0, "reason": "brief explanation"}

Examples:
{"intent": "general_query", "confidence": 0.95, "reason": "greeting"}
{"intent": "rag_query", "confidence": 0.9, "reason": "internal document"}
{"intent": "general_query", "confidence": 0.85, "reason": "coding question"}"""

    def __init__(
        self,
        router_url: str = "http://localhost:8000",
        confidence_threshold: float = 0.65,
        timeout: float = 5.0
    ):
        """
        Initialize the LLM query router.

        Args:
            router_url: Base URL for Qwen3-4B-AWQ-router service
            confidence_threshold: Minimum confidence to trust the classification
            timeout: Request timeout in seconds
        """
        self.router_url = router_url.rstrip('/')
        self.confidence_threshold = confidence_threshold
        self.timeout = timeout

    def should_use_rag(
        self,
        query: str,
        conversation_context: Optional[List[Dict[str, str]]] = None,
        corpus_sample: Optional[List[str]] = None
    ) -> Tuple[bool, float, str]:
        """
        Determine if query should use RAG based on LLM classification.

        Args:
            query: User's query
            conversation_context: Previous conversation messages (used for context)
            corpus_sample: Document samples for domain context (if available)

        Returns:
            Tuple of (should_use_rag, confidence, reasoning)
        """
        try:
            # Enhance query with conversation context if available
            enhanced_query = self._build_contextual_query(query, conversation_context)

            # Get classification from LLM router with corpus context
            router_response = self._classify_query(enhanced_query, corpus_sample)

            if not router_response:
                return True, 0.0, "Router failed, defaulting to RAG for safety"

            # Determine RAG usage based on intent and confidence
            should_rag, reasoning = self._make_routing_decision(router_response)

            logger.debug(
                "LLM Router: '%s' -> %s (intent=%s, confidence=%.3f)",
                query[:50], should_rag, router_response.intent, router_response.confidence
            )

            return should_rag, router_response.confidence, reasoning

        except Exception as e:
            logger.error("LLM router error: %s", e)
            return True, 0.0, f"Router error: {str(e)}, defaulting to RAG"

    def _build_contextual_query(
        self,
        query: str,
        conversation_context: Optional[List[Dict[str, str]]] = None
    ) -> str:
        """Build enhanced query with conversation context."""
        if not conversation_context or len(conversation_context) < 2:
            return query

        # Add the most recent user message for context
        for msg in reversed(conversation_context):
            if msg.get('role') == 'user' and msg.get('content', '').strip() != query.strip():
                context_snippet = msg.get('content', '')[:100]
                return f"Previous question: {context_snippet}\n\nCurrent question: {query}"

        return query

    def _build_system_prompt(self, corpus_sample: Optional[List[str]] = None) -> str:
        """Build system prompt with optional document context."""
        base_prompt = self.ROUTER_SYSTEM_PROMPT

        if not corpus_sample or len(corpus_sample) == 0:
            return base_prompt

        # Add document context to prompt
        context_section = "\n\nRELEVANT DOCUMENTS IN KNOWLEDGE BASE:\n"
        for i, doc_snippet in enumerate(corpus_sample[:10], 1):  # Limit to top 10
            # Truncate very long documents to keep prompt manageable
            snippet = doc_snippet[:200] + "..." if len(doc_snippet) > 200 else doc_snippet
            context_section += f"{i}. {snippet}\n"

        context_section += "\nConsider whether the query relates to any of these documents when classifying.\n"

        return base_prompt + context_section

    def _classify_query(self, query: str, corpus_sample: Optional[List[str]] = None) -> Optional[RouterResponse]:
        """Send query to LLM router for classification."""
        try:
            # Build context-aware system prompt
            system_prompt = self._build_system_prompt(corpus_sample)

            # Prepare the request
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": query}
            ]

            model_name = settings.llm_model
            logger.debug(f"Query router using model: '{model_name}'")
            payload = {
                "model": model_name,
                "messages": messages,
                "temperature": 0.0,  # More deterministic
                "max_tokens": 100,   # Shorter for JSON only
                "stop": ["Query:", "\n\n"]  # Stop at new query or double newline
            }

            # Make request to router LLM
            response = requests.post(
                f"{self.router_url}/v1/chat/completions",
                json=payload,
                timeout=self.timeout,
                headers={"Content-Type": "application/json"}
            )

            if response.status_code != 200:
                logger.warning("Router LLM request failed: HTTP %d", response.status_code)
                return None

            # Parse response
            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            if not content.strip():
                logger.warning("Router LLM returned empty response")
                return None

            # Parse JSON response (extract JSON from potentially mixed content)
            try:
                # First try direct parsing
                response_data = json.loads(content.strip())
                return RouterResponse(**response_data)
            except json.JSONDecodeError:
                # If direct parsing fails, try to extract JSON from the content
                import re
                json_match = re.search(r'\{.*?\}', content, re.DOTALL)
                if json_match:
                    try:
                        response_data = json.loads(json_match.group())
                        return RouterResponse(**response_data)
                    except (json.JSONDecodeError, ValidationError) as e:
                        logger.warning("Failed to parse extracted JSON: %s. Content: %s", e, content[:200])
                        return None
                else:
                    logger.warning("No JSON found in response. Content: %s", content[:200])
                    return None
            except ValidationError as e:
                logger.warning("Failed to validate router response: %s. Content: %s", e, content[:200])
                return None

        except requests.RequestException as e:
            logger.warning("Router LLM request failed: %s", e)
            return None
        except Exception as e:
            logger.error("Unexpected error in query classification: %s", e)
            return None

    def _make_routing_decision(self, router_response: RouterResponse) -> Tuple[bool, str]:
        """Make final routing decision based on router response and confidence."""
        intent = router_response.intent
        confidence = router_response.confidence
        reason = router_response.reason

        # Low confidence - default to RAG for safety
        if confidence < self.confidence_threshold:
            return True, f"Low confidence ({confidence:.3f} < {self.confidence_threshold}), using RAG. Router said: {reason}"

        # High confidence decisions
        if intent == QueryIntent.RAG_QUERY:
            return True, f"RAG query (confidence={confidence:.3f}): {reason}"
        elif intent == QueryIntent.GENERAL_QUERY:
            return False, f"General query (confidence={confidence:.3f}): {reason}"
        elif intent == QueryIntent.HYBRID_QUERY:
            return True, f"Hybrid query (confidence={confidence:.3f}), using RAG: {reason}"

        # Fallback (should not happen with enum validation)
        return True, f"Unknown intent '{intent}', defaulting to RAG"

    def is_available(self) -> bool:
        """Check if the router LLM endpoint is available."""
        try:
            response = requests.get(f"{self.router_url}/v1/models", timeout=3)
            return response.status_code == 200
        except:
            return False

    def get_stats(self) -> Dict[str, any]:
        """Get router statistics and configuration."""
        return {
            "router_url": self.router_url,
            "confidence_threshold": self.confidence_threshold,
            "timeout": self.timeout,
            "is_available": self.is_available(),
            "router_type": "llm_semantic"
        }


# Legacy compatibility function
def should_query_use_rag(
    query: str,
    conversation_context: Optional[List[Dict[str, str]]] = None,
    corpus_sample: Optional[List[str]] = None,
    similarity_threshold: float = 0.4,  # Ignored
    bge_url: str = "http://localhost:8001"  # Ignored
) -> Tuple[bool, float, str]:
    """
    Legacy compatibility function for the new LLM router.

    Returns:
        Tuple of (should_use_rag, confidence_score, reasoning)
    """
    router = LLMQueryRouter()
    return router.should_use_rag(query, conversation_context, corpus_sample)