# Current state: from microphone to conversation rows

Written 2026-09-22, before any design work on the client-contract refactor. Its
only job is to state what the code does today, so the design that follows argues
against facts rather than against memory.

**Method.** Seven parallel surveys, each answering the same fifteen-question
form: the twelve `IClient` implementations in five groups, the MainPanel
consumer side, and everything downstream of MainPanel's item state. Every claim
below carries a `file:line`. Where a survey and this note disagree, the code
wins — re-check the line.

**Scope.** Facts only. No proposals. Where a fact obviously suggests a fix, the
fix is *not* written down here.

---

## 1. Scale

| | lines |
|---|---|
| 12 `IClient` implementations | **15,113** |
| `MainPanel.tsx` | 4,940 (of which `connectConversation` alone is 1,181) |
| `src/services/providers/` | 10,763 |

Six of the twelve clients are OpenAI:

| client | lines |
|---|---|
| `GeminiClient` | 1,749 |
| `SonioxClient` | 1,689 |
| `OpenAILiveClient` | 1,570 |
| `LocalInferenceClient` | 1,437 |
| `PalabraAIClient` | 1,367 |
| `VolcengineAST2Client` | 1,317 |
| `LocalNativeClient` | 1,132 |
| `OpenAIClient` | 1,044 |
| `OpenAITranslateWebRTCClient` | 1,022 |
| `OpenAIGAClient` | 973 |
| `OpenAITranslateGAClient` | 954 |
| `OpenAIWebRTCClient` | 859 |

There are no Kizuna "twin" client classes: `KizunaAISonioxProviderConfig`,
`KizunaAIVolcengineAST2ProviderConfig` and `KizunaAIOpenAITranslateProviderConfig`
are descriptor subclasses that construct the same three clients.

---

## 2. The pipeline and its seams

```
mic / system audio
   │  ModernAudioRecorder, 24 kHz mono Int16                     [uniform]
   ▼
MainPanel recorder callback ─────────────────────────── seam 1 (input)
   │  client.appendInputAudio(data.mono)
   ▼
IClient implementation (×12)
   │  transport ── item lifecycle ── display bookkeeping
   ▼
eventHandlers.onConversationUpdated({item, delta?}) ──── seam 2 (output)
   │            └─ delta.audio ──► audioService.addAudioData(...) ──► player
   ▼
MainPanel: setItems(client.getConversationItems())
   │
   ├─ combinedItems  (mergeConversationItems, sort by createdAt)
   ├─ filteredItems  (uiMode gate + shouldShowItem)
   ▼
ConversationRow  ·  SubtitleStream  ·  ExportButton  ·  autoSave
                     │
                     └─ extension port ──► overlay iframe   seam 3 (wire)
```

Three seams. Seam 1 is uniform. Seam 2 is where everything diverges. Seam 3
re-derives a large part of what seam 2 already computed.

---

## 3. The contract

### 3.1 Input surface — genuinely uniform

`appendInputAudio(audioData: Int16Array)` — 24 kHz mono PCM16 from the shared
`ModernAudioRecorder` (`ModernAudioRecorder.ts:95`), fed at
`MainPanel.tsx:2577 / 2591 / 2768 / 3342`.

Five deviations, all of them about *transport*, none about content:

| client | deviation |
|---|---|
| `OpenAIWebRTCClient`, `OpenAITranslateWebRTCClient` | `appendInputAudio` is a **no-op**; mic is captured natively as a `MediaStreamTrack` |
| `PalabraAIClient` | converts each chunk to an `AudioBuffer`, schedules it into a `MediaStreamAudioDestinationNode`, publishes over LiveKit |
| `VolcengineAST2Client` | **the only client that resamples** — 24 kHz → 16 kHz, `:1092` |
| `LocalNativeClient` | sends the same PCM to **two** places: the sidecar socket and the VAD worker |
| `SonioxClient` | additionally accepts `appendParticipantAudio` for the Both-mode `PcmMixer` |

### 3.2 Output surface — one channel, untyped

Nine callbacks, all optional (`IClient.ts:398-418`). Exactly one carries content:

```ts
onConversationUpdated?: (data: { item: ConversationItem; delta?: any }) => void;
```

**What MainPanel actually reads from `delta`:** `delta.audio`,
`delta.sequenceNumber`, `delta.timestamp`. Three fields, five call sites
(`MainPanel.tsx:1045, 1678, 1686, 1688, 1689`). Nothing else.

Every text delta — `{delta:{transcript}}`, `{delta:{text}}` — and every extra
field (`AST2`'s `definite`/`language`/`startTime`/`endTime`, `:779-785`) has
**no consumer anywhere**. For text, MainPanel discards the delta and re-reads
`client.getConversationItems()` wholesale, throttled to 20 Hz
(`UPDATE_THROTTLE_MS = 50`, `MainPanel.tsx:1506, 1699-1710`).

So one callback carries three unrelated mechanisms:

| content | mechanism | consequence |
|---|---|---|
| text | **pull** — MainPanel re-reads the whole array | the delta is ceremony; twelve clients maintain it |
| audio | **push** — PCM rides a `delta` on the same callback | a client with no matching item must fabricate one |
| errors | **push** — `{item}` where the item is **not** in the client's array | MainPanel must append it separately (`:1672-1675`) |

Two clients fabricate a `ConversationItem` that never enters their own list,
purely to get PCM through this channel:
`OpenAIWebRTCClient:120-138` (`webrtc_audio_<ts>`) and `PalabraAIClient:1327-1336`
(`item.id = this.instanceId`, one synthetic envelope reused for the whole session).

Three clients emit a **second, delta-less** `onConversationUpdated` on the same
item purely to force a React re-render:
`VolcengineAST2Client:952-954` ("Emit again without delta to trigger UI update
(WAV creation + play button)"), `LocalInferenceClient:1293-1295` and
`LocalNativeClient:1013-1015` (both to publish karaoke metadata after the audio
has already gone out).

### 3.3 Dead weight in the contract

| member | required? | live call sites outside `services/clients/` |
|---|---|---|
| `updateSession` | yes | **0** |
| `isConnected` | yes | **0** |
| `getProvider` | yes | **0** |
| `cancelResponse` | yes | **1, and the line is commented out** (`MainPanel.tsx:1667`) |
| `setOutputVolume` | optional | 0 |
| `appendParticipantAudio` | optional | 0 (only `SonioxClient:1655`, its own secondary-port shim) |

`onOpen` is declared and emitted by most clients; **MainPanel wires it nowhere**.

---

## 4. Data: who writes each field, who reads it

`ConversationItem` — `IClient.ts:10-56`.

| field | written by | read by | note |
|---|---|---|---|
| `id` | clients; MainPanel for 6 synthetic rows | map keys, React keys, playback key, language snapshot | see §7 B |
| `role` | clients / MainPanel | filter, row, subtitle, export, analytics | |
| `type` | clients / MainPanel | filter, row, idle state, export | `function_call*` has no positive reader |
| `severity` | `MainPanel.tsx:3110,3132`; `LocalNativeClient:494` | **`subtitleIdleState.ts:69` only** | exists solely to stop one consumer misreading a degraded session as a failed start |
| `status` | clients | export, `canPlay`, end-debounce, analytics | `in_progress`/`cancelled` have no positive reader |
| `source` | clients (Soniox only) / defaulted | 11 places | defaulted to `'speaker'` **independently in at least 6 files** |
| `createdAt` | clients (not Palabra); MainPanel | merge sort, row timestamp, idle state, export, latency analytics | optional in the type; see §7 C |
| `detectedLanguage` | **`SonioxClient:784,1206` only** | **`ConversationRow.tsx:83-86` only** | one writer, one reader |
| `formatted.text` | all | 8 readers | |
| `formatted.transcript` | all | 8 readers | always preferred over `.text` (`a \|\| b`) in 6 hard-coded places |
| `formatted.audio` | 10 clients, gated by `keepReplayAudio` | `handlePlayAudio`, `canPlay`, uiMode filter | stripped before the extension wire |
| `formatted.audioSegments` | **4 clients** | `playbackStore.ts:191-205` → `highlight.ts` | the only karaoke input actually read |
| `formatted.audioTextEnd` | 4 clients, 8 write sites | **NO RUNTIME READER** | dead |
| `formatted.file` | `OpenAIClient.ts:535` only | **NO RUNTIME READER** | dead; its own comment says "no longer generated anywhere" |
| `content[]` | 3 clients | **NO RENDERING READER** — only walked to delete `content[].audio` before the wire | dead |
| `formatted.tool` / `.output` | clients | MainPanel advanced mode only | |

### 4.1 `audioSegments` has two different semantics

| producer | `textEnd` means | `audioEnd` means |
|---|---|---|
| `OpenAITranslateGAClient:600-613`, `OpenAILiveClient:903-915` | the transcript's length **at the moment an audio frame arrived** — a lagging correlation between two independent streams | cumulative seconds for that item |
| `LocalInferenceClient:1288-1333`, `LocalNativeClient:1012-1025` | the character offset of the **end of the sentence this audio speaks**, located by `displayText.indexOf(sentence, searchFrom)` | cumulative seconds at 24 kHz |

One is per audio frame, the other per TTS sentence. Both are consumed by the
same `getHighlightedChars` with no way to tell them apart.

### 4.2 Who actually runs TTS

**Three clients synthesize speech themselves:** `SonioxClient` (its own second
WebSocket, `SonioxTtsStream`), `LocalInferenceClient` (`TtsEngine` / edge-tts),
`LocalNativeClient` (sidecar `NativeTtsClient`).

Everyone else receives audio from the provider. In particular
**`VolcengineAST2Client` does not run TTS** — Volcengine synthesizes server-side
under `mode:'s2s'` and sends Ogg Opus, bracketed by `TTSSentenceStart` /
`TTSSentenceEnd` (`:489, :641, :646-656`); the client only decodes it
(`decodeAudioData`, `:891-918`) — the only client in the repo that holds an
`AudioContext` for decoding.

This matters for how much of a text↔audio correspondence each one *could*
record:

| client | has cumulative text offset? | has cumulative audio offset? | pairs them? |
|---|---|---|---|
| `LocalInference` / `LocalNative` | yes | yes | **yes** |
| `OpenAITranslateGA` / `OpenAILive` | yes (transcript length) | yes (`audioCumSamples`) | **yes** |
| `OpenAIGAClient` | yes — `handleAudioDelta` already holds the item, and `handleTranscriptDelta` accumulates on the same `item_id` (`:545-600`) | not tracked | **no** |
| `SonioxClient` | yes — `ttsSpokenText` accumulates every chunk fed to TTS (`:1117`) | yes — each returned chunk's `audio.length` (`:1261`) | **no** |
| `VolcengineAST2Client` | **no** — TTS sentence boundaries are the server's and need not align with subtitle phases | yes — `audioBuffer.duration` computed and discarded (`:910-911`) | **no** |
| `GeminiClient`, `PalabraAIClient`, `OpenAIWebRTC*` | — | — | **no** |

`SonioxSttStream` additionally carries per-token `start_ms` / `end_ms`
(`:31-32`), used only for energy-based side attribution and never recorded on an
item.

---

## 5. Feature matrix: where each cross-cutting feature lives today

| feature | implemented in | uniformity |
|---|---|---|
| per-item replay audio | **10 of 12 clients** read `keepReplayAudio`; `OpenAIWebRTCClient` and `PalabraAIClient` never do | `OpenAIClient` **strips** rather than accumulates (the vendor SDK accumulates, `:494-506, 526-535`); `VolcengineAST2Client` **mutates** `formatted.audio` in place (`:933-942`) while `SonioxClient` never mutates (`:1174-1194`) |
| karaoke timing | **4 of 12 clients**, two semantics (§4.1) | `OpenAITranslateWebRTCClient` has none, so the same provider loses precise karaoke by changing transport |
| sentence segmentation | **11 of 12 clients** take `segmentation` + `sentencesPerChunk` | `OpenAIWebRTCClient`'s options type has neither field (`:37-46`) |
| bubble splitting (1-5) | 3 clients (`Soniox`, `AST2`, `Palabra`) via `punctuateAndSplitDefinite` | the helper is shared; the plumbing around it is not (§6.1) |
| audio hand-off across a text close | **`OpenAILiveClient` only** (`pendingAudioItems`, `assistantTextEndMs`, `audioHandoffTimer`, `audioTargetItemId`, `scheduleAudioHandoff`, `:63, 171-174, 1339-1377`) | `OpenAITranslateGAClient:145-156` and `OpenAITranslateWebRTCClient:148-161` carry **prose comments explaining why they cannot do it** |
| error / notice bubbles | **13 sites across 11 clients**, plus 6 more in MainPanel | `GeminiClient` mints none at all; two clients (`Soniox:1386`, `LocalNative:489`) push theirs into the array so teardown doesn't wipe them, the rest emit a row that is not in the array |
| item ordering (`createdAt`) | 11 clients set it | `PalabraAIClient` sets it **nowhere** and relies on array position, which is why its split pieces `splice(++at, 0, extra)` instead of pushing (`:1124`); `AST2`'s error item is the one row missing it (`:568-575`); `OpenAIGAClient` and `OpenAIWebRTCClient` maintain an `itemCreatedAtMap` they **write but never read** |
| language badge input | `detectedLanguage` — **`SonioxClient` only** | everyone else falls back to the configured pair |
| diagnostics | `onDiagnostic` used by 8 clients | `GeminiClient` and `OpenAIGAClient` **never** call it; `onError` payload is `{code,message}` for Soniox but a bare `Error` for AST2 and a raw **string** for `LocalNativeClient` |
| Logs-panel event stream | all 12, with 15-18 bespoke event types each | |

### 5.1 The same duplication exists downstream

Moving work out of the clients would not, by itself, remove the duplication on
the display side:

- `SubtitleApp.tsx:183-201` re-implements `mergeConversationItems` rather than
  importing it — with different tagging fallbacks and no language snapshotting.
- `ConversationRow.tsx:94-108` and `SubtitleStream.tsx:255-274` are two separate
  karaoke span renderers with identical three-case logic.
- `role → source/translation` is derived three times:
  `conversationFilter.ts:25-26`, `SubtitleStream.tsx:105-106`,
  `conversationExport.ts:163-164`.
- MainPanel's uiMode filter (`:1403-1416`) has no counterpart in `SubtitleStream`,
  so the overlay shows rows MainPanel hides in basic mode.

---

## 6. Compromises: code inside clients that serves display, not the server

Each survey was asked to list every field, timer, map, pointer or code path
that exists **only** to serve a cross-cutting display/UX feature. The totals,
counted as named entries (not lines):

| client | compromise entries |
|---|---|
| `LocalInferenceClient` | ~28 |
| `LocalNativeClient` | ~24 |
| `SonioxClient` | ~22 |
| `GeminiClient` | ~20 |
| `VolcengineAST2Client` | ~18 |
| `OpenAIClient` / `OpenAIGAClient` / `OpenAIWebRTCClient` | ~13 each |
| `OpenAITranslateGAClient` / `OpenAILiveClient` | ~13 each |
| `OpenAITranslateWebRTCClient` | ~11 |
| `PalabraAIClient` | ~11 |

Roughly **200 named entries across twelve clients**, averaging ~16 each.

### 6.1 The five recurring shapes

**(a) An `instanceId` prefix, so ids don't collide across legs.**
`VolcengineAST2Client:119-124` states the reason outright: without it, the two
Both-mode clients mint identical ids, and **the karaoke highlight, which keys on
`item.id` alone, lights two bubbles at once.** `LocalInferenceClient:84-91`
carries the same comment. A display-layer matching rule dictating a client's
identity scheme.

**(b) Replay-audio accumulation.** `audioChunks` maps, `appendItemAudio`,
`concatAudio`, merge-at-completion, and the `keepReplayAudio` flag itself —
present in ten clients, in four mutually incompatible disciplines (accumulate
per delta / accumulate then merge once / mutate in place / strip what the SDK
already accumulated).

**(c) Bubble splitting.** Per client: a `SentenceStream` (one or two of them),
one or two `SilenceDeferral`s, one or two idle timers with clamped pause values,
`sealingUser`/`sealingAssistant` re-entrancy latches, `sessionSegmentation`,
`sentencesPerChunk`, a `punctuationLane`, and a `flush()` at the top of
`disconnect()`. `OpenAILiveClient` adds four span caps and a timeline pause rule
on top; `LocalInference`/`LocalNative` add a seal cursor
(`sealedSkeleton`, `sealedSkeletonBase`, `lastPassedToStream`,
`lastRawPartialText`) and `isTruncationOfSameUtterance()`.

**(d) Ordering.** `createdAt: Date.now()` on every item literal (7 sites in
`LocalInferenceClient`, 8 in `GeminiClient`), plus the **shared-stamp
convention**: `Soniox:706`, `AST2:746,822`, `LocalInference:1052-1059`,
`LocalNative:828-835` all capture one `Date.now()` *before* the punctuation
model call and give it to every piece — because a per-piece `+i` would collide
with the other side's pieces, which complete in the same millisecond.

**(e) Logs-panel plumbing.** `emitEvent` / `emitRealtime` and 15-18 bespoke
event types per client, silent-frame suppression so the log stays readable,
`parseFailed` latches so a garbage-emitting server reports once, `rtf`
derivations, hardware probes.

### 6.2 Single-purpose oddities worth naming

- `OpenAIGAClient:681-704` **defers `status='completed'` behind the punctuation
  model call**, and its own comment records that this inflates
  `translation_completed.latency_ms` / `latency_measurement` by up to
  `FILL_IN_BUDGET_MS` (1 s). A display feature corrupting a business metric.
- `PalabraAIClient:1064-1073` **mutates an existing item's `id`** to promote a
  partial transcription into a validated one — the only client that does.
- `PalabraAIClient:374` and `GeminiClient:1428-1435`: Palabra empties
  `conversationItems` in `disconnect()`; Gemini's comment explicitly names that
  as a contract violation. MainPanel compensates with
  `keepRowsDroppedOnDisconnect` (`conversationMerge.ts:56-69`).
- `VolcengineAST2Client:774,851` stores **only definite items**; its live bubbles
  exist solely in the event stream. `SonioxClient:110` stores in-progress items
  too. `OpenAIClient:1028-1031` holds no array and rebuilds every item from the
  vendor SDK on every call. **Three different meanings for
  `getConversationItems()`.**
- `LocalInferenceClient`'s `PipelineJob.asrTiming` is written three times
  (`:847, 1022, 1121`) and **never read** outside its tests.
- On the participant leg MainPanel discards every audio delta
  (`MainPanel.tsx:1045-1047`), yet the clients still decode base64, RMS-gate,
  push chunks under `keepReplayAudio` and compute karaoke segments for audio
  that is thrown away — nothing in the contract says "this leg has no audio".

---

## 7. What downstream assumes about how clients produce items

Forty-four assumptions in twelve groups. None is expressed in a type; none is
checked.

**A. One bubble = one audio unit, keyed by `item.id`** (4)
`playbackStore.ts:188` — `s.playingItemId !== item.id` is the *only* link
between the player and a text row. `MainPanel.tsx:3586-3587` uses `item.id` as
both track id and metadata id. `MainPanel.tsx:3126-3131` decides "real item end"
vs "chunk gap" from `endedItem?.status === 'completed'`.
`playbackStore.ts:73-86` accumulates `_cumOffset` across player-entry evictions
*within one item id*.

**B. Ids are stable and unique across both legs** (6)
`conversationMerge.ts:63-64` (a reused id silently loses a row);
`MainPanel.tsx:1381-1394` (`itemLanguagesRef` keyed by bare id across both legs);
`SubtitleStream.tsx:132` and `:155-179`; React keys at `MainPanel.tsx:4640`
fall back to array **index** when `id` is falsy; synthetic ids
`error-${Date.now()}` collide when two rows are appended in the same millisecond
(`MainPanel.tsx:3104-3136` appends two back to back).

**C. `createdAt` exists** (6)
`conversationMerge.ts:44` — a missing value sorts the row to the **front of the
entire conversation**. `SubtitleApp.tsx:200` duplicates the same sort.
`subtitleIdleState.ts:70` — a missing value suppresses the `failed` state.
`conversationExport.ts:171` silently substitutes export time.
`ConversationRow.tsx:44` renders no timestamp.
`MainPanel.tsx:1718-1719` would report a ~56-year latency from an epoch-0 value.

**D. Text is never rewritten and grows monotonically** (6)
`playbackStore.ts:207-210` — the `textOverride` offset is found by
`originalText.indexOf(textOverride)`: wrong on a repeated substring, silently
zero when the text was rewritten (punctuation restoration does exactly that).
`highlight.ts:23-33` — `audioSegments[].textEnd` are absolute offsets into the
text *as it was when written*; any insertion before a boundary desynchronises
every later segment undetectably, and text past the last `textEnd` can never be
highlighted. `SubtitleStream.tsx:100-112,249` snapshots text at pack time.

**E. `formatted.transcript` wins over `formatted.text`** (1)
Hard-coded `a || b` in six files. A client populating both differently produces
an item whose export text and karaoke base text agree only by accident.

**F. Pieces are adjacent / one row per utterance** (5)
`ConversationRow.tsx:69` groups headers on `source` equality alone — never role
or time gap. `SubtitleStream.tsx:99-113` joins bucket items with a single space
(wrong for CJK and for sub-word pieces). `conversationExport.ts:398` writes one
`.txt` line with its own timestamp per item, so a split utterance becomes N
lines.

**G. The last item is the outcome** (2)
`subtitleIdleState.ts:65` reads `items[items.length - 1]` only — any row
appended after a failure masks it. `MainPanel.tsx:3096-3136`'s
"append AFTER the overwrite" dance exists because
`setItems(client.getConversationItems())` replaces the array wholesale.

**H. `type: 'error'` is the only system row the renderer draws** (4)
`MainPanel.tsx:160-172` never checks `severity`, so warnings render as red error
bubbles by design; `conversationFilter.ts:13` shows them even on a side set to
`'none'`; `SubtitleStream.tsx:107` forces them into the **translation** bucket;
`subtitleIdleState.ts:69` is the single consumer of `severity`, existing to undo
the first two for itself.

**I. The wire carries whatever the item has** (4)
`subtitleWire.ts:39` types items as `any[]`; the overlay validates nothing.
`ExtensionContentScriptSubtitleSurface.ts:33-38` slices the last 15 **per array
independently**, so an unequal rate between legs can drop one side's older half
after the overlay re-merges. `stripHeavyItemFields` (`:66-84`) denylists
`formatted.audio` / `formatted.file` / `content[].audio` **by name** — any new
heavy field crosses and can re-trigger the 64 MiB port crash documented at
`:56-63`. The subscription's equality is array **reference identity** (`:310-312`).

**J. `source` is optional and defaults to speaker** (1)
Defaulted independently in at least six files — and
`SubtitleApp.tsx:192` defaults to `'participant'` for the participant array
while `conversationMerge.ts:33` takes the fallback as a parameter. Two
conventions for the same defaulting.

**K. `status` moves forward to `completed`** (3)
`conversationExport.ts:152` silently omits anything not `completed` from every
export and auto-save — a row left `in_progress` shows on screen but is absent
from the file. `MainPanel.tsx:4620-4622` gives `cancelled` no play button.
`MainPanel.tsx:1714` re-increments the translation counter if a completed item
is re-emitted.

**L. Duplicated logic kept in step by hand** (§5.1) (4)

---

## 8. Three structural diagnoses

**One — the contract has no vocabulary for content, only a bag of items.**
`onConversationUpdated({item, delta: any})` is the single channel. Audio without
a matching item forces a fabricated item; a wanted re-render forces a second
empty emit; text deltas are maintained by twelve clients and read by none;
error rows travel outside the array; and `getConversationItems()` means three
different things.

**Two — display requirements reach the clients as unwritten assumptions.**
Forty-four of them, in twelve groups, none typed and none checked. Writing a new
client means guessing all forty-four. `VolcengineAST2Client:119-124` is the
clearest proof: a client's id scheme exists because of how the karaoke highlight
matches rows.

**Three — every cross-cutting feature is re-implemented per client, and the
display side duplicates too.** Karaoke exists in four clients with two
semantics; replay in ten with four disciplines; error bubbles at nineteen sites;
segmentation in eleven clients with per-client plumbing. Changing transport for
the same provider changes which features the user gets: `OpenAIWebRTCClient` has
no segmentation and no replay; `OpenAITranslateWebRTCClient` has no karaoke and
refuses half the global pause pair (`:64-71`).

---

## 9. Defects found in passing

These are independent of any refactor and can be fixed on their own.

1. **`VolcengineAST2Client`'s error item has no `createdAt`** (`:568-575`; every
   other item in that client has one). `conversationMerge.ts:44`'s `|| 0` sorts
   it to the front of the entire conversation.
2. **Synthetic error ids collide.** `error-${Date.now()}` at
   `MainPanel.tsx:1618, 2197, 2921, 3208` and `voice-prep-${Date.now()}` at
   `:3122`; `:3104-3136` appends two rows back to back.
3. **Export silently drops rows.** `conversationExport.ts:152` omits every item
   whose `status !== 'completed'` — visible on screen, absent from the file and
   from the session-end auto-save.
4. **The extension overlay can lose one side's history.** The last-15 slice is
   taken per array independently (`ExtensionContentScriptSubtitleSurface.ts:33-38`)
   before the overlay re-merges by `createdAt`.
5. **Three fields have no runtime reader:** `formatted.audioTextEnd` (4 writers,
   8 write sites), `formatted.file`, `content[]`.
6. **Four required contract methods have no live consumer** (§3.3).
7. **`OpenAIGAClient` inflates its own latency metric** by up to 1 s
   (`:681-704`, documented in its own comment).
8. **`OpenAILiveClient`'s comments contradict its code** about the four span
   caps: `:805-808` says they stay, `:809-821` and the code apply them only on
   the branch where no `SentenceStream` exists (`:825, 833, 864, 871`).
9. **`LocalNativeClient` has no `disposed` flag.** A `runJob` already awaiting
   `translate()` or `tts.generate()` continues after `disconnect()` and emits
   into a torn-down session; the sockets close underneath it and the rejection
   surfaces as a generic `onError`.
10. **`LocalNativeClient` hard-codes the TTS source rate** in the streaming path:
    `resampleFloat32(pcm, 24000, 24000)` (`:1004`) ignores `NativeTtsClient`'s
    cached `sampleRate`, while the non-streaming path uses it (`:1021`).
11. **Two clients maintain an `itemCreatedAtMap` they never read**
    (`OpenAIGAClient:44,447,481`, `OpenAIWebRTCClient:89,443`).

---

## Appendix: the twelve clients at a glance

| client | own ids | holds items | `formatted.audio` | `audioSegments` | segmentation | `createdAt` | `detectedLanguage` | own TTS |
|---|---|---|---|---|---|---|---|---|
| `OpenAIClient` | error rows only | no — SDK owns | gated; **strips** otherwise | no | fill-in | yes | no | no |
| `OpenAIGAClient` | error + typed text | yes | gated, merged at `response.done` | no | fill-in | yes (map unread) | no | no |
| `OpenAIWebRTCClient` | error + synthetic | yes | **synthetic item only** | no | **none** | yes (map unread) | no | no |
| `OpenAITranslateGAClient` | yes | yes | gated | **yes** (per frame) | stream, source side | yes | no | no |
| `OpenAITranslateWebRTCClient` | yes | yes (paired) | gated | **no** | stream, source side | yes | no | no |
| `OpenAILiveClient` | yes | yes | gated + hand-off queue | **yes** (per frame) | stream, both sides + caps | yes | no | no |
| `GeminiClient` | yes | yes | gated, cumulative per turn | no | stream, both sides | yes | no | no |
| `SonioxClient` | yes | yes (incl. in-progress) | gated | no | fill-in + split | yes | **yes** | **yes** |
| `VolcengineAST2Client` | yes | **definite only** | gated, **mutated in place** | no | fill-in + split | yes (not on errors) | no | no (server s2s) |
| `PalabraAIClient` | server-derived | yes, **cleared on disconnect** | **never on an item** | no | fill-in + split | **never** | no | no |
| `LocalInferenceClient` | yes | yes | gated | **yes** (per sentence) | off / stream / fill-in | yes | no | **yes** |
| `LocalNativeClient` | yes | yes | gated | **yes** (per sentence) | off / stream / fill-in | yes | no | **yes** |
