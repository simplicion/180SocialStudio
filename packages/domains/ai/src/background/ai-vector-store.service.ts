import fs from 'fs';
import path from 'path';

export interface VectorDocument {
    id: string;
    docId: string;
    text: string;
    embedding: number[];
    metadata: any;
}

export class VectorStore {
    private static instance: VectorStore;
    private storePath: string;
    private documents: VectorDocument[];

    constructor() {
        this.storePath = path.join(__dirname, 'vector_store.json');
        this.documents = [];
        this.loadStore();
    }

    public static getInstance(): VectorStore {
        if (!VectorStore.instance) {
            VectorStore.instance = new VectorStore();
        }
        return VectorStore.instance;
    }

    private loadStore() {
        try {
            if (fs.existsSync(this.storePath)) {
                this.documents = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
            } else {
                this.documents = [];
            }
        } catch (err) {
            this.documents = [];
        }
    }

    private saveStore() {
        try {
            const dir = path.dirname(this.storePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.storePath, JSON.stringify(this.documents, null, 2));
        } catch (err) {
            console.warn('[VectorStore] Failed to save store file:', err);
        }
    }

    async generateEmbedding(text: string): Promise<number[]> {
        let apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            try {
                const { PlatformAiVaultService } = require('../kernel/platform-ai-vault.service');
                const vault = await PlatformAiVaultService.getDecryptedPlatformAiSettings();
                if (vault?.openaiKey) apiKey = vault.openaiKey;
            } catch {}
        }
        if (!apiKey) {
            throw new Error('OpenAI API key is not configured in the Admin Panel or environment. Real embeddings require a valid API key.');
        }

        try {
            const { OpenAI } = require('openai');
            const openai = new OpenAI({ apiKey });
            const response = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: text,
            });
            return response.data[0].embedding;
        } catch (err) {
            console.error('[VectorStore] OpenAI embedding generation failed:', err);
            throw new Error(`Failed to generate embeddings: ${err}`);
        }
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
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

    async addDocument(id: string, text: string, metadata: any = {}) {
        try {
            const chunks = text.match(/[\s\S]{1,1000}/g) || [text];

            for (let i = 0; i < chunks.length; i++) {
                let chunkEmbedding: number[] = [];
                try {
                    chunkEmbedding = await this.generateEmbedding(chunks[i]);
                } catch (embErr) {
                    // Fallback to simple zero-vector if OpenAI key is missing/fails
                    chunkEmbedding = [];
                }

                this.documents.push({
                    id: `${id}_chunk_${i}`,
                    docId: id,
                    text: chunks[i],
                    embedding: chunkEmbedding,
                    metadata
                });
            }
            this.saveStore();
        } catch (err: any) {
            console.warn(`[VectorStore] Failed to index document ${id}:`, err.message);
        }
    }

    async search(query: string, topK: number = 3, filter: ((meta: any) => boolean) | null = null): Promise<VectorDocument[]> {
        try {
            if (!query) return [];
            let queryEmbedding: number[] | null = null;
            try {
                queryEmbedding = await this.generateEmbedding(query);
            } catch (err) {
                queryEmbedding = null;
            }

            if (!queryEmbedding) {
                // Token overlap ranking fallback when OpenAI embeddings are not configured
                const queryTerms = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
                return this.documents
                    .filter(doc => (filter ? filter(doc.metadata) : true))
                    .map(doc => {
                        const lowerDoc = doc.text.toLowerCase();
                        const matchCount = queryTerms.filter(t => lowerDoc.includes(t)).length;
                        return { ...doc, score: matchCount / Math.max(1, queryTerms.length) };
                    })
                    .filter(doc => doc.score > 0)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, topK);
            }

            const results = this.documents
                .filter(doc => (filter ? filter(doc.metadata) : true))
                .filter(doc => doc.embedding && doc.embedding.length > 0)
                .map(doc => ({
                    ...doc,
                    score: this.cosineSimilarity(queryEmbedding!, doc.embedding)
                }))
                .sort((a, b) => (b.score || 0) - (a.score || 0))
                .slice(0, topK);

            return results;
        } catch (err) {
            console.warn('[VectorStore] Vector search failed. Returning empty results.');
            return [];
        }
    }
}

export const vectorStore = VectorStore.getInstance();
