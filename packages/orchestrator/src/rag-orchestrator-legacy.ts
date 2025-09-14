import { VectorStore, Chunk, SearchFilters } from '@rag-assistant/core';
import { SearchEngine } from '@rag-assistant/retrieval';
import { OpenAILLMProvider, EmbeddingPipeline } from '@rag-assistant/generation';
import { ResponseBuilder } from '@rag-assistant/generation/dist/response-builder-legacy';
import { SemanticChunker } from '@rag-assistant/data-ingestion/dist/semantic-chunker-legacy';

export interface RAGConfig {
  vectorStore: VectorStore;
  llmProvider: OpenAILLMProvider;
  embeddingPipeline: EmbeddingPipeline;
  searchEngine: SearchEngine;
  chunker: SemanticChunker;
  responseBuilder: ResponseBuilder;
  topK: number;
  relevanceThreshold: number;
}

export class RAGOrchestrator {
  private config: RAGConfig;

  constructor(config: RAGConfig) {
    this.config = config;
  }

  async processQuery(query: string, filters?: SearchFilters): Promise<string> {
    try {
      // Step 1: Search for relevant chunks
      const relevantChunks = await this.config.searchEngine.searchWithRelevance(
        query,
        this.config.topK,
        this.config.relevanceThreshold,
        filters
      );

      if (relevantChunks.length === 0) {
        // If no chunks found, generate a direct response
        const directPrompt = `You are a helpful assistant. Please respond to this query: ${query}
        
        Note: No relevant information was found in the knowledge base for this query.`;
        
        return await this.config.llmProvider.generate(directPrompt);
      }

      // Step 2: Build context from chunks
      const context = this.config.responseBuilder.buildContext(relevantChunks);

      // Step 3: Generate response using LLM
      const prompt = this.buildPrompt(query, context);
      const rawResponse = await this.config.llmProvider.generate(prompt);

      // Step 4: Format response with citations
      const formattedResponse = this.config.responseBuilder.formatResponse(rawResponse);

      // Reset for next query
      this.config.responseBuilder.reset();

      return formattedResponse;
    } catch (error) {
      console.error('RAG Pipeline Error:', error);
      return `An error occurred while processing your query: ${error}`;
    }
  }

  async *processQueryStream(query: string, filters?: SearchFilters): AsyncGenerator<string> {
    try {
      // Same steps as processQuery, but yield chunks for streaming
      const relevantChunks = await this.config.searchEngine.searchWithRelevance(
        query,
        this.config.topK,
        this.config.relevanceThreshold,
        filters
      );

      if (relevantChunks.length === 0) {
        yield "No relevant information found for your query.";
        return;
      }

      const context = this.config.responseBuilder.buildContext(relevantChunks);
      const prompt = this.buildPrompt(query, context);

      let buffer = '';
      for await (const chunk of this.config.llmProvider.generateStream(prompt)) {
        buffer += chunk;
        yield chunk;
      }

      // Add citations at the end
      const citations = this.config.responseBuilder.formatResponse('').split('\n\n## Sources')[1];
      if (citations) {
        yield '\n\n## Sources' + citations;
      }

      this.config.responseBuilder.reset();
    } catch (error) {
      yield `An error occurred: ${error}`;
    }
  }

  async indexDocument(text: string, pageId: string, space: string, title: string): Promise<void> {
    // Step 1: Chunk the document
    const rawChunks = await this.config.chunker.chunk(text);
    const chunks = rawChunks.map(chunk => ({
      ...chunk,
      pageId,
      space,
      title
    }));

    // Step 2: Generate embeddings
    const embeddedChunks = await this.config.embeddingPipeline.generateAndNormalizeEmbeddings(chunks);

    // Step 3: Store in vector database
    await this.config.vectorStore.addChunks(embeddedChunks);
  }

  private buildPrompt(query: string, context: string): string {
    return `You are a helpful documentation assistant. Use the following context to answer the user's question accurately and provide citations.

Context:
${context}

Question: ${query}

Answer comprehensively but concisely, citing sources using the provided reference numbers.`;
  }

  async getSystemStats(): Promise<{
    totalDocuments: number;
    totalChunks: number;
    averageChunkSize: number;
  }> {
    return {
      totalDocuments: 0,
      totalChunks: 0,
      averageChunkSize: 0
    };
  }

  async indexDocuments(documents: any[]): Promise<void> {
    for (const doc of documents) {
      await this.indexDocument(doc.text, doc.pageId, doc.space, doc.pageTitle);
    }
  }

  async clearIndex(): Promise<void> {
    // This would need to be implemented based on the vector store
    console.log('Clear index not implemented for legacy orchestrator');
  }
}