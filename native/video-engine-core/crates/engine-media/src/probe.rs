use engine_timeline::RationalTime;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum MediaProbeError {
    #[error("FFprobe execution failed: {0}")]
    ProcessError(#[from] std::io::Error),
    #[error("FFprobe JSON parse error: {0}")]
    ParseError(#[from] serde_json::Error),
    #[error("No video stream found in media file")]
    NoVideoStream,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoStreamInfo {
    pub codec_name: String,
    pub width: u32,
    pub height: u32,
    pub fps_num: u32,
    pub fps_den: u32,
    pub duration: RationalTime,
    pub bit_rate: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioStreamInfo {
    pub codec_name: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub duration: RationalTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaMetadata {
    pub file_path: String,
    pub format_name: String,
    pub duration: RationalTime,
    pub size_bytes: u64,
    pub video_stream: Option<VideoStreamInfo>,
    pub audio_stream: Option<AudioStreamInfo>,
}

pub struct MediaProber;

impl MediaProber {
    pub fn probe_file(path: &Path) -> Result<MediaMetadata, MediaProbeError> {
        let output = Command::new("ffprobe")
            .arg("-v")
            .arg("quiet")
            .arg("-print_format")
            .arg("json")
            .arg("-show_format")
            .arg("-show_streams")
            .arg(path)
            .output()?;

        let json_str = String::from_utf8_lossy(&output.stdout);
        let parsed: serde_json::Value = serde_json::from_str(&json_str)?;

        let format = &parsed["format"];
        let duration_secs: f64 = format["duration"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0);
        let size_bytes: u64 = format["size"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let format_name = format["format_name"].as_str().unwrap_or("unknown").to_string();

        let mut video_info = None;
        let mut audio_info = None;

        if let Some(streams) = parsed["streams"].as_array() {
            for s in streams {
                let codec_type = s["codec_type"].as_str().unwrap_or("");
                if codec_type == "video" && video_info.is_none() {
                    let codec_name = s["codec_name"].as_str().unwrap_or("unknown").to_string();
                    let width = s["width"].as_u64().unwrap_or(1920) as u32;
                    let height = s["height"].as_u64().unwrap_or(1080) as u32;
                    let r_frame_rate = s["r_frame_rate"].as_str().unwrap_or("30/1");
                    let (num, den) = parse_fps(r_frame_rate);
                    video_info = Some(VideoStreamInfo {
                        codec_name,
                        width,
                        height,
                        fps_num: num,
                        fps_den: den,
                        duration: RationalTime::from_seconds(duration_secs, 48000),
                        bit_rate: s["bit_rate"].as_str().and_then(|b| b.parse().ok()),
                    });
                } else if codec_type == "audio" && audio_info.is_none() {
                    let codec_name = s["codec_name"].as_str().unwrap_or("unknown").to_string();
                    let sample_rate: u32 = s["sample_rate"]
                        .as_str()
                        .and_then(|sr| sr.parse().ok())
                        .unwrap_or(48000);
                    let channels = s["channels"].as_u64().unwrap_or(2) as u32;
                    audio_info = Some(AudioStreamInfo {
                        codec_name,
                        sample_rate,
                        channels,
                        duration: RationalTime::from_seconds(duration_secs, sample_rate),
                    });
                }
            }
        }

        Ok(MediaMetadata {
            file_path: path.to_string_lossy().to_string(),
            format_name,
            duration: RationalTime::from_seconds(duration_secs, 48000),
            size_bytes,
            video_stream: video_info,
            audio_stream: audio_info,
        })
    }
}

fn parse_fps(rate: &str) -> (u32, u32) {
    let parts: Vec<&str> = rate.split('/').collect();
    if parts.len() == 2 {
        let num = parts[0].parse().unwrap_or(30);
        let den = parts[1].parse().unwrap_or(1);
        (num, den)
    } else {
        (30, 1)
    }
}
