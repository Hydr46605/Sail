import { describe, expect, test } from "vitest";
import { createSessionAuthStore, parseAuthCompleteHash } from "../src/auth.js";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("console auth helpers", () => {
  test("parses auth completion hash", () => {
    expect(parseAuthCompleteHash("#session_token=abc&session_id=sess_123")).toEqual({
      sessionToken: "abc",
      sessionId: "sess_123",
    });
  });

  test("returns undefined when completion hash has no token", () => {
    expect(parseAuthCompleteHash("#session_id=sess_123")).toBeUndefined();
    expect(parseAuthCompleteHash("")).toBeUndefined();
  });

  test("stores, reads, and clears session auth", () => {
    const storage = new MemoryStorage();
    const authStore = createSessionAuthStore(storage);

    expect(authStore.read()).toBeUndefined();
    authStore.write({ sessionToken: "token", sessionId: "sess_123" });

    expect(storage.getItem("sail.console.auth.v1")).toBe(
      JSON.stringify({ sessionToken: "token", sessionId: "sess_123" }),
    );
    expect(authStore.read()).toEqual({ sessionToken: "token", sessionId: "sess_123" });

    authStore.clear();
    expect(authStore.read()).toBeUndefined();
  });

  test("ignores malformed stored auth", () => {
    const storage = new MemoryStorage();
    storage.setItem("sail.console.auth.v1", "{\"sessionToken\":123}");

    expect(createSessionAuthStore(storage).read()).toBeUndefined();
  });
});
