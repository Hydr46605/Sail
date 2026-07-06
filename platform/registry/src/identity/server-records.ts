import { randomUUID } from "node:crypto";
import { sql, type Selectable } from "kysely";
import type { SailRegistryConfig } from "../config.js";
import type { RegistryDatabase, ServersTable } from "../db/schema.js";
import { generateApiKeyJwt } from "./api-keys.js";
import { createApiKeyClaim } from "./api-key-claims.js";

export type ServerRecordRow = Selectable<ServersTable>;

export interface SerializedServerRecord {
  protocol_version: "sail-protocol-v1";
  registry_id: string;
  server_id: string;
  display_name: string;
  registry_mode: ServerRecordRow["registry_mode"];
  allowed_claim_types: ServerRecordRow["allowed_claim_types"];
  session_reuse_policy: ServerRecordRow["session_reuse_policy"];
  privacy_mode: ServerRecordRow["privacy_mode"];
  status: ServerRecordRow["status"];
  public_listing: boolean;
  last_heartbeat_at: string | null;
}

export async function bootstrapDefaultServer(
  config: Pick<SailRegistryConfig, "registryId" | "defaultServer">,
  db: RegistryDatabase,
): Promise<ServerRecordRow> {
  const server = config.defaultServer;

  return await db
    .insertInto("servers")
    .values({
      id: randomUUID(),
      registry_id: config.registryId,
      server_id: server.serverId,
      display_name: server.displayName,
      owner_account_id: null,
      registry_mode: server.registryMode,
      allowed_claim_types: [...server.allowedClaimTypes],
      session_reuse_policy: server.sessionReusePolicy,
      privacy_mode: server.privacyMode,
      status: "active",
      public_listing: server.publicListing,
    })
    .onConflict((oc) =>
      oc.columns(["registry_id", "server_id"]).doUpdateSet({
        display_name: server.displayName,
        registry_mode: server.registryMode,
        allowed_claim_types: [...server.allowedClaimTypes],
        session_reuse_policy: server.sessionReusePolicy,
        privacy_mode: server.privacyMode,
        public_listing: server.publicListing,
        updated_at: sql`now()`,
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function getActiveServerById(
  db: RegistryDatabase,
  registryId: string,
  serverId: string,
): Promise<ServerRecordRow | undefined> {
  return await db
    .selectFrom("servers")
    .selectAll()
    .where("registry_id", "=", registryId)
    .where("server_id", "=", serverId)
    .where("status", "=", "active")
    .executeTakeFirst();
}

export function serializeServerRecord(row: ServerRecordRow): SerializedServerRecord {
  return {
    protocol_version: "sail-protocol-v1",
    registry_id: row.registry_id,
    server_id: row.server_id,
    display_name: row.display_name,
    registry_mode: row.registry_mode,
    allowed_claim_types: [...row.allowed_claim_types],
    session_reuse_policy: row.session_reuse_policy,
    privacy_mode: row.privacy_mode,
    status: row.status,
    public_listing: row.public_listing,
    last_heartbeat_at: row.last_heartbeat_at?.toISOString() ?? null,
  };
}

export interface RegisterServerResult {
  server: ServerRecordRow;
  apiKey: string;
  claimCode: string;
}

export async function registerServer(
  db: RegistryDatabase,
  config: Pick<SailRegistryConfig, "registryId" | "privateKey" | "signingKeyFingerprint">,
  ownerAccountId: string,
  serverId: string,
  displayName: string,
): Promise<RegisterServerResult> {
  const existing = await db
    .selectFrom("servers")
    .select("server_id")
    .where("owner_account_id", "=", ownerAccountId)
    .executeTakeFirst();
  if (existing) {
    throw new Error("Account already owns a server");
  }

  const conflict = await db
    .selectFrom("servers")
    .select("server_id")
    .where("registry_id", "=", config.registryId)
    .where("server_id", "=", serverId)
    .executeTakeFirst();
  if (conflict) {
    throw new Error("Server ID already taken");
  }

  const server = await db
    .insertInto("servers")
    .values({
      id: randomUUID(),
      registry_id: config.registryId,
      server_id: serverId,
      display_name: displayName,
      owner_account_id: ownerAccountId,
      registry_mode: "self_hosted",
      allowed_claim_types: ["LOCAL_SOFT"],
      session_reuse_policy: "off",
      privacy_mode: "minimal",
      status: "active",
      public_listing: false,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const { apiKey, apiKeyJwkId, issuedAt } = await generateApiKeyJwt(config, serverId, ownerAccountId);

  await db
    .updateTable("servers")
    .set({ api_key_jwk_id: apiKeyJwkId, api_key_issued_at: issuedAt, updated_at: sql`now()` })
    .where("id", "=", server.id)
    .execute();

  const { claimCode } = await createApiKeyClaim(db, serverId, ownerAccountId, apiKey);

  return { server, apiKey, claimCode };
}

export async function getServerByOwner(
  db: RegistryDatabase,
  registryId: string,
  accountId: string,
): Promise<ServerRecordRow | undefined> {
  return await db
    .selectFrom("servers")
    .selectAll()
    .where("registry_id", "=", registryId)
    .where("owner_account_id", "=", accountId)
    .executeTakeFirst();
}

export async function recordServerHeartbeat(
  db: RegistryDatabase,
  registryId: string,
  serverId: string,
): Promise<boolean> {
  const result = await db
    .updateTable("servers")
    .set({ last_heartbeat_at: sql`now()` })
    .where("registry_id", "=", registryId)
    .where("server_id", "=", serverId)
    .where("status", "=", "active")
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}
