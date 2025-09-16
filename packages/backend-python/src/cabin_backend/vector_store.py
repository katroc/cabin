import chromadb
import openai
import logging
import re
import time
from typing import List, Dict, Any, Optional

from rank_bm25 import BM25Okapi
from stopwordsiso import stopwords

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
        self._token_pattern = re.compile(r"\b[\w'-]+\b")
        self._stopwords = self._load_stopwords(settings.stopwords_language)
        self._min_token_length = settings.min_token_length

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
        parent_chunks_map: Dict[str, Dict[str, Any]] = {}

        retrieved_ids = results['ids'][0]
        retrieved_metadatas = results['metadatas'][0]
        retrieved_distances = results.get('distances') or []
        retrieved_similarities = results.get('similarities') or []

        for i, metadata in enumerate(retrieved_metadatas):
            parent_text = metadata.get("parent_chunk_text")
            if not parent_text:
                continue

            document_id = metadata.get("document_id") or metadata.get("source_url") or metadata.get("page_title")
            parent_chunk_id = metadata.get("parent_chunk_id") or metadata.get("chunk_id")
            chunk_identifier = parent_chunk_id or retrieved_ids[i]
            key = f"{document_id or ''}::{chunk_identifier or parent_text}"

            headings = metadata.get("headings", [])
            if isinstance(headings, str):
                headings = headings.split(' | ') if headings else []

            parent_metadata = DocumentMetadata(
                page_title=metadata.get("page_title", ""),
                space_name=metadata.get("space_name"),
                source_url=metadata.get("source_url"),
                headings=headings,
                last_modified=metadata.get("last_modified"),
                document_id=document_id,
                parent_chunk_id=parent_chunk_id,
                chunk_id=chunk_identifier,
                chunk_type="parent",
            )
            parent_chunk = ParentChunk(
                id=chunk_identifier,
                text=parent_text,
                metadata=parent_metadata
            )

            embedding_score = self._calculate_embedding_score(i, retrieved_distances, retrieved_similarities)
            candidate_text = self._build_candidate_text(parent_text, metadata)
            candidate_tokens = self._tokenize_text(candidate_text)

            existing = parent_chunks_map.get(key)
            if not existing or embedding_score > existing["embedding_score"]:
                parent_chunks_map[key] = {
                    "chunk": parent_chunk,
                    "embedding_score": embedding_score,
                    "tokens": candidate_tokens,
                }

        if not parent_chunks_map:
            return []

        candidates = list(parent_chunks_map.values())

        query_tokens = self._tokenize_text(query_text)
        lexical_scores = self._calculate_lexical_scores(
            query_tokens,
            [candidate["tokens"] for candidate in candidates],
        )

        for candidate, lexical_score in zip(candidates, lexical_scores):
            candidate["lexical_score"] = lexical_score
            candidate["combined_score"] = self._combine_scores(
                candidate["embedding_score"],
                lexical_score,
            )

        if query_tokens:
            filtered_candidates = [
                candidate for candidate in candidates
                if candidate["lexical_score"] >= settings.min_lexical_score
            ]
        else:
            filtered_candidates = candidates

        if not filtered_candidates:
            filtered_candidates = candidates

        sorted_candidates = sorted(
            filtered_candidates,
            key=lambda candidate: candidate["combined_score"],
            reverse=True,
        )

        return [candidate["chunk"] for candidate in sorted_candidates[:top_k]]

    def _get_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generates embeddings for a list of texts."""
        response = self.embedding_client.embeddings.create(
            input=texts,
            model=settings.embedding_model,
            dimensions=settings.embedding_dimensions
        )
        return [item.embedding for item in response.data]

    def _load_stopwords(self, language: Optional[str]) -> set[str]:
        """Loads stopwords for the configured language."""
        if not language:
            return set()
        try:
            return set(stopwords(language))
        except KeyError:
            logger.warning(
                "Stopword language '%s' is not supported; disabling stopword filtering.",
                language,
            )
            return set()

    def _build_candidate_text(self, parent_text: str, metadata: Dict[str, Any]) -> str:
        """Creates a lexical corpus string that includes structural metadata."""
        parts = [parent_text]

        for field in ("page_title", "space_name"):
            value = metadata.get(field)
            if value:
                parts.append(str(value))

        headings = metadata.get("headings")
        if isinstance(headings, str):
            if headings:
                parts.extend(headings.split(' | '))
        elif isinstance(headings, list):
            parts.extend([heading for heading in headings if heading])

        return " ".join(parts)

    def _tokenize_text(self, text: str) -> List[str]:
        """Tokenizes text into normalized terms for lexical scoring."""
        if not text:
            return []

        tokens = self._token_pattern.findall(text.lower())
        filtered = [
            token
            for token in tokens
            if len(token) >= self._min_token_length
            and token not in self._stopwords
            and not token.isdigit()
        ]
        return filtered

    def _calculate_lexical_scores(
        self,
        query_tokens: List[str],
        candidate_tokens_list: List[List[str]],
    ) -> List[float]:
        """Calculates normalized lexical relevance scores using BM25."""
        if not candidate_tokens_list:
            return []

        scores = [0.0] * len(candidate_tokens_list)
        if not query_tokens:
            return scores

        non_empty_indices = [
            index for index, tokens in enumerate(candidate_tokens_list) if tokens
        ]
        if not non_empty_indices:
            return scores

        corpus = [candidate_tokens_list[index] for index in non_empty_indices]
        bm25 = BM25Okapi(corpus)
        raw_scores = bm25.get_scores(query_tokens)

        if not len(raw_scores):
            return scores

        max_score = float(raw_scores.max())
        if max_score <= 0:
            return scores

        for idx, raw_score in zip(non_empty_indices, raw_scores):
            scores[idx] = float(raw_score) / max_score

        return scores

    def _combine_scores(self, embedding_score: float, lexical_score: float) -> float:
        """Combines embedding similarity and lexical relevance into a single ranking score."""
        weight = settings.lexical_overlap_weight
        embedding_component = embedding_score * (1 - weight)
        lexical_component = lexical_score * weight
        return embedding_component + lexical_component

    def _calculate_embedding_score(
        self,
        index: int,
        distances: List[List[Optional[float]]],
        similarities: List[List[Optional[float]]],
    ) -> float:
        """Normalizes embedding-based relevance scores from the vector store."""
        if similarities and similarities[0] and index < len(similarities[0]):
            similarity = similarities[0][index]
            if similarity is not None:
                return float(similarity)

        if distances and distances[0] and index < len(distances[0]):
            distance = distances[0][index]
            if distance is not None:
                # Convert distance to a bounded similarity score regardless of metric.
                return 1.0 / (1.0 + float(distance))

        return 0.0

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
