import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { SailRegistryConfig } from "../config.js";
import type { RegistryDatabase, RegistryDatabaseSchema } from "./schema.js";

const { Pool } = pg;

export function createRegistryDatabase(config: Pick<SailRegistryConfig, "databaseUrl">): RegistryDatabase {
  return new Kysely<RegistryDatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: config.databaseUrl,
      }),
    }),
  });
}

export async function destroyRegistryDatabase(db: RegistryDatabase): Promise<void> {
  await db.destroy();
}
