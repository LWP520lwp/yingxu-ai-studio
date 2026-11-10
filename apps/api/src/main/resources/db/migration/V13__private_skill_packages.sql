CREATE TABLE user_skill_package (
  skill_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_id VARCHAR(36) NOT NULL,
  source_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipe_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_format VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  imported_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (skill_id),
  UNIQUE KEY uq_private_skill_source (owner_id, source_id),
  KEY ix_private_skill_owner (owner_id, updated_at, skill_id),
  CONSTRAINT fk_private_skill_owner FOREIGN KEY (owner_id) REFERENCES app_user(id),
  CONSTRAINT fk_private_skill_version FOREIGN KEY (skill_id, recipe_version)
    REFERENCES skill_definition(skill_id, recipe_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
