import { VectorStore, DocumentStore, ChildChunk, ParentChunk, SearchFilters, LLMProvider } from '@rag-assistant/core';

export interface EnhancedSearchResult {
  parentChunks: ParentChunk[];
  relevantChildChunks: ChildChunk[];
  totalResults: number;
}

export class EnhancedSearchEngine {
  private vectorStore: VectorStore;
  private documentStore: DocumentStore;
  private llmProvider?: LLMProvider;

  constructor(
    vectorStore: VectorStore,
    documentStore: DocumentStore,
    llmProvider?: LLMProvider
  ) {
    this.vectorStore = vectorStore;
    this.documentStore = documentStore;
    this.llmProvider = llmProvider;
  }

  async search(
    query: string,
    topK: number = 5,
    filters?: SearchFilters
  ): Promise<EnhancedSearchResult> {
    let queryEmbedding: number[] | undefined;
    if (this.llmProvider) {
      try {
        queryEmbedding = await this.llmProvider.embed(query);
        console.log(`Generated query embedding with ${queryEmbedding.length} dimensions`);
      } catch (error) {
        console.warn('Failed to generate query embedding:', error);
      }
    }

    const childChunks = await this.searchChildChunks(query, topK * 3, filters, queryEmbedding);

    if (childChunks.length === 0) {
      return {
        parentChunks: [],
        relevantChildChunks: [],
        totalResults: 0
      };
    }

    const uniqueParentIds = [...new Set(childChunks.map(child => child.parentId))];
    const parentChunks = await this.documentStore.getParentChunks(uniqueParentIds);

    const rankedParentChunks = await this.rankParentChunks(query, parentChunks, topK);

    return {
      parentChunks: rankedParentChunks,
      relevantChildChunks: childChunks.slice(0, topK * 2),
      totalResults: parentChunks.length
    };
  }

  private async searchChildChunks(
    query: string,
    topK: number,
    filters?: SearchFilters,
    queryEmbedding?: number[]
  ): Promise<ChildChunk[]> {
    if (!this.vectorStore.similaritySearchChildren) {
      console.warn('Vector store does not support child chunk search');
      return [];
    }

    const vectorResults = await this.vectorStore.similaritySearchChildren(
      query,
      topK,
      filters,
      queryEmbedding
    );

    const keywordResults = await this.keywordSearchChildren(query, Math.min(topK, 5), filters);

    const combined = this.combineChildResults(vectorResults, keywordResults, topK);

    return combined;
  }

  private async keywordSearchChildren(
    query: string,
    topK: number,
    filters?: SearchFilters
  ): Promise<ChildChunk[]> {
    if (!this.vectorStore.similaritySearchChildren) {
      return [];
    }

    const allResults = await this.vectorStore.similaritySearchChildren('', topK * 10, filters);

    const keywords = query.toLowerCase().split(' ').filter(word => word.length > 2);
    const scoredResults = allResults.map(chunk => {
      const text = chunk.text.toLowerCase();
      let score = 0;
      keywords.forEach(keyword => {
        const count = (text.match(new RegExp(keyword, 'g')) || []).length;
        score += count;
      });
      return { chunk, score };
    })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(item => item.chunk);

    return scoredResults;
  }

  private combineChildResults(
    vectorResults: ChildChunk[],
    keywordResults: ChildChunk[],
    topK: number
  ): ChildChunk[] {
    const seen = new Set<string>();
    const combined: ChildChunk[] = [];

    for (const chunk of vectorResults) {
      if (!seen.has(chunk.id) && combined.length < topK) {
        seen.add(chunk.id);
        combined.push(chunk);
      }
    }

    for (const chunk of keywordResults) {
      if (!seen.has(chunk.id) && combined.length < topK) {
        seen.add(chunk.id);
        combined.push(chunk);
      }
    }

    return combined;
  }

  private async rankParentChunks(
    query: string,
    parentChunks: ParentChunk[],
    topK: number
  ): Promise<ParentChunk[]> {
    if (!this.llmProvider) {
      return parentChunks
        .sort((a, b) => {
          const aHeadingMatch = this.countQueryMatches(query, a.metadata.heading || '');
          const bHeadingMatch = this.countQueryMatches(query, b.metadata.heading || '');
          if (aHeadingMatch !== bHeadingMatch) return bHeadingMatch - aHeadingMatch;
          return b.text.length - a.text.length;
        })
        .slice(0, topK);
    }

    try {
      const rankedChunks = await this.llmRankParentChunks(query, parentChunks, topK);
      return rankedChunks;
    } catch (error) {
      console.warn('LLM ranking failed, falling back to heuristic ranking:', error);
      return this.rankParentChunks(query, parentChunks, topK);
    }
  }

  private countQueryMatches(query: string, text: string): number {
    const queryTerms = query.toLowerCase().split(' ').filter(term => term.length > 2);
    const lowerText = text.toLowerCase();
    return queryTerms.reduce((count, term) => {
      return count + (lowerText.includes(term) ? 1 : 0);
    }, 0);
  }

  private async llmRankParentChunks(
    query: string,
    parentChunks: ParentChunk[],
    topK: number
  ): Promise<ParentChunk[]> {
    if (!this.llmProvider || parentChunks.length <= topK) {
      return parentChunks.slice(0, topK);
    }

    const prompt = `Given this user query: "${query}"

Rank the following document sections by relevance (1 = most relevant):

${parentChunks.map((chunk, index) =>
  `${index + 1}. Title: ${chunk.title}\nHeading: ${chunk.metadata.heading || 'N/A'}\nContent preview: ${chunk.text.substring(0, 200)}...\n`
).join('\n')}

Return only the ranking numbers separated by commas (e.g., "3,1,5,2,4"):`;

    try {
      const response = await this.llmProvider.generate(prompt);
      const rankings = response.match(/[\d,\s]+/)?.[0]?.split(',').map(n => parseInt(n.trim()) - 1) || [];

      if (rankings.length === parentChunks.length && rankings.every(r => r >= 0 && r < parentChunks.length)) {
        const reordered = rankings.map(index => parentChunks[index]).slice(0, topK);
        return reordered;
      }
    } catch (error) {
      console.warn('LLM ranking parsing failed:', error);
    }

    return parentChunks.slice(0, topK);
  }

  async advancedSearch(
    query: string,
    options: {
      topK?: number;
      minImportanceScore?: number;
      includeSpaces?: string[];
      excludeSpaces?: string[];
      rerank?: boolean;
    } = {}
  ): Promise<EnhancedSearchResult> {
    const {
      topK = 5,
      minImportanceScore = 0.1,
      includeSpaces,
      excludeSpaces,
      rerank = true
    } = options;

    const filters: SearchFilters = {};
    if (includeSpaces && includeSpaces.length > 0) {
      filters.space = includeSpaces[0];
    }

    let result = await this.search(query, topK * 2, filters);

    result.relevantChildChunks = result.relevantChildChunks.filter(
      chunk => (chunk.metadata.importance_score || 0) >= minImportanceScore
    );

    if (excludeSpaces && excludeSpaces.length > 0) {
      result.parentChunks = result.parentChunks.filter(
        chunk => !excludeSpaces.includes(chunk.metadata.space)
      );
      result.relevantChildChunks = result.relevantChildChunks.filter(
        chunk => !excludeSpaces.includes(chunk.metadata.space)
      );
    }

    if (rerank && this.llmProvider && result.parentChunks.length > topK) {
      result.parentChunks = await this.rankParentChunks(query, result.parentChunks, topK);
    }

    result.parentChunks = result.parentChunks.slice(0, topK);
    result.relevantChildChunks = result.relevantChildChunks.slice(0, topK * 2);
    result.totalResults = result.parentChunks.length;

    return result;
  }

  async getSearchStats(): Promise<{
    totalParentChunks: number;
    totalChildChunks: number;
    avgChildrenPerParent: number;
  }> {
    const allParents = await this.documentStore.getAllParentChunks?.() || [];
    const estimatedChildChunks = allParents.length * 3;

    return {
      totalParentChunks: allParents.length,
      totalChildChunks: estimatedChildChunks,
      avgChildrenPerParent: allParents.length > 0 ? estimatedChildChunks / allParents.length : 0
    };
  }
}