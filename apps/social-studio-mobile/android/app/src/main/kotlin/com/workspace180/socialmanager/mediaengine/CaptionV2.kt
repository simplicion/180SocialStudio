package com.workspace180.socialmanager.mediaengine

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/*
 * Caption Style Spec v2 (packages/video-contracts/src/caption-style-v2.ts) on Android: the spec model with the Zod
 * defaults, the pure helpers (easeAt, safeRect, anchorInSafeZone, scriptOf, applyCaptionCase) and the text engine
 * rules that the Flutter preview (lib/core/native_engine/caption_v2.dart) implements line for line, so the preview and
 * the export lay out and animate a caption identically.
 *
 * Everything in this file is plain Kotlin (no android.* types) so it runs in JVM unit tests; the ICU parts the platform
 * provides (word segmentation of Thai/Lao/Khmer/Burmese, grapheme clusters, the bidi algorithm) are injected through
 * [CaptionIcu].
 */

/* ───────────────────────────── spec model ───────────────────────────── */

sealed class V2Easing {
    object Linear : V2Easing()
    data class Cubic(val mode: String = "out") : V2Easing()
    data class Back(val overshoot: Double = 1.70158) : V2Easing()
    data class Spring(val stiffness: Double = 300.0, val damping: Double = 18.0) : V2Easing()
}

data class V2Stroke(val color: Int, val widthPx: Double)
data class V2Shadow(val xPx: Double, val yPx: Double, val blurPx: Double, val color: Int)
data class V2Glow(val radiusPx: Double, val color: Int, val strength: Double)
data class V2Background(val mode: String = "none", val color: Int = 0xFF000000.toInt(), val paddingPx: Double = 12.0, val radiusPx: Double = 12.0, val opacity: Double = 1.0)
data class V2WordBox(val color: Int, val paddingPx: Double = 8.0, val radiusPx: Double = 10.0)
data class V2WordState(
    val color: Int? = null,
    val scale: Double = 1.0,
    val opacity: Double = 1.0,
    val yOffsetPx: Double = 0.0,
    val background: V2WordBox? = null,
    val blurPx: Double = 0.0,
)
data class V2GroupMotion(val type: String = "none", val durationMs: Long = 200, val easing: V2Easing = V2Easing.Cubic("out"))
data class V2WordEnter(val type: String = "none", val staggerMs: Long = 0, val durationMs: Long = 150, val easing: V2Easing = V2Easing.Cubic("out"))
data class V2ActiveWord(val type: String = "none", val durationMs: Long = 160, val easing: V2Easing = V2Easing.Spring(300.0, 18.0))

data class CaptionSpecV2(
    val fonts: Map<String, String>,
    val weight: Int = 700,
    val sizePx: Double,
    val letterSpacingEm: Double = 0.0,
    val lineHeight: Double = 1.15,
    val case: String = "none",
    /** null = solid [fillColor]; else a vertical gradient. */
    val fillColor: Int = 0xFFFFFFFF.toInt(),
    val gradientTop: Int? = null,
    val gradientBottom: Int? = null,
    val strokes: List<V2Stroke> = emptyList(),
    val shadow: V2Shadow? = null,
    val glow: V2Glow? = null,
    val background: V2Background = V2Background(),
    val resting: V2WordState = V2WordState(),
    val active: V2WordState = V2WordState(),
    val spoken: V2WordState = V2WordState(),
    val emphasis: V2WordState = V2WordState(),
    val groupEnter: V2GroupMotion = V2GroupMotion(),
    val groupExit: V2GroupMotion = V2GroupMotion(),
    val wordEnter: V2WordEnter = V2WordEnter(),
    val activeWord: V2ActiveWord = V2ActiveWord(),
    val intensity: Double = 1.0,
    val position: String = "lower-third",
    val x: Double = 0.5,
    val y: Double = 0.68,
    val maxWidthFraction: Double = 0.86,
    val maxLines: Int = 2,
    val align: String = "center",
    val safeZone: String = "tiktok",
    val faceAvoid: Boolean = true,
    val balance: String = "bottom-heavy",
    val emphasisColor: Int = 0xFFF7C204.toInt(),
) {
    /** The family for a script: the stack's entry, else the readable default (DEFAULT_SCRIPT_FONTS). */
    fun fontFor(script: String): String = fonts[script] ?: DEFAULT_SCRIPT_FONTS[script] ?: fonts["latin"] ?: "Inter"

    companion object {
        /**
         * Parses a `styleV2` object (already converted to maps / lists / numbers / strings) with the Zod schema's
         * defaults. Null when it is not a v2 spec (missing `version: 2`, typography or paint): the caption then renders
         * through the v1 path exactly as before.
         */
        fun parse(m: Map<String, Any?>?): CaptionSpecV2? {
            if (m == null) return null
            if ((m["version"] as? Number)?.toInt() != 2) return null
            val ty = m.obj("typography") ?: return null
            val paint = m.obj("paint") ?: return null
            val size = ty.num("sizePx") ?: return null
            val fonts = (ty.obj("fonts") ?: emptyMap()).mapNotNull { (k, v) -> (v as? String)?.takeIf { it.isNotBlank() }?.let { k to it } }.toMap()
            val fill = paint.obj("fill")
            val words = m.obj("words") ?: emptyMap()
            val motion = m.obj("motion") ?: emptyMap()
            val layout = m.obj("layout") ?: emptyMap()
            val grouping = m.obj("grouping") ?: emptyMap()
            val emphasis = m.obj("emphasis") ?: emptyMap()
            val bg = paint.obj("background") ?: emptyMap()
            val isGradient = fill?.get("type") == "gradient"
            return CaptionSpecV2(
                fonts = if (fonts.containsKey("latin")) fonts else fonts + ("latin" to "Inter"),
                weight = (ty.num("weight") ?: 700.0).toInt().coerceIn(100, 1000),
                sizePx = size.coerceIn(8.0, 400.0),
                letterSpacingEm = (ty.num("letterSpacingEm") ?: 0.0).coerceIn(-0.1, 0.5),
                lineHeight = (ty.num("lineHeight") ?: 1.15).coerceIn(0.8, 2.0),
                case = (ty["case"] as? String)?.takeIf { it in setOf("none", "upper", "title") } ?: "none",
                fillColor = if (!isGradient) (fill?.str("color")?.let(::v2Color) ?: WHITE) else WHITE,
                gradientTop = if (isGradient) fill?.str("top")?.let(::v2Color) else null,
                gradientBottom = if (isGradient) fill?.str("bottom")?.let(::v2Color) else null,
                strokes = (paint["strokes"] as? List<*>).orEmpty().mapNotNull { (it as? Map<*, *>)?.asStrMap() }.take(2).mapNotNull { s ->
                    val w = s.num("widthPx") ?: 0.0
                    if (w <= 0) null else V2Stroke(s.str("color")?.let(::v2Color) ?: BLACK, w)
                },
                shadow = paint.obj("shadow")?.let { s ->
                    V2Shadow(s.num("xPx") ?: 0.0, s.num("yPx") ?: 0.0, s.num("blurPx") ?: 0.0, s.str("color")?.let(::v2Color) ?: 0xB3000000.toInt())
                },
                glow = paint.obj("glow")?.let { g ->
                    V2Glow(g.num("radiusPx") ?: 0.0, g.str("color")?.let(::v2Color) ?: WHITE, (g.num("strength") ?: 1.0).coerceIn(0.0, 1.0))
                },
                background = V2Background(
                    mode = (bg["mode"] as? String)?.takeIf { it in setOf("none", "line", "word", "pill") } ?: "none",
                    color = bg.str("color")?.let(::v2Color) ?: BLACK,
                    paddingPx = bg.num("paddingPx") ?: 12.0,
                    radiusPx = bg.num("radiusPx") ?: 12.0,
                    opacity = (bg.num("opacity") ?: 1.0).coerceIn(0.0, 1.0),
                ),
                resting = wordState(words.obj("resting")),
                active = wordState(words.obj("active")),
                spoken = wordState(words.obj("spoken")),
                emphasis = wordState(words.obj("emphasis")),
                groupEnter = groupMotion(motion.obj("groupEnter")),
                groupExit = groupMotion(motion.obj("groupExit")),
                wordEnter = motion.obj("wordEnter").let { w ->
                    V2WordEnter(
                        type = (w?.get("type") as? String) ?: "none",
                        staggerMs = (w?.num("staggerMs") ?: 0.0).toLong().coerceIn(0, 5000),
                        durationMs = (w?.num("durationMs") ?: 150.0).toLong().coerceIn(0, 5000),
                        easing = easing(w?.obj("easing"), V2Easing.Cubic("out")),
                    )
                },
                activeWord = motion.obj("activeWord").let { a ->
                    V2ActiveWord(
                        type = (a?.get("type") as? String) ?: "none",
                        durationMs = (a?.num("durationMs") ?: 160.0).toLong().coerceIn(0, 5000),
                        easing = easing(a?.obj("easing"), V2Easing.Spring(300.0, 18.0)),
                    )
                },
                intensity = (motion.num("intensity") ?: 1.0).coerceIn(0.0, 1.0),
                position = (layout["position"] as? String)?.takeIf { it in POSITION_PRESET_Y.keys || it == "custom" } ?: "lower-third",
                x = (layout.num("x") ?: 0.5).coerceIn(0.0, 1.0),
                y = (layout.num("y") ?: 0.68).coerceIn(0.0, 1.0),
                maxWidthFraction = (layout.num("maxWidthFraction") ?: 0.86).coerceIn(0.05, 1.0),
                maxLines = (layout.num("maxLines") ?: 2.0).toInt().coerceIn(1, 2),
                align = (layout["align"] as? String)?.takeIf { it in setOf("start", "center", "end") } ?: "center",
                safeZone = (layout["safeZone"] as? String)?.takeIf { it in CAPTION_SAFE_ZONES.keys } ?: "tiktok",
                faceAvoid = layout["faceAvoid"] as? Boolean ?: true,
                balance = (grouping["balance"] as? String) ?: "bottom-heavy",
                emphasisColor = emphasis.obj("colors")?.str("emphasis")?.let(::v2Color) ?: 0xFFF7C204.toInt(),
            )
        }

        private fun wordState(m: Map<String, Any?>?): V2WordState {
            if (m == null) return V2WordState()
            return V2WordState(
                color = m.str("color")?.let(::v2Color),
                scale = (m.num("scale") ?: 1.0).coerceIn(0.2, 3.0),
                opacity = (m.num("opacity") ?: 1.0).coerceIn(0.0, 1.0),
                yOffsetPx = (m.num("yOffsetPx") ?: 0.0).coerceIn(-400.0, 400.0),
                background = m.obj("background")?.let { b ->
                    b.str("color")?.let { V2WordBox(v2Color(it), b.num("paddingPx") ?: 8.0, b.num("radiusPx") ?: 10.0) }
                },
                blurPx = (m.num("blurPx") ?: 0.0).coerceAtLeast(0.0),
            )
        }

        private fun groupMotion(m: Map<String, Any?>?): V2GroupMotion = if (m == null) V2GroupMotion() else V2GroupMotion(
            type = (m["type"] as? String) ?: "none",
            durationMs = (m.num("durationMs") ?: 200.0).toLong().coerceIn(0, 5000),
            easing = easing(m.obj("easing"), V2Easing.Cubic("out")),
        )

        private fun easing(m: Map<String, Any?>?, default: V2Easing): V2Easing = when (m?.get("type")) {
            "linear" -> V2Easing.Linear
            "cubic" -> V2Easing.Cubic((m["mode"] as? String) ?: "out")
            "back" -> V2Easing.Back(m.num("overshoot") ?: 1.70158)
            "spring" -> V2Easing.Spring((m.num("stiffness") ?: 300.0).coerceIn(10.0, 2000.0), (m.num("damping") ?: 18.0).coerceIn(1.0, 200.0))
            else -> default
        }

        private fun Map<*, *>.asStrMap(): Map<String, Any?> = entries.associate { (k, v) -> k.toString() to v }
        private fun Map<String, Any?>.obj(k: String): Map<String, Any?>? = (this[k] as? Map<*, *>)?.asStrMap()
        private fun Map<String, Any?>.num(k: String): Double? = (this[k] as? Number)?.toDouble()?.takeIf { !it.isNaN() }
        private fun Map<String, Any?>.str(k: String): String? = this[k] as? String

        const val WHITE = 0xFFFFFFFF.toInt()
        const val BLACK = 0xFF000000.toInt()
    }
}

/** #RRGGBB / #RRGGBBAA to Android ARGB, without android.graphics (unit-testable). Malformed = opaque white. */
fun v2Color(hex: String): Int {
    val h = hex.trim().removePrefix("#")
    val v = h.toLongOrNull(16) ?: return CaptionSpecV2.WHITE
    return when (h.length) {
        6 -> (0xFF000000L or v).toInt()
        8 -> (((v and 0xFF) shl 24) or (v ushr 8)).toInt()
        else -> CaptionSpecV2.WHITE
    }
}

/** Multiplies an ARGB colour's alpha by [k] (0..1). */
fun withAlpha(color: Int, k: Double): Int {
    val a = ((color ushr 24) and 0xFF) * k.coerceIn(0.0, 1.0)
    return (Math.round(a).toInt() shl 24) or (color and 0x00FFFFFF)
}

/** Linear blend of two ARGB colours. */
fun lerpColor(a: Int, b: Int, t: Double): Int {
    val k = t.coerceIn(0.0, 1.0)
    fun ch(s: Int) = (((a ushr s) and 0xFF) + ((((b ushr s) and 0xFF) - ((a ushr s) and 0xFF)) * k)).let { Math.round(it).toInt() }
    return (ch(24) shl 24) or (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
}

/* ───────────────────────────── pure helpers (mirror caption-style-v2.ts) ───────────────────────────── */

val DEFAULT_SCRIPT_FONTS: Map<String, String> = mapOf(
    "latin" to "Inter", "devanagari" to "Noto Sans Devanagari", "bengali" to "Noto Sans Bengali", "tamil" to "Noto Sans Tamil",
    "telugu" to "Noto Sans Telugu", "gujarati" to "Noto Sans Gujarati", "gurmukhi" to "Noto Sans Gurmukhi",
    "kannada" to "Noto Sans Kannada", "malayalam" to "Noto Sans Malayalam", "odia" to "Noto Sans Oriya",
    "arabic" to "Noto Sans Arabic", "cjk-sc" to "Noto Sans SC", "cjk-jp" to "Noto Sans JP", "korean" to "Noto Sans KR",
    "thai" to "Noto Sans Thai", "cyrillic" to "Inter", "fallback" to "Noto Sans",
)

val POSITION_PRESET_Y: Map<String, Double> = mapOf("lower-third" to 0.68, "center" to 0.5, "upper-third" to 0.3)

object CaptionV2Math {
    /** caption-style-v2.ts `easeAt`: time-based (frame-rate independent); a spring is forced to exactly 1 at durationMs. */
    fun easeAt(e: V2Easing, elapsedMs: Double, durationMs: Double): Double {
        if (elapsedMs <= 0) return 0.0
        if (durationMs <= 0 || elapsedMs >= durationMs) return 1.0
        val t = elapsedMs / durationMs
        return when (e) {
            is V2Easing.Linear -> t
            is V2Easing.Cubic -> when (e.mode) {
                "in" -> t * t * t
                "inOut" -> if (t < 0.5) 4 * t * t * t else 1 - (-2 * t + 2).pow(3) / 2
                else -> 1 - (1 - t).pow(3)
            }
            is V2Easing.Back -> {
                val c1 = e.overshoot
                val c3 = c1 + 1
                1 + c3 * (t - 1).pow(3) + c1 * (t - 1).pow(2)
            }
            is V2Easing.Spring -> spring(e.stiffness, e.damping, elapsedMs / 1000.0)
        }
    }

    /** Damped spring 0 → 1, unit mass (closed form per damping regime). */
    fun spring(k: Double, c: Double, s: Double): Double {
        val w0 = sqrt(k)
        val zeta = c / (2 * w0)
        if (zeta < 1) {
            val wd = w0 * sqrt(1 - zeta * zeta)
            return 1 - exp(-zeta * w0 * s) * (cos(wd * s) + ((zeta * w0) / wd) * sin(wd * s))
        }
        if (zeta == 1.0) return 1 - exp(-w0 * s) * (1 + w0 * s)
        val r1 = -w0 * (zeta - sqrt(zeta * zeta - 1))
        val r2 = -w0 * (zeta + sqrt(zeta * zeta - 1))
        return 1 - (r2 * exp(r1 * s) - r1 * exp(r2 * s)) / (r2 - r1)
    }

    data class Rect(val left: Double, val top: Double, val right: Double, val bottom: Double) {
        val width get() = right - left
        val height get() = bottom - top
        fun intersects(o: Rect) = left < o.right && o.left < right && top < o.bottom && o.top < bottom
        fun overlapArea(o: Rect) = max(0.0, min(right, o.right) - max(left, o.left)) * max(0.0, min(bottom, o.bottom) - max(top, o.top))
    }

    fun safeRect(profile: String, w: Double, h: Double): Rect {
        val m = CAPTION_SAFE_ZONES[profile] ?: CAPTION_SAFE_ZONES.getValue("none")
        val sx = w / 1080.0
        val sy = h / 1920.0
        return Rect(m.left * sx, m.top * sy, w - m.right * sx, h - m.bottom * sy)
    }

    private fun clamp(v: Double, lo: Double, hi: Double) = if (lo > hi) (lo + hi) / 2 else min(hi, max(lo, v))

    /** caption-style-v2.ts `anchorInSafeZone`: the block centre, kept inside the safe rectangle. */
    fun anchor(spec: CaptionSpecV2, w: Double, h: Double, blockW: Double, blockH: Double): Pair<Double, Double> {
        val r = safeRect(spec.safeZone, w, h)
        val fx = if (spec.position == "custom") spec.x else 0.5
        val fy = if (spec.position == "custom") spec.y else POSITION_PRESET_Y[spec.position] ?: 0.68
        return clamp(fx * w, r.left + blockW / 2, r.right - blockW / 2) to clamp(fy * h, r.top + blockH / 2, r.bottom - blockH / 2)
    }

    /**
     * Face avoidance: when the block (centre [cy], height [blockH], horizontal span [left]..[right]) covers a face, it
     * moves just above or just below the faces (whichever is the smaller move that stays in the safe rectangle). The
     * faces are every box seen during the caption, so the block does not jump while it is on screen. Returns the new cy.
     */
    fun avoidFaces(cy: Double, blockH: Double, left: Double, right: Double, faces: List<Rect>, safe: Rect, h: Double): Double {
        if (faces.isEmpty()) return cy
        val block = Rect(left, cy - blockH / 2, right, cy + blockH / 2)
        val hit = faces.filter { it.intersects(block) }
        if (hit.isEmpty()) return cy
        val faceTop = hit.minOf { it.top }
        val faceBottom = hit.maxOf { it.bottom }
        val margin = 0.02 * h
        val candidates = listOf(faceTop - margin - blockH / 2, faceBottom + margin + blockH / 2)
            .filter { it - blockH / 2 >= safe.top - 0.5 && it + blockH / 2 <= safe.bottom + 0.5 }
            .filter { c -> faces.none { it.intersects(Rect(left, c - blockH / 2, right, c + blockH / 2)) } }
        return candidates.minByOrNull { abs(it - cy) } ?: cy
    }
}

/* ───────────────────────────── scripts, case, direction ───────────────────────────── */

object CaptionScripts {
    fun ofCodePoint(c: Int): String? = when (c) {
        in 0x0900..0x097f -> "devanagari"
        in 0x0980..0x09ff -> "bengali"
        in 0x0a00..0x0a7f -> "gurmukhi"
        in 0x0a80..0x0aff -> "gujarati"
        in 0x0b00..0x0b7f -> "odia"
        in 0x0b80..0x0bff -> "tamil"
        in 0x0c00..0x0c7f -> "telugu"
        in 0x0c80..0x0cff -> "kannada"
        in 0x0d00..0x0d7f -> "malayalam"
        in 0x0600..0x06ff, in 0x0750..0x077f, in 0x08a0..0x08ff, in 0xfb50..0xfeff -> "arabic"
        in 0x0e00..0x0e7f -> "thai"
        in 0x1100..0x11ff, in 0x3130..0x318f, in 0xac00..0xd7af -> "korean"
        in 0x3040..0x30ff, in 0x31f0..0x31ff -> "cjk-jp"
        in 0x4e00..0x9fff, in 0x3400..0x4dbf -> "cjk-sc"
        in 0x0400..0x04ff -> "cyrillic"
        else -> null
    }

    /** caption-style-v2.ts `scriptOf`: the first letter that is not Common/Latin decides; Latin when there is none. */
    fun of(text: String): String {
        var i = 0
        while (i < text.length) {
            val c = text.codePointAt(i)
            ofCodePoint(c)?.let { return it }
            i += Character.charCount(c)
        }
        return "latin"
    }

    /**
     * The script whose font draws [token] within a caption: Han in a caption that also has kana (or whose language is
     * Japanese) is drawn with the Japanese font, so one caption never mixes Chinese and Japanese glyph forms.
     */
    fun forToken(token: String, captionText: String, language: String?): String {
        val s = of(token)
        if (s != "cjk-sc") return s
        val lang = language?.lowercase()?.substringBefore('-')
        if (lang == "ja") return "cjk-jp"
        if (lang == "ko") return "korean"
        var i = 0
        while (i < captionText.length) {
            val c = captionText.codePointAt(i)
            if (c in 0x3040..0x30ff || c in 0x31f0..0x31ff) return "cjk-jp"
            i += Character.charCount(c)
        }
        return s
    }

    /** Scripts with upper / lower case. */
    fun isCased(text: String): Boolean {
        var i = 0
        while (i < text.length) {
            val c = text.codePointAt(i)
            if (c in 0x41..0x5a || c in 0x61..0x7a || c in 0xc0..0x24f || c in 0x370..0x3ff || c in 0x400..0x4ff || c in 0x1e00..0x1eff) return true
            i += Character.charCount(c)
        }
        return false
    }

    fun isRtlCodePoint(c: Int) = c in 0x0590..0x08ff || c in 0xfb1d..0xfdff || c in 0xfe70..0xfeff

    private val RTL_LANGS = setOf("ar", "ur", "fa", "sd", "he", "iw", "ps", "ug", "yi", "ckb", "dv")

    /**
     * Paragraph direction of a caption: an RTL language makes it right-to-left; otherwise the first strong letter
     * decides (Unicode bidi rules P2–P3). Both renderers use this one rule, so an Urdu caption that starts with an
     * English brand name still reads right-to-left.
     */
    fun isRtlParagraph(text: String, language: String?): Boolean {
        val lang = language?.lowercase()?.substringBefore('-')
        if (lang != null && lang.isNotEmpty()) {
            if (lang in RTL_LANGS) return true
            if (lang.length in 2..3) return false
        }
        var i = 0
        while (i < text.length) {
            val c = text.codePointAt(i)
            if (isRtlCodePoint(c)) return true
            if (Character.isLetter(c)) return false
            i += Character.charCount(c)
        }
        return false
    }

    /**
     * caption-style-v2.ts `applyCaptionCase`: only scripts with case are changed; locale-aware (Turkish / Azeri dotted
     * and dotless i). Title case capitalises the first letter of each space-separated word. The Dart preview implements
     * the same Turkish mapping explicitly (Dart's toUpperCase is locale-independent).
     */
    fun applyCase(text: String, mode: String, language: String?): String {
        if (mode == "none" || !isCased(text)) return text
        val lang = language?.lowercase()?.substringBefore('-')
        val turkic = lang == "tr" || lang == "az"
        fun up(s: String): String = if (turkic) s.replace("i", "İ").replace("ı", "I").uppercase(java.util.Locale.ROOT) else s.uppercase(java.util.Locale.ROOT)
        if (mode == "upper") return up(text)
        val sb = StringBuilder()
        var start = true
        var i = 0
        while (i < text.length) {
            val c = text.codePointAt(i)
            val ch = String(Character.toChars(c))
            if (Character.isWhitespace(c)) {
                sb.append(ch); start = true
            } else if (start && Character.isLetter(c)) {
                sb.append(up(ch)); start = false
            } else {
                sb.append(ch); start = false
            }
            i += Character.charCount(c)
        }
        return sb.toString()
    }
}

/* ───────────────────────────── text engine ───────────────────────────── */

/** The ICU services the text engine needs (android.icu on device, java.text in JVM tests). */
interface CaptionIcuApi {
    /** Word boundaries (end offsets, exclusive) of a run of Thai / Lao / Khmer / Burmese text. */
    fun wordEnds(text: String): IntArray
    /** Grapheme cluster ends (exclusive UTF-16 offsets). */
    fun graphemeEnds(text: String): IntArray
    /** Bidi embedding level of each UTF-16 index of [text] for the given paragraph direction. */
    fun bidiLevels(text: String, rtl: Boolean): ByteArray
}

object CaptionIcu {
    /** Replaced by the Android implementation at startup (AndroidCaptionIcu); tests install a java.text one. */
    @Volatile var api: CaptionIcuApi = JavaTextIcu

    /** JDK fallback (java.text): used by JVM unit tests and if android.icu is unavailable. */
    object JavaTextIcu : CaptionIcuApi {
        private fun ends(it: java.text.BreakIterator, text: String): IntArray {
            it.setText(text)
            val out = ArrayList<Int>()
            var e = it.next()
            while (e != java.text.BreakIterator.DONE) { out.add(e); e = it.next() }
            return out.toIntArray()
        }
        override fun wordEnds(text: String) = ends(java.text.BreakIterator.getWordInstance(java.util.Locale.ROOT), text)
        override fun graphemeEnds(text: String) = ends(java.text.BreakIterator.getCharacterInstance(java.util.Locale.ROOT), text)
        override fun bidiLevels(text: String, rtl: Boolean): ByteArray {
            val b = java.text.Bidi(text, if (rtl) java.text.Bidi.DIRECTION_RIGHT_TO_LEFT else java.text.Bidi.DIRECTION_LEFT_TO_RIGHT)
            return ByteArray(text.length) { b.getLevelAt(it).toByte() }
        }
    }
}

object CaptionText {
    const val LINE_BREAK = "\n"

    private const val HAN = 1
    private const val HIRA = 2
    private const val KATA = 3
    private const val SEA = 4 // Thai, Lao, Khmer, Burmese: ICU dictionary word breaks
    private const val PUNCT = 5
    private const val EXTEND = 6 // combining marks, variation selectors, ZWJ: never a boundary
    private const val OTHER = 7

    private fun cls(c: Int): Int = when {
        c in 0x3040..0x309f -> HIRA
        c in 0x30a0..0x30ff || c in 0x31f0..0x31ff || c in 0xff66..0xff9f -> KATA
        c in 0x4e00..0x9fff || c in 0x3400..0x4dbf || c in 0xf900..0xfaff || c == 0x3005 -> HAN
        c in 0x0e00..0x0eff || c in 0x1780..0x17ff || c in 0x1000..0x109f -> SEA
        c == 0x200d || c in 0xfe00..0xfe0f || c in 0xe0100..0xe01ef ||
            Character.getType(c).let { it == Character.NON_SPACING_MARK.toInt() || it == Character.ENCLOSING_MARK.toInt() || it == Character.COMBINING_SPACING_MARK.toInt() } -> EXTEND
        !isLetterOrNumber(c) && Character.getType(c) != Character.OTHER_SYMBOL.toInt() -> PUNCT
        else -> OTHER
    }

    /** Unicode L* or N* (what `\p{L}|\p{N}` matches in the Dart mirror). */
    fun isLetterOrNumber(c: Int): Boolean = Character.isLetter(c) || when (Character.getType(c)) {
        Character.DECIMAL_DIGIT_NUMBER.toInt(), Character.LETTER_NUMBER.toInt(), Character.OTHER_NUMBER.toInt() -> true
        else -> false
    }

    /** True if [text] has characters of a script written without spaces (CJK, Thai, Lao, Khmer, Burmese). */
    fun isNoSpace(text: String): Boolean {
        var i = 0
        while (i < text.length) {
            val c = text.codePointAt(i)
            val k = cls(c)
            if (k == HAN || k == HIRA || k == KATA || k == SEA) return true
            i += Character.charCount(c)
        }
        return false
    }

    /**
     * Splits a space-free chunk into words. Thai / Lao / Khmer / Burmese runs use ICU dictionary word breaks (both
     * Android's and Flutter's ICU carry those dictionaries). Han and kana use one deterministic rule because Flutter's
     * ICU has no CJK dictionary: a word is a run of kanji or katakana with the kana that follows it (今日から|物語を|始めよう),
     * a new word starts where kanji/katakana follow hiragana or the script changes, and punctuation stays with the word
     * before it. Never splits a grapheme cluster (marks and joiners never start a word).
     */
    fun segmentChunk(chunk: String): List<String> {
        if (!isNoSpace(chunk)) return listOf(chunk)
        val out = ArrayList<StringBuilder>()
        var i = 0
        var prev = 0
        var onlyPunct = true
        while (i < chunk.length) {
            val c = chunk.codePointAt(i)
            val n = Character.charCount(c)
            val k = cls(c)
            if (k == SEA) {
                // The whole SEA run goes through ICU.
                var j = i
                while (j < chunk.length) {
                    val cj = chunk.codePointAt(j)
                    val kj = cls(cj)
                    if (kj != SEA && kj != EXTEND) break
                    j += Character.charCount(cj)
                }
                val run = chunk.substring(i, j)
                var s = 0
                for (e in CaptionIcu.api.wordEnds(run)) {
                    if (e <= s) continue
                    val piece = run.substring(s, e)
                    val pieceIsPunct = piece.codePoints().allMatch { cls(it) == PUNCT || Character.isWhitespace(it) }
                    if (out.isEmpty() || (!pieceIsPunct && !onlyPunct)) out.add(StringBuilder())
                    out.last().append(piece)
                    if (!pieceIsPunct) onlyPunct = false
                    s = e
                }
                prev = SEA
                i = j
                continue
            }
            val boundary = when {
                out.isEmpty() -> true
                onlyPunct -> false // leading punctuation (「) stays with the next word
                k == PUNCT || k == EXTEND -> false
                prev == PUNCT -> true
                k == HIRA -> !(prev == HAN || prev == KATA || prev == HIRA)
                k == HAN -> prev != HAN
                k == KATA -> prev != KATA
                else -> prev != OTHER
            }
            if (boundary) { out.add(StringBuilder()); onlyPunct = true }
            out.last().appendCodePoint(c)
            if (k != PUNCT && k != EXTEND) onlyPunct = false
            if (k != EXTEND) prev = k
            i += n
        }
        return out.map { it.toString() }.filter { it.isNotEmpty() }
    }

    /** Text to display tokens: typed line breaks become [LINE_BREAK], words split on spaces and by [segmentChunk]. */
    fun tokens(text: String): List<String> {
        val out = mutableListOf<String>()
        text.replace("\r\n", "\n").split('\n').forEachIndexed { i, line ->
            if (i > 0) out.add(LINE_BREAK)
            for (chunk in line.split(Regex("\\s+"))) if (chunk.isNotEmpty()) out.addAll(segmentChunk(chunk))
        }
        while (out.firstOrNull() == LINE_BREAK) out.removeAt(0)
        while (out.lastOrNull() == LINE_BREAK) out.removeAt(out.size - 1)
        return out
    }

    /** True when no space is drawn between two adjacent tokens (both in a space-free script). */
    fun noGap(a: String, b: String) = isNoSpace(a) && isNoSpace(b)

    /** Joins tokens as they are drawn: a space between them unless both are in a space-free script. */
    fun join(tokens: List<String>): String {
        val sb = StringBuilder()
        tokens.forEachIndexed { i, t ->
            if (i > 0 && !noGap(tokens[i - 1], t)) sb.append(' ')
            sb.append(t)
        }
        return sb.toString()
    }

    /** Grapheme-safe pieces of [text] no wider than [maxWidth] (greedy over grapheme clusters). */
    fun splitToWidth(text: String, maxWidth: Double, measure: (String) -> Double): List<String> {
        if (text.isEmpty() || measure(text) <= maxWidth) return listOf(text)
        val ends = CaptionIcu.api.graphemeEnds(text)
        val out = mutableListOf<String>()
        var start = 0
        var prevEnd = 0
        for (e in ends) {
            // A single cluster wider than the line stays whole (it is never cut).
            if (prevEnd > start && measure(text.substring(start, e)) > maxWidth) {
                out.add(text.substring(start, prevEnd))
                start = prevEnd
            }
            prevEnd = e
        }
        if (start < text.length) out.add(text.substring(start))
        return out
    }

    /**
     * Visual order (left to right) of a line's tokens: the Unicode bidi algorithm runs on the line as drawn (tokens
     * joined by their gaps) and the tokens are reordered by their embedding levels (rule L2). LTR lines without RTL
     * text are returned as they are.
     */
    fun visualOrder(tokens: List<String>, rtl: Boolean): List<Int> {
        val idx = tokens.indices.toList()
        if (tokens.size <= 1) return idx
        if (!rtl && tokens.none { t -> t.codePoints().anyMatch { CaptionScripts.isRtlCodePoint(it) } }) return idx
        val sb = StringBuilder()
        val starts = IntArray(tokens.size)
        tokens.forEachIndexed { i, t ->
            if (i > 0 && !noGap(tokens[i - 1], t)) sb.append(' ')
            starts[i] = sb.length
            sb.append(t)
        }
        val levels = CaptionIcu.api.bidiLevels(sb.toString(), rtl)
        val lv = IntArray(tokens.size) { i ->
            // A token's level is that of its first strong character (a number keeps its own level).
            val t = tokens[i]
            var off = 0
            var level = levels[starts[i]].toInt()
            while (off < t.length) {
                val c = t.codePointAt(off)
                if (isLetterOrNumber(c)) { level = levels[starts[i] + off].toInt(); break }
                off += Character.charCount(c)
            }
            level
        }
        // L2: from the highest level down to the lowest odd level, reverse every run at that level or higher.
        val order = idx.toMutableList()
        val maxL = lv.max()
        val minOdd = lv.filter { it % 2 == 1 }.minOrNull() ?: return idx
        var level = maxL
        val cur = lv.toMutableList()
        while (level >= minOdd) {
            var i = 0
            while (i < order.size) {
                if (cur[i] >= level) {
                    var j = i
                    while (j < order.size && cur[j] >= level) j++
                    order.subList(i, j).reverse()
                    cur.subList(i, j).reverse()
                    i = j
                } else i++
            }
            level--
        }
        return order
    }

    /** One measured token on a line. [slot] = room it takes (grown by its largest state scale). */
    data class Item(val index: Int, val text: String, val width: Double, val slot: Double, val wordIndex: Int)

    /**
     * Breaks measured items into at most [maxLines] lines no wider than [maxWidth], honouring typed line breaks
     * (items with text == LINE_BREAK). Two lines are bottom-heavy (top line no wider than the bottom) and never leave a
     * single word on top when there are 3+ words. Returns null when the items cannot fit in [maxLines] lines at this
     * size (the caller shrinks the font).
     */
    fun breakLines(items: List<Item>, maxWidth: Double, maxLines: Int, gap: (Item, Item) -> Double, bottomHeavy: Boolean): List<List<Item>>? {
        fun width(line: List<Item>): Double {
            var w = 0.0
            line.forEachIndexed { i, it -> if (i > 0) w += gap(line[i - 1], it); w += it.slot }
            return w
        }
        // Hard breaks first.
        val paragraphs = mutableListOf(mutableListOf<Item>())
        for (it in items) if (it.text == LINE_BREAK) paragraphs.add(mutableListOf()) else paragraphs.last().add(it)
        val paras = paragraphs.filter { it.isNotEmpty() }
        if (paras.isEmpty()) return emptyList()
        if (paras.size > maxLines) return null
        if (paras.size > 1) return if (paras.all { width(it) <= maxWidth + 0.01 }) paras else null
        val all = paras[0]
        if (width(all) <= maxWidth + 0.01) return listOf(all)
        if (maxLines < 2) return null
        // Two lines: try every split; pick the bottom-heavy balanced one.
        var best: Pair<Int, Double>? = null
        val words = all.map { it.wordIndex }.distinct().size
        for (k in 1 until all.size) {
            val top = all.subList(0, k)
            val bottom = all.subList(k, all.size)
            // Never split the pieces of one word across the break unless the word itself is wider than a line.
            if (all[k - 1].wordIndex == all[k].wordIndex && width(all.filter { it.wordIndex == all[k].wordIndex }) <= maxWidth) continue
            val tw = width(top)
            val bw = width(bottom)
            if (tw > maxWidth + 0.01 || bw > maxWidth + 0.01) continue
            val topWords = top.map { it.wordIndex }.distinct().size
            var cost = abs(bw - tw)
            if (bottomHeavy) {
                if (tw > bw) cost += 10_000 + (tw - bw)
                if (words >= 3 && topWords < 2) cost += 100_000
            }
            if (best == null || cost < best.second) best = k to cost
        }
        val k = best?.first ?: return null
        return listOf(all.subList(0, k), all.subList(k, all.size))
    }
}
