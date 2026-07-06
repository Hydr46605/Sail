import type {
  SailJwk,
  ServerPrivacyMode,
  ServerRegistryMode,
  ServerSessionReusePolicy,
} from "../config.js";
import type { PremiumNameLookup } from "../premium-names.js";
import type { RegistryDatabase } from "../db/schema.js";

export type ChallengeMode = "kick" | "limbo" | "hybrid";
export type ChallengeStatus = "pending" | "completed" | "expired" | "revoked" | "denied";

export interface CreateChallengeInput {
  server_id: string;
  username: string;
  connection_id: string;
  mode: ChallengeMode;
}

export interface OAuthCompletionInput {
  provider: string;
  provider_subject: string;
  provider_username?: string;
}

export interface ChallengeCreatedResponse {
  protocol_version: "sail-protocol-v1";
  challenge_id: string;
  status: "pending";
  server_id: string;
  requested_name: string;
  mode: ChallengeMode;
  code: string;
  auth_url: string;
  expires_at: string;
}

export interface CompletedIdentity {
  account_id: string;
  minecraft_identity_id: string;
  name_claim_id: string;
  canonical_name: string;
  display_name: string;
  minecraft_uuid: string;
  claim_type: "LOCAL_SOFT";
  identity_type: "SAIL_LOCAL";
  session_id: string;
  session_token?: string;
}

export interface CompletedIdentityWithSessionToken extends CompletedIdentity {
  session_token: string;
}

export interface ChallengeStatusResponse {
  protocol_version: "sail-protocol-v1";
  challenge_id: string;
  status: ChallengeStatus;
  mode: ChallengeMode;
  expires_at: string;
  completed_at?: string;
  identity?: CompletedIdentity;
}

export interface ChallengeCompletionResponse {
  protocol_version: "sail-protocol-v1";
  challenge_id: string;
  status: "completed";
  expires_at: string;
  completed_at: string;
  identity: CompletedIdentityWithSessionToken;
}

export interface SessionVerificationInput {
  server_id: string;
  session_token: string;
}

export interface SessionVerificationResponse {
  protocol_version: "sail-protocol-v1";
  session_id: string;
  status: "active";
  canonical_name: string;
  minecraft_uuid: string;
  server_id: string;
  issuer_server_id: string;
  session_reuse_policy: ServerSessionReusePolicy;
}

export interface SessionRevocationResponse {
  protocol_version: "sail-protocol-v1";
  session_id: string;
  status: "revoked";
  revoked_at: string;
}

export type ServerRecordAllowedClaimType =
  | "MINECRAFT_VERIFIED"
  | "SAIL_GLOBAL"
  | "FEDERATED_TRUSTED"
  | "LOCAL_SOFT"
  | "SOCIAL_ONLY";

export interface ServerRecordResponse {
  protocol_version: "sail-protocol-v1";
  registry_id: string;
  server_id: string;
  display_name: string;
  registry_mode: ServerRegistryMode;
  allowed_claim_types: ServerRecordAllowedClaimType[];
  session_reuse_policy: ServerSessionReusePolicy;
  privacy_mode: ServerPrivacyMode;
  status: "active" | "disabled" | "suspended";
  public_listing: boolean;
  last_heartbeat_at: string | null;
}

export interface ConsoleLinkedProvider {
  provider: string;
  provider_username: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface ConsoleAccountSummary {
  account_id: string;
  display_name: string | null;
  status: "active" | "suspended" | "recovery_locked" | "deleted";
  risk_level: "low" | "medium" | "high";
  linked_providers: ConsoleLinkedProvider[];
}

export interface ConsoleNameClaimSummary {
  name_claim_id: string;
  minecraft_identity_id: string;
  canonical_name: string;
  display_name: string;
  claim_type: "MINECRAFT_VERIFIED" | "SAIL_GLOBAL" | "FEDERATED_TRUSTED" | "LOCAL_SOFT" | "SOCIAL_ONLY";
  identity_type: "MOJANG_PREMIUM" | "SAIL_LOCAL" | "FEDERATED";
  minecraft_uuid: string;
  issuer_registry_id: string;
  status: "active" | "displaced_by_minecraft" | "renamed" | "suspended" | "expired";
  created_at: string;
}

export interface ConsoleSessionSummary {
  session_id: string;
  server_id: string;
  server_display_name: string;
  status: "pending" | "completed" | "expired" | "revoked" | "denied";
  current: boolean;
  created_at: string;
  completed_at: string | null;
  expires_at: string;
  revoked_at: string | null;
}

export interface ConsoleProfileResponse {
  protocol_version: "sail-protocol-v1";
  account: ConsoleAccountSummary;
  names: ConsoleNameClaimSummary[];
  sessions: ConsoleSessionSummary[];
  trusted_servers: ServerRecordResponse[];
}

export interface SailErrorResponse {
  protocol_version: "sail-protocol-v1";
  error: {
    code: string;
    message: string;
    audience: "player" | "admin" | "operator" | "developer";
    http_status: number;
    retryable: boolean;
    correlation_id: string;
    details?: Record<string, unknown>;
  };
}

export class SailChallengeError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: SailErrorResponse,
  ) {
    super(body.error.code);
  }
}

export interface ChallengeServiceDependencies {
  premiumNames?: PremiumNameLookup;
}

export interface ChallengeService {
  getPublicKeys(): SailJwk[] | Promise<SailJwk[]>;
  getServer(serverId: string): ServerRecordResponse | Promise<ServerRecordResponse>;
  createChallenge(input: CreateChallengeInput): Promise<ChallengeCreatedResponse>;
  getChallenge(challengeId: string): ChallengeStatusResponse | Promise<ChallengeStatusResponse>;
  getChallengeByCode(code: string): ChallengeStatusResponse | Promise<ChallengeStatusResponse>;
  completeCodeWithOAuth(code: string, oauthIdentity: OAuthCompletionInput): Promise<ChallengeCompletionResponse>;
  completeWithOAuth(challengeId: string, oauthIdentity: OAuthCompletionInput): Promise<ChallengeCompletionResponse>;
  getConsoleProfile(sessionToken: string): Promise<ConsoleProfileResponse>;
  revokeConsoleSession(sessionToken: string, sessionId: string): Promise<SessionRevocationResponse>;
  verifySession(input: SessionVerificationInput): Promise<SessionVerificationResponse>;
  revokeSession(sessionId: string): SessionRevocationResponse | Promise<SessionRevocationResponse>;
  getSessionByToken(token: string): Promise<{ account_id: string | null; session_id: string } | null>;
  getDatabase(): RegistryDatabase | null;
  recordHeartbeat(serverId: string): Promise<void> | void;
}
