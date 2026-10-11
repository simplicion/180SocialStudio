import { z } from "zod";
import * as path from "path";
import * as fs from "fs";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";

export interface SourcedSfxTrack {
  id: string;
  type: "POP" | "WHOOSH" | "DING" | "ALERT" | "CHIME";
  filePath: string;
  durationMs: number;
}

export const SfxSearchInputSchema = z.object({}).passthrough();
export type SfxSearchInput = z.infer<typeof SfxSearchInputSchema>;

export interface SfxSearchOutput {
  catalog: Record<string, SourcedSfxTrack>;
}

export class SfxSearchTool extends VideoDirectorTool<SfxSearchInput, SfxSearchOutput> {
  readonly name = "sfx_search";
  readonly description = "Synthesizes and caches broadcast-grade acoustic sound effects (pops, whooshes, dings, warning alerts, chimes) for tactile motion feedback.";
  readonly stage = "TIMELINE_COMPOSITION" as const;
  readonly inputSchema = SfxSearchInputSchema;

  async execute(_input: SfxSearchInput, context: DirectorExecutionContext): Promise<SfxSearchOutput> {
    context.log?.("[SfxSearchTool] Preparing acoustic sound effect library...");

    const sfxDir = path.join(context.tempDir, "sfx");
    if (!fs.existsSync(sfxDir)) {
      fs.mkdirSync(sfxDir, { recursive: true });
    }

    const catalog: Record<string, SourcedSfxTrack> = {};
    const sfxTypes: Array<"POP" | "WHOOSH" | "DING" | "ALERT" | "CHIME"> = [
      "POP",
      "WHOOSH",
      "DING",
      "ALERT",
      "CHIME",
    ];

    for (const type of sfxTypes) {
      const fileName = `sfx_${type.toLowerCase()}.wav`;
      const filePath = path.join(sfxDir, fileName);

      if (!fs.existsSync(filePath)) {
        const pcmBuffer = this.synthesizeSfxBuffer(type);
        const wavHeader = this.createWavHeader(pcmBuffer.length, 48000, 2, 16);
        fs.writeFileSync(filePath, Buffer.concat([wavHeader, pcmBuffer]));
      }

      catalog[type] = {
        id: `sfx_${type.toLowerCase()}`,
        type,
        filePath,
        durationMs: type === "CHIME" ? 800 : type === "DING" ? 600 : type === "WHOOSH" ? 350 : 150,
      };
    }

    const output: SfxSearchOutput = { catalog };
    context.artifacts.set("sfx_catalog", catalog);
    context.log?.(`[SfxSearchTool] Initialized ${Object.keys(catalog).length} broadcast SFX profiles.`);
    return output;
  }

  /**
   * Generates mathematical 48kHz stereo 16-bit PCM audio samples
   */
  private synthesizeSfxBuffer(type: "POP" | "WHOOSH" | "DING" | "ALERT" | "CHIME"): Buffer {
    const sampleRate = 48000;
    const durationSec = type === "CHIME" ? 0.8 : type === "DING" ? 0.6 : type === "WHOOSH" ? 0.35 : 0.15;
    const totalSamples = Math.floor(sampleRate * durationSec);
    const buffer = Buffer.alloc(totalSamples * 4); // 2 channels * 2 bytes per sample

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let sample = 0;

      if (type === "POP") {
        // Fast pitch drop 700Hz -> 100Hz with exponential decay
        const freq = 100 + 600 * Math.exp(-t * 35);
        const env = Math.exp(-t * 28);
        sample = Math.sin(2 * Math.PI * freq * t) * env * 0.85;
      } else if (type === "WHOOSH") {
        // Filtered white noise with parabolic envelope
        const noise = Math.random() * 2 - 1;
        const env = 4 * (t / durationSec) * (1 - t / durationSec);
        sample = noise * env * 0.45;
      } else if (type === "DING") {
        // High harmonic bell 1760Hz + 3520Hz
        const env = Math.exp(-t * 6);
        sample = (Math.sin(2 * Math.PI * 1760 * t) * 0.7 + Math.sin(2 * Math.PI * 3520 * t) * 0.3) * env * 0.6;
      } else if (type === "ALERT") {
        // Two-tone caution ping
        const freq = t < 0.1 ? 880 : 660;
        const env = Math.exp(-(t % 0.1) * 15);
        sample = Math.sin(2 * Math.PI * freq * t) * env * 0.75;
      } else if (type === "CHIME") {
        // Major chord (C5 + E5 + G5)
        const env = Math.exp(-t * 4);
        sample =
          (Math.sin(2 * Math.PI * 523.25 * t) * 0.4 +
            Math.sin(2 * Math.PI * 659.25 * t) * 0.3 +
            Math.sin(2 * Math.PI * 783.99 * t) * 0.3) *
          env *
          0.6;
      }

      const int16 = Math.max(-32767, Math.min(32767, Math.floor(sample * 32767)));
      buffer.writeInt16LE(int16, i * 4);
      buffer.writeInt16LE(int16, i * 4 + 2);
    }

    return buffer;
  }

  /**
   * Constructs canonical 44-byte RIFF WAV Header
   */
  private createWavHeader(dataLength: number, sampleRate: number, numChannels: number, bitsPerSample: number): Buffer {
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE((sampleRate * numChannels * bitsPerSample) / 8, 28);
    header.writeUInt16LE((numChannels * bitsPerSample) / 8, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataLength, 40);
    return header;
  }
}
