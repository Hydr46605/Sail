import type { ConsoleProfileResponse } from "../types.js";
import { StatusPill } from "./StatusPill.js";

type TrustedServer = ConsoleProfileResponse["trusted_servers"][number];

interface ServerCardProps {
  server: TrustedServer;
  onViewApiKey?: () => void;
}

function heartbeatStatus(lastHeartbeatAt: string | null): { label: string; className: string } {
  if (!lastHeartbeatAt) {
    return { label: "No heartbeat", className: "heartbeat-unknown" };
  }
  const age = Date.now() - new Date(lastHeartbeatAt).getTime();
  if (age < 2 * 60 * 1000) {
    return { label: "Online", className: "heartbeat-online" };
  }
  if (age < 10 * 60 * 1000) {
    return { label: "Stale", className: "heartbeat-stale" };
  }
  return { label: "Offline", className: "heartbeat-offline" };
}

export function ServerCard({ server, onViewApiKey }: ServerCardProps) {
  const heartbeat = heartbeatStatus(server.last_heartbeat_at);
  return (
    <div className="server-card">
      <div>
        <h4>{server.display_name}</h4>
        <div className="server-card-pills">
          <StatusPill status={server.status} />
          <span className={`heartbeat-pill ${heartbeat.className}`}>{heartbeat.label}</span>
        </div>
      </div>
      <div className="server-meta">
        <span>Server ID: {server.server_id}</span>
        <span>Registry Mode: {server.registry_mode}</span>
        <span>Session Reuse: {server.session_reuse_policy}</span>
        <span>Privacy: {server.privacy_mode}</span>
        <span>Visibility: {server.public_listing ? "Public" : "Private"}</span>
      </div>
      {onViewApiKey && (
        <button className="ghost-button" onClick={onViewApiKey}>
          View API Key
        </button>
      )}
    </div>
  );
}
