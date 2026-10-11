#include <flutter/runtime_effect.glsl>

// Phone preview of the export's green-screen key (ChromaKey.kt FRAGMENT): keep the maths identical.
uniform vec2 uSize;
uniform vec3 uKeyColor;
uniform float uSimilarity;
uniform float uSmoothness;
uniform float uSpill;
uniform sampler2D uTexture;

out vec4 fragColor;

vec2 cbcr(vec3 c) {
  return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}

void main() {
  vec2 uv = FlutterFragCoord().xy / uSize;
#ifdef IMPELLER_TARGET_OPENGLES
  uv.y = 1.0 - uv.y;
#endif
  vec4 src = texture(uTexture, uv);
  vec3 rgb = src.a > 0.0 ? src.rgb / src.a : src.rgb;
  float d = distance(cbcr(rgb), cbcr(uKeyColor));
  float a = smoothstep(uSimilarity * 0.5, uSimilarity * 0.5 + max(uSmoothness * 0.5, 0.001), d);
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(rgb, vec3(luma), (1.0 - smoothstep(0.0, uSimilarity * 0.5 + uSmoothness, d)) * uSpill);
  float alpha = a * src.a;
  fragColor = vec4(rgb * alpha, alpha);
}
