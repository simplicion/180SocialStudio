package com.workspace180.socialmanager.mediaengine

import android.graphics.Bitmap
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.os.Build
import androidx.media3.common.util.UnstableApi
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Free on-device analysis tools for the AI Director (no network, no server tokens). The AI only
 * reads the results to choose operations; nothing here generates pixels.
 */
@UnstableApi
object OnDeviceAnalysis {
    private const val MAX_FACE_SAMPLES = 240
    private const val FACE_FRAME_WIDTH = 640

    /**
     * Samples one frame every [sampleEveryMs] (at most 240 frames) and runs ML Kit face detection
     * (bundled model). Returns one map per face: `{tMs, x, y, w, h}` where (x, y) is the box centre
     * and (w, h) its size, all as 0..1 fractions of the display-oriented frame. Blocking.
     */
    fun detectFaces(sourcePath: String, sampleEveryMs: Long): List<Map<String, Any>> {
        MediaTools.requireFile(sourcePath)
        if (sampleEveryMs <= 0) throw MediaEngineError("INVALID_ARGS", "sampleEveryMs must be > 0")
        val info = MediaTools.getVideoInfo(sourcePath)
        if (info["hasVideo"] != true) throw MediaEngineError("NO_VIDEO_TRACK", "No video track in $sourcePath")
        val durationMs = (info["durationMs"] as Number).toLong()
        val rotation = (info["rotation"] as Number?)?.toInt() ?: 0
        val displayPortrait = ((info["displayHeight"] as Number?)?.toInt() ?: 0) > ((info["displayWidth"] as Number?)?.toInt() ?: 0)
        val step = max(sampleEveryMs, durationMs / MAX_FACE_SAMPLES)
        val detector = FaceDetection.getClient(
            FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .setMinFaceSize(0.08f)
                .build(),
        )
        val r = MediaMetadataRetriever()
        val out = mutableListOf<Map<String, Any>>()
        try {
            r.setDataSource(sourcePath)
            val codedW = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: FACE_FRAME_WIDTH
            val codedH = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: FACE_FRAME_WIDTH
            var t = 0L
            while (t < durationMs) {
                val raw: Bitmap? = if (Build.VERSION.SDK_INT >= 27 && codedW > FACE_FRAME_WIDTH) {
                    r.getScaledFrameAtTime(t * 1000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, FACE_FRAME_WIDTH, max(1, FACE_FRAME_WIDTH * codedH / codedW))
                } else {
                    r.getFrameAtTime(t * 1000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                }
                if (raw != null) {
                    // Some devices return frames without the rotation applied: upright them so the
                    // coordinates match the display-oriented frame the timeline uses.
                    val needsTurn = rotation % 180 != 0 && (raw.height > raw.width) != displayPortrait
                    val frame = if (needsTurn) Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(rotation.toFloat()) }, true) else raw
                    val w = frame.width.toDouble()
                    val h = frame.height.toDouble()
                    val faces = Tasks.await(detector.process(InputImage.fromBitmap(frame, 0)))
                    for (f in faces) {
                        val b = f.boundingBox
                        val x0 = max(0.0, b.left.toDouble()); val x1 = min(w, b.right.toDouble())
                        val y0 = max(0.0, b.top.toDouble()); val y1 = min(h, b.bottom.toDouble())
                        if (x1 <= x0 || y1 <= y0) continue
                        out.add(mapOf(
                            "tMs" to t,
                            "x" to round4((x0 + x1) / 2 / w), "y" to round4((y0 + y1) / 2 / h),
                            "w" to round4((x1 - x0) / w), "h" to round4((y1 - y0) / h),
                        ))
                    }
                    if (frame !== raw) frame.recycle()
                    raw.recycle()
                }
                t += step
            }
        } catch (e: MediaEngineError) {
            throw e
        } catch (e: Exception) {
            throw MediaEngineError("FACE_DETECTION_FAILED", "Face detection failed: ${e.message}")
        } finally {
            r.release()
            detector.close()
        }
        return out
    }

    private fun round4(v: Double) = Math.round(v.coerceIn(0.0, 1.0) * 10000) / 10000.0
}

/**
 * Onset/beat detection on short-window energies: positive log-energy flux, an adaptive threshold
 * (local mean + 1.5 standard deviations over about +/-0.5 s), local-maximum peak picking and a
 * 250 ms refractory gap (<= 240 BPM). Pure, so it is easy to reason about and test.
 */
object BeatDetector {
    private const val MIN_GAP_MS = 250.0

    /** Beat times (ms) for per-window mean-square [energies] spaced [hopMs] apart. */
    fun onsets(energies: FloatArray, hopMs: Double): List<Long> {
        val n = energies.size
        if (n < 3 || hopMs <= 0) return emptyList()
        val flux = DoubleArray(n)
        var prev = ln(1e-10 + energies[0])
        for (i in 1 until n) {
            val cur = ln(1e-10 + energies[i])
            flux[i] = max(0.0, cur - prev)
            prev = cur
        }
        val half = max(2, (500.0 / hopMs).toInt())
        val beats = mutableListOf<Long>()
        var lastMs = -MIN_GAP_MS
        // Running sums over the window for the adaptive threshold.
        var sum = 0.0
        var sumSq = 0.0
        var lo = 0
        var hi = -1
        for (i in 0 until n) {
            while (hi < min(n - 1, i + half)) { hi++; sum += flux[hi]; sumSq += flux[hi] * flux[hi] }
            while (lo < i - half) { sum -= flux[lo]; sumSq -= flux[lo] * flux[lo]; lo++ }
            val count = (hi - lo + 1).toDouble()
            val mean = sum / count
            val sd = sqrt(max(0.0, sumSq / count - mean * mean))
            val d = flux[i]
            if (d <= mean + 1.5 * sd || d < 0.1) continue
            val a = max(0, i - 3)
            val b = min(n - 1, i + 3)
            var isPeak = true
            for (k in a..b) if (flux[k] > d) { isPeak = false; break }
            val tMs = i * hopMs
            if (isPeak && tMs - lastMs >= MIN_GAP_MS) {
                beats.add(Math.round(tMs))
                lastMs = tMs
            }
        }
        return beats
    }

    /** Tempo from the median inter-beat gap, folded into 60..180 BPM; null without a steady pulse. */
    fun bpm(beatsMs: List<Long>): Double? {
        if (beatsMs.size < 4) return null
        val gaps = beatsMs.zipWithNext { a, b -> (b - a).toDouble() }.filter { it > 0 }.sorted()
        if (gaps.isEmpty()) return null
        var bpm = 60000.0 / gaps[gaps.size / 2]
        while (bpm < 60) bpm *= 2
        while (bpm > 180) bpm /= 2
        return Math.round(bpm * 10) / 10.0
    }
}
