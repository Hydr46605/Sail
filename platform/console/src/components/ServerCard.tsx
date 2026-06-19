import type { ConsoleProfileResponse } from "../types.js";
import { StatusPill } from "./StatusPill.js";

type TrustedServer = ConsoleProfileResponse["trusted_servers"][number];

interface ServerCardProps {
  server: TrustedServer;
  onViewApiKey?: () => void;
}

export function ServerCard({ server, onViewApiKey }: ServerCardProps) {
  return (
    <div className="server-card">
      <div>
        <h4>{server.display_name}</h4>
        <StatusPill status={server.status} />
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
