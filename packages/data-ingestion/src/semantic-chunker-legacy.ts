import { Chunker, Chunk, LLMProvider } from '@rag-assistant/core';

export class SemanticChunker implements Chunker {
  private llm: LLMProvider;
  private maxChunkSize: number;

  constructor(llm: LLMProvider, maxChunkSize: number = 800) {
    this.llm = llm;
    this.maxChunkSize = maxChunkSize;
  }

  async chunk(text: string): Promise<Chunk[]> {
    const chunks: Chunk[] = [];
    const sections = await this.identifySections(text);

    for (const section of sections) {
      if (section.length <= this.maxChunkSize) {
        chunks.push(this.createChunk(section, chunks.length));
      } else {
        // Split large sections into smaller chunks
        const subChunks = this.splitIntoChunks(section, this.maxChunkSize);
        subChunks.forEach((subChunk, index) => {
          chunks.push(this.createChunk(subChunk, chunks.length + index));
        });
      }
    }

    return chunks;
  }

  private async identifySections(text: string): Promise<string[]> {
    const prompt = `Identify natural sections in the following text. Split at paragraph breaks, headings, or logical topic changes. Return sections separated by '---SECTION_BREAK---':

${text}`;

    try {
      const response = await this.llm.generate(prompt);
      return response.split('---SECTION_BREAK---').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    } catch (error) {
      // Fallback to simple paragraph splitting
      return text.split('\n\n').filter(p => p.trim().length > 0);
    }
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

      // Find the last sentence end within the chunk
      const lastPeriod = text.lastIndexOf('.', end);
      const lastNewline = text.lastIndexOf('\n', end);

      if (lastPeriod > start && lastPeriod > lastNewline) {
        end = lastPeriod + 1;
      } else if (lastNewline > start) {
        end = lastNewline;
      }

      chunks.push(text.substring(start, end).trim());
      start = end;
    }

    return chunks;
  }

  private createChunk(text: string, index: number): Chunk {
    return {
      id: `chunk_${Date.now()}_${index}`,
      pageId: '', // To be set by caller
      space: '', // To be set by caller
      title: '', // To be set by caller
      text,
      metadata: {
        semantic_type: 'section'
      }
    };
  }
}