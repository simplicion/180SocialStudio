/**
 * The one place that names model IDs (AI Director quality-fix plan, Phase 1).
 *
 * Resolution order for a provider's model:
 *   Director:  AI_DIRECTOR_MODEL_<PROVIDER> → legacy AI_DIRECTOR_<PROVIDER>_MODEL → vault model → DIRECTOR_DEFAULTS
 *   Everything else: AI_MODEL_<PROVIDER> → vault model → GENERAL_DEFAULTS
 * A caller's explicit `options.model` always wins. Retired IDs found in the vault are ignored (with a warning), so an
 * old saved setting cannot silently break every call.
 *
 * Checked 2026-11-13 against the providers' model pages: Anthropic (Claude Opus 5.5 / Sonnet 5.5 current),
 * OpenAI (GPT-6 family current; gpt-4o deprecated, removed 2027-01-14), Gemini (3.x current; 1.5 and 2.0 shut down,
 * 2.5 deprecated, rerouted from 2026-12-01).
 */

export type ModelPurpose = "director" | "general";
export type ProviderName = "claude" | "openai" | "gemini" | "groq" | "custom";

/** Best edit quality: the AI Director plans every edit with the provider's most capable tool-calling model. */
export const DIRECTOR_DEFAULTS: Record<ProviderName, string> = {
  claude: "claude-opus-5-5",
  openai: "gpt-6-astra",
  gemini: "gemini-3.8-flash",
  groq: "llama-3.3-70b-versatile",
  custom: "default-model",
};

/**
 * Every other AI feature (chat, autopilot, captions ...). Claude moves from the retired 3.5 Sonnet to the current
 * Sonnet; OpenAI stays on gpt-4o (evals are baselined on it; served until 2027-01-14, then move to gpt-6-luna).
 */
export const GENERAL_DEFAULTS: Record<ProviderName, string> = {
  claude: "claude-sonnet-5-5",
  openai: "gpt-4o",
  gemini: "gemini-3.8-flash",
  groq: "llama-3.3-70b-versatile",
  custom: "default-model",
};

/** Models the providers have shut down or are about to: never used from saved settings. */
const RETIRED: RegExp[] = [
  /^claude-3(-|\.)/i,
  /^claude-(instant|2)/i,
  /^gemini-(1\.0|1\.5|2\.0)/i,
  /^gemini-pro(-vision)?$/i,
  /^gpt-3\.5/i,
  /^gpt-4(-|$)(?!o)/i,
  /^(o1|o3-mini|o4-mini)(-|$)/i,
];

export function isRetiredModel(model: string | undefined | null): boolean {
  return !!model && RETIRED.some((r) => r.test(model.trim()));
}

/** Per-provider model saved in the Super Admin vault (DecryptedPlatformAiSettings.models). */
export type VaultModels = Partial<Record<string, string>>;

const warned = new Set<string>();
function warnOnce(key: string, msg: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
}

export function normalizeProvider(p: string | undefined | null): string {
  const v = (p || "").toLowerCase().trim();
  if (v === "anthropic") return "claude";
  if (v === "google") return "gemini";
  return v;
}

/** The model a provider runs for `purpose`. */
export function resolveModel(
  provider: string,
  purpose: ModelPurpose = "general",
  opts: { vaultModels?: VaultModels; env?: NodeJS.ProcessEnv } = {}
): string {
  const env = opts.env ?? process.env;
  const p = normalizeProvider(provider) as ProviderName;
  const P = p.toUpperCase();
  const fromEnv =
    purpose === "director"
      ? env[`AI_DIRECTOR_MODEL_${P}`] || env[`AI_DIRECTOR_${P}_MODEL`]
      : env[`AI_MODEL_${P}`];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const vault = opts.vaultModels?.[p]?.trim();
  if (vault) {
    if (isRetiredModel(vault)) {
      warnOnce(`vault:${p}:${vault}`, `[model-config] the saved ${p} model "${vault}" is retired by the provider; using the current default instead. Update it in Super Admin → AI providers.`);
    } else {
      return vault;
    }
  }
  const defaults = purpose === "director" ? DIRECTOR_DEFAULTS : GENERAL_DEFAULTS;
  return defaults[p] ?? GENERAL_DEFAULTS.custom;
}

// ─── Per-model request rules ─────────────────────────────────────────────────────────────────────

/**
 * Whether the model accepts `temperature`. Current Claude models (4.6+) reject non-default sampling with a 400;
 * OpenAI reasoning models (gpt-5+, o-series) do not take it; Gemini 3+ is tuned for its default (Google advises
 * against lowering it).
 */
export function supportsTemperature(provider: string, model: string): boolean {
  const p = normalizeProvider(provider);
  const m = (model || "").toLowerCase();
  if (p === "claude") return /^claude-(3|instant|2|sonnet-4-5|haiku-4-5|opus-4-[015])/.test(m);
  if (p === "openai") return !isOpenAIReasoningModel(m);
  if (p === "gemini") return !/^gemini-([3-9]|\d\d)/.test(m);
  return true;
}

/** OpenAI models that reason (max_completion_tokens / reasoning.effort, no temperature). */
export function isOpenAIReasoningModel(model: string): boolean {
  return /^(o\d|gpt-(5|6|7|8|9)|gpt-\d\d)/i.test(model || "");
}

/** Claude models that accept the server-side refusal fallback (`fallbacks: "default"`). */
export function supportsClaudeFallbacks(model: string): boolean {
  return /^claude-(opus-5|sonnet-5-5|fable-5)/i.test(model || "");
}

/** Claude models whose thinking/effort is controlled with `output_config.effort` (adaptive thinking). */
export function supportsClaudeEffort(model: string): boolean {
  return /^claude-(opus-(4-[5-9]|5)|sonnet-(4-6|5)|haiku-5|fable|mythos)/i.test(model || "");
}

/** Output-token ceiling per model family (requests are clamped to it). */
export function maxOutputTokens(provider: string, model: string): number {
  const p = normalizeProvider(provider);
  const m = (model || "").toLowerCase();
  if (p === "claude") {
    if (/^claude-(opus-(4-[6-9]|5)|sonnet-(4-6|5)|haiku-5|fable|mythos)/.test(m)) return 128000;
    if (/^claude-(sonnet-4|opus-4|haiku-4)/.test(m)) return 64000;
    return 8192;
  }
  if (p === "gemini") return /^gemini-([2-9]|\d\d)/.test(m) ? 65536 : 8192;
  if (p === "openai") return isOpenAIReasoningModel(m) ? 128000 : 16384;
  if (p === "groq") return 32768;
  return 16384;
}

export function clampMaxTokens(provider: string, model: string, requested: number | undefined, fallback = 4096): number {
  const want = requested && requested > 0 ? Math.floor(requested) : fallback;
  return Math.min(want, maxOutputTokens(provider, model));
}

/** Human label for admin screens ("Claude · claude-opus-5-5"). */
export function modelDisplay(provider: string, model: string): string {
  const names: Record<string, string> = { claude: "Anthropic Claude", openai: "OpenAI", gemini: "Google Gemini", groq: "Groq Cloud", custom: "Custom LLM" };
  return `${names[normalizeProvider(provider)] ?? provider} · ${model}`;
}
