import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { SailRegistryConfig } from "../config.js";
import { loadRegistryConfig } from "../config.js";

const { Pool } = pg;

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

export interface RegistryMigration {
  name: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  name: string;
  checksum: string;
}

export interface MigrationResult {
  applied: AppliedMigration[];
  skipped: AppliedMigration[];
}

export async function loadRegistryMigrations(dir = migrationsDir): Promise<RegistryMigration[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isFile() && /^\d{4}_[a-z0-9_]+\.sql$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const migrations: RegistryMigration[] = [];
  for (const name of migrationNames) {
    const sql = await readFile(path.join(dir, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    migrations.push({ name, sql, checksum });
  }

  return migrations;
}

export async function migrateRegistryDatabase(
  config: Pick<SailRegistryConfig, "databaseUrl"> = loadRegistryConfig(),
): Promise<MigrationResult> {
  const migrations = await loadRegistryMigrations();
  const pool = new Pool({
    connectionString: config.databaseUrl,
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sail_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const result: MigrationResult = {
      applied: [],
      skipped: [],
    };

    for (const migration of migrations) {
      await pool.query("BEGIN");
      try {
        const existing = await pool.query<{ checksum: string }>(
          "SELECT checksum FROM sail_migrations WHERE name = $1",
          [migration.name],
        );

        if (existing.rowCount && existing.rows[0]) {
          if (existing.rows[0].checksum !== migration.checksum) {
            throw new Error(`Migration checksum changed after apply: ${migration.name}`);
          }
          result.skipped.push({
            name: migration.name,
            checksum: migration.checksum,
          });
          await pool.query("COMMIT");
          continue;
        }

        await pool.query(migration.sql);
        await pool.query(
          "INSERT INTO sail_migrations (name, checksum) VALUES ($1, $2)",
          [migration.name, migration.checksum],
        );
        await pool.query("COMMIT");
        result.applied.push({
          name: migration.name,
          checksum: migration.checksum,
        });
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
    }

    return result;
  } finally {
    await pool.end();
  }
}

