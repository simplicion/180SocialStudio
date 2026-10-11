use chrono::{DateTime, Utc};
use engine_timeline::{RationalTime, VideoTrack};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum ProjectError {
    #[error("IO Error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON Serialization Error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Project validation error: {0}")]
    Validation(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMetadata {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub width: u32,
    pub height: u32,
    pub fps_num: u32,
    pub fps_den: u32,
    pub duration: RationalTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectManifest {
    pub schema_version: u32,
    pub engine_version: String,
    pub meta: ProjectMetadata,
    pub tracks: Vec<VideoTrack>,
}

impl ProjectManifest {
    pub fn new(name: String, width: u32, height: u32, fps_num: u32, fps_den: u32) -> Self {
        let now = Utc::now();
        Self {
            schema_version: 1,
            engine_version: "0.1.0".to_string(),
            meta: ProjectMetadata {
                id: Uuid::new_v4(),
                name,
                created_at: now,
                updated_at: now,
                width,
                height,
                fps_num,
                fps_den,
                duration: RationalTime::ZERO,
            },
            tracks: Vec::new(),
        }
    }

    pub fn save_to_package(&self, package_dir: &Path) -> Result<(), ProjectError> {
        if !package_dir.exists() {
            fs::create_dir_all(package_dir)?;
        }
        let project_json_path = package_dir.join("project.json");
        let temp_path = package_dir.join("project.json.tmp");

        let json_str = serde_json::to_string_pretty(self)?;
        fs::write(&temp_path, json_str)?;
        fs::rename(temp_path, project_json_path)?;

        // Ensure subdirectories exist
        fs::create_dir_all(package_dir.join("proxies"))?;
        fs::create_dir_all(package_dir.join("thumbnails"))?;
        fs::create_dir_all(package_dir.join("cache"))?;
        fs::create_dir_all(package_dir.join("renders"))?;

        Ok(())
    }

    pub fn load_from_package(package_dir: &Path) -> Result<Self, ProjectError> {
        let project_json_path = package_dir.join("project.json");
        let json_str = fs::read_to_string(project_json_path)?;
        let manifest: Self = serde_json::from_str(&json_str)?;
        Ok(manifest)
    }
}
