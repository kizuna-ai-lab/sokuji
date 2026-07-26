# Soniox Provider — Design

**Date**: 2026-07-18
**Status**: Approved (brainstormed with user; all protocol facts verified against live API)

## Summary

Add Soniox (soniox.com) as a new BYOK speech-to-speech translation provider. One provider covers both output modes via the existing `textOnly` mechanism: `textOnly=true` runs STT+translation only (subtitles), `textOnly=false` additionally chains Soniox TTS so the translation is spoken. Supports both `one_way` (all speech → target language) and `two_way` (source ↔ target bidirectional) translation modes.

## Verified protocol facts (live-tested 2026-07-18)

All facts below were confirmed against the real API with a user-provided key; details in project memory (`project_soniox_provider_research`).

- **STT endpoint**: `wss://stt-rt.soniox.com/transcribe-websocket`, model `stt-rt-v5`. First frame is a JSON config; then binary audio frames.
- **Raw PCM must be declared explicitly**: `audio_format:"auto"` fails on headerless PCM (`408 Audio data decode timeout`). Required: `audio_format:"pcm_s16le"` + `sample_rate` + `num_channels`.
- **Token schema**: responses carry `tokens[]` with `text`, `is_final`, `translation_status` ∈ {`original`,`translation`,`none`}, `language`, `source_language`, `start_ms` (originals only). Pseudo-tokens `<end>` (endpoint) and `<fin>` (finalize marker) appear in-band and must be filtered from display.
- **End of stream**: send an **empty text frame** `""` → server flushes, replies `{finished:true}`, closes. (Python `websockets` `b""` does not work; the official demo has this latent bug. Browser `WebSocket.send("")` is the reliable form.)
- **`{"type":"finalize"}`** only finalizes pending tokens (emits `<fin>`); it does NOT end the session.
- **Keepalive**: ~20 s without input → `408 Request timeout`. STT keepalive is `{"type":"keepalive"}`; TTS keepalive is `{"keep_alive":true}` (different shapes).
- **TTS endpoint**: `wss://tts-rt.soniox.com/tts-websocket`, model `tts-rt-v1`. Per-stream config `{stream_id, model, voice, language, audio_format, sample_rate}`, then `{stream_id, text, text_end:false}` chunks, closed with `text_end:true`. Returns `{audio: base64}` chunks and `{terminated}` per stream. Verified with voice Maya, `pcm_s16le@24000`.
- **Temporary keys**: `POST https://api.soniox.com/v1/auth/temporary-api-key` (Bearer permanent key) — used here only as a cheap key-validation probe (201 = valid).
- **Languages**: 59 translation languages, any-to-any; `one_way {target_language}` / `two_way {language_a, language_b}`.
- **Voices**: 12 (Adrian, Claire, Daniel, Emma, Grace, Jack, Kenji, Maya, Mina, Nina, Noah, Owen). Whether every voice speaks every language is unverified → pre-implementation spike.

## Decisions

| Decision | Choice |
|---|---|
| Provider shape | Speech-to-speech provider with `textOnlyCapability:'optional'` (one provider, two output modes) |
| Credentials | Pure BYOK permanent key, direct WS from client (like OpenAI/Gemini). Backend-minted temp keys deferred until a Kizuna-managed variant exists. |
| Translation modes | Both in v1. `one_way` default; `twoWayTranslation` toggle in provider settings switches to `two_way`. |
| Source language semantics | `one_way`: source = `language_hints` bias, `auto` allowed (no hints). `two_way`: source = `language_a`, must be concrete → toggle disabled while source is `auto`. |
| Architecture | Three-file symmetric split (see below). No generic TTS abstraction layer yet (YAGNI; seam is the file boundary). |
| Registration | Always-on (no feature flag), like Volcengine ST. |
| Template | Volcengine ST for descriptor + STT/item shape; OpenAI GA client for `delta.audio` playback path. |

## Architecture

```
src/services/clients/SonioxClient.ts      IClient facade + STS orchestration (semantic layer)
src/services/clients/SonioxSttStream.ts   STT wire component (protocol layer)
src/services/clients/SonioxTtsStream.ts   TTS wire component (protocol layer)
src/services/providers/SonioxProviderConfig.ts   descriptor
```

Boundary rule: the two Stream classes speak only the Soniox wire protocol and emit structured events; they know nothing about each other or about `IClient`. `SonioxClient` owns all Sokuji semantics (conversation items, feeding policy, degradation). This gives independent seams for future cross-provider composition ("other STT → Soniox TTS" and "Soniox STT → other TTS") without building a generic abstraction now.

### SonioxSttStream

- `connect(config)` → opens WS, sends first-frame JSON config; `sendAudio(Int16Array)`; `finalize()`; `keepalive()`; `end()` (empty text frame); `close()`.
- Emits: `onTokens(tokens[])` (parsed, pseudo-tokens included — filtering is the client's job), `onFinished()`, `onError(code, message)`.

### SonioxTtsStream

- `connect(apiKey)` + `prewarm(voice, language)`; `sendText(text)` (opens a per-utterance stream lazily); `endUtterance()`; `setLanguage(lang)` for the next stream; internal 20 s `keep_alive` timer; `close()`.
- One stream per utterance, sequential, `stream_id = "utt-<n>"`. Pre-warm on connect saves ~400 ms on the first utterance; in `two_way`, if the first utterance's language mismatches the pre-warmed stream, the pre-warm stream is discarded and a correct one opened.
- Emits: `onAudio(Int16Array)` (base64-decoded), `onStreamTerminated()`, `onError(...)` .

### SonioxClient (implements IClient)

- `connect()`: builds STT config from `SonioxSessionConfig`; when `textOnly=false` also connects + pre-warms TTS.
- `appendInputAudio(Int16Array)` → `stt.sendAudio()`. Mic pipeline is already 24 kHz Int16 mono → config `pcm_s16le / 24000 / 1`.
- Token handling per server message:
  - Filter `<end>`/`<fin>` from display; `<end>` closes the current utterance (completes the current user/assistant item pair; next tokens open a new pair).
  - `original`/`none` → user item (transcription); `translation` → assistant item.
  - Finals append to committed text; partials are reset and rebuilt each message (server re-sends current partials).
  - Items surface via `onConversationUpdated({item, delta})`; raw messages via `onRealtimeEvent`.
- TTS feeding (`textOnly=false` only): **only `is_final && translation_status==='translation'`** token text goes to `tts.sendText()` (the official demo feeds partials — deliberately not copied, avoids speaking text that later changes). `<end>` → `tts.endUtterance()`. In `two_way`, the utterance's TTS language = `language` of its first final translation token.
- Audio out: `onAudio` → emit `delta.audio` (Int16Array) on the current assistant item → existing `MainPanel` path plays it via `audioService.addAudioData('ai-assistant', …)` at 24 kHz. Zero MainPanel changes. Replay audio follows the existing `keepReplayAudio` flag.
- No-interruption rule: `createResponse`/`cancelResponse` are no-ops; `onConversationInterrupted` is never fired.
- Static `validateApiKeyAndFetchModels(apiKey)`: probe `POST api.soniox.com/v1/auth/temporary-api-key` (Bearer key, `expires_in_seconds:1`); 201 → valid, models = fixed `[stt-rt-v5]`.
- `disconnect()`: STT `end()` then close; TTS `endUtterance()` + close.

### Error handling

Principle: **TTS failure must never kill subtitles.**

- STT errors → `onError` + logStore; behavior mirrors the Volcengine ST template (no auto-reconnect in v1).
- TTS errors are non-fatal: drop that utterance's audio, log once, keep STT running. If the TTS WS dies, try one reopen on the next utterance; if that fails, the session continues text-only with a single log line.
- Silence/idle: STT `{"type":"keepalive"}` when no audio has been sent for ~15 s; TTS `{"keep_alive":true}` every 20 s while connected.

## Configuration

### Settings slice (`soniox`)

```ts
interface SonioxSettings {
  apiKey: string;             // BYOK permanent key
  sourceLanguage: string;     // 'auto' | code   (default 'auto')
  targetLanguage: string;     // code            (default 'en')
  twoWayTranslation: boolean; // default false
  voice: string;              // default 'Maya'
  model: string;              // 'stt-rt-v5' (single entry)
}
```

`textOnly` is NOT in the slice — it is the shell-injected `BaseSessionConfig` field that `textOnlyCapability:'optional'` providers already get.

### STT first-frame config

```jsonc
{
  "api_key": "<key>",
  "model": "stt-rt-v5",
  "audio_format": "pcm_s16le", "sample_rate": 24000, "num_channels": 1,
  "enable_endpoint_detection": true, "max_endpoint_delay_ms": 500,
  "enable_language_identification": true,
  // one_way: hints only when source !== 'auto'; two_way: [a, b]
  "language_hints": ["zh"],
  "translation": { "type": "one_way", "target_language": "en" }
  //            | { "type": "two_way", "language_a": "zh", "language_b": "en" }
}
```

### TTS per-utterance stream config

```jsonc
{ "api_key": "<key>", "stream_id": "utt-<n>", "model": "tts-rt-v1",
  "voice": "<settings.voice>", "language": "<utterance translation language>",
  "audio_format": "pcm_s16le", "sample_rate": 24000 }
```

### Language interlock (UI)

- `twoWayTranslation` toggle is disabled (with tooltip) while `sourceLanguage === 'auto'`.
- The swap button already disables for `auto` (existing `LanguageSection` behavior); no `zhen`-style forced-pair sync is needed because Soniox accepts arbitrary pairs.
- Language list: the 59 Soniox translation languages; the "Auto Detect" source option is injected by the existing UI.

## Files

### Create

| File | Content |
|---|---|
| `src/services/clients/SonioxClient.ts` | orchestrator (above) |
| `src/services/clients/SonioxSttStream.ts` | STT wire |
| `src/services/clients/SonioxTtsStream.ts` | TTS wire |
| `src/services/providers/SonioxProviderConfig.ts` | descriptor: settings + defaults, `settingsSliceKey:'soniox'`, `supportsWebRTC:false`, `createClient`, `validateAndFetchModels`, `buildSessionConfig` (tag `provider:'soniox'`), 59 languages, 12 voices, single model; `extractCredentials` inherited from base (single key) |
| `src/services/clients/SonioxSttStream.test.ts`, `SonioxTtsStream.test.ts`, `SonioxClient.test.ts` | see Testing |

### Modify

1. `src/types/Provider.ts` — `SONIOX = 'soniox'` in enum + `ProviderType` union.
2. `src/services/interfaces/IClient.ts` — `SonioxSessionConfig` (`provider:'soniox'`, source/target/twoWay/voice) in the `SessionConfig` union + `isSonioxSessionConfig` guard.
3. `src/services/providers/ProviderConfigFactory.ts` — always-on registration.
4. `src/stores/settingsStore.ts` — union, state field, `updateSoniox` action, `PROVIDER_SLICE_REGISTRY` row, initial state, optional selector hook.
5. `src/locales/*/translation.json` — `providers.soniox.name` / `.description` (en authoritative, replicated mechanically).
6. `src/components/Settings/sections/ProviderSection.tsx` — icon entry (+ setup-doc URL).
7. `src/components/Icons/ProviderIcons.tsx` — `SonioxIcon`.
8. `src/components/Settings/sections/ProviderSpecificSettings.tsx` — Soniox branch: two-way toggle (voice dropdown comes from `ProviderConfig.voices` generic UI).
9. `src/components/Settings/sections/LanguageSection.tsx` — two-way ↔ auto interlock only if the generic path can't express it.
10. `src/services/providers/descriptorRegistry.test.ts` — count 12→13; rows in `DEFAULTS_BY_SLICE`, `wireTag`, `EXPECTED_SLICE_KEYS`, `EXPECTED_SUPPORTS_WEBRTC`.
11. `src/types/Provider.test.ts`, `src/stores/settingsStore.sliceRegistry.test.ts` — if they assert counts/sets.
12. `extension/manifest.json` — CSP `connect-src` += `wss://stt-rt.soniox.com wss://tts-rt.soniox.com https://api.soniox.com`.

No changes to `ClientFactory.ts`, `ProviderDescriptor.ts`, or `MainPanel.tsx` (all generic over the descriptor).

## Testing

- **`SonioxSttStream.test.ts`** (mock WS): first-frame config for one_way/two_way/auto-hints; raw-PCM fields present; empty-text-frame end; finalize/keepalive shapes; token/finished/error event parsing.
- **`SonioxTtsStream.test.ts`** (mock WS): one stream per utterance with sequential ids; lazy open on first text; prewarm reuse and two_way mismatch discard; `text_end` close; keep_alive timer; base64→Int16 decode; error → non-throwing degradation.
- **`SonioxClient.test.ts`** (mock both streams): token routing (original/none/translation), partial reset + final append, `<end>` segmentation, `<fin>`/`<end>` filtered from display, finals-only TTS feeding, two_way per-utterance language pick, textOnly skips TTS entirely, TTS failure keeps STT alive, no-interruption no-ops.
- Registry invariant test (`descriptorRegistry.test.ts`) catches any missed registration surface.
- **Pre-implementation spike (needs user key)**: voice × language matrix — verify Kenji/Maya speak zh/ja/en acceptably; outcome decides whether `two_way` TTS needs per-language voice mapping or one voice serves all.
- Final smoke: live key, dev build, full STS path (mic → subtitles + spoken translation) and textOnly path.

## Out of scope (deliberate)

- Backend-minted temporary keys (needed only for a future Kizuna-managed Soniox variant).
- Generic cross-provider STT/TTS composition layer (future project; this design only leaves the seams).
- Speaker diarization display, `<end>`-based karaoke alignment, auto-reconnect beyond the template behavior.

---

# Addendum 2026-07-19 — Mode-driven direction + Both single-session

Supersedes the standalone `twoWayTranslation` user toggle. Validated by live experiments (diarization on a single mixed stream; gain-strategy invariance; level invariance) — see `project_soniox_provider_research` memory.

## Insight

You / Others / Both **are** the translation direction. Every provider already derives direction from the mode picker via the speaker/participant client split ("swapped languages" for the participant). Soniox aligns with that instead of carrying its own direction toggle — and, because Soniox natively supports `two_way` + speaker diarization, **Both can collapse from two clients to one** (mic + system mixed into a single `two_way` session), halving STT cost.

| Mode | Soniox config | Audio | Clients |
|---|---|---|---|
| You | `one_way → targetLanguage` | mic | 1 (speaker path — generic) |
| Others | `one_way → sourceLanguage` (swapped) | system | 1 (participant path — generic) |
| Both, shared **ON** (default) | `two_way {language_a: source, language_b: target}` | mic + system **mixed** | **1 (new)** |
| Both, shared **OFF** (fallback) | two `one_way`, opposite directions | mic / system separate | 2 (existing generic path) |

## Decisions (user-confirmed 2026-07-19)

- **Remove** `SonioxSettings.twoWayTranslation` + its UI toggle + the four `settings.sonioxTwoWay*` / `settings.translationMode` locale keys. Direction is derived from mode at connect time. (Not shipped yet — no migration.)
- **Add** `SonioxSettings.bothModeSharedSession: boolean` (default **true**). UI: an option-button pill in Soniox settings, **greyed out unless the current mode is Both**, with a tooltip explaining when it applies. Label **"Shared session in Both mode"**.
- Tooltip copy (v1, state-based) — EN authoritative, replicate to 30 locales:
  - On (recommended): one Soniox session translates both sides with automatic speaker separation — lower cost and latency.
  - Off: a separate session per direction — more reliable when both people talk at once, but about twice the cost.
  - Disabled-state hint: "Only affects Both mode."
- **Mixer gain = fixed 0.5 per channel, summed** (`0.5*mic + 0.5*system`). Experiment proved Soniox recognition is level-invariant (WER 0.000 from full down to −18 dB) and identical across fixed-0.5 / limiter / hardclip; fixed 0.5 is simplest and can never clip. No dynamic gain, no mute compensation.
- **No mixing strategy recovers true simultaneous speech** (overlap loses the weaker side equally under every strategy) — this, not audio quality, is the sole justification for the OFF fallback.

## Architecture delta

### SonioxSessionConfig
Replace `twoWayTranslation: boolean` with `bidirectional: boolean` (derived at connect: true only for Both-shared). Keep source/target/voice.

### PcmMixer.ts (new, `src/services/clients/PcmMixer.ts`)
Pure logic, unit-testable. Two Int16 FIFOs; a 100 ms tick sums `0.5*A + 0.5*B` (zero-filling a starved side to preserve timing); output Int16 frame via callback. Backlog cap (~500 ms) drops oldest with a log. No Web Audio (cross-AudioContext drift is immaterial to STT — verified).

### SonioxClient — dual-port over one core (user design 2026-07-19)
Goal: **MainPanel keeps its two-client shape** (two refs, two audio feeds, two handler sets, symmetric teardown) — the two refs just point at one shared core, and the core knows which port fed it. Complexity moves out of MainPanel (shared, untestable) into SonioxClient (isolated, unit-testable).

- `SonioxClient` runs `bidirectional` when its session config carries `bidirectional:true` (set only for Both-shared). In that mode it owns an internal `PcmMixer`; `appendInputAudio` feeds mixer channel A; mixed frames go to the STT stream (two_way).
- `createSecondaryPort(): IClient` returns a lightweight adapter bound to the same core: its `appendInputAudio` feeds mixer **channel B**; `connect`/`disconnect`/`setEventHandlers`/lifecycle methods are **inert no-ops** (the core is driven by the primary/speaker port); read methods delegate. This is the "second client reference" MainPanel holds for the participant.
- **Item source tagging** (bidirectional only): the core sets `item.source` from token direction, so all items flow through the primary port's handlers yet display on the correct side —
  - original token: `language === sourceLanguage ? 'speaker' : 'participant'`
  - translation token: `source_language === sourceLanguage ? 'speaker' : 'participant'`
  - `combinedItems` already honors `item.source ?? fallbackSource`; the participant items list stays empty (harmless) and You/Others/Both display, bubble sides, and merge keep working unchanged.

### MainPanel.tsx — minimal, localized (two small branches, NOT a Both rewrite)
The user's port design keeps `connectConversation`, ModePicker, mute gates, waveforms, footer, and teardown **unchanged**. Only two localized branches:
1. Speaker session config for `SONIOX && Both && bothModeSharedSession` sets `bidirectional:true`.
2. Participant client creation for the same case returns `(<speaker core>).createSecondaryPort()` instead of `createAIClient()`.
Everything else (feed mic→speakerRef.appendInputAudio, system→participantRef.appendInputAudio, event handlers on each ref, symmetric teardown) is byte-identical to today. Teardown: disconnecting the speaker tears down the core; disconnecting the secondary port is a no-op.

### TTS output routing — single track in v1 (user decision 2026-07-19, direction confirmed)
v1 uses the **single existing `ai-assistant` sink** (→ virtual mic, exactly as today's speaker client). Only the **me→other** direction is spoken: TTS is fed only for translation tokens whose `source_language === sourceLanguage` (my speech → target language out); the TTS stream language is `targetLanguage`. The reverse direction (other→me, translated into my language) is **text-only** in v1. This matches the existing 2-client Both behavior (speaker spoken, participant text-only). Dual-sink routing (also voicing the other→me direction to my speakers) is a **deferred follow-up, not built**.

### Settings UI
- Remove the two-way toggle branch; add the `bothModeSharedSession` pill (greyed unless Both) in `ProviderSpecificSettings`. The greying reads the current mode.

## Superseded

The 2026-07-18 base plan's `twoWayTranslation` toggle (Task 6) and the direction-tooltip proposals (①②③ in the v1-proposals artifact) are obsolete. The only surviving tooltip is this addendum's fallback-toggle tooltip.

## Known limitations (2026-07-19 review)

- **Trailing-audio attribution across back-to-back utterances (codex P2, accepted).**
  `feedTts` re-points the single `audioItemId` at the new utterance's assistant
  item as soon as the next utterance's first translation final arrives. If the
  previous utterance's TTS stream is still draining (`SonioxTtsStream` keeps
  forwarding the old `drainingStreamId`'s audio while the next stream is
  queued), those trailing chunks attribute to the *next* item. Harmless for
  live playback; for `keepReplayAudio` it means a few boundary chunks land on
  the wrong item's `formatted.audio`. Only manifests on rapid, overlapping
  utterances. **Deliberately not fixed in v1** (user decision 2026-07-19) — the
  correct fix ties `audioItemId` to the TTS `stream_id` and is deferred.
