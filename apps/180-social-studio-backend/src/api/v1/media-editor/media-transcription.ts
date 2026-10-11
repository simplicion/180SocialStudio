import type { Request, Response, NextFunction } from "express";
import multer from "multer";

/**
 * Mobile transcription: the phone uploads the clip's AUDIO ONLY (m4a/wav/...), and we return
 * word-level timestamps from Whisper large-v3 (open-source model) on Groq, with OpenAI Whisper as the
 * fallback. Whisper also detects the spoken language. The order can be changed with STT_PROVIDER_ORDER.
 * The spoken language is detected by the provider unless the caller names one.
 * Cartesia STT is NOT used here — it is reserved exclusively for Voiceforce telephony.
 * Contract: docs/social-studio-mobile/AI_DIRECTOR_CONTRACT.md §1
 */

export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

export const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mpeg",
  "audio/mp3",
  "audio/webm",
  "audio/ogg",
]);

export class TranscriptionUnavailableError extends Error {}
export class TranscriptionFailedError extends Error {}

export interface WordTimestamp {
  text: string;
  startMs: number;
  endMs: number;
}

export const STT_PROVIDERS = ["groq", "openai"] as const;
export type SttProvider = (typeof STT_PROVIDERS)[number];

export interface TranscriptionResponse {
  language: string;
  durationMs: number;
  text: string;
  words: WordTimestamp[];
  /** The provider that produced this transcript. */
  provider?: SttProvider;
}

export interface SttCredentials {
  groqKey?: string;
  openaiKey?: string;
}

/** Let the provider detect the spoken language. */
export const AUTO_LANGUAGE = "auto";

/** Whisper reports the detected language by English name; the contract returns ISO-639-1. */
const WHISPER_LANGUAGE_CODES: Record<string, string> = {
  afrikaans: "af", albanian: "sq", amharic: "am", arabic: "ar", armenian: "hy", assamese: "as", azerbaijani: "az",
  bashkir: "ba", basque: "eu", belarusian: "be", bengali: "bn", bosnian: "bs", breton: "br", bulgarian: "bg",
  burmese: "my", cantonese: "yue", castilian: "es", catalan: "ca", chinese: "zh", croatian: "hr", czech: "cs",
  danish: "da", dutch: "nl", english: "en", estonian: "et", faroese: "fo", finnish: "fi", flemish: "nl",
  french: "fr", galician: "gl", georgian: "ka", german: "de", greek: "el", gujarati: "gu", haitian: "ht",
  "haitian creole": "ht", hausa: "ha", hawaiian: "haw", hebrew: "he", hindi: "hi", hungarian: "hu",
  icelandic: "is", indonesian: "id", italian: "it", japanese: "ja", javanese: "jw", kannada: "kn", kazakh: "kk",
  khmer: "km", korean: "ko", lao: "lo", latin: "la", latvian: "lv", lingala: "ln", lithuanian: "lt",
  luxembourgish: "lb", macedonian: "mk", malagasy: "mg", malay: "ms", malayalam: "ml", maltese: "mt",
  mandarin: "zh", maori: "mi", marathi: "mr", moldavian: "ro", moldovan: "ro", mongolian: "mn", myanmar: "my",
  nepali: "ne", norwegian: "no", nynorsk: "nn", occitan: "oc", panjabi: "pa", pashto: "ps", persian: "fa",
  polish: "pl", portuguese: "pt", punjabi: "pa", pushto: "ps", romanian: "ro", russian: "ru", sanskrit: "sa",
  serbian: "sr", shona: "sn", sindhi: "sd", sinhala: "si", sinhalese: "si", slovak: "sk", slovenian: "sl",
  somali: "so", spanish: "es", sundanese: "su", swahili: "sw", swedish: "sv", tagalog: "tl", tajik: "tg",
  tamil: "ta", tatar: "tt", telugu: "te", thai: "th", tibetan: "bo", turkish: "tr", turkmen: "tk",
  ukrainian: "uk", urdu: "ur", uzbek: "uz", valencian: "ca", vietnamese: "vi", welsh: "cy", yiddish: "yi",
  yoruba: "yo",
};

/**
 * Request language: a two-letter code, or AUTO_LANGUAGE when the caller sent nothing usable
 * (region suffixes such as "hi-IN" are dropped: Whisper takes the base code only).
 */
export function normalizeRequestLanguage(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const m = /^([a-z]{2})(-[a-z]{2})?$/.exec(v);
  return m ? m[1] : AUTO_LANGUAGE;
}

/**
 * ISO code of the language the provider reported. Falls back to the requested code; "und" when
 * detection was asked for and the provider named nothing we know.
 */
export function resolveDetectedLanguage(reported: unknown, requested: string): string {
  const v = typeof reported === "string" ? reported.trim().toLowerCase() : "";
  if (WHISPER_LANGUAGE_CODES[v]) return WHISPER_LANGUAGE_CODES[v];
  if (/^[a-z]{2,3}$/.test(v)) return v;
  return requested === AUTO_LANGUAGE ? "und" : requested;
}

const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions";

/** Throws when no STT key is configured; never falls back to a literal. */
export function requireSttCredentials(override?: SttCredentials): SttCredentials {
  const groqKey = override?.groqKey || process.env.GROQ_API_KEY;
  const openaiKey = override?.openaiKey || process.env.OPENAI_API_KEY;
  if (!groqKey && !openaiKey) {
    throw new TranscriptionUnavailableError("No STT key configured on server (set GROQ_API_KEY or OPENAI_API_KEY).");
  }
  return { groqKey, openaiKey };
}

/**
 * Providers to try, in order, limited to those with a key. STT_PROVIDER_ORDER (comma list, e.g.
 * "openai,groq") overrides the default groq → openai.
 */
export function sttProviderOrder(creds: SttCredentials, envOrder: string | undefined = process.env.STT_PROVIDER_ORDER): SttProvider[] {
  const asked = (envOrder || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x): x is SttProvider => (STT_PROVIDERS as readonly string[]).includes(x));
  const order = asked.length ? Array.from(new Set(asked)) : [...STT_PROVIDERS];
  const has: Record<SttProvider, boolean> = { groq: !!creds.groqKey, openai: !!creds.openaiKey };
  return order.filter((p) => has[p]);
}

interface SttCall {
  audio: Buffer;
  filename: string;
  mimeType: string;
  language: string;
  fetchImpl: typeof fetch;
}

const toResult = (provider: SttProvider, c: SttCall, text: string, words: WordTimestamp[], reportedLanguage: unknown, durationSec: unknown): TranscriptionResponse | null => {
  // Text without word timings is unusable for captions: let the next provider try.
  if (words.length === 0 && text) return null;
  const dur = typeof durationSec === "number" ? durationSec : words.length ? words[words.length - 1].endMs / 1000 : 0;
  return { language: resolveDetectedLanguage(reportedLanguage, c.language), durationMs: Math.round(dur * 1000), text, words, provider };
};

/** Groq / OpenAI Whisper (same API shape). */
async function whisperTranscribe(provider: "groq" | "openai", key: string, c: SttCall): Promise<TranscriptionResponse | null> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(c.audio)], { type: c.mimeType }), c.filename || "audio.wav");
  // Groq: turbo is tuned for English; detection and other languages need the full model.
  form.append("model", provider === "openai" ? "whisper-1" : c.language === "en" ? "whisper-large-v3-turbo" : "whisper-large-v3");
  if (c.language !== AUTO_LANGUAGE) form.append("language", c.language);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  const res = await c.fetchImpl(provider === "groq" ? GROQ_STT_URL : OPENAI_STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(provider === "groq" ? 30_000 : 60_000),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.warn(`[Transcribe] ${provider} Whisper error status ${res.status}:`, errBody.slice(0, 200));
    return null;
  }
  const data: any = await res.json();
  const rawWords: any[] = Array.isArray(data?.words) ? data.words : [];
  const words: WordTimestamp[] = rawWords
    .filter((w) => typeof w?.word === "string" && typeof w?.start === "number" && typeof w?.end === "number")
    .map((w) => ({
      text: String(w.word).trim(),
      startMs: Math.max(0, Math.round(w.start * 1000)),
      endMs: Math.max(0, Math.round(w.end * 1000)),
    }))
    .filter((w) => w.text.length > 0 && w.endMs >= w.startMs);
  const text: string = typeof data?.text === "string" ? data.text.trim() : "";
  return toResult(provider, c, text, words, data?.language, data?.duration);
}

/** One provider, no fallback (used by the bake-off). Null when it failed or returned no word timings. */
export async function transcribeWithProvider(
  provider: SttProvider,
  creds: SttCredentials,
  audio: Buffer,
  filename: string,
  mimeType: string,
  language = AUTO_LANGUAGE,
  fetchImpl: typeof fetch = fetch
): Promise<TranscriptionResponse | null> {
  const call: SttCall = { audio, filename, mimeType, language, fetchImpl };
  const key = provider === "groq" ? creds.groqKey : creds.openaiKey;
  if (!key) return null;
  try {
    return await whisperTranscribe(provider, key, call);
  } catch (err: any) {
    console.warn(`[Transcribe] ${provider} notice:`, err?.message || err);
    return null;
  }
}

/**
 * Sends audio to the configured STT providers in order and returns the first transcript with word timestamps.
 * Throws TranscriptionFailedError when every provider fails or returns no word timings.
 */
export async function transcribeAudioBuffer(
  audio: Buffer,
  filename: string,
  mimeType: string,
  language = AUTO_LANGUAGE,
  fetchImpl: typeof fetch = fetch,
  credentialsOverride?: SttCredentials
): Promise<TranscriptionResponse> {
  const creds = requireSttCredentials(credentialsOverride);
  for (const provider of sttProviderOrder(creds)) {
    const result = await transcribeWithProvider(provider, creds, audio, filename, mimeType, language, fetchImpl);
    if (result) return result;
  }
  throw new TranscriptionFailedError("Speech-to-text did not succeed with any configured provider.");
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_TRANSCRIBE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_AUDIO_MIME_TYPES.has((file.mimetype || "").toLowerCase())) return cb(null, true);
    const err: any = new Error(`Unsupported audio type ${file.mimetype}`);
    err.code = "UNSUPPORTED_AUDIO_TYPE";
    cb(err);
  },
});

/** multer wrapper that maps upload errors to the contract's error codes. */
export function audioUpload(req: Request, res: Response, next: NextFunction) {
  upload.single("audio")(req, res, (err: any) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ success: false, error: "AUDIO_TOO_LARGE", message: `Audio must be ${MAX_TRANSCRIBE_BYTES / (1024 * 1024)} MB or smaller.` });
    }
    if (err.code === "UNSUPPORTED_AUDIO_TYPE") {
      return res.status(415).json({ success: false, error: "UNSUPPORTED_AUDIO_TYPE", message: err.message });
    }
    return res.status(400).json({ success: false, error: "INVALID_UPLOAD", message: err.message });
  });
}

export async function transcribeHandler(req: Request, res: Response) {
  const file = (req as any).file as { buffer: Buffer; originalname: string; mimetype: string } | undefined;
  if (!file) {
    return res.status(400).json({ success: false, error: "AUDIO_FILE_REQUIRED", message: "Upload the clip audio as multipart field 'audio'." });
  }
  const language = normalizeRequestLanguage(req.body?.language);

  // Resolve STT keys directly from the Super Admin Panel AI Vault / Company Settings
  let resolvedOpenaiKey: string | undefined = process.env.OPENAI_API_KEY;
  let resolvedGroqKey: string | undefined = process.env.GROQ_API_KEY;
  try {
    const { PlatformAiVaultService, AICompanyConfigService } = require("@workspace/ai");
    const companyId = (req as any).user?.companyId || (req as any).companyId;
    if (companyId) {
      const { settings } = await AICompanyConfigService.getCompanyAISettings(companyId);
      if (settings?.openaiKey) resolvedOpenaiKey = settings.openaiKey;
      if (settings?.groqKey) resolvedGroqKey = settings.groqKey;
    }
    if (!resolvedOpenaiKey || !resolvedGroqKey) {
      const vault = await PlatformAiVaultService.getDecryptedPlatformAiSettings();
      if (!resolvedOpenaiKey && vault?.openaiKey) resolvedOpenaiKey = vault.openaiKey;
      if (!resolvedGroqKey && vault?.groqKey) resolvedGroqKey = vault.groqKey;
    }
  } catch (err: any) {
    // Non-fatal, fallback to environment keys
  }

  try {
    const data = await transcribeAudioBuffer(
      file.buffer,
      file.originalname,
      file.mimetype,
      language,
      fetch,
      { openaiKey: resolvedOpenaiKey, groqKey: resolvedGroqKey }
    );
    return res.status(200).json({ success: true, data });
  } catch (err: any) {
    if (err instanceof TranscriptionUnavailableError) {
      return res.status(503).json({ success: false, error: "TRANSCRIPTION_UNAVAILABLE", message: "Transcription is not configured on the server." });
    }
    // Provider responses and internal errors are logged, never echoed to the client.
    console.error("[Transcribe]", err?.message || err);
    if (err instanceof TranscriptionFailedError) {
      return res.status(502).json({ success: false, error: "TRANSCRIPTION_FAILED", message: "Speech-to-text failed for this clip. Please try again." });
    }
    return res.status(500).json({ success: false, error: "INTERNAL_ERROR", message: "Transcription failed" });
  }
}
