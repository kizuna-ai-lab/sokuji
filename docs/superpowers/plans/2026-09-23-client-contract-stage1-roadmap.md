# Client contract — Stage 1 roadmap

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md`

Stage 1 of the spec ("the new spine and one provider, end to end") spans five
subsystems that can each be built and tested on their own. It is therefore
five plans — thirteen, since the runner splits from capture and playback (the
runner tests with a fake source and a recording sink; the audio side needs a
live device), playback splits from capture (the passthrough route and the
echo monitor's reference live in playback's graph, so it comes first), the
surfaces split three ways (the view every surface shares with the panel's
list; the two subtitle surfaces and their wire; export and auto-save), and 1e
splits five ways (the runner's and the audio's loose ends; LocalInference in
the preview; its sentence-cut jobs; the switch-over; the extension) — executed in this order. Each
plan leaves the tree green and its own layer usable; none of them touches the
old clients, which keep working until plan 1e-3 replaces MainPanel's session
path.

| Plan | Builds | Proven by |
|---|---|---|
| **1a — the spine** (`2026-09-23-client-contract-stage1a-spine.md`) | L0 contract types, the fake adapter and its script format, the conformance checker, L1 (`Conversation`), L2 (`project`), the export writer | vitest only: the fake's scripts are the fixtures |
| **1b — the provider definition** | `Provider<S, K, C>`, the registry, generic settings and credential storage, the credential form, the language section, readiness (`check`), `VITE_ENABLED_PROVIDERS`, the fake as the first registered provider | vitest, plus the settings panel rendered against the fake |
| **1c-1 — the runner** (`2026-09-24-client-contract-stage1c1-runner.md`) | `sessions.*`, the run and its resource stack, the source and playback ports, the fake source, the turn object, the session hooks, analytics, the global turn mode | vitest with fake sources and the fake adapter; a live fake session in the preview, read but not heard |
| **1c-2 — playback** (`2026-09-24-client-contract-stage1c2-playback.md`) | the clip queue, one Web Audio graph (five feeds, two buses, routes as gain edges), the route table and its two new switches, replay, the preview route and the test tone, the extension's virtual microphone from the virtual bus, the tts tap — behind the playback port | vitest with a recording Web Audio; the preview's fake session heard, checked headlessly by `scripts/dev/spine-audio-probe.mjs` |
| **1c-3 — capture** (`2026-09-24-client-contract-stage1c3-capture.md`) | real sources (mic, system audio, tab) behind the source port, device switching and mute inside them, `ended` / `degraded`; the passthrough source into playback's route; the echo monitor on the source taps and playback's tts tap | vitest with fake media; headless Chromium's fake microphone; a live device |
| **1d-1 — the conversation view and the panel list** (`2026-09-24-client-contract-stage1d1-conversation-view.md`) | rows that carry their text, typed notice codes and the frames port, one throttled view of the conversation, karaoke from the clip queues, the display filter, notices in words, the panel's conversation list | vitest; the preview's list, checked headlessly by `scripts/dev/spine-surface-probe.mjs` |
| **1d-2 — the subtitle surfaces** (`2026-09-24-client-contract-stage1d2-subtitle-surfaces.md`) | the shared subtitle view over `Entry[]` (bands joined by script, karaoke), the Electron takeover and the extension overlay on one typed wire (`Entry[]`, the run's state, karaoke), the overlay's hold-to-talk button, the subtitle idle states from the run's state | vitest; headless Chromium: the overlay in a page, fed over a `MessageChannel` wire |
| **1d-3 — export and auto-save** (`2026-09-24-client-contract-stage1d3-export.md`) | the export menu over the new writer (per-leg scope, header and metadata, clipboard, download), auto-save from `onRunEnded`, the panel's idle line (why the last run ended, in words) | vitest; the files a fake session exports |
| **1e-1 — runner and audio hardening** (`2026-09-24-client-contract-stage1e1-hardening.md`) | the run's loose ends before a real provider (the "1e" items in the sections below that need no provider): every leg's open awaited before unwinding, `abandon()` on `pagehide`, one overall close bound, `ensureReady` from the shape with a signal, `check` with the pair, model-load progress in `RunState`, per-leg `connection_status`, redacted analytics, failed notices in words, replay cleared where the conversation is replaced, live `keepReplayAudio`, passthrough from the leg going live, an idempotent graph close, the context suspended while idle | vitest; the preview |
| **1e-2 — LocalInference** (`2026-09-25-client-contract-stage1e2-local-inference.md`) | its definition and adapter over today's pipeline (engines and workers unchanged): settings composed from the shared fields, `check` with the pair, `build` / `describe`, turns with its own silence tail, the translation-job cut, TTS and model loading; plan 1a's conformance items | vitest; a live local session in the preview |
| **1e-2b — LocalInference's sentence-cut jobs** (`2026-09-25-client-contract-stage1e2b-sentence-jobs.md`) | today's stream shape: a translation job every N sentences inside an utterance (the seal cursor, the truncated re-decode guard, the voxtral endpoint coupling), over the runner's punctuator; until it lands a size of 1–5 behaves as Auto | vitest over scripted partials; a live long utterance in the preview |
| **1e-3 — the switch-over** | MainPanel, the Electron takeover and export on the runner; the other clients and their descriptors deleted (spec: "Migration"); stored settings mapped; the three tests that read MainPanel's source replaced | a live local session on Electron |
| **1e-4 — the extension** | the side panel publishes the wire and the overlay renders `SubtitleView`; the virtual microphone checked in a real Meet tab | a live local session in the extension |

Interfaces that cross plan boundaries are named in each plan's `Interfaces`
blocks. The ones fixed here, so a later plan never has to guess:

- `src/lib/contract/adapter.ts` — `Adapter<C, K>`, `StartRequest<C, K>`
  (`{ context, config, credentials, input?, clock, signal }`),
  `AdapterSession`, `AdapterEvents`, `SessionContext` (plan 1a; everyone
  consumes).
- `src/lib/contract/events.ts` — `AdapterEvent` (the tagged union),
  `eventsFrom(listener)` (plan 1a; the runner consumes).
- `src/lib/conversation/Conversation.ts` — `Conversation` (one per leg),
  `Leg` / `Segment` / `Notice` (plan 1a; the runner owns instances, the
  surfaces read `Leg`).
- `src/lib/projection/project.ts` — `createProjector()` → `project(legs,
  settings)` → `readonly Entry[]` (plan 1a; the surfaces consume).
- `src/providers/fake/adapter.ts` — `createFakeAdapter()`; its timers run on
  the `clock` passed in `StartRequest` (plan 1a; plan 1b wraps it in a
  definition, plans 1c–1d drive it).
- `src/lib/contract/clock.ts` — `Clock`, `createVirtualClock()` (plan 1a; the
  runner and every timer consume).

## Carried out of plan 1a

Plan 1a landed as commits `061237ed..5747d6c1`. Its final review raised items
that belong to the plan which first consumes them; each later plan picks up
its list below before its own tasks are written.

**1b — the provider definition**
- The comment on `TEXT_REF_BASE` in `src/providers/fake/adapter.ts` still
  describes a fixed base; typed-text refs now start past every script ref.

**1c — the runner**
- `Conversation` needs a runner-facing `notice({ severity, message, code,
  params })` (source ended, lease end), and a retention setter, because the
  spec has `keepReplayAudio` take effect immediately while `opts` is fixed at
  construction. Add `params` to `Entry`'s notice variant and to the export
  JSON, and derive the export's notice shape from `Entry` instead of
  repeating it.
- `Conversation.notify()` does not isolate listener errors: a throwing
  subscriber propagates into the adapter's event callback, or becomes an
  unhandled rejection from the fill-in `.then`.
- `Conversation.settled()` has no bound; the runner bounds it (timeout or
  signal) wherever it awaits it.
- The fake's `start()` does not re-check `signal.aborted` after
  `startDelayMs`, and the abort test does not assert that the cancelled timer
  stays silent. The unwind tests cover both, plus a per-kind table test for
  `play()`'s untested branches (degraded, reconnecting, reconnected, closed,
  loading, busy, frame).
- `degraded` notices are not de-duplicated; throttle them by `code`. Their
  severity comes from `CLIENT_DIAGNOSTICS` while the spec says "warning from
  `degraded`"; confirm which wins.

**1d — the surfaces**
- A `Row` has no text, no `final` and no detected language, so the overlay
  cannot render from `Entry[]` alone. Decide whether `Row` carries its text
  slice (plus `final` and `language`) or the port ships a segment table next
  to the entries. Decide it together with `sameRows`, which compares `key`,
  `segmentId`, `side`, `start` and `end` by value: an entry keeps its identity
  when its text changes at the same length or its segment turns final, so
  until then L3 joins rows to segments itself.
- An open segment is always one row in sentences mode; the spec says an open
  segment "ends in" one live row. As built, the whole segment re-cuts at
  close and its rows get new keys. Confirm the reading.
- Empty text yields a `[0,0]` row, i.e. an empty bubble or export line;
  decide whether L2 or L3 filters it.
- Coalesce `project()` per animation frame; driven directly it would run on
  every audio chunk.
- A timing- or language-only change with unchanged text still pushes a growth
  mark (`mark: seg.text !== text` fixes it), and a letters-changed rewrite can
  map a mark into the middle of a word. Both affect pause-mode cuts only.
- `reanchor` keeps ranges only when the skeletons are equal; "the new
  skeleton starts with the old" would keep karaoke ranges when a translation
  is re-punctuated while it grows.
- `clear()` resets `speech` to `[]`, so clip keys restart for the kept open
  segment, and the next whole-text snapshot restores the cleared text.
  Confirm both are intended.
- `joinTexts` tests single UTF-16 units, so an astral Han character (𠮷) gets
  a space beside it.

**1e — LocalInference (conformance on a real adapter)**
- Ranges are checked against the text at arrival, which drops legitimate
  ranges when audio overtakes its text, and pending audio's range is never
  checked. Replace both with a check against the text at close (and on later
  revisions), in `Conversation` and in the conformance checker alike.
- Conformance gaps: a `close` for a ref that never opened, audio on a
  source-side ref, and the frame `type` convention (`domain.event`).
- The credential rule matches key names only. Also test string values with
  `redact(v) !== v` from `src/lib/diagnostics/redact.ts` (URLs with
  `?key=AIza…`, `Bearer …`, `sk-`/`ek_` values, `x-api-key`,
  `refresh_token`), widening the checker's imports by that one leaf module.
- Once over the pcm ceiling, `afterAudio` rescans from segment 0 on every
  chunk; keep a trim cursor, reset in `clear()`.
- Re-mapping marks costs O(marks × text length) per non-prefix rewrite;
  LocalInference re-decodes, so measure it there.

**Stage 2, before the first provider that relies on inferred pairing**
(OpenAITranslateGA)
- Pairing inference is O(S×T) on every `project()` call for the leg that
  changed; the spec requires re-evaluating only the segments that changed.
  Window it, state the opening-order assumption it shares with `inferPairs`,
  and add boundary tests at `minOverlap` and `proximityMs`.

## Carried out of plan 1b

Plan 1b landed as commits `9f57de76..2673e818` (nine tasks, one fix round,
and the final-review fix wave). Its final review raised these for later plans.

**1c — the runner**
- Extract `readCredentials(p, auth): K | { missing }` from
  `refreshReadiness`, which holds the rule that `read` sees exactly the fields
  `fields(s)` shows; the runner needs `K` at start and must not re-implement
  it. A `credentials.read` that throws should become a not-ready answer
  there, not a rejected promise.
- Constrain `K extends { missing?: never }` and `C extends { refused?: never }`
  at the type level, so the `'missing' in` / `'refused' in` checks rest on the
  compiler instead of a documented convention.
- A `disabled` prop for `CredentialForm`, `LanguagePairSection` and the
  provider select, driven by the run's state.

**1e — LocalInference and the switch-over**
- Readiness per direction: today's local readiness asks whether the models
  for the speaker's (and participant's) direction, and TTS, are ready, but
  `check(k, s)` cannot see the pair, and `setPair` does not reset readiness.
  Decide between passing the pair to `check` (and resetting on `setPair`) and
  letting per-direction model gaps surface as a `build` refusal while `check`
  covers engine readiness only.
- The import rule's scope: "`src/providers/**` imports nothing from
  `src/stores/**`" is meant as "never `settingsStore` or `providerStore`"; a
  provider's own stores (`modelStore`, `nativeModelStore`) are its own
  business (spec: "A provider's own stores are its own business").
- `normalizePair` throws on an empty `sources` or `targets` list, and the
  registry invariant is checked on `defaults` only; catalogue-driven lists can
  be empty.
- Lazy-load `SpinePreview` inside its DEV branch, so a release bundle carries
  neither it nor its stylesheet.
- A provider-switching test for `ProviderPanel` (two providers; the second
  loads and its own `Settings` mounts), once the choice persists under
  `settings.common.provider`.

**Stage 2**
- Before the first provider with a model choice (OpenAI, Gemini, the
  compatible provider): pass the models `check` found into `SettingsProps` and
  into `build` (through `SharedSettings` or the run's shape), so the settings
  component and the builder can call the same effective-model function.
- With the first managed twin: reset readiness when sign-in changes, and test
  readiness caching for `kind: 'managed'`, including the `auth.signedIn` part
  of the cache key.
- With Palabra: `migrate(stored)` cannot tell "absent" from "default" and
  cannot see credentials, both of which Palabra's `authMode` migration needs.

## Carried out of plan 1c-1

Plan 1c-1 (the runner) landed as commits `109bd75c..10ef1c81`: ten tasks,
five fix rounds and a final-review fix wave. Its reviews raised these for
later plans.

**1c-2 — playback** (all four are plan 1c-2's Task 1)
- First, a test: "a playback port that throws on audio does not reach the
  adapter" (`src/lib/session/runner.test.ts`) advances the clock only to
  600 ms, before the fake's first audio, so it passes against unguarded code.
  Advance past the first audio and assert the port was called. Likewise the
  analytics-port test throws only on `translation_session_end`: make `track`
  throw on every call, so "neither fails a start" is pinned too.
- The guarded `playback.audio` writes a console line on every throw; on the
  hot path, throttle the console as well as the panel.
- `PlaybackPort.held` cannot tell push-to-translate from push-to-talk, but
  only push-to-translate closes the original-voice route: pass the mode, or
  call it for push-to-translate only.
- A refused start still passes through `stopping` and `playback.clear()`,
  which would stop a replay of the kept conversation: refusals go straight
  to idle.

**1c-3 — capture**
- `Source` has no `track`, and each `StartRequest` is built before its source
  opens, so `input` is always empty: add `Source.track?` and build a leg's
  request after `openSource`, for the WebRTC adapters.
- A source's degradation reaches L1 through `Conversation.notice()`, which
  skips the per-code throttle `degraded` events get; route it through the
  throttle.
- `appendAudio` throwing escapes into the source's delivery callback (it
  stopped the fake's tick): guard the hot path and report only the ok →
  failing transition.
- The turn counts voiced time as floating milliseconds; count samples as
  integers once real, irregular chunk sizes arrive.
- From plan 1c-2: the speaker source's stream goes to
  `Playback.attachPassthrough` while its leg runs (the route and its ratio
  already exist); the echo monitor reads the sources' pcm and
  `Playback.ttsTap` (translated speech, before any route).
- Four capture stacks exist today and none detects a device loss
  (`track.onended` appears nowhere; only the app-capture helper's death is
  noticed): `ModernAudioRecorder` (48 → 24 kHz, RNNoise / GTCRN, a
  ScriptProcessor fallback that skips both), `WebRTCAudioBridge`,
  `VoiceCreateModal`'s own ScriptProcessor, and the participant recorders
  (Electron app / device / loopback capture, the extension's tab capture).
  The map with line references is
  `docs/superpowers/notes/2026-09-24-audio-stack-current-state.md`; mute is
  enforced nowhere in the audio layer.

**1d — the surfaces**
- `busy` (the responding indicator) and `frame` (the Logs panel) are
  ignored by `Conversation` and `Run`: give `RunState` a per-leg busy and
  `RunnerDeps` a frames port.
- Notice codes mix kebab-case (refusals: `not-ready`, `start-failed`) and
  snake_case (leg ends: `source_ended`, `lease_ended`): unify them and type
  the runner's own codes as a union before locale keys exist.
- `build` / `admit` refusals are bare English strings: consider
  `{ refused, code?, params? }` so the idle surface can localize them.
- The conversation-replacement rule: a start that fails after opening
  replaces the conversation with empty legs, a refused one keeps it.

**1e — the switch-over**
- First, before the close handshake and Stage 2's first managed provider: a
  run waits for its opening before unwinding only when it has one leg. With
  two, `Run`'s `Promise.all` over the legs (and over `startBoth`'s sources)
  rejects at the first leg to see the abort, so the other leg, still opening,
  is released after the lease and after `stop()` resolves. Keep each leg's
  in-flight open and await them all (`allSettled`, bounded) before unwinding;
  keep `Promise.all` for the start's own outcome, so D22 still fails fast.
- A stop during `checking` (or a `prepare` that ignores its signal) now waits
  up to `timeoutMs` in `stopping`, since `ensureReady` cannot be cancelled;
  the check-signal item below removes it.
- A lease that ends before the `opening` step has no leg to record its notice
  on; it survives only in `lastEnd`.
- `pagehide`: `ResourceStack` unwinds one release at a time, so a leg whose
  `stop()` awaits the network blocks the lease below it. Add a synchronous
  `ResourceStack.abandon()` / `Runner.abandon()` (fire every remaining
  release now, in reverse, without awaiting), and the adapter rule "`stop()`
  closes its socket before its first `await`", so the lease's `keepalive`
  release goes out.
- `loading` drives the starting step's model-load progress: route it into
  `RunState`.
- The close handshake needs its own overall bound: `stop()` can take the sum
  of the per-release timeouts, plus the fill-in wait, plus `onRunEnded`'s.
- `onRunEnded` failures reach only `reportError`: a failed auto-save becomes
  state the idle surface shows.
- `ensureReady` reads the store's live entry, not the shape: pass the
  shape's settings and credentials, with the signal.
- `connection_status` sends identical events per leg: add a `channel`, and
  align `duration_ms` (the old path's connect latency, the runner's session
  length). The two-leg `disconnected` loop is untested.
- Analytics string values are not redacted port-wide (`api_error` is): have
  the app's `AnalyticsPort` redact every string value.
- `providerStore.select()` has no phase guard: the sign-in auto-switch must
  not change the provider mid-run. Load `turnModeStore` and `providerStore`
  before the first start; `persistIfUnchanged` resets readiness to unknown
  in the middle of a start.
- Lazy-load the preview's modules: `turnModeStore`'s store and
  `SpinePreview.scss` ride into the release bundle through `App.tsx`'s static
  import.

**Stage 2**
- A `startBoth` rejection is wrapped as `LegOpenError(legs[0])`, naming the
  first leg whichever failed: let the provider name it (Soniox).

## Deferred by plan 1c-2

Plan 1c-2 (playback) landed as commits `80a7ed74..15ded883`: eight tasks,
two fix rounds and a final-review fix wave; its ruling that a clip is one
speech entry, with no `seal`, is now in the spec ("The clip queue"). It
leaves these to the plans that first need them. Its capture-side items are
under "Carried out of plan 1c-1" → 1c-3 and "Deferred by plan 1c-2 — for
1c-3" below.

**1d — the surfaces**
- The footer's output waveform reads `ModernAudioPlayer`'s analyser today
  (the signal sent to the virtual microphone, before the monitor gain): give
  the graph an analyser on the virtual bus when the footer moves over.
- Karaoke reads `QueueView.position()`, which runs on the context's clock;
  what the user hears lags it by the output element's latency. Measure it
  and offset, or accept the lag, when karaoke is drawn.
- A clip key is `${leg}:${ref}:${index}`, the index being the speech entry's
  position in `Segment.speech`; karaoke maps a key to a segment by leg and
  ref, and to its range by index.
- The four voice-preview sites (`VoiceLibrarySection`,
  `SonioxCloneReviewStep`, `VoiceCreateModal`, `nativeVoiceStores`) fold
  into `Playback.preview` as each provider's settings component is written
  (Stage 2); the test tone already moved (`AppAudio.testTone`).
- There is no `seal` (spec "The clip queue", amended): `position()` is null
  in a gap between one segment's clips, and some engines leave up to ~2 s
  between chunks. Decide what karaoke and the playing indicator show in such
  a gap — from the queue's positions and the segment's `final`, not a timer
  guessing inside the player.
- Surfaces should not parse `ClipKey` strings: give them a structured
  `Playing` (`{ leg, ref, index, t }`) or one parse helper.
- `participantSpeech` is frozen in the run's shape but live in the route:
  toggled on mid-run nothing arrives, toggled off the clips still play into
  a feed with no route (and reach the tts tap). Lock it while a run is on,
  with the other settings "What may change during a run" does not list.

**1e — the switch-over**
- `ModernAudioPlayer` recovers a wedged `AudioContext` (#246: a `suspended`
  state that never clears, rebuilt up to three times with the sink and
  volume re-applied); the new graph only resumes. Port the recovery, or
  prove it is no longer needed, before the old player is deleted.
- The speaker leg's `SessionContext.speech` is `!textOnly` today; with
  routes it can follow them (no speech when neither the meeting nor the
  monitor hears it). Decide when mapping the old settings.
- `keepReplayAudio` should take effect during a run (spec: "What may change
  during a run"): subscribe the runner to it and call
  `Conversation.setRetention`.
- `routingStore` must be loaded before the first start, as
  `turnModeStore` must.
- A run replaces the conversation at `opening`, but a replay of the previous
  conversation keeps playing into it, and refs restart per session, so its
  clip keys alias the new run's segments: clear the replay where the
  conversation is replaced (a refused start never gets there, so ruling 8
  holds).
- Ruling 4 makes replay, preview and the test tone audible in participant
  and both modes, where today the mode silences them; with whole-system
  participant capture, a replay during a run is captured and translated
  again as "Other". Accept it, or gate replay while the participant leg
  captures the whole system.
- Make `AudioGraph.close()` and `Playback.dispose()` idempotent before
  anything calls `dispose` (a closed `AudioContext` rejects a second
  `close()`).
- The extension's virtual microphone now receives the virtual bus as one
  real-time stream (100 ms messages) instead of faster-than-real-time
  bursts: before the switch-over, check it in a real Google Meet tab, with
  passthrough on at a low ratio, for gaps from page-side scheduling jitter.
- Once built, the page's context renders forever and its two taps post
  twenty messages a second: suspend it while idle.
- `scripts/dev/spine-audio-probe.mjs` asserts only what happens before the
  routes (queue positions, the tts tap), so a routing or sink failure still
  passes it; a routed-output check needs a tap on a bus.

## Deferred by plan 1c-2 — for 1c-3

- `ttsTap` has one reader and fills to its 30 s cap before anyone reads it:
  the echo monitor must be its only reader and must drain it when it starts
  (today's tap is created fresh per capture lifecycle). The development
  preview's probe also drains it.
- `attachPassthrough(stream)` plays whatever stream it is handed. Today the
  meeting hears the processed microphone (after RNNoise / GTCRN); handing
  over the raw `getUserMedia` stream would drop app-side noise suppression.
  Decide explicitly; a processed graph's `MediaStreamAudioDestinationNode`
  stream works across contexts.

Both landed in plan 1c-3: the echo watch is the tap's only reader in the app
and drains it when it first attaches; passthrough carries the processed
microphone pcm (after RNNoise / GTCRN), bounded at 0.3 s.

## Deferred by plan 1c-3

Plan 1c-3 (capture) landed as commits `f31c243f..d4332011`: nine tasks, two
fix rounds and a final-review fix wave (the GTCRN worker disposed on
release; an end while a source is still opening kept for the runner; a
stale helper death ignored; a false `begin` refused; no tab capture without
a target tab; notice listeners guarded). Its reviews leave these.

**1e — the switch-over**
- Passthrough starts when the microphone opens, not when the leg goes live:
  with passthrough on, the meeting hears the raw voice through the connect,
  including a start that then fails. Today it starts after connect. Decide it
  on purpose.
- `Playback.passthrough()` and `audio()` call `graph.resume()` per chunk;
  while an output cannot start, each failure's console line repeats per chunk
  (the dedupe key throttles only the panel).
- A fresh `ModernAudioRecorder` per open pays the worklet warm-up (~300 ms)
  and reloads RNNoise / GTCRN at every session start (the worker leak itself
  is fixed): measure it on the packaged build, or keep one recorder per page.
- The sources emit none of their analytics yet (`audio_error`,
  `audio_device_changed`, spec: "Analytics").
- `releaseMicrophone` on `pagehide`, with the `abandon()` item above.
- The echo watch prints its diagnostics line behind the
  `sokuji.echoDiagnostics` flag as today; when `ModernBrowserAudioService` is
  deleted, confirm nothing else read that flag.

**Stage 2**
- `Source.track` is the raw device track: mute and device switches happen
  downstream of it. Nothing reads it before the WebRTC adapters; before one
  does, give them a processed track (a `MediaStreamAudioDestinationNode`
  stream) that mute and switches reach.
- No test hands `startBoth` a distinct track per leg (correct by inspection):
  add one with Soniox's `startBoth`.

**Housekeeping**
- `fakeWebAudio`'s `createMediaStreamSource` / `streamSources` are unused since
  passthrough became processed pcm.
- `ModernAudioRecorder.ts` carries a TS6133 older than this branch
  (`_noiseSuppressEnabled` written, never read); the typecheck gates name
  `BaseAudioRecorder` only.

## Scheduled by plan 1d-1

Plan 1d-1 landed as commits `61c8ec8b..9e2e8b9d`: seven tasks and a
final-review fix wave. It takes up the roadmap's 1d items that the panel's
list and the shared view need, and rules on the open ones (its "Rulings"
section, amended by the fix wave: karaoke's clip duration comes from the
queue, since L1 keeps no pcm by default; a held karaoke ends when its queue is
cleared or the segment's ranges were all dropped; the cut resolves through the
selected provider's `boundaries(s)` — pause only where our silence timers end
segments, Auto as three sentences there). The `notices.*` keys and
`mainPanel.warning` were translated into all 30 locales (the parity test
requires it). What it leaves, by the plan that first needs it:

**1d-2 — the subtitle surfaces**
- A compact band concatenates one segment's rows as they are (rows tile the
  text) and puts `needsSpace` (`src/lib/projection/join.ts`) only between
  segments — never a bare space.
- The overlay's tail is sliced from the merged `Entry[]`, never per leg (spec:
  "Invariants").

**1d-3 — export and auto-save**
- The panel's idle line: `RunState.lastEnd` in words (`noticeText`). A start
  that fails after opening replaces the conversation with empty legs; a
  refused one keeps it — the idle line must show both. (Done by plan 1d-3,
  which corrected this note: a failed start's notice is *not* on a leg either
  — the runner's `end()` writes it only to `lastEnd`.)

**1e — the switch-over**
- Have a native reader spot-check the 29 translations of `notices.*` and
  `mainPanel.warning` (written by a model, reusing each locale's own terms)
  before the new list reaches users.
- `failed` notices are never in words: L1 records the adapter's `code`
  (undefined, or `auth` / `rate_limit` / `network` / `server` / `client`),
  none of which has words, so the list shows the adapter's English. Default
  L1's failed code to `leg_failed`, add words for the five API error types, or
  both.
- Per-row memoization before the list goes into `MainPanel`: every karaoke
  tick (10 Hz) and view flush (20 Hz) re-renders every row today (`React.memo`
  on the row with stable callbacks; `displayItems` reusing an item while its
  row, header and end flag are unchanged). Measure with the fake's `long`
  script.
- A letters-changed rewrite can map a growth mark into the middle of a word
  (`Conversation.replaceText` remaps by counting skeleton characters), leaving
  a pause cut mid-word after an ASR re-decode — LocalInference re-decodes.
- A leg whose TTS stops mid-segment while the run goes on keeps its karaoke
  hold until the next clip on that queue or the next clear.
- The live `canReplay` should require the segment to be final (the preview's
  does).
- Wire `RunnerDeps.frames` to `logStore.addRealtimeEvent` (it no-ops while
  diagnostic logs are off).
- The footer's output waveform: give the graph an analyser on the virtual bus
  when the footer moves over (from plan 1c-2).
- Lock `participantSpeech` while a run is on, with the other settings "What
  may change during a run" does not list (from plan 1c-2).

**Stage 2**
- `busy` has no reader: add one with the first provider that queues typed
  text while it responds (OpenAI).

## Scheduled by plan 1d-2

Plan 1d-2 (the subtitle surfaces) landed as commits `9074bd8b..38d5b884`: seven
tasks, five task fix rounds and a final-review fix wave. It built the compact
bands, the subtitle session, the overlay's wire (`src/lib/subtitle`), the
shared window handling (`useSubtitleChrome`), `SubtitleView` with the overlay's
hold-to-talk button, and both surfaces in the preview (the overlay in an iframe
over a real `MessageChannel`; `scripts/dev/spine-subtitle-probe.mjs`). The
two roadmap items it took up are done: bands join with `needsSpace` only
between segments, and the overlay's tail is sliced after the merge (keeping a
quiet leg's newest entries so no band empties). What it leaves:

**1e — the switch-over**
- Mount `SubtitleView` in `MainLayout`'s Electron takeover (from the app's view,
  karaoke and `appSubtitleSession`, with the runner's controls); the Space key
  stays the panel's.
- The extension: the side panel's surface class publishes with
  `publishSubtitles(chromePortWire(port), …)` on `chrome.runtime.onConnect`; the
  overlay entry renders `SubtitleView` over `receiveSubtitles(chromePortWire(…))`.
  The entry must also subscribe the wire's disconnect itself and keep today's
  `sokuji-subtitle:sidepanel-gone` post to the content script
  (`sessionPortMirror.ts:27-38`) — the receiver keeps its last model forever and
  would otherwise show a frozen running bar. Then `stripHeavyItemFields`,
  `recentItems`, `sessionPortMirror` and `src/types/subtitleWire.ts` go.
- Measure the wire with the fake's `long` script before it goes live in a
  meeting tab (entries coalesce at 100 ms; add an entries delta if a message
  still costs too much).
- Lock the turn-mode selector while a run is on: `appSubtitleSession` reads the
  live turn-mode store for `holdToTalk`, correct only while the mode cannot
  change mid-run (spec: "What may change during a run").
- The display-mode buttons before the first run: feed the audio mode's intent
  into the subtitle session's legs while idle, as today's `SubtitleApp` does.
- Keyboard hold on the overlay's button (Space / Enter key down and up while it
  has focus): today's panel button is pointer-only too; the overlay sits in a
  meeting page's iframe, so its focus behaviour needs its own look.
- Add `OverlayPreview` to the "lazy-load the preview's modules" item: `App.tsx`
  imports it statically too.

## Scheduled by plan 1d-3

Plan 1d-3 (export and auto-save) landed as commits `c3d48809..5ea5fb1b`: seven
tasks, two task fix rounds and a final-review fix wave. The new writer takes a
scope per leg (the display modes' union), writes a file header from the run
(`ConversationInfo`: the provider and models the run described, kept with the
conversation and carried in the view state) and puts the JSON's metadata
first, behind a `format: 'sokuji-conversation/2'` marker. Today's export menu
now draws over an `Exporter` (`ExportMenuButton`); the default `ExportButton`
keeps its props and builds a legacy exporter, so `MainPanel` and `SubtitleApp`
did not change. Today's auto-save was split so the new one
(`autoSaveConversation`, for the runner's `onRunEnded`) shares its saving
branch. A refused or failed start's reason is drawn after the list
(`lastEndItem`). The preview exports and auto-saves real files, checked by
`scripts/dev/spine-export-probe.mjs`. What it leaves:

**1e — the switch-over**
- Exactly one auto-save: the runner's `onRunEnded` → `autoSaveConversation`;
  MainPanel's session-end `autoSaveTranscript` goes with MainPanel's old
  session path.
- Delete the legacy half: `ExportButton`'s default export and its nine props,
  `SubtitleBar.exportProps`, `autoSaveTranscript`, and the old formatters in
  `src/utils/conversationExport.ts` (`buildExportPayload`, `formatAsTxt`,
  `formatAsJson`, `buildTxtExport`, `normalizeMessages`, `getActiveModelInfo`
  and their types). Keep `downloadFile`, `copyToClipboard`, `exportFilename`,
  `getAppVersion` and the two time formatters, moved next to the exporter.
  Drop the locale keys only the old format reads (`headerNote`,
  `translationSuffix`) from all 30 locales.
- Mount `ExportMenuButton` over the app's view in MainPanel's toolbar
  (`useConversationExporter`), and hand `SubtitleView` its `exporter` in
  `MainLayout`'s Electron takeover.
- The idle line is words only. Today's panel offers a way to Settings (and
  the privacy prompt) for a blocked start; the typed `lastEnd.reason` and code
  are there for it — give the notice bubble that action.
- Release notes: the .txt is one block per exchange (the source whole, then
  `→ translation`) instead of a line per message; the models line reads
  `asr=` / `translation=` / `tts=` for every provider (today's OpenAI files say
  `transcription=`); the .json is a new schema (`format`, `groups`,
  `notices`).
- A native reader spot-checks the 29 translations of
  `mainPanel.export.noTranslation` / `noSource` with the other notices.
- "Narrowed" in the header means the scope is not both/both, not that a line
  was left out: a speaker-only run with the participant filter at `none` says
  lines were left out. Today's export does the same.
- A single-side scope drops a group missing that side (today's export does the
  same); only a both-sides scope states a missing side.

## Decided for 1e (jiangzhuo, 2026-09-24)

The four "decide it" items the sections above leave for 1e:

- **Local readiness sees the pair.** `check` takes the language pair, and
  changing the pair resets readiness, so the settings panel keeps showing
  which direction lacks a model before a start (not a `build` refusal at
  start). Plan 1e-2.
- **Passthrough starts when the leg goes live**, as today: nothing of the raw
  voice reaches the meeting while connecting, or from a start that then
  fails. Plan 1e-1.
- **Replay is disabled while the participant leg captures the whole system
  during a run** (with a tooltip); idle, or with only the speaker leg, replay
  works. Otherwise a replay would be captured and translated again as
  "Other". Plan 1e-3.
- **The speaker leg's speech stays `!textOnly`**: the switch-over does not
  change a setting the user sees; folding text-only into the routes is for
  later. Plan 1e-3.

## Scheduled by plan 1e-1

Plan 1e-1 (the runner's and the audio's loose ends) landed as commits
`ab1a2c75..c0df5714`: nine tasks, two fix rounds on `abandon()`, and a
final-review fix wave that amended the plan's ruling 3. It closes these items
from the sections above: every leg's open awaited before a run unwinds;
`abandon()` on `pagehide` (every release started synchronously, legs
finalized, no auto-save, an ending already in flight preempted); one overall
stop bound; readiness from the run's own shape (`check(k, s, { pair, legs,
signal })`, the pair and the legs in the cache key, `setPair` / `setLegs`
resetting readiness, a cancelled check no failure, a run's own check never
superseded by the panel's); a stop during `checking` or `prepare` no longer
waits; model loading in the starting state; per-leg `connection_status`;
every analytics value redacted at the port; failed notices in words
(`leg_failed` by default, five API error types); `keepReplayAudio` live; the
replay cleared where the conversation is replaced; passthrough only while the
run is live (decided); playback resting once quiet, a resume never losing to
a suspend in flight; an idempotent graph close; a failing output reported once
per streak; the preview's modules out of the release bundle. The item "a
failed auto-save becomes state" is closed by plan 1d-3 (the auto-save reports
and toasts its own failure).

**The overall stop bound, as amended:** an ending that overruns
`closeTimeoutMs` (15 s) is reported and shown idle; its unwind continues in
the background, still the runner's — `abandon()` reaches it, its auto-save
saves its own legs, a start while it lingers is refused (`still_stopping`),
and `Runner.settled()` resolves once no ending is in flight or lingering.

What it leaves:

**1e-2 — LocalInference**
- `start()` aborts its model load on the request's signal: otherwise a Stop
  mid-load goes idle while the load goes on, and the next start loads a
  second copy.
- `stop()` terminates its workers before its first `await` (the adapter rule
  on `AdapterSession.stop`: `pagehide` calls it without awaiting).
- `check(k, s, ctx)` reads `ctx.pair` and `ctx.legs`: the reverse direction
  matters only when the participant leg is in `legs`.

**1e-3 — the switch-over**
- Wire `runner.abandon()` to `pagehide` and `watchLegsFromStores()` at
  startup; Electron close and update install await `runner.settled()`, not
  `stop()` alone. `settled()` resolves at once after `abandon()` — an
  abandoned unwind is no longer waited for — so never call `abandon()` on a
  path that still means to wait.
- The microphone's release awaits a pending device switch before it stops the
  recorder: make it stop capturing first (the rule now written on
  `Source.stop`).
- Port the wedged-`AudioContext` recovery (#246) knowing the context now
  suspends every idle period.
- Still open from the sections above: the provider choice locked during a run
  and the sign-in auto-switch; the stores loaded before the first start;
  `persistIfUnchanged` resetting readiness in the middle of a start; the
  sources' own analytics; the recorder warm-up measurement; frames into
  `logStore`; the replay gate while the participant leg captures the whole
  system (decided).
- The audio probe checks only what happens before the routes: add a tap on a
  bus before trusting it for a routing change.

**Stage 2**
- `RunnerDeps.replayAudio` is not guarded like the other ports; the notice
  codes (`auth`, `network`, `server`, `client`, …) share one flat namespace
  with every other code — revisit when a provider's own codes arrive.

## Scheduled by plan 1e-2

Plan 1e-2 (LocalInference on the spine) landed as commits
`70a14dbf..c027643d`: nine tasks and a final-review fix wave. LocalInference
is the first real provider on the new contract — its definition, settings and
model-management components, and an adapter over today's engines (whose only
change is a `disposed` check in `init()` and a public `onFatal` hook), run live
in the preview (`scripts/dev/spine-local-probe.mjs`: English speech → an
English source row and a Japanese translation row). It closes the three
1e-1 → 1e-2 items: the load aborts on the start's signal, `stop()` ends the
workers before its first `await`, and `check` reads the pair and the legs.

Decided while it ran (the plan's ledger has each one's cost if wrong):

- A TTS worker that dies mid-session stops speech only (`tts_degraded`); the
  text keeps flowing, as today. A lost GPU device still fails the session.
- In both-mode, readiness requires the participant direction's ASR (not its
  translation: transcription-only stays allowed), so a missing reverse model
  shows before a start — jiangzhuo's "Decided for 1e" item, over the plan's
  own ruling 5.
- Short jobs are not punctuated, as today (Auto's length gate).
- Typed text: the source segment carries it exactly, the job its trimmed
  text; blank text is dropped in `Run.sendText` for every provider. A
  session that cannot translate answers typed text with its source segment
  and one `translation_unavailable` — the conformance checker now accepts
  that answer.
- `Punctuator` lives in the contract (`src/lib/contract/adapter.ts`).
- `reanchorRanges` keeps a range past the old text only when the new text
  grew from it.

What it leaves:

**1e-2b — sentence-cut jobs** (its own plan).

**1e-3 — the switch-over**
- Readiness reasons in words by code (LocalInference's are English sentences
  today), and `no_asr`'s `{{source}}` as a language name.
- `LocalInferenceEngine` learns the legs (`effectiveMode: 'both'` today).
- A notice code of its own for typed text in an AST session (it says
  `translation_unavailable` today, worded for transcription-only).
- Wire the app's punctuator (`PunctuationRuntime`) with a `(lang, text)`
  memo: L1's display fill-in and the adapter's job fill-in ask the same
  question once per utterance.
- Redact `degraded` / `failed` messages at L1's notice sink, for every
  provider (frames are redacted; notices and exports carry worker text as it
  came).

**Stage 2**
- The resampler to 24 kHz keeps today's linear interpolation (aliasing).
- An Edge TTS worker that dies during its decode-start handshake leaves the
  engine's promise unsettled (the adapter no longer waits on it); the engine
  is where to fix it.

## Scheduled by plan 1e-2b

Plan 1e-2b (LocalInference's sentence-cut jobs) landed as commits
`a8357ecb..7ec9f781`: five tasks and a final-review fix wave. With the display
set to sentences and a size of 1–5, LocalInference translates every N sentences
inside an utterance, as today: `src/providers/localInference/sentenceCut.ts`
ports today's seal cursor and truncated re-decode guard over the runner's
punctuator, the adapter gives each job its own source segment and origin, and the
voxtral worker's endpoint is off only while this stage seals. The runner gives a
run a punctuator only when a model can run for it (`punctuationReady`, read once).
Checked live in the preview (`spine-local-probe.mjs --sentences`: one utterance
of two sentences becomes two source rows, each with its translation). Plan
1e-2's ruling 1 ("a size of 1–5 behaves as Auto") is retired.

The fix wave also fixed an ordering bug the stream shape made routine: the
projection ordered two exchanges of one leg that opened in the same millisecond
by id as a string, so `u10` sorted before `u9`; same-leg ties now keep L1's
order, ties between legs go by leg name.

Stated departures from today (the plan's rulings): transcription-only
(`kind: 'none'`) no longer streams — the display cut is L2's; long typed text
is one job; a stale cursor no longer survives an ASR error or an empty final.

What it leaves:

**1e-3 — the switch-over**
- Wire the app's `punctuationReady` from `PunctuationRuntime.enabled`; it still
  reads true for a model the runtime disabled mid-session (today's client has
  the same gap).
- Check live: L1 punctuates `length` and `end` source rows for display while
  the job translates their raw text, so an `end` tail filled into several
  sentences shows several source rows over one translation row.
- The seal-count analytics (`segmentation_seals`, `_model_calls` in
  `translation_session_end`): the shim carries no `observe`.

**Stage 2**
- Fill the `end` tail's job text if translation quality on unpunctuated engines
  asks for it (`SealedChunk.reason` makes it one line).
- The truncated re-decode guard compares trimmed prefixes; a skeleton prefix
  would also catch a re-decode that only recases or re-punctuates.
- A letterless seal (an utterance opening with a lone mark or bracket) leaves
  the cursor in place, so each later partial re-seals it and logs its frame
  again; rows and jobs stay right. Today's client has the same cursor.
- Move `SentenceCut` to a shared home when LocalNative ports: it drives
  `SentenceStream` the same way.

## Scheduled by plan 1e-3a

Plan 1e-3a (the composition root) landed as commits `5c5d7140..5f4b2a72`:
nine tasks and a final-review fix wave. The new session layer now has one
composition root, `src/app/session.ts` (`getAppSession()`), built the way the
app will run it: one runner with its view, a karaoke readable of one identity,
the subtitle session, the app's punctuator (today's diagnostics, and one model
call per `(language, text)`), capture loaded on first use, frames into the Logs
panel with one run's segmentation tallies, the analytics the app keeps, one
auto-save per run then the balance refetch, and `attach()` for the page
(`pagehide` → abandon, the provider store's legs, a local provider checking its
own readiness, Electron's busy flag). Around it: readiness says why by a code
(four new notices worded in 30 locales from sentences each already had),
`SourceOpenError` / `loopback_denied`, `microphoneMissing`, push-to-translate's
passthrough in `readRouting`, and the stored-settings mapping as pure functions
(`src/lib/session/storedSettings.ts`). The dev preview runs the root, and every
headless probe passes on it. The running app gained one read-only call
(`loadSessionStores()` in `Home.tsx`); both release builds were checked — no
fake-provider code ships (D24).

What it leaves:

**1e-3b — the switch**
- One owner each for `attach()` and `useAppSessionBridges` (a second live
  `attach()` is refused with a warning); remove `useSegmentationRuntime` in the
  same change that moves MainPanel onto the root, or the page runs two
  punctuation runtimes.
- `settingsStore.enterSubtitleMode` reaching `getAppSession()` closes an import
  cycle back to `settingsStore`: use a lazy accessor.
- A local provider has no Validate button; its readiness is checked only while
  something has called `attach()` — the app must attach at startup.
- Apply `storedSettings.ts`: the stored selection (never overwritten by a
  fallback; an explicit pick writes the old enum's spelling) and the one-time
  turn-mode migration.
- The Screen Recording `WarningModal` and its System Settings deep link off
  `loopback_denied`; the idle line's `onFix` links off the readiness codes.
- The renderer's answer to `app:close-requested` on `settled()`, and the main
  process's close/update wait raised to the runner's bound + 1 s (1e-3
  ruling 12) — MainPanel's own handler goes in the same change.
- `no_asr`'s `{{source}}` as a language name (the params carry the code).
- The global turn-mode control (1e-3 ruling 7).

**Development only**
- After editing `SpinePreview.tsx` or `session.ts`, reload the preview fully:
  a hot reload keeps the first session (plan 1e-3a ruling 2) — the page's probe
  counters stop reading, and a second session can be built over the same
  playback.

## Scheduled by plan 1e-3b-1

Plan 1e-3b-1 (the panel on the root) landed as commits `758da202..2b1e1f66`:
thirteen tasks and a final-review fix wave. Built beside the old path and
mounted only in the development preview (`/?preview=spine&panel=1`): the new
MainPanel (`src/components/MainPanel/SessionPanel.tsx` over `panel/` — both
footers, the toolbar, typed text, the waveforms over the graph's bus meters,
push-to-talk, the clock, the start label, the permission warnings, the echo
notice), the subtitle takeover over the app session (legs from intent, a
Settings deep link per readiness code), the audio graph's #246 recovery, the
microphone stopping first and notices redacted at L1, notice languages by
name, reused display items with memoized rows, a replay that stops on a second
click, one start every surface calls (`AppSession.start`, which honours the
provider-loaded and microphone rules the runner does not check), and the
stored provider and turn mode applied at load. The running app sees two
things: the turn mode's one migration write and Electron's 16 s close bound.
The preview now applies its URL settings at load (with or without
`&autostart=1`) and runs `initializeAudioService()` as `Home` does; a new
headless probe, `scripts/dev/app-panel-probe.mjs`, drives the panel through
Start, rows, karaoke, typed text, push-to-talk, the advanced strips over the
app's own capture, export, auto-save and a refused start's Settings action
(`--preview` now; `--app` after the switch). Every preview probe passes, both
release builds build, and the new advanced footer was compared with today's
side by side. The per-row memoization's measurement (`--long`, 20 rows and
more): 2 long tasks, the longest 82 ms.

What it leaves:

**1e-3b-2 — Settings and the switch**
- `useSelectedProvider` selects nothing on its own: `loadSelectedProvider`
  owns the default and the stored selection. A child's default-select runs
  before `Home`'s load effect and would beat the stored provider (safe today
  only because `MainLayout` waits on `setupLoaded`).
- `Home` keeps the old `initializeAudioService()` for device enumeration and
  selection; its player stays idle beside the new graph until 1e-3c. The
  acceptance checks that passthrough and the monitor are heard once.
- One acceptance run without `--autoplay-policy=no-user-gesture-required`
  (`headless.mjs` passes it to every probe): after the switch the graph is
  built at mount, with no gesture.
- Any start path the switch adds goes through `AppSession.start`, never
  `runner.start`.
- Clear on the two surfaces: the panel's Clear hides a failed start's line on
  the panel only; the takeover's idle body keeps showing that failure until
  the next start.

**Before the first release**
- `SessionPanel` re-renders about 30 times a second during a run; the toolbar
  and the footer are not memoized. `React.memo` on both is the cheap next step
  if a measurement regresses.
- de, nl, sv and tr drop "audio" in one of plan 1e-3b-1's four new sentences —
  for the native-reader spot-check.

**1e-3c**
- Three test files copy one mock block (`SubtitleTakeover`, `SessionPanel`,
  `SessionPanel.microphone`), and a partial `react-i18next` mock prints
  i18next's Locize banner: revisit when the old tests go.

**Development only**
- The preview's `&monitor=1`, `&autosave=1` and `&turn=` write the stored
  settings the old app reads, so they outlive the page.
- `app-panel-probe --ptt` reads the basic footer's hold button; with
  `--advanced` it exits 2.

## Scheduled by plan 1e-3b-2

Plan 1e-3b-2 (Settings, and the switch) landed as commits `8044e074..3f847893`:
six tasks and a final-review fix wave. **The app now runs the new session.**
MainPanel is plan 1e-3b-1's panel, the Electron takeover is `SubtitleTakeover`,
`AppSessionRoot` owns the page's wiring in `Home`, and Settings compose the
provider area in pieces over `providerStore` (picker with LocalInference's
chips, memory estimate and fallback notes; the pair with its sentence; the
provider's own settings; the engine following the legs), the global turn mode
with the headless Output block, and the participant-speech switch. Every
stored key the session reads has one writer. The SetupWizard offers its
offline path only and writes through `providerStore`; signing in switches no
provider. The branch offers LocalInference only (and the fake in development
builds) until Stage 2; the old clients, descriptors and slices stay compiled
but unreachable for plan 1e-3c.

Checked headlessly against the switched app (`app-panel-probe --app` in every
variant, `--settings`, all ten `spine-*` probes, a run under Chrome's default
autoplay policy started by a trusted click, and a profile whose stored
provider is `openai` running LocalInference with `openai` kept and its old
Push-to-Talk migrated); both release builds build with no fake-provider code.
The per-row memoization on the switched app (`--app --long`): one long task,
the longest 98 ms.

Stated departures, besides the plan's: participant speech follows the
whole-system rule everywhere — the switch, the route, the run's shape (no
participant TTS model is loaded while Other's source captures the whole
system on Electron) and the replay slots — through one predicate,
`participantSpeechHeard`.

What it leaves:

**The owner's Electron acceptance (Task 7) — owed before 1e-3c**
- Plan 1e-3b-2 Task 7's list on the owner's machine, plus: a fresh profile
  through the first-run wizard onto LocalInference; the takeover's Fix pressed
  twice; no participant TTS model loaded under whole-system capture;
  passthrough and the monitor heard once, not doubled (the old audio service
  is initialized beside the new graph until 1e-3c).
- Audio in the extension side panel by hand (the panel builds its audio
  context at mount; only the web page was checked with a trusted click).
- Confirmed by the owner so far (2026-09-26): push-to-talk with Space works
  on the machine's own keyboard. Held through a remote keyboard it seemed
  not to respond — the remote keyboard's doing, not a defect; test holds on
  a physical keyboard.

**Before the first release**
- Close the participant-speech route when an application capture falls back
  to the whole system mid-run (`app_capture_lost_using_system_audio`,
  `app_capture_monitor_missing`): ruling 7's stated gap.

**1e-4 — the extension**
- The meeting page's subtitle overlay still reads the old `sessionStore`,
  which nothing writes now: 1e-4 publishes the wire from the side panel and
  renders `SubtitleView` in the overlay.

**1e-3c**
- The old clients, descriptors, settings slices, sections and MainPanel
  helpers (`1e3-deletion.md`), the old audio service beside the new graph,
  and two stale comments in test files (`Settings.highlight.test.tsx`'s
  header, `SystemAudioSection.test.tsx:126`).

## Scheduled by plan 1e-4

Plan 1e-4 (the extension overlay on the new session) landed as commits
`245e4cfa..b661ecd6`: nine tasks, a spike that became a probe and fixed two
product defects, and a final-review fix wave. **The meeting page's subtitle
overlay runs on the app session again.** The side panel's surface class
publishes the typed wire (`src/lib/subtitle/wire.ts`) from the app session —
reached through the leaf `src/app/subtitleFeed.ts`, never the root — to its
own tab's overlay only; the overlay page opens its port and receiver in one
step and draws `SubtitleView` through `ConnectedOverlay`, in the side panel's
language (a wire message, switched without being stored, last call wins).
Hold-to-talk needs a speaker leg; the overlay's hold button holds on pointer,
Space or Enter and blurs after every release; the overlay stays read-only for
start and stop. Every wire message is pinned JSON-safe.

What was checked:
- The preview (`spine-subtitle-probe`, every form) at the real iframe's 140 px;
  `spine-surface`, `spine-audio`, `app-panel-probe --app`; the app at `/`
  loads with no `SubtitleSurface` / `AppSession` warning.
- The wire (fake `long` script, 150 s, `&wire=1`): `subtitle:entries` 251
  messages, largest 18.4 KB at the tail's cap (budget 64 KB — held, so no
  entries delta), 1.7/s and 30.5 KB/s over the last 30 s; `subtitle:karaoke`
  5.8/s, 0.5 KB/s; one `subtitle:language`, one `subtitle:session`.
- The release extension build: the overlay page's graph holds neither the app
  root nor the provider registry (sentinels, with positive controls in the side
  panel's chunks), no fake-provider code ships, and the overlay page's
  preloaded chunks went from 12 to 7 (`sessionStore`, `playbackStore` gone).
- **Headless, in a meeting page** (`scripts/dev/extension-overlay-probe.mjs`,
  `--load-extension` with the Playwright Chromium, a stub served at the real
  `https://meet.google.com/…` URL): Chrome sets `port.sender.tab` on the
  overlay iframe's port; the overlay draws the run with karaoke; the extension's
  storage is shared with the overlay; after Stop and after a reload over a
  stopped run the overlay reads the side panel's language; with two meeting
  tabs and two side panels each overlay draws only its own tab; after a hold
  neither Space nor Escape reaches the meeting page, and Escape exits subtitle
  mode. The spike found two defects, fixed: the overlay could stay in English
  after a stop (a bundle's arrival re-rendered nothing — react-i18next
  `bindI18nStore: 'added'` now, app-wide), and an orphaned overlay could not be
  closed (its exit now unmounts it).
- The layout at 140 px: under push-to-talk the hold button takes about a third
  of the frame and the source line fades into the bar row; the top fade itself
  is the compact bands' designed mask, as the old overlay had. The old overlay
  showed a text hint ("Press Space to speak") where the new one has a button.

Stated departures, besides the plan's: a side panel **ignores** a port from
another tab (the plan's choice 2 said disconnect it — Chrome fires a
receiver's `disconnect()` at the sender, so that closed the other tab's live
overlay). The cost: an overlay whose own side panel closed while another tab's
panel lives stays up showing "Session ended" until the user closes it, a new
side panel on its tab enters subtitle mode (it replaces it), or the last panel
that heard it closes. Entering subtitle mode first sends `subtitle:exit`, so a
stale host never blocks a fresh overlay.

What it leaves:

**The owner's extension acceptance — owed before 1e-3c**
- The virtual microphone in a real Google Meet tab, passthrough on at a low
  ratio, checked for gaps (deferred by plan 1c-2).
- Audio in the extension side panel by hand, and a live local session in the
  extension (LocalInference with models, in the side panel).
- The overlay in a real Meet tab: the run drawn, karaoke, the hold button,
  Clear, ✕ / Escape, the side panel closing, a tab reload, the language after a
  change in Help.
- Two meeting tabs, each with its side panel in subtitle mode: each overlay
  shows its own tab's run, and a hold, Clear or ✕ in one reaches only its own
  side panel; whether a background tab's side panel stays alive.
- The hold button's placement at 140 px (screenshots with the slice report):
  the recommendation is to move the hold control into the bar at compact
  height so the bands keep theirs.

**Decided, not owed:** after a hold's release focus stays in the overlay's
iframe until the user clicks the page, and an Escape meant for the meeting
then exits subtitle mode. Handing focus back (the content script blurring the
iframe) is a follow-up only if the owner asks.

**1e-3c** — delete, in addition to its own list (`1e3-deletion.md`):
- `src/stores/sessionPortMirror.ts` (+ its tests, `subtitleWire.roundtrip.test.ts`),
  `src/types/subtitleWire.ts`, `src/stores/playbackStore.ts` (+ tests) — no
  importer outside their own tests now.
- `SubtitleApp.tsx` and its tests (first move `SubtitleSurfaceKind`'s imports
  to `useSubtitleChrome`, re-home `getHighlightOverlayForBg`'s test; keep
  `SubtitleApp.scss`), `SubtitleStream.tsx` (keep `SubtitleStream.scss`),
  `deriveSubtitleIdleState` (keep the type, without `blocked`), `SubtitleIdle`'s
  `blocked` branch and `onFix`, `SubtitleBar`'s `exportProps` / legacy export
  and its dead `sokuji:user-exit` fallback (`:108-117`, `onExit` becomes
  required), `isPushGatedMode`, `sessionStore`'s `SubtitleApp`-only hooks
  (`useRequestClearConversation` among them), `useSubtitleSessionBridge`.
- The duplicated entries adapter: the preview publishes from
  `currentSubtitleFeed()`; the tests' `box<T>()` to one helper.
- Stale text: `SubtitleBar.tsx:243-247`, `types/subtitleWire.ts:12`,
  `SubtitleIdle.tsx:3-8, 20-24`, `MainPanel.tsx:198` (`t` is no longer stable for
  the panel's life since `bindI18nStore: 'added'`; the behaviour is right), and
  two surface tests whose names still say `subtitle:enter` is the message held
  in flight (it is `subtitle:exit` now).

**Before the first release**
- A publisher that stops itself on a failed post leaves its port open: the
  overlay can then only close itself, and the side panel stays flagged in
  subtitle mode. Rare (every message is JSON-safe).

**Development only**
- `node scripts/dev/extension-overlay-probe.mjs --build-dir <dir>` builds a
  development copy of the extension and runs headless; `--no-build` reuses it,
  `--ptt` holds a turn on a voiced WAV, `--shot <png>` saves the meeting page.
  Chromium 151 ships its own `background.js` component worker: the probe picks
  the worker whose manifest names `fullpage.html`.

## Scheduled by plan 1e-3c

Plan 1e-3c (the transitional deletion) landed as the commits after its plan
commit `1bfdd362`, through `f2aecd43`, then this record and a final-review fix
wave (comments and test names only): seven tasks, two of them with one review
fix round each, **−13,957 / +802 lines across 113 files** (`1bfdd362..f2aecd43`),
no behaviour change beyond the two differences recorded below. The owner narrowed it on 2026-09-26, after accepting the
switched app on hardware:
- **Every old provider stays** — clients, descriptors, the old per-provider
  and generic settings UI, the `settingsStore` slices, the Provider enum, the
  SetupWizard, the managed-Soniox MainPanel chips — as the source each Stage 2
  port reads. This reverses the spec's D11 ("read from git history"); the
  Stage 2 foundation plan amends the spec. Each provider's old code goes with
  its port, after the owner's live test.
- **The fake provider stays** (D24): the conformance suite and demo provider
  every Stage 2 adapter uses.

What went: the legacy subtitle window and its overlay mirror (`SubtitleApp`,
`SubtitleStream`, `sessionPortMirror`, `types/subtitleWire`, `playbackStore`,
`useSubtitleSessionBridge`); the legacy export adapter and its item helpers
(its tests ported onto `ExportMenuButton`); the old session store's dead half
and the old start gate (`sessionStartGate.ts`); the old MainPanel's
orchestration helpers; the old audio service, its idle player and worklet
(`ModernBrowserAudioService`, `ModernAudioPlayer`, `playback-ring-processor.js`,
`IAudioService`, `ServiceFactory.getAudioService`) after device enumeration
moved to `src/lib/audio/devices.ts`.

Controller rulings: the old generic Settings surfaces (`ProviderSection`,
`LanguageSection`, `PoweredBy`, `EngineStatusLine`) stay while Stage 2 still
reads them; `sessionStore` is trimmed to `lockedMode` + `isInitializing`, the
two fields kept UI reads; device enumeration moved to a new module rather than
a slimmed service; the managed-Soniox chips stay; pre-existing orphans are out
of scope.

**Two behaviour differences, both accepted:**
- On Electron's first run the microphone permission warm-up — and, when it
  fails, its hang and its toast — now happens once instead of up to three
  times (the old `initializeAudioService()` chain called `getDevices()`
  separately each time).
- At launch the old service's idle players opened their own `AudioContext`s
  and output elements playing silence — to the monitor device, and on
  Electron to the virtual speaker too. Nothing opens an output at launch any
  more: the new graph opens its outputs on first use (`src/app/session.ts`).
  Whatever a meeting app or the OS showed for Sokuji before a first run is
  gone until then — part of the owner's Electron check below.

Checked headlessly: the spine probes (subtitle in every form, surface, export,
audio), `app-panel-probe --app` (plain, `--advanced`, `--ptt`, `--settings`;
its step 9 fails unless Stop writes the auto-save file),
`extension-overlay-probe` on fresh builds (plain and `--ptt`), both release
builds with no fake code, the extension's `worklets/` without the deleted
worklet, and a fresh profile's Settings listing its devices. The overlay
page's JS (entry plus its eight preloads) went from 2,219 KB to 2,129 KB
against a build of `1bfdd362`.

What it leaves:

**The owner's Electron check (owed, not blocking)**
- Device pickers populated; the first-run permission prompt (now once);
  monitor and passthrough heard once; the virtual microphone receiving TTS in
  a meeting app, and what the meeting app shows for it before the first run
  (no silent output is opened at launch any more).

**Before the first release**
- `src/lib/audio/devices.ts` keeps the old service's bare `chrome` reference
  verbatim: where `chrome` is undefined (Firefox/Safari, jsdom, possibly
  Electron — unverified) a `NotAllowedError` warm-up throws past the inner
  catch and `listAudioDevices` returns empty lists, the failure its own
  header says must never happen. Guard it with `typeof chrome` and add the
  `NotAllowedError` test case. Pre-existing; not fixed here, where the move
  was verbatim.
- `CLAUDE.md` still describes the deleted audio layer ("Always use
  ModernAudioPlayer/ModernAudioRecorder", the old pipeline diagram,
  `ModernBrowserAudioService`, `switchRecordingDevice`). Stage 2 sessions load
  it every time; the owner decides when it is rewritten.

**With the Stage 2 plans that edit these files**
- Stale comments in kept code name deleted modules:
  `geminiTranslateModel.ts:58` (`SubtitleApp`), `sonioxBothMode.ts:22` and
  `sonioxManagedMinBalance.ts:5` (`sessionStartGate.ts`),
  `ProviderDescriptor.ts:336` and `managedVoicePrep.ts:18` (`computeStartGate`),
  `ProviderDescriptor.ts:78` (`useSegmentationRuntime`),
  `descriptorRegistry.test.ts:582` (`segmentationForProvider`),
  `IClient.ts:409`, `GeminiClient.ts:618`, `PalabraAIClient.ts:140` and
  `VolcengineAST2Client.ts:107,411` (`participantTelemetry` / `apiErrorProps`
  as present-tense consumers),
  `LocalInferenceClient.ts:691` (`ConversationRow`),
  `localParticipantConfig.ts:17` (an import chain through the deleted audio
  service), `LanguageSection.tsx:483` and `LanguageSection.sentence.test.tsx:412`
  (`sessionStartGate`), `settingsStore.ts:1646` (`SubtitleApp`).
- The old generic Settings surfaces and `sessionStore`'s remainder go when no
  kept reader is left.
- `src/services/providers/speechMode.ts` (`isPushGatedMode`) lost its last
  importer with `SubtitleApp`; kept with the descriptors, whose
  `pushGatedModes` a Stage 2 port may read.
- **Bundle size:** the old clients and descriptors still ship (734 KB
  unminified in the app) and sit in the chunk the extension's overlay page
  preloads, reached through `SubtitleBar` → `settingsStore` →
  `ProviderConfigFactory`. They leave as the providers port.

**Hygiene, optional**
- The preview could publish from `currentSubtitleFeed()` instead of its own
  entries adapter; four tests carry their own `box<T>()`; three MainPanel /
  takeover tests copy one mock block; `ExportButton.tsx` now hosts only
  `ExportMenuButton`, tested by two files with two different fake exporters.
- Five `en` locale keys lost their last reader with the old start gate
  (`mainPanel.{apiKeyRequired,modelsRequired,modelsLoading,insufficientBalance,localModelsRequired}`);
  kept, as Stage 2 may need them.
- Pre-existing orphans, not transitional: `Auth/AuthGuard.*`,
  `Auth/SignInPage.scss`, `lib/auth/guards.tsx`, `ConnectionStatus/*`,
  `UpdateSection.*`, `engine/resolutionNotes.ts`,
  `supertonicSidReconciliation.ts`, `utils/clampToScreen.ts`, and
  `NativeTtsProto`'s static import in `App.tsx` (5.7 KB in release);
  `resolveParticipantSourceId` in `lib/modern-audio/participantSource.ts` has
  no caller outside its own test.
