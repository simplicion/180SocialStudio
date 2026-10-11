package com.workspace180.socialmanager.mediaengine

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.RadialGradient
import android.graphics.Shader
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.CanvasOverlay
import androidx.media3.effect.RgbMatrix
import kotlin.math.hypot
import kotlin.math.pow

/**
 * Clip colour grade as ONE affine colour matrix, mirrored by `gradeMatrix` in lib/core/native_engine/color_grade.dart
 * (the phone preview's ColorFilter.matrix), so the preview and the export match. Steps, applied in order:
 * preset → exposure → contrast → saturation → temperature / tint → brightness. Values are 0..1 colour units.
 */
object ColorGrade {
    /** Row-major 3x4 affine: r' = m[0]r + m[1]g + m[2]b + m[3], etc. */
    private class Affine(val m: DoubleArray) {
        /** This step applied after [first]. */
        fun after(first: Affine): Affine {
            val out = DoubleArray(12)
            for (r in 0 until 3) {
                for (c in 0 until 3) out[r * 4 + c] = (0 until 3).sumOf { k -> m[r * 4 + k] * first.m[k * 4 + c] }
                out[r * 4 + 3] = (0 until 3).sumOf { k -> m[r * 4 + k] * first.m[k * 4 + 3] } + m[r * 4 + 3]
            }
            return Affine(out)
        }
    }

    private const val LR = 0.2126
    private const val LG = 0.7152
    private const val LB = 0.0722
    val PRESETS = setOf("NORMAL", "NOIR_BW", "VIVID", "CINEMATIC_TEAL_ORANGE", "VINTAGE_WARM", "CYBER_NEON", "GLOW")

    private fun diag(r: Double, g: Double, b: Double, off: Double = 0.0) =
        Affine(doubleArrayOf(r, 0.0, 0.0, off, 0.0, g, 0.0, off, 0.0, 0.0, b, off))

    private fun saturation(s: Double): Affine {
        val a = DoubleArray(12)
        val l = doubleArrayOf(LR, LG, LB)
        for (r in 0 until 3) for (c in 0 until 3) a[r * 4 + c] = (1 - s) * l[c] + if (r == c) s else 0.0
        return Affine(a)
    }

    private fun preset(p: String): Affine = when (p) {
        "NOIR_BW" -> saturation(0.0)
        "VIVID" -> saturation(1.25)
        "CINEMATIC_TEAL_ORANGE" -> diag(1.08, 1.0, 0.92)
        "VINTAGE_WARM" -> diag(1.1, 1.02, 0.85)
        "CYBER_NEON" -> diag(1.05, 0.9, 1.15)
        "GLOW" -> diag(1.0, 1.0, 1.0, 0.06)
        else -> diag(1.0, 1.0, 1.0)
    }

    private fun affine(f: IrFilter): Affine {
        var a = preset(f.preset)
        if (f.exposure != 0.0) a = diag(2.0.pow(f.exposure), 2.0.pow(f.exposure), 2.0.pow(f.exposure)).after(a)
        if (f.contrast != 1.0) a = diag(f.contrast, f.contrast, f.contrast, 0.5 * (1 - f.contrast)).after(a)
        if (f.saturation != 1.0) a = saturation(f.saturation).after(a)
        if (f.temperature != 0.0 || f.tint != 0.0) {
            a = diag(1 + 0.12 * f.temperature + 0.05 * f.tint, 1 - 0.1 * f.tint, 1 - 0.12 * f.temperature + 0.05 * f.tint).after(a)
        }
        if (f.brightness != 1.0) a = diag(1.0, 1.0, 1.0, 0.5 * (f.brightness - 1)).after(a)
        return a
    }

    /** True when the grade changes colours at all. */
    fun isIdentity(f: IrFilter): Boolean {
        val m = affine(f).m
        val id = doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0)
        return m.indices.all { kotlin.math.abs(m[it] - id[it]) < 1e-6 }
    }

    /** Column-major 4x4 for Media3 (`uRgbMatrix * vec4(rgb, 1)`): offsets in the last column. */
    fun glMatrix(f: IrFilter): FloatArray {
        val m = affine(f).m
        val out = FloatArray(16)
        for (r in 0 until 3) for (c in 0 until 4) out[c * 4 + r] = m[r * 4 + c].toFloat()
        out[15] = 1f
        return out
    }

    @UnstableApi
    fun effect(f: IrFilter): RgbMatrix {
        val matrix = glMatrix(f)
        return RgbMatrix { _, _ -> matrix }
    }
}

/**
 * Static clip vignette (filter.vignette 0..1): edge darkening with the same gradient as the timed vignette effect.
 * Mirrored by `ClipVignette` in the phone preview.
 */
@UnstableApi
class ClipVignetteOverlay(private val strength: Double) : CanvasOverlay(/* useInputFrameSize= */ true) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var shaderFor = Pair(0, 0)

    override fun onDraw(canvas: Canvas, presentationTimeUs: Long) {
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
        val w = canvas.width
        val h = canvas.height
        if (shaderFor != Pair(w, h)) {
            paint.shader = RadialGradient(
                w / 2f, h / 2f, hypot(w / 2.0, h / 2.0).toFloat(),
                intArrayOf(Color.TRANSPARENT, Color.TRANSPARENT, Color.BLACK),
                floatArrayOf(0f, 0.55f, 1f),
                Shader.TileMode.CLAMP,
            )
            shaderFor = Pair(w, h)
        }
        paint.alpha = (strength.coerceIn(0.0, 1.0) * 0.85 * 255).toInt()
        canvas.drawRect(0f, 0f, w.toFloat(), h.toFloat(), paint)
    }
}
