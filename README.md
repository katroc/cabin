# 🏠 Cabin RAG Assistant

*A comprehensive Retrieval-Augmented Generation (RAG) system with intelligent query routing, conversation memory, and multi-source data integration.*

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Features](#-features)
- [Quick Start](#-quick-start)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [API Documentation](#-api-documentation)
- [Development](#-development)
- [Deployment](#-deployment)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)

## 🎯 Overview

Cabin is a sophisticated **air-gapped RAG assistant** that intelligently routes queries between conversational AI and retrieval-augmented responses. Built with a fully self-contained architecture, it features:

- **Intelligent Query Routing**: Automatically determines when to use RAG vs. direct LLM responses based on content similarity
- **Air-Gapped Operation**: Complete offline capability with all models and processing running locally
- **Advanced Conversation Memory**: Persistent multi-turn conversation context and history management
- **Multi-Source Integration**: Support for Confluence, file uploads, and extensible data sources
- **Performance Monitoring**: Comprehensive real-time metrics and performance tracking
- **Streaming Support**: Real-time token streaming for enhanced user experience

**Key Technologies**:
- **BGE-M3** for semantic embeddings and document understanding
- **BGE-Reranker-V2-M3** for precision document reranking
- **GPT-OSS-20B** for high-quality response generation
- **ChromaDB** for local vector storage and retrieval

## 🏗️ Architecture

### System Components

**Backend (Python/FastAPI)**
- RESTful API server with comprehensive RAG functionality
- **BGE-M3** embedding model for semantic document understanding
- **BGE-Reranker-V2-M3** for precision document reranking
- **GPT-OSS-20B** language model for response generation
- Vector store integration with ChromaDB for local document storage
- Document chunking and indexing with parent document strategy
- Intelligent query routing and conversation management
- Performance monitoring and real-time metrics collection

**Frontend (Next.js/React)**
- Modern web interface for document management and chat
- Real-time chat interface with streaming support
- Data source configuration and management interface
- Performance dashboard with live metrics and analytics
- RAG/LLM mode toggle and conversation memory controls

**Infrastructure (Air-Gapped)**
- **vLLM** containerized models for local inference
- **ChromaDB** for local vector storage and retrieval
- **Docker containerization** for complete self-contained deployment
- **No external dependencies** - all processing happens on-premises

### Data Flow

1. **Document Ingestion**: Documents are chunked, embedded, and stored in vector database
2. **Query Processing**: User queries are routed based on similarity to existing knowledge
3. **Context Retrieval**: Relevant document chunks are retrieved using hybrid search
4. **Response Generation**: LLM generates response with retrieved context and citations
5. **Conversation Management**: Context is maintained across conversation turns

## ✨ Features

### 🔄 Intelligent Query Routing & Mode Toggle
- **RAG/LLM Mode Toggle**: Seamlessly switch between retrieval-augmented generation and direct LLM responses
- **Automatic Query Classification**: AI-powered routing determines when to use RAG vs. conversational AI
- **Direct LLM Endpoints**: Dedicated `/api/chat/direct` endpoints for bypassing RAG entirely
- **Fallback Mechanisms**: Automatic fallback from RAG to conversational mode when retrieval fails

### 🧠 Advanced Conversation Memory
- **Persistent Context**: Maintain conversation history across sessions and browser refreshes
- **Contextual Awareness**: System remembers previous questions and responses for coherent multi-turn conversations
- **Memory Management**: Configurable message history limits and automatic cleanup
- **Conversation Threads**: Support for multiple parallel conversation threads

### 🔍 Semantic Search & Reranking
- **BGE-M3 Embeddings**: State-of-the-art embedding model for semantic document understanding
- **Hybrid Retrieval**: Combines BM25 lexical search with dense vector semantic search
- **BGE-Reranker-V2-M3**: Advanced reranking model for improving retrieval precision
- **RM3 Query Expansion**: Pseudo-relevance feedback for enhanced query understanding
- **Configurable Reranking**: Enable/disable reranking with fallback options

### 🌐 Air-Gapped Operation
- **Complete Offline Capability**: All models and processing run locally without internet dependency
- **Self-Contained Deployment**: Docker containers include all required models and dependencies
- **No External API Calls**: All inference happens on-premises for security and privacy
- **Local Vector Storage**: ChromaDB runs locally for document indexing and retrieval

### Core RAG Capabilities
- **Parent Document Retriever**: Hierarchical document chunking strategy preserving document structure
- **Intelligent Routing**: Query router determines optimal response strategy based on content similarity
- **Citation Support**: Automatic source citation and provenance tracking with direct links
- **Provenance Enforcement**: Configurable requirements for citation-backed responses

### Data Source Integration
- **Confluence Integration**: Direct integration with Confluence spaces and page hierarchies
- **File Upload**: Support for PDF, DOCX, TXT, MD, HTML, CSV files with content validation
- **Extensible Architecture**: Plugin system for adding new data source connectors
- **Bulk Operations**: Batch document indexing with progress tracking and error handling
- **Advanced Document Management**: Multi-view interface (table, grid, list) with pagination
- **Comprehensive Filtering**: Filter by source type, date range, file size, tags, and content type
- **Document Statistics**: Real-time stats on indexed documents, storage usage, and source distribution

### Performance & Monitoring
- **Real-time Metrics**: Request latency, token usage, and system performance tracking
- **Advanced Performance Dashboard**: Live visual analytics with component-level timing breakdown
- **vLLM Integration**: Real-time monitoring of model performance, GPU utilization, and token throughput
- **Component Analytics**: Detailed breakdown of retrieval, reranking, and generation performance
- **Query Router Statistics**: Analytics on routing decisions and similarity scoring
- **Conversation Memory Stats**: Memory usage tracking and conversation lifecycle management
- **System Health Monitoring**: Live status of all services and model availability

### Security & Reliability
- **Rate Limiting**: Built-in protection against upload abuse (20 uploads/hour per IP)
- **File Content Validation**: Magic byte verification to prevent malicious file uploads
- **Input Sanitization**: Comprehensive validation of filenames and file paths
- **Error Handling**: Graceful degradation and fallback mechanisms
- **Resource Protection**: Configurable limits on file sizes and processing resources

### User Experience
- **Streaming Responses**: Real-time token streaming for better UX and perceived performance
- **File Management**: Upload, index, and manage documents through intuitive web UI
- **Advanced Filtering**: Filter documents by source type, date, size, tags, and content type
- **Performance Insights**: Real-time performance metrics and system health monitoring
- **Multi-View Interface**: Table, grid, and list views for document management
- **Bulk Operations**: Select and manage multiple documents simultaneously

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose
- Python 3.9+
- Node.js 18+
- GPU with CUDA support (recommended for vLLM)

### One-Command Setup
```bash
# Clone the repository
git clone <repository-url>
cd cabin

# Start all services
python start.py
```

The system will be available at:
- **Web UI**: http://localhost:3000
- **API**: http://localhost:8788
- **ChromaDB**: http://localhost:8000

## 📦 Installation

### Prerequisites (Air-Gapped Ready)
- Docker and Docker Compose (for containerized deployment)
- Python 3.9+ (for manual installation)
- Node.js 18+ (for frontend development)
- GPU with CUDA support (recommended for optimal performance)
- **No internet required** after initial setup - all models run locally

### Manual Installation

**Backend Setup**
```bash
cd packages/backend-python
python -m venv cabin-venv
source cabin-venv/bin/activate  # On Windows: cabin-venv\Scripts\activate
pip install -r requirements.txt
```

**Frontend Setup**
```bash
cd packages/web-ui
npm install
```

**Model Setup (Local Models)**
The system uses three specialized models that run entirely on-premises:

- **BGE-M3** (`BAAI/bge-m3`): Advanced embedding model for semantic understanding
- **BGE-Reranker-V2-M3** (`BAAI/bge-reranker-v2-m3`): Precision reranking model
- **GPT-OSS-20B**: High-quality language model for response generation

All models are containerized and run locally - no external API calls required.

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# LLM Configuration
CABIN_LLM_BASE_URL=http://localhost:8000/v1
CABIN_LLM_MODEL=gpt-oss-20b

# Embedding Configuration
CABIN_EMBEDDING_BASE_URL=http://localhost:8001/v1
CABIN_EMBEDDING_MODEL=bge-m3

# Vector Store Configuration
CABIN_CHROMA_HOST=localhost
CABIN_CHROMA_PORT=8000

# Reranker Configuration
CABIN_RERANKER_URL=http://localhost:8002/v1
CABIN_RERANKER_MODEL=bge-reranker-v2-m3

# Feature Flags
CABIN_USE_RERANKER=true
CABIN_USE_RM3=true
CABIN_ALLOW_RERANKER_FALLBACK=true

# Performance Settings
CABIN_FINAL_PASSAGES=10
CABIN_COSINE_FLOOR=0.1
CABIN_MIN_KEYWORD_OVERLAP=2

# Logging
CABIN_LOG_LEVEL=INFO
```

### Configuration Files

- `config/app.yaml`: Main application configuration
- `packages/backend-python/pyproject.toml`: Python dependencies and scripts
- `packages/web-ui/package.json`: Frontend dependencies and scripts

## 📚 API Documentation

### Core Endpoints

**Chat Endpoints**
- `POST /api/chat` - Standard chat with intelligent RAG routing
- `POST /api/chat/stream` - Streaming chat with RAG routing
- `POST /api/chat/direct` - **Direct LLM mode** - bypasses RAG entirely
- `POST /api/chat/direct/stream` - **Direct streaming mode** - conversational AI only

**Document Management**
- `POST /api/index` - Index single document
- `DELETE /api/index` - Clear entire index
- `GET /api/data-sources/documents` - List indexed documents
- `DELETE /api/data-sources/documents` - Delete specific documents

**Data Source Integration**
- `GET /api/data-sources` - Available data source types
- `POST /api/data-sources/test-connection` - Test data source connection
- `POST /api/data-sources/index` - Start indexing job
- `GET /api/data-sources/jobs/{job_id}` - Check indexing progress

**File Upload**
- `POST /api/files/upload` - Upload files for indexing
- `POST /api/files/index` - Index uploaded files

**Performance Monitoring**
- `GET /api/performance/summary` - Performance statistics and trends
- `GET /api/performance/metrics` - Detailed request metrics with filtering
- `GET /api/performance/vllm` - vLLM service metrics and health status
- `GET /api/performance/components` - Component-level performance breakdown
- `GET /api/performance/trends` - Time-series performance data
- `GET /api/query-router/stats` - Query routing statistics and configuration
- `GET /api/conversations/stats` - Conversation memory statistics

### Request/Response Examples

**Chat Request with Conversation Memory**
```json
{
  "message": "What are the main features of Cabin?",
  "conversation_id": "conv-456",  // Maintains conversation context
  "filters": {}
}
```

**Chat Response with Citations**
```json
{
  "response": "Cabin is a RAG assistant with intelligent query routing...",
  "citations": [
    {
      "document_id": "doc-123",
      "page_title": "Cabin Overview",
      "source_url": "https://...",
      "chunk_text": "Cabin provides intelligent..."
    }
  ],
  "conversation_id": "conv-456"  // Consistent across conversation
}
```

**Direct LLM Mode (No RAG)**
```json
{
  "message": "Tell me a joke",
  "conversation_id": "conv-789"
}
```

**Conversation Memory Management**
- Automatic context preservation across multiple turns
- Configurable message history limits
- Persistent storage across sessions
- Support for multiple parallel conversations

## 🛠️ Development

### Development Workflow

1. **Code Organization**
   - `packages/backend-python/`: Python backend services
   - `packages/web-ui/`: Next.js frontend application
   - `config/`: Configuration files
   - `ref/`: Reference implementation

2. **Running in Development Mode**
   ```bash
   # Start backend in development mode
   cd packages/backend-python
   uvicorn cabin_backend.main:app --reload --host 0.0.0.0 --port 8788

   # Start frontend in development mode
   cd packages/web-ui
   npm run dev
   ```

3. **Testing**
   ```bash
   # Backend tests
   cd packages/backend-python
   python -m pytest

   # Frontend tests
   cd packages/web-ui
   npm test
   ```

### Testing & Development Tools

- **Comprehensive Test Suite**: Unit tests for core functionality including deduplication and generation
- **Code Quality Tools**:
  - **Backend**: Black, isort, mypy for Python code quality
  - **Frontend**: ESLint, TypeScript for JavaScript/React code quality
- **Pre-commit Hooks**: Automated formatting and linting
- **Development Server**: Hot-reload for both backend and frontend development
- **Debug Endpoints**: Dedicated endpoints for troubleshooting and diagnostics

## 🚢 Deployment

### Air-Gapped Docker Deployment

Cabin is designed for **complete air-gapped operation** - all services, models, and data processing run locally without any external dependencies.

```bash
# Build and start all services (completely offline after initial setup)
docker-compose up --build

# Production deployment (self-contained)
docker-compose -f docker-compose.prod.yml up -d
```

### System Requirements

- **Minimum**: 16GB RAM, 4-core CPU, 50GB storage
- **Recommended**: 32GB RAM, 8-core CPU, GPU with 8GB+ VRAM, 100GB storage
- **Storage Breakdown**:
  - Models: ~40GB (BGE-M3, BGE-Reranker-V2-M3, GPT-OSS-20B)
  - Vector Storage: Variable based on indexed documents
  - Application: ~10GB for containers and dependencies

### Air-Gapped Considerations

- **No External API Dependencies**: All inference happens locally
- **Local Model Storage**: Models are stored in Docker volumes
- **Offline Document Processing**: All document indexing and retrieval is local
- **Self-Contained Services**: ChromaDB, vLLM, and all services run in containers

## 🔧 Troubleshooting

### Common Issues

**ChromaDB Connection Issues**
```bash
# Check ChromaDB status
curl http://localhost:8000/api/v1/heartbeat

# Restart ChromaDB
docker restart chroma
```

**vLLM Model Loading Issues**
```bash
# Check model availability
curl http://localhost:8000/v1/models

# Verify GPU memory
nvidia-smi
```

**Performance Issues**
```bash
# Check system resources
docker stats

# Monitor vLLM metrics
curl http://localhost:8000/metrics
```

### Debug Mode

Enable debug logging:
```env
CABIN_LOG_LEVEL=DEBUG
VLLM_LOG_LEVEL=DEBUG
```

## 🤝 Contributing

### Development Setup
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Run tests: `npm test && python -m pytest`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

### Code Standards
- Follow PEP 8 for Python code
- Use TypeScript for frontend code
- Write comprehensive tests for new features
- Update documentation for API changes

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [FastAPI](https://fastapi.tiangolo.com/)
- Powered by [vLLM](https://github.com/vllm-project/vllm)
- Vector storage with [ChromaDB](https://www.trychroma.com/)
- Frontend built with [Next.js](https://nextjs.org/)

---

**Need Help?** Check the [Troubleshooting](#-troubleshooting) section or open an issue on GitHub.

This comprehensive README provides everything needed to understand, install, configure, and contribute to the Cabin RAG Assistant project.