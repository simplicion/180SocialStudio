/**
 * 180 Media Studio - Persistent Media File Cache (IndexedDB)
 * 
 * Provides resilient, local-first storage for user-imported video, audio, and image assets.
 * Ephemeral browser blob URLs (blob:http://...) expire across page reloads and cause Chromium
 * Demuxer errors (PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN).
 * 
 * This service persists the raw File/Blob objects in IndexedDB so that on page reload,
 * projects can automatically re-hydrate live, valid blob URLs, and gracefully handle
 * any missing or corrupted media sources with NLE "Media Offline" placeholders.
 */

import { ProjectPackageManifest } from "@workspace/video-contracts";

const DB_NAME = "180_media_studio_cache_v1";
const DB_VERSION = 1;
const STORE_MEDIA_FILES = "media_files";

interface CachedMediaRecord {
  id: string;
  file: Blob | File;
  name: string;
  mimeType: string;
  updatedAt: number;
}

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

export class MediaCacheService {
  /**
   * Initializes and opens the IndexedDB database.
   */
  private static async getDB(): Promise<IDBDatabase> {
    if (typeof window === "undefined" || !window.indexedDB) {
      throw new Error("IndexedDB is not supported in this runtime.");
    }

    if (dbInstance) return dbInstance;
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_MEDIA_FILES)) {
          db.createObjectStore(STORE_MEDIA_FILES, { keyPath: "id" });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = (event.target as IDBOpenDBRequest).result;
        dbInstance.onversionchange = () => {
          dbInstance?.close();
          dbInstance = null;
          dbPromise = null;
        };
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        console.warn("[MediaCacheService] IndexedDB open error:", (event.target as IDBOpenDBRequest).error);
        reject((event.target as IDBOpenDBRequest).error);
      };
    });

    return dbPromise;
  }

  /**
   * Caches a media file/blob into IndexedDB.
   */
  static async saveMediaFile(
    id: string,
    file: Blob | File,
    name: string,
    mimeType: string
  ): Promise<void> {
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_MEDIA_FILES, "readwrite");
        const store = transaction.objectStore(STORE_MEDIA_FILES);
        const record: CachedMediaRecord = {
          id,
          file,
          name,
          mimeType,
          updatedAt: Date.now(),
        };
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn("[MediaCacheService] Failed to cache media file to IndexedDB:", e);
    }
  }

  /**
   * Retrieves a cached media record from IndexedDB.
   */
  static async getMediaFile(id: string): Promise<CachedMediaRecord | null> {
    try {
      const db = await this.getDB();
      return await new Promise<CachedMediaRecord | null>((resolve) => {
        const transaction = db.transaction(STORE_MEDIA_FILES, "readonly");
        const store = transaction.objectStore(STORE_MEDIA_FILES);
        const req = store.get(id);
        req.onsuccess = () => {
          resolve(req.result || null);
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  /**
   * Creates a fresh active blob URL from the cached file.
   */
  static async getOrCreateBlobUrl(id: string): Promise<string | null> {
    try {
      const record = await this.getMediaFile(id);
      if (record && record.file) {
        return URL.createObjectURL(record.file);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Tests if a blob URL is still reachable and active in the current browser session.
   */
  static async isBlobUrlLive(url: string): Promise<boolean> {
    if (!url || !url.startsWith("blob:")) {
      return true; // Not a blob URL (e.g. data URI, staticFile, or https remote)
    }

    try {
      const response = await fetch(url, { method: "HEAD" });
      return response.ok || response.status === 200 || response.type === "basic";
    } catch {
      return false;
    }
  }

  /**
   * Generates a safe, self-contained SVG Data URI with "Media Offline" graphics.
   * This is universally decodable by Chromium and HTML5 elements with 0 demux errors.
   */
  static generateFallbackPlaceholderDataUrl(label = "Media Offline", width = 1280, height = 720): string {
    const escapedLabel = label.replace(/[<>&"]/g, "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#090A0F"/>
  <defs>
    <pattern id="stripes" width="30" height="30" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="30" stroke="#EF4444" stroke-width="2" opacity="0.15"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#stripes)"/>
  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" fill="none" stroke="#EF4444" stroke-width="2" stroke-dasharray="8 8" rx="16" opacity="0.4"/>
  <circle cx="${width / 2}" cy="${height / 2 - 40}" r="44" fill="#EF4444" opacity="0.15"/>
  <path d="M${width / 2} ${height / 2 - 65} L${width / 2 - 25} ${height / 2 - 20} L${width / 2 + 25} ${height / 2 - 20} Z" fill="none" stroke="#EF4444" stroke-width="3" stroke-linejoin="round"/>
  <line x1="${width / 2}" y1="${height / 2 - 45}" x2="${width / 2}" y2="${height / 2 - 32}" stroke="#EF4444" stroke-width="3" stroke-linecap="round"/>
  <circle cx="${width / 2}" cy="${height / 2 - 26}" r="2" fill="#EF4444"/>
  <text x="${width / 2}" y="${height / 2 + 28}" font-family="system-ui, sans-serif" font-size="28" font-weight="800" fill="#F87171" text-anchor="middle" letter-spacing="2">MEDIA OFFLINE</text>
  <text x="${width / 2}" y="${height / 2 + 60}" font-family="system-ui, sans-serif" font-size="16" font-weight="500" fill="#9CA3AF" text-anchor="middle">${escapedLabel}</text>
  <text x="${width / 2}" y="${height / 2 + 90}" font-family="system-ui, sans-serif" font-size="12" fill="#6B7280" text-anchor="middle">Session blob expired • Click to re-link media in Asset Bin</text>
</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  /**
   * Verifies all media assets in a project package manifest.
   * If any blob URLs are dead, tries to re-hydrate from IndexedDB.
   * If not available in IndexedDB, safely points to a lightweight SVG placeholder
   * to guarantee that Remotion never attempts to demux a dead blob.
   */
  /**
   * Verifies all media assets and timeline clips in a project package manifest.
   * If any blob URLs are dead, tries to re-hydrate from IndexedDB.
   * If not available in IndexedDB, marks the clip/asset as isOffline = true and clears
   * the dead blob URL so that Remotion never attempts to open a non-existent stream.
   */
  static async verifyAndRepairProjectManifest(
    manifest: ProjectPackageManifest
  ): Promise<ProjectPackageManifest> {
    if (!manifest) return manifest;

    const urlReplacements = new Map<string, string>();
    const updatedAssets = [...(manifest.assets || [])];
    let hasChanges = false;

    // 1. Verify and repair manifest.assets
    for (let i = 0; i < updatedAssets.length; i++) {
      const asset = { ...updatedAssets[i] };
      if (!asset.filePath || !asset.filePath.startsWith("blob:")) {
        continue;
      }

      const isLive = await this.isBlobUrlLive(asset.filePath);
      if (isLive) {
        continue;
      }

      console.warn(`[MediaCacheService] Detected dead blob URL for asset: ${asset.id} (${asset.name}). Re-hydrating...`);

      // Try to re-hydrate from IndexedDB
      const freshBlob = await this.getOrCreateBlobUrl(asset.id);
      if (freshBlob) {
        urlReplacements.set(asset.filePath, freshBlob);
        asset.filePath = freshBlob;
        (asset as any).isOffline = false;
        updatedAssets[i] = asset;
        hasChanges = true;
        console.log(`[MediaCacheService] Re-hydrated asset ${asset.id} with live blob URL.`);
      } else {
        (asset as any).isOffline = true;
        updatedAssets[i] = asset;
        hasChanges = true;
        console.warn(`[MediaCacheService] Asset ${asset.id} is offline (session expired).`);
      }
    }

    // 2. Deep-verify and repair every clip directly in video and audio tracks
    const updatedEditIR = JSON.parse(JSON.stringify(manifest.editIR || { tracks: { videoTracks: [], audioTracks: [] } }));
    for (const vTrack of updatedEditIR.tracks?.videoTracks || []) {
      for (const clip of vTrack.clips || []) {
        if (!clip.sourcePath) {
          (clip as any).isOffline = true;
          continue;
        }

        if (urlReplacements.has(clip.sourcePath)) {
          clip.sourcePath = urlReplacements.get(clip.sourcePath)!;
          (clip as any).isOffline = false;
          hasChanges = true;
          continue;
        }

        if (clip.sourcePath.startsWith("blob:")) {
          const isLive = await this.isBlobUrlLive(clip.sourcePath);
          if (!isLive) {
            console.warn(`[MediaCacheService] Detected dead blob on video clip ${clip.id}. Re-hydrating...`);
            const fresh = await this.getOrCreateBlobUrl(clip.assetId || clip.id);
            if (fresh) {
              urlReplacements.set(clip.sourcePath, fresh);
              clip.sourcePath = fresh;
              (clip as any).isOffline = false;
              hasChanges = true;
            } else {
              // Mark clip offline so Remotion displays the Media Offline slate without attempting video demuxing
              (clip as any).isOffline = true;
              clip.sourcePath = "";
              hasChanges = true;
            }
          }
        }
      }
    }

    for (const aTrack of updatedEditIR.tracks?.audioTracks || []) {
      for (const clip of aTrack.clips || []) {
        if (!clip.sourcePath) continue;
        if (urlReplacements.has(clip.sourcePath)) {
          clip.sourcePath = urlReplacements.get(clip.sourcePath)!;
          hasChanges = true;
          continue;
        }
        if (clip.sourcePath.startsWith("blob:")) {
          const isLive = await this.isBlobUrlLive(clip.sourcePath);
          if (!isLive) {
            const fresh = await this.getOrCreateBlobUrl(clip.assetId || clip.id);
            if (fresh) {
              urlReplacements.set(clip.sourcePath, fresh);
              clip.sourcePath = fresh;
              hasChanges = true;
            } else {
              (clip as any).isOffline = true;
              clip.sourcePath = "";
              hasChanges = true;
            }
          }
        }
      }
    }

    const repairedManifest: ProjectPackageManifest = {
      ...manifest,
      assets: updatedAssets,
      editIR: updatedEditIR,
    };

    // If changes occurred, auto-update localStorage so the project stays clean
    if (hasChanges && typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("180_media_studio_projects");
        if (stored) {
          const projects = JSON.parse(stored);
          const idx = projects.findIndex((p: any) => p.id === repairedManifest.project.id);
          if (idx !== -1) {
            projects[idx] = {
              ...projects[idx],
              manifest: repairedManifest,
              updatedAt: new Date().toISOString(),
            };
            localStorage.setItem("180_media_studio_projects", JSON.stringify(projects));
          }
        }
      } catch {}
    }

    return repairedManifest;
  }
}
