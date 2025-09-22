"""Runtime override structures for dynamic configuration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class RuntimeOverrides:
    # General
    theme: Optional[str] = None
    log_level: Optional[str] = None
    metrics_enabled: Optional[bool] = None
    max_memory_messages: Optional[int] = None

    # AI Models - LLM Provider
    llm_base_url: Optional[str] = None
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None
    temperature: Optional[float] = None

    # AI Models - Embedding Provider
    embedding_base_url: Optional[str] = None
    embedding_model: Optional[str] = None
    embedding_api_key: Optional[str] = None
    embedding_dimensions: Optional[int] = None
    embedding_batch_size: Optional[int] = None

    # AI Models - Generation
    max_tokens: Optional[int] = None
    streaming_max_tokens: Optional[int] = None
    rephrasing_max_tokens: Optional[int] = None
    max_citations: Optional[int] = None
    require_quotes: Optional[bool] = None
    quote_max_words: Optional[int] = None

    # Retrieval - Basic
    final_passages: Optional[int] = None
    cosine_floor: Optional[float] = None
    min_keyword_overlap: Optional[int] = None

    # Retrieval - Advanced
    dense_k: Optional[int] = None
    lexical_k: Optional[int] = None
    rrf_k: Optional[int] = None
    mmr_lambda: Optional[float] = None

    # Retrieval - Features
    use_reranker: Optional[bool] = None
    allow_reranker_fallback: Optional[bool] = None
    use_rm3: Optional[bool] = None
    use_early_reranker: Optional[bool] = None

    # Retrieval - Database
    chroma_host: Optional[str] = None
    chroma_port: Optional[int] = None

    # Performance - Caching
    embedding_cache_enabled: Optional[bool] = None
    embedding_cache_max_items: Optional[int] = None
    embedding_cache_ttl_seconds: Optional[int] = None

    # Performance - Processing
    chunk_size_tokens: Optional[int] = None
    chunk_stride_tokens: Optional[int] = None
    max_html_chars: Optional[int] = None

    # Performance - Reranker
    reranker_url: Optional[str] = None
    reranker_port: Optional[int] = None
    reranker_timeout: Optional[int] = None
    reranker_pool_size_multiplier: Optional[int] = None
    reranker_score_weight: Optional[float] = None

    # Security - Privacy
    drop_boilerplate: Optional[bool] = None
    drop_labels: Optional[list] = None

    # Advanced - Deduplication
    dedup_enabled: Optional[bool] = None
    dedup_method: Optional[str] = None
    dedup_threshold: Optional[float] = None

    # Advanced - RM3
    rm3_top_docs: Optional[int] = None
    rm3_terms: Optional[int] = None
    rm3_alpha: Optional[float] = None

    # Advanced - Verification
    fuzzy_partial_ratio_min: Optional[int] = None
