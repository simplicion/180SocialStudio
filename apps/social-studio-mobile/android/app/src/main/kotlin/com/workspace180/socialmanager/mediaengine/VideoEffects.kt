package com.workspace180.socialmanager.mediaengine

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.RectF
import android.graphics.Typeface
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.CanvasOverlay
import androidx.media3.effect.MatrixTransformation
import androidx.media3.effect.RgbMatrix
import java.io.File
import kotlin.math.max
import kotlin.math.min

/*
 * Time-varying effects applied at the Composition level. Media3 hands these effects the
 * presentation time of the frame on the *output* timeline (in microseconds), so every lookup
 * below is in timeline milliseconds as defined by the contract.
 */

private fun easeOut(x: Double) = 1.0 - (1.0 - x) * (1.0 - x) * (1.0 - x)
private fun easeIn(x: Double) = x * x * x

/**
 * Camera punch-ins (contract §3.5). Scales about the canvas-normalized centre. Scaling about a
 * point inside the frame never reveals background, which satisfies the clamp requirement.
 * Zoom is suppressed inside B-roll intervals because B-roll is not zoomed.
 */
@UnstableApi
class ZoomTransformation(
    private val zooms: List<IrZoom>,
    private val excludedRangesMs: List<LongArray>,
) : MatrixTransformation {
    override fun getMatrix(presentationTimeUs: Long): Matrix {
        val m = Matrix()
        val t = presentationTimeUs / 1000.0
        if (excludedRangesMs.any { t >= it[0] && t < it[1] }) return m
        val z = zooms.firstOrNull { t >= it.startMs && t < it.endMs } ?: return m
        val ramp = max(1.0, min(z.rampMs.toDouble(), (z.endMs - z.startMs) / 2.0))
        val progress = when {
            t < z.startMs + ramp -> easeOut((t - z.startMs) / ramp)
            t > z.endMs - ramp -> 1.0 - easeIn((t - (z.endMs - ramp)) / ramp)
            else -> 1.0
        }.coerceIn(0.0, 1.0)
        val s = (1.0 + (z.scale - 1.0) * progress).toFloat()
        // NDC: x right, y up.
        val cx = (2.0 * z.centerX - 1.0).toFloat().coerceIn(-1f, 1f)
        val cy = (1.0 - 2.0 * z.centerY).toFloat().coerceIn(-1f, 1f)
        m.setScale(s, s, cx, cy)
        return m
    }

    override fun isNoOp(inputWidth: Int, inputHeight: Int): Boolean = zooms.isEmpty()
}

/** One transition on the output timeline: the cut at [atMs], [durMs] long, centred on the cut. */
data class TransitionSpan(val atMs: Long, val durMs: Long, val type: String) {
    /** 1 at the cut, falling to 0 at the window edges; null outside the window. */
    fun closeness(t: Double): Double? {
        val half = durMs / 2.0
        if (half <= 0) return null
        val d = kotlin.math.abs(t - atMs)
        return if (d < half) 1.0 - d / half else null
    }
}

/** Types drawn by [TransitionFade] + [TransitionMotion]; anything else falls back to a crossfade (warned). */
val SUPPORTED_TRANSITIONS = setOf("CUT", "CROSSFADE", "DISSOLVE", "DIP_BLACK", "DIP_WHITE", "ZOOM_SWOOSH", "ZOOM_OUT", "GLITCH")

/**
 * Colour side of transitions. Media3 sequences cannot overlap two items, so CROSSFADE/DISSOLVE/DIP_BLACK
 * (and unknown types) are a centred dip-through-black of the same duration; DIP_WHITE dips through white;
 * GLITCH is a brief white flash right at the cut. Zooms have no colour change (see [TransitionMotion]).
 */
@UnstableApi
class TransitionFade(private val spans: List<TransitionSpan>) : RgbMatrix {
    override fun getMatrix(presentationTimeUs: Long, useHdr: Boolean): FloatArray {
        val t = presentationTimeUs / 1000.0
        var black = 0.0
        var white = 0.0
        for (s in spans) {
            val k = s.closeness(t) ?: continue
            when (s.type) {
                "ZOOM_SWOOSH", "ZOOM_OUT" -> {}
                "DIP_WHITE" -> white = max(white, k)
                // Flash only in the middle 40% of the window, peaking at the cut.
                "GLITCH" -> white = max(white, 0.7 * ((k - 0.6) / 0.4).coerceIn(0.0, 1.0))
                else -> black = max(black, k)
            }
        }
        if (black <= 0.0 && white <= 0.0) return EffectsColor.identity()
        return EffectsColor.multiply(EffectsColor.towardsWhite(white), EffectsColor.darken(black))
    }

    override fun isNoOp(inputWidth: Int, inputHeight: Int): Boolean =
        spans.none { it.type != "ZOOM_SWOOSH" && it.type != "ZOOM_OUT" }
}

/**
 * Motion side of transitions, as a scale/offset ramp around the cut. Scale never drops below 1, so no
 * background is revealed. ZOOM_SWOOSH punches in towards the cut and back out after it; ZOOM_OUT starts
 * the incoming clip zoomed in and eases out; GLITCH jitters the frame sideways around the cut.
 */
@UnstableApi
class TransitionMotion(private val spans: List<TransitionSpan>) : MatrixTransformation {
    private val active = spans.filter { it.type == "ZOOM_SWOOSH" || it.type == "ZOOM_OUT" || it.type == "GLITCH" }

    override fun getMatrix(presentationTimeUs: Long): Matrix {
        val m = Matrix()
        val t = presentationTimeUs / 1000.0
        for (s in active) {
            val k = s.closeness(t) ?: continue
            when (s.type) {
                "ZOOM_SWOOSH" -> {
                    val sc = (1.0 + 0.35 * easeIn(k)).toFloat()
                    m.setScale(sc, sc)
                }
                "ZOOM_OUT" -> if (t >= s.atMs) {
                    val sc = (1.0 + 0.3 * easeIn(k)).toFloat()
                    m.setScale(sc, sc)
                }
                "GLITCH" -> {
                    // Stepped jitter (changes every ~33 ms), scaled up slightly so edges stay hidden.
                    val step = kotlin.math.floor(t / 33.0)
                    val amp = 0.06 * k
                    val dx = (amp * kotlin.math.sin(step * 12.9898)).toFloat()
                    val dy = (amp * 0.3 * kotlin.math.sin(step * 78.233)).toFloat()
                    val sc = (1.0 + 0.08 * k).toFloat()
                    m.setScale(sc, sc)
                    m.postTranslate(dx, dy)
                }
            }
            return m
        }
        return m
    }

    override fun isNoOp(inputWidth: Int, inputHeight: Int): Boolean = active.isEmpty()
}

/**
 * Renders visual image layers and stickers (PiP photos, stickers, emojis, badges, overlays)
 * directly onto the Canvas using hardware-accelerated CanvasOverlay.
 * Guarantees 1:1 WYSIWYG parity with the Flutter preview, eliminating Media3 sequence desync or texture drops.
 */
@UnstableApi
class ImageLayersOverlay(
    private val overlays: List<IrOverlay>,
    private val overlayPaths: Map<String, String>,
) : CanvasOverlay(/* useInputFrameSize= */ true) {

    private val bitmaps = mutableMapOf<String, Bitmap>()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val dst = RectF()

    override fun onDraw(canvas: Canvas, presentationTimeUs: Long) {
        val tMs = presentationTimeUs / 1000.0
        val w = canvas.width.toFloat()
        val h = canvas.height.toFloat()
        if (w <= 0f || h <= 0f) return

        for (ov in overlays) {
            if (tMs < ov.timelineStartMs || tMs >= ov.timelineEndMs) continue
            val layer = ov.layer ?: continue
            val path = overlayPaths[ov.id] ?: continue
            val bmp = getBitmap(ov.id, path) ?: continue
            if (bmp.isRecycled) continue

            val pose = LayerMotion.at(layer, tMs - ov.timelineStartMs, ov.opacity)
            if (pose.opacity <= 0.005) continue

            val aspect = bmp.width.toDouble() / bmp.height.coerceAtLeast(1)
            val (baseW, baseH) = LayerMotion.baseSize(canvas.width, canvas.height, aspect)
            val drawW = (baseW * pose.scale).toFloat()
            val drawH = (baseH * pose.scale).toFloat()
            val cx = (pose.x * w).toFloat()
            val cy = (pose.y * h).toFloat()

            canvas.save()
            canvas.translate(cx, cy)
            if (pose.rotation != 0.0) {
                canvas.rotate(pose.rotation.toFloat())
            }

            // Apply mask if specified (circle or rounded corners)
            if (ov.mask != null) {
                val shortSide = minOf(drawW, drawH)
                val clipPath = android.graphics.Path()
                val halfW = drawW / 2f
                val halfH = drawH / 2f
                val rect = RectF(-halfW, -halfH, halfW, halfH)
                if (ov.mask.shape == "circle") {
                    clipPath.addCircle(0f, 0f, shortSide / 2f, android.graphics.Path.Direction.CW)
                } else {
                    val r = (ov.mask.radius * shortSide).toFloat()
                    clipPath.addRoundRect(rect, r, r, android.graphics.Path.Direction.CW)
                }
                canvas.clipPath(clipPath)
            }

            paint.alpha = (pose.opacity.coerceIn(0.0, 1.0) * 255).toInt()
            dst.set(-drawW / 2f, -drawH / 2f, drawW / 2f, drawH / 2f)
            canvas.drawBitmap(bmp, null, dst, paint)
            canvas.restore()
        }
    }

    private fun getBitmap(id: String, path: String): Bitmap? {
        bitmaps[id]?.let { if (!it.isRecycled) return it }
        val file = File(path)
        if (!file.isFile) return null
        return try {
            val bmp = BitmapFactory.decodeFile(file.absolutePath)
            if (bmp != null) bitmaps[id] = bmp
            bmp
        } catch (_: Throwable) {
            null
        }
    }
}

/**
 * Renders captions and titles (contract §3.4) with per-word timing: word_pop, karaoke, word_box, word_reveal, none.
 * Scaled relative to the reference design width (360dp) to guarantee 1:1 WYSIWYG parity with the Flutter preview.
 */
@UnstableApi
class CaptionOverlay(
    private val captions: List<IrCaption>,
    private val typefaceFor: (family: String, weight: Int) -> Typeface,
) : CanvasOverlay(/* useInputFrameSize= */ true) {

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeMiter = 2f
    }
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

    /** [slot] = room the word takes in the line: its width, grown by its word_pop scale so a popping word never
     *  overlaps its neighbours (the line does not reflow while words pop). */
    private data class Token(val word: IrWord, val text: String, val width: Float, val slot: Float)

    override fun onDraw(canvas: Canvas, presentationTimeUs: Long) {
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
        val t = presentationTimeUs / 1000.0
        for (cap in captions) {
            if (t >= cap.startMs && t < cap.endMs) drawCaption(canvas, cap, t)
        }
    }

    private fun drawCaption(canvas: Canvas, cap: IrCaption, t: Double) {
        val st = cap.style
        val w = canvas.width.toFloat()
        val h = canvas.height.toFloat()
        // 1:1 WYSIWYG scale: Flutter preview renders in dp on a ~360dp viewport.
        // Scaling by (w / 360f) ensures captions appear in the exact same proportion in the export as in the editor.
        val scaleFactor = (w / 360f).coerceAtLeast(1f)
        val motion = TextMotion.at(st.enter, st.exit, st.loop, cap.startMs, cap.endMs, t)
        if (motion.opacity <= 0.0) return
        val tf = typefaceFor(st.fontFamily, st.fontWeight)
        val size = (st.fontSizePx * scaleFactor).toFloat()
        val strokeWidth = (st.strokeWidthPx * scaleFactor).toFloat()
        for (p in listOf(fill, stroke)) {
            p.typeface = tf
            p.textSize = size
        }
        val allWords = cap.words.ifEmpty {
            // A caption without word timings is still drawn, as a single static word run.
            listOf(IrWord(cap.text, cap.startMs, cap.endMs, false, null, 1.0))
        }
        // Typewriter: the same number of characters as the preview (ceil(total * reveal)), cut at that point.
        val words = if (motion.reveal >= 1.0) allWords else {
            var left = kotlin.math.ceil(allWords.sumOf { it.text.length } * motion.reveal).toInt()
            allWords.mapNotNull { wd ->
                if (left <= 0) null else {
                    val take = minOf(left, wd.text.length)
                    left -= take
                    if (take == wd.text.length) wd else wd.copy(text = wd.text.substring(0, take))
                }
            }
        }
        if (words.isEmpty()) return
        val tokens = words.map {
            val text = if (st.uppercase) it.text.uppercase() else it.text
            val width = fill.measureText(text)
            val pop = if (st.animation == "word_pop") it.scale.coerceAtLeast(1.0).toFloat() else 1f
            Token(it, text, width, width * pop)
        }
        // The outline is drawn centred on the glyph edge, so it eats strokeWidth into the gap on each side.
        val space = fill.measureText(" ") + 2f * strokeWidth
        val maxWidth = (st.maxWidthFraction * w).toFloat()

        // Greedy word wrap.
        val lines = mutableListOf<MutableList<Token>>()
        var cur = mutableListOf<Token>()
        var curW = 0f
        for (tok in tokens) {
            val add = if (cur.isEmpty()) tok.slot else curW + space + tok.slot
            if (cur.isNotEmpty() && add > maxWidth) {
                lines.add(cur)
                cur = mutableListOf(tok)
                curW = tok.slot
            } else {
                cur.add(tok)
                curW = add
            }
        }
        if (cur.isNotEmpty()) lines.add(cur)

        val fm = fill.fontMetrics
        val lineHeight = (fm.descent - fm.ascent) * 1.1f
        val blockH = lineHeight * lines.size
        val lineWidths = lines.map { l -> l.sumOf { it.slot.toDouble() }.toFloat() + space * (l.size - 1) }
        val blockW = lineWidths.maxOrNull() ?: 0f
        val cx = (st.positionX * w).toFloat()
        val cy = (st.positionY * h).toFloat()
        val top = cy - blockH / 2f

        // Motion: move, rotate and scale the whole block around its centre; fade through the paints' alpha.
        canvas.save()
        canvas.translate((motion.dx * w).toFloat(), (motion.dy * h).toFloat())
        if (motion.rotationDeg != 0.0) canvas.rotate(motion.rotationDeg.toFloat(), cx, cy)
        if (motion.scale != 1.0) canvas.scale(motion.scale.toFloat(), motion.scale.toFloat(), cx, cy)
        val alpha = (motion.opacity * 255).toInt().coerceIn(0, 255)

        st.background?.let { b ->
            bg.color = b.color
            bg.alpha = Color.alpha(b.color) * alpha / 255
            val pad = (b.paddingPx * scaleFactor).toFloat()
            val r = (b.radiusPx * scaleFactor).toFloat()
            canvas.drawRoundRect(RectF(cx - blockW / 2 - pad, top - pad, cx + blockW / 2 + pad, top + blockH + pad), r, r, bg)
        }

        stroke.strokeWidth = strokeWidth * 2f // stroke is centred on the glyph edge
        stroke.color = st.strokeColor
        stroke.alpha = Color.alpha(st.strokeColor) * alpha / 255
        when {
            st.glow -> fill.setShadowLayer(size * 0.25f, 0f, 0f, st.highlightColor)
            st.shadow -> fill.setShadowLayer(6f * scaleFactor, 0f, 4f * scaleFactor, 0xA0000000.toInt())
            else -> fill.clearShadowLayer()
        }

        lines.forEachIndexed { li, line ->
            var x = cx - lineWidths[li] / 2f
            val baseline = top + li * lineHeight - fm.ascent + (lineHeight - (fm.descent - fm.ascent)) / 2f
            for (tok in line) {
                // word_reveal: a word is not drawn before it is spoken (its room in the line is kept).
                if (st.animation == "word_reveal" && t < tok.word.startMs) {
                    x += tok.slot + space
                    continue
                }
                val (color, scale) = styleFor(tok.word, st, t)
                canvas.save()
                val textX = x + (tok.slot - tok.width) / 2f
                val wordCx = x + tok.slot / 2f
                val wordCy = baseline + (fm.ascent + fm.descent) / 2f
                canvas.scale(scale, scale, wordCx, wordCy)
                // word_box: a rounded box in the highlight colour behind the spoken word.
                if (st.animation == "word_box" && t >= tok.word.startMs && t < tok.word.endMs) {
                    val boxColor = tok.word.color ?: st.highlightColor
                    bg.color = boxColor
                    bg.alpha = Color.alpha(boxColor) * alpha / 255
                    val padX = size * 0.14f
                    val r = size * 0.12f
                    canvas.drawRoundRect(RectF(textX - padX, baseline + fm.ascent, textX + tok.width + padX, baseline + fm.descent), r, r, bg)
                }
                if (st.strokeWidthPx > 0) canvas.drawText(tok.text, textX, baseline, stroke)
                fill.color = color
                fill.alpha = Color.alpha(color) * alpha / 255
                canvas.drawText(tok.text, textX, baseline, fill)
                canvas.restore()
                x += tok.slot + space
            }
        }
        canvas.restore() // motion transform
    }

    private fun styleFor(word: IrWord, st: IrCaptionStyle, t: Double): Pair<Int, Float> {
        val active = t >= word.startMs && t < word.endMs
        val activeColor = word.color ?: st.highlightColor
        val restingColor = if (word.highlight) (word.color ?: st.highlightColor) else st.textColor
        return when (st.animation) {
            "word_pop" -> if (active) {
                val p = easeOut(((t - word.startMs) / 120.0).coerceIn(0.0, 1.0))
                activeColor to (1.0 + (word.scale - 1.0) * p).toFloat()
            } else restingColor to 1f
            "karaoke" -> when {
                active -> activeColor to 1f
                t >= word.endMs -> st.highlightColor to 1f
                else -> restingColor to 1f
            }
            // The box carries the highlight, so the spoken word keeps the text colour.
            "word_box" -> (if (active) st.textColor else restingColor) to 1f
            "word_reveal" -> (if (active) activeColor else restingColor) to 1f
            else -> restingColor to 1f
        }
    }
}

/**
 * Paints `canvas.background` into the letterbox bars that [androidx.media3.effect.Presentation]
 * leaves black in `LAYOUT_SCALE_TO_FIT` mode (contract §3.1). Presentation has no fill colour, so
 * the bars are drawn over the fitted frame: the content rect is recomputed from the source aspect
 * ratio exactly as Presentation centres it, and only the area outside it is filled.
 */
@UnstableApi
class LetterboxFill(
    private val color: Int,
    /** Display aspect ratio (width / height) of the picture after rotation, before fitting. */
    private val contentAspect: Float,
) : CanvasOverlay(/* useInputFrameSize= */ true) {
    private val paint = Paint().apply {
        style = Paint.Style.FILL
        color = this@LetterboxFill.color
    }

    override fun onDraw(canvas: Canvas, presentationTimeUs: Long) {
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
        val w = canvas.width.toFloat()
        val h = canvas.height.toFloat()
        if (w <= 0f || h <= 0f || contentAspect <= 0f) return
        if (contentAspect > w / h) {
            // Wider than the canvas: bars above and below.
            val bar = (h - w / contentAspect) / 2f
            if (bar < 0.5f) return
            canvas.drawRect(0f, 0f, w, bar, paint)
            canvas.drawRect(0f, h - bar, w, h, paint)
        } else {
            // Bars left and right.
            val bar = (w - h * contentAspect) / 2f
            if (bar < 0.5f) return
            canvas.drawRect(0f, 0f, bar, h, paint)
            canvas.drawRect(w - bar, 0f, w, h, paint)
        }
    }
}

/**
 * Brand logo watermark (contract §3.9): the bitmap is scaled to `widthFraction` of the canvas width (aspect kept),
 * placed in the requested corner with a margin of 4% of the shorter canvas side, and drawn at `opacityPct`.
 * It is static, so the same pixels are drawn on every frame.
 */
@UnstableApi
class WatermarkOverlay(
    private val bitmap: android.graphics.Bitmap,
    private val position: String,
    opacityPct: Double,
    private val widthFraction: Double,
    private val normX: Double? = null,
    private val normY: Double? = null,
    private val normW: Double? = null,
    private val normH: Double? = null,
) : CanvasOverlay(/* useInputFrameSize= */ true) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
        alpha = (opacityPct.coerceIn(0.0, 100.0) / 100.0 * 255).toInt()
    }
    private val dst = RectF()

    override fun onDraw(canvas: Canvas, presentationTimeUs: Long) {
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
        val w = canvas.width.toFloat()
        val h = canvas.height.toFloat()
        if (w <= 0f || h <= 0f || bitmap.width <= 0 || bitmap.height <= 0 || paint.alpha == 0) return
        if (normX != null && normY != null && normW != null) {
            val drawW = (w * normW).toFloat()
            val drawH = if (normH != null) (h * normH).toFloat() else drawW * bitmap.height / bitmap.width
            val left = (w * normX).toFloat()
            val top = (h * normY).toFloat()
            dst.set(left, top, left + drawW, top + drawH)
        } else {
            val drawW = (w * widthFraction).toFloat()
            val drawH = drawW * bitmap.height / bitmap.width
            val margin = min(w, h) * 0.04f
            val left = if (position.endsWith("left")) margin else w - margin - drawW
            val top = if (position.startsWith("top")) margin else h - margin - drawH
            dst.set(left, top, left + drawW, top + drawH)
        }
        canvas.drawBitmap(bitmap, null, dst, paint)
    }
}

