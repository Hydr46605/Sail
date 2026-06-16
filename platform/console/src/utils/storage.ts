import { createSessionAuthStore, type StoredConsoleAuth } from "../auth.js";
import type { ConsoleRuntimeConfig, ConsoleTheme } from "./config.js";
import { registryUrlStorageKey, themeStorageKey, consoleRuntimeConfig } from "./config.js";
import { normalizeThemePreference } from "./helpers.js";

export function readStoredAuth(): StoredConsoleAuth | undefined {
  const storage = getSessionStorage();
  if (!storage) {
    return undefined;
  }
  return createSessionAuthStore(storage).read();
}

export function writeStoredAuth(auth: StoredConsoleAuth): void {
  const storage = getSessionStorage();
  if (storage) {
    createSessionAuthStore(storage).write(auth);
  }
}

export function clearStoredAuth(): void {
  const storage = getSessionStorage();
  if (storage) {
    createSessionAuthStore(storage).clear();
  }
}

export function readStoredRegistryUrl(runtimeConfig: ConsoleRuntimeConfig = consoleRuntimeConfig): string {
  if (runtimeConfig.registryLocked) {
    return runtimeConfig.defaultRegistryUrl;
  }

  const storage = getSessionStorage();
  const storedUrl = storage?.getItem(registryUrlStorageKey);
  return storedUrl && storedUrl.length > 0 ? storedUrl : runtimeConfig.defaultRegistryUrl;
}

export function writeStoredRegistryUrl(registryUrl: string): void {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  if (registryUrl.trim().length === 0) {
    storage.removeItem(registryUrlStorageKey);
    return;
  }

  storage.setItem(registryUrlStorageKey, registryUrl);
}

export function writeStoredTheme(theme: ConsoleTheme): void {
  getLocalStorage()?.setItem(themeStorageKey, theme);
}

export function readSystemThemePreference(): ConsoleTheme {
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export function applyConsoleTheme(theme: ConsoleTheme): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function getSessionStorage(): Storage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.sessionStorage;
}

export function getLocalStorage(): Storage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.localStorage;
}
