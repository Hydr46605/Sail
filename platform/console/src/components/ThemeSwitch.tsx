import { Moon, Sun } from "lucide-react";
import { useConsoleTheme } from "../hooks/useConsoleTheme.js";
import { getNextThemePreference } from "../utils/helpers.js";

export function ThemeSwitch() {
  const { theme, toggleTheme } = useConsoleTheme();
  const nextTheme = getNextThemePreference(theme);
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      className="ghost-button theme-button"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextTheme} theme`}
    >
      <Icon aria-hidden="true" size={18} />
      <span>{nextTheme === "dark" ? "Dark" : "Light"}</span>
    </button>
  );
}
