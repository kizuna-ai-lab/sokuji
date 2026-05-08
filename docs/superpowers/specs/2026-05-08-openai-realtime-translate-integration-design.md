# OpenAI Realtime Translate Integration — Design

**Date**: 2026-05-08
**Status**: Approved, ready for implementation

## Overview

OpenAI shipped `gpt-realtime-translate` as a dedicated speech-to-speech translation model with its own endpoint, session lifecycle, and configuration surface. The model is optimized for live interpretation: trained on professional interpreter audio, processes input while simultaneously streaming translated output, and is constrained to translation-only behavior (won't follow instructions or answer questions).

This is a strong fit for Sokuji's primary use case (real-time translation), substantially better than prompt-engineering a general-purpose Realtime model into translating.

This design adds OpenAI Translate as an independent provider in Sokuji, supporting both WebSocket and WebRTC transports, with session lifecycle and event handling that match the upstream API exactly (since they differ from existing providers).

## Goals

1. Ship `gpt-realtime-translate` as a first-class provider, not a model variant of the existing OpenAI provider
2. Match parity with existing OpenAI provider's transport story (WebSocket + WebRTC opt-in)
3. Reuse audio infrastructure (`ModernAudioRecorder`, `ModernAudioPlayer`, `WebRTCAudioBridge`) without modification
4. Reuse Conversation modeling (`ConversationItem` user/assistant pairs) so MainPanel renders without changes
5. Preserve user mental model — keep the "my language / their language" UX even though API auto-detects source

## Non-Goals

- Custom endpoint support for OpenAI-compatible proxies (locked to `api.openai.com` until proxies catch up)
- Kizuna AI backend proxy support for translate (separate backend work, out of scope)
- Onboarding flow to auto-enable passthrough audio (Phase 2)
- Multi-speaker conference fanout (Phase 2)
- Source/target transcript timestamp alignment for subtitle replay (Phase 2)

## Background — Upstream API

**Endpoints**:
- WebSocket: `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`
- WebRTC: client secret minted via `POST /v1/realtime/translations/client_secrets`, SDP exchanged at `POST /v1/realtime/translations/calls`

**Authentication**:
- WebSocket: `Authorization: Bearer ${OPENAI_API_KEY}` directly
- WebRTC: ephemeral client secret used as bearer for the SDP POST (same shape as existing OpenAI WebRTC ephemeral token flow, just a different mint endpoint)

**Audio format**: 24 kHz PCM16 little-endian, base64 encoded for WebSocket; native MediaStreamTrack (Opus) for WebRTC. Output arrives in ~200 ms chunks.

**Session lifecycle**:
- Continuous streaming — no `response.create`, no turn detection, no conversation state
- Audio in, audio + transcripts out, indefinitely
- Session config controls only target language, optional input transcription model, and noise reduction

**Session config (only configurable fields)**:
```json
{
  "type": "session.update",
  "session": {
    "audio": {
      "input": {
        "transcription": { "model": "gpt-realtime-whisper" },
        "noise_reduction": { "type": "near_field" }
      },
      "output": { "language": "es" }
    }
  }
}
```

**Server events**:
- `session.created`, `session.updated`, `error`
- `session.input_transcript.delta` — source-language transcript (only when input transcription configured)
- `session.output_transcript.delta` — translated-language transcript
- `session.output_audio.delta` — translated audio (base64 PCM16 24 kHz)
- `.done` variants — likely exist but not documented in cookbook; design handles both presence and absence

**Client events**:
- `session.update` — once after connection
- `session.input_audio_buffer.append` — continuous, including silence

**Hard limitations from upstream**:
- No custom prompts, instructions, or prompt parameters
- No voice selection — uses dynamic voice adaptation (translated speech mimics source speaker's tone)
- No temperature, max_tokens, tools
- 13 target output languages: en, es, pt, fr, ja, ru, zh, de, ko, hi, id, vi, it
- 75+ source input languages, all auto-detected (no source language parameter)
- Same-language passthrough silence: model stays silent if speaker uses target language

## Architecture

### File layout

```
src/types/Provider.ts                                ← +OPENAI_TRANSLATE
src/services/clients/OpenAITranslateGAClient.ts      ← new (~280 lines)
src/services/clients/OpenAITranslateWebRTCClient.ts  ← new (~300 lines)
src/services/clients/OpenAIClient.ts                 ← refactor: extract fetchOpenAIModelsList,
                                                       add isTranslateRealtimeModel
src/services/providers/OpenAITranslateProviderConfig.ts ← new
src/services/providers/ProviderConfig.ts             ← +targetLanguages? field
src/services/providers/ProviderConfigFactory.ts      ← +1 case
src/services/EphemeralTokenService.ts                ← +mintTranslationClientSecret
src/services/clients/ClientFactory.ts                ← +1 case, +supportsWebRTC entry
src/services/interfaces/IClient.ts                   ← +OpenAITranslateSessionConfig
src/stores/settingsStore.ts                          ← +OpenAITranslateSettings + builder + setProvider hook
src/components/Settings/sections/ProviderSpecificSettings.tsx ← Translate-specific InfoBanner block
src/components/Settings/sections/LanguageSection.tsx ← targetLanguages-aware target dropdown
src/locales/*/translation.json                       ← +translate i18n keys
```

### Naming convention

Mirror existing OpenAI client naming exactly:

| Main OpenAI line | OpenAI Translate line |
|---|---|
| `OpenAIGAClient` (WebSocket) | `OpenAITranslateGAClient` (WebSocket) |
| `OpenAIWebRTCClient` (WebRTC) | `OpenAITranslateWebRTCClient` (WebRTC) |
| `EphemeralTokenService.getToken()` | `EphemeralTokenService.mintTranslationClientSecret()` |

The `GA` suffix is technically redundant for translate (no Beta variant exists), but kept for visual parallelism with `OpenAIGAClient`. New files plug into existing patterns at one glance.

### Why a separate provider, not a model variant of OpenAI

- Configuration surface is fundamentally different: ~80% of existing OpenAI settings (voice, turn detection, temperature, max_tokens, instructions, transcript model picker) are inapplicable
- Server event names are different (`session.output_*` vs `response.audio.*`)
- Session lifecycle is different (continuous streaming vs turn-based with `response.create`)
- Routing by model name in ClientFactory would scatter `if (model === 'translate')` branches across 600+ lines of existing code
- Independent provider keeps the existing OpenAI clients clean and the new translate clients focused

### Why two separate transport client classes, not a unified base

- Each transport has fundamentally different I/O (Int16Array buffer vs MediaStream) and auth flows (direct Bearer vs client_secret + SDP)
- Existing `OpenAIClient` / `OpenAIGAClient` / `OpenAIWebRTCClient` codebase already comfortably duplicates `sendSessionUpdate` and event handling per transport — same precedent
- Common logic (session.update payload construction, server event parsing) extracted to static methods on `OpenAITranslateGAClient`, called by `OpenAITranslateWebRTCClient` (same pattern as `OpenAIClient.validateApiKeyAndFetchModels` shared between OpenAI clients)

## Data Model

### Provider enum

```ts
// src/types/Provider.ts
export const Provider = {
  ...,
  OPENAI_TRANSLATE: 'openai_translate' as const,
} as const;
```

`isOpenAICompatible()` does NOT include `OPENAI_TRANSLATE`. The settings shape diverges enough that the existing OpenAI-compatible UI helpers can't safely consume it.

### Persisted settings

```ts
export type TranslateTargetLanguage =
  | 'en' | 'es' | 'pt' | 'fr' | 'ja' | 'ru' | 'zh'
  | 'de' | 'ko' | 'hi' | 'id' | 'vi' | 'it';

export interface OpenAITranslateSettings {
  apiKey: string;
  sourceLanguage: string;            // UI display only — not sent to API
  targetLanguage: TranslateTargetLanguage;
  transcriptModel: 'gpt-realtime-whisper';  // currently the only valid value
  noiseReduction: 'None' | 'Near field' | 'Far field';
  transportType: TransportType;      // 'websocket' | 'webrtc'
}

const defaultOpenAITranslateSettings: OpenAITranslateSettings = {
  apiKey: '',
  sourceLanguage: 'en',
  targetLanguage: 'zh',
  transcriptModel: 'gpt-realtime-whisper',
  noiseReduction: 'None',
  transportType: 'websocket',
};
```

Fields deliberately omitted (with rationale):
- `model` — always `gpt-realtime-translate`, hardcoded at session config build time
- `voice` — model uses dynamic voice adaptation, not configurable
- `temperature`, `maxTokens`, `instructions` — API rejects these fields
- `turnDetectionMode` and related — continuous streaming, no turn concept

### Runtime session config

```ts
export interface OpenAITranslateSessionConfig extends BaseSessionConfig {
  provider: 'openai_translate';
  // BaseSessionConfig.model = 'gpt-realtime-translate'
  // BaseSessionConfig.voice / instructions / temperature / maxTokens / textOnly unused
  targetLanguage: TranslateTargetLanguage;
  sourceLanguage?: string;  // UI hint, not forwarded to API
  inputAudioTranscription?: { model: string };
  inputAudioNoiseReduction?: { type: 'near_field' | 'far_field' };
}

export function isOpenAITranslateSessionConfig(c: SessionConfig): c is OpenAITranslateSessionConfig {
  return c.provider === 'openai_translate';
}
```

### ProviderConfig increment

Single new optional field on the `ProviderConfig` interface:

```ts
export interface ProviderConfig {
  ...
  targetLanguages?: LanguageOption[];  // when defined, target dropdown uses this; else falls back to languages
  ...
}
```

No new capability flags. Field presence drives UI: `config.targetLanguages ?? config.languages`.

`OpenAITranslateProviderConfig` populates `targetLanguages` with the 13 supported codes; other providers leave it `undefined`. UI gets explicit data-driven distinction without a boolean flag.

### Model list — dynamic, same pattern as OpenAI provider

```ts
private static readonly MODELS: ModelOption[] = [
  { id: 'gpt-realtime-translate', type: 'realtime' },  // static fallback
];
```

Real model list comes from `/v1/models`, filtered with a translate-specific predicate:

```ts
// OpenAIClient (extracted to be shared)
static isTranslateRealtimeModel(modelId: string): boolean {
  return modelId.toLowerCase().startsWith('gpt-realtime-translate');
}
```

Future variants (e.g., `gpt-realtime-translate-mini`) will appear automatically in the dropdown without code changes.

## Event Flow

### Conversation item modeling — paired user + assistant

Each translation utterance produces two `ConversationItem`s:

```
[User Item, role: 'user']               [Assistant Item, role: 'assistant']
  formatted.transcript: source text       formatted.transcript: translated text
  status: in_progress → completed         formatted.audio: merged Int16Array
                                          status: in_progress → completed
```

This matches the existing speaker/participant double-row bubble layout in MainPanel exactly. **MainPanel and ConversationRow render zero new code.**

### Pairing strategy

Priority order:
1. If server events include `item_id`: use it directly (mature path)
2. If not: client-side state machine (described below)

The cookbook does not show whether events carry `item_id`. We design to handle both.

### Segmentation — silence-based fallback

```
state: currentPair = { userItemId, assistantItemId } | null
       deltaTimer: timeout handle | null

handlers:
  on session.input_transcript.delta:
    if currentPair === null:
      currentPair = { userItemId: gen(), assistantItemId: gen() }
      emit user item created (in_progress)
      emit assistant item created (in_progress)
    accumulate delta to user item.formatted.transcript
    resetDeltaTimer()

  on session.output_transcript.delta:
    if currentPair === null: (defensive — translated arrives before source rare case)
      create both items
    accumulate delta to assistant item.formatted.transcript
    resetDeltaTimer()

  on session.output_audio.delta:
    accumulate audio chunks to assistant item
    resetDeltaTimer()

  on session.*.done OR (deltaTimer fires after 1.5s of silence):
    mark both items completed
    currentPair = null

resetDeltaTimer():
  clear existing timer
  schedule timer to fire in 1.5s
```

`.done` events are preferred when present. Silence timeout is the safety net.

### Audio I/O

**WebSocket (`OpenAITranslateGAClient`)**:
```
Input:  ModernAudioRecorder → Int16Array @ 24kHz
        → btoa(Uint8Array) → ws.send({ type: 'session.input_audio_buffer.append', audio })

Output: ws.onmessage → if 'session.output_audio.delta':
        atob(delta) → Int16Array
        → emit conversation update { item, delta: { audio, sequenceNumber, timestamp } }
        → MainPanel feeds ModernAudioPlayer queue
```

**WebRTC (`OpenAITranslateWebRTCClient`)**:
```
Input:  getUserMedia → MediaStreamTrack → pc.addTrack
        (browser handles Opus encode automatically)

Output: pc.ontrack → MediaStream → WebRTCAudioBridge (sampleRate: 24000, PCM buffering enabled)
        → onBufferedAudioData → emit conversation update (same shape as WebSocket path)

Events: pc.createDataChannel('oai-events') → datachannel.onmessage → JSON.parse
        → same parser as WebSocket path
```

`WebRTCAudioBridge` is the existing class used by `OpenAIWebRTCClient` — reused without modification.

### Shared helpers

Implemented as static methods on `OpenAITranslateGAClient`, called by `OpenAITranslateWebRTCClient`:

- `OpenAITranslateGAClient.buildSessionUpdate(config)` — builds the JSON `session.update` payload
- `OpenAITranslateGAClient.parseServerEvent(event, state)` — server event dispatcher with state-machine awareness
- `OpenAITranslateGAClient.validateApiKeyAndFetchModels(apiKey)` — validation entry point

`EphemeralTokenService` gains:
- `mintTranslationClientSecret(apiKey, sessionConfig, apiHost?)` — POSTs to `/v1/realtime/translations/client_secrets`, returns the secret string

### IClient no-op methods

Translate has no turn concept. These methods are no-ops on both translate clients (preserving the IClient contract):

```ts
appendInputText(text: string): void { /* no-op: text input not applicable */ }
createResponse(config?: ResponseConfig): void { /* no-op: no response lifecycle */ }
cancelResponse(): void { /* no-op for Phase 1; revisit if API exposes input_audio_buffer.clear */ }
```

## UI

### ProviderSpecificSettings — data-driven hiding

All existing render functions are reused. Visibility is controlled by `capabilities` flags already in the codebase:

| Render function | OpenAI Translate | Why |
|---|---|---|
| `renderModelSettings` | rendered (single dropdown entry) | dynamic list, future-proof |
| `renderVoiceSettings` | hidden | `hasVoiceSettings: false` |
| `renderTurnDetectionSettings` | hidden | `hasTurnDetection: false` |
| `renderTranscriptSettings` | rendered | `transcriptModels: ['gpt-realtime-whisper']` |
| `renderNoiseReductionSettings` | rendered | `hasNoiseReduction: true` |
| `renderTransportTypeSettings` | rendered | `ClientFactory.supportsWebRTC` includes provider |
| `renderModelConfigurationSettings` | hidden | `hasModelConfiguration: false` |
| `renderReasoningEffortSettings` | hidden | `hasReasoningEffort: false` |

### LanguageSection — targetLanguages-aware

```ts
const sourceLanguages = config.languages;
const targetLanguages = config.targetLanguages ?? config.languages;
```

Single-line conditional. Source dropdown stays the same; target dropdown shrinks to 13 entries when `targetLanguages` is defined. No visible breakage for other providers.

### Same-language silence info banner

Rendered at the top of the OpenAI Translate config panel:

```
┌─────────────────────────────────────────────────────┐
│ ℹ️ This model stays silent when the speaker uses    │
│    the same language as the target.                 │
│    Mixed-language speech may have gaps.             │
└─────────────────────────────────────────────────────┘
```

i18n key `settings.translateInfoBanner`. Plain text, no link.

### Silent API-key prefill

In `setProvider` action (settings store):

```ts
if (newProvider === Provider.OPENAI_TRANSLATE
    && !state.openaiTranslate.apiKey
    && state.openai.apiKey) {
  // copy openai.apiKey to openaiTranslate.apiKey
  // persist immediately
  // trigger validateApiKey
}
```

No banner, no confirmation. After the one-time copy, the two keys are independent — later edits to either don't propagate.

### MainPanel and ConversationRow

Zero changes. Existing user/assistant double-row rendering covers source + translated transcripts naturally.

## Settings Store / ClientFactory Wiring

### Session config builder

```ts
function createOpenAITranslateSessionConfig(
  settings: OpenAITranslateSettings,
  systemInstructions: string  // accepted for signature consistency, ignored
): OpenAITranslateSessionConfig {
  return {
    provider: 'openai_translate',
    model: 'gpt-realtime-translate',
    targetLanguage: settings.targetLanguage,
    sourceLanguage: settings.sourceLanguage,
    inputAudioTranscription: settings.transcriptModel
      ? { model: settings.transcriptModel }
      : undefined,
    inputAudioNoiseReduction: settings.noiseReduction !== 'None' ? {
      type: settings.noiseReduction === 'Near field' ? 'near_field' : 'far_field'
    } : undefined,
  };
}
```

Added to the existing builder switch alongside other providers.

### ClientFactory

```ts
case Provider.OPENAI_TRANSLATE:
  if (transportType === 'webrtc') {
    return new OpenAITranslateWebRTCClient({
      apiKey,
      inputDeviceId: webrtcOptions?.inputDeviceId,
      outputDeviceId: webrtcOptions?.outputDeviceId,
    });
  }
  return new OpenAITranslateGAClient(apiKey);
```

```ts
static supportsWebRTC(provider: ProviderType): boolean {
  return provider === Provider.OPENAI
      || provider === Provider.OPENAI_COMPATIBLE
      || provider === Provider.OPENAI_TRANSLATE;
}
```

### Validation

`OpenAITranslateGAClient.validateApiKeyAndFetchModels` reuses the extracted `OpenAIClient.fetchOpenAIModelsList` helper, then filters with `isTranslateRealtimeModel`. Validation message is translate-specific (`settings.translateModelAvailable` / `settings.translateModelNotAvailable`) so users with valid OpenAI keys but no translate access get a clear error.

### OpenAIClient refactor

Extract the fetch-and-error-handling portion of `validateApiKeyAndFetchModels` into a new static helper:

```ts
static async fetchOpenAIModelsList(apiKey: string, apiHost?: string): Promise<{
  models: OpenAIModel[];
  error?: ApiKeyValidationResult;
}> { /* fetch /v1/models, handle region restriction etc */ }
```

The public `validateApiKeyAndFetchModels` API stays unchanged; it now delegates to the new helper internally. The translate client also calls the new helper.

## i18n

New keys (English, with placeholder for 29 other locales):

- `settings.openaiTranslate` — provider display name
- `settings.openaiTranslateDescription`
- `settings.translateInfoBanner` — same-language silence warning
- `settings.targetLanguageLimited` — tooltip for target dropdown
- `settings.translateModelAvailable` / `settings.translateModelNotAvailable` — validation messages
- `settings.transcriptModelTooltipTranslate` — explains that only gpt-realtime-whisper is supported in this context
- `settings.modelTooltipTranslate` — explains dynamic voice adaptation, auto language detection

29 other locales filled by reused Python script (same pattern as the recent `reasoningEffort` rollout).

## Risks and Open Questions

To verify during implementation against a real API key:

| Risk | Strategy |
|---|---|
| `.done` events present? | Listen for both delta and done; silence timer (1.5 s) as fallback |
| Server events carry `item_id`? | If yes use directly; if no use client-side state machine |
| Exact response shape of `/v1/realtime/translations/client_secrets`? | Implement against cookbook example; adjust on first 4xx |
| Source language code mapping (`zh_CN` → `zh`)? | Source isn't sent to API; mapping is UI-only and lossless |
| `gpt-realtime-whisper` billing inside translate session? | Document as TBD; verify on first invoice |
| Same API key has both OpenAI main and Translate access? | Validation distinguishes via `isTranslateRealtimeModel` filter |
| WebRTC AudioBridge stability across sessions? | Reuses well-tested existing path |

## Testing

**Phase 1 minimum**:
1. `tsc --noEmit` clean
2. `OpenAITranslateGAClient.test.ts` — mock WebSocket, assert:
   - `session.update` payload shape on connect
   - `appendInputAudio` produces correct base64 `session.input_audio_buffer.append`
   - `session.output_audio.delta` → emits `onConversationUpdated` with audio delta
   - 1.5 s silence after deltas marks items completed
3. Manual acceptance with real API key: en→zh, zh→en, mixed-language; both transports; key prefill; banner display; spot-check 3 of 13 target languages

WebRTC client unit tests skipped — mocking `RTCPeerConnection` is high-cost and low-yield.

## Phasing

**Phase 1 (this PR)**: Provider registration, both transport clients, ProviderConfig, UI hiding rules, i18n for 30 locales, dynamic model list, silence-based segmentation, unit test.

**Phase 2 (later)**:
- Onboarding hint to enable passthrough on first translate session
- Runtime detection of same-language silence (if heuristic possible)
- Multi-speaker conference fanout (cookbook's group call pattern)
- `customEndpoint` support once OpenAI-compatible proxies offer translate
- Source/translated transcript timestamp alignment for subtitle replay
