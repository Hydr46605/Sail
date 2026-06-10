import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = process.cwd();

const requiredJsonFiles = [
  "protocol/openapi/sail-registry.v1.openapi.json",
  "protocol/schemas/registry-discovery.v1.schema.json",
  "protocol/schemas/jwks.v1.schema.json",
  "protocol/schemas/name-lookup.v1.schema.json",
  "protocol/schemas/auth-challenge-create.v1.schema.json",
  "protocol/schemas/auth-challenge-status.v1.schema.json",
  "protocol/schemas/oauth-completion.v1.schema.json",
  "protocol/schemas/server.v1.schema.json",
  "protocol/schemas/console-profile.v1.schema.json",
  "protocol/schemas/session-verification.v1.schema.json",
  "protocol/schemas/error.v1.schema.json",
  "protocol/claims/sail-claim-token.v1.schema.json",
  "protocol/claims/sail-session-token.v1.schema.json",
  "protocol/errors/catalog.v1.json",
  "protocol/fixtures/registry-discovery.sail-global.v1.json",
  "protocol/fixtures/jwks.dev.v1.json",
  "protocol/fixtures/name-lookup.local.v1.json",
  "protocol/fixtures/auth-challenge.created.v1.json",
  "protocol/fixtures/auth-challenge.completed.v1.json",
  "protocol/fixtures/oauth-completion.discord.v1.json",
  "protocol/fixtures/server.local-survival.v1.json",
  "protocol/fixtures/console-profile.local.v1.json",
  "protocol/fixtures/session-verification.active.v1.json",
  "protocol/fixtures/error.premium-name-required.v1.json",
  "protocol/fixtures/sail-claim-token.local.v1.json",
  "protocol/fixtures/sail-session-token.local.v1.json",
];

const schemaFiles = [
  "protocol/schemas/registry-discovery.v1.schema.json",
  "protocol/schemas/jwks.v1.schema.json",
  "protocol/schemas/name-lookup.v1.schema.json",
  "protocol/schemas/auth-challenge-create.v1.schema.json",
  "protocol/schemas/auth-challenge-status.v1.schema.json",
  "protocol/schemas/oauth-completion.v1.schema.json",
  "protocol/schemas/server.v1.schema.json",
  "protocol/schemas/console-profile.v1.schema.json",
  "protocol/schemas/session-verification.v1.schema.json",
  "protocol/schemas/error.v1.schema.json",
  "protocol/claims/sail-claim-token.v1.schema.json",
  "protocol/claims/sail-session-token.v1.schema.json",
];

const fixtureValidations = [
  [
    "protocol/fixtures/registry-discovery.sail-global.v1.json",
    "https://protocol.sailmc.net/schemas/registry-discovery.v1.schema.json",
  ],
  [
    "protocol/fixtures/jwks.dev.v1.json",
    "https://protocol.sailmc.net/schemas/jwks.v1.schema.json",
  ],
  [
    "protocol/fixtures/name-lookup.local.v1.json",
    "https://protocol.sailmc.net/schemas/name-lookup.v1.schema.json",
  ],
  [
    "protocol/fixtures/auth-challenge.created.v1.json",
    "https://protocol.sailmc.net/schemas/auth-challenge-create.v1.schema.json",
  ],
  [
    "protocol/fixtures/auth-challenge.completed.v1.json",
    "https://protocol.sailmc.net/schemas/auth-challenge-status.v1.schema.json",
  ],
  [
    "protocol/fixtures/oauth-completion.discord.v1.json",
    "https://protocol.sailmc.net/schemas/oauth-completion.v1.schema.json",
  ],
  [
    "protocol/fixtures/server.local-survival.v1.json",
    "https://protocol.sailmc.net/schemas/server.v1.schema.json",
  ],
  [
    "protocol/fixtures/console-profile.local.v1.json",
    "https://protocol.sailmc.net/schemas/console-profile.v1.schema.json",
  ],
  [
    "protocol/fixtures/session-verification.active.v1.json",
    "https://protocol.sailmc.net/schemas/session-verification.v1.schema.json",
  ],
  [
    "protocol/fixtures/error.premium-name-required.v1.json",
    "https://protocol.sailmc.net/schemas/error.v1.schema.json",
  ],
  [
    "protocol/fixtures/sail-claim-token.local.v1.json",
    "https://protocol.sailmc.net/claims/sail-claim-token.v1.schema.json",
  ],
  [
    "protocol/fixtures/sail-session-token.local.v1.json",
    "https://protocol.sailmc.net/claims/sail-session-token.v1.schema.json",
  ],
];

const errors = [];

function readJson(file) {
  const fullPath = path.join(root, file);
  try {
    return JSON.parse(readFileSync(fullPath, "utf8"));
  } catch (error) {
    errors.push(`${file} is not valid JSON: ${error.message}`);
    return undefined;
  }
}

for (const file of requiredJsonFiles) {
  if (!existsSync(path.join(root, file))) {
    errors.push(`missing protocol artifact: ${file}`);
  }
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
addFormats(ajv);

for (const file of schemaFiles) {
  if (!existsSync(path.join(root, file))) {
    continue;
  }
  const schema = readJson(file);
  if (schema) {
    ajv.addSchema(schema);
  }
}

const parsedFixtures = new Map();

for (const [fixtureFile, schemaId] of fixtureValidations) {
  if (!existsSync(path.join(root, fixtureFile))) {
    continue;
  }
  const fixture = readJson(fixtureFile);
  if (fixture) {
    parsedFixtures.set(fixtureFile, fixture);
  }
  const validate = ajv.getSchema(schemaId);
  if (!validate) {
    errors.push(`missing compiled schema for ${schemaId}`);
    continue;
  }
  if (fixture && !validate(fixture)) {
    errors.push(`${fixtureFile} does not match ${schemaId}: ${ajv.errorsText(validate.errors)}`);
  }
}

function expectSchemaRejects(schemaId, value, label, reason = "invalid server_id") {
  const validate = ajv.getSchema(schemaId);
  if (!validate) {
    errors.push(`missing compiled schema for ${schemaId}`);
    return;
  }
  if (validate(value)) {
    errors.push(`${label} should reject ${reason}`);
  }
}

const invalidServerId = "Bad Server!";
const serverFixture = parsedFixtures.get("protocol/fixtures/server.local-survival.v1.json");
if (serverFixture) {
  expectSchemaRejects(
    "https://protocol.sailmc.net/schemas/server.v1.schema.json",
    { ...serverFixture, server_id: invalidServerId },
    "server fixture validation",
  );
}

const challengeFixture = parsedFixtures.get("protocol/fixtures/auth-challenge.created.v1.json");
if (challengeFixture) {
  expectSchemaRejects(
    "https://protocol.sailmc.net/schemas/auth-challenge-create.v1.schema.json",
    { ...challengeFixture, server_id: invalidServerId },
    "auth challenge fixture validation",
  );
}

const sessionVerificationFixture = parsedFixtures.get("protocol/fixtures/session-verification.active.v1.json");
if (sessionVerificationFixture) {
  expectSchemaRejects(
    "https://protocol.sailmc.net/schemas/session-verification.v1.schema.json",
    { ...sessionVerificationFixture, server_id: invalidServerId },
    "session verification response validation",
  );
  expectSchemaRejects(
    "https://protocol.sailmc.net/schemas/session-verification.v1.schema.json",
    { ...sessionVerificationFixture, issuer_server_id: invalidServerId },
    "session verification issuer response validation",
  );
}

const consoleProfileFixture = parsedFixtures.get("protocol/fixtures/console-profile.local.v1.json");
if (consoleProfileFixture) {
  expectSchemaRejects(
    "https://protocol.sailmc.net/schemas/console-profile.v1.schema.json",
    {
      ...consoleProfileFixture,
      trusted_servers: [{ ...consoleProfileFixture.trusted_servers[0], server_id: invalidServerId }],
    },
    "console profile trusted server validation",
  );

  const [providerFixture] = consoleProfileFixture.account.linked_providers;
  expectSchemaRejects(
    "https://protocol.sailmc.net/schemas/console-profile.v1.schema.json",
    {
      ...consoleProfileFixture,
      account: {
        ...consoleProfileFixture.account,
        linked_providers: [{ ...providerFixture, provider_subject: "discord:1234567890" }],
      },
    },
    "console profile provider validation",
    "unexpected provider_subject",
  );
}

expectSchemaRejects(
  "https://protocol.sailmc.net/schemas/session-verification.v1.schema.json#/$defs/request",
  { server_id: invalidServerId, session_token: "x".repeat(32) },
  "session verification request validation",
);

const claimFixture = parsedFixtures.get("protocol/fixtures/sail-claim-token.local.v1.json");
if (claimFixture) {
  expectSchemaRejects(
    "https://protocol.sailmc.net/claims/sail-claim-token.v1.schema.json",
    { ...claimFixture, claims: { ...claimFixture.claims, server_id: invalidServerId } },
    "claim token fixture validation",
  );
  const { server_id: _serverId, ...claimsWithoutServerId } = claimFixture.claims;
  expectSchemaRejects(
    "https://protocol.sailmc.net/claims/sail-claim-token.v1.schema.json",
    { ...claimFixture, claims: claimsWithoutServerId },
    "claim token required server_id validation",
  );
}

const sessionTokenFixture = parsedFixtures.get("protocol/fixtures/sail-session-token.local.v1.json");
if (sessionTokenFixture) {
  expectSchemaRejects(
    "https://protocol.sailmc.net/claims/sail-session-token.v1.schema.json",
    { ...sessionTokenFixture, claims: { ...sessionTokenFixture.claims, server_id: invalidServerId } },
    "session token fixture validation",
  );
  const { server_id: _serverId, ...claimsWithoutServerId } = sessionTokenFixture.claims;
  expectSchemaRejects(
    "https://protocol.sailmc.net/claims/sail-session-token.v1.schema.json",
    { ...sessionTokenFixture, claims: claimsWithoutServerId },
    "session token required server_id validation",
  );
}

const registryEnvExample = "platform/registry/.env.example";
if (existsSync(path.join(root, registryEnvExample))) {
  const envText = readFileSync(path.join(root, registryEnvExample), "utf8");
  const env = Object.fromEntries(
    envText
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return separator === -1 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  const jwks = parsedFixtures.get("protocol/fixtures/jwks.dev.v1.json");
  const [devKey] = jwks?.keys ?? [];
  const explicitJwkFields = [
    "SAIL_REGISTRY_JWK_KID",
    "SAIL_REGISTRY_JWK_X",
    "SAIL_REGISTRY_JWK_Y",
    "SAIL_REGISTRY_JWK_D",
  ];
  const presentJwkFields = explicitJwkFields.filter((field) => env[field]);
  if (presentJwkFields.length > 0 && presentJwkFields.length !== explicitJwkFields.length) {
    errors.push("platform/registry/.env.example must either omit all JWK env fields or include the complete JWK set");
  }
  if (devKey && presentJwkFields.length === explicitJwkFields.length) {
    if (devKey.kid !== env.SAIL_REGISTRY_JWK_KID) {
      errors.push("protocol dev JWKS fixture kid must match platform/registry/.env.example");
    }
    if (devKey.x !== env.SAIL_REGISTRY_JWK_X || devKey.y !== env.SAIL_REGISTRY_JWK_Y) {
      errors.push("protocol dev JWKS fixture public key must match platform/registry/.env.example");
    }
  }
}

const openApiFile = "protocol/openapi/sail-registry.v1.openapi.json";
if (existsSync(path.join(root, openApiFile))) {
  const openApi = readJson(openApiFile);
  if (openApi) {
    if (openApi.openapi !== "3.1.0") {
      errors.push("OpenAPI document must use openapi 3.1.0");
    }
    if (openApi.info?.version !== "sail-protocol-v1") {
      errors.push("OpenAPI info.version must be sail-protocol-v1");
    }
    for (const route of [
      "/.well-known/sail-registry.json",
      "/.well-known/jwks.json",
      "/v1/minecraft/auth-challenges",
      "/v1/minecraft/auth-challenges/{challenge_id}",
      "/v1/minecraft/auth-challenges/{challenge_id}/oauth-completions",
      "/v1/console/auth-challenges",
      "/v1/servers/{server_id}",
      "/v1/minecraft/sessions/verify",
      "/v1/console/me",
      "/v1/console/sessions/{session_id}/revoke",
    ]) {
      if (!openApi.paths?.[route]) {
        errors.push(`OpenAPI missing route: ${route}`);
      }
    }
  }
}

const errorCatalogFile = "protocol/errors/catalog.v1.json";
if (existsSync(path.join(root, errorCatalogFile))) {
  const catalog = readJson(errorCatalogFile);
  if (catalog) {
    if (catalog.protocol_version !== "sail-protocol-v1") {
      errors.push("error catalog protocol_version must be sail-protocol-v1");
    }
    const codes = new Set(catalog.errors?.map((entry) => entry.code));
    for (const code of [
      "premium_name_required",
      "name_already_claimed",
      "session_expired",
      "registry_unavailable",
      "server_not_found",
      "session_reuse_denied",
      "backend_not_safe",
      "signature_invalid",
      "issuer_untrusted",
    ]) {
      if (!codes.has(code)) {
        errors.push(`error catalog missing code: ${code}`);
      }
    }
  }
}

for (const [file, schemaId] of [
  [
    "protocol/claims/sail-claim-token.v1.schema.json",
    "https://protocol.sailmc.net/claims/sail-claim-token.v1.schema.json",
  ],
  [
    "protocol/claims/sail-session-token.v1.schema.json",
    "https://protocol.sailmc.net/claims/sail-session-token.v1.schema.json",
  ],
]) {
  if (!existsSync(path.join(root, file))) {
    continue;
  }
  const schema = ajv.getSchema(schemaId)?.schema;
  const algorithm = schema?.properties?.protected_header?.properties?.alg;
  if (algorithm?.const !== "ES256") {
    errors.push(`${file} must pin protected_header.alg to ES256 for v1`);
  }
  const requiredClaims = schema?.properties?.claims?.required ?? [];
  for (const claim of ["protocol_version", "iss", "sub", "iat", "exp", "scope"]) {
    if (!requiredClaims.includes(claim)) {
      errors.push(`${file} claims must require ${claim}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Sail protocol check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Sail protocol check passed.");
