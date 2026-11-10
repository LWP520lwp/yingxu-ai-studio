ALTER TABLE pool_account
  ADD COLUMN owner_id VARCHAR(36) NULL AFTER id,
  ADD COLUMN shared BOOLEAN NOT NULL DEFAULT FALSE AFTER enabled,
  ADD KEY ix_pool_owner_route (owner_id,type,enabled,state,last_used_at,id),
  ADD KEY ix_pool_shared_route (type,shared,enabled,state,last_used_at,id),
  ADD CONSTRAINT fk_pool_account_owner FOREIGN KEY (owner_id) REFERENCES app_user(id);

-- Previous releases only permitted the local developer to create host accounts.
-- Preserve that ownership; never assign legacy sessions to the first GitHub user.
UPDATE pool_account p
JOIN app_user u ON u.provider='local' AND u.external_id='loopback-developer'
SET p.owner_id=u.id
WHERE p.owner_id IS NULL;
