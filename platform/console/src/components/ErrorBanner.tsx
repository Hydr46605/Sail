import { formatError } from "../utils/helpers.js";

export function ErrorBanner(props: { error: unknown }) {
  return (
    <section className="error-banner" role="alert">
      <strong>Request failed</strong>
      <span>{formatError(props.error)}</span>
    </section>
  );
}
