CREATE TABLE user_skill_favorite (
    owner_id VARCHAR(36) NOT NULL,
    skill_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (owner_id, skill_id),
    CONSTRAINT fk_skill_favorite_owner FOREIGN KEY (owner_id) REFERENCES app_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
