import { BrollCandidate, MediaAssetDescriptor } from "./types";

export class BrollIndexer {
  private index: BrollCandidate[] = [];

  constructor(assets: MediaAssetDescriptor[] = []) {
    this.indexAssets(assets);
  }

  /**
   * Indexes available imported project assets into a semantic catalog.
   */
  indexAssets(assets: MediaAssetDescriptor[]) {
    this.index = [];

    for (const asset of assets) {
      const isVideoOrImage =
        asset.mimeType?.startsWith("video/") ||
        asset.mimeType?.startsWith("image/") ||
        Boolean(asset.name.match(/\.(mp4|mov|webm|png|jpg|jpeg|webp)$/i));

      if (!isVideoOrImage) continue;

      const lowerName = asset.name.toLowerCase();

      // Extract semantic tags from file name and metadata
      const tags: string[] = [];
      const topics: string[] = [];
      const detectedObjects: string[] = [];

      if (lowerName.includes("product") || lowerName.includes("demo") || lowerName.includes("device")) {
        tags.push("product", "demo", "hardware");
        topics.push("product overview");
        detectedObjects.push("product", "laptop");
      }
      if (lowerName.includes("screen") || lowerName.includes("ui") || lowerName.includes("code")) {
        tags.push("screen", "software", "interface");
        topics.push("technology", "workflow");
        detectedObjects.push("screen", "laptop");
      }
      if (lowerName.includes("broll") || lowerName.includes("overlay") || lowerName.includes("cutaway")) {
        tags.push("b-roll", "cutaway", "atmosphere");
        topics.push("visual support");
      }
      if (lowerName.includes("office") || lowerName.includes("work") || lowerName.includes("desk")) {
        tags.push("office", "working", "workspace");
        detectedObjects.push("desk", "laptop");
      }

      this.index.push({
        assetId: asset.id,
        assetName: asset.name,
        filePath: asset.filePath,
        durationSeconds: asset.durationSeconds || 5.0,
        startSeconds: 0,
        endSeconds: asset.durationSeconds || 5.0,
        visualSummary: `Visual asset: ${asset.name} (${tags.join(", ") || "general"})`,
        detectedObjects,
        topics,
        semanticTags: tags,
        suitabilityScore: 0.85,
      });
    }
  }

  /**
   * Performs semantic query across available project assets.
   * STRICTLY searches user's imported media only—never invents or hallucinates external media.
   */
  findBroll(query: string, maxResults = 3): BrollCandidate[] {
    if (this.index.length === 0) return [];

    const queryTokens = query
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s]/gu, "")
      .split(/\s+/)
      .filter((t) => t.length > 2);

    const scored = this.index.map((candidate) => {
      let matchScore = 0;
      const haystack = `${candidate.assetName} ${candidate.visualSummary} ${candidate.semanticTags.join(" ")} ${candidate.topics.join(" ")} ${candidate.detectedObjects.join(" ")}`.toLowerCase();

      for (const token of queryTokens) {
        if (haystack.includes(token)) {
          matchScore += 1.0;
        }
      }

      const normalizedScore = queryTokens.length > 0 ? matchScore / queryTokens.length : 0.5;
      return { candidate, score: normalizedScore };
    });

    return scored
      .filter((s) => s.score > 0.2 || this.index.length === 1) // Match or best candidate
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map((s) => s.candidate);
  }

  getAllCandidates(): BrollCandidate[] {
    return [...this.index];
  }
}
