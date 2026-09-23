# Client contract — Stage 1 roadmap

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md`

Stage 1 of the spec ("the new spine and one provider, end to end") spans five
subsystems that can each be built and tested on their own. It is therefore
five plans, executed in this order. Each plan leaves the tree green and its
own layer usable; none of them touches the old clients, which keep working
until plan 1e replaces MainPanel's session path.

| Plan | Builds | Proven by |
|---|---|---|
| **1a — the spine** (`2026-09-23-client-contract-stage1a-spine.md`) | L0 contract types, the fake adapter and its script format, the conformance checker, L1 (`Conversation`), L2 (`project`), the export writer | vitest only: the fake's scripts are the fixtures |
| **1b — the provider definition** | `Provider<S, K, C>`, the registry, generic settings and credential storage, the credential form, the language section, readiness (`check`), `VITE_ENABLED_PROVIDERS`, the fake as the first registered provider | vitest, plus the settings panel rendered against the fake |
| **1c — the runner** | `sessions.*`, the run and its resource stack, sources (mic, system, tab, fake), the turn object, ClipQueue / AudioOut / routing, the echo taps, analytics | vitest with fake sources and the fake adapter; a live fake session in the app |
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
