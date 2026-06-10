CREATE TABLE IF NOT EXISTS servers (
  id uuid PRIMARY KEY,
  registry_id text NOT NULL,
  server_id text NOT NULL,
  display_name text NOT NULL,
  owner_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  registry_mode text NOT NULL,
  allowed_claim_types text[] NOT NULL,
  session_reuse_policy text NOT NULL,
  privacy_mode text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  public_listing boolean NOT NULL DEFAULT false,
  last_successful_verification_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT servers_registry_id_format CHECK (registry_id ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
  CONSTRAINT servers_server_id_format CHECK (server_id ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
  CONSTRAINT servers_display_name_nonempty CHECK (length(display_name) BETWEEN 1 AND 96),
  CONSTRAINT servers_registry_mode_known CHECK (registry_mode IN ('global', 'self_hosted', 'hybrid')),
  CONSTRAINT servers_allowed_claim_types_nonempty CHECK (cardinality(allowed_claim_types) > 0),
  CONSTRAINT servers_allowed_claim_types_known CHECK (
    allowed_claim_types <@ ARRAY[
      'MINECRAFT_VERIFIED',
      'SAIL_GLOBAL',
      'FEDERATED_TRUSTED',
      'LOCAL_SOFT',
      'SOCIAL_ONLY'
    ]::text[]
  ),
  CONSTRAINT servers_session_reuse_policy_known CHECK (
    session_reuse_policy IN ('off', 'same_registry', 'allowlisted_servers', 'global_trusted')
  ),
  CONSTRAINT servers_privacy_mode_known CHECK (privacy_mode IN ('minimal', 'standard', 'audit_full')),
  CONSTRAINT servers_status_known CHECK (status IN ('active', 'disabled', 'suspended'))
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS server_id text;

UPDATE sessions
  SET server_id = 'legacy-server'
  WHERE server_id IS NULL;

ALTER TABLE sessions
  ALTER COLUMN server_id SET NOT NULL;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_server_id_nonempty CHECK (length(server_id) BETWEEN 1 AND 96);

ALTER TABLE sessions
  ADD CONSTRAINT sessions_server_id_format CHECK (server_id ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$');

CREATE UNIQUE INDEX IF NOT EXISTS servers_registry_server_unique
  ON servers (registry_id, server_id);

CREATE INDEX IF NOT EXISTS servers_registry_status_idx
  ON servers (registry_id, status);

CREATE INDEX IF NOT EXISTS sessions_server_status_idx
  ON sessions (server_id, status);
