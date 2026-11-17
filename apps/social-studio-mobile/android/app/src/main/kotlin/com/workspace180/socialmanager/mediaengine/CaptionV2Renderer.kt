package com.workspace180.socialmanager.mediaengine

import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** A face box on the output timeline (optional IR `faceBoxes`): centre and size as canvas fractions at [tMs]. */
data class IrFaceBox(val tMs: Long, val x: Double, val y: Double, val w: Double, val h: Double)

/**
 * Draws a caption from its Caption Style Spec v2 (`style.styleV2`). The Flutter preview (caption_v2_painter.dart)
 * implements the same steps in the same order, so the two draw the same frame:
 *
 * Layout (once per caption and frame size, cached): display words → case (locale-aware, cased scripts only) → a font
 * per word from the template's font stack (by script) → measured at the template size → at most `maxLines` lines no
 * wider than the safe width (bottom-heavy balance; the font shrinks in 8 % steps when it does not fit; never 3+ lines)
 * → bidi visual order per line → block anchored by the position preset inside the platform safe zone → moved off the
 * faces seen during the caption.
 *
 * Frame: group enter / exit (fade, pop, spring-pop, slide, blur-in, scale-down-in, typewriter, mask-wipe), per-word
 * enter with stagger, word states (resting / active / spoken / emphasis: colour, scale, opacity, y-offset, box, blur),
 * active-word motion (scale-spring, colour-sweep, underline-grow, box-slide, bounce), then paint layers in order:
 * backgrounds, glow, shadow, strokes (outermost first), fill (solid or vertical gradient). Every layer carries the
 * motion alpha. Motion is evaluated in milliseconds, so it does not depend on the frame rate.
 */
class CaptionV2Renderer(
    private val typefaceFor: (family: String, weight: Int) -> Typeface,
    private val canvasWidth: Int,
    private val faces: List<IrFaceBox> = emptyList(),
) {
    init { AndroidCaptionIcu.install() }

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val rect = RectF()

    private class Placed(
        val word: IrWord,
        val wordIndex: Int,
        val text: String,
        val typeface: Typeface,
        val width: Float,
        val slot: Float,
        val line: Int,
        var x: Float = 0f,
        val rtl: Boolean,
    )

    private class Layout(
        val size: Float,
        val sf: Float,
        val items: List<Placed>,
        val lineCount: Int,
        val lineWidths: List<Float>,
        val lineLefts: List<Float>,
        val baselines: List<Float>,
        val ascent: Float,
        val descent: Float,
        val cx: Float,
        val cy: Float,
        val blockW: Float,
        val blockH: Float,
        val pad: Float,
        val rtl: Boolean,
        val allStatic: Boolean,
        val graphemes: Int,
        val letterSpacingEm: Float,
    )

    private val cache = HashMap<String, Layout>()

    /** Milliseconds spent laying captions out (first frame of each caption) and drawing them, for the perf test. */
    var lastLayoutMs = 0.0
        private set

    fun draw(canvas: Canvas, cap: IrCaption, spec: CaptionSpecV2, words: List<IrWord>, t: Double) {
        val w = canvas.width.toFloat()
        val h = canvas.height.toFloat()
        if (w <= 0f || h <= 0f || words.isEmpty()) return
        val layout = cache.getOrPut("${cap.id}@${canvas.width}x${canvas.height}") {
            val t0 = System.nanoTime()
            layout(cap, spec, words, w, h).also { lastLayoutMs = (System.nanoTime() - t0) / 1e6 }
        }
        if (layout.items.isEmpty()) return
        drawFrame(canvas, cap, spec, layout, t, w, h)
    }

    /* ───────────────────────────── layout ───────────────────────────── */

    private fun layout(cap: IrCaption, spec: CaptionSpecV2, words: List<IrWord>, w: Float, h: Float): Layout {
        val sf = if (canvasWidth > 0) w / canvasWidth else 1f
        val lang = cap.language
        val rtl = CaptionScripts.isRtlParagraph(cap.text.ifBlank { words.joinToString(" ") { it.text } }, lang)
        val size0 = (spec.sizePx * sf).toFloat()
        val primaryScript = CaptionScripts.forToken(cap.text.ifBlank { words.joinToString("") { it.text } }, cap.text, lang)
        val primaryTf = typefaceFor(spec.fontFor(primaryScript), spec.weight)

        // Measure every word once at the template size; other sizes scale linearly.
        data class M(val word: IrWord, val wi: Int, val text: String, val tf: Typeface, val width: Float, val scale: Float)
        val measured = ArrayList<M>()
        var hardBreaks = 0
        words.forEachIndexed { wi, wd ->
            if (wd.text == CaptionText.LINE_BREAK) {
                hardBreaks++
                // Typed breaks beyond the line limit become spaces (never more than maxLines lines).
                if (hardBreaks < spec.maxLines) measured.add(M(wd, wi, CaptionText.LINE_BREAK, primaryTf, 0f, 1f))
                return@forEachIndexed
            }
            val text = CaptionScripts.applyCase(wd.text, spec.case, lang)
            val tf = typefaceFor(spec.fontFor(CaptionScripts.forToken(text, cap.text, lang)), spec.weight)
            setFont(tf, size0, spec)
            val maxScale = maxOf(1.0, spec.active.scale, spec.spoken.scale, spec.resting.scale, if (wd.highlight) spec.emphasis.scale else 1.0)
            measured.add(M(wd, wi, text, tf, paint.measureText(text), maxScale.toFloat()))
        }
        setFont(primaryTf, size0, spec)
        val space0 = paint.measureText(" ")
        val fm = paint.fontMetrics

        val pad = if (spec.background.mode == "pill" || spec.background.mode == "line") (spec.background.paddingPx * sf).toFloat() else 0f
        val safe = CaptionV2Math.safeRect(spec.safeZone, w.toDouble(), h.toDouble())
        val maxWidth = (min(spec.maxWidthFraction * w, safe.width) - 2 * pad).coerceAtLeast(size0 * 0.5)

        // Shrink in 8 % steps until the words fit in maxLines lines (down to 30 % as a last resort).
        var factor = 1.0
        var lines: List<List<CaptionText.Item>>? = null
        var pieces: List<CaptionText.Item> = emptyList()
        while (true) {
            val items = ArrayList<CaptionText.Item>()
            measured.forEachIndexed { mi, m ->
                if (m.text == CaptionText.LINE_BREAK) { items.add(CaptionText.Item(mi, m.text, 0.0, 0.0, m.wi)); return@forEachIndexed }
                val wScaled = m.width * factor
                if (wScaled * m.scale <= maxWidth) {
                    items.add(CaptionText.Item(mi, m.text, wScaled, wScaled * m.scale, m.wi))
                } else {
                    setFont(m.tf, (size0 * factor).toFloat(), spec)
                    for (p in CaptionText.splitToWidth(m.text, maxWidth / m.scale) { paint.measureText(it).toDouble() }) {
                        val pw = paint.measureText(p).toDouble()
                        items.add(CaptionText.Item(mi, p, pw, pw * m.scale, m.wi))
                    }
                }
            }
            val gap = space0 * factor
            lines = CaptionText.breakLines(items, maxWidth, spec.maxLines, { a, b -> if (CaptionText.noGap(a.text, b.text)) 0.0 else gap }, spec.balance == "bottom-heavy")
            pieces = items
            if (lines != null || factor < 0.3) break
            factor *= 0.92
        }
        val finalLines = lines ?: listOf(pieces.filter { it.text != CaptionText.LINE_BREAK })
        val size = (size0 * factor).toFloat()
        val gap = (space0 * factor).toFloat()
        val ascent = (fm.ascent * factor).toFloat()
        val descent = (fm.descent * factor).toFloat()
        val adv = (size * spec.lineHeight).toFloat()

        val placed = ArrayList<Placed>()
        val lineWidths = ArrayList<Float>()
        finalLines.forEachIndexed { li, line ->
            var lw = 0f
            line.forEachIndexed { i, it ->
                if (i > 0 && !CaptionText.noGap(line[i - 1].text, it.text)) lw += gap
                lw += it.slot.toFloat()
            }
            lineWidths.add(lw)
            for (it in line) {
                val m = measured[it.index]
                placed.add(Placed(m.word, m.wi, it.text, m.tf, it.width.toFloat(), it.slot.toFloat(), li, rtl = rtl))
            }
        }
        val maxLineW = lineWidths.maxOrNull() ?: 0f
        val blockW = maxLineW + 2 * pad
        val blockH = adv * finalLines.size + 2 * pad
        var (cx, cy) = CaptionV2Math.anchor(spec, w.toDouble(), h.toDouble(), blockW.toDouble(), blockH.toDouble())
        if (spec.faceAvoid && faces.isNotEmpty()) {
            val seen = faces.filter { it.tMs >= cap.startMs - 500 && it.tMs <= cap.endMs + 500 }
                .map { CaptionV2Math.Rect((it.x - it.w / 2) * w, (it.y - it.h / 2) * h, (it.x + it.w / 2) * w, (it.y + it.h / 2) * h) }
            cy = CaptionV2Math.avoidFaces(cy, blockH.toDouble(), cx - blockW / 2, cx + blockW / 2, seen, safe, h.toDouble())
        }
        val top = (cy - blockH / 2).toFloat() + pad
        val blockLeft = (cx - maxLineW / 2).toFloat()
        val lineLefts = lineWidths.map { lw ->
            val startLeft = if (rtl) blockLeft + maxLineW - lw else blockLeft
            val endLeft = if (rtl) blockLeft else blockLeft + maxLineW - lw
            when (spec.align) { "start" -> startLeft; "end" -> endLeft; else -> cx.toFloat() - lw / 2 }
        }
        val baselines = (finalLines.indices).map { li -> top + li * adv + (adv - (descent - ascent)) / 2f - ascent }
        // Visual order per line (bidi), then x positions.
        finalLines.indices.forEach { li ->
            val onLine = placed.filter { it.line == li }
            val order = CaptionText.visualOrder(onLine.map { it.text }, rtl)
            var x = lineLefts[li]
            order.forEachIndexed { k, idx ->
                val p = onLine[idx]
                if (k > 0 && !CaptionText.noGap(onLine[order[k - 1]].text, p.text)) x += gap
                p.x = x
                x += p.slot
            }
        }
        val allStatic = words.all { it.startMs <= cap.startMs && it.endMs >= cap.endMs }
        val graphemes = placed.sumOf { CaptionIcu.api.graphemeEnds(it.text).size }
        return Layout(size, sf, placed, finalLines.size, lineWidths, lineLefts, baselines, ascent, descent, cx.toFloat(), cy.toFloat(), blockW, blockH, pad, rtl, allStatic, graphemes, spec.letterSpacingEm.toFloat())
    }

    private fun setFont(tf: Typeface, size: Float, spec: CaptionSpecV2) {
        paint.typeface = tf
        paint.textSize = size
        paint.letterSpacing = spec.letterSpacingEm.toFloat()
    }

    /* ───────────────────────────── frame ───────────────────────────── */

    private class WordLook(
        val color: Int?,
        val scale: Float,
        val opacity: Float,
        val dy: Float,
        val blur: Float,
        val box: V2WordBox?,
        val sweep: Float, // colour-sweep progress (−1 = none)
        val sweepColor: Int,
        val underline: Float,
        val shown: String,
    )

    private fun drawFrame(canvas: Canvas, cap: IrCaption, spec: CaptionSpecV2, L: Layout, t: Double, w: Float, h: Float) {
        val g = CaptionV2Motion.group(spec, cap.startMs, cap.endMs, t, L.sf.toDouble(), h.toDouble())
        if (g.opacity <= 0.001) return
        val tr = TextTransform.at(cap.style, cap.startMs, cap.endMs, t)

        canvas.save()
        canvas.translate(0f, g.dy.toFloat())
        val blockScale = (g.scale * tr.scale).toFloat()
        if (tr.rotationDeg != 0.0) canvas.rotate(tr.rotationDeg.toFloat(), L.cx, L.cy)
        if (blockScale != 1f) canvas.scale(blockScale, blockScale, L.cx, L.cy)
        if (g.wipe < 1.0) {
            val left = L.cx - L.blockW / 2
            val ww = (L.blockW * g.wipe).toFloat()
            if (L.rtl) canvas.clipRect(left + L.blockW - ww, -1e5f, left + L.blockW, 1e5f) else canvas.clipRect(left, -1e5f, left + ww, 1e5f)
        }
        val alpha = g.opacity

        // Typewriter: graphemes shown, in reading order.
        var budget = if (g.reveal >= 0 && L.allStatic) ceil(L.graphemes * g.reveal).toInt() else Int.MAX_VALUE
        val looks = L.items.mapIndexed { idx, p ->
            var shown = p.text
            if (g.reveal >= 0) {
                val ends = CaptionIcu.api.graphemeEnds(p.text)
                val take = if (L.allStatic) min(budget, ends.size).also { budget -= it } else {
                    val span = max(1L, p.word.endMs - p.word.startMs).toDouble()
                    ceil(ends.size * ((t - p.word.startMs) / span).coerceIn(0.0, 1.0)).toInt()
                }
                shown = if (take <= 0) "" else p.text.substring(0, ends[take - 1])
            }
            look(spec, cap, L, p, idx, t, shown)
        }

        // 1. Backgrounds.
        val bgSpec = spec.background
        if (bgSpec.mode != "none") {
            bgPaint.color = withAlpha(bgSpec.color, bgSpec.opacity * alpha)
            bgPaint.maskFilter = blurFilter(g.blurPx * L.sf)
            val r = (bgSpec.radiusPx * L.sf).toFloat()
            val bpad = (bgSpec.paddingPx * L.sf).toFloat()
            val adv = L.size * spec.lineHeight.toFloat()
            when (bgSpec.mode) {
                "pill" -> {
                    rect.set(L.cx - L.blockW / 2, L.cy - L.blockH / 2, L.cx + L.blockW / 2, L.cy + L.blockH / 2)
                    canvas.drawRoundRect(rect, r, r, bgPaint)
                }
                "line" -> for (li in 0 until L.lineCount) {
                    val top = L.cy - L.blockH / 2 + L.pad + li * adv
                    rect.set(L.lineLefts[li] - bpad, top - bpad, L.lineLefts[li] + L.lineWidths[li] + bpad, top + adv + bpad)
                    canvas.drawRoundRect(rect, r, r, bgPaint)
                }
                "word" -> L.items.forEachIndexed { i, p ->
                    if (looks[i].shown.isEmpty() || looks[i].opacity <= 0f) return@forEachIndexed
                    wordBox(p, L, bpad).let { canvas.drawRoundRect(it, r, r, bgPaint) }
                }
            }
            bgPaint.maskFilter = null
        }
        // Word state boxes (active / spoken / emphasis background) and the box that slides between words.
        drawWordBoxes(canvas, spec, cap, L, looks, t, alpha)

        // 2–5. Glow, shadow, strokes (outermost first), fill.
        spec.glow?.let { gl ->
            if (gl.radiusPx > 0 && gl.strength > 0) textPass(canvas, L, looks, alpha * gl.strength, g.blurPx) { p, lk ->
                paint.style = Paint.Style.FILL
                paint.color = gl.color
                paint.shader = null
                (gl.radiusPx * L.sf).toFloat()
            }
        }
        spec.shadow?.let { sh ->
            canvas.save()
            canvas.translate((sh.xPx * L.sf).toFloat(), (sh.yPx * L.sf).toFloat())
            textPass(canvas, L, looks, alpha, g.blurPx) { _, _ ->
                paint.style = Paint.Style.FILL
                paint.color = sh.color
                paint.shader = null
                (sh.blurPx * L.sf).toFloat()
            }
            canvas.restore()
        }
        val cumulative = spec.strokes.runningFold(0.0) { acc, s -> acc + s.widthPx }.drop(1)
        for (si in spec.strokes.indices.reversed()) {
            val s = spec.strokes[si]
            textPass(canvas, L, looks, alpha, g.blurPx) { _, _ ->
                paint.style = Paint.Style.STROKE
                paint.strokeJoin = Paint.Join.ROUND
                paint.strokeCap = Paint.Cap.ROUND
                paint.strokeWidth = (2 * cumulative[si] * L.sf).toFloat()
                paint.color = s.color
                paint.shader = null
                0f
            }
        }
        textPass(canvas, L, looks, alpha, g.blurPx, fill = true) { p, lk ->
            paint.style = Paint.Style.FILL
            val solid = lk.color
            if (solid == null && spec.gradientTop != null && spec.gradientBottom != null) {
                val base = L.baselines[p.line]
                paint.color = CaptionSpecV2.WHITE
                paint.shader = LinearGradient(0f, base + L.ascent, 0f, base + L.descent, spec.gradientTop, spec.gradientBottom, Shader.TileMode.CLAMP)
            } else {
                paint.shader = null
                paint.color = solid ?: spec.fillColor
            }
            0f
        }
        canvas.restore()
    }

    /** The rectangle of a word's glyph line box, padded. */
    private fun wordBox(p: Placed, L: Layout, pad: Float): RectF {
        val base = L.baselines[p.line]
        return RectF(p.x + (p.slot - p.width) / 2 - pad, base + L.ascent - pad * 0.5f, p.x + (p.slot + p.width) / 2 + pad, base + L.descent + pad * 0.5f)
    }

    private fun drawWordBoxes(canvas: Canvas, spec: CaptionSpecV2, cap: IrCaption, L: Layout, looks: List<WordLook>, t: Double, alpha: Double) {
        val slide = spec.activeWord.type == "box-slide"
        L.items.forEachIndexed { i, p ->
            val lk = looks[i]
            val box = lk.box ?: return@forEachIndexed
            if (lk.shown.isEmpty() || lk.opacity <= 0f) return@forEachIndexed
            val isActive = t >= p.word.startMs && t < p.word.endMs
            var r = wordBox(p, L, (box.paddingPx * L.sf).toFloat())
            if (slide && isActive) {
                // Slide from the previous word's box on the same line to this one.
                val prev = L.items.withIndex().lastOrNull { (j, q) -> j < i && q.line == p.line && q.wordIndex != p.wordIndex }?.value
                val k = CaptionV2Math.easeAt(spec.activeWord.easing, t - p.word.startMs, spec.activeWord.durationMs.toDouble()).toFloat()
                if (prev != null && k < 1f) {
                    val a = wordBox(prev, L, (box.paddingPx * L.sf).toFloat())
                    r = RectF(a.left + (r.left - a.left) * k, a.top + (r.top - a.top) * k, a.right + (r.right - a.right) * k, a.bottom + (r.bottom - a.bottom) * k)
                }
            }
            bgPaint.color = withAlpha(box.color, alpha * lk.opacity)
            val rad = (box.radiusPx * L.sf).toFloat()
            canvas.save()
            if (!slide || !isActive) {
                val wcx = p.x + p.slot / 2
                val wcy = L.baselines[p.line] + (L.ascent + L.descent) / 2
                canvas.scale(lk.scale, lk.scale, wcx, wcy)
            }
            canvas.translate(0f, lk.dy)
            canvas.drawRoundRect(r, rad, rad, bgPaint)
            canvas.restore()
        }
    }

    /** Draws every visible word with the paint [setup] configures; [setup] returns the layer's own blur radius. */
    private inline fun textPass(canvas: Canvas, L: Layout, looks: List<WordLook>, alpha: Double, groupBlurPx: Double, fill: Boolean = false, setup: (Placed, WordLook) -> Float) {
        L.items.forEachIndexed { i, p ->
            val lk = looks[i]
            if (lk.shown.isEmpty() || lk.opacity <= 0f) return@forEachIndexed
            paint.typeface = p.typeface
            paint.textSize = L.size
            paint.letterSpacing = L.letterSpacingEm
            val layerBlur = setup(p, lk)
            val blur = layerBlur + lk.blur + (groupBlurPx * L.sf).toFloat()
            paint.maskFilter = blurFilter(blur.toDouble())
            paint.alpha = (((paint.color ushr 24) and 0xFF) * alpha * lk.opacity).toInt().coerceIn(0, 255)
            val base = L.baselines[p.line]
            val wcx = p.x + p.slot / 2
            val wcy = base + (L.ascent + L.descent) / 2
            canvas.save()
            canvas.translate(0f, lk.dy)
            if (lk.scale != 1f) canvas.scale(lk.scale, lk.scale, wcx, wcy)
            val textX = p.x + (p.slot - p.width) / 2 + if (p.rtl && lk.shown.length < p.text.length) p.width - paint.measureText(lk.shown) else 0f
            canvas.drawText(lk.shown, textX, base, paint)
            if (fill && lk.sweep > 0f) {
                // Colour sweep: the active colour fills the word from its reading start.
                val sw = p.width * lk.sweep
                canvas.save()
                if (p.rtl) canvas.clipRect(textX + p.width - sw, base + L.ascent * 1.5f, textX + p.width, base + L.descent * 1.5f)
                else canvas.clipRect(textX, base + L.ascent * 1.5f, textX + sw, base + L.descent * 1.5f)
                paint.shader = null
                paint.color = withAlpha(lk.sweepColor, alpha * lk.opacity)
                canvas.drawText(lk.shown, textX, base, paint)
                canvas.restore()
            }
            if (fill && lk.underline > 0f) {
                paint.shader = null
                paint.maskFilter = null
                paint.color = withAlpha(lk.sweepColor, alpha * lk.opacity)
                val uw = p.width * lk.underline
                val y = base + L.descent * 0.55f
                val th = L.size * 0.07f
                val left = if (p.rtl) textX + p.width - uw else textX
                canvas.drawRect(left, y, left + uw, y + th, paint)
            }
            canvas.restore()
        }
        paint.maskFilter = null
        paint.shader = null
    }


    /** BlurMaskFilter radius (Skia converts it to sigma = 0.57735·r + 0.5, which the Dart painter uses directly). */
    private fun blurFilter(radius: Double): BlurMaskFilter? = if (radius < 0.5) null else BlurMaskFilter(radius.toFloat(), BlurMaskFilter.Blur.NORMAL)

    private fun look(spec: CaptionSpecV2, cap: IrCaption, L: Layout, p: Placed, idx: Int, t: Double, shown: String): WordLook {
        val wd = p.word
        val active = t >= wd.startMs && t < wd.endMs
        val spoken = t >= wd.endMs
        val base = when { active -> spec.active; spoken -> spec.spoken; else -> spec.resting }
        val st = if (wd.highlight) spec.emphasis.let { e ->
            // Emphasis wins: its own colour (the word's AI-chosen role colour first), but it still moves when active.
            e.copy(color = wd.color ?: e.color ?: spec.emphasisColor, scale = if (active) max(e.scale, spec.active.scale) else e.scale)
        } else base
        val intensity = spec.intensity
        var scale = st.scale
        var color: Int? = st.color
        var dy = st.yOffsetPx * L.sf
        var opacity = st.opacity
        var blur = st.blurPx * L.sf
        var sweep = -1f
        var underline = 0f
        val accent = spec.active.color ?: wd.color ?: spec.emphasisColor
        val restScale = if (wd.highlight) spec.emphasis.scale else spec.resting.scale
        val elapsed = t - wd.startMs
        when (spec.activeWord.type) {
            "scale-spring" -> if (active) {
                val k = CaptionV2Math.easeAt(spec.activeWord.easing, elapsed, spec.activeWord.durationMs.toDouble())
                scale = restScale + (st.scale - restScale) * k * intensity
            }
            "color-sweep" -> if (active) {
                // Fills through the word over its spoken time (karaoke); the base stays in the resting colour.
                sweep = ((elapsed / max(1L, wd.endMs - wd.startMs).toDouble()).coerceIn(0.0, 1.0)).toFloat()
                color = (if (wd.highlight) st.color else spec.resting.color)
            }
            "underline-grow" -> if (active) {
                underline = CaptionV2Math.easeAt(spec.activeWord.easing, elapsed, spec.activeWord.durationMs.toDouble()).toFloat().coerceIn(0f, 1.2f)
            }
            "bounce" -> if (active) {
                val k = (elapsed / max(1L, spec.activeWord.durationMs).toDouble()).coerceIn(0.0, 1.0)
                dy -= sin(PI * k) * 0.15 * L.size * intensity
            }
        }
        // Per-word enter.
        val we = spec.wordEnter
        if (we.type != "none") {
            val startAt = if (we.staggerMs > 0) cap.startMs + p.wordIndex.toDouble() * we.staggerMs else wd.startMs.toDouble()
            val k = CaptionV2Math.easeAt(we.easing, t - startAt, we.durationMs.toDouble())
            val lin = ((t - startAt) / max(1L, we.durationMs).toDouble()).coerceIn(0.0, 1.0)
            when (we.type) {
                "fade" -> opacity *= k.coerceIn(0.0, 1.0)
                "pop" -> { scale *= 1 - 0.4 * intensity + 0.4 * intensity * k; opacity *= min(1.0, lin * 2) }
                "rise" -> { dy += (1 - k) * 0.4 * L.size * intensity; opacity *= k.coerceIn(0.0, 1.0) }
                "blur-in" -> { blur += (1 - k.coerceIn(0.0, 1.0)) * 8 * L.sf * intensity; opacity *= k.coerceIn(0.0, 1.0) }
            }
        }
        return WordLook(color, scale.toFloat(), opacity.coerceIn(0.0, 1.0).toFloat(), dy.toFloat(), blur.toFloat(), st.background,
            sweep, accent, underline, shown)
    }
}

/** Group enter / exit of a v2 caption at one instant (mirrors `captionGroupMotion` in caption_v2.dart). */
object CaptionV2Motion {
    data class Group(val opacity: Double, val dy: Double, val scale: Double, val blurPx: Double, val reveal: Double, val wipe: Double)

    /**
     * [sf] = frame px per canvas px; [h] = frame height. Enter and exit are each at most half the caption; an exit
     * plays its type in reverse (slide-up leaves upwards). `reveal` = typewriter fraction (−1 when not typing),
     * `wipe` = mask-wipe fraction of the block shown.
     */
    fun group(spec: CaptionSpecV2, startMs: Long, endMs: Long, t: Double, sf: Double, h: Double): Group {
        val len = max(1L, endMs - startMs).toDouble()
        val a = spec.intensity
        var opacity = 1.0
        var dy = 0.0
        var scale = 1.0
        var blur = 0.0
        var reveal = -1.0
        var wipe = 1.0
        val en = spec.groupEnter
        val enterMs = min(en.durationMs.toDouble(), len / 2)
        if (en.type != "none") {
            val el = t - startMs
            val p = CaptionV2Math.easeAt(en.easing, el, enterMs)
            val lin = if (enterMs <= 0) 1.0 else (el / enterMs).coerceIn(0.0, 1.0)
            when (en.type) {
                "fade" -> opacity *= p.coerceIn(0.0, 1.0)
                "pop" -> { scale *= 1 - 0.4 * a + 0.4 * a * p; opacity *= min(1.0, lin * 2) }
                "spring-pop" -> { scale *= 1 - 0.6 * a + 0.6 * a * p; opacity *= min(1.0, lin * 2.5) }
                "slide-up" -> { dy += (1 - p) * 0.06 * h * a; opacity *= p.coerceIn(0.0, 1.0) }
                "slide-down" -> { dy -= (1 - p) * 0.06 * h * a; opacity *= p.coerceIn(0.0, 1.0) }
                "blur-in" -> { blur += (1 - p.coerceIn(0.0, 1.0)) * 12 * a; dy += (1 - p) * 0.02 * h * a; opacity *= p.coerceIn(0.0, 1.0) }
                "scale-down-in" -> { scale *= 1 + 0.4 * a * (1 - p); opacity *= p.coerceIn(0.0, 1.0) }
                "typewriter" -> reveal = lin
                "mask-wipe" -> wipe = p.coerceIn(0.0, 1.0)
            }
        }
        val ex = spec.groupExit
        val exitMs = min(ex.durationMs.toDouble(), len - enterMs)
        if (ex.type != "none" && exitMs > 0 && t > endMs - exitMs) {
            val q = CaptionV2Math.easeAt(ex.easing, t - (endMs - exitMs), exitMs)
            val k = q.coerceIn(0.0, 1.0)
            when (ex.type) {
                "fade" -> opacity *= 1 - k
                "pop", "spring-pop" -> { scale *= 1 - 0.4 * a * q; opacity *= 1 - k }
                "slide-up" -> { dy -= q * 0.06 * h * a; opacity *= 1 - k }
                "slide-down" -> { dy += q * 0.06 * h * a; opacity *= 1 - k }
                "blur-in" -> { blur += k * 12 * a; opacity *= 1 - k }
                "scale-down-in" -> { scale *= 1 - 0.2 * a * q; opacity *= 1 - k }
                "typewriter" -> reveal = if (reveal < 0) 1 - k else min(reveal, 1 - k)
                "mask-wipe" -> wipe = min(wipe, 1 - k)
            }
        }
        return Group(opacity.coerceIn(0.0, 1.0), dy, max(0.0, scale), blur, reveal, wipe)
    }
}

/** [CaptionIcuApi] on the platform ICU (android.icu, API 24+; minSdk is 24). */
object AndroidCaptionIcu : CaptionIcuApi {
    private fun ends(it: android.icu.text.BreakIterator, text: String): IntArray {
        it.setText(text)
        val out = ArrayList<Int>()
        var e = it.next()
        while (e != android.icu.text.BreakIterator.DONE) { out.add(e); e = it.next() }
        return out.toIntArray()
    }

    override fun wordEnds(text: String) = ends(android.icu.text.BreakIterator.getWordInstance(android.icu.util.ULocale.ROOT), text)
    override fun graphemeEnds(text: String) = ends(android.icu.text.BreakIterator.getCharacterInstance(android.icu.util.ULocale.ROOT), text)
    override fun bidiLevels(text: String, rtl: Boolean): ByteArray {
        if (text.isEmpty()) return ByteArray(0)
        val b = android.icu.text.Bidi()
        b.setPara(text, if (rtl) 1.toByte() else 0.toByte(), null)
        return ByteArray(text.length) { b.getLevelAt(it) }
    }

    /** Installs the platform ICU once (a JVM unit test keeps the java.text fallback: android.icu is a stub there). */
    fun install() {
        if (CaptionIcu.api === this) return
        try {
            android.icu.text.BreakIterator.getCharacterInstance()
            CaptionIcu.api = this
        } catch (_: Throwable) {
        }
    }
}
