# Client contract — Stage 2 foundation: what every remaining provider needs first

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, vendor-free, the pieces every Stage 2 provider needs before the first one ports, so the owner's live testing starts with Soniox rather than being spent on scaffolding (survey §3.1's recommendation). Concretely:
- readiness is checked automatically for every kind of provider, and forgotten when the sign-in changes (F1);
- the models a check found reach the provider's settings component and its builder (F2);
- a missing credential says why by a code, the sign-in carries the user id, and a provider's `Settings` can reach its account (F3);
- migrations can read legacy keys with no default (so an absent key is told from a default), the credentials and the stored pair (F5);
- a managed provider needs the Kizuna umbrella, and a flagged one can be unlocked by a tester switch (F6);
- the start gate runs live, so Start is off, with the reason in words, before it is pressed (F7);
- provider notice codes reuse sentences every locale already has (F8);
- an adapter test kit: a `FakeSocket`, a scenario driver over the conformance checker, the clock convention (F9);
- the fake grows the shapes the remaining providers have (ref-less continuous audio, frame ranges, no ranges, a reconnect, a script per leg) and a second, leased fake carries `prepare` / `acquire` / `startBoth` (F10);
- guards: registry invariants over `PROVIDERS`, the console ledger over `src/providers`, and a provider's session side free of stores, the reporter and global timers (F17);
- the streaming-audio measurement through the clip queue (G3), with its fix written and executed only if the measurement says it is needed.

The plan ends with the spec's and the roadmap's amendments (controller ruling 6).

**Architecture:**
- **The provider definition** (`src/lib/provider/types.ts`) gains optional members only: `i18nKey`, `testerSwitch`, `settings.legacyKeys`, `languages.migratePair`; `migrate` gains a second argument; `credentials.read` may answer `{ missing, code?, params? }`; `AuthContext` gains `userId?`; `SettingsProps` gains `models?` and `account?`; `SharedSettings` gains `models`. No existing provider must change.
- **The stores and the root:** `providerStore` loads with migration inputs, keeps each provider's latest models, and exposes `forgetReadiness`. The root's readiness driver (`src/app/readiness.ts`) drives every kind and hears sign-in flips from `setBridges`. The subtitle session (`src/lib/subtitle/appSession.ts`) reads the live gate (`liveGate` in `src/lib/session/appShape.ts`).
- **The runner** hands `build` the models its own readiness answer found, uses a refusal's own code for missing credentials, and hands `acquire` the run's clock.
- **The test kit** (`src/lib/contract/testing/`) is test-only: nothing but a test imports it (a guard says so).
- **The fakes:** `fake` gains four scripts and a per-leg script; `fake_leased` is a second DEV-only definition of `kind: 'managed'` whose session hooks are its knobs. The registry's `import.meta.env.DEV` literal keeps both out of release builds (D24).
- **Playback** changes only if the G3 measurement asks (Task 15), and then inside `ClipQueue`: one clip is still one speech entry.

**Tech Stack:** TypeScript (strict), React 19, zustand, i18next, Vitest + @testing-library/react (jsdom), the TypeScript compiler API in consistency tests, Web Audio, headless Chromium over the DevTools protocol (`scripts/dev/headless.mjs`).

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — the binding authority. The parts this plan implements:
- "The provider definition" → "The shape", "Credentials are not settings", "Readiness is one check", "The registry is a list (D19)", "Persisted settings that move";
- "Session hooks on the provider definition";
- "Notices reach the user localized";
- "What every adapter must honour" and "Testing" (the fake's knobs, the conformance suite, D24);
- "The clip queue".

It amends "D11", "Managed twins are composition" and "Migration" (Task 16).

**Research notes:**
- **The survey this plan is written from:** `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/stage2-foundation-survey.md`, cited as *survey §x* / *Fn*.
  - §1: what exists; §2: the gaps; §3.1: the foundation pieces F1–F18; §3.4: where the spec is wrong or incomplete.
  - Several of its `file:line` references are stale. For example, `presence.ts:251-257` is `:15-21`, `registry.ts:215-236` is `:12-30`, `readiness.ts:343-391` is `:25-73`, and the `SessionHooks` block is `session/types.ts:48-66`. This plan cites lines checked at `1bfdd362`, which equals `1868ff80` for every file under `src`.
- **The roadmap:** `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`, cited as *roadmap <section>*.
- **The form model:** `docs/superpowers/plans/2026-09-26-client-contract-stage1e4-extension-overlay.md`.

## Global Constraints

- **Starting point.** This plan starts after plan 1e-3c (`docs/superpowers/plans/2026-09-26-client-contract-stage1e3c-transitional-deletion.md`), which was executing in this worktree when this plan was written: its Tasks 1–4 were committed by `507a539a`. Plan 1e-3c edits five files this plan edits again:
  - `ProviderPicker.tsx` (a comment; its Task 7);
  - `SpinePreview.tsx` and `SpinePreview.test.tsx` (the device enumeration; its Task 5);
  - `consoleLedger.consistency.test.ts` (two rows);
  - `src/providers/localInference/provider.ts` (a comment at `:24-25`; its Task 7).

  So every task here anchors its edits by content, not by line. The controller records both baselines below at this plan's start commit.
- **What this plan touches:**
  - `src/lib/provider/**`, `src/lib/session/{run,shape,shared,appShape,types}.ts` and their tests, `src/lib/subtitle/{session,appSession}.ts` and their tests, `src/lib/view/noticeText.ts` and its test, `src/lib/audio/{clipQueue,playback}.ts` and their tests (Task 15 only), and `src/lib/contract/clock.ts` and its test;
  - `src/lib/contract/testing/**` (new);
  - `src/providers/**`;
  - `src/stores/providerStore.ts` and its tests;
  - `src/app/{readiness,session,useAppSession}.ts` and their tests;
  - `src/components/providers/**`, `src/components/Settings/ProviderArea.tsx`, `src/components/Settings/sections/SpeechSection.tsx`;
  - `src/components/dev/{SpinePreview,SessionControls}.tsx`, `src/components/dev/gapCounter.ts` (new), and their tests;
  - `src/utils/environment.ts` (one new function; `hasLocalNativeDebugSwitch` delegates to it) and its test;
  - one describe block of `src/lib/diagnostics/consoleLedger.consistency.test.ts`, and `src/providers/sessionSide.consistency.test.ts` (new);
  - `scripts/dev/spine-audio-probe.mjs`, and `scripts/dev/spine-gate-probe.mjs` (new);
  - the spec and the roadmap (Task 16).
- **Read only (controller ruling 1).** The old provider code is the source each provider is ported from:
  - `src/services/clients/**` and `src/services/providers/**`;
  - the old settings UI: `ProviderSpecificSettings.tsx`, `ProviderSection.tsx`, `LanguageSection.tsx`, `SonioxVoiceSection.tsx`, `PoweredBy.tsx`, `EngineStatusLine.tsx`, the LocalNative sections, and their tests;
  - `src/stores/settingsStore.ts` (its slices), `src/components/SettingsInitializer/**`, `src/components/SetupWizard/**`, `src/types/Provider.ts`;
  - `extension/**`, `electron/**`, and `src/locales/**` (controller ruling 4: no key is added).

  Nothing here may import the old code except through what already does (`appShape.ts` reads `settingsStore`'s global fields, as it does today).
- **Import rules:**
  - `src/lib/**` never imports React or `src/app/**`. `src/lib/contract/testing/**` is test-only: only tests, and test-only helper modules, import it (Task 5's guard, which defines "test-only").
  - A provider's session side — its `adapter.ts` and what that reaches in its own folder — imports no store and no reporter, and runs no global timer (Task 5's guard). Its builder, `check` and session hooks may read its own stores (spec: "A provider's own stores are its own business"); the guard does not cover the hooks, and its header says why (choice 11).
  - Both fakes reach a bundle only through the registry's `import.meta.env.DEV` literal, and neither module runs code at module scope: no call, no object spread of an import (D24, the 1e-3a lesson). The group checks grep the release bundles for one sentinel string from each fake.
  - The meeting page's overlay graph is unchanged: nothing here adds an import to `src/subtitle-overlay-entry.tsx`'s graph.
- **Diagnostics** (CLAUDE.md, "Error Handling"):
  - A caught failure is recorded with `reportError` / `reportWarning` (`src/lib/diagnostics/report.ts`), never `console.error` / `console.warn`. `src/providers/**` joins the roots held at zero (Task 5).
  - An adapter never reports and never logs. It says what happened through its events: `degraded` (a `CLIENT_DIAGNOSTICS` code), `failed`, `closed`, and `frame` for the Logs panel (spec: "What every adapter must honour", D8).
  - A notice the user sees carries a `code`. Its words come from `noticeText` — `notices.<code>`, or an alias onto an existing sentence (Task 3).
- **Locales** (controller ruling 4). No new locale key. A notice code reuses an existing translated key through `NOTICE_ALIASES`. No task in this plan adds a key; `locales.consistency.test.ts` stays untouched.
- **Gates for every task:**
  - **The suite.** `npx vitest run src` shows 0 failed and no unhandled errors. Measured on 2026-09-26 at 16:30, at `1bfdd362` with plan 1e-3c's Task 1 staged: 470 test files passed and 1 skipped (471); 5 978 tests passed and 2 skipped; no unhandled errors. The controller records the totals at this plan's start commit.
  - **The typecheck.** The gate prints exactly the baseline lines below. The shell's `grep` is a ugrep wrapper that mis-parses this regex, so use `command grep` exactly as written. The regex is plan 1e-4's gate, widened by the one file this plan creates outside it, `dev/…|gapCounter` (Task 6). Every other file this plan creates or edits is already covered: `app/`, `lib/(session|audio|provider|…|contract|view|subtitle)`, `providers`, `components/providers`, `Settings/ProviderArea`, `sections/SpeechSection\.tsx`, `dev/(SpinePreview|SessionControls…)`, `stores/providerStore`, `utils/environment`, `lib/diagnostics/consoleLedger`.

    ```
    npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts|diagnostics/consoleLedger)|lib/modern-audio/BaseAudioRecorder|providers|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|MainPanel\.|panel/)|MainLayout/MainLayout\.tsx|Settings/(Settings\.tsx|ProviderArea|SimpleSettings/SimpleSettings\.tsx|AdvancedSettings/AdvancedSettings\.tsx|sections/(SpeechSection|ParticipantSpeechSwitch|SentenceSegmentationSection|SystemAudioSection)\.tsx)|SettingsInitializer/|SetupWizard/(SetupWizard\.tsx|applySetup\.ts|useApplySetup\.ts|providerPaths\.ts|steps/StepLanguagePair\.tsx)|TitleBar/AccountButton\.tsx|Tour/useStartBasicsTour\.ts|dev/(SpinePreview|SessionControls|OverlayPreview|wireTally|gapCounter))|contexts/UserProfileContext\.tsx|locales/(index\.ts|showLanguageUncached)|routes/Home\.tsx|stores/(providerStore|turnModeStore|routingStore|settingsStore\.ts)|utils/(environment|conversationExport)|subtitle-overlay-entry|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
    ```

    **The baseline.** The controller counted **16** lines at `1868ff80`: plan 1e-4's 17, minus `Settings.tsx`'s TS2345, gone since `83c59d53`. Plan 1e-3c's Task 1 (`aea17e74`) deleted `SubtitleApp.handleStart.test.tsx`, and with it that file's TS6133 line. The review measured the regex at `6babf7a0`: exactly the **15** lines below. The controller records the exact list at the start commit.

    ```
    src/App.tsx: error TS6133: 'React' is declared but its value is never read.
    src/components/MainLayout/MainLayout.tsx: error TS6133: 'useTranslation' is declared but i
    src/components/Settings/sections/SystemAudioSection.tsx: error TS2345: Argument of type '"
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/lib/analytics.ts: error TS6133: 'response' is declared but its value is never read.
    src/routes/Home.tsx: error TS6133: 'React' is declared but its value is never read.
    src/stores/settingsStore.ts: error TS2353: Object literal may only specify known propertie
    src/stores/settingsStore.ts: error TS2353: Object literal may only specify known propertie
    src/utils/environment.ts: error TS2717: Subsequent property declarations must have the sam
    src/utils/environment.ts: error TS2339: Property 'create' does not exist on type '{ query(
    ```

    Do not fix them; do not add to them. Lines may disappear if plan 1e-3c's later tasks touch these files; the start commit's list is the one that binds.
  - **Gates in a parallel wave** (as plan 1e-4's controller ruling I1). Waves run tasks at once in this one working tree, so each task sees the others' red phases.
    - A test failure, or an extra typecheck-gate line, in a file another concurrent task is changing is that task's work in progress. The implementer names it in the report and never touches it.
    - The task's own files must be green, and the gate must print the baseline plus only such named lines.
    - After each wave the controller runs the full gates: the suite at 0 failed with no unhandled errors, and the exact baseline.
  - **A task edits only the files in its Files list**, and commits exactly those. Where a step names tests elsewhere that its change could reach, it names why each stays green. If one fails anyway, the implementer stops, reports the failure with its output, and leaves the file untouched: the controller decides. No task edits a read-only file (controller ruling 1) or a file another task of the same wave edits.
  - **No task mutates the tree to prove a guard** (a temporary `console.warn` or timer in a real file). Every guard proves itself with controls inside its own test; a hand mutation would turn every concurrent task's suite red.
- **Builds, at the group checks only** (the controller's):
  - `npm run build` and `npm run extension:build`. If `extension/node_modules` is missing, run `npm ci --prefix extension` first.
  - `npx vitest run extension`.
  - The D24 check: each of these prints nothing —
    - `command grep -rlF 'The fake degraded its speech' build extension/dist`
    - `command grep -rlF 'Lease ended by the leased fake' build extension/dist` (from Task 11 on).
- **Dev servers, probes and builds** are the controller's; an implementer never starts one. After the relevant commits the controller runs the named checks against a fresh vite: `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort --force`. Restart it after edits: a worktree's vite can serve stale transforms.
- **Shell forms.** This worktree's guard refuses compound shell forms: brace groups, loops, `cd … &&` chains. Every command in this plan is a single command or a plain pipeline, run as its own call from the worktree root. Use `command grep`. Checks write their outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, never `/tmp`.
- **Commits:**
  - Conventional, in English. Every message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and nothing after it.
  - Run `git add <paths>`, then `git commit -q -F - -- <the same paths> <<'EOF' … EOF`, as two separate calls. The `--` pathspec is mandatory: parallel tasks, and plan 1e-3c's leftovers, stage into the same index. Never stage a whole directory.
  - Never push.

## Rulings

The controller's six rulings bind this plan (cited as *controller ruling N*). Each is restated here with where it lands.

1. **The old provider code is read-only here.** The owner reversed D11 on 2026-09-26: each provider's old code stays as the source it is ported from, and goes only after the owner live-tests its port. It lands in Global Constraints ("Read only") and in Task 16's spec amendment.
2. **Stage 2 provider ids are the old `Provider` enum strings** (`soniox`, `kizunaai_soniox`, `gemini`, `volcengine_ast2`, `openai_translate`, `openai`, `openai_compatible`, `palabraai`, `openai_live`, `local_native`). LocalInference keeps `localInference` with its mapping.
   - **Decided here:** the definition gets an optional **`i18nKey`**, the segment its locale keys sit under when the catalogs spell it otherwise. OpenAI Compatible's plan sets `'openaiCompatible'`. LocalInference sets `'local_inference'` now, so the picker reads the locale key from the definition rather than from the stored-value mapping.
   - Task 14's invariants pin both halves: every released id is an old enum spelling (through `storedProviderValue`), and every released provider has `providers.<i18nKey ?? id>.name` and `.description` in `en`.
   - Why not an exception table: it would be shared code a provider plan must edit, against the spec's measure ("adding a provider edits no shared code file except the registry list").
3. **Order after this plan** (the owner may overrule): Soniox → Kizuna Soniox → Gemini → Volcengine AST2 → OpenAI Translate → OpenAI + OpenAI Compatible → OpenAI Translate WebRTC → Palabra → OpenAI Live → Local Native, one plan per provider. Soniox and Kizuna Soniox may share one plan in two task groups, each with its own live test. The two relay twins are not ported onto the relay (owner ruling 2026-08-30). It lands in Task 16's spec amendment and in "What this plan leaves".
4. **Locales:** no new key; a notice code reuses an existing translated key through an alias. It lands in Task 3 and in Global Constraints.
5. **The fake provider stays** (D24; owner confirmed 2026-09-26). It grows here into the conformance suite and demo provider every Stage 2 adapter uses (Tasks 4, 8, 11, 12), and never reaches a release build (group checks A and B).
6. **Spec and roadmap amendments**, doc-only: Task 16.

**The controller's rulings on the review** (`stage2-foundation-plan-review.md`, 2026-09-26) also bind:
- **Task 15's trigger:** G3 is measured three times, and Task 15 runs only if the worst run exceeds the threshold (choice 13; group check A item 5).
- **Survey §3.4 items 8 and 9** are recorded as resolved by this plan, with the clause that `credentials.read` stays synchronous (Task 16).
- **Readiness timing:** check at once on a provider's selection or load and on a sign-in flip; debounce only edits, by 800 ms, a judgement value (choice 7; Task 13).
- **The session-side guard's scope** is decided from the spec (choice 11; Task 5).
- **The kit rule** allows test-only helper modules, defined precisely (Task 5, case 6).

## Choices this plan makes inside the rulings

Cited as *choice N*.

1. **The session hooks live on a second fake, not as knobs on the fake** (Task 11).
   - A provider's hooks are static: the runner calls `prepare` whenever it is defined — the run passes through a `preparing` step — and `acquire` whenever it is defined, and `startBoth` replaces the parallel legs for every two-leg run.
   - On `fake` that would re-route every fake-driven run: 25 test files and every headless probe.
   - `fake_leased` (`kind: 'managed'`) carries all three hooks. As a side benefit it is the first registered managed provider, so F1, F3, F6 and F8 run end to end in the preview.
2. **`acquire` gets the run's clock** (`ctx.clock`): the lease's timers need one, and Kizuna Soniox's budget poll will read the same clock. It is a one-member addition to the spec's `SessionHooks` (Task 11; recorded in Task 16).
3. **The models a provider's settings component shows come from the store's last ready answer** (Task 10).
   - They are kept through a re-check, so a model dropdown does not empty on every settings edit.
   - They are kept through a check that threw — offline: it found nothing out.
   - They are emptied only when the provider said no (`ok: false`) or the credentials are missing.
   - The run hands `build` its own fresh answer (`shared.models`), so one effective-model function sees the same list in both places (spec: "Readiness is one check").
4. **The account (`SettingsProps.account`) goes to `Settings` only**, from `ProviderOwnSettings`, whose hosts pass the sign-in (Task 10). The voice library, the one reader the survey names, lives in `Settings`. `TurnDetection` and `Engine` need none.
5. **Presence gets a declarative `testerSwitch` key** rather than a function hook. `PresenceEnv.switchOn(key)` reads it, so `isPresent` stays a pure function of its inputs (Task 1).
6. **The live gate is the runner's `gate()`**, over the stores (Task 2). `RunShape` satisfies the narrower `GateInput`. Its refusal takes its place in the idle model after the microphone and before the provider's readiness — the precedence of today's `computeStartGate` (`1868ff80:src/components/MainPanel/sessionStartGate.ts:200-212`).
7. **The readiness driver drives every kind** (Task 13; the controller's timing ruling). For an own-key or managed provider:
   - it checks at once — on the clock's next turn, never inside another store's notification — when the provider is selected, when its entry loads, and on a sign-in flip;
   - it debounces every other reset — an edit to the settings, the credentials or the pair, and the legs changing — by `NETWORK_READINESS_DELAY_MS` = 800 ms, so typing a key checks once per pause, not per keystroke. The value is a judgement, not a measurement.
   - A local provider keeps today's path: every check after `READINESS_DELAY_MS` = 150 ms.
   - A sign-in flip — signed in or out, or another account (`userId`) — forgets every loaded managed provider's readiness. The flip is heard on a microtask after `setBridges`, never inside React's render, which would update the store's subscribers mid-render.
   - Only an own-key provider shows Validate; a managed one follows the sign-in.
8. **Migration gets inputs, not writes** (Task 9): legacy keys read as `getSetting` returns them with no default, the credential values, and a rewrite of the stored pair. Nothing is written back. A provider whose migration must be written once adds that in its own plan.
9. **Notice aliases cover the neutral sentences** (Task 3): `sign_in_required` and the lease's and connection's words, which name no vendor. Soniox-named sentences ("Soniox is temporarily unavailable…") and the managed-voice ones are left to the plans that emit them, which choose their codes.
10. **The test kit is framework-free** (Task 4).
    - It returns reports, and each adapter's test asserts them.
    - `FakeSocket` extends `EventTarget` and fires `close` on a microtask, as a browser queues it.
    - The driver bounds a start that never settles instead of hanging the test.
    - The kit's own tests drive two example adapters kept in one test-only module (`examples.ts`): a minimal socket adapter — the shape a Stage 2 socket adapter takes — and a broken one, which the scenarios must catch.
11. **The session-side guard follows `adapter.ts` through its own folder only** (Task 5). A spine module under `src/lib` is held by its own rules.
    - **The hooks are not held to it**, on the spec's word (the controller asked for this to be decided from it). The hooks are `prepare`, `admit`, `acquire` and `startBoth`.
    - **They may read the provider's own stores.** Spec, "The provider definition": "A provider's own stores are its own business". LocalInference's shipped `admit` reads `modelStore`'s device features (`src/providers/localInference/config.ts:174`).
    - **They run on the runner's side of a run**, not inside one leg's session. So the rule that keeps a client off the reporter — it cannot know its leg — does not apply. A hook's failure becomes the run's refusal, `end(notice)`, or a release the runner's stack reports.
    - What the spec does forbid them — reading the live generic stores the run's shape froze (spec: "A run") — they are handed as `shape`.
    - `acquire`'s timers read `ctx.clock` (choice 2). That is a convention the Kizuna Soniox plan meets; it may extend the guard to its hook module if the owner wants it enforced.
    - The guard's header states all of this.
12. **The G3 fix, if one is needed, is an adaptive lead inside `ClipQueue`, not coalescing** (Task 15). Coalescing chunks in playback would break "a clip is one speech entry" (spec: "The clip queue") — the key karaoke and replay map to a segment. Coalescing in each adapter would duplicate it per provider.
13. **G3 is measured three times, and the worst run decides** (the controller's ruling). One headless run under load could show a spurious steady-phase gap. Task 15 runs only if the worst of three runs exceeds group check A's threshold.

## File Structure

| File | Change |
|---|---|
| `src/lib/provider/types.ts`, `presence.ts` (+ test), `src/providers/registry.ts` (+ test), `src/utils/environment.ts` (+ test) | `testerSwitch`, `PresenceEnv.kizuna` / `switchOn`, the umbrella for managed providers, `debugSwitchOn` (Task 1) |
| `src/lib/session/shape.ts` (+ test), `appShape.ts` (+ test), `src/lib/subtitle/session.ts` (+ test), `appSession.ts` (+ test), `src/components/dev/SpinePreview.tsx` (+ test), `scripts/dev/spine-gate-probe.mjs` | `GateInput`, `liveGate`, the refusal in the idle model and `canStart`, the preview's `&mode=` (Task 2) |
| `src/lib/view/noticeText.ts` (+ test) | `NOTICE_ALIASES` (Task 3) |
| `src/lib/contract/clock.ts` (+ test), `src/lib/contract/testing/{fakeSocket,drive,scenarios}.ts` (+ tests), `src/lib/contract/testing/examples.ts` | `every`, `FakeSocket` / `fakeSockets`, `driveAdapter`, `runScenario`; the echo and broken example adapters (Task 4) |
| `src/lib/diagnostics/consoleLedger.consistency.test.ts`, `src/providers/sessionSide.consistency.test.ts` | `src/providers` in the ledger at zero; the session-side rules; the kit is test-only (Task 5) |
| `src/components/dev/gapCounter.ts` (+ test), `SessionControls.tsx`, `scripts/dev/spine-audio-probe.mjs` | gaps in what the tts tap heard, on the probe line; `--max-gaps` (Task 6) |
| `src/lib/provider/types.ts`, `credentials.ts` (+ test), `src/stores/providerStore.ts` (+ readiness test), `src/lib/session/run.ts` (+ `runner.test.ts`), `src/app/useAppSession.ts` (+ test), `src/components/providers/useAuthContext.ts` | `CredentialsMissing` with its code; `AuthContext.userId` (Task 7) |
| `src/providers/fake/{script,synth,adapter,generate,scripts,settings,provider,FakeSettingsView}.ts(x)` (+ tests, `scripts.test.ts` new) | four scripts, a phase-continuous tone, a script per leg (Task 8) |
| `src/lib/provider/types.ts`, `src/stores/providerStore.ts` (+ test) | `legacyKeys`, `MigrationInputs`, `migratePair` (Task 9) |
| `src/lib/provider/types.ts`, `src/lib/session/{types,shared,run}.ts` (+ `runner.test.ts`), `src/stores/providerStore.ts` (+ readiness test), `src/components/providers/useSelectedProvider.ts` (+ `useSelectedProvider.test.tsx`, new), `src/components/providers/{ProviderOwnSettings,ProviderPicker,ProviderPanel}.tsx` (+ tests), `src/components/Settings/ProviderArea.tsx`, `sections/SpeechSection.tsx`, `src/providers/fake/provider.test.ts`, `src/providers/localInference/config.test.ts` | `SettingsProps.models` / `account`, `SharedSettings.models`, the store's `models`, `ownProps` (Task 10) |
| `src/providers/fake/{leased,FakeLeasedSettingsView}.ts(x)` (+ tests), `FakeSettingsView.tsx` (`toMs` exported), `settings.ts`, `provider.ts`, `src/lib/session/{types,run}.ts` (+ `runner.hooks.test.ts`), `src/providers/registry.ts` (+ test) | the leased fake; `acquire`'s clock (Task 11) |
| `src/app/useAppSession.ts` (+ test), `src/components/dev/SpinePreview.tsx` (+ test) | the preview's signed-in stand-in; `&script=` for the selected fake (Task 12) |
| `src/app/readiness.ts` (+ test), `src/app/session.ts` (+ test), `src/stores/providerStore.ts` (+ readiness test), `src/components/providers/ProviderPicker.tsx` (+ test) | `driveReadiness`, sign-in flips, `forgetReadiness`, Validate for own-key only, `api_key_validated` (Task 13) |
| `src/lib/provider/types.ts`, `src/providers/registry.test.ts`, `src/components/providers/ProviderPicker.tsx` (+ test), `src/providers/localInference/provider.ts` | `i18nKey`; the invariants (Task 14) |
| `src/lib/audio/clipQueue.ts` (+ test), `playback.ts` (+ test) | the adaptive lead, only if group check A asks (Task 15) |
| the spec, the roadmap | the controller's amendments and record (Task 16) |

**Order and parallelism.**
- **Wave 1:** Tasks 1, 2, 3, 4, 5 and 6 touch disjoint files and may run in parallel. Of all the tasks that edit `src/lib/provider/types.ts`, only Task 1 runs in this wave.
- **Wave 2:**
  - Task 7 needs Task 1: they share `types.ts`.
  - Task 8 needs Task 4: its tests drive the fake through the kit.
  - They touch disjoint files.
- **Group check A** (controller) runs after Waves 1 and 2. It includes the G3 measurement, which decides Task 15.
- **Task 15** (conditional) runs after group check A, beside any later wave: its files are disjoint from every other task's.
- **Wave 3:** Task 9, which needs Task 7 (`types.ts`, `providerStore.ts`).
- **Wave 4:** Task 10, which needs Tasks 8 and 9: `fake/provider.test.ts`, `types.ts`, `providerStore.ts`, `run.ts`.
- **Wave 5:** Task 11, which needs Task 10 (`session/types.ts`, `run.ts`) and Task 1 (`registry.ts`).
- **Wave 6:** Task 12, which needs Tasks 11 and 2 (`SpinePreview.tsx`).
- **Wave 7:** Task 13, which needs Task 11 (its session test uses the leased fake), Task 10 (`ProviderPicker.tsx`, `providerStore.ts`) and Task 12.
  - Its behaviour change — an own-key provider checked on load — reaches `SpinePreview.test.tsx`, which Task 12 edits.
  - Running it after Task 12, alone, keeps one owner per file and lets the implementer tell its effect from Task 12's.
- **Wave 8:** Task 14, which needs Task 13 (`ProviderPicker.tsx`) and Task 11 (the registry's fakes).
- **Group check B** (controller) runs after Task 14, and after Task 15 when it ran.
- **Task 16** (controller) runs last.

---

### Task 1: Presence — the Kizuna umbrella for managed providers, a tester switch for flagged ones (F6)

**Files:**
- Modify: `src/lib/provider/types.ts` (the identity block, after `guideUrl`), `src/lib/provider/presence.ts`, `src/lib/provider/presence.test.ts`, `src/providers/registry.ts` (`currentPresenceEnv`), `src/providers/registry.test.ts`, `src/utils/environment.ts` (beside `LOCAL_NATIVE_DEBUG_KEY`), `src/utils/environment.test.ts`.

**Interfaces:**
- **Produces:**
  - `Provider.testerSwitch?: string`;
  - `PresenceEnv` gains `kizuna: boolean` and `switchOn(key: string): boolean`;
  - `isPresent(p: Pick<Provider<unknown, never, never>, 'id' | 'kind' | 'platforms' | 'flagged' | 'testerSwitch'>, env: PresenceEnv): boolean`;
  - `debugSwitchOn(key: string): boolean` in `src/utils/environment.ts`.
- **Consumed by:**
  - the registry's `currentPresenceEnv()`;
  - Local Native's plan, which sets `flagged: true, testerSwitch: LOCAL_NATIVE_DEBUG_KEY`;
  - Kizuna Soniox's plan (`kind: 'managed'`);
  - Task 11 (the leased fake is managed);
  - Task 14's invariants.

- [ ] **Step 1: Write the failing tests.**
  - `presence.test.ts`. The helper becomes `const release = (platform: PresenceEnv['platform'], enabled: string[] = [], more: Partial<PresenceEnv> = {}): PresenceEnv => ({ platform, dev: false, enabled: new Set(enabled), kizuna: true, switchOn: () => false, ...more });`. The stubs gain `kind: 'own-key' as const`, and the two literal envs gain `kizuna: true, switchOn: () => false`. New cases:
    1. **"offers a managed provider only where the Kizuna umbrella is on, in a development build too"** — `managed = { id: 'm', kind: 'managed' as const, platforms: ['electron', 'extension', 'web'] as const }`:
       - `isPresent(managed, release('electron', [], { kizuna: false }))` → `false`;
       - `isPresent(managed, release('electron'))` → `true`;
       - `isPresent(managed, { platform: 'electron', dev: true, enabled: new Set(), kizuna: false, switchOn: () => false })` → `false`.
    2. **"lets a tester switch offer a flagged provider in a release build, on its platforms only"** — `tested = { ...gated, testerSwitch: 'debug:tested' }`:
       - `isPresent(tested, release('electron', [], { switchOn: (k) => k === 'debug:tested' }))` → `true`;
       - the same with `switchOn: () => false` → `false`;
       - `isPresent(tested, release('web', [], { switchOn: () => true }))` → `false`.
    3. **"asks the switch only for a flagged provider nothing else offers"** — `const switchOn = vi.fn(() => true)`:
       - `isPresent(plain, release('electron', [], { switchOn }))` → `true`, and `switchOn` is not called;
       - `isPresent(tested, release('electron', ['gated'], { switchOn }))` → `true`, and `switchOn` is still not called.
  - `registry.test.ts`:
    - The existing call `presentProviders({ platform, dev: true, enabled: new Set() })` gains `kizuna: true, switchOn: () => false`.
    - The file imports `isPresent` (`../lib/provider/presence`), `type AnyProvider` (`../lib/provider/types`), `currentPresenceEnv` (`./registry`) and `isKizunaAIEnabled` (`../utils/environment`).
    - New cases:
      4. **"a release build offers no flagged provider and, without the umbrella, no managed one (D24 release check, F6)"**:
         - for each platform of `['electron', 'extension', 'web']`, every `p` of `presentProviders({ platform, dev: false, enabled: new Set(), kizuna: false, switchOn: () => false })` has `p.flagged !== true` and `p.kind !== 'managed'`;
         - the control, so the case bites before any flagged or managed provider is registered: over `[fakeProvider, { ...fakeProvider, id: 'm', kind: 'managed' as const }, { ...fakeProvider, id: 'f', flagged: true as const }]`, the ids `isPresent` keeps with that env on `'electron'` are exactly `['fake']`.

         From Task 11 on, the leased fake (managed) makes the first half non-vacuous too.
      5. **"a tester switch sits only on a flagged provider"** — with `const switchOffenders = (ps: readonly Pick<AnyProvider, 'id' | 'flagged' | 'testerSwitch'>[]) => ps.filter((p) => p.testerSwitch !== undefined && p.flagged !== true).map((p) => p.id)`:
         - `switchOffenders(PROVIDERS)` is `[]`;
         - the control: `switchOffenders([{ id: 'x', testerSwitch: 'debug:x' }, { id: 'y', flagged: true, testerSwitch: 'debug:y' }])` is `['x']`.

         No registered provider has a switch until Local Native's plan; the control is what proves the check.
      6. **"the app's presence reads the umbrella and this device's switches"** — `const env = currentPresenceEnv()`:
         - `env.kizuna === isKizunaAIEnabled()`;
         - `localStorage.setItem('debug:probe-switch', '1')` → `env.switchOn('debug:probe-switch')` is `true`, and `env.switchOn('debug:other')` is `false`;
         - `localStorage.removeItem('debug:probe-switch')`.
  - `environment.test.ts`, a new `describe("debugSwitchOn")`:
    7. `'1'` → `true`; `'true'` → `false`; absent → `false`.
    8. **"is false where storage throws"** — `vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); })` → `false`; restore the spy.

    The existing `isLocalNativeEnabled` cases stay as they are: they pin that the refactor below changes nothing.
- [ ] **Step 2: Run** `npx vitest run src/lib/provider/presence.test.ts src/providers/registry.test.ts src/utils/environment.test.ts`.
  - Cases 1, 2, 4 (its control), 6, 7 and 8 fail: `isPresent` ignores `kind` and `testerSwitch`, the env lacks `kizuna`, and `debugSwitchOn` does not exist.
  - Cases 3 and 5 pass at run time before the implementation. They are characterization cases: case 3 pins that the switch is asked last, and case 5 pins a rule for a future provider. Before the implementation they fail only the typecheck (`kind`, `testerSwitch` and the env's members are unknown).
- [ ] **Step 3: Implement.**
  - `types.ts`, after `guideUrl`:

    ```ts
      /**
       * A tester's run-time way in for a flagged provider in a release build:
       * a `localStorage` key that, set to `'1'`, offers it here — Local
       * Native's `debug:local-native` until it ships (F6). Only on a flagged
       * provider (registry invariant).
       */
      testerSwitch?: string;
    ```

  - `presence.ts`, in full:

    ```ts
    import type { Platform, Provider } from './types';

    export interface PresenceEnv {
      platform: Platform;
      /** A development build, which offers every flagged provider. */
      dev: boolean;
      /** `VITE_ENABLED_PROVIDERS`. */
      enabled: ReadonlySet<string>;
      /** The Kizuna umbrella flag (`isKizunaAIEnabled`): a managed provider is offered only where it is on (D19). */
      kizuna: boolean;
      /** Whether a tester switch (`Provider.testerSwitch`) is set on this device. */
      switchOn(key: string): boolean;
    }

    /**
     * Whether a provider is offered here (D19, F6): only on its platforms; a
     * managed provider only where the Kizuna umbrella is on; and a flagged one
     * only in a development build, when the release lists its id, or when its
     * tester switch is set.
     */
    export function isPresent(
      p: Pick<Provider<unknown, never, never>, 'id' | 'kind' | 'platforms' | 'flagged' | 'testerSwitch'>,
      env: PresenceEnv,
    ): boolean {
      if (!p.platforms.includes(env.platform)) return false;
      if (p.kind === 'managed' && !env.kizuna) return false;
      if (!p.flagged || env.dev || env.enabled.has(p.id)) return true;
      return p.testerSwitch !== undefined && env.switchOn(p.testerSwitch);
    }
    ```

  - `environment.ts`. Add this beside `LOCAL_NATIVE_DEBUG_KEY`, and make `hasLocalNativeDebugSwitch()` return `debugSwitchOn(LOCAL_NATIVE_DEBUG_KEY)` (the same behaviour, one reader):

    ```ts
    /** Whether a tester switch — a `localStorage` key set to `'1'` — is on (F6). False where storage is unavailable. */
    export function debugSwitchOn(key: string): boolean {
      try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
      } catch {
        return false; // localStorage unavailable in restricted contexts
      }
    }
    ```

  - `registry.ts`: import `debugSwitchOn` and `isKizunaAIEnabled` too, and:

    ```ts
    export function currentPresenceEnv(): PresenceEnv {
      return { platform: getEnvironment(), dev: isDevelopmentMode(), enabled: enabledProviderIds(), kizuna: isKizunaAIEnabled(), switchOn: debugSwitchOn };
    }
    ```

- [ ] **Step 4: Run** `npx vitest run src/lib/provider src/providers src/utils/environment.test.ts`, then the full suite and the typecheck gate.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/lib/provider/types.ts src/lib/provider/presence.ts src/lib/provider/presence.test.ts src/providers/registry.ts src/providers/registry.test.ts src/utils/environment.ts src/utils/environment.test.ts
  ```

  ```bash
  git commit -q -F - -- src/lib/provider/types.ts src/lib/provider/presence.ts src/lib/provider/presence.test.ts src/providers/registry.ts src/providers/registry.test.ts src/utils/environment.ts src/utils/environment.test.ts <<'EOF'
  feat(provider): a managed provider needs the Kizuna umbrella; a tester switch unlocks a flagged one

  Presence reads the umbrella flag for kind 'managed' (D19: the umbrella
  stays) and a flagged provider's testerSwitch key, so Local Native's
  debug:local-native can move onto the registry (Stage 2 foundation, F6).

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

### Task 2: The live pre-start gate (F7)

**Files:**
- Modify: `src/lib/session/shape.ts` (+ `shape.test.ts`), `src/lib/session/appShape.ts` (+ `appShape.test.ts`), `src/lib/subtitle/session.ts` (+ `session.test.ts`), `src/lib/subtitle/appSession.ts` (+ `appSession.test.ts`), `src/components/dev/SpinePreview.tsx` (+ `SpinePreview.test.tsx`).
- Create: `scripts/dev/spine-gate-probe.mjs`.

**Interfaces:**
- **Produces:**
  - `type GateInput = Pick<RunShape, 'provider' | 'settings' | 'pair' | 'legs' | 'turnMode'>`, and `gate(shape: GateInput, platform: Platform): Refusal | null` (the same body);
  - `liveGate(platform?: Platform): Refusal | null` in `appShape.ts`;
  - `SubtitleSessionInput.refusal?: Refusal | null`;
  - `idleOf(run, readiness, microphoneMissing = false, refusal: Refusal | null = null)`.
- **Consumed by:**
  - `appSubtitleSession`, and through it `canStart` (`AppSession.start` checks it), MainPanel's `startBlockMessage` and the takeover's idle body — all read `subtitle.idle`;
  - Kizuna Soniox's plan, which adds the balance floor beside it (F11).

- [ ] **Step 1: Write the failing tests.**
  - `shape.test.ts`, in `describe('gate')`:
    1. **"gates the narrower input the stores give as well as a run's shape"** — `gate({ provider: fakeProvider, settings: FAKE_DEFAULTS, pair: { source: 'en', target: 'ja' }, legs: ['participant'], turnMode: 'auto' }, 'web')` → `{ code: 'participant_source_unavailable', leg: 'participant' }` (`toMatchObject`). The case compiles only once `gate` takes a `GateInput`.
  - `appShape.test.ts`, a new `describe('liveGate')`. The file already mocks `getEnvironment` through `environment.value`.
    2. **"is null until the chosen provider has loaded"** → `liveGate()` is `null`.
    3. **"refuses the participant leg on the web, and lets it through on Electron"**:
       - `useProviderStore.setState({ selected: 'fake', entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } } })` and `useAudioStore.setState({ mode: 'participant' })`;
       - with `environment.value = 'web'` → `liveGate()?.code` is `'participant_source_unavailable'`;
       - with `environment.value = 'electron'` → `null`.
    4. **"refuses a pair that does not reverse, for the participant leg (D20)"** — the same with `pair: { source: 'auto', target: 'en' }`, mode `'both'` and `'electron'` → `'participant_unsupported'`.
    5. **"reads the speaker-only mode as nothing to refuse"** — mode `'speaker'` on `'web'` → `null`.
  - `subtitle/session.test.ts`, `describe('subtitleSession')`. `refusal = { code: 'participant_unsupported', message: 'fake does not translate ja into auto.', leg: 'participant' as const }`:
    6. **"keeps Start off with the gate's refusal, worded by its code"** — `subtitleSession({ run: { phase: 'idle' }, readiness: { state: 'ready', models: [] }, pair: null, turnMode: 'auto', legs: ['speaker', 'participant'], refusal })` → `canStart === false` and `idle` equals `{ kind: 'unready', message: refusal.message, code: 'participant_unsupported' }`.
    7. **"puts the refusal after the microphone and before the provider's readiness"**:
       - with `microphoneMissing: true` → `idle.code === 'no_microphone'`;
       - with `readiness: { state: 'not-ready', reason: 'no key', code: 'credentials_missing' }` and the refusal → `idle.code === 'participant_unsupported'`.
    8. **"a start under way outranks it"** — `run: { phase: 'starting', step: 'checking' }` → `idle.kind === 'starting'`.
  - `appSession.test.ts`:
    - Add `const environment = vi.hoisted(() => ({ value: 'electron' as 'web' | 'electron' | 'extension' }))` and `vi.mock('../../utils/environment', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../utils/environment')>()), getEnvironment: () => environment.value }))`, with `environment.value = 'electron'` in the file's `afterEach`. The existing case "never gates a start with no options, or a mode without the speaker leg" runs a participant-only start, which jsdom's `'web'` would now refuse: the file runs as Electron.
    - New case:
      9. **"keeps Start off while the live gate refuses, and turns it back on when the mode changes"**:
         - `environment.value = 'web'`; `useAudioStore.setState({ mode: 'participant', selectedInputDevice: null })`; `const { session } = setup()`;
         - `session.get()` matches `{ canStart: false, idle: { kind: 'unready', code: 'participant_source_unavailable' } }`;
         - subscribe a listener; `useAudioStore.setState({ mode: 'speaker' })` → the listener is called once and `canStart` is `true`.
  - `SpinePreview.test.tsx`, in the stored-settings case (the one that sets `&script=cjk&autosave=1&turn=push-to-talk&monitor=1`):
    10. Add `&mode=both` to its URL. In the `waitFor`, `useAudioStore.getState().mode` is `'both'`. Restore the previous mode in its `finally`.
- [ ] **Step 2: Run** `npx vitest run src/lib/session/shape.test.ts src/lib/session/appShape.test.ts src/lib/subtitle src/components/dev/SpinePreview.test.tsx`.
  - Cases 2–7, 9 and 10 fail: `liveGate`, `refusal` and `&mode=` are not there.
  - Case 1 fails only at compile time: vitest does not typecheck, so it passes at run time today. The typecheck gate shows it failing until `GateInput` exists.
  - Case 8 passes before the implementation: it is a characterization case. The refusal input is ignored today, and a start under way already wins; it pins that the new branch comes after `starting`.
- [ ] **Step 3: Implement.**
  - `shape.ts`:

    ```ts
    /** What the start gate reads (F7): a run's frozen shape satisfies it, and so do the stores as they stand. */
    export type GateInput = Pick<RunShape, 'provider' | 'settings' | 'pair' | 'legs' | 'turnMode'>;

    /**
     * The start gate: what can be refused before anything is checked, built
     * or opened — over a run's frozen shape at start (`Run.open`), and over the
     * stores as they stand while idle (`liveGate`, F7), so the surfaces keep
     * Start off and say why before it is pressed. Credentials, readiness, the
     * build and `admit` are refused by the run's later steps.
     */
    export function gate(shape: GateInput, platform: Platform): Refusal | null {
      // (body unchanged)
    }
    ```

  - `appShape.ts`. Import `type ProviderEntry` from the provider store, `type Platform` from `../provider/types`, and `gate` and `type Refusal` from `./shape`.
    - Factor the selection out of `readShapeFromStores`:

      ```ts
      /** The provider a start would run and its loaded entry, as `readShapeFromStores` finds them; null until the entry has loaded. */
      function selectedFromStores(): { provider: AnyProvider; entry: ProviderEntry } | null {
        const { selected, entries } = useProviderStore.getState();
        const providers = presentProviders();
        const provider = providers.find((p) => p.id === selected) ?? providers[0];
        const entry = provider ? entries[provider.id] : undefined;
        return provider && entry ? { provider, entry } : null;
      }
      ```

    - `readShapeFromStores` starts `const selected = selectedFromStores(); if (!selected) return null; const { provider, entry } = selected;`; the rest is unchanged.
    - Add:

      ```ts
      /**
       * The start gate over the stores as they stand (F7): what a start would be
       * refused before anything is checked — no leg, a turn mode the provider
       * does not offer, the participant leg on the web or for a pair that does
       * not reverse (D20). The surfaces keep Start off and show why; the runner
       * still gates the frozen shape at start. Null when nothing is refused, or
       * before the provider's entry has loaded (`providerLoaded` keeps Start
       * off then).
       */
      export function liveGate(platform: Platform = getEnvironment()): Refusal | null {
        const selected = selectedFromStores();
        if (!selected) return null;
        return gate({
          provider: selected.provider,
          settings: selected.entry.settings,
          pair: selected.entry.pair,
          legs: legsFor(useAudioStore.getState().mode),
          turnMode: useTurnModeStore.getState().turnMode,
        }, platform);
      }
      ```

  - `subtitle/session.ts`:
    - Import `type Refusal` beside `NO_MICROPHONE` from `../session/shape`. `SubtitleSessionInput` gains `/** What the start gate refuses over the stores as they stand (F7), or null. */ refusal?: Refusal | null;`.
    - `idleOf` gains `refusal: Refusal | null = null`. Its doc's order becomes "a start under way; no microphone chosen; the start gate's refusal (F7); a provider that is not ready; …". After the microphone line:

      ```ts
        // The start gate's refusal (F7): this shape cannot start — after the
        // device, where today's computeStartGate put its participant blocker,
        // and before the provider's readiness.
        if (refusal) return { kind: 'unready', message: refusal.message, code: refusal.code, ...(refusal.params ? { params: refusal.params } : {}) };
      ```

    - `subtitleSession` destructures `refusal = null`, adds `&& !refusal` to `canStart`, and calls `idleOf(run, readiness, microphoneMissing, refusal)`.
    - `sameIdle` already compares an `unready`'s message, code and params: nothing to add there.
  - `appSession.ts`:
    - `import { legsFor, liveGate } from '../session/appShape';`, and `refusal: liveGate(),` in `read()`. Every store the gate reads — providers, turn mode, audio — is already subscribed.
    - The header gains "and the start gate over them (F7)".
  - `SpinePreview.tsx`:
    - In the URL-applied effect, after `&turn=`:

      ```ts
          // `&mode=speaker|participant|both`: the stored audio mode, for the live gate's check (F7) — like `&turn=`, it outlives the page.
          const mode = params.get('mode');
          if (mode === 'speaker' || mode === 'participant' || mode === 'both') useAudioStore.getState().setMode(mode);
      ```

    - The component's doc gains `&mode=` in its list of stored-settings parameters.
  - `scripts/dev/spine-gate-probe.mjs` (new):

    ```js
    #!/usr/bin/env node
    /**
     * A start the gate refuses, on the preview's panel, before Start is pressed
     * (Stage 2 foundation, F7): the basic footer's main action is disabled and
     * its title is the refusal in the notice's own words. By default the web
     * page — which has no participant source — with the audio mode at both.
     * Group check B also runs it on the leased fake while signed out.
     *
     *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort --force   # another shell
     *   node scripts/dev/spine-gate-probe.mjs [url] [words]
     *
     * Exits 1 unless, within 10 s, the button is disabled and its title is `words`.
     */
    import { evaluate, sleep, withPage } from './headless.mjs';

    const url = process.argv[2] ?? 'http://localhost:5199/?preview=spine&panel=1&mode=both';
    // `notices.participant_source_unavailable` in `src/locales/en/translation.json`.
    const words = process.argv[3] ?? "Translating other participants isn't available here.";
    const READ = `(() => { const b = document.querySelector('.spine-panel [data-tour="main-action"]'); return b ? { disabled: b.disabled, title: b.title } : null; })()`;

    process.exitCode = await withPage(url, async (send) => {
      let seen = null;
      for (let i = 0; i < 50; i++) {
        seen = await evaluate(send, READ);
        if (seen && seen.disabled && seen.title === words) break;
        await sleep(200);
      }
      console.log(`main action: ${JSON.stringify(seen)}`);
      return seen && seen.disabled && seen.title === words ? 0 : 1;
    });
    ```

- [ ] **Step 4: Run** `npx vitest run src/lib/session src/lib/subtitle src/app src/components/MainPanel src/components/Subtitle src/components/dev`, then the full suite and the gate.
  - **The tests outside this task that the refusal can reach**, each checked at `507a539a`: every test that sets the audio mode to `participant` or `both` and reads the app's subtitle session or starts a run. Each stays green:
    - `src/components/MainPanel/MainPanel.test.tsx`: the advanced-footer case renders `mode: 'both'` on jsdom's `'web'`, so its Start is now refused before it is pressed. The case asserts the strips, not the button, and the file's `beforeEach` puts the mode back to `'speaker'` (`:222`).
    - `src/app/session.test.ts`: the `mode: 'both'` case asserts the store's legs only, and `beforeEach` resets the mode (`:118`).
    - `src/lib/session/appShape.test.ts` (`:61`, `:155`): `readShapeFromStores` is unchanged.
    - `src/components/Settings/sections/SpeechSection.test.tsx` (`:293`): participant mode for `OutputToggles`; it reads no start gate.
  - If any other test fails on the new refusal, stop and report it with its output (Global Constraints). Do not edit it, and never weaken the gate.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/lib/session/shape.ts src/lib/session/shape.test.ts src/lib/session/appShape.ts src/lib/session/appShape.test.ts src/lib/subtitle/session.ts src/lib/subtitle/session.test.ts src/lib/subtitle/appSession.ts src/lib/subtitle/appSession.test.ts src/components/dev/SpinePreview.tsx src/components/dev/SpinePreview.test.tsx scripts/dev/spine-gate-probe.mjs
  ```

  ```bash
  git commit -q -F - -- src/lib/session/shape.ts src/lib/session/shape.test.ts src/lib/session/appShape.ts src/lib/session/appShape.test.ts src/lib/subtitle/session.ts src/lib/subtitle/session.test.ts src/lib/subtitle/appSession.ts src/lib/subtitle/appSession.test.ts src/components/dev/SpinePreview.tsx src/components/dev/SpinePreview.test.tsx scripts/dev/spine-gate-probe.mjs <<'EOF'
  feat(session): the start gate runs live, so Start says why before it is pressed

  liveGate() runs the runner's gate() over the stores; the subtitle session
  puts its refusal after the microphone and before readiness, and keeps
  Start off (Stage 2 foundation, F7). The preview takes &mode=, and
  spine-gate-probe checks the refusal's words on the panel.

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

**Probes:** `spine-gate-probe.mjs` (group check A).

---

### Task 3: Notice aliases onto existing translated keys; `sign_in_required` (F8)

**Files:** Modify `src/lib/view/noticeText.ts`, `src/lib/view/noticeText.test.ts`.

**Interfaces:**
- **Produces:** `NOTICE_ALIASES: Readonly<Record<string, string>>` — code → existing i18n key. `noticeText` words an alias code with its key's sentence; `defaultValue` is the notice's diagnostic message.
- **Consumed by:**
  - `CredentialForm` and the idle surfaces (through `noticeText`) for `sign_in_required` — Task 7's code, the leased fake's `read` (Task 11) and Kizuna Soniox's `read`;
  - Kizuna Soniox's lease codes, and Palabra's, OpenAI Live's and Soniox's connection-lost codes.

- [ ] **Step 1: Write the failing tests** in `noticeText.test.ts`.
  1. **"words an alias code with the sentence its key already has, the diagnostic message as the fallback"** — `noticeText(t, { code: 'sign_in_required', message: 'Signed out.' })` → `'auth.signedOut|Signed out.'` (the file's stand-in `t` prints `key|defaultValue`).
  2. **"no code is both an alias and worded under notices"** — `Object.keys(NOTICE_ALIASES).filter((code) => code in NOTICE_WORDS)` is `[]`.
  3. **"every alias names a sentence in all 30 locales"** — over the file's `catalogs` glob, every `[code, key]` of `NOTICE_ALIASES` has `at(catalog, key)` a non-empty string, messaged `${path}: ${code}`.
  4. **"a signed-out managed provider reads the sign-in sentence, word for word in en"** — `at(en, NOTICE_ALIASES.sign_in_required)` is `"Sign in to use Kizuna AI's built-in translation service."`.

  The case "matches the English locale word for word" stays unchanged: `NOTICE_WORDS` does not change, and no `notices.*` key is added.
- [ ] **Step 2: Run** `npx vitest run src/lib/view/noticeText.test.ts`. Cases 1–4 fail: there is no `NOTICE_ALIASES`.
- [ ] **Step 3: Implement** in `noticeText.ts`:

  ```ts
  /**
   * Codes worded by a sentence every locale already has (controller ruling
   * 4): the notice reuses that key rather than a `notices.<code>` of its own,
   * so no catalog changes. A code is here or in `NOTICE_WORDS`, never both. A
   * plan whose provider emits a new code with an existing sentence adds its
   * row; a sentence that names a vendor stays that vendor's (choice 9).
   */
  export const NOTICE_ALIASES: Readonly<Record<string, string>> = {
    // A managed provider signed out: its `credentials.read` answers with this code (F3).
    sign_in_required: 'auth.signedOut',
    // A managed lease refused a start, or ended the run.
    insufficient_balance: 'mainPanel.sonioxInsufficientBalance',
    wallet_frozen: 'mainPanel.walletFrozen',
    session_conflict: 'mainPanel.sonioxSessionConflict',
    budget_exhausted: 'mainPanel.sonioxBudgetExhausted',
    // A provider ended the session under the user, and a new Start continues it.
    segment_ended: 'mainPanel.sonioxSegmentEnded',
    connection_lost: 'mainPanel.sonioxConnectionLost',
  };
  ```

  In `noticeText`, first:

  ```ts
    const alias = notice.code === undefined ? undefined : NOTICE_ALIASES[notice.code];
    // A catalog lacking the key shows the diagnostic English, as a code with no words does.
    if (alias !== undefined) return t(alias, { defaultValue: notice.message, ...named(notice.params), detail: notice.message });
  ```

  The file's header gains a line: "or, for a code in `NOTICE_ALIASES`, under the existing key it names".
- [ ] **Step 4: Run** `npx vitest run src/lib/view src/components/providers src/components/MainPanel`, then the full suite and the gate.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/lib/view/noticeText.ts src/lib/view/noticeText.test.ts
  ```

  ```bash
  git commit -q -F - -- src/lib/view/noticeText.ts src/lib/view/noticeText.test.ts <<'EOF'
  feat(view): provider notice codes reuse sentences every locale already has

  NOTICE_ALIASES maps a code onto an existing translated key:
  sign_in_required onto auth.signedOut, and the lease's and a lost
  connection's neutral sentences. No locale key is added (Stage 2
  foundation, F8; controller ruling 4).

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

### Task 4: The adapter test kit — `FakeSocket`, the scenario driver, the clock convention (F9)

**Files:**
- Create: `src/lib/contract/testing/fakeSocket.ts` (+ `fakeSocket.test.ts`), `src/lib/contract/testing/drive.ts` (+ `drive.test.ts`), `src/lib/contract/testing/scenarios.ts` (+ `scenarios.test.ts`), `src/lib/contract/testing/examples.ts` (the two example adapters the kit's tests drive; no test of its own — `scenarios.test.ts` is its test).
- Modify: `src/lib/contract/clock.ts` (+ `clock.test.ts`).

**Interfaces:**
- **Produces:**
  - `every(clock: Pick<Clock, 'setTimeout'>, ms: number, fn: () => void): () => void` (`clock.ts`).
  - `FakeSocket` (a `WebSocket` double: `open(protocol?)`, `receive(data)`, `serverClose(code?, reason?)`, `drop()`, `sent`, `sentJson()`, `closedByClient`) and `fakeSockets(): FakeSockets` (`{ create(url, protocols?) => WebSocket; all; last() }`).
  - `ScenarioStep`, `DriveOptions<C, K>`, `DriveResult`, `driveAdapter(adapter, options): Promise<DriveResult>`, `flush()` and `voicedPcm(ms)` (`drive.ts`).
  - `ScenarioName`, `AdapterHarness<C, K>`, `ScenarioReport`, `scenarioNames(harness)` and `runScenario(harness, name): Promise<ScenarioReport>` (`scenarios.ts`).
  - `EchoConfig`, `createEchoAdapter(): Adapter<EchoConfig, { key: string }>` and `createBrokenAdapter(): Adapter<Record<string, never>, Record<string, never>>` (`examples.ts`).
- **Consumed by:**
  - Task 8 (the fake's scripts through `driveAdapter`);
  - Task 5 (the rule that only tests and test-only helpers import the kit);
  - every Stage 2 adapter's test — `runScenario` over its harness, `FakeSocket` for its transport, and `createEchoAdapter` as the shape to start from.

- [ ] **Step 1: Write the failing tests.**
  - `clock.test.ts`, a new `describe('every')`:
    1. **"ticks every ms on the clock"** — `const clock = createVirtualClock(0)`; `every(clock, 100, fn)`; `clock.advance(350)` → `fn` called 3 times.
    2. **"stops when cancelled, from outside or from inside a tick"**:
       - `const cancel = every(clock, 100, fn)`; `clock.advance(100)`; `cancel()`; `clock.advance(1000)` → one call;
       - a second interval whose `fn` cancels itself on its first call → one call after `clock.advance(1000)`.
    3. **"refuses an interval that is not positive"** — `every(clock, 0, fn)` and `every(clock, -1, fn)` throw a `RangeError`.
    4. **"a long advance runs every tick inside it"** — `every(clock, 100, fn)`; `clock.advance(1000)` → `fn` called 10 times. Each tick arms the next inside the same advance, and the virtual clock fires a timer a callback scheduled when it falls due within the advance.
  - `fakeSocket.test.ts`:
    5. **"is connecting until the test opens it, and a send then throws as a browser's does"** — `const s = new FakeSocket('wss://x', undefined)`; `s.readyState === FakeSocket.CONNECTING`; `expect(() => s.send('a')).toThrow(DOMException)`.
    6. **"opens with the chosen subprotocol, and calls the handler and every listener"** — `s.onopen = onopen; s.addEventListener('open', listener); s.open('chat')` → each called once; `s.protocol === 'chat'`; `s.readyState === FakeSocket.OPEN`.
    7. **"hands the adapter the server's frames, and keeps what it sent"**:
       - `s.onmessage = onmessage; s.open(); s.receive('{"a":1}')` → `onmessage.mock.calls[0][0].data === '{"a":1}'`;
       - `s.send('{"b":2}'); s.send(new ArrayBuffer(4))` → `s.sent.length === 2` and `s.sentJson()` equals `[{ b: 2 }]`.
    8. **"closes once, on a microtask, with the adapter's code; a send while closing is dropped"**:
       - `s.onclose = onclose; s.open(); s.close(1000, 'bye')` → `onclose` not called yet; `s.readyState === FakeSocket.CLOSING`;
       - `s.send('late')` → `s.sent` unchanged;
       - `await Promise.resolve()` → `onclose` once, its event matching `{ code: 1000, reason: 'bye', wasClean: true }`; `s.closedByClient` equals `{ code: 1000, reason: 'bye' }`;
       - `s.close()` again, and another microtask → still once.
    9. **"a server close is clean only at 1000; a drop is an error, then an unclean 1006"**:
       - `serverClose(1011, 'err')` → `close` with `{ code: 1011, wasClean: false }`;
       - on another open socket, `drop()` → `onerror` once, then (a microtask) `close` with `{ code: 1006, wasClean: false }`.
    10. **"refuses to open twice, and to receive on a closed socket"** — `s.open()` then `expect(() => s.open()).toThrow()`; `s.serverClose()`, a microtask, then `expect(() => s.receive('x')).toThrow()`.
    11. **"the factory hands out WebSockets and keeps every one"**:
        - `const f = fakeSockets(); const ws = f.create('wss://a', ['p'])` → `f.last().url === 'wss://a'`, `f.last().protocols` equals `['p']`, `ws === (f.last() as unknown)`;
        - `f.create('wss://b')` → `f.all.map((s) => s.url)` equals `['wss://a', 'wss://b']`;
        - `expect(() => fakeSockets().last()).toThrow('no socket')`.
  - `drive.test.ts` — the fake adapter (`createFakeAdapter`, `exchange`) is the driven adapter, and `createBrokenAdapter` comes from `./examples`. `auto = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' }`, and `script = { blocks: [exchange({ startAt: 500, ref: 1, source: ['Hello', 'Hello there.'], translation: 'こんにちは。', origin: 'x1', audioChunks: 2 })] }`:
    12. **"starts on a virtual clock, plays the steps, stops the session and checks the log"** — `driveAdapter(createFakeAdapter(), { context: auto, config: { script }, credentials: {}, steps: [{ advance: 5000 }] })`:
        - `violations` is `[]` and `startError` is `undefined`;
        - the log holds a `segmentOpened`;
        - its last entry is the marker `{ kind: 'marker', payload: 'stop' }`.
    13. **"marks what the caller did, for the rules that read it"** — `context: { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'manual' }`, `config: { script }`, and steps `[{ text: 'hi' }, { turn: 'begin' }, { turn: 'end' }, { turn: 'cancel' }]` → the log's markers, in order, are `appendText` (with `text: 'hi'`), `endTurn`, `cancelTurn`, `stop`. A `begin` marks nothing: no rule reads it.
    14. **"runs the clock on past the end, so an emission after stop is a violation"** — `driveAdapter(createBrokenAdapter(), { context: auto, config: {}, credentials: {} })`: its `stop()` schedules a `segmentOpened` on `request.clock` 100 ms later. `violations.map((v) => v.rule)` contains `'stop-silence'`.
    15. **"reports a start that never settles instead of hanging"** — the adapter `{ start: () => new Promise<AdapterSession>(() => {}) }` → `session` is `null`, and `startError` is an Error whose message is `'start neither resolved nor rejected after the opening steps'`.
    16. **"skips the steps when start rejects, and returns why"** — the adapter `{ start: () => Promise.reject(new Error('nope')) }` and steps `[{ run: spy }]` → `spy` is never called, and `startError.message` is `'nope'`.
    17. **"hands a run step the session, the clock and the log"** — steps `[{ advance: 700 }, { run: spy }]` → `spy`'s handles have `session !== null`, `clock.now() === 700`, and `log === result.log`.
    18. **"an abort while opening reaches the adapter's signal"** — `config: { script, faults: { startDelayMs: 1000 } }`, `opening: [{ abort: true }, { flush: true }]` → `startError` is defined and `session` is `null`.
  - `scenarios.test.ts`. It imports the kit, `createEchoAdapter` and `createBrokenAdapter` (`./examples`), and the fake's `createFakeAdapter`, `exchange` and types. Three harnesses:
    - **The fake.** Its base script is one exchange on refs 1–2, and a scenario adds only refs from 3 on, so no ref is opened twice (conformance's `ref-opened-once`). Do not use `fakeScript('exchange')` as the base: its second block opens ref 3 itself.

      ```ts
      /** One exchange, on refs 1 (source) and 2 (translation). */
      const base = () => exchange({ startAt: 500, ref: 1, source: ['Hello', 'Hello there.'], translation: 'こんにちは。', origin: 'x1', audioChunks: 2 });

      const fakeHarness: AdapterHarness<FakeConfig, FakeCredentials> = {
        adapter: createFakeAdapter(),
        config: (_context, scenario) => {
          if (scenario === 'abort-while-opening') return { script: { blocks: [base()] }, faults: { startDelayMs: 1000 } };
          if (scenario === 'server-close') {
            return { script: { blocks: [base(), { startAt: 4000, steps: [{ at: 0, closed: { reason: 'the fake server went away' } }] }] } };
          }
          if (scenario === 'reconnect') {
            return {
              script: {
                blocks: [
                  base(),
                  { startAt: 3000, steps: [{ at: 0, reconnecting: true }, { at: 500, reconnected: true }] },
                  // Refs 3–4: never reused across the reconnect.
                  exchange({ startAt: 4000, ref: 3, source: ['Again.'], translation: 'もう一度。', origin: 'x2' }),
                ],
              },
            };
          }
          return { script: { blocks: [base()] } };
        },
        credentials: {},
        // The fake opens at once, and plays its whole script inside one advance.
        opening: () => [],
        exchange: [{ advance: 8000 }],
        serverClose: [],
        answerText: [],
        reconnect: [],
      };
      ```

    - **The echo adapter** over `fakeSockets()`. Its harness keeps the scenario's factory in a closure:

      ```ts
      let sockets = fakeSockets();
      const echoHarness: AdapterHarness<EchoConfig, { key: string }> = {
        adapter: createEchoAdapter(),
        config: () => {
          sockets = fakeSockets();
          return { openSocket: sockets.create };
        },
        credentials: { key: 'test-key' },
        opening: () => [{ run: () => sockets.last().open() }, { flush: true }],
        exchange: [{ run: () => sockets.last().receive(JSON.stringify({ source: 'Hello.', translation: 'こんにちは。' })) }],
        serverClose: [{ run: () => sockets.last().serverClose(1011, 'server error') }, { flush: true }],
        answerText: [],
      };
      ```

    - **The broken adapter:** `const brokenHarness: AdapterHarness<Record<string, never>, Record<string, never>> = { adapter: createBrokenAdapter(), config: () => ({}), credentials: {}, opening: () => [], exchange: [], serverClose: [] };`.

    Cases:
    19. **"the fake passes every scenario"** — for every name of `scenarioNames(fakeHarness)` (all eight): `runScenario` → `violations` and `problems` are both `[]`.
    20. **"a socket adapter passes every scenario it can run, over FakeSocket"** — the echo harness has no `reconnect`, so `scenarioNames` gives seven names. Each has empty `violations` and `problems`.
    21. **"a broken adapter is caught"**:
        - `'open-stop'` → `problems` contains `'the exchange steps produced no segment'`, and `violations` has a `stop-silence` rule;
        - `'server-close'` → `problems` contains `'the server ended the session and the adapter did not say so (failed or closed)'`;
        - `'abort-while-opening'` → `problems` contains `'start resolved although its signal aborted while it was opening'`. This rests on the broken adapter resolving `start` at once, whatever its signal says.
    22. **"asks a harness only for what it has"** — `scenarioNames({})` (neither `answerText` nor `reconnect`) omits `'text'` and `'reconnect'`; `runScenario(brokenHarness, 'text')` rejects with `'this harness takes no typed text'`.
- [ ] **Step 2: Run** `npx vitest run src/lib/contract`. The three kit test files fail to load, since no kit module exists yet. The four new clock cases fail, since `every` is not exported.
- [ ] **Step 3: Implement.**
  - `clock.ts`:

    ```ts
    /**
     * Runs `fn` every `ms` on `clock` until the returned cancel is called: the
     * interval every protocol module uses in place of the global one (F9), so
     * a virtual clock drives a keep-alive in tests. The next tick is armed
     * before `fn` runs, so on the real clock a tick that throws does not stop
     * the interval.
     */
    export function every(clock: Pick<Clock, 'setTimeout'>, ms: number, fn: () => void): () => void {
      // A virtual clock would spin forever on a zero interval.
      if (!(ms > 0)) throw new RangeError(`every() needs a positive interval, not ${ms}`);
      let stopped = false;
      let cancel: () => void = () => {};
      const tick = () => {
        if (stopped) return;
        cancel = clock.setTimeout(tick, ms);
        fn();
      };
      cancel = clock.setTimeout(tick, ms);
      return () => {
        stopped = true;
        cancel();
      };
    }
    ```

  - `fakeSocket.ts`:

    ```ts
    /**
     * A WebSocket an adapter test drives by hand (F9). The adapter opens it
     * through the factory it was handed in place of `new WebSocket`; the test
     * opens it, feeds it the server's frames, and reads what the adapter sent.
     * The browser's order holds: nothing before `open`; a close — the
     * adapter's, the server's or a dropped connection's — fires `close` once,
     * on a microtask as a browser queues it, and nothing after it. Test-only:
     * nothing but a test imports `src/lib/contract/testing`.
     */
    export type SocketData = string | ArrayBufferLike | Blob | ArrayBufferView;

    const STATES = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const;

    export class FakeSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSING = 2;
      readonly CLOSED = 3;
      readyState: number = FakeSocket.CONNECTING;
      binaryType: BinaryType = 'blob';
      bufferedAmount = 0;
      extensions = '';
      /** The subprotocol the server chose: `open(protocol)`'s. */
      protocol = '';
      onopen: ((this: FakeSocket, ev: Event) => unknown) | null = null;
      onmessage: ((this: FakeSocket, ev: MessageEvent) => unknown) | null = null;
      onerror: ((this: FakeSocket, ev: Event) => unknown) | null = null;
      onclose: ((this: FakeSocket, ev: CloseEvent) => unknown) | null = null;
      /** What the adapter sent while the socket was open, in order. */
      readonly sent: SocketData[] = [];
      /** The adapter's own `close()`, when it called it, with the code and reason it gave. */
      closedByClient: { code?: number; reason?: string } | null = null;

      constructor(readonly url: string, readonly protocols: string | string[] | undefined) {
        super();
      }

      send(data: SocketData): void {
        if (this.readyState === FakeSocket.CONNECTING) {
          throw new DOMException("Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.", 'InvalidStateError');
        }
        // Closing or closed: a browser drops it silently.
        if (this.readyState !== FakeSocket.OPEN) return;
        this.sent.push(data);
      }

      close(code?: number, reason?: string): void {
        if (this.readyState >= FakeSocket.CLOSING) return;
        this.closedByClient = { code, reason };
        this.closing(code ?? 1005, reason ?? '', true);
      }

      /** The server accepts the upgrade: `open`, with the subprotocol it chose. */
      open(protocol = ''): void {
        if (this.readyState !== FakeSocket.CONNECTING) throw new Error(`open() on a socket that is ${STATES[this.readyState]}`);
        this.readyState = FakeSocket.OPEN;
        this.protocol = protocol;
        this.fire(new Event('open'));
      }

      /** A frame from the server. */
      receive(data: string | ArrayBuffer): void {
        if (this.readyState !== FakeSocket.OPEN) throw new Error(`receive() on a socket that is ${STATES[this.readyState]}`);
        this.fire(new MessageEvent('message', { data }));
      }

      /** The server closes the connection: clean at 1000, unclean at any other code. */
      serverClose(code = 1000, reason = ''): void {
        if (this.readyState >= FakeSocket.CLOSING) return;
        this.closing(code, reason, code === 1000);
      }

      /** The connection drops: `error`, then an unclean `close` 1006. */
      drop(): void {
        if (this.readyState >= FakeSocket.CLOSING) return;
        this.fire(new Event('error'));
        this.closing(1006, '', false);
      }

      /** Every text frame sent, parsed as JSON; binary frames are skipped. */
      sentJson<T = unknown>(): T[] {
        return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d) as T);
      }

      private closing(code: number, reason: string, wasClean: boolean): void {
        this.readyState = FakeSocket.CLOSING;
        queueMicrotask(() => {
          this.readyState = FakeSocket.CLOSED;
          this.fire(new CloseEvent('close', { code, reason, wasClean }));
        });
      }

      private fire(event: Event): void {
        const handler = (this as unknown as Record<string, unknown>)[`on${event.type}`];
        if (typeof handler === 'function') (handler as (ev: Event) => unknown).call(this, event);
        this.dispatchEvent(event);
      }
    }

    export interface FakeSockets {
      /** What an adapter is handed in place of `new WebSocket(url, protocols)`. */
      readonly create: (url: string | URL, protocols?: string | string[]) => WebSocket;
      /** Every socket created so far, oldest first. */
      readonly all: readonly FakeSocket[];
      /** The newest; throws when none was created. */
      last(): FakeSocket;
    }

    export function fakeSockets(): FakeSockets {
      const all: FakeSocket[] = [];
      return {
        create: (url, protocols) => {
          const socket = new FakeSocket(String(url), protocols);
          all.push(socket);
          return socket as unknown as WebSocket;
        },
        all,
        last() {
          const socket = all[all.length - 1];
          if (!socket) throw new Error('no socket was created');
          return socket;
        },
      };
    }
    ```

  - `drive.ts`. The header states the clock convention:

    ```ts
    /**
     * The scenario driver (F9): starts an adapter on a virtual clock, plays a
     * list of steps at it — the caller's side (audio, text, turns, stop, a
     * cancel) and the server's (the test's own `run` steps: a FakeSocket's
     * frames) — records every event with the markers conformance reads, stops
     * the session, runs the clock on to catch anything that fires after the
     * end, and checks the log (`checkConformance`).
     *
     * The clock convention for adapters and the protocol modules they own:
     * every timer reads the request's `clock` — `clock.setTimeout`,
     * `every(clock, ms, fn)` for an interval, `clock.now()` for the time —
     * never the global `setTimeout` / `setInterval` / `Date.now`
     * (`src/providers/sessionSide.consistency.test.ts` holds the session side
     * to it). Here the clock is virtual, so a minute of keep-alive is one
     * `{ advance: 60_000 }`. Test-only.
     */
    import type { Adapter, AdapterSession, Punctuator, SessionContext } from '../adapter';
    import { SAMPLE_RATE } from '../adapter';
    import { createVirtualClock, type VirtualClock } from '../clock';
    import { checkConformance, recordConformance, type ConformanceLog, type Violation } from '../conformance';

    export interface ScenarioHandles {
      /** The session `start` resolved with; null while it opens, or when it rejected. */
      session: AdapterSession | null;
      clock: VirtualClock;
      log: ConformanceLog;
    }

    export type ScenarioStep =
      | { advance: number }
      | { flush: true }
      /** `appendAudio`: this many ms of voiced pcm. */
      | { audio: number }
      /** `appendText`, marked for the typed-text rule. */
      | { text: string }
      /** A turn's key: press; release with speech; release without (the last two marked). */
      | { turn: 'begin' | 'end' | 'cancel' }
      /** Abort the request's signal: a cancel. */
      | { abort: true }
      /** `stop()`, marked and awaited. */
      | { stop: true }
      /** The test's own step: a server frame, a socket drop. */
      | { run(handles: ScenarioHandles): void | Promise<void> };

    export interface DriveOptions<C, K> {
      context: SessionContext;
      config: C;
      credentials: K;
      /** Run while `start` is still pending: what lets it resolve (the server's handshake), or cancels it. */
      opening?: readonly ScenarioStep[];
      /** Run once `start` has resolved; skipped when it rejected. */
      steps?: readonly ScenarioStep[];
      /** After the steps the session is stopped (unless a step did), then the clock runs this much further. Default 10 000 ms. */
      settleMs?: number;
      input?: MediaStreamTrack;
      punctuate?: Punctuator;
    }

    export interface DriveResult {
      log: ConformanceLog;
      session: AdapterSession | null;
      /** What `start` rejected with; undefined when it resolved. */
      startError: unknown;
      violations: Violation[];
      clock: VirtualClock;
    }

    /** One macrotask: every pending promise and microtask (a FakeSocket's close) has run. */
    export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    /** This many ms of 24 kHz pcm, voiced: a 440 Hz tone at a fifth of full scale. */
    export function voicedPcm(ms: number): Int16Array {
      const out = new Int16Array(Math.round((SAMPLE_RATE * ms) / 1000));
      for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) * 6554);
      return out;
    }

    /** How many flushes a start may take to settle once its opening steps have run. */
    const START_FLUSHES = 20;
    type Settled = { session: AdapterSession } | { error: unknown };

    export async function driveAdapter<C, K>(adapter: Pick<Adapter<C, K>, 'start'>, o: DriveOptions<C, K>): Promise<DriveResult> {
      const clock = createVirtualClock(0);
      const controller = new AbortController();
      const recorder = recordConformance();
      const handles: ScenarioHandles = { session: null, clock, log: recorder.log };
      const box: { settled: Settled | null; stopped: boolean } = { settled: null, stopped: false };
      const read = (): Settled | null => box.settled;
      const stop = async () => {
        if (!handles.session || box.stopped) return;
        box.stopped = true;
        recorder.mark('stop');
        await handles.session.stop();
      };
      const play = async (step: ScenarioStep): Promise<void> => {
        if ('advance' in step) clock.advance(step.advance);
        else if ('flush' in step) await flush();
        else if ('audio' in step) handles.session?.appendAudio(voicedPcm(step.audio));
        else if ('text' in step) { recorder.mark('appendText', step.text); handles.session?.appendText(step.text); }
        else if ('turn' in step) {
          if (step.turn === 'begin') handles.session?.beginTurn();
          else if (step.turn === 'end') { recorder.mark('endTurn'); handles.session?.endTurn(); }
          else { recorder.mark('cancelTurn'); handles.session?.cancelTurn(); }
        } else if ('abort' in step) controller.abort(new Error('the scenario cancelled the start'));
        else if ('stop' in step) await stop();
        else await step.run(handles);
      };
      const result = (startError: unknown): DriveResult =>
        ({ log: recorder.log, session: handles.session, startError, violations: checkConformance(recorder.log, o.context), clock });

      void adapter.start(
        { context: o.context, config: o.config, credentials: o.credentials, clock, signal: controller.signal, input: o.input, punctuate: o.punctuate },
        recorder.events,
      ).then((session) => { box.settled = { session }; }, (error: unknown) => { box.settled = { error }; });
      for (const step of o.opening ?? []) await play(step);
      for (let i = 0; i < START_FLUSHES && read() === null; i++) await flush();
      const settled = read();
      if (settled === null) return result(new Error('start neither resolved nor rejected after the opening steps'));
      if ('error' in settled) {
        // Anything an adapter emits after a rejected start is still caught (the abort scenario reads it).
        clock.advance(o.settleMs ?? 10_000);
        await flush();
        return result(settled.error);
      }
      handles.session = settled.session;
      for (const step of o.steps ?? []) await play(step);
      await stop();
      clock.advance(o.settleMs ?? 10_000);
      await flush();
      return result(undefined);
    }
    ```

  - `scenarios.ts`:

    ```ts
    /**
     * The conformance suite every adapter passes (D24, spec "Testing"): the
     * same scenarios over any adapter, through its harness — the few steps
     * that are this adapter's own (opening its socket, making its server say
     * something, closing it). Each returns its conformance violations and the
     * problems particular to it; an adapter's test asserts both empty.
     * Test-only.
     */
    import type { Adapter, SessionContext } from '../adapter';
    import type { ConformanceLog, Violation } from '../conformance';
    import type { AdapterEvent } from '../events';
    import { describeCause } from '../../diagnostics/describeCause';
    import { driveAdapter, type DriveResult, type ScenarioStep } from './drive';

    export type ScenarioName = 'open-stop' | 'speech-off' | 'abort-while-opening' | 'manual-end' | 'manual-cancel' | 'text' | 'server-close' | 'reconnect';

    export interface AdapterHarness<C, K> {
      adapter: Pick<Adapter<C, K>, 'start'>;
      /** A fresh config for one scenario; `scenario` lets a harness script its server per scenario. */
      config(context: SessionContext, scenario: ScenarioName): C;
      credentials: K;
      /** What lets a start resolve: open the socket, answer the handshake. Empty for an adapter that opens at once. */
      opening(scenario: ScenarioName): readonly ScenarioStep[];
      /** Makes the provider produce one exchange: a source segment and its translation, closed. */
      exchange: readonly ScenarioStep[];
      /** Makes the server end the session unexpectedly. */
      serverClose: readonly ScenarioStep[];
      /** Answers typed text; absent when the provider takes none (`textInput: false`). */
      answerText?: readonly ScenarioStep[];
      /** Drops the transport and lets it come back; absent when the adapter does not reconnect. */
      reconnect?: readonly ScenarioStep[];
    }

    export interface ScenarioReport { name: ScenarioName; violations: Violation[]; problems: string[] }

    const AUTO: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
    const ALL: readonly ScenarioName[] = ['open-stop', 'speech-off', 'abort-while-opening', 'manual-end', 'manual-cancel', 'text', 'server-close', 'reconnect'];
    const CONTENT = new Set<string>(['segmentOpened', 'segmentText', 'segmentClosed', 'audio']);
    const kinds = (log: ConformanceLog) => log.filter((e): e is AdapterEvent => e.kind !== 'marker').map((e) => e.kind);

    /** The scenarios this harness can run: all, less typed text and reconnecting where the adapter has neither. */
    export function scenarioNames(h: Partial<Pick<AdapterHarness<unknown, unknown>, 'answerText' | 'reconnect'>>): ScenarioName[] {
      return ALL.filter((n) => (n !== 'text' || h.answerText !== undefined) && (n !== 'reconnect' || h.reconnect !== undefined));
    }

    export async function runScenario<C, K>(h: AdapterHarness<C, K>, name: ScenarioName): Promise<ScenarioReport> {
      const problems: string[] = [];
      const drive = (context: SessionContext, opening: readonly ScenarioStep[], steps: readonly ScenarioStep[]) =>
        driveAdapter(h.adapter, { context, config: h.config(context, name), credentials: h.credentials, opening, steps });
      const manual: SessionContext = { ...AUTO, turns: 'manual' };
      let r: DriveResult;
      switch (name) {
        case 'open-stop':
        case 'speech-off':
          r = await drive(name === 'speech-off' ? { ...AUTO, speech: false } : AUTO, h.opening(name), h.exchange);
          if (!kinds(r.log).includes('segmentOpened')) problems.push('the exchange steps produced no segment');
          break;
        case 'abort-while-opening':
          r = await drive(AUTO, [{ abort: true }, { flush: true }], []);
          if (r.startError === undefined) problems.push('start resolved although its signal aborted while it was opening');
          if (kinds(r.log).some((k) => CONTENT.has(k))) problems.push('content was emitted after the start was cancelled');
          break;
        case 'manual-end':
          r = await drive(manual, h.opening(name), [{ turn: 'begin' }, { audio: 600 }, { turn: 'end' }, ...h.exchange]);
          break;
        case 'manual-cancel':
          r = await drive(manual, h.opening(name), [{ turn: 'begin' }, { audio: 100 }, { turn: 'cancel' }, { advance: 5_000 }]);
          break;
        case 'text':
          if (!h.answerText) throw new Error('this harness takes no typed text');
          r = await drive(AUTO, h.opening(name), [{ text: 'typed words' }, ...h.answerText]);
          break;
        case 'server-close':
          r = await drive(AUTO, h.opening(name), [...h.exchange, ...h.serverClose]);
          if (!kinds(r.log).some((k) => k === 'closed' || k === 'failed')) problems.push('the server ended the session and the adapter did not say so (failed or closed)');
          break;
        case 'reconnect': {
          if (!h.reconnect) throw new Error('this harness does not reconnect');
          r = await drive(AUTO, h.opening(name), [...h.exchange, ...h.reconnect, ...h.exchange]);
          const k = kinds(r.log);
          const at = k.indexOf('reconnecting');
          if (at < 0 || k.indexOf('reconnected', at) < 0) problems.push('no reconnecting followed by reconnected');
          break;
        }
        default:
          // Exhaustive over ScenarioName; also what tells the compiler `r` is assigned below.
          throw new Error(`unknown scenario ${String(name)}`);
      }
      if (name !== 'abort-while-opening' && r.startError !== undefined) problems.push(`start rejected: ${describeCause(r.startError)}`);
      return { name, violations: r.violations, problems };
    }
    ```

  - `examples.ts`. The two adapters the kit's own tests drive, kept once, here:

    ```ts
    /**
     * Two adapters the kit's tests drive (F9). `createEchoAdapter` is the
     * shape a Stage 2 socket adapter takes: a config that carries its socket
     * factory, events from the server's frames, `closed` on a close it did not
     * ask for, and a start that rejects when its signal aborts while it opens.
     * `createBrokenAdapter` breaks three rules the scenarios must catch.
     * Test-only: nothing but a test imports it.
     */
    import type { Adapter, AdapterSession } from '../adapter';

    export interface EchoConfig { openSocket(url: string): WebSocket }

    export function createEchoAdapter(): Adapter<EchoConfig, { key: string }> {
      return {
        start(request, events) {
          return new Promise<AdapterSession>((resolve, reject) => {
            if (request.signal.aborted) return reject(request.signal.reason ?? new Error('aborted'));
            const ws = request.config.openSocket('wss://echo.test/translate');
            let ended = false;
            let nextRef = 1;
            const onAbort = () => { ended = true; ws.close(); reject(request.signal.reason ?? new Error('aborted')); };
            request.signal.addEventListener('abort', onAbort, { once: true });
            const exchange = (source: string, translation: string) => {
              const src = nextRef++;
              const tr = nextRef++;
              const origin = `o${src}`;
              events.segmentOpened({ ref: src, side: 'source', origin });
              events.segmentText({ ref: src, text: source });
              events.segmentClosed({ ref: src, origin });
              events.segmentOpened({ ref: tr, side: 'translation', origin });
              events.segmentText({ ref: tr, text: translation });
              if (request.context.speech) events.audio({ ref: tr, range: [0, translation.length], pcm: new Int16Array(2400) });
              events.segmentClosed({ ref: tr, origin });
            };
            const session: AdapterSession = {
              info: { transport: 'websocket' },
              appendAudio: (pcm) => { if (!ended) ws.send(pcm.buffer); },
              appendText: (text) => { if (!ended) exchange(text, `«${text}»`); },
              beginTurn() {},
              endTurn: () => { if (!ended) ws.send(JSON.stringify({ type: 'commit' })); },
              cancelTurn: () => { if (!ended) ws.send(JSON.stringify({ type: 'clear' })); },
              // Closes the socket before any await (the AdapterSession rule on `stop`).
              async stop() { ended = true; ws.close(1000); },
            };
            ws.onopen = () => {
              request.signal.removeEventListener('abort', onAbort);
              ws.send(JSON.stringify({ type: 'session.start', source: request.context.direction.source }));
              events.frame({ direction: 'out', type: 'session.start' });
              resolve(session);
            };
            ws.onmessage = (ev) => {
              if (ended) return;
              const msg = JSON.parse(String(ev.data)) as { source: string; translation: string };
              exchange(msg.source, msg.translation);
            };
            ws.onclose = (ev) => {
              if (ended) return;
              ended = true;
              events.closed({ reason: `the socket closed (${ev.code})` });
            };
          });
        },
      };
    }

    /**
     * Breaks three rules the scenarios check: `start` resolves at once whatever
     * its signal says, the session produces nothing for the server's frames nor
     * says when its server went away, and `stop()` emits afterwards.
     */
    export function createBrokenAdapter(): Adapter<Record<string, never>, Record<string, never>> {
      return {
        async start(request, events) {
          return {
            info: { transport: 'broken' },
            appendAudio() {},
            appendText() {},
            beginTurn() {},
            endTurn() {},
            cancelTurn() {},
            async stop() {
              request.clock.setTimeout(() => events.segmentOpened({ ref: 99, side: 'source' }), 100);
            },
          };
        },
      };
    }
    ```

- [ ] **Step 4: Run** `npx vitest run src/lib/contract`, then the full suite and the gate.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/lib/contract/clock.ts src/lib/contract/clock.test.ts src/lib/contract/testing/fakeSocket.ts src/lib/contract/testing/fakeSocket.test.ts src/lib/contract/testing/drive.ts src/lib/contract/testing/drive.test.ts src/lib/contract/testing/scenarios.ts src/lib/contract/testing/scenarios.test.ts src/lib/contract/testing/examples.ts
  ```

  ```bash
  git commit -q -F - -- src/lib/contract/clock.ts src/lib/contract/clock.test.ts src/lib/contract/testing/fakeSocket.ts src/lib/contract/testing/fakeSocket.test.ts src/lib/contract/testing/drive.ts src/lib/contract/testing/drive.test.ts src/lib/contract/testing/scenarios.ts src/lib/contract/testing/scenarios.test.ts src/lib/contract/testing/examples.ts <<'EOF'
  test(contract): the adapter test kit — FakeSocket, the scenario driver, the conformance suite

  driveAdapter plays steps at an adapter on a virtual clock and checks the
  log; runScenario runs the same eight scenarios over any adapter's
  harness; FakeSocket is the WebSocket double; every() is the interval on
  the request's clock (Stage 2 foundation, F9). The fake and a worked
  socket adapter pass them.

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

### Task 5: Guards — the console ledger over `src/providers`, a provider's session side, the kit test-only (F17)

**Files:**
- Modify: `src/lib/diagnostics/consoleLedger.consistency.test.ts`: `ROOTS`, the `CLEARED` list, the tree check, and the clients rule's comment.
- Create: `src/providers/sessionSide.consistency.test.ts`.

**Interfaces:**
- **Produces:** the rules every Stage 2 provider meets.
  - Its `src/providers/<id>/adapter.ts`, and the files of its folder that `adapter.ts` reaches by value imports, import no store and no reporter as a value, and call no global timer or wall clock.
  - Its session hooks are not held to that: they may read the provider's own stores (choice 11). The guard's header says why.
  - No `console.error` / `console.warn` anywhere under `src/providers`.
  - Only test-only modules import `src/lib/contract/testing`. "Test-only" is defined in case 6.
- **Consumed by:** every provider plan. An adapter must live in `adapter.ts`, or the guard's "every provider has one" case fails loudly.

- [ ] **Step 1: Write the guards.** Guards over the current tree pass as soon as they are written. Each scan therefore proves itself with controls inside the test: a fixture tree in a temporary directory, or a synthetic import graph. Never by editing a real file (Global Constraints).
  - `consoleLedger.consistency.test.ts`:
    - `ROOTS` gains `'src/providers'`, commented "the new providers (Stage 2): adapters never log — they emit (CLAUDE.md) — and their components report".
    - The case "the roots #441 covered stay at zero" gains `'src/providers/'` in `CLEARED`.
    - The case "finds the tree and matches the pattern" gains `expect(files).toContain('src/providers/fake/adapter.ts')`. That is the control that the new root is scanned. The file's existing `countConsoleCalls` controls already prove the count.
    - The clients rule's comment gains: "A provider's adapter is held to the same by `src/providers/sessionSide.consistency.test.ts`."
  - `sessionSide.consistency.test.ts` (new):

    ```ts
    /**
     * A provider's session side — its `adapter.ts` and every file of its own
     * folder the adapter reaches by a value import — follows the rules
     * CLAUDE.md sets for clients (F17): it never imports a store or the
     * reporter (an adapter cannot know which leg it serves; it says what
     * happened through its events — `degraded`, `failed`, `closed`, `frame`),
     * and every timer it runs reads the request's clock (the F9 convention),
     * never a global one or the wall clock.
     *
     * Not the session hooks (`prepare`, `admit`, `acquire`, `startBoth`), by
     * the spec (Stage 2 foundation, choice 11):
     * - they may read the provider's own stores ("A provider's own stores are
     *   its own business"; LocalInference's shipped `admit` reads `modelStore`);
     * - they run on the runner's side of a run, not inside one leg's session,
     *   so a failure becomes the run's refusal, `end(notice)` or a release the
     *   runner reports;
     * - what they must not read — the live stores the run's shape froze — they
     *   are handed as `shape`, and `acquire`'s timers read `ctx.clock`.
     *
     * The limit: a module outside the provider's folder (`src/lib/**`) is not
     * followed — the spine's modules are held by their own rules.
     *
     * Also: only test-only modules import the adapter test kit (case 6).
     */
    import { describe, it, expect } from 'vitest';
    import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { dirname, join, resolve } from 'node:path';
    import ts from 'typescript';

    const REPO_ROOT = resolve(__dirname, '../..');
    const parse = (source: string, fileName: string) =>
      ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

    /** The specifiers a file imports or re-exports as values: `import type`, and a named import whose every name is `type`, are not. */
    function valueImports(source: string, fileName = 'scan.ts'): string[] {
      const out: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const clause = node.importClause;
          const named = clause?.namedBindings;
          const typeOnly = clause?.isTypeOnly === true
            || (clause !== undefined && clause.name === undefined && named !== undefined && ts.isNamedImports(named)
              && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly));
          if (!typeOnly) out.push(node.moduleSpecifier.text);
        } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          out.push(node.moduleSpecifier.text);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          out.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
      };
      visit(parse(source, fileName));
      return out;
    }

    const TIMERS = new Set(['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame']);
    const GLOBALS = new Set(['window', 'globalThis', 'self']);

    /** The global timers and wall-clock reads a file calls. */
    function globalTimerCalls(source: string, fileName = 'scan.ts'): string[] {
      const out: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          if (ts.isIdentifier(callee) && TIMERS.has(callee.text)) out.push(callee.text);
          else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
            const target = callee.expression.text;
            const name = callee.name.text;
            if ((target === 'Date' || target === 'performance') && name === 'now') out.push(`${target}.now`);
            else if (GLOBALS.has(target) && TIMERS.has(name)) out.push(`${target}.${name}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(parse(source, fileName));
      return out;
    }

    const FORBIDDEN = [/(^|\/)stores\//, /(^|\/)lib\/diagnostics\/report$/];

    /** A relative specifier from `from` as a repo-relative file; null when it is not relative or not found. */
    function resolveFile(root: string, from: string, spec: string): string | null {
      if (!spec.startsWith('.')) return null;
      const base = join(dirname(from), spec);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'), base]) {
        const rel = candidate.split('\\').join('/');
        if (existsSync(join(root, rel)) && statSync(join(root, rel)).isFile()) return rel;
      }
      return null;
    }

    /** `dir/adapter.ts` and every file of `dir` it reaches by value imports. */
    function sessionSide(root: string, dir: string): string[] {
      const seen = new Set([`${dir}/adapter.ts`]);
      const queue = [...seen];
      while (queue.length > 0) {
        const file = queue.shift()!;
        for (const spec of valueImports(readFileSync(join(root, file), 'utf-8'), file)) {
          const next = resolveFile(root, file, spec);
          if (next && next.startsWith(`${dir}/`) && !seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
      return [...seen].sort();
    }

    /** `file: specifier` for every store or reporter a session side imports as a value. */
    const storeOffenders = (root: string, dir: string) => sessionSide(root, dir).flatMap((file) =>
      valueImports(readFileSync(join(root, file), 'utf-8'), file).filter((s) => FORBIDDEN.some((re) => re.test(s))).map((s) => `${file}: ${s}`));

    /** `file: call` for every global timer or wall-clock read on a session side. */
    const timerOffenders = (root: string, dir: string) => sessionSide(root, dir).flatMap((file) =>
      globalTimerCalls(readFileSync(join(root, file), 'utf-8'), file).map((call) => `${file}: ${call}`));

    const providerDirs = () => readdirSync(join(REPO_ROOT, 'src/providers'))
      .map((entry) => `src/providers/${entry}`)
      .filter((dir) => statSync(join(REPO_ROOT, dir)).isDirectory());

    /**
     * Test-only modules (Stage 2 foundation, choice 10 and the kit rule): a
     * test file; a module of the kit itself; or a test-only helper — a module
     * with at least one importer, all of whose importers are test-only (as
     * `src/providers/localInference/fakeEngines.ts` is). A module nothing
     * imports is not a helper. An import cycle outside the tests is not
     * test-only.
     */
    function testOnlyModules(files: readonly string[], importers: ReadonlyMap<string, ReadonlySet<string>>, isTest: (f: string) => boolean, inKit: (f: string) => boolean): Set<string> {
      const memo = new Map<string, boolean>();
      const visiting = new Set<string>();
      const check = (file: string): boolean => {
        const known = memo.get(file);
        if (known !== undefined) return known;
        if (isTest(file) || inKit(file)) { memo.set(file, true); return true; }
        if (visiting.has(file)) return false;
        visiting.add(file);
        const from = [...(importers.get(file) ?? [])];
        const answer = from.length > 0 && from.every(check);
        visiting.delete(file);
        memo.set(file, answer);
        return answer;
      };
      return new Set(files.filter(check));
    }

    const isTest = (f: string) => /\.test\.tsx?$/.test(f);
    const inKit = (f: string) => f.startsWith('src/lib/contract/testing/');

    /** Every `.ts` / `.tsx` under `src` (no `.d.ts`), the files each imports by value (resolved), and who imports each. */
    function importGraph(root: string): { files: string[]; importers: Map<string, Set<string>>; targets: Map<string, string[]> } {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(join(root, dir))) {
          const rel = `${dir}/${entry}`;
          if (statSync(join(root, rel)).isDirectory()) walk(rel);
          else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) files.push(rel);
        }
      };
      walk('src');
      const importers = new Map<string, Set<string>>();
      const targets = new Map<string, string[]>();
      for (const file of files) {
        const resolved = valueImports(readFileSync(join(root, file), 'utf-8'), file)
          .map((spec) => resolveFile(root, file, spec))
          .filter((target): target is string => target !== null);
        targets.set(file, resolved);
        for (const target of resolved) importers.set(target, (importers.get(target) ?? new Set()).add(file));
      }
      return { files, importers, targets };
    }
    ```

    Cases:
    1. **"every provider keeps its adapter in adapter.ts, and the walk follows its folder"**:
       - for each of `providerDirs()`, `existsSync(join(REPO_ROOT, dir, 'adapter.ts'))`;
       - `sessionSide(REPO_ROOT, 'src/providers/localInference')` contains `adapter.ts`, `engines.ts`, `sentenceCut.ts` and `speech.ts`;
       - `sessionSide(REPO_ROOT, 'src/providers/fake')` contains `adapter.ts` and `synth.ts`, and not `script.ts`, which the adapter imports as types only.
    2. **"reads imports the way the compiler does"**:
       - `import { a } from './a'` → `['./a']`;
       - `import type { B } from './b'` → `[]`;
       - `import { type C } from './c'` → `[]`;
       - `import { d, type E } from './d'` → `['./d']`;
       - `import './side'` → `['./side']`;
       - `export { f } from './f'` → `['./f']`;
       - `export type { G } from './g'` → `[]`;
       - `const m = await import('./lazy')` → `['./lazy']`;
       - `// import { x } from './x'` → `[]`.
    3. **"finds the global timers and the wall clock, and nothing else"**:
       - `setTimeout(f, 1)` → `['setTimeout']`;
       - `clock.setTimeout(f, 1)` → `[]`;
       - `this.clock.setTimeout(f, 1)` → `[]`;
       - `Date.now()` → `['Date.now']`;
       - `performance.now()` → `['performance.now']`;
       - `window.setInterval(f, 5)` → `['window.setInterval']`;
       - `const s = 'setTimeout(x)'` → `[]`;
       - `// setInterval(f)` → `[]`.
    4. **"a session side imports no store and no reporter as a value"** — `providerDirs().flatMap((dir) => storeOffenders(REPO_ROOT, dir))` is `[]`.
    5. **"a session side runs no global timer: every timer reads the request's clock"** — `providerDirs().flatMap((dir) => timerOffenders(REPO_ROOT, dir))` is `[]`.
    6. **"only test-only modules import the adapter test kit"**:
       - `const { files, importers, targets } = importGraph(REPO_ROOT)`, and `const testOnly = testOnlyModules(files, importers, isTest, inKit)`;
       - the offenders — files one of whose `targets` is in the kit (`inKit`), and that are not in `testOnly` — are `[]`. Resolved targets, not specifiers: a relative import from `src/lib/contract` reads `./testing/drive`;
       - the walk's control: `files.length` is above 300;
       - the helper control: `testOnly.has('src/providers/localInference/fakeEngines.ts')` is `true` (imported by two tests only), and `testOnly.has('src/providers/localInference/adapter.ts')` is `false`;
       - the definition's control, on a synthetic graph. The files are `a.test.ts`, `helper.ts` (imported by `a.test.ts`), `deep.ts` (imported by `helper.ts`), `app.ts` (imported by nothing), `used.ts` (imported by `app.ts` and `a.test.ts`), `cyc1.ts` and `cyc2.ts` (importing each other) and `orphan.ts`. `testOnlyModules` gives exactly `a.test.ts`, `helper.ts` and `deep.ts`: `used.ts` has a non-test importer, a cycle is not test-only, and a module nothing imports is not a helper.
    7. **"the rules catch a violating provider (a fixture tree, never the real one)"**:
       - `const root = mkdtempSync(join(tmpdir(), 'sokuji-session-side-'))`, with `src/providers/probe/` created by `mkdirSync(…, { recursive: true })` and three files written:
         - `adapter.ts`: `import { keepAlive } from './proto';\nimport type { T } from './types';\nexport const run = (t: T) => keepAlive(t);\n`;
         - `proto.ts`: `import { useProviderStore } from '../../stores/providerStore';\nexport function keepAlive(t: number) { setInterval(() => useProviderStore.getState(), t); return Date.now(); }\n`;
         - `types.ts`: `export type T = number;\n`;
       - `sessionSide(root, 'src/providers/probe')` equals `['src/providers/probe/adapter.ts', 'src/providers/probe/proto.ts']`: a type-only import is not followed;
       - `storeOffenders(root, 'src/providers/probe')` equals `['src/providers/probe/proto.ts: ../../stores/providerStore']`;
       - `timerOffenders(root, 'src/providers/probe')` equals `['src/providers/probe/proto.ts: setInterval', 'src/providers/probe/proto.ts: Date.now']`.
- [ ] **Step 2: Run** `npx vitest run src/providers/sessionSide.consistency.test.ts src/lib/diagnostics/consoleLedger.consistency.test.ts`. Every case passes on the current tree. The controls in cases 2, 3, 6 and 7 are what prove the scans work. If Task 4's kit has not landed yet, case 6's offender list is empty either way.
- [ ] **Step 3: Run** the full suite and the gate.
- [ ] **Step 4: Commit.**

  ```bash
  git add src/lib/diagnostics/consoleLedger.consistency.test.ts src/providers/sessionSide.consistency.test.ts
  ```

  ```bash
  git commit -q -F - -- src/lib/diagnostics/consoleLedger.consistency.test.ts src/providers/sessionSide.consistency.test.ts <<'EOF'
  test(providers): a provider's session side imports no store, no reporter, no global timer

  The console ledger scans src/providers and holds it at zero; a new guard
  walks each provider's adapter.ts through its own folder (no store or
  report imports, every timer on the request's clock) and lets only
  test-only modules import the adapter test kit. Session hooks are left
  out on the spec's word (Stage 2 foundation, F17; choice 11).

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

### Task 6: The streaming-audio gap probe (G3's instrument)

**Files:**
- Create: `src/components/dev/gapCounter.ts` (+ `gapCounter.test.ts`).
- Modify: `src/components/dev/SessionControls.tsx` (`usePlaybackProbe` and the probe line), `scripts/dev/spine-audio-probe.mjs`.

**Interfaces:**
- **Produces:**
  - `createGapCounter(sampleRate?): { push(samples: Float32Array): void; read(): GapCount }`, with `GapCount = { gaps: number; gapMs: number; at: number[] }`, `GAP_MIN_SAMPLES = 12` and `SILENT = 1e-4`;
  - the preview's `[data-probe=playback]` line gains ` · gaps: <n> (<ms> ms) at <s,s,…|->`;
  - `spine-audio-probe.mjs [url] [seconds] [--max-gaps N]` prints the gaps, splits them as steady and hiccup for `script=refless-stream`, and exits 1 over `N`.
- **Consumed by:** group check A's G3 measurement (with Task 8's `refless-stream`), and Task 15's re-check.

- [ ] **Step 1: Write the failing tests** in `gapCounter.test.ts`. The file writes the tap's floats itself — the fake's tone, as the tap would hear it — so it does not wait on Task 8: `const tone = (ms: number, from = 0) => Float32Array.from({ length: 24 * ms }, (_, i) => (Math.sin((2 * Math.PI * 440 * (from + i)) / 24_000) * 8000) / 32768)`.
  - Its first sample is `sin(0) = 0`, silent. So the first sound is sample 1, and `at` is measured from there. A tone resumed after a gap starts at a nonzero phase (`from` ≠ 0) so the gap's length is exact.
  1. **"a continuous tone, however it is split across reads, has no gap"** — push `tone(500)` in slices of 1 000, 37 and the rest → `read()` equals `{ gaps: 0, gapMs: 0, at: [] }`.
  2. **"counts a run of silence of 12 samples inside speech as one gap, and 11 as none"**:
     - push `tone(100)`, `new Float32Array(12)`, `tone(100, 2412)` → one gap, `gapMs` 0.5, and `at[0]` close to 0.1 (`toBeCloseTo(0.1, 3)`);
     - a fresh counter with 11 zeros in place of 12 → 0 gaps.
  3. **"does not count silence before the first sound or after the last"** — push `new Float32Array(2400)`, `tone(100)`, `new Float32Array(2400)` → 0 gaps.
  4. **"counts a gap that straddles two reads once, at its full length"** — push `tone(100)` with 30 zeros appended, then 30 zeros followed by `tone(100, 2460)` → one gap, `gapMs` 2.5.
  5. **"a 440 Hz tone's zero crossings are not gaps"** — one second of `tone(1000)` → 0 gaps. An exact zero falls on every 300th sample: a run of one.
- [ ] **Step 2: Run** `npx vitest run src/components/dev/gapCounter.test.ts`. It fails: there is no module.
- [ ] **Step 3: Implement.**
  - `gapCounter.ts`:

    ```ts
    /**
     * Gaps in what the tts tap heard (G3): a run of silence inside speech
     * long enough not to be a waveform's own zero crossing. The preview's
     * playback probe feeds it every tap read, so a gap straddling two reads
     * counts once. Silence before the first sound and after the last is not
     * a gap. Development only.
     */
    /** 0.5 ms at 24 kHz: a 440 Hz sine at the fake's amplitude is below `SILENT` for one sample at a crossing. */
    export const GAP_MIN_SAMPLES = 12;
    export const SILENT = 1e-4;

    export interface GapCount {
      gaps: number;
      /** Their total length, in ms. */
      gapMs: number;
      /** Where each began, in seconds since the first sound. */
      at: number[];
    }

    export function createGapCounter(sampleRate = 24_000): { push(samples: Float32Array): void; read(): GapCount } {
      let heard = false;
      /** Samples since the first sound. */
      let position = 0;
      /** Silent samples since the last sound. */
      let run = 0;
      const count: GapCount = { gaps: 0, gapMs: 0, at: [] };
      return {
        push(samples) {
          for (let i = 0; i < samples.length; i++) {
            const silent = Math.abs(samples[i]) < SILENT;
            if (!heard) {
              if (silent) continue;
              heard = true;
            } else {
              position += 1;
            }
            if (silent) { run += 1; continue; }
            if (run >= GAP_MIN_SAMPLES) {
              count.gaps += 1;
              count.gapMs += (run * 1000) / sampleRate;
              count.at.push((position - run) / sampleRate);
            }
            run = 0;
          }
        },
        read: () => ({ gaps: count.gaps, gapMs: count.gapMs, at: [...count.at] }),
      };
    }
    ```

  - `SessionControls.tsx`, in `usePlaybackProbe`:
    - the probe's state gains `gaps: GapCount`, initially `{ gaps: 0, gapMs: 0, at: [] }`;
    - inside the effect, `const gapCounter = createGapCounter();`;
    - each tick reads `const tapped = playback.ttsTap.read();`, takes the peak from `tapped` as before, and calls `gapCounter.push(tapped)`;
    - the state updates when `gapCounter.read().gaps` changed as well.

    The line:

    ```tsx
    {`heard: ${probe.heard.join(',') || '-'} · tap peak: ${probe.peak.toFixed(3)} · bus peak: ${probe.busPeak.toFixed(3)}`
      + ` · gaps: ${probe.gaps.gaps} (${Math.round(probe.gaps.gapMs)} ms) at ${probe.gaps.at.map((s) => s.toFixed(1)).join(',') || '-'}`
      + (probe.captured ? ` · captured: ${probe.captured.chunks} · mic peak: ${probe.captured.peak.toFixed(3)}` : '')}
    ```

    The hook's doc gains: "and the gaps inside the translated speech the tap heard (G3)".
  - `spine-audio-probe.mjs`:
    - The header gains the `--max-gaps N` flag and the `refless-stream` split. `url` and `seconds` stay positional, and `--max-gaps N` may stand anywhere. The flag is parsed before the positionals, so `probe.mjs <url> --max-gaps 1` does not read `--max-gaps` as the seconds. The script's first lines become:

      ```js
      const args = process.argv.slice(2);
      const maxAt = args.indexOf('--max-gaps');
      const maxGaps = maxAt >= 0 ? Number(args[maxAt + 1]) : null;
      if (maxAt >= 0 && !Number.isInteger(maxGaps)) {
        console.log('--max-gaps needs a whole number');
        process.exit(2);
      }
      const positional = args.filter((_, i) => maxAt < 0 || (i !== maxAt && i !== maxAt + 1));
      const url = positional[0] ?? 'http://localhost:5199/?preview=spine&autostart=1&monitor=1';
      const seconds = Number(positional[1] ?? 12);
      ```

    - After printing the page's line:

      ```js
      const gapMatch = /gaps: (\d+) \((\d+) ms\) at (\S+)/.exec(text);
      const gaps = Number(gapMatch?.[1] ?? 0);
      if (url.includes('script=refless-stream')) {
        // The script's steady phase is its first 15 s of audio (`REFLESS_STREAM.steadyMs`, src/providers/fake/generate.ts).
        const at = gapMatch && gapMatch[3] !== '-' ? gapMatch[3].split(',').map(Number) : [];
        console.log(`steady gaps: ${at.filter((s) => s < 15).length} · hiccup gaps: ${at.filter((s) => s >= 15).length}`);
      }
      const gapsOk = maxGaps === null || gaps <= maxGaps;
      ```

    - The exit condition gains `&& gapsOk`.
- [ ] **Step 4: Run** `npx vitest run src/components/dev`, then the full suite and the gate. The widened regex covers `gapCounter`.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/components/dev/gapCounter.ts src/components/dev/gapCounter.test.ts src/components/dev/SessionControls.tsx scripts/dev/spine-audio-probe.mjs
  ```

  ```bash
  git commit -q -F - -- src/components/dev/gapCounter.ts src/components/dev/gapCounter.test.ts src/components/dev/SessionControls.tsx scripts/dev/spine-audio-probe.mjs <<'EOF'
  feat(dev): the preview counts gaps inside the translated speech it played

  The playback probe feeds the tts tap into a gap counter and prints the
  gaps; spine-audio-probe splits them for the refless-stream script and
  fails over --max-gaps (Stage 2 foundation, G3).

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

### Task 7: Credentials read with a code; the sign-in carries the user id (F3)

**Files:**
- Modify: `src/lib/provider/types.ts` (`AuthContext`, a new `CredentialsMissing`, `credentials.read`), `src/lib/provider/credentials.ts` (+ `credentials.test.ts`), `src/stores/providerStore.ts` (`refreshReadiness`'s missing-credentials line; + `providerStore.readiness.test.ts`), `src/lib/session/run.ts` (the credentials refusal; + `runner.test.ts`), `src/app/useAppSession.ts` (+ `useAppSession.test.tsx`), `src/components/providers/useAuthContext.ts`.

**Interfaces:**
- **Produces:**
  - `interface CredentialsMissing { missing: string; code?: string; params?: Record<string, string | number> }`;
  - `credentials.read(values, auth): K | CredentialsMissing`;
  - `readCredentials(...): K | CredentialsMissing`, and `isMissing(answer): answer is CredentialsMissing`;
  - `AuthContext.userId?: string | null`: null signed out, absent where no sign-in is wired (tests, the root's default).
- **Consumed by:**
  - a managed `read` answering `{ missing, code: 'sign_in_required' }` (Task 11's leased fake; Kizuna Soniox);
  - Palabra's app mode ("both Client ID and Secret");
  - Kizuna Soniox's `prepare` (`shape.auth.userId`);
  - the account (Task 10).

- [ ] **Step 1: Write the failing tests.**
  1. `credentials.test.ts`: **"passes a missing answer's code and params through"** — `read` returns `{ missing: 'Sign in first.', code: 'sign_in_required', params: { who: 'you' } }` → `readCredentials(...)` equals it, and `isMissing` is `true`.
  2. `providerStore.readiness.test.ts`: **"words missing credentials by the provider's own code, and by credentials_missing when it gives none"**:
     - a probe whose `read` returns `{ missing: 'Sign in first.', code: 'sign_in_required', params: { who: 'you' } }` → after `refreshReadiness`, readiness equals `{ state: 'not-ready', reason: 'Sign in first.', code: 'sign_in_required', params: { who: 'you' } }`, and `check` is not called;
     - the file's own probe with no key → `code: 'credentials_missing'`.
  3. `runner.test.ts`, in `describe('runner — starting')`: **"refuses a start whose credentials are missing, by the provider's own code"** — `shape.provider = { ...fakeProvider, credentials: { keys: [], fields: () => [], read: () => ({ missing: 'Sign in first.', code: 'sign_in_required' }) } }` → after `runner.start()`, the state matches `{ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'sign_in_required', message: 'Sign in first.' } } }`, and no source opened.
  4. `useAppSession.test.tsx`: the `useAuth` mock returns `{ isSignedIn: true, userId: 'u1', getToken: async () => 't' }`. In "hands the session the page's sign-in, …", add `expect(result.current.userId).toBe('u1')`.
- [ ] **Step 2: Run** `npx vitest run src/lib/provider src/stores src/lib/session/runner.test.ts src/app/useAppSession.test.tsx`.
  - Cases 2, 3 and 4 fail: the code is dropped for `credentials_missing`, and `userId` is not mapped.
  - Case 1 passes at run time — `readCredentials` returns `read`'s value as is. Its point is the type, which the typecheck gate checks.
- [ ] **Step 3: Implement.**
  - `types.ts`:

    ```ts
    /**
     * The sign-in session: what `credentials.read` may consult besides the
     * typed values (a managed provider), and the account a provider's
     * `prepare` or `Settings` acts for (F3).
     */
    export interface AuthContext {
      signedIn: boolean;
      getToken(): Promise<string | null>;
      /** The signed-in user's id; null signed out. Absent where no sign-in is wired: tests, the root's default. */
      userId?: string | null;
    }

    /**
     * Why `credentials.read` found no credentials. `code` (and `params`) put
     * it into the user's words — `sign_in_required` for a managed provider
     * signed out; absent, the runner's `credentials_missing`.
     */
    export interface CredentialsMissing { missing: string; code?: string; params?: Record<string, string | number> }
    ```

    `read`'s return type becomes `K | CredentialsMissing`, and its doc gains "a missing answer may carry a code (F3)".
  - `credentials.ts`: the return types become `K | CredentialsMissing`, and `isMissing`'s predicate becomes `answer is CredentialsMissing`.
  - `providerStore.ts`, the missing-credentials line of `refreshReadiness`:

    ```ts
          // The provider's own code (a managed provider's `sign_in_required`), or the runner's own for the same gap.
          if (isMissing(credentials)) {
            return setReadiness(p, {
              state: 'not-ready', reason: credentials.missing, code: credentials.code ?? 'credentials_missing',
              ...(credentials.params ? { params: credentials.params } : {}),
            });
          }
    ```

  - `run.ts`, the credentials refusal:

    ```ts
        if (isMissing(credentials)) {
          throw new RefusedError({
            code: credentials.code ?? ('credentials_missing' satisfies RunNoticeCode),
            message: credentials.missing,
            ...(credentials.params ? { params: credentials.params } : {}),
          });
        }
    ```

  - `useAppSession.ts`: `const { isSignedIn, userId, getToken } = useAuth(); const auth = useMemo(() => ({ signedIn: isSignedIn, userId: userId ?? null, getToken }), [isSignedIn, userId, getToken]);`.
  - `useAuthContext.ts`: the same mapping, and the doc's "the same object" still holds.
- [ ] **Step 4: Run** `npx vitest run src/lib src/stores src/app src/components/providers`, then the full suite and the gate.
  - `session.test.ts`'s "checks a local provider by itself" asserts the root's default auth exactly (`{ signedIn: false, getToken }`). The default is unchanged — no `userId` — so it stays green.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/lib/provider/types.ts src/lib/provider/credentials.ts src/lib/provider/credentials.test.ts src/stores/providerStore.ts src/stores/providerStore.readiness.test.ts src/lib/session/run.ts src/lib/session/runner.test.ts src/app/useAppSession.ts src/app/useAppSession.test.tsx src/components/providers/useAuthContext.ts
  ```

  ```bash
  git commit -q -F - -- src/lib/provider/types.ts src/lib/provider/credentials.ts src/lib/provider/credentials.test.ts src/stores/providerStore.ts src/stores/providerStore.readiness.test.ts src/lib/session/run.ts src/lib/session/runner.test.ts src/app/useAppSession.ts src/app/useAppSession.test.tsx src/components/providers/useAuthContext.ts <<'EOF'
  feat(provider): missing credentials say why by a code; the sign-in carries the user id

  credentials.read may answer { missing, code, params }, which readiness
  and a refused start keep instead of credentials_missing, so a managed
  provider signed out reads sign_in_required. AuthContext gains userId
  (Stage 2 foundation, F3).

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

### Task 8: The fake's new scripts and a script per leg (F10)

**Files:**
- Modify: `src/providers/fake/script.ts` (`audio.from`, `ExchangeOptions.ranged`), `synth.ts` (`from`), `adapter.ts` (passes `from`), `generate.ts` (`REFLESS_STREAM`, `reflessStreamScript`, `framedScript`), `scripts.ts` (four names), `settings.ts` (`participantScript`), `provider.ts` (`build` per leg), `FakeSettingsView.tsx` (the participant script select).
- Tests: `adapter.test.ts`, `provider.test.ts`, `FakeSettingsView.test.tsx`; create `scripts.test.ts`.

**Interfaces:**
- **Produces:**
  - `FakeScriptName` gains `'refless-stream' | 'framed' | 'rangeless' | 'reconnect'`;
  - `FakeSettings.participantScript: FakeScriptName | 'same'` (default `'same'`);
  - `synthPcm(ms, hz = 440, amplitude = 8000, from = 0)`;
  - the audio step's `from?: number` — the tone's phase, samples already played of one stream;
  - `ExchangeOptions.ranged?: boolean` (default true);
  - `REFLESS_STREAM = { startAt: 500, ms: 30_000, steadyMs: 15_000, hiccupEvery: 20, hiccupMs: 100 }`.
- **Consumed by:**
  - group check A (the G3 measurement on `refless-stream`, and the renders);
  - Task 11 (the leased fake builds through the fake's `build`);
  - every provider plan that proves its display shape on the fake first — Palabra `refless-stream`, OpenAI Translate/Live `framed`, Gemini/AST2 `rangeless`, reconnecting providers `reconnect`.

- [ ] **Step 1: Write the failing tests.**
  - `adapter.test.ts`, `describe('synth')`:
    1. **"continues the tone from a given sample, so chunks join without a click"** — `const whole = synthPcm(100)` and `const tail = synthPcm(50, 440, 8000, 1200)` → `tail` equals `whole.subarray(1200)`, element by element.
  - `scripts.test.ts` (new). `auto = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' }` and `const play = (name) => driveAdapter(createFakeAdapter(), { context: auto, config: { script: fakeScript(name) }, credentials: {}, steps: [{ advance: 40_000 }] })`:
    2. **"offers the nine scripts, and every one plays conformant through the kit's driver"** — `const ALL = ['exchange', 'cjk', 'rewrite', 'long', 'notices', 'refless-stream', 'framed', 'rangeless', 'reconnect'] as const`:
       - `FAKE_SCRIPT_NAMES` equals `ALL`, in that order;
       - for each name of `ALL` (not `FAKE_SCRIPT_NAMES`, so the case fails before the new names exist): `(await play(name)).violations` is `[]`, and `startError` is `undefined`.
    3. **"refless-stream: one continuous stream that names no segment, beside text with stated origins and a revision"**:
       - every `audio` event has `ref === undefined` and `range === undefined`;
       - their pcm totals at least `24_000 * 30` samples;
       - every `segmentOpened` has an `origin`;
       - at least one translation ref gets a `segmentText` after its `segmentClosed` (the revision).
    4. **"refless-stream: paced in real time — jitter within 20 ms for 15 s, then a stall every 20 chunks, the chunks behind it arriving with it"** — read `reflessStreamScript().blocks.at(-1)!.steps`. Walk them with a running `t` (the sum of the earlier steps' `audio.ms`); `lateness = step.at - t`:
       - arrivals never go backwards;
       - every step with `t < 15_000` has `0 <= lateness <= 20`;
       - some step with `t >= 15_000` has `lateness >= 100`.
    5. **"refless-stream: its chunks join without a click"** — record the fake's events on the script, advance 31 s, and take the audio pcm in order. At every joint, `Math.abs(prev[prev.length - 1] - next[0]) < 1000`: one step of a 440 Hz sine at 8 000 is about 922, while a restart at phase 0 jumps by up to 8 000.
    6. **"framed: no stated origin, a range on every audio frame, and the projection pairs by timing"**:
       - no `segmentOpened` has an `origin`;
       - every `audio` has a `ref` and a `range`;
       - fold the log into a `Conversation` (as `spine.e2e.test.ts` does, without a punctuator) and project with `{ ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 }` → three exchange entries, each with `pairing === 'inferred'`.
    7. **"rangeless: audio with a segment, never a range; origins stated"** — every `audio` has a `ref` and no `range`; the projection's entries are `'stated'`.
    8. **"reconnect: drops and comes back between two exchanges, refs never reused"** — the kinds hold `reconnecting` and, later, `reconnected`, and the `segmentOpened` refs are all distinct.
  - `provider.test.ts`:
    9. **"plays the participant's own script on the reversed direction"**:
       - `fakeProvider.build(context, settings({ participantScript: 'cjk' }), { ...shared, reversed: () => true })` → its `script` equals `fakeScript('cjk')`;
       - with `reversed: () => false` → `fakeScript('exchange')`;
       - with `participantScript: 'same'` and `reversed: () => true` → `fakeScript('exchange')`.
    10. **"keeps a known participant script, and falls back to same"** — `migrateFakeSettings({ participantScript: 'rangeless' }).participantScript` is `'rangeless'`; `{ participantScript: 'bogus' }` gives `'same'`.

    The existing "builds the chosen script and passes the fault knobs…" stays unchanged: the speaker leg's config is the same.
  - `FakeSettingsView.test.tsx`:
    11. **"chooses the participant's script"** — `fireEvent.change(screen.getByLabelText("Other's script"), { target: { value: 'cjk' } })` → `update` called with `{ participantScript: 'cjk' }`.
- [ ] **Step 2: Run** `npx vitest run src/providers/fake`. Cases 1–11 fail. Case 2 fails on `FAKE_SCRIPT_NAMES`, and on the four new names (`fakeScript` returns `undefined`).
- [ ] **Step 3: Implement.**
  - `synth.ts`: `export function synthPcm(ms: number, hz = 440, amplitude = 8000, from = 0): Int16Array`, and the sample becomes `Math.sin((2 * Math.PI * hz * (from + i)) / SAMPLE_RATE)`. The doc: "`from`: the samples of this tone already played, so consecutive chunks of one stream join without a click (G3)".
  - `script.ts`:
    - the audio step becomes `{ at: number; audio: { ref?: number; range?: TextRange; ms: number; from?: number } }`;
    - `ExchangeOptions` gains `/** false: the translation's audio chunks carry no range (replay only, no karaoke). Default true. */ ranged?: boolean;`;
    - in `exchange()`'s chunk loop, the step becomes `{ at, audio: { ref: tr, ...(o.ranged === false ? {} : { range: [start, end] as TextRange }), ms: msForText(piece) } }`.
  - `adapter.ts`, in `play`: `this.emit('audio', { ref: step.audio.ref, range: step.audio.range, pcm: synthPcm(step.audio.ms, undefined, undefined, step.audio.from) })`.
  - `generate.ts`:

    ```ts
    /**
     * Palabra's shape (F10): text with stated origins — a translation's text
     * revised after it closed, as Palabra's `partial_` → `validated_` — and one
     * continuous speech stream that names no segment. The stream arrives in
     * real time in 20–200 ms chunks: jittered by at most 20 ms for its first
     * `steadyMs`, then every `hiccupEvery`-th chunk `hiccupMs` late, the chunks
     * behind it arriving with it (G3's measurement, group check A).
     */
    export const REFLESS_STREAM = { startAt: 500, ms: 30_000, steadyMs: 15_000, hiccupEvery: 20, hiccupMs: 100 } as const;
    const CHUNK_MS = [20, 40, 100, 200, 60, 120] as const;
    const STEADY_JITTER_MS = [0, 5, 20, 10, 15, 0] as const;

    export function reflessStreamScript(): FakeScript {
      const sources = ['今日は天気がいいですね。', '公園に行きましょう。', 'ついでに買い物もします。'];
      const partials = ['The weather', 'Let us go', 'And do some'];
      const translations = ['The weather is nice today.', 'Let us go to the park.', 'And do some shopping on the way.'];
      const blocks: ScriptBlock[] = [];
      for (let i = 0; i < 6; i++) {
        const k = i % 3;
        const ref = 1 + i * 2;
        const origin = `p${i}`;
        blocks.push({ startAt: REFLESS_STREAM.startAt + i * 5000, steps: [
          { at: 0, open: { ref, side: 'source', origin } },
          { at: 0, text: { ref, text: sources[k].slice(0, 4) } },
          { at: 400, text: { ref, text: sources[k] } },
          { at: 800, close: { ref, origin } },
          { at: 1000, open: { ref: ref + 1, side: 'translation', origin } },
          { at: 1000, text: { ref: ref + 1, text: partials[k] } },
          { at: 1400, close: { ref: ref + 1, origin } },
          // `partial_` → `validated_`: the closed translation's text, revised.
          { at: 2400, text: { ref: ref + 1, text: translations[k] } },
        ] });
      }
      const steps: ScriptStep[] = [];
      let t = 0;
      let arrival = 0;
      let from = 0;
      for (let n = 0; t < REFLESS_STREAM.ms; n++) {
        const ms = CHUNK_MS[n % CHUNK_MS.length];
        const late = t >= REFLESS_STREAM.steadyMs && n % REFLESS_STREAM.hiccupEvery === 0
          ? REFLESS_STREAM.hiccupMs
          : STEADY_JITTER_MS[n % STEADY_JITTER_MS.length];
        arrival = Math.max(arrival, t + late);
        steps.push({ at: arrival, audio: { ms, from } });
        t += ms;
        from += (SAMPLE_RATE * ms) / 1000;
      }
      blocks.push({ startAt: REFLESS_STREAM.startAt, steps });
      return { blocks };
    }

    /**
     * OpenAI Translate's shape (F10): no stated origin — the projection pairs
     * by the segments' timing — and speech in frames, each with the range of
     * the translation it speaks, arriving as the translation grows.
     */
    export function framedScript(): FakeScript {
      const exchanges = [
        { source: ['Good', 'Good morning', 'Good morning, everyone.'], translation: 'おはようございます、皆さん。' },
        { source: ['Let us', 'Let us begin the meeting.'], translation: '会議を始めましょう。' },
        { source: ['First,', 'First, the schedule.'], translation: 'まず、予定です。' },
      ];
      return {
        blocks: exchanges.map((x, i) => {
          const ref = 1 + i * 2;
          const tr = ref + 1;
          const media = i * 6000;
          const sourceTiming = { startMs: media, endMs: media + 1200 };
          const trTiming = { startMs: media + 200, endMs: media + 1300 };
          const steps: ScriptStep[] = [{ at: 0, open: { ref, side: 'source' } }];
          x.source.forEach((text, k) => steps.push({ at: k * 200, text: { ref, text, timing: sourceTiming } }));
          let at = x.source.length * 200;
          steps.push({ at, close: { ref } }, { at, open: { ref: tr, side: 'translation' } });
          for (let end = 2; end < x.translation.length + 2; end += 2) {
            const stop = Math.min(end, x.translation.length);
            steps.push({ at, text: { ref: tr, text: x.translation.slice(0, stop), timing: trTiming } });
            steps.push({ at, audio: { ref: tr, range: [end - 2, stop], ms: 60 } });
            at += 60;
          }
          steps.push({ at, close: { ref: tr } });
          return { startAt: 500 + media, steps };
        }),
      };
    }
    ```

    Import `SAMPLE_RATE` from the contract, and `ScriptBlock` / `ScriptStep` from `./script`.
  - `scripts.ts`:
    - the union and `FAKE_SCRIPT_NAMES` gain the four names, in the order `'refless-stream', 'framed', 'rangeless', 'reconnect'` after `'notices'`;
    - `case 'refless-stream': return reflessStreamScript();` and `case 'framed': return framedScript();`;
    - `case 'rangeless'` — Gemini's shape, commented "a turn's audio attributed to its segment, but no range: replay, no karaoke":

      ```ts
          return {
            blocks: [
              exchange({ startAt: 500, ref: 1, source: ['Hello', 'Hello, how are you?'], translation: 'こんにちは、お元気ですか？', origin: 'g1', audioChunks: 3, ranged: false }),
              exchange({ startAt: 5000, ref: 3, source: ['I am fine.'], translation: '元気です。', origin: 'g2', audioChunks: 2, ranged: false }),
            ],
          };
      ```

    - `case 'reconnect'`, commented "a transport that drops and comes back mid-run: the leg shows reconnecting, then goes on; refs are never reused across a reconnect":

      ```ts
          return {
            blocks: [
              exchange({ startAt: 500, ref: 1, source: ['Hello', 'Hello there.'], translation: 'こんにちは。', origin: 'c1', audioChunks: 2 }),
              { startAt: 3000, steps: [{ at: 0, reconnecting: true }, { at: 1500, reconnected: true }] },
              exchange({ startAt: 5000, ref: 3, source: ['Still here?'], translation: 'まだいますか？', origin: 'c2', audioChunks: 1 }),
            ],
          };
      ```
  - `settings.ts`:
    - `FakeSettings` gains `/** The participant leg's script; 'same' plays `script` on both legs. */ participantScript: FakeScriptName | 'same';`, with the default `'same'`;
    - the migrate gains `participantScript: stored.participantScript === 'same' ? 'same' : FAKE_SCRIPT_NAMES.find((name) => name === stored.participantScript) ?? 'same'`.
  - `provider.ts`, `build`'s script: `fakeScript(shared.reversed(context.direction) && s.participantScript !== 'same' ? s.participantScript : s.script)`, commented "the participant leg plays its own script when one is chosen (F10): a different shape per leg". The parameters become `(context, s, shared)`.
  - `FakeSettingsView.tsx`, after the Script select:

    ```tsx
          <div className="setting-item">
            <label className="setting-label" htmlFor="fake-participant-script"><span>Other's script</span></label>
            <select
              id="fake-participant-script"
              className="select-dropdown"
              value={settings.participantScript}
              onChange={(e) => update({ participantScript: e.target.value as FakeSettings['participantScript'] })}
              disabled={disabled}
            >
              <option value="same">same</option>
              {FAKE_SCRIPT_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
    ```

- [ ] **Step 4: Run** `npx vitest run src/providers src/lib/session src/components/dev`, then the full suite and the gate.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/fake/script.ts src/providers/fake/synth.ts src/providers/fake/adapter.ts src/providers/fake/adapter.test.ts src/providers/fake/generate.ts src/providers/fake/scripts.ts src/providers/fake/scripts.test.ts src/providers/fake/settings.ts src/providers/fake/provider.ts src/providers/fake/provider.test.ts src/providers/fake/FakeSettingsView.tsx src/providers/fake/FakeSettingsView.test.tsx
  ```

  ```bash
  git commit -q -F - -- src/providers/fake/script.ts src/providers/fake/synth.ts src/providers/fake/adapter.ts src/providers/fake/adapter.test.ts src/providers/fake/generate.ts src/providers/fake/scripts.ts src/providers/fake/scripts.test.ts src/providers/fake/settings.ts src/providers/fake/provider.ts src/providers/fake/provider.test.ts src/providers/fake/FakeSettingsView.tsx src/providers/fake/FakeSettingsView.test.tsx <<'EOF'
  feat(fake): the remaining providers' shapes — ref-less stream, frames, no ranges, a reconnect

  Four scripts (refless-stream, framed, rangeless, reconnect), a tone that
  continues across chunks, and a script per leg; every script plays
  conformant through the kit (Stage 2 foundation, F10).

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

**Group check A (controller, after Waves 1 and 2 — Tasks 1–8).** Against a fresh vite:
1. **The builds.** `npm run build`, `npm run extension:build` and `npx vitest run extension` pass. Then `command grep -rlF 'The fake degraded its speech' build extension/dist` prints nothing.
2. **The gate on the panel (F7).** `node scripts/dev/spine-gate-probe.mjs` passes: the button is disabled, and its title is the participant words.
3. **The probes that must still pass:**
   - `node scripts/dev/app-panel-probe.mjs`;
   - `node scripts/dev/app-panel-probe.mjs --settings`;
   - `node scripts/dev/spine-surface-probe.mjs`;
   - `node scripts/dev/spine-subtitle-probe.mjs`;
   - `node scripts/dev/spine-audio-probe.mjs`, whose line now carries `gaps:`;
   - `node scripts/dev/spine-export-probe.mjs`.
4. **The new scripts, rendered.** For each of `framed`, `rangeless`, `reconnect` and `refless-stream`, run `node scripts/dev/spine-surface-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&script=<name>' 12 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/s2f-<name>.png`.
   - The probe's row-count check is written for the `exchange` script, so record its exit status; do not require it.
   - Look at each screenshot:
     - `framed`'s rows are grouped in pairs, with karaoke lit mid-row;
     - `rangeless` has pairs and no karaoke;
     - `reconnect` shows four rows and the footer passing through reconnecting;
     - `refless-stream` shows each translation in its revised text.
5. **G3 — the measurement, three times** (the controller's ruling; choice 13). Run `node scripts/dev/spine-audio-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&script=refless-stream' 36` three times, each as its own call against the same vite. Record each run's page line and its `steady gaps: … · hiccup gaps: …` line for the roadmap. The decision below reads the **worst** run: the most steady gaps, and separately the most hiccup gaps.
   - **What the queue should do** (`clipQueue.ts:69-86`). A chunk later than `LEAD_S − STARVED_S` (about 39 ms) restarts the queue one lead ahead of now, which inserts a gap about as long as the lateness. The restart also moves the queue's timeline later by that much, so the same stall does not starve it again.
   - **What the script predicts**:
     - **steady: 0**, since the scripted jitter stays at or below 20 ms;
     - **hiccup: 1**: the first 100-ms stall drops out for about 100 ms, and the stalls after it fit in the slack it left.
   - **The decision** (choices 12 and 13):
     - **Task 15 runs** if the worst run shows any steady-phase gap — the queue cannot carry a clean real-time stream in a real browser (timer jitter or clock drift) — or more than one hiccup-phase gap — the queue does not keep the slack a stall gave it.
     - Otherwise the result is as designed and Task 15 is skipped. The roadmap records the three runs' numbers. It also records the latency a stall leaves behind, for Palabra's live test.

---

### Task 9: Migration inputs (F5)

**Files:** Modify `src/lib/provider/types.ts` (`settings.legacyKeys`, `MigrationInputs`, `migrate`'s second argument, `languages.migratePair`), `src/stores/providerStore.ts` (`load`), `src/stores/providerStore.test.ts`.

**Interfaces:**
- **Produces:**
  - `interface MigrationInputs { legacy: Readonly<Record<string, unknown>>; credentials: CredentialValues }`;
  - `settings.legacyKeys?: readonly string[]`;
  - `settings.migrate?(stored: Readonly<Record<string, unknown>>, inputs: MigrationInputs): S`;
  - `languages.migratePair?(stored: LanguagePair, s: S): LanguagePair`.
- **Consumed by:**
  - OpenAI (`turnDetectionMode` → `autoDetection`; `migrateDeprecatedOpenAIModel`);
  - OpenAI Translate (`migrateLegacyTranslateTranscriptModel`);
  - Palabra (`authMode` from its stored value — absent told from default — and the credentials; the pair's `vn` → `vi`, `ba` / `eo` / `ia` → the default).

  Survey §2.5 lists all three.

- [ ] **Step 1: Write the failing tests** in `providerStore.test.ts`, `describe('load')`, over the file's `probe`:
  1. **"reads each legacy key with no default — absent as undefined — and hands them and the credentials to migrate"**:
     - `const migrate = vi.fn((stored: Record<string, unknown>) => stored)`; a probe with `settings: { ...probe.settings, legacyKeys: ['turnDetectionMode', 'on'], migrate }`;
     - `stored.set('settings.probe.turnDetectionMode', 'Semantic')` and `stored.set('settings.probe.apiKey', 'k1')`; `load`;
     - `getSetting` was called with `('settings.probe.turnDetectionMode', undefined)`;
     - `migrate` was called with `({ region: 'us', count: 1, on: false }, { legacy: { turnDetectionMode: 'Semantic', on: undefined }, credentials: { apiKey: 'k1', apiKeyEu: '' } })`.
  2. **"tells a field stored as its default from a field never stored"** — `stored.set('settings.probe.on', false)`, then `load` → `migrate`'s `legacy.on` is `false`, not `undefined`.
  3. **"rewrites the stored pair before it is normalized, so a renamed code lands on its new spelling"**:
     - a probe with `languages: { ...probe.languages, migratePair: (pair: LanguagePair) => ({ ...pair, source: pair.source === 'vn' ? 'fr' : pair.source }) }`;
     - `stored.set('settings.probe.sourceLanguage', 'vn')` and `stored.set('settings.probe.targetLanguage', 'en')` → `entry().pair` is `{ source: 'fr', target: 'en' }`;
     - without `migratePair`, the same stored pair loads as `{ source: 'en', target: 'ja' }` (normalized to the first source).
  4. **"falls back to the initial pair for a side migratePair empties"** — `migratePair: () => ({ source: '', target: '' })` and `initial: () => ({ source: 'ja', target: 'fr' })` → `{ source: 'ja', target: 'fr' }`.
  5. **"hands migratePair '' for a side nothing stored, and the migrated settings"** — a spy `migratePair` → called with `({ source: '', target: '' }, { region: 'us', count: 1, on: false })`.
- [ ] **Step 2: Run** `npx vitest run src/stores/providerStore.test.ts`. Cases 1–5 fail.
- [ ] **Step 3: Implement.**
  - `types.ts`:

    ```ts
    /** What `settings.migrate` may consult besides the stored fields (F5). */
    export interface MigrationInputs {
      /**
       * Every key in `settings.legacyKeys`, as `getSetting` returns it with no
       * default: `undefined` where nothing was ever stored. Chrome storage keeps
       * a value's type; localStorage JSON-parses what it can, so a stored
       * `"123"` or `"true"` arrives as a number or a boolean — a migration
       * compares defensively.
       */
      legacy: Readonly<Record<string, unknown>>;
      /** The saved credential values: every key in `credentials.keys`, '' where nothing is saved. */
      credentials: CredentialValues;
    }
    ```

    In `settings`:

    ```ts
        /**
         * Keys read with no default at load and handed to `migrate` (F5): a setting this
         * version no longer has (OpenAI's `turnDetectionMode`), or a field whose
         * absence must be told from its default (Palabra's `authMode`). May name
         * a field of `defaults`. Nothing is written back.
         */
        legacyKeys?: readonly string[];
        /** Turns what was stored — every field of `defaults`, each read with its default — into this version's `S`. */
        migrate?(stored: Readonly<Record<string, unknown>>, inputs: MigrationInputs): S;
    ```

    In `languages`:

    ```ts
        /**
         * Rewrites the stored pair before it is normalized (F5): a code the
         * provider renamed (Palabra's `vn` → `vi`). '' in a side means nothing
         * is stored there; a side returned as '' falls back to `initial`.
         */
        migratePair?(stored: LanguagePair, s: S): LanguagePair;
    ```

  - `providerStore.ts`, `load`:

    ```ts
        const legacyKeys = p.settings.legacyKeys ?? [];
        const [values, secrets, legacyValues, source, target] = await Promise.all([
          Promise.all(fields.map((f) => service.getSetting<unknown>(storageKey(p, f), defaults[f]))),
          Promise.all(p.credentials.keys.map((k) => service.getSetting(storageKey(p, k), ''))),
          // No default: `undefined` tells "never stored" from "stored as the default" (F5).
          Promise.all(legacyKeys.map((k) => service.getSetting<unknown>(storageKey(p, k), undefined))),
          service.getSetting(storageKey(p, SOURCE), ''),
          service.getSetting(storageKey(p, TARGET), ''),
        ]);
        if (get().entries[p.id]) return;
        const stored = Object.fromEntries(fields.map((f, i) => [f, values[i]]));
        const credentials: CredentialValues = Object.fromEntries(p.credentials.keys.map((k, i) => [k, secrets[i]]));
        const legacy = Object.fromEntries(legacyKeys.map((k, i) => [k, legacyValues[i]]));
        const settings = p.settings.migrate ? p.settings.migrate(stored, { legacy, credentials }) : stored;
        const initial = p.languages.initial?.(settings) ?? {};
        const pair = p.languages.migratePair ? p.languages.migratePair({ source, target }, settings) : { source, target };
        put(p, {
          settings,
          credentials,
          pair: normalizePair(p, settings, { source: pair.source || initial.source, target: pair.target || initial.target }),
        });
    ```

    `migrateFakeSettings(stored)` takes one argument, which the new two-argument signature accepts unchanged.
- [ ] **Step 4: Run** `npx vitest run src/stores src/providers`, then the full suite and the gate.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/lib/provider/types.ts src/stores/providerStore.ts src/stores/providerStore.test.ts
  ```

  ```bash
  git commit -q -F - -- src/lib/provider/types.ts src/stores/providerStore.ts src/stores/providerStore.test.ts <<'EOF'
  feat(provider): migrations read legacy keys, the credentials, and the stored pair

  settings.legacyKeys are read with no default and handed to migrate with
  the credential values; languages.migratePair rewrites a stored pair
  before it is normalized (Stage 2 foundation, F5). Nothing is written back.

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

### Task 10: Models and the account reach a provider's components and its builder (F2, F3)

**Files:**
- Modify:
  - `src/lib/provider/types.ts` (`SettingsProps.models` / `account`, `ProviderAccount`, `SharedSettings.models`);
  - `src/lib/session/types.ts` (`RunShape.shared`), `src/lib/session/shared.ts` (the return type), `src/lib/session/run.ts` (the build's `shared`);
  - `src/stores/providerStore.ts` (`models`, `NO_MODELS`);
  - `src/components/providers/useSelectedProvider.ts` (`models`, `ownProps`), `ProviderOwnSettings.tsx` (`auth`, `account`, `ownProps`), `ProviderPicker.tsx` (the `EngineSummary`'s props), `ProviderPanel.tsx` (passes `auth`);
  - `src/components/Settings/ProviderArea.tsx` (passes `auth`), `src/components/Settings/sections/SpeechSection.tsx` (`ownProps`).
- Tests: `src/lib/session/runner.test.ts`, `src/stores/providerStore.readiness.test.ts`, `src/components/providers/ProviderOwnSettings.test.tsx`, `src/components/providers/ProviderPicker.test.tsx`, `src/providers/fake/provider.test.ts` and `src/providers/localInference/config.test.ts` (`models: []` in their `SharedSettings` literals); create `src/components/providers/useSelectedProvider.test.tsx`.

**Interfaces:**
- **Produces:**
  - `interface ProviderAccount { credentials: CredentialValues; auth: AuthContext }`;
  - `SettingsProps.models?: readonly ModelOption[]` and `SettingsProps.account?: ProviderAccount`;
  - `SharedSettings.models: readonly ModelOption[]`;
  - `RunShape.shared: Omit<SharedSettings, 'models'>`;
  - `ProviderStore.models: Readonly<Record<string, readonly ModelOption[]>>` and `NO_MODELS`;
  - `SelectedProvider.models`;
  - `ownProps(selection: SelectedProvider, entry: ProviderEntry, disabled: boolean | undefined): SettingsProps<unknown>`;
  - `ProviderOwnSettings`'s required prop `auth: AuthContext`.
- **Consumed by:**
  - every model-choosing provider's `effectiveModel(s, models)`, which its `Settings` calls with `props.models` and its `build` with `shared.models` (Gemini, OpenAI, OpenAI Compatible);
  - Soniox's and Kizuna Soniox's voice library (`props.account`).

- [ ] **Step 1: Write the failing tests.**
  - `runner.test.ts`:
    1. **"hands build the models its own readiness check found (F2)"** — `const build = vi.fn(fakeProvider.build)`; `setup({ shape: { provider: { ...fakeProvider, build } as AnyProvider }, ready: { state: 'ready', models: [{ id: 'm2' }, { id: 'm1' }] } })`; `await runner.start()` → `build.mock.calls[0][2].models` equals `[{ id: 'm2' }, { id: 'm1' }]`.
  - `providerStore.readiness.test.ts`:
    2. **"keeps the models of the latest ready answer through a re-check, and empties them on a refusal"**:
       - `check` answers `{ ok: true, models: [{ id: 'm2' }, { id: 'm1' }] }`; `refreshReadiness` → `models.probe` equals them;
       - `updateSettings(p, { mode: 'b' })` → readiness `unknown`, and `models.probe` is unchanged;
       - `check` now answers `{ ok: false, reason: 'no' }`; `refreshReadiness` → `models.probe` is `[]`.
    3. **"empties them for missing credentials, and keeps them through a check that threw"** (choice 3):
       - after a ready answer, `setCredential(p, 'apiKey', '')`, then `refreshReadiness` → `models.probe` is `[]`;
       - on a fresh module: after a ready answer with `[{ id: 'm1' }]`, `updateSettings(p, { mode: 'b' })`, and `check` now throws `new Error('offline')` → after `refreshReadiness`, readiness is `not-ready` and `models.probe` is still `[{ id: 'm1' }]`.
  - `useSelectedProvider.test.tsx` (new; the file mocks `ServiceFactory` as `ProviderOwnSettings.test.tsx` does):
    4. **"hands a provider's components its settings, update, lock, pair and the models its readiness found"**:
       - `useProviderStore.setState({ selected: 'fake', entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } }, models: { fake: [{ id: 'm1' }] } })`;
       - `const { result } = renderHook(() => useSelectedProvider([fakeProvider]))`;
       - `ownProps(result.current!, result.current!.entry!, true)` matches `{ settings: FAKE_DEFAULTS, disabled: true, pair: { source: 'en', target: 'ja' }, models: [{ id: 'm1' }] }`, and its `update` is `result.current!.update`.
    5. **"gives the same empty list while no answer has models"** — `models: {}` → two renders' `ownProps(...).models` are the same object, and `length === 0`.
  - `ProviderOwnSettings.test.tsx`. Every render gains `auth={AUTH}`, with `const AUTH = { signedIn: true, userId: 'u1', getToken: async () => 't' }`. The case "mounts the selected provider's Settings…" also asserts `seen[0].models` equals `[]`. New cases:
    6. **"hands Settings the models and the account: the saved credentials and the sign-in"** — entry `credentials: { apiKey: 'k' }` and store `models: { fake: [{ id: 'm1' }] }` → `seen[0].models` equals `[{ id: 'm1' }]`, and `seen[0].account` equals `{ credentials: { apiKey: 'k' }, auth: AUTH }`.
    7. **"keeps the account's identity while the credentials and the sign-in stay the same"** — `expect(seen[0].account).toBeDefined()`, then `rerender` the same → `seen[1].account` is `seen[0].account`. The first assertion is what makes the case fail before the implementation, when both are `undefined`.
    8. **"hands the TurnDetection Controls and the Engine the models, and no account"** — `ProviderTurnDetectionControls` and `ProviderEngine` with store `models: { fake: [{ id: 'm1' }] }` → `seen[0].models` equals `[{ id: 'm1' }]` and `seen[0].account` is `undefined`.
  - `ProviderPicker.test.tsx`, in the case "shows a provider's EngineSummary…":
    9. `seen[0].models` equals `[]`.
- [ ] **Step 2: Run** `npx vitest run src/lib/session/runner.test.ts src/stores src/components/providers`. Cases 1–9 fail: there is no `shared.models`, no store `models`, no `ownProps`, and no `models` / `account` prop.
- [ ] **Step 3: Implement.**
  - `types.ts`:

    ```ts
    /**
     * What a provider's `Settings` may reach besides its settings (F3): the
     * saved credential values — every key in `credentials.keys` — and the
     * sign-in, for pieces that call the provider's API from Settings (Soniox's
     * voice library, a managed provider's voice source).
     */
    export interface ProviderAccount { credentials: CredentialValues; auth: AuthContext }
    ```

    `SettingsProps<S>` gains:

    ```ts
      /**
       * The models the provider's latest ready answer found (F2), newest
       * first; empty until one has. A model-choosing provider hands them and
       * its settings to its effective-model function, as its `build` does with
       * `shared.models`. Set by every host; absent in a component's own tests.
       */
      models?: readonly ModelOption[];
      /** The provider's account (F3). Set by `ProviderOwnSettings` for `Settings`; absent elsewhere. */
      account?: ProviderAccount;
    ```

    `SharedSettings` gains `/** The models this run's own readiness check found (F2): the list its settings component was shown, for the same effective-model function. */ models: readonly ModelOption[];`.
  - `session/types.ts`: `/** What every builder may read, less `models`, which the run adds from its own readiness answer (F2). */ shared: Omit<SharedSettings, 'models'>;`.
  - `shared.ts`: `buildSharedSettings` returns `Omit<SharedSettings, 'models'>`.
  - `run.ts`, right after the readiness check. Import `type SharedSettings`.

    ```ts
        // The run's own answer (F2): a model-choosing builder reads the list its settings component was shown.
        const shared: SharedSettings = { ...shape.shared, models: readiness.models };
    ```

    The build loop calls `p.build(contexts[leg]!, settings, shared)`.
  - `providerStore.ts`:
    - `export const NO_MODELS: readonly ModelOption[] = [];`;
    - the interface gains `/** The models the latest ready answer found, per provider (F2; choice 3): kept while a re-check runs and through a check that threw, so a model list does not empty on every edit or while offline; emptied when the provider said no or the credentials are missing. */ models: Readonly<Record<string, readonly ModelOption[]>>;`, initially `{}`;
    - in `refreshReadiness`, one helper records an answer. The three places that record one use it: missing credentials, the kept answer, and the final record. The `checking` and cancelled paths do not.

      ```ts
          /** Records an answer: its readiness, and the models it found — none when the provider said no; unchanged when the check could not find out (choice 3). */
          const answered = (readiness: Readiness, foundOut = true): Readiness => {
            if (foundOut && (readiness.state === 'ready' || readiness.state === 'not-ready')) {
              set((st) => ({ models: { ...st.models, [p.id]: readiness.state === 'ready' ? readiness.models : NO_MODELS } }));
            }
            return setReadiness(p, readiness);
          };
      ```

      The `catch` sets `let threw = false` to `true`, and the final record becomes `return answered(answer, !threw)`.

  - `useSelectedProvider.ts`:
    - `SelectedProvider` gains `models: readonly ModelOption[]`, from `useProviderStore((st) => (provider ? st.models[provider.id] : undefined)) ?? NO_MODELS`;
    - add:

      ```ts
      /** The props a provider's own component gets (D18): its settings and `update`, the lock, the pair, and the models its readiness found (F2). `account` is `ProviderOwnSettings`' own. */
      export function ownProps(selection: SelectedProvider, entry: ProviderEntry, disabled: boolean | undefined): SettingsProps<unknown> {
        return { settings: entry.settings, update: selection.update, disabled, pair: entry.pair, models: selection.models };
      }
      ```

  - `ProviderOwnSettings.tsx`. `ProviderOwnSettings` takes `auth: AuthContext`:

    ```tsx
    export function ProviderOwnSettings({ providers, auth, disabled }: ProviderOwnSettingsProps & { auth: AuthContext }) {
      const selection = useSelectedProvider(providers);
      const credentials = selection?.entry?.credentials;
      // One identity while neither changes: a Settings that keys an effect on its account (a voice library) re-runs only then.
      const account = useMemo(() => (credentials ? { credentials, auth } : undefined), [credentials, auth]);
      if (!selection?.entry) return null;
      const Settings = selection.provider.Settings;
      return <Settings {...ownProps(selection, selection.entry, disabled)} account={account} />;
    }
    ```

    - `ProviderTurnDetectionControls` renders `<Controls {...ownProps(selection, selection.entry, disabled)} />`.
    - `ProviderEngine` renders `<Engine {...ownProps(selection, selection.entry, disabled)} legs={legs} initialSlot={initialSlot} onInitialSlotConsumed={onInitialSlotConsumed} />`.
  - `ProviderPicker.tsx`: the `EngineSummary` gets `{...ownProps(selection, entry, disabled)} legs={legs} openSlot={openSlot}`.
  - `ProviderPanel.tsx` passes `auth={auth}` to `ProviderOwnSettings`. `ProviderArea.tsx`'s `SessionSettingsProvider` passes its `auth` (it already calls `useAuthContext()`).
  - `SpeechSection.tsx`, in `ProviderTurnDetection`: `const props = ownProps(selection, selection.entry, locked);`.
  - The two `SharedSettings` literals — `fake/provider.test.ts:12` and `localInference/config.test.ts`'s `shared()` — gain `models: []`.
- [ ] **Step 4: Run** `npx vitest run src/lib src/stores src/components/providers src/components/Settings src/components/dev src/providers`, then the full suite and the gate.
  - **The tests outside this task that render these hosts**, each checked at `507a539a`. Each stays green:
    - `ProviderArea.test.tsx` and `AdvancedSettings.test.tsx`: they render `SessionSettingsProvider`, which already calls `useAuthContext()` and now passes it on.
    - `SpeechSection.test.tsx`: it renders `ProviderTurnDetectionControls`, which takes no `auth`. No test asserts a component's whole props object.
    - The `SharedSettings` literals outside this task's two edited files are `RunShape.shared` values, which now omit `models` by type.
  - If one fails anyway, stop and report it (Global Constraints).
- [ ] **Step 5: Commit.**

  ```bash
  git add src/lib/provider/types.ts src/lib/session/types.ts src/lib/session/shared.ts src/lib/session/run.ts src/lib/session/runner.test.ts src/stores/providerStore.ts src/stores/providerStore.readiness.test.ts src/components/providers/useSelectedProvider.ts src/components/providers/useSelectedProvider.test.tsx src/components/providers/ProviderOwnSettings.tsx src/components/providers/ProviderOwnSettings.test.tsx src/components/providers/ProviderPicker.tsx src/components/providers/ProviderPicker.test.tsx src/components/providers/ProviderPanel.tsx src/components/Settings/ProviderArea.tsx src/components/Settings/sections/SpeechSection.tsx src/providers/fake/provider.test.ts src/providers/localInference/config.test.ts
  ```

  ```bash
  git commit -q -F - -- src/lib/provider/types.ts src/lib/session/types.ts src/lib/session/shared.ts src/lib/session/run.ts src/lib/session/runner.test.ts src/stores/providerStore.ts src/stores/providerStore.readiness.test.ts src/components/providers/useSelectedProvider.ts src/components/providers/useSelectedProvider.test.tsx src/components/providers/ProviderOwnSettings.tsx src/components/providers/ProviderOwnSettings.test.tsx src/components/providers/ProviderPicker.tsx src/components/providers/ProviderPicker.test.tsx src/components/providers/ProviderPanel.tsx src/components/Settings/ProviderArea.tsx src/components/Settings/sections/SpeechSection.tsx src/providers/fake/provider.test.ts src/providers/localInference/config.test.ts <<'EOF'
  feat(provider): the models a check found reach Settings and build; Settings reaches its account

  The store keeps each provider's latest models through a re-check; every
  host hands them to the provider's components through ownProps, and the
  run hands build its own answer in shared.models. Settings gets the saved
  credentials and the sign-in (Stage 2 foundation, F2, F3).

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

### Task 11: The leased fake — `prepare`, `acquire` and `startBoth` (F10)

**Files:**
- Create: `src/providers/fake/leased.ts` (+ `leased.test.ts`), `src/providers/fake/FakeLeasedSettingsView.tsx` (+ `FakeLeasedSettingsView.test.tsx`).
- Modify:
  - `src/providers/fake/settings.ts`: `FakeLeasedSettings`, `FAKE_LEASED_DEFAULTS`, `migrateFakeLeasedSettings`;
  - `src/providers/fake/provider.ts`: its pieces become named exports;
  - `src/providers/fake/FakeSettingsView.tsx`: `toMs` becomes an export both views use;
  - `src/lib/session/types.ts` (`acquire`'s context), `src/lib/session/run.ts` (passes the clock), `src/lib/session/runner.hooks.test.ts`;
  - `src/providers/registry.ts` (`DEV_ONLY`, `ProviderId`), `src/providers/registry.test.ts`.

**Interfaces:**
- **Produces:**
  - `fakeLeasedProvider`: `id: 'fake_leased'`, `kind: 'managed'`, DEV-only;
  - `FakeLeasedSettings = FakeSettings & { prepareFallback: boolean; leaseEndsAfterMs: number; sharedBoth: boolean }`;
  - `SessionHooks.acquire`'s context becomes `{ signal: AbortSignal; clock: Clock; end(notice: RunNotice): void }`;
  - from `provider.ts`: `FAKE_LANGUAGES`, `buildFake`, `checkFake`, `describeFake`, and `startFake<C extends FakeConfig, K>(request: StartRequest<C, K>, events: AdapterEvents): Promise<AdapterSession>`.
- **Consumed by:** Task 12 (the preview), Task 13 (its session test's managed provider), Task 14 (the managed invariant, not vacuous), and Kizuna Soniox's plan (the shape its lease, voice claim and shared Both take).

- [ ] **Step 1: Write the failing tests.**
  - `leased.test.ts`. Signed out is `{ signedIn: false, getToken: async () => null }`, signed in `{ signedIn: true, userId: 'u1', getToken: async () => 't' }`, and `const s = (patch = {}) => ({ ...FAKE_LEASED_DEFAULTS, ...patch })`.
    1. **"is managed, with no credential field"** — `fakeLeasedProvider.kind === 'managed'`, `credentials.keys` is `[]`, and `credentials.fields(s())` is `[]`.
    2. **"reads from the sign-in: signed out it is missing with sign_in_required; signed in it reads"** — `read({}, signedOut)` equals `{ missing: 'Sign in to use the leased fake.', code: 'sign_in_required' }`; `read({}, signedIn)` has no `missing`.
    3. **"prepare answers with the fallback notice only when asked"** — `session.prepare(shape, s(), signal)` resolves `{}`; with `prepareFallback: true` it resolves `{ notice: { code: 'voice_fallback', message: 'The leased fake used its fallback voice (knob).' } }`.
    4. **"acquire gives each leg its own credentials and releases once"** — `const lease = await acquire(shape, s(), { signal, clock, end })` → `lease.credentials('speaker')` equals `{ leg: 'speaker' }`, and `('participant')` equals `{ leg: 'participant' }`; `await lease.release(); await lease.release()` resolves.
    5. **"acquire ends the run on the run's clock with budget_exhausted, and not once released"**:
       - `leaseEndsAfterMs: 1000`; `clock.advance(999)` → `end` not called; `clock.advance(1)` → `end` called once with `{ code: 'budget_exhausted', message: 'Lease ended by the leased fake (knob).' }`;
       - a second lease released before 1 000 ms → after `clock.advance(2000)`, its `end` is never called.
    6. **"acquire refuses a cancelled start"** — with an aborted signal → it rejects.
    7. **"startBoth, shared: stopping either leg stops both"**:
       - the requests are built by `fakeLeasedProvider.build(ctx, s({ sharedBoth: true }), shared)` per direction, where `shared` is `fake/provider.test.ts`'s literal (with `models: []`) and `reversed` answers true for the participant's direction. The events come from `recordEvents()` per leg; each request carries the test's virtual `clock` and a live signal;
       - `await sessions.speaker.stop(); clock.advance(10_000)` → the participant's log gains nothing after the stop.
    8. **"startBoth, split: the legs stay apart"** — `sharedBoth: false` → stopping the speaker leaves the participant playing: its log grows on `clock.advance(10_000)`.
    9. **"startBoth opens nothing when a leg fails: the leg that did start is stopped, and the failure is thrown"** — the participant's config has `startThrows: 'The fake failed to start (fault knob).'` → `startBoth` rejects with that message, and the speaker's events log stays empty after `clock.advance(10_000)`.
    10. **"runs end to end through the runner"**. The file builds its own runner. `runner.hooks.test.ts`'s `setup()` is private to that file, so copy its ports:

        ```ts
        const clock = createVirtualClock(0);
        const shape: RunShape = {
          provider: fakeLeasedProvider as AnyProvider,
          settings: s({ prepareFallback: true, leaseEndsAfterMs: 3000 }),
          credentials: {},
          pair: { source: 'en', target: 'ja' },
          legs: ['speaker'],
          turnMode: 'auto',
          textOnly: false,
          participantSpeech: false,
          keepReplayAudio: true,
          shared: { instructions: () => '', pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
          auth: signedIn,
        };
        const runner = createRunner({
          clock, platform: 'electron', readShape: () => shape,
          ensureReady: async () => ({ state: 'ready', models: [] }),
          persistIfUnchanged: () => {},
          openSource: async () => createFakeSource(clock),
          playback: { audio: () => {}, held: () => {}, clear: () => {}, live: () => {} },
          analytics: { track: () => {} },
          newSessionId: () => 'run1',
          timeoutMs: 1000,
        });
        ```

        - `await runner.start()` → `runner.state.getState().phase` is `'running'`;
        - `runner.conversation.snapshot()[0].notices` holds one with `code: 'voice_fallback'`;
        - `clock.advance(3000)`, then `await flush()` (`() => new Promise((r) => setTimeout(r, 0))`). The lease's `end` closes the run asynchronously, as `runner.hooks.test.ts:147-148` also waits for. The state then matches `{ phase: 'idle', lastEnd: { reason: 'lease-ended', notice: { code: 'budget_exhausted' } } }`.
  - `FakeLeasedSettingsView.test.tsx`:
    11. **"draws the fake's own controls and the three hook knobs"**:
        - `screen.getByLabelText('Script')` exists;
        - clicking the switch named `'Prepare answers with a fallback'` → `update` with `{ prepareFallback: true }`;
        - `'Share one session in Both'` → `{ sharedBoth: false }`;
        - changing `'Lease ends after (ms, 0 = never)'` to `'3000'` → `{ leaseEndsAfterMs: 3000 }`.
  - `runner.hooks.test.ts`, `describe('runner — acquire')`:
    12. **"hands acquire the run's clock"** — `acquire: async (_s, _v, ctx) => { seen = ctx.clock; return { credentials: () => ({}), release: async () => {} }; }` → `seen` is the setup's `clock`.
  - `registry.test.ts`:
    - "includes the fake in development builds, on every platform" also expects `getProvider('fake_leased')` to be `fakeLeasedProvider`, present on every platform with `kizuna: true`;
    - "leaves the fake out of release builds" also expects no `'fake_leased'`.
- [ ] **Step 2: Run** `npx vitest run src/providers src/lib/session/runner.hooks.test.ts`. Every new case fails.
- [ ] **Step 3: Implement.**
  - `session/types.ts`: `acquire?(shape: RunShape, s: S, ctx: { signal: AbortSignal; /** The run's clock: a lease's timers read it. */ clock: Clock; end(notice: RunNotice): void }): Promise<Resources<K>>;`, with `import type { Clock } from '../contract/clock'`.
  - `run.ts`: `p.session.acquire(shape, settings, { signal: this.signal, clock: deps.clock, end: … })`.
  - `provider.ts`. The definition's pieces become named exports, with no module-scope call and no spread:
    - `export const FAKE_LANGUAGES: Provider<FakeSettings, FakeCredentials, FakeConfig>['languages'] = { sources: …, targets: … }`;
    - `export function checkFake(_k: unknown, s: FakeSettings): Promise<CheckResult>`;
    - `export function buildFake(context: SessionContext, s: FakeSettings, shared: SharedSettings): FakeConfig | ProviderRefusal` — Task 8's body;
    - `export const describeFake = () => ({ asrModel: 'fake', translationModel: 'fake', ttsModel: 'fake' })`;
    - `startFake`:

      ```ts
      /** The fake's adapter, built on the first start (never at module scope: D24). Generic, so the leased fake's wider config and credentials pass through. */
      export function startFake<C extends FakeConfig, K>(request: StartRequest<C, K>, events: AdapterEvents): Promise<AdapterSession> {
        return (adapter ??= createFakeAdapter()).start(request as unknown as StartRequest<FakeConfig, FakeCredentials>, events);
      }
      ```

    `fakeProvider` references them: `languages: FAKE_LANGUAGES`, `check: checkFake`, `build: buildFake`, `describe: describeFake`, `start: startFake`.
  - `settings.ts`:

    ```ts
    /** The leased fake's settings: the fake's, and its session hooks' knobs (choice 1). `requireKey` does nothing on it: a managed provider has no field. */
    export type FakeLeasedSettings = FakeSettings & {
      /** `prepare` answers with a `voice_fallback` notice, as a managed voice claim that fell back. */
      prepareFallback: boolean;
      /** The lease ends the run this long after it is acquired, in ms (`budget_exhausted`); 0 = never. */
      leaseEndsAfterMs: number;
      /** Both legs on one shared session (`startBoth` ties them), as Soniox's shared Both; off, two. */
      sharedBoth: boolean;
    };

    // Written out, not spread from FAKE_DEFAULTS: a module-scope spread of an import may be kept by the bundler (D24).
    export const FAKE_LEASED_DEFAULTS: FakeLeasedSettings = {
      script: 'exchange', participantScript: 'same', requireKey: false, checkFails: false, buildRefused: false,
      startThrows: false, startDelayMs: 0, failAfterMs: 0,
      prepareFallback: false, leaseEndsAfterMs: 0, sharedBoth: true,
    };

    export function migrateFakeLeasedSettings(stored: Readonly<Record<string, unknown>>): FakeLeasedSettings {
      const leaseEnds = stored.leaseEndsAfterMs;
      return {
        ...migrateFakeSettings(stored),
        prepareFallback: typeof stored.prepareFallback === 'boolean' ? stored.prepareFallback : FAKE_LEASED_DEFAULTS.prepareFallback,
        leaseEndsAfterMs: typeof leaseEnds === 'number' && Number.isFinite(leaseEnds) && leaseEnds >= 0 ? leaseEnds : FAKE_LEASED_DEFAULTS.leaseEndsAfterMs,
        sharedBoth: typeof stored.sharedBoth === 'boolean' ? stored.sharedBoth : FAKE_LEASED_DEFAULTS.sharedBoth,
      };
    }
    ```

  - `leased.ts`:

    ```ts
    /**
     * The leased fake (D24; choice 1): the fake's scripts and faults behind the
     * three session hooks a managed provider has — `prepare` (a voice claim
     * that may fall back), `acquire` (a lease: a key per leg, an end on the
     * run's clock) and `startBoth` (shared or split Both) — so the runner's
     * hook paths, a managed provider's readiness, presence and words run
     * without a vendor. Development builds only, like the fake; nothing here
     * runs at module scope.
     */
    import { KeyRound } from 'lucide-react';
    import type { AdapterEvents, AdapterSession, StartRequest } from '../../lib/contract/adapter';
    import type { LegName } from '../../lib/conversation/types';
    import type { Provider, ProviderRefusal } from '../../lib/provider/types';
    import type { FakeConfig } from './adapter';
    import { FakeLeasedSettingsView } from './FakeLeasedSettingsView';
    import { buildFake, checkFake, describeFake, FAKE_LANGUAGES, startFake } from './provider';
    import { FAKE_LEASED_DEFAULTS, migrateFakeLeasedSettings, type FakeLeasedSettings } from './settings';

    /** The leased fake's config: the fake's, and whether `startBoth` ties the legs. */
    export type FakeLeasedConfig = FakeConfig & { tieBoth: boolean };
    /** What a leg's lease minted: which leg it is for. */
    export type FakeLeasedCredentials = { leg?: LegName };

    const isRefusal = (built: FakeConfig | ProviderRefusal): built is ProviderRefusal => typeof (built as ProviderRefusal).refused === 'string';

    /** A session whose `stop` is `stop`: both legs of a shared session go together. */
    function tied(session: AdapterSession, stop: () => Promise<void>): AdapterSession {
      // Delegate explicitly: a FakeSession's methods live on its prototype, which a spread drops.
      return {
        info: session.info,
        appendAudio: (pcm) => session.appendAudio(pcm),
        appendText: (text) => session.appendText(text),
        beginTurn: () => session.beginTurn(),
        endTurn: () => session.endTurn(),
        cancelTurn: () => session.cancelTurn(),
        stop,
      };
    }

    async function startBothLeased(
      requests: Record<LegName, StartRequest<FakeLeasedConfig, FakeLeasedCredentials>>,
      events: Record<LegName, AdapterEvents>,
    ): Promise<Record<LegName, AdapterSession>> {
      const legs: LegName[] = ['speaker', 'participant'];
      const settled = await Promise.allSettled(legs.map((leg) => startFake(requests[leg], events[leg])));
      const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) {
        // Opens nothing on failure: a leg that did start is stopped before the rejection.
        await Promise.all(settled.map((r) => (r.status === 'fulfilled' ? r.value.stop() : undefined)));
        throw failed.reason;
      }
      const [speaker, participant] = settled.map((r) => (r as PromiseFulfilledResult<AdapterSession>).value);
      if (!requests.speaker.config.tieBoth) return { speaker, participant };
      // Shared Both (D23): one session under both legs — stopping either stops both.
      let stopping: Promise<void> | null = null;
      const stopBoth = () => (stopping ??= Promise.all([speaker.stop(), participant.stop()]).then(() => undefined));
      return { speaker: tied(speaker, stopBoth), participant: tied(participant, stopBoth) };
    }

    export const fakeLeasedProvider: Provider<FakeLeasedSettings, FakeLeasedCredentials, FakeLeasedConfig> & { id: 'fake_leased' } = {
      id: 'fake_leased',
      kind: 'managed',
      platforms: ['electron', 'extension', 'web'],
      icon: KeyRound,
      vendor: 'Sokuji',
      settings: { key: 'fakeLeased', defaults: FAKE_LEASED_DEFAULTS, migrate: migrateFakeLeasedSettings },
      Settings: FakeLeasedSettingsView,
      credentials: {
        keys: [],
        fields: () => [],
        read: (_values, auth) => (auth.signedIn ? {} : { missing: 'Sign in to use the leased fake.', code: 'sign_in_required' }),
      },
      check: (_k, s) => checkFake(_k, s),
      languages: FAKE_LANGUAGES,
      speech: 'optional',
      textInput: true,
      boundaries: () => 'provider',
      turns: () => ['auto', 'manual'],
      build: (context, s, shared) => {
        const built = buildFake(context, s, shared);
        return isRefusal(built) ? built : { ...built, tieBoth: s.sharedBoth };
      },
      describe: describeFake,
      start: startFake,
      session: {
        async prepare(_shape, s, signal) {
          if (signal.aborted) throw signal.reason ?? new Error('aborted');
          return s.prepareFallback ? { notice: { code: 'voice_fallback', message: 'The leased fake used its fallback voice (knob).' } } : {};
        },
        async acquire(_shape, s, { signal, clock, end }) {
          if (signal.aborted) throw signal.reason ?? new Error('aborted');
          const cancel = s.leaseEndsAfterMs > 0
            ? clock.setTimeout(() => end({ code: 'budget_exhausted', message: 'Lease ended by the leased fake (knob).' }), s.leaseEndsAfterMs)
            : () => {};
          let released = false;
          return {
            credentials: (leg) => ({ leg }),
            async release() {
              if (released) return;
              released = true;
              cancel();
            },
          };
        },
        startBoth: startBothLeased,
      },
    };
    ```

    The message `'Lease ended by the leased fake (knob).'` is group check B's D24 sentinel for this module.
  - `FakeLeasedSettingsView.tsx` renders `<FakeSettingsView {...props} />` (a `SettingsProps<FakeLeasedSettings>` is assignable to it: `update` is a method, and `FakeLeasedSettings` extends `FakeSettings`). Then a `settings-section` headed `<h2>Leased fake</h2>` with:
    - a `ToggleSwitch` labelled `'Prepare answers with a fallback'` → `{ prepareFallback: !settings.prepareFallback }`;
    - a `ToggleSwitch` labelled `'Share one session in Both'` → `{ sharedBoth: !settings.sharedBoth }`;
    - a number input labelled `'Lease ends after (ms, 0 = never)'` → `{ leaseEndsAfterMs: toMs(value) }`. `toMs` moves from `FakeSettingsView.tsx` to an exported helper in the same file, and both views use it.

    The copy is not localized (development builds only), as `FakeSettingsView` says.
  - `registry.ts`: `import { fakeLeasedProvider } from './fake/leased';`, `const DEV_ONLY = [fakeProvider, fakeLeasedProvider] as const;`. The comment: "Compiled into development builds only (D24): the fake, and the leased fake that carries the session hooks (Stage 2 foundation, choice 1)".
- [ ] **Step 4: Run** `npx vitest run src/providers src/lib/session src/app src/components/dev`, then the full suite and the gate.
  - The leased fake now shows in the development build's picker. No test outside this task counts the providers, checked at `507a539a`:
    - `SpinePreview.test.tsx`'s "shows the providers this build offers" waits for the fake's Script field only;
    - `localInference/provider.test.ts:96` checks only that LocalInference is first;
    - `storedSettings.test.ts:53` builds its own list.

    If one fails anyway, stop and report it (Global Constraints).
- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/fake/leased.ts src/providers/fake/leased.test.ts src/providers/fake/FakeLeasedSettingsView.tsx src/providers/fake/FakeLeasedSettingsView.test.tsx src/providers/fake/FakeSettingsView.tsx src/providers/fake/settings.ts src/providers/fake/provider.ts src/lib/session/types.ts src/lib/session/run.ts src/lib/session/runner.hooks.test.ts src/providers/registry.ts src/providers/registry.test.ts
  ```

  ```bash
  git commit -q -F - -- src/providers/fake/leased.ts src/providers/fake/leased.test.ts src/providers/fake/FakeLeasedSettingsView.tsx src/providers/fake/FakeLeasedSettingsView.test.tsx src/providers/fake/FakeSettingsView.tsx src/providers/fake/settings.ts src/providers/fake/provider.ts src/lib/session/types.ts src/lib/session/run.ts src/lib/session/runner.hooks.test.ts src/providers/registry.ts src/providers/registry.test.ts <<'EOF'
  feat(fake): a leased fake carries prepare, acquire and startBoth

  fake_leased (kind 'managed', development builds only) plays the fake's
  scripts behind a voice claim that may fall back, a lease with a key per
  leg that can end the run, and shared or split Both; acquire now gets the
  run's clock (Stage 2 foundation, F10; choices 1-2).

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

### Task 12: The preview signs in and plays either fake

**Files:** Modify `src/app/useAppSession.ts` (+ `useAppSession.test.tsx`) and `src/components/dev/SpinePreview.tsx` (+ `SpinePreview.test.tsx`).

**Interfaces:**
- **Produces:**
  - `useAppSessionBridges(refetchQuota?: () => Promise<void>, standIn?: AuthContext): AuthContext` — with `standIn`, the session and the panel get it instead of the page's real sign-in;
  - the preview's `&signedin=1` — a signed-in stand-in with no network: `{ signedIn: true, userId: 'preview', getToken: async () => 'preview-token' }`;
  - `&script=` applies to the selected fake (`fake` or `fake_leased`).
- **Consumed by:** group check B, and Kizuna Soniox's plan for its rendering checks.
- **The limit:** the stand-in reaches the session — the runner's shape and the readiness driver — and `ProviderPanel`, which is handed `auth`. It does not reach the blocks `&settings=simple|advanced` draws: `SessionSettingsGeneral` and `SessionSettingsProvider` read the real sign-in through `useAuthContext()` (`src/components/Settings/ProviderArea.tsx:25,41`). No check here uses that combination. Kizuna Soniox's plan, which renders its account row there, must route the stand-in first (listed in "What this plan leaves").

- [ ] **Step 1: Write the failing tests.**
  1. `useAppSession.test.tsx`: **"hands the session a stand-in sign-in when given one"** — `const standIn = { signedIn: true, userId: 'preview', getToken: async () => 'x' }` → `renderHook(() => useAppSessionBridges(undefined, standIn), { wrapper: ToastProvider })`, and `result.current` is `standIn`.
  2. `SpinePreview.test.tsx`: **"&signedin=1 hands the session a signed-in stand-in"**:
     - `const spy = vi.spyOn(getAppSession(), 'setBridges')`; the URL is `/?preview=spine&signedin=1`; render;
     - `spy` was called with `expect.objectContaining({ auth: expect.objectContaining({ signedIn: true, userId: 'preview' }) })`;
     - restore the spy and the URL.
  3. `SpinePreview.test.tsx`: **"&script= applies to the leased fake when it is the one selected"** — the URL is `/?preview=spine&provider=fake_leased&script=cjk` → `waitFor` until `useProviderStore.getState().entries.fake_leased?.settings` matches `{ script: 'cjk' }`.
- [ ] **Step 2: Run** `npx vitest run src/app/useAppSession.test.tsx src/components/dev/SpinePreview.test.tsx`. Cases 1–3 fail.
- [ ] **Step 3: Implement.**
  - `useAppSession.ts`:

    ```ts
    /** Hands the session the page's sign-in, analytics, toasts and balance refetch; returns the sign-in for the settings panel. `standIn` replaces the sign-in — the preview's `&signedin=1`, for a managed provider with no network. */
    export function useAppSessionBridges(refetchQuota?: () => Promise<void>, standIn?: AuthContext): AuthContext {
      const { isSignedIn, userId, getToken } = useAuth();
      const { trackEvent } = useAnalytics();
      const { showToast } = useToast();
      const real = useMemo(() => ({ signedIn: isSignedIn, userId: userId ?? null, getToken }), [isSignedIn, userId, getToken]);
      const auth = standIn ?? real;
      getAppSession().setBridges({ auth, track: trackEvent as AnalyticsPort['track'], notify: { showToast }, refetchQuota });
      return auth;
    }
    ```

  - `SpinePreview.tsx`:
    - Hoist `const PREVIEW_SIGNED_IN: AuthContext = { signedIn: true, userId: 'preview', getToken: async () => 'preview-token' };`, commented "the preview's stand-in for a signed-in account (`&signedin=1`): a managed provider reads it; nothing calls the backend".
    - In the component: `const auth = useAppSessionBridges(undefined, param('signedin') === '1' ? PREVIEW_SIGNED_IN : undefined);`.
    - In the URL-applied effect, `&script=` targets the selected fake:

      ```ts
          // `&script=<name>`: which script the selected fake plays (`fake` or `fake_leased`; `fake` otherwise).
          const selected = useProviderStore.getState().selected;
          const fake = providers.find((p) => p.id === (selected === 'fake_leased' ? 'fake_leased' : 'fake'));
      ```

    - The component's doc gains `&signedin=1` and the fake choice.
- [ ] **Step 4: Run** `npx vitest run src/app src/components/dev`, then the full suite and the gate.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/app/useAppSession.ts src/app/useAppSession.test.tsx src/components/dev/SpinePreview.tsx src/components/dev/SpinePreview.test.tsx
  ```

  ```bash
  git commit -q -F - -- src/app/useAppSession.ts src/app/useAppSession.test.tsx src/components/dev/SpinePreview.tsx src/components/dev/SpinePreview.test.tsx <<'EOF'
  feat(dev): the preview can stand in for a signed-in account and script either fake

  &signedin=1 hands the session a signed-in stand-in with no network, so
  the leased fake (a managed provider) can start in the preview; &script=
  applies to whichever fake is selected.

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

### Task 13: Readiness for every kind (F1)

**Files:** Modify `src/app/readiness.ts` (+ `readiness.test.ts`), `src/app/session.ts` (+ `session.test.ts`), `src/stores/providerStore.ts` (+ `providerStore.readiness.test.ts`), `src/components/providers/ProviderPicker.tsx` (+ `ProviderPicker.test.tsx`).

**Interfaces:**
- **Produces:**
  - `driveReadiness(deps: ReadinessDriverDeps): () => void`, which replaces `driveLocalReadiness`;
  - `ReadinessDriverDeps` gains `watchSignIn?(onChange: () => void): () => void` and `networkDelayMs?: number`;
  - `NETWORK_READINESS_DELAY_MS = 800`, a judgement value;
  - `ProviderStore.forgetReadiness(p: Pick<AnyProvider, 'id'>): void`;
  - Validate for own-key providers only, tracking `api_key_validated`.
- **The timing** (the controller's ruling; choice 7):
  - An own-key or managed provider is checked at once — on the clock's next turn — when it is selected, when its entry loads, and on a sign-in flip.
  - Every other reset — an edit to its settings, credentials or pair, or the legs changing — waits `NETWORK_READINESS_DELAY_MS` after the last one.
  - A local provider keeps `READINESS_DELAY_MS` for everything, as today.
  - A sign-in flip is signed in ↔ out, or another account (`userId`).
- **Consumed by:**
  - every own-key provider — its readiness and models appear without Validate;
  - every managed provider — it re-checks on a sign-in flip (roadmap 1b → Stage 2).

- [ ] **Step 1: Write the failing tests.**
  - `readiness.test.ts`:
    - Rename to `driveReadiness`, importing `NETWORK_READINESS_DELAY_MS` too. `makeProbe`'s `kind` widens to `'local' | 'own-key' | 'managed'`.
    - The existing local cases keep their names and bodies. They pin that a local provider's path is unchanged: 150 ms from the start, a burst pushed out, a mid-run change held, the selection followed.
    - The network cases count the store's `refreshReadiness`, not the probe's `check`: the store keeps a network provider's ready answer for the same inputs, so `check` alone would not show a second request. At the top, `const realRefresh = useProviderStore.getState().refreshReadiness;`, and `beforeEach` also puts it back (`refreshReadiness: realRefresh`). A network case sets `const refresh = vi.fn(async () => ({ state: 'ready' as const, models: [] }))` with `useProviderStore.setState({ refreshReadiness: refresh })`. `calls(id)` counts `refresh.mock.calls` whose provider has that id.
    - Replace "leaves a networked provider alone: no check, no watch" with:
      1. **"checks an own-key provider at once when it is selected and loaded"** — an own-key probe, selected and loaded; `clock.advance(0)` and a flush → `calls('probe')` is 1.
      2. **"an edit waits for a pause: each reset pushes the check out"**:
         - after case 1's first check, three `useProviderStore.setState({ readiness: { probe: { state: 'unknown' } } })` 300 ms apart (`clock.advance(300)` between them);
         - `clock.advance(NETWORK_READINESS_DELAY_MS - 1)` after the last reset → still 1; `clock.advance(1)` and a flush → 2.
      3. **"a store change before the immediate check does not delay it"** — the probe selected and loaded; before advancing, `useProviderStore.setState({ legs: ['speaker'] })` (a notification that changes nothing) → `clock.advance(0)` and a flush → 1.
      4. **"switching to another loaded own-key provider checks it at once"** — own-key `o1` (selected) and `o2`, both loaded; `advance(0)` → `calls('o1')` is 1; `useProviderStore.setState({ selected: 'o2' })`, `advance(0)` and a flush → `calls('o2')` is 1.
      5. **"a sign-in flip forgets every loaded managed provider's readiness, and checks the selected one at once"**:
         - managed `m` (selected, loaded, `ready`), managed `m2` (loaded, `ready`, not selected) and own-key `o` (loaded, `ready`);
         - `watchSignIn` captures its listener; call it;
         - `readiness.m` and `readiness.m2` are `unknown`, and `readiness.o` is still `ready`;
         - `advance(0)` and a flush → `calls('m')` is 1, and `calls('m2')` and `calls('o')` are 0.
      6. **"stops watching the sign-in on detach"** — the `watchSignIn` off-spy is called once by `detach()`.
  - `providerStore.readiness.test.ts`:
    7. **"forgetReadiness makes readiness unknown and drops a check still running"** — a deferred `check` in flight; `forgetReadiness(p)` → `unknown`; resolve the check → still `unknown`.
    8. **"keeps a managed provider's answer per sign-in (roadmap 1b)"**:
       - a managed probe whose `read` is `(_v, auth) => (auth.signedIn ? {} : { missing: 'Sign in first.', code: 'sign_in_required' })`;
       - `refreshReadiness(p, signedIn)` twice → one `check`;
       - with `signedOut` → `not-ready`, `code: 'sign_in_required'`, still one `check`;
       - with `signedIn` again → `ready` from the kept answer, still one `check`.
    9. **"asks again when only the sign-in changed"** — a managed probe whose `read` always succeeds; `signedIn`, then `signedOut` → two `check`s.
  - `session.test.ts`, `describe('attach')`:
    10. **"forgets a managed provider's readiness when the sign-in or the account flips — after the render, not during it"**:
        - `useProviderStore.setState({ selected: 'fake_leased', entries: { fake_leased: { settings: FAKE_LEASED_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } }, readiness: { fake_leased: { state: 'ready', models: [] } } })`; `const detach = session.attach()`;
        - `session.setBridges({ auth: { signedIn: true, userId: 'u1', getToken: async () => 't' } })` → still `ready` synchronously; `await Promise.resolve()` → `unknown`;
        - set `ready` again; the same `setBridges` (signed in, `u1`) and a microtask → still `ready`;
        - `setBridges` signed in as `u2`, and a microtask → `unknown`;
        - `detach()`.
  - `ProviderPicker.test.tsx`:
    11. **"Validate tracks api_key_validated, with the provider's stored spelling and whether it passed"** — the fake; click the `simpleSettings.validate` button; `await waitFor(...)` until `trackEvent` was called with `('api_key_validated', { provider: 'fake', success: true })`. The same with `stored.set('settings.fake.checkFails', true)` gives `success: false`.
    12. **"offers no Validate button for a managed provider: its readiness follows the sign-in"** — `{ ...fakeProvider, id: 'managed-probe', kind: 'managed' as const, settings: { ...fakeProvider.settings, key: 'managedProbe' } }` → after its entry loads, `screen.queryByTitle('simpleSettings.validate')` is `null`.
- [ ] **Step 2: Run** `npx vitest run src/app src/stores src/components/providers`.
  - Cases 1–7 and 10–12 fail: `driveReadiness`, `forgetReadiness`, the sign-in watch and the Validate change do not exist.
  - Cases 8 and 9 pass before the implementation. They are characterization cases: the network cache key already holds `auth.signedIn` (`providerStore.ts:208-210`). They pin the roadmap's "test readiness caching for `kind: 'managed'`, including the `auth.signedIn` part of the cache key" (roadmap 1b → Stage 2).
- [ ] **Step 3: Implement.**
  - `readiness.ts`, in full:

    ```ts
    /**
     * The app's readiness driver (F1; 1e-3 ruling 16 for local providers; the
     * controller's timing ruling). Checks the selected provider, of every
     * kind, while its readiness is unknown, and only while the runner is idle:
     * a change seen mid-run is checked once idle again.
     * - A local provider: every check after `READINESS_DELAY_MS`, as before;
     *   its own inputs changing (`watchReadiness`: LocalInference's
     *   downloads) re-checks it too.
     * - An own-key or managed provider: at once — on the clock's next turn,
     *   never inside a store's notification — when it is selected, when its
     *   entry loads, and on a sign-in flip; every other reset (an edit to its
     *   settings, credentials or pair; other legs) after
     *   `NETWORK_READINESS_DELAY_MS`, so typing a key checks once per pause.
     * - A sign-in flip forgets every loaded managed provider's readiness.
     */
    import type { Clock } from '../lib/contract/clock';
    import type { AnyProvider, AuthContext } from '../lib/provider/types';
    import type { Runner } from '../lib/session/runner';
    import { useProviderStore } from '../stores/providerStore';

    export const READINESS_DELAY_MS = 150;
    /** A judgement, not a measurement (choice 7): a pause in typing. */
    export const NETWORK_READINESS_DELAY_MS = 800;

    export interface ReadinessDriverDeps {
      runner: Pick<Runner, 'state'>;
      providers(): readonly AnyProvider[];
      auth(): AuthContext;
      clock: Pick<Clock, 'setTimeout'>;
      /** Calls back on every sign-in flip; returns the unsubscribe. Absent: no sign-in is watched. */
      watchSignIn?(onChange: () => void): () => void;
      delayMs?: number;
      networkDelayMs?: number;
    }

    export function driveReadiness({ runner, providers, auth, clock, watchSignIn, delayMs = READINESS_DELAY_MS, networkDelayMs = NETWORK_READINESS_DELAY_MS }: ReadinessDriverDeps): () => void {
      let cancel: (() => void) | null = null;
      /** The pending check was scheduled at once: a later reset reads the same live inputs when it runs, so it is not pushed out. */
      let pendingAtOnce = false;
      let watched: { id: string; off: () => void } | null = null;
      /** The selected provider whose loaded entry was last evaluated: any other one is just selected, or just loaded. */
      let seen: string | null = null;
      /** Its inputs changed while a run was on: check once the runner is idle again. */
      let stale = false;
      const idle = () => runner.state.getState().phase === 'idle';
      const current = (): AnyProvider | undefined => {
        const { selected, entries } = useProviderStore.getState();
        const p = providers().find((candidate) => candidate.id === selected);
        return p && entries[p.id] ? p : undefined;
      };
      const check = () => {
        cancel = null;
        pendingAtOnce = false;
        const p = current();
        if (p && idle()) void useProviderStore.getState().refreshReadiness(p, auth());
      };
      const schedule = (p: AnyProvider, atOnce: boolean) => {
        if (pendingAtOnce) return;
        cancel?.();
        pendingAtOnce = atOnce && p.kind !== 'local';
        cancel = clock.setTimeout(check, p.kind === 'local' ? delayMs : pendingAtOnce ? 0 : networkDelayMs);
      };
      const inputsChanged = () => {
        const p = current();
        if (!p) return;
        if (idle()) schedule(p, false);
        else stale = true;
      };
      const evaluate = () => {
        const p = current();
        if (watched?.id !== p?.id) {
          watched?.off();
          watched = p ? { id: p.id, off: p.watchReadiness?.(inputsChanged) ?? (() => {}) } : null;
        }
        if (!p || !idle()) return;
        const fresh = p.id !== seen;
        seen = p.id;
        const readiness = useProviderStore.getState().readiness[p.id];
        if (stale || !readiness || readiness.state === 'unknown') {
          stale = false;
          schedule(p, fresh);
        }
      };
      const signInChanged = () => {
        const { entries, forgetReadiness } = useProviderStore.getState();
        for (const p of providers()) if (p.kind === 'managed' && entries[p.id]) forgetReadiness(p);
        // Forgetting notified `evaluate`, which scheduled an edit's delay: a flip checks at once.
        const p = current();
        if (p?.kind === 'managed' && idle()) {
          cancel?.();
          cancel = null;
          pendingAtOnce = false;
          schedule(p, true);
        }
      };
      const offStore = useProviderStore.subscribe(evaluate);
      const offRun = runner.state.subscribe(evaluate);
      const offSignIn = watchSignIn?.(signInChanged) ?? (() => {});
      evaluate();
      return () => {
        offStore();
        offRun();
        offSignIn();
        watched?.off();
        watched = null;
        cancel?.();
        cancel = null;
        pendingAtOnce = false;
      };
    }
    ```

  - `providerStore.ts`: `forgetReadiness` joins the returned object, reusing the internal one. The interface doc: "Forgets what `check` answered for `p` — a sign-in flip, for a managed provider: readiness is unknown, and a check still running no longer counts."
  - `session.ts`:

    ```ts
      /** Heard when the sign-in or the account flips (F1): the readiness driver forgets managed providers' answers. */
      const signInWatchers = new Set<() => void>();
    ```

    - In `setBridges`, before the assignment loop: `const signedIn = bridges.auth.signedIn; const userId = bridges.auth.userId ?? null;`. After it:

      ```ts
          // A microtask later: `useAppSessionBridges` calls this while React renders, and a store write there would update other components mid-render.
          if (bridges.auth.signedIn !== signedIn || (bridges.auth.userId ?? null) !== userId) {
            queueMicrotask(() => { for (const watcher of [...signInWatchers]) watcher(); });
          }
      ```

    - In `attach()`: `driveReadiness({ runner, providers: () => presentProviders(), auth: () => bridges.auth, clock, watchSignIn: (fn) => { signInWatchers.add(fn); return () => { signInWatchers.delete(fn); }; } })`.
    - `AppSession.attach`'s doc: "local readiness" becomes "readiness for every kind, and the sign-in's flips".
  - `ProviderPicker.tsx`:

    ```tsx
              onCheck={provider.kind === 'own-key' ? () => {
                void refreshReadiness(provider, auth).then((answer) => {
                  // Today's event (ProviderSection.tsx's handleValidateApiKey), for the button a person pressed.
                  trackEvent('api_key_validated', {
                    provider: storedProviderValue(provider.id),
                    success: answer.state === 'ready',
                    ...(answer.state === 'not-ready' && answer.code ? { error_type: answer.code } : {}),
                  });
                });
              } : undefined}
    ```

    The comment above says "a local provider checks itself, and a managed one follows the sign-in (F1): only an own-key provider offers Validate".
- [ ] **Step 4: Run** `npx vitest run src/app src/stores src/components src/lib/session`, then the full suite and the gate.
  - **The tests outside this task that attach the root with a provider selected**, each checked at `507a539a`. Each stays green:
    - `src/app/AppSessionRoot.test.tsx`: its virtual clock is never advanced, so the fake's immediate check never fires.
    - `src/components/SettingsInitializer/SettingsInitializer.test.tsx` (read-only, controller ruling 1): it selects LocalInference, whose local path is unchanged.
    - `src/components/dev/SpinePreview.test.tsx`: on the real clock, the fake's immediate check runs inside one task — `checking`, then `ready`, before any other task reads it. So `canStart` is never seen false, and the Start cases still start.
    - `session.test.ts`'s other cases load the fake. The ones that advance the clock do so during a run or its ending, when the driver checks nothing.
  - If one of them fails anyway, stop and report it with its output (Global Constraints). Do not edit it.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/app/readiness.ts src/app/readiness.test.ts src/app/session.ts src/app/session.test.ts src/stores/providerStore.ts src/stores/providerStore.readiness.test.ts src/components/providers/ProviderPicker.tsx src/components/providers/ProviderPicker.test.tsx
  ```

  ```bash
  git commit -q -F - -- src/app/readiness.ts src/app/readiness.test.ts src/app/session.ts src/app/session.test.ts src/stores/providerStore.ts src/stores/providerStore.readiness.test.ts src/components/providers/ProviderPicker.tsx src/components/providers/ProviderPicker.test.tsx <<'EOF'
  feat(app): readiness is checked for every kind; a sign-in flip re-checks managed providers

  driveReadiness checks the selected provider whatever its kind: a network
  provider at once when selected, loaded or signed in or out, and 800 ms
  after the last edit otherwise; a sign-in or account flip forgets every
  managed provider's answer. Validate is an own-key provider's, and
  tracks api_key_validated again (Stage 2 foundation, F1).

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

### Task 14: Registry invariants and the locale key (F17; controller ruling 2)

**Files:** Modify `src/lib/provider/types.ts` (`i18nKey`), `src/providers/registry.test.ts`, `src/components/providers/ProviderPicker.tsx` (+ `ProviderPicker.test.tsx`), `src/providers/localInference/provider.ts`.

**Interfaces:**
- **Produces:**
  - `Provider.i18nKey?: string`;
  - LocalInference's `i18nKey: 'local_inference'`;
  - the picker reads `providers.<p.i18nKey ?? p.id>.*`;
  - the invariants every Stage 2 provider meets.
- **Consumed by:** OpenAI Compatible's plan (`i18nKey: 'openaiCompatible'`), and every provider plan (the invariants, and one line in the release-order case).

- [ ] **Step 1: Write the failing tests.**
  - `ProviderPicker.test.tsx`:
    1. **"reads a provider's name under its i18nKey when it has one"** — `{ ...fakeProvider, id: 'openai_compatible', i18nKey: 'openaiCompatible', settings: { ...fakeProvider.settings, key: 'openaiCompatible' } }` → `await screen.findByRole('option', { name: 'providers.openaiCompatible.name' })`.

    The existing case "reads LocalInference's option under the old enum's spelling" passes through `i18nKey` now.
  - `registry.test.ts`, a new `describe('the invariants every provider meets (F17)')`. Imports: `en` (`../locales/en/translation.json`), `LEGACY_SLICE_KEYS`, `storedProviderValue`, `normalizePair`, and the fakes. `const DEV_ONLY_IDS = ['fake', 'fake_leased'];` `const released = PROVIDERS.filter((p) => !DEV_ONLY_IDS.includes(p.id));`, and an `at(tree, path)` helper as in `noticeText.test.ts`.
    2. **"every released id is the old Provider enum's spelling (controller ruling 2)"** — for each of `released`, `Object.keys(LEGACY_SLICE_KEYS)` contains `storedProviderValue(p.id)`.
    3. **"a provider that existed before keeps its storage prefix"** — for each of `released`, `p.settings.key` is `LEGACY_SLICE_KEYS[storedProviderValue(p.id)]`: no user's saved settings move (spec: "`settings.key` is today's slice key").
    4. **"every released provider has a name and a description in en, under its locale key"** — `at(en, `providers.${p.i18nKey ?? p.id}.name`)` and `.description` are non-empty strings. The two fakes are exempt (D24: never localized).
    5. **"every credential field's label and placeholder are sentences in en"** — for each `p` of `PROVIDERS`, over `p.credentials.fields(p.settings.defaults)` and, as a positive control, `fakeProvider.credentials.fields({ ...FAKE_DEFAULTS, requireKey: true })`: `at(en, f.labelKey)` is a string, and so is `f.placeholderKey`'s when present.
    6. **"a managed provider has no credential field and reads from the sign-in"** — for each managed `p` (the leased fake makes this non-vacuous):
       - `p.credentials.keys` is `[]` and `p.credentials.fields(p.settings.defaults)` is `[]`;
       - `p.credentials.read({}, signedOut)` matches `{ missing: expect.any(String), code: 'sign_in_required' }`;
       - `p.credentials.read({}, signedIn)` has no `missing`.
    7. **"an own-key provider reads its empty fields as missing"** — for each own-key `p`, with `s = p.settings.defaults` plus, as a positive control, the fake with `requireKey: true`: when `p.credentials.fields(s)` is non-empty, reading every field as `''` gives a `missing`.
    8. **"migrate turns the defaults, stored as they are, into the defaults"** — for each `p` with `settings.migrate`, `p.settings.migrate(p.settings.defaults, { legacy: {}, credentials: Object.fromEntries(p.credentials.keys.map((k) => [k, ''])) })` equals `p.settings.defaults`.
    9. **"an initial pair is one the provider offers"** — for each `p` with `languages.initial`, `const initial = p.languages.initial(p.settings.defaults)` → `normalizePair(p, p.settings.defaults, initial)` equals `initial`.
    10. **"the release offers its providers in the owner's order"** — with `vi.stubEnv('DEV', false)` and a fresh import, `released.PROVIDERS.map((p) => p.id)` equals `['localInference']`. The comment: "each provider plan adds its id where the owner orders it (spec: 'one line in the order test')".
    11. **"a development build adds exactly the two fakes"** — `PROVIDERS.map((p) => p.id)` equals `[...released ids, 'fake', 'fake_leased']`.
- [ ] **Step 2: Run** `npx vitest run src/providers/registry.test.ts src/components/providers/ProviderPicker.test.tsx`.
  - Case 1 fails: the picker reads `storedProviderValue`.
  - Case 4 fails for LocalInference until it has `i18nKey`.
  - The others pass on the current registry. Each one's positive control (5, 7) or non-vacuous set (6: the leased fake) is what proves the check reads what it claims.
- [ ] **Step 3: Implement.**
  - `types.ts`, after `vendor`:

    ```ts
      /**
       * The segment the provider's locale keys sit under, when the catalogs
       * spell it otherwise than `id` (controller ruling 2): `providers.<i18nKey
       * ?? id>.name` and `.description`. LocalInference's is `local_inference`,
       * OpenAI Compatible's will be `openaiCompatible`.
       */
      i18nKey?: string;
    ```

  - `localInference/provider.ts`: `i18nKey: 'local_inference',`.
  - `ProviderPicker.tsx`, in `renderProviderOption`:
    - `const localeKey = p.i18nKey ?? p.id;`, used for the name and the description;
    - `storedProviderValue` stays for the dismissal key and the analytics;
    - the comment above it says the locale key comes from the definition.
- [ ] **Step 4: Run** `npx vitest run src/providers src/components/providers src/components/Settings`, then the full suite and the gate.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/lib/provider/types.ts src/providers/registry.test.ts src/components/providers/ProviderPicker.tsx src/components/providers/ProviderPicker.test.tsx src/providers/localInference/provider.ts
  ```

  ```bash
  git commit -q -F - -- src/lib/provider/types.ts src/providers/registry.test.ts src/components/providers/ProviderPicker.tsx src/components/providers/ProviderPicker.test.tsx src/providers/localInference/provider.ts <<'EOF'
  test(providers): the invariants every provider meets; locale keys from the definition

  Ported from descriptorRegistry.test.ts over PROVIDERS: old enum ids and
  slice keys, names and descriptions in en under i18nKey ?? id, managed
  providers read the sign-in, empty own-key fields read missing, migrate
  and initial are identities on the defaults, the release order is pinned
  (Stage 2 foundation, F17; controller ruling 2).

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

**Group check B (controller, after Task 14, and after Task 15 when it ran).** Against a fresh vite:
1. **The builds.** `npm run build`, `npm run extension:build` and `npx vitest run extension` pass. Then each of these prints nothing:
   - `command grep -rlF 'The fake degraded its speech' build extension/dist`
   - `command grep -rlF 'Lease ended by the leased fake' build extension/dist`

   The leased fake is DEV-only through the same literal; its module runs nothing at module scope.
2. **Every probe:**
   - `node scripts/dev/app-panel-probe.mjs`;
   - `node scripts/dev/app-panel-probe.mjs --settings`;
   - `node scripts/dev/app-panel-probe.mjs --app`;
   - `node scripts/dev/spine-surface-probe.mjs`;
   - `node scripts/dev/spine-subtitle-probe.mjs`;
   - `node scripts/dev/spine-audio-probe.mjs`;
   - `node scripts/dev/spine-export-probe.mjs`;
   - `node scripts/dev/spine-gate-probe.mjs`.
3. **The leased fake, signed in.** `node scripts/dev/spine-surface-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&provider=fake_leased&signedin=1'` passes: the exchange script's four rows, through `prepare` and `acquire`.
4. **The leased fake, signed out — F1, F3 and F8 end to end.** `node scripts/dev/spine-gate-probe.mjs 'http://localhost:5199/?preview=spine&panel=1&provider=fake_leased' "Sign in to use Kizuna AI's built-in translation service."` passes. The chain:
   - the driver checks the managed provider after its delay;
   - `read` answers `sign_in_required`;
   - the panel's title carries the alias's words.
5. **After Task 15 only.** `node scripts/dev/spine-audio-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&script=refless-stream' 36 --max-gaps 1` passes in each of three runs.
6. **The app loads.** `http://localhost:5199/` loads with no new warning in the console.

---

### Task 15 (conditional — only if group check A says so): the clip queue's lead grows on an underrun inside one stream (G3)

Run this task only when the worst of group check A's three G3 runs showed a gap in the steady phase, or more than one in the hiccup phase (choice 13). Otherwise skip it; the roadmap records why.

**Files:** Modify `src/lib/audio/clipQueue.ts` (+ `clipQueue.test.ts`) and `src/lib/audio/playback.ts` (+ `playback.test.ts`).

**Interfaces:**
- **Produces:**
  - `new ClipQueue(timeline, leadS = LEAD_S, sameStream?: (previous: K, next: K) => boolean)`;
  - `MAX_LEAD_S = 0.25` and `UNDERRUN_WINDOW_S = 0.25`;
  - the live legs' queues in `playback.ts` treat one segment's clips — or audio that names no segment — as one stream.
- **Consumed by:** every streaming provider (Palabra, OpenAI Translate / Live, AST2, Gemini). One clip is still one speech entry (choice 12), so karaoke and replay are untouched.

- [ ] **Step 1: Write the failing tests.**
  - `clipQueue.test.ts`, with the file's `fakeTimeline` and `pcm`:
    1. **"grows its lead after an underrun inside one stream, and plays on at the new lead"** — `new ClipQueue(timeline, LEAD_S, () => true)`: `enqueue('a', pcm(100))` plays at `LEAD_S`; `advance(0.2)` (a ended at 0.15); `enqueue('b', pcm(100))` plays at `0.2 + 2 * LEAD_S`.
    2. **"a restart that is not an underrun starts at the base lead again"**:
       - after case 1's underrun, `advance(1)` — past the window — then `enqueue('c', …)` plays at `now + LEAD_S`;
       - on another queue, `sameStream: () => false`, an underrun-shaped restart plays at `now + LEAD_S`.
    3. **"never grows past MAX_LEAD_S"** — a first clip (base lead), then three underruns in a row, each clip enqueued 0.05 s after the last ended. The leads are 0.1, 0.2 and then `MAX_LEAD_S`, not 0.4.
    4. **"clear() resets the lead"** — a clip, an underrun (lead `2 * LEAD_S`), then `clear()`. After that, a clip plays at `now + LEAD_S` — a cleared queue has no stream to continue — and an underrun after it plays at `now + 2 * LEAD_S` again, not `4 * LEAD_S`.
    5. **"without a stream predicate the lead never grows"** — `new ClipQueue(timeline)`, an underrun → `now + LEAD_S`, as today.

    The existing cases keep passing: they build queues without a predicate.
  - `playback.test.ts`, with the file's `fakeGraph`:
    6. **"a live leg's queue treats one segment's clips, and audio that names none, as one stream"**:
       - `audio('speaker', 5, pcm(100))`, `advance(0.2)`, `audio('speaker', 5, pcm(100))` → the second play's `at` is `0.2 + 2 * LEAD_S`;
       - on a fresh playback, the same with refs `5` then `6` → `0.2 + LEAD_S`;
       - with `undefined` twice → `0.2 + 2 * LEAD_S`.
- [ ] **Step 2: Run** `npx vitest run src/lib/audio`. Cases 1–4 and 6 fail. Case 5 passes, pinning today's behaviour.
- [ ] **Step 3: Implement.**
  - `clipQueue.ts`:

    ```ts
    /** The most a queue's lead grows to after underruns: a stream that keeps running dry buffers this much before it plays on (G3). */
    export const MAX_LEAD_S = 0.25;
    /** A restart this soon after the last clip ended is an underrun of one stream, not a new utterance. */
    export const UNDERRUN_WINDOW_S = 0.25;
    ```

    - Fields: `private lead: number` (initially `leadS`) and `private lastKey: K | null = null`.
    - The constructor gains `private readonly sameStream?: (previous: K, next: K) => boolean`.
    - `enqueue`'s schedule:

      ```ts
        let at: number;
        if (this.tail > now + STARVED_S) {
          at = this.tail;
        } else {
          // Starved. Inside one stream and right after its last clip, the
          // stream ran dry mid-flow: an underrun, so the lead doubles and the
          // next stall of this size fits in it. Any other restart — a new
          // stream, or one after a pause — starts at the base lead.
          const underrun = this.lastKey !== null && this.sameStream?.(this.lastKey, key) === true && now - this.tail < UNDERRUN_WINDOW_S;
          this.lead = underrun ? Math.min(MAX_LEAD_S, this.lead * 2) : this.leadS;
          at = now + this.lead;
        }
      ```

    - `this.lastKey = key` once the clip is recorded. `clear()` also sets `this.lead = this.leadS; this.lastKey = null;`.
    - The class doc gains a sentence on the adaptive lead, and why it is not coalescing (choice 12).
  - `playback.ts`: the speaker and participant queues are built with

    ```ts
      // One stream: one segment's clips, or audio that names no segment (Palabra's continuous track) — an underrun there grows the lead (G3).
      const sameStream = (a: ClipKey, b: ClipKey) => parseClipKey(a).ref === parseClipKey(b).ref;
    ```

    The replay queue keeps no predicate.
- [ ] **Step 4: Run** `npx vitest run src/lib/audio src/lib/view`, then the full suite and the gate.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/lib/audio/clipQueue.ts src/lib/audio/clipQueue.test.ts src/lib/audio/playback.ts src/lib/audio/playback.test.ts
  ```

  ```bash
  git commit -q -F - -- src/lib/audio/clipQueue.ts src/lib/audio/clipQueue.test.ts src/lib/audio/playback.ts src/lib/audio/playback.test.ts <<'EOF'
  fix(playback): an underrun inside one stream grows the queue's lead

  A live leg's queue that runs dry mid-stream (the same segment's clips,
  or audio that names none) doubles its lead up to 250 ms, so the next
  stall of that size plays on; a clip is still one speech entry (Stage 2
  foundation, G3; group check A's measurement asked for it).

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

### Task 16 (controller): the spec's amendments and the roadmap's record

**Files:** Modify `docs/superpowers/specs/2026-09-22-client-contract-design.md` and `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`.

- [ ] **Step 1: The spec** (controller ruling 6).
  1. **D11's row** (`:89`): "Rewrite, not migrate. New display layer plus one provider end to end, then one provider at a time. **Amended 2026-09-26 (owner):** the old provider code — clients, descriptors, the old settings UI and store slices — stays in the tree as the source each provider is ported from; a provider's old code is deleted once the owner has live-tested its port."
  2. **"Migration"**, the paragraph "The other clients are **deleted** … settings component together." (`:1677-1680`) becomes:

     > **The old provider code stays until each port is live-tested** (owner, 2026-09-26, reversing this section's first version). The clients, their descriptors, the old settings UI and the old store slices remain compiled but unreachable from the new session, as the protocol documentation each Stage 2 step ports from. What lived only in the old MainPanel — the cross-leg orchestration — is read from history (`aecaae2b^:src/components/MainPanel/MainPanel.tsx`). A Stage 2 step writes the provider's definition, adapter and settings component together, and deletes that provider's old code after the owner has run it live.
  3. **"Stage 2 — one provider per change"** (`:1682-1707`) is replaced by the list and order of controller ruling 3, with the ids of ruling 2:

     > **Stage 2 — one provider per change**, after a vendor-free foundation plan (`docs/superpowers/plans/2026-09-26-client-contract-stage2-foundation.md`). LocalInference, the precise extreme, landed in Stage 1. Provider ids are the old `Provider` enum's spellings, so stored selections, analytics and locale keys need no mapping; LocalInference keeps `localInference`, mapped since Stage 1. The order (the owner may overrule it):
     > 1. **Soniox** (`soniox`) — the richest: per-token language, provider timing, definite-split, its own TTS over a second socket, `startBoth`.
     > 2. **Kizuna Soniox** (`kizunaai_soniox`) — the managed composition: the lease, the budget, the voice claim, the balance floor. It may share a plan with Soniox, in two task groups, each with its own live test.
     > 3. **Gemini** (`gemini`) — turn-level origin, no ranges, `boundaries: 'silence'`, reconnect.
     > 4. **Volcengine AST2** (`volcengine_ast2`) — the socket seam's first user, inferred pairing.
     > 5. **OpenAI Translate** (`openai_translate`) — frame-level ranges, our own boundaries, inferred origin.
     > 6. **OpenAI Realtime and OpenAI Compatible** (`openai`, `openai_compatible`) — one settings component, server boundaries, the drift anchor, the typed-text queue.
     > 7. **OpenAI Translate over WebRTC** — the processed track from the runner's graph.
     > 8. **Palabra** (`palabraai`) — the degenerate extreme: `audio` without `ref`, no `range`, the cleanest `origin`.
     > 9. **OpenAI Live** (`openai_live`) — span caps, the `end_ms` timeline.
     > 10. **Local Native** (`local_native`) — LocalInference's sibling on the sidecar. Its `Engine` is a thin wrapper like LocalInference's: the shared `EngineSurface` over the existing `useNativeEngineAdapter`, with the existing `NativeModelManagementSection`, `NativeVoiceSection` and `NativeDeviceControl` — reused, switched from the old `settingsStore` slice to the provider's `settings` / `update` / `pair` (the override `useWasmEngineAdapter` got for LocalInference).
     >
     > **The relay twins** (`kizunaai_openai_translate`, `kizunaai_volcengine_ast2`) are not ported onto the relay: the owner ruled on 2026-08-30 that the user's audio must not flow through Kizuna. Whether they return as direct connections is the owner's decision when their turn comes. If they do, each is `managed(base, …)` over its ported base with a direct-connect `K`.
     >
     > That is twelve providers: ten ported in ten steps — OpenAI Translate's WebRTC transport is a step of its own — and two relay twins held. Each step is its own implementation plan.
  4. **"Managed twins are composition"** (`:1174-1183`):
     - "and the relay endpoint in `K`" becomes "and per-leg keys minted by its lease (`acquire`)";
     - "Removing the relay later touches the three twins and nothing else." becomes "Only Kizuna Soniox is built this way: the backend mints its keys per role, and the audio goes from the device to Soniox directly. The relay twins, whose `K` was a relay endpoint, are not ported (see Migration)."
  5. **"The shape"**, after the code block, a note:

     > **Amended by the Stage 2 foundation plan:** `i18nKey?`; `testerSwitch?`; `settings.legacyKeys?` and `migrate(stored, { legacy, credentials })`; `languages.migratePair?`; `credentials.read` → `K | { missing; code?; params? }`; `AuthContext.userId?`; `SettingsProps.models?` / `account?`; `SharedSettings.models`; and `SessionHooks.acquire`'s context carries the run's `clock`.

     "Where each member goes"'s row `settingsSliceKey`, `i18nKey` → "`settings.key`; locale keys use the id, or `i18nKey` where the catalogs spell it otherwise". "What adding a provider then touches" item 3 becomes "`providers.<id>.name` and `.description` in the 30 locale catalogs — or under the definition's `i18nKey` where the catalogs already spell it otherwise".
  5a. **"Notices reach the user localized"**, a sentence at its end: "A provider's code may reuse a sentence every locale already has through `NOTICE_ALIASES` (`src/lib/view/noticeText.ts`) instead of a `notices.<code>` key of its own."
  5b. **Only if Task 15 ran — "The clip queue"**, a paragraph after "There is no `seal`": "**An underrun inside one stream grows the lead.** A live leg's queue that runs dry within one segment's clips — or within audio that names no segment — doubles its lead, up to `MAX_LEAD_S` (250 ms). A restart that is not an underrun starts at the base lead. One clip is still one speech entry. Measured by the Stage 2 foundation plan's G3 check (numbers in the roadmap)."
  6. **"Open questions"**, a new subsection "Stage 2 — open for the plans that meet them" (survey §3.4):
     - **item 1:** D25's `turns(s)` = manual-only would refuse the participant leg for OpenAI over WebRTC, which today runs its participant over WebSocket — the OpenAI plan decides (`turns(s)` for the speaker leg, the adapter choosing the participant's transport);
     - **item 3:** participant speech against the managed lease, which mints no participant TTS role — the Kizuna Soniox plan;
     - **item 5:** `minimumBalance`, `Resources.budget` and `RunState.running.budget` are in this spec but not yet in the types — the Kizuna Soniox plan;
     - **items 8 and 9 — resolved by the foundation plan** (the controller's ruling), as the shape's note records:
       - item 8 by F3: `credentials.read` may answer with a code, so a managed provider signed out reads `sign_in_required`. `read` stays synchronous, so a managed `K` carries `getToken` and calls it lazily. Kizuna Soniox uses it first.
       - item 9 by F5: `legacyKeys`, the credentials and `migratePair` reach a migration. OpenAI and Palabra use it first.
- [ ] **Step 2: The roadmap.** Append `## Scheduled by the Stage 2 foundation plan`, in the form of the entries before it:
  - **What landed:** the commits and the tasks, and whether Task 15 ran.
  - **What was checked:** group checks A and B, including:
    - the G3 numbers — each of the three runs' page line and steady / hiccup split — and the decision on the worst;
    - the renders of the four new scripts;
    - both fakes absent from the release bundles.
  - **Stated departures:** this plan's self-review list.
  - **What it leaves:** "What this plan leaves" below, verbatim.
  - **Before any release from the branch:**
    - **The release flags.** Production enables Kizuna Soniox and Palabra through the old per-provider flags (`VITE_ENABLE_KIZUNA_SONIOX=true`, `VITE_ENABLE_PALABRA_AI=true`), while `VITE_ENABLED_PROVIDERS` is unset. When those providers move onto the registry, either they are unflagged, or the repo variable lists them (`kizunaai_soniox,palabraai`). It must be settled before any release from the branch.
    - **The registry's order.** The product decision of 2026-09-12 ran Kizuna-managed, Free, Gemini, AST2, OpenAI ×3, Soniox, Compatible, Palabra (survey §2.4.1); the registry today puts LocalInference first (1e-3 ruling 10). The owner decides the final order once, before Kizuna Soniox lands; Task 14's order case pins it.
- [ ] **Step 3: Commit.**

  ```bash
  git add docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md
  ```

  ```bash
  git commit -q -F - -- docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md <<'EOF'
  docs(spec): the old provider code stays until each port is live-tested; Stage 2's order

  D11 and Migration follow the owner's reversal; Stage 2 lists the
  providers by their old ids in the controller's order, with the relay
  twins held; the managed-twin paragraph drops the relay. The roadmap
  records what the foundation plan built and what it leaves.

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

## What this plan leaves — for the plans that meet it

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

## Self-review

**Coverage of the survey's F-pieces, as scoped by the brief:**

| Piece | Where |
|---|---|
| F1, readiness for every kind | Task 13 (driver, sign-in flips, `forgetReadiness`, Validate own-key only, `api_key_validated`); the leased fake makes it end to end (Task 11; group check B item 4) |
| F2, models reach Settings and build | Task 10 (`SettingsProps.models`, the store's `models`, `SharedSettings.models`); `effectiveModel` itself is each model-choosing provider's (spec: "Readiness is one check") |
| F3, credentials with a code, `userId`, the account | Task 7 (the code, `userId`); Task 10 (`account`) |
| F5, migration inputs | Task 9 |
| F6, presence | Task 1 (the umbrella, `testerSwitch`); the release check's invariants (Task 1 case 4; group checks) |
| F7, the live gate | Task 2 (and group check A item 2) |
| F8, notice aliases, `sign_in_required` | Task 3; seen end to end in group check B item 4 |
| F9, the test kit | Task 4; the fake passes it (Tasks 4, 8) |
| F10, the fake's extensions | Task 8 (four scripts, a script per leg); Task 11 (`prepare`, `acquire`, `startBoth` on the leased fake — choice 1) |
| F17, guards | Task 5 (the ledger over `src/providers`, the session side, the kit test-only); Task 14 (the registry invariants, the locale key) |
| G3, streaming audio | Task 6 (the instrument), Task 8 (`refless-stream`), group check A (the measurement and the decision), Task 15 (the conditional fix) |
| Controller ruling 6 | Task 16 |

**Placeholders.** Three are deliberate:
- Task 15 runs only on group check A's result. It is written out in full, with its trigger.
- Task 16's roadmap prose is the controller's, with its contents listed. The spec's amendments are written out.
- Each commit's body is written; the implementer may tighten one but keeps its subject.

**Types across tasks:**

| Produced | Consumed by |
|---|---|
| `testerSwitch`, `PresenceEnv.kizuna` / `switchOn` (Task 1) | `currentPresenceEnv` (Task 1), the leased fake's presence (Task 11), Task 14's invariants |
| `GateInput`, `liveGate` (Task 2) | `appSubtitleSession` (Task 2) |
| `NOTICE_ALIASES` (Task 3) | `noticeText`, and through it `CredentialForm` and the idle surfaces (Tasks 7, 11, 13) |
| `every`, `FakeSocket`, `driveAdapter`, `runScenario`, `createEchoAdapter`, `createBrokenAdapter` (Task 4) | Task 8's `scripts.test.ts`; Task 5's kit rule (the kit's own modules count as test-only) |
| `CredentialsMissing`, `AuthContext.userId` (Task 7) | the leased fake's `read` (Task 11), `ProviderAccount` (Task 10), `useAppSessionBridges`' stand-in (Task 12) |
| `participantScript`, `synthPcm(…, from)`, `REFLESS_STREAM` (Task 8) | `buildFake` (Tasks 8, 11); `REFLESS_STREAM.steadyMs` is the 15-s split `spine-audio-probe.mjs` hard-codes (Task 6, with a comment naming it) |
| `MigrationInputs`, `legacyKeys`, `migratePair` (Task 9) | `migrateFakeLeasedSettings`'s signature (Task 11), Task 14's `migrate` invariant |
| `SettingsProps.models` / `account`, `SharedSettings.models`, `ownProps`, `NO_MODELS` (Task 10) | the hosts (Task 10); the leased fake's views take them (Task 11) |
| `acquire`'s `ctx.clock`, `startFake`, `buildFake`, `FAKE_LANGUAGES` (Task 11) | the leased fake (Task 11) |
| `useAppSessionBridges(…, standIn)` (Task 12) | the preview (Task 12) |
| `driveReadiness`, `forgetReadiness`, `NETWORK_READINESS_DELAY_MS` (Task 13) | `session.attach()` and `setBridges`' sign-in watch (Task 13) |
| `i18nKey` (Task 14) | the picker (Task 14) |

**Stated departures from today:**
- An own-key provider's readiness is checked on its own: at once when it is selected or loaded, and 800 ms after its settings or credentials last changed. Before, only Validate or a start checked it; the old app validated on every change with no delay.
  - One visible effect: with an empty key, the credential form shows "Enter your API key in Settings before starting." and Start is off with that reason as soon as the provider is selected, before anything is typed. The old app showed no verdict until a key was typed or Validate pressed.
- A managed provider shows no Validate button, and is checked again at once when the user signs in or out, or switches account.
- Start is off, with the reason, when the gate would refuse: the participant leg on the web page, a pair that does not reverse (D20), a turn mode the provider does not offer. Before, Start was offered and the start was refused.
- The development build's picker offers a second fake, "the leased fake" (development only).
- The preview's `&mode=`, `&signedin=1`, and `&script=` for either fake.

**Checked against the code while writing** (at `1bfdd362` with plan 1e-3c's Task 1 staged, and again at `507a539a` for the review's fixes):
- the typecheck: 280 lines in the full tree, 15 through the widened regex (the review re-measured it at `6babf7a0`);
- every test outside a task that its change can reach, named in that task's Step 4 (Tasks 2, 11 and 13), with the reason each stays green;
- the suite's totals above;
- `getSetting(key, undefined)` returns `undefined` for an absent key in both storage paths (`SettingsService.ts:26-67`);
- jsdom has `CloseEvent`, `MessageEvent` and `EventTarget`;
- `lucide-react` 0.515 exports `KeyRound`;
- every alias's key exists in `en`, with the sentences quoted above;
- `src/providers` holds no `console.*`, global timer or store import on the session side today.

**Decided by the controller on the review** (each written in where it lands):
1. **G3's trigger:** three runs, the worst decides; Task 15 runs on a steady-phase gap or more than one hiccup gap (choice 13; group check A item 5). One product question stays open, for the owner rather than this plan: a stall longer than the lead drops out once on any player. No dropout at all on a single 100-ms stall would need a larger base lead, which costs every provider latency.
2. **Survey §3.4 items 8 and 9:** recorded as resolved, with `credentials.read` synchronous (Task 16).
3. **Readiness timing:** at once on selection, load and a sign-in flip; 800 ms for edits, a judgement (choice 7; Task 13).
4. **The session-side guard:** `adapter.ts` only, on the spec's word; the hooks may read their own stores (choice 11; Task 5's header).
5. **The kit rule:** test files, the kit, and test-only helpers — modules only test-only modules import (Task 5, case 6).

**Amended after the review** (`stage2-foundation-plan-review.md`):
- **I1:** no step lets a task edit a file outside its Files list. Tasks 2, 11 and 13 name each outside test their change reaches and why it stays green; a failure is reported, not fixed (Global Constraints). Task 13 runs alone after Task 12.
- **I2:** the fake's harness is written out, with a base on refs 1–2. The echo and broken adapters live once in `examples.ts`.
- **Minor findings:**
  - M1: the starting point lists the five files 1e-3c shares.
  - M2: the characterization cases are named as such, or changed to fail first (Tasks 1, 2, 8, 10, 13).
  - M3: Task 1's cases 4–5 have controls.
  - M4, M5: the File Structure and Files lists.
  - M6: Task 11 case 10's runner and flush.
  - M7: the manual context and the broken adapter, written out.
  - M8: choice 11.
  - M9: the kit rule.
  - M10: an account switch is a flip.
  - M11: a thrown check keeps the models.
  - M12: the legacy values' doc.
  - M13: the stand-in's limit.
  - M14: the departure above.
  - M15: Task 16 items 5a–5b.
  - M16: the probe's flag parsing.
  - M17: no hand mutations; Task 5's fixture tree.
