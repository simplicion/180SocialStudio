package com.workspace180.socialmanager.mediaengine

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/** Linear gain for a dB value; anything at or below -60 dB is treated as mute (contract §3.2). */
fun dbToGain(db: Double): Float = if (db <= -60.0) 0f else 10.0.pow(db / 20.0).toFloat()

/**
 * Applies a time-varying gain `gainAtUs(itemTimeUs)` where item time counts from the first sample
 * this processor receives after a flush (i.e. the start of its EditedMediaItem).
 * Supports 16-bit PCM and float PCM, any channel count.
 */
class EnvelopeGainProcessor(private val gainAtUs: (Long) -> Float) : BaseAudioProcessor() {
    private var framesProcessed = 0L

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        return inputAudioFormat
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val remaining = inputBuffer.remaining()
        if (remaining == 0) return
        val fmt = inputAudioFormat
        val channels = fmt.channelCount
        val frames = remaining / fmt.bytesPerFrame
        val out = replaceOutputBuffer(remaining)
        val input = inputBuffer.order(ByteOrder.nativeOrder())
        for (f in 0 until frames) {
            val tUs = (framesProcessed + f) * 1_000_000L / fmt.sampleRate
            val g = gainAtUs(tUs)
            for (ch in 0 until channels) {
                if (fmt.encoding == C.ENCODING_PCM_16BIT) {
                    val s = input.short.toInt()
                    val v = (s * g).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                    out.putShort(v.toShort())
                } else {
                    out.putFloat(input.float * g)
                }
            }
        }
        framesProcessed += frames
        out.flip()
    }

    override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
        framesProcessed = 0
    }

    override fun onReset() {
        framesProcessed = 0
    }
}

/** Smoothstep-free linear ramp helper: 0 before [a], 1 after [b]. */
private fun ramp(t: Double, a: Double, b: Double): Double =
    if (b <= a) (if (t >= a) 1.0 else 0.0) else ((t - a) / (b - a)).coerceIn(0.0, 1.0)

/**
 * Music gain on the *timeline*: base volume x fade in/out x speech ducking (contract §3.6).
 * Ducking ramps down over attackMs before each speech range and back up over releaseMs after it.
 */
class MusicGainModel(
    private val music: IrMusic,
    speechRangesMs: List<LongArray>,
) {
    private val base = dbToGain(music.volumeDb).toDouble()
    private val duckGain = music.duck?.takeIf { it.enabled }?.let { dbToGain(it.duckDb).toDouble() }
    private val ranges = if (duckGain == null) emptyList() else speechRangesMs.sortedBy { it[0] }

    /** Duck depth 0..1 at timeline ms t (1 = fully ducked). */
    fun duckAmount(tMs: Double): Double {
        val duck = music.duck ?: return 0.0
        var amount = 0.0
        for (r in ranges) {
            val s = r[0].toDouble()
            val e = r[1].toDouble()
            if (tMs < s - duck.attackMs) break
            val down = ramp(tMs, s - duck.attackMs, s)
            val up = 1.0 - ramp(tMs, e, e + duck.releaseMs)
            amount = max(amount, min(down, up))
        }
        return amount
    }

    fun gainAtTimelineMs(tMs: Double): Float {
        var g = base
        val start = music.timelineStartMs.toDouble()
        val end = music.timelineEndMs.toDouble()
        if (music.fadeInMs > 0) g *= ramp(tMs, start, start + music.fadeInMs)
        if (music.fadeOutMs > 0) g *= 1.0 - ramp(tMs, end - music.fadeOutMs, end)
        if (duckGain != null) {
            val d = duckAmount(tMs)
            g *= (1.0 - d) + d * duckGain
        }
        return g.toFloat()
    }
}

/**
 * Main-track clip audio gain: originalTrack.volumeDb + clip.volumeDb, plus a short audio fade at
 * transition boundaries (half the transition duration on each side, contract §3.2).
 */
class ClipAudioGainModel(
    private val clipDurationMs: Double,
    volumeDb: Double,
    private val fadeInMs: Double,
    private val fadeOutMs: Double,
) {
    private val base = dbToGain(volumeDb).toDouble()

    fun gainAtItemMs(tMs: Double): Float {
        var g = base
        if (fadeInMs > 0) g *= ramp(tMs, 0.0, fadeInMs)
        if (fadeOutMs > 0) g *= 1.0 - ramp(tMs, clipDurationMs - fadeOutMs, clipDurationMs)
        return g.toFloat()
    }
}

/**
 * "Reduce background noise" for a clip's own sound (contract `voiceCleanup`): an 80 Hz high-pass removes rumble and
 * handling noise, and a downward expander lowers everything that stays near the tracked noise floor (room hiss, hum,
 * fans) by up to 18 dB between words, with smooth gain changes so speech is untouched. 16-bit and float PCM.
 */
class VoiceCleanupProcessor : BaseAudioProcessor() {
    private var hp = DoubleArray(0) // per channel: x1, x2, y1, y2
    private var b0 = 0.0; private var b1 = 0.0; private var b2 = 0.0; private var a1 = 0.0; private var a2 = 0.0
    private var env = 0.0
    private var floor = 1e-4
    private var gain = 1.0
    private var envAtk = 0.0; private var envRel = 0.0; private var gainAtk = 0.0; private var gainRel = 0.0; private var floorRise = 0.0

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        val sr = inputAudioFormat.sampleRate.toDouble()
        // RBJ biquad high-pass at 80 Hz, Q = 0.707 (below the male voice fundamental).
        val w = 2 * Math.PI * 80.0 / sr
        val alpha = Math.sin(w) / (2 * 0.7071)
        val cos = Math.cos(w)
        val a0 = 1 + alpha
        b0 = (1 + cos) / 2 / a0; b1 = -(1 + cos) / a0; b2 = (1 + cos) / 2 / a0
        a1 = -2 * cos / a0; a2 = (1 - alpha) / a0
        fun coef(ms: Double) = Math.exp(-1.0 / (sr * ms / 1000.0))
        envAtk = coef(5.0); envRel = coef(120.0); gainAtk = coef(10.0); gainRel = coef(150.0)
        floorRise = coef(4000.0) // the floor estimate creeps up slowly, drops instantly
        hp = DoubleArray(inputAudioFormat.channelCount * 4)
        return inputAudioFormat
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val remaining = inputBuffer.remaining()
        if (remaining == 0) return
        val fmt = inputAudioFormat
        val channels = fmt.channelCount
        val frames = remaining / fmt.bytesPerFrame
        val out = replaceOutputBuffer(remaining)
        val input = inputBuffer.order(ByteOrder.nativeOrder())
        val pcm16 = fmt.encoding == C.ENCODING_PCM_16BIT
        val frame = DoubleArray(channels)
        for (f in 0 until frames) {
            var peak = 0.0
            for (ch in 0 until channels) {
                val x = if (pcm16) input.short / 32768.0 else input.float.toDouble()
                val i = ch * 4
                val y = b0 * x + b1 * hp[i] + b2 * hp[i + 1] - a1 * hp[i + 2] - a2 * hp[i + 3]
                hp[i + 1] = hp[i]; hp[i] = x; hp[i + 3] = hp[i + 2]; hp[i + 2] = y
                frame[ch] = y
                peak = max(peak, abs(y))
            }
            env = if (peak > env) envAtk * env + (1 - envAtk) * peak else envRel * env + (1 - envRel) * peak
            floor = if (env < floor) env.coerceAtLeast(1e-5) else floorRise * floor + (1 - floorRise) * env
            // Below ~3x the floor (about +10 dB) is treated as noise: expanded down 2:1, at most -18 dB.
            val threshold = floor * 3.0
            val target = if (env >= threshold) 1.0 else max(0.126, (env / threshold))
            gain = if (target < gain) gainAtk * gain + (1 - gainAtk) * target else gainRel * gain + (1 - gainRel) * target
            for (ch in 0 until channels) {
                val v = frame[ch] * gain
                if (pcm16) out.putShort((v * 32768.0).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort())
                else out.putFloat(v.toFloat())
            }
        }
        out.flip()
    }

    override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) = resetState()
    override fun onReset() = resetState()

    private fun resetState() {
        hp.fill(0.0); env = 0.0; floor = 1e-4; gain = 1.0
    }
}

/**
 * Export loudness: a fixed make-up [gainDb] followed by a linked-channel peak limiter (instant attack, ~120 ms
 * release, ceiling [ceilingDb] dBFS, -2 so the AAC-encoded true peak stays under -1 dBTP), so normalising a quiet voice up to platform loudness never clips.
 */
class LoudnessLimiterProcessor(gainDb: Double, ceilingDb: Double = -2.0) : BaseAudioProcessor() {
    private val gain = Math.pow(10.0, gainDb / 20.0).toFloat()
    private val ceiling = Math.pow(10.0, ceilingDb / 20.0).toFloat()
    private var env = 1f
    private var release = 0f

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        // Gain recovers by this factor per sample: back to unity ~120 ms after a peak.
        release = Math.pow(10.0, 1.0 / (0.12 * inputAudioFormat.sampleRate) * Math.log10(1.0 / 0.25)).toFloat()
        return inputAudioFormat
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val remaining = inputBuffer.remaining()
        if (remaining == 0) return
        val fmt = inputAudioFormat
        val channels = fmt.channelCount
        val frames = remaining / fmt.bytesPerFrame
        val pcm16 = fmt.encoding == C.ENCODING_PCM_16BIT
        val input = inputBuffer.order(ByteOrder.nativeOrder())
        val out = replaceOutputBuffer(remaining)
        val frame = FloatArray(channels)
        for (f in 0 until frames) {
            var peak = 0f
            for (ch in 0 until channels) {
                val v = (if (pcm16) input.short / 32768f else input.float) * gain
                frame[ch] = v
                peak = maxOf(peak, kotlin.math.abs(v))
            }
            env = minOf(1f, env * release)
            if (peak * env > ceiling) env = ceiling / peak
            for (ch in 0 until channels) {
                val v = frame[ch] * env
                if (pcm16) out.putShort((v * 32767f).toInt().coerceIn(-32768, 32767).toShort()) else out.putFloat(v)
            }
        }
        out.flip()
    }

    override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
        env = 1f
    }
}
