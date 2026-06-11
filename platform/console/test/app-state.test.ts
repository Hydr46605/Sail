import { describe, expect, test } from "vitest";
import type { ConsoleProfileResponse } from "../src/types.js";
import {
  countActiveSessions,
  formatProviderLabel,
  getAuthStepLabel,
  getConsoleRuntimeConfig,
  getConsoleRouterBasePath,
  getOperatorSummary,
  getNextThemePreference,
  getSessionHealthLabel,
  isConsoleAuthError,
  isCurrentSessionRevoked,
  normalizeThemePreference,
  shouldClearAuthAfterRevoke,
} from "../src/App.js";
import { SailConsoleApiError } from "../src/api.js";

const baseProfile: ConsoleProfileResponse = {
  protocol_version: "sail-protocol-v1",
  account: {
    account_id: "acct_local",
    display_name: "Hydra",
    status: "active",
    risk_level: "low",
    linked_providers: [],
  },
  names: [],
  sessions: [],
  trusted_servers: [],
};

describe("console app state helpers", () => {
  test("detects when the current session row is revoked", () => {
    const profile: ConsoleProfileResponse = {
      ...baseProfile,
      sessions: [
        {
          session_id: "sess_current",
          server_id: "local-survival",
          server_display_name: "Local Survival",
          status: "revoked",
          current: true,
          created_at: "2026-06-08T10:00:00.000Z",
          completed_at: "2026-06-08T10:01:00.000Z",
          expires_at: "2026-06-08T10:15:00.000Z",
          revoked_at: "2026-06-08T10:02:00.000Z",
        },
      ],
    };

    expect(isCurrentSessionRevoked(profile, "sess_current")).toBe(true);
  });

  test("does not treat missing or active current sessions as revoked", () => {
    const profile: ConsoleProfileResponse = {
      ...baseProfile,
      sessions: [
        {
          session_id: "sess_current",
          server_id: "local-survival",
          server_display_name: "Local Survival",
          status: "completed",
          current: true,
          created_at: "2026-06-08T10:00:00.000Z",
          completed_at: "2026-06-08T10:01:00.000Z",
          expires_at: "2026-06-08T10:15:00.000Z",
          revoked_at: null,
        },
      ],
    };

    expect(isCurrentSessionRevoked(profile, "sess_current")).toBe(false);
    expect(isCurrentSessionRevoked(profile, "sess_missing")).toBe(false);
  });

  test("counts active sessions without revoked, expired, or denied rows", () => {
    const sessionBase = {
      server_id: "local-survival",
      server_display_name: "Local Survival",
      current: false,
      created_at: "2026-06-08T10:00:00.000Z",
      completed_at: null,
      expires_at: "2026-06-08T10:15:00.000Z",
      revoked_at: null,
    };
    const profile: ConsoleProfileResponse = {
      ...baseProfile,
      sessions: [
        { ...sessionBase, session_id: "sess_pending", status: "pending" },
        { ...sessionBase, session_id: "sess_done", status: "completed" },
        { ...sessionBase, session_id: "sess_revoked", status: "revoked" },
        { ...sessionBase, session_id: "sess_expired", status: "expired" },
        { ...sessionBase, session_id: "sess_denied", status: "denied" },
      ],
    };

    expect(countActiveSessions(profile)).toBe(2);
  });

  test("labels auth challenge progress", () => {
    expect(getAuthStepLabel(false, false)).toBe("Enter a Minecraft name");
    expect(getAuthStepLabel(true, false)).toBe("Create the browser challenge");
    expect(getAuthStepLabel(true, true)).toBe("Open the browser auth link");
  });

  test("labels session health from profile state", () => {
    expect(getSessionHealthLabel(undefined)).toBe("No profile loaded");
    expect(getSessionHealthLabel({ ...baseProfile, sessions: [] })).toBe("No active Sail sessions");
    expect(getSessionHealthLabel({
      ...baseProfile,
      sessions: [
        {
          session_id: "sess_done",
          server_id: "local-survival",
          server_display_name: "Local Survival",
          status: "completed",
          current: true,
          created_at: "2026-06-08T10:00:00.000Z",
          completed_at: "2026-06-08T10:01:00.000Z",
          expires_at: "2026-06-08T11:00:00.000Z",
          revoked_at: null,
        },
      ],
    })).toBe("1 active Sail session");
  });

  test("summarizes operator session and server coverage", () => {
    const profile: ConsoleProfileResponse = {
      ...baseProfile,
      sessions: [
        {
          session_id: "sess_pending",
          server_id: "local-survival",
          server_display_name: "Local Survival",
          status: "pending",
          current: false,
          created_at: "2026-06-08T10:00:00.000Z",
          completed_at: null,
          expires_at: "2026-06-08T10:15:00.000Z",
          revoked_at: null,
        },
        {
          session_id: "sess_completed",
          server_id: "local-survival",
          server_display_name: "Local Survival",
          status: "completed",
          current: true,
          created_at: "2026-06-08T10:00:00.000Z",
          completed_at: "2026-06-08T10:01:00.000Z",
          expires_at: "2026-06-08T10:15:00.000Z",
          revoked_at: null,
        },
        {
          session_id: "sess_revoked",
          server_id: "limbo",
          server_display_name: "Limbo",
          status: "revoked",
          current: false,
          created_at: "2026-06-08T10:00:00.000Z",
          completed_at: "2026-06-08T10:01:00.000Z",
          expires_at: "2026-06-08T10:15:00.000Z",
          revoked_at: "2026-06-08T10:02:00.000Z",
        },
      ],
      trusted_servers: [
        {
          protocol_version: "sail-protocol-v1",
          server_id: "local-survival",
          registry_id: "sail",
          display_name: "Local Survival",
          registry_mode: "hybrid",
          allowed_claim_types: ["SAIL_GLOBAL", "LOCAL_SOFT"],
          privacy_mode: "standard",
          public_listing: false,
          session_reuse_policy: "same_registry",
          status: "active",
        },
        {
          protocol_version: "sail-protocol-v1",
          server_id: "limbo",
          registry_id: "sail",
          display_name: "Limbo",
          registry_mode: "global",
          allowed_claim_types: ["MINECRAFT_VERIFIED"],
          privacy_mode: "minimal",
          public_listing: false,
          session_reuse_policy: "off",
          status: "disabled",
        },
      ],
    };

    expect(getOperatorSummary(profile)).toEqual({
      activeSessionsLabel: "2 active gateway sessions",
      inactiveSessionsLabel: "1 inactive session record",
      activeServersLabel: "1 active trusted server",
      reviewServersLabel: "1 trusted server needs review",
      reusePoliciesLabel: "2 reuse policies",
    });
  });

  test("clears auth when revoking the current session without a stored session id", () => {
    const profile: ConsoleProfileResponse = {
      ...baseProfile,
      sessions: [
        {
          session_id: "sess_current",
          server_id: "local-survival",
          server_display_name: "Local Survival",
          status: "completed",
          current: true,
          created_at: "2026-06-08T10:00:00.000Z",
          completed_at: "2026-06-08T10:01:00.000Z",
          expires_at: "2026-06-08T10:15:00.000Z",
          revoked_at: null,
        },
      ],
    };

    expect(shouldClearAuthAfterRevoke(profile, undefined, "sess_current")).toBe(true);
    expect(shouldClearAuthAfterRevoke(profile, undefined, "sess_other")).toBe(false);
  });

  test("clears auth when revoking the stored session id", () => {
    expect(shouldClearAuthAfterRevoke(baseProfile, "sess_stored", "sess_stored")).toBe(true);
    expect(shouldClearAuthAfterRevoke(baseProfile, "sess_stored", "sess_other")).toBe(false);
  });

  test("detects console auth errors that require local logout", () => {
    expect(isConsoleAuthError(new SailConsoleApiError(403, "session_revoked", "Session revoked"))).toBe(true);
    expect(isConsoleAuthError(new SailConsoleApiError(410, "session_expired", "Session expired"))).toBe(true);
    expect(isConsoleAuthError(new SailConsoleApiError(409, "name_already_claimed", "Name claimed"))).toBe(false);
    expect(isConsoleAuthError(new Error("network down"))).toBe(false);
  });

  test("normalizes stored theme preferences with a fallback", () => {
    expect(normalizeThemePreference("dark", "light")).toBe("dark");
    expect(normalizeThemePreference("light", "dark")).toBe("light");
    expect(normalizeThemePreference("system", "dark")).toBe("dark");
    expect(normalizeThemePreference(null, "light")).toBe("light");
  });

  test("toggles between light and dark theme preferences", () => {
    expect(getNextThemePreference("light")).toBe("dark");
    expect(getNextThemePreference("dark")).toBe("light");
  });

  test("formats provider labels with usernames", () => {
    expect(formatProviderLabel({ provider: "discord", provider_username: "Hydra" })).toBe("discord / Hydra");
  });

  test("formats provider labels without usernames", () => {
    expect(formatProviderLabel({ provider: "dev", provider_username: null })).toBe("dev");
  });

  test("detects the router base path for static console deployments", () => {
    expect(getConsoleRouterBasePath("/")).toBe("/");
    expect(getConsoleRouterBasePath("/auth/complete")).toBe("/");
    expect(getConsoleRouterBasePath("/console/")).toBe("/console");
    expect(getConsoleRouterBasePath("/console/index.html")).toBe("/console");
    expect(getConsoleRouterBasePath("/console/auth/complete")).toBe("/console");
    expect(getConsoleRouterBasePath("/downloads/console/index.html")).toBe("/downloads/console");
  });

  test("keeps the default console configurable for local development", () => {
    expect(getConsoleRuntimeConfig({})).toEqual({
      defaultRegistryUrl: "http://127.0.0.1:8787",
      registryLocked: false,
    });
  });

  test("locks the console to a configured public registry", () => {
    expect(getConsoleRuntimeConfig({
      VITE_SAIL_CONSOLE_REGISTRY_URL: " https://api.sailmc.net/ ",
      VITE_SAIL_CONSOLE_LOCK_REGISTRY: "true",
    })).toEqual({
      defaultRegistryUrl: "https://api.sailmc.net",
      registryLocked: true,
    });
  });
});
