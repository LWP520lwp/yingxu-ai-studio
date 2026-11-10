CREATE TABLE project_canvas_story (
  project_id VARCHAR(36) PRIMARY KEY,
  revision BIGINT NOT NULL DEFAULT 1,
  document JSON NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_canvas_story_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);
CREATE TABLE canvas_story_task (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  owner_id VARCHAR(36) NOT NULL,
  base_revision BIGINT NOT NULL,
  operation VARCHAR(16) NOT NULL,
  model VARCHAR(180) NOT NULL,
  model_fingerprint VARCHAR(120) NOT NULL,
  input_document JSON NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  stage VARCHAR(40) NOT NULL DEFAULT 'queued',
  error_message VARCHAR(400),
  result_revision BIGINT,
  lease_token VARCHAR(36),
  lease_until TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_story_task_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  CONSTRAINT fk_story_task_owner FOREIGN KEY (owner_id) REFERENCES app_user(id) ON DELETE CASCADE,
  INDEX ix_story_task_queue(status,created_at),
  INDEX ix_story_task_owner(owner_id,status),
  INDEX ix_story_task_project(project_id,created_at)
);
CREATE TABLE canvas_story_dispatch_lock (id INT PRIMARY KEY);
INSERT INTO canvas_story_dispatch_lock(id) VALUES(1);
