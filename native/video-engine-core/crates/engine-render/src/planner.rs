use engine_core::ProjectManifest;
use engine_timeline::TimeRange;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RenderStrategy {
    StreamCopy,
    GpuRender,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderChunk {
    pub source_path: String,
    pub source_range: TimeRange,
    pub timeline_range: TimeRange,
    pub strategy: RenderStrategy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderPlan {
    pub output_path: String,
    pub width: u32,
    pub height: u32,
    pub chunks: Vec<RenderChunk>,
}

pub struct RenderPlanner;

impl RenderPlanner {
    pub fn create_plan(manifest: &ProjectManifest, output_path: String) -> RenderPlan {
        let mut chunks = Vec::new();

        for track in &manifest.tracks {
            for clip in &track.clips {
                let is_unmodified = clip.transform.scale_start == 1.0
                    && clip.transform.scale_end == 1.0
                    && clip.transform.pos_x == 0.0
                    && clip.transform.pos_y == 0.0
                    && clip.transform.opacity == 1.0
                    && clip.speed_multiplier == 1.0;

                let strategy = if is_unmodified {
                    RenderStrategy::StreamCopy
                } else {
                    RenderStrategy::GpuRender
                };

                chunks.push(RenderChunk {
                    source_path: clip.source_path.clone(),
                    source_range: clip.source_range,
                    timeline_range: clip.timeline_range,
                    strategy,
                });
            }
        }

        RenderPlan {
            output_path,
            width: manifest.meta.width,
            height: manifest.meta.height,
            chunks,
        }
    }
}
