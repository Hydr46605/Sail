import {
  createECDH,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import type { JWK } from "jose";
import type { SailJwk, SailPrivateJwk } from "../config.js";

export function requireSailPrivateJwk(value: unknown, errorPrefix = "Sail signing key"): SailPrivateJwk {
  if (!isRecord(value)) {
    throw new Error(`${errorPrefix} must be a private ES256 JWK object`);
  }

  const privateJwk = value as Partial<Record<keyof SailPrivateJwk, unknown>>;
  const requiredFields: Array<keyof SailPrivateJwk> = ["kty", "kid", "use", "alg", "crv", "x", "y", "d"];
  for (const field of requiredFields) {
    if (typeof privateJwk[field] !== "string" || privateJwk[field].length === 0) {
      throw new Error(`${errorPrefix} is missing ${field}`);
    }
  }

  if (
    privateJwk.kty !== "EC" ||
    privateJwk.use !== "sig" ||
    privateJwk.alg !== "ES256" ||
    privateJwk.crv !== "P-256"
  ) {
    throw new Error(`${errorPrefix} must be an ES256 P-256 signing key`);
  }

  const kid = privateJwk.kid;
  const x = privateJwk.x;
  const y = privateJwk.y;
  const d = privateJwk.d;
  if (typeof kid !== "string" || typeof x !== "string" || typeof y !== "string" || typeof d !== "string") {
    throw new Error(`${errorPrefix} must contain string key material`);
  }

  if (kid.length < 4 || kid.length > 128) {
    throw new Error(`${errorPrefix} kid must be between 4 and 128 characters`);
  }

  const normalized: SailPrivateJwk = {
    kty: "EC",
    kid,
    use: "sig",
    alg: "ES256",
    crv: "P-256",
    x,
    y,
    d,
  };
  assertPrivateScalarMatchesPublicCoordinates(normalized, errorPrefix);
  return normalized;
}

export function publicJwkFromPrivateJwk(privateJwk: SailPrivateJwk): SailJwk {
  const { d: _d, ...publicJwk } = privateJwk;
  return publicJwk;
}

export function fingerprintPublicJwk(publicJwk: SailJwk): string {
  return createHash("sha256").update(stableJson({ ...publicJwk })).digest("hex");
}

export function generatePrivateJwk(kid: string): SailPrivateJwk {
  if (kid.length < 4 || kid.length > 128) {
    throw new Error("Sail signing key kid must be between 4 and 128 characters");
  }

  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const exportedPrivate = privateKey.export({ format: "jwk" }) as JWK;
  const exportedPublic = publicKey.export({ format: "jwk" }) as JWK;
  return requireSailPrivateJwk({
    kty: "EC",
    kid,
    use: "sig",
    alg: "ES256",
    crv: "P-256",
    x: exportedPublic.x,
    y: exportedPublic.y,
    d: exportedPrivate.d,
  });
}

export function keyPairFromPrivateJwk(privateJwk: SailPrivateJwk): { privateKey: KeyObject; publicKey: KeyObject } {
  const privateKey = createPrivateKey({ format: "jwk", key: privateJwk as unknown as JsonWebKey });
  return {
    privateKey,
    publicKey: createPublicKey(privateKey),
  };
}

export function assertPrivateScalarMatchesPublicCoordinates(privateJwk: SailPrivateJwk, errorPrefix: string): void {
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(privateJwk.d, "base64url"));
    const publicKey = ecdh.getPublicKey(undefined, "uncompressed");
    const x = publicKey.subarray(1, 33).toString("base64url");
    const y = publicKey.subarray(33).toString("base64url");
    if (x !== privateJwk.x || y !== privateJwk.y) {
      throw new Error("mismatch");
    }
  } catch {
    throw new Error(`${errorPrefix} public coordinates must match the private scalar`);
  }
}

function stableJson(value: Record<string, unknown>): string {
  const sorted = Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  return JSON.stringify(sorted);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
