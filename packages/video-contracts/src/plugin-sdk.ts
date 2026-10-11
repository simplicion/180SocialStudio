import { z } from "zod";
import { EditIR, EditIRSchema } from "./edit-ir.schema";
import { EditCommand, EditCommandSchema } from "./commands.schema";

/**
 * ADR-011: Sandboxed Plugin & Extension SDK
 * Defines declared capabilities and secure execution interfaces for 3rd-party effects,
 * AI director custom presets, and export pipeline hooks.
 */

export const PluginCapabilitySchema = z.enum([
  "READ_TIMELINE",
  "WRITE_COMMANDS",
  "RENDER_GPU_SHADER",
  "CUSTOM_DIRECTOR_STYLE",
  "EXPORT_HOOK",
]);

export type PluginCapability = z.infer<typeof PluginCapabilitySchema>;

export const PluginManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  author: z.string(),
  description: z.string(),
  capabilities: z.array(PluginCapabilitySchema),
  entryPoint: z.string().optional(),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export const CustomEffectDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  shaderWgsl: z.string().optional(),
  shaderSource: z.string().optional(),
  uniforms: z.record(z.any()).optional(),
  parameters: z
    .record(
      z.object({
        type: z.enum(["number", "color", "boolean", "select"]),
        default: z.any(),
        min: z.number().optional(),
        max: z.number().optional(),
        options: z.array(z.string()).optional(),
      })
    )
    .optional(),
});

export const EffectNodeDefinitionSchema = CustomEffectDefinitionSchema;

export type CustomEffectDefinition = z.infer<typeof CustomEffectDefinitionSchema>;

export interface CustomDirectorStylePlugin {
  presetName: string;
  description: string;
  pacingMultiplier: number;
  zoomAggressiveness: number;
  brollFrequencySeconds: number;
  promptSystemPreamble: string;
}

export interface EditorPlugin {
  manifest: PluginManifest;
  effects?: CustomEffectDefinition[];
  directorStyles?: CustomDirectorStylePlugin[];
  onInit?: () => Promise<void>;
  onBeforeExport?: (editIR: EditIR) => Promise<EditIR>;
  onCommandDispatched?: (command: EditCommand) => Promise<void>;
}
