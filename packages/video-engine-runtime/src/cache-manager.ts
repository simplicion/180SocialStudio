import * as fs from "fs";
import * as path from "path";
import { ContentAddressedKeyGenerator } from "@workspace/video-contracts";

export interface CacheStats {
  totalFiles: number;
  totalSizeBytes: number;
  cacheDirectory: string;
}

export class ContentAddressedCacheManager {
  private cacheDir: string;

  constructor(cacheDirectory: string) {
    this.cacheDir = cacheDirectory;
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Checks if an exact content-addressed cache artifact exists.
   */
  has(cacheKey: string): boolean {
    const entryPath = path.join(this.cacheDir, `${cacheKey}.cache`);
    return fs.existsSync(entryPath);
  }

  /**
   * Reads cached JSON payload if available.
   */
  get<T>(cacheKey: string): T | null {
    const entryPath = path.join(this.cacheDir, `${cacheKey}.cache`);
    if (!fs.existsSync(entryPath)) return null;

    try {
      const data = fs.readFileSync(entryPath, "utf-8");
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  /**
   * Stores an artifact payload keyed by its content hash.
   */
  set<T>(cacheKey: string, payload: T): void {
    const entryPath = path.join(this.cacheDir, `${cacheKey}.cache`);
    fs.writeFileSync(entryPath, JSON.stringify(payload, null, 2));
  }

  /**
   * Retrieves overall disk statistics for the cache directory.
   */
  getStats(): CacheStats {
    if (!fs.existsSync(this.cacheDir)) {
      return { totalFiles: 0, totalSizeBytes: 0, cacheDirectory: this.cacheDir };
    }

    const files = fs.readdirSync(this.cacheDir);
    let totalSizeBytes = 0;

    files.forEach((f) => {
      try {
        const stats = fs.statSync(path.join(this.cacheDir, f));
        totalSizeBytes += stats.size;
      } catch {}
    });

    return {
      totalFiles: files.length,
      totalSizeBytes,
      cacheDirectory: this.cacheDir,
    };
  }

  /**
   * Cleans all cached entries from disk.
   */
  clear(): void {
    if (!fs.existsSync(this.cacheDir)) return;
    const files = fs.readdirSync(this.cacheDir);
    files.forEach((f) => {
      try {
        fs.unlinkSync(path.join(this.cacheDir, f));
      } catch {}
    });
  }
}
