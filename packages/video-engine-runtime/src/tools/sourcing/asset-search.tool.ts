import { z } from "zod";
import * as path from "path";
import * as fs from "fs";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import { VisualCueTarget } from "../analysis/mood-classifier.tool";
import { OpenWorldStockCrawler } from "./open-world-stock-crawler";
import { PexelsClient } from "./pexels-client";
import { PixabayClient } from "./pixabay-client";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface SourcedVisualAsset {
  cueId: string;
  assetId: string;
  query: string;
  category: string;
  localCachedPngPath: string;
  width: number;
  height: number;
  hasAlphaTransparency: boolean;
  timestampSec: number;
  durationSec: number;
  position: "UPPER_RIGHT" | "UPPER_LEFT" | "CENTER_RIGHT" | "LOWER_THIRD";
  sfxType: "POP" | "WHOOSH" | "DING" | "ALERT" | "CHIME";
}

export const AssetSearchInputSchema = z.object({
  cues: z.array(z.any()).optional(),
});

export type AssetSearchInput = z.infer<typeof AssetSearchInputSchema>;

export interface AssetSearchOutput {
  sourcedAssets: SourcedVisualAsset[];
}

export class AssetSearchTool extends VideoDirectorTool<AssetSearchInput, AssetSearchOutput> {
  readonly name = "asset_search";
  readonly description = "Searches, downloads, and renders transparent vector illustrations, medical diagrams, 3D emojis, and warning badges from the web and procedural vector engines.";
  readonly stage = "TIMELINE_COMPOSITION" as const;
  readonly inputSchema = AssetSearchInputSchema;

  /**
   * Broadcast-grade Procedural Vector Asset Definitions (purged of crude cartoons)
   */
  private static readonly VECTOR_GRAPHICS_LIBRARY: Record<string, string> = {};

  async execute(input: AssetSearchInput, context: DirectorExecutionContext): Promise<AssetSearchOutput> {
    context.log?.("[AssetSearchTool] Sourcing visual assets matching mood and cue anchors...");

    const assetCacheDir = path.join(context.tempDir, "assets");
    if (!fs.existsSync(assetCacheDir)) {
      fs.mkdirSync(assetCacheDir, { recursive: true });
    }

    const cues: VisualCueTarget[] = input.cues || context.artifacts.get("extracted_visual_cues") || [];
    const sourcedAssets: SourcedVisualAsset[] = [];

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp = require("sharp");

    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const assetId = `asset_${cue.assetQuery}_${i + 1}`;
      const pngPath = path.join(assetCacheDir, `${assetId}.png`);

      context.log?.(`[AssetSearchTool] Resolving asset for query: "${cue.assetQuery}" (${cue.category})...`);

      let resolved = false;

      // Tier 0: Pixabay Vector Graphics & Diagram Search (Exclusive Vector/Illustration Catalog)
      const isVectorIntent = cue.category === "ANATOMICAL_DIAGRAM" || cue.category === "ICON_VECTOR" || /vector|illustration|icon|diagram|graphic/i.test(cue.assetQuery);
      if (isVectorIntent) {
        try {
          const cleanQuery = cue.assetQuery.replace(/[_-]+/g, " ");
          const pixabayRes = await PixabayClient.searchImages({
            query: cleanQuery,
            imageType: "vector",
            perPage: 3,
            log: context.log,
          });

          if (pixabayRes.images.length > 0) {
            const winner = pixabayRes.images[0];
            const displayTag = cleanQuery.toUpperCase();
            const formatted = await OpenWorldStockCrawler.downloadAndFormatCard(
              {
                title: winner.title,
                url: winner.downloadUrl,
                width: winner.width,
                height: winner.height,
                score: 99,
                source: "Pixabay (Vector Commercial Royalty-Free)",
                displayTag,
              },
              pngPath,
              displayTag
            );
            if (formatted) {
              resolved = true;
              context.log?.(`[AssetSearchTool] Sourced and formatted Pixabay vector illustration: "${winner.title}" by ${winner.user}`);
            }
          }
        } catch (err: any) {
          context.log?.(`[AssetSearchTool] Pixabay vector search notice: ${err?.message}`);
        }
      }

      // Tier 0B: Autonomous Pexels / Pixabay High-Resolution Stock Photo Catalog
      if (!resolved) {
        try {
          const cleanQuery = cue.assetQuery.replace(/[_-]+/g, " ");
          const pexelsRes = await PexelsClient.searchPhotos({
            query: cleanQuery,
            perPage: 3,
            log: context.log,
          });

          let winner: any = pexelsRes.photos.length > 0 ? pexelsRes.photos[0] : null;
          let sourceName = "Pexels (Commercial Royalty-Free)";

          // If Pexels has no hits, try Pixabay photos
          if (!winner) {
            const pixabayPhotos = await PixabayClient.searchImages({
              query: cleanQuery,
              imageType: "photo",
              perPage: 3,
              log: context.log,
            });
            if (pixabayPhotos.images.length > 0) {
              winner = pixabayPhotos.images[0];
              sourceName = "Pixabay (Commercial Royalty-Free)";
            }
          }

          if (winner) {
            const displayTag = cleanQuery.toUpperCase();
            const formatted = await OpenWorldStockCrawler.downloadAndFormatCard(
              {
                title: winner.title,
                url: winner.downloadUrl,
                width: winner.width,
                height: winner.height,
                score: 98,
                source: sourceName,
                displayTag,
              },
              pngPath,
              displayTag
            );
            if (formatted) {
              resolved = true;
              context.log?.(`[AssetSearchTool] Sourced and formatted stock photo: "${winner.title}" from ${sourceName}`);
            }
          }
        } catch (err: any) {
          context.log?.(`[AssetSearchTool] Stock photo search notice: ${err?.message}`);
        }
      }

      // Tier 1: Autonomous Open-World Stock & Web Media Crawler (Wikimedia Commons / Openverse / Web Stock)
      if (!resolved) {
        try {
          const candidate = await OpenWorldStockCrawler.searchAndRank(cue.assetQuery, cue.category, context.log);
          if (candidate) {
            const success = await OpenWorldStockCrawler.downloadAndFormatCard(candidate, pngPath);
            if (success) {
              resolved = true;
              context.log?.(`[AssetSearchTool] Autonomously sourced and formatted open-world asset: "${candidate.title}" from ${candidate.source}`);
            }
          }
        } catch (err: any) {
          context.log?.(`[AssetSearchTool] Open-world crawler notice: ${err?.message}`);
        }
      }

      // Tier 2: Dedicated Local High-Resolution Medical Asset Library (Offline / Fast Cache)
      if (!resolved) {
        const medicalAssetsDir = path.resolve(__dirname, "../../../assets/medical");
        const medicalMap: Record<string, { fileName: string; tag: string }> = {
          sciatica_spine_nerve_diagram: { fileName: "sciatica_spine_3d.jpg", tag: "L4-L5 SCIATIC NERVE ROOT" },
          sciatica_spine_3d: { fileName: "sciatica_spine_3d.jpg", tag: "L4-L5 SCIATIC NERVE ROOT" },
          spine: { fileName: "sciatica_spine_3d.jpg", tag: "L4-L5 SCIATIC NERVE ROOT" },
          nerve: { fileName: "sciatica_spine_3d.jpg", tag: "L4-L5 SCIATIC NERVE ROOT" },
          sciatic_nerve: { fileName: "sciatica_spine_3d.jpg", tag: "L4-L5 SCIATIC NERVE ROOT" },
          sciatica: { fileName: "sciatica_spine_3d.jpg", tag: "L4-L5 SCIATIC NERVE ROOT" },
          leg_nerve_tingling_3d: { fileName: "leg_nerve_tingling_3d.jpg", tag: "SENSORY NERVE PATHWAY" },
          sensory_nerve: { fileName: "leg_nerve_tingling_3d.jpg", tag: "SENSORY NERVE PATHWAY" },
          tingling: { fileName: "leg_nerve_tingling_3d.jpg", tag: "SENSORY NERVE PATHWAY" },
          numbness: { fileName: "leg_nerve_tingling_3d.jpg", tag: "SENSORY NERVE PATHWAY" },
          leg: { fileName: "leg_nerve_tingling_3d.jpg", tag: "SENSORY NERVE PATHWAY" },
          sciatic_pathway_3d: { fileName: "sciatic_pathway_3d.jpg", tag: "SCIATIC NERVE COMPRESSION" },
          pathway: { fileName: "sciatic_pathway_3d.jpg", tag: "SCIATIC NERVE COMPRESSION" },
        };

        const cleanQuery = cue.assetQuery.toLowerCase().replace(/_/g, "");
        const matchedKey =
          medicalMap[cue.assetQuery.toLowerCase()]
            ? cue.assetQuery.toLowerCase()
            : Object.keys(medicalMap)
                .sort((a, b) => b.length - a.length)
                .find(k => k.replace(/_/g, "") === cleanQuery || cleanQuery.includes(k.replace(/_/g, "")));
        const matchedMedical = matchedKey ? medicalMap[matchedKey] : undefined;

        if (matchedMedical && fs.existsSync(path.join(medicalAssetsDir, matchedMedical.fileName))) {
          try {
            const imgPath = path.join(medicalAssetsDir, matchedMedical.fileName);
            const size = 512;
            const radius = 28;

            const maskSvg = Buffer.from(`
              <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
                <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#FFFFFF" />
              </svg>
            `);

            const borderSvg = Buffer.from(`
              <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
                <rect x="2" y="2" width="${size - 4}" height="${size - 4}" rx="${radius}" ry="${radius}" fill="none" stroke="#38BDF8" stroke-width="4" stroke-opacity="0.85" />
                <rect x="16" y="${size - 52}" width="${size - 32}" height="36" rx="10" fill="#0F172A" fill-opacity="0.85" stroke="#38BDF8" stroke-width="1.5" stroke-opacity="0.5"/>
                <text x="${size / 2}" y="${size - 28}" text-anchor="middle" fill="#38BDF8" font-family="Arial, sans-serif" font-weight="bold" font-size="16" letter-spacing="1">${matchedMedical.tag}</text>
              </svg>
            `);

            const resized = await sharp(imgPath)
              .resize(size, size, { fit: "cover" })
              .toBuffer();

            const masked = await sharp(resized)
              .composite([{ input: maskSvg, blend: "dest-in" }])
              .png()
              .toBuffer();

            await sharp(masked)
              .composite([{ input: borderSvg, blend: "over" }])
              .png()
              .toFile(pngPath);

            resolved = true;
            context.log?.(`[AssetSearchTool] Sourced authentic 3D medical visual from local archive for "${cue.assetQuery}".`);
          } catch (err: any) {
            context.log?.(`[AssetSearchTool] Medical visual render warning: ${err?.message}`);
          }
        }
      }

      // Tier 3: Microsoft Fluent 3D Emoji / Twemoji CDN (Pandas, Dinosaurs, Fire, Money, 3D Warning, etc.)
      if (!resolved) {
        const queryLower = cue.assetQuery.toLowerCase().replace(/_/g, "");
        const fluentMap: Record<string, string> = {
          panda: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Panda/3D/panda_3d.png",
          dinosaur: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/T-rex/3D/t-rex_3d.png",
          trex: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/T-rex/3D/t-rex_3d.png",
          ant: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Ant/3D/ant_3d.png",
          fire: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Fire/3D/fire_3d.png",
          flame: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Fire/3D/fire_3d.png",
          money: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Money%20bag/3D/money_bag_3d.png",
          moneybag: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Money%20bag/3D/money_bag_3d.png",
          rocket: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Rocket/3D/rocket_3d.png",
          brain: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Brain/3D/brain_3d.png",
          warning: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Warning/3D/warning_3d.png",
          star: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Glowing%20star/3D/glowing_star_3d.png",
        };

        const cdnUrl = fluentMap[queryLower];
        if (cdnUrl) {
          try {
            const res = await fetch(cdnUrl);
            if (res.ok) {
              const arrayBuf = await res.arrayBuffer();
              const buf = Buffer.from(arrayBuf);
              await sharp(buf)
                .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toFile(pngPath);
              resolved = true;
              context.log?.(`[AssetSearchTool] Sourced 3D sticker from Fluent CDN for "${cue.assetQuery}".`);
            }
          } catch {
            // Fall through
          }
        }
      }

      // Tier 4: Iconify Universal Vector API (100,000+ vector icons with dynamic theme colors)
      if (!resolved) {
        try {
          const themeColor =
            cue.mood === "CLINICAL_AUTHORITY"
              ? "%2338BDF8"
              : cue.mood === "URGENT_WARNING"
              ? "%23EF4444"
              : cue.mood === "EXCITED_VIRAL"
              ? "%23FFE600"
              : "%2300FF88";

          const cleanQuery = cue.assetQuery.replace(/_/g, " ");
          const searchRes = await fetch(
            `https://api.iconify.design/search?query=${encodeURIComponent(cleanQuery)}&limit=5`
          );
          const searchData: any = await searchRes.json();
          if (searchData.icons && searchData.icons.length > 0) {
            const iconName = searchData.icons[0];
            const [prefix, name] = iconName.split(":");
            const svgRes = await fetch(
              `https://api.iconify.design/${prefix}/${name}.svg?color=${themeColor}`
            );
            const svgText = await svgRes.text();
            if (svgText.includes("<svg")) {
              await sharp(Buffer.from(svgText))
                .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toFile(pngPath);
              resolved = true;
              context.log?.(`[AssetSearchTool] Sourced Iconify vector "${iconName}" for "${cue.assetQuery}".`);
            }
          }
        } catch {
          // Fall through
        }
      }

      // Tier 5: Wikimedia Commons Open API (Diagrams, Medical & Educational Illustrations)
      if (!resolved && (cue.category === "ANATOMICAL_DIAGRAM" || cue.category === "CALLOUT_CARD")) {
        try {
          const wikiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
            cue.assetQuery.replace(/_/g, " ")
          )}+filetype:bitmap|drawing&gsrlimit=1&prop=imageinfo&iiprop=url|mime&format=json`;
          const wikiRes = await fetch(wikiUrl);
          const wikiData: any = await wikiRes.json();
          const pages = wikiData.query?.pages;
          if (pages) {
            const firstKey = Object.keys(pages)[0];
            const imgInfo = pages[firstKey]?.imageinfo?.[0];
            if (imgInfo?.url) {
              const imgRes = await fetch(imgInfo.url);
              if (imgRes.ok) {
                const arrayBuf = await imgRes.arrayBuffer();
                await sharp(Buffer.from(arrayBuf))
                  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
                  .png()
                  .toFile(pngPath);
                resolved = true;
                context.log?.(`[AssetSearchTool] Sourced Wikimedia Commons illustration for "${cue.assetQuery}".`);
              }
            }
          }
        } catch {
          // Fall through
        }
      }

      // Tier 6: Procedural Glass Badge Card Synthesizer
      if (!resolved) {
        const themeColor =
          cue.mood === "CLINICAL_AUTHORITY"
            ? "#38BDF8"
            : cue.mood === "URGENT_WARNING"
            ? "#EF4444"
            : cue.mood === "EXCITED_VIRAL"
            ? "#FFE600"
            : "#00FF88";

        const iconEmoji =
          cue.category === "ANATOMICAL_DIAGRAM"
            ? "🩺"
            : cue.category === "WARNING_BADGE"
            ? "⚠️"
            : cue.category === "METRIC_STAT"
            ? "📈"
            : "💡";

        const proceduralSvg = `
          <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
            <rect x="20" y="20" width="472" height="472" rx="40" fill="#0F172A" fill-opacity="0.94" stroke="${themeColor}" stroke-width="8"/>
            <text x="256" y="240" text-anchor="middle" font-size="120">${iconEmoji}</text>
            <text x="256" y="380" text-anchor="middle" fill="${themeColor}" font-family="Arial, sans-serif" font-weight="900" font-size="32" letter-spacing="1">${escapeXml(cue.assetQuery
          .replace(/_/g, " ")
          .toUpperCase())}</text>
          </svg>
        `;
        await sharp(Buffer.from(proceduralSvg.trim()))
          .png()
          .toFile(pngPath);
      }

      sourcedAssets.push({
        cueId: cue.id,
        assetId,
        query: cue.assetQuery,
        category: cue.category,
        localCachedPngPath: pngPath,
        width: 512,
        height: 512,
        hasAlphaTransparency: true,
        timestampSec: cue.timestampSec,
        durationSec: cue.durationSec,
        position: cue.position,
        sfxType: cue.sfxType,
      });

      context.onProgress?.(Math.round(((i + 1) / cues.length) * 100), `Sourced ${cue.assetQuery}`);
    }

    const output: AssetSearchOutput = { sourcedAssets };
    context.artifacts.set("sourced_visual_assets", sourcedAssets);
    context.log?.(`[AssetSearchTool] Sourced and normalized ${sourcedAssets.length} transparent visual asset(s).`);
    return output;
  }
}
