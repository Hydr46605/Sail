import { type FormEvent, useState } from "react";
import { ExternalLink, UserPlus } from "lucide-react";
import type { ConsoleAuthChallengeResponse } from "../types.js";
import type { StoredConsoleAuth } from "../auth.js";
import { formatError, getAuthStepLabel } from "../utils/helpers.js";
import { Banner } from "./Banner.js";
import { ThemeSwitch } from "./ThemeSwitch.js";
import { TokenImportDialog } from "./TokenImportDialog.js";

export function UnauthenticatedPanel(props: {
  registryUrl: string;
  defaultRegistryUrl: string;
  registryLocked: boolean;
  authChallenge: ConsoleAuthChallengeResponse | undefined;
  authChallengeError: unknown;
  githubAuthUrl: string | undefined;
  googleAuthUrl: string | undefined;
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
            {props.githubAuthUrl ? (
              <a className="primary-button" href={props.githubAuthUrl} style={{ marginTop: "0.5rem" }}>
                <ExternalLink aria-hidden="true" size={18} />
                <span>Continue with GitHub</span>
              </a>
            ) : null}
            {props.googleAuthUrl ? (
              <a className="primary-button" href={props.googleAuthUrl} style={{ marginTop: "0.5rem" }}>
                <ExternalLink aria-hidden="true" size={18} />
                <span>Continue with Google</span>
              </a>
            ) : null}
          </div>
        ) : null}
        {props.authChallengeError ? <Banner variant="error">{formatError(props.authChallengeError)}</Banner> : null}
        {props.registryLocked ? null : (
          <details className="developer-tools">
            <summary>Developer tools</summary>
            <div className="developer-tools-body">
              <label className="field-label">
                <span>Registry URL</span>
                <input
                  type="url"
                  value={props.registryUrl}
                  placeholder={props.defaultRegistryUrl}
                  onChange={(event) => props.onRegistryUrlChange(event.target.value)}
                />
              </label>
              <TokenImportDialog onImport={props.onImport} />
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
