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
        // CanvasOverlay reuses one bitmap for every frame and never clears it: without this, a sticker stayed on
        // screen after its end and a moving (keyframed) one left a trail of copies.
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
        val tMs = presentationTimeUs / 1000.0
        val w = canvas.width.toFloat()
        val h = canvas.height.toFloat()
        if (w <= 0f || h <= 0f) return

        for (ov in overlays) {
            if (tMs < ov.timelineStartMs || tMs >= ov.timelineEndMs) continue
            val layer = ov.layer ?: continue
            val path = overlayPaths[ov.id] ?: continue
            val bmp = getBitmap(ov.id, path, canvas.width, canvas.height) ?: continue
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

    /**
     * The layer's picture, upright (EXIF orientation applied, like the preview's Image.file and Media3's photo
     * decoder) and decoded at no more than about twice the canvas size so a 48 MP photo does not exhaust memory.
     */
    private fun getBitmap(id: String, path: String, canvasW: Int, canvasH: Int): Bitmap? {
        bitmaps[id]?.let { if (!it.isRecycled) return it }
        val file = File(path)
        if (!file.isFile) return null
        return try {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            val limit = 2 * max(canvasW, canvasH).coerceAtLeast(1)
            var sample = 1
            while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= limit) sample *= 2
            val decoded = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
            var bmp = upright(decoded, file.absolutePath)
            // Green / blue screen on a photo layer: keyed once here (video layers are keyed by ChromaKeyEffect).
            overlays.firstOrNull { it.id == id }?.chromaKey?.let { key ->
                val keyed = if (bmp.isMutable && bmp.config == Bitmap.Config.ARGB_8888) bmp else bmp.copy(Bitmap.Config.ARGB_8888, true).also { bmp.recycle() }
                val px = IntArray(keyed.width * keyed.height)
                keyed.getPixels(px, 0, keyed.width, 0, 0, keyed.width, keyed.height)
                ChromaKeyCpu.apply(px, key)
                keyed.setHasAlpha(true)
                keyed.setPixels(px, 0, keyed.width, 0, 0, keyed.width, keyed.height)
                bmp = keyed
            }
            bitmaps[id] = bmp
            bmp
        } catch (_: Throwable) {
            null
        }
    }

    private fun upright(bmp: Bitmap, path: String): Bitmap {
        val orientation = try {
            android.media.ExifInterface(path).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, android.media.ExifInterface.ORIENTATION_NORMAL)
        } catch (_: Exception) {
            android.media.ExifInterface.ORIENTATION_NORMAL
        }
        val m = Matrix()
        when (orientation) {
            android.media.ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.setScale(-1f, 1f)
            android.media.ExifInterface.ORIENTATION_ROTATE_180 -> m.setRotate(180f)
            android.media.ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.setScale(1f, -1f)
            android.media.ExifInterface.ORIENTATION_TRANSPOSE -> { m.setRotate(90f); m.postScale(-1f, 1f) }
            android.media.ExifInterface.ORIENTATION_ROTATE_90 -> m.setRotate(90f)
            android.media.ExifInterface.ORIENTATION_TRANSVERSE -> { m.setRotate(-90f); m.postScale(-1f, 1f) }
            android.media.ExifInterface.ORIENTATION_ROTATE_270 -> m.setRotate(-90f)
            else -> return bmp
        }
        val out = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        if (out !== bmp) bmp.recycle()
        return out
    }
}

/** Marker token for a hard line break typed into a title ("\n"). */
internal const val LINE_BREAK = "\n"

/** True if text belongs to a script written without spaces between words (CJK, Thai, Lao, Khmer, Burmese). */
internal fun isNoSpaceScript(text: String): Boolean {
    for (i in 0 until text.length) {
        val cp = text.codePointAt(i)
        if ((cp in 0x4e00..0x9fff) || (cp in 0x3400..0x4dbf) ||
            (cp in 0x3040..0x30ff) || (cp in 0x31f0..0x31ff) ||
            (cp in 0x0e00..0x0e7f) || (cp in 0x0e80..0x0eff) ||
            (cp in 0x1780..0x17ff) || (cp in 0x1000..0x109f)) {
            return true
        }
    }
    return false
}

/**
 * End offsets (exclusive, UTF-16) of each grapheme cluster in [text], so a reveal never cuts an Indic conjunct, an
 * Arabic joined letter, a combining mark or an emoji in half.
 */
internal fun graphemeEnds(text: String): IntArray = CaptionIcu.api.graphemeEnds(text)

/** True when the text contains strong right-to-left characters (Arabic, Urdu, Persian, Sindhi, Hebrew). */
internal fun hasRtl(text: String): Boolean {
    for (i in 0 until text.length) {
        val cp = text.codePointAt(i)
        if ((cp in 0x0600..0x06ff) || (cp in 0x0750..0x077f) ||
            (cp in 0x08a0..0x08ff) || (cp in 0xfb50..0xfeff) ||
            (cp in 0x0590..0x05ff)) {
            return true
        }
    }
    return false
}

/** True if the script has upper/lower case (Latin, Greek, Cyrillic). */
internal fun isCasedScript(text: String): Boolean {
    for (i in 0 until text.length) {
        val cp = text.codePointAt(i)
        if ((cp in 0x0041..0x005a) || (cp in 0x0061..0x007a) ||
            (cp in 0x00c0..0x024f) || (cp in 0x0400..0x04ff) ||
            (cp in 0x0370..0x03ff)) {
            return true
        }
    }
    return false
}

/** Joins words according to script rules (no spaces between adjacent CJK/Thai words). */
internal fun joinWordsForScript(words: List<String>): String {
    if (words.isEmpty()) return ""
    val first = words.firstOrNull { it.isNotBlank() } ?: ""
    if (!isNoSpaceScript(first)) return words.joinToString(" ")
    val sb = StringBuilder()
    for (i in words.indices) {
        val curr = words[i]
        if (i > 0) {
            val prev = words[i - 1]
            val prevAscii = prev.all { it.code in 32..126 }
            val currAscii = curr.all { it.code in 32..126 }
            if (prevAscii && currAscii) sb.append(' ')
        }
        sb.append(curr)
    }
    return sb.toString()
}

/** Font family lookup for non-Latin scripts to avoid tofu. */
internal fun fontForText(text: String, defaultFamily: String): String {
    for (i in 0 until text.length) {
        val cp = text.codePointAt(i)
        when (cp) {
            in 0x0900..0x097f -> return if (defaultFamily in listOf("Poppins", "Baloo 2")) defaultFamily else "Noto Sans Devanagari"
            in 0x0980..0x09ff -> return "Noto Sans Bengali"
            in 0x0a00..0x0a7f -> return "Noto Sans Gurmukhi"
            in 0x0a80..0x0aff -> return "Noto Sans Gujarati"
            in 0x0b00..0x0b7f -> return "Noto Sans Oriya"
            in 0x0b80..0x0bff -> return "Noto Sans Tamil"
            in 0x0c00..0x0c7f -> return "Noto Sans Telugu"
            in 0x0c80..0x0cff -> return "Noto Sans Kannada"
            in 0x0d00..0x0d7f -> return "Noto Sans Malayalam"
            in 0x0600..0x06ff, in 0x0750..0x077f, in 0x08a0..0x08ff, in 0xfb50..0xfeff ->
                return if (defaultFamily in listOf("Cairo", "Tajawal")) defaultFamily else "Noto Sans Arabic"
            in 0x0e00..0x0e7f -> return if (defaultFamily in listOf("Kanit", "Prompt")) defaultFamily else "Noto Sans Thai"
            in 0x3040..0x30ff, in 0x31f0..0x31ff -> return "Noto Sans JP"
            in 0xac00..0xd7af, in 0x1100..0x11ff, in 0x3130..0x318f -> return "Noto Sans KR"
            in 0x4e00..0x9fff, in 0x3400..0x4dbf -> return if (defaultFamily == "Noto Sans JP") "Noto Sans JP" else "Noto Sans SC"
        }
    }
    return defaultFamily
}

/**
 * The words a caption draws, in order (mirrors `EditIrCaption.displayWords` in edit_ir.dart):
 *  - a title (`kind: text`) draws its `text`, word by word, for its whole time range (its `words` are only a copy
 *    of the text, which goes stale when the text is edited);
 *  - a speech caption draws its timed `words`, unless its `text` was edited so it no longer matches them: then the
 *    new text is drawn, re-timed across the caption by character count (a correction with the same word count keeps
 *    each word's own timing and emphasis);
 *  - a caption without words draws its text for its whole range.
 * Typed line breaks become [LINE_BREAK] tokens.
 */
internal fun displayWords(cap: IrCaption): List<IrWord> {
    fun norm(s: String) = s.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ")
    // One tokeniser for both renderers (CaptionText.tokens, mirrored by EditIrCaption.tokens in edit_ir.dart):
    // spaces, then ICU word breaks for Thai/Lao/Khmer/Burmese and the kanji/kana rule for CJK.
    fun tokens(text: String): List<String> = CaptionText.tokens(text)
    fun static(text: String) = tokens(text).map { IrWord(it, cap.startMs, cap.endMs, false, null, 1.0) }

    val spoken = cap.words.filter { it.text.isNotBlank() }
    val joinedSpoken = joinWordsForScript(spoken.map { it.text })
    if (cap.kind == "text") return static(cap.text.ifBlank { joinedSpoken })
    if (spoken.isEmpty()) return static(cap.text)
    if (cap.text.isBlank() || norm(cap.text) == norm(joinedSpoken) || cap.text.trim() == joinedSpoken.trim()) return spoken
    // The text was edited after transcription: draw what the user typed.
    val parts = tokens(cap.text)
    val words = parts.filter { it != LINE_BREAK }
    if (words.size == spoken.size) {
        var i = 0
        return parts.map { p -> if (p == LINE_BREAK) IrWord(p, cap.startMs, cap.endMs, false, null, 1.0) else spoken[i++].copy(text = p) }
    }
    val total = words.sumOf { it.length }.coerceAtLeast(1)
    val span = (cap.endMs - cap.startMs).toDouble()
    val pop = spoken.maxOf { it.scale }
    var done = 0
    return parts.map { p ->
        if (p == LINE_BREAK) return@map IrWord(p, cap.startMs, cap.endMs, false, null, 1.0)
        val s = cap.startMs + (span * done / total).toLong()
        done += p.length
        val e = (cap.startMs + (span * done / total).toLong()).coerceIn(s + 1, cap.endMs)
        IrWord(p, s, e, false, null, pop)
    }
}

/**
 * Renders captions and titles (contract §3.4) with per-word timing: word_pop, karaoke, word_box, word_reveal, none.
 *
 * Units: `fontSizePx`, `strokeWidthPx` and the background `paddingPx` / `radiusPx` are canvas pixels (contract §3.4),
 * so they are scaled by frameWidth / [canvasWidth] (1 at the canvas size the overlay is drawn at). A preview drawn
 * W logical pixels wide must scale them by W / canvas.width to match the export.
 */
@UnstableApi
class CaptionOverlay(
    private val captions: List<IrCaption>,
    private val typefaceFor: (family: String, weight: Int) -> Typeface,
    private val canvasWidth: Int,
    /** Optional face track (IR `faceBoxes`) for v2 face avoidance. */
    faces: List<IrFaceBox> = emptyList(),
) : CanvasOverlay(/* useInputFrameSize= */ true) {

    init { AndroidCaptionIcu.install() }

    /** Captions with a v2 spec (`style.styleV2`) are drawn by the v2 engine; the rest keep the v1 path below. */
    val v2 = CaptionV2Renderer(typefaceFor, canvasWidth, faces)

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeMiter = 2f
    }
    private val stroke2 = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeMiter = 2f
    }
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

    companion object {
        val SAFE_ZONES: Map<String, CaptionSafeZone> get() = CAPTION_SAFE_ZONES
    }

    private data class CachedLayout(
        val scaleFactor: Float,
        val effectiveSize: Float,
        val lines: List<List<Token>>,
        val lineWidths: List<Float>,
        val blockW: Float,
        val blockH: Float,
        val lineHeight: Float,
        val fmDescent: Float,
        val fmAscent: Float,
    )
    private val layoutCache = HashMap<String, CachedLayout>()

    /** [slot] = room the word takes in the line: its width, grown by its word_pop scale so a popping word never
     *  overlaps its neighbours (the line does not reflow while words pop). */
    private data class Token(val word: IrWord, val text: String, val width: Float, val slot: Float)

    /** Display words per caption id: the IR is immutable for the whole render, so they are worked out once. */
    private val wordsCache = HashMap<String, List<IrWord>>()

    /** [text] cut into pieces no wider than [maxWidth] (whole surrogate pairs kept together). */
    private fun splitToWidth(text: String, maxWidth: Float): List<String> {
        if (text.isEmpty() || fill.measureText(text) <= maxWidth) return listOf(text)
        val out = mutableListOf<String>()
        try {
            val bi = android.icu.text.BreakIterator.getLineInstance()
            bi.setText(text)
            var start = bi.first()
            var current = start
            var lineStart = start
            while (bi.next().also { current = it } != android.icu.text.BreakIterator.DONE) {
                val candidate = text.substring(lineStart, current)
                if (fill.measureText(candidate) > maxWidth && lineStart != start) {
                    out.add(text.substring(lineStart, start))
                    lineStart = start
                }
                start = current
            }
            if (lineStart < text.length) {
                out.add(text.substring(lineStart))
            }
            if (out.isNotEmpty()) return out
        } catch (_: Throwable) {}
        // Never cut inside a grapheme cluster (an Indic conjunct, a joined Arabic letter, an emoji sequence).
        return CaptionText.splitToWidth(text, maxWidth.toDouble()) { fill.measureText(it).toDouble() }
    }

    override fun onDraw(canvas: Canvas, presentationTimeUs: Long) {
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
        val t = presentationTimeUs / 1000.0
        for (cap in captions) {
            if (t >= cap.startMs && t < cap.endMs) drawCaption(canvas, cap, t)
        }
    }

    /** Draws the captions at [presentationTimeUs] on [canvas] (the export calls this through onDraw; tests call it directly). */
    fun drawAt(canvas: Canvas, presentationTimeUs: Long) = onDraw(canvas, presentationTimeUs)

    private fun drawCaption(canvas: Canvas, cap: IrCaption, t: Double) {
        cap.v2?.let { spec ->
            v2.draw(canvas, cap, spec, wordsCache.getOrPut(cap.id) { displayWords(cap) }, t)
            return
        }
        val st = cap.style
        val w = canvas.width.toFloat()
        val h = canvas.height.toFloat()
        // Canvas-pixel units (contract §3.4) to this frame's pixels.
        val scaleFactor = if (canvasWidth > 0) w / canvasWidth else 1f
        val motion = TextMotion.at(st.enter, st.exit, st.loop, cap.startMs, cap.endMs, t)
        if (motion.opacity <= 0.0) return
        val effectiveFamily = fontForText(cap.text, st.fontFamily)
        val tf = typefaceFor(effectiveFamily, st.fontWeight)
        val baseSize = (st.fontSizePx * scaleFactor).toFloat()

        val allWords = wordsCache.getOrPut(cap.id) { displayWords(cap) }
        if (allWords.isEmpty() || motion.reveal <= 0.0) return

        // Compute or retrieve cached layout with auto-fit downscaling for maxLines
        val layout = layoutCache.getOrPut(cap.id + "_" + scaleFactor) {
            var curSize = baseSize
            var finalLines: List<List<Token>> = emptyList()
            var finalLineWidths: List<Float> = emptyList()
            var finalBlockW = 0f
            var finalBlockH = 0f
            var finalLineHeight = 0f
            var finalDescent = 0f
            var finalAscent = 0f

            val maxAllowedLines = st.maxLines.coerceIn(1, 2)
            for (attempt in 0..2) {
                fill.typeface = tf
                fill.textSize = curSize
                val strokeWidth = (st.strokeWidthPx * scaleFactor).toFloat()
                val space = fill.measureText(" ") + 2f * strokeWidth
                val maxWidth = (st.maxWidthFraction * w).toFloat().coerceAtLeast(curSize)
                val tokens = mutableListOf<Token>()
                for (wd in allWords) {
                    if (wd.text == LINE_BREAK) {
                        tokens.add(Token(wd, LINE_BREAK, 0f, 0f))
                        continue
                    }
                    val pop = if (st.animation == "word_pop" || st.activeWordMotion == "scale-spring") (wd.scale.coerceAtLeast(1.0).toFloat() * 1.15f) else 1f
                    // Locale-aware when the caption's language is known (Turkish / Azeri i); otherwise as before.
                    val caseMode = if (st.textCase != "none") st.textCase else if (st.uppercase) "upper" else "none"
                    val formatted = if (caseMode != "none" && isCasedScript(wd.text)) {
                        if (cap.language != null || caseMode == "title") CaptionScripts.applyCase(wd.text, caseMode, cap.language)
                        else if (cap.text.any { it.code in 0x0130..0x0131 }) wd.text.uppercase(java.util.Locale("tr"))
                        else wd.text.uppercase()
                    } else wd.text
                    for (piece in splitToWidth(formatted, maxWidth / pop)) {
                        val width = fill.measureText(piece)
                        tokens.add(Token(wd, piece, width, width * pop))
                    }
                }
                fun tokenGap(a: Token, b: Token): Float =
                    if (isNoSpaceScript(a.text) && isNoSpaceScript(b.text)) 0f else space

                val lines = mutableListOf<MutableList<Token>>()
                var cur = mutableListOf<Token>()
                var curW = 0f
                for (tok in tokens) {
                    if (tok.text == LINE_BREAK) {
                        lines.add(cur)
                        cur = mutableListOf()
                        curW = 0f
                        continue
                    }
                    val gap = if (cur.isEmpty()) 0f else tokenGap(cur.last(), tok)
                    val add = curW + gap + tok.slot
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
                val lineWidths = lines.map { l ->
                    if (l.isEmpty()) 0f
                    else {
                        var lw = 0f
                        for (i in l.indices) {
                            if (i > 0) lw += tokenGap(l[i - 1], l[i])
                            lw += l[i].slot
                        }
                        lw
                    }
                }
                finalLines = lines
                finalLineWidths = lineWidths
                finalBlockW = lineWidths.maxOrNull() ?: 0f
                finalBlockH = lineHeight * lines.size
                finalLineHeight = lineHeight
                finalDescent = fm.descent
                finalAscent = fm.ascent

                if (lines.size <= maxAllowedLines || attempt == 2) break
                // Auto-fit size downscale when lines exceed maxLines
                curSize *= (maxAllowedLines.toFloat() / lines.size.toFloat()).coerceIn(0.6f, 0.9f)
            }

            CachedLayout(
                scaleFactor = scaleFactor,
                effectiveSize = curSize,
                lines = finalLines,
                lineWidths = finalLineWidths,
                blockW = finalBlockW,
                blockH = finalBlockH,
                lineHeight = finalLineHeight,
                fmDescent = finalDescent,
                fmAscent = finalAscent,
            )
        }

        // Typewriter / mask-wipe reveal: the layout stays the full caption (no reflow while typing); each token shows
        // the prefix of its text that the reveal has reached, counted in grapheme clusters in reading order.
        val revealed: java.util.IdentityHashMap<Token, String>? = if (motion.reveal >= 1.0) null else {
            val all = layout.lines.flatten()
            val clusters = all.map { graphemeEnds(it.text) }
            var budget = kotlin.math.ceil(clusters.sumOf { it.size } * motion.reveal).toInt()
            java.util.IdentityHashMap<Token, String>().also { map ->
                all.forEachIndexed { i, tok ->
                    val ends = clusters[i]
                    val take = minOf(budget, ends.size)
                    budget -= take
                    map[tok] = if (take == 0) "" else tok.text.substring(0, ends[take - 1])
                }
            }
        }

        val size = layout.effectiveSize
        val strokeWidth = (st.strokeWidthPx * scaleFactor).toFloat()
        val stroke2Width = ((st.strokeWidthPx + st.stroke2WidthPx) * scaleFactor).toFloat()
        for (p in listOf(fill, stroke, stroke2)) {
            p.typeface = tf
            p.textSize = size
        }

        val tr = TextTransform.at(st, cap.startMs, cap.endMs, t)
        var cx = (tr.positionX * w).toFloat()
        var cy = (tr.positionY * h).toFloat()
        val blockW = layout.blockW
        val blockH = layout.blockH

        // Safe zone clamping (TikTok, Reels, Shorts margins)
        val sz = CAPTION_SAFE_ZONES[st.safeZone] ?: CAPTION_SAFE_ZONES["none"]!!
        val sx = w / 1080f
        val sy = h / 1920f
        val safeL = sz.left * sx
        val safeR = w - sz.right * sx
        val safeT = sz.top * sy
        val safeB = h - sz.bottom * sy
        cx = cx.coerceIn(safeL + blockW / 2f, (safeR - blockW / 2f).coerceAtLeast(safeL + blockW / 2f))
        cy = cy.coerceIn(safeT + blockH / 2f, (safeB - blockH / 2f).coerceAtLeast(safeT + blockH / 2f))

        val rotation = tr.rotationDeg + motion.rotationDeg
        val blockScale = tr.scale * motion.scale
        val top = cy - blockH / 2f

        canvas.save()
        canvas.translate((motion.dx * w).toFloat(), (motion.dy * h).toFloat())
        if (rotation != 0.0) canvas.rotate(rotation.toFloat(), cx, cy)
        if (blockScale != 1.0) canvas.scale(blockScale.toFloat(), blockScale.toFloat(), cx, cy)
        val alpha = (motion.opacity * 255).toInt().coerceIn(0, 255)

        // Background rendering (pill, line, word)
        st.background?.let { b ->
            val bgAlpha = (Color.alpha(b.color) * st.backgroundOpacity * alpha / 255).toInt().coerceIn(0, 255)
            bg.color = b.color
            bg.alpha = bgAlpha
            val pad = (b.paddingPx * scaleFactor).toFloat()
            val r = (b.radiusPx * scaleFactor).toFloat()
            if (st.backgroundMode == "line") {
                layout.lines.forEachIndexed { li, _ ->
                    val lineTop = top + li * layout.lineHeight
                    val lw = layout.lineWidths[li]
                    canvas.drawRoundRect(RectF(cx - lw / 2 - pad, lineTop - pad, cx + lw / 2 + pad, lineTop + layout.lineHeight + pad), r, r, bg)
                }
            } else if (st.backgroundMode != "none") {
                canvas.drawRoundRect(RectF(cx - blockW / 2 - pad, top - pad, cx + blockW / 2 + pad, top + blockH + pad), r, r, bg)
            }
        }

        // Drop shadow / glow configuration
        when {
            st.glowRadiusPx > 0 || st.glow -> {
                val glowR = if (st.glowRadiusPx > 0) (st.glowRadiusPx * scaleFactor).toFloat() else size * 0.25f
                val glowCol = st.glowColor ?: st.highlightColor
                fill.setShadowLayer(glowR, 0f, 0f, glowCol)
            }
            st.shadow -> {
                fill.setShadowLayer(
                    (st.shadowBlur * scaleFactor).toFloat().coerceAtLeast(1f),
                    (st.shadowX * scaleFactor).toFloat(),
                    (st.shadowY * scaleFactor).toFloat(),
                    st.shadowColor
                )
            }
            else -> fill.clearShadowLayer()
        }

        val space = fill.measureText(" ") + 2f * strokeWidth
        fun tokenGap(a: Token, b: Token): Float =
            if (isNoSpaceScript(a.text) && isNoSpaceScript(b.text)) 0f else space

        layout.lines.forEachIndexed { li, line ->
            // Unicode bidi (android.icu.text.Bidi) on the line as drawn; tokens placed in visual order.
            val visualTokens = if (line.any { hasRtl(it.text) }) {
                CaptionText.visualOrder(line.map { it.text }, CaptionScripts.isRtlParagraph(cap.text, cap.language)).map { line[it] }
            } else {
                line
            }

            var x = cx - layout.lineWidths[li] / 2f
            val baseline = top + li * layout.lineHeight - layout.fmAscent + (layout.lineHeight - (layout.fmDescent - layout.fmAscent)) / 2f
            for (idx in visualTokens.indices) {
                val tok = visualTokens[idx]
                if (idx > 0) {
                    x += tokenGap(visualTokens[idx - 1], tok)
                }
                if (st.animation == "word_reveal" && t < tok.word.startMs) {
                    x += tok.slot
                    continue
                }
                val shown = revealed?.get(tok) ?: tok.text
                if (shown.isEmpty()) {
                    x += tok.slot
                    continue
                }
                val (color, scale) = styleFor(tok.word, st, t)
                canvas.save()
                // A partly revealed right-to-left word grows from its right edge.
                val partialShift = if (shown.length < tok.text.length && hasRtl(tok.text)) tok.width - fill.measureText(shown) else 0f
                val textX = x + (tok.slot - tok.width) / 2f + partialShift
                val wordCx = x + tok.slot / 2f
                val wordCy = baseline + (layout.fmAscent + layout.fmDescent) / 2f
                canvas.scale(scale, scale, wordCx, wordCy)

                // Word box background
                val isWordActive = t >= tok.word.startMs && t < tok.word.endMs
                if ((st.animation == "word_box" || st.backgroundMode == "word" || st.wordActiveBgColor != null) && isWordActive) {
                    val boxColor = st.wordActiveBgColor ?: tok.word.color ?: st.highlightColor
                    bg.color = boxColor
                    bg.alpha = (Color.alpha(boxColor) * alpha / 255).coerceIn(0, 255)
                    val padX = (st.wordActiveBgPadPx * scaleFactor).toFloat()
                    val r = (st.wordActiveBgRadiusPx * scaleFactor).toFloat()
                    canvas.drawRoundRect(RectF(textX - padX, baseline + layout.fmAscent, textX + tok.width + padX, baseline + layout.fmDescent), r, r, bg)
                }

                // Outermost stroke (stroke 2)
                if (st.stroke2WidthPx > 0 && st.stroke2Color != null) {
                    stroke2.strokeWidth = stroke2Width * 2f
                    stroke2.color = st.stroke2Color
                    stroke2.alpha = (Color.alpha(st.stroke2Color) * alpha / 255).coerceIn(0, 255)
                    canvas.drawText(shown, textX, baseline, stroke2)
                }
                // Inner stroke (stroke 1)
                if (st.strokeWidthPx > 0) {
                    stroke.strokeWidth = strokeWidth * 2f
                    stroke.color = st.strokeColor
                    stroke.alpha = (Color.alpha(st.strokeColor) * alpha / 255).coerceIn(0, 255)
                    canvas.drawText(shown, textX, baseline, stroke)
                }

                // Text fill (solid or vertical gradient)
                if (st.gradientTopColor != null && st.gradientBottomColor != null) {
                    fill.shader = android.graphics.LinearGradient(
                        0f, baseline + layout.fmAscent, 0f, baseline + layout.fmDescent,
                        st.gradientTopColor, st.gradientBottomColor, android.graphics.Shader.TileMode.CLAMP
                    )
                } else {
                    fill.shader = null
                    fill.color = color
                    fill.alpha = (Color.alpha(color) * alpha / 255).coerceIn(0, 255)
                }
                canvas.drawText(shown, textX, baseline, fill)

                canvas.restore()
                x += tok.slot
            }
        }
        canvas.restore() // motion transform
    }

    private fun styleFor(word: IrWord, st: IrCaptionStyle, t: Double): Pair<Int, Float> {
        val active = t >= word.startMs && t < word.endMs
        val activeColor = st.wordActiveColor ?: word.color ?: st.highlightColor
        val restingColor = if (word.highlight) (st.wordEmphasisColor ?: word.color ?: st.highlightColor) else st.textColor
        val spokenColor = st.wordSpokenColor ?: if (st.animation == "karaoke") st.highlightColor else restingColor

        return when {
            active -> {
                val baseScale = if (word.highlight) st.wordEmphasisScale.toFloat() else 1f
                val activeScale = when {
                    st.activeWordMotion == "scale-spring" -> {
                        val spr = TextMotion.easeSpring((t - word.startMs) / 1000.0, st.springStiffness, st.springDamping)
                        (1.0 + (st.wordActiveScale - 1.0) * spr.coerceIn(0.0, 1.6)).toFloat()
                    }
                    st.animation == "word_pop" -> {
                        val p = easeOut(((t - word.startMs) / 120.0).coerceIn(0.0, 1.0))
                        (1.0 + (word.scale - 1.0) * p).toFloat()
                    }
                    else -> baseScale
                }
                val col = if (st.animation == "word_box") st.textColor else activeColor
                col to activeScale
            }
            t >= word.endMs -> spokenColor to 1f
            else -> restingColor to (if (word.highlight) st.wordEmphasisScale.toFloat() else 1f)
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

/**
 * Moving framing of a clip (contract `cropKeyframes`): translates the picture so the crop window at the current
 * SOURCE time ([CropPath.at]) lands where the static `crop` window is; the static Crop effect that follows then
 * shows the moving window at a constant size. Placed per item, before the crop.
 *
 * Source time is anchored on the item's first frame: frame [anchorSourceMs] is the first one this effect sees, and
 * later frames advance by their timestamp delta times [speed] (Media3 1.11 applies EditedMediaItem speed in the media
 * source, so item effects see output-time stamps). The export decodes every item from its first frame. The preview can start
 * part-way into an item after a seek, so it calls [reanchorAtTimeline] with the seek target first.
 */
@UnstableApi
class CropPanTransformation(
    private val crop: IrCrop,
    private val keyframes: List<IrCropKeyframe>,
    private val anchorSourceMs: Double,
    private val itemTimelineStartMs: Double,
    private val itemTimelineEndMs: Double,
    private val speed: Double,
    /** A still: one source instant, the framing does not move. */
    private val frozen: Boolean = false,
) : MatrixTransformation {
    @Volatile private var baseUs: Long? = null
    @Volatile private var pendingSourceMs: Double? = null

    /** The next frame this item shows is timeline [timelineMs] (a preview seek); ignored outside this item. */
    fun reanchorAtTimeline(timelineMs: Double) {
        if (frozen || timelineMs < itemTimelineStartMs || timelineMs >= itemTimelineEndMs) return
        pendingSourceMs = anchorSourceMs + (timelineMs - itemTimelineStartMs) * speed
    }

    override fun getMatrix(presentationTimeUs: Long): Matrix {
        val sourceMs = if (frozen) anchorSourceMs else {
            pendingSourceMs?.let { s ->
                baseUs = presentationTimeUs - ((s - anchorSourceMs) / speed * 1000).toLong()
                pendingSourceMs = null
            }
            val base = baseUs ?: presentationTimeUs.also { baseUs = it }
            anchorSourceMs + (presentationTimeUs - base) / 1000.0 * speed
        }
        val (dx, dy) = CropPath.shiftAt(crop, keyframes, sourceMs)
        // Frame fractions (y down) to NDC (y up, 2 units across).
        return Matrix().apply { setTranslate((2 * dx).toFloat(), (-2 * dy).toFloat()) }
    }

    override fun isNoOp(inputWidth: Int, inputHeight: Int): Boolean = keyframes.isEmpty()
}

