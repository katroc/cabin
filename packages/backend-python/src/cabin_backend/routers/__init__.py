"""FastAPI routers package for Cabin backend."""

from .chat import router as chat_router
from .conversation import router as conversation_router
from .documents import router as documents_router
from .data_sources import router as data_sources_router
from .uploads import router as uploads_router
from .performance import router as performance_router
from .settings import router as settings_router

__all__ = [
    "chat_router",
    "conversation_router",
    "documents_router",
    "data_sources_router",
    "uploads_router",
    "performance_router",
    "settings_router",
]
