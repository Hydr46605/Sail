import { randomUUID } from "node:crypto";
import type { JWTPayload } from "jose";
import { JWTExpired } from "jose/errors";
import { sql, type Selectable, type Transaction } from "kysely";
import type { SailJwk, SailRegistryConfig } from "../config.js";
import type { RegistryDatabase, RegistryDatabaseSchema } from "../db/schema.js";
import { createPremiumNameLookup, type PremiumNameLookup } from "../premium-names.js";
import {
  type ChallengeCreatedResponse,
  type ChallengeCompletionResponse,
  type ChallengeService,
  type ChallengeServiceDependencies,
  type ChallengeStatus,
  type ChallengeStatusResponse,
  type ConsoleProfileResponse,
  type CompletedIdentity,
  type CreateChallengeInput,
  type NameLookupResponse,
  type OAuthCompletionInput,
  type ServerDeregistrationResponse,
  type SessionRevocationResponse,
  type ServerRecordResponse,
  type SessionVerificationInput,
  type SessionVerificationResponse,
} from "./challenge-service.js";
import {
  buildAuthUrl,
  createSailError,
  normalizeMinecraftName,
  randomCodePart,
} from "./challenge-utils.js";
import {
  accountPublicId,
  challengePublicId,
  minecraftIdentityPublicId,
  nameClaimPublicId,
  parseChallengePublicId,
  parseSessionPublicId,
  sessionPublicId,
} from "./ids.js";
import { getActiveServerById, recordServerHeartbeat, serializeServerRecord } from "./server-records.js";
import { SessionSigner } from "./session-signer.js";
import { selectPostgresVerificationPublicKeys } from "./signing-key-store.js";
import { hashSecret } from "./token-hash.js";

type RegistryExecutor = RegistryDatabase | Transaction<RegistryDatabaseSchema>;

type ChallengeRow = Selectable<RegistryDatabaseSchema["auth_challenges"]>;

interface PostgresChallengeServiceDependencies extends ChallengeServiceDependencies {
  sessionSigner?: SessionSigner;
}

interface AccountRow {
  id: string;
}

interface LocalIdentityAndClaim {
  identityId: string;
  minecraftUuid: string;
  claimId: string;
}

interface ActiveClaimRow {
  account_id: string;
  claim_id: string;
  display_name: string;
  identity_id: string;
  minecraft_uuid: string;
}

interface AuthenticatedConsoleSession {
  sessionId: string;
  accountId: string;
  publicAccountId: string;
  serverId: string;
  canonicalName: string;
  minecraftUuid: string;
  minecraftIdentityId: string;
  nameClaimId: string;
  accountDisplayName: string | null;
  accountStatus: "active" | "suspended" | "recovery_locked" | "deleted";
  accountRiskLevel: "low" | "medium" | "high";
}

export class PostgresChallengeService implements ChallengeService {
  private readonly premiumNames: PremiumNameLookup;
  private readonly signer: SessionSigner;

  constructor(
    private readonly config: SailRegistryConfig,
    private readonly db: RegistryDatabase,
    dependencies: PostgresChallengeServiceDependencies = {},
  ) {
    this.signer = dependencies.sessionSigner ?? SessionSigner.fromConfiguredKey(config);
    this.premiumNames = dependencies.premiumNames ?? createPremiumNameLookup(config);
  }

  async getPublicKeys(): Promise<SailJwk[]> {
    const keys = await selectPostgresVerificationPublicKeys(this.config.registryId, this.db);
    return keys.length > 0 ? keys : [this.signer.getPublicJwk()];
  }

  async getServer(serverId: string): Promise<ServerRecordResponse> {
    const server = await getActiveServerById(this.db, this.config.registryId, serverId);
    if (!server) {
      throw serverNotFound(serverId);
    }

    return serializeServerRecord(server);
  }

  async createChallenge(input: CreateChallengeInput): Promise<ChallengeCreatedResponse> {
    if (!(await getActiveServerById(this.db, this.config.registryId, input.server_id))) {
      throw serverNotFound(input.server_id);
    }

    const canonicalName = normalizeMinecraftName(input.username);
    await this.requireLocalNameAvailable(canonicalName);

    const challengeUuid = randomUUID();
    const code = `${randomCodePart()}-${randomCodePart()}`;
    const expiresAt = new Date(Date.now() + 180_000);

    await this.db
      .insertInto("auth_challenges")
      .values({
        id: challengeUuid,
        server_id: input.server_id,
        requested_name: input.username,
        canonical_name: canonicalName,
        connection_id_hash: hashSecret(input.connection_id),
        challenge_code_hash: hashSecret(code),
        mode: input.mode,
        account_id: null,
        minecraft_identity_id: null,
        name_claim_id: null,
        session_id: null,
        expires_at: expiresAt,
      })
      .execute();

    return {
      protocol_version: "sail-protocol-v1",
      challenge_id: challengePublicId(challengeUuid),
      status: "pending",
      server_id: input.server_id,
      requested_name: input.username,
      mode: input.mode,
      code,
      auth_url: buildAuthUrl(this.config.authUrl, code),
      expires_at: expiresAt.toISOString(),
    };
  }

  async getChallenge(challengeId: string): Promise<ChallengeStatusResponse> {
    const challengeUuid = parseChallengePublicIdOrNotFound(challengeId);
    const challenge = await this.requireChallenge(challengeUuid);
    await this.expireIfNeeded(challenge);
    return this.serializeChallenge(challengeUuid, this.db, undefined, true);
  }

  async getChallengeByCode(code: string): Promise<ChallengeStatusResponse> {
    const challenge = await this.db
      .selectFrom("auth_challenges")
      .selectAll()
      .where("challenge_code_hash", "=", hashSecret(code))
      .executeTakeFirst();
    if (!challenge) {
      throw challengeNotFound();
    }
    await this.expireIfNeeded(challenge);
    return this.serializeChallenge(challenge.id, this.db, undefined, false);
  }

  async completeCodeWithOAuth(
    code: string,
    oauthIdentity: OAuthCompletionInput,
  ): Promise<ChallengeCompletionResponse> {
    const challenge = await this.db
      .selectFrom("auth_challenges")
      .select(["id"])
      .where("challenge_code_hash", "=", hashSecret(code))
      .executeTakeFirst();
    if (!challenge) {
      throw challengeNotFound();
    }
    return this.completeChallengeByUuid(challenge.id, oauthIdentity);
  }

  async completeWithOAuth(
    challengeId: string,
    oauthIdentity: OAuthCompletionInput,
  ): Promise<ChallengeCompletionResponse> {
    const challengeUuid = parseChallengePublicIdOrNotFound(challengeId);
    return this.completeChallengeByUuid(challengeUuid, oauthIdentity);
  }

  async verifySession(input: SessionVerificationInput): Promise<SessionVerificationResponse> {
    if (typeof input.server_id !== "string" || input.server_id.length === 0) {
      throw serverNotFound("");
    }

    let payload: JWTPayload;
    try {
      payload = await this.signer.verifySessionToken(input.session_token);
    } catch {
      throw sessionInvalid();
    }

    if (typeof payload.session_id !== "string" || typeof payload.server_id !== "string") {
      throw sessionInvalid();
    }

    let sessionUuid: string;
    try {
      sessionUuid = parseSessionPublicId(payload.session_id);
    } catch {
      throw sessionInvalid();
    }

    const session = await this.db
      .selectFrom("sessions")
      .innerJoin("name_claims", "name_claims.id", "sessions.name_claim_id")
      .innerJoin("minecraft_identities", "minecraft_identities.id", "sessions.minecraft_identity_id")
      .select([
        "sessions.id as session_id",
        "sessions.server_id",
        "sessions.session_token_hash",
        "sessions.status",
        "sessions.expires_at",
        "name_claims.canonical_name",
        "minecraft_identities.minecraft_uuid",
      ])
      .where("sessions.id", "=", sessionUuid)
      .executeTakeFirst();

    if (!session || session.session_token_hash !== hashSecret(input.session_token)) {
      throw sessionInvalid();
    }
    if (session.status === "revoked") {
      throw createSailError("session_revoked", 403, true, "Your Sail session was revoked. Join again to authenticate.");
    }
    if (session.status !== "completed") {
      throw sessionInvalid();
    }
    if (session.expires_at.getTime() <= Date.now()) {
      throw sessionExpired();
    }

    const issuerServer = await getActiveServerById(this.db, this.config.registryId, session.server_id);
    if (!issuerServer) {
      throw serverNotFound(session.server_id);
    }
    const targetServer = await getActiveServerById(this.db, this.config.registryId, input.server_id);
    if (!targetServer) {
      throw serverNotFound(input.server_id);
    }

    if (!sessionPayloadMatches(payload, {
      sessionId: sessionPublicId(session.session_id),
      serverId: session.server_id,
      canonicalName: session.canonical_name,
      minecraftUuid: session.minecraft_uuid,
    })) {
      throw sessionInvalid();
    }

    if (
      input.server_id !== session.server_id
      && (issuerServer.session_reuse_policy !== "same_registry" || targetServer.session_reuse_policy !== "same_registry")
    ) {
      throw sessionReuseDenied(session.server_id, input.server_id);
    }

    await this.db
      .updateTable("servers")
      .set({ last_successful_verification_at: new Date() })
      .where("registry_id", "=", this.config.registryId)
      .where("server_id", "=", input.server_id)
      .where("status", "=", "active")
      .execute();

    return {
      protocol_version: "sail-protocol-v1",
      session_id: sessionPublicId(session.session_id),
      status: "active",
      canonical_name: session.canonical_name,
      minecraft_uuid: session.minecraft_uuid,
      server_id: input.server_id,
      issuer_server_id: session.server_id,
      session_reuse_policy: targetServer.session_reuse_policy,
    };
  }

  async revokeSession(sessionId: string): Promise<SessionRevocationResponse> {
    const sessionUuid = parseSessionPublicIdOrNotFound(sessionId);
    const revokedAt = new Date();
    const result = await this.db
      .updateTable("sessions")
      .set({
        status: "revoked",
        revoked_at: revokedAt,
      })
      .where("id", "=", sessionUuid)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows) === 0) {
      throw createSailError("session_not_found", 404, false, "Sail session was not found.");
    }

    return {
      protocol_version: "sail-protocol-v1",
      session_id: sessionId,
      status: "revoked",
      revoked_at: revokedAt.toISOString(),
    };
  }

  async getConsoleProfile(sessionToken: string): Promise<ConsoleProfileResponse> {
    const authenticated = await this.authenticateConsoleSession(sessionToken);
    const linkedProviders = await this.db
      .selectFrom("oauth_identities")
      .select(["provider", "provider_username", "created_at", "last_used_at"])
      .where("account_id", "=", authenticated.accountId)
      .orderBy("created_at", "asc")
      .execute();
    const names = await this.db
      .selectFrom("name_claims")
      .innerJoin("minecraft_identities", "minecraft_identities.id", "name_claims.minecraft_identity_id")
      .select([
        "name_claims.id as name_claim_id",
        "name_claims.canonical_name",
        "name_claims.display_name",
        "name_claims.claim_type",
        "name_claims.issuer_registry_id",
        "name_claims.status",
        "name_claims.created_at",
        "minecraft_identities.id as minecraft_identity_id",
        "minecraft_identities.identity_type",
        "minecraft_identities.minecraft_uuid",
      ])
      .where("name_claims.account_id", "=", authenticated.accountId)
      .where("name_claims.status", "=", "active")
      .orderBy("name_claims.created_at", "asc")
      .execute();
    const sessions = await this.db
      .selectFrom("sessions")
      .leftJoin("servers", (join) =>
        join
          .onRef("servers.server_id", "=", "sessions.server_id")
          .on("servers.registry_id", "=", this.config.registryId),
      )
      .select([
        "sessions.id as session_id",
        "sessions.server_id",
        "sessions.status",
        "sessions.created_at",
        "sessions.completed_at",
        "sessions.expires_at",
        "sessions.revoked_at",
        "servers.display_name as server_display_name",
      ])
      .where("sessions.account_id", "=", authenticated.accountId)
      .orderBy("sessions.created_at", "asc")
      .execute();
    const sessionServerIds = new Set(sessions.map((session) => session.server_id));
    const sessionServers = sessionServerIds.size === 0
      ? []
      : await this.db
          .selectFrom("servers")
          .selectAll()
          .where("registry_id", "=", this.config.registryId)
          .where("status", "=", "active")
          .where("server_id", "in", [...sessionServerIds])
          .execute();
    const publicListingServers = await this.db
      .selectFrom("servers")
      .selectAll()
      .where("registry_id", "=", this.config.registryId)
      .where("status", "=", "active")
      .where("public_listing", "=", true)
      .execute();
    const trustedServersById = new Map(
      [...sessionServers, ...publicListingServers].map((server) => [server.server_id, server]),
    );

    return {
      protocol_version: "sail-protocol-v1",
      account: {
        account_id: authenticated.publicAccountId,
        display_name: authenticated.accountDisplayName,
        status: authenticated.accountStatus,
        risk_level: authenticated.accountRiskLevel,
        linked_providers: linkedProviders.map((provider) => ({
          provider: provider.provider,
          provider_username: provider.provider_username,
          created_at: provider.created_at.toISOString(),
          last_used_at: provider.last_used_at?.toISOString() ?? null,
        })),
      },
      names: names.map((name) => ({
        name_claim_id: nameClaimPublicId(name.name_claim_id),
        minecraft_identity_id: minecraftIdentityPublicId(name.minecraft_identity_id),
        canonical_name: name.canonical_name,
        display_name: name.display_name,
        claim_type: name.claim_type,
        identity_type: name.identity_type,
        minecraft_uuid: name.minecraft_uuid,
        issuer_registry_id: name.issuer_registry_id,
        status: name.status,
        created_at: name.created_at.toISOString(),
      })),
      sessions: sessions.map((session) => ({
        session_id: sessionPublicId(session.session_id),
        server_id: session.server_id,
        server_display_name: session.server_display_name ?? session.server_id,
        status: session.status,
        current: session.session_id === authenticated.sessionId,
        created_at: session.created_at.toISOString(),
        completed_at: session.completed_at?.toISOString() ?? null,
        expires_at: session.expires_at.toISOString(),
        revoked_at: session.revoked_at?.toISOString() ?? null,
      })),
      trusted_servers: [...trustedServersById.values()].map((server) => serializeServerRecord(server)),
    };
  }

  async revokeConsoleSession(sessionToken: string, sessionId: string): Promise<SessionRevocationResponse> {
    const authenticated = await this.authenticateConsoleSession(sessionToken);
    const sessionUuid = parseSessionPublicIdOrNotFound(sessionId);
    const revokedAt = new Date();
    const result = await this.db
      .updateTable("sessions")
      .set({
        status: "revoked",
        revoked_at: revokedAt,
      })
      .where("id", "=", sessionUuid)
      .where("account_id", "=", authenticated.accountId)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows) === 0) {
      throw createSailError("session_not_found", 404, false, "Sail session was not found.");
    }

    return {
      protocol_version: "sail-protocol-v1",
      session_id: sessionPublicId(sessionUuid),
      status: "revoked",
      revoked_at: revokedAt.toISOString(),
    };
  }

  private async authenticateConsoleSession(sessionToken: string): Promise<AuthenticatedConsoleSession> {
    let payload: JWTPayload;
    try {
      payload = await this.signer.verifySessionToken(sessionToken);
    } catch (error) {
      if (isJwtExpired(error)) {
        throw sessionExpired();
      }
      throw sessionInvalid();
    }

    if (typeof payload.session_id !== "string" || typeof payload.server_id !== "string") {
      throw sessionInvalid();
    }

    let sessionUuid: string;
    try {
      sessionUuid = parseSessionPublicId(payload.session_id);
    } catch {
      throw sessionInvalid();
    }

    const session = await this.db
      .selectFrom("sessions")
      .innerJoin("accounts", "accounts.id", "sessions.account_id")
      .innerJoin("name_claims", "name_claims.id", "sessions.name_claim_id")
      .innerJoin("minecraft_identities", "minecraft_identities.id", "sessions.minecraft_identity_id")
      .innerJoin("servers", (join) =>
        join
          .onRef("servers.server_id", "=", "sessions.server_id")
          .on("servers.registry_id", "=", this.config.registryId)
          .on("servers.status", "=", "active"),
      )
      .select([
        "sessions.id as session_id",
        "sessions.account_id",
        "sessions.minecraft_identity_id",
        "sessions.name_claim_id",
        "sessions.server_id",
        "sessions.session_token_hash",
        "sessions.status",
        "sessions.expires_at",
        "accounts.primary_display_name",
        "accounts.status as account_status",
        "accounts.risk_level",
        "name_claims.canonical_name",
        "minecraft_identities.minecraft_uuid",
      ])
      .where("sessions.id", "=", sessionUuid)
      .executeTakeFirst();

    if (
      !session
      || !session.account_id
      || !session.minecraft_identity_id
      || !session.name_claim_id
      || session.session_token_hash !== hashSecret(sessionToken)
    ) {
      throw sessionInvalid();
    }
    if (session.status === "revoked") {
      throw createSailError("session_revoked", 403, true, "Your Sail session was revoked. Join again to authenticate.");
    }
    if (session.status === "expired" || session.expires_at.getTime() <= Date.now()) {
      throw sessionExpired();
    }
    if (session.status !== "completed") {
      throw sessionInvalid();
    }

    const publicSessionId = sessionPublicId(session.session_id);
    const publicAccountId = accountPublicId(session.account_id);
    if (
      !sessionPayloadMatches(payload, {
        sessionId: publicSessionId,
        serverId: session.server_id,
        canonicalName: session.canonical_name,
        minecraftUuid: session.minecraft_uuid,
      })
      || payload.sub !== publicAccountId
      || payload.account_id !== publicAccountId
      || payload.minecraft_identity_id !== minecraftIdentityPublicId(session.minecraft_identity_id)
      || payload.name_claim_id !== nameClaimPublicId(session.name_claim_id)
    ) {
      throw sessionInvalid();
    }

    return {
      sessionId: session.session_id,
      accountId: session.account_id,
      publicAccountId,
      serverId: session.server_id,
      canonicalName: session.canonical_name,
      minecraftUuid: session.minecraft_uuid,
      minecraftIdentityId: session.minecraft_identity_id,
      nameClaimId: session.name_claim_id,
      accountDisplayName: session.primary_display_name,
      accountStatus: session.account_status,
      accountRiskLevel: session.risk_level,
    };
  }

  private async completeChallengeByUuid(
    challengeUuid: string,
    oauthIdentity: OAuthCompletionInput,
  ): Promise<ChallengeCompletionResponse> {
    return this.db.transaction().execute(async (trx) => {
      const challenge = await trx
        .selectFrom("auth_challenges")
        .selectAll()
        .where("id", "=", challengeUuid)
        .forUpdate()
        .executeTakeFirst();
      if (!challenge) {
        throw challengeNotFound();
      }

      const status = await this.expireIfNeeded(challenge, trx);
      if (status === "expired") {
        throw createSailError("session_expired", 410, true, "Your Sail login code expired. Join again to get a new code.");
      }
      if (status === "completed") {
        throw createSailError("challenge_already_completed", 409, false, "Sail login code was already completed.");
      }
      if (status !== "pending") {
        throw createSailError("challenge_not_found", 404, false, "Sail login code was not found.");
      }

      const account = await upsertOAuthAccount(trx, oauthIdentity);
      const existingClaim = await selectActiveClaim(trx, challenge.canonical_name, this.config.registryId);
      if (existingClaim && existingClaim.account_id !== account.id) {
        throw createSailError(
          "name_already_claimed",
          409,
          false,
          "This name is already registered through Sail.",
          { canonical_name: challenge.canonical_name },
        );
      }

      let localIdentity: LocalIdentityAndClaim;
      try {
        localIdentity = existingClaim
          ? {
              identityId: existingClaim.identity_id,
              minecraftUuid: existingClaim.minecraft_uuid,
              claimId: existingClaim.claim_id,
            }
          : await createLocalIdentityAndClaim(trx, {
              accountId: account.id,
              canonicalName: challenge.canonical_name,
              displayName: challenge.requested_name,
              issuerRegistryId: this.config.registryId,
            });
      } catch (error) {
        if (isUniqueViolation(error, "name_claims_active_name_registry_unique")) {
          throw createSailError(
            "name_already_claimed",
            409,
            false,
            "This name is already registered through Sail.",
            { canonical_name: challenge.canonical_name },
          );
        }
        throw error;
      }

      const sessionUuid = randomUUID();
      const publicSessionId = sessionPublicId(sessionUuid);
      const sessionToken = await this.signer.signSession({
        accountId: accountPublicId(account.id),
        canonicalName: challenge.canonical_name,
        minecraftIdentityId: minecraftIdentityPublicId(localIdentity.identityId),
        minecraftUuid: localIdentity.minecraftUuid,
        nameClaimId: nameClaimPublicId(localIdentity.claimId),
        serverId: challenge.server_id,
        sessionId: publicSessionId,
      });
      const now = new Date();
      const sessionExpiresAt = new Date(now.getTime() + 60 * 60_000);

      await trx
        .insertInto("sessions")
        .values({
          id: sessionUuid,
          server_id: challenge.server_id,
          account_id: account.id,
          minecraft_identity_id: localIdentity.identityId,
          name_claim_id: localIdentity.claimId,
          session_token_hash: hashSecret(sessionToken),
          challenge_code_hash: challenge.challenge_code_hash,
          status: "completed",
          expires_at: sessionExpiresAt,
          completed_at: now,
        })
        .execute();

      await trx
        .updateTable("auth_challenges")
        .set({
          status: "completed",
          account_id: account.id,
          minecraft_identity_id: localIdentity.identityId,
          name_claim_id: localIdentity.claimId,
          session_id: sessionUuid,
          completed_at: now,
        })
        .where("id", "=", challenge.id)
        .execute();

      await trx
        .insertInto("audit_events")
        .values({
          id: randomUUID(),
          actor_account_id: account.id,
          target_account_id: account.id,
          event_type: "minecraft_session_created",
          metadata_json: {
            canonical_name: challenge.canonical_name,
            server_id: challenge.server_id,
            session_id: publicSessionId,
          },
        })
        .execute();

      return this.serializeCompletedChallenge(challenge.id, trx, sessionToken);
    });
  }

  private async requireChallenge(challengeUuid: string): Promise<ChallengeRow> {
    const challenge = await this.db
      .selectFrom("auth_challenges")
      .selectAll()
      .where("id", "=", challengeUuid)
      .executeTakeFirst();
    if (!challenge) {
      throw challengeNotFound();
    }
    return challenge;
  }

  private async expireIfNeeded(
    challenge: Pick<ChallengeRow, "id" | "status" | "expires_at">,
    executor: RegistryExecutor = this.db,
  ): Promise<ChallengeStatus> {
    if (challenge.status !== "pending") {
      return challenge.status;
    }
    if (challenge.expires_at.getTime() > Date.now()) {
      return "pending";
    }

    await executor
      .updateTable("auth_challenges")
      .set({ status: "expired" })
      .where("id", "=", challenge.id)
      .where("status", "=", "pending")
      .execute();
    return "expired";
  }

  private async serializeChallenge(
    challengeUuid: string,
    executor: RegistryExecutor = this.db,
    sessionToken?: string,
    includeSessionToken = false,
  ): Promise<ChallengeStatusResponse> {
    const challenge = await executor
      .selectFrom("auth_challenges")
      .selectAll()
      .where("id", "=", challengeUuid)
      .executeTakeFirst();
    if (!challenge) {
      throw challengeNotFound();
    }

    const base = {
      protocol_version: "sail-protocol-v1" as const,
      challenge_id: challengePublicId(challenge.id),
      status: challenge.status,
      mode: challenge.mode,
      expires_at: challenge.expires_at.toISOString(),
    };

    if (challenge.status !== "completed") {
      return base;
    }
    if (!challenge.completed_at) {
      throw new Error("Completed Sail challenge is missing completion timestamp");
    }

    const identity = await executor
      .selectFrom("auth_challenges")
      .innerJoin("minecraft_identities", "minecraft_identities.id", "auth_challenges.minecraft_identity_id")
      .innerJoin("name_claims", "name_claims.id", "auth_challenges.name_claim_id")
      .innerJoin("sessions", "sessions.id", "auth_challenges.session_id")
      .select([
        "auth_challenges.account_id as account_id",
        "auth_challenges.minecraft_identity_id as minecraft_identity_id",
        "auth_challenges.name_claim_id as name_claim_id",
        "auth_challenges.session_id as session_id",
        "auth_challenges.server_id as challenge_server_id",
        "sessions.server_id as session_server_id",
        "minecraft_identities.minecraft_uuid",
        "minecraft_identities.identity_type",
        "name_claims.canonical_name",
        "name_claims.display_name",
        "name_claims.claim_type",
      ])
      .where("auth_challenges.id", "=", challengeUuid)
      .executeTakeFirst();

    if (
      !identity
      || !identity.account_id
      || !identity.minecraft_identity_id
      || !identity.name_claim_id
      || !identity.session_id
    ) {
      throw new Error("Completed Sail challenge is missing identity records");
    }
    if (identity.challenge_server_id !== identity.session_server_id) {
      throw new Error("Completed Sail challenge session server does not match challenge server");
    }
    const responseSessionToken = sessionToken ?? (
      includeSessionToken
        ? await this.createChallengeStatusSessionToken(executor, {
            accountId: identity.account_id,
            canonicalName: identity.canonical_name,
            minecraftIdentityId: identity.minecraft_identity_id,
            minecraftUuid: identity.minecraft_uuid,
            nameClaimId: identity.name_claim_id,
            serverId: identity.session_server_id,
            sessionId: identity.session_id,
          })
        : undefined
    );

    const completedIdentity: CompletedIdentity = {
      account_id: accountPublicId(identity.account_id),
      minecraft_identity_id: minecraftIdentityPublicId(identity.minecraft_identity_id),
      name_claim_id: nameClaimPublicId(identity.name_claim_id),
      canonical_name: identity.canonical_name,
      display_name: identity.display_name,
      minecraft_uuid: identity.minecraft_uuid,
      claim_type: "LOCAL_SOFT",
      identity_type: "SAIL_LOCAL",
      session_id: sessionPublicId(identity.session_id),
      ...(responseSessionToken ? { session_token: responseSessionToken } : {}),
    };

    return {
      ...base,
      status: "completed",
      completed_at: challenge.completed_at.toISOString(),
      identity: completedIdentity,
    };
  }

  private async serializeCompletedChallenge(
    challengeUuid: string,
    executor: RegistryExecutor,
    sessionToken: string,
  ): Promise<ChallengeCompletionResponse> {
    const response = await this.serializeChallenge(challengeUuid, executor, sessionToken);
    if (response.status !== "completed" || !response.completed_at || !response.identity?.session_token) {
      throw new Error("Completed Sail challenge is missing session token");
    }

    return {
      protocol_version: response.protocol_version,
      challenge_id: response.challenge_id,
      status: "completed",
      expires_at: response.expires_at,
      completed_at: response.completed_at,
      identity: {
        ...response.identity,
        session_token: response.identity.session_token,
      },
    };
  }

  private async createChallengeStatusSessionToken(
    executor: RegistryExecutor,
    input: {
      accountId: string;
      canonicalName: string;
      minecraftIdentityId: string;
      minecraftUuid: string;
      nameClaimId: string;
      serverId: string;
      sessionId: string;
    },
  ): Promise<string> {
    const token = await this.signer.signSession({
      accountId: accountPublicId(input.accountId),
      canonicalName: input.canonicalName,
      minecraftIdentityId: minecraftIdentityPublicId(input.minecraftIdentityId),
      minecraftUuid: input.minecraftUuid,
      nameClaimId: nameClaimPublicId(input.nameClaimId),
      serverId: input.serverId,
      sessionId: sessionPublicId(input.sessionId),
    });
    await executor
      .updateTable("sessions")
      .set({ session_token_hash: hashSecret(token) })
      .where("id", "=", input.sessionId)
      .execute();
    return token;
  }

  private async requireLocalNameAvailable(canonicalName: string): Promise<void> {
    if (!this.config.blockPremiumNamesForLocal) {
      return;
    }

    let premiumStatus;
    try {
      premiumStatus = await this.premiumNames.lookup(canonicalName);
    } catch {
      throw createSailError(
        "registry_unavailable",
        503,
        true,
        "Sail could not verify your identity right now. Try again later.",
        { canonical_name: canonicalName },
      );
    }

    if (!premiumStatus.premium) {
      return;
    }

    const details: Record<string, unknown> = {
      canonical_name: canonicalName,
    };
    if (premiumStatus.mojangUuid) {
      details.mojang_uuid = premiumStatus.mojangUuid;
    }
    if (premiumStatus.mojangName) {
      details.mojang_name = premiumStatus.mojangName;
    }

    throw createSailError(
      "premium_name_required",
      409,
      false,
      "This name belongs to a Minecraft Java account. Join with the official account.",
      details,
    );
  }

  async getSessionByToken(token: string): Promise<{ account_id: string | null; session_id: string } | null> {
    try {
      const payload = await this.signer.verifySessionToken(token);
      if (typeof payload.session_id !== "string" || typeof payload.account_id !== "string") {
        return null;
      }
      const session = await this.db
        .selectFrom("sessions")
        .select(["session_token_hash", "account_id", "id as session_id", "status", "expires_at"])
        .where("id", "=", payload.session_id)
        .executeTakeFirst();
      if (!session) return null;
      if (session.session_token_hash !== hashSecret(token)) return null;
      if (session.status === "revoked" || session.expires_at.getTime() <= Date.now()) return null;
      return { account_id: session.account_id, session_id: session.session_id };
    } catch {
      return null;
    }
  }

  getDatabase(): RegistryDatabase {
    return this.db;
  }

  async recordHeartbeat(serverId: string): Promise<void> {
    const updated = await recordServerHeartbeat(this.db, this.config.registryId, serverId);
    if (!updated) {
      throw serverNotFound(serverId);
    }
  }

  async deregisterServer(sessionToken: string, serverId: string): Promise<ServerDeregistrationResponse> {
    const authenticated = await this.authenticateConsoleSession(sessionToken);
    const result = await this.db
      .updateTable("servers")
      .set({ status: "disabled", api_key_jwk_id: null, updated_at: sql`now()` })
      .where("registry_id", "=", this.config.registryId)
      .where("server_id", "=", serverId)
      .where("owner_account_id", "=", authenticated.accountId)
      .where("status", "=", "active")
      .executeTakeFirst();

    if (Number(result.numUpdatedRows) === 0) {
      throw createSailError("server_not_found", 404, false, "Server not found or you do not own it.", { server_id: serverId });
    }

    return {
      protocol_version: "sail-protocol-v1",
      server_id: serverId,
      status: "disabled",
    };
  }

  async lookupName(canonicalName: string): Promise<NameLookupResponse> {
    const claim = await this.db
      .selectFrom("name_claims")
      .innerJoin("minecraft_identities", "minecraft_identities.id", "name_claims.minecraft_identity_id")
      .select([
        "name_claims.canonical_name",
        "name_claims.display_name",
        "name_claims.claim_type",
        "name_claims.issuer_registry_id",
        "name_claims.priority",
        "name_claims.expires_at",
        "minecraft_identities.identity_type",
        "minecraft_identities.minecraft_uuid",
      ])
      .where("name_claims.canonical_name", "=", canonicalName)
      .where("name_claims.issuer_registry_id", "=", this.config.registryId)
      .where("name_claims.status", "=", "active")
      .executeTakeFirst();

    if (claim) {
      return {
        protocol_version: "sail-protocol-v1",
        canonical_name: claim.canonical_name,
        display_name: claim.display_name,
        status: "claimed",
        claim_type: claim.claim_type as NameLookupResponse["claim_type"],
        identity_type: claim.identity_type as NameLookupResponse["identity_type"],
        issuer_registry_id: claim.issuer_registry_id,
        minecraft_uuid: claim.minecraft_uuid,
        premium_name: claim.identity_type === "MOJANG_PREMIUM",
        priority: claim.priority,
        expires_at: claim.expires_at?.toISOString() ?? null,
      };
    }

    let premium = false;
    if (this.config.blockPremiumNamesForLocal) {
      try {
        const status = await this.premiumNames.lookup(canonicalName);
        premium = status.premium;
      } catch {
        // Fail open for name lookup — premium check is best-effort.
      }
    }

    return {
      protocol_version: "sail-protocol-v1",
      canonical_name: canonicalName,
      display_name: null,
      status: premium ? "premium_reserved" : "unclaimed",
      claim_type: null,
      identity_type: null,
      issuer_registry_id: null,
      minecraft_uuid: null,
      premium_name: premium,
      priority: null,
      expires_at: null,
    };
  }
}

async function upsertOAuthAccount(
  trx: Transaction<RegistryDatabaseSchema>,
  oauthIdentity: OAuthCompletionInput,
): Promise<AccountRow> {
  const now = new Date();
  const existing = await trx
    .selectFrom("oauth_identities")
    .select(["account_id"])
    .where("provider", "=", oauthIdentity.provider)
    .where("provider_subject", "=", oauthIdentity.provider_subject)
    .executeTakeFirst();

  if (existing) {
    await trx
      .updateTable("oauth_identities")
      .set({
        provider_username: oauthIdentity.provider_username ?? null,
        last_used_at: now,
      })
      .where("provider", "=", oauthIdentity.provider)
      .where("provider_subject", "=", oauthIdentity.provider_subject)
      .execute();
    await trx.updateTable("accounts").set({ last_seen_at: now }).where("id", "=", existing.account_id).execute();
    return { id: existing.account_id };
  }

  const accountId = randomUUID();
  await trx
    .insertInto("accounts")
    .values({
      id: accountId,
      primary_display_name: oauthIdentity.provider_username ?? null,
      last_seen_at: now,
    })
    .execute();

  const oauthRow = await trx
    .insertInto("oauth_identities")
    .values({
      id: randomUUID(),
      account_id: accountId,
      provider: oauthIdentity.provider,
      provider_subject: oauthIdentity.provider_subject,
      provider_username: oauthIdentity.provider_username ?? null,
      last_used_at: now,
    })
    .onConflict((oc) =>
      oc.columns(["provider", "provider_subject"]).doUpdateSet({
        provider_username: oauthIdentity.provider_username ?? null,
        last_used_at: now,
      }),
    )
    .returning(["account_id"])
    .executeTakeFirstOrThrow();

  if (oauthRow.account_id !== accountId) {
    await trx.deleteFrom("accounts").where("id", "=", accountId).execute();
    await trx.updateTable("accounts").set({ last_seen_at: now }).where("id", "=", oauthRow.account_id).execute();
  }

  return { id: oauthRow.account_id };
}

async function selectActiveClaim(
  executor: RegistryExecutor,
  canonicalName: string,
  issuerRegistryId: string,
): Promise<ActiveClaimRow | undefined> {
  return executor
    .selectFrom("name_claims")
    .innerJoin("minecraft_identities", "minecraft_identities.id", "name_claims.minecraft_identity_id")
    .select([
      "name_claims.account_id",
      "name_claims.id as claim_id",
      "name_claims.display_name",
      "minecraft_identities.id as identity_id",
      "minecraft_identities.minecraft_uuid",
    ])
    .where("name_claims.canonical_name", "=", canonicalName)
    .where("name_claims.issuer_registry_id", "=", issuerRegistryId)
    .where("name_claims.status", "=", "active")
    .executeTakeFirst();
}

async function createLocalIdentityAndClaim(
  trx: Transaction<RegistryDatabaseSchema>,
  input: {
    accountId: string;
    canonicalName: string;
    displayName: string;
    issuerRegistryId: string;
  },
): Promise<LocalIdentityAndClaim> {
  const identityId = randomUUID();
  const minecraftUuid = randomUUID();
  const claimId = randomUUID();

  await trx
    .insertInto("minecraft_identities")
    .values({
      id: identityId,
      account_id: input.accountId,
      identity_type: "SAIL_LOCAL",
      minecraft_uuid: minecraftUuid,
      mojang_uuid: null,
      issuer_registry_id: input.issuerRegistryId,
    })
    .execute();

  await trx
    .insertInto("name_claims")
    .values({
      id: claimId,
      canonical_name: input.canonicalName,
      display_name: input.displayName,
      account_id: input.accountId,
      minecraft_identity_id: identityId,
      claim_type: "LOCAL_SOFT",
      issuer_registry_id: input.issuerRegistryId,
      status: "active",
      priority: 10,
      expires_at: null,
      displaced_by_claim_id: null,
    })
    .execute();

  await trx
    .insertInto("audit_events")
    .values({
      id: randomUUID(),
      actor_account_id: input.accountId,
      target_account_id: input.accountId,
      event_type: "local_name_claim_created",
      metadata_json: {
        canonical_name: input.canonicalName,
        display_name: input.displayName,
        minecraft_identity_id: minecraftIdentityPublicId(identityId),
        name_claim_id: nameClaimPublicId(claimId),
      },
    })
    .execute();

  return {
    identityId,
    minecraftUuid,
    claimId,
  };
}

function parseChallengePublicIdOrNotFound(challengeId: string): string {
  try {
    return parseChallengePublicId(challengeId);
  } catch {
    throw challengeNotFound();
  }
}

function parseSessionPublicIdOrNotFound(sessionId: string): string {
  try {
    return parseSessionPublicId(sessionId);
  } catch {
    throw createSailError("session_not_found", 404, false, "Sail session was not found.");
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && "constraint" in error
    && error.code === "23505"
    && error.constraint === constraint
  );
}

function challengeNotFound(): Error {
  return createSailError("challenge_not_found", 404, false, "Sail login code was not found.");
}

function serverNotFound(serverId: string): Error {
  const error = createSailError(
    "server_not_found",
    404,
    false,
    "The requested server is not registered with this Sail registry.",
    { server_id: serverId },
  );
  error.body.error.audience = "developer";
  return error;
}

function sessionInvalid(): Error {
  return createSailError("session_invalid", 401, true, "Your Sail session is invalid. Join again to authenticate.");
}

function sessionExpired(): Error {
  return createSailError("session_expired", 410, true, "Your Sail session expired. Join again to authenticate.");
}

function isJwtExpired(error: unknown): boolean {
  return error instanceof JWTExpired || (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ERR_JWT_EXPIRED"
  );
}

function sessionReuseDenied(issuerServerId: string, targetServerId: string): Error {
  return createSailError(
    "session_reuse_denied",
    403,
    true,
    "Your Sail session cannot be reused on this server. Join again to complete a fresh login.",
    { issuer_server_id: issuerServerId, server_id: targetServerId },
  );
}

function sessionPayloadMatches(
  payload: JWTPayload,
  session: { sessionId: string; serverId: string; canonicalName: string; minecraftUuid: string },
): boolean {
  return (
    payload.protocol_version === "sail-protocol-v1" &&
    payload.scope === "minecraft_login" &&
    payload.session_id === session.sessionId &&
    payload.server_id === session.serverId &&
    payload.canonical_name === session.canonicalName &&
    payload.minecraft_uuid === session.minecraftUuid
  );
}
