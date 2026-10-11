import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { MediaIntelligenceGraph, MediaIntelligenceGraphSchema } from "./types";

export interface IntelligenceCacheKeyParams {
  assetSha256: string;
  analysisVersion?: string;
  configHash?: string;
}

export class IntelligenceCacheManager {
  private static cacheDir = path.resolve(process.cwd(), ".vproj_cache", "intelligence");
  private static memoryCache = new Map<string, MediaIntelligenceGraph>();

  static init(customDir?: string) {
    if (customDir) {
      this.cacheDir = customDir;
    }
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch (err: any) {
      console.warn("[IntelligenceCache] Failed to initialize cache directory:", err?.message);
    }
  }

  static generateKey(params: IntelligenceCacheKeyParams): string {
    const raw = `${params.assetSha256}_${params.analysisVersion || "2.0.0"}_${params.configHash || "default"}`;
    const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);
    return `mig_${hash}`;
  }

  static get(key: string): MediaIntelligenceGraph | null {
    // 1. Check in-memory L1 cache
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key)!;
    }

    // 2. Check disk L2 cache
    try {
      this.init();
      const filePath = path.join(this.cacheDir, `${key}.json`);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(content);
        const validated = MediaIntelligenceGraphSchema.safeParse(parsed);
        if (validated.success) {
          this.memoryCache.set(key, validated.data);
          return validated.data;
        } else {
          console.warn(`[IntelligenceCache] Cache file ${key} failed schema validation; evicting.`);
          try {
            fs.unlinkSync(filePath);
          } catch {}
        }
      }
    } catch (err: any) {
      console.warn(`[IntelligenceCache] Failed to read disk cache for ${key}:`, err?.message);
    }

    return null;
  }

  static set(key: string, graph: MediaIntelligenceGraph): void {
    // 1. Save to in-memory L1
    this.memoryCache.set(key, graph);

    // 2. Persist to disk L2
    try {
      this.init();
      const filePath = path.join(this.cacheDir, `${key}.json`);
      const tempPath = `${filePath}.tmp_${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(graph, null, 2), "utf-8");
      fs.renameSync(tempPath, filePath);
    } catch (err: any) {
      console.warn(`[IntelligenceCache] Failed to write disk cache for ${key}:`, err?.message);
    }
  }

  static clear(): void {
    this.memoryCache.clear();
    try {
      if (fs.existsSync(this.cacheDir)) {
        const files = fs.readdirSync(this.cacheDir);
        for (const f of files) {
          try {
            fs.unlinkSync(path.join(this.cacheDir, f));
          } catch {}
        }
      }
    } catch (err: any) {
      console.warn("[IntelligenceCache] Clear failed:", err?.message);
    }
  }
}
