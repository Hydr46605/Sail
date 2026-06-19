import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../src/App.js";
import { ServerCard } from "../src/components/ServerCard.js";
import type { ConsoleProfileResponse } from "../src/types.js";

function renderConsole(props?: { registryLocked?: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const appProps = props?.registryLocked ? {
    runtimeConfig: {
      defaultRegistryUrl: "https://api.sailmc.net",
      registryLocked: true,
    },
  } : {};

  render(
    <QueryClientProvider client={queryClient}>
      <App {...appProps} />
    </QueryClientProvider>,
  );
}

const emptyProfile: ConsoleProfileResponse = {
  protocol_version: "sail-protocol-v1",
  account: {
    account_id: "acct_empty",
    display_name: "Empty User",
    status: "active",
    risk_level: "low",
    linked_providers: [],
  },
  names: [],
  sessions: [],
  trusted_servers: [],
};

describe("Sail Console user flow UI", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    vi.stubGlobal("scrollTo", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function startGetStarted() {
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Get Started" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Get Started" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sail Console" })).toBeTruthy();
    });
  }

  test("shows the operational console entry before developer tools", async () => {
    renderConsole();
    await startGetStarted();
    expect(screen.getByText("Connect to the configured registry and create a local name authentication challenge."))
      .toBeTruthy();
    expect(screen.getByText("Enter a Minecraft name")).toBeTruthy();
    expect(screen.getByLabelText("Minecraft name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start auth" })).toBeTruthy();
    expect(screen.getByText("Developer tools")).toBeTruthy();
    expect(screen.queryByText("Mojang proves premium names. Sail proves local names.")).toBeNull();
    expect(screen.queryByRole("link", { name: /download/i })).toBeNull();
    expect(screen.queryByText("No Sail session connected.")).toBeNull();
  });

  test("hides developer tools when the console registry is locked", async () => {
    renderConsole({ registryLocked: true });
    await startGetStarted();
    expect(screen.queryByText("Developer tools")).toBeNull();
    expect(screen.queryByLabelText("Registry URL")).toBeNull();
    expect(screen.queryByRole("button", { name: "Import session" })).toBeNull();
  });

  test("creates a console auth challenge before continuing to Discord", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        protocol_version: "sail-protocol-v1",
        challenge_id: "ch_console",
        status: "pending",
        server_id: "local-survival",
        requested_name: "SailAlt03",
        mode: "kick",
        code: "ABCD-1234",
        auth_url: "http://127.0.0.1:8787/auth/minecraft?code=ABCD-1234",
        expires_at: "2026-06-08T10:00:00.000Z",
      }, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    renderConsole();
    await startGetStarted();

    fireEvent.change(screen.getByLabelText("Minecraft name"), {
      target: { value: "SailAlt03" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start auth" }));

    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
    const [, requestInit] = fetchImpl.mock.calls[0] ?? [];
    expect(requestInit).toMatchObject({
      method: "POST",
      body: JSON.stringify({ username: "SailAlt03" }),
    });
    await waitFor(() => {
      const link = screen.getByRole("link", { name: "Continue with Discord" });
      expect(link.getAttribute("href")).toBe("http://127.0.0.1:8787/auth/minecraft?code=ABCD-1234");
    });
    fireEvent.change(screen.getByLabelText("Minecraft name"), {
      target: { value: "" },
    });
    const authProgress = screen.getByRole("list", { name: "Authentication progress" });
    expect(within(authProgress).getByRole("listitem", { name: "2 Challenge active" })).toBeTruthy();
    expect(within(authProgress).getByRole("listitem", { name: "3 Browser active" })).toBeTruthy();
    expect(screen.getByText("Open the browser auth link")).toBeTruthy();
  });

  test("labels empty account setup states clearly", async () => {
    window.sessionStorage.setItem("sail.console.auth.v1", JSON.stringify({ sessionToken: "token" }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(emptyProfile)));

    renderConsole();

    await waitFor(() => {
      expect(screen.getByText("No Minecraft names yet")).toBeTruthy();
    });
    expect(screen.getByText("No active Sail sessions")).toBeTruthy();
    const trustSummary = screen.getByRole("list", { name: "Trust summary" });
    expect(within(trustSummary).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("0 active sessions")).toBeTruthy();
    expect(screen.getByText("No gateway sessions yet")).toBeTruthy();
  });

  test("ServerCard renders server details", () => {
    const server = {
      protocol_version: "sail-protocol-v1" as const,
      registry_id: "sail",
      server_id: "test-server",
      display_name: "Test Server",
      registry_mode: "self_hosted" as const,
      allowed_claim_types: ["SAIL_GLOBAL" as const],
      session_reuse_policy: "off" as const,
      privacy_mode: "minimal" as const,
      status: "active" as const,
      public_listing: false,
    };
    render(<ServerCard server={server} />);
    expect(screen.getByText("Test Server")).toBeDefined();
    expect(screen.getByText(/Server ID: test-server/)).toBeDefined();
    expect(screen.getByText(/active/)).toBeDefined();
  });

  test("renders operator coverage from sessions and trusted servers", async () => {
    const profile: ConsoleProfileResponse = {
      ...emptyProfile,
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
          registry_id: "sail",
          server_id: "local-survival",
          display_name: "Local Survival",
          registry_mode: "hybrid",
          allowed_claim_types: ["SAIL_GLOBAL", "LOCAL_SOFT"],
          session_reuse_policy: "same_registry",
          privacy_mode: "standard",
          status: "active",
          public_listing: false,
        },
        {
          protocol_version: "sail-protocol-v1",
          registry_id: "sail",
          server_id: "limbo",
          display_name: "Limbo",
          registry_mode: "global",
          allowed_claim_types: ["MINECRAFT_VERIFIED"],
          session_reuse_policy: "off",
          privacy_mode: "minimal",
          status: "disabled",
          public_listing: false,
        },
      ],
    };
    window.sessionStorage.setItem("sail.console.auth.v1", JSON.stringify({ sessionToken: "token" }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(profile)));

    renderConsole();

    await waitFor(() => {
      expect(screen.getByText("Operator summary")).toBeTruthy();
    });
    const operatorSummary = screen.getByRole("list", { name: "Operator summary" });
    expect(within(operatorSummary).getByText("1 active gateway session")).toBeTruthy();
    expect(within(operatorSummary).getByText("1 inactive session record")).toBeTruthy();
    expect(within(operatorSummary).getByText("1 active trusted server")).toBeTruthy();
    expect(within(operatorSummary).getByText("1 trusted server needs review")).toBeTruthy();
  });
});
