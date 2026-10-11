package com.workspace180.socialmanager.mediaengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

class AnalysisAlgorithmsTest {
    private fun flat(v: Int, n: Int = 64 * 36) = IntArray(n) { v }

    private fun noisy(base: Int, seed: Int, amp: Int = 6) = IntArray(64 * 36) { i ->
        (base + ((i * 7919 + seed * 104729) % (2 * amp + 1)) - amp).coerceIn(0, 255)
    }

    @Test
    fun sceneCutsAreFoundAtHardCutsOnly() {
        val d = SceneCutDetector()
        var t = 0L
        repeat(60) { d.feed(t, noisy(40, it)); t += 33 } // dark scene, ~2 s
        repeat(60) { d.feed(t, noisy(200, it)); t += 33 } // bright scene
        repeat(60) { d.feed(t, noisy(110, it)); t += 33 } // mid scene
        assertEquals(listOf(1980L, 3960L), d.cutsMs)
    }

    @Test
    fun gradualFadeIsNotACut() {
        val d = SceneCutDetector()
        for (i in 0 until 120) d.feed(i * 33L, noisy(20 + i, i))
        assertTrue(d.cutsMs.isEmpty())
    }

    @Test
    fun blackAndFrozenRangesAreDetected() {
        val d = BlackFrozenDetector()
        var t = 0L
        repeat(30) { d.feed(t, noisy(120, it)); t += 33 } // moving, 0..990
        repeat(30) { d.feed(t, flat(16)); t += 33 } // black, 990..1980
        val still = noisy(90, 1)
        repeat(45) { d.feed(t, still.copyOf()); t += 33 } // frozen, 1980..3465
        repeat(10) { d.feed(t, noisy(120, it + 100)); t += 33 }
        d.finish(t)
        assertEquals(1, d.blackRanges.size)
        assertEquals(990L, d.blackRanges[0][0])
        assertEquals(1980L, d.blackRanges[0][1])
        assertEquals(1, d.frozenRanges.size)
        assertEquals(1980L, d.frozenRanges[0][0])
        assertEquals(3465L, d.frozenRanges[0][1])
    }

    @Test
    fun loudnessOfA1kHzSineMatchesBs1770() {
        // BS.1770: a full-scale 1 kHz sine in one channel reads -3.01 LUFS, so the same sine in both
        // channels reads 0 LUFS, and at amplitude 0.1 (-20 dBFS) it reads -20 LUFS.
        val rate = 48000
        val m = LoudnessMeter(rate, 2)
        val frame = DoubleArray(2)
        for (i in 0 until rate * 3) {
            val v = 0.1 * sin(2 * PI * 1000 * i / rate)
            frame[0] = v; frame[1] = v
            m.feed(frame)
        }
        val r = m.result()
        assertEquals(-20.0, r["integratedLufs"]!!, 0.3)
        assertEquals(-20.0, r["truePeakDb"]!!, 0.3)
        assertEquals(0.0, r["clippingPct"]!!, 1e-9)
    }

    @Test
    fun silenceIsGatedAndClippingIsCounted() {
        val silent = LoudnessMeter(44100, 1)
        repeat(44100) { silent.feed(doubleArrayOf(0.0)) }
        assertNull(silent.result()["integratedLufs"])

        val clipped = LoudnessMeter(44100, 1)
        for (i in 0 until 44100) clipped.feed(doubleArrayOf(if (i % 10 == 0) 1.0 else 0.2 * sin(i / 5.0)))
        assertEquals(10.0, clipped.result()["clippingPct"]!!, 0.01)
    }

    @Test
    fun ocrSamplesMergeIntoSpans() {
        val m = OcrSpanMerger(1000)
        m.feed(0, "SALE  50%\noff")
        m.feed(1000, "sale 50% off")
        m.feed(2000, "")
        m.feed(3000, "x")
        m.feed(4000, "Link in bio")
        val spans = m.finish()
        assertEquals(2, spans.size)
        assertEquals(mapOf("startMs" to 0L, "endMs" to 2000L, "text" to "SALE 50% off"), spans[0])
        assertEquals(4000L, spans[1]["startMs"])
        assertEquals(5000L, spans[1]["endMs"])
    }

    @Test
    fun lumaGridHonoursStrides() {
        // 4x2 plane with pixelStride 2 and rowStride 10: values at even offsets.
        val plane = ByteArray(20) { if (it % 2 == 0) (it * 10).toByte() else 0 }
        val g = LumaGrid.sample({ plane[it].toInt() }, 4, 2, 10, 2, gridW = 4, gridH = 2)
        assertEquals(listOf(0, 20, 40, 60, 100, 120, 140, 160), g.toList())
    }
}
