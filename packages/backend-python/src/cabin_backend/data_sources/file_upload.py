"""
File upload data source implementation.
Processes uploaded documents (PDF, DOCX, Markdown, etc.) with comprehensive metadata extraction.
"""

import asyncio
import logging
import os
import shutil
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator, Dict, Any, List, Optional

from .base import (
    DataSource, DataSourceInfo, DataSourceType, DataSourceCapability,
    DataSourceConnection, IndexingConfig, ExtractedDocument, DocumentSource,
    IndexingProgress, data_source_registry
)
from .document_parsers import document_parser_registry

logger = logging.getLogger(__name__)


class FileUploadDataSource(DataSource):
    """Data source for processing uploaded files."""

    # File size limits
    MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
    MAX_FILES_PER_BATCH = 10
    MAX_TOTAL_SIZE = 200 * 1024 * 1024  # 200MB total per batch

    # Supported file extensions
    SUPPORTED_EXTENSIONS = {
        '.pdf', '.docx', '.docm', '.md', '.markdown', '.mdown', '.mkd',
        '.html', '.htm', '.txt', '.text', '.log', '.csv'
    }

    def __init__(self, connection: DataSourceConnection):
        super().__init__(connection)
        self._upload_dir = None
        self._progress: Optional[IndexingProgress] = None
        self._uploaded_files: List[Path] = []

    def get_info(self) -> DataSourceInfo:
        """Return information about the file upload data source."""
        return DataSourceInfo(
            type=DataSourceType.FILE_UPLOAD,
            name="File Upload",
            description="Upload and index documents (PDF, DOCX, Markdown, HTML, TXT)",
            capabilities=[
                DataSourceCapability.ATTACHMENT_SUPPORT,
                DataSourceCapability.METADATA_EXTRACTION,
            ],
            config_schema={
                "type": "object",
                "properties": {
                    "upload_path": {
                        "type": "string",
                        "description": "Temporary directory path for uploaded files",
                        "required": False
                    },
                    "max_file_size": {
                        "type": "integer",
                        "default": self.MAX_FILE_SIZE,
                        "description": f"Maximum file size in bytes (default: {self.MAX_FILE_SIZE})"
                    },
                    "max_files": {
                        "type": "integer",
                        "default": self.MAX_FILES_PER_BATCH,
                        "description": f"Maximum number of files per batch (default: {self.MAX_FILES_PER_BATCH})"
                    },
                    "supported_extensions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "default": list(self.SUPPORTED_EXTENSIONS),
                        "description": "Supported file extensions"
                    }
                }
            },
            connection_required=False
        )

    async def test_connection(self) -> bool:
        """Test if file upload capability is available."""
        try:
            # Check if we can create a temporary directory
            with tempfile.TemporaryDirectory() as temp_dir:
                test_file = Path(temp_dir) / "test.txt"
                test_file.write_text("test")
                return test_file.exists()
        except Exception as e:
            logger.error(f"File upload test failed: {e}")
            return False

    async def discover_sources(self) -> List[Dict[str, Any]]:
        """
        For file uploads, return information about uploaded files.
        This is called after files are uploaded to provide file information.
        """
        sources = []

        for file_path in self._uploaded_files:
            try:
                stat = file_path.stat()
                sources.append({
                    "id": str(file_path),
                    "name": file_path.name,
                    "type": "file",
                    "size": stat.st_size,
                    "extension": file_path.suffix.lower(),
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "url": f"file://{file_path}",
                    "supported": file_path.suffix.lower() in self.SUPPORTED_EXTENSIONS
                })
            except Exception as e:
                logger.warning(f"Failed to get info for {file_path}: {e}")
                sources.append({
                    "id": str(file_path),
                    "name": file_path.name,
                    "type": "file",
                    "error": str(e),
                    "supported": False
                })

        return sources

    def set_upload_directory(self, upload_dir: str) -> None:
        """Set the directory containing uploaded files."""
        self._upload_dir = Path(upload_dir)
        if self._upload_dir.exists():
            # Discover all files in the upload directory
            self._uploaded_files = []
            for file_path in self._upload_dir.rglob("*"):
                if file_path.is_file() and not file_path.name.startswith('.'):
                    self._uploaded_files.append(file_path)

    def add_uploaded_file(self, file_path: Path) -> bool:
        """
        Add a single uploaded file for processing.
        Returns True if file is valid and added, False otherwise.
        """
        try:
            # Validate file
            if not file_path.exists():
                logger.warning(f"File does not exist: {file_path}")
                return False

            if not file_path.is_file():
                logger.warning(f"Path is not a file: {file_path}")
                return False

            # Check file size
            file_size = file_path.stat().st_size
            if file_size > self.MAX_FILE_SIZE:
                logger.warning(f"File too large ({file_size} bytes): {file_path}")
                return False

            # Check extension
            if file_path.suffix.lower() not in self.SUPPORTED_EXTENSIONS:
                logger.warning(f"Unsupported file type: {file_path}")
                return False

            # Check batch limits
            if len(self._uploaded_files) >= self.MAX_FILES_PER_BATCH:
                logger.warning(f"Too many files in batch (max {self.MAX_FILES_PER_BATCH})")
                return False

            total_size = sum(f.stat().st_size for f in self._uploaded_files) + file_size
            if total_size > self.MAX_TOTAL_SIZE:
                logger.warning(f"Total batch size too large (max {self.MAX_TOTAL_SIZE} bytes)")
                return False

            self._uploaded_files.append(file_path)
            logger.info(f"Added file for processing: {file_path}")
            return True

        except Exception as e:
            logger.error(f"Failed to add uploaded file {file_path}: {e}")
            return False

    async def extract_documents(
        self,
        source_ids: List[str],
        config: IndexingConfig
    ) -> AsyncGenerator[ExtractedDocument, None]:
        """Extract documents from uploaded files."""
        try:
            # Initialize progress tracking
            if self._job_id:
                self._progress = IndexingProgress(
                    job_id=self._job_id,
                    status="running",
                    started_at=datetime.now(),
                    total_items=len(self._uploaded_files)
                )

            processed_count = 0

            # If source_ids provided, filter files
            files_to_process = self._uploaded_files
            if source_ids:
                source_paths = {Path(source_id) for source_id in source_ids}
                files_to_process = [f for f in self._uploaded_files if f in source_paths]

            # Process each file
            for file_path in files_to_process:
                if processed_count >= config.max_items:
                    break

                try:
                    # Update progress
                    if self._progress:
                        self._progress.processed_items = processed_count
                        self._progress.current_item = file_path.name

                    # Parse document
                    content, file_metadata = document_parser_registry.parse_document(file_path)

                    if not content.strip():
                        logger.warning(f"No content extracted from {file_path}")
                        continue

                    # Create document source
                    source = DocumentSource(
                        source_type=DataSourceType.FILE_UPLOAD,
                        source_id="uploaded_files",
                        source_url=f"file://{file_path}",
                        title=file_metadata.title or file_path.stem,
                        last_modified=file_metadata.modified_at,
                        metadata=file_metadata.to_dict()
                    )

                    # Create document ID
                    document_id = f"file_upload_{file_path.stem}_{uuid.uuid4().hex[:8]}"

                    # Prepare metadata for the document
                    doc_metadata = {
                        # File information
                        "filename": file_metadata.filename,
                        "file_size": file_metadata.file_size,
                        "file_extension": file_metadata.file_extension,
                        "mime_type": file_metadata.mime_type,
                        "file_path": str(file_path),

                        # Document properties
                        "title": file_metadata.title or file_path.stem,
                        "author": file_metadata.author,
                        "subject": file_metadata.subject,
                        "keywords": file_metadata.keywords,
                        "language": file_metadata.language,
                        "page_count": file_metadata.page_count,
                        "word_count": file_metadata.word_count,
                        "character_count": file_metadata.character_count,

                        # Content analysis
                        "has_images": file_metadata.has_images,
                        "has_tables": file_metadata.has_tables,
                        "heading_count": file_metadata.heading_count,
                        "headings": file_metadata.headings,

                        # Processing metadata
                        "parser_used": file_metadata.parser_used,
                        "extraction_warnings": file_metadata.extraction_warnings,
                        "is_encrypted": file_metadata.is_encrypted,
                        "is_corrupted": file_metadata.is_corrupted,

                        # Timestamps
                        "created_at": file_metadata.created_at.isoformat() if file_metadata.created_at else None,
                        "modified_at": file_metadata.modified_at.isoformat() if file_metadata.modified_at else None,
                        "uploaded_at": datetime.now().isoformat(),

                        # Document metadata
                        "document_id": document_id,
                        "content_type": "uploaded_file",
                        "source_type": "file_upload",
                        "is_boilerplate": False,
                        "labels": file_metadata.keywords,  # Use keywords as labels
                    }

                    # Handle large documents by splitting if needed
                    max_chars = 500_000  # From config max_html_chars
                    if len(content) > max_chars:
                        # Split into multiple documents
                        chunks = self._split_large_content(content, max_chars)
                        for i, chunk in enumerate(chunks):
                            chunk_doc_id = f"{document_id}_part_{i + 1}"
                            chunk_metadata = doc_metadata.copy()
                            chunk_metadata.update({
                                "document_id": chunk_doc_id,
                                "part_number": i + 1,
                                "total_parts": len(chunks),
                                "is_split_document": True,
                                "original_document_id": document_id,
                            })

                            chunk_source = DocumentSource(
                                source_type=DataSourceType.FILE_UPLOAD,
                                source_id="uploaded_files",
                                source_url=f"file://{file_path}#part{i + 1}",
                                title=f"{file_metadata.title or file_path.stem} (Part {i + 1})",
                                last_modified=file_metadata.modified_at,
                                metadata=chunk_metadata
                            )

                            yield ExtractedDocument(
                                id=chunk_doc_id,
                                title=f"{file_metadata.title or file_path.stem} (Part {i + 1})",
                                content=chunk,
                                source=chunk_source,
                                metadata=chunk_metadata
                            )
                    else:
                        # Single document
                        yield ExtractedDocument(
                            id=document_id,
                            title=file_metadata.title or file_path.stem,
                            content=content,
                            source=source,
                            metadata=doc_metadata
                        )

                    processed_count += 1
                    logger.info(f"Successfully processed {file_path}")

                except Exception as e:
                    logger.error(f"Failed to process file {file_path}: {e}")
                    if self._progress:
                        if not self._progress.error_message:
                            self._progress.error_message = f"Failed to process {file_path.name}: {e}"

            # Mark as completed
            if self._progress:
                self._progress.status = "completed"
                self._progress.completed_at = datetime.now()
                self._progress.processed_items = processed_count

        except Exception as e:
            logger.error(f"Document extraction failed: {e}")
            if self._progress:
                self._progress.status = "failed"
                self._progress.error_message = str(e)
                self._progress.completed_at = datetime.now()

    def _split_large_content(self, content: str, max_chars: int) -> List[str]:
        """Split large content into smaller chunks while preserving structure."""
        if len(content) <= max_chars:
            return [content]

        chunks = []
        current_chunk = ""
        lines = content.split('\n')

        for line in lines:
            # If adding this line would exceed the limit
            if len(current_chunk) + len(line) + 1 > max_chars:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                    current_chunk = line
                else:
                    # Line itself is too long, force split
                    while len(line) > max_chars:
                        chunks.append(line[:max_chars])
                        line = line[max_chars:]
                    current_chunk = line
            else:
                if current_chunk:
                    current_chunk += '\n' + line
                else:
                    current_chunk = line

        if current_chunk:
            chunks.append(current_chunk.strip())

        return chunks

    def get_progress(self, job_id: str) -> Optional[IndexingProgress]:
        """Get the progress of an indexing job."""
        if job_id == self._job_id and self._progress:
            return self._progress
        return None

    def cleanup_files(self) -> None:
        """Clean up uploaded files after processing."""
        if self._upload_dir and self._upload_dir.exists():
            try:
                shutil.rmtree(self._upload_dir)
                logger.info(f"Cleaned up upload directory: {self._upload_dir}")
            except Exception as e:
                logger.warning(f"Failed to cleanup upload directory {self._upload_dir}: {e}")

        self._uploaded_files.clear()
        self._upload_dir = None


# Register the file upload data source
data_source_registry.register(DataSourceType.FILE_UPLOAD, FileUploadDataSource)