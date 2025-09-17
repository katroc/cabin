import json
import logging
import re
from typing import Any, Dict, List, Optional

from stopwordsiso import stopwords

from .config import settings
from .models import ChildChunk, ParentChunk, DocumentMetadata
from .dense import ChromaCollectionManager, EmbeddingClient
from .lexical import BM25Index
from .retriever import (
    filter_by_cosine_floor,
    filter_by_keyword_overlap,
    max_marginal_relevance,
    reciprocal_rank_fusion,
)
from .retriever.reranker_client import RerankerClient

logger = logging.getLogger(__name__)

class VectorStore:
    def __init__(self):
        self.embedding_client = EmbeddingClient(
            api_key=settings.embedding_api_key,
            base_url=settings.embedding_base_url,
            model=settings.embedding_model,
            dimensions=settings.embedding_dimensions,
            batch_size=getattr(settings, "embedding_batch_size", 16),
        )

        # Initialize managed Chroma collection
        self.chroma = ChromaCollectionManager(
            host=settings.chroma_host,
            port=settings.chroma_port,
            collection_name=settings.child_collection_name,
        )
        self._token_pattern = re.compile(r"\b[\w'-]+\b")
        self._stopwords = self._load_stopwords(settings.stopwords_language)
        self._min_token_length = settings.min_token_length
        self.bm25_index = BM25Index(
            language_stopwords=self._stopwords,
            min_token_length=self._min_token_length,
        )
        self.reranker = RerankerClient()


    def delete_document(self, document_id: str) -> None:
        """Remove all chunks associated with a document_id from the store."""
        if not document_id:
            return
        try:
            self.chroma.collection.delete(where={"document_id": document_id})
        except Exception as exc:
            logger.warning("Failed to delete document %s from Chroma: %s", document_id, exc)

    def add_documents(self, chunks: List[ChildChunk]):
        """Embeds and stores a list of ChildChunks in ChromaDB."""
        if not chunks:
            return

        ids = [chunk.id for chunk in chunks]
        documents = [chunk.text for chunk in chunks]
        metadatas = []
        for chunk in chunks:
            metadata = (
                chunk.metadata.model_dump()
                if hasattr(chunk.metadata, "model_dump")
                else chunk.metadata.dict()
            )
            metadata["parent_chunk_text"] = chunk.parent_chunk_text
            metadatas.append(self._sanitize_metadata(metadata))

        # Note: ChromaDB automatically handles embedding generation if an embedding function
        # is associated with the collection. However, managing it explicitly gives more control.
        embeddings = self._get_embeddings(documents)

        self.chroma.add(ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas)

    @staticmethod
    def _sanitize_metadata(metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Ensure metadata values conform to ChromaDB's primitive requirements."""
        sanitized: Dict[str, Any] = {}

        for key, value in metadata.items():
            if value is None:
                continue

            if isinstance(value, list):
                joined = " | ".join(str(item) for item in value if item not in (None, ""))
                if joined:
                    sanitized[key] = joined
                continue

            if isinstance(value, dict):
                # Preserve structure while meeting primitive requirements.
                sanitized[key] = json.dumps(value, sort_keys=True)
                continue

            if isinstance(value, (str, int, float, bool)):
                sanitized[key] = value
                continue

            sanitized[key] = str(value)

        return sanitized

    def query(self, query_text: str, top_k: int = settings.top_k, filters: Optional[Dict[str, Any]] = None) -> List[ParentChunk]:
        """
        Queries for child chunks and returns the corresponding parent chunks.
        This implements the core "Parent Document Retriever" logic.
        """
        logger.debug("VectorStore query received: %s", query_text)
        try:
            # Check if collection has any documents
            collection_count = self.chroma.count()
            if collection_count == 0:
                logger.warning("VectorStore empty; no documents indexed when querying '%s'", query_text)
                return []  # Return empty list if no documents indexed

            query_embedding = self._get_embeddings([query_text])[0]

            # Build query parameters
            n_results = min(top_k, collection_count)
            results = self.chroma.query(
                query_embeddings=[query_embedding],
                n_results=n_results,
                where=filters,
            )

        except Exception as e:
            logger.error("Failed to query ChromaDB for '%s': %s", query_text, e)
            return []  # Return empty results instead of crashing

        # Process results to get unique parent chunks
        parent_chunks_map: Dict[str, Dict[str, Any]] = {}

        retrieved_ids = results['ids'][0]
        retrieved_metadatas = results['metadatas'][0]
        retrieved_distances = results.get('distances') or []
        retrieved_similarities = results.get('similarities') or []

        for i, metadata in enumerate(retrieved_metadatas):
            metadata_copy = dict(metadata)
            parent_text = metadata_copy.get("parent_chunk_text")
            if not parent_text:
                continue

            document_id = (
                metadata_copy.get("document_id")
                or metadata_copy.get("source_url")
                or metadata_copy.get("page_title")
            )
            parent_chunk_id = metadata_copy.get("parent_chunk_id") or metadata_copy.get("chunk_id")
            chunk_identifier = parent_chunk_id or retrieved_ids[i]
            key = f"{document_id or ''}::{chunk_identifier or parent_text}"

            raw_headings = metadata_copy.get("headings", [])
            if isinstance(raw_headings, str):
                headings = raw_headings.split(' | ') if raw_headings else []
            elif isinstance(raw_headings, list):
                headings = [heading for heading in raw_headings if heading]
            else:
                headings = []

            metadata_copy["headings"] = headings
            metadata_copy.setdefault("chunk_id", chunk_identifier)
            metadata_copy.setdefault("document_id", document_id)

            parent_metadata = DocumentMetadata(
                page_title=metadata_copy.get("page_title", ""),
                space_name=metadata_copy.get("space_name"),
                space_key=metadata_copy.get("space_key"),
                source_url=metadata_copy.get("source_url"),
                url=metadata_copy.get("url"),
                headings=headings,
                last_modified=metadata_copy.get("last_modified"),
                document_id=document_id,
                parent_chunk_id=parent_chunk_id,
                chunk_id=chunk_identifier,
                chunk_type="parent",
                page_version=metadata_copy.get("page_version"),
                content_type=metadata_copy.get("content_type"),
                anchor_id=metadata_copy.get("anchor_id"),
            )
            parent_chunk = ParentChunk(
                id=chunk_identifier,
                text=parent_text,
                metadata=parent_metadata
            )

            embedding_score = self._calculate_embedding_score(i, retrieved_distances, retrieved_similarities)
            candidate_text = self._build_candidate_text(parent_text, metadata_copy)
            candidate_tokens = self._tokenize_text(candidate_text)

            existing = parent_chunks_map.get(key)
            if not existing or embedding_score > existing["embedding_score"]:
                parent_chunks_map[key] = {
                    "chunk": parent_chunk,
                    "metadata": metadata_copy,
                    "embedding_score": embedding_score,
                    "tokens": candidate_tokens,
                }

        if not parent_chunks_map:
            logger.warning("No parent candidates built for query '%s'", query_text)
            return []

        candidates = list(parent_chunks_map.values())

        query_tokens = self._tokenize_text(query_text)
        lexical_scores = self._calculate_lexical_scores(
            query_tokens,
            [candidate["tokens"] for candidate in candidates],
        )

        logger.debug(
            "VectorStore candidates before hygiene for '%s': %d", query_text, len(candidates)
        )

        query_term_set = set(query_tokens)

        for candidate, lexical_score in zip(candidates, lexical_scores):
            candidate["lexical_score"] = lexical_score
            candidate["combined_score"] = self._combine_scores(
                candidate["embedding_score"],
                lexical_score,
            )
            tokens_set = set(candidate["tokens"])
            candidate["keyword_overlap"] = len(query_term_set & tokens_set) if query_term_set else 0

        if query_tokens:
            filtered_candidates = [
                candidate for candidate in candidates
                if candidate["lexical_score"] >= settings.min_lexical_score
            ]
        else:
            filtered_candidates = candidates

        if not filtered_candidates:
            filtered_candidates = candidates

        active_candidates = filtered_candidates

        extracted = [
            (candidate.get("metadata", {}), candidate["chunk"])
            for candidate in active_candidates
        ]

        def _ranking_ids(entries: List[Dict[str, Any]], key_name: str) -> List[str]:
            seen: set[str] = set()
            ordered: List[str] = []
            for candidate in sorted(entries, key=lambda item: item.get(key_name, 0.0), reverse=True):
                chunk_id = candidate.get("metadata", {}).get("chunk_id") or candidate["chunk"].id
                if chunk_id in seen:
                    continue
                seen.add(chunk_id)
                ordered.append(chunk_id)
            return ordered

        dense_ranked_ids = _ranking_ids(active_candidates, "embedding_score")
        lexical_ranked_ids = _ranking_ids(active_candidates, "lexical_score")

        fusion_scores = reciprocal_rank_fusion(
            [dense_ranked_ids, lexical_ranked_ids],
            k=settings.app_config.retrieval.rrf_k,
        )

        # Apply hygiene filters
        cosine_filtered = filter_by_cosine_floor(
            fusion_scores,
            cosine_floor=settings.app_config.retrieval.cosine_floor,
        )

        keyword_candidates = {
            (meta.get("chunk_id") or chunk.id): {
                "keyword_overlap": candidate.get("keyword_overlap", 0),
                "content_type": chunk.metadata.content_type,
            }
            for candidate, (meta, chunk) in zip(active_candidates, extracted)
        }

        allowed_ids = set(
            filter_by_keyword_overlap(
                candidates=keyword_candidates,
                min_overlap=settings.app_config.retrieval.min_keyword_overlap,
                content_types_permissive=("code", "table"),
            )
        )

        filtered_scores = {
            item_id: score
            for item_id, score in cosine_filtered.items()
            if item_id in allowed_ids
        }

        if not filtered_scores:
            filtered_scores = fusion_scores

        candidates_for_mmr = sorted(
            filtered_scores.items(),
            key=lambda item: item[1],
            reverse=True,
        )

        similarity_matrix = {}
        # TODO: compute actual pairwise similarities once embedding metadata is available
        for (meta_a, chunk_a), (meta_b, chunk_b) in zip(extracted, extracted[1:]):
            key = ((meta_a.get("chunk_id") or chunk_a.id), (meta_b.get("chunk_id") or chunk_b.id))
            similarity_matrix[key] = 0.0

        selected_ids = max_marginal_relevance(
            candidates=candidates_for_mmr,
            similarity_matrix=similarity_matrix,
            lambda_param=settings.app_config.retrieval.mmr_lambda,
            limit=settings.app_config.retrieval.final_passages,
        )

        chunk_lookup = {meta.get("chunk_id") or chunk.id: chunk for meta, chunk in extracted}

        ordered_ids = selected_ids
        if settings.feature_flags.reranker:
            reranker_input = {cid: chunk_lookup[cid].text for cid in selected_ids if cid in chunk_lookup}
            reranked = self.reranker.rerank(query_text, reranker_input)
            if reranked:
                ordered_ids = [cid for cid, _ in reranked]

        selected_chunks = [chunk_lookup[cid] for cid in ordered_ids if cid in chunk_lookup]

        logger.debug(
            "VectorStore returning %d parent chunks for query '%s'",
            len(selected_chunks),
            query_text,
        )

        return selected_chunks[:top_k]

    def _get_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generates embeddings for a list of texts."""
        return self.embedding_client.embed(texts)

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
        self.bm25_index.build(corpus)
        raw_scores = self.bm25_index.scores(query_tokens)

        for idx, raw_score in zip(non_empty_indices, raw_scores):
            scores[idx] = raw_score

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
        try:
            self.chroma.reset()
        except Exception as e:
            logger.error(f"Failed to clear collection: {e}")
            raise

    def health_check(self) -> bool:
        """Check if the vector store is healthy and connected."""
        try:
            self.chroma.ensure_connection()
            self.embedding_client.health_check()
            return True
        except Exception as e:
            logger.error(f"Vector store health check failed: {e}")
            return False
