import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import mineflayer from "mineflayer";

const root = resolve(new URL("../..", import.meta.url).pathname);
const smokeRoot = join(root, ".sail-smoke");
const cacheDir = join(smokeRoot, "cache");
const registryDir = join(root, "platform/registry");
const registryEntrypoint = join(registryDir, "node_modules/.bin/tsx");
const registryPort = Number.parseInt(process.env.SAIL_SMOKE_REGISTRY_PORT ?? "18787", 10);
const mojangPort = Number.parseInt(process.env.SAIL_SMOKE_MOJANG_PORT ?? "18788", 10);
const velocityPort = Number.parseInt(process.env.SAIL_SMOKE_VELOCITY_PORT ?? "25577", 10);
const paperPort = Number.parseInt(process.env.SAIL_SMOKE_PAPER_PORT ?? "25566", 10);
const smokeServerId = "smoke-network";
const smokeServerDisplayName = "Sail Smoke Network";
const clientVersion = process.env.SAIL_SMOKE_CLIENT_VERSION ?? "1.21.11";
const smokePremiumNames = parseSmokePremiumNames(process.env.SAIL_SMOKE_PREMIUM_NAMES ?? "Notch");
const skipServers = process.argv.includes("--skip-servers");
const manualClient = process.argv.includes("--manual-client");
const userAgent = "Sail local smoke/0.1.0 (https://github.com/Hydr46605/Sail)";

const processes = [];
const servers = [];
let registryProcess;

process.on("SIGINT", async () => {
  await stopAll();
  process.exit(130);
});

try {
  await smoke();
  console.log("\nSail local smoke passed.");
} catch (error) {
  console.error("\nSail local smoke failed:");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
} finally {
  await stopAll();
  process.exit(process.exitCode ?? 0);
}

async function smoke() {
  await mkdir(cacheDir, { recursive: true });

  await run("pnpm", ["--filter", "@sail/registry", "check"], { cwd: root });
  await run("./gradlew", [":minecraft:gateway:build", ":minecraft:companion:build"], { cwd: root });

  const mojang = await startMockMojangProfileServer(mojangPort, smokePremiumNames);
  servers.push(mojang);
  console.log(`Mock Mojang profile API listening on http://127.0.0.1:${mojangPort} with ${smokePremiumNames.size} premium name(s).`);

  await run("docker", ["compose", "-f", "ops/local/compose.yml", "up", "-d", "postgres"], { cwd: root });
  await waitForTcp("127.0.0.1", 15432, 30_000);
  await run("pnpm", ["--filter", "@sail/registry", "db:migrate"], {
    cwd: root,
    env: {
      ...process.env,
      SAIL_REGISTRY_DATABASE_URL: "postgres://sail:sail_dev_password@127.0.0.1:15432/sail",
      SAIL_REGISTRY_ALLOW_DEV_SIGNING_KEY: "true",
    },
  });

  registryProcess = await startRegistry();

  await smokeRegistryApi();
  await verifyGatewayJar();
  await verifyCompanionJar();

  if (!skipServers) {
    assert(registryProcess, "registry process is running before gateway smoke");
    await smokeVelocityAndPaper(registryProcess);
  } else {
    console.log("Skipping Velocity/Paper boot because --skip-servers was provided.");
  }
}

async function startRegistry() {
  const registry = startProcess("registry", registryEntrypoint, ["src/main.ts"], {
    cwd: registryDir,
    env: {
      ...process.env,
      SAIL_REGISTRY_HOST: "127.0.0.1",
      SAIL_REGISTRY_PORT: String(registryPort),
      SAIL_REGISTRY_API_URL: `http://127.0.0.1:${registryPort}`,
      SAIL_REGISTRY_AUTH_URL: `http://127.0.0.1:${registryPort}/auth/minecraft`,
      SAIL_REGISTRY_ID: "sail-smoke",
      SAIL_REGISTRY_NAME: "Sail Smoke Registry",
      SAIL_REGISTRY_TERMS_URL: `http://127.0.0.1:${registryPort}/terms`,
      SAIL_REGISTRY_PRIVACY_URL: `http://127.0.0.1:${registryPort}/privacy`,
      SAIL_SERVER_ID: smokeServerId,
      SAIL_SERVER_DISPLAY_NAME: smokeServerDisplayName,
      SAIL_SERVER_SESSION_REUSE_POLICY: "same_registry",
      SAIL_CONSOLE_URL: "http://127.0.0.1:5173",
      SAIL_MOJANG_PROFILE_API_URL: `http://127.0.0.1:${mojangPort}`,
      SAIL_OAUTH_DEV_ENABLED: "true",
      SAIL_REGISTRY_STATE_BACKEND: "postgres",
      SAIL_REGISTRY_DATABASE_URL: "postgres://sail:sail_dev_password@127.0.0.1:15432/sail",
      SAIL_REGISTRY_ALLOW_DEV_SIGNING_KEY: "true",
    },
  });
  processes.push(registry);

  await waitForHttp(`http://127.0.0.1:${registryPort}/health`, 30_000, registry);
  return registry;
}

async function restartRegistryForPersistenceCheck() {
  assert(registryProcess, "registry process is running before persistence restart");
  await stopProcess(registryProcess);
  registryProcess = await startRegistry();
}

async function smokeRegistryApi() {
  const randomName = `sail${Date.now().toString(36)}`.slice(0, 16);
  const base = `http://127.0.0.1:${registryPort}`;

  const health = await getJson(`${base}/health`);
  assertEqual(health.status, "ok", "registry health status");

  const discovery = await getJson(`${base}/.well-known/sail-registry.json`);
  assertEqual(discovery.registry_id, "sail-smoke", "registry discovery id");

  const server = await getJson(`${base}/v1/servers/${smokeServerId}`);
  assertEqual(server.registry_id, "sail-smoke", "registered server registry id");
  assertEqual(server.server_id, smokeServerId, "registered server id");
  assertEqual(server.display_name, smokeServerDisplayName, "registered server display name");
  assertEqual(server.status, "active", "registered server status");
  assertEqual(server.session_reuse_policy, "same_registry", "registered server session reuse policy");

  const unknownServer = await postJson(`${base}/v1/minecraft/auth-challenges`, {
    server_id: "missing-smoke-network",
    username: randomName,
    connection_id: "smoke-missing-server",
    mode: "kick",
  }, 404);
  assertEqual(unknownServer.error?.code, "server_not_found", "unknown server challenge error");

  const created = await postJson(`${base}/v1/minecraft/auth-challenges`, {
    server_id: smokeServerId,
    username: randomName,
    connection_id: "smoke-connection-1",
    mode: "kick",
  }, 201);
  assertEqual(created.status, "pending", "challenge creation status");

  const pending = await getJson(`${base}/v1/minecraft/auth-challenges/${created.challenge_id}`);
  assertEqual(pending.status, "pending", "challenge pending status");

  const completed = await postJson(
    `${base}/v1/minecraft/auth-challenges/${created.challenge_id}/oauth-completions`,
    {
      provider: "discord",
      provider_subject: "smoke-discord-account",
      provider_username: "smoke-user",
    },
    200,
  );
  assertEqual(completed.status, "completed", "challenge completed status");
  const firstUuid = completed.identity?.minecraft_uuid;
  const firstSessionId = completed.identity?.session_id;
  const firstSessionToken = completed.identity?.session_token;
  assert(firstUuid, "completed identity includes minecraft_uuid");
  assert(firstSessionId, "completed identity includes session_id");
  assert(firstSessionToken, "completed identity includes session_token");

  const profile = await getJson(`${base}/v1/console/me`, {
    headers: {
      Authorization: `Bearer ${firstSessionToken}`,
    },
  });
  assertEqual(profile.account?.account_id, completed.identity?.account_id, "console profile account id");
  assert(
    profile.names?.some((name) =>
      name.canonical_name === completed.identity?.canonical_name &&
      name.minecraft_uuid === firstUuid,
    ),
    "console profile includes completed name claim",
  );
  assert(
    profile.sessions?.some((session) =>
      session.session_id === firstSessionId &&
      session.current === true,
    ),
    "console profile includes current completed session",
  );
  assert(
    profile.trusted_servers?.some((trustedServer) => trustedServer.server_id === smokeServerId),
    "console profile includes trusted smoke server",
  );
  assertNoConsoleProfileLeaks(profile);

  const verified = await postJson(`${base}/v1/minecraft/sessions/verify`, {
    server_id: smokeServerId,
    session_token: firstSessionToken,
  }, 200);
  assertEqual(verified.session_id, firstSessionId, "session verification id");
  assertEqual(verified.status, "active", "session verification status");
  assertEqual(verified.server_id, smokeServerId, "session verification target server id");
  assertEqual(verified.issuer_server_id, smokeServerId, "session verification issuer server id");
  assertEqual(verified.session_reuse_policy, "same_registry", "session verification reuse policy");

  await restartRegistryForPersistenceCheck();
  const persisted = await postJson(`${base}/v1/minecraft/sessions/verify`, {
    server_id: smokeServerId,
    session_token: firstSessionToken,
  }, 200);
  assertEqual(persisted.session_id, firstSessionId, "persisted session verification id");
  assertEqual(persisted.status, "active", "persisted session verification status");
  assertEqual(persisted.server_id, smokeServerId, "persisted session verification target server id");
  assertEqual(persisted.issuer_server_id, smokeServerId, "persisted session verification issuer server id");
  assertEqual(persisted.session_reuse_policy, "same_registry", "persisted session verification reuse policy");

  const revoked = await postJson(`${base}/v1/console/sessions/${firstSessionId}/revoke`, {}, 200, {
    headers: {
      Authorization: `Bearer ${firstSessionToken}`,
    },
  });
  assertEqual(revoked.status, "revoked", "session revocation status");

  const revokedProfile = await getJson(`${base}/v1/console/me`, {
    headers: {
      Authorization: `Bearer ${firstSessionToken}`,
    },
  }, 403);
  assertEqual(revokedProfile.error?.code, "session_revoked", "revoked console profile error");

  const revokedVerification = await postJson(`${base}/v1/minecraft/sessions/verify`, {
    server_id: smokeServerId,
    session_token: firstSessionToken,
  }, 403);
  assertEqual(revokedVerification.error?.code, "session_revoked", "revoked session error");

  const secondCreated = await postJson(`${base}/v1/minecraft/auth-challenges`, {
    server_id: smokeServerId,
    username: randomName,
    connection_id: "smoke-connection-2",
    mode: "kick",
  }, 201);
  const secondCompleted = await postJson(
    `${base}/v1/minecraft/auth-challenges/${secondCreated.challenge_id}/oauth-completions`,
    {
      provider: "discord",
      provider_subject: "smoke-discord-account",
      provider_username: "smoke-user",
    },
    200,
  );
  assertEqual(secondCompleted.identity?.minecraft_uuid, firstUuid, "stable local UUID");

  const duplicateCreated = await postJson(`${base}/v1/minecraft/auth-challenges`, {
    server_id: smokeServerId,
    username: randomName,
    connection_id: "smoke-connection-3",
    mode: "kick",
  }, 201);
  const duplicate = await postJson(
    `${base}/v1/minecraft/auth-challenges/${duplicateCreated.challenge_id}/oauth-completions`,
    {
      provider: "discord",
      provider_subject: "other-smoke-discord-account",
    },
    409,
  );
  assertEqual(duplicate.error?.code, "name_already_claimed", "duplicate local name error");

  const premium = await postJson(`${base}/v1/minecraft/auth-challenges`, {
    server_id: smokeServerId,
    username: "Notch",
    connection_id: "smoke-premium",
    mode: "kick",
  }, 409);
  assertEqual(premium.error?.code, "premium_name_required", "premium-name protection error");

  console.log(`Registry API smoke passed with local name ${randomName} and UUID ${firstUuid}.`);
}

async function verifyGatewayJar() {
  const jarPath = join(root, "minecraft/gateway/build/libs/gateway-0.1.0-SNAPSHOT.jar");
  await run("jar", ["tf", jarPath], { cwd: root, capture: true }).then((result) => {
    assert(result.stdout.includes("velocity-plugin.json"), "gateway jar contains velocity-plugin.json");
    assert(result.stdout.includes("net/sailmc/gateway/SailGatewayPlugin.class"), "gateway jar contains plugin class");
  });
  console.log("Gateway jar smoke passed.");
}

async function verifyCompanionJar() {
  const jarPath = join(root, "minecraft/companion/build/libs/companion-0.1.0-SNAPSHOT.jar");
  await run("jar", ["tf", jarPath], { cwd: root, capture: true }).then((result) => {
    assert(result.stdout.includes("paper-plugin.yml"), "companion jar contains paper-plugin.yml");
    assert(result.stdout.includes("config.yml"), "companion jar contains config.yml");
    assert(result.stdout.includes("net/sailmc/companion/SailCompanionPlugin.class"), "companion jar contains plugin class");
  });
  console.log("Companion jar smoke passed.");
}

async function smokeVelocityAndPaper(registry) {
  const velocityJar = await downloadLatestPaperMcJar("velocity", "3.5.0-SNAPSHOT");
  const paperJar = await downloadLatestPaperMcJar("paper", "26.1.2");
  const networkDir = join(smokeRoot, "network");
  const paperDir = join(networkDir, "paper");
  const velocityDir = join(networkDir, "velocity");
  await rm(networkDir, { recursive: true, force: true });
  await mkdir(join(velocityDir, "plugins", "sail-gateway"), { recursive: true });
  await mkdir(join(paperDir, "plugins"), { recursive: true });
  await mkdir(join(paperDir, "config"), { recursive: true });
  await mkdir(paperDir, { recursive: true });

  await writeFile(join(paperDir, "eula.txt"), "eula=true\n", "utf8");
  await writeFile(join(paperDir, "server.properties"), [
    `server-port=${paperPort}`,
    "server-ip=127.0.0.1",
    "online-mode=false",
    "enforce-secure-profile=false",
    "motd=Sail Smoke Backend",
    "spawn-protection=0",
    "view-distance=3",
    "simulation-distance=3",
    "",
  ].join("\n"), "utf8");

  const forwardingSecret = "sail-smoke-forwarding-secret";
  await writeFile(join(paperDir, "config", "paper-global.yml"), paperGlobalConfig(forwardingSecret), "utf8");
  await writeFile(join(velocityDir, "forwarding.secret"), `${forwardingSecret}\n`, "utf8");
  await writeFile(join(velocityDir, "velocity.toml"), velocityConfig(), "utf8");
  await writeFile(join(velocityDir, "plugins", "sail-gateway", "config.yml"), gatewayConfig(), "utf8");
  await copyGatewayJar(join(velocityDir, "plugins", "sail-gateway.jar"));
  await copyCompanionJar(join(paperDir, "plugins", "sail-companion.jar"));

  const paper = startProcess("paper", "java", ["-Xms256m", "-Xmx768m", "-jar", paperJar, "--nogui"], {
    cwd: paperDir,
  });
  processes.push(paper);
  await waitForLog(paper, /(?:Done \([^)]*\)! For help, type "help"|Done preparing level "world")/u, 300_000);
  console.log("Paper backend booted.");

  const velocity = startProcess("velocity", "java", ["-Xms256m", "-Xmx512m", "-jar", velocityJar], {
    cwd: velocityDir,
  });
  processes.push(velocity);
  await waitForLog(velocity, /Done \([^)]*s\)!/u, 90_000);
  await waitForLog(velocity, /Sail Gateway reloaded\./u, 30_000);
  velocity.child.stdin.write("sail status\n");
  await waitForLog(velocity, /Sail Gateway: initialized/u, 30_000);
  await waitForLog(velocity, /Registry health: ok/u, 30_000);
  console.log("Velocity gateway booted and /sail status reported registry health ok.");

  if (manualClient) {
    await waitForManualClientStop(velocity);
    return;
  }

  await smokeMineflayerClient(velocity);

  await stopProcess(registry);
  velocity.child.stdin.write("sail status\n");
  await waitForLog(velocity, /Registry health: unavailable/u, 30_000);
  console.log("Velocity /sail status reports registry unavailable after registry stop.");
}

async function waitForManualClientStop(velocity) {
  console.log("");
  console.log("Manual Prism smoke is ready.");
  console.log(`Connect PrismLauncher to 127.0.0.1:${velocityPort}.`);
  console.log("First join should kick with a Sail auth code. Type 'status' here to refresh /sail status, or 'stop' to shut down.");
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  return new Promise((resolvePromise) => {
    const onData = (chunk) => {
      const command = chunk.trim().toLowerCase();
      if (command === "status") {
        velocity.child.stdin.write("sail status\n");
        return;
      }
      if (command === "stop") {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolvePromise();
      }
    };
    process.stdin.on("data", onData);
  });
}

async function smokeMineflayerClient(velocity) {
  const username = `sail${Date.now().toString(36)}`.slice(0, 16);
  const kickMessage = await connectMineflayerExpectKick(username);
  const authCode = extractAuthCode(kickMessage);
  const completionUrl = new URL(`http://127.0.0.1:${registryPort}/auth/dev/complete`);
  completionUrl.searchParams.set("code", authCode);
  completionUrl.searchParams.set("provider_subject", "smoke-mineflayer-account");
  completionUrl.searchParams.set("provider_username", "smoke-mineflayer");
  const completionBody = await getText(completionUrl.toString(), 200);
  assert(completionBody.includes("authentication complete"), "dev OAuth completion page reports success");
  assert(completionBody.includes("/auth/complete#session_token="), "dev OAuth completion page includes console handoff link");
  await delay(3_500);
  const joinResult = await connectMineflayerExpectSpawn(username, velocity);
  await delay(3_500);
  const resumeResult = await connectMineflayerExpectSpawn(username, velocity);
  if (joinResult === "spawned") {
    console.log(`Mineflayer client smoke spawned ${username} on Minecraft ${clientVersion}.`);
  } else {
    console.log(
      `Mineflayer client smoke verified Sail auth and Velocity backend handoff for ${username}; ` +
      `Paper rejected mineflayer protocol ${clientVersion} after gateway acceptance.`,
    );
  }
  if (resumeResult === "spawned") {
    console.log(`Mineflayer client smoke resumed ${username} without a new auth code.`);
  } else {
    console.log(
      `Mineflayer client smoke verified Sail session resume for ${username}; ` +
      `Paper rejected mineflayer protocol ${clientVersion} after resumed gateway acceptance.`,
    );
  }
}

async function connectMineflayerExpectKick(username) {
  return new Promise((resolvePromise, reject) => {
    const bot = mineflayer.createBot({
      host: "127.0.0.1",
      port: velocityPort,
      username,
      auth: "offline",
      version: clientVersion,
      hideErrors: true,
    });
    const timeout = setTimeout(() => {
      cleanup();
      bot.end();
      reject(new Error(`Timed out waiting for ${username} to be kicked by Velocity`));
    }, 45_000);

    function cleanup() {
      clearTimeout(timeout);
      bot.removeAllListeners("kicked");
      bot.removeAllListeners("spawn");
      bot.removeAllListeners("error");
      bot.removeAllListeners("end");
    }

    bot.once("kicked", (reason) => {
      cleanup();
      resolvePromise(normalizeKickReason(reason));
    });
    bot.once("spawn", () => {
      cleanup();
      bot.quit();
      reject(new Error(`${username} spawned before completing Sail OAuth`));
    });
    bot.once("error", (error) => {
      cleanup();
      reject(error);
    });
    bot.once("end", (reason) => {
      cleanup();
      reject(new Error(`${username} disconnected before kick reason: ${String(reason)}`));
    });
  });
}

async function connectMineflayerExpectSpawn(username, velocity) {
  return new Promise((resolvePromise, reject) => {
    const bot = mineflayer.createBot({
      host: "127.0.0.1",
      port: velocityPort,
      username,
      auth: "offline",
      version: clientVersion,
      hideErrors: true,
    });
    const timeout = setTimeout(() => {
      cleanup();
      bot.end();
      reject(new Error(`Timed out waiting for ${username} to spawn through Velocity`));
    }, 60_000);

    function cleanup() {
      clearTimeout(timeout);
      bot.removeAllListeners("kicked");
      bot.removeAllListeners("spawn");
      bot.removeAllListeners("error");
      bot.removeAllListeners("end");
    }

    bot.once("spawn", () => {
      cleanup();
      bot.quit();
      resolvePromise("spawned");
    });
    bot.once("kicked", (reason) => {
      const kickReason = normalizeKickReason(reason);
      cleanup();
      if (isBackendVersionMismatch(kickReason) && velocitySawBackendHandoff(velocity, username)) {
        resolvePromise("gateway-accepted-backend-version-mismatch");
        return;
      }
      reject(new Error(`${username} was kicked after Sail OAuth: ${kickReason}`));
    });
    bot.once("error", (error) => {
      cleanup();
      reject(error);
    });
    bot.once("end", (reason) => {
      cleanup();
      reject(new Error(`${username} disconnected before spawn: ${String(reason)}`));
    });
  });
}

function extractAuthCode(kickMessage) {
  const match = /Code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/u.exec(kickMessage);
  assert(match?.[1], `kick message did not include Sail auth code: ${kickMessage}`);
  return match[1];
}

function normalizeKickReason(reason) {
  return typeof reason === "string" ? reason : JSON.stringify(reason);
}

function isBackendVersionMismatch(reason) {
  return reason.includes("Outdated client! Please use 26.1.2");
}

function velocitySawBackendHandoff(velocity, username) {
  return velocity.output.includes(`[connected player] ${username}`) &&
    velocity.output.includes(`${username} -> backend has connected`);
}

async function startMockMojangProfileServer(port, premiumNames) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const match = /^\/users\/profiles\/minecraft\/([^/]+)$/u.exec(url.pathname);
    if (request.method !== "GET" || !match?.[1]) {
      response.writeHead(404);
      response.end();
      return;
    }

    const canonicalName = decodeURIComponent(match[1]).toLowerCase();
    const premiumName = premiumNames.get(canonicalName);
    if (premiumName) {
      response.writeHead(200, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({
        id: mockMojangUuid(canonicalName),
        name: premiumName,
      }));
      return;
    }

    response.writeHead(204);
    response.end();
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
  return server;
}

function parseSmokePremiumNames(value) {
  return new Map(value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => [name.toLowerCase(), name]));
}

function mockMojangUuid(canonicalName) {
  return createHash("sha256")
    .update(`sail-smoke-premium:${canonicalName}`)
    .digest("hex")
    .slice(0, 32);
}

function velocityConfig() {
  return [
    "config-version = \"2.7\"",
    `bind = "127.0.0.1:${velocityPort}"`,
    "motd = \"Sail Smoke Proxy\"",
    "show-max-players = 20",
    "online-mode = true",
    "force-key-authentication = false",
    "prevent-client-proxy-connections = false",
    "player-info-forwarding-mode = \"modern\"",
    "forwarding-secret-file = \"forwarding.secret\"",
    "announce-forge = false",
    "kick-existing-players = false",
    "enable-player-address-logging = true",
    "",
    "[servers]",
    `backend = "127.0.0.1:${paperPort}"`,
    "try = [\"backend\"]",
    "",
    "[forced-hosts]",
    "",
    "[advanced]",
    "compression-threshold = 256",
    "compression-level = -1",
    "login-ratelimit = 3000",
    "connection-timeout = 5000",
    "read-timeout = 30000",
    "haproxy-protocol = false",
    "tcp-fast-open = false",
    "bungee-plugin-message-channel = true",
    "show-ping-requests = false",
    "failover-on-unexpected-server-disconnect = true",
    "announce-proxy-commands = true",
    "log-command-executions = true",
    "log-player-connections = true",
    "",
    "[query]",
    "enabled = false",
    "",
  ].join("\n");
}

function paperGlobalConfig(forwardingSecret) {
  return [
    "proxies:",
    "  bungee-cord:",
    "    online-mode: false",
    "  proxy-protocol: false",
    "  velocity:",
    "    enabled: true",
    "    online-mode: true",
    `    secret: "${forwardingSecret}"`,
    "",
  ].join("\n");
}

function gatewayConfig() {
  return [
    "sail:",
    "  server:",
    `    id: "${smokeServerId}"`,
    `    display-name: "${smokeServerDisplayName}"`,
    "",
    "  registry:",
    "    mode: \"self-hosted\"",
    `    api-url: "http://127.0.0.1:${registryPort}"`,
    "    registry-id: \"sail-smoke\"",
    "    public-key-pinning: true",
    "    trusted-keys:",
    "      - kid: \"dev-es256-2026-06\"",
    "        alg: \"ES256\"",
    "        crv: \"P-256\"",
    "        x: \"0WamuH-EnCrBXIQwPZo2ZKfwNV9OW9EDkzr4YzscxcY\"",
    "        y: \"0wFxw0l_9Rziux_ZQboPeCkBi5oLibu_5GocXtVUURo\"",
    "",
    "  login-flow:",
    "    unauthenticated-action: kick",
    "    auth-timeout-seconds: 180",
    "    allow-rejoin-after-auth: true",
    `    auth-url-template: "http://127.0.0.1:${registryPort}/auth/minecraft?code={code}"`,
    "",
    "  backend:",
    "    require-modern-forwarding: true",
    "    fail-if-forwarding-secret-missing: true",
    "",
  ].join("\n");
}

async function copyGatewayJar(targetPath) {
  const sourcePath = join(root, "minecraft/gateway/build/libs/gateway-0.1.0-SNAPSHOT.jar");
  const data = await readFile(sourcePath);
  await writeFile(targetPath, data);
}

async function copyCompanionJar(targetPath) {
  const sourcePath = join(root, "minecraft/companion/build/libs/companion-0.1.0-SNAPSHOT.jar");
  const data = await readFile(sourcePath);
  await writeFile(targetPath, data);
}

async function downloadLatestPaperMcJar(project, version) {
  const buildsUrl = `https://fill.papermc.io/v3/projects/${project}/versions/${version}/builds`;
  const builds = await getJson(buildsUrl, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json",
    },
  });
  assert(Array.isArray(builds) && builds.length > 0, `PaperMC returned no builds for ${project} ${version}`);
  const build = builds[0];
  const download = build.downloads?.["server:default"];
  assert(download?.url && download?.checksums?.sha256, `PaperMC build missing default download for ${project}`);
  const jarPath = join(cacheDir, download.name ?? basename(download.url));
  if (await fileHasSha256(jarPath, download.checksums.sha256)) {
    console.log(`Using cached ${project} ${version} build ${build.id}.`);
    return jarPath;
  }

  console.log(`Downloading ${project} ${version} build ${build.id} from PaperMC.`);
  await downloadFile(download.url, jarPath);
  const ok = await fileHasSha256(jarPath, download.checksums.sha256);
  assert(ok, `checksum mismatch for ${jarPath}`);
  return jarPath;
}

async function fileHasSha256(path, expected) {
  try {
    const data = await readFile(path);
    return createHash("sha256").update(data).digest("hex") === expected;
  } catch {
    return false;
  }
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/octet-stream",
    },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  await mkdir(resolve(targetPath, ".."), { recursive: true });
  const data = Buffer.from(await response.arrayBuffer());
  await writeFile(targetPath, data);
}

async function getJson(url, options = {}, expectedStatus = undefined) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await response.text();
  const statusMatches = expectedStatus === undefined ? response.ok : response.status === expectedStatus;
  if (!statusMatches) {
    const expectation = expectedStatus === undefined ? "2xx" : String(expectedStatus);
    throw new Error(`${url} returned HTTP ${response.status}, expected ${expectation}: ${body.slice(0, 240)}`);
  }
  return JSON.parse(body);
}

async function postJson(url, payload, expectedStatus, options = {}) {
  const { headers, ...fetchOptions } = options;
  const response = await fetch(url, {
    ...fetchOptions,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`${url} returned HTTP ${response.status}, expected ${expectedStatus}: ${body.slice(0, 240)}`);
  }
  return JSON.parse(body);
}

async function getText(url, expectedStatus) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/plain",
    },
  });
  const body = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`${url} returned HTTP ${response.status}, expected ${expectedStatus}: ${body.slice(0, 240)}`);
  }
  return body;
}

async function waitForHttp(url, timeoutMs, processHandle = undefined) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processHandle?.exited) {
      throw new Error(`${processHandle.name} exited before ${url} became healthy`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForTcp(host, port, timeoutMs) {
  const net = await import("node:net");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolvePromise) => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolvePromise(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolvePromise(false);
      });
    });
    if (ok) {
      return;
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for TCP ${host}:${port}`);
}

async function waitForLog(processHandle, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(processHandle.output)) {
      return;
    }
    if (processHandle.exited) {
      throw new Error(`${processHandle.name} exited before log pattern ${pattern}`);
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${processHandle.name} log pattern ${pattern}`);
}

function startProcess(name, command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const handle = {
    name,
    child,
    output: "",
    exited: false,
  };
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    handle.output += text;
    process.stdout.write(`[${name}] ${text}`);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    handle.output += text;
    process.stderr.write(`[${name}] ${text}`);
  });
  child.on("exit", () => {
    handle.exited = true;
  });
  return handle;
}

async function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`);
  return new Promise((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    if (options.capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

async function stopAll() {
  for (const handle of processes.toReversed()) {
    stopProcessSignal(handle);
  }
  await delay(2_000);
  for (const handle of processes.toReversed()) {
    if (!handle.exited) {
      handle.child.kill("SIGKILL");
    }
  }
  await Promise.all(servers.map((server) => closeServer(server)));
}

async function stopProcess(handle) {
  stopProcessSignal(handle);
  await waitForProcessExit(handle, 2_000);
  if (!handle.exited) {
    handle.child.kill("SIGKILL");
    await waitForProcessExit(handle, 2_000);
  }
}

async function waitForProcessExit(handle, timeoutMs) {
  if (handle.exited) {
    return;
  }
  await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      handle.child.off("exit", onExit);
      resolvePromise();
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolvePromise();
    };
    handle.child.once("exit", onExit);
  });
}

function stopProcessSignal(handle) {
  if (handle.exited) {
    return;
  }
  if (handle.name === "paper") {
    handle.child.stdin.write("stop\n");
  } else if (handle.name === "velocity") {
    handle.child.stdin.write("end\n");
  } else {
    handle.child.kill("SIGTERM");
  }
}

async function closeServer(server) {
  if (!server.listening) {
    return;
  }
  await new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolvePromise();
      }
    });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoConsoleProfileLeaks(profile) {
  const encoded = JSON.stringify(profile);
  for (const field of ["provider_subject", "session_token_hash", "challenge_code_hash", "client_ip_hash"]) {
    assert(!encoded.includes(field), `console profile must not expose ${field}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}
