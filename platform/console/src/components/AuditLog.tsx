import { useEffect, useState } from "react";
import { createSailConsoleApiClient, SailConsoleApiError } from "../api.js";
import type { AuditEvent } from "../types.js";
import { formatDateTime } from "../utils/helpers.js";

const severityClass: Record<AuditEvent["severity"], string> = {
  info: "audit-severity-info",
  warning: "audit-severity-warning",
  high: "audit-severity-high",
  critical: "audit-severity-critical",
};

export function AuditLog(props: { sessionToken: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const client = createSailConsoleApiClient();
    client.getAuditEvents(props.sessionToken, 100)
      .then((data) => setEvents(Array.isArray(data) ? data : []))
      .catch((err) => {
        if (err instanceof SailConsoleApiError && err.status === 404) {
          setEvents([]);
          setUnavailable(true);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load audit events");
        }
      })
      .finally(() => setLoading(false));
  }, [props.sessionToken]);

  if (loading) {
    return <p className="console-copy">Loading audit events.</p>;
  }

  if (error) {
    return <p className="audit-error">{error}</p>;
  }

  if (unavailable) {
    return <p className="empty-state">Audit events are not available on this registry version.</p>;
  }

  return (
    <>
      {events.length === 0 ? (
        <p className="empty-state">No audit events recorded yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table audit-table">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Severity</th>
                <th scope="col">Details</th>
                <th scope="col">Time</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <th scope="row">
                    <code>{event.event_type}</code>
                  </th>
                  <td>
                    <span className={`audit-severity-pill ${severityClass[event.severity]}`}>
                      {event.severity}
                    </span>
                  </td>
                  <td>
                    <span className="audit-metadata">
                      {formatMetadata(event.metadata_json)}
                    </span>
                  </td>
                  <td>{formatDateTime(event.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function formatMetadata(meta: Record<string, unknown>): string {
  const entries = Object.entries(meta);
  if (entries.length === 0) return "-";
  return entries
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(", ");
}
