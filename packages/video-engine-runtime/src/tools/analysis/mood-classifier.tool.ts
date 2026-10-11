import { z } from "zod";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import { SkillRegistry } from "../../skills/skill-registry";
import { MoodTone } from "../../skills/base-skill";
import { CuratedTakeManifest } from "../../intelligence/semantic-take-curator";
import { SemanticEntityExtractor } from "../../intelligence/semantic-entity-extractor";

export interface VisualCueTarget {
  id: string;
  timestampSec: number;
  durationSec: number;
  category: "ANATOMICAL_DIAGRAM" | "WARNING_BADGE" | "EMOJI_3D" | "ICON_VECTOR" | "CALLOUT_CARD" | "METRIC_STAT";
  assetQuery: string;
  mood: MoodTone;
  position: "UPPER_RIGHT" | "UPPER_LEFT" | "CENTER_RIGHT" | "LOWER_THIRD";
  sfxType: "POP" | "WHOOSH" | "DING" | "ALERT" | "CHIME";
  spokenContextText: string;
}

export const MoodClassifierInputSchema = z.object({
  userPrompt: z.string().optional(),
  skillId: z.string().optional(),
});

export type MoodClassifierInput = z.infer<typeof MoodClassifierInputSchema>;

export interface MoodClassifierOutput {
  detectedSkillId: string;
  overallMood: MoodTone;
  visualCues: VisualCueTarget[];
}

export class MoodClassifierTool extends VideoDirectorTool<MoodClassifierInput, MoodClassifierOutput> {
  readonly name = "mood_classifier";
  readonly description = "Analyzes transcript cadence and emotional mood to extract context-aware visual cue anchors and asset search queries.";
  readonly stage = "NARRATIVE_CURATION" as const;
  readonly inputSchema = MoodClassifierInputSchema;

  async execute(input: MoodClassifierInput, context: DirectorExecutionContext): Promise<MoodClassifierOutput> {
    context.log?.("[MoodClassifierTool] Classifying video tone and extracting visual cue anchors...");

    const curatedManifest: CuratedTakeManifest | undefined = context.artifacts.get("curatedManifest");
    const transcripts = context.artifacts.get("transcriptions") || [];
    const prompt = input.userPrompt || "";

    const segmentsToScan = curatedManifest?.keeperSegments || transcripts;

    // 1. Compile full text context from curated narrative
    const combinedTranscript = segmentsToScan
      .map((s: any) => (s.transcriptText || s.text || s.transcript || (s.words ? s.words.map((w: any) => w.word).join(" ") : "")))
      .join(" ");

    // 2. Select Skill
    const skillRegistry = SkillRegistry.getInstance();
    const skill = input.skillId
      ? skillRegistry.get(input.skillId) || skillRegistry.matchBestSkill(prompt, combinedTranscript)
      : skillRegistry.matchBestSkill(prompt, combinedTranscript);

    context.log?.(`[MoodClassifierTool] Matched Skill: "${skill.name}" (Genre: ${skill.genre})`);

    const visualCues: VisualCueTarget[] = [];
    const rules = skill.visualCueRules;

    // 3. Extract open-world entities using SemanticEntityExtractor (pandas, dinos, money, medical terms, etc.)
    const openWorldCues = SemanticEntityExtractor.extractAnchors(segmentsToScan, {
      userPrompt: prompt,
      genre: skill.genre,
      minIntervalSeconds: 6.0,
      defaultDurationSeconds: 3.5,
    });
    visualCues.push(...openWorldCues);

    // 4. Scan timeline segments against active skill-specific rules
    let currentTimelineOffset = 0;
    const alternatingPositions: Array<"UPPER_RIGHT" | "UPPER_LEFT"> = ["UPPER_RIGHT", "UPPER_LEFT"];

    for (let i = 0; i < segmentsToScan.length; i++) {
      const seg = segmentsToScan[i];
      const text = (seg.transcriptText || seg.text || seg.transcript || (seg.words ? seg.words.map((w: any) => w.word).join(" ") : "")).toLowerCase();
      const segDuration = seg.durationSec || seg.duration || 10.0;
      let matchedInSegment = false;

      for (let rIdx = 0; rIdx < rules.length; rIdx++) {
        if (matchedInSegment) break;
        const rule = rules[rIdx];

        for (const kw of rule.keywords) {
          if (text.includes(kw.toLowerCase())) {
            const triggerTime = Number((currentTimelineOffset + Math.min(1.2, segDuration * 0.25)).toFixed(2));
            
            const lastCue = visualCues[visualCues.length - 1];
            if (!lastCue || triggerTime - lastCue.timestampSec >= 6.0) {
              const pos = alternatingPositions[visualCues.length % alternatingPositions.length];
              visualCues.push({
                id: `cue_${visualCues.length + 1}_${rule.suggestedAssetQuery}`,
                timestampSec: triggerTime,
                durationSec: rule.durationSeconds,
                category: rule.category,
                assetQuery: rule.suggestedAssetQuery,
                mood: rule.mood,
                position: pos,
                sfxType: rule.sfxType,
                spokenContextText: kw,
              });
              matchedInSegment = true;
              break;
            }
          }
        }
      }

      currentTimelineOffset += segDuration;
    }

    // Ensure we have balanced visual anchors across key narrative sections
    if (visualCues.length < 3 && rules.length >= 3) {
      if (!visualCues.some((c) => c.timestampSec < 6.0)) {
        visualCues.unshift({
          id: `cue_hook_${rules[0].suggestedAssetQuery}`,
          timestampSec: 2.5,
          durationSec: rules[0].durationSeconds,
          category: rules[0].category,
          assetQuery: rules[0].suggestedAssetQuery,
          mood: rules[0].mood,
          position: "UPPER_RIGHT",
          sfxType: rules[0].sfxType,
          spokenContextText: "Visual Hook Anchor",
        });
      }
      if (!visualCues.some((c) => c.timestampSec >= 12.0 && c.timestampSec <= 26.0)) {
        visualCues.push({
          id: `cue_warning_${rules[1].suggestedAssetQuery}`,
          timestampSec: 16.0,
          durationSec: rules[1].durationSeconds,
          category: rules[1].category,
          assetQuery: rules[1].suggestedAssetQuery,
          mood: rules[1].mood,
          position: "UPPER_LEFT",
          sfxType: rules[1].sfxType,
          spokenContextText: "Medical Warning Anchor",
        });
      }
      if (!visualCues.some((c) => c.timestampSec >= 30.0)) {
        const rule3 = rules[2] || rules[0];
        visualCues.push({
          id: `cue_mid_${rule3.suggestedAssetQuery}`,
          timestampSec: 32.0,
          durationSec: rule3.durationSeconds,
          category: rule3.category,
          assetQuery: rule3.suggestedAssetQuery,
          mood: rule3.mood,
          position: "UPPER_RIGHT",
          sfxType: rule3.sfxType,
          spokenContextText: "Therapy Illustration Anchor",
        });
      }
      if (currentTimelineOffset > 45.0 && !visualCues.some((c) => c.timestampSec >= 45.0)) {
        const docRule = rules.find((r) => r.suggestedAssetQuery === "verified_doctor_badge") || rules[rules.length - 1];
        visualCues.push({
          id: `cue_doc_${docRule.suggestedAssetQuery}`,
          timestampSec: 48.0,
          durationSec: docRule.durationSeconds,
          category: docRule.category,
          assetQuery: docRule.suggestedAssetQuery,
          mood: docRule.mood,
          position: "UPPER_LEFT",
          sfxType: docRule.sfxType,
          spokenContextText: "Doctor Authority Credibility Badge",
        });
      }
    }

    // Sort by timeline timestamp
    visualCues.sort((a, b) => a.timestampSec - b.timestampSec);

    const output: MoodClassifierOutput = {
      detectedSkillId: skill.id,
      overallMood: visualCues[0]?.mood || "CLINICAL_AUTHORITY",
      visualCues,
    };

    context.artifacts.set("active_skill", skill);
    context.artifacts.set("extracted_visual_cues", visualCues);
    context.artifacts.set("mood_classification", output);

    context.log?.(`[MoodClassifierTool] Generated ${visualCues.length} visual cue anchor(s) across timeline.`);
    return output;
  }
}
