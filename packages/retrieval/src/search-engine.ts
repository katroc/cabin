import { VectorStore, Chunk, SearchFilters, LLMProvider } from '@rag-assistant/core';

export class SearchEngine {
  private vectorStore: VectorStore;
  private llmProvider?: LLMProvider;

  constructor(vectorStore: VectorStore, llmProvider?: LLMProvider) {
    this.vectorStore = vectorStore;
    this.llmProvider = llmProvider;
  }

  async hybridSearch(query: string, topK: number, filters?: SearchFilters): Promise<Chunk[]> {
    // Generate embeddings using LM Studio BGE-M3 if available
    let queryEmbedding: number[] | undefined;
    if (this.llmProvider) {
      try {
        queryEmbedding = await this.llmProvider.embed(query);
      } catch (error) {
        console.warn('Failed to generate query embedding:', error);
      }
    }

    // Get vector search results using our generated embeddings
    const vectorResults = await (this.vectorStore as any).similaritySearch(query, topK, filters, queryEmbedding);

    // Get keyword search results
    const keywordResults = await this.keywordSearch(query, topK, filters);

    // Combine and deduplicate results
    const combined = this.combineResults(vectorResults, keywordResults, topK);

    return combined;
  }

  private async keywordSearch(query: string, topK: number, filters?: SearchFilters): Promise<Chunk[]> {
    // Simple keyword search implementation
    // In production, use full-text search capabilities of ChromaDB or external search
    const allResults = await this.vectorStore.similaritySearch('', topK * 10, filters); // Get more for filtering

    const keywords = query.toLowerCase().split(' ').filter(word => word.length > 2);
    const scoredResults = allResults.map(chunk => {
      const text = chunk.text.toLowerCase();
      let score = 0;
      keywords.forEach(keyword => {
        const count = (text.match(new RegExp(keyword, 'g')) || []).length;
        score += count;
      });
      return { chunk, score };
    }).filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(item => item.chunk);

    return scoredResults;
  }

  private combineResults(vectorResults: Chunk[], keywordResults: Chunk[], topK: number): Chunk[] {
    const seen = new Set<string>();
    const combined: Chunk[] = [];

    // Add vector results first (prioritize semantic similarity)
    for (const chunk of vectorResults) {
      if (!seen.has(chunk.id) && combined.length < topK) {
        seen.add(chunk.id);
        combined.push(chunk);
      }
    }

    // Add keyword results if space allows
    for (const chunk of keywordResults) {
      if (!seen.has(chunk.id) && combined.length < topK) {
        seen.add(chunk.id);
        combined.push(chunk);
      }
    }

    return combined;
  }

  async searchWithRelevance(query: string, topK: number, threshold: number = 0.05, filters?: SearchFilters): Promise<Chunk[]> {
    const results = await this.hybridSearch(query, topK * 2, filters);
    return results.filter(chunk => {
      // Enhanced relevance check
      const hasHighImportance = chunk.metadata?.importance_score ? chunk.metadata.importance_score > threshold : true;
      const hasSemanticType = chunk.metadata?.semantic_type ? true : false;
      return hasHighImportance && hasSemanticType;
    }).slice(0, topK);
  }
}