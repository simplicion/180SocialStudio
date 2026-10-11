// 180 Workspace WGSL Multi-Transition Shader (Crossfade, Zoom Swoosh, Dissolve, Wipe)
struct TransitionUniforms {
    progress: f32, // 0.0 to 1.0
    transition_type: u32, // 0 = Crossfade, 1 = ZoomSwoosh, 2 = Dissolve, 3 = WipeLeft
};

@group(0) @binding(0) var<uniform> trans: TransitionUniforms;
@group(0) @binding(1) var t_from: texture_2d<f32>;
@group(0) @binding(2) var t_to: texture_2d<f32>;
@group(0) @binding(3) var s_sampler: sampler;

@fragment
fn fs_transition(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let p = trans.progress;
    
    if (trans.transition_type == 0u) {
        // 0: Crossfade
        let color_from = textureSample(t_from, s_sampler, uv);
        let color_to = textureSample(t_to, s_sampler, uv);
        return mix(color_from, color_to, p);
    } else if (trans.transition_type == 1u) {
        // 1: Zoom Swoosh
        let zoom_from_uv = (uv - 0.5) * (1.0 + p * 0.5) + 0.5;
        let zoom_to_uv = (uv - 0.5) * (1.5 - p * 0.5) + 0.5;
        let color_from = textureSample(t_from, s_sampler, zoom_from_uv);
        let color_to = textureSample(t_to, s_sampler, zoom_to_uv);
        return mix(color_from, color_to, smoothstep(0.3, 0.7, p));
    } else if (trans.transition_type == 3u) {
        // 3: Wipe Left
        if (uv.x < p) {
            return textureSample(t_to, s_sampler, uv);
        } else {
            return textureSample(t_from, s_sampler, uv);
        }
    } else {
        // Dissolve Fallback
        let color_from = textureSample(t_from, s_sampler, uv);
        let color_to = textureSample(t_to, s_sampler, uv);
        return mix(color_from, color_to, p);
    }
}
