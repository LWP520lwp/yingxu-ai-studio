CREATE TABLE video_caption_job (
  id VARCHAR(36) PRIMARY KEY,
  owner_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  asset_id VARCHAR(36) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'queued',
  segments JSON NULL,
  error_message VARCHAR(1000) NULL,
  lease_token VARCHAR(36) NULL,
  lease_until TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_caption_dispatch(status,created_at),
  KEY ix_caption_asset(owner_id,project_id,asset_id,status),
  CONSTRAINT fk_caption_owner FOREIGN KEY(owner_id) REFERENCES app_user(id),
  CONSTRAINT fk_caption_project FOREIGN KEY(project_id) REFERENCES project(id) ON DELETE CASCADE,
  CONSTRAINT fk_caption_asset FOREIGN KEY(asset_id) REFERENCES asset(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE video_caption_dispatch_lock (id TINYINT PRIMARY KEY) ENGINE=InnoDB;
INSERT INTO video_caption_dispatch_lock(id) VALUES(1);
