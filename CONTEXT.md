# CONTEXT.md — Domain Glossary

Domain terms used across Sokuji. Use these names exactly in code, docs, and design discussions.

## Provider domain

- **Provider** — one AI translation backend (OpenAI, Gemini, Palabra, Volcengine ST/AST2, Zoom AI, Kizuna relay twins, Local Inference, OpenAI-compatible). Identified by the `Provider` enum value, which is also the persisted settings key prefix.
- **ProviderDescriptor** — the deep module that answers *every* question about one provider: static config (`getConfig()`), client construction (`createClient`), credential extraction (`extractCredentials`), key validation (`validateAndFetchModels`), latest-model resolution, session-config building (`buildSessionConfig`), language rules (`resolveSourceLanguages` / `resolveTargetLanguages` / `reconcileTarget`), i18n name key, and its `settingsSliceKey`. One class per provider (`XProviderConfig`), registered centrally in the Provider Registry. Adding a provider means writing one descriptor and registering it, plus the small set of things that still live outside the descriptor: a `Provider` enum value, the settings slice type + its update action in `settingsStore`, and locale entries for the provider's name/description (see CLAUDE.md's "Adding a New AI Provider" recipe for the full checklist).
- **Provider Registry** — `ProviderConfigFactory`'s explicit static registration list, the single source of truth for which providers exist and are available on the current platform/build (feature flags and platform gates live only here). No module-side-effect self-registration.
- **Settings slice** — the persisted zustand slice holding one provider's user settings (e.g. `state.zoomAI`). The slice's TypeScript interface and defaults live in that provider's descriptor module; the store imports them. A descriptor names its slice via `settingsSliceKey` (kizuna twins reuse a base descriptor's builders but point at their own slice).
- **Credentials** — the normalized result of `extractCredentials`: `{ ok: true, primary, secret?, endpoint? } | { ok: false, missing }`. Each provider's raw fields (clientId/clientSecret, accessKeyId/secretAccessKey, appId/accessToken, apiKey/apiSecret, auth token) map into this shape inside its descriptor; callers never name provider-specific fields.
- **Kizuna twins (relay twins)** — `KIZUNA_AI_OPENAI_TRANSLATE` / `KIZUNA_AI_VOLCENGINE_AST2`: backend-managed variants that subclass a base provider's descriptor, reuse its session-config builder, but authenticate with a Better Auth session token via the relay (`getAuthToken()` — the async case of `extractCredentials`).
- **SessionConfig** — the per-provider wire configuration handed to `IClient.connect()`. Built by the descriptor from its settings slice; cross-provider fields (`textOnly`, `keepReplayAudio`) are applied by the store shell after building.

## Session domain

- **Client** — an `IClient` adapter speaking one provider's realtime protocol (11 adapters behind the `IClient` seam). Constructed only by its provider's descriptor.
- **ConversationItem** — the unified transcript unit (user/assistant message with text/transcript/audio) that every client reduces provider events into.
