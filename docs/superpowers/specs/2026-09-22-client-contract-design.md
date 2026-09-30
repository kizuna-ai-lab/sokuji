# Client contract — Design

The twelve `IClient` implementations carry 15,113 lines, of which roughly 200
named entries exist only to serve replay, karaoke, bubble splitting, ordering,
error bubbles or the Logs panel. Adding a provider means re-implementing all of
it. This design gives clients one job — talk to the provider and emit content —
and moves everything else into layers above them.

Current state, with evidence for every claim:
`docs/superpowers/notes/2026-09-22-client-contract-current-state-analysis.md`.

Visual companion (layers, the speech-pairing model, the matrices):
https://claude.ai/artifact/1PbYxsxRG6z4pkJ9JEPmfx

---

## Summary

- `IClient` stops producing `ConversationItem`. It emits **segments** (text
  between two provider boundaries) and **speech** (a stretch of text paired with
  the audio that speaks it).
- **L1** (one per leg) owns identity, timestamps, punctuation fill-in and the
  segment list. **L2** (session-wide) projects segments into display rows and
  groups. Interleaving the two legs happens in L2, never in L1.
- A session starts with one call carrying a small shared **context** (direction,
  whether to speak, auto or manual turns) and the provider's own configuration,
  declared next to its adapter. There is no central config union, and the
  participant leg is the same configuration with the direction reversed.
- **Every provider offers auto, push-to-talk and push-to-translate.** Adapters see
  only auto or manual and end a turn their own best way; push-to-translate is a
  routing rule.
- Audio output gets an explicit **routing table**. Volume stops being used as a
  control; the only real volume left in the system is the passthrough ratio.
- **A provider is one definition in one folder**: identity, its own settings
  component, credentials, a readiness check, two language functions, the three
  capabilities generic code reads, and the per-leg builder and adapter. Adding a
  provider edits no shared code file except the registry list.
- **A session is an object, not a function.** Each start is a run that pushes
  every resource it acquires onto a stack and unwinds it in reverse on stop,
  failure or cancel alike. The legs rise and fall together.
- `ConversationItem` is deleted.

## The measure

Every proposal is judged by one question: **does adding a new provider get
simpler?** A change that makes one feature correct while leaving the client's
workload untouched does not count.

---

## Goals

- A client's output surface carries content only: text, audio, the
  correspondence between them, lifecycle, and protocol frames.
- Identity, time, ordering, bubble cutting, error rows and log vocabulary leave
  the clients entirely.
- The text↔audio correspondence gets a first-class representation, so karaoke is
  accurate where the correspondence is real and absent where it is not.
- The source↔translation correspondence gets a representation at all. Today
  there is none; adjacency on screen is a timing coincidence.
- The display layer stops re-deriving what the layer below already computed.

## Non-goals

- Changing where sentence segmentation cuts. The rules landed in PR #553 and
  were reviewed; this design changes where they run, not what they decide.
- Designing the paired source/translation UI. This design guarantees the data
  supports it; the layout is settled later, against rendered pages.
- Touching the virtual-audio-device modules (AudioCable / BlackHole and their
  installation). Virtual speaker and virtual microphone are wired at the OS
  level and stay as they are.

---

## Decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Scope | Rewrite the `IClient` contract. Clients emit content; cross-cutting features move up. Approved at a scope of "approach C or larger". |
| D2 | Two legs | Technically identical and fully independent. One `IClient` and one L1 per leg. No merging in L1. |
| D3 | Replay | **Kept.** Every provider replays: Palabra's audio names its sentence since its WebSocket port (Stage 2 Palabra, ruling 6; this row first said "only Palabra cannot", true of its old LiveKit client). Replay does not require precision. |
| D4 | Karaoke | Drawn only where a speech entry carries a real `range`. The linear-interpolation fallback is deleted outright. **Amended by the Stage 2 Gemini/AST2 follow-up:** a range by arrival is a stated exception, not a real range — OpenAI Translate's, OpenAI Realtime's and Gemini's, each by the owner's ruling ("Risks"); on OpenAI Translate and Gemini Live Translate a range by arrival runs within one translation segment, which now closes at its source's cut: audio arriving before the next translation delta stays with the segment that closes, so a frame can carry the next sentence's first word into the previous segment — its range is by arrival, not a known correspondence (Stage 2 translation cuts, ruling 1 (v)). Doubao AST 2.0's whole-sentence range is a real one: the TTS sentence carries its translation subtitle's server times (ruling 1). |
| D5 | Audio↔text | Stored as `{ range?, pcm }` pairs on the segment. No timeline, no anchors, no quality tag — an absent `range` is the quality signal. |
| D6 | Source↔translation | A shared `origin` key. Stated by the client where the provider supplies one; inferred in L2 otherwise. **Amended by the Stage 2 translation cuts plan:** or by the adapter's own rule where it cuts both sides of a stream with no turns — OpenAI Translate and Gemini Live Translate state, for each translation, the source whose cut it closed for, as OpenAI Realtime's "newest unanswered" fallback is stated (rulings 1–3). |
| D7 | Segmentation | Cutting already-final text moves to L2. Deciding the translation-job boundary stays in the local clients — it is a pipeline decision, not a display one. |
| D8 | Logs | One generic `frame({direction, type, payload?})` replaces 15-18 bespoke event types per client. |
| D9 | Analytics | Translation latency and `translation_count` are no longer collected. |
| D10 | Audio routing | An explicit routing table replaces volume-as-control. The only genuine volume left is the passthrough ratio. |
| D11 | Migration | Rewrite, not migrate. New display layer plus one provider end to end, then one provider at a time. **Amended 2026-09-26 (owner):** the old provider code — clients, descriptors, the old settings UI and store slices — stays in the tree as the source each provider is ported from; a provider's old code is deleted once the owner has live-tested its port. |
| D12 | Branch | A long-lived branch. `main` stays releasable but is not expected to move. |
| D13 | Export | One block per group, each segment's text whole, one timestamp per group. Inferred pairings are written paired like stated ones; the JSON form keeps `pairing`. |
| D14 | Turns | Every provider offers auto, push-to-talk and push-to-translate. Adapters see only `turns: 'auto' \| 'manual'` and implement `beginTurn` / `endTurn` / `cancelTurn`; the voice gate is generic; push-to-translate is a routing rule; `pttFinalization` is deleted. |
| D15 | Turn mode storage | One global setting, not per provider. |
| D16 | Extension overlay | Gets a hold button (pointer down / up / leave / cancel) forwarded over the port; its "Press Space to speak" hint is removed, since Space belongs to the meeting page. |
| D17 | Participant leg | Nothing beyond the reversed direction and automatic turns. It is the same configuration builder called with the direction reversed; the concept of a participant configuration disappears. |
| D18 | Provider settings UI | Each provider owns its settings component, composed from shared field components. The capability flags that drive today's generic panel leave the contract. |
| D19 | Feature flags | One `VITE_ENABLED_PROVIDERS` list of provider ids replaces the per-provider `VITE_ENABLE_*` flags. The Kizuna umbrella flag stays. |
| D20 | `auto` source and the participant leg | The participant leg opens only when the reversed direction is supported. `auto` is never a target, so an `auto` source refuses the participant leg for every provider. **Amended by the Stage 2 Palabra plan:** the reversed direction is the provider's own where it states one (`languages.reverse`), else the plain swap (ruling 9; choice 3); an `auto` source still never reverses, whatever a provider's own reverse would answer ("The participant rule (D20)"). |
| D21 | A leg ends | Any leg ending ends the session. There is no one-way running state. The legs stay technically independent (D2); this is a lifecycle rule, not a data one. |
| D22 | A leg fails to start | Every requested leg must come up, or the start fails with the reason. A session never starts on a subset of the legs it was asked for. |
| D23 | Soniox shared Both | Kept, as an optional `startBoth` on the provider definition that only Soniox implements. In the 90 days to 2026-09-23, 193 of 387 managed Soniox users and 44 of 70 BYOK Soniox users ran a two-leg session (PostHog `translation_session_start.channels`; shared and split are not told apart there, and shared is the default). One shared stream halves the transcription cost. |
| D24 | Stage 1's first provider | A **fake provider** — a real registry entry, dev builds only — carries the spine first. It plays scripted L0 events with synthetic audio and injected faults, and is also the contract conformance suite every adapter passes and the demo provider for rendering work. LocalInference follows it. |
| D25 | Turns over WebRTC | OpenAI Realtime over WebRTC offers manual turns only, as today (`forceWebrtcTurnDetectionOff`: server VAD would cut the translation being played). Turn capability may depend on settings — `turns(s)` — and this is its only use. **Closed 2026-09-29 (owner):** the WebRTC transport of OpenAI Realtime and OpenAI Translate is abandoned, neither migrated nor reimplemented, so no provider offers manual turns only; `turns(s)` stays in the shape and answers both everywhere. |
| D26 | `keepReplayAudio` | Stays as a user switch. On, L1 keeps pcm up to the retention ceiling; off, pcm is dropped on arrival and the row has no replay control. |

### Deleted with no behaviour change

`content[]` (10 clients, 28 sites, always equal to `formatted.text`, no
rendering reader) · the tool-call trio `function_call` / `formatted.tool` /
`formatted.output` (**no client produces them**; `MainPanel.tsx:209-240` is dead
UI) · `formatted.audioTextEnd` (8 write sites, 0 readers) · `formatted.file` ·
`updateSession` / `isConnected` / `getProvider` / `setOutputVolume` (required
methods, zero consumers) · `cancelResponse` (its only call site is a commented-out
line) · `onConversationInterrupted` (the consumer's body is commented out) ·
`onOpen` (never wired) · `itemCreatedAtMap` in `OpenAIGAClient` and
`OpenAIWebRTCClient` (written, never read — `OpenAIClient:522` **does** read its
copy) · `status: 'incomplete' | 'cancelled'` (**never set anywhere**, yet
`MainPanel.tsx:4621` tests for `'incomplete'`).

---

## Architecture

```
              mic / system audio            [uniform, per leg]
                     │ appendAudio(pcm) 24 kHz mono
                     ▼
            L0  Client            one per leg
                transport and protocol only
                     │ segmentOpened / segmentText / segmentClosed
                     │ audio({pcm, ref?, range?})
                     │ failed / degraded / loading / busy / frame
                     ▼
            L1  Conversation      one per leg
                identity · time · punctuation fill-in · growth trace
                     │ Segment[]              │ clip(key, pcm) + routing
                     ▼                        ▼
            L2  Projection           ClipQueue / AudioOut
                cut · group · order      a sink: devices, queue, routing
                session-wide, once       knows clips and keys, not text
                     │ Entry[]                │ position {key, t}
                     └──────────┬─────────────┘
                                ▼
                      Playback queries   a module, not a layer
                      highlightFor(row) · audioFor(row)
                                │
                                ▼
            L3  Surfaces   filter · arrange · render, per surface
                panel · Electron subtitle takeover · extension overlay · export
```

Three properties hold this together:

- **L1 is per leg and knows nothing about the other leg.** A leg's `origin`
  pairing is internal to it; identity is qualified by the leg name.
- **L2 is session-wide and runs once.** It receives both legs' segments and is
  the only place the two interleave. Every surface consumes the same cut; what
  differs per surface is filtering and arrangement, which are L3's.
- **Playback's position comes from the queue, not from a sink.** The speaker
  leg's translation normally goes only to the virtual device and is not
  monitored; a position taken from the real output would leave that leg with no
  karaoke at all.

### Vocabulary

| Term | Layer | Definition | What it is not |
|---|---|---|---|
| **segment** | L1 | One leg, one side, the text between two *provider* boundaries. | Not a bubble, not an audio container, not identity the client owns. |
| **speech** | L1, on a segment | `{ range?: [start, end], pcm }` — this stretch of text is spoken by this audio. | Not a timeline: no concatenation, no cumulative offsets, no separate quality flag. |
| **origin** | L1, a segment field | The shared key binding a source segment to its translation. | Not an object: grouping is derived from it, not stored. |
| **row** | L2 | A drawn line: `{ segmentId, side, textStart, textEnd }`. | Not a segment: one segment may cut into several rows. |
| **group** | L2 | The rows sharing one `origin`. | Not necessarily a pair: one side alone is the common case. |

`formatted.audioSegments` must be renamed — it would collide with `segment`, and
its present shape (two `End` values, the start implied by the previous entry,
the audio stored elsewhere) splits one fact across two places.

---

## L0 — the client contract

```ts
// how a session starts — one call, no construct-then-connect
adapter.start({ context, config, credentials, clock, signal }, events): Promise<Session>
//   no input: every adapter takes the runner's pcm through appendAudio; the
//   native-track seam (`input`) is deleted (Stage 2 Palabra, ruling 16)
//   clock: every timer the adapter runs; the runner's, a virtual one in tests
//   signal: the run's; an adapter still opening rejects when it aborts

interface SessionContext {           // the same for every provider
  direction: { source: Lang; target: Lang }
  speech:    boolean                 // produce translated audio? derived from routing
  turns:     'auto' | 'manual'       // always 'auto' on the participant leg
}

interface Session {                  // what a running session accepts
  appendAudio(pcm: Int16Array): void       // 24 kHz mono
  appendText(text: string): void
  beginTurn(): void                        // manual turns: key pressed
  endTurn(): void                          //   released, speech was heard
  cancelTurn(): void                       //   released, no speech
  stop(): Promise<void>
}

// emitted by the client
segmentOpened({ ref, side: 'source' | 'translation', origin? })
segmentText  ({ ref, text, timing?, language? })   // always the whole text
segmentClosed({ ref, origin? })

audio({ pcm, ref?, range? })
//   ref absent   — attributable to no segment (no provider now; the fake's
//                  `refless-stream` fixture); plays, pairs with nothing
//   range absent — this segment's audio, but which characters is unknown
//                  → replay only, no karaoke
speechRanges({ ref, ranges: [{ index, range }] })
//   sets the range of speech this adapter already emitted for `ref`:
//   `index` is the entry's place among that ref's `audio` events

closed(reason) · reconnecting() · reconnected()
failed(err)                      // the session is broken
degraded(diagnostic)             // running, degraded; its reason?: a cause
                                 //   token for analytics only, never shown
loading({ stage, done, total })  // local engines' model load
busy(boolean)                    // the model is producing
frame({ direction: 'in' | 'out', type, payload? })
```

`ref` is a client-local counter. It exists because a provider can address a
specific earlier stretch: Palabra keeps several sentences in flight at once,
each its own `transcription_id`, and every message names the one it belongs
to. This paragraph first said Palabra revises one, promoting `partial_<id>`
into `validated_<id>` in place; in its port that is an open and a close, not
a revision (Stage 2 Palabra, choice 12).

**No `final` flag on `segmentText`.** It coincides exactly with `segmentClosed`
in every client surveyed (Soniox `<end>`, AST2's `end` phase, Palabra's
`validated`, the local engines' final). A segment's text is provisional until it
closes.

**No text deltas.** Twelve clients maintain `delta.transcript` today and nothing
reads it: MainPanel discards the delta and re-reads the whole array. Most
clients already rebuild the whole text each frame. Snapshots make "the text was
rewritten" the normal case instead of an assumption violation.

**`audio.ref` may be absent.** This removes the reason two clients fabricate a
`ConversationItem` that never enters their own list
(`OpenAIWebRTCClient:120-138`, `PalabraAIClient:1327`): audio may belong to
nothing, and today's contract has no way to say so. Both clients are retired
from the contract (Stage 2 OpenAI Realtime; Stage 2 Palabra), and no ported
provider emits `audio` without a `ref`; the contract keeps it, and the fake's
`refless-stream` fixture keeps it tested.

**`range`, not a running offset.** It is self-describing and needs no context
from the previous chunk. Clients also stop maintaining cumulative audio duration
— `audioCumSamples` / `cumulativeAudioDuration` is computed in four clients
today, and each pcm block's duration follows from its own length.

**A range known only later is filled in** (`speechRanges`, Stage 2 Soniox). A
streaming TTS learns which characters a chunk speaks only once its segment has
ended; the adapter then sets each emitted chunk's range, the segment's span
divided by the chunks' sample counts. Until then the audio plays rangeless —
replay only, no karaoke — and karaoke, which reads a clip's range at each
sample, starts from where playback is. While a rangeless clip of the segment
already lit plays, karaoke holds what is lit, by the same rules as a gap between
clips: a row spoken as several TTS segments never un-highlights between them,
and only the sentence still waiting for its ranges is unlit. Ranges that land
after the queue has played the clip out light nothing live; replay lights them.
The segment may already be closed: L1 measures the ranges against the text the
adapter last sent (counting entries from the adapter's first `audio`, past any
clear) and re-anchors them onto the text as it stands, punctuation fill-in
included. An `audio` range that arrives after the fill-in is measured the same
way: against the adapter's own text, re-anchored onto the filled one, dropped
with a diagnostic when it does not fit — one measurement, which `speechRanges`
and `audio` share (`Conversation.measure`). And an `audio` range on a segment
already closed is checked against its settled text at once, as a
`speechRanges` range is, so one past a closed segment's text is dropped with
the same diagnostic, its pcm kept, whether its audio came before the close or
after it (Stage 2 Gemini/AST2 follow-up, choice 19). The hold is karaoke's,
not Soniox's: it applies to any rangeless clip of the segment already lit,
whichever adapter produced it — LocalInference reaches it when L1 drops some
but not all of a segment's ranges (a range that falls outside the text, or one
a skeleton re-anchor cannot place).

### What every adapter must honour

The conformance suite (D24) checks each rule below against every adapter.

- **Audio is 24 kHz mono `Int16` in both directions.** That is the system rate
  today — `ModernAudioPlayer` opens its context at 24000 and the microphone
  pipeline runs at it — and an adapter resamples on both sides, as the clients
  already do.
- **`range` is in UTF-16 code units** of the text as it was when the audio was
  produced. A range that falls outside the text is dropped by L1 (the audio
  stays, replay-only) and reported once as a diagnostic.
- **Ranges filled in later** name speech entries the adapter emitted for that
  ref, lie within its text, and ascend with the ref's other ranges without
  overlapping (the kit's `ranges-entry`, `range-in-text`, `ranges-order`).
- **`audio` may precede any text for its `ref`.** L1 holds pcm against the ref
  until the segment opens; pcm for a ref that never opens is dropped when the
  session closes.
- **`segmentText` after `segmentClosed` is a revision** of that ref's text and
  does not reopen it. L1 must take one, though no provider revises closed text
  now: Palabra's `partial` → `validated`, the example first given here, is an
  open and a close in its port (Stage 2 Palabra, choice 12), and the fake's
  `refless-stream` fixture keeps the rule tested. Opening the same ref twice
  is a contract violation.
- **`ref`s are never reused within one `Session`**, across an internal reconnect
  included.
- **`appendText` is answered by the adapter**, which emits the typed text as a
  source segment (opened, text, closed) and then its translation. L1 fabricates
  no segment for it. Gemini departs from this: text typed while its connection
  is down is dropped, with no segment (Stage 2 Gemini, choice 17). On a 3.x
  dialogue model, text typed while its input is held waits, with its segment,
  until the hold lets go — across a reconnect too, where it goes up on the new
  connection (Stage 2 Gemini hold, choices 8, 10); a stop before the hold lets
  go drops it, with no segment (Stage 2 Gemini hold, choice 11). OpenAI
  Realtime shows typed text at once and holds its request, first in first out,
  while a response is in progress; the adapter owns that queue, so `busy` has
  no reader (Stage 2 OpenAI Realtime, ruling 8). A release's request waits
  there too, and the releases still waiting when any request goes up leave
  with it, counted as its `merged`: their commits are in the conversation
  already, and a `response.create` answers the conversation as it stands —
  one response per batch of waiting releases (ruling 8's aim; its letter,
  one response per release, amended by the plan's final review).
- **An adapter that can no longer work says so**, with `failed` or an unexpected
  `closed`, and emits nothing after either but a frame of its own ending — the
  graceful end it sends, a REST session's delete and its outcome — until
  `stop()` has returned (Stage 2 session end, choice 3). `closed` need not be preceded by
  closing every segment; L1 finalizes what is open.
- **`frame` carries no audio and no credential.** Its `type` is the adapter's own
  vocabulary, `domain.event`, and its payload is what the Logs panel shows; the
  adapter strips audio and base64 before emitting, and `logStore` still
  sanitizes. The panel groups consecutive frames by `type` alone, marks
  severity by the `error` / `failed` / `warning` suffix, and draws its "session
  ended" separator after the runner's `session.stopped` (Stage 2 session end,
  choice 7; before, from `closed`, the old clients' `disconnect()` line) —
  three conventions the generic event must
  keep. It never finds an item id in a frame: `logStore` reads `item_id` at the
  event's top level (`logStore.ts:495-496`), while a frame reaches it as
  `{ type, data: payload }` (`src/app/telemetry.ts:94`), so a frame groups with
  the one before it only when both have its `type` and a rule gives that type a
  key — the `.delta` rule, or a provider's row (Stage 2 OpenAI Realtime, choice
  13; survey §3.7.5, correcting "groups by `type` plus the item id it finds in
  the payload"). A provider's plan adds the `logStore` rows that group its
  frames (Gemini's: `server_content.*`, `server.usage_metadata`). Doubao AST
  2.0's rows group `subtitle.*`, `tts.*`, `session.usage` and
  `session.audio_muted` under the old client's keys; a group holds one frame
  type. OpenAI Translate's need no row: its three `.delta` frames group by
  their own type when consecutive (the Logs' rule for every provider),
  `session.error` reads as an error by its suffix, and its `session.closed`
  — the server ending the session — comes before the runner's
  `session.stopped`, which draws the separator (Stage 2 session end, choice
  7). OpenAI Realtime's
  need none either: its four `.delta` frames group by their own type when
  consecutive, and none of its other names is anyone's row (Stage 2 OpenAI
  Realtime, choice 13). Gemini's `turn.tail` and `turn.tail_end`, OpenAI
  Translate's names, need none; Gemini's `server.voice_activity`,
  `server_content.waiting_for_input`, `turn.hold` and `turn.hold_end` need
  none either (Stage 2 Gemini hold, choice 12); OpenAI Translate's and
  Gemini's `translation.cut` needs none (Stage 2 translation cuts, choice
  14); Doubao's `tts.sentence_start`
  keeps its row
  with the sentence's times added (`ref` — the lock's —, `startTime`,
  `endTime`, `sequence`), and its new `tts.clip` (`ref`, `matched`, `range`,
  one per clip as it goes to L1) needs none (Stage 2 Gemini/AST2 follow-up,
  choice 5). Palabra's three streamed frames — `transcription.partial` and
  `translation.partial`, a partial's snapshots at about four a second, and
  `audio.output`, a sentence's burst of 200 ms chunks — each get a row that
  groups them under their own type, the `.delta` rule's way, with no key
  another provider's frames could share; its other names need none (Stage 2
  Palabra, choice 11). The runner's `session.stopped`, Doubao's
  `session.finish`, Soniox's `stt.end` and `tts.end`, Palabra's `task.end`,
  `session.delete`, `session.deleted` and `session.delete_warning` — a warning
  by its suffix — and OpenAI Translate's `session.close` need none: each is
  said once per leg's end (Stage 2 session end, choices 4–6). OpenAI Live's
  need no row either: its three `.delta` frames group under their own type,
  `session.error`, `session.reconnect_failed` and `session.socket_error` read
  as errors by their suffix, and none of `session.headers` (the rule's host,
  path and header names, never a value), `session.start`, `session.started`,
  `session.updated`, `session.delegation.created`, the three
  `session.….appended` (instructions, thinking, commentary),
  `session.usage.updated`, `session.stalled`, `session.closed`,
  `session.connection_lost`, `session.reconnecting`, `session.reconnected`,
  `session.unreadable`, `session.unknown`, `session.info`,
  `session.input_audio.mute` / `.unmute` and their acknowledgements,
  `translation.cut` or `session.close` is anyone's row; it frames no append,
  and a close before `session.started` is `session.connection_lost`, OpenAI
  Translate's name for the same close (Stage 2 OpenAI Live, choice 15). No frame payload holds a `ws://` or `wss://` URL:
  three providers' credentials ride a socket's query, and `redact()` masks
  only the parameters it names, so the kit's `frame-url` rule holds every
  adapter to it (choice 10).

### The session request

Configuration reaches a client today through three channels — credentials and
`ClientOptions` into the constructor, a `SessionConfig` into `connect()` — in
**seven different constructor shapes**: the credential is a first positional
string, two positional strings, a tagged union, a bundle, a field inside an
options object, or absent; the options object sits in position 1, 2, 3 or 5.
Nothing declares which fields a provider must fill.

Counted as one row per field per client that receives it, there are 232 rows:

| Class | Rows | Share | What |
|---|---|---|---|
| protocol | 95 | 41% | sent to the server, or shapes the transport |
| local pipeline | 39 | 17% | the local engines' models, VAD, TTS |
| cross-cutting | 53 | 23% | 29 segmentation options, **11 language fields that exist only to pick a punctuation model**, 10 × `keepReplayAudio`, 3 managed-lease options |
| dead | 45 | 19% | 24 filled but never read, 21 inherited but never filled |

The cross-cutting rows leave the client under the layers above: segmentation to
L2 (bar the local engines' translation-job cut), the punctuation language to L1,
which knows the direction, replay retention to L1, the lease to session
lifecycle.

The dead rows have one source: `BaseSessionConfig`, which imposes `model`,
`voice`, `instructions`, `temperature`, `maxTokens` and `textOnly` on every
provider although they share no meaning. `voice` is an OpenAI voice id, a Gemini
prebuilt name, a region-specific Soniox voice, an unread copy of Palabra's
`voiceId`, or unread by the local engines. `model` is a server model id or a
constant label nothing reads in five clients. Palabra ignores 7 of its 19 fields.
The doc comments have drifted with it: `keepReplayAudio` claims every client
caches it (two never read it), the settings store claims every provider honours
`textOnly` (four do not), OpenAI Translate's `sourceLanguage` claims to be a UI
hint (it is the segmentation language), and Soniox's `clientReferenceId` is
sent although Soniox bills by the reference bound to the key when the backend
mints it, not by the field on the wire (probed 2026-08-11); an own key sends
none.

So the request has three parts:

- **`context`** — the only thing every provider receives the same way. Small on
  purpose.
- **`config: C`** — the provider's own configuration, **declared next to its
  adapter**. There is no central union: adding a provider edits no shared file,
  and the 15 `is*SessionConfig` call sites, three hand-written provider checks
  and MainPanel's `as SonioxSessionConfig` cast all disappear, because the
  builder and the adapter share `C` statically.
- **`credentials: K`** — likewise the provider's own, kept separate so it can be
  redacted.

**Direction is lifted out of the provider fields.** Every provider carries a
source and a target, but today each encodes it its own way — OpenAI folds it into
`inputAudioTranscription`, Gemini into `translationConfig`, and both keep a copy
that is never sent to the API purely so the participant leg can reverse it. With
direction in `context`, each adapter derives its protocol fields from it
internally. The consequence:

> **The participant leg is the same builder called with the reversed direction.**

The seven `buildParticipantSessionConfig` overrides disappear. Most of them swap
source and target and re-derive; the two remaining special cases become generic:
whether a direction is supported (OpenAI Translate's thirteen targets, Palabra's
check) is answered by the provider definition's two language functions, and the
participant leg's server-side turn detection follows from `turns: 'auto'`.
"The reversed direction" is the provider's own reverse where it states one
(`languages.reverse`): Palabra codes its targets apart from its sources, so its
reverse of `ja → en-us` is `en → ja`, not the plain swap's `en-us → ja` (Stage 2
Palabra, ruling 9; "The participant rule (D20)"). For
OpenAI Translate the thirteen targets now refuse a Both start whose source is
outside them, before anything opens (D20, D22), where the old guard skipped the
participant leg and ran the speaker alone (Stage 2 OpenAI Translate).

**One call replaces construct-then-connect.** A client is created, connected
immediately and used for exactly one session, so the two are one moment. The
WebRTC-to-WebSocket fallback, which today builds its client without the leg's
options (`MainPanel.tsx:2486`), becomes the same request handed to another
adapter — moot since the owner abandoned OpenAI's WebRTC (2026-09-29): its
two providers run over WebSocket alone, with no fallback to make.

**`updateSession` is deleted.** It has no external caller, and "a running session
does not react to a setting changing" is already the rule. Adapters that
reconnect (Gemini, OpenAI Live, Soniox's 503 resume) reuse the original request
internally. Gemini's attempts are bounded — three, each within its setup
timeout — and with no resumption handle it opens a fresh session rather than
ending (Stage 2 Gemini, ruling 3). OpenAI Live's is one attempt, then
`connection_lost`, a second loss within 60 s of the last reconnect not tried
again; its header seam registers the rule again for the attempt. A stall is
one of its losses: two equal usage reports with 2 s of voiced audio sent
between them, so neither a silent room nor a push-to-talk tap reads as one
(Stage 2 OpenAI Live, ruling 6; choices 13, 14).

**What opacity costs.** Telemetry reads model names straight out of the config
today (`sessionModelTelemetry(sessionConfig, …)`), and the export switches on the
provider to pick model fields (`conversationExport.ts:239-259`, with no case for
four providers). With `C` opaque, the provider definition offers a small
`describe(config)` returning `{ asrModel?, translationModel?, ttsModel? }`.
OpenAI Realtime's `describe` names its transcript model as the ASR model
beside its translation model, where the old start event named no model for it
(Stage 2 OpenAI Realtime, choice 20).

The conservative alternative — keep the union, strip the cross-cutting and dead
fields, lift direction out — removes the participant overrides too, but fails
the measure: adding a provider would still mean adding a type to `IClient.ts`,
adding it to the union and writing a guard.

---

## Turns

"Turn detection" names three different things today:

| | What it is | Where it belongs |
|---|---|---|
| **Mode** | auto, push-to-talk, push-to-translate | a user setting |
| **Gating** | send audio only while the key is held | above the adapter, generic |
| **Ending** | on release, make the provider end this utterance now | **inside each adapter** |

Today the third sits in MainPanel. `capabilities.pttFinalization` has MainPanel
carry out each provider's ending strategy — append seven silent frames and flush
for the local engines, five and do nothing for AST2, branch on a voice count for
Gemini and OpenAI. It is the one detail that most belongs inside the adapter, and
it has leaked out of it.

### What each provider can do

| Provider | Automatic turns | Ending on release | Precision |
|---|---|---|---|
| OpenAI ×3 | server VAD or semantic VAD, configurable | commit + `response.create` | immediate |
| Gemini | server activity detection, configurable; a dialogue model of family 3.0 or later barges in (`START_OF_ACTIVITY_INTERRUPTS`), 2.5, an unversioned id and Live Translate do not (Stage 2 Gemini/AST2 follow-up, ruling 5; choice 9); a 3.x dialogue model holds the leg's input from the server's turn close (`voiceActivity` ACTIVITY_END, else the turn's first output, or its first input transcription on a session that has heard no voice activity) to its `turnComplete`, then sends it in order, the audio as one frame; an ACTIVITY_START lets a hold go, and a release lets one utterance go — up to its first pause after speech 100 ms past the session's own silence setting — holding the rest until the server has closed and answered it, or for 2 s without the close, longer when more went up; a reconnect carries it over (Stage 2 Gemini hold, rulings 1, 2, 4; choices 2, 4, 5, 10, 14, 15) | `activityEnd`; on Live Translate first real-time silence inside the press's activity — 100 ms frames until no transcription for 1 s, at most 3 s, counted in beats — then `activityEnd` (ruling 4; choices 11, 12); on a 3.x dialogue model the release's `activityEnd` begins a hold, and a press made while it holds waits for `turnComplete` (choices 3, 7) | immediate; Live Translate after silence |
| Soniox | server endpoint model (`<end>`), configurable | **`finalize` — exists, never called** | immediate |
| Local ×2 | client VAD, configurable | flush | immediate |
| Volcengine AST2 | server VAD, no knobs | 500 ms of silence on release, the old finalization's burst (Stage 2 Volcengine AST2, ruling 6); between turns the keepalive sends silence only after 250 ms with no audio (ruling 7) | after silence |
| Palabra | server segmentation after its silence threshold, configurable 0.3–2.0 s; a stream with no audio for `IDLE_MS` (800 ms) carries real-time silence, one 320 ms chunk a beat, never ahead of the stream's own clock — ten seconds without input would end the session (Stage 2 Palabra, ruling 3; choice 7). 800 ms, not the owner's "about half a second": the participant leg's ScriptProcessor fallback delivers every 682.7 ms, and 500 would splice silence into its speech (reported to the owner; reversible) | what waits in the 320 ms re-chunker sent at once, padded with silence to a chunk, then the adapter's real-time silence from the next beat, and the server confirms the sentence at its threshold (ruling 3; choice 7) — the old "the track (`dtx:false`) carries silence" was the LiveKit client's | after silence |
| OpenAI Translate | **a continuous stream; there are no turns on the wire**, no commit and no server VAD | the held remainder padded to the next 200 ms engine frame, then one frame of silence per 200 ms beat, in real time, until the translation has been quiet 1 s, at most 3 s after the release — both ends counted in beats, five and fifteen frames, never read off the clock, so a late timer or a stepped clock moves neither (Stage 2 OpenAI Translate, ruling 2): the server holds a sub-frame remainder until more audio arrives, and model time advances only with appended audio | after silence |
| OpenAI Live | **a continuous stream; there are no turns on the wire**, no commit and no server VAD; `session.input_audio.mute` / `.unmute`, acknowledged `session.input_audio.muted` / `.unmuted` in about 105 ms (U2) | a mute: the pending translation finishes while muted, and a muted session with nothing appended stops billing (U2'); stopping the appends alone does not finish the last sentence (U1); a tap is no stall — two equal usage reports read as one only across 2 s of voiced audio (choice 14) (Stage 2 OpenAI Live, ruling 5). This row's first version — "not needed — release stops the microphone" — was the old client's reading, which U1 contradicts | after the model's own finish (ruling 5) |

**Every one of the twelve can support manual turns correctly.** None is
incapable; they differ only between immediate and after-silence — and, for
OpenAI Live, after the model's own finish: a mute lets the pending translation
finish (Stage 2 OpenAI Live, ruling 5).

`SonioxSttStream.finalize()` (`:198`) — "Finalize pending tokens without ending the
session" — has no caller anywhere. Soniox has no push-to-talk today not because
its protocol lacks it but because it was never wired.

Soniox's `finalize` is answered by a `<fin>` token, which the old client
skipped. Under manual turns `<fin>` ends the utterance; endpoint detection stays
on, so a long hold may still close at a pause, and the translation of the last
words is held open briefly after `<fin>` (Stage 2 Soniox, ruling 5).

### The design

**`context.turns` is `'auto' | 'manual'`.** Push-to-talk and push-to-translate
are the same thing to an adapter.

**A manual turn is three methods**, each implemented with the adapter's best
mechanism:

| | `beginTurn` | `endTurn` | `cancelTurn` |
|---|---|---|---|
| OpenAI | — (WebRTC, which enabled its own track, abandoned by the owner, 2026-09-29) | commit at once; its `response.create` waits behind a response in progress, and releases still waiting when a request goes up are answered by that request's response (Stage 2 OpenAI Realtime, ruling 8, its letter amended at the final review) | **`input_audio_buffer.clear`** (Stage 2 OpenAI Realtime, choice 12) |
| Gemini | `activityStart`; on Live Translate a press ends a tail still running, its `activityEnd` first (Stage 2 Gemini/AST2 follow-up, choice 11); on a 3.x dialogue model during a hold, held, with its audio, until the hold lets go (Stage 2 Gemini hold, choice 7) | `activityEnd`; on Live Translate the release tail, then `activityEnd` (ruling 4); on a 3.x dialogue model it begins a hold, and during one it is held (choices 3, 7) | `activityEnd`, and the cancelled press's own answer dropped, never the one before it — after the previous answer ends, when one is still owed (a voiced release or typed text whose answer has not started streaming; one made while an earlier answer streams is owed from that answer's end) or streaming (Stage 2 Gemini, ruling 8, choice 16) — except within the owed flag's remaining limit: it is a flag, not a count, so two answers waiting at once to start are one claim, cleared by the first to end, and a tap before the second's answer streams drops that answer. The two are either two voiced releases (or typed texts) waiting at once for their answers to start (both before any answer streams, for instance), or, on a model that answers an empty press, a tap's and a release's: within one streaming answer, a tap, then a voiced press (or typed text) that ends the tap's pending drop and is released, then another tap — the tap's queued answer takes the release's claim, so that utterance is lost where the flag before the fix (`f7bdb8bb`) kept it; with no answer to taps it is the other way round. On balance the fix keeps far more than it loses, and loses none when taps get no answer (the roadmap's Gemini/AST2 follow-up section, "What it leaves"); on a model that barges in, the press's `activityStart` ends a streaming answer at the server's `interrupted`, and the `turnComplete` that trails it is the same end, not the cancelled press's answer's: `interrupted` and a `turnComplete` with no content between them count as one end (Stage 2 Gemini/AST2 follow-up, ruling 5, settled at its final review); on a 3.x dialogue model a press whose `activityStart` is still held is withdrawn whole — nothing sent, nothing to drop — and the owed flag's limit cannot arise while holds run, only after a hold let go at its cap or on a model that answers taps (Stage 2 Gemini hold, choices 7, 13); on Live Translate the same tail, framed `cancelled`, then `activityEnd` — no "end without generating" message exists (Stage 2 Gemini/AST2 follow-up, ruling 4) |
| Soniox | — | **`finalize`** | — |
| Local ×2 | — | flush, padding the tail where the engine needs it | discard the current VAD segment |
| AST2 | — | 500 ms of silence | the same tail — the old release sent it for an empty press too |
| Palabra | — (sends nothing) | flush the re-chunker, padded; the leg idle from the next beat, so the server hears silence from the release on and closes the sentence at its threshold (Stage 2 Palabra, choice 7) | the same — the runner sends no audio after either (`run.ts:342-346`); `interrupt_task` does not help (the owner's probe) |
| OpenAI Translate | — (a press ends a tail still running) | the pad, then real-time silence until quiet, capped | the same tail — what the press appended is the model's input already, and no clear exists (Stage 2 OpenAI Translate, choice 7) |
| OpenAI Live | `session.input_audio.unmute`, appends resumed (Stage 2 OpenAI Live, ruling 5) | `session.input_audio.mute`, appends dropped until the next press; no tail (ruling 5; choice 11) | the same mute — what the press appended is the model's input already, and no clear exists (ruling 5; choice 11) |

A Gemini dialogue model gets no tail: its `activityEnd` ends a turn it answers
whole (Stage 2 Gemini/AST2 follow-up, choice 13). On Live Translate, typed text
ends a running tail as a press does, its `activityEnd` before the text's own
marks; a stop or a lost connection drops the tail silently, since its activity
was the old connection's (choice 11). **Amended after the Stage 2 translation
cuts plan:** Live Translate takes no typed text (`textInput(s)` is false for
it: the owner's live test found it ignored), so that path is kept in the
adapter but no longer reached.

**A 3.x dialogue model holds its input while it answers** (Stage 2 Gemini
hold, ruling 1). It paces `turnComplete` to a simulated real-time playback of
its answer, and input inside that turn cut the answer or lost its own start,
so from the user's turn close to `turnComplete` the adapter holds the audio, a
press's marks and typed text, and sends them in order at `turnComplete` or
`waitingForInput` — not at `generationComplete`, and not at `interrupted`,
whose trailing `turnComplete` lets go (choice 4). Its cap lets go 2 s past the
model's computed playback end — the first audio's arrival plus all its audio —
or 10 s after it began with no model audio, on the request's clock, and
releases, never discards (ruling 3). A lost connection, a GoAway included,
carries what is held to the new connection — with at most 5 s of the gap's own
audio under automatic turns — which lets it go once set up, a press whose
start is still held sent once; a stop drops it silently (choices 10, 11).
Typed text's own marks are read on the wire (choice 9). **Amended after the
Stage 2 translation cuts plan** (the owner's live test and text probe,
2026-09-30): under manual turns a 3.x model's typed text takes no marks of its
own — it closes the socket with 1007 "Precondition check failed." on marks
around text with no audio, and answers the text sent bare — so it goes bare,
its send beginning the hold (cause `text`); 2.5 and below answer typed text
only inside marks, and keep them (`geminiTextInMarks`, carried on
`GeminiConfig.textInMarks`). Text typed inside a press goes in that press on
every model. Under automatic turns
an ACTIVITY_START lets a hold go at once — the server is hearing speech that
went up before it, and must hear its end — and a release lets one utterance
go, the held audio up to its first pause after speech of at least
`max(200, silenceMs + 100)` ms, the session's own end-of-speech silence plus a
margin (an energy gate over the held audio finds it), holding the rest until
the server's ACTIVITY_END for what went up, then to that answer's
`turnComplete`, or for 2 s — half as long as the released audio plays when
that is longer — without that END (ruling 4; choices 14, 15). 2.5 and Live
Translate never hold (ruling 2). Probed for two utterances 1.57–2.47 s apart
and, with ruling 4, for three Japanese sentences 0.8–1.5 s apart and a
five-sentence monologue: every utterance translated whole in 10 of 10
sessions, at the default silence; noisy rooms, other voices, long monologues
and other silence settings are the live test's.

`beginTurn` exists for two reasons: Gemini sends `activityStart` today on a
heuristic ("before the first audio chunk"), and the two WebRTC adapters own their
microphone as a native track that only they can gate. The second went with
OpenAI's WebRTC transport, which the owner abandoned (2026-09-29).

`input_audio_buffer.clear` is never sent anywhere today. When the voice gate
decides a press held no speech, OpenAI's clients neither commit nor clear, so
that audio stays in the server's buffer and rides along with the next commit.

**The voice gate is generic, and `pttFinalization` is deleted.** Above the
adapter, the session counts voiced chunks for the turn: enough, `endTurn()`;
not enough, `cancelTurn()`. Today's four strategies (`always`, `server-decides`,
`voice-gated`, `voice-gated-cancel`) patched the holes left by ending-knowledge
leaking out of the adapters; with the leak closed, the capability has no reason
to exist. The count belongs to the turn itself, so a press that begins while the
previous turn is still ending can no longer reset the previous turn's count.

**Push-to-translate is a routing rule.** The key toggles the "original voice →
virtual device" route inversely: open while idle, closed while held. The adapter
never learns it exists. It stops depending on the recorder, which today leaves
passthrough silent during push-to-talk idle even with the passthrough toggle on.

**The automatic mechanism and its knobs are the provider's configuration**, in
`C`. OpenAI's stored `'Normal'` and `'Semantic'` are not turn modes but its two
automatic mechanisms. They stay stored as they were, in `turnDetectionMode`,
now `'Normal' | 'Semantic'` alone: a stored push mode (`'Disabled'`,
`'Push-to-Translate'`) is no mechanism and reads as `'Normal'`, as any value
outside a field's values falls to its default, so `S` needs no
`autoDetection` field and no `legacyKeys` entry, and nothing is converted
(Stage 2 OpenAI Realtime, ruling 5, choice 4; this paragraph first said they
become an `autoDetection: 'server' | 'semantic'`). OpenAI stops storing
push-to-talk there: the global mode holds it. The global mode's one-time
migration is unchanged, so OpenAI's stored `'Disabled'` — its push-to-talk —
maps to automatic, and a user who held push-to-talk picks it again once: a
stated departure (survey §3.7.3).

**The participant leg is always `turns: 'auto'`**, never gated, with no
passthrough — a generic rule rather than Gemini's override. The settings copy
"Other's audio always uses semantic VAD" was true for OpenAI alone, whose
participant was forced to semantic VAD at high eagerness
(`ProviderDescriptor.ts:389-407`), and false for every other provider —
Gemini's participant used the user's own detection knobs. It becomes "always
uses the provider's automatic detection", and true: OpenAI Realtime's
participant now uses the user's own detection, as Gemini's does (Stage 2
OpenAI Realtime, ruling 4; survey §3.7.2).

**The mode is one global setting.** Every provider supports all three, so whether
to hold a key is the user's habit, not a property of a provider, and switching
providers should not lose it. Today it is stored in six provider slices and
absent from six.

### Surfaces emit press and release

The session owns the turn — gating, the voice count, begin, end, cancel. Each
input surface only emits **press** and **release**:

- **the panel's hold button**, with pointer down, up, **leave and cancel**. Today's
  buttons handle down and up only, so pressing and dragging off the button
  never releases.
- **the Space key**, in the panel and in the Electron subtitle takeover. The
  takeover is the same window reshaped, MainPanel's key listeners stay attached,
  and no other application competes for the key.
- **a hold button on the extension overlay**, new. The overlay has no
  push-to-talk today: `SubtitleApp.tsx:380-382` shows "Press Space to speak"
  before the first bubble, but its only key listener handles Escape, the injected
  content script listens only for Escape, and the overlay-to-panel wire carries
  only `request-clear` and `user-exit`. Two messages join them,
  `subtitle:turn-press` and `subtitle:turn-release`, following the existing
  control-message path.

**The "Press Space to speak" hint is removed from the extension overlay.** The
overlay sits inside a meeting page, and Google Meet uses Space itself for
press-to-unmute: Space there is not Sokuji's key. The Electron subtitle
takeover keeps its hint, where it is true.

### Defects removed by construction

- An empty OpenAI press leaves its audio in the server buffer to join the next
  turn — `cancelTurn` clears it. Landed with OpenAI Realtime's WebSocket port
  (Stage 2 OpenAI Realtime, choice 12).
- On OpenAI over WebRTC the key does not gate audio at all: the native track is
  always live and the key only counts voiced chunks — the adapter now gates its
  own track. Removed instead with the transport: the owner abandoned OpenAI's
  WebRTC (2026-09-29), and over WebSocket the runner's gate holds.
- Push-to-talk idle suppresses passthrough even with the toggle on —
  passthrough is a route, independent of the recorder.
- A passthrough volume of 0 plays at 30% (`passthroughVolume || 0.3`) — it is a
  gain on a route, and 0 means 0.
- The declared modes disagree with the offered ones — AST2 declares two and
  offers three, Gemini and the local engines declare none and offer three,
  OpenAI's push-to-translate is outside its own declaration. The declarations
  disappear; every provider offers all three.

**Coverage.** Soniox, OpenAI Translate (with its Kizuna twin), OpenAI Live and
Palabra offer only automatic turns today. All of them gain push-to-talk and
push-to-translate. OpenAI Translate's gain lands with its Stage 2 plan, over
WebSocket; its Kizuna twin is deleted, not ported. Palabra's landed with its
WebSocket port (Stage 2 Palabra, choice 7). OpenAI Live's landed with its
Stage 2 plan, by mute (Stage 2 OpenAI Live, ruling 5). The one exception runs the
other way: OpenAI Realtime over WebRTC keeps manual turns only (D25), as
today — with the native track live, the server's VAD would cut the translation
being played whenever the user speaks, which is why
`forceWebrtcTurnDetectionOff` exists. The definition states it through
`turns(s)`, and the settings UI hides the automatic mode there. OpenAI
Realtime's first port is WebSocket only and offers both modes (Stage 2 OpenAI
Realtime, ruling 12). D25, `turns(s)` and the participant's transport were to
meet a WebRTC step, with OpenAI Translate's, which would also have decided
whether "manual only" includes push-to-translate — the old UI disabled it
under WebRTC too (`ProviderSpecificSettings.tsx:589-590`; survey §3.7.7).
**Amended 2026-09-29 (owner):** the WebRTC transport of both OpenAI providers
is abandoned, neither migrated nor reimplemented, so the exception is gone:
both offer both modes over WebSocket, D25 is closed, and the participant's
transport is the speaker's.

---

## L1 — the data model

```ts
interface Leg {                     // what one L1 instance exposes
  leg:       'speaker' | 'participant'
  session:   SessionId
  languages: { source: string; target: string }   // frozen at connect
  segments:  Segment[]
  notices:   Notice[]
}

interface Segment {
  id:        SegmentId              // `${session}:${leg}:${n}`, a counter
  side:      'source' | 'translation'

  text:      string                 // display text, replaced wholesale
  final:     boolean                // the client called segmentClosed

  openedAt:  number                 // L1 wall clock
  marks:     Array<{ at: number; len: number }>   // growth trace, compacted
  timing?:   { startMs: number; endMs: number }   // provider media time

  language?: string                 // per-segment detection (Soniox only)
  origin?:   OriginRef              // stated only

  speech:    Array<{ range?: [number, number]; pcm: Int16Array }>
                                    // empty on a source segment: the only audio
                                    // a source has is the user's own microphone,
                                    // which is never replayed
}

interface Notice {
  id; at: number
  severity: 'error' | 'warning'
  message: string
  code?: string                     // from CLIENT_DIAGNOSTICS on `degraded`
}
```

`status`'s four states collapse to `final` because `'incomplete'` and
`'cancelled'` are never set anywhere. `source` disappears — L1 is per leg, so
the leg is ambient within it, and stated on the `Leg` it exposes.

### The language pair belongs to the leg, frozen at connect

A row's language badge needs the configured pair, not only a detected
language — `detectedLanguage` exists on one provider alone. Today the pair lives
in `MainPanel`'s `itemLanguagesRef`, which records a pair the first time it sees
each row so that changing the language setting after a session stops cannot
relabel the rows still on screen.

The pair does not vary within a leg's session, so it is recorded once, on the
`Leg`, at connect. For the participant leg it is already the reversed pair. A
row's badge is `segment.language ?? (side === 'source' ? languages.source :
languages.target)`. `itemLanguagesRef` and its pruning pass disappear.

### The growth trace

`marks` exists so L2 can stay pure. L2 can see *when* the text changed, but
cutting at a pause needs to know **how long the text was when the pause began**,
and that cannot be recovered afterwards — today's six silence timers cut at the
text's current end at the moment they fire.

With `marks`, L2 finds `marks[k+1].at - marks[k].at > threshold` and cuts at
`marks[k].len`. Exact reconstruction, not an estimate. The trace is compacted:
marks that bound no pause are dropped, so a segment keeps single digits of them
even where the client rebuilds the whole text twenty times a second.

**This is an L2 implementation choice, not an architectural one.** The cut runs
once, in the panel process, so a stateful cut holding a timer would not drift
either — no other layer can tell the difference. The reason to prefer `marks` is
narrow: it keeps every timer in L0, where six sets of silence timers disappear
rather than being relocated into one. If the trace proves tiresome to maintain,
swapping it for a timer inside the cut changes nothing outside L2.

An earlier draft justified `marks` by cross-process consistency — the overlay
deriving its own cuts and drifting from the panel's. That argument is void:
the cut is computed once and shipped, so no surface derives it.

### Re-anchoring on every text replacement

A speech `range` is measured against the text as it was at production time, and
the text is replaced repeatedly — partials accumulating, a final re-decode,
punctuation fill-in, `unwrapTranslationText` unwrapping. On every replacement:

| New text vs old | Action |
|---|---|
| Only longer (append; the partial case) | ranges unchanged |
| Same skeleton (punctuation or whitespace inserted) | re-anchor exactly by skeleton alignment — `sealCursor.ts`'s `offsetAfterSkeleton` already does this |
| Letters or digits changed (ASR re-decode) | **drop the ranges, keep the pcm** |

The third branch degrades to replay-only, which is the same path as a segment
that never had a `range`. No new code path.

A range produced before the fill-in is re-anchored with it; one produced after
it — a `speechRanges` range or an `audio` one — is measured against the text
the adapter sent and re-anchored the same way, through the one measurement
both share (Stage 2 Gemini/AST2 follow-up, choice 19).

`punctuateDefinite.ts:67` already enforces the invariant the second branch needs:
punctuation fill-in may insert marks but may not alter letters or digits, or the
result is discarded.

### Punctuation fill-in, and why `SegmentLane` disappears

Fill-in runs once, when a segment goes final, and replaces `text` in place. It
runs for every provider from one place, replacing eleven per-client injections;
its gate already returns the input unchanged when terminal marks are present, so
it is a no-op for text the local engines punctuated themselves.

`SegmentLane` exists today because pieces are written into an array and a later
segment can land between them — and because a missed flush loses text outright
(segmentation slice 4 lost a session's transcripts to exactly that). A segment
already holds its own text and fill-in only improves it, so **no text is ever in
flight**. The lane is not moved to L2; it ceases to exist, and so does the
`flush()` at the top of every `disconnect()`.

### Identity

`` `${session}:${leg}:${n}` ``. The leg qualifies the counter, so cross-leg
collision is impossible and `instanceId` prefixes, uuids, `Date.now()` minting
and the shared-timestamp convention all lose their reason to exist. Player clip
keys are `` `${segId}:${speechIdx}` ``.

**The session qualifier is not optional.** `SubtitleStream`'s `itemStatesRef`
locks each id as "new" or "existing" permanently and is never pruned, and the
overlay component outlives a session. A counter that restarts per session would
make the next session's `speaker:1` collide with the last one's and never
animate in. Today's ids avoid this only because they carry `Date.now()` or a
uuid.

`VolcengineAST2Client.ts:119-124` states today's reason outright: without the
prefix, both legs' clients mint identical ids and the karaoke highlight, which
keys on `item.id` alone, lights two bubbles at once.

### Notices are not segments

`error` comes from `failed`, `warning` from `degraded` — two channels, two
severities, honest by construction. Today `severity` is a patch because
`type: 'error'` conflates a broken session with a degraded one, and
`subtitleIdleState` is the only consumer that needs them apart.

Keeping notices separate also removes four downstream special cases: error rows
bypassing the display-mode filter, being forced into the translation band,
rendering as a red bubble without consulting `severity`, and `severity` existing
at all.

### Retention

`speech[].pcm` is the only unbounded state. L1 carries a ceiling and drops the
oldest pcm past it. Dropping pcm leaves text and ranges intact — that row loses
its replay control and nothing else changes. This is the correct shape of
today's `keepReplayAudio` setting.

---

## L2 — the projection

```ts
(legs: Leg[], settings) → Entry[]

type Entry =
  | { kind: 'exchange'; id; leg; languages;
      pairing: 'stated' | 'inferred' | 'none';
      source: Row[]; translation: Row[]; t: number }
  | { kind: 'notice'; id; leg; severity; message; at: number }

type Row = { segmentId; side: 'source' | 'translation'; start: number; end: number }
```

**`leg` is a field, never parsed out of an id.** Once L2 has merged the legs,
every entry must say which one it came from, and reading it out of the string
`"…:speaker:3"` would encode data in an identifier — the same move as Palabra's
`${id}_p2` suffixes today. `languages` rides along on the exchange so a surface
can draw the badge without reaching back to the leg.

Three jobs, and only three: **cut** segments into rows, **group** rows by
`origin`, **order** groups by the earliest `openedAt` they contain. It runs
**once per session**, not once per surface. An open segment ends in one live
row, and a pause cut applies to it as much as to a closed one — that is what
"by pause" means while someone is still speaking.

**The projection is incremental.** Only a leg whose segments changed is re-cut,
pairing is re-evaluated only when a pairing input changed — a segment opened, an
origin, a timing — and then only inside each translation's proximity window
(F16, Stage 2 Gemini choice 24), and entries that did not change keep their
identity. A session runs for hours and a partial
arrives twenty times a second; re-pairing thousands of segments on every one
would put the cost where today's full `mergeConversationItems` already puts
it, and the point of running once is to run less, not the same amount in one
place.

The window holds for untimed pairs. A translation with `timing` still scans
every source with timing (`pair.ts`), and a timing that changes on every delta
re-pairs on every delta, so the first provider whose origins L2 infers to
emit `timing` sets it once, at segment close, and extends F16 to a timed
window first — OpenAI Translate's follow-up, should its `elapsed_ms` prove
one timeline (Stage 2 OpenAI Translate, ruling 6). OpenAI Translate now
states its origins (Stage 2 translation cuts, ruling 2), so its pairing needs
no timing; the timed window waits for a provider whose origins L2 infers and
that emits `timing` — Doubao AST 2.0 emits none, and OpenAI Live states its
origins by the same cuts and emits no `timing` (Stage 2 OpenAI Live, ruling 3).

Filtering, band packing and styling are **not** L2's. They depend on each
surface's own settings — the extension overlay carries display modes, a font
size and colours independent of the panel's — and applying them is rendering,
not derivation. They live in L3, over one shared filter function called with
different settings.

That line matters because it is what stops the work being done twice. What must
be identical across surfaces is the cut and the grouping: the same utterance
must not show as three bubbles in the panel and two in the overlay. That is
computed once. What legitimately differs per surface is which of those rows it
shows and how it arranges them.

### The two subtitle surfaces are not the same thing

| | Electron subtitle mode | Extension in-page overlay |
|---|---|---|
| What it is | the **same window reshaped** into a floating bar; same renderer, same store | an iframe **injected into the meeting page**, a separate document |
| How data arrives | read from the store directly, no serialisation | over a `chrome.runtime` port |
| What its surface class does | IPC for bounds, always-on-top, fullscreen — **it carries no data** (`ElectronSubtitleSurface.ts` in full) | subscribe, slice, strip, throttle, post |
| Drift risk | **none** — one copy of the state | real, and the only place it exists |

`SubtitleApp` and `SubtitleStream` are shared by both, so the rewrite lands on
shared components; only the data path differs. The overlay receives `Entry[]`
and renders; it stops re-deriving.

**The wire stops carrying audio by construction.** `Entry[]` holds rows —
`segmentId` and character ranges — while `speech[].pcm` stays on L1 in the panel
process, and the overlay never plays audio. So
`ExtensionContentScriptSubtitleSurface`'s `stripHeavyItemFields`, a denylist of
three field names that a fourth heavy field would silently slip past, has
nothing left to strip.

**`splitDefinite` must change to return ranges.** It returns `string[]` today,
`.trim()`ed — the offsets are lost at that step, which is the root of
`usePlaybackHighlight`'s `originalText.indexOf(textOverride)` guess (wrong on a
repeated substring, silently zero when the text was rewritten). Returning
`Array<[start, end]>` removes the guess from the system.

**The ranges tile the segment's text with no gaps and no trimming.** Adjacent
rows of one segment, concatenated, reproduce the text exactly — with a space
between them where the original had one, and without where it did not. A bubble
surface trims for display; a band surface joins with no separator.

This fixes a defect that exists today and that splitting would otherwise make
worse. The compact band joins items with a single space
(`SubtitleStream.tsx:253`), which is wrong for Chinese and Japanese. Today that
error falls only *between* utterances; once one utterance becomes several rows,
it would fall *inside* sentences. A separator is needed only between segments,
and there it follows the language.

**`origin` inference lives here**, because it is a pure function of the segment
lists: pair by maximum overlap when both sides carry `timing`, otherwise by
temporal proximity, otherwise leave the group unpaired. `pairing` is a property
of the group, never of a segment.

**Unpaired is the common case, not an error.** The translation always lags the
source, so "source rows, no translation yet" occurs every few seconds. A source
cut into three rows beside a translation cut into two is likewise ordinary — the
two sides are separate arrays and need not be the same length.

### Export: one block per group

The export is an L3 surface. It consumes L2's groups but writes each group's
**segment text whole**, not its rows:

```
[14:03:12] Me
  今天天气很好。我们去公园吧。顺便买点东西。
  → The weather is nice today. Let's go to the park, and pick up a few things on the way.

[14:03:20] Other
  Sounds good. What time?
  → 听起来不错。几点？

[14:03:25] Me
  下午三点吧。
  (no translation)
```

- **Not per row.** Rows are cut by the sentences-per-bubble setting, which exists
  for the readability of live bubbles. Exporting rows would make the same
  conversation produce different files depending on a display setting.
- **Not per segment.** That keeps the provider's units but loses the pairing,
  which is exactly today's file: source and translation interleaved by time,
  their correspondence left to the reader.
- **One timestamp per group**, the source segment's `openedAt`.
- **A missing side is stated, not omitted** — the reader must be able to tell
  "not translated" from "lost".
- **Inferred pairings are written paired, like stated ones.** Both are the best
  judgement available, and today's file carries no correspondence at all. The
  JSON form keeps `pairing` on every group so a consumer that cares can tell them
  apart.
- The export scope checkboxes still apply; they are L3 filtering, selecting
  which side of each group is written.
- Notices stay out of the text form, as today; the JSON form may carry them as
  metadata.

This refines what "the saved file holds what the screen shows" guarantees: the
same content, in the same order, with nothing dropped — **not** the same line
breaks. Line breaks follow a display setting; the file should not.
`conversationExport.ts:152`'s silent dropping of every non-`completed` row
disappears with `status` itself.

---

## Playback

### Routing

| Source | → device | Control |
|---|---|---|
| speaker translation | virtual | switch (let the meeting hear it), **on by default** — **new**, no control exists today |
| speaker translation | real | switch (monitor) — a volume in disguise today |
| speaker passthrough | virtual | switch + **percentage volume** |
| participant translation | real | switch (the participant-TTS opt-in) |
| replay | real | fixed route, on demand |
| voice preview | real | fixed route — **folded in**; uses `new Audio()` today and ignores the selected device |
| test tone (dev) | real | fixed route |

Passthrough's second destination — the real output, delayed 150 ms — is
deleted; passthrough now has one purpose and one destination.

**Level** — the real device's monitoring gain — stays where it is, a device
setting in `audioStore` (`setMonitorVolume`, `isMonitorMuted`); it is not a
route and not a mix.

**Voice preview bypasses the sink at two sites** — `VoiceLibrarySection`'s own
`AudioContext`, which plays Soniox's previews, Local Native's
(`NativeVoiceSection` renders it) and LocalInference's
(`LocalInferenceVoiceSection` renders it; the released LocalInference view
provides no `VoicePreviewContext`, so its previews still play on the default
output), and `SonioxCloneReviewStep`'s `<audio>`.
`VoiceCreateModal`'s `AudioContext` is its recorder, and `nativeVoiceStores`'
decodes an imported clip and closes; neither is a player (the first version of
this paragraph counted all four as preview sites). `VoiceLibrarySection` folds
into the preview route through a port its host hands down (Soniox first,
Stage 2; Local Native's and LocalInference's hosts hand it one in their own
providers' plans);
`SonioxCloneReviewStep` is a seekable review player that a play-once route
cannot replace without losing seek, and stays on the default output (Stage 2
Soniox, ruling 6).

**The system has exactly one genuine volume: the passthrough percentage.**
Only the virtual device carries a deliberate mix (translation with the original
voice underneath, where the ratio is part of the product). Sources meeting on
the real device overlap incidentally, which the device mixes and the user
accepts; they need no individual volumes, only a device monitor level.

Three things, three natures, none impersonating another: **Route** (switch),
**Mix gain** (only where a ratio is meant), **Level** (device monitoring).

Today there is no routing at all: every output goes everywhere and volume is
used to hold it back. Two consequences are live defects — **replay is re-injected
into the virtual microphone, so the meeting hears it a second time**, and the
test tone is too. Both become impossible: neither route set contains the virtual
device. `ModernBrowserAudioService.ts:497`, which pins the virtual speaker's
volume to 1.0 to stop the monitor control leaking into the meeting, is the debt
made visible — using volume as a control forces a second, hard-pinned volume to
block the first.

### The clip queue

```ts
ClipQueue
  enqueue(key, pcm)  // one whole clip; clips play back to back in call order
  clear()            // drop the queue and stop
  position()         // { key, t } | null — exact, against the audio clock
  subscribe(cb)      // called when a clip is enqueued or ends, or the queue clears
```

A clip is one speech entry — one `audio` event's pcm, whole when it arrives —
keyed `${leg}:${ref}:${index}`, `index` being the entry's position in
`Segment.speech`; replay enqueues a segment's entries under the same keys, so
karaoke reads live audio and replay alike. Sources carrying text (speaker
translation, participant translation, replay) get a queue; sources without
(passthrough, preview, test tone) are plain streams into the mix.

**There is no `seal`** (amended by plan 1c-2, ruling 2). An earlier draft had
`append(key, pcm)` + `seal(key)`, with a clip spanning a segment and `seal`
telling "this item finished" from "a gap between chunks" — the question MainPanel
answers today with `item.status === 'completed'` and a 2500 ms debounce
(`MainPanel.tsx:3806-3821`). But L0 has no "this segment's audio is complete"
event: `segmentClosed` marks the *text* final, and a local engine's speech for a
closed segment arrives after it. A clip that is one speech entry is complete by
construction. The cost moves to L3: `position()` is null in a gap between one
segment's clips, so what karaoke and the playing indicator show in such a gap is
a surface decision (plan 1d), made from the queue's positions and the segments'
`final` — not from a guess inside the player. The same decision covers a clip
whose range is not filled in yet: while one plays for the segment already lit,
karaoke holds what is lit by the gap's rules (Stage 2 Soniox, choice 18). An
adapter that knows when a segment's speech ends could one day say so in L0; none
needs it yet.

**Position is `{key, t}`, not a ratio.** Each clip is one unit whose start we
enqueued, so `_cumOffset`, `_maxProgress`, `progressRatio`, `duration` and
`bufferedTime` are all unnecessary, and the playback wire shrinks accordingly.
`subscribe` says when to look; `position()` is exact, since a pushed `{key, t}`
cannot be without a timer.

**Replay is its own queue** — derived, not assumed: it targets the real device
while the speaker's live translation targets the virtual one. Sharing a queue
would share a scheduler and make replay wait behind audio that was never going
to the same device.

**The player drops audio once played**; the durable copy lives in L1's
`speech[].pcm`. Today both retain, which is where issue #531's memory pressure
comes from.

One scheduler per queue, fan-out after the mix — not today's two independent
`ModernAudioPlayer` instances fed the same PCM and kept in step by hand at five
call sites (`interrupt` 664, `clearStreamingTrack` 691, `clearInterruptedTracks`
706, `setGlobalVolume` 496, `setSinkId` 388).

### The echo monitor keeps its three probes

`EchoMonitor` (`ModernBrowserAudioService.ts:70-74`) correlates three signals:
the microphone against the TTS output and the participant capture
(`tts-echo`, `meeting-echo`), the participant capture against the TTS output
(`self-capture`, `far-end-echo`), and the microphone against the TTS output at
near-zero lag (`routing-loop`). Capture moves into the runner's sources and
playback into the sink, so each side exposes a **pcm tap** — every source and
the sink's mixed output — and the monitor subscribes to the taps it needs. Its
detectors and its notice UI (`EchoNotice`, outside L1) are unchanged.

---

## Provider capability

Replay needs only that the audio be attributable to a segment. Karaoke needs a
real `range`. Pairing needs an `origin`, stated or inferred.

| Client | Replay | Karaoke `range` | source↔translation |
|---|---|---|---|
| LocalInferenceClient | yes | per TTS sentence, **exists today** | one translate job — stated |
| LocalNativeClient | yes | per TTS sentence, **exists today** | one translate job — stated |
| SonioxClient | yes | per TTS segment — filled in once the segment's speech has ended (`speechRanges`); unlit before; none for a segment the provider killed | same utterance — stated |
| OpenAITranslateGAClient | yes | per audio frame, **by arrival**: each content frame carries the translation's text from the previous frame's end to its length when the frame arrived — the old client's alignment (#216), kept by the owner's ruling, not a known correspondence (Stage 2 OpenAI Translate, ruling 6) | source cut ↔ translation cut — **stated**: each closing source owes the translation one cut, taken once the translation holds as many sentence ends as the source, the latest arriving after the source's last delta; the translation states that source, at its open when known (the cut owed first, else the source still open), else at its close; a sentence end counted as ruling 1 (iii) says, and in the scripts it does not name at their own marks (`।॥۔؟။։።។៕．｡`, counted as the CJK ones); a Latin period by the owner's rule C (2026-09-30), read by the word before it: a capitalised title before a name ("Mr.", "Sr.", …), "vs.", "cf.", "e.g.", "i.e.", German "z." or a single capital initial (not the pronoun "I") never ends a sentence; any other abbreviation of the shared list, or an ellipsis, ends one only before a capitalised word, opening marks aside; every other period — a plain word, a word joined to a number — as before; both sides' counts, on every provider that uses the module; its own quiet settles it and drops cuts no translation answered, as does a translation that begins for a newer source; one that follows no cut continues the spoken source that closed last (Stage 2 translation cuts, rulings 1, 2; choices 3, 5–9). `elapsed_ms` is still framed, and read by nothing |
| OpenAILiveClient | yes | per audio frame, **on the output's timeline**: every output frame advances the output's sample clock by its samples ÷ 24 ms, the noise floor's included; a voiced frame's range is the characters its window's `start_ms` / `end_ms` cover in the segment of the delta whose stamps lie nearest it — interpolated inside a delta, held at its end through a gap — computed as the frame arrives, since the text leads its audio. A real range under D4, not a stated exception: U4 measured the stamps against whisper-1's words at a median of 200 ms and a p90 of 760 ms, and the ranges through L1 match them but for a word whose stamps fall on the stream's floor, which no voiced frame covers and the light passes at its row's next voiced frame (Stage 2 OpenAI Live, ruling 2; choices 9, 10). This row's first version — "per audio frame, **exists today**" and "inferred (`end_ms` timeline)" — was never true: the old karaoke was by arrival, and L2 had no timeline rule | source cut ↔ translation cut — **stated**, by the translation cuts module, the source cut at a pause of at least the source pause on the input's timeline (Stage 2 OpenAI Live, rulings 3, 10; choice 6) |
| OpenAIGAClient | yes | per audio frame, **by arrival**, as OpenAI Translate's: each played frame carries the translation's text from the previous frame's end to its length when the frame arrived, restated within the final text when that settles shorter (`speechRanges`). This table's first "per audio frame" for this client and the compatible one was never true: neither produced a range, and their karaoke was the interpolation D4 deletes (survey §3.7.1). So this is the second stated exception to the honesty rule (Stage 2 OpenAI Realtime, ruling 3; choice 9) | input item ↔ response — **stated**: the assistant item's `previous_item_id` when it names one of the leg's inputs; else, taken when the response began, the newest input the server holds — by when it came to hold it, not when the leg opened it — if it is still unanswered, never an older one behind it; else none, and the translation shows unpaired (Stage 2 OpenAI Realtime, ruling 23; choice 8; the server's order since its final review) |
| OpenAIClient (compatible) | retired, not ported (Stage 2 OpenAI Realtime, ruling 1) | — | — |
| GeminiClient | yes | per audio chunk, **by arrival**, as OpenAI Translate's and OpenAI Realtime's: each played chunk carries its translation's text from the previous chunk's end to its length when the chunk arrived, `[0, 0]` before any text — a dialogue model's audio opens its turn's translation, and Live Translate's audio outside an open translation stays unattributed; the text only grows, so nothing is restated. Live Translate's stream is real time with its text 0–0.3 s ahead, so its karaoke is phrase-level and holds through its silence: a chunk with no new text since the last is zero-width. The third stated exception to the honesty rule (Stage 2 Gemini/AST2 follow-up, ruling 2; choice 7) | dialogue models: same turn — stated; Live Translate: source cut ↔ translation cut — stated, as OpenAI Translate's, with no mid-sentence hold into Thai or Lao (Stage 2 translation cuts, ruling 3; choice 6) |
| VolcengineAST2Client | yes — today's quality is the bar to keep | per TTS sentence — the whole translation subtitle whose server times the sentence carries (8 of 8 in the owner's probe), matched exactly (start and end) against the last eight translations as its clip is emitted, after its decode, and stated once the subtitle closes: at the clip's emission, or by `speechRanges` at the close; the first clip to carry a subtitle's times takes its range, a later one plays rangeless on the same row; a sentence whose times name no recent translation plays rangeless on the old lock, read at the sentence's start (Stage 2 Gemini/AST2 follow-up, ruling 1; choices 2–4) | inferred by proximity: neither origin nor timing is emitted; each subtitle frame carries `responseMeta.Sequence` and the times, for the live test to settle whether either states the pair (Stage 2 Volcengine AST2, ruling 11); every source subtitle carries its translation's times in the owner's probe — evidence for stated pairing, not taken yet |
| OpenAIWebRTCClient | abandoned, not ported (owner, 2026-09-29) | — | — |
| OpenAITranslateWebRTCClient | abandoned, not ported (owner, 2026-09-29) | — | — |
| Palabra (`palabraai`, WebSocket) | **yes** — each chunk names its sentence (Stage 2 Palabra, ruling 6) | per sentence — its translation's text tiled over the chunks by sample count once the burst is whole, at `last_chunk` (`speechRanges`, Soniox's fill-in; ruling 6, choice 12); unlit before. A range filled in later, as Soniox's ("A range known only later is filled in"), not a stated exception, so D4's list is unchanged | **`transcription_id`** — stated (choice 12). The old LiveKit client (`PalabraAIClient`) replayed nothing: a continuous track, attributable to nothing, and its id extracted and then discarded |

Soniox's unit is the TTS **segment** — a sentence, a clause after 1.5 s with no
new text, 3 s of idle, an 8-s cap, a change of language or of row, or the
utterance's end (`ttsStream.ts`) — not the sentence the first version of this
table named (Stage 2 Soniox survey §3.7.3).

Gemini, not OpenAI Translate, is the first provider whose origins L2 infers
(Live Translate). Doubao AST 2.0 is the second, pairing by proximity alone like
Live Translate: neither states an origin or a timing. OpenAI Translate is the
third, by proximity too. **Amended by the Stage 2 translation cuts plan:**
OpenAI Translate and Gemini Live Translate now state their origins; Doubao AST
2.0 is the one ported provider whose origins L2 still infers.

OpenAI Realtime's pairing is stated by the server's own item ids: every input
item — a commit, automatic or manual, or a typed text under the adapter's own
id — is a source whose origin is that id. An utterance no response answers —
one spoken over a playing translation, which the server may leave unanswered
under `interrupt_response: false` — stays a source row of its own. A
translation left with no origin shows unpaired rather than inferred: L2
infers only between segments that state no origin (`pair.ts:25-26`), and
every source of this provider states one (Stage 2 OpenAI Realtime, ruling 23;
choice 8). One response answers a batch of releases that waited behind a
running one (ruling 8's aim), and its item names the last input it answers:
an earlier input of the batch shows as a source with no translation beside
it, its words in the translation under the later one — a typed text's
translation likewise holds the words of releases waiting with it, whose
commits went up before its item.

Two findings are worth stating plainly. Palabra holds the cleanest pairing
evidence in the codebase: the same `transcription_id` appears on all four of
its item kinds — and, the owner's probe showed, on every chunk of its speech;
the old client extracted it at four sites and then baked it into a prefixed
string id where it could no longer be read, and the port states it (Stage 2
Palabra, choice 12). This paragraph first also found Palabra the only client
that cannot replay; its port's audio names its sentence (ruling 6), so no
client is left that cannot. The contract keeps ref-less `audio` all the same,
which only the fake's `refless-stream` fixture produces now. And "OpenAI
Realtime GA can only ever offer Auto", recorded in the
segmentation notes, is **wrong** — it is three lines it never wrote, not a
limitation of its data.

---

## The provider definition

The session request says what an adapter receives. This section says who builds
it. Today that is `ProviderDescriptor` with its `ProviderConfig`: 18 members,
17 config fields and some twenty capability flags, thirteen times over.

### What adding a provider costs today

OpenAI Live (PR #552) is the most recent provider. Outside its client it touched
21 code and test files and all 30 locale catalogs, about +681 lines:

| | Lines | What |
|---|---|---|
| registration | ~54 | the enum and its separate `ProviderType` union, the factory, ten settings-store touchpoints, the `IClient` union and guard, edits to five test files |
| settings | ~164 | the store's key prefill and auto-select case, three hand-written UI write paths, locale name and description |
| session building | ~269 | a session-config type in `IClient.ts`, the descriptor, its test |
| behaviour outside the client | ~194 | an extension DNR rule and manifest host, Electron header removal, logStore event names, a MainPanel lifecycle edit, a connection-lost locale key |

The five-step checklist in `CLAUDE.md` misses about ten kinds of required edit:
the `IClient` union and guard, the separate `ProviderType` union, eight of the
ten settings-store touchpoints, the three UI write paths (the `updateApiKey`
switch, LanguageSection's two switches, ProviderSpecificSettings' if-chain —
Soniox needed a follow-up commit for exactly these, `79edd01c`), four more tests
that pin the provider list, and the extension's per-provider DNR block. Its claim
that the registry test "fails loudly on anything missed" does not hold in CI:
`build.yml` runs vitest on four paths, none of them provider code, and the build
has no `tsc`, so the `Record<Provider, …>` tables fail only under a local
typecheck.

### Six concerns in one object

| Concern | Members today | Read by |
|---|---|---|
| identity and presence | `id`, `i18nKey`, registration order and flags | provider lists |
| settings UI | 19 capability fields, `voices`, `models`, ranges | ProviderSpecificSettings, only |
| credentials and validation | `credentialFieldsFor`, `extractCredentials`, `peekPrimaryCredential`, `validateAndFetchModels`, `latestRealtimeModel` | wizard, settings, start gate |
| languages | `languages`, `targetLanguages`, `resolveSourceLanguages`, `resolveTargetLanguages`, `reversesDirectionViaSourceLanguage` | settings, wizard, start gate |
| one leg's session | `buildSessionConfig`, `createClient`, `supportsWebRTC`, `forcedTransport`, … | MainPanel |
| across legs and time | `prepareToStart`, `acquireSessionResources`, `planBothMode` | MainPanel |

Six `ProviderConfig` fields have no reader anywhere: `apiKeyLabel`,
`apiKeyPlaceholder`, `requiresAuth`, and `supportsCustomEndpoint` with its label
and placeholder.

### The shape

```ts
interface Provider<S, K, C, R = K> {
  // identity and presence
  id: string                                // persisted; ProviderId is derived from the registry
  kind: 'own-key' | 'managed' | 'local'
  platforms: Platform[]                     // 'electron' | 'extension' | 'web'
  flagged?: true                            // hidden in production unless listed (D19)
  icon: Icon; docs?: string; vendor?: string

  // settings — never secrets
  settings: { key: string; defaults: S; migrate?(stored: unknown): S }
  Settings: ComponentType<{ settings: S; update(patch: Partial<S>): void }>
  Engine?: ComponentType<{ settings: S; update(patch: Partial<S>): void }>   // model management, shown in Simple mode too; the local engines only

  // credentials — stored apart from settings
  credentials: {
    keys: string[]                            // every key fields() can return; all load at startup
    fields(s: S): CredentialField[]
    read(values: CredentialValues, ctx: AuthContext): R | { missing: string; code?; params? }   // values: exactly fields(s)
    choice?: {                                // which fields show (F4)
      setting: string                         // a field of S
      options: { value: string; labelKey: string }[]
    }
  }
  check(r: R, s: S, { pair, legs, signal }): Promise<{ ok: true; models?: ModelOption[] } | { ok: false; reason: string }>   // legs: those a run would open; signal: aborts with its start
  checkReads?: readonly (keyof S & string)[]   // the fields check reads; an edit to any other keeps its answer (absent: every field)

  // languages
  languages: {
    // context: { speech } — whether the run would speak; absent, the widest offer
    sources(s: S, context?: LanguageContext): LanguageOption[]          // includes 'auto' when the provider detects
    targets(source: string, s: S, context?: LanguageContext): LanguageOption[]
    initial?(s: S): Partial<LanguagePair>   // when nothing is stored; today's per-slice defaults
    reverse?(pair: LanguagePair, s: S): LanguagePair | null   // the pair the other way round; absent: the plain swap; null: none
  }

  // the only capabilities generic code reads
  speech: 'always' | 'optional' | 'never'
  textInput(s: S): boolean                 // a function of S since Gemini's Live Translate (below); was `textInput: boolean`
  boundaries(s: S): 'provider' | 'silence'
  turns(s: S): Array<'auto' | 'manual'>    // both for everyone (D25, OpenAI over WebRTC manual only, closed 2026-09-29)
  participantSpeech?: boolean              // false: the participant never speaks (a flag, off for Kizuna Soniox until par_tts)

  // one leg's session
  build(context: SessionContext, s: S, shared: SharedSettings): C | { refused: string }
  describe(c: C): { asrModel?: string; translationModel?: string; ttsModel?: string }
  start(request: { context: SessionContext; config: C; credentials: K; clock: Clock; signal: AbortSignal }, events): Promise<Session>

  // across legs and time — optional; see Session lifecycle
  session?: SessionHooks<S, K, C>
}
```

**Amended by the Stage 2 foundation plan:** `i18nKey?`; `testerSwitch?`;
`settings.legacyKeys?` and `migrate(stored, { legacy, credentials })`;
`languages.migratePair?`; `credentials.read` → `K | { missing; code?; params? }`;
`AuthContext.userId?`; `SettingsProps.models?` / `account?`;
`SharedSettings.models`; and `SessionHooks.acquire`'s context carries the run's
`clock`.

**Amended by the Stage 2 Soniox plan:** `SettingsProps.preview?` (the
voice-preview route) and `legs?`; `AdapterEvents.speechRanges`; `LegStartError`.

**Amended by the Stage 2 Kizuna Soniox plan:** the read type `R` (a managed
`read` answers the sign-in; `managed.ts`'s `ManagedSignIn`);
`participantSpeech?: boolean`; `AuthContext.loaded?`;
`SessionHooks.minimumBalance`; `Resources.budget` as `{ totalMs, endsAt }`;
`acquire`'s context `{ signal, clock, end(notice, { expected? }), frame(frame) }`;
`degraded`'s `reason?`; `RunShape.account?`; `RunState.running.budget?`.

**Amended by the Stage 2 Gemini plan:** `SharedSettings.instructions` is
removed — a provider that sends system instructions owns them in its `S`
(`src/lib/provider/instructions.ts`: `InstructionsSettings`,
`resolveInstructions`, `migrateInstructions`); `settings.legacyKeys` may name a
whole storage key (`settings.common.…`), read at that key and never written.

**Amended by the Stage 2 Volcengine AST2 plan:** the language functions take an
optional `LanguageContext`; `credentials.choice` names a setting that decides
which credential fields show (`CredentialChoice`, its `setting` typed `string`,
a field of `S`).

**Amended by the Stage 2 OpenAI Translate plan:** `speech: 'optional'` also
describes a provider whose API cannot stop speaking: OpenAI Translate always
produces translated audio, and bills it, so a leg that does not speak receives
it and drops it in the adapter — Text only then changes playback and nothing
else (ruling 4).

**Amended by the Stage 2 OpenAI Realtime plan:** `checkReads?` — the settings
fields a provider's `check` reads, so an edit to any other keeps the readiness
answer ("Readiness is one check"; ruling 9).

**Amended by the Stage 2 Palabra plan:** `languages` has a third optional
member beside `initial?` and `migratePair?`: `reverse?`, the pair the other way
round — the participant leg's direction and the swap button's result, read
through `reversedPair` (`src/lib/provider/languages.ts`), the plain swap where
it is absent, `null` for a pair with none; whether the answer is offered stays
the two lists' to say ("The participant rule (D20)"; ruling 9, choice 3).
`start`'s request has no `input`: the native-track seam is deleted
("Capture belongs to the runner"; ruling 16). This listing had `input`
required; the code had it optional, and no adapter read it.

**Amended after the Stage 2 translation cuts plan** (the owner's decision,
2026-09-30): `textInput(s: S): boolean`, a function of the settings as
`boundaries` and `turns` are, where it was a flat `boolean`. Gemini's Live
Translate ignores typed text (the owner's live test) while its dialogue models
answer it, so Gemini returns false for a Live Translate model — and for no
model chosen, which reads as Live Translate, as its language offer does — and
the box is hidden there, as on every other continuous interpreter. The run
asks with its frozen settings before it sends; the panel asks with the stored
ones, which are the run's while it is live (the provider's settings are locked
then).

`settings.key` is today's slice key, and values persist under
`settings.<key>.<field>` exactly as now: no user's saved settings move.

`shared` is what a builder may read beyond its own settings — the segmentation
pauses and display cut, which direction is the participant's, and the models
the last check listed — so a builder never reaches into the settings store.
System instructions are not shared: every model family has its own instruction
style, so a provider that sends them owns them in its `S` and edits them in its
own `Settings` through `InstructionsField` (Stage 2 Gemini, ruling 4). A
provider's own stores are its own business: the local builders read their model
stores, which is where model resolution belongs (never in the adapter).

`start` owns the transport. OpenAI's choice between WebRTC and WebSocket, and the
fallback from one to the other, become its business, so `supportsWebRTC` and
`forcedTransport` leave the contract. OpenAI Translate and OpenAI Realtime are
WebSocket only: the owner abandoned their WebRTC transport (2026-09-29),
neither migrated nor reimplemented, so neither `S` has a `transportType` — a
stored one is not read, and a profile that chose WebRTC runs over WebSocket,
as it already did — and each `C.transport` is the literal `'websocket'`, which
`info.transport` reports to analytics (Stage 2 OpenAI Translate, ruling 1,
choice 15; Stage 2 OpenAI Realtime, ruling 12, choice 18). Both ports first
kept `transportType` in `S`, read and not shown, as a WebRTC step's
attachment point; it went with the decision. Palabra's `forcedTransport:
'webrtc'` existed only to steer MainPanel's transport switch, for an old
client that always used LiveKit; its port is WebSocket, written from scratch
(Stage 2 Palabra, ruling 19), and imports no LiveKit.

**What else is provider-specific and sits in MainPanel today** goes into the
adapter: OpenAI's drift anchor — an out-of-band, text-only `createResponse`
re-sending the instructions at session start and every five completed
responses (`MainPanel.tsx:4245-4325`), which only the adapter can count — and
the `response.created` / `response.done` bookkeeping behind `isAIResponding`,
which is what `busy` reports. Both landed with OpenAI Realtime's port, the
anchor as parity: out of band (`conversation: 'none'`), text only, carrying
the leg's instructions when they are not blank, sent at `session.updated` and
after every fifth in-band response completed, and framed with its usage; its
output makes no segment and is not `busy`, and it neither waits for the
typed-text queue nor makes anything wait (Stage 2 OpenAI Realtime, ruling 2,
choice 11). What it steers is unmeasured — the API keeps an out-of-band
response out of the conversation (survey §3.7.4) — and the owner's live test
is the evidence (the roadmap's OpenAI Realtime record, item 4). `busy` follows
the in-band responses, and nothing reads it (ruling 8).

**A hybrid pipeline is a provider, not a new layer.** The note that Local Native
grows into an orchestrator mixing local and cloud stages describes a definition
whose adapter composes stage clients internally; `describe()` already names the
three stages. L0 never learns what a stage is.

### Where each member goes

| Today | Becomes |
|---|---|
| 19 settings-UI capability fields, `voices`, `models`, `noiseReductionModes`, `transcriptModels`, `reasoningEfforts` | the provider's own `Settings` component |
| `pushGatedModes`, `pttFinalization`, `turnDetection.modes` | deleted (D14) |
| `buildParticipantSessionConfig` | deleted (D17) |
| `supportsWebRTC`, `forcedTransport`, `usesLocalPromptTemplate`, `queuesTextWhileResponding` | internal — `S` → `C`, or the adapter |
| `languages`, `targetLanguages`, `resolveSourceLanguages`, `resolveTargetLanguages`, `reversesDirectionViaSourceLanguage` | `languages.sources` / `targets` |
| `credentialFields`, `credentialFieldsFor`, `extractCredentials`, `peekPrimaryCredential` | `credentials.fields` / `read` |
| `validateAndFetchModels`, `latestRealtimeModel`, the store's model auto-select switch, its readiness short-circuits for the local engines | `check`, plus an internal effective-model function |
| `capabilities.segmentation` `{ pause, auto, sizes }` | `boundaries(s)` |
| `textOnlyCapability`, `supportsTextInput` | `speech`, `textInput` |
| `settingsSliceKey`, `i18nKey` | `settings.key`; locale keys use the id, or `i18nKey` where the catalogs spell it otherwise |
| `createClient`, `buildSessionConfig` | `build` + `start` |
| `prepareToStart`, `acquireSessionResources`, `planBothMode` | `session.prepare` / `acquire`; `planBothMode` folds into `startBoth` (see Session lifecycle) |
| the six unread fields, `registerProvider`, the `ClientFactory` and `ClientOperations` façades | deleted |

### Settings belong to the provider (D18)

`ProviderSpecificSettings.tsx` is one 2,291-line component. About 692 lines are
sections gated on capability flags. About 1,092 are per-provider render
functions — Gemini, Palabra, the AST2 family, the Soniox family, both local
engines — for what the flags could not express. The rest routes writes back to
the right slice through an eleven-branch if-chain, a "compatible settings"
accessor and exclusion lists (`provider === PALABRA_AI`, Gemini's translate
model, the local engines, the Soniox family).

Each provider now owns a `Settings` component, composed from shared field
components (`VoiceField`, `ModelField`, `InstructionsField`, …) and handed its
own typed `S`. The flags, the routing and the exclusion lists disappear; OpenAI
Live's component is about 25 lines.

The alternative — a declarative field description drawn by one renderer — was
rejected. The Soniox voice library (906 lines) and the two local model managers
(843 and 1,036) need escape hatches, and today's flags are that design in
embryo, already carrying 1,092 lines of them. Consistency between providers
comes from the shared field components.

Simple mode needs none of this. `SimpleSettings` renders the generic sections —
languages, segmentation, the provider row with its credentials, the two device
sections, system audio, help — and the one provider-specific thing it shows is
the local engines' model management, opened from the provider row. That is the
`Engine` slot, which only the two local providers fill.

### Credentials are not settings

Credential fields move out of `S` into their own record, persisted under the same
keys as today. One credential form, driven by `credentials.fields(s)`, serves the
setup wizard (already generic) and the settings panel (hand-written today: the
`updateApiKey` switch with eight cases, about 120 lines of AST2 and Palabra
credential markup, the compatible provider's endpoint input).
`keys` names every field `fields` can ever return, so all of them load at
startup: Soniox shows one of three region keys, and a region switch must not
wait on storage. `read` sees the values of exactly the fields `fields(s)`
returns, which is how it knows the region's key without reading `S`.
A provider whose credentials come in more than one shape declares
`credentials.choice`: a setting of `S` that both credential forms — the
settings panel's and the setup wizard's — draw above the fields as one
segmented control (`CredentialChoiceControl`), clearing no credential. The
panel writes a pick as any settings edit; the wizard holds it in its draft,
shows and checks that shape's fields, and writes it at Finish before the
credentials. Doubao AST 2.0's App ID + Access Token or API key (Stage 2
Volcengine AST2, ruling 1) is the first, Palabra's platform or app next.
`peekPrimaryCredential` becomes "does `read` succeed", and `neverPersist`
disappears — a managed twin has no credential fields to persist. With no secrets
in `S`, settings can be mirrored and logged without redaction; `K` is the one
thing to redact.

### Readiness is one check

`check(r, s, { pair, legs, signal })` answers "can this provider start now" for
every kind: a network validation for own-key providers, model readiness for
local ones (folding in the store's two short-circuits to `modelStore` and
`nativeModelStore`), a static yes for managed ones (below). The sign-in itself
is `credentials.read`'s to see: a managed provider signed out answers
`{ missing, code: 'sign_in_required' }` there, and `check` is never called.
While the sign-in is still loading at launch, `read` answers `sign_in_pending`
(`AuthContext.loaded`), so a signed-in user is never told to sign in. A managed
`check` is static: the balance is the start gate's input (`RunShape.account`,
the account's wallet as the client knows it), never readiness. While signed
in, a wallet still loading answers "Checking..." and one that failed to load
refuses Start, as the old gate did; the account side re-fetches it when the
network returns and on a short back-off. The lease's 402 still words a balance
that changed after the fetch. `check`'s result goes to one generic
per-provider readiness state.

**`check` bounds its own request** (amended by the Stage 2 foundation plan's
final review). A check that cannot find out within its provider's own limit
throws, as it does offline; the store then answers not-ready, and Start says
why. Without the limit, a request that never settles leaves the provider
`checking` and Start off with no words.

**When checks run** (the app's readiness driver, `src/app/readiness.ts`): only
while the runner is idle — a change seen mid-run is checked once idle again. A
local provider is checked 150 ms after any change, and whenever its own inputs
change (`watchReadiness`: models downloading). An own-key or managed provider
whose readiness is unknown is checked at once when it is selected or its entry
loads; after an edit to its settings, credentials or pair, 800 ms after the
last one. A sign-in or account flip — the sign-in finishing loading included —
forgets every loaded managed provider's readiness and checks the selected one
at once; an own-key provider's answer does not depend on the sign-in. The last
ready answer from a network check is kept with its settings, credentials, pair
and legs — and, for a managed provider, its sign-in and account — so asking
again for exactly those inputs costs no request. Nothing account-mutable, a balance above all, may live in a
ready answer: signing out and back in to the same account is served from it.

**A check says what it reads** (Stage 2 OpenAI Realtime, ruling 9). A
provider may list the settings fields its `check` reads in `checkReads`. An
edit to any other field keeps the answer — readiness stays ready, so the
driver checks nothing and Start stays on — unless the edit moved the run's
pair, which every check reads; a ready answer kept is keyed on the listed
fields alone. A refusal, or a check that threw, stands through such an edit
too; Validate asks again. A credential edit forgets the answer as before.
Absent, every field counts, as before. OpenAI Realtime's model list reads none
(`[]`); the other ported providers are candidates. Palabra's check lists the
REST sessions (`GET /session-storage/sessions`, bounded at 15 s, per
credential mode; nothing is created or billed) — not the socket, whose refusal
a browser cannot read — and declares `checkReads: ['authMode']`: the first
provider whose credential fields depend on a setting to declare it, and that
setting the one field its check reads, so a slider or a switch keeps Start on
(Stage 2 Palabra, ruling 1; choice 16).

The store's model auto-select, a switch covering three providers, becomes a pure
effective-model function inside each provider that offers a model choice: the
saved model if the check found it, otherwise the newest; while no check has
listed any model, the saved one — none on a fresh profile, which the builder
refuses (`models_required`), though a run builds only after a ready answer,
whose list is never empty (Stage 2 Gemini, `effectiveGeminiModel`). Gemini's
default is the newest listed Live Translate (Stage 2 Gemini/AST2 follow-up,
ruling 3; choice 8), else the newest native-audio dialogue model — by family
(`major.minor`, a missing minor read as 0: Google spells some ids `gemini-3-…`),
then the id's `-MM-YYYY` date, a dated id before an undated one (Stage 2 Gemini,
ruling 2) — else the newest listed. Nothing is migrated: a saved model the
check lists stays. OpenAI Realtime runs the saved model when the check listed
it, else its default model (`gpt-realtime-2.1-mini`) when listed, else the
list's newest `created`, and the saved one while nothing is listed yet
(`effectiveRealtimeModel`); its old one-time model migration is not ported
(Stage 2 OpenAI Realtime, ruling 5, choice 4). The provider's settings
component and its builder call the same function, so nothing writes back.

The local engines' `prepareToStart`, which only re-validates, disappears: the
lifecycle runs `check` at start for every provider, a ready answer cached for the network ones.

### Languages are two functions

`sources(s)` and `targets(source, s)` replace five members, LanguageSection's two
per-provider switches (about 150 lines), its swap special cases and its
hard-coded `auto` option. What is provider-specific moves inside the two
functions. AST2's `zhen`, both-or-neither, is `targets('zhen')` returning only
`zhen` and every other source's targets omitting it. The local engines'
catalogue-driven lists are simply their implementation. `auto` is in `sources`
for providers that detect. A swap is generic: allowed when the reversed pair is
supported — the provider's own reverse where it states one (Stage 2 Palabra,
ruling 9; "The participant rule (D20)").

The offer may depend on whether the run would speak. Doubao AST 2.0 speaks
eight languages and transcribes twenty and two dialects, so its functions take
a `LanguageContext` (`{ speech }`), which `languageContext` derives from the
legs and the speech inputs by `contextsFor`'s own rule. Without one a provider
answers its widest offer. The provider store keeps the pair the user left
within the widest offer and derives the pair a run starts for the store's
context, writing nothing when the context changes: switching text only off and
on loses no pair (Stage 2 Volcengine AST2, choice 1). AST2's second rule,
Chinese or English on one side of every pair in both modes, is its `targets`: a
source other than Chinese or English targets English and Chinese only, and a
dialect is a source only. Picking `zhen` from the target side, which the old
sync allowed, has no place in two functions.

**The offer may depend on the settings too** (Stage 2 Gemini/AST2 follow-up,
ruling 6; choice 16). Gemini's follows the saved model's family: a dialogue
model offers the Live API's 99 languages both ways; Live Translate its 78 as
targets, and those and the 99 as sources — 101, Javanese and Sundanese being
its own two — since it detects the source, which still decides Both's
reversal and the rows' labels. No model saved reads as Live Translate, the
default. A Live Translate source outside its 78 refuses the participant leg by
D20's generic rule. A Live Translate target outside its 78 — possible when a
saved dialogue model the check no longer lists runs as the default — is
refused at build in words ("Live Translate does not translate into Faroese:
choose another language, or a dialogue model."; choice 18). The functions see
`S`, not the check's list, so a key that lists no Live Translate, with no
model saved, runs a dialogue model on Live Translate's offer until another
model is picked.

This fixes a live inconsistency. The wizard asks the local descriptors for
targets, which return the source list; the settings panel asks the translation
catalogue. The two show different target lists for the same provider.

The pair stays stored per provider. Its default moves with it: `languages.initial`
gives the pair a provider starts from when nothing is stored, which is how
today's per-slice defaults (LocalInference ja→en, AST2 zh→en, …) survive the
move. A stored side the offer no longer holds takes `initial`'s through
Gemini's `migratePair`, which converts nothing and runs on every load (Stage 2
Gemini/AST2 follow-up, choice 17): a Gemini pair saved before the rebuild
falls to English → Japanese, except a side stored as `pt-BR`, the one old
code Google still documents; nothing is written, so it falls on each load
until re-picked — a stated departure for the release note. A model switch
that narrows the offer falls to the list's first entry by the generic rule
(`normalizePair`), English, even to English → English. Codes differ between
providers — Gemini's Google-documented `en`, `ja`, `zh-Hans`, `pt-PT` (badges
"JA", "ZH-HANS"; the subtitle bar reads "ZH"; Stage 2 Gemini/AST2 follow-up,
ruling 6), Palabra's `en-us` and `zh-hant`, AST2's `zhen` — so
one global pair would need a canonical code and a mapping per provider: a
product change this design does not need.

**The participant rule (D20).** The participant leg opens when the pair's
reverse is offered in the participant leg's own language context: its source
among `sources`, and its target among that source's `targets`. The reverse is
the provider's own where it states one (`languages.reverse`), else the plain
swap, the speaker's target and source (Stage 2 Palabra, ruling 9; choice 3;
this paragraph first named the plain swap alone). `auto` never reverses: it is
never a target for the swap, and a provider's own reverse gives none —
`reverseSupported` refuses an `auto` source before it reads the hook
(`c0e57e5d`) — so an `auto` source refuses the participant leg for every
provider. Today OpenAI Live,
Gemini's translate model and Soniox refuse it at the start gate through
`reversesDirectionViaSourceLanguage`. Every other provider starts the leg, and in
template mode its prompt asks for a translation into the raw string `auto`,
because `auto` is in no language list (`settingsStore.ts:1437-1446`). Only an
advanced-mode participant prompt that names its own language made the
combination work; that use goes. The advanced-mode participant prompt itself
stays, as the prompt for the reversed direction: the provider's own
`participantSystemInstructions`, resolved by `resolveInstructions` for the
participant's direction, and the builder still sees only a direction.

One door, `reversedPair` (`src/lib/provider/languages.ts`), answers the swap
button, the participant's direction (`contextsFor`) and
`SharedSettings.reversed` (`buildSharedSettings` is handed the participant's
direction, not the pair), and the gate's refusal names the pair it checked
("has no reverse of X → Y", or "does not offer X → Y"). Palabra reverses by
its documented codes (Stage 2 Palabra, ruling 9): a target by its
`to_source` (`en-us` → `en`), a source by its `to_target` (`en` → `en-us`),
and a `to_target` the docs hide by the first offered target of its source
(`zh` → `zh-hans`; choice 5); a pair either side of which has none — the
targets `az`, `bs`, `fil`, `is`, `kk`, `mk`, `sr` and the sources `bn`, `eu`,
`fa`, `ga`, `mn`, `mr`, `mt`, `ug`, `yue` — refuses Both in words. A provider
with no reverse of its own offers no target outside its sources, in every
settings shape its offer reads and every language context — a registry
invariant over the shapes it declares by name (each provider's defaults, and
Gemini's three, whose offer reads its saved model; choice 3), so the plain
swap reverses what the provider offers, and a provider that ever breaks it
must state its own.

### Segmentation is one fact

The offer's three booleans become `boundaries(s)`: who ends a segment. Where the
provider does (`'provider'`), the user may keep its boundary — Auto. Where our
own silence timers do (`'silence'`: OpenAI Translate, OpenAI Live, Gemini) — for
Gemini as parity with the old offer: its dialogue segments end at
`turnComplete`, and only Live Translate's end on our timers — the user tunes the
pauses. On OpenAI Translate and Live Translate the source's segments end on its
timer and the translation's where its source's did; the translation's own pause
only settles it — at a sentence end, or 5 s after its last activity
mid-sentence once its stream has shown a sentence end, never into a script that
writes no sentence-final mark — and bounds how long a closed source's cut waits
for a translation to begin (Stage 2 translation cuts, ruling 1; choices 6, 8).
Cutting into a number of sentences is available
everywhere: rows tile the segment's text and a `range` survives a cut, so the
reason OpenAI's descriptor withheld it — splitting an item would strand its
karaoke timing — no longer holds. It takes `S` because the answer can depend on
a setting. OpenAI Translate's is `'silence'`, through the segment machine its
WebSocket port built — its one transport since the owner abandoned WebRTC
(2026-09-29), where a WebRTC step was first to feed the same machine
(Stage 2 OpenAI Translate, choice 4; survey §3.6.5).

### Managed twins are composition

A Kizuna twin is `managed(base, overrides)`: its own `id`, `kind: 'managed'`,
`vendor`, credentials read from the sign-in session with no fields, a static
`check`, and per-leg keys minted by its lease (`acquire`). Its settings
component, languages, builder and adapter are the base's. The
`KizunaManagedProvider` union, `isKizunaManagedProvider`, `kizunaBaseProvider`,
`KIZUNA_HOSTED_ICONS`, `getDefaultManagedProvider`'s preference list and the
settings UI's active-slice ternaries reduce to `kind` and registry order. Only
Kizuna Soniox is built this way: the backend mints its keys per role, and the
audio goes from the device to Soniox directly. The relay twins, whose `K` was a
relay endpoint, are not ported (see Migration).

`managed(base, overrides)` lives in `src/lib/provider/managed.ts` and names
what a twin takes from its base — languages, capabilities, builder, adapter,
`startBoth`, turn detection, the settings' defaults and migration — and what is
its own: id, kind, vendor, icon, storage key, `Settings`, a sign-in `read`, a
static `check`, and its hooks, `acquire` required. The participant-speech flag
is the twin's own when it gives one, and otherwise the base's, so a base that
cannot voice the participant never yields a twin that does.
A twin's `read` answers the sign-in, a type of its own (`R`); its `start`
receives the keys its lease mints (`K`). It inherits neither the base's guide,
locale key nor presence knobs.

### The registry is a list (D19)

One ordered array is the registry. Its order is the UI order, and `ProviderId` is
derived from it; `platforms` and `flagged` decide presence. The five
per-provider flags — Kizuna Soniox, Kizuna OpenAI Translate, Kizuna AST2,
Palabra, Local Native — each need `environment.ts`, `extension/vite.config.ts`,
five env blocks in `.github/workflows/build.yml` and the forwarding consistency
test; the own-key AST2's `VITE_ENABLE_VOLCENGINE_AST2` is a sixth, dead since
`cec1556c` — nothing reads it, though `build.yml` and
`extension/vite.config.ts` still forward it — and the new registry ships AST2
unflagged (Stage 2 Volcengine AST2, ruling 5), and Palabra unflagged, last,
its flag going with its old code (Stage 2 Palabra, ruling 14); they become one
`VITE_ENABLED_PROVIDERS` list of flagged provider ids. The Kizuna umbrella
flag stays, since six other sites read it, and a managed provider
needs it as well. The `debug:local-native` switch stays until Local Native ships.

The registry test's seven `Record<Provider, …>` tables go with the capabilities
they pin. What remains are invariants checked over every registered provider.

### One leg only

`build` is called once per leg (D17), so whatever spans both legs or outlives one
call is not the definition's. These go to session lifecycle:

- the local engines' memory budget, which counts the speaker leg's models with
  the participant's (`localParticipantConfig.ts:96`);
- Soniox's shared Both;
- the managed Soniox lease and voice claim (`acquireSessionResources`,
  `prepareToStart`);
- the devices a WebRTC adapter captures from and plays to (`webrtcOptions`
  carries the input device and, for echo cancellation, the output device) —
  no adapter's since the owner abandoned OpenAI's two WebRTC clients, its
  only users (2026-09-29).

### Sockets that need upgrade headers

Browsers cannot set WebSocket upgrade headers, so each platform injects them, by
different mechanisms:

| | Electron | Extension |
|---|---|---|
| mechanism | main-process `onBeforeSendHeaders` | `declarativeNetRequest` dynamic rules, in the background worker |
| life | per host and path, **one-shot** — the next upgrade under the path consumes it; a rule with no path, the whole host, as before (Stage 2 OpenAI Live, choice 2) | **persistent** until cleared — the seam clears it once the upgrade is made, and the worker sweeps its range, and the old Live rule 4000, at start (Stage 2 OpenAI Live, choice 3; ruling 11) |
| who can hit it | the app's own renderer | any page in the browser, unless the rule sets `initiatorDomains` |
| constraint | one listener per session, shared with Better Auth's cookie injection | `host_permissions` must list `wss://` explicitly, or Chrome ignores the rule silently |

Every extension rule rewrites request headers; none touches response headers.

**The AST2 rules expose the user's keys.** They (`background.js`: ids
2000–2003 set, 2000–2009 cleared; dynamic rules outlive a browser restart until
cleared, survey §3.6.4) set no `initiatorDomains` and stay installed for the
whole session, cleared on disconnect (`VolcengineAST2Client.ts:1008-1010`).
While an AST2 session runs, any page that opens a socket to
`openspeech.bytedance.com` has the user's App Key and Access Key injected: the
page cannot read them, but its connection is authenticated, and billed, as the
user. OpenAI Live's and Bing's rules set `initiatorDomains`, and Live's is
removed once the session has started; the generic pair's rules
(`WS_HEADERS_SET`) set it too, answer only the extension's own pages — their
base read from `chrome.runtime.getURL('')` — and are removed as soon as the
upgrade is made (Stage 2 OpenAI Live, choice 3). The ported provider installs none; the
old block goes with the old client (the Stage 2 Volcengine AST2 plan's deletion
plan, V2).

What unifies is the interface a client sees, not the mechanism:
`OpenHeaderSocket(url, { set, remove }, { signal, clock }) → Promise<WebSocket>`
(`src/lib/contract/headerSocket.ts`), one registrar per platform — asynchronous,
since Electron's registration is an IPC round trip and the extension's a
runtime message. Electron keeps its one-shot rule; the extension implementation always scopes by
`initiatorDomains` and path, and clears as soon as the upgrade completes. Clients
stop pairing register and clear calls around a `headersRegistered` flag, the AST2
exposure closes by construction, the background worker's per-provider blocks and
message pairs collapse to one, and two legs opening the same host and path are
serialized in the seam itself, process-wide in the renderer, each rule cleared
before the next leg registers — a registration that never answers is cleared
at the holder's own 15 s bound and lets the next leg go, each platform's
channel being ordered (Stage 2 OpenAI Live, choice 1). Today the legs connect one after the other
(`MainPanel.tsx:2463`, then `:2753`), so nothing collides yet; a per-host
register/clear pair would, the moment the legs come up together.

Gemini's key rides in the socket's query: it needs no header. Nor does Doubao
AST 2.0's. Its endpoint takes the credentials in the query — `api_resource_id`
with `api_app_key` and `api_access_key`, or `api_key` — as the owner's probe
measured on 2026-09-28; a wrong credential answers HTTP 401 before the upgrade,
which a browser cannot read, so the adapter words a socket that never opened as
the credentials while online (Stage 2 Volcengine AST2, ruling 2). AST2 is
therefore not the seam's first user: OpenAI Live is, and the plain `socket.ts`
of Soniox, Gemini and Doubao move to `src/lib/contract/` with it. (Amended
below: the plain copies moved without it, at Palabra.)

Nor does OpenAI Translate's. Its key rides in the
`openai-insecure-api-key.<key>` WebSocket subprotocol, which a browser sends
itself as `Sec-WebSocket-Protocol` on every platform, so it needs neither a
header seam nor an ephemeral token; a key that is no valid subprotocol token
makes the browser's `SyntaxError` quote it, so its seam rethrows in fixed words,
and `redact()` masks the subprotocol (Stage 2 OpenAI Translate, ruling 16,
choice 3). When OpenAI Live makes the seam's first use, its Electron rule
scopes by path: the rule is per host and one-shot today
(`electron/main.js:1113-1133`), so a stale Live rule for `api.openai.com` would
reach a Translate upgrade. **Done** by the Stage 2 OpenAI Live plan (choice 2):
`electron/ws-header-rules.js`, the longest path winning; Edge TTS and the old
AST2 client, which send no path, keep a host-wide rule.

Nor does OpenAI Realtime's: the same subprotocol, read in one function of its
wire, through its own seam in fixed words (Stage 2 OpenAI Realtime, ruling 25,
choice 7; survey §3.7.6). The stale-rule hazard above reaches its upgrade as
well, on the same host.

Nor does Palabra's. The platform key, or a REST session's publisher token,
rides the query's `token`, which `redact()` masks, with a bare `plbr_…` key
and a JWT masked whole as nets (Stage 2 Palabra, choice 10); a wrong key is a
bare 403 on the upgrade, which a browser cannot read, so the adapter words a
socket that never opened as the key while online (choice 8), as Doubao's
does. The plain seam the four copies held now lives in
`src/lib/contract/socket.ts`, lifted at its fifth user (choice 1):
Gemini's, Doubao's, OpenAI Translate's and OpenAI Realtime's `socket.ts`
re-export it, each keeping the `OpenSocket` type its adapter calls, and it
rethrows a refused socket in fixed words; Soniox's seam stays its own. F14,
the header seam, joined it there, built by the Stage 2 OpenAI Live plan
(ruling 7; choices 1–3): `headerSocket.ts` and its fake `fakeHeaderSockets`,
Electron's `ws-header-rules.js`, and the extension's `WS_HEADERS_SET` /
`WS_HEADERS_CLEAR` (`wsHeaderRule.js`). Its first user needs
`Authorization: Bearer` set and `Origin` removed (U9).

### Persisted settings that move

Storage keys stay, but five things change meaning. A provider's own values are
migrated as they are read at load (`settings.migrate`, with `legacyKeys`, the
credentials and `migratePair`); nothing is written back, so they stay as they
were and every load migrates them again. The global turn mode is the
exception: it is migrated once from the old slices and written to its own key,
`settings.common.turnMode` (1e-3 ruling 3); later loads read that key.

| Setting | Today | Becomes |
|---|---|---|
| turn mode | `turnDetectionMode` in six slices, with the values `Normal`, `Semantic`, `Disabled`, `Push-to-Talk`, `Push-to-Translate`, `Auto` (D15) | one global mode — `Push-to-Talk` / `Push-to-Translate` map to themselves, everything else to auto — and OpenAI's `Normal` / `Semantic` stay its `turnDetectionMode` (Stage 2 OpenAI Realtime, ruling 5) |
| credentials | fields inside each slice (`apiKey`, `appId`, `accessToken`, `clientId`, `clientSecret`, region keys) | the same keys, read into the credential record instead of `S` |
| `keepReplayAudio` | a client option every client is handed | L1's retention switch (D26) |
| transport | `transportType` in the OpenAI slices, with `forceWebrtcTurnDetectionOff` rewriting the turn mode | not read: the owner abandoned OpenAI's WebRTC (2026-09-29), so neither `S` has the field and the rewrite has nothing to do (D25 closed); every session runs over WebSocket, as a stored `webrtc` already did (Stage 2 OpenAI Translate, ruling 1; Stage 2 OpenAI Realtime, ruling 12). The first design kept it in `S` and made the rewrite `turns(s)` |
| system instructions | one global copy, `settings.common.useTemplateMode` / `systemInstructions` / `participantSystemInstructions` | each provider's own three fields, each read from the provider's key once written and otherwise from the global key (a `legacyKeys` entry naming the whole key); nothing moves, and the global copy stays for the providers not yet ported |

`bothModeSharedSession`, the segmentation settings and the display settings do
not move.

OpenAI's temperature leaves its `S` (Stage 2 OpenAI Realtime, ruling 6): the
GA session takes none, so it is neither shown nor sent, and its stored value
is left in place, unread.

Palabra's `authMode` and pair codes move with nothing converted (Stage 2
Palabra, rulings 2, 20): a profile with no stored `authMode` — every one
saved before 2026-07-30 — opens in the platform mode, and one click on the app
pair's option reads its stored pair again; a stored `ba`, `eo` or `ia` source
falls to Auto-detect (the first source), which also refuses Both; a stored
`vn` target, and the stored targets the documented tables no longer offer
(`zh`, `en-au`, `en-ca`, `bn`, `mr`, `fa`), fall to Arabic (the first
target) — each by `normalizePair`'s generic fall, nothing written. A stored
silence threshold under the API's 0.3 is sent as 0.3, and a stored max buffer
not above its target is raised above it, at use (ruling 10; choice 14).
F5's `legacyKeys` and `migratePair` stay for their users — the instruction
keys OpenAI Realtime and Gemini read, and Gemini's `migratePair` — no longer
named for Palabra, for which they were first built.

### What adding a provider then touches

1. One folder, `src/providers/<id>/`: the definition, the adapter, the `Settings`
   component, tests.
2. One line in the registry, one in the order test.
3. `providers.<id>.name` and `.description` in the 30 locale catalogs — or under
   the definition's `i18nKey` where the catalogs already spell it otherwise.
4. The extension manifest, when the provider uses a new host — MV3 declares hosts
   statically — none for Soniox, whose twelve origins the manifest already
   lists, or for Gemini, whose origin the manifest's CSP already lists, or for
   Doubao AST 2.0, whose host and CSP origin the manifest already lists
   (`manifest.json:37, 116`), or for OpenAI Translate, whose
   `wss://api.openai.com/*` host and CSP origins the manifest already lists
   (`manifest.json:38, 116`), or for OpenAI Realtime, the same host and
   origins (`manifest.json:38, 116`), or for Palabra, whose `https://*.palabra.ai`
   and `wss://*.palabra.ai` the manifest's CSP already lists
   (`manifest.json:116`) — its REST calls are plain CORS [inf: live-test
   item 3, the roadmap's Palabra record].
5. When it is flagged, its id in `VITE_ENABLED_PROVIDERS` at release.

For OpenAI Live it was its folder, one registry line, two order tests and its
row in the session-side guard's test (`sessionSide.consistency.test.ts`); no
locale key and no manifest change (`manifest.json:38, 116` already list its
host and CSP origin). What else it touched was first-user work, not a
provider's cost: F14 (the seam and its fake, Electron's rules, the extension's
pair), the OpenAI helpers lifted at their third user, three members of the
translation cuts module and the replay harness's stamps (Stage 2 OpenAI Live,
choices 1–5, 18).

---

## Session lifecycle

### A function, not an object

A session today is the execution of `connectConversation` (`MainPanel.tsx`,
1,181 lines, 22 steps, legs connected strictly one after the other) and of
`disconnectConversation` (16 steps). Its state is spread over **40 hooks** in
MainPanel — 13 `useState`, 27 `useRef` — plus 10 fields of `sessionStore`, and
start and stop coordinate through four refs (`connectInProgressRef`,
`disconnectInProgressRef`, `disconnectDoneRef`, `startAbortRef`).

Rollback exists as **five hand-written lists** — Stop, the outer `catch`, the
no-channel guard, the pre-activation bail, the participant `catch` — and each
forgets something different: the no-channel guard leaves the system-audio
source connected, the pre-activation bail leaves the channel flags set for the
next session, the participant `catch` leaves a connected client in its ref.

Three surveys of start, runtime and teardown, and of the managed lease, list
about 45 defects. They share four causes:

1. **Nothing represents "this session".** A cancel pressed while Start waits for
   the previous Stop is dropped and the session starts anyway; a second Stop
   returns without waiting for the first; a double tap on Stop starts a new
   session; Start never re-checks the gate; an Electron close during startup
   neither waits for it nor aborts it.
2. **Rollback is a list,** and every failure path guesses which earlier steps
   ran.
3. **Cancel reaches few steps.** The abort signal is checked at five points. The
   lease acquire cannot be interrupted, and after a cancel the whole participant
   leg still runs, OS permission prompt included. Stop can post the lease's
   `session-end` while a leg is still opening, and that leg can post
   `session-started` afterwards.
4. **Ending has no contract.** OpenAI Compatible over WebSocket never reports a
   dropped socket (`OpenAIClient.ts` never subscribes to the library's `close`),
   the local engines never end a session on a worker or sidecar failure, an
   unplugged microphone is not noticed at all, and closing the extension side
   panel skips the whole teardown — no auto-save, no managed `session-end`.

### The runner

```ts
// a plain module, outside React
sessions.start(): Promise<void>
sessions.stop(reason): Promise<void>     // idempotent: every call returns the same promise
sessions.press() / release()             // what every surface emits (D14)
sessions.state                           // one store; the UI reads only this

type RunState =
  | { phase: 'idle'; lastEnd?: { reason: EndReason; notice?: Notice } }   // what the idle surfaces show
  | { phase: 'starting'; step: 'checking' | 'preparing' | 'opening'; loading? }
  | { phase: 'running'; since: number; legs: Record<Leg, LegState>; budget?: { totalMs; endsAt } }
  | { phase: 'stopping' }

type LegState = 'opening' | 'live' | 'reconnecting'
```

Every surface — the panel, the Electron subtitle takeover, the extension overlay
over its port — calls the same four methods. `sessionStore`'s
`startSessionVersion` / `stopSessionVersion` counters and the subtitle session
bridge that turns them into calls disappear, and so do `sessionStore`'s
`startSession`, `endSession`, `resetSession` and `incrementTranslationCount`,
which have no caller today.

### A run

Each start creates a run. It freezes a **shape** once — mode, languages,
`speech`, `turns`, and a snapshot of the provider's settings — and every later
step reads the shape, never the live stores. Today the mode alone is read from
three different snapshots during one start.

```
1. gate(shape)                        stores' refusals, the balance floor last
2. provider.check                     readiness; the local engines' re-validation
3. session.prepare?(shape, s, signal) managed voice claim → a run-only override
4. provider.build(context, S) per leg a refused leg fails the start (D22)
5. session.admit?(configs)            cross-leg: local memory, Local Native's single leg
6. the lease's release slot           when a lease follows                 defer(release)
7. every leg's source, when a lease   mic / system audio / tab             defer(stop)
   follows or startBoth takes both
8. session.acquire?(shape)            managed lease → one K per leg        into step 6's slot
9. the legs become the conversation
10. every leg, in parallel:
      openSource(leg), if not yet     (a provider with neither)            defer(stop)
      provider.start(request)         (or session.startBoth, below)        defer(session.stop)
      wire: source → turn gate → appendAudio; events → L1; audio → ClipQueue
11. every leg live → running. Any leg failing → unwind, the start fails (D22)
```

**Each resource is pushed with its release the moment it is acquired.** Stop,
failure and cancel are one path: abort the run's signal, then unwind the stack
in reverse, once, with a timeout on every release. The five lists become this
one.

**The signal reaches every step**, `acquire` and the local engines' check
included, so nothing opens after a cancel.

**Order removes the lease race.** The lease is minted after every source has
opened — a source that fails (a denied loopback, no bound tab, a capture helper
that will not start, a missing microphone) mints no key, and so leaves no
never-started lease that the backend's sweeps never reach and that 409-locks
the next Start until its initial expiry — and its release slot is reserved
beneath the sources, so a run unwinds its sessions, then its sources, then the
lease: capture has closed before `session-end` goes out. An `acquire` that
returns after a stop's bounded wait finds its slot already run and is released
at once. With the signal reaching every step, no leg opens after
`session-end`, and the lease drops any `session-started` a closing socket
would still report. A refused lease leaves the last conversation on screen:
the legs become the conversation only once it is held. `prepare` stays before
the sources: its override feeds the builds, which must refuse before anything
opens (Stage 2 Kizuna Soniox, ruling 9).

**Legs start in parallel**, roughly halving startup time. Two legs that open
their sockets through the header seam are serialized by it
(`src/lib/contract/headerSocket.ts`), per host and path; plain sockets dial in
parallel (Stage 2 OpenAI Live, choice 1; its survey §6 item 5).

**Settings are read once per run.** The snapshot removes the two expectation
guards (`expect`, `expectAtApply`) that exist today because settings could
change between `prepareToStart` and the connect. A patch that must persist —
managed voice prep's new voice id — is written only if the stored value still
equals the snapshot's.

### Legs rise and fall together (D21, D22)

**A session starts only with every leg it was asked for.** If any requested leg
fails to come up — a refused build, a denied loopback permission, a connect
that throws, a capture that will not open — the stack unwinds and the start
fails with one message naming the leg and the reason. Today a denied loopback
permission starts the session on the speaker leg alone with a warning; that
start now fails.

**A running session ends when any leg ends.** A leg ends when its adapter emits
`failed` or an unexpected `closed`, when its source ends (a microphone unplugged,
a tab closed, the app-capture helper died), or when a managed lease ends it
(budget exhausted, duration cutoff). The leg records why as a Notice on its L1
— a lease's end once, on the first leg: it covers every leg, and the same
sentence twice in Both says nothing more (Stage 2 Kizuna Soniox, ruling 7). A
notice recorded while `acquire`, or the other leg's source, is still opening —
a source that ends or degrades — lands on a conversation that is handed over
only if the start goes on to succeed; when it fails, the idle surface still
shows why, through `lastEnd`.

There is therefore no one-way state. `noChannelCameUp`, the pre-activation bail,
`splitDegraded` and its "One-way only" chip, and `speakerStreamEndedRef` /
`participantStreamEndedRef` all disappear. So does a live gap: in shared Both
today a failed far-end capture silently feeds zeros into the mix and shows
nothing.

**The contract rule this needs:** an adapter that can no longer work must say so,
with `failed` or `closed`. OpenAI Compatible over WebSocket and both local
engines break it today.

### Session hooks on the provider definition

```ts
interface SessionHooks<S, K, C> {
  prepare?(shape, s: S, signal: AbortSignal): Promise<{ override?: Partial<S>; persist?: Partial<S>; notice? }>
  admit?(configs: { speaker?: C; participant?: C }): true | { refused: string }
  acquire?(shape, s: S, ctx: { signal; clock; end(notice, o?: { expected? }); frame(frame) }): Promise<Resources<K>>
  startBoth?(requests: { speaker; participant }, events: { speaker; participant })
    : Promise<{ speaker: Session; participant: Session }>
  minimumBalance?(shape: { legs; textOnly; participantSpeech }, s: S): number
}

interface Resources<K> {
  credentials(leg): K                   // per leg: minted key, role, billing reporter
  budget?: { totalMs: number; endsAt: number }   // the grant: static, measured from acquire
  release(): Promise<void>
}
```

- **`prepare`** — the managed voice claim. `override` applies to this run only
  (the built-in voice when the clone is unavailable); `persist` is written back
  under the compare-and-set above.
- **`admit`** — cross-leg checks over the configs actually built.
  LocalInference sums the models of the legs that will run, TTS only when
  speaking; today it also counts the speaker leg's models in a participant-only
  session, and a TTS model the session will never load. **Local Native refuses
  two legs** until its sidecar keeps one engine per connection. Today the
  sidecar holds one process-wide engine per stage: the participant's
  `asr_init` evicts the speaker's model, both connections feed one ASR
  segmentation state, translation runs with whichever direction initialised
  last, and the first leg to close unloads the shared ASR. Two legs never
  worked; refusing them is honest.
- **`acquire`** — the managed lease. It returns **one `K` per leg**, carrying the
  minted key, the role and the collaborator the adapter reports billing events
  to, so `legClientOptions` and the Soniox-named `sonioxManaged` key leave
  generic code. It takes the run's signal and clock. `release` sends
  `session-end` with `keepalive` and the token cached at acquire, so
  `pagehide`'s synchronous release still reaches the backend; it retries a
  transport failure or a 5xx, three attempts at most within 4 s, and the next
  acquire cancels a release still retrying — `session-end` is scoped by
  account, and a late one would end the next lease. After a transport failure
  the rest of that release goes without `keepalive`: a runtime that refuses a
  keepalive request needing a CORS preflight fails it that way, and a plain
  request still reaches the backend on a normal Stop. `session-end` is a hint:
  a lease that never started (no stream accepted) is freed only at its start
  window's end, which is why the sources open first. `end(notice)` stops the
  run when the grant ends, and the runner tracks it as `api_error` unless the
  lease marks it `expected` (the normal end of a segment); Kizuna Soniox words
  it at acquire — `segment_ended` when the grant reached the per-session cap,
  `budget_exhausted` otherwise — and its budget timer and a 403 at the grant's
  end give the same words. `frame` files the lease's wire traffic (`session.*`)
  in the first leg's Logs, its release's outcome included; a refusal's wallet
  figures go there only, never into the start's message, which analytics
  carry.

  The session key's refusals are 401, 402, 403, 409 (retried once), 502 and
  503 — no 423 — and the backend's 503 has three causes (region, wallet,
  capacity) that Kizuna Soniox still words as one, as the old client did.
- **`startBoth`** (D23) — Soniox only. When both legs are requested and the
  provider defines it, the runner hands it both requests, and the provider
  decides between one mixed socket and two, from its own settings. Its second
  returned `Session` replaces `createSecondaryPort()`, the inert port whose
  `getConversationItems()` returns `[]`. Each leg still has its own source; the
  mixing is the provider's business. It rejects with `LegStartError(leg, cause)`
  to name the leg that failed (D22), so the start's notice names it; any other
  rejection is the first leg's.
- **`minimumBalance`** — managed providers' start floor, replacing the
  `KIZUNA_AI_SONIOX` special case in the start gate. The gate reads it over
  the account's wallet as the client knows it (Stage 2 Kizuna Soniox, ruling
  5): a wallet still loading answers "Checking...", and one that failed to load
  refuses Start, as the old gate did; the lease's 402 still words a balance
  that changed since the fetch. Kizuna Soniox prices the roles its lease would
  ask for (`ceil((n_stt × 1.1 + n_tts × 1.4) × 10⁶ × 60 / 3600)` µUSD), so a
  participant speech stream counts once its flag is on.

Palabra uses none (Stage 2 Palabra, choice 9). The old client's delete-all
`prepare` is gone — it deleted every session on the account, Both's other leg
included — and each leg deletes only the REST session it created, a create
the leg outlives included; Both is two independent sessions on one
credential, which the owner's probe ran. Its delete is framed as it goes out
and as it ends, within 4 s; one that failed is a warning row; and a start that
fails after its session was made rejects only once the delete has settled, so
that outcome is framed too (Stage 2 session end, choice 5).

### Capture belongs to the runner

Sources are the runner's, one per leg: the microphone, system audio (Electron:
app, device or loopback capture), or the tab (extension). Each has an `ended`
signal, and switching device or participant source happens inside it.

**The speaker's capture runs from the leg's start in every turn mode.** Today,
pure push-to-talk opens the microphone on the first press and keeps it open
after — the only difference is before that first press, and it removes a race:
releasing before the first press has finished opening the recorder skips the
turn's ending and leaves the recorder streaming.

**A WebRTC adapter receives a `MediaStreamTrack` from the runner's own graph**,
not a device id. Device switching and mute happen upstream of the track, so
`webrtcOptions` disappears, and two live defects go with it: a microphone muted
at start still captures the default device over WebRTC, and a mute during the
session never reaches the track. The output device passed today is applied to
an audio element that is itself muted; the Stage 2 rewrite of the WebRTC
adapters confirms whether it does anything. **Amended 2026-09-29:** no
adapter takes the runner's track now — the owner abandoned OpenAI's two
WebRTC clients, and Palabra's old client builds its LiveKit track from
appended pcm (`PalabraAIClient.ts:409-455, 553-570`) — so this waited for an
adapter that would; the two defects go with the deleted clients.
**Amended by the Stage 2 Palabra plan:** none will — Palabra's port is a
WebSocket client written from scratch (ruling 19) — so the seam is deleted:
`StartRequest.input`, the runner's `Source.track` and its two threading
sites, and the capture's track option (ruling 16; `7d0b8cdd`).

**Passthrough is a route** tapping the microphone source (Playback), not a
property of the recorder.

### Turns belong to the run

The run owns the turn (D14). Each press creates a turn object with its own
voiced-chunk count, so a press landing while the previous release is still
ending can no longer reset the previous turn's count. Stop ends an open turn,
so a Stop during a hold can no longer leave `isRecording` true into the next
session.

### Stopping, and closing the window

- **One path.** `stop()` aborts, unwinds and resolves one promise; the button in
  `stopping` does nothing, so a double tap no longer starts a new session.
- **Each leg's last line in the Logs is the runner's.** Once a run has unwound
  — every leg's `stop()` settled — it frames `session.stopped` (`out`) for each
  leg: `{ reason, code?, leg?, state, elapsedMs }`, the run's end reason, its
  notice's code and the leg it names, the leg's last state (`null` when its
  adapter never started) and the run clock's time from Start to the stop; none
  for a start refused before it opened a leg, a stop while it checked or
  prepared, or
  `abandon()`. It is the uniform line the old clients' `disconnect()` logged as
  `session.closed`. Before it, each adapter frames the graceful end it sends:
  Doubao's `FinishSession` (`session.finish`), Soniox's end of the STT stream
  at Stop (`stt.end`; a failure sends none) and a speaking TTS stream's
  `text_end` (`tts.end`), Palabra's `end_task` (`task.end`) and its REST
  session's delete (`session.delete`, then `session.deleted`, or
  `session.delete_warning` with Palabra's status, the error's name or its 4 s
  bound — strictly inside the runner's own 5 s bound on a release, so the line
  is filed), and OpenAI Translate's `session.close`, which it now sends, not
  waiting for the server's flush; Doubao does not wait for `SessionFinished`.
  Gemini and OpenAI Realtime have no end message (Stage 2 session end, ruling
  2; choices 1, 2, 4, 5, 8).
- **Auto-save runs after the legs have closed, from L1** — both legs. Today the
  participant leg's final rows are never written to React state and reach only
  the saved file.
- **Electron close and update install** treat any phase but `idle` as busy and
  await `stop()`. Today a close during startup is not waited for.
- **One bound for the whole ending.** An ending that overruns `closeTimeoutMs`
  is reported and shown idle while its unwind goes on in the background, still
  the runner's: `abandon()` reaches it, its auto-save saves its own legs, a
  start meanwhile is refused (`still_stopping`), and `settled()` — what an
  Electron close awaits — resolves once no ending is in flight or lingering.
- **`pagehide`** — the extension side panel closing, a reload, the web build —
  closes sockets and captures synchronously and releases a managed lease with a
  `keepalive` request, with the token cached when the lease was acquired: there
  is no time for an await. Auto-save cannot run there, as today; the lease no
  longer leaks until expiry.
- **`pagehide` calls `abandon()`**: every release on the run's stack starts
  synchronously, none awaited, and nothing is auto-saved.

### State

The runner's store replaces MainPanel's lifecycle hooks and most of
`sessionStore`: `isInitializing`, `initPhase`, `isUsingWebRTC`, both
`*ChannelActive` flags, `splitDegraded`, `sessionDuration` (derived from
`since`), `isReconnecting` (now per leg), `lockedMode` (the shape's mode),
`isSessionActive` (a phase), and the refs that coordinated start and stop.
Settings sections that lock during a session read the phase.

### The conversation outlives the run

After Stop the conversation stays on screen, can be exported, replayed and
auto-saved, and is cleared only by the next Start or by the user. So the two L1
legs are not the run's: the runner holds **the conversation** — the legs of the
last run — until the next `start()` replaces it or `clear()` empties it. Export,
replay, auto-save and the subtitle surfaces read the conversation, never a run.
`clear()` during a run drops every segment and its pcm, clears the clip queues,
and leaves open segments open with empty text; today's
`clearConversationVersion` watcher becomes a call to it.

### What may change during a run

The shape is frozen, but a run is not a freeze of the whole app. These change
while running and take effect immediately: microphone and monitor device,
participant source, the three mute switches, noise suppression, passthrough
and its ratio, every display setting (modes, font size, compact, colours, the
subtitle window's own), and `keepReplayAudio`. Everything else — provider,
languages, mode, turn mode, text-only, transport, the provider's own settings
and credentials — is locked while the phase is not `idle`; the settings
sections read the phase for it, and so does `setProvider`, which the sign-in
auto-switch (`MainLayout.tsx:175-199`) calls with no session guard today.

### Sources, in full

A source has three signals: `pcm` (its tap), `ended` (the device unplugged, the
tab closed, the app-capture helper gone) and **`degraded`** — the app-capture
helper dying and the source falling back to whole-system capture is a warning
the user must see, and today it reaches only the Logs panel
(`ModernBrowserAudioService.ts:1196-1205`). A `degraded` source records a
Notice on its leg. The gate asks the platform for a participant source before
start: today only the microphone is checked, so the web build, which has no
participant source at all, learns it inside `openSource`.

### Notices reach the user localized

`Notice.message` is diagnostic English. What a user sees is localized, so a
Notice that is meant for the screen carries `code` and `params` and the
surface looks the text up — as `reasonToI18n`, `voicePrepNotice` and
`mainPanel.openaiLiveConnectionLost` do today, each its own way. The same
holds for `lastEnd.reason`: a typed code, so the idle surface can offer the
settings deep link (`reasonToSettingsTarget`) or the privacy-settings prompt
(`WarningModal` → `open-privacy-settings`) that the reason calls for. A
provider's code may reuse a sentence every locale already has through
`NOTICE_ALIASES` (`src/lib/view/noticeText.ts`) instead of a `notices.<code>`
key of its own.

### Analytics

The runner owns the session events; adapters emit none. Kept, with their
source:

| Event | Emitted by |
|---|---|
| `translation_session_start` / `_end` | the runner, from the run's actual configs (`describe()`), the transport the started session reports, `channels`, and the segmentation tallies L1 keeps for fill-in and the cut |
| `session_control_clicked` | the runner, for every surface's start / stop / cancel — today the basic footer sends none |
| `push_to_talk_used` | the turn object |
| `text_input_sent` | the runner (today it is not even declared in `AnalyticsEvents`) |
| `connection_status` | the runner, per leg, on connect and close — today only the speaker's connect is reported |
| `api_error`, `error_occurred` | the runner: both for a start that fails, `api_error` with its code when it has one (a refusal before anything opened tracks neither); `api_error` for `failed`, for a lease's end the lease does not mark `expected`, and for every `degraded` — `error_code` its `reason` when it has one, else its code — once per leg and code within L1's 5-s notice window |
| `audio_error`, `audio_device_changed` | the sources |
| `echo_detected` | the echo monitor |
| `segmentation_model_load` | the punctuation runtime |

Gone, per D9: `translation_completed`, `latency_measurement` (whose
`websocket_fallback` variant becomes the reported transport).

### What the surveys' defects become

| Cause | Examples | Becomes |
|---|---|---|
| no session object | lost cancel, second Stop not waiting, double tap starting a session, gate not re-checked, close during startup | the runner's phases and one stop promise |
| rollback as a list | system-audio source left connected, flags left set, participant client left connected | the resource stack |
| cancel reaching few steps | acquire not abortable, participant leg running after cancel, `session-started` after `session-end` | the run's signal in every step, and stack order |
| no ending contract | Compatible WS, local engines, unplugged microphone, side panel close | the adapter rule, source `ended`, `pagehide` |
| leg bookkeeping | participant `onClose` not checking which client closed, error rows wiped by `setItems`, participant rows never written | L1 per leg; runs discard events from a finished run |
| turns | stuck `isRecording`, release before the recorder opened, press during the previous release | the turn object and continuous capture |
| WebRTC capture | mute ignored, push-to-talk not gating | the runner's track; the adapter gates its sender (D14). Gone instead with OpenAI's WebRTC clients, abandoned by the owner (2026-09-29): its sessions run over WebSocket from the runner's gated source |
| telemetry | start event rebuilt from settings, preferred transport reported instead of the one used | reported from the run's actual configs and sessions |
| cross-leg engines | Local Native's shared sidecar engine, LocalInference's over-count | `admit` |

Not removed by construction: auto-save on an abrupt close (not possible from
`pagehide`), and adapter-internal issues — ICE `disconnected` treated as fatal,
LiveKit reconnects not surfaced, Palabra's `deleteSession` having no timeout —
which the Stage 2 rewrites own. The release timeout bounds the last.
**Amended by the Stage 2 Palabra plan:** LiveKit's reconnects went with the
transport (ruling 19), and Palabra's delete is bounded at 5 s with
`keepalive`, sent before `stop()`'s first `await` so `pagehide` still sends
it, for the leg's own session only; the create runs on its own signal, so a
session made after the leg ended is deleted too (choice 9); and a transport
failure is tried once more without `keepalive`, inside the same bound, as the
Soniox lease's release is (`b7aaf60d`). **Amended by the Stage 2 session-end
and wizard plan:** the bound is 4 s, strictly inside the runner's own 5 s
bound on each release, as the Kizuna lease's session end is — at an equal 5 s
the runner's timer, armed first, filed the run before the delete's outcome
(choice 5).

---

## Testing

There is no React rendering harness in this repository, and a provider client
cannot be validated by unit tests alone. Four kinds of test cover the new
structure, and the first two exist because of one artefact.

**The fake provider (D24).** A real definition in the registry, present in dev
builds only, whose adapter plays a timed script of L0 events. Three layers:

- **Script playback.** `segmentOpened` / `segmentText` / `segmentClosed` with
  origins; `audio` with `range` and synthetic pcm — tone bursts sized to the
  text, so clip positions and karaoke can be checked against known sample
  counts; `timing`, `language`, `degraded`, `reconnecting`, `failed`, `closed`
  at scripted moments. It honours `context`: under manual turns it emits a
  segment only after `endTurn` and nothing after `cancelTurn`; `appendText`
  yields a source segment and a translation; `speech: false` yields no audio.
  Tests drive it on a virtual clock, the app on real time.
- **Fault and shape knobs.** `check` not ready, `build` refused, `start`
  throwing, failing after N seconds, one reconnect cycle, audio without
  `range`, audio without `ref`, a rewrite that changes letters (ranges must
  drop), text without terminal punctuation (fill-in must run), CJK text (rows
  must tile), a different script per leg, a `startBoth` variant, and a
  generator for thousands of segments to load L2.
- **Fake sources.** A pcm generator in place of the microphone and the system
  audio, with `ended` injectable, so the runner's stack is tested without a
  device.

**Contract conformance.** The rules under "What every adapter must honour" are
one suite, run against the fake provider first and every real adapter after it.

**The kit, as the Stage 2 Palabra plan made it stricter** (ruling 15; choices
4, 9, 10). Every registered provider's conformance passes the first five; the
last two are tools a provider's own suite takes up, Palabra's first:
- `VirtualClock.pending()` counts the timers armed and not yet fired or
  cancelled, and every scenario that did not hang checks it is zero once the
  session has ended and the clock has run on — an interval that outlives its
  session re-arms forever.
- `FakeSocket` refuses what a browser refuses: `close(code)` outside 1000 and
  3000–4999 throws `InvalidAccessError`, a reason over 123 UTF-8 bytes
  `SyntaxError`, before anything closes and whatever the socket's state. A
  server's close frame is clean at every code a frame can carry, 1008
  included, and 1005 arrives with an empty reason; `serverClose` with 1004,
  1015 or 1016–2999 throws, since no browser reports them from a frame. 1006
  is still accepted, unclean, because five provider suites (OpenAI Realtime,
  OpenAI Translate, Soniox, Gemini, Doubao AST 2.0) use it to mean an abnormal
  close; `drop()` is the preferred form (`d1bfb544`).
- `runScenario` flushes after the harness's exchange before a server close or
  a reconnect, so an answer after an `await` lands first. `server-close` runs
  both ways: flushed, the adapter must say the session ended; unflushed, an
  answer still in flight when the server closes may be dropped, but nothing
  may land after `failed` / `closed` or after `stop()` — but a frame, until
  `stop()` has returned: the kit marks the log `stopped` then, and a log with
  no such mark keeps the old rule (Stage 2 session end, choice 3) — the
  server-ended race (`d1bfb544`).
- `manual-end` checks that the release and the exchange produced a segment.
- `checkConformance`'s `frame-url` rule: no frame payload holds a socket URL
  (choice 10).
- **The seeded lifecycle scenario**, `runLifecycles`
  (`src/lib/contract/testing/lifecycle.ts`): many random lives of one adapter,
  each driven the way the runner drives it, over `FakeSocket`s on a virtual
  clock, modelled on the OpenAI final reviews' fuzzes. Audio always under
  automatic turns and only while a key is held under manual ones; a release
  that ends the turn when it held at least 12,000 samples — the runner's
  `MIN_VOICED_SAMPLES` — and cancels it otherwise, with a small raw draw
  kept; typed text where the provider takes it; the server's own steps, the
  clock, a dropped connection, each followed by 0–10 microtask hops. The kit
  aborts before the opening runs, drops the newest socket, or — at random,
  6 % of the time — aborts while the start is still pending after it; a
  start still pending then gets its bound (`opening.bound`). A stop is
  the runner's: mark, abort the request's signal, then `stop()`; the log is
  marked again once it has returned; `stop()` has
  a bound of its own (10 s by default) and fails by name past it. Each run
  checks that the start settles; that a refused start says nothing but frames
  and status (the rule `mustReject` reads); that nothing goes up a socket once
  the session has ended — ended, or `CLOSED`, or `CLOSING` by the adapter's
  own close; at most one `failed` / `closed`; no timer armed and no socket
  open once the clock has run on; no secret the harness names; the whole log
  conformant, less `text-input-answered` (a random stop may cut a typed
  text's answer short); and the harness's own `after`. Each run draws from a generator
  of its own, seeded from the seed and its index, so a failure — named by
  seed, run, step and draw — replays alone. It was hardened over three
  review rounds (`a0e06f55`, `8f6a5821`, `e0143c7b`) and first runs over
  Palabra's adapter in both credential modes, 300 lives each (choice 19).
- The kit's virtual clock fires every timer one `advance()` makes due in one
  call: a case that depends on which of two bounds fires first steps the
  clock to each alone (Stage 2 session end, choice 3; Palabra's
  `adapter.runner.test.ts`).
- A provider's fake REST server reads bodies as a browser's `fetch` does: an
  aborted request rejects, and so does reading an answer's body once its
  request is aborted (Palabra's `fakeRest`, choice 9; pinned in its own
  suite).

**Pure layers.** L1 and L2 are tested as the pure functions they are, with the
fake's scripts as fixtures.

**The runner.** With fake sources and the fake adapter: every unwind path
(stop, cancel at each step, failure at each step), the lease order, the turn
object, and the close paths.

**Rendering.** The four surfaces are judged by rendering, with headless
Chromium against the fake provider: the panel, the Electron subtitle takeover,
the extension overlay in a meeting page, and the exported file. The fake is
also what a screenshot or a layout decision is made against.

---

## Migration

Rewrite, not migrate. Neither adapter direction is built.

**Stage 1 — the new spine and one provider, end to end.** Contract types, L1,
L2, playback, **and the new display layer**, brought up on the **fake provider
first** (D24) — it is free, deterministic and exercises every fault path — and
then LocalInference as the first real one. The acceptance test is that all
four surfaces are correct — panel, Electron subtitle takeover, extension
in-page overlay, export — because a data-layer-only check would let a wrong
display model survive until the fifth provider. LocalInference is the adapter
that keeps the most inside L0 (VAD, the translation-job cut, TTS, model
loading, `admit`); bringing the spine up on it would debug both at once.

**The subtitle surfaces are rewritten in this stage, not after it.** `SubtitleApp`
loses its private copy of the merge and sort (`SubtitleApp.tsx:183-201`, with
different defaulting rules and no language snapshot); `SubtitleStream` loses its
second karaoke renderer (`:255-274`, a duplicate of `ConversationRow`'s);
`sessionPortMirror` stops writing raw item arrays into a mirrored store; and the
wire's `items?: any[]` becomes a typed `Entry[]`. Both subtitle surfaces share
these components, so this is one rewrite, not two.

**The provider-definition layer is built in this stage too**: the registry,
generic settings and credential storage, the credential form, the language
section, the readiness state, the shared field components and the socket seam —
with LocalInference's definition as the first user. Its settings component is the
first to be composed from the shared fields.

**So is the session runner**, with its sources, the turn object and the store
the surfaces read; `connectConversation`, `disconnectConversation` and the
lifecycle hooks leave MainPanel in this stage. Three tests read MainPanel's
source text rather than its behaviour — `sessionIdLifecycle.consistency`,
`sessionEndAutoSave.wiring`, and `consoleLedger.consistency`'s row that expects
exactly 43 `console.*` calls in it — and are replaced with behavioural tests
against the runner in the same change.

**The old provider code stays until each port is live-tested** (owner,
2026-09-26, reversing this section's first version). The clients, their
descriptors, the old settings UI and the old store slices remain compiled but
unreachable from the new session, as the protocol documentation each Stage 2
step ports from. What lived only in the old MainPanel — the cross-leg
orchestration — is read from history
(`aecaae2b^:src/components/MainPanel/MainPanel.tsx`). A Stage 2 step writes the
provider's definition, adapter and settings component together, and deletes
that provider's old code after the owner has run it live. OpenAI Translate's
own-key old code first waited for a WebRTC step's live test, since the WebRTC
client imports the GA client (Stage 2 OpenAI Translate, ruling 14), and OpenAI
Realtime's and OpenAI Compatible's old code, and the `openai-realtime-api`
dependency, with it, as one deletion (OpenAI Translate's plan T3, merged;
Stage 2 OpenAI Realtime, ruling 20): OpenAI Realtime's old WebRTC client
imports the old session builder and the ephemeral-token service, and OpenAI
Translate's GA client imports statics of the compatible one. **Amended
2026-09-29 (owner):** the WebRTC transport of both is abandoned, neither
migrated nor reimplemented, so the merged deletion waits only for the two
WebSocket live tests, OpenAI Translate's and OpenAI Realtime's. It takes both
WebSocket and both WebRTC old clients, `OpenAIClient`'s statics,
`openAIRealtimeSession`, `EphemeralTokenService` (only the two WebRTC clients
use it), the Compatible code and the `openai-realtime-api` fork. Palabra's old
code — its client, descriptor, the store's readers and migrations, the old
UI's branches, `isPalabraAIEnabled` and its forwarding — and the
`livekit-client` dependency with its pin wait for Palabra's own live test, one
later plan (Stage 2 Palabra, ruling 17; the roadmap's Palabra record holds
the inventory). It meets the OpenAI deletion at `WebRTCAudioBridge`, whose
`livekit-client` type import that deletion orphans: whichever runs second
deletes the bridge.

**Stage 2 — one provider per change**, after a vendor-free foundation plan
(`docs/superpowers/plans/2026-09-26-client-contract-stage2-foundation.md`).
LocalInference, the precise extreme, landed in Stage 1. Provider ids are the
old `Provider` enum's spellings, so stored selections, analytics and locale keys
need no mapping; LocalInference keeps `localInference`, mapped since Stage 1.
The order (the owner may overrule it):

1. **Soniox** (`soniox`) — the richest: per-token language, provider timing,
   definite-split, its own TTS over a second socket, `startBoth`.
2. **Kizuna Soniox** (`kizunaai_soniox`) — the managed composition: the lease,
   the budget, the voice claim, the balance floor. It may share a plan with
   Soniox, in two task groups, each with its own live test.
3. **Gemini** (`gemini`) — turn-level origin for the dialogue models and
   stated for Live Translate by the translation's cuts (the Stage 2
   translation cuts plan), `boundaries: 'silence'` (parity), reconnect —
   ported by the Stage 2 Gemini plan; ranges by arrival, Live Translate the
   default, a push-to-talk release tail on Live Translate, activity handling
   per model family, Google's language codes per family — the last five by
   the Stage 2 Gemini/AST2 follow-up.
4. **Volcengine AST2** (`volcengine_ast2`) — the credentials in the socket's
   query (no seam), two credential modes, a language offer per speech mode,
   pairing inferred by proximity — ported by the Stage 2 Volcengine AST2 plan;
   whole-sentence ranges keyed by the server's times (the Stage 2 Gemini/AST2
   follow-up). Its relay twin (`kizunaai_volcengine_ast2`) is deleted, not
   ported.
5. **OpenAI Translate** (`openai_translate`) — frame-level ranges by arrival,
   our own boundaries, origins stated by the translation's cuts (the Stage 2
   translation cuts plan), a push-to-talk release tail, Text only
   as a playback control — ported over WebSocket by the Stage 2 OpenAI
   Translate plan; its WebRTC transport abandoned (item 7). Its relay twin
   (`kizunaai_openai_translate`) is deleted, not ported.
6. **OpenAI Realtime** (`openai`) — server boundaries, stated pairing, the
   drift anchor, the typed-text queue — ported over WebSocket by the Stage 2
   OpenAI Realtime plan; its WebRTC transport abandoned (item 7). **OpenAI
   Compatible** (`openai_compatible`) is retired, not ported (Stage 2 OpenAI
   Realtime, ruling 1): a stored selection falls to the first provider
   offered.
7. **Removed (owner, 2026-09-29): OpenAI Translate over WebRTC**, which was to
   carry the processed track from the runner's graph, OpenAI Realtime's WebRTC
   transport, D25's `turns(s)` and the participant's transport (Stage 2 OpenAI
   Realtime, ruling 12). WebRTC users are few, so the WebRTC transport of both
   OpenAI providers is neither migrated nor reimplemented. The list keeps its
   numbers; after item 6 the order runs Palabra, OpenAI Live, Local Native.
8. **Palabra** (`palabraai`) — ported by the Stage 2 Palabra plan as a
   WebSocket client written from scratch (ruling 19): attributable audio per
   sentence, stated pairing, ranges at a burst's end. The degenerate extreme
   this item first named — `audio` without `ref`, no `range` — was its old
   LiveKit client's.
9. **OpenAI Live** (`openai_live`) — span caps, the `end_ms` timeline. Ported
   by the Stage 2 OpenAI Live plan: the old span caps kept, the timeline's
   pause read at the source pause (ruling 10) as its source rules on
   `ContinuousSegments`, the `end_ms` timeline as the karaoke's clock, F14
   built for it.
10. **Local Native** (`local_native`) — LocalInference's sibling on the sidecar.
    Its `Engine` is a thin wrapper like LocalInference's: the shared
    `EngineSurface` over the existing `useNativeEngineAdapter`, with the
    existing `NativeModelManagementSection`, `NativeVoiceSection` and
    `NativeDeviceControl` — reused, switched from the old `settingsStore` slice
    to the provider's `settings` / `update` / `pair` (the override
    `useWasmEngineAdapter` got for LocalInference).

**The relay twins** (`kizunaai_openai_translate`, `kizunaai_volcengine_ast2`)
are not ported onto the relay: the owner ruled on 2026-08-30 that the user's
audio must not flow through Kizuna. Whether they return as direct connections is
the owner's decision when their turn comes. If they do, each is
`managed(base, …)` over its ported base with a direct-connect `K`.
**Amended by the Stage 2 Volcengine AST2 plan:** for AST2's twin the owner has
decided. `kizunaai_volcengine_ast2` is deleted with the old AST2 code, not
ported (item 4 above); `kizunaai_openai_translate` stays held until OpenAI
Translate's turn.
**Amended by the Stage 2 OpenAI Translate plan:** the owner has decided that one
too: it is deleted, not ported, after the own-key port's live test (plan T2).

That is twelve providers: nine ported in nine steps — the tenth, OpenAI
Translate's WebRTC transport with OpenAI Realtime's, removed when the owner
abandoned them (2026-09-29) — one retired, and two relay twins, both deleted.
Each step is its own implementation plan; this spec is the design for the
whole, not the plan for any one stage.

**Batch size is set by testing, not by code risk.** A provider client cannot be
validated by unit tests alone; protocol behaviour, timing and real audio need a
live session, and those are run by hand. One provider at a time is the largest
unit that can be attributed when something goes wrong.

**Branch.** A long-lived branch. `main` stays releasable in principle but is not
expected to move during this work, so the rebase burden is theoretical and the
branch effectively becomes the new main.

---

## What the forty-six assumptions became

The current-state analysis lists forty-six assumptions the display side makes
about how clients produce items. Walked one by one against this design:

| Outcome | Count |
|---|---|
| dissolved by construction | 33 |
| still true — stated below as an explicit invariant | 4 |
| exposed a hole in the design — fixed above | 4 |
| a UI rule — deferred to the UI work | 4 |
| a decision — export granularity, settled above | 1 |

The four holes were: the configured language pair had nowhere to live; ids
needed a session qualifier; `splitDefinite`'s ranges must tile the text rather
than trim it; and entries must carry `leg` as a field.

### Invariants the new structure must state

- **A clip's playback position is monotonic within the clip.** Today
  `playbackStore`'s `_cumOffset` compensates for a passthrough gap splitting one
  key into two player entries. The new player is written from scratch and must
  never split a clip.
- **The overlay's tail is sliced from the merged `Entry[]`**, never per leg.
  Today each leg is cut to its last fifteen items independently and then
  re-merged, which can drop one side's older history when the legs run at
  different rates.
- **L2's output is structurally shared.** Entries that did not change keep their
  identity, so the wire does not re-send the whole conversation on every
  keystroke of a partial.
- **Disconnect finalizes every open segment**, once, in L1. Today each client
  does its own version of this (Soniox's `forceCompleteStuckItem`, the completes
  inside each `disconnect()`); without it, a sentence cut off by Stop stays
  provisional forever.

### UI rules deferred to the UI work

These are implicit behaviours hard-coded today. The new structure turns each
into an explicit choice in L3; they are settled against rendered pages, not here.

- What header grouping keys on — today only `source` equality; with groups it
  may be the group or the leg.
- Whether a notice breaks header grouping.
- Whether a notice is shown on a side whose display mode is `none` — today it
  always is.
- Which band a notice goes into in compact mode — today, forcibly, the
  translation band.

---

## Open questions

### Structural gaps

None remain. The design now says what a client emits, what it receives, who
builds that request, and in what order a session starts and ends.
`LocalNativeClient` reading and writing `useNativeModelStore` inside `connect()`
moves into its builder, per the rule that model resolution never happens in an
adapter; Local Native is not yet open to general users, so it carries no
compatibility burden.

### Parameters and deferred decisions

- **Release timeouts and the lease's retry policy** — decided by the Stage 2
  Kizuna Soniox plan: each release bounded at 5 s; `session-end` three
  attempts within 4 s.
- **Local Native with two legs** — refused by `admit` until the sidecar keeps one
  engine per connection. That is a native and sidecar change with its own
  release, outside this design.
- **The pcm retention ceiling.** A duration, a byte budget, or both; and what the
  default is.
- **Whether `marks`' compaction threshold is a constant or follows the
  configured pause.**
- **Whether the raw pre-punctuation text is worth keeping** for diagnostics. No
  runtime consumer needs it once ranges are re-anchored.
- **`origin` inference thresholds** — the overlap fraction that counts as a
  pair, the time window for proximity, and what breaks a tie between two
  candidates.

### Stage 2 — open for the plans that meet them

From the Stage 2 foundation survey's §3.4:

- **D25 and OpenAI's participant leg** (item 1). `turns(s)` = manual-only
  would refuse the participant leg for OpenAI over WebRTC, which today runs its
  participant over WebSocket. The OpenAI plan decides: `turns(s)` for the
  speaker leg, the adapter choosing the participant's transport. **Moved to
  the WebRTC step** by the Stage 2 OpenAI Realtime plan (ruling 12): its port
  is WebSocket only and offers both modes, so nothing there needed `turns(s)`.
  D25, `turns(s)` and the participant's transport meet the WebRTC step with
  OpenAI Translate's, which also decides whether "manual only" includes
  push-to-translate — the old UI disabled it under WebRTC too
  (`ProviderSpecificSettings.tsx:589-590`; survey §3.7.7). **Closed
  2026-09-29 (owner):** the WebRTC transport of both OpenAI providers is
  abandoned, so no provider offers manual turns only, the participant's
  transport is WebSocket like the speaker's, and push-to-translate under
  WebRTC is no one's question.
- **Participant speech against the managed lease** (item 3) — decided by the
  Kizuna Soniox plan (ruling 2): built end to end — the request's intent
  field, the participant's `par_tts` key in every Both mode and
  participant-only, floors counted from the roles — and shipped off behind the
  definition's `participantSpeech` flag until the backend mints `par_tts` (the
  roadmap's "turning it on" checklist).
- **`minimumBalance`, `Resources.budget` and `RunState.running.budget`**
  (item 5) — in the types since the Kizuna Soniox plan.
- **Items 8 and 9 — resolved by the foundation plan** (the controller's
  ruling), as the shape's note records:
  - item 8 by F3: `credentials.read` may answer with a code, so a managed
    provider signed out reads `sign_in_required`. `read` stays synchronous, so
    a managed `read` answers the sign-in (`R`), and the lease reads the token
    from the run's `auth` when it mints `K`. Kizuna Soniox uses it first.
  - item 9 by F5: `legacyKeys`, the credentials and `migratePair` reach a
    migration. OpenAI and Gemini use F5 (`legacyKeys`; Gemini's `migratePair`,
    which converts nothing); Palabra, for which it was first named, does not
    (Stage 2 Palabra, rulings 2, 20).

## Risks

- **The display model is only validated by Stage 1.** If it is wrong, it is wrong
  before any provider but the first. This is why Stage 1's acceptance covers all
  four surfaces rather than the data layer alone.
- **Provider-owned settings components can drift apart visually.** Nothing
  type-checks a class name. The shared field components are the defence, and a
  provider's component composes them rather than copying their markup.
- **`origin` inference has no ground truth to test against** for the three
  providers that need it. Its failure mode is a wrong pairing, which is worse
  than no pairing — so `pairing: 'none'` must stay reachable and the display must
  not assume a group is a real pair. **Amended by the Stage 2 translation cuts
  plan:** of the three, OpenAI Translate and Gemini Live Translate now state
  their origins; Doubao AST 2.0 still needs it; OpenAI Live states its own
  (Stage 2 OpenAI Live, ruling 3).
- **Karaoke's honesty depends on producers being honest.** A client that reports
  a `range` it does not actually know reintroduces the fake alignment this design
  deletes. The rule is one line: report a `range` only when the producer knew
  which characters the audio speaks. OpenAI Translate's arrival ranges are the
  first stated exception: the old client's alignment, kept as parity by the
  owner's ruling until its `elapsed_ms` is measured (Stage 2 OpenAI Translate,
  ruling 6). OpenAI Realtime's arrival ranges are the second, by the same kind
  of ruling (Stage 2 OpenAI Realtime, ruling 3). Gemini's arrival ranges are
  the third, by the same kind of ruling (Stage 2 Gemini/AST2 follow-up, ruling
  2). Doubao's whole-sentence ranges are no exception: the TTS sentence states
  which subtitle it speaks by carrying its server times (ruling 1).
- **A keepalive on a timer, on a hidden page** (Stage 2 Palabra, ruling 3;
  choice 7). No audio reaches an adapter while the microphone is muted
  (`src/lib/audio/capture/core.ts:85`) or between push-to-talk presses (the
  runner's turn gate, `src/lib/session/run.ts:450-453`), so then only the
  adapter's own timer keeps a session alive. A hidden page throttles timers:
  at about one wake-up a minute — Chrome's intensive throttling, after about
  5 minutes hidden and silent [inf] — no timer keepalive can survive, and
  Palabra, hearing nothing for 10 s, sends `SERVICE_TIMEOUT` and closes 1008.
  Electron's main window is exempt (`backgroundThrottling: false`,
  `electron/main.js:397`); the extension side panel and the web build are not
  [inf]. Soniox's STT and TTS keepalives and Doubao AST 2.0's real-time
  silence share the exposure. At about 1 Hz a throttled page still keeps the
  session, with less silence than real time — a beat it could not keep is
  skipped, not caught up. The roadmap's Palabra record carries the live test
  (item 5) and the open question "Silence on the audio clock": zeros carried
  by the audio itself, which no throttled timer could end.
- **A socket URL carries the credential** (Doubao AST 2.0's accepted
  question, now Palabra's too): no frame, error, notice or log
  line of ours carries one (the kit's `frame-url`; `redact()`'s query rule),
  but DevTools' own console prints a failed socket's URL, outside our sinks.
- **A long-lived branch that outlives its welcome.** Mitigated only by Stage 1
  landing quickly enough that Stage 2 can proceed provider by provider.
