# Local Development

Use Node 22.12+, pnpm 10.15+, Java 21, Docker, and a POSIX shell.

Java 21 is the authoritative Minecraft build runtime for Sail release artifacts.
Newer local JVMs can compile the project, but release jar hashes should be
compared against Java 21/CI output.

## Install

```sh
pnpm install
```

## Fast Checks

```sh
just db-down
pnpm check
pnpm test
./gradlew test
```

The same checks can be run through:

```sh
just verify-local
```

## PostgreSQL Checks

```sh
just db-up
pnpm --filter @sail/registry db:migrate
pnpm test:db
just db-down
```

The local database service is defined in `ops/local/compose.yml`.

## Local Services

```sh
just registry-dev
just console-dev
```

The registry listens on `127.0.0.1:8787` by default. The console uses
`VITE_SAIL_REGISTRY_API_URL` when it needs a non-default registry URL.

## Smoke Tests

API-only smoke:

```sh
just db-up
node ops/local/smoke-local.mjs --skip-servers
just db-down
```

Full smoke:

```sh
node ops/local/smoke-local.mjs
```

The full smoke downloads and runs local Minecraft server artifacts, builds both
Minecraft plugins, installs the Paper companion, and verifies the Velocity to
Paper identity handoff.

## Release Bundle

```sh
pnpm release:alpha
```

The command builds the console, gateway jar, companion jar, and writes
`dist/release/sail-release.json` with hashes for the produced files.

Alpha GitHub releases are tag-driven. Push an annotated tag that matches
`v*-alpha*`; the release workflow builds the bundle, packages checksums, and
publishes a prerelease.

## Local Artifacts

Generated local runtime files are ignored by Git:

```text
.sail-smoke/
.sail-ui-run/
dist/
platform/console/dist/
minecraft/*/build/
node_modules/
.gradle/
```

Useful cleanup commands:

```sh
just runtime-artifacts
just runtime-clean-ui
```
