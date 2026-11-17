/**
 * Putting a catalog template on EditIR captions (captions v2, Phase 6): the final spec (template + allowed overrides
 * + the creator's own hand-set fields) is stored as `styleV2`, and the flat v1 fields are written from it.
 */
import type { CaptionSegment, EditIR } from "./edit-ir.schema";
import { applyCaptionOverrides, fontForText, scriptOf, type CaptionOverrides, type CaptionStyleV2, type EditableField } from "./caption-style-v2";
import { captionTemplateLook, mobileCaptionStyleFromV2, type CaptionTemplate } from "./caption-templates";
import { snapshotOf, userOwnedFields, changedFields, USER_STYLE_FIELDS, type UserStyleField } from "./caption-provenance";
import { validateCaptionEmphasis, type EmphasisPick } from "./caption-emphasis";
import { RationalTimeMath } from "./time";

type CaptionStyle = CaptionSegment["style"];

const BASIC_PRESET_TEMPLATE_FONT: Record<string, string> = { HORMOZI_BOUNCE: "Anton", ALI_ABDAAL_CLEAN: "Poppins" };

/** The fields the creator owns on a caption (field-level provenance). */
export function ownedFieldsOfCaption(cap: CaptionSegment): UserStyleField[] {
  if (cap.role === "title") return [];
  // Two old template ids are also the EditIR's basic preset values (where the classic look stores its default): they
  // name the template only when the caption has that template's font.
  const basic = cap.style.preset as string | undefined;
  const label = cap.style.presetLabel ?? (basic && BASIC_PRESET_TEMPLATE_FONT[basic] === cap.style.fontFamily ? basic : undefined);
  return userOwnedFields(cap.style, captionTemplateLook(label));
}

/** The creator's hand-set values as v2 overrides (only the owned fields not already given by `explicit`). */
function overridesFromOwned(style: CaptionStyle, owned: UserStyleField[], explicit: CaptionOverrides): CaptionOverrides {
  const o: CaptionOverrides = {};
  const colors: NonNullable<CaptionOverrides["colors"]> = {};
  const hex6 = (c?: string) => (c && /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(c) ? c : undefined);
  for (const f of owned) {
    switch (f) {
      case "textColor": if (!explicit.colors?.text && hex6(style.textColor)) colors.text = style.textColor; break;
      case "highlightColor": if (!explicit.colors?.active && hex6(style.highlightColor)) colors.active = style.highlightColor; break;
      case "strokeColor": if (!explicit.colors?.stroke && hex6(style.strokeColor)) colors.stroke = style.strokeColor; break;
      case "background": if (!explicit.colors?.background && hex6(style.pillBackground)) colors.background = style.pillBackground!.slice(0, 7); break;
      case "sizePx": if (explicit.sizePx === undefined && style.fontSize) o.sizePx = Math.min(400, Math.max(8, style.fontSize)); break;
      case "position": if (!explicit.position && style.position) o.position = { preset: "custom", x: Math.min(1, Math.max(0, style.position.x)), y: Math.min(1, Math.max(0, style.position.y)) }; break;
      case "uppercase": if (!explicit.case) o.case = style.uppercase ? "upper" : "none"; break;
    }
  }
  if (Object.keys(colors).length) o.colors = colors;
  return o;
}

/** Flat EditIR caption style fields for a spec. */
export function flatStyleFromSpec(spec: CaptionStyleV2, templateId: string, text: string): Partial<CaptionStyle> {
  const m = mobileCaptionStyleFromV2(spec, templateId) as any;
  return {
    presetLabel: templateId,
    fontFamily: fontForText(spec.typography.fonts, text),
    fontWeight: m.fontWeight,
    fontSize: m.fontSizePx,
    textColor: m.textColor,
    highlightColor: m.highlightColor,
    strokeWidth: m.strokeWidthPx,
    strokeColor: m.strokeColor,
    shadow: m.shadow,
    uppercase: m.uppercase,
    animation: m.animation,
    glow: !!m.glow,
    pillBackground: m.background?.color,
    pillPadding: m.background?.paddingPx,
    pillRadius: m.background?.radiusPx,
    position: { x: m.positionX, y: m.positionY },
    maxWidthFraction: m.maxWidthFraction,
    enter: m.enter,
    exit: m.exit,
    styleV2: spec,
  };
}

export interface ApplyTemplateResult { styled: number; rejectedFields: EditableField[]; keptUserFields: number; emphasisRejected: string[]; emphasised: number }

/**
 * Applies `tpl` to the speech captions `ids` (default: all). `owned` = the fields each caption's creator owns, computed
 * on the timeline before this turn. Overrides of locked fields are refused (reported once).
 */
export function applyTemplateToCaptions(
  editIR: EditIR,
  tpl: CaptionTemplate,
  opts: { overrides?: CaptionOverrides; emphasis?: EmphasisPick[]; captionIds?: string[]; owned?: Map<string, UserStyleField[]> } = {}
): ApplyTemplateResult {
  const explicit = opts.overrides ?? {};
  const base = applyCaptionOverrides(tpl.styleV2, explicit);
  const targets = editIR.tracks.captionTrack.filter((c) => c.role !== "title" && (!opts.captionIds || opts.captionIds.includes(c.id)));
  let kept = 0;
  const specs = new Map<string, CaptionStyleV2>();
  for (const cap of targets) {
    const owned = opts.owned?.get(cap.id) ?? ownedFieldsOfCaption(cap);
    const mine = overridesFromOwned(cap.style, owned, explicit);
    const { spec } = Object.keys(mine).length ? applyCaptionOverrides(base.spec, mine) : base;
    if (Object.keys(mine).length) kept++;
    specs.set(cap.id, spec);
    const prevBg = cap.style.pillBackground;
    cap.style = { ...cap.style, pillBackground: undefined, pillPadding: undefined, pillRadius: undefined, enter: undefined, exit: undefined, ...flatStyleFromSpec(spec, tpl.id, cap.text) };
    // A background the creator removed by hand stays removed; one they added on a template without a box stays.
    if (owned.includes("background") && !explicit.colors?.background) {
      cap.style.pillBackground = prevBg;
      if (!prevBg) { delete cap.style.pillPadding; delete cap.style.pillRadius; }
    }
    if (owned.includes("uppercase") && !explicit.case && !tpl.editable.includes("case")) cap.style.uppercase = spec.typography.case === "upper";
    // The same keys the phone writes: the template id and the light changes on top of it.
    const accepted: CaptionOverrides = Object.fromEntries(Object.entries(explicit).filter(([k]) => !base.rejected.includes(k as EditableField)));
    const overrides: CaptionOverrides = { ...accepted, ...mine, ...(accepted.colors || mine.colors ? { colors: { ...(accepted.colors ?? {}), ...(mine.colors ?? {}) } } : {}) };
    cap.style.captionTemplate = tpl.id;
    if (Object.keys(overrides).length) cap.style.captionOverrides = overrides;
    else delete cap.style.captionOverrides;
    for (const k of Object.keys(cap.style) as Array<keyof CaptionStyle>) if (cap.style[k] === undefined) delete cap.style[k];
    for (const w of cap.words) {
      if (w.highlight) w.color = cap.style.highlightColor;
      else delete w.color;
      w.scaleMultiplier = cap.style.animation === "word_pop" ? Math.max(1, spec.words.active.scale) : 1.0;
    }
  }
  // AI-chosen emphasis: validated against the captions' own words.
  let emphasised = 0;
  let emphasisRejected: string[] = [];
  if (opts.emphasis?.length) {
    const sec = (t: any) => RationalTimeMath.toSeconds(t);
    const language = targets.some((c) => scriptOf(c.text) === "devanagari") ? "hi" : undefined;
    const { accepted, rejected } = validateCaptionEmphasis(
      opts.emphasis,
      targets.map((c) => ({ id: c.id, startSec: sec(c.timeRange.start), words: c.words.map((w) => ({ word: w.word, startSec: sec(w.start), endSec: sec(w.end) })) })),
      language
    );
    emphasisRejected = rejected;
    for (const a of accepted) {
      const cap = targets.find((c) => c.id === a.captionId)!;
      const spec = specs.get(cap.id)!;
      cap.words.forEach((w, i) => {
        if (i === a.wordIndex) {
          w.highlight = true;
          w.color = spec.emphasis.colors[a.role];
          w.scaleMultiplier = Math.max(1, spec.words.emphasis.scale);
        } else if (w.highlight) {
          w.highlight = false;
          delete w.color;
        }
      });
      emphasised++;
    }
  }
  return { styled: targets.length, rejectedFields: base.rejected, keptUserFields: kept, emphasisRejected, emphasised };
}

/**
 * After a turn: every speech caption whose look changed records what the Director wrote (`templateApplied`), and
 * keeps in `userEdited` the creator's fields this turn did not overwrite.
 */
export function refreshCaptionProvenance(before: EditIR, after: EditIR) {
  const prev = new Map(before.tracks.captionTrack.map((c) => [c.id, c]));
  for (const cap of after.tracks.captionTrack) {
    if (cap.role === "title") continue;
    const old = prev.get(cap.id);
    if (old && JSON.stringify(old.style) === JSON.stringify(cap.style)) continue;
    if (!old && !cap.style.presetLabel && !cap.style.styleV2) continue;
    let userEdited: UserStyleField[] = [];
    if (old) {
      const owned = ownedFieldsOfCaption(old);
      const changed = new Set(changedFields(cap.style, snapshotOf(old.style)));
      userEdited = owned.filter((f) => !changed.has(f));
    }
    cap.style.templateApplied = snapshotOf(cap.style, cap.style.presetLabel);
    if (userEdited.length) cap.style.userEdited = USER_STYLE_FIELDS.filter((f) => userEdited.includes(f));
    else delete cap.style.userEdited;
  }
}
