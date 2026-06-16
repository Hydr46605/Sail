export function StatusPill(props: { status: string }) {
  return <span className={`status-pill status-${props.status.replaceAll("_", "-")}`}>{props.status}</span>;
}
