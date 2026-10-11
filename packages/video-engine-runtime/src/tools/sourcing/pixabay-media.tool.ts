import { z } from "zod";
import * as path from "path";
import * as fs from "fs";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import { PixabayClient } from "./pixabay-client";

export interface PixabayMediaItem {
  id: string;
  type: "video" | "photo" | "illustration" | "vector" | "music";
  title: string;
  downloadUrl: string;
  localCachedPath: string;
  durationSec?: number;
  width?: number;
  height?: number;
  tags: string[];
}

export const PixabayMediaInputSchema = z.object({
  query: z.string(),
  mediaType: z.enum(["video", "photo", "illustration", "vector", "music"]).default("video"),
  orientation: z.enum(["landscape", "portrait", "square"]).optional().default("portrait"),
  maxResults: z.number().optional().default(3),
});

export type PixabayMediaInput = z.infer<typeof PixabayMediaInputSchema>;

export interface PixabayMediaOutput {
  items: PixabayMediaItem[];
  totalFound: number;
}

export class PixabayMediaTool extends VideoDirectorTool<PixabayMediaInput, PixabayMediaOutput> {
  readonly name = "pixabay_search";
  readonly description = "Searches and downloads royalty-free 4K/HD video clips, vector illustrations, and background music tracks from the Pixabay open stock catalog with 24h caching and anti-hotlink protection.";
  readonly stage = "TIMELINE_COMPOSITION" as const;
  readonly inputSchema = PixabayMediaInputSchema;

  async execute(input: PixabayMediaInput, context: DirectorExecutionContext): Promise<PixabayMediaOutput> {
    context.log?.(`[PixabayMediaTool] Sourcing ${input.mediaType} assets for: "${input.query}" (${input.orientation})...`);

    const cacheDir = path.join(context.tempDir, "pixabay");
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const pixabayOrientation =
      input.orientation === "portrait" ? "vertical" : input.orientation === "landscape" ? "horizontal" : "all";

    const items: PixabayMediaItem[] = [];

    try {
      if (input.mediaType === "video") {
        const res = await PixabayClient.searchVideos({
          query: input.query,
          orientation: pixabayOrientation,
          perPage: input.maxResults || 3,
          log: context.log,
        });

        for (const vid of res.videos.slice(0, input.maxResults || 3)) {
          const localPath = path.join(cacheDir, `${vid.id}.mp4`);
          const downloaded = await PixabayClient.downloadAsset(vid.downloadUrl, localPath, context.log);

          items.push({
            id: vid.id,
            type: "video",
            title: vid.title,
            downloadUrl: vid.downloadUrl,
            localCachedPath: downloaded,
            durationSec: vid.duration,
            width: vid.width,
            height: vid.height,
            tags: vid.tags,
          });
        }
      } else {
        // Image / Vector / Illustration
        const imageType =
          input.mediaType === "vector"
            ? "vector"
            : input.mediaType === "illustration"
            ? "illustration"
            : input.mediaType === "photo"
            ? "photo"
            : "all";

        const res = await PixabayClient.searchImages({
          query: input.query,
          imageType,
          orientation: pixabayOrientation,
          perPage: input.maxResults || 3,
          log: context.log,
        });

        for (const img of res.images.slice(0, input.maxResults || 3)) {
          const ext = img.type === "vector" ? "png" : "jpg";
          const localPath = path.join(cacheDir, `${img.id}.${ext}`);
          const downloaded = await PixabayClient.downloadAsset(img.downloadUrl, localPath, context.log);

          items.push({
            id: img.id,
            type: img.type,
            title: img.title,
            downloadUrl: img.downloadUrl,
            localCachedPath: downloaded,
            width: img.width,
            height: img.height,
            tags: img.tags,
          });
        }
      }

      context.log?.(`[PixabayMediaTool] Successfully retrieved and cached ${items.length} ${input.mediaType} asset(s) from Pixabay.`);
    } catch (err: any) {
      context.log?.(`[PixabayMediaTool] Error sourcing Pixabay assets: ${err?.message}`);
    }

    context.artifacts.set(`sourced_pixabay_${input.mediaType}`, items);
    return {
      items,
      totalFound: items.length,
    };
  }
}
