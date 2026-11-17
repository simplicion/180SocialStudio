/**
 * Generates the phone's caption template data from the one catalog (packages/video-contracts/src/caption-templates.ts).
 *
 *   npx tsx scripts/gen-caption-catalog.ts          write apps/social-studio-mobile/lib/features/studio/caption_catalog.g.dart
 *   npx tsx scripts/gen-caption-catalog.ts --check  exit 1 when the file is stale
 *
 * packages/video-contracts/tests/caption-catalog-dart.test.ts fails when the generated file is out of date.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CAPTION_TEMPLATES, LEGACY_CAPTION_TEMPLATE_IDS, mobileCaptionStyleFromV2 } from "../packages/video-contracts/src/caption-templates";

export const CAPTION_CATALOG_DART_PATH = resolve(__dirname, "../apps/social-studio-mobile/lib/features/studio/caption_catalog.g.dart");

const str = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$").replace(/\n/g, "\\n")}'`;
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(n));
const dbl = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

/** A JSON value as a Dart const literal (maps are Map<String, dynamic>, lists List<dynamic>). */
function dart(v: unknown, indent: string): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return str(v);
  if (typeof v === "number") return num(v);
  if (typeof v === "boolean") return String(v);
  const inner = indent + "  ";
  if (Array.isArray(v)) {
    if (v.length === 0) return "<dynamic>[]";
    if (v.every((x) => typeof x !== "object" || x === null)) return `<dynamic>[${v.map((x) => dart(x, inner)).join(", ")}]`;
    return `<dynamic>[\n${v.map((x) => `${inner}${dart(x, inner)},`).join("\n")}\n${indent}]`;
  }
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
  if (entries.length === 0) return "<String, dynamic>{}";
  return `<String, dynamic>{\n${entries.map(([k, x]) => `${inner}${str(k)}: ${dart(x, inner)},`).join("\n")}\n${indent}}`;
}
const strings = (xs: readonly string[]) => `<String>[${xs.map(str).join(", ")}]`;

export function renderCaptionCatalogDart(): string {
  const out: string[] = [
    "// GENERATED FILE - DO NOT EDIT.",
    "// Source: packages/video-contracts/src/caption-templates.ts",
    "// Regenerate: npx tsx scripts/gen-caption-catalog.ts",
    "// ignore_for_file: prefer_single_quotes, lines_longer_than_80_chars",
    "",
    "part of 'caption_catalog.dart';",
    "",
    "/// Every template, gallery order. `legacyStyle` is the flat caption style map (MobileCaptionStyle) the phone",
    "/// stores; `styleV2` the full CaptionStyleV2 spec.",
    "const List<CaptionTemplate> generatedCaptionTemplates = <CaptionTemplate>[",
  ];
  for (const t of CAPTION_TEMPLATES) {
    const { styleV2: _spec, ...flat } = mobileCaptionStyleFromV2(t.styleV2, t.id);
    const r = t.styleV2.typography.sizeRangePx!;
    out.push(
      "  CaptionTemplate(",
      `    id: ${str(t.id)},`,
      `    name: ${str(t.name)},`,
      `    description: ${str(t.description)},`,
      `    bestFor: ${strings(t.bestFor)},`,
      `    energy: ${t.energy},`,
      `    editable: ${strings(t.editable)},`,
      `    sizeRangePx: (min: ${dbl(r.min)}, max: ${dbl(r.max)}),`,
      `    styleV2: ${dart(t.styleV2, "    ")},`,
      `    legacyStyle: ${dart(flat, "    ")},`,
      `    legacyIds: ${strings(t.legacyIds)},`,
      "  ),"
    );
  }
  out.push("];", "", "/// Old template id -> current id (projects saved before captions v2).");
  out.push("const Map<String, String> generatedLegacyCaptionIds = <String, String>{");
  for (const [k, v] of Object.entries(LEGACY_CAPTION_TEMPLATE_IDS)) out.push(`  ${str(k)}: ${str(v)},`);
  out.push("};", "");
  return out.join("\n");
}

if (require.main === module) {
  const text = renderCaptionCatalogDart();
  if (process.argv.includes("--check")) {
    const cur = (() => { try { return readFileSync(CAPTION_CATALOG_DART_PATH, "utf8").replace(/\r\n/g, "\n"); } catch { return ""; } })();
    if (cur !== text) {
      console.error(`${join("apps/social-studio-mobile/lib/features/studio", "caption_catalog.g.dart")} is stale: run npx tsx scripts/gen-caption-catalog.ts`);
      process.exit(1);
    }
    console.log("caption_catalog.g.dart is up to date");
  } else {
    writeFileSync(CAPTION_CATALOG_DART_PATH, text);
    console.log(`wrote ${CAPTION_CATALOG_DART_PATH} (${CAPTION_TEMPLATES.length} templates)`);
  }
}
