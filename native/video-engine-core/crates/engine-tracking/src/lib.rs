use engine_gpu::CameraViewportRect;
use engine_timeline::time::RationalTime;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrackableObjectType {
    Face,
    Speaker,
    Cursor,
    Product,
    ScreenROI,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoundingBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackedKeyframe {
    pub timestamp: RationalTime,
    pub object_type: TrackableObjectType,
    pub bounding_box: BoundingBox,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectTrajectory {
    pub object_id: String,
    pub object_type: TrackableObjectType,
    pub keyframes: Vec<TrackedKeyframe>,
}

impl ObjectTrajectory {
    pub fn new(object_id: String, object_type: TrackableObjectType) -> Self {
        Self {
            object_id,
            object_type,
            keyframes: Vec::new(),
        }
    }

    pub fn add_keyframe(&mut self, kf: TrackedKeyframe) {
        self.keyframes.push(kf);
        self.keyframes.sort_by_key(|k| k.timestamp.value);
    }

    /// Interpolates the target camera framing at a given timestamp
    pub fn get_camera_framing_at(&self, time: RationalTime, max_zoom: f32) -> CameraViewportRect {
        if self.keyframes.is_empty() {
            return CameraViewportRect::default();
        }

        // Find surrounding keyframes
        let mut prev = &self.keyframes[0];
        let mut next = &self.keyframes[0];

        for kf in &self.keyframes {
            if kf.timestamp.value <= time.value {
                prev = kf;
            }
            if kf.timestamp.value >= time.value {
                next = kf;
                break;
            }
        }

        let (target_x, target_y) = if prev.timestamp.value == next.timestamp.value {
            (
                prev.bounding_box.x + prev.bounding_box.width / 2.0,
                prev.bounding_box.y + prev.bounding_box.height / 2.0,
            )
        } else {
            let span = next.timestamp.value - prev.timestamp.value;
            let progress = ((time.value - prev.timestamp.value) as f32 / span as f32).clamp(0.0, 1.0);

            let x1 = prev.bounding_box.x + prev.bounding_box.width / 2.0;
            let y1 = prev.bounding_box.y + prev.bounding_box.height / 2.0;
            let x2 = next.bounding_box.x + next.bounding_box.width / 2.0;
            let y2 = next.bounding_box.y + next.bounding_box.height / 2.0;

            (x1 + (x2 - x1) * progress, y1 + (y2 - y1) * progress)
        };

        CameraViewportRect {
            center_x: target_x.clamp(0.2, 0.8),
            center_y: target_y.clamp(0.2, 0.8),
            zoom_scale: max_zoom.clamp(1.0, 2.5),
            rotation_deg: 0.0,
        }
    }
}
