# Palabra Platform API Key (Dual Auth Mode) — Design

**Date**: 2026-07-30
**Status**: Approved (brainstormed with user; protocol facts verified against Palabra docs + OpenAPI spec, live smoke test pending)

## Summary

Palabra split its developer offering into the legacy **app** (app.palabra.ai, `ClientId`/`ClientSecret` header pair) and the new **platform** (platform.palabra.ai, single API key via `Authorization: Bearer`). Sokuji currently supports only app credentials. This design adds platform API key support as a second auth mode on the existing `palabraai` provider — same client, same provider, only the auth header construction is parameterized. Users holding both credential kinds can switch freely; all three credential values persist independently.

Out of scope: voice selection ([#367](https://github.com/kizuna-ai-lab/sokuji/issues/367)), the WebSocket streaming transport, clone-upload UI, removing app mode.

## Verified protocol facts (2026-07-30)

Verified against `platform.palabra.ai/docs` and `https://api.palabra.ai/docs/openapi.json` (spec saved during research). Live verification with a real key is the first implementation step.

- Both auth modes hit the **same host and endpoints**: `POST/GET/DELETE https://api.palabra.ai/session-storage/session[s]`. Only the auth headers differ:
  - app: `ClientId: <id>` + `ClientSecret: <secret>` (spec's securitySchemes still declare these)
  - platform: `Authorization: Bearer <API_KEY>` (all platform docs; old docs site pages are being migrated to Bearer too)
- Session create response (`CreateSessionResponseDataV2`) carries exactly the fields the client already reads: `publisher` (JWT), `webrtc_url`, `ws_url`, `webrtc_room_name`, `intent`, `id`. The `subscriber` field is deprecated upstream; we never used it.
- Session create request schema (`CreateSessionRequestV2`) now only accepts `intent` and `aggregation_id`. Our `subscriber_count: 0` is a dead field (ignored server-side).
- Everything after session creation — LiveKit room join with `webrtc_url` + `publisher` JWT, `set_task` / `end_task` over the data channel, all transcription message types — is byte-identical between the two modes. The `livekit-client` 2.18.7 exact pin stays untouched.
- Palabra does not document an API key format/prefix; auth mode cannot be inferred from the key's shape.
- Dual-auth coexistence on api.palabra.ai is current fact, not a documented commitment. Whichever side Palabra sunsets, this design only loses one branch.

## Decisions

| Decision | Choice |
|---|---|
| Provider shape | Same provider, same client. Auth header construction parameterized. New provider/client rejected: protocols are identical, splitting doubles language-enum/swap-chain/locale maintenance. |
| Credential UI | Explicit auth mode toggle (Platform API Key / App Client ID+Secret), conditional inputs. Auto-detection rejected: no key format to detect on, muddy error messages. |
| Storage | Flat fields: `authMode` + `apiKey` added; `clientId`/`clientSecret` kept. All three values persist; the toggle only selects which are read. Nested per-mode object rejected (all slices are flat; shallow-merge updates). |
| Default mode | New users: `'platform'`. Existing users: migration pins `'app'` (see below). |
| Descriptor contract | Approach A — reuse the shared `Credentials` type as-is. Platform mode → `{ ok: true, primary: apiKey }` with no `secret`; `createClient` branches on `secret` presence. Widening the shared type with a `variant` discriminator rejected (only Palabra would use it). |
| Cross-mode fallback | Never. A failing credential is never silently retried with the other kind. |

## Data model & migration

`PalabraAISettings` gains:

```typescript
authMode: 'app' | 'platform';  // default 'platform'
apiKey: string;                 // default ''
```

**Migration (required, not optional):** defaults shallow-merge into persisted slices, so an existing user's slice (no `authMode`) would silently become `'platform'` and break them. In the settingsStore load path (near the existing `palabraLanguageMigration` precedent):

- persisted slice has no `authMode` AND (`clientId` or `clientSecret` non-empty) → set `authMode: 'app'`
- persisted slice has no `authMode` and both empty → leave default `'platform'`
- persisted slice already has `authMode` → untouched

## Credential flow (descriptor)

`PalabraAIProviderConfig`:

- `extractCredentials`: branch on `authMode`. Platform requires non-empty `apiKey` → `{ ok: true, primary: apiKey }`. App requires both → unchanged `{ ok: true, primary: clientId, secret: clientSecret }`.
- `peekPrimaryCredential`: returns `apiKey` or `clientId` per mode.
- `createClient`: `creds.secret !== undefined` → app branch, else platform branch; builds the `PalabraCredentials` discriminated union and passes it to the client.
- `validateAndFetchModels`: **delete** the legacy "Both Client ID and Client Secret are required" guard for missing `secret`. It only served the deprecated `ClientOperations` façade (live validation goes `settingsStore.validateApiKey → descriptor.extractCredentials`). Degradation: a hypothetical legacy caller passing a clientId without secret now gets a Bearer 401 instead of the tailored message — acceptable; documented in a comment.

## Client changes

`PalabraAIClient`:

```typescript
type PalabraCredentials =
  | { kind: 'clientCredentials'; clientId: string; clientSecret: string }
  | { kind: 'apiKey'; apiKey: string };
```

- Constructor takes `PalabraCredentials` instead of two positional strings.
- New private `authHeaders(): Record<string, string>` — the single place both header shapes are built.
- Four REST call sites switch to it: static `validateApiKey` (signature also takes the union), `createSession`, `getUserSessions`, `deleteSession`.
- Session create body cleanup: `{ data: { intent: 'api' } }` (drop the dead `subscriber_count`).
- LiveKit pipeline, `set_task` payload, audio worklets, message handling: untouched.

## UI & i18n

- `ProviderSection.tsx` (Palabra block, currently lines ~760–783): add an auth mode toggle; render one API key input (platform) or the existing two inputs (app); validate button disabled per mode (`!apiKey` vs `!clientId || !clientSecret`).
- `SettingsInitializer.tsx` auto-validation effect deps: add `palabraAISettings.authMode` and `palabraAISettings.apiKey`.
- i18n: new keys for the mode labels, API key placeholder, and per-mode required-field error. Repo convention (verified): provider keys are added to all locale files — `providers.palabraai.clientIdPlaceholder` exists in 30 of 32 locales — so the new keys get translated entries in every locale, same as the existing Palabra keys.

## Error handling

- Per-mode required-field messages ("API Key is required for Palabra AI" vs the existing both-required message).
- HTTP errors surfaced exactly as today (`errors[0].detail` parsing).
- No silent cross-mode retry, ever.

## Testing & verification (risk-first)

1. **Smoke test before any UI work** (user has both credential kinds):
   - `curl` with `Authorization: Bearer <platform key>` → `POST /session-storage/session` must return 201 with `publisher`/`webrtc_url` present.
   - A fetch from the extension context to confirm the `Authorization` header passes CORS preflight.
   - If this fails, stop and re-evaluate (e.g. proxy fallback) before building anything.
2. Unit tests:
   - `extractCredentials`: both modes × (complete / missing fields).
   - `createClient` union mapping (secret present/absent).
   - `authHeaders()` both shapes.
   - Migration: three cases (old creds → `'app'`; empty slice → `'platform'`; existing `authMode` untouched).
   - Update `PalabraAIClient.test.ts` constructor call sites.
3. Acceptance: one **real translation session per mode**. Watch for Palabra's signature silent failure — "connected" UI with zero transcriptions — which unit tests cannot catch.
