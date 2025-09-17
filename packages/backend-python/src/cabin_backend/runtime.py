"""Runtime override structures for dynamic configuration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class RuntimeOverrides:
    llm_base_url: Optional[str] = None
    llm_model: Optional[str] = None
    temperature: Optional[float] = None
    embedding_base_url: Optional[str] = None
    embedding_model: Optional[str] = None
    chroma_host: Optional[str] = None
    chroma_port: Optional[int] = None
    final_passages: Optional[int] = None
    cosine_floor: Optional[float] = None
    min_keyword_overlap: Optional[int] = None
    use_reranker: Optional[bool] = None
    allow_reranker_fallback: Optional[bool] = None
    use_rm3: Optional[bool] = None
    reranker_url: Optional[str] = None
    log_level: Optional[str] = None
