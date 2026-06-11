import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import process from "node:process";

const root = process.cwd();

const ignoredTopLevelDirs = new Set([
  ".git",
  ".gradle",
  ".just",
  ".pnpm-store",
  ".sail-smoke",
  ".sail-ui-run",
  "node_modules",
]);

const allowedExact = new Set(["platform/registry/.env.example"]);

const blockedExactNames = new Set([".env"]);

const blockedDirNames = new Set([
  ".sail-private",
  "secrets",
  "runtime",
]);

const blockedSuffixes = [
  ".env",
  ".local.md",
  ".pem",
  ".key",
  ".p8",
  ".p12",
  ".jwk",
  ".map",
];

const blockedContains = ["private-deploy"];

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const present = [];
walk(root, present);

const violations = [];
for (const file of [...new Set([...tracked, ...present])]) {
  if (allowedExact.has(file)) {
    continue;
  }
  if (isBlocked(file)) {
    violations.push(file);
  }
}

if (violations.length > 0) {
  console.error(
    "Sail public hygiene check failed. These local/private files must not be present in the public repository:",
  );
  for (const file of violations.sort()) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log("Sail public hygiene check passed.");

function walk(dir, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    const local = normalize(relative(root, absolute));
    const top = local.split("/")[0];
    if (entry.isDirectory()) {
      if (ignoredTopLevelDirs.has(top)) {
        continue;
      }
      walk(absolute, files);
      continue;
    }
    if (entry.isFile()) {
      files.push(local);
    }
  }
}

function normalize(value) {
  return value.split(sep).join("/");
}

function isBlocked(file) {
  const parts = file.split("/");
  const name = parts[parts.length - 1] ?? file;
  if (blockedExactNames.has(name)) {
    return true;
  }
  if (name.startsWith(".env.")) {
    return true;
  }
  if (parts.some((part) => blockedDirNames.has(part))) {
    return true;
  }
  if (blockedSuffixes.some((suffix) => name.endsWith(suffix))) {
    return true;
  }
  return blockedContains.some((snippet) => file.toLowerCase().includes(snippet));
}
