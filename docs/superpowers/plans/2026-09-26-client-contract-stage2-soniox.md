# Client contract — Stage 2, provider 1: Soniox (own key)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soniox with the user's own key (`soniox`) as the first Stage 2 provider on the new contract: its definition, settings component and adapter — one leg, and both legs on one mixed socket or two — ported from `SonioxClient` and run live by the owner. Concretely:
- the protocol modules move into `src/providers/soniox/` and run on the request's clock and an injected socket (F18), while the old client keeps compiling through re-export stubs (ruling 1);
- TTS audio streams as it arrives, and once a TTS segment ends cleanly the adapter fills in each chunk's range after the fact through a new L0 event, `speechRanges`, so karaoke starts from where playback is, and what is already lit stays lit while the row's next sentence waits for its own fill-in (ruling 2);
- every old error and retry path is kept and mapped onto `failed`, `degraded`, `reconnecting` / `reconnected` and notice codes (ruling 3);
- the participant leg gets its own TTS socket when the participant-speech switch is on (ruling 4);
- push-to-talk works: `endTurn` sends `finalize`, and `<fin>` ends the utterance (ruling 5);
- Settings (region, voice library with its preview through `Playback.preview`, TTS speed, vocabulary, background, the shared-session toggle, and the endpoint knobs as `TurnDetection`), the registry entry, the provider-neutral Speech-mode tooltip, and the wizard's own-key path (F12);
- the seams Kizuna Soniox (Plan B) needs, each with a stub test and nothing more.

The plan ends with the controller's docs task: the spec's amendments and the roadmap's record (ruling 10).

**Architecture:**
- **One folder,** `src/providers/soniox/`:
  - the moved protocol modules — `sttStream.ts`, `ttsStream.ts`, `pcmMixer.ts`, `sideTracker.ts` (session side), `ttsRest.ts`, `voicesClient.ts` (settings side) — and `socket.ts` (the socket seam);
  - the definition's data — `settings.ts` (`S`, languages, credentials `K`), `config.ts` (`C`, `build`, `describe`), `check.ts` (a bounded key probe);
  - the session side — `utterances.ts` (tokens → segments, a pure state machine), `speech.ts` (one leg's TTS socket: streamed chunks, ranges filled in, failures, reconnect on demand), `adapter.ts` (`SonioxCore`: one STT socket serving one leg, or both legs over a mixer; `start` and `startBoth`);
  - the components — `SonioxSettings.tsx`, `SonioxVoiceField.tsx`, `SonioxTurnDetection.tsx` — and `provider.ts`.
- **The contract gains** one L0 event, `speechRanges({ ref, ranges: [{ index, range }] })`: an adapter sets ranges on speech entries it already emitted. L1 (`Conversation`) applies them — to a closed segment too — re-anchored from the text the adapter measured to the text as it now stands. The conformance kit checks it, the fake plays it (`late-ranges`), and `karaoke.ts` reads it as it reads any range, with one change: a rangeless clip of the segment already lit keeps what is lit (the hold, choice 18), so a row's highlight never blinks off between its sentences. The contract also gains `LegStartError`, by which `startBoth` names its failing leg.
- **Shared pieces built here, first user Soniox:** `framePayload` in `src/lib/contract/`; `LinesField` and `VoicePreviewContext` in `src/components/providers/`; `SettingsProps.preview` / `legs` and the app's preview route (`src/app/voicePreview.ts`, on `getAppAudio()`); two `CLIENT_DIAGNOSTICS` rows and their aliases.
- **The old BYOK and managed Soniox code stays compiled** (`SonioxClient`, both descriptors, the old settings UI): Plan B deletes both after its own live test.

**Tech Stack:** TypeScript (strict), React 19, zustand, i18next, Vitest + @testing-library/react (jsdom), the adapter test kit (`FakeSocket`, `driveAdapter`, `runScenario`, the virtual clock), the TypeScript compiler API in consistency tests, headless Chromium over the DevTools protocol (`scripts/dev/headless.mjs`) at the group checks.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — the binding authority, as amended by the Stage 2 foundation plan (above all "Readiness is one check": **`check` bounds its own request**). The parts this plan implements: "L0 — the client contract" and "What every adapter must honour"; "Turns" (Soniox: `endTurn` = `finalize`); "L1 — Re-anchoring on every text replacement"; "Playback — Routing" (the voice-preview route); "Provider capability" (Soniox's row); "The provider definition" (all of it, for one own-key provider); "Session hooks" (`startBoth`, D23); "Notices reach the user localized"; "Testing" (the fake, conformance). It amends the spec in Task 13.

**Research notes:**
- **The survey this plan is written from:** `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/stage2-soniox-survey.md`, cited as *survey §x*: §1 (the old protocol, file:line), §2 (the mapping), §3.2 (Plan A's outline — this plan's starting point), §3.4 (built vs existing), §3.6 (risks), §3.7 (spec corrections). Its line references were checked at the draft's commit, `2a8d4df1`; the two commits since (`6af75bb4`, `c91a3020`) touch only `scripts/dev/spine-audio-probe.mjs`, `WaveformStrip.tsx`, `panel/Waveforms.test.tsx` and `dev/SessionControls.tsx`, none of them cited, so every line this plan cites is the same at `c91a3020`.
- **The review** (`/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/stage2-soniox-plan-review.md`) and the controller's rulings on it are folded in; the self-review's last section lists each finding and where it landed.
- **The survey's corrections found while writing:** the locale catalogs are **30**, not 34 (`ls -d src/locales/*/` and `noticeText.test.ts:82`); `SonioxProviderConfig.ts`'s `fitContextToBudget` is module-private, so it is copied, not moved; the moved STT and TTS tests carry 20 typecheck errors today (`.at()` and an untyped `CONFIG`) that become gate lines once they sit under `src/providers` — Task 1 fixes them.
- **The roadmap:** `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`, "Scheduled by the Stage 2 foundation plan" — its **Soniox** list is this plan's inheritance; its **Kizuna Soniox** list and "Parked from the task reviews" say what this plan does not take.
- **Form models:** `docs/superpowers/plans/2026-09-26-client-contract-stage2-foundation.md` and `docs/superpowers/plans/2026-09-25-client-contract-stage1e2-local-inference.md`.

## Global Constraints

- **Starting point.** HEAD `c91a3020` on `worktree-client-contract-stage2`. Every task anchors its edits by content, not by line: a line number cited here was checked at `2a8d4df1` and is unchanged at `c91a3020` (research notes).
- **What this plan touches:**
  - `src/providers/soniox/**` (new), `src/providers/registry.ts` and its test, `src/providers/sessionSide.consistency.test.ts`, `src/providers/fake/{script,adapter,scripts,leased}.ts` and their tests, `src/providers/localInference/adapter.ts` (one import, Task 7);
  - the six re-export stubs at the moved modules' old paths in `src/services/clients/` (Task 1) — the only files under `src/services` this plan writes;
  - `src/lib/contract/{adapter,events,conformance}.ts`, `src/lib/contract/framePayload.ts` (new) and their tests; `src/lib/conversation/Conversation.ts` and its test; `src/lib/session/run.ts` and `runner.hooks.test.ts`; `src/lib/view/noticeText.ts` and its test; `src/lib/view/karaoke.ts` (the hold, Task 3) and its test; `src/lib/diagnostics/clientDiagnostics.ts`; `src/lib/provider/types.ts`;
  - `src/components/providers/{ProviderOwnSettings.tsx,VoicePreviewContext.ts,fields/LinesField.tsx}` and their tests; `src/components/Settings/sections/{VoiceLibrarySection,SpeechSection}.tsx` and their tests; `src/app/voicePreview.ts` (new) and its test;
  - `src/components/SetupWizard/{SetupWizard.tsx,providerPaths.ts,steps/StepProviderPath.tsx,steps/StepCredentials.tsx,steps/StepLanguagePair.tsx,steps/StepFinish.tsx}` and the tests named in Task 12;
  - the 30 `src/locales/<code>/translation.json` (two keys, Task 11);
  - the spec and the roadmap (Task 13).
- **Read only (ruling 1).** `src/services/clients/**` and `src/services/providers/**` (but the six stubs of Task 1), the old settings UI (`ProviderSpecificSettings.tsx`, `ProviderSection.tsx`, `LanguageSection.tsx`, `SonioxVoiceSection.tsx`, `voiceLibrarySource.ts`, `SonioxCloneReviewStep.tsx`, `VoiceCreateModal.tsx`, `VoicePicker.tsx`, their tests), `src/stores/settingsStore.ts`, `src/components/SettingsInitializer/**`, `src/types/Provider.ts`, `extension/**`, `electron/**`. The new code copies the descriptor's pure helpers and imports nothing from `src/services/**`; it reuses the voice-library components (`SonioxVoiceSection`, `voiceLibrarySource`) as they are, behind a wrapper (F13) — what those import is theirs.
  - **One stated, narrow exception:** `src/components/Settings/sections/VoiceLibrarySection.tsx`, which the old settings UI shares, is edited **additively** in Task 10a — a preview route read from a context that only the new `SonioxSettingsView` provides (choice 13). The old settings UI is unreachable in the app since the switch to the new Settings, and with no provider of the context the section's `AudioContext` path runs exactly as before.
- **Import rules:**
  - `src/lib/**` never imports React or `src/app/**`. `src/lib/contract/testing/**` is test-only (the kit rule, `sessionSide.consistency.test.ts` case "only test-only modules import the adapter test kit").
  - A provider's session side — `adapter.ts` and every file of its folder it reaches by a value import — imports no store and no reporter, and runs no global timer: every timer reads the request's clock (`clock.setTimeout`, `every(clock, ms, fn)`, `clock.now()`). For Soniox that side is `adapter.ts`, `utterances.ts`, `speech.ts`, `sttStream.ts`, `ttsStream.ts`, `pcmMixer.ts`, `sideTracker.ts`, `socket.ts`. `adapter.ts` imports `config.ts` and `settings.ts` **as types only**: `config.ts` reports through `reportWarning`, which the session side may not reach. `ttsRest.ts`, `voicesClient.ts` and `check.ts` are the settings side and keep their own timers.
  - Both fakes reach a bundle only through the registry's `import.meta.env.DEV` literal (D24). The meeting page's overlay graph is unchanged: `src/subtitle-overlay-entry.tsx` does not reach `src/providers/registry.ts` today (checked: 215 modules, the registry not among them), so registering Soniox adds nothing to it.
- **Diagnostics** (CLAUDE.md, "Error Handling"): an adapter never reports and never logs; it says what happened through `failed`, `degraded` (a `CLIENT_DIAGNOSTICS` code), `closed`, `reconnecting` / `reconnected` and `frame`. A notice the user sees carries a code, worded by `noticeText` — `notices.<code>` or an alias in `NOTICE_ALIASES`. Settings-side code records a caught failure with `reportError` / `reportWarning`, never `console.*`.
- **Locales (ruling 8).** Two new keys only, `settings.speechModeTooltip` and `settings.speechModeAppliesToAuto`, in all 30 catalogs with a real translation (Task 11). Every other sentence is an existing key, reached through `NOTICE_ALIASES` or read directly.
- **No network.** No test, probe or step calls Soniox: the protocol is pinned by the kit over `FakeSocket` and by the ported old tests; the live behaviour is the owner's (Task 13's list).
- **Gates for every task:**
  - **The suite.** `npx vitest run src` shows 0 failed and no unhandled errors. Measured at `c91a3020` on 2026-09-27: **463 test files passed and 1 skipped (464); 5 843 tests passed and 2 skipped (5 845); no unhandled errors.**
  - **The typecheck.** The gate prints exactly the baseline lines below. The shell's `grep` is a ugrep wrapper that mis-parses this regex, so use `command grep` exactly as written. The regex is the foundation plan's, widened by every file this plan creates or edits outside it — `lib/diagnostics/clientDiagnostics`; the six stubs and the old modules that import them (`services/clients/(…|SonioxClient|ManagedVoicesClient)`, `services/providers/(SonioxProviderConfig|KizunaAISonioxProviderConfig|managedVoicePrep)`), so a broken re-export shows; `sections/(SpeechSection|VoiceLibrarySection)(\.test)?`, `SonioxVoiceSection`, `ProviderSpecificSettings`, `voiceLibrarySource`; the wizard's `SetupWizard(\.test)?`, `providerPaths(\.test|\.managedFit\.test)?`, `steps/(StepCredentials|StepCredentials\.test|StepFinish|StepProviderPath|StepScenario)`. Everything else this plan creates is already inside it (`app/`, `lib/(contract|conversation|provider|session|view)`, `providers`, `components/providers`).

    ```
    npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts|diagnostics/(consoleLedger|clientDiagnostics))|lib/modern-audio/BaseAudioRecorder|providers|services/(clients/(SonioxSttStream|SonioxTtsStream|PcmMixer|SonioxSideTracker|SonioxTtsRest|SonioxVoicesClient|SonioxClient|ManagedVoicesClient)|providers/(SonioxProviderConfig|KizunaAISonioxProviderConfig|managedVoicePrep))\.ts|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|MainPanel\.|panel/)|MainLayout/MainLayout\.tsx|Settings/(Settings\.tsx|ProviderArea|SimpleSettings/SimpleSettings\.tsx|AdvancedSettings/AdvancedSettings\.tsx|sections/((SpeechSection|VoiceLibrarySection)(\.test)?\.tsx|(ParticipantSpeechSwitch|SentenceSegmentationSection|SystemAudioSection|SonioxVoiceSection|ProviderSpecificSettings)\.tsx|voiceLibrarySource\.ts))|SettingsInitializer/|SetupWizard/(SetupWizard(\.test)?\.tsx|applySetup\.ts|useApplySetup\.ts|providerPaths(\.test|\.managedFit\.test)?\.ts|steps/(StepLanguagePair|StepCredentials|StepCredentials\.test|StepFinish|StepProviderPath|StepScenario)\.tsx)|TitleBar/AccountButton\.tsx|Tour/useStartBasicsTour\.ts|dev/(SpinePreview|SessionControls|OverlayPreview|wireTally|gapCounter))|contexts/UserProfileContext\.tsx|locales/(index\.ts|showLanguageUncached)|routes/Home\.tsx|stores/(providerStore|turnModeStore|routingStore|settingsStore\.ts)|utils/(environment|conversationExport)|subtitle-overlay-entry|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
    ```

    **The baseline** — exactly these **18** lines, measured at `2a8d4df1` and again at `c91a3020` (279 lines in the full tree both times):

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

    Do not fix them; do not add to them. `VoiceLibrarySection.tsx`'s line is the old preview path's `copyToChannel`, which Task 10a keeps.
  - **Gates in a parallel wave** (as the foundation plan's). Waves run tasks at once in this one working tree, so each task sees the others' red phases:
    - a test failure, or an extra gate line, in a file another concurrent task is changing is that task's work in progress: the implementer names it in the report and never touches it;
    - the task's own files must be green, and the gate must print the baseline plus only such named lines;
    - after each wave the controller runs the full gates: the suite at 0 failed with no unhandled errors, and the exact baseline.
  - **A task edits only the files in its Files list**, and commits exactly those. Where a step names tests elsewhere that its change could reach, it names why each stays green. If one fails anyway, the implementer stops, reports the failure with its output, and leaves the file untouched: the controller decides. No task edits a read-only file or a file another task of the same wave edits.
  - **No task mutates the tree to prove a guard** (a temporary `console.warn` or timer in a real file). Every guard proves itself with controls inside its own test.
- **Builds, at the group checks only** (the controller's):
  - `npm run build` and `npm run extension:build`. If `extension/node_modules` is missing, run `npm ci --prefix extension` first.
  - `npx vitest run extension`.
  - The D24 check: each of these prints nothing —
    - `command grep -rlF 'The fake degraded its speech' build extension/dist`
    - `command grep -rlF 'Lease ended by the leased fake' build extension/dist`
  - The Soniox check (group check B): `command grep -rlF 'session.stt_resume_attempt_failed' build extension/dist` prints the app's and the extension's main chunks — Soniox's new adapter shipped. (Not `transcribe-websocket`: the old client already puts that string in both bundles, and after Task 1 it lives in the shared `sttStream.ts`. `session.stt_resume_attempt_failed` is a frame only the new adapter emits; nothing under `src` holds it at `c91a3020`.)
- **Dev servers, probes and builds** are the controller's; an implementer never starts one. Checks run against a fresh vite: `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort --force`. Restart it after edits: a worktree's vite can serve stale transforms.
- **Shell forms.** This worktree's guard refuses compound shell forms: brace groups, loops, `cd … &&` chains. Every command in this plan is a single command or a plain pipeline, run as its own call from the worktree root. Use `command grep`. The shell is zsh: quote globs; `echo ====` is an error. Checks write their outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, never `/tmp`.
- **Commits:**
  - Conventional, in English. Every message ends with the implementing model's own `Co-Authored-By:` line, then `Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe`, and nothing after it. The examples below write the first as `Co-Authored-By: <implementing model> <noreply@anthropic.com>`: fill in your own model's name.
  - Run `git add <paths>`, then `git commit -q -F - -- <the same paths> <<'EOF' … EOF`, as two separate calls. The `--` pathspec is mandatory: parallel tasks stage into the same index. Never stage a whole directory.
  - Never push.

## Rulings

The controller's and the owner's rulings bind this plan (cited as *ruling N*). Each is restated with where it lands.

1. **Old code read-only; F18 by `git mv` plus re-export stubs.** The six protocol modules of survey §2.11 move with their tests into `src/providers/soniox/`; a one-line `export * from '…'` stub stays at each old path, so the old client, both descriptors, the old UI and the old tests (their `vi.mock` paths included) resolve unchanged. New constructor dependencies (`{ clock, openSocket }`) are optional and default to `realClock` and `new WebSocket` read at call time, so the old tests' `vi.useFakeTimers()` and `vi.stubGlobal('WebSocket')` keep working. Every behaviour change the new adapter needs is additive and optional. The descriptor's pure helpers are copied into `settings.ts` / `config.ts`. Verified by `npx vitest run src/services src/components/Settings` staying green. Lands in: Task 1 (the move, the stubs, the clock and socket), Task 2 (span tags), Task 5 (the copies). One stated, narrow exception (the controller's, on the review): `VoiceLibrarySection.tsx` is edited additively for the preview route (Task 10a, choice 13; Global Constraints).
2. **Karaoke — "improved ③ + (a)"** (owner, 2026-09-26). TTS audio plays as it streams: each chunk is an `audio({ pcm, ref })` with no range. When a TTS segment ends cleanly — its `terminated` with no error before it for that stream — the adapter knows each chunk's sample count and the segment's character span, and fills in each chunk's range after the fact: the span divided in proportion to the chunks' sample counts, tiling it. Karaoke reads each playing clip's range live from L1 at its next sample, so it starts sweeping from where playback is; before the fill-in the sentence is not highlighted (option (a)). A 408-killed segment gets no ranges: replay only, plus the segment-lost notice. Lands in: Task 3 (the `speechRanges` event, its L1 handling, conformance rules, the fake's `late-ranges`, the karaoke hold and its proofs), Task 2 (spans and segment ends in `ttsStream`), Task 7 (the fill-in in `speech.ts`), Task 13 (the spec amendment). The translation segment closes at `<end>`, before its speech — choice 2 argues it.
   - **`karaoke.ts` gains one change, the hold** (the controller's ruling on the review's I1). The brief predicted "no change"; the review showed that without one, a row spoken as two TTS segments goes lit → unlit → lit: sentence A lights once its fill-in lands, then B's first rangeless chunk plays and `litFor` returns null, so the highlight drops until B's own fill-in. Option (a) means "a sentence is not highlighted before its fill-in", not "un-highlight what is lit". So in `nextLit`, a playing clip with no range that belongs to the segment already lit keeps that lit state, through the existing gap rules (the segment still held, not every range dropped, the offset clamped to the text); only the new sentence waits for its fill-in (choice 18, Task 3).
   - **A fill-in that lands after the queue emptied** lights nothing live — no clip plays and nothing was lit — and replay lights it. Recorded, characterized (Task 3), and named in the spec (Task 13).
3. **Every old error and retry path is kept**, each mapped and tested:
   - STT 503 with an own key: a silent resume (`SonioxClient.ts:1358`'s gate; `resumeSttStream`, `:636-683`): attempts at 0 / 1 000 / 3 000 ms, at most `MAX_STT_RESUME_CYCLES` = 5 cycles per session (`:248`), the interrupted utterance closed as it stands, the leg shown as reconnecting, then `connection_lost` and the end → Task 8.
   - STT 408, a socket error, a bare close, a 503 past the cap: the recoverable outage (`RECOVERABLE_STT_CODES`, `:57`) → `failed({ code: 'connection_lost' })`; 408 is prevented by the idle keepalive (Task 1 keeps it on the clock) → Task 8.
   - Every other STT code with the server's own words → Task 8.
   - TTS: the #543 segmenting (Tasks 1–2 keep it, on the clock); a killed segment reported once per episode ("segment lost") while the next one speaks; the socket reconnected on demand with queued text flushed in order (`ensureTts`, `:1059-1094`); a failed reconnect → "speech stopped"; a TTS connect that fails at start silent until the first translation (`:419-437`), which retries it, a failed retry saying "speech stopped" once (choice 6) → Task 7.
   - Managed-only paths (no resume with a lease, the 403 duration cutoff) are Plan B's; Task 8 reserves their seam with stubs.
4. **Participant speech** follows the participant-speech routing toggle (default off, the owner's 2026-09-06 decision): when on, the participant leg gets its own TTS socket, split and shared alike. A stated departure: old Soniox kept the participant text-only. Lands in: Tasks 8–9 (per-leg speech from `context.speech`, which `contextsFor` already derives from the toggle, `shape.ts:25-31` and `appShape.ts:51-52`).
5. **Endpoint detection stays on under manual turns;** `endTurn` sends `finalize`, and `<fin>` is the utterance boundary (survey §0.3). The translation is kept open after `<fin>` until the next utterance's first token or a bound on the clock, `FIN_TRANSLATION_GRACE_MS` = 2 000 ms (a judgement); a translation token after that still lands, as a revision. Lands in: Task 6, Task 8; the owner's live check in Task 13.
6. **Voice preview:** Settings' voice-library preview goes through `Playback.preview` (survey task 8). The clone-review player keeps its seekable `<audio>` on the default output — not folded, recorded in the roadmap. Lands in: Task 10a (the route), Task 10b (Soniox's view provides it), Task 13.
7. **Registry:** `sonioxProvider` joins `RELEASED` after `localInference`, not flagged; the order case lists both. The owner decides the final order before Plan B. An own key sends no `clientReferenceId`. Lands in: Task 11, Task 5.
8. **Locales:** the two provider-neutral Speech-mode keys only, in all 30 catalogs, listed for a native-speaker spot check; every other sentence reused (`mainPanel.sonioxTtsSegmentLost`, `mainPanel.sonioxTtsFailed`, `mainPanel.sonioxConnectionLost` through `NOTICE_ALIASES`). The `sonioxService*` aliases are managed-only → Plan B. Lands in: Task 7 (aliases), Task 11 (keys), Task 13 (the list).
9. **F12's own-key wizard path is in this plan:** the plan has 13 implementer tasks (Task 10 split into 10a and 10b on the review), under the ~14 bound. It is the last code task (Task 12), separable: Soniox is usable from Settings without it.
10. **The last task is the controller's docs task** (Task 13): the spec's amendments (survey §3.7, `speechRanges` and karaoke's hold, `startBoth`'s leg error, Soniox's capability row) and the roadmap section "Scheduled by the Stage 2 Soniox plan". Old BYOK code is not deleted here.

## Choices this plan makes inside the rulings

Cited as *choice N*.

1. **The fill-in event is `speechRanges({ ref, ranges: Array<{ index, range }> })`** (Task 3).
   - `index` is the speech entry's place among this ref's `audio` events, 0 first — the same count `createPlayback` keys clips by (`playback.ts`, `counts`), so an entry, its clip key and its range stay one thing. Explicit indices keep the event self-describing, as `range` is.
   - The ranges are measured against the text the adapter last sent for `ref`, like `audio.range`. L1 re-anchors them onto the text as it stands: when punctuation fill-in replaced the adapter's text, L1 keeps the adapter's own text (`unfilled`, one string per filled segment) and runs `reanchorRanges(unfilled, current, ranges)` — the same skeleton re-anchoring every replacement uses.
   - A segment already closed takes them: that is the point (choice 2). Audio L1 holds in `pending` takes them too — audio that arrived before its segment opened, or (the review's M4) audio for a ref whose closed segment `clear()` dropped, which `Conversation.audio` also parks in `pending` (`Conversation.ts:230-235`). A ref with neither a segment nor pending audio drops them silently; an entry the segment does not hold is dropped with the `range_out_of_text` diagnostic.
   - **Across a `clear()`** (M4): `clear()` empties an open segment's speech (`Conversation.ts:151-164`) and `playback.clear()` restarts its clip counts (`playback.ts:145-151`), but the adapter's count goes on. So L1 keeps, per ref, the number of speech entries `clear()` dropped (`clearedEntries`) and subtracts it from each `index`; an index below it names audio the clear already dropped and is ignored silently. Entry, clip key and range stay one thing after a clear too.
   - Conformance: the entries must exist (`ranges-entry`), each range lies within the ref's text (`range-in-text`, checked when the ref closes or at once if closed; each range of one event on its own, M5), and a ref's ranged entries ascend without overlapping in entry order (`ranges-order`).
2. **Soniox's translation segment closes at `<end>`, before its speech ends** — accepting the fill-in on a closed segment rather than deferring the close (the brief's preference). The evidence:
   - L1 already accepts speech after a close: `Conversation.audio` appends to a final segment and pulls the trim cursor back (`Conversation.ts:248-251`); conformance never forbids `audio` after `segmentClosed`.
   - The survey's objection (§0.4: "L1 re-anchors a range only while it holds it", `Conversation.ts:278-310`) was that a range arriving after fill-in punctuation is measured against the pre-fill text. Choice 1's `unfilled` closes exactly that hole, and nothing else in L1 reads a range at close: `clampRanges` runs again on the late ranges (`seg.final`).
   - Karaoke never needed the segment open: `litFor` reads a playing clip's range whatever the segment's `final`, so a closed row whose ranges arrive while its clip plays lights from there (Task 3, case 13). The gap hold (`karaoke.ts:80-91`) matters only once something has lit (the review's M15 — the draft claimed more here); for what a closed row looks like while its *next* rangeless chunk plays, see choice 18.
   - The cost of deferring is what the owner would see: every translation row provisional until its speech ends, and with serialized TTS segments several utterances open at once (survey §3.6). Closing at `<end>` is also the old client's behaviour (`SonioxClient.ts:1214-1234`: `audioItemId` survives `<end>`).
3. **Late translation tokens belong to the utterance that just ended** (Task 6). A translation token after a boundary and before the next original token goes to that utterance: it opens its translation if none was open (armed with the grace), appends while it is open, and revises it once closed. `<end>` closes the translation at once (parity); `<fin>` arms `FIN_TRANSLATION_GRACE_MS`. The next original token ends that hold — and when the late translation tokens and that original arrive in **one message**, the ended utterance's late text is shown and spoken before its translation closes (`endPrevious` flushes it first: the review's C1, Task 6 cases 19–20). So neither boundary truncates a translation, and the old client's orphan item for a translation after `<end>` does not come back.
4. **The proportional split snaps off surrogate pairs** (Task 7, `tileSpan`): a boundary landing between a high and a low surrogate moves one unit forward, so no clip's range ends inside a character. The last range always ends at the span's end.
5. **One core, `SonioxCore`, serves a single leg and shared Both** (Tasks 8–9): one STT socket, one utterance machine, one `LegSpeech` per speaking leg. Split Both is two single-leg starts. The session facade is per leg; a shared core's two facades stop it together.
6. **A TTS connect that fails at start says so only in the Logs** (`frame` `tts.connect_failed`), and a failed resume attempt likewise (`session.stt_resume_attempt_failed`): ruling 3's "silent until the first translation", and the old `diagnose` calls reached only the Logs panel. A user-visible notice follows only when speech is actually lost. **The old retry is kept** (the controller, on the review): a TTS socket that failed at start is retried by the first translation that needs speaking (`LegSpeech.speak` queues the text and calls `ensure()`, which opens a new socket and flushes the queue in order), and a retry that fails reports `tts_stopped` ("speech stopped") once — later retries in the same episode say nothing more, and a retry that succeeds ends the episode. Task 7, case 14 pins all three.
7. **An unreadable STT or TTS frame is Logs-only** — reversed on the review (the controller's ruling): the draft's user-visible `parse_error` warning is gone. The old client dropped such a frame silently (survey §1.19), and CLAUDE.md's policy treats a frame that would not parse as a diagnostic, not a failure the user acts on. So the adapter emits a `frame` — `stt.unreadable` or `tts.unreadable`, `{ message }` — on the ok → failing transition only (the hot-path rule: one per episode, reset by the next frame that reads), and never `degraded`. No locale text is needed or added (Tasks 1, 7, 8).
8. **Failure codes** (Task 8): 503 within the ladder → resume; 408 / `socket_error` / a bare close / 503 past the cap or after a failed ladder → `connection_lost`; 401 and 403 → `auth`; 429 → `rate_limit`; another 4xx → `client`; anything else → `server`. The message keeps the server's words (`[Soniox 401] …`), which `notices.auth` and its siblings show as `{{detail}}`. `failed.code` is also the analytics `error_type` (`run.ts:440`): `connection_lost` records as `server`. The normalized `connection_lost` code stays (the controller, on the review); the shift it makes in analytics — `api_error.error_code` reads `connection_lost` with `error_type` `server` where the old client sent `503`, `408` or `socket_closed` — is listed under the stated departures for the owner, since dashboards grouping by code will move.
9. **The TTS notice codes are `tts_segment_lost` and `tts_stopped`** (Task 7): two `CLIENT_DIAGNOSTICS` rows (`warning`) aliased onto `mainPanel.sonioxTtsSegmentLost` and `mainPanel.sonioxTtsFailed`. The sentences name no vendor, so the codes need not.
10. **`check` is Soniox's temporary-key probe, bounded at 15 s** (`CHECK_TIMEOUT_MS`, matching `SonioxVoicesClient`'s REST timeout) and linked to the caller's signal (Task 5): 200/201 → ready; 401/403 → `{ ok: false, code: 'auth' }`; any other answer, a network failure or the timeout → it throws (it could not find out).
11. **The wizard's Validate calls the definition's `check` directly and keeps its answer in the step** (Task 12), rather than `providerStore.refreshReadiness`: a check over the draft's key would otherwise land in the store as the provider's readiness, and the driver, seeing it known, would not re-check the saved key if the user left the wizard. Finish writes the key; the store's own reset then checks it. The step also keeps the wizard's own markup (`FormInput`, its Validate button, `StatusMessage`) rather than the Settings panel's `CredentialForm` the survey named: the wizard's sibling steps are drawn that way (the owner's rule: match the sibling markup), and the spec calls the wizard's form "already generic" — what changes is where its fields and check come from.
12. **The settings view is a factory** (Task 10b): `createSonioxSettingsView({ managed, useVoiceSource })`. BYOK is `{ managed: false, useVoiceSource: useByokVoiceSource }`; Plan B passes its managed voice source as a hook, and `managed` switches exactly what the old UI switched (the region tooltip, the cost note, `SonioxVoiceSection`'s `managed`). A hook, so each flavour memoizes its source on its own inputs (the key string for BYOK, as `ProviderSpecificSettings.tsx:273-297` did).
13. **The preview route is a port on `SettingsProps`** (`preview?: PreviewPort`, set by `ProviderOwnSettings` from `src/app/voicePreview.ts`) and reaches `VoiceLibrarySection` through `VoicePreviewContext`, which `SonioxSettingsView` provides (Tasks 10a, 10b). Without a provider of the context the section plays on its own `AudioContext`, as today: the old UI and LocalInference's voice section are unchanged. `SonioxVoiceSection` stays read-only.
   - `VoiceLibrarySection` is edited **additively, as a stated narrow exception to ruling 1** (the controller, on the review): the old settings UI that shares it is unreachable in the app since the switch.
   - Its `stopPreview` runs on every toggle and on unmount, so it stops the route **only while this section's own sample plays through it** (`if (playingIdRef.current) port.stop()`, the review's M12): the test tone, or another section's preview, is never cut by a toggle here.
   - `appVoicePreview` plays through `getAppAudio()` (`src/lib/audio/appAudio.ts`, the test tone's route), not `getAppSession().audio()` (the review's M13): the same page playback, without loading the legs' capture for a voice sample, and `src/app/session` stays out of `ProviderOwnSettings`' import graph.
14. **`SettingsProps.legs`** (Task 10a; read by Task 10b's view) keeps the shared-session pills locked outside Both mode, as the old UI did (`lockedOff = isSessionActive || !inBoth`).
15. **`framePayload` moves to `src/lib/contract/framePayload.ts`** (Task 7): Soniox's frames need the same redaction and 2 000-character clip as LocalInference's (`localInference/adapter.ts:90-104`, used at `:703`).
16. **Frames keep the old names** (survey §1.17: `session.*`, `stt.delta`, `stt.transcript`, `stt.translation`, `stt.endpoint`, `tts.speak`, `tts.audio`, `tts.degraded`) so the Logs panel's grouping survives; new ones are `stt.finalize`, `stt.finalized`, `stt.unreadable`, `tts.unreadable`, `tts.connect_failed`, `session.stt_resume_attempt_failed`. Socket-level and token frames go to the core's first leg (the speaker's in shared Both, whose key the socket carries); a leg's TTS frames to that leg. **A stated departure from the survey** (§2.9 "Frames" routed them to each utterance's leg; the review's M16): listed under the stated departures.
17. **`LegStartError` lives in `src/lib/contract/adapter.ts`**, beside `AdapterStartError` (Task 4): a provider throws it without importing the runner.
18. **The karaoke hold** (Task 3; the controller's ruling on the review's I1). `nextLit(prev, playing, legs)`: when the playing clip has a range, it decides, as before; when it has none and belongs to `prev`'s segment (same leg, same segment id), the answer is what the gap rules give `prev` — held (clamped to the text) while the segment is held and not every range dropped, otherwise null; a rangeless clip of another segment lights nothing. So a lit sentence stays lit while the same row's next sentence plays rangeless, and the sweep resumes from where playback is once that sentence's fill-in lands. The replay queue is unchanged (it reads `litFor` only). The gap rules are reused, not copied: the gap branch becomes a local function both branches call.

## File Structure

| File | Task | Change |
|---|---|---|
| `src/providers/soniox/{sttStream,ttsStream,pcmMixer,sideTracker,ttsRest,voicesClient}.ts` (+ their `.test.ts`, moved) | 1 | `git mv` from `src/services/clients/`; the clock and socket in the three session-side ones; `onUnreadable` |
| `src/services/clients/{SonioxSttStream,SonioxTtsStream,PcmMixer,SonioxSideTracker,SonioxTtsRest,SonioxVoicesClient}.ts` | 1 | one-line re-export stubs |
| `src/providers/soniox/{socket,adapter}.ts`, `wire.clock.test.ts` | 1 | the socket seam; `adapter.ts`'s seed; the modules on `FakeSocket` + the virtual clock |
| `src/providers/sessionSide.consistency.test.ts` | 1, 8, 9 | Soniox's session side |
| `src/providers/soniox/ttsStream.ts`, `ttsStream.segments.test.ts` | 2 | span tags, segment ends |
| `src/lib/contract/{adapter,events,conformance}.ts` (+ tests), `src/lib/conversation/Conversation.ts` (+ test), `src/providers/fake/{script,adapter,scripts}.ts` (+ `scripts.test.ts`), `src/lib/view/karaoke.ts` (+ test) | 3 | `speechRanges`; L1's `unfilled` and `clearedEntries`; the karaoke hold |
| `src/lib/contract/adapter.ts` (+ test), `src/lib/session/run.ts`, `runner.hooks.test.ts`, `src/providers/fake/leased.ts` (+ test) | 4 | `LegStartError`; the distinct-track test |
| `src/providers/soniox/{settings,config,check}.ts` (+ tests) | 5 | `S`, languages, `K`, `C`, `build`, `describe`, `check` |
| `src/providers/soniox/utterances.ts` (+ test) | 6 | tokens → segments |
| `src/providers/soniox/speech.ts` (+ test), `src/lib/contract/framePayload.ts` (+ test), `src/providers/localInference/adapter.ts`, `src/lib/diagnostics/clientDiagnostics.ts`, `src/lib/view/noticeText.ts` (+ test) | 7 | one leg's TTS; the two codes; `framePayload` shared |
| `src/providers/soniox/adapter.ts` (+ `adapter.test.ts`), `sessionSide.consistency.test.ts` | 8 | `SonioxCore`, `start`, the conformance harness, Plan B's session seams |
| `src/providers/soniox/adapter.ts` (+ `adapter.both.test.ts`), `sessionSide.consistency.test.ts` | 9 | `startBoth` |
| `src/lib/provider/types.ts`, `src/components/providers/{VoicePreviewContext.ts,ProviderOwnSettings.tsx}` (+ `ProviderOwnSettings.test.tsx`), `src/app/voicePreview.ts` (+ test), `src/components/Settings/sections/VoiceLibrarySection.tsx` (+ test) | 10a | the voice-preview route |
| `src/providers/soniox/{SonioxSettings,SonioxVoiceField,SonioxTurnDetection}.tsx` (+ tests), `src/components/providers/fields/LinesField.tsx` (+ test) | 10b | Soniox's settings components |
| `src/providers/soniox/provider.ts` (+ test), `src/providers/registry.ts` (+ test), `src/components/Settings/sections/SpeechSection.tsx` (+ test), 30 × `src/locales/<code>/translation.json` | 11 | the definition, registration, the tooltip |
| `src/components/SetupWizard/{providerPaths.ts,SetupWizard.tsx,steps/StepProviderPath.tsx,steps/StepCredentials.tsx,steps/StepLanguagePair.tsx,steps/StepFinish.tsx}` (+ tests) | 12 | F12's own-key path |
| the spec, the roadmap | 13 | the controller's amendments and record |

**Order and parallelism.**
- **Wave 1:** Task 1 and Task 3 — disjoint files.
- **Wave 2:** Task 2 (needs Task 1: `ttsStream.ts`), Task 4 (needs Task 3: both edit `src/lib/contract/adapter.ts` and its test), Task 5 and Task 6 (need Task 1's folder and `adapter.ts` seed: the session-side guard lists every folder under `src/providers` and requires its `adapter.ts`). Disjoint files.
- **Wave 3:** Task 7 (needs Tasks 2 and 3) and Task 10a (needs nothing earlier; it waits here only so no earlier wave grows). Disjoint files.
- **Wave 4:** Task 8 (needs Tasks 3, 5, 6, 7) and Task 10b (needs Task 10a's context and `SettingsProps.preview` / `legs`, Task 5's `S` and key fields, Task 1's `voicesClient.ts`). Disjoint files: Task 8 edits `soniox/adapter.ts`, its test and the session-side guard; Task 10b creates the three `.tsx` components and `LinesField`.
- **Wave 5:** Task 9 (needs Tasks 4 and 8).
- **Group check A** (controller) after Wave 5.
- **Wave 6:** Task 11 (needs Tasks 8–9 and 10b).
- **Wave 7:** Task 12 (needs Task 11: the registry offers Soniox).
- **Group check B** (controller) after Task 12.
- **Task 13** (controller) last.

---

### Task 1: The protocol modules' home, on the request's clock (F18)

**Files:**
- Move (`git mv`), with their tests: `src/services/clients/SonioxSttStream.ts` → `src/providers/soniox/sttStream.ts`; `SonioxTtsStream.ts` → `ttsStream.ts`; `PcmMixer.ts` → `pcmMixer.ts`; `SonioxSideTracker.ts` → `sideTracker.ts`; `SonioxTtsRest.ts` → `ttsRest.ts`; `SonioxVoicesClient.ts` → `voicesClient.ts` (each `X.test.ts` → the new name's `.test.ts`).
- Create (the stubs, at the six old paths): `src/services/clients/{SonioxSttStream,SonioxTtsStream,PcmMixer,SonioxSideTracker,SonioxTtsRest,SonioxVoicesClient}.ts`.
- Create: `src/providers/soniox/socket.ts`, `src/providers/soniox/adapter.ts` (the seed), `src/providers/soniox/wire.clock.test.ts`.
- Modify: the moved `sttStream.ts`, `ttsStream.ts`, `pcmMixer.ts`, `ttsRest.ts`, and the six moved tests (import paths; the STT and TTS tests' typecheck lines); `src/providers/sessionSide.consistency.test.ts`.

**Interfaces:**
- **Produces:**
  - `socket.ts`: `type OpenSocket = (url: string) => WebSocket`; `const nativeSocket: OpenSocket` (`new WebSocket(url)`, read at call time); `const WS_OPEN = 1`; `interface SonioxWireDeps { clock?: Clock; openSocket?: OpenSocket }`.
  - `new SonioxSttStream(deps?: SonioxWireDeps)`; `SonioxSttStreamHandlers.onUnreadable?(error: unknown): void`.
  - `new SonioxTtsStream(options: SonioxTtsOptions, deps?: SonioxWireDeps)`; `SonioxTtsStreamHandlers.onUnreadable?(error: unknown): void`.
  - `PcmMixerOptions.clock?: Pick<Clock, 'setTimeout'>`.
  - Everything else each module exports today, unchanged, at both paths.
- **Consumed by:** Task 2 (`ttsStream.ts`), Tasks 7–9 (the adapter's sockets and mixer), Task 10b (`voicesClient.ts`), and the old client through the stubs.

- [ ] **Step 1: Move the modules and their tests.** One call each, from the worktree root:

  ```bash
  mkdir -p src/providers/soniox
  ```

  ```bash
  git mv src/services/clients/SonioxSttStream.ts src/providers/soniox/sttStream.ts
  ```

  and likewise, one `git mv` per line: `SonioxSttStream.test.ts` → `sttStream.test.ts`; `SonioxTtsStream.ts` → `ttsStream.ts`; `SonioxTtsStream.test.ts` → `ttsStream.test.ts`; `PcmMixer.ts` → `pcmMixer.ts`; `PcmMixer.test.ts` → `pcmMixer.test.ts`; `SonioxSideTracker.ts` → `sideTracker.ts`; `SonioxSideTracker.test.ts` → `sideTracker.test.ts`; `SonioxTtsRest.ts` → `ttsRest.ts`; `SonioxTtsRest.test.ts` → `ttsRest.test.ts`; `SonioxVoicesClient.ts` → `voicesClient.ts`; `SonioxVoicesClient.test.ts` → `voicesClient.test.ts` (all from `src/services/clients/` to `src/providers/soniox/`).

- [ ] **Step 2: The stubs.** Each old path gets exactly one line — `export *` carries the types too, and none of the six has a default export:

  | Old path | Content |
  |---|---|
  | `src/services/clients/SonioxSttStream.ts` | `export * from '../../providers/soniox/sttStream';` |
  | `src/services/clients/SonioxTtsStream.ts` | `export * from '../../providers/soniox/ttsStream';` |
  | `src/services/clients/PcmMixer.ts` | `export * from '../../providers/soniox/pcmMixer';` |
  | `src/services/clients/SonioxSideTracker.ts` | `export * from '../../providers/soniox/sideTracker';` |
  | `src/services/clients/SonioxTtsRest.ts` | `export * from '../../providers/soniox/ttsRest';` |
  | `src/services/clients/SonioxVoicesClient.ts` | `export * from '../../providers/soniox/voicesClient';` |

  The old client, both descriptors, `ManagedVoicesClient.ts`, `managedVoicePrep.ts`, `voiceLibrarySource.ts`, `SonioxVoiceSection.tsx`, `ProviderSpecificSettings.tsx` and the old tests import these paths and are not touched. `SonioxClient.test.ts:88-89` and `SonioxClient.managed.test.ts:48-49` mock `./SonioxSttStream` / `./SonioxTtsStream`, and `SonioxVoiceSection.test.tsx:100` mocks `…/SonioxTtsRest`: a mock replaces the stub module, which is exactly what their importers load. (`git log --follow -C` finds each moved file's history: the old path is rewritten into a stub in the same commit, so plain rename detection pairs nothing.)

- [ ] **Step 3: Fix the moved tests' imports and their typecheck lines.**
  - Every moved test's `from './SonioxX'` becomes `from './x'` (the new file name); `ttsRest.ts`'s `from './SonioxVoicesClient'` becomes `from './voicesClient'`. The `../../lib/soniox/*` imports keep their spelling: `src/providers/soniox` is as deep as `src/services/clients`.
  - Under `src/providers` the moved tests are inside the gate, and two of them carry 20 typecheck errors today (`src/services/clients/SonioxSttStream.test.ts` 7, `SonioxTtsStream.test.ts` 13). Fix them without changing a test's meaning:
    - `sttStream.test.ts`: `import type { SonioxSttConfig } from './sttStream';`, then `const CONFIG: SonioxSttConfig = { … };` and `async function openStream(config: SonioxSttConfig = CONFIG)` (clears the five TS2353 lines, the TS2322 on `two_way` and the TS2322 on `region`).
    - Both files: add `const last = <T,>(xs: readonly T[]): T => xs[xs.length - 1];` under the imports, and replace every `X.at(-1)` with `last(X)` (`MockWebSocket.instances.at(-1)!` → `last(MockWebSocket.instances)`, `ws.jsonSent().at(-1)` → `last(ws.jsonSent())`, `…filter((m) => m.model).at(-1)` → `last(…filter((m) => m.model))`). The lib is ES2020 and has no `Array.prototype.at`.

- [ ] **Step 4: Write the failing tests** — `src/providers/soniox/wire.clock.test.ts`, the three session-side modules on `FakeSocket` and the virtual clock, with no fake timers and no stubbed global. Helpers: `const sockets = fakeSockets(); const clock = createVirtualClock(0);` per test (from `../../lib/contract/testing/fakeSocket` and `../../lib/contract/clock`); `CONFIG: SonioxSttConfig = { apiKey: 'k', region: 'us', model: 'stt-rt-v5', sampleRate: 24000, translation: { type: 'one_way', target_language: 'en' } }`; `TTS: SonioxTtsOptions = { apiKey: 'k', region: 'us', voice: 'Adrian', model: 'tts-rt-v2', sampleRate: 24000 }`. Cases:
  1. **"opens the STT socket through the injected factory, at the key's region, and sends its config first"** — `const s = new SonioxSttStream({ clock, openSocket: sockets.create })`; `const p = s.connect({ ...CONFIG, region: 'eu' })`; `sockets.last().url` is `'wss://stt-rt.eu.soniox.com/transcribe-websocket'`; `sockets.last().open(); await p;` → `sockets.last().sentJson()[0]` matches `{ api_key: 'k', model: 'stt-rt-v5' }`.
  2. **"times out an STT connect after 15 s on the clock"** — connect, never open; `clock.advance(14_999)` → the promise is still pending (race it against `flush()` from the kit's `drive.ts`); `clock.advance(1)` → rejects with `/connection timeout/`, and `sockets.last().closedByClient` is not null.
  3. **"sends the STT keepalive after 15 s without audio, checked every 5 s, on the clock"** — open; `clock.advance(10_000)` → no `{ type: 'keepalive' }` in `sentJson()`; `clock.advance(5_000)` → the last JSON sent is `{ type: 'keepalive' }`; `s.sendAudio(new Int16Array(240))`, `clock.advance(10_000)` → no second keepalive.
  4. **"reads its own socket's state, whatever the global WebSocket says"** — `vi.stubGlobal('WebSocket', class { static OPEN = 99 })` (unstubbed in `afterEach`); open; `s.sendAudio(new Int16Array(240))` → `sockets.last().sent` holds an `Int16Array`.
  5. **"stops the keepalive at close: nothing is sent after it"** — open; `s.close()`; `const n = sockets.last().sent.length; clock.advance(60_000)` → still `n`.
  6. **"tells an unreadable STT frame to onUnreadable, and routes nothing"** — `const onUnreadable = vi.fn(), onMessage = vi.fn()`; `s.setHandlers({ onUnreadable, onMessage })`; open; `sockets.last().receive('{not json')` → `onUnreadable` called once with an error, `onMessage` never.
  7. **"times out a TTS connect after 15 s on the clock"** — as case 2 over `new SonioxTtsStream(TTS, { clock, openSocket: sockets.create })`, rejecting with `/TTS connection timeout/`.
  8. **"sends the TTS keep_alive every 20 s on the clock"** — open; `clock.advance(20_000)` → the last JSON sent is `{ keep_alive: true }`.
  9. **"cuts a TTS segment on the clock: a clause after 1.5 s, idle after 3 s, age after 8 s"** — `t.sendText('Well, ', 'en')`; `clock.advance(1_499)` → no `text_end`; `clock.advance(1)` → `{ stream_id: 'utt-1-1', text: '', text_end: true }` sent. Then, each on a fresh stream and socket: `t.sendText('and so', 'en')` (no clause end) → `text_end` after exactly 3 000 ms and not at 2 999; and `'one'`, `'two'`, `'three'`, `'four'` sent at 0, 2 000, 4 000 and 6 000 ms (each resets the 3-s idle cut) → `text_end` at exactly 8 000 ms from the first text.
  10. **"tells an unreadable TTS frame to onUnreadable"** — as case 6 over the TTS stream.
  11. **"mixes every 100 ms on the clock, and stops at stop()"** — `const frames: Int16Array[] = []; const m = new PcmMixer({ clock, frameSamples: 2400, intervalMs: 100, maxBacklogSamples: 48000, onFrame: (f) => frames.push(f) }); m.start(); clock.advance(300)` → 3 frames; `m.stop(); clock.advance(300)` → still 3.
  - `sessionSide.consistency.test.ts`, in "every provider keeps its adapter in adapter.ts, and the walk follows its folder", after the fake's lines:

    ```ts
        const soniox = sessionSide(REPO_ROOT, 'src/providers/soniox');
        expect(soniox).toEqual(expect.arrayContaining([
          'src/providers/soniox/adapter.ts',
          'src/providers/soniox/pcmMixer.ts',
          'src/providers/soniox/sideTracker.ts',
          'src/providers/soniox/socket.ts',
          'src/providers/soniox/sttStream.ts',
          'src/providers/soniox/ttsStream.ts',
        ]));
        // The settings side keeps its own timers: the adapter never reaches it.
        expect(soniox).not.toContain('src/providers/soniox/ttsRest.ts');
        expect(soniox).not.toContain('src/providers/soniox/voicesClient.ts');
    ```

- [ ] **Step 5: Run** `npx vitest run src/providers/soniox src/providers/sessionSide.consistency.test.ts` — the new cases fail: no deps parameter, no `onUnreadable`, no `adapter.ts` in the folder (so the guard's first case fails for `src/providers/soniox` too).

- [ ] **Step 6: Implement.**
  - `socket.ts`, in full:

    ```ts
    /**
     * The one seam Soniox's session side opens sockets through (F9's
     * convention): `new WebSocket(url)` in the app, a `FakeSocket` factory in
     * tests. The key rides in the first frame, so no upgrade header is needed
     * and the spec's header seam (F14) is not.
     */
    import type { Clock } from '../../lib/contract/clock';

    export type OpenSocket = (url: string) => WebSocket;

    /** Read at call time, so an old test's `vi.stubGlobal('WebSocket')` still reaches the old client's streams. */
    export const nativeSocket: OpenSocket = (url) => new WebSocket(url);

    /** `WebSocket.OPEN`, read as the constant it is: the socket may be an injected one, whatever the global says. */
    export const WS_OPEN = 1;

    /** A protocol module's dependencies; both default, so the old client's calls are unchanged (ruling 1). */
    export interface SonioxWireDeps {
      clock?: Clock;
      openSocket?: OpenSocket;
    }
    ```

  - `sttStream.ts`:
    - imports: `import { every, realClock, type Clock } from '../../lib/contract/clock';` and `import { nativeSocket, WS_OPEN, type OpenSocket, type SonioxWireDeps } from './socket';`;
    - `SonioxSttStreamHandlers` gains `/** A frame that would not parse: the caller decides what an episode of them is worth (choice 7). */ onUnreadable?: (error: unknown) => void;`;
    - fields: `private readonly clock: Clock; private readonly openSocket: OpenSocket; private stopKeepaliveTimer: (() => void) | null = null;` (replacing `keepaliveTimer`), and `constructor(deps: SonioxWireDeps = {}) { this.clock = deps.clock ?? realClock; this.openSocket = deps.openSocket ?? nativeSocket; }`;
    - `connect`: `const ws = this.openSocket(\`wss://${sonioxHosts(config.region).sttRt}/transcribe-websocket\`);`; `const cancelTimeout = this.clock.setTimeout(() => { … unchanged body … }, CONNECTION_TIMEOUT_MS);` and every `clearTimeout(timer)` becomes `cancelTimeout()`; `this.lastAudioAt = this.clock.now();`; the parse `catch` becomes `catch (error) { this.handlers.onUnreadable?.(error); return; }`;
    - `sendAudio`: `this.lastAudioAt = this.clock.now();`;
    - `isOpen(): boolean { return this.ws?.readyState === WS_OPEN; }`;
    - keepalive:

      ```ts
      private startKeepalive(): void {
        this.stopKeepalive();
        this.stopKeepaliveTimer = every(this.clock, KEEPALIVE_CHECK_INTERVAL_MS, () => {
          if (!this.isOpen()) return;
          if (this.clock.now() - this.lastAudioAt >= KEEPALIVE_AFTER_IDLE_MS) {
            this.ws!.send(JSON.stringify({ type: 'keepalive' }));
            this.lastAudioAt = this.clock.now();
          }
          // Runs every tick regardless of whether a keepalive frame was actually
          // sent — see onTick's docstring.
          this.handlers.onTick?.();
        });
      }

      private stopKeepalive(): void {
        this.stopKeepaliveTimer?.();
        this.stopKeepaliveTimer = null;
      }
      ```

  - `ttsStream.ts`, the same pattern:
    - the same two imports;
    - `SonioxTtsStreamHandlers` gains `onUnreadable?: (error: unknown) => void;`;
    - `constructor(options: SonioxTtsOptions, deps: SonioxWireDeps = {})` sets `this.clock` and `this.openSocket` as above;
    - the four timer fields become cancel functions: `private stopKeepaliveTimer: (() => void) | null = null; private clauseTimer: (() => void) | null = null; private idleTimer: (() => void) | null = null; private maxAgeTimer: (() => void) | null = null;`;
    - `connect`: `this.openSocket(…)`, `const cancelTimeout = this.clock.setTimeout(…, CONNECTION_TIMEOUT_MS)`, each `clearTimeout(timer)` → `cancelTimeout()`, the parse `catch (error) { this.handlers.onUnreadable?.(error); return; }`;
    - `sendText`: `at: this.clock.now()`;
    - `scheduleSegmentEnd`: `this.clauseTimer = this.clock.setTimeout(() => { … }, TTS_SEGMENT_TIMING.clauseWaitMs);` and `this.idleTimer = this.clock.setTimeout(…)`;
    - `openSegment`: `const left = Math.max(0, firstTextAt + TTS_SEGMENT_TIMING.maxAgeMs - this.clock.now()); this.maxAgeTimer = this.clock.setTimeout(…, left);`;
    - `clearTimer(which)`: `const cancel = this[which]; if (cancel) { cancel(); this[which] = null; }`;
    - `isOpen()` reads `WS_OPEN`;
    - `startKeepalive`: `this.stopKeepaliveTimer = every(this.clock, KEEPALIVE_INTERVAL_MS, () => { if (this.isOpen()) this.ws!.send(JSON.stringify({ keep_alive: true })); });`; `stopKeepalive`: `this.stopKeepaliveTimer?.(); this.stopKeepaliveTimer = null;`.
  - `pcmMixer.ts`: `import { every, realClock, type Clock } from '../../lib/contract/clock';`; `PcmMixerOptions` gains `/** The interval's clock; the real one by default (ruling 1). */ clock?: Pick<Clock, 'setTimeout'>;`; the field `private cancel: (() => void) | null = null;` replaces `timer`; `start(): void { if (this.cancel) return; this.cancel = every(this.options.clock ?? realClock, this.options.intervalMs, () => this.tick()); }`; `stop(): void { this.cancel?.(); this.cancel = null; this.qA = []; this.qB = []; }`.
  - `adapter.ts`, the seed Task 8 replaces:

    ```ts
    /**
     * Soniox's session side (plan: Stage 2 Soniox). The adapter itself lands in
     * Task 8; until then this module reaches the protocol modules moved here
     * (F18), so the session-side rules (`sessionSide.consistency.test.ts`) hold
     * them from the move on: no store, no reporter, every timer on the clock.
     */
    export { SonioxSttStream } from './sttStream';
    export { SonioxTtsStream } from './ttsStream';
    export { PcmMixer } from './pcmMixer';
    export { SonioxSideTracker } from './sideTracker';
    ```

- [ ] **Step 7: Run** `npx vitest run src/providers src/services src/components/Settings src/lib/diagnostics`, then the full suite and the typecheck gate. What stays green and why:
  - the moved tests (`sttStream.test.ts`, `ttsStream.test.ts`, `pcmMixer.test.ts` with `vi.useFakeTimers()` and a stubbed `WebSocket`): the defaults are `realClock`, whose `setTimeout` / `Date.now` read the faked globals at call time, and `nativeSocket`, which reads the stubbed `WebSocket` at call time; `every` re-arms a `setTimeout`, so `advanceTimersByTime` fires it as it fired `setInterval`;
  - `SonioxClient.test.ts`, `SonioxClient.managed.test.ts`, `ManagedVoicesClient.test.ts`, `managedVoicePrep.test.ts`, `voiceLibrarySource.test.ts`, `SonioxVoiceSection.test.tsx`: they import or mock the old paths, which the stubs keep;
  - `consoleLedger.consistency.test.ts`: none of the moved modules calls `console.*`.
  - The gate prints the 18 baseline lines: the stubs and the old importers compile, and the moved tests' 20 lines are fixed.

- [ ] **Step 8: Commit.** The `git mv`s already staged the renames. `git add` takes the six stubs, the new folder and the guard; it must not name the six old test paths, which no longer exist (`git add` refuses a pathspec that matches nothing — checked on a scratch repository):

  ```bash
  git add src/services/clients/SonioxSttStream.ts src/services/clients/SonioxTtsStream.ts src/services/clients/PcmMixer.ts src/services/clients/SonioxSideTracker.ts src/services/clients/SonioxTtsRest.ts src/services/clients/SonioxVoicesClient.ts src/providers/soniox src/providers/sessionSide.consistency.test.ts
  ```

  Here `src/providers/soniox` is the one directory staged whole: it is new, and every file in it is this task's. The commit's pathspec does name the six old test paths, so their moves are in the commit (a deleted path in a commit pathspec is accepted — checked the same way):

  ```bash
  git commit -q -F - -- src/services/clients/SonioxSttStream.ts src/services/clients/SonioxSttStream.test.ts src/services/clients/SonioxTtsStream.ts src/services/clients/SonioxTtsStream.test.ts src/services/clients/PcmMixer.ts src/services/clients/PcmMixer.test.ts src/services/clients/SonioxSideTracker.ts src/services/clients/SonioxSideTracker.test.ts src/services/clients/SonioxTtsRest.ts src/services/clients/SonioxTtsRest.test.ts src/services/clients/SonioxVoicesClient.ts src/services/clients/SonioxVoicesClient.test.ts src/providers/soniox src/providers/sessionSide.consistency.test.ts <<'EOF'
  refactor(soniox): the protocol modules move into src/providers/soniox, on the request's clock

  git mv of the STT, TTS, mixer, side-tracker, TTS-REST and voices modules
  with their tests (F18); a one-line re-export stays at each old path, so
  the old client, both descriptors, the old UI and their mocks resolve
  unchanged. The session-side modules open sockets and run every timer
  through optional deps that default to the native WebSocket and the real
  clock, and report an unreadable frame.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 2: TTS span tags and segment ends

**Files:**
- Modify: `src/providers/soniox/ttsStream.ts`.
- Create: `src/providers/soniox/ttsStream.segments.test.ts`.

**Interfaces:**
- **Produces** (`ttsStream.ts`):
  - `interface TextTag { ref: number; span: TextRange }` — which text a chunk speaks: the caller's key for it and the chunk's UTF-16 span in it;
  - `interface SonioxTtsAudioInfo { streamId: string; ref?: number }`;
  - `interface SonioxTtsSegmentEnd { streamId: string; ref?: number; span?: TextRange; clean: boolean }`;
  - `SonioxTtsStreamHandlers.onAudio?(audio: Int16Array, info: SonioxTtsAudioInfo): void` (a second argument, additive) and `onSegmentEnd?(end: SonioxTtsSegmentEnd): void`;
  - `sendText(text: string, language: string, tag?: TextTag): void`.
- **Consumed by:** Task 7 (`speech.ts`).

- [ ] **Step 1: Write the failing tests** — `ttsStream.segments.test.ts`, on `FakeSocket` and the virtual clock as Task 1's `wire.clock.test.ts` (`TTS` options the same; `const pcm = (n: number) => btoa(String.fromCharCode(...new Uint8Array(new Int16Array(n).fill(7).buffer)))`; `const tts = new SonioxTtsStream(TTS, { clock, openSocket: sockets.create })`, opened, `const ends: SonioxTtsSegmentEnd[] = []; const audio: Array<[number, SonioxTtsAudioInfo]> = []; tts.setHandlers({ onAudio: (a, info) => audio.push([a.length, info]), onSegmentEnd: (e) => ends.push(e) });`):
  1. **"hands each chunk's stream and ref to onAudio"** — `tts.sendText('Hello. ', 'en', { ref: 2, span: [0, 7] })`; `receive(JSON.stringify({ stream_id: 'utt-1-1', audio: pcm(4) }))` → `audio` is `[[4, { streamId: 'utt-1-1', ref: 2 }]]`.
  2. **"ends a segment cleanly at its terminated, with the union of its chunks' spans"** — `sendText('Hello, ', 'en', { ref: 2, span: [0, 7] })`, `sendText('world.', 'en', { ref: 2, span: [7, 13] })` (the sentence end sends `text_end`); `receive({ stream_id: 'utt-1-1', terminated: true })` → `ends` is `[{ streamId: 'utt-1-1', ref: 2, span: [0, 13], clean: true }]`.
  3. **"a language change splits the span between two segments"** — `sendText('Hola, ', 'es', { ref: 2, span: [0, 6] })`, `sendText('hello.', 'en', { ref: 2, span: [6, 12] })`; terminated for `utt-1-1` → `ends[0]` `{ streamId: 'utt-1-1', span: [0, 6], clean: true }`; then `utt-1-2` has been opened (its config sent with `language: 'en'`); its terminated → `ends[1]` `{ streamId: 'utt-1-2', span: [6, 12], clean: true }`.
  4. **"a new ref starts a new segment, even mid-clause"** — `sendText('and then', 'en', { ref: 2, span: [0, 8] })`, `sendText('next', 'en', { ref: 4, span: [0, 4] })` → a `text_end` for `utt-1-1` was sent before the second stream's config; `receive({ stream_id: 'utt-1-1', terminated: true })` → `ends.map((e) => e.ref)` is `[2]`, and `utt-1-2` opens with `'next'`. `'next'` ends no sentence, so `utt-1-2` is still active, not draining, and a `terminated` now would be ignored (`ttsStream.ts`'s terminated branch reads only the draining stream — the review's M9): `tts.endUtterance()` ends it (its `text_end` is sent), then `receive({ stream_id: 'utt-1-2', terminated: true })` → `ends.map((e) => e.ref)` is `[2, 4]`.
  5. **"a 408-killed segment ends unclean, once"** — `sendText('Hello.', 'en', { ref: 2, span: [0, 6] })`; `receive({ stream_id: 'utt-1-1', error_code: 408, error_message: 'Request timeout' })`, then `receive({ stream_id: 'utt-1-1', terminated: true })` → `ends` is `[{ streamId: 'utt-1-1', ref: 2, span: [0, 6], clean: false }]`.
  6. **"a socket that drops ends its live segments unclean; close() ends none"** — with `utt-1-1` active, `sockets.last().drop(); await flush()` → one end, `clean: false`. On a second stream, `sendText(…)` then `tts.close()` → no end.
  7. **"untagged text — the old client's call — reports no ref and no span"** — `sendText('Hi.', 'en')`; terminated → `ends[0]` is `{ streamId: 'utt-1-1', ref: undefined, span: undefined, clean: true }`, and audio's info has `ref: undefined`.

  Cases 1–6 fail: `sendText` ignores a tag and nothing calls `onSegmentEnd`. Case 7 fails only until `onSegmentEnd` exists.
- [ ] **Step 2: Run** `npx vitest run src/providers/soniox/ttsStream.segments.test.ts` — FAIL.
- [ ] **Step 3: Implement** in `ttsStream.ts`:
  - `import type { TextRange } from '../../lib/contract/adapter';` and the three interfaces above, each with a doc comment; `QueuedItem` gains `tag?: TextTag`.
  - State: `/** Per stream this component opened: the ref its text carries and the union of its chunks' spans. Deleted at the stream's end. */ private readonly segments = new Map<string, { ref?: number; span?: TextRange }>();` and `private activeRef: number | undefined;`.
  - `sendText(text, language, tag?)`: the queued item carries `tag`.
  - `doSendText(item)`: the split condition becomes `if (this.activeStreamId && (this.activeLanguage !== item.language || (item.tag !== undefined && this.activeRef !== item.tag.ref)))` — one stream speaks one ref's text, so its span is that ref's; `openSegment(item.language!, item.at!, item.tag?.ref)`; after the text frame is sent:

    ```ts
    const record = this.segments.get(this.activeStreamId!);
    if (record && item.tag) {
      const [a, b] = item.tag.span;
      record.span = record.span ? [Math.min(record.span[0], a), Math.max(record.span[1], b)] : [a, b];
    }
    ```

  - `openSegment(language, firstTextAt, ref?)`: `this.segments.set(streamId, { ref }); this.activeRef = ref;`; `endSegment`, `handleStreamFailure` and `resetStreams` set `this.activeRef = undefined` where they clear `activeStreamId`.
  - `private segmentEnded(streamId: string, clean: boolean): void { const record = this.segments.get(streamId); if (!record) return; this.segments.delete(streamId); this.handlers.onSegmentEnd?.({ streamId, ref: record.ref, span: record.span, clean }); }`.
  - Where streams end:
    - the terminated branch: `if (data.terminated && id === this.drainingStreamId) { this.segmentEnded(id, true); this.drainingStreamId = null; this.flushQueue(); }`;
    - `handleStreamFailure(streamId?)`: with no id, `segmentEnded(this.activeStreamId, false)` and `segmentEnded(this.drainingStreamId, false)` for whichever are set, before clearing them; with an id, `this.segmentEnded(streamId, false)` first;
    - `ws.onclose`'s unexpected branch: the same two unclean ends, before `resetStreams()`;
    - `close()`: `this.segments.clear()` — an intentional close ends nothing.
  - The audio branch: `this.handlers.onAudio?.(this.base64ToInt16(data.audio), { streamId: id!, ref: this.segments.get(id!)?.ref });`.
- [ ] **Step 4: Run** `npx vitest run src/providers/soniox src/services` — PASS: `ttsStream.test.ts` passes no tag (the old calls), and the old client's `onAudio: (audio) => …` ignores the second argument. Then the full suite and the gate.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/soniox/ttsStream.ts src/providers/soniox/ttsStream.segments.test.ts
  ```

  ```bash
  git commit -q -F - -- src/providers/soniox/ttsStream.ts src/providers/soniox/ttsStream.segments.test.ts <<'EOF'
  feat(soniox): TTS chunks carry the span they speak, and a segment says how it ended

  sendText takes an optional tag (a ref and the chunk's span in its text);
  each stream keeps the union of its chunks' spans and reports it at its
  end — clean at its terminated, unclean when an error or a dropped socket
  ended it. Audio says which stream and ref it belongs to. Untagged calls,
  the old client's, are unchanged.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 3: `speechRanges` — ranges filled in after the audio (ruling 2)

**Files:**
- Modify: `src/lib/contract/adapter.ts` (`AdapterEvents`), `src/lib/contract/adapter.test.ts`, `src/lib/contract/events.ts` (`KINDS`), `src/lib/contract/conformance.ts`, `src/lib/contract/conformance.test.ts`, `src/lib/conversation/Conversation.ts`, `src/lib/conversation/Conversation.test.ts`, `src/providers/fake/script.ts`, `src/providers/fake/adapter.ts`, `src/providers/fake/scripts.ts`, `src/providers/fake/scripts.test.ts`, `src/lib/view/karaoke.ts` (`nextLit`: the hold), `src/lib/view/karaoke.test.ts`.

**Interfaces:**
- **Produces:**
  - `AdapterEvents.speechRanges(e: { ref: Ref; ranges: ReadonlyArray<{ index: number; range: TextRange }> }): void`, and the kind `speechRanges` in `EVENT_KINDS`;
  - conformance rules `ranges-entry` and `ranges-order` (and `range-in-text` over filled ranges, each range of an event flagged on its own);
  - `Conversation`: `speechRanges` applied to open, closed and pending speech, re-anchored from `unfilled`, indices counted past `clearedEntries` (both private);
  - `nextLit(prev, playing, legs)` — same signature — now holds `prev` while a rangeless clip of `prev`'s segment plays (choice 18);
  - the fake's step `{ at: number; ranges: { ref: number; ranges: Array<{ index: number; range: TextRange }> } }` and its script `'late-ranges'` in `FAKE_SCRIPT_NAMES`.
- **Consumed by:** Task 7 (`speech.ts` emits it), Task 8 (the conformance harness checks it on Soniox), Task 13 (the spec), group check A (the preview renders `late-ranges`).

- [ ] **Step 1: Write the failing tests.**
  - `adapter.test.ts`, "can be implemented by a minimal adapter": the literal `events` object gains `speechRanges: () => seen.push('ranges'),` — the file does not compile without it once the member exists.
  - `conformance.test.ts`, in `describe('checkConformance rules')`, with `const ranges = (ref: number, list: Array<[number, [number, number]]>) => ({ kind: 'speechRanges' as const, payload: { ref, ranges: list.map(([index, range]) => ({ index, range })) } });`:
    1. **"accepts ranges filled in on a closed segment's existing entries"** — `[opened(2, 'translation'), text(2, 'Hello, world.'), closed(2), audio(2, undefined), audio(2, undefined), ranges(2, [[0, [0, 7]], [1, [7, 13]]])]` → `rules(log)` is `[]`.
    2. **"flags ranges for an entry the ref never emitted"** — `[opened(2, 'translation'), text(2, 'Hi.'), audio(2, undefined), ranges(2, [[1, [0, 3]]])]` → contains `'ranges-entry'`; `ranges(5, [[0, [0, 1]]])` alone → contains `'ranges-entry'`.
    3. **"flags a filled range beyond the ref's text, at close or at once when already closed"** — closed first: `[opened(2, 'translation'), text(2, 'Hi.'), closed(2), audio(2, undefined), ranges(2, [[0, [0, 9]]])]` → contains `'range-in-text'`; open: the same without `closed(2)`, then `closed(2)` last → contains `'range-in-text'`; and `[0, 3]` in either → no violation.
    4. **"flags ranges that overlap or run backwards in entry order"** — two entries, `ranges(2, [[0, [0, 8]], [1, [5, 13]]])` → contains `'ranges-order'`; `[[0, [7, 13]], [1, [0, 7]]]` → contains `'ranges-order'`; a zero-width `[[0, [0, 7]], [1, [7, 7]]]` → none.
    5. **"checks filled ranges against ranges the audio already carried"** — `opened(2, 'translation')`, `text(2, 'Hello, world.')`, `audio(2, [0, 7])`, `audio(2, undefined)`, then `ranges(2, [[1, [3, 13]]])` → contains `'ranges-order'`.
    5b. **"flags each out-of-text range of one speechRanges on its own"** (the review's M5) — `[opened(2, 'translation'), text(2, 'Hi.'), closed(2), audio(2, undefined), audio(2, undefined), ranges(2, [[0, [0, 5]], [1, [5, 9]]])]` → `rules(log).filter((r) => r === 'range-in-text')` has length 2. (Against the draft, which deduped by the log index every range of one event shares, it has length 1.)
  - `Conversation.test.ts`, a new `describe('Conversation — ranges filled in after the audio (speechRanges)')`, with `const ranges = (ref: number, list: Array<[number, [number, number]]>): AdapterEvent => ({ kind: 'speechRanges', payload: { ref, ranges: list.map(([index, range]) => ({ index, range })) } });`:
    6. **"sets ranges on speech a closed segment already holds"** — `make()`; `segmentOpened` ref 1 translation, `segmentText` `'hello world'`, two `audio` without range (`pcm(10)` each), `segmentClosed`; then `ranges(1, [[0, [0, 5]], [1, [6, 11]]])` → `speech.map((s) => s.range)` is `[[0, 5], [6, 11]]`, pcm untouched.
    7. **"re-anchors ranges measured against the adapter's text onto punctuation fill-in's"** — `make({ punctuate: async () => 'Hello, world.' })`; open, `'hello world'`, two rangeless `audio`, close; `await conv.settled()` → text `'Hello, world.'`; then `ranges(1, [[0, [0, 5]], [1, [5, 11]]])` → `[[0, 7], [7, 13]]` (the same skeleton mapping the existing re-anchoring case pins).
    8. **"a fill-in landing after the ranges re-anchors them as it re-anchors any range"** — `make({ punctuate: (_l, t) => new Promise((r) => setTimeout(() => r('Hello, world.'), 20)) })`; close; `ranges(1, [[0, [0, 5]], [1, [5, 11]]])` at once → `[[0, 5], [5, 11]]`; `await conv.settled()` → `[[0, 7], [7, 13]]`.
    8b. **"a revision after fill-in measures later ranges against the revised text, not the pre-fill one"** (the review's M6: the only case that fails without `text()`'s `this.unfilled.delete(ref)`) — `make({ punctuate: async () => 'Hello, world.' })`; open ref 1 translation, `'hello world'`, two rangeless `audio`, close; `await conv.settled()` → text `'Hello, world.'`; then the adapter revises the closed segment with different words, `segmentText` `'hello there'`; then `ranges(1, [[0, [0, 5]], [1, [6, 11]]])`, measured against `'hello there'` → `speech.map((s) => s.range)` is `[[0, 5], [6, 11]]`. A stale `unfilled` would re-anchor from `'hello world'`, whose letters `'hello there'` does not start with, and `reanchorRanges` drops both (`[undefined, undefined]`, `reanchor.ts:28`). The revision changes letters on purpose: a revision that only grows the text (Soniox's late tokens) re-anchors identically either way (`reanchor.ts:22`), so it could not tell the two apart.
    9. **"sets ranges on audio held before its segment opened"** — two `audio` on ref 3 before it opens; `ranges(3, [[1, [2, 4]]])`; then open ref 3 translation and text `'abcd'` → `speech.map((s) => s.range)` is `[undefined, [2, 4]]`.
    10. **"drops a range for an entry the segment does not hold, or an invalid range, with a diagnostic, and applies the rest"** — ref 1 open with text `'Hello'` and one `audio`; `ranges(1, [[0, [0, 3]], [4, [0, 1]], [0, [5, 2]]])` → speech 0's range `[0, 3]`; `diagnostics.map((d) => d.code)` includes `'range_out_of_text'` twice.
    11. **"ignores ranges for a ref it does not hold"** — after `conv.clear()` on a closed ref: `ranges(1, [[0, [0, 3]]])` changes nothing and reports nothing (`diagnostics` stays empty).
    11b. **"counts a fill-in's entries from the adapter's first audio, across a clear"** (the review's M4) — `make()`; open ref 1 translation, text `'hello world'`, two rangeless `audio` (the adapter's entries 0 and 1); `conv.clear()` (the segment stays open, its text `''` and speech `[]`); the adapter goes on: `segmentText` `'hello world, bye'`, one rangeless `audio` (its entry 2), close; then `ranges(1, [[0, [0, 5]], [1, [6, 11]], [2, [13, 16]]])` → `speech.map((s) => s.range)` is `[[13, 16]]` and `diagnostics` is empty (entries 0 and 1 went with the clear, silently). Without `clearedEntries` the adapter's entry 0 lands on the post-clear entry (`[0, 5]`, the wrong words) and entries 1 and 2 are dropped with two diagnostics.
    12. **"drops a filled range beyond a closed segment's text, keeping the pcm"** — text `'Hi.'`, closed, one `audio`, `ranges(1, [[0, [0, 9]]])` → range `undefined`, pcm length unchanged, a `range_out_of_text` diagnostic.
  - `karaoke.test.ts`, in `describe('createKaraoke')`:
    13. **"lights a playing clip only once its range is filled in, from where playback is (ruling 2)"**:

        ```ts
        const { clock, queues, karaoke, setSegment } = setup(segment({ speech: [{ pcm: SECOND }, { pcm: SECOND }] }));
        karaoke.subscribe(() => {});
        queues.speaker.set({ key: 'speaker:2:0', t: 500, ms: 1000 }, 2);
        expect(karaoke.get().lit.size).toBe(0);                    // (a): no range, not highlighted
        setSegment(segment({ speech: [{ range: [0, 6], pcm: SECOND }, { range: [6, 13], pcm: SECOND }] }));
        expect(karaoke.get().lit.get('s:speaker:2')).toBe(3);      // mid-clip: half of [0, 6]
        queues.speaker.move(1000);
        clock.advance(KARAOKE_INTERVAL_MS);
        expect(karaoke.get().lit.get('s:speaker:2')).toBe(6);
        ```

        Characterization: it passes against `karaoke.ts` as it is — a single clip lights from its fill-in with no karaoke change (`litFor` reads the entry's range at each sample, `karaoke.ts:57-64`). Write it first anyway: it pins the contract Task 7 relies on.
    13b. **"keeps a lit sentence lit while the row's next, rangeless clip plays, and sweeps on once that clip's range is filled in (choice 18)"** — RED first: against `karaoke.ts` as it is, the second assertion reads `undefined` (the row un-highlights):

        ```ts
        const { queues, karaoke, setSegment } = setup(segment({ speech: [{ range: [0, 6], pcm: SECOND }, { pcm: SECOND }] }));
        karaoke.subscribe(() => {});
        queues.speaker.set({ key: 'speaker:2:0', t: 1000, ms: 1000 }, 2);
        expect(karaoke.get().lit.get('s:speaker:2')).toBe(6);      // sentence A spoken, lit
        queues.speaker.set({ key: 'speaker:2:1', t: 0, ms: 1000 }, 1);
        expect(karaoke.get().lit.get('s:speaker:2')).toBe(6);      // B plays rangeless: A stays lit
        queues.speaker.move(500);
        setSegment(segment({ speech: [{ range: [0, 6], pcm: SECOND }, { range: [6, 13], pcm: SECOND }] }));
        expect(karaoke.get().lit.get('s:speaker:2')).toBe(10);     // B's fill-in: from mid-clip, 6 + round(7 × 0.5)
        ```

    13c. **"a fill-in that lands after the queue emptied lights nothing live; a replay lights it"** — characterization (ruling 2's recorded behaviour; passes before and after):

        ```ts
        const { queues, karaoke, setSegment } = setup(segment({ speech: [{ pcm: SECOND }] }));
        karaoke.subscribe(() => {});
        queues.speaker.set({ key: 'speaker:2:0', t: 0, ms: 1000 }, 1);
        queues.speaker.set(null, 0);                               // played out before its range arrived
        setSegment(segment({ speech: [{ range: [0, 13], pcm: SECOND }] }));
        expect(karaoke.get().lit.size).toBe(0);                    // nothing plays, nothing was lit: nothing to hold
        queues.replay.set({ key: 'speaker:2:0', t: 500, ms: 1000 }, 1);
        expect(karaoke.get().lit.get('s:speaker:2')).toBe(7);      // replay reads the filled range: round(13 × 0.5)
        ```

  - `karaoke.test.ts`, a new `describe('nextLit while a rangeless clip plays')` with `const prev = { segmentId: 's:speaker:2', leg: 'speaker' as const, upTo: 6 };` and `const B = { key: 'speaker:2:1', t: 0, ms: 1000 };`:
    13d. **"holds prev while a rangeless clip of prev's segment plays"** — `nextLit(prev, B, legs(segment({ speech: [{ range: [0, 6], pcm: SECOND }, { pcm: SECOND }] })))` is `prev` (`toBe`). RED first.
    13e. **"lights nothing for a rangeless clip of another segment"** — a leg holding ref 2's segment (as 13d) and `segment({ id: 's:speaker:4', ref: 4, speech: [{ pcm: SECOND }] })`: `const two: readonly Leg[] = [{ ...legs(segment())[0], segments: [segment({ speech: [{ range: [0, 6], pcm: SECOND }, { pcm: SECOND }] }), segment({ id: 's:speaker:4', ref: 4, speech: [{ pcm: SECOND }] })] }]` → `nextLit(prev, { key: 'speaker:4:0', t: 0, ms: 1000 }, two)` is `null`. Characterization.
    13f. **"the hold keeps the gap rules: it ends when every range was dropped, and clamps to a shorter text"** — `nextLit(prev, B, legs(segment({ speech: [{ pcm: SECOND }, { pcm: SECOND }] })))` is `null`; `nextLit(prev, B, legs(segment({ text: 'あいう', final: false, speech: [{ range: [0, 1], pcm: SECOND }, { pcm: SECOND }] })))` equals `{ ...prev, upTo: 3 }`. The first is characterization; the second is RED first.
  - `scripts.test.ts`:
    14. "offers the nine scripts…" becomes **"offers the ten scripts, and every one plays conformant through the kit's driver"**, `ALL` gaining `'late-ranges'` last.
    15. **"late-ranges: rangeless audio on a closed translation, then its ranges filled in"** — play it through a `Conversation` as the `rangeless` case does (`scripts.test.ts:115`): after `clock.advance(1_200)` the translation (ref 2) is `final` with two speech entries, both `range: undefined`; after `clock.advance(200)` more, their ranges are `[[0, 6], [6, 13]]`.
    16. **"late-ranges with speech off emits neither audio nor ranges"** — `driveAdapter` with `speech: false` → no `audio` and no `speechRanges` in the log, and no violations.
- [ ] **Step 2: Run** `npx vitest run src/lib/contract src/lib/conversation src/lib/view/karaoke.test.ts src/providers/fake` — FAIL: cases 2–5b, 6–10, 11b, 12, 13b, 13d, 13f's second assertion, 14–16. Characterization, passing before and after, as the review's M7 found and as named: case 1 (`checkConformance`'s `default` branch ignores an unknown kind, so `rules(log)` is `[]` either way), case 11 (`Conversation.dispatch`'s `default` ignores it), 13, 13c, 13e and 13f's first assertion. The literal in `adapter.test.ts` fails only the typecheck gate until the member exists.
- [ ] **Step 3: Implement.**
  - `adapter.ts`, in `AdapterEvents` after `audio`:

    ```ts
      /**
       * Sets the ranges of speech this adapter already emitted for `ref`
       * (Stage 2 Soniox, ruling 2): `index` is the entry's place among this
       * ref's `audio` events, 0 first. Measured, like `audio.range`, against
       * the text the adapter last sent for `ref`. The entries must exist, each
       * range must lie within that text, and a ref's ranged entries must ascend
       * without overlapping. The segment may already be closed.
       */
      speechRanges(e: { ref: Ref; ranges: ReadonlyArray<{ index: number; range: TextRange }> }): void;
    ```

  - `events.ts`: `speechRanges: true` in `KINDS` (after `audio`).
  - `conformance.ts`:
    - state: `const audioCount = new Map<number, number>(); const entryRanges = new Map<number, Map<number, [number, number]>>();` and a helper

      ```ts
      /** A ref's ranged entries, in entry order, must ascend without overlapping: the karaoke sweep reads them so. */
      const checkOrder = (ref: number, index: number) => {
        const ordered = [...(entryRanges.get(ref) ?? new Map<number, [number, number]>()).entries()].sort((a, b) => a[0] - b[0]);
        for (let k = 1; k < ordered.length; k++) {
          if (ordered[k][1][0] < ordered[k - 1][1][1]) {
            flag('ranges-order', `ref ${ref}: entry ${ordered[k][0]}'s range starts before entry ${ordered[k - 1][0]}'s ends`, index);
            return;
          }
        }
      };
      ```

    - **Each range is flagged on its own** (the review's M5): `flaggedRange` becomes a `Set<string>` and each `rangesByRef` entry carries a `key: string` — `String(index)` for an `audio` range (one per log entry, as today), `` `${index}:${k}` `` for the `k`-th range of a `speechRanges` — and `checkRangesForRef` reads and records `e.key` where it read `e.index` (the flag's `index` argument stays `e.index`). The existing `audio` push becomes `list.push({ index, key: String(index), range: [start, end] })`.
    - `case 'audio'`: once `ref !== undefined`, `const n = audioCount.get(ref) ?? 0; audioCount.set(ref, n + 1);` and, for a valid range, `entryRanges` gains `n → range` (a `Map` created on first use) before the existing `rangesByRef` push;
    - a new case:

      ```ts
      case 'speechRanges': {
        const { ref, ranges } = entry.payload;
        const count = audioCount.get(ref) ?? 0;
        const byIndex = entryRanges.get(ref) ?? new Map<number, [number, number]>();
        entryRanges.set(ref, byIndex);
        ranges.forEach(({ index: entryIndex, range }, k) => {
          if (!Number.isInteger(entryIndex) || entryIndex < 0 || entryIndex >= count) {
            flag('ranges-entry', `ranges name speech entry ${entryIndex} of ref ${ref}, which has ${count}`, index);
            return;
          }
          const [start, end] = range;
          if (start < 0 || start > end) {
            flag('range-in-text', `range [${start}, ${end}] is not a valid range`, index);
            return;
          }
          byIndex.set(entryIndex, [start, end]);
          const list = rangesByRef.get(ref) ?? [];
          // One key per range, not per log entry: two bad ranges in one event are two violations (M5).
          list.push({ index, key: `${index}:${k}`, range: [start, end] });
          rangesByRef.set(ref, list);
        });
        if (closedRefs.has(ref)) checkRangesForRef(ref);
        checkOrder(ref, index);
        break;
      }
      ```

      and `case 'audio'` calls `checkOrder(ref, index)` after recording a range. (`index` in these cases is the log index `forEach` gives, as elsewhere in the file.)
  - `Conversation.ts`:
    - `/** A segment whose text fill-in replaced: the adapter's own text, which a late `speechRanges` is measured against. Deleted when the adapter sends text again. */ private readonly unfilled = new Map<number, string>();`
    - `/** Per ref, the speech entries `clear()` dropped: an adapter counts `speechRanges` indices from its first `audio`, L1 (and the clip keys, `playback.clear()`) from the clear (choice 1, M4). */ private readonly clearedEntries = new Map<number, number>();`
    - `dispatch`: `case 'speechRanges': return this.ranges(event.payload.ref, event.payload.ranges);`
    - `text()` (the adapter's `segmentText`): first line `this.unfilled.delete(ref);`
    - `markFinal`'s fill-in job, where it replaces: `this.unfilled.set(seg.ref, before); this.replaceText(j, filled, { mark: false });`
    - `clear()`, first, before `kept` is computed: every segment's and every pending list's entries are counted as dropped, closed segments' too (a closed Soniox translation's speech keeps arriving after a clear, into `pending`) —

      ```ts
      const dropped = (ref: number, n: number) => { if (n > 0) this.clearedEntries.set(ref, (this.clearedEntries.get(ref) ?? 0) + n); };
      for (const seg of this.segments) dropped(seg.ref, seg.speech.length);
      for (const [ref, list] of this.pending) dropped(ref, list.length);
      ```

      and, with the other resets, `this.unfilled.clear();`
    - the handler:

      ```ts
      /** Ranges an adapter sets on speech it already emitted: measured against the text it last sent, re-anchored onto the text as it stands (choice 1). */
      private ranges(ref: number, all: ReadonlyArray<{ index: number; range: TextRange }>): void {
        const valid = ([start, end]: TextRange) => start >= 0 && start <= end;
        // The adapter counts from its first audio; L1 from the last clear. An entry the clear dropped is gone with its audio.
        const offset = this.clearedEntries.get(ref) ?? 0;
        const given = all.flatMap((g) => (g.index < offset ? [] : [{ index: g.index - offset, range: g.range }]));
        const i = this.indexByRef.get(ref);
        if (i === undefined) {
          // Audio held in `pending` takes them — before its segment opened, or after a clear dropped its closed segment; it moves with its pcm at open.
          const held = this.pending.get(ref);
          if (!held) return; // a ref with neither a segment nor held audio
          this.pending.set(ref, held.map((s, k) => {
            const hit = given.find((g) => g.index === k && valid(g.range));
            return hit ? { ...s, range: hit.range } : s;
          }));
          return;
        }
        const seg = this.segments[i];
        const hits = given.filter((g) => {
          const ok = Number.isInteger(g.index) && g.index >= 0 && g.index < seg.speech.length && valid(g.range);
          if (!ok) this.opts.onDiagnostic?.({ code: 'range_out_of_text', message: `speech entry ${g.index} of ${seg.id} cannot take range [${g.range[0]}, ${g.range[1]}]` });
          return ok;
        });
        if (hits.length === 0) return;
        const anchored = reanchorRanges(this.unfilled.get(ref) ?? seg.text, seg.text, hits.map((h) => h.range));
        const speech = [...seg.speech];
        hits.forEach((h, k) => { speech[h.index] = { ...speech[h.index], range: anchored[k] }; });
        this.replace(i, { ...seg, speech });
        if (seg.final) this.clampRanges(i);
      }
      ```

  - `karaoke.ts` — the hold (choice 18). The gap branch of `nextLit` (`:82-90`) becomes a module-private function both branches call, its body unchanged; `nextLit`'s doc comment gains the sentence below:

    ```ts
    /** What a held `prev` becomes now that nothing it names is being swept: the gap rules, clamp included. */
    function hold(prev: Lit, legs: readonly Leg[]): Lit | null {
      const segment = legs.find((l) => l.leg === prev.leg)?.segments.find((s) => s.id === prev.segmentId);
      if (!segment) return null;
      if (segment.speech.length > 0 && segment.speech.every((s) => s.range === undefined)) return null;
      const reached = segment.speech.reduce((end, s) => Math.max(end, s.range?.[1] ?? 0), 0);
      const mayContinue = !segment.final || countSkeleton(segment.text.slice(reached)) > 0;
      if (!mayContinue) return null;
      const upTo = Math.min(prev.upTo, segment.text.length);
      return upTo === prev.upTo ? prev : { ...prev, upTo };
    }

    export function nextLit(prev: Lit | null, playing: Playing<ClipKey> | null, legs: readonly Leg[]): Lit | null {
      if (playing) {
        const lit = litFor(playing, legs);
        if (lit || !prev) return lit;
        // A clip whose range is not filled in yet (a streaming TTS, Stage 2 Soniox) of the segment already lit:
        // what is lit stays lit, and only this clip's own words wait for their range (option (a); choice 18).
        const clip = clipOf(playing.key, legs);
        return clip && clip.leg === prev.leg && clip.segment.id === prev.segmentId ? hold(prev, legs) : null;
      }
      return prev ? hold(prev, legs) : null;
    }
    ```

    The doc comment's added sentence: "Playing a clip with no range — its range is filled in later — of the segment already lit holds by the same rules: a row spoken as several TTS segments never un-highlights between them." `createKaraoke` is unchanged: the replay queue still reads `litFor` only.
  - The fake:
    - `script.ts`: `ScriptStep` gains `| { at: number; ranges: { ref: number; ranges: Array<{ index: number; range: TextRange }> } }`;
    - `adapter.ts`: `maxRef` counts `'ranges' in step` (`step.ranges.ref`); `play`: `else if ('ranges' in step) { if (this.context.speech) this.emit('speechRanges', step.ranges); }`;
    - `scripts.ts`: `'late-ranges'` joins `FakeScriptName` and `FAKE_SCRIPT_NAMES` (last), and

      ```ts
          case 'late-ranges':
            // Soniox's shape (Stage 2 Soniox, ruling 2): the translation closes at the
            // endpoint, its speech streams as rangeless chunks, and the ranges are
            // filled in once the speech segment has ended — no karaoke before, a sweep after.
            return {
              blocks: [{
                startAt: 500,
                steps: [
                  { at: 0, open: { ref: 1, side: 'source', origin: 'l1' } },
                  { at: 0, text: { ref: 1, text: 'Hello, how are you?' } },
                  { at: 200, close: { ref: 1, origin: 'l1' } },
                  { at: 400, open: { ref: 2, side: 'translation', origin: 'l1' } },
                  { at: 400, text: { ref: 2, text: 'こんにちは、お元気ですか？' } },
                  { at: 400, close: { ref: 2, origin: 'l1' } },
                  { at: 600, audio: { ref: 2, ms: msForText('こんにちは、') } },
                  { at: 600, audio: { ref: 2, ms: msForText('お元気ですか？') } },
                  { at: 800, ranges: { ref: 2, ranges: [{ index: 0, range: [0, 6] }, { index: 1, range: [6, 13] }] } },
                ],
              }],
            };
      ```

      with `import { msForText } from './synth';`. The two clips are enqueued at 1.1 s and last 360 + 420 ms; the ranges land at 1.3 s, while the first clip plays — so the preview shows the row unlit, then lit from mid-clip on (group check A, item 5).
- [ ] **Step 4: Run** the Step 2 command — PASS. Then the full suite and the gate. What else reads events or karaoke, and why it stays green: `run.ts`'s `onEvent` hands every kind to `Conversation.apply` and ignores the ones its switch does not name; `events.test.ts` iterates `EVENT_KINDS`; the fake's other nine scripts have no `ranges` step; `karaoke.test.ts`' existing cases never play a rangeless clip of a lit segment (the hold changes only what such a clip shows), and the one other importer, `src/app/session.test.ts`, mocks `../lib/view/karaoke` wholesale; the existing `clear()` cases hold no `speechRanges`, so `clearedEntries` changes nothing they read.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/lib/contract/adapter.ts src/lib/contract/adapter.test.ts src/lib/contract/events.ts src/lib/contract/conformance.ts src/lib/contract/conformance.test.ts src/lib/conversation/Conversation.ts src/lib/conversation/Conversation.test.ts src/providers/fake/script.ts src/providers/fake/adapter.ts src/providers/fake/scripts.ts src/providers/fake/scripts.test.ts src/lib/view/karaoke.ts src/lib/view/karaoke.test.ts
  ```

  ```bash
  git commit -q -F - -- src/lib/contract/adapter.ts src/lib/contract/adapter.test.ts src/lib/contract/events.ts src/lib/contract/conformance.ts src/lib/contract/conformance.test.ts src/lib/conversation/Conversation.ts src/lib/conversation/Conversation.test.ts src/providers/fake/script.ts src/providers/fake/adapter.ts src/providers/fake/scripts.ts src/providers/fake/scripts.test.ts src/lib/view/karaoke.ts src/lib/view/karaoke.test.ts <<'EOF'
  feat(contract): speechRanges — an adapter fills in the ranges of speech it already emitted

  A streaming TTS knows a chunk's range only once its segment has ended.
  speechRanges sets ranges on existing speech entries by index, measured
  against the text the adapter last sent and counted past any clear; L1
  applies them to a closed segment too, re-anchored over punctuation
  fill-in. Conformance checks that the entries exist, lie within the text
  and ascend; the fake's late-ranges script plays the shape. Karaoke holds
  what is lit while the same row's next, still rangeless clip plays, so a
  row never un-highlights between its sentences.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 4: `startBoth` names the leg that failed; each leg's own track

**Files:**
- Modify: `src/lib/contract/adapter.ts`, `src/lib/contract/adapter.test.ts`, `src/lib/session/run.ts`, `src/lib/session/runner.hooks.test.ts`, `src/providers/fake/leased.ts`, `src/providers/fake/leased.test.ts`.

**Interfaces:**
- **Produces:** `class LegStartError extends Error { readonly leg: LegName; readonly cause: unknown; constructor(leg: LegName, cause: unknown) }` in `src/lib/contract/adapter.ts`; `run.ts` turns it into `LegOpenError(error.leg, error.cause)`.
- **Consumed by:** Task 9 (Soniox's split and shared `startBoth`); the runner's start notice (`runner.ts:211-236`), which already reads `LegOpenError.leg` and an `AdapterStartError`'s code.

- [ ] **Step 1: Write the failing tests.**
  - `adapter.test.ts`:
    1. **"LegStartError names the leg and keeps that leg's failure as its cause and message"** — `const cause = new AdapterStartError('no loopback', 'network'); const e = new LegStartError('participant', cause);` → `e.leg === 'participant'`, `e.cause === cause`, `e.message === 'no loopback'`; `new LegStartError('speaker', 'plain').message === 'plain'`.
  - `runner.hooks.test.ts`. `setup` gains a third parameter, `openSource?: (leg: LegName) => Source`, used in place of the fake source when given (`openSource: async (leg) => { const s = openSource ? openSource(leg) : createFakeSource(clock); sources.push(s as FakeSource); return s; }`). In `describe('runner — startBoth (D23)')`:
    2. **"names the leg startBoth says failed, with that leg's own code"** — `startBoth: async () => { throw new LegStartError('participant', new AdapterStartError('no loopback', 'network', { detail: 'denied' })); }` → `runner.state.getState()` matches `{ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'network', leg: 'participant', params: { detail: 'denied' } } } }`.
    3. **"a startBoth failure that names no leg is the first leg's, as before"** — `throw new Error('boom')` → `notice: { code: 'start_failed', leg: 'speaker' }`.
    4. **"hands startBoth each leg's own track"** (roadmap 1c-3 → Stage 2) — `openSource: (leg) => ({ ...createFakeSource(clock), track: { id: \`${leg}-track\` } as unknown as MediaStreamTrack })`; a `startBoth` that records `requests` then starts both legs on the fake → `requests.speaker.input` has `id` `'speaker-track'`, `requests.participant.input` has `id` `'participant-track'`, and they are different objects.
  - `leased.test.ts`, "startBoth opens nothing when a leg fails…": add `await expect(session.startBoth!(requests, events)).rejects.toBeInstanceOf(LegStartError)` and `.rejects.toMatchObject({ leg: 'participant' })` (a fresh `bothLegs(s(), s({ startThrows: true }))` for each `expect`; the existing `toThrow('The fake failed to start (fault knob).')` stays true: the error's message is its cause's).
- [ ] **Step 2: Run** `npx vitest run src/lib/contract/adapter.test.ts src/lib/session/runner.hooks.test.ts src/providers/fake/leased.test.ts` — cases 1, 2 and the leased ones fail; 3 and 4 pass (characterization: 3 pins today's fallback, 4 pins what `run.ts:232-236` already does).
- [ ] **Step 3: Implement.**
  - `adapter.ts`, after `AdapterStartError` (with `import type { LegName } from '../conversation/types';`):

    ```ts
    /**
     * A `startBoth` that failed on one leg says which (D22): the runner's
     * notice names it. `cause` is that leg's own failure — an
     * `AdapterStartError` keeps its code — and the message is the cause's.
     * Set here, not passed to `super`: this project's lib (ES2020) has no
     * `Error` options.
     */
    export class LegStartError extends Error {
      readonly cause: unknown;

      constructor(readonly leg: LegName, cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause));
        this.cause = cause;
      }
    }
    ```

  - `run.ts`, the `startBoth` catch (`:241-243`):

    ```ts
      } catch (error) {
        // A provider that knows which leg failed says so; otherwise the start is the first leg's.
        if (error instanceof LegStartError) throw new LegOpenError(error.leg, error.cause);
        throw new LegOpenError(shape.legs[0], error);
      }
    ```

    with a **value** import on its own line, `import { LegStartError } from '../contract/adapter';` — the existing import from that module (`run.ts:8`) is `import type`, and a class used in `instanceof` through a type-only import is TS1361 (the review's I2).
  - `leased.ts`, `startBothLeased`: `const i = settled.findIndex((r) => r.status === 'rejected');` in place of `find`, and `throw new LegStartError(legs[i], (settled[i] as PromiseRejectedResult).reason);` in place of `throw failed.reason;`, with the value import `import { LegStartError } from '../../lib/contract/adapter';` on its own line (`leased.ts:11`'s import is `import type`, as in `run.ts`).
  - The tests import what they construct or match as values: `adapter.test.ts`' value import (`:3`) gains `LegStartError`; `runner.hooks.test.ts` gains `import { AdapterStartError, LegStartError } from '../contract/adapter';` (its `:2` import stays `import type`), `import type { LegName } from '../conversation/types';` and `import type { Source } from './source';` (for `setup`'s `openSource` parameter); `leased.test.ts` gains `import { LegStartError } from '../../lib/contract/adapter';`.
- [ ] **Step 4: Run** the Step 2 command, then `npx vitest run src/lib/session src/providers/fake`, the full suite and the gate — PASS. `runner.test.ts` and `leased.test.ts`' other cases assert messages, which `LegStartError` keeps.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/lib/contract/adapter.ts src/lib/contract/adapter.test.ts src/lib/session/run.ts src/lib/session/runner.hooks.test.ts src/providers/fake/leased.ts src/providers/fake/leased.test.ts
  ```

  ```bash
  git commit -q -F - -- src/lib/contract/adapter.ts src/lib/contract/adapter.test.ts src/lib/session/run.ts src/lib/session/runner.hooks.test.ts src/providers/fake/leased.ts src/providers/fake/leased.test.ts <<'EOF'
  feat(session): startBoth names the leg that failed to start

  LegStartError (contract) carries a leg and its failure; the run turns
  it into that leg's LegOpenError, so the start's notice names the
  participant when the participant failed. The leased fake throws it. A
  runner test pins that startBoth gets each leg's own track.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 5: Soniox's settings, languages, credentials, config and check

**Files:**
- Create: `src/providers/soniox/settings.ts`, `settings.test.ts`, `config.ts`, `config.test.ts`, `check.ts`, `check.test.ts`.

**Interfaces:**
- **Produces:**
  - `settings.ts`: `interface SonioxSettings { region: SonioxRegion; voice: string; voiceEu: string; voiceJp: string; bothModeSharedSession: boolean; vocabularyTerms: string; vocabularyTranslations: string; contextText: string; endpointSensitivity: number; endpointLatencyAdjustmentLevel: number; endpointMaxDelayMs: number; ttsSpeed: number }`; `SONIOX_DEFAULTS`; `migrateSonioxSettings(stored): SonioxSettings`; `type SonioxKeyField = 'apiKey' | 'apiKeyEu' | 'apiKeyJp'`; `SONIOX_KEY_FIELDS`; `sonioxKeyField(region): SonioxKeyField`; `sonioxVoiceField(region): 'voice' | 'voiceEu' | 'voiceJp'`; `interface SonioxLeasePort { streamAccepted(): void; atGrantEnd(now: number): boolean; cutoff(): void }`; `interface SonioxCredentials { region: SonioxRegion; stt: string; tts?: string; clientReferenceId?: string; lease?: SonioxLeasePort }`; `sonioxCredentials` (the definition's `credentials` member); `SONIOX_LANGUAGES`; `sonioxLanguages` (the definition's `languages`).
  - `config.ts`: `SONIOX_STT_MODEL = 'stt-rt-v5'`; `interface SonioxWireContext { terms?: string[]; translation_terms?: Array<{ source: string; target: string }>; text?: string }`; `interface SonioxConfig { stt: { model: string; context?: SonioxWireContext; endpointSensitivity: number; endpointLatencyAdjustmentLevel: number; endpointMaxDelayMs: number }; tts?: { voice: string; speed: number }; sharedBoth: boolean }`; `buildSoniox(context, s, shared): SonioxConfig`; `describeSoniox(c)`; `parseVocabularyTerms`, `parseVocabularyTranslations`, `clampNumber` (exported for tests and the settings view).
  - `check.ts`: `CHECK_TIMEOUT_MS = 15_000`; `createSonioxCheck(deps?: { fetch?: typeof fetch; clock?: Pick<Clock, 'setTimeout'> })`; `checkSoniox` (the default).
- **Consumed by:** Tasks 7–12.

- [ ] **Step 1: Write the failing tests.**
  - `settings.test.ts` (`const p = { languages: sonioxLanguages }` for the language rules):
    1. **"defaults to the US region, Adrian in every region, shared Both on, and Soniox's server defaults"** — `SONIOX_DEFAULTS` equals `{ region: 'us', voice: 'Adrian', voiceEu: 'Adrian', voiceJp: 'Adrian', bothModeSharedSession: true, vocabularyTerms: '', vocabularyTranslations: '', contextText: '', endpointSensitivity: 0, endpointLatencyAdjustmentLevel: 0, endpointMaxDelayMs: 2000, ttsSpeed: 1 }`.
    2. **"migrates the defaults, stored as they are, into the defaults; an unknown region to US; a wrong-typed field to its default"** — `migrateSonioxSettings({ ...SONIOX_DEFAULTS })` `toEqual(SONIOX_DEFAULTS)` (spread: the function takes one argument, and an interface has no index signature to pass as `Readonly<Record<string, unknown>>` — `fake/provider.test.ts:105` does the same; the two-argument call through the definition is the registry invariant's, the review's I2); `{ ...SONIOX_DEFAULTS, region: 'mars' }` → `region: 'us'`; `{ ...SONIOX_DEFAULTS, endpointMaxDelayMs: 'x', voiceJp: 7, bothModeSharedSession: 'yes' }` → `2000`, `'Adrian'`, `true`; an unlisted stored field (`model: 'stt-rt-v5'`) does not appear in the result.
    3. **"shows one secret field: the region's key, with Soniox's placeholder"** — `sonioxCredentials.fields({ ...SONIOX_DEFAULTS, region: 'jp' })` → `[{ key: 'apiKeyJp', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'providers.soniox.apiKeyPlaceholder' }]`; `region: 'eu'` → `apiKeyEu`; `region: 'nowhere' as never` → `apiKey`.
    4. **"lists all three region keys, so a region switch never waits on storage"** — `sonioxCredentials.keys` is `['apiKey', 'apiKeyEu', 'apiKeyJp']`.
    5. **"reads the region from the field it was handed; one key serves both sockets; no client reference (ruling 7)"** — `read({ apiKeyEu: 'k' }, signedOut)` → `{ region: 'eu', stt: 'k', tts: 'k' }` exactly (`toEqual`, so no `clientReferenceId`, no `lease`); `{ apiKey: 'k' }` → region `'us'`.
    6. **"reads an empty key as missing, worded by the runner's own code"** — `read({ apiKeyJp: '' }, signedOut)` → `{ missing: 'Enter your Soniox API key for the JP region.' }` with no `code`.
    7. **"offers AUTO and the 60 languages as sources, the 60 as every source's targets, never AUTO, and starts auto → en"** — `sources(SONIOX_DEFAULTS)` has 61 entries, the first `{ value: 'auto', name: 'Auto', englishName: 'Auto' }`; `targets('ja', SONIOX_DEFAULTS)` has 60 entries and includes `ja` (the old list's parity) and not `auto`; `initial(SONIOX_DEFAULTS)` is `{ source: 'auto', target: 'en' }`.
    8. **"an auto source never reverses, so it refuses the participant leg (D20)"** — `reverseSupported(p, SONIOX_DEFAULTS, { source: 'auto', target: 'en' })` is `false`; `{ source: 'ja', target: 'en' }` is `true`.
    9. **"maps each region to its key and voice fields, US keeping the suffix-less names"** — `sonioxKeyField` `us/eu/jp` → `apiKey/apiKeyEu/apiKeyJp`; `sonioxVoiceField` → `voice/voiceEu/voiceJp`.
  - `config.test.ts` (`const AUTO_CTX: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' }`; `const SHARED` as `leased.test.ts:36-43`; `const build = (patch: Partial<SonioxSettings> = {}, context = AUTO_CTX) => buildSoniox(context, { ...SONIOX_DEFAULTS, ...patch }, SHARED)`), ported from `SonioxProviderConfig.test.ts` where named:
    10. **"builds stt-rt-v5 with no context and the server-default knobs at defaults"** — `build().stt` equals `{ model: 'stt-rt-v5', endpointSensitivity: 0, endpointLatencyAdjustmentLevel: 0, endpointMaxDelayMs: 2000 }`.
    11. **"parses the vocabulary into the wire's snake_case context"** (old `:80-95`) — `build({ vocabularyTerms: 'Sokuji\n Sokuji \n\nKizuna', vocabularyTranslations: 'a=b\nno equals\n=x\nk = v = w' }).stt.context` equals `{ terms: ['Sokuji', 'Kizuna'], translation_terms: [{ source: 'a', target: 'b' }, { source: 'k', target: 'v = w' }] }`.
    12. **"passes trimmed background text as context.text, and omits whitespace-only text"** (old `:178-187`).
    13. **"clamps the knobs, rounds the integer ones, and falls back on non-finite input"** (old `:97-131`) — `build({ endpointSensitivity: 5, endpointLatencyAdjustmentLevel: 2.6, endpointMaxDelayMs: 99_999, ttsSpeed: 9 })` → `1`, `3`, `3000`, and `tts.speed` `1.3`; `build({ endpointMaxDelayMs: Number.NaN, ttsSpeed: Number.POSITIVE_INFINITY })` → `2000` and `1`.
    14. The five budget cases of old `:133-262`, word for word but over `build(…).stt.context` with the wire's `translation_terms` for the old `translationTerms`: translations trimmed first with earlier lines kept; an under-budget vocabulary untouched; background text truncated first; text sacrificed entirely on extreme overflow; a trailing lone surrogate stripped; escape-heavy text cut exactly (serialized between 8 990 and 9 000). Each that overflowed spies `console.warn` (which `reportWarning` writes to synchronously) and expects one call.
    15. **"speaks only when the context speaks: the region's voice, the speed clamped"** — `build({}, { ...AUTO_CTX, speech: false }).tts` is `undefined`; `build({ region: 'jp', voiceJp: 'Clone-UUID' }).tts` is `{ voice: 'Clone-UUID', speed: 1 }`; `build({ region: 'eu', voiceEu: '' }).tts?.voice` is `'Adrian'`.
    16. **"carries the shared-Both choice"** — `build({ bothModeSharedSession: false }).sharedBoth` is `false`.
    17. **"describes the STT model always, and the TTS model only for a leg that speaks"** — `describeSoniox(build())` is `{ asrModel: 'stt-rt-v5', ttsModel: 'tts-rt-v2' }`; with `speech: false` → `{ asrModel: 'stt-rt-v5' }`.
  - `check.test.ts` — `const clock = createVirtualClock(0)`; `const K: SonioxCredentials = { region: 'eu', stt: 'k-eu', tts: 'k-eu' }`; `const ctx = (signal?: AbortSignal): CheckContext => ({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'], signal })`; a stub `fetch` built per case with `vi.fn()`:
    18. **"POSTs a 60-second temporary-key request for the key, at the key's region"** — `fetch` resolves `new Response(null, { status: 201 })`; `await createSonioxCheck({ fetch, clock })(K, SONIOX_DEFAULTS, ctx())` → `fetch` called once with `'https://api.eu.soniox.com/v1/auth/temporary-api-key'` and an init whose `method` is `'POST'`, `headers` `{ Authorization: 'Bearer k-eu', 'Content-Type': 'application/json' }`, `body` `JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 60 })`, and an `AbortSignal`.
    19. **"200 and 201 answer ready, with no models"** — both → `{ ok: true }`.
    20. **"401 and 403 answer not ready, with the auth code"** — both → `{ ok: false, code: 'auth', reason: expect.stringContaining('HTTP 401') }` (resp. `403`).
    21. **"any other status throws: it could not find out"** — `500` → rejects `/HTTP 500/`; `429` → rejects `/HTTP 429/`.
    22. **"a network failure throws"** — `fetch` rejects `new TypeError('Failed to fetch')` → rejects `/Failed to fetch/`.
    23. **"bounds its own request: no answer within 15 s throws, and aborts the request"** — `fetch` returns a promise that rejects when its `init.signal` aborts; `const answer = check(K, SONIOX_DEFAULTS, ctx())`; `clock.advance(14_999)` → still pending; `clock.advance(1)` → rejects `/did not answer.*15 s/`, and the stub's signal is aborted.
    24. **"the start's signal aborts the request"** — `const c = new AbortController()`; `check(K, SONIOX_DEFAULTS, ctx(c.signal))`; `c.abort(new Error('cancelled'))` → rejects `/cancelled/` (or the stub's abort reason), the stub's signal aborted, and no timer is left (`clock.advance(20_000)` changes nothing).
    25. **"an already aborted signal throws before any request"** — `fetch` not called.
- [ ] **Step 2: Run** `npx vitest run src/providers/soniox/settings.test.ts src/providers/soniox/config.test.ts src/providers/soniox/check.test.ts` — FAIL: the modules do not exist.
- [ ] **Step 3: Implement.**
  - `settings.ts`:

    ```ts
    /**
     * Soniox's `S`, languages and credentials (survey §2.2–2.5). `S` is the old
     * slice (`SonioxProviderConfig.ts:13-71`) without what leaves it: the pair
     * (`providerStore` persists `sourceLanguage` / `targetLanguage` under the
     * same keys), the three region keys (credentials now, same keys), and
     * `model` (only ever `stt-rt-v5`: a constant in `config.ts`; its stored value
     * stays in storage, unread). Stored under `settings.soniox.*` as before.
     */
    import { AUTO } from '../../lib/provider/languages';
    import type { CredentialsMissing, LanguageOption, Provider } from '../../lib/provider/types';
    import { asSonioxRegion, DEFAULT_SONIOX_REGION, type SonioxRegion } from '../../lib/soniox/regions';
    import { SONIOX_DEFAULT_VOICE } from '../../lib/soniox/ttsCatalog';

    export interface SonioxSettings {
      /** Which deployment: each region is a separate Soniox project with its own key. */
      region: SonioxRegion;
      /** The TTS voice per region: a cloned voice is a UUID inside one project. */
      voice: string;
      voiceEu: string;
      voiceJp: string;
      /** Both mode on one shared two_way session (true) or two sessions (false). */
      bothModeSharedSession: boolean;
      /** Custom vocabulary, one term per line (→ context.terms). */
      vocabularyTerms: string;
      /** Preferred translations, one "source=target" per line (→ context.translation_terms). */
      vocabularyTranslations: string;
      /** Free-form session background (→ context.text). */
      contextText: string;
      /** endpoint_sensitivity, -1..1; 0 = the server default. */
      endpointSensitivity: number;
      /** endpoint_latency_adjustment_level, 0..3; 0 = the server default. */
      endpointLatencyAdjustmentLevel: number;
      /** max_endpoint_delay_ms, 500..3000; 2000 = the server default. */
      endpointMaxDelayMs: number;
      /** TTS speaking rate, 0.7..1.3. */
      ttsSpeed: number;
    }

    export const SONIOX_DEFAULTS: SonioxSettings = {
      region: DEFAULT_SONIOX_REGION,
      voice: SONIOX_DEFAULT_VOICE,
      voiceEu: SONIOX_DEFAULT_VOICE,
      voiceJp: SONIOX_DEFAULT_VOICE,
      bothModeSharedSession: true,
      vocabularyTerms: '',
      vocabularyTranslations: '',
      contextText: '',
      endpointSensitivity: 0,
      endpointLatencyAdjustmentLevel: 0,
      endpointMaxDelayMs: 2000,
      ttsSpeed: 1.0,
    };

    type StringField = 'voice' | 'voiceEu' | 'voiceJp' | 'vocabularyTerms' | 'vocabularyTranslations' | 'contextText';
    type NumberField = 'endpointSensitivity' | 'endpointLatencyAdjustmentLevel' | 'endpointMaxDelayMs' | 'ttsSpeed';

    /** What was stored, made valid field by field; clamping stays in `build`, as the old descriptor did. Nothing is written back. */
    export function migrateSonioxSettings(stored: Readonly<Record<string, unknown>>): SonioxSettings {
      const str = (k: StringField) => (typeof stored[k] === 'string' ? (stored[k] as string) : SONIOX_DEFAULTS[k]);
      const num = (k: NumberField) => {
        const v = stored[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : SONIOX_DEFAULTS[k];
      };
      return {
        region: asSonioxRegion(stored.region),
        voice: str('voice'),
        voiceEu: str('voiceEu'),
        voiceJp: str('voiceJp'),
        bothModeSharedSession: typeof stored.bothModeSharedSession === 'boolean' ? stored.bothModeSharedSession : SONIOX_DEFAULTS.bothModeSharedSession,
        vocabularyTerms: str('vocabularyTerms'),
        vocabularyTranslations: str('vocabularyTranslations'),
        contextText: str('contextText'),
        endpointSensitivity: num('endpointSensitivity'),
        endpointLatencyAdjustmentLevel: num('endpointLatencyAdjustmentLevel'),
        endpointMaxDelayMs: num('endpointMaxDelayMs'),
        ttsSpeed: num('ttsSpeed'),
      };
    }

    export type SonioxKeyField = 'apiKey' | 'apiKeyEu' | 'apiKeyJp';
    export const SONIOX_KEY_FIELDS: readonly SonioxKeyField[] = ['apiKey', 'apiKeyEu', 'apiKeyJp'];
    const REGION_OF_KEY: Readonly<Record<SonioxKeyField, SonioxRegion>> = { apiKey: 'us', apiKeyEu: 'eu', apiKeyJp: 'jp' };

    /** The field holding a region's key: the only mapping from region to storage (the old descriptor's rule). */
    export function sonioxKeyField(region: SonioxRegion): SonioxKeyField {
      return region === 'us' ? 'apiKey' : region === 'eu' ? 'apiKeyEu' : 'apiKeyJp';
    }

    /** The field holding a region's voice: a cloned voice is a UUID inside one region's project. */
    export function sonioxVoiceField(region: SonioxRegion): 'voice' | 'voiceEu' | 'voiceJp' {
      return region === 'us' ? 'voice' : region === 'eu' ? 'voiceEu' : 'voiceJp';
    }

    /** What Kizuna Soniox's lease will hand the adapter (Plan B's seam; survey §2.12). An own key has none. */
    export interface SonioxLeasePort {
      /** Soniox accepted the key: the first frame on each STT socket (the managed `session-started`). */
      streamAccepted(): void;
      /** Whether a 403 now is the granted duration ending rather than an error. */
      atGrantEnd(now: number): boolean;
      /** The granted duration ended: the lease ends the run with its own words (`segment_ended`). */
      cutoff(): void;
    }

    /** One leg's credentials. An own key serves both sockets and sends no client reference (ruling 7). */
    export interface SonioxCredentials {
      region: SonioxRegion;
      /** The STT socket's key. */
      stt: string;
      /** The TTS socket's key; absent, the leg runs text-only (a managed lease that issued none). */
      tts?: string;
      /** Managed only: inert on the wire — Soniox bills by the reference bound to the key (survey §3.7.1). */
      clientReferenceId?: string;
      /** Managed only: the lease the adapter reports to. Present, a 503 is not resumed. */
      lease?: SonioxLeasePort;
    }

    export const sonioxCredentials: Provider<SonioxSettings, SonioxCredentials, never>['credentials'] = {
      keys: SONIOX_KEY_FIELDS,
      fields: (s) => [{ key: sonioxKeyField(asSonioxRegion(s.region)), labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'providers.soniox.apiKeyPlaceholder' }],
      // `values` holds exactly the one field `fields(s)` shows, so its key names the region (spec: "read sees the values of exactly the fields").
      read: (values): SonioxCredentials | CredentialsMissing => {
        const field = SONIOX_KEY_FIELDS.find((k) => k in values) ?? 'apiKey';
        const region = REGION_OF_KEY[field];
        const key = values[field] ?? '';
        if (!key) return { missing: `Enter your Soniox API key for the ${region.toUpperCase()} region.` };
        return { region, stt: key, tts: key };
      },
    };

    /** The 60 languages of Soniox's own STS demo: translation is any-to-any across them. */
    export const SONIOX_LANGUAGES: readonly LanguageOption[] = [
      // The 60 entries of `SonioxProviderConfig.ts:329-388`, copied verbatim (Afrikaans … Welsh).
    ];

    export const sonioxLanguages: Provider<SonioxSettings, never, never>['languages'] = {
      sources: () => [{ value: AUTO, name: 'Auto', englishName: 'Auto' }, ...SONIOX_LANGUAGES],
      // Every language, the source's own included, as the old resolveTargetLanguages returned (survey §2.5).
      targets: () => SONIOX_LANGUAGES,
      initial: () => ({ source: AUTO, target: 'en' }),
    };
    ```

    `SONIOX_LANGUAGES`' 60 entries are copied, not summarized: the implementer pastes `SonioxProviderConfig.ts:329-388` (from `{ name: 'Afrikaans', value: 'af', englishName: 'Afrikaans' },` to `{ name: 'Cymraeg', value: 'cy', englishName: 'Welsh' },`) as the array's body, and case 7's count of 60 checks it.
  - `config.ts`:

    ```ts
    /**
     * Soniox's `C`, `build` and `describe` (survey §2.7). `build` never
     * refuses: an auto source with the participant leg is the gate's (D20).
     * The vocabulary helpers are copied from `SonioxProviderConfig.ts:73-165`
     * (ruling 1): the old descriptor keeps its own until Plan B deletes it.
     */
    import type { SessionContext } from '../../lib/contract/adapter';
    import { reportWarning } from '../../lib/diagnostics/report';
    import type { SharedSettings } from '../../lib/provider/types';
    import { asSonioxRegion } from '../../lib/soniox/regions';
    import { SONIOX_DEFAULT_VOICE, SONIOX_TTS_MODEL } from '../../lib/soniox/ttsCatalog';
    import { sonioxVoiceField, type SonioxSettings } from './settings';

    export const SONIOX_STT_MODEL = 'stt-rt-v5';

    /** The STT config frame's `context`, wire-shaped. */
    export interface SonioxWireContext {
      terms?: string[];
      translation_terms?: Array<{ source: string; target: string }>;
      text?: string;
    }

    export interface SonioxConfig {
      stt: {
        model: string;
        /** Present when there is vocabulary or background; budgeted under Soniox's context limit. */
        context?: SonioxWireContext;
        endpointSensitivity: number;
        endpointLatencyAdjustmentLevel: number;
        endpointMaxDelayMs: number;
      };
      /** Present when this leg speaks. */
      tts?: { voice: string; speed: number };
      /** Both mode on one mixed socket (D23); read by `startBoth`. */
      sharedBoth: boolean;
    }
    ```

    then `parseVocabularyTerms`, `parseVocabularyTranslations`, `clampNumber` (exported) and `SONIOX_CONTEXT_CHAR_BUDGET` / `fitContextToBudget` (module-private) copied from `SonioxProviderConfig.ts:73-165` verbatim but for one line: its `reportWarning('SonioxConfig', …)` gains `{ dedupeKey: 'soniox:context-budget' }` (a two-leg start builds twice); and

    ```ts
    export function buildSoniox(context: SessionContext, s: SonioxSettings, _shared: SharedSettings): SonioxConfig {
      const { terms, translationTerms, text } = fitContextToBudget(
        parseVocabularyTerms(s.vocabularyTerms ?? ''),
        parseVocabularyTranslations(s.vocabularyTranslations ?? ''),
        (s.contextText ?? '').trim(),
      );
      const wire: SonioxWireContext = {
        ...(terms.length ? { terms } : {}),
        ...(translationTerms.length ? { translation_terms: translationTerms } : {}),
        ...(text ? { text } : {}),
      };
      return {
        stt: {
          model: SONIOX_STT_MODEL,
          ...(Object.keys(wire).length > 0 ? { context: wire } : {}),
          endpointSensitivity: clampNumber(s.endpointSensitivity, -1, 1, 0),
          endpointLatencyAdjustmentLevel: Math.round(clampNumber(s.endpointLatencyAdjustmentLevel, 0, 3, 0)),
          endpointMaxDelayMs: Math.round(clampNumber(s.endpointMaxDelayMs, 500, 3000, 2000)),
        },
        ...(context.speech
          ? { tts: { voice: s[sonioxVoiceField(asSonioxRegion(s.region))] || SONIOX_DEFAULT_VOICE, speed: clampNumber(s.ttsSpeed, 0.7, 1.3, 1.0) } }
          : {}),
        sharedBoth: s.bothModeSharedSession,
      };
    }

    export function describeSoniox(c: SonioxConfig): { asrModel?: string; ttsModel?: string } {
      return { asrModel: c.stt.model, ...(c.tts ? { ttsModel: SONIOX_TTS_MODEL } : {}) };
    }
    ```

  - `check.ts`:

    ```ts
    /**
     * Soniox's readiness (spec: "Readiness is one check"): the old
     * temporary-key probe (`SonioxClient.ts:305-346`) against the key's own
     * region, bounded by its own timeout and the caller's signal (choice 10).
     * The settings side: not reached by the adapter, so it may use the real
     * clock by default.
     */
    import { realClock, type Clock } from '../../lib/contract/clock';
    import type { CheckContext, CheckResult } from '../../lib/provider/types';
    import { sonioxHosts } from '../../lib/soniox/regions';
    import type { SonioxCredentials, SonioxSettings } from './settings';

    /** As long as the sibling REST calls wait (`SonioxVoicesClient`'s 15 s). */
    export const CHECK_TIMEOUT_MS = 15_000;

    export interface SonioxCheckDeps {
      fetch?: typeof fetch;
      clock?: Pick<Clock, 'setTimeout'>;
    }

    export function createSonioxCheck(deps: SonioxCheckDeps = {}) {
      const clock = deps.clock ?? realClock;
      return async (k: SonioxCredentials, _s: SonioxSettings, ctx: CheckContext): Promise<CheckResult> => {
        if (ctx.signal?.aborted) throw ctx.signal.reason ?? new Error('aborted');
        // Read at call time, so a test's stubbed global is seen.
        const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
        const controller = new AbortController();
        let timedOut = false;
        const cancel = clock.setTimeout(() => { timedOut = true; controller.abort(); }, CHECK_TIMEOUT_MS);
        const onAbort = () => controller.abort(ctx.signal?.reason);
        ctx.signal?.addEventListener('abort', onAbort, { once: true });
        try {
          const response = await doFetch(`https://${sonioxHosts(k.region).api}/v1/auth/temporary-api-key`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${k.stt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 60 }),
            signal: controller.signal,
          });
          if (response.status === 200 || response.status === 201) return { ok: true };
          if (response.status === 401 || response.status === 403) {
            // A key probed on another region's host answers 401 too: the region is part of the words.
            return { ok: false, code: 'auth', reason: `HTTP ${response.status}: Soniox did not accept this key for the ${k.region.toUpperCase()} region` };
          }
          throw new Error(`Soniox answered the key check with HTTP ${response.status}.`);
        } catch (error) {
          if (timedOut) throw new Error(`Soniox did not answer the key check within ${CHECK_TIMEOUT_MS / 1000} s.`);
          throw error;
        } finally {
          cancel();
          ctx.signal?.removeEventListener('abort', onAbort);
        }
      };
    }

    export const checkSoniox = createSonioxCheck();
    ```

- [ ] **Step 4: Run** the Step 2 command — PASS; then the full suite and the gate (the new files are inside it).
- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/soniox/settings.ts src/providers/soniox/settings.test.ts src/providers/soniox/config.ts src/providers/soniox/config.test.ts src/providers/soniox/check.ts src/providers/soniox/check.test.ts
  ```

  ```bash
  git commit -q -F - -- src/providers/soniox/settings.ts src/providers/soniox/settings.test.ts src/providers/soniox/config.ts src/providers/soniox/config.test.ts src/providers/soniox/check.ts src/providers/soniox/check.test.ts <<'EOF'
  feat(soniox): settings, languages, credentials, config and a bounded key check

  S is the old slice without the pair, the region keys and the model;
  credentials read the region from the one key field shown; build shapes
  the STT context and knobs exactly as the old descriptor did, and a TTS
  voice only for a leg that speaks; check is the temporary-key probe,
  bounded at 15 s and by the caller's signal.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 6: Tokens → segments (`utterances.ts`)

**Files:**
- Create: `src/providers/soniox/utterances.ts`, `src/providers/soniox/utterances.test.ts`.

**Interfaces:**
- **Consumes:** `SonioxToken` (`sttStream.ts`); `Ref`, `TextRange`, `AdapterEvents`, `AdapterFrame` (contract types); `Clock`; `LegName`.
- **Produces:**
  - `FIN_TRANSLATION_GRACE_MS = 2_000`;
  - `type SegmentEvent = { kind: 'segmentOpened'; payload: … } | { kind: 'segmentText'; payload: … } | { kind: 'segmentClosed'; payload: … }` (the three `AdapterEvents` payloads);
  - `interface UtteranceSink { segment(leg: LegName, event: SegmentEvent): void; speak(leg: LegName, ref: Ref, text: string, span: TextRange, language: string): void; endSpeech(leg: LegName, ref: Ref): void }`;
  - `interface UtteranceOptions { sink: UtteranceSink; clock: Pick<Clock, 'setTimeout'>; legFor(token: SonioxToken): LegName; targetFor(leg: LegName): string }`;
  - `class Utterances { constructor(o: UtteranceOptions); message(tokens: readonly SonioxToken[]): void; abandon(): void; stop(): void }`;
  - `tokenFrames(tokens: readonly SonioxToken[]): AdapterFrame[]`.
- **Consumed by:** Task 8 (`SonioxCore` feeds it each STT message), Task 9 (`legFor` from the side tracker).

- [ ] **Step 1: Write the failing tests** — `utterances.test.ts`:

  ```ts
  const orig = (text: string, is_final = true, more: Partial<SonioxToken> = {}): SonioxToken => ({ text, is_final, translation_status: 'original', language: 'en', ...more });
  const none = (text: string): SonioxToken => ({ text, is_final: true, translation_status: 'none', language: 'en' });
  const tr = (text: string, is_final = true, language = 'ja'): SonioxToken => ({ text, is_final, translation_status: 'translation', language, source_language: 'en' });
  const END: SonioxToken = { text: '<end>', is_final: true };
  const FIN: SonioxToken = { text: '<fin>', is_final: true };

  type Call = { leg: LegName } & ({ segment: SegmentEvent } | { speak: [Ref, string, TextRange, string] } | { endSpeech: Ref });
  function setup(legFor: (t: SonioxToken) => LegName = () => 'speaker') {
    const clock = createVirtualClock(0);
    const calls: Call[] = [];
    const machine = new Utterances({
      clock, legFor, targetFor: (leg) => (leg === 'speaker' ? 'ja' : 'en'),
      sink: {
        segment: (leg, segment) => calls.push({ leg, segment }),
        speak: (leg, ...speak) => calls.push({ leg, speak }),
        endSpeech: (leg, endSpeech) => calls.push({ leg, endSpeech }),
      },
    });
    const segments = () => calls.flatMap((c) => ('segment' in c ? [c.segment] : []));
    const spoken = () => calls.flatMap((c) => ('speak' in c ? [c.speak] : []));
    return { clock, calls, machine, segments, spoken };
  }
  ```

  Cases (`kind`/`payload` read off `segments()`):
  1. **"opens the source at the first original token, and sends its whole text every message: finals kept, partials replaced"** — `message([orig('Hello'), orig(' wor', false)])` → `segmentOpened { ref: 1, side: 'source', origin: 'u1' }`, then `segmentText { ref: 1, text: 'Hello wor' }`; `message([orig(' world', false)])` → `segmentText` `'Hello world'`.
  2. **"routes a 'none' token to the source, like an original"** — `message([none('Ok')])` → a source segment with text `'Ok'`.
  3. **"opens the translation at its first token, in the translated-into language, with the utterance's origin"** — `message([orig('Hi.'), tr('やあ。')])` → `segmentOpened { ref: 2, side: 'translation', origin: 'u1' }` and `segmentText { ref: 2, text: 'やあ。', language: 'ja' }`.
  4. **"speaks each message's final translation as one chunk, with its span in the translation's text, before <end>"** — `message([orig('How are you'), tr('お元気'), tr('ですか')])` → `spoken()` is `[[2, 'お元気ですか', [0, 6], 'ja']]`; `message([tr('？'), END])` → the second speak `[2, '？', [6, 7], 'ja']` precedes the `segmentClosed` of ref 1 in `calls`.
  5. **"a partial translation is shown, never spoken"** — `message([orig('x'), tr('部分', false)])` → `segmentText { ref: 2, text: '部分' }` and `spoken()` is `[]`.
  6. **"<end> closes both sides with the origin; the source keeps its finals only"** — `message([orig('Done.'), orig(' and', false), tr('完了。'), END])` → the last source text is `'Done.'`, then `segmentClosed { ref: 1, origin: 'u1' }`, `segmentClosed { ref: 2, origin: 'u1' }`, and `{ endSpeech: 2 }`.
  7. **"times the source from its original tokens' start_ms and end_ms"** — `message([orig('a', true, { start_ms: 120, end_ms: 300 }), orig('b', false, { start_ms: 300, end_ms: 480 })])` → `segmentText` `timing: { startMs: 120, endMs: 480 }`.
  8. **"names each side's language: the spoken one on the source, the translated-into one on the translation"** — originals with `language: 'fr'` → source `language: 'fr'`; the translation `language: 'ja'`.
  9. **"<fin> closes the source at once and holds the translation for late tokens, until the next original token"** — `message([orig('Hi.'), FIN])` → source ref 1 closed, no translation yet; `message([tr('やあ。')])` → `segmentOpened` ref 2 (translation, origin `u1`) and its text; `message([orig('Next')])` → `segmentClosed { ref: 2, origin: 'u1' }` and `{ endSpeech: 2 }` come before `segmentOpened { ref: 3, side: 'source', origin: 'u2' }`.
  10. **"a translation held after <fin> closes after FIN_TRANSLATION_GRACE_MS"** — `message([orig('Hi.'), tr('や'), FIN])`; `clock.advance(1_999)` → ref 2 not closed; `clock.advance(1)` → `segmentClosed { ref: 2 }` and `{ endSpeech: 2 }`.
  11. **"a translation token after its translation closed revises it, and is spoken"** — `message([orig('Hi.'), tr('やあ'), END])`; `message([tr('。')])` → `segmentText { ref: 2, text: 'やあ。' }` after its `segmentClosed`, and `spoken()`'s last is `[2, '。', [2, 3], 'ja']` followed by `{ endSpeech: 2 }`.
  12. **"a translation that only arrives after <end> opens after it and is held for the grace"** — `message([orig('Hi.'), END])`; `message([tr('やあ。')])` → ref 2 opens (origin `u1`); `clock.advance(FIN_TRANSLATION_GRACE_MS)` → closed.
  13. **"never reuses a ref, and counts utterances in origins"** — two full exchanges → refs `1, 2, 3, 4`, origins `u1, u1, u2, u2`.
  14. **"abandon closes what is open as it stands, and refs go on"** — `message([orig('Half', false), tr('半')])`; `abandon()` → `segmentClosed` for refs 1 and 2 with no `segmentText` between the last message's and the closes; `message([orig('Again')])` → `segmentOpened { ref: 3 }`.
  15. **"picks an utterance's leg at its first token"** — `setup((t) => (t.speaker === '2' ? 'participant' : 'speaker'))`; `message([orig('Bonjour', true, { speaker: '2' }), orig(' encore', true, { speaker: '1' })])` → every call so far has `leg: 'participant'`; `targetFor` gives its speech the participant's language when no translation token names one (`tr` with `language: ''`).
  16. **"speaks in the first final translation token's language, else the leg's target"** — `message([orig('x'), tr('Hola', true, 'es')])` then `message([tr(' mundo', true, 'pt')])` → both chunks spoken with `'es'`; on a fresh machine, a final translation with `language: ''` on the speaker leg → `'ja'`.
  17. **"stop cancels the grace: nothing follows"** — `message([orig('Hi.'), tr('や'), FIN])`; `stop()`; `clock.advance(10_000)` → no new call; `message([orig('x')])` → no new call.
  18. **"summarizes a message for the Logs: a delta for partials, a transcript and a translation for finals, an endpoint, a finalize"** — `tokenFrames([orig('a', false), tr('b', false)])` → `[{ direction: 'in', type: 'stt.delta', payload: { transcript: 'a', translation: 'b' } }]`; `tokenFrames([orig('a'), tr('b'), END])` → `stt.transcript { text: 'a' }`, `stt.translation { text: 'b' }`, `stt.endpoint`; `tokenFrames([FIN])` → `[{ direction: 'in', type: 'stt.finalized' }]`; `tokenFrames([])` → `[]`.

  The next two pin the review's C1 — late translation tokens and the next utterance's first original **in one message**, the layout continuous speech produces. They are why `endPrevious()` flushes before it closes: against an `endPrevious()` that only closes (the draft's), case 19 sees ref 2 opened and closed with no text and nothing spoken, and case 20 never shows or speaks `'。'`. Write them with the others; with the module missing all fail at Step 2, and they must pass only with the flush in Step 3's code.
  19. **"a late translation in the same message as the next original is shown and spoken before it closes"** — `message([orig('Hi.'), END])`; `message([tr('やあ。'), orig('Next')])` → in `calls`, ref 2's `segmentText { ref: 2, text: 'やあ。', language: 'ja' }` and `speak: [2, 'やあ。', [0, 3], 'ja']` both come before `segmentClosed { ref: 2, origin: 'u1' }`, which comes before `segmentOpened { ref: 3, side: 'source', origin: 'u2' }`; `{ endSpeech: 2 }` follows the close.
  20. **"a revision in the same message as the next original, after the translation closed at <end>, is shown and spoken"** — `message([orig('Hi.'), tr('やあ'), END])`; `message([tr('。'), orig('Next')])` → before `segmentOpened { ref: 3 }`: `segmentText { ref: 2, text: 'やあ。' }`, `speak: [2, '。', [2, 3], 'ja']` and `{ endSpeech: 2 }`; no second `segmentClosed` for ref 2.
- [ ] **Step 2: Run** `npx vitest run src/providers/soniox/utterances.test.ts` — FAIL (the module does not exist yet).
- [ ] **Step 3: Implement** `utterances.ts`:

  ```ts
  /**
   * Soniox's tokens as segments (survey §1.5, §2.9): a pure state machine
   * over the STT socket's messages, one per session core. An utterance is
   * the tokens between two boundaries — `<end>` (the endpoint), or `<fin>`
   * (the answer to `finalize`, the boundary under manual turns: ruling 5).
   * Its originals are one source segment and its translation one translation
   * segment, both stating origin `u<n>`. Refs come from one counter and are
   * never reused, a resume included. Each message's final translation text
   * is handed to speech as one chunk with its span (ruling 2). A translation
   * token after a boundary and before the next original token belongs to the
   * utterance that just ended (choice 3). The one timer is the `<fin>`
   * grace, on the request's clock.
   */
  import type { AdapterEvents, AdapterFrame, Ref, TextRange } from '../../lib/contract/adapter';
  import type { Clock } from '../../lib/contract/clock';
  import type { LegName } from '../../lib/conversation/types';
  import type { SonioxToken } from './sttStream';

  /** How long a translation stays open after `<fin>` for the last words' tokens (ruling 5). A judgement: the owner checks it live. */
  export const FIN_TRANSLATION_GRACE_MS = 2_000;

  type PayloadOf<K extends keyof AdapterEvents> = Parameters<AdapterEvents[K]>[0];
  export type SegmentEvent =
    | { kind: 'segmentOpened'; payload: PayloadOf<'segmentOpened'> }
    | { kind: 'segmentText'; payload: PayloadOf<'segmentText'> }
    | { kind: 'segmentClosed'; payload: PayloadOf<'segmentClosed'> };

  export interface UtteranceSink {
    segment(leg: LegName, event: SegmentEvent): void;
    /** A final translation chunk for `ref`; `span` is where it sits in the translation's text. */
    speak(leg: LegName, ref: Ref, text: string, span: TextRange, language: string): void;
    /** The translation `ref` will say nothing more for now: its speech's utterance ends. */
    endSpeech(leg: LegName, ref: Ref): void;
  }

  export interface UtteranceOptions {
    sink: UtteranceSink;
    clock: Pick<Clock, 'setTimeout'>;
    /** The leg an utterance belongs to, decided at its first token. */
    legFor(token: SonioxToken): LegName;
    /** The speech language when no final translation token names one: the leg's target. */
    targetFor(leg: LegName): string;
  }

  interface Utterance {
    leg: LegName;
    origin: string;
    sourceRef?: Ref;
    sourceClosed: boolean;
    sourceFinal: string;
    sourceLanguage?: string;
    startMs?: number;
    endMs?: number;
    /** The last source snapshot emitted, as a key: nothing is sent twice. */
    sourceShown?: string;
    translationRef?: Ref;
    translation: 'none' | 'open' | 'closed';
    translationFinal: string;
    translationLanguage?: string;
    translationShown?: string;
    /** The first final translation token's language: what speech speaks this utterance in. */
    speechLanguage?: string;
    /** How much of `translationFinal` speech has been handed. */
    spokenUpTo: number;
    cancelGrace?: () => void;
  }

  export class Utterances {
    private nextRef = 1;
    private count = 0;
    private current: Utterance | null = null;
    /** The last utterance to end: its translation still takes late tokens, until the next original token (choice 3). */
    private previous: Utterance | null = null;
    private stopped = false;

    constructor(private readonly o: UtteranceOptions) {}

    message(tokens: readonly SonioxToken[]): void {
      if (this.stopped) return;
      let sourcePartial = '';
      let translationPartial = '';
      for (const token of tokens) {
        const text = token.text ?? '';
        if (text === '<end>' || text === '<fin>') {
          this.boundary(text === '<fin>' ? 'fin' : 'end');
          sourcePartial = '';
          translationPartial = '';
          continue;
        }
        if (token.translation_status === 'translation') {
          const u = this.current ?? this.previous ?? this.begin(token);
          if (token.language) u.translationLanguage = token.language;
          this.openTranslation(u);
          if (token.is_final) {
            u.translationFinal += text;
            if (token.language) u.speechLanguage ??= token.language;
          } else if (u === this.current) {
            translationPartial += text;
          }
        } else {
          // An original ('original' or 'none'): the next utterance has begun.
          this.endPrevious();
          const u = this.current ?? this.begin(token);
          if (token.language) u.sourceLanguage = token.language;
          if (token.start_ms !== undefined && u.startMs === undefined) u.startMs = token.start_ms;
          if (token.end_ms !== undefined) u.endMs = token.end_ms;
          this.openSource(u);
          if (token.is_final) u.sourceFinal += text;
          else sourcePartial += text;
        }
      }
      // The ended utterance's late translation first: it was said first.
      if (this.previous) {
        this.speakFinals(this.previous);
        this.showTranslation(this.previous, '');
      }
      if (this.current) {
        this.speakFinals(this.current);
        this.show(this.current, sourcePartial, translationPartial);
      }
    }

    /** A 503 swaps the socket (ruling 3): what is open closes as it stands — L1 keeps the last snapshot — and refs go on. */
    abandon(): void {
      const u = this.current;
      this.current = null;
      if (u) {
        if (u.sourceRef !== undefined && !u.sourceClosed) {
          u.sourceClosed = true;
          this.emit(u, { kind: 'segmentClosed', payload: { ref: u.sourceRef, origin: u.origin } });
        }
        this.closeTranslation(u);
      }
      this.endPrevious();
    }

    stop(): void {
      this.stopped = true;
      this.current?.cancelGrace?.();
      this.previous?.cancelGrace?.();
    }

    private begin(token: SonioxToken): Utterance {
      this.count += 1;
      const u: Utterance = {
        leg: this.o.legFor(token), origin: `u${this.count}`,
        sourceClosed: false, sourceFinal: '', translation: 'none', translationFinal: '', spokenUpTo: 0,
      };
      this.current = u;
      return u;
    }

    private openSource(u: Utterance): void {
      if (u.sourceRef !== undefined) return;
      u.sourceRef = this.nextRef++;
      this.emit(u, { kind: 'segmentOpened', payload: { ref: u.sourceRef, side: 'source', origin: u.origin } });
    }

    private openTranslation(u: Utterance): void {
      if (u.translation !== 'none') return;
      u.translationRef = this.nextRef++;
      u.translation = 'open';
      this.emit(u, { kind: 'segmentOpened', payload: { ref: u.translationRef, side: 'translation', origin: u.origin } });
      // Opened after its utterance ended: held for the grace, as after `<fin>`.
      if (u === this.previous) this.armGrace(u);
    }

    private boundary(kind: 'end' | 'fin'): void {
      const u = this.current;
      if (!u) return;
      this.speakFinals(u);
      this.show(u, '', '');
      if (u.sourceRef !== undefined && !u.sourceClosed) {
        u.sourceClosed = true;
        this.emit(u, { kind: 'segmentClosed', payload: { ref: u.sourceRef, origin: u.origin } });
      }
      this.current = null;
      this.endPrevious();
      this.previous = u;
      if (kind === 'end') this.closeTranslation(u);
      else if (u.translation === 'open') this.armGrace(u);
    }

    private armGrace(u: Utterance): void {
      u.cancelGrace?.();
      u.cancelGrace = this.o.clock.setTimeout(() => {
        u.cancelGrace = undefined;
        if (!this.stopped) this.closeTranslation(u);
      }, FIN_TRANSLATION_GRACE_MS);
    }

    private closeTranslation(u: Utterance): void {
      u.cancelGrace?.();
      u.cancelGrace = undefined;
      if (u.translation !== 'open' || u.translationRef === undefined) return;
      u.translation = 'closed';
      this.emit(u, { kind: 'segmentClosed', payload: { ref: u.translationRef, origin: u.origin } });
      this.o.sink.endSpeech(u.leg, u.translationRef);
    }

    /**
     * The next original token: the ended utterance takes no more late tokens.
     * What it took in this very message is shown and spoken first — the flush
     * at the end of `message()` can no longer reach it once `previous` is
     * cleared (the review's C1; cases 19–20). `speakFinals` ends the speech of
     * a translation already closed; `closeTranslation` that of an open one.
     */
    private endPrevious(): void {
      const p = this.previous;
      this.previous = null;
      if (!p) return;
      this.speakFinals(p);
      this.showTranslation(p, '');
      this.closeTranslation(p);
    }

    private speakFinals(u: Utterance): void {
      if (u.translationRef === undefined) return;
      const from = u.spokenUpTo;
      const to = u.translationFinal.length;
      if (to <= from) return;
      u.spokenUpTo = to;
      this.o.sink.speak(u.leg, u.translationRef, u.translationFinal.slice(from, to), [from, to], u.speechLanguage ?? this.o.targetFor(u.leg));
      // A late chunk on a closed translation: nothing more follows it.
      if (u.translation === 'closed') this.o.sink.endSpeech(u.leg, u.translationRef);
    }

    private show(u: Utterance, sourcePartial: string, translationPartial: string): void {
      if (u.sourceRef !== undefined && !u.sourceClosed) {
        const text = u.sourceFinal + sourcePartial;
        const timing = u.startMs !== undefined && u.endMs !== undefined ? { startMs: u.startMs, endMs: u.endMs } : undefined;
        const key = JSON.stringify([text, timing, u.sourceLanguage]);
        if (key !== u.sourceShown) {
          u.sourceShown = key;
          this.emit(u, { kind: 'segmentText', payload: { ref: u.sourceRef, text, ...(timing ? { timing } : {}), ...(u.sourceLanguage ? { language: u.sourceLanguage } : {}) } });
        }
      }
      this.showTranslation(u, translationPartial);
    }

    private showTranslation(u: Utterance, partial: string): void {
      if (u.translationRef === undefined) return;
      const text = u.translationFinal + partial;
      const key = JSON.stringify([text, u.translationLanguage]);
      if (key === u.translationShown) return;
      u.translationShown = key;
      this.emit(u, { kind: 'segmentText', payload: { ref: u.translationRef, text, ...(u.translationLanguage ? { language: u.translationLanguage } : {}) } });
    }

    private emit(u: Utterance, event: SegmentEvent): void {
      if (!this.stopped) this.o.sink.segment(u.leg, event);
    }
  }

  /** One message for the Logs, in the old timeline's words (survey §1.17): nothing for a keepalive's empty message. */
  export function tokenFrames(tokens: readonly SonioxToken[]): AdapterFrame[] {
    if (tokens.length === 0) return [];
    let transcript = '';
    let translation = '';
    let endpoint = false;
    let finalized = false;
    let allFinal = true;
    let content = false;
    for (const token of tokens) {
      const text = token.text ?? '';
      if (text === '<end>') { endpoint = true; continue; }
      if (text === '<fin>') { finalized = true; continue; }
      content = true;
      if (!token.is_final) allFinal = false;
      if (token.translation_status === 'translation') translation += text;
      else transcript += text;
    }
    const out: AdapterFrame[] = [];
    if (content && allFinal) {
      if (transcript) out.push({ direction: 'in', type: 'stt.transcript', payload: { text: transcript } });
      if (translation) out.push({ direction: 'in', type: 'stt.translation', payload: { text: translation } });
    } else if (content) {
      out.push({ direction: 'in', type: 'stt.delta', payload: { transcript, translation } });
    }
    if (endpoint) out.push({ direction: 'in', type: 'stt.endpoint' });
    if (finalized) out.push({ direction: 'in', type: 'stt.finalized' });
    return out;
  }
  ```

- [ ] **Step 4: Run** the Step 2 command — PASS. Then the full suite and the gate.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/soniox/utterances.ts src/providers/soniox/utterances.test.ts
  ```

  ```bash
  git commit -q -F - -- src/providers/soniox/utterances.ts src/providers/soniox/utterances.test.ts <<'EOF'
  feat(soniox): tokens become segments — one source and one translation per utterance

  A pure state machine over the STT messages: originals and untranslated
  tokens make the source, translation tokens the translation, both with
  origin u<n>; <end> closes both, <fin> closes the source and holds the
  translation for late tokens; a translation after its close revises it.
  Each message's final translation is spoken as one chunk with its span.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 7: One leg's speech (`speech.ts`): streamed chunks, ranges filled in, failures

**Files:**
- Create: `src/providers/soniox/speech.ts`, `src/providers/soniox/speech.test.ts`, `src/lib/contract/framePayload.ts`, `src/lib/contract/framePayload.test.ts`.
- Modify: `src/providers/localInference/adapter.ts` (the local `framePayload` and its `redact` import leave, `:13` and `:90-104`), `src/lib/diagnostics/clientDiagnostics.ts`, `src/lib/view/noticeText.ts`, `src/lib/view/noticeText.test.ts`.

**Interfaces:**
- **Consumes:** `SonioxTtsStream`, `TextTag`, `SonioxTtsSegmentEnd`, `SonioxTtsErrorScope` (Task 2); `AdapterEvents.speechRanges` (Task 3); `OpenSocket` (Task 1).
- **Produces:**
  - `framePayload(value: unknown): unknown` and `FRAME_STRING_MAX = 2000` in `src/lib/contract/framePayload.ts`;
  - `CLIENT_DIAGNOSTICS` rows `tts_segment_lost` and `tts_stopped` (both `warning`); `NOTICE_ALIASES` rows `tts_segment_lost: 'mainPanel.sonioxTtsSegmentLost'`, `tts_stopped: 'mainPanel.sonioxTtsFailed'`;
  - `tileSpan(span: TextRange, samples: readonly number[], text: string): TextRange[]`;
  - `interface LegSpeechOptions { region: SonioxRegion; key: string; clientReferenceId?: string; voice: string; speed: number; events: AdapterEvents; clock: Clock; openSocket: OpenSocket }`;
  - `class LegSpeech { constructor(o: LegSpeechOptions); open(): Promise<void>; speak(ref: Ref, text: string, span: TextRange, language: string): void; endUtterance(): void; close(): void }`.
- **Consumed by:** Task 8 (`SonioxCore` builds one per speaking leg).

- [ ] **Step 1: Write the failing tests.**
  - `framePayload.test.ts`:
    1. **"redacts every string and clips one past 2 000 characters with an ellipsis"** — `framePayload('x'.repeat(3000))` has length 2 001 and ends with `…`; a string holding `sk-proj-` followed by 40 letters comes back changed (`redact`'s own).
    2. **"walks arrays and objects, and leaves numbers, booleans and undefined alone"** — `framePayload({ a: [1, 'ok'], b: true, c: undefined })` equals `{ a: [1, 'ok'], b: true, c: undefined }`.
  - `noticeText.test.ts`:
    3. "has words for every code the runner, the capture and the adapters record" (`:56-60`) becomes `expect(NOTICE_WORDS[code] ?? NOTICE_ALIASES[code], code).toBeDefined()` — an adapter code may be worded by an alias (the file's own rule: never both).
    4. **"words speech's two failures with the sentences every locale already has"** — `noticeText(t, { code: 'tts_segment_lost', message: 'x' })` starts with `'mainPanel.sonioxTtsSegmentLost|'`; `tts_stopped` with `'mainPanel.sonioxTtsFailed|'`; `en`'s two sentences are, word for word, "Part of the spoken translation could not be played. Transcription and text translation are unaffected." and "Spoken translation has stopped. Transcription and text translation are still running." (The file's "every alias names a sentence in all 30 locales" then covers both keys.)
  - `speech.test.ts`. Setup:

    ```ts
    const b64 = (samples: number) => btoa(String.fromCharCode(...new Uint8Array(new Int16Array(samples).fill(9).buffer)));
    async function setup(options: Partial<LegSpeechOptions> = {}) {
      const clock = createVirtualClock(0);
      const sockets = fakeSockets();
      const { events, log } = recordEvents();
      const speech = new LegSpeech({ region: 'us', key: 'k', voice: 'Adrian', speed: 1, events, clock, openSocket: sockets.create, ...options });
      const opening = speech.open();
      sockets.last().open();
      await opening;
      const tts = () => sockets.last();
      const kinds = (k: AdapterEvent['kind']) => log.filter((e) => e.kind === k);
      return { clock, sockets, log, speech, tts, kinds };
    }
    ```

    5. **"tiles a span by sample count, the last range ending at the span's end"** — `tileSpan([0, 10], [100, 100], 'x'.repeat(10))` is `[[0, 5], [5, 10]]`; `tileSpan([3, 9], [1, 2, 3], 'x'.repeat(9))` is `[[3, 4], [4, 6], [6, 9]]`.
    6. **"never ends a range inside a surrogate pair"** — `tileSpan([0, 4], [1, 1], 'a😀b')` is `[[0, 3], [3, 4]]`.
    7. **"streams each chunk as audio on its ref as it arrives, with no range"** — `speech.speak(2, 'Hello. ', [0, 7], 'en')` → the TTS socket got the stream config for `utt-1-1` and the text; `tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }))` twice → two `audio` events, each `{ ref: 2, pcm: <2400 samples> }` with no `range`, and a `tts.audio` frame each.
    8. **"fills in the chunks' ranges when the segment ends cleanly, tiling its span by sample count"** — `speak(2, 'Hello, world.', [0, 13], 'en')`; audio `b64(2400)`, `b64(7200)`, then `{ stream_id: 'utt-1-1', terminated: true }` → one `speechRanges` `{ ref: 2, ranges: [{ index: 0, range: [0, 3] }, { index: 1, range: [3, 13] }] }`.
    9. **"counts a ref's entries across its segments"** — `speak(2, 'One. ', [0, 5], 'en')` (a sentence: its own segment), `speak(2, 'Two.', [5, 9], 'en')` (queued behind it); one chunk and terminated for `utt-1-1`, then one chunk and terminated for `utt-1-2` → the second `speechRanges` names `index: 1` with `range: [5, 9]`.
    10. **"a 408-killed segment gets no ranges and says tts_segment_lost, once per episode"** — `speak(2, 'Hi.', [0, 3], 'en')`; `{ stream_id: 'utt-1-1', error_code: 408, error_message: 'Request timeout' }` → one `degraded` `{ code: 'tts_segment_lost' }`, no `speechRanges` even after a `terminated` for it; a second 408 on the next segment before any audio → still one; audio on a later segment, then a 408 → a second `tts_segment_lost`.
    11. **"a failure of all speech says tts_stopped, even after a lost segment"** — after case 10's first 408, a new `speak(4, 'Yo', [0, 2], 'en')` (a live stream), then `{ error_code: 400, error_message: 'Invalid voice' }` with no stream id → a `degraded` `{ code: 'tts_stopped' }`; another such frame → no third notice.
    12. **"an idle drop is silent, and the next text reconnects and flushes what waited, in order"** — no stream live: `tts().drop(); await flush()` → no `degraded`; `speak(4, 'Again.', [0, 6], 'en')` → a second socket exists; before it opens `speech.endUtterance()`; `sockets.last().open(); await flush()` → the new socket's JSON is the stream config, `{ stream_id: 'utt-1-1', text: 'Again.', text_end: false }`, then `text_end` — in that order.
    13. **"a reconnect that fails says tts_stopped"** — drop the idle socket; `speak(…)`; `sockets.last().drop(); await flush()` → one `degraded` `{ code: 'tts_stopped' }` (ruling 3: a failed reconnect is speech stopped).
    14. **"a TTS connect that fails at start is silent until the first translation, which retries it; a failed retry says tts_stopped once (choice 6)"** — a setup variant whose first socket drops before `open` (skip `sockets.last().open()`: `sockets.last().drop(); await opening`) → `open()` resolved; the log has only a `frame` `tts.connect_failed`; `speak(2, 'Hi.', [0, 3], 'en')` → a second socket is created (the retry); `sockets.last().drop(); await flush()` → one `degraded` `{ code: 'tts_stopped' }`; `speak(4, 'Yo.', [0, 3], 'en')` → a third socket; it drops too → still one `tts_stopped` (the same episode); `speak(6, 'Ok.', [0, 3], 'en')` → a fourth socket, `sockets.last().open(); await flush()` → its stream config and text are sent (the retry succeeded, the episode is over), and a later failed reconnect would say `tts_stopped` again.
    15. **"an unreadable TTS frame goes to the Logs only, once per episode (choice 7)"** — `tts().receive('{bad')` twice → one `frame` `{ direction: 'in', type: 'tts.unreadable' }` whose `payload.message` is a string, and no `degraded` at all; after an audio chunk, another bad frame → a second `tts.unreadable` frame, still no `degraded`.
    16. **"logs the utterance's text at its end, never the audio"** — `speak(2, 'Hi', [0, 2], 'en')`, `speak(2, ' there.', [2, 9], 'en')`, `endUtterance()` → a `frame` `{ direction: 'out', type: 'tts.speak', payload: { text: 'Hi there.' } }`; every `tts.audio` frame's payload is `{ bytes: <number> }`.
    17. **"close stops everything: nothing after it"** — `speak(2, 'and so', [0, 6], 'en')` (a segment waiting on its idle cut), `const n = log.length; speech.close()` → `log.length` is still `n`, and the socket was closed by the client; `clock.advance(60_000)` → still `n` (the segment timers and the keepalive went with it); `speech.speak(…)` and `speech.endUtterance()` → still `n`, and no new socket.
    18. **"sends the leg's voice, speed and key, and a client reference only when there is one"** — `setup({ voice: 'Maya', speed: 1.2, clientReferenceId: 'ref-1' })`; `speak(…)` → the stream config matches `{ api_key: 'k', voice: 'Maya', speed: 1.2, model: 'tts-rt-v2', client_reference_id: 'ref-1' }`; the default setup's config has no `client_reference_id`.
    19. **"close while a reconnect is opening closes the new socket, and nothing follows"** (the review's M8; the `stop()` rule, `adapter.ts:56-61`) — no stream live: `tts().drop(); await flush()`; `speak(4, 'Again.', [0, 6], 'en')` → `const reconnecting = sockets.last()` is CONNECTING; `const n = log.length; speech.close()` → synchronously `reconnecting.closedByClient` is set; `await flush(); clock.advance(60_000); await flush()` → `log.length` is still `n` and `sockets.last()` is still `reconnecting`. (Against the draft's `close()`, which could not reach a socket `ensure()` was still opening, `closedByClient` stays null.)
- [ ] **Step 2: Run** `npx vitest run src/providers/soniox/speech.test.ts src/lib/contract/framePayload.test.ts src/lib/view/noticeText.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
  - `framePayload.ts`: LocalInference's function and constant (`localInference/adapter.ts:90-104`), exported, under this header: `/** A frame payload fit for the Logs panel (spec D8, "What every adapter must honour"): every string redacted and cut below the contract's 2 048-character bound. Shared by every adapter (Stage 2 Soniox, choice 15). */`, importing `redact` from `../diagnostics/redact`.
  - `localInference/adapter.ts`: delete its `FRAME_STRING_MAX` and `framePayload` (`:90-104`) and the now-unused `import { redact } …` (`:13`); add `import { framePayload } from '../../lib/contract/framePayload';`. Its one call (`:703`) is unchanged.
  - `clientDiagnostics.ts`, after `translation_unavailable`:

    ```ts
      /** One segment of spoken translation was lost (the provider killed it); the next one speaks. */
      tts_segment_lost: { severity: 'warning' },
      /** Spoken translation has stopped; transcription and text translation go on. */
      tts_stopped: { severity: 'warning' },
    ```

  - `noticeText.ts`, `NOTICE_ALIASES`, after `connection_lost`:

    ```ts
      // A leg's speech failed (Stage 2 Soniox, choice 9): the sentences name no vendor.
      tts_segment_lost: 'mainPanel.sonioxTtsSegmentLost',
      tts_stopped: 'mainPanel.sonioxTtsFailed',
    ```

  - `speech.ts`:

    ```ts
    /**
     * One leg's spoken translation over Soniox's TTS socket (survey §1.7–1.8,
     * §2.9; rulings 2 and 3). Final translation chunks arrive tagged with
     * their ref and span; audio streams back as it arrives, one rangeless
     * `audio` per chunk, so the first audio comes as early as the old
     * client's. When a TTS segment ends cleanly the chunks' ranges are filled
     * in (`speechRanges`): the segment's span divided by their sample counts.
     * A killed segment gets none: replay only. Failures are the old client's
     * episodes (`SonioxClient.ts:1436-1492`): a lost segment once per episode,
     * "speech stopped" even after one; an idle drop is silent, and the next
     * text reconnects, flushing what waited in order (`ensureTts`, `:1059-1094`).
     */
    import { SAMPLE_RATE, type AdapterEvents, type Ref, type TextRange } from '../../lib/contract/adapter';
    import type { Clock } from '../../lib/contract/clock';
    import { framePayload } from '../../lib/contract/framePayload';
    import { describeCause } from '../../lib/diagnostics/describeCause';
    import type { SonioxRegion } from '../../lib/soniox/regions';
    import { SONIOX_TTS_MODEL } from '../../lib/soniox/ttsCatalog';
    import type { OpenSocket } from './socket';
    import { SonioxTtsStream, type SonioxTtsErrorScope, type SonioxTtsSegmentEnd, type TextTag } from './ttsStream';

    export interface LegSpeechOptions {
      region: SonioxRegion;
      /** The TTS socket's key (an own key: the STT key). */
      key: string;
      clientReferenceId?: string;
      voice: string;
      speed: number;
      events: AdapterEvents;
      clock: Clock;
      openSocket: OpenSocket;
    }

    type Pending = { kind: 'text'; text: string; language: string; tag: TextTag } | { kind: 'end' };

    const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
    const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

    /**
     * A segment's span divided among its chunks in proportion to their sample
     * counts (every count positive), so consecutive ranges tile the span; the
     * last ends at the span's end. A boundary inside a surrogate pair moves
     * past it (choice 4). `text` is the ref's text the span indexes.
     */
    export function tileSpan(span: TextRange, samples: readonly number[], text: string): TextRange[] {
      const [a, b] = span;
      const total = samples.reduce((sum, n) => sum + n, 0);
      const out: TextRange[] = [];
      let start = a;
      let cum = 0;
      samples.forEach((n, k) => {
        cum += n;
        let end = k === samples.length - 1 ? b : Math.max(start, a + Math.round(((b - a) * cum) / total));
        if (end > start && end < b && isHigh(text.charCodeAt(end - 1)) && isLow(text.charCodeAt(end))) end += 1;
        out.push([start, end]);
        start = end;
      });
      return out;
    }

    export class LegSpeech {
      private stream: SonioxTtsStream | null = null;
      private connecting = false;
      /** The socket `ensure()` is opening, so `close()` reaches it before it opens (the `stop()` rule; the review's M8). */
      private opening: SonioxTtsStream | null = null;
      private closed = false;
      private pending: Pending[] = [];
      /** Per ref, the speech entries so far: the next audio's index (L1 appends one per `audio`). */
      private readonly counts = new Map<Ref, number>();
      /** Per live stream of the current socket: its chunks' entry indices and sample counts. A new socket restarts the ids. */
      private segments = new Map<string, Array<{ index: number; samples: number }>>();
      /** Each ref's translation as fed: what a span indexes. */
      private readonly texts = new Map<Ref, string>();
      /** What this utterance handed to speech, for the Logs' `tts.speak`. */
      private spoken = '';
      /** The failure episode already reported: cleared when audio flows again or a reconnect succeeds. */
      private reported: SonioxTtsErrorScope | null = null;
      private readable = true;

      constructor(private readonly o: LegSpeechOptions) {}

      /** Opens the socket at start; never rejects: a failure is said only in the Logs, and the first text reconnects (ruling 3). */
      async open(): Promise<void> {
        const stream = this.newStream();
        this.stream = stream;
        try {
          await stream.connect();
          if (this.closed) stream.close();
        } catch (error) {
          if (this.stream === stream) this.stream = null;
          if (!this.closed) this.frame('in', 'tts.connect_failed', { message: describeCause(error) });
        }
      }

      speak(ref: Ref, text: string, span: TextRange, language: string): void {
        if (this.closed) return;
        this.texts.set(ref, (this.texts.get(ref) ?? '').slice(0, span[0]) + text);
        this.spoken += text;
        const tag: TextTag = { ref, span };
        if (this.stream?.isOpen()) {
          this.stream.sendText(text, language, tag);
        } else {
          this.pending.push({ kind: 'text', text, language, tag });
          void this.ensure();
        }
      }

      endUtterance(): void {
        if (this.closed) return;
        if (this.spoken) {
          this.frame('out', 'tts.speak', { text: this.spoken });
          this.spoken = '';
        }
        if (this.connecting) this.pending.push({ kind: 'end' });
        else this.stream?.endUtterance();
      }

      /** Before the caller's first await (the `stop()` rule): every socket it holds or is opening is closed, and nothing is emitted after it. */
      close(): void {
        this.closed = true;
        this.pending = [];
        this.segments.clear();
        this.stream?.close();
        this.stream = null;
        // A close while CONNECTING rejects its connect(); ensure()'s catch sees `closed` and says nothing.
        this.opening?.close();
        this.opening = null;
      }

      private newStream(): SonioxTtsStream {
        const stream = new SonioxTtsStream(
          { apiKey: this.o.key, region: this.o.region, voice: this.o.voice, model: SONIOX_TTS_MODEL, sampleRate: SAMPLE_RATE, speed: this.o.speed, clientReferenceId: this.o.clientReferenceId },
          { clock: this.o.clock, openSocket: this.o.openSocket },
        );
        stream.setHandlers({
          onAudio: (pcm, info) => { if (stream === this.stream) this.onAudio(pcm, info.streamId, info.ref); },
          onSegmentEnd: (end) => { if (stream === this.stream) this.onSegmentEnd(end); },
          onError: (code, message, hadActiveStream, scope) => { if (stream === this.stream) this.failure(code, message, hadActiveStream, scope); },
          onUnreadable: (error) => { if (stream === this.stream) this.unreadable(error); },
        });
        return stream;
      }

      /** The socket is down: open a new one, then send what waited, in order. */
      private async ensure(): Promise<void> {
        if (this.connecting || this.closed) return;
        this.connecting = true;
        this.stream?.close();
        this.stream = null;
        this.segments = new Map();
        const stream = this.newStream();
        this.opening = stream;
        try {
          await stream.connect();
          if (this.closed) {
            stream.close();
            return;
          }
          this.opening = null;
          this.stream = stream;
          this.reported = null;
          const pending = this.pending;
          this.pending = [];
          for (const op of pending) {
            if (op.kind === 'end') stream.endUtterance();
            else stream.sendText(op.text, op.language, op.tag);
          }
        } catch (error) {
          this.pending = [];
          // Trying to resume speech and failing is speech lost, whatever was active (the old client passed true).
          if (!this.closed) this.failure('connect_failed', describeCause(error), true, 'all');
        } finally {
          this.connecting = false;
          if (this.opening === stream) this.opening = null;
        }
      }

      private onAudio(pcm: Int16Array, streamId: string, ref: Ref | undefined): void {
        if (this.closed || ref === undefined || pcm.length === 0) return;
        const index = this.counts.get(ref) ?? 0;
        this.counts.set(ref, index + 1);
        const entries = this.segments.get(streamId) ?? [];
        entries.push({ index, samples: pcm.length });
        this.segments.set(streamId, entries);
        // Speech flows again: a later failure is a new episode.
        this.reported = null;
        this.readable = true;
        this.frame('in', 'tts.audio', { bytes: pcm.byteLength });
        this.o.events.audio({ ref, pcm });
      }

      private onSegmentEnd(end: SonioxTtsSegmentEnd): void {
        const entries = this.segments.get(end.streamId);
        this.segments.delete(end.streamId);
        if (this.closed || !end.clean || !end.span || end.ref === undefined || !entries || entries.length === 0) return;
        const ranges = tileSpan(end.span, entries.map((e) => e.samples), this.texts.get(end.ref) ?? '');
        this.o.events.speechRanges({ ref: end.ref, ranges: entries.map((e, k) => ({ index: e.index, range: ranges[k] })) });
      }

      private failure(code: string, message: string, hadActiveStream: boolean, scope: SonioxTtsErrorScope): void {
        // A drop that cost no speech is recovered silently the next time text needs the socket.
        if (this.closed || !hadActiveStream) return;
        const reported = this.reported;
        if (reported === 'all' || (reported === 'segment' && scope === 'segment')) return;
        this.reported = scope;
        this.frame('in', 'tts.degraded', { code, message, scope });
        this.o.events.degraded({ code: scope === 'segment' ? 'tts_segment_lost' : 'tts_stopped', message: `Soniox TTS ${code}: ${message}` });
      }

      /** The Logs only, on the ok → failing transition (choice 7): the old client dropped such a frame silently, and it costs the user nothing to act on. */
      private unreadable(error: unknown): void {
        if (this.closed || !this.readable) return;
        this.readable = false;
        this.frame('in', 'tts.unreadable', { message: describeCause(error) });
      }

      private frame(direction: 'in' | 'out', type: string, payload?: unknown): void {
        if (!this.closed) this.o.events.frame({ direction, type, ...(payload === undefined ? {} : { payload: framePayload(payload) }) });
      }
    }
    ```

- [ ] **Step 4: Run** the Step 2 command, then `npx vitest run src/providers/localInference src/lib`, the full suite and the gate. LocalInference's suite stays green: the function moved, its behaviour did not.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/soniox/speech.ts src/providers/soniox/speech.test.ts src/lib/contract/framePayload.ts src/lib/contract/framePayload.test.ts src/providers/localInference/adapter.ts src/lib/diagnostics/clientDiagnostics.ts src/lib/view/noticeText.ts src/lib/view/noticeText.test.ts
  ```

  ```bash
  git commit -q -F - -- src/providers/soniox/speech.ts src/providers/soniox/speech.test.ts src/lib/contract/framePayload.ts src/lib/contract/framePayload.test.ts src/providers/localInference/adapter.ts src/lib/diagnostics/clientDiagnostics.ts src/lib/view/noticeText.ts src/lib/view/noticeText.test.ts <<'EOF'
  feat(soniox): a leg's speech streams as it arrives, and fills in its ranges when a segment ends

  One TTS socket per speaking leg: each chunk plays at once with no range;
  at a segment's clean end its span is divided among the chunks by sample
  count and sent as speechRanges. A killed segment keeps none and says
  tts_segment_lost once per episode; lost speech says tts_stopped; an idle
  drop is silent and the next text reconnects in order. Both codes reuse
  the sentences every locale has. framePayload moves to the contract.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 8: The adapter — one leg (`SonioxCore`, `start`)

**Files:**
- Modify (replacing Task 1's seed): `src/providers/soniox/adapter.ts`.
- Create: `src/providers/soniox/adapter.test.ts`.
- Modify: `src/providers/sessionSide.consistency.test.ts`.

**Interfaces:**
- **Consumes:** `SonioxSttStream`, `SonioxSttConfig`, `SonioxSttMessage` (Task 1); `Utterances`, `tokenFrames` (Task 6); `LegSpeech` (Task 7); `framePayload` (Task 7); `SonioxConfig` (Task 5, type); `SonioxCredentials`, `SonioxLeasePort` (Task 5, types); `AdapterStartError`; `AUTO`.
- **Produces:**
  - `createSonioxAdapter(deps?: Partial<SonioxAdapterDeps>): Adapter<SonioxConfig, SonioxCredentials>` with `interface SonioxAdapterDeps { openSocket: OpenSocket }` (Task 9 adds `startBoth` to what it returns);
  - `RESUME_DELAYS_MS = [0, 1_000, 3_000]`, `MAX_RESUME_CYCLES = 5`, `sttFailureCode(code: string): 'auth' | 'rate_limit' | 'client' | 'server'`;
  - inside the module: `class SonioxCore`, `interface CoreLeg`, `coreLeg(…)` — Task 9 extends them.
- **Consumed by:** Task 9, Task 11 (`provider.ts`: `start`).

- [ ] **Step 1: Write the failing tests** — `adapter.test.ts`. Setup:

  ```ts
  const SHARED: SharedSettings = { instructions: () => '', pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 }, models: [] };
  const KEY: SonioxCredentials = { region: 'us', stt: 'test-key', tts: 'test-key' };
  const AUTO_CTX: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
  const isStt = (s: FakeSocket) => s.url.endsWith('/transcribe-websocket');
  const b64 = (samples: number) => btoa(String.fromCharCode(...new Uint8Array(new Int16Array(samples).fill(9).buffer)));
  const msg = (...tokens: SonioxToken[]) => JSON.stringify({ tokens });
  const orig = (text: string, is_final = true): SonioxToken => ({ text, is_final, translation_status: 'original', language: 'en', start_ms: 0, end_ms: 500 });
  const tr = (text: string): SonioxToken => ({ text, is_final: true, translation_status: 'translation', language: 'ja', source_language: 'en' });
  const END: SonioxToken = { text: '<end>', is_final: true };
  const FIN: SonioxToken = { text: '<fin>', is_final: true };

  function started(o: { context?: SessionContext; settings?: Partial<SonioxSettings>; credentials?: SonioxCredentials } = {}) {
    const sockets = fakeSockets();
    const clock = createVirtualClock(0);
    const { events, log } = recordEvents();
    const controller = new AbortController();
    const context = o.context ?? AUTO_CTX;
    const starting = createSonioxAdapter({ openSocket: sockets.create }).start(
      { context, config: buildSoniox(context, { ...SONIOX_DEFAULTS, ...o.settings }, SHARED), credentials: o.credentials ?? KEY, clock, signal: controller.signal },
      events,
    );
    const stt = () => sockets.all.filter(isStt).slice(-1)[0];
    const tts = () => sockets.all.filter((s) => !isStt(s)).slice(-1)[0];
    const openAll = () => { for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open(); };
    const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
    return { sockets, clock, log, controller, starting, stt, tts, openAll, of };
  }
  async function live(o?: Parameters<typeof started>[0]) {
    const h = started(o);
    h.openAll();
    const session = await h.starting;
    return { ...h, session };
  }
  ```

  **The conformance suite** (`runScenario` over the harness; `text` is not run: `textInput: false`):

  ```ts
  let sockets = fakeSockets();
  const stt = () => sockets.all.filter(isStt).slice(-1)[0];
  const tts = () => sockets.all.filter((s) => !isStt(s)).slice(-1)[0] as FakeSocket | undefined;
  const openAll = () => { for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open(); };
  /** The last TTS stream the adapter opened on this socket. */
  const lastStream = (s: FakeSocket) => s.sentJson<{ stream_id?: string; model?: string }>().filter((m) => m.model !== undefined).map((m) => m.stream_id!).pop();
  const harness: AdapterHarness<SonioxConfig, SonioxCredentials> = {
    adapter: createSonioxAdapter({ openSocket: (url) => sockets.create(url) }),
    config: (context) => { sockets = fakeSockets(); return buildSoniox(context, SONIOX_DEFAULTS, SHARED); },
    credentials: KEY,
    opening: () => [{ run: openAll }, { flush: true }],
    exchange: [
      { run: () => stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END)) },
      // Its speech, when the leg speaks: two chunks, then the segment's clean end.
      { run: () => {
        const t = tts();
        const id = t && lastStream(t);
        if (!t || !id) return;
        t.receive(JSON.stringify({ stream_id: id, audio: b64(2400) }));
        t.receive(JSON.stringify({ stream_id: id, audio: b64(1200) }));
        t.receive(JSON.stringify({ stream_id: id, terminated: true }));
      } },
    ],
    serverClose: [{ run: () => stt().serverClose(1011, 'server error') }, { flush: true }],
    refuse: [{ run: () => stt().drop() }],
    reconnect: [
      { run: () => stt().receive(JSON.stringify({ error_code: 503, error_message: 'Service unavailable' })) },
      { run: () => stt().serverClose(1011) },
      { flush: true },
      { run: openAll },
      { flush: true },
    ],
  };
  ```

  1. **"passes every conformance scenario but typed text"** — `expect(scenarioNames(harness)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'server-close', 'reconnect'])`; for each, `runScenario(harness, name)` has `violations` `[]` and `problems` `[]` (one `it.each`). The exchange carries a `speechRanges`, so the kit checks Task 3's rules on a real adapter.

  **The session** (each over `live()` unless said):
  2. **"sends the leg's direction: one_way to the target, the source as the only hint, the context and the knobs; no diarization, no client reference"** — `live({ settings: { vocabularyTerms: 'Sokuji', endpointMaxDelayMs: 3000 } })` → `stt().sentJson()[0]` matches `{ api_key: 'test-key', model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 24000, translation: { type: 'one_way', target_language: 'ja' }, language_hints: ['en'], context: { terms: ['Sokuji'] }, max_endpoint_delay_ms: 3000 }`, and has neither `enable_speaker_diarization` nor `client_reference_id`.
  3. **"sends no hint for an auto source"** — `direction: { source: 'auto', target: 'ja' }` → no `language_hints`.
  4. **"opens both sockets at the key's region"** — `credentials: { region: 'jp', stt: 'k', tts: 'k' }` → `stt().url` `'wss://stt-rt.jp.soniox.com/transcribe-websocket'`, `tts().url` `'wss://tts-rt.jp.soniox.com/tts-websocket'`.
  5. **"opens no TTS socket for a leg that does not speak"** — `speech: false` → `sockets.all` has one socket.
  6. **"a bad key: the start resolves, then its error frame fails the leg with auth, in the server's words, once"** — `stt().receive(JSON.stringify({ error_code: 401, error_message: 'Invalid API key' }))` → `of('failed')` is `[{ kind: 'failed', payload: { code: 'auth', message: '[Soniox 401] Invalid API key' } }]`; `stt().serverClose(1000); await flush()` → still one `failed`, and nothing after it.
  7. **"words every other STT error by its type, keeping the server's words"** — `429` → `rate_limit`, `400` → `client`, `500` → `server`, `'boom'` → `server`; each message `[Soniox <code>] <message>` (one fresh `live()` each).
  8. **"a 408, a socket error and a bare close each fail with connection_lost, once"** — three fresh sessions: an error frame `408`; `stt().drop()`; `stt().serverClose(1006)` — each → exactly one `failed` with `code: 'connection_lost'`, and a `session.connection_lost` frame before it.
  9. **"a 503 resumes silently on the clock — at once, after 1 s, after 3 s — reconnecting, then reconnected"** — `stt().receive(msg(orig('Half', false), tr('半')))`; the 503 error frame, `stt().serverClose(1011)`, `await flush()` → `reconnecting` logged, then `segmentClosed` for refs 1 and 2 (the utterance closed as it stands), and a second STT socket exists (the first attempt, at once); `stt().drop(); await flush()` → `clock.advance(999); await flush()` makes no third STT socket, `clock.advance(1); await flush()` does (the attempt runs on the microtask after its timer); drop it → `clock.advance(2_999); await flush()` none, `clock.advance(1); await flush()` the fourth; `openAll(); await flush()` → `reconnected`, and the fourth STT socket's config frame equals the first's. The log holds no `failed` and no `degraded`; its frames include `session.stt_503`, `session.stt_resuming`, two `session.stt_resume_attempt_failed`, `session.stt_resumed`.
  10. **"a resume whose three attempts fail ends with connection_lost and the 503's own words"** — as case 9 with every attempt dropped → after the third, one `failed` `{ code: 'connection_lost', message: 'Soniox 503: Service unavailable' }`.
  11. **"past five resume cycles a 503 is an outage"** — five 503 + close + `openAll` + flush cycles, each ending `reconnected`; a sixth 503 → `failed` `connection_lost` at once, and no new socket after its close.
  12. **"never reuses a ref across a resume"** — an exchange (refs 1–2), a resume, an exchange → refs 3–4 opened.
  13. **"endTurn sends finalize; <fin> closes the source at once and holds the translation for its late words (ruling 5)"** — `live({ context: { ...AUTO_CTX, turns: 'manual' } })`; `session.endTurn()` → the last JSON on the STT socket is `{ type: 'finalize' }`, and a frame `stt.finalize` is logged; `stt().receive(msg(orig('Hi.'), FIN))` → ref 1 closed, ref 2 not opened; `stt().receive(msg(tr('やあ。')))` → ref 2 opened with that text; `clock.advance(1_999)` → open; `clock.advance(1)` → `segmentClosed { ref: 2 }`.
  14. **"the keepalive covers the silence between presses"** — manual turns, no audio: `clock.advance(15_000)` → `{ type: 'keepalive' }` among the STT socket's JSON.
  15. **"an unreadable STT frame goes to the Logs only, once per episode (choice 7)"** — `stt().receive('{bad')` twice → one `frame` `{ direction: 'in', type: 'stt.unreadable' }` with a string `payload.message`, and no `degraded` and no `failed`; a valid message; `'{bad'` → a second `stt.unreadable` frame, still no `degraded`.
  16. **"speaks each final translation, streams its audio, and fills in its ranges"** — `stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END))` → the TTS socket got a stream config (`voice: 'Adrian'`, `language: 'ja'`) and `{ text: 'こんにちは。', text_end: false }`; two audio chunks and a `terminated` → two `audio` on ref 2 with no `range`, then `speechRanges { ref: 2, ranges: [{ index: 0, range: [0, 4] }, { index: 1, range: [4, 6] }] }` (2 400 and 1 200 samples over six units).
  17. **"stop closes both sockets before its first await, and nothing follows"** — `const n = log.length; const stopping = session.stop();` → synchronously, `stt().closedByClient` and `tts().closedByClient` are set and the STT socket's last frame sent was `''` (the end of stream); `await stopping; clock.advance(60_000); await flush()` → `log.length` is still `n` (the sockets' own close events are the stale closes: silent).
  18. **"a start its signal aborts opens nothing and closes both sockets"** — `started()`; `controller.abort(new Error('cancelled'))` → `starting` rejects `/cancelled/`; both sockets `closedByClient`; the log is empty.
  19. **"a refused STT socket fails the start with network, and closes the TTS socket"** — `started(); stt().drop()` → `starting` rejects with an `AdapterStartError` whose `code` is `'network'`; `tts().closedByClient` is set; the log is empty.
  20. **"opens with session.opened, and no frame carries the key"** — the first frame is `{ direction: 'out', type: 'session.opened' }` with `payload` matching `{ region: 'us', translation: { type: 'one_way', target_language: 'ja' } }`; after case 16's exchange, `JSON.stringify(of('frame'))` does not contain `'test-key'`.

  **Plan B's session seams** (stubs, nothing more — survey §2.12):
  21. **"tells a lease the first frame of each socket, and never resumes under one"** — `const lease = { streamAccepted: vi.fn(), atGrantEnd: vi.fn(() => false), cutoff: vi.fn() }`; `live({ credentials: { ...KEY, lease } })`; two messages → `streamAccepted` called once; a 503 error frame → one `failed` `connection_lost` at once, and no second STT socket after the close.
  22. **"a 403 at the grant's end closes the leg without a failure, after the lease's cutoff"** — `atGrantEnd: vi.fn(() => true)`; a 403 frame, then `serverClose(1000); await flush()` → `lease.cutoff` called once; one `closed`, no `failed`.
  23. **"a 403 before the grant's end is an auth failure"** — `atGrantEnd: () => false`, a 403 → `failed` `auth`.
  24. **"a leg that should speak but has no TTS key runs text-only, saying tts_degraded once"** — `credentials: { region: 'us', stt: 'k' }` → one socket only; after `await starting` and a flush, one `degraded` `{ code: 'tts_degraded' }`.
  25. **"a client reference rides in both config frames when the credentials carry one"** — `{ ...KEY, clientReferenceId: 'ref-1' }` → the STT config has `client_reference_id: 'ref-1'`; after an exchange, so has the TTS stream config.
  - `sessionSide.consistency.test.ts`: Task 1's Soniox block becomes

    ```ts
        const soniox = sessionSide(REPO_ROOT, 'src/providers/soniox');
        expect(soniox).toEqual(expect.arrayContaining([
          'src/providers/soniox/adapter.ts',
          'src/providers/soniox/socket.ts',
          'src/providers/soniox/speech.ts',
          'src/providers/soniox/sttStream.ts',
          'src/providers/soniox/ttsStream.ts',
          'src/providers/soniox/utterances.ts',
        ]));
        // The builder, the check and the settings side are not the session's: the adapter imports them as types only.
        for (const file of ['check.ts', 'config.ts', 'settings.ts', 'ttsRest.ts', 'voicesClient.ts']) {
          expect(soniox).not.toContain(`src/providers/soniox/${file}`);
        }
    ```

    (`pcmMixer.ts` and `sideTracker.ts` join the list again with `startBoth`, Task 9.)
- [ ] **Step 2: Run** `npx vitest run src/providers/soniox/adapter.test.ts src/providers/sessionSide.consistency.test.ts` — FAIL: the seed has no adapter.
- [ ] **Step 3: Implement** `adapter.ts`, in full:

  ```ts
  /**
   * Soniox on the new contract (spec: "L0 — the client contract"), ported
   * from `SonioxClient` (`src/services/clients/SonioxClient.ts`, still
   * compiled for the managed twin) without its display bookkeeping: items,
   * ids, the punctuation lane and the notices are L1's and L2's now.
   * `SonioxCore` runs one STT socket; each speaking leg has its own
   * `LegSpeech`. Every timer reads the request's clock, and nothing is said
   * but through events (CLAUDE.md, "Inside an IClient session").
   */
  import {
    AdapterStartError,
    SAMPLE_RATE,
    type Adapter,
    type AdapterEvents,
    type AdapterSession,
    type SessionContext,
    type StartRequest,
  } from '../../lib/contract/adapter';
  import { framePayload } from '../../lib/contract/framePayload';
  import type { LegName } from '../../lib/conversation/types';
  import { describeCause } from '../../lib/diagnostics/describeCause';
  import { AUTO } from '../../lib/provider/languages';
  import { nativeSocket, type OpenSocket } from './socket';
  import { LegSpeech } from './speech';
  import { SonioxSttStream, type SonioxSttConfig, type SonioxSttMessage } from './sttStream';
  import { tokenFrames, Utterances } from './utterances';
  import type { SonioxConfig } from './config';
  import type { SonioxCredentials } from './settings';

  /** The first resume attempt at once, then after 1 s and after 3 s (`SonioxClient.ts:649`). */
  export const RESUME_DELAYS_MS: readonly number[] = [0, 1_000, 3_000];
  /** At most this many 503 resumes per session (`SonioxClient.ts:248`): past it a 503 is an outage. */
  export const MAX_RESUME_CYCLES = 5;
  /** Failures the user did not cause and cannot fix in Settings — start again (`SonioxClient.ts:57`). */
  const RECOVERABLE = new Set(['503', '408', 'socket_error']);

  /** An STT error as the run's API error type (choice 8): its words are `notices.<type>`, the server's own as the detail. */
  export function sttFailureCode(code: string): 'auth' | 'rate_limit' | 'client' | 'server' {
    const n = Number(code);
    if (n === 401 || n === 403) return 'auth';
    if (n === 429) return 'rate_limit';
    if (n >= 400 && n < 500) return 'client';
    return 'server';
  }

  export interface SonioxAdapterDeps {
    /** `new WebSocket(url)` in the app; a `FakeSocket` factory in tests. */
    openSocket: OpenSocket;
  }

  /** One leg a core serves: its events, its direction, and its speech when it speaks. */
  interface CoreLeg {
    name: LegName;
    events: AdapterEvents;
    context: SessionContext;
    speech: LegSpeech | null;
    /** Asked to speak but issued no TTS key (a managed text-only lease): said once the start resolves. */
    noTtsKey: boolean;
  }

  function coreLeg(name: LegName, request: StartRequest<SonioxConfig, SonioxCredentials>, events: AdapterEvents, openSocket: OpenSocket): CoreLeg {
    const tts = request.config.tts;
    const key = request.credentials.tts;
    const speech = tts && key
      ? new LegSpeech({ region: request.credentials.region, key, clientReferenceId: request.credentials.clientReferenceId, voice: tts.voice, speed: tts.speed, events, clock: request.clock, openSocket })
      : null;
    return { name, events, context: request.context, speech, noTtsKey: tts !== undefined && !key };
  }

  interface CoreOptions {
    /** The request whose socket, key, clock and signal the core runs on. */
    primary: StartRequest<SonioxConfig, SonioxCredentials>;
    /** The legs it serves, the socket's own first. */
    legs: readonly CoreLeg[];
    openSocket: OpenSocket;
  }

  class SonioxCore {
    private ended = false;
    private stt: SonioxSttStream | null = null;
    private readonly utterances: Utterances;
    private readonly cancels = new Set<() => void>();
    private resumeCycles = 0;
    private pendingResume: string | null = null;
    private pendingCutoff = false;
    private readable = true;

    constructor(private readonly o: CoreOptions) {
      this.utterances = new Utterances({
        clock: o.primary.clock,
        sink: {
          segment: (leg, event) => { if (!this.ended) (this.leg(leg).events[event.kind] as (payload: unknown) => void)(event.payload); },
          speak: (leg, ref, text, span, language) => { if (!this.ended) this.leg(leg).speech?.speak(ref, text, span, language); },
          endSpeech: (leg) => { if (!this.ended) this.leg(leg).speech?.endUtterance(); },
        },
        legFor: (token) => this.legFor(token),
        targetFor: (leg) => this.leg(leg).context.direction.target,
      });
    }

    /** Opens the STT socket and each speaking leg's TTS socket at once; rejects, opening nothing, when the STT socket cannot open or the signal aborts. */
    open(signal: AbortSignal): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason ?? new Error('aborted'));
          return;
        }
        let settled = false;
        const fail = (error: unknown) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          this.shutdown();
          reject(error);
        };
        const onAbort = () => fail(signal.reason ?? new Error('aborted'));
        signal.addEventListener('abort', onAbort, { once: true });
        const stt = this.newStt();
        this.stt = stt;
        // A speech's open never rejects: a TTS socket that cannot open is retried on the first text (ruling 3).
        Promise.all([stt.connect(this.sttConfig()), ...this.o.legs.map((leg) => leg.speech?.open())]).then(
          () => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            this.opened();
            resolve();
          },
          (error: unknown) => fail(new AdapterStartError(
            `Soniox did not open the connection: ${describeCause(error)}`, 'network', { detail: describeCause(error) }, { cause: error },
          )),
        );
      });
    }

    /** A leg's view of the core. */
    session(name: LegName): AdapterSession {
      return {
        info: { transport: 'websocket' },
        appendAudio: (pcm) => this.appendAudio(name, pcm),
        // Soniox's STT socket takes no text (`textInput: false`).
        appendText: () => {},
        beginTurn: () => {},
        endTurn: () => this.endTurn(name),
        // A press with no voice sent nothing; what the server still decodes closes on its own endpoint.
        cancelTurn: () => {},
        stop: () => this.stop(),
      };
    }

    /** Closes every socket before returning (the `stop()` rule); idempotent. */
    stop(): Promise<void> {
      this.shutdown();
      return Promise.resolve();
    }

    private leg(name: LegName): CoreLeg {
      return this.o.legs.find((l) => l.name === name) ?? this.o.legs[0];
    }

    /** Which leg an utterance belongs to: one leg's core has one answer. */
    private legFor(_token: unknown): LegName {
      return this.o.legs[0].name;
    }

    private appendAudio(_name: LegName, pcm: Int16Array): void {
      if (!this.ended) this.stt?.sendAudio(pcm);
    }

    /** Manual turns end with `finalize` (ruling 5); the socket's own leg holds the key. */
    private endTurn(name: LegName): void {
      if (this.ended || name !== this.o.legs[0].name || !this.stt?.isOpen()) return;
      this.stt.finalize();
      this.frame('out', 'stt.finalize');
    }

    /** The STT config frame: a pure function of the request, so a resume sends it byte for byte again. */
    private sttConfig(): SonioxSttConfig {
      const { context, config, credentials } = this.o.primary;
      const { source, target } = context.direction;
      return {
        apiKey: credentials.stt,
        region: credentials.region,
        model: config.stt.model,
        sampleRate: SAMPLE_RATE,
        translation: { type: 'one_way', target_language: target },
        ...(source !== AUTO ? { languageHints: [source] } : {}),
        ...(config.stt.context ? { context: config.stt.context } : {}),
        endpointSensitivity: config.stt.endpointSensitivity,
        endpointLatencyAdjustmentLevel: config.stt.endpointLatencyAdjustmentLevel,
        endpointMaxDelayMs: config.stt.endpointMaxDelayMs,
        ...(credentials.clientReferenceId ? { clientReferenceId: credentials.clientReferenceId } : {}),
      };
    }

    private opened(): void {
      const config = this.sttConfig();
      this.frame('out', 'session.opened', { region: config.region, translation: config.translation, speaking: this.o.legs.filter((l) => l.speech).map((l) => l.name) });
      // Once the start has resolved: a start that failed owes no notice.
      queueMicrotask(() => {
        for (const leg of this.o.legs) {
          if (leg.noTtsKey && !this.ended) leg.events.degraded({ code: 'tts_degraded', message: 'No TTS key was issued for this leg: it runs text-only.' });
        }
      });
    }

    private newStt(): SonioxSttStream {
      const stream = new SonioxSttStream({ clock: this.o.primary.clock, openSocket: this.o.openSocket });
      let first = true;
      // A socket this core has moved on from (a resume, a stop) is heard no more: its identity replaces the old generation counter.
      const current = () => !this.ended && stream === this.stt;
      stream.setHandlers({
        onMessage: (message) => {
          if (!current()) return;
          if (first) {
            first = false;
            this.o.primary.credentials.lease?.streamAccepted();
          }
          this.readable = true;
          this.onMessage(message);
        },
        onError: (code, message) => { if (current()) this.onError(code, message); },
        onClose: (event) => { if (current()) this.onClose(event); },
        onUnreadable: (error) => {
          // The Logs only, on the ok → failing transition (choice 7): never a notice.
          if (!current() || !this.readable) return;
          this.readable = false;
          this.frame('in', 'stt.unreadable', { message: describeCause(error) });
        },
      });
      return stream;
    }

    private onMessage(message: SonioxSttMessage): void {
      const tokens = message.tokens ?? [];
      for (const f of tokenFrames(tokens)) this.frame(f.direction, f.type, f.payload);
      this.utterances.message(tokens);
    }

    private onError(code: string, message: string): void {
      const lease = this.o.primary.credentials.lease;
      if (lease && code === '403' && lease.atGrantEnd(this.o.primary.clock.now())) {
        // The granted duration ended (managed): the close that follows ends the leg without an error (Plan B's seam).
        this.pendingCutoff = true;
        return;
      }
      if (!lease && code === '503' && this.resumeCycles < MAX_RESUME_CYCLES) {
        // An own key only: a managed key is single-use and a reconnect with it is refused (`SonioxClient.ts:1336-1348`).
        this.resumeCycles += 1;
        this.pendingResume = message;
        this.frame('in', 'session.stt_503', { message, cycle: this.resumeCycles });
        return;
      }
      if (RECOVERABLE.has(code)) {
        this.fail('connection_lost', `The Soniox connection was lost (${code}${message ? `: ${message}` : ''}).`);
        return;
      }
      this.fail(sttFailureCode(code), `[Soniox ${code}] ${message}`);
    }

    private onClose(event: { code?: number; reason?: string }): void {
      if (this.pendingCutoff) {
        this.pendingCutoff = false;
        this.o.primary.credentials.lease?.cutoff();
        this.frame('in', 'session.duration_cutoff', { code: event.code, reason: event.reason });
        for (const leg of this.o.legs) {
          if (this.ended) break;
          leg.events.closed({ reason: 'The granted session time ended.' });
        }
        this.shutdown();
        return;
      }
      if (this.pendingResume !== null) {
        const original = this.pendingResume;
        this.pendingResume = null;
        this.stt = null;
        void this.resume(original);
        return;
      }
      // A close with nothing said before it: a network drop, or the server going away.
      this.fail('connection_lost', event.reason || `The Soniox connection closed unexpectedly (${event.code ?? 'no code'}).`);
    }

    /** The own-key 503 ladder (ruling 3): the utterance in flight closes as it stands; the TTS socket carries on. */
    private async resume(original: string): Promise<void> {
      this.frame('in', 'session.stt_resuming');
      for (const leg of this.o.legs) leg.events.reconnecting();
      this.utterances.abandon();
      for (const delay of RESUME_DELAYS_MS) {
        if (delay > 0) await this.wait(delay);
        if (this.ended) return;
        const stream = this.newStt();
        this.stt = stream;
        try {
          await stream.connect(this.sttConfig());
          if (this.ended) return;
          this.frame('in', 'session.stt_resumed');
          for (const leg of this.o.legs) leg.events.reconnected();
          return;
        } catch (error) {
          if (this.ended) return;
          this.stt = null;
          // The Logs only (choice 6): the leg already shows reconnecting.
          this.frame('in', 'session.stt_resume_attempt_failed', { message: describeCause(error) });
        }
      }
      this.frame('in', 'session.stt_resume_failed', { message: original });
      this.fail('connection_lost', `Soniox 503: ${original}`);
    }

    /** Resolves after `ms` on the clock, or at once when the core stops. */
    private wait(ms: number): Promise<void> {
      return new Promise<void>((resolve) => {
        const cancelTimer = this.o.primary.clock.setTimeout(() => {
          this.cancels.delete(onStop);
          resolve();
        }, ms);
        const onStop = () => {
          cancelTimer();
          resolve();
        };
        this.cancels.add(onStop);
      });
    }

    private fail(code: string, message: string): void {
      if (this.ended) return;
      if (code === 'connection_lost') this.frame('in', 'session.connection_lost', { message });
      for (const leg of this.o.legs) {
        if (this.ended) break;
        leg.events.failed({ code, message });
      }
      this.shutdown();
    }

    private shutdown(): void {
      if (this.ended) return;
      this.ended = true;
      for (const cancel of this.cancels) cancel();
      this.cancels.clear();
      this.utterances.stop();
      const stt = this.stt;
      this.stt = null;
      // The empty text frame ends the stream (`SonioxClient.ts:1540-1589`); its trailing tokens are not awaited.
      stt?.end();
      stt?.close();
      for (const leg of this.o.legs) leg.speech?.close();
    }

    private frame(direction: 'in' | 'out', type: string, payload?: unknown): void {
      if (!this.ended) this.o.legs[0].events.frame({ direction, type, ...(payload === undefined ? {} : { payload: framePayload(payload) }) });
    }
  }

  export function createSonioxAdapter(deps: Partial<SonioxAdapterDeps> = {}): Adapter<SonioxConfig, SonioxCredentials> {
    const openSocket = deps.openSocket ?? nativeSocket;
    return {
      async start(request, events) {
        if (request.signal.aborted) throw request.signal.reason ?? new Error('aborted');
        // One leg: the core's name for it is its own; the runner knows which leg these events are.
        const core = new SonioxCore({ primary: request, legs: [coreLeg('speaker', request, events, openSocket)], openSocket });
        await core.open(request.signal);
        return core.session('speaker');
      },
    };
  }
  ```

- [ ] **Step 4: Run** the Step 2 command, then `npx vitest run src/providers src/lib/contract`, the full suite and the gate — PASS. The guard's "a session side runs no global timer" and "imports no store and no reporter" now walk the real adapter: `queueMicrotask` is not a timer; `config.ts` (which reaches `report`) is a type import.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/soniox/adapter.ts src/providers/soniox/adapter.test.ts src/providers/sessionSide.consistency.test.ts
  ```

  ```bash
  git commit -q -F - -- src/providers/soniox/adapter.ts src/providers/soniox/adapter.test.ts src/providers/sessionSide.consistency.test.ts <<'EOF'
  feat(soniox): the adapter — one leg over the STT socket, with its own speech

  SonioxCore opens the STT socket and the leg's TTS socket together,
  turns tokens into segments, ends a manual turn with finalize, keeps the
  own-key 503 resume on the request's clock (0/1/3 s, five cycles), and
  maps every other failure to connection_lost or the server's words by
  type. It passes the conformance suite but typed text, and reserves the
  managed lease's seams (accepted, grant-end cutoff, no resume).

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 9: `startBoth` — one mixed socket, or two (D23; ruling 4)

**Files:**
- Modify: `src/providers/soniox/adapter.ts`, `src/providers/sessionSide.consistency.test.ts`.
- Create: `src/providers/soniox/adapter.both.test.ts`.

**Interfaces:**
- **Consumes:** `LegStartError` (Task 4); `PcmMixer`, `SonioxSideTracker` (Task 1); `SonioxCore`, `coreLeg` (Task 8).
- **Produces:** `createSonioxAdapter(deps)` returns `SonioxAdapter = Adapter<SonioxConfig, SonioxCredentials> & { startBoth(requests: Record<LegName, StartRequest<SonioxConfig, SonioxCredentials>>, events: Record<LegName, AdapterEvents>): Promise<Record<LegName, AdapterSession>> }`; `CoreOptions.shared?: true`.
- **Consumed by:** Task 11 (`session: { startBoth }`).

- [ ] **Step 1: Write the failing tests** — `adapter.both.test.ts`, with Task 8's helpers (`SHARED`, `b64`, `msg`, `orig`, `tr`, `END`, `isStt`) copied at its top, and:

  ```ts
  const SPK: SonioxCredentials = { region: 'us', stt: 'k-spk', tts: 'k-spk' };
  const PAR: SonioxCredentials = { region: 'us', stt: 'k-par', tts: 'k-par-tts' };
  function both(o: { sharedBoth?: boolean; participantSpeaks?: boolean } = {}) {
    const sockets = fakeSockets();
    const clock = createVirtualClock(0);
    const controller = new AbortController();
    const s: SonioxSettings = { ...SONIOX_DEFAULTS, bothModeSharedSession: o.sharedBoth ?? true };
    const contexts: Record<LegName, SessionContext> = {
      speaker: { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' },
      participant: { direction: { source: 'ja', target: 'en' }, speech: o.participantSpeaks ?? false, turns: 'auto' },
    };
    const rec = { speaker: recordEvents(), participant: recordEvents() };
    const request = (leg: LegName, credentials: SonioxCredentials): StartRequest<SonioxConfig, SonioxCredentials> =>
      ({ context: contexts[leg], config: buildSoniox(contexts[leg], s, SHARED), credentials, clock, signal: controller.signal });
    const starting = createSonioxAdapter({ openSocket: sockets.create }).startBoth(
      { speaker: request('speaker', SPK), participant: request('participant', PAR) },
      { speaker: rec.speaker.events, participant: rec.participant.events },
    );
    const sttSockets = () => sockets.all.filter(isStt);
    const ttsSockets = () => sockets.all.filter((x) => !isStt(x));
    const openAll = () => { for (const x of sockets.all) if (x.readyState === FakeSocket.CONNECTING) x.open(); };
    const kinds = (leg: LegName) => rec[leg].log.map((e) => e.kind);
    return { sockets, clock, controller, rec, starting, sttSockets, ttsSockets, openAll, kinds };
  }
  /** A 100-ms frame's worth of one level (the mixer's frame). */
  const level = (v: number) => new Int16Array(2400).fill(v);
  ```

  1. **"split: two sessions on two STT sockets, each on its own direction and key"** — `both({ sharedBoth: false })`, `openAll()`, `await starting` → two STT sockets; the first's config `{ api_key: 'k-spk', translation: { type: 'one_way', target_language: 'ja' }, language_hints: ['en'] }`, the second's `{ api_key: 'k-par', translation: { type: 'one_way', target_language: 'en' }, language_hints: ['ja'] }`; neither has `enable_speaker_diarization`.
  2. **"split: the legs stop apart"** — `await sessions.speaker.stop()` → the first STT socket `closedByClient`, the second not.
  3. **"split: a participant that cannot open stops the speaker and is named"** — open every socket but the participant's STT (the second STT socket), `drop()` it → `starting` rejects with a `LegStartError` whose `leg` is `'participant'` and whose `cause` is an `AdapterStartError` with `code: 'network'`; the speaker's sockets are `closedByClient`.
  4. **"shared: one STT socket, two_way on the speaker's pair, both hints, diarization, the speaker's key"** — `both()`, `openAll()`, `await starting` → one STT socket, whose config matches `{ api_key: 'k-spk', translation: { type: 'two_way', language_a: 'en', language_b: 'ja' }, language_hints: ['en', 'ja'], enable_speaker_diarization: true }`; one TTS socket (the speaker speaks, the participant does not).
  5. **"shared: mixes both legs onto the socket every 100 ms, and keeps sending when both are quiet"** — `speaker.appendAudio(level(1000))`, `participant.appendAudio(level(3000))`, `clock.advance(100)` → the STT socket's binary frames (`sent.filter((d) => d instanceof Int16Array)`) are one of 2 400 samples, each `2000`; `clock.advance(100)` → a second frame, all zeros.
  6. **"shared: an utterance goes to the leg the energy names — over the language"** — ten frames of `speaker.appendAudio(level(4000))` with the participant quiet (`clock.advance(100)` after each); `receive(msg({ ...orig('Hello'), language: 'ja', start_ms: 0, end_ms: 900 }))` → a `segmentOpened` in the speaker's log and none in the participant's (energy beats the language, which alone would say participant). Then `END`, ten frames of `participant.appendAudio(level(4000))`, and `orig('Bonjour')` with `start_ms: 1000, end_ms: 1900` → the participant's log.
  7. **"shared: a speaker label established by energy answers on its own"** — two energy-backed participant utterances whose tokens carry `speaker: '2'`; then an utterance with `speaker: '2'` at `start_ms: 60_000` (no frame recorded there) and `language: 'en'` → the participant's log (the label tier, not the language).
  8. **"shared: the language decides when neither label nor energy can, and the speaker's leg when nothing can"** — no frames: `orig` with `language: 'en'` → speaker; after `END`, `language: 'ja'` → participant; after `END`, no `language` → speaker.
  9. **"shared: each speaking leg has its own TTS socket and key; the participant speaks only when its switch is on (ruling 4)"** — `both({ participantSpeaks: true })` → two TTS sockets; a participant utterance (case 8's `ja` one) with `tr('Good morning.', …)` whose `language` is `'en'` → its stream config on the second TTS socket has `api_key: 'k-par-tts'` and `language: 'en'`; the speaker's TTS socket got nothing for it. `both()` (the default) → one TTS socket.
  10. **"shared: stopping either leg stops the core, once"** — `await sessions.participant.stop()` → the STT socket and the TTS socket `closedByClient`; `await sessions.speaker.stop()` resolves; `clock.advance(60_000)` → neither log grows.
  11. **"shared: a socket failure fails both legs"** — `sttSockets()[0].serverClose(1011); await flush()` → each log has one `failed` with `code: 'connection_lost'`.
  12. **"shared: a resume shows both legs reconnecting, then reconnected, and forgets the speaker labels"** — case 7's two utterances establish `speaker: '2'` as the participant; a 503 frame, `serverClose(1011)`, `await flush()` → both logs have `reconnecting`; `openAll(); await flush()` → both `reconnected`; then an utterance with `speaker: '2'`, no energy for its window, `language: 'en'` → the speaker's log (the label forgotten: `sideTracker.reset()`, `SonioxClient.ts:646-647`).
  13. **"shared: only the speaker's endTurn finalizes, on the shared socket"** — `participant.endTurn()` → no `{ type: 'finalize' }` sent; `speaker.endTurn()` → sent once.
  14. **"shared: a socket that cannot open names the speaker"** — `sttSockets()[0].drop()` before open → `starting` rejects with `LegStartError` `leg: 'speaker'`.
  15. **"a start already cancelled opens nothing"** — `controller.abort(new Error('cancelled'))` before `startBoth` is called (build `both` with the abort first) → rejects `/cancelled/`; `sockets.all` is empty.
  - `sessionSide.consistency.test.ts`: the Soniox list gains `'src/providers/soniox/pcmMixer.ts'` and `'src/providers/soniox/sideTracker.ts'`.
- [ ] **Step 2: Run** `npx vitest run src/providers/soniox/adapter.both.test.ts src/providers/sessionSide.consistency.test.ts` — FAIL: `startBoth` does not exist.
- [ ] **Step 3: Implement** in `adapter.ts`:
  - imports: `LegStartError` joins the contract import; `import { PcmMixer } from './pcmMixer';`, `import { SonioxSideTracker } from './sideTracker';`, and `type SonioxToken` from `./sttStream`.
  - `CoreOptions` gains `/** Shared Both (D23): both legs' audio mixed onto this one socket, each utterance given to the leg the side tracker names. */ shared?: true;`.
  - `SonioxCore` fields, set in the constructor:

    ```ts
    /** Shared Both only: which side an utterance is (`sideTracker.ts`), fed by the frames actually sent. */
    private readonly tracker: SonioxSideTracker | null;
    /** Shared Both only: the speaker as channel A, the participant as B, 100-ms frames at 0.5 gain (`SonioxClient.ts:400-417`). */
    private readonly mixer: PcmMixer | null;
    ```

    ```ts
      this.tracker = o.shared ? new SonioxSideTracker() : null;
      this.mixer = o.shared
        ? new PcmMixer({
          clock: o.primary.clock,
          frameSamples: SAMPLE_RATE / 10,
          intervalMs: 100,
          maxBacklogSamples: SAMPLE_RATE * 2,
          // Energy only for frames actually sent: the tracker's frame index must match the server's `start_ms`.
          onFrame: (mixed, energyA, energyB) => {
            if (!this.stt?.isOpen()) return;
            this.stt.sendAudio(mixed);
            this.tracker?.recordFrame(energyA, energyB);
          },
        })
        : null;
    ```

    (declared before `utterances`' construction, which does not call `legFor` until a message arrives).
  - `legFor(token: SonioxToken)`:

    ```ts
    private legFor(token: SonioxToken): LegName {
      if (!this.tracker) return this.o.legs[0].name;
      // An established speaker label, else the channels' energy over the token's window (`SonioxClient.ts:982-998`).
      const evidence = this.tracker.inferSide(token.speaker, token.start_ms, token.end_ms);
      if (evidence) return evidence.side;
      // The language, which never votes; the speaker's leg when nothing can tell.
      const source = this.o.primary.context.direction.source;
      if (token.translation_status !== 'translation' && token.language) return token.language === source ? 'speaker' : 'participant';
      if (token.translation_status === 'translation' && token.source_language) return token.source_language === source ? 'speaker' : 'participant';
      return 'speaker';
    }
    ```

  - `appendAudio(name, pcm)`: `if (this.ended) return; if (this.mixer) { if (name === 'participant') this.mixer.pushB(pcm); else this.mixer.pushA(pcm); return; } this.stt?.sendAudio(pcm);`.
  - `sttConfig()`: the translation and hints become

    ```ts
        translation: this.o.shared ? { type: 'two_way', language_a: source, language_b: target } : { type: 'one_way', target_language: target },
        ...(this.o.shared
          ? { languageHints: [source, target], enableSpeakerDiarization: true }
          : source !== AUTO ? { languageHints: [source] } : {}),
    ```

    (D20 keeps an auto source out of Both: the gate refuses the participant leg.)
  - `opened()`: `this.mixer?.start();` first. `shutdown()`: `this.mixer?.stop();` after `this.utterances.stop()`. `resume()`: `this.tracker?.reset();` right after `this.utterances.abandon();`.
  - `createSonioxAdapter`:

    ```ts
    export type SonioxAdapter = Adapter<SonioxConfig, SonioxCredentials> & {
      startBoth(
        requests: Record<LegName, StartRequest<SonioxConfig, SonioxCredentials>>,
        events: Record<LegName, AdapterEvents>,
      ): Promise<Record<LegName, AdapterSession>>;
    };

    export function createSonioxAdapter(deps: Partial<SonioxAdapterDeps> = {}): SonioxAdapter {
      const openSocket = deps.openSocket ?? nativeSocket;
      const start: SonioxAdapter['start'] = async (request, events) => {
        if (request.signal.aborted) throw request.signal.reason ?? new Error('aborted');
        // One leg: the core's name for it is its own; the runner knows which leg these events are.
        const core = new SonioxCore({ primary: request, legs: [coreLeg('speaker', request, events, openSocket)], openSocket });
        await core.open(request.signal);
        return core.session('speaker');
      };

      /** Split Both: two ordinary sessions; one that fails stops the other and is named (D22). */
      const startSplit: SonioxAdapter['startBoth'] = async (requests, events) => {
        const legs: LegName[] = ['speaker', 'participant'];
        const settled = await Promise.allSettled(legs.map((leg) => start(requests[leg], events[leg])));
        const i = settled.findIndex((r) => r.status === 'rejected');
        if (i >= 0) {
          // Settled, so a stop that fails too never replaces the start's failure.
          await Promise.allSettled(settled.map((r) => (r.status === 'fulfilled' ? r.value.stop() : undefined)));
          const reason = (settled[i] as PromiseRejectedResult).reason;
          if (requests.speaker.signal.aborted) throw reason;
          throw new LegStartError(legs[i], reason);
        }
        const [speaker, participant] = settled.map((r) => (r as PromiseFulfilledResult<AdapterSession>).value);
        return { speaker, participant };
      };

      return {
        start,
        async startBoth(requests, events) {
          const signal = requests.speaker.signal;
          if (signal.aborted) throw signal.reason ?? new Error('aborted');
          if (!requests.speaker.config.sharedBoth) return startSplit(requests, events);
          // Shared Both: one socket on the speaker's key; each leg speaks through its own TTS socket and key (ruling 4).
          const core = new SonioxCore({
            primary: requests.speaker,
            legs: [
              coreLeg('speaker', requests.speaker, events.speaker, openSocket),
              coreLeg('participant', requests.participant, events.participant, openSocket),
            ],
            openSocket,
            shared: true,
          });
          try {
            await core.open(signal);
          } catch (error) {
            if (signal.aborted) throw error;
            // The socket and its key are the speaker's; a participant's TTS that cannot open is only degraded speech.
            throw new LegStartError('speaker', error);
          }
          // Both facades stop the one core: either leg ending ends both (D21).
          return { speaker: core.session('speaker'), participant: core.session('participant') };
        },
      };
    }
    ```

- [ ] **Step 4: Run** `npx vitest run src/providers/soniox src/providers/sessionSide.consistency.test.ts`, then the full suite and the gate — PASS. Task 8's cases are unchanged: without `shared` the core sends `one_way`, feeds the socket directly and has one leg.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/soniox/adapter.ts src/providers/soniox/adapter.both.test.ts src/providers/sessionSide.consistency.test.ts
  ```

  ```bash
  git commit -q -F - -- src/providers/soniox/adapter.ts src/providers/soniox/adapter.both.test.ts src/providers/sessionSide.consistency.test.ts <<'EOF'
  feat(soniox): startBoth — both legs on one mixed two_way socket, or two sessions

  Shared Both mixes the two legs every 100 ms onto the speaker's socket,
  gives each utterance to the leg the side tracker names (label, energy,
  then language), and speaks each speaking leg through its own TTS socket
  — the participant too when its switch is on. Split Both starts two
  sessions and names the leg that failed; either facade stops a shared
  core.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 10a: The voice-preview route (D18; ruling 6)

Split from the draft's Task 10 on the review (M11): the route is one deliverable, Soniox's components another. This task builds the route and hands it to a provider's `Settings`; Task 10b's view is its first user.

**Files:**
- Create: `src/components/providers/VoicePreviewContext.ts`; `src/app/voicePreview.ts`, `src/app/voicePreview.test.ts`.
- Modify: `src/lib/provider/types.ts` (`PreviewPort`; `SettingsProps.preview`, `.legs`), `src/components/providers/ProviderOwnSettings.tsx`, `src/components/providers/ProviderOwnSettings.test.tsx`, `src/components/Settings/sections/VoiceLibrarySection.tsx` (additive: the stated exception to ruling 1, choice 13), `src/components/Settings/sections/VoiceLibrarySection.test.tsx`.

**Interfaces:**
- **Consumes:** `getAppAudio()` (`src/lib/audio/appAudio.ts`: the page's one playback, built on first use) and its `playback.preview` / `stopPreview` (`src/lib/audio/playback.ts`); `useProviderStore`'s `legs`.
- **Produces:**
  - `types.ts`: `interface PreviewPort { play(clip: PreviewClip): Promise<void>; stop(): void }` (`PreviewClip` from `../audio/playback`); `SettingsProps.preview?: PreviewPort`; `SettingsProps.legs?: readonly LegName[]`;
  - `VoicePreviewContext: React.Context<PreviewPort | null>` (`src/components/providers/VoicePreviewContext.ts`);
  - `appVoicePreview: PreviewPort` (`src/app/voicePreview.ts`);
  - `VoiceLibrarySection` plays through the context's port when one is provided.
- **Consumed by:** Task 10b (`SonioxSettingsView` provides the context from `preview`, reads `legs`); Task 11 (through 10b); Plan B's managed view.

- [ ] **Step 1: Write the failing tests.**
  - `voicePreview.test.ts` — `vi.mock('../lib/audio/appAudio', () => ({ getAppAudio: async () => ({ playback }) }))` with `const playback = { preview: vi.fn(async () => {}), stopPreview: vi.fn() }`:
    17. **"plays a clip through the page's playback, the preview route"** — `await appVoicePreview.play(clip)` → `playback.preview` called with `clip`.
    18. **"stop stops the page's preview once the playback has loaded, and does nothing before"** — a fresh module (`vi.resetModules()` + dynamic import): `stop()` before any `play` → `stopPreview` not called; after a `play`, `stop()` → called once.
  - `VoiceLibrarySection.test.tsx`, a new `describe('through the preview route')` (`const port = { play: vi.fn(() => new Promise<void>((r) => { finish = r; })), stop: vi.fn() }`, rendered inside `<VoicePreviewContext.Provider value={port}>`, no Web Audio stub):
    19. **"plays a voice's sample through the route, shows Stop while it plays, and Play once it ends"** — click Play → `onPreview` called; `port.play` called with the payload; a Stop control; `act(() => finish())` → Play again.
    20. **"a second click stops the route"** — Play, then Stop → `port.stop` called once; Play shown.
    21. **"unmounting while a sample plays stops the route"** — Play, then `unmount()` → `port.stop` called once.
    21b. **"a toggle or an unmount with nothing of its own playing leaves the route alone"** (the review's M12) — render, then `unmount()` with no Play → `port.stop` never called; render again, Play, `act(() => finish())` (the sample ended on its own), then click another row's Play → `port.stop` not called by that toggle (only `port.play` again). RED first: the draft's `stopPreview` called `port?.stop()` unconditionally.
    22. Every existing case (no provider of the context) stays as it is: the section plays on its own `AudioContext`.
  - `ProviderOwnSettings.test.tsx` — `vi.mock('../../app/voicePreview', () => ({ appVoicePreview: { play: vi.fn(), stop: vi.fn() } }))`:
    23. **"hands Settings the legs a start would open and the app's voice-preview route"** — `useProviderStore.setState({ legs: ['speaker', 'participant'], … })` → `seen[0].legs` is `['speaker', 'participant']` and `seen[0].preview` is the mocked `appVoicePreview`.
- [ ] **Step 2: Run** `npx vitest run src/app/voicePreview.test.ts src/components/providers src/components/Settings/sections/VoiceLibrarySection.test.tsx` — FAIL: cases 17–21b and 23 (the module, the context and the props do not exist yet); case 22's existing cases pass.
- [ ] **Step 3: Implement.**
  - `types.ts`: `import type { PreviewClip } from '../audio/playback';` and, before `SettingsProps`:

    ```ts
    /** The voice-preview route (spec, "Playback — Routing": voice preview, the real device, a fixed route): one clip at its own rate; `play` resolves when it ends or is stopped. */
    export interface PreviewPort {
      play(clip: PreviewClip): Promise<void>;
      stop(): void;
    }
    ```

    and in `SettingsProps`, after `account`:

    ```ts
      /** The voice-preview route. Set by `ProviderOwnSettings` for `Settings`; absent elsewhere, where a voice library plays on its own. */
      preview?: PreviewPort;
      /** The legs a start would open (the audio mode's). Set by `ProviderOwnSettings` for `Settings`: Soniox locks its shared-session choice outside Both. */
      legs?: readonly LegName[];
    ```

  - `VoicePreviewContext.ts`:

    ```ts
    import { createContext } from 'react';
    import type { PreviewPort } from '../../lib/provider/types';

    /**
     * The voice-preview route a provider's `Settings` hands its voice library
     * (Stage 2 Soniox, choice 13). Null — no provider of it — and the library
     * plays on its own `AudioContext`, as the old settings UI does.
     */
    export const VoicePreviewContext = createContext<PreviewPort | null>(null);
    ```

  - `src/app/voicePreview.ts` — on `getAppAudio()`, the test tone's own route (the review's M13): the same page playback as the session's, without loading the legs' capture for a voice sample, and without pulling `src/app/session` into `ProviderOwnSettings`' import graph:

    ```ts
    /**
     * The page's voice-preview route (spec, "Playback — Routing": voice preview
     * is folded into the preview route, the real device): what a provider's
     * `Settings` plays a voice's sample through, on the selected output
     * device. The page's playback is built on the first play (`getAppAudio`,
     * shared with the session and the test tone).
     */
    import { getAppAudio, type AppAudio } from '../lib/audio/appAudio';
    import type { PreviewPort } from '../lib/provider/types';

    let loaded: AppAudio | null = null;

    export const appVoicePreview: PreviewPort = {
      async play(clip) {
        const app = await getAppAudio();
        loaded = app;
        await app.playback.preview(clip);
      },
      stop() {
        loaded?.playback.stopPreview();
      },
    };
    ```

  - `ProviderOwnSettings.tsx`: `import { appVoicePreview } from '../../app/voicePreview';`; `const legs = useProviderStore((s) => s.legs);` beside `useSelectedProvider`; the render becomes `<Settings {...ownProps(selection, selection.entry, disabled)} account={account} legs={legs} preview={appVoicePreview} />`. (Nothing loads at import: `getAppAudio()` runs on the first play.)
  - `VoiceLibrarySection.tsx` — additive (choice 13; the stated exception to ruling 1):
    - `import { useContext } from 'react'` (joining the React import); `import { VoicePreviewContext } from '../../providers/VoicePreviewContext';`; `import { describeCause, reportWarning } from '../../../lib/diagnostics/report';`;
    - beside the other preview state:

      ```ts
      const port = useContext(VoicePreviewContext);
      /** The row playing through the host's route, if any: `stopPreview` stops the route only for this section's own sample (M12). */
      const playingIdRef = useRef<string | null>(null);
      ```

    - `stopPreview`, before `setPlayingId(null)`: `if (playingIdRef.current) { playingIdRef.current = null; port?.stop(); }` — it runs on every toggle and on unmount, and must never cut the test tone or another section's preview; its deps become `[port]`;
    - in `togglePreview`, right after `if (!payload || payload.audio.length === 0) return null;`:

      ```ts
      if (port) {
        // The host's preview route (the selected output device); the token tells a finish from a superseded play.
        playingIdRef.current = id;
        setPlayingId(id);
        port.play(payload).then(
          () => {
            if (token !== previewTokenRef.current) return;
            playingIdRef.current = null;
            setPlayingId(null);
          },
          (error: unknown) => {
            if (token === previewTokenRef.current) {
              playingIdRef.current = null;
              setPlayingId(null);
            }
            reportWarning('VoiceLibrary', `The voice preview did not play: ${describeCause(error)}`, { cause: error });
          },
        );
        return payload;
      }
      ```

      and `togglePreview`'s deps gain `port` (`[playingId, onPreview, stopPreview, port]`). The `AudioContext` path below it is unchanged (and keeps the gate's baseline line).
- [ ] **Step 4: Run** the Step 2 command, then `npx vitest run src/components/Settings src/components/providers src/app`, the full suite and the gate. What else renders the touched pieces, and why each stays green: `SonioxVoiceSection.test.tsx` and `LocalInferenceVoiceSection.test.tsx` render `VoiceLibrarySection` with no provider of the context (the `AudioContext` path, unchanged: `playingIdRef` stays null, so `stopPreview` never reaches a port); `ProviderPanel.test.tsx`, `SpinePreview.test.tsx` and the Settings tests render `ProviderOwnSettings` — its two new props are extra, and `appVoicePreview` touches nothing until a play. `src/app/session.test.ts` is unaffected: `voicePreview.ts` does not import `./session`.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/components/providers/VoicePreviewContext.ts src/app/voicePreview.ts src/app/voicePreview.test.ts src/lib/provider/types.ts src/components/providers/ProviderOwnSettings.tsx src/components/providers/ProviderOwnSettings.test.tsx src/components/Settings/sections/VoiceLibrarySection.tsx src/components/Settings/sections/VoiceLibrarySection.test.tsx
  ```

  ```bash
  git commit -q -F - -- src/components/providers/VoicePreviewContext.ts src/app/voicePreview.ts src/app/voicePreview.test.ts src/lib/provider/types.ts src/components/providers/ProviderOwnSettings.tsx src/components/providers/ProviderOwnSettings.test.tsx src/components/Settings/sections/VoiceLibrarySection.tsx src/components/Settings/sections/VoiceLibrarySection.test.tsx <<'EOF'
  feat(settings): voice previews play through the page's preview route

  The host hands a provider's Settings the legs a start would open and
  the app's voice-preview route, which plays on the selected output
  through the page's one playback. A voice library under a provider of
  the route's context plays through it, and stops it only for its own
  sample; without one it plays on its own AudioContext, as before.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 10b: Soniox's settings components (D18, F13; ruling 6)

After Task 10a (the review's M11): the view provides 10a's `VoicePreviewContext` from `SettingsProps.preview` and reads `SettingsProps.legs`.

**Files:**
- Create: `src/providers/soniox/SonioxSettings.tsx`, `src/providers/soniox/SonioxSettings.test.tsx`, `src/providers/soniox/SonioxVoiceField.tsx`, `src/providers/soniox/SonioxVoiceField.test.tsx`, `src/providers/soniox/SonioxTurnDetection.tsx`, `src/providers/soniox/SonioxTurnDetection.test.tsx`; `src/components/providers/fields/LinesField.tsx`, `src/components/providers/fields/LinesField.test.tsx`.

**Interfaces:**
- **Consumes:** `PreviewPort`, `SettingsProps.preview` / `legs`, `VoicePreviewContext` (Task 10a); `SonioxSettings`, `SONIOX_DEFAULTS`, `sonioxKeyField`, `sonioxVoiceField` (Task 5); `SonioxVoicesClient` (Task 1, `voicesClient.ts`); `SonioxVoiceSection` and `byokVoiceSource` (the old UI, reused read-only); `TtsSpeedControl` (`LocalSettingsControls.tsx:25`).
- **Produces:**
  - `LinesField(props: LinesFieldProps)`, `LINES_FIELD_MAX = 4000`;
  - `type VoiceSourceHook = (account: ProviderAccount | undefined, region: SonioxRegion) => VoiceLibrarySource | null`; `useByokVoiceSource`; `SonioxVoiceField`;
  - `createSonioxSettingsView(flavour: { managed: boolean; useVoiceSource: VoiceSourceHook }): ComponentType<SettingsProps<SonioxSettings>>`; `SonioxSettingsView`;
  - `SonioxTurnDetectionSummary`, `SonioxTurnDetectionControls`.
- **Consumed by:** Task 11 (the definition's `Settings` and `TurnDetection`); Plan B (`createSonioxSettingsView({ managed: true, useVoiceSource: <its managed source hook> })`).

- [ ] **Step 1: Write the failing tests.**
  - `LinesField.test.tsx` (`t` mocked to return its fallback):
    1. **"a labelled textarea with its tooltip, placeholder and the 4 000-character cap, writing what is typed"** — `render(<LinesField id="terms" label="Terms" tooltip="Help" placeholder="One per line" value="a" onChange={onChange} />)` → `screen.getByLabelText('Terms')` is a `textarea` with `maxLength` 4000, placeholder `'One per line'`, value `'a'`; `fireEvent.change(…, { target: { value: 'a\nb' } })` → `onChange('a\nb')`.
    2. **"without a label it is named by ariaLabel, and draws no label row"** — `ariaLabel="Background"` → `getByLabelText('Background')`; no `.setting-label` in the container.
    3. **"disabled locks it"**.
  - `SonioxTurnDetection.test.tsx` (`t` returns its fallback):
    4. **"the summary is one line: the tuning's heading and its max pause"** — `render(<SonioxTurnDetectionSummary settings={{ ...SONIOX_DEFAULTS, endpointMaxDelayMs: 2500 }} update={() => {}} />)` → `container.textContent` is `'Endpoint Detection Tuning · Max Pause Before Finalizing: 2500 ms'`.
    5. **"the controls write numbers: sensitivity, max pause and latency level"** — the sensitivity slider (`aria-label` `'Endpoint Sensitivity'`, min −1, max 1, step 0.1) changed to `'0.3'` → `update({ endpointSensitivity: 0.3 })`; the max-pause slider (500–3000, step 100) to `'2800'` → `update({ endpointMaxDelayMs: 2800 })`; the latency select to `'2'` → `update({ endpointLatencyAdjustmentLevel: 2 })`; its four options read `'0 — Default'` … `'3 — Most aggressive'`.
    6. **"the controls lock while disabled"**.
  - `SonioxVoiceField.test.tsx` — `vi.mock('../../components/Settings/sections/SonioxVoiceSection', () => ({ default: (props: SonioxVoiceSectionProps) => { seen.push(props); return null; } }))`; `const account = (credentials: Record<string, string>): ProviderAccount => ({ credentials, auth: { signedIn: false, getToken: async () => null } })`:
    7. **"hands the section the region's voice, key and speed, the pair's target, and writes the region's voice field"** — `settings: { ...SONIOX_DEFAULTS, region: 'jp', voiceJp: 'Clone-1', ttsSpeed: 1.1 }`, `target: 'fr'`, `account({ apiKeyJp: 'k-jp' })` → the last props' `settings` match `{ voice: 'Clone-1', apiKey: 'k-jp', targetLanguage: 'fr', ttsSpeed: 1.1, region: 'jp' }`, `managed: false`, `isSessionActive: false`; `props.onUpdate({ voice: 'Other' })` → `update({ voiceJp: 'Other' })`.
    8. **"useByokVoiceSource: none without the region's key; a source with preview for one; the same source until that key or the region changes"** — `renderHook(({ a, r }) => useByokVoiceSource(a, r), { initialProps: { a: account({}), r: 'us' as SonioxRegion } })` → `null`; rerender with `account({ apiKey: 'k' })` → a source with `canPreview: true` and `cacheNamespace: 'soniox:us'`; rerender with a new object `account({ apiKey: 'k', apiKeyEu: 'other' })` → the same source object; `account({ apiKey: 'k2' })` → a different one; `r: 'eu'` with `apiKeyEu: 'e'` → `cacheNamespace: 'soniox:eu'` (the old memo, `ProviderSpecificSettings.tsx:273-297`).
    9. **"passes an injected source and the managed flag through (Plan B's seam)"** — `useVoiceSource: () => stubSource`, `managed: true` → the section's `source` is `stubSource`, `managed` is `true`.
  - `SonioxSettings.test.tsx` — the same `SonioxVoiceSection` mock; `Tooltip` mocked to record its `content` (as `SpeechSection.test.tsx:16-21` does); `t` returns its fallback; `const props = (patch: Partial<SettingsProps<SonioxSettings>> = {}) => ({ settings: SONIOX_DEFAULTS, update: vi.fn(), pair: { source: 'ja', target: 'en' }, account: account({ apiKey: 'k' }), legs: ['speaker', 'participant'] as const, ...patch })`:
    10. **"writes the region, and locks it while a run is on"** — the region select (`aria-label` `'Region'`) lists `United States`, `European Union`, `日本 (Japan)`; changing it to `'eu'` → `update({ region: 'eu' })`; `disabled` → the select is disabled.
    11. **"the TTS speed runs 0.7–1.3 in 0.05 steps and writes a number"** — the speed slider has `min` `'0.7'`, `max` `'1.3'`, `step` `'0.05'`; a change to `'0.85'` → `update({ ttsSpeed: 0.85 })`.
    12. **"the vocabulary and background are 4 000-character textareas that write what is typed"** — the three textareas (`'Terms'`, `'Preferred Translations'`, `'Session Background'`) each have `maxLength` 4000; typing writes `vocabularyTerms`, `vocabularyTranslations`, `contextText`.
    13. **"the shared-session pills write the choice, and are locked outside Both mode or while a run is on"** — `Enabled` / `Disabled` write `bothModeSharedSession: true` / `false`; with `legs: ['speaker']` both are disabled; with `disabled` both are disabled.
    14. **"an own key reads the own-key region tooltip and no managed cost note"** — the recorded tooltip contents include the `settings.sonioxRegionTooltipOwnKey` fallback sentence; no text `'Kizuna AI supports both.'…` is rendered.
    15. **"a managed view reads the managed region tooltip and states the cost of split (Plan B's seam)"** — `const Managed = createSonioxSettingsView({ managed: true, useVoiceSource: () => null })` → the `settings.sonioxRegionTooltip` fallback among the tooltips, and the `settings.sonioxSharedSessionManagedCost` fallback rendered.
    16. **"hands the voice library the host's preview route"** — the `SonioxVoiceSection` mock renders `<Probe />`, where `function Probe() { seenPort.push(useContext(VoicePreviewContext)); return null; }`; with `preview: port` → `seenPort` ends with `port`; without → `null`.
- [ ] **Step 2: Run** `npx vitest run src/providers/soniox src/components/providers/fields` — FAIL: the components do not exist yet.
- [ ] **Step 3: Implement.**
  - `LinesField.tsx`:

    ```tsx
    import { CircleHelp } from 'lucide-react';
    import Tooltip from '../../Tooltip/Tooltip';

    /** A settings textarea's cap: the old Soniox fields' (`ProviderSpecificSettings.tsx:1841`). */
    export const LINES_FIELD_MAX = 4000;

    export interface LinesFieldProps {
      id: string;
      value: string;
      onChange(value: string): void;
      placeholder: string;
      disabled?: boolean;
      /** The row's label; absent, the section heading names the field and `ariaLabel` does for assistive tech. */
      label?: string;
      tooltip?: string;
      ariaLabel?: string;
      maxLength?: number;
    }

    /**
     * A multi-line text setting — one entry per line, or free text (F13): the
     * markup of the old Soniox vocabulary and background fields
     * (`ProviderSpecificSettings.tsx:1816-1892`), shared so a provider's own
     * settings compose it rather than copy it.
     */
    export function LinesField({ id, value, onChange, placeholder, disabled = false, label, tooltip, ariaLabel, maxLength = LINES_FIELD_MAX }: LinesFieldProps) {
      return (
        <div className="setting-item">
          {label !== undefined && (
            <div className="setting-label">
              <span>{label}</span>
              {tooltip !== undefined && (
                <Tooltip content={tooltip} position="top">
                  <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
                </Tooltip>
              )}
            </div>
          )}
          <textarea
            id={id}
            aria-label={ariaLabel ?? label}
            className="system-instructions"
            placeholder={placeholder}
            maxLength={maxLength}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        </div>
      );
    }
    ```

  - `SonioxVoiceField.tsx`:

    ```tsx
    import { useMemo } from 'react';
    import SonioxVoiceSection from '../../components/Settings/sections/SonioxVoiceSection';
    import { byokVoiceSource, type VoiceLibrarySource } from '../../components/Settings/sections/voiceLibrarySource';
    import type { ProviderAccount } from '../../lib/provider/types';
    import { asSonioxRegion, type SonioxRegion } from '../../lib/soniox/regions';
    import { sonioxKeyField, sonioxVoiceField, type SonioxSettings } from './settings';
    import { SonioxVoicesClient } from './voicesClient';

    /** Where the voice library's voices come from, as a hook so each flavour memoizes on its own inputs (choice 12). */
    export type VoiceSourceHook = (account: ProviderAccount | undefined, region: SonioxRegion) => VoiceLibrarySource | null;

    /** An own key: the region's project, straight from the device; none until that region's key is saved. One source per (key, region). */
    export const useByokVoiceSource: VoiceSourceHook = (account, region) => {
      const key = account?.credentials[sonioxKeyField(region)] ?? '';
      return useMemo(
        () => (key ? byokVoiceSource(new SonioxVoicesClient(key, region), { apiKey: key, region }) : null),
        [key, region],
      );
    };

    interface SonioxVoiceFieldProps {
      settings: SonioxSettings;
      update(patch: Partial<SonioxSettings>): void;
      disabled: boolean;
      /** The pair's target: what the preview speaks. */
      target: string;
      account?: ProviderAccount;
      managed: boolean;
      useVoiceSource: VoiceSourceHook;
    }

    /**
     * The voice library behind a thin wrapper (F13): today's `SonioxVoiceSection`,
     * unchanged, fed the active region's voice and key and writing the
     * region's own voice field (a clone is a UUID inside one project).
     */
    export function SonioxVoiceField({ settings, update, disabled, target, account, managed, useVoiceSource }: SonioxVoiceFieldProps) {
      const region = asSonioxRegion(settings.region);
      const field = sonioxVoiceField(region);
      const source = useVoiceSource(account, region);
      return (
        <SonioxVoiceSection
          settings={{ voice: settings[field], apiKey: account?.credentials[sonioxKeyField(region)] ?? '', targetLanguage: target, ttsSpeed: settings.ttsSpeed, region }}
          onUpdate={({ voice }) => update({ [field]: voice } as Partial<SonioxSettings>)}
          source={source}
          managed={managed}
          isSessionActive={disabled}
        />
      );
    }
    ```

  - `SonioxTurnDetection.tsx`: the Summary

    ```tsx
    /** One line, existing words only: the tuning's heading and the max pause (the knob users move). */
    export function SonioxTurnDetectionSummary({ settings }: SettingsProps<S>) {
      const { t } = useTranslation();
      return <>{`${t('settings.sonioxEndpointTuning', 'Endpoint Detection Tuning')} · ${t('settings.sonioxEndpointMaxDelay', 'Max Pause Before Finalizing')}: ${settings.endpointMaxDelayMs} ms`}</>;
    }
    ```

    and `SonioxTurnDetectionControls({ settings, update, disabled = false }: SettingsProps<S>)`, which returns the old `#soniox-endpoint-section` block (`ProviderSpecificSettings.tsx:1894-1966`) as it is, with three substitutions: `activeSonioxSettings` → `settings`, `updateActiveSonioxSettings(…)` → `update(…)`, `isSessionActive` → `disabled`. Its three controls keep their ids (`soniox-endpoint-sensitivity`, `soniox-endpoint-max-delay`, `soniox-endpoint-latency-level`), `aria-label`s, ranges, the `parseFloat` / `parseInt(…, 10)` writes and the four `0 — Default` … `3 — Most aggressive` options. No `Help`: the section's summary links to these controls, whose own tooltips explain each knob.
  - `SonioxSettings.tsx`:

    ```tsx
    import type { ComponentType } from 'react';
    import { CircleHelp } from 'lucide-react';
    import { useTranslation } from 'react-i18next';
    import { TtsSpeedControl } from '../../components/Settings/sections/LocalSettingsControls';
    import { LinesField } from '../../components/providers/fields/LinesField';
    import { VoicePreviewContext } from '../../components/providers/VoicePreviewContext';
    import Tooltip from '../../components/Tooltip/Tooltip';
    import type { SettingsProps } from '../../lib/provider/types';
    import { asSonioxRegion, SONIOX_REGION_LABELS, SONIOX_REGIONS } from '../../lib/soniox/regions';
    import { SonioxVoiceField, useByokVoiceSource, type VoiceSourceHook } from './SonioxVoiceField';
    import type { SonioxSettings as S } from './settings';

    const helpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />;

    export interface SonioxSettingsFlavour {
      /** Kizuna Soniox (Plan B): the managed copy — the region tooltip, the split's cost note, the voice library's variant. */
      managed: boolean;
      useVoiceSource: VoiceSourceHook;
    }

    /**
     * Soniox's own settings (D18), today's `renderSonioxSettings`
     * (`ProviderSpecificSettings.tsx:1721-2019`) recomposed from shared
     * fields: region, the voice library (previewing through the host's route,
     * ruling 6), TTS speed, vocabulary, background, and Both mode's
     * shared-session choice. The endpoint knobs are its `TurnDetection`. A
     * factory, so the managed twin reuses it with its own voice source (choice 12).
     */
    export function createSonioxSettingsView({ managed, useVoiceSource }: SonioxSettingsFlavour): ComponentType<SettingsProps<S>> {
      return function SonioxSettingsView({ settings, update, disabled = false, pair, account, legs, preview }: SettingsProps<S>) {
        const { t } = useTranslation();
        const region = asSonioxRegion(settings.region);
        const inBoth = legs?.length === 2;
        const shared = settings.bothModeSharedSession;
        return (
          <VoicePreviewContext.Provider value={preview ?? null}>
            <div className="settings-section" id="soniox-region-section">
              <h2>
                {t('settings.sonioxRegion', 'Region')}
                <Tooltip
                  content={managed
                    ? t('settings.sonioxRegionTooltip', 'Soniox runs a separate deployment per region. Your audio is processed in the region you pick. Applies from the next session.')
                    : t('settings.sonioxRegionTooltipOwnKey', 'Soniox runs a separate deployment per region, and each one is a separate Soniox project with its own API key. Your audio is processed in the region you pick. Applies from the next session.')}
                  position="top"
                >
                  {helpIcon}
                </Tooltip>
              </h2>
              <div className="setting-item">
                <select
                  id="soniox-region-select"
                  className="select-dropdown"
                  aria-label={t('settings.sonioxRegion', 'Region')}
                  value={region}
                  disabled={disabled}
                  onChange={(e) => update({ region: asSonioxRegion(e.target.value) })}
                >
                  {SONIOX_REGIONS.map((r) => <option key={r} value={r}>{SONIOX_REGION_LABELS[r]}</option>)}
                </select>
              </div>
            </div>

            <SonioxVoiceField settings={settings} update={update} disabled={disabled} target={pair?.target ?? 'en'} account={account} managed={managed} useVoiceSource={useVoiceSource} />

            <TtsSpeedControl value={settings.ttsSpeed} onChange={(ttsSpeed) => update({ ttsSpeed })} disabled={disabled} min={0.7} max={1.3} step={0.05} />

            <div className="settings-section" id="soniox-vocabulary-section">
              <h2>
                {t('settings.sonioxVocabulary', 'Custom Vocabulary')}
                <Tooltip content={t('settings.sonioxVocabularyTooltip', 'Bias recognition toward important names and jargon, and steer how specific terms are translated. Applies from the next session.')} position="top">{helpIcon}</Tooltip>
              </h2>
              <LinesField
                id="soniox-vocabulary-terms"
                label={t('settings.sonioxVocabularyTerms', 'Terms')}
                tooltip={t('settings.sonioxVocabularyTermsTooltip', 'Improves recognition of uncommon words — names, jargon, product names.')}
                placeholder={t('settings.sonioxVocabularyTermsPlaceholder', 'One term per line')}
                value={settings.vocabularyTerms}
                onChange={(vocabularyTerms) => update({ vocabularyTerms })}
                disabled={disabled}
              />
              <LinesField
                id="soniox-vocabulary-translations"
                label={t('settings.sonioxVocabularyTranslations', 'Preferred Translations')}
                tooltip={t('settings.sonioxVocabularyTranslationsTooltip', "Biases how specific terms are translated — a preference, not a guaranteed replacement: names with an established rendering work best, while common words may keep the model's own wording. Entries are directional; the reverse direction only exists in Both mode, where you can add a reverse line.")}
                placeholder={t('settings.sonioxVocabularyTranslationsPlaceholder', 'One source=target per line')}
                value={settings.vocabularyTranslations}
                onChange={(vocabularyTranslations) => update({ vocabularyTranslations })}
                disabled={disabled}
              />
            </div>

            <div className="settings-section" id="soniox-background-section">
              <h2>
                {t('settings.sonioxBackground', 'Session Background')}
                <Tooltip content={t('settings.sonioxBackgroundTooltip', 'Free-form background for the next session — agenda, topic, or reference notes. Helps recognition and translation follow the domain. Trimmed first if the combined context exceeds the size limit.')} position="top">{helpIcon}</Tooltip>
              </h2>
              <LinesField
                id="soniox-context-text"
                ariaLabel={t('settings.sonioxBackground', 'Session Background')}
                placeholder={t('settings.sonioxBackgroundPlaceholder', 'Paste an agenda, topic, or background notes (optional)')}
                value={settings.contextText}
                onChange={(contextText) => update({ contextText })}
                disabled={disabled}
              />
            </div>

            <div className="settings-section" id="soniox-settings-section">
              <h2>
                {t('settings.sonioxSharedSession', 'Shared session in Both mode')}
                <Tooltip content={t('settings.sonioxSharedSessionTooltip', 'Both mode can run on one shared Soniox session or a separate session per direction.\n\nEnabled: a single session translates both sides with automatic speaker separation — lower cost and latency.\n\nDisabled: a separate session per direction — more reliable when both people talk at once, but about twice the cost.\n\nOnly affects Both mode.')} position="top">{helpIcon}</Tooltip>
              </h2>
              <div className="setting-item">
                <div className="turn-detection-options">
                  {/* Only Both mode shares a session: outside it the choice is shown, inert (the old lock, `ProviderSpecificSettings.tsx:1741`). */}
                  <button type="button" className={`option-button ${shared ? 'active' : ''}`} onClick={() => update({ bothModeSharedSession: true })} disabled={disabled || !inBoth}>
                    {t('settings.enabled', 'Enabled')}
                  </button>
                  <button type="button" className={`option-button ${!shared ? 'active' : ''}`} onClick={() => update({ bothModeSharedSession: false })} disabled={disabled || !inBoth}>
                    {t('settings.disabled', 'Disabled')}
                  </button>
                </div>
              </div>
              {managed && (
                <div className="setting-item">
                  <div className="setting-description">
                    {t('settings.sonioxSharedSessionManagedCost', 'Kizuna AI supports both. Disabled runs two sessions at once — about twice the cost per minute, so your session allowance runs out in about half the time and a higher balance is needed to start.')}
                  </div>
                </div>
              )}
            </div>
          </VoicePreviewContext.Provider>
        );
      };
    }

    /** An own key's settings. */
    export const SonioxSettingsView = createSonioxSettingsView({ managed: false, useVoiceSource: useByokVoiceSource });
    ```

- [ ] **Step 4: Run** the Step 2 command, then `npx vitest run src/components/Settings src/components/providers src/providers`, the full suite and the gate. Nothing outside this task renders the new components yet (Task 11 registers them); `SonioxVoiceSection.test.tsx` renders the section itself, unchanged.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/soniox/SonioxSettings.tsx src/providers/soniox/SonioxSettings.test.tsx src/providers/soniox/SonioxVoiceField.tsx src/providers/soniox/SonioxVoiceField.test.tsx src/providers/soniox/SonioxTurnDetection.tsx src/providers/soniox/SonioxTurnDetection.test.tsx src/components/providers/fields/LinesField.tsx src/components/providers/fields/LinesField.test.tsx
  ```

  ```bash
  git commit -q -F - -- src/providers/soniox/SonioxSettings.tsx src/providers/soniox/SonioxSettings.test.tsx src/providers/soniox/SonioxVoiceField.tsx src/providers/soniox/SonioxVoiceField.test.tsx src/providers/soniox/SonioxTurnDetection.tsx src/providers/soniox/SonioxTurnDetection.test.tsx src/components/providers/fields/LinesField.tsx src/components/providers/fields/LinesField.test.tsx <<'EOF'
  feat(soniox): its own settings, composed from shared fields

  Region, the voice library behind a thin wrapper (previewing through the
  host's route), TTS speed, vocabulary, background and Both mode's
  shared-session choice, composed from shared fields (LinesField,
  TtsSpeedControl); the endpoint knobs are its turn detection. A factory,
  so the managed twin can reuse it with its own voice source.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Group check A (controller)

After Wave 5 (Tasks 1–9, 10a and 10b). The adapter and Soniox's settings are complete but not registered: no user path reaches them yet.

1. The full gates: `npx vitest run src` (0 failed, no unhandled errors) and the typecheck gate (the 18 baseline lines).
2. The old Soniox and voice-library suites by name: `npx vitest run src/services src/components/Settings` — green (ruling 1, and Task 10a's additive `VoiceLibrarySection` edit).
3. Both release builds; `npx vitest run extension`; the two D24 greps print nothing.
4. The full tree's typecheck — `npx tsc --noEmit -p tsconfig.json` written to `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/soniox-groupA-tsc.txt`, its lines counted with `command grep -c 'error TS'` — is at most 259: the 279 of `c91a3020` less the 20 Task 1 fixed. A rise means something outside the gate's regex broke (an old importer of a moved module).
5. **`late-ranges` in the preview** (Task 3): `/?preview=spine&panel=1&script=late-ranges` on a fresh vite, Start, two screenshots through `scripts/dev/headless.mjs` — one at ~1.2 s (the translation row drawn and final, nothing highlighted) and one at ~1.5 s (highlighted part-way, then advancing). Then every existing spine probe and `app-panel-probe` (preview, `--settings`) — green.

---

### Task 11: Soniox's definition, in the registry; the provider-neutral Speech tooltip (rulings 7, 8)

**Files:**
- Create: `src/providers/soniox/provider.ts`, `src/providers/soniox/provider.test.ts`.
- Modify: `src/providers/registry.ts`, `src/providers/registry.test.ts`, `src/components/Settings/sections/SpeechSection.tsx`, `src/components/Settings/sections/SpeechSection.test.tsx`, and the 30 `src/locales/<code>/translation.json`.

**Interfaces:**
- **Consumes:** everything Tasks 5, 8, 9, 10a and 10b produce.
- **Produces:** `sonioxProvider: Provider<SonioxSettings, SonioxCredentials, SonioxConfig> & { id: 'soniox' }`; `ProviderId` gains `'soniox'`; the keys `settings.speechModeTooltip` and `settings.speechModeAppliesToAuto`.
- **Consumed by:** Task 12 (the wizard lists own-key providers from the registry); the app's picker, Settings, readiness driver and runner — generic code that now offers Soniox.

- [ ] **Step 1: Write the failing tests.**
  - `provider.test.ts`:
    1. **"is Soniox with the user's own key, on every platform, not flagged, under the old enum's id and slice"** — `sonioxProvider` matches `{ id: 'soniox', kind: 'own-key', platforms: ['electron', 'extension', 'web'], guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/soniox-setup' }`; `flagged` and `i18nKey` are `undefined`; `settings.key` is `'soniox'`, `settings.defaults` is `SONIOX_DEFAULTS`, `settings.migrate` is `migrateSonioxSettings`.
    2. **"speaks optionally, takes no typed text, keeps the provider's boundaries, and offers both turn modes"** — `speech: 'optional'`, `textInput: false`, `boundaries(SONIOX_DEFAULTS)` `'provider'`, `turns(SONIOX_DEFAULTS)` `['auto', 'manual']`.
    3. **"its components, check, builder and adapter are Soniox's own"** — `Settings` is `SonioxSettingsView`; `TurnDetection` is `{ Summary: SonioxTurnDetectionSummary, Controls: SonioxTurnDetectionControls }` (no `Help`); `credentials` is `sonioxCredentials`; `languages` is `sonioxLanguages`; `build` is `buildSoniox`; `describe` is `describeSoniox`; `start` and `session.startBoth` are functions; `session` has no `prepare`, `admit` or `acquire`.
    4. **"the gate refuses Both on an auto source, and lets manual turns through (D20, ruling 5)"** — `gate({ provider: sonioxProvider, settings: SONIOX_DEFAULTS, pair: { source: 'auto', target: 'en' }, legs: ['speaker', 'participant'], turnMode: 'auto' }, 'electron')` has `code: 'participant_unsupported'`; `{ source: 'ja', target: 'en' }` → `null`; `legs: ['speaker'], turnMode: 'push-to-talk'` → `null`.
    5. **"its start refuses a cancelled request before opening any socket"** — `vi.stubGlobal('WebSocket', vi.fn())`; `sonioxProvider.start({ …, signal: AbortSignal.abort(new Error('cancelled')) }, recordEvents().events)` rejects `/cancelled/` and `WebSocket` was never constructed (then `vi.unstubAllGlobals()`).
  - `registry.test.ts`, "the release offers its providers in the owner's order" (`:197-203`): `toEqual(['localInference', 'soniox'])`, its comment naming ruling 7 (after LocalInference, not flagged; the owner decides the final order before Kizuna Soniox). Every invariant in `describe('the invariants every provider meets (F17)')` now runs over Soniox too — the old enum id and slice, the `en` name and description (`providers.soniox`), the credential label and placeholder (`setup.credentials.apiKey`, `providers.soniox.apiKeyPlaceholder`), an empty own key read as missing, `migrate(defaults) = defaults`, the initial pair `auto → en` offered.
  - `SpeechSection.test.tsx`, in the Speech section's describe:
    6. **"the Speech mode's tooltip names no mechanism: the provider's detection, for your voice and the other side's"** — after rendering, `tooltipContents` holds a string containing `'Auto: the provider detects when you have finished speaking.'` and `"Other's audio always uses the provider's automatic detection."`, and no content contains `'semantic VAD'` or `'local Voice Activity Detection'`.
- [ ] **Step 2: Run** `npx vitest run src/providers src/components/Settings/sections/SpeechSection.test.tsx` — FAIL.
- [ ] **Step 3: Implement.**
  - `provider.ts`:

    ```ts
    import { SonioxIcon } from '../../components/Icons/ProviderIcons';
    import type { Provider } from '../../lib/provider/types';
    import { createSonioxAdapter } from './adapter';
    import { checkSoniox } from './check';
    import { buildSoniox, describeSoniox, type SonioxConfig } from './config';
    import { SonioxSettingsView } from './SonioxSettings';
    import { SonioxTurnDetectionControls, SonioxTurnDetectionSummary } from './SonioxTurnDetection';
    import { migrateSonioxSettings, SONIOX_DEFAULTS, sonioxCredentials, sonioxLanguages, type SonioxCredentials, type SonioxSettings } from './settings';

    const adapter = createSonioxAdapter();

    /**
     * Soniox with the user's own key (survey §2.1): real-time STT and
     * translation on one socket, its own TTS on a second, both legs on one
     * mixed socket in Both mode (D23). The old enum's id and slice (controller
     * ruling 2), so a stored selection and settings carry over. Released,
     * after LocalInference, not flagged (ruling 7). The extension manifest
     * already lists its twelve origins (survey §2.1): no manifest change.
     */
    export const sonioxProvider: Provider<SonioxSettings, SonioxCredentials, SonioxConfig> & { id: 'soniox' } = {
      id: 'soniox',
      kind: 'own-key',
      platforms: ['electron', 'extension', 'web'],
      icon: SonioxIcon,
      // Today's TUTORIAL_URLS value, as a literal (LocalInference's rule: no import from src/services).
      guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/soniox-setup',

      settings: { key: 'soniox', defaults: SONIOX_DEFAULTS, migrate: migrateSonioxSettings },
      Settings: SonioxSettingsView,
      // The endpoint knobs: summarized in the Speech section under Auto, drawn on Advanced's Provider tab.
      TurnDetection: { Summary: SonioxTurnDetectionSummary, Controls: SonioxTurnDetectionControls },

      credentials: sonioxCredentials,
      check: (k, s, ctx) => checkSoniox(k, s, ctx),

      languages: sonioxLanguages,

      speech: 'optional',
      // Soniox's STT socket takes no text.
      textInput: false,
      // The server's endpoint model ends a segment (`<end>`, `<fin>`).
      boundaries: () => 'provider',
      turns: () => ['auto', 'manual'],

      build: buildSoniox,
      describe: describeSoniox,
      start: adapter.start,

      session: { startBoth: adapter.startBoth },
    };
    ```

  - `registry.ts`: `import { sonioxProvider } from './soniox/provider';` and `const RELEASED = [localInferenceProvider, sonioxProvider] as const;`, its comment adding "then Soniox (Stage 2 Soniox, ruling 7)".
  - `SpeechSection.tsx`: the tooltip becomes

    ```ts
    const tooltip = `${t('settings.speechModeTooltip', 'Auto: the provider detects when you have finished speaking. \nPush-to-Talk: hold Space or the mic button to send audio manually. \nPush-to-Translate: like Push-to-Talk, but routes your raw mic to the virtual mic when idle so you can speak directly without translation.')}\n\n${t('settings.speechModeAppliesToAuto', "Applies to your voice. Other's audio always uses the provider's automatic detection.")}`;
    ```

    and the component's doc comment drops "today's local-VAD tooltip … lands with Stage 2's second provider" for "its tooltip is provider-neutral (Stage 2 Soniox, ruling 8): what ends an utterance under Auto is each provider's own detection, summarized below".
  - **The locales** (ruling 8). In each of the 30 `src/locales/<code>/translation.json`, insert two lines right after the `"speechModeAppliesTo"` line of `settings` — insert lines; never re-serialize a file:
    - `en`:

      ```json
          "speechModeTooltip": "Auto: the provider detects when you have finished speaking. \nPush-to-Talk: hold Space or the mic button to send audio manually. \nPush-to-Translate: like Push-to-Talk, but routes your raw mic to the virtual mic when idle so you can speak directly without translation.",
          "speechModeAppliesToAuto": "Applies to your voice. Other's audio always uses the provider's automatic detection.",
      ```

    - every other locale derives both from its own existing sentences, so the push-to-talk lines stay word for word what it already shows:
      - `speechModeTooltip`: that locale's `settings.localInferenceTurnDetectionTooltip` with only its first line (the Auto line) replaced by a translation of "Auto: the provider detects when you have finished speaking." — the line keeps that locale's own "Auto" label, colon and spacing, and its trailing space before `\n` where it has one;
      - `speechModeAppliesToAuto`: that locale's `settings.speechModeAppliesTo` with only its second sentence replaced by a translation of "Other's audio always uses the provider's automatic detection." — "provider" in the locale's own word for it (its `settings.…provider` label: `プロバイダー`, `提供商`, `제공자`, …).
    - Four written out, as the pattern:

      | Locale | `speechModeTooltip`'s first line | `speechModeAppliesToAuto` |
      |---|---|---|
      | `ja` | `自動：話し終わりをプロバイダーが自動的に検出します。` | `あなたの声に適用されます。相手の音声は常にプロバイダーの自動検出を使用します。` |
      | `zh_CN` | `自动：由提供商自动检测您何时说完。` | `适用于您的语音。对方音频始终使用提供商的自动检测。` |
      | `zh_TW` | `自動：由提供商自動偵測您何時說完。` | `適用於您的語音。對方音訊始終使用提供商的自動偵測。` |
      | `ko` | `자동: 말이 끝나는 시점을 제공자가 자동으로 감지합니다. ` | `내 음성에 적용됩니다. 상대방 오디오는 항상 제공자의 자동 감지를 사용합니다.` |

    The implementer lists the 29 non-`en` values of both keys in the report, for the native-speaker spot check Task 13 records.
- [ ] **Step 4: Run** `npx vitest run src/providers src/components/Settings src/locales src/lib/view src/app`, then the full suite and the gate. `locales.consistency.test.ts` holds every catalog to `en`'s keys, placeholders (neither key has one) and no empty string. What else Soniox's registration reaches, and why it stays green:
  - `ProviderPicker.test.tsx`, `ProviderPanel.test.tsx`, `SpinePreview.test.tsx`, `app/session.test.ts` and the readiness tests pass their own provider lists or select a provider explicitly; where a test asserts the whole present list, it is `registry.test.ts`, updated above.
  - `appShape.test.ts`, `subtitle/appSession.test.ts`: they set `selected` and `entries` themselves.
  - `selectionFromStored` now keeps a stored `'soniox'` (a stated departure): `loadStores.test.ts` seeds its own stored values.
  - If a test outside this Files list asserts the release list or counts present providers, stop and report it (Global Constraints).
- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/soniox/provider.ts src/providers/soniox/provider.test.ts src/providers/registry.ts src/providers/registry.test.ts src/components/Settings/sections/SpeechSection.tsx src/components/Settings/sections/SpeechSection.test.tsx src/locales/ar/translation.json src/locales/bn/translation.json src/locales/de/translation.json src/locales/en/translation.json src/locales/es/translation.json src/locales/fa/translation.json src/locales/fi/translation.json src/locales/fil/translation.json src/locales/fr/translation.json src/locales/he/translation.json src/locales/hi/translation.json src/locales/id/translation.json src/locales/it/translation.json src/locales/ja/translation.json src/locales/ko/translation.json src/locales/ms/translation.json src/locales/nl/translation.json src/locales/pl/translation.json src/locales/pt_BR/translation.json src/locales/pt_PT/translation.json src/locales/ru/translation.json src/locales/sv/translation.json src/locales/ta/translation.json src/locales/te/translation.json src/locales/th/translation.json src/locales/tr/translation.json src/locales/uk/translation.json src/locales/vi/translation.json src/locales/zh_CN/translation.json src/locales/zh_TW/translation.json
  ```

  ```bash
  git commit -q -F - -- src/providers/soniox/provider.ts src/providers/soniox/provider.test.ts src/providers/registry.ts src/providers/registry.test.ts src/components/Settings/sections/SpeechSection.tsx src/components/Settings/sections/SpeechSection.test.tsx src/locales/ar/translation.json src/locales/bn/translation.json src/locales/de/translation.json src/locales/en/translation.json src/locales/es/translation.json src/locales/fa/translation.json src/locales/fi/translation.json src/locales/fil/translation.json src/locales/fr/translation.json src/locales/he/translation.json src/locales/hi/translation.json src/locales/id/translation.json src/locales/it/translation.json src/locales/ja/translation.json src/locales/ko/translation.json src/locales/ms/translation.json src/locales/nl/translation.json src/locales/pl/translation.json src/locales/pt_BR/translation.json src/locales/pt_PT/translation.json src/locales/ru/translation.json src/locales/sv/translation.json src/locales/ta/translation.json src/locales/te/translation.json src/locales/th/translation.json src/locales/tr/translation.json src/locales/uk/translation.json src/locales/vi/translation.json src/locales/zh_CN/translation.json src/locales/zh_TW/translation.json <<'EOF'
  feat(soniox): Soniox with your own key joins the registry; the Speech tooltip names no mechanism

  The definition wires Soniox's settings, credentials, check, languages,
  builder and adapter, both legs included; the registry releases it after
  LocalInference, unflagged. The Speech mode's tooltip says the provider
  detects the end of speech — true for every provider now — in two new
  keys translated into all 30 catalogs from each one's own sentences.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Task 12: The wizard's own-key path, from the registry (F12; ruling 9)

A separable task group: Soniox is usable from Settings without it, and it can move to a plan of its own if the owner prefers.

**Files:**
- Modify: `src/components/SetupWizard/providerPaths.ts`, `providerPaths.test.ts`, `steps/StepProviderPath.tsx`, `steps/StepCredentials.tsx`, `steps/StepCredentials.test.tsx`, `steps/StepLanguagePair.tsx`, `steps/StepFinish.tsx`, `SetupWizard.tsx`, `SetupWizard.test.tsx`.

**Interfaces:**
- **Consumes:** `presentProviders` (the registry, Soniox in it since Task 11); `providerIdFromStored`, `storedProviderValue`; `readCredentials`, `isMissing`; `noticeText`; `legsFor` (`src/lib/session/appShape.ts`).
- **Produces** (`providerPaths.ts`): `textOnlyCapabilityOf(p: Pick<AnyProvider, 'speech'>): 'always' | 'optional' | 'never'`; `wizardProvider(id: string | null | undefined): AnyProvider | undefined`; `availablePaths()`, `ownKeyOptions(scenario)`, `providerFits(provider, scenario)` read the registry. `managedProvider()` and `managedOption()` keep the old factory: the managed path is Plan B's.
- **Consumed by:** the wizard's steps; Plan B (the managed path).

- [ ] **Step 1: Write the failing tests.**
  - **The existing cases this task replaces** (the review's M10), named so none is left asserting the old factory's world:
    - `providerPaths.test.ts` "offers the offline path only, whatever is registered" (`:20`) → **replaced by case 1**; "own-key lists every user-managed provider in registration order, never managed or local ones" (`:25`) → **replaced by case 2**; "marks providers that cannot serve the scenario instead of hiding them" (`:33`: Palabra and OpenAI Translate are no longer listed) → **replaced by case 3**; "providerFits answers for any provider, including managed and local ones" (`:44`) → **replaced by case 4** — `providerFits` of a managed id (`KIZUNA_AI_SONIOX`) and of `LOCAL_NATIVE` now answers `false`, as for any id this build does not register. `StepScenario.tsx:49` reads `providerFits`, which matters only once Plan B offers the managed path again (recorded for Plan B). The `offersRecord` "refuses an own-key record — no own-key card until Stage 2" case → **renamed and re-pointed by case 5**. "offline offers only the in-app engine …" stays as it is.
    - `SetupWizard.test.tsx` "starts blank from an own-key record — the card is gone until Stage 2" → **renamed by case 12**. Its two offline cases that compute expectations from the old descriptor (`:192`, `:210-211`: `ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE).resolveSourceLanguages()` / `resolveTargetLanguages`) stay as they are and stay green: the steps now read `localInferenceProvider.languages`, whose names come from the same manifest, so the option lists match. If one does not, stop and report it (Global Constraints).
  - `providerPaths.test.ts` — the file's environment mock stays (the managed functions still read the old factory):
    1. **"offers the own-key path beside the offline one once an own-key provider is registered"** — `availablePaths()` is `['own-key', 'offline']`; `managedProvider()` is still `Provider.KIZUNA_AI_SONIOX` (unchanged, Plan B's).
    2. **"lists the registered own-key providers in registry order, in the old enum's spelling"** — `ownKeyOptions('understand-others').map((o) => o.id)` is `['soniox', 'fake']` (the fake: own-key, development builds only).
    3. **"judges a provider's fit from its speech"** — `textOnlyCapabilityOf({ speech: 'always' })` is `'never'`, `'never'` → `'always'`, `'optional'` → `'optional'`; `ownKeyOptions('subtitle-myself')`'s Soniox entry is `{ ok: true }`.
    4. **"providerFits answers for a registered provider, and no for one this build lacks"** — `providerFits(Provider.SONIOX, 'subtitle-myself')` and `providerFits(Provider.LOCAL_INFERENCE, 'two-way-voice')` are `true`; `providerFits(Provider.OPENAI, 'be-heard')` is `false`.
    5. `offersRecord`: **"offers an own-key record for Soniox"** — `{ scenario: 'be-heard', providerPath: 'own-key', provider: 'soniox' }` → `true`; the existing "refuses an own-key record — no own-key card until Stage 2" becomes **"refuses an own-key record for a provider this build does not register"** (`openai` → `false`); the offline, managed and null cases stay.
    6. **"wizardProvider reads a draft's old spelling"** — `wizardProvider('local_inference')?.id` is `'localInference'`; `wizardProvider('soniox')?.id` is `'soniox'`; `wizardProvider('openai')` and `wizardProvider(null)` are `undefined`.
  - `StepCredentials.test.tsx`, the own-key describe: every existing case keeps its name and assertion, its seeding moved from the old slice mock to the provider store — `beforeEach` sets `useProviderStore.setState({ entries: { soniox: { settings: { ...SONIOX_DEFAULTS, region }, credentials: { apiKey, apiKeyEu: '', apiKeyJp: '' }, pair: { source: 'ja', target: 'en' } } }, readiness: {} })` (`region: 'jp'` for the JP case, `apiKey: 'sk-saved'` where the old case set it in `sliceState`); `ownKeyDraft` gains `scenario: 'be-heard'`. The managed describe is unchanged. New cases, with `vi.spyOn(sonioxProvider, 'check')` (restored in `afterEach`):
    7. **"Validate runs the provider's own check over the draft's key, and validates on a ready answer"** — draft `credentials: { apiKey: 'sk-typed' }`; `check` resolves `{ ok: true }`; click `setup.credentials.validate` → `check` called with `{ region: 'us', stt: 'sk-typed', tts: 'sk-typed' }`, the entry's settings, and `expect.objectContaining({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'], signal: expect.any(AbortSignal) })`; `dispatch` got `{ type: 'credentialsValidated' }`; `setup.credentials.valid` shown.
    8. **"a refusal shows the provider's words, and validates nothing"** — `check` resolves `{ ok: false, code: 'auth', reason: 'HTTP 401' }` → `notices.auth` shown; no `credentialsValidated`.
    9. **"a check that could not find out says why"** — `check` rejects `new Error('Soniox did not answer the key check within 15 s.')` → that sentence shown; no `credentialsValidated`.
    10. **"writes nothing: the saved key and the provider's readiness are untouched"** — after case 7's flow, `useProviderStore.getState().entries.soniox.credentials.apiKey` is `''` and `readiness.soniox` is `undefined`.
  - `SetupWizard.test.tsx`:
    11. **"walks the own-key path with Soniox to Finish"** — `vi.spyOn(sonioxProvider, 'check').mockResolvedValue({ ok: true })`, and the provider store's `soniox` entry seeded as `StepCredentials.test.tsx` seeds it (so the step does not wait on a storage load); the language step, `Be understood in a meeting`, `next()`, the radio `I have my own API key`, the radio named `soniox` (the name reads `providers.soniox.name`'s default in this file's `t` mock), `next()`; `await` the key field (labelled `apiKey`), type `sk-test`, click `Validate`, `await` `Next` enabled, `next()`; the pair step, `next()`; `Finish` → `applied[0]` matches `{ providerPath: 'own-key', provider: 'soniox', credentials: { apiKey: 'sk-test' }, credentialsPending: false }`.
    12. "starts blank from an own-key record — the card is gone until Stage 2" becomes **"starts blank from an own-key record whose provider this build does not register"** (its `openai` record and assertions unchanged).
- [ ] **Step 2: Run** `npx vitest run src/components/SetupWizard` — FAIL.
- [ ] **Step 3: Implement.**
  - `providerPaths.ts`: drop the `OFFLINE_PROVIDERS` and `isKizunaManagedProvider` imports (unused now); add

    ```ts
    import type { AnyProvider } from '../../lib/provider/types';
    import { providerIdFromStored, storedProviderValue } from '../../lib/session/storedSettings';
    import { presentProviders } from '../../providers/registry';

    /** A definition's speech as the old descriptor's `textOnlyCapability`: the word the scenario fit and the pair sentence read. */
    export function textOnlyCapabilityOf(p: Pick<AnyProvider, 'speech'>): 'always' | 'optional' | 'never' {
      return p.speech === 'always' ? 'never' : p.speech === 'never' ? 'always' : 'optional';
    }

    /** The registered provider a draft names — drafts and records keep the old enum's spelling — or undefined. */
    export function wizardProvider(id: string | null | undefined): AnyProvider | undefined {
      const registryId = providerIdFromStored(id);
      return registryId === null ? undefined : presentProviders().find((p) => p.id === registryId);
    }
    ```

    and replace three functions:

    ```ts
    /** The paths the wizard offers: own key once an own-key provider is registered (Soniox, Stage 2), and offline. Managed returns with Kizuna Soniox. */
    export function availablePaths(): ProviderPath[] {
      return presentProviders().some((p) => p.kind === 'own-key') ? ['own-key', 'offline'] : ['offline'];
    }

    export function providerFits(provider: ProviderType, scenario: ScenarioId): boolean {
      const p = wizardProvider(provider);
      return p !== undefined && providerFitForScenario(textOnlyCapabilityOf(p), getScenario(scenario)).ok;
    }

    /** The registry's own-key providers, in its order, each with its fit for the scenario — unfit ones greyed with the reason, never hidden. */
    export function ownKeyOptions(scenario: ScenarioId): ProviderOption[] {
      const preset = getScenario(scenario);
      return presentProviders()
        .filter((p) => p.kind === 'own-key')
        .map((p) => ({ id: storedProviderValue(p.id) as ProviderType, fit: providerFitForScenario(textOnlyCapabilityOf(p), preset) }));
    }
    ```

    and the file's header comment says the own-key and offline lists read the registry, the managed one still the old factory until Kizuna Soniox.
  - `StepProviderPath.tsx`: `nameOf` reads the definition, and the `ProviderConfigFactory` import goes:

    ```ts
    const nameOf = (id: ProviderType) => {
      const p = wizardProvider(id);
      const key = p?.i18nKey ?? p?.id ?? id;
      return t(`providers.${key}.name`, key);
    };
    ```

  - `StepCredentials.tsx`: the own-key branch becomes its own component (so its hooks sit above no early return), fed by the definition. What goes, so the file adds no gate line (`noUnusedLocals`; the review's I2): the `ProviderConfigFactory` and `TUTORIAL_URLS` imports; `useSettingsStore` from the `settingsStore` import (`:8`, which keeps `useSetAuthOverlay` for the managed branch); the whole `import type { SettingsStore }` line (`:9`); and `getToken` from `const { isSignedIn, getToken } = useAuth();` (`:19` becomes `const { isSignedIn } = useAuth();` — the old own-key validation, `:108`, was its only reader). The markup — `FormInput` per field, the `Validate` and `Skip for now` buttons, `StatusMessage` — stays the wizard's own, so the step still looks like its sibling steps (choice 11):

    ```tsx
    /** The own-key path (F12): the chosen provider's credential fields and its own check over the draft's values, written only at Finish (choice 11). */
    const OwnKeyCredentials: React.FC<Props & { skipButton(keepExisting: boolean): React.ReactNode }> = ({ draft, dispatch, skipButton }) => {
      const { t } = useTranslation();
      const auth = useAuthContext();
      const p = wizardProvider(draft.provider);
      const entry = useProviderStore((s) => (p ? s.entries[p.id] : undefined));
      const [validating, setValidating] = useState(false);
      const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
      const inFlight = useRef<AbortController | null>(null);
      useEffect(() => { if (p && !entry) void useProviderStore.getState().load(p); }, [p, entry]);
      useEffect(() => () => inFlight.current?.abort(), []);
      if (!p || !entry) return <section className="setup-step"><h2>{t('setup.steps.credentials.ownKeyTitle', 'Your API key')}</h2></section>;

      const saved = entry.credentials;
      const fields = p.credentials.fields(entry.settings);
      // As before, over the saved values instead of the old slice (the re-run's rules, feedback 2026-08-25).
      const keyOnFile = draft.credentialsValidated && fields.some((f) => !draft.credentials[f.key] && !saved[f.key]);
      const keptOnSkip = draft.credentialsValidated && fields.length > 0 && fields.every((f) => !!saved[f.key]);

      const validate = async () => {
        inFlight.current?.abort();
        const mine = new AbortController();
        inFlight.current = mine;
        setMessage(null);
        // The draft overlays what is saved; nothing is written.
        const credentials = readCredentials(p, entry.settings, { ...saved, ...draft.credentials }, auth);
        if (isMissing(credentials)) {
          setMessage({ ok: false, text: noticeText(t, { code: credentials.code ?? 'credentials_missing', params: credentials.params, message: credentials.missing }) });
          return;
        }
        setValidating(true);
        try {
          const legs = legsFor(getScenario(draft.scenario!).mode);
          const result = await p.check(credentials, entry.settings, { pair: entry.pair, legs, signal: mine.signal });
          if (mine.signal.aborted) return;
          if (result.ok) {
            dispatch({ type: 'credentialsValidated' });
            setMessage({ ok: true, text: t('setup.credentials.valid', 'Key accepted.') });
          } else {
            setMessage({ ok: false, text: noticeText(t, { code: result.code, params: result.params, message: result.reason }) });
          }
        } catch (error) {
          // It could not find out (offline, a timeout): say why, judge no key.
          if (!mine.signal.aborted) setMessage({ ok: false, text: describeCause(error) });
        } finally {
          if (inFlight.current === mine) setValidating(false);
        }
      };

      const tutorialUrl = p.guideUrl;
      // Today's markup (`StepCredentials.tsx:124-164`), with the saved values in place of the old slice and the definition's guide.
      return (
        <section className="setup-step">
          <h2>{t('setup.steps.credentials.ownKeyTitle', 'Your API key')}</h2>
          <p>{t('setup.credentials.ownKeyDesc', 'This key is stored on this device only, and the app calls the provider straight from here — it never reaches Kizuna AI. You pay the provider for what you use.')}</p>
          <CredentialPrefill draft={draft} dispatch={dispatch} slice={saved} fieldKeys={fields.map((f) => f.key)} />
          {fields.map((f) => (
            <label key={f.key} className="setup-field">
              <span>{t(f.labelKey, f.key)}</span>
              <FormInput
                type={f.secret ? 'password' : 'text'}
                value={draft.credentials[f.key] ?? ''}
                placeholder={f.placeholderKey ? t(f.placeholderKey, '') : ''}
                onChange={(e) => dispatch({ type: 'setCredential', key: f.key, value: e.target.value })}
                status={keyOnFile ? null : draft.credentialsValidated ? 'valid' : message && !message.ok ? 'invalid' : null}
              />
            </label>
          ))}
          {keyOnFile && (
            <StatusMessage variant="info">
              {t('setup.credentials.onFile', 'A key is already saved — leave this blank to keep it.')}
            </StatusMessage>
          )}
          {tutorialUrl && (
            <a
              className="setup-link"
              href={tutorialUrl}
              onClick={(e) => { e.preventDefault(); openExternalUrl(tutorialUrl); }}
            >
              <ExternalLink size={12} />
              {t('setup.credentials.guide', 'How to get this key')}
            </a>
          )}
          <div className="setup-actions">
            <Button variant="primary" onClick={validate} loading={validating} disabled={validating || fields.some((f) => !draft.credentials[f.key])}>
              {t('setup.credentials.validate', 'Validate')}
            </Button>
            {skipButton(keptOnSkip)}
          </div>
          {message && <StatusMessage variant={message.ok ? 'success' : 'error'}>{message.text}</StatusMessage>}
          {draft.credentialsPending && <StatusMessage variant="warning">{t('setup.credentials.pendingKey', 'You can add the key later in Settings → Provider. Start stays locked until it validates.')}</StatusMessage>}
        </section>
      );
    };
    ```

    `StepCredentials` renders `<OwnKeyCredentials draft={draft} dispatch={dispatch} skipButton={skipButton} />` for the own-key path, and its now-unused `validating` / `message` state moves into the new component. New imports: `useRef` (React), `useAuthContext` (`../../providers/useAuthContext`), `useProviderStore` (`../../../stores/providerStore`), `readCredentials`, `isMissing` (`../../../lib/provider/credentials`), `noticeText` (`../../../lib/view/noticeText`), `describeCause` (`../../../lib/diagnostics/describeCause`), `legsFor` (`../../../lib/session/appShape`), `getScenario` (`../../../lib/setup/scenarios`), `wizardProvider` (`../providerPaths`).
  - `StepLanguagePair.tsx`: the descriptor becomes the definition — `const p = wizardProvider(draft.provider)!;` `const s = useProviderStore((st) => st.entries[p.id]?.settings) ?? p.settings.defaults;` `sources = useMemo(() => [...p.languages.sources(s)], [p, s])`; `targetsFor = (src: string) => [...p.languages.targets(src, s)]`; `capability: textOnlyCapabilityOf(p)`; the seeding effect's `id`/`entry` read `p.id`. The spreads are load-bearing (the review's I2): the definition's lists are `readonly LanguageOption[]`, while `defaultLanguagePair`'s `sources` / `targetsFor` (`languageDefaults.ts:32-34`) and this file's `nameOf(list: { value: string; name: string }[], …)` (`:55`) take mutable arrays — passing the readonly ones is TS4104. Spreading at the call sites keeps `languageDefaults.ts` out of this task's Files. An option whose value is `AUTO` renders `t('common.autoDetect')` (as `LanguagePairSection.tsx:38`). The `ProviderConfigFactory` import goes.
  - `StepFinish.tsx`: `const p = wizardProvider(draft.provider)!;` the provider's name `t(\`providers.${p.i18nKey ?? p.id}.name\`, p.id)`; the language names from `nameOf([...p.languages.sources(s)], draft.sourceLanguage)` / `nameOf([...p.languages.targets(draft.sourceLanguage ?? '', s)], draft.targetLanguage)` — spread for the same reason, `nameOf` (`:16`) taking a mutable array — with `s` read as in `StepLanguagePair` and `AUTO` named `t('common.autoDetect')`; `capability: textOnlyCapabilityOf(p)`. The `ProviderConfigFactory` import goes.
  - `SetupWizard.tsx`: the re-run's "already validated" reads the provider store, not the old slice — `useIsApiKeyValid` goes from the `settingsStore` import, and the reducer's initializer becomes

    ```ts
    (): SetupDraft => {
      if (variant !== 'rerun' || !record || !offersRecord(record)) return initialDraft();
      // A saved key counts as validated when the provider's last readiness answer was ready.
      const id = providerIdFromStored(record.provider);
      const ready = id !== null && useProviderStore.getState().readiness[id]?.state === 'ready';
      return draftFromRecord(record, { credentialsAlreadyValid: ready });
    }
    ```

    with `useProviderStore` and `providerIdFromStored` imported.
- [ ] **Step 4: Run** `npx vitest run src/components/SetupWizard src/lib/setup src/components/Tour`, then the full suite and the gate (the wizard's files are in the widened regex). `providerPaths.managedFit.test.ts` stays green: it asserts only the managed functions and that `availablePaths()` omits `managed`. `applySetup.test.ts` and `useApplySetup.test.ts` are untouched: `applyProvider` already writes through the registry.
- [ ] **Step 5: Commit.**

  ```bash
  git add src/components/SetupWizard/providerPaths.ts src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/steps/StepProviderPath.tsx src/components/SetupWizard/steps/StepCredentials.tsx src/components/SetupWizard/steps/StepCredentials.test.tsx src/components/SetupWizard/steps/StepLanguagePair.tsx src/components/SetupWizard/steps/StepFinish.tsx src/components/SetupWizard/SetupWizard.tsx src/components/SetupWizard/SetupWizard.test.tsx
  ```

  ```bash
  git commit -q -F - -- src/components/SetupWizard/providerPaths.ts src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/steps/StepProviderPath.tsx src/components/SetupWizard/steps/StepCredentials.tsx src/components/SetupWizard/steps/StepCredentials.test.tsx src/components/SetupWizard/steps/StepLanguagePair.tsx src/components/SetupWizard/steps/StepFinish.tsx src/components/SetupWizard/SetupWizard.tsx src/components/SetupWizard/SetupWizard.test.tsx <<'EOF'
  feat(setup): the wizard's own-key path returns, read from the registry

  The own-key card lists the registry's own-key providers (Soniox), judged
  by their speech; the credential step shows the definition's fields and
  validates with its own check without writing anything; the pair and the
  summary read the definition's languages and name. The managed path is
  Kizuna Soniox's, still on the old factory.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

### Group check B (controller)

After Task 12.

1. The full gates, both release builds, `npx vitest run extension`, and the D24 greps (nothing); `command grep -rlF 'session.stt_resume_attempt_failed' build extension/dist` names the app's and the extension's chunks — Soniox's new adapter shipped in both (a string only it emits; `transcribe-websocket` would prove nothing, the old client already ships it — the review's M2).
2. Every probe green on a fresh vite: the spine probes (subtitle, surface, export, audio, gate, local), `app-panel-probe` (preview; `--settings`; `--app`, plain and `--settings`), `extension-overlay-probe` (plain and `--ptt`) on fresh builds. `app-panel-probe --settings --app` seeds LocalInference: Soniox's presence changes no step it checks.
3. **Soniox's Provider tab, rendered** through `scripts/dev/headless.mjs`, screenshots under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`: `/?preview=spine&settings=advanced&provider=soniox` and `&settings=simple&provider=soniox`. Read on the page:
   - the picker shows Soniox with its icon, name and description, the guide link, one secret key field with "Enter your Soniox API Key" and Validate; with no key saved, the credential form says "Enter your API key in Settings before starting." and Start is off with that reason;
   - Advanced's Provider tab: the region select (three regions), the voice library (built-ins only without a key), TTS speed (0.7–1.3), Custom Vocabulary (two textareas), Session Background, the shared-session pills (inert unless the mode is Both — flip it with the mode picker and they come alive), and the turn-detection block holding the three endpoint knobs;
   - the Speech section under Auto: the summary line "Endpoint Detection Tuning · Max Pause Before Finalizing: 2000 ms", linking to that block; its tooltip in the provider-neutral words;
   - switching the region to `eu` swaps the key field (still one field) and forgets readiness.
   Compare the controls' markup against LocalInference's page in the same layout (the memory rule: settle UI by rendering, match sibling markup).
4. **The wizard** on a fresh profile at `/` (first run): the path step offers "I have my own API key" and "Free, offline"; choosing the first lists Soniox; the credential step shows the Soniox key field and the guide link. Validate is never pressed: a press would call `api.soniox.com` from a headless browser with network (the brief: never call Soniox; the review's M3). The wizard's check path is pinned by Task 12's tests over a spied `check`; the real one is the owner's (live test item 18).
5. The two-key spot-check list Task 11's implementer reported, handed to the owner.

---

### Task 13 (controller): the spec's amendments and the roadmap's record (ruling 10)

**Files:** Modify `docs/superpowers/specs/2026-09-22-client-contract-design.md` and `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`.

- [ ] **Step 1: The spec.**
  1. **"L0 — the client contract"**, the emitted events block: after `audio({ pcm, ref?, range? })` and its two comment lines, add

     ```
     speechRanges({ ref, ranges: [{ index, range }] })
     //   sets the range of speech this adapter already emitted for `ref`:
     //   `index` is the entry's place among that ref's `audio` events
     ```

     and, after the paragraph "**`range`, not a running offset.**", a paragraph: "**A range known only later is filled in** (`speechRanges`, Stage 2 Soniox). A streaming TTS learns which characters a chunk speaks only once its segment has ended; the adapter then sets each emitted chunk's range, the segment's span divided by the chunks' sample counts. Until then the audio plays rangeless — replay only, no karaoke — and karaoke, which reads a clip's range at each sample, starts from where playback is. While a rangeless clip of the segment already lit plays, karaoke holds what is lit, by the same rules as a gap between clips: a row spoken as several TTS segments never un-highlights between them, and only the sentence still waiting for its ranges is unlit. Ranges that land after the queue has played the clip out light nothing live; replay lights them. The segment may already be closed: L1 measures the ranges against the text the adapter last sent (counting entries from the adapter's first `audio`, past any clear) and re-anchors them onto the text as it stands, punctuation fill-in included."
  2. **"What every adapter must honour"**, a bullet after the `range` bullet: "**Ranges filled in later** name speech entries the adapter emitted for that ref, lie within its text, and ascend with the ref's other ranges without overlapping (the kit's `ranges-entry`, `range-in-text`, `ranges-order`)."
  3. **"Provider capability"**, Soniox's row: `SonioxClient | yes | per TTS segment — filled in once the segment's speech has ended (`speechRanges`); unlit before; none for a segment the provider killed | same utterance — stated`. Under the table: "Soniox's unit is the TTS **segment** — a sentence, a clause after 1.5 s, 3 s of idle, an 8-s cap or a language change (`ttsStream.ts`) — not the sentence the first version of this table named (survey §3.7.3)."
  4. **"Turns"**, after the table "What each provider can do": "Soniox's `finalize` is answered by a `<fin>` token, which the old client skipped. Under manual turns `<fin>` ends the utterance; endpoint detection stays on, so a long hold may still close at a pause, and the translation of the last words is held open briefly after `<fin>` (Stage 2 Soniox, ruling 5)."
  5. **"The session request"**, the sentence "and Soniox's `clientReferenceId` claims to be inert on the wire (it is sent, and billing depends on it)" becomes "and Soniox's `clientReferenceId` is sent although Soniox bills by the reference bound to the key when the backend mints it, not by the field on the wire (probed 2026-08-11); an own key sends none" (survey §3.7.1).
  6. **"Playback — Routing"**, the paragraph "Voice preview bypasses the sink at four sites …" becomes: "Voice preview bypasses the sink at three sites — `VoiceLibrarySection`'s own `AudioContext`, `SonioxCloneReviewStep`'s `<audio>` and `nativeVoiceStores` — and `VoiceCreateModal`'s `AudioContext` is its recorder, not a player. `VoiceLibrarySection` folds into the preview route through a port its host hands down (Soniox first, Stage 2); `SonioxCloneReviewStep` is a seekable review player that a play-once route cannot replace without losing seek, and stays on the default output (Stage 2 Soniox, ruling 6); `nativeVoiceStores` folds in with Local Native" (survey §3.7.2).
  7. **"What adding a provider then touches"**, item 4 gains: "— none for Soniox, whose twelve origins the manifest already lists" (survey §3.7.6).
  8. **"Session hooks on the provider definition"**, the `startBoth` bullet gains: "It rejects with `LegStartError(leg, cause)` to name the leg that failed (D22), so the start's notice names it; any other rejection is the first leg's."
  9. **"The shape"**, after the foundation plan's note: "**Amended by the Stage 2 Soniox plan:** `SettingsProps.preview?` (the voice-preview route) and `legs?`; `AdapterEvents.speechRanges`; `LegStartError`."
  10. **"The clip queue"**, the paragraph "**There is no `seal`**", after "…made from the queue's positions and the segments' `final` — not from a guess inside the player.": "The same decision covers a clip whose range is not filled in yet: while one plays for the segment already lit, karaoke holds what is lit by the gap's rules (Stage 2 Soniox, choice 18)."
- [ ] **Step 2: The roadmap.** Append `## Scheduled by the Stage 2 Soniox plan`, in the form of the entries before it:
  - **What landed:** the commits and the tasks, and their fix rounds.
  - **What was checked:** group checks A and B — the `late-ranges` screenshots, every probe, Soniox's Provider tab in both layouts, the wizard's own-key path, both bundles with Soniox and without either fake.
  - **Stated departures:** this plan's self-review list.
  - **A correction to the foundation plan's Soniox list:** the `sonioxServiceUnavailable` / `sonioxServiceBusy` aliases belong to Kizuna Soniox — only the managed session-key path raises them (`ManagedSonioxSession.ts:734, 769-771`; survey §3.7.5). This plan took the two TTS aliases and `connection_lost`.
  - **The locale spot check:** the 29 non-`en` values of `settings.speechModeTooltip` and `settings.speechModeAppliesToAuto` Task 11's implementer reported, for a native speaker.
  - **The owner's live test** (survey §2.13, rewritten for ruling 2's karaoke, with the `<fin>` and first-audio checks):
    1. **Each region** (a US key, then EU, JP if held): the key field swaps with the region; Validate and the automatic check answer per region; the session dials that region (Logs `session.opened` with its region); a US key in the EU slot is refused with words.
    2. **A bad key:** the credential form says "The provider did not accept the credentials: …"; Start is off.
    3. **Languages:** a concrete pair (ja → en); an auto source, speaker only, with badges showing the detected language and fill-in on unpunctuated source text; auto with Both → Start off with the participant words.
    4. **Speech heard** on the monitor, and in the virtual microphone in a meeting app, once each. **First-audio latency** against the old build: the same (chunks play as they arrive).
    5. **Karaoke (ruling 2):** a sentence is not highlighted while its first chunks play; once its TTS segment ends the highlight starts from where playback is and sweeps to its end; it stays aligned after punctuation fill-in; a segment Soniox killed never lights. **A multi-sentence translation: the highlight never blinks off between sentences** — what is lit stays lit while the next sentence plays unlit, and that sentence lights from where playback is once its own segment ends (the hold, choice 18). Replay with "Keep audio for replay" on plays the utterance; off, no replay control.
    6. **Text only:** no TTS socket in Logs.
    7. **Push-to-talk:** a short press closes the rows on release, without the endpoint delay, and **the last words' translation arrives complete** — within the 2-s hold after `<fin>`, or landing on the closed row as a revision (never cut off); more than 20 s idle between presses → no 408, no connection-lost; a long hold with pauses; push-to-translate routes the raw voice while idle.
    8. **Shared Both:** one STT socket (Logs); sides right, including a same-language participant and overlapping speech; the participant-speech switch off → the participant silent; on → heard on the real device (new, ruling 4: a second TTS socket on the key); push-to-talk in shared Both finalizes the far end too (acceptable?).
    9. **Split Both:** two STT sockets; either leg ending ends both; a denied loopback fails the start naming the participant.
    10. **Participant-only.**
    11. **The 408 case:** a long monologue with clauses and no full stop (> 8 s) — no "Part of the spoken translation could not be played" in normal speech; if it appears, the words say part was lost, not stopped.
    12. **Voice library:** built-ins listed; a preview plays on the **selected output device** (new: the preview route); record and upload a clone (3–120 s) → processing → ready → select → heard in a session → delete; switching region shows that region's clones; a bad key shows `sonioxVoiceListError`; the clone-review player still plays on the default output (ruling 6).
    13. **Vocabulary and background:** terms bias recognition; an oversized vocabulary is truncated, with a warning in Logs.
    14. **Endpoint knobs:** on the Provider tab's turn-detection block, and summarized in the Speech section; max pause 3 000 ms keeps paused sentences whole.
    15. **A network drop mid-session:** the connection-lost words, and the run ends.
    16. **Stop mid-utterance:** rows finalized, no audio after Stop, the auto-save file's content.
    17. **The extension:** the same core flows in the side panel.
    18. **The wizard:** the own-key path with a Soniox key.
  - **What it leaves:** "What this plan leaves" below, verbatim.
- [ ] **Step 3: Commit.**

  ```bash
  git add docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md
  ```

  ```bash
  git commit -q -F - -- docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md <<'EOF'
  docs(spec): speechRanges, startBoth's leg, and Soniox's corrections

  L0 gains ranges filled in after the audio, with their conformance rule
  and karaoke's hold across a row's segments; startBoth names its failing
  leg; Soniox's capability row, turns, client reference, the
  voice-preview sites and the manifest note follow what the port found.
  The roadmap records the Soniox plan, the owner's live test and what
  Kizuna Soniox takes.

  Co-Authored-By: <implementing model> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
  EOF
  ```

---

## What this plan leaves — for the plans that meet it

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

**Stage 2 items from the roadmap this plan does not take:** the kit's parked items (`{ flush: true }` after an awaited answer, `FakeSocket`'s close codes, the virtual clock's `pending()` count, manual-end's segment check); the account's compile-time narrowing; the leased fake's refused hooks; `RunnerDeps.replayAudio`'s guard; the notice-code namespace.

## Self-review

**Coverage of survey §3.2 (Plan A's outline) and the rulings:**

| Item | Where |
|---|---|
| §3.2.1 F18 move, no behaviour change | Task 1 (with the clock and socket, since the session-side guard walks the moved modules from the first commit) |
| §3.2.2 clock + socket factory | Task 1 |
| §3.2.3 TTS span tags, segment completion, a 408 partial | Task 2 (tags, ends); Task 7 (the fill-in, no ranges for a killed segment) |
| §3.2.4 definition data: `S`, languages, credentials, `C`, `check` | Task 5 |
| §3.2.5 the single-leg adapter: utterances, speech, adapter, failures, 503, stop, frames, `K.lease` stubs, conformance | Tasks 6, 7, 8 |
| §3.2.6 notice codes | Task 7 (two rows, two aliases) |
| §3.2.7 `startBoth` + runner naming + distinct tracks | Task 4 (the contract error, the runner, the leased fake, the track test); Task 9 (Soniox's split and shared) |
| §3.2.8 Settings: view, voice wrapper, `LinesField`, `TurnDetection`, the preview port, `legs` | Task 10a (the port, the context, `legs`, `VoiceLibrarySection`); Task 10b (the view, the voice wrapper, `LinesField`, `TurnDetection`) |
| §3.2.9 registry + the Speech tooltip | Task 11 |
| §3.2.10 F12's own-key wizard path | Task 12 |
| §3.2.11 group check, the owner's live test | Group checks A and B; Task 13's list |
| Ruling 1 | Global Constraints ("Read only", with the one stated exception), Task 1, Task 5; Task 10a (the exception) |
| Ruling 2 | Tasks 2, 3, 7; choices 1, 2, 4, 18; the karaoke proofs (Task 3, cases 13–13f: a single clip lights from its fill-in, the hold across a row's segments, a late fill-in lighting only on replay) |
| Ruling 3 | Task 7 (TTS paths, the start-failure retry in case 14), Task 8 (STT paths), each with a test |
| Ruling 4 | Tasks 8–9 (speech per leg from `context.speech`); Task 9 case 9 |
| Ruling 5 | Task 6 (cases 9–12, 19–20), Task 8 (case 13); the live check |
| Ruling 6 | Task 10a (the port, the context, `VoiceLibrarySection`), Task 10b (the view provides it); Task 13 (the roadmap note) |
| Ruling 7 | Task 11 (registry, order case); Task 5 (no client reference, case 5) |
| Ruling 8 | Task 7 (aliases), Task 11 (two keys × 30), Task 13 (spot-check list); no key for unreadable frames (choice 7) |
| Ruling 9 | Task 12 |
| Ruling 10 | Task 13 |
| Survey §2.12 seams (Plan B) | `K.lease` (Task 8, cases 21–23), `K.tts` absent (case 24), `K.clientReferenceId` (case 25), the settings factory (Task 10b, cases 9, 15), per-leg `K` in `startBoth` (Task 9, cases 1, 9) |
| Survey §3.7 spec corrections | Task 13, items 3–7 (§3.7.1–3.7.4, 3.7.6) and the roadmap correction (§3.7.5) |

**Placeholders.** Four are deliberate:
- `SONIOX_LANGUAGES`' 60 entries are pasted from `SonioxProviderConfig.ts:329-388` (a data table; Task 5 case 7 counts them), and `fitContextToBudget` with its helpers from `:73-165` verbatim, one line changed and named.
- `SonioxTurnDetectionControls` transcribes `ProviderSpecificSettings.tsx:1894-1966` with three named substitutions.
- The 29 non-`en` locale values follow a written rule from each catalog's own sentences, four written out (Task 11).
- Task 13's roadmap prose is the controller's, its contents listed; the spec's amendments are written out. Each commit's body is written; an implementer may tighten one but keeps its subject.

**Types across tasks:**

| Produced | Consumed by |
|---|---|
| `OpenSocket`, `nativeSocket`, `WS_OPEN`, `SonioxWireDeps` (Task 1) | Tasks 2, 7, 8, 9 |
| `SonioxSttStream(deps)`, `onUnreadable`; `SonioxTtsStream(options, deps)`; `PcmMixerOptions.clock` (Task 1) | Tasks 7, 8, 9 (`onUnreadable` → the `stt.unreadable` / `tts.unreadable` frames); the old client, unchanged |
| `TextTag`, `SonioxTtsAudioInfo`, `SonioxTtsSegmentEnd`, `sendText(…, tag?)`, `onSegmentEnd` (Task 2) | Task 7 |
| `AdapterEvents.speechRanges`, the `late-ranges` script, `ranges-entry` / `ranges-order` (Task 3) | Tasks 7, 8 (the harness), group check A |
| `nextLit` with the hold — same signature (Task 3) | `createKaraoke`, unchanged |
| `LegStartError` (Task 4) | Task 9; `run.ts`; `leased.ts` |
| `SonioxSettings`, `SONIOX_DEFAULTS`, `migrateSonioxSettings`, `sonioxKeyField`, `sonioxVoiceField`, `SonioxCredentials`, `SonioxLeasePort`, `sonioxCredentials`, `sonioxLanguages` (Task 5) | Tasks 8, 9, 10b, 11, 12 |
| `SonioxConfig`, `buildSoniox`, `describeSoniox`, `SONIOX_STT_MODEL` (Task 5) | Tasks 8, 9, 11 |
| `checkSoniox`, `createSonioxCheck`, `CHECK_TIMEOUT_MS` (Task 5) | Task 11; Task 12 (through `sonioxProvider.check`) |
| `Utterances`, `UtteranceSink`, `SegmentEvent`, `tokenFrames`, `FIN_TRANSLATION_GRACE_MS` (Task 6) | Task 8 |
| `LegSpeech`, `LegSpeechOptions`, `tileSpan` (Task 7) | Task 8 |
| `framePayload`, `FRAME_STRING_MAX` (Task 7) | Tasks 7, 8; LocalInference |
| `tts_segment_lost`, `tts_stopped` (Task 7) | `speech.ts`; `noticeText` |
| `createSonioxAdapter`, `SonioxAdapterDeps`, `SonioxCore`, `coreLeg`, `sttFailureCode`, `RESUME_DELAYS_MS`, `MAX_RESUME_CYCLES` (Task 8) | Task 9; Task 11 |
| `SonioxAdapter` (with `startBoth`), `CoreOptions.shared` (Task 9) | Task 11 |
| `PreviewPort`, `SettingsProps.preview` / `legs`, `VoicePreviewContext`, `appVoicePreview` (Task 10a) | Task 10b; `ProviderOwnSettings`; Plan B |
| `LinesField`, `LINES_FIELD_MAX`, `VoiceSourceHook`, `useByokVoiceSource`, `SonioxVoiceField`, `createSonioxSettingsView`, `SonioxSettingsView`, `SonioxTurnDetectionSummary` / `Controls` (Task 10b) | Task 11; Plan B |
| `sonioxProvider` (Task 11) | the registry; Task 12 |
| `textOnlyCapabilityOf`, `wizardProvider` (Task 12) | the wizard's steps |

No interface was renamed on the review. Added: `Conversation`'s private `clearedEntries`, `LegSpeech`'s private `opening`, `VoiceLibrarySection`'s private `playingIdRef`, `karaoke.ts`' module-private `hold`, and the frame types `stt.unreadable` / `tts.unreadable`; removed: the draft's `parse_error` notice from Soniox (the code itself stays in `CLIENT_DIAGNOSTICS` for its other users).

**Stated departures from today:**
- Soniox runs on the new session: its old client and settings UI stay compiled, unreachable from it, until Plan B.
- **Karaoke on Soniox:** a sentence lights once its TTS segment has ended, from where playback is; before that, and for a segment Soniox killed, nothing lights. What is lit stays lit while the row's next sentence plays unlit (choice 18). A fill-in that lands after the clip played out lights only on replay. The old client had no karaoke at all.
- **Push-to-talk and push-to-translate on Soniox** (D14): `finalize` on release, `<fin>` the boundary.
- **The participant is voiced when its switch is on** (ruling 4), shared and split: a second TTS socket on the user's key. The old client kept the participant text-only.
- **Late translation tokens** after a boundary revise the ended utterance's translation instead of starting an orphan row (choice 3), including when they share a message with the next utterance's first words; after `<fin>` the translation stays provisional for up to 2 s.
- **Errors end the run through `failed`** with a code: `connection_lost` (the old sentence, through its alias), `auth`, `rate_limit`, `client`, `server` with the server's words as the detail.
- **Analytics shift for the owner's dashboards** (choice 8, kept on the review): `api_error.error_code` reads `connection_lost` with `error_type` `server` where the old client sent `503`, `408` or `socket_closed`. A dashboard grouping Soniox errors by code will see those three merge into one.
- **An unreadable Soniox frame is logged, not shown** (choice 7, reversed on the review): one `stt.unreadable` / `tts.unreadable` frame per episode in the Logs, where the old client dropped it silently. No notice, no locale text.
- **A TTS connect failure at start and a failed resume attempt** reach only the Logs (as before: the old `diagnose` calls). The start failure is retried by the first translation, and a failed retry says "speech stopped" once, as before (choice 6).
- **Frames go to the socket's first leg** (choice 16; the review's M16): in shared Both every socket-level and token frame appears in the speaker leg's Logs; the survey (§2.9) had routed them to each utterance's leg. A leg's TTS frames go to that leg.
- **Soniox's key is checked on its own** (the foundation's readiness driver): at once when selected, 800 ms after an edit — a temporary key minted each time, also after a vocabulary or voice edit.
- **Voice previews play on the selected output device** (the preview route), not the system default.
- **The endpoint knobs** moved to the Provider tab's turn-detection block, with a summary in the Speech section; **the shared-session pills** as before, inert outside Both.
- **The Speech mode's tooltip** is provider-neutral for every provider, LocalInference included.
- **`translation_session_start`** reports `asr_model: 'stt-rt-v5'` and, when speaking, `tts_model: 'tts-rt-v2'` for Soniox.
- **A stored `'soniox'` selection** now loads Soniox instead of falling back to LocalInference.
- **The wizard offers the own-key path again**, listing the registry's own-key providers (Soniox; and the fake in development builds).

**Checked against the code while writing** (at `2a8d4df1`; re-measured or re-read at `c91a3020` on the review):
- the suite's totals (re-measured: 5 843 passed, 2 skipped, 5 845) and the widened gate's 18 lines (279 in the full tree), both measured at both commits;
- every `SonioxClient.ts` line cited in the rulings (`:57`, `:248`, `:419-437`, `:636-683`, `:649`, `:975`, `:1059-1094`, `:1214-1234`, `:1336-1348`, `:1358`, `:1436-1492`, `:1540-1589`);
- the 20 typecheck lines in the two moved tests, and none in the other four;
- `git add` refuses a pathspec that matches nothing, and `git commit -- <deleted path>` includes the deletion (a scratch repository);
- no default export in the six moved modules, so `export *` stubs suffice; the three `vi.mock` sites of the old paths;
- the overlay entry's graph does not reach `providers/registry.ts`;
- `localInference/adapter.ts` uses `redact` only in `framePayload`;
- `noticeText.test.ts:56-60` requires `NOTICE_WORDS` for every `CLIENT_DIAGNOSTICS` code (Task 7 widens it to aliases);
- `playback.ts`'s clip index is the per-ref count of `audio` events, which `speechRanges`' `index` matches; `playback.clear()` restarts it with L1's `clear()` (`:145-151`), which `clearedEntries` follows;
- `offsetAfterSkeleton` carries a range's end past trailing punctuation (`'hello world'` → `'Hello, world.'` maps `[0, 5]` to `[0, 7]`), which Task 3 case 7's expectation follows;
- the 30 catalogs, each with `settings.localInferenceTurnDetectionTooltip` and `settings.speechModeAppliesTo`;
- on the review: `karaoke.ts`' `nextLit` / `litFor` (`:57-91`) and every case in `karaoke.test.ts`, which the hold leaves green; `src/app/session.test.ts` mocks `karaoke` wholesale; `Conversation.clear()` (`:151-164`) and `audio()`'s `pending` branch (`:230-235`); `conformance.ts`' `flaggedRange` (`:61-72`); `SonioxTtsStream`'s `endUtterance` (drains the active stream) and its pre-open `onclose` (rejects `connect()` on a close during connect); `VoiceLibrarySection`'s `stopPreview` / `togglePreview` (`:153-231`, no `playingIdRef` before); `getAppAudio()` (`appAudio.ts`, the one page playback `src/app/session.ts` also loads); `run.ts:8` and `leased.ts:11` import the contract as `import type`; `StepCredentials.tsx:8-9, 19, 108`, `StepLanguagePair.tsx:55`, `StepFinish.tsx:16`, `languageDefaults.ts:32`; `providerPaths.test.ts:20-44` and `SetupWizard.test.tsx:192, 210-211`; `parse_error` already has words in every catalog, so reversing choice 7 removes no key.

**Not decided here (for the controller or the owner):**
- `FIN_TRANSLATION_GRACE_MS` = 2 000 ms is a judgement; the live test's item 7 settles it.
- Whether the six re-export stubs should carry a comment line (ruling 1 says one line; they carry none).

**Decided by the controller on the review** (each written in where it lands):
1. **C1:** fixed as the review recommends — `endPrevious()` flushes (`speakFinals`, `showTranslation`) before it closes, with two new Task 6 cases (19–20) that a close-only `endPrevious()` fails.
2. **I1:** the hold is added — `karaoke.ts`' one change (choice 18, Task 3 cases 13b–13f, the spec's two sentences, live-test item 5's new line); ruling 2's "no change" note rewritten.
3. **I2:** all three typecheck corrections folded in, spreading at the call sites rather than widening `languageDefaults.ts`.
4. **Choice 7 reversed:** an unreadable frame is Logs-only, never a notice.
5. **Choice 6:** kept Logs-only, with the old retry made explicit (a failed start is retried by the first translation; a failed retry says "speech stopped" once) and tested.
6. **Choice 13 / M12:** `VoiceLibrarySection` edited additively as a stated narrow exception to ruling 1, with the guard.
7. **Choice 8:** `connection_lost` kept; the analytics shift listed under the stated departures.
8. **Minors M1–M16:** all taken; M4 by the per-ref offset in L1 (small and tested), M11 by splitting Task 10, M13 by `getAppAudio()`, M16 under the stated departures.

**Amended after the review** (`stage2-soniox-plan-review.md`):
- **C1** — Task 6: `endPrevious()` flushes before closing; cases 19–20; choice 3's claim now names the one-message layout.
- **I1** — Task 3: `karaoke.ts` joins its Files; `nextLit`'s hold through a shared `hold()`; cases 13b (RED), 13c (late fill-in, characterization), 13d–13f (`nextLit` units); ruling 2's note, choice 2's third bullet (M15) and new choice 18; Task 13 spec items 1 and 10; live-test item 5.
- **I2** — Task 5 case 2 spreads `SONIOX_DEFAULTS` into a one-argument call; Task 4 value-imports `LegStartError` (and the tests' `AdapterStartError`, `LegName`, `Source`); Task 12 drops `getToken`, `useSettingsStore` and `import type { SettingsStore }`, and spreads the definition's readonly lists at `StepLanguagePair` / `StepFinish`'s call sites.
- **M1** — the suite baseline re-measured at `c91a3020`: 5 843 passed, 2 skipped (5 845); the typecheck baseline re-measured, unchanged.
- **M2** — the bundle check greps `session.stt_resume_attempt_failed` (Global Constraints, group check B).
- **M3** — group check B never presses Validate.
- **M4** — Task 3: `Conversation.clearedEntries` and case 11b; choice 1's bullets corrected (audio for a cleared ref goes to `pending`).
- **M5** — Task 3: conformance keys each range of a `speechRanges` on its own; case 5b.
- **M6** — Task 3: case 8b, the one that fails without `text()`'s `unfilled.delete`.
- **M7** — Task 3 Step 2 names cases 1 and 11 (and 13, 13c, 13e) as characterization.
- **M8** — Task 7: `LegSpeech.opening`, closed by `close()`; case 19.
- **M9** — Task 2 case 4 ends `utt-1-2` with `endUtterance()` before its `terminated`.
- **M10** — Task 12 Step 1 names the four `providerPaths.test.ts` cases replaced, the renamed ones, and why `SetupWizard.test.tsx:192, 210-211` stay green; `providerFits` of a managed id recorded for Plan B.
- **M11** — Task 10 split into 10a (the route; Wave 3 with Task 7) and 10b (Soniox's components; Wave 4 with Task 8); group check A moved after them; the File Structure, waves, ruling 9's count and every "Task 10" reference updated.
- **M12** — Task 10a: `playingIdRef` guards `port.stop()`; cases 21 (reworded) and 21b.
- **M13** — Task 10a: `appVoicePreview` on `getAppAudio()`; its test mocks `../lib/audio/appAudio`.
- **M14** — "What this plan leaves": the keep list and the stub re-pointing.
- **M15** — choice 2's karaoke bullet no longer claims more than the code does.
- **M16** — choice 16 and the frames' routing listed under the stated departures (moved from "Found here").
