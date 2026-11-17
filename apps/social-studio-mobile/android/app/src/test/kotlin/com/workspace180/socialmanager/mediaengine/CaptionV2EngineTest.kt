package com.workspace180.socialmanager.mediaengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Captions v2 text engine and spec (CaptionV2.kt, FontCoverage.kt). The JVM has no android.icu, so these run on the
 * java.text fallback (CaptionIcu.JavaTextIcu, which implements the same Unicode bidi / break rules); the on-device
 * integration test (integration_test/caption_parity_test.dart) runs the same captions through android.icu.
 */
class CaptionV2EngineTest {

    private fun style() = IrCaptionStyle(
        preset = "CUSTOM", animation = "none", fontFamily = "Inter", fontWeight = 800, fontSizePx = 64.0,
        textColor = -1, highlightColor = -1, strokeColor = 0, strokeWidthPx = 0.0, shadow = false, background = null,
        uppercase = false, positionX = 0.5, positionY = 0.72, maxWidthFraction = 0.86,
    )

    private fun cap(text: String, v2: CaptionSpecV2? = null, language: String? = null) =
        IrCaption("c1", "text", 0, 2000, text, emptyList(), style(), v2, language)

    private val spec = mapOf(
        "version" to 2,
        "typography" to mapOf("fonts" to mapOf("latin" to "Anton", "arabic" to "Cairo"), "weight" to 800, "sizePx" to 80, "case" to "upper", "letterSpacingEm" to 0.02),
        "paint" to mapOf(
            "fill" to mapOf("type" to "gradient", "top" to "#FFFFFF", "bottom" to "#FFD400"),
            "strokes" to listOf(mapOf("color" to "#000000", "widthPx" to 6), mapOf("color" to "#FF000080", "widthPx" to 4)),
            "shadow" to mapOf("xPx" to 0, "yPx" to 4, "blurPx" to 8, "color" to "#00000099"),
            "glow" to mapOf("radiusPx" to 14, "color" to "#00E5FF", "strength" to 0.6),
            "background" to mapOf("mode" to "pill", "color" to "#000000", "opacity" to 0.5),
        ),
        "words" to mapOf("active" to mapOf("color" to "#FFE600", "scale" to 1.2, "yOffsetPx" to -6), "resting" to mapOf("opacity" to 0.4)),
        "motion" to mapOf(
            "groupEnter" to mapOf("type" to "spring-pop", "durationMs" to 300, "easing" to mapOf("type" to "spring", "stiffness" to 400, "damping" to 14)),
            "wordEnter" to mapOf("type" to "rise", "staggerMs" to 40),
            "activeWord" to mapOf("type" to "scale-spring"),
        ),
        "layout" to mapOf("position" to "upper-third", "safeZone" to "reels", "maxLines" to 1),
    )

    @Test
    fun parsesEveryV2SectionWithSchemaDefaults() {
        val s = CaptionSpecV2.parse(spec)!!
        assertEquals("Anton", s.fontFor("latin"))
        assertEquals("Cairo", s.fontFor("arabic"))
        assertEquals("Noto Sans Devanagari", s.fontFor("devanagari")) // DEFAULT_SCRIPT_FONTS
        assertEquals(80.0, s.sizePx, 0.0)
        assertEquals("upper", s.case)
        assertEquals(0xFFFFFFFF.toInt(), s.gradientTop)
        assertEquals(0xFFFFD400.toInt(), s.gradientBottom)
        assertEquals(2, s.strokes.size)
        assertEquals(0x80FF0000.toInt(), s.strokes[1].color) // #RRGGBBAA → ARGB
        assertEquals(0.6, s.glow!!.strength, 0.0)
        assertNotNull(s.shadow) // glow and shadow both on
        assertEquals("pill", s.background.mode)
        assertEquals(0.4, s.resting.opacity, 0.0)
        assertEquals(-6.0, s.active.yOffsetPx, 0.0)
        assertEquals(V2Easing.Spring(400.0, 14.0), s.groupEnter.easing)
        assertEquals(40L, s.wordEnter.staggerMs)
        assertEquals(V2Easing.Spring(300.0, 18.0), s.activeWord.easing) // activeWord easing default
        assertEquals("upper-third", s.position)
        assertEquals("reels", s.safeZone)
        assertEquals(1, s.maxLines)
        assertTrue(s.faceAvoid) // layout default
        // Not a v2 spec → v1 path.
        assertNull(CaptionSpecV2.parse(mapOf("version" to 1)))
        assertNull(CaptionSpecV2.parse(mapOf("version" to 2, "paint" to emptyMap<String, Any>())))
    }

    @Test
    fun easeAtIsTimeBasedAndSpringEndsAtExactlyOne() {
        val spring = V2Easing.Spring(300.0, 10.0)
        assertEquals(0.0, CaptionV2Math.easeAt(spring, 0.0, 300.0), 0.0)
        assertEquals(1.0, CaptionV2Math.easeAt(spring, 300.0, 300.0), 0.0) // forced to 1 at durationMs
        val peak = (1..299).maxOf { CaptionV2Math.easeAt(spring, it.toDouble(), 300.0) }
        assertTrue("under-damped spring overshoots, peak $peak", peak > 1.1)
        // Same instant at 24 / 30 / 60 fps gives the same value (time, not frames).
        val at100 = CaptionV2Math.easeAt(V2Easing.Back(), 100.0, 250.0)
        assertEquals(at100, CaptionV2Math.easeAt(V2Easing.Back(), 2400.0 / 24.0, 250.0), 1e-12)
        assertEquals(0.5, CaptionV2Math.easeAt(V2Easing.Linear, 50.0, 100.0), 1e-12)
        assertEquals(1 - 0.5 * 0.5 * 0.5, CaptionV2Math.easeAt(V2Easing.Cubic("out"), 50.0, 100.0), 1e-12)
    }

    @Test
    fun anchorKeepsTheBlockInsideTheSafeZone() {
        val s = CaptionSpecV2.parse(spec)!!.copy(position = "custom", y = 0.98, safeZone = "tiktok")
        val (_, cy) = CaptionV2Math.anchor(s, 1080.0, 1920.0, 600.0, 200.0)
        assertEquals(1920.0 - 480 - 100, cy, 1e-9) // pushed up above TikTok's bottom UI
        val none = s.copy(safeZone = "none")
        assertEquals(0.98 * 1920 - 0.0, CaptionV2Math.anchor(none, 1080.0, 1920.0, 600.0, 10.0).second, 1e-9)
    }

    @Test
    fun faceAvoidanceMovesTheBlockOffTheFace() {
        val safe = CaptionV2Math.safeRect("tiktok", 1080.0, 1920.0)
        val face = CaptionV2Math.Rect(340.0, 1100.0, 740.0, 1500.0)
        val cy = CaptionV2Math.avoidFaces(1300.0, 160.0, 200.0, 880.0, listOf(face), safe, 1920.0)
        val block = CaptionV2Math.Rect(200.0, cy - 80, 880.0, cy + 80)
        assertFalse("block $block still covers the face", block.intersects(face))
        assertTrue(cy - 80 >= safe.top && cy + 80 <= safe.bottom)
        // No face → unchanged.
        assertEquals(1300.0, CaptionV2Math.avoidFaces(1300.0, 160.0, 200.0, 880.0, emptyList(), safe, 1920.0), 0.0)
    }

    @Test
    fun tokensFollowTheSharedRules() {
        assertEquals(listOf("今日から", "物語を", "始めよう"), CaptionText.tokens("今日から物語を始めよう"))
        assertEquals(listOf("こんにちは、", "世界"), CaptionText.tokens("こんにちは、世界"))
        assertEquals(listOf("「東京」", "で", "新しい", "会社を"), CaptionText.tokens("「東京」で新しい会社を"))
        assertEquals(listOf("iPhone", "16", "を", "買った"), CaptionText.tokens("iPhone 16を買った"))
        assertEquals(listOf("आज", "से", "शुरू", "करो"), CaptionText.tokens("आज से शुरू करो"))
        assertEquals(listOf("one", "\n", "two"), CaptionText.tokens("one\ntwo"))
        // Thai word breaks need ICU's dictionary: android.icu has it (checked on device by caption_parity_test.dart);
        // the JDK's java.text fallback used here does not, so only the no-space join is checked on the JVM.
        val thai = CaptionText.tokens("สวัสดีครับวันนี้")
        assertEquals("สวัสดีครับวันนี้", CaptionText.join(thai)) // never joined with spaces
        assertEquals("今日から物語を始めよう", CaptionText.join(CaptionText.tokens("今日から物語を始めよう")))
        assertEquals("iPhone 16を買った", CaptionText.join(listOf("iPhone", "16を", "買った")))
    }

    @Test
    fun widthSplitNeverCutsAGraphemeCluster() {
        // क्षत्रिय: conjuncts with virama; each piece must end on a cluster boundary.
        val word = "क्षत्रियक्षत्रियक्षत्रिय"
        val ends = CaptionIcu.api.graphemeEnds(word).toSet()
        val pieces = CaptionText.splitToWidth(word, 3.0) { it.length.toDouble() }
        assertEquals(word, pieces.joinToString(""))
        var off = 0
        for (p in pieces.dropLast(1)) { off += p.length; assertTrue("cut at $off inside a cluster", off in ends) }
        // Emoji ZWJ sequence stays whole.
        val family = "👨‍👩‍👧"
        assertEquals(listOf(family), CaptionText.splitToWidth(family, 1.0) { it.length.toDouble() })
    }

    @Test
    fun bidiPlacesRtlWordsInVisualOrder() {
        // Arabic: right-to-left, first word on the right.
        assertEquals(listOf(2, 1, 0), CaptionText.visualOrder(listOf("ابدأ", "قصتك", "اليوم"), rtl = true))
        // Arabic with a number: the number keeps its place in the RTL sequence.
        assertEquals(listOf(2, 1, 0), CaptionText.visualOrder(listOf("ابدأ", "3", "خطوات"), rtl = true))
        // Urdu with an embedded Latin run: "iPhone 16" stays left-to-right inside the RTL line.
        assertEquals(listOf(3, 1, 2, 0), CaptionText.visualOrder(listOf("میں", "iPhone", "16", "خریدا"), rtl = true))
        // English sentence with an Arabic phrase: the Arabic pair is reversed, the rest stays.
        assertEquals(listOf(0, 1, 3, 2), CaptionText.visualOrder(listOf("I", "said", "مرحبا", "بكم"), rtl = false))
        // Pure LTR untouched.
        assertEquals(listOf(0, 1, 2), CaptionText.visualOrder(listOf("a", "b", "c"), rtl = false))
        // Paragraph direction: RTL language wins over a leading English word; else the first strong letter.
        assertTrue(CaptionScripts.isRtlParagraph("iPhone خریدا", "ur"))
        assertFalse(CaptionScripts.isRtlParagraph("iPhone خریدا", null))
        assertTrue(CaptionScripts.isRtlParagraph("3 خطوات", null))
    }

    @Test
    fun caseIsLocaleAwareAndOnlyForCasedScripts() {
        assertEquals("İSTANBUL'DA İYİ", CaptionScripts.applyCase("istanbul'da iyi", "upper", "tr"))
        assertEquals("ISTANBUL'DA IYI", CaptionScripts.applyCase("istanbul'da iyi", "upper", "en"))
        assertEquals("KAPI", CaptionScripts.applyCase("kapı", "upper", "tr-TR"))
        assertEquals("STRASSE", CaptionScripts.applyCase("straße", "upper", "de"))
        assertEquals("ПРИВЕТ", CaptionScripts.applyCase("привет", "upper", "ru"))
        assertEquals("नमस्ते दोस्तों", CaptionScripts.applyCase("नमस्ते दोस्तों", "upper", "hi"))
        assertEquals("مرحبا", CaptionScripts.applyCase("مرحبا", "upper", "ar"))
        assertEquals("Hello Big World", CaptionScripts.applyCase("hello big world", "title", null))
        assertEquals("İyi Günler", CaptionScripts.applyCase("iyi günler", "title", "tr"))
    }

    private fun items(vararg widths: Double) = widths.mapIndexed { i, w -> CaptionText.Item(i, "w$i", w, w, i) }

    @Test
    fun linesAreAtMostTwoAndBottomHeavy() {
        val gap = { _: CaptionText.Item, _: CaptionText.Item -> 10.0 }
        // Fits on one line.
        assertEquals(1, CaptionText.breakLines(items(100.0, 100.0), 300.0, 2, gap, true)!!.size)
        // Two lines, top no wider than bottom, never a single word on top.
        val two = CaptionText.breakLines(items(60.0, 90.0, 80.0, 200.0), 300.0, 2, gap, true)!!
        assertEquals(2, two.size)
        val w = two.map { l -> l.sumOf { it.slot } + 10.0 * (l.size - 1) }
        assertTrue("bottom-heavy: $w", w[0] <= w[1])
        assertTrue(two[0].size >= 2)
        // Cannot fit in 2 lines → null (the renderer then shrinks the font; it never draws 3 lines).
        assertNull(CaptionText.breakLines(items(290.0, 290.0, 290.0), 300.0, 2, gap, true))
        assertNull(CaptionText.breakLines(items(200.0, 200.0), 300.0, 1, gap, true))
    }

    /** Test fonts (SIL OFL) shared with the Flutter goldens: apps/social-studio-mobile/test/fonts. */
    private fun fontFile(name: String): File = File("../../test/fonts/$name")

    @Test
    fun cmapCoverageMatchesTheBundledFonts() {
        val inter = FontCoverage.parse(File("src/main/assets/fonts/Inter-800.ttf").readBytes())!!
        assertTrue(inter.has('A'.code) && inter.has('é'.code))
        assertFalse(inter.has('क'.code))
        val deva = FontCoverage.parse(fontFile("NotoSansDevanagari-800.ttf").readBytes())!!
        assertTrue(deva.missing("आज से अपनी कहानी शुरू करो").isEmpty())
        val arabic = FontCoverage.parse(fontFile("NotoSansArabic-800.ttf").readBytes())!!
        assertTrue(arabic.missing("ابدأ قصتك اليوم مع ٣ خطوات").isEmpty())
        assertFalse(arabic.has('क'.code))
        val jp = FontCoverage.parse(fontFile("NotoSansJP-800-subset.ttf").readBytes())!!
        assertTrue(jp.missing("今日から物語を始めよう").isEmpty())
        // Emoji and joiners never need the caption font.
        assertTrue(inter.missing("Hi 🔥‍").isEmpty())
    }

    @Test
    fun glyphCheckFailsOnlyWhenNoFontCoversTheText() {
        val inter = FontCoverage.parse(File("src/main/assets/fonts/Inter-800.ttf").readBytes())
        val deva = FontCoverage.parse(fontFile("NotoSansDevanagari-800.ttf").readBytes())
        val v2 = CaptionSpecV2.parse(spec)!!
        val hindi = cap("आज से शुरू करो", v2, "hi")
        // The template's Devanagari font is supplied: nothing missing.
        val ok = CaptionGlyphCheck.check(listOf(hindi), { f, _ -> if (f == "Noto Sans Devanagari") deva else inter }) { false }
        assertTrue(ok.missing.isEmpty() && ok.systemFallback.isEmpty())
        // Not supplied and no system font has it: typed failure naming the script and the font.
        val bad = CaptionGlyphCheck.check(listOf(hindi), { _, _ -> inter }) { false }
        assertEquals(1, bad.missing.size)
        assertEquals("devanagari", bad.missing[0].script)
        assertEquals("Noto Sans Devanagari", bad.missing[0].family)
        assertTrue(CaptionGlyphCheck.message(bad.missing).contains("U+0906"))
        // Not supplied but an installed font has it: drawn with the system font (warning, not failure).
        val sys = CaptionGlyphCheck.check(listOf(hindi), { _, _ -> inter }) { true }
        assertTrue(sys.missing.isEmpty() && sys.systemFallback.isNotEmpty())
        // v1 caption, Latin only: covered by Inter.
        assertTrue(CaptionGlyphCheck.check(listOf(cap("Hello world")), { _, _ -> inter }) { false }.missing.isEmpty())
    }

    @Test
    fun groupMotionEntersAndExitsWithinTheCaption() {
        val s = CaptionSpecV2.parse(spec)!!.copy(groupExit = V2GroupMotion("slide-up", 200, V2Easing.Cubic("out")))
        val start = CaptionV2Motion.group(s, 0, 2000, 0.0, 1.0, 1920.0)
        assertEquals(0.0, start.opacity, 1e-9)
        val settled = CaptionV2Motion.group(s, 0, 2000, 1000.0, 1.0, 1920.0)
        assertEquals(1.0, settled.opacity, 1e-9)
        assertEquals(1.0, settled.scale, 1e-9)
        val leaving = CaptionV2Motion.group(s, 0, 2000, 1950.0, 1.0, 1920.0)
        assertTrue(leaving.dy < 0 && leaving.opacity < 1) // exits upwards
    }
}
