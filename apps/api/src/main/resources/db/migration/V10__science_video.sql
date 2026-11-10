CREATE TABLE project_science_video (
  project_id VARCHAR(36) PRIMARY KEY,
  revision BIGINT NOT NULL,
  document JSON NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_science_document_project FOREIGN KEY(project_id) REFERENCES project(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE science_video_run (
  id VARCHAR(36) PRIMARY KEY,
  owner_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  revision BIGINT NOT NULL,
  document JSON NOT NULL,
  request_hash CHAR(64) NOT NULL,
  voice_id VARCHAR(80) NOT NULL,
  generate_missing_images BOOLEAN NOT NULL DEFAULT FALSE,
  image_model VARCHAR(120) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'queued',
  stage VARCHAR(40) NOT NULL DEFAULT 'queued',
  image_jobs JSON NULL,
  resolved_assets JSON NULL,
  timeline JSON NULL,
  narration_asset_id VARCHAR(36) NULL,
  source_card_asset_id VARCHAR(36) NULL,
  subtitle_asset_id VARCHAR(36) NULL,
  result_asset_id VARCHAR(36) NULL,
  error_message VARCHAR(1000) NULL,
  lease_token VARCHAR(36) NULL,
  lease_until TIMESTAMP(3) NULL,
  next_run_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_science_dispatch(status,next_run_at,created_at),
  KEY ix_science_owner(owner_id,project_id,revision),
  CONSTRAINT fk_science_run_owner FOREIGN KEY(owner_id) REFERENCES app_user(id),
  CONSTRAINT fk_science_run_project FOREIGN KEY(project_id) REFERENCES project(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE science_video_dispatch_lock (id TINYINT PRIMARY KEY) ENGINE=InnoDB;
INSERT INTO science_video_dispatch_lock(id) VALUES(1);
