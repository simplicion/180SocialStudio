/**
 * The phone's caption catalog data (caption_catalog.g.dart) is generated from caption-templates.ts and must be current.
 * Run: npx tsx --test packages/video-contracts/tests/caption-catalog-dart.test.ts
 * Fix: npx tsx scripts/gen-caption-catalog.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderCaptionCatalogDart, CAPTION_CATALOG_DART_PATH } from "../../../scripts/gen-caption-catalog";
import { CAPTION_TEMPLATES, LEGACY_CAPTION_TEMPLATE_IDS } from "../src/caption-templates";

test("caption_catalog.g.dart is up to date with caption-templates.ts", () => {
  const onDisk = readFileSync(CAPTION_CATALOG_DART_PATH, "utf8").replace(/\r\n/g, "\n");
  assert.ok(onDisk === renderCaptionCatalogDart(), "stale: run npx tsx scripts/gen-caption-catalog.ts");
});

test("the generated Dart lists every template and every legacy id", () => {
  const text = renderCaptionCatalogDart();
  for (const t of CAPTION_TEMPLATES) {
    assert.ok(text.includes(`    id: '${t.id}',`), t.id);
    assert.ok(text.includes(`    name: '${t.name.replace(/'/g, "\\'")}',`), t.name);
  }
  for (const [from, to] of Object.entries(LEGACY_CAPTION_TEMPLATE_IDS)) assert.ok(text.includes(`  '${from}': '${to}',`), from);
});
