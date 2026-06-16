import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createSailConsoleApiClient } from "../api.js";
import { parseAuthCompleteHash, type StoredConsoleAuth } from "../auth.js";
import { UnauthenticatedPanel } from "../components/UnauthenticatedPanel.js";
import { ProfileDashboard } from "../components/ProfileDashboard.js";
import { useConsoleRuntimeConfig } from "../hooks/useConsoleRuntimeConfig.js";
import { consoleRouterBasePath, getConsoleHomePath } from "../utils/config.js";
import {
  isConsoleAuthError,
  isCurrentSessionRevoked,
  shouldClearAuthAfterRevoke,
} from "../utils/helpers.js";
import { clearStoredAuth, readStoredAuth, readStoredRegistryUrl, writeStoredAuth, writeStoredRegistryUrl } from "../utils/storage.js";

export function ConsoleHomeRoute() {
  const runtimeConfig = useConsoleRuntimeConfig();
  const queryClient = useQueryClient();
  const [registryUrl, setRegistryUrl] = useState(() => readStoredRegistryUrl(runtimeConfig));
  const [auth, setAuth] = useState<StoredConsoleAuth | undefined>(readStoredAuth);
  const effectiveRegistryUrl = runtimeConfig.registryLocked
    ? runtimeConfig.defaultRegistryUrl
    : registryUrl.trim() || runtimeConfig.defaultRegistryUrl;
  const client = useMemo(
    () => createSailConsoleApiClient({ baseUrl: effectiveRegistryUrl }),
    [effectiveRegistryUrl],
  );

  const profileQuery = useQuery({
    queryKey: ["console-profile", effectiveRegistryUrl, auth?.sessionToken],
    queryFn: () => {
      if (!auth) {
        throw new Error("Missing Sail session token");
      }
      return client.getConsoleProfile(auth.sessionToken);
    },
    enabled: Boolean(auth?.sessionToken),
    retry: false,
  });

  const revokeMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      if (!auth) {
        throw new Error("Missing Sail session token");
      }
      return client.revokeConsoleSession(auth.sessionToken, sessionId);
    },
    onSuccess: async (_result, sessionId) => {
      if (shouldClearAuthAfterRevoke(profileQuery.data, auth?.sessionId, sessionId)) {
        clearSessionAuth();
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: ["console-profile", effectiveRegistryUrl, auth?.sessionToken],
      });
    },
  });

  const authChallengeMutation = useMutation({
    mutationFn: (username: string) => client.createConsoleAuthChallenge({ username }),
  });

  const clearSessionAuth = () => {
    clearStoredAuth();
    setAuth(undefined);
    queryClient.removeQueries({ queryKey: ["console-profile"] });
  };

  const connectAuth = (nextAuth: StoredConsoleAuth) => {
    writeStoredAuth(nextAuth);
    setAuth(nextAuth);
  };

  useEffect(() => {
    if (
      (profileQuery.data && isCurrentSessionRevoked(profileQuery.data, auth?.sessionId)) ||
      isConsoleAuthError(profileQuery.error)
    ) {
      clearSessionAuth();
    }
  }, [auth?.sessionId, profileQuery.data, profileQuery.error]);

  const updateRegistryUrl = (nextUrl: string) => {
    if (runtimeConfig.registryLocked) {
      return;
    }

    setRegistryUrl(nextUrl);
    writeStoredRegistryUrl(nextUrl);
    authChallengeMutation.reset();
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextAuth = parseAuthCompleteHash(window.location.hash);
    if (!nextAuth) {
      return;
    }

    connectAuth(nextAuth);
    window.history.replaceState(null, "", getConsoleHomePath(consoleRouterBasePath));
  }, []);

  const logout = () => {
    clearSessionAuth();
  };

  if (!auth) {
    return (
      <main className="console-shell">
        <UnauthenticatedPanel
          registryUrl={registryUrl}
          defaultRegistryUrl={runtimeConfig.defaultRegistryUrl}
          registryLocked={runtimeConfig.registryLocked}
          authChallenge={authChallengeMutation.data}
          authChallengeError={authChallengeMutation.error}
          githubAuthUrl={
            authChallengeMutation.data
              ? `${effectiveRegistryUrl}/auth/github/login?code=${encodeURIComponent(authChallengeMutation.data.code)}`
              : undefined
          }
          isStartingAuth={authChallengeMutation.isPending}
          onRegistryUrlChange={updateRegistryUrl}
          onStartAuth={(username) => authChallengeMutation.mutate(username)}
          onImport={connectAuth}
        />
      </main>
    );
  }

  return (
    <main className="console-shell">
      <ProfileDashboard
        auth={auth}
        registryUrl={effectiveRegistryUrl}
        profile={profileQuery.data}
        profileError={profileQuery.error}
        revokeError={revokeMutation.error}
        revokingSessionId={revokeMutation.variables}
        isLoading={profileQuery.isLoading}
        isRefreshing={profileQuery.isFetching}
        isRevoking={revokeMutation.isPending}
        onLogout={logout}
        onRefresh={() => void profileQuery.refetch()}
        onRevoke={(sessionId) => revokeMutation.mutate(sessionId)}
      />
    </main>
  );
}
