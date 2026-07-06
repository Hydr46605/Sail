import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const openApiFile = "protocol/openapi/sail-registry.v1.openapi.json";
const openApi = JSON.parse(readFileSync(path.join(root, openApiFile), "utf8"));

const currentServedRoutes = [
  "/.well-known/jwks.json",
  "/.well-known/sail-registry.json",
  "/v1/console/auth-challenges",
  "/v1/console/me",
  "/v1/console/sessions/{session_id}/revoke",
  "/v1/minecraft/auth-challenges",
  "/v1/minecraft/auth-challenges/{challenge_id}",
  "/v1/minecraft/auth-challenges/{challenge_id}/oauth-completions",
  "/v1/minecraft/sessions/verify",
  "/v1/servers",
  "/v1/servers/claim",
  "/v1/servers/heartbeat",
  "/v1/servers/{server_id}",
];

const errors = [];
const openApiRoutes = Object.keys(openApi.paths ?? {}).sort();
const expectedRoutes = [...currentServedRoutes].sort();

for (const route of expectedRoutes) {
  if (!openApi.paths?.[route]) {
    errors.push(`OpenAPI missing current served route: ${route}`);
  }
}

for (const route of openApiRoutes) {
  if (!expectedRoutes.includes(route)) {
    errors.push(`OpenAPI route is not part of the current served registry API: ${route}`);
  }
}

if (errors.length > 0) {
  console.error("Sail API contract check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Sail API contract check passed.");
