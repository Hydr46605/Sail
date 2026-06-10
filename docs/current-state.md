# Current State

Sail is an alpha monorepo. The main pieces build and test together, and the
local smoke path covers the registry, Velocity gateway, Paper companion, console
bundle, PostgreSQL, and release packaging.

## Working Pieces

- Protocol contracts in `protocol/`.
- Registry API in `platform/registry`.
- PostgreSQL migrations and database tests.
- Velocity gateway with signed Sail session verification.
- Paper companion with identity diagnostics and admin commands.
- Console alpha in `platform/console`.
- Local Docker PostgreSQL setup in `ops/local/compose.yml`.
- API-only and full local smoke tooling in `ops/local/smoke-local.mjs`.
- Alpha release bundling through `pnpm release:alpha`.
- GitHub Actions checks for TypeScript, protocol validation, Java tests, and
  PostgreSQL registry tests.

## Alpha Limits

- The built-in dev signing key is for local development only.
- OAuth is present for local/dev and Discord-backed flows; production provider
  setup is deployment-specific.
- The Paper companion is not an authentication layer.
- Sail Generic does not contain public landing pages or production deployment
  branding.
- Public trust policy, abuse handling, and registry governance are deployment
  responsibilities, not generic runtime behavior.

## Verification Baseline

Use this baseline before changing runtime behavior:

```sh
pnpm check
pnpm test
./gradlew test
```

Use the PostgreSQL check before changing persistence or session behavior:

```sh
just db-up
pnpm --filter @sail/registry db:migrate
pnpm test:db
just db-down
```

Use full smoke only when the local Minecraft runtime cost is acceptable:

```sh
node ops/local/smoke-local.mjs
```

