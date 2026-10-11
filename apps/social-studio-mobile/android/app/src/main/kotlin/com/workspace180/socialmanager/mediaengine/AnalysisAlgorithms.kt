package com.workspace180.socialmanager.mediaengine

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan

/*
 * Pure analysis algorithms (no Android APIs, so they run in JVM unit tests). The Android side
 * decodes media and feeds them samples/frames; the AI only reads the numbers they produce.
 */

/**
 * Hard-cut detector over downsampled luma frames: a 16-bin luma histogram distance (0..1) plus the
 * mean absolute pixel difference, compared against an adaptive baseline of recent frame distances.
 * Gradual fades are deliberately not reported as cuts.
 */
class SceneCutDetector(
    private val minSceneMs: Long = 500,
    private val histThreshold: Double = 0.30,
    private val madThreshold: Double = 18.0,
) {
    private var prevHist: DoubleArray? = null
    private var prevGrid: IntArray? = null
    private var lastCutMs = Long.MIN_VALUE / 2
    private val recent = ArrayDeque<Double>()
    val cutsMs = mutableListOf<Long>()

    fun feed(tMs: Long, luma: IntArray) {
        if (luma.isEmpty()) return
        val hist = histogram(luma)
        val ph = prevHist
        val pg = prevGrid
        if (ph != null && pg != null && pg.size == luma.size) {
            var hd = 0.0
            for (i in hist.indices) hd += abs(hist[i] - ph[i])
            hd /= 2.0
            var mad = 0.0
            for (i in luma.indices) mad += abs(luma[i] - pg[i])
            mad /= luma.size
            val baseline = if (recent.isEmpty()) 0.0 else recent.sum() / recent.size
            if (hd > histThreshold && mad > madThreshold && hd > baseline * 3 && tMs - lastCutMs >= minSceneMs && tMs >= minSceneMs) {
                cutsMs.add(tMs)
                lastCutMs = tMs
                recent.clear()
            } else {
                recent.addLast(hd)
                if (recent.size > 12) recent.removeFirst()
            }
        }
        prevHist = hist
        prevGrid = luma
    }

    companion object {
        fun histogram(luma: IntArray): DoubleArray {
            val h = DoubleArray(16)
            for (v in luma) h[(v.coerceIn(0, 255)) shr 4] += 1.0
            for (i in h.indices) h[i] /= luma.size.toDouble()
            return h
        }
    }
}

/**
 * Finds black stretches (mean luma at the video black level and almost no bright pixels) and frozen
 * stretches (consecutive frames that are practically identical). Fed in presentation order; ranges
 * are [start, end) in ms and only runs of at least the configured length are kept.
 */
class BlackFrozenDetector(
    private val minBlackMs: Long = 300,
    private val minFrozenMs: Long = 800,
    private val blackMeanMax: Double = 24.0,
    private val blackBrightMax: Int = 48,
    private val blackBrightShareMax: Double = 0.02,
    private val frozenMadMax: Double = 0.1,
) {
    val blackRanges = mutableListOf<LongArray>()
    val frozenRanges = mutableListOf<LongArray>()
    private var blackStart: Long? = null
    private var frozenStart: Long? = null
    private var prev: IntArray? = null
    private var lastT = 0L
    var frames = 0
        private set

    fun feed(tMs: Long, luma: IntArray) {
        if (luma.isEmpty()) return
        frames++
        var sum = 0L
        var bright = 0
        for (v in luma) {
            sum += v
            if (v > blackBrightMax) bright++
        }
        val mean = sum.toDouble() / luma.size
        val black = mean <= blackMeanMax && bright.toDouble() / luma.size <= blackBrightShareMax
        if (black) {
            if (blackStart == null) blackStart = tMs
        } else {
            closeBlack(tMs)
        }
        val p = prev
        val frozen = if (p != null && p.size == luma.size && !black) {
            var mad = 0.0
            for (i in luma.indices) mad += abs(luma[i] - p[i])
            mad / luma.size <= frozenMadMax
        } else false
        if (frozen) {
            if (frozenStart == null) frozenStart = lastT
        } else {
            closeFrozen(tMs)
        }
        prev = luma
        lastT = tMs
    }

    /** Closes open runs at [endMs] (the media duration). */
    fun finish(endMs: Long) {
        closeBlack(endMs)
        closeFrozen(endMs)
    }

    private fun closeBlack(endMs: Long) {
        val s = blackStart ?: return
        if (endMs - s >= minBlackMs) blackRanges.add(longArrayOf(s, endMs))
        blackStart = null
    }

    private fun closeFrozen(endMs: Long) {
        val s = frozenStart ?: return
        if (endMs - s >= minFrozenMs) frozenRanges.add(longArrayOf(s, endMs))
        frozenStart = null
    }
}

/**
 * Integrated loudness per ITU-R BS.1770-4 / EBU R128: K-weighting (high-shelf + high-pass biquads,
 * coefficients derived for any sample rate), 400 ms blocks with 75 % overlap, absolute gate at
 * -70 LUFS and relative gate at -10 LU. Also reports a 4x-oversampled true-peak estimate and the
 * share of clipped samples (|x| >= 0.999). Feed interleaved-per-frame samples in -1..1.
 */
class LoudnessMeter(private val sampleRate: Int, private val channels: Int) {
    private class Biquad(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double) {
        var x1 = 0.0; var x2 = 0.0; var y1 = 0.0; var y2 = 0.0
        fun process(x: Double): Double {
            val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = x; y2 = y1; y1 = y
            return y
        }
    }

    private val shelf = Array(channels) { highShelf(sampleRate.toDouble()) }
    private val highPass = Array(channels) { highPass(sampleRate.toDouble()) }
    private val weights = DoubleArray(channels) { channelWeight(it, channels) }
    private val hop = max(1, sampleRate / 10) // 100 ms
    private val hopEnergies = ArrayList<Double>() // per-hop weighted mean-square sums
    private var hopSum = 0.0
    private var hopCount = 0
    private val oversampler = Array(channels) { TruePeak() }
    private var peak = 0.0
    private var clipped = 0L
    private var samples = 0L

    fun feed(frame: DoubleArray) {
        var weighted = 0.0
        for (c in 0 until min(channels, frame.size)) {
            val x = frame[c]
            samples++
            if (abs(x) >= 0.999) clipped++
            peak = max(peak, oversampler[c].process(x))
            val k = highPass[c].process(shelf[c].process(x))
            weighted += weights[c] * k * k
        }
        hopSum += weighted
        if (++hopCount >= hop) {
            hopEnergies.add(hopSum / hopCount)
            hopSum = 0.0
            hopCount = 0
        }
    }

    /** `{integratedLufs (null when fully gated), truePeakDb (null without samples), clippingPct}`. */
    fun result(): Map<String, Double?> {
        val blocks = ArrayList<Double>()
        for (i in 0..hopEnergies.size - 4) {
            blocks.add((hopEnergies[i] + hopEnergies[i + 1] + hopEnergies[i + 2] + hopEnergies[i + 3]) / 4.0)
        }
        // Clips shorter than one 400 ms block still get a (single-block) measurement.
        if (blocks.isEmpty() && hopEnergies.isNotEmpty()) blocks.add(hopEnergies.average())
        fun lufs(z: Double) = -0.691 + 10 * log10(z)
        val abs = blocks.filter { it > 0 && lufs(it) > -70.0 }
        val integrated = if (abs.isEmpty()) null else {
            val relGate = lufs(abs.average()) - 10.0
            val rel = abs.filter { lufs(it) > relGate }
            if (rel.isEmpty()) null else round2(lufs(rel.average()))
        }
        return mapOf(
            "integratedLufs" to integrated,
            "truePeakDb" to if (samples == 0L) null else round2(20 * log10(max(peak, 1e-10))),
            "clippingPct" to if (samples == 0L) null else round4(clipped * 100.0 / samples),
        )
    }

    /** 4x oversampling (Hann-windowed sinc, 12 taps per phase), keeping the running max |x|. */
    private class TruePeak {
        private val taps = 12
        private val hist = DoubleArray(taps)
        private var pos = 0
        fun process(x: Double): Double {
            hist[pos] = x
            pos = (pos + 1) % taps
            var m = abs(x)
            for (phase in 1 until 4) {
                var acc = 0.0
                for (k in 0 until taps) acc += hist[(pos + k) % taps] * COEFFS[phase][k]
                m = max(m, abs(acc))
            }
            return m
        }

        companion object {
            val COEFFS: Array<DoubleArray> = Array(4) { phase ->
                DoubleArray(12) { k ->
                    // Interpolates between history samples 5 and 6 (oldest = 0) at fraction phase/4.
                    val t = (k - 5).toDouble() - phase / 4.0
                    val sinc = if (t == 0.0) 1.0 else sin(PI * t) / (PI * t)
                    val w = 0.5 + 0.5 * cos(PI * t / 6.0)
                    sinc * w
                }
            }
        }
    }

    companion object {
        /** BS.1770 channel weights: L, R, C = 1, LFE ignored, surrounds 1.41. */
        fun channelWeight(index: Int, channels: Int): Double = when {
            channels <= 3 -> 1.0
            index < 3 -> 1.0
            index == 3 && channels >= 6 -> 0.0
            else -> 1.41
        }

        // Filter parameters from BS.1770 (as generalised in libebur128) so any sample rate works.
        private fun highShelf(fs: Double): Biquad {
            val f0 = 1681.974450955533
            val g = 3.999843853973347
            val q = 0.7071752369554196
            val k = tan(PI * f0 / fs)
            val vh = 10.0.pow(g / 20.0)
            val vb = vh.pow(0.4996667741545416)
            val a0 = 1.0 + k / q + k * k
            return Biquad(
                (vh + vb * k / q + k * k) / a0,
                2.0 * (k * k - vh) / a0,
                (vh - vb * k / q + k * k) / a0,
                2.0 * (k * k - 1.0) / a0,
                (1.0 - k / q + k * k) / a0,
            )
        }

        private fun highPass(fs: Double): Biquad {
            val f0 = 38.13547087602444
            val q = 0.5003270373238773
            val k = tan(PI * f0 / fs)
            val a0 = 1.0 + k / q + k * k
            return Biquad(1.0, -2.0, 1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0)
        }

        private fun round2(v: Double) = Math.round(v * 100) / 100.0
        private fun round4(v: Double) = Math.round(v * 10000) / 10000.0
    }
}

/**
 * Merges per-sample OCR results into spans: consecutive samples with the same (normalised) text
 * extend one span; text shorter than 2 characters is ignored. Span end = last sighting + step.
 */
class OcrSpanMerger(private val stepMs: Long, private val maxSpans: Int = 200, private val maxChars: Int = 300) {
    private data class Open(val start: Long, var last: Long, val text: String, val key: String)

    private val spans = mutableListOf<Map<String, Any>>()
    private var open: Open? = null

    fun feed(tMs: Long, rawText: String) {
        val text = normalise(rawText)
        val key = text.lowercase()
        val o = open
        if (o != null && key == o.key && tMs - o.last <= stepMs * 2) {
            o.last = tMs
            return
        }
        close()
        if (text.length >= 2) open = Open(tMs, tMs, text.take(maxChars), key)
    }

    fun finish(): List<Map<String, Any>> {
        close()
        return spans
    }

    private fun close() {
        val o = open ?: return
        if (spans.size < maxSpans) spans.add(mapOf("startMs" to o.start, "endMs" to o.last + stepMs, "text" to o.text))
        open = null
    }

    companion object {
        fun normalise(s: String): String = s.replace(Regex("\\s+"), " ").trim()
    }
}

/** Downsamples a luma plane (Y of YUV420; any row/pixel stride) to a gridW x gridH IntArray of 0..255. */
object LumaGrid {
    fun sample(
        read: (Int) -> Int,
        width: Int,
        height: Int,
        rowStride: Int,
        pixelStride: Int,
        gridW: Int = 64,
        gridH: Int = 36,
    ): IntArray {
        val out = IntArray(gridW * gridH)
        for (gy in 0 until gridH) {
            val y = ((gy + 0.5) * height / gridH).toInt().coerceIn(0, height - 1)
            for (gx in 0 until gridW) {
                val x = ((gx + 0.5) * width / gridW).toInt().coerceIn(0, width - 1)
                out[gy * gridW + gx] = read(y * rowStride + x * pixelStride) and 0xFF
            }
        }
        return out
    }

    /** RMS helper used by tests. */
    fun rms(values: DoubleArray): Double = sqrt(values.sumOf { it * it } / max(1, values.size))
}
