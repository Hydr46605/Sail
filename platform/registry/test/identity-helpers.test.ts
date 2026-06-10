import { describe, expect, test } from "vitest";
import { hashSecret } from "../src/identity/token-hash.js";
import {
  accountPublicId,
  challengePublicId,
  parseChallengePublicId,
  parseSessionPublicId,
  sessionPublicId,
} from "../src/identity/ids.js";

describe("identity helper ids", () => {
  test("formats and parses public ids from database UUIDs", () => {
    const uuid = "11111111-2222-4333-8444-555555555555";

    expect(accountPublicId(uuid)).toBe("acct_11111111222243338444555555555555");
    expect(challengePublicId(uuid)).toBe("ch_11111111222243338444555555555555");
    expect(sessionPublicId(uuid)).toBe("sess_11111111222243338444555555555555");
    expect(parseChallengePublicId("ch_11111111222243338444555555555555")).toBe(uuid);
    expect(parseSessionPublicId("sess_11111111222243338444555555555555")).toBe(uuid);
  });

  test("round-trips parsed challenge and session ids", () => {
    const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

    expect(parseChallengePublicId(challengePublicId(uuid))).toBe(uuid);
    expect(parseSessionPublicId(sessionPublicId(uuid))).toBe(uuid);
  });

  test("rejects malformed public ids", () => {
    for (const id of [
      "sess_11111111222243338444555555555555",
      "ch_1111111122224333844455555555555",
      "ch_11111111222243338444555555555555x",
      "ch_1111111122224333844455555555555g",
      "ch_11111111-2222-4333-8444-555555555555",
      "ch_",
    ]) {
      expect(() => parseChallengePublicId(id)).toThrow("Invalid Sail ch id");
    }

    for (const id of [
      "ch_11111111222243338444555555555555",
      "sess_1111111122224333844455555555555",
      "sess_11111111222243338444555555555555x",
      "sess_1111111122224333844455555555555g",
      "sess_11111111-2222-4333-8444-555555555555",
      "sess_",
    ]) {
      expect(() => parseSessionPublicId(id)).toThrow("Invalid Sail sess id");
    }
  });

  test("hashes secrets deterministically without exposing the raw value", () => {
    const hash = hashSecret("ABCD-1234");

    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(hash).toBe(hashSecret("ABCD-1234"));
    expect(hash).not.toContain("ABCD");
  });
});
