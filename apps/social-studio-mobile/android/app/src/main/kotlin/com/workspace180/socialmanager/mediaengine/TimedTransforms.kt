package com.workspace180.socialmanager.mediaengine

/**
 * Pure maths of the Phase 6 keyframed fields, shared by the export and the native preview (CompositionFactory).
 * No Android types, so it is unit-tested on the JVM.
 */
object CropPath {
    /**
     * The crop window of [clip] at SOURCE time [sourceMs]: `crop` moved along `cropKeyframes` (linear, held at the
     * ends), clamped so the window stays in the frame. Mirrors `EditIrClip.cropAt` in edit_ir.dart line for line.
     */
    fun at(crop: IrCrop?, keyframes: List<IrCropKeyframe>, sourceMs: Double): IrCrop? {
        val c = crop ?: return null
        if (keyframes.isEmpty()) return c
        val ks = keyframes
        val x: Double
        val y: Double
        if (sourceMs <= ks.first().sourceMs) {
            x = ks.first().x
            y = ks.first().y
        } else if (sourceMs >= ks.last().sourceMs) {
            x = ks.last().x
            y = ks.last().y
        } else {
            var i = 1
            while (ks[i].sourceMs < sourceMs) i++
            val a = ks[i - 1]
            val b = ks[i]
            val t = if (b.sourceMs == a.sourceMs) 0.0 else (sourceMs - a.sourceMs) / (b.sourceMs - a.sourceMs)
            x = a.x + (b.x - a.x) * t
            y = a.y + (b.y - a.y) * t
        }
        return IrCrop(x.coerceIn(0.0, maxOf(0.0, 1 - c.width)), y.coerceIn(0.0, maxOf(0.0, 1 - c.height)), c.width, c.height)
    }

    /**
     * Shift (fractions of the frame) that moves the picture so the window at [sourceMs] lands where the static
     * `crop` window is; the static Crop effect after it then shows the moving window.
     */
    fun shiftAt(crop: IrCrop, keyframes: List<IrCropKeyframe>, sourceMs: Double): Pair<Double, Double> {
        val w = at(crop, keyframes, sourceMs) ?: crop
        return (crop.x - w.x) to (crop.y - w.y)
    }
}

/** Animated text transform (contract style `rotationDeg` / `scale` / `transformKeyframes`). */
data class TextTransform(val rotationDeg: Double, val scale: Double, val positionX: Double, val positionY: Double) {
    companion object {
        /**
         * Transform of a text shown from [startMs] to [endMs] at timeline [tMs]. Keyframe times are ms from the text's
         * start; values interpolate linearly between keyframes and hold the first / last keyframe outside them. A field
         * a keyframe leaves out takes the style's value at that keyframe. Mirrors `textTransformAt` in text_motion.dart.
         */
        fun at(style: IrCaptionStyle, startMs: Long, endMs: Long, tMs: Double): TextTransform {
            val base = TextTransform(style.rotationDeg, style.scale, style.positionX, style.positionY)
            val ks = style.transformKeyframes
            if (ks.isEmpty()) return base
            val length = maxOf(1L, endMs - startMs).toDouble()
            val e = (tMs - startMs).coerceIn(0.0, length)
            fun value(k: IrTextTransformKeyframe) = TextTransform(
                k.rotationDeg ?: base.rotationDeg,
                k.scale ?: base.scale,
                k.positionX ?: base.positionX,
                k.positionY ?: base.positionY,
            )
            if (e <= ks.first().atMs) return value(ks.first())
            if (e >= ks.last().atMs) return value(ks.last())
            var i = 1
            while (ks[i].atMs < e) i++
            val a = value(ks[i - 1])
            val b = value(ks[i])
            val span = (ks[i].atMs - ks[i - 1].atMs).toDouble()
            val p = if (span <= 0) 0.0 else (e - ks[i - 1].atMs) / span
            fun lerp(x: Double, y: Double) = x + (y - x) * p
            return TextTransform(lerp(a.rotationDeg, b.rotationDeg), lerp(a.scale, b.scale), lerp(a.positionX, b.positionX), lerp(a.positionY, b.positionY))
        }
    }
}
