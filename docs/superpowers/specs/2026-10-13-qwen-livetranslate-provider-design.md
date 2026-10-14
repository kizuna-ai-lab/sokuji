# Qwen LiveTranslate Provider (BYOK) — Design

**Date**: 2026-10-13
**Status**: Approved section by section in chat (owner, 2026-10-13); written spec pending review.
**Scope**: a new own-key provider, `qwen_livetranslate`, for Alibaba's
`qwen3.8-livetranslate-flash-realtime`, both legs (mine and the other party's). Flagged at first; unflagged by the owner on 2026-10-14 (D9).
**Issue**: kizuna-ai-lab/sokuji#620.
**Evidence**: live-API probes on 2026-10-13 against the owner's QwenCloud and 千问云 keys, about
$0.1 in all. Scripts and full records are in `~/Desktop/kizunaai/qwen-livetranslate-probe-2026-10-13/`
(outside the repo); the probe `scripts/dev/wire-probe/qwen.mts` lives on the unpushed local branch
`worktree-qwen-livetranslate-probe`. Findings are summarised below.
**Related**: `2026-09-22-client-contract-design.md` (the provider contract this follows);
`2026-10-01-unified-language-codes-design.md` (app language codes); PR #618 (participant voice);
PR #613 (person labels).

## Summary

A user with their own Qwen API key picks **Qwen LiveTranslate**. Each leg, mine and the other
party's, opens its own Qwen realtime session and gets streamed source text, translated text and,
when the leg speaks, the translated voice in a preset voice or in the speaker's own cloned voice.
Push-to-talk works. The key may come from QwenCloud (international) or 千问云 (mainland China);
the provider detects which. It runs on the desktop app and the browser extension. It was built
**flagged** (development builds and a tester switch only); the owner unflagged it after his live
test on 2026-10-14 (D9).

**Out of scope:**
- managed (Kizuna-billed) Qwen;
- face-to-face;
- image input;
- pre-created cloned voices (the Voice Cloning API);
- the web build;
- reconnecting after a drop;
- detecting uplink backlog (see Known limitations).

## Evidence (probes, 2026-10-13)

| Question | Finding |
|---|---|
| Storefronts and keys | Two key domains. An international key works on `maas.qwencloudapi.com` (QwenCloud) and `dashscope-intl.aliyuncs.com`; a mainland key on `maas.qianwenaiapi.com` (千问云) and `dashscope.aliyuncs.com`. Each is refused (401) on the other domain |
| `dashscope.aliyuncs.com` | Serves 3.8 through an old flat session: default voice `Chelsie`, refused at the first speech (close 1011); server_vad at 800 ms; no `speaker_id`. **Not used** |
| Auth | `Authorization: Bearer <key>` on the upgrade, or an undocumented `?api_key=`. `Origin` is never checked. We use the header (decision D3) |
| Token endpoint | `POST https://<host>/api/v1/tokens?expire_in_seconds=60` with the Bearer key: 200 `{token, expires_at}` on the key's own host, 401 `{code: "InvalidApiKey"}` on the other. CORS allows any Origin (`file://`, `chrome-extension://…`, `http://localhost`), the `authorization` header, and the 401 too |
| `session.update` | **One per session**; a second gets `error invalid_value "Session update error: session already started…"` and close 1007. It **must** carry `translation.language`, or else `"Invalid translation parameter."` and close 1007 |
| Voice | Set by `session.audio.output.voice`; the flat `voice` is silently ignored. All 47 documented presets speak; `Cherry` is refused. An unknown name passes the update and fails at the first `speech_started`: `COMMON_ERROR "Voice 'X' is not supported."`, close 1007 |
| Voice cloning | `enable_voice_clone: true`, `voice_clone_options.frequency: "always"`, `audio.output.voice: "default"`. Each turn's output pitch follows its speaker (input 190/138/119/254 Hz → output 189/125/135/231 Hz; Tina is always 238–267 Hz). No extra tokens |
| Targets | 29 spoken, 31 text-only. A text-only target with `output_modalities ["text","audio"]` fails at update: `"Target language 'uk' only supports text output…"`. `zh-TW` is invalid |
| Source language | Always auto-detected; no field sets it |
| Input audio | `audio.input.format: {type: "pcm", sample_rate: 24000}` works (server timings identical to 16 kHz). The contract's 24 kHz goes straight through |
| Output audio | PCM16 at 24 kHz in `response.audio.delta` |
| Turns, auto | Default `audio.input.turn_detection.type = speaker_detection` with `silence_duration_ms` 2500. A turn closes on a speaker change or 2.5 s of silence. `speaker_id` on `input_audio_buffer.speech_started` is real diarization: A B A B gave 1 2 1 2. Translation streams while the person still speaks |
| Turns, manual | `turn_detection: null`: translation still streams during speech, but the turn never closes on silence. `input_audio_buffer.commit` → `committed`, then the source `completed` and the translation `done` within about 90 ms. `input_audio_buffer.clear` → `cleared`; the in-flight response gets no `done`. No `speech_started` and no `speaker_id` in manual mode. **2026-10-14, seven sessions:**
<br>• A press's items appear about 0.5–0.7 s into its audio, or after `committed` for a very short press. `committed` names the heard item (`item_id`) when it exists, which the docs do not list.
<br>• Until the committed turn's `response.done`, every append is refused with "Previous turn is still processing, please wait for completion before sending new audio." A 9.2 s press had its `response.done` 0.52 s after release; a press started at that release lost its first 0.5 s.
<br>• `clear` with speech in the buffer makes the next turn fail ("previous segment has not received SegmentEnd"). `clear` while a response is still being produced cuts that response off, with no `done`.
<br>• A commit with nothing appended, or right after a `clear`, fails with "no active inference", and every later append is refused.
<br>• A commit on a 0.3 s tap or on 0.4 s of silence ends cleanly, with empty texts and `response.done`. |
| Events | Each turn creates two items (both role `assistant`): the heard one (id from `speech_started`, or the first `conversation.item.created`) and the translation, whose `previous_item_id` is the heard item. Source text arrives as `conversation.item.input_audio_transcription.delta` then `.completed` (`transcript`; no language or emotion field; punctuation inconsistent). Translation as `response.audio_transcript.delta` then `.done` with audio on, or `response.text.delta` then `response.text.done` without. Deltas append; nothing is revised |
| Ending | The server never closes a socket, not 30 s after `session.finished` and not after 90 s idle. `session.finish` → `session.finished` in 0.1–0.7 s |
| Billing | 7 tokens per whole second of each turn's audio window (idle silence is free); 12.5 tokens per second of output audio; a fixed 47 input text tokens per session. `response.done.usage` is the session's running total. Console `status_code` is 400 for every session that reached the model; it does not mean failure |
| Errors | Bad key: upgrade 401 `InvalidApiKey`. Failures mid-session arrive as `error` then close 1007 or 1011 with the message as the reason |
| Network | From the owner's machine both mainland hosts resolve to IPv6, and that route carried only about 20 KB/s against the ~43 KB/s a 16 kHz base64 stream needs; the server fell 34 s behind in 30 s. Over IPv4 the lag was 0.7–1.3 s, the same as international |

## Decisions

- **D1 Model.** `qwen3.8-livetranslate-flash-realtime` only, named in one constant.
- **D2 Storefronts.** International (`maas.qwencloudapi.com`) and mainland (`maas.qianwenaiapi.com`),
  detected per key (§2). No region setting.
- **D3 Auth.** The documented `Authorization: Bearer` header through the existing header seam
  (`src/lib/contract/headerSocket.ts`). Therefore `platforms: ['electron', 'extension']`; the web
  build does not offer the provider.
- **D4 Legs.** One independent session per leg (approach A). No `session.startBoth`.
- **D5 Voices.** One list per leg: 47 presets plus "the speaker's own voice" (real-time clone),
  like Doubao AST 2.0's picker.
- **D6 Turns.** `['auto', 'manual']`. Manual uses `commit` only: a cancel is a release, and turns are serialised on `response.done` (§6, "Turns").
- **D7 Person labels.** Only the participant leg carries `person` (Soniox's rule).
- **D8 No reconnect.** A drop fails the leg with `connection_lost`, as OpenAI Translate and AST2 do.
- **D9 Flagged, then unflagged.** It shipped `flagged: true` with `testerSwitch: 'debug:qwen-livetranslate'`. The owner unflagged it after his live test (2026-10-14), so the flag and the switch are gone and release builds offer it on the desktop app and the extension. It still has no `guideUrl`: the site has no Qwen tutorial yet.

## 1. Definition — `src/providers/qwen_livetranslate/provider.ts`

```ts
{
  id: 'qwen_livetranslate',
  kind: 'own-key',
  platforms: ['electron', 'extension'],
  icon: QwenIcon,
  settings: { key: 'qwenLiveTranslate', defaults: QWEN_DEFAULTS },  // no legacyKeys, no migrate beyond defaults
  Settings: QwenSettingsView,
  VoiceSummary: QwenVoiceSummary,
  credentials: qwenCredentials,
  check: checkQwen,
  checkReads: [],
  languages: qwenLanguages,
  speech: 'optional',
  textInput: () => false,
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],
  participantSpeech: true,
  build: buildQwen,
  describe: (c) => ({ translationModel: c.model }),
  start: createQwenAdapter({ openHeaderSocket: platformHeaderSocket, detect: detectEndpoint }).start,
}
```

The provider sits in `src/providers/registry.ts` right after `volcengineAst2` and before `openai`.

The folder follows OpenAI Live and OpenAI Translate:

| File | Holds |
|---|---|
| `provider.ts` | the definition |
| `settings.ts` | `QwenSettings`, `QWEN_DEFAULTS`, the language table, the voice table, `qwenCredentials` |
| `endpoints.ts` | the two storefronts (socket URL, token URL) and `detectEndpoint` |
| `check.ts` | `checkQwen` over `detectEndpoint` |
| `config.ts` | `QwenConfig`, `buildQwen` |
| `wire.ts` | pure: the upgrade headers, `sessionUpdate(config)`, `appendFrame`, `COMMIT`, `CLEAR`, `FINISH`, the server-event decoder and error words |
| `segments.ts` | `QwenSegments`: deltas into whole snapshots, linking a source to its translation |
| `adapter.ts` | `createQwenAdapter`, one session per leg |
| `QwenSettings.tsx` | the voice field and `QwenVoiceSummary` |
| `testing.ts` | fixtures (`KEY`, `SERVER.*` frames, `startQwen`) |
| `recordings/*.json` | the probe's two-speaker timeline, scrubbed, for a replay test |
| tests | one per module |

## 2. Credentials, storefront detection, check

**Credentials.**
- `credentials.keys = ['apiKey']`.
- One secret field, reusing `setup.credentials.apiKey` and `simpleSettings.apiKeyPlaceholder`.
- `read` returns `{ apiKey }` trimmed, or `{ missing: 'apiKey' }`.

**Storefronts** (`endpoints.ts`):

```ts
export const ENDPOINTS = {
  intl: { socket: 'wss://maas.qwencloudapi.com/api-ws/v1/realtime', tokens: 'https://maas.qwencloudapi.com/api/v1/tokens' },
  cn:   { socket: 'wss://maas.qianwenaiapi.com/api-ws/v1/realtime', tokens: 'https://maas.qianwenaiapi.com/api/v1/tokens' },
} as const;
export type EndpointId = keyof typeof ENDPOINTS;
```

**Detection** (`detectEndpoint(apiKey, {fetch, signal, clock})`):
- POST each `tokens` URL in the order `intl`, `cn`, with `?expire_in_seconds=60` and the Bearer key, through `boundedFetch` (15 s).
- **200** answers with that endpoint. The token is discarded: it expires on its own, creates no session and costs nothing.
- **401 or 403** moves on to the next endpoint: either means "not this key here". Refused by both is a refusal, code `auth`.
- **429** is a refusal, code `rate_limit`.
- Anything else, or a network failure or timeout, **throws**: unknown, by the check contract.
- Browser WebSocket upgrades hide the HTTP status, which is why detection does not use the socket.

**Check** (`checkQwen`):
- Runs `detectEndpoint`. Success is `{ ok: true, models: [{ id: endpointId }] }`, so the one model entry names the storefront.
- A refusal is `{ ok: false, reason, code }`.

**Into the session.** `buildQwen` reads `shared.models[0]?.id` when it is `intl` or `cn` and puts it in `QwenConfig.endpoint`; otherwise `endpoint` is `null`.

**Fallback.** An adapter given `endpoint: null` calls `detectEndpoint` before it opens the socket, so a session started offline-then-online, or before any check succeeded, still finds its storefront. A refusal there rejects `start` with `AdapterStartError(…, 'auth' | 'rate_limit')`; a throw rejects it as `network`.

## 3. Languages

App codes are Qwen's own codes. Each is a canonical BCP-47 tag (`zh`, `yue`, `nb`, `fil`, `ast`, `ceb`, …), so the wire is `identityWire()`. A test asserts `canonicalTag(code) === code` for every entry.

| Group | Codes |
|---|---|
| Spoken (29) | zh, en, ar, de, fr, es, pt, id, it, ko, ru, th, vi, ja, tr, hi, ms, nl, ur, nb, sv, da, he, fi, pl, is, cs, fil, fa |
| Text-only (31) | yue, el, af, ast, be, bg, bn, bs, ca, ceb, et, gl, gu, hr, hu, jv, kk, kn, ky, lv, mk, ml, mr, pa, ro, sk, sl, sw, tg, az, uk |

- `sources(s)`: `AUTO` plus all 60.
  - The model always detects the source itself. A concrete source exists so the participant leg can reverse the pair, since the gate refuses `AUTO` there.
  - Sources and targets are the same 60, so every pair reverses.
- `targets(source, s, ctx)`: the 29 spoken targets when `ctx?.speech` is true, otherwise all 60, as AST2 does. The speech offer is a subset of the text offer, which the registry invariant requires.
- `initial`: absent. The global pair is normalised by the store as for every provider.
- `buildQwen` still refuses a text-only target on a leg that speaks (`build` returns a `ProviderRefusal`), so a stale pair can never reach the update that the server would reject.

## 4. Voices

`settings.ts`:

```ts
export const SPEAKER_CLONE = 'clone';                // the speaker's own voice, cloned in real time
export interface QwenVoice { value: string; name: string; gender?: 'female' | 'male'; description: string }
export const QWEN_VOICES: readonly QwenVoice[];      // the 47 presets, value = the vendor name verbatim
export interface QwenSettings { voice: string; participantVoice: string }
export const QWEN_DEFAULTS: QwenSettings = { voice: 'Tina', participantVoice: 'Ethan' };
```

**The list.** The 47 presets are, in the vendor's order: Tina, Cindy, Liora Mira, Sunnybobi, Raymond, Ethan, Theo Calm, Serena, Harvey, Maia, Evan, Qiao, Momo, Wil, Angel, Li Cassian, Mia, Joyner, Gold, Katerina, Ryan, Jennifer, Aiden, Mione, Sohee, Lenn, Ono Anna, Sonrisa, Bodega, Emilien, Andre, Radio Gol, Alek, Rizky, Roya, Arda, Hana, Dolce, Jakub, Griet, Eliška, Marina, Siiri, Ingrid, Sigga, Bea, Chloe.
- Names, genders and one-line descriptions come from the official omni voice list.
- Names with spaces or diacritics are sent verbatim.
- Every preset speaks every spoken target, so the list does not depend on the target.

**Picking.**
- The field is `PresetVoiceField` with one extra row at the top, "The speaker's own voice", value `SPEAKER_CLONE`. Its participant row ("Voice I hear") appears when `participantSpeaks`.
- `distinctVoice` (`src/lib/provider/voices.ts`) keeps the participant's voice off mine for presets. `SPEAKER_CLONE` is exempt, because each leg clones its own speaker, so both legs may choose it.
- A stored value that is neither a preset nor `SPEAKER_CLONE` falls back to the default. The list is the only validation, since the server only refuses an unknown voice at the first speech.

**Preview.** If the official voice list provides sample audio URLs, the field previews them through the existing preview port and CSP gains that CDN origin. If it does not, there is no preview in this version. The implementation plan settles which, first.

**`QwenVoiceSummary`.** `presetVoiceSummary(…)` names each spoken leg's voice (or "The speaker's own voice") under its Speech row, linking to `#voice-settings-section`.

## 5. Session config — `config.ts`

```ts
export interface QwenConfig {
  model: 'qwen3.8-livetranslate-flash-realtime';
  endpoint: EndpointId | null;
  target: string;                 // Qwen code
  speech: boolean;                // context.speech
  voice: { kind: 'preset'; name: string } | { kind: 'clone' };
  manual: boolean;                // context.turns === 'manual'
  person: boolean;                // shared.reversed(direction): the participant leg labels people
  transport: 'websocket';
}
```

`buildQwen(context, s, shared)`:
1. It refuses an `AUTO` target, a target outside the 60, and a text-only target when `context.speech` is true.
2. It picks `s.participantVoice` when `shared.reversed(context.direction)` and `s.voice` otherwise. It resolves `SPEAKER_CLONE` to `{kind: 'clone'}` and a preset to `{kind: 'preset', name}`.

## 6. Adapter — `adapter.ts`

`createQwenAdapter({ openHeaderSocket, detect })` returns `{ start }`, one `QwenLeg` per call.

**Opening.**
1. `endpoint ??= await detect(...)` (§2).
2. `openHeaderSocket(\`${ENDPOINTS[endpoint].socket}?model=${model}\`, { set: { Authorization: \`Bearer ${apiKey}\` } }, { signal, clock })`.
   - The rule is keyed per host and path, so two legs upgrade one after the other.
   - `HeaderSocketError('unsupported')` rejects with `AdapterStartError(…, 'client')`.
   - A socket that never opens rejects as `network`.
   - The seam's 15 s bound is reused.
3. Wait for `session.created`, then send the one `session.update`, then resolve on `session.updated`.
   - An `error` before that rejects `start` with `AdapterStartError(errorWords, errorCode)`.
   - The handshake as a whole is bounded at 15 s on the request's clock.

**The update** (`wire.sessionUpdate(config)`):

```json
{ "type": "session.update", "session": {
  "output_modalities": ["text", "audio"],                 // ["text"] when !speech
  "translation": { "language": "<target>" },
  "audio": {
    "input":  { "format": { "type": "pcm", "sample_rate": 24000 }, "turn_detection": null },   // turn_detection omitted unless manual
    "output": { "voice": "<preset name>" }               // "default" when clone; output omitted when !speech
  },
  "enable_voice_clone": true, "voice_clone_options": { "frequency": "always" }               // only when clone and speech
} }
```

**Audio in.** `appendAudio(pcm)` sends `input_audio_buffer.append` with `pcmToBase64(pcm)`; the 24 kHz audio goes unresampled. Audio before `session.updated` is dropped, matching the contract's opening rules.

**Segments** (`QwenSegments`, pure):
- **Source.** A heard item opens a source ref. Its id comes from `speech_started.item_id`, or from the first `conversation.item.created` in manual mode.
  - `input_audio_transcription.delta` appends, and each append emits the whole snapshot.
  - `.completed` replaces the text with `transcript` (trimmed) and closes the ref.
- **Translation.** A translation item (from `response.output_item.added`) opens a translation ref.
  - `origin` is shared with the source named by its `previous_item_id`.
  - `response.audio_transcript.delta` or `response.text.delta` appends; `.done` replaces and closes.
- **Person.** When `config.person` is true, the item's `speaker_id` from `speech_started` is emitted as `person` (as a string) on both refs. Otherwise no person is emitted.
- **Empty turns.** A source that completes empty, with a translation that completes empty, closes both refs without text.

**Audio out.** `response.audio.delta` → `audio({ pcm: base64ToPcm(delta), ref: <translation ref> })` at 24 kHz.
- Nothing is emitted when `!context.speech`; the update asked for none anyway.
- **Karaoke, by phrase (owner's choice A, 2026-10-14).** A translation arrives as phrases: its words, then their speech. In 12 recorded turns, each phrase's share of the text matched its share of the audio within 5%. So a translation delta arriving after audio begins the next phrase, unless it adds no visible character (a recorded turn had `" "` between two words). The phrase before is whole: its text (as last sent) is tiled over the audio that followed it, by sample count (`tileSpan`), and stated with `speechRanges`, as Palabra's fill-in. The last phrase is filled once both the final text and `response.audio.done` have come, in either order. Audio after that plays unranged. A final text shorter than its deltas restates the ranges past its end within it. Nothing is lit before its phrase is whole, so in a long turn whose speech streams in real time the first phrase may play unlit. The attribution is by order, measured and not stated by the server.

**Turns.** Manual mode on 3.8 is undocumented: the docs scope `turn_detection: null` to qwen3.5. The rules below come from the probes of 2026-10-14 (evidence table, "Turns, manual").
- `beginTurn()` does nothing.
- `endTurn()` sends `input_audio_buffer.commit` in manual mode and does nothing in auto. A commit is never sent when nothing was appended since the last one: the server answers "no active inference" and then refuses every later append.
- A committed turn is busy until its `response.done`; the server refuses audio meanwhile. Audio appended while busy is held and sent when the turn is done, followed by its release's commit if the press has already ended. If `response.done` does not come within `TURN_DONE_MS` (10 s), the held audio goes up anyway.
- `cancelTurn()` is a release (owner, 2026-10-14). The runner's voice gate calls a press with under 500 ms of voice a cancel, and in the live test that dropped short words such as 对不对. An empty press comes back with empty texts and shows nothing (probed: a 0.3 s tap, 0.4 s of silence). It never sends `input_audio_buffer.clear`.
- Turns are serialised on `response.done`, so a turn's late items can never be taken for the next one's.

**Stop.** Send `session.finish`, close the socket at once (the contract requires the close before the first await), and resolve. Anything still in flight is dropped, as `stop-silence` requires.

**Errors.**
- A mid-session `error` event, or a close with a reason, fails the leg: `failed({message: errorWords, code})`.
- Codes map from the message:

| Message | Code |
|---|---|
| `InvalidApiKey`, `InvalidApiToken` | `auth` |
| `rate limit`, `quota exceeded`, `Allocated quota` | `rate_limit` |
| `not supported` | `client` |
| `invalid_value` | `client` |
| other | `server` |

- An unexpected close with no reason fails with `connection_lost`.
- There is no reconnect (D8).
- A frame that will not parse is `degraded('parse_error')` once per window, the existing rule.

**Frames.**
- Each sent and received event type is framed for the Logs panel through `framePayload`.
- Audio payloads are replaced by sample counts.
- No URL and no key appear, which the conformance `frame-url` and `frame-secret` rules check.

**Info.** `info.transport = 'websocket'`.

## 7. Settings view — `QwenSettings.tsx`

- The voice field described in §4 is the only control. It carries `#voice-settings-section`.
- There is no instructions field, model picker or region picker.
- When the provider's readiness is ready, the storefront the check found is shown as a muted line under the key: "QwenCloud (international)" or "千问云 (mainland China)". It reads from `models`.

## 8. Registry and the tests that pin it

- **Registry.** Add the line in `src/providers/registry.ts` after `volcengineAst2`.
- **Pins that change:**
  - `registry.test.ts`: the full order list.
  - The neighbour pins in `volcengine_ast2/provider.test.ts` and `openai/provider.test.ts`.
  - The `checkReads` map, which gets `qwen_livetranslate: []`.
- **The legacy-slice test** (`registry.test.ts:154-160`) narrows to an explicit list of the nine ported ids. A new provider has no legacy slice, and no row is invented in `LEGACY_SLICE_KEYS`.
- **`sessionSide.consistency.test.ts`.** Pin the new folder's session side (`adapter.ts`, `wire.ts`, `segments.ts`, `endpoints.ts`, `config.ts`).
- **No change needed:** `oldPath` and `consoleLedger`. The new code imports nothing from the old path, and uses no `console.error`/`console.warn`.
- **Setup wizard.** `providerPaths.test.ts` needs nothing, because the provider is not on web.

## 9. Locales

**New keys in all 30 catalogs:**
- `providers.qwen_livetranslate.name`: "Qwen LiveTranslate".
- `providers.qwen_livetranslate.description`: one sentence on simultaneous interpretation in 60 languages, 29 with voice, using your own QwenCloud or 千问云 key.
- `providers.qwen_livetranslate.speakerVoice`: "The speaker's own voice".
- `providers.qwen_livetranslate.storefrontIntl` and `.storefrontCn` for §7.

**Notice codes.** The provider reuses existing notice codes: `auth`, `rate_limit`, `connection_lost`, `network`, `client`, `server`. A code without words today gets a `NOTICE_ALIASES` row (`src/lib/view/noticeText.ts`) pointing at existing words, rather than new strings.

## 10. Extension manifest

- `host_permissions`: add `wss://maas.qwencloudapi.com/*` and `wss://maas.qianwenaiapi.com/*`. The DNR header rule only applies to declared wss hosts.
- CSP `connect-src`: add those two `wss://` origins and `https://maas.qwencloudapi.com https://maas.qianwenaiapi.com` for the token endpoint. Add the voice-preview CDN only if §4 finds one.
- `extension/manifest.consistency.test.ts`: one `it` pinning the four origins and the two host permissions.

## 11. Documentation

- CLAUDE.md's Project Overview lists Qwen LiveTranslate among the providers.
- `CONTEXT.md:7` changes "nine" to "ten".
- Site docs (sokuji-backend) follow the release, not this change.

## 12. Testing

- **`wire.test.ts`**:
  - `sessionUpdate` for each combination: auto/manual × speech/text × preset/clone. Cases include the clone fields only with speech, `output` absent without speech, and `turn_detection: null` only in manual.
  - The decoder over every server event in the evidence table.
  - Error words and codes.
- **`segments.test.ts`**:
  - Deltas become snapshots; `.completed`/`.done` replace and close.
  - `previous_item_id` links the origin.
  - `person` appears only when asked.
  - Cancel closes the open refs and drops later deltas.
  - Empty turns.
- **`segments.replay.test.ts`**: the probe's two-speaker timeline (`recordings/two-speakers.json`) gives the four source/translation pairs with persons 1, 2, 3, 4. The A–B–A–B recording gives 1, 2, 1, 2.
- **`adapter.test.ts`**:
  - `FakeSocket` + `fakeHeaderSockets()` and `runScenario` over `open-stop`, `speech-off`, `abort-while-opening`, `refused-while-opening`, `manual-end` (sends `commit`), `manual-cancel` (sends `commit`), and `server-close`. There is no `text` and no `reconnect`.
  - `checkConformance` on every log.
  - Endpoint fallback: `endpoint: null` calls `detect` first.
  - The handshake bound, and an `error` before `session.updated`.
- **`check.test.ts`**:
  - Intl 200.
  - Intl 401 then cn 200.
  - Both 401 → `auth`.
  - 429 → `rate_limit`.
  - Network failure or timeout throws.
  - The URL, method and header are exact.
- **`config.test.ts`**:
  - The endpoint comes from `models`.
  - Leg voices and `distinctVoice`, with the clone exemption.
  - Refusals: AUTO, unknown, text-only with speech.
  - `person` only on the reversed leg.
  - `manual` follows `context.turns`.
- **`settings.test.ts`**:
  - The 60 codes are canonical and unique.
  - Spoken ⊂ all.
  - 47 unique voices plus the clone value.
  - Defaults are distinct presets.
- **`provider.test.ts`**:
  - Present on electron and extension, absent on web.
  - Present in a release build with no switch and no listing, since it was unflagged (D9).
  - Its place in the order.
- **`QwenSettings.test.tsx`**:
  - The clone row first.
  - The participant row only when `participantSpeaks`.
  - The summary names both legs.
  - The storefront line.
- **Registry, sessionSide, manifest and locales consistency tests** as in §8–§10.

**Owner's live test.** Run it once (on a dev build while it was flagged):
1. With the international key and then the mainland key, the check shows the right storefront.
2. Each language direction works: mine to another, and the other party's back.
3. Both legs speak, in distinct preset voices.
4. "The speaker's own voice" follows each speaker.
5. Push-to-talk: release translates; cancel drops.
6. A text-only target with speech off shows text.
7. A bad key shows the key notice.
8. Run all of it on both the desktop app and the extension.

## Known limitations and follow-ups

- **Uplink backlog.** On a network whose IPv6 route to the mainland is slow, a mainland key's stream falls behind. A follow-up can watch `WebSocket.bufferedAmount` and raise a degraded notice, or send a lower rate.
- **Managed Qwen.** It needs Alibaba to provide per-session usage attribution (a ticket is open with QwenCloud support). It is not designed here.
- **Later, and small:** pre-created cloned voices, face-to-face (Qwen's diarization would serve it), and reconnect.
