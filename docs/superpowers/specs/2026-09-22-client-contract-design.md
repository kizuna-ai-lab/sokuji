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
| D3 | Replay | **Kept.** Every provider whose audio can be attributed to a segment does replay; only Palabra cannot. Replay does not require precision. |
| D4 | Karaoke | Drawn only where a speech entry carries a real `range`. The linear-interpolation fallback is deleted outright. |
| D5 | Audio↔text | Stored as `{ range?, pcm }` pairs on the segment. No timeline, no anchors, no quality tag — an absent `range` is the quality signal. |
| D6 | Source↔translation | A shared `origin` key. Stated by the client where the provider supplies one; inferred in L2 otherwise. |
| D7 | Segmentation | Cutting already-final text moves to L2. Deciding the translation-job boundary stays in the local clients — it is a pipeline decision, not a display one. |
| D8 | Logs | One generic `frame({direction, type, payload?})` replaces 15-18 bespoke event types per client. |
| D9 | Analytics | Translation latency and `translation_count` are no longer collected. |
| D10 | Audio routing | An explicit routing table replaces volume-as-control. The only genuine volume left is the passthrough ratio. |
| D11 | Migration | Rewrite, not migrate. New display layer plus one provider end to end, then one provider at a time. Old clients are deleted and read from git history as protocol documentation. |
| D12 | Branch | A long-lived branch. `main` stays releasable but is not expected to move. |
| D13 | Export | One block per group, each segment's text whole, one timestamp per group. Inferred pairings are written paired like stated ones; the JSON form keeps `pairing`. |
| D14 | Turns | Every provider offers auto, push-to-talk and push-to-translate. Adapters see only `turns: 'auto' \| 'manual'` and implement `beginTurn` / `endTurn` / `cancelTurn`; the voice gate is generic; push-to-translate is a routing rule; `pttFinalization` is deleted. |
| D15 | Turn mode storage | One global setting, not per provider. |
| D16 | Extension overlay | Gets a hold button (pointer down / up / leave / cancel) forwarded over the port; its "Press Space to speak" hint is removed, since Space belongs to the meeting page. |
| D17 | Participant leg | Nothing beyond the reversed direction and automatic turns. It is the same configuration builder called with the direction reversed; the concept of a participant configuration disappears. |
| D18 | Provider settings UI | Each provider owns its settings component, composed from shared field components. The capability flags that drive today's generic panel leave the contract. |
| D19 | Feature flags | One `VITE_ENABLED_PROVIDERS` list of provider ids replaces the per-provider `VITE_ENABLE_*` flags. The Kizuna umbrella flag stays. |
| D20 | `auto` source and the participant leg | The participant leg opens only when the reversed direction is supported. `auto` is never a target, so an `auto` source refuses the participant leg for every provider. |

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
adapter.start({ context, config, credentials }, events): Promise<Session>

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
//   ref absent   — attributable to no segment (Palabra); plays, pairs with nothing
//   range absent — this segment's audio, but which characters is unknown
//                  → replay only, no karaoke

closed(reason) · reconnecting() · reconnected()
failed(err)                      // the session is broken
degraded(diagnostic)             // running, degraded
loading({ stage, done, total })  // local engines' model load
busy(boolean)                    // the model is producing
frame({ direction: 'in' | 'out', type, payload? })
```

`ref` is a client-local counter. It exists because a provider can revise a
specific earlier stretch — Palabra promotes `partial_<id>` into
`validated_<id>`, rewriting that item's id in place today.

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
nothing, and today's contract has no way to say so.

**`range`, not a running offset.** It is self-describing and needs no context
from the previous chunk. Clients also stop maintaining cumulative audio duration
— `audioCumSamples` / `cumulativeAudioDuration` is computed in four clients
today, and each pcm block's duration follows from its own length.

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
hint (it is the segmentation language), and Soniox's `clientReferenceId` claims
to be inert on the wire (it is sent, and billing depends on it).

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

**One call replaces construct-then-connect.** A client is created, connected
immediately and used for exactly one session, so the two are one moment. The
WebRTC-to-WebSocket fallback, which today builds its client without the leg's
options (`MainPanel.tsx:2486`), becomes the same request handed to another
adapter.

**`updateSession` is deleted.** It has no external caller, and "a running session
does not react to a setting changing" is already the rule. Adapters that
reconnect (Gemini, OpenAI Live, Soniox's 503 resume) reuse the original request
internally.

**What opacity costs.** Telemetry reads model names straight out of the config
today (`sessionModelTelemetry(sessionConfig, …)`), and the export switches on the
provider to pick model fields (`conversationExport.ts:239-259`, with no case for
four providers). With `C` opaque, the provider definition offers a small
`describe(config)` returning `{ asrModel?, translationModel?, ttsModel? }`.

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
| Gemini | server activity detection, configurable | `activityEnd` | immediate |
| Soniox | server endpoint model (`<end>`), configurable | **`finalize` — exists, never called** | immediate |
| Local ×2 | client VAD, configurable | flush | immediate |
| Volcengine AST2 | server VAD, no knobs | none on the wire; its keepalive already streams silence and the server closes the segment | after silence |
| Palabra | server segmentation, silence threshold configurable | none on the wire; the track (`dtx:false`) carries silence and the server segments after its threshold | after silence |
| OpenAI Translate ×2, OpenAI Live | **a continuous stream; there are no turns on the wire** | not needed — release stops the microphone and what was said finishes translating | n/a |

**Every one of the twelve can support manual turns correctly.** None is
incapable; they differ only between immediate and after-silence.

`SonioxSttStream.finalize()` (`:198`) — "Finalize pending tokens without ending the
session" — has no caller anywhere. Soniox has no push-to-talk today not because
its protocol lacks it but because it was never wired.

### The design

**`context.turns` is `'auto' | 'manual'`.** Push-to-talk and push-to-translate
are the same thing to an adapter.

**A manual turn is three methods**, each implemented with the adapter's best
mechanism:

| | `beginTurn` | `endTurn` | `cancelTurn` |
|---|---|---|---|
| OpenAI | — (WebRTC: enable its own track) | commit + response | **`input_audio_buffer.clear`** |
| Gemini | `activityStart` | `activityEnd` | end without generating |
| Soniox | — | **`finalize`** | — |
| Local ×2 | — | flush, padding the tail where the engine needs it | discard the current VAD segment |
| AST2, Palabra | — | — (the server closes on silence) | — |
| OpenAI Translate, OpenAI Live | — | — | — |

`beginTurn` exists for two reasons: Gemini sends `activityStart` today on a
heuristic ("before the first audio chunk"), and the two WebRTC adapters own their
microphone as a native track that only they can gate.

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
automatic mechanisms; they become OpenAI's `autoDetection: 'server' | 'semantic'`,
and OpenAI stops storing push-to-talk as `'Disabled'`.

**The participant leg is always `turns: 'auto'`**, never gated, with no
passthrough — a generic rule rather than Gemini's override. The settings copy
"Other's audio always uses semantic VAD", false today for every provider but
Gemini, becomes "always uses the provider's automatic detection", and true.

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
  turn — `cancelTurn` clears it.
- On OpenAI over WebRTC the key does not gate audio at all: the native track is
  always live and the key only counts voiced chunks — the adapter now gates its
  own track.
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
push-to-translate.

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

Three jobs, and only three: **cut** final segments into rows, **group** rows by
`origin`, **order** groups by the earliest `openedAt` they contain. It runs
**once per session**, not once per surface.

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
  append(key, pcm)   // append to a clip, creating it if new; plays in call order
  seal(key)          // no more audio for this clip
  clear()            // drop the queue and stop
  subscribe(cb)      // cb({ key, t }) | cb(null)
```

A clip is one speech entry. Sources carrying text (speaker translation,
participant translation, replay) get a queue; sources without (passthrough,
preview, test tone) are plain streams into the mix.

**`seal` is the load-bearing method.** The player cannot distinguish "this item
finished" from "a gap between chunks" today, so MainPanel reads
`item.status === 'completed'` to guess and falls back to a 2500 ms debounce
(`MainPanel.tsx:3806-3821`). With `seal` the player knows. One method removes the
debounce, the cross-layer dependency, and the class of bug where the guess is
wrong in either direction.

**Position is `{key, t}`, not a ratio.** Each clip is one unit whose start we
enqueued, so `_cumOffset`, `_maxProgress`, `progressRatio`, `duration` and
`bufferedTime` are all unnecessary, and the playback wire shrinks accordingly.

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

---

## Provider capability

Replay needs only that the audio be attributable to a segment. Karaoke needs a
real `range`. Pairing needs an `origin`, stated or inferred.

| Client | Replay | Karaoke `range` | source↔translation |
|---|---|---|---|
| LocalInferenceClient | yes | per TTS sentence, **exists today** | one translate job — stated |
| LocalNativeClient | yes | per TTS sentence, **exists today** | one translate job — stated |
| SonioxClient | yes | per sentence — both quantities are in hand, never paired | same utterance — stated |
| OpenAITranslateGAClient | yes | per audio frame, **exists today** | inferred (media time) |
| OpenAILiveClient | yes | per audio frame, **exists today** | inferred (`end_ms` timeline) |
| OpenAIGAClient | yes | per audio frame — `handleAudioDelta` already holds the item and the transcript accumulates on the same `item_id` | response ↔ committed input — stated, to be wired |
| OpenAIClient (compatible) | yes | per audio frame — same shape | same — to be wired |
| GeminiClient | yes | none — **no karaoke** | same turn — stated |
| VolcengineAST2Client | yes — today's quality is the bar to keep | none: the server's TTS sentence boundaries need not align with subtitle phases | inferred (`startTime`/`endTime`, **currently unread**) |
| OpenAIWebRTCClient | yes | none | same as GA — to be wired |
| OpenAITranslateWebRTCClient | yes | none | inferred |
| PalabraAIClient | **no** — a continuous track, attributable to nothing | none | **`transcription_id`** — stated, already extracted and then discarded |

Two findings are worth stating plainly. Palabra is the only client that cannot
replay, and it holds the cleanest pairing evidence in the codebase: the same
`transcription_id` appears on all four of its item kinds, is extracted at four
sites, and is then baked into a prefixed string id where it can no longer be
read. And "OpenAI Realtime GA can only ever offer Auto", recorded in the
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
interface Provider<S, K, C> {
  // identity and presence
  id: string                                // persisted; ProviderId is derived from the registry
  kind: 'own-key' | 'managed' | 'local'
  platforms: Platform[]                     // 'electron' | 'extension' | 'web'
  flagged?: true                            // hidden in production unless listed (D19)
  icon: Icon; docs?: string; vendor?: string

  // settings — never secrets
  settings: { key: string; defaults: S; migrate?(stored: unknown): S }
  Settings: ComponentType<{ settings: S; update(patch: Partial<S>): void }>

  // credentials — stored apart from settings
  credentials: {
    fields(s: S): CredentialField[]
    read(values: CredentialValues, ctx: AuthContext): K | { missing: string }
  }
  check(k: K, s: S): Promise<{ ok: true; models?: ModelOption[] } | { ok: false; reason: string }>

  // languages
  languages: {
    sources(s: S): LanguageOption[]          // includes 'auto' when the provider detects
    targets(source: string, s: S): LanguageOption[]
  }

  // the only capabilities generic code reads
  speech: 'always' | 'optional' | 'never'
  textInput: boolean
  boundaries(s: S): 'provider' | 'silence'

  // one leg's session
  build(context: SessionContext, s: S, shared: SharedSettings): C | { refused: string }
  describe(c: C): { asrModel?: string; translationModel?: string; ttsModel?: string }
  start(request: { context: SessionContext; config: C; credentials: K }, events): Promise<Session>
}
```

`settings.key` is today's slice key, and values persist under
`settings.<key>.<field>` exactly as now: no user's saved settings move.

`shared` is what a builder may read beyond its own settings — the system
instructions resolved for a direction, and the segmentation pauses — so a builder
never reaches into the settings store. A provider's own stores are its own
business: the local builders read their model stores, which is where model
resolution belongs (never in the adapter).

`start` owns the transport. OpenAI's choice between WebRTC and WebSocket, and the
fallback from one to the other, become its business, so `supportsWebRTC` and
`forcedTransport` leave the contract. Palabra's `forcedTransport: 'webrtc'`
exists only to steer MainPanel's transport switch; its adapter always uses
LiveKit.

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
| `settingsSliceKey`, `i18nKey` | `settings.key`; locale keys use the id |
| `createClient`, `buildSessionConfig` | `build` + `start` |
| `prepareToStart`, `acquireSessionResources`, `planBothMode` | session lifecycle |
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

### Credentials are not settings

Credential fields move out of `S` into their own record, persisted under the same
keys as today. One credential form, driven by `credentials.fields(s)`, serves the
setup wizard (already generic) and the settings panel (hand-written today: the
`updateApiKey` switch with eight cases, about 120 lines of AST2 and Palabra
credential markup, the compatible provider's endpoint input).
`peekPrimaryCredential` becomes "does `read` succeed", and `neverPersist`
disappears — a managed twin has no credential fields to persist. With no secrets
in `S`, settings can be mirrored and logged without redaction; `K` is the one
thing to redact.

### Readiness is one check

`check(k, s)` answers "can this provider start now" for every kind: a network
validation for own-key providers, model readiness for local ones (folding in the
store's two short-circuits to `modelStore` and `nativeModelStore`), a signed-in
session for managed ones. Its result goes to one generic per-provider readiness
state.

The store's model auto-select, a switch covering three providers, becomes a pure
effective-model function inside each provider that offers a model choice: the
saved model if the check found it, otherwise the newest. The provider's settings
component and its builder call the same function, so nothing writes back.

The local engines' `prepareToStart`, which only re-validates, disappears: the
lifecycle runs `check` at start for every provider, cached for the network ones.

### Languages are two functions

`sources(s)` and `targets(source, s)` replace five members, LanguageSection's two
per-provider switches (about 150 lines), its swap special cases and its
hard-coded `auto` option. What is provider-specific moves inside the two
functions. AST2's `zhen`, both-or-neither, is `targets('zhen')` returning only
`zhen` and every other source's targets omitting it. The local engines'
catalogue-driven lists are simply their implementation. `auto` is in `sources`
for providers that detect. A swap is generic: allowed when the reversed pair is
supported.

This fixes a live inconsistency. The wizard asks the local descriptors for
targets, which return the source list; the settings panel asks the translation
catalogue. The two show different target lists for the same provider.

The pair stays stored per provider. Codes differ between providers — Gemini's
`en-US` and `cmn-CN`, Palabra's `en-us` and `zh-hant`, AST2's `zhen` — so one
global pair would need a canonical code and a mapping per provider: a product
change this design does not need.

**The participant rule (D20).** The participant leg opens when the reversed
direction is supported: the speaker's target is among `sources`, and the
speaker's source is among its `targets`. `auto` is never a target, so an `auto`
source refuses the participant leg for every provider. Today OpenAI Live,
Gemini's translate model and Soniox refuse it at the start gate through
`reversesDirectionViaSourceLanguage`. Every other provider starts the leg, and in
template mode its prompt asks for a translation into the raw string `auto`,
because `auto` is in no language list (`settingsStore.ts:1437-1446`). Only an
advanced-mode participant prompt that names its own language made the
combination work; that use goes. The advanced-mode participant prompt itself
stays, as the prompt for the reversed direction: `shared.instructions(direction)`
returns it, and the builder still sees only a direction.

### Segmentation is one fact

The offer's three booleans become `boundaries(s)`: who ends a segment. Where the
provider does (`'provider'`), the user may keep its boundary — Auto. Where our
own silence timers do (`'silence'`: OpenAI Translate, OpenAI Live, Gemini), the
user tunes the pauses. Cutting into a number of sentences is available
everywhere: rows tile the segment's text and a `range` survives a cut, so the
reason OpenAI's descriptor withheld it — splitting an item would strand its
karaoke timing — no longer holds. It takes `S` because the answer can depend on
transport: OpenAI Translate over WebRTC has no source pause today
(`SentenceSegmentationSection.tsx:251`).

### Managed twins are composition

A Kizuna twin is `managed(base, overrides)`: its own `id`, `kind: 'managed'`,
`vendor`, credentials read from the sign-in session with no fields, a static
`check`, and the relay endpoint in `K`. Its settings component, languages,
builder and adapter are the base's. The `KizunaManagedProvider` union,
`isKizunaManagedProvider`, `kizunaBaseProvider`, `KIZUNA_HOSTED_ICONS`,
`getDefaultManagedProvider`'s preference list and the settings UI's active-slice
ternaries reduce to `kind` and registry order. Removing the relay later touches
the three twins and nothing else.

### The registry is a list (D19)

One ordered array is the registry. Its order is the UI order, and `ProviderId` is
derived from it; `platforms` and `flagged` decide presence. The five
per-provider flags — Kizuna Soniox, Kizuna OpenAI Translate, Kizuna AST2,
Palabra, Local Native — each need `environment.ts`, `extension/vite.config.ts`,
five env blocks in `.github/workflows/build.yml` and the forwarding consistency
test; they become one `VITE_ENABLED_PROVIDERS` list of flagged provider ids. The
Kizuna umbrella flag stays, since six other sites read it, and a managed provider
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
  carries the input device and, for echo cancellation, the output device).

### Sockets that need upgrade headers

Browsers cannot set WebSocket upgrade headers, so each platform injects them, by
different mechanisms:

| | Electron | Extension |
|---|---|---|
| mechanism | main-process `onBeforeSendHeaders` | `declarativeNetRequest` dynamic rules, in the background worker |
| life | per host, **one-shot** — the next upgrade consumes it | **persistent** until cleared |
| who can hit it | the app's own renderer | any page in the browser, unless the rule sets `initiatorDomains` |
| constraint | one listener per session, shared with Better Auth's cookie injection | `host_permissions` must list `wss://` explicitly, or Chrome ignores the rule silently |

Every extension rule rewrites request headers; none touches response headers.

**The AST2 rules expose the user's keys.** They (`background.js`, ids
2000–2009) set no `initiatorDomains` and stay installed for the whole session,
cleared on disconnect (`VolcengineAST2Client.ts:1008-1010`). While an AST2
session runs, any page that opens a socket to `openspeech.bytedance.com` has the
user's App Key and Access Key injected: the page cannot read them, but its
connection is authenticated, and billed, as the user. OpenAI Live's and Bing's
rules set `initiatorDomains`, and Live's is removed once the session has started.

What unifies is the interface a client sees, not the mechanism:
`openSocket(url, { set, remove }) → WebSocket`, one implementation per platform.
Electron keeps its one-shot rule; the extension implementation always scopes by
`initiatorDomains` and path, and clears as soon as the upgrade completes. Clients
stop pairing register and clear calls around a `headersRegistered` flag, the AST2
exposure closes by construction, the background worker's per-provider blocks and
message pairs collapse to one, and two legs opening the same host are
serialized in one place. Today the legs connect one after the other
(`MainPanel.tsx:2463`, then `:2753`), so nothing collides yet; a per-host
register/clear pair would, the moment the legs come up together.

### What adding a provider then touches

1. One folder, `src/providers/<id>/`: the definition, the adapter, the `Settings`
   component, tests.
2. One line in the registry, one in the order test.
3. `providers.<id>.name` and `.description` in the 30 locale catalogs — unchanged.
4. The extension manifest, when the provider uses a new host — MV3 declares hosts
   statically.
5. When it is flagged, its id in `VITE_ENABLED_PROVIDERS` at release.

For OpenAI Live that is two code files outside its folder, plus the manifest,
against 21 today.

---

## Migration

Rewrite, not migrate. Neither adapter direction is built.

**Stage 1 — the new spine and one provider, end to end.** Contract types, L1,
L2, playback, **and the new display layer**. Then one client. The acceptance
test is that all four surfaces are correct — panel, Electron subtitle takeover,
extension in-page overlay, export — because a data-layer-only check would let a
wrong display model survive until the fifth provider.

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

The other clients are **deleted**, and their descriptors with them. Each is
recovered from git history when its turn comes, and read to learn the protocol
rather than ported; a Stage 2 step writes the provider's definition, adapter and
settings component together.

**Stage 2 — one provider per change.** Ordered by what each adds to the model's
coverage, not by difficulty:

1. **LocalInference** — the precise extreme. Exact `range`, stated `origin`, and
   the one client family that keeps segmentation (for translation-job
   boundaries), so it proves L0 may still own a pipeline decision. Free to test,
   no network variance.
2. **Palabra** — the degenerate extreme. `audio` without `ref`, no `range`, no
   timestamps, but the cleanest `origin`. Proving both extremes early is what
   shows the model spans its range; discovering that `ref`-less audio does not
   work after nine clients are written would be expensive.
3. **Soniox** — the richest: `language`, provider timing, definite-split, its own
   TTS over a second socket.
4. **OpenAITranslateGA** — frame-level ranges, our own boundaries, inferred
   origin.
5. **OpenAILive** — span caps, the `end_ms` timeline.
6. **Gemini** — turn-level origin, no ranges.
7. **LocalNative** — LocalInference's sibling, nearly free after it.
8. **OpenAI GA / legacy / WebRTC** — server-given boundaries, native capture.
9. **OpenAITranslateWebRTC** — the same shape as its GA twin over native capture.
10. **VolcengineAST2** — adds nothing new to the model.

That is all twelve. Each step is its own implementation plan; this spec is the
design for the whole, not the plan for any one stage.

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

The design above now says what a client emits, what it receives, and who builds
that request. It does not yet say in what order a session starts.

- **Session lifecycle.** `connectConversation` is one 1,181-line function. Who
  starts a session, in what order, how the two legs come up together, how a
  failure unwinds, and where the managed Soniox lease lives — its
  `session` / `sttRole` / `announcesSessionOutcome` are a collaborator the
  adapter reports billing events to, not configuration. The turn (gating, voice
  count, begin / end / cancel) also lives here, and so does everything the
  provider definition hands over because it spans both legs or outlives one
  call: the local engines' memory budget across legs, Soniox's shared Both, the
  managed voice claim, and the devices a WebRTC adapter captures from and plays
  to. `LocalNativeClient` reading and writing `useNativeModelStore` inside
  `connect()` moves out of the adapter into its builder, per the definition's
  rule that model resolution never happens in an adapter; Local Native is not
  yet open to general users, so it carries no compatibility burden.

### Parameters and deferred decisions

- **Soniox's shared Both.** One client serving both legs, with energy-based side
  attribution. It exists for cost — `SonioxCostMeter.ts` records that a split
  Both session is budgeted at roughly twice a single-stream one — and it is a
  user-visible setting. It does **not** force a `leg` field into the contract:
  the client can expose two event sources over one socket, which is cleaner than
  today's `createSecondaryPort()` shell whose `getConversationItems()` returns
  `[]`. Keeping or dropping it is a cost decision, not an architectural one.
- **The pcm retention ceiling.** A duration, a byte budget, or both; and what the
  default is.
- **Whether `marks`' compaction threshold is a constant or follows the
  configured pause.**
- **Whether the raw pre-punctuation text is worth keeping** for diagnostics. No
  runtime consumer needs it once ranges are re-anchored.
- **`origin` inference thresholds** — the overlap fraction that counts as a
  pair, the time window for proximity, and what breaks a tie between two
  candidates.
- **Testing strategy** — how L1 and L2 are tested as the pure parts they are,
  how the display is tested without a live provider, and what a fake client
  looks like.
- **What analytics remain.** `translation_count` and latency are gone;
  `translation_session_start` / `_end` and the `sentence_segmentation_*` fields
  still need a source in the new structure.

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
  not assume a group is a real pair.
- **Karaoke's honesty depends on producers being honest.** A client that reports
  a `range` it does not actually know reintroduces the fake alignment this design
  deletes. The rule is one line: report a `range` only when the producer knew
  which characters the audio speaks.
- **A long-lived branch that outlives its welcome.** Mitigated only by Stage 1
  landing quickly enough that Stage 2 can proceed provider by provider.
