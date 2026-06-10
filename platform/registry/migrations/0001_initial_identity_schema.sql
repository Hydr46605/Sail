CREATE TYPE sail_registry_trust_status AS ENUM (
  'global',
  'self_hosted',
  'trusted_by_admin',
  'unverified'
);

CREATE TYPE sail_account_status AS ENUM (
  'active',
  'suspended',
  'recovery_locked',
  'deleted'
);

CREATE TYPE sail_risk_level AS ENUM (
  'low',
  'medium',
  'high'
);

CREATE TYPE sail_identity_type AS ENUM (
  'MOJANG_PREMIUM',
  'SAIL_LOCAL',
  'FEDERATED'
);

CREATE TYPE sail_claim_type AS ENUM (
  'MINECRAFT_VERIFIED',
  'SAIL_GLOBAL',
  'FEDERATED_TRUSTED',
  'LOCAL_SOFT',
  'SOCIAL_ONLY'
);

CREATE TYPE sail_name_claim_status AS ENUM (
  'active',
  'displaced_by_minecraft',
  'renamed',
  'suspended',
  'expired'
);

CREATE TYPE sail_session_status AS ENUM (
  'pending',
  'completed',
  'expired',
  'revoked',
  'denied'
);

CREATE TYPE sail_audit_severity AS ENUM (
  'info',
  'warning',
  'high',
  'critical'
);

CREATE TABLE IF NOT EXISTS registries (
  id uuid PRIMARY KEY,
  registry_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  api_url text NOT NULL,
  jwks_url text NOT NULL,
  trust_status sail_registry_trust_status NOT NULL DEFAULT 'self_hosted',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registries_registry_id_format CHECK (registry_id ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$')
);

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  primary_display_name text,
  status sail_account_status NOT NULL DEFAULT 'active',
  risk_level sail_risk_level NOT NULL DEFAULT 'low',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE IF NOT EXISTS oauth_identities (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  provider_username text,
  verified_email_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  CONSTRAINT oauth_identities_provider_format CHECK (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  CONSTRAINT oauth_identities_provider_subject_nonempty CHECK (length(provider_subject) > 0),
  CONSTRAINT oauth_identities_provider_subject_unique UNIQUE (provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS minecraft_identities (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  identity_type sail_identity_type NOT NULL,
  minecraft_uuid uuid NOT NULL,
  mojang_uuid uuid,
  issuer_registry_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT minecraft_identities_mojang_required_for_premium CHECK (
    (identity_type = 'MOJANG_PREMIUM' AND mojang_uuid IS NOT NULL)
    OR (identity_type <> 'MOJANG_PREMIUM')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS minecraft_identities_minecraft_uuid_unique
  ON minecraft_identities (minecraft_uuid);

CREATE UNIQUE INDEX IF NOT EXISTS minecraft_identities_mojang_uuid_unique
  ON minecraft_identities (mojang_uuid)
  WHERE mojang_uuid IS NOT NULL;

CREATE TABLE IF NOT EXISTS name_claims (
  id uuid PRIMARY KEY,
  canonical_name text NOT NULL,
  display_name text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  minecraft_identity_id uuid NOT NULL REFERENCES minecraft_identities(id) ON DELETE CASCADE,
  claim_type sail_claim_type NOT NULL,
  issuer_registry_id text NOT NULL,
  status sail_name_claim_status NOT NULL DEFAULT 'active',
  priority integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  displaced_by_claim_id uuid REFERENCES name_claims(id) ON DELETE SET NULL,
  CONSTRAINT name_claims_canonical_name_format CHECK (canonical_name ~ '^[a-z0-9_]{3,16}$'),
  CONSTRAINT name_claims_display_name_length CHECK (length(display_name) BETWEEN 3 AND 16),
  CONSTRAINT name_claims_priority_range CHECK (priority BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS name_claims_active_name_registry_unique
  ON name_claims (canonical_name, issuer_registry_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS name_claims_account_status_idx
  ON name_claims (account_id, status);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  minecraft_identity_id uuid REFERENCES minecraft_identities(id) ON DELETE CASCADE,
  name_claim_id uuid REFERENCES name_claims(id) ON DELETE CASCADE,
  session_token_hash text,
  challenge_code_hash text,
  client_ip_hash text,
  risk_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status sail_session_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT sessions_token_or_challenge_required CHECK (
    session_token_hash IS NOT NULL OR challenge_code_hash IS NOT NULL
  ),
  CONSTRAINT sessions_completion_requires_identity CHECK (
    status <> 'completed'
    OR (
      account_id IS NOT NULL
      AND minecraft_identity_id IS NOT NULL
      AND name_claim_id IS NOT NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_session_token_hash_unique
  ON sessions (session_token_hash)
  WHERE session_token_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_challenge_code_hash_unique
  ON sessions (challenge_code_hash)
  WHERE challenge_code_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS sessions_account_status_idx
  ON sessions (account_id, status);

CREATE TABLE IF NOT EXISTS trusted_issuers (
  id uuid PRIMARY KEY,
  registry_id text NOT NULL,
  issuer_registry_id text NOT NULL,
  api_url text NOT NULL,
  public_key_set jsonb NOT NULL,
  trust_scope text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trusted_issuers_registry_id_format CHECK (registry_id ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
  CONSTRAINT trusted_issuers_issuer_registry_id_format CHECK (issuer_registry_id ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
  CONSTRAINT trusted_issuers_status_known CHECK (status IN ('active', 'disabled', 'revoked')),
  CONSTRAINT trusted_issuers_pair_unique UNIQUE (registry_id, issuer_registry_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  actor_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  target_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  severity sail_audit_severity NOT NULL DEFAULT 'info',
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_event_type_format CHECK (event_type ~ '^[a-z][a-z0-9_]{2,63}$')
);

CREATE INDEX IF NOT EXISTS audit_events_target_created_idx
  ON audit_events (target_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_event_type_created_idx
  ON audit_events (event_type, created_at DESC);

