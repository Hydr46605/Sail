import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRegistryApp } from "../src/app.js";
import { loadRegistryConfig } from "../src/config.js";
import { createRegistryDatabase, destroyRegistryDatabase } from "../src/db/database.js";
import type { RegistryDatabase } from "../src/db/schema.js";
import { PostgresChallengeService } from "../src/identity/postgres-challenge-service.js";
import { bootstrapDefaultServer } from "../src/identity/server-records.js";
import { loadPostgresSessionSigner } from "../src/identity/signing-key-store.js";
import type { PremiumNameLookup } from "../src/premium-names.js";
import {
  acquireLocalTestDatabaseLock,
  localTestDatabaseUrl,
  type LocalTestDatabaseLock,
  resetLocalTestDatabase,
} from "./db-test-support.js";

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
  SAIL_REGISTRY_STATE_BACKEND: "postgres",
  SAIL_REGISTRY_ALLOW_DEV_SIGNING_KEY: "true",
  SAIL_REGISTRY_TERMS_URL: "http://127.0.0.1:8787/terms",
});

const apps: FastifyInstance[] = [];
const dbs: RegistryDatabase[] = [];
let databaseLock: LocalTestDatabaseLock | undefined;

async function closePersistentResources(): Promise<void> {
  const results = await Promise.allSettled([
    ...apps.splice(0).map((app) => app.close()),
    ...dbs.splice(0).map((db) => destroyRegistryDatabase(db)),
  ]);
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    throw failed.reason;
  }
}

async function createPersistentApp(): Promise<{ app: FastifyInstance; db: RegistryDatabase }> {
  const db = createRegistryDatabase(config);
  await bootstrapDefaultServer(config, db);
  const sessionSigner = await loadPostgresSessionSigner(config, db);
  const app = buildRegistryApp(config, {}, {
    challengeService: new PostgresChallengeService(config, db, {
      premiumNames: nonPremiumLookup(),
      sessionSigner,
    }),
  });
  apps.push(app);
  dbs.push(db);
  return { app, db };
}

async function closePersistentApp(instance: { app: FastifyInstance; db: RegistryDatabase }): Promise<void> {
  apps.splice(apps.indexOf(instance.app), 1);
  dbs.splice(dbs.indexOf(instance.db), 1);
  const results = await Promise.allSettled([
    instance.app.close(),
    destroyRegistryDatabase(instance.db),
  ]);
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    throw failed.reason;
  }
}

function nonPremiumLookup(): PremiumNameLookup {
  return {
    lookup: async (canonicalName) => ({
      canonicalName,
      premium: false,
    }),
  };
}

async function completePersistentChallenge(
  app: FastifyInstance,
  input: {
    username: string;
    providerSubject: string;
    providerUsername?: string;
  },
) {
  const createResponse = await app.inject({
    method: "POST",
    url: "/v1/minecraft/auth-challenges",
    payload: {
      server_id: "local-survival",
      username: input.username,
      connection_id: `velocity-connection-console-${input.username.toLowerCase()}`,
      mode: "kick",
    },
  });
  expect(createResponse.statusCode).toBe(201);
  const created = createResponse.json<{ challenge_id: string }>();

  const completeResponse = await app.inject({
    method: "POST",
    url: `/v1/minecraft/auth-challenges/${created.challenge_id}/oauth-completions`,
    payload: {
      provider: "discord",
      provider_subject: input.providerSubject,
      ...(input.providerUsername ? { provider_username: input.providerUsername } : {}),
    },
  });
  expect(completeResponse.statusCode).toBe(200);
  return completeResponse.json<{
    identity: {
      account_id: string;
      canonical_name: string;
      display_name: string;
      minecraft_identity_id: string;
      minecraft_uuid: string;
      name_claim_id: string;
      session_id: string;
      session_token: string;
    };
  }>();
}

describe.sequential("registry app with PostgreSQL state", () => {
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
    await closePersistentResources();
  }, dbResetTimeoutMs);

  test("server lookup returns registry_id, server_id, status, and session_reuse_policy", async () => {
    const { app } = await createPersistentApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/servers/local-survival",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      registry_id: "sail-local",
      server_id: "local-survival",
      status: "active",
      session_reuse_policy: "same_registry",
    });
  }, dbIntegrationTimeoutMs);

  test("POST /v1/minecraft/auth-challenges returns server_not_found for unknown server", async () => {
    const { app } = await createPersistentApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "missing-server",
        username: "Example",
        connection_id: "velocity-connection-missing-server",
        mode: "kick",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      error: {
        code: "server_not_found",
        audience: "developer",
        http_status: 404,
        retryable: false,
        details: {
          server_id: "missing-server",
        },
      },
    });
  }, dbIntegrationTimeoutMs);

  test("POST /v1/console/auth-challenges creates a durable default-server challenge", async () => {
    const { app } = await createPersistentApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/console/auth-challenges",
      payload: {
        username: "SailAlt03",
      },
    });

    expect(response.statusCode).toBe(201);
    const created = response.json<{
      challenge_id: string;
      requested_name: string;
      server_id: string;
      status: string;
    }>();
    expect(created).toMatchObject({
      protocol_version: "sail-protocol-v1",
      requested_name: "SailAlt03",
      server_id: "local-survival",
      status: "pending",
    });

    const status = await app.inject({
      method: "GET",
      url: `/v1/minecraft/auth-challenges/${created.challenge_id}`,
    });

    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      challenge_id: created.challenge_id,
      status: "pending",
    });
  }, dbIntegrationTimeoutMs);

  test("keeps completed auth and session state after app and DB object restart", async () => {
    const first = await createPersistentApp();
    const createResponse = await first.app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "local-survival",
        username: "Example",
        connection_id: "velocity-connection-1",
        mode: "kick",
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json<{ challenge_id: string }>();
    const completeResponse = await first.app.inject({
      method: "POST",
      url: `/v1/minecraft/auth-challenges/${created.challenge_id}/oauth-completions`,
      payload: {
        provider: "discord",
        provider_subject: "123456789012345678",
        provider_username: "example-discord",
      },
    });

    expect(completeResponse.statusCode).toBe(200);
    const completed = completeResponse.json<{
      completed_at: string;
      identity: {
        canonical_name: string;
        display_name: string;
        minecraft_uuid: string;
        session_id: string;
        session_token: string;
      };
      status: string;
    }>();
    expect(completed.status).toBe("completed");
    expect(completed.identity.session_token.length).toBeGreaterThan(0);

    const firstJwksResponse = await first.app.inject({
      method: "GET",
      url: "/.well-known/jwks.json",
    });
    expect(firstJwksResponse.statusCode).toBe(200);
    const firstJwks = firstJwksResponse.json<{
      keys: Array<{ kid: string; x: string; y: string; d?: string }>;
    }>();
    expect(firstJwks.keys[0]).not.toHaveProperty("d");

    const firstSigningKeys = await first.db
      .selectFrom("registry_signing_keys")
      .select(["kid", "public_jwk", "status"])
      .where("registry_id", "=", "sail-local")
      .execute();
    expect(firstSigningKeys).toHaveLength(1);
    expect(firstSigningKeys[0]).toMatchObject({
      kid: firstJwks.keys[0]?.kid,
      public_jwk: firstJwks.keys[0],
      status: "active",
    });

    await closePersistentApp(first);

    const second = await createPersistentApp();
    const secondJwksResponse = await second.app.inject({
      method: "GET",
      url: "/.well-known/jwks.json",
    });
    expect(secondJwksResponse.statusCode).toBe(200);
    expect(secondJwksResponse.json()).toEqual(firstJwks);

    const statusResponse = await second.app.inject({
      method: "GET",
      url: `/v1/minecraft/auth-challenges/${created.challenge_id}`,
    });

    expect(statusResponse.statusCode).toBe(200);
    const status = statusResponse.json<{
      completed_at?: string;
      identity?: {
        canonical_name: string;
        display_name: string;
        minecraft_uuid: string;
        session_id: string;
        session_token: string;
      };
      status: string;
    }>();
    expect(status).toMatchObject({
      status: "completed",
      completed_at: completed.completed_at,
      identity: {
        canonical_name: completed.identity.canonical_name,
        display_name: completed.identity.display_name,
        minecraft_uuid: completed.identity.minecraft_uuid,
        session_id: completed.identity.session_id,
      },
    });
    expect(status.identity?.session_token.length).toBeGreaterThan(0);

    const verifyResponse = await second.app.inject({
      method: "POST",
      url: "/v1/minecraft/sessions/verify",
      payload: {
        server_id: "local-survival",
        session_token: status.identity?.session_token,
      },
    });

    expect(verifyResponse.statusCode).toBe(200);
    expect(verifyResponse.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      session_id: completed.identity.session_id,
      status: "active",
      canonical_name: completed.identity.canonical_name,
      minecraft_uuid: completed.identity.minecraft_uuid,
      server_id: "local-survival",
      issuer_server_id: "local-survival",
      session_reuse_policy: "same_registry",
    });
  }, dbIntegrationTimeoutMs);

  test("GET /v1/console/me returns durable account, provider, name, session, and server fields", async () => {
    const { app } = await createPersistentApp();
    const completed = await completePersistentChallenge(app, {
      username: "Example",
      providerSubject: "123456789012345678",
      providerUsername: "example-discord",
    });

    const profile = await app.inject({
      method: "GET",
      url: "/v1/console/me",
      headers: {
        authorization: `Bearer ${completed.identity.session_token}`,
      },
    });

    expect(profile.statusCode).toBe(200);
    expect(profile.body).not.toContain("provider_subject");
    expect(profile.body).not.toContain("session_token_hash");
    expect(profile.body).not.toContain("challenge_code_hash");
    expect(profile.body).not.toContain("client_ip_hash");
    expect(profile.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      account: {
        account_id: completed.identity.account_id,
        display_name: "example-discord",
        status: "active",
        risk_level: "low",
        linked_providers: [
          {
            provider: "discord",
            provider_username: "example-discord",
            last_used_at: expect.any(String),
          },
        ],
      },
      names: [
        {
          name_claim_id: completed.identity.name_claim_id,
          minecraft_identity_id: completed.identity.minecraft_identity_id,
          canonical_name: "example",
          display_name: "Example",
          claim_type: "LOCAL_SOFT",
          identity_type: "SAIL_LOCAL",
          minecraft_uuid: completed.identity.minecraft_uuid,
          issuer_registry_id: "sail-local",
          status: "active",
        },
      ],
      sessions: [
        {
          session_id: completed.identity.session_id,
          server_id: "local-survival",
          server_display_name: "Local Survival",
          status: "completed",
          current: true,
          completed_at: expect.any(String),
          revoked_at: null,
        },
      ],
      trusted_servers: [
        {
          protocol_version: "sail-protocol-v1",
          registry_id: "sail-local",
          server_id: "local-survival",
          display_name: "Local Survival",
        },
      ],
    });
    const body = profile.json<{
      account: { linked_providers: Array<{ created_at: string }> };
      names: Array<{ created_at: string }>;
      sessions: Array<{ created_at: string; expires_at: string }>;
    }>();
    expect(Date.parse(body.account.linked_providers[0]?.created_at ?? "")).not.toBeNaN();
    expect(Date.parse(body.names[0]?.created_at ?? "")).not.toBeNaN();
    expect(Date.parse(body.sessions[0]?.created_at ?? "")).not.toBeNaN();
    expect(Date.parse(body.sessions[0]?.expires_at ?? "")).toBeGreaterThan(Date.now());
  }, dbIntegrationTimeoutMs);

  test("POST /v1/console/sessions/:session_id/revoke persists current-session revocation", async () => {
    const { app, db } = await createPersistentApp();
    const completed = await completePersistentChallenge(app, {
      username: "Example",
      providerSubject: "123456789012345678",
      providerUsername: "example-discord",
    });

    const revoked = await app.inject({
      method: "POST",
      url: `/v1/console/sessions/${completed.identity.session_id}/revoke`,
      headers: {
        authorization: `Bearer ${completed.identity.session_token}`,
      },
    });

    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      session_id: completed.identity.session_id,
      status: "revoked",
      revoked_at: expect.any(String),
    });
    const sessions = await db.selectFrom("sessions").select(["status", "revoked_at"]).execute();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      status: "revoked",
      revoked_at: expect.any(Date),
    });

    const profile = await app.inject({
      method: "GET",
      url: "/v1/console/me",
      headers: {
        authorization: `Bearer ${completed.identity.session_token}`,
      },
    });
    expect(profile.statusCode).toBe(403);
    expect(profile.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      error: {
        code: "session_revoked",
        http_status: 403,
      },
    });
  }, dbIntegrationTimeoutMs);

  test("POST /v1/console/sessions/:session_id/revoke returns session_not_found across accounts", async () => {
    const { app, db } = await createPersistentApp();
    const first = await completePersistentChallenge(app, {
      username: "Example",
      providerSubject: "123456789012345678",
      providerUsername: "first-discord",
    });
    const second = await completePersistentChallenge(app, {
      username: "OtherName",
      providerSubject: "999999999999999999",
      providerUsername: "second-discord",
    });

    const denied = await app.inject({
      method: "POST",
      url: `/v1/console/sessions/${first.identity.session_id}/revoke`,
      headers: {
        authorization: `Bearer ${second.identity.session_token}`,
      },
    });

    expect(denied.statusCode).toBe(404);
    expect(denied.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      error: {
        code: "session_not_found",
        http_status: 404,
      },
    });
    const sessions = await db
      .selectFrom("sessions")
      .select(["status"])
      .orderBy("created_at", "asc")
      .execute();
    expect(sessions.map((session) => session.status)).toEqual(["completed", "completed"]);
  }, dbIntegrationTimeoutMs);
});
