use engine_timeline::{RationalTime, TimeRange, Transform, VideoClip, VideoTrack};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EditCommand {
    AddClip {
        track_id: Uuid,
        clip: VideoClip,
    },
    RemoveClip {
        track_id: Uuid,
        clip_id: Uuid,
    },
    TrimClip {
        clip_id: Uuid,
        new_source_range: TimeRange,
        new_timeline_range: TimeRange,
    },
    SetTransform {
        clip_id: Uuid,
        transform: Transform,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandTransaction {
    pub id: Uuid,
    pub timestamp_ms: i64,
    pub command: EditCommand,
    pub inverse_command: EditCommand,
}
