import { createContext } from "react";
import type { ConsoleTheme } from "../utils/config.js";

export type ThemeController = {
  theme: ConsoleTheme;
  toggleTheme: () => void;
};

export const ThemeContext = createContext<ThemeController | undefined>(undefined);
