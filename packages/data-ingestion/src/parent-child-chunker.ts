import { ParentChildChunker, Document, ParentChunk, ChildChunk, LLMProvider } from '@rag-assistant/core';

export class ParentChildChunkerImpl implements ParentChildChunker {
  private llm: LLMProvider;
  private parentChunkSize: number;
  private childChunkSize: number;
  private childOverlap: number;

  constructor(
    llm: LLMProvider,
    parentChunkSize: number = 4000,
    childChunkSize: number = 400,
    childOverlap: number = 50
  ) {
    this.llm = llm;
    this.parentChunkSize = parentChunkSize;
    this.childChunkSize = childChunkSize;
    this.childOverlap = childOverlap;
  }

  async createParentChunks(document: Document): Promise<ParentChunk[]> {
    const parentChunks: ParentChunk[] = [];

    try {
      // Use LLM to identify semantic sections with headings
      const sections = await this.identifySemanticSections(document.text);

      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const parentId = `parent_${document.id}_${i}`;

        const parentChunk: ParentChunk = {
          id: parentId,
          documentId: document.id,
          title: section.heading || `${document.pageTitle} - Section ${i + 1}`,
          text: section.text,
          sectionIndex: i,
          metadata: {
            pageId: document.pageId,
            pageTitle: document.pageTitle,
            space: document.space,
            spaceName: document.spaceName,
            author: document.author,
            lastModified: document.lastModified,
            confluenceUrl: document.confluenceUrl,
            breadcrumb: document.breadcrumb,
            sectionAnchor: section.anchor,
            heading: section.heading,
          }
        };

        parentChunks.push(parentChunk);
      }
    } catch (error) {
      console.warn('LLM section identification failed, falling back to structural splitting:', error);
      // Fallback to structural splitting by headings
      return this.fallbackStructuralSplit(document);
    }

    return parentChunks;
  }

  async createChildChunks(parentChunk: ParentChunk): Promise<ChildChunk[]> {
    const childChunks: ChildChunk[] = [];
    const text = parentChunk.text;

    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
      let end = Math.min(start + this.childChunkSize, text.length);

      // Avoid cutting sentences in half
      if (end < text.length) {
        const lastPeriod = text.lastIndexOf('.', end);
        const lastNewline = text.lastIndexOf('\n', end);
        const lastSpace = text.lastIndexOf(' ', end);

        // Find the best break point
        let breakPoint = end;
        if (lastPeriod > start + this.childChunkSize * 0.5) {
          breakPoint = lastPeriod + 1;
        } else if (lastNewline > start + this.childChunkSize * 0.5) {
          breakPoint = lastNewline;
        } else if (lastSpace > start + this.childChunkSize * 0.5) {
          breakPoint = lastSpace;
        }

        end = breakPoint;
      }

      const chunkText = text.substring(start, end).trim();

      if (chunkText.length > 0) {
        const childId = `child_${parentChunk.id}_${chunkIndex}`;

        const childChunk: ChildChunk = {
          id: childId,
          parentId: parentChunk.id,
          text: chunkText,
          chunkIndex: chunkIndex,
          metadata: {
            pageId: parentChunk.metadata.pageId,
            pageTitle: parentChunk.metadata.pageTitle,
            space: parentChunk.metadata.space,
            confluenceUrl: parentChunk.metadata.confluenceUrl,
            importance_score: await this.calculateImportanceScore(chunkText, parentChunk.title),
          }
        };

        childChunks.push(childChunk);
        chunkIndex++;
      }

      // Move start position with overlap
      start = Math.max(start + this.childChunkSize - this.childOverlap, end);
    }

    return childChunks;
  }

  private async identifySemanticSections(text: string): Promise<Array<{text: string, heading?: string, anchor?: string}>> {
    const prompt = `Analyze this document and identify major semantic sections. For each section, provide:
1. The section text (complete paragraphs)
2. A descriptive heading if there isn't one
3. An anchor name for linking

Text:
${text.substring(0, 8000)}${text.length > 8000 ? '...' : ''}

Format your response as JSON array:
[{"text": "section content", "heading": "Section Title", "anchor": "section-anchor"}]`;

    try {
      const response = await this.llm.generate(prompt);

      // Try to parse JSON response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const sections = JSON.parse(jsonMatch[0]);
        return sections;
      }

      // Fallback parsing
      return this.parseTextSections(response, text);
    } catch (error) {
      throw new Error(`LLM section identification failed: ${error}`);
    }
  }

  private parseTextSections(response: string, originalText: string): Array<{text: string, heading?: string, anchor?: string}> {
    // Simple fallback parsing when JSON parsing fails
    const lines = response.split('\n');
    const sections: Array<{text: string, heading?: string, anchor?: string}> = [];

    // Split by major headings or every parentChunkSize characters
    const chunks = this.splitIntoChunks(originalText, this.parentChunkSize);

    chunks.forEach((chunk, index) => {
      const firstLine = chunk.split('\n')[0];
      const heading = firstLine.length < 100 ? firstLine.trim() : `Section ${index + 1}`;

      sections.push({
        text: chunk,
        heading: heading,
        anchor: this.createAnchor(heading)
      });
    });

    return sections;
  }

  private fallbackStructuralSplit(document: Document): ParentChunk[] {
    const parentChunks: ParentChunk[] = [];

    // Split by headings (markdown-style) or large chunks
    const sections = this.splitByHeadings(document.text);

    sections.forEach((section, index) => {
      const parentId = `parent_${document.id}_${index}`;

      const parentChunk: ParentChunk = {
        id: parentId,
        documentId: document.id,
        title: section.heading || `${document.pageTitle} - Section ${index + 1}`,
        text: section.text,
        sectionIndex: index,
        metadata: {
          pageId: document.pageId,
          pageTitle: document.pageTitle,
          space: document.space,
          spaceName: document.spaceName,
          author: document.author,
          lastModified: document.lastModified,
          confluenceUrl: document.confluenceUrl,
          breadcrumb: document.breadcrumb,
          sectionAnchor: section.anchor,
          heading: section.heading,
        }
      };

      parentChunks.push(parentChunk);
    });

    return parentChunks;
  }

  private splitByHeadings(text: string): Array<{text: string, heading?: string, anchor?: string}> {
    const sections: Array<{text: string, heading?: string, anchor?: string}> = [];

    // Split by markdown headings or large sections
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const headings = [];
    let match;

    while ((match = headingRegex.exec(text)) !== null) {
      headings.push({
        level: match[1].length,
        text: match[2],
        index: match.index
      });
    }

    if (headings.length === 0) {
      // No headings found, split into large chunks
      const chunks = this.splitIntoChunks(text, this.parentChunkSize);
      return chunks.map((chunk, index) => ({
        text: chunk,
        heading: `Section ${index + 1}`,
        anchor: `section-${index + 1}`
      }));
    }

    // Split by headings
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      const nextHeading = headings[i + 1];

      const sectionStart = heading.index;
      const sectionEnd = nextHeading ? nextHeading.index : text.length;
      const sectionText = text.substring(sectionStart, sectionEnd).trim();

      sections.push({
        text: sectionText,
        heading: heading.text,
        anchor: this.createAnchor(heading.text)
      });
    }

    return sections;
  }

  private splitIntoChunks(text: string, size: number): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + size;
      if (end >= text.length) {
        chunks.push(text.substring(start));
        break;
      }

      // Find the last paragraph break within the chunk
      const lastDoubleNewline = text.lastIndexOf('\n\n', end);
      const lastNewline = text.lastIndexOf('\n', end);

      if (lastDoubleNewline > start + size * 0.5) {
        end = lastDoubleNewline;
      } else if (lastNewline > start + size * 0.5) {
        end = lastNewline;
      }

      chunks.push(text.substring(start, end).trim());
      start = end;
    }

    return chunks;
  }

  private createAnchor(heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
  }

  private async calculateImportanceScore(text: string, sectionTitle: string): Promise<number> {
    // Simple heuristic-based importance scoring
    let score = 0.5; // Base score

    // Higher score for longer chunks (more content)
    score += Math.min(text.length / 1000, 0.2);

    // Higher score for chunks with key terms
    const importantTerms = ['important', 'critical', 'note', 'warning', 'required', 'must', 'should'];
    const lowerText = text.toLowerCase();
    importantTerms.forEach(term => {
      if (lowerText.includes(term)) score += 0.1;
    });

    // Higher score for chunks with structured content
    if (text.includes('•') || text.includes('-') || text.includes('1.') || text.includes('*')) {
      score += 0.1;
    }

    // Higher score if it's early in the section
    if (sectionTitle && text.includes(sectionTitle.substring(0, 20))) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }
}