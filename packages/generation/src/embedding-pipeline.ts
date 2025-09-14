import { LLMProvider, Chunk } from '@rag-assistant/core';

export class EmbeddingPipeline {
  private provider: LLMProvider;
  private batchSize: number;

  constructor(provider: LLMProvider, batchSize: number = 10) {
    this.provider = provider;
    this.batchSize = batchSize;
  }

  async generateEmbeddings(chunks: Chunk[]): Promise<Chunk[]> {
    const embeddedChunks: Chunk[] = [];

    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batch = chunks.slice(i, i + this.batchSize);
      const batchPromises = batch.map(async (chunk, index) => {
        console.log(`Processing chunk ${i + index + 1}/${chunks.length}: ${chunk.text.substring(0, 50)}...`);

        const vector = await this.provider.embed(chunk.text);

        // Validate embedding after receiving from provider
        const nanCount = vector.filter(val => isNaN(val)).length;
        const infiniteCount = vector.filter(val => !isFinite(val)).length;

        console.log(`Chunk ${i + index + 1} embedding validation:`, {
          length: vector.length,
          nanValues: nanCount,
          infiniteValues: infiniteCount,
          sample: vector.slice(0, 5)
        });

        if (nanCount > 0 || infiniteCount > 0) {
          console.error(`❌ Invalid embedding for chunk ${i + index + 1}:`, {
            chunkId: chunk.id,
            textPreview: chunk.text.substring(0, 100) + '...',
            nanValues: nanCount,
            infiniteValues: infiniteCount
          });
          throw new Error(`Chunk ${i + index + 1} contains ${nanCount} NaN and ${infiniteCount} infinite values`);
        }

        return { ...chunk, vector };
      });

      const embeddedBatch = await Promise.all(batchPromises);
      embeddedChunks.push(...embeddedBatch);

      console.log(`✅ Completed batch ${Math.floor(i / this.batchSize) + 1}, processed ${embeddedBatch.length} chunks`);
    }

    return embeddedChunks;
  }

  normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));

    // Avoid division by zero which would create NaN values
    if (magnitude === 0 || !isFinite(magnitude)) {
      console.warn('⚠️ Zero or invalid magnitude detected, returning original vector');
      return vector;
    }

    const normalized = vector.map(val => val / magnitude);

    // Validate normalized result
    const nanCount = normalized.filter(val => isNaN(val)).length;
    if (nanCount > 0) {
      console.error('❌ Normalization produced NaN values, returning original vector');
      return vector;
    }

    return normalized;
  }

  async generateAndNormalizeEmbeddings(chunks: Chunk[]): Promise<Chunk[]> {
    const embedded = await this.generateEmbeddings(chunks);

    console.log('🔍 Pre-normalization embedding validation:');
    embedded.forEach((chunk, i) => {
      if (chunk.vector) {
        const nanCount = chunk.vector.filter(val => isNaN(val)).length;
        console.log(`  Chunk ${i + 1} pre-norm: length=${chunk.vector.length}, nanCount=${nanCount}, sample=[${chunk.vector.slice(0, 5).join(', ')}...]`);
      }
    });

    const normalized = embedded.map((chunk, index) => {
      if (!chunk.vector) {
        return { ...chunk, vector: undefined };
      }

      console.log(`🔄 Normalizing chunk ${index + 1}, input: [${chunk.vector.slice(0, 5).join(', ')}...]`);
      const normalizedVector = this.normalizeVector(chunk.vector);
      console.log(`   ✅ Normalized result: [${normalizedVector.slice(0, 5).join(', ')}...]`);

      return {
        ...chunk,
        vector: normalizedVector
      };
    });

    console.log('🔍 Post-normalization embedding validation:');
    normalized.forEach((chunk, i) => {
      if (chunk.vector) {
        const nanCount = chunk.vector.filter(val => isNaN(val)).length;
        console.log(`  Chunk ${i + 1} post-norm: length=${chunk.vector.length}, nanCount=${nanCount}, sample=[${chunk.vector.slice(0, 5).join(', ')}...]`);
      }
    });

    return normalized;
  }
}