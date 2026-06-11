<p align="center">
  <img src="docs/assets/sail-logo.png" alt="Sail" width="360">
</p>

<p align="center">
  <a href="https://github.com/Hydr46605/Sail">
    <img alt="Available on GitHub" height="56" src="https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/cozy/available/github_vector.svg">
  </a>
  <a href="https://papermc.io/software/velocity">
    <img alt="Supported on Velocity" height="56" src="https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/cozy/supported/velocity_vector.svg">
  </a>
  <a href="https://papermc.io">
    <img alt="Supported on Paper" height="56" src="https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/cozy/supported/paper_vector.svg">
  </a>
</p>

# Sail

Sail is a Minecraft identity layer for offline-mode networks. It gives players
a browser-based Sail session instead of a chat password, while keeping
Mojang/Microsoft ownership as the authority for premium names.

## The Problem

Offline-mode Minecraft networks are easy to join, but the usual identity model
is weak. A `/register` and `/login` password flow moves account security into
chat, creates another password for players to lose or reuse, and still leaves
server owners with a hard question: who is actually allowed to use a name?

Online-mode servers answer that question through Mojang/Microsoft sessions, but
that does not cover every network layout. Some communities need offline-mode
compatibility, Velocity-first routing, or self-hosted identity. Without a clear
name authority, a local account can also collide with a premium Minecraft name
and make the server look less trustworthy than it should.

## How Sail Solves It

Sail keeps the login decision at the gateway. A registry proves whether a player
can use a name, then issues a signed Sail session that Velocity can verify before
the player reaches the Paper backend. Premium names remain tied to
Mojang/Microsoft ownership; local Sail identities stay clearly separate instead
of pretending to be premium accounts.

For players, this means browser-based account access instead of chat passwords.
For operators, it means the backend receives a verified `sail.identity.v1`
profile after the gateway has accepted the session. Paper can use that metadata
for commands, placeholders, diagnostics, and integrations, but it is not the
authentication layer.

What Sail provides:

- browser/OAuth account access for local identities,
- no `/register` or `/login` password flow,
- premium-name protection before local claims are accepted,
- signed registry sessions verified by Velocity,
- kick/rejoin and LimboAPI-backed wait-room login modes,
- self-hosted registry support where the server owner opts in,
- an optional Paper companion for admin visibility and backend metadata.

This repository now contains the working alpha monorepo: protocol contracts,
the Sail Registry service, the Velocity gateway, the Paper diagnostics
companion, the local Console alpha, PostgreSQL migrations, local ops tooling,
and smoke-test infrastructure.

## Repository Shape

Sail is designed as a monorepo with clean product-oriented boundaries:

```text
platform/registry   Sail Registry service
platform/console    Sail web console
minecraft/gateway   Velocity gateway integration
minecraft/companion Paper/Bukkit companion integration
protocol/           Versioned contracts, schemas, claims, config, fixtures
ops/                Local/deploy operational assets
tools/              Development and verification scripts
```

The component boundaries and login path are documented in
[Architecture](docs/architecture.md).

The current implementation state and alpha boundaries are tracked in
[Current State](docs/current-state.md).

## Stack

Sail uses TypeScript for the web platform, Java 21 for Minecraft integrations,
PostgreSQL for identity state, and OpenAPI/JSON Schema/JWS contracts between
runtimes.

Local setup and verification commands are documented in
[Local Development](docs/local-development.md).

## Alpha Release

Sail Generic builds the alpha product bundle. Deployment repositories can use
that bundle for public landing pages, infrastructure, and downloads.

```sh
pnpm release:alpha
```

The release bundle shape is documented in
[Local Development](docs/local-development.md).

## Local Verification

CI is intentionally test-only. It verifies Sail Generic checks, tests, Gradle,
and PostgreSQL registry behavior, but it does not deploy Sail Global or publish
production artifacts.

Ignored local runtime artifacts and cleanup commands are documented in
[Local Development](docs/local-development.md).

Low-cost verification without PostgreSQL:

```sh
just db-down
pnpm check
pnpm test
./gradlew test
```

Durable registry verification with local PostgreSQL:

```sh
just db-up
pnpm test:db
pnpm test
just db-down
```

API-only local smoke:

```sh
just db-up
node ops/local/smoke-local.mjs --skip-servers
just db-down
```

Full Velocity/Paper local smoke uses pinned ES256 Sail session verification and
downloads/runs local Minecraft server artifacts. The skip-server smoke still
builds and inspects both Minecraft plugin jars; the full smoke also installs the
Paper companion into the backend. Run full smoke only when that runtime cost is
intentional:

```sh
node ops/local/smoke-local.mjs
```

## Key Custody

Registry signing-key custody, rotation, revocation, and recovery are documented
in [Security](docs/security.md).
Production or Sail Global deployments must use an explicit `env` or `file`
signing-key source; the built-in dev key is local-only.

Security reports should follow [Security Policy](SECURITY.md).

## Paper Companion

The Paper companion is a diagnostics and backend-visibility plugin, not a second
authentication layer. Velocity remains the enforcement point. The gateway
forwards a `sail.identity.v1` profile property after a Sail local session is
verified; the companion validates that metadata, tracks online state in memory,
and exposes `/sailpaper status`, `/sailpaper lookup <player>`, `/sailpaper
reload`, and alias `/sailcompanion`.

The gateway supports kick/rejoin auth plus LimboAPI-backed limbo and hybrid
modes. Hybrid keeps premium names under Mojang/Microsoft authority and sends
local Sail identities through the Sail limbo wait-room flow. Paper remains a
diagnostic consumer of the identity property; it does not enforce login policy.

## Documents

- [Architecture](docs/architecture.md)
- [Identity](docs/identity.md)
- [Configuration](docs/configuration.md)
- [Security](docs/security.md)
- [Local Development](docs/local-development.md)
- [Current State](docs/current-state.md)

## License

Sail is licensed under the [Apache License 2.0](LICENSE).
