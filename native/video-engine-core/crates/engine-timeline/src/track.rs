use crate::clip::VideoClip;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrackType {
    MainVideo,
    BRollOverlay,
    StickerOverlay,
    PictureInPicture,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VideoTrack {
    pub id: Uuid,
    pub track_type: TrackType,
    pub z_index: i32,
    pub clips: Vec<VideoClip>,
}

impl VideoTrack {
    pub fn new(track_type: TrackType, z_index: i32) -> Self {
        Self {
            id: Uuid::new_v4(),
            track_type,
            z_index,
            clips: Vec::new(),
        }
    }

    pub fn add_clip(&mut self, clip: VideoClip) {
        self.clips.push(clip);
        // Sort clips chronologically
        self.clips.sort_by(|a, b| {
            a.timeline_range
                .start
                .to_seconds()
                .partial_cmp(&b.timeline_range.start.to_seconds())
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    pub fn remove_clip(&mut self, clip_id: Uuid) -> Option<VideoClip> {
        if let Some(pos) = self.clips.iter().position(|c| c.id == clip_id) {
            Some(self.clips.remove(pos))
        } else {
            None
        }
    }
}
