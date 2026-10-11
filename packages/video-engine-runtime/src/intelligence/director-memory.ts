import * as path from "path";
import * as fs from "fs";
import {
  DirectorMemoryItem,
  MemoryCategory,
  MemoryOperation,
  MemoryScope,
  UserEditingProfile,
} from "@workspace/video-contracts";

export interface MemoryQueryOptions {
  companyId?: string | null;
  userId?: string | null;
  category?: MemoryCategory;
  scope?: MemoryScope;
  limit?: number;
}

export interface ExtractedFact {
  category: MemoryCategory;
  key: string;
  value: any;
  confidence: number;
  scope?: MemoryScope;
}

export class DirectorMemoryEngine {
  private static instance: DirectorMemoryEngine | null = null;
  private storageFilePath: string;

  constructor(storageDir?: string) {
    const baseDir = storageDir || path.resolve(process.cwd(), ".director_memory");
    if (!fs.existsSync(baseDir)) {
      try {
        fs.mkdirSync(baseDir, { recursive: true });
      } catch {
        // Fallback to temp
      }
    }
    this.storageFilePath = path.join(baseDir, "memories.json");
  }

  static getInstance(storageDir?: string): DirectorMemoryEngine {
    if (!this.instance) {
      this.instance = new DirectorMemoryEngine(storageDir);
    }
    return this.instance;
  }

  // ==========================================
  // Phase 1: Fact Extraction (Mem0 Paradigm)
  // ==========================================
  extractFacts(input: {
    userPrompt: string;
    userRevisions?: string[];
    scope?: MemoryScope;
    companyId?: string;
    editContext?: {
      captionColors?: { primary: string; highlight: string };
      bgmGenre?: string;
      bgmVolumeDb?: number;
      targetAspect?: "16:9" | "9:16" | "1:1";
    };
  }): ExtractedFact[] {
    const facts: ExtractedFact[] = [];
    const text = `${input.userPrompt} ${(input.userRevisions || []).join(" ")}`.toLowerCase();

    // Default scope heuristics:
    // Craftsmanship (Pacing, Audio Mixing, Retention, General Placements) -> GLOBAL
    // Brand Specifics (Colors, Logos, Custom Guidelines) -> COMPANY if companyId provided, else GLOBAL
    const brandScope: MemoryScope = input.scope || (input.companyId ? "COMPANY" : "GLOBAL");
    const universalScope: MemoryScope = input.scope || "GLOBAL";

    // 1. Caption Color & Style Preferences
    if (text.includes("yellow") || text.includes("electric yellow")) {
      facts.push({
        category: "STYLE",
        key: "caption_highlight_color",
        value: "#FFE600",
        confidence: 0.95,
        scope: brandScope,
      });
    } else if (text.includes("cyan") || text.includes("neon blue")) {
      facts.push({
        category: "STYLE",
        key: "caption_highlight_color",
        value: "#00F0FF",
        confidence: 0.95,
        scope: brandScope,
      });
    } else if (text.includes("green") || text.includes("emerald")) {
      facts.push({
        category: "STYLE",
        key: "caption_highlight_color",
        value: "#00FF88",
        confidence: 0.95,
        scope: brandScope,
      });
    }

    if (text.includes("hormozi") || text.includes("viral bounce") || text.includes("tiktok bounce")) {
      facts.push({
        category: "STYLE",
        key: "caption_preset",
        value: "HORMOZI_BOUNCE",
        confidence: 0.9,
        scope: universalScope,
      });
    } else if (text.includes("clean") || text.includes("abdaal") || text.includes("minimal")) {
      facts.push({
        category: "STYLE",
        key: "caption_preset",
        value: "ALI_ABDAAL_CLEAN",
        confidence: 0.9,
        scope: universalScope,
      });
    }

    // 2. Audio & BGM Preferences (Universal Crafting)
    if (text.includes("lo-fi") || text.includes("calm music") || text.includes("soft background")) {
      facts.push({
        category: "AUDIO_MIXING",
        key: "bgm_genre",
        value: "AMBIENT_CALM",
        confidence: 0.9,
        scope: universalScope,
      });
    } else if (text.includes("phonk") || text.includes("fast music") || text.includes("hype beat") || text.includes("upbeat")) {
      facts.push({
        category: "AUDIO_MIXING",
        key: "bgm_genre",
        value: "ELECTRONIC_UPBEAT",
        confidence: 0.9,
        scope: universalScope,
      });
    }

    if (text.includes("low music") || text.includes("quiet bgm") || text.includes("lower bgm")) {
      facts.push({
        category: "AUDIO_MIXING",
        key: "bgm_volume_db",
        value: -22.0,
        confidence: 0.85,
        scope: universalScope,
      });
    }

    // 3. Pacing & Camera Preferences (Universal Crafting)
    if (text.includes("fast cut") || text.includes("mrbeast") || text.includes("hyper")) {
      facts.push({
        category: "PACING",
        key: "cut_frequency_sec",
        value: 1.8,
        confidence: 0.85,
        scope: universalScope,
      });
      facts.push({
        category: "PACING",
        key: "zoom_frequency_sec",
        value: 3.5,
        confidence: 0.85,
        scope: universalScope,
      });
    } else if (text.includes("doctor") || text.includes("authoritative") || text.includes("clinical")) {
      facts.push({
        category: "PACING",
        key: "zoom_scale",
        value: 1.15,
        confidence: 0.9,
        scope: universalScope,
      });
      facts.push({
        category: "ASSET_PREFERENCE",
        key: "preferred_visual_category",
        value: "ANATOMICAL_DIAGRAM",
        confidence: 0.9,
        scope: universalScope,
      });
    }

    // 4. Ingest Edit Context if present
    if (input.editContext) {
      if (input.editContext.captionColors) {
        facts.push({
          category: "STYLE",
          key: "caption_colors",
          value: input.editContext.captionColors,
          confidence: 0.8,
          scope: brandScope,
        });
      }
      if (input.editContext.targetAspect) {
        facts.push({
          category: "PACING",
          key: "target_aspect",
          value: input.editContext.targetAspect,
          confidence: 0.8,
          scope: universalScope,
        });
      }
    }

    return facts;
  }

  // ==========================================================
  // Phase 2: Memory Reconciliation (ADD / UPDATE / DELETE / NONE)
  // ==========================================================
  reconcileMemories(
    newFacts: ExtractedFact[],
    existingMemories: DirectorMemoryItem[]
  ): MemoryOperation[] {
    const operations: MemoryOperation[] = [];

    for (const fact of newFacts) {
      const targetScope = fact.scope || "GLOBAL";
      const existing = existingMemories.find(
        (m) =>
          m.category === fact.category &&
          m.key === fact.key &&
          (m.scope || "GLOBAL") === targetScope
      );

      if (!existing) {
        operations.push({
          action: "ADD",
          scope: targetScope,
          category: fact.category,
          key: fact.key,
          value: fact.value,
          reason: `Discovered new [${targetScope}] preference: [${fact.category}] ${fact.key} = ${JSON.stringify(fact.value)}`,
        });
      } else {
        const valChanged = JSON.stringify(existing.value) !== JSON.stringify(fact.value);
        if (valChanged) {
          operations.push({
            action: "UPDATE",
            existingMemoryId: existing.id,
            scope: existing.scope || targetScope,
            category: fact.category,
            key: fact.key,
            value: fact.value,
            reason: `Updated [${existing.scope || targetScope}] preference: ${fact.key} changed from ${JSON.stringify(existing.value)} to ${JSON.stringify(fact.value)}`,
          });
        } else {
          operations.push({
            action: "NONE",
            existingMemoryId: existing.id,
            scope: existing.scope || targetScope,
            category: fact.category,
            key: fact.key,
            value: fact.value,
            reason: `Preference confirmed (${existing.occurrenceCount + 1} occurrences)`,
          });
        }
      }
    }

    return operations;
  }

  // ==========================================================
  // Storage & Execution (Cascading Multi-Tenant + Universal)
  // ==========================================================
  applyOperations(
    companyIdOrOptions:
      | string
      | null
      | undefined
      | { companyId?: string | null; userId?: string | null; scope?: MemoryScope },
    userIdOrOps?: string | null | MemoryOperation[],
    maybeOps?: MemoryOperation[]
  ): DirectorMemoryItem[] {
    let companyId: string | null | undefined;
    let userId: string | null | undefined;
    let defaultScope: MemoryScope = "GLOBAL";
    let operations: MemoryOperation[] = [];

    if (Array.isArray(userIdOrOps)) {
      companyId = typeof companyIdOrOptions === "string" ? companyIdOrOptions : null;
      operations = userIdOrOps;
      defaultScope = companyId ? "COMPANY" : "GLOBAL";
    } else if (maybeOps && Array.isArray(maybeOps)) {
      companyId = typeof companyIdOrOptions === "string" ? companyIdOrOptions : null;
      userId = typeof userIdOrOps === "string" ? userIdOrOps : null;
      operations = maybeOps;
      defaultScope = companyId ? "COMPANY" : "GLOBAL";
    } else if (typeof companyIdOrOptions === "object" && companyIdOrOptions !== null) {
      companyId = companyIdOrOptions.companyId;
      userId = companyIdOrOptions.userId;
      defaultScope = companyIdOrOptions.scope || (companyId ? "COMPANY" : "GLOBAL");
      operations = Array.isArray(userIdOrOps) ? userIdOrOps : [];
    }

    const all = this.loadAll();
    const now = new Date().toISOString();

    for (const op of operations) {
      const opScope: MemoryScope = op.scope || defaultScope;

      if (op.action === "ADD") {
        all.push({
          id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          scope: opScope,
          companyId: opScope === "GLOBAL" ? null : (companyId || null),
          userId: opScope === "USER" ? (userId || null) : null,
          category: op.category,
          key: op.key,
          value: op.value,
          confidence: 0.95,
          occurrenceCount: 1,
          lastAccessedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      } else if (op.action === "UPDATE" && op.existingMemoryId) {
        const idx = all.findIndex((m) => m.id === op.existingMemoryId);
        if (idx !== -1) {
          all[idx].value = op.value;
          all[idx].scope = opScope;
          all[idx].occurrenceCount += 1;
          all[idx].lastAccessedAt = now;
          all[idx].updatedAt = now;
        }
      } else if (op.action === "NONE" && op.existingMemoryId) {
        const idx = all.findIndex((m) => m.id === op.existingMemoryId);
        if (idx !== -1) {
          all[idx].occurrenceCount += 1;
          all[idx].lastAccessedAt = now;
        }
      } else if (op.action === "DELETE" && op.existingMemoryId) {
        const idx = all.findIndex((m) => m.id === op.existingMemoryId);
        if (idx !== -1) {
          all.splice(idx, 1);
        }
      }
    }

    this.saveAll(all);
    return this.queryMemories({ companyId, userId });
  }

  // ==========================================================
  // Cascading Query: USER > COMPANY > GLOBAL (Universal)
  // ==========================================================
  queryMemories(options: MemoryQueryOptions = {}): DirectorMemoryItem[] {
    const all = this.loadAll();

    // If explicit scope filter requested (e.g. only GLOBAL items)
    if (options.scope) {
      return all
        .filter((m) => {
          const itemScope = m.scope || (m.companyId === "platform" || !m.companyId ? "GLOBAL" : "COMPANY");
          if (itemScope !== options.scope) return false;
          if (options.companyId && m.companyId && m.companyId !== options.companyId) return false;
          if (options.userId && m.userId && m.userId !== options.userId) return false;
          if (options.category && m.category !== options.category) return false;
          return true;
        })
        .slice(0, options.limit || 50);
    }

    // Cascading Multi-Tier Resolution:
    // 1. Layer 1: GLOBAL (Universal Platform Wisdom)
    const globalItems = all.filter((m) => {
      const isGlobal = (m.scope || "GLOBAL") === "GLOBAL" || !m.companyId || m.companyId === "platform";
      if (!isGlobal) return false;
      if (options.category && m.category !== options.category) return false;
      return true;
    });

    // 2. Layer 2: COMPANY (Tenant Brand Guidelines)
    const companyItems = options.companyId
      ? all.filter((m) => {
          const isCompany = (m.scope === "COMPANY" || (!m.scope && m.companyId === options.companyId)) &&
            m.companyId === options.companyId;
          if (!isCompany) return false;
          if (options.category && m.category !== options.category) return false;
          return true;
        })
      : [];

    // 3. Layer 3: USER (Individual Creator Taste)
    const userItems = options.companyId && options.userId
      ? all.filter((m) => {
          const isUser = m.scope === "USER" &&
            m.companyId === options.companyId &&
            m.userId === options.userId;
          if (!isUser) return false;
          if (options.category && m.category !== options.category) return false;
          return true;
        })
      : [];

    // Merge cascading hierarchy: USER overrides COMPANY overrides GLOBAL
    const effectiveMap = new Map<string, DirectorMemoryItem>();

    for (const item of globalItems) {
      effectiveMap.set(`${item.category}:${item.key}`, item);
    }
    for (const item of companyItems) {
      effectiveMap.set(`${item.category}:${item.key}`, item);
    }
    for (const item of userItems) {
      effectiveMap.set(`${item.category}:${item.key}`, item);
    }

    return Array.from(effectiveMap.values()).slice(0, options.limit || 50);
  }

  // ==========================================================
  // User Profile Synthesis with Cascading Intelligence
  // ==========================================================
  buildUserEditingProfile(
    companyId?: string | null,
    userId?: string | null
  ): UserEditingProfile {
    const memories = this.queryMemories({ companyId, userId });
    const profile: UserEditingProfile = {
      companyId: companyId || undefined,
      userId: userId || undefined,
      scope: companyId ? "COMPANY" : "GLOBAL",
      captionStyle: {},
      audioPreference: {},
      pacingPreference: {},
      brandRules: [],
    };

    for (const mem of memories) {
      if (mem.key === "caption_highlight_color" && profile.captionStyle) {
        profile.captionStyle.highlightColor = mem.value;
      } else if (mem.key === "caption_preset" && profile.captionStyle) {
        profile.captionStyle.preset = mem.value;
      } else if (mem.key === "bgm_genre" && profile.audioPreference) {
        profile.audioPreference.bgmGenre = mem.value;
      } else if (mem.key === "bgm_volume_db" && profile.audioPreference) {
        profile.audioPreference.bgmVolumeDb = mem.value;
      } else if (mem.key === "cut_frequency_sec" && profile.pacingPreference) {
        profile.pacingPreference.cutFrequencySec = mem.value;
      } else if (mem.key === "zoom_scale" && profile.pacingPreference) {
        profile.pacingPreference.zoomScale = mem.value;
      } else if (mem.key === "target_aspect" && profile.pacingPreference) {
        profile.pacingPreference.targetAspect = mem.value;
      }
    }

    return profile;
  }

  private loadAll(): DirectorMemoryItem[] {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const raw = fs.readFileSync(this.storageFilePath, "utf8");
        return JSON.parse(raw);
      }
    } catch {
      // Return empty on error
    }
    return [];
  }

  private saveAll(memories: DirectorMemoryItem[]): void {
    try {
      const dir = path.dirname(this.storageFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storageFilePath, JSON.stringify(memories, null, 2), "utf8");
    } catch (e: any) {
      console.warn("[DirectorMemoryEngine] Failed to write memories.json:", e.message);
    }
  }
}
