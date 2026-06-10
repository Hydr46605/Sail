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
  registry:
    mode: "self-hosted"
    api-url: "http://127.0.0.1:8787"
    registry-id: "my-network"
    public-key-pinning: true
    trusted-keys:
      - kid: "dev-es256-2026-06"
        alg: "ES256"
        crv: "P-256"
        x: "0WamuH-EnCrBXIQwPZo2ZKfwNV9OW9EDkzr4YzscxcY"
        y: "0wFxw0l_9Rziux_ZQboPeCkBi5oLibu_5GocXtVUURo"

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
```

`unauthenticated-action` accepts `kick`, `limbo`, or `hybrid`.

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

