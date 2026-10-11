package com.workspace180.socialmanager.mediaengine

import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.os.Build
import androidx.media3.common.util.UnstableApi
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlin.math.max
import kotlin.math.min

/** Cooperative cancellation + progress for one analysis call. */
class AnalysisControl(val isCancelled: () -> Boolean = { false }, val onProgress: (Double) -> Unit = {}) {
    fun check() {
        if (isCancelled()) throw MediaEngineError("CANCELLED", "Analysis was cancelled")
    }
}

/**
 * On-device media intelligence for the AI Director and post-export QA: scene cuts, on-screen text
 * (ML Kit, bundled Latin model, offline), loudness, and black/frozen frame scans. Every function is
 * blocking (run it on the IO pool), cancellable through [AnalysisControl], and returns only measured
 * values. Nothing here produces pixels.
 */
@UnstableApi
object MediaIntelligence {
    private const val MAX_OCR_SAMPLES = 180
    private const val OCR_FRAME_WIDTH = 1080
    private const val MAX_LABEL_SAMPLES = 90
    private const val LABEL_FRAME_WIDTH = 480

    /**
     * Decodes every frame of the first video track with the platform decoder and hands [onFrame] a
     * 64x36 luma grid with the presentation time in ms. Returns the number of frames analysed.
     * Throws FRAME_SCAN_UNAVAILABLE when the decoder exposes no readable frames (some devices).
     */
    fun scanLuma(path: String, control: AnalysisControl, onFrame: (tMs: Long, luma: IntArray) -> Unit): Int {
        MediaTools.requireFile(path)
        val ex = MediaExtractor()
        try {
            ex.setDataSource(path)
        } catch (e: Exception) {
            ex.release()
            throw MediaEngineError("UNSUPPORTED_MEDIA", "Cannot open $path: ${e.message}")
        }
        val track = (0 until ex.trackCount).firstOrNull {
            ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
        }
        if (track == null) {
            ex.release()
            throw MediaEngineError("NO_VIDEO_TRACK", "No video track in $path")
        }
        ex.selectTrack(track)
        val format = ex.getTrackFormat(track)
        val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
        val mime = format.getString(MediaFormat.KEY_MIME)!!
        format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
        val codec = try {
            MediaCodec.createDecoderByType(mime).apply { configure(format, null, null, 0); start() }
        } catch (e: Exception) {
            ex.release()
            throw MediaEngineError("DECODER_UNAVAILABLE", "No decoder for $mime: ${e.message}")
        }
        var frames = 0
        var decoded = 0
        try {
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            var idleSinceEos = 0
            var lastReported = -1.0
            while (!outputDone) {
                control.check()
                if (!inputDone) {
                    val ii = codec.dequeueInputBuffer(10_000)
                    if (ii >= 0) {
                        val n = ex.readSampleData(codec.getInputBuffer(ii)!!, 0)
                        if (n < 0) {
                            codec.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(ii, 0, n, ex.sampleTime, 0)
                            ex.advance()
                        }
                    }
                }
                val oi = codec.dequeueOutputBuffer(info, 10_000)
                if (oi >= 0) {
                    idleSinceEos = 0
                    if (info.size > 0) {
                        decoded++
                        val image = try { codec.getOutputImage(oi) } catch (_: Exception) { null }
                        if (image != null) {
                            try {
                                val plane = image.planes[0]
                                val buf = plane.buffer
                                val crop = image.cropRect
                                // 10-bit (P010) stores each luma sample in the high bits of 16: read the high byte.
                                val highByte = Build.VERSION.SDK_INT >= 33 && image.format == ImageFormat.YCBCR_P010
                                val offset = crop.top * plane.rowStride + crop.left * plane.pixelStride + if (highByte) 1 else 0
                                val grid = LumaGrid.sample(
                                    read = { buf.get(offset + it).toInt() },
                                    width = crop.width(),
                                    height = crop.height(),
                                    rowStride = plane.rowStride,
                                    pixelStride = plane.pixelStride,
                                )
                                onFrame(info.presentationTimeUs / 1000, grid)
                                frames++
                            } finally {
                                image.close()
                            }
                        }
                        if (durationUs > 0) {
                            val p = (info.presentationTimeUs.toDouble() / durationUs).coerceIn(0.0, 1.0)
                            if (p - lastReported >= 0.02) {
                                lastReported = p
                                control.onProgress(p)
                            }
                        }
                    }
                    codec.releaseOutputBuffer(oi, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                } else if (inputDone && ++idleSinceEos > 500) {
                    // About 5 s without output after end of input: a stuck decoder; keep what we have.
                    outputDone = true
                }
            }
        } catch (e: MediaEngineError) {
            throw e
        } catch (e: Exception) {
            throw MediaEngineError("DECODE_FAILED", "Video decode failed: ${e.message}")
        } finally {
            try { codec.stop() } catch (_: Exception) {}
            codec.release()
            ex.release()
        }
        if (frames == 0 && decoded > 0) {
            throw MediaEngineError("FRAME_SCAN_UNAVAILABLE", "This device's video decoder does not expose frames for analysis")
        }
        return frames
    }

    /** Hard scene cuts in source ms (frame-accurate, from luma histogram + pixel differences). */
    fun detectScenes(path: String, control: AnalysisControl): List<Long> {
        val detector = SceneCutDetector()
        scanLuma(path, control) { t, luma -> detector.feed(t, luma) }
        control.onProgress(1.0)
        return detector.cutsMs
    }

    /**
     * On-screen text with ML Kit (bundled Latin model, offline) in one frame every [stepMs] (at
     * most 180 frames). Consecutive identical text is merged into `{startMs, endMs, text}` spans.
     */
    fun recognizeText(path: String, stepMs: Long, control: AnalysisControl): List<Map<String, Any>> {
        MediaTools.requireFile(path)
        if (stepMs <= 0) throw MediaEngineError("INVALID_ARGS", "sampleEveryMs must be > 0")
        val info = MediaTools.getVideoInfo(path)
        if (info["hasVideo"] != true) throw MediaEngineError("NO_VIDEO_TRACK", "No video track in $path")
        val durationMs = (info["durationMs"] as Number).toLong()
        val rotation = (info["rotation"] as Number?)?.toInt() ?: 0
        val displayPortrait = ((info["displayHeight"] as Number?)?.toInt() ?: 0) > ((info["displayWidth"] as Number?)?.toInt() ?: 0)
        val step = max(stepMs, durationMs / MAX_OCR_SAMPLES)
        val merger = OcrSpanMerger(step)
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(path)
            val codedW = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: OCR_FRAME_WIDTH
            val codedH = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: OCR_FRAME_WIDTH
            var t = 0L
            while (t < durationMs) {
                control.check()
                val frame: Bitmap? = if (Build.VERSION.SDK_INT >= 27 && codedW > OCR_FRAME_WIDTH) {
                    r.getScaledFrameAtTime(t * 1000, MediaMetadataRetriever.OPTION_CLOSEST, OCR_FRAME_WIDTH, max(1, OCR_FRAME_WIDTH * codedH / codedW))
                } else {
                    r.getFrameAtTime(t * 1000, MediaMetadataRetriever.OPTION_CLOSEST)
                }
                if (frame != null) {
                    // Some devices return frames without the rotation applied; tell ML Kit to upright them.
                    val needsTurn = rotation % 180 != 0 && (frame.height > frame.width) != displayPortrait
                    val result = Tasks.await(recognizer.process(InputImage.fromBitmap(frame, if (needsTurn) rotation else 0)))
                    val text = result.textBlocks
                        .map { it.text }
                        .filter { b -> b.count { it.isLetterOrDigit() } >= 2 }
                        .joinToString("\n")
                    merger.feed(t, text)
                    frame.recycle()
                }
                control.onProgress((t.toDouble() / durationMs).coerceIn(0.0, 1.0))
                t += step
            }
        } catch (e: MediaEngineError) {
            throw e
        } catch (e: Exception) {
            throw MediaEngineError("OCR_FAILED", "Text recognition failed: ${e.message}")
        } finally {
            r.release()
            recognizer.close()
        }
        control.onProgress(1.0)
        return merger.finish()
    }

    /**
     * What each part of the video shows: ML Kit image labels (bundled model, offline) on one frame every [stepMs]
     * (at most 90 frames), keeping labels with confidence >= 0.6 (top 5). Consecutive frames with the same label set
     * are merged into `{startMs, endMs, labels}` spans. Only words leave this function, never pixels.
     */
    fun labelScenes(path: String, stepMs: Long, control: AnalysisControl): List<Map<String, Any>> {
        MediaTools.requireFile(path)
        if (stepMs <= 0) throw MediaEngineError("INVALID_ARGS", "sampleEveryMs must be > 0")
        val info = MediaTools.getVideoInfo(path)
        if (info["hasVideo"] != true) throw MediaEngineError("NO_VIDEO_TRACK", "No video track in $path")
        val durationMs = (info["durationMs"] as Number).toLong()
        val step = max(stepMs, durationMs / MAX_LABEL_SAMPLES)
        val labeler = ImageLabeling.getClient(ImageLabelerOptions.Builder().setConfidenceThreshold(0.6f).build())
        val r = MediaMetadataRetriever()
        val spans = mutableListOf<MutableMap<String, Any>>()
        try {
            r.setDataSource(path)
            val codedW = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: OCR_FRAME_WIDTH
            val codedH = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: OCR_FRAME_WIDTH
            var t = 0L
            while (t < durationMs) {
                control.check()
                val frame: Bitmap? = if (Build.VERSION.SDK_INT >= 27 && codedW > LABEL_FRAME_WIDTH) {
                    r.getScaledFrameAtTime(t * 1000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, LABEL_FRAME_WIDTH, max(1, LABEL_FRAME_WIDTH * codedH / codedW))
                } else {
                    r.getFrameAtTime(t * 1000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                }
                if (frame != null) {
                    val labels = Tasks.await(labeler.process(InputImage.fromBitmap(frame, 0)))
                        .sortedByDescending { it.confidence }
                        .take(5)
                        .map { it.text.lowercase() }
                    frame.recycle()
                    val end = min(durationMs, t + step)
                    val last = spans.lastOrNull()
                    @Suppress("UNCHECKED_CAST")
                    if (last != null && (last["labels"] as List<String>).toSet() == labels.toSet()) last["endMs"] = end
                    else if (labels.isNotEmpty()) spans.add(mutableMapOf("startMs" to t, "endMs" to end, "labels" to labels))
                }
                control.onProgress((t.toDouble() / durationMs).coerceIn(0.0, 1.0))
                t += step
            }
        } catch (e: MediaEngineError) {
            throw e
        } catch (e: Exception) {
            throw MediaEngineError("LABELING_FAILED", "Scene labelling failed: ${e.message}")
        } finally {
            r.release()
            labeler.close()
        }
        control.onProgress(1.0)
        return spans
    }

    /**
     * Integrated loudness (LUFS), true peak (dBTP) and clipped-sample share (%) of the first audio
     * track. A file without audio returns `hasAudio: false` and null measurements.
     */
    fun measureLoudness(path: String, control: AnalysisControl): Map<String, Any?> {
        MediaTools.requireFile(path)
        val (ex, codec, format) = MediaTools.openAudioDecoder(path)
            ?: return mapOf("hasAudio" to false, "integratedLufs" to null, "truePeakDb" to null, "clippingPct" to null)
        val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
        var meter = LoudnessMeter(format.getInteger(MediaFormat.KEY_SAMPLE_RATE), format.getInteger(MediaFormat.KEY_CHANNEL_COUNT))
        var fed = false
        var lastReported = -1.0
        try {
            MediaTools.decodePcm(ex, codec, format, onFormat = { rate, channels ->
                if (!fed) meter = LoudnessMeter(rate, channels)
            }, isCancelled = control.isCancelled) { tUs, frame, _ ->
                fed = true
                meter.feed(frame)
                if (durationUs > 0) {
                    val p = (tUs.toDouble() / durationUs).coerceIn(0.0, 1.0)
                    if (p - lastReported >= 0.02) {
                        lastReported = p
                        control.onProgress(p)
                    }
                }
            }
        } catch (e: MediaEngineError) {
            throw e
        } catch (e: Exception) {
            throw MediaEngineError("DECODE_FAILED", "Audio decode failed: ${e.message}")
        } finally {
            try { codec.stop() } catch (_: Exception) {}
            codec.release()
            ex.release()
        }
        control.onProgress(1.0)
        return meter.result() + ("hasAudio" to true)
    }

    /**
     * Post-export QA of a rendered file: container facts, black and frozen frame ranges (every frame
     * decoded) and loudness. `frameScanned` is false when the device could not expose frames; the
     * black/frozen lists are then empty because they were not measured, not because they are clean.
     */
    fun probeExport(path: String, control: AnalysisControl): Map<String, Any?> {
        val info = MediaTools.getVideoInfo(path)
        val durationMs = (info["durationMs"] as Number).toLong()
        val bf = BlackFrozenDetector()
        var frames = 0
        var frameScanned = false
        var lastT = 0L
        if (info["hasVideo"] == true) {
            try {
                frames = scanLuma(path, AnalysisControl(control.isCancelled) { control.onProgress(it * 0.7) }) { t, luma ->
                    bf.feed(t, luma)
                    lastT = t
                }
                bf.finish(max(durationMs, lastT))
                frameScanned = frames > 0
            } catch (e: MediaEngineError) {
                if (e.code == "CANCELLED") throw e
            }
        }
        val hasAudio = info["hasAudio"] == true
        val loud = if (hasAudio) {
            measureLoudness(path, AnalysisControl(control.isCancelled) { control.onProgress(0.7 + it * 0.3) })
        } else emptyMap()
        control.onProgress(1.0)
        val fps = (info["frameRate"] as Double?) ?: if (frameScanned && durationMs > 0) Math.round(frames * 1000.0 / durationMs * 100) / 100.0 else null
        return mapOf(
            "durationMs" to durationMs,
            "width" to info["displayWidth"],
            "height" to info["displayHeight"],
            "fps" to fps,
            "hasAudio" to hasAudio,
            "audioChannels" to info["audioChannels"],
            "frameScanned" to frameScanned,
            "blackRangesMs" to bf.blackRanges.map { listOf(it[0], it[1]) },
            "frozenRangesMs" to bf.frozenRanges.map { listOf(it[0], it[1]) },
            "integratedLufs" to loud["integratedLufs"],
            "truePeakDb" to loud["truePeakDb"],
            "clippingPct" to loud["clippingPct"],
        )
    }
}
