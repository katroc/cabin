"""
Conversation router - handles conversation management endpoints.
"""

import logging
from fastapi import APIRouter, HTTPException

from . import deps

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["conversations"])


@router.get("/conversations/{conversation_id}")
def get_conversation_history(conversation_id: str):
    """Get the full history of a conversation."""
    if not deps.conversation_memory:
        raise HTTPException(status_code=503, detail="Conversation service not available.")

    try:
        history = deps.conversation_memory.get_conversation_history(conversation_id)
        if not history:
            raise HTTPException(status_code=404, detail="Conversation not found")

        return {
            "conversation_id": history.conversation_id,
            "created_at": history.created_at,
            "updated_at": history.updated_at,
            "messages": [
                {
                    "id": msg.id,
                    "role": msg.role,
                    "content": msg.content,
                    "timestamp": msg.timestamp,
                    "citations": msg.citations,
                    "thinking": msg.thinking
                }
                for msg in history.messages
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error getting conversation history: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Error getting conversation: {e}")


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: str):
    """Delete a conversation and its history."""
    if not deps.conversation_memory:
        raise HTTPException(status_code=503, detail="Conversation service not available.")

    try:
        deleted = deps.conversation_memory.delete_conversation(conversation_id)
        if deleted:
            return {"success": True, "message": f"Conversation {conversation_id} deleted"}
        else:
            raise HTTPException(status_code=404, detail="Conversation not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error deleting conversation: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Error deleting conversation: {e}")


@router.get("/conversations/stats")
def get_conversation_stats():
    """Get conversation memory statistics."""
    if not deps.conversation_memory:
        raise HTTPException(status_code=503, detail="Conversation service not available.")

    return deps.conversation_memory.get_stats()


@router.get("/router/stats")
def get_query_router_stats():
    """Get query router statistics and configuration."""
    if not deps.query_router:
        raise HTTPException(status_code=503, detail="Query router not available.")

    return deps.query_router.get_stats()
