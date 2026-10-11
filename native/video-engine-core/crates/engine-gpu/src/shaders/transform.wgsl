// 180 Media Studio - High-Performance 2D Sub-Pixel Transform WGSL Shader
struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

struct TransformUniform {
    matrix: mat4x4<f32>,
    opacity: f32,
    aspect_ratio: f32,
    padding: vec2<f32>,
};

@group(0) @binding(0)
var<uniform> u_transform: TransformUniform;

@vertex
fn vs_main(model: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.uv = model.uv;
    out.clip_position = u_transform.matrix * vec4<f32>(model.position, 0.0, 1.0);
    return out;
}

@group(0) @binding(1)
var t_diffuse: texture_2d<f32>;
@group(0) @binding(2)
var s_diffuse: sampler;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    var color = textureSample(t_diffuse, s_diffuse, in.uv);
    color.a = color.a * u_transform.opacity;
    return color;
}
