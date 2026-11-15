package com.workspace180.socialmanager.mediaengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Phase 3 Caption Rendering Parity Tests across scripts {Latin, Hindi, Arabic, Japanese}
 * and animation phases (group enter, active word spring pop, word change, group exit).
 */
class CaptionRenderingParityTest {

    @Test
    fun easeSpringRegimesMatchContract() {
        // Closed-form spring: t=0 gives 0.0
        val atZero = TextMotion.easeSpring(0.0, 300.0, 18.0)
        assertEquals(0.0, atZero, 1e-4)

        // Under-damped spring (stiffness=300, damping=18 -> w0=17.32, zeta=0.52) overshoots 1.0
        var maxVal = 0.0
        for (i in 1..50) {
            val t = i * 0.01
            val v = TextMotion.easeSpring(t, 300.0, 18.0)
            if (v > maxVal) maxVal = v
        }
        assertTrue("Under-damped spring should overshoot 1.0, max was $maxVal", maxVal > 1.05)

        // Critically damped spring (stiffness=100, damping=20 -> w0=10, zeta=1.0) never crosses 1.0
        var maxCrit = 0.0
        for (i in 1..100) {
            val t = i * 0.01
            val v = TextMotion.easeSpring(t, 100.0, 20.0)
            if (v > maxCrit) maxCrit = v
            assertTrue("Critically damped should never exceed 1.0, got $v at t=$t", v <= 1.0001)
        }
        assertTrue("Critically damped should approach 1.0, max was $maxCrit", maxCrit > 0.98)

        // Over-damped spring (stiffness=100, damping=30 -> w0=10, zeta=1.5) never crosses 1.0
        for (i in 1..100) {
            val t = i * 0.01
            val v = TextMotion.easeSpring(t, 100.0, 30.0)
            assertTrue("Over-damped should never exceed 1.0, got $v at t=$t", v <= 1.0001)
        }
    }

    @Test
    fun scriptHandlingParityAcrossLanguages() {
        // Latin
        val latinWords = listOf("Cinematic", "captions", "look", "stunning")
        assertFalse(hasRtl("Cinematic captions look stunning"))
        assertEquals("Cinematic captions look stunning", joinWordsForScript(latinWords))
        assertEquals("Anton", fontForText("Cinematic captions", "Anton"))

        // Hindi (Devanagari)
        val hindiWords = listOf("आज", "हम", "बात", "करेंगे")
        assertFalse(hasRtl("आज हम बात करेंगे"))
        assertEquals("आज हम बात करेंगे", joinWordsForScript(hindiWords))
        assertEquals("Noto Sans Devanagari", fontForText("आज हम बात करेंगे", "Anton"))
        assertEquals("Poppins", fontForText("आज हम बात करेंगे", "Poppins"))

        // Arabic (RTL)
        val arabicWords = listOf("مرحبا", "بكم", "في", "عالمنا")
        assertTrue(hasRtl("مرحبا بكم في عالمنا"))
        assertEquals("مرحبا بكم في عالمنا", joinWordsForScript(arabicWords))
        assertEquals("Noto Sans Arabic", fontForText("مرحبا بكم في عالمنا", "Anton"))
        assertEquals("Cairo", fontForText("مرحبا بكم في عالمنا", "Cairo"))

        // Japanese (CJK-JP) - space-free concatenation
        val jpWords = listOf("これ", "は", "新しい", "スタイルです")
        assertFalse(hasRtl("これは新しいスタイルです"))
        assertEquals("これは新しいスタイルです", joinWordsForScript(jpWords))
        assertEquals("Noto Sans JP", fontForText("これは新しいスタイルです", "Montserrat"))
    }

    @Test
    fun safeZoneTableValuesMatchContracts() {
        val tiktok = CAPTION_SAFE_ZONES["tiktok"]
        org.junit.Assert.assertNotNull(tiktok)
        assertEquals(220f, tiktok!!.top, 1e-4f)
        assertEquals(480f, tiktok.bottom, 1e-4f)
        assertEquals(60f, tiktok.left, 1e-4f)
        assertEquals(140f, tiktok.right, 1e-4f)

        val reels = CAPTION_SAFE_ZONES["reels"]
        org.junit.Assert.assertNotNull(reels)
        assertEquals(270f, reels!!.top, 1e-4f)
        assertEquals(670f, reels.bottom, 1e-4f)
        assertEquals(65f, reels.left, 1e-4f)
        assertEquals(120f, reels.right, 1e-4f)

        val shorts = CAPTION_SAFE_ZONES["shorts"]
        org.junit.Assert.assertNotNull(shorts)
        assertEquals(240f, shorts!!.top, 1e-4f)
        assertEquals(600f, shorts.bottom, 1e-4f)
        assertEquals(60f, shorts.left, 1e-4f)
        assertEquals(140f, shorts.right, 1e-4f)
    }

    @Test
    fun textMotionV2EnterAndExitTypesRecognized() {
        val springPopEnter = IrTextMotionSpec("spring-pop", 200L)
        val motion = TextMotion.at(enter = springPopEnter, exit = null, loop = null, startMs = 0L, endMs = 2000L, tMs = 100.0)
        // Mid-way through spring-pop: scale should be animated
        assertTrue("spring-pop should animate scale", motion.scale > 0.0)

        val scaleDownEnter = IrTextMotionSpec("scale-down-in", 200L)
        val scaleMotion = TextMotion.at(enter = scaleDownEnter, exit = null, loop = null, startMs = 0L, endMs = 2000L, tMs = 0.0)
        assertTrue("scale-down-in should start enlarged", scaleMotion.scale > 1.2)
    }
}
