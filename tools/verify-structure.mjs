import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

const requiredFiles = [
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "settings.gradle.kts",
  "build.gradle.kts",
  "gradle.properties",
  "justfile",
  "platform/registry/package.json",
  "platform/registry/tsconfig.json",
  "platform/console/package.json",
  "platform/console/tsconfig.json",
  "protocol/package.json",
  "protocol/tsconfig.json",
  "minecraft/gateway/build.gradle.kts",
  "minecraft/companion/build.gradle.kts",
];

const requiredDirs = [
  "platform/registry/src",
  "platform/registry/migrations",
  "platform/console/src",
  "minecraft/gateway/src/main/java",
  "minecraft/companion/src/main/java",
  "minecraft/companion/src/main/resources",
  "protocol/openapi",
  "protocol/schemas",
  "protocol/claims",
  "protocol/errors",
  "protocol/fixtures",
  "ops/local",
  "tools",
];

const errors = [];

for (const file of requiredFiles) {
  if (!existsSync(path.join(root, file))) {
    errors.push(`missing file: ${file}`);
  }
}

for (const dir of requiredDirs) {
  if (!existsSync(path.join(root, dir))) {
    errors.push(`missing directory: ${dir}`);
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(path.join(root, file), "utf8"));
}

if (existsSync(path.join(root, "package.json"))) {
  const rootPackage = readJson("package.json");
  if (rootPackage.name !== "@sail/root") {
    errors.push("root package name must be @sail/root");
  }
  if (rootPackage.private !== true) {
    errors.push("root package must be private");
  }
  for (const script of ["check", "test", "structure:check"]) {
    if (!rootPackage.scripts?.[script]) {
      errors.push(`root package missing script: ${script}`);
    }
  }
}

for (const [file, expectedName] of [
  ["platform/registry/package.json", "@sail/registry"],
  ["platform/console/package.json", "@sail/console"],
  ["protocol/package.json", "@sail/protocol"],
]) {
  if (!existsSync(path.join(root, file))) {
    continue;
  }
  const pkg = readJson(file);
  if (pkg.name !== expectedName) {
    errors.push(`${file} name must be ${expectedName}`);
  }
  if (pkg.private !== true) {
    errors.push(`${file} must be private`);
  }
}

if (existsSync(path.join(root, "settings.gradle.kts"))) {
  const settings = readFileSync(path.join(root, "settings.gradle.kts"), "utf8");
  for (const projectPath of [":minecraft:gateway", ":minecraft:companion"]) {
    if (!settings.includes(projectPath)) {
      errors.push(`settings.gradle.kts missing project ${projectPath}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Sail structure check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Sail structure check passed.");
