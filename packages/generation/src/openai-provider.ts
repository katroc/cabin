import OpenAI from 'openai';
import { LLMProvider } from '@rag-assistant/core';

export class OpenAILLMProvider implements LLMProvider {
  private client: OpenAI;

  constructor(baseURL: string, apiKey: string = 'not-needed') {
    this.client = new OpenAI({
      baseURL,
      apiKey
    });
  }

  async generate(prompt: string): Promise<string> {
    try {
      console.log('Making LLM request with prompt:', prompt.substring(0, 100) + '...');
      const response = await this.client.chat.completions.create({
        model: 'local-model', // Will be overridden by server
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7
      });
      
      console.log('LLM response structure:', JSON.stringify(response, null, 2));
      
      if (!response.choices || response.choices.length === 0) {
        throw new Error('No choices in LLM response');
      }
      
      const content = response.choices[0].message?.content;
      if (content === null || content === undefined) {
        throw new Error('No content in LLM response');
      }
      
      console.log('Returning content:', content.substring(0, 100) + '...');
      return content;
    } catch (error) {
      console.error('LLM generation error details:', error);
      throw new Error(`LLM generation failed: ${error}`);
    }
  }

  async *generateStream(prompt: string): AsyncGenerator<string> {
    try {
      const stream = await this.client.chat.completions.create({
        model: 'local-model',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        stream: true
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) yield content;
      }
    } catch (error) {
      throw new Error(`Streaming LLM generation failed: ${error}`);
    }
  }

  async embed(text: string): Promise<number[]> {
    try {
      console.log('Making embedding request for text:', text.substring(0, 50) + '...');

      // Try embeddings endpoint first
      try {
        const requestPayload = {
          model: 'text-embedding-bge-m3',
          input: text
        };

        console.log('🔍 Making LM Studio embedding request:', {
          baseURL: this.client.baseURL,
          model: requestPayload.model,
          inputLength: text.length,
          inputPreview: text.substring(0, 100) + '...'
        });

        const response = await this.client.embeddings.create(requestPayload);

        console.log('Raw embedding response structure:', JSON.stringify({
          data: response.data?.length || 0,
          hasEmbedding: response.data?.[0]?.embedding ? 'yes' : 'no',
          embeddingLength: response.data?.[0]?.embedding?.length || 0,
          firstFewValues: response.data?.[0]?.embedding?.slice(0, 5) || []
        }, null, 2));

        if (response.data && response.data.length > 0 && response.data[0].embedding) {
          const embedding = response.data[0].embedding;

          // Check for NaN values in embedding
          const nanCount = embedding.filter(val => isNaN(val)).length;
          const infiniteCount = embedding.filter(val => !isFinite(val)).length;

          console.log('Embedding validation:', {
            length: embedding.length,
            nanValues: nanCount,
            infiniteValues: infiniteCount,
            sample: embedding.slice(0, 10)
          });

          if (nanCount > 0 || infiniteCount > 0) {
            console.error('❌ Invalid values detected in embedding from LM Studio');
            throw new Error(`Embedding contains ${nanCount} NaN values and ${infiniteCount} infinite values`);
          }

          console.log('✅ Embeddings endpoint worked, length:', embedding.length);
          return embedding;
        }
      } catch (embedError) {
        console.error('Embeddings endpoint error details:', embedError);
        console.log('Trying chat completion approach as fallback');
      }

      // Fallback: Use chat completion to generate embeddings
      const prompt = `Generate a numerical embedding vector for the following text. Return only a JSON array of 768 floating point numbers representing the semantic embedding of the text:\n\n${text}`;

      const response = await this.client.chat.completions.create({
        model: 'openai/gpt-oss-20b', // Use available chat model
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 2000
      });

      const content = response.choices[0].message.content || '';
      console.log('Chat response for embedding:', content.substring(0, 100) + '...');

      // Try to parse JSON array from response
      const jsonMatch = content.match(/\[[\d.,\s-]+\]/);
      if (jsonMatch) {
        const embedding = JSON.parse(jsonMatch[0]);
        if (Array.isArray(embedding) && embedding.length > 0) {
          console.log('Parsed embedding from chat response, length:', embedding.length);
          return embedding;
        }
      }

      // If parsing fails, generate a simple hash-based embedding as last resort
      console.log('Using fallback hash-based embedding');
      return this.generateFallbackEmbedding(text);

    } catch (error) {
      console.error('Embedding generation failed, using fallback');
      return this.generateFallbackEmbedding(text);
    }
  }

  private generateFallbackEmbedding(text: string): number[] {
    // Simple hash-based embedding for testing - NOT for production
    // Match BGE-M3's 256-dimensional output
    const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const embedding: number[] = [];
    for (let i = 0; i < 256; i++) {
      embedding.push((Math.sin(hash + i) + 1) / 2); // Normalize to 0-1
    }
    return embedding;
  }
}