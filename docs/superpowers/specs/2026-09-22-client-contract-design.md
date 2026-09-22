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
- Audio output gets an explicit **routing table**. Volume stops being used as a
  control; the only real volume left in the system is the passthrough ratio.
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
// received by the client
connect(config): Promise<void>
disconnect(): Promise<void>
appendAudio(pcm: Int16Array): void        // 24 kHz mono
appendText(text: string): void
finalizeTurn(): void                      // PTT release
cancelTurn(): void

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

---

## L1 — the data model

```ts
interface Segment {
  id:        SegmentId              // `${leg}:${n}`, a counter
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
the leg is ambient.

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

`` `${leg}:${n}` ``. The leg qualifies the counter, so cross-leg collision is
impossible and `instanceId` prefixes, uuids, `Date.now()` minting and the
shared-timestamp convention all lose their reason to exist. Player clip keys are
`` `${leg}:${segId}:${speechIdx}` ``.

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
(legA.segments, legB.segments, notices, settings) → Entry[]

type Entry =
  | { kind: 'exchange'; id; pairing: 'stated' | 'inferred' | 'none';
      source: Row[]; translation: Row[]; t: number }
  | { kind: 'notice'; id; severity; message; at: number }
```

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

**`origin` inference lives here**, because it is a pure function of the segment
lists: pair by maximum overlap when both sides carry `timing`, otherwise by
temporal proximity, otherwise leave the group unpaired. `pairing` is a property
of the group, never of a segment.

**Unpaired is the common case, not an error.** The translation always lags the
source, so "source rows, no translation yet" occurs every few seconds. A source
cut into three rows beside a translation cut into two is likewise ordinary — the
two sides are separate arrays and need not be the same length.

**The export consumes this projection.** The saved file and the screen therefore
agree by construction rather than by two implementations kept in step by hand,
and `conversationExport.ts:152`'s silent dropping of every non-`completed` row
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

The other clients are **deleted**. Each is recovered from git history when its
turn comes, and read to learn the protocol rather than ported.

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

## Open questions

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

## Risks

- **The display model is only validated by Stage 1.** If it is wrong, it is wrong
  before any provider but the first. This is why Stage 1's acceptance covers all
  three surfaces rather than the data layer alone.
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
