import { readFileSync, statSync } from "node:fs";

export function readPrivateJsonSecretFile(path: string, allowInsecureFile: boolean): unknown {
  const stat = statSync(path);
  if (!stat.isFile()) {
    throw new Error("SAIL_REGISTRY_SIGNING_KEY_FILE must point to a regular file");
  }

  if (process.platform !== "win32" && !allowInsecureFile && (stat.mode & 0o077) !== 0) {
    throw new Error("SAIL_REGISTRY_SIGNING_KEY_FILE must not be readable by group or others");
  }

  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error("SAIL_REGISTRY_SIGNING_KEY_FILE must contain a valid JSON private JWK");
  }
}
