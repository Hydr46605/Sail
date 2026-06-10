import { describe, expect, test } from "vitest";
import { createRegistryDatabase, destroyRegistryDatabase } from "../src/db/database.js";
import { requireLocalTestDatabaseUrl } from "./db-test-support.js";
import type { Insertable, Selectable } from "kysely";
import type {
  AccountsTable,
  AuditEventsTable,
  AuthChallengesTable,
  RegistriesTable,
  RegistrySigningKeysTable,
  RegistryDatabase,
  ServersTable,
  SessionsTable,
  TrustedIssuersTable,
} from "../src/db/schema.js";

function expectType<T>(_value: T): void {
  // Compile-only type assertion helper.
}

describe("registry database helpers", () => {
  test("expose typed Kysely database helpers", async () => {
    const db = createRegistryDatabase({
      databaseUrl: "postgres://sail:sail_dev_password@127.0.0.1:15432/sail",
    });
    const typed: RegistryDatabase = db;
    expect(typed).toBe(db);
    await destroyRegistryDatabase(db);
  });

  test("expose timestamp columns with selected and insert shapes", () => {
    expectType<Date>(undefined as unknown as Selectable<AccountsTable>["created_at"]);
    expectType<Date | null>(undefined as unknown as Selectable<AccountsTable>["last_seen_at"]);
    expectType<Date>(undefined as unknown as Selectable<SessionsTable>["expires_at"]);
    expectType<Date | null>(undefined as unknown as Selectable<SessionsTable>["completed_at"]);
    expectType<Date | null>(undefined as unknown as Selectable<ServersTable>["last_successful_verification_at"]);

    const validSessionInsert: Insertable<SessionsTable> = {
      id: "session-1",
      server_id: "server-1",
      expires_at: new Date(),
      risk_snapshot: {},
      status: "pending",
    };
    expect(validSessionInsert.expires_at).toBeInstanceOf(Date);

    // @ts-expect-error session expires_at is required on insert.
    const missingRequiredTimestamp: Insertable<SessionsTable> = {
      id: "session-2",
      server_id: "server-1",
      risk_snapshot: {},
      status: "pending",
    };
    expect(missingRequiredTimestamp).toBeDefined();

    // @ts-expect-error session server_id is required on insert.
    const missingSessionServerId: Insertable<SessionsTable> = {
      id: "session-3",
      expires_at: new Date(),
      risk_snapshot: {},
      status: "pending",
    };
    expect(missingSessionServerId).toBeDefined();
  });

  test("expose JSON and array columns with default-aware insert shapes", () => {
    const defaultedRiskSnapshotInsert: Insertable<SessionsTable> = {
      id: "session-4",
      server_id: "server-1",
      expires_at: new Date(),
      status: "pending",
    };
    expect(defaultedRiskSnapshotInsert.risk_snapshot).toBeUndefined();

    const validTrustedIssuerInsert: Insertable<TrustedIssuersTable> = {
      id: "trusted-issuer-1",
      registry_id: "registry-1",
      issuer_registry_id: "issuer-registry-1",
      api_url: "https://issuer.example.test",
      public_key_set: { keys: [] },
      status: "active",
    };
    expect(validTrustedIssuerInsert.trust_scope).toBeUndefined();

    // @ts-expect-error trusted issuer public_key_set is required on insert.
    const missingPublicKeySet: Insertable<TrustedIssuersTable> = {
      id: "trusted-issuer-2",
      registry_id: "registry-1",
      issuer_registry_id: "issuer-registry-2",
      api_url: "https://issuer-2.example.test",
      trust_scope: [],
      status: "active",
    };
    expect(missingPublicKeySet).toBeDefined();

    const validSigningKeyInsert: Insertable<RegistrySigningKeysTable> = {
      id: "signing-key-1",
      registry_id: "registry-1",
      kid: "dev-es256-2026-06",
      public_jwk: {
        kty: "EC",
        crv: "P-256",
        x: "public-x",
        y: "public-y",
      },
      private_jwk: {
        kty: "EC",
        crv: "P-256",
        x: "public-x",
        y: "public-y",
        d: "private-d",
      },
      source: "env",
      fingerprint: "a".repeat(64),
      not_before: new Date(),
      not_after: null,
      revoked_at: null,
    };
    expect(validSigningKeyInsert.alg).toBeUndefined();
    expect(validSigningKeyInsert.status).toBeUndefined();

    const validServerInsert: Insertable<ServersTable> = {
      id: "server-row-1",
      registry_id: "registry-1",
      server_id: "local-survival",
      display_name: "Local Survival",
      owner_account_id: null,
      registry_mode: "self_hosted",
      allowed_claim_types: ["LOCAL_SOFT"],
      session_reuse_policy: "same_registry",
      privacy_mode: "minimal",
    };
    expect(validServerInsert.status).toBeUndefined();
    expect(validServerInsert.public_listing).toBeUndefined();

    // @ts-expect-error server display_name is required on insert.
    const missingServerDisplayName: Insertable<ServersTable> = {
      id: "server-row-2",
      registry_id: "registry-1",
      server_id: "local-creative",
      owner_account_id: null,
      registry_mode: "self_hosted",
      allowed_claim_types: ["LOCAL_SOFT"],
      session_reuse_policy: "same_registry",
      privacy_mode: "minimal",
    };
    expect(missingServerDisplayName).toBeDefined();
  });

  test("exposes typed registry signing key insert builder", async () => {
    const db = createRegistryDatabase({
      databaseUrl: "postgres://sail:sail_dev_password@127.0.0.1:15432/sail",
    });

    try {
      const signingKeyInsert = db.insertInto("registry_signing_keys").values({
        id: "signing-key-2",
        registry_id: "registry-1",
        kid: "dev-es256-2026-06",
        public_jwk: {
          kty: "EC",
          crv: "P-256",
          x: "public-x",
          y: "public-y",
        },
        private_jwk: {
          kty: "EC",
          crv: "P-256",
          x: "public-x",
          y: "public-y",
          d: "private-d",
        },
      });
      expect(signingKeyInsert).toBeDefined();

      const serverInsert = db.insertInto("servers").values({
        id: "server-row-3",
        registry_id: "registry-1",
        server_id: "local-survival",
        display_name: "Local Survival",
        owner_account_id: null,
        registry_mode: "self_hosted",
        allowed_claim_types: ["LOCAL_SOFT"],
        session_reuse_policy: "same_registry",
        privacy_mode: "minimal",
      });
      expect(serverInsert).toBeDefined();
    } finally {
      await destroyRegistryDatabase(db);
    }
  });

  test("expose defaulted scalar columns as optional on insert", () => {
    const accountInsert: Insertable<AccountsTable> = {
      id: "account-1",
      primary_display_name: null,
    };
    expect(accountInsert.status).toBeUndefined();
    expect(accountInsert.risk_level).toBeUndefined();

    const authChallengeInsert: Insertable<AuthChallengesTable> = {
      id: "challenge-1",
      server_id: "server-1",
      requested_name: "PlayerOne",
      canonical_name: "playerone",
      connection_id_hash: "connection-hash",
      challenge_code_hash: "challenge-hash",
      mode: "kick",
      account_id: null,
      minecraft_identity_id: null,
      name_claim_id: null,
      session_id: null,
      expires_at: new Date(),
    };
    expect(authChallengeInsert.status).toBeUndefined();

    // @ts-expect-error auth challenge server_id is required on insert.
    const missingAuthChallengeServerId: Insertable<AuthChallengesTable> = {
      id: "challenge-2",
      requested_name: "PlayerTwo",
      canonical_name: "playertwo",
      connection_id_hash: "connection-hash-2",
      challenge_code_hash: "challenge-hash-2",
      mode: "kick",
      account_id: null,
      minecraft_identity_id: null,
      name_claim_id: null,
      session_id: null,
      expires_at: new Date(),
    };
    expect(missingAuthChallengeServerId).toBeDefined();

    const auditEventInsert: Insertable<AuditEventsTable> = {
      id: "audit-1",
      actor_account_id: null,
      target_account_id: null,
      event_type: "account_created",
    };
    expect(auditEventInsert.severity).toBeUndefined();
    expect(auditEventInsert.metadata_json).toBeUndefined();

    const registryInsert: Insertable<RegistriesTable> = {
      id: "registry-1",
      registry_id: "registry-1",
      display_name: "Registry One",
      api_url: "https://registry.example.test",
      jwks_url: "https://registry.example.test/.well-known/jwks.json",
    };
    expect(registryInsert.trust_status).toBeUndefined();

    // @ts-expect-error registry_id is required on insert.
    const missingRegistryId: Insertable<RegistriesTable> = {
      id: "registry-2",
      display_name: "Registry Two",
      api_url: "https://registry-2.example.test",
      jwks_url: "https://registry-2.example.test/.well-known/jwks.json",
    };
    expect(missingRegistryId).toBeDefined();
  });

  test("guards destructive local database resets", () => {
    expect(requireLocalTestDatabaseUrl("postgresql://sail:sail_dev_password@localhost:15432/sail")).toBe(
      "postgresql://sail:sail_dev_password@localhost:15432/sail",
    );

    expect(() => requireLocalTestDatabaseUrl("mysql://sail:secret@localhost:15432/sail")).toThrow(
      "Refusing to reset non-local Sail test database",
    );
    expect(() => requireLocalTestDatabaseUrl("postgres://root:secret@localhost:15432/sail")).toThrow(
      "Refusing to reset non-local Sail test database",
    );

    try {
      requireLocalTestDatabaseUrl("postgres://root:secret@localhost:15432/sail");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("***");
      expect(message).not.toContain("secret");
    }

    try {
      requireLocalTestDatabaseUrl("postgres://root@localhost:15432/sail?password=secret");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("password=***");
      expect(message).not.toContain("secret");
    }

    const targetOverrideUrl =
      "postgres://sail:sail_dev_password@127.0.0.1:15432/sail?host=evil.example&port=5432&user=root&password=querysecret";
    expect(() => requireLocalTestDatabaseUrl(targetOverrideUrl)).toThrow(
      "Refusing to reset non-local Sail test database",
    );

    try {
      requireLocalTestDatabaseUrl(targetOverrideUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("password=***");
      expect(message).not.toContain("querysecret");
    }

    expect(requireLocalTestDatabaseUrl("postgres://sail@127.0.0.1:15432/sail?password=querysecret")).toBe(
      "postgres://sail@127.0.0.1:15432/sail?password=querysecret",
    );

    expect(() =>
      requireLocalTestDatabaseUrl("postgres://sail:sail_dev_password@127.0.0.1:15432/sail?application_name=sail"),
    ).toThrow("Refusing to reset non-local Sail test database");
  });
});
