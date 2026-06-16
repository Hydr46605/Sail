ALTER TABLE servers ADD COLUMN IF NOT EXISTS api_key_jwk_id text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS api_key_issued_at timestamptz;

DO $$
BEGIN
  ALTER TABLE servers
    ADD CONSTRAINT servers_api_key_jwk_id_length
    CHECK (api_key_jwk_id IS NULL OR length(api_key_jwk_id) BETWEEN 4 AND 128);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS servers_owner_account_id_idx
  ON servers (owner_account_id)
  WHERE owner_account_id IS NOT NULL;