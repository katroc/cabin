# RAG Documentation Assistant - Technical Handover

## Overview

This is a **RAG (Retrieval Augmented Generation) documentation assistant** that enables intelligent querying of Confluence documentation. The system crawls Confluence spaces, embeds content in vector databases, and provides contextual AI-powered responses with citations.

## Core Architecture

### High-Level Components

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│   Web UI    │───▶│ MCP Server   │───▶│   Chroma    │
│ (React SPA) │    │ (Fastify)    │    │ (Vector DB) │
└─────────────┘    └──────────────┘    └─────────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │   Confluence    │
                   │   (Data Source) │
                   └─────────────────┘
```

### Technology Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Node.js + Fastify + TypeScript
- **Vector Database**: ChromaDB (with LanceDB fallback)
- **Embeddings**: BGE-M3 via Ollama/LM Studio
- **LLM**: Any OpenAI-compatible API (LM Studio recommended)
- **Containerization**: Docker + Docker Compose

## Core Application Logic

### 1. Data Ingestion Pipeline

**Confluence Crawler** (`packages/mcp-server/src/sources/confluence-crawler.ts`)
- Fetches pages from Confluence REST API using CQL queries
- Supports space filtering, pagination, and concurrent processing
- Handles authentication (username/password or API tokens)
- Extracts clean text from HTML content

**Chunking Strategy** (`packages/mcp-server/src/retrieval/chunking.ts`)
- **Simple Chunking**: Fixed-size chunks with overlap (800 chars, 200 overlap)
- **Semantic Chunking**: LLM-guided content-aware splitting
- **Universal Chunker**: Configurable strategy selection

**Embedding Generation** (`packages/mcp-server/src/llm/embeddings.ts`)
- Uses BGE-M3 model for high-quality embeddings (768 dimensions)
- Provider-agnostic design (works with any OpenAI-compatible embedding API)
- Batch processing for efficiency
- Normalization options for better similarity search

### 2. RAG Pipeline Architecture

**Multi-Pipeline Strategy** (`packages/mcp-server/src/orchestrator.ts`)
1. **Optimized Pipeline**: Advanced embeddings + semantic chunking
2. **Smart Pipeline**: LLM-powered document analysis when vector search fails
3. **Traditional Pipeline**: Standard vector similarity + keyword fallback

**Query Processing Flow**:
```
User Query → Intent Processing → Pipeline Selection → Vector Search 
→ Live Search Fallback → LLM Ranking → Context Building → LLM Response
```

**Key Features**:
- **Intent Processing**: Query normalization and fallback generation
- **Hybrid Search**: Vector similarity + keyword search
- **Live Search**: Real-time Confluence API queries when vector DB is empty
- **Background Indexing**: Automatic embedding generation for new content

### 3. Response Generation

**Context Building**:
- Combines retrieved chunks into structured context
- Maintains citation mapping for source attribution
- Deduplicates citations while preserving reference integrity

**LLM Integration**:
- OpenAI-compatible API calls with configurable models
- Structured system prompts for consistent formatting
- Citation enforcement and markdown formatting
- Streaming support for real-time responses

## Critical Implementation Details

### Environment Configuration

**Essential Environment Variables**:
```bash
# LLM Configuration
LLM_BASE_URL=http://localhost:1234        # LM Studio URL
EMBEDDING_BASE_URL=http://localhost:1234  # Same as LLM for BGE-M3

# Confluence Configuration
CONFLUENCE_BASE_URL=https://your-confluence.com
CONFLUENCE_USERNAME=your-username
CONFLUENCE_PASSWORD=your-password  # or API token

# Vector Database
CHROMA_HOST=chroma                 # Docker service name
CHROMA_PORT=8000
USE_REAL_VECTORDB=true
VECTOR_STORE=chroma               # or 'lancedb'

# Pipeline Configuration
USE_OPTIMIZED_PIPELINE=true
USE_SMART_PIPELINE=false         # Smart fallback when optimized fails
ENABLE_INTENT_PROCESSING=true
```

### Database Schema

**ChromaDB Collections**:
- **Primary**: `confluence_chunks` (default pipeline)
- **Optimized**: `optimized_chunks` (optimized pipeline)

**Chunk Metadata**:
```typescript
interface Chunk {
  id: string;           // UUID or hash
  pageId: string;       // Confluence page ID
  space: string;        // Confluence space key
  title: string;        // Page title
  text: string;         // Chunk content
  sectionAnchor?: string; // Page section reference
  vector?: number[];    // Embedding vector (768 dims)
  metadata?: {          // Enhanced chunking metadata
    semantic_type?: string;
    importance_score?: number;
    parent_chunk?: string;
  }
}
```

## Known Issues & Solutions

### 1. LLM Response Processing

**Problem**: Some models (like `openai/gpt-oss-20b`) generate responses wrapped in `<think>` tags
**Solution**: Implemented robust post-processing pipeline:
- Frontend separates thinking content from actual answers
- Backend strips thinking tags and extracts clean responses
- Fallback extraction for when models ignore system prompts

**Implementation**: 
- `packages/web-ui/src/utils/thinking.ts` - Content separation logic
- `packages/mcp-server/src/orchestrator.ts` - Server-side post-processing

### 2. Vector Search Performance

**Problem**: Cold start performance when vector DB is empty
**Solution**: Multi-layered fallback strategy:
1. Vector similarity search
2. Live Confluence API search
3. Background indexing of search results
4. LLM ranking of results

### 3. Citation Management

**Problem**: Duplicate citations and reference mapping
**Solution**: Citation deduplication with index mapping:
- Groups citations by `pageId + url`
- Merges snippets while preserving first occurrence
- Maps original indices to deduplicated indices for frontend

## Frontend Architecture

### Key Components

**App.tsx**: Main application shell
- Conversation management
- Message rendering with thinking content separation
- Export functionality (JSON, Markdown)

**SmartResponse.tsx**: AI response renderer
- Markdown processing with syntax highlighting
- Citation display and interaction
- Animation for streaming responses

**HistoryPane.tsx**: Conversation history
- Pinning, renaming, deletion
- Conversation search and filtering
- Bulk operations

**SettingsDrawer.tsx**: Configuration UI
- Query settings (space filters, topK, temperature)
- Model selection
- RAG pipeline configuration
- Crawler settings

### State Management

**Custom Hooks Pattern**:
- `useConversations`: Message and conversation state
- `useSettings`: User preferences and configuration
- `useModels`: Available model fetching
- `useConnection`: Health monitoring

### Styling

**CSS Architecture**:
- Component-scoped styles in `index.css`
- Dark/light theme support via CSS custom properties
- Responsive design with mobile considerations
- Animation and transition effects

## Backend Architecture

### Server Structure

**main.ts**: Fastify server setup
- Request logging and error handling
- Health checks
- Model listing endpoint
- RAG query endpoints (streaming + non-streaming)
- Crawler management endpoints

**orchestrator.ts**: Core RAG logic
- Pipeline selection and orchestration
- Query processing and intent analysis
- Response generation and post-processing
- Citation management

### Data Sources

**Confluence Integration** (`packages/mcp-server/src/sources/confluence.ts`):
- REST API client with authentication
- CQL query building
- HTML content extraction
- Rate limiting and error handling

### Vector Store Abstraction

**Multi-Provider Support**:
- ChromaDB: Production-ready, HTTP-based
- LanceDB: File-based, good for development
- MockVectorStore: Testing and development

**Interface Design**:
```typescript
interface VectorStore {
  initialize(): Promise<void>;
  addChunks(chunks: Chunk[]): Promise<void>;
  similaritySearch(query: string, topK: number, filters?: Filters): Promise<Chunk[]>;
  deleteChunk(id: string): Promise<void>;
}
```

## Deployment & Operations

### Docker Compose Setup

**Services**:
- `web-ui`: React frontend (port 3000)
- `mcp-server`: Node.js backend (port 8787)
- `chroma`: Vector database (port 8000)

**Volumes**:
- `chroma-data`: Persistent vector storage
- Source code mounts for development

### Monitoring & Debugging

**Logging Strategy**:
- Request/response logging with unique IDs
- Pipeline performance metrics
- Vector search result logging
- Background job status

**Health Checks**:
- Service availability endpoints
- Vector database connectivity
- LLM API availability
- Confluence API connectivity

### Performance Considerations

**Optimization Points**:
- Embedding batch processing (configurable batch sizes)
- Vector search result caching
- Background indexing to avoid blocking user queries
- Connection pooling for external APIs

## Development Workflow

### Local Development

1. **Start LM Studio** with BGE-M3 embedding model and chat model
2. **Configure Environment**: Copy `.env.example` to `.env` and update
3. **Start Services**: `docker-compose up -d`
4. **Development Mode**: Use `pnpm dev` for hot reloading

### Testing Strategy

**Unit Tests**: Core logic functions (chunking, embeddings, citations)
**Integration Tests**: API endpoints and database operations
**E2E Tests**: Full RAG pipeline from query to response

### Code Organization

**Monorepo Structure**:
```
packages/
├── shared/           # Common types and utilities
├── web-ui/          # React frontend
└── mcp-server/      # Node.js backend
    ├── src/
    │   ├── llm/         # LLM and embedding integrations
    │   ├── retrieval/   # RAG pipeline components
    │   ├── sources/     # Data source connectors
    │   ├── store/       # Data persistence
    │   └── utils/       # Helper functions
```

## Lessons Learned

### What Worked Well

1. **Modular Pipeline Design**: Easy to swap embedding models and chunking strategies
2. **Provider-Agnostic APIs**: Simple to switch between vector databases and LLM providers
3. **Robust Fallback Strategy**: System gracefully handles failures at each level
4. **Citation System**: Maintains source traceability throughout the pipeline

### What to Improve

1. **Model Response Consistency**: Different models have varying output formats requiring extensive post-processing
2. **Configuration Management**: Too many environment variables, consider configuration files
3. **Error Handling**: More granular error types and user-friendly error messages
4. **Performance Monitoring**: Better metrics and observability

### Critical Dependencies

1. **BGE-M3 Embedding Model**: Core to the system's effectiveness
2. **ChromaDB**: Reliable vector storage and similarity search
3. **OpenAI-Compatible LLM API**: Consistent response formatting expectations
4. **Confluence REST API**: Data source reliability and rate limits

## Recommended Tech Stack for Rewrite

### Backend
- **Language**: TypeScript/Node.js or Python (FastAPI)
- **Vector DB**: ChromaDB or Weaviate
- **Embeddings**: BGE-M3 or latest sentence-transformers
- **LLM Integration**: Ollama for local models, OpenAI SDK for hosted

### Frontend
- **Framework**: Next.js 14+ (React Server Components)
- **Styling**: Tailwind CSS
- **State**: Zustand or Jotai (simpler than Redux)
- **UI Components**: Shadcn/ui or Mantine

### Infrastructure
- **Containerization**: Docker with multi-stage builds
- **Orchestration**: Docker Compose for development, Kubernetes for production
- **Monitoring**: OpenTelemetry + Grafana + Prometheus
- **Caching**: Redis for response caching and session management

## Migration Strategy

### Phase 1: Core Infrastructure
1. Set up new repository with chosen tech stack
2. Implement vector store abstraction layer
3. Create basic embedding pipeline
4. Establish LLM integration patterns

### Phase 2: RAG Pipeline
1. Port chunking strategies (start with simple, add semantic)
2. Implement hybrid search (vector + keyword)
3. Add citation system
4. Build response generation pipeline

### Phase 3: User Interface
1. Create basic chat interface
2. Add conversation management
3. Implement settings and configuration
4. Add export functionality

### Phase 4: Advanced Features
1. Streaming responses
2. Background indexing
3. Advanced query processing
4. Performance optimization

## Configuration Templates

### Essential Environment Configuration
```bash
# Core Services
LLM_BASE_URL=http://localhost:1234
EMBEDDING_BASE_URL=http://localhost:1234
CHROMA_HOST=localhost
CHROMA_PORT=8000

# Confluence
CONFLUENCE_BASE_URL=https://company.atlassian.net/wiki
CONFLUENCE_USERNAME=user@company.com
CONFLUENCE_PASSWORD=api_token_here

# Pipeline Tuning
USE_OPTIMIZED_PIPELINE=true
RELEVANCE_THRESHOLD=0.05
TOP_K_DEFAULT=5
TEMPERATURE_DEFAULT=0.7

# Performance
EMBEDDING_BATCH_SIZE=10
MAX_CONCURRENT_CRAWLS=5
CRAWLER_PAGE_SIZE=25
```

### Docker Compose Template
```yaml
version: '3.8'
services:
  rag-backend:
    build: ./backend
    ports: ["8787:8787"]
    environment:
      - NODE_ENV=production
    depends_on: [chroma]
    
  rag-frontend:
    build: ./frontend
    ports: ["3000:3000"]
    depends_on: [rag-backend]
    
  chroma:
    image: chromadb/chroma:latest
    ports: ["8000:8000"]
    volumes: ["chroma-data:/chroma/chroma"]
    
volumes:
  chroma-data:
```

---

**This handover document captures the essential architecture, lessons learned, and implementation guidance needed to rebuild this RAG documentation assistant from scratch while avoiding the complexity debt that accumulated during development.**