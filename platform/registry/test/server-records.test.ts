import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { loadRegistryConfig } from "../src/config.js";
import { createRegistryDatabase, destroyRegistryDatabase } from "../src/db/database.js";
import type { RegistryDatabase } from "../src/db/schema.js";
import {
  bootstrapDefaultServer,
  getActiveServerById,
  serializeServerRecord,
} from "../src/identity/server-records.js";
import {
  acquireLocalTestDatabaseLock,
  localTestDatabaseUrl,
  resetLocalTestDatabase,
  type LocalTestDatabaseLock,
} from "./db-test-support.js";

const dbIntegrationTimeoutMs = 30_000;
const dbSuiteLockTimeoutMs = 180_000;
const dbResetTimeoutMs = 180_000;

const config = loadRegistryConfig({
  SAIL_REGISTRY_DATABASE_URL: localTestDatabaseUrl,
  SAIL_REGISTRY_ID: "sail-local",
});

const dbs: RegistryDatabase[] = [];
let databaseLock: LocalTestDatabaseLock | undefined;

function createDatabase(): RegistryDatabase {
  const db = createRegistryDatabase(config);
  dbs.push(db);
  return db;
}

describe.sequential("server records", () => {
  beforeAll(async () => {
    databaseLock = await acquireLocalTestDatabaseLock();
  }, dbSuiteLockTimeoutMs);

  afterAll(async () => {
    await databaseLock?.release();
    databaseLock = undefined;
  }, dbIntegrationTimeoutMs);

  beforeEach(async () => {
    await resetLocalTestDatabase();
  }, dbResetTimeoutMs);

  afterEach(async () => {
    const results = await Promise.allSettled(dbs.splice(0).map((db) => destroyRegistryDatabase(db)));
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      throw failed.reason;
    }
  }, dbResetTimeoutMs);

  test("bootstrap creates one active local-survival server", async () => {
    const db = createDatabase();

    const server = await bootstrapDefaultServer(config, db);

    expect(server).toMatchObject({
      registry_id: "sail-local",
      server_id: "local-survival",
      display_name: "Local Survival",
      owner_account_id: null,
      registry_mode: "self_hosted",
      allowed_claim_types: ["LOCAL_SOFT"],
      session_reuse_policy: "same_registry",
      privacy_mode: "minimal",
      status: "active",
      public_listing: false,
    });
    const rows = await db.selectFrom("servers").selectAll().execute();
    expect(rows).toHaveLength(1);
  }, dbIntegrationTimeoutMs);

  test("bootstrap is idempotent and preserves server ownership", async () => {
    const db = createDatabase();
    const ownerAccountId = "11111111-1111-4111-8111-111111111111";

    await db
      .insertInto("accounts")
      .values({
        id: ownerAccountId,
        primary_display_name: "Owner",
      })
      .execute();
    await bootstrapDefaultServer(config, db);
    await db
      .updateTable("servers")
      .set({ owner_account_id: ownerAccountId })
      .where("registry_id", "=", "sail-local")
      .where("server_id", "=", "local-survival")
      .execute();

    const updatedConfig = loadRegistryConfig({
      SAIL_REGISTRY_DATABASE_URL: localTestDatabaseUrl,
      SAIL_REGISTRY_ID: "sail-local",
      SAIL_SERVER_DISPLAY_NAME: "Renamed Survival",
      SAIL_SERVER_PUBLIC_LISTING: "true",
    });
    await bootstrapDefaultServer(updatedConfig, db);

    const rows = await db.selectFrom("servers").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      display_name: "Renamed Survival",
      owner_account_id: ownerAccountId,
      public_listing: true,
    });
  }, dbIntegrationTimeoutMs);

  test("getActiveServerById returns undefined for disabled server", async () => {
    const db = createDatabase();

    await bootstrapDefaultServer(config, db);
    await db
      .updateTable("servers")
      .set({ status: "disabled" })
      .where("registry_id", "=", "sail-local")
      .where("server_id", "=", "local-survival")
      .execute();

    await expect(getActiveServerById(db, "sail-local", "local-survival")).resolves.toBeUndefined();
  }, dbIntegrationTimeoutMs);

  test("serialized server contains no owner private data", async () => {
    const db = createDatabase();
    const ownerAccountId = "22222222-2222-4222-8222-222222222222";

    await db
      .insertInto("accounts")
      .values({
        id: ownerAccountId,
        primary_display_name: "Owner",
      })
      .execute();
    await bootstrapDefaultServer(config, db);
    const row = await db
      .updateTable("servers")
      .set({ owner_account_id: ownerAccountId })
      .where("registry_id", "=", "sail-local")
      .where("server_id", "=", "local-survival")
      .returningAll()
      .executeTakeFirstOrThrow();

    const serialized = serializeServerRecord(row);

    expect(serialized).toEqual({
      protocol_version: "sail-protocol-v1",
      registry_id: "sail-local",
      server_id: "local-survival",
      display_name: "Local Survival",
      registry_mode: "self_hosted",
      allowed_claim_types: ["LOCAL_SOFT"],
      session_reuse_policy: "same_registry",
      privacy_mode: "minimal",
      status: "active",
      public_listing: false,
    });
    expect(serialized).not.toHaveProperty("owner_account_id");
    expect(serialized).not.toHaveProperty("id");
    expect(serialized).not.toHaveProperty("created_at");
  }, dbIntegrationTimeoutMs);
});
