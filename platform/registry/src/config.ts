import { fingerprintPublicJwk, publicJwkFromPrivateJwk, requireSailPrivateJwk } from "./identity/signing-key-material.js";
import { readPrivateJsonSecretFile } from "./secrets.js";

export type SailTrustStatus = "global" | "self_hosted" | "trusted_by_admin" | "unverified";
export type RegistryStateBackend = "memory" | "postgres";
export type ServerRegistryMode = "global" | "self_hosted" | "hybrid";
export type ServerSessionReusePolicy = "off" | "same_registry" | "allowlisted_servers" | "global_trusted";
export type ServerPrivacyMode = "minimal" | "standard" | "audit_full";
export type DefaultServerAllowedClaimType = "LOCAL_SOFT";
export type SigningKeySource = "dev" | "env" | "file";

export interface SailJwk {
  kty: "EC";
  kid: string;
  use: "sig";
  alg: "ES256";
  crv: "P-256";
  x: string;
  y: string;
}

export interface SailPrivateJwk extends SailJwk {
  d: string;
}

export interface SailRegistryConfig {
  host: string;
  port: number;
  databaseUrl: string;
  stateBackend: RegistryStateBackend;
  registryId: string;
  name: string;
  apiUrl: string;
  authUrl: string;
  consoleUrl?: string;
  termsUrl: string;
  privacyUrl: string;
  trustStatus: SailTrustStatus;
  publicKeyPinning: boolean;
  publicKeys: SailJwk[];
  privateKey: SailPrivateJwk;
  signingKeySource: SigningKeySource;
  signingKeyFingerprint: string;
  signingKeyRotation: "off" | "rotate";
  blockPremiumNamesForLocal: boolean;
  mojangProfileApiUrl: string;
  mojangLookupTimeoutMs: number;
  premiumNamePositiveCacheSeconds: number;
  premiumNameNegativeCacheSeconds: number;
  devOAuthEnabled: boolean;
  discordOAuth: DiscordOAuthConfig;
  githubOAuth: GitHubOAuthConfig;
  googleOAuth: GoogleOAuthConfig;
  defaultServer: DefaultServerConfig;
}

export interface DefaultServerConfig {
  serverId: string;
  displayName: string;
  registryMode: ServerRegistryMode;
  allowedClaimTypes: DefaultServerAllowedClaimType[];
  sessionReusePolicy: ServerSessionReusePolicy;
  privacyMode: ServerPrivacyMode;
  publicListing: boolean;
}

export interface DiscordOAuthConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  userUrl: string;
}

export interface GitHubOAuthConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  userUrl: string;
}

export interface GoogleOAuthConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  userUrl: string;
}

type Env = Record<string, string | undefined>;

const defaultDevJwk: SailPrivateJwk = {
  kty: "EC",
  kid: "dev-es256-2026-06",
  use: "sig",
  alg: "ES256",
  crv: "P-256",
  x: "0WamuH-EnCrBXIQwPZo2ZKfwNV9OW9EDkzr4YzscxcY",
  y: "0wFxw0l_9Rziux_ZQboPeCkBi5oLibu_5GocXtVUURo",
  d: "cgltruyV9L4GvyWUauOeVmkPew0k1SQSc6HhAdzPAYM",
};

const serverIdPattern = /^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/;

function readString(env: Env, key: string, fallback: string): string {
  const value = env[key];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function readOptionalString(env: Env, key: string): string | undefined {
  const value = env[key];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalHttpUrl(env: Env, key: string): string | undefined {
  const value = readOptionalString(env, key);
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
    return url.toString().replace(/\/$/u, "");
  } catch {
    throw new Error(`${key} must be a valid http or https URL`);
  }
}

function readPort(env: Env, key: string, fallback: number): number {
  const rawValue = env[key];
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${key} must be an integer port between 1 and 65535`);
  }

  return parsed;
}

function readNonNegativeInteger(env: Env, key: string, fallback: number): number {
  const rawValue = env[key];
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }

  return parsed;
}

function readBoolean(env: Env, key: string, fallback: boolean): boolean {
  const rawValue = env[key];
  if (!rawValue) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(rawValue.toLowerCase())) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(rawValue.toLowerCase())) {
    return false;
  }

  throw new Error(`${key} must be a boolean value`);
}

function readTrustStatus(env: Env): SailTrustStatus {
  const value = readString(env, "SAIL_REGISTRY_TRUST_STATUS", "self_hosted");
  if (["global", "self_hosted", "trusted_by_admin", "unverified"].includes(value)) {
    return value as SailTrustStatus;
  }

  throw new Error("SAIL_REGISTRY_TRUST_STATUS is not a valid Sail trust status");
}

function readRegistryStateBackend(env: Env): RegistryStateBackend {
  const value = readString(env, "SAIL_REGISTRY_STATE_BACKEND", "memory");
  if (value === "memory" || value === "postgres") {
    return value;
  }

  throw new Error("SAIL_REGISTRY_STATE_BACKEND must be memory or postgres");
}

function readSigningKeySource(env: Env): SigningKeySource {
  const explicit = readOptionalString(env, "SAIL_REGISTRY_SIGNING_KEY_SOURCE");
  if (explicit) {
    if (explicit === "dev" || explicit === "env" || explicit === "file") {
      return explicit;
    }

    throw new Error("SAIL_REGISTRY_SIGNING_KEY_SOURCE must be dev, env, or file");
  }

  if (readOptionalString(env, "SAIL_REGISTRY_SIGNING_KEY_FILE")) {
    return "file";
  }

  if (
    readOptionalString(env, "SAIL_REGISTRY_JWK_KID") ||
    readOptionalString(env, "SAIL_REGISTRY_JWK_X") ||
    readOptionalString(env, "SAIL_REGISTRY_JWK_Y") ||
    readOptionalString(env, "SAIL_REGISTRY_JWK_D")
  ) {
    return "env";
  }

  return "dev";
}

function readRequiredSecretString(env: Env, key: string, source: SigningKeySource): string {
  const value = readOptionalString(env, key);
  if (!value) {
    throw new Error(`${key} is required when SAIL_REGISTRY_SIGNING_KEY_SOURCE=${source}`);
  }
  return value;
}

function readSigningKeyRotation(env: Env): "off" | "rotate" {
  const value = readString(env, "SAIL_REGISTRY_SIGNING_KEY_ROTATION", "off");
  if (value === "off" || value === "rotate") {
    return value;
  }

  throw new Error("SAIL_REGISTRY_SIGNING_KEY_ROTATION must be off or rotate");
}

function readSigningKeyConfig(
  env: Env,
  posture: { stateBackend: RegistryStateBackend; trustStatus: SailTrustStatus },
): { privateKey: SailPrivateJwk; source: SigningKeySource; fingerprint: string; rotation: "off" | "rotate" } {
  const source = readSigningKeySource(env);
  const allowDevSigningKey = readBoolean(env, "SAIL_REGISTRY_ALLOW_DEV_SIGNING_KEY", false);
  if (source === "dev" && (posture.trustStatus === "global" || env.NODE_ENV === "production")) {
    throw new Error("Sail Global and production registries cannot use the development signing key");
  }
  if (source === "dev" && posture.stateBackend === "postgres" && !allowDevSigningKey) {
    throw new Error("PostgreSQL registries must set a non-dev signing key source or explicitly allow the dev key");
  }

  let privateKey: SailPrivateJwk;
  if (source === "dev") {
    privateKey = defaultDevJwk;
  } else if (source === "env") {
    privateKey = requireSailPrivateJwk(
      {
        kty: "EC",
        kid: readRequiredSecretString(env, "SAIL_REGISTRY_JWK_KID", source),
        use: "sig",
        alg: "ES256",
        crv: "P-256",
        x: readRequiredSecretString(env, "SAIL_REGISTRY_JWK_X", source),
        y: readRequiredSecretString(env, "SAIL_REGISTRY_JWK_Y", source),
        d: readRequiredSecretString(env, "SAIL_REGISTRY_JWK_D", source),
      },
      "Sail env signing key",
    );
  } else {
    const path = readRequiredSecretString(env, "SAIL_REGISTRY_SIGNING_KEY_FILE", source);
    privateKey = requireSailPrivateJwk(
      readPrivateJsonSecretFile(path, readBoolean(env, "SAIL_REGISTRY_ALLOW_INSECURE_KEY_FILE", false)),
      "Sail file signing key",
    );
  }

  const publicKey = publicJwkFromPrivateJwk(privateKey);
  return {
    privateKey,
    source,
    fingerprint: fingerprintPublicJwk(publicKey),
    rotation: readSigningKeyRotation(env),
  };
}

function readServerId(env: Env): string {
  const value = readString(env, "SAIL_SERVER_ID", "local-survival");
  if (!serverIdPattern.test(value)) {
    throw new Error("SAIL_SERVER_ID must match Sail server id format");
  }
  return value;
}

function readServerDisplayName(env: Env): string {
  const value = readString(env, "SAIL_SERVER_DISPLAY_NAME", "Local Survival");
  if (value.length < 1 || value.length > 96) {
    throw new Error("SAIL_SERVER_DISPLAY_NAME must be between 1 and 96 characters");
  }
  return value;
}

function readServerRegistryMode(env: Env): ServerRegistryMode {
  const value = readString(env, "SAIL_SERVER_REGISTRY_MODE", "self_hosted");
  if (["global", "self_hosted", "hybrid"].includes(value)) {
    return value as ServerRegistryMode;
  }

  throw new Error("SAIL_SERVER_REGISTRY_MODE is not a valid Sail server registry mode");
}

function readServerSessionReusePolicy(env: Env): ServerSessionReusePolicy {
  const value = readString(env, "SAIL_SERVER_SESSION_REUSE_POLICY", "same_registry");
  if (["off", "same_registry", "allowlisted_servers", "global_trusted"].includes(value)) {
    return value as ServerSessionReusePolicy;
  }

  throw new Error("SAIL_SERVER_SESSION_REUSE_POLICY is not a valid Sail session reuse policy");
}

function readServerPrivacyMode(env: Env): ServerPrivacyMode {
  const value = readString(env, "SAIL_SERVER_PRIVACY_MODE", "minimal");
  if (["minimal", "standard", "audit_full"].includes(value)) {
    return value as ServerPrivacyMode;
  }

  throw new Error("SAIL_SERVER_PRIVACY_MODE is not a valid Sail server privacy mode");
}

function readDefaultServerConfig(env: Env): DefaultServerConfig {
  return {
    serverId: readServerId(env),
    displayName: readServerDisplayName(env),
    registryMode: readServerRegistryMode(env),
    allowedClaimTypes: ["LOCAL_SOFT"],
    sessionReusePolicy: readServerSessionReusePolicy(env),
    privacyMode: readServerPrivacyMode(env),
    publicListing: readBoolean(env, "SAIL_SERVER_PUBLIC_LISTING", false),
  };
}

export function loadRegistryConfig(env: Env = process.env): SailRegistryConfig {
  const host = readString(env, "SAIL_REGISTRY_HOST", "127.0.0.1");
  const port = readPort(env, "SAIL_REGISTRY_PORT", 8787);
  const apiUrl = readString(env, "SAIL_REGISTRY_API_URL", `http://${host}:${port}`);
  const consoleUrl = readOptionalHttpUrl(env, "SAIL_CONSOLE_URL");
  const discordOAuth = readDiscordOAuthConfig(env, apiUrl);
  const githubOAuth = readGitHubOAuthConfig(env, apiUrl);
  const googleOAuth = readGoogleOAuthConfig(env, apiUrl);
  const stateBackend = readRegistryStateBackend(env);
  const trustStatus = readTrustStatus(env);
  const signingKey = readSigningKeyConfig(env, { stateBackend, trustStatus });
  const publicKey = publicJwkFromPrivateJwk(signingKey.privateKey);

  return {
    host,
    port,
    databaseUrl: readString(
      env,
      "SAIL_REGISTRY_DATABASE_URL",
      "postgres://sail:sail_dev_password@127.0.0.1:15432/sail",
    ),
    stateBackend,
    registryId: readString(env, "SAIL_REGISTRY_ID", "sail-local"),
    name: readString(env, "SAIL_REGISTRY_NAME", "Sail Local Registry"),
    apiUrl,
    authUrl: readString(env, "SAIL_REGISTRY_AUTH_URL", `${apiUrl}/auth/minecraft`),
    ...(consoleUrl ? { consoleUrl } : {}),
    termsUrl: readString(env, "SAIL_REGISTRY_TERMS_URL", `${apiUrl}/terms`),
    privacyUrl: readString(env, "SAIL_REGISTRY_PRIVACY_URL", `${apiUrl}/privacy`),
    trustStatus,
    publicKeyPinning: readBoolean(env, "SAIL_REGISTRY_PUBLIC_KEY_PINNING", true),
    publicKeys: [publicKey],
    privateKey: signingKey.privateKey,
    signingKeySource: signingKey.source,
    signingKeyFingerprint: signingKey.fingerprint,
    signingKeyRotation: signingKey.rotation,
    blockPremiumNamesForLocal: readBoolean(env, "SAIL_BLOCK_PREMIUM_NAMES_FOR_LOCAL", true),
    mojangProfileApiUrl: readString(env, "SAIL_MOJANG_PROFILE_API_URL", "https://api.mojang.com"),
    mojangLookupTimeoutMs: readNonNegativeInteger(env, "SAIL_MOJANG_LOOKUP_TIMEOUT_MS", 2_500),
    premiumNamePositiveCacheSeconds: readNonNegativeInteger(env, "SAIL_PREMIUM_NAME_POSITIVE_CACHE_SECONDS", 86_400),
    premiumNameNegativeCacheSeconds: readNonNegativeInteger(env, "SAIL_PREMIUM_NAME_NEGATIVE_CACHE_SECONDS", 60),
    devOAuthEnabled: readBoolean(env, "SAIL_OAUTH_DEV_ENABLED", false),
    discordOAuth,
    githubOAuth,
    googleOAuth,
    defaultServer: readDefaultServerConfig(env),
  };
}

function readDiscordOAuthConfig(env: Env, apiUrl: string): DiscordOAuthConfig {
  const enabled = readBoolean(env, "SAIL_OAUTH_DISCORD_ENABLED", false);
  const clientId = readOptionalString(env, "SAIL_OAUTH_DISCORD_CLIENT_ID") ?? "";
  const clientSecret = readOptionalString(env, "SAIL_OAUTH_DISCORD_CLIENT_SECRET") ?? "";
  if (enabled && (!clientId || !clientSecret)) {
    throw new Error("Discord OAuth requires SAIL_OAUTH_DISCORD_CLIENT_ID and SAIL_OAUTH_DISCORD_CLIENT_SECRET");
  }

  return {
    enabled,
    clientId,
    clientSecret,
    redirectUri: readString(env, "SAIL_OAUTH_DISCORD_REDIRECT_URI", `${apiUrl}/auth/discord/callback`),
    authorizeUrl: readString(env, "SAIL_OAUTH_DISCORD_AUTHORIZE_URL", "https://discord.com/oauth2/authorize"),
    tokenUrl: readString(env, "SAIL_OAUTH_DISCORD_TOKEN_URL", "https://discord.com/api/oauth2/token"),
    userUrl: readString(env, "SAIL_OAUTH_DISCORD_USER_URL", "https://discord.com/api/users/@me"),
  };
}

function readGitHubOAuthConfig(env: Env, apiUrl: string): GitHubOAuthConfig {
  const enabled = readBoolean(env, "SAIL_OAUTH_GITHUB_ENABLED", false);
  const clientId = readOptionalString(env, "SAIL_OAUTH_GITHUB_CLIENT_ID") ?? "";
  const clientSecret = readOptionalString(env, "SAIL_OAUTH_GITHUB_CLIENT_SECRET") ?? "";
  if (enabled && (!clientId || !clientSecret)) {
    throw new Error("GitHub OAuth requires SAIL_OAUTH_GITHUB_CLIENT_ID and SAIL_OAUTH_GITHUB_CLIENT_SECRET");
  }

  return {
    enabled,
    clientId,
    clientSecret,
    redirectUri: readString(env, "SAIL_OAUTH_GITHUB_REDIRECT_URI", `${apiUrl}/auth/github/callback`),
    authorizeUrl: readString(env, "SAIL_OAUTH_GITHUB_AUTHORIZE_URL", "https://github.com/login/oauth/authorize"),
    tokenUrl: readString(env, "SAIL_OAUTH_GITHUB_TOKEN_URL", "https://github.com/login/oauth/access_token"),
    userUrl: readString(env, "SAIL_OAUTH_GITHUB_USER_URL", "https://api.github.com/user"),
  };
}

function readGoogleOAuthConfig(env: Env, apiUrl: string): GoogleOAuthConfig {
  const enabled = readBoolean(env, "SAIL_OAUTH_GOOGLE_ENABLED", false);
  const clientId = readOptionalString(env, "SAIL_OAUTH_GOOGLE_CLIENT_ID") ?? "";
  const clientSecret = readOptionalString(env, "SAIL_OAUTH_GOOGLE_CLIENT_SECRET") ?? "";
  if (enabled && (!clientId || !clientSecret)) {
    throw new Error("Google OAuth requires SAIL_OAUTH_GOOGLE_CLIENT_ID and SAIL_OAUTH_GOOGLE_CLIENT_SECRET");
  }

  return {
    enabled,
    clientId,
    clientSecret,
    redirectUri: readString(env, "SAIL_OAUTH_GOOGLE_REDIRECT_URI", `${apiUrl}/auth/google/callback`),
    authorizeUrl: readString(env, "SAIL_OAUTH_GOOGLE_AUTHORIZE_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
    tokenUrl: readString(env, "SAIL_OAUTH_GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
    userUrl: readString(env, "SAIL_OAUTH_GOOGLE_USER_URL", "https://www.googleapis.com/oauth2/v2/userinfo"),
  };
}
