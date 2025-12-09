"""
Documents router - handles document indexing and management endpoints.
"""

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..models import IngestRequest
from . import deps

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["documents"])


class DeleteDocumentsRequest(BaseModel):
    document_ids: List[str]


@router.post("/index", status_code=201)
def index_document(request: IngestRequest):
    """Endpoint to ingest and index a document."""
    if not deps.vector_store_service or not deps.chunker_service:
        raise HTTPException(status_code=503, detail="Indexing service not available.")

    try:
        child_chunks = deps.chunker_service.chunk(request)
        deps.vector_store_service.add_documents(child_chunks)
        return {"success": True, "message": f"Document '{request.page_title}' indexed successfully."}
    except Exception as e:
        logger.error("Error during indexing: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to index document: {e}")


@router.delete("/index")
def clear_index():
    """Endpoint to clear the entire index."""
    if not deps.vector_store_service:
        raise HTTPException(status_code=503, detail="Vector store not available.")

    try:
        deps.vector_store_service.clear_collection()
        return {"success": True, "message": "Index cleared successfully."}
    except Exception as e:
        logger.error("Error during index clearing: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to clear index: {e}")


@router.get("/documents")
def get_indexed_documents(
    search: Optional[str] = None,
    source_types: Optional[str] = None,
    statuses: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    size_min: Optional[int] = None,
    size_max: Optional[int] = None,
    tags: Optional[str] = None,
    content_types: Optional[str] = None,
    sort_field: str = "last_modified",
    sort_direction: str = "desc",
    limit: int = 50,
    offset: int = 0
):
    """Get list of indexed documents with filtering, sorting, and pagination."""
    if not deps.vector_store_service:
        raise HTTPException(status_code=503, detail="Vector store not available.")

    try:
        # Get all documents from ChromaDB
        all_docs = deps.vector_store_service.get_all_documents()

        # Parse filter values
        source_type_list = source_types.split(",") if source_types else []
        status_list = statuses.split(",") if statuses else []
        tag_list = tags.split(",") if tags else []
        content_type_list = content_types.split(",") if content_types else []

        # Parse dates
        date_from_parsed = None
        date_to_parsed = None
        if date_from:
            try:
                date_from_parsed = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
            except Exception:
                pass
        if date_to:
            try:
                date_to_parsed = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
            except Exception:
                pass

        filtered_docs = []
        for doc in all_docs:
            # Text search
            if search:
                search_lower = search.lower()
                title = (doc.get("title") or doc.get("page_title") or "").lower()
                content = (doc.get("content") or "").lower()
                if search_lower not in title and search_lower not in content:
                    continue

            # Source type filter
            if source_type_list:
                doc_source = doc.get("source_type", "unknown")
                if doc_source not in source_type_list:
                    continue

            # Status filter
            if status_list:
                doc_status = doc.get("status", "indexed")
                if doc_status not in status_list:
                    continue

            # Date range filter
            doc_date_str = doc.get("last_modified") or doc.get("uploaded_at")
            if doc_date_str:
                try:
                    doc_date = datetime.fromisoformat(doc_date_str.replace("Z", "+00:00"))
                    if date_from_parsed and doc_date < date_from_parsed:
                        continue
                    if date_to_parsed and doc_date > date_to_parsed:
                        continue
                except Exception:
                    pass

            # Size filter
            doc_size = doc.get("file_size", 0)
            if size_min and doc_size < size_min:
                continue
            if size_max and doc_size > size_max:
                continue

            # Tag filter
            if tag_list:
                doc_tags = doc.get("labels") or doc.get("tags") or []
                if not any(tag in doc_tags for tag in tag_list):
                    continue

            # Content type filter
            if content_type_list:
                doc_content_type = doc.get("content_type", "unknown")
                if doc_content_type not in content_type_list:
                    continue

            filtered_docs.append(doc)

        # Sorting
        def sort_key(doc):
            if sort_field == "title":
                return (doc.get("title") or doc.get("page_title") or "").lower()
            elif sort_field == "source_type":
                return doc.get("source_type", "")
            elif sort_field == "file_size":
                return doc.get("file_size", 0)
            elif sort_field == "status":
                return doc.get("status", "")
            else:  # last_modified or default
                date_str = doc.get("last_modified") or doc.get("uploaded_at") or ""
                try:
                    return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                except Exception:
                    return datetime.min
        
        reverse = sort_direction == "desc"
        filtered_docs.sort(key=sort_key, reverse=reverse)

        # Pagination
        total = len(filtered_docs)
        paginated_docs = filtered_docs[offset:offset + limit]

        return {
            "documents": paginated_docs,
            "total": total,
            "limit": limit,
            "offset": offset,
            "hasMore": offset + limit < total
        }

    except Exception as e:
        logger.error("Error getting documents: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get documents: {e}")


@router.delete("/documents")
def delete_documents(request: DeleteDocumentsRequest):
    """Delete documents by their IDs."""
    if not deps.vector_store_service:
        raise HTTPException(status_code=503, detail="Vector store not available.")

    try:
        deleted_count = 0
        for doc_id in request.document_ids:
            try:
                deps.vector_store_service.delete_document(doc_id)
                deleted_count += 1
            except Exception as e:
                logger.warning("Failed to delete document %s: %s", doc_id, str(e))

        return {
            "success": True,
            "deleted_count": deleted_count,
            "message": f"Deleted {deleted_count} documents"
        }
    except Exception as e:
        logger.error("Error deleting documents: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to delete documents: {e}")
