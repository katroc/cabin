import { Chunk, Citation } from '@rag-assistant/core';

export class ResponseBuilder {
  private citations: Citation[] = [];
  private citationMap: Map<string, number> = new Map();

  buildContext(chunks: Chunk[]): string {
    return chunks.map((chunk, index) => {
      const citation = this.createCitation(chunk, index);
      this.citations.push(citation);
      return `[${index + 1}] ${chunk.text}`;
    }).join('\n\n');
  }

  private createCitation(chunk: Chunk, index: number): Citation {
    const baseUrl = process.env.CONFLUENCE_BASE_URL || 'https://confluence.com';
    return {
      id: `cite_${index + 1}`,
      pageId: chunk.pageId,
      url: `${baseUrl}/pages/${chunk.pageId}${chunk.sectionAnchor ? `#${chunk.sectionAnchor}` : ''}`,
      title: chunk.title,
      snippet: this.extractSnippet(chunk.text)
    };
  }

  private extractSnippet(text: string): string {
    // Extract first meaningful sentence or up to 200 chars
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    if (sentences.length > 0) {
      return sentences[0].trim() + '...';
    }
    return text.substring(0, 200) + '...';
  }

  deduplicateCitations(): Citation[] {
    const seen = new Set<string>();
    const deduped: Citation[] = [];
    let counter = 1;

    for (const citation of this.citations) {
      const key = `${citation.pageId}-${citation.url}`;
      if (!seen.has(key)) {
        seen.add(key);
        this.citationMap.set(key, counter);
        deduped.push({ ...citation, id: `cite_${counter}` });
        counter++;
      }
    }

    return deduped;
  }

  mapCitationsToIndices(): Map<number, number> {
    const mapping = new Map<number, number>();
    this.citations.forEach((citation, originalIndex) => {
      const key = `${citation.pageId}-${citation.url}`;
      const dedupedIndex = this.citationMap.get(key);
      if (dedupedIndex !== undefined) {
        mapping.set(originalIndex + 1, dedupedIndex);
      }
    });
    return mapping;
  }

  formatResponse(response: string): string {
    const dedupedCitations = this.deduplicateCitations();
    const citationText = dedupedCitations.map(cite =>
      `[${cite.id.split('_')[1]}] ${cite.title} - ${cite.url}`
    ).join('\n');

    return `${response}\n\n## Sources\n${citationText}`;
  }

  getCitations(): Citation[] {
    return this.deduplicateCitations();
  }

  reset(): void {
    this.citations = [];
    this.citationMap.clear();
  }
}