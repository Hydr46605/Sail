import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { importJWK, jwtVerify, type JWK } from "jose";
import { loadRegistryConfig, type SailPrivateJwk } from "../src/config.js";
import { createRegistryDatabase, destroyRegistryDatabase } from "../src/db/database.js";
import type { RegistryDatabase } from "../src/db/schema.js";
import { publicJwkFromPrivateJwk } from "../src/identity/signing-key-material.js";
import {
  loadPostgresSessionSigner,
  revokePostgresSigningKey,
  selectPostgresVerificationPublicKeys,
} from "../src/identity/signing-key-store.js";
import {
  acquireLocalTestDatabaseLock,
  localTestDatabaseUrl,
  resetLocalTestDatabase,
  type LocalTestDatabaseLock,
} from "./db-test-support.js";

const dbIntegrationTimeoutMs = 30_000;
const dbSuiteLockTimeoutMs = 180_000;
const dbResetTimeoutMs = 180_000;

const config = loadRegistryConfig({
  SAIL_REGISTRY_DATABASE_URL: localTestDatabaseUrl,
  SAIL_REGISTRY_ID: "sail-local",
});

const nextPrivateJwk: SailPrivateJwk = {
  kty: "EC",
  kid: "next-es256-2026-06",
  use: "sig",
  alg: "ES256",
  crv: "P-256",
  x: "wLY9Kkghc_xlIBPV3cQLolK3X9Fm5gC9AdwH81GFl5M",
  y: "48dZGGQVO-XM-WGOfCMZlfvQQpxpHZpzzDj-GCd_yrE",
  d: "RlCKQp2GFeIObrHQyg3B2wu8OeebPbe2M40mRFz-Ido",
};

function createNextConfig(rotation: "off" | "rotate" = "off") {
  return loadRegistryConfig({
    SAIL_REGISTRY_DATABASE_URL: localTestDatabaseUrl,
    SAIL_REGISTRY_ID: "sail-local",
    SAIL_REGISTRY_STATE_BACKEND: "postgres",
    SAIL_REGISTRY_SIGNING_KEY_SOURCE: "env",
    SAIL_REGISTRY_SIGNING_KEY_ROTATION: rotation,
    SAIL_REGISTRY_JWK_KID: nextPrivateJwk.kid,
    SAIL_REGISTRY_JWK_X: nextPrivateJwk.x,
    SAIL_REGISTRY_JWK_Y: nextPrivateJwk.y,
    SAIL_REGISTRY_JWK_D: nextPrivateJwk.d,
  });
}

const dbs: RegistryDatabase[] = [];
let databaseLock: LocalTestDatabaseLock | undefined;

function createDatabase(): RegistryDatabase {
  const db = createRegistryDatabase(config);
  dbs.push(db);
  return db;
}

describe.sequential("Postgres signing key store", () => {
  beforeAll(async () => {
    databaseLock = await acquireLocalTestDatabaseLock();
  }, dbSuiteLockTimeoutMs);

  afterAll(async () => {
    await databaseLock?.release();
    databaseLock = undefined;
  }, dbIntegrationTimeoutMs);

  beforeEach(async () => {
    await resetLocalTestDatabase();
  }, dbResetTimeoutMs);

  afterEach(async () => {
    const results = await Promise.allSettled(dbs.splice(0).map((db) => destroyRegistryDatabase(db)));
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      throw failed.reason;
    }
  }, dbResetTimeoutMs);

  test("seeds one active configured key and publishes no private material", async () => {
    const db = createDatabase();

    const signer = await loadPostgresSessionSigner(config, db);

    expect(signer.getPublicJwk()).toEqual(config.publicKeys[0]);
    expect(signer.getPublicJwk()).not.toHaveProperty("d");
    const rows = await db.selectFrom("registry_signing_keys").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      registry_id: "sail-local",
      kid: "dev-es256-2026-06",
      status: "active",
    });
    expect(rows[0]?.public_jwk).not.toHaveProperty("d");
  }, dbIntegrationTimeoutMs);

  test("reuses the same key across database objects", async () => {
    const first = await loadPostgresSessionSigner(config, createDatabase());
    const second = await loadPostgresSessionSigner(config, createDatabase());

    expect(second.getPublicJwk()).toEqual(first.getPublicJwk());
    expect(second.getPublicJwk()).toEqual(config.publicKeys[0]);
  }, dbIntegrationTimeoutMs);

  test("signs a token verifiable through the persisted public key", async () => {
    const db = createDatabase();
    const signer = await loadPostgresSessionSigner(config, db);
    const token = await signer.signSession({
      accountId: "acct_local_0123456789abcdef",
      canonicalName: "example",
      minecraftIdentityId: "mcid_local_0123456789abcdef",
      minecraftUuid: "00000000-0000-4000-8000-000000000001",
      nameClaimId: "claim_local_0123456789abcdef",
      serverId: "local-survival",
      sessionId: "sess_local_0123456789abcdef",
    });
    const persisted = await db
      .selectFrom("registry_signing_keys")
      .select(["public_jwk"])
      .where("registry_id", "=", "sail-local")
      .where("kid", "=", "dev-es256-2026-06")
      .where("status", "=", "active")
      .executeTakeFirstOrThrow();
    const key = await importJWK(persisted.public_jwk as JWK, "ES256");

    const verified = await jwtVerify(token, key, { issuer: "sail-local" });
    expect(verified.protectedHeader).toMatchObject({
      alg: "ES256",
      kid: "dev-es256-2026-06",
    });
    expect(verified.payload).toMatchObject({
      protocol_version: "sail-protocol-v1",
      iss: "sail-local",
      session_id: "sess_local_0123456789abcdef",
      canonical_name: "example",
      scope: "minecraft_login",
    });
  }, dbIntegrationTimeoutMs);

  test("fails closed when configured key differs from active database key without rotation", async () => {
    const db = createDatabase();
    await loadPostgresSessionSigner(config, db);

    await expect(loadPostgresSessionSigner(createNextConfig(), db)).rejects.toThrow(
      "Configured Sail signing key does not match active database key; set SAIL_REGISTRY_SIGNING_KEY_ROTATION=rotate to rotate explicitly",
    );
  }, dbIntegrationTimeoutMs);

  test("explicit rotation retires the old active key and activates the configured key", async () => {
    const db = createDatabase();
    await loadPostgresSessionSigner(config, db);

    const rotated = await loadPostgresSessionSigner(createNextConfig("rotate"), db);

    expect(rotated.getPublicJwk()).toEqual(publicJwkFromPrivateJwk(nextPrivateJwk));
    const rows = await db
      .selectFrom("registry_signing_keys")
      .select(["kid", "status", "revoked_at"])
      .where("registry_id", "=", "sail-local")
      .orderBy("kid", "asc")
      .execute();
    expect(rows).toEqual([
      {
        kid: "dev-es256-2026-06",
        revoked_at: null,
        status: "retiring",
      },
      {
        kid: "next-es256-2026-06",
        revoked_at: null,
        status: "active",
      },
    ]);
  }, dbIntegrationTimeoutMs);

  test("publishes active and retiring public keys but excludes revoked keys", async () => {
    const db = createDatabase();
    await loadPostgresSessionSigner(config, db);
    await loadPostgresSessionSigner(createNextConfig("rotate"), db);

    const beforeRevoke = await selectPostgresVerificationPublicKeys("sail-local", db);
    expect(beforeRevoke.map((key) => key.kid).sort()).toEqual([
      "dev-es256-2026-06",
      "next-es256-2026-06",
    ]);

    await revokePostgresSigningKey("sail-local", "dev-es256-2026-06", db);
    const afterRevoke = await selectPostgresVerificationPublicKeys("sail-local", db);
    expect(afterRevoke.map((key) => key.kid)).toEqual(["next-es256-2026-06"]);
  }, dbIntegrationTimeoutMs);

  test("does not recover from unrelated unique violations", async () => {
    let selectCalls = 0;
    const unrelatedUniqueViolation = {
      code: "23505",
      constraint: "oauth_identities_provider_subject_unique",
    };
    const fakeDb = {
      selectFrom: () => ({
        select: () => ({
          where: () => ({
            where: () => ({
              where: () => ({
                executeTakeFirst: async () => {
                  selectCalls += 1;
                  if (selectCalls === 1) {
                    return undefined;
                  }

                  return {
                    kid: config.privateKey.kid,
                    public_jwk: config.publicKeys[0],
                    private_jwk: config.privateKey,
                    fingerprint: config.signingKeyFingerprint,
                  };
                },
              }),
            }),
          }),
        }),
      }),
      insertInto: () => ({
        values: () => ({
          execute: async () => {
            throw unrelatedUniqueViolation;
          },
        }),
      }),
    } as unknown as RegistryDatabase;

    await expect(loadPostgresSessionSigner(config, fakeDb)).rejects.toBe(unrelatedUniqueViolation);
  });

  test("rejects persisted private keys without Sail key metadata", async () => {
    const db = createDatabase();
    const { kid: _kid, ...missingKidPrivateJwk } = config.privateKey;

    await db
      .insertInto("registry_signing_keys")
      .values({
        id: "11111111-1111-4111-8111-111111111111",
        registry_id: "sail-local",
        kid: config.privateKey.kid,
        public_jwk: config.publicKeys[0] as unknown as Record<string, unknown>,
        private_jwk: missingKidPrivateJwk as unknown as Record<string, unknown>,
        status: "active",
      })
      .execute();

    await expect(loadPostgresSessionSigner(config, db)).rejects.toThrow("Persisted Sail signing key is invalid");
  }, dbIntegrationTimeoutMs);

  test("rejects persisted keys whose row kid differs from private jwk kid", async () => {
    const db = createDatabase();

    await db
      .insertInto("registry_signing_keys")
      .values({
        id: "22222222-2222-4222-8222-222222222222",
        registry_id: "sail-local",
        kid: "other-es256-2026-06",
        public_jwk: { ...config.publicKeys[0], kid: "other-es256-2026-06" } as unknown as Record<string, unknown>,
        private_jwk: config.privateKey as unknown as Record<string, unknown>,
        status: "active",
      })
      .execute();

    await expect(loadPostgresSessionSigner(config, db)).rejects.toThrow(
      "Persisted Sail signing key kid does not match row",
    );
  }, dbIntegrationTimeoutMs);

  test("rejects persisted keys whose private scalar does not match public coordinates", async () => {
    const db = createDatabase();

    await db
      .insertInto("registry_signing_keys")
      .values({
        id: "33333333-3333-4333-8333-333333333333",
        registry_id: "sail-local",
        kid: config.privateKey.kid,
        public_jwk: config.publicKeys[0] as unknown as Record<string, unknown>,
        private_jwk: { ...config.privateKey, d: "invalid" } as unknown as Record<string, unknown>,
        status: "active",
      })
      .execute();

    await expect(loadPostgresSessionSigner(config, db)).rejects.toThrow(
      "Persisted Sail signing key private scalar does not match public coordinates",
    );
  }, dbIntegrationTimeoutMs);
});
