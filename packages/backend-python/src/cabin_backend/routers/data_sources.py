"""
Data sources router - handles data source discovery and indexing endpoints.
"""

import logging
from typing import Dict, Any

from fastapi import APIRouter, HTTPException

from ..models import (
    DataSourceIndexRequest, DataSourceDiscoveryRequest, DataSourceTestRequest,
    DataSourceIndexResponse
)
from . import deps

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/data-sources", tags=["data-sources"])


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
        return result
    except Exception as e:
        logger.error("Error testing connection: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Connection test failed: {e}")


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
        return deps.vector_store_service.get_data_source_stats()
    except Exception as e:
        logger.error("Error getting data source stats: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {e}")
