# Client contract — Stage 2, provider 2: Kizuna Soniox (Plan B1, the port)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Standing of the rulings below.** Rulings 2 and 6 are **the owner's decisions** (2026-09-27, in conversation): ruling 2's participant speech built end to end and shipped off behind one flag, and ruling 6's registry order with Kizuna AI first and D19's release-flag model. The rest are the controller's rulings on the survey's §4, adopting its recommendations (ruling 9 with its reason corrected), **provisional** until the owner confirms; he may overturn any of them before execution.

> **Prerequisite:** the owner's BYOK live test of the Stage 2 Soniox plan (roadmap, "Scheduled by the Stage 2 Soniox plan" → "Before any release from the branch") passes before this plan's execution builds on its adapter (ruling 13).

**Goal:** Kizuna AI's managed Soniox (`kizunaai_soniox`) on the new contract: `managed(soniox, …)` over Soniox's adapter, settings and languages, with its lease, its voice claim, its balance floor, its countdown, its account row and the wizard's managed path — so the managed twin runs on the new session and the owner can run it live, paid. Concretely:
- the contract gains what a lease needs: a read type `R` (a managed `read` answers the sign-in, never a key), `minimumBalance`, `Resources.budget` and `RunState.running.budget`, a frame sink on `acquire`, a sign-in that says it is still loading, and a definition capability saying whether the participant may speak;
- the runner opens every leg's source before it acquires a lease, so a source that fails mints no key and cannot 409-lock the next Start; and it records a lease's end once, on the first leg (rulings 7, 9);
- the start gate reads the account's wallet from a small store and refuses below the provider's floor (ruling 5: never on an unknown balance);
- the lease (`src/providers/soniox/lease.ts`) ported from `ManagedSonioxSession`: the session key and its 409 retry on the run's clock, per-leg keys, the grant's end in the words ruling 3 decides, `session-started` per role behind `SonioxLeasePort`, and a bounded `session-end` that a closing page still sends;
- managed participant speech built end to end and shipped off behind the definition's one flag (ruling 2): the request's intent field, the `par_tts` key on the participant's leg in every mode, and floors counted from the roles — so that when the backend mints `par_tts`, the client change is a flag flip and a field-name check;
- the voice claim in `prepare`, the managed voice library, and the modules they use moved or ported beside Soniox;
- the definition, registered first (ruling 6); the account row, "Recommended", the countdown, the account button's dot; the wizard's managed path, the stored-selection fallback and the sign-in auto-switch (ruling 4).

The plan ends with the controller's docs task: the spec's amendments and the roadmap's record, with the owner's **paid** live test (ruling 14). Deleting both Soniox providers' old code is **Plan B2**, written after this plan lands and the paid live test passes; this plan only records its inventory.

**Architecture:**
- **The managed files live beside Soniox** (`src/providers/soniox/`), as `fake/leased.ts` sits beside the fake (ruling 10; survey §2.1.3): `kizuna.ts` (the definition, and its participant-speech flag), `leaseRequest.ts` (the session-key request and the roles it asks for), `kizunaBudget.ts` (the floors and caps mirrored from the backend), `lease.ts` (`acquire`), `voicePrep.ts` (the claim routine, ported), `voiceClaim.ts` (`prepare`), `managedVoicesClient.ts` and `managedVoicePolling.ts` (moved, with re-export stubs at the old paths), `managedVoiceSource.ts` (the settings' voice source hook). None of them is reached by `adapter.ts`, so the session-side guard does not walk them: their fetches and timers are their own, and every timer still reads the run's clock where a run hands one.
- **`managed(base, overrides)`** is a generic helper in `src/lib/provider/managed.ts`: it names what a twin takes from its base (languages, capabilities, builder, adapter, `startBoth`, turn detection) and what is its own (id, kind, vendor, icon, storage key, `Settings`, a sign-in `read`, a static `check`, its lease and hooks).
- **Two generic runner changes:** sources before a lease (ruling 9) and one lease-end notice (ruling 7). LocalInference, the fake and own-key Soniox run as before, but for one stated difference in own-key Soniox's Both mode (choice 3).
- **The old managed code stays compiled and unreachable** (ruling 1): `ManagedSonioxSession`, `KizunaAISonioxProviderConfig`, `managedSonioxSplit`, `managedVoicePrep`, the old settings UI and store slices — Plan B2's to delete.

**Tech Stack:** TypeScript (strict), React 19, zustand, i18next, Vitest + @testing-library/react (jsdom), the adapter test kit (`FakeSocket`, the virtual clock), a stub `fetch` answering `Response` objects, headless Chromium over the DevTools protocol (`scripts/dev/headless.mjs`) at the group checks.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — the binding authority, as amended by the Stage 2 foundation and Soniox plans. The parts this plan implements: "Managed twins are composition"; "Session hooks on the provider definition" (`prepare`, `acquire`, `minimumBalance`, `Resources`); "A run" and "Legs rise and fall together"; "The provider definition" (the shape, and "Readiness is one check" for a managed provider); "Notices reach the user localized"; "Session lifecycle" (`RunState.running.budget`, `pagehide`'s lease release); "Migration" (Kizuna Soniox, step 2). It amends the spec in Task 13.

**Research notes:**
- **The survey this plan is written from:** `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/stage2-kizuna-soniox-survey.md`, cited as *survey §x*: §1 (the old managed code as protocol documentation, and the backend `BE:`), §2 (the mapping), §4 (the decisions, ruled below), §5.2 (B1's outline — this plan's starting point), §6 (risks), §7 (spec corrections), §1.13 (old tests ported as specs), §1.14 (quirks not ported). Its line references were written at `a63c366b`, this plan's HEAD; every one this plan relies on was re-read there.
- **The backend** is the sibling repo `/home/jiangzhuo/Desktop/kizunaai/sokuji-backend` at `7b2259c` (read-only). The values this plan mirrors were re-read there: `MAX_TRANSCRIPTION_SESSION_S = 18_000` and `MIN_SESSION_S = 60` (`src/config/soniox.ts:33, 35`), `TTS_KEY_MAX_TTL_S = 3600` (`:72`), `MAX_SYNTHESIS_SESSION_S = Math.min(MAX_TRANSCRIPTION_SESSION_S, TTS_KEY_MAX_TTL_S)` (`:81`), the conservative rates `stt: 1_100_000`, `tts: 1_400_000` µUSD/h (`src/services/soniox-budget.ts:76-77`), and `computeSessionBudget` (`src/routes/soniox.ts:46-92`).
- **The survey's corrections found while writing:**
  - The acquire context in the leased fake's tests is built by hand four times (`leased.test.ts:99, 111, 119, 128`), so adding the frame sink to the contract edits that test in the types task (Task 1).
  - `appSubtitleSession` subscribes to no store that holds `textOnly` (`lib/subtitle/appSession.ts:60`), and the balance floor depends on it: the gate task adds that subscription too.
  - A refused lease must not clear the last conversation from the screen: before this plan, `acquire` ran before the run handed its legs to the runner (`run.ts:180-212`). Moving `acquire` after the sources (ruling 9) moves the hand-over after the lease too (choice 3).
  - The account button's test mocks `utils/environment` and `stores/settingsStore` whole (`AccountButton.test.tsx:41-43, 58-62`), so the button reads the gate through a hook of its own that the test mocks (choice 9), not through `appShape.ts`.
  - The three `MainLayout` tests mock `stores/settingsStore` whole; the auto-switch's hook is mocked in each (Task 12).
  - Survey §0.7 / §4.8's first reason for ruling 9 — a participant OS permission dialog spending the speaker key's 60-s start window — does not hold here: no participant source shows a dialog at Start (Electron's `electron-audio-loopback` answers `getDisplayMedia` itself with no picker, `electron/main.js:586`; the PipeWire/Pulse monitor and the per-app helper do not prompt; macOS Screen Recording is granted once in System Settings, and `src/lib/audio/capture/systemAudio.ts:164-166` refuses at once when it is denied; the extension's tab source uses `tabCapture` with `chromeMediaSource: 'tab'`). Ruling 9 rests on the never-started lease alone (survey §1.2).
  - Plan A's `startBoth` already gives a speaking participant its own TTS socket on its own key in both Both modes (`adapter.ts:80-86, 494-499`; `adapter.both.test.ts:106-124, 212-230`), so ruling 2's participant speech needs no adapter change.
- **The roadmap:** `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` — "Scheduled by the Stage 2 foundation plan" → **Kizuna Soniox** (`:1262-1283`) and "Parked from the task reviews" (`:1320-1350`); "Scheduled by the Stage 2 Soniox plan" → "What it leaves → Kizuna Soniox" (`:1728-1738`), "Found here" (`:1740-1747`), "Before any release" (`:1751-1762`), "Open questions" (`:1764-1772`). The section "The roadmap's inheritance, item by item" below carries survey §2.12's mapping.
- **Form models:** `docs/superpowers/plans/2026-09-26-client-contract-stage2-soniox.md` (Plan A) and `docs/superpowers/plans/2026-09-26-client-contract-stage2-foundation.md` (the leased fake's shape).

## Global Constraints

- **Starting point.** HEAD `a63c366b` on `worktree-client-contract-stage2`. Every task anchors its edits by content, not by line: a line number cited here was read at `a63c366b`.
- **What this plan touches:**
  - `src/lib/provider/{types,credentials,managed}.ts` (+ `managed.test.ts`); `src/lib/session/{types,run,runner,shape,appShape,storedSettings}.ts` and their tests; `src/lib/subtitle/appSession.ts` and its test; `src/lib/view/{noticeText,noticeTargets}.ts` and their tests;
  - `src/providers/soniox/{kizuna,leaseRequest,kizunaBudget,lease,voicePrep,voiceClaim,managedVoicesClient,managedVoicePolling,managedVoiceSource}.ts` (new or moved) and their tests, and `kizunaParticipantSpeech.test.tsx`; `src/providers/soniox/adapter.test.ts` (one case, Task 6); `src/providers/fake/{leased,settings}.ts`, `FakeLeasedSettingsView.tsx` and their tests; `src/providers/registry.ts` and its test; `src/providers/localInference/provider.test.ts` (its registry-order case, Task 8);
  - the two re-export stubs at the moved modules' old paths, `src/services/clients/{ManagedVoicesClient,managedVoicePolling}.ts` (Task 7) — the only files under `src/services` this plan writes;
  - `src/stores/accountStore.ts` (new) and its test; `src/contexts/UserProfileContext.tsx` and one new test file beside it;
  - `src/app/{session,useAppSession,loadStores}.ts` and their tests;
  - `src/components/providers/{ProviderPicker.tsx,ManagedAccountRow.tsx,useAuthContext.ts}` and their tests; `src/components/MainPanel/SessionCountdown.tsx`, `panel/{PanelFooter.tsx,startLabel.ts}` and their tests; `src/components/TitleBar/{AccountButton.tsx,useBalanceShortfall.ts}` and their tests; `src/components/Settings/sections/ParticipantSpeechSwitch.tsx` and its test; `src/components/SetupWizard/providerPaths.ts`, `providerPaths.test.ts`, `providerPaths.managedFit.test.ts`, `SetupWizard.test.tsx`; `src/components/MainLayout/{MainLayout.tsx,useSignInProviderSwitch.ts}`, its new test and the three `MainLayout.*.test.tsx`; `src/components/dev/SpinePreview.tsx` and its test;
  - the 30 `src/locales/<code>/translation.json` (one key, Task 4);
  - the spec and the roadmap (Task 13).
- **Read only (ruling 1).** `src/services/**` but the two stubs of Task 7 — among them `ManagedSonioxSession.ts`, `KizunaAISonioxProviderConfig.ts`, `managedSonioxSplit.ts`, `managedVoicePrep.ts` (ported, not moved: the old copy stays until B2), `sonioxManagedMinBalance.ts`, `ProviderDescriptor.ts`, `ProviderConfigFactory.ts` and every old test; the old settings UI (`ProviderSpecificSettings.tsx`, `ProviderSection.tsx`, `LanguageSection.tsx`, `SonioxVoiceSection.tsx`, `voiceLibrarySource.ts`, `VoiceLibrarySection.tsx`, their tests); `src/stores/settingsStore.ts`; `src/components/SettingsInitializer/**`; `src/types/Provider.ts`; `extension/**`; `electron/**`. New code imports nothing from `src/services/**`. It reuses `managedVoiceSource` from `voiceLibrarySource.ts` as own-key Soniox reuses `byokVoiceSource` (Plan A, F13), and the account popover's request flag from `settingsStore` as the old UI did (`useSetAccountPopoverRequested`) — what those import is theirs. `npx vitest run src/services` stays green.
- **Import rules:**
  - `src/lib/**` never imports React or `src/app/**`. `src/lib/contract/testing/**` is test-only.
  - A provider's session side — `adapter.ts` and every file of its folder it reaches by a value import — imports no store and no reporter and runs no global timer. The managed files are not on Soniox's session side (`adapter.ts` imports `settings.ts` for types only): `sessionSide.consistency.test.ts` stays as it is. The lease still runs every timer on the run's clock (`ctx.clock`), and the voice claim's sleeps default to the real clock with injection for tests (ruling 10; hooks are exempt from the session-side clock rule, foundation choice 11).
  - Both fakes reach a bundle only through the registry's `import.meta.env.DEV` literal (D24).
- **Diagnostics** (CLAUDE.md, "Error Handling"): the lease and the voice claim never call `console.*`. The lease reports its wire traffic as frames (`session.*`) through `ctx.frame`, which the runner routes to the first leg's Logs; a start it refuses is an `AdapterStartError` with a notice code, worded by `noticeText`. The ported claim routine keeps its two `reportError` calls (a settings-side module, as `managedVoicePrep.ts` is today).
- **Locales (rulings 2 and 11).** One new key, `audioPanel.participantSpeechNotYetAvailable` ("not available yet" in kind — no catalog sentence says that for this switch), in all 30 catalogs with a real translation (Task 4), listed for a native speaker's spot check. Every other sentence is an existing key: through `NOTICE_ALIASES` (the two Soniox service sentences, the four voice-claim sentences, the gate's balance sentence, and the loading sign-in's — choice 10) or read directly (`simpleSettings.autoAuthenticated`, `common.signInRequired`, `update.checking`, `simpleSettings.recommended` / `recommendedOption`, `simplePanel.preparingVoice` / `mainPanel.preparingVoice`).
- **No network (ruling 12).** No test, probe or step calls Kizuna's backend or Soniox. The lease and the voice modules are tested over a stub `fetch` (injected, or `vi.stubGlobal`) and a virtual clock; the adapter over `FakeSocket`; the Provider tab rendered signed out, and signed in with the managed voice source replaced by the preview's stand-in (Task 9), which calls nothing. No group check presses Start with Kizuna Soniox selected: the preview's stand-in token would reach `/soniox/session-key`.
- **Gates for every task:**
  - **The suite.** `npx vitest run src` shows 0 failed and no unhandled errors. Measured at `a63c366b` on 2026-09-27: **479 test files passed and 1 skipped (480); 6 094 tests passed and 2 skipped (6 096); no unhandled errors.**
  - **The typecheck.** The gate prints exactly the baseline lines below. The shell's `grep` is a ugrep wrapper that mis-parses this regex, so use `command grep` exactly as written. The regex is Plan A's, widened by every file this plan creates or edits outside it: `services/clients/managedVoicePolling` (a stub, so a broken re-export shows) and the old importers' tests `services/providers/(managedVoicePrep\.test|prepareToStart\.kizunaSoniox\.test)`; `voiceLibrarySource(\.test)?`; `MainPanel/SessionCountdown`; `MainLayout/(MainLayout|useSignInProviderSwitch)` (the `MainLayout.*.test.tsx` files with it); `sections/ParticipantSpeechSwitch(\.test)?`; `TitleBar/(AccountButton(\.test)?\.tsx|useBalanceShortfall)`; `contexts/UserProfileContext` (its tests with it); `stores/accountStore`. Everything else this plan creates is already inside it (`app/`, `lib/(provider|session|subtitle|view)`, `providers`, `components/providers`, `components/MainPanel/panel/`, `SetupWizard/…`, `dev/SpinePreview`).

    ```
    npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts|diagnostics/(consoleLedger|clientDiagnostics))|lib/modern-audio/BaseAudioRecorder|providers|services/(clients/(SonioxSttStream|SonioxTtsStream|PcmMixer|SonioxSideTracker|SonioxTtsRest|SonioxVoicesClient|SonioxClient|ManagedVoicesClient|managedVoicePolling)|providers/(SonioxProviderConfig|KizunaAISonioxProviderConfig|managedVoicePrep|managedVoicePrep\.test|prepareToStart\.kizunaSoniox\.test))\.ts|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|MainPanel\.|panel/|SessionCountdown)|MainLayout/(MainLayout|useSignInProviderSwitch)|Settings/(Settings\.tsx|ProviderArea|SimpleSettings/SimpleSettings\.tsx|AdvancedSettings/AdvancedSettings\.tsx|sections/((SpeechSection|VoiceLibrarySection)(\.test)?\.tsx|(ParticipantSpeechSwitch(\.test)?|SentenceSegmentationSection|SystemAudioSection|SonioxVoiceSection|ProviderSpecificSettings)\.tsx|voiceLibrarySource(\.test)?\.ts))|SettingsInitializer/|SetupWizard/(SetupWizard(\.test)?\.tsx|applySetup\.ts|useApplySetup\.ts|providerPaths(\.test|\.managedFit\.test)?\.ts|steps/(StepLanguagePair|StepCredentials|StepCredentials\.test|StepFinish|StepProviderPath|StepScenario)\.tsx)|TitleBar/(AccountButton(\.test)?\.tsx|useBalanceShortfall)|Tour/useStartBasicsTour\.ts|dev/(SpinePreview|SessionControls|OverlayPreview|wireTally|gapCounter))|contexts/UserProfileContext|locales/(index\.ts|showLanguageUncached)|routes/Home\.tsx|stores/(providerStore|turnModeStore|routingStore|accountStore|settingsStore\.ts)|utils/(environment|conversationExport)|subtitle-overlay-entry|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
    ```

    **The baseline** — exactly these **18** lines, measured at `a63c366b` (259 lines in the full tree, the survey's §3.4 count):

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
    src/stores/settingsStore.ts: error TS2353: Object literal may only specify known propertie
    src/stores/settingsStore.ts: error TS2353: Object literal may only specify known propertie
    src/utils/environment.ts: error TS2717: Subsequent property declarations must have the sam
    src/utils/environment.ts: error TS2339: Property 'create' does not exist on type '{ query(
    ```

    Do not fix them; do not add to them. `MainLayout.tsx`'s line stays when Task 12 edits the file (it does not touch `useTranslation`). `SonioxVoiceSection.test.tsx` stays outside the regex: it imports `ManagedVoicesClient` as a type through the stub and carries 7 stale-prop lines of its own (survey §3.4).
  - **The type-level cases** (`@ts-expect-error` lines in `managed.test.ts`) are enforced by this gate: an expectation that no longer errors is TS2578, a new gate line.
  - **Gates in a parallel wave** (as Plan A's). Waves run tasks at once in this one working tree, so each task sees the others' red phases:
    - a test failure, or an extra gate line, in a file another concurrent task is changing is that task's work in progress: the implementer names it in the report and never touches it;
    - the task's own files must be green, and the gate must print the baseline plus only such named lines;
    - after each wave the controller runs the full gates: the suite at 0 failed with no unhandled errors, and the exact baseline.
  - **A task edits only the files in its Files list**, and commits exactly those. Where a step names tests elsewhere that its change could reach, it names why each stays green. If one fails anyway, the implementer stops, reports the failure with its output, and leaves the file untouched: the controller decides. No task edits a read-only file or a file another task of the same wave edits.
  - **No task mutates the tree to prove a guard.** Every guard proves itself with controls inside its own test.
- **Builds, at the group checks only** (the controller's):
  - `npm run build` and `npm run extension:build`. If `extension/node_modules` is missing, run `npm ci --prefix extension` first.
  - `npx vitest run extension`.
  - The D24 check: each of these prints nothing —
    - `command grep -rlF 'The fake degraded its speech' build extension/dist`
    - `command grep -rlF 'Lease ended by the leased fake' build extension/dist`
    - `command grep -rlF 'The leased fake refused the lease' build extension/dist` (Task 2's new knob, development only)
  - The Kizuna check (group check B): `command grep -rlF 'session.lease_acquired' build extension/dist` prints the app's and the extension's main chunks — the new lease shipped in both. Nothing under `src` holds that string at `a63c366b` (checked); the old managed client never emitted it.
- **Dev servers, probes and builds** are the controller's; an implementer never starts one. Checks run against a fresh vite: `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort --force`. Restart it after edits: a worktree's vite can serve stale transforms.
- **Shell forms.** This worktree's guard refuses compound shell forms: brace groups, loops, `cd … &&` chains. Every command in this plan is a single command or a plain pipeline, run as its own call from the worktree root. Use `command grep`. The shell is zsh: quote globs; `echo ====` is an error. Checks write their outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, never `/tmp`.
- **Commits:**
  - Conventional, in English. Every message ends with the implementing model's own `Co-Authored-By:` line, then `Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe`, and nothing after it. The examples below write the first as `Co-Authored-By: <implementing model> <noreply@anthropic.com>`: fill in your own model's name.
  - Run `git add <paths>`, then `git commit -q -F - -- <the same paths> <<'EOF' … EOF`, as two separate calls. The `--` pathspec is mandatory: parallel tasks stage into the same index. Never stage a whole directory that is not wholly the task's.
  - Never push.

## Rulings

The rulings on survey §4 (cited as *ruling N*), each restated with where it lands. Rulings 2 and 6 are the owner's (2026-09-27); the rest are the controller's, provisional — the owner may overturn any before execution.

1. **Old code read-only** (as Plan A's ruling 1): `src/services/**`, the old settings UI, the `settingsStore` slices, `SettingsInitializer` and their tests are not edited, except that `ManagedVoicesClient` and `managedVoicePolling` move with their tests into `src/providers/soniox/` by `git mv`, each leaving a one-line re-export stub at its old path, so the old client, the old UI and their tests resolve unchanged; `managedVoicePrep` is **ported** (copied) to `src/providers/soniox/voicePrep.ts`, the old one kept until B2. New code imports nothing from `src/services/**`. `npx vitest run src/services` stays green. Lands in: Task 7; Global Constraints.
2. **Participant speech — built end to end, shipped off (survey §4.1; the owner's decision, 2026-09-27: the backend does not mint `par_tts` today but likely will):** so that when the backend starts minting `par_tts`, the client change is a flag flip plus a field-name check.
   - **The flag** is one capability on the definition, `Provider.participantSpeech?: boolean` (Task 1), `false` on the shipped Kizuna Soniox definition (`KIZUNA_PARTICIPANT_SPEECH` in `kizuna.ts`, Task 8). The same capability is read by `contextsFor`, `readShapeFromStores` and `ParticipantSpeechSwitch` (Task 4): while it is off, the switch shows off and disabled with a "not available yet" tooltip, keeping the stored choice. No catalog sentence says that (checked: the nearest, `settings.webgpuNotSupported` "Not available in current environment", blames the environment), so one new key, `audioPanel.participantSpeechNotYetAvailable`, goes into all 30 catalogs with a real translation, listed for the spot check.
   - **The request** (Task 5): the builder takes the participant-speech intent and serializes it only when the flag is on, under one constant, `PARTICIPANT_SPEECH_FIELD`. The backend reads the body's fields by name and ignores unknown ones (`BE:src/routes/soniox.ts:254-280`), but the name is its future choice. With the flag off the body is byte for byte today's.
   - **Roles and keys** (Task 5): with the flag on and a `par_tts` in the answer, that key is the participant leg's `K.tts` — beside `par_stt` in split Both and participant-only, and next to the shared `mix_*` bundle (which stays on the speaker's leg) in shared Both. With the flag off a `par_tts` in an answer is ignored. A leg meant to speak with no TTS key stays text-only through Plan A's `tts_degraded` seam. Plan A's `startBoth` already gives the participant its own TTS socket on its own key in both Both modes — `coreLeg('participant', requests.participant, …)` builds its speech from `requests.participant.credentials.tts` (`adapter.ts:80-86, 494-499`), pinned by `adapter.both.test.ts:106-124` (split) and `:212-230` (shared) — and participant-only runs the one-leg core on the participant's credentials. The adapter needs nothing new.
   - **Floors** (Task 5): `minimumBalance` is computed from the roles the shape would request — `ceil((n_stt × 1 100 000 + n_tts × 1 400 000) × 60 / 3 600)` µUSD — so a participant TTS stream counts once the flag is on. The parity test pins today's floors, and says that the formula also prices the future role, for which the backend has no floor yet.
   - **Turning it on** is a checklist Task 13 records (survey §4.1's option c).
   - Lands in: Task 1 (the capability's type), Task 4 (its readers and the key), Task 5 (the request, the roles, the keys, the floors), Task 8 (the flag, and the flag-on / flag-off end-to-end spec), Task 13 (the checklist).
3. **The words at the grant's end (§4.2 c):** decided at acquire. When the granted duration reached the per-session cap — 3 600 s with a TTS stream, 18 000 s without, mirrored like the floors with a backend-parity test — the grant's end is `segment_ended` ("This segment has ended — tap Start Session to continue."); otherwise `budget_exhausted` ("Your session balance is used up. Top up your balance to keep translating."). The budget's own timer and a 403 at the grant's end give the same words. Lands in: Task 5 (the caps, the decision, the timer), Task 6 (the 403 path).
4. **Sign-in auto-switch (§4.3):** restored for Basic mode only, outside the wizard, from a non-managed provider, through `select(id, 'pick')` with its lock, tracking `settings_modified` as before. Lands in: Task 12 (with choice 14's one refinement).
5. **Unknown balance (§4.4 b):** no gate on an unknown quota; the backend's 402 is the authority and the lease words it (`insufficient_balance`). Lands in: Task 3 (`balanceRefusal` answers nothing without an account), Task 5 (the 402's code).
6. **Registry, flags, gate words (§4.5; the order and the flag model are the owner's decision, 2026-09-27):** `RELEASED` order `['kizunaai_soniox', 'localInference', 'soniox']` — Kizuna AI first; the registry order test pins it.
   - **Release flags keep D19's model:** a provider is offered by default, and only a definition marked `flagged: true` is hidden in release builds; `VITE_ENABLED_PROVIDERS` only un-hides flagged ids in a given build (`isPresent`, `src/lib/provider/presence.ts`). Kizuna Soniox ships **unflagged**, gated only by the Kizuna umbrella (`isKizunaAIEnabled()`, `VITE_ENABLE_KIZUNA_AI`) through `isPresent`'s managed rule. The new registry does not read the old `VITE_ENABLE_KIZUNA_SONIOX` (only `src/utils/environment.ts:219` does, for the old factory).
   - **The target state** (Task 13 records it under the roadmap's "Before any release"): managed keeps only Kizuna Soniox — the two relay-managed providers (`KizunaAIOpenAITranslateProviderConfig`, `KizunaAIVolcengineAST2ProviderConfig`) are deleted, not ported; every other provider is ported unflagged except Local Native, which gets `flagged: true` plus its tester switch; `VITE_ENABLED_PROVIDERS` stays unset; the old per-provider `VITE_ENABLE_*` variables retire as their providers move over, and Stage 2's cleanup removes them from `.github/workflows/build.yml` (the repo variables are the owner's to delete); the umbrella `VITE_ENABLE_KIZUNA_AI` stays, so a build without Kizuna's backend offers no managed provider.
   - No code in this plan for the flag model beyond Kizuna Soniox being unflagged. The gate's balance refusal is a gate-only code, `balance_below_floor`, aliased to the existing `mainPanel.insufficientBalance` "Insufficient balance: {{balance}}" (no new key). Lands in: Task 3 (the code), Task 8 (the order, the alias).
7. **One lease-end notice (§4.6):** a lease end records its notice on the first leg only — a generic runner change and a spec refinement. Lands in: Task 2; Task 13 (the spec).
8. **Analytics (§4.7):** the shifts are accepted as stated departures, pending the owner's cross-provider answer (the same question as Plan A's `degraded` analytics): a refused start reaches `error_occurred` only (the runner tracks `api_error` for `failed` alone, `run.ts:444-449`; `runner.ts:221-225`), and a budget exhaustion sends no `api_error`. No new event in this plan. Lands in: Task 2 (a test pins the refused start's events); the self-review; Task 13 (the open question).
9. **Acquire after the sources (§4.8):** the runner opens every leg's source, then runs `acquire`, then starts the adapters — a generic runner change, with the ordering case in `runner.hooks.test.ts` (a source that fails mints no lease). **Why: the never-started lease** (survey §1.2). A source that fails after `acquire` leaves a lease no stream ever started, which the backend's sweeps never reach and `session-end` cannot free, so the next Start is 409-locked until its initial expiry — 75 s, or 195 s with `par_stt`. Such failures are real: `LOOPBACK_DENIED` on macOS, the extension's side panel with no bound tab, the app-capture helper failing to start, a missing microphone. Opening the sources first makes them fail before any key is minted. (The survey's other reason does not hold here: research notes.) LocalInference and the fakes are unaffected: a provider with no lease and no `startBoth` opens each leg's source and adapter as before. **`prepare` stays before the sources:** it may override the settings the builder reads, `build` and `admit` must refuse before anything opens, and the voice claim can take up to 60 s, which must not hold a microphone open. The survey shows no reason to move it (the claim's 75-s pin is recorded under "Found here"). Lands in: Task 2.
10. **Smaller choices (§4.9):** `session-end` — at most 3 attempts within 4 s, the token cached at acquire, cancelled by the next acquire; the voice claim's sleeps on the real clock, injection kept for tests; the `streams`-absent and `region`-absent fallbacks dropped, failing loudly as the old primary-role check did; the managed files in `src/providers/soniox/`; `managed()` a generic helper in `src/lib/provider/managed.ts`; the read type `R` with a type-level test. Lands in: Tasks 1, 5, 7.
11. **Locales:** besides ruling 2's key, no new keys. Every sentence is an existing key reached through `NOTICE_ALIASES` — the two Soniox service sentences, the four voice-claim sentences, the gate's balance sentence (survey §2.9) — and `NOTICE_TARGETS.sign_in_required`, with `noticeTargets.test` widened to aliases. Lands in: Task 8.
12. **No network in tests:** see Global Constraints. Lands in: every task's tests; Task 9's preview stand-in; the group checks.
13. **Prerequisite:** the owner's BYOK live test of Plan A before this plan's execution builds on the adapter. Lands in: the header.
14. **The last task is the controller's docs task** (Task 13): the spec's amendments (survey §7, rulings 7 and 9, the capability of ruling 2, `managed()`, `R`) and the roadmap section "Scheduled by the Stage 2 Kizuna Soniox plan" — what landed, the owner's paid live test (survey §5.2's list, adjusted to the rulings), the stated departures, the open questions, and B2's pointer (survey §3, including the re-point it adds: `SonioxVoiceSection.tsx:47` → `clampNumber`).

## Choices this plan makes inside the rulings

Cited as *choice N*.

1. **`R` is the sign-in, `ManagedSignIn = { readonly signedIn: true }`** (Task 1). `Provider<S, K, C, R extends { missing?: never } & object = K>`: `credentials.read` answers `R | CredentialsMissing` and `check(r: R, …)` takes it; `start` and `acquire`'s `Resources<K>` keep `K`. An own-key or local provider is unchanged (`R` defaults to `K`). A provider whose `R` is not its `K` must mint `K` in `session.acquire`: `managed()`'s overrides type requires it. The runner handles credentials as `unknown` already (`run.ts:122, 180`), so the change is type-level, pinned by `@ts-expect-error` cases the gate enforces.
2. **`managed()` names what the twin inherits** (Task 1): `platforms`, `languages`, `speech`, `textInput`, `boundaries`, `turns`, `build`, `describe`, `start`, `TurnDetection`, `settings.defaults` / `migrate`, and `session.startBoth`. It does **not** inherit the base's `guideUrl` (a managed user has no key to get), `i18nKey` (the twin's id has its own locale keys), `flagged` / `testerSwitch` (a managed provider's presence is the umbrella's) or `check` (a twin's is static: the sign-in is `read`'s, the balance the gate's). Spelled out, not spread-and-dropped, so a member added to the base later is a decision here.
3. **The order inside a run** (Task 2): the gate, credentials, readiness, `prepare`, builds, `admit`; then `opening`: the run creates its legs' conversations and records `prepare`'s notice; opens every leg's source **when a lease will be minted or both legs start at once** (`startBoth` takes both sources, as today); acquires the lease; **then hands its legs to the runner** (`host.conversations`); then starts the adapters. A refused lease, or a source that fails before it, leaves the last conversation on screen — as a refused `acquire` did before this plan. A provider with neither a lease nor `startBoth` (LocalInference, the fake) hands its legs over before its per-leg opens, exactly as today. **The one difference outside a lease:** own-key Soniox in Both mode now hands its legs over after both sources opened, so a participant source that fails (`LOOPBACK_DENIED`, no bound tab) leaves the last conversation on screen instead of clearing it (a stated departure).
4. **The lease's frames go to the first leg's Logs** (`ctx.frame` → `deps.frames.frame(shape.legs[0], …)`, Task 2), including the ones `release` sends while the run unwinds: the Logs keep `session-end`'s outcome.
5. **The session key** (Task 5): one attempt is bounded at `SESSION_KEY_TIMEOUT_MS` = 15 000 ms on the run's clock, **its JSON body read inside the bound**; the 409's one retry waits the body's `retryAfterMs` (3 000 ms when absent) on the clock, abortable, and gets its own full bound. Codes: 401 `sign_in_required`, 402 `insufficient_balance`, 403 `wallet_frozen`, 409 after the retry `session_conflict`, 502 or a timeout `soniox_service_unavailable`, 503 `soniox_service_busy` (all three of the backend's 503 bodies, as the old client worded them: parity, survey §1.12.3), a transport failure `network`, any other status a plain `Error` carrying the server's words (the runner's `start_failed`). A 402's `requiredMicroUsd` / `balanceMicroUsd` go into the diagnostic message only: the aliased sentence has no placeholder.
6. **`session-end`** (Task 5; ruling 10): `release` stops the budget's timer, frames `session.end`, and POSTs `{ leaseId }` with `keepalive: true` and the token cached at acquire — the first attempt starts synchronously, so `pagehide`'s `abandon()` sends it. An attempt that fails in transport or answers 5xx is retried after 500 ms, then 1 000 ms; no attempt begins after `SESSION_END_BUDGET_MS` = 4 000 ms, and each is aborted at that deadline. A 4xx is final (framed `session.notify_failed`). Giving up frames `session.notify_failed`. `release` resolves when the attempts are done — at most 4 s, within the stack's 5-s release bound. The next `acquire` cancels a previous release's pending attempts: the backend scopes `session-end` by account (survey §1.2), and a late one would end — and unpin the voice of — the next lease.
7. **The grant** (Task 5): `Resources.budget = { totalMs: maxSessionDurationSeconds × 1000, endsAt: clock.now() + totalMs }` — the countdown is the granted duration (survey §1.5, §7.2), measured from acquire as before. The budget's timer fires `end` at `totalMs` once, with ruling 3's words; `release` cancels it. A contract break in a 200 answer — no `leaseId`, no `clientReferenceId`, no known `region`, no granted duration, no `streams`, a malformed stream, or no key for a role a requested leg runs on — fails the start with a plain `Error` (ruling 10). The backend frees such a never-started lease at its start window's end; `session-end` cannot free it (survey §1.2), so none is sent.
8. **The balance gate** (Task 3): a small store, `useAccountStore`, holds `{ balanceMicroUsd, frozen } | null`, written by `UserProfileProvider` from its quota (null while unknown). `RunShape.account?` freezes it at start; `GateInput` gains optional `textOnly` and `account`. `gate()` ends with `balanceRefusal()`: nothing without an account or without the provider's `minimumBalance`; a frozen wallet → `wallet_frozen`; a balance below the floor → `balance_below_floor` with `params.balance` floored in USD (`formatUsdFloor`, as the old gate did). Checked after the gate's other refusals (turns, the participant's source and pair). `appSubtitleSession` subscribes to the account store and to `settingsStore`'s `textOnly`, so Start follows both.
9. **The account button reads the gate** (Task 10) through `useBalanceShortfall()` — the gate's `balance_below_floor` for the selected provider over the same stores as Start — so the dot and Start never disagree (`AccountButton.tsx:130-132`'s own rule). A frozen wallet is not a low balance: no dot for it — a stated departure (the old dot lit for a frozen wallet whose balance was below the floor, `AccountButton.tsx:133-138`).
10. **The sign-in may still be loading** (Tasks 1, 8, 9): `AuthContext.loaded?: boolean` (absent reads as loaded). A managed `read` answers `{ missing, code: 'sign_in_pending' }` while it is false, and the account row shows a spinner with "Checking..." — `sign_in_pending` is aliased to `update.checking` ("Checking...", in all 30 catalogs; a generic word, not the updater's). The session's bridges and `useAuthContext` pass `isLoaded`; a flip of `loaded` forgets managed readiness as a sign-in flip does. So a signed-in user no longer sees "Sign in to use Kizuna AI's built-in translation service." at every launch (roadmap `:1283`).
11. **The flag is `participantSpeech?: boolean`** on the definition (Task 1): `false` — the participant never speaks, whatever its switch says; absent or `true` — it speaks when its switch is on. Read in three places (Task 4): `contextsFor` gives the participant no speech, `readShapeFromStores` (through `participantSpeechFromStores(provider)`, which the live gate and the account button's floor share) freezes `participantSpeech: false`, and the switch shows off and disabled with the "not yet" tooltip. The provider precedes the whole-system rule in the switch: it is absolute. **Kizuna Soniox is built by a factory**, `createKizunaSonioxProvider({ participantSpeech })` (Task 8), which hands the one boolean to the definition's capability, its lease (`createKizunaLease({ participantSpeech })`: the request's field and the `par_tts` mapping) and its floor — so the shipped definition's `KIZUNA_PARTICIPANT_SPEECH = false` is the only line to flip, and the tests build a flag-on twin from the same factory.
12. **The leased fake gains three knobs** (Task 2): `acquireRefused` (`acquire` throws `AdapterStartError(…, 'insufficient_balance')` — the parked coded-refusal item), `minimumBalanceMicroUsd` (its `minimumBalance`: the knob for a text-only start, twice it when the speaker speaks, as a lease's floor rises with speech; 0: a zero floor — a frozen or negative wallet still refuses), and its lease's `budget` from `leaseEndsAfterMs`. Its `acquire` frames `lease.acquired`. The preview can then show the refusal, the gate and the countdown with no vendor.
13. **A stored managed id this build does not port** — `'kizunaai'` (the pre-twin id) and the relay twins `kizunaai_openai_translate`, `kizunaai_volcengine_ast2` — selects the default managed provider on load when one is offered (Task 11); a fallback, never written back (1e-3 ruling 2).
14. **The auto-switch ignores a session restored at launch** (Task 12): the flip counts only once the sign-in has loaded signed out, then signs in. The old code's ref started from the pending `false` (`oldLayout:50`), so a signed-in Basic user on LocalInference was moved to Kizuna at every launch; ruling 4 restores the switch on a sign-in.
15. **The preview's two stand-ins** (Task 9): `AuthStandIn`, a context `useAuthContext()` reads first, carries `&signedin=1` to the Settings blocks the `&settings=` pages draw (roadmap `:1274`); and `setManagedVoiceStandIn(source)` replaces the managed voice source with one that lists nothing and calls nothing, set once at the preview's module scope. Neither is set in the app.
16. **`startLabel` names the `preparing` step** "Preparing your voice…" (Task 7), for any provider's `prepare` — so every Kizuna start shows it briefly, even one with no clone to claim (the old code set the phase only when a clone was claimed; survey §2.3). A stated departure.
17. **The ported claim routine answers codes, not keys** (Task 7): `voicePrepCode(reason)` replaces `voicePrepNotice`, and `resolveVoicePrepOutcome` returns `notice: { code, message }` — `voice_clip_missing`, `voice_pool_busy`, `voice_build_failed`, `voice_unavailable`, worded through their aliases (Task 8). The sentences name no vendor, so the codes need not (Plan A choice 9).
18. **The countdown reads `Date.now()`** (Task 10), as the footer's session clock does (`sessionClock.ts:16`): the app's run clock is the real one, so `endsAt` and `Date.now()` agree; tests inject `now`.
19. **The request and its roles live in their own module**, `leaseRequest.ts` (Task 5): `leaseRequest(shape, s, participantSpeech)`, `requestBody(request)` (the JSON body: today's four fields in today's order — `mode`, `textOnly`, `bothSplit`, `region`, as `ManagedSonioxSession.ts:707-711` sends them — then `PARTICIPANT_SPEECH_FIELD` only when the flag is on), `requestedRoles(request)` (the backend's expansion, `par_tts` added when the participant speaks) and `roleFor(request, leg)`. The floor (`kizunaBudget.ts`) and the lease (`lease.ts`) both read it, so the roles a floor prices are the roles a lease asks for, with no import cycle between them. The intent it serializes is `legs.includes('participant') && shape.participantSpeech`. `textOnly` keeps today's meaning — the speaker's speech (`true` for participant-only). In shared Both the participant's credentials carry `par_tts`'s own client reference with its key (its only socket is its TTS one); elsewhere a leg's reference is its STT stream's, as today.

## File Structure

| File | Task | Change |
|---|---|---|
| `src/lib/provider/types.ts`, `credentials.ts`, `managed.ts` (+ `managed.test.ts`), `src/lib/session/types.ts`, `src/lib/session/run.ts` (one line), `src/providers/fake/leased.test.ts` | 1 | `R`, `participantSpeech?`, `AuthContext.loaded?`; `managed()`; `AccountBalance`, `RunShape.account?`, `BalanceShape`, `Budget`, `LeaseContext`, `minimumBalance?`, `Resources.budget?`, `RunState.running.budget?` |
| `src/lib/session/{run,runner}.ts`, `runner.test.ts`, `runner.hooks.test.ts`, `src/providers/fake/{leased,settings}.ts`, `FakeLeasedSettingsView.tsx` (+ tests) | 2 | sources → lease → hand-over → adapters; one lease-end notice; the frame sink; the budget in the state; the leased fake's knobs |
| `src/stores/accountStore.ts` (+ test), `src/contexts/UserProfileContext.tsx` (+ `UserProfileContext.accountStore.test.tsx`), `src/lib/session/{shape,appShape}.ts` (+ tests), `src/lib/subtitle/appSession.ts` (+ test) | 3 | the account store; `balanceRefusal`; the live gate's floor |
| `src/lib/session/{shape,appShape}.ts` (+ tests), `src/components/Settings/sections/ParticipantSpeechSwitch.tsx` (+ test), 30 × `src/locales/<code>/translation.json` | 4 | the participant-speech flag's readers (`participantSpeechFromStores`); one key |
| `src/providers/soniox/{leaseRequest,kizunaBudget,lease}.ts` (+ tests) | 5 | the request and the roles it asks for (the participant-speech field behind the flag); the floors from the roles, and the caps; the lease's session key, keys (`par_tts` behind the flag), grant and release |
| `src/providers/soniox/lease.ts` (+ test), `src/providers/soniox/adapter.test.ts` | 6 | `SonioxLeasePort`: `session-started`, the grant's end, the cutoff |
| `src/providers/soniox/{managedVoicesClient,managedVoicePolling}.ts` (+ tests, moved), `src/services/clients/{ManagedVoicesClient,managedVoicePolling}.ts` (stubs), `src/providers/soniox/{voicePrep,voiceClaim,managedVoiceSource}.ts` (+ tests), `src/components/MainPanel/panel/startLabel.ts` (+ test) | 7 | the managed voice, claimed and listed |
| `src/providers/soniox/kizuna.ts` (+ `kizuna.test.ts`, `kizunaParticipantSpeech.test.tsx`), `src/providers/registry.ts` (+ test), `src/providers/localInference/provider.test.ts`, `src/lib/view/{noticeText,noticeTargets}.ts` (+ tests), `src/app/loadStores.test.ts` | 8 | the definition, built by its factory with the participant-speech flag off, registered first; its words; the flag-on / flag-off spec |
| `src/components/providers/{ManagedAccountRow.tsx,ProviderPicker.tsx,useAuthContext.ts}` (+ tests), `src/app/{useAppSession,session}.ts` (+ tests), `src/components/dev/SpinePreview.tsx` (+ test) | 9 | the account row, the pending sign-in, "Recommended", the preview's stand-ins |
| `src/components/MainPanel/SessionCountdown.tsx` (+ test), `panel/PanelFooter.tsx` (+ test), `src/components/TitleBar/{useBalanceShortfall.ts,AccountButton.tsx}` (+ tests), `src/lib/session/appShape.ts` (one export) | 10 | the countdown mounted; the dot through the gate |
| `src/components/SetupWizard/{providerPaths.ts,providerPaths.test.ts,providerPaths.managedFit.test.ts,SetupWizard.test.tsx}`, `src/lib/session/storedSettings.ts` (+ test), `src/app/loadStores.ts` (+ test) | 11 | the wizard's managed path; the stored-selection fallback |
| `src/components/MainLayout/{useSignInProviderSwitch.ts,MainLayout.tsx}` (+ the hook's test, three `MainLayout.*.test.tsx`) | 12 | the sign-in auto-switch |
| the spec, the roadmap | 13 | the controller's amendments and record |

**Order and parallelism.**
- **Wave 1:** Task 1 — every later task reads its types.
- **Wave 2:** Task 2 (runner, leased fake), Task 4 (the participant-speech flag's readers), Task 5 (lease I), Task 7 (voice). Disjoint files: Task 4 edits `shape.ts`, `appShape.ts`, their tests, the switch and the catalogs; Task 2 the runner and the leased fake; Task 5 and Task 7 only their own new files (and Task 7 `startLabel.ts`).
- **Wave 3:** Task 3 (needs Task 2: the leased fake's floor knob, for its store-level tests; and Task 4: `participantSpeechFromStores` and the edited `shape.ts` / `appShape.ts`), Task 6 (needs Task 5: `lease.ts`). Disjoint files.
- **Group check A** (controller) after Wave 3: the runner, the gate, the flag's readers, the lease and the voice are in; nothing is registered.
- **Wave 4:** Task 8 (needs Tasks 4, 5, 6, 7: its end-to-end spec renders the switch and runs the lease into the adapter). Alone.
- **Wave 5:** Task 9, Task 10, Task 11, Task 12 (all need Task 8's registration). Disjoint files: Task 9 edits `src/app/{session,useAppSession}.ts`, Task 10 `appShape.ts` (one export), Task 11 `src/app/loadStores.ts`.
- **Group check B** (controller) after Wave 5.
- **Task 13** (controller) last.

---

### Task 1: Types, the read type, and `managed()` (rulings 2, 10; choices 1, 2, 10)

**Files:**
- Modify: `src/lib/provider/types.ts`, `src/lib/provider/credentials.ts`, `src/lib/session/types.ts`, `src/providers/fake/leased.test.ts`, `src/lib/session/run.ts` (one line: the `frame` sink, Step 4).
- Create: `src/lib/provider/managed.ts`, `src/lib/provider/managed.test.ts`.

**Interfaces:**
- **Produces** (`src/lib/provider/types.ts`):
  - `AuthContext.loaded?: boolean` — false while the sign-in is still loading; absent where no sign-in is wired (tests, the root's default), read as loaded.
  - `interface Provider<S, K extends { missing?: never } & object, C extends { refused?: never } & object, R extends { missing?: never } & object = K>`; `credentials.read(values, auth): R | CredentialsMissing`; `check(r: R, s: S, ctx: CheckContext): Promise<CheckResult>`; `participantSpeech?: boolean`.
  - `type AnyProvider = Provider<any, any, any, any>`.
- **Produces** (`src/lib/provider/credentials.ts`): `readCredentials<S, R extends { missing?: never } & object>(p: Pick<Provider<S, never, never, R>, 'credentials'>, s: S, saved: CredentialValues, auth: AuthContext): R | CredentialsMissing`.
- **Produces** (`src/lib/session/types.ts`):
  - `interface AccountBalance { balanceMicroUsd: number; frozen: boolean }`; `RunShape.account?: AccountBalance | null`;
  - `type BalanceShape = Pick<RunShape, 'legs' | 'textOnly' | 'participantSpeech'>`;
  - `interface Budget { totalMs: number; endsAt: number }`; `Resources<K>.budget?: Budget`;
  - `interface LeaseContext { signal: AbortSignal; clock: Clock; end(notice: RunNotice): void; frame(frame: AdapterFrame): void }`; `SessionHooks.acquire?(shape: RunShape, s: S, ctx: LeaseContext): Promise<Resources<K>>`;
  - `SessionHooks.minimumBalance?(shape: BalanceShape, s: S): number`;
  - `RunState`'s running member gains `budget?: Budget`.
- **Produces** (`src/lib/provider/managed.ts`): `interface ManagedSignIn { readonly signedIn: true }`; `readSignIn(auth: AuthContext, signedOut: string): ManagedSignIn | CredentialsMissing`; `interface ManagedOverrides<S, K, C, Id extends string>`; `managed<S, K, C, Id extends string>(base: Provider<S, K, C>, o: ManagedOverrides<S, K, C, Id>): Provider<S, K, C, ManagedSignIn> & { id: Id }`.
- **Consumed by:** Task 2 (`LeaseContext`, `Budget`, `RunState`), Task 3 (`AccountBalance`, `RunShape.account`, `BalanceShape`, `minimumBalance`), Task 4 (`participantSpeech`), Tasks 5–6 (`LeaseContext`, `Resources`), Task 8 (`managed`), Task 9 (`AuthContext.loaded`, `sign_in_pending`), Task 10 (`Budget`).

- [ ] **Step 1: Write the failing tests** — `src/lib/provider/managed.test.ts`:

  ```ts
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { FlaskConical } from 'lucide-react';
  import type { ComponentType } from 'react';
  import type { AdapterEvents, StartRequest } from '../contract/adapter';
  import { fakeProvider } from '../../providers/fake/provider';
  import { FAKE_DEFAULTS, type FakeSettings } from '../../providers/fake/settings';
  import type { FakeConfig, FakeCredentials } from '../../providers/fake/adapter';
  import type { SessionHooks } from '../session/types';
  import { managed, readSignIn, type ManagedOverrides } from './managed';
  import type { AnyProvider, AuthContext, CredentialsMissing, Provider, SettingsProps } from './types';

  /** What a provider's `read` answers, `missing` aside. */
  type ReadOf<P extends AnyProvider> = Exclude<ReturnType<P['credentials']['read']>, CredentialsMissing>;

  const TwinSettings: ComponentType<SettingsProps<FakeSettings>> = () => null;
  const acquire: NonNullable<SessionHooks<FakeSettings, FakeCredentials, FakeConfig>['acquire']> = async () => ({ credentials: () => ({}), release: async () => {} });
  const OVERRIDES: ManagedOverrides<FakeSettings, FakeCredentials, FakeConfig, 'twin'> = {
    id: 'twin', vendor: 'Vendor', icon: FlaskConical, settingsKey: 'twinSlice', Settings: TwinSettings,
    signedOut: 'Sign in to use the twin.', session: { acquire },
  };
  const signedOut: AuthContext = { signedIn: false, getToken: async () => null };
  const signedIn: AuthContext = { signedIn: true, userId: 'u1', getToken: async () => 't' };

  afterEach(() => vi.unstubAllGlobals());

  describe('readSignIn', () => {
    it('answers the sign-in: pending while it loads, missing signed out, the sign-in once signed in', () => {
      expect(readSignIn({ ...signedIn, loaded: false }, 'x')).toEqual({ missing: 'The sign-in is still loading.', code: 'sign_in_pending' });
      expect(readSignIn(signedOut, 'Sign in first.')).toEqual({ missing: 'Sign in first.', code: 'sign_in_required' });
      expect(readSignIn(signedIn, 'x')).toEqual({ signedIn: true });
      // `loaded` absent reads as loaded.
      expect(readSignIn({ ...signedIn, loaded: true }, 'x')).toEqual({ signedIn: true });
    });
  });

  describe('managed', () => {
    it("is its own provider over the base's languages, capabilities, builder and adapter", () => {
      const twin = managed(fakeProvider, OVERRIDES);
      expect(twin).toMatchObject({ id: 'twin', kind: 'managed', vendor: 'Vendor', icon: FlaskConical, platforms: fakeProvider.platforms, Settings: TwinSettings });
      expect(twin.settings).toEqual({ key: 'twinSlice', defaults: fakeProvider.settings.defaults, migrate: fakeProvider.settings.migrate });
      for (const member of ['languages', 'speech', 'textInput', 'boundaries', 'turns', 'build', 'describe', 'start'] as const) {
        expect(twin[member], member).toBe(fakeProvider[member]);
      }
    });

    it('has no credential field, reads the sign-in, and checks nothing: a static answer that calls no one', async () => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      const twin = managed(fakeProvider, OVERRIDES);
      expect(twin.credentials.keys).toEqual([]);
      expect(twin.credentials.fields(FAKE_DEFAULTS)).toEqual([]);
      expect(twin.credentials.read({}, signedOut)).toEqual({ missing: 'Sign in to use the twin.', code: 'sign_in_required' });
      expect(twin.credentials.read({}, signedIn)).toEqual({ signedIn: true });
      await expect(twin.check({ signedIn: true }, FAKE_DEFAULTS, { pair: { source: 'en', target: 'ja' }, legs: ['speaker'] })).resolves.toEqual({ ok: true });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("adds its lease and hooks to the base's own, the base's startBoth kept", () => {
      const startBoth = vi.fn();
      const base = { ...fakeProvider, session: { startBoth } } as Provider<FakeSettings, FakeCredentials, FakeConfig>;
      const prepare = vi.fn();
      const minimumBalance = () => 100;
      const twin = managed(base, { ...OVERRIDES, session: { acquire, prepare, minimumBalance } });
      expect(twin.session).toEqual({ startBoth, acquire, prepare, minimumBalance });
    });

    it("leaves the base's guide, locale key and presence knobs behind", () => {
      const base = { ...fakeProvider, guideUrl: 'https://example.com/guide', i18nKey: 'fakeKey', flagged: true as const, testerSwitch: 'debug:fake' };
      const twin = managed(base, OVERRIDES);
      for (const member of ['guideUrl', 'i18nKey', 'flagged', 'testerSwitch'] as const) expect(twin, member).not.toHaveProperty(member);
    });

    it("takes no settings member or hook of the base it does not name: they are spelled out, not spread", () => {
      const admit = vi.fn();
      const basePrepare = vi.fn();
      const base = {
        ...fakeProvider,
        settings: { ...fakeProvider.settings, legacyKeys: ['oldKey'] },
        session: { admit, prepare: basePrepare },
      } as unknown as Provider<FakeSettings, FakeCredentials, FakeConfig>;
      const twin = managed(base, OVERRIDES);
      expect(twin.settings).not.toHaveProperty('legacyKeys');
      expect(twin.session).toEqual({ acquire });
    });

    it('carries the participant-speech flag as given, and nothing when none is', () => {
      expect(managed(fakeProvider, OVERRIDES)).not.toHaveProperty('participantSpeech');
      expect(managed(fakeProvider, { ...OVERRIDES, participantSpeech: false }).participantSpeech).toBe(false);
      expect(managed(fakeProvider, { ...OVERRIDES, participantSpeech: true }).participantSpeech).toBe(true);
    });

    // Compile-time (choice 1): the typecheck gate enforces every `@ts-expect-error` here.
    it('types what read answers as R — the sign-in, never a key its lease mints', () => {
      const twin = managed(fakeProvider, OVERRIDES);
      const signIn: ReadOf<typeof twin> = { signedIn: true };
      // @ts-expect-error a managed read answers no key: `R` is the sign-in
      const key: ReadOf<typeof twin> = { apiKey: 'k' };
      // An own-key provider's `R` is its `K`, as before.
      const own: ReadOf<typeof fakeProvider> = {};
      // @ts-expect-error an own-key read answers its K, not the sign-in
      const notOwn: ReadOf<typeof fakeProvider> = { signedIn: true };
      // `check` takes what `read` answers; `start` still takes the lease's K.
      const request = {} as StartRequest<FakeConfig, FakeCredentials>;
      void twin.start(request, {} as AdapterEvents).catch(() => {});
      // @ts-expect-error a start never receives the sign-in
      void twin.start({ ...request, credentials: signIn }, {} as AdapterEvents).catch(() => {});
      // @ts-expect-error a twin must mint its keys: acquire is required
      managed(fakeProvider, { ...OVERRIDES, session: {} });
      expect([signIn, key, own, notOwn]).toHaveLength(4);
    });
  });
  ```

  - `leased.test.ts`: the four hand-built acquire contexts gain the frame sink — `{ signal: live(), clock: counting, end: vi.fn() }` (`:99`) becomes `{ signal: live(), clock: counting, end: vi.fn(), frame: vi.fn() }`, and likewise `:111` (`{ signal: live(), clock, end, frame: vi.fn() }`), `:119` (`{ signal: live(), clock, end: released, frame: vi.fn() }`), `:128` (`{ signal: controller.signal, clock: createVirtualClock(0), end: vi.fn(), frame: vi.fn() }`). Nothing else in the file changes here.

- [ ] **Step 2: Run** `npx vitest run src/lib/provider` — FAIL: no `./managed` module.

- [ ] **Step 3: Implement.**
  - `src/lib/provider/types.ts`:
    - `AuthContext` gains, after `userId`:

      ```ts
      /**
       * False while the sign-in is still loading at launch: a managed
       * provider's `read` then answers `sign_in_pending`, not "sign in" (Stage 2
       * Kizuna Soniox, choice 10). Absent where no sign-in is wired — tests, the
       * root's default — and read as loaded.
       */
      loaded?: boolean;
      ```

    - The interface line becomes `export interface Provider<S, K extends { missing?: never } & object, C extends { refused?: never } & object, R extends { missing?: never } & object = K> {`, and its doc comment above gains: "`R` is what `credentials.read` answers and `check` takes; it is `K` unless the provider mints `K` in `session.acquire` — a managed twin's `R` is the sign-in (`managed.ts`), its `K` the lease's per-leg keys (Stage 2 Kizuna Soniox, choice 1)."
    - `credentials.read(values: CredentialValues, auth: AuthContext): R | CredentialsMissing;` (its comment: "`R` has no `missing` member — the type parameter's constraint enforces it.") and `check(r: R, s: S, ctx: CheckContext): Promise<CheckResult>;`.
    - After `turns(s: S): …`, in "the only capabilities generic code reads":

      ```ts
      /**
       * Whether the participant leg may speak. `false`: never, whatever its
       * switch says — Kizuna Soniox ships so until the backend mints a
       * participant speech key (Stage 2 Kizuna Soniox, ruling 2); the switch
       * then shows off and disabled with a "not available yet" tooltip,
       * keeping the stored choice. Absent or `true`: the participant speaks
       * when its switch is on.
       */
      participantSpeech?: boolean;
      ```

    - `export type AnyProvider = Provider<any, any, any, any>;`
  - `src/lib/provider/credentials.ts`: the signature becomes `export function readCredentials<S, R extends { missing?: never } & object>(p: Pick<Provider<S, never, never, R>, 'credentials'>, s: S, saved: CredentialValues, auth: AuthContext): R | CredentialsMissing {`; the body is unchanged.
  - `src/lib/session/types.ts`:
    - the contract import becomes `import type { AdapterEvents, AdapterFrame, AdapterSession, StartRequest } from '../contract/adapter';`;
    - before `RunShape`:

      ```ts
      /** The signed-in account's wallet as last fetched (Stage 2 Kizuna Soniox, choice 8). */
      export interface AccountBalance {
        /** Micro-USD; negative after a post-paid overrun. */
        balanceMicroUsd: number;
        frozen: boolean;
      }
      ```

    - `RunShape` gains, after `auth`:

      ```ts
      /** The account's wallet at start, for a managed provider's floor; null or absent while unknown, and then nothing is gated on it (ruling 5). */
      account?: AccountBalance | null;
      ```

    - after `Prepared`:

      ```ts
      /** What a managed provider's start floor depends on: the legs, whether the speaker speaks, and whether the participant would. */
      export type BalanceShape = Pick<RunShape, 'legs' | 'textOnly' | 'participantSpeech'>;

      /** A lease's granted time: the countdown's whole, and when it ends on the run's clock. */
      export interface Budget {
        totalMs: number;
        endsAt: number;
      }
      ```

    - `Resources<K>` gains `/** The granted time, when the lease has one: the running state carries it to the countdown. */ budget?: Budget;` between `credentials` and `release`;
    - before `SessionHooks`:

      ```ts
      /** What a lease hears from its run (spec: "Session hooks on the provider definition"). */
      export interface LeaseContext {
        signal: AbortSignal;
        /** The run's clock: a lease's timers read it. */
        clock: Clock;
        /** Ends the run with a notice — the grant used up, the longest segment reached: the code says which. */
        end(notice: RunNotice): void;
        /** The lease's wire traffic (`session.*`), for the Logs: the runner files it under the first leg. */
        frame(frame: AdapterFrame): void;
      }
      ```

    - `SessionHooks`: `acquire?(shape: RunShape, s: S, ctx: LeaseContext): Promise<Resources<K>>;` (its comment kept), and after `startBoth`:

      ```ts
      /** A managed provider's start floor in µUSD for these legs (spec: "`minimumBalance`"): the start gate refuses a known balance below it. */
      minimumBalance?(shape: BalanceShape, s: S): number;
      ```

    - `RunState`'s running member: `| { phase: 'running'; since: number; legs: Partial<Record<LegName, LegState>>; budget?: Budget }`.
  - `src/lib/provider/managed.ts`, in full:

    ```ts
    /**
     * A Kizuna twin (spec: "Managed twins are composition"): the base's
     * languages, capabilities, builder and adapter under its own id, kind,
     * vendor, icon and storage key; credentials read from the sign-in with no
     * field; a static `check`; and the lease that mints its per-leg keys.
     * What it takes from the base is named member by member (Stage 2 Kizuna
     * Soniox, choice 2): a member added to the base later is a decision here.
     */
    import type { ComponentType } from 'react';
    import type { SessionHooks } from '../session/types';
    import type { AuthContext, CredentialsMissing, Provider, SettingsProps } from './types';

    /** What a managed `read` answers (the read type `R`, choice 1): the sign-in, never a key — the lease mints those. */
    export interface ManagedSignIn {
      readonly signedIn: true;
    }

    /** The sign-in, as a managed provider's `read` answers it: loading, signed out, or signed in. */
    export function readSignIn(auth: AuthContext, signedOut: string): ManagedSignIn | CredentialsMissing {
      if (auth.loaded === false) return { missing: 'The sign-in is still loading.', code: 'sign_in_pending' };
      return auth.signedIn ? { signedIn: true } : { missing: signedOut, code: 'sign_in_required' };
    }

    export interface ManagedOverrides<S, K, C, Id extends string> {
      id: Id;
      vendor: string;
      icon: ComponentType<{ size?: string | number }>;
      /** The twin's own storage prefix (its old slice key). */
      settingsKey: string;
      /** The base's settings component in its managed flavour. */
      Settings: ComponentType<SettingsProps<S>>;
      /** Diagnostic English for a signed-out `read`; the user reads `sign_in_required`'s words. */
      signedOut: string;
      /** The participant-speech flag (ruling 2); absent, the base's capability is not narrowed. */
      participantSpeech?: boolean;
      /** Added to the base's hooks. `acquire` is required: a twin's `R` is not its `K`. */
      session: SessionHooks<S, K, C> & Required<Pick<SessionHooks<S, K, C>, 'acquire'>>;
    }

    export function managed<S, K extends { missing?: never } & object, C extends { refused?: never } & object, Id extends string>(
      base: Provider<S, K, C>,
      o: ManagedOverrides<S, K, C, Id>,
    ): Provider<S, K, C, ManagedSignIn> & { id: Id } {
      return {
        id: o.id,
        kind: 'managed',
        platforms: base.platforms,
        icon: o.icon,
        vendor: o.vendor,
        // Member by member (choice 2): a settings member added to the base later (`legacyKeys`, say) is a decision here, not a leak.
        settings: { key: o.settingsKey, defaults: base.settings.defaults, ...(base.settings.migrate ? { migrate: base.settings.migrate } : {}) },
        Settings: o.Settings,
        ...(base.TurnDetection ? { TurnDetection: base.TurnDetection } : {}),
        credentials: { keys: [], fields: () => [], read: (_values, auth) => readSignIn(auth, o.signedOut) },
        // Static: the sign-in is `read`'s to see, the balance the start gate's (spec: "Readiness is one check").
        check: async () => ({ ok: true }),
        languages: base.languages,
        speech: base.speech,
        textInput: base.textInput,
        boundaries: base.boundaries,
        turns: base.turns,
        ...(o.participantSpeech === undefined ? {} : { participantSpeech: o.participantSpeech }),
        build: base.build,
        describe: base.describe,
        start: base.start,
        // The base's `startBoth` only: its other hooks (`prepare`, `admit`, `acquire`) are the base's own business, never the twin's.
        session: { ...(base.session?.startBoth ? { startBoth: base.session.startBoth } : {}), ...o.session },
      };
    }
    ```

- [ ] **Step 4: Run** `npx vitest run src/lib/provider src/providers src/lib/session`, then the full suite and the typecheck gate. What stays green and why:
  - every provider definition: `R` defaults to `K`, so `fakeProvider`, `fakeLeasedProvider`, `localInferenceProvider`, `sonioxProvider` and the `Provider<S, never, never>` picks (`presence.ts:22`, `languages.ts:12`, `shared.ts:19`, `settings.ts:117, 194`) type as before;
  - `run.ts` passes `acquire` an object without `frame` — **one compile error the gate shows in `src/lib/session/run.ts`**: this task adds `frame: (frame) => deps.frames?.frame(shape.legs[0], frame),` to that object literal (`run.ts:182-193`, after `end`) and nothing else there, so the tree compiles; Task 2 owns the rest of `run.ts`. Add `src/lib/session/run.ts` to this task's commit.
  - `leased.test.ts`'s four contexts now carry `frame`;
  - the registry's invariants read `read` through `AnyProvider`.
  - The gate prints the 18 baseline lines, and the four `@ts-expect-error` lines of `managed.test.ts` each suppress a real error (a TS2578 would show).

- [ ] **Step 5: Commit.**

  ```bash
  git add src/lib/provider/types.ts src/lib/provider/credentials.ts src/lib/provider/managed.ts src/lib/provider/managed.test.ts src/lib/session/types.ts src/lib/session/run.ts src/providers/fake/leased.test.ts
  ```

  ```bash
  git commit -q -F - -- src/lib/provider/types.ts src/lib/provider/credentials.ts src/lib/provider/managed.ts src/lib/provider/managed.test.ts src/lib/session/types.ts src/lib/session/run.ts src/providers/fake/leased.test.ts <<'EOF'
  feat(contract): a managed twin's read type, its lease's budget and frames

  A provider may read one type and start with another: a managed twin's
  read answers the sign-in, and its lease mints the per-leg keys. managed()
  composes a twin from its base. The session vocabulary gains the
  account's wallet, a start floor, a lease's budget in the running state,
  and a frame sink for the lease's wire traffic; the sign-in can say it is
  still loading, and a provider can say whether the participant may speak.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 2: The runner — sources before the lease, one lease-end notice, the budget in the state (rulings 7, 8, 9; choices 3, 4, 12)

**Files:**
- Modify: `src/lib/session/run.ts`, `src/lib/session/runner.ts`, `src/lib/session/runner.test.ts`, `src/lib/session/runner.hooks.test.ts`, `src/providers/fake/leased.ts`, `src/providers/fake/settings.ts`, `src/providers/fake/leased.test.ts`, `src/providers/fake/FakeLeasedSettingsView.tsx`, `src/providers/fake/FakeLeasedSettingsView.test.tsx`.

**Interfaces:**
- **Consumes:** Task 1's `LeaseContext`, `Budget`, `RunState.running.budget`, `Resources.budget`, `SessionHooks.minimumBalance`.
- **Produces:** `Run.budget: Budget | null`; the running state's `budget`; `FakeLeasedSettings.acquireRefused: boolean` and `.minimumBalanceMicroUsd: number`; `fakeLeasedProvider.session.minimumBalance`.
- **Consumed by:** Task 3 (the leased fake's floor, in its store-level tests); Task 10 (the countdown reads the running state's `budget`); the group checks (the leased fake in the preview).

- [ ] **Step 1: Write the failing tests.**
  - `runner.hooks.test.ts`: `setup` gains a fifth parameter `frames?: FramePort` (import the type from `./ports`), passed to `createRunner` as `frames`. New imports: `AdapterStartError` is already imported; add `import type { FramePort } from './ports';`. A new describe:

    ```ts
    describe('runner — a lease after the sources (Stage 2 Kizuna Soniox, rulings 7, 8, 9)', () => {
      const lease = () => ({ credentials: () => ({}), release: async () => {} });

      it('opens every source, then acquires the lease, then starts the adapters', async () => {
        const order: string[] = [];
        const clock = createVirtualClock(0);
        const provider = withHooks(
          { acquire: async () => { order.push('acquire'); return lease(); } },
          {
            async start(request: StartRequest<unknown, unknown>, events: AdapterEvents) {
              order.push('start');
              return fakeProvider.start(request as StartRequest<never, never>, events);
            },
          },
        );
        const { runner } = setup(provider, ['speaker', 'participant'], (leg) => { order.push(`source ${leg}`); return createFakeSource(clock); });
        await runner.start();
        expect(runner.state.getState().phase).toBe('running');
        expect(order).toEqual(['source speaker', 'source participant', 'acquire', 'start', 'start']);
      });

      it('a source that fails mints no lease: the start fails naming its leg', async () => {
        const acquire = vi.fn(async () => lease());
        const { runner } = setup(withHooks({ acquire }), ['speaker', 'participant'], (leg) => {
          if (leg === 'participant') throw new Error('LOOPBACK_DENIED');
          return createFakeSource(createVirtualClock(0));
        });
        await runner.start();
        expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'start_failed', leg: 'participant' } } });
        expect(acquire).not.toHaveBeenCalled();
      });

      it('a refused lease fails the start with its code, starts no adapter, and leaves the last conversation on screen', async () => {
        let refuse = false;
        const start = vi.fn((request: StartRequest<unknown, unknown>, events: AdapterEvents) => fakeProvider.start(request as StartRequest<never, never>, events));
        const provider = withHooks(
          { acquire: async () => { if (refuse) throw new AdapterStartError('no balance', 'insufficient_balance'); return lease(); } },
          { start },
        );
        const track = vi.fn();
        const { runner, clock } = setup(provider, ['speaker'], undefined, track);
        await runner.start();
        clock.advance(600);
        await runner.stop();
        const before = runner.conversation.snapshot();
        expect(before[0].segments.length).toBeGreaterThan(0);

        refuse = true;
        start.mockClear();
        track.mockClear();
        await runner.start();
        expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'insufficient_balance', message: 'no balance' } } });
        expect(start).not.toHaveBeenCalled();
        expect(runner.conversation.snapshot()).toEqual(before);
        // Ruling 8: a refused start reaches error_occurred, and no api_error.
        const events = track.mock.calls.map(([event]) => event);
        expect(events).toContain('error_occurred');
        expect(events).not.toContain('api_error');
      });

      it("files a lease's frames under the first leg", async () => {
        const frames: FramePort = { frame: vi.fn() };
        const frame = { direction: 'in' as const, type: 'session.lease_acquired', payload: { roles: ['mix_stt'] } };
        const provider = withHooks({ acquire: async (_shape, _s, ctx) => { ctx.frame(frame); return lease(); } });
        const { runner } = setup(provider, ['speaker', 'participant'], undefined, undefined, frames);
        await runner.start();
        expect(frames.frame).toHaveBeenCalledWith('speaker', frame);
      });

      it("puts a lease's budget in the running state, and keeps it through a leg's change", async () => {
        let events!: AdapterEvents;
        const provider = withHooks(
          { acquire: async () => ({ ...lease(), budget: { totalMs: 60_000, endsAt: 60_000 } }) },
          {
            async start(request: StartRequest<unknown, unknown>, e: AdapterEvents) {
              events = e;
              return fakeProvider.start(request as StartRequest<never, never>, e);
            },
          },
        );
        const { runner } = setup(provider);
        await runner.start();
        expect(runner.state.getState()).toMatchObject({ phase: 'running', budget: { totalMs: 60_000, endsAt: 60_000 } });
        events.reconnecting();
        expect(runner.state.getState()).toMatchObject({ legs: { speaker: 'reconnecting' }, budget: { totalMs: 60_000, endsAt: 60_000 } });
      });

      it('a run with no lease has no budget', async () => {
        const { runner } = setup(fakeProvider);
        await runner.start();
        expect(runner.state.getState()).not.toHaveProperty('budget');
      });

      it("records a lease's end once, on the first leg, when both legs run (ruling 7)", async () => {
        let endLease!: (notice: RunNotice) => void;
        const provider = withHooks({ acquire: async (_shape, _s, ctx) => { endLease = ctx.end; return lease(); } });
        const { runner } = setup(provider, ['speaker', 'participant']);
        await runner.start();
        endLease({ code: 'budget_exhausted', message: 'used up' });
        await flush();
        const [speaker, participant] = runner.conversation.snapshot();
        expect(speaker.notices).toEqual([expect.objectContaining({ severity: 'error', code: 'budget_exhausted' })]);
        expect(participant.notices).toEqual([]);
        expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'lease-ended', notice: { code: 'budget_exhausted' } } });
      });

      // Choice 3: only a lease or `startBoth` moves the hand-over after the
      // sources. These pin both sides of that line by the one thing it
      // changes a user can see — whether a failing source clears the screen.
      /** Runs both legs once and stops, then starts again with the participant's source failing; answers the conversation before and after. */
      async function failingRestart(provider: AnyProvider) {
        let failing = false;
        let runClock!: ReturnType<typeof createVirtualClock>;
        const { runner, clock } = setup(provider, ['speaker', 'participant'], (leg) => {
          if (failing && leg === 'participant') throw new Error('LOOPBACK_DENIED');
          return createFakeSource(runClock);
        });
        runClock = clock;
        await runner.start();
        clock.advance(600);
        await runner.stop();
        const before = runner.conversation.snapshot();
        expect(before[0].segments.length).toBeGreaterThan(0);
        failing = true;
        await runner.start();
        expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { leg: 'participant' } } });
        return { before, after: runner.conversation.snapshot() };
      }

      it.each([
        ['the fake (no hooks)', fakeProvider],
        ["an admit-only provider (LocalInference's hooks)", withHooks({ admit: () => true })],
      ])('%s hands its legs over before its sources, as before: a failing source replaces the last conversation', async (_name, provider) => {
        const { after } = await failingRestart(provider);
        expect(after[0].segments).toEqual([]);
      });

      it("a startBoth provider keeps the last conversation when a source fails (choice 3's stated departure)", async () => {
        const startBoth = vi.fn();
        const { before, after } = await failingRestart(withHooks({ startBoth }));
        expect(after).toEqual(before);
        expect(startBoth).not.toHaveBeenCalled();
      });
    });
    ```

  - `runner.test.ts`: the reorder falsifies one of its three lease cases. The case "a stop during acquire (a slow lease) cancels the start and still releases the lease" (`:1201-1225`) is rewritten for the new order:

    ```ts
    it('a stop during acquire (a slow lease) cancels the start, stops the source it opened, and still releases the lease', async () => {
      let land!: () => void;
      const gate = new Promise<void>((resolve) => { land = resolve; });
      let released = false;
      const provider = {
        ...fakeProvider,
        session: { acquire: () => gate.then(() => ({ credentials: () => ({}), release: async () => { released = true; } })) },
      } as unknown as AnyProvider;
      const { runner, sources, events } = setup({ shape: { provider } });
      const starting = runner.start();
      await flush();
      // The lease runs after `opening` began and the sources opened (Stage 2 Kizuna Soniox, ruling 9).
      expect(runner.state.getState()).toMatchObject({ phase: 'starting', step: 'opening' });
      expect(sources).toHaveLength(1);
      const stopping = runner.stop();
      land();
      await stopping;
      await starting;
      await flush();
      expect(runner.state.getState()).toEqual({ phase: 'idle', lastEnd: { reason: 'user' } });
      expect(sources[0].stopped).toBe(true);
      expect(events('translation_session_start')).toEqual([]);
      expect(released).toBe(true);
    });
    ```

    Its other two lease cases stay as they are: "a lease that ends the run from its abort listener does not end it twice" (`:554`) and "a leg still opening when Stop lands is closed before the lease is released…" (`:1130`) — the stack's order is unchanged (sources and sessions still unwind before the lease). (`sources` is the setup's `FakeSource[]`; `FakeSource.stopped` is `src/providers/fake/source.ts:13`.)

    The existing cases stay and stay green: "releases a lease that arrives after the start was cancelled" (the stop now lands after the source opened, while `acquire` waits: `close()` still waits for it, and the lease is released once it arrives), "gives each leg its own credentials…" (the lease still unwinds after both sessions), "ends the run when the lease ends it…" (one leg: one notice).
  - `leased.test.ts`, new cases in `describe('the leased fake')`:
    1. **"acquire refuses with insufficient_balance when asked (the parked coded refusal)"** — `session.acquire!(shapeFor(s({ acquireRefused: true })), s({ acquireRefused: true }), { signal: live(), clock: createVirtualClock(0), end: vi.fn(), frame: vi.fn() })` rejects with an `AdapterStartError` whose `code` is `'insufficient_balance'` and message `'The leased fake refused the lease (knob).'`.
    2. **"its lease carries a budget when it ends, and none when it never does"** — at clock 500, `leaseEndsAfterMs: 3000` → `lease.budget` is `{ totalMs: 3000, endsAt: 3500 }`; `leaseEndsAfterMs: 0` → `budget` is `undefined`.
    3. **"acquire says so in the Logs"** — `frame` was called once with `{ direction: 'in', type: 'lease.acquired', payload: { endsAfterMs: 3000 } }`.
    4. **"its floor is the knob for a text-only start, twice it when the speaker speaks"** — `session.minimumBalance!({ legs: ['speaker'], textOnly: true, participantSpeech: false }, s({ minimumBalanceMicroUsd: 1000 }))` is `1000`; `textOnly: false` → `2000`; `{ legs: ['participant'], textOnly: false, participantSpeech: false }` → `1000`; with the knob at 0 → `0`.
    5. **"runs both legs end to end through the runner: the lease's end is recorded once, on the speaker's leg"** — the end-to-end case's runner (`platform: 'electron'`), with `legs: ['speaker', 'participant']`, `s({ leaseEndsAfterMs: 3000, sharedBoth: true })`, `openSource: async () => createFakeSource(clock)`: `runner.start()` → running with `budget: { totalMs: 3000, endsAt: 3000 }`; `clock.advance(3000)`, `flush()` → idle, `lastEnd.reason` `'lease-ended'`, code `'budget_exhausted'`; the speaker leg's notices hold one `budget_exhausted`, the participant's none.
    6. **"a refused lease fails its start through the runner, with the words' code"** — the same runner, one leg, `s({ acquireRefused: true })` → idle, `lastEnd: { reason: 'start-failed', notice: { code: 'insufficient_balance' } }`.
  - `describe('migrateFakeLeasedSettings')`: `valid` gains `acquireRefused: true, minimumBalanceMicroUsd: 1234`; `bad` gains `['acquireRefused', 'yes']`, `['minimumBalanceMicroUsd', -5]`, `['minimumBalanceMicroUsd', 'x']`.
  - `FakeLeasedSettingsView.test.tsx`: the one case becomes "draws the fake's own controls and the hook knobs", also clicking `screen.getByRole('switch', { name: 'Acquire refuses (insufficient balance)' })` and changing `screen.getByLabelText('Minimum balance, text only (µUSD; speech doubles it)')` to `'18334'`, and `update.mock.calls` ends `[{ acquireRefused: true }], [{ minimumBalanceMicroUsd: 18334 }]`.
- [ ] **Step 2: Run** `npx vitest run src/lib/session/runner.hooks.test.ts src/lib/session/runner.test.ts src/providers/fake` — FAIL (the order is source–acquire–start only by accident today for one leg; with two legs acquire runs first; no budget in the state; two notices; no knobs).
- [ ] **Step 3: Implement.**
  - `run.ts`:
    - imports: add `Budget` to the `./types` type import;
    - a field after `models`: `/** The lease's granted time, once acquired; the running state carries it (the countdown). */ budget: Budget | null = null;`;
    - in `runOpen`, everything from `let credentialsFor = …` (`:180`) to the end of the method is replaced by:

      ```ts
      host.step('opening');
      const punctuate = this.punctuatorForRun();
      for (const leg of shape.legs) {
        this.conversations.set(leg, new Conversation({
          leg,
          session: this.id,
          languages: contexts[leg]!.direction,
          clock: deps.clock,
          punctuate,
          retention: retentionFor(deps.replayAudio?.get() ?? shape.keepReplayAudio),
          onDiagnostic: (d) => reportWarning('SessionRunner', `${leg}: ${d.message}`, { dedupeKey: `conversation:${d.code}` }),
        }));
      }
      if (prepared.notice) this.conversations.get(shape.legs[0])!.notice({ severity: 'warning', ...prepared.notice });

      const together = shape.legs.length === 2 && !!p.session?.startBoth;
      // Every leg's source before a lease is minted (Stage 2 Kizuna Soniox,
      // ruling 9): a source that fails after `acquire` would leave a lease no
      // stream ever started, which the backend's sweeps never reach — the next
      // Start 409-locked until its initial expiry (75 s, 195 s with `par_stt`).
      // Opened first, it fails before any key is minted. `startBoth` takes
      // both sources at once, so it opens them first too.
      const sources = p.session?.acquire || together ? await this.openSources() : null;

      let credentialsFor = (_leg: LegName): unknown => credentials;
      if (p.session?.acquire) {
        const resources = await p.session.acquire(shape, settings, {
          signal: this.signal,
          clock: deps.clock,
          // `close()` sets `ending` before it aborts; an abort listener that
          // reacts by calling this must not re-end a run already ending.
          end: (notice) => {
            if (this.ending) return;
            // One notice for the lease, on the first leg (Stage 2 Kizuna Soniox,
            // ruling 7): it covers every leg, and the same sentence twice in Both
            // says nothing more.
            this.conversations.get(shape.legs[0])?.notice({ severity: 'error', ...notice });
            host.end({ reason: 'lease-ended', notice });
          },
          // The lease's wire traffic (`session.*`), in the first leg's Logs — its
          // release's outcome too, while the run unwinds (choice 4).
          frame: (frame) => deps.frames?.frame(shape.legs[0], frame),
        });
        this.stack.defer('lease', () => resources.release());
        this.throwIfAborted();
        credentialsFor = (leg) => resources.credentials(leg);
        this.budget = resources.budget ?? null;
      }
      // The run's legs become the conversation once nothing before the adapters
      // can refuse the start: a refused lease leaves the last conversation on
      // screen (choice 3). A provider with neither a lease nor `startBoth` hands
      // them over before its legs open, as before.
      host.conversations(this.conversations, { provider: this.shape.provider.id, models: this.models });

      const requests = Object.fromEntries(shape.legs.map((leg) => [leg, {
        context: contexts[leg]!,
        config: configs[leg],
        credentials: credentialsFor(leg),
        clock: deps.clock,
        signal: this.signal,
        punctuate,
      }])) as Record<LegName, StartRequest<unknown, unknown>>;

      if (together) {
        // Built before the sources opened; a source with a track hands it to the adapter (WebRTC).
        shape.legs.forEach((leg, i) => {
          const track = sources![i].track;
          if (track) requests[leg] = { ...requests[leg], input: track };
        });
        const events = { speaker: this.eventsFor('speaker'), participant: this.eventsFor('participant') };
        let sessions: Record<LegName, AdapterSession>;
        try {
          sessions = await p.session!.startBoth!(requests, events);
        } catch (error) {
          // A provider that knows which leg failed says so; otherwise the start is the first leg's.
          if (error instanceof LegStartError) throw new LegOpenError(error.leg, error.cause);
          throw new LegOpenError(shape.legs[0], error);
        }
        for (const leg of shape.legs) this.stack.defer(`${leg} session`, () => sessions[leg].stop());
        this.throwIfAborted();
        shape.legs.forEach((leg, i) => this.connect(leg, sources![i], sessions[leg]));
      } else {
        await Promise.all(shape.legs.map((leg, i) => this.opened(this.openLeg(leg, requests[leg], sources?.[i]))));
      }
      this.throwIfAborted();
      this.liveSince = deps.clock.now();
      ```

      Where the old block created the conversations and called `host.conversations` right after `host.step('opening')`, the new one creates them there and hands them over after the lease, as shown: delete the old conversation loop, the old `host.conversations(…)` line and the old `prepared.notice` line (`:199-213`), and the old inline source opening of the `startBoth` branch (`:225-232`).
    - a new private method, before `openLeg`:

      ```ts
      /** Every leg's source, in parallel; one that fails names its leg (D22). */
      private openSources(): Promise<Source[]> {
        return Promise.all(this.shape.legs.map((leg) => this.opened((async () => {
          try {
            return await this.openSource(leg);
          } catch (error) {
            if (this.signal.aborted) throw error;
            throw new LegOpenError(leg, error);
          }
        })())));
      }
      ```

    - `openLeg` takes an already-opened source: `private async openLeg(leg: LegName, request: StartRequest<unknown, unknown>, opened?: Source): Promise<void>`, its first line `const source = opened ?? await this.openSource(leg);`; the rest unchanged.
    - `openSource`'s comment "The conversations already exist — `openSource` runs after `host.step('opening')`." stays true (they are created before any source opens).
  - `runner.ts`, in `start`, the running state: `set({ phase: 'running', since: run.liveSince!, legs: legs(run), ...(run.budget ? { budget: run.budget } : {}) });`. `hostFor`'s `legState` spreads the state it replaces, so a budget survives a leg's change.
  - `settings.ts` (the leased fake):
    - `FakeLeasedSettings` gains

      ```ts
      /** `acquire` refuses with `insufficient_balance`, as a lease the backend turns down (402). */
      acquireRefused: boolean;
      /** Its start floor in µUSD for a text-only start; twice it when the speaker speaks, as a lease's floor rises with speech (Stage 2 Kizuna Soniox, choice 12). 0: a zero floor — a frozen or negative wallet still refuses. */
      minimumBalanceMicroUsd: number;
      ```

    - `FAKE_LEASED_DEFAULTS` gains `acquireRefused: false, minimumBalanceMicroUsd: 0` (on its last line, after `sharedBoth: true`);
    - `migrateFakeLeasedSettings` gains `const floor = stored.minimumBalanceMicroUsd;` and, in the returned object, `acquireRefused: typeof stored.acquireRefused === 'boolean' ? stored.acquireRefused : FAKE_LEASED_DEFAULTS.acquireRefused,` and `minimumBalanceMicroUsd: typeof floor === 'number' && Number.isFinite(floor) && floor >= 0 ? floor : FAKE_LEASED_DEFAULTS.minimumBalanceMicroUsd,`.
  - `leased.ts`:
    - the contract import becomes `import { AdapterStartError, LegStartError } from '../../lib/contract/adapter';`;
    - the header's hook list says "`acquire` (a lease: a key per leg, a budget and an end on the run's clock, a refusal on a knob) … and `minimumBalance` (a start floor on a knob)";
    - `acquire` becomes

      ```ts
      async acquire(_shape, s, { signal, clock, end, frame }) {
        if (signal.aborted) throw signal.reason ?? new Error('aborted');
        if (s.acquireRefused) throw new AdapterStartError('The leased fake refused the lease (knob).', 'insufficient_balance');
        const cancel = s.leaseEndsAfterMs > 0
          ? clock.setTimeout(() => end({ code: 'budget_exhausted', message: 'Lease ended by the leased fake (knob).' }), s.leaseEndsAfterMs)
          : () => {};
        frame({ direction: 'in', type: 'lease.acquired', payload: { endsAfterMs: s.leaseEndsAfterMs } });
        let released = false;
        return {
          credentials: (leg) => ({ leg }),
          ...(s.leaseEndsAfterMs > 0 ? { budget: { totalMs: s.leaseEndsAfterMs, endsAt: clock.now() + s.leaseEndsAfterMs } } : {}),
          async release() {
            if (released) return;
            released = true;
            cancel();
          },
        };
      },
      ```

    - after `startBoth: startBothLeased,`: `minimumBalance: (shape, s) => (shape.legs.includes('speaker') && !shape.textOnly ? 2 : 1) * s.minimumBalanceMicroUsd,`.
  - `FakeLeasedSettingsView.tsx`, two knobs after the lease-ends input:

    ```tsx
    <div className="setting-item">
      <ToggleSwitch
        checked={settings.acquireRefused}
        onChange={() => update({ acquireRefused: !settings.acquireRefused })}
        label="Acquire refuses (insufficient balance)"
        disabled={disabled}
      />
    </div>
    <div className="setting-item">
      <label className="setting-label" htmlFor="fake-min-balance"><span>Minimum balance, text only (µUSD; speech doubles it)</span></label>
      {/* `toMs` parses any non-negative integer, µUSD as well as ms. */}
      <input
        id="fake-min-balance"
        className="settings-input"
        type="number"
        min={0}
        step={1000}
        value={settings.minimumBalanceMicroUsd}
        onChange={(e) => update({ minimumBalanceMicroUsd: toMs(e.target.value) })}
        disabled={disabled}
      />
    </div>
    ```

    and the doc comment says "the knobs of its session hooks".
- [ ] **Step 4: Run** `npx vitest run src/lib/session src/providers src/app src/components/dev`, then the full suite and the gate. What else the reorder reaches, and why it stays green:
  - `runner.test.ts` carries three lease cases: `:554` and `:1130` stay green (the stack order is unchanged), and `:1201` is rewritten in Step 1. Its other cases, `runner.turns.test.ts`, `spine.e2e.test.ts`, and LocalInference's and Soniox's runner-level tests have no lease and (but for own-key Soniox's `startBoth`) no `startBoth`, so their path is the old one — the failing-restart cases above pin that; Soniox's `startBoth` tests call the adapter directly, not through `Run`;
  - `app/session.test.ts` and `SpinePreview.test.tsx` run the fake; `useAppSession.test.tsx` runs the fake;
  - the registry invariant "migrate turns the defaults, stored as they are, into the defaults" covers the leased fake's two new knobs.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/lib/session/run.ts src/lib/session/runner.ts src/lib/session/runner.test.ts src/lib/session/runner.hooks.test.ts src/providers/fake/leased.ts src/providers/fake/settings.ts src/providers/fake/leased.test.ts src/providers/fake/FakeLeasedSettingsView.tsx src/providers/fake/FakeLeasedSettingsView.test.tsx
  ```

  ```bash
  git commit -q -F - -- src/lib/session/run.ts src/lib/session/runner.ts src/lib/session/runner.test.ts src/lib/session/runner.hooks.test.ts src/providers/fake/leased.ts src/providers/fake/settings.ts src/providers/fake/leased.test.ts src/providers/fake/FakeLeasedSettingsView.tsx src/providers/fake/FakeLeasedSettingsView.test.tsx <<'EOF'
  feat(session): sources before a lease, one lease-end notice, the budget in the running state

  A run opens every leg's source before it mints a lease, so a source
  that fails mints no key and cannot 409-lock the next Start behind a
  lease no stream started; and it hands its legs to the
  conversation only once the lease is held, so a refused lease leaves the
  last conversation on screen. A lease's end is recorded once, on the
  first leg; its frames reach the first leg's Logs; its budget rides the
  running state. The leased fake can refuse its lease, name a start floor,
  and carries its budget.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 3: The account's wallet and the start gate's floor (rulings 5, 6; choice 8)

**Files:**
- Create: `src/stores/accountStore.ts`, `src/stores/accountStore.test.ts`, `src/contexts/UserProfileContext.accountStore.test.tsx`.
- Modify: `src/contexts/UserProfileContext.tsx`, `src/lib/session/shape.ts`, `src/lib/session/shape.test.ts`, `src/lib/session/appShape.ts`, `src/lib/session/appShape.test.ts`, `src/lib/subtitle/appSession.ts`, `src/lib/subtitle/appSession.test.ts`.

**Interfaces:**
- **Consumes:** Task 1's `AccountBalance`, `RunShape.account`, `BalanceShape`, `SessionHooks.minimumBalance`; Task 2's `FakeLeasedSettings.minimumBalanceMicroUsd` (store-level tests only); Task 4's `participantSpeechFromStores(provider)` (`appShape.ts`).
- **Produces:** `useAccountStore` (`{ account: AccountBalance | null; setAccount(account: AccountBalance | null): void }`); `GateInput = Pick<RunShape, 'provider' | 'settings' | 'pair' | 'legs' | 'turnMode'> & Partial<Pick<RunShape, 'textOnly' | 'participantSpeech' | 'account'>>`; `BALANCE_BELOW_FLOOR = 'balance_below_floor'`; `balanceRefusal(input: Pick<GateInput, 'provider' | 'settings' | 'legs' | 'textOnly' | 'participantSpeech' | 'account'>): Refusal | null`; `readShapeFromStores` fills `account`; `liveGate` reads `textOnly` and `account`.
- **Consumed by:** Task 8 (`balance_below_floor`'s alias), Task 10 (`balanceRefusal`, `useAccountStore`), the runner (its gate at start reads the frozen shape's `account`).

- [ ] **Step 1: Write the failing tests.**
  - `accountStore.test.ts`: **"holds nothing until told, then the account, and nothing again"** — `useAccountStore.getState().account` is `null`; `setAccount({ balanceMicroUsd: 5, frozen: false })` → that object; `setAccount(null)` → `null`.
  - `UserProfileContext.accountStore.test.tsx` — the preamble of `UserProfileContext.signOut.test.tsx:8-64` copied as it is (its auth, environment, analytics and `useRun` mocks, `walletBody`, the `fetch` stub and `load()`), then:
    1. **"mirrors the fetched wallet into the account store, and clears it on sign-out"** — render `useUserProfile()` in the provider; `waitFor` → `useAccountStore.getState().account` equals `{ balanceMicroUsd: 12_340_000, frozen: false }`; `signedIn = false; userId = undefined; rerender()` → `waitFor` it is `null`.
    2. **"leaves it unknown when the fetch fails"** — `fetch` rejects (`vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }))`) → after the fetch settles (`waitFor(() => expect(result.current.error).not.toBeNull())`) the store's account is `null`.
    3. **"clears it when the provider unmounts"** — after case 1's first `waitFor`, `unmount()` → `null`.
    - `beforeEach` also resets `useAccountStore.setState({ account: null })`.
  - `shape.test.ts`, a new describe (import `balanceRefusal`, `BALANCE_BELOW_FLOOR` from `./shape`, the type `BalanceShape` from `./types` and `formatUsdFloor` from `../../utils/formatters`):

    ```ts
    describe('balanceRefusal and the gate (Stage 2 Kizuna Soniox, rulings 5, 6)', () => {
      // A floor that rises with each speaking leg, as a lease's does.
      const leased = { ...fakeProvider, session: { minimumBalance: (s: BalanceShape) => 100 + (s.textOnly ? 0 : 100) + (s.participantSpeech ? 100 : 0) } } as unknown as RunShape['provider'];
      const input = (patch: Partial<RunShape> = {}) => ({ provider: leased, settings: FAKE_DEFAULTS, legs: ['speaker'] as const, textOnly: false, participantSpeech: false, account: { balanceMicroUsd: 150, frozen: false }, ...patch });

      it('gates nothing on an unknown account, or for a provider with no floor', () => {
        expect(balanceRefusal(input({ account: null }))).toBeNull();
        expect(balanceRefusal(input({ account: undefined }))).toBeNull();
        expect(balanceRefusal(input({ provider: fakeProvider, account: { balanceMicroUsd: -1, frozen: true } }))).toBeNull();
      });

      it('refuses a frozen wallet before the floor', () => {
        expect(balanceRefusal(input({ account: { balanceMicroUsd: 10_000, frozen: true } }))).toEqual({ code: 'wallet_frozen', message: 'The wallet is frozen.' });
      });

      it('refuses a balance below the floor for these legs, with the balance floored in USD', () => {
        expect(balanceRefusal(input())).toEqual({
          code: BALANCE_BELOW_FLOOR,
          message: "The balance (150 µUSD) is below this start's floor (200 µUSD).",
          params: { balance: formatUsdFloor(150) },
        });
        expect(balanceRefusal(input({ textOnly: true }))).toBeNull();
        expect(balanceRefusal(input({ account: { balanceMicroUsd: 200, frozen: false } }))).toBeNull();
      });

      it('reads textOnly and participantSpeech as false when the input leaves them out', () => {
        expect(balanceRefusal({ ...input(), textOnly: undefined })?.code).toBe(BALANCE_BELOW_FLOOR);
        expect(balanceRefusal({ ...input({ textOnly: true }), participantSpeech: undefined })).toBeNull();
      });

      it("prices the participant's speech when the input says it speaks", () => {
        expect(balanceRefusal(input({ textOnly: true, participantSpeech: true }))?.code).toBe(BALANCE_BELOW_FLOOR);
        expect(balanceRefusal(input({ textOnly: true, participantSpeech: false }))).toBeNull();
      });

      it("is the gate's last refusal: the participant's comes first", () => {
        expect(gate(shape({ provider: leased, legs: ['participant'], pair: { source: AUTO, target: 'en' }, account: { balanceMicroUsd: 0, frozen: false } }), 'electron'))
          .toMatchObject({ code: 'participant_unsupported' });
        expect(gate(shape({ provider: leased, account: { balanceMicroUsd: 0, frozen: false } }), 'electron')).toMatchObject({ code: BALANCE_BELOW_FLOOR });
        expect(gate(shape({ provider: leased }), 'electron')).toBeNull();
      });
    });
    ```

  - `appShape.test.ts` (import `useAccountStore` and `FAKE_LEASED_DEFAULTS`; `beforeEach` adds `useAccountStore.setState({ account: null }); useSettingsStore.setState({ textOnly: false });`):
    1. **"freezes the account's wallet"** — `selected: 'fake'` with its entry; `useAccountStore.setState({ account: { balanceMicroUsd: 7, frozen: false } })` → `readShapeFromStores(auth)?.account` equals it; with `null` → `null`.
    2. **"refuses below the selected provider's floor, reading text only and the wallet from their stores"** (the participant's speech is read through `participantSpeechFromStores`, off in this setup) — `selected: 'fake_leased'`, entry `{ settings: { ...FAKE_LEASED_DEFAULTS, minimumBalanceMicroUsd: 1000 }, credentials: {}, pair: { source: 'en', target: 'ja' } }`, `useAudioStore.setState({ mode: 'speaker' })`, `environment.value = 'electron'`, account `{ balanceMicroUsd: 1500, frozen: false }` → `liveGate()?.code` is `'balance_below_floor'` (the speaker speaks: floor 2000); `useSettingsStore.setState({ textOnly: true })` → `null` (floor 1000); account `null` → `null`.
  - `appSession.test.ts` (imports `useAccountStore`, `useSettingsStore`, `FAKE_LEASED_DEFAULTS`; `afterEach` restores both stores' prior state as the file does for the others):
    - **"keeps Start off below the floor, and turns it on when the balance arrives or text only lowers the floor"** — `setup()`, then `useProviderStore.setState({ selected: 'fake_leased', entries: { fake_leased: { settings: { ...FAKE_LEASED_DEFAULTS, minimumBalanceMicroUsd: 1000 }, credentials: {}, pair: { source: 'en', target: 'ja' } } } })`, `useAudioStore.setState({ mode: 'speaker' })`, `useAccountStore.setState({ account: { balanceMicroUsd: 1500, frozen: false } })`; a listener `vi.fn()` subscribed → `session.get()` has `canStart: false` and `idle: { kind: 'unready', code: 'balance_below_floor' }`; `useSettingsStore.setState({ textOnly: true })` → the listener was called and `canStart` is `true`; `useAccountStore.setState({ account: { balanceMicroUsd: 500, frozen: false } })` → `canStart` is `false` again.
- [ ] **Step 2: Run** `npx vitest run src/stores/accountStore.test.ts src/contexts src/lib/session src/lib/subtitle` — FAIL.
- [ ] **Step 3: Implement.**
  - `src/stores/accountStore.ts`, in full:

    ```ts
    /**
     * The signed-in account's wallet as last fetched, for code outside React:
     * the start gate's balance floor (Stage 2 Kizuna Soniox, choice 8).
     * `UserProfileProvider` writes it from its quota. Null while unknown —
     * signed out, not fetched yet, a failed fetch — and then nothing is gated
     * on it: the backend's 402 is the authority (ruling 5).
     */
    import { create } from 'zustand';
    import type { AccountBalance } from '../lib/session/types';

    interface AccountStore {
      account: AccountBalance | null;
      setAccount(account: AccountBalance | null): void;
    }

    export const useAccountStore = create<AccountStore>()((set) => ({
      account: null,
      setAccount: (account) => set({ account }),
    }));
    ```

  - `UserProfileContext.tsx`: import `useAccountStore` from `'../stores/accountStore'`; after the polling effect (`:256-269`):

    ```ts
    // The start gate reads the wallet outside React (Stage 2 Kizuna Soniox):
    // mirrored as the quota changes, null whenever the quota is unknown.
    useEffect(() => {
      const balance = quota?.balance;
      useAccountStore.getState().setAccount(typeof balance === 'number' ? { balanceMicroUsd: balance, frozen: quota?.frozen === true } : null);
    }, [quota]);
    useEffect(() => () => useAccountStore.getState().setAccount(null), []);
    ```

  - `shape.ts`:
    - import `import { formatUsdFloor } from '../../utils/formatters';`;
    - `GateInput` and its comment become

      ```ts
      /** What the start gate reads (F7): a run's frozen shape satisfies it, and so do the stores as they stand. `textOnly`, `participantSpeech` and `account` feed a managed provider's balance floor (Stage 2 Kizuna Soniox); absent, nothing is gated on a balance. */
      export type GateInput = Pick<RunShape, 'provider' | 'settings' | 'pair' | 'legs' | 'turnMode'> & Partial<Pick<RunShape, 'textOnly' | 'participantSpeech' | 'account'>>;

      /** A start refused below a managed provider's floor: worded by the old gate's "Insufficient balance: {{balance}}" (ruling 6). */
      export const BALANCE_BELOW_FLOOR = 'balance_below_floor';

      /**
       * A managed provider's balance check over the account as last fetched
       * (Stage 2 Kizuna Soniox, rulings 5 and 6): a frozen wallet, or a balance
       * below the floor the provider names for this start (`minimumBalance`).
       * Nothing while the account is unknown — signed out, not fetched, a failed
       * fetch — or the provider names no floor: the backend's 402 is the
       * authority, and the lease words it.
       */
      export function balanceRefusal(input: Pick<GateInput, 'provider' | 'settings' | 'legs' | 'textOnly' | 'participantSpeech' | 'account'>): Refusal | null {
        const floorFor = input.provider.session?.minimumBalance;
        const account = input.account;
        if (!floorFor || !account) return null;
        if (account.frozen) return { code: 'wallet_frozen', message: 'The wallet is frozen.' };
        const floor = floorFor({ legs: input.legs, textOnly: input.textOnly ?? false, participantSpeech: input.participantSpeech ?? false }, input.settings);
        if (account.balanceMicroUsd >= floor) return null;
        return {
          code: BALANCE_BELOW_FLOOR,
          message: `The balance (${account.balanceMicroUsd} µUSD) is below this start's floor (${floor} µUSD).`,
          // Floored, as every balance is: this is the moment it is too low, the worst one to round up.
          params: { balance: formatUsdFloor(account.balanceMicroUsd) },
        };
      }
      ```

    - `gate`'s last line `return null;` becomes `return balanceRefusal(shape);`, and its doc comment adds "and, last, a managed provider's balance floor over the account as last fetched".
  - `appShape.ts`: import `useAccountStore` from `'../../stores/accountStore'`; `readShapeFromStores` adds `account: useAccountStore.getState().account,` after `auth`; `liveGate`'s input adds `textOnly: useSettingsStore.getState().textOnly,`, `participantSpeech: participantSpeechFromStores(selected.provider),` (Task 4's helper, the one `readShapeFromStores` uses, so the live floor and the run's floor price the same legs) and `account: useAccountStore.getState().account,`; its doc comment's list adds "a known balance below a managed provider's floor".
  - `appSession.ts`: import `useAccountStore`, `useSettingsStore` and `useRoutingStore`; `offs` gains `useAccountStore.subscribe(update)`, `useSettingsStore.subscribe((s) => s.textOnly, update)` (the settings store has `subscribeWithSelector`) and `useRoutingStore.subscribe(update)` (the participant-speech switch; a plain store, so it fires on every change of it, and `update` compares before it notifies); the header's store list adds "the account's wallet, the text-only switch and the participant-speech switch, for the balance floor".
- [ ] **Step 4: Run** `npx vitest run src/stores src/contexts src/lib src/app src/components`, then the full suite and the gate. What else this reaches, and why it stays green:
  - every existing `gate()` caller: the new fields are optional; a provider with no `minimumBalance` is never refused on a balance (Soniox's `provider.test.ts` case 4 calls `gate` without them);
  - `runner.test.ts` / `runner.hooks.test.ts` build shapes with no `account`: nothing is gated;
  - `appShape.test.ts`'s existing `readShapeFromStores` case uses `toMatchObject`, which ignores the new `account`;
  - the two existing `UserProfileContext.*.test.tsx` files: the new effects write a store no test of theirs reads.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/stores/accountStore.ts src/stores/accountStore.test.ts src/contexts/UserProfileContext.tsx src/contexts/UserProfileContext.accountStore.test.tsx src/lib/session/shape.ts src/lib/session/shape.test.ts src/lib/session/appShape.ts src/lib/session/appShape.test.ts src/lib/subtitle/appSession.ts src/lib/subtitle/appSession.test.ts
  ```

  ```bash
  git commit -q -F - -- src/stores/accountStore.ts src/stores/accountStore.test.ts src/contexts/UserProfileContext.tsx src/contexts/UserProfileContext.accountStore.test.tsx src/lib/session/shape.ts src/lib/session/shape.test.ts src/lib/session/appShape.ts src/lib/session/appShape.test.ts src/lib/subtitle/appSession.ts src/lib/subtitle/appSession.test.ts <<'EOF'
  feat(session): the start gate refuses below a managed provider's floor

  The account's wallet reaches code outside React through a small store,
  written from the quota and null while it is unknown. A run freezes it;
  the gate refuses a frozen wallet and a known balance below the floor the
  provider names for these legs, and gates nothing on an unknown balance.
  Start follows the wallet and the text-only switch as they change.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 4: The participant-speech flag's readers (ruling 2; choice 11)

**Files:**
- Modify: `src/lib/session/shape.ts`, `src/lib/session/shape.test.ts`, `src/lib/session/appShape.ts`, `src/lib/session/appShape.test.ts`, `src/components/Settings/sections/ParticipantSpeechSwitch.tsx`, `src/components/Settings/sections/ParticipantSpeechSwitch.test.tsx`, and the 30 `src/locales/<code>/translation.json`.

**Interfaces:**
- **Consumes:** Task 1's `Provider.participantSpeech?: boolean`; `getProvider` (`src/providers/registry.ts`).
- **Produces:** `participantSpeechFromStores(provider: Pick<AnyProvider, 'participantSpeech'>): boolean` (`appShape.ts`, exported); the key `audioPanel.participantSpeechNotYetAvailable`; `contextsFor`, `readShapeFromStores` and the switch honour `participantSpeech: false`.
- **Consumed by:** Task 3 (`participantSpeechFromStores` in the live gate), Task 8 (Kizuna Soniox's flag, and its end-to-end spec), Task 10 (`participantSpeechFromStores` in the account button's floor), Task 13 (the spot-check list).

- [ ] **Step 1: Write the failing tests.**
  - `shape.test.ts`, in `describe('contextsFor')`: **"gives the participant no speech while its provider's flag is off, whatever the opt-in; speech again once it is on"** — `contextsFor(shape({ provider: { ...fakeProvider, participantSpeech: false }, legs: ['speaker', 'participant'], participantSpeech: true })).participant?.speech` is `false` and the speaker's is still `true`; with `participantSpeech: true` on the provider it is `true`; with the provider's flag on and the shape's `participantSpeech: false` it is `false`.
  - `appShape.test.ts`, in "readShapeFromStores — participant speech follows the whole-system rule" (import `participantSpeechFromStores`):
    - **"is off while the provider's flag is off, and follows the switch once it is on"** — `environment.value = 'web'`; inside `try`, `Object.assign(fakeProvider, { participantSpeech: false })` → `readShapeFromStores(auth)?.participantSpeech` is `false` (the routing switch is on in this describe's `beforeEach`); `Object.assign(fakeProvider, { participantSpeech: true })` → `true`; in `finally`, `delete (fakeProvider as { participantSpeech?: boolean }).participantSpeech`.
    - **"participantSpeechFromStores is the shape's own answer"** — `participantSpeechFromStores({ participantSpeech: false })` is `false`; `participantSpeechFromStores({})` equals `readShapeFromStores(auth)?.participantSpeech` for the fake, with the switch on and then off (`useRoutingStore.setState({ participantSpeech: false })`).
  - `ParticipantSpeechSwitch.test.tsx`:
    - above the imports: `vi.mock('../../../providers/registry', () => ({ getProvider: (id: string) => (id === 'not-yet' ? { participantSpeech: false } : id === 'speaking' ? { participantSpeech: true } : {}) }));`; import `useProviderStore` from `'../../../stores/providerStore'`; `beforeEach` adds `useProviderStore.setState({ selected: null });`
    - **"shows it off and disabled while the provider's flag is off, keeping the stored value"** — `useRoutingStore.setState({ participantSpeech: true })`, `useProviderStore.setState({ selected: 'not-yet' })`; render → `aria-checked` `'false'`, `aria-disabled` `'true'`, `tooltipContents` contains `'audioPanel.participantSpeechNotYetAvailable'`, and the store still holds `true`.
    - **"names the provider before the whole-system rule"** — `electron.value = true`, a `desktop-audio-loopback` participant source, and the `not-yet` provider → the tooltip is `'audioPanel.participantSpeechNotYetAvailable'`, not the whole-system one.
    - **"a provider whose flag is on, or that has none, leaves the switch as before"** — for `selected: 'speaking'` and `selected: 'plain'`: checked follows the store, enabled, tooltip `'audioPanel.participantSpeechDesc'`.
- [ ] **Step 2: Run** `npx vitest run src/lib/session src/components/Settings/sections/ParticipantSpeechSwitch.test.tsx` — FAIL.
- [ ] **Step 3: Implement.**
  - `shape.ts`, `contextsFor`'s participant: `speech: p.participantSpeech === false ? false : speaks(shape.participantSpeech),` with the comment "While its provider's participant-speech flag is off (Kizuna Soniox until the backend mints a participant speech key, Stage 2 ruling 2) the participant stays text-only whatever the switch says."
  - `appShape.ts`: import the type `AnyProvider` (already imported); a new export above `readShapeFromStores`, and `readShapeFromStores`'s `participantSpeech` becomes `participantSpeech: participantSpeechFromStores(provider),` — the 1e-3b-2 comment moves onto the function:

    ```ts
    /**
     * Whether the participant leg would speak, as the stores stand: its
     * provider's flag on (Stage 2 Kizuna Soniox, ruling 2), its switch on,
     * and — 1e-3b-2 ruling 7, completed — its source not a whole-system
     * capture on Electron that would recapture it and translate it again as
     * Other: the same predicate `readRouting` and the switch itself use. The
     * run's shape, the live gate's floor and the account button's floor all
     * read it, so they price the same legs.
     */
    export function participantSpeechFromStores(provider: Pick<AnyProvider, 'participantSpeech'>): boolean {
      return provider.participantSpeech !== false
        && useRoutingStore.getState().participantSpeech
        && participantSpeechHeard(getEnvironment(), useAudioStore.getState().selectedParticipantSource?.deviceId);
    }
    ```

  - `ParticipantSpeechSwitch.tsx`: imports `useProviderStore` (`'../../../stores/providerStore'`) and `getProvider` (`'../../../providers/registry'`); the body becomes

    ```tsx
    const { t } = useTranslation();
    const participantSpeech = useRoutingStore((s) => s.participantSpeech);
    const selectedParticipantSource = useAudioStore((s) => s.selectedParticipantSource);
    const selected = useProviderStore((s) => s.selected);
    // The provider's participant-speech flag (ruling 2) — Kizuna Soniox's is off until the backend mints a participant speech key. Absolute, so named first.
    const offered = (selected ? getProvider(selected) : undefined)?.participantSpeech !== false;
    const heard = participantSpeechHeard(isElectron() ? 'electron' : 'other', selectedParticipantSource?.deviceId);
    return (
      <ToggleSwitch
        checked={participantSpeech && heard && offered}
        onChange={() => useRoutingStore.getState().setParticipantSpeech(!participantSpeech)}
        label={t('audioPanel.participantSpeech')}
        disabled={locked || !heard || !offered}
        tooltip={!offered ? t('audioPanel.participantSpeechNotYetAvailable') : heard ? t('audioPanel.participantSpeechDesc') : t('audioPanel.participantSpeechBlockedWholeSystem')}
      />
    );
    ```

    and its doc comment gains a paragraph: "A provider whose participant-speech flag is off (the definition's `participantSpeech: false`, Stage 2 Kizuna Soniox ruling 2) shows the switch off and disabled too, with a "not available yet" tooltip, keeping the stored choice — the run's shape (`appShape.ts`) and the leg's context (`shape.ts`) read the same flag."
  - **The key** (ruling 2). In each of the 30 catalogs, insert one line right after the `"participantSpeechBlockedWholeSystem"` line of `audioPanel` (never the last key there: `"audioCaptureUnprovenNotice"` follows) — insert the line; never re-serialize a file. `en`: `"participantSpeechNotYetAvailable": "Not available yet with this provider: Other's translation is shown as text only.",`. The other 29, each saying "not yet" and using its catalog's own word for "Other" and "provider" (`audioPanel.participantSpeech`, `notices.turn_mode_unsupported`):

    | Locale | Value |
    |---|---|
    | `ar` | `غير متاح بعد مع هذا المزود: تُعرض ترجمة الآخر كنص فقط.` |
    | `bn` | `এই প্রদানকারীর সাথে এখনও উপলব্ধ নয়: অন্যের অনুবাদ শুধু লেখা হিসেবে দেখানো হয়।` |
    | `de` | `Bei diesem Anbieter noch nicht verfügbar: Die Übersetzung des Gegenübers wird nur als Text angezeigt.` |
    | `es` | `Aún no disponible con este proveedor: la traducción del otro se muestra solo como texto.` |
    | `fa` | `هنوز با این ارائه‌دهنده در دسترس نیست: ترجمهٔ طرف مقابل فقط به صورت متن نمایش داده می‌شود.` |
    | `fi` | `Ei vielä käytettävissä tällä tarjoajalla: toisen käännös näytetään vain tekstinä.` |
    | `fil` | `Hindi pa available sa provider na ito: ipinapakita lang bilang teksto ang salin ng kausap.` |
    | `fr` | `Pas encore disponible avec ce fournisseur : la traduction de l'autre s'affiche uniquement en texte.` |
    | `he` | `עדיין לא זמין עם ספק זה: תרגום הצד השני מוצג כטקסט בלבד.` |
    | `hi` | `इस प्रदाता के साथ अभी उपलब्ध नहीं: दूसरे का अनुवाद केवल टेक्स्ट के रूप में दिखाया जाता है।` |
    | `id` | `Belum tersedia dengan penyedia ini: terjemahan lawan bicara hanya ditampilkan sebagai teks.` |
    | `it` | `Non ancora disponibile con questo fornitore: la traduzione dell'altro viene mostrata solo come testo.` |
    | `ja` | `このプロバイダーではまだ利用できません。相手の翻訳はテキストのみで表示されます。` |
    | `ko` | `이 제공자에서는 아직 사용할 수 없습니다. 상대방 번역은 텍스트로만 표시됩니다.` |
    | `ms` | `Belum tersedia dengan penyedia ini: terjemahan pihak lain dipaparkan sebagai teks sahaja.` |
    | `nl` | `Nog niet beschikbaar bij deze provider: de vertaling van de ander wordt alleen als tekst getoond.` |
    | `pl` | `Jeszcze niedostępne u tego dostawcy: tłumaczenie rozmówcy jest wyświetlane tylko jako tekst.` |
    | `pt_BR` | `Ainda indisponível com este provedor: a tradução do outro é exibida apenas como texto.` |
    | `pt_PT` | `Ainda indisponível com este fornecedor: a tradução do outro é apresentada apenas como texto.` |
    | `ru` | `Пока недоступно у этого поставщика: перевод собеседника показывается только текстом.` |
    | `sv` | `Inte tillgängligt än med den här leverantören: den andras översättning visas endast som text.` |
    | `ta` | `இந்த வழங்குநருடன் இன்னும் கிடைக்கவில்லை: மற்றவரின் மொழிபெயர்ப்பு உரையாக மட்டுமே காட்டப்படும்.` |
    | `te` | `ఈ ప్రదాతతో ఇంకా అందుబాటులో లేదు: ఇతరుల అనువాదం టెక్స్ట్‌గా మాత్రమే చూపబడుతుంది.` |
    | `th` | `ยังไม่พร้อมใช้งานกับผู้ให้บริการนี้ คำแปลของอีกฝ่ายจะแสดงเป็นข้อความเท่านั้น` |
    | `tr` | `Bu sağlayıcıda henüz kullanılamıyor: karşı tarafın çevirisi yalnızca metin olarak gösterilir.` |
    | `uk` | `Поки недоступно в цього постачальника: переклад співрозмовника показується лише текстом.` |
    | `vi` | `Chưa khả dụng với nhà cung cấp này: bản dịch của đối phương chỉ hiển thị dưới dạng văn bản.` |
    | `zh_CN` | `该提供商暂不支持：对方的译文仅以文字显示。` |
    | `zh_TW` | `此提供商暫不支援：對方的譯文僅以文字顯示。` |

    The implementer reports the 29 values as written, for the native-speaker spot check Task 13 records.
- [ ] **Step 4: Run** `npx vitest run src/lib/session src/components/Settings src/locales`, then the full suite and the gate. `locales.consistency.test.ts` holds every catalog to `en`'s keys, placeholders (none here) and no empty string. `readShapeFromStores`'s existing whole-system cases stay green: the fake has no flag, so `participantSpeechFromStores` answers as the inline predicate did. `SystemAudioSection.test.tsx`, `SimpleSettings*.test.tsx` and `AdvancedSettings.test.tsx` mock the section or the switch, so the switch's new registry import reaches only its own test, which mocks the registry.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/lib/session/shape.ts src/lib/session/shape.test.ts src/lib/session/appShape.ts src/lib/session/appShape.test.ts src/components/Settings/sections/ParticipantSpeechSwitch.tsx src/components/Settings/sections/ParticipantSpeechSwitch.test.tsx src/locales/ar/translation.json src/locales/bn/translation.json src/locales/de/translation.json src/locales/en/translation.json src/locales/es/translation.json src/locales/fa/translation.json src/locales/fi/translation.json src/locales/fil/translation.json src/locales/fr/translation.json src/locales/he/translation.json src/locales/hi/translation.json src/locales/id/translation.json src/locales/it/translation.json src/locales/ja/translation.json src/locales/ko/translation.json src/locales/ms/translation.json src/locales/nl/translation.json src/locales/pl/translation.json src/locales/pt_BR/translation.json src/locales/pt_PT/translation.json src/locales/ru/translation.json src/locales/sv/translation.json src/locales/ta/translation.json src/locales/te/translation.json src/locales/th/translation.json src/locales/tr/translation.json src/locales/uk/translation.json src/locales/vi/translation.json src/locales/zh_CN/translation.json src/locales/zh_TW/translation.json
  ```

  ```bash
  git commit -q -F - -- src/lib/session/shape.ts src/lib/session/shape.test.ts src/lib/session/appShape.ts src/lib/session/appShape.test.ts src/components/Settings/sections/ParticipantSpeechSwitch.tsx src/components/Settings/sections/ParticipantSpeechSwitch.test.tsx src/locales/ar/translation.json src/locales/bn/translation.json src/locales/de/translation.json src/locales/en/translation.json src/locales/es/translation.json src/locales/fa/translation.json src/locales/fi/translation.json src/locales/fil/translation.json src/locales/fr/translation.json src/locales/he/translation.json src/locales/hi/translation.json src/locales/id/translation.json src/locales/it/translation.json src/locales/ja/translation.json src/locales/ko/translation.json src/locales/ms/translation.json src/locales/nl/translation.json src/locales/pl/translation.json src/locales/pt_BR/translation.json src/locales/pt_PT/translation.json src/locales/ru/translation.json src/locales/sv/translation.json src/locales/ta/translation.json src/locales/te/translation.json src/locales/th/translation.json src/locales/tr/translation.json src/locales/uk/translation.json src/locales/vi/translation.json src/locales/zh_CN/translation.json src/locales/zh_TW/translation.json <<'EOF'
  feat(session): a provider's flag says whether the participant may speak

  While a definition's participantSpeech flag is off, the participant leg
  stays text-only whatever its switch says: the leg's context, the run's
  shape and the switch read the same flag, and the switch shows off and
  disabled with a "not available yet" tooltip, keeping the stored choice.
  The stores' answer is one function the gate's floors will share. The
  tooltip is one new key, translated into all 30 catalogs.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 5: The lease I — the request and its floors, the session key, the keys, the grant, the release (rulings 2, 3, 5, 10; choices 5, 6, 7, 19)

**Files:**
- Create: `src/providers/soniox/leaseRequest.ts`, `src/providers/soniox/leaseRequest.test.ts`, `src/providers/soniox/kizunaBudget.ts`, `src/providers/soniox/kizunaBudget.test.ts`, `src/providers/soniox/lease.ts`, `src/providers/soniox/lease.test.ts`.

**Interfaces:**
- **Consumes:** Task 1's `LeaseContext`, `Resources`, `Budget`, `BalanceShape`; `SonioxCredentials`, `SonioxSettings` (`./settings`); `AdapterStartError`; `SONIOX_REGIONS`, `asSonioxRegion`.
- **Produces** (`leaseRequest.ts`): `PARTICIPANT_SPEECH_FIELD = 'participantSpeech'`; `type SttRole = 'spk_stt' | 'par_stt' | 'mix_stt'`; `type StreamRole = SttRole | 'spk_tts' | 'par_tts' | 'mix_tts'`; `STREAM_ROLES`; `isSttRole(role)`; `sideOf(role)`; `interface LeaseRequest { mode; textOnly; bothSplit; region; participantSpeaks?: boolean }`; `leaseRequest(shape: Pick<RunShape, 'legs' | 'textOnly' | 'participantSpeech'>, s: Pick<SonioxSettings, 'region' | 'bothModeSharedSession'>, participantSpeech: boolean): LeaseRequest`; `requestBody(request: LeaseRequest): Record<string, unknown>`; `requestedRoles(request: LeaseRequest): StreamRole[]`; `roleFor(request: LeaseRequest, leg: LegName): SttRole | null`.
- **Produces** (`kizunaBudget.ts`): `SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR`, `SONIOX_MANAGED_MIN_SESSION_S`, `SONIOX_MAX_TRANSCRIPTION_SESSION_S`, `SONIOX_MAX_SYNTHESIS_SESSION_S`; `sonioxStartFloorMicroUsd(stt: number, tts: number): number`; `sonioxRolesFloorMicroUsd(roles: readonly StreamRole[]): number`; `kizunaSonioxMinimumBalance(shape: BalanceShape, s: Pick<SonioxSettings, 'region' | 'bothModeSharedSession'>, participantSpeech?: boolean): number`; `sonioxSessionCapSeconds(withSpeech: boolean): number`.
- **Produces** (`lease.ts`): `SESSION_KEY_TIMEOUT_MS`, `DEFAULT_CONFLICT_RETRY_MS`, `SESSION_END_BUDGET_MS`, `SESSION_END_RETRY_DELAYS_MS`; `interface KizunaLeaseDeps { participantSpeech?: boolean; fetch?; apiUrl? }`; `createKizunaLease(deps?): (shape: RunShape, s: SonioxSettings, ctx: LeaseContext) => Promise<Resources<SonioxCredentials>>`.
- **Consumed by:** Task 6 (adds the ports inside `createKizunaLease`); Task 8 (`createKizunaLease`, `kizunaSonioxMinimumBalance`, `PARTICIPANT_SPEECH_FIELD` in its end-to-end spec).

- [ ] **Step 1: Write the failing tests.**
  - `leaseRequest.test.ts` — the request and its roles, the flag off and on (ruling 2; choice 19):

    ```ts
    import { describe, it, expect } from 'vitest';
    import type { LegName } from '../../lib/conversation/types';
    import { leaseRequest, PARTICIPANT_SPEECH_FIELD, requestBody, requestedRoles, roleFor } from './leaseRequest';

    const shape = (legs: LegName[], textOnly = false, participantSpeech = false) => ({ legs, textOnly, participantSpeech });
    const settings = (shared: boolean) => ({ region: 'us' as const, bothModeSharedSession: shared });

    // The backend's matrix (`managedSonioxSplit.test.ts:34-133`, less "Both + auto", which D20 refuses at the gate).
    const TODAY: Array<[string, LegName[], boolean, boolean, string, string[]]> = [
      ['speaker, speaking', ['speaker'], false, true, '{"mode":"speaker","textOnly":false,"bothSplit":false,"region":"us"}', ['spk_stt', 'spk_tts']],
      ['speaker, text only', ['speaker'], true, true, '{"mode":"speaker","textOnly":true,"bothSplit":false,"region":"us"}', ['spk_stt']],
      ['participant only', ['participant'], false, true, '{"mode":"participant","textOnly":true,"bothSplit":false,"region":"us"}', ['par_stt']],
      ['shared Both, speaking', ['speaker', 'participant'], false, true, '{"mode":"both","textOnly":false,"bothSplit":false,"region":"us"}', ['mix_stt', 'mix_tts']],
      ['shared Both, text only', ['speaker', 'participant'], true, true, '{"mode":"both","textOnly":true,"bothSplit":false,"region":"us"}', ['mix_stt']],
      ['split Both, speaking', ['speaker', 'participant'], false, false, '{"mode":"both","textOnly":false,"bothSplit":true,"region":"us"}', ['spk_stt', 'spk_tts', 'par_stt']],
      ['split Both, text only', ['speaker', 'participant'], true, false, '{"mode":"both","textOnly":true,"bothSplit":true,"region":"us"}', ['spk_stt', 'par_stt']],
    ];

    describe('the session-key request, the participant-speech flag off (as shipped)', () => {
      it.each(TODAY)('%s: the body is byte for byte today\'s, whatever the participant wants, and so are the roles', (_name, legs, textOnly, shared, body, roles) => {
        // The shape says the participant would speak: with the flag off, nothing of it reaches the wire.
        const request = leaseRequest(shape(legs, textOnly, true), settings(shared), false);
        expect(JSON.stringify(requestBody(request))).toBe(body);
        expect(requestBody(request)).not.toHaveProperty(PARTICIPANT_SPEECH_FIELD);
        expect(requestedRoles(request)).toEqual(roles);
      });

      it('runs each leg on its own STT role; shared Both\'s participant on none', () => {
        const role = (legs: LegName[], shared: boolean, leg: LegName) => roleFor(leaseRequest(shape(legs), settings(shared), false), leg);
        expect(role(['speaker'], true, 'speaker')).toBe('spk_stt');
        expect(role(['participant'], true, 'participant')).toBe('par_stt');
        expect(role(['speaker', 'participant'], true, 'speaker')).toBe('mix_stt');
        expect(role(['speaker', 'participant'], true, 'participant')).toBeNull();
        expect(role(['speaker', 'participant'], false, 'speaker')).toBe('spk_stt');
        expect(role(['speaker', 'participant'], false, 'participant')).toBe('par_stt');
      });
    });

    describe('the session-key request, the participant-speech flag on', () => {
      it("serializes the participant's intent under one field, after today's four", () => {
        const speaking = requestBody(leaseRequest(shape(['speaker', 'participant'], false, true), settings(false), true));
        expect(JSON.stringify(speaking)).toBe(`{"mode":"both","textOnly":false,"bothSplit":true,"region":"us","${PARTICIPANT_SPEECH_FIELD}":true}`);
        expect(requestBody(leaseRequest(shape(['speaker', 'participant'], false, false), settings(false), true))[PARTICIPANT_SPEECH_FIELD]).toBe(false);
        // No participant leg: it cannot speak, whatever the switch says.
        expect(requestBody(leaseRequest(shape(['speaker'], false, true), settings(true), true))[PARTICIPANT_SPEECH_FIELD]).toBe(false);
      });

      it('asks for par_tts wherever the participant speaks', () => {
        const roles = (legs: LegName[], textOnly: boolean, shared: boolean) => requestedRoles(leaseRequest(shape(legs, textOnly, true), settings(shared), true));
        expect(roles(['speaker', 'participant'], false, false)).toEqual(['spk_stt', 'spk_tts', 'par_stt', 'par_tts']);
        expect(roles(['speaker', 'participant'], false, true)).toEqual(['mix_stt', 'mix_tts', 'par_tts']);
        expect(roles(['speaker', 'participant'], true, true)).toEqual(['mix_stt', 'par_tts']);
        expect(roles(['participant'], true, true)).toEqual(['par_stt', 'par_tts']);
      });

      it("names the field once — the client's guess until the backend names it", () => {
        expect(PARTICIPANT_SPEECH_FIELD).toBe('participantSpeech');
      });
    });
    ```

  - `kizunaBudget.test.ts` — the backend-parity test, ported from `sonioxManagedMinBalance.test.ts:22-97` and widened by the caps and the roles:

    ```ts
    import { describe, it, expect } from 'vitest';
    import type { LegName } from '../../lib/conversation/types';
    import {
      kizunaSonioxMinimumBalance, SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR, SONIOX_MANAGED_MIN_SESSION_S,
      SONIOX_MAX_SYNTHESIS_SESSION_S, SONIOX_MAX_TRANSCRIPTION_SESSION_S, sonioxRolesFloorMicroUsd, sonioxSessionCapSeconds, sonioxStartFloorMicroUsd,
    } from './kizunaBudget';
    import { SONIOX_DEFAULTS } from './settings';

    /**
     * The backend refuses a session key below its shortest session's price at
     * the stream set's conservative rate (sokuji-backend `computeSessionBudget`,
     * `src/routes/soniox.ts:46-92`), and caps the grant per set. These literals
     * restate its arithmetic (`src/services/soniox-budget.ts:76-77`,
     * `src/config/soniox.ts:33, 35, 72, 81` at 7b2259c), so a change on either
     * side fails here rather than as a Start button or a grant-end sentence
     * that lies.
     */
    describe('Kizuna Soniox floors and caps mirror the backend', () => {
      const STT = 1_100_000;
      const TTS = 1_400_000;
      const MIN_SESSION_S = 60;
      // Integer µUSD throughout: the float spelling of the 2+1 sum ceils to 60001.
      const floor = (stt: number, tts: number) => Math.ceil(((stt * STT + tts * TTS) * MIN_SESSION_S) / 3600);

      it('mirrors the conservative per-stream rates, the shortest session and the two caps', () => {
        expect(SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR).toEqual({ stt: STT, tts: TTS });
        expect(SONIOX_MANAGED_MIN_SESSION_S).toBe(MIN_SESSION_S);
        expect(SONIOX_MAX_TRANSCRIPTION_SESSION_S).toBe(18_000);
        // MAX_SYNTHESIS_SESSION_S = min(MAX_TRANSCRIPTION_SESSION_S, TTS_KEY_MAX_TTL_S = 3600).
        expect(SONIOX_MAX_SYNTHESIS_SESSION_S).toBe(Math.min(18_000, 3_600));
      });

      it('prices every issuable stream set as the backend does', () => {
        expect(sonioxStartFloorMicroUsd(1, 0)).toBe(floor(1, 0)); // 18 334
        expect(sonioxStartFloorMicroUsd(1, 1)).toBe(floor(1, 1)); // 41 667
        expect(sonioxStartFloorMicroUsd(2, 0)).toBe(floor(2, 0)); // 36 667
        expect(sonioxStartFloorMicroUsd(2, 1)).toBe(floor(2, 1)); // 60 000
        expect([floor(1, 0), floor(1, 1), floor(2, 0), floor(2, 1)]).toEqual([18_334, 41_667, 36_667, 60_000]);
      });

      it('prices a role list as the backend prices its stream set', () => {
        expect(sonioxRolesFloorMicroUsd(['spk_stt'])).toBe(18_334);
        expect(sonioxRolesFloorMicroUsd(['spk_stt', 'spk_tts'])).toBe(41_667);
        expect(sonioxRolesFloorMicroUsd(['spk_stt', 'par_stt'])).toBe(36_667);
        expect(sonioxRolesFloorMicroUsd(['spk_stt', 'spk_tts', 'par_stt'])).toBe(60_000);
      });

      it("names today's floor for the start, the participant-speech flag off: split Both opens a second STT stream, only the speaker speaks", () => {
        const shared = { ...SONIOX_DEFAULTS, bothModeSharedSession: true };
        const split = { ...SONIOX_DEFAULTS, bothModeSharedSession: false };
        const at = (legs: LegName[], textOnly: boolean, s = shared) => kizunaSonioxMinimumBalance({ legs, textOnly, participantSpeech: true }, s);
        // `participantSpeech: true` in every shape: with the flag off (the default) it prices nothing.
        expect(at(['speaker'], false)).toBe(41_667);
        expect(at(['speaker'], true)).toBe(18_334);
        expect(at(['participant'], false)).toBe(18_334);
        expect(at(['speaker', 'participant'], false)).toBe(41_667);
        expect(at(['speaker', 'participant'], false, split)).toBe(60_000);
        expect(at(['speaker', 'participant'], true, split)).toBe(36_667);
        // A single leg ignores the Both-mode setting.
        expect(at(['speaker'], true, split)).toBe(18_334);
      });

      it("prices the participant's speech stream once the flag is on — a role the backend has no floor for yet", () => {
        // The backend mints no `par_tts` today, so it prices none: these are
        // this formula's answers, which its floor must match when it does
        // (the "turning it on" checklist updates this test then).
        const shared = { ...SONIOX_DEFAULTS, bothModeSharedSession: true };
        const split = { ...SONIOX_DEFAULTS, bothModeSharedSession: false };
        const on = (legs: LegName[], textOnly: boolean, s = shared) => kizunaSonioxMinimumBalance({ legs, textOnly, participantSpeech: true }, s, true);
        expect(on(['participant'], true)).toBe(41_667); // par_stt + par_tts
        expect(on(['speaker', 'participant'], false)).toBe(65_000); // mix_stt + mix_tts + par_tts
        expect(on(['speaker', 'participant'], false, split)).toBe(83_334); // two STT + two TTS
        expect(on(['speaker', 'participant'], true, split)).toBe(60_000); // spk_stt + par_stt + par_tts
        // The flag on but the participant quiet: today's floor.
        expect(kizunaSonioxMinimumBalance({ legs: ['speaker', 'participant'], textOnly: false, participantSpeech: false }, split, true)).toBe(60_000);
      });

      it('caps a session at an hour when it speaks, five hours when it does not', () => {
        expect(sonioxSessionCapSeconds(true)).toBe(3_600);
        expect(sonioxSessionCapSeconds(false)).toBe(18_000);
      });
    });
    ```

  - `lease.test.ts` — over a stub `fetch` and a virtual clock (ruling 12). Its helpers, in full:

    ```ts
    import { describe, it, expect, vi } from 'vitest';
    import { AdapterStartError } from '../../lib/contract/adapter';
    import { createVirtualClock } from '../../lib/contract/clock';
    import type { LegName } from '../../lib/conversation/types';
    import type { LeaseContext, RunShape } from '../../lib/session/types';
    import { createKizunaLease, DEFAULT_CONFLICT_RETRY_MS, SESSION_END_BUDGET_MS, SESSION_KEY_TIMEOUT_MS } from './lease';
    import { PARTICIPANT_SPEECH_FIELD } from './leaseRequest';
    import { SONIOX_DEFAULTS, type SonioxSettings } from './settings';

    const API = 'https://api.test';
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    /** A `fetch` that answers only when told; an abort rejects it, as a real one does. */
    function stubFetch() {
      const calls: Array<{ url: string; init: RequestInit; respond(status: number, body?: unknown): void; fail(error?: unknown): void }> = [];
      const fetch = vi.fn((url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
        calls.push({
          url, init,
          respond: (status, body) => resolve(new Response(body === undefined ? null : JSON.stringify(body), { status })),
          fail: (error = new TypeError('Failed to fetch')) => reject(error),
        });
      }));
      return { fetch, calls, last: () => calls[calls.length - 1], to: (path: string) => calls.filter((c) => c.url === `${API}${path}`) };
    }

    const stream = (role: string) => ({ role, apiKey: `k-${role}`, clientReferenceId: `ref-${role}`, expiresAt: 'x' });
    /** A grant as the backend answers it (`routes/soniox.ts:617-660`); flat fields kept, as it sends them. */
    const grant = (roles: string[], over: Record<string, unknown> = {}) => ({
      sttApiKey: `k-${roles[0]}`, expiresAt: 'x', maxSessionDurationSeconds: 600, budgetMicroUsd: 416_667, rateUsdPerHour: 2.5, sku: 'soniox',
      leaseId: 'lease-1', clientReferenceId: `ref-${roles[0]}`, region: 'us', streams: roles.map(stream), ...over,
    });

    const shapeFor = (legs: LegName[], o: { textOnly?: boolean; participantSpeech?: boolean; token?: string | null } = {}): RunShape => ({
      provider: {} as RunShape['provider'], settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' }, legs,
      turnMode: 'auto', textOnly: o.textOnly ?? false, participantSpeech: o.participantSpeech ?? false, keepReplayAudio: true,
      shared: { instructions: () => '', pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
      auth: { signedIn: o.token !== null, userId: 'u1', getToken: vi.fn(async () => (o.token === undefined ? 'tok' : o.token)) },
    });

    /** `acquire` in flight over a stub `fetch`, on a virtual clock; the test answers it. `flag` is the participant-speech flag (ruling 2), off by default as shipped. */
    function acquiring(legs: LegName[], o: { textOnly?: boolean; participantSpeech?: boolean; flag?: boolean; settings?: Partial<SonioxSettings>; token?: string | null } = {}) {
      const net = stubFetch();
      const clock = createVirtualClock(0);
      const controller = new AbortController();
      const end = vi.fn();
      const frame = vi.fn();
      const ctx: LeaseContext = { signal: controller.signal, clock, end, frame };
      const lease = createKizunaLease({ participantSpeech: o.flag ?? false, fetch: net.fetch as unknown as typeof fetch, apiUrl: () => API });
      const shape = shapeFor(legs, o);
      const pending = lease(shape, { ...SONIOX_DEFAULTS, ...o.settings }, ctx);
      pending.catch(() => {});
      return { ...net, clock, controller, end, frame, ctx, lease, shape, pending };
    }
    ```

    Cases (each awaits `flush()` before answering, since `acquire` reads the token first):
    1. **"sends today's body byte for byte with the flag off, whatever the participant wants"** — `acquiring(['speaker', 'participant'], { participantSpeech: true, settings: { bothModeSharedSession: false } })`: the call's `init.body` is exactly `'{"mode":"both","textOnly":false,"bothSplit":true,"region":"us"}'` (the matrix itself is `leaseRequest.test.ts`'s); with `flag: true` the same start's body is `'{"mode":"both","textOnly":false,"bothSplit":true,"region":"us","participantSpeech":true}'`, spelled through `PARTICIPANT_SPEECH_FIELD`.
    2. **"POSTs that body to session-key, the sign-in token in Authorization only"** — `acquiring(['speaker'], { settings: { region: 'eu' } })`: the one call is `POST ${API}/soniox/session-key`, headers exactly `{ Authorization: 'Bearer tok', 'Content-Type': 'application/json' }`, body `{ mode: 'speaker', textOnly: false, bothSplit: false, region: 'eu' }`; respond `200, grant(['spk_stt', 'spk_tts'], { region: 'eu' })` → resolves.
    3. **"hands each leg its own keys, the TTS key of the same side, and the response's region"** (ported from `ManagedSonioxSession.test.ts:122-290, 671-716`):
       - speaker speaking, grant `['spk_stt', 'spk_tts']`, region `'jp'` in the response while the request said `'us'` → `credentials('speaker')` equals `{ region: 'jp', stt: 'k-spk_stt', tts: 'k-spk_tts', clientReferenceId: 'ref-spk_stt' }`;
       - text only, grant `['spk_stt']` → no `tts`;
       - participant only, grant `['par_stt']` → `{ region: 'us', stt: 'k-par_stt', clientReferenceId: 'ref-par_stt' }`, no `tts`;
       - split Both speaking, grant `['spk_stt', 'spk_tts', 'par_stt']` → speaker `spk_*` with `tts: 'k-spk_tts'`; participant `par_stt` with **no** `tts` (the speaker's TTS key stays on the speaker's side);
       - shared Both speaking, grant `['mix_stt', 'mix_tts']` → speaker `{ region, stt: 'k-mix_stt', tts: 'k-mix_tts', clientReferenceId: 'ref-mix_stt' }`; participant `{ region: 'us', stt: 'k-mix_stt', clientReferenceId: 'ref-mix_stt' }` — no `tts`, and it does not throw;
       - `credentials('participant')` on a speaker-only lease throws `/not requested/`;
       - **the flag off, a stray `par_tts` is ignored** (ruling 2): split Both granted `['spk_stt', 'spk_tts', 'par_stt', 'par_tts']`, participant-only `['par_stt', 'par_tts']`, shared Both `['mix_stt', 'mix_tts', 'par_tts']` — the participant's credentials carry no `tts` in any of them; the speaker's keep theirs;
       - **the flag on, `par_tts` is the participant's TTS key in every mode** (`acquiring(…, { flag: true, participantSpeech: true })`): split Both → participant `{ region: 'us', stt: 'k-par_stt', tts: 'k-par_tts', clientReferenceId: 'ref-par_stt' }` and the speaker still `tts: 'k-spk_tts'`; participant-only → `{ region: 'us', stt: 'k-par_stt', tts: 'k-par_tts', clientReferenceId: 'ref-par_stt' }`; shared Both → speaker `{ region: 'us', stt: 'k-mix_stt', tts: 'k-mix_tts', clientReferenceId: 'ref-mix_stt' }`, participant `{ region: 'us', stt: 'k-mix_stt', tts: 'k-par_tts', clientReferenceId: 'ref-par_tts' }` (the shared `mix_*` bundle stays on the speaker; the participant's one socket is its TTS one, on its own key and reference);
       - **the flag on, no `par_tts` in the answer**: split Both granted `['spk_stt', 'spk_tts', 'par_stt']` → the participant has no `tts` (its leg, asked to speak, runs text-only through the adapter's `tts_degraded` — Task 8's spec drives it);
       - no credential object or frame payload ever holds `'tok'` (`JSON.stringify(frame.mock.calls)` has no `'tok'`; the `session.lease_acquired` frame's payload is `{ leaseId: 'lease-1', region, roles: [...], maxSessionDurationSeconds: 600 }` — roles, never keys).
    4. **"fails the start loudly on a contract break"** (ruling 10) — a 200 whose body lacks `clientReferenceId`; lacks `region`; names `region: 'xx'`; lacks `streams`; has `streams: []`; has a stream with no `apiKey`; issues `['spk_stt']` to a split Both start (no `par_stt`): each rejects with a plain `Error` (`not.toBeInstanceOf(AdapterStartError)`), messages matching `/clientReferenceId/`, `/region/`, `/region/`, `/streams/`, `/streams/`, `/malformed stream/`, `/par_stt/`; none holds `'tok'` or a key.
    5. **"words every refusal by its code"** (`ManagedSonioxSession.test.ts:122-290`'s error cases) — respond 401 → `AdapterStartError` code `'sign_in_required'`; 402 with `{ error: 'Insufficient balance', requiredMicroUsd: 41_667, balanceMicroUsd: 1_000 }` → `'insufficient_balance'`, its message holding `41667` and `1000`; 403 → `'wallet_frozen'`; 502 → `'soniox_service_unavailable'`; each of the three 503 bodies (`'Soniox region not available'`, `'Wallet unavailable'`, `'Soniox capacity is temporarily full'`) → `'soniox_service_busy'` (parity); 500 with `{ error: 'boom' }` → a plain `Error` `'boom'`; 500 with no body → `/HTTP 500/`; `fail(new TypeError('Failed to fetch'))` → code `'network'`, message `/Failed to reach the Soniox session service: Failed to fetch/`.
    6. **"bounds each attempt at 15 s on the run's clock, and does not retry a timeout"** (`:293-446`) — never answer; `clock.advance(SESSION_KEY_TIMEOUT_MS - 1)`, `flush()` → still pending (race `pending` against `flush()`); `clock.advance(1)`, `flush()` → rejects, code `'soniox_service_unavailable'`; `fetch` was called once.
    7. **"retries a 409 once, after the backend's hint, on the clock, with a full bound of its own"** — respond `409, { error: 'x', retryAfterMs: 1200 }` → `frame` called with `{ direction: 'in', type: 'session.retry', payload: { status: 409, retryAfterMs: 1200 } }`; `clock.advance(1199)`, `flush()` → one call; `clock.advance(1)`, `flush()` → two calls; the second never answered: `clock.advance(SESSION_KEY_TIMEOUT_MS - 1)` still pending (the retry's own bound, not what was left of the first); answer it `200` → resolves.
    8. **"waits 3 s for a 409 that names no wait, and says session_conflict after the second"** — respond `409` with no body → `clock.advance(DEFAULT_CONFLICT_RETRY_MS)`, `flush()` → the retry; respond `409` → rejects, code `'session_conflict'`; three calls never happen (`fetch` called twice).
    9. **"a cancel reaches the request and the wait"** — during the first attempt, `controller.abort(new Error('stop'))` → rejects with that `Error` (not an `AdapterStartError`); during a 409's wait, `controller.abort(new Error('stop'))` → rejects with it, and no second call follows `clock.advance(10_000)`.
    10. **"refuses a signed-out start before any request"** — `acquiring(['speaker'], { token: null })` → rejects, code `'sign_in_required'`; `fetch` never called.
    11. **"its budget is the granted time, from acquire"** (§1.5; choice 7) — at `clock.advance(5_000)` before answering, respond `grant([...], { maxSessionDurationSeconds: 600 })` → `lease.budget` equals `{ totalMs: 600_000, endsAt: 605_000 }`.
    12. **"ends the run once at the grant's end, in the words decided at acquire"** (ruling 3):
        - speaking, 600 s (below the 3 600-s cap) → `clock.advance(600_000)` → `end` called once with `{ code: 'budget_exhausted', message: 'The session used the 600 s its balance was granted.' }`; a frame `session.lease_ended` `{ code: 'budget_exhausted' }`; `clock.advance(600_000)` → still once;
        - speaking, `maxSessionDurationSeconds: 3600` (roles `['spk_stt', 'spk_tts']`) → `{ code: 'segment_ended', message: 'The session reached its longest segment (3600 s).' }`;
        - text only, 3600 s (roles `['spk_stt']`: the cap is 18 000 s) → `budget_exhausted`; text only, 18 000 s → `segment_ended`;
        - after `release()`, the timer ends nothing.
    13. **"release tells the backend at once, with the token cached at acquire and keepalive"** (choice 6) — after a granted lease: `shape.auth.getToken` called once (at acquire); `const releasing = lease.release();` and, **before awaiting**, `to('/soniox/session-end')` has one call: `POST`, `keepalive: true`, headers `{ Authorization: 'Bearer tok', 'Content-Type': 'application/json' }`, body `{ leaseId: 'lease-1' }`; `getToken` still called once; frame `{ direction: 'out', type: 'session.end', payload: { leaseId: 'lease-1' } }`; respond `200` → `releasing` resolves; a second `release()` sends nothing.
    14. **"retries session-end on a transport failure or a 5xx, three attempts at most, within 4 s"** — `fail()` the first → `flush()`; `clock.advance(499)` → one call; `clock.advance(1)`, `flush()` → two; respond `503` → `flush()`; `clock.advance(1_000)`, `flush()` → three; `fail()` → `flush()`; `releasing` resolves; frame `session.notify_failed` `{ step: 'session-end', message: 'The backend did not acknowledge session-end.' }`; `clock.advance(10_000)` → still three calls.
    15. **"never begins an attempt after the budget: a hung one is aborted at the deadline"** — the first attempt never answers; `clock.advance(SESSION_END_BUDGET_MS)`, `flush()` → the attempt was aborted (its promise rejected), `releasing` resolves, only one call was made.
    16. **"a 4xx answer to session-end is final"** — respond `401` → no retry; frame `session.notify_failed` `{ step: 'session-end', message: 'HTTP 401' }`.
    17. **"the next acquire cancels a release still retrying"** — lease A granted, `A.release()`, `fail()` its first attempt, `flush()`; before 500 ms pass, start lease B on the same `createKizunaLease` (same `fetch`) and grant it; `clock.advance(10_000)`, `flush()` → `to('/soniox/session-end')` still has one call.
- [ ] **Step 2: Run** `npx vitest run src/providers/soniox/leaseRequest.test.ts src/providers/soniox/kizunaBudget.test.ts src/providers/soniox/lease.test.ts` — FAIL: no modules.
- [ ] **Step 3: Implement.**
  - `leaseRequest.ts`, in full:

    ```ts
    /**
     * Kizuna AI's managed Soniox session-key request and the stream roles it
     * asks for (Stage 2 Kizuna Soniox, choice 19): the backend's matrix body
     * (`BE:config/soniox.ts:577-623`), in the order the old client sent it
     * (`ManagedSonioxSession.ts:707-711`), and its expansion into roles
     * (`BE:config/soniox.ts:372-393`). The floor (`kizunaBudget.ts`) prices
     * these roles and the lease (`lease.ts`) asks for them, so the two agree.
     *
     * Participant speech is built and shipped off (ruling 2): with the flag
     * on, the body carries the participant's intent and the roles gain
     * `par_tts`; with it off, the body is byte for byte today's.
     */
    import type { LegName } from '../../lib/conversation/types';
    import type { RunShape } from '../../lib/session/types';
    import { asSonioxRegion, type SonioxRegion } from '../../lib/soniox/regions';
    import type { SonioxSettings } from './settings';

    /**
     * The body field asking for the participant's speech stream. The backend
     * reads fields by name and ignores unknown ones
     * (`BE:routes/soniox.ts:254-280`), but the name is its choice when it
     * mints `par_tts`: confirm it then ("turning it on", roadmap).
     */
    export const PARTICIPANT_SPEECH_FIELD = 'participantSpeech';

    export type SttRole = 'spk_stt' | 'par_stt' | 'mix_stt';
    export type StreamRole = SttRole | 'spk_tts' | 'par_tts' | 'mix_tts';
    export const STREAM_ROLES: readonly StreamRole[] = ['spk_stt', 'par_stt', 'mix_stt', 'spk_tts', 'par_tts', 'mix_tts'];
    export const isSttRole = (role: StreamRole): role is SttRole => role.endsWith('_stt');
    /** The audio a role carries — `spk` the microphone, `par` the far end, `mix` both — which pairs an STT key with its TTS key. */
    export const sideOf = (role: StreamRole): string => role.slice(0, 3);

    export interface LeaseRequest {
      mode: 'speaker' | 'participant' | 'both';
      /** The speaker's speech: `true` when there is none to speak, participant-only included. The backend defaults neither this nor `bothSplit`. */
      textOnly: boolean;
      bothSplit: boolean;
      region: SonioxRegion;
      /** Whether the participant speaks — present only while the participant-speech flag is on (ruling 2). */
      participantSpeaks?: boolean;
    }

    /** This start's request: its legs; the speaker's speech; split Both from the settings `startBoth` reads; the settings' region; and, the flag on, whether the participant speaks. */
    export function leaseRequest(
      shape: Pick<RunShape, 'legs' | 'textOnly' | 'participantSpeech'>,
      s: Pick<SonioxSettings, 'region' | 'bothModeSharedSession'>,
      participantSpeech: boolean,
    ): LeaseRequest {
      const both = shape.legs.length === 2;
      return {
        mode: both ? 'both' : shape.legs[0] === 'participant' ? 'participant' : 'speaker',
        textOnly: !shape.legs.includes('speaker') || shape.textOnly,
        // Must agree with the adapter's `config.sharedBoth` (`startBoth`): both read the settings the run built from.
        bothSplit: both && !s.bothModeSharedSession,
        region: asSonioxRegion(s.region),
        ...(participantSpeech ? { participantSpeaks: shape.legs.includes('participant') && shape.participantSpeech } : {}),
      };
    }

    /** The JSON body: today's four fields, always and in today's order; then the participant's intent, only while the flag is on. */
    export function requestBody(r: LeaseRequest): Record<string, unknown> {
      return {
        mode: r.mode,
        textOnly: r.textOnly,
        bothSplit: r.bothSplit,
        region: r.region,
        ...(r.participantSpeaks === undefined ? {} : { [PARTICIPANT_SPEECH_FIELD]: r.participantSpeaks }),
      };
    }

    /** The roles a request is minted: the backend's expansion today, and `par_tts` where the participant speaks (the future role). */
    export function requestedRoles(r: LeaseRequest): StreamRole[] {
      const participantTts: StreamRole[] = r.participantSpeaks ? ['par_tts'] : [];
      if (r.mode === 'both' && !r.bothSplit) return ['mix_stt', ...(r.textOnly ? [] : ['mix_tts' as const]), ...participantTts];
      const speaker: StreamRole[] = r.mode === 'participant' ? [] : ['spk_stt', ...(r.textOnly ? [] : ['spk_tts' as const])];
      const participant: StreamRole[] = r.mode === 'speaker' ? [] : ['par_stt', ...participantTts];
      return [...speaker, ...participant];
    }

    /** The STT role a leg runs on; null for shared Both's participant, which rides the speaker's mixed socket. */
    export function roleFor(r: LeaseRequest, leg: LegName): SttRole | null {
      if (r.mode === 'both' && !r.bothSplit) return leg === 'speaker' ? 'mix_stt' : null;
      return leg === 'speaker' ? 'spk_stt' : 'par_stt';
    }
    ```

  - `kizunaBudget.ts`, in full:

    ```ts
    /**
     * What Kizuna AI's backend charges a managed Soniox session to start, and
     * how long it grants one — mirrored so the start gate and the grant-end
     * words can be right before the backend says so (Stage 2 Kizuna Soniox,
     * rulings 3 and 6). Ported from `sonioxManagedMinBalance.ts` (read-only
     * until Plan B2). KEEP IN SYNC with sokuji-backend
     * `src/services/soniox-budget.ts` (the conservative rates) and
     * `src/config/soniox.ts` (`MIN_SESSION_S`, `MAX_TRANSCRIPTION_SESSION_S`,
     * `TTS_KEY_MAX_TTL_S`, `MAX_SYNTHESIS_SESSION_S`); `kizunaBudget.test.ts`
     * restates the arithmetic. The backend's 402 stays the authority.
     */
    import type { BalanceShape } from '../../lib/session/types';
    import { isSttRole, leaseRequest, requestedRoles, type StreamRole } from './leaseRequest';
    import type { SonioxSettings } from './settings';

    /** One stream's conservative budget rate in µUSD per hour: any `*_stt` role, any `*_tts` role. Integers, so the floor's ceil is exact. */
    export const SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR = { stt: 1_100_000, tts: 1_400_000 } as const;
    /** The shortest session the backend starts, in seconds. */
    export const SONIOX_MANAGED_MIN_SESSION_S = 60;
    /** The longest grant for a session with no synthesis stream. */
    export const SONIOX_MAX_TRANSCRIPTION_SESSION_S = 18_000;
    /** The longest grant for a session that speaks: its TTS key lives at most an hour. */
    export const SONIOX_MAX_SYNTHESIS_SESSION_S = 3_600;

    /** The backend's start floor for a stream set: its shortest session at the set's rate, rounded up — `ceil((n_stt × stt + n_tts × tts) × 60 / 3600)`. */
    export function sonioxStartFloorMicroUsd(stt: number, tts: number): number {
      const rate = stt * SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR.stt + tts * SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR.tts;
      return Math.ceil((rate * SONIOX_MANAGED_MIN_SESSION_S) / 3600);
    }

    /** The floor of a role list: its STT roles at the STT rate, the rest at the TTS rate. */
    export function sonioxRolesFloorMicroUsd(roles: readonly StreamRole[]): number {
      const stt = roles.filter(isSttRole).length;
      return sonioxStartFloorMicroUsd(stt, roles.length - stt);
    }

    /**
     * Kizuna Soniox's `minimumBalance`: the floor of the roles this start's
     * lease would ask for (choice 19) — split Both's second STT stream, the
     * speaker's TTS stream, and, only with the participant-speech flag on,
     * the participant's (ruling 2).
     */
    export function kizunaSonioxMinimumBalance(shape: BalanceShape, s: Pick<SonioxSettings, 'region' | 'bothModeSharedSession'>, participantSpeech = false): number {
      return sonioxRolesFloorMicroUsd(requestedRoles(leaseRequest(shape, s, participantSpeech)));
    }

    /** The per-session cap the backend holds a grant to (`maxSessionSecondsFor`). */
    export function sonioxSessionCapSeconds(withSpeech: boolean): number {
      return withSpeech ? SONIOX_MAX_SYNTHESIS_SESSION_S : SONIOX_MAX_TRANSCRIPTION_SESSION_S;
    }
    ```

  - `lease.ts`, in full:

    ```ts
    /**
     * Kizuna AI's lease on a managed Soniox session (Stage 2 Kizuna Soniox;
     * survey §1.2–1.7, §2.4–2.5). `acquire` buys the session's keys from our
     * backend — one STT key per transcription stream, the TTS key of the same
     * side, each bound to its own client reference — and hands each leg its
     * own `SonioxCredentials`; it ends the run when the grant does, and
     * `release` tells the backend the session is over. Ported from
     * `ManagedSonioxSession` (`src/services/clients/ManagedSonioxSession.ts`,
     * read-only until Plan B2), with every timer on the run's clock and every
     * wait abortable. Not Soniox's session side: `adapter.ts` never reaches
     * this module. The participant's speech key is mapped only while the
     * participant-speech flag is on (ruling 2).
     */
    import { AdapterStartError, type AdapterFrame } from '../../lib/contract/adapter';
    import type { Clock } from '../../lib/contract/clock';
    import type { LegName } from '../../lib/conversation/types';
    import { describeCause } from '../../lib/diagnostics/describeCause';
    import type { LeaseContext, Resources, RunNotice, RunShape } from '../../lib/session/types';
    import { SONIOX_REGIONS, type SonioxRegion } from '../../lib/soniox/regions';
    import { getApiUrl } from '../../utils/environment';
    import { sonioxSessionCapSeconds } from './kizunaBudget';
    import { isSttRole, leaseRequest, requestBody, roleFor, sideOf, STREAM_ROLES, type SttRole, type StreamRole } from './leaseRequest';
    import type { SonioxCredentials, SonioxSettings } from './settings';

    /** One session-key attempt's bound, its body included (choice 5): a request that never answers must not hold Start. A 409's retry gets its own. */
    export const SESSION_KEY_TIMEOUT_MS = 15_000;
    /** The wait before a 409's one retry when the body names none (the backend's own is 3 000 ms). */
    export const DEFAULT_CONFLICT_RETRY_MS = 3_000;
    /** `session-end`'s attempts share this budget (ruling 10): none begins after it, and one in flight is aborted at it. */
    export const SESSION_END_BUDGET_MS = 4_000;
    /** The waits between `session-end`'s attempts: three attempts at most. */
    export const SESSION_END_RETRY_DELAYS_MS: readonly number[] = [500, 1_000];

    export interface KizunaLeaseDeps {
      /** The participant-speech flag (ruling 2): the definition's, handed over by its factory. Off by default, as shipped. */
      participantSpeech?: boolean;
      /** `fetch` in the app, read at call time; a stub in tests (ruling 12). */
      fetch?: (url: string, init: RequestInit) => Promise<Response>;
      /** The backend's API root; `getApiUrl()` by default. */
      apiUrl?: () => string;
    }

    interface Grant {
      leaseId: string;
      region: SonioxRegion;
      maxSessionDurationSeconds: number;
      streams: Array<{ role: StreamRole; apiKey: string; clientReferenceId: string }>;
    }

    /** A 200's body, checked: a contract break fails the start loudly (ruling 10) — no flat-field or region fallback, no key in any message. */
    function parseGrant(body: unknown): Grant {
      const b = (body ?? {}) as Record<string, unknown>;
      if (typeof b.leaseId !== 'string' || !b.leaseId) throw new Error('The session-key response is missing leaseId.');
      if (typeof b.clientReferenceId !== 'string' || !b.clientReferenceId) throw new Error('The session-key response is missing clientReferenceId.');
      // The region the keys belong to is the response's, never the request's.
      if (typeof b.region !== 'string' || !(SONIOX_REGIONS as readonly string[]).includes(b.region)) {
        throw new Error(`The session-key response names no known region (${String(b.region)}).`);
      }
      const seconds = b.maxSessionDurationSeconds;
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) throw new Error('The session-key response names no granted duration.');
      if (!Array.isArray(b.streams) || b.streams.length === 0) throw new Error('The session-key response issued no streams.');
      const streams = b.streams.map((raw: unknown) => {
        const st = (raw ?? {}) as Record<string, unknown>;
        if (!STREAM_ROLES.includes(st.role as StreamRole) || typeof st.apiKey !== 'string' || typeof st.clientReferenceId !== 'string') {
          throw new Error(`The session-key response issued a malformed stream (${String(st.role)}).`);
        }
        return { role: st.role as StreamRole, apiKey: st.apiKey, clientReferenceId: st.clientReferenceId };
      });
      return { leaseId: b.leaseId, region: b.region as SonioxRegion, maxSessionDurationSeconds: seconds, streams };
    }

    /** A refused session key in the user's words (choice 5): the code picks the sentence, the message keeps the server's. */
    function refusal(status: number, body: unknown): Error {
      const b = (body ?? {}) as { error?: unknown; requiredMicroUsd?: unknown; balanceMicroUsd?: unknown };
      const server = typeof b.error === 'string' ? b.error : '';
      const detail = server ? `: ${server}` : '';
      switch (status) {
        case 401: return new AdapterStartError(`The session service did not accept the sign-in (HTTP 401${detail}).`, 'sign_in_required');
        case 402: return new AdapterStartError(`The balance is below this session's floor (HTTP 402${detail}; needs ${String(b.requiredMicroUsd)} µUSD, has ${String(b.balanceMicroUsd)}).`, 'insufficient_balance');
        case 403: return new AdapterStartError(`The wallet is frozen (HTTP 403${detail}).`, 'wallet_frozen');
        case 409: return new AdapterStartError(`Another session holds the account's lease (HTTP 409${detail}).`, 'session_conflict');
        case 502: return new AdapterStartError(`Soniox did not mint the session's keys (HTTP 502${detail}).`, 'soniox_service_unavailable');
        // All three of the backend's 503 bodies, as the old client worded them (survey §1.12.3).
        case 503: return new AdapterStartError(`The Soniox session service is unavailable (HTTP 503${detail}).`, 'soniox_service_busy');
        default: return new Error(server || `Failed to start a managed Soniox session (HTTP ${status})`);
      }
    }

    /** `ms` on the clock, or the abort's reason. */
    function wait(clock: Clock, ms: number, signal: AbortSignal): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason ?? new Error('aborted'));
          return;
        }
        const onAbort = () => {
          cancel();
          reject(signal.reason ?? new Error('aborted'));
        };
        const cancel = clock.setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }

    interface Ending {
      done: Promise<void>;
      cancel(): void;
    }

    /**
     * Tells the backend the session is over (choice 6): a hint that lets its
     * sweep settle the lease before expiry (`routes/soniox.ts:820-864`). With
     * `keepalive`, so it outlives a closing page, and the token cached at
     * acquire, so `pagehide`'s synchronous release sends it before any await.
     * A transport failure or a 5xx is retried, three attempts at most within
     * `SESSION_END_BUDGET_MS`; a 4xx is final.
     */
    function signalEnd(
      doFetch: NonNullable<KizunaLeaseDeps['fetch']>, url: string, token: string, leaseId: string, clock: Clock, frame: (f: AdapterFrame) => void,
    ): Ending {
      let cancelled = false;
      let inFlight: AbortController | null = null;
      const deadline = clock.now() + SESSION_END_BUDGET_MS;
      const attempt = async (): Promise<boolean> => {
        const controller = new AbortController();
        inFlight = controller;
        const cancelTimer = clock.setTimeout(() => controller.abort(), Math.max(0, deadline - clock.now()));
        try {
          const res = await doFetch(url, {
            method: 'POST',
            keepalive: true,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ leaseId }),
            signal: controller.signal,
          });
          if (res.status >= 500) return false;
          if (!res.ok) frame({ direction: 'in', type: 'session.notify_failed', payload: { step: 'session-end', message: `HTTP ${res.status}` } });
          return true;
        } catch {
          return false;
        } finally {
          cancelTimer();
          inFlight = null;
        }
      };
      const done = (async () => {
        for (let i = 0; ; i += 1) {
          if (cancelled) return;
          if (await attempt()) return;
          const delay = SESSION_END_RETRY_DELAYS_MS[i];
          if (cancelled || delay === undefined || clock.now() + delay >= deadline) break;
          await new Promise<void>((resolve) => { clock.setTimeout(resolve, delay); });
        }
        if (!cancelled) frame({ direction: 'in', type: 'session.notify_failed', payload: { step: 'session-end', message: 'The backend did not acknowledge session-end.' } });
      })();
      return {
        done,
        cancel: () => {
          cancelled = true;
          inFlight?.abort();
        },
      };
    }

    /** Kizuna Soniox's `acquire`. One instance per provider: it remembers the last release still retrying, which the next acquire cancels. */
    export function createKizunaLease(deps: KizunaLeaseDeps = {}) {
      const doFetch: NonNullable<KizunaLeaseDeps['fetch']> = (url, init) => (deps.fetch ?? fetch)(url, init);
      const apiUrl = () => (deps.apiUrl ?? getApiUrl)();
      const participantSpeech = deps.participantSpeech ?? false;
      /** The previous lease's `session-end` still retrying: the backend scopes it by account, so a late one would end the next lease (survey §1.2). */
      let previous: Ending | null = null;

      return async function acquire(shape: RunShape, s: SonioxSettings, ctx: LeaseContext): Promise<Resources<SonioxCredentials>> {
        previous?.cancel();
        previous = null;
        if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('aborted');
        const token = await shape.auth.getToken();
        if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('aborted');
        if (!token) throw new AdapterStartError('Sign in is required to start a managed Soniox session.', 'sign_in_required');
        const request = leaseRequest(shape, s, participantSpeech);

        const attempt = async (): Promise<{ status: number; body: unknown }> => {
          const controller = new AbortController();
          let timedOut = false;
          const cancelTimer = ctx.clock.setTimeout(() => { timedOut = true; controller.abort(); }, SESSION_KEY_TIMEOUT_MS);
          const onAbort = () => controller.abort();
          ctx.signal.addEventListener('abort', onAbort, { once: true });
          try {
            const res = await doFetch(`${apiUrl()}/soniox/session-key`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(requestBody(request)),
              signal: controller.signal,
            });
            let body: unknown = null;
            try {
              body = await res.json();
            } catch (error) {
              // A body that is not JSON leaves the status to speak; an abort is not that.
              if (controller.signal.aborted) throw error;
            }
            return { status: res.status, body };
          } catch (error) {
            if (ctx.signal.aborted) throw ctx.signal.reason ?? error;
            if (timedOut) throw new AdapterStartError('The Soniox session service did not answer within 15 s.', 'soniox_service_unavailable');
            throw new AdapterStartError(`Failed to reach the Soniox session service: ${describeCause(error)}`, 'network', undefined, { cause: error });
          } finally {
            cancelTimer();
            ctx.signal.removeEventListener('abort', onAbort);
          }
        };

        let answer = await attempt();
        if (answer.status === 409) {
          // Once: the account's previous session is very often just finishing its teardown.
          const hint = (answer.body as { retryAfterMs?: unknown } | null)?.retryAfterMs;
          const retryAfterMs = typeof hint === 'number' && Number.isFinite(hint) && hint >= 0 ? hint : DEFAULT_CONFLICT_RETRY_MS;
          ctx.frame({ direction: 'in', type: 'session.retry', payload: { status: 409, retryAfterMs } });
          await wait(ctx.clock, retryAfterMs, ctx.signal);
          answer = await attempt();
        }
        if (answer.status < 200 || answer.status >= 300) throw refusal(answer.status, answer.body);
        // A contract break past here leaves a never-started lease, which the
        // backend frees at its start window's end; `session-end` cannot (survey §1.2).
        const grant = parseGrant(answer.body);

        // Ruling 2: a `par_tts` is the participant's only while the flag is on; off, one in an answer is ignored.
        const streams = participantSpeech ? grant.streams : grant.streams.filter((st) => st.role !== 'par_tts');
        const bundles = new Map<SttRole, SonioxCredentials>();
        for (const st of streams) {
          if (!isSttRole(st.role)) continue;
          // The TTS key of the same side rides this STT stream: split Both's one `spk_tts` stays on the speaker, a `par_tts` goes with `par_stt`.
          const tts = streams.find((t) => !isSttRole(t.role) && sideOf(t.role) === sideOf(st.role));
          bundles.set(st.role, { region: grant.region, stt: st.apiKey, ...(tts ? { tts: tts.apiKey } : {}), clientReferenceId: st.clientReferenceId });
        }
        for (const leg of shape.legs) {
          const role = roleFor(request, leg);
          if (role && !bundles.has(role)) throw new Error(`The session-key response issued no key for ${role}, which the ${leg} leg runs on.`);
        }

        const startedAt = ctx.clock.now();
        const totalMs = grant.maxSessionDurationSeconds * 1000;
        // The backend caps what it minted (`maxSessionSecondsFor(roles)`, `BE:src/routes/soniox.ts:84`), whatever the flag: the words follow the minted set.
        const speaks = grant.streams.some((st) => !isSttRole(st.role));
        // Ruling 3: held to the per-session cap, the grant's end is a segment
        // ending — the balance covers more, and a new Start continues;
        // otherwise the balance is what ran out.
        const capped = grant.maxSessionDurationSeconds >= sonioxSessionCapSeconds(speaks);
        const grantEnd: RunNotice = capped
          ? { code: 'segment_ended', message: `The session reached its longest segment (${grant.maxSessionDurationSeconds} s).` }
          : { code: 'budget_exhausted', message: `The session used the ${grant.maxSessionDurationSeconds} s its balance was granted.` };

        let ended = false;
        let released = false;
        let cancelBudget = () => {};
        const endOnce = (notice: RunNotice): void => {
          if (ended || released) return;
          ended = true;
          cancelBudget();
          ctx.frame({ direction: 'in', type: 'session.lease_ended', payload: { code: notice.code } });
          ctx.end(notice);
        };
        cancelBudget = ctx.clock.setTimeout(() => endOnce(grantEnd), totalMs);
        ctx.frame({
          direction: 'in',
          type: 'session.lease_acquired',
          payload: { leaseId: grant.leaseId, region: grant.region, roles: grant.streams.map((st) => st.role), maxSessionDurationSeconds: grant.maxSessionDurationSeconds },
        });

        return {
          credentials(leg: LegName): SonioxCredentials {
            if (!shape.legs.includes(leg)) throw new Error(`The ${leg} leg was not requested of this lease.`);
            const role = roleFor(request, leg);
            if (role) return { ...bundles.get(role)! };
            // Shared Both's participant rides the speaker's mixed socket: the
            // adapter reads only its region, its reference and its TTS key,
            // for its own TTS socket (`adapter.ts:80-86`). That key is
            // `par_tts`, with its own reference, while the flag is on and the
            // answer carries one; otherwise it has none and speaks nothing.
            const mix = bundles.get('mix_stt')!;
            const tts = streams.find((st) => st.role === 'par_tts');
            return tts
              ? { region: mix.region, stt: mix.stt, tts: tts.apiKey, clientReferenceId: tts.clientReferenceId }
              : { region: mix.region, stt: mix.stt, clientReferenceId: mix.clientReferenceId };
          },
          budget: { totalMs, endsAt: startedAt + totalMs },
          async release(): Promise<void> {
            if (released) return;
            released = true;
            cancelBudget();
            ctx.frame({ direction: 'out', type: 'session.end', payload: { leaseId: grant.leaseId } });
            const ending = signalEnd(doFetch, `${apiUrl()}/soniox/session-end`, token, grant.leaseId, ctx.clock, ctx.frame);
            previous = ending;
            await ending.done;
            if (previous === ending) previous = null;
          },
        };
      };
    }
    ```

    (`ended` is read by Task 6's cutoff; it is already used here by `endOnce`.)
- [ ] **Step 4: Run** `npx vitest run src/providers/soniox`, then the full suite and the gate. Nothing imports the three modules yet; `sessionSide.consistency.test.ts` stays green (`adapter.ts` reaches none of them).
- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/soniox/leaseRequest.ts src/providers/soniox/leaseRequest.test.ts src/providers/soniox/kizunaBudget.ts src/providers/soniox/kizunaBudget.test.ts src/providers/soniox/lease.ts src/providers/soniox/lease.test.ts
  ```

  ```bash
  git commit -q -F - -- src/providers/soniox/leaseRequest.ts src/providers/soniox/leaseRequest.test.ts src/providers/soniox/kizunaBudget.ts src/providers/soniox/kizunaBudget.test.ts src/providers/soniox/lease.ts src/providers/soniox/lease.test.ts <<'EOF'
  feat(kizuna-soniox): the lease buys a session's keys and releases them

  The session key is asked for the stream set the start opens, bounded on
  the run's clock, a 409 retried once; each refusal carries its words'
  code. Each leg gets its own key and the TTS key of its side. The grant's
  end stops the run in the words decided at acquire; session-end goes out
  with keepalive and the token cached at acquire, retried within four
  seconds and cancelled by the next lease. The start floors are priced
  from the roles the request asks for, and they and the session caps
  mirror the backend, with a parity test.

  Participant speech is built behind a flag that ships off: on, the
  request carries the participant's intent and a par_tts key becomes the
  participant's in every mode; off, the body is today's and a par_tts in
  an answer is ignored.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 6: The lease II — the port the adapter reports to (ruling 3; spec §7.10)

**Files:**
- Modify: `src/providers/soniox/lease.ts`, `src/providers/soniox/lease.test.ts` (a new describe, and Task 5's case-3 credential comparisons, which now carry the port), `src/providers/soniox/adapter.test.ts`.

**Interfaces:**
- **Consumes:** Task 5's `createKizunaLease` internals (`grant`, `startedAt`, `totalMs`, `grantEnd`, `endOnce`, `released`, `bundles`, `doFetch`, `apiUrl`, `token`); `SonioxLeasePort` (`./settings`); the adapter's use of it (`adapter.ts:293-296, 319-324, 339-350`).
- **Produces:** `GRANT_END_MARGIN_MS = 90_000`; each STT role's `SonioxLeasePort` on its leg's credentials.
- **Consumed by:** Task 8 (the definition hands the lease to the adapter unchanged).

- [ ] **Step 1: Write the failing tests.**
  - `lease.test.ts`, a new describe "the lease's port (SonioxLeasePort)", on the same helpers:
    1. **"reports the first accepted frame once per role, with the cached token"** (`ManagedSonioxSession.test.ts:449-615`) — split Both granted `['spk_stt', 'spk_tts', 'par_stt']`; `credentials('speaker').lease!.streamAccepted()` twice → `to('/soniox/session-started')` has one call, `POST`, headers `{ Authorization: 'Bearer tok', 'Content-Type': 'application/json' }`, body `{ leaseId: 'lease-1', role: 'spk_stt' }`, no `keepalive`; frame `{ direction: 'out', type: 'session.started', payload: { role: 'spk_stt' } }`; then `credentials('participant').lease!.streamAccepted()` → a second call with `role: 'par_stt'`; `getToken` still called once.
    2. **"puts a refusal in the Logs with its reason, and says nothing for a stale 200"** — the port posts once per role, so three answers need three posts: a split-Both lease (granted `['spk_stt', 'spk_tts', 'par_stt']`, two roles) for the first two, and a second, speaker-only lease for the third.
       - Split Both: `credentials('speaker').lease!.streamAccepted()`, respond `400, { error: 'x', reason: 'role_required' }` → after `flush()`, frame `{ direction: 'in', type: 'session.started_refused', payload: { status: 400, reason: 'role_required', role: 'spk_stt' } }`; then `credentials('participant').lease!.streamAccepted()`, respond `500` with no body (`respond(500)`, whose null body fails `json()`) → `{ status: 500, reason: null, role: 'par_stt' }`.
       - A second lease (`acquiring(['speaker'])`, granted `['spk_stt']`): `streamAccepted()`, respond `200, { ok: true, reason: 'no_live_lease' }` → no `session.started_refused` frame.
    3. **"puts a transport failure in the Logs"** — `fail()` → frame `{ direction: 'in', type: 'session.notify_failed', payload: { step: 'session-started', message: 'Failed to fetch' } }`.
    4. **"posts nothing once released: a late first frame cannot start a lease the account ended"** — `release()` (answered 200), then `streamAccepted()` → no `session-started` call.
    5. **"tells a 403 near the grant's end from an early one"** (`ManagedSonioxSession.outcome.test.ts`) — granted at clock 0 with 600 s: `atGrantEnd(0)` false; `atGrantEnd(600_000 - GRANT_END_MARGIN_MS - 1)` false; `atGrantEnd(600_000 - GRANT_END_MARGIN_MS)` true; `atGrantEnd(700_000)` true.
    6. **"ends the run at the cutoff, at once and once, in the grant's words"** — speaking, 600 s: `lease.cutoff()` → `end` called **synchronously** (before any `await`) with `{ code: 'budget_exhausted', … }`; a second `cutoff()` and `clock.advance(600_000)` add nothing; at the cap (3 600 s speaking) → `segment_ended`. After `release()`, `cutoff()` ends nothing.
    7. **"shared Both: the speaker's socket reports for the mixed stream; the participant has no port"** — granted `['mix_stt', 'mix_tts']`: `credentials('speaker').lease` defined, its `streamAccepted()` posts `role: 'mix_stt'`; `credentials('participant')` has no `lease`.
    8. **"the adapter's first frame reaches session-started"** — an integration case over `FakeSocket`: import `createSonioxAdapter` (`./adapter`), `buildSoniox` (`./config`), `fakeSockets`, `FakeSocket` (`../../lib/contract/testing/fakeSocket`), `recordEvents` (`../../lib/contract/events`), and `AUTO_CTX`, `SHARED`, `msg`, `orig`, `isStt` (`./testing`); grant a speaker-only lease; `const sockets = fakeSockets(); const starting = createSonioxAdapter({ openSocket: sockets.create }).start({ context: AUTO_CTX, config: buildSoniox(AUTO_CTX, SONIOX_DEFAULTS, SHARED), credentials: lease.credentials('speaker'), clock, signal: new AbortController().signal }, recordEvents().events);` open every connecting socket, `await starting`; `sockets.all.filter(isStt)[0].receive(msg(orig('Hi', false)))` → `to('/soniox/session-started')` has one call with `role: 'spk_stt'`; the STT socket's config frame carries `api_key: 'k-spk_stt'` and `client_reference_id: 'ref-spk_stt'`, never `'tok'`.
  - `lease.test.ts`, **Task 5's case-3 comparisons**: from this task on, every leg with its own STT role carries the port. Each of those `toEqual` expectations gains `lease: expect.objectContaining({ streamAccepted: expect.any(Function), atGrantEnd: expect.any(Function), cutoff: expect.any(Function) })` — the speaker's in every mode, the participant's in split Both and participant-only, flag on or off. Shared Both's participant stays exact and without `lease`, which also pins that the mixed socket reports only through the speaker. Keep `toEqual` (never `toMatchObject`), so the flag-off cases' "no `tts`" still bites.
  - `adapter.test.ts`, in `describe("the Soniox adapter: Plan B's session seams")`, one case (survey §1.13, "an error frame first → no `streamAccepted` is not pinned"): **"an error frame first never tells the lease a stream was accepted"** — `const lease = { streamAccepted: vi.fn(), atGrantEnd: vi.fn(() => false), cutoff: vi.fn() }; const { stt, of } = await live({ credentials: { ...KEY, lease } }); stt().receive(JSON.stringify({ error_code: 401, error_message: 'Invalid API key' }));` → `lease.streamAccepted` not called; `of('failed')` has one entry with code `'auth'`. (A characterization: the STT stream routes an `error_code` frame to `onError`, never `onMessage`.)
- [ ] **Step 2: Run** `npx vitest run src/providers/soniox/lease.test.ts src/providers/soniox/adapter.test.ts` — FAIL: the new describe's cases and Task 5's case-3 comparisons that now expect `lease` (no port on the credentials yet); the adapter case passes on its own, a characterization.
- [ ] **Step 3: Implement** in `lease.ts`:
  - imports: `import type { SonioxCredentials, SonioxLeasePort, SonioxSettings } from './settings';`;
  - a constant under `DEFAULT_CONFLICT_RETRY_MS`:

    ```ts
    /** How close to the grant's end a bare 403 must come to be the grant ending, not a revoked key or a frozen wallet (the old `CUTOFF_MARGIN_MS`). The budget's own timer ends the run first unless timers were throttled. */
    export const GRANT_END_MARGIN_MS = 90_000;
    ```

  - after the `session.lease_acquired` frame, before the `return`:

    ```ts
    const accepted = new Set<SttRole>();
    const reportStarted = (role: SttRole): void => {
      // Once per role, and never once released: a late first frame from a
      // socket still closing must not start a lease the account already ended
      // (spec: no `session-started` after `session-end`).
      if (released || accepted.has(role)) return;
      accepted.add(role);
      ctx.frame({ direction: 'out', type: 'session.started', payload: { role } });
      // Not awaited, never failing the session: a refusal means the lease was
      // not extended, which the Logs must name (`ManagedSonioxSession.ts:490-549`).
      void doFetch(`${apiUrl()}/soniox/session-started`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaseId: grant.leaseId, role }),
      })
        .then(async (res) => {
          if (res.ok) return;
          let reason: string | null = null;
          try {
            const b = (await res.json()) as { reason?: unknown } | null;
            if (typeof b?.reason === 'string') reason = b.reason;
          } catch {
            // Not JSON: the status says the lease was not extended.
          }
          ctx.frame({ direction: 'in', type: 'session.started_refused', payload: { status: res.status, reason, role } });
        })
        .catch((error: unknown) => ctx.frame({ direction: 'in', type: 'session.notify_failed', payload: { step: 'session-started', message: describeCause(error) } }));
    };
    const ports = new Map<SttRole, SonioxLeasePort>([...bundles.keys()].map((role) => [role, {
      streamAccepted: () => reportStarted(role),
      atGrantEnd: (now: number) => now >= startedAt + totalMs - GRANT_END_MARGIN_MS,
      // Synchronously: the adapter's `closed` follows at once and must find the
      // run already ending (`run.ts` `onEvent`), or the run would end
      // `leg-closed` with "The provider ended the session."
      cutoff: () => endOnce(grantEnd),
    }]));
    ```

  - in `credentials`, `if (role) return { ...bundles.get(role)!, lease: ports.get(role)! };`; the shared participant's object stays without `lease` (its comment gains "and reports nothing: the speaker's port serves the mixed socket").
  - the module's header comment adds: "Each STT role's `SonioxLeasePort` (Plan A's seam, `settings.ts:95-102`) reports the first accepted frame as `session-started` and tells a grant-end 403 from an early one."
- [ ] **Step 4: Run** `npx vitest run src/providers/soniox src/providers/sessionSide.consistency.test.ts`, then the full suite and the gate. `lease.test.ts` imports the kit (`fakeSocket`) and `./testing`: a test file, so the kit rule holds; `adapter.ts` still reaches neither `lease.ts` nor the kit.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/soniox/lease.ts src/providers/soniox/lease.test.ts src/providers/soniox/adapter.test.ts
  ```

  ```bash
  git commit -q -F - -- src/providers/soniox/lease.ts src/providers/soniox/lease.test.ts src/providers/soniox/adapter.test.ts <<'EOF'
  feat(kizuna-soniox): the lease's port reports accepted streams and the grant's end

  Each transcription role's port posts session-started once, on the
  stream's first accepted frame, and nothing after the lease is released;
  a refusal or a failure reaches the Logs. A 403 within ninety seconds of
  the grant's end ends the run at once in the grant's words; an earlier
  one stays an auth failure. An error frame first never counts as
  accepted.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 7: The managed voice, claimed and listed (rulings 1, 10; choices 16, 17)

**Files:**
- Move (`git mv`), with their tests: `src/services/clients/ManagedVoicesClient.ts` → `src/providers/soniox/managedVoicesClient.ts`; `ManagedVoicesClient.test.ts` → `managedVoicesClient.test.ts`; `src/services/clients/managedVoicePolling.ts` → `src/providers/soniox/managedVoicePolling.ts`; `managedVoicePolling.test.ts` → `managedVoicePolling.test.ts`.
- Create (stubs, at the two old paths): `src/services/clients/ManagedVoicesClient.ts`, `src/services/clients/managedVoicePolling.ts`.
- Create: `src/providers/soniox/voicePrep.ts`, `voicePrep.test.ts` (ported copies), `voiceClaim.ts`, `voiceClaim.test.ts`, `managedVoiceSource.ts`, `managedVoiceSource.test.tsx`.
- Modify: `src/components/MainPanel/panel/startLabel.ts`, `startLabel.test.ts`.

**Interfaces:**
- **Consumes:** `SonioxVoicesError` (`./voicesClient`); `managedVoiceSource`, `VoiceLibrarySource` (`src/components/Settings/sections/voiceLibrarySource.ts`, read-only); `VoiceSourceHook` (`./SonioxVoiceField`); `sonioxVoiceField`, `SonioxSettings` (`./settings`); `loadVoiceClip`; `SONIOX_VOICES`, `SONIOX_DEFAULT_VOICE`; Task 1's `Prepared`, `RunShape`.
- **Produces:** `ManagedVoicesClient` and `managedVoicePollDelayMs` at their new paths (same exports); `prepareManagedVoice`, `VoicePrepFailure`, `VoicePrepResult`, `VoicePrepNoticeCode`, `voicePrepCode(reason)`, `resolveVoicePrepOutcome(result, stored, fallback): { sessionVoice; settingsPatch; notice: { code; message } | null }` (`voicePrep.ts`); `VoiceClaimDeps`, `createKizunaVoiceClaim(deps?)` (`voiceClaim.ts`); `useManagedVoiceSource: VoiceSourceHook`, `setManagedVoiceStandIn(source: VoiceLibrarySource | null): void` (`managedVoiceSource.ts`); `startLabel` names `'preparing'`.
- **Consumed by:** Task 8 (`createKizunaVoiceClaim`, `useManagedVoiceSource`), Task 9 (`setManagedVoiceStandIn` in the preview); the old client and UI through the stubs.

- [ ] **Step 1: Move the two modules and their tests.** One call each, from the worktree root:

  ```bash
  git mv src/services/clients/ManagedVoicesClient.ts src/providers/soniox/managedVoicesClient.ts
  ```

  and likewise `ManagedVoicesClient.test.ts` → `src/providers/soniox/managedVoicesClient.test.ts`, `managedVoicePolling.ts` → `src/providers/soniox/managedVoicePolling.ts`, `managedVoicePolling.test.ts` → `src/providers/soniox/managedVoicePolling.test.ts`.
- [ ] **Step 2: The stubs and the moved files' imports.**
  - `src/services/clients/ManagedVoicesClient.ts`: `export * from '../../providers/soniox/managedVoicesClient';`
  - `src/services/clients/managedVoicePolling.ts`: `export * from '../../providers/soniox/managedVoicePolling';`
  - Neither module has a default export, so `export *` carries everything, types included. No test mocks either old path (checked: `vi.mock(…ManagedVoicesClient…)` and `vi.mock(…managedVoicePolling…)` appear nowhere). Their importers stay as they are: `voiceLibrarySource.ts:16, 23`, `managedVoicePrep.ts:23, 25`, `KizunaAISonioxProviderConfig.ts:16`, `ProviderSpecificSettings.tsx:81`, and the tests `SonioxVoiceSection.test.tsx:8`, `voiceLibrarySource.test.ts:6`, `managedVoicePrep.test.ts:4`, `prepareToStart.kizunaSoniox.test.ts:41` (whose `instanceof ManagedVoicesClient` sees the same class through the stub).
  - `managedVoicesClient.ts`: `import { SonioxVoicesError } from './SonioxVoicesClient';` → `from './voicesClient';`; its `../../lib/soniox/regions` and `../../utils/environment` imports keep their spelling (`src/providers/soniox` is as deep as `src/services/clients`).
  - `managedVoicesClient.test.ts`: `from './ManagedVoicesClient'` → `from './managedVoicesClient'`, `from './SonioxVoicesClient'` → `from './voicesClient'`. `managedVoicePolling.test.ts`: `from './managedVoicePolling'` keeps its spelling.
- [ ] **Step 3: Port the claim routine.**

  ```bash
  cp src/services/providers/managedVoicePrep.ts src/providers/soniox/voicePrep.ts
  ```

  ```bash
  cp src/services/providers/managedVoicePrep.test.ts src/providers/soniox/voicePrep.test.ts
  ```

  Edits to `voicePrep.ts`:
  - after the header's first paragraph, add: "Ported from `src/services/providers/managedVoicePrep.ts` (Stage 2 Kizuna Soniox, ruling 1; the old copy stays for the old descriptor until Plan B2): the routine is unchanged; a failure now answers a notice **code** worded through `NOTICE_ALIASES` (choice 17)."; delete the line-22 comment (`// Moved beside its caller …`);
  - the imports become `import type { ManagedVoicesClient } from './managedVoicesClient';`, `import { SonioxVoicesError } from './voicesClient';`, `import { managedVoicePollDelayMs } from './managedVoicePolling';`, `import { reportError, describeCause } from '../../lib/diagnostics/report';`;
  - `voicePrepNotice` (`:207-233`) is replaced by

    ```ts
    /** A failed claim's notice code (Stage 2 Kizuna Soniox, ruling 11): each is worded by the sentence every locale already has, through `NOTICE_ALIASES`. */
    export type VoicePrepNoticeCode = 'voice_clip_missing' | 'voice_pool_busy' | 'voice_build_failed' | 'voice_unavailable';

    export function voicePrepCode(reason: VoicePrepFailure): VoicePrepNoticeCode {
      switch (reason) {
        case 'clip_required': return 'voice_clip_missing';
        case 'pool_exhausted': return 'voice_pool_busy';
        case 'voice_failed': return 'voice_build_failed';
        case 'unavailable':
        default: return 'voice_unavailable';
      }
    }
    ```

  - `VoicePrepOutcome.notice` becomes `/** The notice to record once the session is up, or null on success. */ notice: { code: VoicePrepNoticeCode; message: string } | null;`, and `resolveVoicePrepOutcome`'s failure branch returns `notice: { code: voicePrepCode(result.reason), message: \`The custom voice could not be prepared (${result.reason}); this session uses a built-in voice.\` }`; its doc comment's "the `t()` translation of `notice` happens in the hook itself" becomes "the notice is worded by the surface, from its code".

  Edits to `voicePrep.test.ts`: line 2 → `import { prepareManagedVoice, resolveVoicePrepOutcome, voicePrepCode } from './voicePrep';`; line 3 → `from './voicesClient'`; line 4 → `from './managedVoicesClient'`; the `describe('voicePrepNotice')` block (`:328-337`) is replaced by:

  ```ts
  describe('voicePrepCode and resolveVoicePrepOutcome', () => {
    it('gives every failure its own code', () => {
      expect((['clip_required', 'pool_exhausted', 'voice_failed', 'unavailable'] as const).map(voicePrepCode))
        .toEqual(['voice_clip_missing', 'voice_pool_busy', 'voice_build_failed', 'voice_unavailable']);
    });

    it('uses a rebuilt voice and writes it back only when its id changed', () => {
      expect(resolveVoicePrepOutcome({ ok: true, voiceId: 'v2' }, 'v1', 'Adrian')).toEqual({ sessionVoice: 'v2', settingsPatch: { voice: 'v2' }, notice: null });
      expect(resolveVoicePrepOutcome({ ok: true, voiceId: 'v1' }, 'v1', 'Adrian')).toEqual({ sessionVoice: 'v1', settingsPatch: null, notice: null });
    });

    it('falls back to the built-in voice for this session only, with the notice code', () => {
      expect(resolveVoicePrepOutcome({ ok: false, reason: 'pool_exhausted' }, 'v1', 'Adrian')).toEqual({
        sessionVoice: 'Adrian', settingsPatch: null,
        notice: { code: 'voice_pool_busy', message: 'The custom voice could not be prepared (pool_exhausted); this session uses a built-in voice.' },
      });
    });
  });
  ```

- [ ] **Step 4: Write the failing tests for the claim, the voice source and the label.**
  - `voiceClaim.test.ts` — the eight behaviours of `prepareToStart.kizunaSoniox.test.ts`, over stubs:

    ```ts
    import { describe, it, expect, vi } from 'vitest';
    import type { LegName } from '../../lib/conversation/types';
    import type { RunShape } from '../../lib/session/types';
    import type { ManagedVoicesClient } from './managedVoicesClient';
    import { SONIOX_DEFAULTS, type SonioxSettings } from './settings';
    import { createKizunaVoiceClaim } from './voiceClaim';
    import type { prepareManagedVoice } from './voicePrep';

    const shapeFor = (legs: LegName[], textOnly = false): RunShape => ({
      provider: {} as RunShape['provider'], settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' }, legs,
      turnMode: 'auto', textOnly, participantSpeech: false, keepReplayAudio: true,
      shared: { instructions: () => '', pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
      auth: { signedIn: true, userId: 'u1', getToken: vi.fn(async () => 'tok') },
    });
    const live = () => new AbortController().signal;

    function claim(result: Awaited<ReturnType<typeof prepareManagedVoice>> = { ok: true, voiceId: 'clone-1' }) {
      const client = {} as ManagedVoicesClient;
      const deps = {
        prepare: vi.fn(async (_d: Parameters<typeof prepareManagedVoice>[0]) => result),
        clientFor: vi.fn(() => client),
        loadClip: vi.fn(async () => null),
      };
      return { deps, client, run: createKizunaVoiceClaim(deps) };
    }
    const s = (patch: Partial<SonioxSettings>): SonioxSettings => ({ ...SONIOX_DEFAULTS, ...patch });
    ```

    Cases:
    1. **"claims nothing without a speaking speaker"** — `run(shapeFor(['participant']), s({ voice: 'clone-1' }), live())` and `run(shapeFor(['speaker'], true), …)` resolve `{}`; `deps.prepare` never called.
    2. **"claims nothing for a built-in or empty voice"** — `s({ voice: 'Adrian' })` and `s({ voice: '' })` → `{}`; `prepare` not called.
    3. **"claims the region's own voice, in that region, for this account, with the run's signal"** — `s({ region: 'eu', voice: 'clone-us', voiceEu: 'clone-eu' })`: `clientFor` called with a function and `'eu'`; calling that function calls `shape.auth.getToken`; `prepare`'s argument has `client` (the stub) and the signal passed; calling its `loadClip()` calls `deps.loadClip` with `'u1'`.
    4. **"uses and writes back a rebuilt clone, under the region's field"** — result `{ ok: true, voiceId: 'clone-2' }`, stored `voiceEu: 'clone-eu'`, region `eu` → `{ override: { voiceEu: 'clone-2' }, persist: { voiceEu: 'clone-2' } }`.
    5. **"changes nothing for a warm clone"** — result `{ ok: true, voiceId: 'clone-eu' }` → `{}`.
    6. **"falls back to the built-in voice for this run, with the reason's code"** — for each of `clip_required`, `pool_exhausted`, `voice_failed`, `unavailable`: `{ override: { voiceEu: 'Adrian' }, notice: { code: 'voice_clip_missing' | 'voice_pool_busy' | 'voice_build_failed' | 'voice_unavailable', message: expect.any(String) } }`, never `persist`.
    7. **"applies nothing when the start was cancelled during the claim"** — `prepare` resolves after `controller.abort()` → `{}`.
    8. **"the claim's own routine by default"** — `createKizunaVoiceClaim()` is a function (the defaults are `prepareManagedVoice`, `new ManagedVoicesClient`, `loadVoiceClip`; not called here).
  - `managedVoiceSource.test.tsx`:
    1. **"no source while signed out"** — `renderHook(() => useManagedVoiceSource({ credentials: {}, auth: { signedIn: false, getToken } }, 'us'))` → `null`; `account` undefined → `null`.
    2. **"one source per account and region, filed under the account"** — one `getToken` function; signed in `userId: 'u1'`, `'us'` → a source whose `cacheNamespace` is `'managed:us'`; `rerender` with a new `account` object of the same user and the same `getToken` → the same object; region `'eu'` → a new one, `cacheNamespace` `'managed:eu'`; `userId: 'u2'` → a new one.
    3. **"the preview's stand-in replaces it, and nothing calls the backend"** — `vi.stubGlobal('fetch', vi.fn())`; `const standIn = { list: async () => [], create: vi.fn(), delete: vi.fn(), waitUntilReady: vi.fn(), canPreview: false }`; `setManagedVoiceStandIn(standIn)` → signed in → the hook answers `standIn`; `await standIn.list()`; `fetch` never called; signed out → still `null`; `afterEach` resets `setManagedVoiceStandIn(null)` and `vi.unstubAllGlobals()`.
  - `startLabel.test.ts`: **"names the voice claim while preparing, on both sites"** — `{ phase: 'starting', step: 'preparing' }` → `'Preparing your voice…'` for `'basic'` and `'advanced'`.
- [ ] **Step 5: Run** `npx vitest run src/providers/soniox src/components/MainPanel/panel/startLabel.test.ts` — FAIL (no `voiceClaim.ts`, no `managedVoiceSource.ts`, no label).
- [ ] **Step 6: Implement.**
  - `voiceClaim.ts`, in full:

    ```ts
    /**
     * Kizuna Soniox's `prepare` (survey §1.9, §2.3): before a speaking
     * session, claim the account's cloned voice in the region the session runs
     * in — the backend runs Soniox's voice quota as an LRU cache, so a voice
     * chosen days ago may be gone — rebuilding it from this device's clip when
     * it must. Ported from `KizunaAISonioxProviderConfig.prepareToStart`
     * (read-only until Plan B2). It never refuses a start: a claim that fails
     * runs this session on the built-in voice, says why once the session is up,
     * and leaves the stored choice alone. The routine's sleeps run on the real
     * clock, injectable for tests (ruling 10).
     */
    import type { Prepared, RunShape } from '../../lib/session/types';
    import { asSonioxRegion, type SonioxRegion } from '../../lib/soniox/regions';
    import { SONIOX_DEFAULT_VOICE, SONIOX_VOICES } from '../../lib/soniox/ttsCatalog';
    import { loadVoiceClip } from '../../lib/soniox/voiceClipStorage';
    import { ManagedVoicesClient } from './managedVoicesClient';
    import { sonioxVoiceField, type SonioxSettings } from './settings';
    import { prepareManagedVoice, resolveVoicePrepOutcome } from './voicePrep';

    export interface VoiceClaimDeps {
      /** The claim routine; `prepareManagedVoice` by default. */
      prepare?: typeof prepareManagedVoice;
      /** The voices client for the run's region; `new ManagedVoicesClient(getToken, region)` by default. */
      clientFor?(getToken: () => Promise<string | null>, region: SonioxRegion): ManagedVoicesClient;
      /** This device's reference clip, filed under an account; `loadVoiceClip` by default. */
      loadClip?(userId: string | null | undefined): Promise<Blob | null>;
    }

    const BUILT_IN = new Set(SONIOX_VOICES.map((v) => v.value));

    export function createKizunaVoiceClaim(deps: VoiceClaimDeps = {}) {
      const prepare = deps.prepare ?? prepareManagedVoice;
      const clientFor = deps.clientFor ?? ((getToken, region) => new ManagedVoicesClient(getToken, region));
      const loadClip = deps.loadClip ?? loadVoiceClip;

      return async function claimVoice(shape: RunShape, s: SonioxSettings, signal: AbortSignal): Promise<Prepared<SonioxSettings>> {
        // The speaker's voice, when it speaks: the participant's speech ships off (ruling 2), and turning it on revisits this (the checklist's item 5).
        if (!shape.legs.includes('speaker') || shape.textOnly) return {};
        const region = asSonioxRegion(s.region);
        // A clone is a UUID inside one region's project: that region's own field.
        const field = sonioxVoiceField(region);
        const voice = s[field];
        if (!voice || BUILT_IN.has(voice)) return {};
        const result = await prepare({
          client: clientFor(() => shape.auth.getToken(), region),
          // This account's clip only: a recording on a shared device is never uploaded under another account.
          loadClip: () => loadClip(shape.auth.userId),
          signal,
        });
        // The start this claim belonged to is gone: nothing to apply.
        if (signal.aborted) return {};
        const outcome = resolveVoicePrepOutcome(result, voice, SONIOX_DEFAULT_VOICE);
        const patch = { [field]: outcome.sessionVoice } as Partial<SonioxSettings>;
        // This run only: the stored choice stays, so the next start tries the clone again.
        if (outcome.notice) return { override: patch, notice: outcome.notice };
        // A rebuilt clone has a new id: the run uses it, and it is written back where the stored choice is still the one claimed (`persistIfUnchanged`).
        return outcome.settingsPatch ? { override: patch, persist: patch } : {};
      };
    }
    ```

  - `managedVoiceSource.ts`, in full:

    ```ts
    /**
     * Kizuna Soniox's voice library source (survey §2.7): the account's one
     * cached voice, through our backend. One source per account and region —
     * keyed on the user and the account's `getToken`, which
     * `ProviderOwnSettings` keeps stable per account — so an account switch
     * mints a new one and the section reloads (the old memo's rule,
     * `ProviderSpecificSettings.tsx:273-289`). None while signed out.
     */
    import { useMemo } from 'react';
    import { managedVoiceSource, type VoiceLibrarySource } from '../../components/Settings/sections/voiceLibrarySource';
    import { ManagedVoicesClient } from './managedVoicesClient';
    import type { VoiceSourceHook } from './SonioxVoiceField';

    let standIn: VoiceLibrarySource | null = null;

    /** The development preview's stand-in (choice 15): its `&signedin=1` sign-in is not real, so no source may call the backend with it. Never set in the app. */
    export function setManagedVoiceStandIn(source: VoiceLibrarySource | null): void {
      standIn = source;
    }

    export const useManagedVoiceSource: VoiceSourceHook = (account, region) => {
      const userId = account?.auth.signedIn ? account.auth.userId ?? null : null;
      const getToken = account?.auth.getToken;
      return useMemo(() => {
        if (!userId || !getToken) return null;
        if (standIn) return standIn;
        return managedVoiceSource(new ManagedVoicesClient(getToken, region), userId);
      }, [userId, getToken, region]);
    };
    ```

  - `startLabel.ts`: before the final `return`:

    ```ts
    // The provider's `prepare` (Kizuna Soniox's voice claim): today's "Preparing your voice…" (`initPhaseLabel`), for any provider's prepare (choice 16).
    if (run.step === 'preparing') {
      return site === 'basic'
        ? t('simplePanel.preparingVoice', 'Preparing your voice…')
        : t('mainPanel.preparingVoice', 'Preparing your voice…');
    }
    ```

- [ ] **Step 7: Run** `npx vitest run src/providers src/services src/components/Settings src/components/MainPanel`, then the full suite and the gate. What stays green and why:
  - `src/services/**`: the old descriptor, `managedVoicePrep.ts` and their tests import the old paths, which the stubs keep;
  - `voiceLibrarySource.ts` / `.test.ts` and `SonioxVoiceSection.test.tsx`: type and value imports through the stubs;
  - the moved tests: their relative imports re-pointed; `vi.stubGlobal('fetch')` as before;
  - `voicePrep.test.ts`: the ported cases unchanged but its last describe;
  - `sessionSide.consistency.test.ts`: `adapter.ts` reaches none of the new modules; `managedVoiceSource.ts` is a React hook on the settings side;
  - `consoleLedger.consistency.test.ts`: no module here calls `console.*`;
  - the gate now covers `src/services/clients/managedVoicePolling.ts` (a stub) and the old importers' tests: they compile.
- [ ] **Step 8: Commit.** The `git mv`s staged the renames. `git add` takes the stubs and the new files (never the old test paths, which no longer exist); the commit's pathspec names the old test paths too, so their moves are in it:

  ```bash
  git add src/services/clients/ManagedVoicesClient.ts src/services/clients/managedVoicePolling.ts src/providers/soniox/managedVoicesClient.ts src/providers/soniox/managedVoicesClient.test.ts src/providers/soniox/managedVoicePolling.ts src/providers/soniox/managedVoicePolling.test.ts src/providers/soniox/voicePrep.ts src/providers/soniox/voicePrep.test.ts src/providers/soniox/voiceClaim.ts src/providers/soniox/voiceClaim.test.ts src/providers/soniox/managedVoiceSource.ts src/providers/soniox/managedVoiceSource.test.tsx src/components/MainPanel/panel/startLabel.ts src/components/MainPanel/panel/startLabel.test.ts
  ```

  ```bash
  git commit -q -F - -- src/services/clients/ManagedVoicesClient.ts src/services/clients/ManagedVoicesClient.test.ts src/services/clients/managedVoicePolling.ts src/services/clients/managedVoicePolling.test.ts src/providers/soniox/managedVoicesClient.ts src/providers/soniox/managedVoicesClient.test.ts src/providers/soniox/managedVoicePolling.ts src/providers/soniox/managedVoicePolling.test.ts src/providers/soniox/voicePrep.ts src/providers/soniox/voicePrep.test.ts src/providers/soniox/voiceClaim.ts src/providers/soniox/voiceClaim.test.ts src/providers/soniox/managedVoiceSource.ts src/providers/soniox/managedVoiceSource.test.tsx src/components/MainPanel/panel/startLabel.ts src/components/MainPanel/panel/startLabel.test.ts <<'EOF'
  feat(kizuna-soniox): the managed voice is claimed before a session and listed in Settings

  The managed voices client and its poll schedule move beside Soniox, the
  old paths re-exporting them; the claim routine is ported, answering
  notice codes. Kizuna Soniox's prepare claims the region's cloned voice
  for this account, uses a rebuilt clone and writes it back, or falls back
  to the built-in voice for the run with the reason's code. The settings'
  voice source is one per account and region, with a stand-in the preview
  can set. The start button names the claim while it runs.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Group check A (controller)

After Wave 3 (Tasks 1–7). The runner's order, the gate's floor, the participant-speech flag's readers, the lease and the voice are in; Kizuna Soniox is not registered.

1. The full gates: `npx vitest run src` (0 failed, no unhandled errors) and the typecheck gate (the 18 baseline lines).
2. The old suites by name: `npx vitest run src/services src/components/Settings` — green (ruling 1: the two stubs).
3. Both release builds; `npx vitest run extension`; the three D24 greps print nothing.
4. The full tree's typecheck — `npx tsc --noEmit -p tsconfig.json` written to `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/kizuna-groupA-tsc.txt`, counted with `command grep -c 'error TS'` — is at most 259. A rise means something outside the gate broke (an old importer of a moved module).
5. **The leased fake in the preview**, on a fresh vite, through `scripts/dev/headless.mjs`, screenshots under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`: `/?preview=spine&panel=1&provider=fake_leased&signedin=1&settings=advanced`.
   - "Prepare answers with a fallback" on → Start → the button reads "Preparing your voice…" for a moment (Task 7), then the session runs with the fallback notice.
   - "Acquire refuses (insufficient balance)" on → Start → the idle line reads "Insufficient balance to start a session. Please top up your balance and try again." (`insufficient_balance`, already aliased) and the previous conversation stays on screen (choice 3).
   - "Minimum balance" 1000 with no wallet (the preview has none) → Start stays on (ruling 5: an unknown balance gates nothing).
   - Every existing spine probe and `app-panel-probe` (preview, `--settings`) — green: the fake has no lease and no `startBoth`, so its order is the old one.

---

### Task 8: Kizuna Soniox, registered first, its participant speech behind a flag; its words (rulings 2, 6, 11; choices 10, 11, 17, 19)

**Files:**
- Create: `src/providers/soniox/kizuna.ts`, `src/providers/soniox/kizuna.test.ts`, `src/providers/soniox/kizunaParticipantSpeech.test.tsx`.
- Modify: `src/providers/registry.ts`, `src/providers/registry.test.ts`, `src/providers/localInference/provider.test.ts`, `src/lib/view/noticeText.ts`, `src/lib/view/noticeText.test.ts`, `src/lib/view/noticeTargets.ts`, `src/lib/view/noticeTargets.test.ts`, `src/app/loadStores.test.ts`.

**Interfaces:**
- **Consumes:** `managed` (Task 1); `contextsFor` and `ParticipantSpeechSwitch` as Task 4 left them; `createKizunaLease`, `kizunaSonioxMinimumBalance`, `PARTICIPANT_SPEECH_FIELD` (Tasks 5–6); `createKizunaVoiceClaim`, `useManagedVoiceSource` (Task 7); `sonioxProvider`, `createSonioxSettingsView`, `createSonioxAdapter` and the Soniox test kit (`./testing`) (Plan A); `kizunaHostedIcon`, `SonioxIcon` (`src/components/Icons/ProviderIcons`).
- **Produces:** `KIZUNA_PARTICIPANT_SPEECH = false` (ruling 2's one flag); `createKizunaSonioxProvider({ participantSpeech }: { participantSpeech: boolean })`; `kizunaSonioxProvider: Provider<SonioxSettings, SonioxCredentials, SonioxConfig, ManagedSignIn> & { id: 'kizunaai_soniox' }`, built with the flag; `KizunaSonioxSettingsView`; `ProviderId` gains `'kizunaai_soniox'`; `RELEASED` = `[kizunaSonioxProvider, localInferenceProvider, sonioxProvider]`; eight `NOTICE_ALIASES` rows; `NOTICE_TARGETS.sign_in_required`.
- **Consumed by:** Tasks 9–12 (the registered provider), the app's picker, Settings, readiness driver and runner — generic code that now offers it.

- [ ] **Step 1: Write the failing tests.**
  - `kizuna.test.ts`:
    1. **"is Kizuna AI's Soniox: managed, under the old enum's id and slice, with no guide"** — `kizunaSonioxProvider` matches `{ id: 'kizunaai_soniox', kind: 'managed', vendor: 'Soniox', platforms: ['electron', 'extension', 'web'], participantSpeech: false }`; `guideUrl`, `flagged`, `i18nKey` undefined; `settings` equals `{ key: 'kizunaSoniox', defaults: SONIOX_DEFAULTS, migrate: migrateSonioxSettings }`; `icon` is a function.
    2. **"reads the sign-in and checks nothing"** — `read({}, { signedIn: false, getToken })` → `{ missing: 'Sign in to use Kizuna AI Soniox.', code: 'sign_in_required' }`; `{ signedIn: true, loaded: false, … }` → `code: 'sign_in_pending'`; signed in → `{ signedIn: true }`; `check` resolves `{ ok: true }` with a stubbed `fetch` never called.
    3. **"is Soniox's languages, capabilities, builder, adapter and turn detection"** — `languages`, `speech`, `textInput`, `boundaries`, `turns`, `build`, `describe`, `start`, `TurnDetection` each `toBe` `sonioxProvider`'s; `session.startBoth` `toBe` `sonioxProvider.session!.startBoth`.
    4. **"adds the voice claim, the lease and the floor"** — `session.prepare`, `session.acquire` are functions; `session.minimumBalance!({ legs: ['speaker', 'participant'], textOnly: false, participantSpeech: true }, { ...SONIOX_DEFAULTS, bothModeSharedSession: false })` is `60_000` (the flag is off: the participant's wish prices nothing); `KIZUNA_PARTICIPANT_SPEECH` is `false`.
    5. **"its Settings is Soniox's view in the managed flavour"** — `Settings` is `KizunaSonioxSettingsView`, not `SonioxSettingsView`.
    6. **"runs through the runner: its lease mints, the budget shows, and Stop releases it"** — a stand-in adapter keeps sockets out: `const provider = { ...kizunaSonioxProvider, build: fakeProvider.build, describe: fakeProvider.describe, start: fakeProvider.start, session: { ...kizunaSonioxProvider.session, startBoth: undefined } } as AnyProvider;` settings `{ ...FAKE_DEFAULTS, ...SONIOX_DEFAULTS }` (the claim skips the built-in `Adrian`); `vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/soniox/session-key') ? new Response(JSON.stringify({ leaseId: 'lease-1', clientReferenceId: 'ref-spk_stt', region: 'us', maxSessionDurationSeconds: 600, streams: [{ role: 'spk_stt', apiKey: 'k1', clientReferenceId: 'ref-spk_stt' }, { role: 'spk_tts', apiKey: 'k2', clientReferenceId: 'ref-spk_tts' }] }), { status: 200 }) : new Response(JSON.stringify({ ok: true }), { status: 200 })))`; a runner on a virtual clock (`platform: 'electron'`, the fake source, `frames: { frame: vi.fn() }`, a signed-in `auth`) → `runner.start()` → running with `budget: { totalMs: 600_000, endsAt: 600_000 }`; `frames.frame` called with `'speaker'` and an object of `type: 'session.lease_acquired'`; `runner.stop()` → `fetch` called with a URL ending `/soniox/session-end` and `expect.objectContaining({ keepalive: true, body: JSON.stringify({ leaseId: 'lease-1' }) })`. `afterEach(() => vi.unstubAllGlobals())`.
  - `kizunaParticipantSpeech.test.tsx` — ruling 2 end to end: the shipped definition (flag off) against a test-only twin from the same factory (flag on). No network (ruling 12): the lease runs over a stubbed global `fetch`, the adapter over `FakeSocket`. In full:

    ```tsx
    /**
     * Kizuna Soniox's participant speech, built end to end and shipped off
     * (Stage 2 Kizuna Soniox, ruling 2): the shipped definition against a
     * test-only twin with the flag on, through the switch, the leg's
     * context, the session-key body, the floors, and the lease's keys into
     * the adapter in split Both, shared Both and participant-only.
     */
    import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
    import { render, screen } from '@testing-library/react';

    vi.mock('../../services/ServiceFactory', () => ({
      ServiceFactory: {
        getSettingsService: () => ({
          getSetting: async (_key: string, def: unknown) => def,
          setSetting: async () => ({ success: true }),
        }),
      },
    }));
    vi.mock('react-i18next', async (importOriginal) => {
      const actual = await importOriginal<typeof import('react-i18next')>();
      return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
    });
    const tooltips = vi.hoisted(() => [] as unknown[]);
    vi.mock('../../components/Tooltip/Tooltip', () => ({
      default: ({ content }: { content: unknown }) => {
        tooltips.push(content);
        return null;
      },
    }));
    // The switch finds the selected provider in the registry: a test can stand the flag-on twin in for the shipped one.
    const standIn = vi.hoisted(() => ({ provider: null as unknown }));
    vi.mock('../registry', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../registry')>();
      return { ...actual, getProvider: (id: string) => (id === 'kizunaai_soniox' && standIn.provider ? standIn.provider : actual.getProvider(id)) };
    });

    import { ParticipantSpeechSwitch } from '../../components/Settings/sections/ParticipantSpeechSwitch';
    import type { StartRequest } from '../../lib/contract/adapter';
    import { createVirtualClock } from '../../lib/contract/clock';
    import { recordEvents } from '../../lib/contract/events';
    import { flush } from '../../lib/contract/testing/drive';
    import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
    import type { LegName } from '../../lib/conversation/types';
    import type { AnyProvider } from '../../lib/provider/types';
    import { contextsFor } from '../../lib/session/shape';
    import type { LeaseContext, RunShape } from '../../lib/session/types';
    import { useProviderStore } from '../../stores/providerStore';
    import { useRoutingStore } from '../../stores/routingStore';
    import { createSonioxAdapter } from './adapter';
    import type { SonioxConfig } from './config';
    import { createKizunaSonioxProvider, kizunaSonioxProvider } from './kizuna';
    import { PARTICIPANT_SPEECH_FIELD } from './leaseRequest';
    import { SONIOX_DEFAULTS, type SonioxCredentials, type SonioxSettings } from './settings';
    import { END, isStt, msg, orig, SHARED, tr, type Json } from './testing';

    const speaking = createKizunaSonioxProvider({ participantSpeech: true });

    let answer: unknown = null;
    const bodies: string[] = [];
    beforeEach(() => {
      bodies.length = 0;
      tooltips.length = 0;
      standIn.provider = null;
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/soniox/session-key')) {
          bodies.push(String(init?.body));
          return new Response(JSON.stringify(answer), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }));
    });
    afterEach(() => vi.unstubAllGlobals());

    const grantOf = (roles: string[]) => ({
      leaseId: 'lease-1', clientReferenceId: `ref-${roles[0]}`, region: 'us', maxSessionDurationSeconds: 600,
      streams: roles.map((role) => ({ role, apiKey: `k-${role}`, clientReferenceId: `ref-${role}` })),
    });

    /** A start the user wants the participant to speak in: the flag decides whether it does. */
    function shapeFor(provider: AnyProvider, legs: LegName[], shared: boolean): { shape: RunShape; s: SonioxSettings } {
      const s: SonioxSettings = { ...SONIOX_DEFAULTS, bothModeSharedSession: shared };
      return {
        s,
        shape: {
          provider, settings: s, credentials: {}, pair: { source: 'en', target: 'ja' }, legs, turnMode: 'auto', textOnly: false,
          participantSpeech: true, keepReplayAudio: true, shared: SHARED,
          auth: { signedIn: true, userId: 'u1', getToken: async () => 'tok' },
        },
      };
    }

    /** The lease minted over the stub, then the adapter started on its keys, every socket opened. */
    async function run(provider: AnyProvider, legs: LegName[], shared: boolean, roles: string[]) {
      answer = grantOf(roles);
      const { shape, s } = shapeFor(provider, legs, shared);
      const clock = createVirtualClock(0);
      const signal = new AbortController().signal;
      const ctx: LeaseContext = { signal, clock, end: vi.fn(), frame: vi.fn() };
      const lease = await provider.session!.acquire!(shape, s, ctx);
      const contexts = contextsFor(shape);
      const sockets = fakeSockets();
      const adapter = createSonioxAdapter({ openSocket: sockets.create });
      const rec = { speaker: recordEvents(), participant: recordEvents() };
      const request = (leg: LegName): StartRequest<SonioxConfig, SonioxCredentials> => ({
        context: contexts[leg]!, config: provider.build(contexts[leg]!, s, SHARED) as SonioxConfig,
        credentials: lease.credentials(leg) as SonioxCredentials, clock, signal,
      });
      const starting = legs.length === 2
        ? adapter.startBoth({ speaker: request('speaker'), participant: request('participant') }, { speaker: rec.speaker.events, participant: rec.participant.events })
        : adapter.start(request(legs[0]), rec[legs[0]].events);
      for (const x of sockets.all) if (x.readyState === FakeSocket.CONNECTING) x.open();
      await starting;
      await flush();
      return { contexts, lease, stt: sockets.all.filter(isStt), tts: sockets.all.filter((x) => !isStt(x)), rec };
    }
    type Ran = Awaited<ReturnType<typeof run>>;

    /** One utterance the participant said ('ja'), and its translation: the participant's STT socket is the last one (split: the second; else the only one). */
    function participantSays(r: Ran): void {
      r.stt[r.stt.length - 1].receive(msg({ ...orig('Ohayō.'), language: 'ja' }, tr('Good morning.', 'en', 'ja'), END));
    }
    const sentWithKey = (r: Ran, key: string) => r.tts.flatMap((x) => x.sentJson<Json>()).filter((m) => m.api_key === key);
    const degraded = (r: Ran) => r.rec.participant.log.filter((e) => e.kind === 'degraded');

    describe('the switch', () => {
      it('shipped, the flag off: off and disabled with the "not yet" tooltip, the stored choice kept', () => {
        useRoutingStore.setState({ participantSpeech: true });
        useProviderStore.setState({ selected: 'kizunaai_soniox' });
        render(<ParticipantSpeechSwitch locked={false} />);
        const sw = screen.getByRole('switch');
        expect(sw.getAttribute('aria-checked')).toBe('false');
        expect(sw.getAttribute('aria-disabled')).toBe('true');
        expect(tooltips).toContain('audioPanel.participantSpeechNotYetAvailable');
        expect(useRoutingStore.getState().participantSpeech).toBe(true);
      });

      it('the flag on: enabled, following the stored choice', () => {
        standIn.provider = speaking;
        useRoutingStore.setState({ participantSpeech: true });
        useProviderStore.setState({ selected: 'kizunaai_soniox' });
        render(<ParticipantSpeechSwitch locked={false} />);
        const sw = screen.getByRole('switch');
        expect(sw.getAttribute('aria-checked')).toBe('true');
        expect(sw.getAttribute('aria-disabled')).not.toBe('true');
        expect(tooltips).toContain('audioPanel.participantSpeechDesc');
      });
    });

    describe('the flag off (as shipped)', () => {
      it('the participant leg asks for no speech, and the body is today\'s, with no field', async () => {
        const r = await run(kizunaSonioxProvider, ['speaker', 'participant'], false, ['spk_stt', 'spk_tts', 'par_stt']);
        expect(r.contexts.participant?.speech).toBe(false);
        expect(bodies).toEqual(['{"mode":"both","textOnly":false,"bothSplit":true,"region":"us"}']);
        expect(JSON.parse(bodies[0])).not.toHaveProperty(PARTICIPANT_SPEECH_FIELD);
      });

      it.each([
        ['split Both', ['speaker', 'participant'] as LegName[], false, ['spk_stt', 'spk_tts', 'par_stt', 'par_tts'], 1],
        ['shared Both', ['speaker', 'participant'] as LegName[], true, ['mix_stt', 'mix_tts', 'par_tts'], 1],
        ['participant only', ['participant'] as LegName[], true, ['par_stt', 'par_tts'], 0],
      ])('%s: a stray par_tts is ignored, and the participant stays text-only', async (_name, legs, shared, roles, ttsSockets) => {
        const r = await run(kizunaSonioxProvider, legs, shared, roles);
        expect(r.lease.credentials('participant')).not.toHaveProperty('tts');
        expect(r.tts).toHaveLength(ttsSockets);
        participantSays(r);
        expect(sentWithKey(r, 'k-par_tts')).toEqual([]);
        expect(degraded(r)).toEqual([]);
      });

      it("the floor prices no participant speech", () => {
        expect(kizunaSonioxProvider.session!.minimumBalance!({ legs: ['speaker', 'participant'], textOnly: false, participantSpeech: true }, { ...SONIOX_DEFAULTS, bothModeSharedSession: false })).toBe(60_000);
      });
    });

    describe('the flag on (a test-only twin from the same factory)', () => {
      it('the participant leg asks for speech, and the body carries the field', async () => {
        const r = await run(speaking, ['speaker', 'participant'], false, ['spk_stt', 'spk_tts', 'par_stt', 'par_tts']);
        expect(r.contexts.participant?.speech).toBe(true);
        expect(JSON.parse(bodies[0])).toEqual({ mode: 'both', textOnly: false, bothSplit: true, region: 'us', [PARTICIPANT_SPEECH_FIELD]: true });
      });

      it.each([
        ['split Both', ['speaker', 'participant'] as LegName[], false, ['spk_stt', 'spk_tts', 'par_stt', 'par_tts'], 2],
        ['shared Both', ['speaker', 'participant'] as LegName[], true, ['mix_stt', 'mix_tts', 'par_tts'], 2],
        ['participant only', ['participant'] as LegName[], true, ['par_stt', 'par_tts'], 1],
      ])('%s: a par_tts answer makes the participant speak, on its own TTS socket and key', async (_name, legs, shared, roles, ttsSockets) => {
        const r = await run(speaking, legs, shared, roles);
        expect(r.lease.credentials('participant')).toMatchObject({ tts: 'k-par_tts' });
        expect(r.tts).toHaveLength(ttsSockets);
        participantSays(r);
        expect(sentWithKey(r, 'k-par_tts')).toEqual([expect.objectContaining({ api_key: 'k-par_tts', language: 'en' })]);
        expect(degraded(r)).toEqual([]);
      });

      it('an answer with no par_tts leaves the participant text-only, saying tts_degraded once', async () => {
        const r = await run(speaking, ['speaker', 'participant'], false, ['spk_stt', 'spk_tts', 'par_stt']);
        expect(r.lease.credentials('participant')).not.toHaveProperty('tts');
        expect(degraded(r)).toEqual([expect.objectContaining({ payload: expect.objectContaining({ code: 'tts_degraded' }) })]);
      });

      it("the floors count the participant's speech stream", () => {
        const floor = (legs: LegName[], shared: boolean) => speaking.session!.minimumBalance!({ legs, textOnly: false, participantSpeech: true }, { ...SONIOX_DEFAULTS, bothModeSharedSession: shared });
        expect(floor(['speaker', 'participant'], false)).toBe(83_334);
        expect(floor(['speaker', 'participant'], true)).toBe(65_000);
        expect(floor(['participant'], true)).toBe(41_667);
      });
    });
    ```

    Two things this spec reads that the implementer checks against Plan A's code before relying on them, stopping to report if either differs: a participant's TTS config frame carries `api_key` and `language` (as `adapter.both.test.ts:219` shows for shared Both); and in shared Both an utterance whose `language` is the participant's source (`'ja'`) goes to the participant with no energy history (the side tracker's language fallback, as `adapter.both.test.ts:215-216` drives it).

  - `registry.test.ts`, "the release offers its providers in the owner's order": `toEqual(['kizunaai_soniox', 'localInference', 'soniox'])`, its comment naming ruling 6 (Kizuna Soniox first, unflagged; the owner's 2026-09-12 product order put the managed provider first). Every invariant in "the invariants every provider meets (F17)" now runs over Kizuna Soniox too: the old enum's id and slice (`kizunaai_soniox` → `kizunaSoniox`), the `en` name and description (`providers.kizunaai_soniox`), "a managed provider has no credential field and reads from the sign-in", `migrate(defaults) = defaults`, the initial pair offered. "a release build offers no flagged provider and, without the umbrella, no managed one" holds: Kizuna Soniox is managed.
  - `localInference/provider.test.ts`: its case "is first in the registry, in UI order" (`:95-97`, `expect(PROVIDERS[0]).toBe(localInferenceProvider)`) becomes the order pin ruling 6 decided — **"follows Kizuna Soniox in the registry (Stage 2 Kizuna Soniox, ruling 6)"**: `expect(PROVIDERS.slice(0, 2).map((p) => p.id)).toEqual(['kizunaai_soniox', 'localInference'])`.
  - `noticeText.test.ts`: **"words Kizuna Soniox's codes with the sentences every locale already has"** — for each of the eight new aliases, `at(enCatalog, NOTICE_ALIASES[code])` is the `en` sentence: `soniox_service_unavailable` "Soniox is temporarily unavailable. Please try again in a moment.", `soniox_service_busy` "Soniox is at capacity right now. Please try again shortly.", the four `voice_*` codes their four sentences (`mainPanel.sonioxVoiceClipMissing`, `…VoicePoolBusy`, `…VoiceBuildFailed`, `…VoiceUnavailable`, copied word for word from `en`), `balance_below_floor` "Insufficient balance: {{balance}}", `sign_in_pending` "Checking..."; and `noticeText(t, { code: 'balance_below_floor', params: { balance: '$0.01' }, message: 'x' })` passes `balance: '$0.01'` (with this file's `t`, the output contains `mainPanel.insufficientBalance` and `$0.01`). The existing "every alias names a sentence in all 30 locales" covers the eight in every catalog.
  - `noticeTargets.test.ts`: the last case becomes "has words for every code it targets …", reading `expect(NOTICE_WORDS[code] ?? NOTICE_ALIASES[code], code).toBeDefined()` (import `NOTICE_ALIASES`); a new case **"sends a signed-out managed provider to the provider section, where its account row's sign-in link is"** — `settingsTargetForCode('sign_in_required')` is `'provider'`; `settingsTargetForCode('sign_in_pending')` and `('balance_below_floor')` are `null`.
  - `loadStores.test.ts` — the first offered provider is now Kizuna Soniox (ruling 6): in "loads the turn mode, … and selects the first offered provider in memory", `entries.localInference` → `entries.kizunaai_soniox` and `selected` → `'kizunaai_soniox'`; in "falls back to the first offered provider when the stored one is not offered here", `selected` → `'kizunaai_soniox'`; in "loads the selected provider's entry instead of the first offered", `entries.localInference` → `entries.kizunaai_soniox` (undefined); in "reports a rejected turn-mode load once …", `entries.localInference` → `entries.kizunaai_soniox`. Each changed line carries the comment `// The registry's first offered provider (Stage 2 Kizuna Soniox, ruling 6).`.
- [ ] **Step 2: Run** `npx vitest run src/providers src/lib/view src/app/loadStores.test.ts` — FAIL (no `./kizuna`).
- [ ] **Step 3: Implement.**
  - `kizuna.ts`, in full:

    ```ts
    import { kizunaHostedIcon, SonioxIcon } from '../../components/Icons/ProviderIcons';
    import { managed } from '../../lib/provider/managed';
    import { kizunaSonioxMinimumBalance } from './kizunaBudget';
    import { createKizunaLease } from './lease';
    import { useManagedVoiceSource } from './managedVoiceSource';
    import { sonioxProvider } from './provider';
    import { createSonioxSettingsView } from './SonioxSettings';
    import { createKizunaVoiceClaim } from './voiceClaim';

    /** Kizuna Soniox's settings: Soniox's own, with the managed copy and the account's one cached voice (Plan A choice 12). */
    export const KizunaSonioxSettingsView = createSonioxSettingsView({ managed: true, useVoiceSource: useManagedVoiceSource });

    /**
     * Managed participant speech (ruling 2): built end to end — the
     * request's intent, the participant's `par_tts` key in every mode, the
     * floors from the roles — and shipped off until the backend mints
     * `par_tts`. Turning it on is the roadmap's checklist ("Scheduled by the
     * Stage 2 Kizuna Soniox plan"): the backend first, then the request
     * field's name (`PARTICIPANT_SPEECH_FIELD`), then this line.
     */
    export const KIZUNA_PARTICIPANT_SPEECH = false;

    /**
     * Kizuna AI's managed Soniox (spec: "Managed twins are composition"):
     * Soniox's languages, builder and adapter under the old enum's id and
     * slice, so a stored selection and settings carry over; the sign-in in
     * place of a key; the lease that mints each leg's keys and ends the run
     * with its grant; the voice claim; the balance floor. The one
     * participant-speech flag reaches the definition's capability, its lease
     * and its floor (choice 11); the tests build a flag-on twin here.
     */
    export function createKizunaSonioxProvider({ participantSpeech }: { participantSpeech: boolean }) {
      return managed(sonioxProvider, {
        id: 'kizunaai_soniox',
        vendor: 'Soniox',
        icon: kizunaHostedIcon(SonioxIcon),
        settingsKey: 'kizunaSoniox',
        Settings: KizunaSonioxSettingsView,
        signedOut: 'Sign in to use Kizuna AI Soniox.',
        participantSpeech,
        session: {
          prepare: createKizunaVoiceClaim(),
          acquire: createKizunaLease({ participantSpeech }),
          minimumBalance: (shape, s) => kizunaSonioxMinimumBalance(shape, s, participantSpeech),
        },
      });
    }

    /** Released first, unflagged (ruling 6): present wherever the Kizuna umbrella is on. */
    export const kizunaSonioxProvider = createKizunaSonioxProvider({ participantSpeech: KIZUNA_PARTICIPANT_SPEECH });
    ```

  - `registry.ts`: `import { kizunaSonioxProvider } from './soniox/kizuna';` and `const RELEASED = [kizunaSonioxProvider, localInferenceProvider, sonioxProvider] as const;`, its comment becoming "Shipped providers, in UI order (Stage 2 Kizuna Soniox, ruling 6): the managed Kizuna Soniox, the free LocalInference, then Soniox with your own key."
  - `noticeText.ts`, `NOTICE_ALIASES` gains, after `segment_ended` / `connection_lost`:

    ```ts
    // Kizuna Soniox's lease refused a start (Stage 2 Kizuna Soniox, ruling 11): the sentences name Soniox, so the codes keep it.
    soniox_service_unavailable: 'mainPanel.sonioxServiceUnavailable',
    soniox_service_busy: 'mainPanel.sonioxServiceBusy',
    // Its voice claim fell back to a built-in voice (choice 17): the sentences name no vendor.
    voice_clip_missing: 'mainPanel.sonioxVoiceClipMissing',
    voice_pool_busy: 'mainPanel.sonioxVoicePoolBusy',
    voice_build_failed: 'mainPanel.sonioxVoiceBuildFailed',
    voice_unavailable: 'mainPanel.sonioxVoiceUnavailable',
    // The start gate's balance floor (ruling 6): the old gate's sentence, with the balance.
    balance_below_floor: 'mainPanel.insufficientBalance',
    // A managed provider while the sign-in still loads at launch (choice 10): a generic word every locale has.
    sign_in_pending: 'update.checking',
    ```

  - `noticeTargets.ts`: `NOTICE_TARGETS` gains `sign_in_required: 'provider',` with the comment "A managed provider signed out: the provider section's account row carries the sign-in link (Stage 2 Kizuna Soniox)."
- [ ] **Step 4: Run** `npx vitest run src/providers src/lib src/app src/components src/stores`, then the full suite and the gate. What registering Kizuna Soniox first reaches, and why it stays green:
  - `ProviderPicker.test.tsx`, `ProviderPanel.test.tsx`, `useSelectedProvider.test.tsx` and the readiness tests pass their own provider lists;
  - `appShape.test.ts`, `subtitle/appSession.test.ts`, `app/session.test.ts` select a provider explicitly;
  - `SpinePreview.test.tsx`: the page selects the fake on a fresh store (`selected === null`), and its load keeps a selection the page made;
  - the SetupWizard tests: `providerPaths.ts` still reads the old factory for the managed path until Task 11, and every wizard test that lists paths is Task 11's to update — **if a wizard test fails here, stop and report it** (it belongs to Task 11's wave);
  - `localInference/provider.test.ts`'s registry-order case is rewritten in Step 1; `registry.test.ts`'s order case and `loadStores.test.ts`'s four first-offered assertions likewise;
  - if any other test asserts the registry's first offered provider or the release list, stop and report it (Global Constraints).
- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/soniox/kizuna.ts src/providers/soniox/kizuna.test.ts src/providers/soniox/kizunaParticipantSpeech.test.tsx src/providers/registry.ts src/providers/registry.test.ts src/providers/localInference/provider.test.ts src/lib/view/noticeText.ts src/lib/view/noticeText.test.ts src/lib/view/noticeTargets.ts src/lib/view/noticeTargets.test.ts src/app/loadStores.test.ts
  ```

  ```bash
  git commit -q -F - -- src/providers/soniox/kizuna.ts src/providers/soniox/kizuna.test.ts src/providers/soniox/kizunaParticipantSpeech.test.tsx src/providers/registry.ts src/providers/registry.test.ts src/providers/localInference/provider.test.ts src/lib/view/noticeText.ts src/lib/view/noticeText.test.ts src/lib/view/noticeTargets.ts src/lib/view/noticeTargets.test.ts src/app/loadStores.test.ts <<'EOF'
  feat(kizuna-soniox): Kizuna AI's managed Soniox joins the registry, first

  The definition is managed(soniox): Soniox's languages, builder and
  adapter under the old id and slice, the sign-in for a key, the lease,
  the voice claim and the balance floor. One participant-speech flag,
  shipped off, reaches its capability, its lease and its floor; a spec
  runs the shipped definition against a flag-on twin, through the switch,
  the request, the floors and the adapter in every mode. The registry
  offers it first, unflagged. Its codes are worded by the sentences every
  locale already has, and a signed-out start points at the provider
  section.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 9: The account row, the loading sign-in, "Recommended", the preview's stand-ins (choices 10, 15)

**Files:**
- Create: `src/components/providers/ManagedAccountRow.tsx`, `src/components/providers/ManagedAccountRow.test.tsx`, `src/components/providers/useAuthContext.test.tsx`.
- Modify: `src/components/providers/ProviderPicker.tsx`, `src/components/providers/ProviderPicker.test.tsx`, `src/components/providers/useAuthContext.ts`, `src/app/useAppSession.ts`, `src/app/useAppSession.test.tsx`, `src/app/session.ts`, `src/app/session.test.ts`, `src/components/dev/SpinePreview.tsx`, `src/components/dev/SpinePreview.test.tsx`.

**Interfaces:**
- **Consumes:** Task 1's `AuthContext.loaded`; Task 7's `setManagedVoiceStandIn`; Task 8's registration; `useSetAccountPopoverRequested` (`src/stores/settingsStore`).
- **Produces:** `ManagedAccountRow({ auth })`; `AuthStandIn` (a React context, `AuthContext | null`) and `useAuthContext()` reading it first and passing `loaded`; the bridges' `auth.loaded`; `setBridges` forgets managed readiness when `loaded` flips.
- **Consumed by:** Settings (both layouts) and the preview; group check B.

- [ ] **Step 1: Write the failing tests.**
  - `ManagedAccountRow.test.tsx` (`react-i18next`'s `useTranslation` mocked to return the key; `import '../../locales'` for `<Trans>`, as `ProviderPicker.test.tsx` does; `ServiceFactory` mocked as there):
    1. **"shows a spinner and 'Checking...' while the sign-in loads"** — `auth = { signedIn: false, loaded: false, getToken }` → `update.checking` shown, a `.spinner` present, no sign-in button.
    2. **"says the account signs the provider in, once signed in"** — `simpleSettings.autoAuthenticated` shown in `.api-key-info`, a `.success-icon`.
    3. **"offers the account popover to a signed-out user"** — the `common.signInRequired` sentence (rendered by `<Trans>`: "Sign in or sign up to use Kizuna AI — no API key needed.") in `.api-key-warning`; clicking the `.sign-in-link` button sets `useSettingsStore.getState().accountPopoverRequested` to `true` (reset it in `afterEach`).
  - `ProviderPicker.test.tsx`:
    - "offers no Validate button for a managed provider …" stays.
    - **"draws a managed provider's account row, not a credential form"** — the `managed-probe` provider signed out → the `.api-key-warning` row; `noAuth` with `signedIn: true` → `simpleSettings.autoAuthenticated`.
    - **"recommends the first managed provider — rich option"** (`baseSelectSupported.value = true`) — providers `[fakeProvider, managedA, managedB]` (two `kind: 'managed'` copies of the fake with ids `managed-a`, `managed-b` and their own settings keys) → exactly one `em.provider-recommended` in the select, inside `managed-a`'s option, holding `simpleSettings.recommended`.
    - **"recommends it in text on the extension floor"** (`baseSelectSupported.value = false`) — `managed-a`'s option text is `simpleSettings.recommendedOption` (this file's `t` returns the key); the others' are their names.
    - **"recommends nothing when no managed provider is offered"** — `[fakeProvider]` → no `.provider-recommended`, every option its name.
  - `useAuthContext.test.tsx` (mock `../../lib/auth/hooks`'s `useAuth` with a mutable `{ isLoaded, isSignedIn, userId, getToken }`):
    1. **"is the sign-in, with whether it has loaded"** — `isLoaded: false` → `{ signedIn: false, loaded: false, userId: null, getToken }`.
    2. **"answers the stand-in when one is provided"** — wrapped in `<AuthStandIn.Provider value={standIn}>` → the stand-in itself.
  - `useAppSession.test.tsx`: the `useAuth` mock becomes mutable (`const authState = vi.hoisted(() => ({ isLoaded: true }))`, the mock returning `{ isLoaded: authState.isLoaded, isSignedIn: true, userId: 'u1', getToken }`); **"tells the session whether the sign-in has loaded"** — `authState.isLoaded = false` → `result.current.loaded` is `false`; restore it after.
  - `session.test.ts`, beside "forgets a managed provider's readiness when the sign-in or the account flips": **"forgets it too when the sign-in finishes loading"** — the same `fake_leased` setup; `setBridges({ auth: { signedIn: false, loaded: false, getToken } })`, `await Promise.resolve()`, readiness set back to `ready`; `setBridges({ auth: { signedIn: false, loaded: true, getToken } })` → after `await Promise.resolve()` readiness is `{ state: 'unknown' }`; a further `setBridges` with the same `loaded: true` leaves a restored `ready` alone.
  - `SpinePreview.test.tsx`: **"&signedin=1 reaches the Settings blocks, and the managed voice library calls no backend"** — `vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))`; URL `/?preview=spine&settings=advanced&provider=kizunaai_soniox&signedin=1`; render → `await screen.findByText('simpleSettings.autoAuthenticated')`; `fetch`'s calls hold no URL containing `/soniox/`; restore the URL and `vi.unstubAllGlobals()` in `finally`. And **"signed out, Kizuna Soniox's Settings offer the sign-in"** — the same URL without `&signedin=1` → the `.sign-in-link` button is present, and no `/soniox/` request.
- [ ] **Step 2: Run** `npx vitest run src/components/providers src/app src/components/dev` — FAIL.
- [ ] **Step 3: Implement.**
  - `ManagedAccountRow.tsx`, in full:

    ```tsx
    import { AlertCircle, CheckCircle } from 'lucide-react';
    import { Trans, useTranslation } from 'react-i18next';
    import type { AuthContext } from '../../lib/provider/types';
    import { useSetAccountPopoverRequested } from '../../stores/settingsStore';

    /**
     * A managed provider's account line under the picker, in place of a
     * credential form (spec: "Managed twins are composition" — no field):
     * today's `ProviderSection.tsx:864-906` row over the sign-in. Loading at
     * launch it shows a spinner (choice 10); signed in, that the account
     * signs the provider in; signed out, the sign-in link, which opens the
     * title bar's account popover so the sign-in lives in one place.
     */
    export function ManagedAccountRow({ auth }: { auth: AuthContext }) {
      const { t } = useTranslation();
      const requestAccount = useSetAccountPopoverRequested();
      if (auth.loaded === false) {
        return (
          <div className="api-key-info">
            <span className="spinner" />
            <span>{t('update.checking', 'Checking...')}</span>
          </div>
        );
      }
      if (auth.signedIn) {
        return (
          <div className="api-key-info">
            <CheckCircle size={16} className="success-icon" />
            <span>{t('simpleSettings.autoAuthenticated', 'Automatically authenticated via your account')}</span>
          </div>
        );
      }
      return (
        <div className="api-key-warning">
          <AlertCircle size={16} className="warning-icon" />
          <span>
            <Trans
              i18nKey="common.signInRequired"
              components={{ signInLink: <button type="button" className="sign-in-link" onClick={() => requestAccount(true)} /> }}
            />
          </span>
        </div>
      );
    }
    ```

  - `ProviderPicker.tsx`:
    - import `ManagedAccountRow` from `'./ManagedAccountRow'`;
    - in the component body, after `const { setCredential, refreshReadiness, select } = …`: `// The first managed provider offered, as the wizard's managed card recommends it (today's ProviderSection.tsx:553-580). const recommendedId = providers.find((p) => p.kind === 'managed')?.id; const recommendedLabel = t('simpleSettings.recommended', 'Recommended');`;
    - `renderProviderOption`: the plain branch returns `<option key={p.id} value={p.id}>{p.id === recommendedId ? t('simpleSettings.recommendedOption', '{{name}} ({{label}})', { name, label: recommendedLabel }) : name}</option>`; the rich branch adds `{p.id === recommendedId && <em className="provider-recommended">{recommendedLabel}</em>}` inside `.provider-name-line`, after the vendor credit; the comment "No "Recommended" tag: no managed provider is offered on this branch (Stage 2 brings it back with the managed step)." is replaced by "The first managed provider offered carries "Recommended" (Stage 2 Kizuna Soniox)." and the credit comment's "(the Kizuna-managed twins, none offered on this branch — see above)" becomes "(a Kizuna-managed twin)";
    - the credential block becomes `{entry && (provider.kind === 'managed' ? <ManagedAccountRow auth={auth} /> : <CredentialForm … />)}` (the `CredentialForm` element unchanged), with the comment "A managed provider has no field: its account row says whether the sign-in covers it."
  - `useAuthContext.ts`:

    ```ts
    import { createContext, useContext, useMemo } from 'react';
    import { useAuth } from '../../lib/auth/hooks';
    import type { AuthContext } from '../../lib/provider/types';

    /** The development preview's stand-in sign-in (`&signedin=1`) for the Settings blocks it draws (choice 15); null in the app. */
    export const AuthStandIn = createContext<AuthContext | null>(null);

    export function useAuthContext(): AuthContext {
      const { isLoaded, isSignedIn, userId, getToken } = useAuth();
      const standIn = useContext(AuthStandIn);
      const real = useMemo(() => ({ signedIn: isSignedIn, loaded: isLoaded, userId: userId ?? null, getToken }), [isSignedIn, isLoaded, userId, getToken]);
      return standIn ?? real;
    }
    ```

    and the header adds "`loaded` says whether the sign-in has loaded (choice 10); a stand-in provided through `AuthStandIn` wins".
  - `useAppSession.ts`: `const { isLoaded, isSignedIn, userId, getToken } = useAuth();` and `const real = useMemo(() => ({ signedIn: isSignedIn, loaded: isLoaded, userId: userId ?? null, getToken }), [isSignedIn, isLoaded, userId, getToken]);`.
  - `session.ts`, `setBridges`: capture `const loaded = bridges.auth.loaded !== false;` beside `signedIn` / `userId`, and the flip test becomes `if (bridges.auth.signedIn !== signedIn || (bridges.auth.userId ?? null) !== userId || (bridges.auth.loaded !== false) !== loaded) {`; the `AppSession.attach` doc's "the sign-in's flips" becomes "the sign-in's flips (loading finished included)".
  - `SpinePreview.tsx`:
    - imports: `AuthStandIn` (`'../providers/useAuthContext'`), `setManagedVoiceStandIn` (`'../../providers/soniox/managedVoiceSource'`);
    - at module scope, beside `configureAppSession(…)`:

      ```ts
      // The preview's sign-in is never real: Kizuna Soniox's voice library lists
      // nothing here and calls no backend (Stage 2 Kizuna Soniox, choice 15).
      setManagedVoiceStandIn({
        list: async () => [],
        create: async () => { throw new Error('The preview cannot build a voice.'); },
        delete: async () => {},
        waitUntilReady: async () => { throw new Error('The preview cannot build a voice.'); },
        canPreview: false,
      });
      ```

    - the component's returned tree is wrapped in `<AuthStandIn.Provider value={param('signedin') === '1' ? PREVIEW_SIGNED_IN : null}>…</AuthStandIn.Provider>`, so the `&settings=` blocks' `useAuthContext()` reads the stand-in (roadmap `:1274`); the page's doc comment's `&signedin=1` sentence adds "and to the `&settings=` blocks; Kizuna Soniox's voice library runs on a stand-in that calls nothing".
- [ ] **Step 4: Run** `npx vitest run src/components src/app`, then the full suite and the gate. `ProviderPanel.test.tsx` and `ProviderArea`'s tests pass `auth` or mock `useAuth`; a mock without `isLoaded` gives `loaded: undefined`, read as loaded. `session.test.ts`'s default bridge (`{ signedIn: false, getToken }`) has no `loaded`: "checks a local provider by itself" still sees exactly that object.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/components/providers/ManagedAccountRow.tsx src/components/providers/ManagedAccountRow.test.tsx src/components/providers/ProviderPicker.tsx src/components/providers/ProviderPicker.test.tsx src/components/providers/useAuthContext.ts src/components/providers/useAuthContext.test.tsx src/app/useAppSession.ts src/app/useAppSession.test.tsx src/app/session.ts src/app/session.test.ts src/components/dev/SpinePreview.tsx src/components/dev/SpinePreview.test.tsx
  ```

  ```bash
  git commit -q -F - -- src/components/providers/ManagedAccountRow.tsx src/components/providers/ManagedAccountRow.test.tsx src/components/providers/ProviderPicker.tsx src/components/providers/ProviderPicker.test.tsx src/components/providers/useAuthContext.ts src/components/providers/useAuthContext.test.tsx src/app/useAppSession.ts src/app/useAppSession.test.tsx src/app/session.ts src/app/session.test.ts src/components/dev/SpinePreview.tsx src/components/dev/SpinePreview.test.tsx <<'EOF'
  feat(providers): a managed provider's account row, and Recommended in the picker

  A managed provider shows its account under the picker: checking while
  the sign-in loads, covered once signed in, or the sign-in link that opens
  the account popover. The first managed provider is recommended again.
  The sign-in's loading state reaches the session and the Settings, and
  its end re-checks managed readiness. The preview's signed-in stand-in
  reaches its Settings blocks, and the managed voice library there calls
  no backend.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 10: The countdown, and the account button's dot through the gate (choices 9, 18)

**Files:**
- Create: `src/components/TitleBar/useBalanceShortfall.ts`, `src/components/TitleBar/useBalanceShortfall.test.tsx`.
- Modify: `src/components/MainPanel/SessionCountdown.tsx`, `SessionCountdown.test.tsx`, `src/components/MainPanel/panel/PanelFooter.tsx`, `PanelFooter.test.tsx`, `src/components/TitleBar/AccountButton.tsx`, `AccountButton.test.tsx`, `src/lib/session/appShape.ts` (one word: `selectedFromStores` exported).

**Interfaces:**
- **Consumes:** Task 1's `Budget`; Task 2's running `budget`; Task 3's `balanceRefusal`, `BALANCE_BELOW_FLOOR`, `useAccountStore`; `legsFor`, `selectedFromStores` (exported here) and Task 4's `participantSpeechFromStores` (`appShape.ts`); Task 8's registration.
- **Produces:** `SessionCountdown({ budget, now? })`; `useBalanceShortfall(): boolean`; `selectedFromStores(): { provider: AnyProvider; entry: ProviderEntry } | null` exported from `appShape.ts` (unchanged, `appShape.ts:26-32`).
- **Consumed by:** the two footers; the title bar.

- [ ] **Step 1: Write the failing tests.**
  - `SessionCountdown.test.tsx` rewritten over the new props (keep `vi.useFakeTimers()` in `beforeEach`, `vi.useRealTimers()` in `afterEach`; a mutable `let now = 0; const clock = () => now;`):
    1. **"shows what is left of the grant, formatted as the session clock is"** — `budget = { totalMs: 1_200_000, endsAt: 600_000 }`, `now = 0` → `.session-remaining-time` text `formatRemainingTime(600_000)`, no `low`.
    2. **"ticks once a second"** — `now = 1000`; `act(() => vi.advanceTimersByTime(1000))` → `formatRemainingTime(599_000)`.
    3. **"is low under 20 % of the grant, and not at 20 % (strict <)"** — `endsAt` 100_000 of 1_200_000 → `low`; `endsAt` 240_000 → not.
    4. **"never counts below zero"** — `now = 700_000` → `formatRemainingTime(0)` ("00:00").
    5. **"a grant of zero is never low"** — `{ totalMs: 0, endsAt: 0 }` → no `low`.
    6. **"stops ticking on unmount"** — a `now` spy's call count stops growing after `unmount()` and 5 s of timers.
  - `PanelFooter.test.tsx`, a new describe "PanelFooter — the lease's countdown": `it.each(SITES)` **"%s: shows the countdown beside the duration while a leased run runs"** — `run: { phase: 'running', since: 0, legs: { speaker: 'live' }, budget: { totalMs: 60_000, endsAt: Date.now() + 30_000 } }`, `duration: '00:30'` → one `.session-remaining-time` in `.footer-metadata`; `it.each(SITES)` **"%s: none without a budget, or while idle"** — the same run without `budget`, and `idleRun` → none.
  - `useBalanceShortfall.test.tsx` (mock `ServiceFactory` as `appShape.test.ts` does; real stores and registry):
    1. **"is short below the selected provider's floor for these legs"** — `useProviderStore.setState({ selected: 'kizunaai_soniox', entries: { kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } } })`, `useAudioStore.setState({ mode: 'speaker' })`, `useSettingsStore.setState({ textOnly: false })`, account `{ balanceMicroUsd: 41_666, frozen: false }` → `renderHook(() => useBalanceShortfall()).result.current` is `true`; `act(() => useAccountStore.setState({ account: { balanceMicroUsd: 41_667, frozen: false } }))` → `false`.
    2. **"follows text only and the mode"** — balance 20 000: speaking → `true`; `textOnly: true` → `false` (floor 18 334); mode `both` with `bothModeSharedSession: false`, text only → `true` (floor 36 667).
    3. **"is never short for an unknown account, an own-key provider, or a frozen wallet"** — account `null` → `false`; `selected: 'soniox'` (own key) with its entry (`SONIOX_DEFAULTS`) and balance 0 → `false`; frozen with balance 0 → `false` (a frozen wallet has its own words at Start, and no dot — a stated departure).
    4. **"finds the provider as the live gate does: before the load selects one, the first present"** — `useProviderStore.setState({ selected: null, entries: { kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } } })`, mode `speaker`, speaking, account `{ balanceMicroUsd: 1_000, frozen: false }` → the hook answers `true` and `liveGate()?.code` is `'balance_below_floor'` (import `liveGate` from `appShape.ts`): the dot and Start agree. With no entry loaded at all (`entries: {}`) both answer nothing — `false` and `null`.
  - `AccountButton.test.tsx`:
    - add `const shortfall = vi.hoisted(() => ({ value: false })); vi.mock('./useBalanceShortfall', () => ({ useBalanceShortfall: () => shortfall.value }));` and reset `shortfall.value = false` in `beforeEach`;
    - the cases that drove the old floor through a provider id and a balance drive `shortfall.value` instead, their names and assertions kept: "shows a red dot for a low balance under a managed provider" (`shortfall.value = true`), "lets red outrank amber when both apply", "shows no dot when verified and funded" (`false`), "names the low-balance state in the accessible label"; "does NOT warn about a low balance under a BYOK provider" is removed — over the mocked hook it would pass vacuously — and folded into the replacement case below;
    - the describe "AccountButton balance floor per provider" is replaced by one case: **"the dot is the start gate's: it shows exactly when the hook says the balance is short"** — signed in, `shortfall.value = true` → `data-tone` `'low'`; `false` → no dot, whatever the provider (an own-key one included). The floor itself — that an own-key provider, an unknown account or a frozen wallet is never short — is `useBalanceShortfall.test.tsx`'s case 3; the relay twins the old describe tested are not offered by the registry.
- [ ] **Step 2: Run** `npx vitest run src/components/MainPanel src/components/TitleBar` — FAIL.
- [ ] **Step 3: Implement.**
  - `SessionCountdown.tsx`, in full:

    ```tsx
    import React, { useEffect, useState } from 'react';
    import type { Budget } from '../../lib/session/types';
    import { formatRemainingTime } from '../../utils/formatters';
    import './SessionCountdown.scss';

    interface SessionCountdownProps {
      /** The lease's granted time (`RunState.running.budget`). */
      budget: Budget;
      /** The wall clock; `Date.now` — the app's run clock is the real one, so `endsAt` reads on it (choice 18). Tests inject one. */
      now?: () => number;
    }

    /**
     * A leased session's countdown, in the footers beside the session clock
     * (Stage 2 Kizuna Soniox): what is left of the grant, ticking once a
     * second, with the warning emphasis under 20 % of it. Mounted only while
     * a leased run runs, so it needs no `active` guard of its own.
     */
    const SessionCountdown: React.FC<SessionCountdownProps> = ({ budget, now = Date.now }) => {
      const [, retick] = useState(0);
      useEffect(() => {
        const interval = setInterval(() => retick((n) => n + 1), 1000);
        return () => clearInterval(interval);
      }, []);
      const remainingMs = Math.max(0, budget.endsAt - now());
      const low = budget.totalMs > 0 && remainingMs / budget.totalMs < 0.2;
      return (
        <span className={`session-remaining-time${low ? ' low' : ''}`}>
          {formatRemainingTime(remainingMs)}
        </span>
      );
    };

    export default SessionCountdown;
    ```

  - `PanelFooter.tsx`: `import SessionCountdown from '../SessionCountdown';`; in both footers' `.footer-metadata`, after the `session-duration` span: `{run.phase === 'running' && run.budget && <SessionCountdown budget={run.budget} />}`; the doc comment adds "and a leased run's countdown beside the session clock".
  - `appShape.ts`: `function selectedFromStores()` becomes `export function selectedFromStores()`; nothing else.
  - `useBalanceShortfall.ts`, in full:

    ```ts
    /**
     * Whether the account button's dot says the balance is too low to start
     * (choice 9): exactly when the start gate refuses the selected provider's
     * start below its floor — the same computation over the same stores as
     * Start, so the two never disagree (`AccountButton.tsx`'s own rule). A
     * frozen wallet is not a low balance.
     */
    import { balanceRefusal, BALANCE_BELOW_FLOOR } from '../../lib/session/shape';
    import { legsFor, participantSpeechFromStores, selectedFromStores } from '../../lib/session/appShape';
    import { useAccountStore } from '../../stores/accountStore';
    import useAudioStore from '../../stores/audioStore';
    import { useProviderStore } from '../../stores/providerStore';
    import { useRoutingStore } from '../../stores/routingStore';
    import { useSettingsStore } from '../../stores/settingsStore';

    export function useBalanceShortfall(): boolean {
      // Subscribed to what the provider lookup reads, so the dot follows a selection or a load.
      useProviderStore((s) => s.selected);
      useProviderStore((s) => s.entries);
      const mode = useAudioStore((s) => s.mode);
      const textOnly = useSettingsStore((s) => s.textOnly);
      const account = useAccountStore((s) => s.account);
      // What `participantSpeechFromStores` reads, subscribed so the dot follows the switch and the source.
      useRoutingStore((s) => s.participantSpeech);
      useAudioStore((s) => s.selectedParticipantSource?.deviceId);
      // The provider exactly as the live gate finds it (`selectedFromStores`: the selected one, else the first present), so before the load selects one the dot and Start still agree.
      const found = selectedFromStores();
      if (!found) return false;
      const { provider, entry } = found;
      const participantSpeech = participantSpeechFromStores(provider);
      return balanceRefusal({ provider, settings: entry.settings, legs: legsFor(mode), textOnly, participantSpeech, account })?.code === BALANCE_BELOW_FLOOR;
    }
    ```

  - `AccountButton.tsx`:
    - imports: drop `isKizunaManagedProvider, Provider` (`../../types/Provider`), `useProviderStore`, `storedProviderValue` and `sonioxManagedMinBalanceMicroUsd`; add `import { useBalanceShortfall } from './useBalanceShortfall';`;
    - replace the `provider` constant and its comment (`:35-40`) with `// The start gate's own answer for the selected provider (Stage 2 Kizuna Soniox, choice 9). const lowBalance = useBalanceShortfall();` — a hook, so it sits with the others, above the early return;
    - in the signed-in branch, the floor comment and computation (`:117-138`) become

      ```ts
      // The low-balance warning is the start gate's (useBalanceShortfall): a
      // provider with no floor (own key, local) never warns, and a managed one
      // warns exactly when Start refuses below its floor for these legs.
      // E-mail verification is account-level and shows regardless.
      ```

      and `lowBalance` is read from the hook; `balance` stays for the label.
- [ ] **Step 4: Run** `npx vitest run src/components`, then the full suite and the gate. `SessionCountdown`'s only mount is `PanelFooter`; `MainPanel.test.tsx` and the probes' runs have no lease, so no countdown appears there.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/components/MainPanel/SessionCountdown.tsx src/components/MainPanel/SessionCountdown.test.tsx src/components/MainPanel/panel/PanelFooter.tsx src/components/MainPanel/panel/PanelFooter.test.tsx src/components/TitleBar/useBalanceShortfall.ts src/components/TitleBar/useBalanceShortfall.test.tsx src/components/TitleBar/AccountButton.tsx src/components/TitleBar/AccountButton.test.tsx src/lib/session/appShape.ts
  ```

  ```bash
  git commit -q -F - -- src/components/MainPanel/SessionCountdown.tsx src/components/MainPanel/SessionCountdown.test.tsx src/components/MainPanel/panel/PanelFooter.tsx src/components/MainPanel/panel/PanelFooter.test.tsx src/components/TitleBar/useBalanceShortfall.ts src/components/TitleBar/useBalanceShortfall.test.tsx src/components/TitleBar/AccountButton.tsx src/components/TitleBar/AccountButton.test.tsx src/lib/session/appShape.ts <<'EOF'
  feat(panel): a leased session counts down, and the account dot follows Start

  Both footers show what is left of a lease's grant beside the session
  clock, low under a fifth of it. The account button's low-balance dot is
  the start gate's own answer for the selected provider, so it shows
  exactly when Start refuses below the floor.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 11: The wizard's managed path, and the stored-selection fallback (choice 13)

**Files:**
- Modify: `src/components/SetupWizard/providerPaths.ts`, `providerPaths.test.ts`, `providerPaths.managedFit.test.ts`, `SetupWizard.test.tsx`, `src/lib/session/storedSettings.ts`, `storedSettings.test.ts`, `src/app/loadStores.ts`, `src/app/loadStores.test.ts`.

**Interfaces:**
- **Consumes:** `presentProviders` (Kizuna Soniox registered, Task 8); `textOnlyCapabilityOf`, `wizardProvider` (`providerPaths.ts`, Plan A).
- **Produces:** `managedProvider(): ProviderType | null` and `managedOption(scenario)` from the registry; `availablePaths()` offers `'managed'` first when a managed provider is present; `MANAGED_LEGACY_IDS`; `selectionFromStored(stored, offered, managedDefault?: string | null)`.
- **Consumed by:** `StepProviderPath` (unchanged: it already offers the managed card through these), `SetupWizard.tsx`'s `offersRecord`, `StepScenario`'s `providerFits`; `loadSelectedProvider`.

- [ ] **Step 1: Write the failing tests.**
  - `providerPaths.test.ts` (its environment mock turns the umbrella on, so Kizuna Soniox is present):
    - "offers the own-key path beside the offline one …" becomes **"offers the managed path first, then own key and offline"** — `availablePaths()` is `['managed', 'own-key', 'offline']`; `managedProvider()` is `Provider.KIZUNA_AI_SONIOX` (`'kizunaai_soniox'`, now the registry's).
    - **"judges the managed card's fit from the definition's speech"** — `managedOption('subtitle-myself')` equals `{ id: 'kizunaai_soniox', fit: { ok: true } }` (Soniox's `speech` is optional).
    - `providerFits(Provider.KIZUNA_AI_SONIOX, 'subtitle-myself')` is `true` (added to "providerFits answers for a registered provider…").
    - `offersRecord`: "refuses a managed record — no managed card until Stage 2" becomes **"offers a managed record for Kizuna Soniox"** → `true`; a managed record naming `kizunaai_openai_translate` → `false`.
    - `wizardProvider('kizunaai_soniox')?.kind` is `'managed'`.
  - `providerPaths.managedFit.test.ts` rewritten over the registry — the environment mock goes, replaced by

    ```ts
    // A build whose managed twin always speaks: its card must answer for the
    // scenario like every own-key card does (raised by Codex on #444). Only
    // the three members the wizard reads are real.
    vi.mock('../../providers/registry', () => ({
      presentProviders: () => [{ id: 'kizunaai_soniox', kind: 'managed', speech: 'always' }],
    }));
    ```

    and its cases: **"offers the managed path for the build's managed provider"** — `managedProvider()` `'kizunaai_soniox'`, `availablePaths()` contains `'managed'`; **"reports it unfit for a scenario it cannot serve"** — `managedOption('subtitle-myself')` matches `{ id: 'kizunaai_soniox', fit: { ok: false, reason: 'cannot-be-text-only' } }`, `managedOption('two-way-text')?.fit.ok` `false`; **"fit for the scenarios it can serve"** — `understand-others`, `be-heard`, `two-way-voice` → `{ ok: true }`. The header comment keeps the #444 history and says the managed card now reads the registry.
  - `SetupWizard.test.tsx`:
    - "starts blank from a managed record — the card is gone until Stage 2" becomes **"pre-fills a re-run from a managed record"** — `setupRecord` managed / `kizunaai_soniox`, `signedIn = true`; render the re-run; `next()` → `Be understood in a meeting` checked; `next()` → the `Start right away` radio checked; `next()` → "Signed in. You can continue." and `Next` enabled.
    - **"walks the managed path to Finish, the card recommended"** — `signedIn = true`; the provider store's `kizunaai_soniox` entry seeded (`{ settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } }`); first-run: `next()`, `Be understood in a meeting`, `next()`; the `Start right away` radio's label holds `Recommended`; click it, `next()` (the account step, signed in), `next()` (the pair), `next()` (the summary), `Finish` → `applied[0]` matches `{ providerPath: 'managed', provider: 'kizunaai_soniox', credentialsPending: false }`.
    - The other cases stay: the path step now shows three cards, and each case picks its card by name.
  - `storedSettings.test.ts`, in `describe('selectionFromStored')`:
    1. **"sends a stored managed id this build does not port to the default managed provider"** — `selectionFromStored('kizunaai', ['kizunaai_soniox', 'localInference'], 'kizunaai_soniox')` → `{ id: 'kizunaai_soniox', fromStorage: false }`; likewise `'kizunaai_openai_translate'` and `'kizunaai_volcengine_ast2'`.
    2. **"falls back to the first offered when no managed provider is offered"** — `selectionFromStored('kizunaai', ['localInference'], null)` → `{ id: 'localInference', fromStorage: false }`.
    3. **"keeps a stored managed provider that is offered"** — `'kizunaai_soniox'` → `{ id: 'kizunaai_soniox', fromStorage: true }`.
    4. **"an unrelated stored id still falls back to the first offered"** — `'openai'` with the managed default given → `offered[0]`.
  - `loadStores.test.ts`: **"selects Kizuna Soniox for a stored 'kizunaai', and never writes it back"** — `stored.set('settings.common.provider', 'kizunaai')` → `selected` `'kizunaai_soniox'`, no `setSetting('settings.common.provider', …)`; the same for `'kizunaai_volcengine_ast2'`.
- [ ] **Step 2: Run** `npx vitest run src/components/SetupWizard src/lib/session/storedSettings.test.ts src/app/loadStores.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
  - `providerPaths.ts`:
    - the header comment becomes "The wizard asks "what do you have" (spec §1.2 step 2) and resolves the answer to a provider. Every list reads the registry: the managed path returned with Kizuna Soniox, the own-key one with Soniox (Stage 2)."; the `ProviderConfigFactory` import goes;
    - `managedProvider`, `availablePaths` and `managedOption` become

      ```ts
      /** The registry's default managed provider — the first present, in its order — in the old enum's spelling; null in a build that offers none. */
      export function managedProvider(): ProviderType | null {
        const p = presentProviders().find((candidate) => candidate.kind === 'managed');
        return p ? (storedProviderValue(p.id) as ProviderType) : null;
      }

      /** The paths the wizard offers: managed first when one is present (Kizuna Soniox), own key once an own-key provider is (Soniox), and offline. */
      export function availablePaths(): ProviderPath[] {
        const present = presentProviders();
        const paths: ProviderPath[] = [];
        if (present.some((p) => p.kind === 'managed')) paths.push('managed');
        if (present.some((p) => p.kind === 'own-key')) paths.push('own-key');
        paths.push('offline');
        return paths;
      }

      /** The managed provider with its fit for the scenario, or null in a build that registers none; judged as the own-key list judges its options. */
      export function managedOption(scenario: ScenarioId): ProviderOption | null {
        const id = managedProvider();
        const p = wizardProvider(id);
        if (!id || !p) return null;
        return { id, fit: providerFitForScenario(textOnlyCapabilityOf(p), getScenario(scenario)) };
      }
      ```

    - `offersRecord`'s doc comment drops "managed until Stage 2".
  - `storedSettings.ts`:

    ```ts
    /** Stored ids of managed providers the new session does not port — the pre-twin `'kizunaai'` and the relay twins (spec: "Migration") — which a load maps to the default managed provider (Stage 2 Kizuna Soniox, choice 13). */
    export const MANAGED_LEGACY_IDS: readonly string[] = ['kizunaai', 'kizunaai_openai_translate', 'kizunaai_volcengine_ast2'];

    /** The provider a load selects: the stored one when this build offers it; a managed id it does not port, the default managed provider when one is offered; else the first offered. Never written back. */
    export function selectionFromStored(stored: unknown, offered: readonly string[], managedDefault: string | null = null): StoredSelection | null {
      const id = providerIdFromStored(stored);
      if (id !== null && offered.includes(id)) return { id, fromStorage: true };
      if (id !== null && managedDefault !== null && MANAGED_LEGACY_IDS.includes(id) && offered.includes(managedDefault)) {
        return { id: managedDefault, fromStorage: false };
      }
      return offered.length > 0 ? { id: offered[0], fromStorage: false } : null;
    }
    ```

  - `loadStores.ts`, `loadSelectedProvider`: the `selectionFromStored` call gains its third argument, `offered.find((p) => p.kind === 'managed')?.id ?? null`.
- [ ] **Step 4: Run** `npx vitest run src/components/SetupWizard src/lib/setup src/components/Tour src/lib/session src/app`, then the full suite and the gate. `StepProviderPath.tsx` needs no edit: its managed card, its "Recommended" badge and its fit already read `managedProvider()` / `managedOption()`; `StepCredentials.tsx`'s managed branch and `StepFinish.tsx`'s pending line already exist; `useApplySetup.ts` writes through the registry.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/components/SetupWizard/providerPaths.ts src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/providerPaths.managedFit.test.ts src/components/SetupWizard/SetupWizard.test.tsx src/lib/session/storedSettings.ts src/lib/session/storedSettings.test.ts src/app/loadStores.ts src/app/loadStores.test.ts
  ```

  ```bash
  git commit -q -F - -- src/components/SetupWizard/providerPaths.ts src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/providerPaths.managedFit.test.ts src/components/SetupWizard/SetupWizard.test.tsx src/lib/session/storedSettings.ts src/lib/session/storedSettings.test.ts src/app/loadStores.ts src/app/loadStores.test.ts <<'EOF'
  feat(setup): the wizard's managed path returns, read from the registry

  The managed card is the registry's first managed provider, judged by its
  speech like the own-key cards, and recommended; a managed record
  pre-fills a re-run again. A stored 'kizunaai' or relay-twin id selects
  the managed provider on load, without writing it back.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 12: The sign-in auto-switch (ruling 4; choice 14)

**Files:**
- Create: `src/components/MainLayout/useSignInProviderSwitch.ts`, `src/components/MainLayout/useSignInProviderSwitch.test.tsx`.
- Modify: `src/components/MainLayout/MainLayout.tsx`, `MainLayout.setup.test.tsx`, `MainLayout.keepAlive.test.tsx`, `MainLayout.logsMode.test.tsx`.

**Interfaces:**
- **Consumes:** `presentProviders`; `useProviderStore.select(id, 'pick')` (refused while `selectionLocked`) and `useProviderStore.load(p)`; `readShapeFromStores` (its test); `useUIMode`; `useAuth().isLoaded` / `isSignedIn`; `storedProviderValue`.
- **Produces:** `signInSwitchTarget(offered, selected): AnyProvider | null`; `useSignInProviderSwitch(wizardOnScreen: boolean): void`.
- **Consumed by:** `MainLayout`.

- [ ] **Step 1: Write the failing tests** — `useSignInProviderSwitch.test.tsx` (mock `ServiceFactory` with a `setSetting` spy as `ProviderPicker.test.tsx` does; `vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => auth }))` over a mutable `let auth = { isLoaded: true, isSignedIn: false }`; `vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }))`; real stores and registry; `beforeEach`: `useProviderStore.setState({ selected: 'localInference', selectionLocked: false, entries: {} })`, `useSettingsStore.setState({ uiMode: 'basic' })`, spies cleared). A helper renders `renderHook(({ wizard }) => useSignInProviderSwitch(wizard), { initialProps: { wizard: false } })` and signs in by setting `auth` and calling `rerender`.
  1. **"moves a Basic-mode user who signs in onto Kizuna Soniox, as a pick, and tracks it"** — signed out, then signed in → `selected` `'kizunaai_soniox'`; `setSetting` called with `'settings.common.provider', 'kizunaai_soniox'`; `trackEvent` called with `'settings_modified', { setting_name: 'provider', new_value: 'kizunaai_soniox', old_value: 'local_inference', category: 'api' }`.
  2. **"leaves an Advanced-mode user where they are"** — `uiMode: 'advanced'` → `selected` stays `'localInference'`; nothing tracked.
  3. **"never switches under the wizard, and the flip is spent"** — sign in with `wizard: true` → no switch; `rerender({ wizard: false })` → still no switch.
  4. **"leaves a managed provider as it is"** — `selected: 'fake_leased'` → no switch.
  5. **"a session restored at launch is not a sign-in"** — start `{ isLoaded: false, isSignedIn: false }`, then `{ isLoaded: true, isSignedIn: true }` → no switch.
  6. **"refused during a run: nothing changes, nothing is tracked"** — `selectionLocked: true` → `selected` stays; `trackEvent` not called.
  7. **"loads the managed provider's entry, so Start follows at once with Settings closed"** — `select()` only sets `selected` (`providerStore.ts:122-131`); an entry is otherwise loaded by `useSelectedProvider`'s effect, which a closed Settings (a hidden `<Activity>`, `MainLayout.tsx:206`) does not run. The hook alone is rendered here, as with Settings closed: sign in → `await waitFor(() => expect(useProviderStore.getState().entries.kizunaai_soniox).toBeDefined())` (what `appSubtitleSession`'s `providerLoaded` reads, `lib/subtitle/appSession.ts:42`), and `readShapeFromStores({ signedIn: true, userId: 'u1', getToken: async () => 't' })?.provider.id` is `'kizunaai_soniox'` (the shape a Start freezes; null before the entry loads). With `selectionLocked: true` (case 6) no entry is loaded.
  8. **"signInSwitchTarget names the first managed provider unless one is selected"** — over `presentProviders()`: `signInSwitchTarget(p, 'localInference')?.id` `'kizunaai_soniox'`; `signInSwitchTarget(p, 'kizunaai_soniox')` `null`; over `[localInferenceProvider]` → `null`.
- [ ] **Step 2: Run** `npx vitest run src/components/MainLayout` — FAIL.
- [ ] **Step 3: Implement.**
  - `useSignInProviderSwitch.ts`, in full:

    ```ts
    /**
     * A sign-in moves a Basic-mode user onto the managed provider (Stage 2
     * Kizuna Soniox, ruling 4; the old `MainLayout.tsx:160-199`, removed in
     * `8044e074`): Basic mode only; never under the setup wizard, whose Finish
     * writes the provider (backing out must leave it as it was); from a
     * provider that is not managed already; as a person's pick, through the
     * store's lock (refused during a run), its entry loaded (Settings may be
     * closed); tracked as `settings_modified`. One
     * refinement (choice 14): a session restored at launch is not a sign-in —
     * the flip counts only once the sign-in has loaded signed out.
     */
    import { useEffect, useRef } from 'react';
    import { useAnalytics } from '../../lib/analytics';
    import { useAuth } from '../../lib/auth/hooks';
    import type { AnyProvider } from '../../lib/provider/types';
    import { storedProviderValue } from '../../lib/session/storedSettings';
    import { presentProviders } from '../../providers/registry';
    import { useProviderStore } from '../../stores/providerStore';
    import { useUIMode } from '../../stores/settingsStore';

    /** The provider a sign-in switches to: the first managed one offered, unless the selected one is managed already. */
    export function signInSwitchTarget(offered: readonly AnyProvider[], selected: string | null): AnyProvider | null {
      if (offered.find((p) => p.id === selected)?.kind === 'managed') return null;
      return offered.find((p) => p.kind === 'managed') ?? null;
    }

    export function useSignInProviderSwitch(wizardOnScreen: boolean): void {
      const { isLoaded, isSignedIn } = useAuth();
      const uiMode = useUIMode();
      const { trackEvent } = useAnalytics();
      /** The sign-in as last seen once loaded; null before it has loaded. */
      const seen = useRef<boolean | null>(null);
      useEffect(() => {
        // `isLoaded` absent (a stub) reads as loaded.
        if (isLoaded === false) return;
        const before = seen.current;
        seen.current = isSignedIn;
        if (before !== false || !isSignedIn || wizardOnScreen || uiMode !== 'basic') return;
        const from = useProviderStore.getState().selected;
        const target = signInSwitchTarget(presentProviders(), from);
        if (!target) return;
        useProviderStore.getState().select(target.id, 'pick');
        // Refused while a run is on (the store's lock): nothing changed, nothing to track.
        if (useProviderStore.getState().selected !== target.id) return;
        // `select()` loads nothing, and a closed Settings runs no loader: load
        // the entry here, as `useApplySetup` does, so Start follows at once.
        if (!useProviderStore.getState().entries[target.id]) void useProviderStore.getState().load(target);
        trackEvent('settings_modified', {
          setting_name: 'provider',
          new_value: storedProviderValue(target.id),
          old_value: from === null ? undefined : storedProviderValue(from),
          category: 'api',
        });
      }, [isLoaded, isSignedIn, uiMode, wizardOnScreen, trackEvent]);
    }
    ```

  - `MainLayout.tsx`: `import { useSignInProviderSwitch } from './useSignInProviderSwitch';` and, after `const setSetupWizardOpen = useSetSetupWizardOpen();`: `// A sign-in in Basic mode moves the user onto the managed provider — never under either wizard (ruling 4). useSignInProviderSwitch(setupWizardOpen || !setupComplete);` The file's `useTranslation` import (a baseline gate line) is left alone.
  - The three `MainLayout.*.test.tsx`: one line each beside their other `vi.mock` calls — `vi.mock('./useSignInProviderSwitch', () => ({ useSignInProviderSwitch: () => {} }));` — since each mocks `stores/settingsStore` whole (the hook is its own test's).
- [ ] **Step 4: Run** `npx vitest run src/components/MainLayout src/components`, then the full suite and the gate (the `MainLayout/` files are in the widened regex; `MainLayout.tsx`'s one baseline line stays).
- [ ] **Step 5: Commit.**

  ```bash
  git add src/components/MainLayout/useSignInProviderSwitch.ts src/components/MainLayout/useSignInProviderSwitch.test.tsx src/components/MainLayout/MainLayout.tsx src/components/MainLayout/MainLayout.setup.test.tsx src/components/MainLayout/MainLayout.keepAlive.test.tsx src/components/MainLayout/MainLayout.logsMode.test.tsx
  ```

  ```bash
  git commit -q -F - -- src/components/MainLayout/useSignInProviderSwitch.ts src/components/MainLayout/useSignInProviderSwitch.test.tsx src/components/MainLayout/MainLayout.tsx src/components/MainLayout/MainLayout.setup.test.tsx src/components/MainLayout/MainLayout.keepAlive.test.tsx src/components/MainLayout/MainLayout.logsMode.test.tsx <<'EOF'
  feat(layout): signing in moves a Basic-mode user onto the managed provider

  Restored as it was: Basic mode only, never under the setup wizard, from
  a provider that is not managed, as a pick through the store's lock, and
  tracked as settings_modified. A session restored at launch no longer
  counts as a sign-in.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Group check B (controller)

After Wave 5 (Tasks 8–12).

1. The full gates; both release builds; `npx vitest run extension`; the three D24 greps print nothing; `command grep -rlF 'session.lease_acquired' build extension/dist` names the app's and the extension's main chunks — the new lease shipped in both.
2. The full tree's typecheck is at most 259 lines (`/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/kizuna-groupB-tsc.txt`).
3. Every probe green on a fresh vite: the spine probes (subtitle, surface, export, audio, gate, local), `app-panel-probe` (preview; `--settings`; `--app`, plain and `--settings`), `extension-overlay-probe` (plain and `--ptt`) on fresh builds. The registry now offers Kizuna Soniox first: the preview still opens on the fake (a fresh store), and `app-panel-probe --app` seeds LocalInference.
4. **Kizuna Soniox's Provider tab, rendered**, through `scripts/dev/headless.mjs`, screenshots under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, the page's network log (the DevTools `Network` domain) recorded for each; **Start is never pressed** with Kizuna Soniox selected (ruling 12):
   - `/?preview=spine&settings=advanced&provider=kizunaai_soniox` (signed out): the picker shows "KizunaAI · Powered by Soniox" with the hosted icon and "Recommended"; the account row "Sign in or sign up to use Kizuna AI — no API key needed." with its link; Start off with "Sign in to use Kizuna AI's built-in translation service."; the region select with the managed tooltip, the voice library with built-ins only, TTS speed, vocabulary, background, the shared-session pills with the managed cost note in Both, the turn-detection block. The network log has no request to `/soniox/`.
   - The same page with `&signedin=1`: the row "Automatically authenticated via your account"; the voice library lists only built-ins (the stand-in lists nothing); Start on (the static check); no request to `/soniox/`.
   - `&settings=simple&provider=kizunaai_soniox`, signed out and with `&signedin=1`: the same account row in the Simple layout.
   - Compare the account row's markup with the old `ProviderSection` row (the memory rule: match sibling markup), and the "Recommended" tag with the old picker's.
5. **The countdown and the one notice, on the leased fake:** `/?preview=spine&panel=1&provider=fake_leased&signedin=1&settings=advanced` with "Lease ends after" 30 000 → Start → both footers (basic, and `&ui=advanced`) show `00:30` counting down, `low` under 6 s; at 0 the idle line reads "Your session balance is used up. Top up your balance to keep translating." In Both mode (the mode picker, the shared-session knob on) the lease's end appears once, on the speaker's side (ruling 7).
6. **The participant switch:** with Kizuna Soniox selected, Settings' "Speak Other's translation" is off and disabled with the "not available yet" tooltip; with the leased fake or LocalInference it is as before. The flag-on side is `kizunaParticipantSpeech.test.tsx`'s (Task 8): no build carries a flag-on Kizuna Soniox.
7. **The wizard** on a fresh profile at `/` (first run): the path step offers "Start right away" (Recommended), "I have my own API key", "Free, offline"; choosing the first reaches the account step with "Sign in" and "Create account" — never pressed.
8. The one-key spot-check list Task 4's implementer reported, handed to the owner.

---

### Task 13 (controller): the spec's amendments and the roadmap's record (ruling 14)

**Files:** Modify `docs/superpowers/specs/2026-09-22-client-contract-design.md` and `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`.

- [ ] **Step 1: The spec.**
  1. **"The shape"**, the code block: `interface Provider<S, K, C, R = K>`; `read(values, ctx): R | { missing: string; code?; params? }`; `check(r: R, s: S, { pair, legs, signal })`; after `turns(s)`: `participantSpeech?: boolean              // false: the participant never speaks (a flag, off for Kizuna Soniox until par_tts)`. After the Soniox plan's note: "**Amended by the Stage 2 Kizuna Soniox plan:** the read type `R` (a managed `read` answers the sign-in; `managed.ts`'s `ManagedSignIn`); `participantSpeech?: boolean`; `AuthContext.loaded?`; `SessionHooks.minimumBalance`; `Resources.budget` as `{ totalMs, endsAt }`; `acquire`'s context `{ signal, clock, end(notice), frame(frame) }`; `RunShape.account?`; `RunState.running.budget?`."
  2. **"Managed twins are composition"**, a paragraph after the first: "`managed(base, overrides)` lives in `src/lib/provider/managed.ts` and names what a twin takes from its base — languages, capabilities, builder, adapter, `startBoth`, turn detection, the settings' defaults and migration — and what is its own: id, kind, vendor, icon, storage key, `Settings`, a sign-in `read`, a static `check`, and its hooks, `acquire` required. A twin's `read` answers the sign-in, a type of its own (`R`); its `start` receives the keys its lease mints (`K`). It inherits neither the base's guide, locale key nor presence knobs."
  3. **"Readiness is one check"**, after "…and `check` is never called.": "While the sign-in is still loading at launch, `read` answers `sign_in_pending` (`AuthContext.loaded`), so a signed-in user is never told to sign in. A managed `check` is static: the balance is the start gate's input (`RunShape.account`, from the account's wallet as last fetched), never readiness — an unknown balance gates nothing, and the lease's 402 words a refusal."
  4. **"A run"**, the numbered steps become

     ```
     1. gate(shape)                        stores' refusals, the balance floor last
     2. provider.check                     readiness; the local engines' re-validation
     3. session.prepare?(shape, s, signal) managed voice claim → a run-only override
     4. provider.build(context, S) per leg a refused leg fails the start (D22)
     5. session.admit?(configs)            cross-leg: local memory, Local Native's single leg
     6. every leg's source, when a lease   mic / system audio / tab             defer(stop)
        follows or startBoth takes both
     7. session.acquire?(shape)            managed lease → one K per leg        defer(release)
     8. the legs become the conversation
     9. every leg, in parallel:
          openSource(leg), if not yet     (a provider with neither)            defer(stop)
          provider.start(request)          (or session.startBoth)               defer(session.stop)
          wire: source → turn gate → appendAudio; events → L1; audio → ClipQueue
     10. every leg live → running. Any leg failing → unwind, the start fails (D22)
     ```

     and "**Order removes the lease race.**" becomes: "**Order removes the lease race.** The lease is minted after every source has opened — a source that fails (a denied loopback, no bound tab, a capture helper that will not start, a missing microphone) mints no key, and so leaves no never-started lease that the backend's sweeps never reach and that 409-locks the next Start until its initial expiry — and pushed before the legs' sessions, so it is released after they have closed. With the signal reaching every step, no leg opens after `session-end`, and the lease drops any `session-started` a closing socket would still report. A refused lease leaves the last conversation on screen: the legs become the conversation only once it is held. `prepare` stays before the sources: its override feeds the builds, which must refuse before anything opens (Stage 2 Kizuna Soniox, ruling 9)."
  5. **"Legs rise and fall together"**, "The leg records why as a Notice on its L1." becomes "The leg records why as a Notice on its L1 — a lease's end once, on the first leg: it covers every leg, and the same sentence twice in Both says nothing more (Stage 2 Kizuna Soniox, ruling 7)."
  6. **"Session hooks on the provider definition"**, the code block: `prepare?(shape, s: S, signal: AbortSignal): Promise<{ override?; persist?; notice? }>`, `acquire?(shape, s: S, ctx: { signal; clock; end(notice); frame(frame) }): Promise<Resources<K>>`, `minimumBalance?(shape: { legs; textOnly; participantSpeech }, s: S): number`; `Resources<K>`'s `budget?: { totalMs: number; endsAt: number }   // the grant: static, measured from acquire`. The `acquire` bullet: "`release` sends `session-end` with `keepalive` and the token cached at acquire, so `pagehide`'s synchronous release still reaches the backend; it retries a transport failure or a 5xx, three attempts at most within 4 s, and the next acquire cancels a release still retrying — `session-end` is scoped by account, and a late one would end the next lease. `session-end` is a hint: a lease that never started (no stream accepted) is freed only at its start window's end, which is why the sources open first. `end(notice)` stops the run when the grant ends; Kizuna Soniox words it at acquire — `segment_ended` when the grant reached the per-session cap, `budget_exhausted` otherwise — and its budget timer and a 403 at the grant's end give the same words." The `minimumBalance` bullet: "managed providers' start floor, read by the start gate over the account's wallet as last fetched; nothing is gated on an unknown balance. Kizuna Soniox prices the roles its lease would ask for (`ceil((n_stt × 1.1 + n_tts × 1.4) × 10⁶ × 60 / 3600)` µUSD), so a participant speech stream counts once its flag is on."
  7. **"The runner"**, `RunState`: `| { phase: 'starting'; step: 'checking' | 'preparing' | 'opening'; loading? }` and `| { phase: 'running'; since: number; legs: Record<Leg, LegState>; budget?: { totalMs; endsAt } }`.
  8. **"Stopping, and closing the window"**, the `pagehide` bullet adds "with the token cached when the lease was acquired: there is no time for an await".
  9. **"Parameters and deferred decisions"**, "Release timeouts and the lease's retry policy" becomes "decided by the Stage 2 Kizuna Soniox plan: each release bounded at 5 s; `session-end` three attempts within 4 s".
  10. **"Stage 2 — open for the plans that meet them"**: "Participant speech against the managed lease" becomes "— decided by the Kizuna Soniox plan (ruling 2): built end to end — the request's intent field, the participant's `par_tts` key in every Both mode and participant-only, floors counted from the roles — and shipped off behind the definition's `participantSpeech` flag until the backend mints `par_tts` (the roadmap's "turning it on" checklist)"; "`minimumBalance`, `Resources.budget` and `RunState.running.budget`" becomes "— in the types since the Kizuna Soniox plan"; item 8's "a managed `K` carries `getToken` and calls it lazily" becomes "a managed `read` answers the sign-in (`R`), and the lease reads the token from the run's `auth` when it mints `K`".
  11. **"Session hooks"**, after the `acquire` bullet, a note on the backend's answers (survey §7.11): "The session key's refusals are 401, 402, 403, 409 (retried once) and 503 — no 423 — and the backend's 503 has three causes (region, wallet, capacity) that Kizuna Soniox still words as one, as the old client did."
- [ ] **Step 2: The roadmap.** Append `## Scheduled by the Stage 2 Kizuna Soniox plan`, in the form of the entries before it:
  - **What landed:** the commits and the tasks, and their fix rounds; the rulings as the owner confirmed or overturned them.
  - **What was checked:** group checks A and B — the leased fake's refusal, floor and countdown in the preview; Kizuna Soniox's Provider tab signed out and signed in with no `/soniox/` request; the wizard's managed path; the participant switch; both bundles with the lease (`session.lease_acquired`) and without either fake.
  - **Stated departures:** this plan's self-review list.
  - **The locale spot check:** the 29 non-`en` values of `audioPanel.participantSpeechNotYetAvailable` Task 4's implementer reported, for a native speaker.
  - **Managed participant speech — turning it on** (ruling 2; survey §4.1's option c, as a checklist), in order:
    1. The backend mints `par_tts` for split Both and participant-only, and a second shared TTS stream for shared Both, with start floors and TTS concurrency for them (the role expansion in `BE:config/soniox.ts:372-393`, `computeSessionBudget` in `BE:routes/soniox.ts:46-92`). The client assumes the role is `par_tts` in every mode; confirm it.
    2. Confirm the request field's name, and change `PARTICIPANT_SPEECH_FIELD` (`src/providers/soniox/leaseRequest.ts`) if the backend chose another.
    3. Flip the flag: `KIZUNA_PARTICIPANT_SPEECH = true` (`src/providers/soniox/kizuna.ts`).
    4. Update the floor-parity constants and cases (`kizunaBudget.test.ts`, "prices the participant's speech stream…") to the backend's own floors for the new role.
    5. Decide the participant's voice: Soniox's builder gives both legs the region's voice field (`config.ts:153-155`), so the other party would speak in the user's clone — and the voice claim (`voiceClaim.ts`) claims it only for a speaking speaker, so a speaking participant on a clone the pool evicted would go unclaimed. A built-in voice for the participant may be wanted instead.
    6. Run the participant-speech live items: the switch enabled under Kizuna Soniox; in split Both, shared Both and participant-only, Other's translation spoken on the real device through its own TTS socket (`par_tts` in the Logs' `session.lease_acquired` roles); the floors in Start and the account button's dot counting the extra stream; a missing `par_tts` saying `tts_degraded` once.
  - **Before any release from the branch — the release flags** (ruling 6, the owner's decision): replace the foundation's and the Soniox plan's open item "the release flags and the registry's final order" with the decision — the order `kizunaai_soniox`, `localInference`, `soniox`; D19's model kept (offered by default, `flagged: true` hides, `VITE_ENABLED_PROVIDERS` un-hides and stays unset); the target state as ruling 6 states it (managed = Kizuna Soniox only, the two relay-managed providers deleted, Local Native flagged with its tester switch, everything else unflagged); and the cleanup at Stage 2's end — the per-provider `VITE_ENABLE_*` lines out of `.github/workflows/build.yml`, the matching repo variables deleted by the owner, `VITE_ENABLE_KIZUNA_AI` kept.
  - **The roadmap's inheritance:** this plan's table "The roadmap's inheritance, item by item", as landed.
  - **The owner's paid live test** (survey §5.2's list, adjusted to the rulings):
    1. **Signed out, loading, signing in:** at launch a signed-in account shows the spinner "Checking..." then "Automatically authenticated via your account", never "Sign in…"; signed out, Start is off with "Sign in to use Kizuna AI's built-in translation service." and the row's link opens the account popover; signing in enables Start at once.
    2. **Floors:** a balance below the text-only floor ($0.018334); between the text-only and speech floors, where Text only flips Start; the split floor in Both with the shared session off ($0.06 speaking); a frozen wallet ("Wallet is frozen. Please contact support."); an unknown balance (offline at launch) leaves Start on and the backend's 402 words it. The account button's dot matches Start each time.
    3. **Each mode** (speaker speaking and text only; participant only; shared Both; split Both): the Logs show `session.lease_acquired` with its roles and one `session.started` per role, no `session.started_refused` (no 400 `role_required`); one STT socket in shared Both, two in split.
    4. **The countdown** in both footers, low under 20 %. **The grant's end (ruling 3):** a small balance → "Your session balance is used up. Top up your balance to keep translating."; a speaking session held to the one-hour cap (a balance above about $2.50) → "This segment has ended — tap Start Session to continue."; a Both session shows the notice once (ruling 7).
    5. **A second device:** 409, one retry after about 3 s (Logs `session.retry`), then "Another session is already running on your account…".
    6. **Stop while starting** (during the session key): no `session.started` after `session.end`; Start again at once: no 409. **A failing source, then Start again at once** (ruling 9): in Both, with a participant source that fails — Screen Recording denied on macOS (`LOOPBACK_DENIED`), or the extension's side panel with no bound tab — the start fails naming the participant, no `session.lease_acquired` in the Logs; press Start again at once and expect no 409.
    7. **The voice claim:** "Preparing your voice…" on the button; a warm clone; an evicted clone rebuilt from this device's clip; another device with no clip → the built-in voice and "This device has no voice recording…"; a busy pool. The managed preview: its 402 and 409 words, played on the selected output device.
    8. **EU and JP accounts:** the claim and the session in that region (Logs `session.lease_acquired` region).
    9. **Close the side panel, or the app, mid-session:** `session-end` reaches the backend (its lease shows `end_signalled`), and the next Start is not locked. This settles the `keepalive` + CORS preflight question per embedding (web, extension, Electron).
    10. **A network drop:** the connection-lost words; a managed 503 is not resumed.
    11. **The wizard:** the managed path (Recommended), the sign-in at the account step, Finish, the subtitles-only fit.
    12. **Participant speech, shipped off (ruling 2):** under Kizuna Soniox the switch is off and disabled with the "not available yet" tooltip, the participant never voiced, and the session-key body carries no participant field (the Logs' request); switching to own-key Soniox shows the stored choice again.
    13. **The extension side panel:** the core flows.
    14. **Analytics (ruling 8):** `translation_session_start` with `provider: 'kizunaai_soniox'` and its models; a refused start reaches `error_occurred` only; a budget exhaustion sends no `api_error`.
    15. **The sign-in auto-switch (ruling 4):** Basic mode on LocalInference, sign in → Kizuna Soniox selected, `settings_modified` tracked; not in Advanced mode; not under the wizard; not at a launch with a stored session.
  - **Open questions for the owner:** the rulings, as confirmed; analytics for a refused start and a budget exhaustion (ruling 8), with Plan A's `degraded` — one cross-provider decision; the loading sign-in's "Checking..." (choice 10); the 503's three causes in one sentence (parity); fencing `session-end` by `leaseId` on the backend (survey §1.2); the backend minting `par_tts` and the participant's voice (the "turning it on" checklist); whether the lease's module joins the session-side clock guard (`sessionSide.consistency.test.ts`, roadmap `:1275`).
  - **Plan B2's inventory:** survey §3 — §3.1's files and their fates, §3.2's keep-list and re-points **including `SonioxVoiceSection.tsx:47`'s `clampNumber` → `src/providers/soniox/config.ts`** (missing from the Soniox plan's list), §3.3's order, §3.4's typecheck effect (about 114 full-tree lines after); plus what this plan adds to it: the two stubs `src/services/clients/{ManagedVoicesClient,managedVoicePolling}.ts` (re-point `voiceLibrarySource.ts:16, 23` and the tests that import them first), and the old `src/services/providers/managedVoicePrep.ts` with its test, whose port is `voicePrep.ts`.
  - **What it leaves:** "What this plan leaves" below, verbatim.
- [ ] **Step 3: Commit.**

  ```bash
  git add docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md
  ```

  ```bash
  git commit -q -F - -- docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md <<'EOF'
  docs(spec): managed twins, the lease's order and its budget

  The shape gains the read type, the participant-speech flag, the
  sign-in's loading state and the lease's budget and frames; a run opens
  its sources before it mints a lease and records a lease's end once;
  session-end's retry policy and the grant's end words are decided. The
  roadmap records the Kizuna Soniox plan, the owner's paid live test and
  Plan B2's inventory.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

## The roadmap's inheritance, item by item

Survey §2.12, carried: taken (and where), deferred (and why), or already done.

**From the foundation plan's Kizuna Soniox list** (roadmap `:1262-1283`):

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
| `NOTICE_TARGETS.sign_in_required` (roadmap: "the account popover"); the `sonioxVoice*` aliases | taken — Task 8, with the target `'provider'`, not the popover: a Settings target names a Settings section and the popover is none; the provider section's account row carries the sign-in link, which opens the popover |
| `&signedin=1` reaches the `&settings=` blocks | taken — Task 9 (`AuthStandIn`), with the voice source's stand-in so no preview calls `/soniox/voices` |
| The lease's timers on `ctx.clock`; extend the session-side guard? | timers taken (Tasks 5–6); the guard **deferred**: an owner option (the lease is not reached by `adapter.ts`, and the spec exempts hooks); recorded as an open question |
| `NETWORK_READINESS_DELAY_MS` (800 ms) | moot for Kizuna Soniox (its `check` is static); stays a live-test observation |
| Participant speech against the lease | ruling 2 — built end to end, shipped off behind one flag: Tasks 1, 4, 5, 8; turning it on is Task 13's checklist |
| The sign-in auto-switch | ruling 4 — Task 12 |
| The registry's final order | ruling 6 — Task 8 |
| Nothing account-mutable in a ready answer | done by design: the `check` is static, the balance is the gate's input |
| A check that threw leaves a managed provider not-ready | moot: a static check never throws. The analogous stuck state (the quota fetch offline) gates nothing (ruling 5) |
| A managed provider wanting a re-check on a balance change | moot: the balance is the gate's input, live through the account store (Task 3) |
| `AuthContext` pending state | taken — Task 1 (`loaded`), Task 9 (the bridges, the row), Task 8 (`sign_in_pending`'s alias) |

**Parked from the task reviews** (roadmap `:1320-1350`):

| Item | Disposition |
|---|---|
| The leased fake: no refused `prepare` / `acquire`; no two-leg run through the runner | `acquire`'s refusal and the two-leg run taken (Task 2); a refused `prepare` deferred: `prepare` has no refusal path (it answers a notice and never throws, as Kizuna's claim does) |
| Its inert "Require an API key" toggle | deferred: not Kizuna's |
| The account's compile-time narrowing | deferred: Plan A left it, and nothing here needs it |
| Readiness during a run | unchanged |

**From Plan A's "What it leaves → Kizuna Soniox"** (roadmap `:1728-1738`):

| Item | Disposition |
|---|---|
| F11, whole | taken — Tasks 1–3, 8–10 |
| The lease behind `SonioxLeasePort` | taken — Task 6 |
| Per-leg `K` (`mix_*` / `spk_*` / `par_stt`), `credentials('participant')` not throwing in shared Both | taken — Task 5 |
| `K.tts` absent while speaking | taken — with the flag on and no `par_tts` in the answer, the participant's leg runs text-only through Plan A's `tts_degraded` (Task 5's keys, Task 8's spec); with the flag off its context asks for no speech, so nothing is said (Task 4) |
| The voice claim and the managed voice source | taken — Task 7 (and Task 8's view) |
| The `sonioxService*` / `sonioxVoice*` aliases, `insufficient_balance` and the other lease words, `sign_in_required`'s target | taken — Task 8 (the lease words were aliased by the foundation plan) |
| The wizard's managed path; `providerFits` for a managed id | taken — Task 11 (`providerFits` answers once Kizuna Soniox is registered, Task 8) |
| The registry's order and the release flags | ruling 6 — Task 8 |
| Deleting both providers' old code | Plan B2, after the paid live test (D11 as amended) |
| The keep-list and its re-points | Plan B2's inventory (Task 13), with the re-point the list missed (`SonioxVoiceSection.tsx:47`) |

**"Found here", "Before any release" and the open questions** (roadmap `:1740-1772`):
- Plan A's live test comes before this plan's execution (ruling 13, the header).
- The release flags and the order: ruling 6 (unflagged, Kizuna Soniox first).
- `setup.paths.own-key.desc`: Plan A's (or the release's), not Kizuna's.
- Analytics for `degraded`, the locale check and `FIN_TRANSLATION_GRACE_MS`: Plan A's open questions, unchanged; this plan adds its own analytics question (ruling 8).
- Plan A's "Found here" items are Soniox's, untouched here.

## What this plan leaves — for the plans that meet it

**Plan B2 — deleting both Soniox providers' old code**, written after this plan lands and the owner's paid live test passes: survey §3 is its inventory (Task 13 records it, with this plan's two stubs and the old `managedVoicePrep.ts`). Its order (survey §3.3): re-point the kept importers, unregister, delete the clients, descriptors, helpers and their tests in one commit, delete the MainPanel split chips and `participantErrorOrdering.test.ts`, delete the stubs; gates, builds, a bundle grep for a string only the old client carried.

**Found here, for the owner or a later plan:**
- **The voice pin's 75 s** (`BE:config/soniox.ts:685`): the claim runs before the sources (ruling 9), so the one prompt that can wait at Start — a first-time microphone prompt, the speaker's leg in every mode — left unanswered for more than about a minute can let the pin lapse before `session-started` extends it. Eviction happens only under pool pressure; the live test's item 7 watches for it.
- **A start that fails after the lease is minted** (a socket that will not open) still leaves a never-started lease, freed only at its start window's end (75 s, or 195 s with `par_stt`); ruling 9 removes only the source-side cause.
- **A silent session never extends its lease** (parity, `ManagedSonioxSession.ts:463-471`): a muted microphone sends no frames, so no `session-started`, and the lease dies at its start window while the socket streams. Push-to-talk (new for Soniox) makes long silences likelier.
- **The backend's comments disagree with the client** (survey §1.12.1–2): `session-end`'s body is ignored (it cannot be fenced to a lease), and `session-started`'s comment says no client sends the role.
- **Throttled timers:** a background tab may delay the budget's timer; the 403 path then ends the run, with the same words (Tasks 5–6).
- **MainPanel's participant replay slot** follows the routing switch, not the flag: under Kizuna Soniox, while the flag is off, it is offered for a leg that never has speech, and so never shows a replay button.
- **The participant's voice, once the flag is on:** Soniox's builder gives both legs the region's voice field (`config.ts:153-155`), so the other party would speak in the user's claimed clone — the "turning it on" checklist's item 5.

**Stage 2 items from the roadmap this plan does not take:** the kit's parked items (`{ flush: true }` after an awaited answer, `FakeSocket`'s close codes, the virtual clock's `pending()` count, manual-end's segment check); the account's compile-time narrowing; `RunnerDeps.replayAudio`'s guard; the notice-code namespace.

## Self-review

**Coverage of survey §5.2 (B1's outline) and the rulings:**

| Item | Where |
|---|---|
| §5.2.1 contract and runner: `minimumBalance`, `Resources.budget` → `RunState.running.budget`, `acquire`'s frame, `R` with a type test, one lease notice, sources before `acquire`; the leased fake's `acquireRefused`, budget, frames; the runner tests | Task 1 (types), Task 2 (runner, leased fake) |
| §5.2.2 the account store and the gate: the store fed by `UserProfileContext`, `RunShape.account`, the floor via `minimumBalance`, `appSubtitleSession` subscribing | Task 3 |
| §5.2.3 the lease: request, session key with timeout and 409 on the clock, codes, per-leg `K`, ports, the 90-s margin, cutoff, budget timer, release | Task 5 (minting, grant, release), Task 6 (ports, margin, cutoff) |
| §5.2.4 the voice modules: `git mv` with stubs, `voicePrep.ts`, the `prepare` hook, `startLabel` | Task 7 |
| §5.2.5 the managed voice source and view | Task 7 (the hook), Task 8 (the view) |
| §5.2.6 the definition: `managed()`, `kizunaSonioxProvider`, the capability, the registry and order, the aliases and targets | Task 1 (`managed`), Task 8 |
| §5.2.7 the UI: the account row with pending, "Recommended", `SessionCountdown` in both footers, `AccountButton`, `ParticipantSpeechSwitch` | Task 9, Task 10, Task 4 |
| §5.2.8 the wizard and selection, the auto-switch | Task 11, Task 12 |
| §5.2.9 the group checks | Group checks A and B |
| §5.2.10 the docs task and the paid live test | Task 13 |
| Rulings 1–14 | 1: Global Constraints, Task 7. 2: Tasks 1, 4, 5, 8, Task 13's checklist. 3: Tasks 5, 6. 4: Task 12. 5: Tasks 3, 5. 6: Tasks 3, 8. 7: Task 2, Task 13. 8: Task 2 (the pinned events), the departures, Task 13. 9: Task 2, Task 13. 10: Tasks 1, 5, 7. 11: Task 8 (and Task 4's key). 12: every test; Task 9; the group checks. 13: the header. 14: Task 13 |
| Survey §7 spec corrections | Task 13, items 1 (§7.1), 6 (§7.2, §7.3), 4 (§7.4, §7.10), 7 (§7.5), 5 (§7.6), 3 (§7.7, §7.9), 10 (§7.8), 11 (§7.11) |

**The old tests ported as behaviour specs** (survey §1.13):

| Old test | Now |
|---|---|
| `ManagedSonioxSession.test.ts:122-290` (body, bundles, contract breaks, codes) | Task 5, cases 1–5 |
| `:293-446` (timeouts, the 409) | Task 5, cases 6–9 |
| `:449-615` (`session-started`, `end` once) | Task 6, cases 1–4; Task 5, case 13 |
| `:617-669`, `ManagedSonioxSession.outcome.test.ts` (snapshot, exhaustion once, margin, one announcement) | Task 5, cases 11–12; Task 6, cases 5–6; Task 2 (one notice) |
| `:671-716` (region) | Task 5, cases 2–3 |
| `SonioxCostMeter.test.ts` | replaced: the budget is the grant's duration (Task 5, case 11; survey §2.2) |
| `SonioxClient.managed.test.ts:137-184` (keys only minted) | Task 5, case 3; Task 6, case 8 |
| `:202-277, :495-514` (exhaustion ends gracefully, once) | Task 2 (runner); Task 8, case 6 |
| `:516-685` (accepted only; own role per leg) | Task 6, cases 1, 7; the adapter case |
| `:686-1005` (one announcer) | Task 2, ruling 7 |
| `acquireSessionResources.kizunaSoniox.test.ts` | Task 5; Task 8, case 6 |
| `prepareToStart.kizunaSoniox.test.ts` | Task 7, `voiceClaim.test.ts` |
| `managedVoicePrep.test.ts` | Task 7, `voicePrep.test.ts` (copied) |
| `managedSonioxSplit.test.ts` (matrix) | Task 5, case 1 |
| `sonioxManagedMinBalance.test.ts` | Task 5, `kizunaBudget.test.ts` (today's floors pinned; the future role's priced and marked so) |
| `managedSonioxSplit.test.ts` | Task 5, `leaseRequest.test.ts` (the matrix, byte for byte with the flag off) |
| `kizunaProviderGating.test.ts` (sign-in default, `'kizunaai'`) | Task 11 (selection); Task 8 (registry invariants) |
| `ProviderSpecificSettings.soniox.test.tsx` (managed source keyed on `userId`) | Task 7, `managedVoiceSource.test.tsx` |
| `ProviderSection.signIn.test.tsx`, `ProviderSection.recommended.test.tsx` | Task 9 |
| `AccountButton.test.tsx` | Task 10 (re-pointed) |
| `SessionCountdown.test.tsx` | Task 10 (rewritten for `budget`) |
| `ManagedVoicesClient.test.ts`, `managedVoicePolling.test.ts` | Task 7 (moved) |

**Quirks not ported** (survey §1.14): the 409 wait and the session key now take the run's signal (Task 5, case 9); `session-end` retries with `keepalive` (case 14); a 401 is `sign_in_required`, not English; the countdown still runs from acquire (parity, recorded); the announcer bit is gone (ruling 7's one notice on the first leg).

**Placeholders.** Three are deliberate:
- `voicePrep.ts` and `voicePrep.test.ts` are copies of `managedVoicePrep.ts` / `.test.ts` (289 and 337 lines) with the edits written out (Task 7, Step 3).
- The 29 non-`en` values of the one key are written out in Task 4; a native speaker checks them.
- Task 13's roadmap prose is the controller's, its contents listed; the spec's amendments are written out. Each commit's body is written; an implementer may tighten one but keeps its subject.

**Types across tasks:**

| Produced | Consumed by |
|---|---|
| `Provider<S, K, C, R>`, `participantSpeech?`, `AuthContext.loaded?`, `AnyProvider` (Task 1) | every definition; Tasks 4, 8, 9 |
| `readCredentials<S, R>` (Task 1) | `run.ts`, `providerStore.ts`, `StepCredentials.tsx` (as before) |
| `ManagedSignIn`, `readSignIn`, `ManagedOverrides`, `managed` (Task 1) | Task 8 |
| `AccountBalance`, `RunShape.account?`, `BalanceShape` (Task 1) | Tasks 3, 5, 10 |
| `Budget`, `Resources.budget?`, `RunState.running.budget?` (Task 1) | Tasks 2, 5, 10 |
| `LeaseContext`, `SessionHooks.acquire(…, ctx: LeaseContext)`, `SessionHooks.minimumBalance?` (Task 1) | Tasks 2, 3, 5, 6, 8 |
| `Run.budget`; `FakeLeasedSettings.acquireRefused` / `.minimumBalanceMicroUsd` (Task 2) | the runner; Task 3's tests; the group checks |
| `useAccountStore`, `GateInput`, `BALANCE_BELOW_FLOOR`, `balanceRefusal` (Task 3) | Tasks 8, 10; the runner's gate |
| `participantSpeechFromStores` (Task 4) | `readShapeFromStores`; Task 3's live gate; Task 10's `useBalanceShortfall` |
| `audioPanel.participantSpeechNotYetAvailable` (Task 4) | the switch; Task 8's spec; Task 13 |
| `PARTICIPANT_SPEECH_FIELD`, `LeaseRequest`, `leaseRequest(shape, s, participantSpeech)`, `requestBody`, `requestedRoles`, `roleFor`, `SttRole`, `StreamRole`, `STREAM_ROLES`, `isSttRole`, `sideOf` (Task 5, `leaseRequest.ts`) | `kizunaBudget.ts`, `lease.ts`; Task 8's spec |
| `sonioxStartFloorMicroUsd`, `sonioxRolesFloorMicroUsd`, `kizunaSonioxMinimumBalance(shape, s, participantSpeech?)`, `sonioxSessionCapSeconds`, the rate and cap constants (Task 5) | Tasks 5, 8 |
| `createKizunaLease({ participantSpeech?, fetch?, apiUrl? })`, `KizunaLeaseDeps`, `SESSION_KEY_TIMEOUT_MS`, `DEFAULT_CONFLICT_RETRY_MS`, `SESSION_END_BUDGET_MS`, `SESSION_END_RETRY_DELAYS_MS` (Task 5) | Tasks 6, 8 |
| `GRANT_END_MARGIN_MS`, each role's `SonioxLeasePort` (Task 6) | the adapter (Plan A's seam) |
| `ManagedVoicesClient`, `managedVoicePollDelayMs` (moved), `prepareManagedVoice`, `voicePrepCode`, `VoicePrepNoticeCode`, `resolveVoicePrepOutcome`, `createKizunaVoiceClaim`, `VoiceClaimDeps`, `useManagedVoiceSource`, `setManagedVoiceStandIn` (Task 7) | Tasks 8, 9; the old code through the stubs |
| `KIZUNA_PARTICIPANT_SPEECH`, `createKizunaSonioxProvider({ participantSpeech })`, `kizunaSonioxProvider`, `KizunaSonioxSettingsView` (Task 8) | the registry; Tasks 9–12; Task 13's checklist |
| `ManagedAccountRow`, `AuthStandIn`, `useAuthContext` with `loaded` (Task 9) | the picker; the preview |
| `SessionCountdown({ budget, now? })`, `useBalanceShortfall` (Task 10); `selectedFromStores` exported (Task 10) | the footers; `AccountButton`; the live gate and the hook share the lookup |
| `managedProvider`, `availablePaths`, `managedOption` (registry), `MANAGED_LEGACY_IDS`, `selectionFromStored(…, managedDefault?)` (Task 11) | the wizard; `loadStores.ts` |
| `signInSwitchTarget`, `useSignInProviderSwitch` (Task 12) | `MainLayout` |

**Stated departures from today:**
- Kizuna Soniox runs on the new session; its old client, descriptor, helpers, settings UI and store slices stay compiled and unreachable until Plan B2.
- **The registry offers Kizuna Soniox first** (ruling 6): a fresh install outside the wizard lands on it, signed out, Start off with the sign-in words. It is unflagged, present wherever the Kizuna umbrella is on.
- **Sources before the lease** (ruling 9): a source that fails mints no key, so it no longer leaves a never-started lease that 409-locks the next Start for 75 s (195 s with `par_stt`). A refused lease, or a source failing before it, leaves the last conversation on screen; **own-key Soniox in Both mode** now hands its legs over after both sources opened too, so a failing participant source no longer clears the last conversation (choice 3).
- **A lease's end is recorded once, on the first leg** (ruling 7), where every leg recorded it.
- **The grant's end is worded at acquire** (ruling 3): "segment ended" at the per-session cap, "balance used up" otherwise; the old client said "balance used up" at the cap too.
- **Analytics** (ruling 8): a refused start reaches `error_occurred` only, where the old client also sent `api_error`; a budget exhaustion sends no `api_error{code: budget_exhausted}`.
- **The managed participant is never voiced** (ruling 2), as before — its speech is built but shipped off — and now the switch says so: off and disabled with a "not available yet" tooltip. With the flag off the session-key body is byte for byte today's.
- **An unknown balance gates nothing** (ruling 5), where the old gate refused with "Unable to load quota information".
- **The gate's balance words** are the old gate's ("Insufficient balance: $x"); a frozen wallet's are "Wallet is frozen. Please contact support.", now also refused at the gate, before a request.
- **A 401 from the session service** is worded "Sign in to use Kizuna AI's built-in translation service." (the old client showed an English string); a transport failure "The connection to the provider failed: …".
- **A contract break in the session key's answer fails the start** (ruling 10): no flat-field or region fallback.
- **`session-end`** is sent with `keepalive`, from a closing page too, retried within 4 s and cancelled by the next lease; the old client sent it once, never from a closing page.
- **"Preparing your voice…"** shows briefly on every Kizuna start (choice 16), where the old app showed it only while a clone was claimed.
- **The loading sign-in** shows "Checking..." with a spinner, not the sign-in words (choice 10).
- **The account button's dot** is the start gate's own answer for the selected provider and legs (choice 9), where it used the lowest floor. A frozen wallet lights no dot, where the old one lit for a frozen wallet whose balance was below the floor (`AccountButton.tsx:133-138`): the gate refuses it with its own words instead.
- **"Recommended"** returns to the picker's first managed provider; **the wizard's managed path** returns.
- **A stored `'kizunaai'` or relay-twin id** selects Kizuna Soniox on load (choice 13), without writing it back.
- **The sign-in auto-switch** returns for Basic mode, and no longer fires at a launch with a stored session (choice 14).
- **`translation_session_start`** reports `provider: 'kizunaai_soniox'` with Soniox's models.

**Checked against the code while writing** (at `a63c366b`):
- the suite's totals (479 files passed, 1 skipped; 6 094 tests passed, 2 skipped; no unhandled errors), the widened gate's 18 lines and the full tree's 259, all measured;
- `run.ts:180-252` (the acquire block, the conversation hand-over at `:212`, the `startBoth` branch), `:353-383` (`openLeg`, `openSource`); `runner.ts:179-182, 241` (the running state and its spread);
- `session/types.ts:13-100` and `provider/types.ts:46-51, 161-298`; `credentials.ts:10-22`; the `Provider<S, never, never>` picks in `presence.ts:22`, `languages.ts:12`, `shared.ts:19`, `soniox/settings.ts:117, 194`;
- `leased.ts:62-111` and `leased.test.ts:99, 111, 119, 128` (the four hand-built acquire contexts);
- `shape.ts:14-66`, `appShape.ts:34-90`, `lib/subtitle/appSession.ts:26-60`, `subtitle/session.ts:57-84` (the refusal precedes readiness), `settingsStore`'s `subscribeWithSelector` (`:697`);
- `UserProfileContext.tsx:76, 106-269`; `utils/formatters.ts` imports nothing (`formatUsdFloor` at `:143`);
- Soniox's `adapter.ts:80-87, 248-265, 290-350, 488-510` (the lease seams, the shared participant's credentials read only for `tts`, `region`, `clientReferenceId`), `settings.ts:95-115`, `config.ts:155` (`sharedBoth`);
- `ManagedSonioxSession.ts:320-780`, `KizunaAISonioxProviderConfig.ts:96-214`, `managedVoicePrep.ts` (whole), `ManagedVoicesClient.ts:30-386`, `managedVoicePolling.ts` (no imports), `sonioxManagedMinBalance.ts` and its test;
- every importer of the three managed voice modules, and that no test mocks `ManagedVoicesClient` or `managedVoicePolling` by path;
- `noticeText.ts:81-95` and its test's "every alias names a sentence in all 30 locales"; `noticeTargets.test.ts`'s last case; every reused key in `en` (`mainPanel.sonioxService*`, the four `sonioxVoice*`, `mainPanel.insufficientBalance`, `update.checking` in all 30, `simpleSettings.autoAuthenticated`, `common.signInRequired`, `simpleSettings.recommended` / `recommendedOption`, `simplePanel.preparingVoice` / `mainPanel.preparingVoice`), and that no existing sentence fits ruling 2's tooltip;
- `audioPanel.participantSpeechBlockedWholeSystem` is followed by `audioCaptureUnprovenNotice` in the catalogs (not last);
- the classes the account row and "Recommended" use live in `Settings.scss` (`:1527, 1656, 1858, 1888, 1911`), which `ProviderPicker.tsx` imports;
- `ProviderPicker.tsx:94-132, 182-203`; `useAuthContext.ts`; `useAppSession.ts:20-24`; `session.ts:221-236`; `SpinePreview.tsx:118-135, 299-320`;
- `PanelFooter.tsx:140-151, 229-240`; `SessionCountdown.tsx` (mounted nowhere); `AccountButton.tsx:14-40, 113-138` and its test's mocks (`:41-62`);
- `ParticipantSpeechSwitch.tsx` and its only real renderer in tests being its own test (the section's tests mock it);
- `providerPaths.ts` whole, both its tests, `StepProviderPath.tsx:44-66`, `StepCredentials.tsx:52-79`, `setupDraft.ts:82-95`, `useApplySetup.ts:25-36`, `SetupWizard.test.tsx:276-310`;
- `storedSettings.ts:37-42`, `loadStores.ts:20-29` and `loadStores.test.ts`'s four first-offered assertions;
- the old auto-switch (`8044e074^:src/components/MainLayout/MainLayout.tsx:49-50, 160-199`), `useUIMode` (`settingsStore.ts:1517`), and the three `MainLayout` tests mocking `settingsStore` whole;
- the backend's values (research notes) and the extension's host permissions and CSP (the backend and the regional Soniox hosts are already listed);
- for ruling 2: Plan A's participant speech on its own TTS socket and key (`adapter.ts:80-86, 494-499`; `adapter.both.test.ts:106-124, 212-230`), the one-leg core that participant-only runs on the participant's credentials (`adapter.ts:461-468`), `config.ts:153-155` (both legs read the region's voice field), the old client's body order (`ManagedSonioxSession.ts:707-711`), the backend reading the body's fields by name (`BE:src/routes/soniox.ts:252-280`), and the floors' arithmetic for the future role (83 334, 65 000, 41 667 µUSD);
- for ruling 9: no participant source shows a dialog at Start — `electron/main.js:586` (the loopback handler), `src/lib/audio/capture/systemAudio.ts:164-166` (`LOOPBACK_DENIED` at once);
- the tests the reorder and the registry order reach outside their owners' first drafts: `runner.test.ts`'s three lease cases (`:554`, `:1130`, `:1201`; `FakeSource.stopped` at `providers/fake/source.ts:13`; `openLeg` names its leg on any failure, `run.ts:353-366`) and `localInference/provider.test.ts:95-97`;
- the auto-switch's entry: `providerStore.select` loads nothing (`:122-131`); Settings sits in a hidden `<Activity>` when closed (`MainLayout.tsx:206`); `providerLoaded` (`lib/subtitle/appSession.ts:42`); `useApplySetup.ts:30` loads before it selects;
- `selectedFromStores` (`appShape.ts:26-32`), the old dot's floor (`AccountButton.tsx:133-138`), and the backend's cap over the minted roles (`BE:src/routes/soniox.ts:84`).

**Not decided here (for the controller or the owner):**
- The rulings other than 2 and 6 (provisional; 2 and 6 are the owner's).
- "Checking..." for the loading sign-in (choice 10) — a generic word borrowed from the updater's catalogue key.
- Whether the lease module joins the session-side clock guard.
