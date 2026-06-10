import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  inspectSigningKeyFile,
  writeGeneratedSigningKeyFile,
} from "../src/keys.js";

describe("registry key operator tooling", () => {
  test("generates a private JWK file with owner-only permissions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sail-key-tool-"));
    try {
      const file = join(dir, "generated.jwk.json");

      await writeGeneratedSigningKeyFile("tool-es256-2026-06", file);

      const stat = statSync(file);
      expect(stat.mode & 0o777).toBe(0o600);
      const parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      expect(parsed).toMatchObject({
        alg: "ES256",
        crv: "P-256",
        kid: "tool-es256-2026-06",
        kty: "EC",
        use: "sig",
      });
      expect(parsed.d).toEqual(expect.any(String));
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("inspects a private JWK file without returning private material", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sail-key-tool-"));
    try {
      const file = join(dir, "generated.jwk.json");
      await writeGeneratedSigningKeyFile("inspect-es256-2026-06", file);
      chmodSync(file, 0o600);

      const inspection = inspectSigningKeyFile(file);

      expect(inspection).toMatchObject({
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
        public_jwk: {
          alg: "ES256",
          crv: "P-256",
          kid: "inspect-es256-2026-06",
          kty: "EC",
          use: "sig",
        },
      });
      expect(inspection.public_jwk).not.toHaveProperty("d");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
