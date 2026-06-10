import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useNavigate,
} from "@tanstack/react-router";
import {
  Activity,
  ExternalLink,
  KeyRound,
  Link2,
  LogOut,
  Moon,
  RefreshCw,
  Server,
  ShieldCheck,
  Sun,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { createContext, type FormEvent, useContext, useEffect, useMemo, useState } from "react";
import { createSailConsoleApiClient, SailConsoleApiError } from "./api.js";
import { createSessionAuthStore, parseAuthCompleteHash, type StoredConsoleAuth } from "./auth.js";
import type { ConsoleAuthChallengeResponse, ConsoleLinkedProvider, ConsoleProfileResponse } from "./types.js";

const defaultRegistryUrl = "http://127.0.0.1:8787";
const registryUrlStorageKey = "sail.console.registry_url.v1";
const themeStorageKey = "sail.console.theme.v1";

type ConsoleSession = ConsoleProfileResponse["sessions"][number];
type ConsoleProviderLabel = Pick<ConsoleLinkedProvider, "provider" | "provider_username">;
type ThemeController = {
  theme: ConsoleTheme;
  toggleTheme: () => void;
};

export type ConsoleTheme = "light" | "dark";

const ThemeContext = createContext<ThemeController | undefined>(undefined);

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

export function formatProviderLabel(provider: ConsoleProviderLabel): string {
  return provider.provider_username ? `${provider.provider} / ${provider.provider_username}` : provider.provider;
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

const rootRoute = createRootRoute({
  component: ConsoleRoot,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ConsoleHomeRoute,
});

const authCompleteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/complete",
  component: AuthCompleteRoute,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, authCompleteRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  const [theme, setTheme] = useState(readStoredTheme);

  useEffect(() => {
    applyConsoleTheme(theme);
    writeStoredTheme(theme);
  }, [theme]);

  const themeController = useMemo<ThemeController>(() => ({
    theme,
    toggleTheme: () => setTheme((currentTheme) => getNextThemePreference(currentTheme)),
  }), [theme]);

  return (
    <ThemeContext.Provider value={themeController}>
      <RouterProvider router={router} />
    </ThemeContext.Provider>
  );
}

function ConsoleRoot() {
  return <Outlet />;
}

function AuthCompleteRoute() {
  const navigate = useNavigate();

  useEffect(() => {
    const auth = parseAuthCompleteHash(window.location.hash);
    if (auth) {
      writeStoredAuth(auth);
    }

    window.history.replaceState(null, "", "/");
    void navigate({ to: "/", replace: true });
  }, [navigate]);

  return (
    <main className="console-shell">
      <section className="console-panel compact-panel" aria-live="polite">
        <div className="console-kicker">
          <ShieldCheck aria-hidden="true" size={18} />
          <span>Authentication complete</span>
        </div>
        <h1>Sail Console</h1>
        <p className="console-copy">Loading session.</p>
      </section>
    </main>
  );
}

function ConsoleHomeRoute() {
  const queryClient = useQueryClient();
  const [registryUrl, setRegistryUrl] = useState(readStoredRegistryUrl);
  const [auth, setAuth] = useState<StoredConsoleAuth | undefined>(readStoredAuth);
  const effectiveRegistryUrl = registryUrl.trim() || defaultRegistryUrl;
  const client = useMemo(
    () => createSailConsoleApiClient({ baseUrl: effectiveRegistryUrl }),
    [effectiveRegistryUrl],
  );

  const profileQuery = useQuery({
    queryKey: ["console-profile", effectiveRegistryUrl, auth?.sessionToken],
    queryFn: () => {
      if (!auth) {
        throw new Error("Missing Sail session token");
      }
      return client.getConsoleProfile(auth.sessionToken);
    },
    enabled: Boolean(auth?.sessionToken),
    retry: false,
  });

  const revokeMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      if (!auth) {
        throw new Error("Missing Sail session token");
      }
      return client.revokeConsoleSession(auth.sessionToken, sessionId);
    },
    onSuccess: async (_result, sessionId) => {
      if (shouldClearAuthAfterRevoke(profileQuery.data, auth?.sessionId, sessionId)) {
        clearSessionAuth();
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: ["console-profile", effectiveRegistryUrl, auth?.sessionToken],
      });
    },
  });

  const authChallengeMutation = useMutation({
    mutationFn: (username: string) => client.createConsoleAuthChallenge({ username }),
  });

  const clearSessionAuth = () => {
    clearStoredAuth();
    setAuth(undefined);
    queryClient.removeQueries({ queryKey: ["console-profile"] });
  };

  useEffect(() => {
    if (
      (profileQuery.data && isCurrentSessionRevoked(profileQuery.data, auth?.sessionId)) ||
      isConsoleAuthError(profileQuery.error)
    ) {
      clearSessionAuth();
    }
  }, [auth?.sessionId, profileQuery.data, profileQuery.error]);

  const updateRegistryUrl = (nextUrl: string) => {
    setRegistryUrl(nextUrl);
    writeStoredRegistryUrl(nextUrl);
    authChallengeMutation.reset();
  };

  const connectAuth = (nextAuth: StoredConsoleAuth) => {
    writeStoredAuth(nextAuth);
    setAuth(nextAuth);
  };

  const logout = () => {
    clearSessionAuth();
  };

  if (!auth) {
    return (
      <main className="console-shell">
        <UnauthenticatedPanel
          registryUrl={registryUrl}
          authChallenge={authChallengeMutation.data}
          authChallengeError={authChallengeMutation.error}
          isStartingAuth={authChallengeMutation.isPending}
          onRegistryUrlChange={updateRegistryUrl}
          onStartAuth={(username) => authChallengeMutation.mutate(username)}
          onImport={connectAuth}
        />
      </main>
    );
  }

  return (
    <main className="console-shell">
      <ProfileDashboard
        auth={auth}
        registryUrl={effectiveRegistryUrl}
        profile={profileQuery.data}
        profileError={profileQuery.error}
        revokeError={revokeMutation.error}
        revokingSessionId={revokeMutation.variables}
        isLoading={profileQuery.isLoading}
        isRefreshing={profileQuery.isFetching}
        isRevoking={revokeMutation.isPending}
        onLogout={logout}
        onRefresh={() => void profileQuery.refetch()}
        onRevoke={(sessionId) => revokeMutation.mutate(sessionId)}
      />
    </main>
  );
}

function UnauthenticatedPanel(props: {
  registryUrl: string;
  authChallenge: ConsoleAuthChallengeResponse | undefined;
  authChallengeError: unknown;
  isStartingAuth: boolean;
  onRegistryUrlChange: (registryUrl: string) => void;
  onStartAuth: (username: string) => void;
  onImport: (auth: StoredConsoleAuth) => void;
}) {
  const [minecraftName, setMinecraftName] = useState("");
  const normalizedName = minecraftName.trim();
  const canStartAuth = /^[A-Za-z0-9_]{3,16}$/u.test(normalizedName);
  const hasAuthChallenge = Boolean(props.authChallenge);
  const isChallengeActive = hasAuthChallenge || props.isStartingAuth || canStartAuth;
  const currentAuthStep = hasAuthChallenge ? "browser" : isChallengeActive ? "challenge" : "name";
  const authStepLabel = getAuthStepLabel(isChallengeActive, hasAuthChallenge);
  const authProgressSteps = [
    { key: "name", label: "1 Name", active: true },
    { key: "challenge", label: "2 Challenge", active: isChallengeActive },
    { key: "browser", label: "3 Browser", active: hasAuthChallenge },
  ];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canStartAuth || props.isStartingAuth) {
      return;
    }

    props.onStartAuth(normalizedName);
  };

  return (
    <div className="console-entry">
      <section className="console-panel compact-panel auth-panel" aria-labelledby="console-title">
        <div className="console-kicker">
          <UserPlus aria-hidden="true" size={18} />
          <span>Local registry connection</span>
        </div>
        <h1 id="console-title">Sail Console</h1>
        <p className="console-copy">
          Connect to the configured registry and create a local name authentication challenge.
        </p>
        <ol className="login-state-row" aria-label="Authentication progress">
          {authProgressSteps.map((step) => (
            <li
              key={step.key}
              aria-current={currentAuthStep === step.key ? "step" : undefined}
              aria-label={`${step.label} ${step.active ? "active" : "pending"}`}
              className={`status-pill ${step.active ? "status-active" : "status-pending"}`}
            >
              {step.label}
            </li>
          ))}
        </ol>
        <p className="flow-hint" aria-live="polite">{authStepLabel}</p>
        <p className="console-copy">Pick the Minecraft name you want to use with Sail, then continue with Discord.</p>
        <form className="onboarding-form" onSubmit={submit}>
          <label className="field-label">
            <span>Minecraft name</span>
            <input
              autoComplete="username"
              inputMode="text"
              maxLength={16}
              pattern="[A-Za-z0-9_]{3,16}"
              type="text"
              value={minecraftName}
              onChange={(event) => setMinecraftName(event.target.value)}
            />
          </label>
          <div className="auth-actions">
            <button type="submit" className="primary-button" disabled={!canStartAuth || props.isStartingAuth}>
              <UserPlus aria-hidden="true" size={18} />
              <span>{props.isStartingAuth ? "Starting auth" : "Start auth"}</span>
            </button>
            <ThemeSwitch />
          </div>
        </form>
        {props.authChallenge ? (
          <div className="next-step-panel" aria-live="polite">
            <div>
              <span className="status-pill status-pending">Discord ready</span>
              <p className="console-copy">
                {props.authChallenge.requested_name} is ready for Sail OAuth.
              </p>
            </div>
            <a className="primary-button" href={props.authChallenge.auth_url}>
              <ExternalLink aria-hidden="true" size={18} />
              <span>Continue with Discord</span>
            </a>
          </div>
        ) : null}
        {props.authChallengeError ? <ErrorBanner error={props.authChallengeError} /> : null}
        <details className="developer-tools">
          <summary>Developer tools</summary>
          <div className="developer-tools-body">
            <label className="field-label">
              <span>Registry URL</span>
              <input
                type="url"
                value={props.registryUrl}
                placeholder={defaultRegistryUrl}
                onChange={(event) => props.onRegistryUrlChange(event.target.value)}
              />
            </label>
            <TokenImportDialog onImport={props.onImport} />
          </div>
        </details>
      </section>
    </div>
  );
}

function TokenImportDialog(props: { onImport: (auth: StoredConsoleAuth) => void }) {
  const [open, setOpen] = useState(false);
  const [sessionToken, setSessionToken] = useState("");
  const [sessionId, setSessionId] = useState("");
  const canSubmit = sessionToken.trim().length > 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    props.onImport({
      sessionToken: sessionToken.trim(),
      ...(sessionId.trim() ? { sessionId: sessionId.trim() } : {}),
    });
    setOpen(false);
    setSessionToken("");
    setSessionId("");
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="primary-button">
          <KeyRound aria-hidden="true" size={18} />
          <span>Import session</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-heading">
            <Dialog.Title>Import Sail session</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="icon-button" aria-label="Close">
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Import a Sail session token for local console testing.
          </Dialog.Description>
          <form className="dialog-form" onSubmit={submit}>
            <label className="field-label">
              <span>Session token</span>
              <input
                autoFocus
                type="password"
                value={sessionToken}
                onChange={(event) => setSessionToken(event.target.value)}
              />
            </label>
            <label className="field-label">
              <span>Session ID</span>
              <input
                type="text"
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="ghost-button">
                  Cancel
                </button>
              </Dialog.Close>
              <button type="submit" className="primary-button" disabled={!canSubmit}>
                <KeyRound aria-hidden="true" size={18} />
                <span>Connect</span>
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProfileDashboard(props: {
  auth: StoredConsoleAuth;
  registryUrl: string;
  profile: ConsoleProfileResponse | undefined;
  profileError: unknown;
  revokeError: unknown;
  revokingSessionId: string | undefined;
  isLoading: boolean;
  isRefreshing: boolean;
  isRevoking: boolean;
  onLogout: () => void;
  onRefresh: () => void;
  onRevoke: (sessionId: string) => void;
}) {
  const accountTitle = props.profile?.account.display_name ?? props.profile?.account.account_id ?? "Sail Console";

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <div className="console-kicker">
            <ShieldCheck aria-hidden="true" size={18} />
            <span>{props.registryUrl}</span>
          </div>
          <h1>{accountTitle}</h1>
          {props.profile ? (
            <p className="console-copy">
              <span>{props.profile.account.account_id}</span>
              <span aria-hidden="true"> · </span>
              <span>{getSessionHealthLabel(props.profile)}</span>
            </p>
          ) : (
            <p className="console-copy">Loading profile.</p>
          )}
        </div>
        <div className="toolbar">
          <ThemeSwitch />
          <button type="button" className="ghost-button" onClick={props.onRefresh} disabled={props.isRefreshing}>
            <RefreshCw aria-hidden="true" size={18} />
            <span>{props.isRefreshing ? "Refreshing" : "Refresh"}</span>
          </button>
          <button type="button" className="ghost-button" onClick={props.onLogout}>
            <LogOut aria-hidden="true" size={18} />
            <span>Log out</span>
          </button>
        </div>
      </header>

      {props.profileError ? <ErrorBanner error={props.profileError} /> : null}
      {props.revokeError ? <ErrorBanner error={props.revokeError} /> : null}

      {props.isLoading ? (
        <section className="console-panel compact-panel" aria-live="polite">
          <div className="console-kicker">
            <Activity aria-hidden="true" size={18} />
            <span>Profile</span>
          </div>
          <p className="console-copy">Loading profile.</p>
        </section>
      ) : props.profile ? (
        <DashboardContent
          auth={props.auth}
          profile={props.profile}
          revokingSessionId={props.revokingSessionId}
          isRevoking={props.isRevoking}
          onRevoke={props.onRevoke}
        />
      ) : null}
    </div>
  );
}

function DashboardContent(props: {
  auth: StoredConsoleAuth;
  profile: ConsoleProfileResponse;
  revokingSessionId: string | undefined;
  isRevoking: boolean;
  onRevoke: (sessionId: string) => void;
}) {
  return (
    <>
      <section className="console-section" aria-labelledby="account-heading">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Account</span>
            <h2 id="account-heading">Identity state</h2>
          </div>
          <StatusPill status={props.profile.account.status} />
        </div>
        <ul className="trust-summary" aria-label="Trust summary">
          <li><strong>{props.profile.names.length} active names</strong></li>
          <li><strong>{props.profile.trusted_servers.length} trusted servers</strong></li>
          <li><strong>{countActiveSessions(props.profile)} active sessions</strong></li>
        </ul>
        <div className="summary-grid">
          <Metric label="Account ID" value={props.profile.account.account_id} />
          <Metric label="Risk" value={props.profile.account.risk_level} />
          <Metric label="Names" value={String(props.profile.names.length)} />
          <Metric label="Sessions" value={String(countActiveSessions(props.profile))} />
        </div>
        <div className="provider-list" aria-label="Linked providers">
          {props.profile.account.linked_providers.length > 0 ? (
            props.profile.account.linked_providers.map((provider) => (
              <span key={`${provider.provider}:${provider.provider_username ?? "null"}`} className="provider-chip">
                <Link2 aria-hidden="true" size={14} />
                {formatProviderLabel(provider)}
              </span>
            ))
          ) : (
            <span className="empty-state">No linked providers</span>
          )}
        </div>
      </section>

      <section className="console-section" aria-labelledby="names-heading">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Names</span>
            <h2 id="names-heading">Claims</h2>
          </div>
          <KeyRound aria-hidden="true" size={20} />
        </div>
        <div className="table-scroll">
          <table className="data-table names-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Claim</th>
                <th scope="col">Identity</th>
                <th scope="col">UUID</th>
                <th scope="col">Issuer</th>
              </tr>
            </thead>
            <tbody>
              {props.profile.names.length > 0 ? (
                props.profile.names.map((name) => (
                  <tr key={name.name_claim_id}>
                    <th scope="row">
                      <strong>{name.display_name}</strong>
                    </th>
                    <td>{name.claim_type}</td>
                    <td>{name.identity_type}</td>
                    <td>
                      <code>{name.minecraft_uuid}</code>
                    </td>
                    <td>{name.issuer_registry_id}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="empty-state table-empty" colSpan={5}>No Minecraft names yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="console-section" aria-labelledby="sessions-heading">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Sessions</span>
            <h2 id="sessions-heading">Gateway access</h2>
          </div>
          <Activity aria-hidden="true" size={20} />
        </div>
        <div className="table-scroll">
          <table className="data-table sessions-table">
            <thead>
              <tr>
                <th scope="col">Server</th>
                <th scope="col">Status</th>
                <th scope="col">Expiry</th>
                <th scope="col">Current</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {props.profile.sessions.length > 0 ? (
                props.profile.sessions.map((session) => (
                  <SessionRow
                    key={session.session_id}
                    auth={props.auth}
                    session={session}
                    isRevoking={props.isRevoking && props.revokingSessionId === session.session_id}
                    onRevoke={props.onRevoke}
                  />
                ))
              ) : (
                <tr>
                  <td className="empty-state table-empty" colSpan={5}>No gateway sessions yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="console-section" aria-labelledby="servers-heading">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Servers</span>
            <h2 id="servers-heading">Trusted registry servers</h2>
          </div>
          <Server aria-hidden="true" size={20} />
        </div>
        <div className="server-list">
          {props.profile.trusted_servers.length > 0 ? (
            props.profile.trusted_servers.map((server) => (
              <article key={`${server.registry_id}:${server.server_id}`} className="server-card">
                <div>
                  <strong>{server.display_name}</strong>
                  <code>{server.server_id}</code>
                </div>
                <div className="server-meta">
                  <span>{server.registry_mode}</span>
                  <span>{server.session_reuse_policy}</span>
                  <span>{server.privacy_mode}</span>
                  <span>{server.public_listing ? "public" : "private"}</span>
                  <StatusPill status={server.status} />
                </div>
              </article>
            ))
          ) : (
            <span className="empty-state">No trusted servers</span>
          )}
        </div>
      </section>
    </>
  );
}

function ThemeSwitch() {
  const { theme, toggleTheme } = useConsoleTheme();
  const nextTheme = getNextThemePreference(theme);
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      className="ghost-button theme-button"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextTheme} theme`}
    >
      <Icon aria-hidden="true" size={18} />
      <span>{nextTheme === "dark" ? "Dark" : "Light"}</span>
    </button>
  );
}

function SessionRow(props: {
  auth: StoredConsoleAuth;
  session: ConsoleSession;
  isRevoking: boolean;
  onRevoke: (sessionId: string) => void;
}) {
  const isCurrent = props.session.current || props.auth.sessionId === props.session.session_id;
  const canRevoke = props.session.status !== "revoked";

  return (
    <tr>
      <th scope="row">
        <span className="session-cell">
        <strong>{props.session.server_display_name}</strong>
        <code>{props.session.session_id}</code>
        </span>
      </th>
      <td><StatusPill status={props.session.status} /></td>
      <td>{formatDateTime(props.session.expires_at)}</td>
      <td>{isCurrent ? <span className="current-pill">Current</span> : "-"}</td>
      <td>
        <button
          type="button"
          className="icon-button danger"
          title="Revoke session"
          aria-label={`Revoke ${props.session.session_id}`}
          disabled={!canRevoke || props.isRevoking}
          onClick={() => props.onRevoke(props.session.session_id)}
        >
          <Trash2 aria-hidden="true" size={17} />
        </button>
      </td>
    </tr>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function StatusPill(props: { status: string }) {
  return <span className={`status-pill status-${props.status.replaceAll("_", "-")}`}>{props.status}</span>;
}

function ErrorBanner(props: { error: unknown }) {
  return (
    <section className="error-banner" role="alert">
      <strong>Request failed</strong>
      <span>{formatError(props.error)}</span>
    </section>
  );
}

function formatError(error: unknown): string {
  if (error instanceof SailConsoleApiError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function formatDateTime(value: string | null): string {
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

function readStoredAuth(): StoredConsoleAuth | undefined {
  const storage = getSessionStorage();
  if (!storage) {
    return undefined;
  }
  return createSessionAuthStore(storage).read();
}

function writeStoredAuth(auth: StoredConsoleAuth): void {
  const storage = getSessionStorage();
  if (storage) {
    createSessionAuthStore(storage).write(auth);
  }
}

function clearStoredAuth(): void {
  const storage = getSessionStorage();
  if (storage) {
    createSessionAuthStore(storage).clear();
  }
}

function readStoredRegistryUrl(): string {
  const storage = getSessionStorage();
  const storedUrl = storage?.getItem(registryUrlStorageKey);
  return storedUrl && storedUrl.length > 0 ? storedUrl : defaultRegistryUrl;
}

function writeStoredRegistryUrl(registryUrl: string): void {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  if (registryUrl.trim().length === 0) {
    storage.removeItem(registryUrlStorageKey);
    return;
  }

  storage.setItem(registryUrlStorageKey, registryUrl);
}

function readStoredTheme(): ConsoleTheme {
  return normalizeThemePreference(getLocalStorage()?.getItem(themeStorageKey), readSystemThemePreference());
}

function writeStoredTheme(theme: ConsoleTheme): void {
  getLocalStorage()?.setItem(themeStorageKey, theme);
}

function readSystemThemePreference(): ConsoleTheme {
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function applyConsoleTheme(theme: ConsoleTheme): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function useConsoleTheme(): ThemeController {
  const themeController = useContext(ThemeContext);
  if (!themeController) {
    throw new Error("Sail Console theme context was not found");
  }
  return themeController;
}

function getSessionStorage(): Storage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.sessionStorage;
}

function getLocalStorage(): Storage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.localStorage;
}
