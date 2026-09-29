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
  **Not taken** by the Stage 2 Palabra plan (rulings 2, 20): F5 was built for
  it, and Palabra's port converts nothing; F5 stays for its other users.

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
  request after `openSource`, for the WebRTC adapters. (2026-09-29: none is left to take it — the owner abandoned OpenAI's two WebRTC clients, and Palabra builds its LiveKit track from appended pcm; it waits for an adapter that would.) **Closed** by the Stage 2 Palabra plan: none will — Palabra's port sends pcm over WebSocket — so `StartRequest.input` and `Source.track` are deleted (ruling 16; `7d0b8cdd`).
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
  stream) that mute and switches reach. (2026-09-29: no adapter reads it — the owner abandoned OpenAI's WebRTC, and Palabra's track is built from appended pcm — so this waits for one that would.) **Closed** by the Stage 2 Palabra plan: the track is deleted with the seam (ruling 16; `7d0b8cdd`).
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
- F15, the processed WebRTC track (roadmap 1c-3 → Stage 2), unless Translate-WebRTC comes first. **Closed 2026-09-29:** the owner abandoned OpenAI's WebRTC; no adapter takes the runner's track (the Stage 2 OpenAI Realtime record, "The owner's WebRTC decision").
- The D25 participant-leg fix (spec open question, survey §3.4.1). **Closed 2026-09-29** with the WebRTC transport: both legs run over WebSocket.
- `busy`'s reader (roadmap 1d-1 → Stage 2).
- The drift anchor; OpenAI's model migration and `turnDetectionMode` → `autoDetection` through `legacyKeys` (Task 9).
- Compatible's `i18nKey: 'openaiCompatible'` (Task 14).

**Palabra:**
- F4, the credential-adjacent control (the platform / app toggle).
- `authMode` through `legacyKeys` + `credentials`, and the pair's `vn` → `vi` through `migratePair` (Task 9).
- `deleteSession` with a timeout.
- The G3 latency a stall leaves behind (group check A's record), checked in its live test.

**Settled by the Stage 2 Palabra plan** (its record below): F4 taken, as
`credentials.choice` on `authMode`; `authMode` through `legacyKeys` and
`vn` → `vi` through `migratePair` not taken (rulings 2, 20: stated
departures); the delete bounded at 5 s, the leg's own session only (choice
9); the G3 latency mostly moot, since a sentence's audio is a
faster-than-real-time burst [inf], and its live test's item 4 listens for gaps.

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
  **Done** by the Stage 2 Palabra plan (ruling 15; choice 4; `2bf854f5`,
  `d1bfb544`).
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
- **`audio.range` after fill-in:** the late-measure hole `speechRanges` closes with `unfilled` exists for an `audio` range arriving after fill-in too; no adapter sends one (LocalInference closes after its last audio). **Done** by the Stage 2 Gemini/AST2 follow-up plan (Task 2, `cfcee4d1`, fix round `0a86fc39`; choice 19): an `audio` range on a segment the fill-in replaced is measured against the adapter's own text and re-anchored onto the filled one, dropped with a diagnostic when it does not fit, through the one `measure` `speechRanges` uses — for every provider; Doubao's matched clips are the only current caller.
- **The other voice-preview sites:** `LocalInferenceVoiceSection` (it renders `VoiceLibrarySection` with no preview route) and `nativeVoiceStores` fold in with their providers' plans; `SonioxCloneReviewStep` stays on the default output (ruling 6).
- **The side decision is latched at an utterance's first token**, as before; a wrong latch now puts the utterance on the other leg's L1 (survey §3.6).
- **Two TTS sockets per key** in shared Both with participant speech: Soniox's concurrency quota is unmeasured (the live test's item 8).
- `Conversation.afterAudio` drops a whole `pending` list past the pcm ceiling without counting it in `clearedEntries`; no provider parks audio before its segment opens and emits `speechRanges` today. When one does, empty the dropped entries' pcm (`EMPTY_PCM`) and keep the entries, as the segments branch does — adding to `clearedEntries` alone would realign range indices but not clip keys. **Done** by the Stage 2 Gemini/AST2 follow-up plan (Task 2, `cfcee4d1`; choice 6): exactly that — a held list's pcm emptied and its entries kept, a list already empty skipped. Doubao now reaches it in form; no live session is likely to.

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

## Scheduled by the Stage 2 Gemini plan

The Stage 2 Gemini plan
(`docs/superpowers/plans/2026-09-28-client-contract-stage2-gemini.md`, plan
commit `a7810bde`, over `3665711d`'s code) landed as the twenty-two commits
after it that are its own, `75a5c343` through `0c2f461b` on
`worktree-client-contract-stage2` (**+5,153 / −135 lines across 67 files**).
The range `a7810bde..0c2f461b` also holds `d81d935d`, the Volcengine AST2 plan,
committed during execution after its own review (one file, +6,636). Then this
record with the spec's amendments. It is Stage 2's third provider — **Google
Gemini with the user's own key** (`gemini`) on the new session, for the
dialogue Live models and for Live Translate: its definition, settings, key
check, builder, wire, turns, adapter with its resumption ladder, and settings
view, and the pieces it built for the ports after it (the instructions a
provider owns, the shared settings fields, F16). Deleting Gemini's old code is
a later plan, G2, after the owner's live test below; until then the old
client, descriptor, Live Translate helpers, settings UI branches and store
slice stay compiled and unreachable. Thirteen implementation tasks ran in seven
waves — Tasks 1–3; Tasks 4–6; Tasks 7 and 8; Tasks 9 and 10; Task 11; Task 12;
Task 13 — with group check A after the sixth and group check B after the
seventh. Tasks 1, 2, 5, 7, 9, 10, 11 and 12 took one review fix round each;
Tasks 3, 4, 6, 8 and 13 were approved as their implementers committed them.
Task 14 is this record. After the whole-plan review (Ready to merge, six
Minor items), the final fix wave took those six and the three items the task
reviews had parked for it ("The final fix wave", below). The survey the plan
was written from is named in its research notes.

**The rulings.** Rulings 1–6 are the owner's (2026-09-28; the plan's header),
each confirmed as the plan states it:
1. Live Translate is in this plan.
2. A fresh profile defaults to the newest native-audio dialogue model — the
   owner's "B", chosen at the plan's review: today a 2.5 native-audio model,
   not `gemini-3.1-flash-live-preview`, which ranks newer but carries no
   `native-audio` in its id and stays selectable (it ignores
   `silenceDurationMs`, and on `main` it drops speech made during its answer).
   Execution reads a family with no minor as `.0` ("Found during execution",
   item 1). **Changed by the Stage 2 Gemini/AST2 follow-up plan** (its ruling
   3; choice 8): the default is now the newest listed Live Translate, and this
   rule only when the check lists none.
3. The old resumption logic is kept, with a fresh session when there is no
   handle.
4. System instructions are each provider's own setting.
5. The participant speaks when its switch is on.
6. The registry order `['kizunaai_soniox', 'localInference', 'gemini',
   'soniox']`, Gemini unflagged.

Rulings 7–15 are the controller's technical rulings in the plan, applied as
written. The controller's rulings during execution are recorded below, under
"Found during execution" and "Accepted as they stand".

What landed, by task:
- **Gemini's words, the Logs' rows and the subtitle bar's code** (`75a5c343`,
  Task 3): two `NOTICE_ALIASES` — `no_realtime_model` →
  `settings.realtimeModelNotAvailable` and `models_required` →
  `mainPanel.modelsRequired`, the old client's sentences — each targeting the
  provider section; `logStore` groups the adapter's renamed `domain.event`
  frames (`server_content.*`, `server.usage_metadata`) under the old client's
  keys, `server_content.model_turn` and `server_content.output_transcription`
  under a key each (the store merges only consecutive events of one type); the
  subtitle bar reads a regional code's base language, so Mandarin shows "ZH",
  not "CM" (choice 9). No new locale key (ruling 13).
- **Instructions a provider owns** (`f979db5c`, fix round `527b7f2a`, Task 1):
  `src/lib/provider/instructions.ts` — `InstructionsSettings`, the Quick
  template as a constant (`INSTRUCTIONS_TEMPLATE`, choice 2),
  `INSTRUCTIONS_DEFAULTS`, `resolveInstructions(s, { participant, source,
  target })`, `INSTRUCTION_LEGACY_KEYS` and `migrateInstructions(stored,
  legacy)`: field by field, the provider's own value once written, else the old
  global value, else the default, writing nothing back; `providerStore.load`
  reads a legacy key that starts with `settings.` at that key (choice 1). The
  fix round: the store test's guard that the global is only read now fails on
  any write at load — a `null` blanking or a copy under the provider's prefix
  included — and checks the stored value is untouched; a global prompt that
  parses as JSON (localStorage reads a legacy key with no default) reads back
  as its JSON text instead of falling to the default, `null` staying a blanked
  key.
- **F16, the pairing inference windowed** (`6ac92cce`, fix round `70e53f18`,
  Task 2): `inferPairs` looks only inside each translation's proximity window,
  by binary search over the opening order (and at the timed sources, for a
  timed translation), which gives the full scan's pairs wherever `openedAt`
  follows the opening order; `createPairCache` re-pairs a leg only when a
  segment opened or an origin or timing changed, so a partial costs one
  comparison per segment. A reference copy of the old scan pins the
  equivalence; the read-count case makes 13,717 reads where the full scan made
  1,087,704; two cases beyond the brief — an origin-only change and a 12-seed
  grid equivalence (2,812 pairs) — make every pair-dropping mutant fail. The
  fix round: the cache held each leg's last segments array, replay pcm
  included, so a leg no later run projects kept up to 64 MB alive (a GC probe:
  67 MB under `createPairCache`, 0 MB under the old `WeakMap`). It now stores
  only the pairing inputs and compares them on every call, which also re-pairs
  an array changed in place; a `WeakRef` and full-GC case pins that neither the
  array, a segment nor its pcm stays alive.
- **`SharedSettings.instructions` removed** (`f64e33c4`, Task 4, choice 3):
  `buildSharedSettings` and `appShape` stop carrying and reading the four
  global instruction fields; the `SharedSettings` literals of the session,
  fake, LocalInference and Soniox tests (and `soniox/testing.ts`) lose the
  field. No behaviour changed: no provider read it, and no `.instructions(`
  call is left in `src` (the review).
- **Gemini's settings, languages, credentials, default model and key check**
  (`cde89c9e`, fix round `a14369b3`, Task 5): `settings.ts` — `GeminiSettings`
  (the old slice without the key, the pair and the turn mode, plus the three
  instruction fields; `GEMINI_LEGACY_KEYS` is `INSTRUCTION_LEGACY_KEYS`),
  `GEMINI_DEFAULTS`, `migrateGeminiSettings` (Electron's `maxTokens` string
  read as its number, ruling 10), the voices, the languages,
  `GeminiCredentials { apiKey }`, the Live Translate helpers copied from the
  old code, and the default-model rule (`compareGeminiModels`,
  `sortGeminiModels`, `defaultGeminiModel`, `effectiveGeminiModel`, ruling 2);
  `check.ts` — the Live models listed with the key in the `x-goog-api-key`
  header (ruling 9), bounded by `CHECK_TIMEOUT_MS` (15 s), `MAX_MODEL_PAGES`
  (10) and the caller's signal (choice 5); the `adapter.ts` seed, written first
  for the session-side guard. The fix round: a family with no minor reads as
  `.0` ("Found during execution", item 1); the check's "not before 15 s" case
  asserts that the abort has not fired at 14,999 ms — as written, a 1 ms timer
  passed it.
- **The shared settings fields** (`ae825930`, Task 6): `InstructionsField`,
  `VoiceField`, `ModelField` and `ModelConfigurationField` under
  `src/components/providers/fields/` — the old settings UI's sections over a
  provider's own `S`; `ModelField` reads the check's models and has no refresh
  button (choice 22). Every key they read is in all 30 catalogs.
- **The builder** (`5242c7cb`, fix round `4e8de9d2`, Task 7): `config.ts` —
  `GeminiConfig`; `buildGemini`: the effective model and its kind, this
  direction's own prompt (the participant's told by `shared.reversed`), a voice
  for a speaking dialogue leg, sampling for the dialogue models, Live
  Translate's target and per-side silence timers with `deferMidSentence` under
  sentence mode (choice 7), the activity mode, and an empty model refused as
  `models_required`; `describeGemini` = `{ translationModel }` (choice 6). The
  fix round: four guards pinned — the VAD knobs rounded (512.6 / 249.5 → 513 /
  250), a non-finite VAD knob falling to its default (500 / 300),
  `deferMidSentence` false under segmentation `off` on Live Translate, and a
  non-finite `maxTokens` ("Found during execution", item 2).
- **Gemini's settings view and turn detection** (`ac364106`, Task 8):
  `GeminiSettings.tsx` composes the four shared fields over Gemini's own
  settings in the old UI's order, the model select showing
  `effectiveGeminiModel`'s answer, Live Translate hiding the voice and the
  model configuration (choice 22); `GeminiTurnDetection.tsx` — the Speech
  section's summary "VAD Settings · Silence Duration: 500ms", the VAD tooltip
  as its help, and the old four knobs under a "VAD Settings" heading, new here,
  borrowed from LocalInference's `VadControl` (choice 23).
- **The wire** (`a7babbc4`, fix round `479583ff`, Task 9): `socket.ts`
  (Gemini's own seam, choice 20); `wire.ts` — the documented single-slash URL
  (choice 11), `setupFrame(c, handle)`, the realtime-input frames,
  `decodeServerMessage`, base64 over a view's own bytes, the odd audio byte
  dropped, `pcmRate`, and `closeFailureCode(code, reason)` for a close before
  setup (choice 12); `testing.ts`, the fixtures, with their own `trackedClock`
  (choice 21); `wire.oracle.test.ts`, the setup frame and the URL pinned
  against `@google/genai/web`'s own converter over a stubbed `WebSocket` that
  connects nowhere (choice 10). The fix round: the oracle also sends the SDK's
  own audio, `activityStart`, `activityEnd` and text through the open session
  and compares each with ours, byte for byte; three untested branches covered
  (`decodeServerMessage('null')` throws, a "Rate limit exceeded" reason →
  `rate_limit`, a round trip past one 32 KiB chunk); `INPUT_MIME` and
  `pcmRate`'s default ("Found during execution", item 3).
- **The turns** (`09059a6c`, `88dfdadf`, fix round `2f7a38f1`, Task 10):
  `turns.ts`, `GeminiTurns`, pure and on the request's clock — a dialogue
  turn's source and translation share its stated origin and close at
  `turnComplete` or `interrupted`; Live Translate's two sides close on their own
  silence timers, deferring a mid-sentence pause under sentence mode, and its
  audio outside an open translation plays with no ref (choice 8); a reconnect
  closes a dialogue turn in flight (choice 14); `cancelTurn` drops the cancelled
  press's own answer — at once when nothing streams, after the previous answer
  ends when one still does, never on Live Translate (choice 16). `88dfdadf`
  counts the test's timers with the fixtures' `trackedClock`. The fix round:
  the owed-answer flag and a new public `endTurn()` ("Found during execution",
  item 4); seven cases pin the cancel's clauses, each killed by its own mutant,
  and three more pin Live Translate ignoring text parts, each segment starting
  its own deferral, and the ported quiet-gap case's second text.
- **The adapter, one connection** (`6d0e1d43`, fix round `6078fcf1`, Task 11):
  `createGeminiAdapter` — a start resolves at the setup's answer and rejects in
  words within `SETUP_TIMEOUT_MS` (15 s) when the server refuses, drops or
  stays silent (choice 12); audio, activity marks and typed text go out as
  realtime input (choice 17); a message's content folds before its closure
  (choice 15); a foreign output rate is skipped with one `tts_degraded`
  (choice 18); `thought` parts never become text; the frames are the plan's
  list, never audio, the key or a handle (choice 13). Three of the controller's
  rulings reached it beyond the brief — only `audio/pcm` parts are audio, a
  part that fails to decode is said and skipped, and a voiced release marks its
  answer owed ("Found during execution", item 5) — and the session-side guard's
  kit rule now covers every provider's `testing.ts` (item 6). The fix round:
  audio parts' own unreadable episode (`partsReadable`, item 5), and three
  cases — the next press ends a drop the server never answered (killed by a
  no-`beginTurn` mutant), content before `setupComplete` settles nothing and
  reaches no segment, and a release with no held press sends nothing.
- **The resumption ladder** (`e3757124`, fix round `cac3d7bf`, Task 12):
  `RECONNECT_DELAYS_MS` — every unexpected close after setup and every `goAway`
  runs the old ladder (at once, after 2 s, after 3 s), each attempt bounded by
  the setup timeout, with the last resumable handle, used once, or as a fresh
  session when the server issued none (ruling 3); a dialogue turn in flight
  closes as it stands, Live Translate's segments ride their timers, a held
  press starts again, and three failures end the leg with `connection_lost`
  (choice 14). The exhaustion case leaves a Live Translate segment open across
  the whole ladder, so it proves the leg's end stops that segment's timer too.
  Beyond the brief: both unreadable flags reset per socket (item 7), and the
  stop case's missed backoff timer (item 8). The fix round: an answer is owed
  only when `activityEnd` goes out (item 5), and the two handle rules are
  pinned — a non-resumable handle is never recorded, even when it comes last;
  a resume keeps a handle its new session issued before the resume settled.
- **The definition, registered third** (`0c2f461b`, Task 13): `provider.ts`
  composes the settings, check, builder, view and adapter under the old id and
  slice — speech optional, typed text, `boundaries: 'silence'`, both turn
  modes, and no `participantSpeech` flag, so the participant speaks when its
  switch is on (ruling 5); `RELEASED = [kizunaSonioxProvider,
  localInferenceProvider, geminiProvider, sonioxProvider]` (ruling 6), pinned
  at `registry.test.ts:215`; the wizard's own-key path lists Gemini
  (`providerPaths.test.ts`). An old profile's global prompt and Electron's
  string `maxTokens` load into Gemini's own settings without being written
  back.
- **The final fix wave** (`97afa6ba`, and the docs commit that records it
  here; the controller's rulings "final M1" through "final recommendations"
  on the whole-plan review):
  - **M1**: a transcription is framed whenever a message carries one,
    `finished` or `languageCode` alone included; the turns hear only text.
    Why: live item 8 reads from the Logs whether they arrive, and the
    text-only guard would have had it record "never". One case: each alone
    gives its frame and no segment event. An adapter mutant that feeds the
    turns empty text is equivalent (`GeminiTurns.input` / `output` return on
    empty text).
  - **M2**: at the ladder's exhaustion, the leg fails as the last attempt's
    refusal when it was `auth` or `rate_limit`, in the words a refused start
    gives (`[Gemini <code>] <reason>`, choice 12); otherwise as
    `connection_lost`, as before (ruling 3). Why: a key revoked or a quota
    spent mid-session read as a lost connection, its cause only in the opt-in
    Logs. Five cases: refused on the key, or on the quota, at every attempt →
    `auth` / `rate_limit`; dropped at every attempt → `connection_lost`; and
    the last attempt decides, both ways.
  - **M3, M4**: the spec's `appendText` rule names Gemini's departure (text
    typed while its connection is down is dropped, choice 17), and its
    `cancelTurn` cell for Gemini adds the owed case.
  - **M5**: live item 18 is softened: rows group per event type, so
    interleaved transcript and audio messages alternate (parity with the old
    names). No `logStore` change.
  - **M6**, the three parked items:
    - `pair.test.ts`'s retention case collects in Node's `gcUntil` shape — a
      macrotask, a full collection, a look, up to five rounds — and still
      fails against the old retaining cache; 10 of 10 clean runs on the real
      one;
    - Soniox's `check.test.ts` asserts that the abort has not fired at
      14,999 ms: a 1 ms timer, which the case used to pass, now fails it;
    - `soniox/testing.ts`'s header quotes the guard's current case title.
  - **The review's five recommendations** join the open questions below.

  The suite at `97afa6ba`: 510 files passed and 1 skipped, 6,538 tests passed
  and 2 skipped, 0 failed; the gate at its baseline.

**The spec's amendments** (this record's commit), the plan's sixteen, each at
its anchor:
1. "The shape": the Gemini plan's note — `SharedSettings.instructions`
   removed; `legacyKeys` may name a whole storage key.
2. The `shared` paragraph: what a builder reads (the pauses and display cut,
   the participant's direction, the models), and why instructions are not
   shared.
3. "The participant rule (D20)": the reversed direction's prompt is the
   provider's own `participantSystemInstructions`, resolved by
   `resolveInstructions`.
4. "Readiness is one check": the effective model while no check has listed
   any, and Gemini's newest. Its "(`major.minor`)" is the plan's wording; a
   family with no minor reads as `.0` ("Found during execution", item 1).
5. "Persisted settings that move": the system-instructions row. The section's
   "four things change meaning" now reads "five", to count the new row.
6. "Turns", the design table: Gemini's `cancelTurn`.
7. "Turns", the participant paragraph: Gemini's participant used the user's
   own detection knobs.
8. "The session request": Gemini's bounded attempts and its fresh session.
9. "Provider capability": Gemini's pairing column, and Gemini as the first
   provider whose origins L2 infers.
10. "L2 — the projection": pairing re-evaluated only when a pairing input
    changed, inside each translation's proximity window (F16).
11. "Languages are two functions": the regional badges and the subtitle bar's
    base language — set in parentheses, since the anchor sits inside the
    sentence's own pair of dashes.
12. "Segmentation is one fact": `'silence'` for Gemini as parity.
13. "Sockets that need upgrade headers": Gemini's key rides in the query.
14. "What adding a provider then touches": no manifest change for Gemini.
15. "What every adapter must honour": a provider's plan adds its `logStore`
    rows.
16. "Migration": Gemini's item, ported.

**Checked — the gates.** Every implementer ran the suite and the typecheck gate
on its own commit. In the parallel waves a failure or an extra gate line in
another task's uncommitted files was named and left to it: Task 3 saw three
failing cases in `pair.test.ts` (Task 2's work in progress); Task 5 saw three
failing cases and one TS2307 line in `InstructionsField.test.tsx` (Task 6's);
Task 9 saw one failing case in `config.test.ts` (Task 7's fix round), and its
own fix round two gate lines in `turns.test.ts` (Task 10's fix round); Task 2's
fix round saw extra gate lines in Task 4's files. Two timeouts under Wave 3's
load (`nativeModelStore.test.ts`, `kizunaProviderGating.test.ts`, in Task 5's
fix round) passed when re-run alone. The suite grew from 494 files passed and
1 skipped, 6,314 tests passed and 2 skipped at `3665711d`, to 510 files passed
and 1 skipped, 6,532 tests passed and 2 skipped at `0c2f461b`, 0 failed; the
gate at its 20 baseline lines (Plan B1's 18 and `logStore.ts`'s two)
throughout.

**Checked — group check A** (steps 3–6 during Task 12's review — Gemini is
unregistered until Task 13, so none of Task 12's code reached a bundle or a
probe — and steps 1–2 at `cac3d7bf`):
1. the suite: 509 files passed and 1 skipped, 6,526 tests passed and 2
   skipped, 0 failed, no unhandled errors; the gate at its baseline;
2. `src/services` and `src/components/Settings`: 1,802 passed — the old client,
   descriptor and settings UI untouched;
3. `npm run build` and `npm run extension:build`; the three D24 greps empty;
   `npx vitest run extension` (7 files, 45 tests);
4. the full tree's typecheck: 259 lines, the bound;
5. a fresh vite (port 5199, `--force`): `spine-subtitle` (both surfaces the
   same bands, karaoke lit), `spine-surface`, `spine-export`, `spine-audio`,
   `spine-gate` (the web preview's "not available here", as expected),
   `spine-local`, and `app-panel-probe` `--preview` (2 long tasks, 92 ms) and
   `--settings` — all pass;
6. **the projection's cost** on the fake's `long` script: `app-panel-probe
   --long` — at least 20 rows, 1 long task of 113 ms (the bound 500): no stall
   under F16.

**Checked — group check B** (at `0c2f461b`):
1. `npm run build`, `npm run extension:build`, `npx vitest run extension`
   (7 / 45), the three D24 greps empty; `server.session_resumption_update`, a
   frame only the new adapter emits, is in `build/static/index-*.js` and
   `extension/dist/fullpage.js` — the adapter ships in both bundles, neither
   fake does; the suite (510 files, 6,532 tests) and the gate at its baseline,
   from Task 13's report and its reviewer's own run on this commit;
2. the full tree's typecheck: 259 lines, the bound;
3. every probe on a fresh vite: the six spine probes, `app-panel-probe`
   (`--preview`, `--settings`, `--app`, `--app --settings`),
   `extension-overlay-probe` (plain and `--ptt`) — all pass;
4. **Gemini's Provider tab, rendered** in both layouts (advanced and simple),
   with 0 requests and 0 resources to `googleapis` in every render: the picker's
   "Google Gemini" with its icon and the setup-guide link; the key field "Enter
   your API key" with Validate; the instructions' Quick / Advanced switch and
   Preview; the voice Aoede (30 voices); the model select disabled, with no
   option, since no check has run; temperature 0.8 (0–2); Unlimited ticked; the
   VAD block — start Low, end High, 500 ms, 300 ms; the Speech section's
   summary "VAD Settings · Silence Duration: 500ms"; one "VAD Settings"
   heading, not the doubled one Task 8's review asked to look for; the provider
   order `kizunaai_soniox`, `localInference`, `gemini`, `soniox`. Its markup
   was checked class by class against `ProviderSpecificSettings` by the reviews
   of Tasks 6 and 8;
5. **the gate's words:** the panel's ▶ Start disabled, titled "Enter your API
   key in Settings before starting.";
6. **the wizard** on a fresh profile: the own-key list "Google Gemini | Soniox"
   (and the development-only fake); Gemini's key step "API key", "How to get
   this key", Validate, Skip for now — never filled, 0 requests to Google;
7. the Logs' grouping: `logStore.test.ts` (Task 3) is the evidence.

**Found during execution** — what execution changed or found beyond the plan,
each from a controller's ruling in the ledger, with its reason and where it
lives:
1. **A family with only a major version reads its minor as 0** (Task 5's
   review, m1; `a14369b3`). The plan's ruling 2 took "the id's first
   `major.minor`"; `familyOf` now matches
   `/^gemini-(?:live-)?(\d+)(?:\.(\d+))?(?=-|$)/`, so `gemini-3-…` is 3.0. Why:
   Google already spells Gemini 3 ids with no minor (`gemini-3-pro-preview`),
   and a `gemini-3-…-native-audio` id would otherwise sort below 2.0, leaving
   the default silently on 2.5, against the brief's own pin that a newer
   native-audio model outranks 2.5. Lives in `src/providers/gemini/settings.ts`
   (`familyOf`), with a major-only id in `settings.test.ts`'s sort case.
2. **A non-finite `maxTokens` omits `maxOutputTokens`** (Task 7's review, m1;
   `4e8de9d2`): it reads as `'inf'`, unlimited, not as the range's maximum.
   Why: every other knob falls back to its own default, and this one's default
   means no limit. Unreachable today — neither `migrate` nor the view produces
   a non-finite value. Lives in `src/providers/gemini/config.ts`, pinned in
   `config.test.ts` beside the VAD rounding and fallbacks.
3. **`INPUT_MIME` is built from `SAMPLE_RATE`, and `pcmRate`'s default is a
   local `GEMINI_OUTPUT_RATE` (24,000)**; the oracle now also pins the four
   realtime-input frames — audio, `activityStart`, `activityEnd`, text — against
   the SDK's own `sendRealtimeInput` (Task 9's review, m2 and m4; `479583ff`).
   Why: the MIME type repeated the rate instead of reading it, `pcmRate`
   borrowed the contract's constant for the server's documented output rate,
   and the oracle had pinned only the setup frame. Lives in
   `src/providers/gemini/wire.ts` and `wire.oracle.test.ts`.
4. **`GeminiTurns` gained a public `endTurn()`: the owed-answer flag** (Task
   10's review, I1; `2f7a38f1`). A voiced release (`endTurn()`) and typed text
   mark an answer owed; `cancelTurn()` defers its drop while an answer streams
   or is owed; the flag clears when the turn closes (`turnComplete`,
   `interrupted`, a reconnect's dialogue close). Why: a voiceless press released
   in the ordinary gap of up to a second between a voiced release and the
   answer's first output took the nothing-streaming branch, closed the previous
   press's source row and dropped the previous answer whole — the reverse of
   ruling 8. A count would be exact, but it rests on one `turnComplete` per
   activity, which is not knowable offline, and the same two-voiced-presses
   limit already exists in the streaming branch; so two voiced presses then a
   voiceless one inside the latency window drop the second's answer (live item
   6). **The plan's Self-review sentence "`GeminiTurns`' public methods are
   unchanged" is no longer true**: `endTurn()` is new. Lives in
   `src/providers/gemini/turns.ts`. **Changed by the Stage 2 Gemini/AST2
   follow-up plan** (after its final review, on the owner's ruling;
   `f7bdb8bb`): the flag no longer clears at the end of an answer that was
   streaming when a press was released or text typed — that release is owed
   from the answer's end (`owedNext`), so it keeps its source row and its own
   answer, and a tap before that answer streams drops only the tap's own. The
   flag stays a flag: two answers waiting at once to start are one claim,
   cleared by the first to end, so a tap before the second's answer streams
   drops that answer. The two are either two voiced releases (or typed texts)
   — two presses inside the latency window, as above, or two while the same
   answer streams — or, on a model that answers an empty press, a tap's and a
   release's: within one streaming answer, a tap, then a voiced press (or
   typed text) that ends the tap's pending drop and is released, then another
   tap — the tap's queued answer takes the release's claim, so that utterance
   is lost where the flag before `f7bdb8bb` kept it; with no answer to taps it
   is the other way round. On balance the fix keeps far more than it loses,
   and loses none when taps get no answer (that record's "What it leaves";
   whether a count should replace the flag is its open question "The owed flag
   vs a count", decided by live item 6).
5. **The adapter** (Task 11: the controller's rulings before its dispatch, and
   its review's m1; Task 12's review, m1):
   - **only `audio/pcm` parts are audio** (`6d0e1d43`): a model part whose
     `mimeType` starts with `audio/pcm` is speech; any other inline data is
     ignored and not counted in `audioBytes`. Why: the old client filtered the
     same way (`GeminiClient.ts:1273-1275`), while the brief's draft took any
     inline data as audio, and `pcmRate` alone would read any MIME type as
     24 kHz;
   - **a part that fails to decode is said once per run of failures and
     skipped** (`6d0e1d43`, `6078fcf1`): the part's decode is caught, said as
     `server.unreadable` (its frame still carries the part's `mimeType`) and
     skipped, the rest of the message handled; audio parts have their own
     ok → failing flag, `partsReadable`, cleared by a part that decodes. Why:
     the brief's draft decoded outside the `try`, so a malformed part would
     have thrown out of the socket callback; and with the per-parse reset a
     persistent failure would have been one Logs line per audio message (about
     four a second), against the hot-path rule;
   - **`turns.endTurn()` is called only when an `activityEnd` actually goes
     out** (`cac3d7bf`): a press released while the ladder runs sends nothing,
     so no answer is owed. Why: an owed flag the server never saw kept the next
     voiceless press from dropping its own answer. The cancel path was probed
     five ways for the same asymmetry, showed no wrong drop, and is unchanged.

   All three live in `src/providers/gemini/adapter.ts`, each with its case in
   `adapter.test.ts` or `adapter.reconnect.test.ts`.
6. **The session-side guard's kit rule covers every
   `src/providers/*/testing.ts`** (Task 9's review, m1; landed in Task 11,
   `6d0e1d43`; Task 12 ran it green). Whatever imports a provider's fixtures
   must itself be test-only; a fixture-tree case shows it caught, and its
   control shows the kit's folder alone would miss it. Why: `testing.ts`'s
   header said only tests import it, and nothing held it — nor Soniox's — to
   that. Lives in `src/providers/sessionSide.consistency.test.ts` (`inKit`).
   Soniox's `testing.ts` header quoted the case's old title until the final fix
   wave (`97afa6ba`).
7. **Both unreadable flags reset per socket** (Task 12; `e3757124`):
   `readable` and `partsReadable` reset when `connect()` makes each socket —
   Soniox's rule (`soniox/adapter.ts:286`) — not when the ladder adopts it. Why:
   at adoption the setup's answer has already re-armed `readable`, so a reset
   there does nothing; at creation it also covers what a new socket says before
   its setup is answered. Two cases, and a third that the two flags count
   separately. Lives in `src/providers/gemini/adapter.ts`.
8. **The stop case's missed backoff timer** (Task 12; `e3757124`): the brief's
   "stop during a backoff" case read the live timers only after advancing 10 s,
   by which time a backoff timer a stop had left running had fired and gone, so
   a mutant leaving it running survived. One line — no live timer right after
   the stop — now catches it. Lives in
   `src/providers/gemini/adapter.reconnect.test.ts`.

**Accepted as they stand** (the controller's rulings, each with its cost if
wrong):
- **Task 1:** a global prompt stored as exactly a JSON string (`"hi"`) reads
  back without its quotes, and `1.0` as `1` — the storage layer's own JSON
  parse; the stored value never changes. Cost: one implausible prompt shown
  without its quotes.
- **Task 5:** every 400 stays a refused key (choice 5); live item 1 records the
  region case. Cost: a misleading headline in a rare region case.
- **Task 6:** three inline `t()` fallbacks (`settings.modelsFound` and two
  `participantInstructions*`) differ from `translation.json`, copied byte for
  byte from the old file; i18next shows a fallback only when its key is
  missing, and every key is in all 30 catalogs. Cost: none a user sees.
- **Task 9:** the unreadable frame's message keeps `describeCause(error)`,
  parity with Soniox's `stt/tts.unreadable`; V8's `JSON.parse` quotes at most
  10 characters, which cannot rebuild a handle, and the Logs are opt-in and
  local. Cost: a slice of up to 10 characters of a malformed frame in an
  exported log.
- **Task 10:** M7 (the `modelText` guard on Live Translate) is an equivalent
  mutant — `turnComplete()` re-checks `this.dialogue` — and so is
  `endTurn()`'s own dialogue guard. Cost: none observable.
- **Task 11:** `settle`'s `detach(ws)` is unpinned. Cost: one stray
  `session.error` Logs row on a timeout.
- **Task 12:** a superseded socket's late unparseable frame still says
  `server.unreadable`, and a close landing before the ladder's continuation
  runs would be swallowed; both are unreachable under Chromium's and Electron's
  event ordering (the review). Cost: none reachable.

**Stated departures from today** (the plan's self-review list, as landed; what
execution changed or added is marked):
- the participant leg speaks when its switch is on (ruling 5; the old participant was text-only);
- system instructions are Gemini's own, read from the global copy until edited (ruling 4);
- a session with no resumption handle reconnects fresh instead of ending, every attempt is bounded, and exhaustion ends the run in words (ruling 3) — **as landed**, a refusal's own words (`auth` / `rate_limit`) when the last attempt was refused on the key or the quota (the final fix wave, M2); a dialogue turn in flight closes at the drop instead of merging into the next turn (choice 14);
- a press with no speech sends `activityEnd` and drops its own answer — at once when nothing streams, after the previous answer ends when one still streams (that answer is never cut) — and on Live Translate is `activityEnd` alone (ruling 8, choice 16; the old left the activity open). **As landed** (execution, "Found during execution" items 4 and 5): an answer owed — after a voiced release or typed text, before its first output — waits like one streaming; a release during the ladder sent no `activityEnd` and owes nothing;
- typed text sent while a dialogue answer still streams (`NO_INTERRUPTION`) takes that turn's origin: it groups with the previous exchange as a stated pair, and its own answer arrives under the next turn's origin with no source beside it — a wrong stated pair (spec "Risks"), the same effect a voice press has there. Stated, not fixed here (choice 17);
- a start rejects in words within 15 s instead of hanging (choice 12); a transient socket error is a Logs line, not an "Unknown error" bubble;
- the default model is the newest native-audio dialogue model, not the old sort (ruling 2) — **as landed**, a family with no minor read as `.0` ("Found during execution", item 1); the check sends the key as a header and is bounded (ruling 9, choice 5). **Changed by the Stage 2 Gemini/AST2 follow-up plan** (its ruling 3): the default is the newest listed Live Translate, the native-audio rule only on a key that lists none — a fresh profile, and a saved model no longer listed, run Live Translate (that record's stated departures);
- content in a message that also ends the turn is kept (choice 15); `thought` parts never become text; audio at a foreign rate is skipped and said once (choice 18); the odd audio byte and the whole-buffer base64 are fixed (Task 9); `maxTokens` stored as a string on Electron is read as its number (ruling 10);
- Live Translate's audio outside an open translation plays with no row, so no replay holds it (choice 8);
- typed text is trimmed, and dropped while no connection is up (choice 17); the spec's `appendText` rule names the departure (the final fix wave, M3);
- the subtitle bar shows "ZH" for Mandarin, not "CM" (choice 9);
- `boundaries: 'silence'` lets L2 cut a dialogue turn into rows at pauses in pause mode (new, harmless);
- a transcription's language is not forwarded to the segment (choice 19);
- **a same-language pair makes both legs read Other's prompt** (execution: Task 7's review, m2). `SessionContext` does not name its leg, and the builder tells the participant by `shared.reversed(direction)`, which holds for both legs when the source and target are the same language (`src/lib/session/shared.ts:17`); LocalInference does the same. In Advanced mode, with such a pair and a distinct Other prompt, the speaker's leg sends Other's prompt. Stated, not fixed here (an open question below).

Where the plan departs from its survey or its brief, and why, stays in the
plan's self-review.

**Before any release from the branch**
- **The owner's live test below**, before G2 deletes the old code and before
  any release that carries Gemini.
- **The registry's order** is now `['kizunaai_soniox', 'localInference',
  'gemini', 'soniox']` (ruling 6; `src/providers/registry.ts:17`, pinned at
  `registry.test.ts:215`), Gemini unflagged under D19's model.
- **The wizard's own-key description** (`setup.paths.own-key.desc`): its
  "Gemini" is now true; its "OpenAI" and "Doubao" still wait for their ports.
- No locale key to check: this plan adds none (ruling 13).

**The owner's live test** (survey §2.11's list, adjusted to the rulings; what
execution added is marked):
1. **Key and check:** a valid key → Validate ✓ and the models listed; an invalid key → "The provider did not accept the credentials: …" with Google's words, Start off; empty → "Enter your API key…". **The `x-goog-api-key` header (ruling 9)** from the web page, the extension's side panel and Electron — the model list loads in each (the CORS preflight), and the Logs and the network log show no `?key=` on the list request. The socket dials the single-slash URL (choice 11). **Execution (Task 5's review):** every 400 reads as a refused key, so Google's 400 `FAILED_PRECONDITION` "User location is not supported" shows as a refused key, with Google's sentence as the detail — record what a user in an unsupported region sees.
2. **Models and the default (ruling 2):** which models the list shows; a fresh profile starts on the newest **2.5 native-audio** model (not `gemini-3.1-flash-live-preview`, the owner's decision "B"); a saved model the list still has is kept; one it lost falls to the default and is not written back; a `…-native-audio-latest` alias, if listed, ranks below the dated ids. **Changed by the Stage 2 Gemini/AST2 follow-up plan** (its ruling 3; choice 8): a fresh profile now starts on the newest listed Live Translate (`gemini-3.5-live-translate-preview`), the 2.5 native-audio model only on a key that lists no Live Translate — that record's live-test item 5.
3. **A dialogue session, auto, on each model family the list offers** (2.5 native audio, 3.x Live, a `live-2.5` half-cascade if listed): each utterance a source row and its translation grouped (stated pairing); audio heard on the monitor and in the virtual microphone, once each; replay with keep-audio on; no karaoke; the badge "JA-JP" / "CMN-CN" and the subtitle bar's "ZH". **Changed by the Stage 2 Gemini/AST2 follow-up plan** (its rulings 2 and 6): karaoke by arrival, lit across each answer, and the badges now read Google's codes ("JA", "ZH-HANS"), the subtitle bar still "ZH" — that record's live-test items 4 and 9.
4. **The detection knobs:** end sensitivity and silence duration change turn splitting on a 2.5 model; on 3.x they are known to be ignored (`benchmark/GEMINI-SILENCE-DURATION-BUG.md`) — record it.
4b. **Speech during an answer, on 3.1 flash live:** on `main` the owner found that with `gemini-3.1-flash-live-preview`, speaking while the translation and its audio are still playing gets no transcription or translation at all (the old client's `activityHandling: NO_INTERRUPTION`); 2.5 native-audio handles it. Run the same on the new adapter with 3.1 and 2.5: record whether 3.1 still drops it, and whether the Logs show any input transcription for the dropped speech. **Execution (Task 10's review):** where the speech is transcribed, record which row its transcript joins — parity with the old client, but its rows now pair. **Changed by the Stage 2 Gemini/AST2 follow-up plan** (its ruling 5; choice 9): a dialogue model of family 3.0 or later now barges in (`START_OF_ACTIVITY_INTERRUPTS`) — the owner's overlap probe had `gemini-3.8-live` drop the second utterance under `NO_INTERRUPTION` and keep both whole under barge-in; 2.5 keeps `NO_INTERRUPTION`; 3.1 was not measured — that record's live-test items 7, 8, 13 and 15.
5. **Push-to-talk, on a dialogue model and on Live Translate** (`turns()` offers manual turns for every model): a short press → a reply (on Live Translate, the held speech translated); minutes idle between presses → the session survives (resumed or fresh; the Logs say which); push-to-translate routes the raw voice while idle. **Changed by the Stage 2 Gemini/AST2 follow-up plan** (its ruling 4; choices 11, 12): on Live Translate a release now sends real-time silence inside the press's activity until the model has been quiet 1 s, at most 3 s, then `activityEnd` — the owner's probe had a press's last words arrive only after the next press — that record's live-test items 6 and 14.
6. **A press with no speech** (ruling 8, choice 16): no reply shown, and the next press not merged with it. **A voiceless press while the previous answer is still playing:** that answer plays and shows to its end, and nothing answers the voiceless press. Record whether the server answers a cancelled activity at all (a late `turnComplete` in the Logs), and whether a second `activityStart` is tolerated. On Live Translate a voiceless press cuts nothing: the translation streaming at that moment goes on. **Execution (Task 10's fix round):** a voiceless press made right after a voiced release, before its answer's first output, waits for that answer too. The owed answer is a flag, not a count: two presses with voice, then a voiceless one, all inside the latency window, drop the second's answer — record whether that happens in ordinary use. **Changed by the Stage 2 Gemini/AST2 follow-up plan** (the owed flag's fix, `f7bdb8bb`): this item also decides the Gemini/AST2 follow-up's open question "The owed flag vs a count" — record how many `turnComplete`s follow two quick voiced releases (one per activity, or one for both), and whether an empty activity is answered at all.
7. **Typed text:** in auto; under push-to-talk (the wrap in activity marks answers, choice 17); **on Live Translate** — answered or ignored? If ignored, the row stays unanswered: the open question below.
8. **Live Translate:** continuous speech → source and translation segments cut by pause, each side on its own; inferred pairing plausible; the speaker's own voice reproduced; speaking the target language produces nothing; **listen for leading audio chunks before a sentence's first transcript** (live only, not in its replay — choice 8); the Logs show whether `finished`, `languageCode` and `turnComplete` ever arrive (a transcription is framed even with no text: the final fix wave, M1).
9. **Live Translate past 10–15 minutes:** whether a resumable handle is ever issued (`server.session_resumption_update` with `hasHandle: true`), and whether a `goAway` or a drop resumes or opens fresh (`session.opened` with `resumed`) — ruling 3's fresh session keeps it running either way.
10. **A long dialogue session (> 10 min):** `server.go_away` → `session.reconnecting` → a new `session.opened` (`resumed`) and `server.setup_complete`, and the leg's reconnecting state clears (there is no `session.reconnected` frame: the `reconnected` event is the record); rows continue with nothing duplicated; the resumed context remembers the conversation (a handle), or a fresh one does not. **Execution (Task 12's fix round):** under push-to-talk, a press held across the gap starts again with `activityStart` on the new connection, and a release during the ladder sends no `activityEnd`; a resumed session may still hold an activity whose `activityStart` went out before the drop — record what the server does with it, which is not knowable offline.
11. **Start failures and drops:** a model the server rejects and an exhausted quota → words, no hang — record each close code and reason (choice 12's mapping); a network drop mid-session → three attempts in the Logs, then the connection-lost words, the run ended. **The final fix wave (M2):** a key revoked or a quota spent mid-session → three refused attempts, then that refusal's words ("The provider did not accept the credentials: …" / "The provider is limiting requests …"), not the connection-lost words — record whether Google refuses a resume that way. **Execution (Task 12's fix round):** as in item 10, a drop under push-to-talk with a press in flight — record what a resumed session does with the activity opened before the drop.
12. **Both, with participant speech (ruling 5):** two sockets; the participant translated in the reverse direction with its own prompt (Other's instructions in Advanced mode); the participant-speech switch on → Other's translation heard on the real device, off → silent; either leg ending ends both; a denied loopback names the participant; participant-only. Record whether two Live sessions on one key are allowed.
13. **Text only:** no audio played.
14. **Stop mid-turn:** rows finalized; no audio after Stop; the auto-save's content.
15. **The extension side panel:** the core flows (the check's fetch, the socket under the CSP).
16. **The instructions migration (ruling 4):** a profile whose global prompt was edited (Advanced mode, custom text, and a participant prompt) opens Gemini with that prompt and mode; editing it in Gemini's settings changes Gemini only, and the old global copy is left as it was. **An old profile** with Gemini selected, push-to-talk stored and max tokens 2048 on Electron: Gemini loads, the turn mode is push-to-talk, and max tokens is 2048, not unlimited (ruling 10).
17. **The wizard's own-key path** lists Gemini; its credential step checks the key.
18. **The Logs panel:** record how an answer's rows group. Rows group per event type, so when the server interleaves its transcript and audio messages the rows alternate, as with the old names (the final fix wave, M5). Nothing leaks: no key and no handle visible anywhere.
19. **Analytics:** `translation_session_start` with `provider: 'gemini'` and the model as the translation model (choice 6); a refused start → `api_error` with its code.

**Open questions for the owner**
- Live Translate and typed text (item 7): if the server ignores it, either `textInput` becomes a function of `S` (a spec change) or the adapter answers with the source alone and a degradation whose words fit.
- Live Translate's leading audio (item 8): open the translation segment on audio, so its replay holds the leading chunks, instead of ref-less playback (choice 8).
- A resume the server refuses keeps its handle for the remaining attempts (parity); falling back to a fresh session within the ladder would save the run.
- `goAway`: make-before-break (a second socket before the first closes) would remove the gap's dropped audio.
- The `-latest` aliases rank below the dated ids (choice 4); and the check's filter ignores `supportedGenerationMethods` (choice 5).
- The detection knobs on 3.x (item 4): the summary line promises an effect the server does not give.
- 3.1 flash live drops speech made during its answer (item 4b, found by the owner on `main`): whether another `realtimeInputConfig` (e.g. `turnCoverage`) lets it accept that speech without interrupting the translation, or whether 3.1 should carry a warning in the model list. Not guessed at here; the live test records the behaviour first. **Changed by the Stage 2 Gemini/AST2 follow-up plan** (its ruling 5): every dialogue model of family 3.0 or later, 3.1 included, now barges in; whether that keeps the speech is its live test's (items 7 and 13).
- A cancelled turn's late `turnComplete` closes the next press's segments early (choice 16); item 6 says whether it happens.
- `@google/genai` at G2: kept as a dev dependency (the wire's type imports and the oracle test), or its server types copied into `wire.ts` and the oracle retired.
- The orphan locale key `settings.geminiParticipantTokenWarning` (30 catalogs).
- Analytics for `degraded` (Plan A's open question, unchanged): Gemini's foreign-rate `tts_degraded` is its first user.
- **Name the leg in `SessionContext`** (execution: Task 7's review, m2) when a later provider with per-leg prompts (OpenAI, Compatible) needs it: today a same-language pair makes both legs read Other's prompt (the stated departure above), for Gemini and LocalInference alike.
- **Turn boundaries under stated pairing** (live items 3 and 4b; the final review's recommendation 1): Gemini sends transcriptions independently of other content, so a dialogue model's input transcript for turn N that lands after N's `turnComplete` opens turn N+1's source, and every exchange after it can pair one-off — the old client's structure, now shown as wrong stated pairs rather than as separate bubbles. The live test watches the Logs for an `input_transcription` after a `turn_complete` with no new speech between them.
- **Separate source and answer turns under push-to-talk** (recommendation 2): each activity gets one answer, so manual mode could count source turns apart from answer turns — the source side advancing at `beginTurn`, the translation at `turnComplete` — and a second voiced press, or typed text, made while an answer streams would no longer join the previous turn's source. A contained change to `GeminiTurns`, if item 4b shows users hit it.
- **The readiness re-check on each instruction edit** (recommendation 3): every pause of 800 ms or more while typing a prompt forgets readiness — Start is off until the re-check answers — and re-lists the models. A provider declaring which of its settings the check reads is a generic change, best made before the next port that owns instructions (OpenAI); the inheritance table below records it as not taken.
- **Defer a `goAway` reconnect past the answer in flight** (recommendation 4): `goAway` comes with time to spare (`timeLeft`), and breaking at once throws away the dialogue answer being spoken; waiting for its `turnComplete`, bounded by `timeLeft`, is the cheapest step toward the two resumption questions above.
- **Promote `trackedClock` to the kit** (recommendation 5): the copies in `gemini/testing.ts` and `soniox/testing.ts` are byte-identical, and AST2 is the third user choice 21 anticipated — when G2 or AST2 lands ("What it leaves"). **Closed** by the Stage 2 Volcengine AST2 plan (Task 12, `e4ec0d34`; its choice 14).

**G2's inventory** (the deletion plan, after the live test; lines read at
`3665711d`, and none of these files changed through `0c2f461b` but
`logStore.ts`, where Task 3's edit left `:30-44` the old names):
- `src/services/clients/GeminiClient.ts` (+ test), `src/services/providers/GeminiProviderConfig.ts`, `src/services/providers/geminiTranslateModel.ts` (+ test);
- its `ProviderConfigFactory` registration and the old test rows that name it (`descriptorRegistry`, `participantConfig`, `providerOrder`, `speechMode`, `kizunaProviderGating`);
- `src/services/interfaces/IClient.ts:158-194, 341-343` (`GeminiSessionConfig` and its guard);
- the `gemini` slice of `settingsStore.ts` (`:286, 652, 701, 968`) and its model auto-select case (`:1186-1187`) — **not** the four common instruction fields and `getProcessedSystemInstructions` (`:215-266, 1296-1299, 1428-1461`), which every unported provider still reads and every ported one migrates from;
- `ProviderSpecificSettings.tsx`'s Gemini branches (`:7, 15, 35, 127, 151, 389-390, 477-479, 962-964, 1086-1224, 2282`), the `LanguageSection` / `ProviderSection` cases (`LanguageSection.tsx:145-146, 240-241`; `ProviderSection.tsx:71, 465-466`), `tutorialUrls.ts:16`;
- `logStore.ts`'s old Gemini event names (`:30-44`) and their grouping rows, once no old client emits them;
- `@google/genai`: no value import remains once the old client goes but `wire.oracle.test.ts`'s; the wire imports its server types (`import type`) — the open question above decides;
- the stale comments (survey §1.16.15): `GeminiClient.ts:618`, `geminiTranslateModel.ts:58` (its warning that `languageCodeShort()` turns `cmn-CN` into `CM` is now false: the subtitle bar reads the base language since Task 3), `sanitizeEvent.ts:136`;
- the orphan key `settings.geminiParticipantTokenWarning` (owner's call).

**The roadmap's inheritance, item by item** (the plan's tables, as landed):
taken (and where), deferred (and why), or already done.

From "Carried out of plan 1a" — "before the first provider that relies on
inferred pairing" (`:129-134` above):

| Item | Disposition |
|---|---|
| Pairing inference O(S×T) per `project()`; re-evaluate only what changed; window it; state the opening-order assumption; boundary tests at `minOverlap` and `proximityMs` | taken — Task 2 (F16): windowed by binary search, cached on its inputs, the assumption stated in `inferPairs`' doc, the boundaries tested, an equivalence test against today's full scan and a read count that only the window passes; end to end through Task 11's Live Translate case. Gemini (Live Translate), not OpenAI Translate, is its first user. As landed: the cache keeps only the pairing inputs, never the segments (Task 2's fix round) |

From "Carried out of plan 1b" (`:174-177` above):

| Item | Disposition |
|---|---|
| The models in `SettingsProps` and `build` | done by the foundation's F2; Gemini is their first consumer with an effective-model function (Tasks 5, 7, 8) |

From "Scheduled by the Stage 2 foundation plan" (`:1285-1289` above):

| Item | Disposition |
|---|---|
| Gemini: F13's `InstructionsField` (moved out of `ProviderSpecificSettings.tsx`), `VoiceField`, `ModelField` over `props.models` and `shared.models`, and the sliders | taken — Task 6 (the four fields), Task 8 (Gemini's view). `InstructionsField` edits the provider's own `S`, not the global template (ruling 4); `ModelField` reads `props.models` and has no refresh button (choice 22) |
| Volcengine AST2: F14's socket seam | deferred to AST2: Gemini's key rides in the query and needs no header; its `socket.ts` (two lines, as Soniox's) moves to `src/lib/contract/` with F14. **Superseded by the Stage 2 Volcengine AST2 record below:** Doubao's credentials ride in the query too (its ruling 2), so F14 is OpenAI Live's, and the plain `socket.ts` of Soniox, Gemini and Doubao move to `src/lib/contract/` with it |
| Volcengine AST2: F16 | done here (Task 2) |
| OpenAI Translate: F16 if AST2 did not land it | done here |
| OpenAI: `busy`'s reader | unchanged: Gemini emits no `busy` (choice 25) |

From the Soniox plan's "Found here" (`:1740-1747` above):

| Item | Disposition |
|---|---|
| Readiness re-probes on every settings edit (the kept answer is keyed on the whole `S`) | applies to Gemini too: an instruction keystroke re-lists the models 800 ms later (free, bounded). Not taken: a provider-declared narrowing of the check's inputs is a generic change |
| `timing` after a 503 resume | n/a: Gemini emits no timing |
| `audio.range` after fill-in | n/a: Gemini emits no ranges. **Changed by the Stage 2 Gemini/AST2 follow-up plan** (its ruling 2; choice 19): it applies now — arrival ranges, which L1's fill-in re-anchors; each goes out while its translation is open (a closed turn's audio opens the next), so the late path choice 19 closes is Doubao's, not Gemini's |
| The side latch | n/a: one leg per socket |
| Two TTS sockets per key in shared Both | its analogue, two Live sessions per key in Both, is live-test item 12 |
| `Conversation.afterAudio`'s pending drop | n/a: Gemini emits no `speechRanges` |

"Before any release from the branch" (`:1751-1765`, `:2318-2343` above) and
the Kizuna Soniox plan's "Found here" (`:2494` above):
- The registry's order: extended by ruling 6 (Gemini third), pinned in `registry.test.ts`.
- The wizard's own-key description: its "Gemini" became true with Task 13; "OpenAI" and "Doubao" still wait for their ports.
- The native-speaker checks: this plan adds no locale key (ruling 13).

**Stage 2 items from the roadmap this plan does not take:** the kit's parked items (`{ flush: true }` after an awaited answer, `FakeSocket`'s close codes, the virtual clock's `pending()` count, manual-end's segment check); the account's compile-time narrowing; `RunnerDeps.replayAudio`'s guard; the notice-code namespace; the release-flag cleanup at Stage 2's end.

What it leaves, for the plans that meet it (the plan's own list, as written;
the three items the task reviews parked are done, last below):
- **G2**, the deletion of the old Gemini code, after the owner's live test (Task 14's inventory).
- **`@google/genai`** stays in `package.json` until G2 decides its fate (open question).
- **F14**: Gemini's `socket.ts` and Soniox's move to `src/lib/contract/` with AST2's header seam. **Superseded by the Stage 2 Volcengine AST2 record below:** AST2 needs no header; the seam is OpenAI Live's, and Doubao's own `socket.ts` moves with the other two.
- **Inferred pairing in the preview:** no fake script states no origins; one belongs with AST2, the next provider whose origins L2 infers. **Done** by the Stage 2 Volcengine AST2 plan (Task 5, `1ea6855b`): the fake's `proximity` script, seen paired in the preview at its group check A.
- **`trackedClock`** has two copies (Soniox's and Gemini's `testing.ts`); a third user promotes it to the kit. **Done** by the Stage 2 Volcengine AST2 plan (Task 12, `e4ec0d34`): `src/lib/contract/testing/trackedClock.ts`, re-exported by Soniox's fixtures and imported by Gemini's.
- **`session.closed` on Stop** is not emitted (the kit forbids emissions after stop), as for Soniox.
- **The instructions of later ports:** each provider that sends instructions spreads `InstructionsSettings` into its `S`, lists `INSTRUCTION_LEGACY_KEYS` in its `legacyKeys`, calls `migrateInstructions` in its `migrate` and `resolveInstructions` in its builder, and renders `InstructionsField` — LocalInference keeps its own prompt as it is.
- **The owner's open questions** in Task 14's record, each with the live-test item that settles it.
- **The three items the task reviews parked** — the retention test's single `gc()` call (`src/lib/projection/pair.test.ts`), Soniox's `check.test.ts` timeout assertion twin, and the stale case title quoted in `soniox/testing.ts`'s header: done by the final fix wave (`97afa6ba`, "The final fix wave" above).

## Scheduled by the Stage 2 Volcengine AST2 plan

The Stage 2 Volcengine AST2 plan
(`docs/superpowers/plans/2026-09-28-client-contract-stage2-volcengine-ast2.md`,
plan commit `d81d935d`, written over `3665711d`'s code against the Gemini plan
as that plan was written, `a7810bde`) landed as the twenty-five commits
`f9fc83b7` through `9ab968e2` on `worktree-client-contract-stage2`
(`2ad8e910..9ab968e2`: **+10,935 / −6,577 lines across 111 files**, of which
the codec's move accounts for +6,420 / −6,416 across 8 — git counts the
generated module and its declarations as new at the new path and the old
path's two files as rewritten into re-export stubs, the four schemas as renames
— and the rest for +4,515 / −161 across 103). Then this record with
the spec's amendments. The plan commit sits inside the Gemini plan's range (its
record, above); execution started at `2ad8e910`, the Gemini plan landed in full
with its final fix wave. It is Stage 2's fourth provider — **Doubao AST 2.0,
Volcengine's simultaneous interpretation, with the user's own credentials**
(`volcengine_ast2`) on the new session: its definition, settings with two
credential modes, languages per speech mode, a bounded handshake check,
builder, adapter and settings view, and the pieces it built for the ports after
it (the language context, the credential choice F4, `TextField`, the fake's
`proximity` script, `trackedClock` in the kit). Deleting AST2's old code —
with its relay twin `kizunaai_volcengine_ast2`, which the owner ruled is
deleted, not ported — is a later plan, V2, after the owner's live test below;
until then the old client, its two descriptors, the language sync, the old
settings UI's AST2 branches, the two store slices and the extension's DNR block
stay compiled and unreachable. Seventeen implementation tasks ran in the plan's
six waves — Tasks 1–5; Tasks 6–10; Tasks 11–13; Tasks 14 and 15; Task 16;
Task 17 — with group check A after the fourth and group check B after the
sixth; Task 10 waited for Task 3's fix round to free `registry.test.ts`, and
Task 11 started while Wave 2's fix rounds ran. Tasks 3, 6, 7, 8, 9, 12, 14 and
15 took one review fix round each; Tasks 1, 2, 4, 5, 10, 11, 13, 16 and 17 were
approved as their implementers committed them. Task 18 is this record. After
the whole-plan review (Ready to merge with fixes: no Critical or Important
item, six Minor ones), one final fix wave took those six, the review's three
live-test additions and the three items the task reviews had parked for it
(the last entry under "What landed", below). The survey the plan was written
from is named in its research notes.

**The pre-flight.** Before Wave 1 a read-only pre-flight reconciled every text
the plan quotes from a file the Gemini plan touched against `2ad8e910`: 35 of
the plan's 36 diffs applied strictly, and one — Task 12's `soniox/testing.ts`,
whose header the Gemini final fix wave had reworded — only by content;
`startGemini` still called `trackedClock()`, and the kit's copy was
byte-identical to both. It found ten items, each ruled before its task was
dispatched. Four changed a task's work: F1 (Task 12 edits Soniox's fixtures by
content, the landed header kept), F2 (Task 15 says `session.unreadable` on the
ok → failing transition only), F3 (this record takes up the Gemini section's
AST2 items) and F4 (Task 2's Logs case pins one frame type per group). Six were
cosmetic: F5 (Task 15's fixtures header gives the widened kit rule's reason),
F6 (Task 16's Gemini order case at the file's own indent), F7 (the spec's
amendment 5 drops an implied contrast with Gemini: neither emits timing), F8
(the `guideUrl`'s source is `src/services/providers/tutorialUrls.ts:19`), F9
(the offline sentence lives once, in `wire.ts`) and F10 (Task 16's claim about
empty credentials narrowed to the default mode).

**The rulings.** Rulings 1–5 are the owner's (2026-09-28; the plan's header),
each confirmed as the plan states it:
1. Two credential modes, the legacy App ID + Access Token and the new console's
   API key, drawn as a credential choice (F4) in both credential forms, the
   legacy mode by default (choice 2), so an old profile loads ready with
   nothing written.
2. The credentials ride in the socket's query: a plain `openSocket(url)` on
   every platform, no header seam and no DNR change. It rests on the owner's
   first probe, and his second, browser-shape probe (below) confirmed it: no
   custom header is needed, so the ruling stands with `web` in `platforms`.
3. The languages follow Volcengine's documented constraints per mode — speaking,
   its eight and `zhen`; text only, twenty, two dialects as sources only, and
   `zhen`; Chinese or English on one side in both. Task 6's review enumerated
   the landed offer against the documented rules.
4. The participant speaks when its switch is on: the definition sets no
   `participantSpeech` (Task 16's participant case).
5. The registry order `['kizunaai_soniox', 'localInference', 'gemini',
   'volcengine_ast2', 'soniox']`, Doubao unflagged (`src/providers/registry.ts:18`,
   pinned at `registry.test.ts:293`).

Rulings 6–14 are the controller's technical rulings in the plan, applied as
written. The controller's rulings during execution are recorded below, under
"Found during execution", "Accepted as they stand", "Stated departures", the
live test, the open questions and "What it leaves".

**The interruption.** Midway through Waves 2 and 3 — between `673ae222`
(08:18) and `e2fc16bb` (11:01) on 2026-09-28 — the weekly API limit stopped
seven agents at once, and the owner reset the limit. At the cut, Task 6's fix
round had committed (`673ae222`); Task 8's and Task 9's fix rounds and Task 11
stood uncommitted at their gate step; Task 12 stood uncommitted midway (the
kit's `trackedClock`, `socket.ts`, `wire.ts`, `testing.ts` and the Soniox and
Gemini fixtures); Task 7's re-review and Task 13's review had stopped mid-read.
All seven were resumed with their context and finished from where each stood;
Task 12's report found nothing half-edited after the cut.

What landed, by task:
- **The codec moves to its provider (F18), and the folder is seeded**
  (`6e224a51`, Task 1): the generated protobuf codec (`ast2-proto.js`, its
  declarations) and its four schemas moved with `git mv` to
  `src/providers/volcengine_ast2/proto/`; two re-export stubs at
  `src/services/clients/volcengine-ast2/` keep the old client compiling; the
  folder's `adapter.ts` seed (`export {};`) was written first, for the
  session-side guard; `codec.test.ts` pins the stub as the moved module, both
  enum directions and two round trips.
- **The query's credentials redacted, Doubao's frames grouped** (`24d96f71`,
  Task 2): `redact()`'s query rule names `api_app_key` and `api_access_key`
  beside `api_key` (ruling 2); `logStore` groups the adapter's
  `subtitle.source`, `subtitle.translation`, `tts.sentence_start`,
  `tts.sentence_end`, `tts.ended`, `session.usage` and `session.audio_muted`
  under the old client's keys (choice 9). Per F4 its case adds each type twice,
  expects two events per group and seven entries, so a merge of the three
  `tts.*` types under their shared key fails it.
- **The language context and the credential choice in the contract**
  (`d497be72`, fix round `6267a100`, Task 3; rulings 1, 3, choices 1, 2):
  `LanguageContext { speech }`; `CredentialChoice { setting; options }` and
  `credentials.choice?`; `sources` and `targets` take an optional context, and
  `reverseSupported`, `swapped` and `normalizePair` pass it on — without one,
  the widest offer; `SpeechInputs` and `languageContext(p, legs, inputs)` beside
  `contextsFor`, over one private `legSpeaks` rule; the gate's D20 reads the
  participant leg's own context; a registry invariant holds each context's
  offer within the widest. The fix round (test-only): a control provider per
  arm (`growing` and `dry`, then `wider`), so dropping any arm fails; the fifth
  arm ("Found during execution", item 3); a gate case for a speaking speaker
  beside a text-only participant, which a gate reading the run's context would
  refuse.
- **`TextField`** (`f9fc83b7`, Task 4, choice 16): the old library-id rows'
  markup as a shared field in `src/components/providers/fields/` — a label, its
  tooltip, a right-aligned link opened by `openExternalUrl`, one `.text-input`.
- **The fake's `proximity` script** (`1ea6855b`, Task 5, choice 15): an
  eleventh script in Doubao's shape — no origin, no timing, one rangeless clip
  per spoken sentence after its translation closed; the projection pairs both
  exchanges `inferred`, through the Gemini plan's F16. It closes the Gemini
  section's "inferred pairing in the preview" (marked there).
- **Doubao's settings, two credential modes, languages per mode, the builder**
  (`44335635`, fix round `673ae222`, Task 6; rulings 1, 3, 4): `settings.ts` —
  `Ast2Settings` (`authMode` `'app' | 'apiKey'`, `'app'` by default, and three
  library ids), `migrateAst2Settings`, `ast2Credentials` (keys `appId`,
  `accessToken` and `apiKey`, each mode's fields, `read` trimming each value
  and reading a number as its text, a `missing` answer per mode, `choice` on
  `authMode`), `ast2Languages` (speaking: the eight and `zhen`; text only, or no
  context: 23 sources — the twenty, the two dialects as sources only, and
  `zhen`), `ast2Offers`; `config.ts` — `buildAst2` (`s2s` for a speaking leg,
  `s2t` otherwise; a direction the leg's speech does not offer refused in
  words; the libraries on both legs, choice 6) and `describeAst2` = `{}`
  (choice 7); one locale key, `providers.volcengine_ast2.authModeApp`, in all
  30 catalogs, each composed from its own catalog's `setup.credentials.appId`
  and `.accessToken`. One case beyond the brief, at the dispatch: speaking ⊆
  text, and no context answers text only's offer. The fix round (test-only):
  the text-only refusal's verb, the eight spoken names against
  `LANGUAGE_OPTIONS` with `ms`, `sh-CN` and `zhen` by literal, and the mode
  read through the real caller, `readCredentials`, so the other mode's saved
  values never leak. **The plan's prose is corrected here** (Task 6's review,
  M3): where it says `migrateAst2Settings` "reads each field as text", it
  should say that library ids read as stored strings, else the default; only
  `read`'s `text()` reads a number as its text.
- **The resampler and the pacer** (`f74fbbbd`, fix round `dcba0cb9`, Task 7;
  rulings 6, 7, 12, choices 10, 11): `audioIn.ts` — a streaming 24→16 kHz
  `Resampler` that carries its phase across chunks, and `InputPacer`: whole
  80 ms packets, `drain()` at an idle's first tick (what waits, as one short
  packet, and the carry dropped), `tail()` = what waits, then 500 ms of silence
  (six 80 ms packets and a 20 ms one); `IDLE_MS` 250, `KEEPALIVE_MS` 80. The
  fix round (test-only): a ramp case — the packets and the drain equal the
  resampled stream whatever the cut, killing the offset-0, dropped-overflow and
  shared-buffer mutants — and a release that drops the carry, so the next turn
  starts clean.
- **Subtitles as segments, sentences as rangeless clips, the decoder**
  (`b4f45fb1`, fix round `e2fc16bb`, Task 8; rulings 10, 11, choices 3, 18):
  `segments.ts`, `Ast2Segments` — each side's Start, Response and End one
  segment, no origin and no timing, a false start emits nothing, and
  `speechRef()` answers the translation started now, shown or not, else the
  last one shown; `speech.ts`, `Ast2Speech` — one rangeless clip per spoken
  sentence on the ref locked at `sentenceStart`, read before the decode, the
  decodes serialized on one chain; `decode.ts`, `decodeOggOpus` over an
  `OfflineAudioContext` at 24 kHz. The fix round: a blank subtitle counts as
  empty and `stop()` skips pending decodes ("Found during execution", item 4);
  the case that source subtitles never move the ref now shows a source first;
  new cases that a decode failing after `stop()` says nothing and that two
  Ends of the same text give two segments; the docs worded as ruling 10 words
  the lock.
- **The provider store keeps the user's pair and derives the run's**
  (`77671aa6`, fix round `48b82568`, Task 9; ruling 3, choice 1):
  `ProviderEntry.stored` (the pair the user left, while the context narrows it
  away), `speech` and `setSpeech`; a change of legs or speech inputs derives
  every loaded entry's pair again, forgets the readiness of those whose pair
  moved, and writes nothing; a pick, a settings edit and a load keep their
  writes, now from the stored pair; `participantSpeechSwitchFromStores`,
  `speechInputsFromStores` (the name `shape.ts`' doc gives it) and
  `watchSpeechFromStores`, which `attach()` starts beside
  `watchLegsFromStores`. The fix round (test-only), five pins: `stored`
  survives a round trip of the speech inputs, a pick persists from the stored
  pair, `setSpeech` with the same inputs notifies nobody, the watcher reads the
  audio store, and a load derives.
- **The credential choice drawn** (`2e13d179`, Task 10, F4): the new
  `CredentialChoiceControl`, the old Palabra group's segmented control;
  `CredentialForm` draws it above the fields in a `.credential-choice-group`,
  which shares Palabra's rules in `Settings.scss` (asserted on the compiled
  stylesheet); `ProviderPicker` writes a pick through `updateSettings`, clearing
  no credential, so the readiness driver re-checks the fields now shown; a
  registry invariant, with its `bad` control.
- **The language pickers offer the context's languages** (`3d57ede5`,
  Task 11): `LanguagePairSection` takes a context; `ProviderLanguages` passes
  the store's, `languageContext(provider, legs, speech)`; the wizard's
  `StepLanguagePair` lists the scenario's, and normalizes into its lists a pair
  kept from another scenario.
- **The wire, the socket seam and the fixtures; `trackedClock` in the kit**
  (`e4ec0d34`, fix round `94982de4`, Task 12; rulings 2, 8, choices 4, 5, 13,
  14): Doubao's own `socket.ts` (choice 13); `wire.ts` — `ast2Url` (the
  credentials in the query; the one function that reads the token or the key,
  pinned by a TypeScript-AST scan in the test), `startSessionFrame`
  (`requestMeta.AppKey` in the legacy mode only, choice 5), `audioFrame`,
  `finishSessionFrame`, `decodeResponse`, `statusFailureCode` (`4…` →
  `client`, anything else `server`, choice 4), and the two refusal sentences
  ("Found during execution", item 2); `testing.ts`, the fixtures;
  `src/lib/contract/testing/trackedClock.ts`, which Soniox's fixtures re-export
  (F1: edited by content, the landed header kept) and Gemini's import for
  `startGemini`. It closes the Gemini section's `trackedClock` item and its
  recommendation 5 (both marked there). The fix round: the redaction case's
  values ("Found during execution", item 5), the scan case's title naming
  `wire.ts`, and `trackedClock.ts`' header crediting the choice.
- **Doubao's own settings view** (`c6a94881`, Task 13): `Ast2SettingsView` —
  the Custom Vocabulary section's three `TextField` rows with their console
  links, its footer and the info block; no pair, speech, credential or turn UI,
  and every string an existing key.
- **The check, one bounded handshake** (`816440cf`, fix round `c58021c2`,
  Task 14; ruling 9, choices 8, 12, 20): `checkAst2` opens one socket to
  `ast2Url(k)` and sends `StartSession` in `s2t` for the user's pair, with no
  corpus and no audio; `SessionStarted` → `FinishSession` and `{ ok: true }`; a
  failing status → its code; a socket closed before it opened → `auth` with
  `REFUSED_UPGRADE` online, a throw with `OFFLINE` offline; a close after open,
  15 s with no answer (`CHECK_TIMEOUT_MS`) or an abort → it throws; one
  `finish` leaves no timer, listener or socket. Beyond the brief, a no-leak
  case, and the fix round's status and cleanup pins ("Found during execution",
  item 6).
- **The adapter** (`4aa833ca`, fix round `c2f87879`, Task 15; rulings 6–12,
  choices 3, 8–12, 18, 19): `createAst2Adapter`, one leg per socket. A start
  resolves at `SessionStarted` and rejects in words: within `START_TIMEOUT_MS`
  (30 s) on the request's clock — `network` if the socket never opened,
  `server` if it did (choice 12) — and, for a socket that failed before it
  opened, `auth` online and `network` offline (choice 8). Audio goes up through
  the pacer; the keepalive runs on `every(request.clock, 80, …)` and sends
  silence only after `IDLE_MS`, framing `audio.idle` and `audio.resumed`
  (ruling 7); `endTurn` and `cancelTurn` send the tail and frame `turn.tail`
  (ruling 6); subtitles become segments and spoken sentences clips (Task 8); a
  failing status or `SessionFailed` after the start fails the run with its code
  (ruling 8), and `SessionFinished` or `SessionCanceled` closes it;
  `tts.sentence_start` frames the ref it locked (Task 8's review, M4);
  `session.unreadable` per the pre-flight's F2 ("Found during execution", item
  1). The fixtures gain the harness `startAst2` / `liveAst2`, with F5's header,
  and the session-side guard walks Doubao's folder. The seven conformance
  scenarios pass. Beyond the brief: `shutDown` detaches the socket's four
  handlers (item 7 there). The fix
  round: a mid-session status's own code both ways (`55000031` → `server`,
  `45000081` → `client`); `SessionCanceled` mid-session, and a server end before
  the start; the release's restamp; the TTS half of the hot-path rule, the
  leg's frame types pinned exactly; and a start that cannot open its socket
  rejects in fixed words (item 8 there).
- **The definition, registered fourth** (`fa471bb9`, Task 16; rulings 1, 2, 4,
  5): `provider.ts` — `platforms: ['electron', 'extension', 'web']`,
  `speech: 'optional'`, `textInput: false`, `boundaries: 'provider'`, both turn
  modes, no `participantSpeech` and no `flagged`; `RELEASED =
  [kizunaSonioxProvider, localInferenceProvider, geminiProvider,
  volcengineAst2Provider, sonioxProvider]`, pinned at `registry.test.ts:293`,
  in `providerPaths.test.ts` (`['gemini', 'volcengine_ast2', 'soniox',
  'fake']`) and in Gemini's order case, narrowed to "sits after LocalInference"
  (`slice(0, 3)`, at the file's own indent, F6). An old profile's App ID and
  Access Token load in the legacy mode with nothing written.
- **The wizard's credential step offers the credential choice** (`9ab968e2`,
  Task 17; ruling 1, choice 2): `SetupDraft.credentialChoice` and
  `setCredentialChoice` (a pick keeps both modes' typed values and clears the
  validation); `ApplySetupDeps.applyProvider`'s fourth argument, the pick as
  settings; Finish writes it through `updateSettings` before the credentials,
  and only as the provider's own `credentials.choice.setting`;
  `StepCredentials` draws `CredentialChoiceControl` between the prefill and the
  fields, and its fields, `readCredentials` and `check` read the saved settings
  with the pick laid over them. Nothing is written before Finish; a provider
  with no choice renders and behaves as before.
- **The final fix wave** (`7f3dded6`, `45e49a6e`, and the docs commit that
  records it here; the controller's ruling "final, the ONE fix wave" on the
  whole-plan review):
  - **The socket seam's fixed words** (Task 15's review, M3b; `7f3dded6`):
    `nativeSocket` in `volcengine_ast2/socket.ts` and `gemini/socket.ts`
    wraps `new WebSocket(url)`, and a throw is rethrown as `The browser would
    not open the socket (<error name>).`, the browser's message dropped and
    its error name kept on the new error ("Found during execution", item 10).
    Why: a browser's `SyntaxError` for the constructor can quote the URL, and
    both URLs carry a credential. Doubao's check opens its socket inside its
    promise, so the browser's words, URL included, would have become the
    readiness reason the credential form shows (`providerStore.ts`'
    `describeCause(error)`). One place each now covers Doubao's check, its
    start, Gemini's start and Gemini's reconnect ladder, whose
    `session.reconnect_failed` frame carries the failure's message. Cases:
    each seam's own `socket.test.ts` (in both credential modes for Doubao),
    and a case through the real seam, with the global `WebSocket` stubbed, in
    Doubao's check and adapter suites and in Gemini's adapter suite.
  - **The check drops another session's `SessionStarted`** (the whole-plan
    review, M4; `7f3dded6`): after the status check, exactly where the start drops it
    (`adapter.ts`' `session.foreign`), a frame whose `SessionID` is set and not
    the one the check sent is ignored. A `SessionStarted` naming no session
    still counts, as it does for the start. Why: the start already required
    the echo, so a server that answered with an id of its own would have shown
    Validate ✓ and then timed out every start after 30 s. Now neither shows
    ready: the check ends at its 15 s bound. Cases: the foreign one (no ✓, no
    `FinishSession`, the 15 s words); its own and an unnamed one (✓); a
    refusal naming another session, still heard (the status is read before
    the session, as the start reads it); and the check beside a start over the
    same foreign answer, each ending at its own bound.
  - **The wizard's write order, pinned** (Task 17's review, m2; `7f3dded6`):
    `useApplySetup.test.ts` wraps the store's `updateSettings` and
    `setCredential` in `vi.fn` and asserts by `invocationCallOrder` that the
    choice's write precedes the first credential's.
  - **Comments cite rulings, not tasks or findings** (Task 17's review, m1;
    `45e49a6e`, comments only): the wizard's four "(Stage 2 Volcengine AST2,
    I2)" now cite ruling 1, the credential choice that review I2 became; the
    codec's two stubs cite F18 without "Task 1". The clean-up covered every
    production file the plan touched, so `src/app/session.ts`' four Stage 1
    ids ("final review M6" twice, "parked item 8", "M2") went too. Ruling and
    choice citations, D rulings, F items, the L layers, `settings.ts`' "the
    old rule R3" (the survey's numbering of the old UI's rules) and
    `logStore.ts`' "PR #538 review" stay.
  - **The docs** (this record and the spec): Minors 1, 3, 4 and 5 in the live
    test and the open questions below; Minor 2 in the spec's relay-twins
    paragraph; Minor 6 under "What it leaves"; the review's three live-test
    additions in items 1, 9 and 10.

  Each new case failed first against the unchanged code, except those that
  pin what already held: each seam's success path, and, each shown to bite by
  a scratch mutant, the start's words through Doubao's real seam, the unnamed
  and own-session `SessionStarted`, the refusal naming another session and
  the write order. The suite at `45e49a6e`: 527 files passed and 1 skipped,
  6,730 tests passed and 2 skipped, 0 failed, no unhandled errors; the gate at
  its baseline.

**The owner's probes.** Both ran with his real credentials over Node `ws`, each
case a `StartSession` in `s2t` for zh → en and then `FinishSession`; the scripts
read the credentials from the environment and print none.
- **The first auth probe** (2026-09-28, before the plan; what ruling 2 rests
  on). The legacy mode: the headers `X-Api-App-Key` (the old code's name) or
  `X-Api-App-Id` (the documentation's), with `X-Api-Access-Key` and
  `X-Api-Resource-Id: volc.service_type.10053` → `SessionStarted`; the query
  `?api_resource_id=volc.service_type.10053&api_app_key=…&api_access_key=…` →
  `SessionStarted`; a wrong token → HTTP 401 `{"error":"load grant: requested
  grant not found in SaaS storage"}`. The API key: the header `X-Api-Key` or
  the query `?api_resource_id=…&api_key=…` → `SessionStarted`, with no
  `requestMeta.AppKey` (choice 5, settled before dispatch); a wrong key → HTTP
  401 `{"error":"Invalid X-Api-Key"}`. No credentials → HTTP 400
  `{"error":"get resource id empty"}`. Every case also sent `X-Api-Connect-Id`.
- **The browser-shape probe** (2026-09-28, during Wave 4; Task 12's review,
  I1). Since the first probe put `X-Api-Connect-Id` on every case, nothing had
  shown a socket opened the way a browser opens one. This one sent no custom
  header at all, the credentials in the query only, for each mode under three
  Origins — none (a Node client), `http://localhost:5173` (the app under vite)
  and a `chrome-extension://` Origin (the side panel): `SessionStarted` in all
  six, in 598–1,516 ms. `X-Api-Connect-Id` is not required, so ruling 2 stands
  — one plain `openSocket(ast2Url(k))` on every platform, `web` in `platforms`
  — and the header-seam rework the review had held open as the fallback (Tasks
  12, 15 and 16) was not needed.

**F14's owner.** This record supersedes the Stage 2 Gemini section's "with
AST2's header seam" — its inheritance row and its "What it leaves" line, both
marked in place: F14 is OpenAI Live's, and the plain `socket.ts` of Soniox,
Gemini and Doubao move to `src/lib/contract/` with it (the plan's review, D5).

**The spec's amendments** (this record's commit), the plan's ten, each at its
anchor:
1. "The shape": `credentials.choice?` — its `setting` typed `string`, a field
   of `S`, as the code has it (Task 3's review, M4) — and `sources` / `targets`
   with an optional `LanguageContext`; a note beside the earlier plans'.
2. "Credentials are not settings": a credential choice, drawn by both
   credential forms as one control, written by the wizard at Finish before the
   credentials.
3. "Languages are two functions": an offer per speech context, the stored pair
   and the derived one, AST2's `targets` rule; "The participant rule (D20)"
   reads the participant leg's own context.
4. "Turns": AST2's release column (500 ms of silence, the keepalive's 250 ms
   idle), and its design row, split from Palabra's.
5. "Provider capability": AST2's pairing column; Doubao as the second provider
   whose origins L2 infers — worded without the plan's implied contrast with
   Gemini (the pre-flight's F7): neither emits timing.
6. "The registry is a list (D19)": the dead `VITE_ENABLE_VOLCENGINE_AST2` and
   AST2 unflagged. It names `extension/vite.config.ts` beside `build.yml` as
   still forwarding the flag, since both do.
7. "Sockets that need upgrade headers": Doubao's query credentials, and F14's
   first user now OpenAI Live; the old AST2 rules' ids (2000–2003 set,
   2000–2009 cleared), and their removal with V2.
8. "What adding a provider then touches": no manifest change for Doubao.
9. "What every adapter must honour": Doubao's `logStore` rows.
10. "Migration": AST2's item, ported; the relay twin deleted, not ported.
11. **The final fix wave's** (the whole-plan review, M2): "The relay twins"
    agrees with amendment 10. AST2's twin is deleted, OpenAI Translate's stays
    held, and the count reads "two relay twins, one held and one deleted".

**Checked — the gates.** Every implementer ran the suite and the typecheck gate
on its own commit. In the parallel waves a failure or an extra gate line in
another task's uncommitted files was named and left to it: Task 4 and Task 13
saw failures only in the files of a task still in progress (Wave 1's; Task
11's); Task 7 saw extra gate lines in Tasks 8's and 9's work in progress, and
its fix round one failing case in `speech.test.ts` (Task 8's fix round); Task
6's fix round saw gate lines in Task 12's `wire.test.ts`; Task 11 saw one gate
line in Task 12's untracked files. Timeouts under a wave's load passed when
re-run alone (in Tasks 1, 2, 3 and 11, and in Task 6's and Task 9's fix
rounds). The suite grew from 510 files passed and 1 skipped, 6,538 tests passed
and 2 skipped at `2ad8e910`, to 525 files passed and 1 skipped, 6,716 tests
passed and 2 skipped at `9ab968e2`, 0 failed, no unhandled errors; the gate —
the plan's widened regex, re-measured at `2ad8e910` and identical to the
plan's stated baseline — at its 20 lines throughout. After Waves 1 and 2, with
Tasks 11–13 landed, the controller's own run: 522 files passed and 1 skipped,
6,649 tests passed and 2 skipped, 0 failed, no unhandled errors; the gate at
its baseline.

**Checked — group check A** (steps 3 and 4 during the reviews of Tasks 14 and
15 — Doubao is unregistered until Task 16, so no adapter code reached a bundle
— and steps 1 and 2 at `c2f87879`):
1. the suite: 6,702 tests passed and 2 skipped, 0 failed, no unhandled errors;
   the gate at its baseline;
2. `src/services` and `src/components/Settings`: 1,802 passed — the old AST2
   client reaches its codec through the stub;
3. `npm run build` and `npm run extension:build`; the three D24 greps empty;
   `audio.idle` in neither bundle, as expected before the registration;
   `npx vitest run extension` (45 tests);
4. the full tree's typecheck: 259 lines, the bound;
5. a fresh vite: the six spine probes and `app-panel-probe` (`--preview`,
   `--settings`) — all pass;
6. **inferred pairing in the preview:** the fake's `proximity` script with
   keep-audio on (set by the dev checkbox: a stored value did not reach the
   preview) — four rows, two exchanges, each source directly above its
   translation, each translation with "Play this item's audio" once its clip
   played, no karaoke lit (screenshot `ast2-groupA-proximity.png`);
7. **no credential choice without a provider that has one:** no
   `.credential-choice-group` on any of ten pages — advanced and simple, each
   with the fake, Soniox, Gemini, Kizuna Soniox and LocalInference selected.
   The first sweep stalled on simple Kizuna Soniox; that was the harness
   reusing a port between pages, and the page answered alone.

**Checked — group check B** (at `9ab968e2`):
1. `npm run build` and `npm run extension:build`, the three D24 greps empty;
   `audio.idle`, a frame only the new adapter emits, is in
   `build/static/index-*.js` and `extension/dist/fullpage.js` — the adapter
   ships in both bundles, neither fake does; after Task 17's review, the suite
   (6,716 tests passed and 2 skipped, 0 failed, no unhandled errors) and the
   gate at its baseline;
2. the full tree's typecheck: 259 lines, the bound;
3. every probe on a fresh vite, restarted after Tasks 16 and 17: the six spine
   probes, `app-panel-probe` (`--preview`, `--settings`, `--app`, `--app
   --settings`), `extension-overlay-probe` (plain and `--ptt`) — all pass;
4. **Doubao's Provider tab, rendered** in both layouts, with 0 requests and 0
   resources to `openspeech.bytedance.com` in both layouts and both modes: the
   control "App ID + Access Token" | "API key" above the fields, the first
   pressed; the "APP ID" and Access Token rows; "API key" → one "Enter your API
   key" row, the App ID row gone; back → both, empty; the Custom Vocabulary
   section's three rows with their "Manage …" links, its footer and the info
   block (screenshots `ast2-groupB-advanced-*.png`, `ast2-groupB-simple-*.png`).
   The markup was checked class by class against the old Palabra group and the
   old AST2 rows by the reviews of Tasks 10 and 13;
5. **the languages per mode** (in the simple layout: the advanced preview has
   no language section): speaking, exactly the eight spoken languages and
   `zhen`; Text only on, 23 sources — the twenty, `yue-CN`, `sh-CN` and `zhen`;
   `ko → zh` picked under Text only, then Text only off → `zh → en`, and on
   again → `ko → zh`; a dialect source targets English and Chinese; `zhen`
   targets only itself; no dialect is ever a target;
6. **the gate's words:** ▶ Start disabled, "Enter your API key in Settings
   before starting." — in the legacy mode too (an open question below); 0
   requests to Doubao;
7. **the wizard** on a fresh profile: the own-key list "Google Gemini | Doubao
   AST 2.0 | Soniox" (and the development-only fake); Doubao's credential step
   draws the choice above "APP ID" and "Access Token", "API key" → that one
   field, back → both — never filled, never validated, 0 requests to Doubao;
   the language step lists the eight and `zhen` for `be-heard` and the full
   list for `subtitle-myself`, no dialect as a target;
8. the Logs' grouping: `logStore.test.ts` (Task 2) is the evidence; no live
   frame exists before the owner's test.

**Found during execution** — what execution changed or found beyond the plan,
each from a controller's ruling in the ledger, with its reason and where it
lives:
1. **An unreadable frame is said once per ok → failing transition** (the
   pre-flight's F2; `4aa833ca`). `session.unreadable` is framed, and
   `parse_error` degrades while live, only when the leg was reading until then;
   any frame that reads re-arms it; its payload key is `message`, as Soniox's
   `stt.unreadable` and Gemini's `server.unreadable`. Why: the plan framed every
   unreadable frame, and `logStore` gives `session.unreadable` no grouping key,
   so a codec or protocol mismatch would have been one Logs row per `TTSResponse`
   chunk and subtitle partial — against the plan's own hot-path rule and the
   precedent of both earlier ports. Choice 19's "framed" reads "framed and said
   once per episode". Lives in `src/providers/volcengine_ast2/adapter.ts`; the
   case expects two `session.unreadable` frames, not three.
2. **The two refusal sentences live once, in `wire.ts`** (the pre-flight's F9;
   `e4ec0d34`, used by `816440cf` and `4aa833ca`). `OFFLINE` — "The device is
   offline: Doubao could not be reached." — sits beside `REFUSED_UPGRADE`;
   `check.ts` and `adapter.ts` import both and restate neither. Why: the plan
   wrote the offline sentence verbatim in both files, against its own rule that
   the refusal words the two share live in `wire.ts`. The tests keep their
   literals, which pin the words, and `wire.test.ts` pins both. Lives in
   `src/providers/volcengine_ast2/wire.ts`.
3. **A fifth arm of the language-context invariant: the speaking offer lies
   within the text one** (Task 3's review, M2; `6267a100`). Under `{ speech:
   true }` every source, and every target of a source, must also be offered
   under `{ speech: false }`; a control provider, `wider`, gives the arm its
   own failing lines, as `growing` and `dry` give the other four (I1). Why: a
   run speaks when any leg does, so a text-only speaker in a speaking run takes
   its pair from the speaking offer, which is sound only while that offer lies
   within the text one. Doubao's lists already did; now the rule is stated in
   code, and a future provider whose speaking offer is wider fails the
   invariant and has to argue it. Task 6 pins the same for Doubao in its own
   suite. Lives in `src/providers/registry.test.ts`.
4. **Task 8's fix round** (`e2fc16bb`), two rulings on its review:
   - **a whitespace-only subtitle counts as empty** (M3): `if (text.trim())
     this.show(side, text)`, the untrimmed text still what is sent — so a blank
     End after a Start opens nothing, and a blank End on a shown segment keeps
     its text. Why: parity with the old client's false-start test;
   - **`stop()` skips pending decodes** (M5): once stopped, `flush()` answers
     `{ chunks: 0, bytes: 0 }` and the chain decodes no clip still waiting; a
     decode already running finishes and its result is dropped. Why: the
     brief's prose said so, while its code decoded clips queued before, or fed
     after, the stop only to drop them. It made two of the brief's stop cases
     `await flush()` first, so each still pins a decode that is running at the
     stop.

   Both live in `src/providers/volcengine_ast2/segments.ts` and `speech.ts`,
   each with its cases.
5. **The redaction case is built from values with no key shape** (Task 12's
   review, M1; `94982de4`). Its two URLs carry `{ appKey: '1234567890',
   accessKey: 'Abc-Def_ghi' }` and `{ apiKey: '0a1b2c3d' }`. Why: the fixtures'
   token and key are key-shaped on purpose (`sk-…`, `key-…`, for the kit's
   frame-secret rule), and `redact()` masks a key-shaped value whatever its
   query rule names, so the case gave only one of its three names teeth. Now
   dropping any one of the three names from the query rule fails it. Lives in
   `src/providers/volcengine_ast2/wire.test.ts`.
6. **The check's no-leak case, and its status and cleanup pins** (Task 14;
   `816440cf`, fix round `c58021c2`). Beyond the brief, one case runs the four
   paths whose words are the check's own — a refused upgrade, a close after
   open, a timeout, offline — in both modes and asserts that no answer carries
   the token or the key, the endpoint or `api_`, with an in-case control that
   the socket's URL holds all three. Why: the brief pinned those paths with
   `toThrow(string)`, a substring match that a URL appended to the words still
   passes; a URL-appending mutant proved it. The fix round then pinned what its
   review found unguarded: a failing status on `SessionStarted` answers
   `server`, the socket closed and no timer left (killing a hard-coded `client`
   and a ready-on-failing-status); no timer after the offline throw, the close
   after open or `SessionFailed`, and the socket closed by the check on
   `SessionFailed`; the App ID among the leak case's needles in the legacy
   mode; and no corpus in the check's request with all three library ids set
   (choice 20). Lives in `src/providers/volcengine_ast2/check.test.ts`.
7. **`shutDown` detaches the socket's four handlers** (Task 15; `4aa833ca`):
   `onopen`, `onmessage`, `onerror` and `onclose` are nulled before the close,
   as Gemini's `detach` does, and the abort listener is removed once the start
   settles; one case pins both. Why: the dispatch's rule that a stopped leg
   leaves no timer, socket or listener; every handler was already gated on the
   leg's phase, so nothing else changes. Lives in
   `src/providers/volcengine_ast2/adapter.ts`.
8. **A start that cannot open its socket rejects in fixed words** (Task 15's
   review, M3 — the implementer's concern 1; `c2f87879`). `start` wraps the
   leg's construction, which opens the socket synchronously, and a throw there
   rejects with `AdapterStartError('The browser would not open the socket
   (<name>).', 'network')`: the error's name alone (`SyntaxError`,
   `SecurityError`), never its message, and no `cause`. Why: a browser's
   `SyntaxError` for the `WebSocket` constructor can quote the URL, credentials
   included, which would have reached the notice's detail and the console
   unredacted, and `start` threw instead of rejecting. Unreachable with
   `ast2Url`'s URL today. The same words in `nativeSocket` itself, which covers
   Doubao's check and Gemini, were left to the final fix wave, which added
   them (`7f3dded6`; item 10). Lives in
   `src/providers/volcengine_ast2/adapter.ts`, with a case in each credential
   mode.
9. **Scratch directories are task-prefixed** (the controller's ruling, from a
   collision Task 6's re-reviewer met). Every agent's scratch work goes under
   the job's scratch directory in a directory named for its task and role
   (`t9-rereview1/`, `t12-review/`), since agents run at once and a generic name
   collides. Lives in the execution's rules for implementers and reviewers,
   both of which carry it.
10. **The seam's refusal keeps the browser's error name** (the final fix wave;
    `7f3dded6`). The ruling had `nativeSocket` rethrow `new Error('The browser
    would not open the socket (<name>).')`. The error it throws also carries
    the thrown error's `name` (`SyntaxError`, `SecurityError`); its message
    stays the fixed words, and it has no `cause`. Why: Doubao's `start`
    catches any opener's throw and words it by the thrown error's name (item
    8), so with the name dropped a refusal from the app's own seam would have
    read "The browser would not open the socket (Error)." A scratch probe
    showed exactly that. A case through the real seam now pins
    "(SyntaxError)", and a mutant that drops the name fails it. Lives in both
    `socket.ts` files.

**Accepted as they stand** (the controller's rulings, each with its cost if
wrong):
- **Task 7:** the fix round's commit body labels its paragraphs "I1:" and "M1:"
  — review IDs in history, a style slip; rewriting a commit is not worth it.
  Cost: none.
- **Task 8, M4:** a clip locked to a translation that ends unshown plays live
  but can never be replayed — the review's option (a), a stated departure below
  and live-test item 13. Cost: an occasional clip without replay. **Changed by
  the Stage 2 Gemini/AST2 follow-up plan** (its choices 2, 3): now only on the
  lock's fallback — a translation never shown leaves the recent list, so a
  sentence matched by its times never names one already dropped.
- **Task 13:** `.volcengine-info-notice` has no rule in `Settings.scss`; the
  class is carried over from the old markup, which had none either; left as
  parity. Cost: none.

**Stated departures from today** (the plan's self-review list, as landed; what
execution added is marked):
- the participant leg speaks when its switch is on (ruling 4; the old participant was text-only);
- a second credential mode, the new console's API key (ruling 1); the provider runs on the web and installs no DNR rule (ruling 2); both credential forms draw the choice, the wizard's included, so a first run with an API key alone sets Doubao up (choice 2, Task 17);
- the languages follow the mode: speaking offers the eight languages and `zhen`, text only twenty, two dialects and `zhen`; a pair with neither Chinese nor English on one side is no longer offered in either mode (ruling 3); picking `zhen` from the target side is gone (choice 17);
- the keepalive sends silence only after 250 ms with no audio, not after 60 ms, so it no longer splices zeros into speech, and what the pacer held goes up before the silence, not after it (ruling 7; review M1);
- the resampler carries its phase across chunks and sends 80 ms packets (ruling 12). **Execution (Task 7's review, M3):** the 80 ms packets hold each capture chunk's remainder until the next chunk completes it — about 40 ms of added latency on average, at most 80 ms: ruling 12's price, which no ruling had stated;
- a status error, or `SessionFailed`, after the start ends the run in words (ruling 8; the old client ignored `SessionFailed` once started, survey §2.10);
- the check validates the user's pair, bounded to 15 s, and throws while offline instead of blaming the credentials (ruling 9, choices 8, 20); a start rejects in words within 30 s on the request's clock, never with the URL (choice 12) — **as landed**, a start whose socket cannot even be constructed rejects at once, in fixed words ("Found during execution", item 8). **The final fix wave:** a check whose socket cannot be constructed throws the same fixed words, and a `SessionStarted` naming another session is no ✓, as it is no start;
- a spoken sentence's clip is locked to the translation started at its start, read before the decode, and its decodes run in order (ruling 10; parity with the old lock, the two old races not ported). **Execution (Task 8's review, M4):** a clip locked to a translation that then ends unshown — or is replaced by the next Start before it shows — lands on a ref that never opens: it plays live, but L1 holds it pending and it can never be replayed, where the old client fell back to a standalone, replayable audio item. Accepted: in that state the lock most likely voices the previous sentence anyway, and an empty row with audio is a shape no one has seen. **Changed by the Stage 2 Gemini/AST2 follow-up plan** (its choice 2): the lock is now the fallback, for a sentence whose server times name no recent translation; a matched clip takes the translation its times name, read when the clip is emitted. **Execution (Task 8's review, M6):** an unended sentence is flushed as its own clip at the next `TTSSentenceStart`, where the old client dropped those chunks, so a truncated stream can raise `tts_degraded` where the old one stayed silent; and chunks that arrive between a `TTSSentenceEnd` and the next `TTSSentenceStart`, flushed by `TTSEnded`, land on the previous sentence's ref;
- the Logs' frame names change (`subtitle.*`, `tts.*`, `session.*`), grouped under the old keys (choice 9) — **as landed**, `session.unreadable` said once per episode ("Found during execution", item 1).

Where the plan departs from its survey, and why, stays in the plan's
self-review.

**Before any release from the branch**
- **The owner's live test below**, before V2 deletes the old code and before
  any release that carries Doubao.
- **The registry's order** is now `['kizunaai_soniox', 'localInference',
  'gemini', 'volcengine_ast2', 'soniox']` (ruling 5; `src/providers/registry.ts:18`,
  pinned at `registry.test.ts:293`), Doubao unflagged under D19's model.
- **The wizard's own-key description** (`setup.paths.own-key.desc`): its
  "Doubao" is now true; its "OpenAI" still is not.
- **The owner's native-speaker spot check** of
  `providers.volcengine_ast2.authModeApp` in 30 catalogs (ja and zh_CN drop
  their labels' parenthesised English) and of the names `粵語 (cantonese)` (the
  shared registry's) and `上海话 (Shanghainese)` (Task 6 lists them).
- **V2's start-up clear of DNR rules 2000–2009 before any release that carries
  Doubao in the extension.** An extension profile that ran the old client may
  still hold rules 2000–2003, which set no `initiatorDomains`, outlive a browser
  restart, and inject its old `X-Api-App-Key` / `X-Api-Access-Key` into every
  socket to `openspeech.bytedance.com`, the new query-authenticated one
  included (the plan's review, M7; live-test item 20).
- **At Stage 2's end**, `VITE_ENABLE_VOLCENGINE_AST2` and
  `VITE_ENABLE_KIZUNA_VOLCENGINE_AST2` join the release-flag cleanup
  (`build.yml:219,224,273,278,313,318,415,420,517,522`,
  `extension/vite.config.ts:176-184`).

**The owner's live test** (survey §2.13's list, adjusted to the rulings; what
execution added is marked). Each item names what to record in the Logs
(diagnostic logs on, in Help):
1. **Both credential modes and the check (rulings 1, 9):** the legacy App ID + Access Token → Validate ✓; a wrong token → "The provider did not accept the credentials: …" with the refusal's words, Start off; the API key → ✓; a wrong key → the same words; empty in either mode → "Enter your API key…". Switching modes keeps the other mode's fields. An old profile (App ID and Access Token saved by an earlier build) opens in the legacy mode, ready without re-entry. **An API-key session starts** (no `requestMeta.AppKey` — choice 5; if it is refused at `StartSession`, that is the first suspect). Each check opens and finishes one real session: record whether the console bills it. **Execution (group check B, step 6):** the idle line reads "Enter your API key in Settings before starting." in the legacy mode too — record how it reads to a user who holds an App ID and an Access Token (an open question). **The final fix wave (the whole-plan review, M4):** record whether `SessionStarted` echoes the `SessionID` the client sent, in the API key mode above all: the old client's identical guard proved the echo for the legacy mode only, and the browser-shape probe accepted `SessionStarted` without comparing it. Both the check and the start now drop a `SessionStarted` that names another session, so if the server answered with an id of its own, Validate would end after 15 s with "Doubao did not answer the check within 15 s." and every start after 30 s with "Doubao did not start the session within 30 s.", the start framing `session.foreign` in the Logs. **The whole-plan review's addition:** the check always asks for text only (ruling 9, choice 20), so an app whose console grants text translation but not speech to speech would validate ✓ and then fail a speaking start. If such an app is at hand, validate it, start a speaking session on it, and record the words.
2. **The query URL from the web page, the extension's side panel and Electron (ruling 2):** the socket opens in each; no credential in the Logs or the Logs' export; record whether DevTools' own console prints a failed socket's URL with its query. **Execution (Task 14's review):** record too whether it prints it when a check or a start is aborted, or times out, while its socket is still connecting.
3. **Speech to speech, auto:** zh → en, en → zh, ja → zh and each of the other spoken languages once, as a source and as a target of zh or en; the speaker's cloned voice heard on the monitor and in the virtual microphone, once each; source and translation rows paired; replay per sentence with keep-audio on; no karaoke. **Changed by the Stage 2 Gemini/AST2 follow-up plan** (its ruling 1; choices 2–4): each translation now lights over its own clip — the whole subtitle whose server times the sentence carries, ranged once the subtitle is final — that record's live-test items 1, 2, 3 and 11.
4. **Text only, the full list:** a sample of the twelve text-only languages as sources (ko → zh, ru → en, ar → en, th → zh) and as targets (zh → ko, en → vi); no audio.
5. **A dialect source:** 粵語 → 中文 and 上海话 → English, in text only; the badge reads "YUE-CN" / "SH-CN".
6. **`zhen`:** mixed Chinese and English speech, speaking and text only; rows labelled "ZHEN".
7. **Pairing (ruling 11):** record the `subtitle.*` frames' `sequence`, `startTime` and `endTime` over several utterances — is `Sequence` shared by a source and its translation, and do the translation's times count on the source's timeline? Check rows on rapid speech, on a long monologue (a translation opening more than 4 s after its source leaves L2's proximity window) and on sentences that overlap.
8. **Push-to-talk (ruling 6):** a short press → the utterance finalized soon after release; a press with no speech → nothing shown, the next press not merged; `turn.tail` frames, with `cancelled` for a cancel.
9. **The keepalive during silence (ruling 7; review M1):** ten minutes silent or muted — the session stays open; `audio.idle` once per idle, `audio.resumed` when speech returns; during continuous speech no `audio.idle` at all (a slow device's capture gaps under 250 ms never trip it); recognition quality against the old build's. **The whole-plan review's addition:** ruling 8 makes any status other than OK fatal mid-session, on any event (`adapter.ts`' status check). During the ten minutes, watch for `session.status` frames: if the server attaches a warning status to `AudioMuted` or `UsageResponse`, the session ends on a warning the old client only displayed. Record the event, the code and its words.
10. **Both with participant speech (ruling 4):** two sockets; the participant's reverse direction; its switch on → the other party's translation heard on the real device in their cloned voice, off → text; either leg ending ends both; participant-only. **Corrected by the final fix wave (the whole-plan review, M1):** with the speaker on Text only and a text-only pair (zh → ko), turning the participant's speech on makes the run speak, so the shown pair moves into the speaking offer (zh → ko shows as zh → en) and returns when the switch goes off (choice 1). Nothing is refused. The gate refuses the participant leg in words only for a dialect source while the participant is text-only: 粵語 → 中文 in Both, with Text only on and the participant's speech off (D20; an open question below). Record whether two sessions on one credential are allowed, and whether the participant's libraries (sent on both legs, choice 6) do harm. **The whole-plan review's addition:** record whether a Start right after a Validate, or right after a check that a newer one superseded, is refused while the check's session is still being released. The check closes right after `FinishSession`, where the old validation waited 300 ms. Record too whether Both's two legs plus a check that has just finished trip a per-app concurrency quota.
11. **Errors mid-session (ruling 8):** a status error → the run ends with its words (`notices.client` / `notices.server` with Doubao's detail); a network drop → the connection-lost words.
12. **The status codes (choice 4):** every status other than 20000000 and its message, from `session.status` frames; whether `4xxxxxxx` is always the client's fault.
13. **TTS replay (ruling 10):** each sentence's clip on its own translation row, also when translations follow each other fast, and when a sentence starts before its translation shows text (record the order of `subtitle.translation` phase `start`, its first `response`, and `tts.sentence_start` with their `ref`s); keep-audio off → no replay button. **Execution (Task 8's review, M4):** `tts.sentence_start` frames the ref its sentence locked, shown or not — record, for each, whether that ref's translation was ever shown: a ref never shown is a clip with no replay (a stated departure). **Changed by the Stage 2 Gemini/AST2 follow-up plan** (its choices 2, 5): `tts.sentence_start` now also carries the sentence's `startTime` and `endTime`, and each clip is framed `tts.clip` (`ref`, `matched`, `range`) as it goes to L1 — the row it took, whether the times named it, its range (`null` while its subtitle is open); the lock's ref is the clip's only when the times name no recent translation — that record's live-test item 1.
14. **The libraries:** hot words, replacement and glossary ids take effect as in the old build.
15. **Stop mid-sentence:** rows finalized; no audio after Stop; `FinishSession` sent.
16. **The wizard:** the own-key path lists Doubao after Gemini; the credential step shows the choice above the saved mode's fields; **a first-run setup with an API key only** — pick "API key", validate, finish — leaves Settings in the API key mode with the key saved, and a session starts; the language step's lists follow the scenario, and Back to another scenario normalizes a pair its list does not hold. **Execution (Task 17's review, m3):** two edges to try — picking the other mode and then the saved one again leaves the credentials unvalidated (Validate again, or Skip); and on a profile holding both modes' credentials, once the shown mode's saved values were mirrored into the draft, the other mode's saved value is not filled in after a switch. Record whether either confuses.
17. **The Logs panel:** the frames grouped (no flood of `subtitle.*` rows), `session.usage` and `session.audio_muted` present, no credential anywhere.
18. **Analytics:** `translation_session_start` with `provider: 'volcengine_ast2'`; a refused start → `api_error` with its code.
19. **A long session** (survey §2.13 item 15): 30 minutes or more, speaking and silent — no server timeout, no latency growth.
20. **Stale header rules from the old client, in the extension** (review M7): on a profile where an old build ran AST2 (`chrome.declarativeNetRequest.getDynamicRules()` in the service worker lists ids 2000–2003), start a session in the API key mode, then in the legacy mode with other credentials than the rules carry: record which credential the server honours, and whether either session is refused.

**Open questions for the owner**
- Pairing (item 7): state origins from `Sequence`, or emit timing, if the live test shows either holds (choice 3).
- The idle line's words name an API key in the legacy mode too (`notices.credentials_missing` is generic; group check B, step 6; item 1): a code of its own would need a key in 30 catalogs.
- **The participant leg's libraries — Doubao's case of "Name the leg in `SessionContext`"** (the Gemini section's open question; the pre-flight's F3): choice 6 sends the speaker's libraries on both legs because `build` has no leg identity — `shared.reversed()` holds for both legs of `zhen/zhen` — the same gap by which a same-language pair makes both Gemini legs read Other's prompt. One leg identity in `SessionContext` settles both; item 10 records whether the participant's libraries do harm.
- The resampler has no low-pass filter beyond its averaging (choice 11).
- Per-row `zh` / `en` labels in a `zhen` session (choice 18).
- A failed socket's URL in DevTools' own console (item 2): not a sink of ours; only a header seam would keep the credentials out of the URL. **Execution (Task 14's review):** an abort or a timeout while the socket is still connecting prints it too — a check that times out or is aborted mid-handshake (the wizard's credential step aborts one on a pick), or a start aborted while opening, is such an occasion.
- Every failure before the socket opens reads as refused credentials while online: a rate-limited upgrade (the account's QPM 60, survey §2.4, with readiness re-checking after edits) or a proxy that blocks it says "check the App ID and the Access Token, or the API key" too (choice 8; review M7). Telling them apart needs what a browser cannot read — the upgrade's status.
- **Each check opens a real session — Doubao's case of "The readiness re-check on each instruction edit"** (the Gemini section's recommendation 3; the pre-flight's F3): readiness re-checks 800 ms after every settings edit — a library-id keystroke included (the Soniox plan's "re-probes on every settings edit") — and where Gemini's re-check lists models for free, each of Doubao's opens and finishes a real session (item 1). It also re-checks when the store's re-derivation moves the run's pair and forgets its readiness: a Text-only toggle over a text-only pair outside the speaking offer costs one more real session (Task 9). **Two more occasions (the whole-plan review, M3):** every audio-mode switch — `setLegs` forgets every loaded provider's readiness, and the check's cache key (`refreshReadiness` in `providerStore.ts`) includes the legs, though Doubao's check ignores them, while only the latest ready answer is kept, so Speaker → Both → Speaker is two more sessions; and every launch of the app, or opening of the side panel, with Doubao selected — the driver checks a provider at once when it is selected and when its entry loads (`src/app/readiness.ts`' header), and the last answer is held in memory only. Item 1's billing question should count all of these. A provider declaring which of its inputs the check reads — the generic change the Gemini section records as not taken — would spare the library-id keystrokes and the audio-mode switches.
- **A text-only launch can be checked twice** (Task 9's review, M4; beside the item above): at launch, a text-only user whose stored Doubao pair lies outside the speaking offer can be checked once with the pair derived for speaking — the entry lands before the text-only switch does — and again after the pair moves and readiness is forgotten; the audio mode's late load already has that shape.
- **Dialect sources offered where the gate then refuses them; a Cantonese-speaking participant cannot be set up** (the whole-plan review, M5; items 5 and 10). In a run whose context is text only and that opens the participant leg — participant-only, or Both with Text only on, the participant's speech off in either — Settings and the wizard list 粵語 and 上海话 as sources (`ast2Languages`, reached through `LanguagePairSection` and `StepLanguagePair`), and D20 then refuses every such pick, since the participant runs the reverse and no dialect is ever a target; the wizard lets such a pair reach Finish. By the same reversal the participant leg can never hear a dialect: its source is the pair's target. It is the shape Soniox's AUTO source already has under D20, not a regression, but Doubao adds a new case of it. The owner decides: filter the sources by reverse support while the participant leg opens text-only, or accept it as it stands.
- **Superseded checks are never aborted** (Task 14's review): the readiness driver calls `refreshReadiness(p, auth())` with no signal (`src/app/readiness.ts:60`), and no check a newer one supersedes is aborted, so an edit made during a handshake can overlap two short, audio-free Doubao sessions on one credential.
- **The ScriptProcessor fallback's 341 ms chunks against `IDLE_MS`** (Task 7's review, M2): `IDLE_MS` = 250 holds on the AudioWorklet capture path, whose chunks come every 85.3 ms; the ScriptProcessor fallback (16,384 frames, 341 ms a chunk) would find every gap past 250 ms, drain, and splice an 80 ms silent packet into it — the old bug in another form. Rare (the fallback runs only when the worklet fails to load), and not built; the cost while open is clipped or padded speech on that path, until an adaptive idle is built. **Widened by the Stage 2 Palabra plan's execution** (its Task 9 review, I1): the participant leg's capture delivers at 24 kHz, so its fallback's 16,384 samples come every 682.7 ms (its worklet's 4,096 every 170.7 ms), and an idle shorter than that finds every gap between two of its chunks. Palabra's `IDLE_MS` is 800 ms for it; AST2's 250 ms stays this item's.
- **A kit-wide "no ws(s) URL in a frame" rule** (Task 15's implementer, concern 2): `framePayload` already redacts query values, so the kit's own check would pass a frame carrying a redacted URL — the endpoint and the parameter names, never a secret; Doubao's own case catches one by its host. A rule in the kit would hold Soniox and Gemini to it too. **Done** by the Stage 2 Palabra plan (choice 10; `e5e3e5d5`): `checkConformance`'s `frame-url`, which every registered provider passes.
- Analytics for `degraded` (Plan A's open question, unchanged).

**V2's inventory** (the deletion plan, after the live test; the relay twin with
it — the owner's ruling: deleted, not ported; lines read at `3665711d`, and
none of these files changed through `9ab968e2` but `logStore.ts` and the codec's
two stubs):
- `src/services/clients/VolcengineAST2Client.ts` (+ test; its six corpus cases already ported to `config.test.ts`), the two stubs `src/services/clients/volcengine-ast2/ast2-proto.{js,d.ts}`;
- `src/services/providers/VolcengineAST2ProviderConfig.ts`, `KizunaAIVolcengineAST2ProviderConfig.ts` (the relay twin), `volcengineAST2LanguageSync.ts` (+ test); their `ProviderConfigFactory` registrations (`:10, 12, 43-45, 58, 163`) and the old test tables naming them (`descriptorRegistry`, `kizunaProviderGating`, `providerOrder`, `participantConfig`, `speechMode`, `sessionResourcesWiring`, `voicePrepWiring`, `prepareToStart.*`, `ClientFactory`, `ClientOperations`, `settingsStore.*`, `kizunaProviders`, `AccountButton`, `PoweredBy`, `SetupWizard`, `providerPath(s)`, `Provider.test` — survey §1.19);
- the old UI's AST2 branches: `ProviderSpecificSettings.tsx:1471-1719` and its active-slice ternaries (`:171-194`), `ProviderSection.tsx:76, 484-485, 719-756`, `LanguageSection.tsx:114-121, 166-180, 259-270, 312, 318-326, 605`;
- the `volcengineAST2` and `kizunaVolcengineAst2` slices of `settingsStore.ts` (`:291, 294, 421, 424, 657, 663, 706, 709, 973, 976, 1541, 1544, 1625, 1628`) — the storage keys stay, `providerStore` reads them;
- `Provider.KIZUNA_AI_VOLCENGINE_AST2` with `isKizunaManagedProvider` / `kizunaBaseProvider`'s AST2 case (`src/types/Provider.ts:13, 49-60`), `KIZUNA_HOSTED_ICONS`' entry (`src/components/Icons/ProviderIcons.tsx:280`), `isKizunaVolcengineAST2Enabled` (`src/utils/environment.ts:230-236`) and its forwarding (`extension/vite.config.ts:176-184`, `build.yml`'s AST2 lines), `TUTORIAL_URLS`' AST2 entry (`src/services/providers/tutorialUrls.ts:19`) once nothing reads it;
- the extension's AST2 DNR block and its two messages (`extension/background/background.js:254-317, 544-563`), and **in their place a start-up clear of dynamic rules 2000–2009**, so a browser that ran the old client drops what it left installed;
- `providers.kizunaai_volcengine_ast2.*` in 30 catalogs; `logStore.ts`' old AST2 event names and grouping alternatives, once no old client emits them;
- **keep:** `LEGACY_SLICE_KEYS.kizunaai_volcengine_ast2` and `MANAGED_LEGACY_IDS` (a stored selection of the twin falls back, the Kizuna Soniox plan's choice 13), `getRelayWsUrl` and the `sokuji-auth.` redaction rule (shared with the Kizuna OpenAI Translate twin), `electron/main.js`' generic `ws-headers-set/clear` (OpenAI Live's seam will use it).

**The roadmap's inheritance, item by item** (the plan's tables, as landed):
taken (and where), deferred (and why), or already done.

From "Scheduled by the Stage 2 foundation plan" (`:1287-1289`, `:1298-1302`,
`:1304` above):

| Item | Disposition |
|---|---|
| Volcengine AST2: F14, the socket seam (`openSocket`; its fake hands out `FakeSocket`s) | not built: the credentials ride in the query (ruling 2), and the owner's browser-shape probe showed no header is needed. Doubao has its own plain `socket.ts` (choice 13, Task 12), tested over `FakeSocket` as Soniox and Gemini are; F14's first user becomes OpenAI Live, superseding the Gemini record's "with AST2's header seam" (both its lines, marked in place) |
| Volcengine AST2: F16, windowing the pairing inference | done by the Gemini plan (its Task 2); consumed here through `createProjector` (Tasks 5, 15), and seen in the preview at group check A |
| OpenAI Translate: F16 if AST2 did not land it | done by the Gemini plan |
| Palabra: F4, the credential-adjacent control | built here (Tasks 3, 10), Doubao its first user, and drawn by the wizard's credential step too (Task 17); Palabra's platform / app toggle becomes a `credentials.choice` on its `authMode` |
| OpenAI Live: F14 (reused) | becomes F14's first user |

From the Soniox plan's "Found here" (`:1740-1747` above):

| Item | Disposition |
|---|---|
| Readiness re-probes on every settings edit | applies: a library-id keystroke re-runs Doubao's handshake 800 ms later — a real session opened and finished — and so does a Text-only toggle that moves the run's pair (Task 9). Not taken (a generic change); an open question, Doubao's case of the Gemini section's |
| `timing` after a 503 resume | n/a: Doubao emits no timing and does not resume |
| `audio.range` after fill-in | n/a: Doubao's clips are rangeless. **Changed by the Stage 2 Gemini/AST2 follow-up plan:** it applies now — a matched clip emitted after its subtitle closed carries its range, usually after the fill-in in the display cut by sentences; closed by that plan's Task 2 (choice 19) |
| The side latch | n/a: one leg per socket |
| Two TTS sockets per key in shared Both | its analogue, two sessions per credential in Both, is live-test item 10 |
| `Conversation.afterAudio`'s pending drop | n/a: Doubao emits no `speechRanges`. **Changed by the Stage 2 Gemini/AST2 follow-up plan:** it applies now in form — a sentence's clip can be held before its translation opens and ranged later by `speechRanges`; closed by that plan's Task 2 (choice 6) |

From "Scheduled by the Stage 2 Gemini plan" (above; the pre-flight's F3 — the
section was written after this plan):

| Item | Disposition |
|---|---|
| "Volcengine AST2: F14's socket seam — deferred to AST2" (its inheritance table), and "F14 … with AST2's header seam" (its "What it leaves") | superseded, both marked in place: F14 is OpenAI Live's |
| Inferred pairing in the preview ("one belongs with AST2") | done — Task 5, the fake's `proximity` script (`1ea6855b`); group check A, step 6; marked in place |
| `trackedClock` promoted to the kit ("What it leaves", and the open question on recommendation 5) | done — Task 12 (`e4ec0d34`, choice 14); both marked in place |
| The instructions of later ports | n/a: Doubao sends no system instructions |
| Name the leg in `SessionContext` (open question) | joined: choice 6's libraries on both legs are Doubao's case (open question above) |
| The readiness re-check on each instruction edit (open question, recommendation 3) | joined: for Doubao every re-check is a real session, a Text-only toggle included (open question above) |
| `session.closed` on Stop | the same for Doubao ("What it leaves") |

"Before any release from the branch" (`:1751-1765`, `:2318-2343` above) and
the Kizuna Soniox plan's "Found here" (`:2494` above):
- The registry's order: extended by ruling 5 (Doubao fourth), pinned in `registry.test.ts`.
- The wizard's own-key description: its "Doubao" became true with Task 16; "OpenAI" still waits for its port.
- The relay twin: deleted, not ported (`:2334`) — V2's inventory takes it with the own-key code.
- The release-flag cleanup at Stage 2's end: the two AST2 flags join it (this record's "Before any release").
- The native-speaker checks: one key in 30 catalogs and two language names (Task 6).

**Stage 2 items from the roadmap this plan does not take:** the kit's parked items (`{ flush: true }` after an awaited answer, `FakeSocket`'s close codes, the virtual clock's `pending()` count, manual-end's segment check); the account's compile-time narrowing; `RunnerDeps.replayAudio`'s guard; the notice-code namespace.

What it leaves, for the plans that meet it (the plan's own list, as written;
then the whole-plan review's note for later ports; the three items the task
reviews parked for this plan's final fix wave are done, last below):
- **V2**, the deletion of the old AST2 code with the relay twin, the AST2 background block (replaced by a start-up clear of rules 2000–2009) and the dead flags, after the owner's live test (this record's inventory).
- **F14**, the header seam, for OpenAI Live; Soniox's, Gemini's and Doubao's plain `socket.ts` move to `src/lib/contract/` with it. **Changed by the Stage 2 Palabra plan** (choice 1; `0e9ccff0`): the plain seam moved without F14, at its fifth user — Gemini's, Doubao's, OpenAI Translate's and OpenAI Realtime's copies re-export `src/lib/contract/socket.ts`; Soniox's stays its own. F14 joins it there.
- **Palabra's use of F4:** its toggle as a `credentials.choice`.
- **Stated origins for Doubao,** if the live test shows `Sequence` or the times state the pair (choice 3). **Changed by the Stage 2 Gemini/AST2 follow-up plan:** the owner's probe shows every source subtitle carrying its translation's server times — the evidence; still not taken (that record's open questions).
- **The legacy mode's own idle words** — an open question.
- **The start-up clear of DNR rules 2000–2009** — V2's, before any release that carries Doubao in the extension.
- **`session.closed` on Stop** is not emitted (the kit forbids emissions after stop), as for Soniox and Gemini.
- **The owner's open questions** in this record, each with the live-test item that settles it.
- **Generic frame names grouped under Doubao's Logs keys** (the whole-plan review, M6): `logStore.ts` groups `subtitle.source`, `subtitle.translation`, `tts.sentence_start`, `tts.sentence_end`, `tts.ended`, `session.usage` and `session.audio_muted` — generic `domain.event` names — under the old client's `volcengine_*` keys (choice 9). No other provider emits them today; a later port that names a frame `session.usage` or `tts.ended` would find its rows grouped under Doubao's key, silently. The effect is cosmetic, in the Logs only. That port should give its frames names of its own, or narrow Doubao's rows (V2 is a natural moment, once the old client's names go), or pin in `logStore.test.ts` that these rows are Doubao's only while no other provider emits the names.
- **To the final fix wave, done** (`7f3dded6`, "The final fix wave" above): `nativeSocket` in `volcengine_ast2/socket.ts` and `gemini/socket.ts` rethrows in fixed words — `The browser would not open the socket (<error name>).` — dropping the browser's message, which can quote the URL; one place each covers the adapter, Doubao's check and Gemini (Task 15's review, M3b). The error keeps the browser's error name ("Found during execution", item 10).
- **To the final fix wave, done** (`45e49a6e`): review and task IDs stripped from production comments, plan-wide — "(Stage 2 Volcengine AST2, I2)", "F4", "Task N" — citing rulings and choices as the other files do, Task 1's two codec stubs among them, to cite F18 rather than a task (Task 17's review, m1; the ruling on Task 1's note). F4, an F item the codebase cites, stays.
- **To the final fix wave, done** (`7f3dded6`): an `invocationCallOrder` pin that Finish writes the credential choice before the credentials. The order is not load-bearing today — both writes are synchronous and the readiness driver schedules its check — and nothing would catch a refactor that made it so (Task 17's review, m2). A scratch copy that swaps the two writes fails only the new case.

## Scheduled by the Stage 2 OpenAI Translate plan

The Stage 2 OpenAI Translate plan
(`docs/superpowers/plans/2026-09-28-client-contract-stage2-openai-translate.md`,
plan commit `4592115f`, written over `8db4261f`'s code) landed as the fifteen
commits `fee5aa77` through `426251e1` on `worktree-client-contract-stage2`
(`4592115f..426251e1`: **+3,193 / −9 lines across 35 files**). Then this record
with the spec's amendments. It is Stage 2's fifth provider — **OpenAI
Translate, `gpt-realtime-translate` speech to speech, with the user's own key**
(`openai_translate`) on the new session, over WebSocket: its definition,
settings, credentials, a bounded model-list check, builder, adapter with a
push-to-talk release tail, and settings view, and the pieces it built for the
ports after it (`NoiseReductionField`, two notice aliases, the subprotocol's
redaction). The WebRTC transport is a later Stage 2 step (ruling 1) — **abandoned 2026-09-29 (owner)**, neither migrated nor reimplemented: `S.transportType` is removed, and T3 waits only for the WebSocket live tests (the Stage 2 OpenAI Realtime record, "The owner's WebRTC decision"). Deleting
the relay twin `kizunaai_openai_translate` — which the owner ruled is deleted,
not ported — is a later plan, T2, after the owner's live test below; deleting
the own-key old code of both transports is T3, after the WebRTC step's live
test, since the WebRTC client imports the GA client (ruling 14). Until then the
old GA and WebRTC clients, the two descriptors, the old settings UI's Translate
branches, the two store slices and `EphemeralTokenService`'s translation mint
stay compiled and unreachable. Ten implementation tasks ran in the plan's four
waves — Tasks 1–3; Tasks 4–8; Task 9; Task 10 — with group check A after the
third and group check B after the fourth. Wave 2 started while the reviews of
Tasks 1 and 3 ran, Task 9 while Task 6's re-review ran, and Task 10 while Task
9's fix round ran, each on files the running work did not touch. Tasks 4, 5 and
9 took one review fix round each and Task 6 two; Tasks 1, 2, 3, 7, 8 and 10
were approved as their implementers committed them. Task 11 is this record. The
survey and the follow-up research the plan was written from are named in its
research notes.

**The pre-flight.** The plan's independent review applied it task by task to a
scratch copy of `8db4261f` and ran each task's red and green step at its own
point: every red failed as stated, every green passed, all 13 diffs applied,
and every block given in full equalled the tested file. Its two Important and
nine Minor items were applied by the drafter, who applied the amended plan
again to a fresh copy of `8db4261f`: 538 files passed and 1 skipped, 6,853
tests passed and 2 skipped, the full tree's typecheck at 259 lines and the gate
at its 20. That application was the executed pre-flight; the tree had not moved
since (`4592115f` adds only the plan), and no ruling was needed before Wave 1.

**The rulings.** Rulings 1–15 are the owner's (2026-09-28; the plan's header),
each confirmed as the plan states it:
1. WebSocket only: a stored `webrtc` choice runs over WebSocket until the
   WebRTC step, and no transport control shows (`S.transportType` kept,
   `C.transport` `'websocket'`; choice 15). **2026-09-29:** the WebRTC step abandoned (owner); `S.transportType` removed, a stored one unread, `C.transport` still `'websocket'`.
2. Push-to-talk's release tail: the held remainder padded to the next 200 ms
   frame, then silence in real time until the translation has been quiet 1 s,
   at most 3 s after the release; a press ends it; no idle keepalive until the
   live test shows a need. Both numbers land as frames counted in 200 ms beats,
   five and fifteen ("Found during execution", item 1).
3. A mid-session `error` is a Logs line, the session running on; its words are
   kept for a close that follows.
4. Text only is offered as a playback control, `speech: 'optional'`: a leg that
   does not speak drops the audio the API still sends, and bills.
5. The participant speaks when its switch is on: the definition sets no
   `participantSpeech`.
6. Pairing by proximity through F16 and audio ranges by arrival, with no
   `timing`; `elapsedMs` framed on every delta — the source's, the
   translation's and the content audio's.
7. The model select is gone: every session runs `gpt-realtime-translate`, and
   the check still requires the family.
8. The transcript-model select is gone: `gpt-live-transcribe` is a constant.
9. Noise reduction "None" sends `null`.
10. No OpenAI-key prefill on first selection.
11. The registry order `['kizunaai_soniox', 'localInference', 'gemini',
    'volcengine_ast2', 'openai_translate', 'soniox']`, Translate unflagged
    (`src/providers/registry.ts:19`, pinned at `registry.test.ts:293`).
12. The OpenAI setup guide (the same key).
13. An expiry or a drop ends the run in words; no reconnect.
14. T2 after this port's live test; T3 after the WebRTC step's. **2026-09-29:** T3, merged with OpenAI Realtime's deletion, now after the two WebSocket live tests — the WebRTC step is abandoned (owner).
15. Same-language pairs stay offered; `auto` stays out of the sources.

Rulings 16–23 are the controller's technical rulings in the plan, applied as
written. The controller's rulings during execution are recorded below, under
"Found during execution", "Accepted as they stand", "Stated departures", the
live test, the open questions and "What it leaves".

What landed, by task:
- **The check's words, the subprotocol's redaction, the Logs pin** (`914a65a0`,
  Task 1; rulings 16, 18, 20; choices 3, 11, 12): two `NOTICE_ALIASES` —
  `no_translate_model` → `settings.translateModelNotAvailable` and
  `region_unsupported` → `settings.regionNotSupported`, the old validation's
  sentences — each targeting the provider section; `redact()`'s carrier rule,
  `(\bopenai-insecure-api-key\.)[A-Za-z0-9._~+/=-]+` → `$1[REDACTED]`, beside
  `sokuji-auth.` (whose comment's drifted `GA:501` now reads `:707`) and ahead
  of the bare-key rules in its sequential loop; `logStore.test.ts` pins, with
  no change to `logStore.ts`, that its `.delta` rule groups the three delta
  frames each under its own type and that none of Translate's other frame
  names takes a key — all eighteen enumerated, so none lands under Doubao's
  rows. No new locale key.
- **`NoiseReductionField`** (`fee5aa77`, Task 2; ruling 19, choice 13): the old
  noise section's markup (`ProviderSpecificSettings.tsx:807-840`) as a shared
  field in `src/components/providers/fields/`, generic over its values, which
  it shows raw as the old select did, with an `aria-label` as `VoiceField`'s
  select has. OpenAI Realtime and Compatible reuse it next.
- **Translate's settings, languages, key and builder; the folder seeded**
  (`8beadc3a`, Task 3; rulings 1, 4, 5, 7, 8, 9, 15; choices 4, 10, 14, 15):
  `settings.ts` — `TranslateSettings { noiseReduction, transportType }`,
  `TRANSLATE_DEFAULTS`, `migrateTranslateSettings`, `TRANSLATE_MODEL`,
  `TRANSCRIPT_MODEL`, `isTranslateModelId` (`OpenAIClient.ts:265`'s rule),
  `TRANSLATE_SOURCES` (74, no `auto`) and `TRANSLATE_TARGETS` (13), entry for
  entry the old descriptor's (`OpenAITranslateProviderConfig.ts:161-256`),
  `translateLanguages` (one offer in every language context) and
  `translateCredentials` (one key, trimmed); `config.ts` — `TranslateConfig {
  model, target, transcriptModel, noiseReduction, silence, transport }`,
  `buildTranslate` (a target outside the thirteen refused in words, "None" as
  `null`, `silence` exactly as `buildGemini` builds it, `transport:
  'websocket'` with `S.transportType` unread) and `describeTranslate` →
  `{ translationModel, asrModel }`; the `adapter.ts` seed, written first for
  the session-side guard.
- **Translate's own settings view** (`49c0f783`, Task 8; D18, rulings 1, 7, 8,
  19, choice 13): `TranslateSettingsView` draws the old info banner character
  for character (`ProviderSpecificSettings.tsx:2173-2183`), first, then
  `NoiseReductionField`, and writes only `update({ noiseReduction })`; no
  model, transcript-model or transport control, and every string an existing
  key.
- **Each side a segment on its own silence timer** (`d78a0920`, fix round
  `e6af8d8f`, Task 5; rulings 4, 6, 17, 21; choices 4, 5, 6, 18): `segments.ts`,
  `TranslateSegments` — the per-side `ensure` / `close` / `arm` / `cancel` and
  the mid-sentence deferral copied from Gemini's Live Translate half
  (`gemini/turns.ts:217-259`, less the origin and the CJK respacing), not
  shared, for the three reasons choice 4 gives; content audio opens the
  translation when none is open and re-arms its timer whether it plays or not
  (choice 5); a played frame carries `[the previous played frame's end, the
  text's length at its arrival]` (choice 6); a `.done` event closes its side
  (choice 18). The fix round (test-only): "Found during execution", item 4.
- **The wire, the socket seam and the fixtures** (`aed81d5f`, fix round
  `bbf16f39`, Task 4; rulings 6, 8, 9, 16; choices 3, 8, 9, 17): `socket.ts`,
  Translate's own seam — `nativeSocket(url, protocols)` rethrows a constructor
  failure as `The browser would not open the socket (<name>).`, keeping the
  error's name, as the AST2 plan's final fix wave did for Doubao and Gemini;
  `wire.ts` — `TRANSLATE_WS_URL` and `translateUrl` (the model in the query),
  `translateProtocols` (`['realtime', 'openai-insecure-api-key.<key>']`, never
  the beta tag, which the endpoint refuses; the one reader of the key, pinned
  by a TypeScript-AST scan), `sessionUpdate` (typed by the SDK's event; the
  transcription always set, `noise_reduction: null` for none), `appendFrame`,
  `pcmToBase64` and `base64ToPcm` copied from Gemini's wire (choice 8; an odd
  trailing byte dropped), `decodeServerEvent`, `OUTPUT_RATE`, `isSilentFrame`,
  `computeRms`, `elapsedMsOf`, `errorCode` and `errorWords` (choice 9);
  `testing.ts`, the fixtures. The fix round (test-side): "Found during
  execution", item 3.
- **The release tail** (`bd74c926`, fix rounds `b4b83f67` and `f2c91d1f`, Task
  6; rulings 2, 21; choice 7): `tail.ts` — `FRAME_MS` (200), `FRAME_SAMPLES`
  (4,800), `TAIL_QUIET_MS` (1,000), `TAIL_MAX_MS` (3,000), `padSamples(sent)`,
  `TailSummary { reason, silenceMs, lastOutputMs, cancelled? }` and
  `ReleaseTail` (`start(sent, cancelled)`, `output()`, `stop(reason)`,
  `cancel()`, `running`): the pad at once, then `every(clock, 200, …)`, one
  silent frame a beat until quiet or the cap; a press or audio ends it and says
  so, `cancel` ends it silently. The first fix round made both ends count beats
  ("Found during execution", item 1) and pinned the `'audio'` ending; the
  second corrected two comments.
- **The check, one bounded model list** (`580bd8cd`, Task 7; rulings 7, 18;
  choice 11): `check.ts` — `createTranslateCheck` and `checkTranslate`: `GET`
  `OPENAI_MODELS_URL` with `Authorization: Bearer <key>` and nothing else,
  bounded by `CHECK_TIMEOUT_MS` (15 s) and the caller's signal, on an injected
  `fetch` and clock; ids starting `gpt-realtime-translate` → ready, newest
  `created` first, each id once; none → `no_translate_model`;
  `unsupported_country_region_territory` at any status → `region_unsupported`;
  401 or 403 → `auth` with `HTTP <status>: <OpenAI's message>`; 429 →
  `rate_limit`; any other status, a failed fetch, the bound or the abort → it
  throws. Line for line the skeleton of Soniox's and Gemini's checks.
- **The adapter** (`49727661`, fix round `426251e1`, Task 9; rulings 2, 3, 4, 6,
  13, 16, 20, 21; choices 1, 2, 3, 5, 7, 9, 12, 15, 16, 17, 18):
  `createTranslateAdapter`, one leg per socket. `session.created` sends
  `session.update`, and the start resolves on `session.updated` (choice 1). It
  rejects in words within `START_TIMEOUT_MS` (30 s) on the request's clock —
  `network` if the socket never opened, `server` if it did — and at once for a
  socket that failed before opening (`NEVER_OPENED`, `network`), a close after
  it opened, the server's `session.closed` or an `error`, closing the socket on
  every path (choice 2); a browser that will not open the socket rejects in
  fixed words (ruling 16). Each chunk goes up as it came, unframed. Under manual
  turns a release, voiced or cancelled, runs the tail and frames `turn.tail`
  and `turn.tail_end`; a press or audio ends it (ruling 2, choice 7); under
  automatic turns the keys send nothing. Deltas become segments (Task 5), each
  delta framed with its `elapsedMs` (ruling 6); content audio plays on a
  speaking leg at 24 kHz and holds the translation either way (choices 5, 16);
  a heartbeat is nothing at all. A mid-session `error` is framed and
  remembered: a close — the socket's, or the server's `session.closed` —
  within `ERROR_WORDS_MS` (10 s) fails the run with its code and words (ruling
  3; choice 9); otherwise an unexpected close fails with `connection_lost` and
  `session.closed` closes the run (ruling 13). Two unreadable latches, the
  frame's and the audio's (choice 17). The harness `startTranslate` /
  `liveTranslate` joins the fixtures; the session-side guard walks the folder
  (`adapter.ts`, `segments.ts`, `socket.ts`, `tail.ts`, `wire.ts`); the kit's
  conformance scenarios pass, all but typed text and reconnecting, which
  Translate has neither of. The fix round: "Found during execution", items 2
  and 4.
- **The definition, registered fifth** (`670b9ac1`, Task 10; rulings 1, 4, 5,
  11, 12, 15): `provider.ts` — the old id and slice (`openaiTranslate`),
  `platforms: ['electron', 'extension', 'web']`, the OpenAI icon and guide,
  `speech: 'optional'`, `textInput: false`, `boundaries: 'silence'`, both turn
  modes, no `participantSpeech` and no `flagged`; `RELEASED` gains
  `openaiTranslateProvider` before `sonioxProvider`, pinned at
  `registry.test.ts:293` and in `providerPaths.test.ts` (`['gemini',
  'volcengine_ast2', 'openai_translate', 'soniox', 'fake']`), whose fit case
  now expects Translate not greyed for the subtitles-only scenario; Doubao's
  order case narrowed to "sits after Gemini (ruling 5)". Its own cases: the
  participant speaks into the pair's source on its switch; Both refused before
  anything opens for a source-only language (D20); an old profile — the key,
  the pair, the noise reduction and a `webrtc` choice — loads as it was, with
  nothing written.

**F14.** OpenAI Translate is not a header user (ruling 16): F14 stays OpenAI
Live's, and Translate's own `socket.ts`, which takes protocols, moves to
`src/lib/contract/` with Soniox's, Gemini's and Doubao's when F14 lands. When
it does, its Electron rule should scope by path (the spec's amendment 10): the
rule is per host and one-shot today (`electron/main.js:1113-1133`), so a stale
Live rule for `api.openai.com` would reach a Translate upgrade.

**The spec's amendments** (this record's commit), the plan's thirteen, each at
its anchor:
1. "The session request": D20 now refuses a Both start whose source is outside
   the thirteen targets, where the old guard ran the speaker alone.
2. "Turns": Translate's row, split from OpenAI Live's — no commit and no server
   VAD, the release tail, and, as landed, its ends counted in beats ("Found
   during execution", item 1) — and its design row: a press ends a running
   tail, and `cancelTurn` sends the same tail (choice 7).
3. "Coverage": Translate's push-to-talk lands with this plan, over WebSocket;
   its Kizuna twin is deleted, not ported.
4. "The provider definition": `speech: 'optional'` for a provider whose API
   cannot stop speaking (ruling 4).
5. "`start` owns the transport": WebSocket only, `transportType` in `S`,
   `C.transport` `'websocket'` (ruling 1).
6. "Provider capability": Translate's karaoke by arrival and its pairing by
   proximity with `elapsed_ms` framed; Translate the third provider whose
   origins L2 infers.
7. "Risks": the arrival ranges, the one stated exception to the honesty rule.
8. "L2 — the projection": F16's window holds for untimed pairs; the first
   provider to emit `timing` sets it once, at segment close, and extends F16 to
   a timed window first.
9. "Segmentation is one fact": `'silence'` on both transports through one
   segment machine (choice 4), replacing "OpenAI Translate over WebRTC has no
   source pause today".
10. "Sockets that need upgrade headers": the subprotocol key, no seam, the
    fixed words and the redaction; the seam's Electron rule to scope by path.
11. "What adding a provider then touches": no manifest change for Translate
    (`manifest.json:38, 116`).
12. "What every adapter must honour": Translate needs no `logStore` row.
13. "Migration": T3 waits for the WebRTC step's live test; item 5 ported over
    WebSocket, its WebRTC transport item 7; the relay twin deleted, not ported,
    and the count "two relay twins, both deleted".

**Checked — the gates.** Every implementer ran the suite and the typecheck gate
on its own commit. In the parallel waves a failure or an extra gate line in
another task's uncommitted files was named and left to it: Task 2 saw failures
only in Task 1's work in progress and extra gate lines only in Task 3's; Task 8
saw failures only in Tasks 5's and 7's. Tasks 4, 5, 6 and 7 met test timeouts
under Wave 2's load (a load average of 84 at one point) — in
`kizunaProviderGating`, `providerOrder` and `spine.e2e` among others — which
passed re-run alone; the reviews of Tasks 4 and 5 confirmed they could not come
from those tasks' files, which nothing but their own tests imported yet. The controller's full gate after Wave 2, with no concurrent
load, at `580bd8cd`: 536 files passed and 1 skipped, 6,805 tests passed and 2
skipped, 0 failed, no unhandled errors — the plan's own after-Wave-2 figure —
and the gate at its baseline; the timeouts did not recur. The suite grew from
527 files passed and 1 skipped, 6,730 tests passed and 2 skipped at `8db4261f`,
to 538 files passed and 1 skipped, 6,859 tests passed and 2 skipped at
`426251e1` — the plan's 6,853 and six cases the fix rounds added — 0 failed, no
unhandled errors; the gate — the AST2 plan's regex, unwidened — at its 20 lines
throughout, and the full tree at 259.

**Checked — group check A** (at `f2c91d1f`, with Task 9's `49727661` in review;
nothing registered yet):
1. the suite: 537 files passed and 1 skipped, 6,850 tests passed and 2 skipped,
   0 failed, no unhandled errors; the gate at its baseline;
2. `src/services` and `src/components/Settings`: 112 files, 1,802 tests passed —
   the old Translate code untouched;
3. `npm run build` and `npm run extension:build`; the three D24 greps empty;
   `turn.tail_end` in neither bundle, as expected before the registration;
   `npx vitest run extension` (7 files, 45 tests);
4. the full tree's typecheck: 259 lines, the bound;
5. a fresh vite: the six spine probes and `app-panel-probe` (`--preview`,
   `--preview --settings`) — all pass; the audio probe's one 3.5 s gap is the
   fake script's own pause, as in the AST2 run.

**Checked — group check B** (at `426251e1`):
1. the suite: 538 files passed and 1 skipped, 6,859 tests passed and 2 skipped,
   0 failed, no unhandled errors; the gate at its baseline; the full tree's
   typecheck at 259;
2. `npm run build` and `npm run extension:build`, the three D24 greps empty;
   `turn.tail_end`, a frame only the new adapter emits, is in
   `build/static/index-C4SImiAp.js` and `extension/dist/fullpage.js` — the
   adapter ships in both bundles, neither fake does; `npx vitest run extension`
   (45 tests);
3. every probe on a fresh vite, restarted after Task 10 and Task 9's fix round:
   the six spine probes, `app-panel-probe` (`--preview`, `--preview
   --settings`, `--app`, `--app --settings`), `extension-overlay-probe` (plain
   and `--ptt`) — all pass;
4. **Translate's Provider tab, rendered**, with 0 requests to `api.openai.com`
   in both layouts: advanced — "OpenAI Translate" with the OpenAI icon and the
   "Setup guide" link to `https://sokuji.kizuna.ai/docs/tutorials/openai-setup`,
   one API key row, the info banner, then "Noise reduction" (None / Near field
   / Far field, None selected), and no model, transcript-model or transport
   control; simple — the picker and the key row only. The banner's and the
   noise section's classes are identical to the old tab's
   (`ProviderSpecificSettings.tsx:2173-2183`, `:807-840`); the one markup delta
   is the select's `aria-label` (choice 13). Screenshots
   `oat-tab-advanced-full.png`, `oat-tab-simple-full.png`;
5. **the languages and Text only** (in the simple layout: the advanced preview
   has no language section): 74 sources, no "auto"; 13 targets for English and
   for Thai; English → English selectable; the swap disabled for Thai →
   English; the Text Only switch shown for Translate, and toggling it on and
   off changed the switch alone — the language selects' snapshot
   byte-identical — with 0 requests to OpenAI. That on a live leg it changes
   playback and nothing else is the adapter suite's case (Task 9): the preview
   cannot run Translate without the network;
6. **the gate's words:** `/?preview=spine&panel=1&provider=openai_translate` —
   ▶ Start disabled, "Enter your API key in Settings before starting." (its
   title, and the credential field's own validation line), 0 requests to
   OpenAI. D20's refusal for a source-only language in Both is Task 10's case:
   the web preview refuses Both earlier, for its missing participant source;
7. **the wizard** on a fresh profile: the own-key list "Google Gemini | Doubao
   AST 2.0 | OpenAI Translate | Soniox" (and the development-only fake);
   OpenAI Translate not greyed under the subtitles-only scenario ("Subtitle my
   own speech"), ruling 4's departure — though no registered provider declares
   `speech: 'always'`, so none is greyed there today; its credential step one
   API key field and "How to get this key" to the OpenAI guide — never filled,
   never validated, 0 requests to OpenAI. Screenshots `oat-wizard-path.png`,
   `oat-wizard-credentials.png`;
8. the Logs' grouping: `logStore.test.ts` (Task 1) is the evidence; no live
   frame exists before the owner's test.

**Found during execution** — what execution changed or found beyond the plan,
each from a controller's ruling in the ledger, with its reason and where it
lives:
1. **The release tail's two ends count 200 ms beats, not wall-clock time** (Task
   6's review, I1, which amended the plan's Task 6 Step 3; `b4b83f67`, its
   comments `f2c91d1f`). Each tick counts a beat first; the tail ends `quiet`
   when `beats − lastOutputBeat > TAIL_QUIET_MS / FRAME_MS` (more than 5) and
   `cap` when `beats > TAIL_MAX_MS / FRAME_MS` (more than 15). `releasedAt` and
   `lastOutputAt` feed only the summary's `lastOutputMs`, and `silenceMs` is the
   frames sent times 200. Why: the plan compared `clock.now()` differences with
   thresholds that sit exactly on the 200 ms grid, so a timer read 1 ms late or
   more ended the quiet a beat early — 4 frames (800 ms) where ruling 2 fixed 5,
   and 14 where it fixed 15 at the cap — and a wall clock stepped backwards made
   the difference negative for good, so the tail never ended: 302 frames in a
   minute, and no `turn.tail_end`. On an exact clock both rules end at the same
   beat, for output before, at or between beats, so the adapter's cases on the
   virtual clock were unaffected (the controller's check by hand, confirmed by
   the re-review for every ordering the adapter produces; an output delivered
   before a tick of the same instant ends a beat early, which the adapter never
   does, and which still leaves at least 1 s of quiet). The second round
   corrected two comments: the test's reason had run backwards (a late tick
   reads more — 1,001 ms at beat 5 — not less), and the header overstated what
   a timer's read can be. Lives in `src/providers/openai_translate/tail.ts`;
   `tail.test.ts` pins a timer firing 1 ms and 3 ms late (five frames, fifteen
   at the cap) and a clock stepped back an hour mid-tail (five frames, no timer
   left).
2. **An audio delta with no base64 string is unreadable audio** (Task 9's
   review, m2; `426251e1`). A `session.output_audio.delta` whose `delta` is
   missing or not a string now goes through the audio episode of choice 17 — a
   `session.unreadable` frame and `parse_error` on the ok → failing transition,
   in fixed words ("an audio delta with no base64 string") that quote nothing
   of the frame — where the plan's adapter dropped it without a trace. Why: it
   was the only server payload swallowed silently. A well-formed delta is
   unchanged, and audio that decodes ends the episode. Lives in `adapter.ts`,
   with its case in `adapter.test.ts`.
3. **The key scan counts every reader** (Task 4's review, M1; `bbf16f39`).
   `wire.test.ts`' TypeScript-AST scan, which pins `translateProtocols` as the
   one function in `wire.ts` that reads the key, now also flags a string
   literal naming the key or its type (an indexed read) and any reference to
   `translateProtocols` outside its own declaration (a forwarded call), beside
   the named identifiers; both evasions join the scan's in-test controls, and
   the real file still scans to `['translateProtocols']`. Why: an
   identifier-only scan missed both. The same round: `configFor`, the fixtures'
   builder, throws on a refusal instead of casting it away (M2), so a refused
   target fails loudly in the suites that use it, and `SERVER.audio` passes an
   explicit null `elapsed` through (M3), as `input` and `output` do. Lives in
   `wire.test.ts` and `testing.ts`.
4. **Test pins the reviews added, with no change in behaviour.** In
   `adapter.test.ts` (Task 9's review, I1 and m1, m3; `426251e1`): a heartbeat
   during a tail never marks it (ruling 2); `sent` counts the pad and the
   silence, so a second release pads 2,752 samples and everything sent stays on
   the 200 ms grid; a leg that does not speak keeps its translation open on its
   audio (no `segmentClosed` at 1,000 ms; ruling 4, choice 5); audio at a rate
   the app does not play still marks the tail (choices 7, 16); the start's two
   refusals after the socket opened — the server's `session.closed` and the
   bound — close the socket (choice 2). In `segments.test.ts` (Task 5's review,
   M1, M2; `e6af8d8f`): `stop()` cancels both sides' timers, and a closed
   side's mid-sentence deferral resets, so the next segment gets its own window.
   In `tail.test.ts` (Task 6's review, M1; `b4b83f67`): an `'audio'` ending
   leaves no timer and sends nothing after, and `running` is false after a stop
   and a cancel. The adapter's and the segments' new cases were each shown to
   bite: a mutant passed the committed suite and failed the new case at its own
   assertion.
5. **No proof file in the tree** (the controller's ruling during Task 6's fix
   round). The implementer had proved the pre-fix failure with a temporary
   harness inside `src/`; it was deleted unstaged, the tree verified clean, and
   the implementer told not to repeat it — the plan's rule that no task mutates
   the tree to prove a guard. Lives in the execution's rules.
6. **`recentError()` treats a negative age as recent no longer** (the final
   review, Minor 5; ruling 3, choice 9). A wall clock stepped backwards after a
   mid-session `error` made `now() − at` negative on the old raw check, which
   read as "recent" forever, so a close an hour or more later still read in
   that stale error's words. The guard now reads `age = now() − at` and refuses
   both `age < 0` and `age > ERROR_WORDS_MS`. The same `Date.now()` failure
   class as item 1's beat-counted tail, on the error window rather than the
   release tail. Lives in `adapter.ts`; `adapter.test.ts` pins a wall clock
   stepped back an hour after an error, then a close, reading as
   `connection_lost`, not the error.

**Accepted as they stand** (the controller's rulings, each with its cost if
wrong):
- **Task 4, M4:** `pcmToBase64` and `base64ToPcm` are copies of Gemini's
  (choice 8), their provenance cited; lifted at the third user ("What it
  leaves"). Cost: two copies until then.
- **Task 4, M6:** the suite's `Not implemented: window.open` stderr comes from
  `ChildWindowPopover`, pre-existing, not this plan's files. Cost: none.
- **Task 7, M2:** a 200 whose body is not JSON rethrows through the check's
  catch — not ready, Start off — which is choice 11's "what says nothing about
  the key throws"; no case pins it, the test file being the plan's verbatim.
  Cost: an untested path that already behaves.
- **Group check B:** the noise select's `aria-label` is the one markup delta
  from the old tab, as choice 13 intends; the language swap button has no
  accessible name beyond its native `title`
  (`src/components/providers/LanguagePairSection.tsx:83-91`), pre-existing,
  shared and not this plan's — for the final review's out-of-scope list. Cost:
  none new.

**Stated departures from today** (the plan's self-review list, as landed; what
execution added is marked):
- Text only is offered (ruling 4): the switch shows, and a leg that does not speak drops the audio the API still sends; the wizard's subtitles-only scenario offers Translate, where the old greyed it;
- push-to-talk and push-to-translate are offered (the spec's coverage), with the release tail (ruling 2) — the old provider offered automatic turns only. **As landed**, the tail's two ends count 200 ms beats ("Found during execution", item 1);
- the participant speaks when its switch is on (ruling 5; the old participant dropped its audio);
- a source-only language refuses Both at start, in words (D20, D22), where the old guard skipped the participant and ran the speaker alone under a warning line;
- the model select, the transcript select and the transport toggle are gone (rulings 7, 8, 1); a stored `webrtc` runs over WebSocket (ruling 1); noise reduction "None" sends `null` (ruling 9); no OpenAI-key prefill (ruling 10); a Text only switch left on under another provider now silences Translate, where it was ignored (ruling 4);
- the start waits for `session.updated`, is bounded on the request's clock with the socket closed on every path, and a close before the session starts rejects at once (choices 1, 2; the old hung 30 s and left its socket open);
- a mid-session `error` is a Logs line, not two bubbles, and a close within `ERROR_WORDS_MS` of it — the socket's or the server's — says its words (ruling 3; choice 9); an unexpected close ends the run in words, where the old tore it down silently (ruling 13);
- the check is bounded and throws on a status the key does not explain or a failed fetch, where the old called every failure an invalid key; a region and a missing model are their own codes (choice 11);
- the key is trimmed (choice 14);
- appends are no longer framed; delta frames carry `elapsedMs`; heartbeats stay unframed (choice 12); an odd audio byte no longer throws (choice 8); a foreign output rate is skipped and said once (choice 16). **As landed**, an audio delta with no base64 string is said as unreadable audio, once per episode ("Found during execution", item 2).

Where the plan departs from its survey, and from its brief, stays in the plan's
self-review.

**Before any release from the branch**
- **The owner's live test below**, before T2 deletes the relay twin and before
  any release that carries OpenAI Translate.
- **The registry's order** is now `['kizunaai_soniox', 'localInference',
  'gemini', 'volcengine_ast2', 'openai_translate', 'soniox']` (ruling 11;
  `src/providers/registry.ts:19`, pinned at `registry.test.ts:293`), Translate
  unflagged under D19's model.
- **The wizard's own-key description** (`setup.paths.own-key.desc`): its
  "OpenAI" is now partly true — Translate is ported, OpenAI Realtime and OpenAI
  Live are not.
- **At Stage 2's end**, `VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE` joins the
  release-flag cleanup (`build.yml:223, 277, 317, 419, 521`,
  `extension/vite.config.ts:173-174`), with T2.
- **The Text only tooltip** (`simpleConfig.textOnlyDesc`; en "Translate to text
  only — no spoken audio output") is true of Translate's playback control in 28
  catalogs; zh_CN's "不生成语音" and zh_TW's "不產生語音" ("no speech
  generated") are not — the owner's call (an open question below). **The final
  fix wave (Minor 6):** the participant-only tooltip
  (`simpleConfig.textOnlyForcedByMode`; en "…never generates audio",
  `SpeechSection.tsx:172-180`) is untrue for Translate too — its API generates
  and bills audio on the participant leg (ruling 4), and that leg speaks aloud
  with participant speech on (ruling 5) — but this predates the plan: stale
  since the 2026-09-06 participant-speech opt-in, for Gemini and Doubao as
  well.

**The owner's live test** (survey §2.14's list, adjusted to the rulings; what
execution added is marked). Switch diagnostic logs on in Help **before Start**,
so the Logs record from the first frame; each item names what to look for there
— above all `session.error`, `turn.tail`, `turn.tail_end` and the three delta
frames with their `elapsedMs`:
1. **The key and the check, on Electron, the extension's side panel and the web** (rulings 16, 18; choice 11): a valid key → Validate ✓; a key without translate access → "API key works, but gpt-realtime-translate is not accessible with this key."; a wrong key → "The provider did not accept the credentials: HTTP 401: …"; an unsupported region, if reachable → the region sentence ("Service not available in your region. …"); offline → not ready, Start off, no words about the key. Record any 429 met, and its words. **Execution (Task 4's review, M5):** record whether the wrong key's words quote the key's last four characters (OpenAI's message says `sk-proj-****6789`): the check passes OpenAI's message verbatim, and `redact()`'s bare `sk-` rule does not mask a key already masked (an open question below). **The final fix wave (Recommendation 2):** a restricted project key — Models "None", Realtime "Write" — is expected to answer the check's `/v1/models` with 403 (a missing `api.model.read` scope): the auth words, Start off, though the session might run over the socket, which never calls `/v1/models` (parity with the old validation). Record whether such keys are common among users.
2. **The socket on all three platforms** (ruling 16; choice 2): it opens with the subprotocol; no key in the Logs or the Logs' export. **Record what a revoked key does at the upgrade** — a refused upgrade (the start then reads "The connection to the provider failed: OpenAI's socket did not open (check the network, and that the API key is still valid)."), or an accepted one followed by an `error` event (then its words, and the `session.error` frame's `type`, `code` and `message`) — and whether DevTools' own console prints the subprotocol.
3. **The session's configuration** (choice 1; ruling 9): record `session.created`'s `audio` (is noise reduction on by default? transcription?) and `expiresAt`; `session.updated` arrives, with `noise_reduction: null` for "None" and the type for the other two; the start resolves on it. If `session.updated` never arrives, every start times out with "OpenAI did not start the session within 30 s."; the fallback is to resolve on `session.created` once `session.update` is sent (`created()`: set `live` and settle).
4. **Automatic turns, one leg**, several pairs (en → zh, ja → en, and a source-only language → en, e.g. th → en): rows cut by pause on each side; the translation's audio once on the monitor and once in the virtual microphone; replay per translation row with keep-audio on; karaoke per frame, **side by side with the old build** (ruling 6's arrival ranges).
5. **Text only** (ruling 4): with it on, no audio on the monitor or in the virtual microphone, and the same rows as with it off; the Logs still show `session.output_audio.delta` frames (the API sends, and bills, the audio). Record how the switch's tooltip reads against that, in en and in zh_CN, and in participant-only mode, with participant speech on and off.
6. **The `elapsedMs` evidence for the timing follow-up** (ruling 6): diagnostic logs on before Start; export right after the utterances (a group keeps its newest 100 events, `MAX_EVENTS_PER_GROUP`; the panel its newest 2,000 entries). Export the Logs over several utterances, speaking and silent, under automatic turns and push-to-talk. Record, for the source deltas (`session.input_transcript.delta`), the translation deltas (`session.output_transcript.delta`) and the audio deltas (`session.output_audio.delta`): one timeline or several; monotonic or not; jumps across silence and across presses (model time or wall clock); absent or null on any; the audio frame's length (`samples`) against the 200 ms steps; whether a translation's value is its source's time or later by a lag; whether text and audio with the same value are the same words. And whether any `.done` event ever arrives (choice 18). **Execution (Task 5's review, M3):** if a `session.output_transcript.done` arrives, record whether it came before its utterance's last `session.output_audio.delta`: that trailing audio opens a text-less translation row, which the next utterance's text then joins (parity with the old client; an open question below). **Execution (Task 9's review, m2):** a `session.unreadable` frame means a frame, or an audio delta, did not read; record its `message` if one appears.
7. **Same-language speech:** speaking the target language → silence, rows empty; mixed-language speech → gaps.
8. **Push-to-talk and push-to-translate** (ruling 2; choice 7): a short press → the last words translated after the release. Over twenty or so presses, record `turn.tail` (`padSamples`) and `turn.tail_end` (`reason`, `silenceMs`, `lastOutputMs`): whether the last words come out before the tail ends (`quiet`, with `lastOutputMs` well inside `silenceMs`), or are cut by the cap (`cap`), or come out only at the next press — which tunes `TAIL_QUIET_MS` and `TAIL_MAX_MS`. **As landed** ("Found during execution", item 1), `silenceMs` counts the frames sent — 1000 is five, 3000 the cap's fifteen — while `lastOutputMs` is wall time from the release; a `turn.tail_end` entry lands about `silenceMs` + 200 ms after its `turn.tail`. Record any tail whose two entries' times lie seconds further apart than that, and on which platform: the tail's ends count frames, so a stalled or throttled timer stretches it in wall time (an open question below). A press with no speech → a tail with `cancelled: true`; record whether anything shows. A second press during a tail → `reason: 'press'`. Record whether `session.input_transcript.delta` frames arrive after a tail ended `quiet` with `lastOutputMs: null` — the model still consuming the press while no translation came yet. Minutes idle between presses → the session survives (a dropped session, or a tail that never ends, is the keepalive question). Push-to-translate routes the raw voice while the key is up.
9. **Muted for 5+ minutes under automatic turns:** the session survives? Muting mid-sentence stops the audio as a release does, with no tail: record whether the last words wait until the microphone comes back (ruling 2: no keepalive yet).
10. **Heartbeats:** between utterances, while the API sends its all-zero heartbeat frames, nothing plays and no `session.output_audio.delta` frame appears in the Logs; heartbeats add no rows; interleaved deltas still make one row per run of a type.
11. **A long session** (ruling 13): 60 minutes or more. Record what happens at `expiresAt` — a `session.closed` (the run ends: "The provider ended the session.") or a close code (the connection-lost words, and a `session.connection_lost` frame with its `code` and `reason`) — and when.
12. **Errors mid-session** (ruling 3; choice 9): a network drop → the connection-lost words, the run ended. Any mid-session `error`: its `session.error` frame's `type`, `code` and `message`, and whether a `session.closed` or a close follows an `error`, and after how long (tunes `ERROR_WORDS_MS`); a close within 10 s of an error reads with that error's words (`invalid_api_key` → the auth words, a quota error → the rate-limit words), one later with the connection-lost words after a socket close, or "The provider ended the session." after a `session.closed`. **Execution (Task 4's review, M5):** record whether an `invalid_api_key` error's `message` quotes the key's last four characters: those words reach the notice and the frame verbatim. **The final fix wave (Minors 1, 2; Recommendation 2):** ask for both kinds of drop — Wi-Fi off, which should give the connection-lost words within seconds, and separately the router's upstream pulled with Wi-Fi still up, which may leave the socket OPEN for minutes with appends still queueing and nothing translated — and record the time until the words appear for each. Count `session.error` frames per minute: a repeating error floods the Logs with no output and no words.
13. **Both, with participant speech** (ruling 5): two sockets; the participant translated into the speaker's source; its switch on → heard on the real device; off → silent; a source-only speaker language (th → en) refuses Start with "This provider can't translate the other participants for this language pair."; either leg ending ends both; participant-only. Record whether two sessions on one key are allowed.
14. **Stop mid-utterance:** rows finalized; nothing plays after Stop; the untranslated remainder is dropped (parity).
15. **An old profile** (rulings 1, 8, 10): key, pair, noise reduction and `transportType: 'webrtc'` saved by an earlier build → ready without re-entry; the session runs over WebSocket (`translation_session_start.transport` reads `websocket`); a stored `gpt-realtime-whisper` changes nothing. A fresh profile that holds an OpenAI Realtime key → Translate asks for its own (no prefill). A profile with Text only left on under another provider → Translate silent, the switch shown on.
16. **The wizard:** the own-key list shows OpenAI Translate between Doubao AST 2.0 and Soniox; its key step validates; the subtitles-only scenario offers it.
17. **Analytics:** `translation_session_start` with `provider: 'openai_translate'`, the translation model `gpt-realtime-translate` and the ASR model `gpt-live-transcribe` (choice 10); a refused start → `api_error` with its code.
18. **The Logs panel:** the frames grouped by type when consecutive, `session.error` red, the server's `session.closed` drawing the separator; no key anywhere, the export included; no `session.unreadable` in a healthy session.
19. **The extension side panel's core flows:** Validate ✓ and a session that starts and translates in the side panel — the check's fetch and the socket under the extension's CSP; no CSP error in the side panel's DevTools console.

**Open questions for the owner**
- The tail's constants (item 8), and a keepalive while idle or muted (items 8, 9): ruling 2 defers the keepalive until a dropped session or a stuck tail shows.
- **A no-server-frame watchdog** (item 12; Minor 2): if the router-upstream drop leaves the socket OPEN for minutes with no server frame arriving while appends keep queueing, a follow-up could end the run as `connection_lost` after N s with no server frame while appends continue — the adapter already sees every server frame, heartbeats included, so the watchdog is nearly free. Decided by item 12's two-drop measurement.
- Count a source delta during the tail as activity (item 8)? Ruling 2 names the translation's output, and the plan counts that alone.
- **The tail's ends count frames sent, not wall time** (Task 6's re-review; item 8). Ruling 2's reason is model time, so under a stalled or throttled main thread the tail can outlast 1 s or 3 s of wall time while still sending exactly five or fifteen frames. Electron turns background throttling off (`electron/main.js:397`); the extension's side panel does not. `lastOutputMs` is wall time and diagnostic only: across a clock step it can read negative or huge.
- Timing and F16's timed window, and karaoke by `elapsed_ms` (item 6; ruling 6): the follow-up in "What it leaves".
- Heartbeats' `elapsed_ms` is unobserved (research Q3, unknown 4): a heartbeat is not a delta, and stays unframed; model time against the wall clock is settled by push-to-talk gaps (item 6).
- **A `.done` before the last audio** (Task 5's review, M3; item 6): if `session.output_transcript.done` ever precedes its utterance's last audio, that audio opens a text-less translation segment, which the next utterance's text joins — parity with the old client; the survey expects the `.done` events are never sent.
- A socket that fails before it opens reads as the network with the key named (item 2; choice 2): a revoked key's upgrade may deserve its own words.
- The Text only tooltip (item 5): zh_CN's and zh_TW's "no speech generated" are untrue for Translate, whose audio is generated and billed; rewording those two to "no speech output" would be true of every provider, and a Translate-specific wording would be a new key in 30 catalogs. The participant-only tooltip (`simpleConfig.textOnlyForcedByMode`) is untrue for Translate too, twice over — its audio is billed and, with participant speech on, spoken ("Before any release", above) — though that predates this plan.
- Expiry and drops end the run (item 11; ruling 13): a fresh session, or a reconnect, if the long session shows a fixed length.
- `session.close` at Stop for a graceful flush of the untranslated remainder (item 14): it needs an awaited `session.closed`, which the stop rule forbids.
- A mid-session `error` never ends the run by itself (item 12; ruling 3): whether any code should — item 12's per-minute count is the evidence. **The final fix wave (Recommendation 2):** if the service ever answers every append with an `error`, the cheapest amendment is one `degraded` on the first error of an episode, which the hot-path rule already allows.
- The error-code mapping and `ERROR_WORDS_MS` (choice 9), hypotheses until item 12's frames.
- **OpenAI's own words reach the notices and the frames verbatim** (Task 4's review, M5; items 1, 12): `errorWords` passes a server `error`'s message into the notice's detail and the `session.error` frame, and the check passes a refusal's message into its reason. OpenAI's `invalid_api_key` message quotes a masked key with its last four characters visible (`sk-proj-****6789`), which the bare `sk-` rule does not mask. Parity with the old client and its check; decide with choice 9's mapping once item 12's frames are in.
- **A restricted project key's fallback** (item 1; Recommendation 2): if such keys prove common, the check could fall back to "unknown, allow Start" on a 403 whose message names a missing scope, rather than reading as a wrong key.
- Source-only languages offered where the gate refuses Both (item 13): the old app warned under the picker (`settings.translateSourceParticipantWarning`, now unused) — the shape of the AST2 section's dialect question; filter the sources by reverse support while the participant leg opens, or accept it.
- One speech entry per 200 ms frame (about five a second) in L1 and the clip queue over a long session (survey §3.4): the retention ceiling bounds the pcm, not the entry count.
- A translation spanning two source segments pairs with one (the sides' pauses differ): legal, and visible (item 4).
- Analytics for `degraded` (Plan A's open question, unchanged).

**T2's inventory** — the relay twin's deletion, after this port's live test
(ruling 14; survey §3.5; lines read at `8db4261f`, and none of these files
changed through `426251e1`):
- `src/services/providers/KizunaAIOpenAITranslateProviderConfig.ts`;
- `ProviderConfigFactory.ts:9` (its import), `:17` (`isKizunaOpenAITranslateEnabled` in the environment import), `:39-42` (its registration), `:159-166` (`getDefaultManagedProvider`'s entry);
- `Provider.KIZUNA_AI_OPENAI_TRANSLATE` and the managed helpers' cases (`src/types/Provider.ts:12, 27, 48, 53, 59`);
- `isKizunaOpenAITranslateEnabled` (`src/utils/environment.ts:222-228`), its forwarding (`extension/vite.config.ts:173-174`), `build.yml:223, 277, 317, 419, 521` (with the release-flag cleanup at Stage 2's end);
- `KIZUNA_HOSTED_ICONS`' entry (`src/components/Icons/ProviderIcons.tsx:279`);
- the `kizunaOpenaiTranslate` slice of `settingsStore.ts` (`:62, 293, 423, 662, 708, 975`, the twin's half of the loop at `:1349`, `:1543, 1627`) — the storage keys stay;
- the old UI's twin branches: `ProviderSpecificSettings.tsx:135, 177-184, 397-398`; `LanguageSection.tsx:158-160, 252-254`;
- `providers.kizunaai_openai_translate.*` in 30 catalogs;
- the old test tables naming it (`descriptorRegistry`, `kizunaProviderGating`, `providerOrder`, `participantConfig`, `speechMode`, `sessionResourcesWiring`, `voicePrepWiring`, `prepareToStart.{local,kizunaSoniox}`, `localNativeGating`, `ClientFactory`, `ClientOperations`, `settingsStore.{test,sliceRegistry,kizunaAuth}`, `kizunaProviders`, `ProviderIcons`, `SetupWizard`, `StepCredentials`, `providerPath(s)`, `Provider.test` — survey §3.5);
- once both twins are gone (AST2's goes with V2): `getRelayWsUrl` (`src/utils/environment.ts:144`, its test and some fifteen test mocks) and the `sokuji-auth.` redaction rule have no producer left — delete, or keep the rule as a net;
- **keep:** `LEGACY_SLICE_KEYS.kizunaai_openai_translate` and `MANAGED_LEGACY_IDS` (`src/lib/session/storedSettings.ts:38, 64`): a stored selection of the twin falls back to Kizuna Soniox. The GA client's `relay` argument and `sokuji-auth.` branch go with T3.

**T3's inventory** — the own-key old code of both transports, **after the
WebRTC step's live test**, since the WebRTC client imports the GA client
(`OpenAITranslateWebRTCClient.ts:38`, for its `buildSessionUpdate` and
`computeRms`; ruling 14). **2026-09-29:** after the WebSocket live tests instead — the owner abandoned the WebRTC step, and both clients go together:
- `OpenAITranslateGAClient.ts` (+ test), `OpenAITranslateWebRTCClient.ts` (+ test), `OpenAITranslateProviderConfig.ts`;
- `IClient.ts:117-139, 333-335` (`TranslateTargetLanguage`, `OpenAITranslateSessionConfig`, its guard);
- `EphemeralTokenService.ts:115-218` (the translation mint), unless the WebRTC step has moved it into its own folder — not `getToken`, which OpenAI Realtime's old WebRTC client uses (2026-09-29: no WebRTC step; the whole file goes with the merged deletion);
- the `openaiTranslate` slice of `settingsStore.ts` (`:41-43, 289, 419, 548-554, 655, 704, 753-773, 971, 1192-1196, 1349-1352, 1539, 1553-1557, 1623`) — the storage keys stay;
- the old UI's Translate branches: `ProviderSpecificSettings.tsx:129-184, 384-467, 722-954, 2173-2187, 2274-2280`; `LanguageSection.tsx:99, 154-160, 249-254, 331-364, 587, 673-678`; `ProviderSection.tsx:73, 478-479`;
- `ProviderConfigFactory.ts:6, 63`; `OpenAIClient.isTranslateRealtimeModel` once the OpenAI port has replaced `OpenAIClient`; `openaiModelMigration.test.ts:50-74`;
- the orphan keys: `settings.translateModelAvailable`, `settings.translateSourceParticipantWarning`, and `settings.userTranscriptModel` / `settings.transcriptModelTooltip` only if OpenAI Realtime's port does not reuse them. It does (its `TranscriptionField`): those two stay (the Stage 2 OpenAI Realtime record, below).

**The roadmap's inheritance, item by item** (the plan's tables, as landed):
taken (and where), deferred (and why), or already done.

From "Scheduled by the Stage 2 foundation plan" (`:1289`, `:1292`, `:1304`
above):

| Item | Disposition |
|---|---|
| OpenAI Translate: F16 if AST2 did not land it | done by the Gemini plan (its Task 2); consumed through `createProjector` (Task 9's projection case) |
| OpenAI Translate: the noise field | built here: `NoiseReductionField` (Task 2); OpenAI Realtime and Compatible reuse it |
| OpenAI Translate: the transcript field | not built: the transcript model is a constant (ruling 8); OpenAI Realtime's port builds one if its models need it |
| OpenAI Translate: the transport field | deferred to the WebRTC step (ruling 1): `S.transportType` kept, `C.transport` its attachment point (choice 15); a shared `TransportField`, perhaps OpenAI Realtime's first. **Closed 2026-09-29:** no transport to choose (the owner abandoned WebRTC); `S.transportType` removed |
| OpenAI + Compatible: F15, "unless Translate-WebRTC comes first" | not here: this port is WebSocket; the WebRTC step meets it. **Closed 2026-09-29** with the WebRTC step |
| OpenAI Live: F14 (reused) | unchanged: Translate needs no header (ruling 16); the seam's per-host Electron rule should scope by path (the spec's amendment 10) |

From the Soniox plan's "Found here" (`:1740-1747` above):

| Item | Disposition |
|---|---|
| Readiness re-probes on every settings edit | applies, cheaply: only the noise select can make one, and the model list is free and bounded |
| `timing` after a 503 resume | n/a: no timing, no resume |
| `audio.range` after fill-in | applies in form: ranges are measured against the text at arrival, and L1's fill-in re-anchors them; no `speechRanges` |
| The side latch | n/a: one leg per socket |
| Two TTS sockets per key in shared Both | its analogue, two sessions on one key in Both, is live-test item 13 |
| `Conversation.afterAudio`'s pending drop | n/a: no `speechRanges`, and no audio before its segment opens (`segments.audio` opens it first) |

From "Scheduled by the Stage 2 Gemini plan" (`:3005-3022`, `:3037-3093`
above):

| Item | Disposition |
|---|---|
| Live Translate's leading audio: open the translation segment on audio (open question) | Translate does, by parity (choice 5); its live test (item 4) is the first real evidence of that shape. Gemini's question stays Gemini's |
| Name the leg in `SessionContext` (open question) | n/a: Translate's legs differ by direction alone |
| The readiness re-check on each instruction edit | n/a: the endpoint takes no instructions (`OpenAITranslateProviderConfig.ts:103`) |
| `session.closed` on Stop | the same for Translate ("What it leaves") |
| The instructions of later ports | n/a |

From "Scheduled by the Stage 2 Volcengine AST2 plan" (`:3744-3835` above):

| Item | Disposition |
|---|---|
| F14's owner, OpenAI Live | unchanged: Translate's plain `socket.ts`, with protocols, moves to `src/lib/contract/` with the other three when F14 lands |
| Generic frame names grouped under Doubao's Logs keys (M6) | met: Translate names none of Doubao's rows; Task 1 pins it |
| A kit-wide "no ws(s) URL in a frame" rule | n/a: Translate's URL carries no credential, and no frame carries the protocols (Task 9's no-leak case) |
| Each check opens a real session | n/a: Translate's check is a free model list |
| Superseded checks are never aborted | applies, harmlessly: two overlapping model lists |
| Dialect sources offered where the gate refuses them | its analogue: 61 source-only languages are offered, and D20 refuses Both for them — an open question above |
| `trackedClock` in the kit; the seam's fixed words | consumed (Tasks 4, 5, 6, 9) |

"Before any release from the branch" (`:1751-1765`, `:2318-2343`, `:3697-3718`
above):
- The registry's order: extended by ruling 11, pinned in `registry.test.ts`.
- The wizard's own-key description: its "OpenAI" is partly true now (Translate); OpenAI Realtime and OpenAI Live wait for their ports.
- The relay twins: `kizunaai_openai_translate` deleted, not ported — T2 (ruling 14).
- The release-flag cleanup at Stage 2's end: `VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE` joins it, with T2.
- The native-speaker checks: none (no new key).

**Stage 2 items from the roadmap this plan does not take:** the kit's parked items (`{ flush: true }` after an awaited answer, `FakeSocket`'s close codes, the virtual clock's `pending()` count, manual-end's segment check); the account's compile-time narrowing; `RunnerDeps.replayAudio`'s guard; the notice-code namespace.

What it leaves, for the plans that meet it (the plan's own list, as written,
its references to Task 11's record read as this record; then the one item a
task review routed to it, last below):
- **T2**, the relay twin's deletion, after this port's live test (this record's inventory).
- **T3**, the own-key old code's deletion — both transports' clients, the descriptor, the translation mint, the slice's readers, the old UI's branches — after the WebRTC step's live test (this record's inventory). **Merged** by the Stage 2 OpenAI Realtime plan with OpenAI Realtime's and OpenAI Compatible's deletion (its ruling 20; its record's inventory, below). **2026-09-29:** after the two WebSocket live tests, the WebRTC step abandoned (owner).
- **The WebRTC step** — **abandoned 2026-09-29 (owner)**: none of what follows is built; the kit-level scenario is reassigned (the Stage 2 OpenAI Realtime record, "The owner's WebRTC decision"). As planned: a transport and a dispatch in `start`, its fallback the same request handed to the WebSocket adapter (spec "The session request"), `C.transport` widened from `S.transportType`, the transport control; `segments.ts`, `tail.ts`'s grid and `wire.ts`' session update stay as they are. **The final fix wave (Recommendation 3):** a kit-level seeded lifecycle scenario, in `src/lib/contract/testing/`, modelled on the final review's fuzz of this adapter — driving random lifecycles over `FakeSocket` on a tracked virtual clock the way `run.ts` drives an adapter (presses and releases under manual turns, streamed audio under automatic turns; every opening path — success, a drop, the 30 s bound, an abort, an `error`, `session.closed`, a close; live steps mixing chunk sizes, input/output/audio deltas, heartbeats, bad base64, `.done` and unknown types, unparsable frames, mid-session errors and clock advances) — and asserting across every run: every `turn.tail` on the 4,800-sample grid; `turn.tail_end` timed to `silenceMs + 200` ms; `silenceMs` never past 3,000; append-only text with none on a closed ref; audio ranges starting at the previous end; at most one `failed` or `closed`, nothing after it; no timer or socket handler left after any ending; and no key or subprotocol in any payload. It would pin the WebRTC transport to the same cross-module guarantees this port's own adapter suite pins one at a time, and a mutant with `this.tail.cancel()` dropped from `shutDown` shows it bites at once.
- **The timing follow-up** (ruling 6): if the live log shows one aligned timeline, set `timing` once, at segment close, and extend F16's window to timed pairs (by `startMs`), and consider karaoke by `elapsed_ms`; if the values are emission-time, first let L2 fall back to proximity when no timed candidate clears `minOverlap` (research Q3).
- **The tail's constants** tuned from the live test, and **a keepalive** only if it shows a dropped session or a stuck tail (ruling 2).
- **A fresh session or a reconnect at expiry**, if the long session shows a fixed length (ruling 13).
- **`session.closed` on Stop** is not emitted (the kit forbids emissions after stop), as for Soniox, Gemini and Doubao.
- **`pcmToBase64` / `base64ToPcm`** lifted to `src/lib/contract/` at their third user (choice 8; Task 4's review, M4). **Done** by the Stage 2 OpenAI Realtime plan (Task 1, `2f7c681d`): `src/lib/contract/pcm64.ts`, re-exported by both wires.
- **The owner's open questions** in this record, each with the live-test item that settles it.
- **A shared `boundedFetch` in `src/lib/`** at the next check that needs one — OpenAI Realtime's or Compatible's (Task 7's review, M1): the bounded-fetch skeleton — an `AbortController`, `timedOut`, the clock's bound, the caller's abort listener and one `finally` — now stands three times, in `soniox/`, `gemini/` and `openai_translate/check.ts`. **Done** by the Stage 2 OpenAI Realtime plan (Task 2, `bf2702ba`): `src/lib/provider/boundedFetch.ts`, the three checks run inside it.

## Scheduled by the Stage 2 OpenAI Realtime plan

The Stage 2 OpenAI Realtime plan
(`docs/superpowers/plans/2026-09-28-client-contract-stage2-openai-realtime.md`,
plan commit `61c98f7c`, written over `583df521`'s code) landed as the eighteen
commits `a8ff44b7` through `f9fe8747` on `worktree-client-contract-stage2`
(`61c98f7c..f9fe8747`: **+4,755 / −119 lines across 52 files**). Then this
record with the spec's amendments. It is Stage 2's sixth provider — **OpenAI
Realtime, a GPT Realtime dialogue model made a translator by its instructions,
with the user's own key** (`openai`) on the new session, over WebSocket: its
definition, settings, credentials, a bounded model-list check, builder, wire,
items paired by id, response queue, adapter with the drift anchor, and settings
view; and three generic pieces — the pcm base64 helpers lifted to
`src/lib/contract/pcm64.ts`, the bounded check request lifted to
`src/lib/provider/boundedFetch.ts`, and `Provider.checkReads`, a readiness check
that says what it reads. **OpenAI Compatible is retired, not ported** (ruling
1): nothing is registered for it, and a stored selection of it falls to the
first provider offered. The WebRTC transport was to join OpenAI Translate's
later WebRTC step (ruling 12); the owner abandoned both on 2026-09-29 ("The
owner's WebRTC decision", below). Deleting the old OpenAI and Compatible code
and the `openai-realtime-api` dependency is one later plan, merged with OpenAI
Translate's T3, after the two WebSocket live tests (ruling 20, as that
decision amends it; this record's inventory); until then the old clients, both
descriptors, the old settings UI's OpenAI and Compatible branches, the two
store slices and `EphemeralTokenService` stay compiled and unreachable. The
final review and its fix wave followed this record (`3c7284d9`, `538e9ea5`,
`eaaf8ead`, and this update): "Found during execution", items 9 and 10, and
the owner's decision. Twelve
implementation tasks ran in the plan's four waves — Tasks 1–5; Tasks 6–10;
Task 11; Task 12 — with group check A after the third and group check B after
the fourth. Wave 2 started while the reviews of Tasks 1, 2, 3 and 5 ran, Task 11
while the fix rounds of Tasks 6, 7 and 8 ran, and Task 12 while Task 11's fix
round ran, each on files the running work did not touch. Tasks 3, 5, 6, 7, 8
and 11 took one review fix round each; Tasks 1, 2, 4, 9, 10 and 12 were approved
as their implementers committed them. Task 13 is this record, written for the
controller. The survey the plan was written from is named in its research
notes.

**The pre-flight.** The plan's independent review applied it task by task to a
scratch copy of `583df521` and ran each task's red and green step at its own
point: every red failed as stated, every green passed, all 22 diffs applied, and
the result matched the drafter's tree file for file; Wave 2 ran as the parallel
case, each green passing with the other four tasks still red. Its two Important
and nine Minor items — among them the anchor's case, the 60-minute cap ending at
its error, a routine refusal never the words of a close, the owner of an
assistant item announced first, and the default model preferred to the newest —
were applied by the drafter, who applied the amended plan again to a fresh copy:
after the four waves 543, 551, 552 and 553 files passed and 1 skipped, 6,907,
6,968, 7,010 and 7,018 tests passed and 2 skipped, 0 failed; the full tree's
typecheck at 259 lines and the gate at its 20; each fix's test failing without
it. That application was the executed pre-flight; the tree had not moved since
(`61c98f7c` adds only the plan), and no ruling was needed before Wave 1.

**The rulings.** Rulings 1–22 are the owner's (2026-09-28; the plan's header),
each confirmed as the plan states it:
1. OpenAI Compatible is retired, not ported: no definition, view, check or wire
   dialect; a stored selection falls to the first provider offered through the
   existing `selectionFromStored`, its stored slice left as it is.
2. The drift anchor is kept (parity), framed so the live test sees its cost.
3. Karaoke by arrival, OpenAI Translate's.
4. The participant's automatic detection is the user's own, not the old forced
   semantic VAD at high eagerness.
5. No one-time migration code; the turn-mode migration unchanged, so OpenAI's
   stored `'Disabled'` lands on automatic.
6. The temperature removed: not in `S`, not shown, not sent.
7. "Auto-detect" stays a source: "the spoken language" in the template, no
   transcription hint, Both refused (D20).
8. Typed text and a release's `response.create` wait first in first out while a
   response is in progress; the adapter owns the queue. **Its letter amended at
   the final review, its aim kept:** releases still waiting when any request
   goes up are answered by that request's response and leave with it — one
   response per batch of waiting releases, no release unanswered ("Found
   during execution", item 9).
9. Readiness narrowed to what a check reads.
10. Moot: OpenAI Compatible is retired.
11. The source transcript streams.
12. WebSocket only; a stored `webrtc` runs over WebSocket. **2026-09-29:** the
    owner abandoned WebRTC for both OpenAI providers; `S.transportType` removed,
    a stored one unread ("The owner's WebRTC decision").
13. A mid-session `error` is a Logs line, its words kept for a close within
    `ERROR_WORDS_MS`, a negative age ignored.
14. A drop or the 60-minute cap ends the run in words; no reconnect.
15. The participant speaks on its switch.
16. Noise reduction "None" sends `null`.
17. A restricted key's 403 stays parity: the auth words, Start off.
18. The registry order `['kizunaai_soniox', 'localInference', 'gemini',
    'volcengine_ast2', 'openai', 'openai_translate', 'soniox']`, OpenAI
    Realtime unflagged (`src/providers/registry.ts:20`, pinned at
    `registry.test.ts:301`).
19. The OpenAI setup guide.
20. Deletion: one later plan merged with OpenAI Translate's T3, after the WebRTC
    step's live test. **2026-09-29:** after the two WebSocket live tests, the
    WebRTC step abandoned.
21. The leg stays unnamed in `SessionContext`.
22. The start resolves on `session.updated`, bounded at 30 s.

Rulings 23–30 are the controller's technical rulings in the plan, applied as
written — ruling 23's fallback as amended during execution ("Found during
execution", item 1). The controller's rulings during execution are recorded
below, under "Found during execution", "Accepted as they stand", the live test,
the open questions and "What it leaves".

What landed, by task:
- **The pcm base64 helpers, lifted at their third user** (`2f7c681d`, Task 1;
  ruling 24, choice 1): `src/lib/contract/pcm64.ts` — `pcmToBase64` and
  `base64ToPcm`, byte for byte Gemini's; Gemini's and OpenAI Translate's wires
  import `pcmToBase64` for their own frames and re-export both, so every
  importer of theirs is unchanged. Its test pins the view offset, the byte
  order, a round trip past one 32 KiB step, the odd trailing byte and text that
  is not base64.
- **The bounded check request, lifted at its fourth user** (`bf2702ba`, Task 2;
  ruling 24, choice 2): `src/lib/provider/boundedFetch.ts` —
  `boundedFetch({ clock, ms, signal, late }, run)`: the caller's abort before
  anything starts, one `AbortController` that the caller's signal and the bound
  both abort, the late words when the bound fired, the timer cancelled and the
  listener removed however `run` settles. Soniox's, Gemini's and OpenAI
  Translate's checks run their bodies inside it, with their own constants and
  words; their `check.test.ts` suites, untouched, are the net.
- **A check says what it reads** (`eda82c05`, fix round `2380007d`, Task 3;
  ruling 9, choice 3): `Provider.checkReads?: readonly (keyof S & string)[]`.
  `providerStore.updateSettings` forgets readiness only when `checkReads` is
  absent, when the patch names a field it lists, or when the edit moved the
  run's pair; `refreshReadiness` keys a kept ready answer on the listed fields
  alone, so a run started after an unrelated edit is served from it with no
  request; a credential edit forgets it as before. A registry invariant holds
  every listed name to a field of the provider's defaults. The `i18nKey`
  comment no longer names Compatible. The fix round: "Found during execution",
  item 5.
- **A model configuration with no temperature; the Logs pin; the redaction's
  comment** (`a8ff44b7`, Task 4; rulings 6, 25, 28; choice 13):
  `ModelConfigurationField`'s temperature is optional, its row drawn only when
  both its value and its range are given, so Gemini's render is unchanged;
  `logStore.test.ts` pins, with no change to `logStore.ts`, that its `.delta`
  rule groups each of the four delta frames under its own type and that none of
  the other 37 frame names takes a key — all 41 enumerated, so none lands under
  the microphone's row or Doubao's; `redact()`'s subprotocol rule names OpenAI
  Realtime as a producer in its comment. No new locale key.
- **Settings, the source transcript's hints and the builder; the folder seeded**
  (`a83243f5`, fix round `ec5dad3c`, Task 5; rulings 4, 5, 6, 7, 12, 16;
  choices 4, 5, 18, 19, 20): `settings.ts` — `RealtimeSettings` (the old slice
  less the key, the pair and the temperature, plus the instructions it now
  owns), `REALTIME_DEFAULTS` (`gpt-realtime-2.1-mini`, `alloy`, Normal at
  0.49 / 0.5 s / 0.5 s, `gpt-4o-mini-transcribe`, reasoning `low`),
  `migrateRealtimeSettings` (field by field; a stored push mode reads as
  `'Normal'`, no temperature is read, nothing is converted; the instructions
  through `migrateInstructions` and `INSTRUCTION_LEGACY_KEYS`),
  `REALTIME_VOICES` (10) and `REALTIME_LANGUAGES` (55, with `AUTO` first among
  the sources), `realtimeLanguageName` (`AUTO` → "the spoken language"),
  `realtimeCredentials` (one key, trimmed), `isRealtimeModelId`,
  `effectiveRealtimeModel` and `takesReasoning`; `transcription.ts` — the old
  `openaiTranscriptionContext` helpers, copied less the reverse ones, with
  `buildTranscriptionHint` taking a required model; `config.ts` —
  `RealtimeConfig`, `buildRealtime` (the participant the same call on the
  reversed direction, its detection the user's own, `transport: 'websocket'`
  with `S.transportType` unread) and `describeRealtime` →
  `{ translationModel, asrModel }`; the `adapter.ts` seed, written first for the
  session-side guard. The fix round: "Found during execution", items 3 and 7.
  The final fix wave removed `transportType` from `S` altogether (`eaaf8ead`;
  "The owner's WebRTC decision").
- **The wire, the socket seam and the fixtures** (`deb7deaf`, fix round
  `7381abad`, Task 6; rulings 16, 25; choices 5, 7, 14, 15): `socket.ts`,
  OpenAI Translate's seam copied — `nativeSocket(url, protocols)` rethrowing a
  constructor failure as `The browser would not open the socket (<name>).`;
  `wire.ts` — `REALTIME_WS_URL` and `realtimeUrl` (the model in the query),
  `realtimeProtocols` (`['realtime', 'openai-insecure-api-key.<key>']`, never
  the beta tag; the one reader of the key, pinned by OpenAI Translate's
  TypeScript-AST scan with its two evasions), `sessionUpdate` (typed by the
  SDK's request, widened for `languages` / `keywords` and a `null` noise
  reduction; no temperature; each detection `create_response: true,
  interrupt_response: false`), `appendFrame`, `COMMIT`, `CLEAR`, `textItem`,
  `responseCreate` (with `metadata: { request }`) and `requestOf`,
  `anchorResponse` and `isOutOfBand`, `decodeServerEvent`,
  `unwrapTranslationText` (copied from `src/utils/textUtils.ts`), `errorCode`
  (Translate's mapping, and `session_expired` → `segment_ended`) and
  `errorWords`; `wire.oracle.test.ts` pins the URL and the subprotocols against
  the SDK's own `OpenAIRealtimeWebSocket` over a stubbed `WebSocket`, for three
  model ids; `testing.ts`, the fixtures. The fix round (test-only): "Found
  during execution", item 7.
- **Items become segments, paired by id** (`c7be3d7e`, fix round `bbb41873`,
  Task 7; rulings 3, 11, 23; choices 8, 9): `items.ts`, `RealtimeItems`, pure
  and timer-free — an input item (a commit's, at `input_audio_buffer.committed`)
  opens a source under its item id, empty, its transcript deltas stream into
  it, and the completed transcript settles and closes it; a typed text is
  opened, written and closed at once under the adapter's own id; a translation
  opens at its assistant item's `conversation.item.added` or at its first
  content, with its origin, and closes at `response.output_item.done` or its
  response's `response.done`; a response out of band makes no segment; ranges
  by arrival, restated within a shorter final text through one
  `speechRanges`. The fix round changed the fallback origin and the empty
  transcript: "Found during execution", items 1 and 2. The final fix wave
  takes the fallback's "newest" in the server's order (`538e9ea5`; item 10).
- **The response queue** (`10db3b2e`, fix round `7634b836`, Task 8; ruling 8;
  choices 10, 21): `queue.ts` — `ResponseQueue` (`push`, `created`, `done`,
  `refused`, `stop`, `busy`), `Request`, `ACTIVE_RESPONSE`: a request goes up at
  once when no in-band response is active or asked for, else waits first in
  first out and frames `response.queued`; a refusal naming it with
  `conversation_already_has_active_response` puts it back at the head, any other
  drops it; the anchor's responses are none of its requests. A seeded test (400
  runs) pins every request answered exactly once, in the order pushed, whether
  or not the server echoes the metadata. The fix round: "Found during
  execution", items 6 and 7. The final fix wave merges the releases waiting
  behind a request into it, and replaces the seeded test with a conversation
  model (`3c7284d9`; item 9).
- **The check, one bounded model list** (`5f7505d9`, Task 9; rulings 17, 26;
  choice 16): `check.ts` — `createRealtimeCheck` and `checkRealtime`: `GET`
  `OPENAI_MODELS_URL` with `Authorization: Bearer <key>` and nothing else,
  inside `boundedFetch` (`CHECK_TIMEOUT_MS`, 15 s) on an injected `fetch` and
  clock; the ids `isRealtimeModelId` accepts → ready, newest `created` first,
  each once; none → `no_realtime_model`; `unsupported_country_region_territory`
  at any status → `region_unsupported`; 401 or 403 → `auth` with
  `HTTP <status>: <OpenAI's message>`; 429 → `rate_limit`; any other status, a
  failed fetch, the bound or the abort → it throws.
- **The settings view and the turn detection** (`806439e9`, Task 10; D18,
  rulings 6, 12, 27; choice 17): `RealtimeSettingsView`, in the old order —
  `InstructionsField`, `VoiceField`, `ModelField` (the effective model, no
  refresh button), `TranscriptionField` (new; its keywords shown for
  `gpt-transcribe` and `gpt-live-transcribe` alone), `NoiseReductionField`,
  `ModelConfigurationField` with the max tokens alone, `ReasoningEffortField`
  (new; drawn for a model `takesReasoning` accepts); the `TurnDetection` slot —
  its Summary ("Normal · Threshold 0.49 · Silence duration 0.50s" / "Semantic
  · Eagerness Auto"), its Help (the old `settings.turnDetectionTooltip`), its
  Controls under `#openai-vad-section`. No temperature, no transport control,
  no push modes; every word an existing key; an `aria-label` on each new
  select.
- **The adapter** (`16433ee1`, fix round `f9fe8747`, Task 11; rulings 2, 8, 11,
  13, 14, 22, 29; choices 6, 10, 11, 12, 13, 14, 15, 24):
  `createRealtimeAdapter`, one leg per socket, reading binary frames as
  `ArrayBuffer`s. `session.created` sends `session.update`; the start resolves
  on `session.updated`, and the first anchor goes up. It rejects within
  `START_TIMEOUT_MS` (30 s) on the request's clock — `network` if the socket
  never opened, `server` if it did — and at once for a socket that failed
  before opening (`NEVER_OPENED`), a close before the start, or an `error` (in
  OpenAI's words), closing the socket on every path. Each chunk goes up as it
  came, unframed. Under manual turns a release commits at once and queues its
  response — since the final fix wave, merged into the next request that goes
  up ("Found during execution", item 9) — and a press without speech clears
  the buffer; under automatic
  turns the keys send nothing. Typed text is trimmed, shown at once, and
  queued. The server's events feed `RealtimeItems` and the queue; `busy`
  follows the in-band responses. The anchor goes up at `session.updated` and
  after every fifth completed in-band response, once per count, framed
  `response.anchor`; its responses are framed `outOfBand: true`, its
  `response.done` with `usage`. A mid-session `error` is framed and — unless
  routine (`conversation_already_has_active_response`), which the queue asks
  again — remembered for a close within `ERROR_WORDS_MS` (10 s), a negative age
  not recent; `session_expired` ends the run at once as `segment_ended`; any
  other unexpected close fails with `connection_lost`; nothing reconnects. Two
  unreadable latches, the frame's and the audio's. The harness `startRealtime`
  / `liveRealtime` joins the fixtures; the session-side guard walks the folder
  (`adapter.ts`, `items.ts`, `queue.ts`, `socket.ts`, `wire.ts`); the kit's
  conformance scenarios pass, all but reconnecting, which OpenAI Realtime does
  not do. The fix round: "Found during execution", items 4 and 7.
- **The definition, registered between Doubao AST 2.0 and OpenAI Translate** (`054e7739`, Task 12; rulings
  1, 4, 9, 15, 18, 19; choice 22): `provider.ts` — `openaiProvider`: the old id
  and slice (`openai`), `platforms: ['electron', 'extension', 'web']`, the
  OpenAI icon and guide, `speech: 'optional'`, `textInput: true`,
  `boundaries: 'provider'`, both turn modes, `checkReads: []`, and no
  `participantSpeech`, `flagged`, `i18nKey` or session hooks. `RELEASED` gains
  it between `volcengineAst2Provider` and `openaiTranslateProvider`, pinned at
  `registry.test.ts:301` and in `providerPaths.test.ts:28` (`['gemini',
  'volcengine_ast2', 'openai', 'openai_translate', 'soniox', 'fake']`); OpenAI
  Translate's order case narrowed. The six cases across four files that named
  `openai` as a provider no build registers now name `openai_compatible`, so
  the loader's fallback case pins ruling 1 end to end. Its own cases: the
  identity and guide; Text only, typed text, the server's boundaries, both
  modes; the order, with Compatible registered nowhere; a stored Compatible
  selection falling to the first provider offered, with nothing written; the
  participant on its switch, with Other's prompt and the user's own detection,
  and Both refused for Auto-detect (D20); an aborted start opening no socket;
  an old profile loading as it was; readiness kept through a slider or a
  prompt edit and forgotten by a new key.

**F14.** OpenAI Realtime is not a header user (ruling 25): its key rides in the
subprotocol, as OpenAI Translate's does. F14 stays OpenAI Live's, and OpenAI
Realtime's own `socket.ts`, a copy of Translate's, moves to `src/lib/contract/`
with the other four when F14 lands. A stale per-host Electron rule for
`api.openai.com` would reach its upgrade too, so the seam's rule still scopes
by path (the spec's "Sockets that need upgrade headers").

**The spec's amendments** (this record's commit), the plan's fifteen, each at
its anchor, as landed:
1. "What every adapter must honour", the `frame` bullet: the panel's grouping
   corrected — `logStore` reads `item_id` at the event's top level
   (`logStore.ts:495-496`) and a frame reaches it as `{ type, data: payload }`
   (`src/app/telemetry.ts:94`), so frames group by consecutive type alone
   (survey §3.7.5); OpenAI Realtime needs no `logStore` row (choice 13).
2. The same list, `appendText`: typed text shown at once, its request queued
   first in first out; `busy` has no reader (ruling 8).
3. "Turns" → "The design", the automatic mechanism: kept as
   `turnDetectionMode`, `'Normal'` or `'Semantic'` alone — no `autoDetection`
   field, no `legacyKeys` entry (ruling 5, choice 4); the global mode's
   migration unchanged, and its push-to-talk users' departure stated (survey
   §3.7.3).
4. The participant paragraph: the old copy was true for OpenAI alone
   (`ProviderDescriptor.ts:389-407`); OpenAI Realtime's participant now uses the
   user's own detection (ruling 4; survey §3.7.2).
5. The design table's OpenAI row: `endTurn` commits at once and its
   `response.create` waits behind a response in progress (ruling 8);
   `cancelTurn` clears (choice 12); "Defects removed by construction", its
   first bullet landed.
6. "Coverage" and "Stage 2 — open for the plans that meet them", its D25 item:
   the port is WebSocket only with both modes (ruling 12); D25, `turns(s)` and
   the participant's transport move to the WebRTC step, with whether "manual
   only" includes push-to-translate (`ProviderSpecificSettings.tsx:589-590`;
   survey §3.7.7).
7. "Provider capability": the GA row — karaoke by arrival, the second stated
   exception, the table's old "per audio frame" corrected (D4; survey §3.7.1);
   pairing stated by item id, **as landed** the fallback the newest known input
   if still unanswered, else none, and the translation then unpaired ("Found
   during execution", item 1); Compatible's row retired (ruling 1), WebRTC's
   row the WebRTC step; a paragraph after the table on the stated pairing and
   the unanswered utterance.
8. "The provider definition": `checkReads` in the shape (landed `readonly`) and
   in the amendments' notes; the drift anchor landed as parity, what it steers
   unmeasured (survey §3.7.4; live-test item 4); the transport paragraph,
   WebSocket only (ruling 12, choice 18).
9. "Readiness is one check": "A check says what it reads" — **as landed**, a
   kept ready answer keyed on the listed fields, a refusal or a throw standing
   through an unread edit ("Found during execution", item 5); the effective
   model paragraph: OpenAI Realtime's rule, its model migration not ported
   (ruling 5).
10. "Sockets that need upgrade headers": OpenAI Realtime needs no header seam
    (ruling 25, choice 7; survey §3.7.6).
11. "Persisted settings that move": the turn-mode row (`Normal` / `Semantic`
    stay its `turnDetectionMode`), the transport row (read and not shown until
    the WebRTC step), and the temperature below the table (ruling 6).
12. "What adding a provider then touches": no manifest change
    (`manifest.json:38, 116`).
13. "Migration": OpenAI Realtime's and Compatible's old code and the
    `openai-realtime-api` dependency wait with OpenAI Translate's T3 (ruling
    20); item 6 OpenAI Realtime ported, Compatible retired (ruling 1); item 7
    carries OpenAI Realtime's WebRTC transport; the count "nine ported in ten
    steps … one retired, and two relay twins, both deleted".
14. "Risks": OpenAI Realtime's arrival ranges the second stated exception
    (ruling 3), OpenAI Translate's now "the first".
15. "The session request", what opacity costs: `describe` names the transcript
    model as the ASR model (choice 20).

The final fix wave's amendments (this update):
16. "What every adapter must honour", `appendText`, and "Turns" → the design
    table's OpenAI row: the releases still waiting when a request goes up leave
    with it, counted as its `merged` — one response per batch ("Found during
    execution", item 9).
17. "Provider capability": the GA row's fallback takes "newest" by when the
    server came to hold each input (item 10); after the table, a batch's
    earlier input shows with no translation beside it.
18. The owner's WebRTC decision, at each anchor that promised a WebRTC step:
    D25 closed; L0's `input` taken by no adapter; the WebRTC-to-WebSocket
    fallback moot; "Turns" — `beginTurn`'s second reason gone, the WebRTC
    gating defect removed with the transport, "Coverage"'s exception gone;
    "Provider capability" — both WebRTC clients abandoned, not ported; the
    shape's `turns(s)` comment; "`start` owns the transport" — no
    `transportType` in either `S`; "Segmentation is one fact"; "One leg only"
    — `webrtcOptions`; "Persisted settings that move" — the transport row;
    "Capture belongs to the runner" — no adapter takes the runner's track;
    the defects table's WebRTC capture row; "Migration" — the merged deletion
    after the two WebSocket live tests, the order's item 7 removed (the
    numbers kept) and the count "nine ported in nine steps"; the D25 open
    question closed.

**Checked — the gates.** Every implementer ran the suite and the typecheck gate
on its own commit. In the parallel waves a failure or an extra gate line in
another task's uncommitted files was named and left to it: Task 4 saw failures
only in Task 3's work in progress (`providerStore.readiness.test.ts`) and
extra gate lines only under Task 5's `src/providers/openai/`; Task 9 saw
failures in Task 7's (`items.test.ts` before `items.ts` landed); Task 7 saw
`queue.test.ts` fail, most likely during Task 8's in-tree mutation checks ("Found
during execution", item 8); Task 12 saw `adapter.test.ts` fail with the folder
run alone, Task 11's fix round then in progress. Tasks 1, 2, 3, 6 and 9 met
5-second load timeouts under the waves' load — in `sessionSide`,
`kizunaProviderGating`, `providerOrder` and `nativeModelStore` among others —
which passed re-run alone; the quiet re-runs that closed Waves 1 and 2 (Task 5's
and Task 10's implementers') had none: 543 files passed and 1 skipped, 6,907
tests passed and 2 skipped; then 551 and 1, 6,968 and 2; 0 failed. The suite
grew from 538 files passed and 1 skipped, 6,860 tests passed and 2 skipped at
`583df521`, to 553 files passed and 1 skipped, 7,026 tests passed and 2 skipped
at `f9fe8747` — the plan's 7,018 and eight cases the fix rounds added — 0
failed, no unhandled errors; the gate — the AST2 plan's regex, unwidened — at
its 20 lines throughout, and the full tree at 259.

**Checked — group check A** (at `bbb41873`, with Task 11's `16433ee1` in
review; nothing registered yet):
1. the suite: 552 files passed and 1 skipped, 7,013 tests passed and 2 skipped,
   0 failed, no unhandled errors — the plan's 7,010 and three cases the fix
   rounds had added; the gate at its baseline;
2. `src/services`: 49 files, 1,039 tests passed — the old OpenAI code untouched;
3. `npm run build` and `npm run extension:build`; the three D24 greps empty;
   `response.anchor` in neither bundle, as expected before the registration;
   `npx vitest run extension` (45 tests).

**Checked — group check B** (at `f9fe8747`, every task complete):
1. the suite: 553 files passed and 1 skipped, 7,026 tests passed and 2 skipped,
   0 failed, no unhandled errors; the gate at its baseline; the full tree's
   typecheck at 259; `src/services` 49 files, 1,039 tests;
2. `npm run build` and `npm run extension:build`, the three D24 greps empty;
   `response.anchor`, a frame only the new adapter emits, is in
   `build/static/index-DUSTrcNF.js` and `extension/dist/fullpage.js` — the
   adapter ships in both bundles, neither fake does; `npx vitest run extension`
   (7 files, 45 tests);
3. every probe on a fresh vite: the six spine probes, `app-panel-probe`
   (`--preview`, `--preview --settings`, `--app`, `--app --settings`),
   `extension-overlay-probe` (plain and `--ptt`) — all pass; the audio probe's
   one 3.5 s gap is the fake script's own pause, as before;
4. **OpenAI Realtime's Provider tab, rendered**, with 0 requests and 0 resources
   to `api.openai.com` in every run: advanced — the headings "System
   Instructions", "Voice", "Model", "User transcript model", "Noise
   reduction", "Model configuration", "Reasoning effort", "VAD Settings", in
   that order; the model `gpt-realtime-2.1-mini`, the saved one, alone and the
   select disabled (no check has run); the transcript model
   `gpt-4o-mini-transcribe` with no keywords field, which appears on choosing
   `gpt-transcribe`; noise None / Near field / Far field, None selected; the
   max tokens Unlimited with no temperature row; the reasoning effort `low`
   (minimal … xhigh), the saved model being a 2.x one. The shared fields'
   classes are byte for byte Gemini's (`InstructionsField`, `VoiceField`,
   `ModelField`, `ModelConfigurationField`). Simple — none of the provider's own
   fields, as for OpenAI Translate and Doubao: the picker, the language pair and
   the turn-detection summary. Screenshots `ort-tab-openai-advanced-full.png`,
   `ort-tab-openai-advanced-transcript-switched.png`,
   `ort-tab-openai-simple-full.png`;
5. **the turn detection:** the summary "Normal · Threshold 0.49 · Silence
   duration 0.50s", its controls under the "VAD Settings" heading; Semantic →
   "Semantic · Eagerness Auto" and the eagerness select (its `aria-label`
   "Eagerness"); Normal again restores the first line;
6. **the gate's words:** `/?preview=spine&panel=1&provider=openai` — ▶ Start
   disabled, titled "Enter your API key in Settings before starting.", 0
   requests to OpenAI (`ort-gate.png`);
7. **the wizard** on a fresh profile: the own-key list "Google Gemini | Doubao
   AST 2.0 | OpenAI Realtime | OpenAI Translate | Soniox" (and the
   development-only fake), no OpenAI Compatible anywhere, never filled or
   validated (`ort-wizard-ownkey-list.png`);
8. **a stored Compatible selection:** `settings.common.provider` seeded
   `openai_compatible` before any app script ran, then `/` loaded — the store's
   selection `kizunaai_soniox`, the first provider offered, with its entry alone
   loaded, and `settings.common.provider` still `openai_compatible`: nothing
   written (ruling 1). A fresh profile shows only the setup wizard, so the
   selection was read from the running store's own module, not a control
   (`ort-compat-fallback.png`);
9. the Logs' grouping: `logStore.test.ts` (Task 4) is the evidence; no live
   frame exists before the owner's test.

The rendered steps' report, scripts and screenshots are under
`/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/group-b/`.

**Found during execution** — what execution changed or found beyond the plan,
each from a controller's ruling in the ledger (or, where marked, this record's
reading of the landed code), with its reason and where it lives:
1. **The pairing fallback is the newest known input if it is still unanswered,
   else none** (Task 7's review, m5, amending choice 8 and ruling 23;
   `bbb41873`). It is still taken at `response.created`. The plan took the
   newest unanswered input, which could be an older one behind an input
   already answered. Why: the review's case X7 showed a late response,
   following an answered input, paired with an utterance from before it. **As
   landed, a translation left with no origin shows unpaired** (this record's
   reading of the landed code): the ruling expected L2's proximity inference
   (F16) to take such a translation over, but `inferPairs` pairs only segments
   that state no origin (`src/lib/projection/pair.ts:25-26`), and every source
   of this leg states its item id — so the translation is a group of its own,
   `pairing: 'none'`, a translation row with no source beside it. The ruling's
   cost if wrong therefore reads: a rare response that did answer an older
   input shows unpaired, not paired by proximity. Live-test item 8 watches for
   it; an open question below. Lives in `src/providers/openai/items.ts`
   (`newestUnanswered`, `originFor`); `items.test.ts` pins X7's case (no
   origin) and X1's (the fallback taken when the response was created, not when
   its translation opens). The final review agreed with the rule and found its
   "newest" followed the leg's open order, not the server's: item 10.
2. **An empty completed source transcript after streamed deltas keeps the
   streamed text** (Task 7's review, m2; `bbb41873`): `inputDone` treats `''`
   as no answer, the rule `outputDone` keeps; with nothing streamed, the source
   opens and closes empty, and makes no row. Why: an empty completion would
   otherwise erase what was shown. Cost if wrong: an empty final transcript
   shows the streamed words. Lives in `items.ts`, both cases pinned.
3. **Reasoning only for 2.x models** (Task 5's review, m2; `ec5dad3c`):
   `takesReasoning` reads `gpt-realtime-<major>[.<minor>]` and requires
   2 ≤ major < 1000, so the dated 1.0 snapshot `gpt-realtime-2025-08-28` gets no
   `reasoning.effort`, and the view draws no Reasoning effort field for it. Why:
   that model would refuse the field, and a refused `session.update` now fails
   the start, which resolves on `session.updated` (ruling 22); the old client
   sent it to every id starting `gpt-realtime-2` (`openAIRealtimeSession.ts:106`).
   Cost if wrong: a 2.x model named oddly — a three-part `2.1.3`, which does not
   exist — gets no reasoning field. Lives in `src/providers/openai/settings.ts`;
   six cases in `settings.test.ts`.
4. **The adapter frames, and marks sent, only what went up** (Task 11's
   review, m3 and m4; `f9fe8747`): `endTurn`'s commit, `cancelTurn`'s clear,
   and each request's item and `response.create` are framed only when `send()`
   returned true, as the anchor already was; a commit that did not go up asks
   no response, and a typed item that did not go up is not counted sent. The
   fixed-words refusal ("The browser would not open the socket (<name>).")
   wraps only `openSocket(...)`: any other constructor throw rejects the start
   as it was thrown. Why: a Logs line for a frame that never left a closing
   socket, and a wide `try` that would have worded an unrelated failure as the
   browser's. Cost if wrong: a Logs line fewer while a socket closes. Lives in
   `src/providers/openai/adapter.ts`, with its cases in `adapter.test.ts`.
5. **Readiness narrowing holds both ways** (Task 3's review, I1, m1, m2;
   `2380007d`; the declaration `054e7739`): an edit to a field `checkReads`
   does not list keeps the answer whether it is ready or not — a refusal, or a
   check that threw, stands, and Validate asks again — while an edit that moves
   the run's pair forgets it. `checkReads`' doc names the pair-move exception
   and the kept answer, ready or not; `read` became `touched` in
   `updateSettings`. OpenAI Realtime declares `checkReads: []`: its check reads
   only the key. Lives in `src/lib/provider/types.ts` and
   `src/stores/providerStore.ts`, the not-ready case in
   `providerStore.readiness.test.ts`.
6. **The queue's `done` rule is kept, its assumption stated** (Task 8's review,
   m1, on ruling 8 and choice 10; `7634b836`): an in-band `response.done` clears
   the request asked, whichever response it was — self-healing a request whose
   answer came and went unseen. It assumes a `response.create` reaches the
   server before the in-band response already in progress ends; outside that —
   two server-started responses beginning and ending within one round trip of
   ours, improbable with `interrupt_response: false` — a request can be lost:
   refused for the first, its refusal arriving only after the second's `done`
   has already cleared it. The header of `src/providers/openai/queue.ts` states
   it. Cost if wrong: that rare
   request lost. Whether OpenAI echoes `metadata.request` on `response.created`,
   which clears the request earlier, is live-test item 7.
7. **Test pins the reviews added, with no change in behaviour:** the
   participant's own detection — server VAD under Normal (Task 5, I1;
   `ec5dad3c`); a refusal standing through an unread edit (Task 3, I1;
   `2380007d`); the fallback taken at `response.created`, not when the
   translation opens (Task 7, I1; `bbb41873`); the queue sending nothing after
   stop, a late refusal included, the re-ask's `waitedMs` counted from the
   first push, and the seeded test's turns compared by identity (Task 8, m2,
   m3; `7634b836`); the seam's rethrow checked against the instance the stub
   threw, a stored temperature never sent through `migrateRealtimeSettings`,
   and reasoning for mini, the dated 1.0 snapshot and 2.1 through the builder
   (Task 6, m1, m2; `7381abad`); the error-words window at its inclusive edge
   and its value, 10,000, a refusal other than `ACTIVE_RESPONSE` freeing the
   queue, and two pairing cases separating `previous_item_id` from a typed item
   being known (Task 11, I1, I2, m5; `f9fe8747`). The fixes of Tasks 3, 5, 7, 8
   and 11 were each shown to bite on a mutant in a scratch copy.
8. **No proof in the tree** (the controller's rule, restated in every fix
   dispatch): Task 8's implementer ran extra mutation checks by editing
   `queue.ts` in the tree and restoring it — the controller verified the file
   matched the commit, and nothing imported it yet — and Task 6's showed its red
   step by moving its own files out of the tree and back. Either may have
   failed another task's concurrent run; no commit carried either. Lives in the
   execution's rules.
9. **One response per batch of waiting releases** (the final review,
   Important 1; the controller's ruling, amending the letter of ruling 8 and
   keeping its aim; confirmed by the owner, 2026-09-29;
   `3c7284d9`). Over GA a `response.create` answers the conversation as it
   stands, and a release's `input_audio_buffer.commit` goes up at the release.
   So when any request goes up, every release still waiting has its commit in
   the conversation already and is answered by that request's response. As
   first landed, each waiting release then asked its own `response.create`
   with nothing new to answer — billed, and on a leg that speaks, heard in the
   meeting: the review's reproduction, three releases, gave three
   `response.create`s, the third with nothing new; its conversation-model fuzz
   counted 1,722 of 8,715 manual in-band responses input-less over three
   seeds. **As landed:** at a flush the queue takes every waiting release off
   with the request going up, and the adapter frames their count as `merged`
   on its `response.create` (a field, not a new frame name, so the Logs pin's
   41 names stand). A typed text is never merged: its item goes up only with
   its own request, so it needs a response of its own; a text then a release
   waiting → the text's request answers both, its translation under the text,
   and a release then a text → each its own. A request refused as active goes
   again still carrying its merged releases; one refused, naming it, for
   another reason re-queues the first of them at the head, the rest merged
   into it (their commits are unanswered still; each such refusal spends one,
   so a request refused every time ends). An error that names nothing drops
   the request as before and re-queues nothing — it may be no refusal of this
   request's, whose response may be running, and a fuzz variant that
   re-queued there asked 7 input-less responses on one seed. The queue's
   seeded test (400 runs) now models the conversation — a response answers the
   user items added since the previous in-band one began; the anchor's
   response may refuse in-band ones meanwhile; the server's detection under
   automatic turns — and pins, under releases and typed text, that no
   response is asked with nothing new, that every release and every typed
   text is answered, typed text first in first out, one request at a time.
   The review's reproduction now sends two `response.create`s for the three
   releases, none input-less; the fuzz, re-run over the review's 15,000
   lifecycles on four seeds, counts no input-less manual response on the
   three voice-gated seeds and 158 on the raw one, each after an empty commit
   the runner's voice rule prevents. Cost if wrong: the owner wants one request per release back
   — revert, and live-test item 6 records what the extra responses say and
   cost. Lives in `src/providers/openai/queue.ts` (its header states the
   rule) and `adapter.ts`, with cases in `queue.test.ts` and `adapter.test.ts`.
   Left as it stands: under automatic turns a typed text refused as active
   can be answered by the server's own next response before the queue asks
   again, and its re-ask then asks for nothing new (the fuzz: 140 of 8,816
   automatic in-band responses over the four seeds) — an open question below.
10. **The fallback's "newest" in the server's order** (the final review, Minor
    1; `538e9ea5`): a typed text queued behind a response opens when typed and
    reaches the server only when its request goes up, after any commit made
    meanwhile; walking the inputs in the leg's open order, the fallback found
    that commit as "newest" — none when it was answered, a wrong pair when it
    was not (on the review's seed 2, 227 missed and 274 wrong of 5,687 in-band
    responses). Each input now records when the server came to hold it, one
    counter set at `committed` and at a typed item's `inputAdded`, and
    "newest" is taken by that. Every landed case passes unchanged; the new
    one: a typed text queued behind a response, a commit made meanwhile and
    answered, then the text's translation announced late → paired with the
    text. The fuzz, re-run with items 9 and 10: 0 missed and 0 wrong on all
    four seeds, every judged in-band response paired right or honestly none.
    Lives in `src/providers/openai/items.ts` (`knownAt`, `newestUnanswered`).

**The owner's WebRTC decision** (2026-09-29, in his words: WebRTC users are
few, so after this migration the WebRTC clients of OpenAI Translate and OpenAI
Realtime are abandoned — neither migrated nor reimplemented). What follows
from it, as the controller ruled and the final fix wave applied:
- **The Stage 2 order** after this plan runs Palabra → OpenAI Live → Local
  Native. The spec's item 7, "OpenAI Translate over WebRTC", is removed, its
  number kept. Palabra's LiveKit WebRTC is a different thing and stays.
  **Changed by the Stage 2 Palabra plan:** Palabra's port is a WebSocket
  client written from scratch (ruling 19); LiveKit goes with its old code.
- **The attachment point goes** (`eaaf8ead`): `transportType` leaves `S` in
  `src/providers/openai/settings.ts` and
  `src/providers/openai_translate/settings.ts`, with its default and its
  `migrate` line. A stored value is simply not read
  — no migration code (ruling 5) — and a stored `webrtc` already ran over
  WebSocket, so nothing changes for users. `C.transport` stays the literal
  `'websocket'`, since it reaches `info.transport` and analytics; its
  comments, and the Realtime adapter's, no longer promise a WebRTC step. The
  tests that named the field pin that a stored `webrtc` is not read and the
  session runs over WebSocket.
- **The old code's deletion waits only for the two WebSocket live tests** —
  OpenAI Translate's (its record above) and this one's. It is OpenAI
  Translate's T3 merged with this port's own deletion: both WebSocket and
  both WebRTC old clients, `OpenAIClient`'s statics, `openAIRealtimeSession`,
  `EphemeralTokenService` (only the two WebRTC clients import it), the
  Compatible code and the `openai-realtime-api` fork (this record's
  inventory). The relay twin's T2 stays as it was.
- **What existed only for the WebRTC step**, each checked:
  - F15, the processed track (the foundation plan's inheritance, 1c-3's
    `Source.track` item and Stage 2's processed-track item above): closed. No
    adapter takes the runner's track — Palabra builds its LiveKit track from
    appended pcm (`PalabraAIClient.ts:409-455, 553-570`) — so the items wait
    for an adapter that would. **Closed for good** by the Stage 2 Palabra
    plan: the seam is deleted (ruling 16; `7d0b8cdd`).
  - D25 and `turns(s)`: closed. No provider offers manual turns only;
    `turns(s)` stays in the shape and answers both everywhere (spec D25).
  - The participant's transport: closed — WebSocket, like the speaker's.
  - Push-to-translate under WebRTC ("manual only"): no one's question.
  - The transport control and a shared `TransportField`: closed — nothing to
    choose.
  - The ephemeral token: deleted with the old code, not moved.
  - The WebRTC-to-WebSocket fallback in `start`: moot.
  - The kit-level seeded lifecycle scenario (OpenAI Translate's
    Recommendation 3, choice 21 here, and this review's Recommendation 3,
    "keep `fuzz.mts` as the WebRTC step's harness"): reassigned, not closed —
    a scenario in `src/lib/contract/testing/` modelled on both final reviews'
    fuzzes, for the next port that wants it (Palabra is next); the review's
    `fuzz.mts`, re-run by the fix wave, stays in the job's scratch as its
    model. **Done** by the Stage 2 Palabra plan: `runLifecycles` in
    `src/lib/contract/testing/lifecycle.ts`, first run over Palabra's adapter
    (ruling 15; choice 19; its record's "Found during execution", item 2).

**Checked — the final fix wave** (at `eaaf8ead`): the suite, 553 files passed
and 1 skipped, 7,033 tests passed and 2 skipped, 0 failed, no unhandled errors
— `f9fe8747`'s 7,026 and seven cases; the gate at its 20 lines, the full tree
at 259; fourteen scratch mutants of `queue.ts`, `items.ts` and `adapter.ts`,
each failing a case; the review's reproduction and fuzz re-run as items 9 and
10 state.

**Accepted as they stand** (the controller's rulings, each with its cost if
wrong):
- **Task 3, m4:** the race's breadth — the listed-edit path shares the
  credential race already pinned. Cost: none new.
- **Task 5, m3:** the 5-second load timeouts pre-exist; the session-side
  guard's budget under parallel waves goes to the final review's list. Cost:
  timeouts under load that pass alone.
- **Task 6, m3:** the key scan is by name, and cannot see
  `Object.values(k)[0]`; the adapter's pass-through pin and the kit's
  frame-secret rule backstop it. Cost: an evasion the scan misses, caught
  downstream.
- **Task 7:** the one surviving mutant (M7d) is equivalent; the order case X2
  — an out-of-band item announced before its output item — rests on the SDK's
  documentation (`realtime.d.ts:80`, `:1984-1985`) and goes to the live test
  (item 4) and the open questions. Cost: none offline.
- **Task 11:** after the fix round, three surviving mutants are unreachable —
  messages arrive only on an open socket, the queue has no timers, and a socket
  never reopens. Cost: none reachable.
- **Group check B:** the plan's rendered step read "in the simple and the
  advanced layout, shows its fields"; the simple layout draws none of the
  provider's own fields, the rule for every ported provider (OpenAI Translate's
  record shows the same). Cost: none.

**Stated departures from today** (the plan's self-review list, as landed; what
execution changed or added is marked):
- OpenAI Compatible is withdrawn from a release (ruling 1): a stored selection falls to the first provider offered, nothing is written, and its settings stay on disk; it was offered on Electron only (`ProviderConfigFactory.ts:75-78`);
- a stored `'Disabled'` — OpenAI's push-to-talk — turns to automatic once, through the unchanged global migration, and those users pick push-to-talk again (ruling 5);
- the model migration is not ported (choice 4): a stored pre-2.1 model runs as stored while listed, else as the default model when listed, else as the newest — so an unlisted stored model runs as the default model: a full `gpt-realtime` user lands on the mini one, and a `gpt-realtime-mini` user may land on the full model only when the default is not listed (the old load mapped mini to `gpt-realtime-2.1-mini` and a full model to `gpt-realtime-2.1`, `settingsStore.ts:556-588`);
- the temperature is gone (ruling 6), its stored value unread;
- the participant's detection is the user's own (ruling 4), where the old forced semantic VAD at high eagerness;
- `response.create` carries `metadata.request` (choice 10), where the old one was bare; typed text queues first in first out with nothing overwritten (ruling 8), where the old held one and overwrote it;
- the anchor's metadata drops the old `sessionType` (choice 11; ruling 21);
- `session_expired` ends the run at once, as the segment's end (choice 14); an unexpected close ends the run in words, with no reconnect (ruling 14); a mid-session `error` is a Logs line (ruling 13);
- the start waits for `session.updated`, bounded at 30 s with the socket closed on every path (ruling 22; choice 6), where the old sent the configuration unconfirmed and a refused one ran on the server's defaults;
- an empty press clears the server's buffer (choice 12); noise reduction "None" sends `null` (ruling 16); the key is trimmed (choice 19); Auto-detect reads "the spoken language" in the template (ruling 7);
- the check is bounded and throws on a status the key does not explain or a failed fetch, where the old called every failure an invalid key (choice 16);
- the view's new selects carry an `aria-label` (choice 17);
- a same-language pair makes both legs read Other's prompt (ruling 21), Gemini's stated departure, the same here;
- **as landed**, the dated 1.0 snapshot `gpt-realtime-2025-08-28` gets no `reasoning.effort`, where the old sent it ("Found during execution", item 3);
- **as landed**, a translation the server ties to no input of the leg, whose fallback finds none, shows unpaired ("Found during execution", item 1);
- **as landed at the final review**, one response per batch of waiting releases, where the old app asked one per release and had the second refused: an earlier input of a batch shows as a source with no translation beside it, its words in the translation under the later one; a typed text's translation likewise holds the words of a release that waited with it ("Found during execution", item 9);
- **by the owner's decision** (2026-09-29), OpenAI Realtime has no WebRTC transport: a profile that chose it runs over WebSocket, as it already did since this port, and no transport choice returns.

Where the plan departs from its survey, and from its brief, stays in the plan's
self-review.

**Before any release from the branch**
- **The owner's live test below**, before the merged deletion and before any
  release that carries OpenAI Realtime.
- **The registry's order** is now `['kizunaai_soniox', 'localInference',
  'gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'soniox']` (ruling
  18; `src/providers/registry.ts:20`, pinned at `registry.test.ts:301`), OpenAI
  Realtime unflagged under D19's model.
- **The release notes** say OpenAI Compatible is retired and what its users
  see: the first provider offered selected in its place, and their Compatible
  settings — endpoint and key — kept on disk, unread.
- **The wizard's own-key description** (`setup.paths.own-key.desc`): its
  "OpenAI" is true for two providers now, OpenAI Realtime and OpenAI Translate;
  OpenAI Live waits for its port.
- No new locale key, so no native-speaker check.

**The owner's live test** (own key, real OpenAI; survey §2.16's list, adjusted
to the rulings; what execution added is marked). Switch diagnostic logs on in
Help **before Start**, so the Logs record from the first frame; each item names
what settles it there — above all `response.anchor`, `response.create` (its
`for` and `waitedMs`, and `merged` when releases waited behind it),
`response.queued` (its `waiting`), `response.done` (its
`status`, `outOfBand` and `usage`), `session.error`, and the four delta frames
(`conversation.item.input_audio_transcription.delta`,
`response.output_audio_transcript.delta`, `response.output_text.delta`, and
`response.output_audio.delta` with its `samples`):
1. **The key** (ruling 17; choice 16): a valid key → Validate ✓, the realtime models listed newest first — no `gpt-realtime-translate*`, `gpt-realtime-whisper*` or `gpt-audio*` among them — and the Model select on the effective model; a wrong key → "The provider did not accept the credentials: HTTP 401: …", Start off; a restricted project key (Models "None", Realtime "Write") → expected 403, the same auth words — record its message, and whether such a key could otherwise run a session; an unsupported region, if reachable → "Service not available in your region. …"; offline → not ready, Start off, no words about the key. **Execution (the adapter's review):** record whether the wrong key's words quote the key's last four characters (`sk-proj-****6789`): the check passes OpenAI's message verbatim, and `redact()` does not mask a key already masked.
2. **The start** (ruling 22; choice 6): the Logs show `session.opened` (out: the model, modalities, voice, detection, manual), `session.created` (its `expiresAt`), `session.update` (out: the configuration sent), `session.updated` (what the server confirmed: `outputModalities`, `audio`, `reasoning`, `maxOutputTokens`), then `response.anchor` with `translations: 0`. Record the time from Start to live. A configuration the server refuses → an `error` before `session.updated`, the start refused in OpenAI's words (`[OpenAI <code>] …`) — record any; if `session.updated` never comes, every start times out with "OpenAI did not start the session within 30 s.".
3. **Automatic turns, Normal** (rulings 3, 11, 23; choice 8): Japanese to English, several utterances with pauses: each source row appears at its commit (`input_audio_buffer.committed`, its `itemId`), fills as `conversation.item.input_audio_transcription.delta` frames arrive and settles at `.completed`; the translation plays once on the monitor and once in the virtual microphone, with karaoke by arrival — side by side with the old build; each translation sits under its own source as a stated pair, in the panel, the Electron subtitle takeover and the extension overlay; replay per translation row with keep-audio on; Stop mid-translation finalizes the rows and plays nothing after. Record from the Logs whether `response.output_item.added` precedes the assistant's `conversation.item.added` (the SDK leaves the order undocumented; `items.ts` pairs either way, choice 8), and whether that `conversation.item.added` carries a `previousItemId` equal to the source's `itemId`.
4. **The drift anchor** (ruling 2; choice 11): `response.anchor` at the start (`translations: 0`), then after the fifth completed translation (`translations: 5`), the tenth, and so on, once per count — each followed by a `response.created` and a `response.done` framed `outOfBand: true`, the latter with `usage`. Record each anchor's tokens (input, cached, output) and what the anchors cost per hour, twice that in Both (each leg anchors itself); and, over a session of 20 minutes or more with it on — nothing turns it off (ruling 2) — the translations' quality and any drift (answers instead of translations, the wrong target language, commentary). Whether it earns its cost is the open question below. An anchor makes no row: every anchor's `response.created` must read `outOfBand: true` (a `false` would make its text a translation row), and no `conversation.item.added` with `role: 'assistant'` should arrive between a `response.anchor` and its `response.done` (the SDK says none is sent out of band; if one arrives, `items.ts` opens an empty translation segment for it, with no text and so no row) — record either. **Execution (the adapter's review):** a typed text or a release made while an anchor runs goes up at once; watch for repeated `response.create` frames for one request — a new `eventId` each time, `waitedMs` rising by about one round trip — each answered by a `session.error` with `conversation_already_has_active_response`: the server refusing in-band responses while an out-of-band one runs, the queue asking again once per round trip until the anchor ends.
5. **Semantic detection** and its eagerness (Auto, Low, Medium, High): turn splitting changes; `session.updated`'s `audio` echoes `semantic_vad` and the eagerness; **Normal's thresholds** — threshold, prefix padding, silence duration — change splitting as the sliders say; the Speech section's summary follows each.
6. **Push-to-talk** (ruling 8; choice 12): a press and release with speech → `input_audio_buffer.commit`, `response.create` (`for: 'turn'`, `waitedMs` 0) — both sent in one call — then the server's `input_audio_buffer.committed`, then the translation under the press's source. A release before the playing translation's `response.done` → the commit at once, `response.queued` (`for: 'turn'`, `waiting: 1`), then its `response.create` after that `response.done`, `waitedMs` the wait, and its answer after that one ends; a release after `response.done`, while the audio still plays, goes up at once with no `response.queued` (the queue waits for the end of generation, not of playback). **Final fix wave ("Found during execution", item 9):** two releases (or a typed line, then a release) before the running response's `response.done` → one `response.create` after it, the rest framed as merged (`merged: 1`), and no second `response.create`; its translation sits under the later release (under the typed line in the second case), and the earlier release's source shows with no translation beside it, its words in that translation — record how that reads. A press with no speech → `input_audio_buffer.clear` (and the server's `input_audio_buffer.cleared`), no row, and nothing of it in the next turn's source text. Minutes idle between presses → the session survives. Push-to-translate routes the raw voice while the key is up.
7. **Typed text** (ruling 8; choice 24): shown at once as its own row — `conversation.item.create` (its `itemId`, `length`), then `response.create` (`for: 'text'`) — and its translation under it; three typed while a response plays → each shown at once, `response.queued` with `waiting` 1, 2, 3, then answered in order, one each, each translation under its own typed row; a blank line sends nothing. Under automatic turns, typed text while speaking. **Execution (the queue's review):** record whether a request's `response.created` carries its `metadata` (`{ request: "sokuji_<n>" }`) back. The Logs' `response.created` frame shows only `responseId` and `outOfBand`, so read the socket's messages in DevTools' Network panel; the queue works either way ("Found during execution", item 6).
8. **Speaking over a playing translation** (`interrupt_response: false`; choice 8): does the server answer the utterance — a `response.created` after the playing one's `response.done`? Either way it is its own source row, and the next translation pairs with the right source (its `previousItemId`). **Execution (the fallback, as landed):** record any translation row that shows with no source beside it: a translation the server ties to no input of the leg takes the newest input — by when the server came to hold it — only if still unanswered, else none, and then shows unpaired ("Found during execution", items 1 and 10).
9. **A mid-session error** (ruling 13; choice 14): a `conversation_already_has_active_response` refusal — item 7 under automatic turns (a typed text racing the server's own response), or item 4's anchor case, can provoke it; under push-to-talk the server starts no response of its own — is a red `session.error` line in the Logs, not a notice, and the request is asked again (a second `response.create`): after that response ends when the server's own response refused it; at once in item 4's anchor case — an out-of-band response the queue does not wait on — once per round trip, each with a new `eventId`, until the anchor ends. Any other mid-session `error`: its `session.error` frame's `type`, `code` and `message`; whether a close follows it, and after how long (tunes `ERROR_WORDS_MS`, 10 s): a close within 10 s reads in that error's words (`invalid_api_key` → the auth words, a spent quota → the rate-limit words), a later one as the lost connection. **Execution (the adapter's review):** record whether an `invalid_api_key` message quotes the key's last four characters — those words reach the `session.error` frame and a close's notice verbatim.
10. **Text only:** `session.opened` shows `modalities: ['text']`; no audio on the monitor or in the virtual microphone and no `response.output_audio.delta`; the translation streams as `response.output_text.delta` and shows as rows, paired as in item 3; the anchor unchanged.
11. **Both** (rulings 4, 15; D20): two sockets; the participant translated in the reverse direction, with Other's prompt in Advanced mode; its detection the user's own — the participant's `session.opened` shows the speaker's `turnDetection` (`server_vad` under Normal), not the old forced `semantic_vad`; its speech switch on → Other's translation heard on the real device, off → silent (its `session.opened` `modalities: ['text']`); either leg ending ends both; participant-only. An Auto-detect source refuses Both with "This provider can't translate the other participants for this language pair."; speaker-only with Auto-detect translates, the `session.update` frame's instructions naming "the spoken language" (ruling 7).
12. **Expiry and drops** (ruling 14; choice 14): a session past 60 minutes — against `session.created`'s `expiresAt` — ends in words. Record the `session.error` frame at the cap: `session_expired` is this plan's hypothesis, on which the run ends at once, "This segment has ended — tap Start Session to continue.", and the adapter closes the socket itself, so whether the server would have closed it does not show. If the code is another, the Logs show whether a `session.connection_lost` (its `code`, `reason`) follows, and the run ends in that error's words within 10 s, or as the lost connection. A network drop → "The connection was interrupted — tap Start Session in a moment to continue."; ask for both kinds — Wi-Fi off, and the router's upstream pulled with Wi-Fi up — and record the time until the words; nothing reconnects.
13. **Noise reduction** (ruling 16): `session.updated`'s `audio` echoes `null` for None and `near_field` / `far_field` otherwise.
14. **Reasoning effort** on a `gpt-realtime-2*` model: `session.update` carries `reasoning.effort` and `session.updated` echoes it, for each effort. An older listed model (`gpt-realtime`) starts with none sent and no Reasoning effort field in the view. **Execution ("Found during execution", item 3):** the same for the dated `gpt-realtime-2025-08-28`, if listed — record that it starts.
15. **The transcript model and keywords:** each of the five models starts (`session.updated`'s `audio.input.transcription`) and streams its source deltas; `gpt-transcribe` and `gpt-live-transcribe` accept `languages` and `keywords`, which the SDK does not type, and show the Keywords field.
16. **Max tokens:** Unlimited (`inf`) and a number: `session.updated`'s `maxOutputTokens`; a small number cutting a long translation — record its `response.done`'s `status` and `statusDetails`.
17. **An old profile** (rulings 5, 6, 12; choice 4): key, pair and settings saved by an earlier build with OpenAI selected → ready without re-entry; a stored `transportType: 'webrtc'` is not read and the session runs over WebSocket (`translation_session_start.transport` reads `websocket`; the owner abandoned WebRTC, 2026-09-29); a stored temperature changes nothing (none in `session.update`); a stored `'Disabled'` reads as automatic, the summary "Normal · …"; a stored `gpt-realtime` or `gpt-realtime-mini` runs as stored while Validate lists it, else as `gpt-realtime-2.1-mini` when listed, else as the newest listed — the Model select shows which; an edited global prompt opens as OpenAI Realtime's own.
18. **A stored OpenAI Compatible selection** (ruling 1): an Electron profile with OpenAI Compatible selected → the first provider offered is selected; the stored `settings.common.provider` still reads `openai_compatible` until a provider is picked; nothing else is written.
19. **Readiness narrowing** (ruling 9): with a valid key and Start on, moving a slider, choosing a voice or editing the prompt leaves Start on, and DevTools' Network panel shows no new `/v1/models` request; changing the key → one request about 800 ms after the last keystroke; changing the language pair re-checks too; after a refusal (a wrong key), a slider edit leaves it refused, and Validate asks again.
20. **The wizard:** the own-key list shows OpenAI Realtime between Doubao AST 2.0 and OpenAI Translate; its key step validates, and "How to get this key" opens the OpenAI guide.
21. **Analytics** (choice 20): `translation_session_start` with `provider: 'openai'`, the effective model as the translation model and the transcript model as the ASR model; a refused start → `api_error` with its code.
22. **The Logs panel** (choice 13): consecutive delta frames of one type grouped; `session.error` red; no key anywhere, the export included (the `session.update` frame carries the instructions, never the key); no `session.unreadable` in a healthy session; record any `session.unknown` and the `type` it names.
23. **Two sessions on one key** in Both: allowed? The rate-limit words ("The provider is limiting requests; try again shortly: …") if the account hits one, and the `rate_limits.updated` frames.
24. **The extension side panel:** Validate and a session under the extension's CSP — the check's fetch and the socket; no CSP error in the side panel's DevTools console.
25. **Each platform:** items 2, 3 and 7 on the web build, the extension and Electron; the Electron subtitle takeover and the extension overlay show the paired rows.

**Open questions for the owner**
- **The expiry code** (item 12): `session_expired` → `segment_ended` is a hypothesis; another code needs its line in `errorCode`. A fresh session at the cap, if the long session shows a fixed length (OpenAI Translate's question too).
- **`ERROR_WORDS_MS` and the error mapping** (item 9; choice 14): hypotheses until item 9's frames.
- **The request tag** (item 7): whether OpenAI echoes `metadata.request` on `response.created`; the queue works either way, and the rare loss of "Found during execution", item 6, remains either way.
- **The anchor's cost against its value** (item 4): what it steers is unmeasured, since the API keeps an out-of-band response out of the conversation; keep, space out or drop it — the owner's call once item 4's tokens and quality are in.
- **The queue during an anchor** (item 4): if the server refuses in-band responses while the anchor runs, the queue asks again once per round trip until it ends; tracking the anchor as active in the queue is a contained change.
- **An out-of-band item announced** (item 4; Task 7's review, X2): the SDK says `conversation.item.added` is never sent for a `conversation: 'none'` response (`realtime.d.ts:80`, `:1984-1985`) — a documentation-based inference. If one does arrive before its output item, `items.ts` opens an empty translation segment for it — owned by the one in-band response running, when there is one — which draws no row; its text never reaches it (every delta of an out-of-band response is dropped). Reading an announced item's owner only from `response.output_item.added` would avoid even that.
- **An unanswered utterance** (item 8): whether it should be asked a response of its own; parity says no.
- **The unpaired fallback** (item 8; "Found during execution", item 1): a translation the server ties to no input shows unpaired; if item 8 shows such rows in ordinary use, either L2 pairs a translation with no origin among sources that state one (an L2 change), or the fallback widens again.
- **One response per batch** (item 6; "Found during execution", item 9; the controller's ruling, confirmed by the owner on 2026-09-29): a batch's earlier release shows with no translation beside it. If that reads badly in the live test, the adapter could state the batch's inputs to L2 (a contract change); one `response.create` per release is not coming back — it asks the input-less responses item 6 would record.
- **A typed text re-asked with nothing new under automatic turns** ("Found during execution", item 9): refused as active, it can be answered by the server's own next response in the round trip before the queue asks again. The fuzz counts it; item 7 under automatic turns, typing while speaking, is where it would show — a `response.create` for a text whose item an earlier `response.done` already answered. Dropping the re-ask when a response created after the refusal follows the text's item is a contained change.
- **The restricted key** (item 1; ruling 17): if such keys prove common, the check could fall back to "unknown, allow Start" on a 403 whose message names a missing scope — OpenAI Translate's question, the same here.
- **Readiness narrowing for the other ported providers:** Gemini, OpenAI Translate, Soniox and Doubao are candidates, each declaring its `checkReads` in its own change.
- **OpenAI's own words reach the notices and the frames verbatim** (items 1, 9): the masked key tail in `invalid_api_key`'s message passes `redact()`; OpenAI Translate's question, the same here — decide with the error mapping after the live test.
- **The transcription hints** (item 15): `languages` and `keywords` were verified against the live API on 2026-08-01 only; a refused hint refuses the whole `session.update`, and so the start.
- **A same-language pair** (ruling 21): both legs read Other's prompt; naming the leg in `SessionContext` stays out.
- Analytics for `degraded` (Plan A's open question, unchanged).

**The merged deletion inventory** — OpenAI Translate's T3 and this port's old
code, one later plan, **after the two WebSocket live tests** (ruling 20, as the
owner's WebRTC decision amends it: first "after the WebRTC step's live test";
choice 23). It is one plan because `OpenAIWebRTCClient` imports `openAIRealtimeSession` and
`EphemeralTokenService.getToken`, `OpenAITranslateWebRTCClient` imports the
Translate GA client (`:38`), and `OpenAITranslateGAClient` imports
`OpenAIClient`'s statics. T3's list as it stands (the OpenAI Translate record
above), less its last item's condition — `settings.userTranscriptModel` and
`settings.transcriptModelTooltip` are reused by OpenAI Realtime's
`TranscriptionField` and stay — merged with this port's, read at `583df521`
(none of these files changed through `f9fe8747`, nor T3's since `8db4261f`):
- the clients and descriptors: T3's `OpenAITranslateGAClient.ts` (+ test), `OpenAITranslateWebRTCClient.ts` (+ test), `OpenAITranslateProviderConfig.ts`; and `OpenAIGAClient.ts`, `OpenAIClient.ts` (`isTranslateRealtimeModel` with it), `OpenAIWebRTCClient.ts`, `openAIRealtimeSession.ts` (each + tests), `OpenAIProviderConfig.ts`, `OpenAICompatibleProviderConfig.ts`, `openaiTranscriptionContext.ts` (+ test), `src/utils/textUtils.ts` (+ test);
- `EphemeralTokenService`: T3's translation mint (`:115-218`) and now `getToken` too — the file and its test; with no WebRTC step (2026-09-29) no mint moves, and only the two WebRTC clients import it. The diagnostics' comments that cite its lines as their example (`src/lib/diagnostics/describeCause.ts:24`, `report.ts:45`, `redact.ts:61`, and `report.test.ts`, `redact.test.ts`, `consoleLedger.consistency.test.ts`) keep or restate it;
- `IClient.ts`: `:76-115, 325-331` (`OpenAISessionConfig`, its guard) and T3's `:117-139, 333-335` (`TranslateTargetLanguage`, `OpenAITranslateSessionConfig`, its guard), with their members of the `SessionConfig` union (`:321`);
- `settingsStore.ts` — the storage keys stay: T3's `openaiTranslate` slice (`:41-43, 289, 419, 548-554, 655, 704, 753-773, 971, 1192-1196, 1349-1352, 1539, 1553-1557, 1623`, which hold Translate's key prefill from the OpenAI slice, `:753-773`, and `useTransportType`, `:1553`); the `openai` and `openaiCompatible` slices' readers (`:285-287, 415-417, 700-702, 967-969, 1535-1537, 1619-1621`), `migrateDeprecatedOpenAIModel` (`:556-588`, its call at `:1339-1345`), `forceWebrtcTurnDetectionOff` (`:647-653`), the model auto-select (`:1174-1191`); and `src/stores/openaiModelMigration.test.ts` whole (`:9-49` this port's, `:50-74` T3's);
- `src/types/Provider.ts:15, 32-42` (Compatible's id, `OPENAI_COMPATIBLE_PROVIDERS`, `isOpenAICompatible`; `Provider.OPENAI` at `:9` stays, the live provider's id) — the three ruling-1 cases that name `Provider.OPENAI_COMPATIBLE` (`providerPaths.test.ts` twice, `useApplySetup.test.ts`) switch to the string `'openai_compatible'` (cast), and stay;
- `ProviderConfigFactory.ts:3, 5, 62, 75-78` and T3's `:6, 63`; `src/services/providers/tutorialUrls.ts:18` (Compatible's guide; `:15`, OpenAI's, goes only with the map's last old reader — the new definition carries its own `guideUrl`);
- the old UI's branches: `ProviderSpecificSettings.tsx:4` (its import of `openaiTranscriptionContext`, found here), `:60, 385-387, 414, 424-426, 443-445`, and T3's `:129-184, 384-467, 722-954, 2173-2187, 2274-2280`; `LanguageSection.tsx:128, 142-148, 237-243` and T3's `:99, 154-160, 249-254, 331-364, 587, 673-678`; `ProviderSection.tsx:70-72, 462-468, 647` and T3's `:73, 478-479`;
- the old tests of the old code naming either id (`command grep -rln "Provider.OPENAI\b\|OPENAI_COMPATIBLE" src`, less the tests of live code: `providerPaths`, `setupDraft`, `lib/setup/providerPath`, `Tour/steps`, `tourContext`, `kizunaProviders`, `useApplySetup`);
- `providers.openaiCompatible.*` in 30 catalogs, and T3's orphans `settings.translateModelAvailable` and `settings.translateSourceParticipantWarning`; `openai-realtime-api` in `package.json` (`:189`) and the lockfile;
- **keep:** `LEGACY_SLICE_KEYS` (`src/lib/session/storedSettings.ts:61, 67`, and Translate's `:68`), so a stored selection of either still resolves; `settings.userTranscriptModel` and `settings.transcriptModelTooltip`.

**The roadmap's inheritance, item by item** (the plan's tables, as landed):
taken (and where), deferred (and why), or already done.

From "Scheduled by the Stage 2 foundation plan" (`:1291-1296` above) and plan
1d-1 (`:472-473` above):

| Item | Disposition |
|---|---|
| F15, the processed WebRTC track | the WebRTC step: this port is WebSocket (ruling 12). **Closed 2026-09-29** with the step: no adapter takes the runner's track ("The owner's WebRTC decision") |
| The D25 participant-leg fix | the WebRTC step, with `turns(s)` (ruling 12); the spec's open question moves with it (amendment 6). **Closed 2026-09-29:** D25 and the open question closed (amendment 18) |
| `busy`'s reader | closed by ruling 8: the adapter owns the queue; `busy` is still emitted (Task 11) |
| The drift anchor | built (Tasks 6, 11; ruling 2) |
| OpenAI's model migration | not ported (ruling 5; choice 4): a stated departure |
| `turnDetectionMode` → `autoDetection` through `legacyKeys` | replaced: the field stays, `'Normal'` or `'Semantic'` (choice 4); the spec amended (amendments 3, 11) |
| Compatible's `i18nKey: 'openaiCompatible'` | n/a: retired (ruling 1); the type's comment corrected (Task 3) |

From the Soniox plan's "Found here" (`:1740-1747` above):

| Item | Disposition |
|---|---|
| Readiness re-probes on every settings edit | met for OpenAI Realtime by `checkReads: []` (Tasks 3, 12; ruling 9); the others may declare theirs |
| `timing` after a 503 resume | n/a: no timing, no resume |
| `audio.range` after fill-in | applies: arrival ranges, restated within the final text through `speechRanges` (choice 9), re-anchored by L1 |
| The side latch | n/a: one leg per socket |
| Two TTS sockets per key in shared Both | its analogue, two sessions on one key, is live-test item 23 |
| `Conversation.afterAudio`'s pending drop | n/a: a translation opens at its assistant item or its first content, never after its audio |

From "Scheduled by the Stage 2 Gemini plan" (`:3005-3022`, `:3082-3093`
above):

| Item | Disposition |
|---|---|
| Leading audio: open the translation segment on audio | done here by construction: it opens at its assistant item or its first content (choice 8) |
| Name the leg in `SessionContext` | stays out (ruling 21): the anchor carries no leg name; a same-language pair's prompt is a stated departure |
| The readiness re-check on each instruction edit | closed for OpenAI Realtime (ruling 9); Gemini's own stays its open question |
| `session.closed` on Stop | the same: nothing after stop |
| The instructions of later ports | taken: Gemini's `InstructionsSettings`, `InstructionsField` and legacy keys (Tasks 5, 10) |

From "Scheduled by the Stage 2 Volcengine AST2 plan" (`:3744-3835` above):

| Item | Disposition |
|---|---|
| F14's owner, OpenAI Live | unchanged: `socket.ts` copied, to move with the others (choice 5) |
| Generic frame names grouped under Doubao's Logs keys | met: Task 4 pins it |
| A kit-wide "no ws(s) URL in a frame" rule | n/a: the URL carries no credential, and no frame carries the protocols (Task 11's no-leak case) |
| Each check opens a real session | n/a: a free model list |
| Superseded checks are never aborted | applies, harmlessly; rarer with `checkReads: []` |
| Dialect sources offered where the gate refuses them | n/a: every language is a target |
| `trackedClock`; the seam's fixed words | consumed (Tasks 6, 11) |

From "Scheduled by the Stage 2 OpenAI Translate plan" (`:4321-4340`,
`:4357-4367`, `:4428-4441` above):

| Item | Disposition |
|---|---|
| `pcmToBase64` / `base64ToPcm` at their third user | done (Task 1; choice 1) |
| A shared `boundedFetch` | done (Task 2; choice 2) |
| `NoiseReductionField`, for OpenAI Realtime to reuse | reused (Task 10) |
| The kit-level seeded lifecycle scenario | deferred to the WebRTC step (choice 21); the queue's own seeded test here (Task 8). **Reassigned 2026-09-29:** to the next port that wants it, Palabra next ("The owner's WebRTC decision") |
| T3 | merged with this port's deletion (ruling 20; this record's inventory) |
| The transcript field | built in the folder (Task 10); T3's orphan keys it reuses stay |
| The transport field | still the WebRTC step's (ruling 12; choice 18). **Closed 2026-09-29:** nothing to choose; `S.transportType` removed |
| A restricted key's fallback | parity here too (ruling 17) |
| OpenAI's own words in the notices | the same here (`errorWords`); carried as an open question |
| `ERROR_WORDS_MS` and a negative age | consumed (ruling 13) |

"Before any release from the branch" (`:4271-4294` above):
- The registry's order: extended by ruling 18, pinned in `registry.test.ts`.
- The wizard's own-key description: its "OpenAI" true for two providers now; OpenAI Live waits.
- The native-speaker checks: none (no new key).
- The release-flag cleanup at Stage 2's end: nothing added (OpenAI Realtime is unflagged).

**Stage 2 items from the roadmap this plan does not take:** the kit's parked items (`{ flush: true }` after an awaited answer, `FakeSocket`'s close codes, the virtual clock's `pending()` count, manual-end's segment check); the account's compile-time narrowing; `RunnerDeps.replayAudio`'s guard; the notice-code namespace; the release-flag cleanup at Stage 2's end.

What it leaves, for the plans that meet it (the plan's own list, as written;
then the items the reviews routed here, last below):
- **The merged deletion plan** — OpenAI Translate's T3, OpenAI Realtime's and OpenAI Compatible's old code, `textUtils.ts`, `openaiTranscriptionContext`, the `openai-realtime-api` dependency — after the WebRTC step's live test (ruling 20; this record's inventory). **2026-09-29:** after the two WebSocket live tests instead ("The owner's WebRTC decision").
- **The WebRTC step, for both OpenAI providers:** Realtime's transport and its dispatch in `start`, `C.transport` widened from `S.transportType`, D25's `turns(s)` and the participant's transport, the transport control, the ephemeral token, and the kit-level seeded lifecycle scenario (choice 21). **Removed 2026-09-29 (owner):** abandoned; each part closed, the ephemeral token deleted with the old code, and the kit-level scenario reassigned to the next port that wants it ("The owner's WebRTC decision").
- **Comments that still promise a WebRTC step**, in files the final fix wave did not touch: `src/providers/openai/provider.ts:23, 57` (the latter citing D25), `RealtimeSettings.tsx:23`, `RealtimeTurnDetection.tsx:32-33`; `src/providers/openai_translate/provider.ts:21`, `TranslateSettings.tsx:12`, `segments.ts:8`, `adapter.ts:4, 105`. Restate them WebSocket only, citing the owner's decision. **Done** in the commit after `b384ec59`.
- **Readiness narrowing for the other ported providers:** each declares its `checkReads` in its own change, with a case like Task 12's.
- **The copies to lift:** `socket.ts` with F14; `decodeServerEvent`, `errorCode` and `errorWords` at a third user, or after OpenAI Translate's live test. **`socket.ts` done** by the Stage 2 Palabra plan, without F14 (choice 1; `0e9ccff0`).
- **The owner's open questions** in this record, each with the live-test item that settles it.
- **Nothing on the old code:** the old descriptors, clients and slices stay compiled and unreachable, as the protocol documentation.
- **OpenAI Translate's error window** (Task 11's review, I1): its adapter suite pins `ERROR_WORDS_MS` only past the window (`openai_translate/adapter.test.ts:467`, at `+ 1`) — the gap this plan closed for OpenAI Realtime, at its inclusive edge and its value.
- **`gemini/config.ts:70`** cites "fix round 1" in a production comment, against the rule that production comments cite rulings, never a review or a round (Task 5's review, m1).
- **`checkReads`' unenforced obligation** (Task 3's review, m3): "every field that decides the credential fields must be listed" (`src/lib/provider/types.ts`) is checked nowhere; no provider is affected — OpenAI Realtime's credential fields are fixed. **Met by the Stage 2 Palabra plan**, whose provider is the first it reaches: Palabra's fields follow `authMode`, which its `checkReads` lists (choice 16); the obligation is still checked nowhere.
- **An orphaned socket on an unreachable path** (Task 11's re-review): a throw from `clock.setTimeout` or `signal.addEventListener` inside the opening executor would reject the start with the socket still open — an orphaned leg that would send `session.update` and a billed anchor. Unreachable in the app (`realClock`, a real `AbortController`); the cheap hardening is to arm the timer and the listener before `openSocket`, or to close the socket when the executor throws.
- **For the final review** (the ledger): the session-side guard's 5-second budget under parallel waves (Task 5, m3); `checkReads`' doc "the kept answer is keyed on these alone" reads as covering not-ready answers, which are never kept (Task 3's re-review); the temperature test's comment cites ruling 5 where the removal is ruling 6 (Task 6's fix round). **Settled by the final fix wave** (`eaaf8ead`): the guard's budget needs nothing (its slowest case runs in 0.93 s alone, and the full suite met no timeout); the doc reads "a kept ready answer is keyed on these alone", the spec's words; the comment cites rulings 5 and 6.

## Scheduled by the Stage 2 Gemini/AST2 follow-up plan

The Stage 2 Gemini/AST2 follow-up plan
(`docs/superpowers/plans/2026-09-29-client-contract-stage2-gemini-ast2-followup.md`,
plan commit `18bc6284`, written over `4f7c6b83`'s code) landed as the eleven
commits `a81b1e11` through `e27f173e` on `worktree-client-contract-stage2`
(`18bc6284..e27f173e`: **+1,853 / −231 lines across 31 files**). Then this
record with the spec's amendments. It ports no provider: it follows up two
ported ones, **Gemini** (`gemini`) and **Doubao AST 2.0** (`volcengine_ast2`),
on the evidence of the owner's own wire probes (`scripts/dev/wire-probe/`,
committed; their logs and reports git-ignored under
`.superpowers/wire-probes/`) — karaoke for both, which had none; Gemini's
default model, its push-to-talk release on Live Translate, its activity
handling and its language codes; Doubao's subtitle pieces; and one generic L1
change, an `audio` range after the punctuation fill-in measured as a
`speechRanges` range is. No contract change, no new locale key, no store or
view change. Eight implementation tasks ran in the plan's three waves: Wave 1,
Tasks 1–5 in parallel; Wave 2's Task 7 once Tasks 3, 4 and 5 were committed,
beside Task 5's test-only fix round, and its Task 6 once Task 2's fix round
had landed (its sentence-mode test consumes choice 19); Wave 3's Task 8 once
Task 7 was complete, beside Task 6 — Doubao's folder against Gemini's. The
group check followed Wave 3. Tasks 2, 5 and 6 took one review fix round each;
Tasks 1, 3, 4, 7 and 8 were approved as their implementers committed them.
Task 9 is this record, written for the controller. The plan runs before the
Stage 2 Palabra plan.

**The pre-flight.** The plan's writer applied it block by block to a fresh
copy of `4f7c6b83`, and again from a fresh copy after its review (Ready after
fixes; F1–F7 applied): after the three waves 556, 557 and 557 files passed and
1 skipped, 7,068, 7,094 and 7,097 tests passed and 2 skipped, no unhandled
errors; the full tree's typecheck at 259 lines and the gate at its 20 after
each. The controller's scan found every shared file and interface ordered by
the waves (Tasks 1 → 6 on `segments.ts`, Task 2 → 6 on choice 19, Tasks
3/4/5 → 7 → 8 on Gemini's files), so no ruling was needed before Wave 1.

**The rulings.** Rulings 1–6 are the owner's (2026-09-29, on his probes'
evidence; the plan's header), each confirmed as the plan states it:
1. Doubao AST 2.0: whole-sentence karaoke keyed by the server's times — a TTS
   sentence's `startTime` / `endTime` equal its translation subtitle's (8 of 8
   in the probe), so its clip takes that whole subtitle's range, stated once
   the subtitle's text is final and lined up with the display cut by
   sentences; a sentence whose times match no subtitle stays rangeless.
2. Gemini: karaoke by arrival, the honesty rule's third stated exception,
   OpenAI Translate's and OpenAI Realtime's construction.
3. Live Translate is Gemini's default model when the check lists it; no
   one-time migration code.
4. A push-to-talk release on Live Translate gets a real-time silence tail,
   quiet 1 s, at most 3 s, counted in frames.
5. Gemini's `activityHandling` per model family: 3.x and later dialogue models
   `START_OF_ACTIVITY_INTERRUPTS`; 2.5 and Live Translate `NO_INTERRUPTION`.
6. Gemini's language offer rebuilt from Google's documented codes, per model
   family; a stored pair that no longer matches falls to the default, with no
   migration code — a stated departure for the release note.

Choices 1–19 are the plan's, inside those rulings, each cited where it lands.
The controller's rulings during execution are recorded below, under "Found
during execution" and "What it leaves".

What landed, by task:
- **Doubao's subtitle pieces, joined** (`dc229688`, Task 1; choice 1; the
  plan's research note 1): a `Response` subtitle frame is a piece of the text,
  not the text so far — the probe's zh → en source arrives as `W`, `ing`,
  `使用`, `实时`, `翻译`, `，`, then an `End` of `Wing使用实时翻译，`.
  `Ast2Segments` keeps each side's pieces since its last `Start` or `End` and
  shows their join; an `End` replaces it with its own whole text and closes;
  an empty piece sends nothing, a blank one joins. The false-start rule, the
  one segment per `Response` run and the refs are as landed.
- **L1: an `audio` range after the fill-in, and a held clip's entries past the
  ceiling** (`cfcee4d1`, fix round `0a86fc39`, Task 2; choices 19, 6):
  `Conversation.audio` measures a range on a segment whose text the fill-in
  replaced against the adapter's own text (`unfilled`), re-anchors it onto the
  filled one, and drops one that reaches past it with `range_out_of_text`,
  keeping the pcm; `afterAudio`'s last loop empties a held list's pcm
  (`EMPTY_PCM`) and keeps its entries, so a later `speechRanges` still names
  them and the clip keys stay aligned. **As landed**, one shared measurement
  and a clamp on a closed segment ("Found during execution", item 1).
- **Gemini's karaoke by arrival** (`a1a91e7e`, Task 3; ruling 2; choice 7):
  `GeminiTurns.audio` gives each played chunk `[spoken, text.length]`, `spoken`
  kept per open translation, `[0, 0]` before any text; a dialogue model's
  audio opens its turn's translation, Live Translate's audio outside an open
  translation stays unattributed (the Gemini plan's choice 8, unchanged); on
  Live Translate a chunk with no new text since the last is zero-width, so
  karaoke holds and never advances on silence.
  `src/providers/gemini/karaoke.test.ts` pins both kinds end to end.
- **Live Translate, the default** (`a81b1e11`, Task 4; ruling 3; choice 8):
  `defaultGeminiModel` answers the newest listed Live Translate, else the old
  rule (the newest `native-audio` model, else the newest, else `''`); nothing
  is migrated — a saved model the check lists stays, an unset or unlisted one
  resolves to the default at use. The probe's dialogue run takes the default
  among the dialogue models. Every pinned default moved: `settings.test.ts`,
  `config.test.ts`, `GeminiSettings.test.tsx`, `provider.test.ts`.
- **The release tail** (`121c0801`, fix round `570f9e46`, Task 5; ruling 4;
  choices 10–13): `src/providers/gemini/tail.ts` — `ReleaseTail`, `FRAME_MS`
  100, `TAIL_QUIET_MS` 1,000, `TAIL_MAX_MS` 3,000, `TailEnd`, `TailSummary` —
  OpenAI Translate's tail copied less its pad, ending after 10 quiet beats or
  at 30. Under manual turns on Live Translate, a release (a cancel too) frames
  `turn.tail`, sends one 100 ms frame of 24 kHz silence per beat inside the
  press's activity, and when the tail ends frames `turn.tail_end` (`reason`,
  `silenceMs`, `lastOutputMs`, `cancelled?`) and sends `activityEnd`
  (`realtime_input.activity_end`); quiet counts transcriptions of either side
  only; a press, audio or typed text ends it, its `activityEnd` first; a stop
  or a reconnect drops it silently. A dialogue model sends `activityEnd` at
  once. The fix round (test-only): "Found during execution", item 2.
- **Doubao's whole-sentence karaoke** (`bb546622`, fix round `e27f173e`, Task
  6; ruling 1; choices 2–5): `Ast2Segments` keeps the server times of the last
  `MATCH_WINDOW` = 8 translation subtitles; `sentence(times)` takes a
  `TTSSentenceStart` as the lock read then and the times it carries;
  `clipFor(sentence)`, called as the decoded clip goes to L1, names the recent
  translation whose start and end both equal the sentence's (`endTime > 0`),
  `matched` for the first clip to carry them, else the lock's, and ranges it
  `[0, length]` when that subtitle has closed; a matched clip emitted while it
  is open is ranged at its close by one `speechRanges`; every clip on a recent
  ref is counted, so an entry is named by its place among the ref's audio; a
  translation never shown leaves the list. `Ast2Speech` takes the `ClipFor`
  callback; the adapter frames `tts.sentence_start` with the times and
  `tts.clip` per clip. `src/providers/volcengine_ast2/karaoke.test.tsx` pins
  the display cut by sentences end to end, in the panel's list and the
  subtitle's bands, with the fill-in landing before the clip and after it.
  The fix round: "Found during execution", item 3.
- **Activity handling per model family** (`9a7a7e8f`, Task 7; ruling 5; choice
  9): `geminiActivityHandling(model)` in `settings.ts` — Live Translate
  `NO_INTERRUPTION`; family 3.0 or later `START_OF_ACTIVITY_INTERRUPTS`; 2.5
  and below, and an unversioned id, `NO_INTERRUPTION`;
  `GeminiConfig.activityHandling`, always set by `buildGemini`; `setupFrame`
  writes it where
  the old client hard-coded `NO_INTERRUPTION`; `wire.oracle.test.ts` pins both
  values against the SDK's converter; `session.opened` frames it. The fixtures
  gain `BARGE_IN` (`gemini-3.8-live`); the probe sets it from the same
  function. It follows the model alone: both legs, both turn modes.
- **Google's language codes, per model family** (`1558d161`, Task 8; ruling 6;
  choices 14–18): `GEMINI_LANGUAGE_TABLE`, 101 rows — the Live API's 99 and
  Live Translate's own `jv` and `su` — English first, then Google's order by
  English name, each with its own name (a static table, choice 15) and
  Google's English name for the instructions; `GEMINI_DIALOGUE_LANGUAGES`
  (99), `GEMINI_TRANSLATE_TARGETS` (78), `GEMINI_TRANSLATE_SOURCES` (101);
  `sources` / `targets` by the saved model's family, `''` read as Live
  Translate; `initial` `en` → `ja`; `migratePair` (choice 17);
  `toTranslationLanguageCode` removed, the target sent as the pair holds it;
  a Live Translate target outside its 78 refused at build in words
  (`config.ts:55-56`, choice 18). Every fixture and test naming an old code
  moved. The review checked the data against Google's tables both ways (99
  and 78 exact, `jv` and `su` the only Live Translate-only rows) and all 101
  names against CLDR (93 equal ignoring case, the other 8 stylistic).

**The spec's amendments** (this record's commit), the plan's ten, each at its
anchor, as landed:
1. D4: a range by arrival is a stated exception, not a real range — OpenAI
   Translate's, OpenAI Realtime's and Gemini's; Doubao's whole-sentence range
   is a real one (ruling 1).
2. "What every adapter must honour", the `frame` bullet: Gemini's
   `turn.tail` / `turn.tail_end` need no `logStore` row; Doubao's
   `tts.sentence_start` keeps its row with the times added, and `tts.clip`
   needs none (choice 5).
3. "Turns" → "What each provider can do", the Gemini row: barge-in for family
   3.0 or later (ruling 5; choice 9); the release tail on Live Translate
   (ruling 4; choices 11, 12); "immediate; Live Translate after silence".
4. "Turns" → "The design", the Gemini row: `beginTurn`, `endTurn` and
   `cancelTurn` on Live Translate (choice 11; ruling 4); after the table, a
   dialogue model gets no tail (choice 13), and **as landed**, typed text ends
   a tail as a press does, and a stop or a lost connection drops it silently.
5. "Provider capability": Gemini's karaoke by arrival, the third stated
   exception (ruling 2; choice 7); Doubao's per TTS sentence, keyed by the
   times (ruling 1; choices 2–4), its old "need not align" wording gone, and
   its pairing column noting the probe's evidence for stated pairing.
6. "Risks", the karaoke bullet: Gemini's arrival ranges the third exception;
   Doubao's no exception.
7. "Readiness is one check", the effective-model paragraph: Gemini's default
   the newest listed Live Translate (ruling 3; choice 8); nothing migrated.
8. "Languages are two functions": the offer may depend on the settings — a
   paragraph on Gemini's per-family offer (ruling 6; choice 16), the refusal
   (choice 18) and, **as landed**, a key that lists no Live Translate running a
   dialogue model on Live Translate's offer; the codes paragraph — Google's
   codes, the badges "JA" / "ZH-HANS", `migratePair` and the stated departure
   (choice 17), the generic fall on a narrowing switch.
9. L0's `speechRanges` paragraph and "Re-anchoring on every text replacement":
   an `audio` range after the fill-in measured as a `speechRanges` one is
   (choice 19). **As landed**, both through one shared measurement
   (`Conversation.measure`), and an `audio` range on a segment already closed
   checked against its settled text at once, as a `speechRanges` range is
   ("Found during execution", item 1).
10. "Migration", items 3 and 4: Gemini's five and Doubao's one, by this plan.

**Checked — the gates.** Every implementer ran the suite and the typecheck
gate on its own commit. In the parallel waves a failure in another task's
uncommitted files was named and left to it — Task 2 saw `turns.test.ts` fail
during Task 3's work and `adapter.tail.test.ts` during Task 5's; Task 6 saw
Gemini failures from Task 8's work in progress — and 5-second load timeouts
under Wave 1's load (`spine.e2e`, `providerOrder`, `nativeModelStore`,
`kizunaProviderGating` among them) passed re-run alone. The controller's quiet
run that closed Wave 1: 556 files passed and 1 skipped, 7,068 tests passed and
2 skipped, 0 failed, no unhandled errors — the plan's wave-1 reference; the
gate at its baseline. The suite grew from 553 files passed and 1 skipped,
7,035 tests passed and 2 skipped at `4f7c6b83` to 557 files passed and 1
skipped, 7,100 tests passed and 2 skipped at `e27f173e`; the gate — the plan's
regex, unwidened — at its 20 lines throughout, and the full tree at 259.
Task 6's implementer wrote its tests and code together and captured no
genuine red; the review reproduced it on `0a86fc39`'s source in a scratch
copy — 26 failed and 136 passed of 162, the brief's red exactly — and killed
9 of 10 mutants, the survivor a tolerance in the time match (item 3 below).

**Checked — the group check** (at `1558d161`; Task 6's fix round after it is
test- and comment-only):
1. the suite: 557 files passed and 1 skipped, 7,099 tests passed and 2
   skipped — the plan's 7,097 and Task 2's two fix-round tests — no unhandled
   errors; `src/services` 49 files, 1,039 tests, the old clients untouched; the
   gate at its 20 baseline lines, the full tree at 259;
2. `npm run build` and `npm run extension:build`; `npx vitest run extension`
   45/45 (7 files); the three D24 greps empty; "Live Translate does not
   translate into", a phrase only the new refusal holds, in
   `build/static/index-Cps1TtbG.js` and `extension/dist/fullpage.js`;
3. **rendered**, on a fresh vite (port 5199, headless port 9341;
   `/?preview=spine&provider=gemini`, each run a fresh profile, no key typed,
   Start never pressed): a fresh profile → English → Japanese, 101 sources and
   78 targets, English first, `中文 (繁體)` and `Português (Portugal)` among the
   targets, `Basa Jawa` in both; `settings.gemini.model` set to the 2.5
   native-audio model → 99 and 99, no `Basa Jawa`;
   `settings.gemini.sourceLanguage` / `targetLanguage` stored as `en-US` /
   `cmn-CN` → shown English → Japanese, both keys still `en-US` / `cmn-CN`
   after the reload
   (nothing written; choice 17); no request to `googleapis.com` or
   `bytedance.com` in any run. The report, probe and screenshots are under
   `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/group-check/` (`ui-report.md`,
   `step1-fresh.png`, `step2-dialogue-model.png`, `step3-legacy-pair.png`).

After Task 6's fix round (`e27f173e`): 557 files passed and 1 skipped, **7,100
tests passed and 2 skipped**, no unhandled errors — the final count.

**Found during execution** — what execution changed beyond the plan, each
from a controller's ruling in the ledger, with its reason and where it lives:
1. **One shared measurement in L1, and `audio` clamped on a closed segment**
   (Task 2's review, I1 and M1; `0a86fc39`). The plan wrote the fit / report /
   re-anchor rule inline in `Conversation.audio()`, a second copy of
   `ranges()`' rule; the review found the duplication the very defect class F1
   was, two hand-kept copies of one rule. As landed: one private
   `measure(ref, seg, ranges)` (`src/lib/conversation/Conversation.ts:278-286`)
   that `audio()` (`:260`) and `ranges()` (`:316`) both call, behaviour
   unchanged — an 11-row equivalence check re-run by the implementer and the
   re-reviewer. And `audio()` now clamps a ranged entry on a segment already
   final (`:264`), as `ranges()` does (`:320`), so a range past a closed
   segment's text is dropped and reported whether its audio came before the
   close or after it (`Conversation.test.ts:132`); the re-review found no
   adapter before Doubao's matched clips that sends a range for a segment
   already closed. Beside it, a test that a range stated for the second of two
   held clips lands on it after the ceiling dropped only the first's pcm (M2;
   `:528`). Cost if wrong:
   an adapter's out-of-text range dropped with a report instead of kept
   silently until the next revision. The spec's amendment 9 says both.
2. **The tail's tests strengthened** (Task 5's review, M1 and M3; `570f9e46`,
   test-only): the stop test asserts no timer right after `stop()`
   (`adapter.tail.test.ts:112`) — it could not fail before, since an
   uncancelled tail ends itself at 1.1 s; a mutant without the tail's cancel
   in `shutdown()` now fails it — and the session-side guard's Gemini roster
   lists `tail.ts` (`sessionSide.consistency.test.ts:210`), as Translate's
   lists its own. Cost: none.
3. **The time match pinned exact** (Task 6's review, M1 and M3; `e27f173e`): a
   one-millisecond near miss names no translation and falls to the lock
   (`segments.test.ts:199`) — a ±500 ms tolerance mutant passed every test
   before, and fails this one; and `speech.ts`' header states the range rule
   right: a matched clip emitted while its subtitle is open is ranged later,
   through `speechRanges` ("else none now — ranged at the close when matched,
   else replay only"). Cost: none.
4. **A barged-in answer's `interrupted` and its trailing `turnComplete` are
   one end** (the final review, I1; `58ee9e5c`). On a 3.x model, which barges
   in (ruling 5), the `turnComplete` that follows `interrupted` by about 5 ms
   (the plan's research note 8) consumed a voiceless press's pending drop (the
   Gemini plan's ruling 8), so the model's reply to that press was shown —
   reproduced through the adapter when the release reaches it before
   `interrupted`, or between the two. `GeminiTurns` now keeps a flag from
   `interrupted` until any content (a transcript of either side, audio, a text
   part, typed text) or a lost connection, and a `turnComplete` while it is
   set ends nothing more; the turn counter no longer skips a number, now
   pinned in the adapter's barge-in case (`t1`, `t2`). The spec's Gemini
   `cancelTurn` cell states the rule; live-test item 17 watches it. The suite
   after it: 557 files passed and 1 skipped, 7,112 tests passed and 2 skipped,
   no unhandled errors; the gate at its baseline. Cost if wrong: a server that
   sent `interrupted` with no `turnComplete` after it, and then an answer with
   no content at all, would have that answer's end taken as the rest of the
   `interrupted`. The review's six minors are wording, fixed in place: the
   zero-width chunk (a chunk with no new text since the last), `audio.range`
   after fill-in (every provider; Doubao's matched clips the only current
   caller), the AST2 accepted item ("already dropped"), the instructions'
   names, a test title citing choice 3, and live-test item 16.

**Stated departures from today** (the plan's list, as landed):
- a live Doubao row now grows piece by piece where it showed only the newest piece (choice 1; research note 1);
- a Doubao clip's ref comes from the server's times when they match, the lock only when they do not (choice 2);
- Gemini's default model is Live Translate — a fresh profile, and a saved model no longer listed, run it (ruling 3);
- a Live Translate release keeps its activity open up to 3 s (ruling 4);
- a 3.x dialogue model barges in (ruling 5);
- **a Gemini pair saved before this plan falls to English → Japanese, except a side stored as `pt-BR`, the one old code Google still documents; nothing is written, so it falls on each load until re-picked; the other 33 old codes are gone** (ruling 6; choice 17) — for the release note;
- known generic behaviour, not new: a model switch that narrows the offer falls to the list's first entry, English, even to English → English;
- the instructions name Google's English names ("Chinese (Traditional)"; Chinese and Portuguese keep their variant in parentheses), where the old named "Mandarin Chinese (China)", and Live Translate is sent Google's codes (`zh-Hans`, never measured; the old sent `zh`).

Where the plan departs from its brief — Tasks 1 and 2 were not asked for,
Live Translate's sources are the 99 and its own two, the pair's fall uses
`migratePair` — stays in the plan's self-review.

**Before any release from the branch**
- **The owner's live test below**, before any release that carries these
  changes.
- **The release note's line on Gemini's pairs:** a pair saved before this
  plan shows English → Japanese (a `pt-BR` side excepted) until re-picked.
- **A native-speaker spot check of the 101 display names** (choice 15),
  `中文 (简体)` / `中文 (繁體)` above all. No locale key is added.

**The owner's live test** (own credentials; switch diagnostic logs on in Help
before Start; each item names what settles it; what execution added is
marked):
1. **Doubao karaoke, pause and sentence modes** (ruling 1; choices 2–5): zh → en and ja → zh; each translation lights over its clip, in the display cut off, by pause and by sentences (1 per row), in the panel and the subtitle; the Logs' `tts.sentence_start` frames carry times equal to the translation's `subtitle.translation` `end` frame, and each `tts.clip` reads `matched: true` with the row's ref — record how many read `matched: false`.
2. **A subtitle that changes before its `End`** (research note 1; choice 4): the row grows piece by piece while it streams; where the `End`'s text differs from the pieces, the karaoke still spans the final text; a sentence that starts before its translation's `End` (watch `tts.sentence_start` before `subtitle.translation` `end`) lights only once the row is final. **Execution (Task 6's review, M5):** a matched clip whose translation has not closed when the session ends stays rangeless — its range is stated only at the subtitle's close, and the teardown closes none (the probe always sent the `End` before `SessionFinished`); record any `tts.clip` with `matched: true` and `range: null` whose row never lit.
3. **Doubao with "Keep audio for replay" on** (ruling 1): replay per sentence plays each translation's clip, and a replayed clip lights as it did live. (Choice 6's ceiling path is not reached live — `afterAudio` drains every segment's pcm before a held list — so its unit tests are its proof.)
4. **Gemini karaoke on Live Translate and on a dialogue model** (ruling 2; choice 7): Live Translate lights phrase by phrase and holds through silence; the 2.5 and 3.8 dialogue models light across each answer; audio before a translation's first text lights nothing until its text arrives.
5. **Live Translate the default** (ruling 3): a new profile runs `gemini-3.5-live-translate-preview` (the Logs' `session.opened`); a stored profile with a saved dialogue model keeps it; a stored profile that never picked a model now runs Live Translate; a key that lists no Live Translate runs the newest native-audio model. **Execution (Task 8's review, M1):** on that key, with no model saved, the language lists show Live Translate's offer (101 sources, 78 targets) while the dialogue model runs; with a single listed model the offer cannot be left — the model field is a native select, and choosing the model already shown changes nothing. Record how it reads ("What it leaves").
6. **Push-to-talk on Live Translate** (ruling 4; choices 11, 12): a press's last words arrive before the next press — the Logs read `turn.tail`, then `turn.tail_end` (`reason`, `silenceMs`, `lastOutputMs`), then `realtime_input.activity_end`; a press during the tail ends it (`reason: 'press'`); tune `TAIL_QUIET_MS` and `TAIL_MAX_MS` from `lastOutputMs`.
7. **3.8 overlap with barge-in** (ruling 5; choice 9): a second utterance while the first's translation still plays — both transcribed and translated, the first's translation whole (`session.opened` reads `activityHandling: 'START_OF_ACTIVITY_INTERRUPTS'`). Known risks, one probe run per setting: speaking again within about a second of the first utterance's end cuts a 3.8 translation still generating; 3.8's mandatory proactive audio may still skip input; `gemini-3.1-flash-live-preview` (family 3.1, now barge-in) was not measured.
8. **2.5 unchanged** (ruling 5): `NO_INTERRUPTION`; both translations whole in the same overlap.
9. **Languages** (ruling 6; choices 14–18): a stored Gemini pair from before falls to English → Japanese (a side stored as `pt-BR` stays), and again after a reload until a pair is picked; the 99 / 78 offers follow the model picked; Traditional Chinese (`zh-Hant`) and `pt-PT` translate on Live Translate; a Live Translate pair with an Assamese source refuses Both in the participant notice's words; a dialogue model translates into Faroese; the row badges read "JA", "ZH-HANS".
10. **Doubao in `s2t` mode** (choice 1; a text-only leg, or the participant leg): are `Response` frames pieces there too? Both probe runs were `s2s`. A row whose text doubles until its `End` means `s2t` sends snapshots, and choice 1 must split by mode.
11. **Doubao karaoke in the display cut by sentences with the punctuation pack installed** (choice 19): ja → zh, a translation that ends without a sentence end (the probe had three in eight): the fill-in adds its marks, the karaoke reaches the last character, and the row stops being tinted as playing once its clip ends.
12. **Live Translate into `zh-Hans` and `zh-Hant`** (ruling 6): Simplified Chinese, the likeliest target — the old code sent `zh`, measured to come back Simplified (`settings.ts:169-170` at `4f7c6b83`); the new one sends Google's `zh-Hans`, never measured. **Execution (Task 8's review, M4):** the old code also recorded `cmn` coming back Traditional; the new one sends `zh-Hant`, never measured either. Each is one probe run, with network allowed: `GEMINI_API_KEY=… npx tsx scripts/dev/wire-probe/gemini.mts translate --dst zh-Hant` (and `--dst zh-Hans`).
13. **3.8 under push-to-talk** (ruling 5; choice 9): a press while the previous translation still generates — record whether barge-in cuts it, and how often.
14. **A voiceless press on Live Translate** (choice 12): the tail runs, framed `turn.tail` `{ cancelled: true }`, and `turn.tail_end` follows.
15. **3.x barge-in with the model's own voice in the room** (ruling 5; choice 9): on the participant leg, or under automatic turns with speakers, the model's output echoed into capture must not cut its own response.
16. **Typed text on a 3.x model while an answer streams** (ruling 5; the Gemini plan's choice 17). **Execution (the final review, M6):** under manual turns the text is wrapped in `activityStart` / `activityEnd`, so on a model that barges in it cuts the answer in flight — record whether `server_content.interrupted` follows `realtime_input.text` and whether the cut answer's row stays as it stood; under automatic turns, whether a text input interrupts is unknown — record whether it does.
17. **A voiceless tap on 3.8 under push-to-talk while an answer streams** (ruling 5; the Gemini plan's ruling 8). **Execution (the final review, I1; `58ee9e5c`):** the adapter counts `interrupted` and a `turnComplete` with no content between them as one end, so the tap's own answer is dropped whether the release reaches it before `interrupted` or after. Record the order of `realtime_input.activity_end` (`cancelled: true`) and `server_content.interrupted` in the Logs, and whether a reply row appears for the tap.
18. **A double press on a dialogue model** (the Gemini plan's ruling 8; the final fix wave's re-review). **Changed by the owed flag's fix (`f7bdb8bb`; "What it leaves"):** on 2.5, speak over an answer and release while it streams, then tap before your own reply starts; on 3.8, type text during an answer, then tap. The spoken (or typed) row must survive with its own translation and audio, and no reply to the tap may show. Watch the fix's one assumption, that a press released while an answer streams gets an answer of its own after it: record whether the Logs show a `turnComplete` for that answer before the tap's. Where the model folds the press into the streaming answer instead, the tap's reply shows — record that too. Then the order the fix moved: on 2.5, within one answer, tap, then speak and release, then tap again, all before your reply starts — on a model that answers an empty press the first tap's queued answer takes the spoken row's claim, so the spoken row and its translation vanish and both taps' replies show (where the flag before `f7bdb8bb` kept it); with no answer to taps the spoken row survives. Record which, and whether the Logs show a `turnComplete` for each tap. The flag against a count is the open question "The owed flag vs a count" below. Live Translate is not affected (it has no turns).

**Open questions for the owner**
- **Stated pairing for Doubao** (live-test item 1; the AST2 section's item 7): every source subtitle carries its translation's server times in the probe — the evidence for stating origins from them; not ruled.
- **A sentence whose times match nothing** (item 1's `matched: false` count): should it still be ranged on the lock's row? Parity says no.
- **Live Translate's sources** (item 9; choice 16): the 99 and its own two, against the recommendation's "the 99".
- **The tail's constants** (item 6): `TAIL_QUIET_MS` and `TAIL_MAX_MS` from `lastOutputMs`.
- **Barge-in's cost on 3.8 under push-to-talk** (item 13).
- **The 2.5 dialogue model's Japanese input transcription** came back as " ." in the probe: server behaviour, not fixed here.
- **A key without Live Translate on a fresh profile** (item 5; "What it leaves"): offer and run disagree; a fix needs the check's model list in the language context.
- **The owed flag's limit on dialogue models** (item 18; "What it leaves"): land the `owedNext` fix now, or once the live test shows a press lost? **Done**: the owner ruled it fixed now (2026-09-29), landed in `f7bdb8bb`; item 18 now checks the fix and watches its assumption.
- **The owed flag vs a count** (item 18; the Gemini section's live-test item 6; "What it leaves"): keep the flag for now. A count (or a queue of expected answers) is feasible and small, but it rests on whether Gemini answers each activity separately — decided by the Gemini section's item 6: how many `turnComplete`s follow two quick voiced releases, and whether an empty activity is answered at all.

**Amended in place** by this record, each marked "**Changed by the Stage 2
Gemini/AST2 follow-up plan**" or "**Done** by the Stage 2 Gemini/AST2
follow-up plan":
- the Gemini section: its ruling 2 (the default), its stated departure on the
  default model (ruling 3), its "Found during execution" item 4 (the owed
  flag; `f7bdb8bb`), live-test items 2 (the default), 3 ("no karaoke",
  and the old badges), 4b (speech during an answer on 3.x: barge-in by
  family), 5 (push-to-talk on Live Translate: the tail) and 6 (what decides
  the owed flag against a count; `f7bdb8bb`), the open question
  on 3.1 dropping speech during its answer (ruling 5), and the inheritance row
  "`audio.range` after fill-in — n/a" (arrival ranges now);
- the Volcengine AST2 section: live-test items 3 ("no karaoke") and 13 (the
  `tts.sentence_start` frame with the times, beside `tts.clip`), the accepted
  item "Task 8, M4" and the stated departure it names (now only on the lock's
  fallback), the "What it leaves" item "Stated origins for Doubao" (the probe's
  times the evidence; still not taken), and the inheritance rows
  "`audio.range` after fill-in" and "`Conversation.afterAudio`'s pending drop"
  (both apply now, both closed by Task 2);
- the Soniox section's "Found here" items on `audio.range` after fill-in and on
  `Conversation.afterAudio`'s pending drop: done (Task 2; choices 19 and 6).

**The roadmap's inheritance, item by item** (the plan's table, as landed):
taken (and where), or left (and why).

| Item | Disposition |
|---|---|
| The Gemini section: live-test item 2 (the default model) | changed: Live Translate (Task 4; ruling 3) |
| The Gemini section: live-test item 3, "no karaoke" | changed: by arrival (Task 3; ruling 2) |
| The Gemini section: item 4b and the open question on 3.x dropping speech during an answer | met by barge-in for family 3.0 and later (Task 7; ruling 5); the live test settles it (items 7, 13, 15) |
| The Gemini section: item 5, push-to-talk on Live Translate | met by the release tail (Task 5; ruling 4) |
| The Gemini section: its open question "Live Translate's leading audio" | left: audio outside an open translation stays unattributed (ruling 2) |
| The Volcengine AST2 section: live-test item 3, "no karaoke", and item 13, the lock | changed: whole-sentence karaoke by the times, the lock the fallback (Task 6; ruling 1) |
| The Volcengine AST2 section: "Stated origins for Doubao" | left: the probe's times are the evidence; not ruled ("What it leaves") |
| The Soniox section's "Found here": `Conversation.afterAudio`'s pending drop | done (Task 2; choice 6): Doubao can now reach it in form; no live session is likely to |
| The Soniox section's "Found here": `audio.range` after fill-in | done (Task 2; choice 19): an `audio` range on a segment the fill-in replaced is measured against the adapter's own text and re-anchored, as `speechRanges` is — through one shared `measure`, as landed — for every provider; Doubao's matched clips (on their common path in sentence mode, research note 10) are the only current caller |
| OpenAI Translate's tail | copied, not lifted (choice 10); the lift waits for a third user or Translate's live test |

What it leaves, for the plans that meet it (the plan's own list, as written;
then the items the reviews routed here, last below):
- **Stated pairing for Doubao:** every source subtitle carries the same server times as its translation in the probe; a later change could state origins from them (the AST2 plan's choice 3 left the question open).
- **The release tail's lift** to `src/lib/contract/` at its third user, or after OpenAI Translate's live test. Until then `src/providers/gemini/tail.ts` repeats `src/providers/openai_translate/tail.ts:88-146` line for line (Task 5's review, I1; plan-mandated, choice 10): a fix to one copy's beat logic is mirrored by hand in the other.
- **The pair's fall on a model switch:** a switch that narrows the offer falls to the list's first entry, English, by the generic rule (`normalizePair`) — an English source's pair then reads English → English (choice 17). Generic behaviour for every provider whose offer depends on its settings; not changed here.
- **The 2.5 dialogue model's Japanese input transcription** came back as " ." in the probe: server behaviour, not fixed; the source row stays empty for it.
- **Live Translate's sources:** the 99 plus its own two (choice 16) is inference from its guide ("between 70+ languages"); the live test may narrow it.
- **The wizard's tolerant language match** picks `zh-Hans` for a Traditional Chinese UI (it matches on the primary subtag, `src/components/SetupWizard/languageDefaults.ts:23-30`), for Gemini as for every provider with script variants: unchanged. Task 8's review ran the bundled `defaultLanguagePair` over the new table: `zh_TW` → `zh-Hans`; `zh_CN`, `pt_BR`, `pt_PT` and `ja` come out right. Before, a `zh_TW` UI matched nothing in Gemini's list (`cmn-CN`'s base is `cmn`) and took the provider's default. A `-Hant` preference for `zh_TW` / `zh_HK` in the generic matcher would fix it.
- **Readiness narrowing** (`checkReads`) for Gemini and Doubao: still their own later change.
- **The owed flag's limit on dialogue models** (found by the final fix wave, confirmed by its re-review; pre-existing since the Gemini plan's owed flag, `2f7a38f1`, not introduced or widened here): `closeTurn()` resets `owed` at the end of whichever answer was streaming (`src/providers/gemini/turns.ts`), so a voiced release or typed text made while an earlier answer streams loses its claim when that answer ends — its end is the answer's `turnComplete` under `NO_INTERRUPTION`, `interrupted` on a barge-in model — and a voiceless tap before its own answer streams then drops it: the real utterance's source row, translation and audio vanish, and the tap's reply (if the model answers one) shows instead. Reachable under `NO_INTERRUPTION` (2.5): release during an answer's 1.3–4.7 s streaming window, then a tap within about 1–2 s; narrower on 3.x (the round trip must outlast a 0.5 s voiced press; or typed text, then a tap). Live Translate is unaffected (no turns). A tested fix exists (the re-review's sketch, about ten lines, tried in scratch): a second flag `owedNext` set by `endTurn()` / `typed()` while an answer streams, carried into `owed` by `closeTurn()` instead of clearing it, cleared by `connectionLost()`, and `endAnswer()` starting a pending drop only when no answer is still owed; in scratch all six cases and both probe orders come out right, the 239 Gemini tests pass unchanged and the fuzz (seeds 31337 and 7, 3,000 runs each) breaks no invariant. Its one new assumption: a press released while an earlier answer streams gets its own answer afterwards (both overlap probes support it, under automatic detection). **Done** on the owner's ruling (2026-09-29; `f7bdb8bb`): the sketch landed as described, so a voiced release or typed text made while an earlier answer streams keeps its source row, its own translation and audio, and the tap's reply is dropped — pinned for the six orders, a reconnect between release and answer (nothing carried over), and the `NO_INTERRUPTION` case through the adapter; the six-case matrix, both probe orders, the barge-in harness and the fuzz (seeds 31337 and 7) came out as in scratch. The suite after it: 557 files passed and 1 skipped, 7,123 tests passed and 2 skipped, no unhandled errors; the gate at its baseline. What remains: the flag's own limit, as ruled — two answers waiting at once to start are one claim, cleared by the first to end, so a tap before the second's answer streams drops that answer (the Gemini section's "Found during execution", item 4). The two are either two voiced releases (or typed texts) waiting at once for their answers to start (both before any answer streams, or both while the same answer streams, for instance), or, on a model that answers an empty press, a tap's and a release's: within one streaming answer, a tap, then a voiced press (or typed text) that ends the tap's pending drop and is released, then another tap — the tap's queued answer takes the release's claim, so that utterance is lost where the flag before `f7bdb8bb` kept it; with no answer to taps it is the other way round. On balance the fix keeps far more than it loses: the independent review's oracle fuzz found 234 runs improved against 11 regressed with taps answered at random, 278 against none when taps get no answer, every regression this queued-tap order. And the assumption above, which live-test item 18 now watches; whether a count should replace the flag is the open question "The owed flag vs a count".
- **The owner's open questions** in this record, each with the live-test item that settles it.
- **A key without Live Translate on a fresh profile** (Task 8's review, M1; the plan's choice 16, as written): with no model saved the offer is Live Translate's (101 / 78) while `effectiveGeminiModel` runs a dialogue model — the 23 languages only the Live API documents are missing from the targets, Javanese and Sundanese are offered though only the instructions name them, and Both is refused for a source among those 23. With a single listed model the user cannot leave it (the model field is a native `<select>`). Nothing wrong is sent. The plan chose `''` to read as Live Translate; a fix needs the check's model list in the language context. Cost while open: such users miss 23 targets until they pick another model. Told to the owner; live-test item 5.
- **A stale comment and test title** (Task 8's review, M3): `src/components/Subtitle/SubtitleView.tsx:44` and `SubtitleView.test.tsx:192` still name Gemini's `cmn-CN`; the behaviour is right (`zh-Hans` shows as "ZH"). Outside the plan's files (`src/components/**` read-only).
- **`clear()` against a whole-text `End`** (Task 6's review, M2): a translation open with "Hello", the user clears, the `End` repeats "Hello" — `show()` sends nothing, the text unchanged to the adapter, so L1 closes the cleared segment blank and drops the matched clip's direct range `[0, 5]` with a `range_out_of_text` warning. Nothing lights wrongly; the warning follows an ordinary user action. A contract question between L1's `clear()` and an adapter that sends the whole text. **Met for Palabra's finals** by the Stage 2 Palabra plan (its record, "Found during execution", item 6): a final always sends its text, so a clear before it no longer closes the row blank; the contract question stands.
- **A clip before any `TTSSentenceStart` emits no `tts.clip` frame** (Task 6's review, M4; plan-mandated): it plays with no ref, and L1 keeps nothing of it. Unreachable in practice.
- **`appendAudio`'s `tail.stop('audio')` has no adapter-level test** (Task 5's review, M2): unreachable under push-to-talk — the runner sends speaker audio only while a turn is open, and that press has ended the tail — and covered in `tail.test.ts`.
- **A Gemini turn answered only by its text parts** (Task 3's review, a note): `turnComplete`'s fallback text never updates the side's text, so its chunks keep `[0, 0]` — no karaoke for it; not a wrong range.
- **`clampRanges`' doc comment** (`src/lib/conversation/Conversation.ts:367`, "Runs at close and on every later revision") no longer names all its callers: `audio()` runs it on a closed segment too (Task 2's re-review; cosmetic).

## Scheduled by the Stage 2 Palabra plan

The Stage 2 Palabra plan
(`docs/superpowers/plans/2026-09-29-client-contract-stage2-palabra.md`, plan
commit `0e6d478f`, written over `024266a0`'s code) landed as the twenty-five
commits `63d38a6b` through `ced275ae` on `worktree-client-contract-stage2`
(`0e6d478f..ced275ae` less the two commits outside the plan named below:
**+6,052 / −208 lines across 73 files**; the range whole, those two included,
+6,957 / −240 across 77). Then this record with the spec's amendments. It is
Stage 2's seventh provider — **Palabra AI** (`palabraai`), speech to speech
with the user's own platform key or legacy app pair, **a WebSocket client
written from scratch** (ruling 19): its definition, settings, credentials and
their choice, the documented language tables with their own reverse, builder,
bounded REST check, wire, 320 ms re-chunker, items paired by sentence, adapter
with the real-time silence rule, and settings view. Around it, the shared
pieces it was due: the plain socket seam lifted to
`src/lib/contract/socket.ts` (choice 1), Soniox's `tileSpan` to
`src/lib/contract/ranges.ts` (choice 2), the `input` seam deleted (ruling 16),
a `languages.reverse` hook any provider may state (ruling 9; choice 3), the
kit's four parked items (ruling 15; choice 4), the kit's seeded lifecycle
scenario (ruling 15), two redaction shapes and a kit-wide `frame-url` rule
(choice 10), and the Logs' rows (choice 11). The old LiveKit client is not
ported, and not deleted here: it, its descriptor, the store's Palabra readers
and migrations, the old UI's branches, `isPalabraAIEnabled` and
`livekit-client` stay compiled and unreachable until one later plan after the
owner's live test (ruling 17; this record's inventory).

Fourteen implementation tasks ran in six waves. Wave 1, Tasks 1–6 in parallel
at `0e6d478f`. Wave 2 by a controller ruling on its order: Task 8 once Task
4's review was in, beside Task 4's fix round, and Task 7 once Task 5's was,
beside Task 5's — each consumes that task's interface, which a fix round could
move under it. Wave 3, Tasks 9 and 10 at `62361ce6`, beside Task 7's first fix
round. Wave 4, Tasks 11 and 12 at `55e86e86`, with Task 7's re-reviews and its
second and third fix rounds running beside them. Wave 5, Task 13 at
`e0143c7b`, once Task 7 was complete; then group check A at `b7aaf60d`. Wave
6, Task 14 at `b7aaf60d`; then group check B at `ced275ae`. Task 7 took three
review fix rounds; Task 11 two; Tasks 4, 5, 8, 9 and 13 one each (Task 8's,
test-only, re-reviewed by the controller); Tasks 1, 2, 3, 6, 10 and 12 were
approved as their implementers committed them; Task 14 was approved with one
Minor, a test comment that cited a review, which the controller reworded
(`ced275ae`). Task 15 is this record, written for the controller.

Two commits outside this plan landed on the branch during its execution and
are not counted above: `55e86e86`, the owner's karaoke flicker fix (a clip's
early `onended` no longer blanks the playing position — `ClipQueue`'s
`endedAt`, `src/lib/audio/clipQueue.ts`), and `72223a27`, the Gemini hold
probe (`scripts/dev/wire-probe/gemini.mts`, `gemini-hold.mts`). Neither
touches a file of this plan's.

**The pre-flight.** The plan's writer ran every block in a scratch copy, then
applied the plan to a fresh `git archive` of `024266a0` task by task — each
red step, then its green, each wave's gates after it — and the result was
byte-identical to the tested tree. Its review (Critical 0, Important 4, Minor
11: ready after fixes) was ruled by the controller — all accepted,
`task.not_found` framed while opening (m8), a release idle at the next beat
(m11) — and applied over three writer rounds, with a re-review between them
(0 / 1 / 5: N1, the push-to-talk stream running ahead of real time, which
choice 7's stream clock answers) and one after (ready to execute, 0 open). The
replay's references: after each wave 559, 562, 566, 568, 569 and 570 files
passed and 1 skipped; 7,151, 7,180, 7,209, 7,227, 7,287 and 7,296 tests passed
and 2 skipped; the gate at its 20 lines and the full tree at 259 after every
wave. The controller's scan found each wave's file sets disjoint and every
interface dependency ordered by the waves (Task 4 → 8 and 14; Task 5 → 7; Task
8 → 9 and 10; Task 9 → 11, 12 and 13; Task 2 → 11; Tasks 1, 3, 5, 6, 7, 11 → 13;
Tasks 10, 12, 13 → 14), so no ruling was needed before Wave 1.

**The rulings.** Rulings 1–18 are the owner's answers to the survey's
eighteen questions (2026-09-29), 19–21 his standing decisions (the plan's
header), each confirmed as the plan states it:
1. Two ways in: the platform key dials the streaming socket straight; the app
   pair creates a REST session, dials its `ws_url` with the publisher token,
   and deletes that session — its own alone — bounded, `pagehide` included;
   the check is REST, per mode.
2. No migration: stated departures (below).
3. Real-time silence while no audio comes — required: ten seconds without
   input is `SERVICE_TIMEOUT` and a close 1008.
4. The start resolves when `get_task` finds the task running; a refused
   `set_task` rejects it in Palabra's words.
5. 320 ms chunks.
6. Karaoke by Soniox's fill-in, the audio replayable (spec D3).
7. Text only offered: a leg that does not speak sends `output_stream: null`.
8. Palabra's documented language tables, less the targets they hide; `auto` a
   source.
9. A `languages.reverse` hook; Palabra's by its documented codes (spec D20).
10. The settings as the API takes them: the threshold's floor 0.3, the max
    buffer above the target, timbre detection off, the three English-only
    tooltips dropped.
11. OpenAI's error rule: a red `session.error` Logs line, its words kept for a
    close within `ERROR_WORDS_MS`; `VOICE_NOT_FOUND` the `voice_fallback`
    notice, once; `AUDIO_STREAM_*` in the Logs only.
12. No reconnect.
13. Stop drops what is in flight: `end_task { force: true }`, never awaited.
14. Unflagged, registered last.
15. The kit-level seeded lifecycle scenario, with the kit's four parked items.
16. `StartRequest.input` and the runner's `Source.track` deleted.
17. The old code's deletion a later plan (this record's inventory).
18. The setup guide later: the definition links today's page.
19. A WebSocket client written from scratch; the old LiveKit client not
    ported.
20. No one-time migration code.
21. The judging standard: does adding a new provider get simpler?

Choices 1–20 are the plan's, inside those rulings, each cited where it lands.
The controller's rulings during execution are recorded below, under "Found
during execution", "Accepted as they stand" and "What it leaves"; one of them
departs from an owner's answer — `IDLE_MS` ("Found during execution", item 1).

What landed, by task:
- **The plain socket seam, lifted** (`0e9ccff0`, Task 1; choice 1):
  `src/lib/contract/socket.ts` — `OpenSocket`, `nativeSocket` (a refused
  socket rethrown in fixed words, its name kept), `WS_OPEN`. Gemini's, Doubao
  AST 2.0's, OpenAI Translate's and OpenAI Realtime's `socket.ts` re-export
  it, each keeping the `OpenSocket` type its adapter calls; Soniox's stays its
  own.
- **`tileSpan`, lifted** (`63d38a6b`, Task 2; choice 2):
  `src/lib/contract/ranges.ts`, byte for byte Soniox's; `soniox/speech.ts`
  re-exports it.
- **The `input` seam, deleted** (`7d0b8cdd`, Task 3; ruling 16):
  `StartRequest.input`, `Source.track`, the runner's two threading sites and
  the capture's track option; the fake's `refless-stream` comments name it an
  L1 fixture that no provider emits now.
- **A provider may state its reverse** (`6885d309`, fix round `c0e57e5d`, Task
  4; ruling 9; choice 3): `languages.reverse?` on the definition;
  `reversedPair` in `src/lib/provider/languages.ts`, the one door that
  `reverseSupported`, `swapped`, `contextsFor`, the gate and
  `buildSharedSettings` (handed the participant's direction, not the pair, by
  `appShape.ts`) read; a registry invariant that a provider with no reverse of
  its own offers no target outside its sources, in every declared settings
  shape and language context. As landed, `auto` guarded and the gate's words
  from the hook ("Found during execution", item 4).
- **The kit's four parked items** (`2bf854f5`, fix round `d1bfb544`, Task 5;
  ruling 15; choice 4): `VirtualClock.pending()` and its check after every
  scenario; `FakeSocket`'s browser refusals and close codes; the flush after
  the exchange; `manual-end`'s segment check. As landed, the unflushed
  server-close drive and 1005 / 1006 (item 3).
- **Redaction, `frame-url`, the Logs' rows** (`e5e3e5d5`, Task 6; choices 10,
  11): `redact()` masks a bare `plbr_…` key and a JWT whole, its query rule's
  `token` naming Palabra; `checkConformance`'s `frame-url`; `logStore` groups
  `transcription.partial`, `translation.partial` and `audio.output` under
  their own types.
- **The seeded lifecycle scenario** (`e4400a55`, fix rounds `a0e06f55`,
  `8f6a5821`, `e0143c7b`, Task 7; ruling 15): `runLifecycles` in
  `src/lib/contract/testing/lifecycle.ts`. As landed, hardened over three
  rounds (item 2).
- **Palabra's settings, credentials, languages and builder** (`c1ece27e`, fix
  round `62361ce6`, Task 8; rulings 1, 2, 7, 8, 9, 10; choices 5, 13, 14):
  `S` and its clamps, `K` and `credentials.choice` on `authMode`, the
  documented tables (58 sources with Auto-detect, 63 targets) and their
  reverse, `C`, `build`, `describe`; the adapter's seed. As landed, the
  refused-reverse set pinned exactly (item 5).
- **The settings view and the turn detection** (`27199faf`, Task 10; ruling
  10; choice 15): `PalabraSettings.tsx` (voice, Speech Processing, Audio
  Buffer Configuration) and `PalabraTurnDetection.tsx` (the summary and the
  threshold slider under `#palabra-vad-section`).
- **The wire, the re-chunker and the fixtures** (`edfcffe9`, fix round
  `52703d72`, Task 9; rulings 3, 4, 5, 11; choices 6–9): `wire.ts` (the URLs,
  the REST headers and bodies, the task, the server's messages, an error's
  code and words; the credential read in four functions alone, pinned by an
  AST scan), `audioIn.ts` (`Rechunker`, `CHUNK_MS`, `IDLE_MS`, `SILENCE`),
  `testing.ts` (the probe's shapes, `fakeRest`). As landed, `IDLE_MS` 800
  (item 1) and a browser-true `fakeRest`, pinned (item 8).
- **Messages become segments** (`921ba5d9`, fix rounds `ee32997d`,
  `b47be8b8`, Task 11; ruling 6; choice 12): `PalabraItems` — a source per
  sentence, a translation per part, audio on its part's translation, ranges by
  `tileSpan` once a burst is whole. As landed, a final always sends (item 6).
- **The readiness check** (`313e8c1d`, Task 12; ruling 1; choice 16): one
  bounded `GET /session-storage/sessions`, 15 s, per mode; 401 / 403 `auth`,
  429 `rate_limit`, anything else throws.
- **The adapter** (`15a07f0a`, fix round `b7aaf60d`, Task 13; rulings 1, 3, 4,
  11, 12, 13; choices 6–9, 19): one leg, one socket; the two ways in; the
  start on `get_task` every 2.1 s, bounded at 20 s; 320 ms chunks and the
  silence rule on the request's clock; errors in words; `stop()` before its
  first `await`; the REST delete, bounded, its own; conformance and the seeded
  lifecycles in both credential modes; the session-side guard's roster. As
  landed, the delete's plain retry (item 7).
- **Registered** (`07b67bd9`, `ced275ae`, Task 14; rulings 14, 18; choice
  16): `palabraProvider` last in `RELEASED`, unflagged, `checkReads:
  ['authMode']`; the wizard's own-key pin; the old profile's cases; and the
  `appShape.test.ts` case routed from Task 4's review (item 4).

**The spec's amendments** (this record's commit), the plan's sixteen, each at
its anchor and marked "(Stage 2 Palabra, …)", as landed; then two this record
adds:
1. D3, and "Provider capability"'s "Two findings" paragraph: every provider
   replays — Palabra's audio names its sentence (ruling 6); no client is left
   that cannot, and the contract keeps ref-less `audio`, which only the fake's
   `refless-stream` fixture produces.
2. D20, "The session request"'s direction paragraph, "Languages are two
   functions"' swap sentence, and "The participant rule (D20)": the reverse is
   the provider's own where it states one, else the plain swap (ruling 9;
   choice 3); `auto` never reverses, guarded in `reverseSupported`
   (`c0e57e5d`); Palabra's documented codes, the hidden `to_target` (choice
   5), the refused sets; the gate's words; the registry invariant over
   declared shapes. "The shape" gains `reverse?` with a one-line comment, and
   an "Amended by the Stage 2 Palabra plan" paragraph.
3. "L0 — the client contract": the listing loses `input` and its LiveKit
   comment; ref-less `audio` is "no provider now; the fake's `refless-stream`
   fixture"; the fabrication note kept as history, both clients retired;
   "The shape"'s `start` loses `input`; "Capture belongs to the runner": the
   seam deleted (ruling 16; `7d0b8cdd`).
4. `ref`'s rationale and the revision rule: Palabra's `partial` →
   `validated` is an open and a close, and it needs `ref` because several
   `transcription_id`s are in flight at once; the rule stays, the fake's
   fixture keeping it tested.
5. "Turns": Palabra's automatic row — the server's segmentation after its
   threshold, and real-time silence after `IDLE_MS`, 800 ms, the departure
   from the owner's half second stated; its release — the re-chunker flushed,
   silence from the next beat (ruling 3; choice 7); its design row (`beginTurn`
   sends nothing, `endTurn` / `cancelTurn` alike, `interrupt_task` no help);
   "Coverage": Palabra's push-to-talk landed.
6. "Provider capability", Palabra's row — replay yes, ranges at a burst's end
   by Soniox's fill-in, a range filled in later and not a stated exception,
   so D4's list is unchanged, pairing by `transcription_id` stated (ruling 6;
   choice 12); "`start` owns the transport": the port is WebSocket (ruling
   19).
7. "Readiness is one check": the REST list, `checkReads: ['authMode']`
   (choice 16).
8. "Sockets that need upgrade headers": Palabra needs none; a wrong key a bare
   403 worded as the key while online (choice 8); the plain seam in
   `src/lib/contract/socket.ts` (choice 1), and the earlier "move with F14"
   sentence marked.
9. "Persisted settings that move": `authMode` and the pair codes, nothing
   converted (rulings 2, 20), the clamps (ruling 10), F5 kept for its users.
10. "What adding a provider then touches", item 4: no manifest change
    [inf: live-test item 3].
11. "Session hooks on the provider definition": Palabra uses none (choice 9).
12. "What the surveys' defects become": LiveKit's reconnects gone with the
    transport; the delete bounded, its own, the create on its own signal, and
    the plain retry (choice 9; `b7aaf60d`).
13. "Testing": the kit as made stricter — `pending()`, `FakeSocket`'s codes
    (1005 clean, 1004 / 1015 / 1016–2999 throwing, 1006 kept), the flushed
    and unflushed server-close drives, `manual-end`, `frame-url`,
    `runLifecycles` as landed, and a browser-true fake REST server.
14. "Migration", item 8, and the deletion paragraph: Palabra's old code and
    `livekit-client` wait for its live test (ruling 17), meeting the OpenAI
    deletion at `WebRTCAudioBridge`.
15. "Stage 2 — open for the plans that meet them", item 9: OpenAI and Gemini
    use F5; Palabra does not (rulings 2, 20).
16. "Risks": the keepalive on a timer on a hidden page (ruling 3; choice 7);
    a socket URL carries the credential.
17. (added) "What every adapter must honour", the `frame` bullet: Palabra's
    three rows (choice 11), and no socket URL in a frame (choice 10).
18. (added) "The registry is a list (D19)": Palabra unflagged, last (ruling
    14).

**Checked — the gates.** Every implementer ran the suite and the typecheck
gate on its own commit. In the parallel waves a failure or an extra gate line
in another task's uncommitted files was named and left to it: Tasks 1 and 2
saw extra gate lines only in Tasks 3, 4 and 5's work in progress; Task 6 saw
seven failures, all in Task 5's kit files, and gate lines in Tasks 3 and 4's;
Task 10 saw gate lines in Task 9's;
Task 8 met two 5-second load timeouts (`nativeModelStore`, `providerOrder`),
68 of 68 alone. The controller's gate after each wave, on a clean tree:
- Wave 1 (at `2bf854f5`): 559 files passed and 1 skipped, 7,151 tests passed
  and 2 skipped — the replay's reference exactly;
- Wave 2 (at `62361ce6`, with `d1bfb544`; Task 7's first fix round not yet
  dispatched): 562 and 1, 7,184 and 2 — the replay's 7,180 and four
  fix-round tests (Task 4's one, Task 8's one, Task 5's two);
- Wave 3 (at `55e86e86`): 567 and 1, 7,235 and 2 — the replay's 566 and
  7,209, `testing.test.ts` (Task 9's fix round), the other fix rounds' tests
  and `55e86e86`'s three;
- Wave 4 (at `e0143c7b`): 569 and 1, 7,281 and 2;
- group check A (at `b7aaf60d`): 570 and 1, 7,350 and 2;
- group check B (at `ced275ae`): 571 and 1, **7,360 and 2** — the final
  count.

Each with 0 failed and no unhandled errors, the gate — the Volcengine AST2
plan's regex, unwidened — at exactly its 20 baseline lines, and the full tree
at 259. The suite grew from 557 files passed and 1 skipped, 7,125 tests passed
and 2 skipped at `024266a0`. Against the replay's final 570 files and 7,296
tests: one file (`testing.test.ts`) and 64 tests — 61 from the review rounds'
rulings, 3 from `55e86e86`.

**Checked — group check A** (at `b7aaf60d`; nothing registered yet; the tree
clean but for another plan's untracked Gemini hold plan):
1. the suite as above; the gate at its baseline; the full tree at 259;
2. `src/services` and `extension` together: 56 files, 1,084 tests — the old
   client and descriptor untouched;
3. `npm run build` and `npm run extension:build` exit 0; the three D24 greps
   empty; `task.current`, a frame only the new adapter emits, in neither
   bundle — as expected before the registration.

**Checked — group check B** (at `ced275ae`):
1. the suite as above; the gate at its baseline; the full tree at 259;
   `src/services` and `extension` 56 files, 1,084 tests;
2. both builds exit 0; the three D24 greps empty; `task.current` in
   `build/static/index-BLT2czsT.js` (and its map) and
   `extension/dist/fullpage.js` — the adapter ships in both bundles, neither
   fake does;
3. **rendered**, on a fresh vite (port 5199, `--force`), Playwright's Chromium
   151 headless over the DevTools protocol, each run a fresh profile, no
   credential typed (the old profile's made-up pair seeded in `localStorage`
   only), Validate and Start never pressed — all eight items pass:
   1. the picker and the credential form: "Platform API Key" and "App Client
      ID/Secret" above the fields; the platform mode's empty key; the app
      pair's empty Client ID and Client Secret; the key again on the way back;
   2. the Provider tab, advanced: Voice (Default Low), Speech Processing
      (Sentence Splitter enabled, Translate Partial Transcriptions disabled),
      Audio Buffer (8.0s, 24.0s, Adaptive Speech Speed disabled); a tooltip on
      the voice alone; the target at 15.0s raises the max slider's minimum
      from 12000 to 18000; the simple layout shows none of them; the markup
      Gemini's (`VoiceField`, the slider rows, the option-button pairs,
      `#palabra-vad-section`), each difference from the old block a planned
      one;
   3. the Speech section's summary, "VAD Settings · Silence Threshold: 0.70s",
      a link to the Provider tab's `#palabra-vad-section`; the slider from
      0.30 to 2.00, step 0.01;
   4. the language picker: 58 sources, Auto Detect first, then `ar` … `cy` by
      English name, each by its native name; 63 targets from `ar`
      "العربية الفصحى"; no `bn`, `mr`, `fa`, `zh`, `en-au` or `en-ca` target;
      the swap `ja → en-us` → `en → ja` → `ja → en-us`;
   5. Start off, "Enter your API key in Settings before starting." (the
      advanced tooltip on hover, the basic title);
   6. the wizard's own-key list: Google Gemini, Doubao AST 2.0, OpenAI
      Realtime, OpenAI Translate, Soniox, Palabra AI, then the development
      build's fake;
   7. an old profile (`palabraai` selected, a made-up `clientId` and
      `clientSecret`, no `authMode`, source `eo`, target `vn`): Palabra
      selected, the platform mode with an empty key, the source Auto Detect,
      the target `ar` "العربية الفصحى", the swap disabled; none of the six
      watched keys rewritten, no `settings.palabraai.*` written;
   8. no request to `palabra.ai` in any run (the protocol's
      `requestWillBeSent` and `webSocketCreated`, worklets included, and an
      in-page wrapper; 619, 617, 617, 1,238 and 619 entries logged).

   The app pair's error line reads the runner's `credentials_missing` words,
   which `settings.ts` marks as intended. Outside the checklist: an Arabic
   target — Palabra's fallback for an old profile — grows the shared
   `LanguagePairSection`'s target select from 34 to 47 px and drops the source
   column 13 px, so "I speak" and "they hear" misalign; CJK does it by a few
   px. Not Palabra code, and not checked on other providers ("Accepted as they
   stand"). The report, scripts and screenshots are under
   `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/group-b/rendered/`.

**Found during execution** — what execution changed beyond the plan, each
from a controller's ruling in the ledger, with its reason, where it lives, and
its cost:
1. **`IDLE_MS` is 800 ms, not 500** (Task 9's review, I1; `52703d72`). The
   plan's 500 ms (choice 7) cleared the microphone's two capture cadences —
   the worklet's 85.3 ms and the ScriptProcessor fallback's 341 ms — but not
   the participant leg's, whose capture runs at 24 kHz: its fallback's 16,384
   samples come every 682.7 ms, so 500 would splice silence into its speech,
   11.7 s of it in a minute. 800 clears the slowest of the four cadences with
   a margin; it delays the first silence after an unexpected stop by 0.3 s,
   far inside Palabra's 10 s, and leaves a release's idle (the next beat,
   choice 7) unchanged. **It departs from the owner's "about half a second"
   (Q3)**: reported to him, and reversible — one constant,
   `src/providers/palabraai/audioIn.ts`, its four cadences cited at their
   sources and pinned in `audioIn.test.ts` (500 and 700 mutants killed).
   Task 13's three timing cases were adapted to it (item 9). Cost if wrong: a
   silent stream's first silence 0.3 s later.
2. **The lifecycle kit, hardened over three fix rounds** (Task 7's review and
   two re-reviews; `a0e06f55`, `8f6a5821`, `e0143c7b`). The plan's
   `runLifecycles` passed Palabra, but its review found it unlike the runner
   in places, and the re-reviews found the first fix's own gaps. As landed:
   - **the runner's stop order** (I-1): the kit's stop, and its unwind of a
     session that ended itself, marks the log, aborts the request's signal,
     then calls `stop()`, as `run.ts` does — an adapter that says `failed` on
     its own abort would have put an error notice on every Stop, unseen;
   - **an abort while the start is pending** (I-2; round 2): at random, 6 % of
     runs, and only while the start is still pending once the opening has
     run. The first fix aborted after every opening, which erased the start's
     bound path (Palabra's bound rejections 24–44 of 300 → 0: NB-1) and
     aborted starts already resolved (NB-2); the bound path is restored and
     pinned (`opening.bound`, 28–39 of 300);
   - **the late-send rule, narrowed** (round 2): a send is late once the
     session has ended, or its socket is `CLOSED`, or `CLOSING` by the
     adapter's own close. The first fix counted any socket not `OPEN`, which
     flagged a continuation racing a server close or a drop (33 false
     positives in 1,200 lives) and a keepalive between a server close and its
     `onclose`;
   - **a refused start read as `mustReject` reads one** (I-3, N-3): content
     and `closed` / `failed` flagged, a status event admitted, read once the
     clock has run on;
   - **a runner-shaped release** (M-5): `endTurn` when the turn held at least
     12,000 samples (the runner's `MIN_VOICED_SAMPLES`), else `cancelTurn`,
     with a small raw draw counted under its own key;
   - **0–10 microtask hops** after the server's, the clock's and a drop's
     steps (N-2), reaching races inside async handling;
   - **a generator per run** (M-4), seeded from the seed and the run's index,
     taking `{ seed, runs, from? }`; a failure is named "seed S run N step I
     (op)";
   - **a bound on `stop()`** (M-3): the clock run on 10 s by default, then
     "stop() did not return within its bound";
   - the flush before a start's bound (N-1); each harness hook in its own
     `try` with a named failure (M-2); an adapter broken one way for each
     check that had none, a goodbye-in-`stop()` adapter that must pass —
     Palabra sends `end_task` there — and a stats key per opening path pinned
     above zero (M-1);
   - **round 3, tests only**: five surviving scratch mutants (R2h, the
     late-send rule reverted; R2f; KMM4a; KMM3a; R2d) each killed by a case of
     its own; the kit's suite at 65 tests.

   Palabra's adapter under the finished kit: 0 failures in 7,200 lives over
   extra seeds (Task 13), and 9,600 across both modes at its fix round's
   re-review. Cost: three kit rounds before Task 13.
3. **The kit's close codes and the server-ended race** (Task 5's review, I1,
   M1–M3, N1, N2; `d1bfb544`). The plan's flush after the exchange (choice 4)
   erased the only test of a server close overtaking an awaited answer, a race
   Palabra's adapter faces too; `server-close` now also runs unflushed,
   requiring only that nothing lands after `failed` / `closed` or `stop()`
   (mutant H2, AST2's `end()` leaving its speech running, caught again).
   `serverClose(1005)` is clean with an empty reason, as a browser reports the
   empty close frame; 1004, 1015 and 1016–2999 throw. **1006 stays accepted**
   (the controller's ruling on the fix's deviation): the OpenAI Realtime,
   OpenAI Translate, Soniox, Gemini and Doubao AST 2.0 suites use
   `serverClose(1006, …)` to mean an abnormal close, and converting them was
   outside the task; it reports `wasClean: false`, and `drop()` is the
   preferred form. Beside it, three tests — refusals on a closed socket, a
   leak on a refused start, a 124-byte multibyte reason — and a note that the
   flush before `h.reconnect` is not pinned. Cost if wrong: a fake abnormal
   close carries a code no frame carries, harmless in tests.
4. **D20 holds for a hooked reverse** (Task 4's review, M2, N1–N3;
   `c0e57e5d`). `reverseSupported` refuses an `auto` source before it reads
   the hook: with the plan's code, a hook that mapped `auto` to an offered
   pair would have opened Both on it. A no-op for every plain-swap provider,
   none of which offers `auto` as a target. The gate's refusal is worded from
   `reversedPair` — "has no reverse of X → Y", or "does not offer X → Y" —
   where it named the plain swap; `languages.ts`' header names the hook;
   `legacyKeys`' comment names its live users (`INSTRUCTION_LEGACY_KEYS`). The
   one production line that turns a hook into `SharedSettings.reversed` —
   `appShape.ts`' call to `reversedPair` — is pinned by an `appShape.test.ts`
   case for Palabra's `ja → en-us` (M1; landed with Task 14, `07b67bd9`, red
   on a plain-swap mutant). Cost if wrong: none.
5. **The refused-reverse set pinned exactly** (Task 8's review, M1;
   `62361ce6`). One test over every offered pair pins the pairs Both refuses:
   an `auto` source, and the nine sources and seven targets with no
   documented reverse — killing the mutants that drop or add one. The
   controller ruled not to copy the reverse table or the names into the test:
   a second copy catches no deliberate re-capture and doubles the data to keep
   in step. Cost if wrong: an edit that maps a code to a wrong one (M6), or
   renames one (M7), goes unseen by the suite. The review had checked the
   tables against the docs' `models-map.json` row by row (0 mismatches) and
   the reverse over 3,654 pairs. The clamp test was retitled (0.3 the API's
   floor, 2.0 the slider's ceiling).
6. **A final always sends its text and language** (Task 11's review, m1 and
   m2, and re-review; `ee32997d`, `b47be8b8`). The plan's `PalabraItems`
   skipped a text equal to the last it sent, finals included, and the owner's
   probe shows 46 of 46 sentences validating with exactly their last
   partial's text, 69 ms to 2.9 s after it (median 437 ms). So a `clear()` in
   that window closed the row blank, and a validation that refined the
   language of an unchanged text never reached the badge. Finals now always
   send; the skip stays for partials. Beside it, ten edge cases (a
   `last_chunk` ending only its own sentence, a part with no speech yet not
   ended, …) and, at the re-review, the probe's own case — a final equal to
   the last partial in the same language (mutant M46). The probe replay pairs
   and fills 50 of 50. Cost: none; L1 already drops an identical snapshot.
7. **The delete, tried again without `keepalive`** (Task 13's review, m5;
   `b7aaf60d`). Palabra's DELETE always needs a CORS preflight — neither its
   method nor its app pair's headers are a simple request's — so a runtime
   that refuses a `keepalive` request needing one would fail every delete,
   not only `pagehide`'s, leaving sessions to expire on Palabra's side. A
   transport failure (a rejected fetch, or a synchronous throw) is now tried
   once more without `keepalive`, on the same controller, inside what is left
   of the same 5 s bound; a status answer and the bound's own abort are not
   retried; nothing is framed — as the Soniox lease's session end does
   (`soniox/lease.ts:151-174`). The `keepalive` DELETE still goes out first,
   before any `await`, so `pagehide` sends it. Live-test item 9 records which
   runs. Beside it (m1–m4, n1, n3–n5): push-to-talk after a wall clock
   stepped back; a create answering a `ws_url` that is no URL; two legs of one
   adapter each deleting their own session; the participant's 683 ms
   cadence; `opening.bound` and `opening.abort.early` added to both modes'
   pinned stats keys (item 2's NB-1 had erased the bound path silently), the
   pins reading `stats[key] ?? 0` so an erased path names its key; **n1**, one
   `await Promise.resolve()` added before the abort in the "answer in, its
   body unread" case, restoring the timing it means to test — the answer
   still out when the abort lands; **n4**, the app pair's lifecycle harness —
   which had counted none of its own opening draws — now counting each with a
   `run.count(...)` per draw; **n5**, the stale `fakeRest` header comment
   fixed; and `startPalabra`'s optional `fetch` wrapper, test-only. Cost: a
   second request in the rare failure case.
8. **A browser-true `fakeRest`, pinned** (Task 9's review, M1–M3, N1–N3;
   `52703d72`). `CreatedSession` joined the wire's credential scan
   (`SECRET_NAMES`); `testing.test.ts` pins the fake REST server's browser
   behaviour — an aborted request rejects, and so does an aborted answer's
   body — on which choice 9's leak guard rests, each case shown red on a
   scratch mutant; the fake re-checks an abort in the same tick, records
   headers through `Headers` (so lowercase), words its error envelope by
   status, and settles an immediate answer on a microtask; `IDLE_MS` pinned;
   a session id with reserved characters encoded; `SILENCE` documented as
   never written. Cost: none.
9. **Task 13's suite, adapted to what landed before it** (`15a07f0a`). The
   adapter is byte-identical to the plan's; the plan's suite, run verbatim
   against the landed code, failed 8 of 60 — six on header names (item 8's
   lowercase recording) and two on `IDLE_MS` (item 1). Seven changes, all in
   `adapter.test.ts`: an `APP_HEADERS` constant and the four places it is
   read, and the idle-silence, release-idle and stepped-clock cases' timings
   and titles in terms of `IDLE_MS`, each reducing to the plan's own numbers
   at 500.

**Accepted as they stand** (the controller's rulings, for the final review
unless marked, each with its cost):
- **Hand-declared settings shapes** in the registry invariant (Task 4's
  review, N5): the invariant runs each provider's defaults and Gemini's three
  named shapes; a Proxy that records what an offer reads is overkill today.
  Cost: a future provider whose offer reads its settings is checked at its
  defaults only.
- **The gate's words for an `auto` source under a hook** (Task 4's
  re-review): were a hook to map `auto` to an offered pair, the gate would say
  "does not offer X → Y" where D20's `auto` rule is the reason. Unreachable —
  Palabra's hook answers null for `auto` — and in English, in the Logs only.
  Cost: a misleading Logs line for a future hook.
- **`serverClose(1006)`'s doc** (Task 5's re-review): it explains the suites'
  deliberate use but does not say in so many words that `drop()` is
  preferred. A wording gap.
- **The kit's N-4** (Task 7's review): an adapter deaf to its signal
  passes if it has its own bound — the kit does not require an aborted start
  to settle before the bound, though the fixed `abort-while-opening` scenario
  catches it. **N-5 is closed** by the round-1/2 late-send rule (item 2
  above): a send into a closed socket counts while the session lives — never
  Palabra's, which does not reconnect.
- **The check's throw path matched by substring** (Task 12's review;
  cross-provider): the tests match substrings of a thrown message, so a
  credential appended to one would pass; OpenAI Translate's check has the
  same blind spot. Not a live leak. Cost: a future edit could put a key into
  a readiness error unseen.
- **`OnOff`'s `role="group"` and `aria-label`** (Task 10's review; accepted
  as written): the one markup delta from the old block and the siblings,
  needed to tell three groups apart; an accessible superset, no class change.
- **The shared `LanguagePairSection` with an Arabic or CJK target** (group
  check B): the target select grows, 34 → 47 px for Arabic, and the pair row
  misaligns. Not Palabra code; for the final review or the owner; live-test
  item 14 looks at it in the real app.

**Stated departures from today** (the plan's list, as landed):
- a profile with no stored `authMode` — every one saved before 2026-07-30 — opens in the platform mode; one click on the app pair's option reads its pair again (ruling 2);
- a stored `ba`, `eo` or `ia` source falls to Auto-detect (the first source), which also refuses Both; a stored `vn`, `zh`, `en-au`, `en-ca`, `bn`, `mr` or `fa` target falls to Arabic, the first target (rulings 2, 8);
- timbre detection is off: the voice picked is the voice heard (ruling 10);
- a stored threshold under 0.3 is sent as 0.3, and a stored max buffer not above its target is raised (ruling 10);
- Both refuses a pair with no documented reverse — targets `az`, `bs`, `fil`, `is`, `kk`, `mk`, `sr` (of which `fil`, `kk`, `mk` and `sr` are sources too, so a plain swap would have run them), and sources `bn`, `eu`, `fa`, `ga`, `mn`, `mr`, `mt`, `ug`, `yue`, of which `bn`, `mr` and `fa` ran Both in the old app (rulings 8, 9);
- Stop drops what is still being translated (ruling 13);
- each leg deletes only its own REST session (choice 9);
- the three English-only tooltips are gone (ruling 10);
- new: Text only (ruling 7), push-to-talk and push-to-translate, `auto`, and the languages the docs add;
- **added by execution:** a stream with no audio carries silence after 800 ms, not the half second the owner answered (item 1).

**Before any release from the branch**
- **The registry's order**, pinned (ruling 14).
- **The release notes:** a stored `ba`, `eo` or `ia` source now reads Auto-detect (the first source), which also refuses Both, and a stored `vn`, `zh`, `en-au`, `en-ca`, `bn`, `mr` or `fa` target Arabic; a pre-July profile opens in the platform mode (one click back); timbre detection is off.
- **No new locale key**, so no native-speaker check.
- **`VITE_ENABLE_PALABRA_AI`** no longer gates anything the user sees; it goes with the old code.
- **The owner's live test below**, before any release that carries Palabra.

**The owner's live test** (own credentials, real Palabra; switch diagnostic
logs on in Help first; each item names what settles it; what execution added
is marked):
1. **The check, both modes** (ruling 1; choice 16): a valid key is ready; a wrong key reads as the credentials, in Palabra's words; a valid and a wrong app pair, whose refusal words quote neither the Client ID nor the Client Secret; offline: not ready, with no words about the key; a slider or a switch edit sends no new `/session-storage/sessions` request (`checkReads`).
2. **The start, per mode** (ruling 4; choices 6, 8): the Logs show, in order, `session.create` and `session.created` (the pair only), `session.opened`, `task.set`, `task.get`, a `task.not_found` if an ask came before the task ran (expected, and not red), `task.current` `running`; record the time from Start to live per mode against the 20 s bound. A stored threshold of 0.1 (edited into storage) starts at 0.3.
3. **Connections, per platform** (survey §6): the web build, the extension side panel (its CSP, and CORS on the REST calls with their custom headers — a preflight each) and Electron: items 2, 4 and 9 on each. Origin is unchecked (the owner's probe, from Node): confirm from a real page.
4. **Automatic turns, ja → en** (rulings 6, 11; choice 12): source rows grow on `transcription.partial` and close on `transcription.validated`; each translation sits under its source as a stated pair — in the panel, the Electron subtitle takeover, the extension overlay and the export; speech plays once on the monitor and once in the virtual mic; karaoke lights a sentence by sample count once its burst is whole; replay works per translation row with keep-audio on; no clicks at the 200 ms seams, no gaps inside a sentence, over ten minutes (G3's heir).
5. **The silence rule** (ruling 3; choice 7). No audio reaches the adapter while the microphone is muted (`src/lib/audio/capture/core.ts:85`) or between push-to-talk presses (`src/lib/session/run.ts:450-453`), so only then does the keepalive carry the session. Under automatic turns the silence starts once no audio has come for `IDLE_MS`, 800 ms as landed ("Found during execution", item 1).
   - push-to-talk: a release closes its sentence about 1.9 s after it at the default threshold, 0.7 (the probe's speech end → `validated_transcription`, the threshold already inside it), plus up to one beat (320 ms), scaling with the threshold — the silence starts at the next beat, not after `IDLE_MS`; record release-to-close times; an empty press gives no row; push-to-translate sends the raw voice while the key is up;
   - many presses in a row (twenty or more, a second or so apart): record whether release-to-close time grows along the run, and whether a `session.warning` `AUDIO_STREAM_TOO_FAST` appears (the stream's own clock, choice 7);
   - **a hidden window with no audio** — on the extension side panel and on the web build: hide or minimize the browser window, with the microphone muted under automatic turns, for 10 minutes or more; then again idle under push-to-talk (no press) for 10 minutes or more. Record whether `SERVICE_TIMEOUT` ends the session and after how long; if it does, its words read "[Palabra SERVICE_TIMEOUT] No input audio received for 10s…". Electron is exempt (`backgroundThrottling: false`, `electron/main.js:397`): run it there once as the control;
   - visible, muted for a minute under automatic turns: the session survives and the sentence spoken before the mute closes; record any `session.warning` (`AUDIO_STREAM_*`) or close over minutes of real-time silence;
   - **Execution (Task 13's review, n2):** only a wall clock stepped back is rebased (choice 7); one stepped forward inside a gap between capture chunks reads as an idle and splices one padded chunk (at most 320 ms) into continuous speech. Rare — an NTP step while speaking — and harmless; watch for a lone `audio.idle` in the middle of a sentence.
6. **Both** (rulings 8, 9; D20): two sessions on one credential; the participant is reversed by Palabra's codes (`ja → en-us` runs `en → ja`, `en → ja` runs `ja → en-us`, `zh → en` runs `en → zh-hans`); its speech follows its switch; either leg ending ends both; Auto-detect and a pair ending on `fil` are refused in words.
7. **Text only** (ruling 7): no audio at all, no `audio.output` frames, the rows paired.
8. **`auto`** (ruling 8): each source row carries the language the server heard; speaker only. **Execution (Task 9's review):** an `auto` source sends `detectable_languages: []`, which the probe never ran: record whether the server accepts it and detects.
9. **Stop, and a cancelled create** (ruling 13; choice 9): nothing plays after Stop; for the pair, the REST delete goes out (DevTools' network panel: `DELETE` 204, `keepalive`); **cancel during the app pair's create** (press Stop, or switch provider, within a moment of Start), then Start again at once: the new start must not be refused for parallel sessions, and the network panel shows the first session's `DELETE` after its create's answer; close the side panel mid-session, then Start within a minute — whether the `pagehide` delete got through its preflight, and whether a lingering session blocks the next. **Execution (Task 13's fix round, `b7aaf60d`):** a `keepalive` DELETE refused at the transport is sent again once without it, inside the same 5 s bound — record which path runs on each platform: one `keepalive` DELETE answered 204, or a failed one followed by a plain one. **The final fix wave (N4):** a create whose headers arrive in time but whose body stalls past the bound reads as no id, so its session is left to expire — the one case choice 9 cannot delete, needing a body stall of about 20 s after the headers to reach.
10. **Failures** (rulings 11, 12; choice 8): Wi-Fi off mid-session → the connection-lost words, with the time until them; ten quick Start / Stop rounds in Both (two connections each) to cross 20 connections a minute → the 1008 words; nothing reconnects.
11. **Voices and the fallback** (rulings 10, 11): `default_low` against `default_high`; a target with no voice — try the added ones (`az`, `bs`, `is`, `kk`, `mk`, `sr`) — shows the `voice_fallback` notice once and a `session.warning` per sentence.
12. **Languages** (ruling 8): `mr` and `fa` as sources; two or three of the added sources and targets translate and speak.
13. **The Logs** (choices 8, 10, 11, 17): the three streamed frames grouped; `session.error` red, `task.not_found` not; no key, no JWT and no URL anywhere, the export included; record any `session.unknown` type.
14. **An old profile** (ruling 2): key, pair and settings saved by an earlier build are ready without re-entry; a pre-July profile opens in the platform mode and one click brings its pair back; a stored `vn` target reads Arabic; a stored `eo` source reads Auto-detect, and Both is refused for it. **Execution (group check B):** with the Arabic target, record whether the pair row misaligns (the target select grew 34 → 47 px headless; CJK by a few px) — the shared `LanguagePairSection`, not Palabra code.
15. **Analytics:** `translation_session_start` with `provider: 'palabraai'`, `transport: 'websocket'`; a refused start → `api_error` with its code.
16. **The wizard:** Palabra AI last among the own-key providers; its credential step offers both modes and validates.
17. **Sentences in parts** (choice 12's `last_chunk` rule, [inf]): long sentences, with the sentence splitter and partial translations on, until a `translation_part_id` of 1 appears in the `audio.output` frames; record whether `last_chunk` comes once per sentence or once per part, and whether the parts' bursts interleave; watch the karaoke of each part. **Execution (Task 11's review, m3):** record also whether a part's first message can come before a lower part's.
18. **The settings take effect** (ruling 10): change each Provider-tab setting in turn — the sentence splitter off; partial translations on (`translation.partial` rows, and a translation streaming before it closes); the buffer's target and max; adaptive speech speed — run a session after each, and record the `task.set` frame and what changes in the behaviour.

**Open questions for the owner**
- **Each live-test hypothesis:** the start's bound against the times measured (item 2); the silence rule on a hidden page (item 5); whether minutes of real-time silence draw warnings (item 5); `errorCode`'s mapping past `VALIDATION_ERROR` (the frames of item 10); a refused upgrade online worded as the key (choice 8); `ERROR_WORDS_MS`; `last_chunk` per sentence or per part (item 17); `detectable_languages: []` under `auto` (item 8); which delete path runs (item 9).
- **`IDLE_MS` at 800 ms, not your "about half a second"** (Q3; "Found during execution", item 1): reported to you; reversible — one constant and its pins.
- **Silence on the audio clock:** the silence rule could ride the audio instead of a timer, and then no throttled timer could end a session. It needs two sites changed: while muted, the capture drops the chunk (`src/lib/audio/capture/core.ts:85`) and would deliver zeros instead; between presses, the capture still delivers and the runner's turn gate drops it (`src/lib/session/run.ts:450-453`), which would forward zeros instead (or a capture tick). Not built here, and not Palabra's alone: Soniox's STT keepalive (`src/providers/soniox/sttStream.ts:245-254`: a check every 5 s, a `keepalive` frame after 15 s without audio, against a server that times out at about 20 s), Soniox's TTS keepalive (`src/providers/soniox/ttsStream.ts:535`, every 20 s) and Doubao AST 2.0's real-time silence (`src/providers/volcengine_ast2/adapter.ts:278`, 80 ms packets after 250 ms without audio) share the exposure.
- **The idle bill:** Palabra bills while the task runs, silence included [doc], as the old always-on track did; `pause_task` would stop it at the cost of a resume on the next speech.
- **The docs' missing reverses:** targets `fil`, `kk`, `mk`, `sr`, which a plain swap would run.
- **Palabra's own guidance that the API key belongs on a server** [doc], which every own-key browser provider already departs from.

**The deletion inventory** (ruling 17), after the owner's live test — one
plan, read at `024266a0` (none of these files moved since `7ab709e1`, nor
during this plan):
- `src/services/clients/PalabraAIClient.ts` (+ test), `src/services/providers/PalabraAIProviderConfig.ts` (+ test), `palabraLanguageCodes.test.ts`, and every old test naming `Provider.PALABRA_AI` or `isPalabraAIEnabled` (`command grep -rln -e PALABRA_AI -e isPalabraAIEnabled src`), each checked first for what it pins of live code (`providerPaths.test.ts` pins the new definition's fit through the enum, and stays);
- `ProviderConfigFactory.ts:8, 80-83`; `tutorialUrls.ts:17`;
- `settingsStore.ts`: the slice's import, types and defaults (`:51-52`, `:88`, `:96`, `:288`, `:418`, `:654`, `:703`, `:970`), `migrateRejectedPalabraLanguages` (`:500-520`), `migratePalabraAuthMode` (`:522-537`), the load's two migrations (`:1354-1362`), `usePalabraAISettings` (`:1538`) and `useUpdatePalabraAI` (`:1622`) — the storage keys stay;
- the old UI's Palabra branches: `ProviderSpecificSettings.tsx:17, 37, 128, 152, 391-392, 470, 728, 957, 1226-1463, 2283`; `ProviderSection.tsx:15, 22, 107, 115, 471-476` and the `palabraai-credentials-group` block from `:757` (with its styles); `LanguageSection.tsx:16, 98, 151-152, 246-247`;
- `logStore.ts`: the old type classification (`:87-100`) and the old grouping rows (`:433-465` at `024266a0`, eight lines lower after Task 6);
- `isPalabraAIEnabled` (`src/utils/environment.ts:238-253`) and its forwarding — `extension/vite.config.ts:179-181`, `.github/workflows/build.yml:220, 274, 314, 416, 518`, the feature-gate forwarding test — and every test's `isPalabraAIEnabled` mock;
- `livekit-client` in `package.json:184` and the lockfile, with CLAUDE.md's pin text (`:390`, `:395-415`);
- `src/lib/modern-audio/WebRTCAudioBridge.ts:14` (`import type { RemoteAudioTrack } from 'livekit-client'`), coordinated with the OpenAI deletion, which orphans the bridge and its pcm worklet copy (`extension/vite.config.ts:76`): whichever plan runs second deletes the bridge;
- **keep:** `Provider.PALABRA_AI` and `LEGACY_SLICE_KEYS.palabraai` (the live id; a stored selection still resolves), `PalabraAIIcon`, the locale keys the new definition reads, the credential-choice styles.

**Amended in place** by this record, each marked "**Done**", "**Closed**",
"**Changed**", "**Settled**", "**Met**", "**Not taken**" or "**Widened**" by
the Stage 2 Palabra plan:
- plan 1b's F5 item for Palabra (not taken); the `Source.track` item carried out of plan 1c-1 ("1c-3 — capture") and plan 1c-3's Stage 2 processed-track item (closed);
- the foundation section's Palabra list (settled) and its parked kit items (done);
- the Volcengine AST2 section's `IDLE_MS` item (widened: the participant leg's 682.7 ms), its `frame-url` item (done), and its F14 line (changed: the plain seam moved without it);
- the OpenAI Realtime section's WebRTC decision — the order's LiveKit sentence (changed), F15 (closed for good), the kit-level scenario (done) — and its "What it leaves" items on the copies to lift (`socket.ts` done) and `checkReads`' obligation (met);
- the Gemini/AST2 follow-up's "What it leaves" item on `clear()` against a whole-text `End` (met for Palabra's finals).

**The roadmap's inheritance, item by item** (the plan's tables, as landed;
anchors are the roadmap's at `024266a0`): taken (and where), deferred (and
why), or already done. Survey §4 lists the earlier items.

From plans 1b, 1c-1 and 1c-3:

| Item | Disposition |
|---|---|
| 1b: "With Palabra: `migrate` cannot tell absent from default and cannot see credentials" (`:181-182`) | F5 was built for it; **Palabra does not use it** (rulings 2, 20). F5 stays for its users (OpenAI's and Gemini's `legacyKeys`, Gemini's `migratePair`); its comments no longer name Palabra as their reason (Task 4) |
| 1c-1 / 1c-3: `Source.track` / `StartRequest.input` "waits for an adapter that would" (`:206-209`, `:405`) | **deleted** (ruling 16; Task 3, `7d0b8cdd`): no adapter will |

From "Scheduled by the Stage 2 foundation plan":

| Item | Disposition |
|---|---|
| Palabra → F4, the credential-adjacent control (`:1299`) | consumed: `credentials.choice` on `authMode` (Task 8) |
| Palabra → `authMode` via `legacyKeys`, `vn` → `vi` via `migratePair` (`:1300`) | **not taken** (rulings 2, 20): stated departures |
| Palabra → `deleteSession` with a timeout (`:1301`) | **taken** for the app pair's session: 5 s, `keepalive`, its own only, a create the leg outlives included (choice 9); as landed, a transport failure tried again without `keepalive` ("Found during execution", item 7); moot for the platform key |
| Palabra → the G3 latency a stall leaves (`:1196-1201`, `:1302`) | mostly moot [inf]: a sentence's audio is a faster-than-real-time burst, so the clip queue has lead within it; live-test item 4 listens for gaps |
| The kit's parked items (`:1321-1325`) | **taken** (ruling 15; Task 5; choice 4); as landed, the unflushed server-close drive and 1005 / 1006 (item 3) |
| "Before any release": the release flags and the registry order (`:1352-1363`) | unflagged (ruling 14): nothing added to `VITE_ENABLED_PROVIDERS`; `VITE_ENABLE_PALABRA_AI` goes with the deletion |

From the Soniox plan's "Found here" (`:1740-1750`):

| Item | Disposition |
|---|---|
| Readiness re-probes on every edit | met by `checkReads: ['authMode']` (Task 14) |
| `audio.range` after fill-in (`:1743`) | **Done** by the Gemini/AST2 follow-up (its choice 19) for every provider; Palabra sends no `audio.range` at all — its ranges come by `speechRanges` over the final text, which L1 re-anchors on a punctuation fill-in (Palabra's text arrives punctuated, so it is a no-op [inf]) |
| Two TTS sockets per key | its analogue, two sessions per credential, settled by the owner's probe |
| `Conversation.afterAudio`'s pending drop (`:1747`) | **Done** by the follow-up (its choice 6); Palabra never reaches it: the translation opens on its first text or its first audio (choice 12) |

From "Scheduled by the Stage 2 Gemini plan":

| Item | Disposition |
|---|---|
| Leading audio opens the translation segment | done by construction (choice 12) |
| Name the leg in `SessionContext` | n/a: Palabra sends no instructions |
| `session.closed` on Stop | the same: nothing after stop |

From "Scheduled by the Stage 2 Volcengine AST2 plan":

| Item | Disposition |
|---|---|
| Palabra's use of F4 (`:3807`, `:3849`) | taken (Task 8) |
| Generic frame names grouped under Doubao's Logs keys (`:3855`) | respected: none of Palabra's names collides (Task 6's pin) |
| A kit-wide "no ws(s) URL in a frame" rule (`:3780`) | **built** (choice 10; `e5e3e5d5`): Palabra is its third query-credential user |
| Each check opens a real session (`:3775`) | n/a: a GET that creates nothing |
| Superseded checks are never aborted (`:3778`) | applies, harmlessly: a GET, rarer with `checkReads` |
| The ScriptProcessor's 341 ms chunks against `IDLE_MS` (`:3779`) | avoided by construction: Palabra's `IDLE_MS` is 800 ms as landed — the plan's 500 raised for the participant leg's fallback, 682.7 ms a chunk ("Found during execution", item 1); AST2's own stays its question, widened in place |

From "Scheduled by the Stage 2 OpenAI Translate plan" and "… OpenAI Realtime plan":

| Item | Disposition |
|---|---|
| `pcmToBase64` / `base64ToPcm`, `boundedFetch` | reused (Tasks 9, 12) |
| `ERROR_WORDS_MS` and a negative age (`:4545`, `:5314`) | reused (ruling 11; choice 8); the same rule also rebases the idle wait (choice 7) |
| `socket.ts` "to move with the others when F14 lands" (`:5330`) | **lifted now** without F14 (choice 1; `0e9ccff0`); F14 stays OpenAI Live's and joins it |
| `checkReads`' obligation: every field that decides the credential fields (`:5335`) | met: `authMode` is listed — the first provider whose fields depend on a setting to declare `checkReads` |
| The orphaned socket on an unreachable path (`:5336`) | applied from the start: the bound and the abort are armed before anything opens |
| The kit-level seeded lifecycle scenario, "reassigned … Palabra next" (`:5098-5104`, `:5308`) | **built** (ruling 15; Task 7, hardened over three review rounds — "Found during execution", item 2), first run over Palabra (choice 19) |
| The kit's parked items (`:5322`) | taken (Task 5) |
| The merged OpenAI deletion (`:5077-5083`) | coordinated: it orphans `WebRTCAudioBridge` (a `livekit-client` type import) and the pcm worklet copy — recorded in this record's inventory |
| F15, the processed track (`:5085-5089`, "closed … the items wait for an adapter that would") | closed for good: the seam is deleted (ruling 16) |

From "Scheduled by the Stage 2 Gemini/AST2 follow-up plan", its "What it leaves" (`:5714-5731`):

| Item | Disposition |
|---|---|
| `clear()` against a whole-text `End` | **applied as planned, then met for finals** ("Found during execution", item 6): a final always sends its text and language, so a clear between the last partial and the validation no longer closes the row blank; a partial equal to the last is still skipped. The contract question stays the follow-up's |
| The release tail's lift | n/a: Palabra's release flushes the re-chunker and relies on the silence rule, not a tail |
| The pair's fall on a model switch | n/a: Palabra's offer reads no setting (choice 13) |
| Gemini's per-model offer (its choice 16) | taken into Task 4's invariant: Gemini's three offer shapes are declared by name (choice 3) |
| Readiness narrowing (`checkReads`) for Gemini and Doubao | not Palabra's; Palabra declares its own (Task 14) |

Stage 2 items no plan took and this one does not either: `RunnerDeps.replayAudio`'s guard, the notice-code namespace, the account's compile-time narrowing.

What it leaves, for the plans that meet it (the plan's own list, as written;
then the items the reviews and this record routed here, last below):
- **The Palabra deletion plan** (ruling 17; this record's inventory), after the owner's live test — coordinated with the OpenAI deletion over `WebRTCAudioBridge`.
- **The setup guide** (ruling 18): the definition links today's page.
- **Silence on the audio clock** (an open question for the owner, above): zeros that rode the audio — the capture delivering them while muted (`core.ts:85`), and the runner forwarding them between presses, where its turn gate drops the capture's audio (`run.ts:450-453`) — would keep every provider's session alive on a throttled page; not built — the rule's timer is Palabra's, Soniox's and Doubao's alike.
- **The shared `SliderField` and on/off field** (choice 15): Palabra's view is the sixth copy of the slider markup; the lift rewrites five providers' views, each with its own render check.
- **The silence rule and the re-chunker at a third user:** AST2's and Palabra's are two; lift them when a third provider needs real-time silence. AST2's keepalive reads `now - lastAudioAt` as Palabra's did before choice 7's rebase: a wall clock stepped back delays its silence too — for its own change.
- **The seeded lifecycles for the other adapters:** the kit is ready (ruling 21); each earlier port gains a harness in its own change.
- **Three plain swaps left outside the hook:** `src/lib/export/transcript.ts:107` (`pairOf`) rebuilds the speaker's pair from the participant's as `{ source: participant.target, target: participant.source }`, so a participant-only export of Palabra's `ja → en-us` reads `ja → en` in its header; `src/app/telemetry.ts:189` labels the participant's segmentation bucket with `run.pair.target`, `en-us` where the leg ran `en` (Task 4's review, N4); and the Both mirror line — `pairSentence` (`src/components/SetupWizard/languageSentence.ts:52`), rendered by `src/components/providers/LanguagePairSection.tsx:106-113` and the wizard's `StepLanguagePair.tsx:97-103` and `StepFinish.tsx:62` — builds "They speak {target} → I read {source}" from the pair itself, without `reversedPair` or `reverseSupported` (the final review, M2): Palabra's `ja → en-us` shows "They speak English (US) → I read 日本語" while the participant leg actually runs `en → ja`, and a pair with no documented reverse still shows the line, though the live gate keeps Start off for it. All three cosmetic; routing them through `reversedPair` needs the provider at each site — the mirror line's fix, computing it through `reverseSupported` / `reversedPair` in `LanguagePairSection`, is a UI change left to the owner.
- **`pause_task` for idle billing:** an open question (above), not built.
- **Typed text through `tts_task`:** not proposed; `textInput: false` stays at parity.
- **The owner's open questions,** each with the live-test item that settles it.
- **Nothing on the old code:** the old client, descriptor, slice readers and UI branches stay compiled and unreachable, as the protocol documentation.
- **For the final review:** the items under "Accepted as they stand" above.
- **Production comments that cite a review or a task** (this record's reading of the landed code), against the plan's rule that production comments cite rulings, choices, D rulings and F items only: `src/lib/session/shape.ts:129` ("review N3"), `src/providers/palabraai/audioIn.ts:18` ("fix round 1, I1"), `:42` ("fix round 1, N3") and `:43` ("Task 13's adapter"). The test-only kit and fixtures do the same (`src/lib/contract/testing/fakeSocket.ts:99`, `scenarios.ts:34, 36, 131`; `src/providers/palabraai/testing.ts:157, 169, 181, 217`), which the rule does not cover. Wording only; the OpenAI Realtime record's `gemini/config.ts:70` is the same kind.
