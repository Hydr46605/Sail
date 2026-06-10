import pg from "pg";
import { loadRegistryConfig } from "../config.js";

const { Pool } = pg;

const requiredTables = [
  "sail_migrations",
  "registries",
  "accounts",
  "oauth_identities",
  "minecraft_identities",
  "name_claims",
  "sessions",
  "registry_signing_keys",
  "trusted_issuers",
  "audit_events",
] as const;

const requiredIndexes = [
  "oauth_identities_provider_subject_unique",
  "minecraft_identities_minecraft_uuid_unique",
  "minecraft_identities_mojang_uuid_unique",
  "name_claims_active_name_registry_unique",
  "sessions_session_token_hash_unique",
  "sessions_challenge_code_hash_unique",
] as const;

const pool = new Pool({
  connectionString: loadRegistryConfig().databaseUrl,
});

try {
  const tableResult = await pool.query<{ table_name: string }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1)
      ORDER BY table_name
    `,
    [requiredTables],
  );
  const tables = new Set(tableResult.rows.map((row) => row.table_name));

  const indexResult = await pool.query<{ indexname: string }>(
    `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY($1)
      ORDER BY indexname
    `,
    [requiredIndexes],
  );
  const indexes = new Set(indexResult.rows.map((row) => row.indexname));

  const missingTables = requiredTables.filter((table) => !tables.has(table));
  const missingIndexes = requiredIndexes.filter((index) => !indexes.has(index));

  if (missingTables.length > 0 || missingIndexes.length > 0) {
    for (const table of missingTables) {
      console.error(`missing table: ${table}`);
    }
    for (const index of missingIndexes) {
      console.error(`missing index: ${index}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `registry database schema verified: ${requiredTables.length} tables, ${requiredIndexes.length} indexes`,
    );
  }
} finally {
  await pool.end();
}
