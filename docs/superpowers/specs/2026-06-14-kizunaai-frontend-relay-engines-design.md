# KizunaAI Frontend: Two Relay-Managed Providers (replacing the Realtime path)

**Date:** 2026-06-14 (revised — two-provider model)
**Status:** Design — pending review
**Repo:** `sokuji-react` (frontend). Depends on the backend relay PR (`sokuji-backend#7`).

## Goal

Replace the single realtime `KIZUNA_AI` provider with **two new providers**, each the **relay-managed twin** of an existing user-managed provider:

- **`KIZUNA_AI_OPENAI_TRANSLATE`** (`'kizunaai_openai_translate'`) — twin of `OPENAI_TRANSLATE`, routed through `wss://<backend>/v1/realtime/translations`.
- **`KIZUNA_AI_VOLCENGINE_AST2`** (`'kizunaai_volcengine_ast2'`) — twin of `VOLCENGINE_AST2`, routed through `wss://<backend>/v1/ast/translate`.

The relay holds the real provider credentials; the browser authenticates with its **Better Auth session token**. The old `KIZUNA_AI` realtime path (`OpenAIClient` + `gpt-realtime-mini` against `getApiUrl()`) is removed.

## Why two providers (decided)

Modeling each engine as a first-class `Provider` (rather than one provider + an engine sub-setting) is the more elegant architecture: the provider enum already carries the routing, so `ClientFactory.createClient` needs **no engine parameter** (its signature is unchanged), `createSessionConfig` gets two ordinary `case`s, settings/validation/UI all follow the existing per-provider pattern with **zero bespoke "sub-engine" logic**. The cost is breadth (KIZUNA_AI appears in 14 files, each converted mechanically) and two dropdown entries — both accepted.

## Core principle: "relay-managed twin"

Each `KIZUNA_AI_*` provider behaves **exactly** like its base provider, except:
1. **Auth:** Better Auth session token (auto-fetched), not a user-entered key — `requiresAuth: true`.
2. **Endpoint:** the relay WS URL, not the provider's direct URL.
3. **No credential UI:** hide the API-key / appId / accessToken inputs.

So the implementation maximizes reuse: same settings interfaces, same session-config builders, same clients (with relay mode), same UI controls — only the credential sourcing, endpoint, and a couple of UI gates differ.

## Architecture

### 1. Provider enum (`src/types/Provider.ts`)

- Remove `KIZUNA_AI`. Add `KIZUNA_AI_OPENAI_TRANSLATE` and `KIZUNA_AI_VOLCENGINE_AST2` (with the `kizunaai_` string values above), in `ProviderType`, `SUPPORTED_PROVIDERS` (gated by `isKizunaAIEnabled()`, replacing the old `KIZUNA_AI` entry), and remove `KIZUNA_AI` from `OPENAI_COMPATIBLE_PROVIDERS`.
- Add helper predicates:
  - `isKizunaManagedProvider(p)` → true for the two new providers.
  - `kizunaBaseProvider(p)` → `OPENAI_TRANSLATE` | `VOLCENGINE_AST2` (the base whose behavior/UI to reuse). Lets call sites write `provider === OPENAI_TRANSLATE || kizunaBaseProvider(provider) === OPENAI_TRANSLATE`.

### 2. Relay mode for the two clients (unchanged from the protocol work)

- **`OpenAITranslateGAClient`** — optional `relay?: { wsUrl: string }`: connect to `relay.wsUrl` with subprotocol `['realtime', 'sokuji-auth.<sessionToken>']` (the `apiKey` arg carries the token) instead of the OpenAI URL + `openai-insecure-api-key.<key>`.
- **`VolcengineAST2Client`** — optional `relay?: { wsUrl, sessionToken }`: skip the `webRequest`/`declarativeNetRequest` header-injection, connect to `relay.wsUrl` with subprotocol `sokuji-auth.<sessionToken>`.

Message/audio logic untouched. User-managed mode is entered only when `relay` is absent.

### 3. ClientFactory (`src/services/clients/ClientFactory.ts`)

Two new cases; **signature unchanged**:
```
case Provider.KIZUNA_AI_OPENAI_TRANSLATE:
  if (!isKizunaAIEnabled()) throw ...
  return new OpenAITranslateGAClient(apiKey, { wsUrl: `${getRelayWsUrl()}/realtime/translations` });

case Provider.KIZUNA_AI_VOLCENGINE_AST2:
  if (!isKizunaAIEnabled()) throw ...
  return new VolcengineAST2Client('', '', undefined, { wsUrl: `${getRelayWsUrl()}/ast/translate`, sessionToken: apiKey });
```
`apiKey` is the session token (sourced as today's `KIZUNA_AI` does). The old `KIZUNA_AI → OpenAIClient(...)` case is deleted.

### 4. Settings (`src/stores/settingsStore.ts`)

- Add two store slices reusing the existing interfaces: `kizunaOpenaiTranslate: OpenAITranslateSettings` and `kizunaVolcengineAst2: VolcengineAST2Settings`, with defaults cloned from the existing defaults (the credential fields stay but are unused — auth is the session token).
- Remove the `kizunaai: KizunaAISettings` slice, `KizunaAISettings` alias, and `defaultKizunaAISettings`.
- `getCurrentProviderSettings`: +2 cases returning the new slices; remove the `KIZUNA_AI` case.
- `createSessionConfig`: +2 cases calling the **existing** builders with the new slices:
  - `KIZUNA_AI_OPENAI_TRANSLATE` → `createOpenAITranslateSessionConfig(state.kizunaOpenaiTranslate, ...)`
  - `KIZUNA_AI_VOLCENGINE_AST2` → `createVolcengineAST2SessionConfig(state.kizunaVolcengineAst2, ...)`
  - remove the `KIZUNA_AI` realtime case.
- Persistence/load: register the two new slices with `loadProviderSettings('settings.kizunaOpenaiTranslate', ...)` etc.; add `updateKizunaOpenaiTranslate` / `updateKizunaVolcengineAst2` actions (mirroring `updateOpenAITranslate` / `updateVolcengineAST2`, but never persisting credential fields).

### 5. Auth-token sourcing (generalize the existing KizunaAI auth)

The session-token flow is currently `KIZUNA_AI`-specific (`ensureKizunaApiKey`, and `provider === KIZUNA_AI` checks at validateApiKey lines ~1214/1251 and MainPanel apiKey extraction). Generalize all three to `isKizunaManagedProvider(provider)` so both new providers fetch the token via `getAuthToken()` / `ensureKizunaApiKey`. Readiness stays "signed in → available."

### 6. Provider configs (`ProviderConfigFactory` + two new config classes)

- `KizunaAIOpenAITranslateProviderConfig extends OpenAITranslateProviderConfig` — overrides `id: 'kizunaai_openai_translate'`, `displayName: 'KizunaAI Translate'`, `requiresAuth: true`, credential-label/placeholder set to "managed automatically".
- `KizunaAIVolcengineAST2ProviderConfig extends VolcengineAST2ProviderConfig` — overrides `id: 'kizunaai_volcengine_ast2'`, `displayName: 'KizunaAI Doubao'`, `requiresAuth: true`.
- Register both in `ProviderConfigFactory` (gated by `isKizunaAIEnabled()`); remove `KizunaAIProviderConfig` registration. Delete the old `KizunaAIProviderConfig`.

### 7. UI

- `ProviderSection.tsx` (provider dropdown): the two new providers appear via `SUPPORTED_PROVIDERS` automatically; verify labels/icons.
- `ProviderSpecificSettings.tsx` + `LanguageSection.tsx`: wherever a section renders for `OPENAI_TRANSLATE` / `VOLCENGINE_AST2`, include the corresponding kizuna twin (use `kizunaBaseProvider(provider)`), reading/writing the new slices. **Hide the credential inputs** (apiKey/appId/accessToken) when `isKizunaManagedProvider(provider)` — auth is automatic.

### 8. Migration

Existing users have `settings.provider === 'kizunaai'` (the removed value) and a `settings.kizunaai` slice. On load (`SettingsInitializer` / store load), migrate a stored `'kizunaai'` provider to `'kizunaai_openai_translate'` (default engine), and carry over `sourceLanguage`/`targetLanguage` from the old `kizunaai` slice into `kizunaOpenaiTranslate` if present. Drop the rest (realtime-only fields).

### 9. Other touch points (mechanical)

`MainPanel.tsx`, `ClientOperations.ts`, `SettingsInitializer.tsx`, `MainLayout.tsx`, `OnboardingContext.tsx`, `vite-env.d.ts`, `environment.ts` — each has a `KIZUNA_AI` reference that becomes "the two new providers" (or `isKizunaManagedProvider`). Convert per the twin principle.

## Data flow

```
Provider KIZUNA_AI_OPENAI_TRANSLATE
  apiKey = session token (ensureKizunaApiKey / getAuthToken)
  ClientFactory → OpenAITranslateGAClient(token, { wsUrl: <relay>/realtime/translations })
    → WS, subprotocol ['realtime','sokuji-auth.<token>'] → relay → OpenAI Translate (server key) → meter

Provider KIZUNA_AI_VOLCENGINE_AST2
  apiKey = session token
  ClientFactory → VolcengineAST2Client('', '', undefined, { wsUrl: <relay>/ast/translate, sessionToken: token })
    → WS, subprotocol 'sokuji-auth.<token>', no header injection → relay → Volcengine (server creds) → meter
```

## Error handling

Relay rejects (401/402/403/503) surface as connection failures / error events the clients already handle → logStore. No-interruption rule unaffected.

## Testing

- Unit: `getRelayWsUrl()`; relay-mode subprotocol/URL for both clients; `isKizunaManagedProvider`/`kizunaBaseProvider`; ClientFactory routes the two new providers to the right relay clients; `createSessionConfig` produces the right `provider`-tagged config for each.
- Existing `OpenAITranslateGAClient` / `VolcengineAST2Client` / user-managed-provider tests stay green.
- Migration: a stored `'kizunaai'` provider loads as `'kizunaai_openai_translate'`.

## Non-goals

- No change to user-managed `OPENAI_TRANSLATE` / `VOLCENGINE_AST2` (keys, `EphemeralTokenService`, Volcengine header injection all intact).
- No change to other providers.
- No backend changes (`sokuji-backend#7`).
- WebRTC is out for KizunaAI (relay is WS-only); both new providers force `transportType: 'websocket'`.
