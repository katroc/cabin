from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

class DocumentMetadata(BaseModel):
    page_title: str
    space_name: Optional[str] = None
    source_url: Optional[str] = None
    headings: Optional[List[str]] = Field(default_factory=list)
    last_modified: Optional[str] = None
    document_id: Optional[str] = None
    parent_chunk_id: Optional[str] = None
    chunk_id: Optional[str] = None
    chunk_type: Optional[str] = None

class ParentChunk(BaseModel):
    id: str
    text: str
    metadata: DocumentMetadata

class ChildChunk(BaseModel):
    id: str
    text: str
    metadata: DocumentMetadata
    parent_chunk_text: str # The full text of the parent chunk

class IngestRequest(BaseModel):
    page_title: str
    text: str # Can be HTML or Markdown
    space_name: Optional[str] = None
    source_url: Optional[str] = None
    last_modified: Optional[str] = None

class ChatRequest(BaseModel):
    message: str
    filters: Optional[Dict[str, Any]] = None

class Citation(BaseModel):
    """A citation with source information."""
    id: str  # Unique citation ID (e.g., "C1", "C2")
    page_title: str
    space_name: Optional[str] = None
    source_url: Optional[str] = None
    page_section: Optional[str] = None  # Section/heading where info came from
    last_modified: Optional[str] = None

class ChatResponse(BaseModel):
    response: str
    citations: List[Citation] = Field(default_factory=list)
    system: str = "python-gold-standard-rag"

# Data Source API Models
class DataSourceIndexRequest(BaseModel):
    """Request to index data from a data source."""
    source_type: str  # confluence, github, notion, etc.
    connection: Dict[str, Any]  # Connection configuration
    source_ids: List[str] = Field(default_factory=list)  # Specific sources to index (spaces, repos, etc.)
    config: Dict[str, Any] = Field(default_factory=dict)  # Indexing configuration

class DataSourceDiscoveryRequest(BaseModel):
    """Request to discover available sources."""
    source_type: str
    connection: Dict[str, Any]

class DataSourceTestRequest(BaseModel):
    """Request to test a data source connection."""
    source_type: str
    connection: Dict[str, Any]

class DataSourceIndexResponse(BaseModel):
    """Response from starting an indexing job."""
    job_id: str
    status: str
    message: str

class DataSourceProgressResponse(BaseModel):
    """Progress information for an indexing job."""
    job_id: str
    status: str  # pending, running, completed, failed
    total_items: int = 0
    processed_items: int = 0
    current_item: Optional[str] = None
    error_message: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime] = None

class DataSourceInfoResponse(BaseModel):
    """Information about available data sources."""
    available_sources: List[Dict[str, Any]]
