import { createContext } from "react";
import type { ConsoleRuntimeConfig } from "../utils/config.js";

export const RuntimeConfigContext = createContext<ConsoleRuntimeConfig | undefined>(undefined);
