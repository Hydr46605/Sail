import { afterEach, describe, expect, test, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { importJWK, jwtVerify, type JWK } from "jose";
import { buildRegistryApp } from "../src/app.js";
import { InMemoryChallengeService } from "../src/challenges.js";
import { loadRegistryConfig } from "../src/config.js";
import type { ChallengeService } from "../src/identity/challenge-service.js";
import type { PremiumNameLookup } from "../src/premium-names.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.map((app) => app.close()));
  apps.length = 0;
});

function createTestApp(premiumNames: PremiumNameLookup = nonPremiumLookup()) {
  const config = loadRegistryConfig({
    SAIL_REGISTRY_API_URL: "http://127.0.0.1:8787",
    SAIL_REGISTRY_AUTH_URL: "http://127.0.0.1:8787/auth/minecraft",
    SAIL_REGISTRY_ID: "sail-local",
    SAIL_REGISTRY_NAME: "Sail Local Registry",
    SAIL_REGISTRY_PRIVACY_URL: "http://127.0.0.1:8787/privacy",
    SAIL_REGISTRY_TERMS_URL: "http://127.0.0.1:8787/terms",
  });
  const app = buildRegistryApp(config, {}, { premiumNames });
  apps.push(app);
  return app;
}

function createDiscordOAuthApp(fetchImpl: typeof fetch, configOverrides: Record<string, string> = {}) {
  const config = loadRegistryConfig({
    SAIL_REGISTRY_API_URL: "http://127.0.0.1:8787",
    SAIL_REGISTRY_AUTH_URL: "http://127.0.0.1:8787/auth/minecraft",
    SAIL_REGISTRY_ID: "sail-local",
    SAIL_REGISTRY_NAME: "Sail Local Registry",
    SAIL_REGISTRY_PRIVACY_URL: "http://127.0.0.1:8787/privacy",
    SAIL_REGISTRY_TERMS_URL: "http://127.0.0.1:8787/terms",
    SAIL_OAUTH_DISCORD_ENABLED: "true",
    SAIL_OAUTH_DISCORD_CLIENT_ID: "discord-client-id",
    SAIL_OAUTH_DISCORD_CLIENT_SECRET: "discord-client-secret",
    SAIL_OAUTH_DISCORD_REDIRECT_URI: "http://127.0.0.1:8787/auth/discord/callback",
    ...configOverrides,
  });
  const app = buildRegistryApp(config, {}, { premiumNames: nonPremiumLookup(), oauthFetch: fetchImpl });
  apps.push(app);
  return app;
}

function createDevOAuthApp(configOverrides: Record<string, string> = {}) {
  const config = loadRegistryConfig({
    SAIL_REGISTRY_API_URL: "http://127.0.0.1:8787",
    SAIL_REGISTRY_AUTH_URL: "http://127.0.0.1:8787/auth/minecraft",
    SAIL_REGISTRY_ID: "sail-local",
    SAIL_REGISTRY_NAME: "Sail Local Registry",
    SAIL_REGISTRY_PRIVACY_URL: "http://127.0.0.1:8787/privacy",
    SAIL_REGISTRY_TERMS_URL: "http://127.0.0.1:8787/terms",
    SAIL_OAUTH_DEV_ENABLED: "true",
    ...configOverrides,
  });
  const app = buildRegistryApp(config, {}, { premiumNames: nonPremiumLookup() });
  apps.push(app);
  return app;
}

function nonPremiumLookup(): PremiumNameLookup {
  return {
    lookup: async (canonicalName) => ({
      canonicalName,
      premium: false,
    }),
  };
}

async function completeChallengeForConsole(
  app: FastifyInstance,
  input: {
    username?: string;
    providerSubject?: string;
    providerUsername?: string;
  } = {},
) {
  const username = input.username ?? "Example";
  const createResponse = await app.inject({
    method: "POST",
    url: "/v1/minecraft/auth-challenges",
    payload: {
      server_id: "local-survival",
      username,
      connection_id: `velocity-connection-console-${username.toLowerCase()}`,
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
      provider_subject: input.providerSubject ?? "123456789012345678",
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

describe("Sail registry skeleton", () => {
  test("allows configured console origin to preflight console bearer requests", async () => {
    const app = createDevOAuthApp({
      SAIL_CONSOLE_URL: "http://127.0.0.1:5173",
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/console/me",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
    expect(response.headers["access-control-allow-methods"]).toContain("GET");
    expect(response.headers["access-control-allow-headers"]).toContain("Authorization");
  });

  test("allows configured console origin to preflight console auth challenge creation", async () => {
    const app = createDevOAuthApp({
      SAIL_CONSOLE_URL: "http://127.0.0.1:5173",
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/console/auth-challenges",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-allow-headers"]).toContain("Content-Type");
  });

  test("serves a health document", async () => {
    const app = createTestApp();

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      protocol_version: "sail-protocol-v1",
      service: "sail-registry",
      status: "ok",
    });
  });

  test("serves registry discovery metadata", async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/.well-known/sail-registry.json",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      protocol_version: "sail-protocol-v1",
      registry_id: "sail-local",
      name: "Sail Local Registry",
      api_url: "http://127.0.0.1:8787",
      jwks_url: "http://127.0.0.1:8787/.well-known/jwks.json",
      auth_url: "http://127.0.0.1:8787/auth/minecraft",
      terms_url: "http://127.0.0.1:8787/terms",
      privacy_url: "http://127.0.0.1:8787/privacy",
      trust_status: "self_hosted",
      public_key_pinning: true,
    });
  });

  test("GET /v1/servers/local-survival returns server metadata", async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/servers/local-survival",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      protocol_version: "sail-protocol-v1",
      registry_id: "sail-local",
      server_id: "local-survival",
      display_name: "Local Survival",
      registry_mode: "self_hosted",
      allowed_claim_types: ["LOCAL_SOFT"],
      session_reuse_policy: "same_registry",
      privacy_mode: "minimal",
      status: "active",
      public_listing: false,
      last_heartbeat_at: null,
    });
  });

  test("GET /v1/servers/missing-server returns server_not_found", async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/servers/missing-server",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      error: {
        code: "server_not_found",
        audience: "developer",
        http_status: 404,
        retryable: false,
      },
    });
  });

  test("serves a development JWKS with an ES256 public key", async () => {
    const app = createTestApp();
    const config = loadRegistryConfig();

    const response = await app.inject({
      method: "GET",
      url: "/.well-known/jwks.json",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ keys: JWK[] }>();
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]).toMatchObject({
      kty: "EC",
      kid: "dev-es256-2026-06",
      use: "sig",
      alg: "ES256",
      crv: "P-256",
    });
    expect(body.keys[0]).not.toHaveProperty("d");
    expect(config.privateKey.d).toHaveLength(43);
    await expect(importJWK(body.keys[0] as JWK, "ES256")).resolves.toBeDefined();
  });

  test("rejects incoherent configured ES256 key material", () => {
    expect(() =>
      loadRegistryConfig({
        SAIL_REGISTRY_JWK_KID: "bad-es256-2026-06",
        SAIL_REGISTRY_JWK_X: "NIrYI_sMbPLm8yy4JMmWSGvojQxry9rTwE3BujCaClc",
        SAIL_REGISTRY_JWK_Y: "iShnAdUmfeVR_tD75qIUmDKFTaOQdWmH3ZRiWvQGjVk",
        SAIL_REGISTRY_JWK_D: "cgltruyV9L4GvyWUauOeVmkPew0k1SQSc6HhAdzPAYM",
      }),
    ).toThrow("Sail env signing key public coordinates must match the private scalar");
  });

  test("creates a pending Minecraft auth challenge and exposes status", async () => {
    const app = createTestApp();

    const createResponse = await app.inject({
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
    const created = createResponse.json<{
      challenge_id: string;
      code: string;
      auth_url: string;
      expires_at: string;
      protocol_version: string;
      requested_name: string;
      status: string;
    }>();
    expect(created).toMatchObject({
      protocol_version: "sail-protocol-v1",
      requested_name: "Example",
      status: "pending",
    });
    expect(created.challenge_id).toMatch(/^ch_[A-Za-z0-9_-]{12,96}$/u);
    expect(created.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/u);
    expect(created.auth_url).toBe(`http://127.0.0.1:8787/auth/minecraft?code=${created.code}`);
    expect(Date.parse(created.expires_at)).toBeGreaterThan(Date.now());

    const statusResponse = await app.inject({
      method: "GET",
      url: `/v1/minecraft/auth-challenges/${created.challenge_id}`,
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual({
      protocol_version: "sail-protocol-v1",
      challenge_id: created.challenge_id,
      status: "pending",
      mode: "kick",
      expires_at: created.expires_at,
    });
  });

  test.each(["limbo", "hybrid"] as const)("round-trips %s Minecraft auth challenge mode", async (mode) => {
    const app = createTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "local-survival",
        username: "Example",
        connection_id: `velocity-connection-${mode}`,
        mode,
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json<{
      challenge_id: string;
      expires_at: string;
      mode: "limbo" | "hybrid";
    }>();
    expect(created.mode).toBe(mode);

    const statusResponse = await app.inject({
      method: "GET",
      url: `/v1/minecraft/auth-challenges/${created.challenge_id}`,
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({
      challenge_id: created.challenge_id,
      status: "pending",
      mode,
      expires_at: created.expires_at,
    });
  });

  test("creates a console-originated auth challenge for the default server", async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/console/auth-challenges",
      payload: {
        username: "SailAlt03",
      },
    });

    expect(response.statusCode).toBe(201);
    const created = response.json<{
      auth_url: string;
      challenge_id: string;
      code: string;
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
    expect(created.auth_url).toBe(`http://127.0.0.1:8787/auth/minecraft?code=${created.code}`);

    const statusResponse = await app.inject({
      method: "GET",
      url: `/v1/minecraft/auth-challenges/${created.challenge_id}`,
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({
      challenge_id: created.challenge_id,
      status: "pending",
    });
  });

  test("in-memory createChallenge rejects server_id different from default server", async () => {
    const config = loadRegistryConfig({
      SAIL_REGISTRY_API_URL: "http://127.0.0.1:8787",
      SAIL_REGISTRY_AUTH_URL: "http://127.0.0.1:8787/auth/minecraft",
      SAIL_REGISTRY_ID: "sail-local",
      SAIL_REGISTRY_NAME: "Sail Local Registry",
      SAIL_REGISTRY_PRIVACY_URL: "http://127.0.0.1:8787/privacy",
      SAIL_REGISTRY_TERMS_URL: "http://127.0.0.1:8787/terms",
    });
    const service = new InMemoryChallengeService(config, { premiumNames: nonPremiumLookup() });

    await expect(
      service.createChallenge({
        server_id: "other-server",
        username: "Example",
        connection_id: "velocity-connection-other-server",
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
            server_id: "other-server",
          },
        },
      },
    });
  });

  test("in-memory verifySession rejects non-default target server_id", async () => {
    const config = loadRegistryConfig({
      SAIL_REGISTRY_API_URL: "http://127.0.0.1:8787",
      SAIL_REGISTRY_AUTH_URL: "http://127.0.0.1:8787/auth/minecraft",
      SAIL_REGISTRY_ID: "sail-local",
      SAIL_REGISTRY_NAME: "Sail Local Registry",
      SAIL_REGISTRY_PRIVACY_URL: "http://127.0.0.1:8787/privacy",
      SAIL_REGISTRY_TERMS_URL: "http://127.0.0.1:8787/terms",
    });
    const service = new InMemoryChallengeService(config, { premiumNames: nonPremiumLookup() });
    const challenge = await service.createChallenge({
      server_id: "local-survival",
      username: "Example",
      connection_id: "velocity-connection-verify-other-server",
      mode: "kick",
    });
    const completed = await service.completeWithOAuth(challenge.challenge_id, {
      provider: "discord",
      provider_subject: "123456789012345678",
    });

    await expect(
      service.verifySession({ server_id: "other-server", session_token: completed.identity.session_token }),
    ).rejects.toMatchObject({
      body: {
        error: {
          code: "server_not_found",
          audience: "developer",
          http_status: 404,
          retryable: false,
          details: {
            server_id: "other-server",
          },
        },
      },
    });
  });

  test("POST /v1/minecraft/auth-challenges returns server_not_found for unknown server", async () => {
    const app = createTestApp();

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
  });

  test("redirects Minecraft auth codes to Discord OAuth when Discord is configured", async () => {
    const app = createDiscordOAuthApp(async () => {
      throw new Error("Discord fetch should not be used before callback");
    });
    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "local-survival",
        username: "Example",
        connection_id: "velocity-connection-1",
        mode: "kick",
      },
    });
    const created = createResponse.json<{ code: string }>();

    const response = await app.inject({
      method: "GET",
      url: `/auth/minecraft?code=${created.code}`,
    });

    expect(response.statusCode).toBe(302);
    const location = response.headers.location;
    expect(typeof location).toBe("string");
    const redirect = new URL(location as string);
    expect(`${redirect.origin}${redirect.pathname}`).toBe("https://discord.com/oauth2/authorize");
    expect(redirect.searchParams.get("response_type")).toBe("code");
    expect(redirect.searchParams.get("client_id")).toBe("discord-client-id");
    expect(redirect.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8787/auth/discord/callback");
    expect(redirect.searchParams.get("scope")).toBe("identify");
    expect(redirect.searchParams.get("state")).toMatch(/^oauth_[A-Za-z0-9_-]{12,96}$/u);
  });

  test("completes a Minecraft auth challenge from Discord OAuth callback", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = input.toString();
      if (url === "https://discord.com/api/oauth2/token") {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({
          "Content-Type": "application/x-www-form-urlencoded",
        });
        const body = init?.body as URLSearchParams;
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("code")).toBe("discord-auth-code");
        expect(body.get("client_id")).toBe("discord-client-id");
        expect(body.get("client_secret")).toBe("discord-client-secret");
        expect(body.get("redirect_uri")).toBe("http://127.0.0.1:8787/auth/discord/callback");
        return Response.json({
          access_token: "discord-access-token",
          token_type: "Bearer",
          scope: "identify",
          expires_in: 604800,
        });
      }
      if (url === "https://discord.com/api/users/@me") {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer discord-access-token",
        });
        return Response.json({
          id: "123456789012345678",
          username: "example-discord",
          global_name: "Example Discord",
        });
      }
      throw new Error(`unexpected Discord URL ${url}`);
    });
    const app = createDiscordOAuthApp(fetchImpl, {
      SAIL_CONSOLE_URL: "http://127.0.0.1:5173",
    });
    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "local-survival",
        username: "Example",
        connection_id: "velocity-connection-1",
        mode: "kick",
      },
    });
    const created = createResponse.json<{ challenge_id: string; code: string }>();
    const authResponse = await app.inject({
      method: "GET",
      url: `/auth/minecraft?code=${created.code}`,
    });
    const state = new URL(authResponse.headers.location as string).searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await app.inject({
      method: "GET",
      url: `/auth/discord/callback?code=discord-auth-code&state=${state}`,
    });

    expect(callback.statusCode).toBe(200);
    expect(callback.headers["content-type"]).toContain("text/html");
    expect(callback.body).toContain("authentication complete");
    expect(callback.body).toContain("/#session_token=");
    expect(callback.body).not.toContain("session_token_hash");
    expect(callback.body).not.toContain("_hash");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const statusResponse = await app.inject({
      method: "GET",
      url: `/v1/minecraft/auth-challenges/${created.challenge_id}`,
    });
    const status = statusResponse.json<{
      status: string;
      identity: {
        account_id: string;
        canonical_name: string;
        display_name: string;
        session_id: string;
        session_token: string;
      };
    }>();
    expect(status).toMatchObject({
      status: "completed",
      identity: {
        canonical_name: "example",
        display_name: "Example",
      },
    });
    expect(status.identity.account_id).toMatch(/^acct_[a-f0-9]{24}$/u);
    expect(callback.body).toContain(
      `href="http://127.0.0.1:5173/#session_token=${encodeURIComponent(status.identity.session_token)}&amp;session_id=${encodeURIComponent(status.identity.session_id)}"`,
    );
  });

  test("can complete a Minecraft auth code through the explicit dev OAuth provider", async () => {
    const app = createDevOAuthApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "local-survival",
        username: "Example",
        connection_id: "velocity-connection-1",
        mode: "kick",
      },
    });
    const created = createResponse.json<{ challenge_id: string; code: string }>();

    const completion = await app.inject({
      method: "GET",
      url: `/auth/dev/complete?code=${created.code}&provider_subject=dev-user&provider_username=DevUser`,
    });

    expect(completion.statusCode).toBe(200);
    expect(completion.headers["content-type"]).toContain("text/html");
    expect(completion.body).toContain("authentication complete");
    const statusResponse = await app.inject({
      method: "GET",
      url: `/v1/minecraft/auth-challenges/${created.challenge_id}`,
    });
    expect(statusResponse.json()).toMatchObject({
      status: "completed",
      identity: {
        canonical_name: "example",
        display_name: "Example",
      },
    });
  });

  test("includes console handoff link on dev OAuth completion when console URL is configured", async () => {
    const app = createDevOAuthApp({
      SAIL_CONSOLE_URL: "http://127.0.0.1:5173",
    });
    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "local-survival",
        username: "Example",
        connection_id: "velocity-connection-console-link",
        mode: "kick",
      },
    });
    const created = createResponse.json<{ challenge_id: string; code: string }>();

    const completion = await app.inject({
      method: "GET",
      url: `/auth/dev/complete?code=${created.code}&provider_subject=dev-user&provider_username=DevUser`,
    });

    expect(completion.statusCode).toBe(200);
    expect(completion.headers["content-type"]).toContain("text/html");
    expect(completion.body).toContain("authentication complete");
    expect(completion.body).toContain("/#session_token=");
    expect(completion.body).not.toContain("session_token_hash");
    expect(completion.body).not.toContain("_hash");

    const statusResponse = await app.inject({
      method: "GET",
      url: `/v1/minecraft/auth-challenges/${created.challenge_id}`,
    });
    const status = statusResponse.json<{
      identity: {
        session_id: string;
        session_token: string;
      };
    }>();
    expect(completion.body).toContain(
      `href="http://127.0.0.1:5173/#session_token=${encodeURIComponent(status.identity.session_token)}&amp;session_id=${encodeURIComponent(status.identity.session_id)}"`,
    );
  });

  test("keeps console handoff links under a configured console path", async () => {
    const app = createDevOAuthApp({
      SAIL_CONSOLE_URL: "https://global.example/console/",
    });
    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "local-survival",
        username: "Example",
        connection_id: "velocity-connection-console-path",
        mode: "kick",
      },
    });
    const created = createResponse.json<{ challenge_id: string; code: string }>();

    const completion = await app.inject({
      method: "GET",
      url: `/auth/dev/complete?code=${created.code}&provider_subject=dev-user&provider_username=DevUser`,
    });

    expect(completion.statusCode).toBe(200);
    expect(completion.body).toContain("https://global.example/console/#session_token=");
  });

  test("rejects local auth challenge creation for a premium Minecraft name", async () => {
    const app = createTestApp({
      lookup: async (canonicalName) => ({
        canonicalName,
        premium: true,
        mojangUuid: "069a79f444e94726a5befca90e38aaf5",
        mojangName: "Notch",
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "local-survival",
        username: "Notch",
        connection_id: "velocity-connection-1",
        mode: "kick",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      error: {
        code: "premium_name_required",
        audience: "player",
        http_status: 409,
        retryable: false,
        details: {
          canonical_name: "notch",
          mojang_uuid: "069a79f444e94726a5befca90e38aaf5",
        },
      },
    });
  });

  test("fails closed when premium-name lookup is unavailable", async () => {
    const app = createTestApp({
      lookup: async () => {
        throw new Error("mojang unavailable");
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "local-survival",
        username: "Example",
        connection_id: "velocity-connection-1",
        mode: "kick",
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      error: {
        code: "registry_unavailable",
        audience: "player",
        http_status: 503,
        retryable: true,
      },
    });
  });

  test("completes a challenge with OAuth identity and returns a verifiable session token", async () => {
    const app = createTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "local-survival",
        username: "Example",
        connection_id: "velocity-connection-1",
        mode: "kick",
      },
    });
    const created = createResponse.json<{ challenge_id: string }>();

    const completeResponse = await app.inject({
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
      identity: {
        account_id: string;
        canonical_name: string;
        claim_type: string;
        display_name: string;
        identity_type: string;
        minecraft_uuid: string;
        session_id: string;
        session_token: string;
      };
      status: string;
    }>();
    expect(completed.status).toBe("completed");
    expect(completed.identity).toMatchObject({
      canonical_name: "example",
      display_name: "Example",
      claim_type: "LOCAL_SOFT",
      identity_type: "SAIL_LOCAL",
    });
    expect(completed.identity.minecraft_uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(completed.identity.session_id).toMatch(/^sess_[A-Za-z0-9_-]{12,96}$/u);

    const jwksResponse = await app.inject({
      method: "GET",
      url: "/.well-known/jwks.json",
    });
    const [publicKey] = jwksResponse.json<{ keys: JWK[] }>().keys;
    expect(publicKey).toBeDefined();
    const key = await importJWK(publicKey as JWK, "ES256");
    const verified = await jwtVerify(completed.identity.session_token, key, {
      issuer: "sail-local",
    });
    expect(verified.protectedHeader).toMatchObject({
      alg: "ES256",
      kid: "dev-es256-2026-06",
    });
    expect(verified.payload).toMatchObject({
      protocol_version: "sail-protocol-v1",
      iss: "sail-local",
      sub: completed.identity.account_id,
      session_id: completed.identity.session_id,
      canonical_name: "example",
      minecraft_uuid: completed.identity.minecraft_uuid,
      claim_type: "LOCAL_SOFT",
      identity_type: "SAIL_LOCAL",
      scope: "minecraft_login",
    });
  });

  test("GET /v1/console/me without Authorization returns session_invalid", async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/console/me",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      error: {
        code: "session_invalid",
        audience: "player",
        http_status: 401,
        retryable: true,
      },
    });
  });

  test("GET /v1/console/me with an invalid bearer returns session_invalid", async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/console/me",
      headers: {
        authorization: "Bearer not-a-sail-session-token",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      error: {
        code: "session_invalid",
        audience: "player",
        http_status: 401,
        retryable: true,
      },
    });
  });

  test("GET /v1/console/me with an expired bearer returns session_expired", async () => {
    const app = createTestApp();
    const completed = await completeChallengeForConsole(app);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 61 * 60_000);
      const response = await app.inject({
        method: "GET",
        url: "/v1/console/me",
        headers: {
          authorization: `Bearer ${completed.identity.session_token}`,
        },
      });

      expect(response.statusCode).toBe(410);
      expect(response.json()).toMatchObject({
        protocol_version: "sail-protocol-v1",
        error: {
          code: "session_expired",
          audience: "player",
          http_status: 410,
          retryable: true,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("GET /v1/console/me returns account, local name, current session, trusted server, and no secrets", async () => {
    const app = createTestApp();
    const completed = await completeChallengeForConsole(app);

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
        display_name: null,
        status: "active",
        risk_level: "low",
        linked_providers: [
          {
            provider: "local",
            provider_username: null,
            last_used_at: null,
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
  });

  test("POST /v1/console/sessions/:session_id/revoke revokes the current session bearer", async () => {
    const app = createTestApp();
    const completed = await completeChallengeForConsole(app);

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
        audience: "player",
        http_status: 403,
        retryable: true,
      },
    });
  });

  test("types OAuth completion responses with a required session token", async () => {
    const config = loadRegistryConfig({
      SAIL_REGISTRY_API_URL: "http://127.0.0.1:8787",
      SAIL_REGISTRY_AUTH_URL: "http://127.0.0.1:8787/auth/minecraft",
      SAIL_REGISTRY_ID: "sail-local",
      SAIL_REGISTRY_NAME: "Sail Local Registry",
      SAIL_REGISTRY_PRIVACY_URL: "http://127.0.0.1:8787/privacy",
      SAIL_REGISTRY_TERMS_URL: "http://127.0.0.1:8787/terms",
    });
    const service = new InMemoryChallengeService(config, { premiumNames: nonPremiumLookup() });
    const challenge = await service.createChallenge({
      server_id: "local-survival",
      username: "Example",
      connection_id: "velocity-connection-1",
      mode: "kick",
    });

    const completed = await service.completeWithOAuth(challenge.challenge_id, {
      provider: "discord",
      provider_subject: "123456789012345678",
    });

    expect(completed.identity.session_token.length).toBeGreaterThan(0);
  });

  test("rejects in-memory sessions when signed claims no longer match session state", async () => {
    const config = loadRegistryConfig({
      SAIL_REGISTRY_API_URL: "http://127.0.0.1:8787",
      SAIL_REGISTRY_AUTH_URL: "http://127.0.0.1:8787/auth/minecraft",
      SAIL_REGISTRY_ID: "sail-local",
      SAIL_REGISTRY_NAME: "Sail Local Registry",
      SAIL_REGISTRY_PRIVACY_URL: "http://127.0.0.1:8787/privacy",
      SAIL_REGISTRY_TERMS_URL: "http://127.0.0.1:8787/terms",
    });
    const service = new InMemoryChallengeService(config, { premiumNames: nonPremiumLookup() });
    const challenge = await service.createChallenge({
      server_id: "local-survival",
      username: "Example",
      connection_id: "velocity-connection-1",
      mode: "kick",
    });
    const completed = await service.completeWithOAuth(challenge.challenge_id, {
      provider: "discord",
      provider_subject: "123456789012345678",
    });
    const sessions = (service as unknown as {
      sessions: Map<string, { canonicalName: string; minecraftUuid: string }>;
    }).sessions;
    const session = sessions.get(completed.identity.session_id);
    expect(session).toBeDefined();
    if (!session) {
      throw new Error("in-memory test session was not created");
    }
    session.canonicalName = "other";

    await expect(
      service.verifySession({ server_id: "local-survival", session_token: completed.identity.session_token }),
    ).rejects.toMatchObject({
      body: {
        error: {
          code: "session_invalid",
          http_status: 401,
        },
      },
    });
  });

  test("POST /v1/minecraft/sessions/verify requires server_id", async () => {
    const app = createTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "local-survival",
        username: "Example",
        connection_id: "velocity-connection-verify-requires-server",
        mode: "kick",
      },
    });
    const created = createResponse.json<{ challenge_id: string }>();
    const completeResponse = await app.inject({
      method: "POST",
      url: `/v1/minecraft/auth-challenges/${created.challenge_id}/oauth-completions`,
      payload: {
        provider: "discord",
        provider_subject: "123456789012345678",
      },
    });
    const completed = completeResponse.json<{ identity: { session_token: string } }>();

    const response = await app.inject({
      method: "POST",
      url: "/v1/minecraft/sessions/verify",
      payload: {
        session_token: completed.identity.session_token,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  test("rejects injected OAuth completion responses without a session token", async () => {
    const config = loadRegistryConfig({
      SAIL_REGISTRY_API_URL: "http://127.0.0.1:8787",
      SAIL_REGISTRY_AUTH_URL: "http://127.0.0.1:8787/auth/minecraft",
      SAIL_REGISTRY_ID: "sail-local",
      SAIL_REGISTRY_NAME: "Sail Local Registry",
      SAIL_REGISTRY_PRIVACY_URL: "http://127.0.0.1:8787/privacy",
      SAIL_REGISTRY_TERMS_URL: "http://127.0.0.1:8787/terms",
    });
    const tokenlessCompletionService = {
      getPublicKeys: () => config.publicKeys,
      createChallenge: async () => {
        throw new Error("createChallenge is not used in this test");
      },
      getChallenge: () => {
        throw new Error("getChallenge is not used in this test");
      },
      getChallengeByCode: () => {
        throw new Error("getChallengeByCode is not used in this test");
      },
      completeCodeWithOAuth: async () => {
        throw new Error("completeCodeWithOAuth is not used in this test");
      },
      completeWithOAuth: async () => ({
        protocol_version: "sail-protocol-v1",
        challenge_id: "ch_tokenless_completion",
        status: "completed",
        expires_at: "2026-06-06T00:15:00.000Z",
        completed_at: "2026-06-06T00:10:30.000Z",
        identity: {
          account_id: "acct_local_0123456789abcdef",
          minecraft_identity_id: "mcid_local_0123456789abcdef",
          name_claim_id: "claim_local_0123456789abcdef",
          canonical_name: "example",
          display_name: "Example",
          minecraft_uuid: "00000000-0000-4000-8000-000000000001",
          claim_type: "LOCAL_SOFT",
          identity_type: "SAIL_LOCAL",
          session_id: "sess_local_0123456789abcdef",
        },
      }),
      verifySession: async () => {
        throw new Error("verifySession is not used in this test");
      },
      revokeSession: () => {
        throw new Error("revokeSession is not used in this test");
      },
    } as unknown as ChallengeService;
    const app = buildRegistryApp(config, {}, { challengeService: tokenlessCompletionService });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges/ch_tokenless_completion/oauth-completions",
      payload: {
        provider: "discord",
        provider_subject: "123456789012345678",
      },
    });

    expect(response.statusCode).toBe(500);
  });

  test("verifies completed Minecraft session and does not serve generic revoke", async () => {
    const app = createTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "local-survival",
        username: "Example",
        connection_id: "velocity-connection-1",
        mode: "kick",
      },
    });
    const created = createResponse.json<{ challenge_id: string }>();
    const completeResponse = await app.inject({
      method: "POST",
      url: `/v1/minecraft/auth-challenges/${created.challenge_id}/oauth-completions`,
      payload: {
        provider: "discord",
        provider_subject: "123456789012345678",
      },
    });
    const completed = completeResponse.json<{
      identity: {
        canonical_name: string;
        minecraft_uuid: string;
        session_id: string;
        session_token: string;
      };
    }>();

    const active = await app.inject({
      method: "POST",
      url: "/v1/minecraft/sessions/verify",
      payload: {
        server_id: "local-survival",
        session_token: completed.identity.session_token,
      },
    });

    expect(active.statusCode).toBe(200);
    expect(active.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      session_id: completed.identity.session_id,
      status: "active",
      canonical_name: "example",
      minecraft_uuid: completed.identity.minecraft_uuid,
      server_id: "local-survival",
      issuer_server_id: "local-survival",
      session_reuse_policy: "same_registry",
    });

    const genericRevoke = await app.inject({
      method: "POST",
      url: `/v1/sessions/${completed.identity.session_id}/revoke`,
    });

    expect(genericRevoke.statusCode).toBe(404);
    expect(genericRevoke.json()).toMatchObject({
      statusCode: 404,
      error: "Not Found",
    });

    const stillActive = await app.inject({
      method: "POST",
      url: "/v1/minecraft/sessions/verify",
      payload: {
        server_id: "local-survival",
        session_token: completed.identity.session_token,
      },
    });

    expect(stillActive.statusCode).toBe(200);
    expect(stillActive.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      session_id: completed.identity.session_id,
      status: "active",
      canonical_name: "example",
      minecraft_uuid: completed.identity.minecraft_uuid,
    });
  });

  test("keeps the same local Minecraft UUID for the same OAuth account and name", async () => {
    const app = createTestApp();

    async function completeChallenge() {
      const createResponse = await app.inject({
        method: "POST",
        url: "/v1/minecraft/auth-challenges",
        payload: {
          server_id: "local-survival",
          username: "Example",
          connection_id: "velocity-connection-stable-uuid",
          mode: "kick",
        },
      });
      const created = createResponse.json<{ challenge_id: string }>();
      const completeResponse = await app.inject({
        method: "POST",
        url: `/v1/minecraft/auth-challenges/${created.challenge_id}/oauth-completions`,
        payload: {
          provider: "discord",
          provider_subject: "123456789012345678",
        },
      });
      expect(completeResponse.statusCode).toBe(200);
      return completeResponse.json<{
        identity: {
          minecraft_identity_id: string;
          name_claim_id: string;
          minecraft_uuid: string;
        };
      }>().identity;
    }

    const first = await completeChallenge();
    const second = await completeChallenge();

    expect(second.minecraft_uuid).toBe(first.minecraft_uuid);
    expect(second.minecraft_identity_id).toBe(first.minecraft_identity_id);
    expect(second.name_claim_id).toBe(first.name_claim_id);
  });

  test("POST /v1/servers/heartbeat without API key returns 403", async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/servers/heartbeat",
      payload: {
        server_id: "local-survival",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      error: {
        code: "api_key_required",
        http_status: 403,
        retryable: true,
      },
    });
  });

  test("POST /v1/servers/heartbeat with invalid API key returns 403", async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/servers/heartbeat",
      headers: {
        authorization: "Bearer not-a-valid-jwt",
      },
      payload: {
        server_id: "local-survival",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      error: {
        code: "api_key_invalid",
        http_status: 403,
        retryable: true,
      },
    });
  });

  test("POST /v1/servers/heartbeat with valid API key succeeds", async () => {
    const config = loadRegistryConfig({
      SAIL_REGISTRY_API_URL: "http://127.0.0.1:8787",
      SAIL_REGISTRY_AUTH_URL: "http://127.0.0.1:8787/auth/minecraft",
      SAIL_REGISTRY_ID: "sail-local",
      SAIL_REGISTRY_NAME: "Sail Local Registry",
      SAIL_REGISTRY_PRIVACY_URL: "http://127.0.0.1:8787/privacy",
      SAIL_REGISTRY_TERMS_URL: "http://127.0.0.1:8787/terms",
    });
    const service = new InMemoryChallengeService(config, { premiumNames: nonPremiumLookup() });
    const app = buildRegistryApp(config, {}, { challengeService: service });
    apps.push(app);

    const { SignJWT, importJWK } = await import("jose");
    const key = await importJWK(config.privateKey, "ES256");
    const apiKeyToken = await new SignJWT({
      scope: "api_key",
      aud: "sail-gateway",
      account_id: "acct_test",
    })
      .setProtectedHeader({ alg: "ES256", kid: config.privateKey.kid })
      .setIssuer(config.registryId)
      .setSubject("local-survival")
      .setIssuedAt()
      .setExpirationTime("90d")
      .sign(key);

    const response = await app.inject({
      method: "POST",
      url: "/v1/servers/heartbeat",
      headers: {
        authorization: `Bearer ${apiKeyToken}`,
      },
      payload: {
        server_id: "local-survival",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      server_id: "local-survival",
      status: "ok",
    });
    expect(response.json().last_heartbeat_at).toBeDefined();
  });

  test("POST /v1/servers/heartbeat with mismatched server_id returns 403", async () => {
    const config = loadRegistryConfig({
      SAIL_REGISTRY_API_URL: "http://127.0.0.1:8787",
      SAIL_REGISTRY_AUTH_URL: "http://127.0.0.1:8787/auth/minecraft",
      SAIL_REGISTRY_ID: "sail-local",
      SAIL_REGISTRY_NAME: "Sail Local Registry",
      SAIL_REGISTRY_PRIVACY_URL: "http://127.0.0.1:8787/privacy",
      SAIL_REGISTRY_TERMS_URL: "http://127.0.0.1:8787/terms",
    });
    const service = new InMemoryChallengeService(config, { premiumNames: nonPremiumLookup() });
    const app = buildRegistryApp(config, {}, { challengeService: service });
    apps.push(app);

    const { SignJWT, importJWK } = await import("jose");
    const key = await importJWK(config.privateKey, "ES256");
    const apiKeyToken = await new SignJWT({
      scope: "api_key",
      aud: "sail-gateway",
      account_id: "acct_test",
    })
      .setProtectedHeader({ alg: "ES256", kid: config.privateKey.kid })
      .setIssuer(config.registryId)
      .setSubject("local-survival")
      .setIssuedAt()
      .setExpirationTime("90d")
      .sign(key);

    const response = await app.inject({
      method: "POST",
      url: "/v1/servers/heartbeat",
      headers: {
        authorization: `Bearer ${apiKeyToken}`,
      },
      payload: {
        server_id: "different-server",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      error: {
        code: "api_key_server_mismatch",
        http_status: 403,
        retryable: false,
      },
    });
  });

  test("POST /v1/minecraft/auth-challenges with valid API key proceeds", async () => {
    const config = loadRegistryConfig({
      SAIL_REGISTRY_API_URL: "http://127.0.0.1:8787",
      SAIL_REGISTRY_AUTH_URL: "http://127.0.0.1:8787/auth/minecraft",
      SAIL_REGISTRY_ID: "sail-local",
      SAIL_REGISTRY_NAME: "Sail Local Registry",
      SAIL_REGISTRY_PRIVACY_URL: "http://127.0.0.1:8787/privacy",
      SAIL_REGISTRY_TERMS_URL: "http://127.0.0.1:8787/terms",
    });
    const service = new InMemoryChallengeService(config, { premiumNames: nonPremiumLookup() });
    const app = buildRegistryApp(config, {}, { challengeService: service });
    apps.push(app);

    const { SignJWT, importJWK } = await import("jose");
    const key = await importJWK(config.privateKey, "ES256");
    const apiKeyToken = await new SignJWT({
      scope: "api_key",
      aud: "sail-gateway",
      account_id: "acct_test",
    })
      .setProtectedHeader({ alg: "ES256", kid: config.privateKey.kid })
      .setIssuer(config.registryId)
      .setSubject("local-survival")
      .setIssuedAt()
      .setExpirationTime("90d")
      .sign(key);

    const response = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      headers: {
        authorization: `Bearer ${apiKeyToken}`,
      },
      payload: {
        server_id: "local-survival",
        username: "ApiUser",
        connection_id: "velocity-api-key-test",
        mode: "kick",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().requested_name).toBe("ApiUser");
  });

  test("POST /v1/minecraft/auth-challenges with invalid API key returns 403", async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      headers: {
        authorization: "Bearer invalid-api-key-jwt",
      },
      payload: {
        server_id: "local-survival",
        username: "Example",
        connection_id: "velocity-connection-invalid-key",
        mode: "kick",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      error: {
        code: "api_key_invalid",
        http_status: 403,
        retryable: true,
      },
    });
  });

  test("POST /v1/minecraft/auth-challenges without API key still works", async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "local-survival",
        username: "NoKey",
        connection_id: "velocity-no-key-test",
        mode: "kick",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().requested_name).toBe("NoKey");
  });

  test("rejects completing two local claims for the same name", async () => {
    const app = createTestApp();

    const firstChallenge = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "local-survival",
        username: "Example",
        connection_id: "velocity-connection-1",
        mode: "kick",
      },
    });
    const first = firstChallenge.json<{ challenge_id: string }>();
    await app.inject({
      method: "POST",
      url: `/v1/minecraft/auth-challenges/${first.challenge_id}/oauth-completions`,
      payload: {
        provider: "discord",
        provider_subject: "123456789012345678",
      },
    });

    const secondChallenge = await app.inject({
      method: "POST",
      url: "/v1/minecraft/auth-challenges",
      payload: {
        server_id: "local-survival",
        username: "Example",
        connection_id: "velocity-connection-2",
        mode: "kick",
      },
    });
    const second = secondChallenge.json<{ challenge_id: string }>();
    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/minecraft/auth-challenges/${second.challenge_id}/oauth-completions`,
      payload: {
        provider: "discord",
        provider_subject: "999999999999999999",
      },
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({
      protocol_version: "sail-protocol-v1",
      error: {
        code: "name_already_claimed",
        audience: "player",
        http_status: 409,
        retryable: false,
      },
    });
  });
});
