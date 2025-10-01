"""
Data source manager for handling indexing jobs and coordination between
data sources and the vector store.
"""

import asyncio
import logging
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Set

from .base import (
    DataSource, DataSourceType, DataSourceConnection, IndexingConfig,
    IndexingProgress, data_source_registry
)
from ..config import settings
from ..ingest import Deduplicator
from ..models import IngestRequest
from ..chunker import SemanticChunker
from ..vector_store import VectorStore

logger = logging.getLogger(__name__)

class DataSourceManager:
    """Manages data source operations and indexing jobs."""

    def __init__(self, chunker: SemanticChunker, vector_store: VectorStore):
        self.chunker = chunker
        self.vector_store = vector_store
        self._jobs: Dict[str, IndexingProgress] = {}
        self._running_tasks: Dict[str, asyncio.Task] = {}
        self._deduplicator = Deduplicator(
            threshold=settings.app_config.ingestion.dedup_threshold
        )

    def get_available_sources(self) -> List[Dict[str, Any]]:
        """Get information about all available data source types."""
        sources = []
        for source_type in data_source_registry.get_available_types():
            source_class = data_source_registry.get_source_class(source_type)
            if source_class:
                # Create a temporary instance to get info
                temp_source = source_class(DataSourceConnection())
                info = temp_source.get_info()
                sources.append({
                    "type": info.type,
                    "name": info.name,
                    "description": info.description,
                    "capabilities": info.capabilities,
                    "config_schema": info.config_schema,
                    "connection_required": info.connection_required
                })
        return sources

    async def test_connection(
        self,
        source_type: str,
        connection_config: Dict[str, Any]
    ) -> bool:
        """Test connection to a data source."""
        try:
            source_type_enum = DataSourceType(source_type)
            connection = DataSourceConnection(**connection_config)
            source = data_source_registry.create_source(source_type_enum, connection)

            if not source:
                return False

            return await source.test_connection()
        except Exception as e:
            logger.error(f"Connection test failed: {e}")
            return False

    async def discover_sources(
        self,
        source_type: str,
        connection_config: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Discover available sources (spaces, repos, etc.) from a data source."""
        try:
            source_type_enum = DataSourceType(source_type)
            connection = DataSourceConnection(**connection_config)
            source = data_source_registry.create_source(source_type_enum, connection)

            if not source:
                return []

            return await source.discover_sources()
        except Exception as e:
            logger.error(f"Source discovery failed: {e}")
            return []

    async def start_indexing(
        self,
        source_type: str,
        connection_config: Dict[str, Any],
        source_ids: List[str],
        indexing_config: Dict[str, Any]
    ) -> str:
        """Start an indexing job."""
        try:
            # Create data source instance
            logger.info(f"[DEBUG] DataSourceManager.start_indexing called")
            logger.info(f"[DEBUG] source_type: {source_type}")
            logger.info(f"[DEBUG] connection_config: {connection_config}")

            source_type_enum = DataSourceType(source_type)
            connection = DataSourceConnection(**connection_config)
            logger.info(f"[DEBUG] Created DataSourceConnection: {connection}")
            logger.info(f"[DEBUG] connection.additional_config: {connection.additional_config}")

            source = data_source_registry.create_source(source_type_enum, connection)
            logger.info(f"[DEBUG] Created data source instance id: {id(source) if source else None}")

            if not source:
                raise ValueError(f"Unknown source type: {source_type}")

            # Create indexing config
            config = IndexingConfig(**indexing_config)

            # Start the job
            job_id = await source.start_indexing(source_ids, config)

            # Initialize progress tracking
            progress = IndexingProgress(
                job_id=job_id,
                status="pending",
                started_at=datetime.now()
            )
            self._jobs[job_id] = progress

            # Start the indexing task
            task = asyncio.create_task(
                self._run_indexing_job(source, source_ids, config, job_id)
            )
            self._running_tasks[job_id] = task

            return job_id

        except Exception as e:
            logger.error(f"Failed to start indexing job: {e}")
            raise

    async def start_indexing_with_source(
        self,
        source: DataSource,
        source_ids: List[str],
        indexing_config: Dict[str, Any]
    ) -> str:
        """Start an indexing job with an already-created data source instance."""
        try:
            # Create indexing config
            config = IndexingConfig(**indexing_config)

            # Start the job
            job_id = await source.start_indexing(source_ids, config)

            # Initialize progress tracking
            progress = IndexingProgress(
                job_id=job_id,
                status="pending",
                started_at=datetime.now()
            )
            self._jobs[job_id] = progress

            # Start the indexing task
            task = asyncio.create_task(
                self._run_indexing_job(source, source_ids, config, job_id)
            )
            self._running_tasks[job_id] = task

            return job_id

        except Exception as e:
            logger.error(f"Failed to start indexing job with source: {e}")
            raise

    async def _run_indexing_job(
        self,
        source: DataSource,
        source_ids: List[str],
        config: IndexingConfig,
        job_id: str
    ):
        """Run an indexing job in the background."""
        try:
            # Update status to running
            if job_id in self._jobs:
                self._jobs[job_id].status = "running"

            ingestion_cfg = settings.app_config.ingestion
            drop_labels = {label.lower() for label in ingestion_cfg.drop_labels}
            stats = {
                "processed": 0,
                "skipped_label": 0,
                "skipped_boilerplate": 0,
                "dedup_dropped": 0,
                "processing_time_total": 0.0,
            }

            processed_count = 0

            # Extract documents and process them
            async for document in source.extract_documents(source_ids, config):
                try:
                    # Convert to IngestRequest format for existing pipeline
                    source_meta = document.source.metadata or {}
                    doc_meta = document.metadata or {}

                    skip_reason = self._evaluate_skip(
                        doc_meta,
                        drop_labels,
                        ingestion_cfg.drop_boilerplate,
                    )
                    if skip_reason:
                        key = f"skipped_{skip_reason}"
                        stats[key] += 1
                        logger.info(
                            "Skipping document %s due to %s filter",
                            document.id,
                            skip_reason,
                        )
                        continue

                    ingest_request = IngestRequest(
                        page_title=document.title,
                        text=document.content,
                        space_name=source_meta.get("space_name") or doc_meta.get("space_name"),
                        space_key=doc_meta.get("space_key"),
                        page_id=doc_meta.get("page_id"),
                        page_version=doc_meta.get("page_version"),
                        labels=doc_meta.get("labels", []),
                        source_url=document.source.source_url,
                        url=doc_meta.get("url") or document.source.source_url,
                        last_modified=document.source.last_modified.isoformat() if document.source.last_modified else doc_meta.get("last_modified"),
                        document_id=doc_meta.get("document_id"),
                        metadata=doc_meta,
                    )

                    if ingest_request.document_id:
                        self.vector_store.delete_document(ingest_request.document_id)

                    # Process through existing chunking and vector store pipeline
                    start_time = time.perf_counter()
                    child_chunks = self.chunker.chunk(ingest_request)

                    if settings.app_config.ingestion.dedup_enabled:
                        dedup_result = self._deduplicator.deduplicate(child_chunks)
                        child_chunks = dedup_result.kept
                        stats["dedup_dropped"] += len(dedup_result.dropped)
                        for dropped_chunk, kept_chunk, score in dedup_result.dropped:
                            logger.debug(
                                "Dedup dropped chunk %s in favour of %s (score=%.2f)",
                                dropped_chunk.id,
                                kept_chunk.id,
                                score,
                            )

                    self.vector_store.add_documents(child_chunks)
                    elapsed = time.perf_counter() - start_time

                    stats["processed"] += 1
                    stats["processing_time_total"] += elapsed

                    processed_count += 1

                    logger.debug(
                        "Indexed document %s with %d child chunks in %.3fs",
                        document.id,
                        len(child_chunks),
                        elapsed,
                    )

                    # Update progress from source if available
                    source_progress = source.get_progress(job_id)
                    if source_progress and job_id in self._jobs:
                        self._jobs[job_id] = source_progress

                except Exception as e:
                    logger.error(f"Failed to process document {document.id}: {e}")

            # Mark as completed
            if job_id in self._jobs:
                self._jobs[job_id].status = "completed"
                self._jobs[job_id].completed_at = datetime.now()
                self._jobs[job_id].processed_items = processed_count

            total_seen = stats["processed"] + stats["skipped_label"] + stats["skipped_boilerplate"]
            avg_latency = (
                stats["processing_time_total"] / stats["processed"]
                if stats["processed"]
                else 0.0
            )
            logger.info(
                "Ingestion job %s summary: total=%d processed=%d skipped_label=%d skipped_boilerplate=%d dedup_dropped=%d avg_latency=%.3fs",
                job_id,
                total_seen,
                stats["processed"],
                stats["skipped_label"],
                stats["skipped_boilerplate"],
                stats["dedup_dropped"],
                avg_latency,
            )

        except Exception as e:
            logger.error(f"Indexing job {job_id} failed: {e}")
            if job_id in self._jobs:
                self._jobs[job_id].status = "failed"
                self._jobs[job_id].error_message = str(e)
                self._jobs[job_id].completed_at = datetime.now()
        finally:
            # Clean up
            if job_id in self._running_tasks:
                del self._running_tasks[job_id]

    def get_job_progress(self, job_id: str) -> Optional[IndexingProgress]:
        """Get the progress of an indexing job."""
        return self._jobs.get(job_id)

    def get_all_jobs(self) -> List[IndexingProgress]:
        """Get all indexing jobs."""
        return list(self._jobs.values())

    def cancel_job(self, job_id: str) -> bool:
        """Cancel a running indexing job."""
        if job_id in self._running_tasks:
            task = self._running_tasks[job_id]
            task.cancel()
            if job_id in self._jobs:
                self._jobs[job_id].status = "cancelled"
                self._jobs[job_id].completed_at = datetime.now()
            return True
        return False

    # ------------------------------------------------------------------
    # Filtering helpers
    # ------------------------------------------------------------------

    def _evaluate_skip(
        self,
        metadata: Dict[str, Any],
        drop_labels: Set[str],
        drop_boilerplate: bool,
    ) -> str:
        if not metadata:
            return ""

        if drop_boilerplate and metadata.get("is_boilerplate"):
            return "boilerplate"

        labels = {label.lower() for label in metadata.get("labels", []) if label}
        if drop_labels and labels.intersection(drop_labels):
            return "label"

        return ""
