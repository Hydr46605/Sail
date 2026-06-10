import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadRegistryConfig } from "../src/config.js";

const devPrivateJwk = {
  kty: "EC",
  kid: "dev-es256-2026-06",
  use: "sig",
  alg: "ES256",
  crv: "P-256",
  x: "0WamuH-EnCrBXIQwPZo2ZKfwNV9OW9EDkzr4YzscxcY",
  y: "0wFxw0l_9Rziux_ZQboPeCkBi5oLibu_5GocXtVUURo",
  d: "cgltruyV9L4GvyWUauOeVmkPew0k1SQSc6HhAdzPAYM",
};

describe("registry config", () => {
  test("defaults registry state backend to memory", () => {
    const config = loadRegistryConfig({});

    expect(config.stateBackend).toBe("memory");
  });

  test("allows postgres registry state backend", () => {
    const config = loadRegistryConfig({
      SAIL_REGISTRY_STATE_BACKEND: "postgres",
      SAIL_REGISTRY_ALLOW_DEV_SIGNING_KEY: "true",
    });

    expect(config.stateBackend).toBe("postgres");
  });

  test("rejects unknown registry state backend", () => {
    expect(() =>
      loadRegistryConfig({
        SAIL_REGISTRY_STATE_BACKEND: "sqlite",
      }),
    ).toThrow("SAIL_REGISTRY_STATE_BACKEND must be memory or postgres");
  });

  test("loads configured console URL", () => {
    const config = loadRegistryConfig({
      SAIL_CONSOLE_URL: " http://127.0.0.1:5173 ",
    });

    expect(config.consoleUrl).toBe("http://127.0.0.1:5173");
  });

  test("normalizes blank console URL to undefined", () => {
    const config = loadRegistryConfig({
      SAIL_CONSOLE_URL: "   ",
    });

    expect(config.consoleUrl).toBeUndefined();
  });

  test("rejects malformed console URL at config load", () => {
    expect(() =>
      loadRegistryConfig({
        SAIL_CONSOLE_URL: "not a url",
      }),
    ).toThrow("SAIL_CONSOLE_URL must be a valid http or https URL");
  });

  test("defaults local server bootstrap config", () => {
    const config = loadRegistryConfig({});

    expect(config.defaultServer).toEqual({
      serverId: "local-survival",
      displayName: "Local Survival",
      registryMode: "self_hosted",
      allowedClaimTypes: ["LOCAL_SOFT"],
      sessionReusePolicy: "same_registry",
      privacyMode: "minimal",
      publicListing: false,
    });
  });

  test("rejects invalid configured server ids", () => {
    expect(() =>
      loadRegistryConfig({
        SAIL_SERVER_ID: "Bad Server",
      }),
    ).toThrow("SAIL_SERVER_ID must match Sail server id format");
  });

  test("defaults memory mode to an explicit development signing key source", () => {
    const config = loadRegistryConfig({});

    expect(config.signingKeySource).toBe("dev");
    expect(config.privateKey.kid).toBe("dev-es256-2026-06");
    expect(config.signingKeyFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("rejects implicit development signing key in postgres mode", () => {
    expect(() =>
      loadRegistryConfig({
        SAIL_REGISTRY_STATE_BACKEND: "postgres",
      }),
    ).toThrow("PostgreSQL registries must set a non-dev signing key source or explicitly allow the dev key");
  });

  test("rejects development signing key for Sail Global", () => {
    expect(() =>
      loadRegistryConfig({
        SAIL_REGISTRY_TRUST_STATUS: "global",
        SAIL_REGISTRY_SIGNING_KEY_SOURCE: "dev",
        SAIL_REGISTRY_ALLOW_DEV_SIGNING_KEY: "true",
      }),
    ).toThrow("Sail Global and production registries cannot use the development signing key");
  });

  test("rejects development signing key in production node environment", () => {
    expect(() =>
      loadRegistryConfig({
        NODE_ENV: "production",
        SAIL_REGISTRY_SIGNING_KEY_SOURCE: "dev",
        SAIL_REGISTRY_ALLOW_DEV_SIGNING_KEY: "true",
      }),
    ).toThrow("Sail Global and production registries cannot use the development signing key");
  });

  test("loads signing key from explicit environment fields without fallback", () => {
    const config = loadRegistryConfig({
      SAIL_REGISTRY_STATE_BACKEND: "postgres",
      SAIL_REGISTRY_SIGNING_KEY_SOURCE: "env",
      SAIL_REGISTRY_JWK_KID: devPrivateJwk.kid,
      SAIL_REGISTRY_JWK_X: devPrivateJwk.x,
      SAIL_REGISTRY_JWK_Y: devPrivateJwk.y,
      SAIL_REGISTRY_JWK_D: devPrivateJwk.d,
    });

    expect(config.signingKeySource).toBe("env");
    expect(config.privateKey).toEqual(devPrivateJwk);
  });

  test("rejects partial signing key environment fields without leaking values", () => {
    expect(() =>
      loadRegistryConfig({
        SAIL_REGISTRY_SIGNING_KEY_SOURCE: "env",
        SAIL_REGISTRY_JWK_KID: "partial-es256-2026-06",
        SAIL_REGISTRY_JWK_X: devPrivateJwk.x,
        SAIL_REGISTRY_JWK_D: devPrivateJwk.d,
      }),
    ).toThrow("SAIL_REGISTRY_JWK_Y is required when SAIL_REGISTRY_SIGNING_KEY_SOURCE=env");
  });

  test("loads signing key from a private file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sail-key-"));
    try {
      const file = join(dir, "signing-key.jwk.json");
      writeFileSync(file, `${JSON.stringify(devPrivateJwk)}\n`, { mode: 0o600 });
      chmodSync(file, 0o600);

      const config = loadRegistryConfig({
        SAIL_REGISTRY_STATE_BACKEND: "postgres",
        SAIL_REGISTRY_SIGNING_KEY_SOURCE: "file",
        SAIL_REGISTRY_SIGNING_KEY_FILE: file,
      });

      expect(config.signingKeySource).toBe("file");
      expect(config.privateKey).toEqual(devPrivateJwk);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("rejects group-readable signing key files by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "sail-key-"));
    try {
      const file = join(dir, "signing-key.jwk.json");
      writeFileSync(file, `${JSON.stringify(devPrivateJwk)}\n`, { mode: 0o640 });
      chmodSync(file, 0o640);

      expect(() =>
        loadRegistryConfig({
          SAIL_REGISTRY_SIGNING_KEY_SOURCE: "file",
          SAIL_REGISTRY_SIGNING_KEY_FILE: file,
        }),
      ).toThrow("SAIL_REGISTRY_SIGNING_KEY_FILE must not be readable by group or others");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
