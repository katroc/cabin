import logging
import os
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse

from pydantic import BaseModel, Field

from .models import (
    IngestRequest, ChatRequest, ChatResponse,
    DataSourceIndexRequest, DataSourceDiscoveryRequest, DataSourceTestRequest,
    DataSourceIndexResponse, DataSourceProgressResponse, DataSourceInfoResponse
)
from .chunker import SemanticChunker
from .vector_store import VectorStore
from .generator import Generator
from .data_sources.manager import DataSourceManager
from .data_sources.confluence import ConfluenceDataSource  # Import to register
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
    """Endpoint for standard, non-streaming chat."""
    if not vector_store_service or not generator_service:
        raise HTTPException(status_code=503, detail="Chat service not available.")

    try:
        context_chunks = vector_store_service.query(request.message, filters=request.filters)
        logger.debug("Chat query '%s' retrieved %d context chunks", request.message, len(context_chunks))
        if not context_chunks:
            logger.warning("No context chunks found for query '%s'", request.message)
        response = generator_service.ask(request.message, context_chunks)
        if response.response == "Not found in docs.":
            logger.warning("LLM returned fallback for query '%s'", request.message)
        return response
    except Exception as e:
        print(f"Error during chat: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process chat request: {e}")

@app.post("/api/chat/stream")
def chat_stream(request: ChatRequest):
    """Endpoint for streaming chat responses."""
    if not vector_store_service or not generator_service:
        raise HTTPException(status_code=503, detail="Chat service not available.")

    try:
        context_chunks = vector_store_service.query(request.message, filters=request.filters)
        logger.debug("Streaming chat query '%s' retrieved %d context chunks", request.message, len(context_chunks))
        if not context_chunks:
            logger.warning("No context chunks found for streaming query '%s'", request.message)
        stream = generator_service.ask_stream(request.message, context_chunks)
        return StreamingResponse(stream, media_type="text/plain")
    except Exception as e:
        print(f"Error during streaming chat: {e}")
        # Cannot return a standard HTTPException body in a streaming response that may have already started.
        # The client will see a dropped connection.
        # Proper handling would involve a more complex setup.
        return StreamingResponse("Error processing request.", media_type="text/plain", status_code=500)


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
