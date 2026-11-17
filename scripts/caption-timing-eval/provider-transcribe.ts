/**
 * Transcribes every eval clip with the production STT provider (the backend's own code path, no fallback to another
 * provider) and writes {clipId: TranscriptionResponse} for run_eval.py --source provider-json.
 *
 *   OPENAI_API_KEY=... npx tsx scripts/caption-timing-eval/provider-transcribe.ts openai results/provider-openai.json
 *   GROQ_API_KEY=...   npx tsx scripts/caption-timing-eval/provider-transcribe.ts groq   results/provider-groq.json
 *
 * Costs money (paid API): about 2 minutes of audio per run. The clip's language is passed, as the app does when it knows it.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { transcribeWithProvider, type SttProvider } from "../../apps/180-social-studio-backend/src/api/v1/media-editor/media-transcription";

const MIME: Record<string, string> = { flac: "audio/flac", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" };

async function main() {
  const [provider, out] = process.argv.slice(2) as [SttProvider, string];
  if (!provider || !out) throw new Error("usage: provider-transcribe.ts <groq|openai> <out.json>");
  const fixtures = join(__dirname, "fixtures");
  const manifest = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8"));
  const creds = { groqKey: process.env.GROQ_API_KEY, openaiKey: process.env.OPENAI_API_KEY };
  const result: Record<string, unknown> = {};
  for (const clip of manifest.clips) {
    const audio = readFileSync(join(fixtures, clip.audio));
    const ext = String(clip.audio).split(".").pop()!.toLowerCase();
    const r = await transcribeWithProvider(provider, creds, audio, String(clip.audio).split("/").pop()!, MIME[ext] ?? "audio/mpeg", clip.language);
    if (!r) throw new Error(`${provider} returned nothing for ${clip.id} (key missing, no credits, or no word timings)`);
    result[clip.id] = r;
    console.error(`${clip.id}: ${r.words.length} words`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 1));
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
