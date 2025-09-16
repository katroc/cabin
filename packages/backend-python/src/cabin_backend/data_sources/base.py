"""
Base classes and interfaces for data source integrations.
Provides an MCP-like framework for pluggable data sources.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional, AsyncGenerator, Iterator
from pydantic import BaseModel, Field
from enum import Enum
import uuid
from datetime import datetime

class DataSourceType(str, Enum):
    """Supported data source types."""
    CONFLUENCE = "confluence"
    GITHUB = "github"
    NOTION = "notion"
    FILE_SYSTEM = "filesystem"
    WEB_CRAWLER = "web_crawler"

class DataSourceCapability(str, Enum):
    """Capabilities that data sources can expose."""
    SPACE_DISCOVERY = "space_discovery"  # Can discover all available spaces/repos/databases
    INCREMENTAL_SYNC = "incremental_sync"  # Supports syncing only changed content
    ATTACHMENT_SUPPORT = "attachment_support"  # Can process attachments/files
    REAL_TIME_SYNC = "real_time_sync"  # Supports webhooks/real-time updates
    SEARCH_FILTERING = "search_filtering"  # Supports server-side filtering
    METADATA_EXTRACTION = "metadata_extraction"  # Extracts rich metadata

class IndexingConfig(BaseModel):
    """Base configuration for indexing operations."""
    max_items: int = Field(default=1000, description="Maximum number of items to index")
    include_attachments: bool = Field(default=False, description="Whether to process attachments")
    incremental: bool = Field(default=False, description="Whether to perform incremental sync")
    filters: Optional[Dict[str, Any]] = Field(default=None, description="Source-specific filters")

class IndexingProgress(BaseModel):
    """Progress information for indexing operations."""
    job_id: str
    status: str  # pending, running, completed, failed
    total_items: int = 0
    processed_items: int = 0
    current_item: Optional[str] = None
    error_message: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime] = None

class DocumentSource(BaseModel):
    """Information about a document's source."""
    source_type: DataSourceType
    source_id: str  # space key, repo name, etc.
    source_url: str
    title: str
    last_modified: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

class ExtractedDocument(BaseModel):
    """A document extracted from a data source."""
    id: str
    title: str
    content: str  # HTML, Markdown, or plain text
    source: DocumentSource
    metadata: Dict[str, Any] = Field(default_factory=dict)

class DataSourceInfo(BaseModel):
    """Information about a data source's capabilities and configuration."""
    type: DataSourceType
    name: str
    description: str
    capabilities: List[DataSourceCapability]
    config_schema: Dict[str, Any]  # JSON schema for configuration
    connection_required: bool = True

class DataSourceConnection(BaseModel):
    """Connection information for a data source."""
    base_url: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    api_token: Optional[str] = None
    additional_config: Dict[str, Any] = Field(default_factory=dict)

class DataSource(ABC):
    """Abstract base class for all data source integrations."""

    def __init__(self, connection: DataSourceConnection):
        self.connection = connection
        self._job_id = None

    @abstractmethod
    def get_info(self) -> DataSourceInfo:
        """Return information about this data source."""
        pass

    @abstractmethod
    async def test_connection(self) -> bool:
        """Test if the connection to the data source is valid."""
        pass

    @abstractmethod
    async def discover_sources(self) -> List[Dict[str, Any]]:
        """
        Discover available sources (spaces, repos, databases, etc.).
        Returns a list of source identifiers that can be indexed.
        """
        pass

    @abstractmethod
    async def extract_documents(
        self,
        source_ids: List[str],
        config: IndexingConfig
    ) -> AsyncGenerator[ExtractedDocument, None]:
        """
        Extract documents from the specified sources.
        Yields documents as they are processed.
        """
        pass

    async def start_indexing(
        self,
        source_ids: List[str],
        config: IndexingConfig
    ) -> str:
        """
        Start an indexing job and return a job ID.
        This is a wrapper around extract_documents for job management.
        """
        job_id = str(uuid.uuid4())
        self._job_id = job_id
        return job_id

    def get_progress(self, job_id: str) -> Optional[IndexingProgress]:
        """Get the progress of an indexing job."""
        # Default implementation - subclasses can override for more sophisticated tracking
        if job_id != self._job_id:
            return None

        return IndexingProgress(
            job_id=job_id,
            status="running",
            started_at=datetime.now()
        )

class DataSourceRegistry:
    """Registry for managing data source implementations."""

    def __init__(self):
        self._sources: Dict[DataSourceType, type] = {}

    def register(self, source_type: DataSourceType, source_class: type):
        """Register a data source implementation."""
        self._sources[source_type] = source_class

    def get_source_class(self, source_type: DataSourceType) -> Optional[type]:
        """Get a data source class by type."""
        return self._sources.get(source_type)

    def get_available_types(self) -> List[DataSourceType]:
        """Get all registered data source types."""
        return list(self._sources.keys())

    def create_source(
        self,
        source_type: DataSourceType,
        connection: DataSourceConnection
    ) -> Optional[DataSource]:
        """Create a data source instance."""
        source_class = self.get_source_class(source_type)
        if source_class:
            return source_class(connection)
        return None

# Global registry instance
data_source_registry = DataSourceRegistry()