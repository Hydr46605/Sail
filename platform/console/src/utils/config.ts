export const defaultRegistryUrl = "http://127.0.0.1:8787";
export const registryUrlStorageKey = "sail.console.registry_url.v1";
export const themeStorageKey = "sail.console.theme.v1";

import type { ConsoleLinkedProvider, ConsoleProfileResponse } from "../types.js";

export type ConsoleSession = ConsoleProfileResponse["sessions"][number];
export type ConsoleProviderLabel = Pick<ConsoleLinkedProvider, "provider" | "provider_username">;
export type ConsoleRuntimeEnv = Record<string, string | boolean | undefined>;
export type OperatorSummary = {
  activeSessionsLabel: string;
  inactiveSessionsLabel: string;
  activeServersLabel: string;
  reviewServersLabel: string;
  reusePoliciesLabel: string;
};
export type ConsoleRuntimeConfig = {
  defaultRegistryUrl: string;
  registryLocked: boolean;
};
export type ConsoleTheme = "light" | "dark";

export function getConsoleRuntimeConfig(env: ConsoleRuntimeEnv = readViteEnv()): ConsoleRuntimeConfig {
  return {
    defaultRegistryUrl: normalizeRegistryUrl(env.VITE_SAIL_CONSOLE_REGISTRY_URL, defaultRegistryUrl),
    registryLocked: env.VITE_SAIL_CONSOLE_LOCK_REGISTRY === true || env.VITE_SAIL_CONSOLE_LOCK_REGISTRY === "true",
  };
}

export function getConsoleRouterBasePath(pathname = readCurrentPathname()): string {
  const normalizedPath = pathname.replace(/\/index\.html$/u, "");
  const consoleMarker = "/console";
  const consoleIndex = normalizedPath.indexOf(consoleMarker);
  if (consoleIndex === -1) {
    return "/";
  }

  const endIndex = consoleIndex + consoleMarker.length;
  const nextCharacter = normalizedPath.at(endIndex);
  if (nextCharacter && nextCharacter !== "/") {
    return "/";
  }

  return normalizedPath.slice(0, endIndex) || "/";
}

export function canonicalizeConsoleIndexPath(basePath: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const homePath = getConsoleHomePath(basePath);
  if (window.location.pathname === `${basePath}/index.html`) {
    window.history.replaceState(null, "", `${homePath}${window.location.hash}`);
  }
}

export function getConsoleHomePath(basePath: string): string {
  return basePath === "/" ? "/" : `${basePath}/`;
}

function readCurrentPathname(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

function readViteEnv(): ConsoleRuntimeEnv {
  return (import.meta as ImportMeta & { env?: ConsoleRuntimeEnv }).env ?? {};
}

function normalizeRegistryUrl(value: string | boolean | undefined, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmedValue = value.trim().replace(/\/+$/u, "");
  return trimmedValue.length > 0 ? trimmedValue : fallback;
}

export const consoleRouterBasePath = getConsoleRouterBasePath();
export const consoleRuntimeConfig = getConsoleRuntimeConfig();
