import { useState } from "react";
import type { RegisterServerInput } from "../types.js";
import { Banner } from "./Banner.js";

interface ServerRegistrationFormProps {
  onSubmit: (input: RegisterServerInput) => void;
  isLoading: boolean;
  error?: string;
}

const SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/;

export function ServerRegistrationForm({
  onSubmit,
  isLoading,
  error,
}: ServerRegistrationFormProps) {
  const [serverId, setServerId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [serverIdError, setServerIdError] = useState<string | null>(null);

  const validateServerId = (value: string): string | null => {
    if (!value) {
      return "Server ID is required";
    } else if (!SERVER_ID_PATTERN.test(value)) {
      return "Server ID must be lowercase letters, numbers, hyphens, or underscores (3-64 chars)";
    }
    return null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const error = validateServerId(serverId);
    setServerIdError(error);
    if (error || !serverId || !displayName) return;
    onSubmit({ server_id: serverId, display_name: displayName });
  };

  return (
    <form onSubmit={handleSubmit} className="console-section">
      <h3 className="section-heading">Register New Server</h3>
      
      {error ? <Banner variant="error">{error}</Banner> : null}
      
      <div className="field-group">
        <label htmlFor="server-id" className="field-label">
          Server ID
        </label>
        <input
          id="server-id"
          type="text"
          className="field-input"
          value={serverId}
          onChange={(e) => setServerId(e.target.value.toLowerCase())}
          onBlur={() => setServerIdError(validateServerId(serverId))}
          placeholder="my-survival"
          pattern="[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]"
          required
        />
        {serverIdError && (
          <span className="field-error">{serverIdError}</span>
        )}
      </div>

      <div className="field-group">
        <label htmlFor="display-name" className="field-label">
          Display Name
        </label>
        <input
          id="display-name"
          type="text"
          className="field-input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="My Survival Server"
          minLength={1}
          maxLength={120}
          required
        />
      </div>

      <button
        type="submit"
        className="primary-button"
        disabled={isLoading || !serverId || !displayName}
      >
        {isLoading ? "Registering..." : "Register Server"}
      </button>
    </form>
  );
}
