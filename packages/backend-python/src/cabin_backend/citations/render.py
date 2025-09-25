"""Render helpers for citation payloads."""

from __future__ import annotations

from typing import Iterable, List, Dict, Tuple
from collections import defaultdict

from ..models import Citation


def render_citation_payloads(citations: Iterable[Citation]) -> Tuple[List[dict], Dict[str, str]]:
    """
    Render citation payloads, merging citations from the same source.

    Citations are grouped by (source_url, page_title) to eliminate duplicates
    from the same source document. Quotes from multiple chunks of the same
    source are combined.

    Returns:
        Tuple of (payloads, citation_mapping) where citation_mapping maps
        original citation IDs to new merged citation indices.
    """
    # Group citations by source (URL + title as the key)
    source_groups: Dict[Tuple[str, str], List[Citation]] = defaultdict(list)

    for citation in citations:
        # Use URL and title as the grouping key
        source_key = (
            citation.source_url or "",
            citation.page_title or ""
        )
        source_groups[source_key].append(citation)

    payloads = []
    citation_mapping: Dict[str, str] = {}
    index = 1

    for source_key, grouped_citations in source_groups.items():
        # Take the first citation as the representative
        primary_citation = grouped_citations[0]

        # Combine quotes from all citations of this source
        combined_quotes = []
        seen_quotes = set()

        for citation in grouped_citations:
            if citation.quote and citation.quote.strip():
                # Normalize quote for deduplication (remove extra whitespace)
                normalized_quote = " ".join(citation.quote.split())
                if normalized_quote not in seen_quotes:
                    seen_quotes.add(normalized_quote)
                    combined_quotes.append(citation.quote.strip())

        # Create combined quote - limit to avoid overly long quotes
        if combined_quotes:
            # Join with ellipsis if multiple quotes, limit to reasonable length
            if len(combined_quotes) == 1:
                final_quote = combined_quotes[0]
            else:
                # Combine quotes with separator, but limit total length
                combined = " ... ".join(combined_quotes)
                if len(combined) > 300:  # Reasonable limit for combined quotes
                    # Take first quote and indicate there are more
                    final_quote = f"{combined_quotes[0][:200]}..." if len(combined_quotes[0]) > 200 else f"{combined_quotes[0]} ..."
                else:
                    final_quote = combined
        else:
            final_quote = primary_citation.quote or ""

        # Collect all chunk IDs for reference
        chunk_ids = [citation.chunk_id for citation in grouped_citations if citation.chunk_id]
        primary_chunk_id = chunk_ids[0] if chunk_ids else primary_citation.chunk_id

        # Map all original citation IDs to this merged index
        for citation in grouped_citations:
            citation_mapping[citation.id] = str(index)

        payloads.append({
            "index": index,
            "chunk_id": primary_chunk_id,  # Use primary chunk ID
            "title": primary_citation.page_title,
            "url": primary_citation.source_url,
            "quote": final_quote,
            "space": primary_citation.space_name,
            "page_version": primary_citation.page_version,
            # Additional metadata for debugging
            "merged_from": len(grouped_citations) if len(grouped_citations) > 1 else None,
            "all_chunk_ids": chunk_ids if len(chunk_ids) > 1 else None,
        })

        index += 1

    return payloads, citation_mapping
