"""Prompt templates enforcing provenance-locked citation rules."""

from __future__ import annotations

from typing import Dict, List

from ..config import settings


def build_context_blocks(chunks: List[dict]) -> str:
    blocks = []
    for index, chunk in enumerate(chunks, start=1):
        block_lines = [f"[{index}]", chunk["text"], f"SOURCE: {chunk['source']}"]
        blocks.append("\n".join(block_lines))
    return "\n\n".join(blocks)


def build_generation_prompt(query: str, context_blocks: str, total_sources: int) -> str:
    return f"""You are a citations-enforcing assistant. Follow these rules strictly:

1. Use ONLY the numbered context blocks [1..{total_sources}] provided below.
2. Every factual statement MUST include an inline citation like [1] referencing the supporting block.
3. You MAY use at most {settings.app_config.generation.max_citations} distinct citations; prefer the most relevant blocks.
4. Every citation must include a direct quote from the referenced block of at most {settings.app_config.generation.quote_max_words} words.
5. If the answer cannot be found in the context, reply with "Not found in docs." and do not fabricate.

QUESTION:
{query}

CONTEXT:
{context_blocks}
"""
