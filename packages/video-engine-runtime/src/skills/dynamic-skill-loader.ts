import * as fs from "fs";
import * as path from "path";
import { DirectorSkill, VisualCueRule, MoodTone } from "./base-skill";
import { ResolvedDirectorStyle } from "@workspace/video-contracts";

export interface SkillManifestYaml {
  name: string;
  genre: string;
  description: string;
  triggers?: string[];
  defaultPresetKey?: string;
  pacingMultiplier?: number;
  deadAirTrimThresholdSeconds?: number;
  zoomFrequencySeconds?: number;
  zoomScale?: number;
  captionPreset?: "HORMOZI_BOUNCE" | "ALI_ABDAAL_CLEAN" | "NEON_PUNCH" | "EDITORIAL_SUBTLE" | "MINIMAL_SERIF";
  captionColors?: {
    primary: string;
    highlight: string;
    background?: string;
  };
  safeMarginVPercent?: number;
  soundDesignEnabled?: boolean;
  duckingDb?: number;
  retentionRules?: {
    maxVisualStagnationSeconds: number;
    requireHookInFirstSeconds: number;
    targetOverlayDensityPerMinute: number;
  };
  visualCueRules?: VisualCueRule[];
}

export class DynamicSkill implements DirectorSkill {
  id: string;
  name: string;
  genre: string;
  description: string;
  triggers: string[];
  defaultPresetKey: any;

  pacingMultiplier: number;
  deadAirTrimThresholdSeconds: number;
  zoomFrequencySeconds: number;
  zoomScale: number;

  captionPreset: "HORMOZI_BOUNCE" | "ALI_ABDAAL_CLEAN" | "NEON_PUNCH" | "EDITORIAL_SUBTLE" | "MINIMAL_SERIF";
  captionColors: {
    primary: string;
    highlight: string;
    background?: string;
  };
  safeMarginVPercent: number;

  soundDesignEnabled: boolean;
  duckingDb: number;

  retentionRules: {
    maxVisualStagnationSeconds: number;
    requireHookInFirstSeconds: number;
    targetOverlayDensityPerMinute: number;
  };

  visualCueRules: VisualCueRule[];
  rawMarkdownContent?: string;

  constructor(id: string, manifest: SkillManifestYaml, rawMarkdown?: string) {
    this.id = id;
    this.name = manifest.name || id;
    this.genre = manifest.genre || "General Video Production";
    this.description = manifest.description || "";
    this.triggers = manifest.triggers || [];
    this.defaultPresetKey = manifest.defaultPresetKey || "HORMOZI_VIRAL";

    this.pacingMultiplier = manifest.pacingMultiplier ?? 1.15;
    this.deadAirTrimThresholdSeconds = manifest.deadAirTrimThresholdSeconds ?? 0.45;
    this.zoomFrequencySeconds = manifest.zoomFrequencySeconds ?? 6.0;
    this.zoomScale = manifest.zoomScale ?? 1.25;

    this.captionPreset = manifest.captionPreset || "HORMOZI_BOUNCE";
    this.captionColors = manifest.captionColors || {
      primary: "#FFFFFF",
      highlight: "#FFE600",
    };
    this.safeMarginVPercent = manifest.safeMarginVPercent ?? 0.22;

    this.soundDesignEnabled = manifest.soundDesignEnabled ?? true;
    this.duckingDb = manifest.duckingDb ?? -18.0;

    this.retentionRules = manifest.retentionRules || {
      maxVisualStagnationSeconds: 5.0,
      requireHookInFirstSeconds: 3.0,
      targetOverlayDensityPerMinute: 4,
    };

    this.visualCueRules = manifest.visualCueRules || [];
    this.rawMarkdownContent = rawMarkdown;
  }

  matchScore(prompt: string, transcriptSummary?: string): number {
    const combined = `${prompt} ${transcriptSummary || ""}`.toLowerCase();
    let score = 0;

    for (const trigger of this.triggers) {
      if (combined.includes(trigger.toLowerCase())) {
        score += 20;
      }
    }

    if (this.name && combined.includes(this.name.toLowerCase())) {
      score += 30;
    }

    return Math.min(score, 100);
  }

  resolveStyle(prompt: string): ResolvedDirectorStyle {
    const isVertical = !prompt.toLowerCase().includes("16:9");
    return {
      presetKey: this.defaultPresetKey,
      targetAspect: isVertical ? "9:16" : "16:9",
      pacingMultiplier: this.pacingMultiplier,
      zoomFrequencySeconds: this.zoomFrequencySeconds,
      zoomScale: this.zoomScale,
      deadAirTrimThresholdSeconds: this.deadAirTrimThresholdSeconds,
      captionPreset: this.captionPreset,
      captionColors: { ...this.captionColors },
      brollFrequencySeconds: 6.0,
      soundDesignEnabled: this.soundDesignEnabled,
      duckingDb: this.duckingDb,
      safeMarginVPercent: this.safeMarginVPercent,
      aestheticRationale: `${this.name}: Dynamic skill loaded from SKILL.md. Pacing ${this.pacingMultiplier}x, captions with ${this.captionColors.highlight} in safe envelope (${Math.round(this.safeMarginVPercent * 100)}% margin).`,
    };
  }
}

export class DynamicSkillLoader {
  /**
   * Discovers and parses all SKILL.md files from directories
   */
  static loadSkillsFromDirectory(skillsRootDir: string): DynamicSkill[] {
    const loadedSkills: DynamicSkill[] = [];
    if (!fs.existsSync(skillsRootDir)) return loadedSkills;

    const entries = fs.readdirSync(skillsRootDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMdPath = path.join(skillsRootDir, entry.name, "SKILL.md");
        if (fs.existsSync(skillMdPath)) {
          try {
            const skill = this.parseSkillFile(entry.name, skillMdPath);
            if (skill) loadedSkills.push(skill);
          } catch (err: any) {
            console.warn(`[DynamicSkillLoader] Failed to parse skill in ${skillMdPath}:`, err.message);
          }
        }
      }
    }

    return loadedSkills;
  }

  /**
   * Parses frontmatter and markdown body from SKILL.md
   */
  static parseSkillFile(skillId: string, filePath: string): DynamicSkill | null {
    const rawContent = fs.readFileSync(filePath, "utf-8");
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
    const match = rawContent.match(frontmatterRegex);

    if (!match) {
      console.warn(`[DynamicSkillLoader] No YAML frontmatter found in ${filePath}`);
      return null;
    }

    const yamlBlock = match[1];
    const markdownBody = match[2];

    const manifest = this.parseSimpleYaml(yamlBlock);
    return new DynamicSkill(skillId, manifest, markdownBody);
  }

  /**
   * Lightweight YAML parser for frontmatter metadata
   */
  private static parseSimpleYaml(yamlStr: string): SkillManifestYaml {
    const result: any = {};
    const lines = yamlStr.split(/\r?\n/);
    let currentKey = "";
    let isInsideArray = false;
    let isInsideObject = false;
    let currentArray: any[] = [];
    let currentObject: any = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Check key: value
      const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (keyMatch) {
        if (isInsideArray && currentKey) {
          result[currentKey] = currentArray;
          isInsideArray = false;
          currentArray = [];
        }
        if (isInsideObject && currentKey) {
          result[currentKey] = currentObject;
          isInsideObject = false;
          currentObject = {};
        }

        currentKey = keyMatch[1];
        const valStr = keyMatch[2].trim();

        if (valStr === "") {
          // Could be starting an array or nested object
          continue;
        } else if (valStr.startsWith("[") && valStr.endsWith("]")) {
          // Inline array
          try {
            result[currentKey] = JSON.parse(valStr);
          } catch {
            result[currentKey] = valStr.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
          }
        } else if (valStr === "true") {
          result[currentKey] = true;
        } else if (valStr === "false") {
          result[currentKey] = false;
        } else if (!isNaN(Number(valStr))) {
          result[currentKey] = Number(valStr);
        } else {
          result[currentKey] = valStr.replace(/^["']|["']$/g, "");
        }
      } else if (line.startsWith("  - ") || line.startsWith("- ")) {
        // List item
        isInsideArray = true;
        const itemStr = trimmed.replace(/^-\s*/, "").replace(/^["']|["']$/g, "");
        
        // Check if list item is an object (e.g. visualCueRules)
        if (itemStr.includes(":") && itemStr.startsWith("{") && itemStr.endsWith("}")) {
          try {
            currentArray.push(JSON.parse(itemStr));
          } catch {
            currentArray.push(itemStr);
          }
        } else if (itemStr.startsWith("keywords:")) {
          // Multiline object in array
          const obj: any = {};
          const kwMatch = itemStr.match(/keywords:\s*\[(.*?)\]/);
          if (kwMatch) {
            obj.keywords = kwMatch[1].split(",").map((k) => k.trim().replace(/^["']|["']$/g, ""));
          }
          currentArray.push(obj);
        } else {
          currentArray.push(itemStr);
        }
      } else if (line.startsWith("  ") && currentKey) {
        // Sub-object property
        isInsideObject = true;
        const subMatch = trimmed.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
        if (subMatch) {
          const sKey = subMatch[1];
          const sVal = subMatch[2].trim().replace(/^["']|["']$/g, "");
          currentObject[sKey] = !isNaN(Number(sVal)) ? Number(sVal) : sVal === "true" ? true : sVal === "false" ? false : sVal;
        }
      }
    }

    if (isInsideArray && currentKey) {
      result[currentKey] = currentArray;
    }
    if (isInsideObject && currentKey) {
      result[currentKey] = currentObject;
    }

    return result as SkillManifestYaml;
  }
}
