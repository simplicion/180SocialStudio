use crate::planner::{RenderChunk, RenderPlan, RenderStrategy};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum RenderError {
    #[error("IO Error: {0}")]
    Io(#[from] std::io::Error),
    #[error("FFmpeg execution error: {0}")]
    Ffmpeg(String),
}

pub struct LosslessSplicer;

impl LosslessSplicer {
    pub fn execute_plan(plan: &RenderPlan, temp_dir: &Path) -> Result<(), RenderError> {
        if !temp_dir.exists() {
            fs::create_dir_all(temp_dir)?;
        }

        let mut segment_paths: Vec<PathBuf> = Vec::new();

        for (idx, chunk) in plan.chunks.iter().enumerate() {
            let seg_path = temp_dir.join(format!("segment_{:04}.mp4", idx));
            let start_sec = chunk.source_range.start.to_seconds();
            let dur_sec = chunk.source_range.duration.to_seconds();

            match chunk.strategy {
                RenderStrategy::StreamCopy => {
                    // Fast stream-copy without re-encoding
                    let status = Command::new("ffmpeg")
                        .arg("-y")
                        .arg("-ss")
                        .arg(format!("{:.4}", start_sec))
                        .arg("-i")
                        .arg(&chunk.source_path)
                        .arg("-t")
                        .arg(format!("{:.4}", dur_sec))
                        .arg("-c")
                        .arg("copy")
                        .arg("-avoid_negative_ts")
                        .arg("make_zero")
                        .arg(&seg_path)
                        .status()?;

                    if !status.success() {
                        return Err(RenderError::Ffmpeg(format!(
                            "Stream copy failed on chunk {}",
                            idx
                        )));
                    }
                }
                RenderStrategy::GpuRender => {
                    // Hardware accelerated / re-encoded segment
                    let status = Command::new("ffmpeg")
                        .arg("-y")
                        .arg("-ss")
                        .arg(format!("{:.4}", start_sec))
                        .arg("-i")
                        .arg(&chunk.source_path)
                        .arg("-t")
                        .arg(format!("{:.4}", dur_sec))
                        .arg("-c:v")
                        .arg("libx264")
                        .arg("-preset")
                        .arg("fast")
                        .arg("-crf")
                        .arg("18")
                        .arg("-c:a")
                        .arg("aac")
                        .arg(&seg_path)
                        .status()?;

                    if !status.success() {
                        return Err(RenderError::Ffmpeg(format!(
                            "Render failed on chunk {}",
                            idx
                        )));
                    }
                }
            }

            segment_paths.push(seg_path);
        }

        // Concat demuxer merge
        if segment_paths.len() == 1 {
            fs::copy(&segment_paths[0], &plan.output_path)?;
        } else if !segment_paths.is_empty() {
            let concat_txt = temp_dir.join("concat_list.txt");
            let mut list_content = String::new();
            for p in &segment_paths {
                list_content.push_str(&format!("file '{}'\n", p.to_string_lossy().replace('\\', "/")));
            }
            fs::write(&concat_txt, list_content)?;

            let status = Command::new("ffmpeg")
                .arg("-y")
                .arg("-f")
                .arg("concat")
                .arg("-safe")
                .arg("0")
                .arg("-i")
                .arg(&concat_txt)
                .arg("-c")
                .arg("copy")
                .arg(&plan.output_path)
                .status()?;

            if !status.success() {
                return Err(RenderError::Ffmpeg("Concat demuxer failed".to_string()));
            }
        }

        Ok(())
    }
}
