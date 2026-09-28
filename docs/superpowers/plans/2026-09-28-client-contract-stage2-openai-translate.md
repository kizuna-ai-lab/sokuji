# Client contract — Stage 2, provider 5: OpenAI Translate (`openai_translate`, own key, WebSocket)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Standing of the rulings below.** Rulings 1–15 are **the owner's decisions** (2026-09-28, in conversation): WebSocket only, a stored WebRTC choice running over WebSocket (ruling 1); push-to-talk's release tail — the held remainder padded to the next 200 ms frame, then silence in real time until the translation has been quiet 1 s, at most 3 s (ruling 2); a mid-session `error` in the Logs only (ruling 3); Text only offered as a playback control (ruling 4); the participant speaking when its switch is on (ruling 5); proximity pairing with `elapsed_ms` logged on every delta (ruling 6); the model and transcript-model selects gone (rulings 7, 8); noise reduction "None" sent as `null` (ruling 9); no OpenAI-key prefill (ruling 10); the registry position after Doubao AST 2.0 (ruling 11); the OpenAI setup guide (ruling 12); a drop or an expiry ending the run in words (ruling 13); the deletion timing (ruling 14); same-language pairs kept and no `auto` (ruling 15). Rulings 16–23 are the controller's technical rulings. Where a ruling left a sub-decision to this plan ("decide and say why", "say whether … and decide", "state precisely what is copied"), the answer is a numbered *choice* below, and the self-review lists each one.

**Goal:** OpenAI Translate — `gpt-realtime-translate`, speech to speech — with the user's own key (`openai_translate`) on the new contract, over WebSocket: its definition, settings, credentials, a bounded model-list check, builder, adapter and settings view, so the owner can run it live. Concretely:
- the key in the `openai-insecure-api-key.<key>` WebSocket subprotocol, which a browser sets itself: the provider's own plain socket seam, which rethrows a refused socket in fixed words; no header seam (F14 stays OpenAI Live's), no ephemeral token, all three platforms; `redact()` gains the subprotocol as a carrier (ruling 16; choice 3);
- a start that resolves once the server confirms the configuration (`session.updated`), bounded on the request's clock and refusing in words (choices 1, 2);
- each side its own segment on its own silence timer — the machine of Gemini's Live Translate, copied with Translate's audio rules (choice 4) — content audio holding the translation open and carrying the text as it stood when the frame arrived (ruling 6; choices 5, 6);
- push-to-talk and push-to-translate for the first time, with a release tail on an endpoint that has no commit (ruling 2; choice 7);
- Text only offered as a playback control: the API always speaks, and a leg that does not speak drops the audio (ruling 4);
- proximity pairing through the Gemini plan's F16, every delta frame — input transcript, output transcript, content output audio; heartbeats unframed, as research Q3's design — carrying `elapsed_ms` for the timing follow-up (ruling 6);
- the shared `NoiseReductionField`, Translate's own settings view, two notice aliases, and the registration after Doubao AST 2.0 (rulings 11, 19).

The plan ends with the controller's docs task and the owner's live test (Task 11). **The WebRTC transport is a later Stage 2 step:** this port keeps `transportType` in `S`, unshown and not honoured, and leaves `C.transport` as the step's attachment point (ruling 1; choice 15). **Deleting the relay twin `kizunaai_openai_translate` — the owner ruled it deleted, not ported — is a later plan, T2, after this port's live test; deleting the own-key old code is T3, after the WebRTC step's live test**, since the WebRTC client imports the GA client (ruling 14; choice 19). This plan records both inventories only.

**Architecture:**
- **One folder,** `src/providers/openai_translate/`:
  - the definition's data — `settings.ts` (`S`, its migration, the two model constants, the languages, the credentials `K`), `config.ts` (`C`, `build`, `describe`), `check.ts` (one bounded model list);
  - the session side — `socket.ts` (the socket seam, with protocols), `wire.ts` (the URL, the subprotocols, the two client frames, decoding, the heartbeat test, an error's code and words; pure), `segments.ts` (deltas → segments; pure, on the request's clock), `tail.ts` (the release tail; pure, on the request's clock), `adapter.ts` (one leg);
  - `TranslateSettings.tsx` and `provider.ts`; `testing.ts` holds the suites' fixtures and the harness.
- **Shared pieces built here:** `NoiseReductionField` (`src/components/providers/fields/`), which OpenAI Realtime and Compatible reuse next; two `NOTICE_ALIASES` rows and their `NOTICE_TARGETS`; the subprotocol rule in `redact()`.
- **No contract change.** Nothing in `src/lib/provider/types.ts`, `src/lib/contract/**`, the runner, `shape.ts` or `appShape.ts` changes: Translate needs no hook, no `startBoth` and no new event, and its languages are the same in every language context.
- **The old Translate code stays compiled and unreachable** (`OpenAITranslateGAClient`, `OpenAITranslateWebRTCClient`, `OpenAITranslateProviderConfig`, the relay twin's descriptor, the old settings UI's Translate branches, the two store slices, `EphemeralTokenService`'s translation mint) — T2's and T3's.

**Tech Stack:** TypeScript (strict), React 19, zustand, i18next, the `openai` SDK's realtime translation types (`import type` only), Vitest + @testing-library/react (jsdom), `sass` (a compiled-stylesheet assertion), the adapter test kit (`FakeSocket`, `driveAdapter`, `runScenario`, the virtual clock, `trackedClock`), a stub `fetch` answering `Response` objects, headless Chromium over the DevTools protocol (`scripts/dev/headless.mjs`) at the group checks.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — the binding authority, as amended by the Stage 2 foundation, Soniox, Kizuna Soniox, Gemini and Volcengine AST2 plans (above all "Readiness is one check": **`check` bounds its own request**; and the AST2 plan's language context, which Translate ignores). The parts this plan implements: "L0 — the client contract" and "What every adapter must honour"; "Turns" (Translate's rows, which it amends); "The session request" (the participant as the reversed call; D20); "Provider capability" (Translate's row); "The provider definition" (one own-key provider, no model choice); "Languages are two functions"; "Sockets that need upgrade headers" (Translate needs none); "Segmentation is one fact" (`'silence'`); "L2 — the projection" (inferred pairing, F16); "Testing" (conformance). It amends the spec in Task 11.

**Research notes:**
- **The survey this plan is written from:** `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/stage2-openai-translate-survey.md`, cited as *survey §x*: §0 (findings), §1 (the old implementation as protocol documentation), §2 (the mapping), §3 (the outline, the shared files, the risks, the spec statements it refines, the owner's questions). It was read at `8db4261f`, this plan's starting point; every file:line this plan relies on was re-read there. `GA` = `src/services/clients/OpenAITranslateGAClient.ts`, `OTD` = `src/services/providers/OpenAITranslateProviderConfig.ts`, `SDK` = `node_modules/openai/resources/realtime/realtime.d.ts` (`openai` 6.39.1).
- **The follow-up research:** `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oat-research-answers.md`, cited as *research Qn*: Q1 the release tail (no tail was ever 1 s; the SDK's frame and silence text; why a tail is needed), Q2 how the old app did Text only (the switch hidden), Q3 `elapsed_ms` (what is unknown; the recommended order), Q4 the provider order.
- **Found while writing** (at `8db4261f`):
  - **The SDK types the translations wire**, and `openai` exports `./resources/*`: `import type … from 'openai/resources/realtime/realtime'` typechecks and is erased from the bundles. `RealtimeTranslationServerEvent` lists seven server events and no `.done` event (`SDK:3217`), so the adapter reads each event through its own SDK type and handles the old client's three `.done` cases apart (choice 18).
  - **`FakeSocket` records `protocols`** and `open(protocol)` sets the subprotocol the server chose, so the subprotocols are asserted directly.
  - **The session-side guard does not follow an import out of the provider's folder** (`sessionSide.consistency.test.ts`, "The limit"): importing `GeminiTurns` from `../gemini/turns` would put Gemini's module on Translate's session side unchecked — part of choice 4's reason.
  - **The Text only switch's tooltip** (`simpleConfig.textOnlyDesc`) reads "Translate to text only — no spoken audio output" in en, and so in 27 more catalogs: true of a playback control. zh_CN's "仅翻译为文本 — 不生成语音" and zh_TW's "僅翻譯為文字 — 不產生語音" say no speech is *generated*, which is not true for Translate: the API still produces, and bills, the audio (ruling 4). (The component's English fallback, "Show translation as text only, without generating an audio response", `SpeechSection.tsx:177, 194`, is not what a catalog shows.) An open question (Task 11); no new locale key.
  - **`speech: 'optional'` changes the wizard too:** `providerFitForScenario` greys a provider whose `speech` is `'always'` for the subtitles-only scenario (`providerPaths.ts:27-28`); Translate is no longer greyed there. A stated departure, pinned in Task 10.
  - **`logStore` needs no row:** its `.delta` rule groups each of the three delta frame types under its own name (`logStore.ts:391-393`), none of Translate's other frame names is one of Doubao's grouped rows, `session.error` reads as an error by its suffix, and `session.closed` draws the Logs' separator. Task 1 pins it without editing `logStore.ts`.
  - **`redact()`'s bare `sk-` rule already masks an OpenAI key** after `openai-insecure-api-key.` (a `.` then `s` is a word boundary); the carrier rule adds a key of any shape (choice 3). The rule beside it cites `OpenAITranslateGAClient.ts:501` for `sokuji-auth.`, now `:707` — fixed in passing.
  - **The registry position breaks Doubao's own order case**, "sits after Gemini and before Soniox" (`volcengine_ast2/provider.test.ts:67-71`): its `soniox − 1` assertion no longer holds, and narrows to "after Gemini".
  - **Every file this plan creates or edits is already inside the AST2 plan's typecheck regex** (`providers`, `components/providers`, `lib/(view|diagnostics/…redact)`, `stores/logStore`, `SetupWizard/providerPaths(\.test)?`), so the gate's regex needs no widening.
  - **A scratch copy of the tree** at `8db4261f` (outside the repository, 2026-09-28) ran every code and test block below before it was written down: each task's own tests, then the whole suite — 538 files passed and 1 skipped, 6 853 tests passed and 2 skipped, 0 failed, no unhandled errors — and the typecheck: 259 lines in the full tree and exactly the gate's 20. Every code block is that copy's file, and every diff is generated from it against `8db4261f`. After the plan's review, the amended plan was applied again, task by task from its own text, to a fresh copy of `8db4261f`: Task 9's and Task 10's red and green steps as stated, the tree then byte-identical to the tested one, and the same end-state numbers.
- **The roadmap:** `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` — "Scheduled by the Stage 2 foundation plan" → OpenAI Translate (`:1289`: F16 if AST2 did not land it; the transcript, noise and transport fields), OpenAI + Compatible (`:1292`: F15, "unless Translate-WebRTC comes first"); the Soniox plan's "Found here" (`:1740-1747`) and "Before any release" (`:1751-1765`); the Kizuna Soniox plan's "Before any release" (`:2318-2343`: the relay twins deleted, not ported); the Gemini plan's section (`:2499-3093`: its open questions `:3005-3022`, its inheritance table `:3037-3080`, "What it leaves" `:3082-3093`); the Volcengine AST2 plan's section (`:3094-3835`: "Found during execution" `:3560-3668`, "Before any release" `:3697-3718`, its open questions `:3744-3758`, V2's inventory `:3760-3771`, its inheritance table `:3773-3819`, "What it leaves" `:3821-3835`). The section "The roadmap's inheritance, item by item" below carries each.
- **The Gemini plan** (`docs/superpowers/plans/2026-09-28-client-contract-stage2-gemini.md`) and **the Volcengine AST2 plan** (`docs/superpowers/plans/2026-09-28-client-contract-stage2-volcengine-ast2.md`) have both landed in full with their final fix waves. What this plan takes from them is listed, by their landed names, in "What this plan consumes from the earlier plans". They are also this plan's form models.

## Global Constraints

- **Starting point.** HEAD `8db4261f` on `worktree-client-contract-stage2`. Every task anchors its edits by content, not by line: a line number cited here was read at `8db4261f`.
- **Edits shown as diffs.** A change to an existing file is a unified diff with its context lines, generated from the scratch copy (research notes); its hunk headers count the lines at `8db4261f`. Apply a hunk by its content all the same. A new file is shown in full.
- **What this plan touches:**
  - `src/lib/view/{noticeText,noticeTargets}.ts`, `src/lib/diagnostics/redact.ts` and their tests, and `src/stores/logStore.test.ts` (a case; `logStore.ts` is not edited) — Task 1;
  - `src/components/providers/fields/NoiseReductionField.tsx` (+ test) — Task 2;
  - `src/providers/openai_translate/**` (new) — Tasks 3–10;
  - `src/providers/sessionSide.consistency.test.ts` — Task 9;
  - `src/providers/registry.ts` (+ test), `src/components/SetupWizard/providerPaths.test.ts`, `src/providers/volcengine_ast2/provider.test.ts` (Doubao's order case) — Task 10;
  - the spec and the roadmap — Task 11.
- **Read only.** `src/services/**` (the old client, its WebRTC sibling, the descriptor, the relay twin and `EphemeralTokenService` are ported by copying, never imported); the old settings UI (`ProviderSpecificSettings.tsx`, `ProviderSection.tsx`, `LanguageSection.tsx`); `src/stores/settingsStore.ts`, `src/stores/logStore.ts`, `src/stores/providerStore.ts`; `src/lib/provider/**`, `src/lib/contract/**`, `src/lib/session/**` (no contract change); the 30 locale catalogs (no new key); `electron/**` and `extension/**` (no header, no background change; the manifest already lists `wss://api.openai.com/*` and the CSP's `https://api.openai.com` and `wss://api.openai.com`, `extension/manifest.json:38, 116`); `package.json` and the lockfile. `npx vitest run src/services` stays green.
- **Import rules:**
  - `src/lib/**` never imports React or `src/app/**`. `src/lib/contract/testing/**` is test-only; so is `src/providers/openai_translate/testing.ts` (the session-side guard's kit rule).
  - A provider's session side — `adapter.ts` and every file of its folder it reaches by a value import — imports no store and no reporter and runs no global timer: every timer reads the request's clock (`clock.setTimeout`, `every(clock, …)`, `clock.now()`). Translate's session side is `adapter.ts`, `segments.ts`, `socket.ts`, `tail.ts` and `wire.ts`; `adapter.ts`, `segments.ts` and `wire.ts` import `config.ts` and `settings.ts` **as types only**. `check.ts` is the settings side and keeps its own clock; nothing on the session side imports it.
  - **The SDK as types only:** `openai/resources/realtime/realtime` is imported with `import type` in `wire.ts` and `adapter.ts`, erased from every bundle.
  - New code imports nothing from `src/services/**`, `src/stores/settingsStore` or another provider's folder (choice 4). Both fakes reach a bundle only through the registry's `import.meta.env.DEV` literal (D24).
- **Diagnostics** (CLAUDE.md, "Error Handling"): the adapter never reports and never logs; it says what happened through `failed`, `closed`, `degraded` (`parse_error`, `tts_degraded`) and `frame`. A socket's `error` event and a mid-session server `error` are Logs-only frames (ruling 3). The check throws when it could not find out; the readiness store reports it.
- **The key** rides in the second subprotocol (ruling 16). Neither the key nor the subprotocols are put in a frame, an error, a notice or a log line of ours; `translateProtocols` is the one function in `wire.ts` that reads the key (pinned by a scan, Task 4), and `adapter.ts` passes the credentials through without reading them; and `redact()` masks the subprotocol wherever it reaches a sink anyway (Task 1). The URL carries no credential. A browser that refuses the socket quotes the subprotocol in its `SyntaxError`: the seam rethrows in fixed words (Task 4), and the start rejects in them (Task 9).
- **Frames** (ruling 20; choice 12) are `domain.event`, never audio, never the key or the subprotocols: out — `session.opened`, `session.update`, `turn.tail`, `turn.tail_end`; in — `session.created`, `session.updated`, `session.input_transcript.delta`, `session.output_transcript.delta`, `session.output_audio.delta` (content only), `session.input_transcript.done`, `session.output_transcript.done`, `session.output_audio.done` (should they ever come), `session.closed`, `session.error`, `session.unknown`, `session.unreadable`, `session.socket_error`, `session.connection_lost`. Every delta frame carries `elapsedMs` (ruling 6). No frame per outgoing append, per heartbeat, or per silent tail frame (the hot-path rule).
- **Locales.** No new key (ruling 18). Every word is an existing key: `notices.<code>` for `auth`, `rate_limit`, `network`, `server`, `client`, `credentials_missing`, `participant_unsupported`, `leg_closed`, `parse_error`, `tts_degraded`; the aliases `connection_lost` (existing) and `no_translate_model` → `settings.translateModelNotAvailable`, `region_unsupported` → `settings.regionNotSupported` (Task 1); the view's `settings.translateInfoBanner`, `settings.noiseReduction`, `settings.noiseReductionTooltip`; the definition's `providers.openai_translate.{name,description}`, `setup.credentials.apiKey`, `simpleSettings.apiKeyPlaceholder` — each checked present and non-empty in all 30 catalogs at `8db4261f`. The noise select shows its raw values ("None", "Near field", "Far field"), as the old one did.
- **No network (ruling 22).** No test, probe or step calls OpenAI. The adapter is tested over `FakeSocket` on a virtual clock; the check over a stub `fetch`. No group check types a key into Translate's field (the readiness driver would call `/v1/models` 800 ms later) or presses Start with Translate selected.
- **Gates for every task:**
  - **The suite.** `npx vitest run src` shows 0 failed and no unhandled errors. Measured at `8db4261f` on 2026-09-28: **527 test files passed and 1 skipped (528); 6 730 tests passed and 2 skipped (6 732); no unhandled errors.** The scratch copy after Wave 3: 537 files passed and 1 skipped, 6 846 tests passed and 2 skipped; with every task applied: 538 files passed and 1 skipped, 6 853 tests passed and 2 skipped — references, not the gate: the gate is the rule.
  - **The typecheck.** The gate prints exactly the baseline lines below. The shell's `grep` is a ugrep wrapper that mis-parses this regex, so use `command grep` exactly as written. The regex is the Volcengine AST2 plan's, unchanged: every file this plan creates or edits is already inside it (research notes).

    ```
    npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts|diagnostics/(consoleLedger|clientDiagnostics|redact))|lib/modern-audio/BaseAudioRecorder|providers|services/(clients/(SonioxSttStream|SonioxTtsStream|PcmMixer|SonioxSideTracker|SonioxTtsRest|SonioxVoicesClient|SonioxClient|ManagedVoicesClient|managedVoicePolling|VolcengineAST2Client|volcengine-ast2/ast2-proto\.d)|providers/(SonioxProviderConfig|KizunaAISonioxProviderConfig|managedVoicePrep|managedVoicePrep\.test|prepareToStart\.kizunaSoniox\.test))\.ts|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|MainPanel\.|panel/|SessionCountdown)|MainLayout/(MainLayout|useSignInProviderSwitch)|Settings/(Settings\.tsx|ProviderArea|SimpleSettings/SimpleSettings\.tsx|AdvancedSettings/AdvancedSettings\.tsx|sections/((SpeechSection|VoiceLibrarySection)(\.test)?\.tsx|(ParticipantSpeechSwitch(\.test)?|SentenceSegmentationSection|SystemAudioSection|SonioxVoiceSection|ProviderSpecificSettings)\.tsx|voiceLibrarySource(\.test)?\.ts))|SettingsInitializer/|SetupWizard/(SetupWizard(\.test)?\.tsx|(setupDraft|applySetup|useApplySetup)(\.test)?\.ts|providerPaths(\.test|\.managedFit\.test)?\.ts|steps/(StepLanguagePair|StepLanguagePair\.test|StepCredentials|StepCredentials\.test|StepFinish|StepProviderPath|StepScenario)\.tsx)|TitleBar/(AccountButton(\.test)?\.tsx|useBalanceShortfall)|Tour/useStartBasicsTour\.ts|dev/(SpinePreview|SessionControls|OverlayPreview|wireTally|gapCounter))|contexts/UserProfileContext|locales/(index\.ts|showLanguageUncached)|routes/Home\.tsx|stores/(providerStore|turnModeStore|routingStore|accountStore|logStore|settingsStore\.ts)|utils/(environment|conversationExport)|subtitle-overlay-entry|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
    ```

    **The baseline** — exactly these **20** lines, re-measured at `8db4261f` (the AST2 plan's own 20; **259** lines in the full tree):

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

    Do not fix them; do not add to them.
  - **Gates in a parallel wave** (as the earlier Stage 2 plans). Waves run tasks at once in this one working tree, so each task sees the others' red phases:
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
    - `command grep -rlF 'The leased fake refused the lease' build extension/dist`
  - The Translate check: `command grep -rlF 'turn.tail_end' build extension/dist` — at group check A it prints nothing (the adapter is not registered yet); at group check B it names at least one file under `build/` and one under `extension/dist/`, the new adapter shipped in both. Nothing under `src`, `electron` or `extension/background` holds that string at `8db4261f` (checked), and Task 1's `logStore.test.ts` case, which names it, is a test.
- **Dev servers, probes and builds** are the controller's; an implementer never starts one. Checks run against a fresh vite: `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort --force`. Restart it after edits: a worktree's vite can serve stale transforms.
- **Shell forms.** This worktree's guard refuses compound shell forms: brace groups, loops, `cd … &&` chains. Every command in this plan is a single command or a plain pipeline, run as its own call from the worktree root. Use `command grep`. The shell is zsh: quote globs; `echo ====` is an error. Checks write their outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, never `/tmp`, each agent in a directory named for its task and role (`t9-impl/`, `t5-review/`; the AST2 execution's rule).
- **Commits:**
  - Conventional, in English. Every message ends with the implementing model's own `Co-Authored-By:` line, then `Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe`, and nothing after it. The examples below write the first as `Co-Authored-By: <implementing model> <noreply@anthropic.com>`: fill in your own model's name.
  - Run `git add <paths>`, then `git commit -q -F - -- <the same paths> <<'EOF' … EOF`, as two separate calls. The `--` pathspec is mandatory: parallel tasks stage into the same index. Never stage a whole directory that is not wholly the task's.
  - Production comments cite rulings, choices, D rulings and F items — never a task number or a review finding (the AST2 plan's final fix wave, `45e49a6e`). The one exception is Task 3's `adapter.ts` seed, which Task 9 replaces.
  - Never push.

## Rulings

Cited as *ruling N*. Rulings 1–15 are the owner's decisions (2026-09-28); 16–23 the controller's. Each is restated with where it lands.

1. **Transport scope: WebSocket only.** A stored `webrtc` choice runs over WebSocket until the WebRTC step; no transport control shows. Lands in: Task 3 (`S.transportType` read and kept, `C.transport: 'websocket'`; choice 15), Task 8 (no control), Task 10 (an old profile's WebRTC choice), Task 11 (live-test item 15).
2. **Push-to-talk's release tail.** On `endTurn` — and on `cancelTurn`, for the reason choice 7 gives — send the held remainder padded to the next **200 ms** boundary, then keep sending **silence in real time** until the translation output has been quiet for **1 s**, capped at **3 s** after the release; a new press ends the tail at once. The endpoint has no commit and no server VAD, processes 200 ms frames, buffers a shorter chunk, and advises appending silence (research Q1). Both numbers are constants the live test tunes. No idle keepalive until the live test shows a dropped session or a stuck tail. Lands in: Task 6 (`ReleaseTail`, `TAIL_QUIET_MS`, `TAIL_MAX_MS`), Task 9 (the release, `turn.tail` / `turn.tail_end`), Task 11 (live-test items 8, 9).
3. **A mid-session `error` event: Logs only** (a frame), the session running on; its words kept for the close that may follow. Lands in: Task 9 (choice 9: `ERROR_WORDS_MS`, `recentError()`), Task 11 (item 12).
4. **Text only is offered as a playback control:** `speech: 'optional'` — the Text only switch shows for this provider, and when a leg does not speak the adapter drops the translated audio it still receives (the API cannot turn audio off and still bills it — research Q2). A stated departure: the old app hid the switch for this provider. Lands in: Task 3 (`C` is the same speaking or not), Task 5 (choice 5), Task 9, Task 10 (the definition; the wizard's fit), Task 11 (item 5).
5. **The participant speaks** when its participant-speech switch is on, as Gemini's and Doubao's; off, its audio is dropped as today. Nothing to build: the definition sets no `participantSpeech`, so `contextsFor` gives the participant `speech = participantSpeech`. Lands in: Task 10 (the participant case), Task 11 (item 13).
6. **Pairing:** proximity pairing through F16 and arrival-time audio ranges, emitting no `timing`; **`elapsedMs` framed on every delta frame** (input transcript, output transcript, content output audio; heartbeats unframed, as research Q3's design) so the live test can settle what it measures. If the log shows one aligned timeline, a follow-up plan sets `timing` at segment close and extends F16 to window timed pairs (research Q3). Lands in: Task 4 (`elapsedMsOf`), Task 5 (choice 6), Task 9 (the frames; a projection case), Task 11 (item 6; "What this plan leaves").
7. **The model select goes:** the session always runs `gpt-realtime-translate`; the check still requires the model family. Lands in: Task 3 (`TRANSLATE_MODEL`, `isTranslateModelId`), Task 7, Task 8.
8. **The transcript-model select goes:** `gpt-live-transcribe` is a constant. Lands in: Task 3 (`TRANSCRIPT_MODEL`; a stored one unread), Task 4 (`sessionUpdate`), Task 8.
9. **Noise reduction "None" sends `null`** (disables), not an omitted field. Lands in: Task 3 (`C.noiseReduction`), Task 4 (`sessionUpdate`).
10. **The OpenAI-key prefill on first selection is dropped:** the user enters the key. Nothing to build — `providerStore` reads only the provider's own keys (`settings.openaiTranslate.apiKey`), and existing users already hold the copy. Lands in: Task 11 (a stated departure).
11. **The registry position:** after Doubao AST 2.0, before Soniox — `['kizunaai_soniox', 'localInference', 'gemini', 'volcengine_ast2', 'openai_translate', 'soniox']`, the released app's relative order (research Q4); unflagged (D19). The order pins move, Doubao's own "before Soniox" case included. Lands in: Task 10.
12. **The setup guide link:** the OpenAI setup guide (same key). Lands in: Task 10.
13. **Session expiry or a drop: end the run in words** (parity: no reconnect); the live test's long session decides a follow-up. Lands in: Task 9 (`connection_lost`; the server's `session.closed` as `closed`), Task 11 (item 11).
14. **Deletion timing:** the relay twin after this port's live test (T2); the own-key old code after the WebRTC step's live test (T3). Lands in: Task 11 (both inventories; choice 19).
15. **Same-language pairs stay offered; `auto` stays out of the sources** (parity). Lands in: Task 3.
16. **The key rides in the `openai-insecure-api-key.<key>` WebSocket subprotocol** (survey §0.2): no header seam, no ephemeral token, all three platforms. The socket seam uses **fixed words** on a constructor throw — a key that is not a valid subprotocol token makes the browser quote it — exactly as the AST2 plan's final fix wave did for Doubao and Gemini (`nativeSocket`'s rethrow keeping only the error's name, `7f3dded6`). The key never reaches a frame, an error, a notice or a log line; whether `redact.ts` needs the subprotocol form is choice 3. Lands in: Task 1 (the redaction), Task 4 (`translateProtocols`, `socket.ts`), Task 9 (the start's refusal), Task 11 (item 2).
17. **The segment machine reuses Gemini Live Translate's per-side silence-timer machine** where it fits (survey §0.6), consumed by its landed names, or with what is copied, and why it cannot be shared, stated precisely: choice 4. Lands in: Task 5.
18. **`check` is the bounded `/v1/models` call**, with two new `NOTICE_ALIASES` rows and no new locale key. Lands in: Task 1 (the aliases), Task 7 (choice 11).
19. **The Settings view from shared fields**, with the new shared `NoiseReductionField` (survey §0.7) in the fields folder's conventions. Lands in: Tasks 2, 8 (choice 13).
20. **Frames, their Logs grouping, and the hot-path rule.** Lands in: Task 1 (the Logs pin), Task 9 (choice 12).
21. **Timers on the request's clock only; `every()` for the real-time silence tail.** Lands in: Tasks 5, 6, 9.
22. **No network in tests:** the adapter over `FakeSocket` on a virtual clock, the check over a stub `fetch`. Lands in: Global Constraints; every task.
23. **The last task is the controller's docs task** (Task 11): the spec's amendments — Text only as a playback control for a provider that always produces audio, the release tail on an endpoint with no commit, the subprotocol credential, and survey §3.6's corrections — and the roadmap section "Scheduled by the Stage 2 OpenAI Translate plan", with the owner's live test and both deletion inventories.

## Choices this plan makes inside the rulings

Cited as *choice N*.

1. **The start resolves on `session.updated`** (survey §2.13.1): the configuration confirmed, not merely the socket's session created. A refused configuration then fails the start in OpenAI's words, where the old client sent `session.update` unconfirmed and ran on the server's defaults (survey §1.14.4). `session.created` sends `session.update`; an `error` event before `session.updated` rejects with its code (choice 9) and OpenAI's words.
2. **The start's bound:** `START_TIMEOUT_MS` = 30 s (parity, `GA:771`), on the request's clock, closing the socket on every path (the old timeout left it open, survey §1.14.3) — `network` when the socket never opened ("OpenAI did not open the connection within 30 s."), `server` when it did ("OpenAI did not start the session within 30 s."). A socket that fails before it opens is `network`, in words naming both possible causes, since a browser cannot read why: `NEVER_OPENED` = "OpenAI's socket did not open (check the network, and that the API key is still valid)." — the check has validated the key already, so the network is the likelier cause (survey §2.9; the live test records what a revoked key does at the upgrade, item 2). A close after the socket opened and before the start: `server`, "OpenAI closed the connection before the session started (<code> <reason>)."; the server's `session.closed` then: `server`, "OpenAI closed the session before it started." A clean close before `session.created` now rejects at once, where the old start hung 30 s (survey §1.14.2).
3. **The key's path** (ruling 16): `wire.ts`' `translateProtocols(k)` returns `['realtime', 'openai-insecure-api-key.<key>']` — never the beta tag, which the endpoint refuses — and is the one function in `wire.ts` that names the key (a TypeScript-AST scan of `wire.ts`, Doubao's shape); `adapter.ts` passes the credentials through to it without reading them. The provider's own `socket.ts` takes the protocols and rethrows a constructor failure as `The browser would not open the socket (<name>).`, keeping the error's name. **`redact()` gains the subprotocol as a carrier**, `(\bopenai-insecure-api-key\.)[A-Za-z0-9._~+/=-]+` → `$1[REDACTED]`, beside `sokuji-auth.`: the bare `sk-` rule already masks an OpenAI key there, but not a key of another shape, and a pasted key of any shape reaches the subprotocol (survey §2.10: "optional"; decided yes — the rule names its producer, and the literal prefix makes a false positive implausible). Its comment neighbour's drifted `GA:501` becomes `:707`.
4. **The segment machine is Translate's own `segments.ts`, a copy of Gemini's Live Translate half** (ruling 17). Consumed by its landed names: `SilenceDeferral` (`src/lib/segmentation/silenceDeferral.ts`), `segmentPauseMs` and `clampSegmentPauseMs` (`segmentationMode.ts`), and `C.silence`'s shape exactly as `buildGemini` builds it (`{ sourceMs, translationMs, deferMidSentence }`, Gemini choice 7). **Copied** from `GeminiTurns` (`src/providers/gemini/turns.ts`): the per-side `ensure` / `close` / `arm` / `cancel` and the deferral at expiry, about forty lines. **Not shared, for three reasons:** (a) the audio rule is the reverse — Translate's content audio opens a translation segment when none is open and re-arms its timer (parity, `GA:563, 626`), where Gemini's never re-arms and plays ref-less outside an open one (Gemini choice 8); (b) Translate's audio carries a range (ruling 6), Gemini's none; (c) `GeminiTurns` is one class whose Live Translate half shares its fields with the dialogue models' turns, cancels and suppressions, and importing it would put another provider's session module on Translate's session side, where the session-side guard does not follow it (research notes). Lifting a shared base to `src/lib/` would mean reworking Gemini's landed, live-tested machine for a two-user abstraction. Translate's WebRTC step feeds the same `segments.ts`: no third copy.
5. **Content audio holds the translation, played or not** (ruling 4): `segments.audio(pcm, play)` opens the translation segment when none is open and re-arms its timer whether it plays or not; `play` is `context.speech` and the rate being the contract's. So Text only changes playback and nothing else — the same rows, the same `session.update` — and the Logs still show the audio deltas the API sent and billed.
6. **Karaoke by arrival** (ruling 6): a played frame's range is `[the previous played frame's end, the translation text's length when the frame arrives]` — the old `audioSegments` (`GA:586-613`, issue #216). Ranges ascend per ref from 0 and never overlap; audio before any text carries `[0, 0]`; a closed translation's late audio opens the next translation segment, its ranges from 0 again (parity: the old client opened a new item). It is an alignment by arrival, not a known correspondence: a stated exception to the spec's honesty rule, which Task 11 records.
7. **The release tail** (ruling 2), a pure `ReleaseTail` in `tail.ts` on the request's clock, driven by the adapter:
   - `padSamples(sent)` = `(4800 − sent % 4800) % 4800` zeros, sent at once as one append; `sent` counts every sample the session appended, pads and silence included, so the grid holds across presses;
   - then `every(clock, 200, tick)`: each tick first ends the tail when the translation has been quiet for more than `TAIL_QUIET_MS` (1 000) — quiet counted from the later of the release and the translation's last output text or content audio during the tail — or when more than `TAIL_MAX_MS` (3 000) passed since the release; otherwise it sends one 4 800-sample frame of silence. With no output the tail sends five frames (1 s); it never sends more than fifteen (3 s);
   - **on `cancelTurn` too:** Translate has no clear (`SDK:3032`), so what the cancelled press appended is the model's input already; without the pad and the silence, its sub-frame remainder and any words the model still owes (a few words under the voice gate's threshold) would splice onto the next press as contiguous model time (research Q1). The frames say `cancelled: true`;
   - a press (`beginTurn`) or a chunk of audio ends a running tail at once, before anything of the press goes up; a stop, a failure or a close ends it silently;
   - only under manual turns (`context.turns === 'manual'`): under automatic turns the turn keys send nothing;
   - framed out: `turn.tail` `{ padSamples, cancelled? }` at the release, and `turn.tail_end` `{ reason: 'quiet' | 'cap' | 'press' | 'audio', silenceMs, lastOutputMs, cancelled? }` when it ends — `lastOutputMs` is the translation's last output after the release, from the release, or null: the numbers the live test tunes the two constants by.
8. **`pcmToBase64` and `base64ToPcm` are copied from Gemini's wire** (survey §2.13.4), with the text-or-ArrayBuffer decode: the second user. Lifting them to `src/lib/contract/` edits Gemini's landed wire and waits for a third user (OpenAI Realtime or OpenAI Live), as `trackedClock` waited for its third. `base64ToPcm` drops an odd trailing byte, where the old decoder threw (survey §1.14.10).
9. **Failures in words and codes:**
   - a server `error`'s code: `invalid_api_key` → `auth`; `rate_limit_exceeded` or `insufficient_quota` → `rate_limit`; `type === 'invalid_request_error'` → `client`; anything else → `server` — a hypothesis the live test's `session.error` frames settle (item 12). Its words: `[OpenAI <code, else type>] <message>`, the `{{detail}}` of `notices.<code>`;
   - before the start it refuses the start (choice 1); mid-session it is a frame and is remembered (ruling 3);
   - a mid-session `error` is remembered with its time: a close that follows it within `ERROR_WORDS_MS` (10 000 — a starting value the live test tunes, item 12) is that error's, whatever its code, and fails the run with its code and words, so a key revoked, a quota spent or a request refused mid-session reads as its cause. A close later than that is the connection's own: an error an hour old never words an unrelated drop;
   - an unexpected socket close mid-session fails the run with a recent error's code and words, else with `connection_lost` — the existing alias, "The connection was interrupted — tap Start Session in a moment to continue.";
   - the server's `session.closed` mid-session likewise fails the run in a recent error's words — the server answering an error with its own close — and otherwise closes it (`closed`, reason `session.closed`, `notices.leg_closed`: "The provider ended the session.", its expiry perhaps); the socket's close after it is unheard (ruling 13);
   - a mid-session `error` neither fails nor degrades the run by itself (ruling 3: Logs only), pinned in Task 9.
10. **`describe(c)` = `{ translationModel: 'gpt-realtime-translate', asrModel: 'gpt-live-transcribe' }`** (survey §2.7): the source transcript runs on its own model. The old start event reported no model for Translate.
11. **The check** (ruling 18): `GET https://api.openai.com/v1/models` with `Authorization: Bearer <key>` and nothing else, bounded by `CHECK_TIMEOUT_MS` = 15 s (as Soniox's, Gemini's and Doubao's) and the caller's signal, on an injected `fetch` and clock. It answers: ids starting `gpt-realtime-translate` (case-insensitive, `OpenAIClient.ts:265-267`) → ready, newest `created` first, each id once; none → `{ ok: false, code: 'no_translate_model' }`, aliased to `settings.translateModelNotAvailable`; `error.code === 'unsupported_country_region_territory'` at any status → `region_unsupported`, aliased to `settings.regionNotSupported` (the sentence names no vendor); 401 or 403 → `auth` with `HTTP <status>: <OpenAI's message>`; 429 → `rate_limit`; any other status, a failed fetch, the bound or the abort → it throws (not ready, Start off). Both codes point at the provider section (`NOTICE_TARGETS`). A settings edit re-checks 800 ms later; only the noise select can make one, and the list is free.
12. **Frames and their Logs rows** (ruling 20): the list in Global Constraints. The owner's ruling 6 asks for `elapsedMs` on every delta frame, the output audio's included: content audio deltas are framed — `{ samples, rms, elapsedMs, sampleRate }`, never the base64 — as wire traffic the Logs group under their own type, as Gemini's `server_content.model_turn` is. The hot-path rule holds for what goes up and for what carries nothing: no frame per append, per heartbeat, or per silent tail frame (the old client framed every non-silent append). `logStore.ts` needs no row; Task 1 pins that its `.delta` rule groups the three delta types each under its own name, and that none of Translate's other names takes a key — so none lands under Doubao's rows (the AST2 plan's "What it leaves").
13. **`NoiseReductionField`** (ruling 19): the old noise section's markup (`ProviderSpecificSettings.tsx:807-840`) — `settings-section` › `h2` with `settings.noiseReduction` and its tooltip › `setting-item` › one `select-dropdown` — generic over its values, which it shows raw as the old select did, with an `aria-label` as `VoiceField`'s select has. Translate's view draws the old info banner byte for byte (`ProviderSpecificSettings.tsx:2173-2183`), first, then the field.
14. **The key is trimmed** (survey §2.3): a pasted key with a trailing newline or space is no valid subprotocol token, and the constructor would throw. The missing words are the runner's `credentials_missing`.
15. **`C.transport: 'websocket'`, and `S.transportType` kept** (ruling 1): `S` reads and migrates `transportType` (`'websocket' | 'webrtc'`), shows it nowhere and does not read it in `build`; `C.transport` is the literal `'websocket'`, and the adapter's `info.transport` reads it, so the WebRTC step widens `C.transport` from `S.transportType`, adds its transport and a dispatch in `start`, and changes nothing else.
16. **An output rate other than 24 kHz** (survey §2.9; Gemini choice 18): a content frame whose `sample_rate` is not 24 000 is not played; a speaking leg says `tts_degraded` once per session (`reason: 'audio_rate_<rate>'`); it still holds the translation open (choice 5). A frame naming no rate is 24 kHz (`GA:604`).
17. **Decoding:** `binaryType = 'arraybuffer'`, and a frame is text or an ArrayBuffer of JSON, an object with a string `type` (Gemini's rule). An unreadable frame is framed `session.unreadable` and said `parse_error` on the ok → failing transition only, re-armed by the next frame that parses; an audio delta whose base64 will not decode is its own episode, re-armed by the next that decodes (Gemini's `partsReadable`), since every frame that parses re-arms the first.
18. **The `.done` events:** the SDK lists none, and the old client's three cases are probably dead (survey §0.3). Kept, cheaply: `session.input_transcript.done` closes the source segment, `session.output_transcript.done` and `session.output_audio.done` the translation, each framed under its own type, so the live test sees whether any arrives (item 6). Any other type is framed `session.unknown` `{ type }`.
19. **Two deletion plans** (ruling 14): **T2**, the relay twin `kizunaai_openai_translate`, after this port's live test; **T3**, the own-key old code of both transports, after the WebRTC step's live test. Task 11 records both inventories.

## What this plan consumes from the earlier plans

Named as landed, so a reconciliation is mechanical. Where a landed name or text differs from what is quoted here, the implementer follows the landed one and reports it.

| From | What it is | Consumed by |
|---|---|---|
| The Gemini plan's Task 2 (`6ac92cce`, fix round `70e53f18`): `inferPairs(segments, t)` and `createPairCache` in `src/lib/projection/pair.ts`, used by `createProjector` | L2's windowed proximity pairing (F16) | Task 9's projection case, through `createProjector().project(…)`; nothing here calls either directly |
| The Gemini plan's `GeminiTurns` (`src/providers/gemini/turns.ts`): its Live Translate half — `ensure`, `close`, `arm`, `cancel`, one `SilenceDeferral` per side | the per-side silence machine | Task 5 copies it (choice 4); no import |
| The Gemini plan's `buildGemini`: `silence: { sourceMs: clampSegmentPauseMs(segmentPauseMs(shared.pauses.sourceSeconds)), translationMs: …, deferMidSentence: shared.segmentation.mode === 'sentences' }` | the silence config | Task 3's `buildTranslate`, the same expression |
| The Gemini plan's `wire.ts`: `pcmToBase64`, `base64ToPcm`, `decodeServerMessage`'s text-or-ArrayBuffer rule | the wire helpers | Task 4 copies them (choice 8) |
| The AST2 plan's final fix wave (`7f3dded6`): `nativeSocket` rethrowing `The browser would not open the socket (<name>).` with the error's `name`; the adapter's `errorName` and its fixed-words rejection | the socket seam | Task 4 (`socket.ts`, with protocols), Task 9 (`start`) |
| The AST2 plan's Task 12 (`e4ec0d34`): `trackedClock` in `src/lib/contract/testing/trackedClock.ts`; `wire.test.ts`' `secretReaders` scan | the tracked clock; the one-reader-of-the-key pin | Tasks 4, 5, 6, 9 |
| The AST2 plan's Task 15 (`4aa833ca`, `c2f87879`): the leg's shape — `phase`, `refuse`, `end`, `shutDown` nulling the socket's four handlers, the abort listener removed once the start settles | the adapter's skeleton | Task 9 |
| The AST2 plan's Task 16 (`fa471bb9`): `RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, sonioxProvider]`, the order case, `ownKeyOptions('understand-others')` → `['gemini', 'volcengine_ast2', 'soniox', 'fake']`, and Doubao's "sits after Gemini and before Soniox (ruling 5)" | the registry and its pins | Task 10 inserts `openaiTranslateProvider` before `sonioxProvider` and narrows Doubao's case |
| The AST2 plan's Task 3 (`d497be72`): `LanguageContext` and the registry invariant that each context's offer lies within the widest | the language context | Task 3: Translate's functions ignore it — the same offer in every context, which the invariant accepts (Task 10) |
| The kit: `FakeSocket` (records `url` and `protocols`; `open(protocol)`, `receive`, `drop`, `serverClose`, `sentJson`), `fakeSockets`, `driveAdapter`, `runScenario`, `scenarioNames`, `recordEvents`, `framePayload`, `every`, `AdapterStartError` | the adapter test kit and the contract | Tasks 4–9 |

## File Structure

| File | Task | Change |
|---|---|---|
| `src/lib/view/{noticeText,noticeTargets}.ts`, `src/lib/diagnostics/redact.ts` (+ tests), `src/stores/logStore.test.ts` | 1 | two aliases and their targets; the subprotocol's redaction; the Logs pin |
| `src/components/providers/fields/NoiseReductionField.tsx` (+ test) | 2 | the shared noise field |
| `src/providers/openai_translate/{settings,config,adapter}.ts` (+ `settings.test.ts`, `config.test.ts`) | 3 | `S`, constants, languages, `K`; `C`, the builder; the `adapter.ts` seed |
| `src/providers/openai_translate/{wire,socket,testing}.ts` (+ `wire.test.ts`, `socket.test.ts`) | 4 | the wire, the socket seam, the fixtures |
| `src/providers/openai_translate/segments.ts` (+ test) | 5 | deltas → segments |
| `src/providers/openai_translate/tail.ts` (+ test) | 6 | the release tail |
| `src/providers/openai_translate/check.ts` (+ test) | 7 | the bounded model list |
| `src/providers/openai_translate/TranslateSettings.tsx` (+ test) | 8 | Translate's own settings view |
| `src/providers/openai_translate/adapter.ts` (replaced), `adapter.test.ts`, `testing.ts` (the harness), `src/providers/sessionSide.consistency.test.ts` | 9 | the adapter |
| `src/providers/openai_translate/provider.ts` (+ test), `src/providers/registry.ts` (+ test), `src/components/SetupWizard/providerPaths.test.ts`, `src/providers/volcengine_ast2/provider.test.ts` | 10 | the definition, registered fifth; the order pins moved |
| the spec, the roadmap | 11 | the controller's amendments and record |

**Order and parallelism.**
- **Wave 1:** Task 1 (the words, the redaction, the Logs pin), Task 2 (the noise field), Task 3 (settings, builder, seed). Disjoint files. Task 3 writes its `adapter.ts` seed before any other file of the new folder: the session-side guard requires an `adapter.ts` in every folder under `src/providers`. A concurrent task that still sees "every provider keeps its adapter in adapter.ts" fail names it as Task 3's work in progress and does not touch the guard.
- **Wave 2:** Task 4 (needs Task 3's `C`, `K` and builder), Task 5 (Task 3's `C`), Task 6 (Task 3's folder), Task 7 (Task 3's `K` and `isTranslateModelId`), Task 8 (Tasks 2, 3). Disjoint files: Task 4 alone writes `testing.ts`, and no other Wave 2 test imports it.
- **Wave 3:** Task 9 (needs Tasks 4, 5, 6; replaces the seed, appends the harness to `testing.ts`).
- **Group check A** (controller) after Wave 3: the adapter, the check and the settings view are complete; nothing is registered.
- **Wave 4:** Task 10 (needs Tasks 7, 8, 9).
- **Group check B** (controller) after Wave 4.
- **Task 11** (controller) last.

---

## Wave 1

### Task 1: The check's words, the subprotocol's redaction, and the Logs pin (rulings 16, 18, 20; choices 3, 11, 12)

**Files:**
- Modify: `src/lib/view/noticeText.ts`, `src/lib/view/noticeTargets.ts`, `src/lib/diagnostics/redact.ts`
- Test: `src/lib/view/noticeText.test.ts`, `src/lib/view/noticeTargets.test.ts`, `src/lib/diagnostics/redact.test.ts`, `src/stores/logStore.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `NOTICE_ALIASES.no_translate_model = 'settings.translateModelNotAvailable'` and `NOTICE_ALIASES.region_unsupported = 'settings.regionNotSupported'`; `NOTICE_TARGETS.no_translate_model = 'provider'` and `NOTICE_TARGETS.region_unsupported = 'provider'`; `redact()` masking `openai-insecure-api-key.<anything>` as `openai-insecure-api-key.[REDACTED]`.
- Consumed by: Task 7 (the two codes), Task 4 (the wire test's redaction case), Task 9 (the kit's `frame-secret` rule reads `redact()`), Task 10.

Both sentences exist, non-empty, in all 30 catalogs (checked at `8db4261f`), so no catalog changes; `noticeText.test.ts`' "every alias names a sentence in all 30 locales" holds them to it. The `logStore.test.ts` case pins behaviour that already holds — `logStore.ts` is not edited (choice 12) — so it passes at once; it is there so a later change to the Logs' grouping cannot silently file Translate's frames under another provider's rows.

- [ ] **Step 1: Write the failing tests.** The four test files' hunks:

```diff
--- a/src/lib/view/noticeText.test.ts
+++ b/src/lib/view/noticeText.test.ts
@@ -101,6 +101,14 @@
     expect(at(enCatalog, NOTICE_ALIASES.models_required)).toBe('Models are required. Please validate your API key first to load available models.');
   });
 
+  it("words OpenAI Translate's two check codes with the old validation's sentences, which every locale already has", () => {
+    const enCatalog = en as unknown as Record<string, unknown>;
+    expect(noticeText(t, { code: 'no_translate_model', message: 'x' })).toMatch(/^settings\.translateModelNotAvailable\|/);
+    expect(noticeText(t, { code: 'region_unsupported', message: 'x' })).toMatch(/^settings\.regionNotSupported\|/);
+    expect(at(enCatalog, NOTICE_ALIASES.no_translate_model)).toBe('API key works, but gpt-realtime-translate is not accessible with this key.');
+    expect(at(enCatalog, NOTICE_ALIASES.region_unsupported)).toBe('Service not available in your region. Please check your network environment or try a different provider.');
+  });
+
   it("puts the local engines' notices into words", () => {
     for (const code of ['no_asr', 'memory_exceeded', 'gpu_out_of_memory', 'transcription_failed', 'translation_failed', 'translation_unavailable']) {
       expect(NOTICE_WORDS[code]).toBeDefined();
```

```diff
--- a/src/lib/view/noticeTargets.test.ts
+++ b/src/lib/view/noticeTargets.test.ts
@@ -40,6 +40,11 @@
     expect(settingsTargetForCode('models_required')).toBe('provider');
   });
 
+  it("sends OpenAI Translate's check codes to the provider section, where its key and the provider choice are", () => {
+    expect(settingsTargetForCode('no_translate_model')).toBe('provider');
+    expect(settingsTargetForCode('region_unsupported')).toBe('provider');
+  });
+
   it('has words for every code it targets, its own or an alias — an action never sits beside an unworded notice', () => {
     for (const code of Object.keys(NOTICE_TARGETS)) {
       expect(NOTICE_WORDS[code] ?? NOTICE_ALIASES[code], code).toBeDefined();
```

```diff
--- a/src/lib/diagnostics/redact.test.ts
+++ b/src/lib/diagnostics/redact.test.ts
@@ -76,13 +76,24 @@
       .toBe('Authorization: Bearer [REDACTED]');
   });
 
-  // OpenAITranslateGAClient.ts:501 — `sokuji-auth.${this.apiKey}` is the relay
+  // OpenAITranslateGAClient.ts:707 — `sokuji-auth.${this.apiKey}` is the relay
   // WebSocket subprotocol; the carrier name stays, the token goes.
   it('redacts the relay auth subprotocol token', () => {
     expect(redact('subprotocols: sokuji-auth.sess_TOKEN_VALUE_1234, json'))
       .toBe('subprotocols: sokuji-auth.[REDACTED], json');
   });
 
+  // openai_translate/wire.ts `translateProtocols` — OpenAI Translate's own key
+  // rides in the `openai-insecure-api-key.` subprotocol (Stage 2 OpenAI
+  // Translate, choice 3): the carrier name stays, the key goes, whatever its
+  // shape. The first value has no key shape, so only this rule masks it.
+  it("redacts OpenAI Translate's key subprotocol, keeping the carrier's name", () => {
+    expect(redact('protocols: realtime, openai-insecure-api-key.0a1b2c3d'))
+      .toBe('protocols: realtime, openai-insecure-api-key.[REDACTED]');
+    expect(redact('["realtime","openai-insecure-api-key.sk-proj-abcdefghijklmnop"]'))
+      .toBe('["realtime","openai-insecure-api-key.[REDACTED]"]');
+  });
+
   // Named in #441. UserProfileContext and settingsStore:1121 carry auth errors
   // that can quote the account address.
   it('redacts e-mail addresses', () => {
```

```diff
--- a/src/stores/logStore.test.ts
+++ b/src/stores/logStore.test.ts
@@ -192,6 +192,27 @@
     }
     expect(speaker).toHaveLength(7);
   });
+
+  it("groups OpenAI Translate's delta frames each under its own type, and gives its other frames no key (Stage 2 OpenAI Translate, choice 12)", () => {
+    const add = (type: string) => useLogStore.getState().addRealtimeEvent({ type, data: {} } as any, 'server', type, 'speaker');
+    for (const type of ['session.input_transcript.delta', 'session.output_transcript.delta', 'session.output_audio.delta']) {
+      add(type);
+      add(type);
+    }
+    expect(entriesFor('speaker').map((e) => [e.groupingKey, e.events?.length])).toEqual([
+      ['session.input_transcript.delta', 2],
+      ['session.output_transcript.delta', 2],
+      ['session.output_audio.delta', 2],
+    ]);
+    // None of its other names is a row of Doubao's (`subtitle.*`, `tts.*`, `session.usage`, `session.audio_muted`) or of anyone's: one entry each, ungrouped.
+    const others = [
+      'session.opened', 'session.created', 'session.update', 'session.updated', 'session.closed', 'session.error', 'session.unknown', 'session.unreadable',
+      'session.socket_error', 'session.connection_lost', 'session.input_transcript.done', 'session.output_transcript.done', 'session.output_audio.done',
+      'turn.tail', 'turn.tail_end',
+    ];
+    for (const type of others) add(type);
+    expect(entriesFor('speaker').slice(3).map((e) => [e.eventType, e.groupingKey])).toEqual(others.map((type) => [type, undefined]));
+  });
 });
 
 describe('logStore — channel filing', () => {
```

  (`at` in `noticeText.test.ts` is the file's module-scope helper; the Gemini case above the new one already calls it from inside this `describe`. `entriesFor` is the `describe`'s own helper.)
- [ ] **Step 2: Run** `npx vitest run src/lib/view src/lib/diagnostics/redact.test.ts src/stores/logStore.test.ts` — FAIL: `noticeText` answers the message for the two codes (no alias), `settingsTargetForCode` answers null for them, and `redact` leaves `openai-insecure-api-key.0a1b2c3d` as it is (the value has no key shape). The `logStore` case passes: it pins what holds.
- [ ] **Step 3: Implement.** The three source files' hunks:

```diff
--- a/src/lib/view/noticeText.ts
+++ b/src/lib/view/noticeText.ts
@@ -110,6 +110,9 @@
   // Gemini (Stage 2 Gemini, ruling 13): a key that lists no Live model, and a start with no model to run — the old client's sentences, which name no vendor.
   no_realtime_model: 'settings.realtimeModelNotAvailable',
   models_required: 'mainPanel.modelsRequired',
+  // OpenAI Translate (Stage 2 OpenAI Translate, choice 11): a key that lists no gpt-realtime-translate model, and a region OpenAI does not serve — the old validation's sentences, which every locale already has.
+  no_translate_model: 'settings.translateModelNotAvailable',
+  region_unsupported: 'settings.regionNotSupported',
 };
 
 /** The notice in the user's words; the message itself for a code with no words, as today's bubbles show it. */
```

```diff
--- a/src/lib/view/noticeTargets.ts
+++ b/src/lib/view/noticeTargets.ts
@@ -24,6 +24,9 @@
   // Gemini's model codes (Stage 2 Gemini): the key and the model are the provider section's.
   no_realtime_model: 'provider',
   models_required: 'provider',
+  // OpenAI Translate's check codes (Stage 2 OpenAI Translate): the key, and the choice of another provider, are the provider section's.
+  no_translate_model: 'provider',
+  region_unsupported: 'provider',
 };
 
 export function settingsTargetForCode(code: string | undefined): string | null {
```

```diff
--- a/src/lib/diagnostics/redact.ts
+++ b/src/lib/diagnostics/redact.ts
@@ -44,9 +44,16 @@
   ],
   // `Authorization: Bearer <token>` on every provider fetch.
   [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, `$1${REDACTED}`],
-  // `sokuji-auth.${this.apiKey}` WebSocket subprotocol — OpenAITranslateGAClient.ts:501,
+  // `sokuji-auth.${this.apiKey}` WebSocket subprotocol — OpenAITranslateGAClient.ts:707,
   // VolcengineAST2Client (relay auth).
   [/(\bsokuji-auth\.)[A-Za-z0-9._~+/=-]+/g, `$1${REDACTED}`],
+  // `openai-insecure-api-key.${apiKey}` WebSocket subprotocol — OpenAI
+  // Translate's own key (`openai_translate/wire.ts` `translateProtocols`,
+  // Stage 2 OpenAI Translate, choice 3). The subprotocol is never put in a
+  // frame, an error or a notice, and the bare `sk-` rule below masks an
+  // OpenAI key anyway; this keeps the carrier's name and masks a key of any
+  // shape — a browser that refuses the socket quotes the subprotocol.
+  [/(\bopenai-insecure-api-key\.)[A-Za-z0-9._~+/=-]+/g, `$1${REDACTED}`],
   // Bare provider key shapes. `sk-`/`AIza`/`key-` were already redacted by
   // errorTracking.ts:57; `ek_` is the OpenAI ephemeral client secret
   // (EphemeralTokenService.ts:190), which :200 could otherwise dump wholesale.
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then the full suite and the gate. What the change reaches, and why each stays green:
  - `noticeText.test.ts`' "every alias names a sentence in all 30 locales" and "no code is both an alias and worded under notices", and `noticeTargets.test.ts`' "has words for every code it targets", now cover the two codes;
  - `redact()` runs at the sinks (`logStore.addLog`, `sanitizeEvent`) and in `framePayload`; the conformance kit's `frame-secret` rule calls it, so a frame that carried the subprotocol now fails any adapter's conformance — none carries one;
  - the carrier rule sits before the bare-key rule (carrier first, the file's own order), so `openai-insecure-api-key.sk-…` keeps its carrier's name; every existing `redact.test.ts` case is unchanged.
- [ ] **Step 5: Commit.**

```bash
git add src/lib/view/noticeText.ts src/lib/view/noticeText.test.ts src/lib/view/noticeTargets.ts src/lib/view/noticeTargets.test.ts src/lib/diagnostics/redact.ts src/lib/diagnostics/redact.test.ts src/stores/logStore.test.ts
```

```bash
git commit -q -F - -- src/lib/view/noticeText.ts src/lib/view/noticeText.test.ts src/lib/view/noticeTargets.ts src/lib/view/noticeTargets.test.ts src/lib/diagnostics/redact.ts src/lib/diagnostics/redact.test.ts src/stores/logStore.test.ts <<'EOF'
feat(view): OpenAI Translate's check codes in words, its key subprotocol redacted

no_translate_model and region_unsupported reuse the old validation's
sentences, which every locale has, and point at the provider section.
redact() masks the openai-insecure-api-key subprotocol whatever the key's
shape. A Logs case pins that Translate's delta frames group by their own
type and its other frames take no provider's row.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 2: `NoiseReductionField` — the shared noise field (ruling 19; choice 13)

**Files:**
- Create: `src/components/providers/fields/NoiseReductionField.tsx`
- Test: `src/components/providers/fields/NoiseReductionField.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `NoiseReductionField<V extends string>({ value: V; options: readonly V[]; onChange(value: V): void; disabled?: boolean })`.
- Consumed by: Task 8 (Translate's view); OpenAI Realtime and Compatible next.

The old section (`ProviderSpecificSettings.tsx:807-840`) drew a `settings-section` with an `h2` (`settings.noiseReduction`, its `CircleHelp` tooltip `settings.noiseReductionTooltip`) and one `select-dropdown` of the raw modes, disabled while a session runs. The field copies it, as `VoiceField` copies the old voice section, with an `aria-label` on the select as `VoiceField` has; the section has no Settings target, so no `id`.

- [ ] **Step 1: Write the failing test.** `NoiseReductionField.test.tsx`, in full:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const tooltips: unknown[] = [];
vi.mock('../../Tooltip/Tooltip', () => ({ default: ({ content }: { content: unknown }) => { tooltips.push(content); return null; } }));

import { NoiseReductionField } from './NoiseReductionField';

const MODES = ['None', 'Near field', 'Far field'] as const;

describe('NoiseReductionField', () => {
  it('is the old noise section: a heading with its tooltip, one select of the raw modes, writing the choice', () => {
    const onChange = vi.fn();
    const { container } = render(<NoiseReductionField value="Near field" options={MODES} onChange={onChange} />);
    expect(screen.getByRole('heading', { name: 'settings.noiseReduction' })).toBeInTheDocument();
    expect(tooltips).toContain('settings.noiseReductionTooltip');
    const select = screen.getByLabelText('settings.noiseReduction') as HTMLSelectElement;
    expect(select.className).toBe('select-dropdown');
    expect(select.closest('.setting-item')?.parentElement?.className).toBe('settings-section');
    expect(container.firstElementChild?.className).toBe('settings-section');
    expect(select.value).toBe('Near field');
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([['None', 'None'], ['Near field', 'Near field'], ['Far field', 'Far field']]);
    fireEvent.change(select, { target: { value: 'Far field' } });
    expect(onChange).toHaveBeenCalledWith('Far field');
  });

  it('disabled disables it', () => {
    render(<NoiseReductionField value="None" options={MODES} onChange={vi.fn()} disabled />);
    expect(screen.getByLabelText('settings.noiseReduction')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/components/providers/fields/NoiseReductionField.test.tsx` — FAIL: no `./NoiseReductionField`.
- [ ] **Step 3: Implement.** `NoiseReductionField.tsx`, in full:

```tsx
import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';

export interface NoiseReductionFieldProps<V extends string> {
  value: V;
  /** The provider's values, shown as they are: the old select showed its raw modes too. */
  options: readonly V[];
  onChange(value: V): void;
  disabled?: boolean;
}

/**
 * Input noise reduction (the roadmap's "noise field"; Stage 2 OpenAI
 * Translate, choice 13): the old section
 * (`ProviderSpecificSettings.tsx:807-840`), shared by OpenAI Translate first
 * and OpenAI Realtime and Compatible next.
 */
export function NoiseReductionField<V extends string>({ value, options, onChange, disabled = false }: NoiseReductionFieldProps<V>) {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <h2>
        {t('settings.noiseReduction')}
        <Tooltip content={t('settings.noiseReductionTooltip')} position="top">
          <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
        </Tooltip>
      </h2>
      <div className="setting-item">
        <select className="select-dropdown" aria-label={t('settings.noiseReduction')} value={value} onChange={(e) => onChange(e.target.value as V)} disabled={disabled}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then the full suite and the gate. Nothing imports the field yet.
- [ ] **Step 5: Commit.**

```bash
git add src/components/providers/fields/NoiseReductionField.tsx src/components/providers/fields/NoiseReductionField.test.tsx
```

```bash
git commit -q -F - -- src/components/providers/fields/NoiseReductionField.tsx src/components/providers/fields/NoiseReductionField.test.tsx <<'EOF'
feat(providers): a shared noise reduction field

The old noise section's markup as a field beside VoiceField: a heading
with its tooltip and one select of the provider's own values, shown raw
as before. OpenAI Translate first; OpenAI Realtime and Compatible next.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 3: Translate's settings, languages, credentials and builder; the folder seeded (rulings 1, 4, 5, 7, 8, 9, 15; choices 4, 10, 14, 15)

**Files:**
- Create: `src/providers/openai_translate/adapter.ts` (the seed, first), `src/providers/openai_translate/settings.ts`, `src/providers/openai_translate/config.ts`
- Test: `src/providers/openai_translate/settings.test.ts`, `src/providers/openai_translate/config.test.ts`

**Interfaces:**
- Consumes: `SilenceDeferral`'s config shape, `segmentPauseMs`, `clampSegmentPauseMs` (`src/lib/segmentation/segmentationMode.ts`); `LanguageOption`, `CredentialsMissing`, `Provider`, `SharedSettings`, `ProviderRefusal` (`src/lib/provider/types.ts`).
- Produces:
  - `settings.ts`: `type NoiseReduction = 'None' | 'Near field' | 'Far field'`; `NOISE_REDUCTIONS`; `interface TranslateSettings { noiseReduction: NoiseReduction; transportType: 'websocket' | 'webrtc' }`; `TRANSLATE_DEFAULTS`; `TRANSLATE_MODEL = 'gpt-realtime-translate'`; `TRANSCRIPT_MODEL = 'gpt-live-transcribe'`; `isTranslateModelId(id: string): boolean`; `migrateTranslateSettings(stored): TranslateSettings`; `TRANSLATE_TARGETS` (13), `TRANSLATE_SOURCES` (74); `translateLanguages`; `interface TranslateCredentials { apiKey: string }`; `translateCredentials`;
  - `config.ts`: `interface TranslateConfig { model; target; transcriptModel; noiseReduction: 'near_field' | 'far_field' | null; silence: { sourceMs; translationMs; deferMidSentence }; transport: 'websocket' }`; `buildTranslate(context, s, shared): TranslateConfig | ProviderRefusal`; `describeTranslate(c): { translationModel; asrModel }`;
  - the folder, with its seed `adapter.ts`.
- Consumed by: Tasks 4–10.

The language lists are the old descriptor's (`OTD:161-175` and `:181-256`), copied entry for entry: 13 targets, 74 sources (its comment's "75" miscounts, survey §1.14.16). `S` keeps `noiseReduction` and `transportType`; the key is a credential under the same storage key, the pair is the provider store's under the same keys, and the stored `transcriptModel` is not read (ruling 8). The builder sends no source: the model detects it (`OTD:22`).

- [ ] **Step 1: Write the seed, then the failing tests.** First the seed, `src/providers/openai_translate/adapter.ts`, before any other file of the new folder (the session-side guard requires an `adapter.ts` in every provider folder, `sessionSide.consistency.test.ts:174-177`, and Wave 1's other tasks run it):

```ts
/**
 * OpenAI Translate's session side (plan: Stage 2 OpenAI Translate). The
 * adapter lands in its Task 9; until then this seed is the `adapter.ts` the
 * session-side guard (`sessionSide.consistency.test.ts`) requires of every
 * provider folder.
 */
export {};
```

  Then `settings.test.ts`, in full:

```ts
import { describe, it, expect } from 'vitest';
import { readCredentials } from '../../lib/provider/credentials';
import { AUTO, normalizePair, reverseSupported, swapped } from '../../lib/provider/languages';
import {
  isTranslateModelId, migrateTranslateSettings, NOISE_REDUCTIONS, TRANSCRIPT_MODEL, TRANSLATE_DEFAULTS, TRANSLATE_MODEL, TRANSLATE_SOURCES,
  TRANSLATE_TARGETS, translateCredentials, translateLanguages,
} from './settings';

const translate = { languages: translateLanguages };
const S = TRANSLATE_DEFAULTS;
const signedOut = { signedIn: false, getToken: async () => null };

describe("OpenAI Translate's settings", () => {
  it('keeps the noise reduction and the transport, defaulting to none over WebSocket (ruling 1)', () => {
    expect(TRANSLATE_DEFAULTS).toEqual({ noiseReduction: 'None', transportType: 'websocket' });
    expect(NOISE_REDUCTIONS).toEqual(['None', 'Near field', 'Far field']);
  });

  it('migrates what was stored field by field, keeps a stored WebRTC choice, and reads no transcript model (rulings 1, 8)', () => {
    expect(migrateTranslateSettings({ ...TRANSLATE_DEFAULTS })).toEqual(TRANSLATE_DEFAULTS);
    expect(migrateTranslateSettings({ noiseReduction: 'Far field', transportType: 'webrtc', transcriptModel: 'gpt-realtime-whisper' }))
      .toEqual({ noiseReduction: 'Far field', transportType: 'webrtc' });
    expect(migrateTranslateSettings({ noiseReduction: 'near_field', transportType: 'sip' })).toEqual(TRANSLATE_DEFAULTS);
    expect(migrateTranslateSettings({})).toEqual(TRANSLATE_DEFAULTS);
  });

  it('runs one model and one transcript model, and knows the family the check requires (rulings 7, 8)', () => {
    expect(TRANSLATE_MODEL).toBe('gpt-realtime-translate');
    expect(TRANSCRIPT_MODEL).toBe('gpt-live-transcribe');
    for (const id of ['gpt-realtime-translate', 'gpt-realtime-translate-2026-05-01', 'GPT-Realtime-Translate']) expect(isTranslateModelId(id), id).toBe(true);
    for (const id of ['gpt-realtime', 'gpt-4o-realtime-preview', 'gpt-live-transcribe', 'x-gpt-realtime-translate']) expect(isTranslateModelId(id), id).toBe(false);
  });
});

describe("OpenAI Translate's languages", () => {
  it('hears the old descriptor\'s 74 languages, with no auto, and speaks thirteen (ruling 15)', () => {
    expect(TRANSLATE_SOURCES).toHaveLength(74);
    expect(new Set(TRANSLATE_SOURCES.map((o) => o.value)).size).toBe(74);
    expect(TRANSLATE_SOURCES.some((o) => o.value === AUTO)).toBe(false);
    expect(TRANSLATE_TARGETS.map((o) => o.value)).toEqual(['en', 'es', 'pt', 'fr', 'ja', 'ru', 'zh', 'de', 'ko', 'hi', 'id', 'vi', 'it']);
    // Every target is a source too, so the participant leg of any pair hears its target.
    for (const t of TRANSLATE_TARGETS) expect(TRANSLATE_SOURCES.map((o) => o.value), t.value).toContain(t.value);
    expect(TRANSLATE_SOURCES.find((o) => o.value === 'fil')).toEqual({ name: 'Filipino', value: 'fil', englishName: 'Filipino' });
  });

  it('offers the thirteen for every source, the source itself included, speaking or not (ruling 15)', () => {
    for (const source of ['en', 'ja', 'th', 'fil']) {
      for (const context of [undefined, { speech: true }, { speech: false }]) {
        expect(translateLanguages.targets(source, S, context)).toBe(TRANSLATE_TARGETS);
      }
    }
    expect(translateLanguages.sources(S, { speech: false })).toBe(TRANSLATE_SOURCES);
    expect(normalizePair(translate, S, { source: 'en', target: 'en' })).toEqual({ source: 'en', target: 'en' });
  });

  it('starts from English into Chinese', () => {
    expect(translateLanguages.initial!(S)).toEqual({ source: 'en', target: 'zh' });
    expect(normalizePair(translate, S, translateLanguages.initial!(S))).toEqual({ source: 'en', target: 'zh' });
  });

  it('reverses a pair whose source it speaks, and no other: the participant leg of a source-only language is refused (D20)', () => {
    expect(reverseSupported(translate, S, { source: 'ja', target: 'en' })).toBe(true);
    expect(swapped(translate, S, { source: 'ja', target: 'en' })).toEqual({ source: 'en', target: 'ja' });
    expect(reverseSupported(translate, S, { source: 'th', target: 'en' })).toBe(false);
    expect(swapped(translate, S, { source: 'th', target: 'en' })).toBeNull();
  });
});

describe("OpenAI Translate's credentials", () => {
  it('asks for one API key, the OpenAI key the old slice stored', () => {
    expect(translateCredentials.keys).toEqual(['apiKey']);
    expect(translateCredentials.fields(S)).toEqual([{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }]);
  });

  it('reads the key trimmed — a pasted newline is no valid subprotocol token (choice 14) — and an empty one as missing', () => {
    expect(readCredentials({ credentials: translateCredentials }, S, { apiKey: '  sk-proj-abc123\n' }, signedOut)).toEqual({ apiKey: 'sk-proj-abc123' });
    expect(readCredentials({ credentials: translateCredentials }, S, { apiKey: ' \n' }, signedOut)).toEqual({ missing: 'Enter your OpenAI API key.' });
    expect(readCredentials({ credentials: translateCredentials }, S, {}, signedOut)).toEqual({ missing: 'Enter your OpenAI API key.' });
  });
});
```

  And `config.test.ts`, in full:

```ts
import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildTranslate, describeTranslate, type TranslateConfig } from './config';
import { TRANSLATE_DEFAULTS, type TranslateSettings } from './settings';

const PAIR = { source: 'ja', target: 'en' };
const shared = (patch: Partial<SharedSettings> = {}): SharedSettings => ({
  pauses: { sourceSeconds: 1.5, translationSeconds: 2 },
  reversed: (d) => d.source === PAIR.target && d.target === PAIR.source,
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'gpt-realtime-translate' }],
  ...patch,
});
const SPEAKER: SessionContext = { direction: PAIR, speech: true, turns: 'auto' };
const PARTICIPANT: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const build = (patch: Partial<TranslateSettings> = {}, context = SPEAKER, sh = shared()) => buildTranslate(context, { ...TRANSLATE_DEFAULTS, ...patch }, sh) as TranslateConfig;

describe("OpenAI Translate's builder", () => {
  it('runs the one model into the direction\'s target, transcribing with the one transcript model, noise reduction off, over WebSocket (rulings 7, 8, 9)', () => {
    expect(build()).toEqual({
      model: 'gpt-realtime-translate',
      target: 'en',
      transcriptModel: 'gpt-live-transcribe',
      noiseReduction: null,
      silence: { sourceMs: 1500, translationMs: 2000, deferMidSentence: false },
      transport: 'websocket',
    });
  });

  it('sends the chosen noise reduction as its type, and None as null, which turns it off (ruling 9)', () => {
    expect(build({ noiseReduction: 'Near field' }).noiseReduction).toBe('near_field');
    expect(build({ noiseReduction: 'Far field' }).noiseReduction).toBe('far_field');
    expect(build({ noiseReduction: 'None' }).noiseReduction).toBeNull();
  });

  it("builds the participant as the same call on the reversed direction: its target is the pair's source (D17)", () => {
    expect(build({}, PARTICIPANT).target).toBe('ja');
  });

  it('runs a stored WebRTC choice over WebSocket (ruling 1)', () => {
    expect(build({ transportType: 'webrtc' }).transport).toBe('websocket');
  });

  it("builds a leg that does not speak exactly as one that does: the API always speaks, and the adapter drops the audio (ruling 4)", () => {
    expect(build({}, { ...SPEAKER, speech: false })).toEqual(build());
    expect(build({}, { ...SPEAKER, turns: 'manual' })).toEqual(build());
  });

  it('takes each side\'s pause from the shared pair, clamped, and defers mid-sentence only while the display cuts by sentences (choice 4)', () => {
    expect(build({}, SPEAKER, shared({ pauses: { sourceSeconds: 0.01, translationSeconds: 9 } })).silence).toEqual({ sourceMs: 100, translationMs: 3000, deferMidSentence: false });
    expect(build({}, SPEAKER, shared({ segmentation: { mode: 'sentences', sentencesPerRow: 2 } })).silence.deferMidSentence).toBe(true);
    expect(build({}, SPEAKER, shared({ segmentation: { mode: 'off', sentencesPerRow: 0 } })).silence.deferMidSentence).toBe(false);
  });

  it('refuses a target outside the thirteen, in words (a guard the languages never reach)', () => {
    expect(buildTranslate({ ...SPEAKER, direction: { source: 'en', target: 'th' } }, TRANSLATE_DEFAULTS, shared())).toEqual({ refused: 'OpenAI Translate does not translate into th.' });
  });

  it('names the translation model and the transcript model (choice 10)', () => {
    expect(describeTranslate(build())).toEqual({ translationModel: 'gpt-realtime-translate', asrModel: 'gpt-live-transcribe' });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/providers/openai_translate` — FAIL: no `./settings`, no `./config`.
- [ ] **Step 3: Implement.** `settings.ts`, in full:

```ts
/**
 * OpenAI Translate's `S`, languages and credentials (survey §2.2, §2.3,
 * §2.5). `S` is the old slice (`OpenAITranslateProviderConfig.ts:20-50`)
 * without what leaves it: the key (a credential, same key), the pair
 * (`providerStore`, same keys) and the transcript model (a constant now,
 * ruling 8). Stored under `settings.openaiTranslate.*` as before. The
 * language lists are the old descriptor's (`:161-256`), copied: nothing here
 * imports `src/services`.
 */
import type { CredentialsMissing, LanguageOption, Provider } from '../../lib/provider/types';

export type NoiseReduction = 'None' | 'Near field' | 'Far field';
/** The old select's modes, in its order (`OpenAITranslateProviderConfig.ts:283`). */
export const NOISE_REDUCTIONS: readonly NoiseReduction[] = ['None', 'Near field', 'Far field'];

export interface TranslateSettings {
  noiseReduction: NoiseReduction;
  /**
   * The old transport choice: read and kept for the WebRTC step, never shown,
   * and not honoured — every session runs over WebSocket until that step
   * (ruling 1; choice 15).
   */
  transportType: 'websocket' | 'webrtc';
}

export const TRANSLATE_DEFAULTS: TranslateSettings = { noiseReduction: 'None', transportType: 'websocket' };

/** The model every session runs (ruling 7): the endpoint fixes it at creation, and the old builder always sent it (`OpenAITranslateProviderConfig.ts:106`). */
export const TRANSLATE_MODEL = 'gpt-realtime-translate';
/** The source transcript's model (ruling 8): the old select's one option (`OpenAITranslateProviderConfig.ts:284`). */
export const TRANSCRIPT_MODEL = 'gpt-live-transcribe';

/** The model family the check requires (`OpenAIClient.ts:265-267`). */
export function isTranslateModelId(id: string): boolean {
  return id.toLowerCase().startsWith(TRANSLATE_MODEL);
}

const NOISE_VALUES: readonly unknown[] = NOISE_REDUCTIONS;
const TRANSPORTS: readonly unknown[] = ['websocket', 'webrtc'];

/**
 * What was stored, made valid field by field. A stored transcript model
 * (`gpt-live-transcribe`, or the legacy `gpt-realtime-whisper`) is not read:
 * the model is a constant (ruling 8). Nothing is written back.
 */
export function migrateTranslateSettings(stored: Readonly<Record<string, unknown>>): TranslateSettings {
  return {
    noiseReduction: NOISE_VALUES.includes(stored.noiseReduction) ? (stored.noiseReduction as NoiseReduction) : TRANSLATE_DEFAULTS.noiseReduction,
    transportType: TRANSPORTS.includes(stored.transportType) ? (stored.transportType as TranslateSettings['transportType']) : TRANSLATE_DEFAULTS.transportType,
  };
}

/** The thirteen languages the model speaks: the targets for every source, the source included (ruling 15). */
export const TRANSLATE_TARGETS: readonly LanguageOption[] = [
  { name: 'English', value: 'en', englishName: 'English' },
  { name: 'Español', value: 'es', englishName: 'Spanish' },
  { name: 'Português', value: 'pt', englishName: 'Portuguese' },
  { name: 'Français', value: 'fr', englishName: 'French' },
  { name: '日本語', value: 'ja', englishName: 'Japanese' },
  { name: 'Русский', value: 'ru', englishName: 'Russian' },
  { name: '中文', value: 'zh', englishName: 'Chinese' },
  { name: 'Deutsch', value: 'de', englishName: 'German' },
  { name: '한국어', value: 'ko', englishName: 'Korean' },
  { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
  { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
  { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
  { name: 'Italiano', value: 'it', englishName: 'Italian' },
];

/** The 74 languages it hears (the old comment's "75" miscounts, survey §1.14.16); no `auto`, though the model detects what is spoken (ruling 15). */
export const TRANSLATE_SOURCES: readonly LanguageOption[] = [
  { name: 'Afrikaans', value: 'af', englishName: 'Afrikaans' },
  { name: 'العربية', value: 'ar', englishName: 'Arabic' },
  { name: 'Azərbaycan', value: 'az', englishName: 'Azerbaijani' },
  { name: 'Беларуская', value: 'be', englishName: 'Belarusian' },
  { name: 'বাংলা', value: 'bn', englishName: 'Bengali' },
  { name: 'Bosanski', value: 'bs', englishName: 'Bosnian' },
  { name: 'Български', value: 'bg', englishName: 'Bulgarian' },
  { name: 'Català', value: 'ca', englishName: 'Catalan' },
  { name: '中文', value: 'zh', englishName: 'Chinese' },
  { name: 'Hrvatski', value: 'hr', englishName: 'Croatian' },
  { name: 'Čeština', value: 'cs', englishName: 'Czech' },
  { name: 'Dansk', value: 'da', englishName: 'Danish' },
  { name: 'Nederlands', value: 'nl', englishName: 'Dutch' },
  { name: 'རྫོང་ཁ', value: 'dz', englishName: 'Dzongkha' },
  { name: 'English', value: 'en', englishName: 'English' },
  { name: 'Esperanto', value: 'eo', englishName: 'Esperanto' },
  { name: 'Eesti', value: 'et', englishName: 'Estonian' },
  { name: 'Euskara', value: 'eu', englishName: 'Basque' },
  { name: 'فارسی', value: 'fa', englishName: 'Persian' },
  { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
  { name: 'Filipino', value: 'fil', englishName: 'Filipino' },
  { name: 'Français', value: 'fr', englishName: 'French' },
  { name: 'Galego', value: 'gl', englishName: 'Galician' },
  { name: 'Deutsch', value: 'de', englishName: 'German' },
  { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
  { name: 'ગુજરાતી', value: 'gu', englishName: 'Gujarati' },
  { name: 'Kreyòl Ayisyen', value: 'ht', englishName: 'Haitian Creole' },
  { name: 'ʻŌlelo Hawaiʻi', value: 'haw', englishName: 'Hawaiian' },
  { name: 'עברית', value: 'he', englishName: 'Hebrew' },
  { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
  { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
  { name: 'Հայերեն', value: 'hy', englishName: 'Armenian' },
  { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
  { name: 'Italiano', value: 'it', englishName: 'Italian' },
  { name: '日本語', value: 'ja', englishName: 'Japanese' },
  { name: 'Basa Jawa', value: 'jv', englishName: 'Javanese' },
  { name: 'ქართული', value: 'ka', englishName: 'Georgian' },
  { name: 'Қазақ', value: 'kk', englishName: 'Kazakh' },
  { name: '한국어', value: 'ko', englishName: 'Korean' },
  { name: 'Kurdî', value: 'ku', englishName: 'Kurdish' },
  { name: 'Latine', value: 'la', englishName: 'Latin' },
  { name: 'Latviešu', value: 'lv', englishName: 'Latvian' },
  { name: 'Lietuvių', value: 'lt', englishName: 'Lithuanian' },
  { name: 'Македонски', value: 'mk', englishName: 'Macedonian' },
  { name: 'Bahasa Melayu', value: 'ms', englishName: 'Malay' },
  { name: 'മലയാളം', value: 'ml', englishName: 'Malayalam' },
  { name: 'Māori', value: 'mi', englishName: 'Maori' },
  { name: 'Монгол', value: 'mn', englishName: 'Mongolian' },
  { name: 'မြန်မာ', value: 'my', englishName: 'Burmese' },
  { name: 'नेपाली', value: 'ne', englishName: 'Nepali' },
  { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
  { name: 'Nynorsk', value: 'nn', englishName: 'Nynorsk' },
  { name: 'Polski', value: 'pl', englishName: 'Polish' },
  { name: 'Português', value: 'pt', englishName: 'Portuguese' },
  { name: 'ਪੰਜਾਬੀ', value: 'pa', englishName: 'Punjabi' },
  { name: 'Română', value: 'ro', englishName: 'Romanian' },
  { name: 'Русский', value: 'ru', englishName: 'Russian' },
  { name: 'Српски', value: 'sr', englishName: 'Serbian' },
  { name: 'ChiShona', value: 'sn', englishName: 'Shona' },
  { name: 'Slovenčina', value: 'sk', englishName: 'Slovak' },
  { name: 'Slovenščina', value: 'sl', englishName: 'Slovenian' },
  { name: 'Shqip', value: 'sq', englishName: 'Albanian' },
  { name: 'Español', value: 'es', englishName: 'Spanish' },
  { name: 'Kiswahili', value: 'sw', englishName: 'Swahili' },
  { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
  { name: 'Tagalog', value: 'tl', englishName: 'Tagalog' },
  { name: 'తెలుగు', value: 'te', englishName: 'Telugu' },
  { name: 'ไทย', value: 'th', englishName: 'Thai' },
  { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
  { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
  { name: 'Oʻzbek', value: 'uz', englishName: 'Uzbek' },
  { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
  { name: 'Cymraeg', value: 'cy', englishName: 'Welsh' },
  { name: 'Yorùbá', value: 'yo', englishName: 'Yoruba' },
];

/**
 * Every source targets the thirteen (the old `resolveTargetLanguages`); the
 * offer is the same speaking or not. D20 then opens the participant leg only
 * for a source among the thirteen.
 */
export const translateLanguages: Provider<TranslateSettings, never, never>['languages'] = {
  sources: () => TRANSLATE_SOURCES,
  targets: () => TRANSLATE_TARGETS,
  initial: () => ({ source: 'en', target: 'zh' }),
};

export interface TranslateCredentials {
  apiKey: string;
}

export const translateCredentials: Provider<TranslateSettings, TranslateCredentials, never>['credentials'] = {
  keys: ['apiKey'],
  fields: () => [{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }],
  read: (values): TranslateCredentials | CredentialsMissing => {
    // Trimmed (choice 14): the key rides in a subprotocol, and a pasted trailing newline or space is no valid token.
    const apiKey = (values.apiKey ?? '').trim();
    // No code: the runner words it `credentials_missing` ("Enter your API key in Settings before starting.").
    return apiKey ? { apiKey } : { missing: 'Enter your OpenAI API key.' };
  },
};
```

  `config.ts`, in full:

```ts
/**
 * OpenAI Translate's `C`, `build` and `describe` (survey §2.7). One builder
 * for both legs: the participant is the same call on the reversed direction,
 * so its target — the pair's source — follows from `context` (D17). The old
 * participant swap and its skip-the-leg guard
 * (`OpenAITranslateProviderConfig.ts:121-157`) are gone: D20 refuses the
 * start instead. The source is never sent — the model detects what is
 * spoken — and a leg that does not speak builds the same config: the API
 * cannot stop speaking, so the adapter drops the audio (ruling 4).
 */
import type { SessionContext } from '../../lib/contract/adapter';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { clampSegmentPauseMs, segmentPauseMs } from '../../lib/segmentation/segmentationMode';
import { TRANSCRIPT_MODEL, TRANSLATE_MODEL, TRANSLATE_TARGETS, type NoiseReduction, type TranslateSettings } from './settings';

export interface TranslateConfig {
  /** The endpoint's model, in the socket's `?model=` (ruling 7). */
  model: typeof TRANSLATE_MODEL;
  /** `audio.output.language`: this direction's target, one of the thirteen. */
  target: string;
  /** `audio.input.transcription.model` (ruling 8). */
  transcriptModel: typeof TRANSCRIPT_MODEL;
  /** `audio.input.noise_reduction`: a type, or `null`, which turns it off (ruling 9). */
  noiseReduction: 'near_field' | 'far_field' | null;
  /** Each side's silence timer and the mid-sentence deferral, as Gemini's Live Translate (choice 4). */
  silence: { sourceMs: number; translationMs: number; deferMidSentence: boolean };
  /** WebSocket only (ruling 1): the WebRTC step widens it, from `S.transportType` (choice 15). */
  transport: 'websocket';
}

const NOISE: Readonly<Record<NoiseReduction, TranslateConfig['noiseReduction']>> = {
  None: null,
  'Near field': 'near_field',
  'Far field': 'far_field',
};

export function buildTranslate(context: SessionContext, s: TranslateSettings, shared: SharedSettings): TranslateConfig | ProviderRefusal {
  const { target } = context.direction;
  // A guard: the languages offer the thirteen targets only, so the runner never builds another (survey §2.7).
  if (!TRANSLATE_TARGETS.some((o) => o.value === target)) return { refused: `OpenAI Translate does not translate into ${target}.` };
  return {
    model: TRANSLATE_MODEL,
    target,
    transcriptModel: TRANSCRIPT_MODEL,
    noiseReduction: NOISE[s.noiseReduction],
    silence: {
      sourceMs: clampSegmentPauseMs(segmentPauseMs(shared.pauses.sourceSeconds)),
      translationMs: clampSegmentPauseMs(segmentPauseMs(shared.pauses.translationSeconds)),
      deferMidSentence: shared.segmentation.mode === 'sentences',
    },
    // `s.transportType` is not read: a stored `webrtc` runs over WebSocket until the WebRTC step (ruling 1).
    transport: 'websocket',
  };
}

/** Two models: the translation's and the source transcript's (choice 10). */
export function describeTranslate(c: TranslateConfig): { translationModel: string; asrModel: string } {
  return { translationModel: c.model, asrModel: c.transcriptModel };
}
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then the full suite and the gate. What the change reaches: the session-side guard finds the folder's `adapter.ts` (the seed, which imports nothing); nothing registers the provider yet, so the registry invariants do not read it (Task 10 does).
- [ ] **Step 5: Commit.**

```bash
git add src/providers/openai_translate/adapter.ts src/providers/openai_translate/settings.ts src/providers/openai_translate/settings.test.ts src/providers/openai_translate/config.ts src/providers/openai_translate/config.test.ts
```

```bash
git commit -q -F - -- src/providers/openai_translate/adapter.ts src/providers/openai_translate/settings.ts src/providers/openai_translate/settings.test.ts src/providers/openai_translate/config.ts src/providers/openai_translate/config.test.ts <<'EOF'
feat(openai_translate): settings, languages, the key and the builder

S keeps the noise reduction and the stored transport; the model and the
transcript model are constants; the old descriptor's 74 sources and 13
targets, every target for every source; the key trimmed. The builder
runs gpt-realtime-translate into the direction's target over WebSocket,
noise reduction None sent as null, each side's pause from the shared pair.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

## Wave 2

### Task 4: The wire, the socket seam and the fixtures (rulings 6, 8, 9, 16; choices 3, 8, 9, 17)

**Files:**
- Create: `src/providers/openai_translate/wire.ts`, `src/providers/openai_translate/socket.ts`, `src/providers/openai_translate/testing.ts`
- Test: `src/providers/openai_translate/wire.test.ts`, `src/providers/openai_translate/socket.test.ts`

**Interfaces:**
- Consumes: Task 3's `TranslateConfig` and `TranslateCredentials` (types), `buildTranslate`, `TRANSLATE_DEFAULTS`; Task 1's subprotocol rule (the wire test's redaction case); the SDK's `RealtimeError`, `RealtimeTranslationInputAudioBufferAppendEvent`, `RealtimeTranslationSessionUpdateEvent` (`import type` from `openai/resources/realtime/realtime`).
- Produces:
  - `wire.ts`: `TRANSLATE_WS_URL`; `translateUrl(c: Pick<TranslateConfig, 'model'>): string`; `translateProtocols(k: TranslateCredentials): string[]`; `sessionUpdate(c: TranslateConfig): RealtimeTranslationSessionUpdateEvent`; `pcmToBase64(pcm)`; `appendFrame(pcm): string`; `type ServerEvent = { type: string } & Record<string, unknown>`; `decodeServerEvent(data: unknown): ServerEvent` (throws); `base64ToPcm(data: string): Int16Array`; `OUTPUT_RATE = 24_000`; `isSilentFrame(pcm): boolean`; `computeRms(pcm): number`; `elapsedMsOf(e: { elapsed_ms?: unknown }): number | null`; `type ErrorCode = 'auth' | 'rate_limit' | 'client' | 'server'`; `errorCode(e: Partial<RealtimeError>): ErrorCode`; `errorWords(e: Partial<RealtimeError>): string`;
  - `socket.ts`: `type OpenSocket = (url: string, protocols: string[]) => WebSocket`; `nativeSocket`; `WS_OPEN = 1`;
  - `testing.ts`: `KEY` (`sk-proj-…`-shaped), `RefusingWebSocket`, `SHARED`, `AUTO_CTX` (ja → en, speaking, auto), `configFor(context?, patch?)`, `b64(samples, fill?)`, `SERVER` — `created()`, `updated()`, `input(delta, elapsed?)`, `output(delta, elapsed?)`, `audio({ samples?, fill?, elapsed?, rate? }?)`, `heartbeat(samples?)`, `error({ type?, code?, message? }?)`, `closed()`, `bare(type)`, each a JSON text frame as the endpoint sends it.
- Consumed by: Task 9 (all of it; it appends the harness to `testing.ts`), Task 10 (`testing.ts`).

The URL carries no credential: the key is in the second subprotocol, which a browser sends as `Sec-WebSocket-Protocol` on every platform (survey §0.2, §2.10). `sessionUpdate` is the old `buildSessionUpdate` (`GA:197-217`) with the transcription always set and `noise_reduction: null` for none (ruling 9); `output` takes the language alone and `input.transcription` the model alone — anything else came back `unknown_parameter` (`OTD:32-37`). A JSON parse of a frame that is not an object with a string `type` throws; the adapter says it once per episode (Task 9).

- [ ] **Step 1: Write the fixtures, then the failing tests.** `testing.ts`, in full (Task 9 adds the harness to it):

```ts
/**
 * The OpenAI Translate suites' fixtures: a key, the settings the suites
 * build from, the server's events as the JSON text frames the endpoint
 * sends, and a browser that refuses the socket. Test-only: nothing but a
 * test imports it (the session-side guard's kit rule counts every
 * provider's `testing.ts` as kit and holds it to that), and the adapter's
 * session walk never reaches it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildTranslate, type TranslateConfig } from './config';
import { TRANSLATE_DEFAULTS, type TranslateCredentials, type TranslateSettings } from './settings';

/** Shaped as a real key (`sk-…`), which `redact()` masks: a frame that carried it fails the kit's `frame-secret` rule. */
export const KEY: TranslateCredentials = { apiKey: 'sk-proj-translateKey0123456789' };

/** A browser that will not open the socket, as Chromium refuses an invalid subprotocol: a DOMException named SyntaxError whose message quotes the subprotocols, the key among them. Stubbed as the global `WebSocket`. */
export class RefusingWebSocket {
  constructor(_url: string, protocols?: string | string[]) {
    const list = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
    throw new DOMException(`Failed to construct 'WebSocket': The subprotocol '${list.join(', ')}' is invalid.`, 'SyntaxError');
  }
}

export const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  reversed: (d) => d.source === 'en' && d.target === 'ja',
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'gpt-realtime-translate' }],
};
export const AUTO_CTX: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };

/** A leg's config: the defaults, patched. */
export function configFor(context: SessionContext = AUTO_CTX, patch: Partial<TranslateSettings> = {}): TranslateConfig {
  return buildTranslate(context, { ...TRANSLATE_DEFAULTS, ...patch }, SHARED) as TranslateConfig;
}

/** `samples` of 24 kHz pcm16 as an audio delta carries it: base64 of little-endian Int16. `fill` 0 is a heartbeat. */
export function b64(samples: number, fill = 900): string {
  let binary = '';
  for (const byte of new Uint8Array(new Int16Array(samples).fill(fill).buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const event = (e: Record<string, unknown>) => JSON.stringify({ event_id: 'event_1', ...e });
/** The session as `session.created` reports it: the server's defaults. */
const SESSION = { id: 'sess_1', type: 'translation', model: 'gpt-realtime-translate', expires_at: 1_790_000_000, audio: { input: { noise_reduction: { type: 'near_field' }, transcription: null }, output: { language: 'en' } } };

/** The server's events, by name, as the endpoint sends them: JSON text frames. */
export const SERVER = {
  created: () => event({ type: 'session.created', session: SESSION }),
  updated: () => event({ type: 'session.updated', session: { ...SESSION, audio: { input: { noise_reduction: null, transcription: { model: 'gpt-live-transcribe' } }, output: { language: 'en' } } } }),
  input: (delta: string, elapsed: number | null = 0) => event({ type: 'session.input_transcript.delta', delta, elapsed_ms: elapsed }),
  output: (delta: string, elapsed: number | null = 0) => event({ type: 'session.output_transcript.delta', delta, elapsed_ms: elapsed }),
  /** Content audio: 200 ms by default. */
  audio: (o: { samples?: number; fill?: number; elapsed?: number | null; rate?: number } = {}) =>
    event({ type: 'session.output_audio.delta', delta: b64(o.samples ?? 4_800, o.fill ?? 900), elapsed_ms: o.elapsed ?? 0, format: 'pcm16', sample_rate: o.rate ?? 24_000, channels: 1 }),
  /** A heartbeat: an all-zero frame. */
  heartbeat: (samples = 4_800) => event({ type: 'session.output_audio.delta', delta: b64(samples, 0), elapsed_ms: 0, format: 'pcm16', sample_rate: 24_000, channels: 1 }),
  error: (e: { type?: string; code?: string | null; message?: string } = {}) =>
    event({ type: 'error', error: { type: 'invalid_request_error', code: null, message: 'Something was wrong.', param: null, event_id: null, ...e } }),
  closed: () => event({ type: 'session.closed' }),
  /** An event by its type alone: a `.done` the SDK does not list, or one it never sends. */
  bare: (type: string) => event({ type }),
};
```

  `wire.test.ts`, in full:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { redact } from '../../lib/diagnostics/redact';
import { configFor, KEY, SERVER } from './testing';
import {
  appendFrame, base64ToPcm, computeRms, decodeServerEvent, elapsedMsOf, errorCode, errorWords, isSilentFrame, OUTPUT_RATE, pcmToBase64, sessionUpdate,
  TRANSLATE_WS_URL, translateProtocols, translateUrl,
} from './wire';

/** The names the key is read through: the credentials' type and its one field. */
const SECRET_NAMES = new Set(['TranslateCredentials', 'apiKey']);

/** The functions of a module that name the key, `<module>` for a use outside any function; an import names nothing (Doubao's `wire.test.ts` scan). */
function secretReaders(source: string): string[] {
  const readers = new Set<string>();
  const enclosing = (node: ts.Node): string => {
    for (let n: ts.Node | undefined = node; n; n = n.parent) {
      if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
      if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text;
      if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
    }
    return '<module>';
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && SECRET_NAMES.has(node.text)) readers.add(enclosing(node));
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('scan.ts', source, ts.ScriptTarget.Latest, true));
  return [...readers].sort();
}

describe("OpenAI Translate's wire: the socket", () => {
  it('dials the translations endpoint with the model in its query, and authenticates with two subprotocols — never the beta tag (choice 3)', () => {
    expect(TRANSLATE_WS_URL).toBe('wss://api.openai.com/v1/realtime/translations');
    expect(translateUrl(configFor())).toBe('wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate');
    expect(translateProtocols(KEY)).toEqual(['realtime', 'openai-insecure-api-key.sk-proj-translateKey0123456789']);
    expect(translateProtocols(KEY).some((p) => p.startsWith('openai-beta'))).toBe(false);
    // The URL carries no credential: the key is in the protocols alone.
    expect(translateUrl(configFor())).not.toContain(KEY.apiKey);
  });

  it('reads the key, in `wire.ts`, in the protocol builder alone; the protocols, wherever they land, are masked by their carrier (choice 3)', () => {
    expect(secretReaders(readFileSync(resolve(__dirname, 'wire.ts'), 'utf-8'))).toEqual(['translateProtocols']);
    // The scan's control: a read in any other function, nested or not, or at the top level, is named; an import is not.
    expect(secretReaders([
      "import type { TranslateCredentials } from './settings';",
      'export function url(k: TranslateCredentials) { return k.apiKey; }',
      'export const frame = (k: { apiKey: string }) => [k].map((c) => c.apiKey);',
      "const leaked = { apiKey: 'x' };",
    ].join('\n'))).toEqual(['<module>', 'frame', 'url']);
    // A key of no key shape (the fixture's `sk-…` would be masked by the bare-shape rule whatever the carrier rule did).
    expect(redact(translateProtocols({ apiKey: '0a1b2c3d' }).join(', '))).toBe('realtime, openai-insecure-api-key.[REDACTED]');
  });
});

describe("OpenAI Translate's wire: session.update", () => {
  it('sends the target alone as the output, and the transcript model with noise reduction off as null (rulings 8, 9)', () => {
    expect(sessionUpdate(configFor())).toEqual({
      type: 'session.update',
      session: { audio: { output: { language: 'en' }, input: { transcription: { model: 'gpt-live-transcribe' }, noise_reduction: null } } },
    });
  });

  it('sends a chosen noise reduction as its type', () => {
    expect(sessionUpdate(configFor(undefined, { noiseReduction: 'Near field' })).session.audio?.input?.noise_reduction).toEqual({ type: 'near_field' });
    expect(sessionUpdate(configFor(undefined, { noiseReduction: 'Far field' })).session.audio?.input?.noise_reduction).toEqual({ type: 'far_field' });
  });

  it('sends neither the source, nor an output transcription, nor a model: the endpoint refuses what it does not take (`OpenAITranslateGAClient.test.ts:27-89`)', () => {
    const update = sessionUpdate(configFor({ direction: { source: 'en', target: 'ja' }, speech: false, turns: 'manual' }));
    expect(update.session.audio?.output).toEqual({ language: 'ja' });
    expect(Object.keys(update.session)).toEqual(['audio']);
    expect(Object.keys(update.session.audio?.input ?? {})).toEqual(['transcription', 'noise_reduction']);
    expect(JSON.stringify(update)).not.toContain('"en"');
  });
});

describe("OpenAI Translate's wire: audio", () => {
  it("sends a chunk as base64 of the view's own bytes, little-endian, never its backing buffer's", () => {
    const backing = new Int16Array([7, 1, -2, 300, 9]);
    const view = backing.subarray(1, 4);
    const frame = JSON.parse(appendFrame(view)) as { type: string; audio: string };
    expect(frame.type).toBe('session.input_audio_buffer.append');
    expect(Object.keys(frame)).toEqual(['type', 'audio']);
    expect(Array.from(base64ToPcm(frame.audio))).toEqual([1, -2, 300]);
    expect(atob(pcmToBase64(new Int16Array([0x0102]))).split('').map((c) => c.charCodeAt(0))).toEqual([0x02, 0x01]);
  });

  it('decodes an output delta, dropping an odd trailing byte where the old decoder threw (survey §1.14.10)', () => {
    expect(Array.from(base64ToPcm(btoa('\x01\x00\x02\x00\x03')))).toEqual([1, 2]);
    expect(base64ToPcm('')).toHaveLength(0);
    expect(OUTPUT_RATE).toBe(24_000);
  });

  it('tells a heartbeat by its content, not its length, and measures RMS for the Logs (`OpenAITranslateGAClient.test.ts:91-144`)', () => {
    expect(isSilentFrame(new Int16Array(4_800))).toBe(true);
    expect(isSilentFrame(new Int16Array(9_600))).toBe(true);
    expect(isSilentFrame(new Int16Array(0))).toBe(true);
    const content = new Int16Array(4_800);
    content[4_799] = 1;
    expect(isSilentFrame(content)).toBe(false);
    expect(computeRms(new Int16Array(0))).toBe(0);
    expect(computeRms(new Int16Array(10))).toBe(0);
    expect(computeRms(new Int16Array(10).fill(-32768))).toBe(1);
    expect(computeRms(new Int16Array(10).fill(1638))).toBeCloseTo(0.05, 3);
  });
});

describe("OpenAI Translate's wire: what comes down", () => {
  it('decodes a text frame and a binary one, and refuses what is not a JSON object with a type', () => {
    expect(decodeServerEvent(SERVER.closed())).toEqual({ event_id: 'event_1', type: 'session.closed' });
    const bytes = new TextEncoder().encode(SERVER.closed());
    expect(decodeServerEvent(bytes.buffer.slice(0) as ArrayBuffer).type).toBe('session.closed');
    expect(() => decodeServerEvent('not json')).toThrow();
    expect(() => decodeServerEvent('[1]')).toThrow('not a JSON object');
    expect(() => decodeServerEvent('null')).toThrow('not a JSON object');
    expect(() => decodeServerEvent('{"delta":"x"}')).toThrow('no type');
    expect(() => decodeServerEvent(new Blob(['{}']))).toThrow('unexpected kind');
  });

  it("reads a delta's elapsed_ms when it is a number, else null (ruling 6)", () => {
    expect(elapsedMsOf({ elapsed_ms: 1_400 })).toBe(1_400);
    expect(elapsedMsOf({ elapsed_ms: 0 })).toBe(0);
    expect(elapsedMsOf({ elapsed_ms: null })).toBeNull();
    expect(elapsedMsOf({})).toBeNull();
    expect(elapsedMsOf({ elapsed_ms: '200' })).toBeNull();
  });

  it("words a server error as OpenAI's own, and codes it: a bad key, a rate or a quota, an invalid request, else the service's (choice 9)", () => {
    expect(errorCode({ type: 'invalid_request_error', code: 'invalid_api_key' })).toBe('auth');
    expect(errorCode({ type: 'invalid_request_error', code: 'rate_limit_exceeded' })).toBe('rate_limit');
    expect(errorCode({ type: 'insufficient_quota', code: 'insufficient_quota' })).toBe('rate_limit');
    expect(errorCode({ type: 'invalid_request_error', code: 'unknown_parameter' })).toBe('client');
    expect(errorCode({ type: 'server_error', code: null })).toBe('server');
    expect(errorCode({})).toBe('server');
    expect(errorWords({ type: 'invalid_request_error', code: 'unknown_parameter', message: "Unknown parameter: 'session.audio.x'." })).toBe("[OpenAI unknown_parameter] Unknown parameter: 'session.audio.x'.");
    expect(errorWords({ type: 'server_error', code: null, message: 'The server had an error.' })).toBe('[OpenAI server_error] The server had an error.');
    expect(errorWords({})).toBe('[OpenAI error] the server reported an error');
  });
});
```

  `socket.test.ts`, in full:

```ts
/**
 * OpenAI Translate's socket seam. A browser that will not open a socket for
 * a subprotocol it finds invalid throws an error that quotes it, and the
 * second subprotocol carries the key: what leaves the seam names the error,
 * never repeats it.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { nativeSocket } from './socket';
import { configFor, KEY, RefusingWebSocket } from './testing';
import { translateProtocols, translateUrl } from './wire';

afterEach(() => {
  vi.unstubAllGlobals();
});

function thrownBy(f: () => unknown): Error {
  try {
    f();
  } catch (error) {
    return error as Error;
  }
  throw new Error('nothing was thrown');
}

describe("OpenAI Translate's socket seam", () => {
  it('opens the socket the browser builds, for the URL and the subprotocols it is given', () => {
    const built: Array<[string, unknown]> = [];
    class RecordingWebSocket {
      constructor(url: string, protocols: unknown) {
        built.push([url, protocols]);
      }
    }
    vi.stubGlobal('WebSocket', RecordingWebSocket);
    const socket = nativeSocket(translateUrl(configFor()), translateProtocols(KEY));
    expect(socket).toBeInstanceOf(RecordingWebSocket);
    expect(built).toEqual([[translateUrl(configFor()), translateProtocols(KEY)]]);
  });

  it("a socket the browser will not open is rethrown in fixed words, under the browser's error name, never its message (choice 3)", () => {
    const protocols = translateProtocols(KEY);
    const secrets = [KEY.apiKey, protocols[1], 'openai-insecure-api-key'];
    // The control: the browser's own error quotes every one of them.
    const own = thrownBy(() => new RefusingWebSocket(translateUrl(configFor()), protocols));
    for (const secret of secrets) expect(own.message).toContain(secret);

    vi.stubGlobal('WebSocket', RefusingWebSocket);
    const error = thrownBy(() => nativeSocket(translateUrl(configFor()), protocols));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBe(own);
    // The name stays: the start words a refusal by the thrown name.
    expect(error).toMatchObject({ name: 'SyntaxError', message: 'The browser would not open the socket (SyntaxError).' });
    expect((error as { cause?: unknown }).cause).toBeUndefined();
    for (const text of [error.message, String(error), error.stack ?? '']) {
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/providers/openai_translate/wire.test.ts src/providers/openai_translate/socket.test.ts` — FAIL: no `./wire`, no `./socket`.
- [ ] **Step 3: Implement.** `socket.ts`, in full:

```ts
/**
 * The one seam OpenAI Translate's session side opens sockets through (as
 * Soniox's, Gemini's and Doubao's `socket.ts`): `new WebSocket(url,
 * protocols)` in the app, a `FakeSocket` factory in tests. The key rides in
 * a subprotocol (choice 3), which a browser sets itself, so no upgrade
 * header is needed and F14 is not this provider's; this seam moves to
 * `src/lib/contract/` with the other three when F14 lands.
 */
export type OpenSocket = (url: string, protocols: string[]) => WebSocket;

/** Read at call time, so a test's `vi.stubGlobal('WebSocket')` is seen. */
export const nativeSocket: OpenSocket = (url, protocols) => {
  try {
    return new WebSocket(url, protocols);
  } catch (e) {
    // A key that is no valid subprotocol token makes the browser quote the subprotocol, the key in it: the message is dropped, the error's name kept (the start words a refusal by it).
    const name = (e as Error).name;
    throw Object.assign(new Error(`The browser would not open the socket (${name}).`), { name });
  }
};

/** `WebSocket.OPEN`, read as the constant it is: the socket may be an injected one. */
export const WS_OPEN = 1;
```

  `wire.ts`, in full:

```ts
/**
 * OpenAI Translate's wire, spoken directly (survey §1.3–1.4): the URL and
 * its subprotocols, the two client frames the adapter sends, the server's
 * frames decoded, the heartbeat test, and a server `error` as a notice code
 * and words. The client frames are typed by the `openai` SDK's translation
 * types, imported for types only, so a frame that drifts from the SDK fails
 * the typecheck. Pure: no socket, no timer.
 */
import type {
  RealtimeError,
  RealtimeTranslationInputAudioBufferAppendEvent,
  RealtimeTranslationSessionUpdateEvent,
} from 'openai/resources/realtime/realtime';
import type { TranslateConfig } from './config';
import type { TranslateCredentials } from './settings';

/** The translations endpoint (`OpenAITranslateGAClient.ts:23`); the model rides in its query, fixed at creation. */
export const TRANSLATE_WS_URL = 'wss://api.openai.com/v1/realtime/translations';

export function translateUrl(c: Pick<TranslateConfig, 'model'>): string {
  return `${TRANSLATE_WS_URL}?model=${encodeURIComponent(c.model)}`;
}

/**
 * The subprotocols a socket authenticates with (choice 3;
 * `OpenAITranslateGAClient.ts:698-709`): `realtime`, and the key as
 * `openai-insecure-api-key.<key>`, which a browser sets itself — no upgrade
 * header on any platform. Never the beta tag `openai-beta.realtime-v1`: the
 * endpoint refuses it ("Translation sessions are only available on the GA
 * API."). The one function of the session side that reads the key; what it
 * returns is never framed, worded or logged.
 */
export function translateProtocols(k: TranslateCredentials): string[] {
  return ['realtime', `openai-insecure-api-key.${k.apiKey}`];
}

/**
 * The session's configuration, sent once `session.created` arrives: the old
 * `buildSessionUpdate` (`OpenAITranslateGAClient.ts:197-217`), with the
 * transcription always set and `noise_reduction: null` for none, which the
 * SDK says turns it off (ruling 9).
 */
export function sessionUpdate(c: TranslateConfig): RealtimeTranslationSessionUpdateEvent {
  return {
    type: 'session.update',
    session: {
      audio: {
        // The language alone: `output.transcription` is refused as unknown, and the output transcript comes by default (`OpenAITranslateGAClient.test.ts:82-88`).
        output: { language: c.target },
        input: {
          // The model alone: `keywords`, `prompt`, `language`, `languages` and `delay` each came back `unknown_parameter` (probed 2026-08-01).
          transcription: { model: c.transcriptModel },
          noise_reduction: c.noiseReduction === null ? null : { type: c.noiseReduction },
        },
      },
    },
  };
}

/** Base64 of the view's own bytes, never its backing buffer's; little-endian, as the platforms are. Copied from Gemini's wire (choice 8). */
export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** One chunk as it goes up: 24 kHz PCM16 mono, the contract's own rate — no resampling (SDK: "base64-encoded 24 kHz PCM16 mono little-endian"). */
export function appendFrame(pcm: Int16Array): string {
  const frame: RealtimeTranslationInputAudioBufferAppendEvent = { type: 'session.input_audio_buffer.append', audio: pcmToBase64(pcm) };
  return JSON.stringify(frame);
}

/**
 * A server event as the adapter reads it: a JSON object with a string
 * `type`. The SDK's `RealtimeTranslationServerEvent` types the seven it
 * lists; the adapter reads each through its SDK type. The `.done` events the
 * old client handled are not among them (choice 18).
 */
export type ServerEvent = { type: string } & Record<string, unknown>;

const isArrayBuffer = (data: unknown): data is ArrayBuffer => Object.prototype.toString.call(data) === '[object ArrayBuffer]';

/** A server frame, decoded at once: text, or a binary frame read as an ArrayBuffer (choice 17). Throws when it is not a JSON object with a string `type`. */
export function decodeServerEvent(data: unknown): ServerEvent {
  const text = typeof data === 'string' ? data : isArrayBuffer(data) ? new TextDecoder().decode(data) : null;
  if (text === null) throw new Error(`a server frame of an unexpected kind (${Object.prototype.toString.call(data)})`);
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a server frame that is not a JSON object');
  if (typeof (parsed as { type?: unknown }).type !== 'string') throw new Error('a server frame with no type');
  return parsed as ServerEvent;
}

/** An output audio delta's pcm (little-endian Int16); an odd trailing byte is dropped, where the old decoder threw (survey §1.14.10). Copied from Gemini's wire (choice 8). */
export function base64ToPcm(data: string): Int16Array {
  const binary = atob(data);
  const even = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(even);
  for (let i = 0; i < even; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

/** The rate an output audio delta that names none is taken at: PCM16 at 24 kHz, the old client's default (`OpenAITranslateGAClient.ts:604`). */
export const OUTPUT_RATE = 24_000;

/**
 * A heartbeat: the all-zero frames the API sends between utterances
 * (`OpenAITranslateGAClient.ts:31-57`; commit `98149d35` measured content at
 * RMS 0.04–0.08 and heartbeats at exactly 0). Told apart by content, not by
 * length; it returns at the first sample that is not zero.
 */
export function isSilentFrame(pcm: Int16Array): boolean {
  for (let i = 0; i < pcm.length; i++) if (pcm[i] !== 0) return false;
  return true;
}

/** RMS over [0, 1] (the old `computeRms`), for the Logs' audio frames only. */
export function computeRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length) / 32768;
}

/** A delta's `elapsed_ms` when it is a number, else null: framed on every delta (ruling 6), read for nothing else yet. */
export function elapsedMsOf(e: { elapsed_ms?: unknown }): number | null {
  return typeof e.elapsed_ms === 'number' ? e.elapsed_ms : null;
}

export type ErrorCode = 'auth' | 'rate_limit' | 'client' | 'server';

/**
 * A server `error` as a notice code (choice 9): OpenAI's codes for a bad key,
 * a rate limit and an exhausted quota first, then an invalid request, else
 * the service's. A hypothesis for this endpoint: the live test's
 * `session.error` frames settle it.
 */
export function errorCode(e: Partial<RealtimeError>): ErrorCode {
  if (e.code === 'invalid_api_key') return 'auth';
  if (e.code === 'rate_limit_exceeded' || e.code === 'insufficient_quota') return 'rate_limit';
  if (e.type === 'invalid_request_error') return 'client';
  return 'server';
}

/** A server `error` in OpenAI's own words, as the `{{detail}}` of `notices.<code>`: `[OpenAI <code, else type>] <message>`. */
export function errorWords(e: Partial<RealtimeError>): string {
  return `[OpenAI ${e.code || e.type || 'error'}] ${e.message || 'the server reported an error'}`;
}
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then the full suite and the gate. What the change reaches: the session-side guard's kit rule holds `testing.ts` to tests (only the two test files import it); nothing on the session side imports `wire.ts` or `socket.ts` yet (the seed imports nothing). The SDK import is `import type`, erased; the typecheck resolves it through `openai`'s `./resources/*` export.
- [ ] **Step 5: Commit.**

```bash
git add src/providers/openai_translate/wire.ts src/providers/openai_translate/wire.test.ts src/providers/openai_translate/socket.ts src/providers/openai_translate/socket.test.ts src/providers/openai_translate/testing.ts
```

```bash
git commit -q -F - -- src/providers/openai_translate/wire.ts src/providers/openai_translate/wire.test.ts src/providers/openai_translate/socket.ts src/providers/openai_translate/socket.test.ts src/providers/openai_translate/testing.ts <<'EOF'
feat(openai_translate): the wire, the key in a subprotocol

The translations endpoint with the model in its query, and the key in
the openai-insecure-api-key subprotocol a browser sets itself, read by
one function only. session.update as the old builder sent it, noise
reduction None as null; appends as the chunk's own bytes; server frames
decoded as JSON objects; heartbeats told by content; an error's code and
OpenAI's words. The socket seam rethrows a refused socket in fixed words.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 5: The segments — each side on its own timer, the translation held by its audio (rulings 4, 6, 17, 21; choices 4, 5, 6, 18)

**Files:**
- Create: `src/providers/openai_translate/segments.ts`
- Test: `src/providers/openai_translate/segments.test.ts`

**Interfaces:**
- Consumes: Task 3's `TranslateConfig['silence']` (type); `SilenceDeferral`; `AdapterEvents`, `Ref`, `Clock`; the kit's `trackedClock` and `recordEvents` (the test).
- Produces: `type SegmentSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'audio'>`; `interface TranslateSegmentsOptions { clock: Pick<Clock, 'setTimeout'>; silence: TranslateConfig['silence']; sink: SegmentSink }`; `class TranslateSegments` with `input(delta)`, `output(delta)`, `audio(pcm, play: boolean)`, `done(side: 'source' | 'translation')`, `stop()`.
- Consumed by: Task 9.

What is copied from `GeminiTurns` and why it is not shared is choice 4, and the file's header says it. The behaviour specs are the old client's state-machine cases (`OpenAITranslateGAClient.test.ts:146-638`, survey §1.13): a source segment on the first input delta, a translation on the first output delta, output text only to the translation, the first content frame opening the translation, content audio keeping it open past its text, the two sides on independent timers, a new source while the translation still streams, and the timers running with segmentation off. The heartbeat cases move to the adapter (Task 9), which drops a heartbeat before it reaches here.

- [ ] **Step 1: Write the failing test.** `segments.test.ts`, in full:

```ts
import { describe, it, expect } from 'vitest';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import type { TranslateConfig } from './config';
import { TranslateSegments } from './segments';

function segments(silence: TranslateConfig['silence'] = { sourceMs: 1500, translationMs: 1500, deferMidSentence: false }) {
  // `timers()` counts what has neither fired nor been cancelled: the clock rule's proof that no timer outlives what should end it.
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const s = new TranslateSegments({ clock, silence, sink: events });
  const of = <K extends AdapterEvent['kind']>(k: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === k);
  const texts = (ref: number) => of('segmentText').filter((e) => e.payload.ref === ref).map((e) => e.payload.text);
  const opened = () => of('segmentOpened').map((e) => e.payload);
  const closed = () => of('segmentClosed').map((e) => e.payload);
  const audio = () => of('audio').map((e) => [e.payload.ref, e.payload.range]);
  return { s, clock, timers, log, of, texts, opened, closed, audio };
}
const pcm = (n = 4_800) => new Int16Array(n).fill(900);

describe("OpenAI Translate's segments: each side on its own timer", () => {
  it('opens each side on its first delta, sends the whole text each time, and closes each on its own pause, stating no origin (`OpenAITranslateGAClient.test.ts:146-638`)', () => {
    const { s, clock, timers, texts, opened, closed } = segments({ sourceMs: 700, translationMs: 2500, deferMidSentence: false });
    s.input('こんにちは');
    s.input('、元気');
    expect(opened()).toEqual([{ ref: 1, side: 'source' }]);
    expect(texts(1)).toEqual(['こんにちは', 'こんにちは、元気']);
    clock.advance(699);
    expect(closed()).toEqual([]);
    clock.advance(1);
    expect(closed()).toEqual([{ ref: 1 }]);
    s.output('Hello');
    expect(opened()[1]).toEqual({ ref: 2, side: 'translation' });
    clock.advance(2499);
    expect(closed()).toHaveLength(1);
    clock.advance(1);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(timers()).toBe(0);
  });

  it('keeps one segment while the deltas keep coming, and opens a new one after quiet', () => {
    const { s, clock, timers, texts, opened } = segments();
    s.input('one ');
    clock.advance(1400);
    s.input('two');
    expect(timers()).toBe(1);
    expect(texts(1)).toEqual(['one ', 'one two']);
    clock.advance(1500);
    s.input('again');
    expect(opened().map((o) => o.ref)).toEqual([1, 2]);
  });

  it('times the two sides independently: output text goes to the translation alone', () => {
    const { s, clock, texts, closed } = segments();
    s.input('speaking');
    s.output('translating');
    expect(texts(1)).toEqual(['speaking']);
    expect(texts(2)).toEqual(['translating']);
    clock.advance(1000);
    s.input(' on');
    clock.advance(600);
    expect(closed()).toEqual([{ ref: 2 }]);
  });

  it('opens a new source while the translation of the last one still streams', () => {
    const { s, clock, opened, texts } = segments({ sourceMs: 700, translationMs: 2500, deferMidSentence: false });
    s.input('first');
    s.output('premier');
    clock.advance(700);
    s.input('second');
    s.output(' toujours');
    expect(opened()).toEqual([{ ref: 1, side: 'source' }, { ref: 2, side: 'translation' }, { ref: 3, side: 'source' }]);
    expect(texts(2)).toEqual(['premier', 'premier toujours']);
  });

  it('ignores an empty delta and an empty frame', () => {
    const { s, log, timers } = segments();
    s.input('');
    s.output('');
    s.audio(new Int16Array(0), true);
    expect(log).toEqual([]);
    expect(timers()).toBe(0);
  });
});

describe("OpenAI Translate's segments: the translation's audio", () => {
  it('opens the translation when audio comes before its text (`OpenAITranslateGAClient.test.ts:308-328`), and plays under it', () => {
    const { s, opened, audio, texts } = segments();
    s.audio(pcm(), true);
    expect(opened()).toEqual([{ ref: 1, side: 'translation' }]);
    s.output('Hello');
    s.audio(pcm(), true);
    expect(audio()).toEqual([[1, [0, 0]], [1, [0, 5]]]);
    expect(texts(1)).toEqual(['Hello']);
  });

  it("ranges each frame over the text as it stands when the frame arrives, from the previous frame's end: ascending, never overlapping (ruling 6)", () => {
    const { s, audio } = segments();
    s.output('Hello');
    s.audio(pcm(), true);
    s.output(' there,');
    s.output(' friend.');
    s.audio(pcm(), true);
    s.audio(pcm(), true);
    expect(audio()).toEqual([[1, [0, 5]], [1, [5, 20]], [1, [20, 20]]]);
  });

  it('holds the translation open while its audio plays past its text (`OpenAITranslateGAClient.test.ts:450-471`), and closes it a pause after the last frame', () => {
    const { s, clock, timers, closed } = segments();
    s.output('A long sentence.');
    for (let i = 0; i < 6; i++) {
      clock.advance(500);
      s.audio(pcm(), true);
    }
    expect(closed()).toEqual([]);
    clock.advance(1499);
    expect(closed()).toEqual([]);
    clock.advance(1);
    expect(closed()).toEqual([{ ref: 1 }]);
    expect(timers()).toBe(0);
  });

  it('runs the same segments for audio it does not play, emitting none: Text only changes playback and nothing else (choice 5)', () => {
    const played = segments();
    const silent = segments();
    for (const { s, clock } of [played, silent]) {
      s.output('Hello');
      clock.advance(1000);
      s.audio(pcm(), s === played.s);
      clock.advance(1000);
      s.output(' again');
      clock.advance(1500);
    }
    const shape = (h: ReturnType<typeof segments>) => h.log.filter((e) => e.kind !== 'audio');
    expect(shape(silent)).toEqual(shape(played));
    expect(played.audio()).toEqual([[1, [0, 5]]]);
    expect(silent.audio()).toEqual([]);
  });

  it("opens the next translation for audio that comes after the last one closed, its ranges from 0 (the old client's new item)", () => {
    const { s, clock, opened, audio } = segments();
    s.output('Done.');
    s.audio(pcm(), true);
    clock.advance(1500);
    s.audio(pcm(), true);
    expect(opened().map((o) => o.ref)).toEqual([1, 2]);
    expect(audio()).toEqual([[1, [0, 5]], [2, [0, 0]]]);
  });
});

describe("OpenAI Translate's segments: sentence mode, the .done events, stop", () => {
  it('under sentence mode a mid-sentence pause waits while the text grows, on each side, and closes once it stops (Gemini choice 7)', () => {
    const { s, clock, timers, closed } = segments({ sourceMs: 1000, translationMs: 1000, deferMidSentence: true });
    s.input('He said that');
    s.output('Il a dit que');
    clock.advance(1000);
    expect(closed()).toEqual([]);
    s.input(' we should');
    clock.advance(1000);
    // The translation's tail did not grow: it closes; the source's did, and waits once more.
    expect(closed()).toEqual([{ ref: 2 }]);
    clock.advance(1000);
    expect(closed()).toEqual([{ ref: 2 }, { ref: 1 }]);
    expect(timers()).toBe(0);
    s.input('Done.');
    clock.advance(1000);
    expect(closed()).toEqual([{ ref: 2 }, { ref: 1 }, { ref: 3 }]);
  });

  it('without sentence mode a mid-sentence pause closes at once', () => {
    const { s, clock, closed } = segments({ sourceMs: 1000, translationMs: 1000, deferMidSentence: false });
    s.input('He said that');
    clock.advance(1000);
    expect(closed()).toEqual([{ ref: 1 }]);
  });

  it('closes a side at a .done event, should one come (choice 18), and leaves the other on its timer', () => {
    const { s, clock, timers, closed, opened } = segments();
    s.input('speaking');
    s.output('translating');
    s.done('translation');
    expect(closed()).toEqual([{ ref: 2 }]);
    expect(timers()).toBe(1);
    s.done('translation');
    expect(closed()).toHaveLength(1);
    s.audio(pcm(), true);
    expect(opened().map((o) => o.ref)).toEqual([1, 2, 3]);
    s.done('source');
    clock.advance(1500);
    expect(closed()).toEqual([{ ref: 2 }, { ref: 1 }, { ref: 3 }]);
    expect(timers()).toBe(0);
  });

  it('stop cancels every timer, a deferred one included, and emits nothing after it', () => {
    const { s, clock, timers, log } = segments({ sourceMs: 1000, translationMs: 1000, deferMidSentence: true });
    s.input('He said that');
    s.output('Translated.');
    clock.advance(1000);
    // The deferral re-armed the source's countdown; the translation, at a sentence end, closed.
    expect(timers()).toBe(1);
    const n = log.length;
    s.stop();
    expect(timers()).toBe(0);
    clock.advance(10_000);
    s.input('late');
    s.output('late');
    s.audio(pcm(), true);
    s.done('source');
    expect(timers()).toBe(0);
    expect(log.length).toBe(n);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/providers/openai_translate/segments.test.ts` — FAIL: no `./segments`.
- [ ] **Step 3: Implement.** `segments.ts`, in full:

```ts
/**
 * OpenAI Translate's deltas → segments (survey §2.9): the old client's two
 * independent sides (`OpenAITranslateGAClient.ts:95-99, 265-289`) without
 * its items — a pure machine on the request's clock. Each side is its own
 * segment, closed by its own silence timer; the translation's timer is held
 * by its content audio too, which opens a translation segment when none is
 * open (`:558-627`). Neither side states an origin: L2 infers the pair
 * (F16). Both transports will feed it: the WebRTC step adds a transport,
 * not a second machine.
 *
 * Copied from Gemini's Live Translate half (choice 4): the per-side
 * `ensure` / `close` / `arm` / `cancel` and the mid-sentence deferral of
 * `GeminiTurns` (`src/providers/gemini/turns.ts`). Not shared, because
 * three rules differ: here content audio opens and re-arms the translation,
 * where Gemini's never re-arms and plays ref-less outside an open one
 * (Gemini choice 8); here each audio frame carries a range (ruling 6); and
 * `GeminiTurns` is one class whose Live Translate half shares its fields
 * with the dialogue models' turns, cancels and suppressions. Importing it
 * would put another provider's session module on this one's session side.
 */
import type { AdapterEvents, Ref } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import { SilenceDeferral } from '../../lib/segmentation/silenceDeferral';
import type { TranslateConfig } from './config';

export type SegmentSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'audio'>;

export interface TranslateSegmentsOptions {
  clock: Pick<Clock, 'setTimeout'>;
  silence: TranslateConfig['silence'];
  sink: SegmentSink;
}

type SideName = 'source' | 'translation';

interface OpenSide {
  ref: Ref;
  /** Every delta so far, joined as it came: the deltas are append-only, and nothing goes between them (the SDK). */
  text: string;
  /** Translation only: where the last played frame's range ended (ruling 6). */
  spoken: number;
}

export class TranslateSegments {
  private refs = 0;
  private readonly sides: Record<SideName, OpenSide | null> = { source: null, translation: null };
  private readonly timers: Record<SideName, (() => void) | null> = { source: null, translation: null };
  private readonly deferral: Record<SideName, SilenceDeferral> = { source: new SilenceDeferral(), translation: new SilenceDeferral() };
  private stopped = false;

  constructor(private readonly o: TranslateSegmentsOptions) {}

  /** A source transcript delta. */
  input(delta: string): void {
    this.text('source', delta);
  }

  /** A translation transcript delta. */
  output(delta: string): void {
    this.text('translation', delta);
  }

  /**
   * Content audio (the adapter drops heartbeats before this): it opens the
   * translation segment when none is open and re-arms its timer whether it
   * plays or not, so Text only changes playback and nothing else (choice 5).
   * Played, it carries the translation's text as it stands at the frame's
   * arrival — `[the previous played frame's end, the text's length]` — an
   * alignment by arrival, not a known correspondence (ruling 6; choice 6).
   */
  audio(pcm: Int16Array, play: boolean): void {
    if (this.stopped || pcm.length === 0) return;
    const side = this.ensure('translation');
    this.arm('translation');
    if (!play) return;
    const end = side.text.length;
    this.o.sink.audio({ pcm, ref: side.ref, range: [side.spoken, end] });
    side.spoken = end;
  }

  /** A `.done` event, should the endpoint send one (choice 18): that side closes now, as the old client closed its item. */
  done(side: SideName): void {
    if (this.stopped) return;
    this.close(side);
  }

  stop(): void {
    this.stopped = true;
    this.cancel('source');
    this.cancel('translation');
  }

  private text(name: SideName, delta: string): void {
    if (this.stopped || !delta) return;
    const side = this.ensure(name);
    side.text += delta;
    this.o.sink.segmentText({ ref: side.ref, text: side.text });
    this.arm(name);
  }

  private ensure(name: SideName): OpenSide {
    const open = this.sides[name];
    if (open) return open;
    const ref = ++this.refs;
    this.o.sink.segmentOpened({ ref, side: name });
    const fresh: OpenSide = { ref, text: '', spoken: 0 };
    this.sides[name] = fresh;
    return fresh;
  }

  private close(name: SideName): void {
    this.cancel(name);
    this.deferral[name].reset();
    const open = this.sides[name];
    if (!open) return;
    this.sides[name] = null;
    this.o.sink.segmentClosed({ ref: open.ref });
  }

  /** (Re)starts a side's silence countdown (`OpenAITranslateGAClient.ts:265-289`). */
  private arm(name: SideName): void {
    const { silence } = this.o;
    this.cancel(name);
    this.timers[name] = this.o.clock.setTimeout(() => {
      this.timers[name] = null;
      const open = this.sides[name];
      if (this.stopped || !open) return;
      // While the display cuts by sentences, a pause mid-sentence is the speaker resting: one more window, while the text still grows (Gemini choice 7).
      if (silence.deferMidSentence && this.deferral[name].deferAtExpiry(open.text)) {
        this.arm(name);
        return;
      }
      this.close(name);
    }, name === 'source' ? silence.sourceMs : silence.translationMs);
  }

  private cancel(name: SideName): void {
    this.timers[name]?.();
    this.timers[name] = null;
  }
}
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then the full suite and the gate. Nothing imports `segments.ts` yet.
- [ ] **Step 5: Commit.**

```bash
git add src/providers/openai_translate/segments.ts src/providers/openai_translate/segments.test.ts
```

```bash
git commit -q -F - -- src/providers/openai_translate/segments.ts src/providers/openai_translate/segments.test.ts <<'EOF'
feat(openai_translate): each side a segment on its own silence timer

The deltas as segments: source and translation apart, each closed by its
own pause, with the mid-sentence deferral under sentence mode. Content
audio opens and holds the translation, played or not, and carries the
text as it stood when the frame arrived. Gemini's Live Translate machine,
copied with Translate's audio rules.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 6: The release tail (rulings 2, 21; choice 7)

**Files:**
- Create: `src/providers/openai_translate/tail.ts`
- Test: `src/providers/openai_translate/tail.test.ts`

**Interfaces:**
- Consumes: `SAMPLE_RATE` (`src/lib/contract/adapter.ts`), `every` and `Clock` (`src/lib/contract/clock.ts`); the kit's `trackedClock` (the test).
- Produces: `FRAME_MS = 200`; `FRAME_SAMPLES = 4_800`; `TAIL_QUIET_MS = 1_000`; `TAIL_MAX_MS = 3_000`; `type TailEnd = 'quiet' | 'cap' | 'press' | 'audio'`; `interface TailSummary { reason: TailEnd; silenceMs: number; lastOutputMs: number | null; cancelled?: true }`; `padSamples(sent: number): number`; `interface ReleaseTailOptions { clock: Pick<Clock, 'setTimeout' | 'now'>; send(pcm: Int16Array): void; ended(summary: TailSummary): void }`; `class ReleaseTail` with `running`, `start(sent, cancelled): number` (the pad's length), `output()`, `stop(reason: 'press' | 'audio')`, `cancel()`.
- Consumed by: Task 9.

The tail is pure: a clock and two callbacks. The adapter sends what it is handed (and counts it into `sent`) and frames the summary. The quiet is measured from the later of the release and the translation's last output during the tail, so a release after a long silent stretch still gets its full second (research Q1: the words owed come out only as model time advances). `every()` arms its next beat before it runs the tick, and `finish` cancels that beat: no timer outlives the tail.

- [ ] **Step 1: Write the failing test.** `tail.test.ts`, in full:

```ts
import { describe, it, expect } from 'vitest';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import { FRAME_MS, FRAME_SAMPLES, padSamples, ReleaseTail, TAIL_MAX_MS, TAIL_QUIET_MS, type TailSummary } from './tail';

function tail() {
  const { clock, timers } = trackedClock();
  const sent: Int16Array[] = [];
  const ended: TailSummary[] = [];
  const t = new ReleaseTail({ clock, send: (pcm) => sent.push(pcm), ended: (s) => ended.push(s) });
  /** What went up, as [length, all zero]. */
  const shape = () => sent.map((p) => [p.length, p.every((s) => s === 0)]);
  return { t, clock, timers, sent, ended, shape };
}
const frames = (n: number) => new Array(n).fill([FRAME_SAMPLES, true]);

describe("OpenAI Translate's release tail (ruling 2)", () => {
  it('works in the engine\'s 200 ms frames, and starts from one second of quiet capped at three', () => {
    expect([FRAME_MS, FRAME_SAMPLES, TAIL_QUIET_MS, TAIL_MAX_MS]).toEqual([200, 4_800, 1_000, 3_000]);
  });

  it('pads what was sent to the next 200 ms boundary, and nothing when it ends on one', () => {
    expect(padSamples(0)).toBe(0);
    expect(padSamples(1)).toBe(4_799);
    expect(padSamples(4_800)).toBe(0);
    // Three 85.3 ms capture chunks.
    expect(padSamples(3 * 2_048)).toBe(3_456);
    expect(padSamples(5 * 4_800 + 1)).toBe(4_799);
  });

  it('sends the pad at once, then 200 ms of silence every 200 ms, and stops once the translation has been quiet 1 s from the release', () => {
    const { t, clock, timers, ended, shape } = tail();
    expect(t.start(3 * 2_048, false)).toBe(3_456);
    expect(shape()).toEqual([[3_456, true]]);
    expect(t.running).toBe(true);
    clock.advance(1_000);
    expect(shape()).toEqual([[3_456, true], ...frames(5)]);
    expect(ended).toEqual([]);
    clock.advance(FRAME_MS);
    expect(shape()).toHaveLength(6);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
    expect(t.running).toBe(false);
    expect(timers()).toBe(0);
  });

  it("keeps going while the translation still writes or speaks, until it has been quiet 1 s", () => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(4_800, false);
    for (const at of [300, 900, 1_500]) {
      clock.advance(at - clock.now());
      t.output();
    }
    clock.advance(2_400 - clock.now());
    expect(ended).toEqual([]);
    clock.advance(FRAME_MS);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 2_400, lastOutputMs: 1_500 }]);
    // No pad: what was sent ended on the grid.
    expect(shape()).toEqual(frames(12));
    expect(timers()).toBe(0);
  });

  it('stops at 3 s after the release however long the translation goes on', () => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(0, false);
    for (let at = 250; at <= 5_000; at += 250) {
      clock.advance(250);
      t.output();
    }
    expect(ended).toEqual([{ reason: 'cap', silenceMs: 3_000, lastOutputMs: 3_000 }]);
    expect(shape()).toEqual(frames(15));
    expect(timers()).toBe(0);
  });

  it('a new press, or audio, ends it at once and says so; nothing more goes up', () => {
    const press = tail();
    press.t.start(0, false);
    press.clock.advance(700);
    press.t.stop('press');
    expect(press.ended).toEqual([{ reason: 'press', silenceMs: 600, lastOutputMs: null }]);
    press.clock.advance(5_000);
    expect(press.shape()).toEqual(frames(3));
    expect(press.timers()).toBe(0);

    const audio = tail();
    audio.t.start(0, false);
    audio.t.stop('audio');
    expect(audio.ended).toEqual([{ reason: 'audio', silenceMs: 0, lastOutputMs: null }]);
  });

  it("says a cancelled press's tail is one, and runs it the same (the press appended audio no clear can take back)", () => {
    const { t, clock, ended, shape } = tail();
    t.start(100, true);
    clock.advance(1_200);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null, cancelled: true }]);
    expect(shape()).toEqual([[4_700, true], ...frames(5)]);
  });

  it('cancel ends it silently: no summary, no timer, nothing more sent', () => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(0, false);
    clock.advance(400);
    t.cancel();
    clock.advance(5_000);
    expect(ended).toEqual([]);
    expect(shape()).toEqual(frames(2));
    expect(timers()).toBe(0);
    t.stop('press');
    expect(ended).toEqual([]);
  });

  it("ignores output while no tail runs: a release's quiet counts from the release", () => {
    const { t, clock, ended } = tail();
    t.output();
    clock.advance(500);
    t.start(0, false);
    clock.advance(1_200);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
  });

  it('a second release restarts the tail: the first ends silently, one timer runs', () => {
    const { t, clock, timers, ended } = tail();
    t.start(0, false);
    clock.advance(400);
    t.start(0, false);
    expect(timers()).toBe(1);
    clock.advance(1_200);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/providers/openai_translate/tail.test.ts` — FAIL: no `./tail`.
- [ ] **Step 3: Implement.** `tail.ts`, in full:

```ts
/**
 * A push-to-talk release on an endpoint with no commit and no server VAD
 * (ruling 2; research Q1). The server consumes 200 ms engine frames and
 * holds a shorter remainder until more audio arrives, and its model time
 * advances only with the audio it is sent (the SDK's
 * `RealtimeTranslationInputAudioBufferAppendEvent`): a release that just
 * stops sending leaves the press's last words untranslated until the next
 * press, spliced onto it. So a release sends, at once, the zeros that
 * complete the frame the server holds, then one 200 ms frame of silence
 * every 200 ms, in real time, until the translation has been quiet for
 * `TAIL_QUIET_MS`, and never past `TAIL_MAX_MS` after the release. A press,
 * or audio, ends it at once. Pure: a clock and two callbacks — the adapter
 * sends and frames (choice 7).
 */
import { SAMPLE_RATE } from '../../lib/contract/adapter';
import { every, type Clock } from '../../lib/contract/clock';

/** The engine's frame (the SDK: "Translation consumes 200 ms engine frames"). */
export const FRAME_MS = 200;
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;
/** How long the translation must have been quiet before the tail stops. A starting value the owner's live test tunes (ruling 2). */
export const TAIL_QUIET_MS = 1_000;
/** The tail's cap, from the release. A starting value the owner's live test tunes (ruling 2). */
export const TAIL_MAX_MS = 3_000;

export type TailEnd = 'quiet' | 'cap' | 'press' | 'audio';

/** What one tail did, for the Logs (`turn.tail_end`): what the live test tunes the two constants by. */
export interface TailSummary {
  reason: TailEnd;
  /** The real-time silence sent after the pad. */
  silenceMs: number;
  /** The translation's last text or audio after the release, from the release; null when none came. */
  lastOutputMs: number | null;
  cancelled?: true;
}

/** The zeros that complete the frame the server holds; none when what was sent ends on the grid. */
export function padSamples(sent: number): number {
  return (FRAME_SAMPLES - (sent % FRAME_SAMPLES)) % FRAME_SAMPLES;
}

export interface ReleaseTailOptions {
  clock: Pick<Clock, 'setTimeout' | 'now'>;
  /** Sends pcm up; the adapter counts it into what it has sent. */
  send(pcm: Int16Array): void;
  /** A tail ended by itself, or by a press or audio — never by `cancel`. */
  ended(summary: TailSummary): void;
}

/** One engine frame of silence, sent as it is (never written to). */
const SILENT_FRAME = new Int16Array(FRAME_SAMPLES);

interface Run {
  releasedAt: number;
  lastOutputAt: number | null;
  frames: number;
  cancelled: boolean;
  stop: () => void;
}

export class ReleaseTail {
  private run: Run | null = null;

  constructor(private readonly o: ReleaseTailOptions) {}

  get running(): boolean {
    return this.run !== null;
  }

  /** A release, with or without speech: the pad at once, then the silence in real time. `sent` is what the session sent so far, in samples. Returns the pad's length. */
  start(sent: number, cancelled: boolean): number {
    this.cancel();
    const pad = padSamples(sent);
    if (pad > 0) this.o.send(new Int16Array(pad));
    const run: Run = { releasedAt: this.o.clock.now(), lastOutputAt: null, frames: 0, cancelled, stop: () => {} };
    this.run = run;
    run.stop = every(this.o.clock, FRAME_MS, () => this.tick());
    return pad;
  }

  /** The translation wrote or spoke: its quiet starts again. Ignored while no tail runs. */
  output(): void {
    if (this.run) this.run.lastOutputAt = this.o.clock.now();
  }

  /** A new press, or audio: the tail ends now, and says so. */
  stop(reason: 'press' | 'audio'): void {
    if (this.run) this.finish(reason);
  }

  /** The session ends: the tail stops and says nothing (nothing may follow a stop). */
  cancel(): void {
    const run = this.run;
    this.run = null;
    run?.stop();
  }

  private tick(): void {
    const run = this.run;
    if (!run) return;
    const now = this.o.clock.now();
    if (now - Math.max(run.releasedAt, run.lastOutputAt ?? run.releasedAt) > TAIL_QUIET_MS) {
      this.finish('quiet');
      return;
    }
    if (now - run.releasedAt > TAIL_MAX_MS) {
      this.finish('cap');
      return;
    }
    this.o.send(SILENT_FRAME);
    run.frames += 1;
  }

  private finish(reason: TailEnd): void {
    const run = this.run;
    if (!run) return;
    this.run = null;
    run.stop();
    this.o.ended({
      reason,
      silenceMs: run.frames * FRAME_MS,
      lastOutputMs: run.lastOutputAt === null ? null : run.lastOutputAt - run.releasedAt,
      ...(run.cancelled ? { cancelled: true as const } : {}),
    });
  }
}
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then the full suite and the gate. Nothing imports `tail.ts` yet.
- [ ] **Step 5: Commit.**

```bash
git add src/providers/openai_translate/tail.ts src/providers/openai_translate/tail.test.ts
```

```bash
git commit -q -F - -- src/providers/openai_translate/tail.ts src/providers/openai_translate/tail.test.ts <<'EOF'
feat(openai_translate): a push-to-talk release tail in real time

The endpoint has no commit and holds a sub-frame remainder until more
audio comes. A release pads what was sent to the next 200 ms frame, then
sends 200 ms of silence every 200 ms until the translation has been quiet
1 s, at most 3 s; a press or audio ends it at once, and a summary of each
tail is what the live test tunes the two constants by.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 7: The check — one bounded model list (rulings 7, 18; choice 11)

**Files:**
- Create: `src/providers/openai_translate/check.ts`
- Test: `src/providers/openai_translate/check.test.ts`

**Interfaces:**
- Consumes: Task 3's `isTranslateModelId`, `TranslateCredentials`, `TranslateSettings`, `TRANSLATE_DEFAULTS`; Task 1's two codes (their words; nothing here imports them); `realClock`, `Clock`; `CheckContext`, `CheckResult`.
- Produces: `OPENAI_MODELS_URL`; `CHECK_TIMEOUT_MS = 15_000`; `createTranslateCheck(deps?: { fetch?; clock? })`; `checkTranslate`.
- Consumed by: Task 10 (`check`).

The old validation (`OpenAIClient.ts:140-203`, `GA:224-257`) read the same list with no bound and called every failure an invalid key (survey §1.14.9): a 5xx, a 429 or a failed fetch said "invalid". Now the key's refusals answer a code, and what says nothing about the key throws, which leaves Start off with no words about the key (spec: "Readiness is one check"). The fetch helpers are Gemini's `check.test.ts`' (`abortableFetchStub`, `spiedClock`). OpenAI's 401 text masks the key (`sk-proj-****…`), and `redact()` runs at the sinks anyway.

- [ ] **Step 1: Write the failing test.** `check.test.ts`, in full:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock, type Clock } from '../../lib/contract/clock';
import type { CheckContext } from '../../lib/provider/types';
import { CHECK_TIMEOUT_MS, createTranslateCheck, OPENAI_MODELS_URL } from './check';
import { TRANSLATE_DEFAULTS } from './settings';

const K = { apiKey: 'sk-proj-checkKey0123456789' };
const ctx = (signal?: AbortSignal): CheckContext => ({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'], signal });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const listing = (...models: Array<[string, number]>) => json({ object: 'list', data: models.map(([id, created]) => ({ id, object: 'model', created, owned_by: 'system' })) });
const check = (fetch: typeof globalThis.fetch) => createTranslateCheck({ fetch, clock: createVirtualClock(0) })(K, TRANSLATE_DEFAULTS, ctx());

/** A fetch stub that rejects once its request's `signal` aborts, with the signal's reason, as a real `fetch` does (Soniox's `check.test.ts` helper). */
function abortableFetchStub() {
  let signal: AbortSignal | undefined;
  const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal?.reason ?? new DOMException('aborted', 'AbortError')), { once: true });
    });
  });
  return { fetch, aborted: () => !!signal?.aborted };
}

/** A virtual clock whose cancel functions are spied: a stop proves its timer was cancelled, not merely left to fire. */
function spiedClock(): { clock: Pick<Clock, 'setTimeout'>; advance: (ms: number) => void; cancels: ReturnType<typeof vi.fn>[] } {
  const inner = createVirtualClock(0);
  const cancels: ReturnType<typeof vi.fn>[] = [];
  return {
    clock: { setTimeout: (fn, ms) => { const spy = vi.fn(inner.setTimeout(fn, ms)); cancels.push(spy); return spy; } },
    advance: inner.advance,
    cancels,
  };
}

describe("OpenAI Translate's check (choice 11)", () => {
  it('GETs the model list with the key as a Bearer token, never in the URL', async () => {
    const fetch = vi.fn(async () => listing(['gpt-realtime-translate', 1_780_000_000]));
    await check(fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENAI_MODELS_URL);
    expect(url).not.toContain(K.apiKey);
    expect(init).toMatchObject({ method: 'GET', headers: { Authorization: `Bearer ${K.apiKey}` } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('answers ready with the gpt-realtime-translate family alone, newest first, each id once', async () => {
    const fetch = vi.fn(async () => listing(
      ['gpt-realtime', 1_790_000_000],
      ['gpt-realtime-translate', 1_780_000_000],
      ['gpt-live-transcribe', 1_785_000_000],
      ['gpt-realtime-translate-2026-09-01', 1_789_000_000],
      ['gpt-realtime-translate', 1_780_000_000],
    ));
    await expect(check(fetch)).resolves.toEqual({ ok: true, models: [{ id: 'gpt-realtime-translate-2026-09-01' }, { id: 'gpt-realtime-translate' }] });
  });

  it("answers a key that reaches no translate model not ready, in the old validation's words (`no_translate_model`)", async () => {
    const fetch = vi.fn(async () => listing(['gpt-realtime', 1], ['gpt-4o-mini', 2]));
    await expect(check(fetch)).resolves.toEqual({ ok: false, code: 'no_translate_model', reason: 'This key lists no gpt-realtime-translate model.' });
    const empty = vi.fn(async () => json({ object: 'list' }));
    await expect(check(empty)).resolves.toMatchObject({ ok: false, code: 'no_translate_model' });
  });

  it("answers a refused key not ready with the auth code and OpenAI's own words (401, 403)", async () => {
    for (const status of [401, 403]) {
      const fetch = vi.fn(async () => json({ error: { message: 'Incorrect API key provided: sk-proj-****6789.', type: 'invalid_request_error', code: 'invalid_api_key' } }, status));
      await expect(check(fetch)).resolves.toEqual({ ok: false, code: 'auth', reason: `HTTP ${status}: Incorrect API key provided: sk-proj-****6789.` });
    }
    const bare = vi.fn(async () => new Response('', { status: 401 }));
    await expect(check(bare)).resolves.toEqual({ ok: false, code: 'auth', reason: 'HTTP 401: OpenAI did not accept this key.' });
  });

  it('answers a region OpenAI does not serve with its own code, whatever the status (`OpenAIClient.ts:170-179`)', async () => {
    for (const status of [403, 400]) {
      const fetch = vi.fn(async () => json({ error: { message: 'Country, region, or territory not supported', code: 'unsupported_country_region_territory' } }, status));
      await expect(check(fetch)).resolves.toEqual({ ok: false, code: 'region_unsupported', reason: `HTTP ${status}: Country, region, or territory not supported` });
    }
  });

  it('answers a rate limit or a spent quota not ready with the rate_limit code', async () => {
    for (const code of ['rate_limit_exceeded', 'insufficient_quota']) {
      const fetch = vi.fn(async () => json({ error: { message: 'You exceeded your current quota.', code } }, 429));
      await expect(check(fetch)).resolves.toEqual({ ok: false, code: 'rate_limit', reason: 'HTTP 429: You exceeded your current quota.' });
    }
  });

  it('throws on any other status, or a network failure: it could not find out (survey §1.14.9)', async () => {
    for (const status of [400, 404, 500, 503]) {
      const fetch = vi.fn(async () => json({ error: { message: 'nope' } }, status));
      await expect(check(fetch)).rejects.toThrow(`OpenAI answered the model list with HTTP ${status}.`);
    }
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(check(offline)).rejects.toThrow('Failed to fetch');
  });

  it('never answers with the key', async () => {
    const answers = await Promise.all([
      check(vi.fn(async () => listing(['gpt-realtime', 1]))),
      check(vi.fn(async () => new Response('', { status: 403 }))),
      check(vi.fn(async () => json({ error: { code: 'unsupported_country_region_territory' } }, 403))),
      check(vi.fn(async () => json({}, 429))),
    ]);
    expect(JSON.stringify(answers)).not.toContain(K.apiKey);
  });

  it('bounds its own request: no answer within 15 s throws, and aborts the request', async () => {
    const { clock, advance } = spiedClock();
    const { fetch, aborted } = abortableFetchStub();
    const answer = createTranslateCheck({ fetch, clock })(K, TRANSLATE_DEFAULTS, ctx());
    const settled = vi.fn();
    answer.then(settled, settled);
    advance(CHECK_TIMEOUT_MS - 1);
    expect(aborted()).toBe(false);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    advance(1);
    await expect(answer).rejects.toThrow('OpenAI did not answer the model list within 15 s.');
    expect(aborted()).toBe(true);
  });

  it("the start's signal aborts the request, and cancels its timer", async () => {
    const { clock, cancels } = spiedClock();
    const { fetch, aborted } = abortableFetchStub();
    const c = new AbortController();
    const answer = createTranslateCheck({ fetch, clock })(K, TRANSLATE_DEFAULTS, ctx(c.signal));
    c.abort(new Error('cancelled'));
    await expect(answer).rejects.toThrow('cancelled');
    expect(aborted()).toBe(true);
    expect(cancels[0]).toHaveBeenCalled();
  });

  it('an already aborted signal throws before any request', async () => {
    const fetch = vi.fn();
    await expect(createTranslateCheck({ fetch, clock: createVirtualClock(0) })(K, TRANSLATE_DEFAULTS, ctx(AbortSignal.abort(new Error('gone'))))).rejects.toThrow('gone');
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/providers/openai_translate/check.test.ts` — FAIL: no `./check`.
- [ ] **Step 3: Implement.** `check.ts`, in full:

```ts
/**
 * OpenAI Translate's readiness (spec: "Readiness is one check"): the model
 * list the old validation read (`OpenAIClient.ts:140-203`,
 * `OpenAITranslateGAClient.ts:224-257`), with three changes (choice 11) —
 * the request is bounded by `CHECK_TIMEOUT_MS` and the caller's signal; a
 * status the key does not explain (a 404, a 5xx) or a failed fetch throws,
 * where the old one called every failure an invalid key (survey §1.14.9);
 * and a refusal answers a code the surfaces put into words. The key rides in
 * the `Authorization` header, never the URL. The settings side: not reached
 * by the adapter, so it may use the real clock by default.
 */
import { realClock, type Clock } from '../../lib/contract/clock';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { isTranslateModelId, type TranslateCredentials, type TranslateSettings } from './settings';

export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
/** As long as Soniox's, Gemini's and Doubao's checks wait. */
export const CHECK_TIMEOUT_MS = 15_000;

interface ModelList { data?: Array<{ id?: unknown; created?: unknown }> }
interface ErrorBody { error?: { message?: unknown; code?: unknown } }

export interface TranslateCheckDeps {
  fetch?: typeof fetch;
  clock?: Pick<Clock, 'setTimeout'>;
}

export function createTranslateCheck(deps: TranslateCheckDeps = {}) {
  const clock = deps.clock ?? realClock;
  return async (k: TranslateCredentials, _s: TranslateSettings, ctx: CheckContext): Promise<CheckResult> => {
    if (ctx.signal?.aborted) throw ctx.signal.reason ?? new Error('aborted');
    // Read at call time, so a test's stubbed global is seen.
    const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const controller = new AbortController();
    let timedOut = false;
    const cancel = clock.setTimeout(() => { timedOut = true; controller.abort(); }, CHECK_TIMEOUT_MS);
    const onAbort = () => controller.abort(ctx.signal?.reason);
    ctx.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await doFetch(OPENAI_MODELS_URL, { method: 'GET', headers: { Authorization: `Bearer ${k.apiKey}` }, signal: controller.signal });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ErrorBody;
        const said = typeof body.error?.message === 'string' && body.error.message ? body.error.message : 'OpenAI did not accept this key.';
        const reason = `HTTP ${response.status}: ${said}`;
        // A region OpenAI does not serve reads as such, whatever the status (`OpenAIClient.ts:170-179`).
        if (body.error?.code === 'unsupported_country_region_territory') return { ok: false, code: 'region_unsupported', reason };
        if (response.status === 401 || response.status === 403) return { ok: false, code: 'auth', reason };
        if (response.status === 429) return { ok: false, code: 'rate_limit', reason };
        throw new Error(`OpenAI answered the model list with HTTP ${response.status}.`);
      }
      const body = (await response.json()) as ModelList;
      const models = (body.data ?? [])
        .flatMap((m) => (typeof m.id === 'string' && isTranslateModelId(m.id) ? [{ id: m.id, created: typeof m.created === 'number' ? m.created : 0 }] : []))
        // Newest first, as the old list sorted them (`OpenAITranslateGAClient.ts:231-234`); the id breaks a tie.
        .sort((a, b) => b.created - a.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      // Each id once: a readiness answer's models are keyed by id.
      const ids = [...new Set(models.map((m) => m.id))];
      if (ids.length === 0) return { ok: false, code: 'no_translate_model', reason: 'This key lists no gpt-realtime-translate model.' };
      return { ok: true, models: ids.map((id) => ({ id })) };
    } catch (error) {
      if (timedOut) throw new Error(`OpenAI did not answer the model list within ${CHECK_TIMEOUT_MS / 1000} s.`);
      throw error;
    } finally {
      cancel();
      ctx.signal?.removeEventListener('abort', onAbort);
    }
  };
}

export const checkTranslate = createTranslateCheck();
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then the full suite and the gate. Nothing imports `check.ts` yet.
- [ ] **Step 5: Commit.**

```bash
git add src/providers/openai_translate/check.ts src/providers/openai_translate/check.test.ts
```

```bash
git commit -q -F - -- src/providers/openai_translate/check.ts src/providers/openai_translate/check.test.ts <<'EOF'
feat(openai_translate): check the key with one bounded model list

GET /v1/models with the key as a Bearer token, bounded to 15 s and the
caller's signal: the gpt-realtime-translate family ready, newest first;
no such model, an unsupported region, a refused key and a rate limit
each a code in words; any other status or a failed fetch throws, where
the old validation called every failure an invalid key.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 8: Translate's own settings view (D18; rulings 1, 7, 8, 19; choice 13)

**Files:**
- Create: `src/providers/openai_translate/TranslateSettings.tsx`
- Test: `src/providers/openai_translate/TranslateSettings.test.tsx`

**Interfaces:**
- Consumes: Task 2's `NoiseReductionField`; Task 3's `NOISE_REDUCTIONS`, `TranslateSettings`, `TRANSLATE_DEFAULTS`; `SettingsProps`.
- Produces: `TranslateSettingsView({ settings, update, disabled }: SettingsProps<TranslateSettings>)`.
- Consumed by: Task 10 (`Settings`).

What is left of the old tab once the pair, the key and the speech mode have their generic homes (survey §2.8): the info banner, first, its markup byte for byte (`ProviderSpecificSettings.tsx:2173-2183`; its rules already in `Settings.scss:48-66`), and the noise reduction. Not drawn: the model select and the transcript select (constants, rulings 7, 8), the transport toggle (the WebRTC step, ruling 1). The view shows on Advanced's Provider tab only, as every provider's own `Settings` does (`ProviderArea.tsx`, `SessionSettingsProvider`); Simple mode shows none of it.

- [ ] **Step 1: Write the failing test.** `TranslateSettings.test.tsx`, in full:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { resolve } from 'node:path';
import { compile } from 'sass';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: () => null }));

import { TranslateSettingsView } from './TranslateSettings';
import { TRANSLATE_DEFAULTS } from './settings';

describe("OpenAI Translate's settings view", () => {
  it("draws the old info banner first, byte for byte its markup (`ProviderSpecificSettings.tsx:2173-2183`)", () => {
    const { container } = render(<TranslateSettingsView settings={TRANSLATE_DEFAULTS} update={vi.fn()} />);
    const banner = container.firstElementChild!;
    expect(banner.className).toBe('settings-section translate-info-banner');
    const inner = banner.firstElementChild!;
    expect(inner.className).toBe('info-banner');
    expect(inner.querySelector('svg')).not.toBeNull();
    expect(inner.querySelector('span')?.textContent).toBe('settings.translateInfoBanner');
  });

  it('draws the noise reduction, writing its own field; nothing else — no model, transcript model or transport (rulings 1, 7, 8)', () => {
    const update = vi.fn();
    const { container } = render(<TranslateSettingsView settings={{ ...TRANSLATE_DEFAULTS, transportType: 'webrtc' }} update={update} />);
    const select = screen.getByLabelText('settings.noiseReduction') as HTMLSelectElement;
    expect(select.value).toBe('None');
    expect([...select.options].map((o) => o.value)).toEqual(['None', 'Near field', 'Far field']);
    fireEvent.change(select, { target: { value: 'Near field' } });
    expect(update).toHaveBeenCalledWith({ noiseReduction: 'Near field' });
    expect(container.querySelectorAll('select')).toHaveLength(1);
    expect(container.querySelectorAll('input, button')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/transport|webrtc|model/i);
  });

  it('locks the noise reduction while disabled', () => {
    render(<TranslateSettingsView settings={TRANSLATE_DEFAULTS} update={vi.fn()} disabled />);
    expect(screen.getByLabelText('settings.noiseReduction')).toBeDisabled();
  });

  it('keeps the banner styled: its rules are in the compiled Settings.scss', () => {
    const { css } = compile(resolve(__dirname, '../../components/Settings/Settings.scss'));
    expect(css).toMatch(/\.settings-section\.translate-info-banner \.info-banner \{[^}]*display: flex;/);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/providers/openai_translate/TranslateSettings.test.tsx` — FAIL: no `./TranslateSettings`.
- [ ] **Step 3: Implement.** `TranslateSettings.tsx`, in full:

```tsx
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NoiseReductionField } from '../../components/providers/fields/NoiseReductionField';
import type { SettingsProps } from '../../lib/provider/types';
import { NOISE_REDUCTIONS, type TranslateSettings } from './settings';

/**
 * OpenAI Translate's own settings (D18): what the old tab showed for it once
 * the pair, the key and the speech mode have their generic homes — the info
 * banner, first, as it was (`ProviderSpecificSettings.tsx:2173-2183`), and
 * the noise reduction (choice 13). The model and the transcript model are
 * constants (rulings 7, 8); the transport stays unshown until the WebRTC
 * step (ruling 1); there are no turn-detection knobs.
 */
export function TranslateSettingsView({ settings, update, disabled = false }: SettingsProps<TranslateSettings>) {
  const { t } = useTranslation();
  return (
    <>
      <div className="settings-section translate-info-banner">
        <div className="info-banner">
          <Info size={14} />
          <span>{t('settings.translateInfoBanner')}</span>
        </div>
      </div>
      <NoiseReductionField value={settings.noiseReduction} options={NOISE_REDUCTIONS} onChange={(noiseReduction) => update({ noiseReduction })} disabled={disabled} />
    </>
  );
}
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then the full suite and the gate. Nothing renders the view yet.
- [ ] **Step 5: Commit.**

```bash
git add src/providers/openai_translate/TranslateSettings.tsx src/providers/openai_translate/TranslateSettings.test.tsx
```

```bash
git commit -q -F - -- src/providers/openai_translate/TranslateSettings.tsx src/providers/openai_translate/TranslateSettings.test.tsx <<'EOF'
feat(openai_translate): its own settings view

The old info banner, first, and the shared noise reduction field. No
model, transcript model or transport control: the first two are
constants, the transport waits for the WebRTC step.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

## Wave 3

### Task 9: The adapter (rulings 2, 3, 4, 6, 13, 16, 20, 21; choices 1, 2, 3, 5, 7, 9, 12, 15, 16, 17, 18)

**Files:**
- Modify: `src/providers/openai_translate/adapter.ts` (replaces the seed), `src/providers/openai_translate/testing.ts` (the harness), `src/providers/sessionSide.consistency.test.ts`
- Test: `src/providers/openai_translate/adapter.test.ts`

**Interfaces:**
- Consumes: Task 3's `TranslateConfig`, `TranslateCredentials` (types); Task 4's wire, `socket.ts` and fixtures (`configFor`, `KEY`, `SERVER`, `RefusingWebSocket`); Task 5's `TranslateSegments`; Task 6's `ReleaseTail`, `TailSummary`, `FRAME_SAMPLES` (the test); the SDK's server event types (`import type`); `AdapterStartError`, `framePayload`, `describeCause`; the kit (`fakeSockets`, `trackedClock`, `recordEvents`, `runScenario`, `scenarioNames`, `flush`); `Conversation`, `createProjector` and `DEFAULT_PROJECTION` (the projection case).
- Produces: `createTranslateAdapter(deps?: Partial<TranslateAdapterDeps>): Adapter<TranslateConfig, TranslateCredentials>`; `interface TranslateAdapterDeps { openSocket: OpenSocket }`; `START_TIMEOUT_MS = 30_000`; `NEVER_OPENED`; `ERROR_WORDS_MS = 10_000`; in `testing.ts`, `startTranslate(o?: { context?; patch?; credentials? })` → `{ sockets, clock, timers, log, controller, config, starting, socket, of, frames, sent, appended, content }` and `liveTranslate(o?)` (started, opened, created, updated; with `session`).
- Consumed by: Task 10 (`provider.ts`: `start`; `provider.test.ts`: the fixtures); group checks A and B; the owner's live test.

One leg, one socket. **Opening** (choices 1, 2): the socket to `translateUrl(c)` with `translateProtocols(k)`, `binaryType = 'arraybuffer'`; on open, `session.opened` is framed (never the protocols); on `session.created`, `session.update` goes up and both are framed; on `session.updated` the start resolves. It rejects — the socket closed, nothing emitted but frames, no timer left — on the signal; on an `error` event before `session.updated` (its code and OpenAI's words, choice 9); on a socket that fails before it opens (`NEVER_OPENED`, `network`); on a close after it opened, or the server's `session.closed` (`server`); at 30 s (`network` or `server`); and at once, in fixed words, when the browser will not construct the socket.

**The session** (`info.transport` read from `C.transport`, choice 15):

| Call or event | What the adapter does |
|---|---|
| `appendAudio(pcm)` | while live: a running tail ends (`audio`), then one `session.input_audio_buffer.append` of the chunk's own bytes; `sent` counts its samples; no frame |
| `beginTurn()` | a running tail ends (`press`); nothing is sent |
| `endTurn()` / `cancelTurn()` | under manual turns: the tail (choice 7), framed `turn.tail` `{ padSamples, cancelled? }`; `turn.tail_end` when it ends; under automatic turns nothing |
| `appendText()` | nothing (`textInput: false`) |
| `stop()` | the tail and both sides' timers stop silently, the four handlers detach, the socket closes (1000) — before it returns; no `session.close` (parity) |
| `session.input_transcript.delta` | framed `{ delta, elapsedMs }`; the source side |
| `session.output_transcript.delta` | framed `{ delta, elapsedMs }`; the translation side; the tail's output mark |
| `session.output_audio.delta`, all zero | a heartbeat: nothing at all |
| `session.output_audio.delta`, content | framed `{ samples, rms, elapsedMs, sampleRate }`; the translation side, played when the leg speaks and the rate is 24 kHz (choices 5, 6, 16); the tail's output mark |
| `session.*_transcript.done`, `session.output_audio.done` | framed; that side closes (choice 18) |
| `error` | framed `session.error` `{ type, code, message, param }`; remembered with its time, for a close within `ERROR_WORDS_MS`; nothing else (ruling 3; choice 9) |
| `session.closed` | framed; `failed` in a recent error's code and words (choice 9), else `closed({ reason: 'session.closed' })` (ruling 13) |
| socket `error` | framed `session.socket_error` |
| socket close | framed `session.connection_lost` `{ code, reason }`; `failed` — a recent error's code and words, else `connection_lost` (choice 9) |
| an unreadable frame, an undecodable audio delta | framed `session.unreadable`, `degraded('parse_error')`, each once per episode (choice 17) |
| any other type | framed `session.unknown` `{ type }` |

The behaviour specs ported from the old tests (survey §1.13): the URL with `?model=`, `session.update` after `session.created`, the append payload (`OpenAITranslateGAClient.test.ts:642-745`), plus the subprotocols and no beta tag; a heartbeat never opens, plays, re-arms or frames (`:146-638`). Not ported: relay mode (`:783-811`), the per-append log lines, the `rms` annotation on appends.

- [ ] **Step 1: Write the harness, the guard's case, then the failing test.** `testing.ts` gains the harness (from Task 4's file):

```diff
--- a/src/providers/openai_translate/testing.ts
+++ b/src/providers/openai_translate/testing.ts
@@ -1,15 +1,20 @@
 /**
  * The OpenAI Translate suites' fixtures: a key, the settings the suites
  * build from, the server's events as the JSON text frames the endpoint
- * sends, and a browser that refuses the socket. Test-only: nothing but a
- * test imports it (the session-side guard's kit rule counts every
- * provider's `testing.ts` as kit and holds it to that), and the adapter's
- * session walk never reaches it.
+ * sends, a browser that refuses the socket, and the harness that starts a
+ * leg over `FakeSocket`s. Test-only: nothing but a test imports it (the
+ * session-side guard's kit rule counts every provider's `testing.ts` as kit
+ * and holds it to that), and the adapter's session walk never reaches it.
  */
 import type { SessionContext } from '../../lib/contract/adapter';
+import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
+import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
+import { trackedClock } from '../../lib/contract/testing/trackedClock';
 import type { SharedSettings } from '../../lib/provider/types';
+import { createTranslateAdapter } from './adapter';
 import { buildTranslate, type TranslateConfig } from './config';
 import { TRANSLATE_DEFAULTS, type TranslateCredentials, type TranslateSettings } from './settings';
+import { base64ToPcm } from './wire';
 
 /** Shaped as a real key (`sk-…`), which `redact()` masks: a frame that carried it fails the kit's `frame-secret` rule. */
 export const KEY: TranslateCredentials = { apiKey: 'sk-proj-translateKey0123456789' };
@@ -63,3 +68,35 @@
   /** An event by its type alone: a `.done` the SDK does not list, or one it never sends. */
   bare: (type: string) => event({ type }),
 };
+
+/** An OpenAI Translate leg started over `FakeSocket`s on a tracked virtual clock; its socket not yet opened. */
+export function startTranslate(o: { context?: SessionContext; patch?: Partial<TranslateSettings>; credentials?: TranslateCredentials } = {}) {
+  const sockets = fakeSockets();
+  const { clock, timers } = trackedClock();
+  const { events, log } = recordEvents();
+  const controller = new AbortController();
+  const context = o.context ?? AUTO_CTX;
+  const config = configFor(context, o.patch);
+  const starting = createTranslateAdapter({ openSocket: sockets.create }).start({ context, config, credentials: o.credentials ?? KEY, clock, signal: controller.signal }, events);
+  const socket = () => sockets.last();
+  const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
+  /** The payloads of the frames of one type, in order. */
+  const frames = (type: string) => of('frame').filter((e) => e.payload.type === type).map((e) => e.payload.payload);
+  /** What the client sent on the leg's socket, parsed. */
+  const sent = () => socket().sentJson<Record<string, unknown>>();
+  /** The pcm of every append sent, in order. */
+  const appended = () => sent().filter((m) => m.type === 'session.input_audio_buffer.append').map((m) => base64ToPcm(m.audio as string));
+  /** The log without its frames: what L1 folds. */
+  const content = () => log.filter((e) => e.kind !== 'frame');
+  return { sockets, clock, timers, log, controller, config, starting, socket, of, frames, sent, appended, content };
+}
+
+/** Started, opened, created and configured: the start resolved. */
+export async function liveTranslate(o?: Parameters<typeof startTranslate>[0]) {
+  const h = startTranslate(o);
+  h.socket().open('realtime');
+  h.socket().receive(SERVER.created());
+  h.socket().receive(SERVER.updated());
+  const session = await h.starting;
+  return { ...h, session };
+}
```

  `sessionSide.consistency.test.ts`, the walk's case gains Translate's folder:

```diff
--- a/src/providers/sessionSide.consistency.test.ts
+++ b/src/providers/sessionSide.consistency.test.ts
@@ -231,6 +231,19 @@
     for (const file of ['Ast2Settings.tsx', 'check.ts', 'config.ts', 'provider.ts', 'settings.ts', 'testing.ts']) {
       expect(ast2).not.toContain(`src/providers/volcengine_ast2/${file}`);
     }
+
+    const translate = sessionSide(REPO_ROOT, 'src/providers/openai_translate');
+    expect(translate).toEqual(expect.arrayContaining([
+      'src/providers/openai_translate/adapter.ts',
+      'src/providers/openai_translate/segments.ts',
+      'src/providers/openai_translate/socket.ts',
+      'src/providers/openai_translate/tail.ts',
+      'src/providers/openai_translate/wire.ts',
+    ]));
+    // The builder, the check, the settings, the view, the definition and the fixtures are not the session's.
+    for (const file of ['TranslateSettings.tsx', 'check.ts', 'config.ts', 'provider.ts', 'settings.ts', 'testing.ts']) {
+      expect(translate).not.toContain(`src/providers/openai_translate/${file}`);
+    }
   });
 
   it('reads imports the way the compiler does', () => {
```

  `adapter.test.ts`, in full:

```ts
/**
 * OpenAI Translate's adapter: the conformance suite, the opening and its
 * refusals in words, the audio going up and a release's tail, the deltas to
 * segments, failures and stop. On `FakeSocket` and a virtual clock — no
 * network, no fake timers.
 */
import { describe, it, expect, vi } from 'vitest';
import { AdapterStartError } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { flush, type ScenarioStep } from '../../lib/contract/testing/drive';
import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { runScenario, scenarioNames, type AdapterHarness } from '../../lib/contract/testing/scenarios';
import { Conversation } from '../../lib/conversation/Conversation';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import { createTranslateAdapter, ERROR_WORDS_MS, NEVER_OPENED, START_TIMEOUT_MS } from './adapter';
import type { TranslateConfig } from './config';
import type { TranslateCredentials } from './settings';
import { FRAME_SAMPLES } from './tail';
import { AUTO_CTX, configFor, KEY, liveTranslate, RefusingWebSocket, SERVER, startTranslate } from './testing';
import { translateProtocols, translateUrl } from './wire';

const MANUAL = { ...AUTO_CTX, turns: 'manual' as const };
/** A capture chunk: 2 048 samples of 24 kHz voice, 85.3 ms. */
const chunk = () => new Int16Array(2_048).fill(1_000);
const isSilent = (pcm: Int16Array) => pcm.every((s) => s === 0);
/** What no frame, failure or refusal may carry: the key, and the subprotocol that holds it. */
const SECRETS = [KEY.apiKey, 'openai-insecure-api-key', 'translateKey'];

function harness(): AdapterHarness<TranslateConfig, TranslateCredentials> {
  let sockets = fakeSockets();
  const last = () => sockets.last();
  const reply = (frame: () => string): ScenarioStep => ({ run: () => last().receive(frame()) });
  return {
    adapter: createTranslateAdapter({ openSocket: (url, protocols) => sockets.create(url, protocols) }),
    config: (context) => { sockets = fakeSockets(); return configFor(context); },
    credentials: KEY,
    opening: () => [{ run: () => last().open('realtime') }, reply(() => SERVER.created()), reply(() => SERVER.updated()), { flush: true }],
    exchange: [
      reply(() => SERVER.input('こんにちは。')),
      reply(() => SERVER.output('Hello.')),
      reply(() => SERVER.audio()),
      reply(() => SERVER.heartbeat()),
      { advance: 2_000 },
    ],
    serverClose: [{ run: () => last().serverClose(1011, 'Internal error') }, { flush: true }],
    refuse: [{ run: () => last().drop() }, { flush: true }],
  };
}

describe('the OpenAI Translate adapter: conformance', () => {
  const h = harness();

  it('runs every scenario but typed text and reconnecting, which Translate has neither of', () => {
    expect(scenarioNames(h)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'server-close']);
  });

  it.each(scenarioNames(h))('%s', async (name) => {
    const report = await runScenario(h, name);
    expect(report.violations).toEqual([]);
    expect(report.problems).toEqual([]);
  });
});

describe('the OpenAI Translate adapter: opening', () => {
  it('dials the endpoint with the model in its query and the key in a subprotocol, reads binary frames as ArrayBuffers, and sends nothing until the session exists (choice 3)', () => {
    const h = startTranslate();
    expect(h.socket().url).toBe(translateUrl(h.config));
    expect(h.socket().protocols).toEqual(translateProtocols(KEY));
    expect(h.socket().binaryType).toBe('arraybuffer');
    h.socket().open('realtime');
    expect(h.sent()).toEqual([]);
    expect(h.frames('session.opened')).toEqual([{ model: 'gpt-realtime-translate', target: 'en', transcriptModel: 'gpt-live-transcribe', noiseReduction: null, speaking: true, manual: false }]);
  });

  it("configures the session once the server's session exists, framing what the server started with and what it was sent (choice 1)", () => {
    const h = startTranslate({ patch: { noiseReduction: 'Far field' } });
    h.socket().open('realtime');
    h.socket().receive(SERVER.created());
    expect(h.sent()).toEqual([{ type: 'session.update', session: { audio: { output: { language: 'en' }, input: { transcription: { model: 'gpt-live-transcribe' }, noise_reduction: { type: 'far_field' } } } } }]);
    expect(h.frames('session.created')).toEqual([{ id: 'sess_1', model: 'gpt-realtime-translate', expiresAt: 1_790_000_000, audio: { input: { noise_reduction: { type: 'near_field' }, transcription: null }, output: { language: 'en' } } }]);
    expect(h.frames('session.update')).toEqual([{ audio: { output: { language: 'en' }, input: { transcription: { model: 'gpt-live-transcribe' }, noise_reduction: { type: 'far_field' } } } }]);
  });

  it('resolves only once the server confirms the configuration, emitting nothing but frames, over a websocket, with no timer left (choice 1)', async () => {
    const h = startTranslate();
    let resolved = false;
    void h.starting.then(() => { resolved = true; });
    h.socket().open('realtime');
    h.socket().receive(SERVER.created());
    await flush();
    expect(resolved).toBe(false);
    h.socket().receive(SERVER.updated());
    const session = await h.starting;
    expect(session.info).toEqual({ transport: 'websocket' });
    expect(h.frames('session.updated')).toEqual([{ audio: { input: { noise_reduction: null, transcription: { model: 'gpt-live-transcribe' } }, output: { language: 'en' } } }]);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it.each([
    ['invalid_api_key', 'invalid_request_error', 'auth'],
    ['rate_limit_exceeded', 'invalid_request_error', 'rate_limit'],
    ['unknown_parameter', 'invalid_request_error', 'client'],
    [null, 'server_error', 'server'],
  ] as const)('an error (%s) before the configuration is confirmed rejects the start in OpenAI\'s words, as %s', async (code, type, expected) => {
    const h = startTranslate();
    h.socket().open('realtime');
    h.socket().receive(SERVER.created());
    h.socket().receive(SERVER.error({ type, code, message: 'The request was refused.' }));
    const error = await h.starting.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect(error).toMatchObject({ code: expected, message: `[OpenAI ${code ?? type}] The request was refused.` });
    expect(h.frames('session.error')).toEqual([{ type, code, message: 'The request was refused.', param: null }]);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a socket that fails before it opens rejects as the network, in words naming the network and the key — never the key itself (choice 2)', async () => {
    const h = startTranslate();
    h.socket().drop();
    const error = await h.starting.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect(error).toMatchObject({ code: 'network', message: NEVER_OPENED });
    expect(NEVER_OPENED).toBe("OpenAI's socket did not open (check the network, and that the API key is still valid).");
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it("a close after the socket opened, or the server's session.closed, before the start rejects as the service's", async () => {
    const closed = startTranslate();
    closed.socket().open('realtime');
    closed.socket().serverClose(1008, 'policy');
    await expect(closed.starting).rejects.toMatchObject({ code: 'server', message: 'OpenAI closed the connection before the session started (1008 policy).' });
    expect(closed.frames('session.connection_lost')).toEqual([{ code: 1008, reason: 'policy' }]);

    const ended = startTranslate();
    ended.socket().open('realtime');
    ended.socket().receive(SERVER.created());
    ended.socket().receive(SERVER.closed());
    await expect(ended.starting).rejects.toMatchObject({ code: 'server', message: 'OpenAI closed the session before it started.' });
    expect(ended.content()).toEqual([]);
  });

  it('bounds the start: no confirmation within 30 s rejects — network when the socket never opened, server when it did — and closes the socket (choice 2)', async () => {
    const never = startTranslate();
    never.clock.advance(START_TIMEOUT_MS);
    await expect(never.starting).rejects.toMatchObject({ code: 'network', message: 'OpenAI did not open the connection within 30 s.' });
    expect(never.socket().closedByClient).not.toBeNull();
    expect(never.timers()).toBe(0);

    const silent = startTranslate();
    let settled = false;
    void silent.starting.catch(() => { settled = true; });
    silent.socket().open('realtime');
    silent.socket().receive(SERVER.created());
    silent.clock.advance(START_TIMEOUT_MS - 1);
    await flush();
    expect(settled).toBe(false);
    silent.clock.advance(1);
    await expect(silent.starting).rejects.toMatchObject({ code: 'server', message: 'OpenAI did not start the session within 30 s.' });
    expect(silent.timers()).toBe(0);
  });

  it('an abort while opening rejects with its reason, closes the socket and emits nothing; a start already aborted opens no socket', async () => {
    const h = startTranslate();
    h.socket().open('realtime');
    const reason = new Error('cancelled');
    h.controller.abort(reason);
    await expect(h.starting).rejects.toBe(reason);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);

    const sockets = fakeSockets();
    const controller = new AbortController();
    controller.abort(reason);
    const starting = createTranslateAdapter({ openSocket: sockets.create }).start(
      { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    );
    await expect(starting).rejects.toBe(reason);
    expect(sockets.all).toEqual([]);
  });

  it("a browser that will not open the socket rejects the start in fixed words, never its own, which quote the key (choice 3)", async () => {
    // As Chromium throws it for an invalid subprotocol: a DOMException named SyntaxError, the subprotocols in the message.
    const openSocket = (_url: string, protocols: string[]): WebSocket => { throw new DOMException(`Failed to construct 'WebSocket': The subprotocol '${protocols[1]}' is invalid.`, 'SyntaxError'); };
    const { events, log } = recordEvents();
    let starting: Promise<unknown> = Promise.resolve();
    expect(() => {
      starting = createTranslateAdapter({ openSocket }).start(
        { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: new AbortController().signal },
        events,
      );
    }).not.toThrow();
    const error = await starting.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect(error).toMatchObject({ code: 'network', message: 'The browser would not open the socket (SyntaxError).' });
    // No cause either: the console line that reports a failed start prints it raw.
    expect((error as AdapterStartError).cause).toBeUndefined();
    for (const secret of SECRETS) expect((error as Error).message).not.toContain(secret);
    expect(log).toEqual([]);
  });

  it("through the app's own socket, a browser's refusal still reads as the browser's error name, and nothing is opened or said", async () => {
    vi.stubGlobal('WebSocket', RefusingWebSocket);
    try {
      const { events, log } = recordEvents();
      // No opener injected: the seam the app uses, reading the stubbed global.
      const starting = createTranslateAdapter().start(
        { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: new AbortController().signal },
        events,
      );
      const error = await starting.then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(AdapterStartError);
      expect(error).toMatchObject({ code: 'network', message: 'The browser would not open the socket (SyntaxError).' });
      expect((error as AdapterStartError).cause).toBeUndefined();
      expect(log).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the OpenAI Translate adapter: audio up, and a release', () => {
  it('sends each chunk as it came, one append each, and frames none of them (the hot-path rule)', async () => {
    const h = await liveTranslate();
    for (let i = 0; i < 3; i++) h.session.appendAudio(chunk());
    expect(h.sent().map((m) => m.type)).toEqual(['session.update', ...new Array(3).fill('session.input_audio_buffer.append')]);
    expect(h.appended().map((p) => [p.length, p[0]])).toEqual([[2_048, 1_000], [2_048, 1_000], [2_048, 1_000]]);
    expect(h.of('frame').filter((f) => f.payload.direction === 'out').map((f) => f.payload.type)).toEqual(['session.opened', 'session.update']);
  });

  it('under push-to-talk a release pads the held remainder to the 200 ms grid, then sends silence in real time until the translation is quiet 1 s (ruling 2)', async () => {
    const h = await liveTranslate({ context: MANUAL });
    h.session.beginTurn();
    for (let i = 0; i < 3; i++) h.session.appendAudio(chunk());
    h.session.endTurn();
    // Three chunks, 6 144 samples; the pad completes the second 200 ms frame.
    expect(h.appended().slice(3).map((p) => [p.length, isSilent(p)])).toEqual([[3_456, true]]);
    expect(h.frames('turn.tail')).toEqual([{ padSamples: 3_456 }]);
    // The translation of the press's last words comes out while the tail runs.
    h.clock.advance(300);
    h.socket().receive(SERVER.output('the last words.'));
    h.clock.advance(1_300 - 300);
    expect(h.frames('turn.tail_end')).toEqual([]);
    h.clock.advance(200);
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'quiet', silenceMs: 1_200, lastOutputMs: 300 }]);
    const tail = h.appended().slice(4);
    expect(tail.map((p) => [p.length, isSilent(p)])).toEqual(new Array(6).fill([FRAME_SAMPLES, true]));
    // Everything sent ends on the grid.
    expect(h.appended().reduce((n, p) => n + p.length, 0) % FRAME_SAMPLES).toBe(0);
    expect(h.timers()).toBe(1);
  });

  it.each([true, false])('content audio during a release tail keeps it running, as text does, speaking %s (ruling 2; choices 5, 7)', async (speech) => {
    const h = await liveTranslate({ context: { ...MANUAL, speech } });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.clock.advance(800);
    h.socket().receive(SERVER.audio());
    h.clock.advance(1_000);
    expect(h.frames('turn.tail_end')).toEqual([]);
    h.clock.advance(200);
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'quiet', silenceMs: 1_800, lastOutputMs: 800 }]);
  });

  it("a press without speech sends the same tail, said as a cancel: the press's audio is the model's input already, and no clear exists (choice 7)", async () => {
    const h = await liveTranslate({ context: MANUAL });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.cancelTurn();
    h.clock.advance(1_200);
    expect(h.frames('turn.tail')).toEqual([{ padSamples: 2_752, cancelled: true }]);
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null, cancelled: true }]);
  });

  it('a new press ends the tail at once, before its audio goes up; audio would end it too (ruling 2)', async () => {
    const h = await liveTranslate({ context: MANUAL });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.clock.advance(400);
    h.session.beginTurn();
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'press', silenceMs: 400, lastOutputMs: null }]);
    const before = h.appended().length;
    h.clock.advance(1_000);
    expect(h.appended()).toHaveLength(before);
    h.session.appendAudio(chunk());
    expect(h.appended().slice(before).map((p) => isSilent(p))).toEqual([false]);

    h.session.endTurn();
    h.session.appendAudio(chunk());
    expect(h.frames('turn.tail_end')[1]).toEqual({ reason: 'audio', silenceMs: 0, lastOutputMs: null });
  });

  it('under automatic turns the turn keys send nothing', async () => {
    const h = await liveTranslate();
    h.session.beginTurn();
    h.session.endTurn();
    h.session.cancelTurn();
    h.clock.advance(5_000);
    expect(h.sent().map((m) => m.type)).toEqual(['session.update']);
    expect(h.frames('turn.tail')).toEqual([]);
  });
});

describe('the OpenAI Translate adapter: what comes down', () => {
  it('makes each side a segment with no origin, timing or language, and frames every delta with its elapsed_ms (ruling 6)', async () => {
    const h = await liveTranslate();
    h.socket().receive(SERVER.input('こんにちは', 200));
    h.socket().receive(SERVER.input('、元気?', 400));
    h.socket().receive(SERVER.output('Hello,', 1_000));
    h.socket().receive(SERVER.output(' how are you?', null));
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source' }, { ref: 2, side: 'translation' }]);
    expect(h.of('segmentText').map((e) => e.payload)).toEqual([
      { ref: 1, text: 'こんにちは' }, { ref: 1, text: 'こんにちは、元気?' }, { ref: 2, text: 'Hello,' }, { ref: 2, text: 'Hello, how are you?' },
    ]);
    expect(h.frames('session.input_transcript.delta')).toEqual([{ delta: 'こんにちは', elapsedMs: 200 }, { delta: '、元気?', elapsedMs: 400 }]);
    expect(h.frames('session.output_transcript.delta')).toEqual([{ delta: 'Hello,', elapsedMs: 1_000 }, { delta: ' how are you?', elapsedMs: null }]);
    h.clock.advance(1_500);
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }, { ref: 2 }]);
  });

  it('plays content audio under the translation, ranged by arrival, framed with its elapsed_ms; a heartbeat is nothing at all (rulings 6; choice 6)', async () => {
    const h = await liveTranslate();
    h.socket().receive(SERVER.output('Hello'));
    h.socket().receive(SERVER.audio({ elapsed: 1_200 }));
    h.socket().receive(SERVER.heartbeat());
    h.socket().receive(SERVER.output(' there.'));
    h.socket().receive(SERVER.audio({ elapsed: 1_400 }));
    expect(h.of('audio').map((e) => [e.payload.ref, e.payload.range, e.payload.pcm.length])).toEqual([[1, [0, 5], 4_800], [1, [5, 12], 4_800]]);
    expect(h.frames('session.output_audio.delta')).toEqual([
      { samples: 4_800, rms: 0.0275, elapsedMs: 1_200, sampleRate: 24_000 },
      { samples: 4_800, rms: 0.0275, elapsedMs: 1_400, sampleRate: 24_000 },
    ]);
    // The heartbeat: no segment, no frame, and it holds no timer open.
    h.clock.advance(1_500);
    expect(h.of('segmentClosed')).toHaveLength(1);
    h.socket().receive(SERVER.heartbeat());
    expect(h.of('segmentOpened')).toHaveLength(1);
    expect(h.timers()).toBe(0);
  });

  it('a leg that does not speak gets the same rows and sends the same configuration, and emits no audio: Text only changes playback alone (ruling 4; choice 5)', async () => {
    const run = async (speech: boolean) => {
      const h = await liveTranslate({ context: { ...AUTO_CTX, speech } });
      h.socket().receive(SERVER.output('Hello'));
      h.socket().receive(SERVER.audio());
      h.clock.advance(1_000);
      h.socket().receive(SERVER.audio());
      h.clock.advance(1_500);
      return h;
    };
    const spoken = await run(true);
    const silent = await run(false);
    expect(silent.sent()).toEqual(spoken.sent());
    const rows = (h: typeof spoken) => h.content().filter((e) => e.kind !== 'audio');
    expect(rows(silent)).toEqual(rows(spoken));
    expect(spoken.of('audio')).toHaveLength(2);
    expect(silent.of('audio')).toEqual([]);
  });

  it('skips audio at a rate it does not play, says so once on a speaking leg, and lets it hold the translation (choice 16)', async () => {
    const h = await liveTranslate();
    h.socket().receive(SERVER.output('Hello'));
    h.socket().receive(SERVER.audio({ rate: 16_000 }));
    h.clock.advance(1_000);
    h.socket().receive(SERVER.audio({ rate: 16_000 }));
    h.clock.advance(1_000);
    expect(h.of('audio')).toEqual([]);
    expect(h.of('segmentClosed')).toEqual([]);
    expect(h.of('degraded').map((e) => [e.payload.code, e.payload.reason])).toEqual([['tts_degraded', 'audio_rate_16000']]);

    const silent = await liveTranslate({ context: { ...AUTO_CTX, speech: false } });
    silent.socket().receive(SERVER.audio({ rate: 16_000 }));
    expect(silent.of('degraded')).toEqual([]);
  });

  it('closes a side at a .done event should one come, and frames what it does not know (choice 18)', async () => {
    const h = await liveTranslate();
    h.socket().receive(SERVER.input('speaking'));
    h.socket().receive(SERVER.output('translating'));
    h.socket().receive(SERVER.bare('session.output_audio.done'));
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 2 }]);
    h.socket().receive(SERVER.bare('session.input_transcript.done'));
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 2 }, { ref: 1 }]);
    h.socket().receive(SERVER.bare('session.output_transcript.done'));
    h.socket().receive(SERVER.bare('rate_limits.updated'));
    expect(h.frames('session.output_audio.done')).toHaveLength(1);
    expect(h.frames('session.input_transcript.done')).toHaveLength(1);
    expect(h.frames('session.unknown')).toEqual([{ type: 'rate_limits.updated' }]);
  });

  it('pairs an exchange by proximity through the projection (F16): no origin stated, inferred', async () => {
    const h = await liveTranslate();
    const conv = new Conversation({ leg: 'speaker', session: 'translate', languages: AUTO_CTX.direction, clock: h.clock });
    let folded = 0;
    /** L1 folds the content as it arrives, so each segment opens at its own time. */
    const fold = () => {
      for (const e of h.log.slice(folded)) if (e.kind !== 'frame') conv.apply(e);
      folded = h.log.length;
    };
    h.socket().receive(SERVER.input('今日はいい天気ですね。'));
    fold();
    h.clock.advance(1_200);
    h.socket().receive(SERVER.output("It's nice weather today."));
    fold();
    const entries = createProjector().project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'off', sentencesPerRow: 0 });
    const exchanges = entries.filter((e) => e.kind === 'exchange');
    expect(exchanges).toHaveLength(1);
    for (const ex of exchanges) { if (ex.kind === 'exchange') expect(ex.pairing).toBe('inferred'); }
  });
});

describe('the OpenAI Translate adapter: failures and stop', () => {
  it("frames a mid-session error, degrades nothing and runs on (ruling 3); a close soon after it — the socket's or the server's — is worded as that error, a later one as the lost connection (choice 9)", async () => {
    const keyed = await liveTranslate();
    keyed.socket().receive(SERVER.error({ type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
    expect(keyed.frames('session.error')).toEqual([{ type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key provided.', param: null }]);
    expect(keyed.of('failed')).toEqual([]);
    keyed.socket().receive(SERVER.input('still translating'));
    expect(keyed.of('segmentOpened')).toHaveLength(1);
    keyed.socket().serverClose(1008, '');
    await flush();
    expect(keyed.of('failed').map((e) => e.payload)).toEqual([{ code: 'auth', message: '[OpenAI invalid_api_key] Incorrect API key provided.' }]);

    expect(keyed.of('degraded')).toEqual([]);

    const other = await liveTranslate();
    other.socket().receive(SERVER.error({ code: 'unknown_parameter', message: 'x' }));
    other.socket().serverClose(1006, '');
    await flush();
    expect(other.of('failed').map((e) => e.payload)).toEqual([{ code: 'client', message: '[OpenAI unknown_parameter] x' }]);

    // An error long before an unrelated drop does not word it.
    const stale = await liveTranslate();
    stale.socket().receive(SERVER.error({ code: 'rate_limit_exceeded', message: 'Rate limit reached.' }));
    stale.clock.advance(ERROR_WORDS_MS + 1);
    stale.socket().serverClose(1006, '');
    await flush();
    expect(stale.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to OpenAI closed (1006).' }]);

    // The server's own close right after an error ends the run in that error's words; with none, it is a plain close (ruling 13).
    const quota = await liveTranslate();
    quota.socket().receive(SERVER.error({ code: 'insufficient_quota', message: 'You exceeded your current quota.' }));
    quota.socket().receive(SERVER.closed());
    expect(quota.of('failed').map((e) => e.payload)).toEqual([{ code: 'rate_limit', message: '[OpenAI insufficient_quota] You exceeded your current quota.' }]);
    expect(quota.of('closed')).toEqual([]);
  });

  it('an unexpected close fails with connection_lost, once; a socket error alone is a Logs line (ruling 13)', async () => {
    const h = await liveTranslate();
    h.socket().onerror?.call(h.socket(), new Event('error'));
    expect(h.frames('session.socket_error')).toHaveLength(1);
    expect(h.of('failed')).toEqual([]);
    h.socket().serverClose(1011, 'Internal error');
    await flush();
    expect(h.frames('session.connection_lost')).toEqual([{ code: 1011, reason: 'Internal error' }]);
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to OpenAI closed (1011 Internal error).' }]);
    expect(h.timers()).toBe(0);
  });

  it("closes on the server's session.closed — an expiry, perhaps — and says nothing after it (ruling 13)", async () => {
    const h = await liveTranslate({ context: MANUAL });
    h.socket().receive(SERVER.input('speaking'));
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.socket().receive(SERVER.closed());
    const n = h.log.length;
    expect(h.of('closed').map((e) => e.payload)).toEqual([{ reason: 'session.closed' }]);
    expect(h.frames('session.closed')).toHaveLength(1);
    expect(h.socket().closedByClient).not.toBeNull();
    await flush();
    h.clock.advance(10_000);
    expect(h.timers()).toBe(0);
    expect(h.log.length).toBe(n);
  });

  it('a frame that will not read is said once per episode, in the Logs and as parse_error; an audio delta that will not decode is its own episode', async () => {
    const h = await liveTranslate();
    h.socket().receive('not a frame');
    h.socket().receive('{"no":"type"}');
    h.socket().receive(SERVER.input('Hi'));
    h.socket().receive('again');
    h.socket().receive(JSON.stringify({ type: 'session.output_audio.delta', delta: '!!not base64!!' }));
    h.socket().receive(JSON.stringify({ type: 'session.output_audio.delta', delta: '%%' }));
    expect(h.frames('session.unreadable')).toEqual([{ message: expect.any(String) }, { message: expect.any(String) }, { message: expect.any(String) }]);
    expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['parse_error', 'parse_error', 'parse_error']);
    expect(h.of('segmentOpened')).toHaveLength(1);
  });

  it('never frames, fails or degrades with the key or the subprotocol that carries it', async () => {
    const h = await liveTranslate({ context: MANUAL });
    h.socket().receive(SERVER.input('a'));
    h.socket().receive(SERVER.output('b'));
    h.socket().receive(SERVER.audio());
    h.socket().receive(SERVER.audio({ rate: 8_000 }));
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.clock.advance(1_400);
    h.socket().receive('not a frame');
    h.socket().receive(SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
    h.socket().onerror?.call(h.socket(), new Event('error'));
    h.socket().serverClose(1008, '');
    await flush();
    const types = new Set(h.of('frame').map((f) => f.payload.type));
    for (const type of ['session.opened', 'session.created', 'session.update', 'session.updated', 'session.input_transcript.delta', 'session.output_transcript.delta',
      'session.output_audio.delta', 'turn.tail', 'turn.tail_end', 'session.unreadable', 'session.error', 'session.socket_error', 'session.connection_lost']) {
      expect(types).toContain(type);
    }
    expect(h.of('failed')).toHaveLength(1);
    // The whole log but its pcm: frames, failures and degradations alike.
    const everything = JSON.stringify(h.log.filter((e) => e.kind !== 'audio'));
    for (const secret of SECRETS) expect(everything).not.toContain(secret);
  });

  it('stop closes the socket before it returns, cancels every timer — the tail and both sides — and nothing follows', async () => {
    const h = await liveTranslate({ context: MANUAL });
    h.socket().receive(SERVER.input('speaking'));
    h.socket().receive(SERVER.output('translating'));
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(h.timers()).toBe(3);
    const n = h.log.length;
    const sentBefore = h.sent().length;
    const stopping = h.session.stop();
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    await stopping;
    expect(h.timers()).toBe(0);
    h.clock.advance(10_000);
    await flush();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(h.log.length).toBe(n);
    expect(h.sent()).toHaveLength(sentBefore);
  });

  it("leaves no listener behind: the signal's once the start settles, the socket's once the session ends", async () => {
    const h = startTranslate();
    const removed = vi.spyOn(h.controller.signal, 'removeEventListener');
    h.socket().open('realtime');
    h.socket().receive(SERVER.created());
    h.socket().receive(SERVER.updated());
    const session = await h.starting;
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    const socket = h.socket();
    await session.stop();
    expect([socket.onopen, socket.onmessage, socket.onerror, socket.onclose]).toEqual([null, null, null, null]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/providers/openai_translate src/providers/sessionSide.consistency.test.ts` — FAIL: `adapter.test.ts` stops at collection with `TypeError: createTranslateAdapter is not a function` (the seed exports none), and the walk from the seed finds `adapter.ts` alone. Task 4's suites still pass: they import `testing.ts` but never start a leg.
- [ ] **Step 3: Implement.** `adapter.ts`, in full, replacing the seed:

```ts
/**
 * OpenAI Translate on the new contract (spec: "L0 — the client contract"),
 * ported from `OpenAITranslateGAClient` (`src/services/clients/`, still
 * compiled until the deletion plan after the WebRTC step) without its items,
 * ids, karaoke bookkeeping or segmentation stage: one leg, one WebSocket to
 * the translations endpoint, the key in a subprotocol (choice 3). The start
 * resolves on `session.updated`, the configuration confirmed, so a refused
 * one rejects in words within a bound (choices 1, 2). Deltas become segments
 * (`segments.ts`); a push-to-talk release sends a real-time silence tail
 * (`tail.ts`, ruling 2). Every timer reads the request's clock, and nothing
 * is said but through events (CLAUDE.md, "Inside an IClient session").
 */
import type {
  RealtimeError,
  RealtimeErrorEvent,
  RealtimeTranslationInputTranscriptDeltaEvent,
  RealtimeTranslationOutputAudioDeltaEvent,
  RealtimeTranslationOutputTranscriptDeltaEvent,
  RealtimeTranslationSessionCreatedEvent,
  RealtimeTranslationSessionUpdatedEvent,
} from 'openai/resources/realtime/realtime';
import {
  AdapterStartError,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type StartRequest,
} from '../../lib/contract/adapter';
import { framePayload } from '../../lib/contract/framePayload';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { TranslateConfig } from './config';
import { TranslateSegments } from './segments';
import type { TranslateCredentials } from './settings';
import { nativeSocket, WS_OPEN, type OpenSocket } from './socket';
import { ReleaseTail, type TailSummary } from './tail';
import {
  appendFrame,
  base64ToPcm,
  computeRms,
  decodeServerEvent,
  elapsedMsOf,
  errorCode,
  errorWords,
  isSilentFrame,
  OUTPUT_RATE,
  sessionUpdate,
  translateProtocols,
  translateUrl,
  type ServerEvent,
} from './wire';

/** The old client's bound on the start (`OpenAITranslateGAClient.ts:771`), now on the request's clock, and closing the socket (choice 2). */
export const START_TIMEOUT_MS = 30_000;
/** A socket that failed before it opened: a browser cannot read why (choice 2). */
export const NEVER_OPENED = "OpenAI's socket did not open (check the network, and that the API key is still valid).";
/**
 * How long a mid-session `error` words the close that follows it (ruling 3;
 * choice 9): a close later than this is the connection's own, not the
 * error's. A starting value the live test's `session.error` frames settle.
 */
export const ERROR_WORDS_MS = 10_000;

export interface TranslateAdapterDeps {
  /** `new WebSocket(url, protocols)` in the app; a `FakeSocket` factory in tests. */
  openSocket: OpenSocket;
}

type Side = 'source' | 'translation';

const closeWords = (e: CloseEvent) => `${e.code}${e.reason ? ` ${e.reason}` : ''}`;

/** A thrown value's name alone (`SyntaxError`, `SecurityError`), never its message: a browser that refuses a subprotocol quotes it, the key in it. */
function errorName(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name !== '' ? name : 'unknown error';
}

class TranslateLeg implements AdapterSession {
  readonly info: { transport: string };
  readonly opening: Promise<AdapterSession>;
  /** `opening` until the server's session exists; `configuring` once `session.update` went out; `live` once the server confirmed it. */
  private phase: 'opening' | 'configuring' | 'live' | 'ended' = 'opening';
  private opened = false;
  private readonly socket: WebSocket;
  private readonly segments: TranslateSegments;
  private readonly tail: ReleaseTail;
  /** Samples sent this session: the server frames them on a 200 ms grid (the tail's pad). */
  private sent = 0;
  /** The last frame parsed: `session.unreadable` on the ok → failing transition only (choice 17). */
  private readable = true;
  /** The last output audio decoded: its own episode, since every frame that parses re-arms `readable` (Gemini's `partsReadable`). */
  private audioReadable = true;
  /** A foreign output rate is said once per session (choice 16). */
  private rateWarned = false;
  /** The last `error` event mid-session, and when: the words of a close that follows it closely (ruling 3; choice 9). */
  private lastError: { code: string; message: string; at: number } | null = null;
  private settle: { resolve(): void; reject(error: unknown): void } | null = null;

  constructor(
    private readonly request: StartRequest<TranslateConfig, TranslateCredentials>,
    private readonly events: AdapterEvents,
    openSocket: OpenSocket,
  ) {
    const { config, clock, signal } = request;
    // The WebRTC step's attachment point (choice 15): today every config says `websocket`.
    this.info = { transport: config.transport };
    this.segments = new TranslateSegments({ clock, silence: config.silence, sink: events });
    this.tail = new ReleaseTail({ clock, send: (pcm) => this.send(pcm), ended: (summary) => this.tailEnded(summary) });
    this.socket = openSocket(translateUrl(config), translateProtocols(request.credentials));
    this.socket.binaryType = 'arraybuffer';
    this.opening = new Promise<AdapterSession>((resolve, reject) => {
      const cancelTimer = clock.setTimeout(() => this.refuse(this.opened
        ? new AdapterStartError(`OpenAI did not start the session within ${START_TIMEOUT_MS / 1000} s.`, 'server')
        : new AdapterStartError(`OpenAI did not open the connection within ${START_TIMEOUT_MS / 1000} s.`, 'network')), START_TIMEOUT_MS);
      const onAbort = () => this.refuse(signal.reason ?? new Error('aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      const done = () => { cancelTimer(); signal.removeEventListener('abort', onAbort); };
      this.settle = {
        resolve: () => { done(); resolve(this); },
        reject: (error) => { done(); reject(error); },
      };
    });
    this.socket.onopen = () => this.onOpen();
    this.socket.onmessage = (e: MessageEvent) => this.onMessage(e.data);
    // A Logs line: the close that follows says what it did to the session.
    this.socket.onerror = () => this.frame('in', 'session.socket_error');
    this.socket.onclose = (e: CloseEvent) => this.onClose(e);
  }

  /** One chunk as it came — no pacing, no resampling (parity) — and no frame per chunk (the hot-path rule). Real audio ends a release's tail first. */
  appendAudio(pcm: Int16Array): void {
    if (this.phase !== 'live') return;
    this.tail.stop('audio');
    this.send(pcm);
  }

  /** OpenAI Translate takes no typed text (`textInput: false`). */
  appendText(): void {}

  /** A press: a release's tail still running ends at once (ruling 2). Nothing is sent: the endpoint has no turns. */
  beginTurn(): void {
    if (this.phase === 'live') this.tail.stop('press');
  }

  /** A release with speech: the tail (ruling 2). */
  endTurn(): void {
    this.release(false);
  }

  /** A release without speech: the same tail — what the press appended is already the model's input, and no clear exists (choice 7). */
  cancelTurn(): void {
    this.release(true);
  }

  /** The close before its first `await`. No `session.close`: its flush would land on a socket already closed (parity — a tail at Stop is dropped). */
  stop(): Promise<void> {
    this.shutDown();
    return Promise.resolve();
  }

  private onOpen(): void {
    if (this.phase !== 'opening') return;
    this.opened = true;
    const { config, context } = this.request;
    // Never the protocols: the second carries the key.
    this.frame('out', 'session.opened', {
      model: config.model, target: config.target, transcriptModel: config.transcriptModel, noiseReduction: config.noiseReduction,
      speaking: context.speech, manual: context.turns === 'manual',
    });
  }

  private onMessage(data: unknown): void {
    if (this.phase === 'ended') return;
    let e: ServerEvent;
    try {
      e = decodeServerEvent(data);
    } catch (error) {
      this.unreadable('frame', error);
      return;
    }
    this.readable = true;
    // Each read through its SDK type: a field the SDK renames fails the typecheck.
    switch (e.type) {
      case 'session.created':
        this.created(e as unknown as RealtimeTranslationSessionCreatedEvent);
        return;
      case 'session.updated':
        this.updated(e as unknown as RealtimeTranslationSessionUpdatedEvent);
        return;
      case 'error':
        this.serverError((e as unknown as Partial<RealtimeErrorEvent>).error ?? {});
        return;
      case 'session.closed':
        this.serverClosed();
        return;
      case 'session.input_transcript.delta':
        this.inputDelta(e as unknown as RealtimeTranslationInputTranscriptDeltaEvent);
        return;
      case 'session.output_transcript.delta':
        this.outputDelta(e as unknown as RealtimeTranslationOutputTranscriptDeltaEvent);
        return;
      case 'session.output_audio.delta':
        this.audioDelta(e as unknown as RealtimeTranslationOutputAudioDeltaEvent);
        return;
      // Not in the SDK's union: the old client closed its items on them (choice 18).
      case 'session.input_transcript.done':
        this.done('source', e.type);
        return;
      case 'session.output_transcript.done':
      case 'session.output_audio.done':
        this.done('translation', e.type);
        return;
      default:
        this.frame('in', 'session.unknown', { type: e.type });
    }
  }

  /** The server's session: framed with its defaults and its expiry (survey §2.14 item 3), then the configuration goes up. */
  private created(e: RealtimeTranslationSessionCreatedEvent): void {
    const s = e.session;
    this.frame('in', 'session.created', { id: s?.id ?? null, model: s?.model ?? null, expiresAt: s?.expires_at ?? null, audio: s?.audio ?? null });
    if (this.phase !== 'opening') return;
    const update = sessionUpdate(this.request.config);
    this.socket.send(JSON.stringify(update));
    this.frame('out', 'session.update', update.session);
    this.phase = 'configuring';
  }

  /** The configuration confirmed: the start resolves (choice 1). */
  private updated(e: RealtimeTranslationSessionUpdatedEvent): void {
    this.frame('in', 'session.updated', { audio: e.session?.audio ?? null });
    if (this.phase !== 'configuring') return;
    this.phase = 'live';
    const settle = this.settle;
    this.settle = null;
    settle?.resolve();
  }

  /** Before the start, a refusal in OpenAI's words; mid-session a Logs line, kept for the close that may follow (ruling 3). */
  private serverError(error: Partial<RealtimeError>): void {
    this.frame('in', 'session.error', { type: error.type ?? null, code: error.code ?? null, message: error.message ?? null, param: error.param ?? null });
    const refusal = { code: errorCode(error), message: errorWords(error) };
    if (this.phase === 'live') this.lastError = { ...refusal, at: this.request.clock.now() };
    else this.refuse(new AdapterStartError(refusal.message, refusal.code));
  }

  /** The server ended the session: in a recent error's words, else as a close — its expiry, perhaps (ruling 13); the socket's close after it unheard. */
  private serverClosed(): void {
    this.frame('in', 'session.closed');
    if (this.phase === 'live') {
      // The server's close right after an error is that error's (ruling 3); otherwise an expiry, perhaps (ruling 13).
      const cause = this.recentError();
      this.end(cause ? { failed: cause } : { reason: 'session.closed' });
    }
    else this.refuse(new AdapterStartError('OpenAI closed the session before it started.', 'server'));
  }

  private inputDelta(e: RealtimeTranslationInputTranscriptDeltaEvent): void {
    if (this.phase !== 'live') return;
    // Every delta framed with its elapsed_ms (ruling 6): the live test reads the timeline from these.
    this.frame('in', e.type, { delta: e.delta, elapsedMs: elapsedMsOf(e) });
    if (typeof e.delta === 'string') this.segments.input(e.delta);
  }

  private outputDelta(e: RealtimeTranslationOutputTranscriptDeltaEvent): void {
    if (this.phase !== 'live') return;
    this.frame('in', e.type, { delta: e.delta, elapsedMs: elapsedMsOf(e) });
    if (typeof e.delta !== 'string' || !e.delta) return;
    this.segments.output(e.delta);
    this.tail.output();
  }

  private audioDelta(e: RealtimeTranslationOutputAudioDeltaEvent): void {
    if (this.phase !== 'live' || typeof e.delta !== 'string') return;
    let pcm: Int16Array;
    try {
      pcm = base64ToPcm(e.delta);
    } catch (error) {
      this.unreadable('audio', error);
      return;
    }
    this.audioReadable = true;
    // A heartbeat: no segment, no timer, no frame (parity, `OpenAITranslateGAClient.ts:542-556`).
    if (isSilentFrame(pcm)) return;
    const rate = typeof e.sample_rate === 'number' ? e.sample_rate : OUTPUT_RATE;
    this.frame('in', e.type, { samples: pcm.length, rms: Math.round(computeRms(pcm) * 10_000) / 10_000, elapsedMs: elapsedMsOf(e), sampleRate: rate });
    if (rate !== OUTPUT_RATE) this.foreignRate(rate);
    // Played only on a leg that speaks, at the contract's rate; it holds the translation either way (choices 5, 16).
    this.segments.audio(pcm, this.request.context.speech && rate === OUTPUT_RATE);
    this.tail.output();
  }

  private done(side: Side, type: string): void {
    if (this.phase !== 'live') return;
    this.frame('in', type);
    this.segments.done(side);
  }

  /** Audio at a rate this app does not play is skipped; a speaking leg says so once (choice 16). */
  private foreignRate(rate: number): void {
    if (this.rateWarned || !this.request.context.speech) return;
    this.rateWarned = true;
    this.events.degraded({
      code: 'tts_degraded',
      message: `OpenAI sent its speech at ${rate} Hz, which this app does not play: it is skipped.`,
      reason: `audio_rate_${rate}`,
    });
  }

  /** A frame, or an audio delta, that will not read: a Logs line and `parse_error` on each latch's ok → failing transition only (choice 17). */
  private unreadable(latch: 'frame' | 'audio', error: unknown): void {
    if (latch === 'frame' ? !this.readable : !this.audioReadable) return;
    if (latch === 'frame') this.readable = false;
    else this.audioReadable = false;
    this.frame('in', 'session.unreadable', { message: describeCause(error) });
    if (this.phase === 'live') this.events.degraded({ code: 'parse_error', message: `A message from OpenAI could not be read: ${describeCause(error)}`, cause: error });
  }

  /** The last mid-session error, when the close follows it within `ERROR_WORDS_MS` (ruling 3). */
  private recentError(): { code: string; message: string } | null {
    const last = this.lastError;
    if (!last || this.request.clock.now() - last.at > ERROR_WORDS_MS) return null;
    return { code: last.code, message: last.message };
  }

  private release(cancelled: boolean): void {
    if (this.phase !== 'live' || this.request.context.turns !== 'manual') return;
    const padSamples = this.tail.start(this.sent, cancelled);
    this.frame('out', 'turn.tail', { padSamples, ...(cancelled ? { cancelled: true } : {}) });
  }

  private tailEnded(summary: TailSummary): void {
    this.frame('out', 'turn.tail_end', summary);
  }

  private send(pcm: Int16Array): void {
    if (this.socket.readyState !== WS_OPEN) return;
    this.socket.send(appendFrame(pcm));
    this.sent += pcm.length;
  }

  private onClose(e: CloseEvent): void {
    if (this.phase === 'ended') return;
    this.frame('in', 'session.connection_lost', { code: e.code, reason: e.reason });
    if (this.phase !== 'live') {
      this.refuse(this.opened
        ? new AdapterStartError(`OpenAI closed the connection before the session started (${closeWords(e)}).`, 'server')
        : new AdapterStartError(NEVER_OPENED, 'network'));
      return;
    }
    // A close right after a mid-session error reads as that error — a key revoked, a quota spent (ruling 3; choice 9); any other as the lost connection (ruling 13).
    this.end({ failed: this.recentError() ?? { code: 'connection_lost', message: `The connection to OpenAI closed (${closeWords(e)}).` } });
  }

  /** A start that will not resolve: rejected once, the socket closed, nothing emitted but frames. */
  private refuse(error: unknown): void {
    if (this.phase === 'live' || this.phase === 'ended') return;
    this.shutDown();
    const settle = this.settle;
    this.settle = null;
    settle?.reject(error);
  }

  /** A session that ends by itself: said once, then nothing (the kit's `ended-silence`). */
  private end(how: { failed: { code: string; message: string } } | { reason: string }): void {
    if (this.phase !== 'live') return;
    this.shutDown();
    if ('failed' in how) this.events.failed(how.failed);
    else this.events.closed({ reason: how.reason });
  }

  /** Every way a leg ends: no timer left, the tail silent, the socket closed and no longer heard. */
  private shutDown(): void {
    this.phase = 'ended';
    this.tail.cancel();
    this.segments.stop();
    const socket = this.socket;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState <= WS_OPEN) socket.close(1000);
  }

  private frame(direction: 'in' | 'out', type: string, payload?: unknown): void {
    if (this.phase === 'ended') return;
    this.events.frame(payload === undefined ? { direction, type } : { direction, type, payload: framePayload(payload) });
  }
}

export function createTranslateAdapter(deps: Partial<TranslateAdapterDeps> = {}): Adapter<TranslateConfig, TranslateCredentials> {
  const openSocket = deps.openSocket ?? nativeSocket;
  return {
    start(request, events) {
      // An aborted start opens nothing.
      if (request.signal.aborted) return Promise.reject(request.signal.reason ?? new Error('aborted'));
      try {
        return new TranslateLeg(request, events, openSocket).opening;
      } catch (error) {
        // A start rejects, never throws. In fixed words and with no cause: a browser that refuses the socket quotes the subprotocols, the key among them.
        return Promise.reject(new AdapterStartError(`The browser would not open the socket (${errorName(error)}).`, 'network'));
      }
    },
  };
}
```

- [ ] **Step 4: Run** the Step 2 command — PASS (10 files, 118 tests in the scratch copy); then the full suite and the gate. What the change reaches, and why each stays green:
  - the session-side guard walks Translate's folder: `adapter.ts` reaches `segments.ts`, `socket.ts`, `tail.ts` and `wire.ts` by value, and `config.ts` and `settings.ts` as types only; none imports a store or the reporter, and every timer is `clock.setTimeout` or `every(clock, …)`;
  - the kit rule: `testing.ts` now imports the adapter, and only tests import `testing.ts`;
  - the seven conformance scenarios run over the harness; `text` and `reconnect` are not offered (`answerText` and `reconnect` absent);
  - nothing registers the provider yet (Task 10), so no app path reaches the adapter.
- [ ] **Step 5: Commit.**

```bash
git add src/providers/openai_translate/adapter.ts src/providers/openai_translate/adapter.test.ts src/providers/openai_translate/testing.ts src/providers/sessionSide.consistency.test.ts
```

```bash
git commit -q -F - -- src/providers/openai_translate/adapter.ts src/providers/openai_translate/adapter.test.ts src/providers/openai_translate/testing.ts src/providers/sessionSide.consistency.test.ts <<'EOF'
feat(openai_translate): the adapter on the new contract

One WebSocket per leg, the key in a subprotocol. The start resolves once
session.updated confirms the configuration and rejects in words within
30 s; a refused socket rejects in fixed words. Deltas become segments
framed with elapsed_ms; heartbeats are nothing; a leg that does not speak
drops the audio. A push-to-talk release sends the real-time tail; a
mid-session error is a Logs line whose words a close soon after it
reads as; a drop or the server's close ends the run in words.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Group check A (controller)

After Wave 3 (Tasks 1–9). The words, the redaction, the noise field, Translate's settings, check, view and adapter are in; Translate is not registered.

1. The full gates: `npx vitest run src` (0 failed, no unhandled errors; the scratch copy: 537 files passed and 1 skipped, 6 846 tests passed and 2 skipped) and the typecheck gate (the 20 baseline lines).
2. The old suites by name: `npx vitest run src/services src/components/Settings` — green: the old Translate client, its WebRTC sibling and the descriptor are untouched.
3. Both release builds; `npx vitest run extension`; the three D24 greps print nothing; `command grep -rlF 'turn.tail_end' build extension/dist` prints nothing — nothing reaches the adapter yet.
4. The full tree's typecheck — `npx tsc --noEmit -p tsconfig.json` written to `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oat-groupA-tsc.txt`, counted with `command grep -c 'error TS'` — is at most 259.
5. Every probe green on a fresh vite: the spine probes (subtitle, surface, export, audio, gate, local) and `app-panel-probe` (preview; `--settings`). Nothing in them reaches Translate; the redaction and the aliases run on every provider's path.

---

## Wave 4

### Task 10: The definition, registered fifth (rulings 1, 4, 5, 11, 12, 15)

**Files:**
- Create: `src/providers/openai_translate/provider.ts`
- Modify: `src/providers/registry.ts`, `src/providers/registry.test.ts`, `src/components/SetupWizard/providerPaths.test.ts`, `src/providers/volcengine_ast2/provider.test.ts`
- Test: `src/providers/openai_translate/provider.test.ts`

**Interfaces:**
- Consumes: every earlier task's product; `OpenAIIcon` (`src/components/Icons/ProviderIcons.tsx:14`); the AST2 plan's registry (`RELEASED` with `volcengineAst2Provider`).
- Produces: `openaiTranslateProvider: Provider<TranslateSettings, TranslateCredentials, TranslateConfig> & { id: 'openai_translate' }`; `RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, openaiTranslateProvider, sonioxProvider]`; `ProviderId` gains `'openai_translate'`.
- Consumed by: group check B; the owner's live test.

The old enum's id and slice (`openai_translate`, `openaiTranslate` — `LEGACY_SLICE_KEYS` already maps them, `src/lib/session/storedSettings.ts:68`), so a stored selection, the key, the pair and the noise reduction carry over. `platforms` includes `web` (the subprotocol works everywhere, ruling 16); no `flagged` (ruling 11), no `i18nKey` (the catalogs spell `providers.openai_translate.*`), no `session` hooks, no `TurnDetection` (no knobs), no `participantSpeech` (ruling 5). `speech: 'optional'` (ruling 4), `textInput: false`, `boundaries: 'silence'`, `turns: ['auto', 'manual']`; `guideUrl` is today's `TUTORIAL_URLS` value for OpenAI (`src/services/providers/tutorialUrls.ts:15`) as a literal (ruling 12). `check` wraps `checkTranslate` in an arrow, as Doubao's does.

- [ ] **Step 1: Write the failing tests.** `provider.test.ts`, in full:

```ts
import { afterEach, describe, it, expect, vi } from 'vitest';

const { stored, getSetting, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    getSetting: vi.fn(async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
  };
});
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting, setSetting }) },
}));

import { OpenAIIcon } from '../../components/Icons/ProviderIcons';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { readCredentials } from '../../lib/provider/credentials';
import { contextsFor, gate } from '../../lib/session/shape';
import type { RunShape } from '../../lib/session/types';
import { useProviderStore } from '../../stores/providerStore';
import { PROVIDERS } from '../registry';
import { buildTranslate, describeTranslate, type TranslateConfig } from './config';
import { openaiTranslateProvider } from './provider';
import { migrateTranslateSettings, TRANSLATE_DEFAULTS, translateCredentials, translateLanguages, type TranslateSettings } from './settings';
import { AUTO_CTX, configFor, KEY, SHARED } from './testing';
import { TranslateSettingsView } from './TranslateSettings';

afterEach(() => {
  vi.unstubAllGlobals();
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false, legs: ['speaker'], speech: { textOnly: false, participantSpeech: false } });
});

const both = (pair: { source: string; target: string }, patch: Partial<RunShape> = {}) =>
  ({ provider: openaiTranslateProvider, settings: TRANSLATE_DEFAULTS, pair, legs: ['speaker', 'participant'], textOnly: false, participantSpeech: false, turnMode: 'auto', ...patch }) as unknown as RunShape;

describe('the OpenAI Translate definition', () => {
  it('is OpenAI Translate with your own key, on every platform, under its old id and slice, linking the OpenAI setup guide (ruling 12)', () => {
    expect(openaiTranslateProvider).toMatchObject({
      id: 'openai_translate',
      kind: 'own-key',
      platforms: ['electron', 'extension', 'web'],
      icon: OpenAIIcon,
      guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',
      settings: { key: 'openaiTranslate', defaults: TRANSLATE_DEFAULTS, migrate: migrateTranslateSettings },
      Settings: TranslateSettingsView,
      credentials: translateCredentials,
      languages: translateLanguages,
      build: buildTranslate,
      describe: describeTranslate,
    });
    for (const absent of ['flagged', 'i18nKey', 'TurnDetection', 'session', 'participantSpeech'] as const) {
      expect(openaiTranslateProvider, absent).not.toHaveProperty(absent);
    }
  });

  it('offers Text only, takes no typed text, ends segments on our own timers, and offers both turn modes (ruling 4)', () => {
    expect(openaiTranslateProvider.speech).toBe('optional');
    expect(openaiTranslateProvider.textInput).toBe(false);
    expect(openaiTranslateProvider.boundaries(TRANSLATE_DEFAULTS)).toBe('silence');
    expect(openaiTranslateProvider.turns(TRANSLATE_DEFAULTS)).toEqual(['auto', 'manual']);
  });

  it('sits after Doubao AST 2.0 and before Soniox (ruling 11)', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids.indexOf('openai_translate')).toBe(ids.indexOf('volcengine_ast2') + 1);
    expect(ids.indexOf('openai_translate')).toBe(ids.indexOf('soniox') - 1);
  });

  it("lets the participant speak when its switch is on, into the pair's source (ruling 5), and a speaker on Text only not speak (ruling 4)", () => {
    const participant = contextsFor(both({ source: 'ja', target: 'en' }, { participantSpeech: true })).participant!;
    expect(participant).toEqual({ direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' });
    expect((openaiTranslateProvider.build(participant, TRANSLATE_DEFAULTS, SHARED) as TranslateConfig).target).toBe('ja');
    expect(contextsFor(both({ source: 'ja', target: 'en' })).participant!.speech).toBe(false);
    expect(contextsFor(both({ source: 'ja', target: 'en' }, { textOnly: true })).speaker!.speech).toBe(false);
  });

  it('refuses Both before anything opens when the speaker\'s source is one it only hears (D20), and allows it for one it speaks', () => {
    expect(gate(both({ source: 'th', target: 'en' }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
    expect(gate(both({ source: 'ja', target: 'en' }), 'electron')).toBeNull();
    expect(gate({ ...both({ source: 'th', target: 'en' }), legs: ['speaker'] }, 'electron')).toBeNull();
  });

  it('a start whose signal already aborted opens no socket', async () => {
    const opened = vi.fn();
    vi.stubGlobal('WebSocket', opened);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(openaiTranslateProvider.start(
      { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    )).rejects.toBe(reason);
    expect(opened).not.toHaveBeenCalled();
  });

  it('loads an old profile as it was: the key, the pair, the noise reduction, a WebRTC choice kept and run over WebSocket, the transcript model unread, nothing written (rulings 1, 8)', async () => {
    stored.set('settings.openaiTranslate.apiKey', 'sk-proj-oldProfileKey0123');
    stored.set('settings.openaiTranslate.sourceLanguage', 'ko');
    stored.set('settings.openaiTranslate.targetLanguage', 'ja');
    stored.set('settings.openaiTranslate.noiseReduction', 'Far field');
    stored.set('settings.openaiTranslate.transportType', 'webrtc');
    stored.set('settings.openaiTranslate.transcriptModel', 'gpt-realtime-whisper');
    await useProviderStore.getState().load(openaiTranslateProvider);
    const entry = useProviderStore.getState().entries.openai_translate;
    expect(entry.settings as TranslateSettings).toEqual({ noiseReduction: 'Far field', transportType: 'webrtc' });
    expect(readCredentials(openaiTranslateProvider, entry.settings, entry.credentials, { signedIn: false, getToken: async () => null })).toEqual({ apiKey: 'sk-proj-oldProfileKey0123' });
    expect(entry.pair).toEqual({ source: 'ko', target: 'ja' });
    const config = openaiTranslateProvider.build({ direction: entry.pair, speech: true, turns: 'auto' }, entry.settings as TranslateSettings, SHARED) as TranslateConfig;
    expect(config).toMatchObject({ transport: 'websocket', noiseReduction: 'far_field', transcriptModel: 'gpt-live-transcribe', target: 'ja' });
    expect(setSetting).not.toHaveBeenCalled();
  });
});
```

  `registry.test.ts`, "the release offers its providers in the owner's order":

```diff
--- a/src/providers/registry.test.ts
+++ b/src/providers/registry.test.ts
@@ -289,8 +289,8 @@
     const releaseBuild = await import('./registry');
     // each provider plan adds its id where the owner orders it (spec: "one line in the order test").
     // Kizuna Soniox first, unflagged (Stage 2 Kizuna Soniox, ruling 6): the owner's 2026-09-12
-    // product order put the managed provider first; then LocalInference, Gemini (Stage 2 Gemini, ruling 6), Doubao AST 2.0 (Stage 2 Volcengine AST2, ruling 5), then Soniox with your own key.
-    expect(releaseBuild.PROVIDERS.map((p) => p.id)).toEqual(['kizunaai_soniox', 'localInference', 'gemini', 'volcengine_ast2', 'soniox']);
+    // product order put the managed provider first; then LocalInference, Gemini (Stage 2 Gemini, ruling 6), Doubao AST 2.0 (Stage 2 Volcengine AST2, ruling 5), OpenAI Translate (Stage 2 OpenAI Translate, ruling 11), then Soniox with your own key.
+    expect(releaseBuild.PROVIDERS.map((p) => p.id)).toEqual(['kizunaai_soniox', 'localInference', 'gemini', 'volcengine_ast2', 'openai_translate', 'soniox']);
   });
 
   it('a development build adds exactly the two fakes', () => {
```

  `providerPaths.test.ts`, the own-key list in its new order, and the subtitles-only scenario's fit (ruling 4's departure):

```diff
--- a/src/components/SetupWizard/providerPaths.test.ts
+++ b/src/components/SetupWizard/providerPaths.test.ts
@@ -25,7 +25,7 @@
   });
 
   it("lists the registered own-key providers in registry order, in the old enum's spelling", () => {
-    expect(ownKeyOptions('understand-others').map((o) => o.id)).toEqual(['gemini', 'volcengine_ast2', 'soniox', 'fake']);
+    expect(ownKeyOptions('understand-others').map((o) => o.id)).toEqual(['gemini', 'volcengine_ast2', 'openai_translate', 'soniox', 'fake']);
   });
 
   it("judges a provider's fit from its speech", () => {
@@ -35,6 +35,8 @@
 
     const text = Object.fromEntries(ownKeyOptions('subtitle-myself').map((o) => [o.id, o.fit]));
     expect(text[Provider.SONIOX]).toEqual({ ok: true });
+    // OpenAI Translate offers Text only now (Stage 2 OpenAI Translate, ruling 4): the subtitles-only scenario no longer greys it.
+    expect(text[Provider.OPENAI_TRANSLATE]).toEqual({ ok: true });
   });
 
   it("judges the managed card's fit from the definition's speech", () => {
```

  `volcengine_ast2/provider.test.ts`, Doubao's order case — OpenAI Translate now sits between Doubao and Soniox, so the case pins what is still Doubao's:

```diff
--- a/src/providers/volcengine_ast2/provider.test.ts
+++ b/src/providers/volcengine_ast2/provider.test.ts
@@ -64,10 +64,9 @@
     expect(volcengineAst2Provider.turns(AST2_DEFAULTS)).toEqual(['auto', 'manual']);
   });
 
-  it('sits after Gemini and before Soniox (ruling 5)', () => {
+  it('sits after Gemini (ruling 5)', () => {
     const ids = PROVIDERS.map((p) => p.id);
     expect(ids.indexOf('volcengine_ast2')).toBe(ids.indexOf('gemini') + 1);
-    expect(ids.indexOf('volcengine_ast2')).toBe(ids.indexOf('soniox') - 1);
   });
 
   it('lets the participant speak when its switch is on, speech to speech on the reversed pair (ruling 4)', () => {
```

- [ ] **Step 2: Run** `npx vitest run src/providers/openai_translate/provider.test.ts src/providers/registry.test.ts src/components/SetupWizard/providerPaths.test.ts src/providers/volcengine_ast2/provider.test.ts` — FAIL: no `./provider`; the registry lists five released providers; the wizard lists no `openai_translate`, and its subtitles-only fit for it reads `undefined`. Doubao's narrowed case passes either way.
- [ ] **Step 3: Implement.** `provider.ts`, in full:

```ts
import { OpenAIIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { createTranslateAdapter } from './adapter';
import { checkTranslate } from './check';
import { buildTranslate, describeTranslate, type TranslateConfig } from './config';
import {
  migrateTranslateSettings,
  TRANSLATE_DEFAULTS,
  translateCredentials,
  translateLanguages,
  type TranslateCredentials,
  type TranslateSettings,
} from './settings';
import { TranslateSettingsView } from './TranslateSettings';

const adapter = createTranslateAdapter();

/**
 * OpenAI Translate with the user's own key (Stage 2 OpenAI Translate):
 * `gpt-realtime-translate`, speech to speech, one WebSocket per leg — the
 * WebRTC transport is a later step (ruling 1). The old enum's id and slice
 * (controller ruling 2 of the foundation), so a stored selection, the key,
 * the pair and the noise reduction carry over. The key rides in a
 * subprotocol a browser sets itself, so it runs on every platform, and the
 * extension's manifest already lists its host and CSP origin: no manifest
 * or background change. Released between Doubao AST 2.0 and Soniox,
 * unflagged (ruling 11).
 */
export const openaiTranslateProvider: Provider<TranslateSettings, TranslateCredentials, TranslateConfig> & { id: 'openai_translate' } = {
  id: 'openai_translate',
  kind: 'own-key',
  platforms: ['electron', 'extension', 'web'],
  icon: OpenAIIcon,
  // The OpenAI setup guide: the same key (ruling 12). Today's TUTORIAL_URLS value for OpenAI, as a literal (no import from src/services).
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',

  settings: { key: 'openaiTranslate', defaults: TRANSLATE_DEFAULTS, migrate: migrateTranslateSettings },
  Settings: TranslateSettingsView,

  credentials: translateCredentials,
  check: (k, s, ctx) => checkTranslate(k, s, ctx),

  languages: translateLanguages,

  // Text only is offered (ruling 4): the API still speaks, and a leg that does not speak drops the audio.
  speech: 'optional',
  // The endpoint takes audio only.
  textInput: false,
  // Our own silence timers end segments (the old offer: pause, no auto, sizes).
  boundaries: () => 'silence',
  turns: () => ['auto', 'manual'],

  build: buildTranslate,
  describe: describeTranslate,
  start: adapter.start,
};
```

  `registry.ts`:

```diff
--- a/src/providers/registry.ts
+++ b/src/providers/registry.ts
@@ -10,12 +10,13 @@
 import { fakeProvider } from './fake/provider';
 import { geminiProvider } from './gemini/provider';
 import { localInferenceProvider } from './localInference/provider';
+import { openaiTranslateProvider } from './openai_translate/provider';
 import { kizunaSonioxProvider } from './soniox/kizuna';
 import { sonioxProvider } from './soniox/provider';
 import { volcengineAst2Provider } from './volcengine_ast2/provider';
 
-/** Shipped providers, in UI order (Stage 2 Kizuna Soniox, ruling 6; Stage 2 Gemini, ruling 6; Stage 2 Volcengine AST2, ruling 5): the managed Kizuna Soniox, the free LocalInference, then Gemini, Doubao AST 2.0 and Soniox with your own key. */
-const RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, sonioxProvider] as const;
+/** Shipped providers, in UI order (Stage 2 Kizuna Soniox, ruling 6; Stage 2 Gemini, ruling 6; Stage 2 Volcengine AST2, ruling 5; Stage 2 OpenAI Translate, ruling 11): the managed Kizuna Soniox, the free LocalInference, then Gemini, Doubao AST 2.0, OpenAI Translate and Soniox with your own key. */
+const RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, openaiTranslateProvider, sonioxProvider] as const;
 /** Compiled into development builds only (D24): the fake, and the leased fake that carries the session hooks (Stage 2 foundation, choice 1). */
 const DEV_ONLY = [fakeProvider, fakeLeasedProvider] as const;
 
```

- [ ] **Step 4: Run** the Step 2 command — PASS (4 files, 51 tests); then the full suite and the gate — the scratch copy's end state: 538 files passed and 1 skipped, 6 853 tests passed and 2 skipped, 0 failed, no unhandled errors; 259 lines in the full tree, the gate's 20. What registration reaches, and why each stays green:
  - the registry invariants (`registry.test.ts`): `openai_translate` is the old enum's spelling and keeps the `openaiTranslate` prefix; `providers.openai_translate.name` / `.description`, `setup.credentials.apiKey` and `simpleSettings.apiKeyPlaceholder` exist in `en`; settings fields (`noiseReduction`, `transportType`), the credential key (`apiKey`) and the pair keys stay apart; an empty key reads missing; `migrate(defaults, …)` gives the defaults; every source has targets, none is `auto`; the initial pair (en → zh) is offered; each language context's offer lies within the widest — the same offer in every context; no credential choice;
  - `gemini/provider.test.ts`' "sits after LocalInference" (`slice(0, 3)`) and `localInference/provider.test.ts`' "follows Kizuna Soniox" (`slice(0, 2)`) read the first ids, unchanged; `useSignInProviderSwitch.test.tsx` names the first managed provider, still Kizuna Soniox; `providerPaths.managedFit.test.ts` reads managed providers only;
  - the wizard's own-key list and the picker list Translate between Doubao AST 2.0 and Soniox, and the subtitles-only scenario offers it (`speech: 'optional'`);
  - the session-side guard walks Translate's folder with `provider.ts` outside the session side (Task 9's case).
- [ ] **Step 5: Commit.**

```bash
git add src/providers/openai_translate/provider.ts src/providers/openai_translate/provider.test.ts src/providers/registry.ts src/providers/registry.test.ts src/components/SetupWizard/providerPaths.test.ts src/providers/volcengine_ast2/provider.test.ts
```

```bash
git commit -q -F - -- src/providers/openai_translate/provider.ts src/providers/openai_translate/provider.test.ts src/providers/registry.ts src/providers/registry.test.ts src/components/SetupWizard/providerPaths.test.ts src/providers/volcengine_ast2/provider.test.ts <<'EOF'
feat(providers): OpenAI Translate with your own key, after Doubao AST 2.0

openai_translate on the new contract over WebSocket, unflagged, on every
platform: Text only offered as a playback control, push-to-talk with a
release tail, the participant speaking when its switch is on. The old
enum's id and slice keep a stored selection, the key, the pair and the
noise reduction; a stored WebRTC choice runs over WebSocket.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Group check B (controller)

After Wave 4 (Task 10). No step types a key into Translate's field or presses Start with Translate selected (ruling 22): its readiness check would call `/v1/models` 800 ms after a key appeared. Every page below starts on a fresh profile, so the key is empty.

1. The full gates (the scratch copy's end state: 538 files passed and 1 skipped, 6 853 tests passed and 2 skipped); both release builds; `npx vitest run extension`; the three D24 greps print nothing; `command grep -rlF 'turn.tail_end' build extension/dist` names at least one file under `build/` and one under `extension/dist/` — the new adapter shipped in both.
2. The full tree's typecheck is at most 259 (`/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oat-groupB-tsc.txt`).
3. Every probe green on a fresh vite, restarted after Task 10: the spine probes (subtitle, surface, export, audio, gate, local), `app-panel-probe` (preview; `--settings`; `--app`, plain and `--settings`), `extension-overlay-probe` (plain and `--ptt`) on fresh builds. The preview still opens on the fake (a fresh store).
4. **Translate's Provider tab, rendered** through `scripts/dev/headless.mjs`, screenshots under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, the page's network log (the DevTools `Network` domain) recorded for each:
   - `/?preview=spine&settings=advanced&provider=openai_translate`: the picker shows "OpenAI Translate" with the OpenAI icon and the setup guide's link (`…/docs/tutorials/openai-setup`); one "API key" row with its placeholder; Start off. Below the picker, first the info banner ("This model stays silent when the speaker uses the same language as the target. …"), then "Noise reduction" with its tooltip and one select — None, Near field, Far field, None selected. No model, transcript model or transport control anywhere. **No request to `api.openai.com`**.
   - `&settings=simple&provider=openai_translate`: the picker and the key row; no banner and no noise select (a provider's own settings are Advanced's).
   - Compare the banner and the noise section class by class with the old tab (`ProviderSpecificSettings.tsx:807-840, 2173-2183`) — the memory rule: match sibling markup.
5. **The languages and Text only**, in the simple layout (the advanced preview has no language section): 74 sources, no "auto"; 13 targets for English and for Thai; English → English selectable; the swap disabled for Thai → English. The Output block shows the **Text only switch** for Translate (the old app hid it — ruling 4's departure); toggling it on and off changes the switch alone, with 0 requests. That on a live leg it changes playback and nothing else is the adapter suite's Text-only case (Task 9: the same rows and the same `session.update`, no audio) — the preview cannot run Translate without the network. Screenshots of each.
6. **The gate:** `/?preview=spine&panel=1&provider=openai_translate` — Start off; the idle line reads "Enter your API key in Settings before starting." (`notices.credentials_missing`); 0 requests to OpenAI. (D20's refusal for a source-only language in Both is pinned by Task 10's case: the web preview refuses Both earlier, for its missing participant source.)
7. **The wizard** on a fresh profile at `/` (first run): the own-key path lists "Google Gemini | Doubao AST 2.0 | OpenAI Translate | Soniox" (and the development-only fake); the subtitles-only scenario no longer greys OpenAI Translate; its credential step shows one API key field and the OpenAI guide link — never filled, never validated, 0 requests to OpenAI.
8. **The Logs' rows:** `logStore.test.ts`' case (Task 1) is the evidence; no live frame exists before the owner's test.

---

### Task 11 (controller): the spec's amendments and the roadmap's record (ruling 23)

**Files:** Modify `docs/superpowers/specs/2026-09-22-client-contract-design.md` and `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`.

Each amendment anchors on its section and sentence as the AST2 plan's Task 18 and its final fix wave left them; line numbers here are `8db4261f`'s.

- [ ] **Step 1: The spec.**
  1. **"The session request"**, the paragraph "The seven `buildParticipantSessionConfig` overrides disappear." (`:368-372`), after "…follows from `turns: 'auto'`.": "For OpenAI Translate the thirteen targets now refuse a Both start whose source is outside them, before anything opens (D20, D22), where the old guard skipped the participant leg and ran the speaker alone (Stage 2 OpenAI Translate)."
  2. **"Turns" — "What each provider can do"**, the row `| OpenAI Translate ×2, OpenAI Live | **a continuous stream; there are no turns on the wire** | not needed — release stops the microphone and what was said finishes translating | n/a |` (`:426`) becomes two: `| OpenAI Translate | **a continuous stream; there are no turns on the wire**, no commit and no server VAD | the held remainder padded to the next 200 ms engine frame, then silence in real time until the translation has been quiet 1 s, at most 3 s after the release (Stage 2 OpenAI Translate, ruling 2): the server holds a sub-frame remainder until more audio arrives, and model time advances only with appended audio | after silence |` and `| OpenAI Live | **a continuous stream; there are no turns on the wire** | not needed — release stops the microphone and what was said finishes translating | n/a |`. In **"The design"**, the row `| OpenAI Translate, OpenAI Live | — | — | — |` (`:456`) becomes two: `| OpenAI Translate | — (a press ends a tail still running) | the pad, then real-time silence until quiet | the same tail — what the press appended is the model's input already, and no clear exists (Stage 2 OpenAI Translate, choice 7) |` and `| OpenAI Live | — | — | — |`.
  3. **"Coverage."** (`:535-537`), after "All of them gain push-to-talk and push-to-translate.": " OpenAI Translate's gain lands with its Stage 2 plan, over WebSocket; its Kizuna twin is deleted, not ported."
  4. **"The provider definition"**, after the AST2 plan's note on the shape (`:1118-1121`): "**Amended by the Stage 2 OpenAI Translate plan:** `speech: 'optional'` also describes a provider whose API cannot stop speaking: OpenAI Translate always produces translated audio, and bills it, so a leg that does not speak receives it and drops it in the adapter — Text only then changes playback and nothing else (ruling 4)."
  5. **"`start` owns the transport"** (`:1135-1139`), after "…so `supportsWebRTC` and `forcedTransport` leave the contract.": "OpenAI Translate's first port is WebSocket only: its `transportType` stays in `S`, read and not shown, and its `C.transport` is `'websocket'` until its WebRTC step widens both (Stage 2 OpenAI Translate, ruling 1)."
  6. **"Provider capability"**, `OpenAITranslateGAClient`'s row (`:969`): the karaoke column "per audio frame, **exists today**" becomes "per audio frame, **by arrival**: each content frame carries the translation's text from the previous frame's end to its length when the frame arrived — the old client's alignment (#216), kept by the owner's ruling, not a known correspondence (Stage 2 OpenAI Translate, ruling 6)"; the pairing column "inferred (media time)" becomes "inferred by proximity: no `timing` is emitted; every delta frame carries `elapsed_ms`, for the live test to settle whether it puts both sides on one timeline (ruling 6)". After "Doubao AST 2.0 is the second, pairing by proximity alone like Live Translate: neither states an origin or a timing." (`:985-986`): " OpenAI Translate is the third, by proximity too."
  7. **"Risks"**, the honesty rule ("**Karaoke's honesty depends on producers being honest.**", `:2125-2128`), after "…report a `range` only when the producer knew which characters the audio speaks.": "OpenAI Translate's arrival ranges are the one stated exception: the old client's alignment, kept as parity by the owner's ruling until its `elapsed_ms` is measured (Stage 2 OpenAI Translate, ruling 6)."
  8. **"L2 — the projection"**, after the paragraph "**The projection is incremental.**" (`:723-731`): "The window holds for untimed pairs. A translation with `timing` still scans every source with timing (`pair.ts`), and a timing that changes on every delta re-pairs on every delta, so the first provider to emit `timing` sets it once, at segment close, and extends F16 to a timed window first — OpenAI Translate's follow-up, should its `elapsed_ms` prove one timeline (Stage 2 OpenAI Translate, ruling 6)."
  9. **"Segmentation is one fact"** (`:1336-1339`): "It takes `S` because the answer can depend on transport: OpenAI Translate over WebRTC has no source pause today (`SentenceSegmentationSection.tsx:251`)." becomes "It takes `S` because the answer can depend on a setting. OpenAI Translate's is `'silence'`, and its WebRTC step is to feed the same segment machine the WebSocket port built, so both transports keep both pauses (Stage 2 OpenAI Translate, choice 4; survey §3.6.5)."
  10. **"Sockets that need upgrade headers"**, after the AST2 plan's closing sentence ("…move to `src/lib/contract/` with it.", `:1440`): "Nor does OpenAI Translate's. Its key rides in the `openai-insecure-api-key.<key>` WebSocket subprotocol, which a browser sends itself as `Sec-WebSocket-Protocol` on every platform, so it needs neither a header seam nor an ephemeral token; a key that is no valid subprotocol token makes the browser's `SyntaxError` quote it, so its seam rethrows in fixed words, and `redact()` masks the subprotocol (Stage 2 OpenAI Translate, ruling 16, choice 3). When OpenAI Live makes the seam's first use, its Electron rule scopes by path: the rule is per host and one-shot today (`electron/main.js:1113-1133`), so a stale Live rule for `api.openai.com` would reach a Translate upgrade."
  11. **"What adding a provider then touches"**, item 4 (`:1471-1474`), after "…or for Doubao AST 2.0, whose host and CSP origin the manifest already lists (`manifest.json:37, 116`)": ", or for OpenAI Translate, whose `wss://api.openai.com/*` host and CSP origins the manifest already lists (`manifest.json:38, 116`)".
  12. **"What every adapter must honour"**, the `frame` bullet, after "…under the old client's keys; a group holds one frame type." (`:308`): " OpenAI Translate's need no row: its three `.delta` frames group by their own type, `session.error` reads as an error by its suffix, and its `session.closed` — the server ending the session — draws the separator."
  13. **"Migration"**: after "…and deletes that provider's old code after the owner has run it live." (`:1943-1944`): " OpenAI Translate's own-key old code waits for its WebRTC step's live test: the WebRTC client imports the GA client (Stage 2 OpenAI Translate, ruling 14)." Item 5 (`:1965-1966`), "**OpenAI Translate** (`openai_translate`) — frame-level ranges, our own boundaries, inferred origin." becomes "**OpenAI Translate** (`openai_translate`) — frame-level ranges by arrival, our own boundaries, inferred origin, a push-to-talk release tail, Text only as a playback control — ported over WebSocket by the Stage 2 OpenAI Translate plan; its WebRTC transport is item 7. Its relay twin (`kizunaai_openai_translate`) is deleted, not ported." "**The relay twins**", after "…`kizunaai_openai_translate` stays held until OpenAI Translate's turn." (`:1990-1991`): "**Amended by the Stage 2 OpenAI Translate plan:** the owner has decided that one too: it is deleted, not ported, after the own-key port's live test (plan T2)." And "…and two relay twins, one held and one deleted." (`:1994`) becomes "…and two relay twins, both deleted."
- [ ] **Step 2: The roadmap.** Append `## Scheduled by the Stage 2 OpenAI Translate plan`, in the form of the entries before it:
  - **What landed:** the commits and the tasks, and their fix rounds; the rulings as the owner confirmed or overturned them.
  - **What was checked:** group checks A and B — Translate's Provider tab in both layouts with no request to OpenAI; the languages and the Text only switch; the gate's words; the wizard's own-key list and the subtitles-only scenario's fit; the adapter in both bundles (`turn.tail_end`) and neither fake.
  - **Stated departures:** this plan's self-review list.
  - **Before any release from the branch:**
    - the owner's live test below, before T2 deletes the relay twin and before any release that carries OpenAI Translate;
    - the registry order now `['kizunaai_soniox', 'localInference', 'gemini', 'volcengine_ast2', 'openai_translate', 'soniox']` (ruling 11);
    - the wizard's own-key description (`setup.paths.own-key.desc`): its "OpenAI" is now partly true — Translate is ported, OpenAI Realtime and OpenAI Live are not;
    - at Stage 2's end, `VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE` joins the release-flag cleanup (`build.yml:223, 277, 317, 419, 521`, `extension/vite.config.ts:173-174`), with T2;
    - the Text only tooltip (`simpleConfig.textOnlyDesc`; en "Translate to text only — no spoken audio output") is true of Translate's playback control in 28 catalogs; zh_CN's "不生成语音" and zh_TW's "不產生語音" ("no speech generated") are not — the owner's call (an open question below).
  - **The owner's live test** (survey §2.14's list, adjusted to the rulings). Each item names what to record in the Logs (diagnostic logs on, in Help):
    1. **The key and the check, on Electron, the extension's side panel and the web** (rulings 16, 18; choice 11): a valid key → Validate ✓; a key without translate access → "API key works, but gpt-realtime-translate is not accessible with this key."; a wrong key → "The provider did not accept the credentials: HTTP 401: …"; an unsupported region, if reachable → the region sentence; offline → not ready, Start off, no words about the key. Record any 429 met, and its words.
    2. **The socket on all three platforms** (ruling 16; choice 2): it opens with the subprotocol; no key in the Logs or the Logs' export. **Record what a revoked key does at the upgrade** — a refused upgrade (the start then reads "The connection to the provider failed: OpenAI's socket did not open (check the network, and that the API key is still valid)."), or an accepted one followed by an `error` event (then its words) — and whether DevTools' own console prints the subprotocol.
    3. **The session's configuration** (choice 1; ruling 9): record `session.created`'s `audio` (is noise reduction on by default? transcription?) and `expiresAt`; `session.updated` arrives, with `noise_reduction: null` for "None" and the type for the other two; the start resolves on it. If `session.updated` never arrives, every start times out with "OpenAI did not start the session within 30 s."; the fallback is to resolve on `session.created` once `session.update` is sent (`created()`: set `live` and settle).
    4. **Automatic turns, one leg**, several pairs (en → zh, ja → en, and a source-only language → en, e.g. th → en): rows cut by pause on each side; the translation's audio once on the monitor and once in the virtual microphone; replay per translation row with keep-audio on; karaoke per frame, **side by side with the old build** (ruling 6's arrival ranges).
    5. **Text only** (ruling 4): with it on, no audio on the monitor or in the virtual microphone, and the same rows as with it off; the Logs still show `session.output_audio.delta` frames (the API sends, and bills, the audio). Record how the switch's tooltip reads against that, in en and in zh_CN.
    6. **The `elapsedMs` evidence for the timing follow-up** (ruling 6): diagnostic logs on before Start; export right after the utterances (a group keeps its newest 100 events, `MAX_EVENTS_PER_GROUP`; the panel its newest 2 000 entries). Export the Logs over several utterances, speaking and silent, under automatic turns and push-to-talk. Record, for the source deltas, the translation deltas and the audio deltas: one timeline or several; monotonic or not; jumps across silence and across presses (model time or wall clock); absent or null on any; the audio frame's length against the 200 ms steps; whether a translation's value is its source's time or later by a lag; whether text and audio with the same value are the same words. And whether any `.done` event ever arrives (choice 18).
    7. **Same-language speech:** speaking the target language → silence, rows empty; mixed-language speech → gaps.
    8. **Push-to-talk and push-to-translate** (ruling 2; choice 7): a short press → the last words translated after the release. Over twenty or so presses, record `turn.tail` (`padSamples`) and `turn.tail_end` (`reason`, `silenceMs`, `lastOutputMs`): whether the last words come out before the tail ends (`quiet`, with `lastOutputMs` well inside `silenceMs`), or are cut by the cap (`cap`), or come out only at the next press — which tunes `TAIL_QUIET_MS` and `TAIL_MAX_MS`. A press with no speech → a `cancelled` tail; record whether anything shows. A second press during a tail → `press`. Record whether `session.input_transcript.delta` frames arrive after a tail ended `quiet` with `lastOutputMs: null` — the model still consuming the press while no translation came yet. Minutes idle between presses → the session survives (a dropped session, or a tail that never ends, is the keepalive question). Push-to-translate routes the raw voice while the key is up.
    9. **Muted for 5+ minutes under automatic turns:** the session survives? Muting mid-sentence stops the audio as a release does, with no tail: record whether the last words wait until the microphone comes back (ruling 2: no keepalive yet).
    10. **Heartbeats:** never played, never framed; the Logs do not flood — the delta rows group by type.
    11. **A long session** (ruling 13): 60 minutes or more. Record what happens at `expiresAt` — a `session.closed` (the run ends: "The provider ended the session.") or a close code (the connection-lost words) — and when.
    12. **Errors mid-session** (ruling 3; choice 9): a network drop → the connection-lost words, the run ended. Any mid-session `error`: its `type`, `code`, `message`, and whether a `session.closed` or a close follows an `error`, and after how long (tunes `ERROR_WORDS_MS`); a close within 10 s of an error reads with that error's words (`invalid_api_key` → the auth words, a quota error → the rate-limit words), one later with the connection-lost words.
    13. **Both, with participant speech** (ruling 5): two sockets; the participant translated into the speaker's source; its switch on → heard on the real device; off → silent; a source-only speaker language (th → en) refuses Start with "This provider can't translate the other participants for this language pair."; either leg ending ends both; participant-only. Record whether two sessions on one key are allowed.
    14. **Stop mid-utterance:** rows finalized; nothing plays after Stop; the untranslated remainder is dropped (parity).
    15. **An old profile** (rulings 1, 8, 10): key, pair, noise reduction and `transportType: 'webrtc'` saved by an earlier build → ready without re-entry; the session runs over WebSocket (`translation_session_start.transport` reads `websocket`); a stored `gpt-realtime-whisper` changes nothing. A fresh profile that holds an OpenAI Realtime key → Translate asks for its own (no prefill). A profile with Text only left on under another provider → Translate silent, the switch shown on.
    16. **The wizard:** the own-key list shows OpenAI Translate between Doubao AST 2.0 and Soniox; its key step validates; the subtitles-only scenario offers it.
    17. **Analytics:** `translation_session_start` with `provider: 'openai_translate'`, the translation model `gpt-realtime-translate` and the ASR model `gpt-live-transcribe` (choice 10); a refused start → `api_error` with its code.
    18. **The Logs panel:** the frames grouped, `session.error` red, the server's `session.closed` drawing the separator; no key anywhere, the export included.
    19. **The extension side panel's core flows:** the check's fetch and the socket under the extension's CSP.
  - **Open questions for the owner:**
    - The tail's constants (item 8), and a keepalive while idle or muted (items 8, 9): ruling 2 defers the keepalive until a dropped session or a stuck tail shows.
    - Count a source delta during the tail as activity (item 8)? Ruling 2 names the translation's output, and the plan counts that alone.
    - Timing and F16's timed window, and karaoke by `elapsed_ms` (item 6; ruling 6): the follow-up in "What it leaves".
    - Heartbeats' `elapsed_ms` is unobserved (research Q3, unknown 4): a heartbeat is not a delta, and stays unframed; model time against the wall clock is settled by push-to-talk gaps (item 6).
    - A socket that fails before it opens reads as the network with the key named (item 2; choice 2): a revoked key's upgrade may deserve its own words.
    - The Text only tooltip (item 5): zh_CN's and zh_TW's "no speech generated" are untrue for Translate, whose audio is generated and billed; rewording those two to "no speech output" would be true of every provider, and a Translate-specific wording would be a new key in 30 catalogs.
    - Expiry and drops end the run (item 11; ruling 13): a fresh session, or a reconnect, if the long session shows a fixed length.
    - `session.close` at Stop for a graceful flush of the untranslated remainder (item 14): it needs an awaited `session.closed`, which the stop rule forbids.
    - A mid-session `error` never ends the run by itself (item 12; ruling 3): whether any code should.
    - The error-code mapping and `ERROR_WORDS_MS` (choice 9), hypotheses until item 12's frames.
    - Source-only languages offered where the gate refuses Both (item 13): the old app warned under the picker (`settings.translateSourceParticipantWarning`, now unused) — the shape of the AST2 section's dialect question; filter the sources by reverse support while the participant leg opens, or accept it.
    - One speech entry per 200 ms frame (about five a second) in L1 and the clip queue over a long session (survey §3.4): the retention ceiling bounds the pcm, not the entry count.
    - A translation spanning two source segments pairs with one (the sides' pauses differ): legal, and visible (item 4).
    - Analytics for `degraded` (Plan A's open question, unchanged).
  - **T2's inventory** — the relay twin's deletion, after this port's live test (ruling 14; survey §3.5; lines read at `8db4261f`):
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
  - **T3's inventory** — the own-key old code of both transports, **after the WebRTC step's live test**, since the WebRTC client imports the GA client (`OpenAITranslateWebRTCClient.ts:38`: `buildSessionUpdate`, `computeRms`; ruling 14):
    - `OpenAITranslateGAClient.ts` (+ test), `OpenAITranslateWebRTCClient.ts` (+ test), `OpenAITranslateProviderConfig.ts`;
    - `IClient.ts:117-139, 333-335` (`TranslateTargetLanguage`, `OpenAITranslateSessionConfig`, its guard);
    - `EphemeralTokenService.ts:115-218` (the translation mint), unless the WebRTC step has moved it into its own folder — not `getToken`, which OpenAI Realtime's old WebRTC client uses;
    - the `openaiTranslate` slice of `settingsStore.ts` (`:41-43, 289, 419, 548-554, 655, 704, 753-773, 971, 1192-1196, 1349-1352, 1539, 1553-1557, 1623`) — the storage keys stay;
    - the old UI's Translate branches: `ProviderSpecificSettings.tsx:129-184, 384-467, 722-954, 2173-2187, 2274-2280`; `LanguageSection.tsx:99, 154-160, 249-254, 331-364, 587, 673-678`; `ProviderSection.tsx:73, 478-479`;
    - `ProviderConfigFactory.ts:6, 63`; `OpenAIClient.isTranslateRealtimeModel` once the OpenAI port has replaced `OpenAIClient`; `openaiModelMigration.test.ts:50-74`;
    - the orphan keys: `settings.translateModelAvailable`, `settings.translateSourceParticipantWarning`, and `settings.userTranscriptModel` / `settings.transcriptModelTooltip` only if OpenAI Realtime's port does not reuse them.
  - **F14:** OpenAI Translate is not a header user (ruling 16); F14 stays OpenAI Live's, and Translate's own `socket.ts` moves to `src/lib/contract/` with the other three when it lands.
  - **The roadmap's inheritance:** this plan's table "The roadmap's inheritance, item by item", as landed.
  - **What it leaves:** "What this plan leaves" below, verbatim.
- [ ] **Step 3: Commit.**

```bash
git add docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md
```

```bash
git commit -q -F - -- docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md <<'EOF'
docs(spec): OpenAI Translate's release tail, Text only, and a subprotocol key

Translate's turn rows gain the release tail an endpoint with no commit
needs; optional speech covers a provider that cannot stop speaking; the
key rides in a subprotocol, so Translate is no header user; its karaoke
is by arrival, a stated exception. The roadmap records the plan, the
owner's live test, and the inventories of T2 (the relay twin) and T3 (the
own-key old code, after the WebRTC step).

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

## The roadmap's inheritance, item by item

Taken (and where), deferred (and why), or already done.

**Scheduled by the Stage 2 foundation plan** (roadmap `:1289`, `:1292`, `:1304`):

| Item | Disposition |
|---|---|
| OpenAI Translate: F16 if AST2 did not land it | done by the Gemini plan (its Task 2); consumed through `createProjector` (Task 9's projection case) |
| OpenAI Translate: the noise field | built here: `NoiseReductionField` (Task 2); OpenAI Realtime and Compatible reuse it |
| OpenAI Translate: the transcript field | not built: the transcript model is a constant (ruling 8); OpenAI Realtime's port builds one if its models need it |
| OpenAI Translate: the transport field | deferred to the WebRTC step (ruling 1): `S.transportType` kept, `C.transport` its attachment point (choice 15); a shared `TransportField`, perhaps OpenAI Realtime's first |
| OpenAI + Compatible: F15, "unless Translate-WebRTC comes first" | not here: this port is WebSocket; the WebRTC step meets it |
| OpenAI Live: F14 (reused) | unchanged: Translate needs no header (ruling 16); the seam's per-host Electron rule should scope by path (spec amendment 10) |

**From the Soniox plan's "Found here"** (roadmap `:1740-1747`):

| Item | Disposition |
|---|---|
| Readiness re-probes on every settings edit | applies, cheaply: only the noise select can make one, and the model list is free and bounded |
| `timing` after a 503 resume | n/a: no timing, no resume |
| `audio.range` after fill-in | applies in form: ranges are measured against the text at arrival, and L1's fill-in re-anchors them; no `speechRanges` |
| The side latch | n/a: one leg per socket |
| Two TTS sockets per key in shared Both | its analogue, two sessions on one key in Both, is live-test item 13 |
| `Conversation.afterAudio`'s pending drop | n/a: no `speechRanges`, and no audio before its segment opens (`segments.audio` opens it first) |

**From "Scheduled by the Stage 2 Gemini plan"** (roadmap `:3005-3022`, `:3037-3093`):

| Item | Disposition |
|---|---|
| Live Translate's leading audio: open the translation segment on audio (open question) | Translate does, by parity (choice 5); its live test (item 4) is the first real evidence of that shape. Gemini's question stays Gemini's |
| Name the leg in `SessionContext` (open question) | n/a: Translate's legs differ by direction alone |
| The readiness re-check on each instruction edit | n/a: the endpoint takes no instructions (`OTD:103`) |
| `session.closed` on Stop | the same for Translate ("What this plan leaves") |
| The instructions of later ports | n/a |

**From "Scheduled by the Stage 2 Volcengine AST2 plan"** (roadmap `:3744-3835`):

| Item | Disposition |
|---|---|
| F14's owner, OpenAI Live | unchanged: Translate's plain `socket.ts`, with protocols, moves to `src/lib/contract/` with the other three when F14 lands |
| Generic frame names grouped under Doubao's Logs keys (M6) | met: Translate names none of Doubao's rows; Task 1 pins it |
| A kit-wide "no ws(s) URL in a frame" rule | n/a: Translate's URL carries no credential, and no frame carries the protocols (Task 9's no-leak case) |
| Each check opens a real session | n/a: Translate's check is a free model list |
| Superseded checks are never aborted | applies, harmlessly: two overlapping model lists |
| Dialect sources offered where the gate refuses them | its analogue: 61 source-only languages are offered, and D20 refuses Both for them — an open question (Task 11) |
| `trackedClock` in the kit; the seam's fixed words | consumed (Tasks 4, 5, 6, 9) |

**"Before any release from the branch"** (roadmap `:1751-1765`, `:2318-2343`, `:3697-3718`):
- The registry's order: extended by ruling 11, pinned in `registry.test.ts`.
- The wizard's own-key description: its "OpenAI" is partly true now (Translate); OpenAI Realtime and OpenAI Live wait for their ports.
- The relay twins: `kizunaai_openai_translate` deleted, not ported — T2 (ruling 14).
- The release-flag cleanup at Stage 2's end: `VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE` joins it, with T2.
- The native-speaker checks: none (no new key).

**Stage 2 items from the roadmap this plan does not take:** the kit's parked items (`{ flush: true }` after an awaited answer, `FakeSocket`'s close codes, the virtual clock's `pending()` count, manual-end's segment check); the account's compile-time narrowing; `RunnerDeps.replayAudio`'s guard; the notice-code namespace.

---

## What this plan leaves

- **T2**, the relay twin's deletion, after this port's live test (Task 11's inventory).
- **T3**, the own-key old code's deletion — both transports' clients, the descriptor, the translation mint, the slice's readers, the old UI's branches — after the WebRTC step's live test (Task 11's inventory).
- **The WebRTC step:** a transport and a dispatch in `start`, its fallback the same request handed to the WebSocket adapter (spec "The session request"), `C.transport` widened from `S.transportType`, the transport control; `segments.ts`, `tail.ts`'s grid and `wire.ts`' session update stay as they are.
- **The timing follow-up** (ruling 6): if the live log shows one aligned timeline, set `timing` once, at segment close, and extend F16's window to timed pairs (by `startMs`), and consider karaoke by `elapsed_ms`; if the values are emission-time, first let L2 fall back to proximity when no timed candidate clears `minOverlap` (research Q3).
- **The tail's constants** tuned from the live test, and **a keepalive** only if it shows a dropped session or a stuck tail (ruling 2).
- **A fresh session or a reconnect at expiry**, if the long session shows a fixed length (ruling 13).
- **`session.closed` on Stop** is not emitted (the kit forbids emissions after stop), as for Soniox, Gemini and Doubao.
- **`pcmToBase64` / `base64ToPcm`** lifted to `src/lib/contract/` at their third user (choice 8).
- **The owner's open questions** in Task 11's record, each with the live-test item that settles it.

---

## Self-review

**Spec coverage.** "L0 — the client contract" and "What every adapter must honour": Task 9 (the seven conformance scenarios, frames, stop, nothing after it). "Turns", Translate's rows: Tasks 6, 9 (the tail; the spec amended in Task 11). "The session request" (the participant as the reversed call, D20): Tasks 3, 10. "Provider capability", Translate's row: Tasks 5, 9 (arrival ranges, no origin). "The provider definition": Tasks 3, 7, 8, 10. "Credentials are not settings": Task 3 (one key, trimmed; `CredentialForm` and the wizard draw it). "Readiness is one check" (bounded): Task 7. "Languages are two functions" and D20: Tasks 3, 10. "Sockets that need upgrade headers": Tasks 4, 9 (the subprotocol; no seam). "Segmentation is one fact" (`'silence'`): Task 10. "L2 — the projection" (inferred pairing, F16): Task 9's projection case. "Testing" (conformance, virtual clock, no network): Tasks 4–9. The spec's amendments: Task 11.

**Placeholders.** None: every code step carries its code in full or its exact diff, every one run in the scratch copy (research notes); the commit trailers' `<implementing model>` is filled by the implementer, as in the earlier plans.

**Type consistency, checked across tasks:** `NoiseReduction`, `NOISE_REDUCTIONS`, `TranslateSettings { noiseReduction, transportType }`, `TRANSLATE_DEFAULTS`, `TRANSLATE_MODEL`, `TRANSCRIPT_MODEL`, `isTranslateModelId`, `migrateTranslateSettings`, `TRANSLATE_TARGETS`, `TRANSLATE_SOURCES`, `translateLanguages`, `TranslateCredentials { apiKey }`, `translateCredentials` (Task 3 → Tasks 4, 7, 8, 10); `TranslateConfig { model, target, transcriptModel, noiseReduction, silence, transport }`, `buildTranslate`, `describeTranslate` (Task 3 → Tasks 4, 5, 9, 10); `NoiseReductionField<V>({ value, options, onChange, disabled? })` (Task 2 → Task 8); `TRANSLATE_WS_URL`, `translateUrl`, `translateProtocols`, `sessionUpdate`, `appendFrame`, `pcmToBase64`, `ServerEvent`, `decodeServerEvent`, `base64ToPcm`, `OUTPUT_RATE`, `isSilentFrame`, `computeRms`, `elapsedMsOf`, `ErrorCode`, `errorCode`, `errorWords`; `OpenSocket = (url, protocols: string[]) => WebSocket`, `nativeSocket`, `WS_OPEN`; `KEY`, `RefusingWebSocket`, `SHARED`, `AUTO_CTX`, `configFor`, `b64`, `SERVER` (Task 4 → Tasks 9, 10); `SegmentSink`, `TranslateSegments.input` / `.output` / `.audio(pcm, play)` / `.done(side)` / `.stop()` (Task 5 → Task 9); `FRAME_MS`, `FRAME_SAMPLES`, `TAIL_QUIET_MS`, `TAIL_MAX_MS`, `TailEnd`, `TailSummary { reason, silenceMs, lastOutputMs, cancelled? }`, `padSamples`, `ReleaseTail.start(sent, cancelled)` / `.output()` / `.stop(reason)` / `.cancel()` / `.running` (Task 6 → Task 9); `OPENAI_MODELS_URL`, `CHECK_TIMEOUT_MS`, `createTranslateCheck`, `checkTranslate` (Task 7 → Task 10); `TranslateSettingsView` (Task 8 → Task 10); `createTranslateAdapter`, `TranslateAdapterDeps`, `START_TIMEOUT_MS`, `NEVER_OPENED`, `ERROR_WORDS_MS`, `startTranslate`, `liveTranslate` (Task 9 → Task 10); `openaiTranslateProvider` (Task 10). Every block ran together in the scratch copy — 538 files passed and 1 skipped, 6 853 tests passed and 2 skipped, 0 failed, no unhandled errors; 259 lines in the full tree and the gate's 20 — and again, after the review's fixes, applied from the plan's own text to a fresh copy of `8db4261f`, with the same numbers.

**The choices this plan makes inside the rulings** (each numbered above, listed for the owner): 1 the start resolves on `session.updated`; 2 the start's 30 s bound, and a socket that never opened read as the network with the key named; 3 the key's one reader, the seam's fixed words, and `redact()`'s subprotocol rule; 4 the segment machine copied from Gemini's Live Translate half, and why it is not shared; 5 content audio holds the translation played or not, so Text only changes playback alone; 6 karaoke by arrival; 7 the release tail's shape, on a cancel too; 8 the base64 helpers copied; 9 the failure codes and words, a close — the socket's or the server's — within `ERROR_WORDS_MS` of an error worded as it; 10 `describe` names two models; 11 the check's answers; 12 the frames, content audio deltas framed for ruling 6, and no `logStore` row; 13 `NoiseReductionField`; 14 the key trimmed; 15 `C.transport` and `S.transportType`; 16 a foreign output rate; 17 decoding and the two unreadable latches; 18 the `.done` events kept; 19 the two deletion plans, T2 and T3.

**Stated departures from the old behaviour** (for the roadmap's record):
- Text only is offered (ruling 4): the switch shows, and a leg that does not speak drops the audio the API still sends; the wizard's subtitles-only scenario offers Translate, where the old greyed it;
- push-to-talk and push-to-translate are offered (the spec's coverage), with the release tail (ruling 2) — the old provider offered automatic turns only;
- the participant speaks when its switch is on (ruling 5; the old participant dropped its audio);
- a source-only language refuses Both at start, in words (D20, D22), where the old guard skipped the participant and ran the speaker alone under a warning line;
- the model select, the transcript select and the transport toggle are gone (rulings 7, 8, 1); a stored `webrtc` runs over WebSocket (ruling 1); noise reduction "None" sends `null` (ruling 9); no OpenAI-key prefill (ruling 10); a Text only switch left on under another provider now silences Translate, where it was ignored (ruling 4);
- the start waits for `session.updated`, is bounded on the request's clock with the socket closed on every path, and a close before the session starts rejects at once (choices 1, 2; the old hung 30 s and left its socket open);
- a mid-session `error` is a Logs line, not two bubbles, and a close within `ERROR_WORDS_MS` of it — the socket's or the server's — says its words (ruling 3; choice 9); an unexpected close ends the run in words, where the old tore it down silently (ruling 13);
- the check is bounded and throws on a status the key does not explain or a failed fetch, where the old called every failure an invalid key; a region and a missing model are their own codes (choice 11);
- the key is trimmed (choice 14);
- appends are no longer framed; delta frames carry `elapsedMs`; heartbeats stay unframed (choice 12); an odd audio byte no longer throws (choice 8); a foreign output rate is skipped and said once (choice 16).

**Departures from the survey** (for the reviewer):
- `speech: 'optional'` (ruling 4): the survey recommended `'always'`;
- the release tail runs in real time until the translation is quiet, capped (ruling 2), in its own `tail.ts` (choice 7): the survey planned a burst of `C.tailMs`, so `C` has no `tailMs`;
- content audio drives the translation on a leg that does not speak too (choice 5): the survey dropped it outright under `speech === false`;
- `redact()`'s subprotocol rule adopted (choice 3): the survey called it optional;
- an audio delta that will not decode is its own unreadable episode (choice 17);
- a mid-session error words the close that follows it for any code, the server's `session.closed` included, and only within `ERROR_WORDS_MS` (ruling 3; choice 9): the survey worded only a socket close, only for `auth` and `rate_limit`, and kept the error for good;
- the `logStore` pin and the wizard-fit pin added (Tasks 1, 10), with no `logStore.ts` change, as the survey said;
- frames: `session.opened` out, `turn.tail_end` added, the audio frame carrying `sampleRate`; the bundle sentinel is `turn.tail_end`;
- ten implementation tasks: the survey's T4 and T5 (settings, builder) merged as Task 3; the tail its own task (Task 6).

**Departures from the brief** (for the controller):
- The brief's technical choices list "the hot-path rule (no frame per audio delta or append)", while the owner's ruling 6 asks for `elapsedMs` on every delta frame, the output audio's included. The ruling wins for the content audio deltas, framed as Gemini's `server_content.model_turn` is and grouped by type in the Logs; the hot-path rule holds for appends, heartbeats and the tail's silent frames (choice 12).
- The typecheck gate's regex is the AST2 plan's, unwidened: every file this plan creates or edits is already inside it (research notes).
- "The Text only switch shown and toggling nothing but playback in a fake-driven case": the switch is rendered at group check B, and the fake-driven case is the adapter suite's (Task 9, over `FakeSocket`) — the preview cannot run a Translate session without the network, and its fake provider is not Translate.
