import { z } from "zod";
import crypto from "crypto";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import { CaptionSegment, EditIR, RationalTimeMath, TranscriptWord } from "@workspace/video-contracts";
import { CuratedTakeManifest } from "../../intelligence/semantic-take-curator";

export const KineticCaptionInputSchema = z.object({
  primaryColor: z.string().default("#FFFFFF"),
  highlightColor: z.string().default("#FFE600"),
  fontSize: z.number().default(52),
  positionYPercent: z.number().default(0.76), // 24% safe envelope for vertical 9:16
  wordsPerSegment: z.number().default(3),
});

export type KineticCaptionInput = z.infer<typeof KineticCaptionInputSchema>;

export class KineticCaptionTool extends VideoDirectorTool<KineticCaptionInput, CaptionSegment[]> {
  readonly name = "kinetic_caption_burner";
  readonly description = "Generates 3-word kinetic karaoke subtitles with neon yellow highlights within the 22% Instagram safe envelope";
  readonly stage = "ATTENTION_AND_CAPTIONING" as const;
  readonly inputSchema = KineticCaptionInputSchema;

  async execute(input: KineticCaptionInput, context: DirectorExecutionContext): Promise<CaptionSegment[]> {
    const editIR: EditIR | undefined = context.artifacts.get("editIR");
    const curated: CuratedTakeManifest | undefined = context.artifacts.get("curatedManifest");

    if (!editIR) {
      throw new Error("KineticCaptionTool: EditIR not found in execution context.");
    }

    const allTimelineWords: Array<{ word: TranscriptWord; timelineStart: number; timelineEnd: number }> = [];

    if (curated && curated.keeperSegments.length > 0) {
      let timelineSec = 0;
      for (const seg of curated.keeperSegments) {
        for (const w of seg.words) {
          const wordRelStart = Math.max(0, w.startSeconds - seg.sourceStartSec);
          const wordRelEnd = Math.max(wordRelStart + 0.15, w.endSeconds - seg.sourceStartSec);
          allTimelineWords.push({
            word: w,
            timelineStart: timelineSec + wordRelStart,
            timelineEnd: timelineSec + wordRelEnd,
          });
        }
        timelineSec += seg.durationSec;
      }
    }

    const captionTrack: CaptionSegment[] = [];
    const isVertical = editIR.meta.targetAspect === "9:16";

    if (allTimelineWords.length > 0) {
      for (let i = 0; i < allTimelineWords.length; i += input.wordsPerSegment) {
        const chunk = allTimelineWords.slice(i, i + input.wordsPerSegment);
        const startSec = chunk[0].timelineStart;
        const endSec = chunk[chunk.length - 1].timelineEnd;
        const text = chunk.map((c) => c.word.word).join(" ");

        captionTrack.push({
          id: crypto.randomUUID(),
          timeRange: {
            start: RationalTimeMath.fromSeconds(startSec),
            duration: RationalTimeMath.fromSeconds(Math.max(0.6, endSec - startSec)),
          },
          text,
          words: chunk.map((c) => ({
            word: c.word.word,
            start: RationalTimeMath.fromSeconds(c.timelineStart),
            end: RationalTimeMath.fromSeconds(c.timelineEnd),
            highlight: c.word.isEmphasis || false,
            color: c.word.isEmphasis ? input.highlightColor : input.primaryColor,
            scaleMultiplier: c.word.isEmphasis ? 1.2 : 1.0,
          })),
          style: {
            preset: "HORMOZI_BOUNCE",
            fontFamily: "Inter",
            fontSize: isVertical ? input.fontSize : 44,
            textColor: input.primaryColor,
            highlightColor: input.highlightColor,
            position: { x: 0.5, y: isVertical ? input.positionYPercent : 0.85 },
            shadow: true,
          },
        });
      }
    }

    editIR.tracks.captionTrack = captionTrack;
    context.log?.(`Generated ${captionTrack.length} kinetic caption segments with safe margin y=${input.positionYPercent}.`);
    return captionTrack;
  }
}
