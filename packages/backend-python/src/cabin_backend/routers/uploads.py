"""
Uploads router - handles file upload and URL ingestion endpoints.
"""

import logging
import mimetypes
import tempfile
import shutil
from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException, File, UploadFile, Request

from ..models import FileUploadRequest, FileUploadResponse, URLIngestionRequest
from . import deps

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["uploads"])

# Allowed file extensions
ALLOWED_EXTENSIONS = {
    '.pdf', '.docx', '.docm', '.txt', '.md', '.markdown',
    '.mdown', '.mkd', '.html', '.htm', '.log', '.csv'
}

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


def validate_file_content(file_path: Path, expected_extension: str) -> bool:
    """Validate file content matches expected type based on file signatures."""
    try:
        with open(file_path, 'rb') as f:
            header = f.read(64)

        signatures = {
            '.pdf': [b'%PDF-'],
            '.docx': [b'PK\x03\x04'],
            '.docm': [b'PK\x03\x04'],
            '.txt': [],
            '.md': [],
            '.markdown': [],
            '.mdown': [],
            '.mkd': [],
            '.html': [b'<!DOCTYPE html', b'<html', b'<!DOCTYPE HTML'],
            '.htm': [b'<!DOCTYPE html', b'<html', b'<!DOCTYPE HTML'],
            '.log': [],
            '.csv': [],
        }

        expected_sigs = signatures.get(expected_extension.lower(), [])
        if not expected_sigs:
            return True

        for sig in expected_sigs:
            if header.startswith(sig):
                return True

        return False

    except Exception:
        return False


@router.post("/files/upload")
async def upload_files(request: Request, files: List[UploadFile] = File(...)):
    """Upload files for indexing."""
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Upload service not available.")

    # Rate limiting
    client_ip = request.client.host if request.client else "unknown"
    if not deps.check_rate_limit(client_ip):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Please wait before uploading more files."
        )

    # Validate files
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    if len(files) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 files per upload")

    # Create temp directory for uploads
    upload_dir = Path(tempfile.mkdtemp(prefix="cabin_upload_"))

    try:
        saved_files = []
        errors = []

        for file in files:
            # Validate filename
            if not file.filename:
                errors.append({"file": "unknown", "error": "No filename provided"})
                continue

            # Check extension
            extension = Path(file.filename).suffix.lower()
            if extension not in ALLOWED_EXTENSIONS:
                errors.append({
                    "file": file.filename,
                    "error": f"File type '{extension}' not allowed"
                })
                continue

            # Check file size
            file.file.seek(0, 2)
            size = file.file.tell()
            file.file.seek(0)

            if size > MAX_FILE_SIZE:
                errors.append({
                    "file": file.filename,
                    "error": f"File exceeds maximum size of {MAX_FILE_SIZE // 1024 // 1024}MB"
                })
                continue

            # Save file
            safe_filename = Path(file.filename).name
            file_path = upload_dir / safe_filename

            try:
                with open(file_path, "wb") as f:
                    content = await file.read()
                    f.write(content)

                # Validate content
                if not validate_file_content(file_path, extension):
                    file_path.unlink()
                    errors.append({
                        "file": file.filename,
                        "error": "File content does not match expected type"
                    })
                    continue

                saved_files.append({
                    "filename": safe_filename,
                    "path": str(file_path),
                    "size": size
                })

            except Exception as e:
                errors.append({
                    "file": file.filename,
                    "error": f"Failed to save file: {str(e)}"
                })

        if not saved_files:
            shutil.rmtree(upload_dir, ignore_errors=True)
            raise HTTPException(
                status_code=400,
                detail={"message": "No valid files uploaded", "errors": errors}
            )

        return {
            "success": True,
            "upload_path": str(upload_dir),
            "files": saved_files,
            "errors": errors if errors else None
        }

    except HTTPException:
        raise
    except Exception as e:
        shutil.rmtree(upload_dir, ignore_errors=True)
        logger.error("Error uploading files: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to upload files: {e}")


@router.post("/files/index")
async def index_uploaded_files(request: FileUploadRequest):
    """Index previously uploaded files."""
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Index service not available.")

    try:
        job_id = await deps.data_source_manager.start_file_indexing(
            request.upload_path,
            request.config
        )
        return {
            "success": True,
            "job_id": job_id,
            "message": "File indexing started"
        }
    except Exception as e:
        logger.error("Error indexing files: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to index files: {e}")


@router.post("/urls/index")
async def index_urls(request: URLIngestionRequest):
    """Index web pages from URLs."""
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="URL ingestion service not available.")

    try:
        if not request.urls:
            raise HTTPException(status_code=400, detail="No URLs provided")

        if len(request.urls) > 50:
            raise HTTPException(status_code=400, detail="Maximum 50 URLs per request")

        job_id = await deps.data_source_manager.start_url_ingestion(
            request.urls,
            request.config
        )
        return {
            "success": True,
            "job_id": job_id,
            "message": "URL ingestion started"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error ingesting URLs: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to ingest URLs: {e}")


@router.get("/urls/jobs/{job_id}")
def get_url_ingestion_job_progress(job_id: str):
    """Get the progress of a URL ingestion job."""
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="URL ingestion service not available.")

    try:
        progress = deps.data_source_manager.get_job_progress(job_id)
        if not progress:
            raise HTTPException(status_code=404, detail="Job not found")
        return progress
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error getting URL ingestion progress: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get job progress: {e}")
