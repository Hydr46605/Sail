import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createSailConsoleApiClient } from "../api.js";
import type { RegisterServerInput, RegisterServerResponse } from "../types.js";
import { useConsoleRuntimeConfig } from "./useConsoleRuntimeConfig.js";

interface UseServerRegistrationReturn {
  register: (input: RegisterServerInput) => Promise<RegisterServerResponse>;
  isLoading: boolean;
  error: string | null;
  result: RegisterServerResponse | null;
  reset: () => void;
}

export function useServerRegistration(): UseServerRegistrationReturn {
  const { defaultRegistryUrl } = useConsoleRuntimeConfig();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterServerResponse | null>(null);

  const client = createSailConsoleApiClient({ baseUrl: defaultRegistryUrl });

  const mutation = useMutation({
    mutationFn: async (input: RegisterServerInput) => {
      const auth = JSON.parse(
        sessionStorage.getItem("sail.console.auth.v1") ?? "{}"
      );
      if (!auth.sessionToken) {
        throw new Error("Not authenticated");
      }
      return client.registerServer(auth.sessionToken, input);
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["console-profile"] });
    },
    onError: (err: Error) => {
      setError(err.message);
      setResult(null);
    },
  });

  return {
    register: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error,
    result,
    reset: () => {
      setError(null);
      setResult(null);
      mutation.reset();
    },
  };
}
