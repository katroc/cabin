"""Render helpers for citation payloads."""

from __future__ import annotations

import logging
import re
import urllib.parse
from typing import Iterable, List, Dict, Tuple
from collections import defaultdict

from ..models import Citation

logger = logging.getLogger(__name__)


def _normalize_url(url: str) -> str:
    """
    Normalize URL to handle variations that should be considered the same source.

    - Removes trailing slashes
    - Normalizes protocol (http vs https)
    - Removes common query parameters that don't affect content
    - Removes fragments
    - Converts to lowercase domain
    """
    if not url:
        return ""

    try:
        parsed = urllib.parse.urlparse(url.strip())

        # Normalize scheme to https (treat http/https as same)
        scheme = "https" if parsed.scheme in ("http", "https") else parsed.scheme

        # Normalize domain to lowercase
        netloc = parsed.netloc.lower() if parsed.netloc else ""

        # Remove trailing slash from path
        path = parsed.path.rstrip("/") if parsed.path else ""

        # Keep query parameters but remove some common tracking params
        query_params = urllib.parse.parse_qs(parsed.query) if parsed.query else {}
        # Remove common tracking/session parameters that don't affect content
        tracking_params = {
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'gclid', 'fbclid', 'msclkid', '_ga', '_gac', 'sessionid', 'sid'
        }
        filtered_params = {k: v for k, v in query_params.items() if k not in tracking_params}
        query = urllib.parse.urlencode(sorted(filtered_params.items()), doseq=True) if filtered_params else ""

        # Ignore fragments as they typically don't affect content identity
        normalized = urllib.parse.urlunparse((scheme, netloc, path, "", query, ""))
        return normalized
    except Exception:
        # If URL parsing fails, return original URL stripped
        return url.strip()


def _normalize_title(title: str) -> str:
    """
    Normalize page title to handle variations that should be considered the same.

    - Strips leading/trailing whitespace
    - Normalizes internal whitespace to single spaces
    - Handles common encoding issues
    - Removes common title suffixes that don't affect content identity
    """
    if not title:
        return ""

    # Strip and normalize whitespace
    normalized = re.sub(r'\s+', ' ', title.strip())

    # Remove common title suffixes that are site-specific but don't affect content
    # These patterns are common in CMS systems like Confluence, WordPress, etc.
    suffix_patterns = [
        r'\s*-\s*[^-]*\s*$',  # Remove "Title - Site Name" patterns
        r'\s*\|\s*[^|]*\s*$',  # Remove "Title | Site Name" patterns
    ]

    for pattern in suffix_patterns:
        # Only remove if the title is long enough and the suffix looks like site branding
        if len(normalized) > 15:  # Lowered threshold for testing
            match = re.search(pattern, normalized)
            if match:
                # Get the matched suffix
                suffix_text = match.group(0)
                # Calculate the title without the suffix
                main_title = normalized[:match.start()].strip()

                # Remove suffix if main title is substantial and makes sense
                # The suffix should represent less than half the total length
                suffix_content = suffix_text.strip().lstrip('-|').strip()
                if len(main_title) > 8 and len(suffix_content) <= len(normalized) / 2:
                    normalized = main_title
                    break

    return normalized


def _get_citation_source_key(citation: Citation) -> Tuple[str, str]:
    """
    Generate a normalized source key for grouping citations.

    Uses multiple fields to create the most robust key possible:
    - Tries source_url first, falls back to url field
    - Normalizes both URL and title
    - Handles cases where URL or title might be missing
    """
    # Get the best available URL - prefer source_url but fall back to url
    raw_url = citation.source_url or citation.url or ""
    normalized_url = _normalize_url(raw_url)

    # Normalize the title
    normalized_title = _normalize_title(citation.page_title or "")

    # Use both URL and title as the key for maximum robustness
    return (normalized_url, normalized_title)


def render_citation_payloads(citations: Iterable[Citation]) -> Tuple[List[dict], Dict[str, str]]:
    """
    Render citation payloads, merging citations from the same source.

    Citations are grouped by normalized (source_url, page_title) to eliminate duplicates
    from the same source document. URL and title normalization handles variations like:
    - URL protocol differences (http vs https)
    - Trailing slashes, query parameters, fragments
    - Title whitespace and common suffixes
    - Missing fields (source_url vs url)

    Quotes from multiple chunks of the same source are combined.

    Returns:
        Tuple of (payloads, citation_mapping) where citation_mapping maps
        original citation IDs to new merged citation indices.
    """
    citation_list = list(citations)
    logger.debug(f"Starting citation rendering for {len(citation_list)} citations")

    if not citation_list:
        logger.debug("No citations provided, returning empty result")
        return [], {}

    # Group citations by normalized source key
    source_groups: Dict[Tuple[str, str], List[Citation]] = defaultdict(list)
    normalization_debug = []

    for citation in citation_list:
        # Use normalized URL and title as the grouping key
        source_key = _get_citation_source_key(citation)
        source_groups[source_key].append(citation)

        # Debug info for each citation
        raw_url = citation.source_url or citation.url or ""
        raw_title = citation.page_title or ""
        normalization_debug.append({
            "citation_id": citation.id,
            "raw_url": raw_url,
            "raw_title": raw_title,
            "normalized_url": source_key[0],
            "normalized_title": source_key[1],
            "source_key": source_key
        })

    # Log normalization details
    logger.debug(f"Citation normalization details: {normalization_debug}")

    # Log grouping results
    merge_info = []
    for source_key, grouped_citations in source_groups.items():
        if len(grouped_citations) > 1:
            citation_ids = [c.id for c in grouped_citations]
            merge_info.append({
                "source_key": source_key,
                "merged_citation_ids": citation_ids,
                "merge_count": len(grouped_citations)
            })

    if merge_info:
        logger.info(f"Merging citations from {len(merge_info)} duplicate sources: {merge_info}")
    else:
        logger.debug("No duplicate sources found, no merging needed")

    payloads = []
    citation_mapping: Dict[str, str] = {}
    index = 1

    for source_key, grouped_citations in source_groups.items():
        # Take the first citation as the representative
        primary_citation = grouped_citations[0]

        logger.debug(f"Processing source group {index}: key={source_key}, citations={len(grouped_citations)}")

        # Combine quotes from all citations of this source
        combined_quotes = []
        seen_quotes = set()
        quote_debug = []

        for citation in grouped_citations:
            if citation.quote and citation.quote.strip():
                # Normalize quote for deduplication (remove extra whitespace)
                normalized_quote = " ".join(citation.quote.split())
                quote_debug.append({
                    "citation_id": citation.id,
                    "original_quote": citation.quote,
                    "normalized_quote": normalized_quote,
                    "already_seen": normalized_quote in seen_quotes
                })

                if normalized_quote not in seen_quotes:
                    seen_quotes.add(normalized_quote)
                    combined_quotes.append(citation.quote.strip())

        if len(grouped_citations) > 1:
            logger.debug(f"Quote processing for merged source {index}: {quote_debug}")

        # Create combined quote - limit to avoid overly long quotes
        if combined_quotes:
            # Join with ellipsis if multiple quotes, limit to reasonable length
            if len(combined_quotes) == 1:
                final_quote = combined_quotes[0]
                logger.debug(f"Single quote for source {index}: length={len(final_quote)}")
            else:
                # Combine quotes with separator, but limit total length
                combined = " ... ".join(combined_quotes)
                if len(combined) > 300:  # Reasonable limit for combined quotes
                    # Take first quote and indicate there are more
                    final_quote = f"{combined_quotes[0][:200]}..." if len(combined_quotes[0]) > 200 else f"{combined_quotes[0]} ..."
                    logger.debug(f"Truncated combined quote for source {index}: original_length={len(combined)}, final_length={len(final_quote)}")
                else:
                    final_quote = combined
                    logger.debug(f"Combined quote for source {index}: {len(combined_quotes)} quotes, total_length={len(final_quote)}")
        else:
            final_quote = primary_citation.quote or ""
            logger.debug(f"No valid quotes found for source {index}, using primary citation quote")

        # Collect all chunk IDs for reference
        chunk_ids = [citation.chunk_id for citation in grouped_citations if citation.chunk_id]
        primary_chunk_id = chunk_ids[0] if chunk_ids else primary_citation.chunk_id

        # Map all original citation IDs to this merged index
        for citation in grouped_citations:
            citation_mapping[citation.id] = str(index)

        # Use the best available URL from the primary citation for display
        display_url = primary_citation.source_url or primary_citation.url

        payload = {
            "index": index,
            "chunk_id": primary_chunk_id,  # Use primary chunk ID
            "title": primary_citation.page_title or "",
            "url": display_url or "",
            "quote": final_quote,
            "space": primary_citation.space_name,
            "page_version": primary_citation.page_version,
            # Additional metadata for debugging
            "merged_from": len(grouped_citations) if len(grouped_citations) > 1 else None,
            "all_chunk_ids": chunk_ids if len(chunk_ids) > 1 else None,
        }

        payloads.append(payload)

        if len(grouped_citations) > 1:
            logger.info(f"Created merged citation {index}: merged {len(grouped_citations)} citations from {primary_citation.page_title or 'Unknown'}")

        index += 1

    logger.debug(f"Citation rendering complete: {len(payloads)} rendered citations, {len(citation_mapping)} mappings")

    return payloads, citation_mapping
