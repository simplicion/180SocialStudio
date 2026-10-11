/**
 * DocumentChunker
 * 
 * High-performance semantic document chunker for universal RAG ingestion.
 * Supports Markdown, CSV tables, text transcripts, and extracted PDF documents.
 */

export interface DocumentChunk {
  chunkIndex: number;
  content: string;
  metadata: {
    wordCount: number;
    charCount: number;
    sectionTitle?: string;
    vaultId?: string;
    category?: string;
    documentTitle?: string;
    purposeAnchor?: string;
  };
}

export interface ChunkingOptions {
  maxWordsPerChunk?: number;
  overlapWords?: number;
}

export class DocumentChunker {
  private maxWords: number;
  private overlapWords: number;

  constructor(options: ChunkingOptions = {}) {
    this.maxWords = options.maxWordsPerChunk || 350; // ~450 tokens
    this.overlapWords = options.overlapWords || 60;  // ~80 tokens
  }

  /**
   * Split raw document text into clean, contextual semantic chunks.
   */
  chunkText(
    rawText: string,
    docTitle?: string,
    extraMetadata?: { vaultId?: string; category?: string; purposeAnchor?: string }
  ): DocumentChunk[] {
    if (!rawText || !rawText.trim()) return [];

    // Strip executable scripts and HTML tags for security
    const sanitized = rawText
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>?/gm, ' ');

    const normalized = sanitized
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!normalized) return [];

    // 1. Break into natural semantic sections (by Markdown headers or double line breaks)
    const sections = normalized.split(/\n(?=#{1,4}\s|\b[A-Z0-9\s]{4,30}:)/);
    const chunks: DocumentChunk[] = [];
    let currentChunkIndex = 0;

    const baseMeta = {
      vaultId: extraMetadata?.vaultId,
      category: extraMetadata?.category || 'General',
      documentTitle: docTitle || 'Knowledge Document',
      purposeAnchor: extraMetadata?.purposeAnchor ? extraMetadata.purposeAnchor.slice(0, 500) : undefined
    };

    for (const section of sections) {
      const trimmedSection = section.trim();
      if (!trimmedSection) continue;

      // Extract section header if present
      let sectionTitle = docTitle || 'General Knowledge';
      const headerMatch = trimmedSection.match(/^(?:#{1,4}\s+|([A-Z0-9\s]{4,30}):)(.+)$/m);
      if (headerMatch) {
        sectionTitle = (headerMatch[2] || headerMatch[1] || '').trim();
      }

      const words = trimmedSection.split(/\s+/).filter(Boolean);

      if (words.length <= this.maxWords) {
        // Fits comfortably in a single chunk
        chunks.push({
          chunkIndex: currentChunkIndex++,
          content: trimmedSection,
          metadata: {
            ...baseMeta,
            wordCount: words.length,
            charCount: trimmedSection.length,
            sectionTitle
          }
        });
      } else {
        // Slice into overlapping sliding-window chunks
        let startIndex = 0;
        while (startIndex < words.length) {
          const endIndex = Math.min(startIndex + this.maxWords, words.length);
          const chunkWords = words.slice(startIndex, endIndex);
          const chunkText = chunkWords.join(' ');

          chunks.push({
            chunkIndex: currentChunkIndex++,
            content: chunkText,
            metadata: {
              ...baseMeta,
              wordCount: chunkWords.length,
              charCount: chunkText.length,
              sectionTitle
            }
          });

          if (endIndex >= words.length) break;
          startIndex += (this.maxWords - this.overlapWords);
        }
      }
    }

    return chunks;
  }
}
