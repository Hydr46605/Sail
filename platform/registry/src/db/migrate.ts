import { migrateRegistryDatabase } from "./migrations.js";
import { loadRegistryConfig } from "../config.js";

const result = await migrateRegistryDatabase(loadRegistryConfig());

for (const migration of result.applied) {
  console.log(`applied ${migration.name}`);
}

for (const migration of result.skipped) {
  console.log(`skipped ${migration.name}`);
}

console.log(
  `registry migrations complete: ${result.applied.length} applied, ${result.skipped.length} skipped`,
);

