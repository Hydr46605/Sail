import { CheckCircle2 } from "lucide-react";

export function SuccessBanner(props: { children: React.ReactNode }) {
  return (
    <div className="success-banner" role="status" aria-live="polite">
      <CheckCircle2 aria-hidden="true" size={18} />
      <span>{props.children}</span>
    </div>
  );
}
