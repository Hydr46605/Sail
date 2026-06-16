CREATE TABLE IF NOT EXISTS server_api_key_claims (
  id uuid PRIMARY KEY,
  server_id text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  claim_code_hash text NOT NULL,
  api_key_jwt text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT server_api_key_claims_server_id_format CHECK (server_id ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
  CONSTRAINT server_api_key_claims_claim_code_hash_length CHECK (length(claim_code_hash) = 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS server_api_key_claims_claim_code_hash_unique
  ON server_api_key_claims (claim_code_hash);

CREATE INDEX IF NOT EXISTS server_api_key_claims_server_account_idx
  ON server_api_key_claims (server_id, account_id);

CREATE INDEX IF NOT EXISTS server_api_key_claims_expires_idx
  ON server_api_key_claims (expires_at)
  WHERE used_at IS NULL;