import { z } from "zod";
import * as path from "path";
import * as fs from "fs";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";

export const GenerativeMotionTypeSchema = z.enum([
  "NUMERIC_COUNTER",
  "EVOLVED_PATH",
  "NEON_BORDER",
  "SPLIT_SCREEN_CARD",
]);

export type GenerativeMotionType = z.infer<typeof GenerativeMotionTypeSchema>;

export const GenerativeMotionInputSchema = z.object({
  type: GenerativeMotionTypeSchema.default("NUMERIC_COUNTER"),
  targetValue: z.number().optional().default(100),
  label: z.string().optional().default("METRIC"),
  unit: z.string().optional().default(""),
  themeColor: z.string().optional().default("#FFE600"),
  durationSec: z.number().optional().default(3.5),
  timestampSec: z.number().optional().default(2.0),
});

export type GenerativeMotionInput = z.infer<typeof GenerativeMotionInputSchema>;

export interface GenerativeMotionOutput {
  componentId: string;
  type: GenerativeMotionType;
  localCachedPngPath: string;
  timestampSec: number;
  durationSec: number;
  position: "CENTER" | "UPPER_RIGHT" | "LOWER_THIRD";
}

export class GenerativeMotionTool extends VideoDirectorTool<GenerativeMotionInput, GenerativeMotionOutput> {
  readonly name = "generative_motion_graphic";
  readonly description = "Synthesizes code-driven dynamic motion graphic cards, numeric counters, and glowing borders.";
  readonly stage = "TIMELINE_COMPOSITION" as const;
  readonly inputSchema = GenerativeMotionInputSchema;

  async execute(input: GenerativeMotionInput, context: DirectorExecutionContext): Promise<GenerativeMotionOutput> {
    context.log?.(`[GenerativeMotionTool] Synthesizing ${input.type} component ("${input.label}")...`);

    const assetsDir = path.join(context.tempDir, "motion_components");
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }

    const componentId = `gen_motion_${input.type.toLowerCase()}_${Date.now()}`;
    const pngPath = path.join(assetsDir, `${componentId}.png`);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp = require("sharp");
    const color = input.themeColor || "#FFE600";

    let svg = "";

    if (input.type === "NUMERIC_COUNTER") {
      // Dynamic metric counter card (e.g. Earth to Moon 384,400 KM, $10,000, 99%)
      const valStr = (input.targetValue || 100).toLocaleString();
      svg = `
        <svg width="640" height="360" viewBox="0 0 640 360" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="cardGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="12" result="blur"/>
              <feComposite in="SourceGraphic" in2="blur" operator="over"/>
            </filter>
          </defs>
          <rect x="20" y="20" width="600" height="320" rx="36" fill="#0F172A" fill-opacity="0.94" stroke="${color}" stroke-width="6" filter="url(#cardGlow)"/>
          <rect x="220" y="45" width="200" height="40" rx="20" fill="${color}" fill-opacity="0.2"/>
          <text x="320" y="72" text-anchor="middle" fill="${color}" font-family="Arial, sans-serif" font-weight="900" font-size="20" letter-spacing="2">${input.label.toUpperCase()}</text>
          <text x="320" y="210" text-anchor="middle" fill="#FFFFFF" font-family="Arial, sans-serif" font-weight="900" font-size="82">${valStr}</text>
          ${input.unit ? `<text x="320" y="275" text-anchor="middle" fill="${color}" font-family="Arial, sans-serif" font-weight="bold" font-size="28">${input.unit.toUpperCase()}</text>` : ""}
        </svg>
      `;
    } else if (input.type === "NEON_BORDER") {
      // Dynamic neon animated rounded frame
      svg = `
        <svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="neon" x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="16" result="blur"/>
              <feComposite in="SourceGraphic" in2="blur" operator="over"/>
            </filter>
          </defs>
          <rect x="36" y="36" width="1008" height="1848" rx="64" fill="none" stroke="${color}" stroke-width="12" filter="url(#neon)"/>
          <rect x="36" y="36" width="1008" height="1848" rx="64" fill="none" stroke="#FFFFFF" stroke-width="4"/>
        </svg>
      `;
    } else {
      // Split Screen Metric Card / Evolved Path Card
      svg = `
        <svg width="600" height="400" viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg">
          <rect x="20" y="20" width="560" height="360" rx="32" fill="#020617" fill-opacity="0.92" stroke="${color}" stroke-width="6"/>
          <circle cx="160" cy="180" r="70" fill="#1E293B" stroke="#38BDF8" stroke-width="4"/>
          <text x="160" y="205" text-anchor="middle" font-size="70">🌍</text>
          <path d="M 240 180 L 360 180" stroke="${color}" stroke-width="8" stroke-dasharray="12,12"/>
          <circle cx="440" cy="180" r="55" fill="#1E293B" stroke="#E2E8F0" stroke-width="4"/>
          <text x="440" y="200" text-anchor="middle" font-size="55">🌕</text>
          <text x="300" y="320" text-anchor="middle" fill="${color}" font-family="Arial, sans-serif" font-weight="900" font-size="28">${input.label}</text>
        </svg>
      `;
    }

    await sharp(Buffer.from(svg.trim()))
      .resize(input.type === "NEON_BORDER" ? 1080 : 640, input.type === "NEON_BORDER" ? 1920 : 360, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(pngPath);

    const output: GenerativeMotionOutput = {
      componentId,
      type: input.type,
      localCachedPngPath: pngPath,
      timestampSec: input.timestampSec || 2.0,
      durationSec: input.durationSec || 3.5,
      position: input.type === "NEON_BORDER" ? "CENTER" : "UPPER_RIGHT",
    };

    context.artifacts.set(componentId, output);
    return output;
  }
}
