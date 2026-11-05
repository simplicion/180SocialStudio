package com.workspace180.socialmanager.mediaengine

import android.content.Context
import android.graphics.BitmapFactory
import android.media.ExifInterface
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.OverlaySettings
import androidx.media3.common.VideoCompositorSettings
import androidx.media3.common.util.Size
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.SpeedProvider
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Crop
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.effect.ScaleAndRotateTransformation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.VideoEncoderSettings
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/** Local files for everything the IR references. The IR itself carries no device paths. */
data class RenderMedia(
    /** assetId -> local video path for `clips[].assetId`. */
    val assetPaths: Map<String, String>,
    /** overlay id -> local video path (downloaded/cached B-roll). */
    val overlayPaths: Map<String, String>,
    /** music id -> local audio path. */
    val musicPaths: Map<String, String>,
    /** font family (e.g. "Inter") or "family:weight" (e.g. "Inter:800") -> .ttf/.otf path. */
    val fontPaths: Map<String, String>,
    /** Local image file (PNG/JPEG/WebP) for `watermark`, downloaded by the Dart side. Null = none supplied. */
    val watermarkPath: String? = null,
    /** sfx id -> local audio path for `audio.sfx`. */
    val sfxPaths: Map<String, String> = emptyMap(),
    /** assetId -> 720p proxy of that clip; used by the PREVIEW composition only (the export reads the originals). */
    val proxyPaths: Map<String, String> = emptyMap(),
)

/** Events are plain maps so they can go straight over the EventChannel. */
typealias RenderEventSink = (Map<String, Any?>) -> Unit

/**
 * Renders a `mobile-editir/1` timeline to an H.264/AAC MP4 with AndroidX Media3 Transformer.
 *
 * Composition layout:
 *  - No B-roll: one sequence of main clips carrying audio+video.
 *  - With B-roll: a video-only sequence where B-roll pieces replace the main picture for their
 *    interval (full-canvas cover, muted), plus an audio-only sequence of the main clips so speech
 *    continues underneath (contract §3.3).
 *  - Music: an extra audio-only sequence (gap -> looped source items) with a timeline gain
 *    envelope for fades and speech ducking (contract §3.6).
 *  - Composition-level effects on the output timeline: frame-rate cap, zoom punch-ins,
 *    transition dips, captions.
 *  - HDR (PQ/HLG) sources are tone-mapped to SDR in OpenGL because the output is 8-bit H.264.
 */
@UnstableApi
class EditIrRenderer(
    private val context: Context,
    private val jobId: String,
    private var ir: MobileEditIr,
    private var media: RenderMedia,
    private val outputPath: String,
    private val emit: RenderEventSink,
    private val options: RenderOptions = RenderOptions(),
) {
    /** Final output size: the canvas, or scaled down so its short side is [RenderOptions.maxShortSide] (even sizes). */
    private val outputSize: Pair<Int, Int> = run {
        val short = minOf(ir.canvas.width, ir.canvas.height)
        val target = options.maxShortSide
        if (target == null || target >= short) ir.canvas.width to ir.canvas.height
        else {
            val k = target.toDouble() / short
            ((ir.canvas.width * k).roundToInt() / 2 * 2) to ((ir.canvas.height * k).roundToInt() / 2 * 2)
        }
    }

    /** Media3's default heuristic (w x h x fps x 0.07 x 2), doubled for "high". */
    private val videoBitrate: Int get() =
        (outputSize.first.toDouble() * outputSize.second * ir.canvas.fps * 0.07 * 2 * (if (options.quality == "high") 2 else 1)).toInt()

    private companion object {
        const val MB = 1024L * 1024L
        const val STORAGE_HEADROOM_BYTES = 32 * MB
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val warnings = mutableListOf<String>().apply { addAll(ir.parseWarnings) }
    private var transformer: Transformer? = null
    @Volatile private var cancelled = false
    @Volatile private var finished = false
    /** Set after OpenGL HDR tone-mapping failed on this GPU: retry once with MediaCodec tone-mapping (API 31+). */
    private var hdrModeOverride: Int? = null

    /** Probes survive the HDR retries (the files do not change). */
    private val probes = HashMap<String, Probe>()

    /** Make-up gain for export loudness (null = off / nothing to measure). */
    private var loudnessGainDb: Double? = null

    /** The composition builder for the current [ir] / [media] (rebuilt when a retry changes them). */
    private fun factory() = CompositionFactory(context, ir, media, options, CompositionMode.EXPORT, warnings, probes) { cancelled }

    private fun buildComposition(): Composition = factory().build(hdrModeOverride, loudnessGainDb)

    private fun probe(path: String): Probe = factory().probe(path)

    private fun assetPath(assetId: String): String = factory().assetPath(assetId)

    /** Builds the composition on a worker thread, then starts the export on the main looper. */
    fun start() {
        Thread({
            val composition = try {
                // Stock clips are often fragmented MP4s that cannot be clipped mid-file: make them seekable first.
                media = media.copy(
                    assetPaths = media.assetPaths.mapValues { MediaTools.ensureSeekable(it.value) },
                    overlayPaths = media.overlayPaths.mapValues { MediaTools.ensureSeekable(it.value) },
                )
                loudnessGainDb = factory().loudnessGain()
                buildComposition()
            } catch (e: EditIrException) {
                fail(e.code, e.message ?: "invalid editIR", null)
                return@Thread
            } catch (e: Exception) {
                // Never surface a bare exception class: name the root cause and where it was thrown.
                android.util.Log.e("EditIrRenderer", "Render setup failed for job $jobId", e)
                fail("RENDER_SETUP_FAILED", "Could not prepare the export: ${describeRootCause(e)}", e.stackTraceToString().take(4000))
                return@Thread
            }
            try {
                checkFreeSpace()
            } catch (e: MediaEngineError) {
                fail(e.code, e.message ?: "insufficient storage", null)
                return@Thread
            }
            mainHandler.post { startExport(composition) }
        }, "EditIrRenderer-$jobId").start()
    }

    fun cancel() {
        mainHandler.post {
            if (finished) return@post
            cancelled = true
            finished = true
            transformer?.cancel()
            File(outputPath).delete()
            emit(event("cancelled", progress = null))
        }
    }


    // ---------------------------------------------------------------------------------------
    // Export

    /**
     * Refuses to start when the output volume clearly cannot hold the result. The estimate is
     * duration x (video + audio bitrate) with a 1.5x margin plus fixed headroom for the muxer.
     * The video bitrate mirrors Media3's default encoder heuristic (w x h x fps x 0.07 x 2).
     */
    private fun checkFreeSpace() {
        val dir = File(outputPath).absoluteFile.parentFile ?: return
        dir.mkdirs()
        val available = try {
            StatFs(dir.path).availableBytes
        } catch (e: IllegalArgumentException) {
            return // Not a statable path; let the export report the real I/O error.
        }
        val videoBps = videoBitrate.toDouble()
        val audioBps = 192_000.0
        val needed = (ir.durationMs / 1000.0 * (videoBps + audioBps) / 8 * 1.5).toLong() + STORAGE_HEADROOM_BYTES
        if (available < needed) {
            throw MediaEngineError(
                "INSUFFICIENT_STORAGE",
                "Not enough free storage to export: about ${needed / MB} MB needed, ${available / MB} MB available. Free up space and try again.",
            )
        }
    }

    private fun startExport(composition: Composition) {
        if (cancelled) return
        val out = File(outputPath)
        out.parentFile?.mkdirs()
        if (out.exists() && !out.delete()) {
            fail("IO_ERROR", "Cannot overwrite $outputPath", null)
            return
        }
        val hasAudio = ir.clips.any { probe(assetPath(it.assetId)).hasAudio } || ir.audio.music.isNotEmpty() || ir.audio.sfx.isNotEmpty() || ir.audio.voiceovers.isNotEmpty()
        val builder = Transformer.Builder(context)
            .setVideoMimeType(MimeTypes.VIDEO_H264)
        if (options.quality == "high") {
            builder.setEncoderFactory(
                DefaultEncoderFactory.Builder(context)
                    .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(videoBitrate).build())
                    .build(),
            )
        }
        if (hasAudio) {
            builder.setAudioMimeType(MimeTypes.AUDIO_AAC)
        }
        val t = builder
            .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, exportResult: ExportResult) = onDone(exportResult)
                override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                    if (cancelled) return
                    File(outputPath).delete()
                    val detail = "${exportException.errorCodeName}: ${exportException.message ?: ""} ${exportException.cause?.message ?: ""}".trim()
                    if (isOutOfSpace(exportException)) {
                        fail("INSUFFICIENT_STORAGE", "The device ran out of storage while exporting. Free up space and try again.", detail)
                    } else if (isGlHdrUnsupported(exportException) && hdrModeOverride == null && Build.VERSION.SDK_INT >= 31) {
                        // This GPU cannot run Media3's OpenGL HDR shader (no GL_EXT_YUV_target): retry once with the
                        // decoder doing the tone-mapping instead.
                        android.util.Log.w("EditIrRenderer", "OpenGL HDR tone-mapping unsupported; retrying with MediaCodec tone-mapping")
                        hdrModeOverride = Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_MEDIACODEC
                        warnings.add("HDR tone-mapped by the video decoder (GPU tone-mapping unsupported on this device)")
                        val retry = try {
                            buildComposition()
                        } catch (e: Exception) {
                            fail("EXPORT_FAILED", "Could not prepare the HDR retry: ${describeRootCause(e)}", e.stackTraceToString().take(4000))
                            return
                        }
                        startExport(retry)
                    } else if ((isGlHdrUnsupported(exportException) || (hdrModeOverride != null && isHdrError(exportException))) &&
                        hdrOverlayIds().isNotEmpty() && ir.clips.none { probe(assetPath(it.assetId)).isHdr }
                    ) {
                        // Only stock B-roll / overlay clips are HDR and this phone cannot convert them: export without
                        // them (the creator's own footage is fine) and say which ones were left out.
                        val drop = hdrOverlayIds()
                        ir.overlays.filter { it.id in drop }.forEach {
                            warnings.add("The B-roll at ${"%.1f".format(it.timelineStartMs / 1000.0)}s is HDR and this phone cannot convert HDR, so it was left out")
                        }
                        ir = ir.copy(overlays = ir.overlays.filter { it.id !in drop })
                        hdrModeOverride = null
                        val retry = try {
                            buildComposition()
                        } catch (e: Exception) {
                            fail("EXPORT_FAILED", "Could not prepare the export without the HDR B-roll: ${describeRootCause(e)}", e.stackTraceToString().take(4000))
                            return
                        }
                        startExport(retry)
                    } else if (isGlHdrUnsupported(exportException) || (hdrModeOverride != null && isHdrError(exportException))) {
                        fail(
                            "HDR_NOT_SUPPORTED",
                            "This device cannot convert HDR video to SDR for export (its GPU and video decoder lack HDR tone-mapping). Record in SDR (turn off HDR in the camera) or export on another device.",
                            detail.take(4000),
                        )
                    } else {
                        android.util.Log.e("EditIrRenderer", "Export failed for job $jobId", exportException)
                        // The top-level message is often generic ("Video frame processing error"); add the deepest cause.
                        fail("EXPORT_FAILED", "${exportException.errorCodeName}: ${describeRootCause(exportException)}", detail)
                    }
                }
            })
            .build()
        transformer = t
        emit(event("started", progress = 0.0))
        try {
            t.start(composition, outputPath)
        } catch (e: Exception) {
            android.util.Log.e("EditIrRenderer", "Export start failed for job $jobId", e)
            val rootMsg = e.cause?.message ?: e.message ?: e.javaClass.simpleName
            fail("EXPORT_FAILED", "Could not start video export: $rootMsg", e.stackTraceToString())
            return
        }
        pollProgress()
    }

    private fun pollProgress() {
        val holder = ProgressHolder()
        val tick = object : Runnable {
            override fun run() {
                val t = transformer ?: return
                if (finished) return
                if (t.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
                    emit(event("progress", progress = holder.progress / 100.0))
                }
                mainHandler.postDelayed(this, 250)
            }
        }
        mainHandler.postDelayed(tick, 250)
    }

    private fun onDone(result: ExportResult) {
        if (finished) return
        finished = true
        // Verify the file we actually wrote instead of trusting the export callback.
        val verified = try {
            MediaTools.getVideoInfo(outputPath)
        } catch (e: Exception) {
            fail("OUTPUT_INVALID", "Export reported success but the output could not be read: ${e.message}", null, force = true)
            return
        }
        emit(
            event("completed", progress = 1.0) + mapOf(
                "outputPath" to outputPath,
                "durationMs" to verified["durationMs"],
                "width" to verified["displayWidth"],
                "height" to verified["displayHeight"],
                "hasAudio" to verified["hasAudio"],
                "fileSizeBytes" to File(outputPath).length(),
                "videoEncoder" to result.videoEncoderName,
                "audioEncoder" to result.audioEncoderName,
                "expectedDurationMs" to ir.durationMs,
                "warnings" to synchronized(warnings) { warnings.distinct() },
            ),
        )
    }

    /** "IllegalStateException: <message> (at Class.method:line)" for the deepest cause, never just a class name. */
    private fun describeRootCause(e: Throwable): String {
        val root = generateSequence(e) { it.cause }.take(8).last()
        val frame = root.stackTrace.firstOrNull()
        val where = frame?.let { " (at ${it.className.substringAfterLast('.')}.${it.methodName}:${it.lineNumber})" } ?: ""
        // GL errors append the whole shader source; keep the first line(s) only.
        val msg = (root.message ?: "no message").lineSequence().filter { it.isNotBlank() }.take(2).joinToString(" | ").take(300)
        return "${root.javaClass.simpleName}: $msg$where"
    }

    private fun causeText(e: Throwable) = generateSequence(e) { it.cause }.take(8).joinToString(" ") { it.message ?: "" }

    private fun isGlHdrUnsupported(e: Throwable) = "GL_EXT_YUV_target" in causeText(e)

    /** Video overlays (B-roll, PiP) whose file is HDR. */
    private fun hdrOverlayIds(): Set<String> = ir.overlays
        .filter { !it.isImage }
        .mapNotNull { o -> media.overlayPaths[o.id]?.takeIf { p -> runCatching { probe(p).isHdr }.getOrDefault(false) }?.let { o.id } }
        .toSet()

    private fun isHdrError(e: Throwable) = Regex("HDR|tone", RegexOption.IGNORE_CASE).containsMatchIn(causeText(e)) ||
        (e as? ExportException)?.errorCode == ExportException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED

    private fun isOutOfSpace(e: Throwable): Boolean =
        generateSequence(e) { it.cause }.take(8).any { (it.message ?: "").let { m -> "ENOSPC" in m || "No space left" in m } }

    private fun fail(code: String, message: String, detail: String?, force: Boolean = false) {
        mainHandler.post {
            if (finished && !force) return@post
            finished = true
            emit(event("failed", progress = null) + mapOf("errorCode" to code, "message" to message, "detail" to detail))
        }
    }

    private fun event(state: String, progress: Double?): Map<String, Any?> =
        mapOf("jobId" to jobId, "state" to state, "progress" to progress)
}
