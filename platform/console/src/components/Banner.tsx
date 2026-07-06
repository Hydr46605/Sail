import { AlertCircle, CheckCircle2 } from "lucide-react";

type BannerVariant = "error" | "success";

export function Banner(props: { variant: BannerVariant; children: React.ReactNode }) {
  const isError = props.variant === "error";
  return (
    <div
      className={isError ? "error-banner" : "success-banner"}
      role={isError ? "alert" : "status"}
      aria-live={isError ? undefined : "polite"}
    >
      {isError ? (
        <AlertCircle aria-hidden="true" size={18} />
      ) : (
        <CheckCircle2 aria-hidden="true" size={18} />
      )}
      <span>{props.children}</span>
    </div>
  );
}
