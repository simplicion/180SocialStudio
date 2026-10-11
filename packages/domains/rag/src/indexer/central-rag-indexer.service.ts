import crypto from 'crypto';
import { prisma } from '@workspace/db';
import { DocumentChunker } from '../chunking/document-chunker';
import { EmbeddingEngine } from '../embeddings/embedding-engine';

export interface IndexDocumentParams {
  id: string;
  companyId: string;
  title?: string;
  content?: any;
  category?: string;
  vaultId?: string;
  metadata?: Record<string, any>;
}

export interface IndexFileParams {
  id: string;
  companyId: string;
  name: string;
  fileUrl?: string;
  fileType?: string;
  textContent?: string;
  buffer?: Buffer;
  category?: string;
  vaultId?: string;
  metadata?: Record<string, any>;
}

export class CentralRagIndexerService {
  private chunker: DocumentChunker;
  private embeddingEngine: EmbeddingEngine;

  constructor() {
    this.chunker = new DocumentChunker({ maxWordsPerChunk: 350, overlapWords: 60 });
    this.embeddingEngine = new EmbeddingEngine();
  }

  /**
   * Recursively extract clean human-readable text from document bodies,
   * BlockNote/ProseMirror block arrays, stringified JSON, or document variables.
   */
  public extractText(content: any): string {
    if (!content) return '';

    if (typeof content === 'string') {
      const trimmed = content.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          const parsed = JSON.parse(trimmed);
          return this.extractText(parsed);
        } catch {
          return trimmed;
        }
      }
      return trimmed;
    }

    if (Array.isArray(content)) {
      return content
        .map(item => this.extractText(item))
        .filter(Boolean)
        .join('\n');
    }

    if (typeof content === 'object') {
      const parts: string[] = [];

      // Extract specific high-value keys
      if (content.title && typeof content.title === 'string') parts.push(content.title);
      if (content.name && typeof content.name === 'string') parts.push(content.name);
      if (content.description && typeof content.description === 'string') parts.push(content.description);
      if (content.text && typeof content.text === 'string') parts.push(content.text);

      // Handle block arrays (BlockNote / ProseMirror)
      if (Array.isArray(content.blocks)) {
        parts.push(this.extractText(content.blocks));
      }

      // Handle child content arrays or strings
      if (content.content) {
        parts.push(this.extractText(content.content));
      }

      // Handle document variables (e.g. clientName, contract terms)
      if (content.variables && typeof content.variables === 'object') {
        const varStrings = Object.entries(content.variables)
          .filter(([_, v]) => v && typeof v === 'string')
          .map(([k, v]) => `${k}: ${v}`);
        if (varStrings.length > 0) parts.push(varStrings.join('\n'));
      }

      return parts.filter(Boolean).join('\n');
    }

    return String(content);
  }

  /**
   * Computes SHA-256 hash of extracted text to detect content changes.
   */
  public computeHash(text: string): string {
    return crypto.createHash('sha256').update(text.trim()).digest('hex');
  }

  /**
   * Indexes an authored 180 Document (or KnowledgeArticle) into universal RAG memory.
   * Uses SHA-256 delta hashing to skip re-embedding if content hasn't changed.
   */
  async indexDocument(params: IndexDocumentParams): Promise<{ indexed: boolean; chunkCount: number; reason?: string }> {
    const { id, companyId, title, content, category, vaultId, metadata } = params;
    if (!id || !companyId) {
      return { indexed: false, chunkCount: 0, reason: 'Missing id or companyId' };
    }

    const docTitle = title || 'Workspace Document';
    const textContent = this.extractText(content);

    // If document is virtually empty, remove any previous chunks and return
    if (!textContent || textContent.trim().length < 10) {
      await this.removeDocumentChunks(id);
      return { indexed: false, chunkCount: 0, reason: 'Document text content is too short (<10 chars)' };
    }

    const currentHash = this.computeHash(textContent);

    // Check existing chunks to avoid redundant re-embedding if unchanged
    try {
      const existing = await (prisma as any).knowledgeChunk.findFirst({
        where: { documentId: id },
        select: { metadata: true }
      });

      if (existing && existing.metadata && (existing.metadata as any).contentHash === currentHash) {
        return { indexed: false, chunkCount: 0, reason: 'Content unchanged (hash match)' };
      }
    } catch {
      // Ignore and proceed to index
    }

    // Chunk the text into semantic sections
    const chunks = this.chunker.chunkText(textContent, docTitle, {
      vaultId,
      category: category || 'General',
      purposeAnchor: docTitle
    });

    if (chunks.length === 0) {
      return { indexed: false, chunkCount: 0, reason: 'No chunks generated' };
    }

    // Generate batch vector embeddings (or deterministic fallback if offline)
    const texts = chunks.map(c => c.content);
    const embeddings = await this.embeddingEngine.generateBatchEmbeddings(texts);

    // Atomic replace: remove old chunks first
    await this.removeDocumentChunks(id);

    // Store new chunks in PostgreSQL
    await (prisma as any).knowledgeChunk.createMany({
      data: chunks.map((c, idx) => ({
        companyId,
        documentId: id,
        documentTitle: docTitle,
        vaultId: vaultId || null,
        category: category || 'General',
        chunkIndex: c.chunkIndex,
        content: c.content,
        embedding: embeddings[idx] || [],
        metadata: {
          ...c.metadata,
          ...metadata,
          documentTitle: docTitle,
          category: category || 'General',
          contentHash: currentHash,
          indexedAt: new Date().toISOString()
        }
      }))
    });

    console.log(`[CentralRagIndexer] Indexed document "${docTitle}" (${id}) -> ${chunks.length} chunks for company ${companyId}`);
    return { indexed: true, chunkCount: chunks.length };
  }

  /**
   * Indexes an uploaded file (from 180 Documents / Storage) into universal RAG memory.
   */
  async indexUploadedFile(params: IndexFileParams): Promise<{ indexed: boolean; chunkCount: number; reason?: string }> {
    const { id, companyId, name, fileType, textContent, buffer, category, vaultId, metadata } = params;
    if (!id || !companyId) {
      return { indexed: false, chunkCount: 0, reason: 'Missing id or companyId' };
    }

    let extracted = textContent || '';

    // If buffer provided for text-based types, decode to UTF-8 string
    if (!extracted && buffer) {
      const mime = (fileType || '').toLowerCase();
      const isTextFile = mime.includes('text') || mime.includes('json') || mime.includes('csv') || mime.includes('markdown') ||
        name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv') || name.endsWith('.json');

      if (isTextFile) {
        try {
          extracted = buffer.toString('utf-8');
        } catch {
          extracted = '';
        }
      }
    }

    if (!extracted || extracted.trim().length < 10) {
      return { indexed: false, chunkCount: 0, reason: 'File has no indexable text content' };
    }

    return await this.indexDocument({
      id,
      companyId,
      title: name,
      content: extracted,
      category: category || 'Uploaded Documents',
      vaultId,
      metadata: {
        ...metadata,
        fileType,
        source: 'file_upload'
      }
    });
  }

  /**
   * Deletes all knowledge chunks associated with a document ID.
   */
  async removeDocumentChunks(documentId: string): Promise<void> {
    if (!documentId) return;
    try {
      await (prisma as any).knowledgeChunk.deleteMany({
        where: { documentId }
      });
    } catch (err: any) {
      console.warn(`[CentralRagIndexer] Failed to remove chunks for doc ${documentId}:`, err.message);
    }
  }
}

export const centralRagIndexer = new CentralRagIndexerService();
