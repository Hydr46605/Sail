# Sail Roadmap

## Visione

Sail è un identity provider per Minecraft con un gateway Velocity come client privilegiato.
I player creano un account Sail (OAuth) e possono registrare un server Minecraft (1 per account).
La registrazione genera un'API key che autentica il gateway presso il registry.

L'admin di istanza Sail è un ruolo futuro opzionale — il base flow è self-service.

---

## Tier 1 — Fondazione Account

| # | Cosa | Perché |
|---|------|--------|
| 1 | **Console UI per account self-service** | Oggi la console mostra solo profilo. Serve "Get Started" per creare account, registrare server, gestire API key. |
| 2 | **Rate limiting middleware sul registry** | Prima di aprire endpoint pubblici (account, challenge, server), il registry deve saper dire "no" ad abuso. Middleware generico su Fastify. |
| 3 | **Multi-OAuth** | Senza OAuth multiplo i player non possono creare account. **Nota: Microsoft OAuth richiede registrazione Azure / pay-to-own. Priorità su provider gratuiti (Discord OK, poi GitHub, Google).** |

## Tier 2 — Server Registration

| # | Cosa | Dettaglio |
|---|------|-----------|
| 4 | `POST /v1/servers` endpoint | Player autenticato (via console, con account Sail) registra un server. Endpoint validato + rate-limited. |
| 5 | **Console: Server Registration UI** | Scegli server_id, display_name. Limite: 1 server per account. |
| 6 | **API key generation** | Alla registrazione, il registry genera una API key legata a server_id + account_id. |
| 7 | **3 delivery methods** | Sulla console: (a) Copia API key → config.yml, (b) `/sail code` → codice da incollare, (c) `/sail setup <key>` → abbinamento diretto. |

## Tier 3 — Gateway Autenticato

| # | Cosa | Dettaglio |
|---|------|-----------|
| 8 | **Gateway config: `registry.api-key`** | Nuovo campo opzionale. Se presente, lo manda in ogni richiesta al registry. |
| 9 | **Registry valida API key** | Su challenge creation, session verify, heartbeat — controlla key valida per quel server_id. |
| 10 | **Server heartbeat (`POST /v1/servers/heartbeat`)** | Gateway periodicamente segnala "sono vivo" al registry. |
| 11 | **Challenge authorization** | Rate limiting per-challenge basato sull'API key del gateway. |

## Tier 4 — Admin Layer (Futuro)

| # | Cosa | Dettaglio |
|---|------|-----------|
| 12 | **Ruolo "Sail admin" su account** | Flag `is_admin` su accounts table. |
| 13 | **Review queue su console** | Admin vede server "pending" e approva/rifiuta. |
| 14 | **Admin dashboard** | Stats, server attivi, challenge rate, sessioni attive. |

## Tier 5 — Polishing & Completezza

| # | Cosa | Dettaglio |
|---|------|-----------|
| 15 | **Revoca real-time** | Webhook/WS per invalidare cache sessioni sul gateway. |
| 16 | **Name Lookup API** | Endpoint già schemato (`name-lookup.v1.schema.json`) ma non implementato. |
| 17 | **Limbo tests** | `SailLimboApiController` ha zero test. |
| 18 | **Gateway Jackson removal** | Gateway ha ancora Jackson per bridge serialization (shaded nel jar — priorità bassa). |
