CREATE TABLE skill_definition (
  skill_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipe_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  manifest JSON NOT NULL,
  manifest_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (skill_id, recipe_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_skill_installation (
  owner_id VARCHAR(36) NOT NULL,
  skill_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipe_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  installed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (owner_id, skill_id),
  KEY ix_skill_installation_version (skill_id, recipe_version),
  CONSTRAINT fk_skill_installation_owner FOREIGN KEY (owner_id) REFERENCES app_user(id),
  CONSTRAINT fk_skill_installation_version FOREIGN KEY (skill_id, recipe_version)
    REFERENCES skill_definition(skill_id, recipe_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

