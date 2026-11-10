CREATE TABLE user_generation_channel (
  id VARCHAR(36) PRIMARY KEY,
  owner_id VARCHAR(36) NOT NULL,
  name VARCHAR(80) NOT NULL,
  base_url VARCHAR(512) NOT NULL,
  encrypted_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  models_json JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_channel_owner(owner_id),
  CONSTRAINT fk_channel_owner FOREIGN KEY(owner_id) REFERENCES app_user(id)
);
