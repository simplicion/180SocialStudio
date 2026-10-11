/**
 * Free media providers: normalizers on recorded fixtures (no network by default), licence
 * filtering and broker ranking. Live calls are opt-in: LIVE_MEDIA_TESTS=1.
 * Run: npx tsx --test --test-force-exit packages/video-engine-runtime/src/tests/free-media-providers.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import {
  normalizeLicense,
  normalizeOpenverse,
  normalizeCcMixter,
  CcMixterProvider,
  normalizeWikimedia,
  normalizeArchiveSearch,
  normalizeArchiveItem,
  normalizeJamendo,
  normalizeUnsplash,
  rankFreeMedia,
  searchFreeMedia,
  trackUnsplashDownload,
  FreeMediaItem,
} from "../tools/sourcing/free-media-providers";
import { BgmSearchTool } from "../tools/sourcing/bgm-search.tool";

const fx = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "free-media", name), "utf8"));
const allHttps = (items: FreeMediaItem[]) => items.every((i) => i.url.startsWith("https://") && i.sourcePage.startsWith("https://") && i.attribution.length > 0);

/** fetch stub: routes by URL to fixtures and records the requested URLs. */
function fakeFetch(routes: Array<[RegExp, any]>, seen: string[] = []): typeof fetch {
  return (async (input: any) => {
    const url = String(input);
    seen.push(url);
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("licence normalizer keeps CC0 / PD / BY / BY-SA and drops NC, ND, GFDL and unknown", () => {
  assert.equal(normalizeLicense("cc0")?.licenseClass, "cc0");
  assert.equal(normalizeLicense("http://creativecommons.org/publicdomain/zero/1.0/")?.license, "CC0-1.0");
  assert.equal(normalizeLicense("https://creativecommons.org/publicdomain/mark/1.0/")?.licenseClass, "pd");
  assert.equal(normalizeLicense("pdm")?.licenseClass, "pd");
  assert.equal(normalizeLicense("by", "2.0")?.license, "CC-BY-2.0");
  assert.equal(normalizeLicense("cc-by-sa-4.0")?.license, "CC-BY-SA-4.0");
  assert.equal(normalizeLicense("http://creativecommons.org/licenses/by/3.0/")?.license, "CC-BY-3.0");
  assert.equal(normalizeLicense("https://creativecommons.org/licenses/by-sa/4.0")?.creditRequired, true);
  for (const bad of ["by-nc", "by-nd", "by-nc-sa", "cc-by-nc-4.0", "https://creativecommons.org/licenses/by-nd/2.0/", "http://creativecommons.org/licenses/by-nc-sa/3.0/", "gfdl", "fal", "", null, "all rights reserved"]) {
    assert.equal(normalizeLicense(bad as any), null, `${bad} must be rejected`);
  }
});

test("Openverse images: normalized, HTTPS, attribution kept, NC entry dropped", () => {
  const items = normalizeOpenverse(fx("openverse-images.json"), { kind: "image", limit: 10 });
  assert.equal(items.length, 3);
  assert.ok(allHttps(items));
  assert.ok(!items.some((i) => i.id.includes("nc-test")));
  const first = items[0];
  assert.equal(first.provider, "openverse");
  assert.equal(first.license, "CC-BY-2.0");
  assert.equal(first.orientation, "landscape");
  assert.match(first.attribution, /Seattle city night.*Still Vision.*CC BY 2\.0/);
});

test("Openverse audio: durations converted from ms, music kind", () => {
  const items = normalizeOpenverse(fx("openverse-audio.json"), { kind: "music", limit: 10, minDurationSec: 20 });
  assert.equal(items.length, 3);
  assert.equal(items[0].durationSec, 100);
  assert.equal(items[0].kind, "music");
  assert.ok(allHttps(items));
});

test("Wikimedia Commons video: picks a phone-decodable VP9 WebM derivative, never the Theora original", () => {
  const items = normalizeWikimedia(fx("wikimedia-video.json"), { kind: "video", limit: 10 });
  assert.ok(items.length > 0);
  for (const i of items) {
    assert.match(i.url, /\.vp9\.webm$/);
    assert.ok((i.height || 0) <= 1080);
    assert.equal(i.licenseClass, "cc0");
    assert.ok(i.previewUrl?.startsWith("https://"));
  }
  assert.ok(allHttps(items));
});

test("Wikimedia Commons audio: MP3 derivative + BY-SA credit; images use the 1920px thumbnail", () => {
  const audio = normalizeWikimedia(fx("wikimedia-audio.json"), { kind: "music", limit: 10 });
  assert.ok(audio.length > 0);
  assert.ok(audio.every((i) => /\.mp3$/.test(i.url) && i.license === "CC-BY-SA-4.0" && i.creditRequired));
  assert.match(audio[0].attribution, /Jason M\. C\., Han.*Wikimedia Commons.*CC BY-SA 4\.0/);
  const images = normalizeWikimedia(fx("wikimedia-images.json"), { kind: "image", limit: 10 });
  assert.ok(images.length > 0 && images.every((i) => (i.width || 0) <= 1920));
  // A non-free file is never returned.
  const nonFree = fx("wikimedia-images.json");
  for (const p of nonFree.query.pages) p.videoinfo[0].extmetadata.NonFree = { value: "true" };
  assert.equal(normalizeWikimedia(nonFree, { kind: "image" }).length, 0);
});

test("Internet Archive: NC/ND search hits dropped, direct download URL from the metadata API", () => {
  const docs = normalizeArchiveSearch(fx("archive-search-video.json"));
  assert.deepEqual(docs.map((d) => d.identifier), ["sunset-ocean-waves"]);
  const item = normalizeArchiveItem(docs[0], fx("archive-meta-video.json"), { kind: "video" })!;
  assert.equal(item.url, "https://archive.org/download/sunset-ocean-waves/Sunset%20Ocean%20Waves.mp4");
  assert.equal(item.durationSec, 113.8);
  assert.equal(item.license, "CC0-1.0");
  assert.equal(item.orientation, "landscape");
  const aDocs = normalizeArchiveSearch(fx("archive-search-audio.json"));
  const track = normalizeArchiveItem(aDocs[0], fx("archive-meta-audio.json"), { kind: "music" })!;
  assert.match(track.url, /^https:\/\/archive\.org\/download\/jamendo-638441\/.*\.mp3$/);
  assert.equal(track.license, "CC-BY-3.0");
});

test("Jamendo: only commercial-safe CC tracks; Unsplash: hotlinked URLs, download_location and credit", () => {
  const tracks = normalizeJamendo(fx("jamendo-tracks.json"), { limit: 10 });
  assert.deepEqual(tracks.map((t) => t.license), ["CC-BY-3.0", "CC-BY-SA-4.0"]);
  assert.ok(allHttps(tracks));
  const photos = normalizeUnsplash(fx("unsplash-search.json"), { limit: 10 });
  assert.equal(photos.length, 2);
  assert.equal(photos[0].url, "https://images.unsplash.com/photo-1?ixid=M3w&w=1080");
  assert.equal(photos[0].orientation, "portrait");
  assert.equal(photos[0].downloadLocation, "https://api.unsplash.com/photos/abc123/download?ixid=M3w");
  assert.match(photos[0].attribution, /^Photo by Jane Doe .*on Unsplash/);
  assert.match(photos[0].attribution, /utm_medium=referral/);
});

test("ranking: portrait for 9:16, then licence CC0 > PD > CC BY > CC BY-SA, duration and resolution", () => {
  const base = { kind: "video" as const, title: "t", previewUrl: null, licenseUrl: null, attribution: "a", sourcePage: "https://x", provider: "wikimedia" as const, creditRequired: false };
  const mk = (id: string, o: Partial<FreeMediaItem>): FreeMediaItem => ({ ...base, id, url: `https://x/${id}`, license: "CC0-1.0", licenseClass: "cc0", durationSec: 10, width: 1080, height: 1920, orientation: "portrait", ...o });
  const items = [
    mk("landscape-cc0", { width: 1920, height: 1080, orientation: "landscape" }),
    mk("portrait-bysa", { license: "CC-BY-SA-4.0", licenseClass: "cc-by-sa" }),
    mk("portrait-cc0", {}),
    mk("portrait-by", { license: "CC-BY-4.0", licenseClass: "cc-by" }),
    mk("portrait-pd", { license: "PD", licenseClass: "pd" }),
    mk("portrait-cc0-short-lowres", { durationSec: 2, width: 360, height: 640 }),
  ];
  const ranked = rankFreeMedia(items, { targetAspect: "9:16", targetDurationSec: 5 }).map((i) => i.id);
  assert.deepEqual(ranked.filter((id) => /^portrait-(cc0|pd|by|bysa)$/.test(id)), ["portrait-cc0", "portrait-pd", "portrait-by", "portrait-bysa"]);
  assert.ok(ranked.indexOf("portrait-cc0-short-lowres") > ranked.indexOf("portrait-cc0"));
  const wide = rankFreeMedia(items, { targetAspect: "16:9" }).map((i) => i.id);
  assert.equal(wide[0], "landscape-cc0");
});

test("federated search: keyless providers queried with licence filters, key-gated ones skipped with a warning", async () => {
  const env = { ...process.env };
  delete process.env.FREE_MEDIA_PROVIDERS;
  delete process.env.UNSPLASH_ACCESS_KEY;
  delete process.env.JAMENDO_CLIENT_ID;
  try {
    const seen: string[] = [];
    const fetchImpl = fakeFetch([
      [/api\.openverse\.org\/v1\/images/, fx("openverse-images.json")],
      [/commons\.wikimedia\.org/, fx("wikimedia-images.json")],
    ], seen);
    const r = await searchFreeMedia({ query: "city night", kind: "image", limit: 5, targetAspect: "9:16", fetchImpl });
    assert.ok(r.items.length > 0 && r.items.length <= 5);
    assert.ok(r.warnings.some((w) => w.startsWith("unsplash: skipped (UNSPLASH_ACCESS_KEY is not set)")));
    assert.ok(seen.some((u) => u.includes("license_type=commercial%2Cmodification")));
    assert.ok(!seen.some((u) => u.includes("unsplash")));

    // Jamendo needs both the client id and the explicit opt-in.
    process.env.JAMENDO_CLIENT_ID = "test-id";
    process.env.FREE_MEDIA_PROVIDERS = "jamendo";
    const noOptIn = await searchFreeMedia({ query: "happy", kind: "music", fetchImpl });
    assert.equal(noOptIn.items.length, 0);
    assert.match(noOptIn.warnings.join(), /JAMENDO_ALLOW/);
    process.env.JAMENDO_ALLOW = "true";
    const jam = await searchFreeMedia({ query: "happy", kind: "music", fetchImpl: fakeFetch([[/api\.jamendo\.com/, fx("jamendo-tracks.json")]]) });
    assert.equal(jam.items.length, 2);

    // A failing provider is a warning, never an error.
    process.env.FREE_MEDIA_PROVIDERS = "openverse";
    const failed = await searchFreeMedia({ query: "x", kind: "image", fetchImpl: fakeFetch([]) });
    assert.deepEqual(failed.items, []);
    assert.match(failed.warnings.join(), /openverse: HTTP 404/);
  } finally {
    process.env = env;
  }
});

test("music search merges the catalogue with free providers and keeps credits", async () => {
  const env = { ...process.env };
  process.env.FREE_MEDIA_PROVIDERS = "openverse";
  delete process.env.FREESOUND_API_KEY;
  try {
    const r = await BgmSearchTool.searchTracks({ query: "upbeat corporate", limit: 10, fetchImpl: fakeFetch([[/api\.openverse\.org\/v1\/audio/, fx("openverse-audio.json")]]) });
    const free = r.tracks.filter((t) => t.provider === "openverse");
    assert.ok(free.length > 0);
    assert.ok(free.every((t) => t.attribution && t.license.startsWith("CC-BY") && t.url.startsWith("https://")));
    assert.ok(r.providers.includes("openverse"));
  } finally {
    process.env = env;
  }
});

test("Unsplash download tracking only accepts api.unsplash.com download URLs", async () => {
  const env = { ...process.env };
  process.env.UNSPLASH_ACCESS_KEY = "k";
  try {
    const seen: string[] = [];
    const ok = await trackUnsplashDownload("https://api.unsplash.com/photos/abc123/download?ixid=M3w", fakeFetch([[/api\.unsplash\.com/, {}]], seen));
    assert.equal(ok, true);
    assert.equal(seen.length, 1);
    await assert.rejects(trackUnsplashDownload("https://evil.example/photos/a/download"), /api\.unsplash\.com/);
  } finally {
    process.env = env;
  }
});

test("live providers (opt-in: LIVE_MEDIA_TESTS=1)", { skip: process.env.LIVE_MEDIA_TESTS !== "1" }, async () => {
  for (const kind of ["image", "video", "music"] as const) {
    const r = await searchFreeMedia({ query: kind === "music" ? "piano" : "ocean", kind, limit: 3, timeoutMs: 15000 });
    console.log(kind, r.providers, r.warnings);
    assert.ok(r.items.length > 0, `${kind}: no live results`);
    assert.ok(allHttps(r.items));
  }
});

test("ccMixter: only Attribution / public-domain mp3s get through, with duration and a credit line", () => {
  const data = [
    {
      upload_id: 1, upload_name: "The Fade Out", user_name: "coruscate", user_real_name: "Coruscate",
      license_url: "http://creativecommons.org/licenses/by/3.0/", file_page_url: "https://ccmixter.org/files/coruscate/1",
      files: [{ download_url: "https://ccmixter.org/content/c/fade.mp3", file_format_info: { mime_type: "audio/mpeg", ps: "3:05" } }],
    },
    {
      upload_id: 2, upload_name: "NC track", user_name: "x", license_url: "http://creativecommons.org/licenses/by-nc/3.0/",
      files: [{ download_url: "https://ccmixter.org/content/x/nc.mp3", file_format_info: { mime_type: "audio/mpeg", ps: "2:00" } }],
    },
    {
      upload_id: 3, upload_name: "Sampling plus", user_name: "y", license_url: "http://creativecommons.org/licenses/sampling+/1.0/",
      files: [{ download_url: "https://ccmixter.org/content/y/s.mp3", file_format_info: { mime_type: "audio/mpeg", ps: "2:00" } }],
    },
  ];
  const items = normalizeCcMixter(data, { limit: 10 });
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://ccmixter.org/content/c/fade.mp3");
  assert.equal(items[0].durationSec, 185);
  assert.equal(items[0].license, "CC-BY-3.0");
  assert.match(items[0].attribution, /"The Fade Out" by Coruscate \(ccMixter\), CC BY 3.0/);
});

test("sticker library: Fluent Emoji 3D index (default skin tone), name ranking, CDN URLs", async () => {
  const { parseFluentTree, searchStickers, resetStickerIndexForTests } = await import("../tools/sourcing/sticker-library");
  const tree = {
    tree: [
      { path: "assets/Fire/3D/fire_3d.png" },
      { path: "assets/Fire/Color/fire_color.svg" },
      { path: "assets/Fire engine/3D/fire_engine_3d.png" },
      { path: "assets/Thumbs up/Default/3D/thumbs_up_3d_default.png" },
      { path: "assets/Thumbs up/Dark/3D/thumbs_up_3d_dark.png" },
      { path: "assets/Rocket/3D/rocket_3d.png" },
    ],
  };
  assert.deepEqual(parseFluentTree(tree).map((e) => e.name), ["Fire", "Fire engine", "Thumbs up", "Rocket"]);
  resetStickerIndexForTests();
  const fakeFetch = (async () => ({ ok: true, status: 200, json: async () => tree })) as any;
  const fire = await searchStickers("fire", 5, fakeFetch);
  assert.deepEqual(fire.map((s) => s.title), ["Fire", "Fire engine"]);
  assert.equal(fire[0].url, "https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/Fire/3D/fire_3d.png");
  assert.equal(fire[0].license, "MIT");
  const thumbs = await searchStickers("thumbs", 5, fakeFetch);
  assert.equal(thumbs[0].url, "https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/Thumbs%20up/Default/3D/thumbs_up_3d_default.png");
  resetStickerIndexForTests();
});
