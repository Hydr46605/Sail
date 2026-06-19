import { describe, expect, test, vi } from "vitest";
import { createSailConsoleApiClient, SailConsoleApiError } from "../src/api.js";

describe("Sail console API client", () => {
  test("loads console profile with bearer authorization", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        protocol_version: "sail-protocol-v1",
        account: {
          account_id: "acct_123",
          display_name: "Example",
          status: "active",
          risk_level: "low",
          linked_providers: [],
        },
        names: [],
        sessions: [],
        trusted_servers: [],
      }),
    );
    const client = createSailConsoleApiClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl,
    });

    await expect(client.getConsoleProfile("token")).resolves.toMatchObject({
      protocol_version: "sail-protocol-v1",
      account: {
        account_id: "acct_123",
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8787/v1/console/me", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer token",
      },
    });
  });

  test("rejects blank session tokens before sending requests", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createSailConsoleApiClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl,
    });

    await expect(client.getConsoleProfile("  ")).rejects.toMatchObject({
      status: 401,
      code: "missing_session_token",
    } satisfies Partial<SailConsoleApiError>);
    await expect(client.revokeConsoleSession("", "sess_123")).rejects.toMatchObject({
      status: 401,
      code: "missing_session_token",
    } satisfies Partial<SailConsoleApiError>);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("creates a console auth challenge for Discord onboarding", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        protocol_version: "sail-protocol-v1",
        challenge_id: "ch_123",
        status: "pending",
        server_id: "local-survival",
        requested_name: "SailAlt03",
        mode: "kick",
        code: "ABCD-1234",
        auth_url: "http://127.0.0.1:8787/auth/minecraft?code=ABCD-1234",
        expires_at: "2026-06-08T10:00:00.000Z",
      }, { status: 201 }),
    );
    const client = createSailConsoleApiClient({
      baseUrl: "http://127.0.0.1:8787/",
      fetchImpl,
    });

    await expect(client.createConsoleAuthChallenge({ username: "SailAlt03" })).resolves.toMatchObject({
      requested_name: "SailAlt03",
      auth_url: "http://127.0.0.1:8787/auth/minecraft?code=ABCD-1234",
    });
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8787/v1/console/auth-challenges", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "SailAlt03" }),
    });
  });

  test("revokes a console session with bearer authorization", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        protocol_version: "sail-protocol-v1",
        session_id: "sess_123",
        status: "revoked",
        revoked_at: "2026-06-08T10:00:00.000Z",
      }),
    );
    const client = createSailConsoleApiClient({
      baseUrl: "http://127.0.0.1:8787/",
      fetchImpl,
    });

    await expect(client.revokeConsoleSession("token", "sess_123")).resolves.toMatchObject({
      session_id: "sess_123",
      status: "revoked",
    });
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8787/v1/console/sessions/sess_123/revoke", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer token",
      },
    });
  });

  test("throws Sail API errors with server error code", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        protocol_version: "sail-protocol-v1",
        error: {
          code: "session_revoked",
          message: "Session revoked",
          audience: "player",
          http_status: 403,
          retryable: true,
          correlation_id: "corr_123",
        },
      }, { status: 403 }),
    );
    const client = createSailConsoleApiClient({ fetchImpl });

    await expect(client.getConsoleProfile("token")).rejects.toMatchObject({
      status: 403,
      code: "session_revoked",
      message: "Session revoked",
    } satisfies Partial<SailConsoleApiError>);
  });

  test("throws fallback Sail API error for non-json error responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response("Internal Server Error", {
        status: 500,
        headers: {
          "content-type": "text/plain",
        },
      }),
    );
    const client = createSailConsoleApiClient({ fetchImpl });

    await expect(client.getConsoleProfile("token")).rejects.toMatchObject({
      status: 500,
      code: "http_500",
      message: "Sail Console API request failed with HTTP 500",
    } satisfies Partial<SailConsoleApiError>);
  });

  test("registerServer sends correct request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        protocol_version: "sail-protocol-v1",
        server_id: "my-server",
        display_name: "My Server",
        api_key: "eyJhbGciOiJFUzI1NiJ9...",
        claim_code: "a1b2c3d4e5f6g7h8",
      }),
    );
    const client = createSailConsoleApiClient({ fetchImpl });

    const result = await client.registerServer("test-token", {
      server_id: "my-server",
      display_name: "My Server",
    });

    expect(result.server_id).toBe("my-server");
    expect(result.display_name).toBe("My Server");
    expect(result.api_key).toBe("eyJhbGciOiJFUzI1NiJ9...");
    expect(result.claim_code).toBe("a1b2c3d4e5f6g7h8");
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/v1/servers"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      })
    );
  });

  test("registerServer rejects blank session tokens", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createSailConsoleApiClient({ fetchImpl });

    await expect(client.registerServer("  ", {
      server_id: "my-server",
      display_name: "My Server",
    })).rejects.toMatchObject({
      status: 401,
      code: "missing_session_token",
    } satisfies Partial<SailConsoleApiError>);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("claimServerApiKey sends correct request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        protocol_version: "sail-protocol-v1",
        api_key: "eyJhbGciOiJFUzI1NiJ9...",
        server_id: "my-server",
      }),
    );
    const client = createSailConsoleApiClient({ fetchImpl });

    const result = await client.claimServerApiKey("a1b2c3d4e5f6g7h8");

    expect(result.api_key).toBe("eyJhbGciOiJFUzI1NiJ9...");
    expect(result.server_id).toBe("my-server");
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/v1/servers/claim"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ claim_code: "a1b2c3d4e5f6g7h8" }),
      })
    );
  });

  test("claimServerApiKey throws Sail API errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        protocol_version: "sail-protocol-v1",
        error: {
          code: "invalid_claim_code",
          message: "Invalid claim code",
          audience: "developer",
          http_status: 404,
          retryable: false,
          correlation_id: "corr_456",
        },
      }, { status: 404 }),
    );
    const client = createSailConsoleApiClient({ fetchImpl });

    await expect(client.claimServerApiKey("invalid")).rejects.toMatchObject({
      status: 404,
      code: "invalid_claim_code",
      message: "Invalid claim code",
    } satisfies Partial<SailConsoleApiError>);
  });
});
