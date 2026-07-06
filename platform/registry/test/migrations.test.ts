import { describe, expect, test } from "vitest";
import { loadRegistryMigrations } from "../src/db/migrations.js";

describe("registry migrations", () => {
  test("loads SQL migrations in stable order with checksums", async () => {
    const migrations = await loadRegistryMigrations();

    expect(migrations.map((migration) => migration.name)).toEqual([
      "0001_initial_identity_schema.sql",
      "0002_auth_challenges.sql",
      "0003_registry_signing_keys.sql",
      "0004_servers_and_session_scope.sql",
      "0005_signing_key_lifecycle.sql",
      "0006_server_api_keys.sql",
      "0007_server_api_key_claims.sql",
      "0008_server_heartbeat.sql",
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(migrations[0]?.sql.trim().length).toBeGreaterThan(1000);
  });

  test("baseline migration defines required MVP identity tables and constraints", async () => {
    const [baseline] = await loadRegistryMigrations();
    expect(baseline).toBeDefined();
    const sql = baseline?.sql ?? "";

    for (const table of [
      "registries",
      "accounts",
      "oauth_identities",
      "minecraft_identities",
      "name_claims",
      "sessions",
      "trusted_issuers",
      "audit_events",
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }

    for (const invariant of [
      "sail_claim_type",
      "sail_identity_type",
      "sail_name_claim_status",
      "sail_session_status",
      "oauth_identities_provider_subject_unique",
      "minecraft_identities_minecraft_uuid_unique",
      "minecraft_identities_mojang_uuid_unique",
      "name_claims_active_name_registry_unique",
      "session_token_hash",
      "challenge_code_hash",
    ]) {
      expect(sql).toContain(invariant);
    }
  });

  test("auth challenge migration adds durable challenge records", async () => {
    const migrations = await loadRegistryMigrations();

    expect(migrations.map((migration) => migration.name)).toEqual([
      "0001_initial_identity_schema.sql",
      "0002_auth_challenges.sql",
      "0003_registry_signing_keys.sql",
      "0004_servers_and_session_scope.sql",
      "0005_signing_key_lifecycle.sql",
      "0006_server_api_keys.sql",
      "0007_server_api_key_claims.sql",
      "0008_server_heartbeat.sql",
    ]);

    const authChallengesMigration = migrations.find(
      (migration) => migration.name === "0002_auth_challenges.sql",
    );
    expect(authChallengesMigration).toBeDefined();
    const sql = authChallengesMigration?.sql ?? "";
    for (const expected of [
      "CREATE TYPE sail_auth_challenge_mode",
      "CREATE TYPE sail_auth_challenge_status",
      "CREATE TABLE IF NOT EXISTS auth_challenges",
      "connection_id_hash text NOT NULL",
      "challenge_code_hash text NOT NULL",
      "account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT",
      "minecraft_identity_id uuid REFERENCES minecraft_identities(id) ON DELETE RESTRICT",
      "name_claim_id uuid REFERENCES name_claims(id) ON DELETE RESTRICT",
      "session_id uuid REFERENCES sessions(id) ON DELETE RESTRICT",
      "CONSTRAINT auth_challenges_completion_requires_identity CHECK",
      "auth_challenges_code_hash_unique",
      "auth_challenges_status_expires_idx",
      "auth_challenges_account_created_idx",
    ]) {
      expect(sql).toContain(expected);
    }
  });

  test("signing key migration adds durable registry keys", async () => {
    const migrations = await loadRegistryMigrations();
    const signingKeysMigration = migrations.find(
      (migration) => migration.name === "0003_registry_signing_keys.sql",
    );
    expect(signingKeysMigration).toBeDefined();
    const sql = signingKeysMigration?.sql ?? "";

    for (const expected of [
      "CREATE TABLE IF NOT EXISTS registry_signing_keys",
      "registry_signing_keys_registry_kid_unique",
      "registry_signing_keys_one_active_idx",
      "registry_signing_keys_status_known",
      "length(kid) BETWEEN 4 AND 128",
    ]) {
      expect(sql).toContain(expected);
    }
  });

  test("server scope migration adds registered servers and session server ids", async () => {
    const migrations = await loadRegistryMigrations();
    const serverScopeMigration = migrations.find(
      (migration) => migration.name === "0004_servers_and_session_scope.sql",
    );
    expect(serverScopeMigration).toBeDefined();
    const sql = serverScopeMigration?.sql ?? "";

    for (const expected of [
      "CREATE TABLE IF NOT EXISTS servers",
      "sessions ADD COLUMN IF NOT EXISTS server_id text",
      "servers_registry_server_unique",
      "servers_server_id_format",
      "servers_session_reuse_policy_known",
      "sessions_server_id_nonempty",
      "sessions_server_id_format",
      "^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$",
    ]) {
      expect(sql).toContain(expected);
    }
  });

  test("signing key lifecycle migration adds custody metadata", async () => {
    const migrations = await loadRegistryMigrations();
    const lifecycleMigration = migrations.find(
      (migration) => migration.name === "0005_signing_key_lifecycle.sql",
    );
    expect(lifecycleMigration).toBeDefined();
    const sql = lifecycleMigration?.sql ?? "";

    for (const expected of [
      "registry_signing_keys ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'database'",
      "registry_signing_keys ADD COLUMN IF NOT EXISTS fingerprint text",
      "registry_signing_keys ADD COLUMN IF NOT EXISTS not_before timestamptz NOT NULL DEFAULT now()",
      "registry_signing_keys ADD COLUMN IF NOT EXISTS not_after timestamptz",
      "registry_signing_keys ADD COLUMN IF NOT EXISTS revoked_at timestamptz",
      "registry_signing_keys_source_known",
      "registry_signing_keys_fingerprint_length",
      "registry_signing_keys_verification_idx",
    ]) {
      expect(sql).toContain(expected);
    }
  });
});
