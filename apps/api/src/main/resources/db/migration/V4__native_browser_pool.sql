CREATE TABLE pool_account (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  type VARCHAR(32) NOT NULL,
  provider VARCHAR(16) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  state VARCHAR(32) NOT NULL DEFAULT 'login_required',
  state_message VARCHAR(500) NULL,
  capability_image BOOLEAN NOT NULL DEFAULT FALSE,
  capability_video BOOLEAN NOT NULL DEFAULT FALSE,
  encrypted_credential TEXT NULL,
  last_checked_at TIMESTAMP(3) NULL,
  last_used_at TIMESTAMP(3) NULL,
  lease_token VARCHAR(36) NULL,
  lease_until TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_pool_route (type,provider,enabled,state,last_used_at,id),
  KEY ix_pool_lease (lease_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE generation_job
  ADD COLUMN provider_route VARCHAR(32) NULL AFTER provider_task_id,
  ADD COLUMN provider_account_id VARCHAR(36) NULL AFTER provider_route,
  ADD KEY ix_job_provider_route (provider_route,provider_account_id,status);
