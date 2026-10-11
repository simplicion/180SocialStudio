package com.workspace180.socialmanager.mediaengine

import org.json.JSONObject

/** Keyframe of an overlay layer; time relative to the overlay start. Null = the property is not keyed here. */
data class IrLayerKeyframe(
    val atMs: Long,
    val x: Double? = null,
    val y: Double? = null,
    val scale: Double? = null,
    val rotation: Double? = null,
    val opacity: Double? = null,
)

/**
 * Overlay layer (contract `OverlayLayerSchema`): `overlay` mode is composited above the main video (PiP, sticker,
 * layered B-roll); `cutaway` replaces the main picture. x / y are the layer centre as canvas fractions from the
 * top-left; scale is relative to the largest size of the media that fits the canvas; rotation is clockwise degrees.
 */
data class IrLayer(
    val mode: String,
    val x: Double,
    val y: Double,
    val scale: Double,
    val rotation: Double,
    val keyframes: List<IrLayerKeyframe>,
) {
    val isOverlay: Boolean get() = mode == "overlay"

    companion object {
        fun parse(o: JSONObject?): IrLayer? {
            if (o == null) return null
            fun d(j: JSONObject, k: String): Double? = if (j.has(k) && !j.isNull(k)) j.optDouble(k).takeIf { it.isFinite() } else null
            val kfs = o.optJSONArray("keyframes")
            val keyframes = buildList {
                if (kfs != null) for (i in 0 until kfs.length()) {
                    val k = kfs.optJSONObject(i) ?: continue
                    add(IrLayerKeyframe(k.optLong("atMs", 0L).coerceAtLeast(0L), d(k, "x"), d(k, "y"), d(k, "scale"), d(k, "rotation"), d(k, "opacity")))
                }
            }.sortedBy { it.atMs }
            return IrLayer(
                mode = if (o.optString("mode") == "cutaway") "cutaway" else "overlay",
                x = (d(o, "x") ?: 0.5).coerceIn(-0.5, 1.5),
                y = (d(o, "y") ?: 0.5).coerceIn(-0.5, 1.5),
                scale = (d(o, "scale") ?: 1.0).coerceIn(0.05, 3.0),
                rotation = (d(o, "rotation") ?: 0.0).coerceIn(-720.0, 720.0),
                keyframes = keyframes,
            )
        }
    }
}

data class LayerPose(val x: Double, val y: Double, val scale: Double, val rotation: Double, val opacity: Double)

/** Mirrors `layerAt` in lib/core/native_engine/overlay_layer.dart: linear interpolation per keyed property. */
object LayerMotion {
    fun at(layer: IrLayer, relMs: Double, baseOpacity: Double): LayerPose {
        fun prop(base: Double, pick: (IrLayerKeyframe) -> Double?): Double {
            val ks = layer.keyframes.filter { pick(it) != null }
            if (ks.isEmpty()) return base
            if (relMs <= ks.first().atMs) return pick(ks.first())!!
            if (relMs >= ks.last().atMs) return pick(ks.last())!!
            for (i in 0 until ks.size - 1) {
                val a = ks[i]
                val b = ks[i + 1]
                if (relMs >= a.atMs && relMs <= b.atMs) {
                    val span = maxOf(1L, b.atMs - a.atMs).toDouble()
                    val t = (relMs - a.atMs) / span
                    return pick(a)!! + (pick(b)!! - pick(a)!!) * t
                }
            }
            return base
        }
        return LayerPose(
            prop(layer.x) { it.x },
            prop(layer.y) { it.y },
            prop(layer.scale) { it.scale }.coerceIn(0.05, 3.0),
            prop(layer.rotation) { it.rotation },
            prop(baseOpacity) { it.opacity }.coerceIn(0.0, 1.0),
        )
    }

    /** Largest box with [aspect] (w/h) inside the canvas: the layer size at scale 1. */
    fun baseSize(canvasW: Int, canvasH: Int, aspect: Double): Pair<Int, Int> {
        val a = if (aspect.isFinite() && aspect > 0) aspect else canvasW.toDouble() / canvasH
        val w = canvasW.toDouble()
        val h = w / a
        val (bw, bh) = if (h <= canvasH) w to h else canvasH * a to canvasH.toDouble()
        // Even sizes keep encoders and GL happy.
        return (bw.toInt() / 2 * 2).coerceAtLeast(2) to (bh.toInt() / 2 * 2).coerceAtLeast(2)
    }
}
