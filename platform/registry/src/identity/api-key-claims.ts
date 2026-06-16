import { randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { RegistryDatabase } from "../db/schema.js";

export interface ApiKeyClaimRow {
  id: string;
  server_id: string;
  account_id: string;
  claim_code_hash: string;
  api_key_jwt: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

const CLAIM_CODE_BYTES = 16;
const CLAIM_CODE_TTL_HOURS = 24;

function hashClaimCode(code: string): string {
  return require("node:crypto").createHash("sha256").update(code).digest("hex");
}

function generateClaimCode(): string {
  return randomBytes(CLAIM_CODE_BYTES).toString("hex");
}

export async function createApiKeyClaim(
  db: RegistryDatabase,
  serverId: string,
  accountId: string,
  apiKeyJwt: string,
): Promise<{ claimCode: string; claimCodeHash: string; expiresAt: Date }> {
  const claimCode = generateClaimCode();
  const claimCodeHash = hashClaimCode(claimCode);
  const expiresAt = new Date(Date.now() + CLAIM_CODE_TTL_HOURS * 60 * 60 * 1000);

  await db
    .insertInto("server_api_key_claims")
    .values({
      id: randomUUID(),
      server_id: serverId,
      account_id: accountId,
      claim_code_hash: claimCodeHash,
      api_key_jwt: apiKeyJwt,
      expires_at: expiresAt,
    })
    .execute();

  return { claimCode, claimCodeHash, expiresAt };
}

export async function consumeApiKeyClaim(
  db: RegistryDatabase,
  claimCode: string,
): Promise<{ apiKeyJwt: string; serverId: string; accountId: string } | null> {
  const claimCodeHash = hashClaimCode(claimCode);

  const claim = await db
    .selectFrom("server_api_key_claims")
    .selectAll()
    .where("claim_code_hash", "=", claimCodeHash)
    .where("used_at", "is", null)
    .where("expires_at", ">", new Date())
    .executeTakeFirst();

  if (!claim) return null;

  await db
    .updateTable("server_api_key_claims")
    .set({ used_at: new Date() })
    .where("id", "=", claim.id)
    .execute();

  return { apiKeyJwt: claim.api_key_jwt, serverId: claim.server_id, accountId: claim.account_id };
}

export async function getApiKeyClaimByServer(
  db: RegistryDatabase,
  serverId: string,
  accountId: string,
): Promise<ApiKeyClaimRow | undefined> {
  return await db
    .selectFrom("server_api_key_claims")
    .selectAll()
    .where("server_id", "=", serverId)
    .where("account_id", "=", accountId)
    .where("used_at", "is", null)
    .where("expires_at", ">", new Date())
    .orderBy("created_at", "desc")
    .executeTakeFirst();
}