CREATE TABLE app_user (
  id VARCHAR(36) PRIMARY KEY,
  provider VARCHAR(20) NOT NULL,
  external_id VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  avatar_url VARCHAR(1024) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_user_provider (provider, external_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE project (
  id VARCHAR(36) PRIMARY KEY,
  owner_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  document JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_project_owner_updated (owner_id, updated_at, id),
  CONSTRAINT fk_project_owner FOREIGN KEY (owner_id) REFERENCES app_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE project_revision (
  project_id VARCHAR(36) NOT NULL,
  revision BIGINT NOT NULL,
  title VARCHAR(255) NOT NULL,
  document JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(project_id, revision),
  CONSTRAINT fk_revision_project FOREIGN KEY (project_id) REFERENCES project(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE asset (
  id VARCHAR(36) PRIMARY KEY,
  owner_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NULL,
  display_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_name VARCHAR(100) NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  source_job_id VARCHAR(36) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_asset_owner_project (owner_id, project_id, created_at),
  CONSTRAINT fk_asset_owner FOREIGN KEY (owner_id) REFERENCES app_user(id),
  CONSTRAINT fk_asset_project FOREIGN KEY (project_id) REFERENCES project(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE generation_job (
  id VARCHAR(36) PRIMARY KEY,
  owner_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  node_id VARCHAR(128) NOT NULL,
  input_revision BIGINT NOT NULL,
  kind VARCHAR(16) NOT NULL,
  prompt TEXT NOT NULL,
  model VARCHAR(120) NOT NULL,
  request_json JSON NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  provider_task_id VARCHAR(255) NULL,
  result_asset_id VARCHAR(36) NULL,
  error_message VARCHAR(2000) NULL,
  lease_token VARCHAR(36) NULL,
  lease_until TIMESTAMP(3) NULL,
  next_run_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_job_idempotency(owner_id, idempotency_key),
  KEY ix_job_owner_project(owner_id, project_id, created_at),
  KEY ix_job_dispatch(status, next_run_at, lease_until),
  CONSTRAINT fk_job_owner FOREIGN KEY (owner_id) REFERENCES app_user(id),
  CONSTRAINT fk_job_project FOREIGN KEY (project_id) REFERENCES project(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
