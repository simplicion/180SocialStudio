package com.workspace180.socialmanager.mediaengine

import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * Typed model of the `mobile-editir/1` timeline returned by the AI Director
 * (docs/social-studio-mobile/AI_DIRECTOR_CONTRACT.md §3). All times are integer milliseconds.
 *
 * Parsing is strict: anything the renderer cannot honour raises [EditIrException] instead of
 * being silently dropped.
 */
class EditIrException(val code: String, message: String) : Exception(message)

data class IrCanvas(val aspect: String, val width: Int, val height: Int, val fps: Double, val background: Int)

data class IrCrop(val x: Double, val y: Double, val width: Double, val height: Double)

/** Colour grade (contract MobileFilterSchema); exposure in stops, temperature / tint -1..1, vignette 0..1. */
data class IrFilter(
    val preset: String,
    val brightness: Double,
    val contrast: Double,
    val saturation: Double,
    val exposure: Double = 0.0,
    val temperature: Double = 0.0,
    val tint: Double = 0.0,
    val vignette: Double = 0.0,
)

data class IrTransition(val type: String, val durationMs: Long)

data class IrClip(
    val id: String,
    val assetId: String,
    val sourceStartMs: Long,
    val sourceEndMs: Long,
    val timelineStartMs: Long,
    val timelineEndMs: Long,
    val speed: Double,
    val volumeDb: Double,
    val crop: IrCrop?,
    val filter: IrFilter?,
    val transitionIn: IrTransition?,
    /** Clockwise rotation applied to the source picture before [crop]: 0, 90, 180 or 270. */
    val rotationDeg: Int = 0,
    /** Mirror the (rotated) picture left-right, before [crop]. */
    val flipH: Boolean = false,
    /** Fade of the clip's own sound at its start / end (contract `audioFadeInMs` / `audioFadeOutMs`). */
    val audioFadeInMs: Long = 0,
    val audioFadeOutMs: Long = 0,
    /** "Reduce background noise" on the clip's own sound. */
    val voiceCleanup: Boolean = false,
)

data class IrOverlay(
    val id: String,
    val kind: String,
    val timelineStartMs: Long,
    val timelineEndMs: Long,
    val sourceStartMs: Long,
    val opacity: Double,
    val muted: Boolean,
    /** "video" or "image" (a still photo held for the slot). */
    val mediaType: String = "video",
    /** "cover" crops to fill; "contain" keeps the whole frame (cutaways only; layers always keep their shape). */
    val fit: String = "cover",
    /** Layer placement; null or cutaway = full-frame cutaway. */
    val layer: IrLayer? = null,
    /** Green / blue screen key (layers only). */
    val chromaKey: IrChromaKey? = null,
    /** Circle / rounded-corner mask (layers only). */
    val mask: IrMask? = null,
) {
    val isImage: Boolean get() = mediaType == "image"
    val isLayer: Boolean get() = layer?.isOverlay == true
}

/** Timeline effect (contract VIDEO_EFFECT_TYPES), drawn over the whole frame for [startMs, endMs). */
data class IrEffect(
    val id: String,
    val type: String,
    val startMs: Long,
    val endMs: Long,
    val intensity: Double,
)

data class IrWord(
    val text: String,
    val startMs: Long,
    val endMs: Long,
    val highlight: Boolean,
    val color: Int?,
    val scale: Double,
)

data class IrCaptionBackground(val color: Int, val paddingPx: Double, val radiusPx: Double)

data class IrCaptionStyle(
    val preset: String,
    val animation: String,
    val fontFamily: String,
    val fontWeight: Int,
    val fontSizePx: Double,
    val textColor: Int,
    val highlightColor: Int,
    val strokeColor: Int,
    val strokeWidthPx: Double,
    val shadow: Boolean,
    val background: IrCaptionBackground?,
    val uppercase: Boolean,
    val positionX: Double,
    val positionY: Double,
    val maxWidthFraction: Double,
    /** Optional: neon glow in the highlight colour. */
    val glow: Boolean = false,
    /** Optional text motion (see TextMotion.kt). */
    val enter: IrTextMotionSpec? = null,
    val exit: IrTextMotionSpec? = null,
    val loop: IrTextMotionSpec? = null,
)

data class IrCaption(
    val id: String,
    val kind: String,
    val startMs: Long,
    val endMs: Long,
    val text: String,
    val words: List<IrWord>,
    val style: IrCaptionStyle,
)

data class IrZoom(
    val id: String,
    val startMs: Long,
    val endMs: Long,
    val scale: Double,
    val centerX: Double,
    val centerY: Double,
    val rampMs: Long,
)

data class IrDuck(val enabled: Boolean, val duckDb: Double, val attackMs: Long, val releaseMs: Long)

data class IrMusic(
    val id: String,
    val timelineStartMs: Long,
    val timelineEndMs: Long,
    val sourceStartMs: Long,
    val volumeDb: Double,
    val fadeInMs: Long,
    val fadeOutMs: Long,
    val duck: IrDuck?,
)

/** Brand logo drawn over the whole output (contract §3.9). The image itself is a local file in RenderMedia. */
data class IrWatermark(
    val imageUrl: String,
    /** top_left | top_right | bottom_left | bottom_right */
    val position: String,
    /** 0..100 */
    val opacityPct: Double,
    /** Logo width as a fraction of the canvas width. */
    val widthFraction: Double,
    val x: Double? = null,
    val y: Double? = null,
    val width: Double? = null,
    val height: Double? = null,
)

/** One-shot sound effect on the timeline (contract §3.6 `audio.sfx`). */
data class IrSfx(
    val id: String,
    val timelineStartMs: Long,
    /** Null = play the whole file (clipped at the timeline end). */
    val durationMs: Long?,
    val volumeDb: Double,
)

/** Voiceover recorded on the phone (contract MobileVoiceoverSchema); the file is the local asset [assetId]. */
data class IrVoiceover(
    val id: String,
    val timelineStartMs: Long,
    val durationMs: Long,
    val sourceStartMs: Long,
    val assetId: String,
    val volumeDb: Double,
    val fadeInMs: Long,
    val fadeOutMs: Long,
)

data class IrAudio(
    val originalVolumeDb: Double,
    val music: List<IrMusic>,
    val speechRangesMs: List<LongArray>,
    val sfx: List<IrSfx> = emptyList(),
    val voiceovers: List<IrVoiceover> = emptyList(),
) {
    /** Where music ducks: speech in the footage plus every voiceover. */
    val duckRangesMs: List<LongArray>
        get() = speechRangesMs + voiceovers.map { longArrayOf(it.timelineStartMs, it.timelineStartMs + it.durationMs) }
}

data class MobileEditIr(
    val schemaVersion: String,
    val projectId: String,
    val canvas: IrCanvas,
    val durationMs: Long,
    val clips: List<IrClip>,
    val overlays: List<IrOverlay>,
    val captions: List<IrCaption>,
    val zooms: List<IrZoom>,
    val audio: IrAudio,
    val watermark: IrWatermark? = null,
    val effects: List<IrEffect> = emptyList(),
) {
    companion object {
        const val SCHEMA_VERSION = "mobile-editir/1"
        private val ASPECTS = setOf("16:9", "9:16", "1:1", "4:5")
        val WATERMARK_POSITIONS = setOf("top_left", "top_right", "bottom_left", "bottom_right")

        fun parse(json: String): MobileEditIr {
            val root = try {
                JSONObject(json)
            } catch (e: Exception) {
                throw EditIrException("INVALID_EDIT_IR", "editIR is not valid JSON: ${e.message}")
            }
            return fromJson(root).also { it.validate() }
        }

        private fun fromJson(o: JSONObject): MobileEditIr {
            val schema = o.req<String>("schemaVersion")
            if (schema != SCHEMA_VERSION) {
                throw EditIrException("UNSUPPORTED_SCHEMA", "schemaVersion '$schema' is not supported (expected $SCHEMA_VERSION)")
            }
            val c = o.getJSONObject("canvas")
            val canvas = IrCanvas(
                aspect = c.req("aspect"),
                width = c.getInt("width"),
                height = c.getInt("height"),
                fps = c.optDouble("fps", 30.0),
                background = parseColor(c.optNullableString("background") ?: "#000000"),
            )
            val clips = o.getJSONArray("clips").objects().map { j ->
                IrClip(
                    id = j.req("id"),
                    assetId = j.req("assetId"),
                    sourceStartMs = j.getLong("sourceStartMs"),
                    sourceEndMs = j.getLong("sourceEndMs"),
                    timelineStartMs = j.getLong("timelineStartMs"),
                    timelineEndMs = j.getLong("timelineEndMs"),
                    speed = j.optDouble("speed", 1.0),
                    volumeDb = j.optDouble("volumeDb", 0.0),
                    crop = j.optNullableObject("crop")?.let {
                        IrCrop(it.getDouble("x"), it.getDouble("y"), it.getDouble("width"), it.getDouble("height"))
                    },
                    filter = j.optNullableObject("filter")?.let {
                        IrFilter(
                            preset = it.optNullableString("preset") ?: "NORMAL",
                            brightness = it.optDouble("brightness", 1.0),
                            contrast = it.optDouble("contrast", 1.0),
                            saturation = it.optDouble("saturation", 1.0),
                            exposure = it.optDouble("exposure", 0.0).coerceIn(-2.0, 2.0),
                            temperature = it.optDouble("temperature", 0.0).coerceIn(-1.0, 1.0),
                            tint = it.optDouble("tint", 0.0).coerceIn(-1.0, 1.0),
                            vignette = it.optDouble("vignette", 0.0).coerceIn(0.0, 1.0),
                        )
                    },
                    transitionIn = j.optNullableObject("transitionIn")?.let {
                        IrTransition(it.optNullableString("type") ?: "CROSSFADE", it.getLong("durationMs"))
                    },
                    rotationDeg = if (j.has("rotationDeg") && !j.isNull("rotationDeg")) j.getInt("rotationDeg") else 0,
                    flipH = j.optBoolean("flipH", false),
                    audioFadeInMs = j.optLong("audioFadeInMs", 0L).coerceAtLeast(0L),
                    audioFadeOutMs = j.optLong("audioFadeOutMs", 0L).coerceAtLeast(0L),
                    voiceCleanup = j.optBoolean("voiceCleanup", false),
                )
            }
            val overlays = (o.optJSONArray("overlays") ?: JSONArray()).objects().map { j ->
                IrOverlay(
                    id = j.req("id"),
                    kind = j.optNullableString("kind") ?: "broll",
                    timelineStartMs = j.getLong("timelineStartMs"),
                    timelineEndMs = j.getLong("timelineEndMs"),
                    sourceStartMs = j.optLong("sourceStartMs", 0L),
                    opacity = j.optDouble("opacity", 1.0),
                    muted = j.optBoolean("muted", true),
                    mediaType = if (j.optNullableString("mediaType") == "image") "image" else "video",
                    fit = if (j.optNullableString("fit") == "contain") "contain" else "cover",
                    layer = IrLayer.parse(j.optNullableObject("layer")),
                    chromaKey = IrChromaKey.parse(j.optNullableObject("chromaKey")),
                    mask = IrMask.parse(j.optNullableObject("mask")),
                )
            }
            val effects = (o.optJSONArray("effects") ?: JSONArray()).objects().map { j ->
                IrEffect(
                    id = j.req("id"),
                    type = j.req("type"),
                    startMs = j.getLong("startMs"),
                    endMs = j.getLong("endMs"),
                    intensity = j.optDouble("intensity", 0.6).coerceIn(0.0, 1.0),
                )
            }
            val captions = (o.optJSONArray("captions") ?: JSONArray()).objects().map { j ->
                val s = j.optJSONObject("style") ?: JSONObject()
                val textColor = parseColor(s.optNullableString("textColor") ?: "#FFFFFF")
                val highlight = parseColor(s.optNullableString("highlightColor") ?: "#FFE600")
                IrCaption(
                    id = j.req("id"),
                    kind = j.optNullableString("kind") ?: "caption",
                    startMs = j.getLong("startMs"),
                    endMs = j.getLong("endMs"),
                    text = j.optString("text", ""),
                    words = (j.optJSONArray("words") ?: JSONArray()).objects().map { w ->
                        IrWord(
                            text = w.req("text"),
                            startMs = w.getLong("startMs"),
                            endMs = w.getLong("endMs"),
                            highlight = w.optBoolean("highlight", false),
                            color = w.optNullableString("color")?.let(::parseColor),
                            scale = w.optDouble("scale", 1.0),
                        )
                    },
                    style = IrCaptionStyle(
                        preset = s.optNullableString("preset") ?: "HORMOZI_BOUNCE",
                        animation = s.optNullableString("animation") ?: "word_pop",
                        fontFamily = s.optNullableString("fontFamily") ?: "Inter",
                        fontWeight = s.optInt("fontWeight", 800),
                        fontSizePx = s.optDouble("fontSizePx", 72.0),
                        textColor = textColor,
                        highlightColor = highlight,
                        strokeColor = parseColor(s.optNullableString("strokeColor") ?: "#000000"),
                        strokeWidthPx = s.optDouble("strokeWidthPx", 0.0),
                        shadow = s.optBoolean("shadow", true),
                        background = s.optNullableObject("background")?.let {
                            IrCaptionBackground(
                                parseColor(it.optNullableString("color") ?: "#000000B3"),
                                it.optDouble("paddingPx", 16.0),
                                it.optDouble("radiusPx", 16.0),
                            )
                        },
                        uppercase = s.optBoolean("uppercase", false),
                        positionX = s.optDouble("positionX", 0.5),
                        positionY = s.optDouble("positionY", 0.72),
                        maxWidthFraction = s.optDouble("maxWidthFraction", 0.86),
                        glow = s.optBoolean("glow", false),
                        enter = s.optNullableObject("enter")?.motion("durationMs", TextMotion.ENTER_TYPES),
                        exit = s.optNullableObject("exit")?.motion("durationMs", TextMotion.EXIT_TYPES),
                        loop = s.optNullableObject("loop")?.motion("periodMs", TextMotion.LOOP_TYPES),
                    ),
                )
            }
            val zooms = (o.optJSONArray("zooms") ?: JSONArray()).objects().map { j ->
                IrZoom(
                    id = j.req("id"),
                    startMs = j.getLong("startMs"),
                    endMs = j.getLong("endMs"),
                    scale = j.optDouble("scale", 1.3),
                    centerX = j.optDouble("centerX", 0.5),
                    centerY = j.optDouble("centerY", 0.5),
                    rampMs = j.optLong("rampMs", 250L),
                )
            }
            val a = o.optJSONObject("audio") ?: JSONObject()
            val audio = IrAudio(
                voiceovers = (a.optJSONArray("voiceovers") ?: JSONArray()).objects().map { j ->
                    IrVoiceover(
                        id = j.req("id"),
                        timelineStartMs = j.getLong("timelineStartMs").coerceAtLeast(0L),
                        durationMs = j.getLong("durationMs").coerceAtLeast(0L),
                        sourceStartMs = j.optLong("sourceStartMs", 0L).coerceAtLeast(0L),
                        assetId = j.getJSONObject("source").getString("assetId"),
                        volumeDb = j.optDouble("volumeDb", 0.0),
                        fadeInMs = j.optLong("fadeInMs", 0L).coerceAtLeast(0L),
                        fadeOutMs = j.optLong("fadeOutMs", 0L).coerceAtLeast(0L),
                    )
                },
                sfx = (a.optJSONArray("sfx") ?: JSONArray()).objects().map { j ->
                    IrSfx(
                        id = j.req("id"),
                        timelineStartMs = j.getLong("timelineStartMs"),
                        durationMs = if (j.has("durationMs") && !j.isNull("durationMs")) j.getLong("durationMs") else null,
                        volumeDb = j.optDouble("volumeDb", -12.0),
                    )
                },
                originalVolumeDb = a.optJSONObject("originalTrack")?.optDouble("volumeDb", 0.0) ?: 0.0,
                music = (a.optJSONArray("music") ?: JSONArray()).objects().map { j ->
                    IrMusic(
                        id = j.req("id"),
                        timelineStartMs = j.getLong("timelineStartMs"),
                        timelineEndMs = j.getLong("timelineEndMs"),
                        sourceStartMs = j.optLong("sourceStartMs", 0L),
                        volumeDb = j.optDouble("volumeDb", 0.0),
                        fadeInMs = j.optLong("fadeInMs", 0L),
                        fadeOutMs = j.optLong("fadeOutMs", 0L),
                        duck = j.optNullableObject("duck")?.let {
                            IrDuck(
                                it.optBoolean("enabled", false),
                                it.optDouble("duckDb", -12.0),
                                it.optLong("attackMs", 120L),
                                it.optLong("releaseMs", 350L),
                            )
                        },
                    )
                },
                speechRangesMs = (a.optJSONArray("speechRangesMs") ?: JSONArray()).let { arr ->
                    (0 until arr.length()).map { i ->
                        val r = arr.getJSONArray(i)
                        longArrayOf(r.getLong(0), r.getLong(1))
                    }
                },
            )
            return MobileEditIr(
                schemaVersion = schema,
                projectId = o.optString("projectId", ""),
                canvas = canvas,
                durationMs = o.getLong("durationMs"),
                clips = clips,
                overlays = overlays,
                captions = captions,
                zooms = zooms,
                audio = audio,
                effects = effects,
                watermark = o.optNullableObject("watermark")?.let {
                    IrWatermark(
                        imageUrl = it.optNullableString("imageUrl") ?: "",
                        position = it.optNullableString("position") ?: "top_right",
                        opacityPct = it.optDouble("opacityPct", 100.0),
                        widthFraction = it.optDouble("widthFraction", 0.14),
                        x = if (it.has("x") && !it.isNull("x")) it.optDouble("x") else null,
                        y = if (it.has("y") && !it.isNull("y")) it.optDouble("y") else null,
                        width = if (it.has("width") && !it.isNull("width")) it.optDouble("width") else null,
                        height = if (it.has("height") && !it.isNull("height")) it.optDouble("height") else null,
                    )
                },
            )
        }

        fun parseColor(value: String): Int {
            // Contract colours are CSS-style #RRGGBB or #RRGGBBAA; Android wants #AARRGGBB.
            val hex = value.trim().removePrefix("#")
            return try {
                when (hex.length) {
                    6 -> Color.parseColor("#$hex")
                    8 -> Color.parseColor("#${hex.substring(6, 8)}${hex.substring(0, 6)}")
                    else -> throw IllegalArgumentException("bad length")
                }
            } catch (e: IllegalArgumentException) {
                throw EditIrException("INVALID_EDIT_IR", "Invalid colour '$value'")
            }
        }

        private inline fun <reified T> JSONObject.req(key: String): T {
            if (!has(key) || isNull(key)) throw EditIrException("INVALID_EDIT_IR", "Missing required field '$key'")
            val v = get(key)
            return v as? T ?: throw EditIrException("INVALID_EDIT_IR", "Field '$key' has the wrong type")
        }

        private fun JSONObject.optNullableObject(key: String): JSONObject? =
            if (!has(key) || isNull(key)) null else optJSONObject(key)

        private fun JSONObject.optNullableString(key: String): String? =
            if (!has(key) || isNull(key)) null else optString(key)

        /** A motion block, or null when its type is unknown or the time is missing (unknown motion is ignored). */
        private fun JSONObject.motion(msKey: String, allowed: Set<String>): IrTextMotionSpec? {
            val type = optNullableString("type") ?: return null
            val ms = optLong(msKey, 0L)
            return if (type in allowed && ms > 0) IrTextMotionSpec(type, ms) else null
        }

        private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
    }

    /** Enforces the invariants of contract §3 so the renderer never guesses. */
    fun validate() {
        fun fail(msg: String): Nothing = throw EditIrException("INVALID_EDIT_IR", msg)
        if (canvas.aspect !in ASPECTS) fail("canvas.aspect '${canvas.aspect}' is not one of $ASPECTS")
        if (canvas.width <= 0 || canvas.height <= 0 || canvas.width % 2 != 0 || canvas.height % 2 != 0) {
            fail("canvas size must be positive and even, got ${canvas.width}x${canvas.height}")
        }
        if (canvas.fps.isNaN() || canvas.fps < 1.0 || canvas.fps > 120.0) fail("canvas.fps ${canvas.fps} outside 1..120")
        if (clips.isEmpty()) fail("clips[] is empty — nothing to render")
        if (clips.first().timelineStartMs != 0L) fail("clips[0] must start at 0 on the timeline")
        clips.forEachIndexed { i, c ->
            if (c.speed <= 0.25 - 1e-9 || c.speed > 4.0 + 1e-9) fail("clip ${c.id}: speed ${c.speed} outside (0.25..4]")
            if (c.sourceEndMs <= c.sourceStartMs || c.sourceStartMs < 0) fail("clip ${c.id}: empty/negative source range")
            val expected = ((c.sourceEndMs - c.sourceStartMs) / c.speed).roundToLong()
            val actual = c.timelineEndMs - c.timelineStartMs
            if (abs(expected - actual) > 1) fail("clip ${c.id}: timeline duration $actual != source/speed $expected")
            if (i > 0 && c.timelineStartMs != clips[i - 1].timelineEndMs) fail("clip ${c.id}: clips are not contiguous")
            if (i == 0 && c.transitionIn != null) fail("clips[0] must not have transitionIn")
            if (c.rotationDeg !in setOf(0, 90, 180, 270)) fail("clip ${c.id}: rotationDeg ${c.rotationDeg} must be 0, 90, 180 or 270")
            c.crop?.let {
                if (it.width <= 0 || it.height <= 0 || it.x < -1e-6 || it.y < -1e-6 ||
                    it.x + it.width > 1 + 1e-6 || it.y + it.height > 1 + 1e-6
                ) fail("clip ${c.id}: crop rect outside 0..1")
            }
        }
        if (abs(clips.last().timelineEndMs - durationMs) > 1) fail("durationMs $durationMs != last clip end ${clips.last().timelineEndMs}")
        // Full-frame cutaways replace the main picture, so they cannot overlap each other. Layers (stickers, PiP,
        // photos) stack on their own compositor tracks above anything, like CapCut tracks.
        overlays.filter { !it.isLayer }.sortedBy { it.timelineStartMs }.zipWithNext().forEach { (a, b) ->
            if (b.timelineStartMs < a.timelineEndMs) fail("overlays ${a.id} and ${b.id} overlap")
        }
        overlays.forEach {
            if (it.kind != "broll") fail("overlay ${it.id}: kind '${it.kind}' unsupported")
            if (it.timelineEndMs <= it.timelineStartMs) fail("overlay ${it.id}: empty range")
            if (it.timelineStartMs < 0 || it.timelineEndMs > durationMs + 1) fail("overlay ${it.id}: outside timeline")
        }
        captions.forEach { cap ->
            if (cap.endMs <= cap.startMs) fail("caption ${cap.id}: empty range")
            if (cap.style.animation !in setOf("none", "word_pop", "karaoke", "word_box", "word_reveal")) fail("caption ${cap.id}: animation '${cap.style.animation}' unsupported")
        }
        zooms.forEach { if (it.scale < 1.0 || it.endMs <= it.startMs) fail("zoom ${it.id}: invalid") }
        if (audio.music.size > 1) fail("mobile-editir/1 allows at most one music item")
        audio.music.forEach { if (it.timelineEndMs <= it.timelineStartMs) fail("music ${it.id}: empty range") }
        watermark?.let { w ->
            if (w.position !in WATERMARK_POSITIONS) fail("watermark.position '${w.position}' must be one of $WATERMARK_POSITIONS")
            if (w.opacityPct.isNaN() || w.opacityPct < 0.0 || w.opacityPct > 100.0) fail("watermark.opacityPct ${w.opacityPct} outside 0..100")
            if (w.widthFraction.isNaN() || w.widthFraction < 0.04 || w.widthFraction > 0.5) fail("watermark.widthFraction ${w.widthFraction} outside 0.04..0.5")
        }
    }
}

/**
 * Export settings chosen on the export sheet (not part of the edit): [maxShortSide] scales the finished frame down
 * (e.g. 720 for 720p), [quality] "high" doubles the video bitrate. Frame rate is applied by the caller as canvas.fps.
 */
/** [loudnessTargetLufs]: normalise the mix so the voice sits at this integrated loudness (null = leave levels). */
data class RenderOptions(val maxShortSide: Int? = null, val quality: String = "standard", val loudnessTargetLufs: Double? = null)
