# Security Policy

Sail is an alpha project, but security issues should still be handled privately.

## Supported Versions

| Version | Supported |
| --- | --- |
| `0.1.0-alpha.1` | Yes |

## Reporting a Vulnerability

Do not open a public issue for vulnerabilities.

Use GitHub private vulnerability reporting for this repository. If that option
is not available, open a minimal issue asking for a private maintainer contact
without including exploit details, keys, tokens, logs, or player data.

Useful reports include:

- affected component,
- exact version or commit,
- reproduction steps,
- expected impact,
- whether keys, sessions, names, or player data are exposed.

## Scope

Security-sensitive areas include registry signing keys, session token
verification, premium-name protection, OAuth callback handling, Velocity
forwarding, and any path that could let a Paper backend trust unverified
identity metadata.

Local development defaults, including the dev signing key and local PostgreSQL
password, are not production secrets. The built-in dev signing key is public on
purpose so local registry and gateway defaults can work together; never use it
for a persistent or public registry.
