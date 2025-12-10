"""
Data sources router - handles data source discovery and indexing endpoints.
"""

import logging
import secrets
from datetime import datetime, timedelta
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
# Map OAuth state to the redirect URI and return URL used for that flow
_oauth_states: Dict[str, Dict[str, str]] = {}

# In-memory storage for Google Drive Sync Config
_google_drive_sync_config: Dict[str, Any] = {
    "enabled": False,
    "interval_minutes": 60,
    "last_sync": None,
    "folder_ids": []
}


# URL Ingestion request model
class URLIngestionRequest(BaseModel):
    urls: List[str]
    max_items: Optional[int] = 100


class GoogleDriveIndexRequest(BaseModel):
    """Request to index Google Drive folders."""
    source_ids: List[str]  # Folder IDs to index
    config: Optional[Dict[str, Any]] = None  # Indexing options


class GoogleDriveSyncRequest(BaseModel):
    """Request to enable scheduled sync."""
    interval_minutes: int = 60
    folder_ids: List[str]


# ============================================================================
# Folder Share Models and Storage
# ============================================================================

class FolderShareAddRequest(BaseModel):
    """Request to add a new folder share for monitoring."""
    path: str  # Local path or SMB URL
    name: Optional[str] = None
    recursive: bool = True
    max_depth: int = 10
    file_extensions: Optional[List[str]] = None
    exclude_patterns: Optional[List[str]] = None
    max_file_size_mb: int = 50
    smb_username: Optional[str] = None
    smb_password: Optional[str] = None
    smb_domain: Optional[str] = None


class FolderShareIndexRequest(BaseModel):
    """Request to index a folder share."""
    max_items: int = 1000
    incremental: bool = False


class FolderShareSyncRequest(BaseModel):
    """Request to enable scheduled sync for a folder share."""
    interval_minutes: int = 60


# In-memory storage for folder shares (in production, use a database)
_folder_shares: Dict[str, Dict[str, Any]] = {}
# Folder share sync configuration
_folder_share_sync_config: Dict[str, Dict[str, Any]] = {}



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
async def google_drive_auth_url(redirect_uri: Optional[str] = None, return_url: Optional[str] = None):
    """Get the Google OAuth authorization URL."""
    if not settings.google_drive_client_id or not settings.google_drive_client_secret:
        raise HTTPException(
            status_code=400, 
            detail="Google Drive not configured. Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET environment variables."
        )
    
    # Parse allowed redirect URIs
    allowed_uris = [uri.strip() for uri in settings.google_drive_redirect_uri.split(",") if uri.strip()]
    
    # Determine which redirect URI to use
    selected_uri = allowed_uris[0]
    if redirect_uri:
        if redirect_uri in allowed_uris:
            selected_uri = redirect_uri
        else:
            logger.warning(f"Requested redirect URI {redirect_uri} not in allowed list: {allowed_uris}")
            # Fallback to first one or raise error? For now fallback but log warning
    
    # Generate state token for CSRF protection
    state = secrets.token_urlsafe(32)
    _google_drive_tokens["_state"] = state  # Legacy support
    
    # Store context for callback
    _oauth_states[state] = {
        "redirect_uri": selected_uri,
        "return_url": return_url or "http://localhost:3000"
    }
    
    params = {
        "client_id": settings.google_drive_client_id,
        "redirect_uri": selected_uri,
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
    if state != expected_state and state not in _oauth_states:
        raise HTTPException(status_code=400, detail="Invalid state parameter")
    
    # Get context for this state
    context = _oauth_states.get(state)
    if not context:
        raise HTTPException(status_code=400, detail="Invalid state or session expired")
    
    redirect_uri = context.get("redirect_uri")
    return_url = context.get("return_url", "http://localhost:3000")
    
    # Clean up state
    if state in _oauth_states:
        del _oauth_states[state]
    
    # Exchange code for tokens
    token_url = "https://oauth2.googleapis.com/token"
    async with aiohttp.ClientSession() as session:
        data = {
            "client_id": settings.google_drive_client_id,
            "client_secret": settings.google_drive_client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri
        }
        async with session.post(token_url, data=data) as resp:
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
    return RedirectResponse(url=f"{return_url}?show_data_sources=google_drive")


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


@router.get("/google-drive/sync-status")
async def google_drive_sync_status():
    """Get the current status of scheduled sync."""
    return _google_drive_sync_config


@router.post("/google-drive/enable-scheduled-sync")
async def google_drive_enable_sync(request: GoogleDriveSyncRequest):
    """Enable scheduled sync for Google Drive."""
    _google_drive_sync_config["enabled"] = True
    _google_drive_sync_config["interval_minutes"] = request.interval_minutes
    _google_drive_sync_config["folder_ids"] = request.folder_ids
    
    logger.info(f"Enabled scheduled sync for Google Drive: every {request.interval_minutes} minutes")
    return {"status": "enabled", "config": _google_drive_sync_config}


@router.post("/google-drive/disable-scheduled-sync")
async def google_drive_disable_sync():
    """Disable scheduled sync for Google Drive."""
    _google_drive_sync_config["enabled"] = False
    logger.info("Disabled scheduled sync for Google Drive")
    return {"status": "disabled", "config": _google_drive_sync_config}


# ============================================================================
# Folder Share Endpoints
# ============================================================================

@router.post("/folder-share/add")
async def add_folder_share(request: FolderShareAddRequest):
    """Register a new folder/SMB path for monitoring."""
    import hashlib
    from pathlib import Path
    
    # Generate share ID from path
    share_id = hashlib.sha256(request.path.encode()).hexdigest()[:12]
    
    # Check if already exists
    if share_id in _folder_shares:
        return {"share_id": share_id, "status": "already_exists", "share": _folder_shares[share_id]}
    
    # Validate path exists (for local paths)
    if not request.path.startswith('smb://') and not request.path.startswith('//'):
        path = Path(request.path)
        if not path.exists():
            raise HTTPException(status_code=400, detail=f"Path does not exist: {request.path}")
        if not path.is_dir():
            raise HTTPException(status_code=400, detail=f"Path is not a directory: {request.path}")
    
    # Store share configuration
    share_config = {
        "id": share_id,
        "path": request.path,
        "name": request.name or Path(request.path).name or request.path,
        "recursive": request.recursive,
        "max_depth": request.max_depth,
        "file_extensions": request.file_extensions,
        "exclude_patterns": request.exclude_patterns,
        "max_file_size_mb": request.max_file_size_mb,
        "is_smb": request.path.startswith('smb://') or request.path.startswith('//'),
        "created_at": datetime.now().isoformat(),
        "last_indexed": None,
        "document_count": 0,
    }
    
    # Store SMB credentials separately (in production, encrypt these)
    if request.smb_username:
        share_config["smb_username"] = request.smb_username
        share_config["smb_password"] = request.smb_password
        share_config["smb_domain"] = request.smb_domain
    
    _folder_shares[share_id] = share_config
    logger.info(f"Added folder share: {request.path} (ID: {share_id})")
    
    return {"share_id": share_id, "status": "added", "share": share_config}


@router.get("/folder-share/list")
async def list_folder_shares():
    """List all registered folder shares."""
    shares = []
    for share_id, config in _folder_shares.items():
        # Return config without credentials
        safe_config = {k: v for k, v in config.items() if not k.startswith('smb_password')}
        shares.append(safe_config)
    return {"shares": shares, "total": len(shares)}


@router.get("/folder-share/{share_id}")
async def get_folder_share(share_id: str):
    """Get details of a specific folder share."""
    if share_id not in _folder_shares:
        raise HTTPException(status_code=404, detail="Folder share not found")
    
    config = _folder_shares[share_id]
    # Return config without password
    safe_config = {k: v for k, v in config.items() if not k.startswith('smb_password')}
    return safe_config


@router.delete("/folder-share/{share_id}")
async def remove_folder_share(share_id: str):
    """Remove a folder share from monitoring."""
    if share_id not in _folder_shares:
        raise HTTPException(status_code=404, detail="Folder share not found")
    
    share = _folder_shares.pop(share_id)
    # Also remove sync config if exists
    if share_id in _folder_share_sync_config:
        del _folder_share_sync_config[share_id]
    
    logger.info(f"Removed folder share: {share.get('path')} (ID: {share_id})")
    return {"status": "removed", "share_id": share_id}


@router.post("/folder-share/{share_id}/test")
async def test_folder_share(share_id: str):
    """Test if a folder share is accessible."""
    if share_id not in _folder_shares:
        raise HTTPException(status_code=404, detail="Folder share not found")
    
    config = _folder_shares[share_id]
    
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available")
    
    try:
        # Create a data source instance and test connection
        result = await deps.data_source_manager.test_connection(
            "folder_share",
            {"additional_config": config}
        )
        return {"success": result, "message": "Connection successful" if result else "Connection failed"}
    except Exception as e:
        logger.error(f"Failed to test folder share {share_id}: {e}")
        return {"success": False, "message": str(e)}


@router.post("/folder-share/{share_id}/discover")
async def discover_folder_share_sources(share_id: str):
    """Discover subdirectories in a folder share."""
    if share_id not in _folder_shares:
        raise HTTPException(status_code=404, detail="Folder share not found")
    
    config = _folder_shares[share_id]
    
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available")
    
    try:
        sources = await deps.data_source_manager.discover_sources(
            "folder_share",
            {"additional_config": config}
        )
        return {"sources": sources}
    except Exception as e:
        logger.error(f"Failed to discover sources for folder share {share_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/folder-share/{share_id}/index")
async def start_folder_share_indexing(share_id: str, request: FolderShareIndexRequest):
    """Start indexing a folder share."""
    if share_id not in _folder_shares:
        raise HTTPException(status_code=404, detail="Folder share not found")
    
    config = _folder_shares[share_id]
    
    if not deps.data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available")
    
    try:
        job_id = await deps.data_source_manager.start_indexing(
            "folder_share",
            {"additional_config": config},
            [config["path"]],  # Index from the root path
            {
                "max_items": request.max_items,
                "incremental": request.incremental,
                "modified_since": config.get("last_indexed"),
            }
        )
        
        # Update last indexed time
        _folder_shares[share_id]["last_indexed"] = datetime.now().isoformat()
        
        return {"job_id": job_id, "status": "started", "share_id": share_id}
    except Exception as e:
        logger.error(f"Failed to start indexing for folder share {share_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/folder-share/{share_id}/status")
async def get_folder_share_status(share_id: str):
    """Get status and last sync info for a folder share."""
    if share_id not in _folder_shares:
        raise HTTPException(status_code=404, detail="Folder share not found")
    
    config = _folder_shares[share_id]
    sync_config = _folder_share_sync_config.get(share_id, {})
    
    return {
        "share_id": share_id,
        "name": config.get("name"),
        "path": config.get("path"),
        "last_indexed": config.get("last_indexed"),
        "document_count": config.get("document_count", 0),
        "sync_enabled": sync_config.get("enabled", False),
        "sync_interval_minutes": sync_config.get("interval_minutes", 60),
    }


@router.post("/folder-share/{share_id}/enable-sync")
async def enable_folder_share_sync(share_id: str, request: FolderShareSyncRequest):
    """Enable scheduled sync for a folder share."""
    if share_id not in _folder_shares:
        raise HTTPException(status_code=404, detail="Folder share not found")
    
    _folder_share_sync_config[share_id] = {
        "enabled": True,
        "interval_minutes": request.interval_minutes,
        "last_sync": None,
    }
    
    logger.info(f"Enabled scheduled sync for folder share {share_id}: every {request.interval_minutes} minutes")
    return {"status": "enabled", "share_id": share_id, "interval_minutes": request.interval_minutes}


@router.post("/folder-share/{share_id}/disable-sync")
async def disable_folder_share_sync(share_id: str):
    """Disable scheduled sync for a folder share."""
    if share_id not in _folder_shares:
        raise HTTPException(status_code=404, detail="Folder share not found")
    
    if share_id in _folder_share_sync_config:
        _folder_share_sync_config[share_id]["enabled"] = False
    
    logger.info(f"Disabled scheduled sync for folder share {share_id}")
    return {"status": "disabled", "share_id": share_id}


@router.post("/folder-share/{share_id}/scan")
async def scan_folder_share_for_changes(share_id: str):
    """Scan a folder share for changes without indexing."""
    from ..data_sources.folder_monitor import folder_change_monitor
    
    if share_id not in _folder_shares:
        raise HTTPException(status_code=404, detail="Folder share not found")
    
    share = _folder_shares[share_id]
    
    try:
        # Get file extensions - use None for default, not empty set
        file_extensions = share.get("file_extensions")
        if file_extensions:
            file_extensions = set(file_extensions)
        else:
            file_extensions = None  # Let the monitor use defaults
        
        change_set = folder_change_monitor.scan_for_changes(
            share_id=share_id,
            root_path=share["path"],
            recursive=share.get("recursive", True),
            max_depth=share.get("max_depth", 10),
            file_extensions=file_extensions,
            exclude_patterns=share.get("exclude_patterns"),
            smb_username=share.get("smb_username"),
            smb_password=share.get("smb_password"),
        )
        
        return {
            "share_id": share_id,
            "changes": change_set.to_dict(),
            "message": f"Found {change_set.total_changes} changes" if change_set.has_changes else "No changes detected"
        }
    except Exception as e:
        logger.error(f"Failed to scan folder share {share_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))



async def run_scheduled_sync():
    """Run scheduled sync for Google Drive and folder shares if enabled and due."""
    await _run_google_drive_sync()
    await _run_folder_share_sync()


async def _run_google_drive_sync():
    """Run scheduled sync for Google Drive."""
    try:
        if not _google_drive_sync_config["enabled"]:
            return

        last_sync = _google_drive_sync_config.get("last_sync")
        interval_minutes = _google_drive_sync_config.get("interval_minutes", 60)
        
        # Check if it's time to sync
        now = datetime.now()
        if last_sync:
            # If last_sync is string (from JSON), parse it
            if isinstance(last_sync, str):
                last_sync = datetime.fromisoformat(last_sync)
                
            next_sync = last_sync + timedelta(minutes=interval_minutes)
            if now < next_sync:
                return

        # Time to sync!
        logger.info("Starting scheduled Google Drive sync...")
        
        tokens = _google_drive_tokens.get("default")
        if not tokens:
            logger.warning("Scheduled sync failed: Google Drive not connected")
            return
            
        if not deps.data_source_manager:
            logger.warning("Scheduled sync failed: Data source manager not available")
            return
            
        folder_ids = _google_drive_sync_config.get("folder_ids", [])
        if not folder_ids:
            logger.warning("Scheduled sync skipped: No folders selected")
            return

        # Start incremental indexing
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
            folder_ids,
            {
                "incremental": True,
                "modified_since": last_sync
            }
        )
        
        # Update last sync time
        _google_drive_sync_config["last_sync"] = now.isoformat()
        logger.info(f"Scheduled Google Drive sync started (Job ID: {job_id})")
        
    except Exception as e:
        logger.error(f"Error in Google Drive scheduled sync: {e}")


async def _run_folder_share_sync():
    """Run scheduled sync for all enabled folder shares."""
    from ..data_sources.folder_monitor import folder_change_monitor
    
    try:
        if not deps.data_source_manager:
            return
        
        now = datetime.now()
        
        for share_id, sync_config in _folder_share_sync_config.items():
            if not sync_config.get("enabled", False):
                continue
            
            # Check if share still exists
            if share_id not in _folder_shares:
                continue
            
            share = _folder_shares[share_id]
            last_sync = sync_config.get("last_sync")
            interval_minutes = sync_config.get("interval_minutes", 60)
            
            # Check if it's time to sync
            if last_sync:
                if isinstance(last_sync, str):
                    last_sync = datetime.fromisoformat(last_sync)
                
                next_sync = last_sync + timedelta(minutes=interval_minutes)
                if now < next_sync:
                    continue
            
            # Scan for changes
            logger.info(f"Scanning folder share {share_id} for changes...")
            
            # Get file extensions - use None for default, not empty set
            file_extensions = share.get("file_extensions")
            if file_extensions:
                file_extensions = set(file_extensions)
            else:
                file_extensions = None
            
            change_set = folder_change_monitor.scan_for_changes(
                share_id=share_id,
                root_path=share["path"],
                recursive=share.get("recursive", True),
                max_depth=share.get("max_depth", 10),
                file_extensions=file_extensions,
                exclude_patterns=share.get("exclude_patterns"),
                smb_username=share.get("smb_username"),
                smb_password=share.get("smb_password"),
            )
            
            if not change_set.has_changes:
                logger.debug(f"No changes detected for folder share {share_id}")
                _folder_share_sync_config[share_id]["last_sync"] = now.isoformat()
                continue
            
            # Get files to index (added + modified)
            files_to_index = change_set.added + change_set.modified
            
            if files_to_index:
                logger.info(
                    f"Folder share {share_id}: indexing {len(files_to_index)} changed files "
                    f"(+{len(change_set.added)} new, ~{len(change_set.modified)} modified)"
                )
                
                # Start indexing job for changed files
                job_id = await deps.data_source_manager.start_indexing(
                    "folder_share",
                    {"additional_config": share},
                    files_to_index,  # Index only the changed files
                    {
                        "max_items": len(files_to_index),
                        "incremental": True,
                    }
                )
                
                logger.info(f"Folder share sync started (Job ID: {job_id})")
            
            # TODO: Handle deleted files (remove from vector store)
            if change_set.deleted:
                logger.info(f"Folder share {share_id}: {len(change_set.deleted)} files deleted (cleanup not yet implemented)")
            
            # Update last sync time
            _folder_share_sync_config[share_id]["last_sync"] = now.isoformat()
            _folder_shares[share_id]["last_indexed"] = now.isoformat()
    
    except Exception as e:
        logger.error(f"Error in folder share scheduled sync: {e}")

