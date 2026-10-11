package com.workspace180.socialmanager.mediaengine

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.RadialGradient
import android.graphics.Shader
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.CanvasOverlay
import androidx.media3.effect.MatrixTransformation
import androidx.media3.effect.RgbMatrix
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/*
 * Timeline effects (contract VIDEO_EFFECT_TYPES). Applied at the Composition level, so times are output-timeline
 * milliseconds. Formulas are shared with the desktop FFmpeg renderer (same envelopes), so both look alike.
 */

/** Types this renderer draws; anything else is skipped with a warning. */
val SUPPORTED_EFFECTS = setOf("flash", "fade_black", "shake", "zoom_pulse", "black_white", "vignette")

/** 0..1 progress through [e] at time [t] (ms), or null when inactive. */
internal fun progress(e: IrEffect, t: Double): Double? =
    if (t < e.startMs || t >= e.endMs || e.endMs <= e.startMs) null else (t - e.startMs) / (e.endMs - e.startMs)

/** Linear ramp in/out of [rampMs] (capped at a third of the effect) used by hold-type effects. */
internal fun holdEnvelope(e: IrEffect, t: Double, rampMs: Double = 150.0): Double {
    val len = (e.endMs - e.startMs).toDouble()
    val r = min(rampMs, len / 3.0).coerceAtLeast(1.0)
    return min(1.0, min((t - e.startMs) / r, (e.endMs - t) / r)).coerceIn(0.0, 1.0)
}

/** Flash: fast attack (first 20%), linear decay. Returns how far towards white (0..1). */
internal fun flashAmount(e: IrEffect, p: Double): Double =
    e.intensity * (if (p < 0.2) p / 0.2 else 1.0 - (p - 0.2) / 0.8)

/** Dip to black: triangle peaking mid-range; intensity 1 = fully black at the midpoint. */
internal fun fadeBlackAmount(e: IrEffect, p: Double): Double = (1.0 - abs(2 * p - 1)) * (0.4 + 0.6 * e.intensity)

internal fun shakeOffset(e: IrEffect, t: Double): Pair<Double, Double> {
    val amp = 0.015 + 0.035 * e.intensity // NDC units (frame is 2 wide)
    return Pair(amp * sin(t * 0.091) * sin(t * 0.023 + 1.3), amp * sin(t * 0.077 + 0.7) * sin(t * 0.031))
}

internal fun zoomPulseScale(e: IrEffect, p: Double): Double = 1.0 + (0.06 + 0.14 * e.intensity) * sin(PI * p)

/** Shake and zoom pulse. Shake scales up slightly so the moved frame never shows its edges. */
@UnstableApi
class EffectsTransformation(private val effects: List<IrEffect>) : MatrixTransformation {
    private val active = effects.filter { it.type == "shake" || it.type == "zoom_pulse" }

    override fun getMatrix(presentationTimeUs: Long): Matrix {
        val m = Matrix()
        val t = presentationTimeUs / 1000.0
        for (e in active) {
            val p = progress(e, t) ?: continue
            when (e.type) {
                "zoom_pulse" -> {
                    val s = zoomPulseScale(e, p).toFloat()
                    m.postScale(s, s)
                }
                "shake" -> {
                    val (dx, dy) = shakeOffset(e, t)
                    val env = holdEnvelope(e, t, 60.0)
                    val cover = (1.0 + 2 * (0.015 + 0.035 * e.intensity)).toFloat()
                    m.postScale(cover, cover)
                    m.postTranslate((dx * env).toFloat(), (dy * env).toFloat())
                }
            }
        }
        return m
    }

    override fun isNoOp(inputWidth: Int, inputHeight: Int): Boolean = active.isEmpty()
}

/** Flash, dip to black and black & white as one colour matrix (column-major 4x4 on RGBA). */
@UnstableApi
class EffectsColor(private val effects: List<IrEffect>) : RgbMatrix {
    private val active = effects.filter { it.type == "flash" || it.type == "fade_black" || it.type == "black_white" }

    override fun getMatrix(presentationTimeUs: Long, useHdr: Boolean): FloatArray {
        val t = presentationTimeUs / 1000.0
        var m = identity()
        for (e in active) {
            val p = progress(e, t) ?: continue
            val step = when (e.type) {
                "black_white" -> desaturate(min(1.0, 0.5 + 0.5 * e.intensity) * holdEnvelope(e, t))
                "flash" -> towardsWhite(flashAmount(e, p))
                else -> darken(fadeBlackAmount(e, p))
            }
            m = multiply(step, m)
        }
        return m
    }

    override fun isNoOp(inputWidth: Int, inputHeight: Int): Boolean = active.isEmpty()

    companion object {
        fun identity() = floatArrayOf(1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f)

        /** out = c * (1-k) + k (per RGB channel). */
        fun towardsWhite(k: Double): FloatArray {
            val s = (1 - k).toFloat()
            val o = k.toFloat()
            return floatArrayOf(s, 0f, 0f, 0f, 0f, s, 0f, 0f, 0f, 0f, s, 0f, o, o, o, 1f)
        }

        fun darken(k: Double): FloatArray {
            val s = (1 - k).toFloat()
            return floatArrayOf(s, 0f, 0f, 0f, 0f, s, 0f, 0f, 0f, 0f, s, 0f, 0f, 0f, 0f, 1f)
        }

        /** Blend between identity (k=0) and Rec.709 luma (k=1). */
        fun desaturate(k: Double): FloatArray {
            val r = 0.2126
            val g = 0.7152
            val b = 0.0722
            fun v(lum: Double, same: Boolean) = ((1 - k) * (if (same) 1.0 else 0.0) + k * lum).toFloat()
            // Column j = contribution of input channel j to (R,G,B,A).
            return floatArrayOf(
                v(r, true), v(r, false), v(r, false), 0f,
                v(g, false), v(g, true), v(g, false), 0f,
                v(b, false), v(b, false), v(b, true), 0f,
                0f, 0f, 0f, 1f,
            )
        }

        /** a·b for column-major 4x4 matrices. */
        fun multiply(a: FloatArray, b: FloatArray): FloatArray {
            val out = FloatArray(16)
            for (col in 0 until 4) for (row in 0 until 4) {
                var s = 0f
                for (k in 0 until 4) s += a[k * 4 + row] * b[col * 4 + k]
                out[col * 4 + row] = s
            }
            return out
        }
    }
}

/** Vignette: radial darkening of the edges while active. */
@UnstableApi
class VignetteOverlay(effects: List<IrEffect>) : CanvasOverlay(/* useInputFrameSize= */ true) {
    private val active = effects.filter { it.type == "vignette" }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var shaderFor = Pair(0, 0)

    override fun onDraw(canvas: Canvas, presentationTimeUs: Long) {
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
        val t = presentationTimeUs / 1000.0
        var alpha = 0.0
        for (e in active) {
            if (progress(e, t) == null) continue
            alpha = max(alpha, (0.35 + 0.5 * e.intensity) * holdEnvelope(e, t))
        }
        if (alpha <= 0.0) return
        val w = canvas.width
        val h = canvas.height
        if (shaderFor != Pair(w, h)) {
            val radius = hypot(w / 2.0, h / 2.0).toFloat()
            paint.shader = RadialGradient(
                w / 2f, h / 2f, radius,
                intArrayOf(Color.TRANSPARENT, Color.TRANSPARENT, Color.BLACK),
                floatArrayOf(0f, 0.55f, 1f),
                Shader.TileMode.CLAMP,
            )
            shaderFor = Pair(w, h)
        }
        paint.alpha = (alpha.coerceIn(0.0, 1.0) * 255).toInt()
        canvas.drawRect(0f, 0f, w.toFloat(), h.toFloat(), paint)
    }
}
