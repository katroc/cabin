"""Render helpers for citation payloads."""

from __future__ import annotations

from typing import Iterable, List

from ..models import Citation


def render_citation_payloads(citations: Iterable[Citation]) -> List[dict]:
    payloads = []
    for index, citation in enumerate(citations, start=1):
        payloads.append(
            {
                "index": index,
                "chunk_id": citation.chunk_id,
                "title": citation.page_title,
                "url": citation.source_url,
                "quote": citation.quote,
                "space": citation.space_name,
                "page_version": citation.page_version,
            }
        )
    return payloads
