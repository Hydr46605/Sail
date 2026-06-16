import { useContext } from "react";
import { ThemeContext, type ThemeController } from "../contexts/ThemeContext.js";

export function useConsoleTheme(): ThemeController {
  const themeController = useContext(ThemeContext);
  if (!themeController) {
    throw new Error("Sail Console theme context was not found");
  }
  return themeController;
}
