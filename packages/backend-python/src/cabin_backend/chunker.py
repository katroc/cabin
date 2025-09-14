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
        parent_chunks = self._create_parent_chunks(request)
        all_child_chunks = []
        for parent in parent_chunks:
            child_chunks = self._split_parent_into_children(parent)
            all_child_chunks.extend(child_chunks)
        return all_child_chunks

    def _create_parent_chunks(self, request: IngestRequest) -> List[ParentChunk]:
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
                        metadata = self._create_metadata(request, headings=current_headings)
                        chunks.append(ParentChunk(id=str(uuid.uuid4()), text=chunk_text, metadata=metadata))
                
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
                metadata = self._create_metadata(request, headings=current_headings)
                chunks.append(ParentChunk(id=str(uuid.uuid4()), text=chunk_text, metadata=metadata))
        
        return chunks

    def _split_parent_into_children(self, parent: ParentChunk) -> List[ChildChunk]:
        """Splits a ParentChunk into smaller ChildChunks."""
        child_texts = self.child_splitter.split_text(parent.text)
        child_chunks = []
        for text in child_texts:
            child_chunks.append(ChildChunk(
                id=str(uuid.uuid4()),
                text=text,
                metadata=parent.metadata, # Child inherits metadata from parent
                parent_chunk_text=parent.text
            ))
        return child_chunks

    def _create_metadata(self, request: IngestRequest, headings: List[str]) -> DocumentMetadata:
        """Helper to create a DocumentMetadata object."""
        return DocumentMetadata(
            page_title=request.page_title,
            space_name=request.space_name,
            source_url=request.source_url,
            headings=headings.copy(),
            last_modified=request.last_modified
        )
