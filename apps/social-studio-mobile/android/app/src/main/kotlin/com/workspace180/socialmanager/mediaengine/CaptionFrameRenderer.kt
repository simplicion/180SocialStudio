package com.workspace180.socialmanager.mediaengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Build
import androidx.media3.common.util.UnstableApi
import java.io.File
import java.io.FileOutputStream

/**
 * Draws an IR's captions through the export's own CaptionOverlay into bitmaps (no video, transparent background), for
 * the preview-vs-export parity test (integration_test/caption_parity_test.dart) and the caption timing measurement.
 * Same font lookup as CompositionFactory.typefaceFor: a supplied file per `family:weight`, else bundled Inter.
 */
@UnstableApi
object CaptionFrameRenderer {
    fun render(
        context: Context,
        irJson: String,
        fontPaths: Map<String, String>,
        timesMs: List<Long>,
        outDir: String,
        prefix: String,
        perfFrames: Int,
    ): Map<String, Any?> {
        val ir = MobileEditIr.parse(irJson)
        val cache = HashMap<String, Typeface>()
        fun typefaceFor(family: String, weight: Int): Typeface = cache.getOrPut("$family:$weight") {
            val path = fontPaths["$family:$weight"] ?: fontPaths[family]
            if (path != null && File(path).isFile) {
                if (Build.VERSION.SDK_INT >= 26) Typeface.Builder(File(path)).setWeight(weight).build() else Typeface.createFromFile(path)
            } else {
                Typeface.createFromAsset(context.assets, "fonts/Inter-800.ttf")
            }
        }
        val probe = Paint()
        val glyphs = CaptionGlyphCheck.check(ir.captions, { f, w ->
            (fontPaths["$f:$w"] ?: fontPaths[f])?.let { FontCoverage.of(it) }
                ?: context.assets.open("fonts/Inter-800.ttf").use { FontCoverage.parse(it.readBytes()) }
        }) { probe.hasGlyph(it) }

        val w = ir.canvas.width
        val h = ir.canvas.height
        val overlay = CaptionOverlay(ir.captions, ::typefaceFor, w, ir.faceBoxes)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        File(outDir).mkdirs()
        val paths = timesMs.map { t ->
            overlay.drawAt(canvas, t * 1000)
            val f = File(outDir, "${prefix}_$t.png")
            FileOutputStream(f).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            f.absolutePath
        }
        // Timing at the canvas size: a fresh overlay, so the first frame includes the layout of every caption.
        var firstMs = 0.0
        var steadyMs = 0.0
        if (perfFrames > 0) {
            val fresh = CaptionOverlay(ir.captions, ::typefaceFor, w, ir.faceBoxes)
            val t0 = System.nanoTime()
            fresh.drawAt(canvas, 0)
            firstMs = (System.nanoTime() - t0) / 1e6
            val span = ir.durationMs.coerceAtLeast(1)
            val t1 = System.nanoTime()
            for (i in 0 until perfFrames) fresh.drawAt(canvas, (i * span / perfFrames) * 1000)
            steadyMs = (System.nanoTime() - t1) / 1e6 / perfFrames
        }
        bmp.recycle()
        return mapOf(
            "paths" to paths,
            "firstFrameMs" to firstMs,
            "msPerFrame" to steadyMs,
            "width" to w,
            "height" to h,
            "glyphsMissing" to glyphs.missing.map { mapOf("script" to it.script, "family" to it.family, "chars" to it.chars) },
            "glyphsFromSystem" to glyphs.systemFallback.map { mapOf("script" to it.script, "family" to it.family, "chars" to it.chars) },
            "icu" to (CaptionIcu.api === AndroidCaptionIcu),
            "tokens" to ir.captions.associate { it.id to displayWords(it).map { w -> w.text } },
        )
    }
}
