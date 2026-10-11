// 180 Media Studio - Dynamic Spring Zoom Camera Framing WGSL Shader
struct SpringZoomUniform {
    center: vec2<f32>,
    scale: f32,
    vignette_intensity: f32,
};

@group(0) @binding(0)
var<uniform> u_zoom: SpringZoomUniform;
@group(0) @binding(1)
var t_video: texture_2d<f32>;
@group(0) @binding(2)
var s_video: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@fragment
fn fs_spring_zoom(in: VertexOutput) -> @location(0) vec4<f32> {
    let centered_uv = in.uv - u_zoom.center;
    let zoomed_uv = (centered_uv / u_zoom.scale) + u_zoom.center;

    if (zoomed_uv.x < 0.0 || zoomed_uv.x > 1.0 || zoomed_uv.y < 0.0 || zoomed_uv.y > 1.0) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }

    var color = textureSample(t_video, s_video, zoomed_uv);
    let dist = distance(in.uv, vec2<f32>(0.5, 0.5));
    let vignette = clamp(1.0 - dist * u_zoom.vignette_intensity, 0.0, 1.0);
    color.r = color.r * vignette;
    color.g = color.g * vignette;
    color.b = color.b * vignette;

    return color;
}
