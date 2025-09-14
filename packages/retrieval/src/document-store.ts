import { DocumentStore, ParentChunk } from '@rag-assistant/core';
import fs from 'fs/promises';
import path from 'path';

export class FileDocumentStore implements DocumentStore {
  private storePath: string;
  private chunks: Map<string, ParentChunk> = new Map();
  private initialized = false;

  constructor(storePath: string = './data/document-store.json') {
    this.storePath = storePath;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure directory exists
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });

      // Load existing data if file exists
      try {
        const data = await fs.readFile(this.storePath, 'utf-8');
        const chunksArray: ParentChunk[] = JSON.parse(data);

        this.chunks.clear();
        chunksArray.forEach(chunk => {
          this.chunks.set(chunk.id, chunk);
        });

        console.log(`Document store loaded with ${this.chunks.size} parent chunks`);
      } catch (error) {
        // File doesn't exist yet, start with empty store
        console.log('Document store initialized (empty)');
      }

      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize document store: ${error}`);
    }
  }

  async storeParentChunk(chunk: ParentChunk): Promise<void> {
    await this.ensureInitialized();

    this.chunks.set(chunk.id, chunk);
    await this.persist();
  }

  async getParentChunk(id: string): Promise<ParentChunk | null> {
    await this.ensureInitialized();

    return this.chunks.get(id) || null;
  }

  async getParentChunks(ids: string[]): Promise<ParentChunk[]> {
    await this.ensureInitialized();

    const results: ParentChunk[] = [];

    for (const id of ids) {
      const chunk = this.chunks.get(id);
      if (chunk) {
        results.push(chunk);
      }
    }

    return results;
  }

  async deleteParentChunk(id: string): Promise<void> {
    await this.ensureInitialized();

    this.chunks.delete(id);
    await this.persist();
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async persist(): Promise<void> {
    try {
      const chunksArray = Array.from(this.chunks.values());
      const data = JSON.stringify(chunksArray, null, 2);
      await fs.writeFile(this.storePath, data, 'utf-8');
    } catch (error) {
      console.error('Failed to persist document store:', error);
    }
  }

  // Utility methods for management
  async getAllParentChunks(): Promise<ParentChunk[]> {
    await this.ensureInitialized();
    return Array.from(this.chunks.values());
  }

  async getChunksBySpace(space: string): Promise<ParentChunk[]> {
    await this.ensureInitialized();
    return Array.from(this.chunks.values()).filter(chunk => chunk.metadata.space === space);
  }

  async getChunksByPageId(pageId: string): Promise<ParentChunk[]> {
    await this.ensureInitialized();
    return Array.from(this.chunks.values()).filter(chunk => chunk.metadata.pageId === pageId);
  }

  async clear(): Promise<void> {
    this.chunks.clear();
    await this.persist();
  }
}

// In-memory document store for testing
export class InMemoryDocumentStore implements DocumentStore {
  private chunks: Map<string, ParentChunk> = new Map();

  async initialize(): Promise<void> {
    // No initialization needed for in-memory store
  }

  async storeParentChunk(chunk: ParentChunk): Promise<void> {
    this.chunks.set(chunk.id, chunk);
  }

  async getParentChunk(id: string): Promise<ParentChunk | null> {
    return this.chunks.get(id) || null;
  }

  async getParentChunks(ids: string[]): Promise<ParentChunk[]> {
    const results: ParentChunk[] = [];

    for (const id of ids) {
      const chunk = this.chunks.get(id);
      if (chunk) {
        results.push(chunk);
      }
    }

    return results;
  }

  async deleteParentChunk(id: string): Promise<void> {
    this.chunks.delete(id);
  }

  // Utility methods
  async getAllParentChunks(): Promise<ParentChunk[]> {
    return Array.from(this.chunks.values());
  }

  async clear(): Promise<void> {
    this.chunks.clear();
  }
}