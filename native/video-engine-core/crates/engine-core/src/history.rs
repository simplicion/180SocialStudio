use crate::commands::{CommandTransaction, EditCommand};
use crate::project::ProjectManifest;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum HistoryError {
    #[error("No commands available to undo")]
    EmptyUndoStack,
    #[error("No commands available to redo")]
    EmptyRedoStack,
    #[error("Track not found: {0}")]
    TrackNotFound(String),
    #[error("Clip not found: {0}")]
    ClipNotFound(String),
}

#[derive(Debug, Default)]
pub struct CommandHistory {
    undo_stack: Vec<CommandTransaction>,
    redo_stack: Vec<CommandTransaction>,
}

impl CommandHistory {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn execute(
        &mut self,
        manifest: &mut ProjectManifest,
        transaction: CommandTransaction,
    ) -> Result<(), HistoryError> {
        Self::apply_command(manifest, &transaction.command)?;
        self.undo_stack.push(transaction);
        self.redo_stack.clear();
        Ok(())
    }

    pub fn undo(&mut self, manifest: &mut ProjectManifest) -> Result<(), HistoryError> {
        let transaction = self.undo_stack.pop().ok_or(HistoryError::EmptyUndoStack)?;
        Self::apply_command(manifest, &transaction.inverse_command)?;
        self.redo_stack.push(transaction);
        Ok(())
    }

    pub fn redo(&mut self, manifest: &mut ProjectManifest) -> Result<(), HistoryError> {
        let transaction = self.redo_stack.pop().ok_or(HistoryError::EmptyRedoStack)?;
        Self::apply_command(manifest, &transaction.command)?;
        self.undo_stack.push(transaction);
        Ok(())
    }

    fn apply_command(manifest: &mut ProjectManifest, command: &EditCommand) -> Result<(), HistoryError> {
        match command {
            EditCommand::AddClip { track_id, clip } => {
                let track = manifest
                    .tracks
                    .iter_mut()
                    .find(|t| t.id == *track_id)
                    .ok_or_else(|| HistoryError::TrackNotFound(track_id.to_string()))?;
                track.add_clip(clip.clone());
            }
            EditCommand::RemoveClip { track_id, clip_id } => {
                let track = manifest
                    .tracks
                    .iter_mut()
                    .find(|t| t.id == *track_id)
                    .ok_or_else(|| HistoryError::TrackNotFound(track_id.to_string()))?;
                track
                    .remove_clip(*clip_id)
                    .ok_or_else(|| HistoryError::ClipNotFound(clip_id.to_string()))?;
            }
            EditCommand::TrimClip {
                clip_id,
                new_source_range,
                new_timeline_range,
            } => {
                let mut found = false;
                for track in &mut manifest.tracks {
                    if let Some(clip) = track.clips.iter_mut().find(|c| c.id == *clip_id) {
                        clip.source_range = *new_source_range;
                        clip.timeline_range = *new_timeline_range;
                        found = true;
                        break;
                    }
                }
                if !found {
                    return Err(HistoryError::ClipNotFound(clip_id.to_string()));
                }
            }
            EditCommand::SetTransform { clip_id, transform } => {
                let mut found = false;
                for track in &mut manifest.tracks {
                    if let Some(clip) = track.clips.iter_mut().find(|c| c.id == *clip_id) {
                        clip.transform = transform.clone();
                        found = true;
                        break;
                    }
                }
                if !found {
                    return Err(HistoryError::ClipNotFound(clip_id.to_string()));
                }
            }
        }
        Ok(())
    }
}
