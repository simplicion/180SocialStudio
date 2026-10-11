import { z } from "zod";
import * as path from "path";
import * as fs from "fs";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import ffmpeg from "../../ffmpeg-setup";
import { MUSIC_CATALOG, MusicTrack, moodToMusicGenre, searchMusicCatalog } from "@workspace/video-contracts";
import { FreeMediaProviderId, searchFreeMedia } from "./free-media-providers";

export const BgmGenreSchema = z.enum([
  "AMBIENT_CALM",
  "ELECTRONIC_UPBEAT",
  "CINEMATIC_DRAMATIC",
  "LOFI_STUDY",
  "ACOUSTIC_WARM",
]);

export type BgmGenre = z.infer<typeof BgmGenreSchema>;

export const BgmSearchInputSchema = z.object({
  genre: BgmGenreSchema.optional().default("AMBIENT_CALM"),
  volumeDb: z.number().optional().default(-22.0),
  targetDurationSec: z.number().optional().default(60.0),
});

export type BgmSearchInput = z.infer<typeof BgmSearchInputSchema>;

export interface SourcedBgmTrack {
  id: string;
  genre: BgmGenre;
  filePath: string;
  durationSec: number;
  volumeDb: number;
  isPublicDomain: boolean;
  /** Licence and credit line of the downloaded track (absent for the synthesized fallback). */
  license?: string;
  attribution?: string;
}

export interface BgmSearchOutput {
  bgmTrack: SourcedBgmTrack;
}

/** One music search hit as returned by `GET /media-editor/stock/music`. */
export interface MusicSearchHit {
  title: string;
  /** HTTPS audio URL the phone can stream/download directly. */
  url: string;
  durationSec: number;
  license: string;
  attribution: string | null;
  artist: string | null;
  genre: BgmGenre | null;
  provider: "catalog" | "freesound" | FreeMediaProviderId;
  sourcePage: string | null;
  licenseUrl?: string | null;
}

export interface MusicSearchResult {
  query: string;
  genre: BgmGenre;
  /** false when the query names a mood the curated catalogue does not cover. */
  genreMatched: boolean;
  tracks: MusicSearchHit[];
  /** Providers consulted: always "catalog"; "freesound" only when FREESOUND_API_KEY is set; free providers (Openverse, Commons, Internet Archive, Jamendo when enabled). */
  providers: Array<"catalog" | "freesound" | FreeMediaProviderId>;
  warnings: string[];
}

export class BgmSearchTool extends VideoDirectorTool<BgmSearchInput, BgmSearchOutput> {
  readonly name = "bgm_search";
  readonly description = "Autonomously retrieves and caches royalty-free public-domain background music (CC-0) matching video mood.";
  readonly stage = "TIMELINE_COMPOSITION" as const;
  readonly inputSchema = BgmSearchInputSchema;

  /**
   * Curated royalty-free catalogue (Kevin MacLeod, CC BY, hosted on Wikimedia Commons), shared
   * with the AI Director via @workspace/video-contracts. The previous hard-coded "CC-0" URLs all
   * returned 404 and were mislabelled, so they were replaced by verified entries.
   */
  private static readonly AUDIO_CATALOG: Record<BgmGenre, MusicTrack[]> = BgmGenreSchema.options.reduce(
    (acc, g) => ({ ...acc, [g]: MUSIC_CATALOG.filter((t) => t.genre === g) }),
    {} as Record<BgmGenre, MusicTrack[]>
  );

  /** Mood keywords ("upbeat energetic", "chill lofi") -> genre. */
  static moodToGenre(query: string): { genre: BgmGenre; matched: boolean } {
    return moodToMusicGenre(query);
  }

  /**
   * Metadata-only music search for clients that play/download the track themselves (the phone).
   * Never downloads or transcodes anything on the server. Curated catalogue first; Freesound
   * (CC0 / CC BY only) is added when FREESOUND_API_KEY is configured. The key is read from the
   * environment only; without it Freesound is skipped and `providers` says so.
   */
  static async searchTracks(options: {
    query: string;
    limit?: number;
    minDurationSec?: number;
    fetchImpl?: typeof fetch;
  }): Promise<MusicSearchResult> {
    const query = options.query.trim();
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 30);
    const warnings: string[] = [];
    const providers: MusicSearchResult["providers"] = ["catalog"];
    const cat = searchMusicCatalog(query, { minDurationSec: options.minDurationSec, limit });
    const tracks: MusicSearchHit[] = cat.tracks.map((t) => ({
      title: t.title,
      url: t.url,
      durationSec: t.durationSec,
      license: t.license,
      attribution: t.attribution,
      artist: t.artist,
      genre: t.genre,
      provider: "catalog",
      sourcePage: t.sourcePage,
    }));

    const apiKey = process.env.FREESOUND_API_KEY;
    if (apiKey && tracks.length < limit) {
      providers.push("freesound");
      try {
        tracks.push(...(await BgmSearchTool.searchFreesoundMusic(query, apiKey, limit - tracks.length, options.fetchImpl || fetch)));
      } catch (err: any) {
        warnings.push(`freesound: ${err?.message || err}`);
      }
    }
    if (tracks.length < limit) {
      // Keyless, licence-filtered providers (CC0 / PD / CC BY / CC BY-SA only), ranked by licence and length fit.
      const free = await searchFreeMedia({
        query,
        kind: "music",
        limit: limit - tracks.length,
        minDurationSec: options.minDurationSec ?? 20,
        targetDurationSec: options.minDurationSec,
        fetchImpl: options.fetchImpl,
      });
      warnings.push(...free.warnings);
      providers.push(...free.providers.map((p) => p.id));
      const seen = new Set(tracks.map((t) => t.url));
      for (const i of free.items) {
        if (seen.has(i.url)) continue;
        tracks.push({
          title: i.title,
          url: i.url,
          durationSec: Math.round(i.durationSec || 0),
          license: i.license,
          attribution: i.attribution,
          artist: null,
          genre: null,
          provider: i.provider,
          sourcePage: i.sourcePage,
          licenseUrl: i.licenseUrl,
        });
      }
    }
    if (tracks.length === 0) {
      warnings.push(`no royalty-free track matches "${query}"${apiKey ? "" : " (FREESOUND_API_KEY is not set, so only the curated catalogue was searched)"}`);
    }
    return { query, genre: cat.genre, genreMatched: cat.matched, tracks: tracks.slice(0, limit), providers, warnings };
  }

  /** Freesound text search restricted to music-length, commercially usable (CC0 / CC BY) sounds. */
  private static async searchFreesoundMusic(query: string, apiKey: string, limit: number, fetchImpl: typeof fetch): Promise<MusicSearchHit[]> {
    const params = new URLSearchParams({
      query: `${query} music`,
      filter: "duration:[30 TO 900]",
      fields: "id,name,username,duration,license,previews,url",
      page_size: String(Math.min(limit * 2, 30)),
      sort: "rating_desc",
    });
    const res = await fetchImpl(`https://freesound.org/apiv2/search/text/?${params}`, {
      headers: { Authorization: `Token ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`search failed with HTTP ${res.status}`);
    const data: any = await res.json();
    const out: MusicSearchHit[] = [];
    for (const r of data?.results || []) {
      const license = BgmSearchTool.freesoundLicense(String(r.license || ""));
      const url = r.previews?.["preview-hq-mp3"] || r.previews?.["preview-lq-mp3"];
      if (!license || typeof url !== "string" || !/^https:\/\//i.test(url)) continue;
      out.push({
        title: String(r.name || `Freesound #${r.id}`),
        url,
        durationSec: Math.round(Number(r.duration) || 0),
        license,
        attribution: license === "CC0-1.0" ? null : `"${r.name}" by ${r.username} (freesound.org), licensed under ${license.replace(/-(\d)/, " $1").replace(/-/g, " ")}`,
        artist: r.username ? String(r.username) : null,
        genre: null,
        provider: "freesound",
        sourcePage: typeof r.url === "string" ? r.url : null,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Freesound licence URL -> short name; null for licences unsuitable for published videos (NC, Sampling+). */
  private static freesoundLicense(url: string): string | null {
    const u = url.toLowerCase();
    if (u.includes("publicdomain/zero")) return "CC0-1.0";
    const m = u.match(/licenses\/by\/(\d\.\d)/);
    return m ? `CC-BY-${m[1]}` : null;
  }

  async execute(input: BgmSearchInput, context: DirectorExecutionContext): Promise<BgmSearchOutput> {
    const genre = input.genre || "AMBIENT_CALM";
    context.log?.(`[BgmSearchTool] Sourcing royalty-free BGM track for genre: ${genre}...`);

    const audioCacheDir = path.join(context.tempDir, "bgm");
    if (!fs.existsSync(audioCacheDir)) {
      fs.mkdirSync(audioCacheDir, { recursive: true });
    }

    const outputWavPath = path.join(audioCacheDir, `bgm_${genre.toLowerCase()}.wav`);
    const creditPath = `${outputWavPath}.credit.json`;
    let chosen: MusicTrack | null = null;
    if (fs.existsSync(outputWavPath) && fs.existsSync(creditPath)) {
      try {
        chosen = JSON.parse(fs.readFileSync(creditPath, "utf8"));
      } catch {
        chosen = null;
      }
    }

    if (!fs.existsSync(outputWavPath)) {
      let downloadedOnline = false;
      const candidates = BgmSearchTool.AUDIO_CATALOG[genre]?.length ? BgmSearchTool.AUDIO_CATALOG[genre] : BgmSearchTool.AUDIO_CATALOG.AMBIENT_CALM;

      for (const candidate of candidates) {
        try {
          context.log?.(`[BgmSearchTool] Attempting stream from royalty-free catalogue: ${candidate.title}...`);
          const res = await fetch(candidate.url);
          if (res.ok) {
            const rawBuffer = Buffer.from(await res.arrayBuffer());
            const tempDownloadPath = path.join(audioCacheDir, `raw_stream_${Date.now()}.bin`);
            fs.writeFileSync(tempDownloadPath, rawBuffer);

            // Transcode to 48kHz stereo 16-bit WAV with loop/target duration
            await new Promise<void>((resolve, reject) => {
              ffmpeg(tempDownloadPath)
                .toFormat("wav")
                .audioChannels(2)
                .audioFrequency(48000)
                .duration(input.targetDurationSec || 60.0)
                .output(outputWavPath)
                .on("end", () => {
                  try {
                    fs.unlinkSync(tempDownloadPath);
                  } catch {
                    // Ignore temp delete error
                  }
                  resolve();
                })
                .on("error", (err: any) => reject(err))
                .run();
            });

            downloadedOnline = true;
            chosen = candidate;
            context.log?.(`[BgmSearchTool] Successfully transcoded royalty-free BGM: ${candidate.title} (${candidate.license})`);
            break;
          }
        } catch (e: any) {
          context.log?.(`[BgmSearchTool] Online stream failed for candidate: ${e.message}, trying next...`);
        }
      }

      if (!downloadedOnline) {
        // Fallback: Synthesize smooth ambient harmonic soundbed (48kHz stereo WAV)
        context.log?.("[BgmSearchTool] Synthesizing acoustic harmonic soundbed locally...");
        this.synthesizeAmbientDrone(outputWavPath, input.targetDurationSec || 60.0, genre);
      } else if (chosen) {
        fs.writeFileSync(creditPath, JSON.stringify(chosen));
      }
    }

    const bgmTrack: SourcedBgmTrack = {
      id: `bgm_${genre.toLowerCase()}`,
      genre,
      filePath: outputWavPath,
      durationSec: input.targetDurationSec || 60.0,
      volumeDb: input.volumeDb ?? -22.0,
      // Catalogue tracks are CC BY (credit required); only the locally synthesized drone is free of terms.
      isPublicDomain: !chosen,
      ...(chosen ? { license: chosen.license, attribution: chosen.attribution } : {}),
    };

    context.artifacts.set("sourced_bgm_track", bgmTrack);
    return { bgmTrack };
  }

  /**
   * Synthesizes warm 48kHz stereo ambient drone backing track
   */
  private synthesizeAmbientDrone(outputPath: string, durationSec: number, genre: BgmGenre): void {
    const sampleRate = 48000;
    const totalSamples = Math.floor(sampleRate * durationSec);
    const pcmBuffer = Buffer.alloc(totalSamples * 4); // stereo 16-bit

    const baseFreq = genre === "ELECTRONIC_UPBEAT" ? 110 : genre === "CINEMATIC_DRAMATIC" ? 65.41 : 130.81; // C3/C2

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;

      // Soft pulsating multi-harmonic wave
      const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.25 * t);
      const fundamental = Math.sin(2 * Math.PI * baseFreq * t);
      const fifth = Math.sin(2 * Math.PI * (baseFreq * 1.5) * t) * 0.4;
      const octave = Math.sin(2 * Math.PI * (baseFreq * 2.0) * t) * 0.2;

      const sample = (fundamental + fifth + octave) * pulse * 0.35;
      const int16 = Math.max(-32767, Math.min(32767, Math.floor(sample * 32767)));

      pcmBuffer.writeInt16LE(int16, i * 4);
      pcmBuffer.writeInt16LE(int16, i * 4 + 2);
    }

    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcmBuffer.length, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 4, 28);
    header.writeUInt16LE(4, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcmBuffer.length, 40);

    fs.writeFileSync(outputPath, Buffer.concat([header, pcmBuffer]));
  }
}
