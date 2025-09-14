# Handover Notes for Claude

This document outlines the recent work done to implement a new Python backend for the Cabin RAG assistant.

### Project Goal

The primary objective was to begin migrating the existing TypeScript-based RAG backend to a new Python-based service. The new service was built from the ground up to implement a "Gold Standard" architecture known as a **Parent Document Retriever**, based on specifications provided by the user.

### Work Completed

1.  **Project Scaffolding**: A new, self-contained Python project was created in `packages/backend-python/`.
2.  **Dependency Management**: The project was initially set up with `pdm` and a `pyproject.toml`. To address user environment issues, a `requirements.txt` file was also generated for a standard `pip`-based workflow.
3.  **Architecture Implementation**: The Parent Document Retriever strategy was implemented in a modular fashion:
    *   **`config.py`**: Manages all application settings (DB/LLM connections, model names, etc.) from environment variables.
    *   **`models.py`**: Contains Pydantic models for core data structures like `ParentChunk`, `ChildChunk`, `IngestRequest`, and `ChatResponse`.
    *   **`chunker.py`**: Implements a `SemanticChunker` that parses HTML, identifies logical parent chunks (e.g., sections under headings), and splits them into smaller child chunks.
    *   **`vector_store.py`**: Contains a `VectorStore` class that:
        *   Connects to ChromaDB.
        *   Generates embeddings for **child chunks**.
        *   Stores child chunk vectors with their metadata, which crucially includes the full text of the original **parent chunk**.
        *   Implements the retrieval logic: search for child chunks, then extract and de-duplicate the parent chunks from the metadata to pass to the LLM.
    *   **`generation.py`**: Implements a `Generator` class to construct prompts using the retrieved parent chunks and generate both streaming and non-streaming responses from an OpenAI-compatible LLM.
    *   **`main.py`**: A FastAPI application that exposes the entire pipeline through a REST API, with endpoints like `/api/chat`, `/api/chat/stream`, and `/api/index`.

### Current Status

*   The new Python backend is fully coded and operational.
*   It is configured to run on `http://localhost:8788`.
*   The user has been provided with instructions to install dependencies via `pip install -r packages/backend-python/requirements.txt` and run the server.
*   The original TypeScript backend in `packages/backend` is untouched and can be run independently, but is not part of the new workflow.

### Immediate Next Steps

The next logical task is to connect the existing frontend to this new backend.

1.  **Locate the API logic** in the frontend application at `packages/web-ui/` (likely within the `components/` directory, e.g., `ChatInterface.tsx`).
2.  **Modify the API calls** to point to the new Python backend's endpoints (e.g., change requests from `/api/chat` to `http://localhost:8788/api/chat`).
3.  **Test the end-to-end functionality** of the web UI with the new Python backend.
