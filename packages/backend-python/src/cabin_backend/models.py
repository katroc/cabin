from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid


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

# Conversation Memory Models
class ConversationMessage(BaseModel):
    """A single message in a conversation."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    role: str  # "user" or "assistant"
    content: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    citations: List[Citation] = Field(default_factory=list)

class ConversationHistory(BaseModel):
    """Complete conversation history for a conversation ID."""
    conversation_id: str
    messages: List[ConversationMessage] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    def add_message(self, role: str, content: str, citations: List[Citation] = None) -> ConversationMessage:
        """Add a new message to the conversation."""
        message = ConversationMessage(
            role=role,
            content=content,
            citations=citations or []
        )
        self.messages.append(message)
        self.updated_at = datetime.utcnow()
        return message

    def get_context_for_llm(self, max_messages: int = 10) -> List[Dict[str, str]]:
        """Get recent conversation context formatted for LLM."""
        recent_messages = self.messages[-max_messages:] if len(self.messages) > max_messages else self.messages
        return [
            {"role": msg.role, "content": msg.content}
            for msg in recent_messages
        ]

class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None  # If None, creates new conversation
    filters: Optional[Dict[str, Any]] = None

class ChatResponse(BaseModel):
    response: str
    conversation_id: str
    citations: List[Citation] = Field(default_factory=list)
    rendered_citations: List[dict] = Field(default_factory=list)
    system: str = "python-gold-standard-rag"
    used_rag: bool = False  # Indicates whether RAG retrieval was used for this response


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

class FileUploadRequest(BaseModel):
    """Request for file upload operations."""
    upload_path: str  # Path to directory containing uploaded files
    config: Dict[str, Any] = Field(default_factory=dict)  # Upload configuration

class FileUploadResponse(BaseModel):
    """Response from file upload operations."""
    success: bool
    message: str
    files_processed: int = 0
    files_failed: int = 0
    upload_id: Optional[str] = None
