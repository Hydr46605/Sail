export interface StoredConsoleAuth {
  sessionToken: string;
  sessionId?: string;
}

const storageKey = "sail.console.auth.v1";

export function parseAuthCompleteHash(hash: string): StoredConsoleAuth | undefined {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const sessionToken = params.get("session_token")?.trim() ?? "";
  if (sessionToken.length === 0) {
    return undefined;
  }

  const sessionId = params.get("session_id")?.trim() ?? "";
  return {
    sessionToken,
    ...(sessionId.length > 0 ? { sessionId } : {}),
  };
}

export function createSessionAuthStore(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
  return {
    read(): StoredConsoleAuth | undefined {
      const raw = storage.getItem(storageKey);
      if (!raw) {
        return undefined;
      }

      try {
        const value = JSON.parse(raw) as Partial<StoredConsoleAuth>;
        const normalized = normalizeStoredAuth(value);
        if (!normalized) {
          return undefined;
        }
        return normalized;
      } catch {
        return undefined;
      }
    },
    write(auth: StoredConsoleAuth): void {
      const normalized = normalizeStoredAuth(auth);
      if (!normalized) {
        storage.removeItem(storageKey);
        return;
      }
      storage.setItem(storageKey, JSON.stringify(normalized));
    },
    clear(): void {
      storage.removeItem(storageKey);
    },
  };
}

function normalizeStoredAuth(auth: Partial<StoredConsoleAuth>): StoredConsoleAuth | undefined {
  const sessionToken = typeof auth.sessionToken === "string" ? auth.sessionToken.trim() : "";
  if (sessionToken.length === 0) {
    return undefined;
  }
  const sessionId = typeof auth.sessionId === "string" ? auth.sessionId.trim() : "";
  return {
    sessionToken,
    ...(sessionId.length > 0 ? { sessionId } : {}),
  };
}
