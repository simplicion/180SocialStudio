import { z } from "zod";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import { MultiTakeTranscriber, ClipTranscriptionResult } from "../../intelligence/multi-take-transcriber";

export const SpeechTranscribeInputSchema = z.object({
  filePaths: z.array(z.string()),
  language: z.string().optional().default("hi"),
});

export type SpeechTranscribeInput = z.infer<typeof SpeechTranscribeInputSchema>;

export class SpeechTranscribeTool extends VideoDirectorTool<SpeechTranscribeInput, ClipTranscriptionResult[]> {
  readonly name = "speech_transcribe";
  readonly description = "Extracts 16kHz audio and transcribes speech tokens with word-level timestamps using Groq/OpenAI Whisper or the inbuilt local acoustic engine";
  readonly stage = "INGESTION_AND_TELEMETRY" as const;
  readonly inputSchema = SpeechTranscribeInputSchema;

  async execute(input: SpeechTranscribeInput, context: DirectorExecutionContext): Promise<ClipTranscriptionResult[]> {
    let files = input.filePaths || [];
    if (files.length === 0) {
      const voiceover: any = context.artifacts.get("synthesized_voiceover");
      if (voiceover?.voiceoverPath) {
        files = [voiceover.voiceoverPath];
      }
    }

    context.log?.(`Transcribing speech across ${files.length} media file(s)...`);
    const results = await MultiTakeTranscriber.transcribeAllClips(files, context.tempDir);
    context.artifacts.set("transcriptions", results);
    context.onProgress?.(100, `Transcribed ${results.length} clip(s)`);
    return results;
  }
}
