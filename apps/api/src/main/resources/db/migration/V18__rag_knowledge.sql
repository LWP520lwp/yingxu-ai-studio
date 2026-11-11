CREATE TABLE rag_document (
  id VARCHAR(36) PRIMARY KEY,
  owner_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  source_url VARCHAR(2048) NULL,
  content_hash CHAR(64) NOT NULL,
  metadata JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_rag_document_hash(owner_id, project_id, content_hash),
  KEY ix_rag_document_project(owner_id, project_id, updated_at),
  CONSTRAINT fk_rag_document_owner FOREIGN KEY (owner_id) REFERENCES app_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_rag_document_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE rag_chunk (
  id VARCHAR(36) PRIMARY KEY,
  document_id VARCHAR(36) NOT NULL,
  owner_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  token_count INT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_rag_chunk_index(document_id, chunk_index),
  KEY ix_rag_chunk_project(owner_id, project_id, document_id),
  FULLTEXT KEY ft_rag_chunk_content(content),
  CONSTRAINT fk_rag_chunk_document FOREIGN KEY (document_id) REFERENCES rag_document(id) ON DELETE CASCADE,
  CONSTRAINT fk_rag_chunk_owner FOREIGN KEY (owner_id) REFERENCES app_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_rag_chunk_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
