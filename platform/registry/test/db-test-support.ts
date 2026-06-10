import pg from "pg";
import { migrateRegistryDatabase } from "../src/db/migrations.js";

const { Pool } = pg;
const localResetAdvisoryLockId = 703_154_132;
const localSuiteAdvisoryLockId = 703_154_133;

export const localTestDatabaseUrl =
  process.env.SAIL_REGISTRY_TEST_DATABASE_URL ?? "postgres://sail:sail_dev_password@127.0.0.1:15432/sail";

function redactDatabaseUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    if (url.password) {
      url.password = "***";
    }
    if (url.searchParams.has("password")) {
      url.searchParams.set("password", "***");
    }
    return url.toString();
  } catch {
    return "<invalid database URL>";
  }
}

export function requireLocalTestDatabaseUrl(databaseUrl = localTestDatabaseUrl): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error(`Refusing to reset non-local Sail test database: ${redactDatabaseUrl(databaseUrl)}`);
  }

  const localProtocol = url.protocol === "postgres:" || url.protocol === "postgresql:";
  const localHost = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  const safeSearchParams = [...url.searchParams.keys()].every((key) => key === "password");
  if (
    !localProtocol ||
    url.username !== "sail" ||
    !localHost ||
    url.port !== "15432" ||
    url.pathname !== "/sail" ||
    !safeSearchParams
  ) {
    throw new Error(`Refusing to reset non-local Sail test database: ${redactDatabaseUrl(databaseUrl)}`);
  }
  return databaseUrl;
}

export async function resetLocalTestDatabase(databaseUrl = localTestDatabaseUrl): Promise<void> {
  const safeUrl = requireLocalTestDatabaseUrl(databaseUrl);
  const pool = new Pool({ connectionString: safeUrl });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [localResetAdvisoryLockId]);
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO sail");
    await client.query("GRANT ALL ON SCHEMA public TO public");
    await migrateRegistryDatabase({ databaseUrl: safeUrl });
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [localResetAdvisoryLockId]);
    } finally {
      client.release();
    }
    await pool.end();
  }
}

export interface LocalTestDatabaseLock {
  release(): Promise<void>;
}

export async function acquireLocalTestDatabaseLock(databaseUrl = localTestDatabaseUrl): Promise<LocalTestDatabaseLock> {
  const safeUrl = requireLocalTestDatabaseUrl(databaseUrl);
  const pool = new Pool({ connectionString: safeUrl });
  const client = await pool.connect();
  let released = false;

  try {
    await client.query("SELECT pg_advisory_lock($1)", [localSuiteAdvisoryLockId]);
  } catch (error) {
    client.release();
    await pool.end();
    throw error;
  }

  return {
    async release(): Promise<void> {
      if (released) {
        return;
      }
      released = true;
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [localSuiteAdvisoryLockId]);
      } finally {
        client.release();
        await pool.end();
      }
    },
  };
}
