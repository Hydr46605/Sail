import { createPrivateKey, randomUUID, type JsonWebKey } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { SignJWT } from "jose";
import pg from "pg";
import { loadRegistryConfig } from "../src/config.js";
import { createRegistryDatabase, destroyRegistryDatabase } from "../src/db/database.js";
import type { RegistryDatabase } from "../src/db/schema.js";
import { PostgresChallengeService } from "../src/identity/postgres-challenge-service.js";
import type { ChallengeService } from "../src/identity/challenge-service.js";
import { parseSessionPublicId } from "../src/identity/ids.js";
import { SessionSigner } from "../src/identity/session-signer.js";
import { bootstrapDefaultServer } from "../src/identity/server-records.js";
import { hashSecret } from "../src/identity/token-hash.js";
import type { PremiumNameLookup } from "../src/premium-names.js";
import {
  acquireLocalTestDatabaseLock,
  localTestDatabaseUrl,
  type LocalTestDatabaseLock,
  requireLocalTestDatabaseUrl,
  resetLocalTestDatabase,
} from "./db-test-support.js";

const { Pool } = pg;
const dbIntegrationTimeoutMs = 30_000;
const dbSuiteLockTimeoutMs = 180_000;
const dbResetTimeoutMs = 180_000;

const config = loadRegistryConfig({
  SAIL_REGISTRY_API_URL: "http://127.0.0.1:8787",
  SAIL_REGISTRY_AUTH_URL: "http://127.0.0.1:8787/auth/minecraft",
  SAIL_REGISTRY_DATABASE_URL: localTestDatabaseUrl,
  SAIL_REGISTRY_ID: "sail-local",
  SAIL_REGISTRY_NAME: "Sail Local Registry",
  SAIL_REGISTRY_PRIVACY_URL: "http://127.0.0.1:8787/privacy",
  SAIL_REGISTRY_TERMS_URL: "http://127.0.0.1:8787/terms",
});

const dbs: RegistryDatabase[] = [];
let databaseLock: LocalTestDatabaseLock | undefined;

async function closeDatabases(): Promise<void> {
  const results = await Promise.allSettled(dbs.splice(0).map((db) => destroyRegistryDatabase(db)));
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    throw failed.reason;
  }
}

function createService(): ChallengeService {
  const db = createDatabase();
  return new PostgresChallengeService(config, db, { premiumNames: nonPremiumLookup() });
}

function createDatabase(): RegistryDatabase {
  const db = createRegistryDatabase(config);
  dbs.push(db);
  return db;
}

async function bootstrapDefaultTestServer(): Promise<void> {
  await bootstrapDefaultServer(config, createDatabase());
}

function nonPremiumLookup(): PremiumNameLookup {
  return {
    lookup: async (canonicalName) => ({
      canonicalName,
      premium: false,
    }),
  };
}

async function insertActiveServer(
  db: RegistryDatabase,
  serverId: string,
  sessionReusePolicy: "off" | "same_registry" | "allowlisted_servers" | "global_trusted" = "same_registry",
): Promise<void> {
  await db
    .insertInto("servers")
    .values({
      id: randomUUID(),
      registry_id: "sail-local",
      server_id: serverId,
      display_name: serverId,
      owner_account_id: null,
      registry_mode: "self_hosted",
      allowed_claim_types: ["LOCAL_SOFT"],
      session_reuse_policy: sessionReusePolicy,
      privacy_mode: "minimal",
      status: "active",
      public_listing: false,
    })
    .execute();
}

async function completeChallenge(
  service: ChallengeService,
  username = "Example",
  providerSubject = "123456789012345678",
) {
  const challenge = await service.createChallenge({
    server_id: "local-survival",
    username,
    connection_id: `velocity-${username}-${providerSubject}`,
    mode: "kick",
  });

  return service.completeWithOAuth(challenge.challenge_id, {
    provider: "discord",
    provider_subject: providerSubject,
    provider_username: `discord-${providerSubject}`,
  });
}

async function signAlteredSessionToken(
  completed: Awaited<ReturnType<typeof completeChallenge>>,
  overrides: Record<string, unknown>,
): Promise<string> {
  const privateKey = createPrivateKey({
    format: "jwk",
    key: config.privateKey as unknown as JsonWebKey,
  });
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    protocol_version: "sail-protocol-v1",
    session_id: completed.identity.session_id,
    account_id: completed.identity.account_id,
    minecraft_identity_id: completed.identity.minecraft_identity_id,
    name_claim_id: completed.identity.name_claim_id,
    canonical_name: completed.identity.canonical_name,
    minecraft_uuid: completed.identity.minecraft_uuid,
    claim_type: "LOCAL_SOFT",
    identity_type: "SAIL_LOCAL",
    scope: "minecraft_login",
    server_id: "local-survival",
    risk_level: "low",
    ...overrides,
  })
    .setProtectedHeader({ alg: "ES256", kid: config.privateKey.kid, typ: "JWT" })
    .setIssuer(config.registryId)
    .setSubject(completed.identity.account_id)
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 60)
    .sign(privateKey);
}

async function replacePersistedSessionTokenHash(
  db: RegistryDatabase,
  completed: Awaited<ReturnType<typeof completeChallenge>>,
  sessionToken: string,
): Promise<void> {
  await db
    .updateTable("sessions")
    .set({ session_token_hash: hashSecret(sessionToken) })
    .where("id", "=", parseSessionPublicId(completed.identity.session_id))
    .execute();
}

describe.sequential("PostgresChallengeService", () => {
  beforeAll(async () => {
    databaseLock = await acquireLocalTestDatabaseLock();
  }, dbSuiteLockTimeoutMs);

  afterAll(async () => {
    await databaseLock?.release();
    databaseLock = undefined;
  }, dbIntegrationTimeoutMs);

  beforeEach(async () => {
    await resetLocalTestDatabase();
    await bootstrapDefaultTestServer();
  }, dbResetTimeoutMs);

  afterEach(async () => {
    await closeDatabases();
  }, dbResetTimeoutMs);

  test("recreates the local test schema when a previous reset was interrupted after drop", async () => {
    const safeUrl = requireLocalTestDatabaseUrl(localTestDatabaseUrl);
    const pool = new Pool({ connectionString: safeUrl });
    try {
      await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    } finally {
      await pool.end();
    }

    await resetLocalTestDatabase(safeUrl);

    const verificationPool = new Pool({ connectionString: safeUrl });
    try {
      const result = await verificationPool.query<{ exists: boolean }>(
        "SELECT to_regclass('public.accounts') IS NOT NULL AS exists",
      );
      expect(result.rows[0]?.exists).toBe(true);
    } finally {
      await verificationPool.end();
    }
  }, dbIntegrationTimeoutMs);

  test("createChallenge rejects unknown server_id", async () => {
    await expect(
      createService().createChallenge({
        server_id: "missing-server",
        username: "Example",
        connection_id: "velocity-connection-unknown-server",
        mode: "kick",
      }),
    ).rejects.toMatchObject({
      body: {
        error: {
          code: "server_not_found",
          audience: "developer",
          http_status: 404,
          retryable: false,
          details: {
            server_id: "missing-server",
          },
        },
      },
    });
  }, dbIntegrationTimeoutMs);

  test.each(["disabled", "suspended"] as const)("createChallenge rejects %s server_id", async (status) => {
    const db = createDatabase();
    await db
      .updateTable("servers")
      .set({ status })
      .where("registry_id", "=", "sail-local")
      .where("server_id", "=", "local-survival")
      .execute();

    const service = new PostgresChallengeService(config, db, {
      premiumNames: nonPremiumLookup(),
      sessionSigner: SessionSigner.fromConfiguredKey(config),
    });

    await expect(
      service.createChallenge({
        server_id: "local-survival",
        username: "Example",
        connection_id: "velocity-connection-inactive-server",
        mode: "kick",
      }),
    ).rejects.toMatchObject({
      body: {
        error: {
          code: "server_not_found",
          audience: "developer",
          http_status: 404,
          retryable: false,
          details: {
            server_id: "local-survival",
          },
        },
      },
    });
  }, dbIntegrationTimeoutMs);

  test("createChallenge accepts bootstrapped local-survival", async () => {
    const challenge = await createService().createChallenge({
      server_id: "local-survival",
      username: "Example",
      connection_id: "velocity-connection-bootstrapped-server",
      mode: "kick",
    });

    expect(challenge).toMatchObject({
      protocol_version: "sail-protocol-v1",
      status: "pending",
      server_id: "local-survival",
      requested_name: "Example",
      mode: "kick",
    });
  }, dbIntegrationTimeoutMs);

  test("completed Postgres session stores server_id", async () => {
    const db = createDatabase();
    const service = new PostgresChallengeService(config, db, {
      premiumNames: nonPremiumLookup(),
      sessionSigner: SessionSigner.fromConfiguredKey(config),
    });

    const completed = await completeChallenge(service);
    const session = await db
      .selectFrom("sessions")
      .select(["server_id"])
      .where("id", "=", parseSessionPublicId(completed.identity.session_id))
      .executeTakeFirstOrThrow();

    expect(session.server_id).toBe("local-survival");
  }, dbIntegrationTimeoutMs);

  test("persists a completed challenge across service instances", async () => {
    const firstService = createService();
    const challenge = await firstService.createChallenge({
      server_id: "local-survival",
      username: "Example",
      connection_id: "velocity-connection-1",
      mode: "kick",
    });
    const completed = await firstService.completeWithOAuth(challenge.challenge_id, {
      provider: "discord",
      provider_subject: "123456789012345678",
      provider_username: "example-discord",
    });

    expect(completed.identity.session_token.length).toBeGreaterThan(0);

    const secondService = createService();
    const status = await secondService.getChallenge(challenge.challenge_id);

    expect(status).toMatchObject({
      protocol_version: "sail-protocol-v1",
      challenge_id: challenge.challenge_id,
      status: "completed",
      completed_at: completed.completed_at,
      identity: {
        account_id: completed.identity.account_id,
        minecraft_identity_id: completed.identity.minecraft_identity_id,
        name_claim_id: completed.identity.name_claim_id,
        canonical_name: "example",
        display_name: "Example",
        minecraft_uuid: completed.identity.minecraft_uuid,
        claim_type: "LOCAL_SOFT",
        identity_type: "SAIL_LOCAL",
        session_id: completed.identity.session_id,
      },
    });
    expect(status.identity?.session_token?.length).toBeGreaterThan(0);
    await expect(
      secondService.verifySession({ server_id: "local-survival", session_token: status.identity?.session_token ?? "" }),
    ).resolves.toMatchObject({
      session_id: completed.identity.session_id,
      status: "active",
      canonical_name: "example",
      minecraft_uuid: completed.identity.minecraft_uuid,
      server_id: "local-survival",
      issuer_server_id: "local-survival",
      session_reuse_policy: "same_registry",
    });
  }, dbIntegrationTimeoutMs);

  test("verifies persisted sessions with a signer rebuilt from configured key material", async () => {
    const firstService = new PostgresChallengeService(config, createDatabase(), {
      premiumNames: nonPremiumLookup(),
      sessionSigner: SessionSigner.fromConfiguredKey(config),
    });
    const completed = await completeChallenge(firstService);

    const secondService = new PostgresChallengeService(config, createDatabase(), {
      premiumNames: nonPremiumLookup(),
      sessionSigner: SessionSigner.fromConfiguredKey(config),
    });

    await expect(
      secondService.verifySession({ server_id: "local-survival", session_token: completed.identity.session_token }),
    ).resolves.toMatchObject({
      session_id: completed.identity.session_id,
      status: "active",
      canonical_name: "example",
      minecraft_uuid: completed.identity.minecraft_uuid,
      server_id: "local-survival",
      issuer_server_id: "local-survival",
      session_reuse_policy: "same_registry",
    });
  }, dbIntegrationTimeoutMs);

  test("verifySession requires server_id", async () => {
    const service = createService();
    const completed = await completeChallenge(service);

    await expect(
      service.verifySession({
        session_token: completed.identity.session_token,
      } as Parameters<ChallengeService["verifySession"]>[0]),
    ).rejects.toMatchObject({
      body: {
        error: {
          code: "server_not_found",
          http_status: 404,
        },
      },
    });
  }, dbIntegrationTimeoutMs);

  test("verifySession rejects unknown target server", async () => {
    const service = createService();
    const completed = await completeChallenge(service);

    await expect(
      service.verifySession({ server_id: "missing-server", session_token: completed.identity.session_token }),
    ).rejects.toMatchObject({
      body: {
        error: {
          code: "server_not_found",
          audience: "developer",
          http_status: 404,
          retryable: false,
          details: {
            server_id: "missing-server",
          },
        },
      },
    });
  }, dbIntegrationTimeoutMs);

  test("verifySession rejects expired sessions even if the token signature is valid", async () => {
    const db = createDatabase();
    const service = new PostgresChallengeService(config, db, {
      premiumNames: nonPremiumLookup(),
      sessionSigner: SessionSigner.fromConfiguredKey(config),
    });
    const completed = await completeChallenge(service);

    await db
      .updateTable("sessions")
      .set({ expires_at: new Date(Date.now() - 1_000) })
      .where("id", "=", parseSessionPublicId(completed.identity.session_id))
      .execute();

    await expect(
      service.verifySession({ server_id: "local-survival", session_token: completed.identity.session_token }),
    ).rejects.toMatchObject({
      body: {
        error: {
          code: "session_expired",
          http_status: 410,
          retryable: true,
        },
      },
    });
  }, dbIntegrationTimeoutMs);

  test.each([
    ["issuer policy is off", "off", "same_registry"],
    ["target policy is off", "same_registry", "off"],
  ] as const)(
    "verifySession rejects target server different from token/session server_id when %s",
    async (_caseName, issuerPolicy, targetPolicy) => {
      const db = createDatabase();
      await db
        .updateTable("servers")
        .set({ session_reuse_policy: issuerPolicy })
        .where("registry_id", "=", "sail-local")
        .where("server_id", "=", "local-survival")
        .execute();
      await insertActiveServer(db, "local-creative", targetPolicy);
      const service = new PostgresChallengeService(config, db, {
        premiumNames: nonPremiumLookup(),
        sessionSigner: SessionSigner.fromConfiguredKey(config),
      });
      const completed = await completeChallenge(service);

      await expect(
        service.verifySession({ server_id: "local-creative", session_token: completed.identity.session_token }),
      ).rejects.toMatchObject({
        body: {
          error: {
            code: "session_reuse_denied",
            http_status: 403,
            retryable: true,
          },
        },
      });
    },
    dbIntegrationTimeoutMs,
  );

  test("verifySession accepts target server different from token/session server_id when both servers are active same_registry servers", async () => {
    const db = createDatabase();
    await insertActiveServer(db, "local-creative", "same_registry");
    const service = new PostgresChallengeService(config, db, {
      premiumNames: nonPremiumLookup(),
      sessionSigner: SessionSigner.fromConfiguredKey(config),
    });
    const completed = await completeChallenge(service);

    await expect(
      service.verifySession({ server_id: "local-creative", session_token: completed.identity.session_token }),
    ).resolves.toMatchObject({
      session_id: completed.identity.session_id,
      status: "active",
      canonical_name: "example",
      minecraft_uuid: completed.identity.minecraft_uuid,
      server_id: "local-creative",
      issuer_server_id: "local-survival",
      session_reuse_policy: "same_registry",
    });
  }, dbIntegrationTimeoutMs);

  test.each([
    ["issuer allowlisted_servers", "allowlisted_servers", "same_registry"],
    ["target global_trusted", "same_registry", "global_trusted"],
  ] as const)(
    "verifySession rejects reserved %s policy values until later milestones implement them",
    async (_caseName, issuerPolicy, targetPolicy) => {
      const db = createDatabase();
      await db
        .updateTable("servers")
        .set({ session_reuse_policy: issuerPolicy })
        .where("registry_id", "=", "sail-local")
        .where("server_id", "=", "local-survival")
        .execute();
      await insertActiveServer(db, "local-creative", targetPolicy);
      const service = new PostgresChallengeService(config, db, {
        premiumNames: nonPremiumLookup(),
        sessionSigner: SessionSigner.fromConfiguredKey(config),
      });
      const completed = await completeChallenge(service);

      await expect(
        service.verifySession({ server_id: "local-creative", session_token: completed.identity.session_token }),
      ).rejects.toMatchObject({
        body: {
          error: {
            code: "session_reuse_denied",
            http_status: 403,
            retryable: true,
          },
        },
      });
    },
    dbIntegrationTimeoutMs,
  );

  test("verifySession response includes server_id, issuer_server_id, session_reuse_policy", async () => {
    const service = createService();
    const completed = await completeChallenge(service);

    await expect(
      service.verifySession({ server_id: "local-survival", session_token: completed.identity.session_token }),
    ).resolves.toMatchObject({
      server_id: "local-survival",
      issuer_server_id: "local-survival",
      session_reuse_policy: "same_registry",
    });
  }, dbIntegrationTimeoutMs);

  test("repeated completed challenge status mints token with same server_id", async () => {
    const db = createDatabase();
    await insertActiveServer(db, "local-creative", "same_registry");
    const service = new PostgresChallengeService(config, db, {
      premiumNames: nonPremiumLookup(),
      sessionSigner: SessionSigner.fromConfiguredKey(config),
    });
    const challenge = await service.createChallenge({
      server_id: "local-survival",
      username: "Example",
      connection_id: "velocity-status-handoff",
      mode: "kick",
    });
    const completed = await service.completeWithOAuth(challenge.challenge_id, {
      provider: "discord",
      provider_subject: "123456789012345678",
    });

    const status = await service.getChallenge(challenge.challenge_id);
    await expect(
      service.verifySession({ server_id: "local-survival", session_token: status.identity?.session_token ?? "" }),
    ).resolves.toMatchObject({
      session_id: completed.identity.session_id,
      server_id: "local-survival",
      issuer_server_id: "local-survival",
    });

    await db
      .updateTable("auth_challenges")
      .set({ server_id: "local-creative" })
      .where("session_id", "=", parseSessionPublicId(completed.identity.session_id))
      .execute();

    await expect(service.getChallenge(challenge.challenge_id)).rejects.toThrow(
      "Completed Sail challenge session server does not match challenge server",
    );
  }, dbIntegrationTimeoutMs);

  test.each([
    ["wrong minecraft login scope", { scope: "name_lookup" }],
    ["wrong canonical name", { canonical_name: "other" }],
    ["wrong minecraft UUID", { minecraft_uuid: "00000000-0000-4000-8000-000000000099" }],
    ["missing signed server id", { server_id: undefined }],
    ["wrong signed server id", { server_id: "local-creative" }],
  ])("rejects a session token with the %s", async (_caseName, overrides) => {
    const db = createDatabase();
    const service = new PostgresChallengeService(config, db, {
      premiumNames: nonPremiumLookup(),
      sessionSigner: SessionSigner.fromConfiguredKey(config),
    });
    const completed = await completeChallenge(service);
    const token = await signAlteredSessionToken(completed, overrides);
    await replacePersistedSessionTokenHash(db, completed, token);

    await expect(service.verifySession({ server_id: "local-survival", session_token: token })).rejects.toMatchObject({
      body: {
        error: {
          code: "session_invalid",
          http_status: 401,
        },
      },
    });
  }, dbIntegrationTimeoutMs);

  test("does not derive public account ids deterministically from OAuth subjects", async () => {
    const first = await completeChallenge(createService(), "Example", "privacy-sensitive-subject");
    await closeDatabases();
    await resetLocalTestDatabase();
    await bootstrapDefaultTestServer();

    const second = await completeChallenge(createService(), "Example", "privacy-sensitive-subject");

    expect(second.identity.account_id).not.toBe(first.identity.account_id);
  }, dbIntegrationTimeoutMs);

  test("keeps one stable local UUID for same OAuth account and name", async () => {
    const first = await completeChallenge(createService(), "Example", "same-oauth-account");
    const second = await completeChallenge(createService(), "EXAMPLE", "same-oauth-account");

    expect(second.identity.minecraft_uuid).toBe(first.identity.minecraft_uuid);
    expect(second.identity.minecraft_identity_id).toBe(first.identity.minecraft_identity_id);
    expect(second.identity.name_claim_id).toBe(first.identity.name_claim_id);
  }, dbIntegrationTimeoutMs);

  test("rejects a second OAuth account claiming the same name", async () => {
    await completeChallenge(createService(), "Example", "first-oauth-account");

    await expect(completeChallenge(createService(), "Example", "second-oauth-account")).rejects.toMatchObject({
      body: {
        error: {
          code: "name_already_claimed",
          http_status: 409,
          retryable: false,
        },
      },
    });
  }, dbIntegrationTimeoutMs);

  test("persists session revocation across service instances", async () => {
    const firstService = createService();
    const completed = await completeChallenge(firstService);
    await expect(
      firstService.verifySession({ server_id: "local-survival", session_token: completed.identity.session_token }),
    ).resolves.toMatchObject({
      session_id: completed.identity.session_id,
      status: "active",
      canonical_name: "example",
    });

    const secondService = createService();
    await expect(secondService.revokeSession(completed.identity.session_id)).resolves.toMatchObject({
      session_id: completed.identity.session_id,
      status: "revoked",
    });

    await expect(
      firstService.verifySession({ server_id: "local-survival", session_token: completed.identity.session_token }),
    ).rejects.toMatchObject({
      body: {
        error: {
          code: "session_revoked",
          http_status: 403,
          retryable: true,
        },
      },
    });
  }, dbIntegrationTimeoutMs);
});
