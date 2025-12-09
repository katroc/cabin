"""
Shared dependencies and service instances for routers.
This module provides access to services and shared state that routers need.
"""

import logging
import time
from collections import defaultdict
from typing import List, Optional, TYPE_CHECKING

from ..models import RAGPerformanceMetrics

if TYPE_CHECKING:
    from ..chunker import SemanticChunker
    from ..vector_store import VectorStore
    from ..generator import Generator
    from ..data_sources.manager import DataSourceManager
    from ..conversation_memory import ConversationMemoryManager
    from ..query_router import LLMQueryRouter
    from ..runtime import RuntimeOverrides

logger = logging.getLogger(__name__)

# --- Service instances (set during app initialization) ---
chunker_service: Optional["SemanticChunker"] = None
vector_store_service: Optional["VectorStore"] = None
generator_service: Optional["Generator"] = None
data_source_manager: Optional["DataSourceManager"] = None
conversation_memory: Optional["ConversationMemoryManager"] = None
query_router: Optional["LLMQueryRouter"] = None

# --- Settings ---
current_ui_settings = None  # Will be set by main.py
current_overrides: Optional["RuntimeOverrides"] = None

# --- Performance Tracking Storage ---
performance_metrics: List[RAGPerformanceMetrics] = []
MAX_STORED_METRICS = 10000

# --- Rate limiting for uploads ---
upload_attempts = defaultdict(list)
MAX_UPLOADS_PER_HOUR = 20
RATE_LIMIT_WINDOW = 3600  # 1 hour in seconds


def store_performance_metrics(metrics: RAGPerformanceMetrics) -> None:
    """Store performance metrics with size limit."""
    global performance_metrics
    performance_metrics.append(metrics)
    if len(performance_metrics) > MAX_STORED_METRICS:
        performance_metrics = performance_metrics[-MAX_STORED_METRICS:]


def check_rate_limit(client_ip: str) -> bool:
    """Check if client has exceeded upload rate limit."""
    current_time = time.time()

    # Clean old entries
    upload_attempts[client_ip] = [
        timestamp for timestamp in upload_attempts[client_ip]
        if current_time - timestamp < RATE_LIMIT_WINDOW
    ]

    # Check if under limit
    if len(upload_attempts[client_ip]) >= MAX_UPLOADS_PER_HOUR:
        return False

    # Add current attempt
    upload_attempts[client_ip].append(current_time)
    return True


def get_services():
    """Get all service instances. Returns tuple of services."""
    return (
        chunker_service,
        vector_store_service,
        generator_service,
        data_source_manager,
        conversation_memory,
        query_router,
    )


def init_services(
    chunker,
    vector_store,
    generator,
    data_manager,
    conv_memory,
    q_router,
    ui_settings,
    overrides,
):
    """Initialize all service instances. Called by main.py during startup."""
    global chunker_service, vector_store_service, generator_service
    global data_source_manager, conversation_memory, query_router
    global current_ui_settings, current_overrides

    chunker_service = chunker
    vector_store_service = vector_store
    generator_service = generator
    data_source_manager = data_manager
    conversation_memory = conv_memory
    query_router = q_router
    current_ui_settings = ui_settings
    current_overrides = overrides


def update_services(
    vector_store,
    generator,
    data_manager,
    q_router,
    ui_settings,
    overrides,
):
    """Update service instances after settings change."""
    global vector_store_service, generator_service
    global data_source_manager, query_router
    global current_ui_settings, current_overrides

    vector_store_service = vector_store
    generator_service = generator
    data_source_manager = data_manager
    query_router = q_router
    current_ui_settings = ui_settings
    current_overrides = overrides
