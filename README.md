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

Cabin is a sophisticated RAG assistant that intelligently routes queries between conversational AI and retrieval-augmented responses. Built with a microservices architecture, it features:

- **Intelligent Query Routing**: Automatically determines when to use RAG vs. direct LLM responses
- **Multi-Source Integration**: Support for Confluence, file uploads, and extensible data sources
- **Conversation Memory**: Persistent conversation context and history management
- **Performance Monitoring**: Comprehensive metrics and performance tracking
- **Streaming Support**: Real-time streaming responses for better UX

## 🏗️ Architecture

### System Components

**Backend (Python/FastAPI)**
- RESTful API server with comprehensive RAG functionality
- Vector store integration with ChromaDB
- Document chunking and indexing
- Query routing and conversation management
- Performance monitoring and metrics collection

**Frontend (Next.js/React)**
- Modern web interface for document management
- Real-time chat interface with streaming support
- Data source configuration and management
- Performance dashboard and analytics

**Infrastructure**
- vLLM models for embeddings and reranking
- ChromaDB for vector storage
- Docker containerization for easy deployment

### Data Flow

1. **Document Ingestion**: Documents are chunked, embedded, and stored in vector database
2. **Query Processing**: User queries are routed based on similarity to existing knowledge
3. **Context Retrieval**: Relevant document chunks are retrieved using hybrid search
4. **Response Generation**: LLM generates response with retrieved context and citations
5. **Conversation Management**: Context is maintained across conversation turns

## ✨ Features

### Core RAG Capabilities
- **Parent Document Retriever**: Hierarchical document chunking strategy
- **Hybrid Search**: Combines lexical (BM25) and semantic (dense) retrieval
- **Intelligent Routing**: Query router determines optimal response strategy
- **Citation Support**: Automatic source citation and provenance tracking

### Data Source Integration
- **Confluence Integration**: Direct integration with Confluence spaces
- **File Upload**: Support for PDF, DOCX, TXT, MD, HTML, CSV files
- **Extensible Architecture**: Plugin system for additional data sources

### Performance & Monitoring
- **Real-time Metrics**: Request latency, token usage, and system performance
- **vLLM Integration**: Live monitoring of model performance
- **Performance Dashboard**: Visual analytics and bottleneck identification

### User Experience
- **Streaming Responses**: Real-time token streaming for better UX
- **Conversation Memory**: Persistent conversation history and context
- **Direct LLM Mode**: Bypass RAG for conversational queries
- **File Management**: Upload, index, and manage documents through web UI

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

**vLLM Models Setup**
```bash
# Download required models
# BGE-M3 embedding model
# BGE-Reranker-V2-M3 reranking model
# GPT-OSS-20B language model
```

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
- `POST /api/chat` - Standard chat with RAG routing
- `POST /api/chat/stream` - Streaming chat responses
- `POST /api/chat/direct` - Direct LLM chat (no RAG)
- `POST /api/chat/direct/stream` - Direct streaming chat

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
- `GET /api/performance/summary` - Performance statistics
- `GET /api/performance/metrics` - Detailed request metrics
- `GET /api/performance/vllm` - vLLM service metrics

### Request/Response Examples

**Chat Request**
```json
{
  "message": "What are the main features of Cabin?",
  "conversation_id": "optional-conversation-id",
  "filters": {}
}
```

**Chat Response**
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
  "conversation_id": "conv-456"
}
```

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

### Code Quality

- **Backend**: Black, isort, mypy for Python code quality
- **Frontend**: ESLint, TypeScript for JavaScript/React code quality
- **Pre-commit Hooks**: Automated formatting and linting

## 🚢 Deployment

### Docker Deployment

```bash
# Build and start all services
docker-compose up --build

# Production deployment
docker-compose -f docker-compose.prod.yml up -d
```

### System Requirements

- **Minimum**: 16GB RAM, 4-core CPU
- **Recommended**: 32GB RAM, 8-core CPU, GPU with 8GB+ VRAM
- **Storage**: 50GB+ for models and vector storage

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