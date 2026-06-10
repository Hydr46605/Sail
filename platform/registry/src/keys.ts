import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistryConfig, type SailJwk } from "./config.js";
import { createRegistryDatabase, destroyRegistryDatabase } from "./db/database.js";
import {
  fingerprintPublicJwk,
  generatePrivateJwk,
  publicJwkFromPrivateJwk,
  requireSailPrivateJwk,
} from "./identity/signing-key-material.js";
import {
  loadPostgresSessionSigner,
  revokePostgresSigningKey,
} from "./identity/signing-key-store.js";
import { readPrivateJsonSecretFile } from "./secrets.js";

export interface SigningKeyInspection {
  fingerprint: string;
  public_jwk: SailJwk;
}

export async function writeGeneratedSigningKeyFile(kid: string, path: string): Promise<SigningKeyInspection> {
  const privateJwk = generatePrivateJwk(kid);
  await writeFile(path, `${JSON.stringify(privateJwk, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return inspectPrivateJwk(privateJwk);
}

export function inspectSigningKeyFile(path: string): SigningKeyInspection {
  return inspectPrivateJwk(
    requireSailPrivateJwk(readPrivateJsonSecretFile(path, false), "Sail key tooling input"),
  );
}

export function inspectPrivateJwk(value: unknown): SigningKeyInspection {
  const privateJwk = requireSailPrivateJwk(value, "Sail key tooling input");
  const publicJwk = publicJwkFromPrivateJwk(privateJwk);
  return {
    fingerprint: fingerprintPublicJwk(publicJwk),
    public_jwk: publicJwk,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help") {
    printUsage();
    return;
  }

  if (command === "generate") {
    const kid = readFlag(args, "--kid");
    const out = readFlag(args, "--out");
    if (!kid || !out) {
      throw new Error("generate requires --kid and --out");
    }
    console.log(JSON.stringify(await writeGeneratedSigningKeyFile(kid, out), null, 2));
    return;
  }

  if (command === "inspect") {
    const file = readFlag(args, "--file");
    if (!file) {
      throw new Error("inspect requires --file");
    }
    console.log(JSON.stringify(inspectSigningKeyFile(file), null, 2));
    return;
  }

  if (command === "list") {
    await withDatabase(async (db) => {
      const config = loadRegistryConfig();
      const rows = await db
        .selectFrom("registry_signing_keys")
        .select(["kid", "status", "source", "fingerprint", "created_at", "activated_at", "retired_at", "revoked_at"])
        .where("registry_id", "=", config.registryId)
        .orderBy("created_at", "asc")
        .execute();
      console.log(JSON.stringify(rows, null, 2));
    });
    return;
  }

  if (command === "rotate") {
    await withDatabase(async (db) => {
      const config = { ...loadRegistryConfig(), signingKeyRotation: "rotate" as const };
      const signer = await loadPostgresSessionSigner(config, db);
      console.log(JSON.stringify({ active_kid: signer.getPublicJwk().kid }, null, 2));
    });
    return;
  }

  if (command === "revoke") {
    const kid = readFlag(args, "--kid");
    if (!kid) {
      throw new Error("revoke requires --kid");
    }
    await withDatabase(async (db) => {
      const config = loadRegistryConfig();
      await revokePostgresSigningKey(config.registryId, kid, db);
      console.log(JSON.stringify({ revoked_kid: kid }, null, 2));
    });
    return;
  }

  throw new Error(`Unknown Sail key command: ${command}`);
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function withDatabase<T>(callback: (db: ReturnType<typeof createRegistryDatabase>) => Promise<T>): Promise<T> {
  const db = createRegistryDatabase(loadRegistryConfig());
  try {
    return await callback(db);
  } finally {
    await destroyRegistryDatabase(db);
  }
}

function printUsage(): void {
  console.log(`Sail registry key tooling

Usage:
  pnpm --filter @sail/registry key:generate -- --kid <kid> --out <file>
  pnpm --filter @sail/registry key:inspect -- --file <file>
  pnpm --filter @sail/registry key:list
  pnpm --filter @sail/registry key:rotate
  pnpm --filter @sail/registry key:revoke -- --kid <kid>
`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
