/**
 * Royalty-free background-music catalogue for the AI Director.
 *
 * Every entry is a real file on Wikimedia Commons (HTTPS, served as audio/mpeg; Ogg originals
 * use Commons' MP3 transcode so iOS AVPlayer can play them too). Title, duration and licence
 * were read from the Commons API (imageinfo + extmetadata.LicenseShortName) and every URL was
 * fetched successfully on 2026-09-25. All tracks are by Kevin MacLeod (incompetech.com):
 * CC BY requires a credit line when the video is published, see `attribution`.
 *
 * No API key is involved. Pure data + deterministic selection, so it is safe to use in tests.
 */

export type MusicGenre = "AMBIENT_CALM" | "ELECTRONIC_UPBEAT" | "CINEMATIC_DRAMATIC" | "LOFI_STUDY" | "ACOUSTIC_WARM";

export const MUSIC_GENRES: MusicGenre[] = ["AMBIENT_CALM", "ELECTRONIC_UPBEAT", "CINEMATIC_DRAMATIC", "LOFI_STUDY", "ACOUSTIC_WARM"];

export interface MusicTrack {
  title: string;
  artist: string;
  /** HTTPS audio URL (audio/mpeg). */
  url: string;
  durationSec: number;
  /** SPDX-style short licence name, e.g. "CC-BY-4.0". */
  license: string;
  /** Credit line the licence requires when the video is published. */
  attribution: string;
  /** Human page with the licence details. */
  sourcePage: string;
  genre: MusicGenre;
  provider: "catalog" | "freesound";
}

const COMMONS = "https://upload.wikimedia.org/wikipedia/commons";
const kevin = (title: string, license: "CC-BY-3.0" | "CC-BY-4.0") =>
  `"${title}" by Kevin MacLeod (incompetech.com), licensed under ${license.replace(/-(\d)/, " $1").replace(/-/g, " ")}`;

function track(genre: MusicGenre, title: string, path: string, durationSec: number, license: "CC-BY-3.0" | "CC-BY-4.0", file: string): MusicTrack {
  return {
    title,
    artist: "Kevin MacLeod",
    url: `${COMMONS}/${path}`,
    durationSec,
    license,
    attribution: kevin(title, license),
    sourcePage: `https://commons.wikimedia.org/wiki/File:${file}`,
    genre,
    provider: "catalog",
  };
}

export const MUSIC_CATALOG: MusicTrack[] = [
  track("ELECTRONIC_UPBEAT", "Cheery Monday", "transcoded/7/7d/Cheery_Monday_by_Kevin_MacLeod.ogg/Cheery_Monday_by_Kevin_MacLeod.ogg.mp3", 80, "CC-BY-4.0", "Cheery_Monday_by_Kevin_MacLeod.ogg"),
  track("ELECTRONIC_UPBEAT", "Le Grand Chase", "transcoded/c/cc/Le_Grand_Chase_by_Kevin_MacLeod.ogg/Le_Grand_Chase_by_Kevin_MacLeod.ogg.mp3", 101, "CC-BY-4.0", "Le_Grand_Chase_by_Kevin_MacLeod.ogg"),
  track("ELECTRONIC_UPBEAT", "Hustle", "transcoded/f/fb/Kevin_MacLeod_-_06_-_Hustle.ogg/Kevin_MacLeod_-_06_-_Hustle.ogg.mp3", 121, "CC-BY-3.0", "Kevin_MacLeod_-_06_-_Hustle.ogg"),
  track("CINEMATIC_DRAMATIC", "The Descent", "transcoded/4/49/The_Descent_by_Kevin_MacLeod.ogg/The_Descent_by_Kevin_MacLeod.ogg.mp3", 192, "CC-BY-4.0", "The_Descent_by_Kevin_MacLeod.ogg"),
  track("CINEMATIC_DRAMATIC", "Hitman", "transcoded/b/b3/Hitman_by_Kevin_MacLeod.ogg/Hitman_by_Kevin_MacLeod.ogg.mp3", 201, "CC-BY-4.0", "Hitman_by_Kevin_MacLeod.ogg"),
  track("CINEMATIC_DRAMATIC", "Impact Prelude", "transcoded/8/8d/Kevin_MacLeod_-_01_-_Impact_Prelude.ogg/Kevin_MacLeod_-_01_-_Impact_Prelude.ogg.mp3", 203, "CC-BY-3.0", "Kevin_MacLeod_-_01_-_Impact_Prelude.ogg"),
  track("AMBIENT_CALM", "Bathed in the Light", "transcoded/e/e6/Kevin_MacLeod_-_Bathed_in_the_Light.ogg/Kevin_MacLeod_-_Bathed_in_the_Light.ogg.mp3", 166, "CC-BY-3.0", "Kevin_MacLeod_-_Bathed_in_the_Light.ogg"),
  track("AMBIENT_CALM", "Silver Blue Light", "transcoded/8/85/Kevin_MacLeod_-_Silver_Blue_Light.ogg/Kevin_MacLeod_-_Silver_Blue_Light.ogg.mp3", 350, "CC-BY-3.0", "Kevin_MacLeod_-_Silver_Blue_Light.ogg"),
  track("LOFI_STUDY", "Gymnopedie No. 2", "2/20/Gymnopedie_No._2_%28ISRC_USUAN1100786%29.mp3", 159, "CC-BY-3.0", "Gymnopedie_No._2_(ISRC_USUAN1100786).mp3"),
  track("LOFI_STUDY", "Backbay Lounge", "e/e2/Backbay_Lounge_%28ISRC_USUAN1700068%29.mp3", 267, "CC-BY-3.0", "Backbay_Lounge_(ISRC_USUAN1700068).mp3"),
  track("LOFI_STUDY", "Wholesome", "transcoded/f/f2/Wholesome_by_Kevin_MacLeod.ogg/Wholesome_by_Kevin_MacLeod.ogg.mp3", 364, "CC-BY-4.0", "Wholesome_by_Kevin_MacLeod.ogg"),
  track("ACOUSTIC_WARM", "Early Riser", "transcoded/d/d7/Kevin_MacLeod_-_Early_Riser.ogg/Kevin_MacLeod_-_Early_Riser.ogg.mp3", 174, "CC-BY-3.0", "Kevin_MacLeod_-_Early_Riser.ogg"),
  track("ACOUSTIC_WARM", "Blue Feather", "5/5a/Blue_Feather_%28ISRC_USUAN1100524%29.mp3", 278, "CC-BY-3.0", "Blue_Feather_(ISRC_USUAN1100524).mp3"),
  track("ACOUSTIC_WARM", "Canon in D Major", "transcoded/5/59/Kevin_MacLeod_-_Canon_in_D_Major.ogg/Kevin_MacLeod_-_Canon_in_D_Major.ogg.mp3", 356, "CC-BY-3.0", "Kevin_MacLeod_-_Canon_in_D_Major.ogg"),
];

/** Mood / genre keywords -> catalogue genre. Matched on whole words (Unicode-aware, lower-cased). */
const GENRE_KEYWORDS: Record<MusicGenre, string[]> = {
  ELECTRONIC_UPBEAT: ["upbeat", "energetic", "energy", "hype", "hyped", "fast", "fun", "funky", "happy", "pop", "electronic", "edm", "dance", "party", "workout", "gym", "fitness", "exciting", "bright", "cheerful", "positive", "trendy", "tiktok", "reels", "bouncy", "playful", "catchy", "groovy", "summer", "sport", "sports"],
  CINEMATIC_DRAMATIC: ["cinematic", "epic", "dramatic", "drama", "intense", "suspense", "suspenseful", "tension", "dark", "trailer", "action", "powerful", "orchestral", "mysterious", "mystery", "thriller", "heroic", "serious", "documentary"],
  LOFI_STUDY: ["lofi", "lo-fi", "chill", "chillhop", "study", "studying", "jazz", "jazzy", "lounge", "hiphop", "hip-hop", "beats", "cozy", "mellow", "laid-back", "laidback", "smooth", "coffee", "night"],
  ACOUSTIC_WARM: ["acoustic", "warm", "guitar", "folk", "wholesome", "heartfelt", "inspirational", "inspiring", "uplifting", "hopeful", "family", "travel", "vlog", "morning", "sunny", "classical", "baroque", "wedding"],
  AMBIENT_CALM: ["calm", "ambient", "peaceful", "soft", "meditation", "meditative", "relaxing", "relaxed", "relax", "gentle", "piano", "sad", "slow", "minimal", "minimalist", "dreamy", "emotional", "serene", "tutorial", "corporate", "background"],
};

/** Words that say "some music" without naming a mood; a query made only of these gets the default genre. */
const GENERIC_WORDS = new Set(["music", "song", "songs", "track", "tracks", "bed", "bgm", "audio", "sound", "soundtrack", "instrumental", "royalty", "free", "royalty-free", "some", "a", "an", "the", "and", "with", "of", "for", "in", "add", "nice", "good", "cool", "vibe", "vibes", "style", "type", "kind"]);

export const DEFAULT_MUSIC_GENRE: MusicGenre = "AMBIENT_CALM";

/**
 * Maps a mood query to a genre. `matched` is false when the query names a mood/style the catalogue
 * cannot serve (e.g. "heavy metal"); a generic query ("background music") gets the default genre.
 */
export function moodToMusicGenre(query: string): { genre: MusicGenre; matched: boolean } {
  const tokens = (query || "")
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}-]+/u)
    .filter(Boolean);
  const scores = new Map<MusicGenre, number>();
  for (const tok of tokens) {
    for (const g of MUSIC_GENRES) {
      if (GENRE_KEYWORDS[g].includes(tok) || GENRE_KEYWORDS[g].includes(tok.replace(/-/g, ""))) scores.set(g, (scores.get(g) || 0) + 1);
    }
  }
  if (scores.size > 0) {
    // Highest score wins; ties go to the first keyword's genre in query order.
    const best = Math.max(...scores.values());
    for (const tok of tokens) {
      const g = MUSIC_GENRES.find((x) => scores.get(x) === best && GENRE_KEYWORDS[x].includes(tok));
      if (g) return { genre: g, matched: true };
    }
    return { genre: MUSIC_GENRES.find((x) => scores.get(x) === best)!, matched: true };
  }
  const specific = tokens.filter((t) => !GENERIC_WORDS.has(t) && !GENRE_KEYWORDS.AMBIENT_CALM.includes(t));
  return { genre: DEFAULT_MUSIC_GENRE, matched: specific.length === 0 };
}

/**
 * Catalogue search. Tracks of the matched genre first; within the genre, tracks long enough for
 * `minDurationSec` come first (shortest sufficient first), then the rest (longest first).
 * Returns an empty list when the query names a mood the catalogue does not have.
 */
export function searchMusicCatalog(query: string, opts: { minDurationSec?: number; limit?: number } = {}): { genre: MusicGenre; matched: boolean; tracks: MusicTrack[] } {
  const { genre, matched } = moodToMusicGenre(query);
  if (!matched) return { genre, matched, tracks: [] };
  const min = opts.minDurationSec ?? 0;
  const inGenre = MUSIC_CATALOG.filter((t) => t.genre === genre);
  const long = inGenre.filter((t) => t.durationSec >= min).sort((a, b) => a.durationSec - b.durationSec);
  const short = inGenre.filter((t) => t.durationSec < min).sort((a, b) => b.durationSec - a.durationSec);
  return { genre, matched, tracks: [...long, ...short].slice(0, Math.max(1, opts.limit ?? 10)) };
}

/** Best single catalogue track for a query, or null when the mood is not covered. */
export function resolveMusicFromCatalog(query: string, durationSec = 0): MusicTrack | null {
  return searchMusicCatalog(query, { minDurationSec: durationSec, limit: 1 }).tracks[0] || null;
}
