// Shared types and interfaces for RAG Assistant

// Enhanced Document interface for rich metadata
export interface Document {
  id: string;
  pageId: string;
  pageTitle: string;
  space: string;
  spaceName?: string;
  author?: string;
  lastModified?: string;
  confluenceUrl?: string;
  breadcrumb?: string[];
  text: string;
}

// Parent chunks - large, semantically meaningful sections
export interface ParentChunk {
  id: string;
  documentId: string;
  title: string;
  text: string;
  sectionIndex: number;
  metadata: {
    pageId: string;
    pageTitle: string;
    space: string;
    spaceName?: string;
    author?: string;
    lastModified?: string;
    confluenceUrl?: string;
    breadcrumb?: string[];
    sectionAnchor?: string;
    heading?: string;
  };
}

// Child chunks - small chunks optimized for vector search
export interface ChildChunk {
  id: string;
  parentId: string;
  text: string;
  vector?: number[];
  chunkIndex: number;
  metadata: {
    pageId: string;
    pageTitle: string;
    space: string;
    confluenceUrl?: string;
    importance_score?: number;
  };
}

// Legacy Chunk interface - keeping for backward compatibility
export interface Chunk {
  id: string;
  pageId: string;
  space: string;
  title: string;
  text: string;
  sectionAnchor?: string;
  vector?: number[];
  metadata?: {
    semantic_type?: string;
    importance_score?: number;
    parent_chunk?: string;
  };
}

export interface Citation {
  id: string;
  pageId: string;
  url: string;
  title: string;
  snippet: string;
}

export interface SearchFilters {
  space?: string;
  pageId?: string;
  semantic_type?: string;
}

// Document Store interface - stores parent chunks for context retrieval
export interface DocumentStore {
  initialize(): Promise<void>;
  storeParentChunk(chunk: ParentChunk): Promise<void>;
  getParentChunk(id: string): Promise<ParentChunk | null>;
  getParentChunks(ids: string[]): Promise<ParentChunk[]>;
  getAllParentChunks?(): Promise<ParentChunk[]>;
  deleteParentChunk(id: string): Promise<void>;
}

// Enhanced Vector Store interface for child chunks
export interface VectorStore {
  initialize(): Promise<void>;
  addChildChunks(chunks: ChildChunk[]): Promise<void>;
  similaritySearchChildren(query: string, topK: number, filters?: SearchFilters, queryEmbedding?: number[]): Promise<ChildChunk[]>;
  deleteChildChunk(id: string): Promise<void>;
  // Legacy methods for backward compatibility
  addChunks(chunks: Chunk[]): Promise<void>;
  similaritySearch(query: string, topK: number, filters?: SearchFilters, queryEmbedding?: number[]): Promise<Chunk[]>;
  deleteChunk(id: string): Promise<void>;
}

export interface DataSource {
  crawl(): Promise<Chunk[]>;
}

// Enhanced chunking interfaces
export interface ParentChildChunker {
  createParentChunks(document: Document): Promise<ParentChunk[]>;
  createChildChunks(parentChunk: ParentChunk): Promise<ChildChunk[]>;
}

// Legacy chunker interface
export interface Chunker {
  chunk(text: string): Promise<Chunk[]>;
}

export interface LLMProvider {
  generate(prompt: string): Promise<string>;
  embed(text: string): Promise<number[]>;
}