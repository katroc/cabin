import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import yaml
except ModuleNotFoundError as exc:  # pragma: no cover - import guard
    raise ModuleNotFoundError(
        "PyYAML is required to load application configuration. Install it via 'pip install pyyaml'."
    ) from exc
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings


logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_APP_CONFIG_PATH = "config/app.yaml"


class FeatureFlags(BaseModel):
    rag_provenance_lock: bool = Field(True, alias="FEATURE_RAG_PROVENANCE_LOCK")
    reranker: bool = Field(True, alias="FEATURE_RERANKER")
    early_reranker: bool = Field(True, alias="FEATURE_EARLY_RERANKER")
    heuristic_fallback: bool = Field(True, alias="FEATURE_HEURISTIC_FALLBACK")

    class Config:
        allow_population_by_field_name = True
        extra = "ignore"

    def copy_with_overrides(self, **overrides: Optional[bool]) -> "FeatureFlags":
        data = self.dict()
        for key, value in overrides.items():
            if value is not None:
                data[key] = value
        return FeatureFlags(**data)


class IngestionSettings(BaseModel):
    chunk_size_tokens: int = 250
    chunk_stride_tokens: int = 75
    drop_labels: List[str] = Field(default_factory=lambda: ["template", "archive", "index"])
    drop_boilerplate: bool = True
    dedup_enabled: bool = True
    dedup_method: str = "minhash"
    dedup_threshold: float = 0.92
    max_html_chars: int = 500_000

    class Config:
        extra = "ignore"


class RetrievalSettings(BaseModel):
    dense_k: int = 80
    lexical_backend: str = "bm25"
    lexical_k: int = 80
    rrf_k: int = 60
    mmr_lambda: float = 0.5
    cosine_floor: float = 0.05
    min_keyword_overlap: int = 2
    final_passages: int = 8

    class Config:
        extra = "ignore"


class RerankerSettings(BaseModel):
    url: str = "http://localhost:8002/rerank"
    top_n: int = 8
    timeout_s: int = 8
    model: str = ""  # Auto-discovered from reranker service
    api_key: Optional[str] = None
    # Pool size for early reranking (before MMR selection)
    pool_size_multiplier: int = 3
    # Weight for combining fusion and reranker scores (0.0 = all fusion, 1.0 = all reranker)
    score_weight: float = 0.7

    class Config:
        extra = "ignore"


class GenerationSettings(BaseModel):
    max_citations: int = 3
    require_quotes: bool = True
    quote_max_words: int = 12
    max_tokens: int = 8000
    streaming_max_tokens: int = 8000
    rephrasing_max_tokens: int = 4000

    class Config:
        extra = "ignore"


class VerificationSettings(BaseModel):
    fuzzy_partial_ratio_min: int = 90

    class Config:
        extra = "ignore"


class EmbeddingCacheSettings(BaseModel):
    enabled: bool = True
    max_items: int = 512
    ttl_seconds: int = 600

    class Config:
        extra = "ignore"


class TelemetrySettings(BaseModel):
    log_level: str = "INFO"
    metrics_enabled: bool = True

    class Config:
        extra = "ignore"


class UISettings(BaseModel):
    # LLM Provider
    llm_base_url: str = "http://localhost:8000/v1"
    llm_model: str = ""
    llm_api_key: str = "dummy-key"
    temperature: float = 0.1

    # Embedding Provider
    embedding_base_url: str = ""
    embedding_model: str = ""
    embedding_api_key: str = ""
    embedding_dimensions: int = 256
    embedding_batch_size: int = 16

    # Generation Settings
    max_tokens: int = 8000
    streaming_max_tokens: int = 8000
    rephrasing_max_tokens: int = 4000
    max_citations: int = 3
    require_quotes: bool = True
    quote_max_words: int = 12

    # Vector Database
    chroma_host: str = "localhost"
    chroma_port: int = 8100

    # Retrieval - Basic
    final_passages: int = 8
    cosine_floor: float = 0.05
    min_keyword_overlap: int = 2

    # Retrieval - Advanced
    dense_k: int = 80
    lexical_k: int = 80
    rrf_k: int = 60
    mmr_lambda: float = 0.5
    routing_threshold: float = 0.4
    routing_sample_size: int = 20

    # Retrieval - Features
    use_reranker: bool = True
    allow_reranker_fallback: bool = True

    # Reranker
    reranker_url: str = "http://localhost:8002/rerank"
    reranker_port: int = 8002
    reranker_timeout: int = 8
    reranker_pool_size_multiplier: int = 3
    reranker_score_weight: float = 0.7

    # Performance - Caching
    embedding_cache_enabled: bool = True
    embedding_cache_max_items: int = 512
    embedding_cache_ttl_seconds: int = 600

    # Performance - Processing
    chunk_size_tokens: int = 250
    chunk_stride_tokens: int = 75
    max_html_chars: int = 500000

    # Security
    drop_boilerplate: bool = True
    drop_labels: List[str] = Field(default_factory=lambda: ["template", "archive", "index"])

    # Advanced - Deduplication
    dedup_enabled: bool = True
    dedup_method: str = "minhash"
    dedup_threshold: float = 0.92

    # Advanced - Verification
    fuzzy_partial_ratio_min: int = 70

    # System
    log_level: str = "INFO"
    max_memory_messages: int = 8
    metrics_enabled: bool = True

    class Config:
        extra = "ignore"


class AppConfig(BaseModel):
    features: FeatureFlags = Field(default_factory=FeatureFlags)
    ingestion: IngestionSettings = Field(default_factory=IngestionSettings)
    retrieval: RetrievalSettings = Field(default_factory=RetrievalSettings)
    reranker: RerankerSettings = Field(default_factory=RerankerSettings)
    generation: GenerationSettings = Field(default_factory=GenerationSettings)
    verification: VerificationSettings = Field(default_factory=VerificationSettings)
    embedding_cache: EmbeddingCacheSettings = Field(default_factory=EmbeddingCacheSettings)
    telemetry: TelemetrySettings = Field(default_factory=TelemetrySettings)
    ui_settings: UISettings = Field(default_factory=UISettings)

    class Config:
        extra = "ignore"

    def with_feature_overrides(self, overrides: Dict[str, Optional[bool]]) -> "AppConfig":
        active_overrides = {k: v for k, v in overrides.items() if v is not None}
        if not active_overrides:
            return self
        updated_features = self.features.copy_with_overrides(**active_overrides)
        return self.copy(update={"features": updated_features})


def _resolve_config_path(path_str: str) -> Path:
    candidate = Path(path_str).expanduser()
    if not candidate.is_absolute():
        candidate = (PROJECT_ROOT / candidate).resolve()
    return candidate


def _load_app_config(path: Path) -> AppConfig:
    if not path.exists():
        logger.warning("App config file %s not found; using defaults", path)
        return AppConfig()
    try:
        with path.open("r", encoding="utf-8") as handle:
            raw: Dict[str, Any] = yaml.safe_load(handle) or {}
    except Exception as exc:  # pragma: no cover - configuration failures are fatal
        logger.error("Failed to load app config from %s: %s", path, exc)
        raise
    return AppConfig(**raw)


@lru_cache(maxsize=4)
def _load_app_config_cached(resolved_path: str) -> AppConfig:
    return _load_app_config(Path(resolved_path))


def get_app_config(path_str: str) -> AppConfig:
    resolved = _resolve_config_path(path_str)
    return _load_app_config_cached(str(resolved))


def save_ui_settings_to_yaml(ui_settings_payload: 'UISettingsPayload', path_str: str = None) -> None:
    """Save UI settings back to the YAML configuration file."""
    import tempfile
    import shutil
    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from .main import UISettingsPayload

    if path_str is None:
        path_str = settings.app_config_path

    config_path = _resolve_config_path(path_str)

    # Create backup first
    backup_path = config_path.with_suffix('.yaml.backup')
    if config_path.exists():
        shutil.copy2(config_path, backup_path)

    try:
        # Load existing config
        if config_path.exists():
            with config_path.open("r", encoding="utf-8") as handle:
                config_data: Dict[str, Any] = yaml.safe_load(handle) or {}
        else:
            config_data = {}

        # Convert UISettingsPayload to dict with snake_case keys
        ui_data = {
            # LLM Provider
            "llm_base_url": ui_settings_payload.llm_base_url,
            "llm_model": ui_settings_payload.llm_model,
            "llm_api_key": ui_settings_payload.llm_api_key,
            "temperature": ui_settings_payload.temperature,

            # Embedding Provider
            "embedding_base_url": ui_settings_payload.embedding_base_url,
            "embedding_model": ui_settings_payload.embedding_model,
            "embedding_api_key": ui_settings_payload.embedding_api_key,
            "embedding_dimensions": ui_settings_payload.embedding_dimensions,
            "embedding_batch_size": ui_settings_payload.embedding_batch_size,

            # Generation Settings
            "max_tokens": ui_settings_payload.max_tokens,
            "streaming_max_tokens": ui_settings_payload.streaming_max_tokens,
            "rephrasing_max_tokens": ui_settings_payload.rephrasing_max_tokens,
            "max_citations": ui_settings_payload.max_citations,
            "require_quotes": ui_settings_payload.require_quotes,
            "quote_max_words": ui_settings_payload.quote_max_words,

            # Vector Database
            "chroma_host": ui_settings_payload.chroma_host,
            "chroma_port": ui_settings_payload.chroma_port,

            # Retrieval - Basic
            "final_passages": ui_settings_payload.final_passages,
            "cosine_floor": ui_settings_payload.cosine_floor,
            "min_keyword_overlap": ui_settings_payload.min_keyword_overlap,

            # Retrieval - Advanced
            "dense_k": ui_settings_payload.dense_k,
            "lexical_k": ui_settings_payload.lexical_k,
            "rrf_k": ui_settings_payload.rrf_k,
            "mmr_lambda": ui_settings_payload.mmr_lambda,
            "routing_threshold": ui_settings_payload.routing_threshold,
            "routing_sample_size": ui_settings_payload.routing_sample_size,

            # Retrieval - Features
            "use_reranker": ui_settings_payload.use_reranker,
            "allow_reranker_fallback": ui_settings_payload.allow_reranker_fallback,

            # Reranker
            "reranker_url": ui_settings_payload.reranker_url,
            "reranker_port": ui_settings_payload.reranker_port,
            "reranker_timeout": ui_settings_payload.reranker_timeout,
            "reranker_pool_size_multiplier": ui_settings_payload.reranker_pool_size_multiplier,
            "reranker_score_weight": ui_settings_payload.reranker_score_weight,

            # Performance - Caching
            "embedding_cache_enabled": ui_settings_payload.embedding_cache_enabled,
            "embedding_cache_max_items": ui_settings_payload.embedding_cache_max_items,
            "embedding_cache_ttl_seconds": ui_settings_payload.embedding_cache_ttl_seconds,

            # Performance - Processing
            "chunk_size_tokens": ui_settings_payload.chunk_size_tokens,
            "chunk_stride_tokens": ui_settings_payload.chunk_stride_tokens,
            "max_html_chars": ui_settings_payload.max_html_chars,

            # Security
            "drop_boilerplate": ui_settings_payload.drop_boilerplate,
            "drop_labels": ui_settings_payload.drop_labels,

            # Advanced - Deduplication
            "dedup_enabled": ui_settings_payload.dedup_enabled,
            "dedup_method": ui_settings_payload.dedup_method,
            "dedup_threshold": ui_settings_payload.dedup_threshold,

            # Advanced - Verification
            "fuzzy_partial_ratio_min": ui_settings_payload.fuzzy_partial_ratio_min,

            # System
            "log_level": ui_settings_payload.log_level,
            "max_memory_messages": ui_settings_payload.max_memory_messages,
            "metrics_enabled": ui_settings_payload.metrics_enabled,
        }

        # Update config with UI settings
        config_data["ui_settings"] = ui_data

        # Write to temporary file first
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.yaml') as temp_file:
            yaml.safe_dump(config_data, temp_file, default_flow_style=False, sort_keys=False)
            temp_path = temp_file.name

        # Atomically replace the original file
        shutil.move(temp_path, config_path)

        # Clear the cache so next load picks up the new settings
        _load_app_config_cached.cache_clear()

        logger.info(f"Successfully saved UI settings to {config_path}")

    except Exception as exc:
        # Restore backup if something went wrong
        if backup_path.exists():
            shutil.copy2(backup_path, config_path)
        logger.error(f"Failed to save UI settings to {config_path}: {exc}")
        raise


class Settings(BaseSettings):
    # ChromaDB Configuration
    chroma_host: str = Field("localhost", description="Hostname for ChromaDB", env="CHROMA_HOST")
    chroma_port: int = Field(8100, description="Port for ChromaDB", env="CHROMA_PORT")
    child_collection_name: str = Field("cabin_child_chunks", description="Name of the collection for child chunks")

    # LLM Provider Configuration (OpenAI-compatible)
    llm_base_url: str = Field("http://localhost:8000/v1", description="Base URL for the OpenAI-compatible LLM API")
    llm_api_key: str = Field("dummy-key", description="API key for the LLM API")
    llm_model: str = Field("", description="The model name to use for chat completions (auto-discovered if empty)")

    # Embedding Provider Configuration
    embedding_base_url: str = Field(default="", description="Base URL for the embedding API. Defaults to llm_base_url if not set.")
    embedding_api_key: str = Field(default="", description="API key for the embedding API. Defaults to llm_api_key if not set.")
    embedding_model: str = Field("", description="The model name to use for generating embeddings (auto-discovered if empty)")
    embedding_dimensions: int = Field(256, description="The dimension of the embeddings")
    embedding_batch_size: int = Field(16, description="Batch size for embedding requests")

    # RAG Pipeline Configuration
    parent_chunk_size: int = Field(4000, description="The target size for parent chunks in characters")
    child_chunk_size: int = Field(400, description="The target size for child chunks in characters")
    child_chunk_overlap: int = Field(50, description="The overlap between child chunks in characters")
    top_k: int = Field(5, description="The number of similar child chunks to retrieve")
    lexical_overlap_weight: float = Field(
        0.3,
        ge=0.0,
        le=1.0,
        description="Weight applied to lexical relevance when ranking retrieved chunks",
    )
    min_lexical_score: float = Field(
        0.1,
        ge=0.0,
        le=1.0,
        description="Minimum normalized lexical score required to keep a chunk in the result set",
    )
    stopwords_language: str = Field(
        "en",
        description="ISO 639-1/2 language code for stopword removal during lexical scoring. Leave blank to disable.",
    )
    min_token_length: int = Field(
        3,
        ge=1,
        description="Minimum token length (in characters) considered during lexical scoring",
    )

    # App configuration
    app_config_path: str = Field(
        DEFAULT_APP_CONFIG_PATH,
        description="Path to the YAML configuration file controlling ingestion/retrieval/reranker behavior.",
        env="CABIN_APP_CONFIG_PATH",
    )

    # Feature flag overrides via environment
    feature_rag_provenance_lock_override: Optional[bool] = Field(
        None, env="FEATURE_RAG_PROVENANCE_LOCK"
    )
    feature_reranker_override: Optional[bool] = Field(None, env="FEATURE_RERANKER")
    feature_heuristic_fallback_override: Optional[bool] = Field(
        None, env="FEATURE_HEURISTIC_FALLBACK"
    )

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    def resolved_app_config_path(self) -> Path:
        return _resolve_config_path(self.app_config_path)

    @property
    def app_config(self) -> AppConfig:
        base_config = get_app_config(self.app_config_path)
        overrides = {
            "rag_provenance_lock": self.feature_rag_provenance_lock_override,
            "reranker": self.feature_reranker_override,
            "heuristic_fallback": self.feature_heuristic_fallback_override,
        }
        return base_config.with_feature_overrides(overrides)

    @property
    def feature_flags(self) -> FeatureFlags:
        return self.app_config.features


# Initialize settings
settings = Settings()

# Handle default URLs and keys
if not settings.embedding_base_url:
    settings.embedding_base_url = settings.llm_base_url
if not settings.embedding_api_key:
    settings.embedding_api_key = settings.llm_api_key
