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

        logger.info(f"[DEBUG] FileUploadDataSource.__init__ called, instance id: {id(self)}")
        logger.info(f"[DEBUG] connection.additional_config: {connection.additional_config}")

        # Auto-set upload directory from connection config if provided
        upload_path = connection.additional_config.get("upload_path")
        if upload_path:
            logger.info(f"[DEBUG] Auto-setting upload directory from connection config: {upload_path}")
            self.set_upload_directory(upload_path)

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
        logger.info(f"[DEBUG] set_upload_directory called on instance {id(self)} with upload_dir: {self._upload_dir}")
        logger.info(f"[DEBUG] Current _uploaded_files before update: {len(self._uploaded_files)} files")

        if self._upload_dir.exists():
            # Discover all files in the upload directory
            self._uploaded_files = []
            logger.info(f"[DEBUG] Directory exists, scanning for files...")
            for file_path in self._upload_dir.rglob("*"):
                if file_path.is_file() and not file_path.name.startswith('.'):
                    self._uploaded_files.append(file_path)
                    logger.info(f"[DEBUG] Added file: {file_path}")
            logger.info(f"[DEBUG] Found {len(self._uploaded_files)} files in upload directory: {[f.name for f in self._uploaded_files]}")
            logger.info(f"[DEBUG] self._uploaded_files after update: {[str(f) for f in self._uploaded_files]}")
        else:
            logger.warning(f"[DEBUG] Upload directory does not exist: {self._upload_dir}")
            self._uploaded_files = []

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
        logger.info(f"[DEBUG] extract_documents called on instance {id(self)}")
        logger.info(f"[DEBUG] Starting document extraction from {len(self._uploaded_files)} uploaded files")
        logger.info(f"[DEBUG] source_ids parameter: {source_ids}")
        logger.info(f"[DEBUG] config.max_items: {config.max_items}")
        logger.info(f"[DEBUG] self._uploaded_files: {[str(f) for f in self._uploaded_files]}")
        logger.info(f"[DEBUG] self._upload_dir: {self._upload_dir}")

        try:
            # Initialize progress tracking
            if self._job_id:
                logger.info(f"[DEBUG] Initializing progress tracking for job_id: {self._job_id}")
                self._progress = IndexingProgress(
                    job_id=self._job_id,
                    status="running",
                    started_at=datetime.now(),
                    total_items=len(self._uploaded_files)
                )

            processed_count = 0

            # If source_ids provided, filter files
            files_to_process = self._uploaded_files
            logger.info(f"[DEBUG] Initial files_to_process: {len(files_to_process)} files")

            if source_ids:
                logger.info(f"[DEBUG] Filtering files based on source_ids: {source_ids}")
                source_paths = {Path(source_id) for source_id in source_ids}
                logger.info(f"[DEBUG] source_paths: {[str(p) for p in source_paths]}")
                files_to_process = [f for f in self._uploaded_files if f in source_paths]
                logger.info(f"[DEBUG] Filtered to {len(files_to_process)} files based on source_ids: {source_ids}")
            else:
                logger.info(f"[DEBUG] Processing all {len(files_to_process)} uploaded files (no source_ids filter)")

            logger.info(f"[DEBUG] Final files_to_process: {[str(f) for f in files_to_process]}")

            # Process each file
            for file_path in files_to_process:
                logger.info(f"[DEBUG] Starting processing of file: {file_path}")
                if processed_count >= config.max_items:
                    logger.info(f"[DEBUG] Reached max_items limit ({config.max_items}), breaking")
                    break

                try:
                    # Update progress
                    if self._progress:
                        logger.info(f"[DEBUG] Updating progress for {file_path.name}")
                        self._progress.processed_items = processed_count
                        self._progress.current_item = file_path.name

                    # Parse document
                    logger.info(f"[DEBUG] Parsing document: {file_path}")
                    content, file_metadata = document_parser_registry.parse_document(file_path)
                    logger.info(f"[DEBUG] Extracted {len(content)} characters from {file_path}")
                    logger.info(f"[DEBUG] file_metadata.parser_used: {file_metadata.parser_used}")
                    logger.info(f"[DEBUG] file_metadata.title: {file_metadata.title}")

                    if not content.strip():
                        logger.warning(f"[DEBUG] No content extracted from {file_path}, skipping")
                        continue

                    # Create document source
                    logger.info(f"[DEBUG] Creating document source for {file_path}")
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
                    logger.info(f"[DEBUG] Created document_id: {document_id}")

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
                    logger.info(f"[DEBUG] Content length: {len(content)}, max_chars: {max_chars}")

                    if len(content) > max_chars:
                        logger.info(f"[DEBUG] Content too large, splitting into chunks")
                        # Split into multiple documents
                        chunks = self._split_large_content(content, max_chars)
                        logger.info(f"[DEBUG] Split into {len(chunks)} chunks")

                        for i, chunk in enumerate(chunks):
                            chunk_doc_id = f"{document_id}_part_{i + 1}"
                            logger.info(f"[DEBUG] Creating chunk {i + 1}/{len(chunks)}: {chunk_doc_id}")

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

                            logger.info(f"[DEBUG] Yielding chunk document: {chunk_doc_id}")
                            yield ExtractedDocument(
                                id=chunk_doc_id,
                                title=f"{file_metadata.title or file_path.stem} (Part {i + 1})",
                                content=chunk,
                                source=chunk_source,
                                metadata=chunk_metadata
                            )
                    else:
                        # Single document
                        logger.info(f"[DEBUG] Yielding single document for {file_path}")
                        yield ExtractedDocument(
                            id=document_id,
                            title=file_metadata.title or file_path.stem,
                            content=content,
                            source=source,
                            metadata=doc_metadata
                        )

                    processed_count += 1
                    logger.info(f"[DEBUG] Successfully processed {file_path}, total processed: {processed_count}")

                except Exception as e:
                    logger.error(f"[DEBUG] Failed to process file {file_path}: {e}")
                    if self._progress:
                        if not self._progress.error_message:
                            self._progress.error_message = f"Failed to process {file_path.name}: {e}"

            # Mark as completed
            logger.info(f"[DEBUG] Finished processing all files. Total processed: {processed_count}")
            if self._progress:
                logger.info(f"[DEBUG] Updating progress status to completed")
                self._progress.status = "completed"
                self._progress.completed_at = datetime.now()
                self._progress.processed_items = processed_count

        except Exception as e:
            logger.error(f"[DEBUG] Document extraction failed: {e}")
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