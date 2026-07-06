import { useState } from "react";
import { Activity, History, KeyRound, Link2, Server, ShieldCheck } from "lucide-react";
import type { StoredConsoleAuth } from "../auth.js";
import { createSailConsoleApiClient } from "../api.js";
import type { ConsoleProfileResponse } from "../types.js";
import { countActiveSessions, formatProviderLabel, getOperatorSummary } from "../utils/helpers.js";
import { AuditLog } from "./AuditLog.js";
import { Metric } from "./Metric.js";
import { NameLookup } from "./NameLookup.js";
import { ServerApiKeyDeliveryModal } from "./ServerApiKeyDeliveryModal.js";
import { ServerCard } from "./ServerCard.js";
import { ServerRegistrationForm } from "./ServerRegistrationForm.js";
import { SessionRow } from "./SessionRow.js";
import { SigningKeys } from "./SigningKeys.js";
import { StatusPill } from "./StatusPill.js";
import { useServerRegistration } from "../hooks/useServerRegistration.js";

export function DashboardContent(props: {
  auth: StoredConsoleAuth;
  profile: ConsoleProfileResponse;
  revokingSessionId: string | undefined;
  isRevoking: boolean;
  onRevoke: (sessionId: string) => void;
  deregisteringServerId: string | undefined;
  isDeregistering: boolean;
  onDeregister: (serverId: string) => void;
}) {
  const operatorSummary = getOperatorSummary(props.profile);
  const [showRegistrationForm, setShowRegistrationForm] = useState(false);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const { register, isLoading, error, result } = useServerRegistration();

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
        <div className="operator-summary-panel">
          <span className="section-kicker">Operator summary</span>
          <ul className="operator-summary" aria-label="Operator summary">
            <li>
              <span>Gateway sessions</span>
              <strong>{operatorSummary.activeSessionsLabel}</strong>
              <small>{operatorSummary.inactiveSessionsLabel}</small>
            </li>
            <li>
              <span>Server trust</span>
              <strong>{operatorSummary.activeServersLabel}</strong>
              <small>{operatorSummary.reviewServersLabel}</small>
            </li>
            <li>
              <span>Reuse policy</span>
              <strong>{operatorSummary.reusePoliciesLabel}</strong>
              <small>From trusted registry server records</small>
            </li>
          </ul>
        </div>
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
        <NameLookup
          onClaim={async (name) => {
            const client = createSailConsoleApiClient();
            const challenge = await client.createConsoleAuthChallenge({ username: name });
            window.open(challenge.auth_url, "_blank");
          }}
          isClaiming={false}
        />
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
          <div className="section-heading-actions">
            {props.profile.trusted_servers.length === 0 && !showRegistrationForm && (
              <button
                className="primary-button"
                onClick={() => setShowRegistrationForm(true)}
              >
                Register Server
              </button>
            )}
            <Server aria-hidden="true" size={20} />
          </div>
        </div>
        <div className="server-list">
          {props.profile.trusted_servers.length > 0 ? (
            props.profile.trusted_servers.map((server) => (
              <ServerCard
                key={`${server.registry_id}:${server.server_id}`}
                server={server}
                onDeregister={props.onDeregister}
                isDeregistering={props.isDeregistering && props.deregisteringServerId === server.server_id}
              />
            ))
          ) : (
            <span className="empty-state">No trusted servers</span>
          )}
        </div>
        {showRegistrationForm && (
          <ServerRegistrationForm
            onSubmit={async (input) => {
              await register(input);
              setShowRegistrationForm(false);
              setShowDeliveryModal(true);
            }}
            isLoading={isLoading}
            {...(error ? { error } : {})}
          />
        )}
        {result && (
          <ServerApiKeyDeliveryModal
            isOpen={showDeliveryModal}
            onClose={() => {
              setShowDeliveryModal(false);
            }}
            serverId={result.server_id}
            apiKey={result.api_key}
            claimCode={result.claim_code}
          />
        )}
      </section>

      <section className="console-section" aria-labelledby="signing-keys-heading">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Security</span>
            <h2 id="signing-keys-heading">Signing Keys</h2>
          </div>
          <ShieldCheck aria-hidden="true" size={20} />
        </div>
        <SigningKeys sessionToken={props.auth.sessionToken} />
      </section>

      <section className="console-section" aria-labelledby="audit-heading">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Audit</span>
            <h2 id="audit-heading">Activity Log</h2>
          </div>
          <History aria-hidden="true" size={20} />
        </div>
        <AuditLog sessionToken={props.auth.sessionToken} />
      </section>
    </>
  );
}
