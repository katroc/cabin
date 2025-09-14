import { ChromaClient, Collection, IEmbeddingFunction } from 'chromadb';
import { VectorStore, Chunk, ChildChunk, SearchFilters } from '@rag-assistant/core';

// Custom embedding function that does nothing since we provide embeddings manually
class CustomEmbeddingFunction implements IEmbeddingFunction {
  async generate(texts: string[]): Promise<number[][]> {
    // Return dummy embeddings - we'll provide real ones manually
    // Match BGE-M3's 256-dimensional output
    return texts.map(() => new Array(256).fill(0));
  }
}

export class ChromaVectorStore implements VectorStore {
  private client: ChromaClient;
  private childCollection: Collection | null = null;
  private legacyCollection: Collection | null = null;
  private childCollectionName: string;
  private legacyCollectionName: string;

  constructor(host: string, port: number, childCollectionName: string = 'child_chunks_256', legacyCollectionName: string = 'confluence_chunks_256') {
    this.client = new ChromaClient({
      path: `http://${host}:${port}`
      // No embedding function - rely on manual embeddings only
    });
    this.childCollectionName = childCollectionName;
    this.legacyCollectionName = legacyCollectionName;
  }

  async initialize(): Promise<void> {
    try {
      // Initialize child chunks collection for parent-child architecture
      this.childCollection = await this.client.getOrCreateCollection({
        name: this.childCollectionName,
        metadata: { 'hnsw:space': 'cosine' }
      });

      // Initialize legacy collection for backward compatibility
      this.legacyCollection = await this.client.getOrCreateCollection({
        name: this.legacyCollectionName,
        metadata: { 'hnsw:space': 'cosine' }
      });

      console.log(`ChromaDB initialized with collections: ${this.childCollectionName}, ${this.legacyCollectionName}`);
    } catch (error) {
      throw new Error(`Failed to initialize ChromaDB collections: ${error}`);
    }
  }

  // New method for adding child chunks
  async addChildChunks(chunks: ChildChunk[]): Promise<void> {
    if (!this.childCollection) throw new Error('Child collection not initialized');

    const ids = chunks.map(c => c.id);
    const documents = chunks.map(c => c.text);
    const metadatas = chunks.map(c => ({
      parentId: c.parentId,
      pageId: c.metadata.pageId,
      pageTitle: c.metadata.pageTitle,
      space: c.metadata.space,
      confluenceUrl: c.metadata.confluenceUrl || '',
      chunkIndex: c.chunkIndex.toString(),
      importance_score: c.metadata.importance_score?.toString() || '0'
    }));
    const embeddings = chunks.map(c => c.vector || []);

    await this.childCollection.add({
      ids,
      documents,
      metadatas,
      embeddings
    });
  }

  // New method for searching child chunks
  async similaritySearchChildren(query: string, topK: number, filters?: SearchFilters, queryEmbedding?: number[]): Promise<ChildChunk[]> {
    if (!this.childCollection) throw new Error('Child collection not initialized');

    // For empty query (used in keyword search), just return some chunks
    if (!query || query.trim() === '') {
      const where: any = {};
      if (filters?.space) where.space = filters.space;
      if (filters?.pageId) where.pageId = filters.pageId;

      const results = await this.childCollection.get({
        limit: topK,
        where: Object.keys(where).length > 0 ? where : undefined
      });

      return results.ids.map((id, index) => {
        const metadata = results.metadatas?.[index] || {};
        return {
          id,
          parentId: String(metadata.parentId || ''),
          text: results.documents?.[index] || '',
          chunkIndex: parseInt(String(metadata.chunkIndex || '0')),
          vector: results.embeddings ? results.embeddings[index] : undefined,
          metadata: {
            pageId: String(metadata.pageId || ''),
            pageTitle: String(metadata.pageTitle || ''),
            space: String(metadata.space || ''),
            confluenceUrl: String(metadata.confluenceUrl || ''),
            importance_score: parseFloat(String(metadata.importance_score || '0'))
          }
        };
      });
    }

    // If we have a query embedding, use it for similarity search
    if (queryEmbedding && queryEmbedding.length > 0) {
      const where: any = {};
      if (filters?.space) where.space = filters.space;
      if (filters?.pageId) where.pageId = filters.pageId;

      const results = await this.childCollection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: topK,
        where: Object.keys(where).length > 0 ? where : undefined
      });

      return results.ids[0].map((id, index) => {
        const metadata = results.metadatas[0][index] || {};
        return {
          id,
          parentId: String(metadata.parentId || ''),
          text: results.documents[0][index] || '',
          chunkIndex: parseInt(String(metadata.chunkIndex || '0')),
          vector: results.embeddings ? results.embeddings[0][index] : undefined,
          metadata: {
            pageId: String(metadata.pageId || ''),
            pageTitle: String(metadata.pageTitle || ''),
            space: String(metadata.space || ''),
            confluenceUrl: String(metadata.confluenceUrl || ''),
            importance_score: parseFloat(String(metadata.importance_score || '0'))
          }
        };
      });
    }

    // If no embedding provided, return empty results
    return [];
  }

  async deleteChildChunk(id: string): Promise<void> {
    if (!this.childCollection) throw new Error('Child collection not initialized');
    await this.childCollection.delete({ ids: [id] });
  }

  // Legacy methods for backward compatibility
  async addChunks(chunks: Chunk[]): Promise<void> {
    if (!this.legacyCollection) throw new Error('Legacy collection not initialized');

    // Validate and filter chunks
    const validChunks = chunks.filter(c => {
      return c.id && c.text && c.vector && c.vector.length > 0;
    });

    if (validChunks.length === 0) {
      throw new Error('No valid chunks to add');
    }

    console.log(`Adding ${validChunks.length} valid chunks to ChromaDB`);

    const ids = validChunks.map(c => c.id);
    const documents = validChunks.map(c => c.text);
    const metadatas = validChunks.map(c => {
      // Keep only safe, basic string fields for ChromaDB compatibility
      const metadata = {
        pageId: String(c.pageId || ''),
        space: String(c.space || ''),
        title: String(c.title || ''),
        sectionAnchor: String(c.sectionAnchor || '')
      };

      return metadata;
    });
    const embeddings = validChunks.map(c => c.vector || []);

    console.log(`ChromaDB add data: ${ids.length} ids, ${documents.length} documents, ${embeddings.length} embeddings, first embedding length: ${embeddings[0]?.length}`);

    // Validate embedding dimensions
    const firstEmbedding = embeddings[0];
    if (!firstEmbedding || firstEmbedding.length !== 256) {
      throw new Error(`Invalid embedding dimension. Expected 256, got ${firstEmbedding?.length || 'undefined'}`);
    }

    // Log detailed sample for debugging
    console.log('Sample chunk data:', {
      id: ids[0],
      documentPreview: documents[0]?.substring(0, 50) + '...',
      metadata: metadatas[0],
      embeddingPreview: `[${firstEmbedding.slice(0, 3).join(', ')}...] (${firstEmbedding.length}D)`
    });

    try {
      await this.legacyCollection.add({
        ids,
        documents,
        metadatas,
        embeddings
      });
      console.log('✅ Successfully added chunks to ChromaDB');
    } catch (error) {
      console.error('❌ ChromaDB add error details:', {
        error: (error as Error).message,
        ids: ids.length,
        documents: documents.length,
        metadatas: metadatas.length,
        embeddings: embeddings.length,
        embeddingDimension: embeddings[0]?.length,
        sampleMetadata: metadatas[0]
      });
      throw error;
    }
  }

  async similaritySearch(query: string, topK: number, filters?: SearchFilters, queryEmbedding?: number[]): Promise<Chunk[]> {
    if (!this.legacyCollection) throw new Error('Legacy collection not initialized');

    // For empty query (used in keyword search), just return some chunks
    if (!query || query.trim() === '') {
      const where: any = {};
      if (filters?.space) where.space = filters.space;
      if (filters?.pageId) where.pageId = filters.pageId;
      if (filters?.semantic_type) where.semantic_type = filters.semantic_type;

      const results = await this.legacyCollection.get({
        limit: topK,
        where: Object.keys(where).length > 0 ? where : undefined
      });

      return results.ids.map((id, index) => {
        const metadata = results.metadatas?.[index] || {};
        return {
          id,
          pageId: String(metadata.pageId || ''),
          space: String(metadata.space || ''),
          title: String(metadata.title || ''),
          text: results.documents?.[index] || '',
          sectionAnchor: String(metadata.sectionAnchor || ''),
          vector: results.embeddings ? results.embeddings[index] : undefined,
          metadata: {
            semantic_type: String(metadata.semantic_type || ''),
            importance_score: parseFloat(String(metadata.importance_score || '0'))
          }
        };
      });
    }

    // If we have a query embedding, use it for similarity search
    if (queryEmbedding && queryEmbedding.length > 0) {
      const where: any = {};
      if (filters?.space) where.space = filters.space;
      if (filters?.pageId) where.pageId = filters.pageId;
      if (filters?.semantic_type) where.semantic_type = filters.semantic_type;

      const results = await this.legacyCollection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: topK,
        where: Object.keys(where).length > 0 ? where : undefined
      });

      return results.ids[0].map((id, index) => {
        const metadata = results.metadatas[0][index] || {};
        return {
          id,
          pageId: String(metadata.pageId || ''),
          space: String(metadata.space || ''),
          title: String(metadata.title || ''),
          text: results.documents[0][index] || '',
          sectionAnchor: String(metadata.sectionAnchor || ''),
          vector: results.embeddings ? results.embeddings[0][index] : undefined,
          metadata: {
            semantic_type: String(metadata.semantic_type || ''),
            importance_score: parseFloat(String(metadata.importance_score || '0'))
          }
        };
      });
    }

    // If no embedding provided, return empty results
    return [];
  }

  async deleteChunk(id: string): Promise<void> {
    if (!this.legacyCollection) throw new Error('Legacy collection not initialized');
    await this.legacyCollection.delete({ ids: [id] });
  }
}