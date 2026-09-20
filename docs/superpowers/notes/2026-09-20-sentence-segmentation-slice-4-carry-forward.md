# Sentence segmentation — slice 4 carry-forward (2026-09-20)

Slice 4 finishes the feature for the online providers. Plan:
`docs/superpowers/plans/2026-09-16-sentence-segmentation-4-online-and-polish.md`.
Spec: `docs/superpowers/specs/2026-09-16-sentence-segmentation-design.md`,
including Amendment A1. Previous carry-forward:
`2026-09-20-sentence-segmentation-slice-3b-carry-forward.md`.

Commits, `f7507a14..`:

| commit | what |
|---|---|
| `2d203976` | plan re-aimed at the tree it would actually run against |
| `03ee5d9c` | plan corrected: 58 of the 140 corpus items carry deltas, and no Korean does |
| `8597c43e` | Task 1 — GPT-Live: two streams, R1, R2, hard caps prefer a boundary |
| `da11fee3` | Task 1's four discoveries carried into Tasks 2 and 3 |
| `41334359` | Task 2 — the other three timer-driven providers |
| `86aceb21` | GPT-Live's silence timer re-armed for the item a seal opens |
| `b7de2167` | Task 3 — punctuation fill-in on the seven server-definite clients |
| `e2753297` | the fill-in wait bounded at `FILL_IN_BUDGET_MS` = 1 s |
| `55566aa1` | Task 6 — the threshold sweep, on 58 recorded delta sequences |
| `ebbdc1f0` | Task 5 — per-leg counters, three analytics events, diagnostics |
| `f9c792dc` | the download confirmation's buttons wrap instead of clipping |
| `0cf4bf76` | **fix pass** — the last sentence is written raw when Stop lands in the wait |
| `47709474` | **fix pass** — the two translate clients stop segmenting their assistant side |
| _this one_ | **fix pass** — fixes 3-7 and this note |

## What slice 4 shipped

**Display segmentation on four timer-driven clients.** `OpenAILiveClient`
(GPT-Live), `OpenAITranslateGAClient`, `OpenAITranslateWebRTCClient` and
`GeminiClient` each feed a `SentenceStream`; a seal closes the open conversation
item at the cut and the remainder opens the next one. GPT-Live keeps both sides;
after the fix pass the two translate clients segment the source side only (see
below). Gemini keeps both sides.

**Punctuation fill-in on seven server-definite clients.** `SonioxClient`,
`VolcengineAST2Client`, `VolcengineSTClient`, `PalabraAIClient`,
`OpenAIGAClient`, `OpenAIClient` and `ZoomAIClient` call the shared
`punctuateDefinite` helper. The boundary the server chose is never touched — the
spec's D6 — and only the text changes. The wait is bounded at 1 s
(`FILL_IN_BUDGET_MS`), above the benchmark's slowest measured call (394 ms, zh,
480 characters, 4-thread WASM); past it the raw text is shown and a late answer
is discarded. Six of the seven share a `createSegmentLane()` so two segments that
became definite in order cannot be listed out of order; Zoom needs no lane
because its `utteranceChain` already runs one utterance at a time.

**Diagnostics and analytics.** One `SegmentationRuntime` per app, wrapped once
per leg by `instrumentSegmentation` so MainPanel can count model calls for free,
with `SentenceStream` and `punctuateDefinite` reporting seals and raw-text
measurements back through `runtime.observe()`. `translation_session_end` gains
`segmentation_seals`, `segmentation_model_calls` and
`segmentation_terminals_per_100`; `segmentation_model_load` and
`segmentation_models_download` are their own events. Counts only — no transcript
text crosses any boundary, by construction.

**Thresholds measured (Task 6).** R = 8 stays, with its cost now known
(0.97-2.29 s per boundary) rather than assumed. Korean turns out to be the
best-fitting language of all — CJK-classed at 20 characters per sentence,
measured 19.7 — so nothing moves. Details in
`2026-09-14-asr-punctuation-benchmark.md`.

**Task 7 (real-environment validation) has not been run.** Nothing here has been
exercised against a live session on any platform.

## The two rulings

**R1 — with the stage active, the N-sentence seal replaces the per-sentence
cut.** GPT-Live already ended an item at every sentence end it saw, which is
N = 1 by another name, and leaving that in would have made the setting inert for
the one provider the feature was designed on. So for a session whose stage is
active the stream's seal decides where an item ends and the per-delta
`lastSentenceEnd` split is skipped; the pause rule, the soft cap, the hard caps,
the silence timers and `turnComplete` are untouched. With the stage off, not one
line of today's behaviour changes.

**R2 — one frozen answer per session.** `runtime.enabled` is "toggle on AND all
three models on disk AND memory guard passes" and it flips both ways under an
open session. Slice 3b lost a whole session's transcripts to two reads taken at
two moments. Every client this slice touched builds ONE frozen view at connect
(`sessionSegmentation`) and hands it to every stream and every fill-in call.
Gemini additionally keeps the frozen view across its own reconnect, behind
`segmentationFrozen`.

## The fix pass after review

A whole-branch review found seven defects. All seven are fixed, in the three
commits at the bottom of the table above.

1. **A session ending inside the punctuation wait lost the user's last
   sentence** (HIGH). Task 3 guarded every deferred write with
   `if (this.sessionSegmentation !== runtime) return;`, and disconnect() drops
   that identity — so pressing Stop inside the window meant Volcengine ST and
   AST2 never pushed the item at all, OpenAI GA left the user bubble empty and
   `in_progress`, Soniox left it `in_progress`, and Palabra kept the partial text
   instead of the validated one. MainPanel's teardown is
   `await client.disconnect()` then `setItems(client.getConversationItems())`, so
   that text was simply gone from the conversation the user keeps. The lane now
   takes a raw fallback per queued piece (`lane.queue(work, writeRaw)`); every
   `disconnect()` calls `lane.flush()` first, which runs the not-yet-written
   fallbacks synchronously in arrival order and tells their punctuated
   counterparts they were cancelled. Stop does not get slower: the flush never
   awaits the model. The session-token guard stays for the case it was actually
   for — a reconnect, whose answer is genuinely stale.
2. **The two translate clients sealed the assistant side without an audio
   hand-off** (MEDIUM-HIGH). They copied GPT-Live's assistant-side seal but not
   its `pendingAudioItems` queue, which is the thing that keeps a closed item
   receiving frames until its per-item timeline end passes. Their deltas carry
   no timing at all, so there is nothing to rebuild that from: audio for a sealed
   sentence attached to the next bubble and put every later karaoke highlight one
   bubble out. The assistant-side stream and seal are removed from
   `OpenAITranslateGAClient` and `OpenAITranslateWebRTCClient` only; the source
   side is exactly as Task 2 built it. Gemini was checked before being left
   alone: it writes no `audioSegments`/`audioTextEnd` at all, so it has no
   per-item audio timing to get wrong, and `closeAssistantSegment` already split
   the assistant item on its own idle timer before the stage existed.
3. **The stage biases its own latency measurement** (MEDIUM). MainPanel measures
   `translation_completed.latency_ms` and `latency_measurement` from the item's
   `createdAt` to the first update showing it `completed`, and Task 3 moved that
   flip behind the model call — so with the stage active both figures carry up to
   1 s of fill-in wait. MainPanel fires on every completed update with no dedupe,
   so assign-then-patch would double-count instead. Documented under both events
   in `docs/ANALYTICS_EVENTS.md`, with a comment at `OpenAIGAClient`'s deferral
   site pointing there.
4. **Three spec items were console-only** (MEDIUM-LOW). The spec asks for
   download durations, load durations and seal reasons in LogsPanel with
   diagnostic logs on; all three shipped as `console.info`, two of them ungated.
   `report.ts` is the wrong route — none of the three is a failure — so all three
   now also go through `addRealtimeEvent`, which rides the events stream LogsPanel
   shows and "copy logs" exports, and which self-gates on the diagnostic-logs
   switch. Three new `EventData` types: `segmentation.pack.downloaded`,
   `segmentation.model.loaded`, `segmentation.seal`. The console lines are
   unchanged. No transcript text.
5. **Soniox routed an untagged translation to the source language** (LOW).
   `completeItem` fell back to `sourceLanguage` for both legs, so a translation
   batch Soniox did not tag picked the wrong punctuation model. The assistant leg
   now falls back to the configured target language.
6. **`SentenceStream.observe()` had no error barrier** (LOW). A throwing observer
   propagated out of `seal()` into whichever client's delta handler was on the
   stack and lost the item — a chunk of conversation, for a counter nobody
   renders. The call is wrapped in try/catch.
7. **Soniox's lazily minted completed item was dated at write time** (LOW).
   `<end>` arriving in the same message as its finals mints the item inside
   `completeItem`, so its `createdAt` was stamped after the model call and could
   sort after the next utterance's. It is captured before the await now, the way
   the Volcengine clients already do.

`OpenAIGAClient` and `VolcengineSTClient` got their first test files out of fix 1.

## Not fixed, and why

Five things the review named that this pass deliberately leaves alone.

1. **PostHog key hygiene on a server-supplied language string.** `slug()` in
   `segmentationTelemetry.ts` replaces whitespace and nothing else, and the
   language on a `definite` observation comes straight off the wire —
   Volcengine's `subtitle.Language`, Soniox's `token.language`. A tag containing
   a `.` or a `$` would land inside a PostHog property key and be awkward to
   query. `test_…'carries counts only'` only checks for whitespace. Harmless with
   every tag seen so far; the fix is one wider character class when a real tag
   breaks a query.
2. **The counters survive a start that never reached a session id.**
   `segmentationCountersRef.current.reset()` lives inside
   `if (sessionId !== null)` in the session-end branch, and the counters begin
   filling when the clients are created — which is before `isSessionActive`
   flips. A start that fails before a session id exists therefore leaves its
   counts in the tally, and the next session's `translation_session_end` reports
   both. Rare, and it inflates counts rather than losing them.
3. **Gemini keeps a previous session's languages for a non-Gemini config.**
   `connect()` assigns `sourceLanguage`/`targetLanguage` only inside
   `if (isGeminiSessionConfig(config))`, so a config of another shape would leave
   the last session's pair in place and punctuate in the wrong language.
   Unreachable today: `GeminiClient` is only ever handed a Gemini config.
4. **Two weak tests, left as they are.**
   `punctuateDefinite.test.ts` → *"gives up on a slow model and shows the segment
   raw"* resolves the late answer after its last assertion, so the claim in its
   own comment — that a post-budget answer changes nothing — is never measured.
   `SonioxClient.test.ts` → *"leaves the item boundaries exactly where they are,
   runtime or not"* compares the stage-on run against the stage-off run and
   asserts they match, which holds just as well if both are wrong; nothing pins
   the expected shape.
5. **Most of the definite integrations still have no end-to-end test.** Three of
   the seven now do: Soniox, Volcengine ST and OpenAI GA (the last two are the
   new files from fix 1). `VolcengineAST2Client`, `PalabraAIClient`,
   `OpenAIClient` and `ZoomAIClient` have test files with no segmentation
   coverage at all — their fill-in path, and now their flush path, is asserted
   only through `punctuateDefinite`'s own unit tests.

## Other things worth knowing

- **Palabra clears `conversationItems` in `disconnect()`**, which is a
  pre-existing contract violation `GeminiClient.ts` already documents by name
  (MainPanel's teardown reads the list *after* `disconnect()` resolves, and
  `reset()` is the dedicated clearing step). Fix 1 puts Palabra's `lane.flush()`
  at the top of `disconnect()`, so the validated text reaches the item and the
  `onConversationUpdated` listener; whether the item survives to
  `getConversationItems()` is that older bug's business.
- **Zoom's fill-in is awaited inline, not laned**, so it has no flush. A Stop
  inside its wait still drops the utterance — but so does a Stop at any of the
  other `if (!this.connected) return` checks that surround its two REST calls,
  and those predate the stage. Left alone deliberately: a Zoom utterance is
  already held for a transcribe round trip and a translate round trip, seconds
  each, so the fill-in adds at most one second to a window that was always
  wide. Fixing it means giving Zoom the lane, which is worth doing the day its
  REST calls stop being the dominant term, and not before.
- **`FILL_IN_BUDGET_MS` is an engineering default, not a measured number.** Task
  6 measured the model; nobody has measured how long a user will accept an empty
  bubble.

## Gates at the end of the fix pass

- `npx vitest run --exclude ".superpowers/**"`: 372 files, 4700 tests passing,
  plus the four pre-existing unhandled rejections in
  `settingsStore.nativeGate.test.ts`.
- `npx tsc --noEmit 2>&1 | grep -c "error TS"`: 319, the baseline.
