use clap::{Parser, Subcommand};
use engine_core::ProjectManifest;
use engine_media::MediaProber;
use engine_render::{LosslessSplicer, RenderPlanner};
use engine_timeline::{RationalTime, TimeRange, TrackType, Transform, VideoClip, VideoTrack};
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Parser, Debug)]
#[command(name = "video-engine-cli")]
#[command(about = "180 Workspace Autonomous Video Production Engine CLI", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Create a new .vproj project package
    Create {
        #[arg(short, long)]
        name: String,
        #[arg(short, long)]
        out: PathBuf,
        #[arg(long, default_value_t = 1920)]
        width: u32,
        #[arg(long, default_value_t = 1080)]
        height: u32,
    },
    /// Inspect media metadata via FFprobe
    Probe {
        #[arg(short, long)]
        input: PathBuf,
    },
    /// Add a media clip to a project package
    AddClip {
        #[arg(short, long)]
        project: PathBuf,
        #[arg(short, long)]
        media: PathBuf,
        #[arg(long, default_value_t = 0.0)]
        start_sec: f64,
        #[arg(long, default_value_t = 10.0)]
        duration_sec: f64,
    },
    /// Render project to final MP4 using LosslessCut stream-copy and hardware acceleration
    Export {
        #[arg(short, long)]
        project: PathBuf,
        #[arg(short, long)]
        out: PathBuf,
    },
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::init();
    let cli = Cli::parse();

    match cli.command {
        Commands::Create { name, out, width, height } => {
            let manifest = ProjectManifest::new(name.clone(), width, height, 30, 1);
            manifest.save_to_package(&out)?;
            println!("✓ Successfully created project package: {:?}", out);
        }
        Commands::Probe { input } => {
            let meta = MediaProber::probe_file(&input)?;
            println!("{}", serde_json::to_string_pretty(&meta)?);
        }
        Commands::AddClip { project, media, start_sec, duration_sec } => {
            let mut manifest = ProjectManifest::load_from_package(&project)?;
            let meta = MediaProber::probe_file(&media)?;

            if manifest.tracks.is_empty() {
                manifest.tracks.push(VideoTrack::new(TrackType::MainVideo, 0));
            }

            let source_range = TimeRange::new(
                RationalTime::from_seconds(start_sec, 48000),
                RationalTime::from_seconds(duration_sec, 48000),
            );

            let timeline_start = manifest.meta.duration;
            let timeline_range = TimeRange::new(timeline_start, source_range.duration);

            let clip = VideoClip {
                id: Uuid::new_v4(),
                asset_id: meta.file_path.clone(),
                source_path: meta.file_path,
                source_range,
                timeline_range,
                transform: Transform::default(),
                speed_multiplier: 1.0,
            };

            manifest.meta.duration = manifest.meta.duration + source_range.duration;
            manifest.tracks[0].add_clip(clip);
            manifest.save_to_package(&project)?;
            println!("✓ Added clip to project. New project duration: {:.2}s", manifest.meta.duration.to_seconds());
        }
        Commands::Export { project, out } => {
            let manifest = ProjectManifest::load_from_package(&project)?;
            let temp_dir = project.join("cache").join("render_tmp");
            let plan = RenderPlanner::create_plan(&manifest, out.to_string_lossy().to_string());

            println!("▶ Rendering {} chunks...", plan.chunks.len());
            LosslessSplicer::execute_plan(&plan, &temp_dir)?;
            println!("✓ Export complete: {:?}", out);
        }
    }

    Ok(())
}
