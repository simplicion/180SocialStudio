import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export interface PexelsVideoFile {
  id: number;
  quality: "hd" | "sd" | "hls";
  file_type: string;
  width: number;
  height: number;
  fps?: number;
  link: string;
}

export interface PexelsVideoItem {
  id: string;
  title: string;
  url: string;
  duration: number;
  width: number;
  height: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  thumbnailUrl: string;
  previewVideoUrl: string;
  downloadUrl: string;
  photographer: string;
  photographerUrl: string;
  license: string;
}

export interface PexelsPhotoItem {
  id: string;
  title: string;
  url: string;
  width: number;
  height: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  thumbnailUrl: string;
  downloadUrl: string;
  photographer: string;
  photographerUrl: string;
  license: string;
}

export interface PexelsStockSearchResult {
  query: string;
  totalResults: number;
  page: number;
  perPage: number;
  videos: PexelsVideoItem[];
  photos: PexelsPhotoItem[];
}

export class PexelsClient {
  private static readonly BASE_URL = "https://api.pexels.com";

  /** Reads the key from the environment only. Returns null when unset so fallback stock providers work. */
  static getApiKey(): string | null {
    return process.env.PEXELS_API_KEY || process.env.NEXT_PUBLIC_PEXELS_API_KEY || null;
  }

  /**
   * Search HD stock videos from Pexels matching query and target orientation (e.g. 9:16 portrait for reels or 16:9 landscape)
   */
  static async searchVideos(options: {
    query: string;
    orientation?: "landscape" | "portrait" | "square";
    size?: "large" | "medium" | "small";
    perPage?: number;
    page?: number;
    log?: (msg: string) => void;
  }): Promise<{ totalResults: number; videos: PexelsVideoItem[] }> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      options.log?.("[PexelsClient] Warning: No PEXELS_API_KEY configured.");
      return { totalResults: 0, videos: [] };
    }

    const {
      query,
      orientation = "landscape",
      size,
      perPage = 10,
      page = 1,
    } = options;

    const params = new URLSearchParams({
      query,
      per_page: String(Math.min(80, Math.max(1, perPage))),
      page: String(page),
      orientation,
    });
    if (size) params.append("size", size);

    const targetUrl = `${this.BASE_URL}/videos/search?${params.toString()}`;
    options.log?.(`[PexelsClient] Searching videos: "${query}" (${orientation}, perPage=${perPage})...`);

    try {
      const response = await fetch(targetUrl, {
        headers: {
          Authorization: apiKey,
          "User-Agent": "180MediaStudio/1.0 (Autonomous AI Director)",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        options.log?.(`[PexelsClient] Video search error: HTTP ${response.status} - ${errorText}`);
        return { totalResults: 0, videos: [] };
      }

      const data: any = await response.json();
      const rawVideos: any[] = data.videos || [];

      const parsedVideos: PexelsVideoItem[] = rawVideos.map((v: any) => {
        const files: PexelsVideoFile[] = v.video_files || [];
        // Prioritize HD 1080p MP4, fallback to best quality mp4
        const mp4Files = files.filter((f) => f.file_type === "video/mp4" || !f.file_type);
        const hdFile =
          mp4Files.find((f) => f.quality === "hd" && f.width >= 1080) ||
          mp4Files.find((f) => f.quality === "hd") ||
          mp4Files[0] ||
          files[0];

        const sdFile =
          mp4Files.find((f) => f.quality === "sd") ||
          mp4Files.find((f) => f.width <= 720) ||
          hdFile;

        const w = v.width || 1920;
        const h = v.height || 1080;
        let aspect: "16:9" | "9:16" | "1:1" = "16:9";
        if (h > w * 1.2) aspect = "9:16";
        else if (Math.abs(w - h) < 100) aspect = "1:1";

        const title = v.url
          ? v.url.split("/video/")[1]?.replace(/-\d+\/?$/, "")?.replace(/-/g, " ") || query
          : query;

        return {
          id: `pexels_video_${v.id}`,
          title: title.charAt(0).toUpperCase() + title.slice(1),
          url: v.url,
          duration: v.duration || 10,
          width: w,
          height: h,
          aspectRatio: aspect,
          thumbnailUrl: v.image || v.video_pictures?.[0]?.picture || "",
          previewVideoUrl: sdFile?.link || hdFile?.link || "",
          downloadUrl: hdFile?.link || sdFile?.link || "",
          photographer: v.user?.name || "Pexels Creator",
          photographerUrl: v.user?.url || "https://www.pexels.com",
          license: "Pexels Free Commercial License (Royalty Free)",
        };
      });

      options.log?.(`[PexelsClient] Successfully found ${parsedVideos.length} videos.`);
      return {
        totalResults: data.total_results || parsedVideos.length,
        videos: parsedVideos,
      };
    } catch (err: any) {
      options.log?.(`[PexelsClient] Failed to fetch Pexels videos: ${err.message}`);
      return { totalResults: 0, videos: [] };
    }
  }

  /**
   * Search high-resolution stock photos from Pexels matching query and target orientation
   */
  static async searchPhotos(options: {
    query: string;
    orientation?: "landscape" | "portrait" | "square";
    perPage?: number;
    page?: number;
    log?: (msg: string) => void;
  }): Promise<{ totalResults: number; photos: PexelsPhotoItem[] }> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      options.log?.("[PexelsClient] Warning: No PEXELS_API_KEY configured.");
      return { totalResults: 0, photos: [] };
    }

    const { query, orientation = "landscape", perPage = 10, page = 1 } = options;

    const params = new URLSearchParams({
      query,
      per_page: String(Math.min(80, Math.max(1, perPage))),
      page: String(page),
      orientation,
    });

    const targetUrl = `${this.BASE_URL}/v1/search?${params.toString()}`;
    options.log?.(`[PexelsClient] Searching photos: "${query}" (${orientation}, perPage=${perPage})...`);

    try {
      const response = await fetch(targetUrl, {
        headers: {
          Authorization: apiKey,
          "User-Agent": "180MediaStudio/1.0 (Autonomous AI Director)",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        options.log?.(`[PexelsClient] Photo search error: HTTP ${response.status} - ${errorText}`);
        return { totalResults: 0, photos: [] };
      }

      const data: any = await response.json();
      const rawPhotos: any[] = data.photos || [];

      const parsedPhotos: PexelsPhotoItem[] = rawPhotos.map((p: any) => {
        const w = p.width || 1920;
        const h = p.height || 1080;
        let aspect: "16:9" | "9:16" | "1:1" = "16:9";
        if (h > w * 1.2) aspect = "9:16";
        else if (Math.abs(w - h) < 100) aspect = "1:1";

        const title = p.alt || query;

        return {
          id: `pexels_photo_${p.id}`,
          title: title.charAt(0).toUpperCase() + title.slice(1),
          url: p.url,
          width: w,
          height: h,
          aspectRatio: aspect,
          thumbnailUrl: p.src?.medium || p.src?.small || p.src?.tiny || "",
          downloadUrl: p.src?.large2x || p.src?.large || p.src?.original || "",
          photographer: p.photographer || "Pexels Photographer",
          photographerUrl: p.photographer_url || "https://www.pexels.com",
          license: "Pexels Free Commercial License (Royalty Free)",
        };
      });

      options.log?.(`[PexelsClient] Successfully found ${parsedPhotos.length} photos.`);
      return {
        totalResults: data.total_results || parsedPhotos.length,
        photos: parsedPhotos,
      };
    } catch (err: any) {
      options.log?.(`[PexelsClient] Failed to fetch Pexels photos: ${err.message}`);
      return { totalResults: 0, photos: [] };
    }
  }

  /**
   * Unified stock search for videos, photos, or both
   */
  static async searchStock(options: {
    query: string;
    type?: "video" | "photo" | "all";
    orientation?: "landscape" | "portrait" | "square";
    perPage?: number;
    page?: number;
    log?: (msg: string) => void;
  }): Promise<PexelsStockSearchResult> {
    const { query, type = "all", orientation = "landscape", perPage = 10, page = 1, log } = options;

    let videos: PexelsVideoItem[] = [];
    let photos: PexelsPhotoItem[] = [];
    let totalResults = 0;

    if (type === "video" || type === "all") {
      const vRes = await this.searchVideos({ query, orientation, perPage, page, log });
      videos = vRes.videos;
      totalResults += vRes.totalResults;
    }

    if (type === "photo" || type === "all") {
      const pRes = await this.searchPhotos({ query, orientation, perPage, page, log });
      photos = pRes.photos;
      totalResults += pRes.totalResults;
    }

    return {
      query,
      totalResults,
      page,
      perPage,
      videos,
      photos,
    };
  }

  /**
   * Downloads a stock video or photo asset to a local file path
   */
  static async downloadAsset(downloadUrl: string, targetFilePath: string): Promise<boolean> {
    const dir = path.dirname(targetFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // If already downloaded and valid, skip
    if (fs.existsSync(targetFilePath) && fs.statSync(targetFilePath).size > 1024) {
      return true;
    }

    try {
      const res = await fetch(downloadUrl, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) return false;

      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(targetFilePath, buffer);
      return true;
    } catch {
      return false;
    }
  }
}
