import { z } from "zod";
import * as path from "path";
import * as fs from "fs";
import axios from "axios";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";

export interface SourcedSoundEffect {
  id: string;
  name: string;
  downloadUrl: string;
  localCachedPath: string;
  durationSec: number;
}

export const FreesoundSfxInputSchema = z.object({
  query: z.string(),
  maxResults: z.number().optional().default(2),
});

export type FreesoundSfxInput = z.infer<typeof FreesoundSfxInputSchema>;

export interface FreesoundSfxOutput {
  effects: SourcedSoundEffect[];
  totalFound: number;
}

export class FreesoundSfxTool extends VideoDirectorTool<FreesoundSfxInput, FreesoundSfxOutput> {
  readonly name = "freesound_search";
  readonly description = "Searches and caches authentic acoustic sound effects from Freesound.org with algorithmic procedural synthesis fallback.";
  readonly stage = "TIMELINE_COMPOSITION" as const;
  readonly inputSchema = FreesoundSfxInputSchema;

  private static getApiKey(): string | undefined {
    return process.env.FREESOUND_API_KEY;
  }

  async execute(input: FreesoundSfxInput, context: DirectorExecutionContext): Promise<FreesoundSfxOutput> {
    context.log?.(`[FreesoundSfxTool] Sourcing acoustic sound effect: "${input.query}"...`);

    const sfxDir = path.join(context.tempDir, "freesound");
    if (!fs.existsSync(sfxDir)) {
      fs.mkdirSync(sfxDir, { recursive: true });
    }

    const apiKey = FreesoundSfxTool.getApiKey();
    const effects: SourcedSoundEffect[] = [];

    if (apiKey) {
      try {
        const searchUrl = `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(input.query)}&token=${apiKey}&fields=id,name,previews,duration&page_size=${input.maxResults || 2}`;
        const res = await axios.get(searchUrl, { timeout: 10000 });
        const results: any[] = res.data?.results || [];

        for (const r of results) {
          const previewUrl = r.previews?.["preview-hq-mp3"] || r.previews?.["preview-lq-mp3"];
          if (previewUrl) {
            const sfxId = `freesound_${r.id}`;
            const targetPath = path.join(sfxDir, `${sfxId}.mp3`);

            try {
              const fileRes = await axios.get(previewUrl, { responseType: "arraybuffer", timeout: 10000 });
              fs.writeFileSync(targetPath, Buffer.from(fileRes.data));
              effects.push({
                id: sfxId,
                name: r.name,
                downloadUrl: previewUrl,
                localCachedPath: targetPath,
                durationSec: r.duration || 1.0,
              });
            } catch {}
          }
        }
        context.log?.(`[FreesoundSfxTool] Successfully retrieved ${effects.length} sound effect(s) from Freesound.`);
      } catch (err: any) {
        context.log?.(`[FreesoundSfxTool] API notice: ${err?.message}`);
      }
    }

    // High-fidelity fallback synthesis if API returns empty
    if (effects.length === 0) {
      const fallbackId = `sfx_synth_${input.query.replace(/[^a-z0-9]/gi, "_")}`;
      const fallbackPath = path.join(sfxDir, `${fallbackId}.wav`);
      this.synthesizeWhooshSfx(fallbackPath);
      effects.push({
        id: fallbackId,
        name: `Synthesized ${input.query}`,
        downloadUrl: "local://sfx/synth",
        localCachedPath: fallbackPath,
        durationSec: 0.35,
      });
      context.log?.(`[FreesoundSfxTool] Generated synthesized tactile sound effect: ${fallbackPath}`);
    }

    context.artifacts.set("sourced_freesound_effects", effects);
    return {
      effects,
      totalFound: effects.length,
    };
  }

  private synthesizeWhooshSfx(filePath: string): void {
    const sampleRate = 48000;
    const duration = 0.35;
    const numSamples = Math.floor(sampleRate * duration);
    const pcmData = Buffer.alloc(numSamples * 2);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const progress = t / duration;
      // Exponential sweep noise
      const freq = 150 + Math.sin(progress * Math.PI) * 800;
      const amp = Math.sin(progress * Math.PI) * 0.4;
      const sample = Math.sin(2 * Math.PI * freq * t) * amp;
      pcmData.writeInt16LE(Math.floor(sample * 32767), i * 2);
    }

    const wavHeader = Buffer.alloc(44);
    wavHeader.write("RIFF", 0);
    wavHeader.writeUInt32LE(36 + pcmData.length, 4);
    wavHeader.write("WAVE", 8);
    wavHeader.write("fmt ", 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(1, 22);
    wavHeader.writeUInt32LE(sampleRate, 24);
    wavHeader.writeUInt32LE(sampleRate * 2, 28);
    wavHeader.writeUInt16LE(2, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write("data", 36);
    wavHeader.writeUInt32LE(pcmData.length, 40);

    fs.writeFileSync(filePath, Buffer.concat([wavHeader, pcmData]));
  }
}
