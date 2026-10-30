package com.workspace180.socialmanager.mediaengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Caption text rules and timeline repairs shared with the Dart editor (edit_ir.dart `displayWords`). */
class CaptionContractTest {
    private val style = IrCaptionStyle(
        preset = "TITLE", animation = "none", fontFamily = "Inter", fontWeight = 800, fontSizePx = 72.0,
        textColor = -1, highlightColor = -1, strokeColor = 0, strokeWidthPx = 0.0, shadow = true, background = null,
        uppercase = false, positionX = 0.5, positionY = 0.2, maxWidthFraction = 0.86,
    )

    private fun cap(kind: String, text: String, words: List<IrWord>, start: Long = 0, end: Long = 1000) =
        IrCaption("c", kind, start, end, text, words, style)

    private fun w(t: String, s: Long, e: Long, hl: Boolean = false) = IrWord(t, s, e, hl, null, 1.0)

    @Test
    fun titleDrawsItsTextWithLineBreaksNotTheStaleWordCopy() {
        val words = displayWords(cap("text", "New title\nline two", listOf(w("Old title", 0, 1000))))
        assertEquals(listOf("New", "title", LINE_BREAK, "line", "two"), words.map { it.text })
        assertTrue(words.all { it.startMs == 0L && it.endMs == 1000L })
    }

    @Test
    fun speechCaptionKeepsTimedWordsWhileTextMatches() {
        val words = displayWords(cap("caption", " hello  world", listOf(w("hello", 0, 400), w("world", 400, 1000, hl = true))))
        assertEquals(listOf("hello", "world"), words.map { it.text })
        assertTrue(words[1].highlight)
    }

    @Test
    fun editedCaptionIsRetimedLikeTheDartEditor() {
        val same = displayWords(cap("caption", "Hello World", listOf(w("hello", 0, 400), w("world", 400, 1000, hl = true))))
        assertEquals(listOf(400L, 1000L), listOf(same[1].startMs, same[1].endMs))
        assertTrue(same[1].highlight)
        val retimed = displayWords(cap("caption", "aa bb cccc", listOf(w("x", 1000, 2000)), 1000, 2000))
        assertEquals(listOf(1000L to 1250L, 1250L to 1500L, 1500L to 2000L), retimed.map { it.startMs to it.endMs })
    }

    @Test
    fun captionWithoutWordsDrawsItsText() {
        assertEquals(listOf("just", "text"), displayWords(cap("caption", "just text", emptyList())).map { it.text })
    }

    @Test
    fun normalizeRepairsInsteadOfFailingTheExport() {
        val clip = IrClip("a", "primary", 0, 2000, 0, 2000, 1.0, 0.0, IrCrop(-0.01, 0.0, 1.02, 1.0), null, IrTransition("CROSSFADE", 400))
        val ir = MobileEditIr(
            schemaVersion = MobileEditIr.SCHEMA_VERSION, projectId = "p",
            canvas = IrCanvas("9:16", 1080, 1920, 30.0, 0),
            durationMs = 2000, clips = listOf(clip),
            overlays = listOf(IrOverlay("o", "broll", 2500, 3000, 0, 1.0, true)),
            captions = listOf(IrCaption("late", "caption", 1500, 2600, "x", emptyList(), style), IrCaption("gone", "caption", 2100, 2600, "y", emptyList(), style)),
            zooms = emptyList(), audio = IrAudio(0.0, emptyList(), emptyList()),
        ).normalized()
        ir.validate()
        assertNull(ir.clips[0].transitionIn)
        assertEquals(IrCrop(0.0, 0.0, 1.0, 1.0), ir.clips[0].crop)
        assertTrue(ir.overlays.isEmpty())
        assertEquals(listOf("late"), ir.captions.map { it.id })
        assertEquals(2000L, ir.captions[0].endMs)
        assertTrue(ir.parseWarnings.isNotEmpty())
    }
}
