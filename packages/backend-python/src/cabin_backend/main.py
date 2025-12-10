"""
Cabin Python Backend - Main FastAPI Application

This is the main entry point for the Cabin RAG backend.
All API endpoints are organized into separate router modules.
"""

import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .chunker import SemanticChunker
from .vector_store import VectorStore
from .generator import Generator
from .data_sources.manager import DataSourceManager
from .conversation_memory import ConversationMemoryManager
from .query_router import LLMQueryRouter
from .config import settings
from .telemetry import setup_logging, metrics
from .routers import deps
from .routers.settings import load_default_ui_settings, UISettingsPayload

# Import data sources to register them
from .data_sources.confluence import ConfluenceDataSource  # noqa: F401
from .data_sources.file_upload import FileUploadDataSource  # noqa: F401
from .data_sources.url_ingestion import URLIngestionDataSource  # noqa: F401

# Import routers
from .routers import (
    chat_router,
    conversation_router,
    documents_router,
    data_sources_router,
    uploads_router,
    performance_router,
    settings_router,
)

# --- Load settings and setup logging ---
current_ui_settings = load_default_ui_settings()
current_overrides = current_ui_settings.to_overrides()
setup_logging(current_ui_settings.log_level)
metrics.configure(enabled=settings.app_config.telemetry.metrics_enabled)
logger = logging.getLogger(__name__)

# --- App Initialization ---
app = FastAPI(
    title="Cabin Python Backend",
    description="Python-based RAG backend using the Parent Document Retriever strategy.",
    version="1.0.0",
)

# --- CORS Configuration ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Service Initialization ---
try:
    chunker_service = SemanticChunker()
    vector_store_service = VectorStore(overrides=current_overrides)
    generator_service = Generator(overrides=current_overrides)
    data_source_manager = DataSourceManager(chunker_service, vector_store_service)
    conversation_memory = ConversationMemoryManager()
    query_router = LLMQueryRouter(
        router_url="http://localhost:8000",
        confidence_threshold=0.65
    )

    # Initialize shared dependencies for routers
    deps.init_services(
        chunker_service,
        vector_store_service,
        generator_service,
        data_source_manager,
        conversation_memory,
        query_router,
        current_ui_settings,
        current_overrides,
    )
except Exception as e:
    print(f"FATAL: Could not initialize services: {e}")
    chunker_service = None
    vector_store_service = None
    generator_service = None
    data_source_manager = None
    conversation_memory = None
    query_router = None


# --- Include Routers ---
app.include_router(chat_router)
app.include_router(conversation_router)
app.include_router(documents_router)
app.include_router(data_sources_router)
app.include_router(uploads_router)
app.include_router(performance_router)
app.include_router(settings_router)


# --- Health Check ---
@app.get("/health")
def health_check():
    """Check health status of all services."""
    if not all([chunker_service, vector_store_service, generator_service, data_source_manager]):
        raise HTTPException(status_code=503, detail="Services are not available.")

    service_status = {}

    if vector_store_service:
        service_status["vector_store"] = vector_store_service.health_check()
    else:
        service_status["vector_store"] = False

    all_healthy = all([
        chunker_service is not None,
        vector_store_service is not None,
        generator_service is not None,
        data_source_manager is not None,
        service_status.get("vector_store", False)
    ])

    if not all_healthy:
        return {
            "status": "degraded",
            "services": service_status,
            "message": "Some services are not healthy"
        }, 503

    return {
        "status": "ok",
        "services": service_status,
        "message": "All services are healthy"
    }


@app.get("/")
def root():
    """Root endpoint with API information."""
    return {
        "name": "Cabin Python Backend",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
        "health": "/health"
    }
