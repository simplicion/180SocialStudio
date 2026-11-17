package com.workspace180.socialmanager.mediaengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/**
 * Studio export loudness (QA O-7): the export reached -20 LUFS instead of -14 because the limiter's loss was not
 * accounted for. The gain is now chosen by running the voice through the export's own limiter.
 */
class LoudnessPlanTest {
    private val rate = 48000

    /** 20 s of "speech": 180 ms syllables with a sharp attack and decay, pauses between, quiet. High crest factor. */
    private fun speechLike(spikeAmp: Double = 0.8): List<DoubleArray> {
        val out = ArrayList<DoubleArray>(rate * 20)
        val syll = (0.18 * rate).toInt()
        val gap = (0.07 * rate).toInt()
        var i = 0
        var n = 0
        while (out.size < rate * 20) {
            for (s in 0 until syll) {
                // A quiet vowel body plus a 3 ms plosive spike at the onset: speech's ~20 dB peak-to-loudness ratio.
                val body = 0.06 * (if (s < 200) s / 200.0 else Math.exp(-(s - 200) / (0.08 * rate)))
                val spike = if (s < (0.003 * rate).toInt()) spikeAmp else 0.0
                val f = 180.0 + 40 * (n % 5)
                val x = (body + spike) * (sin(2 * PI * f * i / rate) + 0.4 * sin(2 * PI * 3 * f * i / rate)) / 1.4
                out.add(doubleArrayOf(x)); i++
            }
            repeat(gap) { out.add(doubleArrayOf(0.0)); i++ }
            n++
        }
        return out
    }

    private fun lufs(frames: List<DoubleArray>, gainDb: Double? = null): Double {
        val meter = LoudnessMeter(rate, 1)
        val lim = gainDb?.let { PeakLimiter(it, -2.0, rate) }
        for (f in frames) {
            val x = f.copyOf()
            lim?.process(x)
            meter.feed(x)
        }
        return meter.result()["integratedLufs"]!!
    }

    @Test
    fun `the limiter never lets a sample over the ceiling`() {
        val lim = PeakLimiter(18.0, -2.0, rate)
        val ceiling = Math.pow(10.0, -2.0 / 20)
        for (f in speechLike()) {
            val x = f.copyOf()
            lim.process(x)
            assertTrue(abs(x[0]) <= ceiling + 1e-9)
        }
    }

    @Test
    fun `a steady voice the limiter barely touches lands on the target with the plain gain`() {
        val voice = speechLike(spikeAmp = 0.0)
        val target = -14.0
        val naive = target - lufs(voice)
        val plan = LoudnessPlan.choose(target, (0..4).map { naive + it * 2.0 }.associateWith { lufs(voice, it) })!!
        assertEquals("lands within 1 LU of the target", target, lufs(voice, plan.gainDb), 1.0)
    }

    @Test
    fun `a peaky voice - the limiter caps its loudness, the plan gets louder than the naive gain and predicts the result honestly`() {
        val voice = speechLike(spikeAmp = 0.8)
        val target = -14.0
        val base = lufs(voice)
        val peakDb = 20 * Math.log10(voice.maxOf { abs(it[0]) })
        assertTrue("as peaky as real speech (PLR ${peakDb - base} dB)", peakDb - base >= 18.0)
        val naive = target - base
        val naiveResult = lufs(voice, naive)
        assertTrue("the naive gain falls short behind the limiter (got $naiveResult)", naiveResult < target - 1.5)
        val plan = LoudnessPlan.choose(target, (0..4).map { naive + it * 2.0 }.associateWith { lufs(voice, it) })!!
        val actual = lufs(voice, plan.gainDb)
        assertTrue("at least as loud as the naive gain ($actual vs $naiveResult)", actual >= naiveResult - 0.05)
        assertTrue("reported as short of the target (predicted ${plan.predictedLufs})", plan.predictedLufs < target - 0.5)
        assertEquals("the prediction is what the export will measure", plan.predictedLufs, actual, 0.3)
    }

    @Test
    fun `choose picks a candidate on target, interpolates between neighbours, or takes the loudest`() {
        assertEquals(4.0, LoudnessPlan.choose(-14.0, mapOf(2.0 to -16.0, 4.0 to -14.2, 6.0 to -13.0))!!.gainDb, 1e-9)
        assertEquals(5.0, LoudnessPlan.choose(-14.0, mapOf(4.0 to -15.0, 6.0 to -13.0))!!.gainDb, 1e-9)
        val short = LoudnessPlan.choose(-14.0, mapOf(10.0 to -19.0, 12.0 to -18.0, null to null).filterKeys { it != null }.mapKeys { it.key!! })!!
        assertEquals(12.0, short.gainDb, 1e-9)
        assertEquals(-18.0, short.predictedLufs, 1e-9)
    }
}
