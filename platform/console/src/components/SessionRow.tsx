import { Trash2 } from "lucide-react";
import type { StoredConsoleAuth } from "../auth.js";
import type { ConsoleSession } from "../utils/config.js";
import { formatDateTime } from "../utils/helpers.js";
import { StatusPill } from "./StatusPill.js";

export function SessionRow(props: {
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
