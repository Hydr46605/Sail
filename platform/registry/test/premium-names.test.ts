import { describe, expect, test } from "vitest";
import {
  CachedPremiumNameLookup,
  MojangProfilePremiumNameLookup,
  PremiumNameLookupUnavailableError,
  type PremiumNameLookup,
} from "../src/premium-names.js";

describe("premium-name lookup", () => {
  test("treats a resolved Mojang profile as premium", async () => {
    const calls: string[] = [];
    const lookup = new MojangProfilePremiumNameLookup({
      baseUrl: "https://api.mojang.test",
      fetchImpl: async (input) => {
        calls.push(String(input));
        return Response.json({
          id: "069a79f444e94726a5befca90e38aaf5",
          name: "Notch",
        });
      },
    });

    const status = await lookup.lookup("notch");

    expect(calls).toEqual(["https://api.mojang.test/users/profiles/minecraft/notch"]);
    expect(status).toEqual({
      canonicalName: "notch",
      premium: true,
      mojangUuid: "069a79f444e94726a5befca90e38aaf5",
      mojangName: "Notch",
    });
  });

  test.each([204, 404])("treats Mojang profile HTTP %i as non-premium", async (statusCode) => {
    const lookup = new MojangProfilePremiumNameLookup({
      baseUrl: "https://api.mojang.test",
      fetchImpl: async () => new Response(null, { status: statusCode }),
    });

    await expect(lookup.lookup("example")).resolves.toEqual({
      canonicalName: "example",
      premium: false,
    });
  });

  test("fails closed when Mojang returns a retryable error", async () => {
    const lookup = new MojangProfilePremiumNameLookup({
      baseUrl: "https://api.mojang.test",
      fetchImpl: async () => Response.json({ error: "TooManyRequestsException" }, { status: 429 }),
    });

    await expect(lookup.lookup("example")).rejects.toBeInstanceOf(PremiumNameLookupUnavailableError);
  });

  test("caches positive and negative lookup results with separate TTLs", async () => {
    let calls = 0;
    let now = 1_000;
    const delegate: PremiumNameLookup = {
      lookup: async (canonicalName) => {
        calls += 1;
        return {
          canonicalName,
          premium: calls === 1,
        };
      },
    };
    const lookup = new CachedPremiumNameLookup(delegate, {
      positiveTtlMs: 10_000,
      negativeTtlMs: 500,
      now: () => now,
    });

    await expect(lookup.lookup("notch")).resolves.toMatchObject({ premium: true });
    await expect(lookup.lookup("notch")).resolves.toMatchObject({ premium: true });
    now += 10_001;
    await expect(lookup.lookup("notch")).resolves.toMatchObject({ premium: false });
    await expect(lookup.lookup("notch")).resolves.toMatchObject({ premium: false });
    now += 501;
    await expect(lookup.lookup("notch")).resolves.toMatchObject({ premium: false });

    expect(calls).toBe(3);
  });
});
