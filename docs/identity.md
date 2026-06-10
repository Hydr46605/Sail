# Identity

Sail protects Minecraft names without adding `/register` and `/login`
passwords to chat. Premium names remain owned by Mojang/Microsoft accounts.
Local Sail identities are separate identities with their own proof and trust
level.

## Authorities

| Authority | Meaning |
| --- | --- |
| Mojang/Microsoft | The player owns the premium Minecraft profile. |
| Sail registry | The player completed the registry auth flow for a local name. |
| Trusted registry | A server owner explicitly trusts another registry. |
| Local registry | A self-hosted registry trusted only by servers that configure it. |

The important rule is simple: a local Sail claim is not a Mojang account. It can
authorize play on configured offline-mode networks, but it must not be shown as
premium ownership.

## Claim Types

| Claim type | Use |
| --- | --- |
| `MINECRAFT_VERIFIED` | Premium ownership verified through Mojang/Microsoft. |
| `SAIL_GLOBAL` | Official Sail registry claim. |
| `FEDERATED_TRUSTED` | Claim from a registry the server owner trusts. |
| `LOCAL_SOFT` | Self-hosted local/offline claim. |
| `SOCIAL_ONLY` | Console/social identity with no Minecraft name authority. |

The alpha registry currently exercises local Sail claims and the premium-name
reservation path. Trust labels exist in the protocol so the gateway and console
do not need another contract change when more claim sources are enabled.

## Name Protection

Local claims are blocked for known premium names. That prevents an offline
player from taking a name that belongs to a Mojang/Microsoft account.

The registry checks Mojang profile lookup before accepting a local claim. Positive
and negative lookup results are cached through registry configuration.

## Sessions

Sail sessions are signed ES256 tokens. A session token contains:

- the registry issuer,
- the server id,
- the player UUID and display name,
- the claim id,
- the claim type and identity type,
- issue and expiry timestamps.

The gateway verifies the signature and claims before allowing login. Session
revocation is handled by the registry and exposed to the console.

## Paper Metadata

After a gateway login succeeds, Velocity forwards a compact
`sail.identity.v1` property to the backend. The companion rejects malformed
metadata and refuses payloads that contain the raw session token.

Paper integrations should treat this metadata as display and diagnostics data.
Authentication still belongs at the gateway.

