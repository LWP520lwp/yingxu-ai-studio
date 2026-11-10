CREATE TABLE project_video_editor (
  project_id VARCHAR(36) PRIMARY KEY,
  revision BIGINT NOT NULL DEFAULT 1,
  document JSON NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_video_editor_project FOREIGN KEY(project_id) REFERENCES project(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE video_editor_export (
  id VARCHAR(36) PRIMARY KEY,
  owner_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  revision BIGINT NOT NULL,
  document JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  result_asset_id VARCHAR(36) NULL,
  error_message VARCHAR(1000) NULL,
  lease_token VARCHAR(36) NULL,
  lease_until TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_video_export_dispatch(status,created_at),
  KEY ix_video_export_project(owner_id,project_id,revision),
  CONSTRAINT fk_video_export_owner FOREIGN KEY(owner_id) REFERENCES app_user(id),
  CONSTRAINT fk_video_export_project FOREIGN KEY(project_id) REFERENCES project(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Serializes the global render claim across API instances. No connection is
-- held while FFmpeg runs; its bounded lease remains in video_editor_export.
CREATE TABLE video_editor_render_lock (id TINYINT PRIMARY KEY) ENGINE=InnoDB;
INSERT INTO video_editor_render_lock(id) VALUES(1);
