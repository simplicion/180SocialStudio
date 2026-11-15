package com.workspace180.socialmanager.mediaengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Image layers are keyed on the CPU with the shader's maths (QA: a keyed photo layer exported unkeyed). */
class ChromaKeyCpuTest {
    private val green = IrChromaKey(color = 0x00FF00, similarity = 0.3, smoothness = 0.1, spill = 0.5)
    private fun alpha(p: Int) = (p ushr 24) and 0xFF

    @Test
    fun `key colour becomes transparent, the subject stays opaque and unchanged in hue`() {
        val px = intArrayOf(0xFF00FF00.toInt(), 0xFFFF0000.toInt(), 0xFF10F010.toInt())
        ChromaKeyCpu.apply(px, green)
        assertEquals("pure green is see-through", 0, alpha(px[0]))
        assertEquals("red subject stays opaque", 255, alpha(px[1]))
        assertTrue("red stays red", (px[1] shr 16 and 0xFF) > 240 && (px[1] shr 8 and 0xFF) < 20)
        assertEquals("near-green screen is see-through", 0, alpha(px[2]))
    }

    @Test
    fun `already transparent pixels are left alone and a blue key leaves green`() {
        val px = intArrayOf(0x00000000, 0xFF00FF00.toInt())
        ChromaKeyCpu.apply(px, green.copy(color = 0x0000FF))
        assertEquals(0x00000000, px[0])
        assertEquals("green is not keyed by a blue key", 255, alpha(px[1]))
    }
}
