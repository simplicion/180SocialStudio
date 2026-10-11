package com.workspace180.socialmanager.mediaengine

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

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
        val ENTER_TYPES = setOf("fade", "slide_up", "slide_down", "slide_left", "slide_right", "pop", "typewriter")
        val EXIT_TYPES = setOf("fade", "slide_up", "slide_down", "slide_left", "slide_right", "pop")
        val LOOP_TYPES = setOf("pulse", "wiggle", "bounce", "float")
        private const val SLIDE_Y = 0.08
        private const val SLIDE_X = 0.15

        private fun easeOutCubic(p: Double) = 1 - (1 - p).pow(3)
        private fun easeOutBack(p: Double): Double {
            val c1 = 1.70158
            val c3 = c1 + 1
            return 1 + c3 * (p - 1).pow(3) + c1 * (p - 1).pow(2)
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
