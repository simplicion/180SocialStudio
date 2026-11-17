package com.workspace180.socialmanager.mediaengine

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Export-time check that every caption character has a glyph, so the export never draws tofu.
 *
 * Each word is drawn with one family (v2: the template's font for the word's script; v1: the caption's family or its
 * script fallback). A character the family's file lacks may still be drawn by an installed system font (Android's
 * fallback chain); only a character that neither has is missing. Missing characters fail the export with
 * CAPTION_GLYPHS_MISSING, naming the script, the family and the characters.
 */
object CaptionGlyphCheck {
    data class Missing(val captionId: String, val script: String, val family: String, val chars: List<Int>)
    data class Result(val missing: List<Missing>, val systemFallback: List<Missing>)

    fun check(
        captions: List<IrCaption>,
        coverageFor: (family: String, weight: Int) -> FontCoverage?,
        systemHas: (String) -> Boolean,
    ): Result {
        val missing = LinkedHashMap<Triple<String, String, String>, LinkedHashSet<Int>>()
        val fallback = LinkedHashMap<Triple<String, String, String>, LinkedHashSet<Int>>()
        for (cap in captions) {
            val words = displayWords(cap).filter { it.text != CaptionText.LINE_BREAK }
            val spec = cap.v2
            for (wd in words) {
                val text = if (spec != null) CaptionScripts.applyCase(wd.text, spec.case, cap.language) else wd.text
                val script = CaptionScripts.forToken(text, cap.text, cap.language)
                val (family, weight) = if (spec != null) spec.fontFor(script) to spec.weight
                else fontForText(cap.text, cap.style.fontFamily) to cap.style.fontWeight
                val cov = coverageFor(family, weight)
                var i = 0
                while (i < text.length) {
                    val c = text.codePointAt(i)
                    i += Character.charCount(c)
                    if (!FontCoverage.needsGlyph(c) || cov?.has(c) == true) continue
                    val key = Triple(cap.id, script, family)
                    if (systemHas(String(Character.toChars(c)))) fallback.getOrPut(key) { LinkedHashSet() }.add(c)
                    else missing.getOrPut(key) { LinkedHashSet() }.add(c)
                }
            }
        }
        fun list(m: Map<Triple<String, String, String>, Set<Int>>) = m.map { (k, v) -> Missing(k.first, k.second, k.third, v.toList()) }
        return Result(list(missing), list(fallback))
    }

    /** The typed error message: script, family and up to 12 characters (with their code points). */
    fun message(missing: List<Missing>): String {
        val parts = missing.groupBy { it.script to it.family }.map { (k, ms) ->
            val chars = ms.flatMap { it.chars }.distinct()
            val shown = chars.take(12).joinToString(" ") { "${String(Character.toChars(it))} (U+%04X)".format(it) }
            "${k.first} text has no font: '${k.second}' and the installed fonts lack ${chars.size} character(s): $shown"
        }
        return "Captions would draw empty boxes (tofu): " + parts.joinToString("; ") + ". Pick a caption font for this language or remove those characters."
    }
}

/**
 * Which code points a font file maps to a glyph (its `cmap` table, formats 4 and 12), read straight from the TTF/OTF.
 * Used before an export so a caption never draws tofu: Android's Paint.hasGlyph on a Typeface built from a file also
 * answers yes for characters only the system fallback fonts have, so it cannot tell whether the caption's own font
 * covers the text. Plain Kotlin (unit-tested against the bundled fonts).
 */
class FontCoverage private constructor(private val ranges: IntArray) {
    /** True if the font has a glyph for [cp]. */
    fun has(cp: Int): Boolean {
        var lo = 0
        var hi = ranges.size / 2 - 1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            val s = ranges[mid * 2]
            val e = ranges[mid * 2 + 1]
            when {
                cp < s -> hi = mid - 1
                cp > e -> lo = mid + 1
                else -> return true
            }
        }
        return false
    }

    /** Code points of [text] that need a glyph and that this font lacks (see [needsGlyph]). */
    fun missing(text: String): List<Int> {
        val out = LinkedHashSet<Int>()
        var i = 0
        while (i < text.length) {
            val c = text.codePointAt(i)
            if (needsGlyph(c) && !has(c)) out.add(c)
            i += Character.charCount(c)
        }
        return out.toList()
    }

    companion object {
        private val cache = HashMap<String, FontCoverage?>()

        /**
         * Whether a code point must come from the caption font: spaces, joiners, variation selectors and emoji are
         * not (emoji are drawn by the system colour emoji font, which the export always has).
         */
        fun needsGlyph(c: Int): Boolean {
            if (Character.isWhitespace(c) || Character.isISOControl(c)) return false
            if (c == 0x200c || c == 0x200d || c == 0x200b || c == 0x2060 || c == 0xfeff || c == 0x00a0) return false
            if (c in 0xfe00..0xfe0f || c in 0xe0100..0xe01ef || c in 0xe0000..0xe007f) return false
            if (isEmoji(c)) return false
            return true
        }

        fun isEmoji(c: Int): Boolean =
            c in 0x1f000..0x1faff || c in 0x2600..0x27bf || c in 0x1f1e6..0x1f1ff || c in 0x2300..0x23ff ||
                c in 0x2b00..0x2bff || c == 0x00a9 || c == 0x00ae || c == 0x203c || c == 0x2049 || c == 0x2122 ||
                c in 0x1f3fb..0x1f3ff || c == 0x20e3

        /** Coverage of the font at [path] (cached), or null when it cannot be read. */
        fun of(path: String): FontCoverage? = synchronized(cache) {
            cache.getOrPut(path) { try { parse(File(path).readBytes()) } catch (_: Exception) { null } }
        }

        fun parse(bytes: ByteArray): FontCoverage? {
            val b = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
            var base = 0
            // TrueType collection: use the first font.
            if (bytes.size >= 12 && b.getInt(0) == 0x74746366) base = b.getInt(12)
            val numTables = b.getShort(base + 4).toInt() and 0xffff
            var cmap = -1
            for (i in 0 until numTables) {
                val rec = base + 12 + i * 16
                if (b.getInt(rec) == 0x636d6170) { cmap = b.getInt(rec + 8); break }
            }
            if (cmap < 0) return null
            val n = b.getShort(cmap + 2).toInt() and 0xffff
            var best = -1
            var bestScore = -1
            for (i in 0 until n) {
                val rec = cmap + 4 + i * 8
                val pid = b.getShort(rec).toInt() and 0xffff
                val eid = b.getShort(rec + 2).toInt() and 0xffff
                val off = cmap + b.getInt(rec + 4)
                val format = b.getShort(off).toInt() and 0xffff
                val score = when {
                    format == 12 && (pid == 3 && eid == 10 || pid == 0) -> 3
                    format == 4 && (pid == 3 && (eid == 1 || eid == 0) || pid == 0) -> 2
                    else -> -1
                }
                if (score > bestScore) { bestScore = score; best = off }
            }
            if (best < 0) return null
            val ranges = ArrayList<IntArray>()
            when (b.getShort(best).toInt() and 0xffff) {
                4 -> {
                    val segX2 = b.getShort(best + 6).toInt() and 0xffff
                    val segs = segX2 / 2
                    val endP = best + 14
                    val startP = endP + segX2 + 2
                    val deltaP = startP + segX2
                    val rangeP = deltaP + segX2
                    for (s in 0 until segs) {
                        val end = b.getShort(endP + s * 2).toInt() and 0xffff
                        val start = b.getShort(startP + s * 2).toInt() and 0xffff
                        val delta = b.getShort(deltaP + s * 2).toInt()
                        val ro = b.getShort(rangeP + s * 2).toInt() and 0xffff
                        if (start == 0xffff) continue
                        var runStart = -1
                        for (c in start..end) {
                            val glyph = if (ro == 0) (c + delta) and 0xffff else {
                                val gp = rangeP + s * 2 + ro + (c - start) * 2
                                val g = if (gp + 1 < bytes.size) b.getShort(gp).toInt() and 0xffff else 0
                                if (g == 0) 0 else (g + delta) and 0xffff
                            }
                            if (glyph != 0) { if (runStart < 0) runStart = c } else if (runStart >= 0) { ranges.add(intArrayOf(runStart, c - 1)); runStart = -1 }
                        }
                        if (runStart >= 0) ranges.add(intArrayOf(runStart, end))
                    }
                }
                12 -> {
                    val groups = b.getInt(best + 12)
                    for (g in 0 until groups) {
                        val p = best + 16 + g * 12
                        val s = b.getInt(p)
                        val e = b.getInt(p + 4)
                        val gid = b.getInt(p + 8)
                        // A group starting at glyph 0 maps its first code point to .notdef.
                        if (gid == 0) { if (e > s) ranges.add(intArrayOf(s + 1, e)) } else ranges.add(intArrayOf(s, e))
                    }
                }
                else -> return null
            }
            ranges.sortBy { it[0] }
            val merged = ArrayList<IntArray>()
            for (r in ranges) {
                val last = merged.lastOrNull()
                if (last != null && r[0] <= last[1] + 1) last[1] = maxOf(last[1], r[1]) else merged.add(intArrayOf(r[0], r[1]))
            }
            return FontCoverage(IntArray(merged.size * 2) { i -> merged[i / 2][i % 2] })
        }
    }
}
