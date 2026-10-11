import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";

export interface MotionGraphicCardParams {
  type: "STAT_CARD" | "BULLET_LIST" | "QUOTE_BANNER" | "BRAND_BADGE";
  headline: string;
  subtext?: string;
  accentColor?: string;
  outputDir: string;
}

export interface GeneratedMotionGraphic {
  filePath: string;
  width: number;
  height: number;
  recommendedPosition: { x: number; y: number };
  transition: "slide_up" | "fade" | "spring_pop";
  durationSec: number;
}

export class MotionGraphicCardGenerator {
  /**
   * Generates production-grade transparent SVG explanation cards, statistics callouts,
   * and bulleted motion graphic badges for video overlay tracks.
   */
  static generateCard(params: MotionGraphicCardParams): GeneratedMotionGraphic {
    const { type, headline, subtext, outputDir } = params;
    const accent = params.accentColor || "#38BDF8";

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const cardId = crypto.randomUUID().slice(0, 8);
    let width = 640;
    let height = 240;
    let svgContent = "";

    switch (type) {
      case "STAT_CARD":
        width = 560;
        height = 180;
        svgContent = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="4" width="${width - 8}" height="${height - 8}" rx="24" fill="#0F172A" fill-opacity="0.88" stroke="${accent}" stroke-opacity="0.4" stroke-width="2"/>
  <circle cx="56" cy="90" r="28" fill="${accent}" fill-opacity="0.15"/>
  <path d="M46 90L53 97L66 84" stroke="${accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="104" y="80" fill="#FFFFFF" font-family="Inter, -apple-system, sans-serif" font-size="34" font-weight="800">${escapeXml(headline)}</text>
  <text x="104" y="118" fill="#94A3B8" font-family="Inter, -apple-system, sans-serif" font-size="20" font-weight="500">${escapeXml(subtext || "Key Insight")}</text>
</svg>`;
        break;

      case "BULLET_LIST":
        width = 640;
        height = 260;
        svgContent = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="4" width="${width - 8}" height="${height - 8}" rx="24" fill="#0F172A" fill-opacity="0.90" stroke="#334155" stroke-width="2"/>
  <text x="36" y="52" fill="${accent}" font-family="Inter, sans-serif" font-size="22" font-weight="700" letter-spacing="0.05em">${escapeXml(headline.toUpperCase())}</text>
  <circle cx="48" cy="106" r="8" fill="${accent}"/>
  <text x="72" y="112" fill="#F8FAFC" font-family="Inter, sans-serif" font-size="20" font-weight="500">1. Problem Identification</text>
  <circle cx="48" cy="156" r="8" fill="${accent}"/>
  <text x="72" y="162" fill="#F8FAFC" font-family="Inter, sans-serif" font-size="20" font-weight="500">2. Autonomous Orchestration</text>
  <circle cx="48" cy="206" r="8" fill="${accent}"/>
  <text x="72" y="212" fill="#F8FAFC" font-family="Inter, sans-serif" font-size="20" font-weight="500">3. Production Delivery</text>
</svg>`;
        break;

      case "QUOTE_BANNER":
      default:
        width = 680;
        height = 160;
        svgContent = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="4" width="${width - 8}" height="${height - 8}" rx="20" fill="#0B0F19" fill-opacity="0.92" stroke="${accent}" stroke-width="2"/>
  <text x="36" y="70" fill="#FFFFFF" font-family="Inter, sans-serif" font-size="28" font-weight="700">"${escapeXml(headline)}"</text>
  <text x="36" y="112" fill="#94A3B8" font-family="Inter, sans-serif" font-size="18" font-weight="500">— ${escapeXml(subtext || "Key Takeaway")}</text>
</svg>`;
        break;
    }

    const filePath = path.join(outputDir, `motion_card_${type.toLowerCase()}_${cardId}.svg`);
    fs.writeFileSync(filePath, svgContent.trim());

    return {
      filePath,
      width,
      height,
      recommendedPosition: { x: 0.5, y: 0.22 }, // Upper safe zone
      transition: "spring_pop",
      durationSec: 3.5,
    };
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
