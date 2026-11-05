package com.workspace180.socialmanager.mediaengine

import org.junit.Assert.assertEquals
import org.junit.Test

class ClipAudioFadesTest {
    private fun clip(start: Long, end: Long, volumeDb: Double = 0.0, transitionIn: IrTransition? = null, fadeIn: Long = 0, fadeOut: Long = 0) =
        IrClip(
            id = "c$start", assetId = "primary", sourceStartMs = start, sourceEndMs = end, timelineStartMs = start, timelineEndMs = end,
            speed = 1.0, volumeDb = volumeDb, crop = null, filter = null, transitionIn = transitionIn,
            audioFadeInMs = fadeIn, audioFadeOutMs = fadeOut,
        )

    @Test
    fun singleClipKeepsTimelineEdgesUntouched() {
        assertEquals(0.0 to 0.0, clipAudioFadesMs(listOf(clip(0, 5000)), 0))
    }

    @Test
    fun hardCutGetsTenMsFadeOnBothSides() {
        val clips = listOf(clip(0, 4000), clip(4000, 6000, transitionIn = IrTransition("CUT", 0)), clip(6000, 9000))
        assertEquals(0.0 to 10.0, clipAudioFadesMs(clips, 0))
        assertEquals(10.0 to 10.0, clipAudioFadesMs(clips, 1))
        assertEquals(10.0 to 0.0, clipAudioFadesMs(clips, 2))
        val (fi, fo) = clipAudioFadesMs(clips, 1)
        val model = ClipAudioGainModel(2000.0, 0.0, fi, fo)
        assertEquals(0f, model.gainAtItemMs(0.0), 1e-6f)
        assertEquals(0.5f, model.gainAtItemMs(5.0), 1e-6f)
        assertEquals(1f, model.gainAtItemMs(1000.0), 1e-6f)
        assertEquals(0f, model.gainAtItemMs(2000.0), 1e-6f)
    }

    @Test
    fun longerTransitionOrManualFadeWins() {
        val clips = listOf(clip(0, 4000, fadeOut = 300), clip(4000, 8000, transitionIn = IrTransition("CROSSFADE", 500)))
        assertEquals(0.0 to 300.0, clipAudioFadesMs(clips, 0))
        assertEquals(250.0 to 0.0, clipAudioFadesMs(clips, 1))
    }

    @Test
    fun shortAndMutedClipsGetNoDeclick() {
        val clips = listOf(clip(0, 4000), clip(4000, 4030), clip(4030, 8000, volumeDb = -60.0))
        assertEquals(0.0 to 0.0, clipAudioFadesMs(clips, 1))
        assertEquals(0.0 to 0.0, clipAudioFadesMs(clips, 2))
        assertEquals(0.0 to 10.0, clipAudioFadesMs(clips, 0))
        assertEquals(0.0 to 0.0, clipAudioFadesMs(clips, 0, originalVolumeDb = -60.0))
    }
}
