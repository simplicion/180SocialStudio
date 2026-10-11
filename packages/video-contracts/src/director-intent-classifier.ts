export type EditIntentScope =
  | "ADD_CAPTIONS_ONLY"
  | "CHANGE_CAPTION_STYLE"
  | "INSERT_CONTEXTUAL_VISUALS"
  | "CUT_SILENCE_ONLY"
  | "ADD_AUDIO_BGM_ONLY"
  | "APPLY_COLOR_GRADE_ONLY"
  | "ADD_CAMERA_ZOOMS_ONLY"
  | "MULTICAM_PODCAST_DIRECT"
  | "FULL_AUTONOMOUS_DIRECT";

export interface ResolvedEditScope {
  intentScope: EditIntentScope;
  lockedTracks: Array<"MAIN_VIDEO" | "B_ROLL" | "CAMERA" | "CAPTIONS" | "AUDIO_VOICE" | "AUDIO_BGM">;
  allowedMutations: Array<"ADD_CAPTIONS" | "MUTATE_CAPTIONS" | "INSERT_GRAPHICS" | "TRIM_SILENCE" | "ADD_ZOOMS" | "DUCK_AUDIO" | "APPLY_LUT" | "SWITCH_CAMERAS">;
  captionColorOverride?: string;
  colorGradePreset?: string;
  motionGraphicType?: "STAT_CARD" | "BULLET_LIST" | "QUOTE_BANNER" | "BRAND_BADGE";
  isSurgicalPatch: boolean;
  editorialRationale: string;
}

export class DirectorIntentClassifier {
  /**
   * Classifies user natural language commands into strict surgical scopes,
   * applying track locks so single-purpose instructions (e.g. "only add blue captions")
   * NEVER touch, alter, or destructively re-edit unrelated video, camera, or audio tracks.
   */
  static classifyIntent(prompt: string): ResolvedEditScope {
    const p = prompt.toLowerCase().trim();

    // Helper: Detect specific color mention
    let captionColor: string | undefined = undefined;
    if (p.includes("blue") || p.includes("cyan")) captionColor = "#38BDF8";
    else if (p.includes("yellow")) captionColor = "#FFFF00";
    else if (p.includes("green") || p.includes("neon")) captionColor = "#00FF88";
    else if (p.includes("red") || p.includes("coral") || p.includes("pink")) captionColor = "#FF6584";
    else if (p.includes("gold") || p.includes("amber")) captionColor = "#F59E0B";
    else if (p.includes("purple") || p.includes("magenta")) captionColor = "#A855F7";

    // 1. CAPTION ONLY (e.g. "just add captions", "add blue subtitles", "add animated captions in blue")
    const isCaptionFocused = p.includes("caption") || p.includes("subtitle") || p.includes("subtitles");
    const isExclusiveSingleTask = p.includes("only") || p.includes("just") || p.includes("change the") || p.includes("set caption");

    if (isCaptionFocused && (isExclusiveSingleTask || (!p.includes("cut") && !p.includes("pause") && !p.includes("silence") && !p.includes("reframe") && !p.includes("music") && !p.includes("direct") && !p.includes("podcast")))) {
      return {
        intentScope: p.includes("color") || p.includes("style") ? "CHANGE_CAPTION_STYLE" : "ADD_CAPTIONS_ONLY",
        lockedTracks: ["MAIN_VIDEO", "B_ROLL", "CAMERA", "AUDIO_VOICE", "AUDIO_BGM"],
        allowedMutations: ["ADD_CAPTIONS", "MUTATE_CAPTIONS"],
        captionColorOverride: captionColor,
        isSurgicalPatch: true,
        editorialRationale: `Surgical Caption Operation: Isolated to caption track only. All video cuts, camera zooms, and audio tracks are strictly locked.`,
      };
    }

    // 2. VISUALS / MOTION GRAPHICS ONLY (e.g. "add some visuals and animated explanations")
    const isVisualsFocused = p.includes("visual") || p.includes("motion graphic") || p.includes("explanation") || p.includes("infographic") || p.includes("diagram") || p.includes("card") || p.includes("graphic");
    if (isVisualsFocused && !p.includes("re-edit") && !p.includes("podcast")) {
      let graphicType: "STAT_CARD" | "BULLET_LIST" | "QUOTE_BANNER" | "BRAND_BADGE" = "STAT_CARD";
      if (p.includes("list") || p.includes("step") || p.includes("bullet")) graphicType = "BULLET_LIST";
      else if (p.includes("quote") || p.includes("statement")) graphicType = "QUOTE_BANNER";
      else if (p.includes("logo") || p.includes("brand")) graphicType = "BRAND_BADGE";

      return {
        intentScope: "INSERT_CONTEXTUAL_VISUALS",
        lockedTracks: ["MAIN_VIDEO", "AUDIO_VOICE"],
        allowedMutations: ["INSERT_GRAPHICS"],
        motionGraphicType: graphicType,
        isSurgicalPatch: true,
        editorialRationale: `Surgical Motion Graphic Injection: Generating animated explanation overlays without altering primary speech cuts.`,
      };
    }

    // 3. COLOR GRADING ONLY (e.g. "make it look cinematic", "apply teal and orange")
    const isColorFocused = p.includes("color grade") || p.includes("cinematic look") || p.includes("teal and orange") || p.includes("lut") || p.includes("film look");
    if (isColorFocused && !p.includes("direct") && !p.includes("cut")) {
      return {
        intentScope: "APPLY_COLOR_GRADE_ONLY",
        lockedTracks: ["MAIN_VIDEO", "B_ROLL", "CAMERA", "CAPTIONS", "AUDIO_VOICE", "AUDIO_BGM"],
        allowedMutations: ["APPLY_LUT"],
        colorGradePreset: p.includes("teal") ? "TEAL_ORANGE_BLOCKBUSTER" : p.includes("warm") ? "WARM_DOCUMENTARY" : "FILMIC_CLEAN",
        isSurgicalPatch: true,
        editorialRationale: `Surgical Color Grade Pass: Applying cinematic LUT filtergraph without altering timeline cuts or captions.`,
      };
    }

    // 4. CUT SILENCE ONLY
    if ((p.includes("trim silence") || p.includes("cut dead air") || p.includes("remove pause")) && !p.includes("music") && !p.includes("caption")) {
      return {
        intentScope: "CUT_SILENCE_ONLY",
        lockedTracks: ["B_ROLL", "CAMERA", "CAPTIONS", "AUDIO_BGM"],
        allowedMutations: ["TRIM_SILENCE"],
        isSurgicalPatch: true,
        editorialRationale: `Surgical Silence Removal: Ripple-trimming dead air without adding captions or music.`,
      };
    }

    // 5. MULTI-CAM PODCAST DIRECTION
    if (p.includes("podcast") || p.includes("multicam") || p.includes("host") || p.includes("guest") || p.includes("two shot") || p.includes("camera angle")) {
      return {
        intentScope: "MULTICAM_PODCAST_DIRECT",
        lockedTracks: [],
        allowedMutations: ["SWITCH_CAMERAS", "ADD_CAPTIONS", "DUCK_AUDIO", "APPLY_LUT"],
        isSurgicalPatch: false,
        editorialRationale: `Holistic Multi-Cam Podcast Direction: Active speaker diarization, reaction cutaways, J/L-cuts, and room tone bed.`,
      };
    }

    // 6. DEFAULT FULL AUTONOMOUS DIRECTION
    return {
      intentScope: "FULL_AUTONOMOUS_DIRECT",
      lockedTracks: [],
      allowedMutations: ["ADD_CAPTIONS", "MUTATE_CAPTIONS", "INSERT_GRAPHICS", "TRIM_SILENCE", "ADD_ZOOMS", "DUCK_AUDIO", "APPLY_LUT", "SWITCH_CAMERAS"],
      captionColorOverride: captionColor,
      isSurgicalPatch: false,
      editorialRationale: `Holistic Autonomous Creative Direction: Applying narrative pacing, spring zooms, kinetic captions, B-roll, and audio ducking.`,
    };
  }
}
