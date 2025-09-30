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
    return f"""You are a knowledgeable assistant helping users understand documentation.

**CRITICAL RULES (MUST FOLLOW):**
1. Write naturally - NO citation numbers like [1], [2] in your response
2. NO "Sources:" section or URLs - these are added automatically by the system
3. Answer the question directly first, then provide supporting details
4. Use conversation history above to understand follow-up questions

**YOUR TASK:**
Answer the user's question by synthesizing information from the context blocks [1..{total_sources}] below.
Write in your own words - don't copy-paste documentation verbatim. Make it natural and helpful.

**FORMATTING:**
- Use **headings** (## or ###) for complex topics with multiple sections
- Use **numbered lists** for step-by-step instructions or ordered processes
- Use **bullet points** for options, features, or related items
- Keep it concise for simple questions, detailed for complex workflows
- Start with the answer, then explain why or add context

**HANDLING FOLLOW-UPS:**
- "Are you sure?" → Re-examine the context and respond thoughtfully
- Clarification requests → Build on previous discussion with new details
- Related questions → Reference what was discussed before

**IF INFORMATION IS MISSING:**
Be honest about gaps and suggest what additional information would help.

---

QUESTION:
{query}

CONTEXT:
{context_blocks}

---

Write a clear, natural response. Start with the direct answer, then add details as needed. No citation markers or source listings.
"""
