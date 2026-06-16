import { ShieldCheck, ExternalLink, Server, Activity, Link2, UserPlus } from "lucide-react";
import { ThemeSwitch } from "./ThemeSwitch.js";

const features = [
  {
    icon: ShieldCheck,
    title: "Identity-based auth",
    description: "Verify your Minecraft identity through Discord or GitHub and carry it across servers.",
  },
  {
    icon: Server,
    title: "Server trust",
    description: "Build a trusted network of servers that recognise your identity across the network.",
  },
  {
    icon: Activity,
    title: "Session management",
    description: "Review and revoke gateway sessions from any trusted Sail server at any time.",
  },
  {
    icon: Link2,
    title: "Multi-provider linking",
    description: "Link multiple social accounts to a single Sail identity for flexible authentication.",
  },
  {
    icon: UserPlus,
    title: "Premium name claims",
    description: "Claim and manage Minecraft names through verified Mojang authentication.",
  },
];

export function GetStartedPage(props: { onGetStarted: () => void }) {
  return (
    <main className="console-shell">
      <section className="console-panel compact-panel" style={{ textAlign: "center", marginTop: "3rem" }}>
        <div className="console-kicker" style={{ justifyContent: "center" }}>
          <ShieldCheck aria-hidden="true" size={20} />
          <span>Sail</span>
        </div>
        <h1 style={{ fontSize: "2.8rem", marginBottom: "0.25rem", letterSpacing: "-0.03em" }}>
          Your identity across servers
        </h1>
        <p className="console-copy" style={{ margin: "0 auto", fontSize: "1.05rem" }}>
          Sail gives you a portable Minecraft identity. Authenticate once, play everywhere,
          and carry your name claims, sessions, and server trust with you.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "12px",
            margin: "32px 0",
            textAlign: "left",
          }}
        >
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <article
                key={feature.title}
                style={{
                  border: "1px solid var(--console-line)",
                  borderRadius: "8px",
                  padding: "16px",
                  background: "var(--console-panel-soft)",
                  display: "grid",
                  gap: "8px",
                }}
              >
                <div className="console-kicker">
                  <Icon aria-hidden="true" size={18} />
                  <span>{feature.title}</span>
                </div>
                <p className="console-copy" style={{ fontSize: "0.9rem" }}>{feature.description}</p>
              </article>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "12px",
            marginTop: "8px",
          }}
        >
          <button type="button" className="primary-button" onClick={props.onGetStarted} style={{ padding: "12px 28px", fontSize: "1.05rem" }}>
            <ExternalLink aria-hidden="true" size={20} />
            <span>Get Started</span>
          </button>
          <ThemeSwitch />
        </div>
      </section>
    </main>
  );
}
