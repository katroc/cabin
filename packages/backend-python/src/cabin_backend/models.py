from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class DocumentMetadata(BaseModel):
    page_title: str
    space_name: Optional[str] = None
    source_url: Optional[str] = None
    headings: Optional[List[str]] = Field(default_factory=list)
    last_modified: Optional[str] = None
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

class ChatResponse(BaseModel):
    response: str
    system: str = "python-gold-standard-rag"
