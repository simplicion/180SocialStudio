import { prisma } from '@workspace/db';
import { EmbeddingEngine } from '../embeddings/embedding-engine';

export interface SearchResult {
  chunkId: string;
  documentTitle: string;
  content: string;
  score: number;
  metadata: any;
}

export interface SearchOptions {
  vaultId?: string;
  vaultIds?: string[];
  category?: string;
  fastPath?: boolean;
}

export class HybridSearchService {
  private embeddingEngine: EmbeddingEngine;

  constructor(apiKey?: string) {
    this.embeddingEngine = new EmbeddingEngine(apiKey);
  }

  /**
   * Performs high-speed Hybrid Semantic + Keyword Search across a company's knowledge base or scoped RAG vaults.
   */
  async search(
    companyId: string,
    query: string,
    topK: number = 3,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    if (!companyId || !query || !query.trim()) return [];

    const queryEmbedding = await this.embeddingEngine.generateEmbedding(query);
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    // Build database query filters with multi-tenant companyId isolation
    const whereClause: any = { companyId };
    
    if (options.vaultId) {
      whereClause.vaultId = options.vaultId;
    } else if (options.vaultIds && options.vaultIds.length > 0) {
      whereClause.vaultId = { in: options.vaultIds };
    }

    if (options.category && options.category !== 'All') {
      whereClause.category = options.category;
    }

    // Fetch chunks for this company and scope
    const chunks = await (prisma as any).knowledgeChunk.findMany({
      where: whereClause,
      take: options.fastPath ? 80 : 250 // Sub-sample top relevant candidates for ultra low-latency voice scoring
    }).catch(() => []);

    if (!chunks || chunks.length === 0) return [];

    const scoredResults: SearchResult[] = [];

    for (const chunk of chunks) {
      let embeddingArr: number[] = [];
      try {
        embeddingArr = Array.isArray(chunk.embedding)
          ? chunk.embedding
          : (typeof chunk.embedding === 'string' ? JSON.parse(chunk.embedding) : []);
      } catch {
        embeddingArr = [];
      }

      // 1. Vector Cosine Similarity (Semantic Score: 0 to 1)
      const vectorScore = embeddingArr.length > 0
        ? EmbeddingEngine.cosineSimilarity(queryEmbedding, embeddingArr)
        : 0;

      // 2. Keyword Match Density (Lexical BM25 approximation)
      const lowerContent = (chunk.content || '').toLowerCase();
      let keywordHits = 0;
      for (const term of queryTerms) {
        if (lowerContent.includes(term)) {
          keywordHits++;
        }
      }
      const keywordScore = queryTerms.length > 0 ? (keywordHits / queryTerms.length) : 0;

      // 3. Hybrid Combined Score (70% Vector + 30% Keyword)
      const hybridScore = (vectorScore * 0.7) + (keywordScore * 0.3);

      if (hybridScore > 0.20 || keywordHits > 0) {
        scoredResults.push({
          chunkId: chunk.id,
          documentTitle: chunk.documentTitle || chunk.metadata?.documentTitle || 'Knowledge Document',
          content: chunk.content,
          score: Math.round(hybridScore * 100) / 100,
          metadata: {
            ...chunk.metadata,
            category: chunk.category,
            vaultId: chunk.vaultId
          }
        });
      }
    }

    // Sort by highest score first
    scoredResults.sort((a, b) => b.score - a.score);
    return scoredResults.slice(0, topK);
  }
}
