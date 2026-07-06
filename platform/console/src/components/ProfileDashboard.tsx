import { Activity, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import type { StoredConsoleAuth } from "../auth.js";
import type { ConsoleProfileResponse } from "../types.js";
import { formatError, getSessionHealthLabel } from "../utils/helpers.js";
import { DashboardContent } from "./DashboardContent.js";
import { Banner } from "./Banner.js";
import { ThemeSwitch } from "./ThemeSwitch.js";

export function ProfileDashboard(props: {
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
  deregisterError: unknown;
  deregisteringServerId: string | undefined;
  isDeregistering: boolean;
  onDeregister: (serverId: string) => void;
  deregisterSuccessServerId: string | null;
  revokeSuccessSessionId: string | null;
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

      {props.profileError ? <Banner variant="error">{formatError(props.profileError)}</Banner> : null}
      {props.revokeError ? <Banner variant="error">{formatError(props.revokeError)}</Banner> : null}
      {props.deregisterError ? <Banner variant="error">{formatError(props.deregisterError)}</Banner> : null}
      {props.deregisterSuccessServerId ? (
        <Banner variant="success">Server <strong>{props.deregisterSuccessServerId}</strong> has been deregistered. Its API key has been revoked.</Banner>
      ) : null}
      {props.revokeSuccessSessionId ? (
        <Banner variant="success">Session <code>{props.revokeSuccessSessionId}</code> has been revoked.</Banner>
      ) : null}

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
          deregisteringServerId={props.deregisteringServerId}
          isDeregistering={props.isDeregistering}
          onDeregister={props.onDeregister}
        />
      ) : null}
    </div>
  );
}
