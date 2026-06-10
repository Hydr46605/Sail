export interface StoredConsoleAuth {
  sessionToken: string;
  sessionId?: string;
}

const storageKey = "sail.console.auth.v1";

export function parseAuthCompleteHash(hash: string): StoredConsoleAuth | undefined {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const sessionToken = params.get("session_token");
  if (!sessionToken) {
    return undefined;
  }

  const sessionId = params.get("session_id") ?? undefined;
  return {
    sessionToken,
    ...(sessionId ? { sessionId } : {}),
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
        if (typeof value.sessionToken !== "string" || value.sessionToken.length === 0) {
          return undefined;
        }
        return {
          sessionToken: value.sessionToken,
          ...(typeof value.sessionId === "string" && value.sessionId.length > 0 ? { sessionId: value.sessionId } : {}),
        };
      } catch {
        return undefined;
      }
    },
    write(auth: StoredConsoleAuth): void {
      storage.setItem(storageKey, JSON.stringify(auth));
    },
    clear(): void {
      storage.removeItem(storageKey);
    },
  };
}
