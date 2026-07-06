import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { createSailConsoleApiClient, SailConsoleApiError } from "../api.js";
import type { SigningKey } from "../types.js";
import { formatDateTime } from "../utils/helpers.js";

const statusClass: Record<string, string> = {
  active: "status-active",
  retiring: "status-pending",
  retired: "audit-severity-info",
  revoked: "status-revoked",
};

export function SigningKeys(props: { sessionToken: string }) {
  const [keys, setKeys] = useState<SigningKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [revokingKid, setRevokingKid] = useState<string | null>(null);
  const [confirmKid, setConfirmKid] = useState<string | null>(null);

  const fetchKeys = () => {
    const client = createSailConsoleApiClient();
    client.getSigningKeys(props.sessionToken)
      .then((data) => setKeys(Array.isArray(data) ? data : []))
      .catch((err) => {
        if (err instanceof SailConsoleApiError && err.status === 404) {
          setKeys([]);
          setUnavailable(true);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load signing keys");
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchKeys(); }, [props.sessionToken]);

  const handleRevoke = async (kid: string) => {
    setRevokingKid(kid);
    try {
      const client = createSailConsoleApiClient();
      await client.revokeSigningKey(props.sessionToken, kid);
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke key");
    } finally {
      setRevokingKid(null);
      setConfirmKid(null);
    }
  };

  if (loading) {
    return <p className="console-copy">Loading signing keys.</p>;
  }

  if (error) {
    return <p className="audit-error">{error}</p>;
  }

  if (unavailable) {
    return <p className="empty-state">Signing key management is not available on this registry version.</p>;
  }

  return (
    <>
      {keys.length === 0 ? (
        <p className="empty-state">No signing keys found.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table signing-keys-table">
            <thead>
              <tr>
                <th scope="col">Key ID</th>
                <th scope="col">Status</th>
                <th scope="col">Source</th>
                <th scope="col">Fingerprint</th>
                <th scope="col">Activated</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.kid}>
                  <th scope="row">
                    <code>{key.kid}</code>
                  </th>
                  <td>
                    <span className={`status-pill ${statusClass[key.status] ?? ""}`}>
                      {key.status}
                    </span>
                  </td>
                  <td>{key.source}</td>
                  <td>
                    <code>{key.fingerprint ? `${key.fingerprint.slice(0, 12)}...` : "-"}</code>
                  </td>
                  <td>{formatDateTime(key.activated_at)}</td>
                  <td>
                    {key.status !== "revoked" ? (
                      <Dialog.Root open={confirmKid === key.kid} onOpenChange={(open) => setConfirmKid(open ? key.kid : null)}>
                        <Dialog.Trigger asChild>
                          <button
                            type="button"
                            className="icon-button danger"
                            title="Revoke key"
                            aria-label={`Revoke key ${key.kid}`}
                            disabled={revokingKid === key.kid}
                          >
                            <Trash2 aria-hidden="true" size={17} />
                          </button>
                        </Dialog.Trigger>
                        <Dialog.Portal>
                          <Dialog.Overlay className="dialog-overlay" />
                          <Dialog.Content className="dialog-content confirm-dialog">
                            <Dialog.Title>Revoke signing key</Dialog.Title>
                            <Dialog.Description className="confirm-description">
                              Are you sure you want to revoke key <strong>{key.kid}</strong>?
                              Sessions signed with this key will remain valid until expiry,
                              but no new sessions can be issued with it.
                            </Dialog.Description>
                            <div className="dialog-actions">
                              <Dialog.Close asChild>
                                <button type="button" className="ghost-button">Cancel</button>
                              </Dialog.Close>
                              <button
                                type="button"
                                className="primary-button danger-fill"
                                disabled={revokingKid === key.kid}
                                onClick={() => handleRevoke(key.kid)}
                              >
                                {revokingKid === key.kid ? "Revoking..." : "Revoke key"}
                              </button>
                            </div>
                          </Dialog.Content>
                        </Dialog.Portal>
                      </Dialog.Root>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
