// 180 Workspace WGSL Color Grade, Contrast & Exposure Shader
struct ColorGradeUniforms {
    exposure: f32, // -2.0 to 2.0 (0.0 = default)
    contrast: f32, // 0.0 to 2.0 (1.0 = default)
    saturation: f32, // 0.0 to 2.0 (1.0 = default)
    temperature: f32, // -1.0 to 1.0 (0.0 = default)
};

@group(0) @binding(0) var<uniform> grade: ColorGradeUniforms;
@group(0) @binding(1) var t_input: texture_2d<f32>;
@group(0) @binding(2) var s_input: sampler;

@fragment
fn fs_color_grade(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let raw = textureSample(t_input, s_input, uv);
    var color = raw.rgb;

    // 1. Exposure
    color = color * pow(2.0, grade.exposure);

    // 2. Contrast
    color = (color - 0.5) * grade.contrast + 0.5;

    // 3. Saturation
    let luminance = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
    color = mix(vec3<f32>(luminance), color, grade.saturation);

    // 4. Color Temperature Tint
    color.r = color.r + grade.temperature * 0.1;
    color.b = color.b - grade.temperature * 0.1;

    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), raw.a);
}
