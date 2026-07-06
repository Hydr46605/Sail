import { createHash, randomBytes } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyServerOptions, type FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import { InMemoryChallengeService } from "./challenges.js";
import {
  type AuditEventSummary,
  type ChallengeCompletionResponse,
  type ChallengeService,
  type ChallengeServiceDependencies,
  SailChallengeError,
  type ChallengeMode,
  type CreateChallengeInput,
  type NameLookupResponse,
  type OAuthCompletionInput,
  type SessionVerificationInput,
  type SigningKeySummary,
} from "./identity/challenge-service.js";
import type { SailRegistryConfig } from "./config.js";
import type { DiscordOAuthConfig, GitHubOAuthConfig, GoogleOAuthConfig } from "./config.js";
import { createSailError, normalizeMinecraftName } from "./identity/challenge-utils.js";
import { loadRegistryConfig } from "./config.js";
import { registerServer } from "./identity/server-records.js";
import { consumeApiKeyClaim } from "./identity/api-key-claims.js";
import { verifyApiKeyJwt } from "./identity/api-keys.js";

const protocolVersion = "sail-protocol-v1";

const healthResponseSchema = Type.Object(
  {
    protocol_version: Type.Literal(protocolVersion),
    service: Type.Literal("sail-registry"),
    status: Type.Literal("ok"),
  },
  { additionalProperties: false },
);

const registryDiscoverySchema = Type.Object(
  {
    protocol_version: Type.Literal(protocolVersion),
    registry_id: Type.String(),
    name: Type.String(),
    api_url: Type.String({ format: "uri" }),
    jwks_url: Type.String({ format: "uri" }),
    auth_url: Type.String({ format: "uri" }),
    terms_url: Type.String({ format: "uri" }),
    privacy_url: Type.String({ format: "uri" }),
    trust_status: Type.Union([
      Type.Literal("global"),
      Type.Literal("self_hosted"),
      Type.Literal("trusted_by_admin"),
      Type.Literal("unverified"),
    ]),
    public_key_pinning: Type.Boolean(),
  },
  { additionalProperties: false },
);

const jwksSchema = Type.Object(
  {
    keys: Type.Array(
      Type.Object(
        {
          kty: Type.Literal("EC"),
          kid: Type.String(),
          use: Type.Literal("sig"),
          alg: Type.Literal("ES256"),
          crv: Type.Literal("P-256"),
          x: Type.String(),
          y: Type.String(),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
);

const serverRecordResponseSchema = Type.Object(
  {
    protocol_version: Type.Literal(protocolVersion),
    registry_id: Type.String(),
    server_id: Type.String(),
    display_name: Type.String(),
    registry_mode: Type.Union([
      Type.Literal("global"),
      Type.Literal("self_hosted"),
      Type.Literal("hybrid"),
    ]),
    allowed_claim_types: Type.Array(
      Type.Union([
        Type.Literal("MINECRAFT_VERIFIED"),
        Type.Literal("SAIL_GLOBAL"),
        Type.Literal("FEDERATED_TRUSTED"),
        Type.Literal("LOCAL_SOFT"),
        Type.Literal("SOCIAL_ONLY"),
      ]),
      { minItems: 1, uniqueItems: true },
    ),
    session_reuse_policy: Type.Union([
      Type.Literal("off"),
      Type.Literal("same_registry"),
      Type.Literal("allowlisted_servers"),
      Type.Literal("global_trusted"),
    ]),
    privacy_mode: Type.Union([
      Type.Literal("minimal"),
      Type.Literal("standard"),
      Type.Literal("audit_full"),
    ]),
    status: Type.Union([
      Type.Literal("active"),
      Type.Literal("disabled"),
      Type.Literal("suspended"),
    ]),
    public_listing: Type.Boolean(),
    last_heartbeat_at: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  },
  { additionalProperties: false },
);

const createChallengeBodySchema = Type.Object(
  {
    server_id: Type.String({ minLength: 1, maxLength: 96 }),
    username: Type.String({ minLength: 3, maxLength: 16, pattern: "^[A-Za-z0-9_]{3,16}$" }),
    connection_id: Type.String({ minLength: 1, maxLength: 128 }),
    mode: Type.Union([Type.Literal("kick"), Type.Literal("limbo"), Type.Literal("hybrid")]),
  },
  { additionalProperties: false },
);

const createConsoleAuthChallengeBodySchema = Type.Object(
  {
    username: Type.String({ minLength: 3, maxLength: 16, pattern: "^[A-Za-z0-9_]{3,16}$" }),
    server_id: Type.Optional(Type.String({ minLength: 1, maxLength: 96 })),
  },
  { additionalProperties: false },
);

const createChallengeResponseSchema = Type.Object(
  {
    protocol_version: Type.Literal(protocolVersion),
    challenge_id: Type.String(),
    status: Type.Literal("pending"),
    server_id: Type.String(),
    requested_name: Type.String(),
    mode: Type.Union([Type.Literal("kick"), Type.Literal("limbo"), Type.Literal("hybrid")]),
    code: Type.String(),
    auth_url: Type.String({ format: "uri" }),
    expires_at: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);

const oauthCompletionBodySchema = Type.Object(
  {
    provider: Type.String({ pattern: "^[a-z][a-z0-9_-]{1,31}$" }),
    provider_subject: Type.String({ minLength: 1, maxLength: 256 }),
    provider_username: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);

const errorResponseSchema = Type.Object(
  {
    protocol_version: Type.Literal(protocolVersion),
    error: Type.Object(
      {
        code: Type.String(),
        message: Type.String(),
        audience: Type.Union([
          Type.Literal("player"),
          Type.Literal("admin"),
          Type.Literal("operator"),
          Type.Literal("developer"),
        ]),
        http_status: Type.Integer(),
        retryable: Type.Boolean(),
        correlation_id: Type.String(),
        details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const registerServerBodySchema = Type.Object(
  {
    server_id: Type.String({ minLength: 3, maxLength: 64, pattern: "^[a-z0-9][a-z0-9][a-z0-9_-]*[a-z0-9]$" }),
    display_name: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

const registerServerResponseSchema = Type.Object(
  {
    protocol_version: Type.Literal(protocolVersion),
    server_id: Type.String(),
    display_name: Type.String(),
    api_key: Type.String(),
    claim_code: Type.String(),
  },
  { additionalProperties: false },
);

const claimServerBodySchema = Type.Object(
  {
    claim_code: Type.String({ minLength: 32, maxLength: 32 }),
  },
  { additionalProperties: false },
);

const claimServerResponseSchema = Type.Object(
  {
    protocol_version: Type.Literal(protocolVersion),
    api_key: Type.String(),
    server_id: Type.String(),
  },
  { additionalProperties: false },
);

const heartbeatBodySchema = Type.Object(
  {
    server_id: Type.String({ minLength: 1, maxLength: 96 }),
  },
  { additionalProperties: false },
);

const heartbeatResponseSchema = Type.Object(
  {
    protocol_version: Type.Literal(protocolVersion),
    server_id: Type.String(),
    status: Type.Literal("ok"),
    last_heartbeat_at: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);

const nameLookupResponseSchema = Type.Object(
  {
    protocol_version: Type.Literal(protocolVersion),
    canonical_name: Type.String(),
    display_name: Type.Union([Type.String(), Type.Null()]),
    status: Type.Union([
      Type.Literal("claimed"),
      Type.Literal("unclaimed"),
      Type.Literal("premium_reserved"),
    ]),
    claim_type: Type.Union([
      Type.Literal("MINECRAFT_VERIFIED"),
      Type.Literal("SAIL_GLOBAL"),
      Type.Literal("FEDERATED_TRUSTED"),
      Type.Literal("LOCAL_SOFT"),
      Type.Literal("SOCIAL_ONLY"),
      Type.Null(),
    ]),
    identity_type: Type.Union([
      Type.Literal("MOJANG_PREMIUM"),
      Type.Literal("SAIL_LOCAL"),
      Type.Literal("FEDERATED"),
      Type.Null(),
    ]),
    issuer_registry_id: Type.Union([Type.String(), Type.Null()]),
    minecraft_uuid: Type.Union([Type.String(), Type.Null()]),
    premium_name: Type.Boolean(),
    priority: Type.Union([Type.Integer(), Type.Null()]),
    expires_at: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  },
  { additionalProperties: false },
);

const completedIdentityFields = {
  account_id: Type.String(),
  minecraft_identity_id: Type.String(),
  name_claim_id: Type.String(),
  canonical_name: Type.String(),
  display_name: Type.String(),
  minecraft_uuid: Type.String({ format: "uuid" }),
  claim_type: Type.Literal("LOCAL_SOFT"),
  identity_type: Type.Literal("SAIL_LOCAL"),
  session_id: Type.String(),
};

const completedIdentitySchema = Type.Object(
  {
    ...completedIdentityFields,
    session_token: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const completedIdentityWithSessionTokenSchema = Type.Object(
  {
    ...completedIdentityFields,
    session_token: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const challengeStatusResponseSchema = Type.Object(
  {
    protocol_version: Type.Literal(protocolVersion),
    challenge_id: Type.String(),
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("completed"),
      Type.Literal("expired"),
      Type.Literal("revoked"),
      Type.Literal("denied"),
    ]),
    mode: Type.Union([Type.Literal("kick"), Type.Literal("limbo"), Type.Literal("hybrid")]),
    expires_at: Type.String({ format: "date-time" }),
    completed_at: Type.Optional(Type.String({ format: "date-time" })),
    identity: Type.Optional(completedIdentitySchema),
  },
  { additionalProperties: false },
);

const challengeCompletionResponseSchema = Type.Object(
  {
    protocol_version: Type.Literal(protocolVersion),
    challenge_id: Type.String(),
    status: Type.Literal("completed"),
    expires_at: Type.String({ format: "date-time" }),
    completed_at: Type.String({ format: "date-time" }),
    identity: completedIdentityWithSessionTokenSchema,
  },
  { additionalProperties: false },
);

const sessionVerificationBodySchema = Type.Object(
  {
    server_id: Type.String({ minLength: 1, maxLength: 96 }),
    session_token: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const sessionVerificationResponseSchema = Type.Object(
  {
    protocol_version: Type.Literal(protocolVersion),
    session_id: Type.String(),
    status: Type.Literal("active"),
    canonical_name: Type.String(),
    minecraft_uuid: Type.String({ format: "uuid" }),
    server_id: Type.String(),
    issuer_server_id: Type.String(),
    session_reuse_policy: Type.Union([
      Type.Literal("off"),
      Type.Literal("same_registry"),
      Type.Literal("allowlisted_servers"),
      Type.Literal("global_trusted"),
    ]),
  },
  { additionalProperties: false },
);

const sessionRevocationResponseSchema = Type.Object(
  {
    protocol_version: Type.Literal(protocolVersion),
    session_id: Type.String(),
    status: Type.Literal("revoked"),
    revoked_at: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);

const consoleLinkedProviderSchema = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 32 }),
    provider_username: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    created_at: Type.String({ format: "date-time" }),
    last_used_at: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  },
  { additionalProperties: false },
);

const consoleAccountSummarySchema = Type.Object(
  {
    account_id: Type.String(),
    display_name: Type.Union([Type.String({ minLength: 1, maxLength: 96 }), Type.Null()]),
    status: Type.Union([
      Type.Literal("active"),
      Type.Literal("suspended"),
      Type.Literal("recovery_locked"),
      Type.Literal("deleted"),
    ]),
    risk_level: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
    linked_providers: Type.Array(consoleLinkedProviderSchema),
  },
  { additionalProperties: false },
);

const consoleNameClaimSummarySchema = Type.Object(
  {
    name_claim_id: Type.String(),
    minecraft_identity_id: Type.String(),
    canonical_name: Type.String(),
    display_name: Type.String(),
    claim_type: Type.Union([
      Type.Literal("MINECRAFT_VERIFIED"),
      Type.Literal("SAIL_GLOBAL"),
      Type.Literal("FEDERATED_TRUSTED"),
      Type.Literal("LOCAL_SOFT"),
      Type.Literal("SOCIAL_ONLY"),
    ]),
    identity_type: Type.Union([
      Type.Literal("MOJANG_PREMIUM"),
      Type.Literal("SAIL_LOCAL"),
      Type.Literal("FEDERATED"),
    ]),
    minecraft_uuid: Type.String({ format: "uuid" }),
    issuer_registry_id: Type.String(),
    status: Type.Union([
      Type.Literal("active"),
      Type.Literal("displaced_by_minecraft"),
      Type.Literal("renamed"),
      Type.Literal("suspended"),
      Type.Literal("expired"),
    ]),
    created_at: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);

const consoleSessionSummarySchema = Type.Object(
  {
    session_id: Type.String(),
    server_id: Type.String(),
    server_display_name: Type.String(),
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("completed"),
      Type.Literal("expired"),
      Type.Literal("revoked"),
      Type.Literal("denied"),
    ]),
    current: Type.Boolean(),
    created_at: Type.String({ format: "date-time" }),
    completed_at: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    expires_at: Type.String({ format: "date-time" }),
    revoked_at: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  },
  { additionalProperties: false },
);

const consoleProfileResponseSchema = Type.Object(
  {
    protocol_version: Type.Literal(protocolVersion),
    account: consoleAccountSummarySchema,
    names: Type.Array(consoleNameClaimSummarySchema),
    sessions: Type.Array(consoleSessionSummarySchema),
    trusted_servers: Type.Array(serverRecordResponseSchema),
  },
  { additionalProperties: false },
);

const minecraftAuthQuerySchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const discordCallbackQuerySchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    state: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const githubCallbackQuerySchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    state: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const googleCallbackQuerySchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    state: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const devOAuthCompletionQuerySchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    provider_subject: Type.String({ minLength: 1, maxLength: 256 }),
    provider_username: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);

export interface RegistryAppDependencies extends ChallengeServiceDependencies {
  challengeService?: ChallengeService;
  oauthFetch?: typeof fetch;
}

interface OAuthState {
  minecraftCode: string;
  expiresAt: number;
}

export function buildRegistryApp(
  config: SailRegistryConfig = loadRegistryConfig(),
  options: FastifyServerOptions = {},
  dependencies: RegistryAppDependencies = {},
): FastifyInstance {
  const app = Fastify({
    logger: false,
    ...options,
  });
  const challenges = dependencies.challengeService ?? new InMemoryChallengeService(config, dependencies);
  const oauthFetch = dependencies.oauthFetch ?? fetch;
  const oauthStates = new Map<string, OAuthState>();

  installConsoleCors(app, config);

  app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    keyGenerator: (request) =>
      typeof request.headers["x-api-key"] === "string" ? request.headers["x-api-key"] : request.ip,
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
  });

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => ({
      protocol_version: protocolVersion,
      service: "sail-registry",
      status: "ok",
    }),
  );

  app.get(
    "/.well-known/sail-registry.json",
    {
      schema: {
        response: {
          200: registryDiscoverySchema,
        },
      },
    },
    async () => ({
      protocol_version: protocolVersion,
      registry_id: config.registryId,
      name: config.name,
      api_url: config.apiUrl,
      jwks_url: `${config.apiUrl}/.well-known/jwks.json`,
      auth_url: config.authUrl,
      terms_url: config.termsUrl,
      privacy_url: config.privacyUrl,
      trust_status: config.trustStatus,
      public_key_pinning: config.publicKeyPinning,
    }),
  );

  app.get(
    "/.well-known/jwks.json",
    {
      schema: {
        response: {
          200: jwksSchema,
        },
      },
    },
    async () => ({
      keys: await challenges.getPublicKeys(),
    }),
  );

  app.get<{ Params: { server_id: string } }>(
    "/v1/servers/:server_id",
    {
      schema: {
        params: Type.Object({
          server_id: Type.String({ minLength: 1, maxLength: 96 }),
        }),
        response: {
          200: serverRecordResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await challenges.getServer(request.params.server_id);
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.get<{ Querystring: { code: string } }>(
    "/auth/minecraft",
    {
      schema: {
        querystring: minecraftAuthQuerySchema,
      },
    },
    async (request, reply) => {
      try {
        const challenge = await challenges.getChallengeByCode(request.query.code);
        if (challenge.status !== "pending") {
          return reply
            .code(410)
            .type("text/plain")
            .send("This Sail login code is no longer pending. Join again to get a new code.");
        }
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }

      if (!config.discordOAuth.enabled) {
        return reply
          .code(503)
          .type("text/plain")
          .send("Discord OAuth is not configured for this Sail registry.");
      }

      deleteExpiredOAuthStates(oauthStates);
      const state = `oauth_${randomToken(24)}`;
      oauthStates.set(state, {
        minecraftCode: request.query.code,
        expiresAt: Date.now() + 180_000,
      });
      return reply.redirect(buildDiscordAuthorizeUrl(config.discordOAuth, state).toString(), 302);
    },
  );

  app.get<{ Querystring: { code: string; state: string } }>(
    "/auth/discord/callback",
    {
      config: {
        rateLimit: { max: 20, timeWindow: "1 minute" },
      },
      schema: {
        querystring: discordCallbackQuerySchema,
      },
    },
    async (request, reply) => {
      const state = oauthStates.get(request.query.state);
      oauthStates.delete(request.query.state);
      if (!state) {
        return reply.code(400).type("text/plain").send("Invalid Sail OAuth state.");
      }
      if (state.expiresAt <= Date.now()) {
        return reply.code(410).type("text/plain").send("This Sail OAuth state expired. Join again to get a new code.");
      }

      try {
        const discordUser = await fetchDiscordUser(config.discordOAuth, request.query.code, oauthFetch);
        const completed = await challenges.completeCodeWithOAuth(state.minecraftCode, {
          provider: "discord",
          provider_subject: discordUser.id,
          provider_username: discordUser.displayName,
        });
        return reply
          .type("text/html")
          .send(renderAuthCompletionPage(config, completed, "Sail authentication complete"));
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.get<{ Querystring: { code: string } }>(
    "/auth/github/login",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
      schema: {
        querystring: minecraftAuthQuerySchema,
      },
    },
    async (request, reply) => {
      try {
        const challenge = await challenges.getChallengeByCode(request.query.code);
        if (challenge.status !== "pending") {
          return reply
            .code(410)
            .type("text/plain")
            .send("This Sail login code is no longer pending. Join again to get a new code.");
        }
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }

      if (!config.githubOAuth.enabled) {
        return reply
          .code(503)
          .type("text/plain")
          .send("GitHub OAuth is not configured for this Sail registry.");
      }

      deleteExpiredOAuthStates(oauthStates);
      const state = `oauth_${randomToken(24)}`;
      oauthStates.set(state, {
        minecraftCode: request.query.code,
        expiresAt: Date.now() + 180_000,
      });
      return reply.redirect(buildGitHubAuthorizeUrl(config.githubOAuth, state).toString(), 302);
    },
  );

  app.get<{ Querystring: { code: string; state: string } }>(
    "/auth/github/callback",
    {
      config: {
        rateLimit: { max: 20, timeWindow: "1 minute" },
      },
      schema: {
        querystring: githubCallbackQuerySchema,
      },
    },
    async (request, reply) => {
      const state = oauthStates.get(request.query.state);
      oauthStates.delete(request.query.state);
      if (!state) {
        return reply.code(400).type("text/plain").send("Invalid Sail OAuth state.");
      }
      if (state.expiresAt <= Date.now()) {
        return reply.code(410).type("text/plain").send("This Sail OAuth state expired. Join again to get a new code.");
      }

      try {
        const githubUser = await fetchGitHubUser(config.githubOAuth, request.query.code, oauthFetch);
        const completed = await challenges.completeCodeWithOAuth(state.minecraftCode, {
          provider: "github",
          provider_subject: githubUser.id,
          provider_username: githubUser.displayName,
        });
        return reply
          .type("text/html")
          .send(renderAuthCompletionPage(config, completed, "Sail authentication complete"));
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.get<{ Querystring: { code: string } }>(
    "/auth/google/login",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
      schema: {
        querystring: minecraftAuthQuerySchema,
      },
    },
    async (request, reply) => {
      try {
        const challenge = await challenges.getChallengeByCode(request.query.code);
        if (challenge.status !== "pending") {
          return reply
            .code(410)
            .type("text/plain")
            .send("This Sail login code is no longer pending. Join again to get a new code.");
        }
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }

      if (!config.googleOAuth.enabled) {
        return reply
          .code(503)
          .type("text/plain")
          .send("Google OAuth is not configured for this Sail registry.");
      }

      deleteExpiredOAuthStates(oauthStates);
      const state = `oauth_${randomToken(24)}`;
      oauthStates.set(state, {
        minecraftCode: request.query.code,
        expiresAt: Date.now() + 180_000,
      });
      return reply.redirect(buildGoogleAuthorizeUrl(config.googleOAuth, state).toString(), 302);
    },
  );

  app.get<{ Querystring: { code: string; state: string } }>(
    "/auth/google/callback",
    {
      config: {
        rateLimit: { max: 20, timeWindow: "1 minute" },
      },
      schema: {
        querystring: googleCallbackQuerySchema,
      },
    },
    async (request, reply) => {
      const state = oauthStates.get(request.query.state);
      oauthStates.delete(request.query.state);
      if (!state) {
        return reply.code(400).type("text/plain").send("Invalid Sail OAuth state.");
      }
      if (state.expiresAt <= Date.now()) {
        return reply.code(410).type("text/plain").send("This Sail OAuth state expired. Join again to get a new code.");
      }

      try {
        const googleUser = await fetchGoogleUser(config.googleOAuth, request.query.code, oauthFetch);
        const completed = await challenges.completeCodeWithOAuth(state.minecraftCode, {
          provider: "google",
          provider_subject: googleUser.id,
          provider_username: googleUser.displayName,
        });
        return reply
          .type("text/html")
          .send(renderAuthCompletionPage(config, completed, "Sail authentication complete"));
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.get<{ Querystring: { code: string; provider_subject: string; provider_username?: string } }>(
    "/auth/dev/complete",
    {
      config: {
        rateLimit: { max: 20, timeWindow: "1 minute" },
      },
      schema: {
        querystring: devOAuthCompletionQuerySchema,
      },
    },
    async (request, reply) => {
      if (!config.devOAuthEnabled) {
        return reply.code(404).type("text/plain").send("Sail development OAuth provider is not enabled.");
      }

      try {
        const oauthIdentity: OAuthCompletionInput = {
          provider: "dev",
          provider_subject: request.query.provider_subject,
          ...(request.query.provider_username ? { provider_username: request.query.provider_username } : {}),
        };
        const completed = await challenges.completeCodeWithOAuth(request.query.code, oauthIdentity);
        return reply
          .type("text/html")
          .send(renderAuthCompletionPage(config, completed, "Sail development authentication complete"));
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.post<{ Body: CreateChallengeInput }>(
    "/v1/minecraft/auth-challenges",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (request) => {
            const token = extractOptionalBearerToken(request.headers.authorization);
            if (token) {
              return createHash("sha256").update(token).digest("hex");
            }
            return request.ip;
          },
        },
      },
      schema: {
        body: createChallengeBodySchema,
        response: {
          201: createChallengeResponseSchema,
          409: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        await validateServerApiKey(config, request.headers.authorization, request.body.server_id);
        const response = await challenges.createChallenge(request.body);
        return reply.code(201).send(response);
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.post<{ Body: { username: string; server_id?: string } }>(
    "/v1/console/auth-challenges",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
      schema: {
        body: createConsoleAuthChallengeBodySchema,
        response: {
          201: createChallengeResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const response = await challenges.createChallenge({
          server_id: request.body.server_id ?? config.defaultServer.serverId,
          username: request.body.username,
          connection_id: `console-${randomToken(24)}`,
          mode: "kick",
        });
        return reply.code(201).send(response);
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { challenge_id: string } }>(
    "/v1/minecraft/auth-challenges/:challenge_id",
    {
      schema: {
        params: Type.Object({
          challenge_id: Type.String(),
        }),
        response: {
          200: challengeStatusResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await challenges.getChallenge(request.params.challenge_id);
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { challenge_id: string };
    Body: OAuthCompletionInput;
  }>(
    "/v1/minecraft/auth-challenges/:challenge_id/oauth-completions",
    {
      config: {
        rateLimit: { max: 20, timeWindow: "1 minute" },
      },
      schema: {
        params: Type.Object({
          challenge_id: Type.String(),
        }),
        body: oauthCompletionBodySchema,
        response: {
          200: challengeCompletionResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          410: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await challenges.completeWithOAuth(request.params.challenge_id, request.body);
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.post<{ Body: SessionVerificationInput }>(
    "/v1/minecraft/sessions/verify",
    {
      config: {
        rateLimit: { max: 200, timeWindow: "1 minute" },
      },
      schema: {
        body: sessionVerificationBodySchema,
        response: {
          200: sessionVerificationResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          410: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        await validateServerApiKey(config, request.headers.authorization, request.body.server_id);
        return await challenges.verifySession(request.body);
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { server_id: string };
    Headers: { authorization?: string };
  }>(
    "/v1/servers/:server_id/deregister",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
      schema: {
        params: Type.Object({
          server_id: Type.String({ minLength: 3, maxLength: 64 }),
        }),
        headers: Type.Object({ authorization: Type.Optional(Type.String()) }),
        response: {
          200: Type.Object({
            protocol_version: Type.Literal(protocolVersion),
            server_id: Type.String(),
            status: Type.Literal("disabled"),
          }, { additionalProperties: false }),
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const token = request.headers.authorization?.startsWith("Bearer ")
          ? request.headers.authorization.slice("Bearer ".length).trim()
          : undefined;
        if (!token) {
          return reply.code(401).send(createSailError("missing_token", 401, true, "Missing bearer token").body);
        }
        return await challenges.deregisterServer(token, request.params.server_id);
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.get<{ Querystring: { limit?: number }; Headers: { authorization?: string } }>(
    "/v1/console/audit-events",
    {
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
      schema: {
        querystring: Type.Object({
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        }),
        headers: Type.Object({ authorization: Type.Optional(Type.String()) }),
        response: {
          200: Type.Array(
            Type.Object({
              id: Type.String(),
              event_type: Type.String(),
              severity: Type.Union([
                Type.Literal("info"),
                Type.Literal("warning"),
                Type.Literal("high"),
                Type.Literal("critical"),
              ]),
              metadata_json: Type.Record(Type.String(), Type.Unknown()),
              created_at: Type.String({ format: "date-time" }),
            }, { additionalProperties: false }),
          ),
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const token = request.headers.authorization?.startsWith("Bearer ")
          ? request.headers.authorization.slice("Bearer ".length).trim()
          : undefined;
        if (!token) {
          return reply.code(401).send(createSailError("missing_token", 401, true, "Missing bearer token").body);
        }
        const limit = typeof request.query.limit === "number" ? request.query.limit : 50;
        return await challenges.getAuditEvents(token, limit);
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.get<{ Headers: { authorization?: string } }>(
    "/v1/console/signing-keys",
    {
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
      schema: {
        headers: Type.Object({ authorization: Type.Optional(Type.String()) }),
        response: {
          200: Type.Array(
            Type.Object({
              kid: Type.String(),
              status: Type.Union([
                Type.Literal("active"),
                Type.Literal("retiring"),
                Type.Literal("retired"),
                Type.Literal("revoked"),
              ]),
              source: Type.String(),
              fingerprint: Type.Union([Type.String(), Type.Null()]),
              created_at: Type.String({ format: "date-time" }),
              activated_at: Type.String({ format: "date-time" }),
              retired_at: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
              revoked_at: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
            }, { additionalProperties: false }),
          ),
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const token = request.headers.authorization?.startsWith("Bearer ")
          ? request.headers.authorization.slice("Bearer ".length).trim()
          : undefined;
        if (!token) {
          return reply.code(401).send(createSailError("missing_token", 401, true, "Missing bearer token").body);
        }
        return await challenges.getSigningKeys(token);
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { kid: string };
    Headers: { authorization?: string };
  }>(
    "/v1/console/signing-keys/:kid/revoke",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
      schema: {
        params: Type.Object({ kid: Type.String({ minLength: 1, maxLength: 128 }) }),
        headers: Type.Object({ authorization: Type.Optional(Type.String()) }),
        response: {
          200: Type.Object({
            kid: Type.String(),
            status: Type.Literal("revoked"),
          }, { additionalProperties: false }),
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const token = request.headers.authorization?.startsWith("Bearer ")
          ? request.headers.authorization.slice("Bearer ".length).trim()
          : undefined;
        if (!token) {
          return reply.code(401).send(createSailError("missing_token", 401, true, "Missing bearer token").body);
        }
        return await challenges.revokeSigningKey(token, request.params.kid);
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { name: string } }>(
    "/v1/names/:name",
    {
      config: {
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
      schema: {
        params: Type.Object({
          name: Type.String({ minLength: 3, maxLength: 16, pattern: "^[a-zA-Z0-9_]{3,16}$" }),
        }),
        response: {
          200: nameLookupResponseSchema,
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const canonicalName = normalizeMinecraftName(request.params.name);
        return await challenges.lookupName(canonicalName);
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.post<{ Body: { server_id: string }; Headers: { authorization?: string } }>(
    "/v1/servers/heartbeat",
    {
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
      schema: {
        body: heartbeatBodySchema,
        headers: Type.Object({ authorization: Type.Optional(Type.String()) }),
        response: {
          200: heartbeatResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        await validateServerApiKey(config, request.headers.authorization, request.body.server_id, { required: true });
        await challenges.recordHeartbeat(request.body.server_id);
        return reply.send({
          protocol_version: protocolVersion,
          server_id: request.body.server_id,
          status: "ok" as const,
          last_heartbeat_at: new Date().toISOString(),
        });
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.get<{ Headers: { authorization?: string } }>(
    "/v1/console/me",
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
          keyGenerator: (request) => {
            const auth = request.headers.authorization;
            if (typeof auth === "string" && auth.startsWith("Bearer ")) {
              const token = auth.slice("Bearer ".length).trim();
              if (token.length > 0) {
                return createHash("sha256").update(token).digest("hex");
              }
            }
            return request.ip;
          },
        },
      },
      schema: {
        headers: Type.Object({
          authorization: Type.Optional(Type.String()),
        }),
        response: {
          200: consoleProfileResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          410: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await challenges.getConsoleProfile(extractBearerToken(request.headers.authorization));
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { session_id: string };
    Headers: { authorization?: string };
  }>(
    "/v1/console/sessions/:session_id/revoke",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (request) => {
            const auth = request.headers.authorization;
            if (typeof auth === "string" && auth.startsWith("Bearer ")) {
              const token = auth.slice("Bearer ".length).trim();
              if (token.length > 0) {
                return createHash("sha256").update(token).digest("hex");
              }
            }
            return request.ip;
          },
        },
      },
      schema: {
        params: Type.Object({
          session_id: Type.String(),
        }),
        headers: Type.Object({
          authorization: Type.Optional(Type.String()),
        }),
        response: {
          200: sessionRevocationResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          410: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await challenges.revokeConsoleSession(
          extractBearerToken(request.headers.authorization),
          request.params.session_id,
        );
      } catch (error) {
        if (error instanceof SailChallengeError) {
          return reply.code(error.statusCode).send(error.body);
        }
        throw error;
      }
    },
  );

  app.post<{ Body: { server_id: string; display_name: string }; Headers: { authorization?: string } }>(
    "/v1/servers",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
      schema: {
        body: registerServerBodySchema,
        headers: Type.Object({ authorization: Type.Optional(Type.String()) }),
        response: {
          201: registerServerResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const sessionToken = request.headers.authorization?.startsWith("Bearer ")
        ? request.headers.authorization.slice("Bearer ".length).trim()
        : undefined;
      if (!sessionToken) {
        return reply.code(401).send(createSailError("missing_token", 401, true, "Missing bearer token").body);
      }

      try {
        const session = await challenges.getSessionByToken(sessionToken);
        if (!session || session.account_id === null) {
          return reply.code(401).send(createSailError("invalid_token", 401, true, "Invalid or expired session").body);
        }

        const db = challenges.getDatabase();
        if (!db) {
          return reply.code(503).send(createSailError("unavailable", 503, true, "Server registration requires PostgreSQL backend").body);
        }

        const result = await registerServer(
          db,
          { registryId: config.registryId, privateKey: config.privateKey, signingKeyFingerprint: config.signingKeyFingerprint },
          session.account_id,
          request.body.server_id,
          request.body.display_name
        );
        return reply.code(201).send({
          protocol_version: protocolVersion,
          server_id: result.server.server_id,
          display_name: result.server.display_name,
          api_key: result.apiKey,
          claim_code: result.claimCode,
        });
      } catch (error) {
        if (error instanceof Error && (error.message.includes("already") || error.message.includes("taken"))) {
          return reply.code(409).send(createSailError("conflict", 409, false, error.message).body);
        }
        throw error;
      }
    },
  );

  app.post<{ Body: { claim_code: string } }>(
    "/v1/servers/claim",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
      schema: {
        body: claimServerBodySchema,
        response: {
          200: claimServerResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          410: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const db = challenges.getDatabase();
      if (!db) {
        return reply.code(503).send(createSailError("unavailable", 503, true, "Claim code requires PostgreSQL backend").body);
      }
      const consumed = await consumeApiKeyClaim(db, request.body.claim_code);
      if (!consumed) {
        return reply.code(404).send(createSailError("invalid_claim_code", 404, false, "Invalid or expired claim code").body);
      }
      return reply.send({
        protocol_version: protocolVersion,
        api_key: consumed.apiKeyJwt,
        server_id: consumed.serverId,
      });
    },
  );

  return app;
}

function installConsoleCors(app: FastifyInstance, config: SailRegistryConfig): void {
  if (!config.consoleUrl) {
    return;
  }

  const allowedOrigin = new URL(config.consoleUrl).origin;

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/console/")) {
      return;
    }

    const origin = request.headers.origin;
    if (origin !== allowedOrigin) {
      return;
    }

    reply
      .header("Access-Control-Allow-Origin", allowedOrigin)
      .header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
      .header("Access-Control-Allow-Headers", "Authorization,Content-Type,Accept")
      .header("Access-Control-Max-Age", "600")
      .header("Vary", "Origin");

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });
}

interface DiscordUser {
  id: string;
  displayName: string;
}

interface GitHubUser {
  id: string;
  displayName: string;
}

interface GoogleUser {
  id: string;
  displayName: string;
}

async function fetchDiscordUser(
  config: DiscordOAuthConfig,
  code: string,
  fetchImpl: typeof fetch,
): Promise<DiscordUser> {
  const tokenBody = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
  const tokenResponse = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenBody,
  });
  if (!tokenResponse.ok) {
    throw new Error(`Discord token exchange failed with HTTP ${tokenResponse.status}`);
  }
  const token = await tokenResponse.json() as { access_token?: unknown };
  if (typeof token.access_token !== "string" || token.access_token.length === 0) {
    throw new Error("Discord token response did not include access_token");
  }

  const userResponse = await fetchImpl(config.userUrl, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token.access_token}`,
    },
  });
  if (!userResponse.ok) {
    throw new Error(`Discord user lookup failed with HTTP ${userResponse.status}`);
  }
  const user = await userResponse.json() as { id?: unknown; username?: unknown; global_name?: unknown };
  if (typeof user.id !== "string" || user.id.length === 0) {
    throw new Error("Discord user response did not include id");
  }

  const displayName =
    typeof user.global_name === "string" && user.global_name.length > 0
      ? user.global_name
      : typeof user.username === "string" && user.username.length > 0
        ? user.username
        : user.id;
  return {
    id: user.id,
    displayName,
  };
}

function buildDiscordAuthorizeUrl(config: DiscordOAuthConfig, state: string): URL {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  return url;
}

async function fetchGitHubUser(
  config: GitHubOAuthConfig,
  code: string,
  fetchImpl: typeof fetch,
): Promise<GitHubUser> {
  const tokenBody = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
  const tokenResponse = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenBody,
  });
  if (!tokenResponse.ok) {
    throw new Error(`GitHub token exchange failed with HTTP ${tokenResponse.status}`);
  }
  const token = await tokenResponse.json() as { access_token?: unknown };
  if (typeof token.access_token !== "string" || token.access_token.length === 0) {
    throw new Error("GitHub token response did not include access_token");
  }

  const userResponse = await fetchImpl(config.userUrl, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token.access_token}`,
    },
  });
  if (!userResponse.ok) {
    throw new Error(`GitHub user lookup failed with HTTP ${userResponse.status}`);
  }
  const user = await userResponse.json() as { id?: unknown; login?: unknown; name?: unknown };
  if (typeof user.id !== "number") {
    throw new Error("GitHub user response did not include id");
  }

  const displayName =
    typeof user.name === "string" && user.name.length > 0
      ? user.name
      : typeof user.login === "string" && user.login.length > 0
        ? user.login
        : String(user.id);
  return {
    id: String(user.id),
    displayName,
  };
}

function buildGitHubAuthorizeUrl(config: GitHubOAuthConfig, state: string): URL {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);
  return url;
}

async function fetchGoogleUser(
  config: GoogleOAuthConfig,
  code: string,
  fetchImpl: typeof fetch,
): Promise<GoogleUser> {
  const tokenBody = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
  const tokenResponse = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenBody,
  });
  if (!tokenResponse.ok) {
    throw new Error(`Google token exchange failed with HTTP ${tokenResponse.status}`);
  }
  const token = await tokenResponse.json() as { access_token?: unknown };
  if (typeof token.access_token !== "string" || token.access_token.length === 0) {
    throw new Error("Google token response did not include access_token");
  }

  const userResponse = await fetchImpl(config.userUrl, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });
  if (!userResponse.ok) {
    throw new Error(`Google user lookup failed with HTTP ${userResponse.status}`);
  }
  const user = await userResponse.json() as { id?: unknown; sub?: unknown; name?: unknown };
  const id = typeof user.id === "string" && user.id.length > 0
    ? user.id
    : typeof user.sub === "string" && user.sub.length > 0
      ? user.sub
      : "";
  if (!id) {
    throw new Error("Google user response did not include id or sub");
  }

  const displayName = typeof user.name === "string" && user.name.length > 0 ? user.name : id;
  return { id, displayName };
}

function buildGoogleAuthorizeUrl(config: GoogleOAuthConfig, state: string): URL {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  return url;
}

function renderAuthCompletionPage(
  config: SailRegistryConfig,
  completed: ChallengeCompletionResponse,
  heading: string,
): string {
  const consoleUrl = buildConsoleCompletionUrl(config, completed);
  const consoleLink = consoleUrl
    ? `<p><a href="${escapeHtml(consoleUrl)}">Open Sail Console</a></p>`
    : "";
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(heading)}</title>`,
    "</head>",
    "<body>",
    "<main>",
    `<h1>${escapeHtml(heading)}</h1>`,
    "<p>Return to Minecraft and rejoin.</p>",
    consoleLink,
    "</main>",
    "</body>",
    "</html>",
  ].filter((line) => line.length > 0).join("");
}

function buildConsoleCompletionUrl(
  config: SailRegistryConfig,
  completed: ChallengeCompletionResponse,
): string | undefined {
  if (!config.consoleUrl) {
    return undefined;
  }

  const url = new URL(config.consoleUrl);
  if (!url.pathname.endsWith("/") && !/\.[^/]+$/u.test(url.pathname)) {
    url.pathname = `${url.pathname}/`;
  }
  url.hash =
    `session_token=${encodeURIComponent(completed.identity.session_token)}` +
    `&session_id=${encodeURIComponent(completed.identity.session_id)}`;
  return url.toString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function deleteExpiredOAuthStates(oauthStates: Map<string, OAuthState>): void {
  const now = Date.now();
  for (const [state, value] of oauthStates.entries()) {
    if (value.expiresAt <= now) {
      oauthStates.delete(state);
    }
  }
}

function extractBearerToken(authorization: string | undefined): string {
  if (!authorization?.startsWith("Bearer ")) {
    throw createSailError("session_invalid", 401, true, "Your Sail session is invalid. Join again to authenticate.");
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (token.length === 0) {
    throw createSailError("session_invalid", 401, true, "Your Sail session is invalid. Join again to authenticate.");
  }
  return token;
}

function extractOptionalBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

async function validateServerApiKey(
  config: SailRegistryConfig,
  authorization: string | undefined,
  serverId: string,
  options?: { required?: boolean },
): Promise<void> {
  const token = extractOptionalBearerToken(authorization);
  if (!token) {
    if (options?.required) {
      throw createSailError("api_key_required", 403, true, "A valid API key is required.");
    }
    return;
  }

  const payload = await verifyApiKeyJwt(config, token);
  if (!payload) {
    throw createSailError("api_key_invalid", 403, true, "The provided API key is invalid or expired.");
  }
  if (payload.sub !== serverId) {
    throw createSailError("api_key_server_mismatch", 403, false, "The API key does not match the requested server.", {
      expected_server_id: serverId,
      api_key_server_id: payload.sub,
    });
  }
}
