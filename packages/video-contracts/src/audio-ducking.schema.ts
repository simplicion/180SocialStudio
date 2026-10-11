import { z } from "zod";
import { RationalTimeSchema, TimeRangeSchema } from "./time";

/**
 * Audio Ducking Envelope Configuration
 */
export const AudioDuckingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  thresholdDb: z.number().default(-24.0), // Vocal threshold to trigger ducking
  duckAmountDb: z.number().default(-18.0), // How much to attenuate BGM (e.g., -18dB)
  attackMs: z.number().default(120), // Speed of ducking engagement
  releaseMs: z.number().default(350), // Speed of recovery after speech stops
  holdMs: z.number().default(100), // Hold duration before recovery starts
});

export type AudioDuckingConfig = z.infer<typeof AudioDuckingConfigSchema>;

/**
 * Audio Track Channel Mapping & Volume Control
 */
export const AudioMixerSettingsSchema = z.object({
  masterVolumeDb: z.number().default(0.0),
  dialogueGainDb: z.number().default(0.0),
  bgmGainDb: z.number().default(-6.0),
  sfxGainDb: z.number().default(0.0),
  ducking: AudioDuckingConfigSchema.default({
    enabled: true,
    thresholdDb: -24.0,
    duckAmountDb: -18.0,
    attackMs: 120,
    releaseMs: 350,
    holdMs: 100,
  }),
});

export type AudioMixerSettings = z.infer<typeof AudioMixerSettingsSchema>;
