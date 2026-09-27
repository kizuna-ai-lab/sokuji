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
page's JS (its entry plus seven preloads, eight files) went from 2,219 KB to 2,129 KB
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

## Scheduled by the Stage 2 foundation plan

The Stage 2 foundation plan
(`docs/superpowers/plans/2026-09-26-client-contract-stage2-foundation.md`,
plan commit `8902c5d1`) landed as the twenty commits after it, through
`5e98695e` (**+3,812 / −217 lines across 80 files**), then this record, the
spec's amendments and a final-review fix wave. It is vendor-free: it builds
what every provider port leans on and ports no provider. Fourteen tasks were
implemented; Task 15 (an adaptive lead for streaming audio) did not run,
because group check A's G3 measurement came out as designed; Task 16 is this
record and the spec's amendments. Fix rounds: Tasks 4, 8 and 10 one each;
Task 13 two (a controller ruling before review, and one review round).

What landed, by task:
- **Presence** (`1727852a`): a managed provider needs the Kizuna umbrella; a
  flagged provider's `testerSwitch` unlocks it in a release build (Local
  Native's `debug:local-native`, F6).
- **The live gate** (`e7cf101d`): Start is off, with the refusal's words,
  whenever the runner's gate would refuse (F7).
- **Notice aliases** (`2730ba48`): a provider's code may reuse a sentence
  every locale already has (`NOTICE_ALIASES`, F8), `sign_in_required` among
  them.
- **The adapter test kit** (`79b6d52b`, `7899da42`): `FakeSocket`, the
  scenario driver, `runScenario`'s conformance suite, `every()` (F9).
- **Guards** (`c4cf549d`): a provider's session side imports no store, no
  reporter and no global timer; the kit is test-only (F17).
- **The preview's gap count** (`376124ba`, `248dbd70`): the instrument for G3.
- **Credentials with a code, and the account** (`de454a79`): `read` may
  answer `{ missing, code, params }`; `AuthContext.userId` (F3).
- **The fake's other shapes** (`dadcee52`, `82ea301a`): the ref-less stream,
  frames, no ranges, a reconnect; a script per leg (F10).
- **Migration inputs** (`d91f479b`): `legacyKeys`, the credentials and
  `migratePair` reach a migration (F5).
- **Models and the account reach Settings** (`a1ca782e`, `3e5272d3`):
  `SettingsProps.models` / `account`, `SharedSettings.models` (F2, F3).
- **The leased fake** (`d87a854b`): a DEV-only managed fake whose `prepare`,
  `acquire` and `startBoth` are its knobs; `acquire`'s context carries the
  run's clock (F10, choice 1).
- **The preview signs in** (`c377e0df`): `&signedin=1` hands the session a
  signed-in stand-in with no network; `&script=` scripts either fake.
- **Readiness for every kind** (`b3a939cd`, `6cf67038`, `af425383`):
  `driveReadiness` checks own-key and managed providers — at once on selection
  and load while their readiness is unknown, 800 ms after an edit; a sign-in
  or account flip forgets every managed provider's readiness and checks the
  selected one at once; the last ready answer is kept with its inputs, and a
  managed provider's with its account too, so signing out and back in to the
  same account costs no request; Validate is own-key only and tracks
  `api_key_validated` again (F1).
- **Registry invariants and `i18nKey`** (`5e98695e`): every provider meets
  the old enum's ids and slice keys, en names, credential sentences, a
  managed provider's sign-in reading, identity migrations; the release order
  is pinned at `['localInference']` (F17, controller ruling 2).

**Checked — group check A** (at `dadcee52`): both release builds, the
extension suite, no fake code in either bundle; every spine probe and
`app-panel-probe` (preview, `--settings`); the gate probe showing the refusal's
words. The four new scripts rendered: `framed` its pairs, `reconnect` its four
rows; `rangeless` and `refless-stream` with no karaoke, as their shapes
predict (no ranges; no `ref`).
**G3**, three runs of `refless-stream` over 36 s, steady / hiccup gaps:
0 / 1 (109 ms at 16.2 s), 0 / 1 (99 ms at 16.2 s), 0 / 1 (109 ms at 16.2 s).
The worst run is the prediction — no gap while the stream is steady, one
dropout where the script stalls longer than the lead — so Task 15 did not run.
A stall longer than the lead drops out once (~100 ms) and leaves ~100 ms of
extra latency behind; Palabra's live test is where that is heard.

**Checked — group check B** (at `5e98695e`): both release builds and the
extension suite (7 files, 45 tests); neither fake's sentinel (`The fake
degraded its speech`, `Lease ended by the leased fake`), nor `fake_leased`,
nor the preview's `preview-token` in `build/` or `extension/dist/`; all eight
probes; the leased fake **signed in** (`&provider=fake_leased&signedin=1`)
playing its four rows through `prepare` and `acquire`; the leased fake
**signed out**, Start off with "Sign in to use Kizuna AI's built-in
translation service." — the driver, `read`'s `sign_in_required` and the
alias's words end to end. The app at `/` logs nothing new: WebGPU's "No
available adapters" (headless) and the backend's CORS refusal of
`localhost:5199`.

**Final review** (whole plan, `8902c5d1..f8c12c89`): ready with fixes — no
Critical, one Important, eight Minor, every routing and ruling agreed. The
Important was a contract gap, not a code defect: a check the driver starts has
no time limit, and Start is off with no words while it runs; the spec now says
`check` bounds its own request ("Readiness is one check"), and Soniox, the
first real network check, inherits it. The fix wave (`c3a48452`, `c8373bb3`,
`67bd96b4`, `a5c2fff4`, `29e188f8`, then this record) took the task reviews'
queued Minors and the final review's code ones:
- the driver's timer skips a network provider whose readiness is no longer
  unknown when it fires (a Validate within 800 ms of an edit no longer runs a
  second network check);
- only a managed provider's kept answer is per sign-in and account, so an
  own-key provider's answer outlives a sign-in flip;
- the leased fake's `startBoth` throws the start failure, not a cleanup's;
- `NO_MODELS` is frozen;
- doc and test strengthening: `canStart` / `start()` docs, the live gate's
  not-loaded case, a non-vacuous `migratePair` case, the lease's
  release-once case, `migrateFakeLeasedSettings`, Validate's `checking` case,
  the registry test's wording.

The spec also says now that `read`, not `check`, sees the sign-in; when checks
run; and that a migration writes nothing back.

**Stated departures from today:**
- An own-key provider's readiness is checked on its own: at once when it is selected or loaded, and 800 ms after its settings or credentials last changed. Before, only Validate or a start checked it; the old app validated on every change with no delay.
  - One visible effect: with an empty key, the credential form shows "Enter your API key in Settings before starting." and Start is off with that reason as soon as the provider is selected, before anything is typed. The old app showed no verdict until a key was typed or Validate pressed.
- A managed provider shows no Validate button, and is asked again at once when the user signs in or out, or switches account (served from the kept answer when it is the account last answered ready — amended after the final review).
- Start is off, with the reason, when the gate would refuse: the participant leg on the web page, a pair that does not reverse (D20), a turn mode the provider does not offer. Before, Start was offered and the start was refused.
- The development build's picker offers a second fake, "the leased fake" (development only).
- The preview's `&mode=`, `&signedin=1`, and `&script=` for either fake.

What it leaves, for the plans that meet it (the plan's own list, as written):

Each item goes to the first provider plan that needs it (survey §3.1's "→X"); the order is controller ruling 3's.

**Soniox** (`soniox`, BYOK):
- F13's voice-library wrapper and `LinesField` (vocabulary), composed from the account (`props.account`, Task 10).
- F18: the reusable protocol modules' home (`git mv` into `src/providers/soniox/`), their timers moved onto `request.clock` / `every()` (Task 4).
- F12's own-key wizard path: the first own-key provider.
- The provider-neutral Speech-section tooltip. LocalInference's text stays accurate until the first cloud provider lands (`SpeechSection.tsx`'s comment).
- `startBoth` naming the leg that failed (roadmap 1c-1 → Stage 2): the runner wraps a rejection as `LegOpenError(legs[0])`. The leased fake's `startBoth` (Task 11) is where to test it first.
- A test that hands `startBoth` a distinct track per leg (roadmap 1c-3 → Stage 2).
- The four voice-preview sites folded into `Playback.preview` (roadmap 1c-2 → Stage 2).
- Soniox-named notice aliases (`sonioxServiceUnavailable`, `sonioxServiceBusy`, `sonioxTtsFailed`, `sonioxTtsSegmentLost`) — choice 9.
- The conformance suite (`runScenario`) over its harness, `FakeSocket` for its two sockets.
- `check` bounds its own request (spec, "Readiness is one check"; final review I1): Soniox's is the first real network check the readiness driver runs unasked, and one that never settles would leave Start off with no words.

**Kizuna Soniox** (`kizunaai_soniox`):
- F11, whole:
  - `managed(base, …)`;
  - `SessionHooks.minimumBalance`, `Resources.budget`, `RunState.running.budget`, and the lease's budget on the leased fake;
  - the live gate's balance floor, beside Task 2's refusal;
  - `acquire`'s frame sink for `session.*`;
  - the managed account row and "Recommended" in the picker;
  - `SessionCountdown` mounted;
  - `AccountButton` through `minimumBalance`.
- F12's managed wizard path.
- `selectionFromStored`: `'kizunaai'` and an unported managed id → the default managed provider (survey §2.1.9).
- A Settings target for `sign_in_required` in `NOTICE_TARGETS` (the account popover); the managed-voice aliases (`sonioxVoice*`).
- The preview's `&signedin=1` stand-in reaches the session and `ProviderPanel`, not the `&settings=` blocks, which read `useAuthContext()` (Task 12). Route it there before rendering the managed account row in those blocks.
- The lease's timers read `ctx.clock` (choice 2). The session-side guard leaves hooks out on the spec's word (choice 11). If the owner wants the lease held to the clock convention by a test, extend `sessionSide.consistency.test.ts` to the lease's module.
- `NETWORK_READINESS_DELAY_MS` (800 ms) is a judgement: revisit it if the managed account row or a network check feels slow in the live test.
- Participant speech against the lease (spec open question, survey §3.4.3).
- The sign-in auto-switch: a product decision, with `providerStore.select`'s phase guard.
- The registry's final order (Task 16's roadmap item).
- Nothing account-mutable — the balance above all — may live in its ready answer: signing out and back in to the same account is served from the kept answer with no request (final review M1). The balance goes through `minimumBalance` and the lease.
- A check that threw or timed out leaves a managed provider `not-ready` with no way back but an edit, a change of legs or a sign-in flip: the driver re-checks only an unknown readiness, and a managed provider has no Validate (final re-review). A Kizuna Soniox launch while offline would keep Start off until the user changes something — give the not-ready surface a retry, or have the driver re-ask a thrown answer on selection.
- After the fix wave the driver's timer skips a network provider whose readiness is already known, so `watchReadiness` re-checks only a local one; a managed provider that wants a re-check (a balance change) forgets its readiness first.
- `AuthContext` has no pending state: at every launch a signed-in user sees "Sign in to use Kizuna AI's built-in translation service." with Start off while the session loads (final review M8). The old gate did the same; the managed account row is where a pending state belongs.

**Gemini:** F13's `InstructionsField` (the global template / advanced editor, moved out of `ProviderSpecificSettings.tsx`), `VoiceField`, `ModelField` over `props.models` and `shared.models` (Task 10), and the sliders.

**Volcengine AST2:** F14, the socket seam (`openSocket`; its fake implementation hands out `FakeSocket`s); F16, windowing the pairing inference (roadmap 1a → Stage 2).

**OpenAI Translate:** F16 if AST2 did not land it; the transcript, noise and transport fields.

**OpenAI + OpenAI Compatible:**
- F15, the processed WebRTC track (roadmap 1c-3 → Stage 2), unless Translate-WebRTC comes first.
- The D25 participant-leg fix (spec open question, survey §3.4.1).
- `busy`'s reader (roadmap 1d-1 → Stage 2).
- The drift anchor; OpenAI's model migration and `turnDetectionMode` → `autoDetection` through `legacyKeys` (Task 9).
- Compatible's `i18nKey: 'openaiCompatible'` (Task 14).

**Palabra:**
- F4, the credential-adjacent control (the platform / app toggle).
- `authMode` through `legacyKeys` + `credentials`, and the pair's `vn` → `vi` through `migratePair` (Task 9).
- `deleteSession` with a timeout.
- The G3 latency a stall leaves behind (group check A's record), checked in its live test.

**OpenAI Live:** F14 (reused); the `connection_lost` alias (Task 3).

**Local Native:**
- `flagged: true, testerSwitch: LOCAL_NATIVE_DEBUG_KEY` (Task 1).
- Its `Engine` reuses the existing native UI (`EngineSurface` + `useNativeEngineAdapter`, `NativeModelManagementSection`, `NativeVoiceSection`, `NativeDeviceControl`), wired to the provider's `settings` / `update` / `pair` instead of the old `settingsStore` slice — the same override LocalInference's `useWasmEngineAdapter` got. Not a rewrite (the survey's §3.4 item 7 overstated it; controller correction, confirmed by the owner 2026-09-26).
- `watchReadiness` over `nativeModelStore`.
- `SentenceCut` moved to a shared home (roadmap 1e-2b → Stage 2).

**The relay twins:** held (controller ruling 3).

**Stage 2 items from the roadmap this plan does not take:**
- `RunnerDeps.replayAudio` is not guarded like the other ports (roadmap 1e-1).
- The notice-code namespace: aliases give a provider's codes words, but the namespace is still flat (roadmap 1e-1).
- The linear resampler's aliasing, and Edge TTS's decode-start handshake (roadmap 1e-2).
- The `end` tail's job text, the re-decode guard's skeleton prefix, and the letterless seal (roadmap 1e-2b).

**Parked from the task reviews**
- The kit: an adapter that answers after an `await` needs `{ flush: true }` at
  the end of its exchange steps. `FakeSocket` sets `wasClean` without looking
  at the code and validates no close code; the virtual clock has no
  `pending()` count to catch an interval that outlives `stop()`; the
  manual-end scenario does not check that a real segment was produced.
- The account (Soniox plan): choice 4 — `account` reaches `Settings` only — is
  held by convention; a Settings-only props type would let the compiler hold
  it. `account.auth.getToken` reads the host's function through a
  layout-effect ref, so a child layout effect in the commit where the token
  rotates still sees the previous one (`useInsertionEffect` closes that window
  if a reader needs it). The root cause is `useAuth()`'s inline `getToken`: an
  `AuthContext` changes identity on every render, so every reader keys on
  `signedIn` / `userId`, never on the object.
- The leased fake (Kizuna Soniox plan): no test refuses `prepare` or
  `acquire`, so the runner's coded refusal of a hook (`runner.ts:213-229`) is
  exercised nowhere — Kizuna Soniox's insufficient-balance test, or an
  `acquireRefused` knob, should. No two-leg run of the leased fake goes through
  the runner end to end. Its settings show the fake's inert "Require an API
  key" toggle (development only).
- Readiness: a sign-in flip heard while a run is on forgets the answers at
  once, and the selected provider is re-checked after the edit delay once idle
  — named in `readiness.ts`'s header; a sign-out during a session is rare.
- `&mode=` in the preview races the fire-and-forget device restore, as
  `&monitor=1` does (development only).
- `SettingsInitializer.test.tsx` (read-only, controller ruling 1) still names
  `driveLocalReadiness` in three comments.
- The missing-credentials rule (`code ?? 'credentials_missing'`, `params`
  when present) is written in both `providerStore.ts` and `run.ts` (final
  review M5). Kept inline, on the owner's rule against extracting small
  predicates; tests pin both sides.

**Before any release from the branch**
- **The release flags.** Production enables Kizuna Soniox and Palabra through
  the old per-provider flags (`VITE_ENABLE_KIZUNA_SONIOX=true`,
  `VITE_ENABLE_PALABRA_AI=true`), while `VITE_ENABLED_PROVIDERS` is unset.
  When those providers move onto the registry, either they are unflagged, or
  the repo variable lists them (`kizunaai_soniox,palabraai`). It must be
  settled before any release from the branch.
- **The registry's order.** The product decision of 2026-09-12 ran
  Kizuna-managed, Free, Gemini, AST2, OpenAI ×3, Soniox, Compatible, Palabra
  (survey §2.4.1); the registry today puts LocalInference first (1e-3 ruling
  10). The owner decides the final order once, before Kizuna Soniox lands;
  Task 14's order case pins it.

## Scheduled by the Stage 2 Soniox plan

The Stage 2 Soniox plan
(`docs/superpowers/plans/2026-09-26-client-contract-stage2-soniox.md`, plan
commit `4df9057c`, whose code is `c91a3020`'s) landed as the sixteen commits
after it, through `7ed66619` (**+7,318 / −1,485 lines across 121 files**,
`4df9057c..7ed66619`), then this record with the spec's amendments. The final
whole-plan review and its fix wave come after this record: the Minors the task
reviews queued for that wave are not recorded here as done. It is Plan A of the
survey's two — **Soniox with the user's own key** (`soniox`) on the new session:
its definition, adapter and settings, the registry, and the wizard's own-key
path. Kizuna Soniox is Plan B. The old client, both descriptors and the old
settings UI stay compiled and unreachable from the new session (ruling 1) until
Plan B's live test. Thirteen implementation tasks (Task 10 was split into 10a
and 10b on the plan's review) ran in seven waves; Tasks 1, 8 and 12 took one
review fix round each, and every other task was approved as its implementer
committed it. Task 13 is this record.

What landed, by task:
- **`speechRanges`** (`d496f521`, Task 3): an adapter sets the ranges of speech
  it already emitted for a ref (`AdapterEvents.speechRanges`). L1 measures them
  against the text the adapter last sent (`unfilled`, so a fill-in cannot
  shift them) and counts entries past a clear (`clearedEntries`); the kit gains
  `ranges-entry` and `ranges-order`, the fake the `late-ranges` script; karaoke
  holds what is lit while a rangeless clip of the same segment plays
  (`karaoke.ts`, choice 18).
- **The protocol modules' home** (`554a7143`, fix round `2064bd1c`, Task 1):
  `SonioxSttStream`, `SonioxTtsStream`, `PcmMixer`, `SonioxSideTracker`,
  `SonioxTtsRest` and `SonioxVoicesClient` moved with their tests into
  `src/providers/soniox/` by `git mv` (F18), a one-line re-export stub at each
  old path; their timers run on an injected clock and their sockets open
  through `openSocket`. The fix round: an `every()` started with no injected
  clock re-armed through whichever global `setTimeout` was current, so an
  interval an earlier `SonioxClient.test.ts` test had leaked re-armed onto a
  later test's fake clock ("Aborting after running 10000 timers") —
  reproduced, not a flake. `pinnedRealClock()` snapshots the timers when the
  interval starts (a ruling below).
- **TTS span tags and segment ends** (`837d275c`, Task 2): `sendText(…, tag?)`
  carries the ref and the span a chunk speaks; `onSegmentEnd` says how each
  segment ended.
- **`startBoth` names its leg** (`89f1b81f`, Task 4): `LegStartError(leg,
  cause)`; the runner turns it into that leg's `LegOpenError`; the leased fake
  names its failing leg; a test hands `startBoth` a distinct track per leg.
- **Settings, languages, credentials, config, check** (`94041f52`, Task 5): `S`
  and its migration, the 60 languages, one key field per region, `C` with
  `build` and `describe`, and a key check bounded by `CHECK_TIMEOUT_MS` (15 s)
  and the caller's signal.
- **Tokens → segments** (`209f36ce`, Task 6): `utterances.ts`, one source and one
  translation per utterance between `<end>` or `<fin>`; late translation tokens
  revise the ended utterance's translation (choice 3); after `<fin>` it stays
  open up to `FIN_TRANSLATION_GRACE_MS` (2,000 ms, ruling 5).
- **One leg's speech** (`c151d9d8`, Task 7): `speech.ts`. Chunks play as
  rangeless `audio` as they arrive; a segment that ends cleanly gets its
  chunks' ranges (`speechRanges`, the span tiled by sample counts), a killed one
  none; the old client's failure episodes become `tts_segment_lost` and
  `tts_stopped`, two notice aliases; `framePayload` is shared with
  LocalInference. The implementer's one deviation, accepted: the start and a
  reconnect share one connect path (`open()` → `ensure(true)`), which removes a
  double-socket race the brief's draft had, and the old client too (a ruling
  below).
- **The adapter, one leg** (`618efbff`, fix round `ad3463b3`, Task 8):
  `SonioxCore` over the STT socket — failures coded `auth`, `rate_limit`,
  `client`, `server` and `connection_lost`; the 503 resume ladder
  (`RESUME_DELAYS_MS` 0 / 1 / 3 s, at most five cycles, none under a lease);
  stop; frames under the old names; the lease's stubs for Plan B; the
  conformance suite over its harness. The fix round: a start resolves on the
  STT socket alone, with the speech's socket opening beside it (a ruling
  below); Stop during a resume's backoff and during an attempt's connect is
  pinned; the old frames' fields are back (`session.stt_resuming`'s close code
  and reason, `session.connection_lost`'s code); events dispatch typed; the
  unreadable-frame flag is per socket.
- **`startBoth`** (`5f160e2f`, Task 9): shared Both on one mixed `two_way`
  socket, each utterance's side from the side tracker, or split Both as two
  sessions; a failing leg named; the participant voiced when its switch is on
  (ruling 4).
- **The voice-preview route** (`10f05eb6`, Task 10a): `PreviewPort`,
  `SettingsProps.preview` and `legs`, `VoicePreviewContext`, and
  `appVoicePreview` on the page's playback (`getAppAudio()`);
  `VoiceLibrarySection` plays through the port when its host hands one down
  (edited additively, the one stated exception to ruling 1).
- **Soniox's settings components** (`0e5df25f`, Task 10b):
  `createSonioxSettingsView`, the voice-field wrapper over the kept voice
  library, `LinesField` for the vocabulary, the turn-detection summary and
  controls.
- **The registry and the Speech tooltip** (`bef09ca0`, Task 11):
  `sonioxProvider`; `RELEASED = [localInferenceProvider, sonioxProvider]`;
  the Speech mode's tooltip in provider-neutral words, two new keys in the 30
  catalogs (ruling 8).
- **The wizard's own-key path** (`1fb2a0d1`, fix round `7ed66619`, Task 12):
  offered again, listing the registry's own-key providers; its credential step
  reads the definition's fields and calls its `check` (choice 11). The fix
  round: an `auto` source is named through `t('common.autoDetect')` in the
  language-pair and finish steps, which showed the raw "Auto"; an edit during a
  Validate aborts it (a ruling below); dead fixtures removed; the re-run
  initializer's readiness cases added.

**The spec's amendments** (this record's commit), the plan's ten, three of them
adjusted to the code:
1. L0: `speechRanges` among the emitted events, and a paragraph on a range known
   only later — rangeless until its segment ends, karaoke from where playback
   is, the hold across a row's segments, late ranges re-anchored past fill-in.
   The hold is stated provider-neutrally, as Task 3's review asked:
   LocalInference reaches it when L1 drops some but not all of a segment's
   ranges.
2. "What every adapter must honour": the rule for ranges filled in later.
3. "Provider capability": Soniox's row, per TTS segment. The unit's list under
   the table is the code's, wider than the plan's: a change of row and the
   utterance's end also end a segment (`ttsStream.ts:347`, `:365-368`).
4. "Turns": `<fin>` ends the utterance under manual turns; the grace after it.
5. "The session request": `clientReferenceId` is sent, but billing follows the
   key's binding; an own key sends none.
6. "Playback — Routing": the voice-preview sites are **two**, not the plan's
   three. `nativeVoiceStores`' `AudioContext` decodes an imported clip and
   closes (`nativeVoiceStores.ts:161-169`); Local Native's previews play
   through `VoiceLibrarySection` (`NativeVoiceSection.tsx:494`), so they fold
   in when Local Native's host hands that section a port. "What it leaves"
   below keeps the plan's wording ("`nativeVoiceStores` fold in with their
   providers' plans"), which means that.
7. "What adding a provider then touches": the manifest item is a no-op for
   Soniox (its twelve origins are listed).
8. "Session hooks": `startBoth` rejects with `LegStartError`; any other
   rejection is the first leg's (`run.ts:241-246`).
9. "The shape": this plan's amendments noted.
10. "The clip queue": the hold covers a clip whose range is not filled in yet.

**Checked — the controller's gates** (at `837d275c`, after Waves 1 and 2 and
Tasks 10a and 10b): the suite 474 files passed / 1 skipped, 5,962 tests passed /
2 skipped, 0 failed; the typecheck gate at its 18 baseline lines. Every
implementer ran the same two gates on its own commit. Two runs that saw
failures or extra gate lines caught another task's uncommitted work mid-wave
(Task 5's tests during Task 6, Task 10a's RED window during Task 1's fix round)
and were attributed to it; a third, in Task 1's first report, was the leaked
interval its fix round removed. The suite grew from the plan's 5,843 (at
`c91a3020`) to 6,059 at `7ed66619` (Task 12's fix round), 0 failed, the gate at
its baseline.

**Checked — group check A** (at `5f160e2f`: the adapter and the settings
complete, not yet registered):
1. the suite: 478 files, 6,043 tests passed, 0 failed; the gate at its 18
   lines;
2. the old Soniox and voice-library suites by name (`src/services`,
   `src/components/Settings`): 1,831 passed;
3. `npm run build` and the extension build; `npx vitest run extension` (7
   files, 45 tests); both D24 greps empty;
4. the full tree's typecheck: 259 error lines, exactly the bound (279 at
   `c91a3020`, less the 20 Task 1 fixed);
5. **`late-ranges` in the preview**
   (`/?preview=spine&panel=1&script=late-ranges`): the translation row is drawn
   at 2,713 ms, unlit; it lights part-way ("こんにち") at 3,149 ms, once the
   fill-in lands mid-clip, advances to "こんにちは、お元気です", and clears when
   the clip ends. The screenshots show the row drawn and unhighlighted, then
   "こんにちは、" lit and advancing — ruling 2's karaoke, the owner's option (a).
   Then the spine probes (surface, subtitle, audio, export, gate) and
   `app-panel-probe` (preview, `--settings`): all exit 0.

**Checked — group check B** (at `7ed66619`):
1. both release builds and `npx vitest run extension` (7 / 45); both D24 greps
   empty; `session.stt_resume_attempt_failed`, a frame only the new adapter
   emits, is in `build/static/shared-*.js` and
   `extension/dist/assets/shared-*.js` — Soniox's adapter ships in both
   bundles, and neither fake does;
2. every probe on a fresh vite: the spine probes (subtitle, surface, export,
   audio, gate, local), `app-panel-probe` (preview, `--settings`, `--app`,
   `--settings --app`), `extension-overlay-probe` (plain and `--ptt`) — all
   pass;
3. **Soniox's Provider tab, rendered.** Advanced: the picker shows Soniox with
   its icon, name and description; one secret key field, "Enter your Soniox
   API Key", Validate, "Enter your API key in Settings before starting.", the
   setup-guide link; Region (us / eu / jp); the voice library (built-ins,
   Adrian); TTS speed 0.7–1.3 in steps of 0.05; Terms, Preferred Translations
   and Session Background; the shared-session pills disabled outside Both and
   live once `audio.mode` is `both`; the Endpoint Detection Tuning block with
   its three knobs; the Speech section's summary "Endpoint Detection Tuning ·
   Max Pause Before Finalizing: 2000 ms" as a link. `spine-gate-probe` on
   `&panel=1&provider=soniox` shows the main action off with that reason.
   Switching the region to `eu` keeps one key field and stores `eu`. Simple:
   no Soniox-specific settings (the owner's rule), the summary link, the key
   field and the reason. The headless microphone toast is the environment's
   (no fake-UI flags) and predates the plan.
4. **The wizard** on a fresh profile, Validate never pressed: language →
   scenario ("Be understood in a meeting") → the path step offers "I have my
   own API key" and "Free, offline" → own key lists Soniox (and, in
   development builds, the fake) → Soniox's credential step: one password
   field, "Enter your Soniox API Key", "How to get this key" →
   `docs/tutorials/soniox-setup`, Validate, Skip for now (step 4 of 6). Seen on
   the way: the own-key path's description still names "OpenAI, Gemini, Doubao
   (Volcengine) and others" (below, before any release).
5. the two new keys' translations, handed to the owner (below).

**Controller rulings**, each with what it costs if wrong (numbered here as "the
controller's ruling N"; a bare "ruling N" in this entry is the plan's):
1. **The six re-export stubs carry no comment line** (ruling 1 said one line;
   the plan's open item). Cost: a reader of
   `src/services/clients/SonioxSttStream.ts` sees a bare re-export with no
   context, until Plan B deletes the stubs.
2. **`FIN_TRANSLATION_GRACE_MS` = 2,000 ms stays a judgement**, settled by the
   owner's live test (item 7). Cost: the last words' translation after a
   push-to-talk release is revised in rather than shown with its row, or a row
   stays open 2 s.
3. **Implementers sign their commits with their own model name and the
   session trailer.** Cost: none.
4. **Task 1's leaked-interval re-arm is fixed with `pinnedRealClock()`** in
   `src/lib/contract/clock.ts`: it snapshots `setTimeout` / `clearTimeout` when
   called; the three `every()` sites (`pcmMixer.ts`, `sttStream.ts`,
   `ttsStream.ts`) use it when no clock was injected; one-shot timers stay on
   `realClock`; `clock.ts` and its test joined Task 1's files. Why: the old
   read-only test cannot change, and the suite gate must not depend on load.
   Cost: one more clock helper in the contract.
5. **No global WebSocket guard in `setupTests`** — the old tests rely on jsdom's
   or a stubbed `WebSocket`. Instead every Soniox session-side implementer
   (Tasks 2, 7, 8, 9) injected `FakeSocket` / `openSocket` from its first RED
   run and never exercised the default socket (a RED run before injection had
   dialled Soniox once with a dummy key). Cost: one more accidental handshake
   to Soniox with no key.
6. **Task 7's `open()` → `ensure(true)` accepted**: the start and a reconnect
   share one connect path; choice 6 (a start failure is Logs-only, waiting text
   is retried at once, one `tts_stopped` per episode) is unchanged. The review
   judged it sound and better than the draft. Cost: a path where the shared
   connect changes an old behaviour — revert then.
7. **TTS degradations no longer reach `api_error`** (Task 7's plan-mandated
   Important): no code change in this plan; listed under the stated departures
   and put to the owner below. Cost: degraded-TTS counts stay invisible in the
   dashboards until the owner decides.
8. **A start resolves on the STT socket alone** (Task 8's plan-mandated
   Important, the review's option B): `await stt.connect(…)`, the speech's
   socket opening beside it (`void leg.speech?.open()`). Safe because
   `LegSpeech.open` never rejects, `speak()` queues while connecting and
   `close()` reaches an opening socket; a case pins an STT 401 while the TTS
   socket connects (the start resolved, then one `failed` `auth`). Why: it
   matches the old client, whose TTS connect was separate and silent; it keeps
   analytics deterministic (a bad key always records `api_error`); it removes a
   coupling on the runner. Cost: a start "succeeds" a few ms before its TTS
   socket exists, its speech queued, as the old client's was.
9. **Task 12's stale Validate fixed in the task**: an edit aborts the in-flight
   check (the existing `finally` clears `validating`), with a deferred-promise
   test. Why: the wizard must never tell the user an unchecked key was
   accepted — before the fix an edit during a Validate (up to 15 s) was answered
   "Key accepted." for the key it no longer held (Start stayed locked, since
   the store re-checks after Finish). Cost: none.

**Stated departures from today:**
- Soniox runs on the new session: its old client and settings UI stay compiled, unreachable from it, until Plan B.
- **Karaoke on Soniox:** a sentence lights once its TTS segment has ended, from where playback is; before that, and for a segment Soniox killed, nothing lights. What is lit stays lit while the row's next sentence plays unlit (choice 18). A fill-in that lands after the clip played out lights only on replay. The old client had no karaoke at all.
- **Push-to-talk and push-to-translate on Soniox** (D14): `finalize` on release, `<fin>` the boundary.
- **The participant is voiced when its switch is on** (ruling 4), shared and split: a second TTS socket on the user's key. The old client kept the participant text-only.
- **Late translation tokens** after a boundary revise the ended utterance's translation instead of starting an orphan row (choice 3), including when they share a message with the next utterance's first words; after `<fin>` the translation stays provisional for up to 2 s.
- **Errors end the run through `failed`** with a code: `connection_lost` (the old sentence, through its alias), `auth`, `rate_limit`, `client`, `server` with the server's words as the detail.
- **Analytics shift for the owner's dashboards** (choice 8, kept on the review; widened by Task 8): `api_error.error_code` carries the failure's code where the old client sent Soniox's status — `auth` for `401` (and `403`), `rate_limit` for `429`, `client` for another 4xx, `server` otherwise, and `connection_lost` with `error_type` `server` where it sent `503`, `408` or `socket_closed`. `error_type` follows the code. A dashboard grouping Soniox errors by code sees new values, and the three connection codes merged into one.
- **TTS degradations no longer reach analytics** (Task 7; the controller's ruling 7 above): the old client sent a speech failure through `onError`, so `api_error` counted it (`error_code` `tts_<code>`: `tts_408`, `tts_socket_closed`, `tts_connect_failed`). On the new session a `degraded` is an L1 notice only, and the runner tracks `api_error` for `failed` alone (`run.ts:441-444`). An open question for the owner (below).
- **A second speech failure within 5 s shows nothing** (Task 7): L1 drops a `degraded` of the same code within `DEGRADED_DEDUPE_MS` (`Conversation.ts:25`, 5 s), so a second `tts_segment_lost` or `tts_stopped` episode inside 5 s of the first raises no notice; the old client raised a bubble per episode.
- **An unreadable Soniox frame is logged, not shown** (choice 7, reversed on the review): one `stt.unreadable` / `tts.unreadable` frame per episode in the Logs, where the old client dropped it silently. No notice, no locale text.
- **A TTS connect failure at start and a failed resume attempt** reach only the Logs (as before: the old `diagnose` calls). The start failure is retried by the first translation, and a failed retry says "speech stopped" once, as before (choice 6).
- **No "session ended" separator in the Logs for a Soniox run** (Task 8): the old client emitted `session.closed`, which LogsPanel draws that separator from (`LogsPanel.tsx:257-258`); the new adapter does not, and neither does LocalInference's. A run's end is the runner's to log, for every provider — not yet written.
- **Frames go to the socket's first leg** (choice 16; the review's M16): in shared Both every socket-level and token frame appears in the speaker leg's Logs; the survey (§2.9) had routed them to each utterance's leg. A leg's TTS frames go to that leg.
- `tts.audio`'s `bytes` is now the byte count; the old client sent the sample count under that name.
- **Soniox's key is checked on its own** (the foundation's readiness driver): at once when selected, 800 ms after an edit — a temporary key minted each time, also after a vocabulary or voice edit.
- **Voice previews play on the selected output device** (the preview route), not the system default.
- **The endpoint knobs** moved to the Provider tab's turn-detection block, with a summary in the Speech section; **the shared-session pills** as before, inert outside Both. On the Provider tab the shared-session section now sits above the endpoint tuning, because the host draws `TurnDetection.Controls` after the provider's `Settings` (D18); the old UI had them the other way round (Task 10b).
- **The Speech mode's tooltip** is provider-neutral for every provider, LocalInference included.
- **`translation_session_start`** reports `asr_model: 'stt-rt-v5'` and, when speaking, `tts_model: 'tts-rt-v2'` for Soniox.
- **A stored `'soniox'` selection** now loads Soniox instead of falling back to LocalInference (`selectionFromStored`, Task 11).
- **The wizard offers the own-key path again**, listing the registry's own-key providers (Soniox; and the fake in development builds).

**Corrections to the foundation plan's Soniox list** (above):
- The `sonioxServiceUnavailable` / `sonioxServiceBusy` aliases belong to Kizuna
  Soniox: only the managed session-key path raises those sentences
  (`ManagedSonioxSession.ts:734, 769-771`; survey §3.7.5). This plan added the
  two TTS aliases — `tts_segment_lost` → `sonioxTtsSegmentLost` and
  `tts_stopped` → `sonioxTtsFailed` (`noticeText.ts:92-94`) — and is the first
  provider to emit the foundation's `connection_lost` (`:91`).
- "The four voice-preview sites folded into `Playback.preview`": two sites
  play, and one of them folds (spec amendment 6 above). `VoiceLibrarySection`
  plays through the route wherever its host hands it a port — Soniox's does;
  `SonioxCloneReviewStep` stays on the default output (ruling 6).

**The locale spot check** (ruling 8), for a native speaker: the 29 non-`en`
values of `settings.speechModeTooltip` and `settings.speechModeAppliesToAuto`,
as Task 11's implementer derived them (`bef09ca0`). The English source:

- `settings.speechModeTooltip`: `Auto: the provider detects when you have finished speaking. \nPush-to-Talk: hold Space or the mic button to send audio manually. \nPush-to-Translate: like Push-to-Talk, but routes your raw mic to the virtual mic when idle so you can speak directly without translation.`
- `settings.speechModeAppliesToAuto`: `Applies to your voice. Other's audio always uses the provider's automatic detection.`

In every locale, `speechModeTooltip`'s Push-to-Talk and Push-to-Translate lines
are, word for word, that locale's existing
`settings.localInferenceTurnDetectionTooltip` lines; only the Auto line is new,
so the table shows only that line (a trailing space in a cell is the one the
locale keeps before `\n`). In `speechModeAppliesToAuto` only the second sentence
is new: the first is the locale's existing `speechModeAppliesTo` sentence. Each
locale's word for "provider" is its `settings.tabs.provider` label's.

| Locale | `speechModeTooltip` — its first (Auto) line, as shipped | `speechModeAppliesToAuto` |
|---|---|---|
| `ar` | تلقائي: يكتشف المزود متى انتهيت من الكلام.  | ينطبق على صوتك. صوت الآخر يستخدم دائمًا الكشف التلقائي للمزود. |
| `bn` | অটো: আপনার কথা বলা কখন শেষ হয়েছে তা প্রদানকারী শনাক্ত করে।  | আপনার কণ্ঠস্বরে প্রযোজ্য। অন্যের অডিও সবসময় প্রদানকারীর স্বয়ংক্রিয় শনাক্তকরণ ব্যবহার করে। |
| `de` | Auto: Der Anbieter erkennt, wann Sie zu Ende gesprochen haben.  | Gilt für Ihre Stimme. Das Audio des Gegenübers verwendet immer die automatische Erkennung des Anbieters. |
| `es` | Auto: el proveedor detecta cuándo ha terminado de hablar.  | Se aplica a tu voz. El audio del otro siempre usa la detección automática del proveedor. |
| `fa` | خودکار: ارائه‌دهنده تشخیص می‌دهد چه زمانی صحبت شما تمام شده است.  | برای صدای شما اعمال می‌شود. صدای طرف مقابل همیشه از تشخیص خودکار ارائه‌دهنده استفاده می‌کند. |
| `fi` | Auto: tarjoaja tunnistaa, milloin olet lopettanut puhumisen.  | Koskee omaa ääntäsi. Toisen ääni käyttää aina tarjoajan automaattista tunnistusta. |
| `fil` | Auto: natutukoy ng provider kung kailan ka tapos nang magsalita.  | Naaangkop sa inyong boses. Ang audio ng kausap ay palaging gumagamit ng awtomatikong pagtukoy ng provider. |
| `fr` | Auto: le fournisseur détecte quand vous avez fini de parler.  | S'applique à votre voix. L'audio de l'autre utilise toujours la détection automatique du fournisseur. |
| `he` | אוטומטי: הספק מזהה מתי סיימת לדבר.  | חל על הקול שלך. שמע הצד השני תמיד משתמש בזיהוי האוטומטי של הספק. |
| `hi` | ऑटो: प्रदाता पता लगाता है कि आपने बोलना कब समाप्त किया।  | आपकी आवाज़ पर लागू होता है। दूसरे का ऑडियो हमेशा प्रदाता की स्वचालित पहचान का उपयोग करता है। |
| `id` | Otomatis: penyedia mendeteksi kapan Anda selesai berbicara.  | Berlaku untuk suara Anda. Audio lawan bicara selalu menggunakan deteksi otomatis dari penyedia. |
| `it` | Auto: il fornitore rileva quando hai finito di parlare.  | Si applica alla tua voce. L'audio dell'altro usa sempre il rilevamento automatico del fornitore. |
| `ja` | 自動：話し終わりをプロバイダーが自動的に検出します。 | あなたの声に適用されます。相手の音声は常にプロバイダーの自動検出を使用します。 |
| `ko` | 자동: 말이 끝나는 시점을 제공자가 자동으로 감지합니다.  | 내 음성에 적용됩니다. 상대방 오디오는 항상 제공자의 자동 감지를 사용합니다. |
| `ms` | Auto: penyedia mengesan apabila anda selesai bercakap.  | Digunakan untuk suara anda. Audio pihak lain sentiasa menggunakan pengesanan automatik penyedia. |
| `nl` | Auto: de provider detecteert wanneer u klaar bent met spreken.  | Van toepassing op uw stem. Audio van de ander gebruikt altijd de automatische detectie van de provider. |
| `pl` | Auto: dostawca wykrywa, kiedy kończysz mówić.  | Dotyczy Twojego głosu. Dźwięk rozmówcy zawsze używa automatycznego wykrywania dostawcy. |
| `pt_BR` | Auto: o provedor detecta quando você termina de falar.  | Aplica-se à sua voz. O áudio do outro sempre usa a detecção automática do provedor. |
| `pt_PT` | Auto: o fornecedor deteta quando terminou de falar.  | Aplica-se à sua voz. O áudio do outro usa sempre a deteção automática do fornecedor. |
| `ru` | Авто: поставщик определяет, когда вы закончили говорить.  | Применяется к вашему голосу. Аудио собеседника всегда использует автоматическое определение поставщика. |
| `sv` | Auto: leverantören känner av när du har talat klart.  | Gäller din röst. Den andras ljud använder alltid leverantörens automatiska detektering. |
| `ta` | ஆட்டோ: நீங்கள் எப்போது பேசி முடித்தீர்கள் என்பதை வழங்குநர் கண்டறியும்.  | உங்கள் குரலுக்குப் பொருந்தும். மற்றவரின் ஆடியோ எப்போதும் வழங்குநரின் தானியங்கு கண்டறிதலைப் பயன்படுத்துகிறது. |
| `te` | ఆటో: మీరు మాట్లాడటం ఎప్పుడు ముగించారో ప్రదాత గుర్తిస్తుంది.  | మీ స్వరానికి వర్తిస్తుంది. ఇతరుల ఆడియో ఎల్లప్పుడూ ప్రదాత యొక్క స్వయంచాలక గుర్తింపును ఉపయోగిస్తుంది. |
| `th` | อัตโนมัติ: ผู้ให้บริการจะตรวจจับว่าคุณพูดจบเมื่อใด  | ใช้กับเสียงของคุณ เสียงอีกฝ่ายจะใช้การตรวจจับอัตโนมัติของผู้ให้บริการเสมอ |
| `tr` | Otomatik: sağlayıcı, konuşmanızın ne zaman bittiğini algılar.  | Sizin sesinize uygulanır. Karşı tarafın sesi her zaman sağlayıcının otomatik algılamasını kullanır. |
| `uk` | Авто: постачальник визначає, коли ви закінчили говорити.  | Застосовується до вашого голосу. Аудіо співрозмовника завжди використовує автоматичне виявлення постачальника. |
| `vi` | Tự động: nhà cung cấp phát hiện khi bạn đã nói xong.  | Áp dụng cho giọng nói của bạn. Âm thanh đối phương luôn sử dụng tính năng phát hiện tự động của nhà cung cấp. |
| `zh_CN` | 自动：由提供商自动检测您何时说完。 | 适用于您的语音。对方音频始终使用提供商的自动检测。 |
| `zh_TW` | 自動：由提供商自動偵測您何時說完。 | 適用於您的語音。對方音訊始終使用提供商的自動偵測。 |

What to look at, beyond the words:
- **`es` and `pt_PT` leave the Auto line's subject unstated**, so it can read as
  the provider finishing speaking. The final fix wave is to reword them — `es`
  "…detecta cuándo usted ha terminado de hablar.", `pt_PT` "…deteta quando o
  utilizador termina de falar." — so check the reworded lines, not the table's.
- "Automatically" is not uniform: `ja` 自動的に, `zh_CN` 自动, `zh_TW` 自動 and
  `ko` 자동으로 carry it, as the plan wrote them; the English and the other 25
  do not. Both readings are accurate.
- Register follows each key's existing sentences, which were already mixed: in
  `es` the tooltip's push lines use *usted*, so the new Auto line does, while
  `speechModeAppliesTo`'s kept first sentence uses *tú*. `pt_PT` is formal
  throughout; `pl` uses a gender-neutral present; `ms` the formal "apabila".
- `fr` keeps the catalog's own "Auto:" with no space before the colon, as its
  push lines do, where French typography writes "Auto :".
- `zh_CN` uses 提供商 (from `settings.tabs.provider` and the notices), not 服务
  (`setup.summary.provider`).

**The owner's live test** (survey §2.13, rewritten for ruling 2's karaoke, with
the `<fin>` and first-audio checks; the additions the task reviews asked for are
marked by their task):
1. **Each region** (a US key, then EU, JP if held): the key field swaps with the region; Validate and the automatic check answer per region; the session dials that region (Logs `session.opened` with its region); a US key in the EU slot is refused with words.
2. **A bad key:** the credential form says "The provider did not accept the credentials: …"; Start is off.
3. **Languages:** a concrete pair (ja → en); an auto source, speaker only, with badges showing the detected language and fill-in on unpunctuated source text; auto with Both → Start off with the participant words.
4. **Speech heard** on the monitor, and in the virtual microphone in a meeting app, once each. **First-audio latency** against the old build: the same (chunks play as they arrive).
5. **Karaoke (ruling 2):** a sentence is not highlighted while its first chunks play; once its TTS segment ends the highlight starts from where playback is and sweeps to its end; it stays aligned after punctuation fill-in; a segment Soniox killed never lights. **A multi-sentence translation: the highlight never blinks off between sentences** — what is lit stays lit while the next sentence plays unlit, and that sentence lights from where playback is once its own segment ends (the hold, choice 18). Replay with "Keep audio for replay" on plays the utterance; off, no replay control.
6. **Text only:** no TTS socket in Logs.
7. **Push-to-talk:** a short press closes the rows on release, without the endpoint delay, and **the last words' translation arrives complete** — within the 2-s hold after `<fin>`, or landing on the closed row as a revision (never cut off); this settles `FIN_TRANSLATION_GRACE_MS`, a judgement (the controller's ruling 2 above). Once the hold has closed a translation, each later late message is spoken as its own TTS utterance: listen for it sounding chopped (Task 6). More than 20 s idle between presses → no 408, no connection-lost; a long hold with pauses; push-to-translate routes the raw voice while idle.
8. **Shared Both:** one STT socket (Logs); sides right, including a same-language participant and overlapping speech — **a same-language pair** is where the side rests on the speaker label and the energy alone, latched at the utterance's first token (Task 9); the participant-speech switch off → the participant silent; on → heard on the real device (new, ruling 4: a second TTS socket on the key); push-to-talk in shared Both finalizes the far end too (acceptable?). **Shared Both for ~10 minutes: latency does not grow** (the final fix wave made `every()` drift-free: the mixer's 100-ms ticks stay on the grid however late the browser fires them, so its STT audio no longer falls behind and is not dropped).
9. **Split Both:** two STT sockets; either leg ending ends both; a denied loopback fails the start naming the participant.
10. **Participant-only.**
11. **The 408 case:** a long monologue with clauses and no full stop (> 8 s) — no "Part of the spoken translation could not be played" in normal speech; if it appears, the words say part was lost, not stopped.
12. **Voice library:** built-ins listed; a preview plays on the **selected output device** (new: the preview route); record and upload a clone (3–120 s) → processing → ready → select → heard in a session → delete; switching region shows that region's clones; a bad key shows `sonioxVoiceListError`; the clone-review player still plays on the default output (ruling 6).
13. **Vocabulary and background:** terms bias recognition; an oversized vocabulary is truncated, with a warning in Logs.
14. **Endpoint knobs:** on the Provider tab's turn-detection block, and summarized in the Speech section; max pause 3 000 ms keeps paused sentences whole.
15. **A network drop mid-session:** the connection-lost words, and the run ends. **A 503**, if Soniox has one while you test: the session resumes (Logs `session.stt_503`, then `session.stt_resuming` and `session.stt_resumed`). The resume starts at the socket's close; if the socket reports an error between the 503 and its close, the run fails with `connection_lost` instead (Logs `session.connection_lost` with `socket_error`) — note which Soniox does (Task 8).
16. **Stop mid-utterance:** rows finalized, no audio after Stop, the auto-save file's content.
17. **The extension:** the same core flows in the side panel.
18. **The wizard:** the own-key path with a Soniox key.

What it leaves, for the plans that meet it (the plan's own list, as written):

**Kizuna Soniox** (`kizunaai_soniox`, Plan B) — the roadmap's list, plus what this plan reserved:
- F11, whole: `managed(soniox, { id: 'kizunaai_soniox', settings key 'kizunaSoniox', vendor 'Soniox', … })`, `SessionHooks.minimumBalance`, `Resources.budget`, `RunState.running.budget`, the live gate's balance floor, `SessionCountdown`, `AccountButton`, the managed account row and "Recommended".
- The lease behind **`SonioxLeasePort`** (Task 5; used by Task 8): `streamAccepted` → `session-started`, `atGrantEnd` / `cutoff` → the `segment_ended` end, and no 503 resume when a lease is present — the adapter's side is built and stub-tested; the lease module (from `ManagedSonioxSession`), its timers on `ctx.clock`, is Plan B's.
- Per-leg `K` from the lease (`mix_*` shared on the speaker leg, `spk_*` / `par_stt` split): `startBoth` already reads each leg's own `credentials`; the lease must answer `credentials('participant')` without throwing in shared mode.
- **`K.tts` absent** while speaking → text-only with `tts_degraded` (Task 8, case 24): participant speech against a lease that mints no participant TTS role is Plan B's decision (spec open question).
- The voice claim in `prepare`, and the managed voice source through `createSonioxSettingsView({ managed: true, useVoiceSource })` (Task 10b's seam).
- The `sonioxService*` and `sonioxVoice*` aliases, `insufficient_balance` and the other lease words; a Settings target for `sign_in_required`.
- The wizard's managed path (`managedProvider`, `managedOption` still read the old factory); `selectionFromStored` for `'kizunaai'` and unported managed ids. `providerFits` now reads the registry, so it answers `false` for a managed id until Plan B registers one — `StepScenario.tsx:49` reads it, which matters once the managed path is offered again (Task 12, the review's M10).
- The registry's final order and the release flags (roadmap, "Before any release from the branch").
- **Deleting both providers' old code** after Plan B's paid live test: `SonioxClient` and its tests, both descriptors, `sonioxBothMode.ts`, `ManagedSonioxSession`, the old settings UI's Soniox branches in `ProviderSpecificSettings.tsx`, the settings-store slices' readers, the managed-Soniox MainPanel chips — and the six re-export stubs of Task 1 once nothing imports them.
- **What that deletion must keep** (the review's M14) — the new provider uses these after this plan, so "the old settings UI's Soniox branches" does not cover them: `SonioxVoiceSection.tsx`, `voiceLibrarySource.ts`, `VoiceLibrarySection.tsx`, `VoicePicker.tsx`, `VoiceCreateModal.tsx`, `SonioxCloneReviewStep.tsx`, and the moved `src/providers/soniox/ttsRest.ts` and `voicesClient.ts` (with their tests). Deleting the stubs means first re-pointing the imports that still go through them — `voiceLibrarySource.ts` and `SonioxVoiceSection.tsx` import `SonioxVoicesClient` / `SonioxTtsRest` from `src/services/clients/` (`voiceLibrarySource.ts:15-18`, `SonioxVoiceSection.tsx:44`) — at `src/providers/soniox/`.

**Found here, for the owner or a later plan:**
- **Readiness re-probes on every Soniox settings edit** (survey §3.6): the kept answer is keyed on the whole `S`, so a vocabulary keystroke or a voice pick mints a temporary key 800 ms later. Harmless (free, per region), chatty; a provider-declared "check inputs" narrowing is a generic change, not a provider's.
- **`timing` after a 503 resume** restarts at 0 (Soniox's clock restarts per socket); origins are stated, so L2 infers nothing from it. An offset is optional.
- **`audio.range` after fill-in:** the late-measure hole `speechRanges` closes with `unfilled` exists for an `audio` range arriving after fill-in too; no adapter sends one (LocalInference closes after its last audio).
- **The other voice-preview sites:** `LocalInferenceVoiceSection` (it renders `VoiceLibrarySection` with no preview route) and `nativeVoiceStores` fold in with their providers' plans; `SonioxCloneReviewStep` stays on the default output (ruling 6).
- **The side decision is latched at an utterance's first token**, as before; a wrong latch now puts the utterance on the other leg's L1 (survey §3.6).
- **Two TTS sockets per key** in shared Both with participant speech: Soniox's concurrency quota is unmeasured (the live test's item 8).
- `Conversation.afterAudio` drops a whole `pending` list past the pcm ceiling without counting it in `clearedEntries`; no provider parks audio before its segment opens and emits `speechRanges` today. When one does, empty the dropped entries' pcm (`EMPTY_PCM`) and keep the entries, as the segments branch does — adding to `clearedEntries` alone would realign range indices but not clip keys.

**Stage 2 items from the roadmap this plan does not take:** the kit's parked items (`{ flush: true }` after an awaited answer, `FakeSocket`'s close codes, the virtual clock's `pending()` count, manual-end's segment check); the account's compile-time narrowing; the leased fake's refused hooks; `RunnerDeps.replayAudio`'s guard; the notice-code namespace.

**Before any release from the branch**
- **The release flags and the registry's final order** stand as the foundation's
  entry above states them. This plan changes only the order case, which now pins
  `['localInference', 'soniox']` (`registry.test.ts:204`; Soniox second by the
  plan's ruling 7); the owner still decides the final order once, before Kizuna Soniox
  lands. — Decided by the Kizuna Soniox plan's ruling 6 (its entry below).
- **The owner's live test above**, before Plan B builds on the adapter and
  before any release that carries it. — **Passed** (owner, 2026-09-27): all
  eighteen items, item 8's ten-minute shared-Both latency check included, with
  no problems. Item 7 passing settles `FIN_TRANSLATION_GRACE_MS` at 2,000 ms.
  Plan B1 (the Kizuna Soniox plan below) built on the adapter after it.
- **The wizard's own-key description** (`setup.paths.own-key.desc`) names
  "OpenAI, Gemini, Doubao (Volcengine) and others" (group check B, item 4). It
  is true once those providers are ported; a release while Soniox is the only
  own-key provider promises providers the path does not list.

**Open questions for the owner**
- **Analytics for `degraded`** (the controller's ruling 7): TTS degradations no
  longer reach `api_error`, so degraded speech is invisible in the dashboards.
  Accept that, or add a runner-level analytics event for `degraded` codes — a
  cross-provider decision, LocalInference's `tts_degraded` included, not a
  Soniox one.
- **The two keys' native-speaker check** (the table above), including the `es`
  / `pt_PT` subject the final fix wave is to reword.
- **`FIN_TRANSLATION_GRACE_MS`** (2,000 ms): the live test's item 7 settles it.

## Scheduled by the Stage 2 Kizuna Soniox plan

The Stage 2 Kizuna Soniox plan
(`docs/superpowers/plans/2026-09-27-client-contract-stage2-kizuna-soniox.md`,
plan commit `4bc56808`, revised `d9d9c38c` with the owner's rulings, both over
`a63c366b`'s code) landed as the sixteen commits after it, `e93f6082` through
`0a7b903e` (**+5,741 / −946 lines across 123 files**, `d9d9c38c..0a7b903e`),
then this record with the spec's amendments. The final whole-plan review and
its fix wave came after this record (`62ee4003..` the fix wave's head): what
the wave did, commit by commit, is recorded below under "The final fix wave".
It is Plan B1 of the survey's two (§5.1)
— **Kizuna AI's managed Soniox** (`kizunaai_soniox`) on the new session, as
`managed(soniox, …)` with its lease, voice claim, balance floor, countdown,
account row and the wizard's managed path. Plan B2 deletes both Soniox
providers' old code after the owner's paid live test below; until then the old
managed code stays compiled and unreachable (ruling 1). Its prerequisite, Plan
A's live test, passed on 2026-09-27 (the Soniox entry's "Before any release",
above). Twelve implementation tasks ran in five waves — Task 1; Tasks 2, 4, 5
and 7; Tasks 3 and 6; Task 8; Tasks 9–12 — with group check A after the third
and group check B after the fifth. Tasks 2, 3, 5 and 12 took one review fix
round each; every other task was approved as its implementer committed it.
Task 13 is this record. The survey the plan was written from is named in its
research notes.

**The rulings — every one the owner's** (2026-09-27; the plan's header):
- **Decided before the draft:** ruling 2 (participant speech built end to end
  and shipped off behind one flag) and ruling 6 (Kizuna AI first in the
  registry; D19's flag model).
- **Confirmed as drafted:** ruling 3 (the grant's end worded by whether the cap
  was hit), ruling 4 (the sign-in auto-switch kept, Basic mode only), ruling 7
  (one lease-end notice) and ruling 10 (`session-end` three attempts within
  4 s, and the smaller choices).
- **Confirmed on a condition:** ruling 9 (the sources before the lease), "if it
  does not go against the architecture's philosophy and purpose". Before
  execution the controller checked the three guarantees the spec's "A run"
  rests on — every resource pushed with its release when acquired; the signal
  reaching every step; the lease released after the legs' sessions — and that
  the runner stays generic. Task 2's review then found the third held for the
  legs' sessions but not their sources: a lease run unwound session → lease →
  source, the microphone still open through `session-end`. Its fix round
  reserved the lease's release slot beneath the sources (the controller's
  ruling 3 below), and the spec now states that order.
- **Overturned in the revision `d9d9c38c`:** ruling 5 — the draft let an
  unknown balance start, the backend's 402 the authority; an unknown balance
  now refuses Start, as the released app's gate does, with "Checking..." while
  the first fetch is in flight and a re-fetch when the network returns.
  Ruling 8 — the draft accepted the lost `api_error` events as stated
  departures; they are restored, generically in the runner.
- Rulings 1 and 11–14 are the plan's frame.

What landed, by task:
- **Types, the read type and `managed()`** (`e93f6082`, Task 1):
  `Provider<S, K, C, R = K>` — `read` answers `R`, `check` takes it, `start`
  keeps `K`; `managed.ts`'s `ManagedSignIn`, `readSignIn` (`sign_in_pending`
  while the sign-in loads) and `managed(base, overrides)`, member by member;
  `AuthContext.loaded?`; `participantSpeech?`; `AccountState`,
  `RunShape.account?`, `BalanceShape`, `Budget`, `Resources.budget?`,
  `LeaseContext` (`signal`, `clock`, `end(notice, { expected? })`, `frame`),
  `SessionHooks.minimumBalance?`, `RunState.running.budget?`; `degraded`'s
  `reason?`. Four `@ts-expect-error` cases in `managed.test.ts`, which the
  typecheck gate enforces.
- **The runner** (`a3e239f3`, fix round `29f7d950`, Task 2): a run with a lease
  or `startBoth` opens every leg's source before `acquire` (ruling 9) and hands
  its legs over only after it (choice 3); a lease's end is one notice, on the
  first leg (ruling 7); `api_error` again for a start that fails, a lease end
  not marked `expected`, and every `degraded` — `reason ?? code`, once per leg
  and code in 5 s (ruling 8, `apiErrorType`); the lease's frames go to the
  first leg's Logs; the running state carries the budget; Soniox's speech
  passes `reason: tts_<cause>`; the leased fake gains `acquireRefused`,
  `minimumBalanceMicroUsd`, a budget and a `lease.acquired` frame. The fix
  round: the lease's release slot is reserved beneath the sources
  (`run.ts:205-217`), so a run unwinds sessions → sources → lease, and an
  `acquire` that returns after the stop's bounded wait is released at once
  (`:256-258`); seven tests — the per-leg dedupe key, Stop while a source opens
  (no `acquire`), the release order on Stop of one leg, of both, of `startBoth`
  and on a failure after `acquire`, and the late-lease guard; two stale
  comments.
- **The participant-speech flag's readers** (`49c7ad8d`, Task 4): `contextsFor`
  gives the participant no speech while the provider's flag is off;
  `participantSpeechFromStores` feeds the shape, the live gate and the account
  button's floor; `ParticipantSpeechSwitch` shows off and disabled with the
  "not available yet" tooltip, keeping the stored choice, the provider's rule
  before the whole-system one; one new key,
  `audioPanel.participantSpeechNotYetAvailable`, in the 30 catalogs.
- **The lease I** (`c613caec`, fix round `b9fe32b4`, Task 5): `leaseRequest.ts`
  (the request and its roles; `PARTICIPANT_SPEECH_FIELD` sent only while the
  flag is on), `kizunaBudget.ts` (the rates, floors and caps mirrored from the
  backend at `7b2259c`, with parity tests) and `lease.ts` — the session key
  bounded at 15 s on the run's clock, its body included; a 409 retried once
  after `retryAfterMs` (3 s when absent); its codes (401 `sign_in_required`,
  402 `insufficient_balance`, 403 `wallet_frozen`, 409 `session_conflict`, 502
  or a timeout `soniox_service_unavailable`, 503 `soniox_service_busy`, a
  transport failure `network`); a contract break failing the start; per-leg
  keys, `par_tts` mapped only while the flag is on; the grant as `budget`, its
  end worded at acquire (ruling 3); `session-end` with `keepalive` and the
  cached token, three attempts within 4 s, cancelled by the next acquire. The
  fix round: a case pins the grant-end words over the minted role set, a
  `par_tts` grant included; an abort between the 409 wait and the retry now
  stops it; `parseGrant`'s contract checks are pinned, a `1e999` duration
  among them; `keepalive` is dropped for the rest of a release after a
  transport failure; a 402's wallet figures leave the thrown message for a
  `session.refused` frame.
- **The managed voice** (`aa3d7b18`, Task 7): `ManagedVoicesClient` and
  `managedVoicePolling` moved by `git mv` into `src/providers/soniox/`, their
  history kept, with a one-line stub at each old path; `managedVoicePrep`
  ported to `voicePrep.ts`, answering codes (`voicePrepCode`), the old copy
  kept for B2; `voiceClaim.ts`, Kizuna Soniox's `prepare`;
  `managedVoiceSource.ts` (`useManagedVoiceSource`, `setManagedVoiceStandIn`);
  `startLabel` names the `preparing` step "Preparing your voice…".
- **The lease II** (`487625f1`, Task 6): one `SonioxLeasePort` per STT role —
  `streamAccepted` posts one `session-started` per role, never once released;
  `atGrantEnd` with `GRANT_END_MARGIN_MS` (90 s, the old cutoff margin);
  `cutoff` ends the run in the grant's words. Shared Both's participant carries
  no port.
- **The account's wallet and the gate's floor** (`0e4280f0`, fix round
  `06d58302`, Task 3): `useAccountStore`, written by `UserProfileContext`,
  which re-fetches an unknown wallet on `online` and after 15, 30 and 60 s
  (`WALLET_RETRY_DELAYS_MS`); `balanceRefusal` last in `gate()` —
  `quota_pending`, `quota_unknown`, `wallet_frozen`, `balance_below_floor`;
  `RunShape.account`; the live gate and `appSubtitleSession` follow the wallet,
  text-only and the participant switch. The fix round: case 5 signs out a fresh
  failed render mid back-off; the routing subscription is pinned; an unmount
  during the back-off clears its timers and listener; a doc comment; test
  tidying.
- **Kizuna Soniox** (`4a5d3293`, Task 8): `kizuna.ts` —
  `createKizunaSonioxProvider({ participantSpeech })` over
  `managed(sonioxProvider, …)`, the one flag reaching its capability, its lease
  and its floor, shipped as `KIZUNA_PARTICIPANT_SPEECH = false`;
  `RELEASED = [kizunaSonioxProvider, localInferenceProvider, sonioxProvider]`
  (ruling 6); ten `NOTICE_ALIASES` rows (the lease's two Soniox service
  sentences, the four voice-claim sentences, the gate's balance sentence,
  `sign_in_pending`, and the wallet's two);
  `NOTICE_TARGETS.sign_in_required: 'provider'`;
  `kizunaParticipantSpeech.test.tsx`, flag off and flag on, end to end.
- **The account row** (`47c1e269`, Task 9): `ManagedAccountRow` — "Checking..."
  with a spinner while the sign-in loads, "Automatically authenticated via your
  account", or the sign-in sentence whose link opens the account popover;
  "Recommended" on the picker's first managed provider; `loaded` through
  `useAuthContext` and the session's bridges, a flip of it forgetting managed
  readiness; the preview's `AuthStandIn` and its managed voice stand-in.
- **The countdown and the dot** (`634e3bcb`, Task 10):
  `SessionCountdown({ budget, now? })` in both footers while a run has a
  budget, low under 20 %; `useBalanceShortfall` — the account button's dot is
  the gate's own `balance_below_floor` for the selected provider;
  `selectedFromStores` exported.
- **The wizard's managed path and the stored-selection fallback** (`f75586a4`,
  Task 11): `managedProvider`, `availablePaths` and `managedOption` read the
  registry; a stored `'kizunaai'` or relay-twin id selects the default managed
  provider on load (`MANAGED_LEGACY_IDS`), never written back.
- **The sign-in auto-switch** (`a34a5b18`, fix round `0a7b903e`, Task 12):
  `useSignInProviderSwitch` — Basic mode, outside the wizard, from a
  non-managed provider, through `select(id, 'pick')`, loading the entry and
  tracking `settings_modified`; a session restored at launch is not a sign-in
  (choice 14). The fix round: three wiring cases pin `MainLayout`'s call; a
  signed-out answer carrying an error counts as not loaded (a failed session
  fetch reads loaded and signed out, so the refetch when the network returned
  would have switched and rewritten the stored provider); the lock is checked
  before `select`, so a sign-in during a run logs no refusal; a spy on `load`;
  two comments.

**The spec's amendments** (this record's commit), the plan's eleven and what
execution added:
1. "The shape": `Provider<S, K, C, R = K>`, `read` answering `R` or a coded
   missing, `check(r: R, …)`, `participantSpeech?`, and the plan's note.
2. "Managed twins are composition": what `managed()` takes from the base and
   what is the twin's own — its participant-speech flag added to the plan's
   list (`managed.ts:62`).
3. "Readiness is one check": the loading sign-in, the static managed `check`,
   the wallet as the gate's input. The paragraph's "the service's answer for
   managed ones" now reads "a static yes", and "When checks run" counts the
   sign-in finishing loading as a flip.
4. "A run": the steps in the code's order, the lease's release slot a step of
   its own beneath the sources (Task 2's fix round), and "Order removes the
   lease race" rewritten around it.
5. "Legs rise and fall together": one lease-end notice; and a notice recorded
   while the lease or the other source is still opening lands only if the
   start succeeds (Task 2's review, M5).
6. "Session hooks": the signatures; `release`'s policy, with `keepalive` dropped
   after a transport failure and a refusal's wallet figures kept to the Logs'
   frame (Task 5's fix round); the grant-end words; `frame`; `minimumBalance`
   over the wallet, its formula.
7. "The runner": `RunState`.
8. "Stopping, and closing the window": the token cached at acquire.
9. "Parameters and deferred decisions": the release bound and `session-end`'s
   retries.
10. "Stage 2 — open for the plans that meet them": participant speech, the
    types, item 8's token.
11. "Session hooks": the session key's refusals, with 502 added to the plan's
    list — the backend answers it when Soniox mints no key
    (`BE:routes/soniox.ts:577` at `7b2259c`), and the lease words it
    `soniox_service_unavailable`.
And from execution (ruling 8): "Analytics"' `api_error` row as the runner
tracks it, and L0's `degraded` naming its `reason`.

**Checked — the gates.** Every implementer ran the suite and the typecheck gate
on its own commit. In the parallel waves a failure or an extra gate line in
another task's uncommitted files was named and left to it (Task 7's two
`voiceClaim.test.ts` lines during Wave 2; Task 9's files during Wave 5), and
5-s timeouts under the wave's load were re-run alone and passed. The
controller's gates after Wave 2 (at `aa3d7b18`): 486 files passed and 1
skipped, 6,202 tests passed and 2 skipped, 0 failed, no unhandled errors; the
gate at its 18 baseline lines. The suite grew from 6,094 tests at `a63c366b`
to 6,299 at `0a7b903e`, 0 failed, the gate at its baseline throughout.

**Checked — group check A** (after Wave 3, at `0e4280f0`; the suite re-run at
`06d58302` after Task 3's round):
1. the suite at `06d58302`: 488 files + 1 skipped, 6,241 tests + 2 skipped, 0
   failed, no unhandled errors; the gate at its 18 lines;
2. `src/services` and `src/components/Settings`: 112 files, 1,801 tests passed;
3. `npm run build` and the extension build; `npx vitest run extension` (7
   files, 45 tests); the three D24 greps empty;
4. the full tree's typecheck: 259 lines, the bound;
5. **the leased fake in the preview** (a fresh vite, headless): "Prepare
   answers with a fallback" → the button read ▶ Start, Connecting...,
   Preparing your voice…, ■ Stop (caught by a `MutationObserver`: the fake's
   `prepare` resolves at once), then the warning "The chosen voice was
   unavailable, so another voice is used."; "Acquire refuses" → the last
   conversation stayed on screen ("Hello, how are you?") under "Insufficient
   balance to start a session. Please top up your balance and try again.",
   Start back on; "Minimum balance" 1000 with no account wired (the preview has
   no wallet) → Start stayed on, since the floor needs a known account. The
   spine probes (gate, surface, subtitle, export, audio, local) and
   `app-panel-probe` (preview, `--settings`) exit 0.

**Checked — group check B** (after Wave 5, at `0a7b903e`):
1. the suite (495 files, 6,299 tests, 0 failed) and the gate at its baseline;
   both release builds; `npx vitest run extension` (7 / 45); the three D24
   greps empty; `session.lease_acquired`, a frame only the new lease emits, in
   `build/static/index-*.js` and `extension/dist/fullpage.js` (the extension's
   main page, where own-key Soniox's code now sits too) — the lease ships in
   both bundles, neither fake does;
2. the full tree's typecheck: 259 lines, the bound;
3. every probe on a fresh vite: the spine probes (gate, surface, subtitle,
   export, audio, local), `app-panel-probe` (preview, `--settings`, `--app`,
   `--settings --app`), `extension-overlay-probe` (plain and `--ptt`) — all
   exit 0;
4. **Kizuna Soniox's Provider tab, rendered**, fetch / XHR / WebSocket logged
   from before load, Start never pressed. Signed out (advanced and simple): the
   picker's "KizunaAI · Powered by Soniox" with its icon and "Recommended"; the
   row "Sign in or sign up to use Kizuna AI — no API key needed."
   (`.api-key-warning`); Start off with "Sign in to use Kizuna AI's built-in
   translation service."; region, the voice library (built-in Adrian), TTS
   speed, vocabulary, preferred translations, background, the shared-session
   pills with the managed cost note, the turn-detection block. Signed in
   (advanced and simple): "Automatically authenticated via your account"
   (`.api-key-info`), Start on. No request to `/soniox/` in any case;
5. **the leased fake, lease 30 s:** the basic and advanced footers showed 00:28
   at 2.5 s and 00:05, low, at 25.5 s, and nothing once it ended; "Your session
   balance is used up. Top up your balance to keep translating." once. Both
   mode cannot start in the web preview ("Translating other participants isn't
   available here."), so the one notice in Both rests on Task 2's runner tests
   and the paid live test's item 4;
6. **the participant switch** renders in the system-audio section, Electron
   only, so the preview cannot show it: Task 4's switch tests and Task 8's
   `kizunaParticipantSpeech.test.tsx` pin it, and the paid live test's item 12
   sees it;
7. **the wizard** on a fresh profile: the path step offers "Start right away"
   (Recommended), "I have my own API key" and "Free, offline"; the first
   reaches "Your Kizuna AI account" with Sign in, Create account and Skip for
   now — none pressed;
8. the one key's spot-check list (below).

**Controller rulings** during execution, each with what it costs if wrong
(numbered here as "the controller's ruling N"; a bare "ruling N" in this entry
is the plan's):
1. **Task 2's `startBoth` case amended:** the brief's `vi.fn()` `startBoth`
   returned `undefined`, so the first run crashed; the implementer gave it a
   working `startBoth` and asserts one call, the load-bearing check (the
   conversation after equals the one before) unchanged. Cost: none.
2. **Task 5's review fixed in the task** (the grant-end words over the role
   set, the abort after the 409 wait, `parseGrant`'s checks), and **its
   `keepalive` question answered by keeping `keepalive` on the first attempt
   only and dropping it after a transport failure**: a runtime that refuses a
   keepalive request needing a CORS preflight would otherwise lose every
   `session-end`, which the old client delivered without `keepalive`. Cost: one
   extra plain request after a transport failure. The paid live test's item 9
   checks it.
3. **Task 2's I1 (plan-mandated): the lease's release slot reserved beneath the
   sources**, so a run unwinds session → sources → lease. Why: ruling 9 was the
   owner's on the condition that the architecture's guarantees hold, and "the
   lease released after the legs have closed" includes their sources. Cost:
   none. Its M2 (the analytics shifts) → the stated departures and the live
   test's item 14; M3 (a 402's figures in `error_message`) → Task 5's round,
   the figures into a `session.refused` frame (choice 5 keeps account figures
   in diagnostics); M4 (test gaps) → the round; M5 → the spec's note.
4. **Task 3's review fixed whole in the task** (one Important, four Minors).
   Cost: none.
5. **Task 8's `noticeText.test.ts` departure accepted:** the brief's `t` filled
   from the notice's message and could never show `$0.01`; the implementer's
   `t` shows the `balance` param, as the file's "passes the params through"
   case does. Cost: none.
6. **Task 12's I2 (plan-mandated): a signed-out answer carrying an error is
   "not loaded"** for the auto-switch. Why: a false switch rewrites a user's
   stored provider. Cost: a sign-in whose first answer was an error does not
   switch — one missed switch after an offline launch (a stated departure).
7. **Task 11's I1 and M2 → the final fix wave:** the unit tests pin the rule
   and the registry order is pinned, so the gap is test discrimination only.
   Cost: none.
8. **Task 6's M4 edits `src/providers/soniox/settings.ts`**, outside the plan's
   touch list, in the final fix wave: a one-line doc comment this plan made
   false. Cost: none. Its M2 → "Found here", below.

**The final fix wave** (after this record, `62ee4003..` the wave's last
commit, this entry's update). The final whole-plan review (`d9d9c38c..62ee4003`)
judged the plan ready to merge with fixes: no Critical, two Important, five
Minor. One wave took those and the task reviews' queued Minors, in one round
plus a fix round. Every item is done; none is left pending. By commit:
1. `b1d03be5` — **a start the service refuses on the wallet refetches it**
   (the review's Important 1). A start that ends `start-failed` with
   `insufficient_balance` (402) or `wallet_frozen` (403) calls the balance
   refetch from `attach()`, as the old app's failed-start teardown did; other
   refusals refetch nothing. Before, Start and the account button's dot stayed
   on the stale balance until the 5-minute poll.
2. `04ae4944` — **an offline launch says "Checking...", not the sign-in
   words** (the controller's ruling on Task 13's finding). Both auth bridges
   (`useAuthContext.ts`, `useAppSession.ts`) read a signed-out answer that
   carries an error as not loaded, as the auto-switch already did: Better Auth
   reports a failed session fetch that way. Live item 2 and "Found here" say
   so; the open question is closed.
3. `8f44dc32` — **the session-key request in the Logs** (Important 2, item
   12's part) and **the lease port's guard** (Task 6's queued Minors). Each
   session-key attempt frames `session.key_requested` with the request's body
   (`mode`, `textOnly`, `bothSplit`, `region`, and the participant field only
   while the flag sends it), never the token, just before the POST. The port's
   `session-started` guard is now `ended || released || accepted.has(role)`,
   with the case (`cutoff()`, then `streamAccepted()` posts nothing). The
   comment on shared Both's participant key reads in order, and
   `SonioxLeasePort.cutoff`'s doc names both grant-end words.
4. `e7e01fda` — **`managed()` keeps its base's participant-speech flag**
   (Minor 2): the twin's own when given, else the base's. The spec's "Managed
   twins are composition" says so since commit 10 (amendment 2 above counted
   the flag among the twin's own).
5. `5f843d97` — **the participant-speech switch finds the provider as the run
   does** (Minor 1): `selectedFromStores()` — the selected one if present,
   else the first present — where it read `getProvider(selected)`.
   `kizunaParticipantSpeech.test.tsx` stands its flag-on twin in through
   `presentProviders` since.
6. `c2ba3d76` — **`abandon()` pinned** (Minor 3 and Task 2's queued item): a
   running lease run's release starts before `abandon()` returns, and a lease
   acquired after `abandon()` is released exactly once. Both are pins over
   correct code, each shown to fail against a break made in a scratch copy.
7. `1667f530` — **the smaller pins and comments** (the queued Minors of Tasks
   8–11):
   - `registry.test.ts` pins Kizuna Soniox first and unflagged on every
     platform, gated by the umbrella alone;
   - `loadStores.test.ts` gains a stored `'kizunaai'` offered where the
     managed provider is not first, which tells the managed branch from the
     first-offered fallback, and a stored own-key id winning over a managed
     default;
   - `SessionCountdown`'s case now tells the `totalMs > 0` guard apart with a
     negative total. A zero grant never needed it: `0 / 0` is `NaN`, never low;
   - no task numbers in `kizuna.test.ts:2` and `SpinePreview.test.tsx:326`,
     and one comment above `loadStores.test.ts`'s two assertions.
8. `459846fe` — **the paid live test as the wave leaves it** (Important 2,
   Minor 5):
   - item 2 as in commit 2;
   - item 6: a Stop after the key is minted may meet the 409 for up to 75 s,
     the backend's limit, with an open question on freeing a never-started
     lease on `session-end`;
   - item 12 reads the new frame;
   - item 14: the gate refuses a low balance first; the reliable coded
     refusal is a second device's `session_conflict`;
   - items 16 and 17: the upgrade path.
9. `418498f2` — **the subtitle surface draws "Checking..." as progress**
   (Minor 4). The idle body's `unready` state now carries its code
   (`subtitleIdleState.ts`, passed by `SubtitleView.tsx`, which dropped it).
   `SubtitleIdle` draws `quota_pending` and `sign_in_pending` as the starting
   state draws progress: a disabled action, the spinner, the words whole.
   Before, they showed as a fix with a warning icon and the "..." stripped.
10. `761d9390` — the spec's managed-twin sentence (commit 4).
11. This entry.

The wave's gates: the suite, 494 files passed and 1 skipped, 6,314 tests
passed and 2 skipped, 0 failed, no unhandled errors; the typecheck gate at its
18 baseline lines throughout; `npm run build` and `npm run extension:build`
pass at its last code commit.

**Stated departures from today** (the plan's list, and three execution added;
old-code line numbers at `a63c366b`):
- Kizuna Soniox runs on the new session; its old client, descriptor, helpers, settings UI and store slices stay compiled and unreachable until Plan B2.
- **The registry offers Kizuna Soniox first** (ruling 6): a fresh install outside the wizard lands on it, signed out, Start off with the sign-in words. It is unflagged, present wherever the Kizuna umbrella is on.
- **Sources before the lease** (ruling 9): a source that fails mints no key, so it no longer leaves a never-started lease that 409-locks the next Start for 75 s (195 s with `par_stt`). A refused lease, or a source failing before it, leaves the last conversation on screen; **own-key Soniox in Both mode** now hands its legs over after both sources opened too, so a failing participant source no longer clears the last conversation (choice 3).
- **A lease's end is recorded once, on the first leg** (ruling 7), where every leg recorded it.
- **The grant's end is worded at acquire** (ruling 3): "segment ended" at the per-session cap, "balance used up" otherwise; the old client said "balance used up" at the cap too.
- **Analytics** (ruling 8) mirror the old events with two differences: a start failure's `api_error` now carries the failure's code when it has one (the old one never did), and LocalInference's degradations — a sentence that could not be spoken, a failed translation — now reach `api_error`, one per 5 s per code, where the old client sent none for them.
- **A Soniox TTS degradation's `api_error.error_message`** reads the event's own message (`Soniox TTS 408: Request timeout`), where the old client sent the server's raw words (`Request timeout`); `error_code` is unchanged (execution: Task 2's review, M2a).
- **A lease's `network` refusal** reports `error_type: 'network'`, where the old path was always `'server'` (execution: Task 2's review, M2b; the runner's `failed` case already did since Plan A).
- **The managed participant is never voiced** (ruling 2), as before — its speech is built but shipped off — and now the switch says so: off and disabled with a "not available yet" tooltip. With the flag off the session-key body is byte for byte today's.
- **An unknown balance** refuses as before (ruling 5), with two changes: a signed-in launch shows "Checking..." while the first fetch is in flight, not the failure words, and an unknown wallet is fetched again when the network returns and after 15, 30 and 60 s, where the old app waited for the 5-minute poll.
- **The gate's balance words** are the old gate's ("Insufficient balance: $x"); a frozen wallet's are "Wallet is frozen. Please contact support.", now also refused at the gate, before a request.
- **A 401 from the session service** is worded "Sign in to use Kizuna AI's built-in translation service." (the old client showed an English string); a transport failure "The connection to the provider failed: …".
- **A contract break in the session key's answer fails the start** (ruling 10): no flat-field or region fallback.
- **`session-end`** is sent with `keepalive`, from a closing page too, retried within 4 s and cancelled by the next lease; the old client sent it once, never from a closing page. After a transport failure the rest of that release goes without `keepalive` (the controller's ruling 2).
- **"Preparing your voice…"** shows briefly on every Kizuna start (choice 16), where the old app showed it only while a clone was claimed.
- **The loading sign-in** shows "Checking..." with a spinner, not the sign-in words (choice 10) — **and so does a sign-in whose fetch failed**, as at an offline launch (the fix wave): Better Auth reports it as loaded and signed out with an error, which the bridges now read as not loaded, so a signed-in user is never told to sign in while offline; a signed-out user offline sees "Checking..." until the network returns.
- **The account button's dot** is the start gate's own answer for the selected provider and legs (choice 9), where it used the lowest floor. A frozen wallet lights no dot, where the old one lit for a frozen wallet whose balance was below the floor (`AccountButton.tsx:133-138`): the gate refuses it with its own words instead.
- **"Recommended"** returns to the picker's first managed provider; **the wizard's managed path** returns.
- **A stored `'kizunaai'` or relay-twin id** selects Kizuna Soniox on load (choice 13), without writing it back.
- **The sign-in auto-switch** returns for Basic mode, and no longer fires at a launch with a stored session (choice 14) — **nor after a launch whose session fetch failed**: Better Auth reports that as loaded and signed out, with an error, so a sign-in whose first answer was an error does not switch (execution: Task 12's fix round, the conservative side).
- **`translation_session_start`** reports `provider: 'kizunaai_soniox'` with Soniox's models.

**The roadmap's inheritance, item by item** (the plan's tables, survey §2.12,
as landed): taken (and where), deferred (and why), or already done.

From the foundation plan's Kizuna Soniox list (`:1262-1283` above):

| Item | Disposition |
|---|---|
| `managed(base, …)` | taken — Task 1 (`managed.ts`), Task 8 |
| `minimumBalance`, `Resources.budget`, `RunState.running.budget`, the leased fake's budget | taken — Task 1 (types), Task 2 (the running state, the leased fake), Task 5 (Kizuna's) |
| The live gate's balance floor | taken — Task 3 (the account store, `balanceRefusal`) |
| `acquire`'s frame sink for `session.*` | taken — Task 1 (type), Task 2 (routing), Tasks 5–6 (frames) |
| The managed account row and "Recommended" | taken — Task 9 |
| `SessionCountdown` mounted | taken — Task 10 |
| `AccountButton` through `minimumBalance` | taken — through the gate itself (choice 9), Task 10 |
| F12's managed wizard path | taken — Task 11 |
| `selectionFromStored` for `'kizunaai'` and unported managed ids | taken — Task 11 (choice 13) |
| `NOTICE_TARGETS.sign_in_required` (the foundation's list: "the account popover"); the `sonioxVoice*` aliases | taken — Task 8, with the target `'provider'`, not the popover: a Settings target names a Settings section and the popover is none; the provider section's account row carries the sign-in link, which opens the popover |
| `&signedin=1` reaches the `&settings=` blocks | taken — Task 9 (`AuthStandIn`), with the voice source's stand-in so no preview calls `/soniox/voices` |
| The lease's timers on `ctx.clock`; extend the session-side guard? | timers taken (Tasks 5–6); the guard **deferred**: an owner option (the lease is not reached by `adapter.ts`, and the spec exempts hooks); an open question below |
| `NETWORK_READINESS_DELAY_MS` (800 ms) | moot for Kizuna Soniox (its `check` is static); stays a live-test observation |
| Participant speech against the lease | ruling 2 — built end to end, shipped off behind one flag: Tasks 1, 4, 5, 8; turning it on is the checklist below |
| The sign-in auto-switch | ruling 4 — Task 12 |
| The registry's final order | ruling 6 — Task 8 |
| Nothing account-mutable in a ready answer | done by design: the `check` is static, the balance is the gate's input |
| A check that threw leaves a managed provider not-ready (`:1281`: an offline managed launch keeps Start off with no way back) | moot for the check: a static check never throws. The analogous stuck state is the quota fetch offline (survey §2.12, §4.4), now refused by ruling 5 — and answered by its way back: `UserProfileContext` re-fetches an unknown wallet on `online` and after 15, 30 and 60 s (Task 3). An offline launch reads the sign-in as still loading first ("Found here", settled by the fix wave) |
| A managed provider wanting a re-check on a balance change | moot: the balance is the gate's input, live through the account store (Task 3) |
| `AuthContext` pending state | taken — Task 1 (`loaded`), Task 9 (the bridges, the row), Task 8 (`sign_in_pending`'s alias) |

Parked from the task reviews (`:1320-1350` above):

| Item | Disposition |
|---|---|
| The leased fake: no refused `prepare` / `acquire`; no two-leg run through the runner | `acquire`'s refusal and the two-leg run taken (Task 2); a refused `prepare` deferred: `prepare` has no refusal path (it answers a notice and never throws, as Kizuna's claim does) |
| Its inert "Require an API key" toggle | deferred: not Kizuna's |
| The account's compile-time narrowing | deferred: Plan A left it, and nothing here needs it |
| Readiness during a run | unchanged |

From Plan A's "What it leaves → Kizuna Soniox" (`:1728-1738` above):

| Item | Disposition |
|---|---|
| F11, whole | taken — Tasks 1–3, 8–10 |
| The lease behind `SonioxLeasePort` | taken — Task 6 |
| Per-leg `K` (`mix_*` / `spk_*` / `par_stt`), `credentials('participant')` not throwing in shared Both | taken — Task 5 |
| `K.tts` absent while speaking | taken — with the flag on and no `par_tts` in the answer, the participant's leg runs text-only through Plan A's `tts_degraded` (Task 5's keys, Task 8's spec); with the flag off its context asks for no speech, so nothing is said (Task 4) |
| The voice claim and the managed voice source | taken — Task 7 (and Task 8's view) |
| The `sonioxService*` / `sonioxVoice*` aliases, `insufficient_balance` and the other lease words, `sign_in_required`'s target | taken — Task 8 (the lease words were aliased by the foundation plan) |
| The wizard's managed path; `providerFits` for a managed id | taken — Task 11 (`providerFits` answers once Kizuna Soniox is registered, Task 8) |
| The registry's order and the release flags | ruling 6 — Task 8; "Before any release" below |
| Deleting both providers' old code | Plan B2, after the paid live test (D11 as amended) |
| The keep-list and its re-points | Plan B2's inventory (below), with the re-point the list missed (`SonioxVoiceSection.tsx:47`) |

Plan A's "Found here", "Before any release" and open questions (`:1740-1775`
above):
- Plan A's live test came before this plan's execution (ruling 13) — met: it
  passed on 2026-09-27.
- The release flags and the order: ruling 6 (unflagged, Kizuna Soniox first).
- `setup.paths.own-key.desc`: Plan A's (or the release's), not Kizuna's.
- Analytics for `degraded`: Plan A's open question, answered here (ruling 8).
  `FIN_TRANSLATION_GRACE_MS`: settled by Plan A's live test (item 7 passed).
  The locale check: Plan A's open question, unchanged.
- Plan A's "Found here" items are Soniox's, untouched here.

**The locale spot check**, for a native speaker: the 29 non-`en` values of
`audioPanel.participantSpeechNotYetAvailable`, the switch's tooltip while a
provider's participant speech is shipped off (ruling 2), as Task 4 wrote them
(`49c7ad8d`) and as the catalogs carry them at `0a7b903e`. The English source:
"Not available yet with this provider: Other's translation is shown as text
only."

| Locale | `audioPanel.participantSpeechNotYetAvailable` |
|---|---|
| `ar` | غير متاح بعد مع هذا المزود: تُعرض ترجمة الآخر كنص فقط. |
| `bn` | এই প্রদানকারীর সাথে এখনও উপলব্ধ নয়: অন্যের অনুবাদ শুধু লেখা হিসেবে দেখানো হয়। |
| `de` | Bei diesem Anbieter noch nicht verfügbar: Die Übersetzung des Gegenübers wird nur als Text angezeigt. |
| `es` | Aún no disponible con este proveedor: la traducción del otro se muestra solo como texto. |
| `fa` | هنوز با این ارائه‌دهنده در دسترس نیست: ترجمهٔ طرف مقابل فقط به صورت متن نمایش داده می‌شود. |
| `fi` | Ei vielä käytettävissä tällä tarjoajalla: toisen käännös näytetään vain tekstinä. |
| `fil` | Hindi pa available sa provider na ito: ipinapakita lang bilang teksto ang salin ng kausap. |
| `fr` | Pas encore disponible avec ce fournisseur : la traduction de l'autre s'affiche uniquement en texte. |
| `he` | עדיין לא זמין עם ספק זה: תרגום הצד השני מוצג כטקסט בלבד. |
| `hi` | इस प्रदाता के साथ अभी उपलब्ध नहीं: दूसरे का अनुवाद केवल टेक्स्ट के रूप में दिखाया जाता है। |
| `id` | Belum tersedia dengan penyedia ini: terjemahan lawan bicara hanya ditampilkan sebagai teks. |
| `it` | Non ancora disponibile con questo fornitore: la traduzione dell'altro viene mostrata solo come testo. |
| `ja` | このプロバイダーではまだ利用できません。相手の翻訳はテキストのみで表示されます。 |
| `ko` | 이 제공자에서는 아직 사용할 수 없습니다. 상대방 번역은 텍스트로만 표시됩니다. |
| `ms` | Belum tersedia dengan penyedia ini: terjemahan pihak lain dipaparkan sebagai teks sahaja. |
| `nl` | Nog niet beschikbaar bij deze provider: de vertaling van de ander wordt alleen als tekst getoond. |
| `pl` | Jeszcze niedostępne u tego dostawcy: tłumaczenie rozmówcy jest wyświetlane tylko jako tekst. |
| `pt_BR` | Ainda indisponível com este provedor: a tradução do outro é exibida apenas como texto. |
| `pt_PT` | Ainda indisponível com este fornecedor: a tradução do outro é apresentada apenas como texto. |
| `ru` | Пока недоступно у этого поставщика: перевод собеседника показывается только текстом. |
| `sv` | Inte tillgängligt än med den här leverantören: den andras översättning visas endast som text. |
| `ta` | இந்த வழங்குநருடன் இன்னும் கிடைக்கவில்லை: மற்றவரின் மொழிபெயர்ப்பு உரையாக மட்டுமே காட்டப்படும். |
| `te` | ఈ ప్రదాతతో ఇంకా అందుబాటులో లేదు: ఇతరుల అనువాదం టెక్స్ట్‌గా మాత్రమే చూపబడుతుంది. |
| `th` | ยังไม่พร้อมใช้งานกับผู้ให้บริการนี้ คำแปลของอีกฝ่ายจะแสดงเป็นข้อความเท่านั้น |
| `tr` | Bu sağlayıcıda henüz kullanılamıyor: karşı tarafın çevirisi yalnızca metin olarak gösterilir. |
| `uk` | Поки недоступно в цього постачальника: переклад співрозмовника показується лише текстом. |
| `vi` | Chưa khả dụng với nhà cung cấp này: bản dịch của đối phương chỉ hiển thị dưới dạng văn bản. |
| `zh_CN` | 该提供商暂不支持：对方的译文仅以文字显示。 |
| `zh_TW` | 此提供商暫不支援：對方的譯文僅以文字顯示。 |

What to look at, beyond the words:
- "Other" is each locale's word for the other party in the switch's own label
  (`audioPanel.participantSpeech`): `de` Gegenübers, `ja` 相手, `ko` 상대방,
  `zh_CN` 对方, `pl` rozmówcy, `ru` собеседника, `th` อีกฝ่าย.
- `ja`, `ko` and `th` write two sentences where the English has a colon; `fr`
  keeps French typography (" :"), as its sibling
  `participantSpeechBlockedWholeSystem` does.
- `zh_CN` / `zh_TW` use 提供商, as Plan A's two keys do.

**Managed participant speech — turning it on** (ruling 2; survey §4.1's option
c), in order:
1. The backend mints `par_tts` for split Both and participant-only, and a
   second shared TTS stream for shared Both, with start floors and TTS
   concurrency for them — the role expansion (`expandStreamRoles`,
   `BE:config/soniox.ts:372-393`) and `computeSessionBudget`
   (`BE:routes/soniox.ts:46-92`), both at `7b2259c`. The client assumes the
   role is `par_tts` in every mode; confirm it.
2. Confirm the request field's name, and change `PARTICIPANT_SPEECH_FIELD`
   (`src/providers/soniox/leaseRequest.ts:24`, today `'participantSpeech'`) if
   the backend chose another.
3. Flip the flag: `KIZUNA_PARTICIPANT_SPEECH = true`
   (`src/providers/soniox/kizuna.ts:21`).
4. Update the floor-parity constants and cases (`kizunaBudget.test.ts:63`,
   "prices the participant's speech stream once the flag is on…") to the
   backend's own floors for the new role.
5. Decide the participant's voice: Soniox's builder gives both legs the
   region's voice field (`src/providers/soniox/config.ts:152-154`), so the other
   party would speak in the user's clone — and the voice claim claims it only
   for a speaking speaker (`voiceClaim.ts:38`), so a speaking participant on a
   clone the pool evicted would go unclaimed. A built-in voice for the
   participant may be wanted instead.
6. Run the participant-speech live items: the switch enabled under Kizuna
   Soniox; in split Both, shared Both and participant-only, Other's translation
   spoken on the real device through its own TTS socket (`par_tts` in the Logs'
   `session.lease_acquired` roles); the floors in Start and the account
   button's dot counting the extra stream; a missing `par_tts` saying
   `tts_degraded` once.

**Before any release from the branch**
- **The release flags and the registry's order — decided** (ruling 6, the
  owner's decision). This settles the open item of the foundation's entry
  (`:1352-1363` above) and of the Soniox entry (`:1752-1756` above):
  - the order `['kizunaai_soniox', 'localInference', 'soniox']`
    (`src/providers/registry.ts:16`, pinned at `registry.test.ts:204`);
  - D19's model kept: a provider is offered by default, only a definition
    marked `flagged: true` is hidden in release builds, and
    `VITE_ENABLED_PROVIDERS` only un-hides flagged ids — it stays unset. Kizuna
    Soniox ships unflagged, gated only by the Kizuna umbrella
    (`VITE_ENABLE_KIZUNA_AI`) through `isPresent`'s managed rule
    (`src/lib/provider/presence.ts`); the new registry never reads
    `VITE_ENABLE_KIZUNA_SONIOX` (only `src/utils/environment.ts:219` does, for
    the old factory);
  - the target state: managed keeps only Kizuna Soniox — the two relay-managed
    providers (`KizunaAIOpenAITranslateProviderConfig`,
    `KizunaAIVolcengineAST2ProviderConfig`) are deleted, not ported; Local
    Native is `flagged: true` with its tester switch; every other provider is
    ported unflagged;
  - the cleanup at Stage 2's end: the per-provider `VITE_ENABLE_*` lines out of
    `.github/workflows/build.yml` (five env blocks today), the matching repo
    variables deleted by the owner; `VITE_ENABLE_KIZUNA_AI` stays, so a build
    without Kizuna's backend offers no managed provider.
- **The owner's paid live test below**, before Plan B2 deletes the old code and
  before any release that carries Kizuna Soniox.
- **The one key's native-speaker check** (the table above), with Plan A's two.

**The owner's paid live test** (survey §5.2's list, adjusted to the rulings;
what execution added is marked):
1. **Signed out, loading, signing in:** at launch a signed-in account shows the spinner "Checking..." then "Automatically authenticated via your account", never "Sign in…"; signed out, Start is off with "Sign in to use Kizuna AI's built-in translation service." and the row's link opens the account popover; signing in enables Start at once.
2. **Floors:** a balance below the text-only floor ($0.018334); between the text-only and speech floors, where Text only flips Start; the split floor in Both with the shared session off ($0.06 speaking); a frozen wallet ("Wallet is frozen. Please contact support."). The account button's dot matches Start each time. **An unknown balance (ruling 5):** a signed-in launch shows "Checking..." briefly, never the failure words. **An offline launch** (network off, then on; execution, settled by the fix wave): a signed-in account shows "Checking..." (the row's spinner, Start off) for as long as the network is off — never the sign-in words; once the network returns and the session fetch answers, the wallet states follow: "Checking..." while the wallet loads, then Start on (or the floor's words). If the session answers but the wallet fetch fails, "Unable to load quota information", with Start back on after the `online` re-fetch (failing that, the 15/30/60-s back-off). The refetched session does not switch the stored provider (Task 12's fix round).
3. **Each mode** (speaker speaking and text only; participant only; shared Both; split Both): the Logs show `session.lease_acquired` with its roles and one `session.started` per role, no `session.started_refused` (no 400 `role_required`); one STT socket in shared Both, two in split.
4. **The countdown** in both footers, low under 20 %. **The grant's end (ruling 3):** a small balance → "Your session balance is used up. Top up your balance to keep translating."; a speaking session held to the one-hour cap (a balance above about $2.50) → "This segment has ended — tap Start Session to continue."; a Both session shows the notice once (ruling 7) — only here: the web preview cannot start Both (group check B, item 5).
5. **A second device:** 409, one retry after about 3 s (Logs `session.retry`), then "Another session is already running on your account…".
6. **Stop while starting** (during the session-key request, once the Logs show `session.key_requested`): no `session.started` follows. Start again at once: either a clean start, or the 409 — "Another session is already running on your account…" — until the lease's start window ends (up to 75 s); note which. A Stop that lands after the backend minted the key leaves a lease that never started, which `session-end` cannot free (survey §1.2): the backend's limit, not the client's (an open question below). With no lease acquired there is no `session.end` in the Logs either. **A failing source, then Start again at once** (ruling 9): in Both, with a participant source that fails — Screen Recording denied on macOS (`LOOPBACK_DENIED`), or the extension's side panel with no bound tab — the start fails naming the participant, no `session.lease_acquired` in the Logs; press Start again at once and expect no 409.
7. **The voice claim:** "Preparing your voice…" on the button; a warm clone; an evicted clone rebuilt from this device's clip; another device with no clip → the built-in voice and "This device has no voice recording…"; a busy pool. The managed preview: its 402 and 409 words, played on the selected output device.
8. **EU and JP accounts:** the claim and the session in that region (Logs `session.lease_acquired` region).
9. **Close the side panel, or the app, mid-session:** `session-end` reaches the backend (its lease shows `end_signalled`), and the next Start is not locked. This settles the `keepalive` + CORS preflight question per embedding (web, extension, Electron). **After Stop on Electron and on the extension** (execution, the controller's ruling 2): the first leg's Logs show `session.end` and no `session.notify_failed`.
10. **A network drop:** the connection-lost words; a managed 503 is not resumed.
11. **The wizard:** the managed path (Recommended), the sign-in at the account step, Finish, the subtitles-only fit.
12. **Participant speech, shipped off (ruling 2):** under Kizuna Soniox the switch is off and disabled with the "not available yet" tooltip, the participant never voiced, and the session-key body carries no participant field — the Logs' `session.key_requested` frame (the fix wave) shows the request's body: `mode`, `textOnly`, `bothSplit` and `region` only; switching to own-key Soniox shows the stored choice again — only here: the switch renders in Electron's system-audio section, which the preview cannot show (group check B, item 6).
13. **The extension side panel:** the core flows.
14. **Analytics (ruling 8):** `translation_session_start` with `provider: 'kizunaai_soniox'` and its models; and the three `api_error` events, with their props: a start the session service refuses → `error_occurred` and `api_error` with its code, `channel: 'speaker'`. The reliable one to check is a second device's lease: after its one retry (item 5), `api_error { error_code: 'session_conflict' }`. A balance below the floor is refused by the client's own gate first ("Insufficient balance: $x"), which tracks nothing; the 402's `api_error { error_code: 'insufficient_balance' }` is reachable only with a stale wallet — a balance spent on another device since this one's last fetch — and after it the wallet is fetched again at once (the fix wave), so Start and the account button's dot follow the new balance on the next press, not after the 5-minute poll. A budget exhaustion → `api_error { error_code: 'budget_exhausted', error_message: 'Session budget exhausted' }`, and a segment ended at the one-hour cap → none; a TTS degradation (a lost segment) → `api_error { error_code: 'tts_408' }` (or its cause), once per episode.
15. **The sign-in auto-switch (ruling 4):** Basic mode on LocalInference, sign in → Kizuna Soniox selected, `settings_modified` tracked; not in Advanced mode; not under the wizard; not at a launch with a stored session.
16. **The upgrade path — settings kept** (the fix wave): a profile from the released app on Kizuna Soniox keeps its region, voice, vocabulary and preferred translations (stored under `settings.kizunaSoniox.*`, the twin's `settingsKey`), in the Provider tab and in the first session (the Logs' `session.lease_acquired` region).
17. **The upgrade path — a retired managed id** (the fix wave; choice 13): a profile whose stored provider is a relay twin (`kizunaai_openai_translate`) or the pre-twin `'kizunaai'` lands on Kizuna Soniox, and the stored value is not rewritten — `settings.common.provider` keeps the old id until the user picks a provider.

**Open questions for the owner**
- **The rulings:** none open — every one is his, as listed above.
- **`translation_unavailable` in `api_error`:** LocalInference's once-per-session
  capability notice is not a failure, but ruling 8 tracks every degradation;
  one line would leave it out.
- **"Checking..." for the loading sign-in** (choice 10): a generic word
  borrowed from the updater's catalogue key.
- **The backend's three 503 causes in one sentence** (region, wallet,
  capacity), as the old client worded them — parity.
- **Fencing `session-end` by `leaseId` on the backend** (survey §1.2): it is
  scoped by account today, which is why the next acquire cancels a release
  still retrying.
- **The backend minting `par_tts`, and the participant's voice** (the "turning
  it on" checklist above).
- **Whether the lease's module joins the session-side clock guard**
  (`src/providers/sessionSide.consistency.test.ts`; the foundation's item at
  `:1275` above).
- **Freeing a never-started lease on `session-end`** (the backend): a Stop
  that lands after the session key is minted leaves a lease no stream
  started, which `session-end` cannot free today (survey §1.2), so the next
  Start may meet a 409 until the lease's start window ends — up to 75 s (live
  item 6). Freeing such a lease on `session-end`, fenced by `leaseId` (survey
  §1.2's fencing note; "Fencing `session-end`" above), would remove it.

**Plan B2's inventory** — survey §3, read at `a63c366b`, with what this plan
changed in it; the lines cited here are re-read at `0a7b903e`:
- **Delete** (§3.1): `SonioxClient.ts` and its two tests; `ManagedSonioxSession.ts`
  and its two tests (once `ProviderDescriptor.ClientOptions.sonioxManaged`
  goes); `SonioxSessionOutcome.ts` and `SonioxCostMeter.ts` with their tests;
  `SonioxProviderConfig.ts` (and test), `KizunaAISonioxProviderConfig.ts`,
  `managedSonioxSplit.ts` (and test), `sonioxManagedMinBalance.ts` (and test —
  this plan re-pointed `AccountButton`, so only `SonioxProviderConfig.ts:178`'s
  re-export still imports it), `sonioxBothMode.ts` (and test) and
  `sonioxSharedBothSession.test.ts`; the old `managedVoicePrep.ts` and its test,
  ported as `voicePrep.ts`; `acquireSessionResources.kizunaSoniox.test.ts`,
  `prepareToStart.kizunaSoniox.test.ts`, `voicePrepWiring.test.ts` and
  `sessionResourcesWiring.test.ts`; `ProviderSpecificSettings.soniox.test.tsx`,
  `LanguageSection.soniox.test.tsx` and `ProviderSection.soniox.test.tsx`;
  MainPanel's `splitDegraded.ts`, `SplitDegradedChip.tsx` and `.scss` with
  their three tests, and `participantErrorOrdering.test.ts`; and last the
  **eight** re-export stubs under `src/services/clients/` — Plan A's six
  (`SonioxSttStream`, `SonioxTtsStream`, `PcmMixer`, `SonioxSideTracker`,
  `SonioxTtsRest`, `SonioxVoicesClient`) and this plan's two
  (`ManagedVoicesClient`, `managedVoicePolling`).
- **Edit, not delete** (§3.1): `ProviderDescriptor.ts` (drop
  `ClientOptions.sonioxManaged` and its import; the relay twins keep
  compiling), `ProviderConfigFactory.ts` (the two registrations and imports,
  and `KIZUNA_AI_SONIOX` in `getDefaultManagedProvider`), `settingsStore.ts`
  (both slices, their hooks and imports, and `migrateLegacyKizunaProvider`'s
  last fallback), the old settings UI's Soniox branches
  (`ProviderSpecificSettings.tsx`'s `renderSonioxSettings` and voice-source
  memo, `ProviderSection.tsx`'s branch, `LanguageSection.tsx`'s two and the
  `useUpdate*Soniox` hooks), optionally `IClient.ts`. The `Provider` enum
  values stay: ids read as data.
- **Kept**, used by the new provider (§3.2): `SonioxVoiceSection.tsx`,
  `voiceLibrarySource.ts`, `VoiceLibrarySection.tsx`, `VoicePicker.tsx`,
  `VoiceCreateModal.tsx`, `SonioxCloneReviewStep.tsx`, `VoiceDeleteModal.tsx`;
  `src/providers/soniox/{ttsRest,voicesClient,managedVoicesClient,managedVoicePolling}.ts`
  with their tests; `src/lib/soniox/**` (`voiceClipStorage.ts` included);
  `src/utils/effectiveTextOnly.ts`; and `SessionCountdown.tsx`, now mounted.
- **Re-points first** (§3.2, and this plan's stubs), from the stub or old path:

  | File | Lines | To |
  |---|---|---|
  | `voiceLibrarySource.ts` | `:15`, `:17` (`SonioxVoicesClient`, `SonioxVoicesError`) | `src/providers/soniox/voicesClient` |
  | | `:18` (`synthesizeOnce`) | `src/providers/soniox/ttsRest` |
  | | `:16` (`ManagedVoicesClient`, a type) — this plan's stub | `src/providers/soniox/managedVoicesClient` |
  | | `:23` (`managedVoicePollDelayMs`) — this plan's stub | `src/providers/soniox/managedVoicePolling` |
  | `voiceLibrarySource.test.ts` | `:4`, `:6`, `:7` | the same |
  | `SonioxVoiceSection.tsx` | `:40-44` (the import from `SonioxVoicesClient`) | `src/providers/soniox/voicesClient` |
  | | **`:47` (`clampNumber`, from the own-key descriptor — missing from the Soniox plan's list)** | `src/providers/soniox/config` (`:62`) |
  | `SonioxVoiceSection.test.tsx` | `:8`, `:10`, `:117`, and `vi.mock('../../../services/clients/SonioxTtsRest')` at `:100` | the new paths — the mock with them: once `voiceLibrarySource.ts` re-points, the old mock path intercepts nothing |
  | `lib/tts/previewSample.test.ts` | `:3`, `:6` (`new SonioxProviderConfig().getConfig().languages`) | `SONIOX_LANGUAGES` (`src/providers/soniox/settings.ts:131`) |

  Done by this plan: `AccountButton.tsx` and `SessionCountdown.tsx` (Task 10),
  and the moved `managedVoicesClient.ts`, which imports `SonioxVoicesError`
  from `./voicesClient` (Task 7). The stubs' other importers go with the
  deleted code: `ProviderSpecificSettings.tsx:81` (its branch goes),
  `KizunaAISonioxProviderConfig.ts:16`, the old `managedVoicePrep.ts:23-25` and
  its test's `:4`, `prepareToStart.kizunaSoniox.test.ts:41`.
- **Order** (§3.3), the tree compiling and the suite passing after each step:
  (B1, done) the three managed voice modules moved or ported, with stubs, and
  `AccountButton` / `SessionCountdown` re-pointed; B2.1 re-point the kept
  importers — nothing deleted yet; B2.2 unregister (`ProviderConfigFactory`,
  `settingsStore`, the old settings UI's branches, `ClientOptions.sonioxManaged`,
  optionally `IClient`), then fix the shared old tests that expect Soniox
  registered or sliced — the survey's candidates by grep:
  `descriptorRegistry.test.ts`, `providerOrder.test.ts`,
  `participantConfig.test.ts`, `speechMode.test.ts`,
  `kizunaProviderGating.test.ts` (keeping the relay-twin cases),
  `localNativeGating.test.ts`, `ClientFactory.test.ts`, the `settingsStore`
  tests, `kizunaProviders.test.ts`, `setupStore.test.ts`, the `ProviderSection.*`
  tests, `LanguageSection.sentence.test.tsx`,
  `ProviderSpecificSettings.engine.test.tsx`, `PoweredBy.test.tsx`,
  `ProviderIcons.test.tsx`, the Tour tests and the wizard tests seeding
  `kizunaai_soniox` (only a run tells which depend on it); B2.3 delete the old
  clients, descriptors, helpers and their tests in one commit
  (`KizunaAISonioxProviderConfig` extends `SonioxProviderConfig`, and both build
  `SonioxClient`); B2.4 delete the MainPanel split chips and
  `participantErrorOrdering.test.ts`; B2.5 delete the eight stubs, a grep
  proving no importer is left; B2.6 gates, builds, a bundle grep for a string
  only the old client carried, then its docs task.
- **The typecheck** (§3.4): none of the gate's 18 baseline lines sits in a file
  B2 deletes (the two in `ProviderSpecificSettings.tsx` are not Soniox's); the
  gate's old-client alternatives — this plan's widening among them — match
  nothing after B2 and can be trimmed. The full tree is 259 lines at
  `0a7b903e`, as at `a63c366b`; B2's deletions remove about 145 of them
  (`SonioxClient.test.ts` 66, `SonioxClient.managed.test.ts` 40,
  `managedSonioxSplit.test.ts` 21, `ManagedSonioxSession.test.ts` 14, one each
  in `ManagedSonioxSession.outcome.test.ts`,
  `ProviderSpecificSettings.soniox.test.tsx`, `LanguageSection.soniox.test.tsx`
  and `descriptorRegistry.test.ts`), leaving about 114.
  `SonioxVoiceSection.test.tsx` keeps its 7 (stale props and an unused
  `React`), which the re-point could fix.

What it leaves, for the plans that meet it (the plan's own list, as written,
with what execution and this record found added to "Found here"):

**Plan B2 — deleting both Soniox providers' old code**, written after this plan lands and the owner's paid live test passes: survey §3 is its inventory (Task 13 records it, with this plan's two stubs and the old `managedVoicePrep.ts`). Its order (survey §3.3): re-point the kept importers, unregister, delete the clients, descriptors, helpers and their tests in one commit, delete the MainPanel split chips and `participantErrorOrdering.test.ts`, delete the stubs; gates, builds, a bundle grep for a string only the old client carried.

**Found here, for the owner or a later plan:**
- **The voice pin's 75 s** (`BE:config/soniox.ts:685`): the claim runs before the sources (ruling 9), so the one prompt that can wait at Start — a first-time microphone prompt, the speaker's leg in every mode — left unanswered for more than about a minute can let the pin lapse before `session-started` extends it. Eviction happens only under pool pressure; the live test's item 7 watches for it.
- **A start that fails after the lease is minted** (a socket that will not open) still leaves a never-started lease, freed only at its start window's end (75 s, or 195 s with `par_stt`); ruling 9 removes only the source-side cause.
- **A silent session never extends its lease** (parity, `ManagedSonioxSession.ts:463-471`): a muted microphone sends no frames, so no `session-started`, and the lease dies at its start window while the socket streams. Push-to-talk (new for Soniox) makes long silences likelier.
- **The backend's comments disagree with the client** (survey §1.12.1–2): `session-end`'s body is ignored (it cannot be fenced to a lease), and `session-started`'s comment says no client sends the role.
- **Throttled timers:** a background tab may delay the budget's timer; the 403 path then ends the run, with the same words (Tasks 5–6).
- **MainPanel's participant replay slot** follows the routing switch, not the flag: under Kizuna Soniox, while the flag is off, it is offered for a leg that never has speech, and so never shows a replay button.
- **The participant's voice, once the flag is on:** Soniox's builder gives both legs the region's voice field (`config.ts:152-154`), so the other party would speak in the user's claimed clone — the "turning it on" checklist's item 5.
- **A late `session-started` may re-pin the voice** (execution: Task 6's review): one sent before release can land after `session-end` and pin the voice again until the reconciler releases the lease. Accepted. Do not "fix" it with an `end_signalled_at` check in the backend's `markStarted`: a Stop right after the first frame would then leave a never-started lease, and bring back the 409 lock.
- **The wizard's own-key description** (`setup.paths.own-key.desc`) still names "OpenAI, Gemini, Doubao (Volcengine) and others" (from Plan A; true once those providers are ported) — still the Soniox entry's before-release item.
- **An offline launch read signed out, not "quota unknown"** (found while writing this record, from Task 12's review, I2; settled by the fix wave, the controller's ruling): Better Auth answers a session fetch that failed with no session and `isPending: false`, so `useAuth()` reports loaded and signed out, with an error. The bridges passed only `isLoaded`, so a managed `read` answered `sign_in_required`, the account row offered the sign-in link, and no wallet was fetched. The fix wave applies the auto-switch's rule (`useSignInProviderSwitch.ts`) to both bridges (`useAuthContext.ts`, `useAppSession.ts`): a signed-out answer carrying an error is not loaded, so a managed `read` answers `sign_in_pending` ("Checking...") until Better Auth's refetch (on `online` or focus) answers, and the wallet flow follows once signed in. Its cost: a signed-out user who launches offline sees "Checking..." rather than the sign-in words until the network returns (a stated departure, below). The live test's item 2 checks it.

**Stage 2 items from the roadmap this plan does not take:** the kit's parked items (`{ flush: true }` after an awaited answer, `FakeSocket`'s close codes, the virtual clock's `pending()` count, manual-end's segment check); the account's compile-time narrowing; `RunnerDeps.replayAudio`'s guard; the notice-code namespace.
