import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { SignJWT, jwtVerify, type JWK, type JWTPayload } from "jose";
import type { SailJwk, SailPrivateJwk, SailRegistryConfig } from "../config.js";

export interface SessionClaimsInput {
  accountId: string;
  canonicalName: string;
  minecraftIdentityId: string;
  minecraftUuid: string;
  nameClaimId: string;
  serverId: string;
  sessionId: string;
}

export class SessionSigner {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly publicJwk: SailJwk;

  constructor(
    private readonly kid: string,
    private readonly issuer: string,
    keyPair?: { privateKey: KeyObject; publicKey: KeyObject; publicJwk: SailJwk },
  ) {
    if (keyPair) {
      this.privateKey = keyPair.privateKey;
      this.publicKey = keyPair.publicKey;
      this.publicJwk = keyPair.publicJwk;
      return;
    }

    const generatedKeyPair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = generatedKeyPair.privateKey;
    this.publicKey = generatedKeyPair.publicKey;
    this.publicJwk = exportPublicJwk(kid, this.publicKey);
  }

  static fromConfiguredKey(config: Pick<SailRegistryConfig, "privateKey" | "registryId">): SessionSigner {
    return SessionSigner.fromPrivateJwk(config.registryId, config.privateKey);
  }

  static fromPrivateJwk(registryId: string, privateJwk: SailPrivateJwk): SessionSigner {
    const privateKey = createPrivateKey({ format: "jwk", key: privateJwk as unknown as JsonWebKey });
    const publicKey = createPublicKey(privateKey);
    return new SessionSigner(privateJwk.kid, registryId, {
      privateKey,
      publicKey,
      publicJwk: exportPublicJwk(privateJwk.kid, publicKey),
    });
  }

  getPublicJwk(): SailJwk {
    return this.publicJwk;
  }

  async signSession(claims: SessionClaimsInput): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      protocol_version: "sail-protocol-v1",
      session_id: claims.sessionId,
      account_id: claims.accountId,
      minecraft_identity_id: claims.minecraftIdentityId,
      name_claim_id: claims.nameClaimId,
      canonical_name: claims.canonicalName,
      minecraft_uuid: claims.minecraftUuid,
      claim_type: "LOCAL_SOFT",
      identity_type: "SAIL_LOCAL",
      scope: "minecraft_login",
      server_id: claims.serverId,
      risk_level: "low",
    })
      .setProtectedHeader({ alg: "ES256", kid: this.kid, typ: "JWT" })
      .setIssuer(this.issuer)
      .setSubject(claims.accountId)
      .setIssuedAt(now)
      .setExpirationTime(now + 60 * 60)
      .sign(this.privateKey);
  }

  async verifySessionToken(token: string): Promise<JWTPayload> {
    return (await jwtVerify(token, this.publicKey, { issuer: this.issuer })).payload;
  }
}

function exportPublicJwk(kid: string, publicKey: KeyObject): SailJwk {
  const exported = publicKey.export({ format: "jwk" }) as JWK;
  if (typeof exported.x !== "string" || typeof exported.y !== "string" || exported.crv !== "P-256") {
    throw new Error("ES256 public key is missing P-256 coordinates");
  }
  return {
    kty: "EC",
    kid,
    use: "sig",
    alg: "ES256",
    crv: "P-256",
    x: exported.x,
    y: exported.y,
  };
}
