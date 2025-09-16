"""
Data source manager for handling indexing jobs and coordination between
data sources and the vector store.
"""

import asyncio
import logging
from typing import Dict, Optional, List
from datetime import datetime

from .base import (
    DataSource, DataSourceType, DataSourceConnection, IndexingConfig,
    IndexingProgress, data_source_registry
)
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

    def get_available_sources(self) -> List[Dict[str, any]]:
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
        connection_config: Dict[str, any]
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
        connection_config: Dict[str, any]
    ) -> List[Dict[str, any]]:
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
        connection_config: Dict[str, any],
        source_ids: List[str],
        indexing_config: Dict[str, any]
    ) -> str:
        """Start an indexing job."""
        try:
            # Create data source instance
            source_type_enum = DataSourceType(source_type)
            connection = DataSourceConnection(**connection_config)
            source = data_source_registry.create_source(source_type_enum, connection)

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

            processed_count = 0

            # Extract documents and process them
            async for document in source.extract_documents(source_ids, config):
                try:
                    # Convert to IngestRequest format for existing pipeline
                    ingest_request = IngestRequest(
                        page_title=document.title,
                        text=document.content,
                        space_name=document.source.metadata.get("space_name"),
                        source_url=document.source.source_url,
                        last_modified=document.source.last_modified.isoformat() if document.source.last_modified else None
                    )

                    # Process through existing chunking and vector store pipeline
                    child_chunks = self.chunker.chunk(ingest_request)
                    self.vector_store.add_documents(child_chunks)

                    processed_count += 1

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