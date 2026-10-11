import axios from 'axios';

/**
 * EmbeddingEngine
 * 
 * High-performance vector embedding and cosine similarity service.
 * Supports OpenAI text-embedding-3-small with batch processing.
 */

export class EmbeddingEngine {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model: string = 'text-embedding-3-small') {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    this.model = model;
  }

  /**
   * Generates a 1536-dimensional vector embedding for a single text string.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const embeddings = await this.generateBatchEmbeddings([text]);
    return embeddings[0] || [];
  }

  /**
   * Generates vector embeddings for a batch of text chunks.
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    if (!this.apiKey) {
      console.warn('[EmbeddingEngine] OPENAI_API_KEY missing, using deterministic pseudo-embeddings for local fallback.');
      return texts.map(t => this.generateLocalFallbackEmbedding(t));
    }

    try {
      const sanitizedTexts = texts.map(t => t.replace(/\n+/g, ' ').slice(0, 8000));
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          model: this.model,
          input: sanitizedTexts
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      const data = response.data?.data || [];
      return data.map((item: any) => item.embedding);
    } catch (err: any) {
      console.warn('[EmbeddingEngine] OpenAI embeddings API warning:', err.message);
      return texts.map(t => this.generateLocalFallbackEmbedding(t));
    }
  }

  /**
   * Calculates Cosine Similarity between two vector arrays (Score between 0.0 and 1.0).
   */
  static cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Lightweight local semantic hash embedding fallback when offline / no key.
   */
  private generateLocalFallbackEmbedding(text: string): number[] {
    const dim = 1536;
    const vec = new Array(dim).fill(0);
    const words = text.toLowerCase().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      let hash = 0;
      for (let j = 0; j < word.length; j++) {
        hash = (hash << 5) - hash + word.charCodeAt(j);
        hash |= 0;
      }
      const idx = Math.abs(hash) % dim;
      vec[idx] += 1 / (i + 1);
    }
    // Normalize vector
    const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vec.map(v => v / mag);
  }
}
