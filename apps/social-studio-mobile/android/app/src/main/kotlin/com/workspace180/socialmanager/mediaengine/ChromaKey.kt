package com.workspace180.socialmanager.mediaengine

import android.content.Context
import android.graphics.Color
import android.opengl.GLES20
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import org.json.JSONObject

/** Green / blue screen key on an overlay layer (contract `chromaKey`). */
data class IrChromaKey(val color: Int, val similarity: Double, val smoothness: Double, val spill: Double) {
    companion object {
        fun parse(o: JSONObject?): IrChromaKey? {
            if (o == null) return null
            val hex = o.optString("color", "#00FF00")
            val color = try { Color.parseColor(hex) } catch (_: IllegalArgumentException) { Color.GREEN }
            return IrChromaKey(
                color,
                o.optDouble("similarity", 0.3).coerceIn(0.0, 1.0),
                o.optDouble("smoothness", 0.1).coerceIn(0.0, 1.0),
                o.optDouble("spill", 0.5).coerceIn(0.0, 1.0),
            )
        }
    }
}

/**
 * Keys out [IrChromaKey.color]: pixels whose chroma (CbCr) is within `similarity` of the key become transparent,
 * with a `smoothness` edge, and the key colour's spill is pulled toward grey. The phone preview runs the same maths
 * (shaders/chroma_key.frag), so preview = export.
 */
@UnstableApi
class ChromaKeyEffect(private val key: IrChromaKey) : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram = ChromaKeyProgram(key, useHdr)
}

@UnstableApi
private class ChromaKeyProgram(private val key: IrChromaKey, useHdr: Boolean) : BaseGlShaderProgram(useHdr, 1) {
    private val program = try {
        GlProgram(VERTEX, FRAGMENT)
    } catch (e: GlUtil.GlException) {
        throw VideoFrameProcessingException(e)
    }

    init {
        program.setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE)
    }

    override fun configure(inputWidth: Int, inputHeight: Int): Size = Size(inputWidth, inputHeight)

    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
        try {
            program.use()
            program.setSamplerTexIdUniform("uTexSampler", inputTexId, 0)
            program.setFloatsUniform(
                "uKeyColor",
                floatArrayOf(Color.red(key.color) / 255f, Color.green(key.color) / 255f, Color.blue(key.color) / 255f),
            )
            program.setFloatUniform("uSimilarity", key.similarity.toFloat())
            program.setFloatUniform("uSmoothness", key.smoothness.toFloat())
            program.setFloatUniform("uSpill", key.spill.toFloat())
            program.bindAttributesAndUniforms()
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        } catch (e: GlUtil.GlException) {
            throw VideoFrameProcessingException(e, presentationTimeUs)
        }
    }

    override fun release() {
        super.release()
        try {
            program.delete()
        } catch (e: GlUtil.GlException) {
            throw VideoFrameProcessingException(e)
        }
    }

    companion object {
        const val VERTEX = """
attribute vec4 aFramePosition;
varying vec2 vTexSamplingCoord;
void main() {
  gl_Position = aFramePosition;
  vTexSamplingCoord = vec2(aFramePosition.x * 0.5 + 0.5, aFramePosition.y * 0.5 + 0.5);
}
"""

        // Keep in step with shaders/chroma_key.frag (Flutter preview).
        const val FRAGMENT = """
precision mediump float;
uniform sampler2D uTexSampler;
uniform vec3 uKeyColor;
uniform float uSimilarity;
uniform float uSmoothness;
uniform float uSpill;
varying vec2 vTexSamplingCoord;
vec2 cbcr(vec3 c) {
  return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}
void main() {
  vec4 src = texture2D(uTexSampler, vTexSamplingCoord);
  vec3 rgb = src.a > 0.0 ? src.rgb / src.a : src.rgb;
  float d = distance(cbcr(rgb), cbcr(uKeyColor));
  float a = smoothstep(uSimilarity * 0.5, uSimilarity * 0.5 + max(uSmoothness * 0.5, 0.001), d);
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(rgb, vec3(luma), (1.0 - smoothstep(0.0, uSimilarity * 0.5 + uSmoothness, d)) * uSpill);
  float alpha = a * src.a;
  gl_FragColor = vec4(rgb * alpha, alpha);
}
"""
    }
}

/** Shape mask on a layer (contract `mask`): `circle` or `rounded` (corner radius as a fraction of the short side). */
data class IrMask(val shape: String, val radius: Double, val feather: Double) {
    companion object {
        fun parse(o: JSONObject?): IrMask? {
            if (o == null) return null
            val shape = o.optString("shape")
            if (shape != "circle" && shape != "rounded") return null
            return IrMask(shape, o.optDouble("radius", 0.15).coerceIn(0.0, 0.5), o.optDouble("feather", 0.01).coerceIn(0.0, 0.2))
        }
    }
}

/**
 * Cuts a layer to a circle (a true circle in pixels, fitted to the short side) or a rounded rectangle, with a soft edge.
 * Mirrored by the preview (ClipOval / ClipRRect in LayerPlacement).
 */
@UnstableApi
class LayerMaskEffect(private val mask: IrMask) : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram = LayerMaskProgram(mask, useHdr)
}

@UnstableApi
private class LayerMaskProgram(private val mask: IrMask, useHdr: Boolean) : BaseGlShaderProgram(useHdr, 1) {
    private val program = try {
        GlProgram(ChromaKeyProgramShaders.VERTEX, FRAGMENT)
    } catch (e: GlUtil.GlException) {
        throw VideoFrameProcessingException(e)
    }
    private var size = Size(1, 1)

    init {
        program.setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE)
    }

    override fun configure(inputWidth: Int, inputHeight: Int): Size {
        size = Size(inputWidth, inputHeight)
        return size
    }

    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
        try {
            program.use()
            program.setSamplerTexIdUniform("uTexSampler", inputTexId, 0)
            program.setFloatsUniform("uSize", floatArrayOf(size.width.toFloat(), size.height.toFloat()))
            program.setFloatUniform("uCircle", if (mask.shape == "circle") 1f else 0f)
            program.setFloatUniform("uRadius", mask.radius.toFloat())
            program.setFloatUniform("uFeather", mask.feather.toFloat())
            program.bindAttributesAndUniforms()
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        } catch (e: GlUtil.GlException) {
            throw VideoFrameProcessingException(e, presentationTimeUs)
        }
    }

    override fun release() {
        super.release()
        try {
            program.delete()
        } catch (e: GlUtil.GlException) {
            throw VideoFrameProcessingException(e)
        }
    }

    companion object {
        // Distance to the shape in pixels (signed): circle of radius short/2 centred, or a rounded rect.
        const val FRAGMENT = """
precision mediump float;
uniform sampler2D uTexSampler;
uniform vec2 uSize;
uniform float uCircle;
uniform float uRadius;
uniform float uFeather;
varying vec2 vTexSamplingCoord;
void main() {
  vec4 src = texture2D(uTexSampler, vTexSamplingCoord);
  vec2 p = (vTexSamplingCoord - 0.5) * uSize;
  float shortSide = min(uSize.x, uSize.y);
  float d;
  if (uCircle > 0.5) {
    d = length(p) - shortSide * 0.5;
  } else {
    float r = uRadius * shortSide;
    vec2 q = abs(p) - (uSize * 0.5 - vec2(r));
    d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  float edge = max(uFeather * shortSide, 1.0);
  float a = 1.0 - smoothstep(-edge, 0.0, d);
  gl_FragColor = src * a;
}
"""
    }
}

/** Shared pass-through vertex shader for the layer shader effects. */
internal object ChromaKeyProgramShaders {
    const val VERTEX = """
attribute vec4 aFramePosition;
varying vec2 vTexSamplingCoord;
void main() {
  gl_Position = aFramePosition;
  vTexSamplingCoord = vec2(aFramePosition.x * 0.5 + 0.5, aFramePosition.y * 0.5 + 0.5);
}
"""
}
