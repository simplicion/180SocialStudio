package com.workspace180.socialmanager.mediaengine

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

data class CaptionSafeZone(val top: Float, val bottom: Float, val left: Float, val right: Float)

val CAPTION_SAFE_ZONES: Map<String, CaptionSafeZone> = mapOf(
    "tiktok" to CaptionSafeZone(220f, 480f, 60f, 140f),
    "reels" to CaptionSafeZone(270f, 670f, 65f, 120f),
    "shorts" to CaptionSafeZone(240f, 600f, 60f, 140f),
    "none" to CaptionSafeZone(0f, 0f, 0f, 0f),
)

/** One motion setting from the caption style: `enter`/`exit` use [ms] as duration, `loop` as period. */
data class IrTextMotionSpec(val type: String, val ms: Long)

/**
 * CapCut-style text motion (contract `MobileCaptionStyleSchema.enter/exit/loop`). Mirrors `textMotionAt` in
 * lib/features/studio/text_motion.dart line for line so the phone preview and the export move identically.
 */
data class TextMotion(
    val opacity: Double = 1.0,
    /** Offset as a fraction of the frame width / height. */
    val dx: Double = 0.0,
    val dy: Double = 0.0,
    val scale: Double = 1.0,
    val rotationDeg: Double = 0.0,
    /** Fraction of characters shown (typewriter). */
    val reveal: Double = 1.0,
) {
    companion object {
        val NONE = TextMotion()
        val ENTER_TYPES = setOf("fade", "slide_up", "slide_down", "slide_left", "slide_right", "pop", "typewriter", "spring-pop", "scale-down-in", "blur-in", "mask-wipe")
        val EXIT_TYPES = setOf("fade", "slide_up", "slide_down", "slide_left", "slide_right", "pop", "spring-pop", "scale-down-in", "blur-in", "mask-wipe")
        val LOOP_TYPES = setOf("pulse", "wiggle", "bounce", "float")
        private const val SLIDE_Y = 0.08
        private const val SLIDE_X = 0.15

        private fun easeOutCubic(p: Double) = 1 - (1 - p).pow(3)
        private fun easeOutBack(p: Double): Double {
            val c1 = 1.70158
            val c3 = c1 + 1
            return 1 + c3 * (p - 1).pow(3) + c1 * (p - 1).pow(2)
        }

        /**
         * Frame-rate independent damped spring easing (matches caption-style-v2.ts easeAt).
         * Closed-form under-damped, critically damped, and over-damped regimes.
         */
        fun easeSpring(tSec: Double, stiffness: Double = 300.0, damping: Double = 18.0): Double {
            if (tSec <= 0.0) return 0.0
            val w0 = kotlin.math.sqrt(stiffness)
            val zeta = damping / (2.0 * w0)
            return when {
                zeta < 1.0 -> {
                    val wd = w0 * kotlin.math.sqrt(1.0 - zeta * zeta)
                    1.0 - kotlin.math.exp(-zeta * w0 * tSec) * (kotlin.math.cos(wd * tSec) + ((zeta * w0) / wd) * kotlin.math.sin(wd * tSec))
                }
                abs(zeta - 1.0) < 1e-6 -> {
                    1.0 - kotlin.math.exp(-w0 * tSec) * (1.0 + w0 * tSec)
                }
                else -> {
                    val r1 = -w0 * (zeta - kotlin.math.sqrt(zeta * zeta - 1.0))
                    val r2 = -w0 * (zeta + kotlin.math.sqrt(zeta * zeta - 1.0))
                    1.0 - (r2 * kotlin.math.exp(r1 * tSec) - r1 * kotlin.math.exp(r2 * tSec)) / (r2 - r1)
                }
            }
        }

        fun at(enter: IrTextMotionSpec?, exit: IrTextMotionSpec?, loop: IrTextMotionSpec?, startMs: Long, endMs: Long, tMs: Double): TextMotion {
            if (enter == null && exit == null && loop == null) return NONE
            val length = max(1L, endMs - startMs).toDouble()
            val elapsed = (tMs - startMs).coerceIn(0.0, length)
            val remaining = (endMs - tMs).coerceIn(0.0, length)
            val enterMs = if (enter == null) 0.0 else min(enter.ms.toDouble(), (length.toLong() / 2).toDouble())
            val exitMs = if (exit == null) 0.0 else min(exit.ms.toDouble(), length - enterMs)

            var opacity = 1.0
            var dx = 0.0
            var dy = 0.0
            var scale = 1.0
            var rot = 0.0
            var reveal = 1.0

            if (enter != null && enterMs > 0 && elapsed < enterMs) {
                val p = elapsed / enterMs
                val e = easeOutCubic(p)
                when (enter.type) {
                    "fade" -> opacity *= e
                    "slide_up" -> { dy += (1 - e) * SLIDE_Y; opacity *= e }
                    "slide_down" -> { dy -= (1 - e) * SLIDE_Y; opacity *= e }
                    "slide_left" -> { dx += (1 - e) * SLIDE_X; opacity *= e }
                    "slide_right" -> { dx -= (1 - e) * SLIDE_X; opacity *= e }
                    "pop" -> { scale *= 0.6 + 0.4 * easeOutBack(p); opacity *= min(1.0, p * 2) }
                    "spring-pop" -> {
                        val spr = easeSpring(elapsed / 1000.0, stiffness = 320.0, damping = 16.0)
                        scale *= 0.4 + 0.6 * spr
                        opacity *= min(1.0, p * 2.5)
                    }
                    "scale-down-in" -> {
                        val spr = easeSpring(elapsed / 1000.0, stiffness = 300.0, damping = 18.0)
                        scale *= 1.4 - 0.4 * spr
                        opacity *= e
                    }
                    "blur-in" -> {
                        dy += (1 - e) * 0.04
                        opacity *= e
                    }
                    "mask-wipe" -> reveal = e
                    "typewriter" -> reveal = p
                }
            }
            if (exit != null && exitMs > 0 && remaining < exitMs) {
                val q = remaining / exitMs
                val e = easeOutCubic(q)
                when (exit.type) {
                    "fade" -> opacity *= e
                    "slide_up" -> { dy -= (1 - e) * SLIDE_Y; opacity *= e }
                    "slide_down" -> { dy += (1 - e) * SLIDE_Y; opacity *= e }
                    "slide_left" -> { dx -= (1 - e) * SLIDE_X; opacity *= e }
                    "slide_right" -> { dx += (1 - e) * SLIDE_X; opacity *= e }
                    "pop" -> { scale *= 0.6 + 0.4 * e; opacity *= e }
                    "spring-pop" -> { scale *= 0.6 + 0.4 * e; opacity *= e }
                    "scale-down-in" -> { scale *= 1.0 + 0.2 * (1 - e); opacity *= e }
                    "blur-in" -> { opacity *= e; dy -= (1 - e) * 0.04 }
                    "mask-wipe" -> reveal = 1 - e
                }
            }
            if (loop != null && loop.ms > 0) {
                val phase = (elapsed % loop.ms) / loop.ms
                val s = sin(2 * PI * phase)
                when (loop.type) {
                    "pulse" -> scale *= 1 + 0.06 * s
                    "wiggle" -> rot += 4 * s
                    "bounce" -> dy -= 0.02 * abs(s)
                    "float" -> dy += 0.01 * s
                }
            }
            return TextMotion(opacity.coerceIn(0.0, 1.0), dx, dy, scale, rot, reveal.coerceIn(0.0, 1.0))
        }
    }
}
