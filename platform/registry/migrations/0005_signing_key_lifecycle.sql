ALTER TABLE registry_signing_keys ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'database';
ALTER TABLE registry_signing_keys ADD COLUMN IF NOT EXISTS fingerprint text;
ALTER TABLE registry_signing_keys ADD COLUMN IF NOT EXISTS not_before timestamptz NOT NULL DEFAULT now();
ALTER TABLE registry_signing_keys ADD COLUMN IF NOT EXISTS not_after timestamptz;
ALTER TABLE registry_signing_keys ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

DO $$
BEGIN
  ALTER TABLE registry_signing_keys
    ADD CONSTRAINT registry_signing_keys_source_known
    CHECK (source IN ('dev', 'env', 'file', 'database'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE registry_signing_keys
    ADD CONSTRAINT registry_signing_keys_fingerprint_length
    CHECK (fingerprint IS NULL OR fingerprint ~ '^[a-f0-9]{64}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS registry_signing_keys_verification_idx
  ON registry_signing_keys (registry_id, status, not_before, not_after)
  WHERE status IN ('active', 'retiring') AND revoked_at IS NULL;
