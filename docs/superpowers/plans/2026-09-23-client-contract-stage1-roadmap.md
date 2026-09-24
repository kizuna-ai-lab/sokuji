# Client contract — Stage 1 roadmap

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md`

Stage 1 of the spec ("the new spine and one provider, end to end") spans five
subsystems that can each be built and tested on their own. It is therefore
five plans — seven, since the runner splits from capture and playback (the
runner tests with a fake source and a recording sink; the audio side needs a
live device), and playback splits from capture (the passthrough route and
the echo monitor's reference live in playback's graph, so it comes first) —
executed in this order. Each plan leaves the tree green and its
own layer usable; none of them touches the old clients, which keep working
until plan 1e replaces MainPanel's session path.

| Plan | Builds | Proven by |
|---|---|---|
| **1a — the spine** (`2026-09-23-client-contract-stage1a-spine.md`) | L0 contract types, the fake adapter and its script format, the conformance checker, L1 (`Conversation`), L2 (`project`), the export writer | vitest only: the fake's scripts are the fixtures |
| **1b — the provider definition** | `Provider<S, K, C>`, the registry, generic settings and credential storage, the credential form, the language section, readiness (`check`), `VITE_ENABLED_PROVIDERS`, the fake as the first registered provider | vitest, plus the settings panel rendered against the fake |
| **1c-1 — the runner** (`2026-09-24-client-contract-stage1c1-runner.md`) | `sessions.*`, the run and its resource stack, the source and playback ports, the fake source, the turn object, the session hooks, analytics, the global turn mode | vitest with fake sources and the fake adapter; a live fake session in the preview, read but not heard |
| **1c-2 — playback** (`2026-09-24-client-contract-stage1c2-playback.md`) | the clip queue, one Web Audio graph (five feeds, two buses, routes as gain edges), the route table and its two new switches, replay, the preview route and the test tone, the extension's virtual microphone from the virtual bus, the tts tap — behind the playback port | vitest with a recording Web Audio; the preview's fake session heard, checked headlessly by `scripts/dev/spine-audio-probe.mjs` |
| **1c-3 — capture** | real sources (mic, system audio, tab) behind the source port, device switching and mute inside them, `ended` / `degraded`; the passthrough source into playback's route; the echo monitor on the source taps and playback's tts tap | vitest with fake media; headless Chromium's fake microphone; a live device |
| **1d — the surfaces** | the panel's conversation list, the Electron subtitle takeover, the extension overlay, export, the idle surfaces, notices | headless Chromium against the fake provider |
| **1e — LocalInference** | the first real adapter and definition; MainPanel's old session path deleted | a live local session on Electron and the extension |

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
