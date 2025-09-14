from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse

from .models import IngestRequest, ChatRequest, ChatResponse
from .chunker import SemanticChunker
from .vector_store import VectorStore
from .generation import Generator

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
    vector_store_service = VectorStore()
    generator_service = Generator()
except Exception as e:
    # If services fail to initialize (e.g., can't connect to ChromaDB),
    # log the error and prevent the app from starting gracefully.
    print(f"FATAL: Could not initialize services: {e}")
    # In a real app, you might exit or have a more robust health check system.
    # For now, endpoints will fail with a 503 if services are not available.
    chunker_service = None
    vector_store_service = None
    generator_service = None

# --- Health Check ---
@app.get("/health")
def health_check():
    if not all([chunker_service, vector_store_service, generator_service]):
        raise HTTPException(status_code=503, detail="Services are not available.")
    return {"status": "ok"}

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
        response = generator_service.ask(request.message, context_chunks)
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
        stream = generator_service.ask_stream(request.message, context_chunks)
        return StreamingResponse(stream, media_type="text/plain")
    except Exception as e:
        print(f"Error during streaming chat: {e}")
        # Cannot return a standard HTTPException body in a streaming response that may have already started.
        # The client will see a dropped connection.
        # Proper handling would involve a more complex setup.
        return StreamingResponse("Error processing request.", media_type="text/plain", status_code=500)
