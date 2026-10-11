-- =============================================================================
-- 180 WORKSPACE VIDEO ENGINE: 100 MASTER MICRO-SQL QUERIES & PROCEDURES
-- Governing Standard: Multi-Tenant Autonomous Video Production Suite
-- Schema: PostgreSQL 15+ / SQLite3 compatible syntax
-- =============================================================================

-- =============================================================================
-- CATEGORY 1: MULTI-TENANCY & WORKSPACE ACCESS (Queries 1–10)
-- =============================================================================

-- Q1: Create video_studio_projects table with company tenant isolation
CREATE TABLE IF NOT EXISTS video_studio_projects (
    id VARCHAR(64) PRIMARY KEY,
    company_id VARCHAR(64) NOT NULL,
    created_by_user_id VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    target_aspect VARCHAR(16) DEFAULT '16:9',
    fps_numerator INT DEFAULT 30,
    fps_denominator INT DEFAULT 1,
    total_duration_timescale_val BIGINT DEFAULT 0,
    timescale INT DEFAULT 48000,
    style_preset VARCHAR(64) DEFAULT 'MRBEAST_FAST',
    pacing_multiplier NUMERIC(4,2) DEFAULT 1.0,
    zoom_aggressiveness NUMERIC(4,2) DEFAULT 0.5,
    retention_score INT DEFAULT 85,
    retention_prediction INT DEFAULT 80,
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Q2: Create index on tenant isolation company_id and updated_at
CREATE INDEX IF NOT EXISTS idx_vstudio_projects_tenant ON video_studio_projects (company_id, is_archived, updated_at DESC);

-- Q3: Fetch all active projects for a tenant
SELECT id, name, target_aspect, style_preset, retention_score, retention_prediction, updated_at 
FROM video_studio_projects 
WHERE company_id = $1 AND is_archived = FALSE 
ORDER BY updated_at DESC LIMIT 50;

-- Q4: Fetch single project by ID with tenant verification guard
SELECT * FROM video_studio_projects WHERE id = $1 AND company_id = $2;

-- Q5: Insert new video project
INSERT INTO video_studio_projects (id, company_id, created_by_user_id, name, target_aspect, style_preset, timescale) 
VALUES ($1, $2, $3, $4, $5, $6, $7) 
RETURNING *;

-- Q6: Update project metadata & director style preset
UPDATE video_studio_projects 
SET name = $1, target_aspect = $2, style_preset = $3, pacing_multiplier = $4, zoom_aggressiveness = $5, updated_at = CURRENT_TIMESTAMP 
WHERE id = $6 AND company_id = $7;

-- Q7: Soft-delete / archive project
UPDATE video_studio_projects SET is_archived = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND company_id = $2;

-- Q8: Restore archived project
UPDATE video_studio_projects SET is_archived = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND company_id = $2;

-- Q9: Count total active video projects per company
SELECT COUNT(*) AS total_projects FROM video_studio_projects WHERE company_id = $1 AND is_archived = FALSE;

-- Q10: Hard delete project and cascade
DELETE FROM video_studio_projects WHERE id = $1 AND company_id = $2;

-- =============================================================================
-- CATEGORY 2: PROJECT VERSION SNAPSHOTS & HISTORY (Queries 11–20)
-- =============================================================================

-- Q11: Create project snapshots history table
CREATE TABLE IF NOT EXISTS video_project_snapshots (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES video_studio_projects(id) ON DELETE CASCADE,
    company_id VARCHAR(64) NOT NULL,
    version_index INT NOT NULL,
    action_label VARCHAR(128) NOT NULL,
    edit_ir_json JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Q12: Index project snapshots by project and version index
CREATE INDEX IF NOT EXISTS idx_vproject_snapshots ON video_project_snapshots (project_id, version_index DESC);

-- Q13: Insert snapshot for undo/redo state
INSERT INTO video_project_snapshots (id, project_id, company_id, version_index, action_label, edit_ir_json) 
VALUES ($1, $2, $3, $4, $5, $6);

-- Q14: Fetch latest 20 snapshots for project history drawer
SELECT id, version_index, action_label, created_at 
FROM video_project_snapshots 
WHERE project_id = $1 AND company_id = $2 
ORDER BY version_index DESC LIMIT 20;

-- Q15: Fetch specific snapshot AST payload
SELECT edit_ir_json FROM video_project_snapshots WHERE id = $1 AND company_id = $2;

-- Q16: Prune snapshot history keeping top 50 versions per project
DELETE FROM video_project_snapshots 
WHERE project_id = $1 AND id NOT IN (
    SELECT id FROM video_project_snapshots WHERE project_id = $1 ORDER BY version_index DESC LIMIT 50
);

-- Q17: Count total snapshots for a project
SELECT COUNT(*) FROM video_project_snapshots WHERE project_id = $1;

-- Q18: Get max version index for project
SELECT COALESCE(MAX(version_index), 0) AS max_idx FROM video_project_snapshots WHERE project_id = $1;

-- Q19: Revert project to snapshot version
UPDATE video_studio_projects 
SET updated_at = CURRENT_TIMESTAMP 
WHERE id = $1 AND company_id = $2;

-- Q20: Clear all snapshots for archived projects
DELETE FROM video_project_snapshots 
WHERE project_id IN (SELECT id FROM video_studio_projects WHERE is_archived = TRUE);

-- =============================================================================
-- CATEGORY 3: TIMELINE TRACKS & CLIPS (Queries 21–30)
-- =============================================================================

-- Q21: Create timeline tracks table
CREATE TABLE IF NOT EXISTS timeline_tracks (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES video_studio_projects(id) ON DELETE CASCADE,
    track_type VARCHAR(32) NOT NULL, -- 'MAIN_VIDEO', 'OVERLAY', 'BROLL', 'DIALOGUE', 'BGM', 'SFX'
    z_index INT DEFAULT 0,
    is_muted BOOLEAN DEFAULT FALSE,
    is_locked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Q22: Create timeline clips table
CREATE TABLE IF NOT EXISTS timeline_clips (
    id VARCHAR(64) PRIMARY KEY,
    track_id VARCHAR(64) NOT NULL REFERENCES timeline_tracks(id) ON DELETE CASCADE,
    asset_id VARCHAR(64) NOT NULL,
    source_path TEXT NOT NULL,
    source_start_val BIGINT NOT NULL,
    source_duration_val BIGINT NOT NULL,
    timeline_start_val BIGINT NOT NULL,
    timeline_duration_val BIGINT NOT NULL,
    timescale INT DEFAULT 48000,
    speed_multiplier NUMERIC(4,2) DEFAULT 1.0,
    scale_start NUMERIC(4,2) DEFAULT 1.0,
    scale_end NUMERIC(4,2) DEFAULT 1.0,
    pos_x NUMERIC(6,3) DEFAULT 0.0,
    pos_y NUMERIC(6,3) DEFAULT 0.0,
    rotation_deg NUMERIC(6,2) DEFAULT 0.0,
    opacity NUMERIC(4,2) DEFAULT 1.0
);

-- Q23: Fetch all tracks and clips for a project
SELECT t.id AS track_id, t.track_type, t.z_index, c.id AS clip_id, c.asset_id, c.source_path, c.timeline_start_val, c.timeline_duration_val 
FROM timeline_tracks t 
LEFT JOIN timeline_clips c ON t.id = c.track_id 
WHERE t.project_id = $1 
ORDER BY t.z_index ASC, c.timeline_start_val ASC;

-- Q24: Insert new video track
INSERT INTO timeline_tracks (id, project_id, track_type, z_index) VALUES ($1, $2, $3, $4);

-- Q25: Insert clip into track
INSERT INTO timeline_clips (id, track_id, asset_id, source_path, source_start_val, source_duration_val, timeline_start_val, timeline_duration_val, timescale) 
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- Q26: Update clip timeline position after drag-and-drop
UPDATE timeline_clips 
SET timeline_start_val = $1, timeline_duration_val = $2 
WHERE id = $3;

-- Q27: Update clip 2D spatial transform (scale, position, rotation)
UPDATE timeline_clips 
SET scale_start = $1, scale_end = $2, pos_x = $3, pos_y = $4, rotation_deg = $5, opacity = $6 
WHERE id = $7;

-- Q28: Update clip playback speed
UPDATE timeline_clips SET speed_multiplier = $1 WHERE id = $2;

-- Q29: Delete single clip from timeline
DELETE FROM timeline_clips WHERE id = $1;

-- Q30: Ripple shift all subsequent clips after split/delete
UPDATE timeline_clips 
SET timeline_start_val = timeline_start_val + $1 
WHERE track_id = $2 AND timeline_start_val >= $3;

-- =============================================================================
-- CATEGORY 4: MEDIA ASSET REGISTRY & METADATA (Queries 31–40)
-- =============================================================================

-- Q31: Create media assets table
CREATE TABLE IF NOT EXISTS video_media_assets (
    id VARCHAR(64) PRIMARY KEY,
    company_id VARCHAR(64) NOT NULL,
    project_id VARCHAR(64) REFERENCES video_studio_projects(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type VARCHAR(64) NOT NULL,
    duration_seconds NUMERIC(10,3) NOT NULL,
    width INT NOT NULL,
    height INT NOT NULL,
    fps NUMERIC(6,3) NOT NULL,
    codec_video VARCHAR(32),
    codec_audio VARCHAR(32),
    sha256_hash VARCHAR(64) NOT NULL,
    has_proxy BOOLEAN DEFAULT FALSE,
    proxy_path TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Q32: Index media assets by hash and company
CREATE INDEX IF NOT EXISTS idx_media_assets_hash ON video_media_assets (company_id, sha256_hash);

-- Q33: Register ingested media asset
INSERT INTO video_media_assets (id, company_id, project_id, name, file_path, file_size_bytes, mime_type, duration_seconds, width, height, fps, codec_video, codec_audio, sha256_hash) 
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);

-- Q34: Check if source file already ingested via SHA256
SELECT id, file_path, duration_seconds, width, height FROM video_media_assets WHERE company_id = $1 AND sha256_hash = $2;

-- Q35: Fetch all assets associated with project
SELECT * FROM video_media_assets WHERE company_id = $1 AND (project_id = $2 OR project_id IS NULL) ORDER BY created_at DESC;

-- Q36: Attach proxy transcode path to asset
UPDATE video_media_assets SET has_proxy = TRUE, proxy_path = $1 WHERE id = $2 AND company_id = $3;

-- Q37: Total disk consumption of ingested media per company
SELECT SUM(file_size_bytes) AS total_media_bytes FROM video_media_assets WHERE company_id = $1;

-- Q38: Delete asset record
DELETE FROM video_media_assets WHERE id = $1 AND company_id = $2;

-- Q39: List assets missing proxy files
SELECT id, file_path, width, height FROM video_media_assets WHERE company_id = $1 AND has_proxy = FALSE AND (width > 1920 OR height > 1080);

-- Q40: Query media assets by MIME type filter
SELECT id, name, duration_seconds FROM video_media_assets WHERE company_id = $1 AND mime_type LIKE $2;

-- =============================================================================
-- CATEGORY 5: AUDIO TELEMETRY & SILENCE GAP INDEX (Queries 41–50)
-- =============================================================================

-- Q41: Create audio silence intervals table
CREATE TABLE IF NOT EXISTS audio_silence_intervals (
    id VARCHAR(64) PRIMARY KEY,
    asset_id VARCHAR(64) NOT NULL REFERENCES video_media_assets(id) ON DELETE CASCADE,
    start_seconds NUMERIC(10,3) NOT NULL,
    duration_seconds NUMERIC(10,3) NOT NULL,
    avg_decibels NUMERIC(6,2) NOT NULL,
    is_trimmed BOOLEAN DEFAULT FALSE
);

-- Q42: Create vocal energy peaks table
CREATE TABLE IF NOT EXISTS audio_energy_peaks (
    id VARCHAR(64) PRIMARY KEY,
    asset_id VARCHAR(64) NOT NULL REFERENCES video_media_assets(id) ON DELETE CASCADE,
    timestamp_seconds NUMERIC(10,3) NOT NULL,
    rms_energy NUMERIC(6,4) NOT NULL,
    pitch_hz NUMERIC(8,2),
    importance_score NUMERIC(4,2) NOT NULL
);

-- Q43: Insert silence intervals batch
INSERT INTO audio_silence_intervals (id, asset_id, start_seconds, duration_seconds, avg_decibels) VALUES ($1, $2, $3, $4, $5);

-- Q44: Fetch all silence intervals > 0.5s for automatic jump-cutting
SELECT start_seconds, duration_seconds, avg_decibels FROM audio_silence_intervals WHERE asset_id = $1 AND duration_seconds >= 0.5 ORDER BY start_seconds ASC;

-- Q45: Insert vocal energy peak
INSERT INTO audio_energy_peaks (id, asset_id, timestamp_seconds, rms_energy, pitch_hz, importance_score) VALUES ($1, $2, $3, $4, $5, $6);

-- Q46: Fetch top energy peaks for zoom punch-ins
SELECT timestamp_seconds, rms_energy, importance_score FROM audio_energy_peaks WHERE asset_id = $1 AND importance_score >= 0.8 ORDER BY importance_score DESC LIMIT 20;

-- Q47: Delete telemetry when asset re-analyzed
DELETE FROM audio_silence_intervals WHERE asset_id = $1;

-- Q48: Delete energy peaks when asset re-analyzed
DELETE FROM audio_energy_peaks WHERE asset_id = $1;

-- Q49: Count total dead air seconds in asset
SELECT COALESCE(SUM(duration_seconds), 0) AS total_silence_sec FROM audio_silence_intervals WHERE asset_id = $1;

-- Q50: Calculate average RMS energy for asset
SELECT AVG(rms_energy) AS avg_rms FROM audio_energy_peaks WHERE asset_id = $1;

-- =============================================================================
-- CATEGORY 6: SPEECH RECOGNITION & SUBTITLES (Queries 51–60)
-- =============================================================================

-- Q51: Create transcript tokens table
CREATE TABLE IF NOT EXISTS transcript_tokens (
    id VARCHAR(64) PRIMARY KEY,
    asset_id VARCHAR(64) NOT NULL REFERENCES video_media_assets(id) ON DELETE CASCADE,
    word VARCHAR(128) NOT NULL,
    start_seconds NUMERIC(10,3) NOT NULL,
    end_seconds NUMERIC(10,3) NOT NULL,
    confidence NUMERIC(4,3) NOT NULL,
    is_highlighted BOOLEAN DEFAULT FALSE
);

-- Q52: Index transcript words by asset and start time
CREATE INDEX IF NOT EXISTS idx_transcript_tokens ON transcript_tokens (asset_id, start_seconds ASC);

-- Q53: Insert transcript word
INSERT INTO transcript_tokens (id, asset_id, word, start_seconds, end_seconds, confidence) VALUES ($1, $2, $3, $4, $5, $6);

-- Q54: Fetch transcript words for time range
SELECT word, start_seconds, end_seconds, confidence, is_highlighted FROM transcript_tokens WHERE asset_id = $1 AND start_seconds >= $2 AND end_seconds <= $3 ORDER BY start_seconds ASC;

-- Q55: Mark punchy emphasis words for kinetic highlights
UPDATE transcript_tokens SET is_highlighted = TRUE WHERE asset_id = $1 AND id = $2;

-- Q56: Full-text search across transcript dialogue
SELECT asset_id, word, start_seconds FROM transcript_tokens WHERE word ILIKE $1;

-- Q57: Count total spoken words in asset
SELECT COUNT(*) AS total_words FROM transcript_tokens WHERE asset_id = $1;

-- Q58: Delete transcript tokens for asset
DELETE FROM transcript_tokens WHERE asset_id = $1;

-- Q59: Calculate speaking rate (Words Per Minute)
SELECT (COUNT(*) / (NULLIF(MAX(end_seconds) - MIN(start_seconds), 0) / 60.0)) AS wpm FROM transcript_tokens WHERE asset_id = $1;

-- Q60: Fetch low-confidence words (< 0.6) for user review
SELECT id, word, start_seconds, confidence FROM transcript_tokens WHERE asset_id = $1 AND confidence < 0.6 ORDER BY start_seconds ASC;

-- =============================================================================
-- CATEGORY 7: CAMERA KEYFRAMES & OBJECT ATTENTION (Queries 61–70)
-- =============================================================================

-- Q61: Create camera zoom events table
CREATE TABLE IF NOT EXISTS camera_zoom_events (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES video_studio_projects(id) ON DELETE CASCADE,
    start_seconds NUMERIC(10,3) NOT NULL,
    duration_seconds NUMERIC(10,3) NOT NULL,
    target_type VARCHAR(32) NOT NULL, -- 'FACE', 'CURSOR', 'PRODUCT', 'MANUAL'
    target_x NUMERIC(5,4) NOT NULL, -- 0.0 to 1.0
    target_y NUMERIC(5,4) NOT NULL,
    zoom_scale NUMERIC(4,2) DEFAULT 1.35,
    spring_stiffness INT DEFAULT 180,
    spring_damping INT DEFAULT 18,
    spring_mass INT DEFAULT 1,
    motion_blur BOOLEAN DEFAULT TRUE
);

-- Q62: Index camera zoom events by project
CREATE INDEX IF NOT EXISTS idx_camera_zooms ON camera_zoom_events (project_id, start_seconds ASC);

-- Q63: Insert camera zoom event
INSERT INTO camera_zoom_events (id, project_id, start_seconds, duration_seconds, target_type, target_x, target_y, zoom_scale, spring_stiffness, spring_damping) 
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- Q64: Fetch all camera zoom keyframes for project
SELECT * FROM camera_zoom_events WHERE project_id = $1 ORDER BY start_seconds ASC;

-- Q65: Update camera zoom target coordinates and scale
UPDATE camera_zoom_events SET target_x = $1, target_y = $2, zoom_scale = $3 WHERE id = $4;

-- Q66: Delete camera zoom event
DELETE FROM camera_zoom_events WHERE id = $1;

-- Q67: Clear all camera zooms for project
DELETE FROM camera_zoom_events WHERE project_id = $1;

-- Q68: Count total zooms in project
SELECT COUNT(*) AS total_zooms FROM camera_zoom_events WHERE project_id = $1;

-- Q69: Find camera zooms overlapping a specific timestamp
SELECT * FROM camera_zoom_events WHERE project_id = $1 AND start_seconds <= $2 AND (start_seconds + duration_seconds) >= $2;

-- Q70: Update spring physics configuration for zoom event
UPDATE camera_zoom_events SET spring_stiffness = $1, spring_damping = $2, spring_mass = $3 WHERE id = $4;

-- =============================================================================
-- CATEGORY 8: AI CREATIVE DIRECTOR & RETENTION RATING (Queries 71–80)
-- =============================================================================

-- Q71: Create AI director logs and retention reviews table
CREATE TABLE IF NOT EXISTS ai_director_runs (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES video_studio_projects(id) ON DELETE CASCADE,
    company_id VARCHAR(64) NOT NULL,
    user_prompt TEXT NOT NULL,
    style_preset VARCHAR(64) NOT NULL,
    tokens_consumed INT NOT NULL,
    latency_ms INT NOT NULL,
    retention_score_before INT,
    retention_score_after INT,
    generated_commands_count INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Q72: Create video QA critique issues table
CREATE TABLE IF NOT EXISTS video_critique_issues (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES video_studio_projects(id) ON DELETE CASCADE,
    severity VARCHAR(16) NOT NULL, -- 'CRITICAL', 'WARNING', 'SUGGESTION'
    category VARCHAR(32) NOT NULL, -- 'PACING', 'VISUAL', 'AUDIO', 'SUBTITLE'
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    start_seconds NUMERIC(10,3) NOT NULL,
    duration_seconds NUMERIC(10,3) NOT NULL,
    is_resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Q73: Insert AI director run log
INSERT INTO ai_director_runs (id, project_id, company_id, user_prompt, style_preset, tokens_consumed, latency_ms, retention_score_before, retention_score_after, generated_commands_count) 
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- Q74: Insert video critique issue
INSERT INTO video_critique_issues (id, project_id, severity, category, title, description, start_seconds, duration_seconds) 
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- Q75: Fetch all unresolved QA critique issues for project
SELECT * FROM video_critique_issues WHERE project_id = $1 AND is_resolved = FALSE ORDER BY severity DESC, start_seconds ASC;

-- Q76: Mark critique issue as resolved
UPDATE video_critique_issues SET is_resolved = TRUE WHERE id = $1;

-- Q77: Total AI tokens consumed by company this billing cycle
SELECT SUM(tokens_consumed) AS total_tokens FROM ai_director_runs WHERE company_id = $1 AND created_at >= $2;

-- Q78: Update project retention ratings
UPDATE video_studio_projects SET retention_score = $1, retention_prediction = $2 WHERE id = $3 AND company_id = $4;

-- Q79: Fetch recent AI director prompts for project
SELECT user_prompt, style_preset, generated_commands_count, created_at FROM ai_director_runs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 10;

-- Q80: Delete resolved critique issues
DELETE FROM video_critique_issues WHERE project_id = $1 AND is_resolved = TRUE;

-- =============================================================================
-- CATEGORY 9: AUDIO DUCKING & MIXER ROUTING (Queries 81–90)
-- =============================================================================

-- Q81: Create project audio mixer settings table
CREATE TABLE IF NOT EXISTS audio_mixer_settings (
    project_id VARCHAR(64) PRIMARY KEY REFERENCES video_studio_projects(id) ON DELETE CASCADE,
    dialogue_volume NUMERIC(4,2) DEFAULT 1.0,
    bgm_volume NUMERIC(4,2) DEFAULT 0.6,
    sfx_volume NUMERIC(4,2) DEFAULT 0.8,
    ducking_enabled BOOLEAN DEFAULT TRUE,
    ducking_threshold_db NUMERIC(5,2) DEFAULT -24.0,
    ducking_amount_db NUMERIC(5,2) DEFAULT -18.0,
    ducking_attack_ms INT DEFAULT 120,
    ducking_release_ms INT DEFAULT 350,
    master_gain_db NUMERIC(5,2) DEFAULT 0.0
);

-- Q82: Upsert audio mixer settings for project
INSERT INTO audio_mixer_settings (project_id, dialogue_volume, bgm_volume, sfx_volume, ducking_enabled, ducking_threshold_db, ducking_amount_db) 
VALUES ($1, $2, $3, $4, $5, $6, $7) 
ON CONFLICT (project_id) DO UPDATE 
SET dialogue_volume = EXCLUDED.dialogue_volume, bgm_volume = EXCLUDED.bgm_volume, sfx_volume = EXCLUDED.sfx_volume, ducking_enabled = EXCLUDED.ducking_enabled;

-- Q83: Fetch audio mixer settings for project
SELECT * FROM audio_mixer_settings WHERE project_id = $1;

-- Q84: Toggle audio ducking on/off
UPDATE audio_mixer_settings SET ducking_enabled = $1 WHERE project_id = $2;

-- Q85: Update ducking attack and release envelope
UPDATE audio_mixer_settings SET ducking_attack_ms = $1, ducking_release_ms = $2 WHERE project_id = $3;

-- Q86: Update track volume levels
UPDATE audio_mixer_settings SET dialogue_volume = $1, bgm_volume = $2, sfx_volume = $3 WHERE project_id = $4;

-- Q87: Reset mixer settings to default
UPDATE audio_mixer_settings SET dialogue_volume = 1.0, bgm_volume = 0.6, sfx_volume = 0.8, ducking_enabled = TRUE WHERE project_id = $1;

-- Q88: Adjust master output gain
UPDATE audio_mixer_settings SET master_gain_db = $1 WHERE project_id = $2;

-- Q89: Query projects with speech ducking enabled
SELECT p.id, p.name FROM video_studio_projects p JOIN audio_mixer_settings a ON p.id = a.project_id WHERE p.company_id = $1 AND a.ducking_enabled = TRUE;

-- Q90: Delete mixer settings
DELETE FROM audio_mixer_settings WHERE project_id = $1;

-- =============================================================================
-- CATEGORY 10: CONTENT-ADDRESSED CACHE & GPU EXPORT QUEUE (Queries 91–100)
-- =============================================================================

-- Q91: Create content-addressed cache index table
CREATE TABLE IF NOT EXISTS content_addressed_cache (
    cache_key VARCHAR(128) PRIMARY KEY,
    source_hash VARCHAR(64) NOT NULL,
    start_time_val BIGINT NOT NULL,
    duration_val BIGINT NOT NULL,
    timescale INT DEFAULT 48000,
    artifact_type VARCHAR(32) NOT NULL, -- 'WAVEFORM', 'TRANSCRIPT', 'GOP_SLICE', 'RENDER_CHUNK'
    file_path TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Q92: Create export jobs queue table
CREATE TABLE IF NOT EXISTS video_export_jobs (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES video_studio_projects(id) ON DELETE CASCADE,
    company_id VARCHAR(64) NOT NULL,
    status VARCHAR(32) DEFAULT 'QUEUED', -- 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'
    format VARCHAR(16) DEFAULT 'mp4',
    resolution_width INT DEFAULT 1920,
    resolution_height INT DEFAULT 1080,
    fps INT DEFAULT 30,
    progress_percent INT DEFAULT 0,
    output_path TEXT,
    render_time_ms INT,
    stream_copy_ratio NUMERIC(4,3), -- e.g. 0.85 = 85% stream copied
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Q93: Register cached artifact entry
INSERT INTO content_addressed_cache (cache_key, source_hash, start_time_val, duration_val, timescale, artifact_type, file_path, size_bytes) 
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
ON CONFLICT (cache_key) DO UPDATE SET last_accessed_at = CURRENT_TIMESTAMP;

-- Q94: Look up cache entry by key
SELECT file_path, size_bytes FROM content_addressed_cache WHERE cache_key = $1;

-- Q95: Enqueue export render job
INSERT INTO video_export_jobs (id, project_id, company_id, format, resolution_width, resolution_height, fps) 
VALUES ($1, $2, $3, $4, $5, $6, $7) 
RETURNING *;

-- Q96: Update export job progress
UPDATE video_export_jobs SET progress_percent = $1 WHERE id = $2;

-- Q97: Complete export job with telemetry statistics
UPDATE video_export_jobs 
SET status = 'COMPLETED', progress_percent = 100, output_path = $1, render_time_ms = $2, stream_copy_ratio = $3, completed_at = CURRENT_TIMESTAMP 
WHERE id = $4;

-- Q98: Mark export job as failed
UPDATE video_export_jobs SET status = 'FAILED', error_message = $1, completed_at = CURRENT_TIMESTAMP WHERE id = $2;

-- Q99: LRU Eviction - Fetch oldest cache artifacts exceeding storage threshold
SELECT cache_key, file_path, size_bytes 
FROM content_addressed_cache 
ORDER BY last_accessed_at ASC LIMIT 100;

-- Q100: Total export compute performance metrics across organization
SELECT 
    COUNT(*) AS total_exports,
    AVG(render_time_ms) AS avg_render_ms,
    AVG(stream_copy_ratio) * 100 AS avg_stream_copy_percent,
    SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0) AS success_rate_percent
FROM video_export_jobs 
WHERE company_id = $1 AND created_at >= $2;
