import { randomUUID } from "node:crypto";
import type { SailJwk, SailPrivateJwk, SailRegistryConfig } from "../config.js";
import type { RegistryDatabase, RegistryDatabaseSchema } from "../db/schema.js";
import { SessionSigner } from "./session-signer.js";
import {
  assertPrivateScalarMatchesPublicCoordinates as assertMaterialPrivateScalarMatchesPublicCoordinates,
  fingerprintPublicJwk,
  publicJwkFromPrivateJwk,
  requireSailPrivateJwk,
} from "./signing-key-material.js";
import type { Transaction } from "kysely";

type SigningKeyConfig = Pick<
  SailRegistryConfig,
  "privateKey" | "registryId" | "signingKeyFingerprint" | "signingKeyRotation" | "signingKeySource"
>;
type PersistedSigningKey = {
  kid: string;
  public_jwk: unknown;
  private_jwk: unknown;
  fingerprint: string | null;
};

const recoverableSigningKeyConstraints = new Set([
  "registry_signing_keys_registry_kid_unique",
  "registry_signing_keys_one_active_idx",
]);

export async function loadPostgresSessionSigner(
  config: SigningKeyConfig,
  db: RegistryDatabase,
): Promise<SessionSigner> {
  const existing = await selectActiveSigningKey(config.registryId, db);
  if (existing) {
    const existingSigner = signerFromPersistedKey(config.registryId, existing);
    if (persistedKeyMatchesConfig(config, existing)) {
      return existingSigner;
    }
    if (config.signingKeyRotation === "rotate") {
      return rotatePostgresSigningKey(config, db);
    }

    throw new Error(
      "Configured Sail signing key does not match active database key; set SAIL_REGISTRY_SIGNING_KEY_ROTATION=rotate to rotate explicitly",
    );
  }

  return insertConfiguredActiveSigningKey(config, db);
}

export async function selectPostgresVerificationPublicKeys(
  registryId: string,
  db: RegistryDatabase,
): Promise<SailJwk[]> {
  const rows = await db
    .selectFrom("registry_signing_keys")
    .select(["public_jwk"])
    .where("registry_id", "=", registryId)
    .where("status", "in", ["active", "retiring"])
    .where("revoked_at", "is", null)
    .orderBy("activated_at", "asc")
    .execute();

  return rows.map((row) => requirePublicJwk(row.public_jwk));
}

export async function revokePostgresSigningKey(
  registryId: string,
  kid: string,
  db: RegistryDatabase,
  revokedAt = new Date(),
): Promise<void> {
  await db
    .updateTable("registry_signing_keys")
    .set({
      status: "revoked",
      revoked_at: revokedAt,
      retired_at: revokedAt,
    })
    .where("registry_id", "=", registryId)
    .where("kid", "=", kid)
    .execute();
}

async function rotatePostgresSigningKey(config: SigningKeyConfig, db: RegistryDatabase): Promise<SessionSigner> {
  return db.transaction().execute(async (trx) => {
    const existing = await selectActiveSigningKey(config.registryId, trx);
    if (!existing) {
      return insertConfiguredActiveSigningKey(config, trx);
    }
    if (persistedKeyMatchesConfig(config, existing)) {
      return signerFromPersistedKey(config.registryId, existing);
    }

    const now = new Date();
    await trx
      .updateTable("registry_signing_keys")
      .set({
        status: "retiring",
      })
      .where("registry_id", "=", config.registryId)
      .where("status", "=", "active")
      .execute();

    await insertConfiguredActiveSigningKey(config, trx, now);
    return SessionSigner.fromPrivateJwk(config.registryId, config.privateKey);
  });
}

async function insertConfiguredActiveSigningKey(
  config: SigningKeyConfig,
  db: RegistryDatabase | Transaction<RegistryDatabaseSchema>,
  activatedAt = new Date(),
): Promise<SessionSigner> {
  try {
    await db
      .insertInto("registry_signing_keys")
      .values({
        id: randomUUID(),
        registry_id: config.registryId,
        kid: config.privateKey.kid,
        public_jwk: publicJwkFromPrivateJwk(config.privateKey) as unknown as Record<string, unknown>,
        private_jwk: config.privateKey as unknown as Record<string, unknown>,
        status: "active",
        source: config.signingKeySource,
        fingerprint: config.signingKeyFingerprint,
        activated_at: activatedAt,
        not_before: activatedAt,
      })
      .execute();
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const recovered = await selectActiveSigningKey(config.registryId, db);
    if (!recovered || !persistedKeyMatchesConfig(config, recovered)) {
      throw error;
    }
    return signerFromPersistedKey(config.registryId, recovered);
  }

  return SessionSigner.fromPrivateJwk(config.registryId, config.privateKey);
}

async function selectActiveSigningKey(
  registryId: string,
  db: RegistryDatabase | Transaction<RegistryDatabaseSchema>,
): Promise<PersistedSigningKey | undefined> {
  return db
    .selectFrom("registry_signing_keys")
    .select(["kid", "public_jwk", "private_jwk", "fingerprint"])
    .where("registry_id", "=", registryId)
    .where("status", "=", "active")
    .where("revoked_at", "is", null)
    .executeTakeFirst();
}

function persistedKeyMatchesConfig(config: SigningKeyConfig, row: PersistedSigningKey): boolean {
  const publicJwk = requirePublicJwk(row.public_jwk);
  return (
    row.kid === config.privateKey.kid &&
    publicJwk.kid === config.privateKey.kid &&
    fingerprintPublicJwk(publicJwk) === config.signingKeyFingerprint
  );
}

function signerFromPersistedKey(registryId: string, row: PersistedSigningKey): SessionSigner {
  const privateJwk = requirePrivateJwk(row.private_jwk);
  const publicJwk = requirePublicJwk(row.public_jwk);
  if (row.kid !== privateJwk.kid) {
    throw new Error("Persisted Sail signing key kid does not match row");
  }
  if (publicJwk.kid !== privateJwk.kid || publicJwk.x !== privateJwk.x || publicJwk.y !== privateJwk.y) {
    throw new Error("Persisted Sail signing key public JWK does not match private JWK");
  }
  assertPersistedPrivateScalarMatchesPublicCoordinates(privateJwk);

  return SessionSigner.fromPrivateJwk(registryId, privateJwk);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    typeof error.constraint === "string" &&
    recoverableSigningKeyConstraints.has(error.constraint)
  );
}

function requirePrivateJwk(value: unknown): SailPrivateJwk {
  try {
    return requireSailPrivateJwk(value, "Persisted Sail signing key");
  } catch (error) {
    if (error instanceof Error && error.message.includes("public coordinates must match the private scalar")) {
      throw new Error("Persisted Sail signing key private scalar does not match public coordinates");
    }
    throw new Error("Persisted Sail signing key is invalid");
  }
}

function requirePublicJwk(value: unknown): SailJwk {
  if (!isSailJwk(value)) {
    throw new Error("Persisted Sail signing key is invalid");
  }
  return value;
}

function isSailJwk(value: unknown): value is SailJwk {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const jwk = value as Partial<Record<keyof SailPrivateJwk, unknown>>;
  return (
    jwk.kty === "EC" &&
    jwk.use === "sig" &&
    jwk.alg === "ES256" &&
    jwk.crv === "P-256" &&
    typeof jwk.kid === "string" &&
    jwk.kid.length >= 4 &&
    jwk.kid.length <= 128 &&
    typeof jwk.x === "string" &&
    jwk.x.length > 0 &&
    typeof jwk.y === "string" &&
    jwk.y.length > 0
  );
}

function assertPersistedPrivateScalarMatchesPublicCoordinates(privateJwk: SailPrivateJwk): void {
  try {
    assertMaterialPrivateScalarMatchesPublicCoordinates(privateJwk, "Persisted Sail signing key");
  } catch {
    throw new Error("Persisted Sail signing key private scalar does not match public coordinates");
  }
}
