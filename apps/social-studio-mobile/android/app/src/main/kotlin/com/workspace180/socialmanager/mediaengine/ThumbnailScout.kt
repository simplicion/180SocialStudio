package com.workspace180.socialmanager.mediaengine

import android.graphics.Bitmap
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.os.Build
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import java.io.File
import java.io.FileOutputStream
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Thumbnail "Frame Scout" (runs on the phone): samples the video, scores every frame like a picture editor would —
 * a large, sharp face with open eyes and an expression, good exposure — and saves the best few (spread out in time)
 * as 1280 px JPEGs with their face boxes. These real frames are what the thumbnail team designs with.
 */
object ThumbnailScout {
    private const val SAMPLES = 24
    private const val ANALYSIS_WIDTH = 640
    private const val OUTPUT_WIDTH = 1280
    private const val MIN_GAP_MS = 1500L

    private data class Scored(
        val tMs: Long,
        val score: Double,
        val faces: List<Map<String, Double?>>,
        val sharpness: Double,
        val brightness: Double,
    )

    fun candidates(path: String, outDir: String, count: Int, control: AnalysisControl): List<Map<String, Any?>> {
        MediaTools.requireFile(path)
        val info = MediaTools.getVideoInfo(path)
        if (info["hasVideo"] != true) throw MediaEngineError("NO_VIDEO_TRACK", "No video track in $path")
        val durationMs = (info["durationMs"] as Number).toLong()
        val rotation = (info["rotation"] as Number?)?.toInt() ?: 0
        val displayPortrait = ((info["displayHeight"] as Number?)?.toInt() ?: 0) > ((info["displayWidth"] as Number?)?.toInt() ?: 0)
        val detector = FaceDetection.getClient(
            FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
                .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
                .setMinFaceSize(0.08f)
                .build(),
        )
        val r = MediaMetadataRetriever()
        val scored = mutableListOf<Scored>()
        try {
            r.setDataSource(path)
            val codedW = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: ANALYSIS_WIDTH
            val codedH = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: ANALYSIS_WIDTH
            fun grab(tMs: Long, width: Int): Bitmap? {
                val raw = if (Build.VERSION.SDK_INT >= 27 && codedW > width) {
                    r.getScaledFrameAtTime(tMs * 1000, MediaMetadataRetriever.OPTION_CLOSEST, width, max(1, width * codedH / codedW))
                } else {
                    r.getFrameAtTime(tMs * 1000, MediaMetadataRetriever.OPTION_CLOSEST)
                } ?: return null
                // Upright, like the published video.
                val needsTurn = rotation % 180 != 0 && (raw.height > raw.width) != displayPortrait
                if (!needsTurn) return raw
                val turned = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(rotation.toFloat()) }, true)
                raw.recycle()
                return turned
            }
            // Skip the very start / end (fades, black frames, mid-blink transitions).
            val from = (durationMs * 0.05).toLong()
            val to = (durationMs * 0.95).toLong()
            for (i in 0 until SAMPLES) {
                control.check()
                val t = from + (to - from) * i / max(1, SAMPLES - 1)
                val bmp = grab(t, ANALYSIS_WIDTH) ?: continue
                val faces = Tasks.await(detector.process(InputImage.fromBitmap(bmp, 0))).map { f ->
                    val b = f.boundingBox
                    mapOf(
                        "x" to ((b.left + b.right) / 2.0 / bmp.width).coerceIn(0.0, 1.0),
                        "y" to ((b.top + b.bottom) / 2.0 / bmp.height).coerceIn(0.0, 1.0),
                        "w" to (b.width().toDouble() / bmp.width).coerceIn(0.0, 1.0),
                        "h" to (b.height().toDouble() / bmp.height).coerceIn(0.0, 1.0),
                        "smile" to f.smilingProbability?.toDouble(),
                        "eyesOpen" to listOfNotNull(f.leftEyeOpenProbability, f.rightEyeOpenProbability).takeIf { it.isNotEmpty() }?.average(),
                    )
                }
                val (sharp, bright) = sharpnessAndBrightness(bmp)
                bmp.recycle()
                scored.add(Scored(t, score(faces, sharp, bright), faces, sharp, bright))
                control.onProgress(0.8 * (i + 1) / SAMPLES)
            }
            if (scored.isEmpty()) throw MediaEngineError("FRAME_SCAN_UNAVAILABLE", "This device's video decoder does not expose frames")
            // Best frames, at least MIN_GAP_MS apart (different moments, not one moment four times).
            val picked = mutableListOf<Scored>()
            for (s in scored.sortedByDescending { it.score }) {
                if (picked.size >= count) break
                if (picked.all { abs(it.tMs - s.tMs) >= MIN_GAP_MS }) picked.add(s)
            }
            val dir = File(outDir).apply { mkdirs() }
            return picked.mapIndexedNotNull { i, s ->
                val full = grab(s.tMs, OUTPUT_WIDTH) ?: return@mapIndexedNotNull null
                val f = File(dir, "thumb_frame_${i}_${s.tMs}.jpg")
                FileOutputStream(f).use { full.compress(Bitmap.CompressFormat.JPEG, 86, it) }
                full.recycle()
                control.onProgress(0.8 + 0.2 * (i + 1) / picked.size)
                mapOf("path" to f.absolutePath, "tMs" to s.tMs, "score" to s.score, "faces" to s.faces, "sharpness" to s.sharpness, "brightness" to s.brightness)
            }
        } finally {
            r.release()
            detector.close()
        }
    }

    /**
     * Picture-editor score: a big face with open eyes and an expression wins; blur and bad exposure lose.
     * Frames without a face can still win (product / screen videos) on sharpness and exposure.
     */
    private fun score(faces: List<Map<String, Double?>>, sharp: Double, bright: Double): Double {
        val main = faces.maxByOrNull { (it["w"] ?: 0.0) * (it["h"] ?: 0.0) }
        val exposure = 1.0 - min(1.0, abs(bright - 0.5) * 2.2)
        var s = 0.3 * sharp + 0.15 * exposure
        if (main != null) {
            val size = min(1.0, ((main["w"] ?: 0.0) * (main["h"] ?: 0.0)) / 0.06)
            s += 0.25 + 0.15 * size + 0.2 * (main["eyesOpen"] ?: 0.5) + 0.12 * (main["smile"] ?: 0.2)
            if ((main["eyesOpen"] ?: 1.0) < 0.3) s -= 0.3 // mid-blink
        }
        return s
    }

    /** Variance of the Laplacian (focus) mapped to 0..1, and mean luma 0..1, on a 160 px greyscale copy. */
    private fun sharpnessAndBrightness(bmp: Bitmap): Pair<Double, Double> {
        val w = 160
        val h = max(8, 160 * bmp.height / bmp.width)
        val small = Bitmap.createScaledBitmap(bmp, w, h, true)
        val px = IntArray(w * h)
        small.getPixels(px, 0, w, 0, 0, w, h)
        small.recycle()
        val g = DoubleArray(w * h) { i -> val c = px[i]; (((c shr 16) and 0xFF) * 0.299 + ((c shr 8) and 0xFF) * 0.587 + (c and 0xFF) * 0.114) }
        var sum = 0.0
        var sum2 = 0.0
        var n = 0
        for (y in 1 until h - 1) for (x in 1 until w - 1) {
            val i = y * w + x
            val lap = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i]
            sum += lap; sum2 += lap * lap; n++
        }
        val variance = if (n > 0) sum2 / n - (sum / n) * (sum / n) else 0.0
        val sharp = variance / (variance + 250.0)
        val bright = g.average() / 255.0
        return sharp to bright
    }
}
