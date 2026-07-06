import { SignJWT, importJWK, jwtVerify, type JWK } from "jose";
import { fingerprintPublicJwk, publicJwkFromPrivateJwk } from "./signing-key-material.js";
import type { SailRegistryConfig, SailPrivateJwk } from "../config.js";

export interface ApiKeyJwtPayload {
  sub: string;
  account_id: string;
  iss: string;
  aud: "sail-gateway";
  scope: "api_key";
  iat: number;
  exp: number;
  kid: string;
}

export interface ServerApiKeyResult {
  apiKey: string;
  apiKeyJwkId: string;
  issuedAt: Date;
  expiresAt: Date;
}

const API_KEY_EXPIRY_SECONDS = 90 * 24 * 60 * 60;
const AUDIENCE = "sail-gateway";
const SCOPE = "api_key";

export async function generateApiKeyJwt(
  config: Pick<SailRegistryConfig, "registryId" | "privateKey">,
  serverId: string,
  accountId: string,
): Promise<ServerApiKeyResult> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + API_KEY_EXPIRY_SECONDS;
  const privateJwk = config.privateKey as SailPrivateJwk;
  const key = await importJWK(privateJwk, "ES256");
  const keyKid = privateJwk.kid;

  const jwt = await new SignJWT({
    sub: serverId,
    account_id: accountId,
    iss: config.registryId,
    aud: AUDIENCE,
    scope: SCOPE,
  })
    .setProtectedHeader({ alg: "ES256", kid: keyKid })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);

  return {
    apiKey: jwt,
    apiKeyJwkId: keyKid,
    issuedAt: new Date(now * 1000),
    expiresAt: new Date(exp * 1000),
  };
}

export async function verifyApiKeyJwt(
  config: Pick<SailRegistryConfig, "publicKeys" | "registryId">,
  apiKey: string,
): Promise<ApiKeyJwtPayload | null> {
  try {
    const { payload } = await jwtVerify(
      apiKey,
      async (protectedHeader) => {
        const kid = protectedHeader.kid;
        if (!kid) throw new Error("Missing kid");
        const key = config.publicKeys.find((k) => k.kid === kid);
        if (!key) throw new Error(`Key not found: ${kid}`);
        return importJWK(key, "ES256");
      },
      { issuer: config.registryId, audience: AUDIENCE }
    );

    if (payload.scope !== SCOPE) return null;
    return payload as unknown as ApiKeyJwtPayload;
  } catch {
    return null;
  }
}