import type { ColumnType, Kysely } from "kysely";

export type DefaultedColumn<T> = ColumnType<T, T | undefined, T>;
export type TimestampColumn = ColumnType<Date, Date | string, Date | string>;
export type GeneratedTimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;
export type NullableTimestampColumn = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
export type NullableTextColumn = ColumnType<string | null, string | null | undefined, string | null>;
export type RequiredJsonColumn = ColumnType<
  Record<string, unknown>,
  Record<string, unknown> | string,
  Record<string, unknown> | string
>;
export type DefaultedJsonColumn = ColumnType<
  Record<string, unknown>,
  Record<string, unknown> | string | undefined,
  Record<string, unknown> | string
>;
export type DefaultedTextArrayColumn = ColumnType<string[], string[] | undefined, string[]>;
export type RequiredTextArrayColumn<T extends string = string> = ColumnType<T[], T[], T[]>;

export type SailClaimType =
  | "MINECRAFT_VERIFIED"
  | "SAIL_GLOBAL"
  | "FEDERATED_TRUSTED"
  | "LOCAL_SOFT"
  | "SOCIAL_ONLY";

export interface RegistriesTable {
  id: string;
  registry_id: string;
  display_name: string;
  api_url: string;
  jwks_url: string;
  trust_status: DefaultedColumn<"global" | "self_hosted" | "trusted_by_admin" | "unverified">;
  created_at: GeneratedTimestampColumn;
  updated_at: GeneratedTimestampColumn;
}

export interface ServersTable {
  id: string;
  registry_id: string;
  server_id: string;
  display_name: string;
  owner_account_id: string | null;
  registry_mode: "global" | "self_hosted" | "hybrid";
  allowed_claim_types: RequiredTextArrayColumn<SailClaimType>;
  session_reuse_policy: "off" | "same_registry" | "allowlisted_servers" | "global_trusted";
  privacy_mode: "minimal" | "standard" | "audit_full";
  status: DefaultedColumn<"active" | "disabled" | "suspended">;
  public_listing: DefaultedColumn<boolean>;
  last_successful_verification_at: NullableTimestampColumn;
  last_heartbeat_at: NullableTimestampColumn;
  api_key_jwk_id: NullableTextColumn;
  api_key_issued_at: NullableTimestampColumn;
  created_at: GeneratedTimestampColumn;
  updated_at: GeneratedTimestampColumn;
}

export interface AccountsTable {
  id: string;
  primary_display_name: string | null;
  status: DefaultedColumn<"active" | "suspended" | "recovery_locked" | "deleted">;
  risk_level: DefaultedColumn<"low" | "medium" | "high">;
  created_at: GeneratedTimestampColumn;
  updated_at: GeneratedTimestampColumn;
  last_seen_at: NullableTimestampColumn;
}

export interface OAuthIdentitiesTable {
  id: string;
  account_id: string;
  provider: string;
  provider_subject: string;
  provider_username: string | null;
  verified_email_hash: string | null;
  created_at: GeneratedTimestampColumn;
  last_used_at: NullableTimestampColumn;
}

export interface MinecraftIdentitiesTable {
  id: string;
  account_id: string;
  identity_type: "MOJANG_PREMIUM" | "SAIL_LOCAL" | "FEDERATED";
  minecraft_uuid: string;
  mojang_uuid: string | null;
  issuer_registry_id: string;
  created_at: GeneratedTimestampColumn;
  updated_at: GeneratedTimestampColumn;
}

export interface NameClaimsTable {
  id: string;
  canonical_name: string;
  display_name: string;
  account_id: string;
  minecraft_identity_id: string;
  claim_type: "MINECRAFT_VERIFIED" | "SAIL_GLOBAL" | "FEDERATED_TRUSTED" | "LOCAL_SOFT" | "SOCIAL_ONLY";
  issuer_registry_id: string;
  status: DefaultedColumn<"active" | "displaced_by_minecraft" | "renamed" | "suspended" | "expired">;
  priority: number;
  created_at: GeneratedTimestampColumn;
  updated_at: GeneratedTimestampColumn;
  expires_at: NullableTimestampColumn;
  displaced_by_claim_id: string | null;
}

export interface SessionsTable {
  id: string;
  server_id: string;
  account_id: string | null;
  minecraft_identity_id: string | null;
  name_claim_id: string | null;
  session_token_hash: string | null;
  challenge_code_hash: string | null;
  client_ip_hash: string | null;
  risk_snapshot: DefaultedJsonColumn;
  status: DefaultedColumn<"pending" | "completed" | "expired" | "revoked" | "denied">;
  created_at: GeneratedTimestampColumn;
  expires_at: TimestampColumn;
  completed_at: NullableTimestampColumn;
  revoked_at: NullableTimestampColumn;
}

export interface AuthChallengesTable {
  id: string;
  server_id: string;
  requested_name: string;
  canonical_name: string;
  connection_id_hash: string;
  challenge_code_hash: string;
  mode: "kick" | "limbo" | "hybrid";
  status: DefaultedColumn<"pending" | "completed" | "expired" | "revoked" | "denied">;
  account_id: string | null;
  minecraft_identity_id: string | null;
  name_claim_id: string | null;
  session_id: string | null;
  created_at: GeneratedTimestampColumn;
  expires_at: TimestampColumn;
  completed_at: NullableTimestampColumn;
  revoked_at: NullableTimestampColumn;
}

export interface RegistrySigningKeysTable {
  id: string;
  registry_id: string;
  kid: string;
  alg: DefaultedColumn<"ES256">;
  public_jwk: RequiredJsonColumn;
  private_jwk: RequiredJsonColumn;
  status: DefaultedColumn<"active" | "retiring" | "retired" | "revoked">;
  source: DefaultedColumn<"dev" | "env" | "file" | "database">;
  fingerprint: NullableTextColumn;
  created_at: GeneratedTimestampColumn;
  activated_at: GeneratedTimestampColumn;
  not_before: GeneratedTimestampColumn;
  not_after: NullableTimestampColumn;
  retired_at: NullableTimestampColumn;
  revoked_at: NullableTimestampColumn;
}

export interface TrustedIssuersTable {
  id: string;
  registry_id: string;
  issuer_registry_id: string;
  api_url: string;
  public_key_set: RequiredJsonColumn;
  trust_scope: DefaultedTextArrayColumn;
  status: DefaultedColumn<"active" | "disabled" | "revoked">;
  created_at: GeneratedTimestampColumn;
  updated_at: GeneratedTimestampColumn;
}

export interface AuditEventsTable {
  id: string;
  actor_account_id: string | null;
  target_account_id: string | null;
  event_type: string;
  severity: DefaultedColumn<"info" | "warning" | "high" | "critical">;
  metadata_json: DefaultedJsonColumn;
  created_at: GeneratedTimestampColumn;
}

export interface ServerApiKeyClaimsTable {
  id: string;
  server_id: string;
  account_id: string;
  claim_code_hash: string;
  api_key_jwt: string;
  expires_at: TimestampColumn;
  used_at: NullableTimestampColumn;
  created_at: GeneratedTimestampColumn;
}

export interface RegistryDatabaseSchema {
  registries: RegistriesTable;
  servers: ServersTable;
  accounts: AccountsTable;
  oauth_identities: OAuthIdentitiesTable;
  minecraft_identities: MinecraftIdentitiesTable;
  name_claims: NameClaimsTable;
  sessions: SessionsTable;
  auth_challenges: AuthChallengesTable;
  registry_signing_keys: RegistrySigningKeysTable;
  trusted_issuers: TrustedIssuersTable;
  audit_events: AuditEventsTable;
  server_api_key_claims: ServerApiKeyClaimsTable;
}

export type RegistryDatabase = Kysely<RegistryDatabaseSchema>;
