import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { parseAuthCompleteHash } from "../auth.js";
import { writeStoredAuth } from "../utils/storage.js";
import { getConsoleHomePath, consoleRouterBasePath } from "../utils/config.js";

export function AuthCompleteRoute() {
  const navigate = useNavigate();

  useEffect(() => {
    const auth = parseAuthCompleteHash(window.location.hash);
    if (auth) {
      writeStoredAuth(auth);
    }

    window.history.replaceState(null, "", getConsoleHomePath(consoleRouterBasePath));
    void navigate({ to: "/", replace: true });
  }, [navigate]);

  return (
    <main className="console-shell">
      <section className="console-panel compact-panel" aria-live="polite">
        <div className="console-kicker">
          <ShieldCheck aria-hidden="true" size={18} />
          <span>Authentication complete</span>
        </div>
        <h1>Sail Console</h1>
        <p className="console-copy">Loading session.</p>
      </section>
    </main>
  );
}
