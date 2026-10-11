import { z } from "zod";
import * as path from "path";
import * as fs from "fs";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import { PexelsClient } from "./pexels-client";
import { PixabayClient } from "./pixabay-client";
import { StockDecisionBroker } from "./stock-decision-broker";

export interface SourcedBrollClip {
  clipId: string;
  query: string;
  title: string;
  localCachedVideoPath: string;
  downloadUrl: string;
  thumbnailUrl: string;
  durationSec: number;
  width: number;
  height: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  photographer: string;
  license: string;
}

export const BrollSearchInputSchema = z.object({
  queries: z.array(z.string()).optional(),
  targetAspect: z.enum(["16:9", "9:16", "1:1"]).optional(),
  maxClips: z.number().optional(),
  minDurationSec: z.number().optional(),
});

export type BrollSearchInput = z.infer<typeof BrollSearchInputSchema>;

export interface BrollSearchOutput {
  sourcedClips: SourcedBrollClip[];
  totalClipsSourced: number;
}

export class BrollSearchTool extends VideoDirectorTool<BrollSearchInput, BrollSearchOutput> {
  readonly name = "broll_search";
  readonly description = "Autonomously searches, downloads, and caches high-definition B-roll stock video footage (16:9 or 9:16 vertical) from the Pexels library for timeline cutaways.";
  readonly stage = "TIMELINE_COMPOSITION" as const;
  readonly inputSchema = BrollSearchInputSchema;

  async execute(input: BrollSearchInput, context: DirectorExecutionContext): Promise<BrollSearchOutput> {
    context.log?.("[BrollSearchTool] Sourcing contextual B-roll video footage from Pexels API...");

    const brollCacheDir = path.join(context.tempDir, "broll");
    if (!fs.existsSync(brollCacheDir)) {
      fs.mkdirSync(brollCacheDir, { recursive: true });
    }

    // Determine target aspect orientation
    const targetAspect = input.targetAspect || "16:9";
    const orientation: "landscape" | "portrait" | "square" =
      targetAspect === "9:16" ? "portrait" : targetAspect === "1:1" ? "square" : "landscape";

    // Gather queries from input, or extract from visual cues / context artifacts
    let searchQueries: string[] = input.queries || [];
    if (searchQueries.length === 0) {
      const cues: any[] = context.artifacts.get("extracted_visual_cues") || [];
      searchQueries = cues.map((c) => c.assetQuery || c.topic || c.label).filter(Boolean);
    }

    if (searchQueries.length === 0) {
      // Fallback topics from style or mood if any
      const mood = context.artifacts.get("classified_mood");
      if (mood?.keywords?.length) {
        searchQueries = mood.keywords.slice(0, 3);
      } else {
        searchQueries = ["abstract technology", "city life", "business workflow"];
      }
    }

    const maxClips = input.maxClips || 3;
    const minDurationSec = input.minDurationSec || 2.0;
    const sourcedClips: SourcedBrollClip[] = [];

    // Query Multi-Stock Broker for each topic (Pexels + Pixabay)
    for (let i = 0; i < searchQueries.length && sourcedClips.length < maxClips; i++) {
      const q = searchQueries[i].replace(/[_-]+/g, " ").trim();
      if (!q) continue;

      context.log?.(`[BrollSearchTool] Multi-Stock routing query for: "${q}" (${orientation})...`);

      try {
        const brokerResult = await StockDecisionBroker.search({
          prompt: q,
          targetAspect: input.targetAspect || "16:9",
          maxItems: 3,
          log: context.log,
        });

        const validVideos = brokerResult.items.filter(
          (item) => item.type === "video" && (item.durationSec || 5) >= minDurationSec
        );

        if (validVideos.length > 0) {
          const winner = validVideos[0];
          const sanitizedTitle = winner.title.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 30);
          const clipId = `broll_${winner.provider}_${winner.id}_${i + 1}`;
          const localVideoPath = path.join(brollCacheDir, `${clipId}_${sanitizedTitle}.mp4`);

          context.log?.(`[BrollSearchTool] Ingesting ${winner.provider.toUpperCase()} asset: "${winner.title}"...`);

          let isDownloaded = false;
          if (winner.provider === "pixabay") {
            const downloaded = await PixabayClient.downloadAsset(winner.downloadUrl, localVideoPath, context.log);
            isDownloaded = Boolean(downloaded);
          } else {
            isDownloaded = await PexelsClient.downloadAsset(winner.downloadUrl, localVideoPath);
          }

          if (isDownloaded && fs.existsSync(localVideoPath) && fs.statSync(localVideoPath).size > 1024) {
            sourcedClips.push({
              clipId,
              query: q,
              title: winner.title,
              localCachedVideoPath: localVideoPath,
              downloadUrl: winner.downloadUrl,
              thumbnailUrl: winner.thumbnailUrl,
              durationSec: winner.durationSec || 10,
              width: winner.width || (targetAspect === "9:16" ? 1080 : 1920),
              height: winner.height || (targetAspect === "9:16" ? 1920 : 1080),
              aspectRatio: winner.aspectRatio,
              photographer: winner.sourceAttribution,
              license: winner.license || "Royalty-Free Open Commercial",
            });
            context.log?.(`[BrollSearchTool] Successfully cached ${winner.provider} B-roll: ${localVideoPath} (${(fs.statSync(localVideoPath).size / 1024 / 1024).toFixed(1)} MB)`);
          }
        } else {
          context.log?.(`[BrollSearchTool] No matching stock clips found for: "${q}" across Pexels and Pixabay.`);
        }
      } catch (err: any) {
        context.log?.(`[BrollSearchTool] Search error for "${q}": ${err?.message}`);
      }
    }

    context.artifacts.set("sourced_broll_clips", sourcedClips);
    context.log?.(`[BrollSearchTool] Complete. Sourced ${sourcedClips.length} Multi-Stock B-roll clips for AI Director.`);

    return {
      sourcedClips,
      totalClipsSourced: sourcedClips.length,
    };
  }
}
