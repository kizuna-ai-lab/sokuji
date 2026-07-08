# Zoom AI Services Provider (text-only cascade) — Design

**Date**: 2026-07-08
**Status**: Draft (POC validated; ready for implementation planning)
**Branch**: `feat/zoom-ai-services-provider`

## 1. Summary

Add **Zoom AI** as a new first-class provider in Sokuji, alongside OpenAI / Gemini / Volcengine / Local Inference. It is a **text-only cascade** provider: it captures microphone audio, segments utterances with client-side VAD, sends each finished utterance to **Zoom Scribe** (cloud ASR), sends the transcript to **Zoom Translator** (cloud MT), and renders the transcript + translation as conversation/subtitle items. There is **no TTS / no synthesized audio output**.

It is **BYOK**: the user supplies a Zoom Build Platform **API Key + API Secret**, which the client signs into an **HS256 JWT** in the browser (same client-side-signing model as the existing Volcengine provider).

Zoom AI is treated exactly like any other provider — it exposes **only the language pairs Zoom natively supports**, which are fewer than other providers. No English-pivot, no cross-provider fallback.

## 2. Goals / Non-goals

**Goals**
- A working `Provider.ZOOM_AI` selectable in Settings, BYOK, gated behind a feature flag.
- Per-utterance cascade: mic → VAD → Scribe → Translator → subtitle items, with the transcript shown as soon as ASR returns and the translation appended when MT returns.
- Declare Zoom's real, asymmetric language matrix (see §5) and enforce it in the target-language UI.
- Reuse existing infrastructure: `IClient` push-audio model, `@ricky0123/vad-web` Silero VAD, Web Crypto HMAC, `ConversationItem` emission.

**Non-goals (YAGNI)**
- No TTS / audio output (`textOnly` provider).
- No streaming/partial ASR results (Zoom Scribe is file-based; subtitles appear per finished utterance).
- No English-pivot for unsupported pairs (e.g. `ja→zh` is simply not offered).
- No batch mode, no Summarizer API, no server-side proxy (BYOK, client-signed).
- No Electron-only features; must work in both web/extension and Electron.

## 3. Background: POC results (validated 2026-07-08)

Standalone Node POC (`scratchpad/zoom-poc/`) proved the full route end-to-end:

- **Auth**: Build Platform **API Key + Secret → HS256 JWT** (`iss`=API Key, `iat`, `exp`), `Authorization: Bearer <jwt>`. Requires the account to hold a **Zoom Build Platform** subscription (not "Developer Pack"); credentials come from Marketplace → Platform Studio → *Build SDK app* → **API keys** section.
- **Scribe** (Fast sync): `POST https://api.zoom.us/v2/aiservices/scribe/transcribe`, `application/json`, body `{ file, config }`. `file` must be a **data URI** `data:audio/wav;base64,<bytes>` (bare base64 → `400 UNSUPPORTED_MEDIA`; only URL or data-URI accepted). Verified: en and ja transcription accurate; ~1.4–2.5 s per short clip.
- **Translator**: `POST https://api.zoom.us/v2/aiservices/translator/translate`, body `{ text, config:{ source_language, target_languages:[...] } }`. **Hard limit: one side of the pair must be English** — `ja→zh` returns `400 "one side must be English"`.
- **Latency**: end-to-end ~2.0–2.7 s for 3–7 s clips (Scribe ~1.4–2.5 s + Translator ~0.6–0.8 s). Whole-sentence latency, acceptable by design.

See memory `project-zoom-ai-services-poc` for the full findings and ops/security follow-ups (recurring trial subscription to cancel; secrets to rotate).

## 4. Architecture

### 4.1 Runtime data flow

```
mic → ModernAudioRecorder (mono PCM16 @ 24 kHz)
   → MainPanel per-frame callback → client.appendInputAudio(Int16Array)   [existing wiring]
        └── ZoomAIClient (new):
              buffer frames → resample 24k→16k → Silero VAD (client-side)
                 on speech_end → utterance PCM16@16k
                    → encode WAV (16k mono) → data URI
                    → POST Scribe (sign JWT)      → transcript
                        emit ConversationItem{role:'user', completed}
                    → POST Translator (sign JWT)  → translation
                        emit ConversationItem{role:'assistant', completed}
```

The client is a **push client** (like Volcengine ST): `MainPanel` already forwards every mic frame to the active client via `appendInputAudio` (`MainPanel.tsx:1665–1678` VAD/continuous, `1644–1664` PTT, `1968–1983` pure PTT). No changes to the mic→client wiring are needed beyond registering the provider in the `createClient`/`apiKey` switches.

### 4.2 New units (each with one clear purpose)

1. **`ZoomAIClient` implements `IClient`** — `src/services/clients/ZoomAIClient.ts`
   - Owns the utterance buffer + VAD + cascade orchestration + `ConversationItem` emission.
   - Cascade *shape* and `textOnly`/no-TTS handling modeled on `LocalInferenceClient`; wire/auth/emit/BYOK modeled on `VolcengineSTClient`.
2. **`ZoomJwtSigner`** — `src/services/clients/zoom/ZoomJwtSigner.ts` (or inline in the client)
   - `sign(apiKey, apiSecret): Promise<string>` → HS256 JWT via Web Crypto (`crypto.subtle` HMAC-SHA256), base64url. Reuses the `hmacSha256` primitive pattern from `VolcengineSTClient.ts:263–274`; emits base64url instead of hex.
3. **`ZoomScribe` / `ZoomTranslator` API wrappers** — `src/services/clients/zoom/zoomApi.ts`
   - `transcribe(jwt, wavDataUri, language)` → `text_display`.
   - `translate(jwt, text, sourceLang, targetLang)` → translated text.
   - Thin `fetch` wrappers; return typed results or throw with the Zoom error body.
4. **`ZoomAIProviderConfig` extends `ProviderConfig`** — `src/services/providers/ZoomAIProviderConfig.ts`
   - Declares source/target languages + the asymmetric pair map (§5), `textOnlyCapability: 'always'`, no voices.
5. **VAD segmenter** — a small utterance-VAD helper reused from `@ricky0123/vad-web` (Silero v5, `./wasm/vad/silero_vad_v5.onnx`, 16 kHz, 512-sample frames). Copy the frame loop from `whisper-webgpu.worker.ts:340–390`. May live in a dedicated worker or inline; decide in the plan (see Open Questions §9).

### 4.3 Utterance lifecycle & UX

- On VAD `speech_start`: optionally emit a lightweight "listening"/in-progress marker (mirror `LocalInferenceClient` `onSpeechStart`).
- On VAD `speech_end`: run the cascade. Emit the **user** transcript item as soon as Scribe returns (status `completed`), then the **assistant** translation item when Translator returns. This gives incremental feedback within the ~2 s window.
- `createResponse()` **flushes** any pending VAD segment (PTT end-of-turn), mirroring `LocalInferenceClient.ts:393–398`. `cancelResponse()` drops the in-flight utterance.
- `updateSession()` applies language changes for subsequent utterances (no live re-config needed mid-utterance).

## 5. Language matrix

Constrained by (a) Scribe ASR supports only **en-US, zh-CN, ja-JP, es-ES, it-IT** as sources, and (b) Translator requires **English on one side**.

**Sources (must be Scribe-recognizable):** `en-US, zh-CN, ja-JP, es-ES, it-IT`

**Supported pairs:**
| Source | Allowed targets |
|--------|-----------------|
| `en-US` | `zh-CN, zh-TW, ja-JP, ko-KR, es-ES, fr-FR, de-DE, pt-PT, pt-BR, it-IT` |
| `zh-CN` / `ja-JP` / `es-ES` / `it-IT` | `en-US` only |

`ko/fr/de/pt` are targets only (not Scribe-recognizable → never a source).

**Implementation:** `ProviderConfig` exposes flat `languages` (sources) + `targetLanguages`, with **no** built-in asymmetric matrix. Add a static map on `ZoomAIProviderConfig`:
```ts
private static readonly PAIRS: Record<string, string[]> = {
  'en-US': ['zh-CN','zh-TW','ja-JP','ko-KR','es-ES','fr-FR','de-DE','pt-PT','pt-BR','it-IT'],
  'zh-CN': ['en-US'], 'ja-JP': ['en-US'], 'es-ES': ['en-US'], 'it-IT': ['en-US'],
};
```
Expose `getSourceLanguages()` and `getTargetLanguagesForSource(src)`. The target dropdown recomputes when the source changes (hook: the source `onChange` in `ProviderSpecificSettings.tsx:1859–1869`). If the current target becomes invalid after a source change, reset it to the source's first allowed target.

## 6. Authentication & security

- **BYOK, two secrets**: `apiKey` + `apiSecret`, entered in Settings (two-field block, copy Volcengine ST's `ProviderSection.tsx:558–595`).
- **Client-side JWT**: `ZoomJwtSigner` builds an HS256 JWT (`iss`=apiKey, `iat`, `exp≈now+2h`) signed with `apiSecret` via Web Crypto. Regenerate when near expiry (cache a signed token with its exp). No secret ever leaves the client except as the derived JWT sent to Zoom (`Authorization: Bearer`).
- Consistent with Sokuji's existing model: the Volcengine provider already signs with a client-held secret in-browser. `apiKey` + `apiSecret` are **persisted to the settings service** (via `updateZoomAI`) the same way every other BYOK provider stores its credentials — OpenAI `apiKey`, Volcengine `secretAccessKey` — so the user doesn't re-enter them each session. They are held client-side only and sent to Zoom exclusively as the derived Bearer JWT.
- **CORS**: POC confirmed `api.zoom.us/v2/aiservices/*` is callable directly. Extension CSP must allow `api.zoom.us` (add to `extension/` connect-src if not already permitted) — verify during implementation.

## 7. BYOK registration (files to change)

Mirror the Volcengine ST provider throughout.

- **`src/types/Provider.ts`**: add `ZOOM_AI = 'zoom_ai'` to the enum + `ProviderType` union; add to `SUPPORTED_PROVIDERS` gated by `isZoomAIEnabled()`; add `getProviderDisplayName` case.
- **`src/utils/environment.ts`**: add `isZoomAIEnabled()` (dev-on; prod gated by `VITE_ENABLE_ZOOM_AI==='true'`). Import in `Provider.ts`, `ProviderConfigFactory.ts`, `ClientFactory.ts`.
- **`src/services/interfaces/IClient.ts`**: add `ZoomAISessionConfig extends BaseSessionConfig { provider:'zoom_ai'; sourceLanguage: string; targetLanguages: string[] }` (uses existing `BaseSessionConfig.textOnly`; the client consumes `targetLanguages[0]`), add to `SessionConfig` union + an `isZoomAISessionConfig` guard.
- **`src/stores/settingsStore.ts`**: `ZoomAISettings { apiKey; apiSecret; sourceLanguage; targetLanguage }`, `defaultZoomAISettings`, `zoomAI` field, `updateZoomAI` action + hooks (`useZoomAISettings`/`useUpdateZoomAI`), `createZoomAISessionConfig`, `case Provider.ZOOM_AI` in `createSessionConfig` and `getCurrentProviderSettings`, and a `validateApiKey` branch (short-circuit if key or secret empty; cache key from both).
- **`src/services/ClientOperations.ts`**: `case Provider.ZOOM_AI` in `validateApiKeyAndFetchModels` + `getLatestRealtimeModel`.
- **`src/services/clients/ClientFactory.ts`**: `case Provider.ZOOM_AI` gated on `isZoomAIEnabled()`, requires `clientSecret`, returns `new ZoomAIClient(apiKey, clientSecret)`.
- **`src/services/providers/ProviderConfigFactory.ts`**: register `ZoomAIProviderConfig` under `isZoomAIEnabled()`.
- **UI**:
  - `src/components/Settings/sections/ProviderSection.tsx`: two-field credential block + `getCurrentApiKey`/`updateApiKey`/`getProviderInfoById` cases (provider auto-appears from `getAllConfigs()`).
  - `src/components/Settings/sections/ProviderSpecificSettings.tsx`: `renderZoomAISettings()` with source + source-dependent target dropdowns + info panel; update branch. Also render a **"Text only" switch that is permanently on and disabled** (`checked=true`, non-interactive) to communicate that this provider only produces text (reflects `textOnlyCapability: 'always'`). Reuse the existing text-only switch component/styling used by other providers.
  - `src/components/MainPanel/MainPanel.tsx`: `case Provider.ZOOM_AI` in the `apiKey` switch + set `clientSecret = zoomAISettings.apiSecret` in the `createClient` credential block.

## 8. Error handling

- **Auth/plan errors** (`401`, `403 BILLING_SCRIBE_API_PLAN_REQUIRED`): surface a clear, actionable message via `onError` → logStore ("Zoom Build Platform plan / valid API Key+Secret required"). Mark provider invalid in `validateApiKey`.
- **Unsupported pair** (`400 "one side must be English"`): prevented at the UI layer by the pair map; if it still occurs, log and skip that utterance's translation (still show the transcript).
- **Empty transcript** (silence/no speech): skip translation, no assistant item.
- **Network/timeout per utterance**: fail that utterance only; log to logStore; keep the session alive for the next utterance (do not tear down the client).
- **JWT expiry mid-session**: re-sign lazily before each request when the cached token is near expiry.

## 9. Open questions / risks

1. **VAD placement**: inline in the client (main thread) vs a dedicated worker. Silero inference per 32 ms frame on the main thread may be acceptable, but a worker is cleaner and matches the local-inference pattern. Decide in the plan; prefer a small worker if main-thread jank appears.
2. **Resampling 24 k→16 k**: reuse the recorder's downsample utility or a small linear resampler in the client. Confirm Scribe accepts 16 k WAV (POC used 16 k successfully).
3. **Cost/credits UX**: each utterance = 1 Scribe + 1 Translator call billed to the user's Build Platform credits. Consider a lightweight usage note in the info panel. No metering in v1.
4. **Extension CSP**: confirm `api.zoom.us` is allowed in the extension manifest connect-src.
5. **PTT vs continuous**: ensure `createResponse()` flush + trailing-silence handling (`MainPanel.tsx:2034–2041`) closes the client-side VAD segment correctly.

## 10. Testing

- **Unit** (vitest, colocated):
  - `ZoomJwtSigner`: given key/secret, produces a well-formed HS256 JWT with correct `iss`/`exp`; signature verifies against a known-good HMAC.
  - `ZoomAIProviderConfig`: `getTargetLanguagesForSource` returns the correct asymmetric sets; invalid pairs excluded.
  - WAV encoder: PCM16@16k → valid RIFF/WAVE header (round-trips duration).
  - `zoomApi` wrappers: request body shape (`file` data-URI, translator `config`) and error mapping, with `fetch` mocked.
- **Integration (manual, gated)**: with real BYOK credentials, run the in-app provider for `ja→en` and `en→zh`; verify transcript + translation items and latency.
- Do not gate on `tsc` (repo is not tsc-clean); correctness gate is vitest + Vite build.

## 11. Rollout

- Feature-flagged via `VITE_ENABLE_ZOOM_AI` (dev-on, prod off until validated), exactly like Volcengine.
- Ship provider + config + UI behind the flag; enable in prod after the manual ja→en / en→zh integration check passes.
