import { readFile } from "node:fs/promises";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readText(path) {
  return readFile(path, "utf8");
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

function assertMatches(label, actual, pattern) {
  if (typeof actual !== "string" || !pattern.test(actual)) {
    throw new Error(`${label} mismatch: expected ${pattern}, got ${actual}`);
  }
}

function assertContains(label, actual, expected) {
  if (!actual.includes(expected)) {
    throw new Error(`${label} missing: expected to contain ${expected}`);
  }
}

const [
  rootPackage,
  registryPackage,
  consolePackage,
  protocolPackage,
  openApi,
  errorCatalog,
  version,
  releaseManifest,
  gradleBuild,
] = await Promise.all([
  readJson("package.json"),
  readJson("platform/registry/package.json"),
  readJson("platform/console/package.json"),
  readJson("protocol/package.json"),
  readJson("protocol/openapi/sail-registry.v1.openapi.json"),
  readJson("protocol/errors/catalog.v1.json"),
  readJson("protocol/version.json"),
  readJson("release/sail-alpha-manifest.json"),
  readText("build.gradle.kts"),
]);

assertEqual("product", version.product, "sail");
assertEqual("release_channel", version.release_channel, "alpha");
assertEqual("root package version", rootPackage.version, version.sail_version);
assertEqual("protocol package version", protocolPackage.version, version.sail_version);
assertEqual("registry component version", version.components.registry, version.sail_version);
assertEqual("console component version", version.components.console, version.sail_version);
assertEqual("registry package version", registryPackage.version, version.sail_version);
assertEqual("console package version", consolePackage.version, version.sail_version);
assertEqual("gateway component version", version.components.gateway, `${version.sail_version}-SNAPSHOT`);
assertEqual("companion component version", version.components.companion, `${version.sail_version}-SNAPSHOT`);
assertMatches("protocol_version", version.protocol_version, /^sail-protocol-v\d+$/u);
assertEqual("OpenAPI info.version", openApi.info?.version, version.protocol_version);
assertEqual("error catalog protocol_version", errorCatalog.protocol_version, version.protocol_version);
assertContains("gateway Gradle version", gradleBuild, `version = "${version.components.gateway}"`);
assertContains("companion Gradle version", gradleBuild, `version = "${version.components.companion}"`);

const releaseArtifacts = new Map(releaseManifest.artifacts.map((artifact) => [artifact.id, artifact]));
assertEqual("gateway release alias", releaseArtifacts.get("gateway")?.alias_file, "sail-gateway.jar");
assertEqual("companion release alias", releaseArtifacts.get("companion")?.alias_file, "sail-companion.jar");

console.log("Sail version check passed.");
