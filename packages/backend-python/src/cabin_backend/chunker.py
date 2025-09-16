import uuid
from typing import List
from bs4 import BeautifulSoup
from langchain.text_splitter import RecursiveCharacterTextSplitter

from .models import ParentChunk, ChildChunk, DocumentMetadata, IngestRequest
from .config import settings

class SemanticChunker:
    def __init__(self):
        self.child_splitter = RecursiveCharacterTextSplitter(
            chunk_size=settings.child_chunk_size,
            chunk_overlap=settings.child_chunk_overlap,
            length_function=len,
            is_separator_regex=False,
        )

    def chunk(self, request: IngestRequest) -> List[ChildChunk]:
        """Chunks a document from an IngestRequest into a list of ChildChunks."""
        document_id = self._determine_document_id(request)
        parent_chunks = self._create_parent_chunks(request, document_id)
        all_child_chunks = []
        for parent in parent_chunks:
            child_chunks = self._split_parent_into_children(parent)
            all_child_chunks.extend(child_chunks)
        return all_child_chunks

    def _create_parent_chunks(self, request: IngestRequest, document_id: str) -> List[ParentChunk]:
        """Creates large, semantically meaningful parent chunks from HTML content."""
        soup = BeautifulSoup(request.text, 'html.parser')
        chunks = []
        current_content = []
        current_headings = []

        # Define tags that signal a section break
        break_tags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']

        for tag in soup.find_all(True):
            if tag.name in break_tags:
                # If we have content, save the previous chunk
                if current_content:
                    chunk_text = ' '.join(current_content).strip()
                    if chunk_text:
                        parent_id = str(uuid.uuid4())
                        metadata = self._create_metadata(
                            request,
                            document_id=document_id,
                            parent_chunk_id=parent_id,
                            chunk_id=parent_id,
                            chunk_type="parent",
                            headings=current_headings,
                        )
                        chunks.append(ParentChunk(id=parent_id, text=chunk_text, metadata=metadata))

                # Start a new chunk
                current_content = [tag.get_text(strip=True)]
                # Update headings based on hierarchy
                level = int(tag.name[1])
                current_headings = [h for h in current_headings if int(h[1]) < level] # remove deeper or same-level headings
                current_headings.append(tag.name + ": " + tag.get_text(strip=True))
            else:
                # Append content to the current chunk
                current_content.append(tag.get_text(strip=True))

        # Add the last remaining chunk
        if current_content:
            chunk_text = ' '.join(current_content).strip()
            if chunk_text:
                parent_id = str(uuid.uuid4())
                metadata = self._create_metadata(
                    request,
                    document_id=document_id,
                    parent_chunk_id=parent_id,
                    chunk_id=parent_id,
                    chunk_type="parent",
                    headings=current_headings,
                )
                chunks.append(ParentChunk(id=parent_id, text=chunk_text, metadata=metadata))

        return chunks

    def _split_parent_into_children(self, parent: ParentChunk) -> List[ChildChunk]:
        """Splits a ParentChunk into smaller ChildChunks."""
        child_texts = self.child_splitter.split_text(parent.text)
        child_chunks = []
        for text in child_texts:
            child_id = str(uuid.uuid4())
            child_metadata = parent.metadata.model_copy(update={
                "chunk_type": "child",
                "chunk_id": child_id,
            })
            child_chunks.append(ChildChunk(
                id=child_id,
                text=text,
                metadata=child_metadata,
                parent_chunk_text=parent.text
            ))
        return child_chunks

    def _create_metadata(
        self,
        request: IngestRequest,
        *,
        document_id: str,
        parent_chunk_id: str,
        chunk_id: str,
        chunk_type: str,
        headings: List[str],
    ) -> DocumentMetadata:
        """Helper to create a DocumentMetadata object."""
        return DocumentMetadata(
            page_title=request.page_title,
            space_name=request.space_name,
            source_url=request.source_url,
            headings=headings.copy(),
            last_modified=request.last_modified,
            document_id=document_id,
            parent_chunk_id=parent_chunk_id,
            chunk_id=chunk_id,
            chunk_type=chunk_type,
        )

    def _determine_document_id(self, request: IngestRequest) -> str:
        """Derives a stable document identifier for downstream metadata."""
        if request.source_url:
            return request.source_url
        return request.page_title
