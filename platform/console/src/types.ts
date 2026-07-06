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

export interface ConsoleLinkedProvider {
  provider: string;
  provider_username: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface ConsoleProfileResponse {
  protocol_version: "sail-protocol-v1";
  account: {
    account_id: string;
    display_name: string | null;
    status: "active" | "suspended" | "recovery_locked" | "deleted";
    risk_level: "low" | "medium" | "high";
    linked_providers: ConsoleLinkedProvider[];
  };
  names: Array<{
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
  }>;
  sessions: Array<{
    session_id: string;
    server_id: string;
    server_display_name: string;
    status: "pending" | "completed" | "expired" | "revoked" | "denied";
    current: boolean;
    created_at: string;
    completed_at: string | null;
    expires_at: string;
    revoked_at: string | null;
  }>;
  trusted_servers: Array<{
    protocol_version: "sail-protocol-v1";
    registry_id: string;
    server_id: string;
    display_name: string;
    registry_mode: "global" | "self_hosted" | "hybrid";
    allowed_claim_types: Array<
      "MINECRAFT_VERIFIED" | "SAIL_GLOBAL" | "FEDERATED_TRUSTED" | "LOCAL_SOFT" | "SOCIAL_ONLY"
    >;
    session_reuse_policy: "off" | "same_registry" | "allowlisted_servers" | "global_trusted";
    privacy_mode: "minimal" | "standard" | "audit_full";
    status: "active" | "disabled" | "suspended";
    public_listing: boolean;
    last_heartbeat_at: string | null;
  }>;
}

export interface ConsoleAuthChallengeInput {
  username: string;
  server_id?: string;
}

export interface ConsoleAuthChallengeResponse {
  protocol_version: "sail-protocol-v1";
  challenge_id: string;
  status: "pending";
  server_id: string;
  requested_name: string;
  mode: "kick" | "limbo" | "hybrid";
  code: string;
  auth_url: string;
  expires_at: string;
}

export interface SessionRevocationResponse {
  protocol_version: "sail-protocol-v1";
  session_id: string;
  status: "revoked";
  revoked_at: string;
}

export interface RegisterServerInput {
  server_id: string;
  display_name: string;
}

export interface RegisterServerResponse {
  protocol_version: "sail-protocol-v1";
  server_id: string;
  display_name: string;
  api_key: string;
  claim_code: string;
}

export interface ClaimCodeResponse {
  protocol_version: "sail-protocol-v1";
  api_key: string;
  server_id: string;
}

export interface NameLookupResponse {
  protocol_version: "sail-protocol-v1";
  canonical_name: string;
  display_name: string | null;
  status: "claimed" | "unclaimed" | "premium_reserved";
  claim_type: "MINECRAFT_VERIFIED" | "SAIL_GLOBAL" | "FEDERATED_TRUSTED" | "LOCAL_SOFT" | "SOCIAL_ONLY" | null;
  identity_type: "MOJANG_PREMIUM" | "SAIL_LOCAL" | "FEDERATED" | null;
  issuer_registry_id: string | null;
  minecraft_uuid: string | null;
  premium_name: boolean;
  priority: number | null;
  expires_at: string | null;
}

export interface ServerDeregistrationResponse {
  protocol_version: "sail-protocol-v1";
  server_id: string;
  status: "disabled";
}

export interface AuditEvent {
  id: string;
  event_type: string;
  severity: "info" | "warning" | "high" | "critical";
  metadata_json: Record<string, unknown>;
  created_at: string;
}

export interface SigningKey {
  kid: string;
  status: "active" | "retiring" | "retired" | "revoked";
  source: string;
  fingerprint: string | null;
  created_at: string;
  activated_at: string;
  retired_at: string | null;
  revoked_at: string | null;
}

export interface SigningKeyRevokeResponse {
  kid: string;
  status: "revoked";
}
