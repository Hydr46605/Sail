# Security

Sail treats registry signing keys as production secrets. A registry that signs
sessions with a weak or leaked key can mint identities that gateways may accept.

## Signing Keys

The registry signs Sail session tokens with ES256. Key material can come from:

| Source | Use |
| --- | --- |
| `dev` | Local development only. |
| `env` | Explicit JWK values in environment variables. |
| `file` | A JSON private JWK read from disk. |

Production mode and `SAIL_REGISTRY_TRUST_STATUS=global` reject the built-in dev
key. PostgreSQL registries also reject the dev key unless
`SAIL_REGISTRY_ALLOW_DEV_SIGNING_KEY=true` is set for a deliberate local test.

## Environment Key Source

Set:

```sh
SAIL_REGISTRY_SIGNING_KEY_SOURCE=env
SAIL_REGISTRY_JWK_KID=<key-id>
SAIL_REGISTRY_JWK_X=<public-x>
SAIL_REGISTRY_JWK_Y=<public-y>
SAIL_REGISTRY_JWK_D=<private-d>
```

Do not commit these values. Treat `SAIL_REGISTRY_JWK_D` as the private key.

## File Key Source

Set:

```sh
SAIL_REGISTRY_SIGNING_KEY_SOURCE=file
SAIL_REGISTRY_SIGNING_KEY_FILE=/path/to/private-jwk.json
```

The file must contain a private P-256 JWK with `kid`, `x`, `y`, and `d`. Keep it
outside the repository and restrict filesystem permissions. The registry rejects
insecure key files unless `SAIL_REGISTRY_ALLOW_INSECURE_KEY_FILE=true` is set.

## Rotation

`SAIL_REGISTRY_SIGNING_KEY_ROTATION=rotate` enables the registry rotation path.
The registry records signing-key lifecycle state in PostgreSQL through the
`0005_signing_key_lifecycle.sql` migration.

Operational rotation is:

1. add the new key,
2. publish the new public key,
3. keep the previous key trusted until active sessions expire,
4. revoke the old key,
5. restart gateways with the updated trusted-key set when pinning is enabled.

## Gateway Trust

Gateways can pin trusted public keys in their Velocity config. Keep pinning on
for real networks. With pinning enabled, a compromised registry URL alone is not
enough; the attacker also needs a trusted private key.

Unpinned gateway verification is a local-development posture only. Public or
global registry deployments must enable pinning and load trusted public keys so
the gateway fails closed when key material is missing.

## Backend Boundary

The Paper companion must not receive session tokens. It only receives the
already-verified `sail.identity.v1` metadata forwarded by Velocity. The
companion parser rejects payloads that include `session_token`.
