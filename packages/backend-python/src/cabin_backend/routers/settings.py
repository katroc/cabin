"""
Settings router - handles runtime settings endpoints.
"""

import logging
from typing import Any, Dict
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..config import settings, save_ui_settings_to_yaml
from ..runtime import RuntimeOverrides
from ..telemetry import setup_logging
from . import deps

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["settings"])


class UISettingsPayload(BaseModel):
    """UI settings payload with camelCase aliases for frontend compatibility."""
    # LLM Provider
    llm_base_url: str = Field(alias="llmBaseUrl")
    llm_model: str = Field(alias="llmModel")
    llm_api_key: str = Field(alias="llmApiKey", default="")
    temperature: float = Field(alias="temperature")

    # Embedding Provider
    embedding_base_url: str = Field(alias="embeddingBaseUrl")
    embedding_model: str = Field(alias="embeddingModel")
    embedding_api_key: str = Field(alias="embeddingApiKey", default="")
    embedding_dimensions: int = Field(alias="embeddingDimensions", default=256)
    embedding_batch_size: int = Field(alias="embeddingBatchSize", default=16)

    # Generation Settings
    max_tokens: int = Field(alias="maxTokens")
    streaming_max_tokens: int = Field(alias="streamingMaxTokens")
    rephrasing_max_tokens: int = Field(alias="rephrasingMaxTokens")
    max_citations: int = Field(alias="maxCitations", default=3)
    require_quotes: bool = Field(alias="requireQuotes", default=True)
    quote_max_words: int = Field(alias="quoteMaxWords", default=12)
    citation_min_score_ratio: float = Field(alias="citationMinScoreRatio", default=0.4)

    # Vector Database
    chroma_host: str = Field(alias="chromaHost")
    chroma_port: int = Field(alias="chromaPort")

    # Retrieval - Basic
    final_passages: int = Field(alias="finalPassages")
    cosine_floor: float = Field(alias="cosineFloor")
    min_keyword_overlap: int = Field(alias="minKeywordOverlap")

    # Retrieval - Advanced
    dense_k: int = Field(alias="denseK", default=80)
    lexical_k: int = Field(alias="lexicalK", default=80)
    rrf_k: int = Field(alias="rrfK", default=60)
    mmr_lambda: float = Field(alias="mmrLambda", default=0.5)

    # Retrieval - Features
    use_reranker: bool = Field(alias="useReranker")
    allow_reranker_fallback: bool = Field(alias="allowRerankerFallback")

    # Reranker
    reranker_url: str = Field(alias="rerankerUrl")
    reranker_timeout: int = Field(alias="rerankerTimeout", default=8)
    reranker_pool_size_multiplier: int = Field(alias="rerankerPoolSizeMultiplier", default=3)
    reranker_score_weight: float = Field(alias="rerankerScoreWeight", default=0.7)

    # Performance - Caching
    embedding_cache_enabled: bool = Field(alias="embeddingCacheEnabled", default=True)
    embedding_cache_max_items: int = Field(alias="embeddingCacheMaxItems", default=512)
    embedding_cache_ttl_seconds: int = Field(alias="embeddingCacheTtlSeconds", default=600)

    # Performance - Processing
    chunk_size_tokens: int = Field(alias="chunkSizeTokens", default=250)
    chunk_stride_tokens: int = Field(alias="chunkStrideTokens", default=75)
    max_html_chars: int = Field(alias="maxHtmlChars", default=500000)

    # Security
    drop_boilerplate: bool = Field(alias="dropBoilerplate", default=True)
    drop_labels: list[str] = Field(alias="dropLabels", default_factory=lambda: ["template", "archive", "index"])

    # Advanced - Deduplication
    dedup_enabled: bool = Field(alias="dedupEnabled", default=True)
    dedup_method: str = Field(alias="dedupMethod", default="minhash")
    dedup_threshold: float = Field(alias="dedupThreshold", default=0.92)

    # Advanced - Verification
    fuzzy_partial_ratio_min: int = Field(alias="fuzzyPartialRatioMin", default=70)

    # System
    log_level: str = Field(alias="logLevel")
    max_memory_messages: int = Field(alias="maxMemoryMessages")
    metrics_enabled: bool = Field(alias="metricsEnabled", default=True)

    class Config:
        populate_by_name = True

    def to_overrides(self) -> RuntimeOverrides:
        return RuntimeOverrides(
            llm_base_url=self.llm_base_url,
            llm_model=self.llm_model,
            temperature=self.temperature,
            embedding_base_url=self.embedding_base_url,
            embedding_model=self.embedding_model,
            chroma_host=self.chroma_host,
            chroma_port=self.chroma_port,
            final_passages=self.final_passages,
            cosine_floor=self.cosine_floor,
            min_keyword_overlap=self.min_keyword_overlap,
            use_reranker=self.use_reranker,
            allow_reranker_fallback=self.allow_reranker_fallback,
            reranker_url=self.reranker_url,
            log_level=self.log_level,
            max_tokens=self.max_tokens,
            streaming_max_tokens=self.streaming_max_tokens,
            rephrasing_max_tokens=self.rephrasing_max_tokens,
            citation_min_score_ratio=self.citation_min_score_ratio,
        )


def load_default_ui_settings() -> UISettingsPayload:
    """Load default UI settings from config."""
    ui_cfg = settings.app_config.ui_settings
    log_level = ui_cfg.log_level

    return UISettingsPayload(
        llmBaseUrl=ui_cfg.llm_base_url,
        llmModel=ui_cfg.llm_model,
        llmApiKey="",
        temperature=ui_cfg.temperature,
        embeddingBaseUrl=ui_cfg.embedding_base_url if ui_cfg.embedding_base_url else ui_cfg.llm_base_url,
        embeddingModel=ui_cfg.embedding_model,
        embeddingApiKey="",
        embeddingDimensions=ui_cfg.embedding_dimensions,
        embeddingBatchSize=ui_cfg.embedding_batch_size,
        maxTokens=ui_cfg.max_tokens,
        streamingMaxTokens=ui_cfg.streaming_max_tokens,
        rephrasingMaxTokens=ui_cfg.rephrasing_max_tokens,
        maxCitations=ui_cfg.max_citations,
        requireQuotes=ui_cfg.require_quotes,
        quoteMaxWords=ui_cfg.quote_max_words,
        citationMinScoreRatio=ui_cfg.citation_min_score_ratio,
        chromaHost=ui_cfg.chroma_host,
        chromaPort=ui_cfg.chroma_port,
        finalPassages=ui_cfg.final_passages,
        cosineFloor=ui_cfg.cosine_floor,
        minKeywordOverlap=ui_cfg.min_keyword_overlap,
        denseK=ui_cfg.dense_k,
        lexicalK=ui_cfg.lexical_k,
        rrfK=ui_cfg.rrf_k,
        mmrLambda=ui_cfg.mmr_lambda,
        useReranker=ui_cfg.use_reranker,
        allowRerankerFallback=ui_cfg.allow_reranker_fallback,
        rerankerUrl=ui_cfg.reranker_url,
        rerankerTimeout=ui_cfg.reranker_timeout,
        rerankerPoolSizeMultiplier=ui_cfg.reranker_pool_size_multiplier,
        rerankerScoreWeight=ui_cfg.reranker_score_weight,
        embeddingCacheEnabled=ui_cfg.embedding_cache_enabled,
        embeddingCacheMaxItems=ui_cfg.embedding_cache_max_items,
        embeddingCacheTtlSeconds=ui_cfg.embedding_cache_ttl_seconds,
        chunkSizeTokens=ui_cfg.chunk_size_tokens,
        chunkStrideTokens=ui_cfg.chunk_stride_tokens,
        maxHtmlChars=ui_cfg.max_html_chars,
        dropBoilerplate=ui_cfg.drop_boilerplate,
        dropLabels=ui_cfg.drop_labels,
        dedupEnabled=ui_cfg.dedup_enabled,
        dedupMethod=ui_cfg.dedup_method,
        dedupThreshold=ui_cfg.dedup_threshold,
        fuzzyPartialRatioMin=ui_cfg.fuzzy_partial_ratio_min,
        logLevel=log_level,
        maxMemoryMessages=ui_cfg.max_memory_messages,
        metricsEnabled=ui_cfg.metrics_enabled,
    )


@router.get("/settings")
def get_runtime_settings():
    """Get current runtime settings."""
    try:
        if deps.current_ui_settings:
            settings_dict = deps.current_ui_settings.model_dump(by_alias=True) if hasattr(deps.current_ui_settings, 'model_dump') else deps.current_ui_settings.__dict__
            return settings_dict
        else:
            return load_default_ui_settings().model_dump(by_alias=True)
    except Exception as e:
        logger.error("Error getting settings: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get settings: {e}")


@router.post("/settings")
async def update_runtime_settings(payload: UISettingsPayload):
    """Update runtime settings."""
    if not deps.chunker_service:
        raise HTTPException(status_code=503, detail="Services not available.")

    try:
        from ..vector_store import VectorStore
        from ..generator import Generator
        from ..data_sources.manager import DataSourceManager
        from ..query_router import LLMQueryRouter

        overrides = payload.to_overrides()
        setup_logging(payload.log_level)

        # Save settings to YAML
        try:
            save_ui_settings_to_yaml(payload)
            logger.info("UI settings saved to config file")
        except Exception as exc:
            logger.error("Failed to save UI settings: %s", exc)

        # Create new service instances
        new_vector_store = VectorStore(overrides=overrides)
        new_generator = Generator(overrides=overrides)
        new_data_manager = DataSourceManager(deps.chunker_service, new_vector_store)
        new_query_router = LLMQueryRouter(
            router_url="http://localhost:8000",
            confidence_threshold=0.65
        )

        # Update services
        deps.update_services(
            new_vector_store,
            new_generator,
            new_data_manager,
            new_query_router,
            payload,
            overrides,
        )

        logger.info("Runtime settings updated successfully")
        return {"success": True, "message": "Settings updated"}

    except Exception as e:
        logger.error("Error updating settings: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {e}")
