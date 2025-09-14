import { ParentChunk, ChildChunk, Citation } from '@rag-assistant/core';

export interface EnhancedCitation extends Citation {
  pageTitle: string;
  space: string;
  spaceName?: string;
  author?: string;
  lastModified?: string;
  confluenceUrl?: string;
  breadcrumb?: string[];
  sectionTitle?: string;
  importance?: number;
}

export class EnhancedResponseBuilder {
  private citations: Map<string, EnhancedCitation> = new Map();
  private citationCounter = 1;

  buildContextFromParents(parentChunks: ParentChunk[]): string {
    let context = '';

    parentChunks.forEach((chunk, index) => {
      const citationId = `[${index + 1}]`;
      this.citations.set(citationId, this.createEnhancedCitation(chunk, citationId));

      context += `\n\n=== Source ${citationId}: ${chunk.title} ===\n`;
      context += this.buildMetadataContext(chunk);
      context += `\n\nContent:\n${chunk.text}`;
    });

    return context;
  }

  buildContextWithHighlights(
    parentChunks: ParentChunk[],
    relevantChildChunks: ChildChunk[]
  ): string {
    let context = '';

    parentChunks.forEach((parentChunk, index) => {
      const citationId = `[${index + 1}]`;
      this.citations.set(citationId, this.createEnhancedCitation(parentChunk, citationId));

      context += `\n\n=== Source ${citationId}: ${parentChunk.title} ===\n`;
      context += this.buildMetadataContext(parentChunk);

      const relevantChildren = relevantChildChunks.filter(
        child => child.parentId === parentChunk.id
      );

      if (relevantChildren.length > 0) {
        context += `\n\n**Most Relevant Sections:**\n`;
        relevantChildren.forEach((child, childIndex) => {
          context += `\n${childIndex + 1}. ${child.text}\n`;
        });

        context += `\n\n**Full Content:**\n${parentChunk.text}`;
      } else {
        context += `\n\nContent:\n${parentChunk.text}`;
      }
    });

    return context;
  }

  formatResponseWithCitations(rawResponse: string): string {
    const cleanResponse = this.cleanResponse(rawResponse);
    const citationsSection = this.formatCitationsSection();

    return `${cleanResponse}\n\n${citationsSection}`;
  }

  extractCitationReferences(response: string): string[] {
    const citationPattern = /\[(\d+)\]/g;
    const matches = response.match(citationPattern) || [];
    return [...new Set(matches)];
  }

  validateCitations(response: string): { valid: boolean; missing: string[]; unused: string[] } {
    const referencedCitations = this.extractCitationReferences(response);
    const availableCitations = Array.from(this.citations.keys());

    const missing = referencedCitations.filter(ref => !availableCitations.includes(ref));
    const unused = availableCitations.filter(citation => !referencedCitations.includes(citation));

    return {
      valid: missing.length === 0,
      missing,
      unused
    };
  }

  private createEnhancedCitation(parentChunk: ParentChunk, citationId: string): EnhancedCitation {
    return {
      id: citationId,
      pageId: parentChunk.metadata.pageId,
      url: parentChunk.metadata.confluenceUrl || '',
      title: parentChunk.title,
      snippet: this.createSnippet(parentChunk.text),
      pageTitle: parentChunk.metadata.pageTitle,
      space: parentChunk.metadata.space,
      spaceName: parentChunk.metadata.spaceName,
      author: parentChunk.metadata.author,
      lastModified: parentChunk.metadata.lastModified,
      confluenceUrl: parentChunk.metadata.confluenceUrl,
      breadcrumb: parentChunk.metadata.breadcrumb,
      sectionTitle: parentChunk.metadata.heading,
      importance: this.calculateCitationImportance(parentChunk)
    };
  }

  private buildMetadataContext(chunk: ParentChunk): string {
    let metadata = `Page: ${chunk.metadata.pageTitle}`;

    if (chunk.metadata.space) {
      metadata += `\nSpace: ${chunk.metadata.space}`;
      if (chunk.metadata.spaceName && chunk.metadata.spaceName !== chunk.metadata.space) {
        metadata += ` (${chunk.metadata.spaceName})`;
      }
    }

    if (chunk.metadata.author) {
      metadata += `\nAuthor: ${chunk.metadata.author}`;
    }

    if (chunk.metadata.lastModified) {
      metadata += `\nLast Modified: ${chunk.metadata.lastModified}`;
    }

    if (chunk.metadata.breadcrumb && chunk.metadata.breadcrumb.length > 0) {
      metadata += `\nLocation: ${chunk.metadata.breadcrumb.join(' > ')}`;
    }

    return metadata;
  }

  private cleanResponse(rawResponse: string): string {
    let cleaned = rawResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');
    cleaned = cleaned.trim();

    return cleaned;
  }

  private createSnippet(text: string, maxLength: number = 150): string {
    if (text.length <= maxLength) return text;

    const truncated = text.substring(0, maxLength);
    const lastPeriod = truncated.lastIndexOf('.');
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastPeriod > maxLength * 0.7) {
      return truncated.substring(0, lastPeriod + 1);
    } else if (lastSpace > maxLength * 0.7) {
      return truncated.substring(0, lastSpace) + '...';
    } else {
      return truncated + '...';
    }
  }

  private calculateCitationImportance(chunk: ParentChunk): number {
    let score = 0.5;

    score += Math.min(chunk.text.length / 2000, 0.2);

    if (chunk.metadata.lastModified) {
      const lastModified = new Date(chunk.metadata.lastModified);
      const now = new Date();
      const daysDiff = (now.getTime() - lastModified.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff < 30) score += 0.2;
      else if (daysDiff < 90) score += 0.1;
    }

    if (chunk.metadata.heading && chunk.metadata.heading.length > 0) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  private formatCitationsSection(): string {
    if (this.citations.size === 0) return '';

    const sortedCitations = Array.from(this.citations.values())
      .sort((a, b) => {
        const aNum = parseInt(a.id.replace(/[\[\]]/g, ''));
        const bNum = parseInt(b.id.replace(/[\[\]]/g, ''));
        return aNum - bNum;
      });

    let citationsText = '## Sources\n';

    sortedCitations.forEach(citation => {
      citationsText += `\n**${citation.id}** ${citation.pageTitle}`;

      if (citation.sectionTitle && citation.sectionTitle !== citation.pageTitle) {
        citationsText += ` - ${citation.sectionTitle}`;
      }

      if (citation.confluenceUrl) {
        citationsText += `  \n🔗 [View in Confluence](${citation.confluenceUrl})`;
      }

      if (citation.space) {
        citationsText += `  \n📁 Space: ${citation.space}`;
        if (citation.spaceName && citation.spaceName !== citation.space) {
          citationsText += ` (${citation.spaceName})`;
        }
      }

      if (citation.author || citation.lastModified) {
        citationsText += `  \n`;
        if (citation.author) citationsText += `👤 ${citation.author}  `;
        if (citation.lastModified) citationsText += `📅 Updated: ${citation.lastModified}`;
      }

      if (citation.breadcrumb && citation.breadcrumb.length > 1) {
        citationsText += `  \n🗂️ ${citation.breadcrumb.join(' > ')}`;
      }

      if (citation.snippet) {
        citationsText += `  \n💭 *${citation.snippet}*`;
      }

      citationsText += '\n';
    });

    return citationsText;
  }

  reset(): void {
    this.citations.clear();
    this.citationCounter = 1;
  }

  getCitations(): EnhancedCitation[] {
    return Array.from(this.citations.values());
  }

  getCitationStats(): {
    totalCitations: number;
    avgImportance: number;
    spaceDistribution: Record<string, number>;
  } {
    const citations = Array.from(this.citations.values());
    const totalCitations = citations.length;

    if (totalCitations === 0) {
      return {
        totalCitations: 0,
        avgImportance: 0,
        spaceDistribution: {}
      };
    }

    const avgImportance = citations.reduce((sum, c) => sum + (c.importance || 0), 0) / totalCitations;

    const spaceDistribution: Record<string, number> = {};
    citations.forEach(citation => {
      const space = citation.space || 'Unknown';
      spaceDistribution[space] = (spaceDistribution[space] || 0) + 1;
    });

    return {
      totalCitations,
      avgImportance,
      spaceDistribution
    };
  }
}