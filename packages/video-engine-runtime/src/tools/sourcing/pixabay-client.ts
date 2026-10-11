import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import axios from "axios";

export interface PixabayImageItem {
  id: string;
  type: "photo" | "illustration" | "vector";
  title: string;
  pageURL: string;
  previewUrl: string;
  webformatUrl: string;
  largeImageUrl: string;
  fullHDUrl?: string;
  downloadUrl: string;
  width: number;
  height: number;
  tags: string[];
  user: string;
  views: number;
  downloads: number;
  likes: number;
}

export interface PixabayVideoStream {
  url: string;
  width: number;
  height: number;
  size: number;
  thumbnail: string;
}

export interface PixabayVideoItem {
  id: string;
  type: "film" | "animation";
  title: string;
  pageURL: string;
  duration: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  thumbnailUrl: string;
  downloadUrl: string;
  width: number;
  height: number;
  videos: {
    large?: PixabayVideoStream;
    medium?: PixabayVideoStream;
    small?: PixabayVideoStream;
    tiny?: PixabayVideoStream;
  };
  tags: string[];
  user: string;
  views: number;
  downloads: number;
  likes: number;
}

export interface PixabayAudioItem {
  id: string;
  title: string;
  audioUrl: string;
  durationSec: number;
  tags: string[];
}

export interface PixabayStockSearchResult {
  query: string;
  totalHits: number;
  page: number;
  perPage: number;
  videos: PixabayVideoItem[];
  photos: PixabayImageItem[];
  illustrations: PixabayImageItem[];
  vectors: PixabayImageItem[];
  audio?: PixabayAudioItem[];
  rateLimit: {
    limit: number;
    remaining: number;
    resetSeconds: number;
  };
}

interface CacheEntry<T> {
  timestamp: number;
  data: T;
}

export class PixabayClient {
  private static readonly BASE_URL = "https://pixabay.com/api";
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Mandatory 24 hours per Pixabay API terms
  private static readonly DISK_CACHE_DIR = path.join(os.tmpdir(), "pixabay_cache_v1");

  // In-memory 24-hour cache
  private static memoryCache = new Map<string, CacheEntry<any>>();

  // Sliding window rate limiter state (100 req / 60 sec)
  private static requestTimestamps: number[] = [];
  private static rateLimitLimit = 100;
  private static rateLimitRemaining = 100;
  private static rateLimitReset = 60;

  /** Reads the key from the environment only. Returns null when unset so fallback stock providers work. */
  static getApiKey(): string | null {
    return process.env.PIXABAY_API_KEY || process.env.NEXT_PUBLIC_PIXABAY_API_KEY || null;
  }

  /**
   * Initializes local disk cache directory
   */
  private static initCacheDir(): void {
    try {
      if (!fs.existsSync(this.DISK_CACHE_DIR)) {
        fs.mkdirSync(this.DISK_CACHE_DIR, { recursive: true });
      }
    } catch {
      // Ignore cache dir creation error
    }
  }

  /**
   * Generates a deterministic SHA256 key for query caching
   */
  private static getCacheKey(type: string, query: string, options: any): string {
    const raw = `${type}_${query.toLowerCase().trim()}_${JSON.stringify(options)}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  /**
   * Retrieves cached data if valid within 24 hours
   */
  private static getCached<T>(key: string): T | null {
    const now = Date.now();

    // 1. Check memory cache
    const mem = this.memoryCache.get(key);
    if (mem && now - mem.timestamp < this.CACHE_TTL_MS) {
      return mem.data as T;
    }

    // 2. Check disk cache
    try {
      this.initCacheDir();
      const filePath = path.join(this.DISK_CACHE_DIR, `${key}.json`);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        const entry: CacheEntry<T> = JSON.parse(raw);
        if (now - entry.timestamp < this.CACHE_TTL_MS) {
          this.memoryCache.set(key, entry);
          return entry.data;
        }
      }
    } catch {
      // Disk cache read fallback
    }

    return null;
  }

  /**
   * Saves data into 24-hour memory and disk cache
   */
  private static setCached<T>(key: string, data: T): void {
    const entry: CacheEntry<T> = { timestamp: Date.now(), data };
    this.memoryCache.set(key, entry);

    try {
      this.initCacheDir();
      const filePath = path.join(this.DISK_CACHE_DIR, `${key}.json`);
      fs.writeFileSync(filePath, JSON.stringify(entry), "utf-8");
    } catch {
      // Ignore disk cache write errors
    }
  }

  /**
   * Sliding window rate limiter guard (100 req per 60s)
   */
  private static async waitForRateLimit(log?: (msg: string) => void): Promise<void> {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((t) => now - t < 60000);

    // If we've made 98+ calls in the last 60s or remaining reports <= 2, throttle briefly
    if (this.requestTimestamps.length >= 98 || this.rateLimitRemaining <= 2) {
      const waitMs = Math.max(1000, Math.min(60000, (this.rateLimitReset || 10) * 1000));
      log?.(`[PixabayClient] Rate limit approaching (${this.rateLimitRemaining} remaining). Throttling for ${Math.round(waitMs / 1000)}s...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.requestTimestamps.push(Date.now());
  }

  /**
   * Parses rate limit response headers from Pixabay
   */
  private static updateRateLimitHeaders(headers: any): void {
    if (!headers) return;
    if (headers["x-ratelimit-limit"]) {
      this.rateLimitLimit = parseInt(headers["x-ratelimit-limit"], 10) || 100;
    }
    if (headers["x-ratelimit-remaining"]) {
      this.rateLimitRemaining = parseInt(headers["x-ratelimit-remaining"], 10) || 100;
    }
    if (headers["x-ratelimit-reset"]) {
      this.rateLimitReset = parseInt(headers["x-ratelimit-reset"], 10) || 60;
    }
  }

  /**
   * Searches royalty-free images (photos, vector graphics, and illustrations)
   */
  static async searchImages(options: {
    query: string;
    imageType?: "all" | "photo" | "illustration" | "vector";
    orientation?: "all" | "horizontal" | "vertical";
    category?: string;
    colors?: string;
    editorsChoice?: boolean;
    safeSearch?: boolean;
    order?: "popular" | "latest";
    page?: number;
    perPage?: number;
    log?: (msg: string) => void;
  }): Promise<{ totalHits: number; images: PixabayImageItem[] }> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      options.log?.("[PixabayClient] PIXABAY_API_KEY is not configured.");
      return { totalHits: 0, images: [] };
    }
    const {
      query,
      imageType = "all",
      orientation = "all",
      category,
      colors,
      editorsChoice = false,
      safeSearch = true,
      order = "popular",
      page = 1,
      perPage = 20,
      log,
    } = options;

    const cacheKey = this.getCacheKey("images", query, { imageType, orientation, category, colors, page, perPage });
    const cached = this.getCached<{ totalHits: number; images: PixabayImageItem[] }>(cacheKey);
    if (cached) {
      log?.(`[PixabayClient] 24h Cache Hit for image query: "${query}" (${cached.images.length} items)`);
      return cached;
    }

    await this.waitForRateLimit(log);

    const params: Record<string, string> = {
      key: apiKey,
      q: query.trim(),
      image_type: imageType,
      orientation,
      safesearch: safeSearch ? "true" : "false",
      order,
      page: String(page),
      per_page: String(Math.min(200, Math.max(3, perPage))),
    };

    if (category) params.category = category;
    if (colors) params.colors = colors;
    if (editorsChoice) params.editors_choice = "true";

    try {
      const res = await axios.get(`${this.BASE_URL}/`, { params, timeout: 12000 });
      this.updateRateLimitHeaders(res.headers);

      const hits: any[] = res.data?.hits || [];
      const images: PixabayImageItem[] = hits.map((h: any) => ({
        id: `pixabay_img_${h.id}`,
        type: h.type === "vector/svg" ? "vector" : h.type === "illustration" ? "illustration" : "photo",
        title: h.tags || query,
        pageURL: h.pageURL,
        previewUrl: h.previewURL,
        webformatUrl: h.webformatURL,
        largeImageUrl: h.largeImageURL || h.webformatURL,
        fullHDUrl: h.fullHDURL,
        downloadUrl: h.largeImageURL || h.webformatURL || h.imageURL || "",
        width: h.imageWidth || 1920,
        height: h.imageHeight || 1080,
        tags: (h.tags || "").split(",").map((t: string) => t.trim()),
        user: h.user || "Pixabay Contributor",
        views: h.views || 0,
        downloads: h.downloads || 0,
        likes: h.likes || 0,
      }));

      const result = { totalHits: res.data?.totalHits || images.length, images };
      this.setCached(cacheKey, result);
      return result;
    } catch (err: any) {
      if (err.response?.status === 429) {
        log?.("[PixabayClient] 429 Rate Limit hit. Backing off...");
        this.rateLimitRemaining = 0;
      }
      log?.(`[PixabayClient] Image search error: ${err.message}`);
      return { totalHits: 0, images: [] };
    }
  }

  /**
   * Searches royalty-free 4K/HD video clips (film and animations)
   */
  static async searchVideos(options: {
    query: string;
    videoType?: "all" | "film" | "animation";
    orientation?: "all" | "horizontal" | "vertical";
    category?: string;
    editorsChoice?: boolean;
    safeSearch?: boolean;
    order?: "popular" | "latest";
    page?: number;
    perPage?: number;
    log?: (msg: string) => void;
  }): Promise<{ totalHits: number; videos: PixabayVideoItem[] }> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      options.log?.("[PixabayClient] PIXABAY_API_KEY is not configured.");
      return { totalHits: 0, videos: [] };
    }
    const {
      query,
      videoType = "all",
      orientation = "all",
      category,
      editorsChoice = false,
      safeSearch = true,
      order = "popular",
      page = 1,
      perPage = 20,
      log,
    } = options;

    const cacheKey = this.getCacheKey("videos", query, { videoType, orientation, category, page, perPage });
    const cached = this.getCached<{ totalHits: number; videos: PixabayVideoItem[] }>(cacheKey);
    if (cached) {
      log?.(`[PixabayClient] 24h Cache Hit for video query: "${query}" (${cached.videos.length} items)`);
      return cached;
    }

    await this.waitForRateLimit(log);

    const params: Record<string, string> = {
      key: apiKey,
      q: query.trim(),
      video_type: videoType,
      safesearch: safeSearch ? "true" : "false",
      order,
      page: String(page),
      per_page: String(Math.min(200, Math.max(3, perPage))),
    };

    if (category) params.category = category;
    if (editorsChoice) params.editors_choice = "true";

    try {
      const res = await axios.get(`${this.BASE_URL}/videos/`, { params, timeout: 12000 });
      this.updateRateLimitHeaders(res.headers);

      const hits: any[] = res.data?.hits || [];
      const videos: PixabayVideoItem[] = hits.map((h: any) => {
        const streamVideos = h.videos || {};
        // Choose best available resolution
        const bestStream = streamVideos.large || streamVideos.medium || streamVideos.small || streamVideos.tiny;
        const width = bestStream?.width || 1920;
        const height = bestStream?.height || 1080;
        const aspectRatio: "16:9" | "9:16" | "1:1" =
          height > width ? "9:16" : Math.abs(width - height) < 50 ? "1:1" : "16:9";

        return {
          id: `pixabay_vid_${h.id}`,
          type: h.type === "animation" ? "animation" : "film",
          title: h.tags || query,
          pageURL: h.pageURL,
          duration: h.duration || 10,
          aspectRatio,
          thumbnailUrl: bestStream?.thumbnail || "",
          downloadUrl: bestStream?.url || "",
          width,
          height,
          videos: streamVideos,
          tags: (h.tags || "").split(",").map((t: string) => t.trim()),
          user: h.user || "Pixabay Contributor",
          views: h.views || 0,
          downloads: h.downloads || 0,
          likes: h.likes || 0,
        };
      });

      // Filter by orientation if requested
      const filtered = orientation === "vertical"
        ? videos.filter((v) => v.aspectRatio === "9:16")
        : orientation === "horizontal"
        ? videos.filter((v) => v.aspectRatio === "16:9")
        : videos;

      const finalVideos = filtered.length > 0 ? filtered : videos;
      const result = { totalHits: res.data?.totalHits || finalVideos.length, videos: finalVideos };
      this.setCached(cacheKey, result);
      return result;
    } catch (err: any) {
      if (err.response?.status === 429) {
        log?.("[PixabayClient] 429 Rate Limit hit on video search. Backing off...");
        this.rateLimitRemaining = 0;
      }
      log?.(`[PixabayClient] Video search error: ${err.message}`);
      return { totalHits: 0, videos: [] };
    }
  }

  /**
   * Unified search across photos, vector illustrations, and videos
   */
  static async searchStock(options: {
    query: string;
    orientation?: "landscape" | "portrait" | "square" | "all";
    perPage?: number;
    page?: number;
    log?: (msg: string) => void;
  }): Promise<PixabayStockSearchResult> {
    const pixabayOrientation =
      options.orientation === "portrait"
        ? "vertical"
        : options.orientation === "landscape"
        ? "horizontal"
        : "all";

    const [imgRes, vidRes] = await Promise.all([
      this.searchImages({
        query: options.query,
        orientation: pixabayOrientation,
        perPage: options.perPage || 15,
        page: options.page || 1,
        log: options.log,
      }),
      this.searchVideos({
        query: options.query,
        orientation: pixabayOrientation,
        perPage: options.perPage || 15,
        page: options.page || 1,
        log: options.log,
      }),
    ]);

    const photos = imgRes.images.filter((img) => img.type === "photo");
    const illustrations = imgRes.images.filter((img) => img.type === "illustration");
    const vectors = imgRes.images.filter((img) => img.type === "vector");

    return {
      query: options.query,
      totalHits: imgRes.totalHits + vidRes.totalHits,
      page: options.page || 1,
      perPage: options.perPage || 15,
      videos: vidRes.videos,
      photos,
      illustrations,
      vectors,
      audio: [],
      rateLimit: {
        limit: this.rateLimitLimit,
        remaining: this.rateLimitRemaining,
        resetSeconds: this.rateLimitReset,
      },
    };
  }

  /**
   * Anti-Hotlinking Asset Ingestion Pipeline:
   * Downloads remote Pixabay asset to server/disk storage to prevent direct CDN hotlinking
   * in accordance with Pixabay API terms.
   */
  static async downloadAsset(
    downloadUrl: string,
    destinationPath: string,
    log?: (msg: string) => void
  ): Promise<string> {
    if (fs.existsSync(destinationPath) && fs.statSync(destinationPath).size > 0) {
      return destinationPath;
    }

    const dir = path.dirname(destinationPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    log?.(`[PixabayClient] Ingesting asset from CDN to local storage (Anti-Hotlink): ${path.basename(destinationPath)}`);

    const response = await axios.get(downloadUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
      headers: {
        "User-Agent": "180Workspace-VideoEngine/2.0",
      },
    });

    fs.writeFileSync(destinationPath, Buffer.from(response.data));
    return destinationPath;
  }
}
