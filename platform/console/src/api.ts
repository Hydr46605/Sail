import type {
  ClaimCodeResponse,
  ConsoleAuthChallengeInput,
  ConsoleAuthChallengeResponse,
  ConsoleProfileResponse,
  NameLookupResponse,
  RegisterServerInput,
  RegisterServerResponse,
  SailErrorResponse,
  ServerDeregistrationResponse,
  SessionRevocationResponse,
} from "./types.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class SailConsoleApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SailConsoleApiError";
  }
}

export interface SailConsoleApiClient {
  createConsoleAuthChallenge(input: ConsoleAuthChallengeInput): Promise<ConsoleAuthChallengeResponse>;
  getConsoleProfile(sessionToken: string): Promise<ConsoleProfileResponse>;
  revokeConsoleSession(sessionToken: string, sessionId: string): Promise<SessionRevocationResponse>;
  registerServer(sessionToken: string, input: RegisterServerInput): Promise<RegisterServerResponse>;
  claimServerApiKey(claimCode: string): Promise<ClaimCodeResponse>;
  lookupName(name: string): Promise<NameLookupResponse>;
  deregisterServer(sessionToken: string, serverId: string): Promise<ServerDeregistrationResponse>;
}

export function createSailConsoleApiClient(options: {
  baseUrl?: string;
  fetchImpl?: FetchLike;
} = {}): SailConsoleApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? import.meta.env.VITE_SAIL_REGISTRY_API_URL ?? "");
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async createConsoleAuthChallenge(input: ConsoleAuthChallengeInput): Promise<ConsoleAuthChallengeResponse> {
      return requestJson(fetchImpl, `${baseUrl}/v1/console/auth-challenges`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });
    },
    async getConsoleProfile(sessionToken: string): Promise<ConsoleProfileResponse> {
      return requestJson(fetchImpl, `${baseUrl}/v1/console/me`, {
        sessionToken: requireSessionToken(sessionToken),
      });
    },
    async revokeConsoleSession(sessionToken: string, sessionId: string): Promise<SessionRevocationResponse> {
      return requestJson(fetchImpl, `${baseUrl}/v1/console/sessions/${encodeURIComponent(sessionId)}/revoke`, {
        method: "POST",
        sessionToken: requireSessionToken(sessionToken),
      });
    },
    async registerServer(sessionToken: string, input: RegisterServerInput): Promise<RegisterServerResponse> {
      return requestJson(fetchImpl, `${baseUrl}/v1/servers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        sessionToken: requireSessionToken(sessionToken),
        body: JSON.stringify(input),
      });
    },
    async claimServerApiKey(claimCode: string): Promise<ClaimCodeResponse> {
      return requestJson(fetchImpl, `${baseUrl}/v1/servers/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ claim_code: claimCode }),
      });
    },
    async lookupName(name: string): Promise<NameLookupResponse> {
      return requestJson(fetchImpl, `${baseUrl}/v1/names/${encodeURIComponent(name)}`);
    },
    async deregisterServer(sessionToken: string, serverId: string): Promise<ServerDeregistrationResponse> {
      return requestJson(fetchImpl, `${baseUrl}/v1/servers/${encodeURIComponent(serverId)}/deregister`, {
        method: "POST",
        sessionToken: requireSessionToken(sessionToken),
      });
    },
  };
}

function requireSessionToken(sessionToken: string): string {
  const normalized = sessionToken.trim();
  if (normalized.length === 0) {
    throw new SailConsoleApiError(401, "missing_session_token", "Missing Sail session token");
  }
  return normalized;
}

async function requestJson<T>(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit & { sessionToken?: string } = {},
): Promise<T> {
  const { sessionToken, ...requestInit } = init;
  const response = await fetchImpl(url, {
    ...requestInit,
    headers: {
      Accept: "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...requestInit.headers,
    },
  });
  const body = await readResponseJson(response) as T | SailErrorResponse | undefined;
  if (!response.ok) {
    const error = isSailErrorResponse(body)
      ? body.error
      : {
          code: `http_${response.status}`,
          message: `Sail Console API request failed with HTTP ${response.status}`,
        };
    throw new SailConsoleApiError(response.status, error.code, error.message);
  }
  return body as T;
}

async function readResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (!response.ok) {
      return undefined;
    }
    throw error;
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/u, "");
}

function isSailErrorResponse(value: unknown): value is SailErrorResponse {
  return (
    typeof value === "object"
    && value !== null
    && "error" in value
    && typeof (value as SailErrorResponse).error?.code === "string"
    && typeof (value as SailErrorResponse).error?.message === "string"
  );
}
