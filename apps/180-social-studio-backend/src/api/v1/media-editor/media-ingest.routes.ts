import { Request, Response } from "express";
import { YtDlpService, AutoClipperService, ProductionRenderQueue } from "@workspace/video-engine-runtime";
import path from "path";
import fs from "fs";

export async function ingestMetadataHandler(req: Request, res: Response) {
  try {
    const url = typeof req.query.url === "string" ? req.query.url.trim() : "";
    if (!url) {
      return res.status(400).json({ success: false, error: "URL_REQUIRED", message: "Video URL is required." });
    }

    const val = YtDlpService.validateUrl(url);
    if (!val.valid) {
      return res.status(400).json({ success: false, error: "INVALID_URL", message: val.error });
    }

    const metadata = await YtDlpService.fetchMetadata(val.normalizedUrl!);
    return res.status(200).json({ success: true, metadata });
  } catch (err: any) {
    console.error("[MediaIngest Error]:", err?.message || err);
    return res.status(502).json({
      success: false,
      error: "METADATA_FETCH_FAILED",
      message: err?.message || "Failed to fetch metadata from video URL.",
    });
  }
}

export async function ingestDownloadHandler(req: Request, res: Response) {
  try {
    const { url, extractAudio = false, timeRange } = req.body || {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ success: false, error: "URL_REQUIRED", message: "Video URL is required." });
    }

    const val = YtDlpService.validateUrl(url);
    if (!val.valid) {
      return res.status(400).json({ success: false, error: "INVALID_URL", message: val.error });
    }

    const uploadsDir = path.resolve(process.cwd(), "uploads", "ingest");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    if (extractAudio) {
      const result = await YtDlpService.extractAudio(val.normalizedUrl!, {
        outputDir: uploadsDir,
        timeRange,
      });

      const relPath = `/uploads/ingest/${path.basename(result.audioPath)}`;
      return res.status(200).json({
        success: true,
        type: "audio",
        url: relPath,
        localPath: result.audioPath,
        metadata: result.metadata,
      });
    }

    const result = await YtDlpService.downloadVideo(val.normalizedUrl!, {
      outputDir: uploadsDir,
      timeRange,
    });

    const relPath = `/uploads/ingest/${path.basename(result.outputPath)}`;
    return res.status(200).json({
      success: true,
      type: "video",
      url: relPath,
      localPath: result.outputPath,
      metadata: result.metadata,
    });
  } catch (err: any) {
    console.error("[MediaIngest Download Error]:", err?.message || err);
    return res.status(502).json({
      success: false,
      error: "DOWNLOAD_FAILED",
      message: err?.message || "Failed to download media from video URL.",
    });
  }
}

export async function ingestAutoClipHandler(req: Request, res: Response) {
  try {
    const {
      url,
      maxShorts = 3,
      targetShortDurationSec = 35,
      aspectRatio = "9:16",
      subtitleStyle = "hormozi-yellow",
      backgroundMusic = "upbeat",
      includeMotionGraphics = true,
      language = "en",
      sync = false,
    } = req.body || {};

    if (!url || typeof url !== "string") {
      return res.status(400).json({ success: false, error: "URL_REQUIRED", message: "Video URL is required." });
    }

    const val = YtDlpService.validateUrl(url);
    if (!val.valid) {
      return res.status(400).json({ success: false, error: "INVALID_URL", message: val.error });
    }

    const baseUrl = `${req.protocol}://${req.get("host") || "localhost:4007"}`;
    const queue = ProductionRenderQueue.getInstance();

    if (sync) {
      // Direct execution
      const result = await AutoClipperService.autoClip(val.normalizedUrl!, {
        maxShorts,
        targetShortDurationSec,
        aspectRatio,
        subtitleStyle,
        backgroundMusic,
        includeMotionGraphics,
        language,
        baseUrl,
      });
      return res.status(200).json({ success: true, result });
    }

    // High-concurrency zero-latency job dispatch
    const ticket = queue.enqueue(
      "auto-clip",
      async (updateProgress) => {
        updateProgress(10);
        const res = await AutoClipperService.autoClip(val.normalizedUrl!, {
          maxShorts,
          targetShortDurationSec,
          aspectRatio,
          subtitleStyle,
          backgroundMusic,
          includeMotionGraphics,
          language,
          baseUrl,
        });
        updateProgress(100);
        return res;
      },
      { data: { url: val.normalizedUrl, maxShorts, aspectRatio, subtitleStyle, backgroundMusic } }
    );

    return res.status(202).json({
      success: true,
      ticket,
      message: "Auto-clip job queued successfully with zero latency.",
    });
  } catch (err: any) {
    console.error("[MediaIngest AutoClip Error]:", err?.message || err);
    return res.status(502).json({
      success: false,
      error: "AUTOCLIP_FAILED",
      message: err?.message || "Failed to auto-clip media from video URL.",
    });
  }
}

export function queueJobStatusHandler(req: Request, res: Response) {
  const jobId = req.params.jobId;
  const queue = ProductionRenderQueue.getInstance();
  const job = queue.getJob(jobId);

  if (!job) {
    return res.status(404).json({ success: false, error: "JOB_NOT_FOUND", message: `Job ${jobId} not found.` });
  }

  return res.status(200).json({
    success: true,
    job: {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    },
  });
}
