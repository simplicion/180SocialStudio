import { z } from "zod";

export const MemoryCategorySchema = z.enum([
  "STYLE",
  "PACING",
  "AUDIO_MIXING",
  "ASSET_PREFERENCE",
  "BRAND_RULE",
  "CRITIC_LEARNING",
]);

export type MemoryCategory = z.infer<typeof MemoryCategorySchema>;

export const MemoryScopeSchema = z.enum(["GLOBAL", "COMPANY", "USER"]);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const DirectorMemoryItemSchema = z.object({
  id: z.string(),
  scope: MemoryScopeSchema.default("GLOBAL"),
  companyId: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
  category: MemoryCategorySchema,
  key: z.string(),
  value: z.any(),
  confidence: z.number().min(0).max(1).default(1.0),
  occurrenceCount: z.number().int().min(1).default(1),
  lastAccessedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DirectorMemoryItem = z.infer<typeof DirectorMemoryItemSchema>;

export const MemoryOperationActionSchema = z.enum(["ADD", "UPDATE", "DELETE", "NONE"]);
export type MemoryOperationAction = z.infer<typeof MemoryOperationActionSchema>;

export const MemoryOperationSchema = z.object({
  action: MemoryOperationActionSchema,
  existingMemoryId: z.string().optional(),
  scope: MemoryScopeSchema.optional().default("GLOBAL"),
  category: MemoryCategorySchema,
  key: z.string(),
  value: z.any(),
  reason: z.string(),
});

export type MemoryOperation = z.infer<typeof MemoryOperationSchema>;

export const UserEditingProfileSchema = z.object({
  userId: z.string().optional(),
  companyId: z.string().optional(),
  scope: MemoryScopeSchema.optional(),
  captionStyle: z
    .object({
      preset: z.string().optional(),
      primaryColor: z.string().optional(),
      highlightColor: z.string().optional(),
      fontSize: z.number().optional(),
      positionYPercent: z.number().optional(),
    })
    .optional(),
  audioPreference: z
    .object({
      bgmGenre: z.string().optional(),
      bgmVolumeDb: z.number().optional(),
      duckAmountDb: z.number().optional(),
      enableSfx: z.boolean().optional(),
    })
    .optional(),
  pacingPreference: z
    .object({
      targetAspect: z.enum(["16:9", "9:16", "1:1"]).optional(),
      cutFrequencySec: z.number().optional(),
      zoomScale: z.number().optional(),
      zoomFrequencySec: z.number().optional(),
    })
    .optional(),
  brandRules: z
    .array(
      z.object({
        ruleId: z.string(),
        directive: z.string(),
        requiredBadgeUrl: z.string().optional(),
      })
    )
    .optional(),
});

export type UserEditingProfile = z.infer<typeof UserEditingProfileSchema>;
