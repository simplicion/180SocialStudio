package com.workspace180.socialmanager.mediaengine

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/** Typewriter / mask-wipe reveal cuts text only between grapheme clusters (regression fix, captions v2 audit). */
class CaptionRevealTest {
    @Test
    fun `latin text has one cluster per letter`() {
        assertArrayEquals(intArrayOf(1, 2, 3), graphemeEnds("abc"))
    }

    @Test
    fun `combining marks and Devanagari vowel signs stay with their letter`() {
        // "é" as e + combining acute, then "x".
        assertArrayEquals(intArrayOf(2, 3), graphemeEnds("éx"))
        // "कि" = KA + vowel sign I: one cluster, never shown as a bare KA with a dangling sign.
        val ki = "कि"
        assertEquals(1, graphemeEnds(ki).size)
        assertEquals(ki.length, graphemeEnds(ki).last())
    }

    @Test
    fun `an emoji surrogate pair is one cluster`() {
        val rocket = "🚀"
        assertArrayEquals(intArrayOf(2), graphemeEnds(rocket))
    }

    @Test
    fun `empty text has no clusters`() {
        assertEquals(0, graphemeEnds("").size)
    }
}
