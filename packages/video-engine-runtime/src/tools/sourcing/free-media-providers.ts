/**
 * Free, licence-safe media providers for the AI Director (metadata + HTTPS URLs only; nothing is
 * downloaded or processed here). Every provider returns the same normalized `FreeMediaItem`.
 *
 * Licence rule (commercial use): only CC0, public domain, CC BY and CC BY-SA (plus the Unsplash
 * licence for Unsplash photos) are ever returned. Non-commercial (NC) and no-derivatives (ND)
 * licences, GFDL-only and non-free files are dropped. An attribution line is always kept, even
 * when the licence does not require it.
 *
 * Keys come from the environment only: JAMENDO_CLIENT_ID (+ JAMENDO_ALLOW=true) and
 * UNSPLASH_ACCESS_KEY. A provider whose key is missing is skipped with a warning.
 * FREE_MEDIA_PROVIDERS (comma list, or "none") limits which providers run; default: all.
 *
 * Free Music Archive: its public API was discontinued, so it is intentionally not a provider.
 * See docs/social-studio-mobile/FREE_MEDIA_SOURCES.md.
 */

export type FreeMediaKind = "video" | "image" | "music" | "sfx";
export type FreeMediaProviderId = "openverse" | "wikimedia" | "internet_archive" | "jamendo" | "unsplash" | "nasa" | "ccmixter";
export type FreeMediaOrientation = "portrait" | "landscape" | "square";
/** Ranking class: cc0 > pd > cc-by > cc-by-sa ("platform" = Unsplash licence, no credit required). */
export type FreeLicenseClass = "cc0" | "pd" | "platform" | "cc-by" | "cc-by-sa";

export interface FreeMediaItem {
  id: string;
  kind: FreeMediaKind;
  title: string;
  /** HTTPS URL of the media itself. */
  url: string;
  /** HTTPS thumbnail / poster / low-res preview (null when the provider has none). */
  previewUrl: string | null;
  durationSec?: number;
  width?: number;
  height?: number;
  orientation?: FreeMediaOrientation;
  /** Short licence name, e.g. "CC0-1.0", "PD", "CC-BY-4.0", "CC-BY-SA-3.0", "Unsplash License". */
  license: string;
  licenseUrl: string | null;
  licenseClass: FreeLicenseClass;
  /** True when the licence requires crediting the author in the published post. */
  creditRequired: boolean;
  /** Human-readable credit line (always present). */
  attribution: string;
  /** Page describing the work (licence evidence). */
  sourcePage: string;
  provider: FreeMediaProviderId;
  /** Unsplash only: GET this (with the access key) when the photo is used (API guidelines). */
  downloadLocation?: string;
}

export interface FreeMediaQuery {
  query: string;
  kind: FreeMediaKind;
  limit?: number;
  orientation?: FreeMediaOrientation;
  minDurationSec?: number;
  maxDurationSec?: number;
  /** Music only: mood/tempo/genre hints (Jamendo uses them as filters). */
  mood?: string;
  tempo?: "verylow" | "low" | "medium" | "high" | "veryhigh";
  genre?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface FreeMediaProvider {
  id: FreeMediaProviderId;
  kinds: FreeMediaKind[];
  /** null when usable; otherwise why it is skipped (missing key, not allowed...). */
  unavailableReason(): string | null;
  search(q: FreeMediaQuery): Promise<FreeMediaItem[]>;
}

export const FREE_MEDIA_USER_AGENT = "180WorkspaceMediaStudio/1.0 (https://180workspace.com; AI Director stock search)";
const DEFAULT_TIMEOUT_MS = 6000;

// ── Licences ────────────────────────────────────────────────────────────────

export interface NormalizedLicense {
  license: string;
  licenseUrl: string | null;
  licenseClass: FreeLicenseClass;
  creditRequired: boolean;
}

/**
 * Maps a licence URL or code (Creative Commons URL, Openverse code + version, Wikimedia
 * `License` value) to a commercial-safe licence, or null when it is not allowed (NC, ND,
 * GFDL-only, unknown, non-free...).
 */
export function normalizeLicense(raw: string | null | undefined, version?: string | null): NormalizedLicense | null {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return null;
  // Anything non-commercial or no-derivatives is out, whatever else it says.
  if (/(^|[^a-z])(nc|nd)([^a-z]|$)/.test(v) || /non-?commercial|noderiv|no-?derivatives|gfdl|fair.?use|non-?free/.test(v)) return null;
  if (v === "cc0" || v.includes("publicdomain/zero") || /^cc0[- ]/.test(v) || v === "cc-zero") {
    return { license: "CC0-1.0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", licenseClass: "cc0", creditRequired: false };
  }
  if (v === "pdm" || v === "pd" || v.startsWith("pd-") || v.includes("publicdomain/mark") || v === "public domain" || v === "publicdomain") {
    return { license: "PD", licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/", licenseClass: "pd", creditRequired: false };
  }
  const ver = (m: RegExpMatchArray | null) => (m?.[1] || version || "4.0").replace(/^(\d)$/, "$1.0");
  const sa = v.match(/licenses\/by-sa\/(\d(?:\.\d)?)/) || v.match(/^cc[- ]by[- ]sa(?:[- ](\d(?:\.\d)?))?/);
  if (sa || v === "by-sa") {
    const n = ver(sa);
    return { license: `CC-BY-SA-${n}`, licenseUrl: `https://creativecommons.org/licenses/by-sa/${n}/`, licenseClass: "cc-by-sa", creditRequired: true };
  }
  const by = v.match(/licenses\/by\/(\d(?:\.\d)?)/) || v.match(/^cc[- ]by(?:[- ](\d(?:\.\d)?))?$/);
  if (by || v === "by") {
    const n = ver(by);
    return { license: `CC-BY-${n}`, licenseUrl: `https://creativecommons.org/licenses/by/${n}/`, licenseClass: "cc-by", creditRequired: true };
  }
  return null;
}

const LICENSE_LABEL: Record<FreeLicenseClass, (l: string) => string> = {
  cc0: () => "CC0",
  pd: () => "Public Domain",
  platform: (l) => l,
  "cc-by": (l) => l.replace(/^CC-BY-/, "CC BY "),
  "cc-by-sa": (l) => l.replace(/^CC-BY-SA-/, "CC BY-SA "),
};

export function creditLine(title: string, author: string | null | undefined, site: string, lic: NormalizedLicense): string {
  const who = author && author.trim() ? ` by ${author.trim()}` : "";
  return `"${title}"${who} (${site}), ${LICENSE_LABEL[lic.licenseClass](lic.license)}`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function orientationOf(width?: number, height?: number): FreeMediaOrientation | undefined {
  if (!width || !height) return undefined;
  const r = width / height;
  return r < 0.95 ? "portrait" : r > 1.05 ? "landscape" : "square";
}

const isHttps = (u: unknown): u is string => typeof u === "string" && /^https:\/\//i.test(u);
const https = (u: unknown): string | null => (typeof u === "string" ? (u.startsWith("//") ? `https:${u}` : isHttps(u) ? u : null) : null);
const stripHtml = (s: unknown) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();
const clampLimit = (n: number | undefined, max = 30) => Math.min(Math.max(n ?? 10, 1), max);

async function getJson(url: string, q: FreeMediaQuery, headers: Record<string, string> = {}): Promise<any> {
  const res = await (q.fetchImpl || fetch)(url, {
    headers: { "User-Agent": FREE_MEDIA_USER_AGENT, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(q.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function durationOk(q: FreeMediaQuery, d: number | undefined): boolean {
  if (d == null || !Number.isFinite(d)) return q.kind === "image" || (q.minDurationSec == null && q.maxDurationSec == null);
  if (q.minDurationSec != null && d < q.minDurationSec) return false;
  if (q.maxDurationSec != null && d > q.maxDurationSec) return false;
  return true;
}

// ── Openverse (no key; images + audio) ──────────────────────────────────────

export const OpenverseProvider: FreeMediaProvider = {
  id: "openverse",
  kinds: ["image", "music", "sfx"],
  unavailableReason: () => null,
  async search(q) {
    const audio = q.kind === "music" || q.kind === "sfx";
    const params = new URLSearchParams({
      q: q.query,
      // Only licences that allow commercial use AND modification (edits): CC0, PDM, BY, BY-SA.
      license_type: "commercial,modification",
      page_size: String(Math.min(clampLimit(q.limit) * 2, 40)),
      mature: "false",
    });
    if (audio) params.set("category", q.kind === "sfx" ? "sound_effect" : "music");
    if (!audio && q.orientation) params.set("aspect_ratio", q.orientation === "portrait" ? "tall" : q.orientation === "landscape" ? "wide" : "square");
    const data = await getJson(`https://api.openverse.org/v1/${audio ? "audio" : "images"}/?${params}`, q);
    return normalizeOpenverse(data, q);
  },
};

export function normalizeOpenverse(data: any, q: Pick<FreeMediaQuery, "kind" | "limit" | "minDurationSec" | "maxDurationSec">): FreeMediaItem[] {
  const out: FreeMediaItem[] = [];
  for (const r of data?.results || []) {
    const lic = normalizeLicense(r.license, r.license_version);
    const url = https(r.url);
    if (!lic || !url || r.mature) continue;
    const durationSec = r.duration != null ? Math.round(Number(r.duration) / 100) / 10 : undefined; // ms -> s
    if (!durationOk(q as FreeMediaQuery, durationSec)) continue;
    const title = stripHtml(r.title) || `Openverse ${r.id}`;
    const width = Number(r.width) || undefined;
    const height = Number(r.height) || undefined;
    out.push({
      id: `openverse_${r.id}`,
      kind: q.kind,
      title,
      url,
      previewUrl: https(r.thumbnail),
      ...(durationSec != null ? { durationSec } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(orientationOf(width, height) ? { orientation: orientationOf(width, height) } : {}),
      ...lic,
      licenseUrl: https(r.license_url) || lic.licenseUrl,
      attribution: creditLine(title, stripHtml(r.creator), `${r.source || r.provider || "Openverse"} via Openverse`, lic),
      sourcePage: https(r.foreign_landing_url) || `https://openverse.org/${q.kind === "image" ? "image" : "audio"}/${r.id}`,
      provider: "openverse",
    });
    if (out.length >= clampLimit(q.limit)) break;
  }
  return out;
}

// ── Wikimedia Commons (no key; video, audio, images) ────────────────────────

export const WikimediaCommonsProvider: FreeMediaProvider = {
  id: "wikimedia",
  kinds: ["video", "image", "music", "sfx"],
  unavailableReason: () => null,
  async search(q) {
    const filetype = q.kind === "video" ? "video" : q.kind === "image" ? "bitmap" : "audio";
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "search",
      gsrnamespace: "6",
      gsrlimit: String(Math.min(clampLimit(q.limit) * 3, 50)),
      gsrsearch: `${q.query} filetype:${filetype}`,
      prop: "videoinfo",
      viprop: "url|size|mime|mediatype|extmetadata|derivatives",
      viurlwidth: q.kind === "image" ? "1920" : "640",
      viextmetadatafilter: "ObjectName|Artist|LicenseShortName|License|LicenseUrl|AttributionRequired|NonFree|UsageTerms",
      origin: "*",
    });
    const data = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`, q);
    return normalizeWikimedia(data, q);
  },
};

export function normalizeWikimedia(data: any, q: Pick<FreeMediaQuery, "kind" | "limit" | "minDurationSec" | "maxDurationSec" | "orientation">): FreeMediaItem[] {
  const pages: any[] = Array.isArray(data?.query?.pages) ? data.query.pages : Object.values(data?.query?.pages || {});
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out: FreeMediaItem[] = [];
  for (const p of pages) {
    const info = (p.videoinfo || p.imageinfo || [])[0];
    if (!info) continue;
    const meta = Object.fromEntries(Object.entries(info.extmetadata || {}).map(([k, v]: [string, any]) => [k, v?.value]));
    // Commons hosts some non-free files (logos, fair use): never use them.
    if (meta.NonFree && String(meta.NonFree).toLowerCase() !== "false") continue;
    const lic = normalizeLicense(meta.License) || normalizeLicense(meta.LicenseUrl) || normalizeLicense(meta.LicenseShortName);
    if (!lic) continue;
    const mediatype = String(info.mediatype || "").toUpperCase();
    const derivs: any[] = info.derivatives || [];
    let url: string | null = null;
    let width = Number(info.width) || undefined;
    let height = Number(info.height) || undefined;
    if (q.kind === "video") {
      if (mediatype !== "VIDEO") continue;
      // Theora/OGV originals do not decode on phones: use the largest VP9 WebM (<=1080p) or an MP4 original.
      const webm = derivs
        .filter((d) => /vp9.*\.webm$/i.test(String(d.transcodekey || "")) && isHttps(d.src) && (d.height || 0) <= 1080)
        .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
      if (/^video\/(mp4|webm)/i.test(String(info.mime)) && (height || 0) <= 1080) url = https(info.url);
      else if (webm) {
        url = webm.src;
        width = webm.width || width;
        height = webm.height || height;
      }
    } else if (q.kind === "image") {
      if (mediatype !== "BITMAP") continue;
      url = https(info.thumburl) || https(info.url);
      if (info.thumbwidth) {
        width = Number(info.thumbwidth);
        height = Number(info.thumbheight) || height;
      }
    } else {
      if (mediatype !== "AUDIO") continue;
      const mp3 = derivs.find((d) => String(d.transcodekey || "") === "mp3" && isHttps(d.src));
      url = mp3?.src || (/^audio\/(mpeg|mp4|ogg|wav)/i.test(String(info.mime)) || /\.(mp3|ogg|oga|wav|flac)(\?|$)/i.test(String(info.url)) ? https(info.url) : null);
      width = height = undefined;
    }
    if (!url) continue;
    const durationSec = info.duration != null ? Math.round(Number(info.duration) * 10) / 10 : undefined;
    if (q.kind !== "image" && !durationOk(q as FreeMediaQuery, durationSec)) continue;
    const title = stripHtml(meta.ObjectName) || String(p.title || "").replace(/^File:/, "").replace(/\.[^.]+$/, "");
    out.push({
      id: `wikimedia_${p.pageid ?? title}`,
      kind: q.kind,
      title,
      url,
      previewUrl: q.kind === "music" || q.kind === "sfx" ? null : https(info.thumburl),
      ...(durationSec != null ? { durationSec } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(orientationOf(width, height) ? { orientation: orientationOf(width, height) } : {}),
      ...lic,
      licenseUrl: https(meta.LicenseUrl) || (typeof meta.LicenseUrl === "string" && meta.LicenseUrl.startsWith("http://") ? meta.LicenseUrl.replace(/^http:/, "https:") : lic.licenseUrl),
      attribution: creditLine(title, stripHtml(meta.Artist), "Wikimedia Commons", lic),
      sourcePage: https(info.descriptionurl) || `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(p.title || ""))}`,
      provider: "wikimedia",
    });
    if (out.length >= clampLimit(q.limit)) break;
  }
  return out;
}

// ── Internet Archive (no key; public-domain / CC video and audio) ────────────

export const InternetArchiveProvider: FreeMediaProvider = {
  id: "internet_archive",
  kinds: ["video", "music", "sfx"],
  unavailableReason: () => null,
  async search(q) {
    const mediatype = q.kind === "video" ? "movies" : "audio";
    const params = new URLSearchParams({
      q: `(${q.query.replace(/[()":]/g, " ")}) AND mediatype:${mediatype} AND (licenseurl:*publicdomain* OR licenseurl:*creativecommons*) AND NOT licenseurl:*nc* AND NOT licenseurl:*nd*`,
      rows: String(Math.min(clampLimit(q.limit) * 2, 12)),
      output: "json",
    });
    for (const f of ["identifier", "title", "creator", "licenseurl", "mediatype"]) params.append("fl[]", f);
    const search = await getJson(`https://archive.org/advancedsearch.php?${params}`, q);
    const docs = normalizeArchiveSearch(search);
    // One metadata call per candidate (in parallel) for direct file URLs, durations and sizes.
    const metas = await Promise.allSettled(docs.map((d) => getJson(`https://archive.org/metadata/${encodeURIComponent(d.identifier)}`, q)));
    const out: FreeMediaItem[] = [];
    docs.forEach((d, i) => {
      const m = metas[i];
      if (m.status !== "fulfilled") return;
      const item = normalizeArchiveItem(d, m.value, q);
      if (item && out.length < clampLimit(q.limit)) out.push(item);
    });
    return out;
  },
};

export interface ArchiveDoc {
  identifier: string;
  title: string;
  creator: string | null;
  license: NormalizedLicense;
}

export function normalizeArchiveSearch(data: any): ArchiveDoc[] {
  const out: ArchiveDoc[] = [];
  for (const d of data?.response?.docs || []) {
    const lic = normalizeLicense(d.licenseurl);
    if (!lic || typeof d.identifier !== "string") continue;
    out.push({
      identifier: d.identifier,
      title: stripHtml(Array.isArray(d.title) ? d.title[0] : d.title) || d.identifier,
      creator: d.creator ? stripHtml(Array.isArray(d.creator) ? d.creator.join(", ") : d.creator) : null,
      license: lic,
    });
  }
  return out;
}

const IA_VIDEO_FORMATS = ["h.264", "h.264 ia", "mpeg4", "512kb mpeg4"];
const IA_AUDIO_FORMATS = ["vbr mp3", "mp3", "128kbps mp3", "64kbps mp3"];

export function normalizeArchiveItem(doc: ArchiveDoc, meta: any, q: Pick<FreeMediaQuery, "kind" | "minDurationSec" | "maxDurationSec">): FreeMediaItem | null {
  const files: any[] = meta?.files || [];
  const wanted = q.kind === "video" ? IA_VIDEO_FORMATS : IA_AUDIO_FORMATS;
  const candidates = files
    .filter((f) => wanted.includes(String(f.format || "").toLowerCase()))
    .filter((f) => !f.size || Number(f.size) <= 30 * 1024 * 1024)
    .map((f) => ({ f, durationSec: parseFloat(f.length), height: Number(f.height) || 0 }))
    .filter((c) => durationOk(q as FreeMediaQuery, Number.isFinite(c.durationSec) ? c.durationSec : undefined))
    // Prefer HD <=1080p, then formats in the listed order.
    .sort((a, b) => (Math.min(b.height, 1080) - Math.min(a.height, 1080)) || wanted.indexOf(String(a.f.format).toLowerCase()) - wanted.indexOf(String(b.f.format).toLowerCase()));
  const pick = candidates[0];
  if (!pick) return null;
  const path = String(pick.f.name).split("/").map(encodeURIComponent).join("/");
  const width = Number(pick.f.width) || undefined;
  const height = Number(pick.f.height) || undefined;
  const thumb = files.find((f) => f.format === "Item Tile" || f.name === "__ia_thumb.jpg");
  return {
    id: `internet_archive_${doc.identifier}`,
    kind: q.kind,
    title: doc.title,
    url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${path}`,
    previewUrl: thumb ? `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(thumb.name)}` : `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
    ...(Number.isFinite(pick.durationSec) ? { durationSec: Math.round(pick.durationSec * 10) / 10 } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(orientationOf(width, height) ? { orientation: orientationOf(width, height) } : {}),
    ...doc.license,
    attribution: creditLine(doc.title, doc.creator, "Internet Archive", doc.license),
    sourcePage: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
    provider: "internet_archive",
  };
}

// ── Jamendo (free client id; music) ─────────────────────────────────────────

/**
 * Jamendo's free API tier is licensed for NON-COMMERCIAL applications. The individual tracks are
 * Creative Commons, so only CC BY / CC BY-SA tracks (no NC/ND) are returned, and the provider only
 * runs when the owner has explicitly opted in with JAMENDO_ALLOW=true (after checking Jamendo's
 * API terms, or holding a commercial agreement) and set JAMENDO_CLIENT_ID.
 */
export const JamendoProvider: FreeMediaProvider = {
  id: "jamendo",
  kinds: ["music"],
  unavailableReason() {
    if (!process.env.JAMENDO_CLIENT_ID) return "JAMENDO_CLIENT_ID is not set";
    if (process.env.JAMENDO_ALLOW !== "true") return "JAMENDO_ALLOW is not \"true\" (Jamendo's free API terms are non-commercial; see FREE_MEDIA_SOURCES.md)";
    return null;
  },
  async search(q) {
    const params = new URLSearchParams({
      client_id: process.env.JAMENDO_CLIENT_ID || "",
      format: "json",
      limit: String(Math.min(clampLimit(q.limit) * 3, 50)),
      search: q.query,
      include: "licenses musicinfo",
      audioformat: "mp32",
      order: "popularity_total",
      ccnc: "false",
      ccnd: "false",
    });
    const tags = [q.mood, q.genre].filter(Boolean).join(" ");
    if (tags) params.set("fuzzytags", tags.replace(/\s+/g, "+"));
    if (q.tempo) params.set("speed", q.tempo);
    if (q.minDurationSec || q.maxDurationSec) params.set("durationbetween", `${Math.floor(q.minDurationSec || 0)}_${Math.ceil(q.maxDurationSec || 3600)}`);
    const data = await getJson(`https://api.jamendo.com/v3.0/tracks/?${params}`, q);
    return normalizeJamendo(data, q);
  },
};

export function normalizeJamendo(data: any, q: Pick<FreeMediaQuery, "limit" | "minDurationSec" | "maxDurationSec">): FreeMediaItem[] {
  if (data?.headers?.status && data.headers.status !== "success") throw new Error(`Jamendo: ${data.headers.error_message || data.headers.status}`);
  const out: FreeMediaItem[] = [];
  for (const r of data?.results || []) {
    const lic = normalizeLicense(r.license_ccurl);
    const url = https(r.audio);
    if (!lic || !url) continue;
    const durationSec = Number(r.duration) || undefined;
    if (!durationOk({ ...q, kind: "music" } as FreeMediaQuery, durationSec)) continue;
    const title = stripHtml(r.name) || `Jamendo ${r.id}`;
    out.push({
      id: `jamendo_${r.id}`,
      kind: "music",
      title,
      url,
      previewUrl: https(r.image) || https(r.album_image),
      ...(durationSec ? { durationSec } : {}),
      ...lic,
      licenseUrl: https(r.license_ccurl) || lic.licenseUrl,
      attribution: creditLine(title, stripHtml(r.artist_name), "Jamendo", lic),
      sourcePage: https(r.shareurl) || `https://www.jamendo.com/track/${r.id}`,
      provider: "jamendo",
    });
    if (out.length >= clampLimit(q.limit)) break;
  }
  return out;
}

// ── ccMixter (no key; music) ────────────────────────────────────────────────

/**
 * ccMixter (Creative Commons music community, Query API 2.0). Only Attribution-licensed uploads are requested
 * (`lic=by`) and every licence URL is re-checked by normalizeLicense, so NC / ND / Sampling+ never get through.
 * Each track's credit line goes to the post caption like the other CC sources.
 */
export const CcMixterProvider: FreeMediaProvider = {
  id: "ccmixter",
  kinds: ["music"],
  unavailableReason: () => null,
  async search(q) {
    const params = new URLSearchParams({
      // "js" returns the same JSON body; "json" also copies the whole result into an X-JSON response header (~40 KB),
      // which overflows Node's 16 KB header limit (UND_ERR_HEADERS_OVERFLOW).
      f: "js",
      lic: "by",
      limit: String(Math.min(clampLimit(q.limit) * 3, 40)),
      sort: "rank",
      search_type: "any",
      s: [q.query, q.mood, q.genre].filter(Boolean).join(" "),
    });
    const data = await getJson(`https://ccmixter.org/api/query?${params}`, q);
    return normalizeCcMixter(data, q);
  },
};

function minutesToSec(ps: unknown): number | undefined {
  const m = String(ps ?? "").match(/^(?:(\d+):)?(\d+):(\d{2})$/);
  if (!m) return undefined;
  return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
}

export function normalizeCcMixter(data: any, q: Pick<FreeMediaQuery, "limit" | "minDurationSec" | "maxDurationSec">): FreeMediaItem[] {
  const out: FreeMediaItem[] = [];
  for (const r of Array.isArray(data) ? data : []) {
    const lic = normalizeLicense(r?.license_url);
    if (!lic) continue;
    const file = (Array.isArray(r.files) ? r.files : []).find(
      (f: any) => f?.file_format_info?.mime_type === "audio/mpeg" || /\.mp3$/i.test(String(f?.download_url || "")),
    );
    const url = https(file?.download_url);
    if (!url) continue;
    const durationSec = minutesToSec(file?.file_format_info?.ps);
    if (!durationOk({ ...q, kind: "music" } as FreeMediaQuery, durationSec)) continue;
    const title = stripHtml(r.upload_name) || `ccMixter ${r.upload_id}`;
    out.push({
      id: `ccmixter_${r.upload_id}`,
      kind: "music",
      title,
      url,
      previewUrl: null,
      ...(durationSec ? { durationSec } : {}),
      ...lic,
      attribution: creditLine(title, stripHtml(r.user_real_name || r.user_name), "ccMixter", lic),
      sourcePage: https(r.file_page_url) || `https://ccmixter.org/files/${encodeURIComponent(String(r.user_name || ""))}/${r.upload_id}`,
      provider: "ccmixter",
    });
    if (out.length >= clampLimit(q.limit)) break;
  }
  return out;
}

// ── Unsplash (UNSPLASH_ACCESS_KEY; photos) ──────────────────────────────────

const UNSPLASH_UTM = () => `utm_source=${encodeURIComponent(process.env.UNSPLASH_APP_NAME || "180workspace")}&utm_medium=referral`;

/**
 * Unsplash API guidelines: hotlink the returned `urls.*` (never re-host), call the photo's
 * `download_location` when the photo is actually used (`trackUnsplashDownload`), and credit
 * "Photo by <name> on Unsplash" with links back (UTM parameters included).
 */
export const UnsplashProvider: FreeMediaProvider = {
  id: "unsplash",
  kinds: ["image"],
  unavailableReason: () => (process.env.UNSPLASH_ACCESS_KEY ? null : "UNSPLASH_ACCESS_KEY is not set"),
  async search(q) {
    const params = new URLSearchParams({ query: q.query, per_page: String(clampLimit(q.limit)), content_filter: "high" });
    if (q.orientation) params.set("orientation", q.orientation === "square" ? "squarish" : q.orientation);
    const data = await getJson(`https://api.unsplash.com/search/photos?${params}`, q, {
      Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`,
      "Accept-Version": "v1",
    });
    return normalizeUnsplash(data, q);
  },
};

export function normalizeUnsplash(data: any, q: Pick<FreeMediaQuery, "limit">): FreeMediaItem[] {
  const out: FreeMediaItem[] = [];
  for (const r of data?.results || []) {
    const url = https(r.urls?.regular) || https(r.urls?.full);
    if (!url) continue;
    const width = Number(r.width) || undefined;
    const height = Number(r.height) || undefined;
    const name = stripHtml(r.user?.name) || r.user?.username || "Unsplash photographer";
    const profile = https(r.user?.links?.html);
    const page = https(r.links?.html) || `https://unsplash.com/photos/${r.id}`;
    out.push({
      id: `unsplash_${r.id}`,
      kind: "image",
      title: stripHtml(r.description || r.alt_description) || `Unsplash photo ${r.id}`,
      url,
      previewUrl: https(r.urls?.small) || https(r.urls?.thumb),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(orientationOf(width, height) ? { orientation: orientationOf(width, height) } : {}),
      license: "Unsplash License",
      licenseUrl: "https://unsplash.com/license",
      licenseClass: "platform",
      // Not legally required by the licence, but the API guidelines require visible credit.
      creditRequired: true,
      attribution: `Photo by ${name}${profile ? ` (${profile}?${UNSPLASH_UTM()})` : ""} on Unsplash (https://unsplash.com/?${UNSPLASH_UTM()})`,
      sourcePage: `${page}?${UNSPLASH_UTM()}`,
      provider: "unsplash",
      ...(https(r.links?.download_location) ? { downloadLocation: https(r.links.download_location)! } : {}),
    });
    if (out.length >= clampLimit(q.limit)) break;
  }
  return out;
}

/**
 * Registers a download with Unsplash (required by the API guidelines when a photo is used).
 * Only api.unsplash.com URLs are accepted, so this cannot be abused as an open proxy.
 */
export async function trackUnsplashDownload(downloadLocation: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) throw new Error("UNSPLASH_ACCESS_KEY is not set");
  let u: URL;
  try {
    u = new URL(downloadLocation);
  } catch {
    throw new Error("downloadLocation is not a URL");
  }
  if (u.protocol !== "https:" || u.hostname !== "api.unsplash.com" || !/^\/photos\/[^/]+\/download$/.test(u.pathname)) {
    throw new Error("downloadLocation must be an https://api.unsplash.com/photos/<id>/download URL");
  }
  const res = await fetchImpl(u.toString(), {
    headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  return res.ok;
}

// ── NASA Media Provider (100% Public Domain, Zero API Key) ───────────────────

export const NasaMediaProvider: FreeMediaProvider = {
  id: "nasa",
  kinds: ["video", "image", "sfx"],
  unavailableReason: () => null,
  async search(q: FreeMediaQuery): Promise<FreeMediaItem[]> {
    const mediaType = q.kind === "video" ? "video" : q.kind === "image" ? "image" : "audio";
    const url = `https://images-api.nasa.gov/search?q=${encodeURIComponent(q.query)}&media_type=${mediaType}`;
    let data: any;
    try {
      data = await getJson(url, q);
    } catch {
      return [];
    }
    const rawItems: any[] = data?.collection?.items || [];
    const out: FreeMediaItem[] = [];
    const limit = clampLimit(q.limit, 12);

    for (const item of rawItems) {
      if (out.length >= limit) break;
      const d = item.data?.[0];
      if (!d) continue;
      const title = stripHtml(d.title || "NASA Media");
      const nasaId = d.nasa_id || `nasa_${Date.now()}`;
      const previewUrl = item.links?.[0]?.href ? item.links[0].href.replace(/^http:\/\//i, "https://") : null;

      let directUrl = previewUrl || "";
      if (item.href) {
        try {
          const files = await getJson(item.href.replace(/^http:\/\//i, "https://"), q);
          if (Array.isArray(files)) {
            const best = files.find((f: string) =>
              f.includes("~medium.mp4") ||
              f.includes("~orig.mp4") ||
              f.endsWith(".mp3") ||
              f.includes("~large.jpg")
            ) || files[0];
            if (best) directUrl = best.replace(/^http:\/\//i, "https://");
          }
        } catch {
          // Keep previewUrl if collection resolution fails
        }
      }

      if (!directUrl) continue;

      out.push({
        id: `nasa_${nasaId}`,
        kind: q.kind,
        title,
        url: directUrl,
        previewUrl,
        license: "Public Domain",
        licenseUrl: "https://www.nasa.gov/multimedia/guidelines/index.html",
        licenseClass: "pd",
        creditRequired: false,
        attribution: `NASA (${d.center || "NASA"})`,
        sourcePage: `https://images.nasa.gov/details-${encodeURIComponent(nasaId)}`,
        provider: "nasa",
      });
    }
    return out;
  },
};

// ── Federation + ranking ────────────────────────────────────────────────────

export const FREE_MEDIA_PROVIDERS: FreeMediaProvider[] = [
  OpenverseProvider,
  WikimediaCommonsProvider,
  InternetArchiveProvider,
  JamendoProvider,
  CcMixterProvider,
  UnsplashProvider,
  NasaMediaProvider,
];

/** Providers allowed by FREE_MEDIA_PROVIDERS ("none" disables all; unset = all). */
export function enabledFreeProviderIds(): Set<FreeMediaProviderId> | null {
  const raw = (process.env.FREE_MEDIA_PROVIDERS || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "none" || raw === "off" || raw === "false") return new Set();
  return new Set(raw.split(/[\s,]+/).filter(Boolean) as FreeMediaProviderId[]);
}

export const LICENSE_PRIORITY: Record<FreeLicenseClass, number> = { cc0: 40, pd: 32, platform: 32, "cc-by": 24, "cc-by-sa": 12 };

export interface FreeMediaRankOptions {
  targetAspect?: "16:9" | "9:16" | "1:1" | "4:5";
  targetDurationSec?: number;
}

/**
 * Deterministic ranking: licence priority (CC0 > PD > CC BY > CC BY-SA), orientation fit
 * (portrait for 9:16), duration fit (long enough for the slot, music not much shorter than the
 * video) and resolution. Internet Archive licences are uploader-asserted, so it gets a small
 * penalty. Ties keep provider order.
 */
export function scoreFreeMedia(item: FreeMediaItem, o: FreeMediaRankOptions = {}): number {
  let s = LICENSE_PRIORITY[item.licenseClass] ?? 0;
  if (item.kind === "video" || item.kind === "image") {
    const want: FreeMediaOrientation = o.targetAspect === "9:16" || o.targetAspect === "4:5" ? "portrait" : o.targetAspect === "1:1" ? "square" : "landscape";
    if (item.orientation === want) s += 30;
    else if (item.orientation === "square" || want === "square") s += 12;
    const short = Math.min(item.width || 0, item.height || 0);
    s += short >= 1080 ? 15 : short >= 720 ? 10 : short >= 480 ? 5 : 0;
  }
  if (o.targetDurationSec && item.durationSec && item.kind !== "image") {
    const r = item.durationSec / o.targetDurationSec;
    if (item.kind === "sfx") s += item.durationSec <= 5 ? 10 : 0;
    else s += r >= 1 ? (item.kind === "music" && r > 6 ? 12 : 20) : Math.round(20 * r);
  }
  if (item.provider === "internet_archive") s -= 5;
  return s;
}

export function rankFreeMedia(items: FreeMediaItem[], o: FreeMediaRankOptions = {}): FreeMediaItem[] {
  return items
    .map((item, i) => ({ item, i, s: scoreFreeMedia(item, o) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}

export interface FreeMediaSearchResult {
  items: FreeMediaItem[];
  /** Providers that were queried (and how many usable results each gave). */
  providers: Array<{ id: FreeMediaProviderId; count: number }>;
  /** Skipped providers (missing key, opt-in) and provider errors. Never fatal. */
  warnings: string[];
}

/**
 * Queries every enabled provider that serves `kind` in parallel (each under its own timeout),
 * drops duplicates, and ranks the union. Provider failures become warnings, never errors.
 */
export async function searchFreeMedia(
  q: FreeMediaQuery & FreeMediaRankOptions & { providers?: FreeMediaProviderId[] }
): Promise<FreeMediaSearchResult> {
  const allowed = enabledFreeProviderIds();
  const warnings: string[] = [];
  const active: FreeMediaProvider[] = [];
  for (const p of FREE_MEDIA_PROVIDERS) {
    if (!p.kinds.includes(q.kind)) continue;
    if (q.providers && !q.providers.includes(p.id)) continue;
    if (allowed && !allowed.has(p.id)) continue;
    const why = p.unavailableReason();
    if (why) {
      warnings.push(`${p.id}: skipped (${why})`);
      continue;
    }
    active.push(p);
  }
  const settled = await Promise.allSettled(active.map((p) => p.search(q)));
  const seen = new Set<string>();
  const items: FreeMediaItem[] = [];
  const providers: FreeMediaSearchResult["providers"] = [];
  settled.forEach((r, i) => {
    const id = active[i].id;
    if (r.status === "rejected") {
      warnings.push(`${id}: ${r.reason?.name === "TimeoutError" ? "timed out" : r.reason?.message || r.reason}`);
      providers.push({ id, count: 0 });
      return;
    }
    let n = 0;
    for (const it of r.value) {
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      items.push(it);
      n++;
    }
    providers.push({ id, count: n });
  });
  const ranked = rankFreeMedia(items, q);
  return { items: ranked.slice(0, clampLimit(q.limit, 50)), providers, warnings };
}
