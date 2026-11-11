ALTER TABLE user_generation_channel
  ADD COLUMN api_format VARCHAR(16) NOT NULL DEFAULT 'openai' AFTER base_url;

CREATE INDEX idx_channel_owner_format ON user_generation_channel(owner_id, api_format);
