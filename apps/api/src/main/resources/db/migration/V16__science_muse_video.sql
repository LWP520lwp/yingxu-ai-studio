-- Existing productions remain explicit offline narration runs. New API runs default to Muse video.
ALTER TABLE science_video_run
  ADD COLUMN production_mode VARCHAR(24) NOT NULL DEFAULT 'image_narration',
  ADD COLUMN video_model VARCHAR(120) NULL,
  ADD COLUMN video_duration INT NOT NULL DEFAULT 15,
  ADD COLUMN audio_mode VARCHAR(24) NOT NULL DEFAULT 'offline_narration',
  ADD COLUMN generate_missing_videos BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN video_jobs JSON NULL,
  ADD COLUMN resolved_videos JSON NULL;

-- Reuse only completed, validated clips, scoped to a user's project and exact request fingerprint.
CREATE TABLE science_video_clip_cache (
  owner_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  asset_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(owner_id,project_id,request_fingerprint),
  CONSTRAINT fk_science_clip_owner FOREIGN KEY(owner_id) REFERENCES app_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_science_clip_project FOREIGN KEY(project_id) REFERENCES project(id) ON DELETE CASCADE,
  CONSTRAINT fk_science_clip_asset FOREIGN KEY(asset_id) REFERENCES asset(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
