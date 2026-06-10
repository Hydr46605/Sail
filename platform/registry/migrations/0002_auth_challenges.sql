CREATE TYPE sail_auth_challenge_mode AS ENUM (
  'kick',
  'limbo',
  'hybrid'
);

CREATE TYPE sail_auth_challenge_status AS ENUM (
  'pending',
  'completed',
  'expired',
  'revoked',
  'denied'
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id uuid PRIMARY KEY,
  server_id text NOT NULL,
  requested_name text NOT NULL,
  canonical_name text NOT NULL,
  connection_id_hash text NOT NULL,
  challenge_code_hash text NOT NULL,
  mode sail_auth_challenge_mode NOT NULL,
  status sail_auth_challenge_status NOT NULL DEFAULT 'pending',
  account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  minecraft_identity_id uuid REFERENCES minecraft_identities(id) ON DELETE RESTRICT,
  name_claim_id uuid REFERENCES name_claims(id) ON DELETE RESTRICT,
  session_id uuid REFERENCES sessions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT auth_challenges_server_id_nonempty CHECK (length(server_id) BETWEEN 1 AND 96),
  CONSTRAINT auth_challenges_requested_name_length CHECK (length(requested_name) BETWEEN 3 AND 16),
  CONSTRAINT auth_challenges_canonical_name_format CHECK (canonical_name ~ '^[a-z0-9_]{3,16}$'),
  CONSTRAINT auth_challenges_completion_requires_identity CHECK (
    status <> 'completed'
    OR (
      account_id IS NOT NULL
      AND minecraft_identity_id IS NOT NULL
      AND name_claim_id IS NOT NULL
      AND session_id IS NOT NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_challenges_code_hash_unique
  ON auth_challenges (challenge_code_hash);

CREATE INDEX IF NOT EXISTS auth_challenges_status_expires_idx
  ON auth_challenges (status, expires_at);

CREATE INDEX IF NOT EXISTS auth_challenges_account_created_idx
  ON auth_challenges (account_id, created_at DESC)
  WHERE account_id IS NOT NULL;
