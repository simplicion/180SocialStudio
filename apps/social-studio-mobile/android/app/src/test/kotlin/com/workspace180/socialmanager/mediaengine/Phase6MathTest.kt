package com.workspace180.socialmanager.mediaengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Pure maths of the Phase 6 contract fields (moving crop, J/L cuts, text transform, music beds). */
class Phase6MathTest {
    private val eps = 1e-9

    // ---- cropKeyframes (mirrors EditIrClip.cropAt in edit_ir.dart) -------------------------------------------

    private val crop = IrCrop(0.2, 0.1, 0.5, 0.6)
    private val keys = listOf(IrCropKeyframe(1000, 0.0, 0.0), IrCropKeyframe(2000, 0.4, 0.2), IrCropKeyframe(4000, 0.6, 0.6))

    @Test
    fun cropWithoutKeyframesIsTheStaticCrop() {
        assertEquals(crop, CropPath.at(crop, emptyList(), 1500.0))
        assertNull(CropPath.at(null, keys, 1500.0))
    }

    @Test
    fun cropHoldsFirstAndLastKeyframeOutsideThem() {
        assertEquals(IrCrop(0.0, 0.0, 0.5, 0.6), CropPath.at(crop, keys, 0.0))
        assertEquals(IrCrop(0.0, 0.0, 0.5, 0.6), CropPath.at(crop, keys, 1000.0))
        // Last keyframe y 0.6 is clamped so the 0.6-high window stays in the frame (1 - 0.6 = 0.4).
        val end = CropPath.at(crop, keys, 9000.0)!!
        assertEquals(0.5, end.x, eps)
        assertEquals(0.4, end.y, eps)
    }

    @Test
    fun cropInterpolatesLinearlyBetweenKeyframes() {
        val mid = CropPath.at(crop, keys, 1500.0)!!
        assertEquals(0.2, mid.x, eps)
        assertEquals(0.1, mid.y, eps)
        assertEquals(0.5, mid.width, eps)
        assertEquals(0.6, mid.height, eps)
        val q = CropPath.at(crop, keys, 3000.0)!! // halfway 2000 -> 4000: x 0.5, y 0.4 (y clamp is exactly 0.4)
        assertEquals(0.5, q.x, eps)
        assertEquals(0.4, q.y, eps)
    }

    @Test
    fun cropShiftMovesTheKeyframedWindowOntoTheStaticOne() {
        val (dx, dy) = CropPath.shiftAt(crop, keys, 1000.0)
        assertEquals(0.2, dx, eps)
        assertEquals(0.1, dy, eps)
    }

    // ---- J / L cuts ------------------------------------------------------------------------------------------

    private fun clip(i: Int, tStart: Long, tEnd: Long, srcStart: Long, lead: Long = 0, lag: Long = 0, speed: Double = 1.0, transition: IrTransition? = null) = IrClip(
        id = "c$i", assetId = "a$i", sourceStartMs = srcStart, sourceEndMs = srcStart + ((tEnd - tStart) * speed).toLong(),
        timelineStartMs = tStart, timelineEndMs = tEnd, speed = speed, volumeDb = 0.0, crop = null, filter = null,
        transitionIn = transition, audioLeadMs = lead, audioLagMs = lag,
    )

    @Test
    fun leadIsClampedToSourceBeforeAndHalfThePreviousClip() {
        val clips = listOf(clip(0, 0, 3000, 0), clip(1, 3000, 6000, 5000, lead = 2000))
        assertEquals(1500.0 to 0.0, clipJlMs(clips, 1, sourceBeforeMs = 5000.0, sourceAfterMs = 10_000.0)) // half of 3000
        assertEquals(800.0 to 0.0, clipJlMs(clips, 1, sourceBeforeMs = 800.0, sourceAfterMs = 10_000.0)) // file starts 800 ms earlier
        // The first clip has nothing before it.
        val first = listOf(clip(0, 0, 3000, 5000, lead = 500), clip(1, 3000, 6000, 0))
        assertEquals(0.0 to 0.0, clipJlMs(first, 0, 5000.0, 0.0))
    }

    @Test
    fun lagIsClampedToSourceAfterAndHalfTheNextClip() {
        val clips = listOf(clip(0, 0, 3000, 0, lag = 2000), clip(1, 3000, 4000, 0))
        assertEquals(0.0 to 500.0, clipJlMs(clips, 0, 0.0, 9000.0))
        assertEquals(0.0 to 300.0, clipJlMs(clips, 0, 0.0, 300.0))
        assertEquals(0.0 to 0.0, clipJlMs(clips, 1, 0.0, 9000.0)) // last clip: no lag
    }

    @Test
    fun jlClampIsInTimelineMsForSpedUpClips() {
        // A 2x clip with 600 source ms before its in-point can lead by 300 timeline ms.
        val clips = listOf(clip(0, 0, 3000, 0), clip(1, 3000, 5000, 600, lead = 1000, speed = 2.0))
        assertEquals(300.0 to 0.0, clipJlMs(clips, 1, 600.0, 0.0))
    }

    @Test
    fun jCutFadesThePreviousClipOutUnderTheLead() {
        val clips = listOf(clip(0, 0, 3000, 0), clip(1, 3000, 6000, 5000, lead = 400))
        val jl = clips.indices.map { clipJlMs(clips, it, if (it == 1) 5000.0 else 0.0, 9000.0) }
        val prev = clipAudioPlanMs(clips, 0, jl)
        val lead = clipAudioPlanMs(clips, 1, jl)
        assertEquals(400.0, prev.fadeOutMs, eps) // outgoing sound fades over the whole overlap
        assertEquals(0.0, prev.fadeInMs, eps)
        assertEquals(400.0, lead.leadMs, eps)
        assertEquals(DECLICK_FADE_MS, lead.fadeInMs, eps) // incoming sound starts at full level (de-click only)
        assertTrue(lead.hasJl)
    }

    @Test
    fun lCutFadesTheNextClipInUnderTheLag() {
        val clips = listOf(clip(0, 0, 3000, 0, lag = 600), clip(1, 3000, 6000, 0))
        val jl = clips.indices.map { clipJlMs(clips, it, 0.0, 9000.0) }
        val lagging = clipAudioPlanMs(clips, 0, jl)
        val next = clipAudioPlanMs(clips, 1, jl)
        assertEquals(600.0, lagging.lagMs, eps)
        assertEquals(DECLICK_FADE_MS, lagging.fadeOutMs, eps)
        assertEquals(600.0, next.fadeInMs, eps)
    }

    @Test
    fun jlKeepsTheLongerTransitionFadeAndNoJlKeepsTodaysFades() {
        val plain = listOf(clip(0, 0, 3000, 0), clip(1, 3000, 6000, 0, transition = IrTransition("CROSSFADE", 600)))
        val none = plain.indices.map { 0.0 to 0.0 }
        plain.indices.forEach { i ->
            val p = clipAudioPlanMs(plain, i, none)
            assertEquals(clipAudioFadesMs(plain, i), p.fadeInMs to p.fadeOutMs)
        }
        val withLead = listOf(clip(0, 0, 3000, 0), clip(1, 3000, 6000, 5000, lead = 100, transition = IrTransition("CROSSFADE", 600)))
        val jl = withLead.indices.map { clipJlMs(withLead, it, if (it == 1) 5000.0 else 0.0, 0.0) }
        assertEquals(300.0, clipAudioPlanMs(withLead, 0, jl).fadeOutMs, eps) // half the transition beats the 100 ms lead
    }

    // ---- text transform (mirrors textTransformAt in text_motion.dart) -----------------------------------------

    private fun style(rotation: Double = 0.0, scale: Double = 1.0, keys: List<IrTextTransformKeyframe> = emptyList()) = IrCaptionStyle(
        preset = "TITLE", animation = "none", fontFamily = "Inter", fontWeight = 800, fontSizePx = 72.0,
        textColor = -1, highlightColor = -1, strokeColor = 0, strokeWidthPx = 0.0, shadow = true, background = null,
        uppercase = false, positionX = 0.5, positionY = 0.2, maxWidthFraction = 0.86,
        rotationDeg = rotation, scale = scale, transformKeyframes = keys,
    )

    @Test
    fun staticTransformIsTheStyle() {
        assertEquals(TextTransform(15.0, 1.5, 0.5, 0.2), TextTransform.at(style(15.0, 1.5), 1000, 3000, 2000.0))
    }

    @Test
    fun keyframesInterpolateFromTheTextStartAndHoldAtTheEnds() {
        val st = style(
            rotation = 10.0, scale = 2.0,
            keys = listOf(IrTextTransformKeyframe(0, rotationDeg = 0.0, positionX = 0.2), IrTextTransformKeyframe(1000, rotationDeg = 90.0, scale = 1.0)),
        )
        // Text starts at 5000; at 5500 it is halfway: rotation 45, scale 2 -> 1 is 1.5, x 0.2 -> style 0.5 is 0.35.
        val mid = TextTransform.at(st, 5000, 8000, 5500.0)
        assertEquals(45.0, mid.rotationDeg, eps)
        assertEquals(1.5, mid.scale, eps)
        assertEquals(0.35, mid.positionX, eps)
        assertEquals(0.2, mid.positionY, eps)
        assertEquals(TextTransform(0.0, 2.0, 0.2, 0.2), TextTransform.at(st, 5000, 8000, 4000.0))
        assertEquals(TextTransform(90.0, 1.0, 0.5, 0.2), TextTransform.at(st, 5000, 8000, 7900.0))
    }

    // ---- music beds ---------------------------------------------------------------------------------------

    private fun ir(music: List<IrMusic>) = MobileEditIr(
        schemaVersion = MobileEditIr.SCHEMA_VERSION, projectId = "p", canvas = IrCanvas("9:16", 1080, 1920, 30.0, 0),
        durationMs = 10_000, clips = listOf(IrClip("a", "primary", 0, 10_000, 0, 10_000, 1.0, 0.0, null, null, null)),
        overlays = emptyList(), captions = emptyList(), zooms = emptyList(), audio = IrAudio(0.0, music, emptyList()),
    )

    private fun bed(id: String, s: Long, e: Long) = IrMusic(id, s, e, 0, 0.0, 0, 0, null)

    @Test
    fun upToFourNonOverlappingMusicBedsAreValid() {
        ir(listOf(bed("m3", 6000, 8000), bed("m1", 0, 3000), bed("m2", 3000, 6000), bed("m4", 8000, 10_000))).validate()
    }

    @Test
    fun overlappingOrTooManyMusicBedsFail() {
        for (music in listOf(
            listOf(bed("m1", 0, 4000), bed("m2", 3000, 6000)),
            (0 until 5).map { bed("m$it", it * 2000L, it * 2000L + 1000) },
        )) {
            try {
                ir(music).validate()
                fail("expected INVALID_EDIT_IR for $music")
            } catch (e: EditIrException) {
                assertEquals("INVALID_EDIT_IR", e.code)
            }
        }
    }
}
