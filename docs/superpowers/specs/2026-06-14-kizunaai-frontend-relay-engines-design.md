# KizunaAI Frontend: Translate + Volcengine Relay Engines (replacing the Realtime path)

**Date:** 2026-06-14
**Status:** Design — pending review
**Repo:** `sokuji-react` (frontend). Depends on the backend relay PR (`sokuji-backend#7`) shipping first.

## Goal

Re-point the KizunaAI provider off the OpenAI **Realtime** proxy and onto the two new server-side relay engines added in `sokuji-backend`:

- **Translate engine** → `wss://<backend>/v1/realtime/translations` (OpenAI Translate, JSON)
- **Doubao engine** → `wss://<backend>/v1/ast/translate` (Volcengine AST 2.0, binary protobuf)

The relay holds the real provider credentials; the browser authenticates with its **Better Auth session token**. The old `KIZUNA_AI` realtime path (`OpenAIClient` + `gpt-realtime-mini` against `getApiUrl()`) is removed.

## Modeling decision (chosen)

**Single `KIZUNA_AI` provider + a `kizunaEngine` sub-setting** (`'translate' | 'doubao'`), not two new `Provider` enum values. KizunaAI stays one dropdown entry; a sub-selector chooses the engine. `ClientFactory` routes `KIZUNA_AI` to the correct relay client based on `kizunaEngine`. This keeps the enum and the provider list untouched and confines the change to the KizunaAI settings slice + factory.

## Architecture

### 1. "Relay mode" for the two existing clients (reuse, don't duplicate)

Both target clients already speak the right protocols; today they hardcode the upstream URL and authenticate with a provider key. We add an optional **relay config** so the same client can talk to our relay instead:

- **`OpenAITranslateGAClient`** — gains an optional `relay?: { wsUrl: string }`. In relay mode it (a) connects to `relay.wsUrl` instead of `wss://api.openai.com/v1/realtime/translations`, and (b) sends the auth subprotocol as `sokuji-auth.<sessionToken>` instead of `openai-insecure-api-key.<key>` (the `apiKey` constructor arg carries the session token). Everything else (`session.update`, audio I/O, event handling) is unchanged.
- **`VolcengineAST2Client`** — gains a relay mode where it (a) connects to the relay `wsUrl`, (b) authenticates via the `sokuji-auth.<sessionToken>` subprotocol, and (c) **skips the `webRequest`/`declarativeNetRequest` header-injection entirely** (the relay sets `X-Api-*` upgrade headers server-side). protobuf encode/decode + audio I/O unchanged.

Only the WS transport endpoint and auth change. The message/audio logic — the hard part — is untouched.

### 2. Token transport

The browser cannot set `Authorization` on a WS upgrade, so the session token rides in the `Sec-WebSocket-Protocol` header as `sokuji-auth.<token>` (the format the backend `relayAuthMiddleware` parses). The token is obtained the same way the app already does it for KizunaAI today — via the auth `getToken()` flow that currently feeds `settingsStore.validateApiKey` — and passed into `ClientFactory` as `apiKey` (mirroring the existing `KIZUNA_AI` case, where `apiKey` is already the session token).

### 3. Relay URL helper

Add `getRelayWsUrl()` to `src/utils/environment.ts`: derive from `getBackendUrl()` (`https://sokuji.kizuna.ai` or `VITE_BACKEND_URL`), swap `http(s)` → `ws(s)`, and append `/v1`. Callers build `${getRelayWsUrl()}/realtime/translations` and `${getRelayWsUrl()}/ast/translate`.

### 4. ClientFactory routing

```
case Provider.KIZUNA_AI:
  if (!isKizunaAIEnabled()) throw ...
  if (kizunaEngine === 'doubao')
    return new VolcengineAST2Client(/* relay mode */ { wsUrl: `${getRelayWsUrl()}/ast/translate`, sessionToken: apiKey });
  return new OpenAITranslateGAClient(apiKey, { wsUrl: `${getRelayWsUrl()}/realtime/translations` });
```
The `kizunaEngine` value is threaded from the caller (it already passes `model`, `apiKey`, etc. into `createClient`). The old `return new OpenAIClient(apiKey, getApiUrl())` realtime line is deleted.

### 5. Settings (`settingsStore`)

- Add `kizunaEngine: 'translate' | 'doubao'` to the KizunaAI settings slice (default `'translate'`).
- The per-engine session parameters **reuse the existing settings shapes**: the translate engine builds its session config like `OPENAI_TRANSLATE` (model `gpt-realtime-translate`, transcript/turn-detection settings already defined for translate); the doubao engine builds its config like `VOLCENGINE_AST2`. KizunaAI does not invent a third settings schema — it selects which existing engine config to feed the relay client.
- Remove the realtime-only KizunaAI defaults (`gpt-realtime-mini`, realtime transcript model, etc.).
- `validateApiKey` for `KIZUNA_AI`: availability stays gated on being signed in + token available (unchanged auth check); the engine selection doesn't affect readiness.

### 6. UI (`SimpleConfigPanel`)

Add an engine selector (Translate / Doubao) in the KizunaAI section, visible only when the provider is KizunaAI. Selecting an engine swaps which downstream settings (translate vs doubao) are shown. Reuse the existing translate/volcengine setting controls.

### 7. What is removed / what stays

- **Removed:** the `KIZUNA_AI → OpenAIClient(token, getApiUrl())` realtime path and its `gpt-realtime-*` model defaults; the realtime KizunaAI model list.
- **Stays:** the user-managed `OPENAI_TRANSLATE` and `VOLCENGINE_AST2` providers (unchanged — they still use their own keys, `EphemeralTokenService`, and the Volcengine header-injection). `EphemeralTokenService` is NOT removed; only the KizunaAI translate engine bypasses it (the relay mints nothing client-side).

## Data flow

```
KizunaAI (engine = translate)
  ClientFactory → OpenAITranslateGAClient(sessionToken, { wsUrl: <relay>/realtime/translations })
    → WS connect, subprotocol ['realtime', 'sokuji-auth.<token>']
    → relay authenticates, opens upstream OpenAI Translate with server key, meters → wallet

KizunaAI (engine = doubao)
  ClientFactory → VolcengineAST2Client(relay mode { wsUrl: <relay>/ast/translate, sessionToken })
    → WS connect, subprotocol 'sokuji-auth.<token>', NO header injection
    → relay sets X-Api-* upstream, relays protobuf, meters Billing.DurationMsec → wallet
```

## Error handling

- Relay rejects (401 no/invalid token, 402 insufficient, 403 frozen, 503 wallet error) surface as connection failures / error events the existing clients already handle; map them to the existing logStore error surfacing.
- No-interruption rule preserved: nothing in relay mode adds client-side audio gating.

## Testing

- Unit: `getRelayWsUrl()` (http→ws, /v1 suffix, VITE_BACKEND_URL override). Relay-mode subprotocol construction for `OpenAITranslateGAClient` (asserts `sokuji-auth.<token>` and relay URL). `VolcengineAST2Client` relay mode skips header injection (assert no `webRequest`/DNR registration call) and uses the relay URL + subprotocol.
- Existing `OpenAITranslateGAClient.test.ts` / `VolcengineAST2Client.test.ts` stay green (user-managed mode unchanged).
- ClientFactory: `KIZUNA_AI` + `kizunaEngine` routes to the right relay client.

## Open questions

1. Exact mechanism to thread `kizunaEngine` into `ClientFactory.createClient` (new optional param vs derive from `model`) — resolve when reading the createClient call sites.
2. How the KizunaAI settings slice composes the translate vs doubao engine configs (reuse `openaiTranslate`/`volcengineAST2` slices vs nested kizuna sub-settings) — resolve against the current `KizunaAISettings` shape during planning.
3. Whether WebRTC has any KizunaAI role — NO: relay is WS-only, so KizunaAI uses the GA (WS) translate client; WebRTC stays user-managed `OPENAI_TRANSLATE` only.

## Non-goals

- No change to user-managed `OPENAI_TRANSLATE` / `VOLCENGINE_AST2` providers.
- No change to other providers (OpenAI, Gemini, Palabra, Local Inference).
- No backend changes (covered by `sokuji-backend#7`).
