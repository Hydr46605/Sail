import { buildRegistryApp } from "./app.js";
import { loadRegistryConfig } from "./config.js";
import { createRegistryDatabase, destroyRegistryDatabase } from "./db/database.js";
import type { RegistryDatabase } from "./db/schema.js";
import { PostgresChallengeService } from "./identity/postgres-challenge-service.js";
import { bootstrapDefaultServer } from "./identity/server-records.js";
import { loadPostgresSessionSigner } from "./identity/signing-key-store.js";

const config = loadRegistryConfig();
let db: RegistryDatabase | undefined;

const dependencies = await (async () => {
  if (config.stateBackend === "memory") {
    return {};
  }

  const createdDb = createRegistryDatabase(config);
  db = createdDb;
  try {
    await bootstrapDefaultServer(config, createdDb);
    const sessionSigner = await loadPostgresSessionSigner(config, createdDb);
    return {
      challengeService: new PostgresChallengeService(config, createdDb, { sessionSigner }),
    };
  } catch (error) {
    try {
      await destroyRegistryDatabase(createdDb);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Sail registry startup failed and cleanup failed");
    } finally {
      if (db === createdDb) {
        db = undefined;
      }
    }
    throw error;
  }
})();

const app = buildRegistryApp(config, { logger: true }, dependencies);
let shuttingDown = false;

async function closeResources(): Promise<void> {
  let closeError: unknown;
  try {
    await app.close();
  } catch (error) {
    closeError = error;
  }

  if (db) {
    try {
      await destroyRegistryDatabase(db);
      db = undefined;
    } catch (error) {
      closeError ??= error;
    }
  }

  if (closeError) {
    throw closeError;
  }
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, "shutting down registry");

  try {
    await closeResources();
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await app.listen({
    host: config.host,
    port: config.port,
  });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  try {
    await closeResources();
  } catch (cleanupError) {
    app.log.error(cleanupError);
  }
}
