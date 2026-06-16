import { SailConsoleApiError } from "../api.js";
import type { ConsoleProfileResponse } from "../types.js";
import type { ConsoleProviderLabel, ConsoleSession, ConsoleTheme, OperatorSummary } from "./config.js";

export function isCurrentSessionRevoked(profile: ConsoleProfileResponse, currentSessionId?: string): boolean {
  const currentSession = profile.sessions.find((session) =>
    currentSessionId ? session.session_id === currentSessionId : session.current,
  );

  return Boolean(currentSession && (currentSession.status === "revoked" || currentSession.revoked_at !== null));
}

export function countActiveSessions(profile: ConsoleProfileResponse): number {
  return profile.sessions.filter((session) => session.status === "pending" || session.status === "completed").length;
}

export function getAuthStepLabel(canStartAuth: boolean, hasChallenge: boolean): string {
  if (hasChallenge) {
    return "Open the browser auth link";
  }
  if (canStartAuth) {
    return "Create the browser challenge";
  }
  return "Enter a Minecraft name";
}

export function getSessionHealthLabel(profile: ConsoleProfileResponse | undefined): string {
  if (!profile) {
    return "No profile loaded";
  }

  const activeSessionCount = countActiveSessions(profile);
  if (activeSessionCount === 0) {
    return "No active Sail sessions";
  }
  if (activeSessionCount === 1) {
    return "1 active Sail session";
  }
  return `${activeSessionCount} active Sail sessions`;
}

export function getOperatorSummary(profile: ConsoleProfileResponse): OperatorSummary {
  const activeSessionCount = countActiveSessions(profile);
  const inactiveSessionCount = profile.sessions.length - activeSessionCount;
  const activeServerCount = profile.trusted_servers.filter((server) => server.status === "active").length;
  const reviewServerCount = profile.trusted_servers.length - activeServerCount;
  const reusePolicyCount = new Set(profile.trusted_servers.map((server) => server.session_reuse_policy)).size;

  return {
    activeSessionsLabel: `${activeSessionCount} active gateway ${plural(activeSessionCount, "session")}`,
    inactiveSessionsLabel: `${inactiveSessionCount} inactive session ${plural(inactiveSessionCount, "record")}`,
    activeServersLabel: `${activeServerCount} active trusted ${plural(activeServerCount, "server")}`,
    reviewServersLabel: `${reviewServerCount} trusted ${plural(reviewServerCount, "server")} ${reviewServerCount === 1 ? "needs" : "need"} review`,
    reusePoliciesLabel: reusePolicyCount === 0 ? "No reuse policies" : `${reusePolicyCount} reuse ${plural(reusePolicyCount, "policy", "policies")}`,
  };
}

export function formatProviderLabel(provider: ConsoleProviderLabel): string {
  return provider.provider_username ? `${provider.provider} / ${provider.provider_username}` : provider.provider;
}

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return count === 1 ? singular : pluralValue;
}

export function shouldClearAuthAfterRevoke(
  profile: ConsoleProfileResponse | undefined,
  currentSessionId: string | undefined,
  revokedSessionId: string,
): boolean {
  if (currentSessionId === revokedSessionId) {
    return true;
  }

  return Boolean(profile?.sessions.some((session) => session.session_id === revokedSessionId && session.current));
}

export function isConsoleAuthError(error: unknown): boolean {
  return error instanceof SailConsoleApiError && ["session_revoked", "session_expired"].includes(error.code);
}

export function normalizeThemePreference(value: string | null | undefined, fallback: ConsoleTheme): ConsoleTheme {
  return value === "light" || value === "dark" ? value : fallback;
}

export function getNextThemePreference(theme: ConsoleTheme): ConsoleTheme {
  return theme === "dark" ? "light" : "dark";
}

export function formatError(error: unknown): string {
  if (error instanceof SailConsoleApiError) {
    return redactSensitiveText(`${error.code}: ${error.message}`);
  }
  if (error instanceof Error) {
    return redactSensitiveText(error.message);
  }
  return "Unknown error";
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+={0,2}/gu, "Bearer [redacted]")
    .replace(/([#?&]session_token=)[^&#\s]+/gu, "$1[redacted]")
    .replace(/(\bsessionToken["']?\s*[:=]\s*["']?)[^"',\s&]+/gu, "$1[redacted]");
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
