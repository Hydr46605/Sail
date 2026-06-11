# Configuration

The defaults are aimed at local development. Persistent registries and public
deployments need explicit storage and signing-key settings.

## Registry

Common registry environment variables:

| Variable | Default | Notes |
| --- | --- | --- |
| `SAIL_REGISTRY_HOST` | `127.0.0.1` | Bind host. |
| `SAIL_REGISTRY_PORT` | `8787` | Bind port. |
| `SAIL_REGISTRY_API_URL` | `http://<host>:<port>` | Public API base URL. |
| `SAIL_REGISTRY_AUTH_URL` | `<api>/auth/minecraft` | Browser auth URL. |
| `SAIL_REGISTRY_STATE_BACKEND` | `memory` | `memory` or `postgres`. |
| `SAIL_REGISTRY_DATABASE_URL` | local dev URL | PostgreSQL connection string. |
| `SAIL_REGISTRY_ID` | `sail-local` | Stable registry id. |
| `SAIL_REGISTRY_NAME` | `Sail Local Registry` | Display name. |
| `SAIL_REGISTRY_TRUST_STATUS` | `self_hosted` | `global`, `self_hosted`, `trusted_by_admin`, `unverified`. |
| `SAIL_REGISTRY_PUBLIC_KEY_PINNING` | `true` | Publishes the active signing key for clients. |
| `SAIL_BLOCK_PREMIUM_NAMES_FOR_LOCAL` | `true` | Blocks local claims for premium names. |
| `SAIL_CONSOLE_URL` | unset | Optional console URL in registry responses. |

Server defaults created by the registry:

| Variable | Default |
| --- | --- |
| `SAIL_SERVER_ID` | `local-survival` |
| `SAIL_SERVER_DISPLAY_NAME` | `Local Survival` |
| `SAIL_SERVER_REGISTRY_MODE` | `self_hosted` |
| `SAIL_SERVER_SESSION_REUSE_POLICY` | `same_registry` |
| `SAIL_SERVER_PRIVACY_MODE` | `minimal` |
| `SAIL_SERVER_PUBLIC_LISTING` | `false` |

OAuth settings:

| Variable | Notes |
| --- | --- |
| `SAIL_OAUTH_DEV_ENABLED` | Enables the local dev OAuth shortcut. |
| `SAIL_OAUTH_DISCORD_ENABLED` | Enables Discord OAuth. |
| `SAIL_OAUTH_DISCORD_CLIENT_ID` | Required when Discord OAuth is enabled. |
| `SAIL_OAUTH_DISCORD_CLIENT_SECRET` | Required when Discord OAuth is enabled. |
| `SAIL_OAUTH_DISCORD_REDIRECT_URI` | Defaults to `<api>/auth/discord/callback`. |

## Gateway

The Velocity plugin writes this shape when no config file exists:

```yaml
sail:
  trust-posture: "local-dev"

  registry:
    mode: "self-hosted"
    api-url: "http://127.0.0.1:8787"
    registry-id: "sail-local"
    public-key-pinning: false
    trusted-keys: []

  server:
    id: "local-survival"
    display-name: "Local Survival"

  login-flow:
    unauthenticated-action: kick
    auth-timeout-seconds: 180
    allow-rejoin-after-auth: true
    auth-url-template: "http://127.0.0.1:8787/auth/minecraft?code={code}"

  backend:
    require-modern-forwarding: true
    fail-if-forwarding-secret-missing: true
    target-server: "local-survival"

  limbo:
    poll-interval-seconds: 2
```

The generated gateway config is local-development oriented. Operators who point
the gateway at Sail Global or another public registry must enable
`public-key-pinning` and provide trusted public keys.

`unauthenticated-action` supports:

- `kick`: creates a browser auth challenge, kicks the player with the URL/code,
  and accepts the verified Sail profile on rejoin.
- `limbo`: requires the LimboAPI Velocity plugin. The gateway lets the player
  enter a Sail virtual limbo, polls the registry, applies the verified
  `sail.identity.v1` profile property when auth completes, then connects the
  player to `backend.target-server`.
- `hybrid`: requires the LimboAPI Velocity plugin. Premium-name conflicts are
  routed to Velocity online-mode auth; local Sail names use the limbo wait-room
  flow. Ambiguous or failed registry decisions fail closed.

When `limbo` or `hybrid` is configured and LimboAPI is missing or incompatible,
the gateway refuses to initialize instead of silently downgrading behavior.

## Paper Companion

The companion config is intentionally small:

```yaml
sail:
  companion:
    warn-on-missing-identity: true
    warn-on-direct-join-risk: true
    command-permission: "sail.companion.admin"
```

Commands:

- `/sailpaper status`
- `/sailpaper lookup <player>`
- `/sailpaper reload`
- `/sailcompanion` as an alias

The permission node is `sail.companion.admin`.

## Console

The console reads the registry URL from `VITE_SAIL_REGISTRY_API_URL`. The local
dev command is:

```sh
pnpm --filter @sail/console dev
```
