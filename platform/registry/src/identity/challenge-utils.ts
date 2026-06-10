import { randomBytes } from "node:crypto";
import { SailChallengeError } from "./challenge-service.js";

export function normalizeMinecraftName(username: string): string {
  return username.toLowerCase();
}

export function buildAuthUrl(authUrl: string, code: string): string {
  const separator = authUrl.includes("?") ? "&" : "?";
  return `${authUrl}${separator}code=${encodeURIComponent(code)}`;
}

export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

export function randomCodePart(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(4);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function createSailError(
  code: string,
  statusCode: number,
  retryable: boolean,
  message: string,
  details?: Record<string, unknown>,
): SailChallengeError {
  return new SailChallengeError(statusCode, {
    protocol_version: "sail-protocol-v1",
    error: {
      code,
      message,
      audience: "player",
      http_status: statusCode,
      retryable,
      correlation_id: `corr_${randomToken(18)}`,
      ...(details ? { details } : {}),
    },
  });
}
