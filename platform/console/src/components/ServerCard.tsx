import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Trash2 } from "lucide-react";
import type { ConsoleProfileResponse } from "../types.js";
import { StatusPill } from "./StatusPill.js";

type TrustedServer = ConsoleProfileResponse["trusted_servers"][number];

interface ServerCardProps {
  server: TrustedServer;
  onViewApiKey?: () => void;
  onDeregister?: (serverId: string) => void;
  isDeregistering?: boolean;
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

export function ServerCard({ server, onViewApiKey, onDeregister, isDeregistering }: ServerCardProps) {
  const heartbeat = heartbeatStatus(server.last_heartbeat_at);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const canDeregister = onDeregister && server.status === "active";

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
      <div className="server-card-actions">
        {onViewApiKey && (
          <button className="ghost-button" onClick={onViewApiKey}>
            View API Key
          </button>
        )}
        {canDeregister && (
          <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
            <Dialog.Trigger asChild>
              <button
                type="button"
                className="ghost-button danger"
                disabled={isDeregistering}
              >
                <Trash2 aria-hidden="true" size={16} />
                Deregister
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay" />
              <Dialog.Content className="dialog-content confirm-dialog">
                <Dialog.Title>Deregister server</Dialog.Title>
                <Dialog.Description className="confirm-description">
                  Are you sure you want to deregister <strong>{server.display_name}</strong> ({server.server_id})?
                  This will immediately revoke the server&apos;s API key and disable it.
                  Players will not be able to authenticate through this server.
                </Dialog.Description>
                <div className="dialog-actions">
                  <Dialog.Close asChild>
                    <button type="button" className="ghost-button">
                      Cancel
                    </button>
                  </Dialog.Close>
                  <button
                    type="button"
                    className="primary-button danger-fill"
                    disabled={isDeregistering}
                    onClick={() => {
                      onDeregister(server.server_id);
                      setConfirmOpen(false);
                    }}
                  >
                    {isDeregistering ? "Deregistering..." : "Deregister server"}
                  </button>
                </div>
                <Dialog.Close asChild>
                  <button type="button" className="icon-button dialog-close-x" aria-label="Close">
                    <X size={16} />
                  </button>
                </Dialog.Close>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
      </div>
    </div>
  );
}
