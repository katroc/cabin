import asyncio
import json
import logging
import re
from typing import Any, Dict, List, Optional, NamedTuple

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
from .runtime import RuntimeOverrides
from .telemetry import metrics, sanitize_text

logger = logging.getLogger(__name__)

class RoutingContext(NamedTuple):
    documents: List[str]
    strategy: str


class VectorStore:
    def __init__(self, overrides: Optional[RuntimeOverrides] = None):
        overrides = overrides or RuntimeOverrides()
        cache_cfg = settings.app_config.embedding_cache
        embedding_base = overrides.embedding_base_url or settings.embedding_base_url
        embedding_model = overrides.embedding_model or settings.embedding_model
        chroma_host = overrides.chroma_host or settings.chroma_host
        chroma_port = overrides.chroma_port or settings.chroma_port
        self.default_final_passages = overrides.final_passages or settings.app_config.retrieval.final_passages
        self.cosine_floor_default = overrides.cosine_floor if overrides.cosine_floor is not None else settings.app_config.retrieval.cosine_floor
        self.min_keyword_overlap_default = overrides.min_keyword_overlap if overrides.min_keyword_overlap is not None else settings.app_config.retrieval.min_keyword_overlap
        self.use_reranker_default = overrides.use_reranker if overrides.use_reranker is not None else settings.feature_flags.reranker
        self.allow_reranker_fallback_default = overrides.allow_reranker_fallback if overrides.allow_reranker_fallback is not None else settings.feature_flags.heuristic_fallback

        reranker_url = overrides.reranker_url or settings.app_config.reranker.url

        self.embedding_client = EmbeddingClient(
            api_key=settings.embedding_api_key,
            base_url=embedding_base,
            model=embedding_model,
            dimensions=settings.embedding_dimensions,
            batch_size=getattr(settings, "embedding_batch_size", 16),
            cache_enabled=cache_cfg.enabled,
            cache_max_items=cache_cfg.max_items,
            cache_ttl_seconds=cache_cfg.ttl_seconds,
        )

        # Initialize managed Chroma collection
        self.chroma = ChromaCollectionManager(
            host=chroma_host,
            port=chroma_port,
            collection_name=settings.child_collection_name,
        )
        self._token_pattern = re.compile(r"\b[\w'-]+\b")
        self._stopwords = self._load_stopwords(settings.stopwords_language)
        self._min_token_length = settings.min_token_length
        self.bm25_index = BM25Index(
            language_stopwords=self._stopwords,
            min_token_length=self._min_token_length,
        )
        self.reranker = RerankerClient(base_url=reranker_url)
        self._last_lexical_rankings: List[Dict[str, Any]] = []
        # Cache for recent query results to avoid duplicate expensive operations
        self._query_cache: Dict[str, Dict[str, Any]] = {}
        self._query_cache_ttl = 30  # seconds
        # BM25 index needs to be kept in sync with ChromaDB
        self._bm25_needs_rebuild = True
        self._bm25_corpus_cache: List[Dict[str, Any]] = []


    def delete_document(self, document_id: str) -> None:
        """Remove all chunks associated with a document_id from the store."""
        if not document_id:
            return
        try:
            self.chroma.collection.delete(where={"document_id": document_id})
            # Mark BM25 index for rebuild after deletion
            self._bm25_needs_rebuild = True
            logger.debug("Marked BM25 index for rebuild after deleting document %s", document_id)
        except Exception as exc:
            logger.warning("Failed to delete document %s from Chroma: %s", document_id, exc)

    def add_documents(self, chunks: List[ChildChunk]):
        """Embeds and stores a list of ChildChunks in ChromaDB."""
        if not chunks:
            return

        # Process chunks in smaller batches to avoid ChromaDB payload size limits
        batch_size = 50  # Reduced batch size to prevent 413 Payload Too Large errors

        for i in range(0, len(chunks), batch_size):
            batch_chunks = chunks[i:i + batch_size]
            logger.info(f"Processing batch {i // batch_size + 1}/{(len(chunks) + batch_size - 1) // batch_size} ({len(batch_chunks)} chunks)")

            ids = [chunk.id for chunk in batch_chunks]
            documents = [chunk.text for chunk in batch_chunks]
            metadatas = []
            for chunk in batch_chunks:
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

            try:
                self.chroma.add(ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas)
                logger.info(f"Successfully added batch of {len(batch_chunks)} chunks")
            except Exception as e:
                logger.error(f"Failed to add batch of {len(batch_chunks)} chunks: {e}")
                # Try with even smaller batch if this one fails
                if len(batch_chunks) > 1:
                    logger.info("Retrying with individual chunks...")
                    for chunk in batch_chunks:
                        try:
                            single_metadata = (
                                chunk.metadata.model_dump()
                                if hasattr(chunk.metadata, "model_dump")
                                else chunk.metadata.dict()
                            )
                            single_metadata["parent_chunk_text"] = chunk.parent_chunk_text
                            single_embedding = self._get_embeddings([chunk.text])
                            self.chroma.add(
                                ids=[chunk.id],
                                embeddings=single_embedding,
                                documents=[chunk.text],
                                metadatas=[self._sanitize_metadata(single_metadata)]
                            )
                            logger.info(f"Successfully added individual chunk: {chunk.id}")
                        except Exception as single_e:
                            logger.error(f"Failed to add individual chunk {chunk.id}: {single_e}")
                else:
                    raise e

        # Mark BM25 index for rebuild after adding documents
        self._bm25_needs_rebuild = True
        logger.debug("Marked BM25 index for rebuild after adding %d chunks", len(chunks))

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

    async def query_async(
        self,
        query_text: str,
        top_k: Optional[int] = None,
        filters: Optional[Dict[str, Any]] = None,
        *,
        use_reranker: Optional[bool] = None,
        allow_reranker_fallback: Optional[bool] = None,
    ) -> List[ParentChunk]:
        """
        Async version of query with parallel embedding + BM25 index preparation.
        Queries for child chunks and returns the corresponding parent chunks.
        """
        query_preview = sanitize_text(query_text[:64].replace("\n", " "))
        logger.debug(
            "VectorStore async query received (len=%d): %s", len(query_text), query_preview
        )
        metrics.increment("retrieval.vector_store.calls")
        metrics.increment("retrieval.vector_store.async_calls")
        self._last_lexical_rankings = []

        # Create cache key
        cache_key = f"{query_text}:{top_k}:{str(filters)}:{use_reranker}:{allow_reranker_fallback}"

        # Check cache first
        import time
        current_time = time.time()
        if cache_key in self._query_cache:
            cached_result = self._query_cache[cache_key]
            if current_time - cached_result['timestamp'] < self._query_cache_ttl:
                logger.debug("Using cached query result for: %s", query_preview)
                metrics.increment("retrieval.vector_store.cache_hit")
                return cached_result['chunks']

        with metrics.timer("retrieval.vector_store.query_time", query=query_text):
            try:
                collection_count = self.chroma.count()
                if collection_count == 0:
                    logger.warning(
                        "VectorStore empty; no documents indexed (len=%d, preview=%s)",
                        len(query_text),
                        query_preview,
                    )
                    metrics.increment("retrieval.vector_store.empty")
                    return []

                # PARALLEL OPTIMIZATION: Run embedding and BM25 index building concurrently
                # This saves ~50-100ms by doing both operations at the same time
                embedding_future = asyncio.create_task(
                    self.embedding_client.embed_async([query_text])
                )
                bm25_future = asyncio.create_task(
                    asyncio.to_thread(self._ensure_bm25_index)
                )

                # Wait for both to complete
                await asyncio.gather(embedding_future, bm25_future)

            except Exception as e:
                logger.error(
                    "Failed to prepare async query (len=%d, preview=%s): %s",
                    len(query_text),
                    query_preview,
                    e,
                )
                metrics.increment("retrieval.vector_store.errors")
                return []

        # Now call the synchronous query method which will use the prepared state
        # (BM25 index is already built, embedding cache is warmed up)
        result_chunks = await asyncio.to_thread(
            self.query,
            query_text,
            top_k,
            filters,
            use_reranker=use_reranker,
            allow_reranker_fallback=allow_reranker_fallback
        )

        return result_chunks

    def query(
        self,
        query_text: str,
        top_k: Optional[int] = None,
        filters: Optional[Dict[str, Any]] = None,
        *,
        use_reranker: Optional[bool] = None,
        allow_reranker_fallback: Optional[bool] = None,
    ) -> List[ParentChunk]:
        """
        Queries for child chunks and returns the corresponding parent chunks.
        This implements the core "Parent Document Retriever" logic.
        """
        query_preview = sanitize_text(query_text[:64].replace("\n", " "))
        logger.debug(
            "VectorStore query received (len=%d): %s", len(query_text), query_preview
        )
        metrics.increment("retrieval.vector_store.calls")
        self._last_lexical_rankings = []

        # Create cache key based on query and parameters
        cache_key = f"{query_text}:{top_k}:{str(filters)}:{use_reranker}:{allow_reranker_fallback}"

        # Check cache first
        import time
        current_time = time.time()
        if cache_key in self._query_cache:
            cached_result = self._query_cache[cache_key]
            if current_time - cached_result['timestamp'] < self._query_cache_ttl:
                logger.debug("Using cached query result for: %s", query_preview)
                metrics.increment("retrieval.vector_store.cache_hit")
                return cached_result['chunks']

        with metrics.timer("retrieval.vector_store.query_time", query=query_text):
            try:
                # Check if collection has any documents
                collection_count = self.chroma.count()
                if collection_count == 0:
                    logger.warning(
                        "VectorStore empty; no documents indexed (len=%d, preview=%s)",
                        len(query_text),
                        query_preview,
                    )
                    metrics.increment("retrieval.vector_store.empty")
                    return []  # Return empty list if no documents indexed

                query_embedding = self._get_embeddings([query_text])[0]

                # Build query parameters
                effective_top_k = top_k or self.default_final_passages
                n_results = min(effective_top_k, collection_count)
                results = self.chroma.query(
                    query_embeddings=[query_embedding],
                    n_results=n_results,
                    where=filters,
                )

            except Exception as e:
                logger.error(
                    "Failed to query ChromaDB (len=%d, preview=%s): %s",
                    len(query_text),
                    query_preview,
                    e,
                )
                metrics.increment("retrieval.vector_store.errors")
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
            logger.warning(
                "No parent candidates built (len=%d, preview=%s)",
                len(query_text),
                query_preview,
            )
            return []

        candidates = list(parent_chunks_map.values())
        all_chunk_lookup = {
            record.get("metadata", {}).get("chunk_id") or record["chunk"].id: record["chunk"]
            for record in candidates
        }

        query_tokens = self._tokenize_text(query_text)

        candidate_ids = [
            candidate.get("metadata", {}).get("chunk_id") or candidate["chunk"].id
            for candidate in candidates
        ]

        lexical_scores = self._calculate_lexical_scores(
            query_tokens,
            [candidate["tokens"] for candidate in candidates],
            candidate_ids,
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
            cosine_floor=self.cosine_floor_default,
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
                min_overlap=self.min_keyword_overlap_default,
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

        # Apply early reranking before MMR selection for better candidate selection
        reranker_enabled = self.use_reranker_default if use_reranker is None else use_reranker
        early_reranker_enabled = reranker_enabled  # Early reranking is now always enabled when reranking is enabled
        fallback_enabled = self.allow_reranker_fallback_default if allow_reranker_fallback is None else allow_reranker_fallback

        chunk_lookup = {meta.get("chunk_id") or chunk.id: chunk for meta, chunk in extracted}
        final_scores = filtered_scores

        if early_reranker_enabled and filtered_scores:
            # Take top candidates for reranking (larger pool than final selection)
            rerank_pool_size = min(
                len(filtered_scores),
                settings.app_config.reranker.top_n * settings.app_config.reranker.pool_size_multiplier
            )
            top_candidates = sorted(
                filtered_scores.items(),
                key=lambda item: item[1],
                reverse=True,
            )[:rerank_pool_size]

            # Prepare reranker input
            reranker_input = {
                cid: chunk_lookup[cid].text
                for cid, _ in top_candidates
                if cid in chunk_lookup
            }

            if reranker_input:
                reranked = self.reranker.rerank(
                    query_text,
                    reranker_input,
                    allow_fallback=fallback_enabled,
                )

                if reranked:
                    # Combine reranker scores with original fusion scores
                    reranker_scores = {cid: score for cid, score in reranked}

                    # Create hybrid scores combining fusion and reranker scores
                    hybrid_scores = {}
                    reranker_weight = settings.app_config.reranker.score_weight
                    fusion_weight = 1.0 - reranker_weight

                    for cid, fusion_score in filtered_scores.items():
                        if cid in reranker_scores:
                            # Weight reranker score according to configuration
                            hybrid_scores[cid] = fusion_weight * fusion_score + reranker_weight * reranker_scores[cid]
                        else:
                            # Keep original fusion score for non-reranked candidates
                            hybrid_scores[cid] = fusion_score

                    final_scores = hybrid_scores
                    logger.debug(
                        "Applied early reranking to %d candidates, updated %d scores (reranker_weight=%.2f)",
                        len(reranker_input),
                        len(reranker_scores),
                        reranker_weight,
                    )

        candidates_for_mmr = sorted(
            final_scores.items(),
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

        if query_tokens:
            lexical_rankings = self.bm25_index.query(query_tokens)
            self._last_lexical_rankings = [
                {
                    "chunk_id": doc_id,
                    "score": score,
                    "metadata": (all_chunk_lookup.get(doc_id) or chunk_lookup.get(doc_id)).metadata if (all_chunk_lookup.get(doc_id) or chunk_lookup.get(doc_id)) else None,
                }
                for doc_id, score in lexical_rankings
            ]
        else:
            self._last_lexical_rankings = []

        scores_for_selected = {cid: final_scores.get(cid, 0.0) for cid in selected_ids}
        max_score_value = max(scores_for_selected.values(), default=0.0)

        selected_chunks: List[ParentChunk] = []
        for rank, cid in enumerate(selected_ids, start=1):
            chunk = chunk_lookup.get(cid)
            if not chunk:
                continue
            score = scores_for_selected.get(cid, 0.0)
            chunk.metadata.relevance_score = score
            chunk.metadata.relevance_rank = rank
            chunk.metadata.relevance_score_normalized = (
                score / max_score_value if max_score_value > 0 else 1.0
            )
            selected_chunks.append(chunk)

        logger.debug(
            "VectorStore returning %d parent chunks for query '%s'",
            len(selected_chunks),
            query_text,
        )
        metrics.increment("retrieval.vector_store.selected", len(selected_chunks))

        effective_top_k = top_k or self.default_final_passages
        result_chunks = selected_chunks[:effective_top_k]

        # Cache the result
        self._query_cache[cache_key] = {
            'chunks': result_chunks,
            'timestamp': current_time
        }

        # Clean up old cache entries
        expired_keys = [k for k, v in self._query_cache.items()
                       if current_time - v['timestamp'] > self._query_cache_ttl]
        for k in expired_keys:
            del self._query_cache[k]

        return result_chunks

    def _ensure_bm25_index(self) -> None:
        """Rebuild BM25 index from ChromaDB if needed."""
        if not self._bm25_needs_rebuild:
            return

        try:
            logger.debug("Rebuilding BM25 index from ChromaDB")
            collection = self.chroma.collection
            count = collection.count()

            if count == 0:
                logger.debug("No documents in ChromaDB, BM25 index empty")
                self.bm25_index.build([], [])
                self._bm25_needs_rebuild = False
                return

            # Fetch all documents from ChromaDB
            # Use peek with limit to get all documents efficiently
            results = collection.get(limit=count, include=["documents", "metadatas"])

            if not results or not results.get('documents'):
                logger.warning("Failed to fetch documents for BM25 index rebuild")
                return

            ids = results['ids']
            documents = results['documents']
            metadatas = results.get('metadatas', [])

            # Tokenize all documents for BM25
            corpus_tokens = []
            doc_ids = []

            for i, (doc_id, text) in enumerate(zip(ids, documents)):
                if not text:
                    continue

                # Get parent_chunk_text if available for better lexical matching
                metadata = metadatas[i] if i < len(metadatas) else {}
                parent_text = metadata.get('parent_chunk_text', text)

                # Build candidate text with metadata enrichment
                candidate_text = self._build_candidate_text(parent_text, metadata)
                tokens = self._tokenize_text(candidate_text)

                if tokens:
                    corpus_tokens.append(tokens)
                    doc_ids.append(doc_id)

            # Build the BM25 index
            self.bm25_index.build(corpus_tokens, doc_ids)
            self._bm25_needs_rebuild = False
            logger.info("BM25 index rebuilt with %d documents", len(doc_ids))

        except Exception as exc:
            logger.error("Failed to rebuild BM25 index: %s", exc)
            # Don't mark as rebuilt if it failed
            raise

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
        candidate_ids: List[str],
    ) -> List[float]:
        """Calculates normalized lexical relevance scores using BM25."""
        if not candidate_tokens_list:
            return []

        scores = [0.0] * len(candidate_tokens_list)
        if not query_tokens:
            return scores

        # Ensure BM25 index is built (lazy rebuild from ChromaDB if needed)
        self._ensure_bm25_index()

        # Query the global BM25 index for scores
        # Note: This queries the entire corpus, not just candidates
        # This is correct - BM25 needs the full corpus for proper IDF calculation
        if self.bm25_index.corpus_size == 0:
            return scores

        # Get BM25 rankings for all documents in the index
        bm25_rankings = self.bm25_index.query(query_tokens)
        bm25_score_map = {doc_id: score for doc_id, score in bm25_rankings}

        # Map scores back to our candidates
        for idx, candidate_id in enumerate(candidate_ids):
            scores[idx] = bm25_score_map.get(candidate_id, 0.0)

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
            # Reset BM25 index after clearing collection
            self._bm25_needs_rebuild = True
            self.bm25_index.build([], [])  # Clear immediately
            logger.debug("Cleared BM25 index after collection reset")
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

    def last_lexical_rankings(self) -> List[Dict[str, Any]]:
        """Return lexical rankings from the most recent query call."""
        return list(self._last_lexical_rankings)

    def get_context_for_routing(self, query: str, max_samples: int = 10) -> RoutingContext:
        """
        Get relevant document context for query routing decisions.
        Uses BM25 search for relevant context, falls back to random sample.

        Args:
            query: Query to find relevant context for
            max_samples: Maximum number of document snippets to return

        Returns:
            RoutingContext containing document snippets and the sampling strategy used
        """
        try:
            configured_sample_size = settings.app_config.ui_settings.routing_sample_size
            effective_max_samples = max(1, min(max_samples, configured_sample_size)) if configured_sample_size else max_samples

            if not self.chroma:
                logger.warning("ChromaDB not available for routing context")
                return RoutingContext([], "unavailable")

            collection = self.chroma.collection
            if not collection or collection.count() == 0:
                logger.debug("No documents available for routing context")
                return RoutingContext([], "empty")

            # Try using the existing query system for context (lightweight approach)
            # Perform a small query to get potentially relevant documents
            try:
                # Use the existing query method with a small k to get relevant context
                parent_chunks = self.query(
                    query,
                    top_k=effective_max_samples,
                    use_reranker=False,
                    allow_reranker_fallback=False,
                )

                if parent_chunks:
                    # Extract text from parent chunks for context
                    context_docs = []
                    for chunk in parent_chunks[:effective_max_samples]:
                        # Use chunk text for context, truncated for efficiency
                        context_text = chunk.text[:180] + "..." if len(chunk.text) > 180 else chunk.text
                        context_docs.append(context_text)

                    if context_docs:
                        logger.debug("Found %d relevant documents for routing context via query", len(context_docs))
                        return RoutingContext(context_docs, "vector_query")

            except Exception as e:
                logger.warning("Query-based context search failed: %s", e)

            # Fallback to random corpus sample if query doesn't work
            logger.debug("Using random corpus sample for routing context")
            return RoutingContext(self.get_corpus_sample(effective_max_samples), "corpus_sample")

        except Exception as e:
            logger.error("Error getting routing context: %s", e)
            return RoutingContext([], "error")

    def get_corpus_sample(self, sample_size: int = 50) -> List[str]:
        """
        Get a representative sample of documents from the corpus for similarity comparison.

        Args:
            sample_size: Number of documents to sample

        Returns:
            List of document texts for similarity comparison
        """
        try:
            if not self.chroma:
                logger.warning("ChromaDB not available for corpus sampling")
                return []

            # Get a random sample of documents from the collection
            collection = self.chroma.collection
            if not collection:
                logger.warning("No collection available for corpus sampling")
                return []

            # Get collection count
            count = collection.count()
            if count == 0:
                logger.warning("Empty collection for corpus sampling")
                return []

            # Sample documents - use peek for random sampling
            actual_sample_size = min(sample_size, count)

            # Get random sample of documents
            results = collection.peek(limit=actual_sample_size)

            if not results or not results.get('documents'):
                logger.warning("No documents returned from corpus sampling")
                return []

            documents = results['documents']
            logger.debug("Sampled %d documents from corpus (requested %d)", len(documents), sample_size)

            return documents

        except Exception as e:
            logger.error("Error sampling corpus: %s", e)
            return []
