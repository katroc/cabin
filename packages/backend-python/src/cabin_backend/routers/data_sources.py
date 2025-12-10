"""
Data sources router - handles data source discovery and indexing endpoints.
"""

import logging
import secrets
from typing import Dict, Any, List, Optional
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from ..models import (
    DataSourceIndexRequest, DataSourceDiscoveryRequest, DataSourceTestRequest,
    DataSourceIndexResponse
)
from ..config import settings
from . import deps

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/data-sources", tags=["data-sources"])

# In-memory storage for Google Drive OAuth tokens (in production, use a proper store)
_google_drive_tokens: Dict[str, Dict[str, Any]] = {}


# URL Ingestion request model
class URLIngestionRequest(BaseModel):
    urls: List[str]
    max_items: Optional[int] = 100


class GoogleDriveIndexRequest(BaseModel):
    """Request to index Google Drive folders."""
    source_ids: List[str]  # Folder IDs to index
    config: Optional[Dict[str, Any]] = None  # Indexing options


@router.post("/url_ingestion/index")
async def start_url_ingestion(request: URLIngestionRequest):
    """Start indexing URLs."""
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    if not request.urls:
        raise HTTPException(status_code=400, detail="No URLs provided")

    try:
        job_id = await deps.data_source_manager.start_url_ingestion(
            urls=request.urls,
            indexing_config={"max_items": request.max_items or 100}
        )
        return {"job_id": job_id, "status": "started"}
    except Exception as e:
        logger.error("Error starting URL ingestion: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to start indexing: {e}")


@router.get("/url_ingestion/jobs/{job_id}")
def get_url_ingestion_job_progress(job_id: str):
    """Get the progress of a URL ingestion job."""
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        progress = deps.data_source_manager.get_job_progress(job_id)
        if not progress:
            raise HTTPException(status_code=404, detail="Job not found")
        return progress
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error getting job progress: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get job progress: {e}")



@router.get("/")
def get_data_sources():
    """Get information about available data source types."""
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        return deps.data_source_manager.get_available_sources()
    except Exception as e:
        logger.error("Error getting data sources: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get data sources: {e}")


@router.post("/test")
async def test_data_source_connection(request: DataSourceTestRequest):
    """Test connection to a data source."""
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        result = await deps.data_source_manager.test_connection(
            request.source_type,
            request.connection
        )
        # Return proper JSON structure for frontend
        return {"success": result, "message": "Connection successful" if result else "Connection failed"}
    except Exception as e:
        logger.error("Error testing connection: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Connection test failed: {e}")


@router.post("/test-connection")
async def test_connection_alias(request: DataSourceTestRequest):
    """Test connection to a data source (alias for /test)."""
    return await test_data_source_connection(request)


@router.post("/discover")
async def discover_data_sources(request: DataSourceDiscoveryRequest):
    """Discover available sources from a data source."""
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        result = await deps.data_source_manager.discover_sources(
            request.source_type,
            request.connection
        )
        return result
    except Exception as e:
        logger.error("Error discovering sources: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Discovery failed: {e}")


@router.post("/index", response_model=DataSourceIndexResponse)
async def start_data_source_indexing(request: DataSourceIndexRequest):
    """Start indexing from a data source."""
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        job_id = await deps.data_source_manager.start_indexing(
            request.source_type,
            request.connection,
            request.source_ids,
            request.config
        )
        return DataSourceIndexResponse(
            job_id=job_id,
            status="started",
            message="Indexing job started"
        )
    except Exception as e:
        logger.error("Error starting indexing: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to start indexing: {e}")


@router.get("/jobs/{job_id}")
def get_indexing_job_progress(job_id: str):
    """Get the progress of an indexing job."""
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        progress = deps.data_source_manager.get_job_progress(job_id)
        if not progress:
            raise HTTPException(status_code=404, detail="Job not found")
        return progress
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error getting job progress: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get job progress: {e}")


@router.get("/jobs")
def get_all_indexing_jobs():
    """Get all indexing jobs."""
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        return deps.data_source_manager.get_all_jobs()
    except Exception as e:
        logger.error("Error getting jobs: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get jobs: {e}")


@router.delete("/jobs/{job_id}")
def cancel_indexing_job(job_id: str):
    """Cancel an indexing job."""
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        success = deps.data_source_manager.cancel_job(job_id)
        if not success:
            raise HTTPException(status_code=404, detail="Job not found or cannot be cancelled")
        return {"success": True, "message": f"Job {job_id} cancelled"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error cancelling job: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to cancel job: {e}")


@router.get("/stats")
def get_data_source_stats():
    """Get statistics about indexed data sources."""
    if not deps.vector_store_service:
        raise HTTPException(status_code=503, detail="Vector store not available.")

    try:
        collection = deps.vector_store_service.chroma.collection
        total_chunks = collection.count()
        
        if total_chunks == 0:
            return {
                "total_documents": 0,
                "total_chunks": 0,
                "total_size": 0,
                "sources": {},
                "last_updated": None,
                "status_distribution": {
                    "indexed": 0,
                    "error": 0,
                    "processing": 0,
                    "pending": 0
                }
            }
        
        # Fetch metadata to calculate stats
        results = collection.get(
            limit=min(total_chunks, 5000),  # Cap to avoid memory issues
            include=["metadatas"]
        )
        
        # Track unique documents, sizes, and dates
        documents_seen = set()
        total_size = 0
        last_updated = None
        sources: Dict[str, Any] = {}
        status_counts = {"indexed": 0, "error": 0, "processing": 0, "pending": 0}
        
        for metadata in results.get("metadatas", []):
            if not metadata:
                continue
            
            # Get document ID
            doc_id = (
                metadata.get("document_id") or 
                metadata.get("source_url") or 
                metadata.get("page_title") or
                metadata.get("filename")
            )
            
            if doc_id and doc_id not in documents_seen:
                documents_seen.add(doc_id)
                
                # Accumulate file size
                file_size = metadata.get("file_size")
                if file_size and isinstance(file_size, (int, float)):
                    total_size += int(file_size)
                
                # Track last updated
                doc_date = metadata.get("last_modified") or metadata.get("indexed_at")
                if doc_date:
                    if last_updated is None or doc_date > last_updated:
                        last_updated = doc_date
                
                # Track source types
                source_type = metadata.get("source_type") or "unknown"
                if source_type not in sources:
                    sources[source_type] = {
                        "count": 0,
                        "size": 0,
                        "last_updated": None,
                        "status": "active"
                    }
                sources[source_type]["count"] += 1
                if file_size and isinstance(file_size, (int, float)):
                    sources[source_type]["size"] += int(file_size)
                if doc_date:
                    if sources[source_type]["last_updated"] is None or doc_date > sources[source_type]["last_updated"]:
                        sources[source_type]["last_updated"] = doc_date
                
                # Track status - default to indexed if status not specified
                status = metadata.get("status") or "indexed"
                if status in status_counts:
                    status_counts[status] += 1
                else:
                    status_counts["indexed"] += 1
        
        return {
            "total_documents": len(documents_seen),
            "total_chunks": total_chunks,
            "total_size": total_size,
            "sources": sources,
            "last_updated": last_updated,
            "status_distribution": status_counts
        }
    except Exception as e:
        logger.error("Error getting data source stats: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {e}")


@router.get("/documents")
def get_indexed_documents(
    sort_field: str = "last_modified",
    sort_direction: str = "desc",
    limit: int = 50,
    offset: int = 0
):
    """Get list of indexed documents with pagination."""
    if not deps.vector_store_service:
        raise HTTPException(status_code=503, detail="Vector store not available.")

    try:
        # Get unique documents from ChromaDB metadata
        collection = deps.vector_store_service.chroma.collection
        count = collection.count()
        
        if count == 0:
            return {
                "documents": [],
                "total": 0,
                "limit": limit,
                "offset": offset
            }
        
        # Fetch all chunks to extract unique documents
        results = collection.get(
            limit=min(count, 1000),  # Cap at 1000 to avoid memory issues
            include=["metadatas"]
        )
        
        # Extract unique documents by document_id
        documents_map = {}
        for metadata in results.get("metadatas", []):
            if not metadata:
                continue
            doc_id = metadata.get("document_id") or metadata.get("source_url") or metadata.get("page_title")
            if doc_id and doc_id not in documents_map:
                # Determine source type with better fallback
                source_type = metadata.get("source_type")
                if not source_type:
                    # Try to infer from other fields
                    if metadata.get("space_key") or metadata.get("space_name"):
                        source_type = "confluence"
                    elif metadata.get("filename"):
                        source_type = "file_upload"
                    elif metadata.get("source_url") and "http" in str(metadata.get("source_url", "")):
                        source_type = "url_ingestion"
                    else:
                        source_type = "unknown"
                
                # Extract domain from URL for url_ingestion sources
                source_detail = None
                if source_type == "url_ingestion" and metadata.get("source_url"):
                    try:
                        from urllib.parse import urlparse
                        parsed = urlparse(metadata.get("source_url"))
                        source_detail = parsed.netloc
                    except Exception:
                        pass
                
                documents_map[doc_id] = {
                    "id": doc_id,
                    "title": metadata.get("page_title") or metadata.get("filename") or doc_id,
                    "source_type": source_type,
                    "source_url": metadata.get("source_url"),
                    "source_detail": source_detail,
                    "last_modified": metadata.get("last_modified"),
                    "space_name": metadata.get("space_name"),
                    "space_key": metadata.get("space_key"),
                    "content_type": metadata.get("content_type"),
                    "status": metadata.get("status") or "indexed",
                    "chunk_count": 0
                }
            if doc_id:
                documents_map[doc_id]["chunk_count"] += 1
        
        # Convert to list and sort
        documents = list(documents_map.values())
        
        # Sort by requested field
        reverse = sort_direction == "desc"
        if sort_field == "title":
            documents.sort(key=lambda d: d.get("title") or "", reverse=reverse)
        elif sort_field == "source_type":
            documents.sort(key=lambda d: d.get("source_type") or "", reverse=reverse)
        else:  # default: last_modified
            documents.sort(key=lambda d: d.get("last_modified") or "", reverse=reverse)
        
        # Apply pagination
        paginated = documents[offset:offset + limit]
        
        return {
            "documents": paginated,
            "total": len(documents),
            "limit": limit,
            "offset": offset
        }
    except Exception as e:
        logger.error("Error getting indexed documents: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get documents: {e}")


class DeleteDocumentsRequest(BaseModel):
    document_ids: List[str]


@router.delete("/documents")
def delete_documents(request: DeleteDocumentsRequest):
    """Delete specific documents from the index."""
    if not deps.vector_store_service:
        raise HTTPException(status_code=503, detail="Vector store not available.")
    
    if not request.document_ids:
        raise HTTPException(status_code=400, detail="No document IDs provided")
    
    try:
        collection = deps.vector_store_service.chroma.collection
        
        # Get all chunks that belong to the specified documents
        # We need to find chunks by their document_id metadata
        deleted_count = 0
        
        for doc_id in request.document_ids:
            try:
                # Find chunks with matching document_id
                results = collection.get(
                    where={"document_id": doc_id},
                    include=["metadatas"]
                )
                
                if results and results["ids"]:
                    chunk_ids = results["ids"]
                    collection.delete(ids=chunk_ids)
                    deleted_count += 1
                    logger.info(f"Deleted {len(chunk_ids)} chunks for document {doc_id}")
            except Exception as e:
                logger.warning(f"Error deleting document {doc_id}: {e}")
                continue
        
        return {
            "success": True,
            "deleted_count": deleted_count,
            "message": f"Deleted {deleted_count} document(s)"
        }
    except Exception as e:
        logger.error("Error deleting documents: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to delete documents: {e}")


@router.get("/documents/{document_id}/chunks")
def get_document_chunks(document_id: str):
    """Get all chunks for a specific document."""
    if not deps.vector_store_service:
        raise HTTPException(status_code=503, detail="Vector store not available.")
    
    try:
        collection = deps.vector_store_service.chroma.collection
        
        # Try to find chunks by document_id metadata
        results = collection.get(
            where={"document_id": document_id},
            include=["documents", "metadatas"]
        )
        
        # If no results, try by source_url or page_title
        if not results or not results.get("ids"):
            results = collection.get(
                where={"source_url": document_id},
                include=["documents", "metadatas"]
            )
        
        if not results or not results.get("ids"):
            results = collection.get(
                where={"page_title": document_id},
                include=["documents", "metadatas"]
            )
        
        chunks = []
        if results and results.get("ids"):
            for i, chunk_id in enumerate(results["ids"]):
                content = results["documents"][i] if results.get("documents") else ""
                metadata = results["metadatas"][i] if results.get("metadatas") else {}
                
                chunks.append({
                    "id": chunk_id,
                    "content": content or "",
                    "page_number": metadata.get("page_number"),
                    "chunk_index": metadata.get("chunk_index", i)
                })
        
        # Sort by chunk_index to maintain order
        chunks.sort(key=lambda c: c.get("chunk_index", 0))
        
        return {
            "document_id": document_id,
            "chunks": chunks,
            "total": len(chunks)
        }
    except Exception as e:
        logger.error("Error getting document chunks: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get document chunks: {e}")


# ============================================================================
# Google Drive OAuth Endpoints
# ============================================================================

@router.get("/google-drive/status")
async def google_drive_status():
    """Check if Google Drive is configured and connected."""
    configured = bool(settings.google_drive_client_id and settings.google_drive_client_secret)
    connected = bool(_google_drive_tokens.get("default"))  # Using "default" for single-user
    
    return {
        "configured": configured,
        "connected": connected,
        "user_email": _google_drive_tokens.get("default", {}).get("email")
    }


@router.get("/google-drive/auth-url")
async def google_drive_auth_url():
    """Get the Google OAuth authorization URL."""
    if not settings.google_drive_client_id or not settings.google_drive_client_secret:
        raise HTTPException(
            status_code=400, 
            detail="Google Drive not configured. Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET environment variables."
        )
    
    # Generate state token for CSRF protection
    state = secrets.token_urlsafe(32)
    _google_drive_tokens["_state"] = state
    
    params = {
        "client_id": settings.google_drive_client_id,
        "redirect_uri": settings.google_drive_redirect_uri,
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/drive.readonly email profile",
        "access_type": "offline",
        "prompt": "consent",
        "state": state
    }
    
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return {"auth_url": auth_url}


@router.get("/google-drive/callback")
async def google_drive_callback(code: str = Query(...), state: str = Query(...)):
    """Handle OAuth callback from Google."""
    import aiohttp
    
    # Verify state
    expected_state = _google_drive_tokens.get("_state")
    if state != expected_state:
        raise HTTPException(status_code=400, detail="Invalid state parameter")
    
    # Exchange code for tokens
    token_url = "https://oauth2.googleapis.com/token"
    async with aiohttp.ClientSession() as session:
        async with session.post(token_url, data={
            "client_id": settings.google_drive_client_id,
            "client_secret": settings.google_drive_client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": settings.google_drive_redirect_uri
        }) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                logger.error(f"Token exchange failed: {error_text}")
                raise HTTPException(status_code=400, detail="Failed to exchange code for tokens")
            
            tokens = await resp.json()
    
    # Get user info
    user_email = None
    try:
        async with aiohttp.ClientSession() as session:
            headers = {"Authorization": f"Bearer {tokens['access_token']}"}
            async with session.get("https://www.googleapis.com/oauth2/v2/userinfo", headers=headers) as resp:
                if resp.status == 200:
                    user_info = await resp.json()
                    user_email = user_info.get("email")
    except Exception as e:
        logger.warning(f"Failed to get user info: {e}")
    
    # Store tokens
    _google_drive_tokens["default"] = {
        "access_token": tokens.get("access_token"),
        "refresh_token": tokens.get("refresh_token"),
        "email": user_email
    }
    
    logger.info(f"Google Drive connected for user: {user_email}")
    
    # Redirect back to the app's data sources section
    return RedirectResponse(url="http://localhost:3000?show_data_sources=google_drive")


@router.post("/google-drive/disconnect")
async def google_drive_disconnect():
    """Disconnect Google Drive integration."""
    if "default" in _google_drive_tokens:
        del _google_drive_tokens["default"]
    return {"success": True, "message": "Google Drive disconnected"}


@router.post("/google-drive/discover")
async def google_drive_discover():
    """Discover available folders from connected Google Drive."""
    tokens = _google_drive_tokens.get("default")
    if not tokens:
        raise HTTPException(status_code=401, detail="Google Drive not connected")
    
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available")
    
    try:
        result = await deps.data_source_manager.discover_sources(
            "google_drive",
            {
                "additional_config": {
                    "client_id": settings.google_drive_client_id,
                    "client_secret": settings.google_drive_client_secret,
                    "refresh_token": tokens.get("refresh_token"),
                    "access_token": tokens.get("access_token")
                }
            }
        )
        return {"sources": result}
    except Exception as e:
        logger.error(f"Failed to discover Google Drive sources: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/google-drive/index")
async def google_drive_index(request: GoogleDriveIndexRequest):
    """Start indexing selected Google Drive folders."""
    tokens = _google_drive_tokens.get("default")
    if not tokens:
        raise HTTPException(status_code=401, detail="Google Drive not connected")
    
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available")
    
    try:
        job_id = await deps.data_source_manager.start_indexing(
            "google_drive",
            {
                "additional_config": {
                    "client_id": settings.google_drive_client_id,
                    "client_secret": settings.google_drive_client_secret,
                    "refresh_token": tokens.get("refresh_token"),
                    "access_token": tokens.get("access_token")
                }
            },
            request.source_ids,
            request.config or {}
        )
        return {"job_id": job_id, "status": "started"}
    except Exception as e:
        logger.error(f"Failed to start Google Drive indexing: {e}")
        raise HTTPException(status_code=500, detail=str(e))

