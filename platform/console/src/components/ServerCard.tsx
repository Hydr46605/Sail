import type { ConsoleProfileResponse } from "../types.js";
import { StatusPill } from "./StatusPill.js";

type TrustedServer = ConsoleProfileResponse["trusted_servers"][number];

interface ServerCardProps {
  server: TrustedServer;
  onRegister?: () => void;
  onViewApiKey?: () => void;
}

export function ServerCard({ server, onRegister, onViewApiKey }: ServerCardProps) {
  return (
    <div className="server-card">
      <div className="server-card-header">
        <h4>{server.display_name}</h4>
        <StatusPill status={server.status} />
      </div>
      <div className="server-card-details">
        <span className="metric-label">Server ID</span>
        <span className="metric-value">{server.server_id}</span>
      </div>
      <div className="server-card-details">
        <span className="metric-label">Registry Mode</span>
        <span className="metric-value">{server.registry_mode}</span>
      </div>
      <div className="server-card-details">
        <span className="metric-label">Session Reuse</span>
        <span className="metric-value">{server.session_reuse_policy}</span>
      </div>
      <div className="server-card-details">
        <span className="metric-label">Privacy</span>
        <span className="metric-value">{server.privacy_mode}</span>
      </div>
      <div className="server-card-details">
        <span className="metric-label">Visibility</span>
        <span className="metric-value">{server.public_listing ? "Public" : "Private"}</span>
      </div>
      {onViewApiKey && (
        <button className="ghost-button" onClick={onViewApiKey}>
          View API Key
        </button>
      )}
    </div>
  );
}
