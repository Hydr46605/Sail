import { useState } from "react";
import { Search } from "lucide-react";
import { createSailConsoleApiClient } from "../api.js";
import type { NameLookupResponse } from "../types.js";

export function NameLookup(props: {
  onClaim: (name: string) => void;
  isClaiming: boolean;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<NameLookupResponse | null>(null);
  const [isLooking, setIsLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    const name = query.trim();
    if (name.length < 3 || name.length > 16) return;

    setIsLooking(true);
    setError(null);
    setResult(null);

    try {
      const client = createSailConsoleApiClient();
      const lookupResult = await client.lookupName(name);
      setResult(lookupResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the Sail registry.");
    } finally {
      setIsLooking(false);
    }
  }

  const statusLabel = result ? {
    claimed: "Claimed",
    unclaimed: "Available",
    premium_reserved: "Premium name",
  }[result.status] : null;

  const statusClass = result ? {
    claimed: "name-status-claimed",
    unclaimed: "name-status-available",
    premium_reserved: "name-status-premium",
  }[result.status] : null;

  return (
    <div className="name-lookup">
      <form onSubmit={handleLookup} className="name-lookup-form">
        <label htmlFor="name-lookup-input" className="sr-only">Minecraft name</label>
        <input
          id="name-lookup-input"
          type="text"
          placeholder="Check a Minecraft name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          pattern="^[A-Za-z0-9_]{3,16}$"
          minLength={3}
          maxLength={16}
          required
        />
        <button type="submit" className="ghost-button" disabled={isLooking || query.trim().length < 3}>
          <Search aria-hidden="true" size={16} />
          {isLooking ? "Checking..." : "Check"}
        </button>
      </form>
      {error && <p className="name-lookup-error">{error}</p>}
      {result && (
        <div className="name-lookup-result">
          <div className="name-lookup-header">
            <strong>{result.display_name ?? result.canonical_name}</strong>
            <span className={`name-status-pill ${statusClass}`}>{statusLabel}</span>
            {result.premium_name && <span className="name-status-pill name-status-premium">Premium</span>}
          </div>
          {result.status === "claimed" && (
            <div className="name-lookup-details">
              <span>Claim type: {result.claim_type}</span>
              <span>Identity: {result.identity_type}</span>
              {result.issuer_registry_id && <span>Issuer: {result.issuer_registry_id}</span>}
            </div>
          )}
          {result.status === "unclaimed" && (
            <button
              className="primary-button"
              onClick={() => props.onClaim(result.canonical_name)}
              disabled={props.isClaiming}
            >
              {props.isClaiming ? "Claiming..." : "Claim this name"}
            </button>
          )}
          {result.status === "premium_reserved" && (
            <p className="name-lookup-note">
              This name belongs to a Mojang/Microsoft account. You must own the premium account to claim it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
