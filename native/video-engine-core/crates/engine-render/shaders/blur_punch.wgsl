// 180 Workspace WGSL Radial Motion Blur & Gaussian Punch Shader
struct BlurUniforms {
    intensity: f32,
    center_x: f32,
    center_y: f32,
    samples: u32,
};

@group(0) @binding(0) var<uniform> blur: BlurUniforms;
@group(0) @binding(1) var t_input: texture_2d<f32>;
@group(0) @binding(2) var s_input: sampler;

@fragment
fn fs_radial_blur(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let center = vec2<f32>(blur.center_x, blur.center_y);
    let dir = (uv - center) * blur.intensity;
    var color = vec4<f32>(0.0);
    let num_samples = f32(blur.samples);

    for (var i: u32 = 0u; i < blur.samples; i = i + 1u) {
        let offset = dir * (f32(i) / num_samples);
        color = color + textureSample(t_input, s_input, uv - offset);
    }

    return color / num_samples;
}
