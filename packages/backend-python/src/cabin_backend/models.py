from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime


def _default_list() -> List[str]:
    return []

class DocumentMetadata(BaseModel):
    page_title: str
    space_name: Optional[str] = None
    space_key: Optional[str] = None
    source_url: Optional[str] = None
    url: Optional[str] = None
    page_id: Optional[str] = None
    page_version: Optional[int] = None
    headings: Optional[List[str]] = Field(default_factory=_default_list)
    heading_path: Optional[List[str]] = Field(default_factory=_default_list)
    anchor_id: Optional[str] = None
    labels: Optional[List[str]] = Field(default_factory=_default_list)
    content_type: Optional[str] = None
    is_boilerplate: bool = False
    last_modified: Optional[str] = None
    updated_at: Optional[datetime] = None
    document_id: Optional[str] = None
    parent_chunk_id: Optional[str] = None
    chunk_id: Optional[str] = None
    chunk_type: Optional[str] = None
    chunk_index: Optional[int] = None
    token_start: Optional[int] = None
    token_end: Optional[int] = None
    total_tokens: Optional[int] = None
    section_index: Optional[int] = None
    char_start: Optional[int] = None
    char_end: Optional[int] = None

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
    space_key: Optional[str] = None
    page_id: Optional[str] = None
    page_version: Optional[int] = None
    labels: List[str] = Field(default_factory=_default_list)
    source_url: Optional[str] = None
    url: Optional[str] = None
    last_modified: Optional[str] = None
    document_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

class ChatRequest(BaseModel):
    message: str
    filters: Optional[Dict[str, Any]] = None

class Citation(BaseModel):
    """A citation with source information."""
    id: str  # Unique citation ID (e.g., "C1", "C2")
    page_title: str
    space_name: Optional[str] = None
    space_key: Optional[str] = None
    source_url: Optional[str] = None
    url: Optional[str] = None
    chunk_id: Optional[str] = None
    page_version: Optional[int] = None
    page_section: Optional[str] = None  # Section/heading where info came from
    quote: Optional[str] = None  # Exact quote snippet used in the response
    last_modified: Optional[str] = None

class ChatResponse(BaseModel):
    response: str
    citations: List[Citation] = Field(default_factory=list)
    rendered_citations: List[dict] = Field(default_factory=list)
    system: str = "python-gold-standard-rag"


class CitationPayload(BaseModel):
    """Rendered citation payload for UI/API consumption."""

    index: int
    chunk_id: str
    title: str
    url: str
    quote: str
    space: Optional[str] = None
    page_version: Optional[int] = None

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
