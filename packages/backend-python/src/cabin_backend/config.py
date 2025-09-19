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
    rm3: bool = Field(False, alias="FEATURE_RM3")
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
    rm3_top_docs: int = 10
    rm3_terms: int = 10
    rm3_alpha: float = 0.4

    class Config:
        extra = "ignore"


class RerankerSettings(BaseModel):
    url: str = "http://localhost:8002/rerank"
    top_n: int = 8
    timeout_s: int = 8
    model: str = "bge-reranker-v2-m3"
    api_key: Optional[str] = None

    class Config:
        extra = "ignore"


class GenerationSettings(BaseModel):
    max_citations: int = 3
    require_quotes: bool = True
    quote_max_words: int = 12

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


class AppConfig(BaseModel):
    features: FeatureFlags = Field(default_factory=FeatureFlags)
    ingestion: IngestionSettings = Field(default_factory=IngestionSettings)
    retrieval: RetrievalSettings = Field(default_factory=RetrievalSettings)
    reranker: RerankerSettings = Field(default_factory=RerankerSettings)
    generation: GenerationSettings = Field(default_factory=GenerationSettings)
    verification: VerificationSettings = Field(default_factory=VerificationSettings)
    embedding_cache: EmbeddingCacheSettings = Field(default_factory=EmbeddingCacheSettings)
    telemetry: TelemetrySettings = Field(default_factory=TelemetrySettings)

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


class Settings(BaseSettings):
    # ChromaDB Configuration
    chroma_host: str = Field("localhost", description="Hostname for ChromaDB", env="CHROMA_HOST")
    chroma_port: int = Field(8100, description="Port for ChromaDB", env="CHROMA_PORT")
    child_collection_name: str = Field("cabin_child_chunks", description="Name of the collection for child chunks")

    # LLM Provider Configuration (OpenAI-compatible)
    llm_base_url: str = Field("http://localhost:1234/v1", description="Base URL for the OpenAI-compatible LLM API")
    llm_api_key: str = Field("dummy-key", description="API key for the LLM API")
    llm_model: str = Field("local-model", description="The model name to use for chat completions")

    # Embedding Provider Configuration
    embedding_base_url: str = Field(description="Base URL for the embedding API. Defaults to llm_base_url if not set.")
    embedding_api_key: str = Field(description="API key for the embedding API. Defaults to llm_api_key if not set.")
    embedding_model: str = Field("text-embedding-bge-m3", description="The model name to use for generating embeddings")
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
    feature_rm3_override: Optional[bool] = Field(None, env="FEATURE_RM3")
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
            "rm3": self.feature_rm3_override,
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
