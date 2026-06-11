# Architecture

Sail is split into a registry, two Minecraft integrations, shared protocol
contracts, and a local console. The registry is the source of identity state.
Velocity is the enforcement point. Paper only receives already-verified
identity metadata.

## Packages

```text
platform/registry   Registry API, migrations, signing, session verification
platform/console    Vite console for registry-backed account/session views
minecraft/gateway   Velocity plugin and login gate
minecraft/companion Paper plugin for diagnostics and backend visibility
protocol/           OpenAPI, JSON Schema, claim schemas, fixtures
ops/local           Docker and smoke-test tooling
tools               Repository checks and release packaging
```

## Login Path

1. A player joins through Velocity.
2. The gateway checks whether the player already has a valid Sail session.
3. If not, the gateway creates an auth challenge through the registry.
4. In `kick` mode the player rejoins after completing browser auth. In `limbo`
   and `hybrid` local-name flows, the player waits in a LimboAPI virtual server.
5. The player completes the browser/OAuth step.
6. The registry issues an ES256 Sail session token.
7. The gateway verifies the token and allows the player onto the backend.
8. The gateway forwards a `sail.identity.v1` profile property to Paper.
9. The Paper companion reads that property for commands, diagnostics, and
   backend integrations.

The backend Paper server is not trusted to authenticate Sail users by itself.
It only consumes metadata that Velocity has already accepted.

`kick`, `limbo`, and `hybrid` are gateway modes, not Paper companion behavior.
`limbo` and `hybrid` require the LimboAPI Velocity plugin at runtime. Hybrid is
premium-authority first: premium-name conflicts use Velocity online-mode auth,
while local Sail identities use the limbo wait-room flow and fail closed if the
registry cannot make a clear decision.

## Registry

The registry exposes discovery, server records, auth challenges, Minecraft
session verification, console profile data, and session revocation. The API
contract is kept in `protocol/openapi/sail-registry.v1.openapi.json`; the
runtime implementation lives in `platform/registry`.

State can run in memory for local development or in PostgreSQL for durable
tests and deployments. PostgreSQL migrations are in
`platform/registry/migrations`.

## Protocol

Protocol files are versioned because the same contracts are consumed by
TypeScript, Velocity, Paper, release tooling, and external deployments.

- `protocol/openapi` describes the registry HTTP surface.
- `protocol/schemas` contains request and response JSON schemas.
- `protocol/claims` contains signed claim and session token schemas.
- `protocol/fixtures` keeps known-good examples for tests and smoke runs.
- `protocol/errors/catalog.v1.json` keeps stable error codes and messages.

Run `pnpm protocol:check` before changing any protocol file.

## Release Boundary

This repository is Sail Generic. It builds the registry, console, gateway jar,
companion jar, protocol contracts, and alpha release bundle.

Deployment-specific branding, public landing pages, infrastructure settings,
and public download pages belong outside this repository. A deployment repo can
consume the bundle produced by:

```sh
pnpm release:alpha
```
