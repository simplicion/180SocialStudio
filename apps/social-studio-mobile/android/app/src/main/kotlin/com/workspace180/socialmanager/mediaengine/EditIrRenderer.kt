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
        /** Layers on screen at the same moment (each is one compositor input). */
        const val MAX_LAYER_TRACKS = 4
        val IMAGE_EXTENSIONS = setOf("jpg", "jpeg", "png", "webp")
        val BUNDLED_INTER_WEIGHTS = listOf(400, 600, 800)
        const val MB = 1024L * 1024L
        const val STORAGE_HEADROOM_BYTES = 32 * MB
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val warnings = mutableListOf<String>()
    private var transformer: Transformer? = null
    @Volatile private var cancelled = false
    @Volatile private var finished = false
    /** Set after OpenGL HDR tone-mapping failed on this GPU: retry once with MediaCodec tone-mapping (API 31+). */
    private var hdrModeOverride: Int? = null

    private data class Probe(
        val durationMs: Long,
        val hasAudio: Boolean,
        val hasVideo: Boolean,
        val displayWidth: Int,
        val displayHeight: Int,
        val frameRate: Double?,
        val isHdr: Boolean,
        /** A photo (main-track still or freeze frame): shown for the clip's timeline length, no audio. */
        val isImage: Boolean = false,
    )
    private val probes = HashMap<String, Probe>()

    /** Builds the composition on a worker thread, then starts the export on the main looper. */
    fun start() {
        Thread({
            val composition = try {
                // Stock clips are often fragmented MP4s that cannot be clipped mid-file: make them seekable first.
                media = media.copy(
                    assetPaths = media.assetPaths.mapValues { MediaTools.ensureSeekable(it.value) },
                    overlayPaths = media.overlayPaths.mapValues { MediaTools.ensureSeekable(it.value) },
                )
                loudnessGainDb = loudnessGain()
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
    // Composition

    private fun probe(path: String): Probe = probes.getOrPut(path) {
        val f = File(path)
        if (!f.isFile) throw EditIrException("MISSING_MEDIA", "File not found: $path")
        if (f.extension.lowercase() in IMAGE_EXTENSIONS) {
            val (w, h) = imageDisplaySize(path) ?: throw EditIrException("MISSING_MEDIA", "Photo cannot be read: ${f.name}")
            return@getOrPut Probe(Long.MAX_VALUE / 4_000, hasAudio = false, hasVideo = true, w, h, frameRate = null, isHdr = false, isImage = true)
        }
        val info = MediaTools.getVideoInfo(path)
        Probe(
            durationMs = (info["durationMs"] as Number).toLong(),
            hasAudio = info["hasAudio"] as Boolean,
            hasVideo = info["hasVideo"] as Boolean,
            displayWidth = (info["displayWidth"] as Number).toInt(),
            displayHeight = (info["displayHeight"] as Number).toInt(),
            frameRate = (info["frameRate"] as Number?)?.toDouble(),
            isHdr = info["isHdr"] as Boolean,
        )
    }

    private fun assetPath(assetId: String) = media.assetPaths[assetId]
        ?: throw EditIrException("MISSING_MEDIA", "No local file supplied for assetId '$assetId'")

    private fun constantSpeed(speed: Float) = object : SpeedProvider {
        override fun getSpeed(timeUs: Long): Float = speed
        override fun getNextSpeedChangeTimeUs(timeUs: Long): Long = C.TIME_UNSET
    }

    private fun clippedItem(path: String, startUs: Long, endUs: Long): MediaItem =
        MediaItem.Builder()
            .setUri(Uri.fromFile(File(path)))
            .setClippingConfiguration(
                MediaItem.ClippingConfiguration.Builder()
                    .setStartPositionUs(startUs)
                    .setEndPositionUs(endUs)
                    .build(),
            )
            .build()

    private fun mainVideoEffects(clip: IrClip): List<Effect> {
        val fx = mutableListOf<Effect>()
        // Rotate/flip first so crop and fit work in the rotated picture's coordinates.
        // Media3 rotates counter-clockwise; the contract's rotationDeg is clockwise.
        if (clip.rotationDeg != 0) fx.add(ScaleAndRotateTransformation.Builder().setRotationDegrees(-clip.rotationDeg.toFloat()).build())
        if (clip.flipH) fx.add(ScaleAndRotateTransformation.Builder().setScale(-1f, 1f).build())
        val crop = clip.crop
        if (crop != null) {
            // Contract §3.2 NDC mapping.
            fx.add(
                Crop(
                    (2 * crop.x - 1).toFloat(),
                    (2 * (crop.x + crop.width) - 1).toFloat(),
                    (1 - 2 * (crop.y + crop.height)).toFloat(),
                    (1 - 2 * crop.y).toFloat(),
                ),
            )
            fx.add(Presentation.createForWidthAndHeight(ir.canvas.width, ir.canvas.height, Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP))
        } else {
            fx.add(Presentation.createForWidthAndHeight(ir.canvas.width, ir.canvas.height, Presentation.LAYOUT_SCALE_TO_FIT))
            // Presentation leaves the bars black; paint them in canvas.background when it differs.
            if (ir.canvas.background != Color.BLACK) {
                val p = probe(assetPath(clip.assetId))
                val swap = clip.rotationDeg % 180 != 0
                val w = if (swap) p.displayHeight else p.displayWidth
                val h = if (swap) p.displayWidth else p.displayHeight
                if (w > 0 && h > 0) fx.add(OverlayEffect(listOf(LetterboxFill(ir.canvas.background, w.toFloat() / h))))
            }
        }
        clip.filter?.let { f ->
            if (f.preset !in ColorGrade.PRESETS) warnings.add("filter preset '${f.preset}' unknown; only the adjustments applied")
            // One colour matrix, identical to the phone preview (ColorGrade.kt ⇄ color_grade.dart).
            if (!ColorGrade.isIdentity(f)) fx.add(ColorGrade.effect(f))
            if (f.vignette > 0.0) fx.add(OverlayEffect(listOf(ClipVignetteOverlay(f.vignette))))
        }
        return fx
    }

    private fun clipAudioProcessors(index: Int, clip: IrClip): List<AudioProcessor> {
        val durMs = (clip.timelineEndMs - clip.timelineStartMs).toDouble()
        // The longer of the transition's half-fade and the clip's own audio fade (mirrored by clipPreviewGain in Dart).
        val fadeIn = max(clip.transitionIn?.takeIf { it.type != "CUT" }?.durationMs?.div(2.0) ?: 0.0, clip.audioFadeInMs.toDouble())
        val next = ir.clips.getOrNull(index + 1)
        val fadeOut = max(next?.transitionIn?.takeIf { it.type != "CUT" }?.durationMs?.div(2.0) ?: 0.0, clip.audioFadeOutMs.toDouble())
        val model = ClipAudioGainModel(durMs, ir.audio.originalVolumeDb + clip.volumeDb, fadeIn, fadeOut)
        val gain = EnvelopeGainProcessor { tUs -> model.gainAtItemMs(tUs / 1000.0) }
        return if (clip.voiceCleanup) listOf(VoiceCleanupProcessor(), gain) else listOf(gain)
    }

    /** Timeline piece of the video track: either main-clip picture or a B-roll cutaway. */
    private data class Piece(val startMs: Double, val endMs: Double, val clipIndex: Int, val overlay: IrOverlay?)

    private fun effectiveOverlays(): List<Pair<IrOverlay, LongArray>> {
        val boundaries = ir.clips.map { it.timelineStartMs } + ir.durationMs
        fun snap(t: Long): Long = boundaries.minByOrNull { abs(it - t) }?.takeIf { abs(it - t) <= 40 } ?: t
        return ir.overlays.filter { !it.isLayer }.sortedBy { it.timelineStartMs }.mapNotNull { ov ->
            val path = media.overlayPaths[ov.id]
                ?: throw EditIrException("MISSING_MEDIA", "No local file supplied for overlay '${ov.id}' (download/resolve it before rendering, or remove it)")
            if (ov.isImage) {
                if (!File(path).isFile) throw EditIrException("MISSING_MEDIA", "Photo for overlay '${ov.id}' is missing")
                val s = snap(ov.timelineStartMs)
                val e = snap(min(ov.timelineEndMs, ir.durationMs))
                return@mapNotNull if (e - s < 1) null else ov to longArrayOf(s, e)
            }
            val p = probe(path)
            if (!p.hasVideo) throw EditIrException("MISSING_MEDIA", "Overlay '${ov.id}' file has no video track")
            if (!ov.muted) warnings.add("overlay ${ov.id}: muted=false not supported; B-roll audio is dropped")
            if (abs(ov.opacity - 1.0) > 1e-3) warnings.add("overlay ${ov.id}: opacity ${ov.opacity} rendered as 1.0")
            val available = p.durationMs - ov.sourceStartMs
            if (available <= 0) throw EditIrException("MISSING_MEDIA", "Overlay '${ov.id}' sourceStartMs is beyond the file duration")
            var end = min(ov.timelineEndMs, ir.durationMs)
            if (ov.timelineStartMs + available < end) {
                end = ov.timelineStartMs + available
                warnings.add("overlay ${ov.id}: source is ${available}ms, shorter than its slot; main video shown for the remainder")
            }
            val s = snap(ov.timelineStartMs)
            val e = snap(end)
            if (e - s < 1) null else ov to longArrayOf(s, e)
        }
    }

    private fun videoPieces(overlays: List<Pair<IrOverlay, LongArray>>): List<Piece> {
        val pieces = mutableListOf<Piece>()
        ir.clips.forEachIndexed { i, clip ->
            val cs = clip.timelineStartMs.toDouble()
            val ce = clip.timelineEndMs.toDouble()
            var cursor = cs
            for ((ov, r) in overlays) {
                val os = r[0].toDouble()
                val oe = r[1].toDouble()
                if (oe <= cursor || os >= ce) continue
                if (os > cursor) pieces.add(Piece(cursor, os, i, null))
                val bs = maxOf(os, cursor)
                val be = min(oe, ce)
                pieces.add(Piece(bs, be, i, ov))
                cursor = be
            }
            if (cursor < ce) pieces.add(Piece(cursor, ce, i, null))
        }
        return pieces.filter { it.endMs - it.startMs >= 1.0 }
    }

    private fun buildComposition(): Composition {
        val sequences = mutableListOf<EditedMediaItemSequence>()
        val overlays = effectiveOverlays()

        ir.clips.forEach { probe(assetPath(it.assetId)) }
        val anyAudio = ir.clips.any { probe(assetPath(it.assetId)).hasAudio }
        if (!anyAudio) warnings.add("main source has no audio track")

        fun mainItem(clip: IrClip, index: Int, startMs: Double, endMs: Double, removeAudio: Boolean, removeVideo: Boolean): EditedMediaItem {
            val path = assetPath(clip.assetId)
            val p = probe(path)
            if (p.isImage) {
                // A still (photo clip / freeze frame) is held for its part of the timeline with the clip's look.
                return EditedMediaItem.Builder(
                    MediaItem.Builder().setUri(Uri.fromFile(File(path))).setImageDurationMs((endMs - startMs).roundToLong().coerceAtLeast(1L)).build(),
                )
                    .setFrameRate(ir.canvas.fps.roundToInt().coerceIn(1, 120))
                    .setEffects(Effects(emptyList(), mainVideoEffects(clip)))
                    .build()
            }
            val srcStartUs = ((clip.sourceStartMs + (startMs - clip.timelineStartMs) * clip.speed) * 1000).roundToLong()
            val srcEndUs = ((clip.sourceStartMs + (endMs - clip.timelineStartMs) * clip.speed) * 1000).roundToLong()
            if (srcEndUs > p.durationMs * 1000 + 50_000) {
                throw EditIrException("INVALID_EDIT_IR", "clip ${clip.id}: source range ends at ${srcEndUs / 1000}ms but the file is ${p.durationMs}ms")
            }
            val b = EditedMediaItem.Builder(clippedItem(path, srcStartUs, min(srcEndUs, p.durationMs * 1000)))
                .setRemoveAudio(removeAudio || !p.hasAudio)
                .setRemoveVideo(removeVideo)
            if (abs(clip.speed - 1.0) > 1e-6) b.setSpeed(constantSpeed(clip.speed.toFloat()))
            b.setEffects(
                Effects(
                    if (removeAudio || !p.hasAudio) emptyList() else clipAudioProcessors(index, clip),
                    if (removeVideo) emptyList() else capped(path, mainVideoEffects(clip), clip.speed),
                ),
            )
            return b.build()
        }

        if (overlays.isEmpty()) {
            val items = ir.clips.mapIndexed { i, c ->
                mainItem(c, i, c.timelineStartMs.toDouble(), c.timelineEndMs.toDouble(), removeAudio = false, removeVideo = false)
            }
            val types = if (anyAudio) setOf(C.TRACK_TYPE_AUDIO, C.TRACK_TYPE_VIDEO) else setOf(C.TRACK_TYPE_VIDEO)
            // The sequence declares its track types; with TRACK_TYPE_AUDIO declared Media3 fills clips without audio
            // with silence. experimentalSetForceAudioTrack must NOT be called on a sequence built with explicit track
            // types (Preconditions.checkState throws IllegalStateException; verified on device 2026-09-27).
            sequences.add(EditedMediaItemSequence.Builder(types).addItems(items).build())
        } else {
            val videoItems = videoPieces(overlays).map { piece ->
                val clip = ir.clips[piece.clipIndex]
                val ov = piece.overlay
                if (ov == null) {
                    mainItem(clip, piece.clipIndex, piece.startMs, piece.endMs, removeAudio = true, removeVideo = false)
                } else {
                    val path = media.overlayPaths.getValue(ov.id)
                    if (ov.isImage) {
                        val lenMs = (piece.endMs - piece.startMs).roundToLong().coerceAtLeast(1L)
                        return@map EditedMediaItem.Builder(
                            MediaItem.Builder().setUri(Uri.fromFile(File(path))).setImageDurationMs(lenMs).build(),
                        )
                            .setFrameRate(ir.canvas.fps.roundToInt().coerceIn(1, 120))
                            .setEffects(
                                Effects(
                                    emptyList(),
                                    listOf(Presentation.createForWidthAndHeight(ir.canvas.width, ir.canvas.height, cutawayLayout(ov))),
                                ),
                            )
                            .build()
                    }
                    val srcStartUs = ((ov.sourceStartMs + (piece.startMs - ov.timelineStartMs)) * 1000).roundToLong()
                    val srcEndUs = ((ov.sourceStartMs + (piece.endMs - ov.timelineStartMs)) * 1000).roundToLong()
                    EditedMediaItem.Builder(clippedItem(path, srcStartUs, srcEndUs))
                        .setRemoveAudio(true)
                        .setEffects(
                            Effects(
                                emptyList(),
                                capped(path, listOf(Presentation.createForWidthAndHeight(ir.canvas.width, ir.canvas.height, cutawayLayout(ov)))),
                            ),
                        )
                        .build()
                }
            }
            sequences.add(EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_VIDEO)).addItems(videoItems).build())
            if (anyAudio) {
                // Stills have no sound: their part of the voice lane is silence.
                val audio = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO))
                ir.clips.forEachIndexed { i, c ->
                    if (probe(assetPath(c.assetId)).isImage) audio.addGap((c.timelineEndMs - c.timelineStartMs) * 1000)
                    else audio.addItem(mainItem(c, i, c.timelineStartMs.toDouble(), c.timelineEndMs.toDouble(), removeAudio = false, removeVideo = true))
                }
                sequences.add(audio.build())
            }
        }

        ir.audio.music.forEach { m -> sequences.add(musicSequence(m)) }
        ir.audio.sfx.forEach { s -> sfxSequence(s)?.let(sequences::add) }
        ir.audio.voiceovers.forEach { v -> voiceoverSequence(v)?.let(sequences::add) }

        val compositionFx = mutableListOf<Effect>()
        // Cap the output at canvas.fps. Phone footage is often 60 fps or variable frame rate;
        // Media3 can drop frames but never duplicates them, so slower sources keep their rate.
        val videoPaths = ir.clips.map { assetPath(it.assetId) } +
            overlays.filter { !it.first.isImage }.map { media.overlayPaths.getValue(it.first.id) } +
            ir.overlays.filter { it.isLayer && !it.isImage }.mapNotNull { media.overlayPaths[it.id] }
        val videoProbes = videoPaths.distinct().map { probe(it) }.filter { !it.isImage }
        // The frame-rate cap is applied per video item (frameCap): Media3 ignores a FrameDropEffect in the
        // composition effects, which left "24 fps" exports at the source's 30 fps (found on device 2026-10-02).
        if (videoProbes.any { it.isHdr }) {
            warnings.add("HDR source tone-mapped to SDR for H.264 output")
            if (Build.VERSION.SDK_INT < 29) warnings.add("HDR tone-mapping needs Android 10+; colours may be washed out")
        }
        if (ir.zooms.isNotEmpty()) compositionFx.add(ZoomTransformation(ir.zooms, overlays.map { it.second }))
        val transitionSpans = ir.clips.filter { it.transitionIn != null && it.transitionIn.type != "CUT" }
            .map { TransitionSpan(it.timelineStartMs, it.transitionIn!!.durationMs, it.transitionIn.type) }
        transitionSpans.map { it.type }.filter { it !in SUPPORTED_TRANSITIONS }
            .toSet().forEach { warnings.add("transition '$it' rendered as CROSSFADE") }
        if (transitionSpans.isNotEmpty()) {
            compositionFx.add(TransitionMotion(transitionSpans))
            // Cuts drawn as a true crossfade (layer) skip the dip; the rest keep their colour transition.
            val crossfadedCuts = crossfades.keys.map { it.id.removePrefix("xfade_").toInt() }.map { ir.clips[it].timelineStartMs }.toSet()
            val dipped = transitionSpans.filter { it.atMs !in crossfadedCuts || (it.type != "CROSSFADE" && it.type != "DISSOLVE" && it.type in SUPPORTED_TRANSITIONS) }
            if (dipped.isNotEmpty()) compositionFx.add(TransitionFade(dipped))
            if (dipped.any { it.type == "CROSSFADE" || it.type == "DISSOLVE" || it.type !in SUPPORTED_TRANSITIONS }) {
                warnings.add("a crossfade had no spare footage on either side of the cut and was drawn as a dip through black")
            }
        }
        val fx = ir.effects.filter { it.endMs > it.startMs && it.type in SUPPORTED_EFFECTS }
        ir.effects.map { it.type }.filter { it !in SUPPORTED_EFFECTS }.toSet().forEach { warnings.add("effect '$it' is not supported on this device and was skipped") }
        if (fx.any { it.type == "shake" || it.type == "zoom_pulse" }) compositionFx.add(EffectsTransformation(fx))
        if (fx.any { it.type == "flash" || it.type == "fade_black" || it.type == "black_white" }) compositionFx.add(EffectsColor(fx))
        if (fx.any { it.type == "vignette" }) compositionFx.add(OverlayEffect(listOf(VignetteOverlay(fx))))
        val imageLayers = ir.overlays.filter { it.isLayer && it.isImage }
        if (imageLayers.isNotEmpty()) compositionFx.add(OverlayEffect(listOf(ImageLayersOverlay(imageLayers, media.overlayPaths))))
        if (ir.captions.isNotEmpty()) compositionFx.add(OverlayEffect(listOf(CaptionOverlay(ir.captions, ::typefaceFor))))
        watermarkOverlay()?.let { compositionFx.add(OverlayEffect(listOf(it))) }
        // Export resolution: the finished frame (captions, logo and all) is scaled last, so the layout never changes.
        if (outputSize != ir.canvas.width to ir.canvas.height) {
            compositionFx.add(Presentation.createForWidthAndHeight(outputSize.first, outputSize.second, Presentation.LAYOUT_SCALE_TO_FIT))
        }

        // Layers (PiP / stickers / layered B-roll) are separate tracks composited above the main video.
        val layerTracks = layerTracks()
        val allSequences = if (layerTracks.isEmpty()) sequences else layerTrackSequences(layerTracks) + sequences + layerAudioSequences()
        return Composition.Builder(allSequences)
            .setEffects(Effects(listOfNotNull(loudnessGainDb?.let { LoudnessLimiterProcessor(it) }), compositionFx))
            .apply { if (layerTracks.isNotEmpty()) setVideoCompositorSettings(layerCompositor(layerTracks)) }
            // Output is 8-bit SDR H.264: tone-map only if an input is actually HDR.
            // On SDR sources, keeping HDR mode avoids unsupported OpenGL ES tone-mapping shader errors.
            .setHdrMode(hdrModeOverride ?: if (videoProbes.any { it.isHdr }) Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL else Composition.HDR_MODE_KEEP_HDR)
            .build()
    }

    /**
     * Photo size as displayed: Media3 decodes photos upright using their EXIF orientation, so a portrait phone photo
     * stored sideways must be measured with width and height swapped (the preview's Image.file does the same).
     */
    private fun imageDisplaySize(path: String): Pair<Int, Int>? {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, o)
        if (o.outWidth <= 0 || o.outHeight <= 0) return null
        val orientation = try {
            ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } catch (_: Exception) {
            ExifInterface.ORIENTATION_NORMAL
        }
        val quarterTurn = orientation in setOf(
            ExifInterface.ORIENTATION_TRANSPOSE, ExifInterface.ORIENTATION_ROTATE_90,
            ExifInterface.ORIENTATION_TRANSVERSE, ExifInterface.ORIENTATION_ROTATE_270,
        )
        return if (quarterTurn) o.outHeight to o.outWidth else o.outWidth to o.outHeight
    }

    /**
     * Caps every moving-video item at canvas.fps (the export frame rate). Phone footage is often 60 fps or variable;
     * Media3 can drop frames but never duplicates them, so slower sources keep their rate. Null when no source is
     * faster than the canvas.
     */
    /**
     * Frame-rate cap for one video file so the export runs at canvas.fps. Frames are dropped on SOURCE time, before
     * a speed change compresses it, so a clip at [speed] keeps canvas.fps / speed source frames per second (a 2x clip
     * would otherwise export at double the rate). Media3 never duplicates frames: slower sources keep their rate.
     * Uses the simple dropper with the file's own rate (the adaptive one and composition-level drops had no effect
     * on device, 2026-10-02).
     */
    private fun frameCapFor(path: String, speed: Double = 1.0): Effect? {
        val p = probe(path)
        if (p.isImage) return null
        val target = ir.canvas.fps / speed.coerceAtLeast(0.01)
        val src = p.frameRate ?: return FrameDropEffect.createDefaultFrameDropEffect(target.toFloat())
        return if (src > target * 1.05) FrameDropEffect.createSimpleFrameDropEffect(src.toFloat(), target.toFloat()) else null
    }

    /** [effects] with [path]'s frame-rate cap first (frame dropping must see the source timestamps). */
    private fun capped(path: String, effects: List<Effect>, speed: Double = 1.0): List<Effect> = listOfNotNull(frameCapFor(path, speed)) + effects

    private fun cutawayLayout(ov: IrOverlay): Int =
        if (ov.fit == "contain") Presentation.LAYOUT_SCALE_TO_FIT else Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP

    /** Aspect (w/h) of a layer's media, as displayed (rotation applied). */
    private fun layerAspect(ov: IrOverlay, path: String): Double {
        if (ov.isImage) {
            val (w, h) = imageDisplaySize(path) ?: throw EditIrException("MISSING_MEDIA", "Photo for layer '${ov.id}' cannot be read")
            return w.toDouble() / h
        }
        val p = probe(path)
        if (!p.hasVideo) throw EditIrException("MISSING_MEDIA", "Layer '${ov.id}' file has no video track")
        return p.displayWidth.toDouble() / p.displayHeight.coerceAtLeast(1)
    }

    /**
     * Layers grouped into tracks: overlapping layers go on separate tracks. Returned top-most first (input 0 of the
     * compositor is drawn on top); later layers in the editIR are drawn above earlier ones, like a CapCut track stack.
     */
    private fun layerTracks(): List<List<IrOverlay>> {
        val tracks = mutableListOf<MutableList<IrOverlay>>()
        // Crossfades sit below every user layer (packed first, so they end up on the lowest tracks).
        // Image layers (stickers, emoji, photos) are rendered directly in compositionFx via ImageLayersOverlay,
        // so layerTracks only needs to process video layers and crossfades.
        for (ov in crossfades.keys + ir.overlays.filter { it.isLayer && !it.isImage }) {
            if (min(ov.timelineEndMs, ir.durationMs) - ov.timelineStartMs < 1) continue
            val t = tracks.firstOrNull { tr -> tr.none { it.timelineStartMs < ov.timelineEndMs && ov.timelineStartMs < it.timelineEndMs } }
            if (t != null) t.add(ov) else tracks.add(mutableListOf(ov))
        }
        if (tracks.size > MAX_LAYER_TRACKS) {
            throw EditIrException("INVALID_EDIT_IR", "At most $MAX_LAYER_TRACKS overlay layers can be on screen at the same time")
        }
        return tracks.map { tr -> tr.sortedBy { it.timelineStartMs } }.reversed()
    }

    /** One full-length video sequence per track: gap, layer, gap, … so every track spans the whole timeline. */
    private fun layerTrackSequences(tracks: List<List<IrOverlay>>): List<EditedMediaItemSequence> = tracks.map { track ->
        val b = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_VIDEO))
        var cursorMs = 0L
        for (ov in track) {
            val start = ov.timelineStartMs.coerceIn(0L, ir.durationMs)
            var end = min(ov.timelineEndMs, ir.durationMs)
            if (start > cursorMs) b.addItem(clearGap(start - cursorMs))
            val xf = crossfades[ov]
            if (xf != null) {
                b.addItem(crossfadeItem(xf, ov.sourceStartMs, end - start))
                cursorMs = end
                continue
            }
            val path = media.overlayPaths[ov.id]
                ?: throw EditIrException("MISSING_MEDIA", "No local file supplied for layer '${ov.id}' (download/resolve it before rendering, or remove it)")
            val (bw, bh) = LayerMotion.baseSize(ir.canvas.width, ir.canvas.height, layerAspect(ov, path))
            val presentation = Presentation.createForWidthAndHeight(bw, bh, Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP)
            // Keying happens before scaling so the edge is computed at the source resolution.
            // The mask is cut after scaling so its edge is sharp at the layer's on-screen size.
            val layerFx = listOfNotNull<Effect>(ov.chromaKey?.let { ChromaKeyEffect(it) }, presentation, ov.mask?.let { LayerMaskEffect(it) })
            val item = if (ov.isImage) {
                EditedMediaItem.Builder(MediaItem.Builder().setUri(Uri.fromFile(File(path))).setImageDurationMs((end - start).coerceAtLeast(1L)).build())
                    .setFrameRate(ir.canvas.fps.roundToInt().coerceIn(1, 120))
                    .setEffects(Effects(emptyList(), layerFx))
                    .build()
            } else {
                val available = probe(path).durationMs - ov.sourceStartMs
                if (available <= 0) throw EditIrException("MISSING_MEDIA", "Layer '${ov.id}' sourceStartMs is beyond the file duration")
                if (start + available < end) {
                    end = start + available
                    warnings.add("layer ${ov.id}: source is ${available}ms, shorter than its slot; it ends early")
                }
                EditedMediaItem.Builder(clippedItem(path, ov.sourceStartMs * 1000, (ov.sourceStartMs + (end - start)) * 1000))
                    .setRemoveAudio(true)
                    .setEffects(Effects(emptyList(), capped(path, layerFx)))
                    .build()
            }
            b.addItem(item)
            cursorMs = end
        }
        if (cursorMs < ir.durationMs) b.addItem(clearGap(ir.durationMs - cursorMs))
        b.build()
    }

    /** Transparent PNG matching canvas size, written once per render. */
    private val clearPng: File by lazy {
        File(context.cacheDir, "clear_${ir.canvas.width}x${ir.canvas.height}.png").also { f ->
            if (!f.isFile) {
                val bmp = android.graphics.Bitmap.createBitmap(ir.canvas.width.coerceAtLeast(2), ir.canvas.height.coerceAtLeast(2), android.graphics.Bitmap.Config.ARGB_8888)
                java.io.FileOutputStream(f).use { bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
                bmp.recycle()
            }
        }
    }

    /**
     * Empty stretch of a layer track. The top layer track is the compositor's primary input and sets the output
     * frame times; Media3 fills sequence gaps with frames at a fixed 30 fps, so a real gap made every export with a
     * layer (PiP, sticker, crossfade) 30 fps whatever the setting. A transparent still at canvas.fps keeps the
     * chosen rate and draws nothing (the compositor also hides inactive tracks).
     */
    private fun clearGap(ms: Long): EditedMediaItem =
        EditedMediaItem.Builder(MediaItem.Builder().setUri(Uri.fromFile(clearPng)).setImageDurationMs(ms.coerceAtLeast(1)).build())
            .setFrameRate(ir.canvas.fps.roundToInt().coerceIn(1, 120))
            .build()

    /**
     * True overlapping crossfades (CROSSFADE / DISSOLVE and unknown types): the incoming clip's footage from just
     * before its in-point fades in over the outgoing clip during [cut - d, cut]; when the incoming clip has no footage
     * before its in-point, the outgoing clip's footage after its out-point fades out over the incoming one during
     * [cut, cut + d]. Each is a synthetic full-frame layer (opacity keyframed) drawn with the clip's own look and speed.
     * Cuts with no spare footage on either side keep the dip-through-black (warned).
     */
    private val crossfades: Map<IrOverlay, IrClip> by lazy {
        val out = LinkedHashMap<IrOverlay, IrClip>()
        for (i in 1 until ir.clips.size) {
            val a = ir.clips[i - 1]
            val bClip = ir.clips[i]
            val tr = bClip.transitionIn ?: continue
            if (tr.type != "CROSSFADE" && tr.type != "DISSOLVE" && tr.type in SUPPORTED_TRANSITIONS) continue
            val cut = bClip.timelineStartMs
            val d = minOf(tr.durationMs, a.timelineEndMs - a.timelineStartMs, bClip.timelineEndMs - bClip.timelineStartMs)
            if (d < 100) continue
            val bProbe = probe(assetPath(bClip.assetId))
            val aProbe = probe(assetPath(a.assetId))
            val pre = if (bProbe.isImage) d else (bClip.sourceStartMs / bClip.speed).toLong()
            val post = if (aProbe.isImage) d else ((aProbe.durationMs - a.sourceEndMs) / a.speed).toLong()
            val (clip, window, srcStart, fadeIn) = when {
                pre >= 100 -> {
                    val w = min(d, pre)
                    Quad(bClip, cut - w to cut, if (bProbe.isImage) 0L else bClip.sourceStartMs - (w * bClip.speed).toLong(), true)
                }
                post >= 100 -> {
                    val w = min(d, post)
                    Quad(a, cut to cut + w, if (aProbe.isImage) 0L else a.sourceEndMs, false)
                }
                else -> continue
            }
            val len = window.second - window.first
            val key = IrOverlay(
                id = "xfade_$i",
                kind = "broll",
                timelineStartMs = window.first,
                timelineEndMs = window.second,
                sourceStartMs = srcStart,
                opacity = 1.0,
                muted = true,
                mediaType = if ((if (fadeIn) bProbe else aProbe).isImage) "image" else "video",
                fit = "contain",
                layer = IrLayer(
                    "overlay", 0.5, 0.5, 1.0, 0.0,
                    listOf(IrLayerKeyframe(0L, opacity = if (fadeIn) 0.0 else 1.0), IrLayerKeyframe(len, opacity = if (fadeIn) 1.0 else 0.0)),
                ),
            )
            out[key] = clip
        }
        out
    }

    private data class Quad<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)

    /** Crossfade footage of [clip] from [sourceStartMs] for [lenMs] of timeline, with the clip's look and speed. */
    private fun crossfadeItem(clip: IrClip, sourceStartMs: Long, lenMs: Long): EditedMediaItem {
        val path = assetPath(clip.assetId)
        if (probe(path).isImage) {
            return EditedMediaItem.Builder(MediaItem.Builder().setUri(Uri.fromFile(File(path))).setImageDurationMs(lenMs.coerceAtLeast(1)).build())
                .setFrameRate(ir.canvas.fps.roundToInt().coerceIn(1, 120))
                .setEffects(Effects(emptyList(), mainVideoEffects(clip)))
                .build()
        }
        val srcLenUs = (lenMs * clip.speed * 1000).roundToLong()
        val b = EditedMediaItem.Builder(clippedItem(path, sourceStartMs * 1000, sourceStartMs * 1000 + srcLenUs)).setRemoveAudio(true)
        if (abs(clip.speed - 1.0) > 1e-6) b.setSpeed(constantSpeed(clip.speed.toFloat()))
        return b.setEffects(Effects(emptyList(), capped(path, mainVideoEffects(clip), clip.speed))).build()
    }

    /** Sound of layers that are not muted, each placed at its slot on its own audio sequence. */
    private fun layerAudioSequences(): List<EditedMediaItemSequence> = ir.overlays
        .filter { it.isLayer && !it.isImage && !it.muted }
        .mapNotNull { ov ->
            val path = media.overlayPaths[ov.id] ?: return@mapNotNull null
            if (!probe(path).hasAudio) return@mapNotNull null
            val start = ov.timelineStartMs.coerceIn(0L, ir.durationMs)
            val end = min(min(ov.timelineEndMs, ir.durationMs), start + (probe(path).durationMs - ov.sourceStartMs))
            if (end - start < 1) return@mapNotNull null
            val b = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO))
            if (start > 0) b.addGap(start * 1000)
            b.addItem(
                EditedMediaItem.Builder(clippedItem(path, ov.sourceStartMs * 1000, (ov.sourceStartMs + (end - start)) * 1000))
                    .setRemoveVideo(true)
                    .build(),
            )
            if (end < ir.durationMs) b.addGap((ir.durationMs - end) * 1000)
            b.build()
        }

    /**
     * Places each layer track per frame: position / scale / rotation / opacity from the layer and its keyframes
     * (`LayerMotion`, mirrored by the phone preview). A track with no layer active at that moment is invisible.
     */
    private fun layerCompositor(tracks: List<List<IrOverlay>>): VideoCompositorSettings {
        val hidden = StaticOverlaySettings.Builder().setAlphaScale(0f).build()
        val plain = StaticOverlaySettings.Builder().build()
        return object : VideoCompositorSettings {
            override fun getOutputSize(inputSizes: List<Size>): Size = Size(ir.canvas.width, ir.canvas.height)

            override fun getOverlaySettings(inputId: Int, presentationTimeUs: Long): OverlaySettings {
                if (inputId >= tracks.size) return plain // the main video (and anything below the layers)
                val tMs = presentationTimeUs / 1000.0
                val ov = tracks[inputId].firstOrNull { tMs >= it.timelineStartMs && tMs < it.timelineEndMs } ?: return hidden
                val pose = LayerMotion.at(ov.layer!!, tMs - ov.timelineStartMs, ov.opacity)
                return StaticOverlaySettings.Builder()
                    .setScale(pose.scale.toFloat(), pose.scale.toFloat())
                    .setOverlayFrameAnchor(0f, 0f)
                    // Canvas fractions (y down) to normalised device coordinates (y up).
                    .setBackgroundFrameAnchor((pose.x * 2 - 1).toFloat(), (1 - pose.y * 2).toFloat())
                    // Layer rotation is clockwise; GL rotation is counter-clockwise.
                    .setRotationDegrees((-pose.rotation).toFloat())
                    .setAlphaScale(pose.opacity.toFloat())
                    .build()
            }
        }
    }

    /**
     * Brand logo (contract §3.9): decoded once, drawn last so it sits above B-roll and captions, and after the zoom
     * so it is never zoomed. A watermark without a local file is skipped with a warning rather than failing the export.
     */
    private fun watermarkOverlay(): WatermarkOverlay? {
        val wm = ir.watermark ?: return null
        val path = media.watermarkPath
        if (path == null || !File(path).isFile) {
            warnings.add("watermark: no local logo file supplied (watermarkPath); exported without the logo")
            return null
        }
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, opts)
        if (opts.outWidth <= 0 || opts.outHeight <= 0) throw EditIrException("MISSING_MEDIA", "Watermark file is not a readable image: $path")
        // Decode at most ~2x the drawn width to keep memory small for large logos.
        val targetW = (ir.canvas.width * wm.widthFraction).coerceAtLeast(1.0)
        var sample = 1
        while (opts.outWidth / (sample * 2) >= targetW * 2) sample *= 2
        val bitmap = BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw EditIrException("MISSING_MEDIA", "Watermark file could not be decoded: $path")
        return WatermarkOverlay(bitmap, wm.position, wm.opacityPct, wm.widthFraction, wm.x, wm.y, wm.width, wm.height)
    }

    /** A sound effect as its own audio sequence: gap until its start, the clip at a fixed gain, then silence. */
    private fun sfxSequence(s: IrSfx): EditedMediaItemSequence? {
        val path = media.sfxPaths[s.id]
            ?: throw EditIrException("MISSING_MEDIA", "No local file supplied for sfx '${s.id}' (download it before rendering, or remove it)")
        val p = probe(path)
        if (!p.hasAudio) throw EditIrException("MISSING_MEDIA", "Sound effect '${s.id}' file has no audio track")
        if (s.timelineStartMs >= ir.durationMs) {
            synchronized(warnings) { warnings.add("sfx ${s.id} starts after the video ends and was skipped") }
            return null
        }
        val len = minOf(s.durationMs ?: p.durationMs, p.durationMs, ir.durationMs - s.timelineStartMs)
        if (len <= 0) return null
        val gain = Math.pow(10.0, s.volumeDb / 20.0).toFloat()
        val b = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO))
        if (s.timelineStartMs > 0) b.addGap(s.timelineStartMs * 1000)
        b.addItem(
            EditedMediaItem.Builder(clippedItem(path, 0, len * 1000))
                .setRemoveVideo(true)
                .setEffects(Effects(listOf(EnvelopeGainProcessor { _ -> gain }), emptyList()))
                .build(),
        )
        val tail = ir.durationMs - s.timelineStartMs - len
        if (tail > 0) b.addGap(tail * 1000)
        return b.build()
    }

    /** Voiceover at its slot with its volume and fades (same gain model as clip audio). */
    private fun voiceoverSequence(v: IrVoiceover): EditedMediaItemSequence? {
        val path = media.assetPaths[v.assetId]
            ?: throw EditIrException("MISSING_MEDIA", "The recording for voiceover '${v.id}' is not on this device (record it again, or remove it)")
        val p = probe(path)
        if (!p.hasAudio) throw EditIrException("MISSING_MEDIA", "Voiceover '${v.id}' file has no audio")
        if (v.timelineStartMs >= ir.durationMs) {
            synchronized(warnings) { warnings.add("voiceover ${v.id} starts after the video ends and was skipped") }
            return null
        }
        val len = minOf(v.durationMs, p.durationMs - v.sourceStartMs, ir.durationMs - v.timelineStartMs)
        if (len <= 0) return null
        val model = ClipAudioGainModel(len.toDouble(), v.volumeDb, v.fadeInMs.toDouble(), v.fadeOutMs.toDouble())
        val b = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO))
        if (v.timelineStartMs > 0) b.addGap(v.timelineStartMs * 1000)
        b.addItem(
            EditedMediaItem.Builder(clippedItem(path, v.sourceStartMs * 1000, (v.sourceStartMs + len) * 1000))
                .setRemoveVideo(true)
                .setEffects(Effects(listOf(EnvelopeGainProcessor { tUs -> model.gainAtItemMs(tUs / 1000.0) }), emptyList()))
                .build(),
        )
        val tail = ir.durationMs - v.timelineStartMs - len
        if (tail > 0) b.addGap(tail * 1000)
        return b.build()
    }

    private fun musicSequence(m: IrMusic): EditedMediaItemSequence {
        val path = media.musicPaths[m.id]
            ?: throw EditIrException("MISSING_MEDIA", "No local file supplied for music '${m.id}' (resolve stock_query/url before rendering, or remove it)")
        val p = probe(path)
        if (!p.hasAudio) throw EditIrException("MISSING_MEDIA", "Music '${m.id}' file has no audio track")
        val end = min(m.timelineEndMs, ir.durationMs)
        if (end <= m.timelineStartMs) throw EditIrException("INVALID_EDIT_IR", "music ${m.id} starts after the timeline ends")
        val model = MusicGainModel(m, ir.audio.duckRangesMs)
        val b = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO))
        if (m.timelineStartMs > 0) b.addGap(m.timelineStartMs * 1000)
        var tl = m.timelineStartMs
        var src = m.sourceStartMs
        if (src >= p.durationMs) throw EditIrException("INVALID_EDIT_IR", "music ${m.id}: sourceStartMs beyond file duration")
        var loops = 0
        while (tl < end) {
            val len = min(end - tl, p.durationMs - src)
            val offsetMs = tl.toDouble()
            b.addItem(
                EditedMediaItem.Builder(clippedItem(path, src * 1000, (src + len) * 1000))
                    .setRemoveVideo(true)
                    .setEffects(Effects(listOf(EnvelopeGainProcessor { tUs -> model.gainAtTimelineMs(offsetMs + tUs / 1000.0) }), emptyList()))
                    .build(),
            )
            tl += len
            src = 0
            if (++loops > 500) throw EditIrException("INVALID_EDIT_IR", "music ${m.id}: source too short to loop")
        }
        return b.build()
    }

    /** Make-up gain for export loudness (null = off / nothing to measure); see [loudnessGain]. */
    private var loudnessGainDb: Double? = null

    /**
     * Gain that brings the voice (the main footage's audio) to [RenderOptions.loudnessTargetLufs]. Phone recordings
     * and downlinks often sit at -25..-30 LUFS while Reels / Shorts / TikTok play at about -14. Bounded to
     * -6..+18 dB; the limiter after it keeps peaks under -1 dBFS. Skipped when the voice is muted or silent.
     */
    private fun loudnessGain(): Double? {
        val target = options.loudnessTargetLufs ?: return null
        if (ir.audio.originalVolumeDb < -20) return null
        val voice = ir.clips.firstOrNull { it.volumeDb > -20 }?.let { assetPath(it.assetId) } ?: return null
        if (!probe(voice).hasAudio) return null
        val lufs = try {
            (MediaIntelligence.measureLoudness(voice, AnalysisControl(isCancelled = { cancelled }))["integratedLufs"] as Number?)?.toDouble()
        } catch (e: Exception) {
            synchronized(warnings) { warnings.add("loudness could not be measured (${e.message}); levels left as recorded") }
            null
        } ?: return null
        val gain = (target - lufs).coerceIn(-6.0, 18.0)
        if (kotlin.math.abs(gain) < 0.5) return null
        synchronized(warnings) { warnings.add("voice measured at ${"%.1f".format(lufs)} LUFS; mix normalised by ${"%+.1f".format(gain)} dB to ${"%.0f".format(target)} LUFS (peaks limited to -2 dBFS)") }
        return gain
    }

    private val typefaceCache = HashMap<String, Typeface>()

    private fun typefaceFor(family: String, weight: Int): Typeface = typefaceCache.getOrPut("$family:$weight") {
        val path = media.fontPaths["$family:$weight"] ?: media.fontPaths[family]
        if (path != null && File(path).isFile) {
            if (Build.VERSION.SDK_INT >= 26) {
                Typeface.Builder(File(path)).setWeight(weight).build()
            } else {
                Typeface.createFromFile(path)
            }
        } else {
            // Inter ships in the APK (assets/fonts, SIL OFL 1.1) and is also the fallback for any family
            // the app could not supply. Nearest bundled weight; ties go to the heavier one.
            val bundled = BUNDLED_INTER_WEIGHTS.minBy { abs(it - weight) * 2 - (if (it > weight) 1 else 0) }
            if (!family.equals("Inter", ignoreCase = true)) {
                synchronized(warnings) { warnings.add("font '$family' $weight not supplied; bundled Inter used") }
            } else if (bundled != weight) {
                synchronized(warnings) { warnings.add("font Inter $weight rendered with bundled Inter $bundled") }
            }
            Typeface.createFromAsset(context.assets, "fonts/Inter-$bundled.ttf")
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
