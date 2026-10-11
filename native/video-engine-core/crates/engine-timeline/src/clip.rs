use crate::time::TimeRange;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    pub scale_start: f32,
    pub scale_end: f32,
    pub pos_x: f32,
    pub pos_y: f32,
    pub anchor_x: f32,
    pub anchor_y: f32,
    pub opacity: f32,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            scale_start: 1.0,
            scale_end: 1.0,
            pos_x: 0.0,
            pos_y: 0.0,
            anchor_x: 0.5,
            anchor_y: 0.5,
            opacity: 1.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VideoClip {
    pub id: Uuid,
    pub asset_id: String,
    pub source_path: String,
    pub source_range: TimeRange,
    pub timeline_range: TimeRange,
    pub transform: Transform,
    pub speed_multiplier: f32,
}
