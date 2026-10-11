import { Router } from "express";
import { VideoStudioController } from "../workspace-tools/video-studio/video-studio.controller";
import { AICompanyConfigService } from "@workspace/ai";
import { requireDesktopDevice, requireNativeDevice } from "../desktop/desktop-device";
import { audioUpload, transcribeHandler } from "./media-transcription";
import { translateCaptionsHandler } from "./caption-translation";
import { directorContextHandler } from "./director-context";

const router: Router = Router();

router.get("/projects", VideoStudioController.listProjects);
router.get("/projects/:id", VideoStudioController.getProject);
router.post("/projects", VideoStudioController.saveProject);
router.post("/ai-direct", requireDesktopDevice, VideoStudioController.executeAIDirector);
// Mobile: word-level STT for on-device clips (audio upload only; no server-side media processing).
router.post("/transcribe", requireNativeDevice, audioUpload, transcribeHandler);
// Caption text to another language or script (words only; timings stay on the device).
router.post("/captions/translate", requireNativeDevice, translateCaptionsHandler);
// Brand + calendar-script context and greeting (no media, no LLM). See AI_DIRECTOR_CONTRACT.md §2.5.
router.get("/director-context", directorContextHandler());
router.post("/generate-from-prompt", requireDesktopDevice, VideoStudioController.generateFromPrompt);
// No POST /render: server-side rendering was removed (media is processed on the device only).

// Unsplash API guidelines: a client that uses an Unsplash photo reports its `downloadLocation` here.
router.post("/stock/unsplash/track-download", async (req, res) => {
  try {
    const downloadLocation = req.body?.downloadLocation;
    if (typeof downloadLocation !== "string") return res.status(400).json({ success: false, error: "DOWNLOAD_LOCATION_REQUIRED" });
    const { trackUnsplashDownload } = require("@workspace/video-engine-runtime");
    return res.status(200).json({ success: await trackUnsplashDownload(downloadLocation) });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: "UNSPLASH_TRACK_FAILED", message: err?.message || String(err) });
  }
});

// Autonomous Stock Media Sourcing (Pexels + free licence-filtered providers, see FREE_MEDIA_SOURCES.md)
router.get("/stock/search", async (req, res) => {
  try {
    const { query, type = "all", orientation = "landscape", perPage = "12", page = "1" } = req.query;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ success: false, error: "Query parameter is required" });
    }

    const { PexelsClient, searchFreeMedia } = require("@workspace/video-engine-runtime");
    const n = parseInt(perPage as string, 10) || 12;
    const warnings: string[] = [];
    // Pexels needs PEXELS_API_KEY; without it (or on error) the free, licence-filtered providers still answer.
    const pexelsP = PexelsClient.searchStock({
      query,
      type: type as any,
      orientation: orientation as any,
      perPage: n,
      page: parseInt(page as string, 10) || 1,
    }).catch((err: any) => {
      warnings.push(`pexels: ${err?.message || err}`);
      return { videos: [], photos: [], totalResults: 0 };
    });
    const t = String(type);
    const targetAspect = orientation === "portrait" ? "9:16" : orientation === "square" ? "1:1" : "16:9";
    const none = { items: [], warnings: [] };
    const [results, fv, fp] = await Promise.all([
      pexelsP,
      t === "all" || t.startsWith("video") ? searchFreeMedia({ query, kind: "video", limit: n, orientation: orientation as any, targetAspect }).catch((err: any) => { warnings.push(`free-media: ${err?.message || err}`); return none; }) : none,
      t === "all" || t.startsWith("photo") || t.startsWith("image") ? searchFreeMedia({ query, kind: "image", limit: n, orientation: orientation as any, targetAspect }).catch((err: any) => { warnings.push(`free-media: ${err?.message || err}`); return none; }) : none,
    ]);
    const asStock = (i: any) => ({
      id: i.id, provider: i.provider, title: i.title, url: i.sourcePage, downloadUrl: i.url,
      previewVideoUrl: i.kind === "video" ? i.url : undefined, thumbnailUrl: i.previewUrl,
      duration: i.durationSec, width: i.width, height: i.height, photographer: i.attribution,
      license: i.license, licenseUrl: i.licenseUrl, attribution: i.attribution, sourcePage: i.sourcePage,
      ...(i.downloadLocation ? { downloadLocation: i.downloadLocation } : {}),
    });
    return res.status(200).json({
      success: true,
      ...results,
      videos: [...(results.videos || []), ...fv.items.map(asStock)],
      photos: [...(results.photos || []), ...fp.items.map(asStock)],
      warnings: Array.from(new Set([...warnings, ...fv.warnings, ...fp.warnings])),
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Unified Stock Media Sourcing (Pexels HD B-Roll, Pixabay Photos/Vectors/Animations, Freesound SFX)
router.get("/stock/unified", async (req, res) => {
  try {
    const { query, type = "all", orientation = "landscape", perPage = "12", page = "1" } = req.query;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ success: false, error: "Query parameter is required" });
    }

    const {
      PexelsClient,
      PixabayClient,
      StockDecisionBroker,
      DirectorToolRegistry,
      BgmSearchTool,
      searchFreeMedia,
    } = require("@workspace/video-engine-runtime");

    // Audio-only searches (music / sfx) must not return (or wait on) video and photo providers,
    // and `type=audio` used to search nothing at all: it now searches music.
    const wantsMusic = type === "audio" || type === "music" || type === "all";
    const wantsSfx = type === "sfx" || type === "all";
    const audioOnly = type === "audio" || type === "music" || type === "sfx";
    const emptyPexels = { videos: [], photos: [], totalResults: 0 };
    // Provider failures are reported to the client (warnings) instead of being turned into a silent empty list.
    const warnings: string[] = [];
    const warn = (provider: string) => (err: any) => {
      warnings.push(`${provider}: ${String(err?.message || err).slice(0, 200)}`);
    };
    const emptyPixabay = {
      query,
      totalHits: 0,
      page: 1,
      perPage: 12,
      videos: [],
      photos: [],
      illustrations: [],
      vectors: [],
      rateLimit: { limit: 100, remaining: 100, resetSeconds: 60 },
    };

    const pexelsPromise = audioOnly ? Promise.resolve(emptyPexels) : PexelsClient.searchStock({
      query,
      type: type as any,
      orientation: orientation as any,
      perPage: parseInt(perPage as string, 10) || 12,
      page: parseInt(page as string, 10) || 1,
    }).catch((err: any) => { warn("pexels")(err); return emptyPexels; });

    const pixabayPromise = audioOnly ? Promise.resolve(emptyPixabay) : PixabayClient.searchStock({
      query,
      orientation: orientation as any,
      perPage: parseInt(perPage as string, 10) || 12,
      page: parseInt(page as string, 10) || 1,
    }).catch((err: any) => { warn("pixabay")(err); return emptyPixabay; });

    const registry = DirectorToolRegistry.getInstance();
    const freesoundTool = registry.get("freesound_search");
    const os = require("os");
    const dummyCtx = { tempDir: os.tmpdir(), artifacts: new Map(), log: () => {} };

    const freesoundPromise = wantsSfx && freesoundTool
      ? freesoundTool.execute({ query, maxResults: 6 }, dummyCtx).catch((err: any) => { warn("freesound")(err); return { effects: [] }; })
      : Promise.resolve({ effects: [] });

    const musicPromise = wantsMusic
      ? BgmSearchTool.searchTracks({ query, limit: parseInt(perPage as string, 10) || 12 }).catch((err: any) => { warn("music")(err); return { tracks: [], warnings: [] }; })
      : Promise.resolve({ tracks: [], warnings: [] });

    // Zero-cost free media providers (Openverse, Wikimedia Commons, Internet Archive, Jamendo)
    const freeVideoPromise = (!audioOnly && (type === "all" || type === "video") && typeof searchFreeMedia === "function")
      ? searchFreeMedia({ query, kind: "video", limit: 6, orientation: orientation as any, targetAspect: orientation === "portrait" ? "9:16" : orientation === "square" ? "1:1" : "16:9" }).catch((err: any) => { warn("free-media")(err); return { items: [], warnings: [] }; })
      : Promise.resolve({ items: [] });

    const freePhotoPromise = (!audioOnly && (type === "all" || type === "photo" || type === "image") && typeof searchFreeMedia === "function")
      ? searchFreeMedia({ query, kind: "image", limit: 6, orientation: orientation as any, targetAspect: orientation === "portrait" ? "9:16" : orientation === "square" ? "1:1" : "16:9" }).catch((err: any) => { warn("free-media")(err); return { items: [], warnings: [] }; })
      : Promise.resolve({ items: [] });

    // Free music already comes back through BgmSearchTool.searchTracks (musicPromise); only SFX here.
    const freeAudioPromise = (wantsSfx && typeof searchFreeMedia === "function")
      ? searchFreeMedia({ query, kind: "sfx", limit: 6, maxDurationSec: 10 }).catch((err: any) => { warn("free-media")(err); return { items: [], warnings: [] }; })
      : Promise.resolve({ items: [] });

    const [pexels, pixabay, freesound, music, freeVideos, freePhotos, freeAudio] = await Promise.all([
      pexelsPromise,
      pixabayPromise,
      freesoundPromise,
      musicPromise,
      freeVideoPromise,
      freePhotoPromise,
      freeAudioPromise,
    ]);

    // FreesoundSfxTool returns `effects` (the old code read a non-existent `sfx` key, so audio was
    // always empty). Only real HTTPS previews are listed, never its local synthesized fallback.
    const sfxAudio = ((freesound as any).effects || [])
      .filter((e: any) => typeof e.downloadUrl === "string" && /^https:\/\//i.test(e.downloadUrl))
      .map((e: any) => ({ kind: "sfx", title: e.name, url: e.downloadUrl, durationSec: e.durationSec, license: null, provider: "freesound" }));
    const musicAudio = ((music as any).tracks || []).map((t: any) => ({ kind: "music", ...t }));

    const normFreeVideos = (freeVideos.items || []).map((item: any) => ({
      id: item.id,
      title: item.title,
      duration: item.durationSec || 0,
      durationSec: item.durationSec,
      url: item.url,
      // Same keys as the Pexels/Pixabay entries so existing clients (mobile, web) can use them.
      downloadUrl: item.url,
      thumbnailUrl: item.previewUrl,
      width: item.width,
      height: item.height,
      provider: item.provider,
      licenseUrl: item.licenseUrl,
      previewUrl: item.previewUrl || item.url,
      source: item.provider,
      license: item.license,
      attribution: item.attribution,
      sourcePage: item.sourcePage,
    }));

    const normFreePhotos = (freePhotos.items || []).map((item: any) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      previewUrl: item.previewUrl || item.url,
      width: item.width,
      height: item.height,
      downloadUrl: item.url,
      thumbnailUrl: item.previewUrl,
      provider: item.provider,
      licenseUrl: item.licenseUrl,
      ...(item.downloadLocation ? { downloadLocation: item.downloadLocation } : {}),
      source: item.provider,
      license: item.license,
      attribution: item.attribution,
      sourcePage: item.sourcePage,
    }));

    const normFreeAudio = (freeAudio.items || []).map((item: any) => ({
      kind: item.kind,
      id: item.id,
      title: item.title,
      url: item.url,
      durationSec: item.durationSec,
      provider: item.provider,
      license: item.license,
      attribution: item.attribution,
      sourcePage: item.sourcePage,
    }));

    const brokerDecision = StockDecisionBroker.evaluate({
      prompt: query,
      targetAspect: orientation === "portrait" ? "9:16" : "16:9",
      desiredType: type as any,
    });

    // Only real provider results. An empty list is returned as empty (with warnings), never filled with samples.
    const finalVideos = [...(pexels.videos || []), ...(pixabay.videos || []), ...normFreeVideos];
    for (const res2 of [music, freeVideos, freePhotos, freeAudio] as any[]) {
      for (const w of res2?.warnings || []) warnings.push(String(w).slice(0, 200));
    }
    const unifiedPhotos = [...(pexels.photos || []), ...(pixabay.photos || []), ...normFreePhotos];
    const unifiedIllustrations = [...(pixabay.illustrations || []), ...(pixabay.vectors || [])];
    const unifiedAudio = [...musicAudio, ...sfxAudio, ...normFreeAudio];
    const uniqueWarnings = Array.from(new Set(warnings));

    // `shape=unified` (mobile) skips the raw per-provider blocks, which roughly halves the payload.
    if (req.query.shape === "unified") {
      return res.status(200).json({
        success: true,
        query,
        unifiedVideos: finalVideos,
        unifiedPhotos,
        unifiedIllustrations,
        unifiedAudio,
        warnings: uniqueWarnings,
      });
    }

    return res.status(200).json({
      success: true,
      query,
      decision: brokerDecision,
      rateLimits: {
        pixabay: pixabay.rateLimit,
      },
      pexels,
      pixabay,
      freesound,
      music,
      freeMedia: {
        videos: normFreeVideos,
        photos: normFreePhotos,
        audio: normFreeAudio,
      },
      unifiedVideos: finalVideos,
      unifiedPhotos,
      unifiedIllustrations,
      unifiedAudio,
      warnings: uniqueWarnings,
    });

  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Royalty-free background music for the phone's AI Director / manual editor.
// Metadata + HTTPS URLs only: nothing is downloaded, transcoded or processed on the server.
// Auth: same as the other /stock routes (`protect` + `moduleGuard('media-editor')` on the mount).
router.get("/stock/music", async (req, res) => {
  try {
    const { query, limit = "10", minDurationSec } = req.query;
    if (!query || typeof query !== "string" || !query.trim()) {
      return res.status(400).json({ success: false, error: "QUERY_REQUIRED", message: "Query parameter is required (mood/genre keywords, e.g. 'upbeat energetic')" });
    }
    if (query.length > 120) {
      return res.status(400).json({ success: false, error: "QUERY_TOO_LONG", message: "Query must be at most 120 characters" });
    }
    const minDur = typeof minDurationSec === "string" ? parseFloat(minDurationSec) : NaN;
    const { BgmSearchTool } = require("@workspace/video-engine-runtime");
    const result = await BgmSearchTool.searchTracks({
      query,
      limit: parseInt(limit as string, 10) || 10,
      minDurationSec: Number.isFinite(minDur) && minDur > 0 ? minDur : undefined,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "MUSIC_SEARCH_FAILED", message: err?.message || String(err) });
  }
});

// 3D sticker library (Microsoft Fluent Emoji, MIT): name search over a daily-cached index, PNGs from jsDelivr.
router.get("/stock/stickers", async (req, res) => {
  try {
    const q = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (q.length > 60) {
      return res.status(400).json({ success: false, error: "QUERY_TOO_LONG", message: "Query must be at most 60 characters" });
    }
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "24"), 10) || 24, 1), 60);
    const { searchStickers } = require("@workspace/video-engine-runtime");
    const stickers = await searchStickers(q, limit);
    return res.status(200).json({ success: true, stickers });
  } catch (err: any) {
    return res.status(502).json({ success: false, error: "STICKER_SEARCH_FAILED", message: err?.message || String(err) });
  }
});

// Real-time Company AI Configuration Status
router.get("/ai-status", async (req, res) => {
  try {
    // Only the caller's own company (verified JWT); never a query/header value.
    const companyId = (req as any).user?.companyId;
    if (!companyId) return res.status(401).json({ success: false, error: "UNAUTHENTICATED", message: "Authentication required" });
    const status = await AICompanyConfigService.getStatus(companyId);
    return res.status(200).json({ success: true, ...status });
  } catch (err: any) {
    console.error("[media-editor] ai-status failed:", err?.message || err);
    return res.status(500).json({ success: false, error: "INTERNAL", message: "Unexpected error" });
  }
});

// Installer downloads are served by `/download/:platform` in routes/index.routes.ts (a real release URL or an honest 404).
// A second copy of that route used to live here and answered with a text file named like an installer; it was
// unreachable dead code and has been removed so it cannot come back.

export default router;

