export type DirectorStyleKey =
  | "MINIMALIST_CLEAN"
  | "DAN_KOE_MINIMALIST"
  | "MRBEAST_FAST"
  | "HORMOZI_VIRAL"
  | "INSTAGRAM_AESTHETIC"
  | "DOCUMENTARY_DEEPDIVE"
  | "MAGNATES_MEDIA_MYSTERY"
  | "VOX_EXPLAINER"
  | "IMAN_GADZHI_CINEMATIC"
  | "SAAS_DEMO"
  | "CUSTOM";

export interface ResolvedDirectorStyle {
  presetKey: DirectorStyleKey;
  targetAspect: "16:9" | "9:16" | "1:1" | "4:5";
  pacingMultiplier: number;
  zoomFrequencySeconds: number;
  zoomScale: number;
  deadAirTrimThresholdSeconds: number;
  captionPreset: "HORMOZI_BOUNCE" | "ALI_ABDAAL_CLEAN" | "NEON_PUNCH" | "EDITORIAL_SUBTLE" | "MINIMAL_SERIF";
  captionColors: {
    primary: string;
    highlight: string;
    background?: string;
  };
  brollFrequencySeconds: number;
  soundDesignEnabled: boolean;
  duckingDb: number;
  safeMarginVPercent: number; // e.g. 0.22 for Instagram safe zones
  aestheticRationale: string;
}

export class DirectorStyleResolver {
  /**
   * Translates arbitrary user aesthetic descriptions or creator references into deterministic,
   * broadcast-grade editing parameters.
   */
  static resolve(prompt: string): ResolvedDirectorStyle {
    const p = prompt.toLowerCase();

    let style: ResolvedDirectorStyle;

    // 1. Dan Koe Minimalist / Linear / Apple Design
    if (p.includes("dan koe") || p.includes("minimalist") || p.includes("apple design") || p.includes("linear design")) {
      const isVertical = p.includes("vertical") || p.includes("reel") || p.includes("short") || p.includes("tiktok") || p.includes("9:16");
      style = {
        presetKey: "DAN_KOE_MINIMALIST",
        targetAspect: isVertical ? "9:16" : "16:9",
        pacingMultiplier: 1.0,
        zoomFrequencySeconds: 15.0,
        zoomScale: 1.12,
        deadAirTrimThresholdSeconds: 0.8,
        captionPreset: "ALI_ABDAAL_CLEAN",
        captionColors: {
          primary: "#FFFFFF",
          highlight: "#38BDF8", // Ice Blue
        },
        brollFrequencySeconds: 16.0,
        soundDesignEnabled: false,
        duckingDb: -14.0,
        safeMarginVPercent: isVertical ? 0.22 : 0.10,
        aestheticRationale: "Dan Koe / Minimalist aesthetic: Calm 1.0x rhythm, subtle 1.12x slow camera pushes, clean high-legibility typography with Ice Blue accents.",
      };
    }
    // 2. MagnatesMedia / Mystery Docu-series / Noir Storytelling
    else if (p.includes("magnates") || p.includes("mystery") || p.includes("noir") || p.includes("investigati") || p.includes("crime") || p.includes("dark documentary")) {
      style = {
        presetKey: "MAGNATES_MEDIA_MYSTERY",
        targetAspect: p.includes("9:16") || p.includes("reel") ? "9:16" : "16:9",
        pacingMultiplier: 1.05,
        zoomFrequencySeconds: 8.0,
        zoomScale: 1.20,
        deadAirTrimThresholdSeconds: 0.7,
        captionPreset: "EDITORIAL_SUBTLE",
        captionColors: {
          primary: "#E2E8F0",
          highlight: "#E11D48", // Crimson Accent
        },
        brollFrequencySeconds: 6.0,
        soundDesignEnabled: true,
        duckingDb: -16.0,
        safeMarginVPercent: 0.18,
        aestheticRationale: "MagnatesMedia Mystery: Suspenseful narrative pacing, slow cinematic zooms, crimson key highlights, and atmospheric sound design.",
      };
    }
    // 3. Vox Explainer / Motion Graphics / Journalism
    else if (p.includes("vox") || p.includes("explainer") || p.includes("journalism") || p.includes("infographic")) {
      style = {
        presetKey: "VOX_EXPLAINER",
        targetAspect: p.includes("9:16") || p.includes("reel") ? "9:16" : "16:9",
        pacingMultiplier: 1.10,
        zoomFrequencySeconds: 9.0,
        zoomScale: 1.18,
        deadAirTrimThresholdSeconds: 0.5,
        captionPreset: "MINIMAL_SERIF",
        captionColors: {
          primary: "#FFFFFF",
          highlight: "#F59E0B", // Amber Gold
        },
        brollFrequencySeconds: 5.0,
        soundDesignEnabled: true,
        duckingDb: -16.0,
        safeMarginVPercent: 0.16,
        aestheticRationale: "Vox Explainer: High visual context density, frequent screencast/graphic cutaways, amber typography highlights, and crisp audio cues.",
      };
    }
    // 4. Iman Gadzhi Cinematic Agency Style
    else if (p.includes("iman") || p.includes("gadzhi") || p.includes("cinematic") || p.includes("luxury")) {
      style = {
        presetKey: "IMAN_GADZHI_CINEMATIC",
        targetAspect: p.includes("9:16") ? "9:16" : "16:9",
        pacingMultiplier: 1.12,
        zoomFrequencySeconds: 7.0,
        zoomScale: 1.22,
        deadAirTrimThresholdSeconds: 0.45,
        captionPreset: "EDITORIAL_SUBTLE",
        captionColors: {
          primary: "#F8FAFC",
          highlight: "#FBBF24", // Golden Luxury
        },
        brollFrequencySeconds: 6.5,
        soundDesignEnabled: true,
        duckingDb: -18.0,
        safeMarginVPercent: 0.20,
        aestheticRationale: "Iman Gadzhi Cinematic: Warm golden accents, balanced fast-paced visual storytelling, and high-production sound design.",
      };
    }
    // 5. High-Retention / MrBeast Hyper-Fast
    else if (p.includes("mrbeast") || p.includes("aggressive") || p.includes("hyper") || p.includes("retention") || p.includes("insane")) {
      style = {
        presetKey: "MRBEAST_FAST",
        targetAspect: p.includes("16:9") ? "16:9" : "9:16",
        pacingMultiplier: 1.35,
        zoomFrequencySeconds: 4.0,
        zoomScale: 1.35,
        deadAirTrimThresholdSeconds: 0.25,
        captionPreset: "HORMOZI_BOUNCE",
        captionColors: {
          primary: "#FFFFFF",
          highlight: "#00FF88", // Neon Punch Green
        },
        brollFrequencySeconds: 4.0,
        soundDesignEnabled: true,
        duckingDb: -20.0,
        safeMarginVPercent: 0.22,
        aestheticRationale: "MrBeast hyper-retention: 1.35x fast cuts, aggressive silence removal (<0.25s), punchy spring zooms every 4s, neon green karaoke subtitles.",
      };
    }
    // 6. Alex Hormozi Viral Authority / Client Closing
    else if (p.includes("hormozi") || p.includes("viral") || p.includes("hook") || p.includes("growth")) {
      style = {
        presetKey: "HORMOZI_VIRAL",
        targetAspect: "9:16",
        pacingMultiplier: 1.25,
        zoomFrequencySeconds: 5.0,
        zoomScale: 1.30,
        deadAirTrimThresholdSeconds: 0.35,
        captionPreset: "HORMOZI_BOUNCE",
        captionColors: {
          primary: "#FFFFFF",
          highlight: "#FFFF00", // High-Contrast Electric Yellow
        },
        brollFrequencySeconds: 6.0,
        soundDesignEnabled: true,
        duckingDb: -18.0,
        safeMarginVPercent: 0.22,
        aestheticRationale: "Hormozi Viral: Word-by-word bouncing yellow karaoke captions, tight cadence, and rhythmic 1.30x zoom punches.",
      };
    }
    // 7. Branding & Client Acquisition Ads (Personal & Business Branding)
    else if (p.includes("branding") || p.includes("client") || p.includes("business") || p.includes("ad") || p.includes("close")) {
      style = {
        presetKey: "HORMOZI_VIRAL",
        targetAspect: "9:16",
        pacingMultiplier: 1.25,
        zoomFrequencySeconds: 5.0,
        zoomScale: 1.30,
        deadAirTrimThresholdSeconds: 0.35,
        captionPreset: "HORMOZI_BOUNCE",
        captionColors: {
          primary: "#FFFFFF",
          highlight: p.includes("neon") || p.includes("ffe600") ? "#FFE600" : "#FFFF00",
        },
        brollFrequencySeconds: 6.0,
        soundDesignEnabled: true,
        duckingDb: -18.0,
        safeMarginVPercent: 0.22,
        aestheticRationale: "High-Ticket Client Acquisition Ad: Vertical 9:16 framing, high-contrast white & yellow kinetic captions in safe zone (22% bottom margin), punchy 1.30x spring zooms on authority hooks, and speech-ducked BGM.",
      };
    }
    // 8. Instagram / TikTok Aesthetic Reel (Default Creator Mode)
    else if (p.includes("instagram") || p.includes("aesthetic") || p.includes("pinterest") || p.includes("fashion") || p.includes("vlog") || p.includes("lifestyle") || p.includes("reel") || p.includes("tiktok") || p.includes("short")) {
      style = {
        presetKey: "INSTAGRAM_AESTHETIC",
        targetAspect: "9:16",
        pacingMultiplier: 1.15,
        zoomFrequencySeconds: 6.0,
        zoomScale: 1.25,
        deadAirTrimThresholdSeconds: 0.45,
        captionPreset: "HORMOZI_BOUNCE",
        captionColors: {
          primary: "#FFFFFF",
          highlight: "#FF6584", // Neon Coral Pink
        },
        brollFrequencySeconds: 7.5,
        soundDesignEnabled: true,
        duckingDb: -18.0,
        safeMarginVPercent: 0.22,
        aestheticRationale: "Instagram aesthetic reel: Vertical 9:16 canvas, safe-zone captions, vector brand badges, 1.25x spring attention punches.",
      };
    }
    // 9. Documentary Deep-Dive / Storytelling
    else if (p.includes("documentary") || p.includes("essay") || p.includes("deep dive") || p.includes("story") || p.includes("history")) {
      style = {
        presetKey: "DOCUMENTARY_DEEPDIVE",
        targetAspect: "16:9",
        pacingMultiplier: 1.0,
        zoomFrequencySeconds: 12.0,
        zoomScale: 1.18,
        deadAirTrimThresholdSeconds: 0.8,
        captionPreset: "EDITORIAL_SUBTLE",
        captionColors: {
          primary: "#F8FAFC",
          highlight: "#F59E0B",
        },
        brollFrequencySeconds: 9.0,
        soundDesignEnabled: true,
        duckingDb: -16.0,
        safeMarginVPercent: 0.12,
        aestheticRationale: "Documentary deep-dive: Cinematic 16:9 framing, contextual full B-roll cutaways, warm gold typography accents.",
      };
    }
    // Default Balanced Custom Preset
    else {
      style = {
        presetKey: "CUSTOM",
        targetAspect: "9:16",
        pacingMultiplier: 1.1,
        zoomFrequencySeconds: 7.0,
        zoomScale: 1.25,
        deadAirTrimThresholdSeconds: 0.5,
        captionPreset: "HORMOZI_BOUNCE",
        captionColors: {
          primary: "#FFFFFF",
          highlight: "#00FF88",
        },
        brollFrequencySeconds: 8.0,
        soundDesignEnabled: true,
        duckingDb: -18.0,
        safeMarginVPercent: 0.22,
        aestheticRationale: "Balanced dynamic creator preset: Clean 9:16 vertical delivery, rhythmic emphasis zooms, and vibrant subtitles.",
      };
    }

    // Apply explicit color & theme overrides if requested in prompt
    if (p.includes("neon yellow") || p.includes("ffe600") || p.includes("#ffe600")) {
      style.captionColors.primary = "#FFFFFF";
      style.captionColors.highlight = "#FFE600";
    } else if (p.includes("yellow") || p.includes("white and yellow") || p.includes("yellow theme") || p.includes("white & yellow")) {
      style.captionColors.primary = "#FFFFFF";
      style.captionColors.highlight = "#FFFF00";
    } else if (p.includes("blue") || p.includes("cyan")) {
      style.captionColors.highlight = "#38BDF8";
    } else if (p.includes("green") || p.includes("neon")) {
      style.captionColors.highlight = "#00FF88";
    } else if (p.includes("coral") || p.includes("pink")) {
      style.captionColors.highlight = "#FF6584";
    } else if (p.includes("gold") || p.includes("amber")) {
      style.captionColors.highlight = "#F59E0B";
    } else if (p.includes("purple") || p.includes("magenta")) {
      style.captionColors.highlight = "#A855F7";
    }

    return style;
  }

  /**
   * Conscious Research Synthesis: Takes text analyzed from internet research or external
   * reference and compiles it into a concrete ResolvedDirectorStyle ruleset.
   */
  static synthesizeFromResearch(styleQuery: string, researchSummary: string): ResolvedDirectorStyle {
    const combined = `${styleQuery} ${researchSummary}`.toLowerCase();
    const base = this.resolve(combined);

    // Apply granular overrides parsed from research summary if present
    if (combined.includes("fast cuts") || combined.includes("high energy")) {
      base.pacingMultiplier = 1.30;
      base.deadAirTrimThresholdSeconds = 0.3;
    } else if (combined.includes("slow pace") || combined.includes("atmospheric") || combined.includes("contemplative")) {
      base.pacingMultiplier = 0.95;
      base.deadAirTrimThresholdSeconds = 1.0;
    }

    if (combined.includes("yellow")) {
      base.captionColors.highlight = "#FFFF00";
    } else if (combined.includes("blue") || combined.includes("cyan")) {
      base.captionColors.highlight = "#38BDF8";
    } else if (combined.includes("purple") || combined.includes("magenta")) {
      base.captionColors.highlight = "#A855F7";
    }

    base.aestheticRationale = `Conscious research resolved for "${styleQuery}": ${base.aestheticRationale}`;
    return base;
  }
}
