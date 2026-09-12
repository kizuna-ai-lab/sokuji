# OpenAI Live Provider — Design

**Date**: 2026-09-12
**Status**: Approved (brainstormed with user)
**Scope**: sokuji-react only — `sokuji-backend` needs no change.
**Related**: research note `docs/superpowers/notes/2026-09-12-openai-gpt-live-1-research.md`
(primary-source facts, API reference URLs, the two key-free probes); Soniox recoverable
outage design (`2026-08-06-soniox-recoverable-outage-design.md`, the outage-notice seam
reused here); `OpenAITranslateGAClient` (the client this one is a sibling of).

## Summary

Add a new BYOK provider, `openai_live` ("OpenAI Live"), that runs OpenAI's `gpt-live-1`
as a simultaneous interpreter over the Live API's primary WebSocket
(`wss://api.openai.com/v1/live/sessions`). The model is prompt-driven, full-duplex, and
speaks its translation at natural pace while the speaker keeps talking; it transcribes both
sides natively, so no transcription model is configured or billed.

The client is a sibling of `OpenAITranslateGAClient`: same continuous no-turn-loop shape,
near-identical event names, same silence-timer segmentation, same audio/karaoke/replay
plumbing. What is new is the connect head (`Authorization` header injected into the
WebSocket upgrade on both platforms, `session.start` as the first frame), one input event
name, a graceful `session.close` → `session.closed` shutdown, and a stall watchdog with one
silent reconnect. The descriptor is thin: instructions come from the existing editable
interpreter template (as for `openai`), voice from a 22-entry list, and the rest of the
capability surface is switched off.

First version is WebSocket only, Electron + extension only (the web dev build cannot set
upgrade headers), visible to every user, no Kizuna relay twin.

## Findings that shaped this (verified 2026-09-12)

### From the API reference and probes (details and URLs in the research note)

- `gpt-live-1` is accepted only by `/v1/live/sessions`; every Realtime endpoint rejects it.
  It is in this project's `/v1/models` listing, so key validation can check for it.
- The Live primary WebSocket rejects any upgrade that carries an `Origin` header: with a
  valid key, `Origin: http://localhost:5173`, `null`, `https://sokuji.kizuna.ai`,
  `chrome-extension://…`, `file://` and `https://api.openai.com` all answer `403 Forbidden`,
  the same request without `Origin` answers `101` (and the Realtime endpoint answers `101`
  with the Origin present). A browser adds `Origin` to every WebSocket upgrade and page
  script cannot remove it, so the header-injection layer strips it as well: Electron's
  `ws-headers-set` rule carries `removeHeaders: ['Origin']`, the extension's DNR rule adds
  `{ header: 'Origin', operation: 'remove' }`. Found on the first Electron GUI run
  (2026-09-12, after the branch was reviewed); the curl probes below had no `Origin`.
- The Live primary WebSocket ignores the browser `openai-insecure-api-key.` subprotocol
  (a raw upgrade with it returns `401 missing_authorization`, identical to sending nothing;
  `Authorization: Bearer` returns `401 invalid_api_key` for a bogus key; the same subprotocol
  against `/v1/realtime` returns `101`). A real `Authorization` header on the handshake is
  required. Sokuji already injects upgrade headers for Volcengine and Edge TTS on both
  platforms: Electron via the `ws-headers-set` / `ws-headers-clear` IPC into
  `session.defaultSession.webRequest.onBeforeSendHeaders` (`electron/main.js`, one-shot per
  host), the extension via `declarativeNetRequest` `modifyHeaders` rules on
  `resourceTypes: ['websocket']` (`extension/background/background.js`).
- Session config is fixed at `session.start`: `model`, `instructions` (≤ 16,384 tokens),
  `audio.format` (`audio/pcm` at 24000 — the recorder's native format), `audio.output.voice`,
  `delegation`. There is no language field, no turn detection, no noise reduction, no
  `output_modalities` (no text-only), no per-response `.done` events. Transcript deltas carry
  `start_ms` / `end_ms` on the session timeline. `session.usage.updated` reports cumulative
  seconds roughly every 15 s. Sessions end with `session.closed {usage, reason}` where
  `reason ∈ close_requested | expired | content | remote_hangup | connection_lost`.
- Pricing is $0.05 per minute of session wall time, billed per second, silence included.

### From the spike (15 Live sessions, 6 `gpt-realtime-2.1-mini` controls, same TTS clips)

Method: known-text clips synthesized with `gpt-4o-mini-tts` (zh/en/ja, 7–33 s), paced into
each session at real time in 100 ms PCM16 chunks, followed by 9–25 s of silence; output audio
classified by per-chunk RMS (Live streams zero-amplitude frames continuously, like the
translate API's heartbeat). Controls used Sokuji's default `server_vad` settings
(threshold 0.49, prefix 500 ms, silence 500 ms, `interrupt_response: false`) and Sokuji's
default interpreter template.

| Measure | `gpt-live-1` | `gpt-realtime-2.1-mini` |
| --- | --- | --- |
| Interpreter behaviour | 14/15 sessions: translation only, no chat, no delegation; "answer me, what time is it" translated, not obeyed; 20 s of silence produces nothing | translation only |
| Translation quality | one error in ~15 clips (四半期の振り返り会議 → 市售机型的回顾会议) | five errors (字幕 → 文字入力, 定价页面 → 订阅页面 / 旅途页面, 季度 → シーズン, 移动端 → 移動端末) |
| First voiced translation after the speaker starts | 4.1–30.1 s across runs, median ≈ 8 s; sentence-level, output starts ≈ 0.5–1 s after an input sentence ends, but sometimes only after the whole utterance | ≈ 1 s after each VAD pause (2.3–9.0 s after speech start) |
| Translation finished after the speaker stops (≈ 30 s monologues) | 8.5–19.2 s (audio is real-time paced) | ≈ 6 s (audio arrives faster than real time, queued playback) |
| Cost per 30 s clip incl. tail | $0.037–0.045 | $0.025 |
| Cost per minute of dense speech | $0.05 flat | ≈ $0.05 (measured from `response.done` usage) |
| Input transcript | included, full sentences with punctuation | separate transcription model, $0.003/min extra |
| Failures | 1 session stalled: transcripts and `usage.seconds` froze at 10 s, socket closed with code 1006 ~20 s later, no `error`, no `session.closed`; rerun succeeded | none |

Also verified: `alloy` (Sokuji's default) is accepted as a voice; the Sokuji template and
OpenAI's own interpreter template both work; a Chinese target streams mid-speech on a long
clip (the "waits for the end" pattern seen on short clips was the model waiting for a pause
that happened to be the end).

Consequences for the design: the product value is translation quality and a free,
high-quality input transcript, not latency; the client must survive a silent upstream stall;
segmentation must tolerate 1.5 s gaps inside one sentence's transcript deltas (observed up
to 1.65 s).

## Decisions

| Decision | Rationale |
| --- | --- |
| Build it (user, after seeing the latency data) | Quality and the native transcript are worth a provider; latency is documented, not hidden. |
| New descriptor, not a model row on `openai` or `openai_translate` | Neither is a superset: `openai` would hide five controls (turn detection, noise reduction, text-only, reasoning, transcript model), `openai_translate` would need its 13-language target union, transcript dropdown and Kizuna twin carved out. Capabilities are static per descriptor; the only per-model UI gate in the app is the reasoning-effort dropdown. A copied descriptor is ~150 lines. |
| Client is a sibling of `OpenAITranslateGAClient`, copied, not shared | The repo's own precedent (`OpenAITranslateWebRTCClient`: "Methods are copied verbatim from the GA client per spec — DRY refactor can come later"). Sharing would put a protocol switch inside a client that already carries translate-specific heartbeat logic. |
| WebSocket only in v1 (user) | Matches the spike and the translate GA client; header injection exists on both platforms. WebRTC (`POST /v1/live/sessions`, 15 s initialisation charge) is a follow-up. |
| Visible to all users, no feature flag (user) | Same as `openai_translate`: BYOK, the user carries the cost and sees the latency. |
| Electron + extension only | The plain web build cannot set an upgrade header and the subprotocol trick is ignored (probe). Registered under `isElectron() \|\| isExtension()`, as Volcengine AST2 is. |
| Instructions from the global interpreter template | It already exists, is user-editable, and is the same shape as OpenAI's published Live interpreter prompt. Live's 16,384-token limit is far above the ~300-token default. |
| Voice list: the 22 Live voices, default `marin` | The 10 Realtime voices plus the 12 new ones (English / Brazilian Portuguese). `marin` is Live's documented default. |
| Silence-timer segmentation, defaults user 1.0 s / assistant 1.5 s | Same mechanism as translate; the assistant default is raised from 0.5 s because Live's intra-sentence transcript gaps reach 1.65 s. |
| Assistant items also close at sentence ends, with the audio following by timeline (added after the first GUI run, 2026-09-12) | A continuous speaker never gives the assistant timer a 1.5 s gap and Live has no per-response done event, so a two-minute monologue became one translation item while the source was cut into twenty. The text side closes on a sentence-final mark; the audio side moves to the next item once the session timeline (origin = `session.started`) passes the sentence's last `end_ms` + 300 ms, so karaoke anchors and replay audio stay with their sentence. Measured: transcript deltas arrive ~600 ms after their `end_ms`, i.e. together with the sentence's last audio, so the hand-over is effectively immediate and the timeline check is a guard. |
| Both sides split inside the delta, with abbreviation protection; the source side also splits on timeline gaps and both sides have a span cap (second GUI round, 2026-09-12) | The second run showed two failures of the first rule: "Dr." was taken for a sentence end, and a fast speaker who never paused 1 s and whose transcript carried no punctuation became one source block. Live also often puts the terminal at the *start* of the next delta ("。また"), which the end-of-transcript regex cut one delta late. So the split point is now found inside each delta (last terminal, closing quotes included, judged on the whole word even when it began in an earlier delta; periods after abbreviations, initials, inside decimals and in an ellipsis do not count); the head finishes the current item, the rest opens the next one. Source items additionally close when the speaker's own timeline shows a gap of ≥ 600 ms between consecutive deltas (spike data: pauses 600–1400 ms, intra-sentence gaps ≤ 400 ms, p90 ≤ 600 ms), and any item is cut at the next delta boundary once it spans 12 s (source) / 15 s (translation) of timeline. The wall-clock silence timers stay as the outer safety net. |
| A pause only ends a source item that already holds 4 s; long items are cut at the next clause mark before the hard cap; the translation cap is 30 s (third GUI round, 2026-09-12) | A slow, punctuated speaker showed the opposite failure: the 600 ms gap rule cut every pause into 1–3 s clause fragments, each starting with the comma Live puts at the head of the next delta, and one long sentence's translation hit the 15 s cap mid-sentence ("…fiscal resources to" / "keep going."). Now an ordinary pause (≥ 600 ms on the timeline, or the silence setting on the wall clock) ends a source item only once it spans ≥ 4 s; a long pause (≥ 2× the silence setting) ends anything; the mark at the head of the delta after a pause stays with the clause before it. Past 8 s (source) / 20 s (translation) the item is cut at the next clause mark (`,，、;；:：—–`); past 12 s / 30 s anywhere. `co`, `corp`, `bros` joined the abbreviation list after "Nan-I Book Co." was cut; a period followed by a comma, or by a space and a lowercase letter, is not a sentence end. |
| One silent reconnect on an unexpected end, then a notice | A dead interpreter mid-meeting is worse than a 1–2 s gap. Instructions are static, so a fresh session loses nothing. A second unexpected end within 60 s ends the session with the localized notice through the client-held system item seam (Soniox recoverable-outage design). |
| Participant leg supported the way translate does it | `buildParticipantSessionConfig` forces `textOnly: true` for every provider; Live has no text-only, so the participant client receives audio it does not play and uses the transcripts. Identical to `openai_translate` today. |
| No Kizuna relay twin | The relay would need Live support in sokuji-backend. Out of scope. |
| Description copy states the billing model | "Billed per session minute, silence included" so a user in a sparse meeting is not surprised. |

## Architecture

New files:
- `src/services/clients/OpenAILiveClient.ts` — the `IClient` implementation.
- `src/services/providers/OpenAILiveProviderConfig.ts` — settings type, defaults, descriptor.
- `src/services/clients/OpenAILiveClient.test.ts`, `src/services/providers/OpenAILiveProviderConfig.test.ts`.

Modified files:
- `src/types/Provider.ts` — `OPENAI_LIVE = 'openai_live'` in the enum and the `ProviderType` union.
- `src/services/interfaces/IClient.ts` — `OpenAILiveSessionConfig`, its guard, the `SessionConfig` union.
- `src/stores/settingsStore.ts` — `openaiLive` slice, `updateOpenAILive`, `useOpenAILiveSettings`, `PROVIDER_SLICE_REGISTRY` entry.
- `src/stores/logStore.ts` — five Live literals in the closed `EventData['type']` union (`session.start`, `session.close`, `session.close_timeout`, `session.input_audio.append`, `session.connection_lost`).
- `src/services/providers/OpenAIProviderConfig.ts` — `LANGUAGES` and `VOICES` made public statics so the Live descriptor can share them.
- `src/services/providers/ProviderConfigFactory.ts` — registration after `OPENAI_TRANSLATE`, gated `isElectron() || isExtension()`.
- `src/components/Settings/sections/LanguageSection.tsx`, `ProviderSection.tsx`, `ProviderSpecificSettings.tsx` — one `case` / branch each where sibling providers already switch.
- `src/locales/*/translation.json` (30 catalogs) — `providers.openai_live.name`, `.description`, and `mainPanel.openaiLiveConnectionLost`.
- `extension/background/background.js` — `OPENAI_LIVE_SET_HEADERS` / `OPENAI_LIVE_CLEAR_HEADERS` message handlers and DNR rule.
- `extension/manifest.json` — `wss://api.openai.com/*` in `host_permissions`.
- Tests that pin the registry: `descriptorRegistry.test.ts` (count, `wireTag`, `EXPECTED_SLICE_KEYS`), `ProviderIcons.test.tsx` if it enumerates the icon map, `locales.consistency.test.ts` (lockstep, no change needed if all catalogs gain the keys).

Nothing in `MainPanel.tsx`, `IClient` handler shapes, `electron/main.js` or the backend changes.

## 1. Client — `OpenAILiveClient`

### 1.1 Connect

`connect(config: OpenAILiveSessionConfig)`:

1. Reset per-session state (items, timers, audio maps, sequence counter, watchdog).
2. Register the upgrade header for host `api.openai.com`:
   - Electron (`isElectron() && window.electron?.invoke`): `window.electron.invoke('ws-headers-set', { host: 'api.openai.com', headers: { Authorization: 'Bearer <key>' } })`. The main process consumes the rule on the first WebSocket upgrade to that host.
   - Extension (`isExtension()`): `chrome.runtime.sendMessage({ type: 'OPENAI_LIVE_SET_HEADERS', apiKey })`, awaiting `{ success }`. The background adds one dynamic DNR rule (id base 4000) with `urlFilter: '||api.openai.com/v1/live/'`, `resourceTypes: ['websocket']`, `modifyHeaders` set `Authorization`. The narrow `urlFilter` keeps the rule off the Realtime upgrade the `openai` provider makes.
   - Otherwise: throw `Error('OpenAI Live needs the desktop app or the browser extension')` — unreachable in practice because the provider is not registered on the web build; kept so a misconfiguration fails loudly instead of hanging in `waitForSessionStarted`.

   On both platforms the header is cleared once `session.started` arrives (`ws-headers-clear` / `OPENAI_LIVE_CLEAR_HEADERS`; Electron's one-shot rule was already consumed by the upgrade, so clearing is a no-op there) and on every failure path — in both cases only when the session generation is unchanged, so a stale clear from a superseded connect or reconnect attempt can never delete the newer session's not-yet-consumed rule. An attempt still queued at the upgrade gate when its session is superseded aborts there and never registers a header or opens a socket.

   Registrations and upgrades are serialised process-wide (a module-level gate held from `registerUpgradeHeader()` until the socket's `open`/`error`/`close`, 15 s cap), because the Electron rule is per host and one-shot and the extension rule is per host and cleared by the first leg to start: two legs reconnecting at once would otherwise send one upgrade without its header.
3. Open `new WebSocket('wss://api.openai.com/v1/live/sessions')` — no query string, no subprotocols.
4. On `open`, send the first frame:
   ```json
   { "type": "session.start", "event_id": "start_<n>",
     "session": {
       "model": "gpt-live-1",
       "instructions": "<rendered interpreter template>",
       "audio": { "format": { "type": "audio/pcm", "rate": 24000 }, "output": { "voice": "<voice>" } },
       "delegation": { "type": "client" } } }
   ```
5. `waitForSessionStarted()` — same shape as translate's `waitForSessionCreated` (30 s timeout, `error` frame rejects with its message, other frames forwarded to the regular handler). Record `session.id` and `expires_at` from `session.started` and log them as a `session.opened` client event.
6. Clear the upgrade header (both platforms, when the session generation is unchanged — see step 2), mark connected, fire `onOpen`.

`session.start` is built by a static `buildSessionStart(config)` so tests pin the wire shape.

### 1.2 Server events

| Event | Handling |
| --- | --- |
| `session.input_transcript.delta` | Split the leading punctuation/whitespace off (`LEADING_PUNCT_RE`). No open item: drop it (its sentence is already closed). Open item and the speaker's timeline shows a pause (`pauseEndsUserItem`: `start_ms` ≥ 600 ms past the previous delta's `end_ms`, and the item spans ≥ 4 s or the gap is ≥ 2× the silence setting): append the mark to the item, complete it. Then on the remaining text: find the last sentence end (`lastSentenceEnd`, judged with the item's transcript as context); if none and the item spans ≥ 8 s of timeline, the last clause mark. Head → current item (`appendUserText`, opening one if needed, leading whitespace dropped on a fresh item), `onConversationUpdated({ item, delta: { transcript } })`, `completeUserItem()`; remainder → a fresh item. No split: append, and complete if the item spans ≥ 12 s. Reset the user silence timer while an item is open. |
| `session.output_transcript.delta` | Same on the assistant side without the pause rule (`appendAssistantText`, which also records the delta's `end_ms` for the item): leading punctuation is dropped only when no item is open; the split is the last sentence end, or past 20 s of timeline the last clause mark; the head's item is closed (`closeAssistantText`: it joins the pending-audio queue and later deltas open a new item), the remainder opens the next item; with no split the item is closed once it spans 30 s. Reset the assistant silence timer. |
| `session.output_audio.delta` | Base64 → `Int16Array`; frames with RMS 0 are dropped (Live streams silence continuously); voiced frames: open the assistant item if none, push to `audioChunks` when `keepReplayAudio`, advance `audioCumSamples`, append a karaoke segment, emit `onConversationUpdated` with `delta.audio` and the sequence number — verbatim from translate. |
| `session.usage.updated` | Feed the watchdog (§1.5); log. |
| `session.delegation.created` | Log only. The interpreter prompt forbids delegation; if it happens the app ignores it and the model continues. |
| `session.instructions.appended` and the other `*.appended` acks | Log only (nothing sends them in v1). |
| `error` | Log; `onError(event.error)` — a conversation bubble and an `api_error` per the repo's `onError` convention; the session itself continues unless the server also closes it. A Live `error` with `client_event_id` for our `session.start` already rejected in step 5. |
| `session.closed` | Record `reason` and `usage`; resolve the pending close if `disconnect()` is waiting; otherwise (unexpected) → §1.5. |
| `info`, anything else | Forward to `onRealtimeEvent` as `source: 'server'`; silent audio frames are not forwarded (same rule as translate). |

Input audio: `appendInputAudio(Int16Array)` → `{ type: 'session.input_audio.append', audio: <base64> }` while `readyState === 1`, else dropped silently (hot path). Frames with RMS 0 are not forwarded to the log; the wire send always happens. The watchdog notes the wall time of the last voiced input frame.

Segmentation is the translate client's pair of silence timers with clamped thresholds (0.1–3.0 s) plus the in-delta rules above. Sentence ends are `。．！？!?.` followed by any closing quotes/brackets; a period does not count when the next character is a letter or digit (`3.5`, `e.g`, `U.S`), a comma/semicolon/colon (`Co., Ltd`), or whitespace followed by a lowercase letter, when it is part of an ellipsis, when the word before it is a single capital (an initial) or one of a short abbreviation list (`mr mrs ms dr prof sr jr st mt vs etc inc ltd co corp bros fig vol al e.g i.e a.m p.m u.s u.k`; `no` is deliberately absent because "No." ends real sentences). The user silence timer lets a source item shorter than 4 s live through one firing and ends it on the second (so twice the setting ends anything); an item without timeline stamps ends on the first. On the assistant side, voiced audio attaches to the oldest queued sentence until the session timeline passes that sentence's `end_ms` + 300 ms (`scheduleAudioHandoff`), then to the next; without a timeline origin the hand-over is immediate. The assistant silence timer flushes the whole queue (`completeAssistantItem`) when the model stops; `finalizeAssistantItem` carries the replay-audio merge. `completeUserItem` is unchanged apart from clearing the item's timeline start and the timer's fired-once flag.

### 1.3 Disconnect

`disconnect()`: send `{ type: 'session.close' }` if the socket is open, await `session.closed` or socket close for at most 5 s, then `ws.close()`, clear the header rule (extension), complete in-flight items, fire nothing extra (MainPanel owns teardown). A close that times out is logged as `session.close_timeout` on the realtime log; it is not an error surfaced to the user.

### 1.4 No-ops and updates

`createResponse`, `cancelResponse`, `appendInputText` are no-ops (Live has no turn loop and no text input in this design). `updateSession` only updates the two silence thresholds locally — every startup field is immutable on the wire.

### 1.5 Watchdog and reconnect

Detection, while connected and after `session.started`:
- **Stall**: two consecutive `session.usage.updated` events with equal `usage.seconds` during which at least one voiced input frame was sent. Observed cadence is ~15 s, so detection takes ~30 s; the stalled spike session produced exactly this signature.
- **Abnormal close**: the socket's `close` fires without a preceding `session.closed`, or `session.closed` arrives with `reason` other than `close_requested` while no `disconnect()` is in progress (`expired`, `connection_lost`, `remote_hangup`, `content`).

Reaction:
1. First unexpected end of this session (or of a session started less than 60 s ago by a previous reconnect): complete in-flight items, `onReconnecting()`, log `session.reconnecting { cause }`, tear the socket down, and run the connect sequence again with the same config (Electron re-registers the one-shot header; the extension rule is re-added). On `session.started`: `onReconnected()`, resume forwarding audio. Audio arriving during the gap is dropped, not buffered. Items and conversation history are kept; the model gets no history (instructions are the whole context an interpreter needs).
2. Second unexpected end within 60 s of a reconnect, or a reconnect that fails to reach `session.started`: push a client-held `role: 'system', type: 'error'` `ConversationItem` with `i18n.t('mainPanel.openaiLiveConnectionLost')`, `onConversationUpdated`, then `onError(cause)` (keeps the `api_error` analytics event) and `onClose`. The raw close code / reason stays on the realtime log as `session.connection_lost`. This is the Soniox recoverable-outage seam, unchanged.

Both legs of a Both session reconnect independently; the upgrade gate in §1.1 keeps their header registrations from colliding.

`reason: 'content'` (safety filter ended the session) is treated the same as any other unexpected end: one reconnect, then the notice. A `content` cut that only stops the current audio arrives as an `error` frame without a close and is handled by the `error` row above.

### 1.6 Diagnostics policy

The client never calls `console.*` or `report()`. A frame that fails to parse → `onDiagnostic({ code: 'parse_error', … })`, latched per burst as in translate. A header registration failure throws out of `connect()`; MainPanel's `onConnectFailed` reports it once. `send_dropped` is not used: dropping audio on a closed socket is the documented hot-path rule.

## 2. Descriptor — `OpenAILiveProviderConfig`

```ts
export interface OpenAILiveSettings {
  apiKey: string;
  sourceLanguage: string;       // 'auto' allowed; UI + template rendering only
  targetLanguage: string;       // template rendering; any entry of the shared language list
  voice: string;                // one of the 22 Live voices
  userSilenceDuration: number;      // seconds, 0.1–3.0
  assistantSilenceDuration: number; // seconds, 0.1–3.0
}
export const defaultOpenAILiveSettings = {
  apiKey: '', sourceLanguage: 'en', targetLanguage: 'zh_CN', voice: 'marin',
  userSilenceDuration: 1.0, assistantSilenceDuration: 1.5,
};
```

- `settingsSliceKey = 'openaiLive'`, `supportsWebRTC = false`, default `credentialFields`.
- `getConfig()`: `id: 'openai_live'`, `displayName: 'OpenAI Live'`, `apiKeyLabel: 'OpenAI API Key'`,
  `languages`: the same list `OpenAIProviderConfig` exposes (regional codes, template-friendly
  names), no `targetLanguages` (unrestricted), `voices`: 22 entries, `models: [{ id: 'gpt-live-1', type: 'realtime' }]`,
  `transcriptModels: []`, `noiseReductionModes: []`.
- capabilities: `hasTemplateMode: true`, `hasTurnDetection: false`, `hasVoiceSettings: true`,
  `hasNoiseReduction: false`, `hasModelConfiguration: false`, `hasReasoningEffort: false`,
  `textOnlyCapability: 'never'`, `turnDetection: { modes: [], hasThreshold: false, hasPrefixPadding: false, hasSilenceDuration: true, hasSemanticEagerness: false }`,
  zeroed `temperatureRange` / `maxTokensRange` (required by the type, hidden by the flags).
- `createClient(creds, _options)` → `new OpenAILiveClient(creds.primary)`; `options.transport` is ignored (no WebRTC).
- `validateAndFetchModels`: `OpenAIClient.fetchOpenAIModelsList(key)`, keep ids that equal
  `gpt-live-1` or start with `gpt-live-` and are not `gpt-live-transcribe`, typed `realtime`,
  newest first. Empty → `{ valid: false, message: i18n.t('settings.realtimeModelNotAvailable'), hasRealtimeModel: false }`;
  otherwise the existing `settings.realtimeModelAvailable` message. No new locale keys for validation.
- `latestRealtimeModel(models)` → `models[0]?.id ?? 'gpt-live-1'`.
- `buildSessionConfig(slice, systemInstructions)` →
  `{ provider: 'openai_live', model: 'gpt-live-1', voice, instructions: systemInstructions, sourceLanguage, targetLanguage, userSilenceDurationMs, assistantSilenceDurationMs }`.
- `buildParticipantSessionConfig`: the base implementation (swapped instructions,
  `textOnly: true`, the semantic-VAD block the base attaches is ignored by this client).

`OpenAILiveSessionConfig` extends `BaseSessionConfig` with `provider: 'openai_live'`,
`sourceLanguage?`, `targetLanguage`, `userSilenceDurationMs?`, `assistantSilenceDurationMs?`;
`isOpenAILiveSessionConfig` guards on the provider tag.

## 3. Types, store, registration

- `Provider.OPENAI_LIVE = 'openai_live'`; add to `ProviderType`. Not added to
  `OPENAI_COMPATIBLE_PROVIDERS` (that set means "uses the OpenAI settings shape").
- `settingsStore.ts`: `openaiLive: OpenAILiveSettings` in the state type, `updateOpenAILive`,
  `useOpenAILiveSettings`, `PROVIDER_SLICE_REGISTRY.openaiLive = { defaults: defaultOpenAILiveSettings }`,
  the defaults in the initial state. No migration: the slice is new. The silent prefill in
  `setProvider` (`settingsStore.ts`: on the first switch to `OPENAI_TRANSLATE` with an empty
  key, copy `openai.apiKey` across, persist it, validate in the background) is extended to
  `OPENAI_LIVE` with the same three conditions, so a user who already entered an OpenAI key
  does not paste it a third time.
- `ProviderConfigFactory`: `if (isElectron() || isExtension()) configs.set(Provider.OPENAI_LIVE, new OpenAILiveProviderConfig())`
  immediately after `OPENAI_TRANSLATE`.
- `descriptorRegistry.test.ts`: provider count 14 → 15 (the test mocks
  `isElectron: () => true`, so the Electron-gated registration is counted),
  `wireTag.openai_live = 'openai_live'`, `EXPECTED_SLICE_KEYS[Provider.OPENAI_LIVE] = 'openaiLive'`,
  `DEFAULTS_BY_SLICE.openaiLive`.

## 4. UI touch points and locales

- `LanguageSection.tsx`: `case Provider.OPENAI_LIVE:` in the source-language and
  target-language update switches → `updateOpenAILive({ sourceLanguage | targetLanguage })`.
  The `auto` option stays available (the exclusion list names translate, not Live).
- `ProviderSection.tsx`: icon map entry `[Provider.OPENAI_LIVE]: OpenAIIcon`; `case Provider.OPENAI_LIVE:` in the API-key writer.
- `ProviderSpecificSettings.tsx`: the slice/updater helpers gain an `openai_live` branch so the
  voice picker (`hasVoiceSettings`) and the two silence sliders (`hasSilenceDuration`) read and
  write `openaiLive`. No new components; the transport selector is hidden because
  `supportsWebRTC` is false and the slice has no `transportType`.
- Locales, all 30 catalogs (`locales.consistency.test.ts` keeps them in lockstep with `en`):
  - `providers.openai_live.name`: "OpenAI Live"
  - `providers.openai_live.description` (en): "GPT-Live-1 as a simultaneous interpreter. Billed per session minute, silence included."
  - `mainPanel.openaiLiveConnectionLost`: the same localized sentence as
    `mainPanel.sonioxConnectionLost` in every catalog ("The connection was interrupted — tap
    Start Session in a moment to continue."); the wording is provider-agnostic, so no new
    translation was needed.
- CLAUDE.md: add `openai_live` to the provider sentence in Project Overview only if that
  sentence is updated for other reasons; the registry test is the source of truth.

## 5. Platform pieces

- `extension/manifest.json`: add `"wss://api.openai.com/*"` to `host_permissions`. Without
  the explicit `wss://` entry Chrome silently ignores the DNR rule for the upgrade (the Edge
  TTS comment in `background.js` records this). `connect-src` already allows `wss://api.openai.com`.
- `extension/background/background.js`: `openaiLiveSetDNRHeaders(apiKey)` /
  `openaiLiveClearDNRHeaders()` following the Volcengine functions (serialized through the
  same `dnrUpdatePromise`, rule id base 4000, remove-then-add), and two `onMessage` branches.
  The key is held only in the dynamic rule for the seconds between registration and
  `session.started`; it is never logged.
- Electron: no change; `ws-headers-set` already accepts any host and header map.

## 6. Testing

- `OpenAILiveClient.test.ts` (mocked `WebSocket`, `window.electron.invoke`, `chrome.runtime.sendMessage`):
  `buildSessionStart` wire shape; connect registers the header before opening the socket and
  clears it on failure; `session.started` resolves connect and, in the extension path, clears
  the DNR rule; input/output transcript deltas create and extend items and the silence timers
  complete them; silent output frames are dropped and voiced frames attach audio with
  sequence numbers and karaoke segments; `disconnect()` sends `session.close` and waits for
  `session.closed` (and gives up after 5 s); stall detection from two frozen usage updates
  with voiced input in between; 1006 without `session.closed` triggers one reconnect with
  `onReconnecting` / `onReconnected`; a second failure inside 60 s pushes the localized system
  item and fires `onError` + `onClose`; no `console.*` anywhere (`consoleLedger.consistency.test.ts`).
- `OpenAILiveProviderConfig.test.ts`: config shape and capabilities; `buildSessionConfig`
  and the participant swap; model filtering (accepts `gpt-live-1`, rejects `gpt-live-transcribe`
  and every `gpt-realtime*`); validation messages.
- Registry, locale and icon consistency tests updated as listed above.
- Live smoke (manual, with a real key): the spike scripts under the job's tmp dir are the
  reference; `benchmark/openai-live/live-smoke.mjs` (see its README) is the repeatable smoke.
  Then one Electron dev run and one packed extension run, each: start a session,
  speak two sentences, confirm captions on both sides and audio out, stop, confirm
  `session.closed` in the log.

## 7. Out of scope and follow-ups

- WebRTC transport (`POST /v1/live/sessions`, JSON offer/answer, 15 s initialisation charge):
  a sibling of `OpenAITranslateWebRTCClient` once WS has shipped.
- Replacing the wall-clock silence timers entirely with `start_ms` / `end_ms` (they are now
  one input to segmentation, not the only clock).
- Kizuna relay twin; delegation to a backend model; custom voices; stored sessions and forks.
- Unrelated but found by the same research: `gpt-4o-mini-transcribe` (the `openai` provider's
  default transcript model), `gpt-4o-transcribe` and `whisper-1` shut down on 2027-02-26; file
  as its own issue.

## Known limitations

- Latency is what the spike measured: the interpreter may start 4–30 s after the speaker
  begins and finishes 8–20 s after a long monologue ends. The description copy does not
  promise "simultaneous".
- Billing runs on wall time; a paused session still costs $0.05/min until stopped.
- Language coverage for `gpt-live-1` is unpublished; zh, ja and en are verified.
- Stall detection needs two usage updates (~30 s); a faster signal does not exist in the
  event stream.
