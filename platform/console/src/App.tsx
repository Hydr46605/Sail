import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ThemeContext, type ThemeController } from "./contexts/ThemeContext.js";
import { RuntimeConfigContext } from "./contexts/RuntimeConfigContext.js";
import { ConsoleRoot } from "./routes/ConsoleRoot.js";
import { AuthCompleteRoute } from "./routes/AuthCompleteRoute.js";
import { ConsoleHomeRoute } from "./routes/ConsoleHomeRoute.js";
import { getLocalStorage, readSystemThemePreference, applyConsoleTheme, writeStoredTheme } from "./utils/storage.js";
import { normalizeThemePreference, getNextThemePreference } from "./utils/helpers.js";
import {
  canonicalizeConsoleIndexPath,
  type ConsoleRuntimeConfig,
  type ConsoleTheme,
  consoleRouterBasePath,
  consoleRuntimeConfig,
  themeStorageKey,
} from "./utils/config.js";

const rootRoute = createRootRoute({
  component: ConsoleRoot,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ConsoleHomeRoute,
});

const authCompleteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/complete",
  component: AuthCompleteRoute,
});

const router = createRouter({
  basepath: consoleRouterBasePath,
  routeTree: rootRoute.addChildren([indexRoute, authCompleteRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function readStoredTheme(): ConsoleTheme {
  return normalizeThemePreference(getLocalStorage()?.getItem(themeStorageKey), readSystemThemePreference());
}

export function App(props: { runtimeConfig?: ConsoleRuntimeConfig } = {}) {
  canonicalizeConsoleIndexPath(consoleRouterBasePath);

  const [theme, setTheme] = useState(readStoredTheme);
  const runtimeConfig = props.runtimeConfig ?? consoleRuntimeConfig;

  useEffect(() => {
    applyConsoleTheme(theme);
    writeStoredTheme(theme);
  }, [theme]);

  const themeController = useMemo<ThemeController>(() => ({
    theme,
    toggleTheme: () => setTheme((currentTheme) => getNextThemePreference(currentTheme)),
  }), [theme]);

  return (
    <RuntimeConfigContext.Provider value={runtimeConfig}>
      <ThemeContext.Provider value={themeController}>
        <RouterProvider router={router} />
      </ThemeContext.Provider>
    </RuntimeConfigContext.Provider>
  );
}

export { countActiveSessions, formatError, formatProviderLabel, getAuthStepLabel, getNextThemePreference, getOperatorSummary, getSessionHealthLabel, isConsoleAuthError, isCurrentSessionRevoked, normalizeThemePreference, shouldClearAuthAfterRevoke } from "./utils/helpers.js";
export { getConsoleRuntimeConfig, getConsoleRouterBasePath } from "./utils/config.js";
