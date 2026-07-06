import { randomUUID } from "node:crypto";
import type { JWTPayload } from "jose";
import { JWTExpired } from "jose/errors";
import type { SailRegistryConfig } from "./config.js";
import type { SailJwk } from "./config.js";
import type { RegistryDatabase } from "./db/schema.js";
import { createPremiumNameLookup, type PremiumNameLookup } from "./premium-names.js";
import {
  type ChallengeCreatedResponse,
  type ChallengeCompletionResponse,
  type ChallengeMode,
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
} from "./identity/challenge-service.js";
import {
  buildAuthUrl,
  createSailError,
  normalizeMinecraftName,
  randomCodePart,
  randomToken,
} from "./identity/challenge-utils.js";
import { SessionSigner } from "./identity/session-signer.js";
import { hashSecret } from "./identity/token-hash.js";

interface PendingChallenge {
  challengeId: string;
  code: string;
  serverId: string;
  requestedName: string;
  canonicalName: string;
  mode: ChallengeMode;
  expiresAt: Date;
  status: ChallengeStatus;
  completedAt?: Date;
  identity?: CompletedIdentity;
}

interface LocalNameClaim {
  accountId: string;
  minecraftIdentityId: string;
  nameClaimId: string;
  canonicalName: string;
  displayName: string;
  minecraftUuid: string;
  createdAt: Date;
}

interface LocalSession {
  sessionId: string;
  tokenHash: string;
  serverId: string;
  accountId: string;
  minecraftIdentityId: string;
  nameClaimId: string;
  canonicalName: string;
  minecraftUuid: string;
  status: "completed" | "revoked";
  createdAt: Date;
  completedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
}

export class InMemoryChallengeService implements ChallengeService {
  private readonly challenges = new Map<string, PendingChallenge>();
  private readonly challengeIdsByCode = new Map<string, string>();
  private readonly localNameClaims = new Map<string, LocalNameClaim>();
  private readonly sessions = new Map<string, LocalSession>();
  private readonly premiumNames: PremiumNameLookup;
  private readonly signer: SessionSigner;

  constructor(
    private readonly config: SailRegistryConfig,
    dependencies: ChallengeServiceDependencies = {},
  ) {
    const [firstKey] = config.publicKeys;
    this.signer = new SessionSigner(firstKey?.kid ?? "dev-es256-2026-06", config.registryId);
    this.premiumNames = dependencies.premiumNames ?? createPremiumNameLookup(config);
  }

  getPublicKeys(): SailJwk[] {
    return [this.signer.getPublicJwk()];
  }

  getServer(serverId: string): ServerRecordResponse {
    const server = this.config.defaultServer;
    if (serverId !== server.serverId) {
      throw serverNotFound(serverId);
    }

    return {
      protocol_version: "sail-protocol-v1",
      registry_id: this.config.registryId,
      server_id: server.serverId,
      display_name: server.displayName,
      registry_mode: server.registryMode,
      allowed_claim_types: [...server.allowedClaimTypes],
      session_reuse_policy: server.sessionReusePolicy,
      privacy_mode: server.privacyMode,
      status: "active",
      public_listing: server.publicListing,
      last_heartbeat_at: null,
    };
  }

  async createChallenge(input: CreateChallengeInput): Promise<ChallengeCreatedResponse> {
    if (input.server_id !== this.config.defaultServer.serverId) {
      throw serverNotFound(input.server_id);
    }

    const canonicalName = normalizeMinecraftName(input.username);
    await this.requireLocalNameAvailable(canonicalName);
    const challengeId = `ch_${randomToken(24)}`;
    const code = `${randomCodePart()}-${randomCodePart()}`;
    const expiresAt = new Date(Date.now() + 180_000);
    const challenge: PendingChallenge = {
      challengeId,
      code,
      serverId: input.server_id,
      requestedName: input.username,
      canonicalName,
      mode: input.mode,
      expiresAt,
      status: "pending",
    };
    this.challenges.set(challengeId, challenge);
    this.challengeIdsByCode.set(code, challengeId);

    return {
      protocol_version: "sail-protocol-v1",
      challenge_id: challengeId,
      status: "pending",
      server_id: challenge.serverId,
      requested_name: challenge.requestedName,
      mode: challenge.mode,
      code,
      auth_url: buildAuthUrl(this.config.authUrl, code),
      expires_at: expiresAt.toISOString(),
    };
  }

  getChallenge(challengeId: string): ChallengeStatusResponse {
    const challenge = this.requireChallenge(challengeId);
    this.expireIfNeeded(challenge);
    return serializeChallenge(challenge);
  }

  getChallengeByCode(code: string): ChallengeStatusResponse {
    const challenge = this.requireChallengeByCode(code);
    this.expireIfNeeded(challenge);
    return serializeChallenge(challenge);
  }

  async completeCodeWithOAuth(
    code: string,
    oauthIdentity: OAuthCompletionInput,
  ): Promise<ChallengeCompletionResponse> {
    const challenge = this.requireChallengeByCode(code);
    return this.completeWithOAuth(challenge.challengeId, oauthIdentity);
  }

  async completeWithOAuth(
    challengeId: string,
    oauthIdentity: OAuthCompletionInput,
  ): Promise<ChallengeCompletionResponse> {
    const challenge = this.requireChallenge(challengeId);
    this.expireIfNeeded(challenge);
    if (challenge.status === "expired") {
      throw createSailError("session_expired", 410, true, "Your Sail login code expired. Join again to get a new code.");
    }
    if (challenge.status === "completed") {
      return serializeCompletedChallenge(challenge);
    }

    const accountId = accountIdForOAuth(oauthIdentity);
    const existingClaim = this.localNameClaims.get(challenge.canonicalName);
    if (existingClaim && existingClaim.accountId !== accountId) {
      throw createSailError(
        "name_already_claimed",
        409,
        false,
        "This name is already registered through Sail.",
        { canonical_name: challenge.canonicalName },
      );
    }

    const localClaim = existingClaim ?? {
      accountId,
      minecraftIdentityId: `mcid_${randomToken(24)}`,
      nameClaimId: `claim_${randomToken(24)}`,
      canonicalName: challenge.canonicalName,
      displayName: challenge.requestedName,
      minecraftUuid: randomUUID(),
      createdAt: new Date(),
    };
    const sessionId = `sess_${randomToken(24)}`;
    const sessionCreatedAt = new Date();
    const sessionExpiresAt = new Date(sessionCreatedAt.getTime() + 60 * 60_000);
    const sessionToken = await this.signer.signSession({
      accountId,
      canonicalName: challenge.canonicalName,
      minecraftIdentityId: localClaim.minecraftIdentityId,
      minecraftUuid: localClaim.minecraftUuid,
      nameClaimId: localClaim.nameClaimId,
      serverId: challenge.serverId,
      sessionId,
    });
    const session: LocalSession = {
      sessionId,
      tokenHash: hashSecret(sessionToken),
      serverId: challenge.serverId,
      accountId,
      minecraftIdentityId: localClaim.minecraftIdentityId,
      nameClaimId: localClaim.nameClaimId,
      canonicalName: challenge.canonicalName,
      minecraftUuid: localClaim.minecraftUuid,
      status: "completed",
      createdAt: sessionCreatedAt,
      completedAt: sessionCreatedAt,
      expiresAt: sessionExpiresAt,
    };
    this.sessions.set(sessionId, session);

    challenge.status = "completed";
    challenge.completedAt = new Date();
    challenge.identity = {
      account_id: accountId,
      minecraft_identity_id: localClaim.minecraftIdentityId,
      name_claim_id: localClaim.nameClaimId,
      canonical_name: challenge.canonicalName,
      display_name: challenge.requestedName,
      minecraft_uuid: localClaim.minecraftUuid,
      claim_type: "LOCAL_SOFT",
      identity_type: "SAIL_LOCAL",
      session_id: sessionId,
      session_token: sessionToken,
    };
    this.localNameClaims.set(challenge.canonicalName, localClaim);

    return serializeCompletedChallenge(challenge);
  }

  async verifySession(input: SessionVerificationInput): Promise<SessionVerificationResponse> {
    if (typeof input.server_id !== "string" || input.server_id !== this.config.defaultServer.serverId) {
      throw serverNotFound(input.server_id);
    }

    let payload: JWTPayload;
    try {
      payload = await this.signer.verifySessionToken(input.session_token);
    } catch {
      throw createSailError("session_invalid", 401, true, "Your Sail session is invalid. Join again to authenticate.");
    }

    if (typeof payload.session_id !== "string" || typeof payload.server_id !== "string") {
      throw createSailError("session_invalid", 401, true, "Your Sail session is invalid. Join again to authenticate.");
    }

    const session = this.sessions.get(payload.session_id);
    if (!session || session.tokenHash !== hashSecret(input.session_token)) {
      throw createSailError("session_invalid", 401, true, "Your Sail session is invalid. Join again to authenticate.");
    }
    if (session.status === "revoked") {
      throw createSailError("session_revoked", 403, true, "Your Sail session was revoked. Join again to authenticate.");
    }
    if (!sessionPayloadMatches(payload, {
      sessionId: session.sessionId,
      serverId: session.serverId,
      canonicalName: session.canonicalName,
      minecraftUuid: session.minecraftUuid,
    })) {
      throw createSailError("session_invalid", 401, true, "Your Sail session is invalid. Join again to authenticate.");
    }

    return {
      protocol_version: "sail-protocol-v1",
      session_id: session.sessionId,
      status: "active",
      canonical_name: session.canonicalName,
      minecraft_uuid: session.minecraftUuid,
      server_id: input.server_id,
      issuer_server_id: session.serverId,
      session_reuse_policy: this.config.defaultServer.sessionReusePolicy,
    };
  }

  async getConsoleProfile(sessionToken: string): Promise<ConsoleProfileResponse> {
    const session = await this.authenticateConsoleSession(sessionToken);
    const claims = [...this.localNameClaims.values()].filter((claim) => claim.accountId === session.accountId);
    const sessions = [...this.sessions.values()].filter((candidate) => candidate.accountId === session.accountId);

    return {
      protocol_version: "sail-protocol-v1",
      account: {
        account_id: session.accountId,
        display_name: null,
        status: "active",
        risk_level: "low",
        linked_providers: [
          {
            provider: "local",
            provider_username: null,
            created_at: (claims[0]?.createdAt ?? session.createdAt).toISOString(),
            last_used_at: null,
          },
        ],
      },
      names: claims.map((claim) => ({
        name_claim_id: claim.nameClaimId,
        minecraft_identity_id: claim.minecraftIdentityId,
        canonical_name: claim.canonicalName,
        display_name: claim.displayName,
        claim_type: "LOCAL_SOFT",
        identity_type: "SAIL_LOCAL",
        minecraft_uuid: claim.minecraftUuid,
        issuer_registry_id: this.config.registryId,
        status: "active",
        created_at: claim.createdAt.toISOString(),
      })),
      sessions: sessions.map((candidate) => ({
        session_id: candidate.sessionId,
        server_id: candidate.serverId,
        server_display_name: this.config.defaultServer.displayName,
        status: candidate.status,
        current: candidate.sessionId === session.sessionId,
        created_at: candidate.createdAt.toISOString(),
        completed_at: candidate.completedAt.toISOString(),
        expires_at: candidate.expiresAt.toISOString(),
        revoked_at: candidate.revokedAt?.toISOString() ?? null,
      })),
      trusted_servers: [this.getServer(this.config.defaultServer.serverId)],
    };
  }

  async revokeConsoleSession(sessionToken: string, sessionId: string): Promise<SessionRevocationResponse> {
    const authenticated = await this.authenticateConsoleSession(sessionToken);
    const target = this.sessions.get(sessionId);
    if (!target || target.accountId !== authenticated.accountId) {
      throw sessionNotFound();
    }

    const revokedAt = new Date();
    target.status = "revoked";
    target.revokedAt = revokedAt;
    return {
      protocol_version: "sail-protocol-v1",
      session_id: target.sessionId,
      status: "revoked",
      revoked_at: revokedAt.toISOString(),
    };
  }

  revokeSession(sessionId: string): SessionRevocationResponse {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw createSailError("session_not_found", 404, false, "Sail session was not found.");
    }
    const revokedAt = new Date();
    session.status = "revoked";
    session.revokedAt = revokedAt;
    return {
      protocol_version: "sail-protocol-v1",
      session_id: session.sessionId,
      status: "revoked",
      revoked_at: revokedAt.toISOString(),
    };
  }

  private requireChallenge(challengeId: string): PendingChallenge {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) {
      throw createSailError("challenge_not_found", 404, false, "Sail login code was not found.");
    }
    return challenge;
  }

  private requireChallengeByCode(code: string): PendingChallenge {
    const challengeId = this.challengeIdsByCode.get(code);
    if (!challengeId) {
      throw createSailError("challenge_not_found", 404, false, "Sail login code was not found.");
    }
    return this.requireChallenge(challengeId);
  }

  private expireIfNeeded(challenge: PendingChallenge): void {
    if (challenge.status === "pending" && challenge.expiresAt.getTime() <= Date.now()) {
      challenge.status = "expired";
    }
  }

  private async authenticateConsoleSession(sessionToken: string): Promise<LocalSession> {
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

    const session = this.sessions.get(payload.session_id);
    if (!session || session.tokenHash !== hashSecret(sessionToken)) {
      throw sessionInvalid();
    }
    if (session.status === "revoked") {
      throw createSailError("session_revoked", 403, true, "Your Sail session was revoked. Join again to authenticate.");
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw sessionExpired();
    }
    if (
      !sessionPayloadMatches(payload, {
        sessionId: session.sessionId,
        serverId: session.serverId,
        canonicalName: session.canonicalName,
        minecraftUuid: session.minecraftUuid,
      })
      || payload.sub !== session.accountId
      || payload.account_id !== session.accountId
      || payload.minecraft_identity_id !== session.minecraftIdentityId
      || payload.name_claim_id !== session.nameClaimId
    ) {
      throw sessionInvalid();
    }

    return session;
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
      const session = this.sessions.get(payload.session_id);
      if (!session || session.tokenHash !== hashSecret(token)) {
        return null;
      }
      if (session.status === "revoked" || session.expiresAt.getTime() <= Date.now()) {
        return null;
      }
      return { account_id: payload.account_id, session_id: payload.session_id };
    } catch {
      return null;
    }
  }

  getDatabase(): RegistryDatabase | null {
    return null;
  }

  recordHeartbeat(serverId: string): void {
    if (serverId !== this.config.defaultServer.serverId) {
      throw serverNotFound(serverId);
    }
    // In-memory service has no persistent state to update.
  }

  async lookupName(canonicalName: string): Promise<NameLookupResponse> {
    const claim = this.localNameClaims.get(canonicalName);
    if (claim) {
      return {
        protocol_version: "sail-protocol-v1",
        canonical_name: canonicalName,
        display_name: claim.displayName,
        status: "claimed",
        claim_type: "LOCAL_SOFT",
        identity_type: "SAIL_LOCAL",
        issuer_registry_id: this.config.registryId,
        minecraft_uuid: claim.minecraftUuid,
        premium_name: false,
        priority: 10,
        expires_at: null,
      };
    }

    let premium = false;
    if (this.config.blockPremiumNamesForLocal) {
      try {
        const status = await this.premiumNames.lookup(canonicalName);
        premium = status.premium;
      } catch {
        // Fail open for lookup — premium check is best-effort.
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

  async deregisterServer(sessionToken: string, serverId: string): Promise<ServerDeregistrationResponse> {
    throw createSailError("unavailable", 503, true, "Server deregistration requires PostgreSQL backend.");
  }
}

function serializeChallenge(challenge: PendingChallenge): ChallengeStatusResponse {
  return {
    protocol_version: "sail-protocol-v1",
    challenge_id: challenge.challengeId,
    status: challenge.status,
    mode: challenge.mode,
    expires_at: challenge.expiresAt.toISOString(),
    ...(challenge.completedAt ? { completed_at: challenge.completedAt.toISOString() } : {}),
    ...(challenge.identity ? { identity: challenge.identity } : {}),
  };
}

function serializeCompletedChallenge(challenge: PendingChallenge): ChallengeCompletionResponse {
  if (challenge.status !== "completed" || !challenge.completedAt || !challenge.identity?.session_token) {
    throw new Error("Completed Sail challenge is missing session token");
  }
  return {
    protocol_version: "sail-protocol-v1",
    challenge_id: challenge.challengeId,
    status: "completed",
    expires_at: challenge.expiresAt.toISOString(),
    completed_at: challenge.completedAt.toISOString(),
    identity: {
      ...challenge.identity,
      session_token: challenge.identity.session_token,
    },
  };
}

function accountIdForOAuth(input: OAuthCompletionInput): string {
  const digest = hashSecret(`${input.provider}:${input.provider_subject}`).slice(0, 24);
  return `acct_${digest}`;
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

function sessionNotFound(): Error {
  return createSailError("session_not_found", 404, false, "Sail session was not found.");
}

function isJwtExpired(error: unknown): boolean {
  return error instanceof JWTExpired || (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ERR_JWT_EXPIRED"
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
