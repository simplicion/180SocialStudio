export interface VectorDocument {
    id: string;
    docId: string;
    text: string;
    embedding: number[];
    metadata: any;
}
export declare class VectorStore {
    private static instance;
    private storePath;
    private documents;
    constructor();
    static getInstance(): VectorStore;
    private loadStore;
    private saveStore;
    generateEmbedding(text: string): Promise<number[]>;
    private cosineSimilarity;
    addDocument(id: string, text: string, metadata?: any): Promise<void>;
    search(query: string, topK?: number, filter?: ((meta: any) => boolean) | null): Promise<VectorDocument[]>;
}
export declare const vectorStore: VectorStore;
