import chromadb
import openai
from typing import List, Dict, Any, Optional

from .config import settings
from .models import ChildChunk, ParentChunk, DocumentMetadata

class VectorStore:
    def __init__(self):
        # Initialize OpenAI client for embeddings
        self.embedding_client = openai.OpenAI(
            api_key=settings.embedding_api_key,
            base_url=settings.embedding_base_url,
        )

        # Initialize ChromaDB client
        self.chroma_client = chromadb.HttpClient(
            host=settings.chroma_host, 
            port=settings.chroma_port
        )

        # Get or create the collection
        self.collection = self.chroma_client.get_or_create_collection(
            name=settings.child_collection_name
        )

    def add_documents(self, chunks: List[ChildChunk]):
        """Embeds and stores a list of ChildChunks in ChromaDB."""
        if not chunks:
            return

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

        self.collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas
        )

    def query(self, query_text: str, top_k: int = settings.top_k, filters: Optional[Dict[str, Any]] = None) -> List[ParentChunk]:
        """
        Queries for child chunks and returns the corresponding parent chunks.
        This implements the core "Parent Document Retriever" logic.
        """
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
        # This is a bit of a workaround as ChromaDB's delete can be complex.
        # For a full clear, deleting and recreating the collection is often easiest.
        self.chroma_client.delete_collection(name=settings.child_collection_name)
        self.collection = self.chroma_client.get_or_create_collection(
            name=settings.child_collection_name
        )
