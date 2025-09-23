import logging
from typing import Any, Dict, Iterator, List, Optional, Tuple, cast
import openai
from openai.types.chat import ChatCompletionMessageParam
import re

CITATION_PATTERN = re.compile(r"\[(\d+)\]")
from .generation import build_context_blocks, build_generation_prompt

from .citations import QuoteVerifier, render_citation_payloads
from .config import settings
from .models import ParentChunk, ChatResponse, Citation, PersonaType
from .runtime import RuntimeOverrides
from .telemetry import metrics, sanitize_text


logger = logging.getLogger(__name__)

class Generator:
    def __init__(self, overrides: Optional[RuntimeOverrides] = None):
        overrides = overrides or RuntimeOverrides()
        base_url = overrides.llm_base_url or settings.llm_base_url
        model = overrides.llm_model or settings.llm_model
        self.temperature = overrides.temperature if overrides.temperature is not None else 0.1

        # Store token limit overrides
        self.max_tokens = overrides.max_tokens or settings.app_config.generation.max_tokens
        self.streaming_max_tokens = overrides.streaming_max_tokens or settings.app_config.generation.streaming_max_tokens
        self.rephrasing_max_tokens = overrides.rephrasing_max_tokens or settings.app_config.generation.rephrasing_max_tokens

        self.llm_client = openai.OpenAI(
            api_key=settings.llm_api_key,
            base_url=base_url,
        )
        self.llm_model = model
        self.quote_verifier = QuoteVerifier(
            threshold=settings.app_config.verification.fuzzy_partial_ratio_min
        )

    def ask(
        self,
        query: str,
        context_chunks: List[ParentChunk],
        *,
        conversation_id: str,
        conversation_context: Optional[List[Dict[str, str]]] = None,
        enforce_provenance: Optional[bool] = None,
        persona: PersonaType = PersonaType.STANDARD,
    ) -> ChatResponse:
        """Generates a standard, non-streaming response with enforced citations."""
        if not context_chunks:
            # If provenance is explicitly disabled, generate a conversational response
            if enforce_provenance is False:
                return self._generate_conversational_response(query, conversation_id, conversation_context, persona)

            return ChatResponse(
                response="I couldn't find any relevant information in the documentation to answer your question. You might want to try rephrasing your query or checking if the topic is covered in the available documents.",
                conversation_id=conversation_id,
                citations=[],
                rendered_citations=[],
                used_rag=False  # This was intended as RAG but failed
            )

        provenance, context_blocks = self._build_provenance_context(context_chunks)
        prompt = build_generation_prompt(query, context_blocks, len(context_chunks))

        # Build messages with conversation context
        messages = [{"role": "system", "content": self._get_citation_system_prompt(persona.value)}]

        # Add conversation history if available
        if conversation_context:
            messages.extend(conversation_context)

        # Add the current user query
        messages.append({"role": "user", "content": prompt})

        response = self.llm_client.chat.completions.create(
            model=self.llm_model,
            messages=cast(List[ChatCompletionMessageParam], messages),
            stream=False,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )

        answer = response.choices[0].message.content

        # Validate that we got a proper LLM response
        if not answer or answer.strip() == "":
            logger.warning("Empty response from LLM for query: %s", query[:100])
            return ChatResponse(
                response="I couldn't generate a proper response for your question. Please try rephrasing it.",
                conversation_id=conversation_id,
                citations=[],
                rendered_citations=[],
                used_rag=False  # This was intended as RAG but failed
            )

        # Check if response looks like raw documentation (simple heuristic)
        if self._looks_like_raw_docs(answer.strip()):
            logger.warning("Response appears to be raw documentation for query: %s", query[:100])
            # Try to get LLM to rephrase it
            rephrased = self._rephrase_response(query, answer.strip())
            answer = rephrased if rephrased else answer

        provenance_required = settings.feature_flags.rag_provenance_lock if enforce_provenance is None else enforce_provenance
        if not provenance_required:
            sanitized = self._remove_free_urls(answer.strip())
            metrics.increment("generator.provenance_disabled")
            return ChatResponse(
                response=sanitized,
                conversation_id=conversation_id,
                citations=[],
                rendered_citations=[],
                used_rag=False  # Provenance disabled, not using RAG
            )
        return self._post_process(answer, provenance, query, conversation_id)

    def ask_stream(
        self,
        query: str,
        context_chunks: List[ParentChunk],
        *,
        conversation_id: str,
        conversation_context: Optional[List[Dict[str, str]]] = None,
        enforce_provenance: Optional[bool] = None,
        persona: PersonaType = PersonaType.STANDARD,
    ) -> Iterator[str]:
        """Generates a real streaming response with token-by-token output."""
        if not context_chunks:
            # If provenance is explicitly disabled, generate a streaming conversational response
            if enforce_provenance is False:
                yield from self._generate_streaming_conversational_response(query, conversation_id, conversation_context, persona)
                return

            # No context chunks and provenance required - return fallback message
            yield "I couldn't find any relevant information in the documentation to answer your question. You might want to try rephrasing your query or checking if the topic is covered in the available documents."
            return

        # Build context and prompt for RAG response
        provenance, context_blocks = self._build_provenance_context(context_chunks)
        prompt = build_generation_prompt(query, context_blocks, len(context_chunks))

        # Prepare conversation messages
        messages = [{"role": "system", "content": self._get_citation_system_prompt(persona.value)}]

        # Add conversation context
        if conversation_context:
            messages.extend(conversation_context)

        # Add the current user query
        messages.append({"role": "user", "content": prompt})

        # Stream the response
        try:
            response_stream = self.llm_client.chat.completions.create(
                model=self.llm_model,
                messages=cast(List[ChatCompletionMessageParam], messages),
                stream=True,  # Enable streaming
                temperature=self.temperature,
                max_tokens=self.streaming_max_tokens,
            )

            collected_content = ""
            for chunk in response_stream:
                if chunk.choices[0].delta.content is not None:
                    content = chunk.choices[0].delta.content
                    collected_content += content
                    yield content

        except Exception as e:
            logger.error("Error during streaming generation: %s", str(e))
            yield f"Error generating response: {str(e)}"

    def _generate_streaming_conversational_response(
        self,
        query: str,
        conversation_id: str,
        conversation_context: Optional[List[Dict[str, str]]] = None,
        persona: PersonaType = PersonaType.STANDARD
    ) -> Iterator[str]:
        """Generate a streaming conversational response without RAG context."""
        # Prepare conversation messages
        messages = [{"role": "system", "content": self._get_conversational_system_prompt(persona.value)}]

        # Add conversation context
        if conversation_context:
            messages.extend(conversation_context)

        # Add the current user query
        messages.append({"role": "user", "content": query})

        try:
            response_stream = self.llm_client.chat.completions.create(
                model=self.llm_model,
                messages=cast(List[ChatCompletionMessageParam], messages),
                stream=True,  # Enable streaming
                temperature=self.temperature,
                max_tokens=self.streaming_max_tokens,
            )

            for chunk in response_stream:
                if chunk.choices[0].delta.content is not None:
                    yield chunk.choices[0].delta.content

        except Exception as e:
            logger.error("Error during streaming conversational generation: %s", str(e))
            yield f"Error generating response: {str(e)}"

    def _get_conversational_system_prompt(self, persona: str = "standard") -> str:
        """Returns the system prompt for conversational responses without citations."""
        base_prompt = """You are a helpful assistant having a natural conversation.
You have access to conversation history to understand context and provide relevant responses.
You don't need to cite sources for this response.
If the user is asking follow-up questions like "ok thanks, and that's it?" or similar,
provide a natural conversational response acknowledging their question."""

        if persona == "direct":
            return base_prompt + """

CRITICAL: ALWAYS use DIRECT, CONCISE responses. Be extremely brief.
- Maximum 2-3 sentences for simple questions
- Use bullet points for steps or lists
- NO explanatory text, examples, or elaboration
- Start with the direct answer immediately
- Avoid phrases like "To help you" or "Here's what you need to know"
- Example: "Q: How to save?" A: "Click File > Save or press Ctrl+S."""
        elif persona == "eli5":
            return base_prompt + """

CRITICAL: ALWAYS explain assuming the user has ZERO prior knowledge of the topic.
- Define any technical terms or concepts before using them
- Use helpful analogies and real-world comparisons when appropriate
- Provide context and background information
- Break down processes into clear, logical steps
- Explain WHY things work the way they do, not just HOW
- Use clear, accessible language without being condescending
- Example: "Q: What's an API?" A: "An API (Application Programming Interface) is a way for different software programs to communicate with each other. Think of it like a waiter in a restaurant - you tell the waiter your order, they take it to the kitchen, and bring back your food. The waiter is like an API, carrying messages between you and the kitchen."""
        else:  # standard
            return base_prompt + """

Be conversational, helpful, and natural with balanced detail level."""

    def _get_citation_system_prompt(self, persona: str = "standard") -> str:
        """Returns the system prompt that enforces natural response generation with citations."""
        max_citations = settings.app_config.generation.max_citations
        quote_limit = settings.app_config.generation.quote_max_words

        base_prompt = f"""You are a knowledgeable assistant that provides helpful responses based on documentation with full conversation awareness.

CONVERSATION HANDLING:
- You have access to previous conversation history to understand context and follow-up questions
- When users ask follow-up questions, reference previous discussion appropriately
- If users question accuracy ("are you sure?"), acknowledge their concern and re-examine the information
- For clarification requests, build upon what was already discussed

CITATION REQUIREMENTS:
- Support factual claims with citations using [1], [2] format
- Use at most {max_citations} citations from the most relevant sources
- Include direct quotes of at most {quote_limit} words for each citation
- Only cite information that directly supports your statements

IMPORTANT: Always process information through your reasoning and provide a natural response. Use conversation history to better understand the user's intent and provide contextually appropriate answers."""

        if persona == "direct":
            return base_prompt + """

CRITICAL: MANDATORY DIRECT STYLE - NO EXCEPTIONS:
- Maximum 2-3 sentences total
- Start with the exact answer immediately
- Use bullet points for multiple items
- NO introductory phrases like "To answer your question" or "Here's how"
- NO explanations unless specifically asked
- Example: "Q: How to get refund?" A: "File support ticket with Atlassian. Use: https://atlassian.com/contact/purchasing-licensing [1]"""
        elif persona == "eli5":
            return base_prompt + """

CRITICAL: MANDATORY BEGINNER-FRIENDLY STYLE - ASSUME ZERO KNOWLEDGE:
- Define concepts and terms before using them
- Provide helpful context and background information
- Use analogies when they clarify complex concepts
- Explain the reasoning behind processes and requirements
- Break down multi-step processes clearly
- Use accessible language without being childish
- Example: "Q: How to get refund?" A: "When you purchase software through a platform like Atlassian (which hosts draw.io), refunds aren't handled directly by the software company. Instead, you need to contact the platform that processed your payment. This is similar to how if you bought something on Amazon, you'd contact Amazon for returns, not the individual seller..."""
        else:  # standard
            return base_prompt + """

RESPONSE STYLE:
- Write in a natural, conversational tone as if explaining to a colleague
- Provide balanced detail - not too brief, not too verbose
- Use clear structure with helpful context
- Be informative but approachable
- Explain the "what" and "why" when relevant"""

    def _build_provenance_context(self, context_chunks: List[ParentChunk]) -> Tuple[Dict[str, Dict[str, Any]], str]:
        provenance: Dict[str, Dict[str, Any]] = {}
        entries: List[Dict[str, str]] = []

        for index, chunk in enumerate(context_chunks, start=1):
            idx = str(index)
            chunk_id = chunk.metadata.chunk_id or chunk.id
            raw_url = chunk.metadata.url or chunk.metadata.source_url or ""
            anchor = chunk.metadata.anchor_id
            if raw_url and anchor and "#" not in raw_url:
                raw_url = f"{raw_url}#{anchor}"
            display_source = raw_url or chunk.metadata.page_title or f"Chunk {idx}"
            entries.append({"text": chunk.text, "source": display_source})
            provenance[idx] = {
                "chunk_id": chunk_id,
                "url": raw_url,
                "display_source": display_source,
                "page_title": chunk.metadata.page_title or "",
                "space_name": chunk.metadata.space_name or "",
                "space_key": chunk.metadata.space_key or "",
                "page_version": str(chunk.metadata.page_version or ""),
                "section": " > ".join(chunk.metadata.headings or []) if chunk.metadata.headings else "",
                "last_modified": chunk.metadata.last_modified or "",
                "chunk": chunk,  # type: ignore
            }

        context_blocks = build_context_blocks(entries) if entries else ""
        return provenance, context_blocks

    def _extract_citations_from_response(
        self,
        response: str,
        context_chunks: List[ParentChunk],
    ) -> List[Citation]:
        """Extract citations from response text using context chunks."""
        # Find all citation markers like [1], [2], etc.
        matches = CITATION_PATTERN.findall(response)

        citations = []
        seen_indices = set()

        # Build provenance mapping from context chunks
        provenance = {}
        for i, chunk in enumerate(context_chunks, 1):
            idx = str(i)
            provenance[idx] = {
                "chunk": chunk,
                "page_title": chunk.metadata.page_title or "",
                "source_url": chunk.metadata.source_url or chunk.metadata.url or "",
                "space_name": chunk.metadata.space_name or "",
            }

        for match in matches:
            idx = match
            if idx in seen_indices or idx not in provenance:
                continue
            seen_indices.add(idx)

            data = provenance[idx]
            chunk = data["chunk"]

            # Extract quote from response (simplified - take text around citation)
            quote = self._default_quote(chunk.text, settings.app_config.generation.quote_max_words)

            citation = Citation(
                id=idx,
                chunk_id=chunk.metadata.chunk_id or chunk.id,
                page_title=data["page_title"] or data["source_url"] or f"Source {idx}",
                source_url=data["source_url"],
                space_name=data["space_name"],
                quote=quote,
            )
            citations.append(citation)

        return citations

    def _post_process(
        self,
        response: str,
        provenance: Dict[str, Dict[str, Any]],
        query: Optional[str] = None,
        conversation_id: Optional[str] = None,
    ) -> ChatResponse:
        if not provenance:
            return ChatResponse(
                response="I couldn't find reliable citations for this information in the available documentation. Please try rephrasing your question or checking if the topic is covered in the docs.",
                conversation_id=conversation_id or "unknown",
                citations=[],
                rendered_citations=[],
                used_rag=False  # This was RAG processing but failed
            )

        cleaned = self._remove_free_urls(response.strip())
        cleaned = cleaned.replace('【', '[').replace('】', ']')
        preview = cleaned[:200] + ("…" if len(cleaned) > 200 else "")
        query_preview = sanitize_text((query or "")[:64].replace("\n", " ")) if query else ""
        log_ctx = {"query_preview": query_preview, "query_len": len(query or "")}
        logger.debug("LLM response preview %s | %s", preview, log_ctx)

        indices = self._extract_citation_indices(cleaned)

        if not indices:
            logger.warning(
                "No citation markers detected; returning fallback | %s",
                log_ctx,
            )
            metrics.increment("generator.citation_fallback", reason="no_markers")
            return ChatResponse(
                response="I couldn't find reliable citations for this information in the available documentation. Please try rephrasing your question or checking if the topic is covered in the docs.",
                conversation_id=conversation_id or "unknown",
                citations=[],
                rendered_citations=[],
                used_rag=False  # This was RAG processing but failed
            )

        seen: List[str] = []
        for idx in indices:
            if idx in provenance and idx not in seen:
                seen.append(idx)

        max_citations = settings.app_config.generation.max_citations
        allowed = seen[:max_citations]
        trimmed = set(seen[max_citations:])

        if trimmed:
            logger.debug(
                "Trimming citations beyond limit (%d) for query '%s': %s",
                max_citations,
                query,
                sorted(trimmed),
            )
            cleaned = self._remove_citations(cleaned, trimmed)

        citations: List[Citation] = []
        invalid: set[str] = set()
        quote_limit = settings.app_config.generation.quote_max_words

        for idx in allowed:
            data = provenance[idx]
            chunk = data["chunk"]  # type: ignore
            quote = self._extract_quote(cleaned, idx)
            fallback_used = False
            if not quote:
                logger.warning(
                    "Citation [%s] missing quote; generating fallback snippet | %s",
                    idx,
                    log_ctx,
                )
                quote = self._default_quote(chunk.text, quote_limit)
                fallback_used = True
                metrics.increment("generator.citation_repair", reason="missing_quote")

            truncated_quote = self._truncate_quote(quote, quote_limit)
            if not self.quote_verifier.verify(truncated_quote, chunk.text):
                if fallback_used:
                    logger.warning(
                        "Fallback quote for citation [%s] failed verification | %s",
                        idx,
                        log_ctx,
                    )
                else:
                    logger.warning(
                        "Citation [%s] quote failed verification | %s",
                        idx,
                        log_ctx,
                    )
                metrics.increment("generator.citation_repair", reason="verification_failed")
                invalid.add(idx)
                continue
            citation = Citation(
                id=idx,
                page_title=data["page_title"] or data["url"] or f"Source {idx}",
                space_name=data["space_name"] or None,
                space_key=data["space_key"] or None,
                source_url=data["url"] or None,
                chunk_id=data["chunk_id"],
                page_version=int(data["page_version"]) if data["page_version"] else None,
                page_section=data["section"] or None,
                quote=truncated_quote,
                last_modified=data["last_modified"] or None,
            )
            citations.append(citation)

        if invalid:
            logger.warning(
                "Removed invalid citations %s | %s",
                sorted(invalid),
                log_ctx,
            )
            cleaned = self._remove_citations(cleaned, invalid)
            metrics.increment("generator.citation_repair", value=len(invalid), reason="invalid_removed")

        # Ensure citations and response text are consistent
        # Only include citations that are still present in the final cleaned response
        final_citation_indices = set(self._extract_citation_indices(cleaned))
        consistent_citations = [citation for citation in citations if citation.id in final_citation_indices]

        if not consistent_citations:
            logger.warning("No citations remained after consistency check; returning fallback | %s", log_ctx)
            metrics.increment("generator.citation_fallback", reason="no_consistent_citations")
            return ChatResponse(
                response="I couldn't find reliable citations for this information in the available documentation. Please try rephrasing your question or checking if the topic is covered in the docs.",
                conversation_id=conversation_id or "unknown",
                citations=[],
                rendered_citations=[],
                used_rag=False  # This was RAG processing but failed
            )

        rendered = render_citation_payloads(consistent_citations)
        return ChatResponse(
            response=cleaned,
            conversation_id=conversation_id or "unknown",
            citations=consistent_citations,
            rendered_citations=rendered,
            used_rag=True  # Successful RAG response with citations
        )

    def _extract_quote(self, text: str, index: str) -> Optional[str]:
        patterns = [
            re.compile(rf'"([^"]+)"\s*\[{re.escape(index)}\]'),
            re.compile(rf'“([^”]+)”\s*\[{re.escape(index)}\]'),
            re.compile(rf'”([^“]+)“\s*\[{re.escape(index)}\]'),
        ]
        for pattern in patterns:
            match = pattern.search(text)
            if match:
                return match.group(1).strip()
        return None

    @staticmethod
    def _default_quote(chunk_text: str, limit: int) -> str:
        words = chunk_text.split()
        if not words:
            return ""
        return " ".join(words[:limit])

    @staticmethod
    def _truncate_quote(quote: str, limit: int) -> str:
        words = quote.split()
        if len(words) <= limit:
            return quote
        return " ".join(words[:limit])

    def _extract_citation_indices(self, text: str) -> List[str]:
        return [match.group(1) for match in CITATION_PATTERN.finditer(text)]

    def _remove_citations(self, text: str, indices: set[str]) -> str:
        def replacement(match: re.Match[str]) -> str:
            return "" if match.group(1) in indices else match.group(0)

        return CITATION_PATTERN.sub(replacement, text)

    def _looks_like_raw_docs(self, text: str) -> bool:
        """Simple heuristic to detect if response looks like raw documentation."""
        # Check for characteristics of raw docs vs natural responses
        lines = text.split('\n')

        # Check for excessive formatting markers or structured doc patterns
        formatting_indicators = sum(1 for line in lines if line.strip().startswith(('##', '###', '####', '*', '-', '1.', '2.', '3.')))
        if len(lines) > 3 and formatting_indicators / len(lines) > 0.6:
            return True

        # Check for lack of conversational elements
        conversational_words = ['I', 'you', 'your', 'let me', 'here\'s', 'this means', 'basically', 'in other words']
        has_conversational = any(word.lower() in text.lower() for word in conversational_words)

        # Check for very formal/technical language without explanation
        if not has_conversational and len(text.split()) > 50:
            return True

        return False

    def _rephrase_response(self, original_query: str, raw_response: str) -> Optional[str]:
        """Ask LLM to rephrase a response to be more natural."""
        try:
            rephrase_prompt = f"""Please rephrase the following response to be more natural and conversational while keeping all the important information and citations:

Original question: {original_query}

Response to rephrase: {raw_response}

Make it sound like you're explaining this to a colleague in a helpful, natural way. Keep all citations [1], [2], etc. intact."""

            response = self.llm_client.chat.completions.create(
                model=self.llm_model,
                messages=cast(List[ChatCompletionMessageParam], [{"role": "user", "content": rephrase_prompt}]),
                stream=False,
                temperature=0.3,  # Lower temperature for consistency
                max_tokens=self.rephrasing_max_tokens,
            )

            rephrased = response.choices[0].message.content
            if rephrased and len(rephrased.strip()) > 10:
                return rephrased.strip()
        except Exception as e:
            logger.warning("Failed to rephrase response: %s", e)

        return None

    def _generate_conversational_response(
        self,
        query: str,
        conversation_id: str,
        conversation_context: Optional[List[Dict[str, str]]] = None,
        persona: PersonaType = PersonaType.STANDARD
    ) -> ChatResponse:
        """Generate a conversational response without requiring citations."""
        try:
            # Build messages with conversation context
            messages = [{"role": "system", "content": self._get_conversational_system_prompt(persona.value)}]

            # Add conversation history if available
            if conversation_context:
                messages.extend(conversation_context)

            # Add the current user query
            messages.append({"role": "user", "content": query})

            response = self.llm_client.chat.completions.create(
                model=self.llm_model,
                messages=cast(List[ChatCompletionMessageParam], messages),
                stream=False,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )

            answer = response.choices[0].message.content
            if not answer or answer.strip() == "":
                # Even conversational mode failed, return a generic response
                answer = "I'm here to help! Is there anything specific you'd like to know or discuss?"

            return ChatResponse(
                response=answer.strip(),
                conversation_id=conversation_id,
                citations=[],
                rendered_citations=[],
                used_rag=False  # This is a conversational response
            )

        except Exception as e:
            logger.warning("Failed to generate conversational response: %s", e)
            # Fallback to a simple acknowledgment
            return ChatResponse(
                response="I'm here to help! Is there anything else you'd like to know?",
                conversation_id=conversation_id,
                citations=[],
                rendered_citations=[],
                used_rag=False  # This is a conversational fallback
            )

    @staticmethod
    def _remove_free_urls(text: str) -> str:
        return re.sub(r"https?://\S+", "", text)
