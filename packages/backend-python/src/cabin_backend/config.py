from pydantic_settings import BaseSettings
from pydantic import Field

class Settings(BaseSettings):
    # ChromaDB Configuration
    chroma_host: str = Field("localhost", description="Hostname for ChromaDB")
    chroma_port: int = Field(8000, description="Port for ChromaDB")
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

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

# Initialize settings
settings = Settings()

# Handle default URLs and keys
if not settings.embedding_base_url:
    settings.embedding_base_url = settings.llm_base_url
if not settings.embedding_api_key:
    settings.embedding_api_key = settings.llm_api_key
