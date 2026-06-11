import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const sourceManifestPath = join(root, "release/sail-alpha-manifest.json");
const outputDir = join(root, "dist/release");
const filesDir = join(outputDir, "files");
const consoleOutputDir = join(outputDir, "console");

const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));

await rm(outputDir, { recursive: true, force: true });
await mkdir(filesDir, { recursive: true });

const resolvedArtifacts = [];
for (const artifact of sourceManifest.artifacts) {
  const sourcePath = join(root, artifact.source);
  const sourceStats = await stat(sourcePath).catch(() => undefined);
  if (!sourceStats?.isFile()) {
    throw new Error(`Release artifact source is missing or not a file: ${artifact.source}`);
  }

  const targetPath = join(filesDir, artifact.file);
  await cp(sourcePath, targetPath);
  if (typeof artifact.alias_file === "string" && artifact.alias_file.length > 0) {
    await cp(sourcePath, join(filesDir, artifact.alias_file));
  }
  const bytes = await readFile(targetPath);
  resolvedArtifacts.push({
    ...artifact,
    size_bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

const consoleDist = join(root, "platform/console/dist");
const consoleStats = await stat(consoleDist).catch(() => undefined);
if (!consoleStats?.isDirectory()) {
  throw new Error("Console dist is missing. Run `pnpm --filter @sail/console build` before `pnpm release:alpha`.");
}
await cp(consoleDist, consoleOutputDir, { recursive: true });

const releaseManifest = {
  ...sourceManifest,
  generated_at: new Date().toISOString(),
  artifacts: resolvedArtifacts,
  console: {
    source: "platform/console/dist",
    directory: basename(consoleOutputDir),
  },
};

await writeFile(join(outputDir, "sail-release.json"), `${JSON.stringify(releaseManifest, null, 2)}\n`, "utf8");
await writeFile(join(outputDir, "README.txt"), releaseReadme(releaseManifest), "utf8");

console.log(`Sail alpha release bundle prepared at ${relative(outputDir)}`);
for (const artifact of resolvedArtifacts) {
  console.log(`- ${artifact.file} ${artifact.sha256}`);
}

function releaseReadme(manifest) {
  return [
    `${manifest.name} ${manifest.label}`,
    "",
    "This is an alpha bundle for testing Sail.",
    "Do not treat it as a stable production authority.",
    "",
    "Files:",
    ...manifest.artifacts.map((artifact) =>
      `- files/${artifact.file} (${artifact.kind}) sha256=${artifact.sha256}`),
    ...manifest.artifacts
      .filter((artifact) => typeof artifact.alias_file === "string" && artifact.alias_file.length > 0)
      .map((artifact) => `- files/${artifact.alias_file} (${artifact.kind}, latest alias)`),
    "- console/ (static Sail Console alpha build)",
    "- sail-release.json (resolved manifest)",
    "",
  ].join("\n");
}

function relative(path) {
  return path.replace(`${root}/`, "");
}
