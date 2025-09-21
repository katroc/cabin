import logging
import os
import time
import mimetypes
from urllib.parse import urlparse
from pathlib import Path
from collections import defaultdict

from fastapi import FastAPI, HTTPException, File, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse
from typing import List

from pydantic import BaseModel, Field

from .models import (
    IngestRequest, ChatRequest, ChatResponse,
    DataSourceIndexRequest, DataSourceDiscoveryRequest, DataSourceTestRequest,
    DataSourceIndexResponse, DataSourceProgressResponse, DataSourceInfoResponse,
    FileUploadRequest, FileUploadResponse
)
from .conversation_memory import ConversationMemoryManager
from .query_router import QueryRouter
from .chunker import SemanticChunker
from .vector_store import VectorStore
from .generator import Generator
from .data_sources.manager import DataSourceManager
from .data_sources.confluence import ConfluenceDataSource  # Import to register
from .data_sources.file_upload import FileUploadDataSource  # Import to register
from .config import settings
from .runtime import RuntimeOverrides
from .telemetry import setup_logging, metrics


class UISettingsPayload(BaseModel):
    llm_base_url: str = Field(alias="llmBaseUrl")
    llm_model: str = Field(alias="llmModel")
    embedding_base_url: str = Field(alias="embeddingBaseUrl")
    embedding_model: str = Field(alias="embeddingModel")
    temperature: float = Field(alias="temperature")
    chroma_host: str = Field(alias="chromaHost")
    chroma_port: int = Field(alias="chromaPort")
    final_passages: int = Field(alias="finalPassages")
    cosine_floor: float = Field(alias="cosineFloor")
    min_keyword_overlap: int = Field(alias="minKeywordOverlap")
    use_reranker: bool = Field(alias="useReranker")
    allow_reranker_fallback: bool = Field(alias="allowRerankerFallback")
    use_rm3: bool = Field(alias="useRm3")
    reranker_url: str = Field(alias="rerankerUrl")
    reranker_port: int = Field(alias="rerankerPort")
    log_level: str = Field(alias="logLevel")

    class Config:
        populate_by_name = True

    def to_overrides(self) -> RuntimeOverrides:
        return RuntimeOverrides(
            llm_base_url=self.llm_base_url,
            llm_model=self.llm_model,
            temperature=self.temperature,
            embedding_base_url=self.embedding_base_url,
            embedding_model=self.embedding_model,
            chroma_host=self.chroma_host,
            chroma_port=self.chroma_port,
            final_passages=self.final_passages,
            cosine_floor=self.cosine_floor,
            min_keyword_overlap=self.min_keyword_overlap,
            use_reranker=self.use_reranker,
            allow_reranker_fallback=self.allow_reranker_fallback,
            use_rm3=self.use_rm3,
            reranker_url=self.reranker_url,
            log_level=self.log_level,
        )


def _parse_port_from_url(url: str, default: int = 8000) -> int:
    try:
        parsed = urlparse(url)
        if parsed.port:
            return parsed.port
    except Exception:
        pass
    return default


def load_default_ui_settings() -> UISettingsPayload:
    retrieval_cfg = settings.app_config.retrieval
    feature_flags = settings.feature_flags
    reranker_url = settings.app_config.reranker.url
    reranker_port = _parse_port_from_url(reranker_url, default=8000)
    log_level = os.getenv("CABIN_LOG_LEVEL") or settings.app_config.telemetry.log_level
    return UISettingsPayload(
        llmBaseUrl=settings.llm_base_url,
        llmModel=settings.llm_model,
        embeddingBaseUrl=settings.embedding_base_url,
        embeddingModel=settings.embedding_model,
        temperature=0.1,
        chromaHost=settings.chroma_host,
        chromaPort=settings.chroma_port,
        finalPassages=retrieval_cfg.final_passages,
        cosineFloor=retrieval_cfg.cosine_floor,
        minKeywordOverlap=retrieval_cfg.min_keyword_overlap,
        useReranker=feature_flags.reranker,
        allowRerankerFallback=feature_flags.heuristic_fallback,
        useRm3=feature_flags.rm3,
        rerankerUrl=reranker_url,
        rerankerPort=reranker_port,
        logLevel=log_level,
    )


current_ui_settings = load_default_ui_settings()
current_overrides = current_ui_settings.to_overrides()
setup_logging(current_ui_settings.log_level)
metrics.configure(enabled=settings.app_config.telemetry.metrics_enabled)
logger = logging.getLogger(__name__)

# Rate limiting for uploads (simple in-memory implementation)
upload_attempts = defaultdict(list)
MAX_UPLOADS_PER_HOUR = 20  # Reasonable limit for file uploads
RATE_LIMIT_WINDOW = 3600  # 1 hour in seconds

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

def validate_file_content(file_path: Path, expected_extension: str) -> bool:
    """Validate file content matches expected type based on file signatures."""
    try:
        with open(file_path, 'rb') as f:
            # Read first 64 bytes for file signature detection
            header = f.read(64)

        # File signatures (magic bytes) for validation
        signatures = {
            '.pdf': [b'%PDF-'],
            '.docx': [b'PK\x03\x04'],  # ZIP file signature (DOCX is ZIP-based)
            '.docm': [b'PK\x03\x04'],  # Same as DOCX
            '.txt': [],  # Text files have no specific signature
            '.md': [],   # Markdown is text
            '.markdown': [],  # Same as .md
            '.mdown': [],     # Same as .md
            '.mkd': [],       # Same as .md
            '.html': [b'<!DOCTYPE html', b'<html', b'<!DOCTYPE HTML'],
            '.htm': [b'<!DOCTYPE html', b'<html', b'<!DOCTYPE HTML'],
            '.log': [],  # Log files are text
            '.csv': [],  # CSV files are text
        }

        expected_sigs = signatures.get(expected_extension.lower(), [])
        if not expected_sigs:
            # For text-based files, we can't easily validate content
            # Just check that it's not binary that could be dangerous
            return True

        # Check if file starts with any expected signature
        for sig in expected_sigs:
            if header.startswith(sig):
                return True

        return False

    except Exception:
        return False

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
    query_router = QueryRouter()
except Exception as e:
    # If services fail to initialize (e.g., can't connect to ChromaDB),
    # log the error and prevent the app from starting gracefully.
    print(f"FATAL: Could not initialize services: {e}")
    # In a real app, you might exit or have a more robust health check system.
    # For now, endpoints will fail with a 503 if services are not available.
    chunker_service = None
    vector_store_service = None
    generator_service = None
    data_source_manager = None
    conversation_memory = None
    query_router = None


def apply_ui_settings(payload: UISettingsPayload) -> None:
    global current_ui_settings, current_overrides
    global vector_store_service, generator_service, data_source_manager

    overrides = payload.to_overrides()
    setup_logging(payload.log_level)
    current_ui_settings = payload
    current_overrides = overrides

    if chunker_service is None:
        raise RuntimeError("Chunker service not available")

    new_vector_store = VectorStore(overrides=overrides)
    new_generator = Generator(overrides=overrides)
    new_data_manager = DataSourceManager(chunker_service, new_vector_store)

    vector_store_service = new_vector_store
    generator_service = new_generator
    data_source_manager = new_data_manager

# --- Health Check ---
@app.get("/health")
def health_check():
    if not all([chunker_service, vector_store_service, generator_service, data_source_manager]):
        raise HTTPException(status_code=503, detail="Services are not available.")

    # Check individual service health
    service_status = {}

    # Check vector store connectivity
    if vector_store_service:
        service_status["vector_store"] = vector_store_service.health_check()
    else:
        service_status["vector_store"] = False

    # Check if all critical services are healthy
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

# --- API Endpoints ---

@app.post("/api/index", status_code=201)
def index_document(request: IngestRequest):
    """Endpoint to ingest and index a document."""
    if not vector_store_service or not chunker_service:
        raise HTTPException(status_code=503, detail="Indexing service not available.")
    
    try:
        child_chunks = chunker_service.chunk(request)
        vector_store_service.add_documents(child_chunks)
        return {"success": True, "message": f"Document '{request.page_title}' indexed successfully."}
    except Exception as e:
        print(f"Error during indexing: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to index document: {e}")

@app.delete("/api/index")
def clear_index():
    """Endpoint to clear the entire index."""
    if not vector_store_service:
        raise HTTPException(status_code=503, detail="Vector store not available.")

    try:
        vector_store_service.clear_collection()
        return {"success": True, "message": "Index cleared successfully."}
    except Exception as e:
        print(f"Error during index clearing: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to clear index: {e}")

@app.post("/api/chat")
def chat(request: ChatRequest) -> ChatResponse:
    """Endpoint for standard, non-streaming chat with intelligent routing."""
    if not vector_store_service or not generator_service or not conversation_memory or not query_router:
        raise HTTPException(status_code=503, detail="Chat service not available.")

    try:
        # Get or create conversation
        conversation = conversation_memory.get_or_create_conversation(request.conversation_id)
        conversation_id = conversation.conversation_id

        # Add user message to conversation history
        conversation_memory.add_user_message(conversation_id, request.message)

        # Get conversation context for LLM
        conversation_context = conversation_memory.get_conversation_context(conversation_id, max_messages=8)

        # Decide if we need RAG retrieval using query router
        corpus_sample = vector_store_service.get_corpus_sample_for_routing(sample_size=20)
        should_use_rag, similarity_score, routing_reason = query_router.should_use_rag(
            request.message,
            conversation_context=conversation_context,
            corpus_sample=corpus_sample
        )

        logger.debug(
            "Query routing: '%s' -> RAG=%s (sim=%.3f, reason=%s)",
            request.message[:50], should_use_rag, similarity_score, routing_reason
        )

        # Retrieve documents only if routing suggests we need them
        if should_use_rag:
            context_chunks = vector_store_service.query(request.message, filters=request.filters)
            logger.debug("RAG retrieval: found %d context chunks", len(context_chunks))
        else:
            context_chunks = []
            logger.debug("Conversational routing: skipping document retrieval")

        # Generate response with conversation context
        response = generator_service.ask(
            request.message,
            context_chunks,
            conversation_id=conversation_id,
            conversation_context=conversation_context,
            enforce_provenance=should_use_rag  # False for conversational, True for RAG
        )

        # Add assistant response to conversation history
        conversation_memory.add_assistant_message(
            conversation_id,
            response.response,
            response.citations
        )

        # Handle case where RAG routing was used but LLM couldn't provide citations
        # This indicates the query was likely conversational despite similarity to corpus
        if "couldn't find" in response.response.lower() and should_use_rag:
            logger.warning("RAG routing used but LLM returned fallback for query '%s'", request.message)

            # Try conversational response as fallback
            conversational_response = generator_service.ask(
                request.message,
                [],  # No context chunks for conversational mode
                conversation_id=conversation_id,
                conversation_context=conversation_context,
                enforce_provenance=False  # Disable citation requirements
            )

            # Use conversational response if it's better than fallback
            if "couldn't find" not in conversational_response.response.lower():
                logger.info("Using conversational fallback for query '%s'", request.message)
                response = conversational_response

                # Update conversation history with the corrected response
                conversation_memory.update_last_assistant_message(
                    conversation_id,
                    response.response,
                    response.citations
                )
        elif not should_use_rag and len(response.response) > 50:  # Successful conversational response
            logger.debug("Conversational routing successful for query '%s'", request.message[:50])

        return response
    except Exception as e:
        print(f"Error during chat: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process chat request: {e}")

@app.post("/api/chat/stream")
def chat_stream(request: ChatRequest):
    """Endpoint for streaming chat responses."""
    if not vector_store_service or not generator_service or not conversation_memory:
        raise HTTPException(status_code=503, detail="Chat service not available.")

    try:
        # Get or create conversation
        conversation = conversation_memory.get_or_create_conversation(request.conversation_id)
        conversation_id = conversation.conversation_id

        # Add user message to conversation history
        conversation_memory.add_user_message(conversation_id, request.message)

        # Get conversation context for LLM
        conversation_context = conversation_memory.get_conversation_context(conversation_id, max_messages=8)

        # Decide if we need RAG retrieval using query router
        corpus_sample = vector_store_service.get_corpus_sample_for_routing(sample_size=20)
        should_use_rag, similarity_score, routing_reason = query_router.should_use_rag(
            request.message,
            conversation_context=conversation_context,
            corpus_sample=corpus_sample
        )

        logger.debug(
            "Streaming query routing: '%s' -> RAG=%s (sim=%.3f, reason=%s)",
            request.message[:50], should_use_rag, similarity_score, routing_reason
        )

        # Retrieve documents only if routing suggests we need them
        if should_use_rag:
            context_chunks = vector_store_service.query(request.message, filters=request.filters)
            logger.debug("Streaming RAG retrieval: found %d context chunks", len(context_chunks))
        else:
            context_chunks = []
            logger.debug("Streaming conversational routing: skipping document retrieval")

        # Generate response - streaming uses the regular ask method since streaming is simplified
        response = generator_service.ask(
            request.message,
            context_chunks,
            conversation_id=conversation_id,
            conversation_context=conversation_context,
            enforce_provenance=should_use_rag  # False for conversational, True for RAG
        )

        # Add assistant response to conversation history
        conversation_memory.add_assistant_message(
            conversation_id,
            response.response,
            response.citations
        )

        # Handle case where RAG routing was used but LLM couldn't provide citations
        # This indicates the query was likely conversational despite similarity to corpus
        if "couldn't find" in response.response.lower() and should_use_rag:
            logger.warning("Streaming RAG routing used but LLM returned fallback for query '%s'", request.message)

            # Try conversational response as fallback
            conversational_response = generator_service.ask(
                request.message,
                [],  # No context chunks for conversational mode
                conversation_id=conversation_id,
                conversation_context=conversation_context,
                enforce_provenance=False  # Disable citation requirements
            )

            # Use conversational response if it's better than fallback
            if "couldn't find" not in conversational_response.response.lower():
                logger.info("Using conversational fallback for streaming query '%s'", request.message)
                response = conversational_response

                # Update conversation history with the corrected response
                conversation_memory.update_last_assistant_message(
                    conversation_id,
                    response.response,
                    response.citations
                )
        elif not should_use_rag and len(response.response) > 50:  # Successful conversational response
            logger.debug("Streaming conversational routing successful for query '%s'", request.message[:50])

        # Return as simple streaming response (just emit the final response)
        def generate():
            yield response.response

        return StreamingResponse(generate(), media_type="text/plain")
    except Exception as e:
        print(f"Error during streaming chat: {e}")
        # Cannot return a standard HTTPException body in a streaming response that may have already started.
        # The client will see a dropped connection.
        # Proper handling would involve a more complex setup.
        return StreamingResponse("Error processing request.", media_type="text/plain", status_code=500)

# --- Conversation Management Endpoints ---

@app.get("/api/conversations/{conversation_id}")
def get_conversation_history(conversation_id: str):
    """Get the full history of a conversation."""
    if not conversation_memory:
        raise HTTPException(status_code=503, detail="Conversation service not available.")

    try:
        history = conversation_memory.get_conversation_history(conversation_id)
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
                    "citations": msg.citations
                }
                for msg in history.messages
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting conversation history: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get conversation history: {e}")

@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(conversation_id: str):
    """Delete a conversation and its history."""
    if not conversation_memory:
        raise HTTPException(status_code=503, detail="Conversation service not available.")

    try:
        success = conversation_memory.delete_conversation(conversation_id)
        if not success:
            raise HTTPException(status_code=404, detail="Conversation not found")

        return {"success": True, "message": "Conversation deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error deleting conversation: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete conversation: {e}")

@app.get("/api/conversations/stats")
def get_conversation_stats():
    """Get conversation memory statistics."""
    if not conversation_memory:
        raise HTTPException(status_code=503, detail="Conversation service not available.")

    try:
        stats = conversation_memory.get_stats()
        return stats
    except Exception as e:
        print(f"Error getting conversation stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get conversation stats: {e}")

@app.get("/api/query-router/stats")
def get_query_router_stats():
    """Get query router statistics and configuration."""
    if not query_router:
        raise HTTPException(status_code=503, detail="Query router not available.")

    try:
        stats = query_router.get_stats()
        return stats
    except Exception as e:
        print(f"Error getting query router stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get query router stats: {e}")

@app.get("/api/settings")
def get_runtime_settings():
    return current_ui_settings.model_dump(by_alias=True)


@app.post("/api/settings")
def update_runtime_settings(payload: UISettingsPayload):
    try:
        apply_ui_settings(payload)
        return {"status": "ok"}
    except Exception as exc:
        logger.error("Failed to update runtime settings: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {exc}")

# --- Data Source API Endpoints ---

@app.get("/api/data-sources")
def get_data_sources() -> DataSourceInfoResponse:
    """Get information about available data source types."""
    if not data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        sources = data_source_manager.get_available_sources()
        return DataSourceInfoResponse(available_sources=sources)
    except Exception as e:
        print(f"Error getting data sources: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get data sources: {e}")

@app.post("/api/data-sources/test-connection")
async def test_data_source_connection(request: DataSourceTestRequest) -> dict:
    """Test connection to a data source."""
    if not data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        success = await data_source_manager.test_connection(
            request.source_type,
            request.connection
        )
        return {"success": success}
    except Exception as e:
        print(f"Error testing connection: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to test connection: {e}")

@app.post("/api/data-sources/discover")
async def discover_data_sources(request: DataSourceDiscoveryRequest) -> dict:
    """Discover available sources from a data source."""
    if not data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        sources = await data_source_manager.discover_sources(
            request.source_type,
            request.connection
        )
        return {"sources": sources}
    except Exception as e:
        print(f"Error discovering sources: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to discover sources: {e}")

@app.post("/api/data-sources/index", status_code=202)
async def start_data_source_indexing(request: DataSourceIndexRequest) -> DataSourceIndexResponse:
    """Start indexing from a data source."""
    if not data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        job_id = await data_source_manager.start_indexing(
            request.source_type,
            request.connection,
            request.source_ids,
            request.config
        )
        return DataSourceIndexResponse(
            job_id=job_id,
            status="pending",
            message="Indexing job started successfully"
        )
    except Exception as e:
        print(f"Error starting indexing: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start indexing: {e}")

@app.get("/api/data-sources/jobs/{job_id}")
def get_indexing_job_progress(job_id: str) -> DataSourceProgressResponse:
    """Get the progress of an indexing job."""
    if not data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        progress = data_source_manager.get_job_progress(job_id)
        if not progress:
            raise HTTPException(status_code=404, detail="Job not found")

        return DataSourceProgressResponse(
            job_id=progress.job_id,
            status=progress.status,
            total_items=progress.total_items,
            processed_items=progress.processed_items,
            current_item=progress.current_item,
            error_message=progress.error_message,
            started_at=progress.started_at,
            completed_at=progress.completed_at
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting job progress: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get job progress: {e}")

@app.get("/api/data-sources/jobs")
def get_all_indexing_jobs() -> dict:
    """Get all indexing jobs."""
    if not data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        jobs = data_source_manager.get_all_jobs()
        return {"jobs": [
            DataSourceProgressResponse(
                job_id=job.job_id,
                status=job.status,
                total_items=job.total_items,
                processed_items=job.processed_items,
                current_item=job.current_item,
                error_message=job.error_message,
                started_at=job.started_at,
                completed_at=job.completed_at
            ) for job in jobs
        ]}
    except Exception as e:
        print(f"Error getting jobs: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get jobs: {e}")

@app.delete("/api/data-sources/jobs/{job_id}")
def cancel_indexing_job(job_id: str) -> dict:
    """Cancel an indexing job."""
    if not data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        success = data_source_manager.cancel_job(job_id)
        if not success:
            raise HTTPException(status_code=404, detail="Job not found or not running")

        return {"success": True, "message": "Job cancelled successfully"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error cancelling job: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to cancel job: {e}")

class DeleteDocumentsRequest(BaseModel):
    document_ids: List[str]

@app.get("/api/data-sources/documents")
def get_indexed_documents() -> dict:
    """Get list of indexed documents."""
    if not vector_store_service:
        raise HTTPException(status_code=503, detail="Vector store not available.")

    try:
        # Get all documents from the collection
        results = vector_store_service.chroma.collection.get(include=["metadatas"])

        # Group by document_id and aggregate metadata
        documents_by_id = {}
        metadatas = results.get("metadatas", [])
        if metadatas:
            for metadata in metadatas:
                doc_id = metadata.get("document_id")
                if doc_id:
                    if doc_id not in documents_by_id:
                        documents_by_id[doc_id] = {
                            "id": doc_id,
                            "title": metadata.get("page_title", "Untitled"),
                            "source_type": metadata.get("source_type", "unknown"),
                            "source_url": metadata.get("source_url", ""),
                            "last_modified": metadata.get("last_modified"),
                            "file_size": metadata.get("file_size"),
                            "page_count": metadata.get("page_count"),
                            "status": "indexed",
                            "chunk_count": 0
                        }
                    documents_by_id[doc_id]["chunk_count"] += 1

        documents = list(documents_by_id.values())

        return {"documents": documents}
    except Exception as e:
        print(f"Error getting indexed documents: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get indexed documents: {e}")

@app.get("/api/data-sources/stats")
def get_data_source_stats() -> dict:
    """Get statistics about indexed data sources."""
    if not vector_store_service:
        raise HTTPException(status_code=503, detail="Vector store not available.")

    try:
        # Get all documents from the collection
        results = vector_store_service.chroma.collection.get(include=["metadatas"])

        # Calculate stats
        total_documents = 0
        total_size = 0
        sources = {}
        last_updated = None

        metadatas = results.get("metadatas", [])
        if metadatas:
            document_ids = set()
            for metadata in metadatas:
                doc_id = metadata.get("document_id")
                if doc_id and doc_id not in document_ids:
                    document_ids.add(doc_id)
                    total_documents += 1

                    # Add file size if available (ensure it's a number)
                    file_size = metadata.get("file_size")
                    if file_size and isinstance(file_size, (int, float)):
                        total_size += int(file_size)

                    # Track source types
                    source_type = metadata.get("source_type", "unknown")
                    if source_type not in sources:
                        sources[source_type] = {
                            "count": 0,
                            "size": 0,
                            "last_updated": None
                        }

                    sources[source_type]["count"] += 1
                    if file_size and isinstance(file_size, (int, float)):
                        sources[source_type]["size"] += int(file_size)

                    # Update last modified (ensure it's a string/date)
                    doc_last_modified = metadata.get("last_modified")
                    if doc_last_modified and isinstance(doc_last_modified, str):
                        if not last_updated or doc_last_modified > last_updated:
                            last_updated = doc_last_modified
                        if not sources[source_type]["last_updated"] or doc_last_modified > sources[source_type]["last_updated"]:
                            sources[source_type]["last_updated"] = doc_last_modified

        return {
            "total_documents": total_documents,
            "total_size": total_size,
            "last_updated": last_updated,
            "sources": sources
        }
    except Exception as e:
        print(f"Error getting data source stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get data source stats: {e}")

@app.delete("/api/data-sources/documents")
def delete_documents(request: DeleteDocumentsRequest) -> dict:
    """Delete documents by their IDs."""
    if not vector_store_service:
        raise HTTPException(status_code=503, detail="Vector store not available.")

    try:
        deleted_count = 0
        for document_id in request.document_ids:
            try:
                vector_store_service.delete_document(document_id)
                deleted_count += 1
            except Exception as e:
                print(f"Error deleting document {document_id}: {e}")
                # Continue with other documents even if one fails

        return {
            "success": True,
            "message": f"Successfully deleted {deleted_count} out of {len(request.document_ids)} documents",
            "deleted_count": deleted_count
        }
    except Exception as e:
        print(f"Error deleting documents: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete documents: {e}")

# --- File Upload Endpoints ---

@app.post("/api/files/upload")
async def upload_files(request: Request, files: List[UploadFile] = File(...)) -> FileUploadResponse:
    """Upload files for indexing."""
    import tempfile
    import os
    from pathlib import Path

    if not data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    # Rate limiting check
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(client_ip):
        raise HTTPException(
            status_code=429,
            detail="Upload rate limit exceeded. Please try again later."
        )

    try:
        # Create temporary directory for uploads
        upload_dir = tempfile.mkdtemp(prefix="cabin_upload_")
        upload_path = Path(upload_dir)

        uploaded_files = []
        failed_files = []

        # Save uploaded files
        for file in files:
            try:
                # Validate file
                if not file.filename:
                    failed_files.append({"name": "unknown", "error": "No filename provided"})
                    continue

                # Sanitize filename to prevent path traversal attacks
                import re
                from pathlib import Path

                # Remove any path separators and dangerous characters
                safe_filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', file.filename)
                # Remove path traversal attempts
                safe_filename = re.sub(r'\.\.+', '.', safe_filename)
                # Ensure filename is not empty after sanitization
                if not safe_filename.strip():
                    safe_filename = f"unnamed_file_{len(uploaded_files) + len(failed_files)}"

                # Limit filename length to prevent issues
                name_part, ext_part = Path(safe_filename).stem, Path(safe_filename).suffix
                if len(name_part) > 100:
                    name_part = name_part[:100]
                safe_filename = name_part + ext_part.lower()

                file_path = upload_path / safe_filename

                # Check file extension (case-insensitive)
                allowed_extensions = {'.pdf', '.docx', '.docm', '.md', '.markdown', '.mdown', '.mkd', '.html', '.htm', '.txt', '.text', '.log', '.csv'}
                if file_path.suffix.lower() not in allowed_extensions:
                    failed_files.append({"name": file.filename, "error": "Unsupported file type"})
                    continue

                # Save file with streaming size validation
                MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB limit (reduced from 50MB)
                bytes_written = 0
                file_too_large = False

                try:
                    with open(file_path, "wb") as f:
                        # Read file in chunks to prevent memory exhaustion
                        chunk_size = 64 * 1024  # 64KB chunks
                        while bytes_written < MAX_FILE_SIZE:
                            chunk = await file.read(chunk_size)
                            if not chunk:
                                break

                            # Check size limit during streaming
                            bytes_written += len(chunk)
                            if bytes_written > MAX_FILE_SIZE:
                                file_too_large = True
                                break

                            f.write(chunk)

                    if file_too_large:
                        # Remove partial file
                        if file_path.exists():
                            file_path.unlink()
                        failed_files.append({"name": file.filename, "error": "File too large (max 10MB)"})
                    else:
                        # Validate file content after successful upload
                        if not validate_file_content(file_path, file_path.suffix):
                            # Remove invalid file
                            file_path.unlink()
                            failed_files.append({"name": file.filename, "error": "File content does not match expected type"})
                        else:
                            uploaded_files.append(file.filename)

                except Exception as e:
                    # Clean up partial file on error
                    if file_path.exists():
                        file_path.unlink()
                    logger.error(f"Error processing file {file.filename}: {e}")
                    failed_files.append({"name": file.filename, "error": "Failed to process file"})
                    continue

            except Exception as e:
                failed_files.append({"name": file.filename, "error": str(e)})

        if not uploaded_files:
            # Clean up empty directory
            os.rmdir(upload_dir)
            return FileUploadResponse(
                success=False,
                message="No files were successfully uploaded",
                files_failed=len(failed_files)
            )

        return FileUploadResponse(
            success=True,
            message=f"Successfully uploaded {len(uploaded_files)} files",
            files_processed=len(uploaded_files),
            files_failed=len(failed_files),
            upload_id=upload_dir  # Return full path instead of just basename
        )

    except Exception as e:
        logger.error(f"Error uploading files: {e}")
        raise HTTPException(status_code=500, detail="Upload failed")

# Background cleanup task for temporary files (runs periodically)
def cleanup_temp_files():
    """Clean up old temporary upload directories."""
    import tempfile
    import shutil
    from datetime import datetime, timedelta

    try:
        temp_dir = Path(tempfile.gettempdir())
        cutoff_time = datetime.now() - timedelta(hours=24)  # Clean files older than 24 hours

        for item in temp_dir.glob("cabin_upload_*"):
            if item.is_dir():
                try:
                    # Check if directory is old enough to clean up
                    stat = item.stat()
                    if datetime.fromtimestamp(stat.st_mtime) < cutoff_time:
                        shutil.rmtree(item)
                        print(f"Cleaned up old temp directory: {item}")
                except Exception as e:
                    print(f"Failed to clean up {item}: {e}")

    except Exception as e:
        print(f"Error during temp file cleanup: {e}")

# Run cleanup on startup
cleanup_temp_files()

@app.post("/api/files/index", status_code=202)
async def index_uploaded_files(request: FileUploadRequest) -> DataSourceIndexResponse:
    """Index previously uploaded files."""
    if not data_source_manager:
        raise HTTPException(status_code=503, detail="Data source manager not available.")

    try:
        # Start indexing job using the data source manager
        indexing_config = {
            "max_items": request.config.get("max_items", 1000),
            "include_attachments": False,
            "incremental": False,
            "filters": request.config.get("filters", {})
        }

        job_id = await data_source_manager.start_indexing(
            "file_upload",
            {"additional_config": {"upload_path": request.upload_path}},
            [],  # source_ids not needed for file upload
            indexing_config
        )

        return DataSourceIndexResponse(
            job_id=job_id,
            status="started",
            message="File indexing job started successfully"
        )

    except Exception as e:
        print(f"Error starting file indexing: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start file indexing: {e}")

# --- Service Management Endpoints ---

@app.post("/api/services/vector-store/reconnect")
def reconnect_vector_store() -> dict:
    """Manually trigger ChromaDB reconnection."""
    if not vector_store_service:
        raise HTTPException(status_code=503, detail="Vector store service not available.")

    try:
        # Force reconnection
        vector_store_service._initialize_chroma()
        return {"success": True, "message": "Vector store reconnected successfully"}
    except Exception as e:
        print(f"Error reconnecting vector store: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to reconnect vector store: {e}")

@app.get("/api/services/status")
def get_services_status() -> dict:
    """Get detailed status of all services."""
    status = {
        "chunker": chunker_service is not None,
        "vector_store": vector_store_service is not None and vector_store_service.health_check() if vector_store_service else False,
        "generator": generator_service is not None,
        "data_source_manager": data_source_manager is not None
    }

    return {
        "services": status,
        "overall_health": all(status.values())
    }
