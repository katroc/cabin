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
    return f"""You are a helpful assistant that provides natural, conversational responses based on the provided documentation.

Your task is to:
1. **Synthesize information** from the context blocks [1..{total_sources}] into a coherent, natural response
2. **Write conversationally** - avoid simply copying text verbatim from the documentation
3. **Rephrase and explain** concepts in your own words while staying accurate to the source material
4. **Provide comprehensive answers** that address the user's question thoroughly
5. **Include citations** for factual claims using [1], [2] format with direct quotes of at most {settings.app_config.generation.quote_max_words} words
6. **Use at most {settings.app_config.generation.max_citations} citations** - choose the most relevant sources

**IMPORTANT**: Always process the information through the LLM and provide a natural, human-like response. Never return raw documentation text or simply copy-paste from the sources.

If you cannot find relevant information in the context, say "I couldn't find information about that in the available documentation."

QUESTION:
{query}

CONTEXT:
{context_blocks}
"""
