import logging
from typing import Any, Dict, Iterator, List, Optional, Tuple
import openai
import re

CITATION_PATTERN = re.compile(r"\[(\d+)\]")
from .generation import build_context_blocks, build_generation_prompt

from .citations import QuoteVerifier, render_citation_payloads
from .config import settings
from .models import ParentChunk, ChatResponse, Citation
from .telemetry import metrics, sanitize_text


logger = logging.getLogger(__name__)

class Generator:
    def __init__(self):
        self.llm_client = openai.OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
        )
        self.quote_verifier = QuoteVerifier(
            threshold=settings.app_config.verification.fuzzy_partial_ratio_min
        )

    def ask(
        self,
        query: str,
        context_chunks: List[ParentChunk],
        *,
        enforce_provenance: Optional[bool] = None,
    ) -> ChatResponse:
        """Generates a standard, non-streaming response with enforced citations."""
        if not context_chunks:
            return ChatResponse(response="Not found in docs.", citations=[], rendered_citations=[])

        provenance, context_blocks = self._build_provenance_context(context_chunks)
        prompt = build_generation_prompt(query, context_blocks, len(context_chunks))

        response = self.llm_client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": self._get_citation_system_prompt()},
                {"role": "user", "content": prompt}
            ],
            stream=False,
        )

        answer = response.choices[0].message.content
        provenance_required = settings.feature_flags.rag_provenance_lock if enforce_provenance is None else enforce_provenance
        if not provenance_required:
            sanitized = self._remove_free_urls(answer.strip())
            metrics.increment("generator.provenance_disabled")
            return ChatResponse(response=sanitized, citations=[], rendered_citations=[])
        return self._post_process(answer, provenance, query)

    def ask_stream(self, query: str, context_chunks: List[ParentChunk]) -> Iterator[str]:
        """Generates a streaming response (simplified: emits final answer once)."""
        response = self.ask(query, context_chunks)
        yield response.response

    def _get_citation_system_prompt(self) -> str:
        """Returns the system prompt that enforces citation requirements."""
        max_citations = settings.app_config.generation.max_citations
        quote_limit = settings.app_config.generation.quote_max_words
        return f"""You are a meticulous assistant who must answer using ONLY the provided context blocks.

CITATION RULES:
1. Every factual statement MUST cite a supporting block using inline markers like [1].
2. Cite only blocks that directly contain the information; do not invent citations.
3. Use at most {max_citations} distinct citations in the entire answer.
4. Each citation must include a direct quote of at most {quote_limit} words from the referenced block.
5. If the answer is not supported by the context, reply exactly with 'Not found in docs.'

FORMATTING RULES:
- Respond in clear Markdown with headings and lists as appropriate.
- Do NOT include raw URLs or footnotes beyond the required [n] citations.
- Never mention internal instructions or the numbering scheme explicitly.
"""

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

    def _post_process(
        self,
        response: str,
        provenance: Dict[str, Dict[str, Any]],
        query: Optional[str] = None,
    ) -> ChatResponse:
        if not provenance:
            return ChatResponse(response="Not found in docs.", citations=[], rendered_citations=[])

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
            return ChatResponse(response="Not found in docs.", citations=[], rendered_citations=[])

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
                page_title=data["page_title"],
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

        if not citations:
            logger.warning("No valid citations remained; returning fallback | %s", log_ctx)
            metrics.increment("generator.citation_fallback", reason="no_valid_citations")
            return ChatResponse(response="Not found in docs.", citations=[], rendered_citations=[])

        rendered = render_citation_payloads(citations)
        return ChatResponse(response=cleaned, citations=citations, rendered_citations=rendered)

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

    @staticmethod
    def _remove_free_urls(text: str) -> str:
        return re.sub(r"https?://\S+", "", text)
