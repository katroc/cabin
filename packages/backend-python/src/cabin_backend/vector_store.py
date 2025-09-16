import chromadb
import openai
import logging
import time
from typing import List, Dict, Any, Optional

from .config import settings
from .models import ChildChunk, ParentChunk, DocumentMetadata

logger = logging.getLogger(__name__)

class VectorStore:
    def __init__(self):
        # Initialize OpenAI client for embeddings
        self.embedding_client = openai.OpenAI(
            api_key=settings.embedding_api_key,
            base_url=settings.embedding_base_url,
        )

        # Initialize ChromaDB client and collection
        self.chroma_client = None
        self.collection = None
        self._initialize_chroma()

    def _initialize_chroma(self, max_retries: int = 3, retry_delay: float = 1.0):
        """Initialize ChromaDB client and collection with retry logic."""
        for attempt in range(max_retries):
            try:
                # Initialize ChromaDB client
                self.chroma_client = chromadb.HttpClient(
                    host=settings.chroma_host,
                    port=settings.chroma_port
                )

                # Test the connection
                self.chroma_client.heartbeat()

                # Get or create the collection
                self.collection = self.chroma_client.get_or_create_collection(
                    name=settings.child_collection_name
                )

                logger.info(f"ChromaDB connection established successfully (attempt {attempt + 1}/{max_retries})")
                return

            except Exception as e:
                logger.warning(f"ChromaDB connection attempt {attempt + 1}/{max_retries} failed: {e}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay * (2 ** attempt))  # Exponential backoff
                else:
                    logger.error("Failed to establish ChromaDB connection after all retries")
                    raise

    def _ensure_connection(self):
        """Ensure ChromaDB connection is active, reconnect if necessary."""
        try:
            # Test the connection
            if self.chroma_client and self.collection:
                self.chroma_client.heartbeat()
                # Test collection access
                self.collection.count()
                return
        except Exception as e:
            logger.warning(f"ChromaDB connection lost: {e}. Attempting to reconnect...")

        # Reconnect
        try:
            self._initialize_chroma()
        except Exception as e:
            logger.error(f"Failed to reconnect to ChromaDB: {e}")
            raise ConnectionError(f"ChromaDB connection failed: {e}")

    def add_documents(self, chunks: List[ChildChunk]):
        """Embeds and stores a list of ChildChunks in ChromaDB."""
        if not chunks:
            return

        # Ensure connection is active
        self._ensure_connection()

        ids = [chunk.id for chunk in chunks]
        documents = [chunk.text for chunk in chunks]
        metadatas = []
        for chunk in chunks:
            metadata = chunk.metadata.dict()
            # Convert lists to strings for ChromaDB compatibility
            if 'headings' in metadata and isinstance(metadata['headings'], list):
                metadata['headings'] = ' | '.join(metadata['headings'])
            metadata['parent_chunk_text'] = chunk.parent_chunk_text

            # Filter out None values as ChromaDB doesn't handle them well
            filtered_metadata = {k: v for k, v in metadata.items() if v is not None}
            metadatas.append(filtered_metadata)

        # Note: ChromaDB automatically handles embedding generation if an embedding function
        # is associated with the collection. However, managing it explicitly gives more control.
        embeddings = self._get_embeddings(documents)

        try:
            self.collection.add(
                ids=ids,
                embeddings=embeddings,
                documents=documents,
                metadatas=metadatas
            )
        except Exception as e:
            logger.error(f"Failed to add documents to ChromaDB: {e}")
            # Try to reconnect and retry once
            try:
                logger.info("Attempting to reconnect and retry document addition...")
                self._ensure_connection()
                self.collection.add(
                    ids=ids,
                    embeddings=embeddings,
                    documents=documents,
                    metadatas=metadatas
                )
                logger.info("Successfully added documents after reconnection")
            except Exception as retry_e:
                logger.error(f"Failed to add documents even after reconnection: {retry_e}")
                raise

    def query(self, query_text: str, top_k: int = settings.top_k, filters: Optional[Dict[str, Any]] = None) -> List[ParentChunk]:
        """
        Queries for child chunks and returns the corresponding parent chunks.
        This implements the core "Parent Document Retriever" logic.
        """
        # Ensure connection is active
        self._ensure_connection()

        try:
            # Check if collection has any documents
            collection_count = self.collection.count()
            if collection_count == 0:
                return []  # Return empty list if no documents indexed

            query_embedding = self._get_embeddings([query_text])[0]

            # Build query parameters
            query_params = {
                "query_embeddings": [query_embedding],
                "n_results": min(top_k, collection_count)  # Don't request more than available
            }

            # Only add where clause if filters are provided
            if filters:
                query_params["where"] = filters

            results = self.collection.query(**query_params)

        except Exception as e:
            logger.error(f"Failed to query ChromaDB: {e}")
            # Try to reconnect and retry once
            try:
                logger.info("Attempting to reconnect and retry query...")
                self._ensure_connection()

                collection_count = self.collection.count()
                if collection_count == 0:
                    return []

                query_embedding = self._get_embeddings([query_text])[0]
                query_params = {
                    "query_embeddings": [query_embedding],
                    "n_results": min(top_k, collection_count)
                }
                if filters:
                    query_params["where"] = filters

                results = self.collection.query(**query_params)
                logger.info("Successfully queried after reconnection")

            except Exception as retry_e:
                logger.error(f"Failed to query even after reconnection: {retry_e}")
                return []  # Return empty results instead of crashing

        # Process results to get unique parent chunks
        parent_chunks_map: Dict[str, ParentChunk] = {}
        
        retrieved_ids = results['ids'][0]
        retrieved_metadatas = results['metadatas'][0]

        for i, metadata in enumerate(retrieved_metadatas):
            parent_text = metadata.get("parent_chunk_text")
            if not parent_text:
                continue

            # Use parent text as a key to deduplicate
            if parent_text not in parent_chunks_map:
                # Convert headings back to list if it's a string
                headings = metadata.get("headings", [])
                if isinstance(headings, str):
                    headings = headings.split(' | ') if headings else []

                parent_metadata = DocumentMetadata(
                    page_title=metadata.get("page_title", ""),
                    space_name=metadata.get("space_name"),
                    source_url=metadata.get("source_url"),
                    headings=headings,
                    last_modified=metadata.get("last_modified"),
                )
                parent_chunks_map[parent_text] = ParentChunk(
                    id=retrieved_ids[i], # Use child id for now, can be improved
                    text=parent_text,
                    metadata=parent_metadata
                )

        return list(parent_chunks_map.values())

    def _get_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generates embeddings for a list of texts."""
        response = self.embedding_client.embeddings.create(
            input=texts,
            model=settings.embedding_model,
            dimensions=settings.embedding_dimensions
        )
        return [item.embedding for item in response.data]

    def clear_collection(self):
        """Clears all documents from the collection."""
        # Ensure connection is active
        self._ensure_connection()

        try:
            # This is a bit of a workaround as ChromaDB's delete can be complex.
            # For a full clear, deleting and recreating the collection is often easiest.
            self.chroma_client.delete_collection(name=settings.child_collection_name)
            self.collection = self.chroma_client.get_or_create_collection(
                name=settings.child_collection_name
            )
        except Exception as e:
            logger.error(f"Failed to clear collection: {e}")
            # Try to reconnect and retry once
            try:
                logger.info("Attempting to reconnect and retry collection clearing...")
                self._ensure_connection()
                self.chroma_client.delete_collection(name=settings.child_collection_name)
                self.collection = self.chroma_client.get_or_create_collection(
                    name=settings.child_collection_name
                )
                logger.info("Successfully cleared collection after reconnection")
            except Exception as retry_e:
                logger.error(f"Failed to clear collection even after reconnection: {retry_e}")
                raise

    def health_check(self) -> bool:
        """Check if the vector store is healthy and connected."""
        try:
            self._ensure_connection()
            return True
        except Exception as e:
            logger.error(f"Vector store health check failed: {e}")
            return False
