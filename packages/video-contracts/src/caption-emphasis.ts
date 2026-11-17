/**
 * AI-chosen caption emphasis (captions v2, Phase 6): the Director may mark at most one meaningful word per caption
 * group, with a colour role. This module checks a pick against the captions' own (transcript) words.
 */
import { EMPHASIS_ROLES, type EmphasisRole } from "./caption-style-v2";

/** Words that never carry emphasis, per language (lower-case; Hinglish = Roman Hindi). */
export const CAPTION_STOP_WORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set(
    ("a an the and or but so if then than that this these those to of in on at by for with from as into onto up down out over under about is am are was were be been being " +
      "do does did have has had i me my we our you your he him his she her it its they them their what which who whom when where why how not no yes just very " +
      "really can could will would should shall may might must also too there here like um uh oh okay ok yeah gonna wanna got get").split(" ")
  ),
  hi: new Set(
    ("का की के को से में पर है हैं था थी थे हो होगा और या भी तो ही न नहीं यह वह ये वो इस उस एक कि जो मैं हम तुम आप वे क्या कैसे " +
      "ka ki ke ko se me mein par pe hai hain tha thi the ho aur ya bhi to toh hi na nahi yeh ye woh wo is us ek ki jo main mai hum tum aap kya kaise").split(" ")
  ),
  es: new Set(
    ("el la los las un una unos unas y o pero que de del a al en con por para es son era fue ser estar está están lo le les se mi tu su nos me te " +
      "no sí si muy ya como cuando donde este esta eso esto").split(" ")
  ),
};

const norm = (w: string) => w.toLocaleLowerCase().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");

/** True for a word that must not be emphasised in any of the languages (or that has no letters / digits). */
export function isCaptionStopWord(word: string, language?: string): boolean {
  const w = norm(word);
  if (!w || !/[\p{L}\p{N}]/u.test(w)) return true;
  const langs = language && CAPTION_STOP_WORDS[language] ? [language, "en"] : Object.keys(CAPTION_STOP_WORDS);
  return langs.some((l) => CAPTION_STOP_WORDS[l].has(w));
}

export interface EmphasisPick {
  captionId?: string;
  /** Index in the caption (with captionId) or across all speech captions in timeline order (without). */
  wordIndex?: number;
  /** The word's text (with `atSec` to find it when the same word appears more than once). */
  word?: string;
  atSec?: number;
  role?: EmphasisRole;
}

export interface EmphasisCaption { id: string; startSec: number; words: Array<{ word: string; startSec: number; endSec: number }> }

export interface ResolvedEmphasis { captionId: string; wordIndex: number; role: EmphasisRole }

/**
 * Finds each pick's word and checks it: it exists in the captions, is not a stop word, has a valid role, and is the
 * only pick in its caption group. Returns the accepted picks and one reason per rejected pick.
 */
export function validateCaptionEmphasis(picks: EmphasisPick[], captions: EmphasisCaption[], language?: string): { accepted: ResolvedEmphasis[]; rejected: string[] } {
  const accepted: ResolvedEmphasis[] = [];
  const rejected: string[] = [];
  const flat = captions.flatMap((c) => c.words.map((w, i) => ({ c, i, w })));
  const used = new Set<string>();
  picks.forEach((p, n) => {
    const label = `emphasis #${n}${p.word ? ` "${p.word}"` : ""}`;
    const role = p.role ?? "emphasis";
    if (!(EMPHASIS_ROLES as readonly string[]).includes(role)) {
      rejected.push(`${label}: role must be one of ${EMPHASIS_ROLES.join(", ")}`);
      return;
    }
    let hit: { c: EmphasisCaption; i: number; w: { word: string; startSec: number; endSec: number } } | undefined;
    if (p.captionId !== undefined) {
      const c = captions.find((x) => x.id === p.captionId);
      if (!c) return void rejected.push(`${label}: no caption ${p.captionId}`);
      if (p.wordIndex !== undefined) hit = c.words[p.wordIndex] ? { c, i: p.wordIndex, w: c.words[p.wordIndex] } : undefined;
      else if (p.word) {
        const i = c.words.findIndex((w) => norm(w.word) === norm(p.word!));
        hit = i >= 0 ? { c, i, w: c.words[i] } : undefined;
      }
    } else if (p.wordIndex !== undefined && !p.word) {
      hit = flat[p.wordIndex];
    } else if (p.word) {
      const matches = flat.filter((x) => norm(x.w.word) === norm(p.word!));
      hit = p.atSec !== undefined ? matches.sort((a, b) => Math.abs(a.w.startSec - p.atSec!) - Math.abs(b.w.startSec - p.atSec!))[0] : matches[0];
      if (hit && p.atSec !== undefined && Math.abs(hit.w.startSec - p.atSec) > 1.5) hit = undefined;
    }
    if (!hit) return void rejected.push(`${label}: that word is not in the captions`);
    if (p.word && norm(p.word) !== norm(hit.w.word)) return void rejected.push(`${label}: word ${hit.i} of caption ${hit.c.id} is "${hit.w.word}"`);
    if (isCaptionStopWord(hit.w.word, language)) return void rejected.push(`${label}: "${hit.w.word}" is a stop word, emphasise a meaningful word`);
    if (used.has(hit.c.id)) return void rejected.push(`${label}: caption ${hit.c.id} already has an emphasised word (at most one per caption)`);
    used.add(hit.c.id);
    accepted.push({ captionId: hit.c.id, wordIndex: hit.i, role });
  });
  return { accepted, rejected };
}
