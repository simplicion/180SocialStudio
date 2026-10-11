import * as path from "path";
import * as fs from "fs";
import { DirectorSkill } from "./base-skill";
import { DynamicSkillLoader, DynamicSkill, SkillManifestYaml } from "./dynamic-skill-loader";

export class SkillRegistry {
  private static instance: SkillRegistry;
  private skills: Map<string, DirectorSkill> = new Map();
  private initialized = false;

  private constructor() {
    this.discoverSkills();
  }

  static getInstance(): SkillRegistry {
    if (!SkillRegistry.instance) {
      SkillRegistry.instance = new SkillRegistry();
    }
    return SkillRegistry.instance;
  }

  /**
   * Scans workspace and runtime directories for SKILL.md packages
   */
  discoverSkills(): void {
    const candidateDirs = [
      path.resolve(__dirname, "../../skills"), // packages/video-engine-runtime/skills
      path.resolve(process.cwd(), "packages/video-engine-runtime/skills"),
      path.resolve(process.cwd(), ".agents/skills"),
      path.resolve(process.cwd(), "skills"),
    ];

    for (const dir of candidateDirs) {
      if (fs.existsSync(dir)) {
        const loaded = DynamicSkillLoader.loadSkillsFromDirectory(dir);
        for (const skill of loaded) {
          this.skills.set(skill.id, skill);
        }
      }
    }

    this.initialized = true;
  }

  register(skill: DirectorSkill): void {
    this.skills.set(skill.id, skill);
  }

  /**
   * Registers a dynamic skill from a raw YAML/JSON manifest (e.g. from cloud database or user prompt)
   */
  registerFromManifest(id: string, manifest: SkillManifestYaml, markdownBody?: string): DynamicSkill {
    const skill = new DynamicSkill(id, manifest, markdownBody);
    this.skills.set(id, skill);
    return skill;
  }

  get(skillId: string): DirectorSkill | undefined {
    return this.skills.get(skillId);
  }

  getAll(): DirectorSkill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Automatically discovers and matches the best Director Skill based on prompt and transcript context
   */
  matchBestSkill(prompt: string, transcriptSummary?: string): DirectorSkill {
    let highestScore = -1;
    const allSkills = this.getAll();
    let bestSkill: DirectorSkill | undefined;

    for (const skill of allSkills) {
      const score = skill.matchScore(prompt, transcriptSummary);
      if (score > highestScore) {
        highestScore = score;
        bestSkill = skill;
      }
    }

    if (!bestSkill || highestScore <= 0) {
      bestSkill = this.skills.get("short-form-viral-reel") || allSkills[0];
    }

    return bestSkill;
  }
}
