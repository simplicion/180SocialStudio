/**
 * Sticker library: Microsoft Fluent Emoji 3D (MIT licence, ~1,500 high-quality 3D PNG stickers), searched by name.
 *
 * The file index comes from GitHub's tree API once a day (one unauthenticated call; cached in memory) and the
 * PNGs are served by the jsDelivr CDN (fast, cached, no key). jsDelivr's own listing API cannot be used: the repo is
 * over its 50 MB package limit. Only the 3D style is offered: the Color / Flat styles are SVG, which the renderer
 * cannot use as image layers.
 *
 * Not used (see FREE_MEDIA_SOURCES.md): GIPHY stickers (free API is personal / non-commercial only), Tenor (API shut
 * down 30 June 2026), animated Noto / Lottie (the export renders still images only for now).
 */

export interface StickerItem {
  id: string;
  title: string;
  /** HTTPS PNG (transparent background). */
  url: string;
  previewUrl: string;
  provider: "fluent-emoji";
  license: "MIT";
  licenseUrl: string;
  attribution: string;
}

const TREE_URL = "https://api.github.com/repos/microsoft/fluentui-emoji/git/trees/main?recursive=1";
const CDN = "https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/";
const LICENSE_URL = "https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE";
const DAY_MS = 24 * 60 * 60 * 1000;

let cache: { at: number; entries: Array<{ name: string; path: string }> } | null = null;
let loading: Promise<Array<{ name: string; path: string }>> | null = null;

/** Folder name + 3D PNG path for every emoji (default skin tone only). Exposed for tests. */
export function parseFluentTree(tree: any): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = [];
  for (const t of tree?.tree ?? []) {
    const p = String(t?.path ?? "");
    // assets/<Name>/3D/<file>.png, or assets/<Name>/Default/3D/<file>.png for skin-tone emoji.
    const m = p.match(/^assets\/([^/]+)\/(?:Default\/)?3D\/[^/]+\.png$/);
    if (m) out.push({ name: m[1], path: p });
  }
  return out;
}

async function index(fetchImpl: typeof fetch = fetch): Promise<Array<{ name: string; path: string }>> {
  if (cache && Date.now() - cache.at < DAY_MS) return cache.entries;
  loading ??= (async () => {
    try {
      const res = await fetchImpl(TREE_URL, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "180Workspace-SocialStudio",
          // Optional: raises GitHub's limit from 60 to 5,000 requests/hour. Never required (one call per day).
          ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`sticker index: GitHub answered ${res.status}`);
      const entries = parseFluentTree(await res.json());
      if (entries.length === 0) throw new Error("sticker index: no stickers found in the library listing");
      cache = { at: Date.now(), entries };
      return entries;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Score of [name] for the query words (all words must match the start of a word in the name). */
export function stickerScore(name: string, words: string[]): number {
  const n = name.toLowerCase();
  const parts = n.split(/[\s_-]+/);
  let score = 0;
  for (const w of words) {
    if (parts.includes(w)) score += 3;
    else if (parts.some((p) => p.startsWith(w))) score += 2;
    else if (n.includes(w)) score += 1;
    else return 0;
  }
  // Shorter names are the closer match ("Fire" before "Fire engine").
  return score * 100 - parts.length;
}

export function toStickerItem(e: { name: string; path: string }): StickerItem {
  const url = CDN + e.path.split("/").map(encodeURIComponent).join("/");
  return {
    id: `fluent_${e.name.toLowerCase().replace(/\s+/g, "_")}`,
    title: e.name,
    url,
    previewUrl: url,
    provider: "fluent-emoji",
    license: "MIT",
    licenseUrl: LICENSE_URL,
    attribution: `Fluent Emoji "${e.name}" by Microsoft (MIT)`,
  };
}

/** Searches 3D stickers by name ("fire", "thumbs up", "rocket"); popular picks for an empty query. */
export async function searchStickers(query: string, limit = 24, fetchImpl?: typeof fetch): Promise<StickerItem[]> {
  const entries = await index(fetchImpl);
  const words = query.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, "")).filter(Boolean);
  const popular = ["Fire", "Red heart", "Thumbs up", "Rocket", "Sparkles", "Hundred points", "Party popper", "Star-struck", "Face with tears of joy", "Money bag", "Light bulb", "Check mark button"];
  if (words.length === 0) {
    return popular.map((n) => entries.find((e) => e.name === n)).filter((e): e is { name: string; path: string } => !!e).map(toStickerItem).slice(0, limit);
  }
  return entries
    .map((e) => ({ e, s: stickerScore(e.name, words) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.max(1, Math.min(limit, 60)))
    .map((x) => toStickerItem(x.e));
}

/** Test hook: forget the cached index. */
export function resetStickerIndexForTests() {
  cache = null;
  loading = null;
}
