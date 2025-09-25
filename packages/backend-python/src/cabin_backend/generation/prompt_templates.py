"""Prompt templates enforcing provenance-locked citation rules."""

from __future__ import annotations

from typing import Dict, List

from ..config import settings


def build_context_blocks(chunks: List[dict]) -> str:
    blocks = []
    total_chars = 0
    max_context_chars = 50000  # Limit total context to ~50k characters to prevent token overflow

    for index, chunk in enumerate(chunks, start=1):
        chunk_text = chunk["text"]

        # Truncate individual chunks if they're too long
        if len(chunk_text) > 5000:
            chunk_text = chunk_text[:5000] + "... [truncated]"

        block_lines = [f"[{index}]", chunk_text, f"SOURCE: {chunk['source']}"]
        block_text = "\n".join(block_lines)

        # Check if adding this block would exceed the limit
        if total_chars + len(block_text) > max_context_chars:
            # Add a note about truncation if we're stopping early
            if index < len(chunks):
                blocks.append(f"[Note: {len(chunks) - index + 1} additional sources omitted due to length limits]")
            break

        blocks.append(block_text)
        total_chars += len(block_text) + 2  # +2 for the "\n\n" separator

    return "\n\n".join(blocks)


def build_generation_prompt(query: str, context_blocks: str, total_sources: int) -> str:
    return f"""You are a helpful assistant that provides natural, conversational responses based on the provided documentation.

**CONVERSATION CONTEXT**: You have access to the previous conversation history above. Use this context to understand follow-up questions, clarifications, and references to previous topics.

Your task is to:
1. **Consider conversation history** - If this appears to be a follow-up question, reference what was discussed previously
2. **Synthesize information** from the context blocks [1..{total_sources}] into a coherent, natural response
3. **Write conversationally** - avoid simply copying text verbatim from the documentation
4. **Rephrase and explain** concepts in your own words while staying accurate to the source material
5. **Provide comprehensive answers** that address the user's question thoroughly
6. **Write naturally** - DO NOT include any inline citations like [1], [2] in your response
7. **Focus on content** - Provide helpful, accurate information without citation markers

**CRITICAL**: Write your response in natural, flowing language without any citation numbers or markers. DO NOT include a "Sources:" section or any URLs in your response. The sources will be automatically displayed separately by the system.

**HANDLING FOLLOW-UP QUESTIONS**:
- If the user questions accuracy of previous information, acknowledge their concern and double-check against the current context
- If they ask for clarification on previous topics, refer back to the conversation while incorporating new context
- If they ask "are you sure?" or similar, review the information carefully and provide confidence level

**IMPORTANT**: Always process the information through the LLM and provide a natural, human-like response. Never return raw documentation text or simply copy-paste from the sources.

If you cannot find relevant information in the current context BUT the question relates to previous conversation, acknowledge what was discussed before and explain what additional information would be needed.

CURRENT QUESTION:
{query}

CURRENT CONTEXT:
{context_blocks}

**REMEMBER**: Your response should be clean and natural without any citation markers, URLs, or source listings. All source information will be displayed separately by the system. DO NOT add a "Sources:" section at the end of your response.
"""
