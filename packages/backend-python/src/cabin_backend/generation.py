from typing import List, Iterator, Dict
import openai
import re
import json

from .config import settings
from .models import ParentChunk, ChatResponse, Citation

class Generator:
    def __init__(self):
        self.llm_client = openai.OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
        )

    def ask(self, query: str, context_chunks: List[ParentChunk]) -> ChatResponse:
        """Generates a standard, non-streaming response with enforced citations."""
        prompt, source_map = self._build_prompt_with_citations(query, context_chunks)

        response = self.llm_client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": self._get_citation_system_prompt()},
                {"role": "user", "content": prompt}
            ],
            stream=False,
        )

        answer = response.choices[0].message.content
        return self._process_response_with_citations(answer, source_map)

    def ask_stream(self, query: str, context_chunks: List[ParentChunk]) -> Iterator[str]:
        """Generates a streaming response."""
        # Note: For streaming, we'll yield the response as-is and process citations at the end
        # This is a simplified version - full citation processing would require collecting the full response
        prompt, _ = self._build_prompt_with_citations(query, context_chunks)

        stream = self.llm_client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": self._get_citation_system_prompt()},
                {"role": "user", "content": prompt}
            ],
            stream=True,
        )

        for chunk in stream:
            content = chunk.choices[0].delta.content
            if content:
                yield content

    def _get_citation_system_prompt(self) -> str:
        """Returns the system prompt that enforces citation requirements."""
        return """You are a helpful assistant that provides accurate, well-structured information based strictly on the provided context.

CRITICAL CITATION REQUIREMENTS:
1. You MUST cite every piece of information you use
2. Use inline citations like ¹, ², ³ etc. that correspond to the source numbers provided
3. Every factual claim, statistic, process, or specific detail MUST have a citation
4. If you cannot answer based on the provided sources, say "I don't have enough information in the provided sources to answer this question."
5. Never make up information or use knowledge outside the provided context
6. Use multiple citations if information comes from multiple sources

FORMATTING REQUIREMENTS:
- Format your response in **rich Markdown** with proper structure
- Use headings (## Main Topic, ### Subtopic) to organize information
- Use bullet points (-) or numbered lists (1.) for sequential information
- Use **bold** for key terms and *italics* for emphasis
- Use `inline code` for technical terms, commands, or specific values
- Use code blocks (```language) for multi-line code, configurations, or examples
- Use > blockquotes for important notes or warnings
- Use tables (| Column | Column |) when comparing multiple items
- Break up long responses into clear sections with appropriate headings
- Include superscript citations¹ after each claim

Your goal is to provide comprehensive, well-structured, and properly cited responses that are easy to read and navigate."""

    def _build_prompt_with_citations(self, query: str, context_chunks: List[ParentChunk]) -> tuple[str, Dict[str, ParentChunk]]:
        """Builds the prompt with numbered source references for citations."""
        if not context_chunks:
            return f"Question: {query}\n\nI don't have any relevant context to answer this question.", {}

        # Create source map for citations
        source_map = {}
        context_parts = []

        for i, chunk in enumerate(context_chunks, 1):
            source_id = str(i)  # Use simple numbers: 1, 2, 3
            source_map[source_id] = chunk

            # Build readable section reference
            section_ref = ""
            if chunk.metadata.headings:
                section_ref = " > ".join(chunk.metadata.headings)

            context_part = f"[{i}] Source: {chunk.metadata.page_title}"
            if chunk.metadata.space_name:
                context_part += f" (Space: {chunk.metadata.space_name})"
            if section_ref:
                context_part += f" - Section: {section_ref}"
            context_part += f"\nContent: {chunk.text}\n"

            context_parts.append(context_part)

        context_str = "\n---\n".join(context_parts)

        prompt = f"""Based ONLY on the provided sources below, answer the following question.

IMPORTANT: You MUST cite every piece of information using regular numbers in superscript format (e.g., 1, 2, 3) that correspond to the source numbers provided. Every factual statement needs a citation.

SOURCES:
{context_str}

QUESTION: {query}

ANSWER (with mandatory numbered citations):"""

        return prompt, source_map

    def _process_response_with_citations(self, response: str, source_map: Dict[str, ParentChunk]) -> ChatResponse:
        """Processes the LLM response to extract and validate citations."""
        # Find all citation references in the response - look for regular numbers and superscript Unicode
        citation_patterns = [
            r'\[S(\d+)\]',      # [S1] - legacy format
            r'【S(\d+)】',      # 【S1】 - legacy format
            r'\[\s*S(\d+)\s*\]', # [ S1 ] - legacy format
        ]

        cited_sources = set()

        # Handle superscript Unicode numbers
        superscript_map = {'¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9'}
        for char in response:
            if char in superscript_map:
                cited_sources.add(superscript_map[char])

        # Handle regular numbers that appear as citations (be more specific to avoid false positives)
        regular_citation_pattern = r'(?<!\w)(\d+)(?=\s|$|[.,!?])'
        potential_cites = re.findall(regular_citation_pattern, response)
        for cite in potential_cites:
            if cite in source_map:  # Only count if it's a valid source
                cited_sources.add(cite)

        # Handle legacy formats
        for pattern in citation_patterns:
            cited_sources.update(re.findall(pattern, response))

        # Build citation objects
        citations = []
        for source_num in sorted(cited_sources, key=int):
            source_id = source_num  # Now just the number
            if source_id in source_map:
                chunk = source_map[source_id]

                # Build section reference
                section_ref = None
                if chunk.metadata.headings:
                    section_ref = " > ".join(chunk.metadata.headings)

                # Use regular numbers for consistency
                citation = Citation(
                    id=source_id,
                    page_title=chunk.metadata.page_title,
                    space_name=chunk.metadata.space_name,
                    source_url=chunk.metadata.source_url,
                    page_section=section_ref,
                    last_modified=chunk.metadata.last_modified
                )
                citations.append(citation)

        # Clean up the response and validate citations
        if citations and source_map:
            # Remove any citation warnings if we found valid citations
            response = re.sub(r'\n\n\*Note: This response should include citations to sources\.\*', '', response)
        elif not citations and source_map:
            # If no citations found but we had sources, this is a problem
            # Add a warning or force citations
            response += f"\n\n*Note: This response should include citations to sources.*"

        return ChatResponse(
            response=response,
            citations=citations
        )

    def _build_prompt(self, query: str, context_chunks: List[ParentChunk]) -> str:
        """Legacy method - kept for compatibility but should use citation version."""
        prompt, _ = self._build_prompt_with_citations(query, context_chunks)
        return prompt
