CREATE INDEX ix_job_updated ON generation_job(updated_at,id);
ALTER TABLE generation_job MODIFY idempotency_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
