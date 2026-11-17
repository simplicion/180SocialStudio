/**
 * Field-level provenance of a caption's look (captions v2, Phase 6.4).
 *
 * When the Director styles a caption it records what it wrote (`templateApplied`: a snapshot of the editable flat
 * fields). A later turn compares the caption's current fields with that snapshot: a field that differs was changed
 * by the creator by hand. `userEdited` keeps that knowledge across turns (and a client may set it directly when the
 * creator edits). A later template change keeps the creator's fields.
 */
import { z } from "zod";

/** The flat style fields the creator changes by hand, in canonical (EditIR caption style) terms. */
export const USER_STYLE_FIELDS = ["textColor", "highlightColor", "strokeColor", "background", "sizePx", "position", "uppercase"] as const;
export type UserStyleField = (typeof USER_STYLE_FIELDS)[number];

export const TemplateAppliedSchema = z.object({
  templateId: z.string().max(64).optional(),
  textColor: z.string().optional(),
  highlightColor: z.string().optional(),
  strokeColor: z.string().optional(),
  background: z.string().nullable().optional(),
  sizePx: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  uppercase: z.boolean().optional(),
});
export type TemplateApplied = z.infer<typeof TemplateAppliedSchema>;
export const UserEditedSchema = z.array(z.enum(USER_STYLE_FIELDS)).max(USER_STYLE_FIELDS.length);

/** The fields of an EditIR caption style the provenance looks at. */
export interface ProvenanceStyle {
  textColor?: string;
  highlightColor?: string;
  strokeColor?: string;
  pillBackground?: string;
  fontSize?: number;
  position?: { x?: number; y?: number };
  uppercase?: boolean;
  templateApplied?: TemplateApplied;
  userEdited?: UserStyleField[];
}

const up = (c?: string | null) => (c ? c.toUpperCase() : c ?? null);

/** What the Director wrote, as a snapshot. */
export function snapshotOf(style: ProvenanceStyle, templateId?: string): TemplateApplied {
  return {
    ...(templateId ? { templateId } : {}),
    textColor: up(style.textColor) ?? undefined,
    highlightColor: up(style.highlightColor) ?? undefined,
    strokeColor: up(style.strokeColor) ?? undefined,
    background: up(style.pillBackground),
    sizePx: style.fontSize,
    x: style.position?.x,
    y: style.position?.y,
    uppercase: !!style.uppercase,
  };
}

/** Which fields of `style` differ from a snapshot. */
export function changedFields(style: ProvenanceStyle, snap: TemplateApplied): UserStyleField[] {
  const now = snapshotOf(style);
  const out: UserStyleField[] = [];
  const near = (a?: number, b?: number) => a === undefined || b === undefined || Math.abs(a - b) < 1e-3;
  if (snap.textColor !== undefined && now.textColor !== snap.textColor) out.push("textColor");
  if (snap.highlightColor !== undefined && now.highlightColor !== snap.highlightColor) out.push("highlightColor");
  if (snap.strokeColor !== undefined && now.strokeColor !== snap.strokeColor) out.push("strokeColor");
  if (snap.background !== undefined && (now.background ?? null) !== (snap.background ?? null)) out.push("background");
  if (!near(now.sizePx, snap.sizePx)) out.push("sizePx");
  if (!near(now.x, snap.x) || !near(now.y, snap.y)) out.push("position");
  if (snap.uppercase !== undefined && now.uppercase !== snap.uppercase) out.push("uppercase");
  return out;
}

/**
 * The fields the creator owns on this caption: the recorded ones, plus those that differ from what the Director last
 * wrote. Without a snapshot (an older project) the caption is compared with its template's own look (`templateLook`),
 * position excluded (v1 templates had no position).
 */
export function userOwnedFields(style: ProvenanceStyle, templateLook?: ProvenanceStyle | null): UserStyleField[] {
  const owned = new Set<UserStyleField>(style.userEdited ?? []);
  if (style.templateApplied) for (const f of changedFields(style, style.templateApplied)) owned.add(f);
  else if (templateLook) {
    const snap = snapshotOf(templateLook);
    for (const f of changedFields(style, { ...snap, x: undefined, y: undefined, sizePx: templateLook.fontSize })) owned.add(f);
  }
  return USER_STYLE_FIELDS.filter((f) => owned.has(f));
}
