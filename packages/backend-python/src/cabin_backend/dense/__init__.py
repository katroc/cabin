"""Dense retrieval utilities (Chroma, embeddings, etc.)."""

from .chroma_client import ChromaCollectionManager
from .embed_index import EmbeddingClient

__all__ = ["ChromaCollectionManager", "EmbeddingClient"]
