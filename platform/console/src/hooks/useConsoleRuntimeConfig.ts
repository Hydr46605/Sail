import { useContext } from "react";
import { RuntimeConfigContext } from "../contexts/RuntimeConfigContext.js";
import type { ConsoleRuntimeConfig } from "../utils/config.js";

export function useConsoleRuntimeConfig(): ConsoleRuntimeConfig {
  const runtimeConfig = useContext(RuntimeConfigContext);
  if (!runtimeConfig) {
    throw new Error("Sail Console runtime config was not found");
  }
  return runtimeConfig;
}
