"""Utilities for handling reasoning/thinking content returned by some models."""

from __future__ import annotations

import html
import re
from typing import Dict, Tuple

_RAW_THINK_BLOCK = re.compile(r"<think(?:\\s[^>]*)?>([\\s\\S]*?)</think>", re.IGNORECASE)
_ESC_THINK_BLOCK = re.compile(r"&lt;think(?:\\s[^&]*)&gt;([\\s\\S]*?)&lt;/think&gt;", re.IGNORECASE)
_RAW_OPEN_TAG = re.compile(r"<think(?:\\s[^>]*)?>", re.IGNORECASE)
_RAW_ORPHAN = re.compile(r"<think(?:\\s[^>]*)?>[\\s\\S]*$", re.IGNORECASE)
_ESC_OPEN_TAG = re.compile(r"&lt;think(?:\\s[^&]*)&gt;", re.IGNORECASE)
_ESC_ORPHAN = re.compile(r"&lt;think(?:\\s[^&]*)&gt;[\\s\\S]*$", re.IGNORECASE)


def strip_thinking(text: str) -> str:
    """Remove all <think> blocks (raw or escaped) from *text*."""
    if not text:
        return ""

    try:
        without_blocks = _RAW_THINK_BLOCK.sub("", text)
        without_blocks = _ESC_THINK_BLOCK.sub("", without_blocks)

        # Remove orphan opening tags and everything after them
        without_blocks = _RAW_ORPHAN.sub("", without_blocks)
        without_blocks = _ESC_ORPHAN.sub("", without_blocks)

        return without_blocks.strip()
    except Exception:
        return text


def split_thinking(text: str) -> Dict[str, str]:
    """Split *text* into ``thinking`` and ``answer`` components.

    ``thinking`` contains any reasoning enclosed in <think> blocks (raw or escaped).
    ``answer`` is the input with all thinking removed.
    """
    if not text:
        return {"thinking": "", "answer": ""}

    parts = []

    def _append_matches(pattern: re.Pattern[str], source: str) -> None:
        for match in pattern.finditer(source):
            if not match.group(1):
                continue
            content = match.group(1).strip()
            if pattern is _ESC_THINK_BLOCK:
                content = html.unescape(content)
            if content:
                parts.append(content)

    _append_matches(_RAW_THINK_BLOCK, text)
    _append_matches(_ESC_THINK_BLOCK, text)

    if not parts:
        # Handle orphan opening tags without a closing tag
        raw_open = _RAW_OPEN_TAG.search(text)
        if raw_open:
            trailing = text[raw_open.end():].strip()
            if trailing:
                parts.append(trailing)
        else:
            esc_open = _ESC_OPEN_TAG.search(text)
            if esc_open:
                trailing = html.unescape(text[esc_open.end():]).strip()
                if trailing:
                    parts.append(trailing)

    answer = strip_thinking(text)
    thinking = "\n\n".join(parts).strip()
    return {"thinking": thinking, "answer": answer.strip()}


FALLBACK_MESSAGE = (
    'The response was cut off while generating. Please check the "Show thinking" '
    "section for partial content, or try asking again."
)


def derive_answer_from_thinking(thinking: str, *, allow_fallback: bool = True) -> str:
    """Attempt to derive a usable answer when the final response lives inside thinking."""
    t = (thinking or "").strip()
    if not t:
        return ""

    # Heuristic 1: use the first Markdown heading onwards
    md_heading = re.search(r"^(#{1,3})\\s+.+", t, flags=re.MULTILINE)
    if md_heading and md_heading.start() < len(t):
        return t[md_heading.start():].strip()

    # Heuristic 2: look for explicit cues like "Final answer:" etc.
    cues = [
        re.compile(r"^(?:final\\s+answer|answer)\\s*:", re.IGNORECASE | re.MULTILINE),
        re.compile(r"^(?:response)\\s*:", re.IGNORECASE | re.MULTILINE),
        re.compile(r"(let\\s+me\\s+draft\\s+the\\s+response\\s*:?)", re.IGNORECASE),
    ]
    for cue in cues:
        match = cue.search(t)
        if match:
            return t[match.end():].strip()

    # Heuristic 3: already-structured bullet list
    if re.search(r"^[-*]\\s+.+", t, flags=re.MULTILINE):
        return t

    # Heuristic 4: gather factual sentences that look like the answer
    lines = [line.strip() for line in t.splitlines() if line.strip()]
    factual_lines = []

    skip_prefixes = (
        "we need", "we should", "we must", "according to", "let's", "looking at",
        "the question", "the user", "based on", "from context"
    )

    for line in lines:
        lowered = line.lower()
        if lowered.startswith(skip_prefixes):
            continue
        if re.search(r"\\[\\d+\\]", line) and len(line) > 30:
            factual_lines.append(line)
            continue
        if re.match(r"^[A-Z][a-z]+\\s+(is|provides|offers)", line) or re.match(r"^It\\s+(is|provides)", line):
            factual_lines.append(line)

    if len(factual_lines) >= 2:
        condensed = re.sub(r"\s+", " ", " ".join(factual_lines))
        return condensed.strip()

    # Heuristic 5: If substantial thinking but no clear answer, provide a helpful fallback
    if allow_fallback and len(t) > 200:
        return FALLBACK_MESSAGE

    return ""


def extract_visible_answer(raw: str) -> Tuple[str, str]:
    """Convenience wrapper returning ``(answer, thinking)`` for model output."""
    if not raw:
        return "", ""

    parts = split_thinking(raw)
    answer = parts["answer"].strip()
    thinking = parts["thinking"].strip()

    if not answer and thinking:
        derived = derive_answer_from_thinking(thinking)
        if derived:
            answer = derived.strip()

    if not answer:
        answer = raw.strip()

    return answer, thinking
