// 180 Workspace WGSL Camera Spatial Transform & Spring Auto-Zoom Shader
struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

struct CameraUniforms {
    scale: f32,
    offset_x: f32,
    offset_y: f32,
    rotation: f32,
    anchor_x: f32,
    anchor_y: f32,
    opacity: f32,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var t_diffuse: texture_2d<f32>;
@group(0) @binding(2) var s_diffuse: sampler;

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    
    // Anchor centering & 2D affine transformation
    let anchor = vec2<f32>(camera.anchor_x, camera.anchor_y);
    var transformed_pos = (in.position - anchor) * camera.scale;
    
    // Rotation
    let rad = radians(camera.rotation);
    let cos_r = cos(rad);
    let sin_r = sin(rad);
    let rotated_pos = vec2<f32>(
        transformed_pos.x * cos_r - transformed_pos.y * sin_r,
        transformed_pos.x * sin_r + transformed_pos.y * cos_r
    );
    
    let final_pos = rotated_pos + anchor + vec2<f32>(camera.offset_x, camera.offset_y);
    out.clip_position = vec4<f32>(final_pos * 2.0 - 1.0, 0.0, 1.0);
    out.uv = in.uv;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let color = textureSample(t_diffuse, s_diffuse, in.uv);
    return vec4<f32>(color.rgb, color.a * camera.opacity);
}
