import type { Request, Response } from "express";
import {
  MAX_TRANSLATE_CAPTIONS,
  MAX_CAPTION_CHARS,
  CAPTION_TARGET_LANGUAGES,
  CaptionScript,
  translateCaptionLines,
} from "@workspace/video-contracts";

/**
 * Caption translation endpoint. The translation itself (prompt, validation, batching) lives in
 * `packages/video-contracts/src/caption-translation.ts`, shared with the AI Director.
 * Contract: docs/social-studio-mobile/AI_DIRECTOR_CONTRACT.md §1b
 */
export {
  MAX_TRANSLATE_CAPTIONS,
  MAX_CAPTION_CHARS,
  CAPTION_TARGET_LANGUAGES,
  CAPTION_SCRIPTS,
  CaptionTranslationFailedError,
  buildCaptionTranslationPrompt,
  parseCaptionTranslation,
  translateCaptionLines,
} from "@workspace/video-contracts";
export type { CaptionScript } from "@workspace/video-contracts";

export interface TranslateCaptionsBody {
  captions: Array<{ id: string; text: string }>;
  targetLanguage: string;
  script: CaptionScript;
}

/** Validated request body, or the reason it is invalid. */
export function parseTranslateCaptionsBody(body: any): TranslateCaptionsBody | { error: string } {
  const targetLanguage = typeof body?.targetLanguage === "string" ? body.targetLanguage.trim().toLowerCase() : "";
  if (!CAPTION_TARGET_LANGUAGES[targetLanguage]) return { error: "targetLanguage is not a supported language code" };
  const script: CaptionScript = body?.script === "roman" ? "roman" : "native";
  const raw = Array.isArray(body?.captions) ? body.captions : null;
  if (!raw || raw.length === 0) return { error: "captions must be a non-empty array" };
  if (raw.length > MAX_TRANSLATE_CAPTIONS) return { error: `at most ${MAX_TRANSLATE_CAPTIONS} captions per request` };
  const captions: TranslateCaptionsBody["captions"] = [];
  for (const c of raw) {
    const id = typeof c?.id === "string" ? c.id : "";
    const text = typeof c?.text === "string" ? c.text.replace(/\s+/g, " ").trim() : "";
    if (!id || !text) return { error: "every caption needs an id and text" };
    if (text.length > MAX_CAPTION_CHARS) return { error: `caption text is limited to ${MAX_CAPTION_CHARS} characters` };
    captions.push({ id, text });
  }
  return { captions, targetLanguage, script };
}

export async function translateCaptionsHandler(req: Request, res: Response) {
  // Only the caller's own company (verified JWT); never a body/header value.
  const companyId = (req as any).user?.companyId;
  if (!companyId) return res.status(401).json({ success: false, error: "UNAUTHENTICATED", message: "Authentication required" });

  const body = parseTranslateCaptionsBody(req.body);
  if ("error" in body) return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: body.error });

  let client: { generate: (prompt: string, options?: any) => Promise<string> } | null = null;
  try {
    const { AICompanyConfigService, AIProviderService } = require("@workspace/ai");
    const { settings } = await AICompanyConfigService.getCompanyAISettings(companyId);
    client = await AIProviderService.getInstance().getClient(settings);
  } catch (err: any) {
    console.error("[CaptionTranslate] AI settings:", err?.message || err);
  }
  if (!client) {
    return res.status(503).json({ success: false, error: "AI_NOT_CONFIGURED", message: "No AI provider is configured, so captions cannot be translated." });
  }

  try {
    const lines = await translateCaptionLines(body.captions.map((c) => c.text), body.targetLanguage, body.script, (p) => client!.generate(p));
    return res.status(200).json({
      success: true,
      data: {
        targetLanguage: body.targetLanguage,
        script: body.script,
        captions: body.captions.map((c, i) => ({ id: c.id, text: lines[i] })),
      },
    });
  } catch (err: any) {
    // Provider responses and internal errors are logged, never echoed to the client.
    console.error("[CaptionTranslate]", err?.message || err);
    return res.status(502).json({ success: false, error: "TRANSLATION_FAILED", message: "The captions could not be translated. Please try again." });
  }
}
