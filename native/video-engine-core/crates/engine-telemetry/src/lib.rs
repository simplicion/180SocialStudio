use engine_timeline::time::RationalTime;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioEnergyPoint {
    pub timestamp: RationalTime,
    pub rms_db: f32,
    pub is_speech: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SilenceGap {
    pub start: RationalTime,
    pub duration: RationalTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoTelemetryManifest {
    pub media_path: String,
    pub total_duration: RationalTime,
    pub silence_gaps: Vec<SilenceGap>,
    pub speech_peaks: Vec<RationalTime>,
    pub detected_scenes: Vec<RationalTime>,
}

impl VideoTelemetryManifest {
    pub fn new(media_path: String, total_duration: RationalTime) -> Self {
        Self {
            media_path,
            total_duration,
            silence_gaps: Vec::new(),
            speech_peaks: Vec::new(),
            detected_scenes: Vec::new(),
        }
    }

    pub fn add_silence_gap(&mut self, start: RationalTime, duration: RationalTime) {
        self.silence_gaps.push(SilenceGap { start, duration });
    }

    /// Serializes to compact micro-token JSON (<800 tokens) for AI Creative Director prompting
    pub fn to_compact_ai_prompt_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }
}
