import * as path from "path";
import * as fs from "fs";

export interface StockImageCandidate {
  title: string;
  url: string;
  width: number;
  height: number;
  score: number;
  source: string;
  displayTag: string;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export class OpenWorldStockCrawler {
  private static readonly USER_AGENT = "180MediaStudio/1.0 (Autonomous AI Director; platform@180workspace.com)";

  /**
   * Autonomous Open-World Media Crawler:
   * Searches Wikimedia Commons, open stock archives, and free photographic repositories
   * for authentic, real-world photography and medical/scientific illustrations.
   */
  static async searchAndRank(
    query: string,
    category: string = "ANATOMICAL_DIAGRAM",
    log?: (msg: string) => void
  ): Promise<StockImageCandidate | null> {
    log?.(`[OpenWorldStockCrawler] Crawling open web & stock archives for: "${query}" (${category})...`);

    const cleanBase = query.replace(/[_-]+/g, " ").trim();
    const searchTerms = [
      cleanBase,
      `${cleanBase} diagram`,
      `${cleanBase} anatomy`,
      `${cleanBase} 3D medical`,
    ];

    const candidates: StockImageCandidate[] = [];

    // Search Wikimedia Commons with File namespace (ns=6)
    for (const term of searchTerms) {
      try {
        const cleanTerm = encodeURIComponent(term);
        const searchApi = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch=${cleanTerm}&srlimit=6&format=json`;
        const res = await fetch(searchApi, { headers: { "User-Agent": this.USER_AGENT } });
        if (!res.ok) continue;

        const data: any = await res.json();
        const searchHits = data.query?.search || [];
        if (searchHits.length === 0) continue;

        const titles = searchHits.map((h: any) => h.title).join("|");
        const infoApi = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url|size|mime&format=json`;
        const infoRes = await fetch(infoApi, { headers: { "User-Agent": this.USER_AGENT } });
        if (!infoRes.ok) continue;

        const infoData: any = await infoRes.json();
        const pages = infoData.query?.pages || {};

        for (const pId of Object.keys(pages)) {
          const page = pages[pId];
          const info = page.imageinfo?.[0];
          if (!info || !info.url) continue;

          // Exclude non-raster formats (svg, tif, ogg, etc.) and low-res thumbnails
          const mime = (info.mime || "").toLowerCase();
          if (!mime.includes("jpeg") && !mime.includes("png") && !mime.includes("webp")) continue;
          if (info.width < 450 || info.height < 450) continue;

          // Semantic Scoring Gate
          let score = 10;
          const lowerTitle = page.title.toLowerCase();
          const queryTokens = cleanBase.toLowerCase().split(/\s+/);
          for (const token of queryTokens) {
            if (token.length > 2 && lowerTitle.includes(token)) {
              score += 20;
            }
          }
          if (lowerTitle.includes("3d")) score += 15;
          if (lowerTitle.includes("diagram") || lowerTitle.includes("illustration")) score += 10;
          if (lowerTitle.includes("anatomy") || lowerTitle.includes("nerve") || lowerTitle.includes("spine")) score += 10;
          if (info.width >= 1080) score += 10;

          // Format clean display tag for the broadcast pill
          const displayTag = cleanBase
            .replace(/3d/gi, "")
            .replace(/diagram/gi, "")
            .trim()
            .toUpperCase();

          candidates.push({
            title: page.title.replace(/^File:/, "").replace(/\.[^/.]+$/, ""),
            url: info.url,
            width: info.width,
            height: info.height,
            score,
            source: "Wikimedia Commons",
            displayTag: displayTag || "ANATOMICAL DETAIL",
          });
        }

        if (candidates.length >= 3) break;
      } catch (err: any) {
        log?.(`[OpenWorldStockCrawler] Search error for "${term}": ${err.message}`);
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => b.score - a.score);
    const winner = candidates[0];
    log?.(`[OpenWorldStockCrawler] Identified highest-relevance asset: "${winner.title}" (Score: ${winner.score}, ${winner.width}x${winner.height})`);
    return winner;
  }

  /**
   * Downloads open-world image candidate and formats it with sharp:
   * - Crops to 1:1 square
   * - Rounded corners (rx=28)
   * - Cyber cyan / slate glassmorphic border
   * - Broadcast title pill tag
   */
  static async downloadAndFormatCard(
    candidate: StockImageCandidate,
    destPngPath: string,
    displayTag?: string
  ): Promise<boolean> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sharp = require("sharp");

      const res = await fetch(candidate.url, { headers: { "User-Agent": this.USER_AGENT } });
      if (!res.ok) return false;

      const arrayBuf = await res.arrayBuffer();
      const rawBuf = Buffer.from(arrayBuf);

      const size = 512;
      const radius = 28;
      const tagText = (displayTag || candidate.displayTag || "ANATOMICAL DETAIL").toUpperCase();

      const maskSvg = Buffer.from(`
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#FFFFFF" />
        </svg>
      `);

      const borderSvg = Buffer.from(`
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <rect x="2" y="2" width="${size - 4}" height="${size - 4}" rx="${radius}" ry="${radius}" fill="none" stroke="#38BDF8" stroke-width="4" stroke-opacity="0.85" />
          <rect x="16" y="${size - 52}" width="${size - 32}" height="36" rx="10" fill="#0F172A" fill-opacity="0.85" stroke="#38BDF8" stroke-width="1.5" stroke-opacity="0.5"/>
          <text x="${size / 2}" y="${size - 28}" text-anchor="middle" fill="#38BDF8" font-family="Arial, sans-serif" font-weight="bold" font-size="15" letter-spacing="1">${escapeXml(tagText)}</text>
        </svg>
      `);

      const resized = await sharp(rawBuf)
        .resize(size, size, { fit: "cover" })
        .toBuffer();

      const masked = await sharp(resized)
        .composite([{ input: maskSvg, blend: "dest-in" }])
        .png()
        .toBuffer();

      await sharp(masked)
        .composite([{ input: borderSvg, blend: "over" }])
        .png()
        .toFile(destPngPath);

      return true;
    } catch (err: any) {
      console.error(`[OpenWorldStockCrawler] Error formatting card:`, err.message);
      return false;
    }
  }
}
