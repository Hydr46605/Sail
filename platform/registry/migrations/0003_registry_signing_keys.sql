CREATE TABLE IF NOT EXISTS registry_signing_keys (
  id uuid PRIMARY KEY,
  registry_id text NOT NULL,
  kid text NOT NULL,
  alg text NOT NULL DEFAULT 'ES256',
  public_jwk jsonb NOT NULL,
  private_jwk jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  CONSTRAINT registry_signing_keys_registry_id_format CHECK (registry_id ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
  CONSTRAINT registry_signing_keys_kid_length CHECK (length(kid) BETWEEN 4 AND 128),
  CONSTRAINT registry_signing_keys_alg_es256 CHECK (alg = 'ES256'),
  CONSTRAINT registry_signing_keys_status_known CHECK (status IN ('active', 'retiring', 'retired', 'revoked')),
  CONSTRAINT registry_signing_keys_public_jwk_object CHECK (jsonb_typeof(public_jwk) = 'object'),
  CONSTRAINT registry_signing_keys_private_jwk_object CHECK (jsonb_typeof(private_jwk) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS registry_signing_keys_registry_kid_unique
  ON registry_signing_keys (registry_id, kid);

CREATE UNIQUE INDEX IF NOT EXISTS registry_signing_keys_one_active_idx
  ON registry_signing_keys (registry_id)
  WHERE status = 'active';
