# Client contract — Stage 2 follow-up: session-end lines in the Logs, and the wizard leaves display modes alone

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Standing of the rulings below.** Rulings 1 and 2 are **the owner's decisions** (2026-09-30, in conversation): the setup wizard no longer sets display modes — 「确认直接在PR #571上改向导不再设置显示模式」 (ruling 1) — and the session-end lines, the four points he accepted from the read-only sweep — 「会话结束日志按照你说的修」 (ruling 2 (i)–(iv)). Where a ruling left a sub-decision to this plan, the answer is a numbered *choice* below, and the self-review lists each one. **Choice 7 goes beyond the brief** — the Logs panel draws its "session ended" separator after the runner's new line — and is marked so wherever it lands; the roadmap has carried it since the Stage 2 Soniox plan ("A run's end is the runner's to log, for every provider — not yet written"). This plan runs **after** the Stage 2 translation cuts plan (`726c0d34`, revised by `89f8b53f`, under review), which edits three of the files Task 8 edits; every anchor is by content, and the replay applied every hunk on that plan's result too (Global Constraints).

**Goal:** Every session leg ends with a line in the Logs, and every provider that has a graceful end says so as it sends it; the setup wizard stops overwriting a display mode the user chose. Concretely:
- **The runner frames `session.stopped`, once per leg,** as the leg's last line: why the run ended (its reason, its notice's code and the leg that notice names), the leg's last state, and the time from Start to the stop — the uniform line every old client logged from its `disconnect()` as `session.closed`. A normal Stop, which logs nothing today, now does; so do a start that fails, a lease's end and Both (ruling 2 (i); choices 1, 2).
- **Each adapter frames the graceful end it sends:** Doubao AST 2.0's `FinishSession` (`session.finish`); Soniox's end of the STT stream (`stt.end`) and a speaking TTS stream's `text_end` (`tts.end`); Palabra's `end_task` (`task.end`) and its REST session's delete — the attempt (`session.delete`) and the outcome (`session.deleted`, or `session.delete_warning`, **a warning row**); OpenAI Translate's new `session.close` (ruling 2 (ii), (iii); choices 4, 5, 8, 9). Gemini and OpenAI Realtime have no end message; LocalInference has no wire: the runner's line covers them.
- **The kit lets an ending say so:** a frame may follow `stop()`, `failed` or `closed` until `stop()` has returned — what the runner files — and nothing may after; content stays late at once (choice 3).
- **The Logs draw their "session ended" separator after `session.stopped`** (choice 7, beyond the brief).
- **The wizard writes no display mode:** the scenario presets carry none, so a re-run leaves both legs' modes as stored (ruling 1; choice 11).

It ends with the controller's docs task and the owner's live test (Task 9).

**Architecture:**
- **The runner's line** comes from `Run.close(result)` (`src/lib/session/run.ts`), which now takes the run's `RunEnd`: once the stack has unwound — every adapter's `stop()` settled, every frame it said of its own ending filed — and the legs are final, it frames `session.stopped` for each leg of the shape straight to the frames port, before the run stops filing frames (`finished`). `Run` keeps `startedAt`, set when it is created. `runner.ts` passes the result it already has.
- **The kit** (`src/lib/contract/conformance.ts`, `testing/drive.ts`, `testing/lifecycle.ts`) gains a `stopped` marker, recorded once `stop()` has returned; `checkConformance` lets a frame follow an ending until it.
- **Each adapter** frames at the send it already makes: Doubao and OpenAI Translate in `stop()`; Soniox in its core's `shutdown()` and `LegSpeech.close()`, reading which stream `SonioxTtsStream.close()` ended (it now returns its id); Palabra in `stop()` and in `release()`, whose promise now carries the outcome to a frame.
- **The wizard**: `ScenarioPreset` loses its two display modes and `ApplySetupDeps` its two setters; `useApplySetup` binds neither.
- **Unchanged:** the contract's types, L1, L2, the view, `logStore.ts` (no row: choice 6), Gemini, OpenAI Realtime, LocalInference, the Kizuna Soniox lease, every store, the locale catalogs. No contract change, no new locale key, no store change, no migration code.

**Tech Stack:** TypeScript (strict), Vitest, the adapter test kit (`FakeSocket`, `fakeSockets`, `runScenario`, `runLifecycles`, `driveAdapter`, `trackedClock`, `flush`), the runner's fakes (`fakeProvider`, `createFakeSource`, `createVirtualClock`), `@testing-library/react` (`render`, `renderHook`), the `openai` SDK's types.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — the binding authority, as amended through the Stage 2 Gemini hold plan's record (and, should it land first, the translation cuts plan's). The parts this plan meets: "L0 — the client contract" → "What every adapter must honour" (the "can no longer work" bullet and the `frame` bullet: its separator convention and its list of names needing no `logStore` row); "Session lifecycle" → "Stopping, and closing the window"; "Testing" → the kit's `runScenario` and `runLifecycles` bullets. And `docs/superpowers/specs/2026-08-25-first-run-setup-and-tour-design.md` §1.2's scenario table and §1.5's step 3. Task 9 amends both.

**Research notes:**
- **The evidence:** the read-only sweep, `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/session-end-sweep.md` — a table per provider (the protocol's graceful end, whether the new adapter sends it and frames it, the old client) and eight findings: no runner line on a normal Stop (finding 2); every old client logged `session.closed` from its `disconnect()` (`GeminiClient.ts:678-689`, `OpenAIGAClient.ts:776-788`, `OpenAITranslateGAClient.ts:761`, `SonioxClient.ts:1587`, `VolcengineAST2Client.ts:1023-1039`, `PalabraAIClient.ts:1186`, `LocalInferenceClient.ts:596`; finding 1); Doubao's `FinishSession` sent unframed (finding 3); Soniox's `stt.end()` unframed beside its framed `stt.finalize` (finding 4), its TTS `text_end` gated off by `closed`; Palabra's `end_task` and delete unframed, a failed delete with no trace (finding 5); OpenAI Translate's `session.close` never sent (finding 6).
- **Found while writing** (at `43437057`, in the scratch copy):
  1. **The kit forbids what ruling 2 (ii) asks.** `driveAdapter` and `runLifecycles` mark `stop` *before* calling `stop()` (`drive.ts:100-105`, `lifecycle.ts:330-335`), and `checkConformance` flags every event after that marker, frames included (`conformance.ts:104-105`); after `failed` / `closed` likewise. So a goodbye framed inside `stop()` fails every conformance scenario that stops a live session: with the four adapters' code of Tasks 5–8 applied and the kit unchanged, 24 of their conformance and lifecycle cases fail on `stop-silence` or `ended-silence` (measured). "Frame before the ending the kit checks" is not open to a goodbye sent inside `stop()`, nor to a delete's outcome, which lands after it: the rule changes (choice 3).
  2. **The runner files frames until every leg's `stop()` has settled.** `Run.onEvent` passes a frame to the frames port unless the run has `finished` (`run.ts:471-475`), and `close()` sets `finished` only after `stack.unwind()` (`:307-312`), which awaits each leg's `stop()` within `timeoutMs`. So what an ending says while `stop()` runs reaches the Logs; after it returns, the kit's rule and the runner's filing agree.
  3. **The Logs' severity and separator are by name** (`logStore.ts:286-290`: `error` / `failed` → error, `warning` → warning; `LogsPanel.tsx:266-267`: the separator after `session.closed`). A failed delete is a warning row only if its name ends in `warning`; today the separator follows only OpenAI Translate's server-side `session.closed`. The roadmap has carried "No 'session ended' separator in the Logs for a Soniox run … A run's end is the runner's to log, for every provider — not yet written" since the Stage 2 Soniox plan (`2026-09-23-client-contract-stage1-roadmap.md:1628`), and "`session.closed` on Stop is not emitted (the kit forbids emissions after stop)" for Gemini, Doubao and OpenAI Realtime (`:3120`, `:3864`, `:4471`).
  4. **Soniox sends a speaking TTS stream's `text_end` only while it is still active:** a translation that ends a sentence has had its `text_end` at `endUtterance` already (the adapter test's first draft, with `こんにちは。`, found none at Stop). The test speaks a translation with no sentence end.
  5. **Soniox's shutdown sends the STT end on every ending,** a server error included (`adapter.ts:431-444`), as the old client did; the frame follows the send, so a bad key's `failed` is now followed by `stt.end`.
  6. **Nothing else reads the presets' display modes** (checked: `src/components/SetupWizard/**`, `src/components/Tour/**`, `src/lib/setup/**`); the settings store's default for both is `both` (`settingsStore.ts:267-268`).
  7. **The translation cuts plan** edits `src/providers/openai_translate/{wire,wire.test,adapter,adapter.test}.ts` — `wire.ts` below `computeRms`, `adapter.ts`'s header, constructor and `audioDelta`, `adapter.test.ts`'s delta and `.done` cases — and `wire.test.ts`'s import line, which is why this plan leaves `wire.test.ts` alone (choice 9).
- **A scratch copy of the tree** at `43437057` (a `git archive`, `node_modules` linked, outside the repository, 2026-09-30) ran every code and test block below before it was written down; each block is that copy's file, and every diff is generated from it. Then the plan was replayed on a fresh copy of `43437057`, task by task, from this document's own blocks — every diff taken by `patch -p1` with no offset and no fuzz — each task's red step against the code before it and its green step after, and every count came out as quoted. At `43437057`: **573 files passed and 1 skipped, 7 453 tests passed and 2 skipped**. After Wave 1: **573 files passed and 1 skipped, 7 467 tests passed and 2 skipped**; after Wave 2: **573 files passed and 1 skipped, 7 474 tests passed and 2 skipped**; no unhandled errors; the typecheck gate exactly the baseline's 20 lines after each wave, and the full tree at 259. **On the translation cuts plan's result** (its replay tree, `translate-cuts-plan/r3/`), every hunk of this plan applied — Task 8's by offset only, no fuzz — and the suite ran **576 files passed and 1 skipped, 7 509 tests passed and 2 skipped**, the gate at the baseline and the tree at 259; and again on its Revision 1 (`89f8b53f`, which landed while this plan was written; its result tree `translate-cuts-plan/rev1/final/`): the same hunks at the same offsets, **576 files passed and 1 skipped, 7 525 tests passed and 2 skipped**, the gate at the baseline and the tree at 259. Thirty-six hand mutants ran against the result, each failing at least one test (the self-review lists them).

## Global Constraints

- **Starting point.** HEAD `43437057` on `worktree-client-contract-stage2`; `89f8b53f`, the translation cuts plan's Revision 1, landed on it since — the plan document alone. Every task anchors its edits by content, not by line: a line number cited here was read at `43437057`. **The translation cuts plan (`726c0d34`, revised by `89f8b53f`) executes first**; it and this plan share three files, all Task 8's — `src/providers/openai_translate/{wire,adapter,adapter.test}.ts` — and none of the same lines. Other commits may land first too; every anchor is by content.
- **Edits shown as diffs.** A change to an existing file is a unified diff with its context lines, generated from the scratch copy; its hunk headers count the lines at `43437057`. Apply a hunk by its content all the same (`patch -p1` took every one in the replay; on the translation cuts plan's result, Task 8's with offsets). No file is new.
- **What this plan touches:**
  - `src/lib/contract/{conformance,conformance.test}.ts`, `src/lib/contract/testing/{drive,drive.test,lifecycle,lifecycle.test}.ts` — Task 1;
  - `src/lib/session/{run,runner,runner.test,runner.hooks.test}.ts` — Task 2;
  - `src/components/LogsPanel/{LogsPanel,LogsPanel.test}.tsx` — Task 3;
  - `src/lib/setup/{scenarios,scenarios.test}.ts`, `src/components/SetupWizard/{applySetup,applySetup.test,useApplySetup,useApplySetup.test}.ts` — Task 4;
  - `src/providers/volcengine_ast2/{adapter,adapter.test}.ts` — Task 5;
  - `src/providers/soniox/{adapter,adapter.test,speech,speech.test,ttsStream,ttsStream.test}.ts` — Task 6;
  - `src/providers/palabraai/{adapter,adapter.test}.ts` — Task 7;
  - `src/providers/openai_translate/{wire,adapter,adapter.test}.ts` — Task 8;
  - the client-contract spec, the first-run spec and the roadmap — Task 9.
- **Read only.** The contract's types (`src/lib/contract/adapter.ts`, `events.ts`), `src/lib/conversation/**`, `src/lib/projection/**`, `src/lib/session/{ports,types,stack,shape}.ts`; `src/stores/**` — `logStore.ts` included (choice 6) — and `src/app/**`; every other file of the four provider folders (the Kizuna Soniox lease, `lease.ts`, stays as it is: What this plan leaves); `src/providers/{gemini,openai,localInference,fake}/**`; `src/providers/openai_translate/wire.test.ts` (choice 9); `src/services/**` — the old clients re-export Soniox's `ttsStream.ts`, whose `close()` now returns a value they ignore; the locale catalogs; `electron/**`, `extension/**`; `package.json` and the lockfile. `npx vitest run src/services` stays green.
- **Import rules:**
  - A provider's session side — `adapter.ts` and every file of its folder it reaches by a value import — imports no store and no reporter and runs no global timer: every timer reads the request's clock. Nothing here adds an import across folders; OpenAI Translate's adapter gains `SESSION_CLOSE` from its own `wire.ts`. `sessionSide.consistency.test.ts` is unchanged.
  - No provider imports another provider's folder.
- **Diagnostics** (CLAUDE.md, "Error Handling"): no adapter reports or logs; each says what happened through `frame`, as now. The runner's line goes through the frames port, which `guardPorts` already guards. Nothing new is reported.
- **Frames** (a Logs line each; never audio, never text, never a credential; the hot-path rule — each once per leg's end): the runner's `session.stopped` (`out`); Doubao's `session.finish` (`out`); Soniox's `stt.end` and `tts.end` (`out`); Palabra's `task.end`, `session.delete` (`out`), `session.deleted` and `session.delete_warning` (`in`); OpenAI Translate's `session.close` (`out`). Payloads in choices 2, 4 and 5. No `logStore` row (choice 6). Nothing in `src/`, `extension/` or `electron/` holds the names `session.stopped`, `session.delete_warning`, `stt.end` or `tts.end` at `43437057` (checked).
- **Locales.** No new key: the separator's `logsPanel.sessionEnded` exists.
- **No network.** No test or step calls a provider. Every adapter is tested over `FakeSocket` (Palabra's REST over its fake server) on a virtual clock.
- **Gates for every task:**
  - **The suite.** `npx vitest run src` shows 0 failed and no unhandled errors. Measured at `43437057` on 2026-09-30, in a scratch copy: **573 test files passed and 1 skipped (574); 7 453 tests passed and 2 skipped (7 455); no unhandled errors.** The scratch copy's numbers after each wave (research notes) are references, not the gate: the gate is the rule. (The `Not implemented: window.open` stderr lines are pre-existing, `ChildWindowPopover`'s.)
  - **The typecheck.** The gate prints exactly the baseline lines below. The shell's `grep` is a ugrep wrapper that mis-parses this regex, so use `command grep` exactly as written. Every file this plan edits under `src/lib/{contract,session}/`, `src/providers/` and `src/components/SetupWizard/` is inside the regex; `src/lib/setup/` and `src/components/LogsPanel/` are not — the next bullet covers them.

    ```
    npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts|diagnostics/(consoleLedger|clientDiagnostics|redact))|lib/modern-audio/BaseAudioRecorder|providers|services/(clients/(SonioxSttStream|SonioxTtsStream|PcmMixer|SonioxSideTracker|SonioxTtsRest|SonioxVoicesClient|SonioxClient|ManagedVoicesClient|managedVoicePolling|VolcengineAST2Client|volcengine-ast2/ast2-proto\.d)|providers/(SonioxProviderConfig|KizunaAISonioxProviderConfig|managedVoicePrep|managedVoicePrep\.test|prepareToStart\.kizunaSoniox\.test))\.ts|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|MainPanel\.|panel/|SessionCountdown)|MainLayout/(MainLayout|useSignInProviderSwitch)|Settings/(Settings\.tsx|ProviderArea|SimpleSettings/SimpleSettings\.tsx|AdvancedSettings/AdvancedSettings\.tsx|sections/((SpeechSection|VoiceLibrarySection)(\.test)?\.tsx|(ParticipantSpeechSwitch(\.test)?|SentenceSegmentationSection|SystemAudioSection|SonioxVoiceSection|ProviderSpecificSettings)\.tsx|voiceLibrarySource(\.test)?\.ts))|SettingsInitializer/|SetupWizard/(SetupWizard(\.test)?\.tsx|(setupDraft|applySetup|useApplySetup)(\.test)?\.ts|providerPaths(\.test|\.managedFit\.test)?\.ts|steps/(StepLanguagePair|StepLanguagePair\.test|StepCredentials|StepCredentials\.test|StepFinish|StepProviderPath|StepScenario)\.tsx)|TitleBar/(AccountButton(\.test)?\.tsx|useBalanceShortfall)|Tour/useStartBasicsTour\.ts|dev/(SpinePreview|SessionControls|OverlayPreview|wireTally|gapCounter))|contexts/UserProfileContext|locales/(index\.ts|showLanguageUncached)|routes/Home\.tsx|stores/(providerStore|turnModeStore|routingStore|accountStore|logStore|settingsStore\.ts)|utils/(environment|conversationExport)|subtitle-overlay-entry|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
    ```

    The same command is `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh`; its output must equal `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate-baseline.txt` — exactly these **20** lines, re-measured at `43437057`:

    ```
    src/App.tsx: error TS6133: 'React' is declared but its value is never read.
    src/components/MainLayout/MainLayout.tsx: error TS6133: 'useTranslation' is declared but i
    src/components/Settings/sections/ProviderSpecificSettings.tsx: error TS6133: 'templateSyst
    src/components/Settings/sections/ProviderSpecificSettings.tsx: error TS6133: 'setTemplateS
    src/components/Settings/sections/SystemAudioSection.tsx: error TS2345: Argument of type '"
    src/components/Settings/sections/VoiceLibrarySection.tsx: error TS2345: Argument of type '
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/lib/analytics.ts: error TS6133: 'response' is declared but its value is never read.
    src/routes/Home.tsx: error TS6133: 'React' is declared but its value is never read.
    src/stores/logStore.ts: error TS2345: Argument of type 'StateCreator<LogStore, [], [["zust
    src/stores/logStore.ts: error TS2554: Expected 0-1 arguments, but got 2.
    src/stores/settingsStore.ts: error TS2353: Object literal may only specify known propertie
    src/stores/settingsStore.ts: error TS2353: Object literal may only specify known propertie
    src/utils/environment.ts: error TS2717: Subsequent property declarations must have the sam
    src/utils/environment.ts: error TS2339: Property 'create' does not exist on type '{ query(
    ```

    Do not fix them; do not add to them. The TS lib is ES2020: no `Array.prototype.at`, `String.prototype.replaceAll` or `Array.prototype.findLast` in a test either.
  - **The full tree, for the files outside the regex.** `npx tsc --noEmit -p tsconfig.json 2>&1 | command grep -c 'error TS'` prints **259** (measured at `43437057`, the ceiling), and `npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -c 'src/lib/setup/'` prints **0**. `src/components/LogsPanel/LogsPanel.tsx` has four pre-existing lines in the full tree (two at `:152`, and `'logs' is of type 'unknown'` / `Parameter 'log' implicitly has an 'any' type` at `:339` and `:367`); after Task 3 the last two sit two lines lower, and there are still four.
  - **Gates in a parallel wave.** Wave 1 runs Tasks 1–4 at once, Wave 2 Tasks 5–8, in this one working tree, so each sees the others' red phases:
    - a test failure, or an extra gate line, in a file another task of the wave is changing is that task's work in progress: the implementer names it in the report and never touches it;
    - the task's own files must be green, and the gate must print the baseline plus only such named lines;
    - after each wave the controller runs the full gates: the suite at 0 failed with no unhandled errors, the exact baseline, and the full tree's 259.
  - **A task edits only the files in its Files list**, and commits exactly those. Where a step names tests elsewhere its change could reach, it says why each stays green. If one fails anyway, the implementer stops, reports the failure with its output, and leaves the file untouched: the controller decides.
  - **No task mutates the tree to prove a guard, and no temporary file is written inside `src/`.** A mutant a reviewer wants to try runs in a scratch copy under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`.
- **Builds, at the group check only** (the controller's):
  - `npm run build` and `npm run extension:build`. If `extension/node_modules` is missing, run `npm ci --prefix extension` first.
  - `npx vitest run extension`.
  - The D24 check: each of these prints nothing —
    - `command grep -rlF 'The fake degraded its speech' build extension/dist`
    - `command grep -rlF 'Lease ended by the leased fake' build extension/dist`
    - `command grep -rlF 'The leased fake refused the lease' build extension/dist`
  - The new code shipped: `command grep -rlF 'session.delete_warning' build extension/dist` and `command grep -rlF 'session.stopped' build extension/dist` each name at least one file under `build/` and one under `extension/dist/`.
- **Dev servers, probes and builds** are the controller's; an implementer never starts one.
- **Shell forms.** This worktree's guard refuses compound shell forms: brace groups, loops, heredocs other than a commit's, `cd … &&` chains. Every command in this plan is a single command or a plain pipeline, run as its own call from the worktree root. Use `command grep`. The shell is zsh: quote globs. Checks write their outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, never `/tmp`, each agent in a directory named for its task and role (`t2-impl/`, `t7-review/`).
- **Commits:**
  - Conventional, in English. Every message ends with the implementing model's own `Co-Authored-By:` line, then `Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe`, and nothing after it. The examples below write the first as `Co-Authored-By: <implementing model> <noreply@anthropic.com>`: fill in your own model's name.
  - Run `git add <paths>`, then `git commit -q -F - -- <the same paths> <<'EOF' … EOF`, as two separate calls. The `--` pathspec is mandatory: another plan's tasks stage into the same index. Never stage a whole directory.
  - Production comments cite this plan's rulings and choices as "(Stage 2 session end, ruling N)" / "(Stage 2 session end, choice N)" — the wizard's ruling 1 included, the plan's one name — the earlier plans' as they already do; never a task number, a review finding or a file of the sweep. English only.
  - Never push.

## Rulings

Cited as *ruling N* (in code, "Stage 2 session end, ruling N"). Both are the owner's (2026-09-30). Each is restated with where it lands.

1. **The setup wizard no longer sets display modes** (「确认直接在PR #571上改向导不再设置显示模式」). Today every completion, a re-run included, applies the scenario preset's `speakerDisplayMode` / `participantDisplayMode` (`src/lib/setup/scenarios.ts:21-30`; `applySetup.ts:14-17, 40-41`; `useApplySetup.ts:23-24`), overwriting a mode the user chose since. From now: the presets carry no display modes, the wizard writes none, and both stay at their stored values (default `both`). No migration code (the owner's standing rule): a stored mode stays as it is. The first-run spec's scenario table and its §1.5 step 3 are amended with a note naming this ruling. Lands in: Task 4 (choice 11), Task 9.
2. **Session-end lines** (「会话结束日志按照你说的修」). Its parts, cited as ruling 2 (i)–(iv):
   - (i) **The runner frames one line per leg when it stops:** `session.stopped`, with the reason — user stop, failure, the lease's end, whatever the runner already distinguishes — and the elapsed time: the uniform line every old client logged from its `disconnect()` as `session.closed`. A normal Stop produces no Logs line today (`runner.ts` reports only abnormal paths; `run.ts:474, 253` pass adapter and lease frames through).
   - (ii) **Each adapter frames the graceful end it sends:** Doubao AST 2.0's `FinishSession` (`volcengine_ast2/adapter.ts:158-163`; its `session.start` is framed at `:179`, its end is not); Soniox STT's `stt.end()` (`soniox/adapter.ts:441`; its sibling `stt.finalize()` is framed at `:243`) and the TTS `text_end` per active stream (`speech.ts:95-105`, whose `frame()` is gated off by `closed` before the send); Palabra's `end_task` (`palabraai/adapter.ts:207-208`) and the REST session's delete — the attempt and its outcome, **a failed delete a warning** (`:610-627`; today "a delete that failed leaves the session to expire on its own" with no trace). Palabra's "nothing is framed after a stop" (`:201-206`) and the kit's rules on events after an ending bind how (choice 3).
   - (iii) **OpenAI Translate sends `session.close` before it closes** at Stop (the SDK's `RealtimeTranslationSessionCloseEvent`, `node_modules/openai/resources/realtime/realtime.d.ts:3298-3312`), framed; it does not wait for `session.closed` — the tail at Stop is still dropped, as today, and the adapter's comment at `:155-159` changes accordingly. The same as the owner's ruling for OpenAI Live's Stop (its Q8).
   - (iv) **Doubao does not wait for `SessionFinished`** before closing: Stop stays fast, and the billing figures it would carry are not read, as the old client did not.

   Gemini and OpenAI Realtime send nothing (their protocols have no end message); the runner's line covers them. LocalInference: the runner's line only. Lands in: Task 1 (choice 3), Task 2 ((i); choices 1, 2), Task 3 (choice 7), Tasks 5–8 ((ii)–(iv); choices 4, 5, 8–10), Task 9.

The standing rules hold: no one-time migration code, and production comments cite rulings and choices.

## Choices this plan makes inside the rulings

Cited as *choice N*.

1. **The runner's line comes from `Run.close(result)`, per leg, after the unwind.** `close()` takes the `RunEnd` the runner already holds (`runner.ts` passes it). Once `stack.unwind()` has settled — every leg's `stop()`, the sources, a lease's release — and the legs are final, it frames `session.stopped` for each leg of the shape, speaker first, through the frames port the runner's own lease frames already use (`run.ts:253`), and only then marks the run `finished`. So the line is each leg's last: after whatever its adapter framed of its own ending (research note 2) and after a lease's `session.end`. **When there is none:** a run that never reached its opening step opened no leg — a refusal (`gate`, credentials, readiness, `build`, `admit`, all before it), or a Stop while it checked or prepared — so it frames nothing; the test is that it created no conversations (`conversations.size === 0`), which the opening step does first. `abandon()` (`pagehide`) marks the run `finished` and the page is going away: nothing, even from an ending still unwinding. An ending that overran its bound frames its lines when its unwind finishes. **Not per adapter** (the sweep's finding 1 proposed a frame in every adapter's `stop()`): the runner already knows every leg and why the run ended, and Gemini, OpenAI Realtime and LocalInference — which have nothing of their own to say — get the line with no code of theirs. **Not at the top of `close()`** (the sweep's finding 2): after the unwind it is the leg's last line, and the time it reads is still taken at the top (choice 2).
2. **Its payload:** `{ reason, code?, leg?, state, elapsedMs }`.
   - `reason` — the run's `EndReason`: `user`, `start-failed`, `leg-failed`, `leg-closed`, `source-ended` or `lease-ended` (`refused` frames nothing: choice 1). The runner's own words for why, kebab-case as `lastEnd.reason` is.
   - `code` — the notice's code when the end has one (`leg_failed`, `connection_lost`, `budget_exhausted`, a provider's own): a token, snake_case. Never the notice's `message`: its words may quote a provider.
   - `leg` — the leg the notice names, when it names one: in Both, which leg's failure ended both.
   - `state` — the leg's last `LegState` (`opening`, `live`, `reconnecting`), or `null` when its adapter was never asked to start (its source failed first): whether the leg went live, and whether it was reconnecting when it stopped.
   - `elapsedMs` — the run clock's time from Start (when `Run` was created) to the moment the ending began, the same instant analytics' `endedAt` reads (`runner.ts:127`): **from Start, not from the leg going live** — a start that fails still has a length, and a session's live time is already `connection_status`'s `duration_ms`. An ending that overran its bound still counts to the stop, not to when its unwind finished.
   No text, no credential, no URL. The ruling's "elapsed from the leg's start on the request clock or the runner's": the two are one clock (`requests[leg].clock` is `deps.clock`), and the legs of a run start together.
3. **The kit: a frame may follow an ending until `stop()` has returned.** `checkConformance` flags an event after `stop` or after `failed` / `closed` as today — unless it is a frame and `stop()` has not yet returned. Both drivers record a new marker, `stopped`, once `stop()`'s promise has settled (`driveAdapter`'s `stop`; `runLifecycles`' `awaitStop`), and a frame after it is late. **Why:** it is the runner's own rule — it files frames until every leg's `stop()` has settled (research note 2) — so what the kit lets through is exactly what reaches the Logs, and what it still flags is what cannot: content after an ending (L1 would fold it), and any frame after `stop()` has returned (a timer or listener left behind). **Not taken:** framing "before the ending the kit checks" — the kit marks `stop` before it calls `stop()`, so a goodbye sent inside `stop()` is after the mark, and a delete's outcome lands after `stop()` has been called by construction (research note 1); exempting frames outright — a leaked timer that frames would go uncaught. A log with no `stopped` marker — a test that calls `recordConformance` itself — flags no frame after an ending: both drivers record it. The lifecycles' socket rule is unchanged: a socket send after `stop()`'s synchronous body is late, as before — every goodbye here goes out before its first `await`.
4. **Frame names and payloads**, each framed only when its message was sent:
   - Doubao: `session.finish` (`out`) `{ sessionId }` — the id `session.start` and `session.started` already carry.
   - Soniox: `stt.end` (`out`, no payload), the sibling of `stt.finalize`; `tts.end` (`out`) `{ streamId }` — `utt-<n>-<m>`, the adapter's own counter — on the leg whose speech it was.
   - Palabra: `task.end` (`out`) `{ force: true }` — `END_TASK`'s data, beside `task.set` and `task.get`; `session.delete` (`out`, no payload); `session.deleted` (`in`) `{ status }`; `session.delete_warning` (`in`) — choice 5.
   - OpenAI Translate: `session.close` (`out`, no payload) — the wire's own name, as `session.update` is.
5. **Palabra's delete, framed.** `release()` frames `session.delete` as the request goes out — before any `await`, so before a live failure's `failed`, which `end()` emits after `shutDown()` — and its outcome when it settles: `session.deleted { status }` on Palabra's 2xx; else `session.delete_warning` with `{ status }` (Palabra answered otherwise: 404, 500), `{ error }` (the transport failed on both tries: the error's name alone, `errorName`, never its words, which may quote the URL and its session id) or `{ timeoutMs: 5000 }` (no answer within `RELEASE_TIMEOUT_MS`, the bound's own abort). **A warning, not an error, by its name** (`logStore`'s suffix rule, research note 3): a session that was not deleted expires on its own, and the user's Stop succeeded; the brief's word, the owner's accepted point. The lines go through a helper not gated on the leg's end (`releaseFrame`), since a delete runs as the leg ends; the session's id is never framed (it is shaped as a token). The chain still never rejects and cancels its timer however it settles. **Where it does not reach the Logs:** a start that fails after the app pair's REST session was created — the attempt is framed before the rejection, but the outcome lands after the runner has finished that run, and a frame is dropped then (What this plan leaves). A create that lands after its leg gave up deletes its session and frames it, likewise unfiled.
6. **No `logStore` row.** Each new name is said at most once per leg's end, so there is nothing consecutive to group; `logStore` groups only `.delta` names and the rows plans added (`logStore.ts:380-506`), none of which match these — `tts.end` is not Doubao's `tts.ended`, `task.end` not the old client's `end_task`. Severity comes from the suffix: `session.delete_warning` is a warning row (pinned in Task 3), every other new name an info row.
7. **Beyond the brief: the "session ended" separator follows `session.stopped`.** `LogsPanel` drew it after `session.closed` (`LogsPanel.tsx:266-267`) — every old client's `disconnect()` line; in the new app only OpenAI Translate's server-side `session.closed` still draws one. It now follows the runner's `session.stopped`, each leg's last line, and no longer `session.closed`: a server's close is followed by the runner's line anyway, and two separators would split one session's end. The old clause matching a plain entry's message is dropped with it: no plain entry says `session.closed`. The roadmap's Soniox item (research note 3) asks for it; the separator is per tab, so in Both each leg's tab shows its own.
8. **Soniox frames what it sent.** The core's `shutdown()` sends the STT end only when the socket is open, and frames `stt.end` right after the send, directly on the first leg's events — past the core's own `ended` gate, which `shutdown()` sets first. It sends it on every ending, as today, so a server error's `failed` is followed by `stt.end` (research note 5). `SonioxTtsStream.close()` returns the stream it ended with `text_end` — the active one, if any — or `null`; `LegSpeech.close()` frames `tts.end { streamId }` for it before it marks itself closed, then says nothing more. A stream already ended at `endUtterance` gets no second line (research note 4). In shared Both `stt.end` goes to the speaker leg, as every core frame does, and each leg's `tts.end` to its own.
9. **OpenAI Translate: `session.close`, sent and framed, then the close.** Only when the leg is live and its socket open; then `shutDown()` nulls the handlers and closes at once, so the server's flush and its `session.closed` are never read — the tail at Stop is dropped, as today (ruling 2 (iii)). `SESSION_CLOSE` lives in `wire.ts`, typed by the SDK's `RealtimeTranslationSessionCloseEvent`, beside the other two client frames. Its wire shape is pinned by the adapter's stop case, which reads the frame the socket sent; `wire.test.ts` is left to the translation cuts plan, which rewrites its import line (research note 7).
10. **Doubao: `session.finish` with the send.** Framed inside the same guard as the send (live, socket open); `SessionFinished` is not awaited (ruling 2 (iv)): `shutDown()` nulls the handlers at once, as today.
11. **The wizard: the fields go, not just their writes.** `ScenarioPreset` loses `speakerDisplayMode` and `participantDisplayMode`, and `ScenarioDisplayMode` goes with them; `ApplySetupDeps` loses its two setters; `useApplySetup` binds neither. A preset that cannot carry a display mode cannot bring the write back. A stored mode stays as it is, and a fresh install keeps the store's default, `both` — no migration (ruling 1). The first-run spec keeps its table's history: its column and step 3 are struck through with a note, not deleted (Task 9).

## What this plan consumes from the earlier plans

Named as landed, so a reconciliation is mechanical. Where a landed name or text differs from what is quoted here, the implementer follows the landed one and reports it.

| From | What it is | Consumed by |
|---|---|---|
| The kit (the Stage 1 plans; the Stage 2 Palabra plan's ruling 15): `recordConformance`, `checkConformance`, `MarkerName`, `driveAdapter`, `runScenario`, `runLifecycles` / `LifecycleHarness`, `createEchoAdapter`, `FakeSocket`, `fakeSockets`, `flush` | the rules the endings must pass | Tasks 1, 5–8 |
| The runner (Stage 1; the Stage 2 Kizuna Soniox plan's lease hooks): `Run` (`close`, `abandon`, `legStates`, `conversations`, `finished`), `RunEnd` / `EndReason`, `FramePort`, `LeaseContext.frame`, the fakes (`fakeProvider`, `createFakeSource`, `hangingStop`, `withHooks`) | where the line is framed, and what it knows | Task 2 |
| `logStore`'s suffix severity and `LogsPanel`'s separator (`logStore.ts:286-290`, `LogsPanel.tsx:266-267`; the spec's `frame` bullet) | the warning row, the separator | Tasks 3, 7 |
| The Stage 2 Volcengine AST2 plan: `Ast2Leg.stop()`, `finishSessionFrame`, `liveAst2`, `SERVER`, `EventType` | the end it frames | Task 5 |
| The Stage 2 Soniox plan: `SonioxCore.shutdown()`, `LegSpeech.close()`, `SonioxTtsStream.close()`, `live()`, `msg`, `orig`, `tr` | the ends it frames | Task 6 |
| The Stage 2 Palabra plan: `PalabraLeg.stop()`, `release()` (its bound, its plain retry, `keepalive`), `errorName`, `livePalabra`, `fakeRest`, `RELEASE_TIMEOUT_MS` | the ends it frames | Task 7 |
| The Stage 2 OpenAI Translate plan: `TranslateLeg.stop()`, `shutDown()`, `liveTranslate`, `SERVER`; its parity note on the tail at Stop | the end it sends | Task 8 |
| The first-run setup plan: `SCENARIOS`, `getScenario`, `applySetupDraft`, `ApplySetupDeps`, `useApplySetup` | what stops writing display modes | Task 4 |

## File Structure

| File | Task | Change |
|---|---|---|
| `src/lib/contract/{conformance,conformance.test}.ts`, `src/lib/contract/testing/{drive,drive.test,lifecycle,lifecycle.test}.ts` | 1 | the `stopped` marker; a frame may follow an ending until `stop()` returns |
| `src/lib/session/{run,runner,runner.test,runner.hooks.test}.ts` | 2 | `session.stopped`, per leg |
| `src/components/LogsPanel/{LogsPanel,LogsPanel.test}.tsx` | 3 | the separator after `session.stopped` |
| `src/lib/setup/{scenarios,scenarios.test}.ts`, `src/components/SetupWizard/{applySetup,applySetup.test,useApplySetup,useApplySetup.test}.ts` | 4 | no display mode in the presets or the writes |
| `src/providers/volcengine_ast2/{adapter,adapter.test}.ts` | 5 | `session.finish` |
| `src/providers/soniox/{adapter,adapter.test,speech,speech.test,ttsStream,ttsStream.test}.ts` | 6 | `stt.end`, `tts.end` |
| `src/providers/palabraai/{adapter,adapter.test}.ts` | 7 | `task.end`, the delete and its outcome |
| `src/providers/openai_translate/{wire,adapter,adapter.test}.ts` | 8 | `session.close` |
| the client-contract spec, the first-run spec, the roadmap | 9 | the controller's amendments and record |

**Order and parallelism.**
- **Wave 1:** Tasks 1, 2, 3 and 4, at once. Disjoint files: the kit, the runner, the Logs panel, the wizard. None needs another: Task 3's cases write the Logs' entries themselves.
- **Wave 2:** Tasks 5, 6, 7 and 8, at once, each one provider's folder. All four need Task 1: without the kit's rule their conformance scenarios fail on the frames their stops now say (research note 1). None needs Task 2 or 3.
- **The group check** (controller) after Wave 2.
- **Task 9** (controller) last.

---

### Task 1: The kit lets an ending frame itself until `stop()` has returned (Wave 1)

**Files:**
- Modify: `src/lib/contract/conformance.ts` (the header, `MarkerName`, `checkConformance`), `src/lib/contract/testing/drive.ts` (`ScenarioStep`'s `stop`, `driveAdapter`'s `stop`), `src/lib/contract/testing/lifecycle.ts` (the header, `awaitStop`)
- Test: `src/lib/contract/conformance.test.ts` (after "flags an event after the stop marker"), `src/lib/contract/testing/drive.test.ts` (the first two cases, and one after "runs the clock on past the end"), `src/lib/contract/testing/lifecycle.test.ts` (after "catches an event said after stop")

**Interfaces:**
- Consumes: nothing new.
- Produces: `MarkerName` gains `'stopped'`; `driveAdapter` and `runLifecycles` record `{ kind: 'marker', payload: 'stopped' }` once `stop()` has returned; `checkConformance` lets a frame follow `stop` or `failed` / `closed` until that marker, its `stop-silence` detail for a late frame reading `frame after stop() returned`. Tasks 5–8's conformance cases rely on it.

- [ ] **Step 1: Write the failing tests** (choice 3): the rule both ways in `checkConformance`, the driver's marker and a stop that frames its own ending, and the same through the seeded lifecycles.

```diff
diff --git a/src/lib/contract/conformance.test.ts b/src/lib/contract/conformance.test.ts
--- a/src/lib/contract/conformance.test.ts
+++ b/src/lib/contract/conformance.test.ts
@@ -54,6 +54,25 @@
     expect(rules(log)).toContain('stop-silence');
   });
 
+  it('lets a frame follow the stop marker until stop() has returned, and flags one after it (Stage 2 session end, choice 3)', () => {
+    const goodbye = frame('out', 'session.finish');
+    expect(rules([{ kind: 'marker', payload: 'stop' }, goodbye, { kind: 'marker', payload: 'stopped' }])).toEqual([]);
+    expect(rules([{ kind: 'marker', payload: 'stop' }, { kind: 'marker', payload: 'stopped' }, goodbye])).toEqual(['stop-silence']);
+    // Anything else is late at once, as ever.
+    expect(rules([{ kind: 'marker', payload: 'stop' }, opened(1), { kind: 'marker', payload: 'stopped' }])).toEqual(['stop-silence']);
+  });
+
+  it('lets a frame follow failed or closed until stop() has returned, and flags one after it (Stage 2 session end, choice 3)', () => {
+    const outcome = frame('in', 'session.deleted', { status: 204 });
+    const failed = { kind: 'failed' as const, payload: { message: 'x' } };
+    const stop = { kind: 'marker' as const, payload: 'stop' as const };
+    const stopped = { kind: 'marker' as const, payload: 'stopped' as const };
+    expect(rules([failed, outcome, stop, stopped])).toEqual([]);
+    expect(rules([{ kind: 'closed', payload: { reason: 'x' } }, stop, outcome, stopped])).toEqual([]);
+    expect(rules([failed, stop, stopped, outcome])).toEqual(['ended-silence', 'stop-silence']);
+    expect(rules([failed, opened(1), stop, stopped])).toEqual(['ended-silence']);
+  });
+
   it('flags a ref opened twice', () => {
     expect(rules([opened(1), opened(1)])).toContain('ref-opened-once');
   });
diff --git a/src/lib/contract/testing/drive.test.ts b/src/lib/contract/testing/drive.test.ts
--- a/src/lib/contract/testing/drive.test.ts
+++ b/src/lib/contract/testing/drive.test.ts
@@ -1,5 +1,5 @@
 import { describe, it, expect, vi } from 'vitest';
-import type { AdapterSession, SessionContext } from '../adapter';
+import type { Adapter, AdapterSession, SessionContext } from '../adapter';
 import type { ConformanceLog, Marker } from '../conformance';
 import { createFakeAdapter } from '../../../providers/fake/adapter';
 import { exchange, type FakeScript } from '../../../providers/fake/script';
@@ -18,7 +18,7 @@
     expect(r.startOutcome).toBe('resolved');
     expect(r.startError).toBeUndefined();
     expect(r.log.some((e) => e.kind === 'segmentOpened')).toBe(true);
-    expect(r.log[r.log.length - 1]).toEqual({ kind: 'marker', payload: 'stop' });
+    expect(r.log.slice(-2)).toEqual([{ kind: 'marker', payload: 'stop' }, { kind: 'marker', payload: 'stopped' }]);
   });
 
   it('marks what the caller did in the log: typed text, the ends of turns, and stop', async () => {
@@ -28,14 +28,15 @@
       credentials: {},
       steps: [{ text: 'hi' }, { turn: 'begin' }, { turn: 'end' }, { turn: 'cancel' }],
     });
-    // A `begin` marks nothing. Conformance reads only the `appendText` and
-    // `stop` markers; `endTurn` and `cancelTurn` are recorded for a reader of
-    // the log, and no rule checks what a turn did.
+    // A `begin` marks nothing. Conformance reads only the `appendText`,
+    // `stop` and `stopped` markers; `endTurn` and `cancelTurn` are recorded
+    // for a reader of the log, and no rule checks what a turn did.
     expect(r.log.filter((e): e is Marker => e.kind === 'marker')).toEqual([
       { kind: 'marker', payload: 'appendText', text: 'hi' },
       { kind: 'marker', payload: 'endTurn' },
       { kind: 'marker', payload: 'cancelTurn' },
       { kind: 'marker', payload: 'stop' },
+      { kind: 'marker', payload: 'stopped' },
     ]);
   });
 
@@ -45,6 +46,31 @@
     expect(r.violations.map((v) => v.rule)).toContain('stop-silence');
   });
 
+  it('lets stop() frame its own ending, and still catches a frame after it has returned (Stage 2 session end, choice 3)', async () => {
+    const saying = (late: boolean): Pick<Adapter<unknown, unknown>, 'start'> => ({
+      start: async (request, events) => ({
+        info: {},
+        appendAudio() {},
+        appendText() {},
+        beginTurn() {},
+        endTurn() {},
+        cancelTurn() {},
+        async stop() {
+          // The goodbye it sends, then an answer it awaits.
+          events.frame({ direction: 'out', type: 'test.goodbye' });
+          await Promise.resolve();
+          events.frame({ direction: 'in', type: 'test.answer' });
+          if (late) request.clock.setTimeout(() => events.frame({ direction: 'in', type: 'test.late' }), 100);
+        },
+      }),
+    });
+    const said = await driveAdapter(saying(false), { context: auto, config: {}, credentials: {} });
+    expect(said.violations).toEqual([]);
+    expect(said.log.map((e) => (e.kind === 'marker' ? e.payload : e.kind))).toEqual(['stop', 'frame', 'frame', 'stopped']);
+    const late = await driveAdapter(saying(true), { context: auto, config: {}, credentials: {} });
+    expect(late.violations.map((v) => v.rule)).toEqual(['stop-silence']);
+  });
+
   it('reports a start that never settles instead of hanging', async () => {
     const r = await driveAdapter({ start: () => new Promise<AdapterSession>(() => {}) }, { context: auto, config: {}, credentials: {} });
     expect(r.session).toBeNull();
diff --git a/src/lib/contract/testing/lifecycle.test.ts b/src/lib/contract/testing/lifecycle.test.ts
--- a/src/lib/contract/testing/lifecycle.test.ts
+++ b/src/lib/contract/testing/lifecycle.test.ts
@@ -250,6 +250,24 @@
     expect(report.failures.some((f) => /conformance stop-silence \(log index \d+\)/.test(f))).toBe(true);
   });
 
+  it('lets stop() frame its own ending — its goodbye, then an answer it awaits — and still catches a frame after it has returned (Stage 2 session end, choice 3)', async () => {
+    const saying = (late: boolean) => wrapped((session, request, events) => ({
+      ...session,
+      stop: async () => {
+        events.frame({ direction: 'out', type: 'test.goodbye' });
+        await session.stop();
+        await Promise.resolve();
+        events.frame({ direction: 'in', type: 'test.answer' });
+        if (late) request.clock.setTimeout(() => events.frame({ direction: 'in', type: 'test.late' }), 100);
+      },
+    }));
+    const said = await runLifecycles(echoHarness(saying(false)), { seed: 7, runs: 60 });
+    expect(said.failures).toEqual([]);
+    expect(said.stats.stopped ?? 0).toBeGreaterThan(0);
+    const late = await runLifecycles(echoHarness(saying(true)), { seed: 7, runs: 20 });
+    expect(late.failures.some((f) => /conformance stop-silence \(log index \d+\): frame after stop\(\) returned/.test(f))).toBe(true);
+  });
+
   it('catches a socket left open, and a secret in an event', async () => {
     const leaky: Echo = {
       start: async (request, events) => {
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/lib/contract/conformance.test.ts src/lib/contract/testing/drive.test.ts src/lib/contract/testing/lifecycle.test.ts`
Expected: FAIL — `6 failed | 68 passed (74)`: the two rule cases (a frame after the stop marker, or after `failed`, is flagged at once), the driver's first two cases (no `stopped` marker), and the two "lets stop() frame its own ending" cases (their goodbye is flagged `stop-silence`).

- [ ] **Step 3: The `stopped` marker, and the rule.**

```diff
diff --git a/src/lib/contract/conformance.ts b/src/lib/contract/conformance.ts
--- a/src/lib/contract/conformance.ts
+++ b/src/lib/contract/conformance.ts
@@ -1,13 +1,15 @@
 /**
  * The rules of "What every adapter must honour", checked over a recorded
- * event log. Markers record what the caller did (stop, turns, text input) so
- * the rules that depend on it can be checked from the log alone.
+ * event log. Markers record what the caller did (stop, turns, text input),
+ * and when `stop()` returned, so the rules that depend on it can be checked
+ * from the log alone.
  */
 import type { SessionContext } from './adapter';
 import { redact } from '../diagnostics/redact';
 import { eventsFrom, type AdapterEvent } from './events';
 
-export type MarkerName = 'stop' | 'endTurn' | 'cancelTurn' | 'appendText';
+/** `stop` as the caller calls `stop()`, `stopped` once its promise has settled. */
+export type MarkerName = 'stop' | 'stopped' | 'endTurn' | 'cancelTurn' | 'appendText';
 /** `text` is the typed text, for `appendText` markers. */
 export interface Marker { kind: 'marker'; payload: MarkerName; text?: string }
 export type ConformanceLog = Array<AdapterEvent | Marker>;
@@ -48,6 +50,8 @@
   const pending: PendingText[] = [];
   let ended = false;
   let stopped = false;
+  /** `stop()` has returned: from here a frame is late too. */
+  let returned = false;
   let translationUnavailable = false;
 
   const flag = (rule: string, detail: string, index: number) => out.push({ rule, detail, index });
@@ -98,11 +102,18 @@
   log.forEach((entry, index) => {
     if (entry.kind === 'marker') {
       if (entry.payload === 'stop') stopped = true;
+      if (entry.payload === 'stopped') returned = true;
       if (entry.payload === 'appendText') pending.push({ index, text: entry.text ?? '', answered: false });
       return;
     }
-    if (ended) flag('ended-silence', `${entry.kind} after failed/closed`, index);
-    if (stopped) flag('stop-silence', `${entry.kind} after stop()`, index);
+    // A frame said before `stop()` has returned is the ending's own Logs line
+    // — the goodbye it sends, a REST delete's outcome — which the runner files
+    // until every leg's stop has settled. Anything else after an ending, and a
+    // frame once `stop()` has returned, is late (Stage 2 session end, choice 3).
+    const late = entry.kind !== 'frame' || returned;
+    const after = entry.kind === 'frame' ? 'after stop() returned' : 'after stop()';
+    if (ended && late) flag('ended-silence', `${entry.kind} after failed/closed`, index);
+    if (stopped && late) flag('stop-silence', `${entry.kind} ${after}`, index);
 
     switch (entry.kind) {
       case 'segmentOpened': {
diff --git a/src/lib/contract/testing/drive.ts b/src/lib/contract/testing/drive.ts
--- a/src/lib/contract/testing/drive.ts
+++ b/src/lib/contract/testing/drive.ts
@@ -45,7 +45,7 @@
   | { turn: 'begin' | 'end' | 'cancel' }
   /** Abort the request's signal: a cancel. */
   | { abort: true }
-  /** `stop()`, marked and awaited. */
+  /** `stop()`, marked, awaited, and marked again once it has returned. */
   | { stop: true }
   /** The test's own step: a server frame, a socket drop. */
   | { run(handles: ScenarioHandles): void | Promise<void> };
@@ -102,6 +102,8 @@
     box.stopped = true;
     recorder.mark('stop');
     await handles.session.stop();
+    // What the ending framed of itself came before this; a frame after it is late (Stage 2 session end, choice 3).
+    recorder.mark('stopped');
   };
   const play = async (step: ScenarioStep): Promise<void> => {
     if ('advance' in step) clock.advance(step.advance);
diff --git a/src/lib/contract/testing/lifecycle.ts b/src/lib/contract/testing/lifecycle.ts
--- a/src/lib/contract/testing/lifecycle.ts
+++ b/src/lib/contract/testing/lifecycle.ts
@@ -23,7 +23,9 @@
  * - a stop — the kit's random one, or its own unwind of a session that
  *   ended on its own — aborts the request's signal first and marks the log
  *   before that, exactly as the runner's own stop does: an adapter that
- *   answers its own abort is caught by `stop-silence`, not missed;
+ *   answers its own abort is caught by `stop-silence`, not missed; the log
+ *   is marked again once `stop()` has returned, and a frame the ending says
+ *   of itself comes before that (Stage 2 session end, choice 3);
  * - `stop()` is given a bound of its own: a session whose release never
  *   answers is failed by name, not left to hang the scenario;
  * - with the clock run on after the end, no timer is armed and every
@@ -201,6 +203,8 @@
         return;
       }
       await ending;
+      // What the ending framed of itself came before this; a frame after it is late (Stage 2 session end, choice 3).
+      recorder.mark('stopped');
     };
     const recorder = recordConformance();
     const events = recorder.events;
```

- [ ] **Step 4: Run the kit's suites.**

Run: `npx vitest run src/lib/contract`
Expected: PASS — 13 files, 135 tests. Every provider's conformance and lifecycle suite stays green (the Wave's gates): the rule only lets through what no adapter says today, and a log's extra marker is read by no provider's test (`localInference/adapter.test.ts` filters markers out).

- [ ] **Step 5: The gates.** The suite and the typecheck gate (in Wave 1, a failure in another task's files is that task's).

- [ ] **Step 6: Commit.**

```bash
git add src/lib/contract/conformance.ts src/lib/contract/conformance.test.ts src/lib/contract/testing/drive.ts src/lib/contract/testing/drive.test.ts src/lib/contract/testing/lifecycle.ts src/lib/contract/testing/lifecycle.test.ts
```

```bash
git commit -q -F - -- src/lib/contract/conformance.ts src/lib/contract/conformance.test.ts src/lib/contract/testing/drive.ts src/lib/contract/testing/drive.test.ts src/lib/contract/testing/lifecycle.ts src/lib/contract/testing/lifecycle.test.ts <<'EOF'
test(kit): let an ending frame itself until stop() has returned

The kit flagged every event after the stop marker, frames included, so
an adapter could not log the goodbye it sends inside stop(), nor a REST
delete's outcome. The runner files frames until every leg's stop() has
settled; the kit now marks the log again once stop() has returned and
lets a frame follow stop, failed or closed until then. Content is still
late at once, and so is any frame after stop() has returned.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 2: The runner frames `session.stopped`, once per leg (Wave 1)

**Files:**
- Modify: `src/lib/session/run.ts` (`Run`: `startedAt`, the constructor, `close`, a new `frameStopped`), `src/lib/session/runner.ts` (`end`: `run.close(result)`)
- Test: `src/lib/session/runner.test.ts` (a new describe block before "runner — capture carry-over"), `src/lib/session/runner.hooks.test.ts` (after "files a lease's frames under the first leg")

**Interfaces:**
- Consumes: `RunEnd` (`types.ts`), `FramePort` (`ports.ts`), the fakes and `hangingStop` (`runner.test.ts`), `withHooks` (`runner.hooks.test.ts`).
- Produces: `Run.startedAt: number`; `Run.close(result: RunEnd): Promise<void>` (was `close()`: its one caller is `runner.ts`); the frame `{ direction: 'out', type: 'session.stopped', payload: { reason: EndReason; code?: string; leg?: LegName; state: LegState | null; elapsedMs: number } }` to `deps.frames`, once per leg of the shape. Task 3's separator and Task 9's live test read it.

- [ ] **Step 1: Write the failing tests** (ruling 2 (i); choices 1, 2): a Stop in Both after each adapter's own goodbye, the time from Start rather than from live, a leg's failure, a failed start and a stop while opening, an ending that overran its bound, a lease's end after its release frame — and, green before as after, the case that frames nothing for a refusal, a stop while checking or a page going away.

```diff
diff --git a/src/lib/session/runner.test.ts b/src/lib/session/runner.test.ts
--- a/src/lib/session/runner.test.ts
+++ b/src/lib/session/runner.test.ts
@@ -882,6 +882,144 @@
   });
 });
 
+describe('runner — the Logs line each leg ends with (Stage 2 session end, ruling 2 (i))', () => {
+  /** Every frame the frames port saw: its leg, its type and its payload. */
+  function framesSeen() {
+    const seen: Array<[string, string, unknown]> = [];
+    const port: FramePort = { frame: (leg, f) => { seen.push([leg, f.type, f.payload]); } };
+    return { seen, port, stopped: () => seen.filter(([, type]) => type === 'session.stopped') };
+  }
+  /** The fake, but each session frames a goodbye as it stops: what an adapter says of its own ending. */
+  const sayingGoodbye = {
+    ...fakeProvider,
+    async start(request: StartRequest<unknown, unknown>, events: AdapterEvents) {
+      const session = await fakeProvider.start(request as never, events);
+      // Spreading a `FakeSession` instance would drop its prototype methods; delegate explicitly.
+      return {
+        info: session.info,
+        appendAudio: (pcm: Int16Array) => session.appendAudio(pcm),
+        appendText: (text: string) => session.appendText(text),
+        beginTurn: () => session.beginTurn(),
+        endTurn: () => session.endTurn(),
+        cancelTurn: () => session.cancelTurn(),
+        stop: () => {
+          events.frame({ direction: 'out', type: 'fake.goodbye' });
+          return session.stop();
+        },
+      };
+    },
+  } as unknown as AnyProvider;
+
+  it("a stop frames session.stopped once per leg, speaker first, after what each leg's adapter framed of its own ending: why, the leg's last state and the time since Start", async () => {
+    const frames = framesSeen();
+    const { runner, clock } = setup({ shape: { provider: sayingGoodbye, legs: ['speaker', 'participant'] }, frames: frames.port });
+    await runner.start();
+    clock.advance(4_000);
+    await runner.stop();
+    expect(frames.seen).toEqual([
+      ['participant', 'fake.goodbye', undefined],
+      ['speaker', 'fake.goodbye', undefined],
+      ['speaker', 'session.stopped', { reason: 'user', state: 'live', elapsedMs: 4_000 }],
+      ['participant', 'session.stopped', { reason: 'user', state: 'live', elapsedMs: 4_000 }],
+    ]);
+  });
+
+  it('counts the time from Start, not from when the leg went live', async () => {
+    const frames = framesSeen();
+    const { runner, clock } = setup({ settings: { startDelayMs: 2_000 }, frames: frames.port });
+    const starting = runner.start();
+    await flush();
+    clock.advance(2_000);
+    await starting;
+    expect(runner.state.getState()).toMatchObject({ phase: 'running', since: 2_000 });
+    clock.advance(3_000);
+    await runner.stop();
+    expect(frames.stopped()).toEqual([['speaker', 'session.stopped', { reason: 'user', state: 'live', elapsedMs: 5_000 }]]);
+  });
+
+  it("a leg's failure is each leg's reason, with its notice's code and the leg that failed", async () => {
+    const frames = framesSeen();
+    const { runner, clock } = setup({ shape: { legs: ['speaker', 'participant'] }, settings: { failAfterMs: 1_000 }, frames: frames.port });
+    await runner.start();
+    clock.advance(1_000);
+    await flush();
+    expect(frames.stopped()).toEqual([
+      ['speaker', 'session.stopped', { reason: 'leg-failed', code: 'leg_failed', leg: 'speaker', state: 'live', elapsedMs: 1_000 }],
+      ['participant', 'session.stopped', { reason: 'leg-failed', code: 'leg_failed', leg: 'speaker', state: 'live', elapsedMs: 1_000 }],
+    ]);
+  });
+
+  it('a start that fails, or a stop while its leg still opens, ends with the state the leg reached', async () => {
+    const failed = framesSeen();
+    const one = setup({ settings: { startThrows: true }, frames: failed.port });
+    await one.runner.start();
+    await flush();
+    expect(failed.seen).toEqual([['speaker', 'session.stopped', { reason: 'start-failed', code: 'start_failed', leg: 'speaker', state: 'opening', elapsedMs: 0 }]]);
+
+    const slow = framesSeen();
+    const two = setup({ settings: { startDelayMs: 2_000 }, frames: slow.port });
+    const starting = two.runner.start();
+    await flush();
+    two.clock.advance(500);
+    await two.runner.stop();
+    await starting;
+    expect(slow.seen).toEqual([['speaker', 'session.stopped', { reason: 'user', state: 'opening', elapsedMs: 500 }]]);
+  });
+
+  it('says nothing for a start refused before it opened anything, a stop while it checked, or a page going away', async () => {
+    const refused = framesSeen();
+    const one = setup({ settings: { buildRefused: true }, frames: refused.port });
+    await one.runner.start();
+    expect(refused.seen).toEqual([]);
+
+    const checking = framesSeen();
+    const two = setup({ ensureReady: () => new Promise(() => {}), frames: checking.port });
+    void two.runner.start();
+    await flush();
+    await two.runner.stop();
+    expect(checking.seen).toEqual([]);
+
+    const gone = framesSeen();
+    const three = setup({ frames: gone.port });
+    await three.runner.start();
+    three.runner.abandon();
+    await flush();
+    expect(gone.stopped()).toEqual([]);
+
+    // Nor an ending that overran its bound and was then abandoned, once its release gives up.
+    const overran = framesSeen();
+    const { provider } = hangingStop();
+    const four = setup({ shape: { provider }, frames: overran.port, closeTimeoutMs: 3_000, timeoutMs: 10_000 });
+    await four.runner.start();
+    const stopped = four.runner.stop();
+    await flush();
+    four.clock.advance(3_000);
+    await stopped;
+    four.runner.abandon();
+    for (let i = 0; i < 4; i++) {
+      four.clock.advance(10_000);
+      await flush();
+    }
+    expect(overran.stopped()).toEqual([]);
+  });
+
+  it('an ending that overran its bound says its line once its unwind finishes, counting to the stop, not to then', async () => {
+    const frames = framesSeen();
+    const { provider, finishStop } = hangingStop();
+    const { runner, clock } = setup({ shape: { provider }, frames: frames.port, closeTimeoutMs: 3_000, timeoutMs: 10_000 });
+    await runner.start();
+    clock.advance(600);
+    const stopped = runner.stop();
+    await flush();
+    clock.advance(3_000);
+    await stopped;
+    expect(frames.stopped()).toEqual([]);
+    finishStop();
+    await flush();
+    expect(frames.stopped()).toEqual([['speaker', 'session.stopped', { reason: 'user', state: 'live', elapsedMs: 600 }]]);
+  });
+});
+
 describe('runner — capture carry-over', () => {
   it('hands the adapter a request of the context, config, credentials, clock, signal and punctuator alone — no track, even from a source that has one (Stage 2 Palabra, ruling 16)', async () => {
     const requests: Array<StartRequest<never, never>> = [];
diff --git a/src/lib/session/runner.hooks.test.ts b/src/lib/session/runner.hooks.test.ts
--- a/src/lib/session/runner.hooks.test.ts
+++ b/src/lib/session/runner.hooks.test.ts
@@ -417,6 +417,27 @@
     expect(frames.frame).toHaveBeenCalledWith('speaker', frame);
   });
 
+  it("a lease's end is each leg's session.stopped, after the lease's own release frame (Stage 2 session end, ruling 2 (i))", async () => {
+    let endLease!: (notice: RunNotice) => void;
+    const seen: Array<[string, string, unknown]> = [];
+    const provider = withHooks({
+      acquire: async (_shape, _s, ctx) => {
+        endLease = ctx.end;
+        return { credentials: () => ({}), release: async () => { ctx.frame({ direction: 'out', type: 'session.end' }); } };
+      },
+    });
+    const { runner, clock } = setup(provider, ['speaker', 'participant'], undefined, undefined, { frame: (leg, f) => { seen.push([leg, f.type, f.payload]); } });
+    await runner.start();
+    clock.advance(30_000);
+    endLease({ code: 'budget_exhausted', message: 'Session budget exhausted' });
+    await flush();
+    expect(seen).toEqual([
+      ['speaker', 'session.end', undefined],
+      ['speaker', 'session.stopped', { reason: 'lease-ended', code: 'budget_exhausted', state: 'live', elapsedMs: 30_000 }],
+      ['participant', 'session.stopped', { reason: 'lease-ended', code: 'budget_exhausted', state: 'live', elapsedMs: 30_000 }],
+    ]);
+  });
+
   it("puts a lease's budget in the running state, and keeps it through a leg's change", async () => {
     let events!: AdapterEvents;
     const provider = withHooks(
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/lib/session/runner.test.ts src/lib/session/runner.hooks.test.ts`
Expected: FAIL — `6 failed | 121 passed (127)`: every case that expects a `session.stopped` (the runner frames none). "Says nothing for a start refused …" passes already, as it must: it pins the guards the code adds.

- [ ] **Step 3: Frame it from `close()`.**

```diff
diff --git a/src/lib/session/run.ts b/src/lib/session/run.ts
--- a/src/lib/session/run.ts
+++ b/src/lib/session/run.ts
@@ -65,6 +65,8 @@
 
 export class Run {
   readonly id: string;
+  /** When the run was created — Start — on the run's clock: what each leg's `session.stopped` counts from. */
+  readonly startedAt: number;
   readonly legStates = new Map<LegName, LegState>();
   /** When every leg went live; null until then. */
   liveSince: number | null = null;
@@ -99,6 +101,7 @@
   /** `host` is a factory because the runner's host closes over the run it serves. */
   constructor(private readonly deps: RunnerDeps, host: (run: Run) => RunHost, readonly shape: RunShape) {
     this.id = deps.newSessionId();
+    this.startedAt = deps.clock.now();
     this.host = host(this);
     this.stack = new ResourceStack(deps.clock, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS, (f) =>
       reportWarning('SessionRunner', `Releasing ${f.name} failed: ${f.message}`, { dedupeKey: `release:${f.name}` }));
@@ -295,8 +298,9 @@
     this.liveSince = deps.clock.now();
   }
 
-  /** Ends the run: decide nothing more, close an open turn, abort, wait for a leg still opening, unwind, finalize the legs, wait (bounded) for fill-in. */
-  async close(): Promise<void> {
+  /** Ends the run: decide nothing more, close an open turn, abort, wait for a leg still opening, unwind, finalize the legs, say each leg stopped, wait (bounded) for fill-in. */
+  async close(result: RunEnd): Promise<void> {
+    const endedAt = this.deps.clock.now();
     this.ending = true;
     if (this.turn?.close()) this.hold(false);
     this.controller.abort(new Error('the run ended'));
@@ -307,12 +311,41 @@
     await this.awaitOpening();
     await this.stack.unwind();
     for (const conversation of this.conversations.values()) conversation.finalizeAll();
+    this.frameStopped(result, endedAt);
     // Fill-in lands through `Conversation`'s own jobs, not `onEvent`; nothing
     // legitimate depends on the run still accepting events past this point.
     this.finished = true;
     await this.settled();
   }
 
+  /**
+   * One Logs line per leg once the unwind is done — after whatever its
+   * adapter framed of its own ending — as every old client's `disconnect()`
+   * logged `session.closed` (Stage 2 session end, ruling 2 (i); choices 1,
+   * 2). Only once the run reached its opening step — a refusal, or a stop
+   * while it checked, opened no leg — and not after `abandon()`: the page is
+   * going away. Why it stopped (the run's reason, and its notice's code and
+   * leg), the leg's last state, and the time from Start to the stop; never
+   * the notice's words, which may quote a provider.
+   */
+  private frameStopped(result: RunEnd, endedAt: number): void {
+    if (this.finished || this.conversations.size === 0) return;
+    const { reason, notice } = result;
+    for (const leg of this.shape.legs) {
+      this.deps.frames?.frame(leg, {
+        direction: 'out',
+        type: 'session.stopped',
+        payload: {
+          reason,
+          ...(notice?.code ? { code: notice.code } : {}),
+          ...(notice?.leg ? { leg: notice.leg } : {}),
+          state: this.legStates.get(leg) ?? null,
+          elapsedMs: endedAt - this.startedAt,
+        },
+      });
+    }
+  }
+
   /** `pagehide`: decide nothing more, close an open turn, abort, fire every release now, finalize the legs (spec: "Stopping, and closing the window"). */
   abandon(): void {
     this.ending = true;
diff --git a/src/lib/session/runner.ts b/src/lib/session/runner.ts
--- a/src/lib/session/runner.ts
+++ b/src/lib/session/runner.ts
@@ -128,7 +128,7 @@
           // Stop speaking now; the port is guarded, so a throw here cannot keep the run open.
           if (!refused) deps.playback.clear();
           deps.playback.live(false);
-          await run.close();
+          await run.close(result);
           if (liveSince !== null && !abandoned.has(run)) {
             const duration = endedAt - liveSince;
             const provider = run.shape.provider.id;
```

- [ ] **Step 4: Run the session suites.**

Run: `npx vitest run src/lib/session`
Expected: PASS — 11 files, 259 tests (the two files alone: 127). The frames cases already there ("hands every frame an adapter reports", "keeps a throwing frames port away", "files a lease's frames under the first leg") look only while the run is live, or with `toHaveBeenCalledWith`: a line at Stop reaches none of them.

- [ ] **Step 5: The gates.** The suite and the typecheck gate (in Wave 1, a failure in another task's files is that task's). `src/app/**` builds the frames port the app runs (`telemetry.ts`, `session.ts`): unchanged, and its suites stay green — `session.test.ts` stops runs through the real port with the log store on, but counts only its warning rows, and `session.stopped` is an info row.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/session/run.ts src/lib/session/runner.ts src/lib/session/runner.test.ts src/lib/session/runner.hooks.test.ts
```

```bash
git commit -q -F - -- src/lib/session/run.ts src/lib/session/runner.ts src/lib/session/runner.test.ts src/lib/session/runner.hooks.test.ts <<'EOF'
feat(session): frame session.stopped as each leg's last Logs line

A normal Stop left no line in the Logs, where every old client logged
session.closed from its disconnect(). Once the run has unwound, after
whatever each adapter framed of its own ending, the runner frames
session.stopped for each leg: the run's reason, its notice's code and
leg, the leg's last state and the time from Start. Nothing for a start
refused before it opened a leg, or on pagehide.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 3: The Logs draw their "session ended" separator after `session.stopped` (Wave 1)

**Files:**
- Modify: `src/components/LogsPanel/LogsPanel.tsx` (`renderLogEntry`'s `isSessionEnd`)
- Test: `src/components/LogsPanel/LogsPanel.test.tsx` (a new describe block before "grouped rows")

**Interfaces:**
- Consumes: the frame name `session.stopped` (Task 2), as a string; the frame name `session.delete_warning` (Task 7), as a string. Neither task's code is needed: the cases write the store's entries themselves.
- Produces: the separator after a `session.stopped` entry, and after nothing else.

- [ ] **Step 1: Write the failing test** (choice 7, beyond the brief), and pin the warning row Task 7's name gives (choice 5; green before as after — the suffix rule is landed).

```diff
diff --git a/src/components/LogsPanel/LogsPanel.test.tsx b/src/components/LogsPanel/LogsPanel.test.tsx
--- a/src/components/LogsPanel/LogsPanel.test.tsx
+++ b/src/components/LogsPanel/LogsPanel.test.tsx
@@ -163,6 +163,29 @@
     });
   });
 
+  describe('the ends of a session (Stage 2 session end)', () => {
+    const rows = (container: HTMLElement) => Array.from(container.querySelectorAll('.event-entry, .session-separator'))
+      .map((el) => (el.classList.contains('session-separator') ? '—' : el.querySelector('.event-type')?.textContent));
+
+    it("draws the session-ended separator after the runner's session.stopped, each leg's last line, and not after a server's session.closed before it (choice 7)", () => {
+      write(() => {
+        useLogStore.getState().addRealtimeEvent({ type: 'session.closed', data: {} } as never, 'server', 'session.closed', 'speaker');
+        useLogStore.getState().addRealtimeEvent({ type: 'session.stopped', data: { reason: 'leg-closed' } } as never, 'client', 'session.stopped', 'speaker');
+        useLogStore.getState().addRealtimeEvent({ type: 'session.opened', data: {} } as never, 'client', 'session.opened', 'speaker');
+      });
+      const { container } = render(<LogsPanel toggleLogs={() => {}} />);
+      expect(rows(container)).toEqual(['session.closed', 'session.stopped', '—', 'session.opened']);
+    });
+
+    it("marks a failed REST delete as a warning, by its name's suffix (ruling 2 (ii); choice 5)", () => {
+      write(() => {
+        useLogStore.getState().addRealtimeEvent({ type: 'session.delete_warning', data: { status: 404 } } as never, 'server', 'session.delete_warning', 'speaker');
+      });
+      const { container } = render(<LogsPanel toggleLogs={() => {}} />);
+      expect(container.querySelector('.event-entry.warning')).not.toBeNull();
+    });
+  });
+
   describe('grouped rows', () => {
     // A silent session's mic appends all land in one row. The store keeps only
     // the newest MAX_EVENTS_PER_GROUP of them (#531), so the row's count has to
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run src/components/LogsPanel`
Expected: FAIL — `1 failed | 11 passed (12)`: the separator case (it follows `session.closed`, not `session.stopped`).

- [ ] **Step 3: Draw it after `session.stopped`.**

```diff
diff --git a/src/components/LogsPanel/LogsPanel.tsx b/src/components/LogsPanel/LogsPanel.tsx
--- a/src/components/LogsPanel/LogsPanel.tsx
+++ b/src/components/LogsPanel/LogsPanel.tsx
@@ -262,9 +262,11 @@
   const renderLogEntry = useCallback((log: LogEntry) => {
     const elements: React.ReactNode[] = [];
 
-    // Check if this is a session end marker
-    const isSessionEnd = log.eventType === 'session.closed' ||
-                        (log.message && log.message.includes('session.closed'));
+    // The separator follows the runner's `session.stopped`, each leg's last
+    // line of a session, as it followed the old clients' `session.closed`; a
+    // server's own `session.closed` (OpenAI Translate's) comes before that
+    // line anyway (Stage 2 session end, choice 7).
+    const isSessionEnd = log.eventType === 'session.stopped';
 
     // Render the log entry itself
     if (log.events && log.events.length > 0 && log.source) {
```

- [ ] **Step 4: Run the Logs' suites.**

Run: `npx vitest run src/components/LogsPanel src/stores/logStore.test.ts`
Expected: PASS — 2 files, 37 tests.

- [ ] **Step 5: The gates.** The suite, the typecheck gate, and the full tree: 259, `LogsPanel.tsx`'s four pre-existing lines still four (two of them two lines lower).

- [ ] **Step 6: Commit.**

```bash
git add src/components/LogsPanel/LogsPanel.tsx src/components/LogsPanel/LogsPanel.test.tsx
```

```bash
git commit -q -F - -- src/components/LogsPanel/LogsPanel.tsx src/components/LogsPanel/LogsPanel.test.tsx <<'EOF'
feat(logs): draw the session-ended separator after session.stopped

The Logs drew their separator after session.closed, which only the old
clients' disconnect() and OpenAI Translate's server close still say.
The runner's session.stopped is now each leg's last line of a session,
and the separator follows it instead.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 4: The setup wizard leaves display modes alone (Wave 1)

**Files:**
- Modify: `src/lib/setup/scenarios.ts` (the header, `ScenarioDisplayMode`, `ScenarioPreset`, `SCENARIOS`), `src/components/SetupWizard/applySetup.ts` (the header, `ApplySetupDeps`, `applySetupDraft`), `src/components/SetupWizard/useApplySetup.ts` (the deps it binds)
- Test: `src/lib/setup/scenarios.test.ts` (the presets' pin), `src/components/SetupWizard/applySetup.test.ts` (the import, the helper, two cases and one new), `src/components/SetupWizard/useApplySetup.test.ts` (one new case)

**Interfaces:**
- Consumes: `SCENARIOS`, `useSettingsStore` (`speakerDisplayMode`, `participantDisplayMode`, `settings.common.*DisplayMode`).
- Produces: `ScenarioPreset` is `{ id; mode; textOnly }`; `ScenarioDisplayMode` is gone; `ApplySetupDeps` has no display-mode setter. Nothing else imports either (research note 6).

- [ ] **Step 1: Write the failing tests** (ruling 1; choice 11): the presets pinned whole, no display mode written for any scenario even when a setter is offered, and through the real stores a chosen mode surviving a re-run.

```diff
diff --git a/src/lib/setup/scenarios.test.ts b/src/lib/setup/scenarios.test.ts
--- a/src/lib/setup/scenarios.test.ts
+++ b/src/lib/setup/scenarios.test.ts
@@ -11,17 +11,12 @@
     ]);
   });
 
-  it('pins the presets the spec table lists', () => {
-    expect(getScenario('understand-others')).toMatchObject({ mode: 'participant', textOnly: true, participantDisplayMode: 'translation' });
-    expect(getScenario('be-heard')).toMatchObject({ mode: 'speaker', textOnly: false, speakerDisplayMode: 'both' });
-    expect(getScenario('subtitle-myself')).toMatchObject({ mode: 'speaker', textOnly: true, speakerDisplayMode: 'translation' });
-    expect(getScenario('two-way-voice')).toMatchObject({ mode: 'both', textOnly: false, speakerDisplayMode: 'both', participantDisplayMode: 'both' });
-    expect(getScenario('two-way-text')).toMatchObject({ mode: 'both', textOnly: true, speakerDisplayMode: 'both', participantDisplayMode: 'both' });
-  });
-
-  it('leaves the display mode of a leg the scenario does not run untouched', () => {
-    expect(getScenario('understand-others').speakerDisplayMode).toBeUndefined();
-    expect(getScenario('be-heard').participantDisplayMode).toBeUndefined();
+  it('pins the presets the spec table lists: a mode and whether the speaker leg speaks, and nothing else — no display mode (Stage 2 session end, ruling 1)', () => {
+    expect(getScenario('understand-others')).toEqual({ id: 'understand-others', mode: 'participant', textOnly: true });
+    expect(getScenario('be-heard')).toEqual({ id: 'be-heard', mode: 'speaker', textOnly: false });
+    expect(getScenario('subtitle-myself')).toEqual({ id: 'subtitle-myself', mode: 'speaker', textOnly: true });
+    expect(getScenario('two-way-voice')).toEqual({ id: 'two-way-voice', mode: 'both', textOnly: false });
+    expect(getScenario('two-way-text')).toEqual({ id: 'two-way-text', mode: 'both', textOnly: true });
   });
 });
 
diff --git a/src/components/SetupWizard/applySetup.test.ts b/src/components/SetupWizard/applySetup.test.ts
--- a/src/components/SetupWizard/applySetup.test.ts
+++ b/src/components/SetupWizard/applySetup.test.ts
@@ -3,14 +3,13 @@
 import type { ApplySetupDeps } from './applySetup';
 import { initialDraft } from './setupDraft';
 import type { SetupDraft } from './setupDraft';
+import { SCENARIOS } from '../../lib/setup/scenarios';
 import { Provider } from '../../types/Provider';
 
 function deps(overrides: Partial<ApplySetupDeps> = {}): ApplySetupDeps {
   return {
     setMode: vi.fn(),
     setTextOnly: vi.fn(),
-    setSpeakerDisplayMode: vi.fn(),
-    setParticipantDisplayMode: vi.fn(),
     applyProvider: vi.fn(async () => {}),
     completeSetup: vi.fn(async () => {}),
     ...overrides,
@@ -32,16 +31,25 @@
 
     expect(d.setMode).toHaveBeenCalledWith('speaker');
     expect(d.setTextOnly).toHaveBeenCalledWith(false);
-    expect(d.setSpeakerDisplayMode).toHaveBeenCalledWith('both');
-    expect(d.setParticipantDisplayMode).not.toHaveBeenCalled();
     expect(d.applyProvider).toHaveBeenCalledWith(Provider.SONIOX, { source: 'en', target: 'ja' }, { apiKey: 'sk-1' }, {});
     expect(d.completeSetup).toHaveBeenCalledWith({ scenario: 'be-heard', providerPath: 'own-key', provider: Provider.SONIOX });
 
-    const seq = order([d.setMode, d.setTextOnly, d.setSpeakerDisplayMode, d.applyProvider, d.completeSetup] as any);
+    const seq = order([d.setMode, d.setTextOnly, d.applyProvider, d.completeSetup] as any);
     expect([...seq].sort((a, b) => a - b)).toEqual(seq);   // strictly increasing
     expect(Object.keys(d)).not.toContain('setUIMode');
   });
 
+  it('writes no display mode for any scenario, so a mode the user chose survives a re-run (Stage 2 session end, ruling 1)', async () => {
+    for (const { id } of SCENARIOS) {
+      // The two setters the wizard used to call, offered all the same: it reaches for neither.
+      const d = { ...deps(), setSpeakerDisplayMode: vi.fn(), setParticipantDisplayMode: vi.fn() };
+      await applySetupDraft(draft({ scenario: id }), d);
+      expect(d.setSpeakerDisplayMode).not.toHaveBeenCalled();
+      expect(d.setParticipantDisplayMode).not.toHaveBeenCalled();
+      expect(d.completeSetup).toHaveBeenCalledWith(expect.objectContaining({ scenario: id }));
+    }
+  });
+
   it('omits credentials when they were skipped, and on the managed and offline paths', async () => {
     const skipped = deps();
     await applySetupDraft(draft({ credentials: {}, credentialsValidated: false, credentialsPending: true }), skipped);
@@ -71,13 +79,11 @@
     expect(offline.applyProvider).toHaveBeenCalledWith(Provider.LOCAL_INFERENCE, { source: 'en', target: 'ja' }, {}, {});
   });
 
-  it('sets participant display for the listening scenario and leaves the speaker one alone', async () => {
+  it("sets the listening scenario's mode, and text-only for hygiene", async () => {
     const d = deps();
     await applySetupDraft(draft({ scenario: 'understand-others', providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, credentials: {} }), d);
     expect(d.setMode).toHaveBeenCalledWith('participant');
     expect(d.setTextOnly).toHaveBeenCalledWith(true);
-    expect(d.setParticipantDisplayMode).toHaveBeenCalledWith('translation');
-    expect(d.setSpeakerDisplayMode).not.toHaveBeenCalled();
   });
 
   it('awaits applyProvider so a rejected write surfaces to the caller, and skips the record', async () => {
diff --git a/src/components/SetupWizard/useApplySetup.test.ts b/src/components/SetupWizard/useApplySetup.test.ts
--- a/src/components/SetupWizard/useApplySetup.test.ts
+++ b/src/components/SetupWizard/useApplySetup.test.ts
@@ -28,6 +28,7 @@
 import { readCredentials } from '../../lib/provider/credentials';
 import { volcengineAst2Provider } from '../../providers/volcengine_ast2/provider';
 import { useProviderStore } from '../../stores/providerStore';
+import { useSettingsStore } from '../../stores/settingsStore';
 import { useApplySetup } from './useApplySetup';
 import { initialDraft } from './setupDraft';
 import type { SetupDraft } from './setupDraft';
@@ -61,6 +62,22 @@
     expect(setSetting).toHaveBeenCalledWith('settings.localInference.targetLanguage', 'ja');
   });
 
+  it('leaves both display modes as the user chose them: a re-run of a two-way scenario writes neither (Stage 2 session end, ruling 1)', async () => {
+    useSettingsStore.setState({ speakerDisplayMode: 'source', participantDisplayMode: 'source' });
+    try {
+      const { result } = renderHook(() => useApplySetup());
+
+      await result.current(draft({ scenario: 'two-way-voice' }));
+
+      expect(useSettingsStore.getState().speakerDisplayMode).toBe('source');
+      expect(useSettingsStore.getState().participantDisplayMode).toBe('source');
+      expect(setSetting).not.toHaveBeenCalledWith('settings.common.speakerDisplayMode', expect.anything());
+      expect(setSetting).not.toHaveBeenCalledWith('settings.common.participantDisplayMode', expect.anything());
+    } finally {
+      useSettingsStore.setState({ speakerDisplayMode: 'both', participantDisplayMode: 'both' });
+    }
+  });
+
   it("drops credentials the provider does not take (LocalInference's own credentials.keys is empty)", async () => {
     const { result } = renderHook(() => useApplySetup());
 
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/lib/setup/scenarios.test.ts src/components/SetupWizard/applySetup.test.ts src/components/SetupWizard/useApplySetup.test.ts`
Expected: FAIL — `8 failed | 12 passed (20)`: the three new rule cases — the presets still carry display modes, the wizard calls the offered setters, and the store's modes become `both` — and five landed `applySetup` cases, whose helper no longer offers the setters the code before this task calls (`deps.setSpeakerDisplayMode is not a function`).

- [ ] **Step 3: Drop the fields and the writes.**

```diff
diff --git a/src/lib/setup/scenarios.ts b/src/lib/setup/scenarios.ts
--- a/src/lib/setup/scenarios.ts
+++ b/src/lib/setup/scenarios.ts
@@ -2,7 +2,9 @@
 //
 // The five first-run scenarios and what each one sets. This is the whole
 // "preset" concept: a scenario is a translation mode plus whether the speaker
-// leg should speak, plus which half of a bilingual utterance each leg shows.
+// leg should speak. It sets no display mode: which half of a bilingual
+// utterance each leg shows stays the user's, a re-run of the wizard included
+// (Stage 2 session end, ruling 1).
 // The participant leg never speaks (every descriptor's
 // buildParticipantSessionConfig forces textOnly, see utils/effectiveTextOnly),
 // so `participant` has no voice variant.
@@ -11,23 +13,19 @@
 import type { ScenarioId } from './types';
 
 export type ScenarioMode = 'speaker' | 'participant' | 'both';
-export type ScenarioDisplayMode = 'source' | 'translation' | 'both';
 
 export interface ScenarioPreset {
   id: ScenarioId;
   mode: ScenarioMode;
   textOnly: boolean;
-  /** Left undefined when the scenario does not run that leg (spec §1.2). */
-  speakerDisplayMode?: ScenarioDisplayMode;
-  participantDisplayMode?: ScenarioDisplayMode;
 }
 
 export const SCENARIOS: readonly ScenarioPreset[] = [
-  { id: 'understand-others', mode: 'participant', textOnly: true, participantDisplayMode: 'translation' },
-  { id: 'be-heard', mode: 'speaker', textOnly: false, speakerDisplayMode: 'both' },
-  { id: 'subtitle-myself', mode: 'speaker', textOnly: true, speakerDisplayMode: 'translation' },
-  { id: 'two-way-voice', mode: 'both', textOnly: false, speakerDisplayMode: 'both', participantDisplayMode: 'both' },
-  { id: 'two-way-text', mode: 'both', textOnly: true, speakerDisplayMode: 'both', participantDisplayMode: 'both' },
+  { id: 'understand-others', mode: 'participant', textOnly: true },
+  { id: 'be-heard', mode: 'speaker', textOnly: false },
+  { id: 'subtitle-myself', mode: 'speaker', textOnly: true },
+  { id: 'two-way-voice', mode: 'both', textOnly: false },
+  { id: 'two-way-text', mode: 'both', textOnly: true },
 ];
 
 export function getScenario(id: ScenarioId): ScenarioPreset {
diff --git a/src/components/SetupWizard/applySetup.ts b/src/components/SetupWizard/applySetup.ts
--- a/src/components/SetupWizard/applySetup.ts
+++ b/src/components/SetupWizard/applySetup.ts
@@ -4,7 +4,9 @@
 // as an argument so this stays testable without the stores' import graph, and
 // so the ORDER is a fact of this file rather than of whichever component calls
 // it: the provider's write before the record (the app session's readiness
-// then re-checks once, over final values), record last.
+// then re-checks once, over final values), record last. No display mode: a
+// mode the user chose stays chosen, whatever the scenario and however often
+// the wizard runs (Stage 2 session end, ruling 1).
 import { getScenario } from '../../lib/setup/scenarios';
 import type { ProviderPath, ScenarioId } from '../../lib/setup/types';
 import type { ProviderType } from '../../types/Provider';
@@ -13,8 +15,6 @@
 export interface ApplySetupDeps {
   setMode: (m: 'speaker' | 'participant' | 'both') => void;
   setTextOnly: (v: boolean) => void;
-  setSpeakerDisplayMode: (m: 'source' | 'translation' | 'both') => Promise<void> | void;
-  setParticipantDisplayMode: (m: 'source' | 'translation' | 'both') => Promise<void> | void;
   /** The provider, its pair and — on the own-key path — its credentials and
    *  the credential choice its step showed (a settings patch; F4), written
    *  where the session reads them; the one write the wizard makes besides
@@ -37,8 +37,6 @@
 
   deps.setMode(preset.mode);
   deps.setTextOnly(preset.textOnly);
-  if (preset.speakerDisplayMode) await deps.setSpeakerDisplayMode(preset.speakerDisplayMode);
-  if (preset.participantDisplayMode) await deps.setParticipantDisplayMode(preset.participantDisplayMode);
 
   const credentials = providerPath === 'own-key' && !draft.credentialsPending ? draft.credentials : {};
   // The credential choice the step showed is written even when the key was
diff --git a/src/components/SetupWizard/useApplySetup.ts b/src/components/SetupWizard/useApplySetup.ts
--- a/src/components/SetupWizard/useApplySetup.ts
+++ b/src/components/SetupWizard/useApplySetup.ts
@@ -20,8 +20,6 @@
     await applySetupDraft(draft, {
       setMode: useAudioStore.getState().setMode,
       setTextOnly: s.setTextOnly,
-      setSpeakerDisplayMode: s.setSpeakerDisplayMode,
-      setParticipantDisplayMode: s.setParticipantDisplayMode,
       applyProvider: async (provider, pair, credentials, settings) => {
         const id = providerIdFromStored(provider);
         const p = presentProviders().find((candidate) => candidate.id === id);
```

- [ ] **Step 4: Run the wizard's suites.**

Run: `npx vitest run src/lib/setup src/components/SetupWizard`
Expected: PASS — 13 files, 124 tests (the three files alone: 20). `SetupWizard.test.tsx` mocks `useApplySetup` whole; the steps read no preset's display mode.

- [ ] **Step 5: The gates.** The suite, the typecheck gate, and the full tree: 259, none naming `src/lib/setup/`.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/setup/scenarios.ts src/lib/setup/scenarios.test.ts src/components/SetupWizard/applySetup.ts src/components/SetupWizard/applySetup.test.ts src/components/SetupWizard/useApplySetup.ts src/components/SetupWizard/useApplySetup.test.ts
```

```bash
git commit -q -F - -- src/lib/setup/scenarios.ts src/lib/setup/scenarios.test.ts src/components/SetupWizard/applySetup.ts src/components/SetupWizard/applySetup.test.ts src/components/SetupWizard/useApplySetup.ts src/components/SetupWizard/useApplySetup.test.ts <<'EOF'
fix(setup): the wizard no longer sets display modes

Every completion of the setup wizard, a re-run included, applied its
scenario's display modes and overwrote a mode the user had chosen since.
The presets now carry a mode and whether the speaker leg speaks, nothing
more, and the wizard writes no display mode: both stay as stored.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 5: Doubao AST 2.0 frames its `FinishSession` (Wave 2)

**Files:**
- Modify: `src/providers/volcengine_ast2/adapter.ts` (`stop`)
- Test: `src/providers/volcengine_ast2/adapter.test.ts` (the stop case, and one after it)

**Interfaces:**
- Consumes: Task 1's rule (the conformance scenarios stop a live session); `liveAst2`, `SERVER`, `EventType`, `flush`.
- Produces: the frame `session.finish` (`out`) `{ sessionId }`.

- [ ] **Step 1: Write the failing test** (ruling 2 (ii), (iv); choices 4, 10), and pin that an ended session sends and frames none (green before as after).

```diff
diff --git a/src/providers/volcengine_ast2/adapter.test.ts b/src/providers/volcengine_ast2/adapter.test.ts
--- a/src/providers/volcengine_ast2/adapter.test.ts
+++ b/src/providers/volcengine_ast2/adapter.test.ts
@@ -659,7 +659,7 @@
     expect(h.of('segmentOpened')).toHaveLength(1);
   });
 
-  it('stop sends FinishSession and closes the socket before it returns, cancels every timer, and nothing follows — a decode still running included', async () => {
+  it('stop sends FinishSession, framed, and closes the socket before it returns, cancels every timer, and nothing follows — a decode still running included (Stage 2 session end, ruling 2 (ii), (iv))', async () => {
     const waiting: Array<() => void> = [];
     const decode: OggDecoder = (ogg) => new Promise((resolve) => { waiting.push(() => resolve(new Int16Array(ogg.length))); });
     const h = await liveAst2({ decode });
@@ -672,6 +672,8 @@
     const stopping = h.session.stop();
     expect(h.requests().map((r) => r.event).slice(-1)).toEqual([EventType.FinishSession]);
     expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
+    // The one line the ending says, before it returns; SessionFinished is not awaited.
+    expect(h.log.slice(n)).toEqual([{ kind: 'frame', payload: { direction: 'out', type: 'session.finish', payload: { sessionId: 'id-1' } } }]);
     await stopping;
     expect(h.timers()).toBe(0);
     waiting[0]();
@@ -679,6 +681,16 @@
     await flush();
     h.session.appendAudio(chunk());
     h.session.endTurn();
+    expect(h.log.length).toBe(n + 1);
+  });
+
+  it('a stop on a session already ended sends and frames no FinishSession (Stage 2 session end, ruling 2 (ii))', async () => {
+    const h = await liveAst2();
+    h.socket().serverClose(1006, '');
+    await flush();
+    const n = h.log.length;
+    await h.session.stop();
+    expect(h.requests().map((r) => r.event)).not.toContain(EventType.FinishSession);
     expect(h.log.length).toBe(n);
   });
 
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run src/providers/volcengine_ast2/adapter.test.ts`
Expected: FAIL — `1 failed | 45 passed (46)`: the stop case (no `session.finish`).

- [ ] **Step 3: Frame it with the send.**

```diff
diff --git a/src/providers/volcengine_ast2/adapter.ts b/src/providers/volcengine_ast2/adapter.ts
--- a/src/providers/volcengine_ast2/adapter.ts
+++ b/src/providers/volcengine_ast2/adapter.ts
@@ -155,9 +155,17 @@
     this.tail(true);
   }
 
-  /** `FinishSession` and the close before its first `await`; what the server still sends is not awaited (parity). */
+  /**
+   * `FinishSession`, framed, and the close before its first `await`. Its
+   * `SessionFinished`, and the billing it carries, is not awaited: Stop stays
+   * fast, and the old client read neither (parity; Stage 2 session end,
+   * ruling 2 (ii), (iv)).
+   */
   stop(): Promise<void> {
-    if (this.phase === 'live' && this.socket.readyState === WS_OPEN) this.socket.send(finishSessionFrame(this.ids, this.sequence++));
+    if (this.phase === 'live' && this.socket.readyState === WS_OPEN) {
+      this.socket.send(finishSessionFrame(this.ids, this.sequence++));
+      this.frame('out', 'session.finish', { sessionId: this.ids.session });
+    }
     this.shutDown();
     return Promise.resolve();
   }
```

- [ ] **Step 4: Run Doubao's suites.**

Run: `npx vitest run src/providers/volcengine_ast2`
Expected: PASS — 14 files, 164 tests (the adapter's file alone: 46); the conformance scenarios among them, through Task 1's rule.

- [ ] **Step 5: The gates.** The suite and the typecheck gate (in Wave 2, a failure in another task's files is that task's).

- [ ] **Step 6: Commit.**

```bash
git add src/providers/volcengine_ast2/adapter.ts src/providers/volcengine_ast2/adapter.test.ts
```

```bash
git commit -q -F - -- src/providers/volcengine_ast2/adapter.ts src/providers/volcengine_ast2/adapter.test.ts <<'EOF'
feat(volcengine-ast2): frame the FinishSession sent at Stop

Stop sent FinishSession unframed, where session.start is framed. It is
now a Logs line, session.finish, with the session id. SessionFinished is
still not awaited: Stop stays fast.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 6: Soniox frames the end of its STT stream and of a speaking TTS stream (Wave 2)

**Files:**
- Modify: `src/providers/soniox/adapter.ts` (`SonioxCore.shutdown`), `src/providers/soniox/speech.ts` (`LegSpeech.close`), `src/providers/soniox/ttsStream.ts` (`SonioxTtsStream.close`)
- Test: `src/providers/soniox/adapter.test.ts` (the bad-key case, the stop case and two after it, the stop while the TTS socket opens), `src/providers/soniox/speech.test.ts` (the close case, and one after it), `src/providers/soniox/ttsStream.test.ts` (two after "stays silent on an intentional close")

**Interfaces:**
- Consumes: Task 1's rule; `live`, `started`, `msg`, `orig`, `tr`, `Json` (`testing.ts`), `MockWebSocket` and `openTts` (`ttsStream.test.ts`).
- Produces: `SonioxTtsStream.close(): string | null` — the id of the stream it ended with `text_end`, else `null` (the old client, which re-exports it, ignores the value); the frames `stt.end` and `tts.end { streamId }` (`out`).

- [ ] **Step 1: Write the failing tests** (ruling 2 (ii); choices 4, 8): the stream's end at Stop, a speaking TTS stream's `text_end` after it, what `close()` returns, the line `LegSpeech.close()` says; the bad key's `failed` now followed by `stt.end` (research note 5); and, green before as after, a stop after a failure and a close with no stream speaking, which say nothing.

```diff
diff --git a/src/providers/soniox/adapter.test.ts b/src/providers/soniox/adapter.test.ts
--- a/src/providers/soniox/adapter.test.ts
+++ b/src/providers/soniox/adapter.test.ts
@@ -145,7 +145,8 @@
     expect(stt().closedByClient).not.toBeNull();
     await flush();
     expect(of('failed')).toHaveLength(1);
-    expect(log[log.length - 1].kind).toBe('failed');
+    // After it, only the Logs line for the stream's end its shutdown still sent (Stage 2 session end, ruling 2 (ii)).
+    expect(log.slice(-2).map((e) => (e.kind === 'frame' ? e.payload.type : e.kind))).toEqual(['failed', 'stt.end']);
   });
 
   it("words every other STT error by its type, keeping the server's words", async () => {
@@ -390,19 +391,43 @@
     expect(log.indexOf(of('speechRanges')[0])).toBeGreaterThan(log.indexOf(audio[1]));
   });
 
-  it('stop closes both sockets before its first await, and nothing follows', async () => {
+  it('stop ends the stream, framed, and closes both sockets before its first await, and nothing follows (Stage 2 session end, ruling 2 (ii))', async () => {
     const { session, stt, tts, log, clock, timers } = await live();
     const n = log.length;
     const stopping = session.stop();
     expect(stt().closedByClient).not.toBeNull();
     expect(tts().closedByClient).not.toBeNull();
-    // The end of the stream: an empty text frame.
+    // The end of the stream: an empty text frame, and its Logs line — no TTS stream was speaking.
     expect(stt().sent[stt().sent.length - 1]).toBe('');
+    expect(log.slice(n)).toEqual([{ kind: 'frame', payload: { direction: 'out', type: 'stt.end' } }]);
     // Both keepalives stopped with their sockets.
     expect(timers()).toBe(0);
     await stopping;
     clock.advance(60_000);
     await flush();
+    expect(log.length).toBe(n + 1);
+  });
+
+  it('stop ends a TTS stream still speaking with text_end, framed after the STT stream\'s end (Stage 2 session end, ruling 2 (ii))', async () => {
+    const { session, stt, tts, log } = await live();
+    // A final translation with no sentence end and no <end> yet: its TTS stream is still open.
+    stt().receive(msg(orig('Hello'), tr('こんにちは')));
+    expect(tts().sentJson<Json>().filter((m) => m.text_end === true)).toEqual([]);
+    const n = log.length;
+    await session.stop();
+    expect(tts().sentJson<Json>().slice(-1)).toEqual([{ stream_id: 'utt-1-1', text: '', text_end: true }]);
+    expect(log.slice(n)).toEqual([
+      { kind: 'frame', payload: { direction: 'out', type: 'stt.end' } },
+      { kind: 'frame', payload: { direction: 'out', type: 'tts.end', payload: { streamId: 'utt-1-1' } } },
+    ]);
+  });
+
+  it('a stop after the session failed sends and frames no end: its socket is gone', async () => {
+    const { session, stt, log } = await live();
+    stt().serverClose(1011, 'server error');
+    await flush();
+    const n = log.length;
+    await session.stop();
     expect(log.length).toBe(n);
   });
 
@@ -492,7 +517,7 @@
       expect(h.frames('tts.connect_failed')).toEqual([]);
     });
 
-    it('a stop while the TTS socket still opens closes it, and nothing follows', async () => {
+    it('a stop while the TTS socket still opens closes it, and nothing follows but the STT stream\'s end', async () => {
       const h = started();
       expect(await sttOpened(h)).toBeGreaterThanOrEqual(0);
       const session = await h.starting;
@@ -506,7 +531,8 @@
       expect(h.timers()).toBe(0);
       h.clock.advance(20_000);
       await flush();
-      expect(h.log.length).toBe(n);
+      // No TTS stream was open to end (Stage 2 session end, ruling 2 (ii)).
+      expect(h.log.slice(n)).toEqual([{ kind: 'frame', payload: { direction: 'out', type: 'stt.end' } }]);
     });
   });
 
diff --git a/src/providers/soniox/speech.test.ts b/src/providers/soniox/speech.test.ts
--- a/src/providers/soniox/speech.test.ts
+++ b/src/providers/soniox/speech.test.ts
@@ -391,25 +391,39 @@
     expect(frames('tts.speak')).toHaveLength(1);
   });
 
-  it('close stops everything: nothing after it', async () => {
+  it('close ends the stream still speaking with text_end, says so, and stops everything: nothing after it (Stage 2 session end, ruling 2 (ii))', async () => {
     const { speech, tts, sockets, log, clock } = await setup();
     speech.speak(2, 'and so', [0, 6], 'en');
     const socket = tts();
     const n = log.length;
     speech.close();
-    expect(log.length).toBe(n);
+    expect(socket.sentJson<Json>().slice(-1)).toEqual([{ stream_id: 'utt-1-1', text: '', text_end: true }]);
+    expect(log.slice(n)).toEqual([{ kind: 'frame', payload: { direction: 'out', type: 'tts.end', payload: { streamId: 'utt-1-1' } } }]);
     expect(socket.closedByClient).not.toBeNull();
+    const ended = log.length;
     await flush();
     clock.advance(60_000);
     await flush();
-    expect(log.length).toBe(n);
+    expect(log.length).toBe(ended);
     speech.speak(4, 'More.', [0, 5], 'en');
     speech.endUtterance();
     await flush();
-    expect(log.length).toBe(n);
+    expect(log.length).toBe(ended);
     expect(sockets.all).toHaveLength(1);
   });
 
+  it('close with no stream speaking sends no text_end and says nothing', async () => {
+    const { speech, tts, log } = await setup();
+    speech.speak(2, 'Done.', [0, 5], 'en');
+    speech.endUtterance();
+    const socket = tts();
+    const sent = socket.sent.length;
+    const n = log.length;
+    speech.close();
+    expect(socket.sent).toHaveLength(sent);
+    expect(log.length).toBe(n);
+  });
+
   it('sends the leg\'s voice, speed and key, and a client reference only when there is one', async () => {
     const leased = await setup({ region: 'eu', voice: 'Maya', speed: 1.2, clientReferenceId: 'ref-1' });
     expect(leased.tts().url).toBe('wss://tts-rt.eu.soniox.com/tts-websocket');
diff --git a/src/providers/soniox/ttsStream.test.ts b/src/providers/soniox/ttsStream.test.ts
--- a/src/providers/soniox/ttsStream.test.ts
+++ b/src/providers/soniox/ttsStream.test.ts
@@ -181,6 +181,24 @@
     expect(ws.readyState).toBe(MockWebSocket.CLOSED);
   });
 
+  it('close ends the active stream with text_end and returns its id; with none active, and once closed, it returns null (Stage 2 session end, ruling 2 (ii))', async () => {
+    const { t, ws } = await openTts();
+    t.sendText('hello', 'en');
+    expect(t.close()).toBe('utt-1-1');
+    expect(ended(ws)).toEqual(['utt-1-1']);
+    expect(t.close()).toBeNull();
+    expect(ended(ws)).toEqual(['utt-1-1']);
+  });
+
+  it('close with no stream active returns null and sends no text_end', async () => {
+    const { t, ws } = await openTts();
+    t.sendText('hello', 'en');
+    t.endUtterance();
+    expect(ended(ws)).toEqual(['utt-1-1']);
+    expect(t.close()).toBeNull();
+    expect(ended(ws)).toEqual(['utt-1-1']);
+  });
+
   it('drops audio for a stream_id that does not match the active/draining stream, but forwards a matching one', async () => {
     const { t, ws } = await openTts();
     const chunks: Int16Array[] = [];
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/soniox/adapter.test.ts src/providers/soniox/speech.test.ts src/providers/soniox/ttsStream.test.ts`
Expected: FAIL — `7 failed | 154 passed (161)`: the two `close()` return cases, the speech close case, the bad-key case, the two stop cases and the stop while the TTS socket opens — no `stt.end` or `tts.end` is framed, and `close()` returns nothing.

- [ ] **Step 3: Frame each end with its send.**

```diff
diff --git a/src/providers/soniox/adapter.ts b/src/providers/soniox/adapter.ts
--- a/src/providers/soniox/adapter.ts
+++ b/src/providers/soniox/adapter.ts
@@ -437,8 +437,13 @@
     this.mixer?.stop();
     const stt = this.stt;
     this.stt = null;
-    // The empty text frame ends the stream (`SonioxClient.ts:1540-1589`); its trailing tokens are not awaited.
-    stt?.end();
+    // The empty text frame ends the stream (`SonioxClient.ts:1540-1589`); its
+    // trailing tokens are not awaited. Framed as `stt.finalize` is, past the
+    // core's own end: the ending's one line (Stage 2 session end, ruling 2 (ii)).
+    if (stt?.isOpen()) {
+      stt.end();
+      this.o.legs[0].events.frame({ direction: 'out', type: 'stt.end' });
+    }
     stt?.close();
     for (const leg of this.o.legs) leg.speech?.close();
   }
diff --git a/src/providers/soniox/speech.ts b/src/providers/soniox/speech.ts
--- a/src/providers/soniox/speech.ts
+++ b/src/providers/soniox/speech.ts
@@ -91,14 +91,21 @@
     else this.stream?.endUtterance();
   }
 
-  /** Before the caller's first await (the `stop()` rule): every socket it holds or is opening is closed, and nothing is emitted after it. */
+  /**
+   * Before the caller's first await (the `stop()` rule): every socket it
+   * holds or is opening is closed, and nothing is emitted after it but the
+   * line for the stream it ended with `text_end` (Stage 2 session end,
+   * ruling 2 (ii)).
+   */
   close(): void {
+    const stream = this.stream;
+    this.stream = null;
+    const ended = stream?.close() ?? null;
+    if (ended !== null) this.frame('out', 'tts.end', { streamId: ended });
     this.closed = true;
     this.pending = [];
     this.segments.clear();
     this.texts.clear();
-    this.stream?.close();
-    this.stream = null;
     // A close while CONNECTING rejects its connect(); ensure()'s catch sees `closed` and says nothing.
     this.opening?.close();
     this.opening = null;
diff --git a/src/providers/soniox/ttsStream.ts b/src/providers/soniox/ttsStream.ts
--- a/src/providers/soniox/ttsStream.ts
+++ b/src/providers/soniox/ttsStream.ts
@@ -315,16 +315,19 @@
     this.doEndUtterance();
   }
 
-  close(): void {
+  /** Closes the socket. Returns the stream it ended first with `text_end`, so the server frees it, or null when none was active: the caller's Logs line (Stage 2 session end, ruling 2 (ii)). */
+  close(): string | null {
     this.intentionalClose = true;
     this.stopKeepalive();
     this.clearSegmentTimers();
     this.queue = [];
+    let ended: string | null = null;
     if (this.ws) {
       // Best-effort close of the active stream so the server frees it.
       if (this.activeStreamId) {
         try {
           this.ws.send(JSON.stringify({ stream_id: this.activeStreamId, text: '', text_end: true }));
+          ended = this.activeStreamId;
         } catch { /* closing anyway */ }
       }
       this.ws.close();
@@ -333,6 +336,7 @@
     this.resetStreams();
     // An intentional close ends nothing: whatever was live is simply forgotten.
     this.segments.clear();
+    return ended;
   }
 
   isOpen(): boolean {
```

- [ ] **Step 4: Run Soniox's suites and the old client's.**

Run: `npx vitest run src/providers/soniox src/services/clients`
Expected: PASS — 50 files, 1 145 tests (the three files alone: 161); shared Both (`adapter.both.test.ts`) and Kizuna Soniox among them, the old `SonioxClient` too (it calls `close()` as a statement).

- [ ] **Step 5: The gates.** The suite and the typecheck gate (in Wave 2, a failure in another task's files is that task's).

- [ ] **Step 6: Commit.**

```bash
git add src/providers/soniox/adapter.ts src/providers/soniox/adapter.test.ts src/providers/soniox/speech.ts src/providers/soniox/speech.test.ts src/providers/soniox/ttsStream.ts src/providers/soniox/ttsStream.test.ts
```

```bash
git commit -q -F - -- src/providers/soniox/adapter.ts src/providers/soniox/adapter.test.ts src/providers/soniox/speech.ts src/providers/soniox/speech.test.ts src/providers/soniox/ttsStream.ts src/providers/soniox/ttsStream.test.ts <<'EOF'
feat(soniox): frame the stream ends sent as a session stops

The STT stream's end (an empty text frame) and a speaking TTS stream's
text_end went out unframed, where stt.finalize is framed. They are now
Logs lines, stt.end and tts.end with its stream id, each said only when
it was sent; the TTS stream's close says which stream it ended.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 7: Palabra frames its `end_task`, and its session's delete with its outcome (Wave 2)

**Files:**
- Modify: `src/providers/palabraai/adapter.ts` (`stop`, `release`, a new `releaseFrame`)
- Test: `src/providers/palabraai/adapter.test.ts` (the import, a `lines` helper, the ending case and every stop case)

**Interfaces:**
- Consumes: Task 1's rule (the conformance scenarios and both modes' seeded lifecycles); `livePalabra`, `fakeRest`, `RELEASE_TIMEOUT_MS`, `sessionDeleteUrl`, `AdapterEvent`.
- Produces: the frames `task.end { force: true }`, `session.delete` (`out`), `session.deleted { status }` and `session.delete_warning { status } | { error } | { timeoutMs }` (`in`) — Task 3 pins the last as a warning row.

- [ ] **Step 1: Write the failing tests** (ruling 2 (ii); choices 4, 5): the platform key's `task.end`, the app pair's delete and its answer, a delete that never answers, one refused with `keepalive` then answered plain, one that fails twice, one whose plain try runs out, one answered 404 or 500 — and a live failure's delete, its attempt before `failed` and its outcome after.

```diff
diff --git a/src/providers/palabraai/adapter.test.ts b/src/providers/palabraai/adapter.test.ts
--- a/src/providers/palabraai/adapter.test.ts
+++ b/src/providers/palabraai/adapter.test.ts
@@ -8,7 +8,7 @@
 import { describe, it, expect, vi } from 'vitest';
 import { AdapterStartError, SAMPLE_RATE, type AdapterEvents } from '../../lib/contract/adapter';
 import { createVirtualClock, type Clock } from '../../lib/contract/clock';
-import { recordEvents } from '../../lib/contract/events';
+import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
 import { WS_OPEN } from '../../lib/contract/socket';
 import { flush, type ScenarioStep } from '../../lib/contract/testing/drive';
 import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
@@ -36,6 +36,8 @@
 };
 /** The app pair's REST headers as the fake server records them: a browser's `Headers`, lowercase names. */
 const APP_HEADERS = { clientid: APP.clientId, clientsecret: APP.clientSecret };
+/** A stretch of the log as the Logs read it: each frame's type and payload, each other event's kind. */
+const lines = (log: readonly AdapterEvent[]) => log.map((e) => (e.kind !== 'frame' ? [e.kind] : e.payload.payload === undefined ? [e.payload.type] : [e.payload.type, e.payload.payload]));
 
 function harness(credentials: PalabraCredentials): AdapterHarness<PalabraConfig, PalabraCredentials> {
   let sockets = fakeSockets();
@@ -842,8 +844,9 @@
     expect(log.filter((e) => e.kind === 'failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to Palabra closed (1011).' }]);
   });
 
-  it('an ending says failed once, then nothing; the app pair\'s session is deleted, and a later stop deletes nothing more', async () => {
+  it('an ending says failed once, then nothing but its delete\'s outcome; the app pair\'s session is deleted, and a later stop deletes nothing more', async () => {
     const h = await livePalabra({ credentials: APP });
+    const logged = h.log.length;
     h.socket().serverClose(1011);
     await flush();
     h.socket().serverClose(1011);
@@ -851,33 +854,42 @@
     expect(h.rest.of('DELETE')).toHaveLength(1);
     await h.session.stop();
     expect(h.rest.of('DELETE')).toHaveLength(1);
+    // The delete goes out as the leg ends, before its failed; its outcome after (Stage 2 session end, ruling 2 (ii)).
+    expect(lines(h.log.slice(logged))).toEqual([
+      ['session.connection_lost', { code: 1011, reason: '' }], ['session.delete'], ['failed'], ['session.deleted', { status: 204 }],
+    ]);
     expect(h.timers()).toBe(0);
   });
 });
 
 describe('the Palabra AI adapter: stop (ruling 13)', () => {
-  it('ends the task and closes the socket before its first await, what is in flight dropped; nothing is said after, and no timer is left', async () => {
+  it('ends the task, framed, and closes the socket before its first await, what is in flight dropped; nothing more is said, and no timer is left (Stage 2 session end, ruling 2 (ii))', async () => {
     const h = await livePalabra();
     h.session.appendAudio(chunk());
     const logged = h.log.length;
     void h.session.stop();
     expect(h.sent().slice(-1)).toEqual([{ message_type: 'end_task', data: { force: true } }]);
     expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
+    // The platform key's one line: it has no REST session to delete.
+    expect(lines(h.log.slice(logged))).toEqual([['task.end', { force: true }]]);
     await flush();
     h.clock.advance(60_000);
-    expect(h.log.length).toBe(logged);
+    expect(h.log.length).toBe(logged + 1);
     expect(h.timers()).toBe(0);
   });
 
-  it("the app pair's stop sends its session's delete before its first await, with keepalive, and resolves once it is answered", async () => {
+  it("the app pair's stop sends its session's delete before its first await, with keepalive, and resolves once it is answered — each framed (Stage 2 session end, ruling 2 (ii))", async () => {
     const h = await livePalabra({ credentials: APP });
+    const logged = h.log.length;
     const stopping = h.session.stop();
     expect(h.rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), keepalive: true, headers: APP_HEADERS }]);
+    expect(lines(h.log.slice(logged))).toEqual([['task.end', { force: true }], ['session.delete']]);
     await expect(stopping).resolves.toBeUndefined();
+    expect(lines(h.log.slice(logged))).toEqual([['task.end', { force: true }], ['session.delete'], ['session.deleted', { status: 204 }]]);
     expect(h.timers()).toBe(0);
   });
 
-  it('a delete that never answers is given 5 s on the request\'s clock, then the stop resolves', async () => {
+  it('a delete that never answers is given 5 s on the request\'s clock, then the stop resolves, the delete a warning (Stage 2 session end, ruling 2 (ii))', async () => {
     const h = await livePalabra({ credentials: APP, rest: { remove: 'hang' } });
     const done = vi.fn();
     void h.session.stop().then(done);
@@ -890,6 +902,7 @@
     expect(h.rest.of('DELETE')[0].signal?.aborted).toBe(true);
     // The bound's own abort is not a transport failure to try again.
     expect(h.rest.of('DELETE')).toHaveLength(1);
+    expect(h.frames('session.delete_warning')).toEqual([{ timeoutMs: RELEASE_TIMEOUT_MS }]);
     expect(h.timers()).toBe(0);
   });
 
@@ -914,12 +927,12 @@
     expect(h.rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), headers: APP_HEADERS }]);
     expect(h.rest.of('DELETE')[0].keepalive).not.toBe(true);
     expect(refused).toHaveLength(1);
-    // The delete is never framed: nothing is said after the stop.
-    expect(h.log.length).toBe(logged);
+    // One attempt framed, one outcome: the plain try's answer (Stage 2 session end, ruling 2 (ii)).
+    expect(lines(h.log.slice(logged))).toEqual([['task.end', { force: true }], ['session.delete'], ['session.deleted', { status: 204 }]]);
     expect(h.timers()).toBe(0);
   });
 
-  it('a delete that fails at the transport both times ends there: two attempts, nothing framed, no timer left (ruling 1)', async () => {
+  it('a delete that fails at the transport both times ends there: two attempts, a warning naming the error alone, no timer left (ruling 1; Stage 2 session end, ruling 2 (ii))', async () => {
     const attempts: RequestInit[] = [];
     const h = await livePalabra({
       credentials: APP,
@@ -935,7 +948,7 @@
     await flush();
     expect(attempts.map((a) => a.keepalive === true)).toEqual([true, false]);
     expect(done).toHaveBeenCalled();
-    expect(h.log.length).toBe(logged);
+    expect(lines(h.log.slice(logged))).toEqual([['task.end', { force: true }], ['session.delete'], ['session.delete_warning', { error: 'TypeError' }]]);
     expect(h.timers()).toBe(0);
   });
 
@@ -967,14 +980,17 @@
     await flush();
     expect(done).toHaveBeenCalled();
     expect(attempts[1].signal?.aborted).toBe(true);
+    expect(h.frames('session.delete_warning')).toEqual([{ timeoutMs: RELEASE_TIMEOUT_MS }]);
     expect(h.timers()).toBe(0);
   });
 
-  it.each([404, 500])('a delete Palabra answers with %i is its answer, not tried again (ruling 1)', async (status) => {
+  it.each([404, 500])('a delete Palabra answers with %i is its answer, not tried again, and a warning (ruling 1; Stage 2 session end, ruling 2 (ii))', async (status) => {
     const h = await livePalabra({ credentials: APP, rest: { remove: status } });
     await expect(h.session.stop()).resolves.toBeUndefined();
     await flush();
     expect(h.rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), keepalive: true }]);
+    expect(h.frames('session.delete_warning')).toEqual([{ status }]);
+    expect(h.frames('session.deleted')).toEqual([]);
     expect(h.timers()).toBe(0);
   });
 });
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/palabraai/adapter.test.ts`
Expected: FAIL — `9 failed | 60 passed (69)`: the ending case and the stop cases — nothing is framed at a stop or for a delete.

- [ ] **Step 3: Frame the task's end, the delete and its outcome.**

```diff
diff --git a/src/providers/palabraai/adapter.ts b/src/providers/palabraai/adapter.ts
--- a/src/providers/palabraai/adapter.ts
+++ b/src/providers/palabraai/adapter.ts
@@ -202,10 +202,12 @@
    * The close before its first `await`, what is still being translated
    * dropped (ruling 13): `end_task` best-effort, then the close; a REST
    * session's delete goes out now and is the one thing awaited, bounded.
-   * Nothing is framed after a stop.
+   * What the ending sends is framed — `task.end`, the delete and its outcome
+   * — and nothing after `stop()` has returned (Stage 2 session end, ruling
+   * 2 (ii); choice 3).
    */
   stop(): Promise<void> {
-    if (this.phase === 'live') this.send(JSON.stringify(END_TASK));
+    if (this.phase === 'live' && this.send(JSON.stringify(END_TASK))) this.frame('out', 'task.end', END_TASK.data);
     this.shutDown();
     return this.releasing ?? Promise.resolve();
   }
@@ -595,8 +597,11 @@
    * Deletes the REST session this leg created, once (ruling 1): its own id
    * alone, bounded by `RELEASE_TIMEOUT_MS` on the request's clock, with
    * `keepalive` so a page that is going away still sends it. The request goes
-   * out before any `await`. Not framed: it may run after the session has
-   * ended.
+   * out before any `await`. Framed as it goes out and as it ends, though the
+   * leg has ended: `session.deleted` on Palabra's 2xx, else
+   * `session.delete_warning` — a warning by its name, since a session that
+   * was not deleted expires on its own (Stage 2 session end, ruling 2 (ii);
+   * choice 5). Its id is never framed: it is shaped as a token.
    *
    * A transport failure is tried once more without `keepalive`, inside what
    * is left of the same bound, as the Soniox lease's session end does: a
@@ -612,24 +617,38 @@
     const url = sessionDeleteUrl(this.sessionId);
     const controller = new AbortController();
     const cancel = this.request.clock.setTimeout(() => controller.abort(), RELEASE_TIMEOUT_MS);
-    const remove = (keepalive: boolean): Promise<unknown> => {
+    const remove = (keepalive: boolean): Promise<Response> => {
       try {
         return this.deps.fetch(url, { method: 'DELETE', headers: restHeaders(this.request.credentials), ...(keepalive ? { keepalive: true } : {}), signal: controller.signal });
       } catch (error) {
         return Promise.reject(error);
       }
     };
+    this.releaseFrame('out', 'session.delete');
     // A delete that failed leaves the session to expire on its own [inf: the docs say only that `expires_at` is extended every minute while a connection is active].
     this.releasing = remove(true)
-      .catch(() => (controller.signal.aborted ? undefined : remove(false)))
-      .then(() => undefined, () => undefined)
-      .then(() => cancel());
+      .catch((error: unknown) => (controller.signal.aborted ? Promise.reject(error) : remove(false)))
+      .then(
+        (response) => {
+          if (response.ok) this.releaseFrame('in', 'session.deleted', { status: response.status });
+          else this.releaseFrame('in', 'session.delete_warning', { status: response.status });
+        },
+        // The bound's own abort, or the transport twice: the error's name alone, never its words (`errorName`).
+        (error: unknown) => this.releaseFrame('in', 'session.delete_warning', controller.signal.aborted ? { timeoutMs: RELEASE_TIMEOUT_MS } : { error: errorName(error) }),
+      )
+      // Settles whatever happened: a stop that waits on it never rejects, and no timer is left.
+      .then(() => cancel(), () => cancel());
   }
 
   private frame(direction: 'in' | 'out', type: string, payload?: unknown): void {
     if (this.phase === 'ended') return;
     this.events.frame(payload === undefined ? { direction, type } : { direction, type, payload: framePayload(payload) });
   }
+
+  /** The delete's own lines: said as the leg ends, so not gated on it (choice 5). */
+  private releaseFrame(direction: 'in' | 'out', type: string, payload?: Record<string, unknown>): void {
+    this.events.frame(payload === undefined ? { direction, type } : { direction, type, payload: framePayload(payload) });
+  }
 }
 
 export function createPalabraAdapter(deps: Partial<PalabraAdapterDeps> = {}): Adapter<PalabraConfig, PalabraCredentials> {
```

- [ ] **Step 4: Run Palabra's suites.**

Run: `npx vitest run src/providers/palabraai`
Expected: PASS — 11 files, 172 tests (the adapter's file alone: 69); both modes' conformance scenarios and seeded lifecycles among them, through Task 1's rule — the app pair's lifecycles still count one delete per session created, and scan every frame for the key, the pair and the session's tokens.

- [ ] **Step 5: The gates.** The suite and the typecheck gate (in Wave 2, a failure in another task's files is that task's).

- [ ] **Step 6: Commit.**

```bash
git add src/providers/palabraai/adapter.ts src/providers/palabraai/adapter.test.ts
```

```bash
git commit -q -F - -- src/providers/palabraai/adapter.ts src/providers/palabraai/adapter.test.ts <<'EOF'
feat(palabraai): frame end_task and the session delete, a failed one a warning

Stop sent end_task and deleted the app pair's REST session without a
line in the Logs, so a delete that failed left its session to expire
with no trace. end_task is now task.end, the delete session.delete, and
its outcome session.deleted, or session.delete_warning with Palabra's
status, the error's name or the bound it ran out of: a warning row.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 8: OpenAI Translate sends `session.close` at Stop (Wave 2)

**Files:**
- Modify: `src/providers/openai_translate/wire.ts` (the header, the SDK import, a new `SESSION_CLOSE`), `src/providers/openai_translate/adapter.ts` (the wire import, `stop`)
- Test: `src/providers/openai_translate/adapter.test.ts` (the stop case, and one after it)

**Interfaces:**
- Consumes: Task 1's rule; `liveTranslate`, `SERVER`, `MANUAL`, `chunk`, `flush`; the SDK's `RealtimeTranslationSessionCloseEvent` (types only).
- Produces: `SESSION_CLOSE: RealtimeTranslationSessionCloseEvent` (`{ type: 'session.close' }`) in `wire.ts`; the frame `session.close` (`out`).

**Shared with the translation cuts plan** (research note 7): this task's hunks in `wire.ts` (the header's second line, the import block, after `appendFrame`), `adapter.ts` (the wire import, `stop`) and `adapter.test.ts` (the stop case) touch none of that plan's lines; on its result they applied by offset alone. If it has landed, the stop case reads as quoted here: that plan leaves it as it is.

- [ ] **Step 1: Write the failing test** (ruling 2 (iii); choice 9), and pin that an ended session sends none (green before as after).

```diff
diff --git a/src/providers/openai_translate/adapter.test.ts b/src/providers/openai_translate/adapter.test.ts
--- a/src/providers/openai_translate/adapter.test.ts
+++ b/src/providers/openai_translate/adapter.test.ts
@@ -577,7 +577,7 @@
     for (const secret of SECRETS) expect(everything).not.toContain(secret);
   });
 
-  it('stop closes the socket before it returns, cancels every timer — the tail and both sides — and nothing follows', async () => {
+  it('stop sends session.close, framed, then closes the socket before it returns, cancels every timer — the tail and both sides — and nothing follows (Stage 2 session end, ruling 2 (iii))', async () => {
     const h = await liveTranslate({ context: MANUAL });
     h.socket().receive(SERVER.input('speaking'));
     h.socket().receive(SERVER.output('translating'));
@@ -588,6 +588,9 @@
     const n = h.log.length;
     const sentBefore = h.sent().length;
     const stopping = h.session.stop();
+    // The graceful end and its Logs line; what it flushes is not waited for.
+    expect(h.sent().slice(sentBefore)).toEqual([{ type: 'session.close' }]);
+    expect(h.log.slice(n)).toEqual([{ kind: 'frame', payload: { direction: 'out', type: 'session.close' } }]);
     expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
     await stopping;
     expect(h.timers()).toBe(0);
@@ -595,8 +598,19 @@
     await flush();
     h.session.appendAudio(chunk());
     h.session.endTurn();
+    expect(h.log.length).toBe(n + 1);
+    expect(h.sent()).toHaveLength(sentBefore + 1);
+  });
+
+  it('a stop after the session ended sends no session.close, and says nothing', async () => {
+    const h = await liveTranslate();
+    h.socket().serverClose(1011, 'Internal error');
+    await flush();
+    const sent = h.sent().length;
+    const n = h.log.length;
+    await h.session.stop();
+    expect(h.sent()).toHaveLength(sent);
     expect(h.log.length).toBe(n);
-    expect(h.sent()).toHaveLength(sentBefore);
   });
 
   it("leaves no listener behind: the signal's once the start settles, the socket's once the session ends", async () => {
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run src/providers/openai_translate/adapter.test.ts`
Expected: FAIL — `1 failed | 44 passed (45)`: the stop case (nothing is sent before the close).

- [ ] **Step 3: Send it, frame it, then close.**

```diff
diff --git a/src/providers/openai_translate/wire.ts b/src/providers/openai_translate/wire.ts
--- a/src/providers/openai_translate/wire.ts
+++ b/src/providers/openai_translate/wire.ts
@@ -1,6 +1,6 @@
 /**
  * OpenAI Translate's wire, spoken directly (survey §1.3–1.4): the URL and
- * its subprotocols, the two client frames the adapter sends, the server's
+ * its subprotocols, the three client frames the adapter sends, the server's
  * frames decoded, the heartbeat test, and a server `error` as a notice code
  * and words. The client frames are typed by the `openai` SDK's translation
  * types, imported for types only, so a frame that drifts from the SDK fails
@@ -9,6 +9,7 @@
 import type {
   RealtimeError,
   RealtimeTranslationInputAudioBufferAppendEvent,
+  RealtimeTranslationSessionCloseEvent,
   RealtimeTranslationSessionUpdateEvent,
 } from 'openai/resources/realtime/realtime';
 import { pcmToBase64 } from '../../lib/contract/pcm64';
@@ -68,6 +69,14 @@
 }
 
 /**
+ * The graceful end (SDK: "the server flushes pending input audio and emits
+ * any remaining translated output before closing the session"), sent at
+ * Stop just before the close — nothing waits for what it flushes (Stage 2
+ * session end, ruling 2 (iii)).
+ */
+export const SESSION_CLOSE: RealtimeTranslationSessionCloseEvent = { type: 'session.close' };
+
+/**
  * A server event as the adapter reads it: a JSON object with a string
  * `type`. The SDK's `RealtimeTranslationServerEvent` types the seven it
  * lists; the adapter reads each through its SDK type. The `.done` events the
diff --git a/src/providers/openai_translate/adapter.ts b/src/providers/openai_translate/adapter.ts
--- a/src/providers/openai_translate/adapter.ts
+++ b/src/providers/openai_translate/adapter.ts
@@ -43,6 +43,7 @@
   errorWords,
   isSilentFrame,
   OUTPUT_RATE,
+  SESSION_CLOSE,
   sessionUpdate,
   translateProtocols,
   translateUrl,
@@ -152,8 +153,17 @@
     this.release(true);
   }
 
-  /** The close before its first `await`. No `session.close`: its flush would land on a socket already closed (parity — a tail at Stop is dropped). */
+  /**
+   * `session.close`, framed, then the close before its first `await`. Its
+   * flush and the server's `session.closed` are not waited for: they land on
+   * a socket already closed, so a tail at Stop is still dropped (parity;
+   * Stage 2 session end, ruling 2 (iii)).
+   */
   stop(): Promise<void> {
+    if (this.phase === 'live' && this.socket.readyState === WS_OPEN) {
+      this.socket.send(JSON.stringify(SESSION_CLOSE));
+      this.frame('out', 'session.close');
+    }
     this.shutDown();
     return Promise.resolve();
   }
```

- [ ] **Step 4: Run OpenAI Translate's suites.**

Run: `npx vitest run src/providers/openai_translate`
Expected: PASS — 10 files, 125 tests (the adapter's file alone: 45); `wire.test.ts`'s scan of who reads the key in `wire.ts` among them (the new constant reads none).

- [ ] **Step 5: The gates.** The suite and the typecheck gate (in Wave 2, a failure in another task's files is that task's).

- [ ] **Step 6: Commit.**

```bash
git add src/providers/openai_translate/wire.ts src/providers/openai_translate/adapter.ts src/providers/openai_translate/adapter.test.ts
```

```bash
git commit -q -F - -- src/providers/openai_translate/wire.ts src/providers/openai_translate/adapter.ts src/providers/openai_translate/adapter.test.ts <<'EOF'
feat(openai-translate): send session.close at Stop

The translation endpoint's graceful end was never sent. Stop now sends
session.close, framed, then closes the socket at once: the server's
flush and its session.closed are not waited for, so the tail at Stop is
dropped as before.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Group check (controller, after Wave 2)

- [ ] The full gates: `npx vitest run src` at 0 failed with no unhandled errors (the replay at `43437057`: 573 files passed and 1 skipped, 7 474 tests passed and 2 skipped); the typecheck gate at exactly the baseline; the full tree at 259, none naming `src/lib/setup/`, `LogsPanel.tsx`'s four lines its pre-existing ones.
- [ ] `npx vitest run src/services` green: the old clients are untouched but for the return value of the TTS stream they share, which they ignore (the replay: 49 files, 1 039 tests).
- [ ] `npm run build`, then `npm run extension:build`; `npx vitest run extension`.
- [ ] The three D24 greps print nothing.
- [ ] `command grep -rlF 'session.delete_warning' build extension/dist` and `command grep -rlF 'session.stopped' build extension/dist` each name at least one file under `build/` and one under `extension/dist/`.
- [ ] No rendered check: every line shows only in a live session's Logs, with diagnostic logs on. Record the numbers for Task 9.

---

### Task 9: The specs' amendments and the roadmap's record (controller)

The controller's docs task, after the group check. It edits only the two specs and the roadmap, and commits them together. Every anchor below is by heading and content; the line numbers, read at `43437057`, are hints only — the translation cuts plan's record may have landed in the same sections first — so re-read each anchor before editing.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-client-contract-design.md`, `docs/superpowers/specs/2026-08-25-first-run-setup-and-tour-design.md`, `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`

- [ ] **Step 1: Amend the client-contract spec.** Each amendment is marked "(Stage 2 session end, ruling / choice N)" in the text, as the earlier plans' are:
  1. **"L0 — the client contract" → "What every adapter must honour", the bullet "An adapter that can no longer work says so"** (`:325-327`): append "What an ending says of itself — the graceful end it sends, a REST session's delete and its outcome — is a frame, and may follow `stop()`, `failed` or `closed` until `stop()` has returned; nothing follows once it has, and nothing but frames follows an ending at all (Stage 2 session end, choice 3)."
  2. **The same section, the `frame` bullet** (`:328-366`): "and draws its 'session ended' separator from `closed`" → "and draws its 'session ended' separator after the runner's `session.stopped` (Stage 2 session end, choice 7; it followed `session.closed`, the old clients' `disconnect()` line)"; and before "No frame payload holds a `ws://` or `wss://` URL", add: "The runner's `session.stopped`, Doubao's `session.finish`, Soniox's `stt.end` and `tts.end`, Palabra's `task.end`, `session.delete`, `session.deleted` and `session.delete_warning` — a warning by its suffix — and OpenAI Translate's `session.close` need none: each is said once per leg's end (Stage 2 session end, choices 4–6)."
  3. **"Session lifecycle" → "Stopping, and closing the window"** (`:2083-2103`): add a bullet after "One path.": "**Each leg's last line in the Logs is the runner's.** Once a run has unwound — every leg's `stop()` settled — it frames `session.stopped` (`out`) for each leg: `{ reason, code?, leg?, state, elapsedMs }`, the run's end reason, its notice's code and the leg it names, the leg's last state (`null` when its adapter never started) and the run clock's time from Start to the stop; none for a start refused before it opened a leg, a stop while it checked, or `abandon()`. It is the uniform line the old clients' `disconnect()` logged as `session.closed`. Before it, each adapter frames the graceful end it sends: Doubao's `FinishSession` (`session.finish`), Soniox's end of the STT stream (`stt.end`) and a speaking TTS stream's `text_end` (`tts.end`), Palabra's `end_task` (`task.end`) and its REST session's delete (`session.delete`, then `session.deleted`, or `session.delete_warning` with Palabra's status, the error's name or the 5 s bound), and OpenAI Translate's `session.close`, which it now sends, not waiting for the server's flush; Doubao does not wait for `SessionFinished`. Gemini and OpenAI Realtime have no end message (Stage 2 session end, ruling 2; choices 1, 2, 4, 5)."
  4. **"Session hooks on the provider definition", the paragraph "Palabra uses none"** (`:2038-2042`): append "Its delete is framed as it goes out and as it ends; one that failed is a warning row (Stage 2 session end, choice 5)."
  5. **"Testing" → the kit list, the `runScenario` bullet** (`:2255-2260`): after "nothing may land after `failed` / `closed` or after `stop()`", add "— but a frame, until `stop()` has returned: the kit marks the log `stopped` then (Stage 2 session end, choice 3)"; **the seeded lifecycle bullet** (`:2264-2288`): after "A stop is the runner's: mark, abort the request's signal, then `stop()`", add "; the log is marked again once it has returned".
- [ ] **Step 2: Amend the first-run spec** (`2026-08-25-first-run-setup-and-tour-design.md`), marked "**Amended by the Stage 2 session-end and wizard plan** (ruling 1, the owner's, 2026-09-30)":
  1. **§1.2, the "Scenarios" table** (`:177-185`): strike through the column "Display modes (speaker / participant)" and each cell under it (`~~…~~`), keeping them readable, and replace the paragraph under the table (`:187-189`) with: "`understand-others` writes `textOnly: true` for hygiene (it is forced anyway). **Amended by the Stage 2 session-end and wizard plan** (ruling 1, the owner's, 2026-09-30): the wizard sets no display mode — the presets carry none, and a completion, a re-run included, leaves both legs' modes at their stored values (default `both`), so a mode the user chose survives. No migration: a stored mode stays as it is."
  2. **§1.5, step 3** (`:239`): "~~3. `setSpeakerDisplayMode` / `setParticipantDisplayMode` for the legs the preset names~~ — removed: the wizard writes no display mode (**Amended by the Stage 2 session-end and wizard plan**, ruling 1)", the steps' numbers kept.
- [ ] **Step 3: Write the roadmap's section.** Append `## Scheduled by the Stage 2 session-end and wizard plan` as the roadmap's last section, in the earlier sections' form:
  - **What landed:** the plan's path and commit, the commit range and its `+/−` lines and files (from `git diff --shortstat`), the waves as run, each task's review rounds, the group check with its numbers; Task 9 is the record.
  - **Departures, stated:**
    - every session leg ends with a `session.stopped` line in the Logs, and the "session ended" separator follows it, no longer `session.closed` (ruling 2 (i); choice 7);
    - OpenAI Translate now sends `session.close` at Stop, where it sent nothing; the tail at Stop is still dropped (ruling 2 (iii));
    - Soniox's `stt.end` follows a server error's `failed` in the Logs, as it followed the send before, unframed (choice 8);
    - the kit lets a frame follow an ending until `stop()` has returned (choice 3);
    - the setup wizard no longer sets display modes: a re-run leaves them as the user set them (ruling 1).
  - **Before any release from the branch:** the owner's live test below.
  - **The owner's live test** (own credentials; switch diagnostic logs on in Help before Start; each item names what settles it):
    1. **Stop on each provider** (ruling 2): Start, speak a sentence, Stop — on Gemini, OpenAI Realtime, OpenAI Translate, Soniox (own key), Kizuna Soniox, Doubao AST 2.0, Palabra (the platform key and the app pair) and LocalInference. Each leg's tab ends with `session.stopped` (`reason: 'user'`, `state: 'live'`, `elapsedMs` about the session's length from Start), then the "Session ended" separator, and before it the provider's own end line: Doubao `session.finish`; Soniox `stt.end`, and `tts.end` when a translation was still speaking; Kizuna Soniox the same, then the lease's `session.end`; Palabra `task.end`, and on the app pair `session.delete` then `session.deleted { status: 204 }`; OpenAI Translate `session.close`; Gemini, OpenAI Realtime and LocalInference nothing but `session.stopped`. Record any leg with no `session.stopped`, or a line after it.
    2. **Both** (choice 1): Stop a Both session on Soniox (shared) and on Palabra: each tab its own `session.stopped` and separator; Soniox's `stt.end` in the Me tab, each leg's `tts.end` in its own.
    3. **A session that ends by itself** (choice 2): drop the network during an OpenAI Translate or Palabra session: `session.stopped` with `reason: 'leg-failed'`, the code (`connection_lost`) and the leg; on Kizuna Soniox run a segment to its cap: `reason: 'lease-ended'` with the lease's code; a start with a wrong key: `reason: 'start-failed'`, `state: 'opening'`.
    4. **A Palabra app-pair delete that fails** (ruling 2 (ii); choice 5): with the app pair, cut the network (Wi-Fi off) just before Stop: `task.end` still framed if the socket has not yet noticed (else the leg's own `session.connection_lost` and `session.stopped { reason: 'leg-failed' }`), then `session.delete` and `session.delete_warning` — `{ error: 'TypeError' }` or `{ timeoutMs: 5000 }` — **drawn as a warning row**, the Stop itself done at once or within 5 s. Record the payload and how long Stop took.
    5. **OpenAI Translate's `session.close`** (ruling 2 (iii)): Stop mid-sentence: no `session.error` in the Logs before `session.stopped`; the translation's tail is dropped, as before. Record anything the endpoint says that the Logs show.
    6. **Doubao** (ruling 2 (iv)): Stop stays as fast as before; `session.finish` is the last Doubao line — no `session.finished` or `session.usage` after it, as the adapter reads none.
    7. **The wizard** (ruling 1): set the Me and Other display modes to "source" in the panel's toolbar, re-run the setup wizard (Settings → Help, "Run setup again") choosing a two-way scenario, finish: both modes are still "source", and still after a restart. Then on a fresh profile: both default to "both".
  - **Open questions for the owner:** this plan's, below.
  - **Amend in place** (mark each "**Changed by the Stage 2 session-end and wizard plan** (…)"): in the Soniox section, "What it leaves": "No 'session ended' separator in the Logs for a Soniox run … not yet written" (`:1628`) — written: the runner's `session.stopped` and the separator after it; in the Gemini section (`:3120`), the Doubao section (`:3864`, and its inheritance row at `:3843`) and the OpenAI Realtime section (`:4471`), "`session.closed` on Stop is not emitted (the kit forbids emissions after stop)" — the runner's `session.stopped` is each leg's line now, and the kit lets an ending frame itself until `stop()` has returned; in the OpenAI Translate section, live-test item 18 (`:4352`, "the server's `session.closed` drawing the separator") — the separator now follows the runner's `session.stopped`, which follows the server's `session.closed`.
  - **The roadmap's inheritance, item by item,** **what it leaves** and **the open questions:** the three lists below, as landed.
- [ ] **Step 4: Commit.**

```bash
git add docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/specs/2026-08-25-first-run-setup-and-tour-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md
```

```bash
git commit -q -F - -- docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/specs/2026-08-25-first-run-setup-and-tour-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md <<'EOF'
docs(spec, roadmap): session-end lines and the wizard's display modes

Every leg ends with the runner's session.stopped and each provider
frames the graceful end it sends: the adapter rules, the frame names,
stopping and the kit amended. The first-run spec's presets lose their
display modes. The owner's live test, and the earlier sections' items
it changes.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

## The roadmap's inheritance, item by item

Taken (and where), or left (and why).

| Item | Disposition |
|---|---|
| The Soniox section, "What it leaves": no "session ended" separator for a Soniox run — "A run's end is the runner's to log, for every provider — not yet written" (`:1628`) | met: the runner's `session.stopped` (Task 2) and the separator after it (Task 3; choice 7); live-test item 1 |
| The Gemini section: "`session.closed` on Stop is not emitted (the kit forbids emissions after stop)" (`:3120`) | met: the runner's line (Task 2); Gemini has no end message of its own (ruling 2) |
| The Doubao section: the same (`:3864`, `:3843`) | met: the runner's line, and `session.finish` (Tasks 2, 5); the kit's rule (Task 1) |
| The OpenAI Realtime section: the same (`:4471`) | met: the runner's line (Task 2); no end message exists |
| The OpenAI Translate section, live-test item 18: the server's `session.closed` drawing the separator (`:4352`) | changed: the separator follows the runner's `session.stopped`, which follows it (choice 7) |
| The OpenAI Translate plan's parity note: no `session.close` at Stop | changed: sent and framed, not waited for (ruling 2 (iii); Task 8) |
| The Palabra plan's "nothing is framed after a stop", and the delete that fails with no trace | changed: `task.end`, the delete and its outcome framed, a failed one a warning (ruling 2 (ii); Task 7) |
| The sweep's finding 8: the Kizuna Soniox lease's successful `session.end` has no ack line | left: its request is framed and its failures are; the runner's `session.stopped` follows it (What this plan leaves) |

## What this plan leaves

- **A failed start's Palabra delete outcome is not filed.** When the app pair's REST session was created and the start then fails, `session.delete` is framed before the rejection, but the outcome lands after the runner has finished that run and is dropped (choice 5); likewise a create that lands after its leg gave up. The session is deleted all the same.
- **The Kizuna Soniox lease's successful `session.end`** has no answer line (the sweep's finding 8): its request is framed, its failures are (`session.notify_failed`), and `session.stopped` follows.
- **What the graceful ends would bring back is not read:** Doubao's `SessionFinished` and its billing (ruling 2 (iv)), OpenAI Translate's flushed tail and `session.closed` (ruling 2 (iii)), Soniox's trailing tokens and `{ finished: true }`. Each adapter closes at once, as before.
- **Soniox ends one TTS stream at Stop:** the active one; a stream already draining had its `text_end` at `endUtterance`, and a socket still opening sends nothing (choice 8).
- **`elapsedMs` counts from Start** (choice 2); a leg's live time is analytics' `duration_ms`. If the live test wants it in the Logs, it is one more field.
- **The old clients' `session.closed`** (`src/services/clients/**`) no longer draws a separator; they do not run in the app, and go with the deletion plan.
- **A log recorded without either driver** (a test's own `recordConformance`) has no `stopped` marker, so a frame after its ending is not flagged there (choice 3).

## Open questions for the owner

- **The separator after `session.stopped`** (choice 7): beyond the brief, and the roadmap's Soniox item; it replaces the one after `session.closed`, so a server's close is followed by the runner's line and one separator.
- **`session.delete_warning`** (choice 5): the Logs' severity is by suffix, so a warning row needs a name ending in `warning`; `session.delete_failed`, the pattern of `session.create_failed`, would be red. The brief asked for a warning.
- **`elapsedMs` from Start** (choice 2), rather than from the leg going live.

## Self-review

- **Brief coverage.** Ruling 1: the presets lose their display modes and the type, the wizard's deps and the hook's bindings go (Task 4; choice 11), no migration; the first-run spec's table and step 3 amended with a note naming the ruling (Task 9, step 2); nothing else reads the presets' display modes (research note 6). Ruling 2 (i): the runner's line — where it comes from (`Run.close(result)`, after the unwind: choice 1), its payload (the reasons the runner already has, the notice's code and leg, the leg's state, the time from Start on the run's clock: choice 2), one per leg, a start that fails, a lease's end and Both each pinned (Task 2); no secret, no text; `logStore` checked: no row (choice 6), and its severity rule gives the warning (research note 3). Ruling 2 (ii): Doubao `session.finish` (Task 5), Soniox `stt.end` and `tts.end` (Task 6), Palabra `task.end` and the delete's attempt and outcome, a failed one a warning (Task 7); the kit's rules on events after an ending read and changed with a stated reason (research note 1; choice 3; Task 1), since no frame inside `stop()` can precede the kit's own mark. Ruling 2 (iii): `session.close` sent and framed, not waited for, the comment changed (Task 8). Ruling 2 (iv): Doubao awaits nothing (Task 5). Frame names consistent with each provider's landed ones (choice 4), and the spec's `frame` bullet and its list amended (Task 9, step 1). Tests first for every line: the runner's (Task 2), each adapter's stop case (Tasks 5–8: Doubao's `adapter.test.ts:662`, Soniox's stop cases, Palabra's, OpenAI Translate's), the wizard's (`scenarios.test.ts`, `applySetup.test.ts`, and `useApplySetup.test.ts` through the real stores), and the kit's lifecycles green — Palabra's in both modes, with the delete framed. The controller's docs task (Task 9): the spec amendments, the first-run note, and the roadmap section `## Scheduled by the Stage 2 session-end and wizard plan` with the owner's live test — Stop on each provider, the Palabra app-pair Stop with the network cut, the wizard re-run — among its items. The translation cuts plan named as landing first, and the files and hunks shared with it (Global Constraints; Task 8); every hunk applied on its result.
- **Choices made inside the rulings:** 1–11, listed above; each is cited where it lands.
- **Departures from the brief, each with its reason:**
  - **Choice 7, the separator after `session.stopped`, is added:** the brief did not ask for it; the roadmap has, since the Soniox plan, and without it the Logs keep a separator only after OpenAI Translate's server close.
  - **The kit's rule changes rather than the frames moving before its ending** (choice 3) — the brief's second option: nothing inside `stop()` can come before the kit's own `stop` mark, and a delete's outcome comes after it by construction (research note 1).
  - **`elapsedMs` is counted from Start** (choice 2), one of the brief's two readings, argued there.
  - **`wire.test.ts` is not edited:** `SESSION_CLOSE`'s wire shape is pinned by the adapter's stop case and typed by the SDK; the translation cuts plan rewrites `wire.test.ts`'s import line (choice 9).
  - **Soniox's `stt.end` is framed on a failure's shutdown too** (choice 8), since it is sent there: the brief names the end at Stop; the bad-key case now ends with that line.
- **Placeholders.** None: every code block is the tested scratch copy's diff, applied by `patch -p1` in the replay. The one template is the commit messages' `<implementing model>`, which Global Constraints says to fill in; Task 9 fills its numbers from the run.
- **Type consistency.** Checked in the scratch copy, where every file compiled — the gate at its baseline and the full tree at 259 after each wave: `MarkerName` (`'stopped'`), `checkConformance`'s `late`, `Run.startedAt`, `Run.close(result: RunEnd)`, `frameStopped`, the payload `{ reason, code, leg, state, elapsedMs }`, `ScenarioPreset` (`id`, `mode`, `textOnly`), `ApplySetupDeps` (`setMode`, `setTextOnly`, `applyProvider`, `completeSetup`), `SonioxTtsStream.close(): string | null`, `LegSpeech.close()`, `releaseFrame`, `SESSION_CLOSE`; the frame names `session.stopped`, `session.finish`, `stt.end`, `tts.end`, `task.end`, `session.delete`, `session.deleted`, `session.delete_warning`, `session.close` — each spelled the same in every task that names it.
- **Mutants tried in the scratch copy,** each run against the suites of the task that owns the code, each failing at least one test:
  - **Task 1, the kit:** K1 a frame is never late (4 failing); K2 a frame is always late (the old rule) (28 failing); K3 a frame after failed/closed is late at once (4 failing); K4 the driver marks no stopped (3 failing); K5 the lifecycles mark no stopped (1 failing).
  - **Task 2, the runner:** R1 the line before the unwind (4 failing); R2 no opening-step guard (1 failing); R3 no abandon guard (1 failing); R4 elapsed from live (1 failing); R5 elapsed to the unwind's end (1 failing); R6 no code (3 failing); R7 no leg (2 failing); R8 no state (6 failing); R9 the first leg only (3 failing).
  - **Task 3, the Logs panel:** L1 the separator after session.closed too (1 failing); L2 the separator after session.closed alone (today) (1 failing).
  - **Task 4, the wizard:** W1 a preset keeps a display mode (1 failing); W2 the wizard writes a display mode it is offered (1 failing); W3 the hook binds a display mode write (1 failing).
  - **Task 5, Doubao:** A1 no session.finish (1 failing); A2 session.finish framed whatever the phase (1 failing).
  - **Task 6, Soniox:** S1 stt.end framed whether it went up or not (5 failing); S2 no stt.end (4 failing); S3 tts.end framed with no stream ended (5 failing); S4 tts.end after the leg says nothing (gated) (2 failing); S5 close returns no stream (3 failing).
  - **Task 7, Palabra:** P1 no task.end (4 failing); P2 the delete framed through the gated helper (8 failing); P3 every answer a success (2 failing); P4 a timeout told as a transport error (2 failing); P5 a failed delete an error, not a warning (2 failing); P6 the error's words, not its name (1 failing); P7 no attempt line (4 failing).
  - **Task 8, OpenAI Translate:** T1 no session.close (1 failing); T2 session.close unframed (1 failing); T3 session.close after the close (1 failing).
- **Red before green, each measured:** every task's red step was run on the code before it, with the counts quoted. The cases a diff adds that pass before their task's code, as after it, pin a guard the task keeps or adds: Task 2's "says nothing for a start refused …", Task 3's warning row, Task 5's and Task 8's ended-session cases, Task 6's stop after a failure and close with no stream speaking. The landed cases a diff rewrites fail on the code before for the rule — or, in Task 4, because the test helper no longer offers the setters that code calls.
