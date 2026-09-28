# Client contract — Stage 2, provider 6: OpenAI Realtime (`openai`, own key, WebSocket; OpenAI Compatible retired)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Standing of the rulings below.** Rulings 1–22 are **the owner's decisions** (2026-09-28, in conversation): OpenAI Compatible retired, not ported (ruling 1); the drift anchor kept as parity (ruling 2); karaoke by arrival, OpenAI Translate's (ruling 3); the participant's automatic detection the user's own (ruling 4); no one-time migration code, the turn-mode migration unchanged (ruling 5); the temperature removed (ruling 6); "Auto-detect" kept as a source (ruling 7); typed text and a release's response queued in the adapter (ruling 8); readiness narrowed to what a check reads (ruling 9); ruling 10 moot with Compatible retired; the source transcript streamed (ruling 11); and, accepting the survey's parity recommendations, rulings 12–22 in the order the brief lists them — WebSocket only (12), a mid-session `error` in the Logs (13), a drop or the 60-minute cap ending the run in words (14), the participant speaking on its switch (15), noise "None" as `null` (16), a restricted key's 403 as parity (17), the registry order (18), the OpenAI setup guide (19), the deletion timing (20), the leg left unnamed in `SessionContext` (21), the GA start resolving on `session.updated` within 30 s (22). Rulings 23–30 are the controller's technical rulings. Where a ruling left a sub-decision to this plan ("decide and say why", "say what happens"), the answer is a numbered *choice* below, and the self-review lists each one.

**Goal:** OpenAI Realtime — a GPT Realtime dialogue model made a translator by its instructions — with the user's own key (`openai`) on the new contract, over WebSocket: its definition, settings, credentials, a bounded model-list check, builder, adapter and settings view, so the owner can run it live. Concretely:
- the key in the `openai-insecure-api-key.<key>` WebSocket subprotocol on the GA endpoint, through the provider's own socket seam, which rethrows a refused socket in fixed words; pinned against the `openai` SDK the old client dialled through (ruling 25; choice 7);
- a start that resolves once the server confirms the configuration (`session.updated`), bounded at 30 s on the request's clock (ruling 22; choice 6);
- **exact pairing** by item ids: every input item — a VAD or manual commit, a typed text — is a source segment whose origin is its id, and each translation names the input its assistant item follows (`previous_item_id`), else the newest unanswered input when its response began (ruling 23; choice 8); karaoke by arrival (ruling 3; choice 9); the source transcript streamed (ruling 11);
- typed text and a push-to-talk release's `response.create` held first in first out while a response is in progress, in the adapter (ruling 8; choice 10); the drift anchor re-sending the instructions out of band at the start and after every fifth translation, framed with its cost (ruling 2; choice 11);
- **a readiness check that says what it reads** (`checkReads`), so a slider or a prompt edit no longer turns Start off pending an 800 ms re-check — a generic change, declared by OpenAI Realtime alone (ruling 9; choice 3);
- two shared pieces lifted at their due users: the pcm base64 helpers (third user) to `src/lib/contract/`, and the bounded check request (fourth user) to `src/lib/provider/`, their users switched byte for byte (ruling 24; choices 1, 2);
- the settings view from the shared fields, with the provider's own transcription, reasoning-effort and turn-detection pieces; no temperature (rulings 6, 27; choice 17); registered between Doubao AST 2.0 and OpenAI Translate (ruling 18).

**OpenAI Compatible is retired, not ported** (ruling 1): no definition, settings view, check or wire dialect; a stored `openai_compatible` selection falls to the first provider offered through the existing `selectionFromStored`, with no new code, and its stored slice is left as it is. The plan ends with the controller's docs task and the owner's live test (Task 13). **The WebRTC transport joins the later OpenAI Translate WebRTC step** (ruling 12): this port keeps `transportType` in `S`, unshown and not honoured, with `C.transport: 'websocket'`. **Deleting the old OpenAI code, the old Compatible code and the `openai-realtime-api` fork is one later plan merged with OpenAI Translate's T3, after the WebRTC step's live test** (ruling 20); this plan records the inventory only (choice 23).

**Architecture:**
- **One folder,** `src/providers/openai/`:
  - the definition's data — `settings.ts` (`S`, its validation, languages, voices, the credentials `K`, the effective model), `transcription.ts` (the source transcript's hints; pure, copied), `config.ts` (`C`, `build`, `describe`), `check.ts` (one bounded model list);
  - the session side — `socket.ts` (the seam, with protocols), `wire.ts` (the URL, the subprotocols, the client frames, decoding, a response told in or out of band, a translation's final text, an error's code and words; pure), `items.ts` (items → segments, paired by id, ranged by arrival; pure), `queue.ts` (the in-band responses asked for, one at a time; pure), `adapter.ts` (one leg);
  - the view — `RealtimeSettings.tsx`, `RealtimeTurnDetection.tsx`, `TranscriptionField.tsx`, `ReasoningEffortField.tsx`; and `provider.ts`; `testing.ts` holds the suites' fixtures and the harness.
- **Shared pieces built or changed here:** `src/lib/contract/pcm64.ts` (lifted), `src/lib/provider/boundedFetch.ts` (lifted), `Provider.checkReads?` with `providerStore`'s narrowing, and `ModelConfigurationField`'s temperature made optional.
- **One contract change:** `Provider.checkReads?` (ruling 9) — an optional member; every provider that does not declare it behaves as before. Nothing in `src/lib/contract/**` beyond the lifted helper, the runner, `shape.ts` or `appShape.ts` changes.
- **The old OpenAI code stays compiled and unreachable** (`OpenAIGAClient`, `OpenAIClient`, `OpenAIWebRTCClient`, `openAIRealtimeSession`, `openaiTranscriptionContext`, both descriptors, the old settings UI's OpenAI and Compatible branches, the two store slices, `EphemeralTokenService.getToken`) — the deletion plan's.

**Tech Stack:** TypeScript (strict), React 19, zustand, i18next, the `openai` SDK's realtime types (`import type` in the session side; one value import, in the socket oracle test), Vitest + @testing-library/react (jsdom), the adapter test kit (`FakeSocket`, `driveAdapter`, `runScenario`, the virtual clock, `trackedClock`), a stub `fetch` answering `Response` objects, headless Chromium over the DevTools protocol (`scripts/dev/headless.mjs`) at the group checks.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — the binding authority, as amended by the Stage 2 foundation, Soniox, Kizuna Soniox, Gemini, Volcengine AST2 and OpenAI Translate plans (above all "Readiness is one check": **`check` bounds its own request**). The parts this plan implements: "L0 — the client contract" and "What every adapter must honour" (typed text answered by the adapter; `busy`); "Turns" (OpenAI's rows; the participant always automatic); "The session request" (the participant as the reversed call; D20); "Provider capability" (OpenAI's row: stated pairing); "The provider definition" (the drift anchor; the model choice; `checkReads`, new); "Readiness is one check" (bounded; the effective model; narrowed); "Languages are two functions" (`AUTO`); "Sockets that need upgrade headers" (none needed); "Segmentation is one fact" (`'provider'`); "Persisted settings that move" (the turn mode; the instructions; the transport); "Testing" (conformance). It amends the spec in Task 13.

**Research notes:**
- **The survey this plan is written from:** `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/stage2-openai-realtime-survey.md`, cited as *survey §x*: §0 (findings), §1 (the old implementation as protocol documentation), §2 (the mapping), §3 (the outline, the shared pieces, the risks, the spec statements it corrects, the owner's questions). It was read at `583df521`, this plan's starting point; every file:line this plan relies on was re-read there. Its group B (OpenAI Compatible) is dropped by ruling 1. `GAC` = `src/services/clients/OpenAIGAClient.ts`, `OAC` = `src/services/clients/OpenAIClient.ts`, `ORS` = `src/services/clients/openAIRealtimeSession.ts`, `OTC` = `src/services/providers/openaiTranscriptionContext.ts`, `OPC` = `src/services/providers/OpenAIProviderConfig.ts`, `PSS` = `src/components/Settings/sections/ProviderSpecificSettings.tsx`, `SDK` = `node_modules/openai/resources/realtime/realtime.d.ts` (`openai` 6.39.1), `oldMP` = `git show aecaae2b^:src/components/MainPanel/MainPanel.tsx`.
- **Found while writing** (at `583df521`):
  - **Six existing cases name `openai` as "a provider this build does not register"** — `loadStores.test.ts` (the fallback on load), `SetupWizard.test.tsx` (a record it starts blank from), `providerPaths.test.ts` (`providerFits`, `offersRecord`, `wizardProvider`) and `useApplySetup.test.ts` (a draft it refuses). Registering `openai` makes each false; Task 12 moves them to `openai_compatible`, which no build registers any more — so the loader's fallback case now pins ruling 1 end to end.
  - **The SDK lags the API twice:** `AudioTranscription` has no `languages` / `keywords` (`SDK:13-42`), and `RealtimeAudioConfigInput.noise_reduction` is not nullable (`SDK:1008-1051`) though its doc says `null` turns it off. `wire.ts`' `WireSessionUpdate` widens both; every other field is the SDK's own type.
  - **`OpenAIRealtimeWebSocket` takes a plain object for its client** (`openai/realtime/websocket.js:10-32`), as `GAC:144-150` passed one, and dials `new WebSocket(url, protocols)` from the global: over a stubbed `FakeSocket` it connects nowhere, so the URL and the subprotocols are pinned against it (`wire.oracle.test.ts`, Task 6), as Gemini's wire is against `@google/genai`.
  - **`ModelConfigurationField` requires a temperature;** ruling 6 needs a model configuration with the max tokens alone. The field takes it optionally (Task 4); Gemini's calls are unchanged.
  - **`unwrapTranslationText` lives in `src/utils/textUtils.ts`, which only the three old OpenAI clients import:** copied into `wire.ts` (choice 5), so the deletion plan can take the file with them.
  - **The queue's first design lost a request** under an interleaving the seeded test found: a response's end, heard after the server had already refused a later request, cleared the wrong one. Only a latency longer than a response's life produces that order; the test states its model (the server answers a request at once; a response ends only after the client heard what came before it), and the in-band `response.create` now names its request in its metadata, so the response it creates is told apart from the server's own (choice 10).
  - **`logStore` needs no row:** its `.delta` rule groups each of the four delta frames under its own type, and no other name of this adapter is the microphone's row or one of Doubao's (`logStore.ts:382-393`). Task 4 pins it, with no change to `logStore.ts`.
  - **Every word the view and the check use is an existing key,** each checked present and non-empty in all 30 catalogs (58 keys: the 53 Global Constraints lists and the 5 alias targets). No new key, and no new notice alias: `no_realtime_model`, `region_unsupported`, `models_required`, `connection_lost` and `segment_ended` exist (`noticeText.ts:88-114`).
  - **Every file this plan creates or edits is already inside the AST2 plan's typecheck regex** (`app/`, `lib/(contract|provider|diagnostics/…redact)`, `providers`, `components/providers`, `SetupWizard/…`, `stores/(providerStore|logStore)`), so the gate's regex needs no widening.
  - **A scratch copy of the tree** at `583df521` (outside the repository, 2026-09-28) ran every code and test block below before it was written down; each block is that copy's file, and every diff is generated from it against `583df521`. The plan was then applied again, task by task, to a fresh copy of `583df521` — each task's red step first, then its green step, each wave's full gates after it — and the result was byte-identical to the tested tree: after Wave 1, 543 files passed and 1 skipped, 6 907 tests passed and 2 skipped; after Wave 2, 551 and 1, 6 968 and 2; after Wave 3, 552 and 1, 7 010 and 2; with every task, **553 files passed and 1 skipped, 7 018 tests passed and 2 skipped, 0 failed, no unhandled errors**; the typecheck at 259 lines in the full tree and exactly the gate's 20 after every wave. An independent review then applied it again at each task's own point and matched every number; its fixes (the anchor's case, the 60-minute cap ending at its error, a routine refusal never the words of a close, the owner of an assistant item announced first, the default model before the newest) were applied here and the whole plan re-applied to a fresh copy once more, with the numbers above.
- **The roadmap:** `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` — "Scheduled by the Stage 2 foundation plan" → OpenAI + Compatible (`:1291-1296`: F15, the D25 participant fix, `busy`'s reader, the drift anchor, the model migration and `turnDetectionMode` through `legacyKeys`, Compatible's `i18nKey`); plan 1d-1's `busy` (`:472-473`); the Soniox plan's "Found here" (`:1740-1747`: readiness re-probes on every edit); the Gemini plan's section (`:2499-3093`: its open questions `:3005-3022` — naming the leg, the readiness re-check on instruction edits — and "What it leaves" `:3082-3093`); the Volcengine AST2 plan's (`:3744-3835`); the OpenAI Translate plan's (`:3837-4441`: its open questions `:4321-4340`, T3's inventory `:4357-4367`, its inheritance tables `:4369-4426`, "What it leaves" `:4428-4441` — the base64 lift at the third user, the shared `boundedFetch`, the kit-level seeded lifecycle scenario). The section "The roadmap's inheritance, item by item" below carries each.
- **The OpenAI Translate plan** (`docs/superpowers/plans/2026-09-28-client-contract-stage2-openai-translate.md`) and **the Gemini plan** (`docs/superpowers/plans/2026-09-28-client-contract-stage2-gemini.md`) have both landed in full with their final fix waves. What this plan takes from them is listed, by their landed names, in "What this plan consumes from the earlier plans". They are also this plan's form models; the Translate execution's lessons are rules here: counting beats, not wall time, where a timer decides (no timer here decides but the start's bound); `recentError` refusing a negative age; parallel waves on disjoint files; pathspec commits; no temporary files inside `src/`.

## Global Constraints

- **Starting point.** HEAD `583df521` on `worktree-client-contract-stage2`. Every task anchors its edits by content, not by line: a line number cited here was read at `583df521`.
- **Edits shown as diffs.** A change to an existing file is a unified diff with its context lines, generated from the scratch copy (research notes); its hunk headers count the lines at `583df521` — or, for the two files two tasks edit (`registry.test.ts`, Tasks 3 and 12; `openai/testing.ts`, Tasks 6 and 11), at the earlier task's result. Apply a hunk by its content all the same. A new file is shown in full.
- **What this plan touches:**
  - `src/lib/contract/pcm64.ts` (+ test) and the two wires that copied it (`src/providers/{gemini,openai_translate}/wire.ts`) — Task 1;
  - `src/lib/provider/boundedFetch.ts` (+ test) and the three checks that wrote it out (`src/providers/{soniox,gemini,openai_translate}/check.ts`) — Task 2;
  - `src/lib/provider/types.ts`, `src/stores/providerStore.ts`, `src/stores/providerStore.readiness.test.ts`, `src/providers/registry.test.ts` — Task 3;
  - `src/components/providers/fields/ModelConfigurationField.tsx` (+ test), `src/stores/logStore.test.ts` (a case; `logStore.ts` is not edited), `src/lib/diagnostics/redact.ts` (a comment) — Task 4;
  - `src/providers/openai/**` (new) — Tasks 5–12;
  - `src/providers/sessionSide.consistency.test.ts` — Task 11;
  - `src/providers/registry.ts` (+ test), `src/providers/openai_translate/provider.test.ts` (its order case), `src/components/SetupWizard/{providerPaths,useApplySetup}.test.ts`, `src/components/SetupWizard/SetupWizard.test.tsx`, `src/app/loadStores.test.ts` — Task 12;
  - the spec and the roadmap — Task 13.
- **Read only.** `src/services/**` (the old clients, the descriptors, `openaiTranscriptionContext`, `EphemeralTokenService` are ported by copying, never imported); `src/utils/textUtils.ts`; the old settings UI (`ProviderSpecificSettings.tsx`, `ProviderSection.tsx`, `LanguageSection.tsx`); `src/stores/settingsStore.ts`, `src/stores/logStore.ts`; `src/lib/session/**` (`storedSettings.ts`' turn-mode migration is not changed, ruling 5); `src/lib/view/**` (every alias exists); the 30 locale catalogs (no new key); `electron/**` and `extension/**` (no header, no background change; the manifest already lists `wss://api.openai.com/*` and the CSP's `https://api.openai.com` and `wss://api.openai.com`, `extension/manifest.json:38, 116`); `package.json` and the lockfile. `npx vitest run src/services` stays green.
- **Import rules:**
  - `src/lib/**` never imports React or `src/app/**`. `src/lib/contract/testing/**` is test-only; so is `src/providers/openai/testing.ts` (the session-side guard's kit rule).
  - A provider's session side — `adapter.ts` and every file of its folder it reaches by a value import — imports no store and no reporter and runs no global timer: every timer reads the request's clock (`clock.setTimeout`, `clock.now()`). OpenAI Realtime's session side is exactly `adapter.ts`, `items.ts`, `queue.ts`, `socket.ts` and `wire.ts` (pinned by Task 11); `adapter.ts` and `wire.ts` import `config.ts`, `settings.ts` and `transcription.ts` **as types only**. `check.ts` is the settings side and keeps its own clock; nothing on the session side imports it.
  - **The SDK as types only** on the session side: `openai/resources/realtime/realtime` is imported with `import type` in `wire.ts` and `adapter.ts`, erased from every bundle. The one value import, `openai/realtime/websocket`, is in `wire.oracle.test.ts`.
  - New code imports nothing from `src/services/**`, `src/utils/textUtils.ts`, `src/stores/settingsStore` or another provider's folder (choice 5). Both fakes reach a bundle only through the registry's `import.meta.env.DEV` literal (D24).
- **Diagnostics** (CLAUDE.md, "Error Handling"): the adapter never reports and never logs; it says what happened through `failed`, `degraded` (`parse_error`) and `frame`. A socket's `error` event and a mid-session server `error` are Logs-only frames (ruling 13). The check throws when it could not find out; the readiness store reports it.
- **The key** rides in the second subprotocol (ruling 25). Neither the key nor the subprotocols are put in a frame, an error, a notice or a log line of ours; `realtimeProtocols` is the one function in `wire.ts` that reads the key (pinned by a scan, Task 6), and `adapter.ts` passes the credentials through without reading them; `redact()` masks the subprotocol wherever it reaches a sink anyway (OpenAI Translate's carrier rule). The URL carries no credential. A browser that refuses the socket quotes the subprotocol in its `SyntaxError`: the seam rethrows in fixed words (Task 6), and the start rejects in them (Task 11).
- **Frames** (ruling 28; choice 13) are `domain.event`, never audio, never the key or the subprotocols: out — `session.opened`, `session.update`, `input_audio_buffer.commit`, `input_audio_buffer.clear`, `conversation.item.create` (`{ itemId, length }`), `response.create` (`{ eventId, for, waitedMs }`), `response.queued` (`{ for, waiting }`), `response.anchor` (`{ eventId, translations }`); in — the server's own event types with compact payloads (`session.created`, `session.updated`, `input_audio_buffer.{speech_started,speech_stopped,committed,cleared}`, `conversation.item.added`, `conversation.item.input_audio_transcription.{delta,completed,failed}`, `response.created` and `response.done` — each with `outOfBand`, `response.done` with its `status`, `statusDetails` and `usage` — `response.output_item.{added,done}`, `response.output_audio_transcript.{delta,done}`, `response.output_text.{delta,done}`, `response.output_audio.delta` (`{ responseId, itemId, samples }`), `response.output_audio.done`, `rate_limits.updated`), the quiet ones under their own names with no payload (`conversation.item.{done,deleted,truncated}`, `conversation.item.input_audio_transcription.segment`, `input_audio_buffer.timeout_triggered`, `response.content_part.{added,done}`), and `session.error`, `session.unknown`, `session.unreadable`, `session.socket_error`, `session.connection_lost`. No frame per outgoing append (the hot-path rule).
- **Locales.** No new key (ruling 26). Every word is an existing key — 58 in all, each checked present and non-empty in all 30 catalogs at `583df521`: the notices `notices.{auth,rate_limit,network,server,client,credentials_missing,participant_unsupported,parse_error}` and the aliases `no_realtime_model` → `settings.realtimeModelNotAvailable`, `region_unsupported` → `settings.regionNotSupported`, `models_required` → `mainPanel.modelsRequired`, `connection_lost` → `mainPanel.sonioxConnectionLost`, `segment_ended` → `mainPanel.sonioxSegmentEnded`; the view's `settings.{systemInstructions,voice,voiceTooltip,model,modelTooltip,modelsFound,userTranscriptModel,transcriptModelTooltip,transcriptKeywords,transcriptKeywordsTooltip,transcriptKeywordsPlaceholder,noiseReduction,noiseReductionTooltip,modelConfiguration,maxTokens,maxTokensTooltip,unlimited,reasoningEffort,reasoningEffortTooltip}`, `settings.reasoningEffortOptions.{minimal,low,medium,high,xhigh}`, the turn detection's `settings.{vadSettings,turnDetectionTooltip,normal,semantic,threshold,thresholdTooltip,prefixPadding,prefixPaddingTooltip,silenceDuration,silenceDurationTooltip,eagerness,semanticEagernessTooltip,auto,low,medium,high}`; the definition's `providers.openai.{name,description}`, `setup.credentials.apiKey`, `simpleSettings.apiKeyPlaceholder`; the picker's `common.autoDetect`.
- **No network (ruling 26).** No test, probe or step calls OpenAI. The adapter is tested over `FakeSocket` on a virtual clock; the check over a stub `fetch`; the oracle over a stubbed `WebSocket`. No group check types a key into OpenAI Realtime's field (the readiness driver would call `/v1/models` 800 ms later) or presses Start with it selected.
- **Gates for every task:**
  - **The suite.** `npx vitest run src` shows 0 failed and no unhandled errors. Measured at `583df521` on 2026-09-28: **538 test files passed and 1 skipped (539); 6 860 tests passed and 2 skipped (6 862); no unhandled errors.** The scratch copy after each wave: 543 / 551 / 552 files passed and 1 skipped; 6 907 / 6 968 / 7 010 tests passed and 2 skipped; with every task 553 and 1, 7 018 and 2 — references, not the gate: the gate is the rule. (The `Not implemented: window.open` stderr lines are pre-existing, `ChildWindowPopover`'s.)
  - **The typecheck.** The gate prints exactly the baseline lines below. The shell's `grep` is a ugrep wrapper that mis-parses this regex, so use `command grep` exactly as written. The regex is the Volcengine AST2 plan's, unchanged: every file this plan creates or edits is already inside it (research notes).

    ```
    npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts|diagnostics/(consoleLedger|clientDiagnostics|redact))|lib/modern-audio/BaseAudioRecorder|providers|services/(clients/(SonioxSttStream|SonioxTtsStream|PcmMixer|SonioxSideTracker|SonioxTtsRest|SonioxVoicesClient|SonioxClient|ManagedVoicesClient|managedVoicePolling|VolcengineAST2Client|volcengine-ast2/ast2-proto\.d)|providers/(SonioxProviderConfig|KizunaAISonioxProviderConfig|managedVoicePrep|managedVoicePrep\.test|prepareToStart\.kizunaSoniox\.test))\.ts|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|MainPanel\.|panel/|SessionCountdown)|MainLayout/(MainLayout|useSignInProviderSwitch)|Settings/(Settings\.tsx|ProviderArea|SimpleSettings/SimpleSettings\.tsx|AdvancedSettings/AdvancedSettings\.tsx|sections/((SpeechSection|VoiceLibrarySection)(\.test)?\.tsx|(ParticipantSpeechSwitch(\.test)?|SentenceSegmentationSection|SystemAudioSection|SonioxVoiceSection|ProviderSpecificSettings)\.tsx|voiceLibrarySource(\.test)?\.ts))|SettingsInitializer/|SetupWizard/(SetupWizard(\.test)?\.tsx|(setupDraft|applySetup|useApplySetup)(\.test)?\.ts|providerPaths(\.test|\.managedFit\.test)?\.ts|steps/(StepLanguagePair|StepLanguagePair\.test|StepCredentials|StepCredentials\.test|StepFinish|StepProviderPath|StepScenario)\.tsx)|TitleBar/(AccountButton(\.test)?\.tsx|useBalanceShortfall)|Tour/useStartBasicsTour\.ts|dev/(SpinePreview|SessionControls|OverlayPreview|wireTally|gapCounter))|contexts/UserProfileContext|locales/(index\.ts|showLanguageUncached)|routes/Home\.tsx|stores/(providerStore|turnModeStore|routingStore|accountStore|logStore|settingsStore\.ts)|utils/(environment|conversationExport)|subtitle-overlay-entry|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
    ```

    **The baseline** — exactly these **20** lines, re-measured at `583df521` (the Translate plan's own 20; **259** lines in the full tree):

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

    Do not fix them; do not add to them. The TS lib is ES2020: no `Array.prototype.at` in a test either.
  - **Gates in a parallel wave** (as the earlier Stage 2 plans). Waves run tasks at once in this one working tree, so each task sees the others' red phases:
    - a test failure, or an extra gate line, in a file another concurrent task is changing is that task's work in progress: the implementer names it in the report and never touches it;
    - the task's own files must be green, and the gate must print the baseline plus only such named lines;
    - after each wave the controller runs the full gates: the suite at 0 failed with no unhandled errors, and the exact baseline.
  - **A task edits only the files in its Files list**, and commits exactly those. Where a step names tests elsewhere that its change could reach, it names why each stays green. If one fails anyway, the implementer stops, reports the failure with its output, and leaves the file untouched: the controller decides. No task edits a read-only file or a file another task of the same wave edits.
  - **No task mutates the tree to prove a guard, and no temporary file is written inside `src/`** (the Translate execution's lesson). Every guard proves itself with controls inside its own test; a mutant a reviewer wants to try runs in a scratch copy under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`.
- **Builds, at the group checks only** (the controller's):
  - `npm run build` and `npm run extension:build`. If `extension/node_modules` is missing, run `npm ci --prefix extension` first.
  - `npx vitest run extension`.
  - The D24 check: each of these prints nothing —
    - `command grep -rlF 'The fake degraded its speech' build extension/dist`
    - `command grep -rlF 'Lease ended by the leased fake' build extension/dist`
    - `command grep -rlF 'The leased fake refused the lease' build extension/dist`
  - The OpenAI Realtime check: `command grep -rlF 'response.anchor' build extension/dist` — at group check A it prints nothing (the adapter is not registered yet); at group check B it names at least one file under `build/` and one under `extension/dist/`, the new adapter shipped in both. Nothing under `src`, `electron` or `extension` holds that string at `583df521` (checked), and Task 4's `logStore.test.ts` case, which names it, is a test.
- **Dev servers, probes and builds** are the controller's; an implementer never starts one. Checks run against a fresh vite: `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort --force`. Restart it after edits: a worktree's vite can serve stale transforms.
- **Shell forms.** This worktree's guard refuses compound shell forms: brace groups, loops, `cd … &&` chains. Every command in this plan is a single command or a plain pipeline, run as its own call from the worktree root. Use `command grep`. The shell is zsh: quote globs; `echo ====` is an error. Checks write their outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, never `/tmp`, each agent in a directory named for its task and role (`t11-impl/`, `t7-review/`).
- **Commits:**
  - Conventional, in English. Every message ends with the implementing model's own `Co-Authored-By:` line, then `Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe`, and nothing after it. The examples below write the first as `Co-Authored-By: <implementing model> <noreply@anthropic.com>`: fill in your own model's name.
  - Run `git add <paths>`, then `git commit -q -F - -- <the same paths> <<'EOF' … EOF`, as two separate calls. The `--` pathspec is mandatory: parallel tasks stage into the same index. Never stage a whole directory that is not wholly the task's.
  - Production comments cite rulings, choices, D rulings and F items — never a task number or a review finding. The one exception is Task 5's `adapter.ts` seed, which Task 11 replaces.
  - Never push.

## Rulings

Cited as *ruling N*. Rulings 1–22 are the owner's decisions (2026-09-28); 23–30 the controller's. Each is restated with where it lands.

1. **OpenAI Compatible is retired, not ported.** No definition, settings view, check or wire dialect: the adapter needs no dialect parameter. A stored `openai_compatible` selection falls to the first offered provider through the existing `selectionFromStored` (no new code); its stored slice is left as it is. Its old code and the `openai-realtime-api` dependency leave with the later deletion plan. A stated departure: a released provider withdrawn. Lands in: Task 12 (nothing registered; the loader's fallback pinned; the "unregistered provider" cases moved to it), Task 3 (the `i18nKey` comment naming it corrected), Task 13 (the departure; the inventory).
2. **The drift anchor is kept** (parity): an out-of-band (`conversation: 'none'`), text-only `response.create` carrying the session's instructions at session start and after every 5 completed translations; its output discarded (never a segment, never audio); not `busy`, never blocking the queue; framed so the live test sees it and its cost (survey §1.13). Lands in: Task 6 (`anchorResponse`, `isOutOfBand`), Task 7 (no segment), Task 11 (choice 11), Task 13 (live-test item 4).
3. **Karaoke by arrival, as OpenAI Translate's choice 6:** a played frame's range is `[the previous played frame's end, the translation text's length when the frame arrives]` — an alignment by arrival, the honesty rule's stated exception. Lands in: Task 7 (choice 9), Task 13 (the spec's "Risks").
4. **The participant's automatic detection is the user's own detection settings** (Gemini's precedent), not the old forced semantic VAD at high eagerness (`ProviderDescriptor.ts:389-407`). Lands in: Task 5 (`buildRealtime` reads no leg), Task 12, Task 13.
5. **No one-time migration code.** The turn-mode migration is not changed: OpenAI's stored `'Disabled'` (its push-to-talk) keeps mapping to automatic, and those users pick push-to-talk again once — a stated departure. `S`'s `migrate` validates stored fields as every provider's does, and the plan adds no code whose only use is converting old stored values once. Lands in: Task 5 (choice 4), Task 13.
6. **Temperature is removed:** not in `S`, not shown, not sent (the GA endpoint takes none; the old slider did nothing, `SDK:2547-2648`). Lands in: Task 4 (the field without it), Tasks 5, 6, 10.
7. **"Auto-detect" stays a source:** the template names it "the spoken language", no transcription hint, Both refused (D20; survey Q9). Lands in: Task 5.
8. **Queues:** typed text waits first-in-first-out (all of it, each shown at once), and a push-to-talk release's `response.create` waits until the active response ends; the adapter owns the queue, so `busy` needs no reader (the roadmap's "busy's reader" item closes). Lands in: Task 8 (`ResponseQueue`), Task 11, Task 13.
9. **Readiness narrowing:** a provider declares which settings its check reads, so an edit to any other setting (a slider, the prompt) no longer turns Start off pending an 800 ms re-check. A generic change (the provider definition, `providerStore`), with a spec amendment; existing providers keep today's behaviour unless declared. Lands in: Task 3 (choice 3), Task 12 (`checkReads: []`), Task 13.
10. *(Moot: OpenAI Compatible is retired.)*
11. **The source transcript streams** (`conversation.item.input_audio_transcription.delta`) when the server sends it; the completed text still settles it. Lands in: Tasks 7, 11.
12. **WebSocket only;** a stored `webrtc` runs over WebSocket. Lands in: Task 5 (`S.transportType` kept, `C.transport: 'websocket'`; choice 18), Task 10 (no control), Task 12 (an old profile's WebRTC choice).
13. **A mid-session `error` is a Logs line,** its words kept for a close within `ERROR_WORDS_MS`, a negative age ignored (OpenAI Translate's ruling 3 and its final fix). Lands in: Task 11 (choice 14).
14. **A drop or the 60-minute cap ends the run in words,** with no reconnect. Lands in: Tasks 6, 11 (choice 14).
15. **The participant speaks on its switch.** Nothing to build: the definition sets no `participantSpeech`. Lands in: Task 12.
16. **Noise reduction "None" sends `null`.** Lands in: Tasks 5, 6.
17. **A restricted key's 403 stays parity** (the auth words, Start off) until OpenAI Translate's live test answers it. Lands in: Task 9.
18. **The registry order:** `['kizunaai_soniox', 'localInference', 'gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'soniox']`, unflagged; OpenAI Translate's order pin moves. Lands in: Task 12.
19. **The OpenAI setup guide.** Lands in: Task 12.
20. **Deletion timing:** one later plan, merged with OpenAI Translate's T3, after the WebRTC step's live test. Lands in: Task 13 (choice 23).
21. **Naming the leg in `SessionContext` stays out:** a same-language pair makes both legs read Other's prompt, Gemini's stated departure. Lands in: Task 13.
22. **The GA start resolves on `session.updated`,** bounded at 30 s. Lands in: Task 11 (choice 6).
23. **Exact pairing by item ids** (survey §0.5): each input item — a VAD or manual commit's `item_id`, a typed text's own id — is an origin; the assistant item's `previous_item_id` names it; the fallback is the newest unanswered input at `response.created`. The translation states its `origin`; an utterance spoken over a playing translation that never gets a response is an unpaired source row. Lands in: Task 7 (choice 8), Task 11.
24. **Lift the shared pieces now due:** the base64 helpers (third user) and the bounded-fetch skeleton (fourth), their existing users switched in the same tasks, byte for byte, each with its tests; and decide whether the kit-level seeded lifecycle scenario lands here or waits for the WebRTC step. Lands in: Tasks 1, 2 (choices 1, 2), Task 8 (choice 21).
25. **The socket seam** with the fixed-words rethrow and protocols (OpenAI Translate's `socket.ts`); the key in the `openai-insecure-api-key.` subprotocol; `redact()` already covers it. Lands in: Tasks 4, 6 (choice 7).
26. **`check`: the bounded `/v1/models` call,** ids starting `gpt-realtime` less `-whisper` / `-translate`; the existing aliases (`no_realtime_model`, `region_unsupported`); no new locale key. Lands in: Task 9 (choice 16).
27. **The Settings view from the shared fields,** plus the provider's own transcription field (model and keywords), reasoning-effort field and `TurnDetection` slot; match sibling markup. Lands in: Tasks 4, 10 (choice 17).
28. **Frames, their Logs grouping (consecutive only), and the hot-path rule;** the drift anchor's frames. Lands in: Task 4 (the Logs pin), Task 11 (choice 13).
29. **Timers on the request's clock only.** Lands in: Task 11 (the start's bound and the error window are the only ones; the queue's `waitedMs` reads `clock.now()`).
30. **The last task is the controller's docs task** (Task 13): the spec's amendments — survey §3.7's corrections, Compatible's retirement, the readiness narrowing, exact pairing for OpenAI, the drift anchor, arrival karaoke's exception — and the roadmap section "Scheduled by the Stage 2 OpenAI Realtime plan", with the owner's live test and the deletion inventory.

## Choices this plan makes inside the rulings

Cited as *choice N*.

1. **The pcm base64 helpers lifted to `src/lib/contract/pcm64.ts`** (ruling 24): `pcmToBase64` and `base64ToPcm`, byte for byte Gemini's (its Translate copy is identical). Gemini's and Translate's wires import `pcmToBase64` for their own frames and **re-export both**, so every importer of theirs — the two adapters, Translate's fixtures, five suites — is unchanged; OpenAI Realtime's adapter and wire import the lib directly. The lib's own test pins the view offset, the byte order, a round trip past one 32 KiB step, the odd trailing byte and text that is not base64.
2. **The bounded check request lifted to `src/lib/provider/boundedFetch.ts`** (ruling 24): `boundedFetch({ clock, ms, signal, late }, run)` — the caller's abort before anything starts, an `AbortController` the caller's signal and the bound both abort, the late words when the bound fired, the timer cancelled and the listener removed however `run` settles. Soniox's, Gemini's and OpenAI Translate's checks keep their constants and their words, and run their bodies inside it; their `check.test.ts` suites, unchanged, are the net (the 14 999 ms bound, the abort, the already-aborted caller, the cancelled timer). `lib/provider`, not `lib/contract`: it is the settings side's, and no session code runs it.
3. **The readiness narrowing's shape** (ruling 9): `Provider.checkReads?: readonly (keyof S & string)[]`. In `providerStore.updateSettings`, readiness is forgotten when `checkReads` is absent (every edit, as before), when the patch names a field it lists, or when the edit moved the run's pair (the check reads the pair); otherwise the ready answer stands — no `unknown`, so the readiness driver schedules nothing. In `refreshReadiness` the kept answer is keyed on the listed fields alone, so a run started after an unrelated edit is served from it with no request. Credentials, legs and the pair forget as before. A registry invariant holds every name to a field of the provider's defaults. OpenAI Realtime declares `[]`; no other provider declares anything here — Gemini, Translate, Soniox and Doubao are candidates for a later edit ("What this plan leaves").
4. **Nothing converted, and no new stored key** (ruling 5): the automatic mechanism stays stored as it always was, `turnDetectionMode`, now `'Normal' | 'Semantic'` alone — a stored push mode (`'Disabled'`, `'Push-to-Translate'`) is not a mechanism and reads as `'Normal'`, as any invalid value falls to its default. So `S` needs no `autoDetection` field and no `legacyKeys` entry for it (the survey's §2.3 plan), and the spec's "becomes its `autoDetection`" is amended to say so. `migrateDeprecatedOpenAIModel` is **not** copied: it only converts old stored ids. A stored pre-2.1 model runs as stored while OpenAI still lists it; once the check stops listing it, `effectiveRealtimeModel` runs the default model (`gpt-realtime-2.1-mini`) when it is listed, else the newest listed — a rule at use, nothing written back. A stated departure: an unlisted stored model runs as the default model, so a full `gpt-realtime` user lands on the mini one, and a `gpt-realtime-mini` user may land on the full model when the default is not listed (the old load mapped `gpt-realtime-mini` to `gpt-realtime-2.1-mini` and a full model to `gpt-realtime-2.1`, `settingsStore.ts:556-588`). The Electron `maxTokens` string is read as its number (Gemini's ruling 10): that is how `SettingsService` reads it back every time, not a one-time conversion. The instructions keep Gemini's legacy read of the global copy (`INSTRUCTION_LEGACY_KEYS`), the rule every port that owns instructions follows.
5. **What is copied, and why** (the Translate plan's choice 4 rule): `transcription.ts` — `OTC`'s pure helpers (`supportsTranscriptionContext`, `normalizeTranscriptionLanguage`, `parseTranscriptionKeywords`, and `buildTranscriptionHint`, the old `buildInputAudioTranscription` with a required model), less `retargetTranscriptionLanguage` / `reverseTranscriptionDirection`: the builder takes each leg's own direction (D17), so the participant's hint is built for the language it hears; its cases move with it, the reverse helpers' dropped. `wire.ts` — `unwrapTranslationText` (from `src/utils/textUtils.ts`, only the old clients' import), and OpenAI Translate's `decodeServerEvent`, `errorCode` and `errorWords` (with one more code, choice 14): two users each, and lifting them would edit Translate before its live test. `socket.ts` — Translate's seam, copied, to move to `src/lib/contract/` with the others when F14 lands.
6. **The start** (ruling 22): `session.created` sends `session.update`, and the start resolves on `session.updated` — the configuration confirmed, where the old client sent it unconfirmed and a refused one ran on the server's defaults with no translator instructions (survey §1.21.1). An `error` before it rejects with its code and OpenAI's words (choice 14). `START_TIMEOUT_MS` = 30 s on the request's clock, closing the socket on every path — `network` when the socket never opened ("OpenAI did not open the connection within 30 s."), `server` when it did ("OpenAI did not start the session within 30 s."); a socket that fails before it opens is `network`, `NEVER_OPENED` ("OpenAI's socket did not open (check the network, and that the API key is still valid)."); a close after it opened and before the start is `server`, "OpenAI closed the connection before the session started (<code> <reason>)." — OpenAI Translate's words, as landed.
7. **The key's path** (ruling 25): `wire.ts`' `realtimeProtocols(k)` returns `['realtime', 'openai-insecure-api-key.<key>']` — never the beta tag — and is the one function in `wire.ts` that names the key (Translate's TypeScript-AST scan, with its two evasions); `adapter.ts` passes the credentials to it without reading them. The provider's own `socket.ts` rethrows a constructor failure as `The browser would not open the socket (<name>).`. The URL and the subprotocols are pinned against `OpenAIRealtimeWebSocket` itself, built as `GAC:144-150` built it, over a stubbed `WebSocket` (`wire.oracle.test.ts`) — for three model ids. `redact()`'s carrier rule already masks the subprotocol; its comment gains the new producer (Task 4).
8. **The pairing machine, `items.ts`** (ruling 23), pure and timer-free — the server's events open and close every segment:
   - an input item opens a source segment under its item id, empty (no row until text, `cut.ts:59-60`), at `input_audio_buffer.committed`; its transcript deltas stream into it (ruling 11); the completed transcript replaces the text if it differs, and closes it; a failed transcription closes it as it stands;
   - typed text is opened, written and closed at once under the adapter's own item id, before its item goes up (spec: "`appendText` is answered by the adapter"), and becomes *known* to the server when `conversation.item.added` names it;
   - a translation opens lazily — at its assistant item's `conversation.item.added`, which the GA server sends before any content, or at its first content otherwise — with its origin: the input its `previous_item_id` names when this leg opened that input; else its response's fallback, taken at `response.created`: the newest input the server holds that no translation has named yet (a typed text still queued is not one); else none. The input is then *answered*. An assistant item announced before its output item (the SDK leaves the order undocumented) takes as its response the one in-band response still running — none is guessed between two — so the fallback still finds it;
   - a translation closes at `response.output_item.done`, and any still open at its `response.done`, whatever the status;
   - **an input no response answers** — an utterance spoken over a playing translation, which the server may leave unanswered under `interrupt_response: false` (`SDK:1172-1178`) — stays a source row of its own, paired with nothing; the next response's `previous_item_id` names the next input, not it. Pinned through the projection (Task 11): the three rows read stated, stated with no translation, stated;
   - a response out of band makes no segment.
9. **Karaoke by arrival** (ruling 3): a played frame's range is `[the previous played frame's end, the text's length at its arrival]`, ascending from 0, `[0, 0]` for audio before any text; a frame for a translation already closed plays with no ref. The final text (`.done`, trimmed and unwrapped, choice 5) may be shorter than what streamed: it replaces the text, every range past its end is stated again within it through one `speechRanges`, and the next frame starts there — so no range is ever outside the text L1 holds (the kit's `range-in-text`).
10. **The queue, `queue.ts`** (ruling 8), pure: `push` sends at once when no in-band response is active or asked for, else holds the request first in first out and frames `response.queued`; `created(responseId, request)` marks the response active and clears the request asked when the response names it back — the in-band `response.create` carries `metadata: { request: <event id> }`, told apart from a response the server's own detection created; `done` clears the active response **and the request asked** (the server answers a `response.create` at once, so by the next end it was created or refused — the backstop for a server that does not echo the metadata) and sends the next; `refused(eventId, code)` — a server `error` naming the request asked with `conversation_already_has_active_response` puts it back at the head (the detection answered first), any other refusal naming it, or one naming nothing, drops it; `stop` sends nothing more. A typed text's item goes up once, however often its response is asked. `busy(true)` / `busy(false)` follow the in-band responses (spec: "which is what `busy` reports"); nothing reads it, and ruling 8 closes the reader item. A seeded test (400 runs) pins, under its stated model — the server answers a request at once; a response ends only after the client heard what came before it — that every request is answered exactly once, in push order, whether or not the server echoes the metadata.
11. **The anchor** (ruling 2): at `session.updated`, and after every in-band `response.done` whose status is `completed` when the count is a positive multiple of `ANCHOR_EVERY` (5), once per count: `response.create` with `event_id`, `conversation: 'none'`, `output_modalities: ['text']`, the leg's instructions when not blank (`ORS:189-206` sent them only then), and `metadata: { purpose: 'anchor' }` (the old `sessionType` is dropped: the adapter does not know its leg). Never on a closed socket; framed `response.anchor` `{ eventId, translations }`; its own `response.created` and `response.done` framed with `outOfBand: true`, the latter with `usage` — the cost the live test reads. It is no request of the queue's: a typed text or a release's response is sent while it runs, and its end clears nothing (pinned, with once per count, in Task 11's anchor case). Each leg anchors itself.
12. **Turns:** under manual turns `endTurn` sends `input_audio_buffer.commit` at once — the press's audio becomes an input item before a next press can append — and queues its `response.create`; `cancelTurn` sends `input_audio_buffer.clear` (spec: "An empty OpenAI press … — `cancelTurn` clears it"); `beginTurn` sends nothing over WebSocket. Under automatic turns the keys send nothing.
13. **Frames and the Logs** (ruling 28): the list in Global Constraints. Received audio is framed by size (`samples`), never content, as Gemini's and Translate's are; appends are not framed. `logStore.ts` needs no row: Task 4 pins that its `.delta` rule groups each of the four delta types under its own name, and that none of the other names takes a key.
14. **Failures in words and codes** (rulings 13, 14): a server `error`'s code — OpenAI Translate's mapping (`invalid_api_key` → `auth`; `rate_limit_exceeded` / `insufficient_quota` → `rate_limit`; `invalid_request_error` → `client`; else `server`) with one more: `session_expired`, the 60-minute cap, → `segment_ended` ("This segment has ended — tap Start Session to continue.") — a hypothesis live-test item 12 settles. Its words `[OpenAI <code, else type>] <message>`. Before the start it refuses the start; mid-session it is a `session.error` frame. **`session_expired` ends the run at once as `segment_ended`**, whether or not the server closes the socket after it; any other is remembered with its time — except `conversation_already_has_active_response`, routine, which the queue asks again (choice 10) and which is never the words of a close — and handed to the queue; a close within `ERROR_WORDS_MS` (10 000) of a remembered error fails the run with its code and words, a negative age — a wall clock stepped back — is not recent (Translate's `04fc530d`); any other unexpected close fails with `connection_lost`; nothing reconnects. A `response.done` whose status is `failed` closes its translation and frames its `status_details`; it neither fails nor degrades the run.
15. **Decoding:** `binaryType = 'arraybuffer'`; a frame is text or an ArrayBuffer of a JSON object with a string `type`. An unreadable frame is framed `session.unreadable` and said `parse_error` on the ok → failing transition only, re-armed by the next frame that parses; an audio delta whose base64 will not decode, or that carries no string, is its own episode (Translate's choice 17 and its `426251e1`).
16. **The check** (ruling 26): `GET https://api.openai.com/v1/models` with `Authorization: Bearer <key>` and nothing else, inside `boundedFetch` (`CHECK_TIMEOUT_MS` = 15 s) on an injected `fetch` and clock. It answers: ids `isRealtimeModelId` accepts (`OAC:250-259`: starting `gpt-realtime`, not `gpt-realtime-whisper` or `gpt-realtime-translate`, case-insensitive) → ready, newest `created` first, each id once; none → `no_realtime_model`; `unsupported_country_region_territory` at any status → `region_unsupported`; 401 or 403 → `auth` with `HTTP <status>: <OpenAI's message>` (ruling 17); 429 → `rate_limit`; any other status, a failed fetch, the bound or the abort → it throws. `gpt-audio*` ids, which the old list fetched and never showed, are not listed.
17. **The view** (ruling 27): `RealtimeSettingsView` composes, in the old order (`PSS:2185-2282`), `InstructionsField` (its preview for the pair, Quick's template), `VoiceField`, `ModelField` (the effective model, no refresh button — Gemini's choice 22), `TranscriptionField` (new, in the folder: the old section, `PSS:886-954`, its keywords shown for the context-capable models alone), `NoiseReductionField`, `ModelConfigurationField` with the max tokens alone (its temperature optional now, Task 4), and `ReasoningEffortField` (new, in the folder: `PSS:1044-1084`, drawn for a `gpt-realtime-2*` effective model alone). `TurnDetection`: **Summary** one line of existing words ("Normal · Threshold 0.49 · Silence duration 0.50s" / "Semantic · Eagerness Auto"), **Help** the old `settings.turnDetectionTooltip`, **Controls** under the VAD heading as Gemini's (`#openai-vad-section`): the Normal / Semantic buttons, then Normal's three sliders or Semantic's eagerness, with the old ranges and markup (`PSS:508-719`, the push modes and the WebRTC notice dropped). The new selects gain an `aria-label`, as the shared fields' have — the one markup delta from the old tab.
18. **`C.transport: 'websocket'`, and `S.transportType` kept** (ruling 12): read and validated, shown nowhere, unread by `build`; the adapter's `info.transport` reads `C.transport`, so the WebRTC step widens it, adds a transport and a dispatch in `start`, and applies D25's `turns(s)`.
19. **The key is trimmed:** a pasted key with a trailing newline or space is no valid subprotocol token. The missing words are the runner's `credentials_missing`.
20. **`describe(c)` = `{ translationModel: c.model, asrModel: c.transcription.model }`:** the source transcript runs on its own model. The old start event named no model for OpenAI.
21. **The kit-level seeded lifecycle scenario waits for the WebRTC step** (ruling 24): its assertions (OpenAI Translate's "What it leaves") are mostly Translate's tail — the 4 800-sample grid, `turn.tail_end`'s timing — and its purpose is to hold a second transport of one provider to the first one's guarantees; the WebRTC step is its first real user. What this adapter adds that such a scenario would catch — requests lost or doubled across interleavings of presses, typed text, the server's own detection and refusals — lands here as the queue's own seeded test (choice 10), pure and cheap, with no kit API to design for one user.
22. **The definition:** the old id and slice (`openai`); `speech: 'optional'` (a leg that does not speak asks for text alone — the API's own, as the old `textOnlyCapability: 'optional'`); `textInput: true`; `boundaries: () => 'provider'` (the server's commits and responses end segments — the old offer, Auto — and cutting by sentences is offered too, spec "Segmentation is one fact"); `turns: () => ['auto', 'manual']`; no `participantSpeech`, no `flagged`, no `i18nKey`, no `session` hooks; `checkReads: []`.
23. **The deletion inventory merges with OpenAI Translate's T3** (ruling 20): the old OpenAI and Compatible code, `textUtils.ts`, `openaiTranscriptionContext`, the `openai-realtime-api` dependency, the two slices' readers and the old UI's branches, after the WebRTC step's live test — `OpenAITranslateGAClient` imports `OAC`'s statics, and `OpenAIWebRTCClient` (the WebRTC step's source) imports `ORS` and `EphemeralTokenService.getToken`. Task 13 records it.
24. **Typed text:** trimmed; blank is nothing; dropped while the leg is not live (there is no session object before, and nothing after its end).

## What this plan consumes from the earlier plans

Named as landed, so a reconciliation is mechanical. Where a landed name or text differs from what is quoted here, the implementer follows the landed one and reports it.

| From | What it is | Consumed by |
|---|---|---|
| The OpenAI Translate plan's Task 4 (`aed81d5f`, fix round `bbf16f39`): `socket.ts` (`nativeSocket(url, protocols)`, the fixed-words rethrow, `WS_OPEN`), `translateProtocols` and its AST scan, `decodeServerEvent`, `errorCode`, `errorWords`, the copies of `pcmToBase64` / `base64ToPcm` | the seam, the one reader of the key, the words | Task 1 (the copies lifted), Task 6 (the rest copied, choice 5) |
| The OpenAI Translate plan's Task 7 (`580bd8cd`) and the Soniox and Gemini checks: the bounded-fetch skeleton | the bounded request | Task 2 (lifted), Task 9 |
| The OpenAI Translate plan's Task 9 (`49727661`, fix round `426251e1`) and its final fix (`04fc530d`): the leg — `phase`, `opened`, `refuse`, `end`, `shutDown` nulling the socket's four handlers, the abort listener removed once the start settles, `START_TIMEOUT_MS`, `NEVER_OPENED`, `ERROR_WORDS_MS`, `recentError` refusing a negative age, the two unreadable latches, an audio delta with no string as unreadable | the adapter's skeleton | Task 11 |
| The OpenAI Translate plan's Task 5 (`d78a0920`): a played frame's range `[previous end, text length]` | arrival karaoke | Task 7 |
| The OpenAI Translate plan's Tasks 1 and 2 (`914a65a0`, `fee5aa77`): `redact()`'s `openai-insecure-api-key.` carrier rule; the `region_unsupported` alias; `NoiseReductionField` | the redaction, the words, the noise field | Tasks 4, 9, 10 |
| The Gemini plan's Tasks 1, 5, 6, 8 (`f979db5c`, `cde89c9e`, `ae825930`, `ac364106`) and 75a5c343: `InstructionsSettings`, `INSTRUCTIONS_DEFAULTS`, `INSTRUCTION_LEGACY_KEYS`, `migrateInstructions`, `resolveInstructions`; the `maxTokensOf` rule (its ruling 10); the effective-model rule; `InstructionsField`, `VoiceField`, `ModelField`, `ModelConfigurationField`; the `TurnDetection` Summary / Help / Controls shape under the VAD heading; the `no_realtime_model` and `models_required` aliases | instructions, fields, turn detection, words | Tasks 4, 5, 9, 10 |
| The Volcengine AST2 plan's Task 12 (`e4ec0d34`) and final fix wave (`7f3dded6`): `trackedClock` in the kit; the fixed-words rethrow | the tracked clock; the seam's words | Tasks 6, 11 |
| The foundation and the kit: `FakeSocket` (records `url` and `protocols`; `open`, `receive`, `drop`, `serverClose`, `sentJson`, `closedByClient`), `fakeSockets`, `driveAdapter`, `runScenario`, `scenarioNames`, `recordEvents`, `framePayload`, `AdapterStartError`; `selectionFromStored`; the readiness driver (`src/app/readiness.ts`), which schedules a check only while readiness is `unknown` | the kit, the loader's fallback, the driver | Tasks 3, 6–12 |
| The OpenAI Translate plan's Task 10 (`670b9ac1`): `RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, openaiTranslateProvider, sonioxProvider]`, its order pins, `ownKeyOptions('understand-others')` → `['gemini', 'volcengine_ast2', 'openai_translate', 'soniox', 'fake']` | the registry and its pins | Task 12 inserts `openaiProvider` before `openaiTranslateProvider` and narrows Translate's case |

## File Structure

| File | Task | Change |
|---|---|---|
| `src/lib/contract/pcm64.ts` (+ test), `src/providers/{gemini,openai_translate}/wire.ts` | 1 | the base64 helpers lifted; the two wires re-export them |
| `src/lib/provider/boundedFetch.ts` (+ test), `src/providers/{soniox,gemini,openai_translate}/check.ts` | 2 | the bounded request lifted; the three checks run inside it |
| `src/lib/provider/types.ts`, `src/stores/providerStore.ts`, `src/stores/providerStore.readiness.test.ts`, `src/providers/registry.test.ts` | 3 | `checkReads`, the narrowing, its cases, its invariant |
| `src/components/providers/fields/ModelConfigurationField.tsx` (+ test), `src/stores/logStore.test.ts`, `src/lib/diagnostics/redact.ts` | 4 | the temperature optional; the Logs pin; the redaction's comment |
| `src/providers/openai/{adapter,settings,transcription,config}.ts` (+ `settings.test.ts`, `transcription.test.ts`, `config.test.ts`) | 5 | the seed; `S`, languages, voices, `K`, the effective model; the hints; `C`, the builder |
| `src/providers/openai/{wire,socket,testing}.ts` (+ `wire.test.ts`, `socket.test.ts`, `wire.oracle.test.ts`) | 6 | the wire, the seam, the fixtures |
| `src/providers/openai/items.ts` (+ test) | 7 | items → segments |
| `src/providers/openai/queue.ts` (+ test) | 8 | the response queue |
| `src/providers/openai/check.ts` (+ test) | 9 | the bounded model list |
| `src/providers/openai/{RealtimeSettings,RealtimeTurnDetection,TranscriptionField,ReasoningEffortField}.tsx` (+ `RealtimeSettings.test.tsx`, `RealtimeTurnDetection.test.tsx`) | 10 | the view |
| `src/providers/openai/adapter.ts` (replaced), `adapter.test.ts`, `testing.ts` (the harness), `src/providers/sessionSide.consistency.test.ts` | 11 | the adapter |
| `src/providers/openai/provider.ts` (+ test), `src/providers/registry.ts` (+ test), `src/providers/openai_translate/provider.test.ts`, `src/components/SetupWizard/{providerPaths,useApplySetup}.test.ts`, `src/components/SetupWizard/SetupWizard.test.tsx`, `src/app/loadStores.test.ts` | 12 | the definition, registered; the pins moved |
| the spec, the roadmap | 13 | the controller's amendments and record |

**Order and parallelism.**
- **Wave 1:** Tasks 1–5. Disjoint files. Task 5 writes its `adapter.ts` seed before any other file of the new folder: the session-side guard requires an `adapter.ts` in every folder under `src/providers`. A concurrent task that still sees "every provider keeps its adapter in adapter.ts" fail names it as Task 5's work in progress and does not touch the guard.
- **Wave 2:** Task 6 (needs Tasks 1, 5), Task 7 (the contract alone), Task 8 (the contract alone), Task 9 (Tasks 2, 5), Task 10 (Tasks 4, 5). Disjoint files: Task 6 alone writes `testing.ts`, and no other Wave 2 test imports it.
- **Wave 3:** Task 11 (needs Tasks 6, 7, 8; replaces the seed, appends the harness to `testing.ts`).
- **Group check A** (controller) after Wave 3: the adapter, the check and the view are complete; nothing is registered.
- **Wave 4:** Task 12 (needs Tasks 3, 9, 10, 11).
- **Group check B** (controller) after Wave 4.
- **Task 13** (controller) last.

---
### Task 1: Lift the pcm base64 helpers to the contract (Wave 1)

**Files:**
- Create: `src/lib/contract/pcm64.ts`, `src/lib/contract/pcm64.test.ts`
- Modify: `src/providers/gemini/wire.ts`, `src/providers/openai_translate/wire.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `pcmToBase64(pcm: Int16Array): string` and `base64ToPcm(data: string): Int16Array` in `src/lib/contract/pcm64.ts` (choice 1). `gemini/wire.ts` and `openai_translate/wire.ts` keep exporting both names (re-exported), so their importers are untouched.

- [ ] **Step 1: Write the failing test.** Create `src/lib/contract/pcm64.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { base64ToPcm, pcmToBase64 } from './pcm64';

const bytesOf = (b64: string) => atob(b64).split('').map((c) => c.charCodeAt(0));

describe('pcm as base64 (Stage 2 OpenAI Realtime, choice 1)', () => {
  it("encodes a view's own bytes, never its backing buffer's, little-endian", () => {
    const backing = new Int16Array([7, 1, -2, 300, 9]);
    const view = backing.subarray(1, 4);
    expect(Array.from(base64ToPcm(pcmToBase64(view)))).toEqual([1, -2, 300]);
    expect(bytesOf(pcmToBase64(new Int16Array([0x0102])))).toEqual([0x02, 0x01]);
  });

  it('round-trips pcm past one step of the encoder (over 0x8000 bytes)', () => {
    const original = new Int16Array(20_000);
    for (let i = 0; i < original.length; i++) original[i] = (i % 4001) - 2000;
    expect(Array.from(base64ToPcm(pcmToBase64(original)))).toEqual(Array.from(original));
  });

  it('drops an odd trailing byte, reads nothing as empty pcm, and throws on text that is not base64', () => {
    expect(Array.from(base64ToPcm(btoa('\x01\x00\x02\x00\x03')))).toEqual([1, 2]);
    expect(base64ToPcm('')).toHaveLength(0);
    expect(pcmToBase64(new Int16Array(0))).toBe('');
    expect(() => base64ToPcm('!!not base64!!')).toThrow();
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run src/lib/contract/pcm64.test.ts`
Expected: FAIL — `Failed to resolve import "./pcm64"`.

- [ ] **Step 3: Write the helpers.** Create `src/lib/contract/pcm64.ts` — Gemini's two functions, byte for byte:

```ts
/**
 * The contract's pcm as the base64 a JSON wire carries it (Gemini's
 * `realtimeInput.audio`, OpenAI's `input_audio_buffer.append` and output
 * audio deltas): little-endian Int16, as the platforms are. Written first in
 * Gemini's wire, copied into OpenAI Translate's, and lifted here at its
 * third user, OpenAI Realtime (Stage 2 OpenAI Realtime, choice 1). Pure.
 */

/** Base64 of the view's own bytes, never its backing buffer's (the old fork encoded the whole buffer); in 32 KiB steps, which `String.fromCharCode` spreads safely. */
export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Base64 of little-endian Int16 as pcm; an odd trailing byte is dropped, where the old decoders threw. Throws on text that is not base64. */
export function base64ToPcm(data: string): Int16Array {
  const binary = atob(data);
  const even = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(even);
  for (let i = 0; i < even; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}
```

- [ ] **Step 4: Switch the two wires to it.** In `src/providers/gemini/wire.ts`:

```diff
--- a/src/providers/gemini/wire.ts
+++ b/src/providers/gemini/wire.ts
@@ -11,8 +11,12 @@
   LiveServerContent, LiveServerGoAway, LiveServerSessionResumptionUpdate, LiveServerSetupComplete, UsageMetadata,
 } from '@google/genai';
 import { SAMPLE_RATE } from '../../lib/contract/adapter';
+import { pcmToBase64 } from '../../lib/contract/pcm64';
 import type { GeminiConfig } from './config';
 
+/** Lifted to the contract at their third user (Stage 2 OpenAI Realtime, choice 1); re-exported, so this wire's importers are unchanged. */
+export { base64ToPcm, pcmToBase64 } from '../../lib/contract/pcm64';
+
 /** The documented Live endpoint, `v1beta` (choice 11): the SDK writes `…com//ws/…`. */
 export const GEMINI_LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
 
@@ -89,14 +93,6 @@
   };
 }
 
-/** Base64 of the view's own bytes, never its backing buffer's (survey §1.16.2); little-endian, as the platforms are. */
-export function pcmToBase64(pcm: Int16Array): string {
-  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
-  let binary = '';
-  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
-  return btoa(binary);
-}
-
 export function audioFrame(pcm: Int16Array): string {
   return JSON.stringify({ realtimeInput: { audio: { data: pcmToBase64(pcm), mimeType: INPUT_MIME } } });
 }
@@ -136,15 +132,6 @@
   return parsed as GeminiServerMessage;
 }
 
-/** A model audio part's pcm (little-endian Int16); an odd trailing byte is dropped (survey §1.16.3). */
-export function base64ToPcm(data: string): Int16Array {
-  const binary = atob(data);
-  const even = binary.length - (binary.length % 2);
-  const bytes = new Uint8Array(even);
-  for (let i = 0; i < even; i++) bytes[i] = binary.charCodeAt(i);
-  return new Int16Array(bytes.buffer);
-}
-
 /** Gemini's own documented Live output rate — independent of the contract's `SAMPLE_RATE`, which describes the input the client sends. */
 const GEMINI_OUTPUT_RATE = 24000;
 
```

In `src/providers/openai_translate/wire.ts`:

```diff
--- a/src/providers/openai_translate/wire.ts
+++ b/src/providers/openai_translate/wire.ts
@@ -11,9 +11,13 @@
   RealtimeTranslationInputAudioBufferAppendEvent,
   RealtimeTranslationSessionUpdateEvent,
 } from 'openai/resources/realtime/realtime';
+import { pcmToBase64 } from '../../lib/contract/pcm64';
 import type { TranslateConfig } from './config';
 import type { TranslateCredentials } from './settings';
 
+/** Lifted to the contract at their third user (Stage 2 OpenAI Realtime, choice 1); re-exported, so this wire's importers are unchanged. */
+export { base64ToPcm, pcmToBase64 } from '../../lib/contract/pcm64';
+
 /** The translations endpoint (`OpenAITranslateGAClient.ts:23`); the model rides in its query, fixed at creation. */
 export const TRANSLATE_WS_URL = 'wss://api.openai.com/v1/realtime/translations';
 
@@ -57,14 +61,6 @@
   };
 }
 
-/** Base64 of the view's own bytes, never its backing buffer's; little-endian, as the platforms are. Copied from Gemini's wire (choice 8). */
-export function pcmToBase64(pcm: Int16Array): string {
-  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
-  let binary = '';
-  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
-  return btoa(binary);
-}
-
 /** One chunk as it goes up: 24 kHz PCM16 mono, the contract's own rate — no resampling (SDK: "base64-encoded 24 kHz PCM16 mono little-endian"). */
 export function appendFrame(pcm: Int16Array): string {
   const frame: RealtimeTranslationInputAudioBufferAppendEvent = { type: 'session.input_audio_buffer.append', audio: pcmToBase64(pcm) };
@@ -91,15 +87,6 @@
   return parsed as ServerEvent;
 }
 
-/** An output audio delta's pcm (little-endian Int16); an odd trailing byte is dropped, where the old decoder threw (survey §1.14.10). Copied from Gemini's wire (choice 8). */
-export function base64ToPcm(data: string): Int16Array {
-  const binary = atob(data);
-  const even = binary.length - (binary.length % 2);
-  const bytes = new Uint8Array(even);
-  for (let i = 0; i < even; i++) bytes[i] = binary.charCodeAt(i);
-  return new Int16Array(bytes.buffer);
-}
-
 /** The rate an output audio delta that names none is taken at: PCM16 at 24 kHz, the old client's default (`OpenAITranslateGAClient.ts:604`). */
 export const OUTPUT_RATE = 24_000;
 
```

- [ ] **Step 5: Run the lib's test and every user's suite.**

Run: `npx vitest run src/lib/contract/pcm64.test.ts src/providers/gemini src/providers/openai_translate`
Expected: PASS — 23 files, 317 tests. The two providers' suites, unchanged, are the net: their adapters and Translate's fixtures import the helpers from their wires, which re-export the lifted ones.

- [ ] **Step 6: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/contract/pcm64.ts src/lib/contract/pcm64.test.ts src/providers/gemini/wire.ts src/providers/openai_translate/wire.ts
```

```bash
git commit -q -F - -- src/lib/contract/pcm64.ts src/lib/contract/pcm64.test.ts src/providers/gemini/wire.ts src/providers/openai_translate/wire.ts <<'EOF'
refactor(contract): lift the pcm base64 helpers at their third user

Gemini and OpenAI Translate each carried a copy; OpenAI Realtime is the
third. Both wires re-export them, so every importer of theirs is unchanged.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 2: Lift the bounded check request (Wave 1)

**Files:**
- Create: `src/lib/provider/boundedFetch.ts`, `src/lib/provider/boundedFetch.test.ts`
- Modify: `src/providers/soniox/check.ts`, `src/providers/gemini/check.ts`, `src/providers/openai_translate/check.ts`

**Interfaces:**
- Consumes: `Clock` from `src/lib/contract/clock`.
- Produces: `interface Bound { clock: Pick<Clock, 'setTimeout'>; ms: number; signal?: AbortSignal; late: string }` and `boundedFetch<T>(bound: Bound, run: (signal: AbortSignal) => Promise<T>): Promise<T>` in `src/lib/provider/boundedFetch.ts` (choice 2). Task 9 uses it.

- [ ] **Step 1: Write the failing test.** Create `src/lib/provider/boundedFetch.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock, type Clock } from '../contract/clock';
import { boundedFetch } from './boundedFetch';

/** A request that settles only when its signal aborts, rejecting with the signal's reason, as a real `fetch` does. */
const hanging = (signal: AbortSignal) =>
  new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('aborted', 'AbortError')), { once: true });
  });

/** A virtual clock whose cancel functions are spied: a settled request proves its timer was cancelled, not merely left to fire. */
function spiedClock(): { clock: Pick<Clock, 'setTimeout'>; advance: (ms: number) => void; cancels: ReturnType<typeof vi.fn>[] } {
  const inner = createVirtualClock(0);
  const cancels: ReturnType<typeof vi.fn>[] = [];
  return {
    clock: { setTimeout: (fn, ms) => { const spy = vi.fn(inner.setTimeout(fn, ms)); cancels.push(spy); return spy; } },
    advance: inner.advance,
    cancels,
  };
}

const LATE = 'The provider did not answer within 15 s.';

describe('a bounded check request (Stage 2 OpenAI Realtime, choice 2)', () => {
  it("answers what the request answers, hands it a live signal, and cancels its timer", async () => {
    const { clock, cancels } = spiedClock();
    let seen: AbortSignal | undefined;
    await expect(boundedFetch({ clock, ms: 15_000, late: LATE }, async (signal) => { seen = signal; return 42; })).resolves.toBe(42);
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(false);
    expect(cancels[0]).toHaveBeenCalled();
  });

  it("rethrows the request's own failure untouched", async () => {
    const offline = new TypeError('Failed to fetch');
    await expect(boundedFetch({ clock: createVirtualClock(0), ms: 15_000, late: LATE }, async () => { throw offline; })).rejects.toBe(offline);
  });

  it('bounds the request: nothing within the bound, it aborts the request and throws the late words', async () => {
    const { clock, advance } = spiedClock();
    let seen: AbortSignal | undefined;
    const answer = boundedFetch({ clock, ms: 15_000, late: LATE }, (signal) => { seen = signal; return hanging(signal); });
    const settled = vi.fn();
    answer.then(settled, settled);
    advance(14_999);
    expect(seen?.aborted).toBe(false);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    advance(1);
    await expect(answer).rejects.toThrow(LATE);
    expect(seen?.aborted).toBe(true);
  });

  it("the caller's signal aborts the request with its reason, cancels the timer and leaves no listener", async () => {
    const { clock, cancels } = spiedClock();
    const caller = new AbortController();
    const removed = vi.spyOn(caller.signal, 'removeEventListener');
    const reason = new Error('cancelled');
    const answer = boundedFetch({ clock, ms: 15_000, signal: caller.signal, late: LATE }, hanging);
    caller.abort(reason);
    await expect(answer).rejects.toBe(reason);
    expect(cancels[0]).toHaveBeenCalled();
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('a caller already aborted throws its reason before the request starts', async () => {
    const run = vi.fn();
    const reason = new Error('gone');
    await expect(boundedFetch({ clock: createVirtualClock(0), ms: 15_000, signal: AbortSignal.abort(reason), late: LATE }, run)).rejects.toBe(reason);
    expect(run).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run src/lib/provider/boundedFetch.test.ts`
Expected: FAIL — `Failed to resolve import "./boundedFetch"`.

- [ ] **Step 3: Write it.** Create `src/lib/provider/boundedFetch.ts`:

```ts
/**
 * A readiness check's request, bounded (spec: "Readiness is one check" —
 * `check` bounds its own request): the skeleton Soniox's, Gemini's and
 * OpenAI Translate's checks each wrote out, lifted at its fourth user,
 * OpenAI Realtime (Stage 2 OpenAI Realtime, choice 2). `run` is handed a
 * signal that aborts when the caller's does, with its reason, or when
 * `ms` pass on `clock` with no answer — then the request throws `late`,
 * the check's own words. An already aborted caller throws its reason
 * before `run` starts. Nothing is left behind: the timer is cancelled and
 * the caller's listener removed however `run` settles. The settings side
 * only; no session code runs it.
 */
import type { Clock } from '../contract/clock';

export interface Bound {
  clock: Pick<Clock, 'setTimeout'>;
  /** How long the request may take. */
  ms: number;
  /** The caller's signal (`CheckContext.signal`); absent, only the bound aborts. */
  signal?: AbortSignal;
  /** What the request throws when the bound passes: the check's own words, naming its provider. */
  late: string;
}

export async function boundedFetch<T>(bound: Bound, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const { clock, ms, signal, late } = bound;
  if (signal?.aborted) throw signal.reason ?? new Error('aborted');
  const controller = new AbortController();
  let timedOut = false;
  const cancel = clock.setTimeout(() => { timedOut = true; controller.abort(); }, ms);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await run(controller.signal);
  } catch (error) {
    if (timedOut) throw new Error(late);
    throw error;
  } finally {
    cancel();
    signal?.removeEventListener('abort', onAbort);
  }
}
```

- [ ] **Step 4: Run the three checks inside it.** Each keeps its constant, its words and its answers; only the skeleton moves. `src/providers/soniox/check.ts`:

```diff
--- a/src/providers/soniox/check.ts
+++ b/src/providers/soniox/check.ts
@@ -6,6 +6,7 @@
  * clock by default.
  */
 import { realClock, type Clock } from '../../lib/contract/clock';
+import { boundedFetch } from '../../lib/provider/boundedFetch';
 import type { CheckContext, CheckResult } from '../../lib/provider/types';
 import { sonioxHosts } from '../../lib/soniox/regions';
 import type { SonioxCredentials, SonioxSettings } from './settings';
@@ -20,21 +21,16 @@
 
 export function createSonioxCheck(deps: SonioxCheckDeps = {}) {
   const clock = deps.clock ?? realClock;
-  return async (k: SonioxCredentials, _s: SonioxSettings, ctx: CheckContext): Promise<CheckResult> => {
-    if (ctx.signal?.aborted) throw ctx.signal.reason ?? new Error('aborted');
+  return (k: SonioxCredentials, _s: SonioxSettings, ctx: CheckContext): Promise<CheckResult> => {
     // Read at call time, so a test's stubbed global is seen.
     const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
-    const controller = new AbortController();
-    let timedOut = false;
-    const cancel = clock.setTimeout(() => { timedOut = true; controller.abort(); }, CHECK_TIMEOUT_MS);
-    const onAbort = () => controller.abort(ctx.signal?.reason);
-    ctx.signal?.addEventListener('abort', onAbort, { once: true });
-    try {
+    const late = `Soniox did not answer the key check within ${CHECK_TIMEOUT_MS / 1000} s.`;
+    return boundedFetch({ clock, ms: CHECK_TIMEOUT_MS, signal: ctx.signal, late }, async (signal): Promise<CheckResult> => {
       const response = await doFetch(`https://${sonioxHosts(k.region).api}/v1/auth/temporary-api-key`, {
         method: 'POST',
         headers: { Authorization: `Bearer ${k.stt}`, 'Content-Type': 'application/json' },
         body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 60 }),
-        signal: controller.signal,
+        signal,
       });
       if (response.status === 200 || response.status === 201) return { ok: true };
       if (response.status === 401 || response.status === 403) {
@@ -42,13 +38,7 @@
         return { ok: false, code: 'auth', reason: `HTTP ${response.status}: Soniox did not accept this key for the ${k.region.toUpperCase()} region` };
       }
       throw new Error(`Soniox answered the key check with HTTP ${response.status}.`);
-    } catch (error) {
-      if (timedOut) throw new Error(`Soniox did not answer the key check within ${CHECK_TIMEOUT_MS / 1000} s.`);
-      throw error;
-    } finally {
-      cancel();
-      ctx.signal?.removeEventListener('abort', onAbort);
-    }
+    });
   };
 }
 
```

`src/providers/gemini/check.ts`:

```diff
--- a/src/providers/gemini/check.ts
+++ b/src/providers/gemini/check.ts
@@ -8,6 +8,7 @@
  * reached by the adapter, so it may use the real clock by default.
  */
 import { realClock, type Clock } from '../../lib/contract/clock';
+import { boundedFetch } from '../../lib/provider/boundedFetch';
 import type { CheckContext, CheckResult } from '../../lib/provider/types';
 import { isGeminiLiveModel, sortGeminiModels, type GeminiCredentials, type GeminiSettings } from './settings';
 
@@ -26,21 +27,16 @@
 
 export function createGeminiCheck(deps: GeminiCheckDeps = {}) {
   const clock = deps.clock ?? realClock;
-  return async (k: GeminiCredentials, _s: GeminiSettings, ctx: CheckContext): Promise<CheckResult> => {
-    if (ctx.signal?.aborted) throw ctx.signal.reason ?? new Error('aborted');
+  return (k: GeminiCredentials, _s: GeminiSettings, ctx: CheckContext): Promise<CheckResult> => {
     // Read at call time, so a test's stubbed global is seen.
     const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
-    const controller = new AbortController();
-    let timedOut = false;
-    const cancel = clock.setTimeout(() => { timedOut = true; controller.abort(); }, CHECK_TIMEOUT_MS);
-    const onAbort = () => controller.abort(ctx.signal?.reason);
-    ctx.signal?.addEventListener('abort', onAbort, { once: true });
-    try {
+    const late = `Gemini did not answer the model list within ${CHECK_TIMEOUT_MS / 1000} s.`;
+    return boundedFetch({ clock, ms: CHECK_TIMEOUT_MS, signal: ctx.signal, late }, async (signal): Promise<CheckResult> => {
       const names: string[] = [];
       let token: string | undefined;
       for (let page = 0; page < MAX_MODEL_PAGES; page++) {
         const url = token ? `${GEMINI_MODELS_URL}?pageToken=${encodeURIComponent(token)}` : GEMINI_MODELS_URL;
-        const response = await doFetch(url, { method: 'GET', headers: { 'x-goog-api-key': k.apiKey }, signal: controller.signal });
+        const response = await doFetch(url, { method: 'GET', headers: { 'x-goog-api-key': k.apiKey }, signal });
         if (response.status === 400 || response.status === 401 || response.status === 403) {
           // Google answers a bad key with 400 INVALID_ARGUMENT and its own sentence, which `notices.auth` shows as the detail.
           const body = (await response.json().catch(() => ({}))) as { error?: { message?: unknown } };
@@ -57,13 +53,7 @@
       const live = sortGeminiModels([...new Set(names)].filter(isGeminiLiveModel));
       if (live.length === 0) return { ok: false, code: 'no_realtime_model', reason: 'This key lists no Gemini Live model.' };
       return { ok: true, models: live.map((id) => ({ id })) };
-    } catch (error) {
-      if (timedOut) throw new Error(`Gemini did not answer the model list within ${CHECK_TIMEOUT_MS / 1000} s.`);
-      throw error;
-    } finally {
-      cancel();
-      ctx.signal?.removeEventListener('abort', onAbort);
-    }
+    });
   };
 }
 
```

`src/providers/openai_translate/check.ts`:

```diff
--- a/src/providers/openai_translate/check.ts
+++ b/src/providers/openai_translate/check.ts
@@ -10,6 +10,7 @@
  * by the adapter, so it may use the real clock by default.
  */
 import { realClock, type Clock } from '../../lib/contract/clock';
+import { boundedFetch } from '../../lib/provider/boundedFetch';
 import type { CheckContext, CheckResult } from '../../lib/provider/types';
 import { isTranslateModelId, type TranslateCredentials, type TranslateSettings } from './settings';
 
@@ -27,17 +28,12 @@
 
 export function createTranslateCheck(deps: TranslateCheckDeps = {}) {
   const clock = deps.clock ?? realClock;
-  return async (k: TranslateCredentials, _s: TranslateSettings, ctx: CheckContext): Promise<CheckResult> => {
-    if (ctx.signal?.aborted) throw ctx.signal.reason ?? new Error('aborted');
+  return (k: TranslateCredentials, _s: TranslateSettings, ctx: CheckContext): Promise<CheckResult> => {
     // Read at call time, so a test's stubbed global is seen.
     const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
-    const controller = new AbortController();
-    let timedOut = false;
-    const cancel = clock.setTimeout(() => { timedOut = true; controller.abort(); }, CHECK_TIMEOUT_MS);
-    const onAbort = () => controller.abort(ctx.signal?.reason);
-    ctx.signal?.addEventListener('abort', onAbort, { once: true });
-    try {
-      const response = await doFetch(OPENAI_MODELS_URL, { method: 'GET', headers: { Authorization: `Bearer ${k.apiKey}` }, signal: controller.signal });
+    const late = `OpenAI did not answer the model list within ${CHECK_TIMEOUT_MS / 1000} s.`;
+    return boundedFetch({ clock, ms: CHECK_TIMEOUT_MS, signal: ctx.signal, late }, async (signal): Promise<CheckResult> => {
+      const response = await doFetch(OPENAI_MODELS_URL, { method: 'GET', headers: { Authorization: `Bearer ${k.apiKey}` }, signal });
       if (!response.ok) {
         const body = (await response.json().catch(() => ({}))) as ErrorBody;
         const said = typeof body.error?.message === 'string' && body.error.message ? body.error.message : 'OpenAI did not accept this key.';
@@ -57,13 +53,7 @@
       const ids = [...new Set(models.map((m) => m.id))];
       if (ids.length === 0) return { ok: false, code: 'no_translate_model', reason: 'This key lists no gpt-realtime-translate model.' };
       return { ok: true, models: ids.map((id) => ({ id })) };
-    } catch (error) {
-      if (timedOut) throw new Error(`OpenAI did not answer the model list within ${CHECK_TIMEOUT_MS / 1000} s.`);
-      throw error;
-    } finally {
-      cancel();
-      ctx.signal?.removeEventListener('abort', onAbort);
-    }
+    });
   };
 }
 
```

- [ ] **Step 5: Run the lib's test and the three checks' suites.**

Run: `npx vitest run src/lib/provider/boundedFetch.test.ts src/providers/soniox/check.test.ts src/providers/gemini/check.test.ts src/providers/openai_translate/check.test.ts`
Expected: PASS — 4 files, 33 tests. The three suites are unchanged: each still pins its bound (a check still pending at 14 999 ms and late words at 15 000 ms), the caller's abort, an already-aborted caller, and the cancelled timer.

- [ ] **Step 6: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/provider/boundedFetch.ts src/lib/provider/boundedFetch.test.ts src/providers/soniox/check.ts src/providers/gemini/check.ts src/providers/openai_translate/check.ts
```

```bash
git commit -q -F - -- src/lib/provider/boundedFetch.ts src/lib/provider/boundedFetch.test.ts src/providers/soniox/check.ts src/providers/gemini/check.ts src/providers/openai_translate/check.ts <<'EOF'
refactor(provider): one bounded request for every readiness check

Soniox, Gemini and OpenAI Translate each wrote out the same abort, bound
and cleanup; OpenAI Realtime's check is the fourth. Each keeps its bound,
its words and its answers.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 3: A check says what it reads (Wave 1)

**Files:**
- Modify: `src/lib/provider/types.ts`, `src/stores/providerStore.ts`, `src/stores/providerStore.readiness.test.ts`, `src/providers/registry.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Provider.checkReads?: readonly (keyof S & string)[]` (ruling 9, choice 3). `providerStore.updateSettings` forgets readiness only when `checkReads` is absent, a listed field was edited, or the run's pair moved; `refreshReadiness`' kept answer is keyed on the listed fields. Task 12 declares `checkReads: []`.

- [ ] **Step 1: Write the failing tests.** In `src/stores/providerStore.readiness.test.ts`, add the describe block after `refreshReadiness`' existing ones (it uses the file's own `probe`, `opt`, `loadedWithKey`, `readiness`, `noAuth` and `runInputs` helpers):

```diff
--- a/src/stores/providerStore.readiness.test.ts
+++ b/src/stores/providerStore.readiness.test.ts
@@ -207,6 +207,63 @@
   });
 });
 
+describe('refreshReadiness — a provider that declares what its check reads (Stage 2 OpenAI Realtime, ruling 9)', () => {
+  /** A probe with a second field, whose check reads only what `checkReads` names; its sources follow `mode`, so an edit to `mode` can move the pair. */
+  function narrowed(check: (k: unknown, s: unknown, ctx: CheckContext) => Promise<CheckResult>, checkReads: readonly string[]): AnyProvider {
+    return {
+      ...probe('own-key', check),
+      settings: { key: 'probe', defaults: { mode: 'a', slider: 1 } },
+      checkReads,
+      languages: { sources: (s: { mode: string }) => [opt(s.mode === 'a' ? 'en' : 'ja')], targets: () => [opt('fr')] },
+    } as unknown as AnyProvider;
+  }
+
+  it('keeps a ready answer through an edit to a field it does not read: Start stays on, and a later check is served from the kept answer', async () => {
+    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true, models: [{ id: 'm1' }] }));
+    const p = narrowed(check, ['mode']);
+    await loadedWithKey(p);
+    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
+    store.useProviderStore.getState().updateSettings(p, { slider: 2 });
+    expect(readiness()).toEqual({ state: 'ready', models: [{ id: 'm1' }] });
+    // A run's own check, with the edited settings: the kept answer is keyed on `mode` alone.
+    await expect(store.useProviderStore.getState().refreshReadiness(p, noAuth, runInputs())).resolves.toEqual({ state: 'ready', models: [{ id: 'm1' }] });
+    expect(check).toHaveBeenCalledTimes(1);
+  });
+
+  it('forgets it for an edit to a field it reads, and asks again', async () => {
+    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
+    const p = narrowed(check, ['slider']);
+    await loadedWithKey(p);
+    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
+    store.useProviderStore.getState().updateSettings(p, { slider: 2 });
+    expect(readiness()).toEqual({ state: 'unknown' });
+    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
+    expect(check).toHaveBeenCalledTimes(2);
+  });
+
+  it('forgets it when an edit it does not read moves the pair: the check reads the pair', async () => {
+    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
+    const p = narrowed(check, []);
+    await loadedWithKey(p);
+    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
+    expect(store.useProviderStore.getState().entries.probe.pair).toEqual({ source: 'en', target: 'fr' });
+    store.useProviderStore.getState().updateSettings(p, { mode: 'b' });
+    expect(store.useProviderStore.getState().entries.probe.pair).toEqual({ source: 'ja', target: 'fr' });
+    expect(readiness()).toEqual({ state: 'unknown' });
+  });
+
+  it('reads no field with an empty list, and a credential edit still forgets', async () => {
+    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
+    const p = narrowed(check, []);
+    await loadedWithKey(p, 'k1');
+    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
+    store.useProviderStore.getState().updateSettings(p, { slider: 5 });
+    expect(readiness()).toEqual({ state: 'ready', models: [] });
+    store.useProviderStore.getState().setCredential(p, 'apiKey', 'k2');
+    expect(readiness()).toEqual({ state: 'unknown' });
+  });
+});
+
 describe('forgetReadiness', () => {
   it('forgetReadiness makes readiness unknown and drops a check still running', async () => {
     const answer = deferred<CheckResult>();
```

In `src/providers/registry.test.ts`, add the invariant just before the case `'an initial pair is one the provider offers'`:

```diff
--- a/src/providers/registry.test.ts
+++ b/src/providers/registry.test.ts
@@ -219,6 +219,14 @@
     }
   });
 
+  it("a provider's checkReads names only fields of its settings (Stage 2 OpenAI Realtime, ruling 9)", () => {
+    const offenders = (ps: readonly Pick<AnyProvider, 'id' | 'settings' | 'checkReads'>[]) =>
+      ps.flatMap((p) => (p.checkReads ?? []).filter((field: string) => !Object.keys(p.settings.defaults as object).includes(field)).map((field: string) => `${p.id}: ${field}`));
+    expect(offenders(PROVIDERS)).toEqual([]);
+    // The control: a name that is no field.
+    expect(offenders([{ id: 'x', settings: { key: 'x', defaults: { a: 1 } }, checkReads: ['a', 'b'] }])).toEqual(['x: b']);
+  });
+
   it('an initial pair is one the provider offers', () => {
     const withInitial = PROVIDERS.filter((p) => p.languages.initial !== undefined);
     expect(withInitial.length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/stores/providerStore.readiness.test.ts src/providers/registry.test.ts`
Expected: FAIL — 2 tests: `keeps a ready answer through an edit to a field it does not read…` (readiness is `{ state: 'unknown' }`) and `reads no field with an empty list, and a credential edit still forgets` (the same). The other two new cases pass already (today every edit forgets), and so does the registry invariant (no provider declares `checkReads` yet; its control holds the rule).

- [ ] **Step 3: Add the member.** In `src/lib/provider/types.ts` — the `i18nKey` comment also stops naming OpenAI Compatible, which is retired (ruling 1):

```diff
--- a/src/lib/provider/types.ts
+++ b/src/lib/provider/types.ts
@@ -209,8 +209,7 @@
   /**
    * The segment the provider's locale keys sit under, when the catalogs
    * spell it otherwise than `id` (controller ruling 2): `providers.<i18nKey
-   * ?? id>.name` and `.description`. LocalInference's is `local_inference`,
-   * OpenAI Compatible's will be `openaiCompatible`.
+   * ?? id>.name` and `.description`. LocalInference's is `local_inference`.
    */
   i18nKey?: string;
   /** Where a user reads how to set this provider up; the picker links it, dismissibly. */
@@ -295,6 +294,15 @@
    */
   check(r: R, s: S, ctx: CheckContext): Promise<CheckResult>;
   /**
+   * The settings fields `check` reads (Stage 2 OpenAI Realtime, ruling 9):
+   * an edit to any other field keeps the readiness answer — Start stays on,
+   * nothing is checked again — and the kept answer is keyed on these alone.
+   * Every field `check` reads must be listed, and every field that decides
+   * the credential fields. Absent: every field, as before. OpenAI Realtime's
+   * model list reads none (`[]`).
+   */
+  checkReads?: readonly (keyof S & string)[];
+  /**
    * Calls back when something `check` reads besides the settings,
    * credentials, pair and legs has changed — a local engine's models
    * downloading. The app re-checks a local provider then (plan 1e-3a
```

- [ ] **Step 4: Narrow the store.** In `src/stores/providerStore.ts`:

```diff
--- a/src/stores/providerStore.ts
+++ b/src/stores/providerStore.ts
@@ -231,10 +231,14 @@
       // New settings can change the languages on offer; the pair the user left follows them, and the run's pair is derived from it.
       const before = entry.stored ?? entry.pair;
       const kept = normalizePair(p, settings, before);
-      put(p, { settings, credentials: entry.credentials, ...derive(p, settings, kept) });
+      const next = derive(p, settings, kept);
+      put(p, { settings, credentials: entry.credentials, ...next });
       for (const [field, value] of Object.entries(patch)) void persistSetting(storageKey(p, field), value);
       persistPair(p, before, kept);
-      forgetReadiness(p);
+      // The answer holds while the check would read the same inputs (ruling 9): no field it reads was edited, and the run's pair did not move.
+      const read = p.checkReads === undefined || Object.keys(patch).some((field) => p.checkReads!.includes(field));
+      const moved = next.pair.source !== entry.pair.source || next.pair.target !== entry.pair.target;
+      if (read || moved) forgetReadiness(p);
     },
 
     setCredential(p, key, value) {
@@ -289,7 +293,11 @@
       // readiness changes as models download. Only a managed provider's
       // answer turns on the sign-in and the account; an own-key one checks its key.
       const account = p.kind === 'managed' ? [auth.signedIn, auth.userId ?? null] : [];
-      const key = JSON.stringify([inputs.settings, values, ...account, inputs.pair, inputs.legs]);
+      // Only the fields the check reads key its answer (ruling 9), so a run started after an edit elsewhere is served from it.
+      const read = p.checkReads === undefined
+        ? inputs.settings
+        : Object.fromEntries(p.checkReads.map((field) => [field, (inputs.settings as Record<string, unknown>)[field]]));
+      const key = JSON.stringify([read, values, ...account, inputs.pair, inputs.legs]);
       const kept = p.kind === 'local' ? undefined : lastAnswer.get(p.id);
       if (kept && kept.inputs === key) return answered(kept.readiness);
 
```

- [ ] **Step 5: Run them to see them pass.**

Run: `npx vitest run src/stores/providerStore.readiness.test.ts src/providers/registry.test.ts`
Expected: PASS — 2 files, 57 tests. Every provider registered today declares nothing, so every other readiness case, the readiness driver's (`src/app/readiness.test.ts`) and every provider's suite behave as before.

- [ ] **Step 6: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/provider/types.ts src/stores/providerStore.ts src/stores/providerStore.readiness.test.ts src/providers/registry.test.ts
```

```bash
git commit -q -F - -- src/lib/provider/types.ts src/stores/providerStore.ts src/stores/providerStore.readiness.test.ts src/providers/registry.test.ts <<'EOF'
feat(provider): a readiness check says which settings it reads

A provider may declare `checkReads`; an edit to any other setting keeps
the ready answer, so Start stays on and nothing is checked again. A moved
pair or a credential still forgets it. No provider declares it yet.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 4: A model configuration with no temperature; the Logs and the redaction (Wave 1)

**Files:**
- Modify: `src/components/providers/fields/ModelConfigurationField.tsx`, `src/components/providers/fields/ModelConfigurationField.test.tsx`, `src/stores/logStore.test.ts`, `src/lib/diagnostics/redact.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ModelConfigurationField`'s `temperature` and `temperatureRange` optional — the row is drawn only when both are given (ruling 6). Task 10 renders it with the max tokens alone. The Logs pin and the redaction's comment change no behaviour.

- [ ] **Step 1: Write the failing test and the Logs pin.** In `src/components/providers/fields/ModelConfigurationField.test.tsx`:

```diff
--- a/src/components/providers/fields/ModelConfigurationField.test.tsx
+++ b/src/components/providers/fields/ModelConfigurationField.test.tsx
@@ -65,6 +65,18 @@
     expect(onChange).toHaveBeenCalledWith({ maxTokens: 'inf' });
   });
 
+  it('draws no temperature row when handed none: a model that takes no temperature (Stage 2 OpenAI Realtime, ruling 6)', () => {
+    const onChange = vi.fn();
+    const { container } = render(<ModelConfigurationField maxTokens={2048} maxTokensRange={{ min: 1, max: 4096, step: 1 }} onChange={onChange} />);
+    expect(screen.queryByLabelText('settings.temperature')).toBeNull();
+    expect(screen.queryByText('settings.temperature')).toBeNull();
+    expect(container.querySelectorAll('.setting-item')).toHaveLength(1);
+    const slider = screen.getByLabelText('settings.maxTokens') as HTMLInputElement;
+    expect(slider.max).toBe('4096');
+    fireEvent.change(slider, { target: { value: '1024' } });
+    expect(onChange).toHaveBeenCalledWith({ maxTokens: 1024 });
+  });
+
   it('disabled locks the sliders and the checkbox', () => {
     render(
       <ModelConfigurationField
```

In `src/stores/logStore.test.ts`, after the grouping case for Doubao's names (choice 13; `logStore.ts` is not edited):

```diff
--- a/src/stores/logStore.test.ts
+++ b/src/stores/logStore.test.ts
@@ -213,6 +213,30 @@
     for (const type of others) add(type);
     expect(entriesFor('speaker').slice(3).map((e) => [e.eventType, e.groupingKey])).toEqual(others.map((type) => [type, undefined]));
   });
+
+  it("groups OpenAI Realtime's delta frames each under its own type, and gives its other frames no key (Stage 2 OpenAI Realtime, choice 13)", () => {
+    const add = (type: string) => useLogStore.getState().addRealtimeEvent({ type, data: {} } as any, 'server', type, 'speaker');
+    const deltas = [
+      'conversation.item.input_audio_transcription.delta', 'response.output_audio_transcript.delta', 'response.output_text.delta', 'response.output_audio.delta',
+    ];
+    for (const type of deltas) {
+      add(type);
+      add(type);
+    }
+    expect(entriesFor('speaker').map((e) => [e.groupingKey, e.events?.length])).toEqual(deltas.map((type) => [type, 2]));
+    // None of its other names is the microphone's row, one of Doubao's (`subtitle.*`, `tts.*`, `session.usage`, `session.audio_muted`) or anyone's: one entry each, ungrouped.
+    const others = [
+      'session.opened', 'session.update', 'input_audio_buffer.commit', 'input_audio_buffer.clear', 'conversation.item.create', 'response.create', 'response.queued', 'response.anchor',
+      'session.created', 'session.updated', 'input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped', 'input_audio_buffer.committed', 'input_audio_buffer.cleared',
+      'conversation.item.added', 'conversation.item.done', 'conversation.item.input_audio_transcription.completed', 'conversation.item.input_audio_transcription.failed',
+      'response.created', 'response.output_item.added', 'response.output_item.done', 'response.content_part.added', 'response.content_part.done',
+      'conversation.item.deleted', 'conversation.item.truncated', 'conversation.item.input_audio_transcription.segment', 'input_audio_buffer.timeout_triggered',
+      'response.output_audio_transcript.done', 'response.output_text.done', 'response.output_audio.done', 'response.done', 'rate_limits.updated',
+      'session.error', 'session.unknown', 'session.unreadable', 'session.socket_error', 'session.connection_lost',
+    ];
+    for (const type of others) add(type);
+    expect(entriesFor('speaker').slice(deltas.length).map((e) => [e.eventType, e.groupingKey])).toEqual(others.map((type) => [type, undefined]));
+  });
 });
 
 describe('logStore — channel filing', () => {
```

- [ ] **Step 2: Run them to see the field's case fail.**

Run: `npx vitest run src/components/providers/fields/ModelConfigurationField.test.tsx src/stores/logStore.test.ts`
Expected: FAIL — 1 test, `draws no temperature row when handed none…`: `TypeError: Cannot read properties of undefined (reading 'toFixed')`. The Logs case passes: it pins today's grouping, which this plan relies on and does not change.

- [ ] **Step 3: Make the temperature optional.** In `src/components/providers/fields/ModelConfigurationField.tsx`:

```diff
--- a/src/components/providers/fields/ModelConfigurationField.tsx
+++ b/src/components/providers/fields/ModelConfigurationField.tsx
@@ -5,9 +5,10 @@
 export interface NumberRange { min: number; max: number; step: number }
 
 export interface ModelConfigurationFieldProps {
-  temperature: number;
+  /** Absent, with its range: no temperature row — a model that takes none (OpenAI Realtime's; Stage 2 OpenAI Realtime, ruling 6). */
+  temperature?: number;
   maxTokens: number | 'inf';
-  temperatureRange: NumberRange;
+  temperatureRange?: NumberRange;
   maxTokensRange: NumberRange;
   onChange(patch: { temperature?: number; maxTokens?: number | 'inf' }): void;
   disabled?: boolean;
@@ -15,28 +16,30 @@
 
 const inlineHelpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />;
 
-/** A model's sampling and output length (F13): the old "Model configuration" section; unticking Unlimited sets the range's maximum, as it did. */
+/** A model's sampling and output length (F13): the old "Model configuration" section; unticking Unlimited sets the range's maximum, as it did. A model that takes no temperature is handed none. */
 export function ModelConfigurationField({ temperature, maxTokens, temperatureRange, maxTokensRange, onChange, disabled = false }: ModelConfigurationFieldProps) {
   const { t } = useTranslation();
   const unlimited = maxTokens === 'inf';
   return (
     <div className="settings-section">
       <h2>{t('settings.modelConfiguration')}</h2>
-      <div className="setting-item">
-        <div className="setting-label">
-          <span>
-            {t('settings.temperature')}
-            <Tooltip content={t('settings.temperatureTooltip')} position="top">{inlineHelpIcon}</Tooltip>
-          </span>
-          <span className="setting-value">{temperature.toFixed(2)}</span>
+      {temperature !== undefined && temperatureRange && (
+        <div className="setting-item">
+          <div className="setting-label">
+            <span>
+              {t('settings.temperature')}
+              <Tooltip content={t('settings.temperatureTooltip')} position="top">{inlineHelpIcon}</Tooltip>
+            </span>
+            <span className="setting-value">{temperature.toFixed(2)}</span>
+          </div>
+          <input
+            type="range" aria-label={t('settings.temperature')}
+            min={temperatureRange.min} max={temperatureRange.max} step={temperatureRange.step} value={temperature}
+            onChange={(e) => onChange({ temperature: parseFloat(e.target.value) })}
+            className="slider" disabled={disabled}
+          />
         </div>
-        <input
-          type="range" aria-label={t('settings.temperature')}
-          min={temperatureRange.min} max={temperatureRange.max} step={temperatureRange.step} value={temperature}
-          onChange={(e) => onChange({ temperature: parseFloat(e.target.value) })}
-          className="slider" disabled={disabled}
-        />
-      </div>
+      )}
       <div className="setting-item">
         <div className="setting-label">
           <span className="label-with-checkbox">
```

- [ ] **Step 4: Name the new producer in the redaction's comment** (`src/lib/diagnostics/redact.ts`; the rule is unchanged):

```diff
--- a/src/lib/diagnostics/redact.ts
+++ b/src/lib/diagnostics/redact.ts
@@ -49,7 +49,9 @@
   [/(\bsokuji-auth\.)[A-Za-z0-9._~+/=-]+/g, `$1${REDACTED}`],
   // `openai-insecure-api-key.${apiKey}` WebSocket subprotocol — OpenAI
   // Translate's own key (`openai_translate/wire.ts` `translateProtocols`,
-  // Stage 2 OpenAI Translate, choice 3). The subprotocol is never put in a
+  // Stage 2 OpenAI Translate, choice 3) and OpenAI Realtime's
+  // (`openai/wire.ts` `realtimeProtocols`, Stage 2 OpenAI Realtime,
+  // choice 7). The subprotocol is never put in a
   // frame, an error or a notice, and the bare `sk-` rule below masks an
   // OpenAI key anyway; this keeps the carrier's name and masks a key of any
   // shape — a browser that refuses the socket quotes the subprotocol.
```

- [ ] **Step 5: Run them to see them pass.**

Run: `npx vitest run src/components/providers/fields/ModelConfigurationField.test.tsx src/stores/logStore.test.ts`
Expected: PASS — 2 files, 29 tests. Gemini's settings view, the only other user of the field, passes both props as before (`src/providers/gemini/GeminiSettings.test.tsx` stays green).

- [ ] **Step 6: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 7: Commit.**

```bash
git add src/components/providers/fields/ModelConfigurationField.tsx src/components/providers/fields/ModelConfigurationField.test.tsx src/stores/logStore.test.ts src/lib/diagnostics/redact.ts
```

```bash
git commit -q -F - -- src/components/providers/fields/ModelConfigurationField.tsx src/components/providers/fields/ModelConfigurationField.test.tsx src/stores/logStore.test.ts src/lib/diagnostics/redact.ts <<'EOF'
feat(fields): a model configuration without a temperature

OpenAI Realtime's GA endpoint takes no temperature (ruling 6): the field
draws its row only when it is handed one. The Logs' grouping of the new
provider's frames is pinned as it stands, and the redaction names its
second user of the key subprotocol.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 5: Settings, the source transcript's hints and the builder (Wave 1)

**Files:**
- Create: `src/providers/openai/adapter.ts` (a seed, first), `src/providers/openai/settings.ts`, `src/providers/openai/transcription.ts`, `src/providers/openai/config.ts`
- Test: `src/providers/openai/settings.test.ts`, `src/providers/openai/transcription.test.ts`, `src/providers/openai/config.test.ts`

**Interfaces:**
- Consumes: `InstructionsSettings`, `INSTRUCTIONS_DEFAULTS`, `INSTRUCTION_LEGACY_KEYS`, `migrateInstructions`, `resolveInstructions` (`src/lib/provider/instructions`); `AUTO` (`src/lib/provider/languages`); `Provider`, `SharedSettings`, `LanguageOption`, `ModelOption`, `MigrationInputs`, `CredentialsMissing`, `ProviderRefusal` (`src/lib/provider/types`); `SessionContext` (`src/lib/contract/adapter`).
- Produces:
  - `settings.ts`: `RealtimeSettings` (`S`), `TurnDetectionMode = 'Normal' | 'Semantic'`, `TRANSCRIPT_MODELS`, `REASONING_EFFORTS`, `SEMANTIC_EAGERNESSES`, `NoiseReduction`, `NOISE_REDUCTIONS`, `REALTIME_DEFAULTS`, `REALTIME_DEFAULT_MODEL`, `REALTIME_DEFAULT_VOICE`, `REALTIME_{THRESHOLD,PREFIX,SILENCE,MAX_TOKENS}_RANGE`, `REALTIME_LEGACY_KEYS`, `migrateRealtimeSettings(stored, inputs): RealtimeSettings`, `REALTIME_VOICES`, `REALTIME_LANGUAGES`, `realtimeLanguages`, `realtimeLanguageName(code): string`, `RealtimeCredentials { apiKey: string }`, `realtimeCredentials`, `isRealtimeModelId(id): boolean`, `effectiveRealtimeModel(s, models): string`, `takesReasoning(model): boolean`;
  - `transcription.ts`: `TranscriptionHint`, `supportsTranscriptionContext`, `normalizeTranscriptionLanguage`, `parseTranscriptionKeywords`, `buildTranscriptionHint(model, sourceLanguage, rawKeywords): TranscriptionHint`;
  - `config.ts`: `TurnDetection`, `RealtimeConfig` (`C`), `buildRealtime(context, s, shared): RealtimeConfig | ProviderRefusal`, `describeRealtime(c): { translationModel; asrModel }`.

- [ ] **Step 1: Seed the folder's `adapter.ts` first.** The session-side guard requires one in every folder under `src/providers`; Task 11 replaces it. Create `src/providers/openai/adapter.ts`:

```ts
/**
 * OpenAI Realtime's session side (plan: Stage 2 OpenAI Realtime). The
 * adapter lands in its Task 11; until then this seed is the `adapter.ts` the
 * session-side guard (`sessionSide.consistency.test.ts`) requires of every
 * provider folder.
 */
export {};
```

- [ ] **Step 2: Write the failing tests.** Create `src/providers/openai/settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS } from '../../lib/provider/instructions';
import { AUTO, reverseSupported } from '../../lib/provider/languages';
import type { AuthContext } from '../../lib/provider/types';
import {
  effectiveRealtimeModel, isRealtimeModelId, migrateRealtimeSettings, realtimeCredentials, realtimeLanguageName, realtimeLanguages,
  REALTIME_DEFAULTS, REALTIME_LANGUAGES, REALTIME_LEGACY_KEYS, REALTIME_VOICES, takesReasoning,
} from './settings';

const signedOut: AuthContext = { signedIn: false, getToken: async () => null };
const migrate = (stored: Record<string, unknown>, legacy: Record<string, unknown> = {}) => migrateRealtimeSettings(stored, { legacy, credentials: { apiKey: '' } });
const ids = (...list: string[]) => list.map((id) => ({ id }));

describe("OpenAI Realtime's settings", () => {
  it('starts from the old defaults, less the temperature (ruling 6), plus the instructions it now owns', () => {
    expect(REALTIME_DEFAULTS).toEqual({
      ...INSTRUCTIONS_DEFAULTS,
      model: 'gpt-realtime-2.1-mini',
      voice: 'alloy',
      turnDetectionMode: 'Normal',
      threshold: 0.49,
      prefixPadding: 0.5,
      silenceDuration: 0.5,
      semanticEagerness: 'Auto',
      maxTokens: 'inf',
      transcriptModel: 'gpt-4o-mini-transcribe',
      transcriptKeywords: '',
      noiseReduction: 'None',
      transportType: 'websocket',
      reasoningEffort: 'low',
    });
    expect(REALTIME_DEFAULTS).not.toHaveProperty('temperature');
    // The instructions' legacy keys, and nothing else (ruling 5).
    expect(REALTIME_LEGACY_KEYS).toEqual(INSTRUCTION_LEGACY_KEYS);
  });

  it('loads an old profile field by field, converting nothing: a stored temperature is not read, a WebRTC choice kept', () => {
    const s = migrate({
      model: 'gpt-realtime-2.1', voice: 'marin', turnDetectionMode: 'Semantic', threshold: 0.7, prefixPadding: 0.3, silenceDuration: 1.2,
      semanticEagerness: 'High', maxTokens: 2048, transcriptModel: 'gpt-live-transcribe', transcriptKeywords: 'Sokuji', noiseReduction: 'Far field',
      transportType: 'webrtc', reasoningEffort: 'medium', temperature: 1.1,
    });
    expect(s).toMatchObject({
      model: 'gpt-realtime-2.1', voice: 'marin', turnDetectionMode: 'Semantic', threshold: 0.7, prefixPadding: 0.3, silenceDuration: 1.2,
      semanticEagerness: 'High', maxTokens: 2048, transcriptModel: 'gpt-live-transcribe', transcriptKeywords: 'Sokuji', noiseReduction: 'Far field',
      transportType: 'webrtc', reasoningEffort: 'medium',
    });
    expect(s).not.toHaveProperty('temperature');
  });

  it("reads a stored push mode as no mechanism: 'Disabled' and 'Push-to-Translate' fall to 'Normal' (ruling 5; choice 4)", () => {
    expect(migrate({ turnDetectionMode: 'Disabled' }).turnDetectionMode).toBe('Normal');
    expect(migrate({ turnDetectionMode: 'Push-to-Translate' }).turnDetectionMode).toBe('Normal');
    expect(migrate({ turnDetectionMode: 'Normal' }).turnDetectionMode).toBe('Normal');
  });

  it('leaves a model OpenAI deprecated saved as it was: the effective model moves off it to the default model once the check stops listing it (ruling 5; choice 4)', () => {
    expect(migrate({ model: 'gpt-realtime-mini' }).model).toBe('gpt-realtime-mini');
    expect(effectiveRealtimeModel({ model: 'gpt-realtime-mini' }, ids('gpt-realtime-2.1', 'gpt-realtime-2.1-mini'))).toBe('gpt-realtime-2.1-mini');
  });

  it('falls each malformed field to its default, and reads an Electron max-tokens string as its number (Stage 2 Gemini, ruling 10)', () => {
    const s = migrate({
      model: 5, voice: null, turnDetectionMode: 'Loud', threshold: 'high', prefixPadding: Number.NaN, silenceDuration: undefined, semanticEagerness: 'Eager',
      maxTokens: '2048', transcriptModel: 'gpt-5-transcribe', transcriptKeywords: ['a'], noiseReduction: 'Loud', transportType: 'sip', reasoningEffort: 'max',
    });
    expect(s).toEqual({ ...REALTIME_DEFAULTS, maxTokens: 2048 });
    expect(migrate({ maxTokens: 'lots' }).maxTokens).toBe('inf');
    expect(migrate({ maxTokens: 'inf' }).maxTokens).toBe('inf');
  });

  it('reads the instructions from the old global copy until its own is written (Stage 2 Gemini, ruling 4)', () => {
    const s = migrate({}, { 'settings.common.useTemplateMode': false, 'settings.common.systemInstructions': 'Translate plainly.' });
    expect(s).toMatchObject({ useTemplateMode: false, systemInstructions: 'Translate plainly.' });
  });

  it('offers Auto-detect and the old 55 as sources, the 55 as every source\'s targets, en → zh_CN first (ruling 7)', () => {
    const sources = realtimeLanguages.sources(REALTIME_DEFAULTS);
    expect(sources).toHaveLength(56);
    expect(sources[0].value).toBe(AUTO);
    expect(sources.slice(1)).toEqual(REALTIME_LANGUAGES);
    expect(realtimeLanguages.targets(AUTO, REALTIME_DEFAULTS)).toEqual(REALTIME_LANGUAGES);
    expect(realtimeLanguages.targets('en', REALTIME_DEFAULTS).map((o) => o.value)).toContain('en');
    expect(realtimeLanguages.initial?.(REALTIME_DEFAULTS)).toEqual({ source: 'en', target: 'zh_CN' });
    // D20: an Auto-detect source never reverses, so Both is refused for it; a named one does.
    expect(reverseSupported({ languages: realtimeLanguages }, REALTIME_DEFAULTS, { source: AUTO, target: 'en' })).toBe(false);
    expect(reverseSupported({ languages: realtimeLanguages }, REALTIME_DEFAULTS, { source: 'ja', target: 'en' })).toBe(true);
  });

  it('names a language in English for the template, Auto-detect as "the spoken language" (ruling 7)', () => {
    expect(realtimeLanguageName('zh_CN')).toBe('Chinese (China)');
    expect(realtimeLanguageName(AUTO)).toBe('the spoken language');
    expect(realtimeLanguageName('xx')).toBe('xx');
  });

  it('offers the ten old voices', () => {
    expect(REALTIME_VOICES.map((v) => v.value)).toEqual(['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'marin', 'sage', 'shimmer', 'verse']);
  });

  it('reads one key, trimmed, and an empty one as missing (choice 19)', () => {
    expect(realtimeCredentials.fields(REALTIME_DEFAULTS)).toEqual([{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }]);
    expect(realtimeCredentials.read({ apiKey: ' sk-proj-abc\n' }, signedOut)).toEqual({ apiKey: 'sk-proj-abc' });
    expect(realtimeCredentials.read({ apiKey: '  ' }, signedOut)).toEqual({ missing: 'Enter your OpenAI API key.' });
  });

  it('knows a voice-agent model, less the transcription and translation families (`OpenAIClient.ts:250-259`)', () => {
    for (const id of ['gpt-realtime', 'gpt-realtime-mini', 'gpt-realtime-2.1', 'gpt-realtime-2.1-mini', 'GPT-Realtime-2.1']) expect(isRealtimeModelId(id), id).toBe(true);
    for (const id of ['gpt-realtime-whisper', 'gpt-realtime-translate', 'gpt-realtime-translate-2026-09-01', 'gpt-4o-realtime-preview', 'gpt-audio-1.5', 'whisper-1']) {
      expect(isRealtimeModelId(id), id).toBe(false);
    }
  });

  it('runs the saved model when the check listed it, else the default model when listed, else the newest listed, else the saved one while nothing is listed', () => {
    const listed = ids('gpt-realtime-2.1', 'gpt-realtime-2.1-mini');
    expect(effectiveRealtimeModel({ model: 'gpt-realtime-2.1' }, listed)).toBe('gpt-realtime-2.1');
    expect(effectiveRealtimeModel({ model: 'gpt-realtime-9' }, listed)).toBe('gpt-realtime-2.1-mini');
    expect(effectiveRealtimeModel({ model: 'gpt-realtime-9' }, ids('gpt-realtime-2.1', 'gpt-realtime-mini'))).toBe('gpt-realtime-2.1');
    expect(effectiveRealtimeModel({ model: 'gpt-realtime-2.1-mini' }, [])).toBe('gpt-realtime-2.1-mini');
  });

  it('sends reasoning to a gpt-realtime-2* model only', () => {
    expect(takesReasoning('gpt-realtime-2.1-mini')).toBe(true);
    expect(takesReasoning('gpt-realtime-2')).toBe(true);
    expect(takesReasoning('gpt-realtime-mini')).toBe(false);
    expect(takesReasoning('gpt-realtime-1.5')).toBe(false);
  });
});
```

Create `src/providers/openai/transcription.test.ts` — `OTC`'s cases for the helpers that move, the reverse helpers' dropped (choice 5):

```ts
/**
 * The source transcript's hints (choice 5): the cases of
 * `openaiTranscriptionContext.test.ts`, which move with the copied module,
 * less the reverse helpers' (D17: the participant's hint is built for its
 * own direction — `config.test.ts` pins that).
 */
import { describe, it, expect } from 'vitest';
import { AUTO } from '../../lib/provider/languages';
import { REALTIME_LANGUAGES, TRANSCRIPT_MODELS } from './settings';
import { buildTranscriptionHint, normalizeTranscriptionLanguage, parseTranscriptionKeywords, supportsTranscriptionContext } from './transcription';

describe('supportsTranscriptionContext', () => {
  it('accepts the two context-capable models', () => {
    expect(supportsTranscriptionContext('gpt-transcribe')).toBe(true);
    expect(supportsTranscriptionContext('gpt-live-transcribe')).toBe(true);
  });

  it('refuses the legacy models that error on languages/keywords', () => {
    for (const model of ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1', 'gpt-realtime-whisper']) expect(supportsTranscriptionContext(model), model).toBe(false);
    expect(supportsTranscriptionContext(undefined)).toBe(false);
  });
});

describe('normalizeTranscriptionLanguage', () => {
  it('passes supported base codes through, and strips the region from variants the API refuses', () => {
    expect(normalizeTranscriptionLanguage('en')).toBe('en');
    expect(normalizeTranscriptionLanguage('ja')).toBe('ja');
    for (const [value, code] of [['en_AU', 'en'], ['en_GB', 'en'], ['en_US', 'en'], ['zh_CN', 'zh'], ['zh_TW', 'zh'], ['es_419', 'es'], ['pt_BR', 'pt'], ['pt_PT', 'pt']]) {
      expect(normalizeTranscriptionLanguage(value), value).toBe(code);
    }
  });

  it('keeps three-letter codes whole, and is case-insensitive', () => {
    expect(normalizeTranscriptionLanguage('fil')).toBe('fil');
    expect(normalizeTranscriptionLanguage('yue')).toBe('yue');
    expect(normalizeTranscriptionLanguage('EN_us')).toBe('en');
  });

  it('answers null for a language the API has no code for, for Auto-detect, and for nothing', () => {
    for (const code of ['am', 'bn', 'gu', 'ml', 'te', AUTO, 'xx', '', '   ']) expect(normalizeTranscriptionLanguage(code), code).toBeNull();
    expect(normalizeTranscriptionLanguage(undefined)).toBeNull();
  });

  it('never emits a code outside the verified allowlist for any language the provider offers', () => {
    const allowed = new Set([
      'af', 'ar', 'az', 'be', 'bg', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el',
      'en', 'es', 'et', 'fa', 'fi', 'fr', 'gl', 'he', 'hi', 'hr', 'hu', 'hy',
      'id', 'is', 'it', 'iw', 'ja', 'kk', 'kn', 'ko', 'lt', 'lv', 'mi', 'mk',
      'mr', 'ms', 'ne', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr',
      'sv', 'sw', 'ta', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'zh', 'fil', 'yue',
    ]);
    expect(REALTIME_LANGUAGES).toHaveLength(55);
    for (const option of REALTIME_LANGUAGES) {
      const code = normalizeTranscriptionLanguage(option.value);
      if (code !== null) expect(allowed.has(code), `${option.value} -> ${code}`).toBe(true);
    }
  });
});

describe('parseTranscriptionKeywords', () => {
  it('splits on commas, full-width commas and newlines, trims, and drops empties and repeats', () => {
    expect(parseTranscriptionKeywords('Sokuji, Kizuna AI\nPulseAudio')).toEqual(['Sokuji', 'Kizuna AI', 'PulseAudio']);
    expect(parseTranscriptionKeywords('東京、大阪，京都')).toEqual(['東京', '大阪', '京都']);
    expect(parseTranscriptionKeywords('a,,  ,a, b ')).toEqual(['a', 'b']);
    expect(parseTranscriptionKeywords(undefined)).toEqual([]);
    expect(parseTranscriptionKeywords('  ,  ,')).toEqual([]);
  });
});

describe('buildTranscriptionHint', () => {
  it('sends languages and keywords to the context-capable models', () => {
    expect(buildTranscriptionHint('gpt-live-transcribe', 'en_US', 'Sokuji, Kizuna AI')).toEqual({ model: 'gpt-live-transcribe', languages: ['en'], keywords: ['Sokuji', 'Kizuna AI'] });
  });

  it('sends the singular language to a legacy model, and never keywords: the API would refuse the whole session.update', () => {
    const hint = buildTranscriptionHint('gpt-4o-mini-transcribe', 'zh_CN', 'Sokuji');
    expect(hint).toEqual({ model: 'gpt-4o-mini-transcribe', language: 'zh' });
  });

  it('omits the language rather than sending an empty array or an unknown code — Auto-detect included — and keywords that parse to nothing', () => {
    expect(buildTranscriptionHint('gpt-live-transcribe', 'bn', '')).toEqual({ model: 'gpt-live-transcribe' });
    expect(buildTranscriptionHint('gpt-live-transcribe', AUTO, 'Sokuji')).toEqual({ model: 'gpt-live-transcribe', keywords: ['Sokuji'] });
    expect(buildTranscriptionHint('whisper-1', 'te', undefined)).toEqual({ model: 'whisper-1' });
    expect(buildTranscriptionHint('gpt-transcribe', 'ja', '  ,  ')).toEqual({ model: 'gpt-transcribe', languages: ['ja'] });
  });

  it('keeps every model the settings offer to a payload the API accepts', () => {
    for (const model of TRANSCRIPT_MODELS) {
      const hint = buildTranscriptionHint(model, 'en_AU', 'Sokuji');
      expect(hint, model).toEqual(supportsTranscriptionContext(model) ? { model, languages: ['en'], keywords: ['Sokuji'] } : { model, language: 'en' });
    }
  });
});
```

Create `src/providers/openai/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import { INSTRUCTIONS_TEMPLATE } from '../../lib/provider/instructions';
import { AUTO } from '../../lib/provider/languages';
import type { SharedSettings } from '../../lib/provider/types';
import { buildRealtime, describeRealtime, type RealtimeConfig } from './config';
import { REALTIME_DEFAULTS, type RealtimeSettings } from './settings';

const PAIR = { source: 'en', target: 'zh_CN' };
const shared = (patch: Partial<SharedSettings> = {}): SharedSettings => ({
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  reversed: (d) => d.source === PAIR.target && d.target === PAIR.source,
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'gpt-realtime-2.1' }, { id: 'gpt-realtime-2.1-mini' }, { id: 'gpt-realtime-mini' }],
  ...patch,
});
const SPEAKER: SessionContext = { direction: PAIR, speech: true, turns: 'auto' };
const PARTICIPANT: SessionContext = { direction: { source: 'zh_CN', target: 'en' }, speech: false, turns: 'auto' };
const build = (patch: Partial<RealtimeSettings> = {}, context = SPEAKER, sh = shared()) => buildRealtime(context, { ...REALTIME_DEFAULTS, ...patch }, sh) as RealtimeConfig;
const template = (source: string, target: string) => INSTRUCTIONS_TEMPLATE.replace(/\{\{SOURCE_LANGUAGE\}\}/g, source).replace(/\{\{TARGET_LANGUAGE\}\}/g, target);

describe("OpenAI Realtime's builder", () => {
  it('builds the speaker from the defaults: the effective model, the template for its direction, audio in the voice, server VAD in ms, the source hint, noise off, reasoning, WebSocket', () => {
    expect(build()).toEqual({
      model: 'gpt-realtime-2.1-mini',
      instructions: template('English', 'Chinese (China)'),
      modalities: ['audio'],
      voice: 'alloy',
      maxTokens: 'inf',
      turnDetection: { type: 'server_vad', threshold: 0.49, prefixPaddingMs: 500, silenceDurationMs: 500 },
      transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' },
      noiseReduction: null,
      reasoningEffort: 'low',
      transport: 'websocket',
    });
  });

  it("builds the participant as the reversed call: Other's prompt, the hint for the language it hears, text when it does not speak, and the user's own detection (ruling 4; D17)", () => {
    const s: Partial<RealtimeSettings> = { useTemplateMode: false, systemInstructions: 'Mine.', participantSystemInstructions: "Other's.", transcriptModel: 'gpt-live-transcribe', transcriptKeywords: 'Sokuji', turnDetectionMode: 'Semantic', semanticEagerness: 'Low' };
    const participant = build(s, PARTICIPANT);
    expect(participant).toMatchObject({
      instructions: "Other's.",
      modalities: ['text'],
      transcription: { model: 'gpt-live-transcribe', languages: ['zh'], keywords: ['Sokuji'] },
      turnDetection: { type: 'semantic_vad', eagerness: 'low' },
    });
    expect(participant).not.toHaveProperty('voice');
    expect(build(s).instructions).toBe('Mine.');
    // Its switch on: it speaks, in the same voice (ruling 15).
    expect(build(s, { ...PARTICIPANT, speech: true })).toMatchObject({ modalities: ['audio'], voice: 'alloy' });
  });

  it('under manual turns asks for no detection: the client commits', () => {
    expect(build({}, { ...SPEAKER, turns: 'manual' }).turnDetection).toBeNull();
    expect(build({ turnDetectionMode: 'Semantic' }, { ...SPEAKER, turns: 'manual' }).turnDetection).toBeNull();
  });

  it("clamps the knobs to the sliders' ranges, and a knob that is no number to its default", () => {
    expect(build({ threshold: 3, prefixPadding: -1, silenceDuration: 9 }).turnDetection).toEqual({ type: 'server_vad', threshold: 1, prefixPaddingMs: 0, silenceDurationMs: 2000 });
    expect(build({ threshold: Number.NaN, prefixPadding: Number.NaN, silenceDuration: Number.NaN }).turnDetection).toEqual({ type: 'server_vad', threshold: 0.49, prefixPaddingMs: 500, silenceDurationMs: 500 });
    expect(build({ maxTokens: 9_000 }).maxTokens).toBe(4096);
    expect(build({ maxTokens: 0 }).maxTokens).toBe(1);
    expect(build({ maxTokens: 2048.4 }).maxTokens).toBe(2048);
    expect(build({ maxTokens: Number.NaN }).maxTokens).toBe('inf');
  });

  it('runs the saved model when listed, else the default model, else the newest; sends reasoning to a gpt-realtime-2* model only; refuses when nothing is listed or saved', () => {
    expect(build({ model: 'gpt-realtime-mini' })).toMatchObject({ model: 'gpt-realtime-mini' });
    expect(build({ model: 'gpt-realtime-mini' })).not.toHaveProperty('reasoningEffort');
    expect(build({ model: 'gpt-realtime-9', reasoningEffort: 'high' })).toMatchObject({ model: 'gpt-realtime-2.1-mini', reasoningEffort: 'high' });
    expect(build({ model: 'gpt-realtime-9' }, SPEAKER, shared({ models: [{ id: 'gpt-realtime-2.1' }, { id: 'gpt-realtime-mini' }] }))).toMatchObject({ model: 'gpt-realtime-2.1' });
    expect(buildRealtime(SPEAKER, { ...REALTIME_DEFAULTS, model: '' }, shared({ models: [] }))).toEqual({ refused: 'No OpenAI Realtime model is available to this key.', code: 'models_required' });
  });

  it('names Auto-detect "the spoken language" in the template, and sends it no language hint (ruling 7)', () => {
    const auto = build({ transcriptModel: 'gpt-live-transcribe' }, { ...SPEAKER, direction: { source: AUTO, target: 'ja' } });
    expect(auto.instructions).toBe(template('the spoken language', 'Japanese'));
    expect(auto.transcription).toEqual({ model: 'gpt-live-transcribe' });
  });

  it('maps noise reduction to the wire, "None" as null (ruling 16), and keeps running over WebSocket whatever the stored transport (ruling 12)', () => {
    expect(build({ noiseReduction: 'Near field' }).noiseReduction).toBe('near_field');
    expect(build({ noiseReduction: 'Far field' }).noiseReduction).toBe('far_field');
    expect(build({ transportType: 'webrtc' }).transport).toBe('websocket');
  });

  it('describes the translation model and the transcript model (choice 20)', () => {
    expect(describeRealtime(build({ transcriptModel: 'gpt-transcribe' }))).toEqual({ translationModel: 'gpt-realtime-2.1-mini', asrModel: 'gpt-transcribe' });
  });
});
```

- [ ] **Step 3: Run them to see them fail.**

Run: `npx vitest run src/providers/openai/settings.test.ts src/providers/openai/transcription.test.ts src/providers/openai/config.test.ts`
Expected: FAIL — 3 files: `Failed to resolve import "./settings"` (settings and transcription, whose first import it is) and `"./config"`.

- [ ] **Step 4: Write the settings.** Create `src/providers/openai/settings.ts`:

```ts
/**
 * OpenAI Realtime's `S`, languages, credentials and effective model (survey
 * §2.3–2.8). `S` is the old slice (`OpenAIProviderConfig.ts:24-75`) without
 * what leaves it — the key (a credential, same key), the pair
 * (`providerStore`, same keys) and the temperature, which the GA endpoint
 * takes none of (ruling 6) — plus the instructions it now owns (Stage 2
 * Gemini, ruling 4). Stored under `settings.openai.*` as before. The
 * language and voice lists are the old descriptor's, copied: nothing here
 * imports `src/services`.
 */
import { AUTO } from '../../lib/provider/languages';
import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS, migrateInstructions, type InstructionsSettings } from '../../lib/provider/instructions';
import type { CredentialsMissing, LanguageOption, MigrationInputs, ModelOption, Provider } from '../../lib/provider/types';

/** The transcription models for the source text, current generation first (`OpenAIProviderConfig.ts:292-298`); only the first two take `languages` / `keywords` (`transcription.ts`). */
export const TRANSCRIPT_MODELS = ['gpt-live-transcribe', 'gpt-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'] as const;
export type TranscriptModel = (typeof TRANSCRIPT_MODELS)[number];

export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const SEMANTIC_EAGERNESSES = ['Auto', 'Low', 'Medium', 'High'] as const;
export type SemanticEagerness = (typeof SEMANTIC_EAGERNESSES)[number];

export type NoiseReduction = 'None' | 'Near field' | 'Far field';
/** The old select's modes, in its order (`OpenAIProviderConfig.ts:288`). */
export const NOISE_REDUCTIONS: readonly NoiseReduction[] = ['None', 'Near field', 'Far field'];

/**
 * Automatic turn detection's mechanism, stored as it always was (choice 4):
 * `'Normal'` is server VAD, `'Semantic'` semantic VAD. The old field also
 * held the push modes (`'Disabled'`, OpenAI's push-to-talk, and
 * `'Push-to-Translate'`), which the global turn mode owns now; read back,
 * they are not a mechanism, and the field falls to its default.
 */
export type TurnDetectionMode = 'Normal' | 'Semantic';

export interface RealtimeSettings extends InstructionsSettings {
  /** The saved model; `effectiveRealtimeModel` decides at use, and nothing writes it back. */
  model: string;
  voice: string;
  turnDetectionMode: TurnDetectionMode;
  /** Server VAD, 0..1. */
  threshold: number;
  /** Server VAD, seconds, 0..2. */
  prefixPadding: number;
  /** Server VAD, seconds, 0..2. */
  silenceDuration: number;
  semanticEagerness: SemanticEagerness;
  /** 1..4096, or unlimited. */
  maxTokens: number | 'inf';
  transcriptModel: TranscriptModel;
  /** The raw glossary as typed: `transcription.ts` splits it, for the models that take keywords. */
  transcriptKeywords: string;
  noiseReduction: NoiseReduction;
  /**
   * The old transport choice: read and kept for the WebRTC step, never
   * shown, and not honoured — every session runs over WebSocket until that
   * step (ruling 12; choice 18).
   */
  transportType: 'websocket' | 'webrtc';
  /** Sent only for a `gpt-realtime-2*` model (`takesReasoning`). */
  reasoningEffort: ReasoningEffort;
}

export const REALTIME_DEFAULT_MODEL = 'gpt-realtime-2.1-mini';
export const REALTIME_DEFAULT_VOICE = 'alloy';

/** The old defaults (`OpenAIProviderConfig.ts:52-75`), less the temperature (ruling 6). */
export const REALTIME_DEFAULTS: RealtimeSettings = {
  ...INSTRUCTIONS_DEFAULTS,
  model: REALTIME_DEFAULT_MODEL,
  voice: REALTIME_DEFAULT_VOICE,
  turnDetectionMode: 'Normal',
  threshold: 0.49,
  prefixPadding: 0.5,
  silenceDuration: 0.5,
  semanticEagerness: 'Auto',
  maxTokens: 'inf',
  // The cheapest, the old default: upgrading is a per-user choice (`OpenAIProviderConfig.ts:63-66`).
  transcriptModel: 'gpt-4o-mini-transcribe',
  transcriptKeywords: '',
  noiseReduction: 'None',
  transportType: 'websocket',
  reasoningEffort: 'low',
};

/** The old sliders' ranges (`ProviderSpecificSettings.tsx:611-690`, `OpenAIProviderConfig.ts:320`): the view's and the builder's clamps. */
export const REALTIME_THRESHOLD_RANGE = { min: 0, max: 1, step: 0.01 } as const;
export const REALTIME_PREFIX_RANGE = { min: 0, max: 2, step: 0.01 } as const;
export const REALTIME_SILENCE_RANGE = { min: 0, max: 2, step: 0.01 } as const;
export const REALTIME_MAX_TOKENS_RANGE = { min: 1, max: 4096, step: 1 } as const;

/** The instructions' legacy keys (Stage 2 Gemini, choice 1): nothing else is read that `S` does not name (ruling 5). */
export const REALTIME_LEGACY_KEYS: readonly string[] = INSTRUCTION_LEGACY_KEYS;

const oneOf = <T extends string>(values: readonly T[], v: unknown, fallback: T): T => (values.includes(v as T) ? (v as T) : fallback);

/** A finite number as stored, else the default: the builder clamps it. */
function numberOf(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** `'inf'`, a number, or — as Electron reads back a number saved over a string default — the number's string (Stage 2 Gemini, ruling 10). */
function maxTokensOf(v: unknown): number | 'inf' {
  if (v === 'inf') return 'inf';
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : REALTIME_DEFAULTS.maxTokens;
}

/**
 * What was stored, made valid field by field, as every provider's
 * `migrate` does (ruling 5): a field of the wrong type or outside its values
 * falls to its default; clamping stays in `build`. No value is converted:
 * a push mode stored in `turnDetectionMode` is not a mechanism and reads as
 * `'Normal'`, a stored temperature is not read, and a model OpenAI has
 * deprecated stays saved — the effective model moves off it once the check
 * no longer lists it (choice 4). The instructions come from
 * `migrateInstructions`. Nothing is written back.
 */
export function migrateRealtimeSettings(stored: Readonly<Record<string, unknown>>, inputs: MigrationInputs): RealtimeSettings {
  const text = (k: 'model' | 'voice' | 'transcriptKeywords') => (typeof stored[k] === 'string' ? (stored[k] as string) : REALTIME_DEFAULTS[k]);
  return {
    ...migrateInstructions(stored, inputs.legacy),
    model: text('model'),
    voice: text('voice'),
    turnDetectionMode: oneOf<TurnDetectionMode>(['Normal', 'Semantic'], stored.turnDetectionMode, REALTIME_DEFAULTS.turnDetectionMode),
    threshold: numberOf(stored.threshold, REALTIME_DEFAULTS.threshold),
    prefixPadding: numberOf(stored.prefixPadding, REALTIME_DEFAULTS.prefixPadding),
    silenceDuration: numberOf(stored.silenceDuration, REALTIME_DEFAULTS.silenceDuration),
    semanticEagerness: oneOf(SEMANTIC_EAGERNESSES, stored.semanticEagerness, REALTIME_DEFAULTS.semanticEagerness),
    maxTokens: maxTokensOf(stored.maxTokens),
    transcriptModel: oneOf(TRANSCRIPT_MODELS, stored.transcriptModel, REALTIME_DEFAULTS.transcriptModel),
    transcriptKeywords: text('transcriptKeywords'),
    noiseReduction: oneOf(NOISE_REDUCTIONS, stored.noiseReduction, REALTIME_DEFAULTS.noiseReduction),
    transportType: oneOf<RealtimeSettings['transportType']>(['websocket', 'webrtc'], stored.transportType, REALTIME_DEFAULTS.transportType),
    reasoningEffort: oneOf(REASONING_EFFORTS, stored.reasoningEffort, REALTIME_DEFAULTS.reasoningEffort),
  };
}

/** The prebuilt voices (`OpenAIProviderConfig.ts:249-260`). */
export const REALTIME_VOICES: readonly { value: string; name: string }[] = [
  { name: 'Alloy', value: 'alloy' },
  { name: 'Ash', value: 'ash' },
  { name: 'Ballad', value: 'ballad' },
  { name: 'Cedar', value: 'cedar' },
  { name: 'Coral', value: 'coral' },
  { name: 'Echo', value: 'echo' },
  { name: 'Marin', value: 'marin' },
  { name: 'Sage', value: 'sage' },
  { name: 'Shimmer', value: 'shimmer' },
  { name: 'Verse', value: 'verse' },
];

/** The 55 languages the old provider offered (`OpenAIProviderConfig.ts:191-247`): every one a source and a target. */
export const REALTIME_LANGUAGES: readonly LanguageOption[] = [
  { name: 'العربية', value: 'ar', englishName: 'Arabic' },
  { name: 'አማርኛ', value: 'am', englishName: 'Amharic' },
  { name: 'Български', value: 'bg', englishName: 'Bulgarian' },
  { name: 'বাংলা', value: 'bn', englishName: 'Bengali' },
  { name: 'Català', value: 'ca', englishName: 'Catalan' },
  { name: 'Čeština', value: 'cs', englishName: 'Czech' },
  { name: 'Dansk', value: 'da', englishName: 'Danish' },
  { name: 'Deutsch', value: 'de', englishName: 'German' },
  { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
  { name: 'English', value: 'en', englishName: 'English' },
  { name: 'English (Australia)', value: 'en_AU', englishName: 'English (Australia)' },
  { name: 'English (Great Britain)', value: 'en_GB', englishName: 'English (Great Britain)' },
  { name: 'English (USA)', value: 'en_US', englishName: 'English (USA)' },
  { name: 'Español', value: 'es', englishName: 'Spanish' },
  { name: 'Español (Latinoamérica)', value: 'es_419', englishName: 'Spanish (Latin America and Caribbean)' },
  { name: 'Eesti', value: 'et', englishName: 'Estonian' },
  { name: 'فارسی', value: 'fa', englishName: 'Persian' },
  { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
  { name: 'Filipino', value: 'fil', englishName: 'Filipino' },
  { name: 'Français', value: 'fr', englishName: 'French' },
  { name: 'ગુજરાતી', value: 'gu', englishName: 'Gujarati' },
  { name: 'עברית', value: 'he', englishName: 'Hebrew' },
  { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
  { name: 'Hrvatski', value: 'hr', englishName: 'Croatian' },
  { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
  { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
  { name: 'Italiano', value: 'it', englishName: 'Italian' },
  { name: '日本語', value: 'ja', englishName: 'Japanese' },
  { name: 'ಕನ್ನಡ', value: 'kn', englishName: 'Kannada' },
  { name: '한국어', value: 'ko', englishName: 'Korean' },
  { name: 'Lietuvių', value: 'lt', englishName: 'Lithuanian' },
  { name: 'Latviešu', value: 'lv', englishName: 'Latvian' },
  { name: 'മലയാളം', value: 'ml', englishName: 'Malayalam' },
  { name: 'मराठी', value: 'mr', englishName: 'Marathi' },
  { name: 'Bahasa Melayu', value: 'ms', englishName: 'Malay' },
  { name: 'Nederlands', value: 'nl', englishName: 'Dutch' },
  { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
  { name: 'Polski', value: 'pl', englishName: 'Polish' },
  { name: 'Português (Brasil)', value: 'pt_BR', englishName: 'Portuguese (Brazil)' },
  { name: 'Português (Portugal)', value: 'pt_PT', englishName: 'Portuguese (Portugal)' },
  { name: 'Română', value: 'ro', englishName: 'Romanian' },
  { name: 'Русский', value: 'ru', englishName: 'Russian' },
  { name: 'Slovenčina', value: 'sk', englishName: 'Slovak' },
  { name: 'Slovenščina', value: 'sl', englishName: 'Slovenian' },
  { name: 'Српски', value: 'sr', englishName: 'Serbian' },
  { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
  { name: 'Kiswahili', value: 'sw', englishName: 'Swahili' },
  { name: 'தமிழ்', value: 'ta', englishName: 'Tamil' },
  { name: 'తెలుగు', value: 'te', englishName: 'Telugu' },
  { name: 'ไทย', value: 'th', englishName: 'Thai' },
  { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
  { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
  { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
  { name: '中文 (中国)', value: 'zh_CN', englishName: 'Chinese (China)' },
  { name: '中文 (台灣)', value: 'zh_TW', englishName: 'Chinese (Taiwan)' },
];

/** "Auto-detect" stays a source (ruling 7): the model hears any language. Named as the other providers name it; the picker shows `common.autoDetect`. */
const AUTO_SOURCE: LanguageOption = { value: AUTO, name: 'Auto', englishName: 'Auto' };

/**
 * `AUTO` first, then the 55, as the old picker listed them (`LanguageSection.tsx:587-589`);
 * every language a target for every source, the source included (the old
 * `resolveTargetLanguages`). D20 refuses Both for an `AUTO` source: it
 * never reverses.
 */
export const realtimeLanguages: Provider<RealtimeSettings, never, never>['languages'] = {
  sources: () => [AUTO_SOURCE, ...REALTIME_LANGUAGES],
  targets: () => REALTIME_LANGUAGES,
  initial: () => ({ source: 'en', target: 'zh_CN' }),
};

/**
 * A code's English name, for the instructions' template (the old rule: the
 * code when unnamed, `settingsStore.ts:1443-1444`). `AUTO` is "the spoken
 * language" (ruling 7), where the old template read "auto".
 */
export function realtimeLanguageName(code: string): string {
  if (code === AUTO) return 'the spoken language';
  return REALTIME_LANGUAGES.find((o) => o.value === code)?.englishName || code;
}

export interface RealtimeCredentials {
  apiKey: string;
}

export const realtimeCredentials: Provider<RealtimeSettings, RealtimeCredentials, never>['credentials'] = {
  keys: ['apiKey'],
  fields: () => [{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }],
  read: (values): RealtimeCredentials | CredentialsMissing => {
    // Trimmed (choice 19): the key rides in a subprotocol, and a pasted trailing newline or space is no valid token.
    const apiKey = (values.apiKey ?? '').trim();
    // No code: the runner words it `credentials_missing` ("Enter your API key in Settings before starting.").
    return apiKey ? { apiKey } : { missing: 'Enter your OpenAI API key.' };
  },
};

/**
 * A voice-agent model (`OpenAIClient.ts:250-259`): an id starting
 * `gpt-realtime`, less the transcription and translation families, which
 * are other providers' (OpenAI Translate's, a transcriber's).
 */
export function isRealtimeModelId(id: string): boolean {
  const name = id.toLowerCase();
  return name.startsWith('gpt-realtime') && !name.startsWith('gpt-realtime-whisper') && !name.startsWith('gpt-realtime-translate');
}

/**
 * The model a session runs (spec: "Readiness is one check"): the saved one
 * when the check listed it, else the default model when listed — so a model
 * OpenAI stopped listing runs as the default, whatever sorts newest — else
 * the newest listed, else the saved one while nothing is listed yet (choice
 * 4). The settings view and `build` call this same function; nothing writes
 * it back (the old auto-select's write-back, `settingsStore.ts:1174-1191`,
 * is gone).
 */
export function effectiveRealtimeModel(s: Pick<RealtimeSettings, 'model'>, models: readonly ModelOption[]): string {
  if (models.some((m) => m.id === s.model)) return s.model;
  if (models.some((m) => m.id === REALTIME_DEFAULT_MODEL)) return REALTIME_DEFAULT_MODEL;
  return models[0]?.id ?? s.model;
}

/** Only `gpt-realtime-2*` takes `reasoning.effort`; older models refuse it (`openAIRealtimeSession.ts:106-108`). */
export function takesReasoning(model: string): boolean {
  return model.startsWith('gpt-realtime-2');
}
```

- [ ] **Step 5: Copy the transcription hints.** Create `src/providers/openai/transcription.ts` (from `OTC`, less the reverse helpers; `buildTranscriptionHint` is the old `buildInputAudioTranscription` with a required model):

```ts
/**
 * The source transcript's hints for a Realtime session's
 * `audio.input.transcription` (choice 5): copied, pure, from
 * `src/services/providers/openaiTranscriptionContext.ts` (the deletion plan
 * removes that copy with the old client), less its reverse helpers — the
 * builder takes each leg's own direction, so the participant's hint is
 * built for the language it hears (D17).
 *
 * What the object accepts depends on the transcription model, and getting it
 * wrong refuses the whole `session.update` — verified against the live API
 * on 2026-08-01 (model `gpt-realtime-2.1-mini`, session type `realtime`):
 *
 *   | field       | gpt-4o-*-transcribe / whisper-1 | gpt-transcribe / gpt-live-transcribe |
 *   |-------------|---------------------------------|--------------------------------------|
 *   | `language`  | accepted (singular)             | accepted                             |
 *   | `languages` | REJECTED: "not supported"       | accepted (min length 1)              |
 *   | `keywords`  | REJECTED: "not supported"       | accepted (array of strings)          |
 *
 * The `openai` SDK's `AudioTranscription` type lacks `languages` and
 * `keywords`: the wire widens it.
 */

/** Transcription models that accept the `languages` / `keywords` hints. */
const CONTEXT_CAPABLE_MODELS: ReadonlySet<string> = new Set(['gpt-transcribe', 'gpt-live-transcribe']);

/**
 * Language codes the transcription config accepts: the enumeration the API
 * returns when it refuses a code, plus `fil` and `yue`, absent from it yet
 * accepted when probed. Anything else is dropped rather than sent: a
 * refused `session.update` is a dead session.
 */
const SUPPORTED_LANGUAGE_CODES: ReadonlySet<string> = new Set([
  'af', 'ar', 'az', 'be', 'bg', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el',
  'en', 'es', 'et', 'fa', 'fi', 'fr', 'gl', 'he', 'hi', 'hr', 'hu', 'hy',
  'id', 'is', 'it', 'iw', 'ja', 'kk', 'kn', 'ko', 'lt', 'lv', 'mi', 'mk',
  'mr', 'ms', 'ne', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr',
  'sv', 'sw', 'ta', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'zh',
  'fil', 'yue',
]);

/** The `audio.input.transcription` payload. */
export interface TranscriptionHint {
  model: string;
  language?: string;
  languages?: string[];
  keywords?: string[];
}

/** True when `model` accepts the `languages` / `keywords` hints. */
export function supportsTranscriptionContext(model: string | undefined): boolean {
  return !!model && CONTEXT_CAPABLE_MODELS.has(model);
}

/**
 * A language value as a code the config accepts, or null: the region
 * stripped (`en_AU`, `zh_CN`, `es_419` are refused), three-letter codes kept
 * whole, and a language with no supported code — `auto` among them — none.
 */
export function normalizeTranscriptionLanguage(value: string | undefined | null): string | null {
  if (!value) return null;
  const lower = value.trim().toLowerCase();
  if (!lower) return null;
  if (SUPPORTED_LANGUAGE_CODES.has(lower)) return lower;
  const base = lower.split(/[_-]/)[0];
  return SUPPORTED_LANGUAGE_CODES.has(base) ? base : null;
}

/** A typed glossary as the array the API wants: split on commas, full-width commas and newlines; trimmed; each term once. */
export function parseTranscriptionKeywords(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,、，\r\n]+/)) {
    const term = part.trim();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
  }
  return out;
}

/** The hint for `model` hearing `sourceLanguage`, with only the fields that model accepts. */
export function buildTranscriptionHint(model: string, sourceLanguage: string | undefined, rawKeywords: string | undefined): TranscriptionHint {
  const hint: TranscriptionHint = { model };
  const language = normalizeTranscriptionLanguage(sourceLanguage);
  const keywords = parseTranscriptionKeywords(rawKeywords);
  if (supportsTranscriptionContext(model)) {
    // `languages` refuses an empty array: omitted when the language has no code.
    if (language) hint.languages = [language];
    if (keywords.length > 0) hint.keywords = keywords;
  } else if (language) {
    hint.language = language;
  }
  return hint;
}
```

- [ ] **Step 6: Write the builder.** Create `src/providers/openai/config.ts`:

```ts
/**
 * OpenAI Realtime's `C`, `build` and `describe` (survey §2.10). One builder
 * for both legs: the participant is the same call on the reversed
 * direction, so its prompt (Other's, in Advanced mode) and its
 * transcription hint follow from `context` — the old participant overrides
 * (`OpenAIProviderConfig.ts:174-189`, `ProviderDescriptor.ts:389-407`) are
 * gone. Its automatic detection is the user's own (ruling 4), and it speaks
 * when its switch is on (ruling 15): `context.speech` says so.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { resolveInstructions } from '../../lib/provider/instructions';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import {
  effectiveRealtimeModel, realtimeLanguageName, REALTIME_DEFAULTS, REALTIME_DEFAULT_VOICE, REALTIME_MAX_TOKENS_RANGE, REALTIME_PREFIX_RANGE,
  REALTIME_SILENCE_RANGE, REALTIME_THRESHOLD_RANGE, takesReasoning, type NoiseReduction, type ReasoningEffort, type RealtimeSettings,
} from './settings';
import { buildTranscriptionHint, type TranscriptionHint } from './transcription';

/** Automatic detection as the wire takes it (`openAIRealtimeSession.ts:13-41`); the adapter adds `create_response: true, interrupt_response: false`. */
export type TurnDetection =
  | { type: 'server_vad'; threshold: number; prefixPaddingMs: number; silenceDurationMs: number }
  | { type: 'semantic_vad'; eagerness: 'auto' | 'low' | 'medium' | 'high' };

export interface RealtimeConfig {
  /** The effective model (`effectiveRealtimeModel` over this run's own check, F2), in the socket's `?model=`. */
  model: string;
  /** This direction's prompt: the session's, and the drift anchor's (ruling 2). */
  instructions: string;
  /** Audio out, or text only: `context.speech`. */
  modalities: ['audio'] | ['text'];
  /** A leg that speaks: a prebuilt voice. */
  voice?: string;
  maxTokens: number | 'inf';
  /** Manual turns: `null`, the client commits. Auto: the user's mechanism and knobs, the participant's too (ruling 4). */
  turnDetection: TurnDetection | null;
  /** From this direction's source (D17): the participant's hint is for the language it hears. */
  transcription: TranscriptionHint;
  /** `null` turns it off (ruling 16). */
  noiseReduction: 'near_field' | 'far_field' | null;
  /** A `gpt-realtime-2*` model only. */
  reasoningEffort?: ReasoningEffort;
  /** WebSocket only (ruling 12): the WebRTC step widens it, from `S.transportType` (choice 18). */
  transport: 'websocket';
}

const NOISE: Readonly<Record<NoiseReduction, RealtimeConfig['noiseReduction']>> = {
  None: null,
  'Near field': 'near_field',
  'Far field': 'far_field',
};

const clamp = (v: number, range: { min: number; max: number }, fallback: number) => (Number.isFinite(v) ? Math.min(range.max, Math.max(range.min, v)) : fallback);

export function buildRealtime(context: SessionContext, s: RealtimeSettings, shared: SharedSettings): RealtimeConfig | ProviderRefusal {
  const model = effectiveRealtimeModel(s, shared.models);
  // A guard: the runner builds only after a ready answer, whose list is never empty.
  if (!model) return { refused: 'No OpenAI Realtime model is available to this key.', code: 'models_required' };
  const { source, target } = context.direction;
  // The participant's direction reads Other's prompt, as Gemini's and LocalInference's builders do.
  const instructions = resolveInstructions(s, { participant: shared.reversed(context.direction), source: realtimeLanguageName(source), target: realtimeLanguageName(target) });
  const turnDetection: TurnDetection | null = context.turns === 'manual'
    ? null
    : s.turnDetectionMode === 'Semantic'
      ? { type: 'semantic_vad', eagerness: s.semanticEagerness.toLowerCase() as 'auto' | 'low' | 'medium' | 'high' }
      : {
          type: 'server_vad',
          threshold: clamp(s.threshold, REALTIME_THRESHOLD_RANGE, REALTIME_DEFAULTS.threshold),
          // Seconds as stored, milliseconds on the wire (`openAIRealtimeSession.ts:31-35`).
          prefixPaddingMs: Math.round(clamp(s.prefixPadding, REALTIME_PREFIX_RANGE, REALTIME_DEFAULTS.prefixPadding) * 1000),
          silenceDurationMs: Math.round(clamp(s.silenceDuration, REALTIME_SILENCE_RANGE, REALTIME_DEFAULTS.silenceDuration) * 1000),
        };
  return {
    model,
    instructions,
    modalities: context.speech ? ['audio'] : ['text'],
    ...(context.speech ? { voice: s.voice || REALTIME_DEFAULT_VOICE } : {}),
    // A non-finite count reads as unlimited, the default (Stage 2 Gemini's fix round 1).
    maxTokens: s.maxTokens === 'inf' || !Number.isFinite(s.maxTokens) ? 'inf' : Math.round(clamp(s.maxTokens, REALTIME_MAX_TOKENS_RANGE, REALTIME_MAX_TOKENS_RANGE.max)),
    turnDetection,
    transcription: buildTranscriptionHint(s.transcriptModel, source, s.transcriptKeywords),
    noiseReduction: NOISE[s.noiseReduction],
    ...(takesReasoning(model) ? { reasoningEffort: s.reasoningEffort } : {}),
    // `s.transportType` is not read: a stored `webrtc` runs over WebSocket until the WebRTC step (ruling 12).
    transport: 'websocket',
  };
}

/** Two models: the translation's and the source transcript's (choice 20); the old start event named neither. */
export function describeRealtime(c: RealtimeConfig): { translationModel: string; asrModel: string } {
  return { translationModel: c.model, asrModel: c.transcription.model };
}
```

- [ ] **Step 7: Run them to see them pass, with the session-side guard.**

Run: `npx vitest run src/providers/openai/settings.test.ts src/providers/openai/transcription.test.ts src/providers/openai/config.test.ts src/providers/sessionSide.consistency.test.ts`
Expected: PASS — 4 files, 40 tests. The guard finds the seed `adapter.ts` in the new folder.

- [ ] **Step 8: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 9: Commit.**

```bash
git add src/providers/openai/adapter.ts src/providers/openai/settings.ts src/providers/openai/settings.test.ts src/providers/openai/transcription.ts src/providers/openai/transcription.test.ts src/providers/openai/config.ts src/providers/openai/config.test.ts
```

```bash
git commit -q -F - -- src/providers/openai/adapter.ts src/providers/openai/settings.ts src/providers/openai/settings.test.ts src/providers/openai/transcription.ts src/providers/openai/transcription.test.ts src/providers/openai/config.ts src/providers/openai/config.test.ts <<'EOF'
feat(openai): OpenAI Realtime's settings, transcription hints and builder

The stored slice read as it is (no one-time conversion, ruling 5): the
turn mode keeps its field, the temperature is gone (ruling 6), "Auto-detect"
stays a source (ruling 7), noise "None" is null (ruling 16), and each leg
gets the participant's own detection (ruling 4).

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---
### Task 6: The wire, the socket seam and the fixtures (Wave 2)

**Files:**
- Create: `src/providers/openai/wire.ts`, `src/providers/openai/socket.ts`, `src/providers/openai/testing.ts`
- Test: `src/providers/openai/wire.test.ts`, `src/providers/openai/socket.test.ts`, `src/providers/openai/wire.oracle.test.ts`

**Interfaces:**
- Consumes: `pcmToBase64` (Task 1); `RealtimeConfig`, `TurnDetection`, `buildRealtime` (Task 5); `RealtimeCredentials`, `RealtimeSettings`, `REALTIME_DEFAULTS` (Task 5); `TranscriptionHint` (Task 5); the SDK's realtime types (`import type`); `FakeSocket` (the kit).
- Produces:
  - `wire.ts`: `REALTIME_WS_URL`, `realtimeUrl(c): string`, `realtimeProtocols(k): string[]` (the one reader of the key), `WireSessionUpdate`, `sessionUpdate(c): WireSessionUpdate`, `appendFrame(pcm): string`, `COMMIT`, `CLEAR`, `textItem(itemId, text)`, `responseCreate(eventId)` (with `metadata: { request: eventId }`), `requestOf(response): string | undefined`, `ANCHOR_METADATA`, `anchorResponse(eventId, instructions)`, `isOutOfBand(response): boolean`, `ServerEvent`, `decodeServerEvent(data): ServerEvent` (throws on an unreadable frame), `unwrapTranslationText(text)`, `ErrorCode = 'auth' | 'rate_limit' | 'client' | 'server' | 'segment_ended'`, `errorCode(e)`, `errorWords(e)`;
  - `socket.ts`: `OpenSocket = (url, protocols) => WebSocket`, `nativeSocket` (rethrows `The browser would not open the socket (<name>).`), `WS_OPEN = 1`;
  - `testing.ts` (test-only): `KEY`, `RefusingWebSocket`, `SHARED`, `AUTO_CTX` (ja → en, automatic), `MANUAL_CTX`, `configFor(context?, patch?)`, `b64(samples, fill?)`, `USAGE`, `SERVER` (one builder per server event, each returning its JSON text), `exchange(n, { source?, translation?, previous? })` (one committed utterance and its spoken translation, in the GA order). Task 11 appends the harness.

- [ ] **Step 1: Write the fixtures.** Create `src/providers/openai/testing.ts` (it builds each `C` through `buildRealtime`, so the suites test what `build` makes):

```ts
/**
 * The OpenAI Realtime suites' fixtures: a key, the settings the suites build
 * from, the server's events as the JSON text frames the GA endpoint sends,
 * and a browser that refuses the socket. Test-only: nothing but a test
 * imports it (the session-side guard's kit rule counts every provider's
 * `testing.ts` as kit and holds it to that), and the adapter's session walk
 * never reaches it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildRealtime, type RealtimeConfig } from './config';
import { REALTIME_DEFAULTS, type RealtimeCredentials, type RealtimeSettings } from './settings';

/** Shaped as a real key (`sk-…`), which `redact()` masks: a frame that carried it fails the kit's `frame-secret` rule. */
export const KEY: RealtimeCredentials = { apiKey: 'sk-proj-realtimeKey0123456789' };

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
  models: [{ id: 'gpt-realtime-2.1-mini' }, { id: 'gpt-realtime-2.1' }],
};
export const AUTO_CTX: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
export const MANUAL_CTX: SessionContext = { ...AUTO_CTX, turns: 'manual' };

/** A leg's config: the defaults, patched. A refusal is a fixture bug, not a case any suite means to build — it throws loudly rather than hiding behind a cast. */
export function configFor(context: SessionContext = AUTO_CTX, patch: Partial<RealtimeSettings> = {}): RealtimeConfig {
  const c = buildRealtime(context, { ...REALTIME_DEFAULTS, ...patch }, SHARED);
  if ('refused' in c) throw new Error(c.refused);
  return c;
}

/** `samples` of 24 kHz pcm16 as an audio delta carries it: base64 of little-endian Int16. */
export function b64(samples: number, fill = 900): string {
  let binary = '';
  for (const byte of new Uint8Array(new Int16Array(samples).fill(fill).buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const event = (e: Record<string, unknown>) => JSON.stringify({ event_id: 'event_1', ...e });
/** The session as `session.created` reports it: the server's defaults. */
const SESSION = {
  type: 'realtime', object: 'realtime.session', id: 'sess_1', model: 'gpt-realtime-2.1-mini', expires_at: 1_790_000_000, output_modalities: ['audio'],
  audio: { input: { noise_reduction: null, transcription: null, turn_detection: { type: 'server_vad', threshold: 0.5 } }, output: { voice: 'alloy' } },
};
const item = (id: string, role: 'user' | 'assistant', status = 'in_progress') => ({ id, object: 'realtime.item', type: 'message', role, status, content: [] });
/** A response as the server reports it: out of band with the anchor's metadata; in band naming the request that asked for it, or — the server's own detection's — nothing. */
const response = (id: string, o: { outOfBand?: boolean; request?: string; status?: string; statusDetails?: unknown; usage?: unknown }) => ({
  id, object: 'realtime.response', status: o.status ?? 'in_progress', status_details: o.statusDetails ?? null, output: [],
  conversation_id: o.outOfBand ? null : 'conv_1', metadata: o.outOfBand ? { purpose: 'anchor' } : o.request ? { request: o.request } : null,
  ...(o.usage ? { usage: o.usage } : {}),
});
export const USAGE = { total_tokens: 1_200, input_tokens: 1_000, output_tokens: 200, input_token_details: { cached_tokens: 800, text_tokens: 900, audio_tokens: 100 } };

/** The server's events, by name, as the GA endpoint sends them: JSON text frames. Item ids are the server's (`item_…`), or ours (`sokuji_text_…`). */
export const SERVER = {
  created: () => event({ type: 'session.created', session: SESSION }),
  updated: () => event({ type: 'session.updated', session: { ...SESSION, reasoning: { effort: 'low' }, audio: { ...SESSION.audio, input: { ...SESSION.audio.input, transcription: { model: 'gpt-4o-mini-transcribe', language: 'ja' } } } } }),
  speechStarted: (itemId: string, ms = 0) => event({ type: 'input_audio_buffer.speech_started', item_id: itemId, audio_start_ms: ms }),
  speechStopped: (itemId: string, ms = 0) => event({ type: 'input_audio_buffer.speech_stopped', item_id: itemId, audio_end_ms: ms }),
  committed: (itemId: string, previous: string | null = null) => event({ type: 'input_audio_buffer.committed', item_id: itemId, previous_item_id: previous }),
  cleared: () => event({ type: 'input_audio_buffer.cleared' }),
  /** `conversation.item.added`: an input item (a commit's, a typed text's) or a response's assistant item, after `previous`. */
  itemAdded: (itemId: string, role: 'user' | 'assistant', previous: string | null = null) => event({ type: 'conversation.item.added', previous_item_id: previous, item: item(itemId, role) }),
  inputDelta: (itemId: string, delta: string) => event({ type: 'conversation.item.input_audio_transcription.delta', item_id: itemId, content_index: 0, delta }),
  inputDone: (itemId: string, transcript: string) => event({ type: 'conversation.item.input_audio_transcription.completed', item_id: itemId, content_index: 0, transcript, usage: { type: 'duration', seconds: 2 } }),
  inputFailed: (itemId: string) => event({ type: 'conversation.item.input_audio_transcription.failed', item_id: itemId, content_index: 0, error: { type: 'transcription_error', code: 'audio_unintelligible', message: 'Audio was unintelligible.' } }),
  responseCreated: (responseId: string, o: { outOfBand?: boolean; request?: string } = {}) => event({ type: 'response.created', response: response(responseId, o) }),
  outputItemAdded: (responseId: string, itemId: string) => event({ type: 'response.output_item.added', response_id: responseId, output_index: 0, item: item(itemId, 'assistant') }),
  transcriptDelta: (responseId: string, itemId: string, delta: string) => event({ type: 'response.output_audio_transcript.delta', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, delta }),
  transcriptDone: (responseId: string, itemId: string, transcript: string) => event({ type: 'response.output_audio_transcript.done', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, transcript }),
  textDelta: (responseId: string, itemId: string, delta: string) => event({ type: 'response.output_text.delta', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, delta }),
  textDone: (responseId: string, itemId: string, text: string) => event({ type: 'response.output_text.done', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, text }),
  /** Content audio: 100 ms by default. */
  audio: (responseId: string, itemId: string, o: { samples?: number; fill?: number } = {}) =>
    event({ type: 'response.output_audio.delta', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, delta: b64(o.samples ?? 2_400, o.fill ?? 900) }),
  audioDone: (responseId: string, itemId: string) => event({ type: 'response.output_audio.done', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0 }),
  outputItemDone: (responseId: string, itemId: string) => event({ type: 'response.output_item.done', response_id: responseId, output_index: 0, item: item(itemId, 'assistant', 'completed') }),
  responseDone: (responseId: string, o: { outOfBand?: boolean; request?: string; status?: string; statusDetails?: unknown } = {}) =>
    event({ type: 'response.done', response: response(responseId, { ...o, status: o.status ?? 'completed', usage: USAGE }) }),
  error: (e: { type?: string; code?: string | null; message?: string; event_id?: string | null } = {}) =>
    event({ type: 'error', error: { type: 'invalid_request_error', code: null, message: 'Something was wrong.', param: null, event_id: null, ...e } }),
  rateLimits: () => event({ type: 'rate_limits.updated', rate_limits: [{ name: 'tokens', limit: 40_000, remaining: 39_000, reset_seconds: 1.5 }] }),
  /** An event by its type alone. */
  bare: (type: string) => event({ type }),
};

/**
 * One whole spoken exchange as the server sends it under automatic turns
 * (`n` numbers its ids): the commit and its input item, the response and
 * its assistant item added after the input, the source and translation
 * transcripts, 100 ms of audio, and the ends.
 */
export function exchange(n: number, o: { source?: string; translation?: string; previous?: string | null } = {}): string[] {
  const input = `item_in_${n}`;
  const out = `item_out_${n}`;
  const resp = `resp_${n}`;
  return [
    SERVER.speechStarted(input),
    SERVER.speechStopped(input),
    SERVER.committed(input, o.previous ?? null),
    SERVER.itemAdded(input, 'user', o.previous ?? null),
    SERVER.responseCreated(resp),
    SERVER.outputItemAdded(resp, out),
    SERVER.itemAdded(out, 'assistant', input),
    SERVER.transcriptDelta(resp, out, o.translation ?? 'Hello.'),
    SERVER.audio(resp, out),
    SERVER.inputDone(input, o.source ?? 'こんにちは。'),
    SERVER.transcriptDone(resp, out, o.translation ?? 'Hello.'),
    SERVER.audioDone(resp, out),
    SERVER.outputItemDone(resp, out),
    SERVER.responseDone(resp),
  ];
}
```

- [ ] **Step 2: Write the failing tests.** Create `src/providers/openai/wire.test.ts` — it includes Translate's TypeScript-AST scan holding `realtimeProtocols` as the one reader of the key, with its two evasions as controls:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { base64ToPcm } from '../../lib/contract/pcm64';
import { redact } from '../../lib/diagnostics/redact';
import { AUTO_CTX, configFor, KEY, MANUAL_CTX, SERVER } from './testing';
import {
  anchorResponse, appendFrame, CLEAR, COMMIT, decodeServerEvent, errorCode, errorWords, isOutOfBand, REALTIME_WS_URL, realtimeProtocols,
  realtimeUrl, requestOf, responseCreate, sessionUpdate, textItem, unwrapTranslationText,
} from './wire';

/** The names the key is read through: the credentials' type and its one field. A string literal naming either counts too (an indexed or dynamic-property read), and so does any use of the protocol builder outside its own declaration (OpenAI Translate's `wire.test.ts` scan). */
const SECRET_NAMES = new Set(['RealtimeCredentials', 'apiKey']);
const BUILDER_NAME = 'realtimeProtocols';

/** The functions of a module that name the key, `<module>` for a use outside any function; an import names nothing. */
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
  const isBuilderDeclaration = (node: ts.Identifier): boolean => ts.isFunctionDeclaration(node.parent) && node.parent.name === node;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && (SECRET_NAMES.has(node.text) || (node.text === BUILDER_NAME && !isBuilderDeclaration(node)))) readers.add(enclosing(node));
    if (ts.isStringLiteralLike(node) && SECRET_NAMES.has(node.text)) readers.add(enclosing(node));
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('scan.ts', source, ts.ScriptTarget.Latest, true));
  return [...readers].sort();
}

describe("OpenAI Realtime's wire: the socket", () => {
  it('dials the GA endpoint with the model in its query, and authenticates with two subprotocols — never the beta tag (choice 7)', () => {
    expect(REALTIME_WS_URL).toBe('wss://api.openai.com/v1/realtime');
    expect(realtimeUrl(configFor())).toBe('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini');
    expect(realtimeProtocols(KEY)).toEqual(['realtime', 'openai-insecure-api-key.sk-proj-realtimeKey0123456789']);
    expect(realtimeProtocols(KEY).some((p) => p.startsWith('openai-beta'))).toBe(false);
    // The URL carries no credential: the key is in the protocols alone.
    expect(realtimeUrl(configFor())).not.toContain(KEY.apiKey);
  });

  it('reads the key, in `wire.ts`, in the protocol builder alone; the protocols, wherever they land, are masked by their carrier (choice 7)', () => {
    expect(secretReaders(readFileSync(resolve(__dirname, 'wire.ts'), 'utf-8'))).toEqual(['realtimeProtocols']);
    // The scan's control: a read in any other function, nested or not, or at the top level, is named; an import is not; an indexed read and a forwarded call are named too.
    expect(secretReaders([
      "import type { RealtimeCredentials } from './settings';",
      'export function url(k: RealtimeCredentials) { return k.apiKey; }',
      'export const frame = (k: { apiKey: string }) => [k].map((c) => c.apiKey);',
      "const leaked = { apiKey: 'x' };",
      "export function leakIndexed(k: Record<string, string>) { return k['apiKey']; }",
      'export function leakForwarded(k: Parameters<typeof realtimeProtocols>[0]) { return realtimeProtocols(k).join(", "); }',
    ].join('\n'))).toEqual(['<module>', 'frame', 'leakForwarded', 'leakIndexed', 'url']);
    // A key of no key shape: the carrier rule masks it.
    expect(redact(realtimeProtocols({ apiKey: '0a1b2c3d' }).join(', '))).toBe('realtime, openai-insecure-api-key.[REDACTED]');
  });
});

describe("OpenAI Realtime's wire: session.update", () => {
  it('configures a translator: its instructions, no tools, audio out in the voice, server VAD that answers each turn and never interrupts, the hint, noise off as null, reasoning (`openAIRealtimeSession.ts:61-111`; ruling 16)', () => {
    const c = configFor();
    expect(sessionUpdate(c)).toEqual({
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['audio'],
        instructions: c.instructions,
        max_output_tokens: 'inf',
        tool_choice: 'none',
        tools: [],
        audio: {
          input: {
            turn_detection: { type: 'server_vad', create_response: true, interrupt_response: false, threshold: 0.49, prefix_padding_ms: 500, silence_duration_ms: 500 },
            transcription: { model: 'gpt-4o-mini-transcribe', language: 'ja' },
            noise_reduction: null,
          },
          output: { voice: 'alloy' },
        },
        reasoning: { effort: 'low' },
      },
    });
  });

  it('sends no temperature, whatever was stored (ruling 6), and no model: the socket names it', () => {
    const session = sessionUpdate(configFor(AUTO_CTX, { maxTokens: 2048 })).session;
    expect(session).not.toHaveProperty('temperature');
    expect(session).not.toHaveProperty('model');
    expect(session.max_output_tokens).toBe(2048);
  });

  it('asks for text alone, with no voice, from a leg that does not speak; for no detection under manual turns; semantic VAD by its eagerness', () => {
    const silent = sessionUpdate(configFor({ ...AUTO_CTX, speech: false })).session;
    expect(silent.output_modalities).toEqual(['text']);
    expect(silent.audio).not.toHaveProperty('output');
    expect(sessionUpdate(configFor(MANUAL_CTX)).session.audio.input.turn_detection).toBeNull();
    expect(sessionUpdate(configFor(AUTO_CTX, { turnDetectionMode: 'Semantic', semanticEagerness: 'High' })).session.audio.input.turn_detection)
      .toEqual({ type: 'semantic_vad', create_response: true, interrupt_response: false, eagerness: 'high' });
  });

  it('sends a chosen noise reduction as its type, the context hints to the models that take them, and reasoning to gpt-realtime-2* alone', () => {
    const update = sessionUpdate(configFor(AUTO_CTX, { noiseReduction: 'Far field', transcriptModel: 'gpt-live-transcribe', transcriptKeywords: 'Sokuji, Kizuna AI' }));
    expect(update.session.audio.input.noise_reduction).toEqual({ type: 'far_field' });
    expect(update.session.audio.input.transcription).toEqual({ model: 'gpt-live-transcribe', languages: ['ja'], keywords: ['Sokuji', 'Kizuna AI'] });
    expect(sessionUpdate({ ...configFor(), model: 'gpt-realtime-mini', reasoningEffort: undefined }).session).not.toHaveProperty('reasoning');
  });
});

describe("OpenAI Realtime's wire: the client's frames", () => {
  it("sends a chunk as base64 of the view's own bytes, and commits and clears the buffer by name", () => {
    const view = new Int16Array([7, 1, -2, 300, 9]).subarray(1, 4);
    const frame = JSON.parse(appendFrame(view)) as { type: string; audio: string };
    expect(frame.type).toBe('input_audio_buffer.append');
    expect(Object.keys(frame)).toEqual(['type', 'audio']);
    expect(Array.from(base64ToPcm(frame.audio))).toEqual([1, -2, 300]);
    expect(COMMIT).toEqual({ type: 'input_audio_buffer.commit' });
    expect(CLEAR).toEqual({ type: 'input_audio_buffer.clear' });
  });

  it('sends typed text as an input item of its own id, and an in-band response by an event id (`OpenAIGAClient.ts:819-867`; choice 10)', () => {
    expect(textItem('sokuji_text_1', 'Hello there')).toEqual({
      type: 'conversation.item.create',
      item: { id: 'sokuji_text_1', type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello there' }] },
    });
    expect(responseCreate('sokuji_3')).toEqual({ type: 'response.create', event_id: 'sokuji_3', response: { metadata: { request: 'sokuji_3' } } });
    expect(requestOf({ metadata: { request: 'sokuji_3' } })).toBe('sokuji_3');
    expect(requestOf({ metadata: null })).toBeUndefined();
    expect(requestOf({ metadata: { request: 3 } })).toBeUndefined();
    expect(requestOf(undefined)).toBeUndefined();
  });

  it('sends the drift anchor out of band, as text, with the instructions when there are any, marked as the anchor (ruling 2)', () => {
    expect(anchorResponse('sokuji_1', 'Translate.')).toEqual({
      type: 'response.create', event_id: 'sokuji_1',
      response: { conversation: 'none', output_modalities: ['text'], instructions: 'Translate.', metadata: { purpose: 'anchor' } },
    });
    expect(anchorResponse('sokuji_2', '').response).not.toHaveProperty('instructions');
  });
});

describe("OpenAI Realtime's wire: what comes down", () => {
  it('decodes a text frame and a binary one, and refuses what is not a JSON object with a type (choice 15)', () => {
    expect(decodeServerEvent(SERVER.cleared())).toEqual({ event_id: 'event_1', type: 'input_audio_buffer.cleared' });
    const bytes = new TextEncoder().encode(SERVER.cleared());
    expect(decodeServerEvent(bytes.buffer.slice(0) as ArrayBuffer).type).toBe('input_audio_buffer.cleared');
    expect(() => decodeServerEvent('not json')).toThrow();
    expect(() => decodeServerEvent('[1]')).toThrow('not a JSON object');
    expect(() => decodeServerEvent('null')).toThrow('not a JSON object');
    expect(() => decodeServerEvent('{"delta":"x"}')).toThrow('no type');
    expect(() => decodeServerEvent(new Blob(['{}']))).toThrow('unexpected kind');
  });

  it('tells an out-of-band response by its null conversation or its anchor metadata, and an in-band one otherwise', () => {
    expect(isOutOfBand({ conversation_id: null, metadata: null })).toBe(true);
    expect(isOutOfBand({ conversation_id: 'conv_1', metadata: { purpose: 'anchor' } })).toBe(true);
    expect(isOutOfBand({ conversation_id: 'conv_1', metadata: null })).toBe(false);
    expect(isOutOfBand({})).toBe(false);
    expect(isOutOfBand(undefined)).toBe(false);
  });

  it('settles a translation trimmed, and unwrapped from JSON (`textUtils.ts:6-25`)', () => {
    expect(unwrapTranslationText('\r\n Hello. ')).toBe('Hello.');
    expect(unwrapTranslationText('{"final_text": " Bonjour. "}')).toBe('Bonjour.');
    expect(unwrapTranslationText('{"translation":"Hola"}')).toBe('Hola');
    expect(unwrapTranslationText('{not json')).toBe('{not json');
    expect(unwrapTranslationText('{"other": 1}')).toBe('{"other": 1}');
    expect(unwrapTranslationText('')).toBe('');
  });

  it("words a server error as OpenAI's own, and codes it: the 60-minute cap as the segment's end, a bad key, a rate or a quota, an invalid request, else the service's (choice 14)", () => {
    expect(errorCode({ type: 'invalid_request_error', code: 'session_expired' })).toBe('segment_ended');
    expect(errorCode({ type: 'invalid_request_error', code: 'invalid_api_key' })).toBe('auth');
    expect(errorCode({ type: 'invalid_request_error', code: 'rate_limit_exceeded' })).toBe('rate_limit');
    expect(errorCode({ type: 'insufficient_quota', code: 'insufficient_quota' })).toBe('rate_limit');
    expect(errorCode({ type: 'invalid_request_error', code: 'conversation_already_has_active_response' })).toBe('client');
    expect(errorCode({ type: 'server_error', code: null })).toBe('server');
    expect(errorCode({})).toBe('server');
    expect(errorWords({ type: 'invalid_request_error', code: 'session_expired', message: 'Your session hit the maximum duration of 60 minutes.' }))
      .toBe('[OpenAI session_expired] Your session hit the maximum duration of 60 minutes.');
    expect(errorWords({})).toBe('[OpenAI error] the server reported an error');
  });
});
```

Create `src/providers/openai/socket.test.ts`:

```ts
/**
 * OpenAI Realtime's socket seam. A browser that will not open a socket for
 * a subprotocol it finds invalid throws an error that quotes it, and the
 * second subprotocol carries the key: what leaves the seam names the error,
 * never repeats it.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { nativeSocket } from './socket';
import { configFor, KEY, RefusingWebSocket } from './testing';
import { realtimeProtocols, realtimeUrl } from './wire';

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

describe("OpenAI Realtime's socket seam", () => {
  it('opens the socket the browser builds, for the URL and the subprotocols it is given', () => {
    const built: Array<[string, unknown]> = [];
    class RecordingWebSocket {
      constructor(url: string, protocols: unknown) {
        built.push([url, protocols]);
      }
    }
    vi.stubGlobal('WebSocket', RecordingWebSocket);
    const socket = nativeSocket(realtimeUrl(configFor()), realtimeProtocols(KEY));
    expect(socket).toBeInstanceOf(RecordingWebSocket);
    expect(built).toEqual([[realtimeUrl(configFor()), realtimeProtocols(KEY)]]);
  });

  it("a socket the browser will not open is rethrown in fixed words, under the browser's error name, never its message (choice 7)", () => {
    const protocols = realtimeProtocols(KEY);
    const secrets = [KEY.apiKey, protocols[1], 'openai-insecure-api-key'];
    // The control: the browser's own error quotes every one of them.
    const own = thrownBy(() => new RefusingWebSocket(realtimeUrl(configFor()), protocols));
    for (const secret of secrets) expect(own.message).toContain(secret);

    vi.stubGlobal('WebSocket', RefusingWebSocket);
    const error = thrownBy(() => nativeSocket(realtimeUrl(configFor()), protocols));
    expect(error).not.toBe(own);
    expect(error).toMatchObject({ name: 'SyntaxError', message: 'The browser would not open the socket (SyntaxError).' });
    expect((error as { cause?: unknown }).cause).toBeUndefined();
    for (const text of [error.message, String(error), error.stack ?? '']) {
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
  });
});
```

Create `src/providers/openai/wire.oracle.test.ts` — the URL and the subprotocols against the SDK's own `OpenAIRealtimeWebSocket`, built as `GAC:144-150` built it, over a stubbed `WebSocket` (no network):

```ts
/**
 * The socket against the SDK the old client dialled through (choice 7):
 * `OpenAIRealtimeWebSocket` (`openai` 6.39.1), built as `OpenAIGAClient`
 * built it (`OpenAIGAClient.ts:144-150`), dials exactly `realtimeUrl` with
 * exactly `realtimeProtocols`. The SDK opens a global `WebSocket`, stubbed
 * here with `FakeSocket`: it connects nowhere. The one value import of the
 * SDK's realtime socket outside the old client.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket';
import { FakeSocket } from '../../lib/contract/testing/fakeSocket';
import { configFor, KEY } from './testing';
import { realtimeProtocols, realtimeUrl } from './wire';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI Realtime's socket against the SDK's", () => {
  it.each(['gpt-realtime-2.1-mini', 'gpt-realtime-2.1', 'gpt-realtime-mini'])('dials %s where the SDK does, with the subprotocols it sends', (model) => {
    const opened: FakeSocket[] = [];
    vi.stubGlobal('WebSocket', class extends FakeSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols);
        opened.push(this);
      }
    });
    // A plain object standing in for a client, as the old client passed one: the SDK reads `apiKey` and `baseURL` from it.
    new OpenAIRealtimeWebSocket({ model, dangerouslyAllowBrowser: true }, { apiKey: KEY.apiKey, baseURL: 'https://api.openai.com/v1' } as never);
    expect(opened).toHaveLength(1);
    const c = { ...configFor(), model };
    expect(opened[0].url).toBe(realtimeUrl(c));
    expect(opened[0].protocols).toEqual(realtimeProtocols(KEY));
  });
});
```

- [ ] **Step 3: Run them to see them fail.**

Run: `npx vitest run src/providers/openai/wire.test.ts src/providers/openai/socket.test.ts src/providers/openai/wire.oracle.test.ts`
Expected: FAIL — 3 files: `Failed to resolve import "./wire"` (and `"./socket"`).

- [ ] **Step 4: Write the seam.** Create `src/providers/openai/socket.ts` (OpenAI Translate's, copied — choice 5):

```ts
/**
 * The one seam OpenAI Realtime's session side opens sockets through, copied
 * from OpenAI Translate's (choice 7): `new WebSocket(url, protocols)` in
 * the app, a `FakeSocket` factory in tests. The key rides in a subprotocol,
 * which a browser sets itself, so no upgrade header is needed and F14 is
 * not this provider's; this seam moves to `src/lib/contract/` with the
 * others when F14 lands.
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

- [ ] **Step 5: Write the wire.** Create `src/providers/openai/wire.ts`:

```ts
/**
 * OpenAI Realtime's GA wire, spoken directly (survey §1.4–1.5, §2.12): the
 * URL and its subprotocols, the client frames the adapter sends, the
 * server's frames decoded, a response told in-band or out-of-band, a
 * translation's final text, and a server `error` as a notice code and
 * words. The client frames are typed by the `openai` SDK's realtime types,
 * imported for types only, widened where the API is ahead of the SDK
 * (`languages` / `keywords`, a `null` noise reduction). Pure: no socket, no
 * timer.
 */
import type {
  ConversationItemCreateEvent,
  InputAudioBufferAppendEvent,
  InputAudioBufferClearEvent,
  InputAudioBufferCommitEvent,
  RealtimeAudioConfigInput,
  RealtimeAudioConfigOutput,
  RealtimeAudioInputTurnDetection,
  RealtimeError,
  RealtimeSessionCreateRequest,
  ResponseCreateEvent,
} from 'openai/resources/realtime/realtime';
import { pcmToBase64 } from '../../lib/contract/pcm64';
import type { RealtimeConfig, TurnDetection } from './config';
import type { RealtimeCredentials } from './settings';
import type { TranscriptionHint } from './transcription';

/** The GA endpoint the SDK dials (`openai/realtime/internal-base.js:41-50`); the model rides in its query, fixed at creation. */
export const REALTIME_WS_URL = 'wss://api.openai.com/v1/realtime';

export function realtimeUrl(c: Pick<RealtimeConfig, 'model'>): string {
  return `${REALTIME_WS_URL}?model=${encodeURIComponent(c.model)}`;
}

/**
 * The subprotocols a socket authenticates with (choice 7;
 * `openai/realtime/websocket.js:29-32`): `realtime`, and the key as
 * `openai-insecure-api-key.<key>`, which a browser sets itself — no upgrade
 * header on any platform, no ephemeral token. Never the beta tag: this is
 * the GA protocol. The one function of the session side that reads the
 * key; what it returns is never framed, worded or logged.
 */
export function realtimeProtocols(k: RealtimeCredentials): string[] {
  return ['realtime', `openai-insecure-api-key.${k.apiKey}`];
}

/** `session.update`, the SDK's own request widened where the API is ahead of it: the transcription's `languages` / `keywords` (`transcription.ts`), and a noise reduction of `null`, which turns it off. */
export interface WireSessionUpdate {
  type: 'session.update';
  session: Omit<RealtimeSessionCreateRequest, 'audio'> & {
    audio: {
      input: Omit<RealtimeAudioConfigInput, 'transcription' | 'noise_reduction'> & {
        transcription: TranscriptionHint;
        noise_reduction: RealtimeAudioConfigInput.NoiseReduction | null;
      };
      output?: RealtimeAudioConfigOutput;
    };
  };
}

/** Detection as the wire takes it: the server answers each turn itself, and never interrupts a translation still playing (`OpenAIProviderConfig.ts:100-116`). */
function turnDetectionOf(d: TurnDetection | null): RealtimeAudioInputTurnDetection | null {
  if (d === null) return null;
  if (d.type === 'semantic_vad') return { type: 'semantic_vad', create_response: true, interrupt_response: false, eagerness: d.eagerness };
  return {
    type: 'server_vad', create_response: true, interrupt_response: false,
    threshold: d.threshold, prefix_padding_ms: d.prefixPaddingMs, silence_duration_ms: d.silenceDurationMs,
  };
}

/**
 * The session's configuration, sent once `session.created` arrives: the old
 * `buildOpenAIRealtimeSession` (`openAIRealtimeSession.ts:61-111`) — a
 * translator by its instructions, with no tools (`OpenAIClient.ts:727-730`),
 * the voice under `audio.output` only on a leg that speaks — with two
 * changes: noise reduction "None" is `null` (ruling 16), and no temperature
 * (ruling 6), which the GA session never took.
 */
export function sessionUpdate(c: RealtimeConfig): WireSessionUpdate {
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      output_modalities: c.modalities,
      instructions: c.instructions,
      max_output_tokens: c.maxTokens,
      tool_choice: 'none',
      tools: [],
      audio: {
        input: {
          turn_detection: turnDetectionOf(c.turnDetection),
          transcription: c.transcription,
          noise_reduction: c.noiseReduction === null ? null : { type: c.noiseReduction },
        },
        ...(c.voice ? { output: { voice: c.voice } } : {}),
      },
      ...(c.reasoningEffort ? { reasoning: { effort: c.reasoningEffort } } : {}),
    },
  };
}

/** One chunk as it goes up: 24 kHz PCM16 mono, the contract's own rate and the GA default — no resampling. */
export function appendFrame(pcm: Int16Array): string {
  const frame: InputAudioBufferAppendEvent = { type: 'input_audio_buffer.append', audio: pcmToBase64(pcm) };
  return JSON.stringify(frame);
}

/** A release with speech, under manual turns: what the press appended becomes an input item. */
export const COMMIT: InputAudioBufferCommitEvent = { type: 'input_audio_buffer.commit' };
/** A release without speech: the press's audio is dropped, not left to join the next turn (spec, "Defects removed by construction"). */
export const CLEAR: InputAudioBufferClearEvent = { type: 'input_audio_buffer.clear' };

/** Typed text as an input item of the adapter's own id, which the translation's `previous_item_id` then names (`OpenAIGAClient.ts:819-867`). */
export function textItem(itemId: string, text: string): ConversationItemCreateEvent {
  return { type: 'conversation.item.create', item: { id: itemId, type: 'message', role: 'user', content: [{ type: 'input_text', text }] } };
}

/**
 * An in-band response for the input the conversation ends with (a released
 * press, a typed text): `event_id` names it in the error that may refuse
 * it, and its metadata names it in the response it creates, told apart
 * from one the server's own detection created (choice 10).
 */
export function responseCreate(eventId: string): ResponseCreateEvent {
  return { type: 'response.create', event_id: eventId, response: { metadata: { request: eventId } } };
}

/** The request an in-band response names back (`responseCreate`'s metadata), if any. */
export function requestOf(response: { metadata?: unknown } | undefined): string | undefined {
  const request = (response?.metadata as { request?: unknown } | null | undefined)?.request;
  return typeof request === 'string' ? request : undefined;
}

/** The drift anchor's metadata: how its response is told apart when it comes back (ruling 2). */
export const ANCHOR_METADATA = { purpose: 'anchor' } as const;

/**
 * The drift anchor (ruling 2; `MainPanel.tsx:4245-4325` before `aecaae2b`,
 * `openAIRealtimeSession.ts:189-206`): an out-of-band, text-only response
 * carrying this leg's instructions — kept out of the conversation, its
 * output discarded. The instructions go only when not blank, as the old
 * builder sent them.
 */
export function anchorResponse(eventId: string, instructions: string): ResponseCreateEvent {
  return {
    type: 'response.create',
    event_id: eventId,
    response: { conversation: 'none', output_modalities: ['text'], ...(instructions ? { instructions } : {}), metadata: { ...ANCHOR_METADATA } },
  };
}

/** A response out of band: kept out of the conversation (`conversation_id` null, the SDK) or the anchor's own (its metadata). The anchor's are the only ones this adapter asks for. */
export function isOutOfBand(response: { conversation_id?: unknown; metadata?: unknown } | undefined): boolean {
  if (!response) return false;
  const metadata = response.metadata as { purpose?: unknown } | null | undefined;
  return response.conversation_id === null || metadata?.purpose === ANCHOR_METADATA.purpose;
}

/** A server event as the adapter reads it: a JSON object with a string `type`; the adapter reads each through its SDK type. */
export type ServerEvent = { type: string } & Record<string, unknown>;

const isArrayBuffer = (data: unknown): data is ArrayBuffer => Object.prototype.toString.call(data) === '[object ArrayBuffer]';

/** A server frame, decoded at once: text, or a binary frame read as an ArrayBuffer (choice 15). Throws when it is not a JSON object with a string `type`. */
export function decodeServerEvent(data: unknown): ServerEvent {
  const text = typeof data === 'string' ? data : isArrayBuffer(data) ? new TextDecoder().decode(data) : null;
  if (text === null) throw new Error(`a server frame of an unexpected kind (${Object.prototype.toString.call(data)})`);
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a server frame that is not a JSON object');
  if (typeof (parsed as { type?: unknown }).type !== 'string') throw new Error('a server frame with no type');
  return parsed as ServerEvent;
}

/**
 * A translation's final text (choice 5): trimmed, and unwrapped when the
 * model answered in JSON (`{"final_text": …}`) — copied from
 * `src/utils/textUtils.ts`, which only the old clients use. Applied to the
 * `.done` text alone, as the old client did, so a wrapped answer streams
 * raw and settles unwrapped.
 */
export function unwrapTranslationText(text: string): string {
  if (!text) return text;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) {
      for (const key of ['final_text', 'final', 'text', 'translation', 'result', 'query']) {
        const value = (parsed as Record<string, unknown>)[key];
        if (typeof value === 'string') return value.trim();
      }
    }
  } catch {
    // Not JSON: the text as it stands.
  }
  return trimmed;
}

export type ErrorCode = 'auth' | 'rate_limit' | 'client' | 'server' | 'segment_ended';

/**
 * A server `error` as a notice code (choice 14): OpenAI Translate's mapping
 * (its choice 9), copied, and one more — the 60-minute cap's
 * `session_expired` is the run's end, worded as the segment ended
 * (`segment_ended`: "This segment has ended — tap Start Session to
 * continue."), not a refused request. A hypothesis the live test's
 * `session.error` frames settle.
 */
export function errorCode(e: Partial<RealtimeError>): ErrorCode {
  if (e.code === 'session_expired') return 'segment_ended';
  if (e.code === 'invalid_api_key') return 'auth';
  if (e.code === 'rate_limit_exceeded' || e.code === 'insufficient_quota') return 'rate_limit';
  if (e.type === 'invalid_request_error') return 'client';
  return 'server';
}

/** A server `error` in OpenAI's own words, as the `{{detail}}` of its notice: `[OpenAI <code, else type>] <message>`. */
export function errorWords(e: Partial<RealtimeError>): string {
  return `[OpenAI ${e.code || e.type || 'error'}] ${e.message || 'the server reported an error'}`;
}
```

- [ ] **Step 6: Run them to see them pass.**

Run: `npx vitest run src/providers/openai/wire.test.ts src/providers/openai/socket.test.ts src/providers/openai/wire.oracle.test.ts`
Expected: PASS — 3 files, 18 tests.

- [ ] **Step 7: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline (plus only lines a concurrent Wave 2 task names as its own).

- [ ] **Step 8: Commit.**

```bash
git add src/providers/openai/wire.ts src/providers/openai/wire.test.ts src/providers/openai/socket.ts src/providers/openai/socket.test.ts src/providers/openai/wire.oracle.test.ts src/providers/openai/testing.ts
```

```bash
git commit -q -F - -- src/providers/openai/wire.ts src/providers/openai/wire.test.ts src/providers/openai/socket.ts src/providers/openai/socket.test.ts src/providers/openai/wire.oracle.test.ts src/providers/openai/testing.ts <<'EOF'
feat(openai): OpenAI Realtime's wire and socket seam

The GA endpoint with the key in its subprotocol, read in one place and
pinned against the SDK the old client dialled through. The session update
sends no temperature, a null noise reduction for "None", and a reasoning
effort only to the models that take one. A browser that refuses the socket
is rethrown in fixed words.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 7: Items become segments, paired by id (Wave 2)

**Files:**
- Create: `src/providers/openai/items.ts`
- Test: `src/providers/openai/items.test.ts`

**Interfaces:**
- Consumes: `AdapterEvents`, `Ref`, `TextRange` (`src/lib/contract/adapter`); `recordEvents` (tests).
- Produces: `ItemSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'audio' | 'speechRanges'>` and `class RealtimeItems` (choices 8, 9) with `committed(itemId)`, `typed(itemId, text)`, `inputAdded(itemId)`, `inputDelta(itemId, delta)`, `inputDone(itemId, transcript)`, `inputFailed(itemId)`, `responseCreated(responseId, outOfBand)`, `outputAdded(itemId, responseId)`, `assistantAdded(itemId, previousItemId)`, `outputDelta(itemId, responseId, delta)`, `outputDone(itemId, responseId, text)`, `audio(itemId, responseId, pcm)`, `itemDone(itemId)`, `responseDone(responseId)`, `stop()`. Task 11 drives it.

- [ ] **Step 1: Write the failing test.** Create `src/providers/openai/items.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { RealtimeItems } from './items';

type PayloadOf<K extends AdapterEvent['kind']> = Extract<AdapterEvent, { kind: K }>['payload'];

function machine() {
  const { events, log } = recordEvents();
  const items = new RealtimeItems(events);
  /** The payloads of one kind of event, in order. */
  const of = <K extends AdapterEvent['kind']>(kind: K): Array<PayloadOf<K>> => {
    const out: Array<PayloadOf<K>> = [];
    for (const e of log) if (e.kind === kind) out.push(e.payload as PayloadOf<K>);
    return out;
  };
  return { items, log, of };
}
const pcm = (n = 2_400) => new Int16Array(n).fill(900);
const last = <T>(list: readonly T[]): T | undefined => list[list.length - 1];

describe("OpenAI Realtime's items: the sources", () => {
  it('opens a source for each committed input under its item id, empty until text comes; deltas stream, and the completed transcript settles and closes it (ruling 11)', () => {
    const m = machine();
    m.items.committed('item_a');
    expect(m.of('segmentOpened')).toEqual([{ ref: 1, side: 'source', origin: 'item_a' }]);
    expect(m.of('segmentText')).toEqual([]);
    m.items.inputDelta('item_a', 'こんにち');
    m.items.inputDelta('item_a', 'は');
    m.items.inputDone('item_a', 'こんにちは。');
    expect(m.of('segmentText')).toEqual([{ ref: 1, text: 'こんにち' }, { ref: 1, text: 'こんにちは' }, { ref: 1, text: 'こんにちは。' }]);
    expect(m.of('segmentClosed')).toEqual([{ ref: 1 }]);
    // Nothing more for a closed source; a second commit of the same item opens nothing.
    m.items.inputDelta('item_a', 'x');
    m.items.committed('item_a');
    expect(m.log).toHaveLength(5);
  });

  it('settles a transcript that equals the streamed text without writing it again, and closes a failed transcription as it stands', () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.inputDelta('item_a', 'Hi');
    m.items.inputDone('item_a', 'Hi');
    m.items.committed('item_b');
    m.items.inputDelta('item_b', 'Hal');
    m.items.inputFailed('item_b');
    expect(m.of('segmentText')).toEqual([{ ref: 1, text: 'Hi' }, { ref: 2, text: 'Hal' }]);
    expect(m.of('segmentClosed')).toEqual([{ ref: 1 }, { ref: 2 }]);
  });

  it("opens, writes and closes typed text at once, under the adapter's own item id", () => {
    const m = machine();
    m.items.typed('sokuji_text_1', 'Hello there');
    expect(m.log.map((e) => [e.kind, e.payload])).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'sokuji_text_1' }],
      ['segmentText', { ref: 1, text: 'Hello there' }],
      ['segmentClosed', { ref: 1 }],
    ]);
  });
});

describe("OpenAI Realtime's items: translations, paired exactly (choice 8)", () => {
  it("pairs each translation with the input its item follows, as the server states it", () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.committed('item_b');
    m.items.responseCreated('resp_1', false);
    m.items.outputAdded('item_x', 'resp_1');
    m.items.assistantAdded('item_x', 'item_a');
    m.items.outputDelta('item_x', 'resp_1', 'Hello.');
    m.items.responseCreated('resp_2', false);
    m.items.outputAdded('item_y', 'resp_2');
    m.items.assistantAdded('item_y', 'item_b');
    expect(m.of('segmentOpened').filter((e) => e.side === 'translation')).toEqual([
      { ref: 3, side: 'translation', origin: 'item_a' },
      { ref: 4, side: 'translation', origin: 'item_b' },
    ]);
  });

  it('falls back, when the item names no input of this leg, to the newest input the server held unanswered when the response began', () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.committed('item_b');
    m.items.responseCreated('resp_1', false);
    m.items.outputAdded('item_x', 'resp_1');
    m.items.assistantAdded('item_x', null);
    // A delta before any announcement opens it the same way.
    m.items.responseCreated('resp_2', false);
    m.items.outputDelta('item_y', 'resp_2', 'Hi');
    m.items.responseCreated('resp_3', false);
    m.items.assistantAdded('item_z', 'item_unknown');
    expect(m.of('segmentOpened').filter((e) => e.side === 'translation')).toEqual([
      { ref: 3, side: 'translation', origin: 'item_b' },
      { ref: 4, side: 'translation', origin: 'item_a' },
      // Nothing left unanswered: no origin.
      { ref: 5, side: 'translation' },
    ]);
  });

  it('pairs an assistant item announced before its output item through the one in-band response still running, and guesses no owner between two (choice 8)', () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.responseCreated('resp_anchor', true);
    m.items.responseCreated('resp_1', false);
    // The announcement first, naming no input of this leg; its output item after it.
    m.items.assistantAdded('item_x', 'item_other');
    m.items.outputAdded('item_x', 'resp_1');
    m.items.outputDelta('item_x', 'resp_1', 'Hello.');
    expect(m.of('segmentOpened').filter((e) => e.side === 'translation')).toEqual([{ ref: 2, side: 'translation', origin: 'item_a' }]);
    // Its response's end closes it.
    m.items.responseDone('resp_1');
    expect(m.of('segmentClosed')).toEqual([{ ref: 2 }]);
    // Two in-band responses running: no owner is guessed, so no fallback pairs it.
    m.items.committed('item_b');
    m.items.responseCreated('resp_2', false);
    m.items.responseCreated('resp_3', false);
    m.items.assistantAdded('item_y', null);
    expect(last(m.of('segmentOpened'))).toEqual({ ref: 4, side: 'translation' });
  });

  it('does not fall back to a typed text the server does not hold yet; it does once the server added it', () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.typed('sokuji_text_1', 'queued words');
    m.items.responseCreated('resp_1', false);
    m.items.outputDelta('item_x', 'resp_1', 'x');
    m.items.inputAdded('sokuji_text_1');
    m.items.responseCreated('resp_2', false);
    m.items.outputDelta('item_y', 'resp_2', 'y');
    expect(m.of('segmentOpened').filter((e) => e.side === 'translation').map((e) => e.origin)).toEqual(['item_a', 'sokuji_text_1']);
  });

  it('leaves an input no response answers as a source of its own: an utterance spoken over a playing translation', () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.responseCreated('resp_1', false);
    m.items.assistantAdded('item_x', 'item_a');
    // Spoken while resp_1 plays: committed, never answered (`interrupt_response: false`).
    m.items.committed('item_b');
    m.items.inputDone('item_b', 'unanswered words');
    m.items.responseDone('resp_1');
    m.items.committed('item_c');
    m.items.responseCreated('resp_2', false);
    m.items.assistantAdded('item_y', 'item_c');
    expect(m.of('segmentOpened').filter((e) => e.side === 'translation').map((e) => e.origin)).toEqual(['item_a', 'item_c']);
  });

  it("makes no segment of an out-of-band response: the drift anchor's (ruling 2)", () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.responseCreated('resp_anchor', true);
    m.items.outputAdded('item_anchor', 'resp_anchor');
    m.items.assistantAdded('item_anchor', null);
    m.items.outputDelta('item_anchor', 'resp_anchor', 'Understood.');
    m.items.outputDone('item_anchor', 'resp_anchor', 'Understood.');
    m.items.audio('item_anchor', 'resp_anchor', pcm());
    m.items.itemDone('item_anchor');
    m.items.responseDone('resp_anchor');
    expect(m.log.map((e) => e.kind)).toEqual(['segmentOpened']);
    // Its fallback was never taken: the next in-band response answers the input.
    m.items.responseCreated('resp_1', false);
    m.items.outputDelta('item_x', 'resp_1', 'Hi');
    expect(m.of('segmentOpened')[1]).toEqual({ ref: 2, side: 'translation', origin: 'item_a' });
  });

  it('closes a translation when its item is done, and every one still open when its response is done; nothing reopens it', () => {
    const m = machine();
    m.items.responseCreated('resp_1', false);
    m.items.outputDelta('item_x', 'resp_1', 'one');
    m.items.outputDelta('item_y', 'resp_1', 'two');
    m.items.itemDone('item_x');
    expect(m.of('segmentClosed')).toEqual([{ ref: 1 }]);
    m.items.responseDone('resp_1');
    expect(m.of('segmentClosed')).toEqual([{ ref: 1 }, { ref: 2 }]);
    m.items.outputDelta('item_x', 'resp_1', ' more');
    expect(m.of('segmentText')).toEqual([{ ref: 1, text: 'one' }, { ref: 2, text: 'two' }]);
  });
});

describe("OpenAI Realtime's items: karaoke by arrival (ruling 3; choice 9)", () => {
  it("ranges each played frame from the previous frame's end to the text's length at its arrival; audio before any text carries [0, 0]", () => {
    const m = machine();
    m.items.responseCreated('resp_1', false);
    m.items.audio('item_x', 'resp_1', pcm());
    m.items.outputDelta('item_x', 'resp_1', 'Hello');
    m.items.audio('item_x', 'resp_1', pcm());
    m.items.audio('item_x', 'resp_1', pcm());
    m.items.outputDelta('item_x', 'resp_1', ' there.');
    m.items.audio('item_x', 'resp_1', pcm());
    expect(m.of('audio').map((e) => [e.ref, e.range])).toEqual([[1, [0, 0]], [1, [0, 5]], [1, [5, 5]], [1, [5, 12]]]);
  });

  it('settles the final text, and states again within it every range past its end; later frames start there', () => {
    const m = machine();
    m.items.responseCreated('resp_1', false);
    m.items.outputDelta('item_x', 'resp_1', 'Hello. ');
    m.items.audio('item_x', 'resp_1', pcm());
    m.items.outputDelta('item_x', 'resp_1', ' ');
    m.items.audio('item_x', 'resp_1', pcm());
    // Trimmed: 'Hello.' is 6 long, the streamed text 8.
    m.items.outputDone('item_x', 'resp_1', 'Hello.');
    expect(last(m.of('segmentText'))).toEqual({ ref: 1, text: 'Hello.' });
    expect(m.of('speechRanges')).toEqual([{ ref: 1, ranges: [{ index: 0, range: [0, 6] }, { index: 1, range: [6, 6] }] }]);
    m.items.audio('item_x', 'resp_1', pcm());
    expect(last(m.of('audio'))).toMatchObject({ ref: 1, range: [6, 6] });
    // A final text equal to the streamed one, or none, changes nothing.
    m.items.outputDone('item_x', 'resp_1', 'Hello.');
    m.items.outputDone('item_x', 'resp_1', '');
    expect(m.of('segmentText')).toHaveLength(3);
    expect(m.of('speechRanges')).toHaveLength(1);
  });

  it('plays a frame whose translation already closed as no row\'s, and makes nothing after stop', () => {
    const m = machine();
    m.items.responseCreated('resp_1', false);
    m.items.outputDelta('item_x', 'resp_1', 'Hi');
    m.items.itemDone('item_x');
    m.items.audio('item_x', 'resp_1', pcm(10));
    expect(last(m.of('audio'))).toEqual({ pcm: pcm(10) });
    const n = m.log.length;
    m.items.stop();
    m.items.committed('item_b');
    m.items.typed('sokuji_text_1', 'x');
    m.items.responseCreated('resp_2', false);
    m.items.outputDelta('item_y', 'resp_2', 'y');
    m.items.audio('item_y', 'resp_2', pcm());
    m.items.responseDone('resp_2');
    expect(m.log).toHaveLength(n);
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run src/providers/openai/items.test.ts`
Expected: FAIL — `Failed to resolve import "./items"`.

- [ ] **Step 3: Write it.** Create `src/providers/openai/items.ts`:

```ts
/**
 * OpenAI Realtime's conversation items → segments (survey §2.11): the old
 * client's items (`OpenAIGAClient.ts:476-707`) as a pure machine. No timer:
 * the server's own events open and close every segment.
 *
 * - **Sources.** Every input item is a source segment whose origin is the
 *   item's id: a commit's (automatic or manual) opens it empty — no row
 *   until it has text — its transcript deltas stream into it (ruling 11)
 *   and the completed transcript settles and closes it; a typed text is
 *   opened, written and closed at once, under the adapter's own item id.
 * - **Translations, paired exactly** (choice 8): a response's assistant item
 *   is a translation segment whose origin is the input its
 *   `previous_item_id` names, when this leg opened that input; else the
 *   newest input the server holds that no translation has named yet, as it
 *   stood when the response was created; else none. An input no response
 *   ever answers — an utterance spoken over a playing translation, which
 *   the server may leave unanswered under `interrupt_response: false` —
 *   stays a source row of its own.
 * - **Karaoke by arrival** (ruling 3): a played frame carries
 *   `[the previous played frame's end, the translation's length when the
 *   frame arrived]`, OpenAI Translate's alignment (its choice 6). When the
 *   final text settles shorter — trimmed, unwrapped — the ranges past its
 *   end are stated again within it (`speechRanges`, choice 9).
 * - **Out of band** (the drift anchor, ruling 2): a response kept out of the
 *   conversation makes no segment.
 */
import type { AdapterEvents, Ref, TextRange } from '../../lib/contract/adapter';

export type ItemSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'audio' | 'speechRanges'>;

interface Input {
  ref: Ref;
  text: string;
  closed: boolean;
  /** The server holds the item: a commit's, or a typed item the server has added. A typed text still waiting is no one's origin by default. */
  known: boolean;
  /** A translation named it as its origin. */
  answered: boolean;
}

interface Output {
  ref: Ref;
  text: string;
  /** Where the last played frame's range ended (ruling 3). */
  spoken: number;
  /** Every played frame's range, in order: the ref's audio entries, re-stated when the final text is shorter (choice 9). */
  ranges: TextRange[];
  closed: boolean;
}

interface Response {
  outOfBand: boolean;
  /** The newest known input no translation had named when the response was created: the origin when its item names none (choice 8). */
  fallback?: string;
}

export class RealtimeItems {
  private refs = 0;
  /** By item id, in the order they opened. */
  private readonly inputs = new Map<string, Input>();
  private readonly outputs = new Map<string, Output>();
  private readonly responses = new Map<string, Response>();
  /** An assistant item's response, from `response.output_item.added`. */
  private readonly owners = new Map<string, string>();
  private stopped = false;

  constructor(private readonly sink: ItemSink) {}

  /** An input item exists — a VAD or a manual commit (`input_audio_buffer.committed`). */
  committed(itemId: string): void {
    if (this.stopped || this.inputs.has(itemId)) return;
    this.openInput(itemId, true);
  }

  /** Typed text, shown at once, before its item goes up (spec: "`appendText` is answered by the adapter"). */
  typed(itemId: string, text: string): void {
    if (this.stopped || this.inputs.has(itemId)) return;
    const input = this.openInput(itemId, false);
    input.text = text;
    this.sink.segmentText({ ref: input.ref, text });
    this.closeInput(input);
  }

  /** The server added an input item (`conversation.item.added`, role user): a typed text reached it. */
  inputAdded(itemId: string): void {
    const input = this.inputs.get(itemId);
    if (input) input.known = true;
  }

  /** A transcript delta for an input (ruling 11). */
  inputDelta(itemId: string, delta: string): void {
    const input = this.input(itemId);
    if (!input || !delta) return;
    input.text += delta;
    this.sink.segmentText({ ref: input.ref, text: input.text });
  }

  /** The input's transcript, completed: it settles the text and closes the source. */
  inputDone(itemId: string, transcript: string): void {
    const input = this.input(itemId);
    if (!input) return;
    if (transcript !== input.text) {
      input.text = transcript;
      this.sink.segmentText({ ref: input.ref, text: transcript });
    }
    this.closeInput(input);
  }

  /** The input's transcription failed: the source closes as it stands. */
  inputFailed(itemId: string): void {
    const input = this.inputs.get(itemId);
    if (input && !input.closed && !this.stopped) this.closeInput(input);
  }

  /** A response began: out of band (the anchor's) it will make no segment; in band it takes its fallback origin now. */
  responseCreated(responseId: string, outOfBand: boolean): void {
    if (this.stopped) return;
    this.responses.set(responseId, outOfBand ? { outOfBand } : { outOfBand, fallback: this.newestUnanswered() });
  }

  /** A response's output item (`response.output_item.added`): its owner, so its announcement finds the fallback. */
  outputAdded(itemId: string, responseId: string): void {
    this.owners.set(itemId, responseId);
  }

  /**
   * A response's assistant item, announced (`conversation.item.added`): its translation opens, paired by the input it follows (choice 8).
   * Announced before its output item, its owner is the one in-band response still running — none is guessed between two — so the fallback still finds it.
   */
  assistantAdded(itemId: string, previousItemId: string | null | undefined): void {
    if (this.stopped) return;
    if (!this.owners.has(itemId)) {
      const running = [...this.responses].filter(([, r]) => !r.outOfBand).map(([responseId]) => responseId);
      if (running.length === 1) this.owners.set(itemId, running[0]);
    }
    if (this.outOfBand(this.owners.get(itemId))) return;
    this.output(itemId, previousItemId);
  }

  /** A transcript or text delta of a translation. */
  outputDelta(itemId: string, responseId: string, delta: string): void {
    if (this.stopped || !delta || this.outOfBand(responseId)) return;
    this.owners.set(itemId, responseId);
    const out = this.output(itemId);
    if (!out) return;
    out.text += delta;
    this.sink.segmentText({ ref: out.ref, text: out.text });
  }

  /** The translation's final text (already trimmed and unwrapped): it replaces the streamed one, and ranges past its end are stated again within it (choice 9). */
  outputDone(itemId: string, responseId: string, text: string): void {
    if (this.stopped || this.outOfBand(responseId)) return;
    this.owners.set(itemId, responseId);
    const out = this.output(itemId);
    if (!out || !text || text === out.text) return;
    out.text = text;
    this.sink.segmentText({ ref: out.ref, text });
    const len = text.length;
    const restated = out.ranges.flatMap((range, index) => {
      if (range[1] <= len) return [];
      const inside: TextRange = [Math.min(range[0], len), len];
      out.ranges[index] = inside;
      return [{ index, range: inside }];
    });
    out.spoken = Math.min(out.spoken, len);
    if (restated.length > 0) this.sink.speechRanges({ ref: out.ref, ranges: restated });
  }

  /** Audio of a translation, played (the adapter drops it on a leg that does not speak): ranged by arrival under its segment (ruling 3). */
  audio(itemId: string, responseId: string, pcm: Int16Array): void {
    if (this.stopped || pcm.length === 0 || this.outOfBand(responseId)) return;
    this.owners.set(itemId, responseId);
    const out = this.output(itemId);
    // Its translation already closed: it plays, and is no row's.
    if (!out) {
      this.sink.audio({ pcm });
      return;
    }
    const range: TextRange = [out.spoken, out.text.length];
    out.ranges.push(range);
    out.spoken = range[1];
    this.sink.audio({ pcm, ref: out.ref, range });
  }

  /** The output item is done (`response.output_item.done`): its translation closes. */
  itemDone(itemId: string): void {
    const out = this.outputs.get(itemId);
    if (out && !out.closed && !this.stopped) this.closeOutput(out);
  }

  /** The response is done (`response.done`, whatever its status): every translation of it still open closes. */
  responseDone(responseId: string): void {
    if (this.stopped) return;
    for (const [itemId, owner] of this.owners) {
      if (owner !== responseId) continue;
      const out = this.outputs.get(itemId);
      if (out && !out.closed) this.closeOutput(out);
      this.owners.delete(itemId);
    }
    this.responses.delete(responseId);
  }

  /** Nothing after stop: L1 finalizes what is open. */
  stop(): void {
    this.stopped = true;
  }

  private outOfBand(responseId: string | undefined): boolean {
    return responseId !== undefined && this.responses.get(responseId)?.outOfBand === true;
  }

  private openInput(itemId: string, known: boolean): Input {
    const ref = ++this.refs;
    this.sink.segmentOpened({ ref, side: 'source', origin: itemId });
    const input: Input = { ref, text: '', closed: false, known, answered: false };
    this.inputs.set(itemId, input);
    return input;
  }

  private closeInput(input: Input): void {
    input.closed = true;
    this.sink.segmentClosed({ ref: input.ref });
  }

  /** An open input, opened now if the server names one this leg never saw committed; null once closed. */
  private input(itemId: string): Input | null {
    if (this.stopped) return null;
    const input = this.inputs.get(itemId) ?? this.openInput(itemId, true);
    return input.closed ? null : input;
  }

  /** An open translation, opened now with its origin; null once closed. */
  private output(itemId: string, previousItemId?: string | null): Output | null {
    const known = this.outputs.get(itemId);
    if (known) return known.closed ? null : known;
    const origin = this.originFor(itemId, previousItemId);
    const ref = ++this.refs;
    this.sink.segmentOpened({ ref, side: 'translation', ...(origin ? { origin } : {}) });
    const out: Output = { ref, text: '', spoken: 0, ranges: [], closed: false };
    this.outputs.set(itemId, out);
    return out;
  }

  private closeOutput(out: Output): void {
    out.closed = true;
    this.sink.segmentClosed({ ref: out.ref });
  }

  /** The input this translation follows, stated by the server when it names one of ours; else its response's fallback (choice 8). */
  private originFor(itemId: string, previousItemId: string | null | undefined): string | undefined {
    const origin = previousItemId && this.inputs.has(previousItemId)
      ? previousItemId
      : this.responses.get(this.owners.get(itemId) ?? '')?.fallback;
    const input = origin === undefined ? undefined : this.inputs.get(origin);
    if (input) input.answered = true;
    return origin;
  }

  private newestUnanswered(): string | undefined {
    let newest: string | undefined;
    for (const [itemId, input] of this.inputs) if (input.known && !input.answered) newest = itemId;
    return newest;
  }
}
```

- [ ] **Step 4: Run it to see it pass.**

Run: `npx vitest run src/providers/openai/items.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline (plus only lines a concurrent Wave 2 task names as its own).

- [ ] **Step 6: Commit.**

```bash
git add src/providers/openai/items.ts src/providers/openai/items.test.ts
```

```bash
git commit -q -F - -- src/providers/openai/items.ts src/providers/openai/items.test.ts <<'EOF'
feat(openai): OpenAI Realtime's items as segments, paired by id

Every input item is a source segment whose id is its origin, and each
translation names the input its assistant item follows (ruling 23); the
source transcript streams (ruling 11); karaoke by arrival (ruling 3). An
utterance no response answers stays a source row of its own.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 8: The response queue (Wave 2)

**Files:**
- Create: `src/providers/openai/queue.ts`
- Test: `src/providers/openai/queue.test.ts`

**Interfaces:**
- Consumes: `Clock` (`src/lib/contract/clock`, type only); `createVirtualClock` (tests).
- Produces: `ACTIVE_RESPONSE = 'conversation_already_has_active_response'`, `Request = { kind: 'turn' } | { kind: 'text'; itemId: string; text: string }`, `QueueSink { send(request, eventId, waitedMs): void; queued(request, waiting): void }`, `QueueOptions { clock: Pick<Clock, 'now'>; sink: QueueSink; eventId(): string }`, and `class ResponseQueue` with `busy` (getter), `push(request)`, `created(responseId, request: string | undefined)`, `done(responseId)`, `refused(eventId, code)`, `stop()` (choice 10). Task 11 drives it.

- [ ] **Step 1: Write the failing test.** Create `src/providers/openai/queue.test.ts`. Its last case is the seeded one (400 runs) with its model stated; in a scratch copy, removing the requeue on `ACTIVE_RESPONSE` or the clearing in `done` each makes it fail:

```ts
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import { ACTIVE_RESPONSE, ResponseQueue, type Request } from './queue';

function queue() {
  const clock = createVirtualClock(0);
  const sent: Array<{ request: Request; eventId: string; waitedMs: number }> = [];
  const queued: Array<{ request: Request; waiting: number }> = [];
  let n = 0;
  const q = new ResponseQueue({
    clock,
    eventId: () => `sokuji_${++n}`,
    sink: { send: (request, eventId, waitedMs) => sent.push({ request, eventId, waitedMs }), queued: (request, waiting) => queued.push({ request, waiting }) },
  });
  return { q, clock, sent, queued };
}
const TURN: Request = { kind: 'turn' };
const text = (i: number): Request => ({ kind: 'text', itemId: `sokuji_text_${i}`, text: `words ${i}` });

describe("OpenAI Realtime's response queue (ruling 8; choice 10)", () => {
  it('sends a request at once while no response is in progress, and waits for none', () => {
    const { q, sent, queued } = queue();
    q.push(TURN);
    expect(sent).toEqual([{ request: TURN, eventId: 'sokuji_1', waitedMs: 0 }]);
    expect(queued).toEqual([]);
    expect(q.busy).toBe(true);
  });

  it('holds every request made while a response is in progress, first in first out, one at a time: nothing is overwritten', () => {
    const { q, clock, sent, queued } = queue();
    q.push(text(1));
    q.created('resp_1', 'sokuji_1');
    clock.advance(500);
    q.push(TURN);
    q.push(text(2));
    q.push(text(3));
    expect(queued.map((e) => e.waiting)).toEqual([1, 2, 3]);
    expect(sent).toHaveLength(1);
    clock.advance(1_000);
    q.done('resp_1');
    expect(sent.slice(1)).toEqual([{ request: TURN, eventId: 'sokuji_2', waitedMs: 1_000 }]);
    // The next waits for this one's response, not for a timer.
    q.created('resp_2', 'sokuji_2');
    q.done('resp_2');
    q.created('resp_3', 'sokuji_3');
    q.done('resp_3');
    expect(sent.map((e) => e.request)).toEqual([text(1), TURN, text(2), text(3)]);
  });

  it("holds a request while the one asked for has not been created yet, and while the server's own detection is answering", () => {
    const { q, sent } = queue();
    q.push(TURN);
    q.push(text(1));
    expect(sent).toHaveLength(1);
    q.created('resp_1', 'sokuji_1');
    q.done('resp_1');
    expect(sent).toHaveLength(2);
    q.created('resp_2', 'sokuji_2');
    q.done('resp_2');
    // The server's own: it names no request.
    q.created('resp_vad', undefined);
    q.push(text(2));
    expect(sent).toHaveLength(2);
    q.done('resp_vad');
    expect(sent.map((e) => e.request)).toEqual([TURN, text(1), text(2)]);
  });

  it("puts a request refused because a response was active back at the head: the server's detection answered first", () => {
    const { q, sent } = queue();
    q.push(text(1));
    // The server's own response was created before ours arrived; ours is refused, naming it.
    q.created('resp_vad', undefined);
    q.push(text(2));
    q.refused('sokuji_1', ACTIVE_RESPONSE);
    expect(sent).toHaveLength(1);
    q.done('resp_vad');
    expect(sent.map((e) => [e.request, e.eventId])).toEqual([[text(1), 'sokuji_1'], [text(1), 'sokuji_2']]);
    q.created('resp_1', 'sokuji_2');
    q.done('resp_1');
    expect(sent.map((e) => e.request)).toEqual([text(1), text(1), text(2)]);
  });

  it('drops a request refused for another reason, or by an error that names nothing, and sends the next; an error naming another request changes nothing', () => {
    const { q, sent } = queue();
    q.push(text(1));
    q.push(text(2));
    q.push(text(3));
    q.refused('sokuji_anchor', ACTIVE_RESPONSE);
    expect(sent).toHaveLength(1);
    q.refused('sokuji_1', 'invalid_value');
    expect(sent.map((e) => e.request)).toEqual([text(1), text(2)]);
    q.refused(null, undefined);
    expect(sent.map((e) => e.request)).toEqual([text(1), text(2), text(3)]);
  });

  it("clears the request asked when any in-band response ends: by then the server has answered it", () => {
    const { q, sent } = queue();
    q.push(TURN);
    q.push(text(1));
    // A response whose metadata the server did not echo: it still ends.
    q.created('resp_1', undefined);
    q.done('resp_1');
    expect(sent.map((e) => e.request)).toEqual([TURN, text(1)]);
  });

  it('sends nothing after stop', () => {
    const { q, sent } = queue();
    q.push(TURN);
    q.push(text(1));
    q.stop();
    q.done('resp_1');
    q.push(text(2));
    expect(sent).toHaveLength(1);
  });

  /**
   * The model: the server answers a `response.create` at once (refused
   * while a response is active, else created), and its events reach the
   * client in order, late; its own detection may create a response at any
   * moment — racing a request — but a response ends only once the client
   * has heard everything before it (a response lasts seconds, its events
   * arrive in milliseconds).
   */
  it("answers every request exactly once, in the order pushed, whatever the server's own detection and the delay of its answers — echoing the request or not (seeded)", () => {
    for (let seed = 1; seed <= 400; seed++) {
      let s = seed;
      /** mulberry32 */
      const random = () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      /** Half the runs: a server that does not echo a response's metadata, so only its end tells the queue it was answered. */
      const echoes = seed % 2 === 0;
      const clock = createVirtualClock(0);
      /** What the server said, on its way back: one ordered stream, delivered with delay. */
      const outbox: Array<() => void> = [];
      let n = 0;
      let responses = 0;
      let serverActive: string | null = null;
      const answered: Request[] = [];
      const pushed: Request[] = [];
      const q = new ResponseQueue({
        clock,
        eventId: () => `sokuji_${++n}`,
        sink: {
          // The server answers a `response.create` at once: refused while a response is active, else created.
          send: (request, eventId, waitedMs) => {
            expect(waitedMs).toBeGreaterThanOrEqual(0);
            if (serverActive) {
              outbox.push(() => q.refused(eventId, ACTIVE_RESPONSE));
              return;
            }
            const id = `resp_${++responses}`;
            serverActive = id;
            answered.push(request);
            outbox.push(() => q.created(id, echoes ? eventId : undefined));
          },
          queued: () => {},
        },
      });
      const detect = () => {
        if (serverActive) return;
        const id = `resp_${++responses}`;
        serverActive = id;
        outbox.push(() => q.created(id, undefined));
      };
      const end = () => {
        if (!serverActive || outbox.length > 0) return;
        const id = serverActive;
        serverActive = null;
        outbox.push(() => q.done(id));
      };
      for (let step = 0; step < 80; step++) {
        const r = random();
        if (r < 0.25) {
          const request = random() < 0.5 ? TURN : text(step);
          pushed.push(request);
          q.push(request);
        } else if (r < 0.4) detect();
        else if (r < 0.6) end();
        else outbox.shift()?.();
        clock.advance(10);
      }
      // Drain: every answer delivered, every response ended; nothing is left waiting.
      for (let i = 0; i < 1_000 && (outbox.length > 0 || serverActive); i++) {
        while (outbox.length > 0) outbox.shift()!();
        end();
      }
      expect(answered, `seed ${seed}`).toEqual(pushed);
      expect(q.busy, `seed ${seed}`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run src/providers/openai/queue.test.ts`
Expected: FAIL — `Failed to resolve import "./queue"`.

- [ ] **Step 3: Write it.** Create `src/providers/openai/queue.ts`:

```ts
/**
 * The in-band responses one leg asks for (ruling 8; choice 10): a released
 * press's `response.create` and each typed text wait, first in first out,
 * while a response is in progress, and go up one at a time — the server
 * refuses a second in-band response while one is active (survey §1.11).
 * The old app held one typed text and overwrote it, behind the anchor's
 * responses too (`MainPanel.tsx:1577-1607, 3470-3478` before `aecaae2b`);
 * here nothing is overwritten, and the anchor's out-of-band responses
 * neither wait nor make anything wait (ruling 2). Pure; the clock serves
 * the frames' `waitedMs` alone.
 *
 * - `asked`: the request sent, until the response it created names it back
 *   (its metadata carries the request's event id) or it is refused. A
 *   refusal that names it because a response was active — the server's own
 *   detection answered first — puts it back at the head, to go up when that
 *   response ends; any other refusal naming it, or one naming nothing,
 *   drops it: it could not go up. The end of an in-band response clears it
 *   too: the server answers a `response.create` at once, so by then it was
 *   created or refused.
 * - `active`: the in-band response in progress — the adapter's, or one the
 *   server's own detection created (`create_response: true`).
 */
import type { Clock } from '../../lib/contract/clock';

/** The refusal of a `response.create` sent while a response is still active (survey §1.11). */
export const ACTIVE_RESPONSE = 'conversation_already_has_active_response';

/** What waits: a released press (its audio already committed) or a typed text (its source already shown). */
export type Request = { kind: 'turn' } | { kind: 'text'; itemId: string; text: string };

export interface QueueSink {
  /** Sends the request now, under this event id: a typed text's item and then its `response.create`; a turn's `response.create` alone. */
  send(request: Request, eventId: string, waitedMs: number): void;
  /** A request that must wait behind a response in progress, and how many wait now, it included. */
  queued(request: Request, waiting: number): void;
}

export interface QueueOptions {
  clock: Pick<Clock, 'now'>;
  sink: QueueSink;
  /** A fresh client event id for each request sent. */
  eventId(): string;
}

export class ResponseQueue {
  private readonly waiting: Array<{ request: Request; at: number }> = [];
  private active: string | null = null;
  private asked: { eventId: string; request: Request; at: number } | null = null;
  private stopped = false;

  constructor(private readonly o: QueueOptions) {}

  /** An in-band response is in progress, or asked for. */
  get busy(): boolean {
    return this.active !== null || this.asked !== null;
  }

  push(request: Request): void {
    if (this.stopped) return;
    this.waiting.push({ request, at: this.o.clock.now() });
    if (this.busy) this.o.sink.queued(request, this.waiting.length);
    this.flush();
  }

  /** An in-band response was created: the one asked for when it names the request, else the server's own. */
  created(responseId: string, request: string | undefined): void {
    this.active = responseId;
    if (request !== undefined && request === this.asked?.eventId) this.asked = null;
  }

  /** An in-band response ended: the next request goes up. */
  done(responseId: string): void {
    if (this.active === responseId) this.active = null;
    this.asked = null;
    this.flush();
  }

  /** A server `error`: a refusal of the request asked, when it names it or names nothing. */
  refused(eventId: string | null | undefined, code: string | null | undefined): void {
    const asked = this.asked;
    if (!asked || (eventId && eventId !== asked.eventId)) return;
    this.asked = null;
    // Refused because a response was active: it goes again, first, when that one ends.
    if (eventId === asked.eventId && code === ACTIVE_RESPONSE) this.waiting.unshift({ request: asked.request, at: asked.at });
    this.flush();
  }

  /** Nothing goes up after stop. */
  stop(): void {
    this.stopped = true;
    this.waiting.length = 0;
  }

  private flush(): void {
    if (this.stopped || this.busy) return;
    const next = this.waiting.shift();
    if (!next) return;
    const eventId = this.o.eventId();
    this.asked = { eventId, request: next.request, at: next.at };
    this.o.sink.send(next.request, eventId, this.o.clock.now() - next.at);
  }
}
```

- [ ] **Step 4: Run it to see it pass.**

Run: `npx vitest run src/providers/openai/queue.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline (plus only lines a concurrent Wave 2 task names as its own).

- [ ] **Step 6: Commit.**

```bash
git add src/providers/openai/queue.ts src/providers/openai/queue.test.ts
```

```bash
git commit -q -F - -- src/providers/openai/queue.ts src/providers/openai/queue.test.ts <<'EOF'
feat(openai): hold typed text and a release's response while one is running

First in first out (ruling 8): a request waits while an in-band response
is active or asked for, goes back to the head when the server's own
detection answered first, and is answered exactly once. A seeded test
holds that across interleavings.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 9: The readiness check (Wave 2)

**Files:**
- Create: `src/providers/openai/check.ts`
- Test: `src/providers/openai/check.test.ts`

**Interfaces:**
- Consumes: `boundedFetch` (Task 2); `isRealtimeModelId`, `RealtimeCredentials`, `RealtimeSettings`, `REALTIME_DEFAULTS` (Task 5); `realClock`, `Clock` (`src/lib/contract/clock`); `CheckContext`, `CheckResult` (`src/lib/provider/types`).
- Produces: `OPENAI_MODELS_URL`, `CHECK_TIMEOUT_MS = 15_000`, `RealtimeCheckDeps { fetch?; clock? }`, `createRealtimeCheck(deps?)`, `checkRealtime` (choice 16). Task 12 wires `checkRealtime`.

- [ ] **Step 1: Write the failing test.** Create `src/providers/openai/check.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock, type Clock } from '../../lib/contract/clock';
import type { CheckContext } from '../../lib/provider/types';
import { CHECK_TIMEOUT_MS, createRealtimeCheck, OPENAI_MODELS_URL } from './check';
import { REALTIME_DEFAULTS } from './settings';

const K = { apiKey: 'sk-proj-checkKey0123456789' };
const ctx = (signal?: AbortSignal): CheckContext => ({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'], signal });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const listing = (...models: Array<[string, number]>) => json({ object: 'list', data: models.map(([id, created]) => ({ id, object: 'model', created, owned_by: 'system' })) });
const check = (fetch: typeof globalThis.fetch) => createRealtimeCheck({ fetch, clock: createVirtualClock(0) })(K, REALTIME_DEFAULTS, ctx());

/** A fetch stub that rejects once its request's `signal` aborts, with the signal's reason, as a real `fetch` does. */
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

describe("OpenAI Realtime's check (choice 16)", () => {
  it('GETs the model list with the key as a Bearer token, never in the URL', async () => {
    const fetch = vi.fn(async () => listing(['gpt-realtime-2.1-mini', 1_780_000_000]));
    await check(fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENAI_MODELS_URL);
    expect(url).not.toContain(K.apiKey);
    expect(init).toMatchObject({ method: 'GET', headers: { Authorization: `Bearer ${K.apiKey}` } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('answers ready with the voice-agent models alone — no transcription or translation family — newest first, each id once', async () => {
    const fetch = vi.fn(async () => listing(
      ['gpt-realtime-2.1-mini', 1_780_000_000],
      ['gpt-realtime-translate', 1_790_000_000],
      ['gpt-realtime-whisper', 1_790_000_001],
      ['gpt-realtime-2.1', 1_785_000_000],
      ['gpt-audio-1.5', 1_786_000_000],
      ['gpt-4o-realtime-preview', 1_700_000_000],
      ['gpt-realtime-mini', 1_760_000_000],
      ['gpt-realtime-2.1-mini', 1_780_000_000],
    ));
    await expect(check(fetch)).resolves.toEqual({ ok: true, models: [{ id: 'gpt-realtime-2.1' }, { id: 'gpt-realtime-2.1-mini' }, { id: 'gpt-realtime-mini' }] });
  });

  it("answers a key that reaches no voice-agent model not ready, in the old validation's words (`no_realtime_model`)", async () => {
    const fetch = vi.fn(async () => listing(['gpt-realtime-translate', 1], ['gpt-4o-mini', 2]));
    await expect(check(fetch)).resolves.toEqual({ ok: false, code: 'no_realtime_model', reason: 'This key lists no gpt-realtime model.' });
    const empty = vi.fn(async () => json({ object: 'list' }));
    await expect(check(empty)).resolves.toMatchObject({ ok: false, code: 'no_realtime_model' });
  });

  it("answers a refused key — a restricted project key's 403 too (ruling 17) — not ready with the auth code and OpenAI's own words", async () => {
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
    const fetch = vi.fn(async () => json({ error: { message: 'You exceeded your current quota.', code: 'insufficient_quota' } }, 429));
    await expect(check(fetch)).resolves.toEqual({ ok: false, code: 'rate_limit', reason: 'HTTP 429: You exceeded your current quota.' });
  });

  it('throws on any other status, or a network failure: it could not find out', async () => {
    for (const status of [400, 404, 500, 503]) {
      const fetch = vi.fn(async () => json({ error: { message: 'nope' } }, status));
      await expect(check(fetch)).rejects.toThrow(`OpenAI answered the model list with HTTP ${status}.`);
    }
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(check(offline)).rejects.toThrow('Failed to fetch');
  });

  it('never answers with the key', async () => {
    const answers = await Promise.all([
      check(vi.fn(async () => listing(['gpt-realtime-2.1', 1]))),
      check(vi.fn(async () => new Response('', { status: 403 }))),
      check(vi.fn(async () => json({ error: { code: 'unsupported_country_region_territory' } }, 403))),
      check(vi.fn(async () => json({}, 429))),
    ]);
    expect(JSON.stringify(answers)).not.toContain(K.apiKey);
  });

  it('bounds its own request: no answer within 15 s throws, and aborts the request (choice 2)', async () => {
    const { clock, advance } = spiedClock();
    const { fetch, aborted } = abortableFetchStub();
    const answer = createRealtimeCheck({ fetch, clock })(K, REALTIME_DEFAULTS, ctx());
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
    const answer = createRealtimeCheck({ fetch, clock })(K, REALTIME_DEFAULTS, ctx(c.signal));
    c.abort(new Error('cancelled'));
    await expect(answer).rejects.toThrow('cancelled');
    expect(aborted()).toBe(true);
    expect(cancels[0]).toHaveBeenCalled();
  });

  it('an already aborted signal throws before any request', async () => {
    const fetch = vi.fn();
    await expect(createRealtimeCheck({ fetch, clock: createVirtualClock(0) })(K, REALTIME_DEFAULTS, ctx(AbortSignal.abort(new Error('gone'))))).rejects.toThrow('gone');
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run src/providers/openai/check.test.ts`
Expected: FAIL — `Failed to resolve import "./check"`.

- [ ] **Step 3: Write it.** Create `src/providers/openai/check.ts`:

```ts
/**
 * OpenAI Realtime's readiness (spec: "Readiness is one check"): the model
 * list the old validation read (`OpenAIClient.ts:140-336`), with three
 * changes (choice 16) — the request is bounded (`boundedFetch`, choice 2);
 * a status the key does not explain (a 404, a 5xx) or a failed fetch
 * throws, where the old one called every failure an invalid key; and a
 * refusal answers a code the surfaces put into words. The key rides in the
 * `Authorization` header, never the URL. It reads no setting (ruling 9:
 * `checkReads: []`). The settings side: not reached by the adapter, so it
 * may use the real clock by default.
 */
import { realClock, type Clock } from '../../lib/contract/clock';
import { boundedFetch } from '../../lib/provider/boundedFetch';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { isRealtimeModelId, type RealtimeCredentials, type RealtimeSettings } from './settings';

export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
/** As long as the other checks wait. */
export const CHECK_TIMEOUT_MS = 15_000;

interface ModelList { data?: Array<{ id?: unknown; created?: unknown }> }
interface ErrorBody { error?: { message?: unknown; code?: unknown } }

export interface RealtimeCheckDeps {
  fetch?: typeof fetch;
  clock?: Pick<Clock, 'setTimeout'>;
}

export function createRealtimeCheck(deps: RealtimeCheckDeps = {}) {
  const clock = deps.clock ?? realClock;
  return (k: RealtimeCredentials, _s: RealtimeSettings, ctx: CheckContext): Promise<CheckResult> => {
    // Read at call time, so a test's stubbed global is seen.
    const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const late = `OpenAI did not answer the model list within ${CHECK_TIMEOUT_MS / 1000} s.`;
    return boundedFetch({ clock, ms: CHECK_TIMEOUT_MS, signal: ctx.signal, late }, async (signal): Promise<CheckResult> => {
      const response = await doFetch(OPENAI_MODELS_URL, { method: 'GET', headers: { Authorization: `Bearer ${k.apiKey}` }, signal });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ErrorBody;
        const said = typeof body.error?.message === 'string' && body.error.message ? body.error.message : 'OpenAI did not accept this key.';
        const reason = `HTTP ${response.status}: ${said}`;
        // A region OpenAI does not serve reads as such, whatever the status (`OpenAIClient.ts:170-179`).
        if (body.error?.code === 'unsupported_country_region_territory') return { ok: false, code: 'region_unsupported', reason };
        // A restricted project key's 403 reads as a refused key, as the old validation did (ruling 17).
        if (response.status === 401 || response.status === 403) return { ok: false, code: 'auth', reason };
        if (response.status === 429) return { ok: false, code: 'rate_limit', reason };
        throw new Error(`OpenAI answered the model list with HTTP ${response.status}.`);
      }
      const body = (await response.json()) as ModelList;
      const models = (body.data ?? [])
        .flatMap((m) => (typeof m.id === 'string' && isRealtimeModelId(m.id) ? [{ id: m.id, created: typeof m.created === 'number' ? m.created : 0 }] : []))
        // Newest first, as the old list sorted them (`OpenAIClient.ts:329-335`); the id breaks a tie.
        .sort((a, b) => b.created - a.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      // Each id once: a readiness answer's models are keyed by id.
      const ids = [...new Set(models.map((m) => m.id))];
      if (ids.length === 0) return { ok: false, code: 'no_realtime_model', reason: 'This key lists no gpt-realtime model.' };
      return { ok: true, models: ids.map((id) => ({ id })) };
    });
  };
}

export const checkRealtime = createRealtimeCheck();
```

- [ ] **Step 4: Run it to see it pass.**

Run: `npx vitest run src/providers/openai/check.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline (plus only lines a concurrent Wave 2 task names as its own).

- [ ] **Step 6: Commit.**

```bash
git add src/providers/openai/check.ts src/providers/openai/check.test.ts
```

```bash
git commit -q -F - -- src/providers/openai/check.ts src/providers/openai/check.test.ts <<'EOF'
feat(openai): OpenAI Realtime's readiness is one bounded model list

The realtime voice-agent models the key can use, newest first; none is
"no realtime model", an unsupported region its own words, and a 401 or
403 the auth words (ruling 17). Bounded at 15 s like every check.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 10: The settings view and the turn detection (Wave 2)

**Files:**
- Create: `src/providers/openai/RealtimeSettings.tsx`, `src/providers/openai/RealtimeTurnDetection.tsx`, `src/providers/openai/TranscriptionField.tsx`, `src/providers/openai/ReasoningEffortField.tsx`
- Test: `src/providers/openai/RealtimeSettings.test.tsx`, `src/providers/openai/RealtimeTurnDetection.test.tsx`

**Interfaces:**
- Consumes: `InstructionsField`, `VoiceField`, `ModelField`, `NoiseReductionField`, `ModelConfigurationField` (Task 4: temperature optional) from `src/components/providers/fields/`; `resolveInstructions`; `SettingsProps`; Task 5's `settings.ts` (`REALTIME_*`, `effectiveRealtimeModel`, `takesReasoning`, `realtimeLanguageName`, `TRANSCRIPT_MODELS`, `REASONING_EFFORTS`, `SEMANTIC_EAGERNESSES`) and `supportsTranscriptionContext`.
- Produces: `RealtimeSettingsView(props: SettingsProps<RealtimeSettings>)`; `RealtimeTurnDetectionSummary`, `RealtimeTurnDetectionHelp`, `RealtimeTurnDetectionControls` (each `SettingsProps<RealtimeSettings>`); `TranscriptionField({ model, keywords, onChange, disabled? })`; `ReasoningEffortField({ value, onChange, disabled? })` (choice 17). Task 12 wires them.

- [ ] **Step 1: Write the failing tests.** Create `src/providers/openai/RealtimeSettings.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : values;
      const text = typeof fallback === 'string' ? fallback : key;
      return options ? text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name])) : text;
    },
  }),
}));
const tooltips: unknown[] = [];
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: ({ content }: { content: unknown }) => { tooltips.push(content); return null; } }));

import type { SettingsProps } from '../../lib/provider/types';
import { RealtimeSettingsView } from './RealtimeSettings';
import { REALTIME_DEFAULTS, type RealtimeSettings } from './settings';

const props = (patch: Partial<SettingsProps<RealtimeSettings>> = {}): SettingsProps<RealtimeSettings> => ({
  settings: REALTIME_DEFAULTS,
  update: vi.fn(),
  pair: { source: 'ja', target: 'en' },
  models: [{ id: 'gpt-realtime-2.1' }, { id: 'gpt-realtime-2.1-mini' }, { id: 'gpt-realtime-mini' }],
  ...patch,
});
const headings = (container: HTMLElement) => Array.from(container.querySelectorAll('.settings-section > h2')).map((h) => h.textContent);

describe('RealtimeSettingsView (choice 17)', () => {
  it('draws the old sections in the old order: instructions, voice, model, transcript, noise, model configuration, reasoning — and no transport, temperature or push mode', () => {
    const { container } = render(<RealtimeSettingsView {...props()} />);
    expect(headings(container)).toEqual([
      'settings.systemInstructions', 'settings.voice', 'settings.model', 'settings.userTranscriptModel', 'settings.noiseReduction',
      'settings.modelConfiguration', 'settings.reasoningEffort',
    ]);
    expect(screen.queryByLabelText('settings.temperature')).toBeNull();
    expect(container.textContent).not.toMatch(/WebRTC|settings\.pushToTalk|settings\.pushToTranslate/);
  });

  it("previews Quick's prompt for the pair, and edits its own instructions", () => {
    const update = vi.fn();
    const { container } = render(<RealtimeSettingsView {...props({ update })} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.preview' }));
    expect(container.querySelector('.preview-content')?.textContent).toContain('translate Japanese → English.');
    fireEvent.click(screen.getByRole('button', { name: 'settings.advanced' }));
    expect(update).toHaveBeenCalledWith({ useTemplateMode: false });
  });

  it('writes the voice, the model — shown as the effective one — the noise reduction and the max tokens', () => {
    const update = vi.fn();
    render(<RealtimeSettingsView {...props({ update, settings: { ...REALTIME_DEFAULTS, model: 'gpt-realtime-9' } })} />);
    const voice = screen.getByLabelText('settings.voice') as HTMLSelectElement;
    expect(voice.options).toHaveLength(10);
    fireEvent.change(voice, { target: { value: 'marin' } });
    expect(update).toHaveBeenCalledWith({ voice: 'marin' });
    const model = screen.getByLabelText('settings.model') as HTMLSelectElement;
    expect(model.value).toBe('gpt-realtime-2.1-mini');
    fireEvent.change(model, { target: { value: 'gpt-realtime-mini' } });
    expect(update).toHaveBeenCalledWith({ model: 'gpt-realtime-mini' });
    fireEvent.change(screen.getByLabelText('settings.noiseReduction'), { target: { value: 'Near field' } });
    expect(update).toHaveBeenCalledWith({ noiseReduction: 'Near field' });
    fireEvent.click(screen.getByLabelText('Unlimited'));
    expect(update).toHaveBeenCalledWith({ maxTokens: 4096 });
  });

  it('shows the transcription keywords only for a model that takes them, and writes both', () => {
    const update = vi.fn();
    const { rerender } = render(<RealtimeSettingsView {...props({ update })} />);
    expect(screen.queryByLabelText('Transcription keywords')).toBeNull();
    const transcript = screen.getByLabelText('settings.userTranscriptModel') as HTMLSelectElement;
    expect(Array.from(transcript.options).map((o) => o.value)).toEqual(['gpt-live-transcribe', 'gpt-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1']);
    fireEvent.change(transcript, { target: { value: 'gpt-live-transcribe' } });
    expect(update).toHaveBeenCalledWith({ transcriptModel: 'gpt-live-transcribe' });
    rerender(<RealtimeSettingsView {...props({ update, settings: { ...REALTIME_DEFAULTS, transcriptModel: 'gpt-live-transcribe', transcriptKeywords: 'Sokuji' } })} />);
    const keywords = screen.getByLabelText('Transcription keywords') as HTMLInputElement;
    expect(keywords.value).toBe('Sokuji');
    fireEvent.change(keywords, { target: { value: 'Sokuji, Kizuna AI' } });
    expect(update).toHaveBeenCalledWith({ transcriptKeywords: 'Sokuji, Kizuna AI' });
  });

  it('draws the reasoning effort for a gpt-realtime-2* model alone, with its option words', () => {
    const update = vi.fn();
    const { rerender } = render(<RealtimeSettingsView {...props({ update })} />);
    const effort = screen.getByLabelText('settings.reasoningEffort') as HTMLSelectElement;
    expect(Array.from(effort.options).map((o) => [o.value, o.textContent])).toEqual([
      ['minimal', 'minimal'], ['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['xhigh', 'xhigh'],
    ]);
    fireEvent.change(effort, { target: { value: 'medium' } });
    expect(update).toHaveBeenCalledWith({ reasoningEffort: 'medium' });
    rerender(<RealtimeSettingsView {...props({ update, settings: { ...REALTIME_DEFAULTS, model: 'gpt-realtime-mini' } })} />);
    expect(screen.queryByLabelText('settings.reasoningEffort')).toBeNull();
  });

  it('disabled locks every control', () => {
    render(<RealtimeSettingsView {...props({ disabled: true, settings: { ...REALTIME_DEFAULTS, transcriptModel: 'gpt-transcribe' } })} />);
    for (const label of ['settings.voice', 'settings.model', 'settings.userTranscriptModel', 'Transcription keywords', 'settings.noiseReduction', 'Unlimited', 'settings.reasoningEffort']) {
      expect(screen.getByLabelText(label), label).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'settings.advanced' })).toBeDisabled();
  });
});
```

Create `src/providers/openai/RealtimeTurnDetection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => (typeof fallback === 'string' ? fallback : key),
  }),
}));
const tooltips: unknown[] = [];
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: ({ content }: { content: unknown }) => { tooltips.push(content); return null; } }));

import type { SettingsProps } from '../../lib/provider/types';
import { RealtimeTurnDetectionControls, RealtimeTurnDetectionHelp, RealtimeTurnDetectionSummary } from './RealtimeTurnDetection';
import { REALTIME_DEFAULTS, type RealtimeSettings } from './settings';

const props = (patch: Partial<RealtimeSettings> = {}, update = vi.fn(), disabled = false): SettingsProps<RealtimeSettings> => ({
  settings: { ...REALTIME_DEFAULTS, ...patch },
  update,
  disabled,
});

describe("OpenAI Realtime's turn detection (choice 17; ruling 4)", () => {
  it('sums up the mechanism in one line of existing words', () => {
    const normal = render(<RealtimeTurnDetectionSummary {...props()} />);
    expect(normal.container.textContent).toBe('settings.normal · settings.threshold 0.49 · settings.silenceDuration 0.50s');
    normal.unmount();
    const semantic = render(<RealtimeTurnDetectionSummary {...props({ turnDetectionMode: 'Semantic', semanticEagerness: 'High' })} />);
    expect(semantic.container.textContent).toBe('settings.semantic · settings.eagerness settings.high');
  });

  it('its help is the old speech-mode tooltip, which tells Normal from Semantic', () => {
    render(<RealtimeTurnDetectionHelp {...props()} />);
    expect(tooltips).toContain('settings.turnDetectionTooltip');
  });

  it("the controls are the two mechanisms under the VAD heading; Normal's three knobs write the old fields, in their old ranges", () => {
    const update = vi.fn();
    const { container } = render(<RealtimeTurnDetectionControls {...props({}, update)} />);
    expect(container.querySelector('#openai-vad-section > h2')?.textContent).toBe('VAD Settings');
    expect(screen.getByRole('button', { name: 'settings.normal' }).className).toContain('active');
    fireEvent.click(screen.getByRole('button', { name: 'settings.semantic' }));
    expect(update).toHaveBeenCalledWith({ turnDetectionMode: 'Semantic' });
    const threshold = screen.getByLabelText('settings.threshold') as HTMLInputElement;
    expect([threshold.min, threshold.max, threshold.step, threshold.value]).toEqual(['0', '1', '0.01', '0.49']);
    fireEvent.change(threshold, { target: { value: '0.6' } });
    expect(update).toHaveBeenCalledWith({ threshold: 0.6 });
    const prefix = screen.getByLabelText('settings.prefixPadding') as HTMLInputElement;
    expect([prefix.min, prefix.max]).toEqual(['0', '2']);
    fireEvent.change(prefix, { target: { value: '0.3' } });
    expect(update).toHaveBeenCalledWith({ prefixPadding: 0.3 });
    fireEvent.change(screen.getByLabelText('settings.silenceDuration'), { target: { value: '1.2' } });
    expect(update).toHaveBeenCalledWith({ silenceDuration: 1.2 });
    expect(Array.from(container.querySelectorAll('.setting-value')).map((v) => v.textContent)).toEqual(['0.49', '0.50s', '0.50s']);
    expect(screen.queryByLabelText('settings.eagerness')).toBeNull();
    for (const tip of ['settings.turnDetectionTooltip', 'settings.thresholdTooltip', 'settings.prefixPaddingTooltip', 'settings.silenceDurationTooltip']) expect(tooltips).toContain(tip);
  });

  it("Semantic's knob is its eagerness, in the old four", () => {
    const update = vi.fn();
    render(<RealtimeTurnDetectionControls {...props({ turnDetectionMode: 'Semantic' }, update)} />);
    expect(screen.queryByLabelText('settings.threshold')).toBeNull();
    const eagerness = screen.getByLabelText('settings.eagerness') as HTMLSelectElement;
    expect(Array.from(eagerness.options).map((o) => [o.value, o.textContent])).toEqual([['Auto', 'settings.auto'], ['Low', 'settings.low'], ['Medium', 'settings.medium'], ['High', 'settings.high']]);
    fireEvent.change(eagerness, { target: { value: 'Low' } });
    expect(update).toHaveBeenCalledWith({ semanticEagerness: 'Low' });
    expect(tooltips).toContain('settings.semanticEagernessTooltip');
  });

  it('the controls lock while disabled', () => {
    render(<RealtimeTurnDetectionControls {...props({}, vi.fn(), true)} />);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
    for (const s of screen.getAllByRole('slider')) expect(s).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/openai/RealtimeSettings.test.tsx src/providers/openai/RealtimeTurnDetection.test.tsx`
Expected: FAIL — 2 files: `Failed to resolve import "./RealtimeSettings"` (and `"./RealtimeTurnDetection"`).

- [ ] **Step 3: Write the two provider fields.** Create `src/providers/openai/TranscriptionField.tsx` (the old section, `PSS:886-954`; its keywords only for a context-capable model):

```tsx
import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip/Tooltip';
import { TRANSCRIPT_MODELS, type TranscriptModel } from './settings';
import { supportsTranscriptionContext } from './transcription';

const helpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />;

export interface TranscriptionFieldProps {
  model: TranscriptModel;
  keywords: string;
  onChange(patch: { transcriptModel?: TranscriptModel; transcriptKeywords?: string }): void;
  disabled?: boolean;
}

/**
 * The source transcript's model and glossary (choice 17): the old section
 * (`ProviderSpecificSettings.tsx:886-954`), in the provider's folder — only
 * the OpenAI family has it. The glossary shows for the models that take
 * `keywords` alone: the others refuse the whole `session.update` with it.
 * The select gains an `aria-label`, as the shared fields' selects have.
 */
export function TranscriptionField({ model, keywords, onChange, disabled = false }: TranscriptionFieldProps) {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <h2>
        {t('settings.userTranscriptModel')}
        <Tooltip content={t('settings.transcriptModelTooltip')} position="top">{helpIcon}</Tooltip>
      </h2>
      <div className="setting-item">
        <select className="select-dropdown" aria-label={t('settings.userTranscriptModel')} value={model} onChange={(e) => onChange({ transcriptModel: e.target.value as TranscriptModel })} disabled={disabled}>
          {TRANSCRIPT_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {supportsTranscriptionContext(model) && (
        <div className="setting-item">
          {/* .setting-label is space-between flex, so the text and its tooltip share one child or they end up at opposite edges. */}
          <label className="setting-label" htmlFor="transcript-keywords">
            <span>
              {t('settings.transcriptKeywords', 'Transcription keywords')}
              <Tooltip
                content={t(
                  'settings.transcriptKeywordsTooltip',
                  'Names, jargon, and product terms the transcriber should be ready for, separated by commas. Hints only — a term appears in the transcript only when it is actually spoken.',
                )}
                position="top"
              >
                {helpIcon}
              </Tooltip>
            </span>
          </label>
          <input
            id="transcript-keywords"
            type="text"
            className="text-input"
            value={keywords}
            onChange={(e) => onChange({ transcriptKeywords: e.target.value })}
            placeholder={t('settings.transcriptKeywordsPlaceholder', 'Sokuji, Kizuna AI, PulseAudio')}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}
```

Create `src/providers/openai/ReasoningEffortField.tsx` (`PSS:1044-1084`):

```tsx
import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip/Tooltip';
import { REASONING_EFFORTS, type ReasoningEffort } from './settings';

export interface ReasoningEffortFieldProps {
  value: ReasoningEffort;
  onChange(effort: ReasoningEffort): void;
  disabled?: boolean;
}

/**
 * How much a `gpt-realtime-2*` model deliberates (choice 17): the old
 * section (`ProviderSpecificSettings.tsx:1044-1084`), in the provider's
 * folder. The view draws it for such a model alone, as the builder sends it.
 * The select gains an `aria-label`.
 */
export function ReasoningEffortField({ value, onChange, disabled = false }: ReasoningEffortFieldProps) {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <h2>
        {t('settings.reasoningEffort')}
        <Tooltip content={t('settings.reasoningEffortTooltip')} position="top">
          <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
        </Tooltip>
      </h2>
      <div className="setting-item">
        <select className="select-dropdown" aria-label={t('settings.reasoningEffort')} value={value} onChange={(e) => onChange(e.target.value as ReasoningEffort)} disabled={disabled}>
          {REASONING_EFFORTS.map((effort) => <option key={effort} value={effort}>{t(`settings.reasoningEffortOptions.${effort}`, effort)}</option>)}
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the view.** Create `src/providers/openai/RealtimeSettings.tsx`:

```tsx
import { InstructionsField } from '../../components/providers/fields/InstructionsField';
import { ModelConfigurationField } from '../../components/providers/fields/ModelConfigurationField';
import { ModelField } from '../../components/providers/fields/ModelField';
import { NoiseReductionField } from '../../components/providers/fields/NoiseReductionField';
import { VoiceField } from '../../components/providers/fields/VoiceField';
import { resolveInstructions } from '../../lib/provider/instructions';
import type { SettingsProps } from '../../lib/provider/types';
import { ReasoningEffortField } from './ReasoningEffortField';
import {
  effectiveRealtimeModel, NOISE_REDUCTIONS, realtimeLanguageName, realtimeLanguages, REALTIME_MAX_TOKENS_RANGE, REALTIME_VOICES, takesReasoning,
  type RealtimeSettings as S,
} from './settings';
import { TranscriptionField } from './TranscriptionField';

/**
 * OpenAI Realtime's own settings (D18), the old UI's OpenAI sections
 * (`ProviderSpecificSettings.tsx:2185-2282`) recomposed from the shared
 * fields in the old order (choice 17): its instructions, the voice, the
 * model — the effective one, the same function `build` calls — the
 * transcript, the noise reduction, the max tokens (no temperature: ruling
 * 6), and the reasoning effort for a `gpt-realtime-2*` model. The
 * automatic-detection knobs are its `TurnDetection`; the transport stays
 * unshown until the WebRTC step (ruling 12).
 */
export function RealtimeSettingsView({ settings, update, disabled = false, pair, models = [] }: SettingsProps<S>) {
  const model = effectiveRealtimeModel(settings, models);
  const initial = realtimeLanguages.initial?.(settings);
  const source = pair?.source ?? initial?.source ?? '';
  const target = pair?.target ?? initial?.target ?? '';
  const preview = resolveInstructions(settings, { participant: false, source: realtimeLanguageName(source), target: realtimeLanguageName(target) });
  return (
    <>
      <InstructionsField value={settings} onChange={update} preview={preview} disabled={disabled} />
      <VoiceField value={settings.voice} options={REALTIME_VOICES} onChange={(voice) => update({ voice })} disabled={disabled} />
      <ModelField value={model} models={models} onChange={(m) => update({ model: m })} disabled={disabled} />
      <TranscriptionField model={settings.transcriptModel} keywords={settings.transcriptKeywords} onChange={update} disabled={disabled} />
      <NoiseReductionField value={settings.noiseReduction} options={NOISE_REDUCTIONS} onChange={(noiseReduction) => update({ noiseReduction })} disabled={disabled} />
      <ModelConfigurationField maxTokens={settings.maxTokens} maxTokensRange={REALTIME_MAX_TOKENS_RANGE} onChange={({ maxTokens }) => { if (maxTokens !== undefined) update({ maxTokens }); }} disabled={disabled} />
      {takesReasoning(model) && <ReasoningEffortField value={settings.reasoningEffort} onChange={(reasoningEffort) => update({ reasoningEffort })} disabled={disabled} />}
    </>
  );
}
```

- [ ] **Step 5: Write the turn detection.** Create `src/providers/openai/RealtimeTurnDetection.tsx` (`PSS:508-719`, the push modes and the WebRTC notice dropped; under the VAD heading as Gemini's):

```tsx
import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip/Tooltip';
import type { SettingsProps } from '../../lib/provider/types';
import {
  REALTIME_PREFIX_RANGE, REALTIME_SILENCE_RANGE, REALTIME_THRESHOLD_RANGE, SEMANTIC_EAGERNESSES, type RealtimeSettings as S, type SemanticEagerness,
  type TurnDetectionMode,
} from './settings';

const helpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />;
const inlineHelpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />;

const eagernessKey = (e: SemanticEagerness) => `settings.${e.toLowerCase()}`;

/** One line, existing words only (choice 17): the mechanism and the knob that shapes it most. */
export function RealtimeTurnDetectionSummary({ settings }: SettingsProps<S>) {
  const { t } = useTranslation();
  if (settings.turnDetectionMode === 'Semantic') return <>{`${t('settings.semantic')} · ${t('settings.eagerness')} ${t(eagernessKey(settings.semanticEagerness))}`}</>;
  return <>{`${t('settings.normal')} · ${t('settings.threshold')} ${settings.threshold.toFixed(2)} · ${t('settings.silenceDuration')} ${settings.silenceDuration.toFixed(2)}s`}</>;
}

/** The old speech-mode tooltip, which tells Normal from Semantic, beside the Speech section's summary. */
export function RealtimeTurnDetectionHelp(_props: SettingsProps<S>) {
  const { t } = useTranslation();
  return <Tooltip content={t('settings.turnDetectionTooltip')} position="top">{inlineHelpIcon}</Tooltip>;
}

/**
 * The old turn-detection section's knobs (`ProviderSpecificSettings.tsx:
 * 508-719`) under the VAD heading, as Gemini's: the two automatic
 * mechanisms and each one's knobs. The push modes are the global turn
 * mode's now (the Speech section), and the WebRTC notice waits for the
 * WebRTC step. Both legs use them: the participant's detection is the
 * user's own (ruling 4).
 */
export function RealtimeTurnDetectionControls({ settings, update, disabled = false }: SettingsProps<S>) {
  const { t } = useTranslation();
  const slider = (value: number, write: (v: number) => void, label: string, tooltip: string, range: { min: number; max: number; step: number }, unit: string) => (
    <div className="setting-item">
      <div className="setting-label">
        <span>
          {t(label)}
          <Tooltip content={t(tooltip)} position="top">{inlineHelpIcon}</Tooltip>
        </span>
        <span className="setting-value">{value.toFixed(2)}{unit}</span>
      </div>
      <input
        type="range" aria-label={t(label)}
        min={range.min} max={range.max} step={range.step} value={value}
        onChange={(e) => write(parseFloat(e.target.value))}
        className="slider" disabled={disabled}
      />
    </div>
  );
  return (
    <div className="settings-section" id="openai-vad-section">
      <h2>
        {t('settings.vadSettings', 'VAD Settings')}
        <Tooltip content={t('settings.turnDetectionTooltip')} position="top">{helpIcon}</Tooltip>
      </h2>
      <div className="setting-item">
        <div className="turn-detection-options">
          {(['Normal', 'Semantic'] as const satisfies readonly TurnDetectionMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`option-button ${settings.turnDetectionMode === mode ? 'active' : ''}`}
              onClick={() => update({ turnDetectionMode: mode })}
              disabled={disabled}
            >
              {t(`settings.${mode.toLowerCase()}`)}
            </button>
          ))}
        </div>
      </div>
      {settings.turnDetectionMode === 'Normal' && (
        <>
          {slider(settings.threshold, (threshold) => update({ threshold }), 'settings.threshold', 'settings.thresholdTooltip', REALTIME_THRESHOLD_RANGE, '')}
          {slider(settings.prefixPadding, (prefixPadding) => update({ prefixPadding }), 'settings.prefixPadding', 'settings.prefixPaddingTooltip', REALTIME_PREFIX_RANGE, 's')}
          {slider(settings.silenceDuration, (silenceDuration) => update({ silenceDuration }), 'settings.silenceDuration', 'settings.silenceDurationTooltip', REALTIME_SILENCE_RANGE, 's')}
        </>
      )}
      {settings.turnDetectionMode === 'Semantic' && (
        <div className="setting-item">
          <div className="setting-label">
            <span>
              {t('settings.eagerness')}
              <Tooltip content={t('settings.semanticEagernessTooltip')} position="top">{inlineHelpIcon}</Tooltip>
            </span>
          </div>
          <select
            className="select-dropdown" aria-label={t('settings.eagerness')}
            value={settings.semanticEagerness}
            onChange={(e) => update({ semanticEagerness: e.target.value as SemanticEagerness })}
            disabled={disabled}
          >
            {SEMANTIC_EAGERNESSES.map((e) => <option key={e} value={e}>{t(eagernessKey(e))}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run them to see them pass.**

Run: `npx vitest run src/providers/openai/RealtimeSettings.test.tsx src/providers/openai/RealtimeTurnDetection.test.tsx`
Expected: PASS — 2 files, 11 tests.

- [ ] **Step 7: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline (plus only lines a concurrent Wave 2 task names as its own).

- [ ] **Step 8: Commit.**

```bash
git add src/providers/openai/RealtimeSettings.tsx src/providers/openai/RealtimeSettings.test.tsx src/providers/openai/RealtimeTurnDetection.tsx src/providers/openai/RealtimeTurnDetection.test.tsx src/providers/openai/TranscriptionField.tsx src/providers/openai/ReasoningEffortField.tsx
```

```bash
git commit -q -F - -- src/providers/openai/RealtimeSettings.tsx src/providers/openai/RealtimeSettings.test.tsx src/providers/openai/RealtimeTurnDetection.tsx src/providers/openai/RealtimeTurnDetection.test.tsx src/providers/openai/TranscriptionField.tsx src/providers/openai/ReasoningEffortField.tsx <<'EOF'
feat(openai): OpenAI Realtime's settings view and turn detection

The shared fields, in the old tab's order, with the provider's own
transcription and reasoning-effort fields; the max tokens without a
temperature. Turn detection under the VAD heading: Normal's three sliders
or Semantic's eagerness.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---
### Task 11: The adapter (Wave 3)

**Files:**
- Modify: `src/providers/openai/adapter.ts` (the seed, replaced in full), `src/providers/openai/testing.ts` (the harness appended), `src/providers/sessionSide.consistency.test.ts`
- Test: `src/providers/openai/adapter.test.ts`

**Interfaces:**
- Consumes: Task 6's wire, seam and fixtures; Task 7's `RealtimeItems`; Task 8's `ResponseQueue`, `Request`, `ACTIVE_RESPONSE`; Task 1's `base64ToPcm`; the contract's `Adapter`, `AdapterEvents`, `AdapterStartError`, `SessionContext`, `framePayload`, `describeCause`; the kit's `fakeSockets`, `trackedClock`, `recordEvents`, `driveAdapter`, `runScenario`, `scenarioNames`; `Conversation` and `createProjector` (the pairing case).
- Produces: `createRealtimeAdapter(deps?: Partial<RealtimeAdapterDeps>): Adapter<RealtimeConfig, RealtimeCredentials>` with `RealtimeAdapterDeps { openSocket: OpenSocket }`; `START_TIMEOUT_MS = 30_000`, `NEVER_OPENED`, `ERROR_WORDS_MS = 10_000`, `ANCHOR_EVERY = 5`; in `testing.ts`, `startRealtime({ context?, patch?, credentials? })` (a leg over `FakeSocket`s on a tracked virtual clock; its socket not yet opened; returns `{ sockets, clock, timers, log, controller, config, starting, socket, of, frames, sent, said, appended, content, receive }`) and `liveRealtime(o?)` (opened, created, configured: the start resolved, the first anchor sent; adds `session`). Task 12 wires `createRealtimeAdapter`.

- [ ] **Step 1: Append the harness to the fixtures.** In `src/providers/openai/testing.ts`:

```diff
--- a/src/providers/openai/testing.ts
+++ b/src/providers/openai/testing.ts
@@ -1,13 +1,19 @@
 /**
  * The OpenAI Realtime suites' fixtures: a key, the settings the suites build
  * from, the server's events as the JSON text frames the GA endpoint sends,
- * and a browser that refuses the socket. Test-only: nothing but a test
+ * a browser that refuses the socket, and the harness that starts a leg over
+ * `FakeSocket`s. Test-only: nothing but a test
  * imports it (the session-side guard's kit rule counts every provider's
  * `testing.ts` as kit and holds it to that), and the adapter's session walk
  * never reaches it.
  */
 import type { SessionContext } from '../../lib/contract/adapter';
+import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
+import { base64ToPcm } from '../../lib/contract/pcm64';
+import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
+import { trackedClock } from '../../lib/contract/testing/trackedClock';
 import type { SharedSettings } from '../../lib/provider/types';
+import { createRealtimeAdapter } from './adapter';
 import { buildRealtime, type RealtimeConfig } from './config';
 import { REALTIME_DEFAULTS, type RealtimeCredentials, type RealtimeSettings } from './settings';
 
@@ -120,3 +126,38 @@
     SERVER.responseDone(resp),
   ];
 }
+
+/** An OpenAI Realtime leg started over `FakeSocket`s on a tracked virtual clock; its socket not yet opened. */
+export function startRealtime(o: { context?: SessionContext; patch?: Partial<RealtimeSettings>; credentials?: RealtimeCredentials } = {}) {
+  const sockets = fakeSockets();
+  const { clock, timers } = trackedClock();
+  const { events, log } = recordEvents();
+  const controller = new AbortController();
+  const context = o.context ?? AUTO_CTX;
+  const config = configFor(context, o.patch);
+  const starting = createRealtimeAdapter({ openSocket: sockets.create }).start({ context, config, credentials: o.credentials ?? KEY, clock, signal: controller.signal }, events);
+  const socket = () => sockets.last();
+  const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
+  /** The payloads of the frames of one type, in order. */
+  const frames = (type: string) => of('frame').filter((e) => e.payload.type === type).map((e) => e.payload.payload);
+  /** What the client sent on the leg's socket, parsed. */
+  const sent = () => socket().sentJson<Record<string, unknown>>();
+  /** What was sent, appends aside: the frames that are not audio. */
+  const said = () => sent().filter((m) => m.type !== 'input_audio_buffer.append');
+  /** The pcm of every append sent, in order. */
+  const appended = () => sent().filter((m) => m.type === 'input_audio_buffer.append').map((m) => base64ToPcm(m.audio as string));
+  /** The log without its frames: what L1 folds. */
+  const content = () => log.filter((e) => e.kind !== 'frame');
+  /** The server says each of these, in order. */
+  const receive = (...messages: string[]) => { for (const m of messages) socket().receive(m); };
+  return { sockets, clock, timers, log, controller, config, starting, socket, of, frames, sent, said, appended, content, receive };
+}
+
+/** Started, opened, created and configured: the start resolved, the first anchor sent. */
+export async function liveRealtime(o?: Parameters<typeof startRealtime>[0]) {
+  const h = startRealtime(o);
+  h.socket().open('realtime');
+  h.receive(SERVER.created(), SERVER.updated());
+  const session = await h.starting;
+  return { ...h, session };
+}
```

- [ ] **Step 2: Write the failing test.** Create `src/providers/openai/adapter.test.ts`. It runs the kit's conformance scenarios (all but reconnecting, which this adapter does not do: ruling 14), then the adapter's own cases — opening and the start's bound, turns and typed text going up (a routine refusal asked again, and never the words of a close), what comes down (pairing through the projection, `busy`, the anchor — nothing waits for it while it runs, once per count — Text only, the final text), failures (the 60-minute cap ending the run at its error) and stop:

```ts
/**
 * OpenAI Realtime's adapter: the conformance suite, the opening and its
 * refusals in words, the audio, the turns and typed text going up through
 * the queue, items to segments paired exactly, the drift anchor, failures
 * and stop. On `FakeSocket` and a virtual clock — no network, no fake
 * timers.
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
import { ANCHOR_EVERY, createRealtimeAdapter, ERROR_WORDS_MS, NEVER_OPENED, START_TIMEOUT_MS } from './adapter';
import type { RealtimeConfig } from './config';
import type { RealtimeCredentials } from './settings';
import { AUTO_CTX, configFor, exchange, KEY, liveRealtime, MANUAL_CTX, RefusingWebSocket, SERVER, startRealtime } from './testing';
import { anchorResponse, realtimeProtocols, realtimeUrl, sessionUpdate } from './wire';

/** A capture chunk: 2 048 samples of 24 kHz voice, 85.3 ms. */
const chunk = () => new Int16Array(2_048).fill(1_000);
/** What no frame, failure or refusal may carry: the key, and the subprotocol that holds it. */
const SECRETS = [KEY.apiKey, 'openai-insecure-api-key', 'realtimeKey'];

/** A response to a request the adapter asked for (`eventId`), for its input `previous`: created naming the request, its item after that input, one delta, done. */
function answer(n: number, eventId: string, previous: string, translation = `Answer ${n}.`): string[] {
  const resp = `resp_a${n}`;
  const out = `item_a${n}`;
  return [
    SERVER.responseCreated(resp, { request: eventId }),
    SERVER.outputItemAdded(resp, out),
    SERVER.itemAdded(out, 'assistant', previous),
    SERVER.transcriptDelta(resp, out, translation),
    SERVER.transcriptDone(resp, out, translation),
    SERVER.outputItemDone(resp, out),
    SERVER.responseDone(resp),
  ];
}

function harness(): AdapterHarness<RealtimeConfig, RealtimeCredentials> {
  let sockets = fakeSockets();
  const last = () => sockets.last();
  const reply = (...frames: string[]): ScenarioStep => ({ run: () => { for (const f of frames) last().receive(f); } });
  return {
    adapter: createRealtimeAdapter({ openSocket: (url, protocols) => sockets.create(url, protocols) }),
    config: (context) => { sockets = fakeSockets(); return configFor(context); },
    credentials: KEY,
    opening: () => [{ run: () => last().open('realtime') }, reply(SERVER.created(), SERVER.updated()), { flush: true }],
    exchange: [reply(...exchange(1))],
    serverClose: [{ run: () => last().serverClose(1011, 'Internal error') }, { flush: true }],
    refuse: [{ run: () => last().drop() }, { flush: true }],
    // The anchor took `sokuji_1`; the typed item is `sokuji_text_2`, its request `sokuji_3`.
    answerText: [reply(SERVER.itemAdded('sokuji_text_2', 'user'), ...answer(1, 'sokuji_3', 'sokuji_text_2'))],
  };
}

describe('the OpenAI Realtime adapter: conformance', () => {
  const h = harness();

  it('runs every scenario but reconnecting, which OpenAI Realtime does not do (ruling 14)', () => {
    expect(scenarioNames(h)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'text', 'server-close']);
  });

  it.each(scenarioNames(h))('%s', async (name) => {
    const report = await runScenario(h, name);
    expect(report.violations).toEqual([]);
    expect(report.problems).toEqual([]);
  });
});

describe('the OpenAI Realtime adapter: opening', () => {
  it('dials the GA endpoint with the model in its query and the key in a subprotocol, reads binary frames as ArrayBuffers, and sends nothing until the session exists (choice 7)', () => {
    const h = startRealtime();
    expect(h.socket().url).toBe(realtimeUrl(h.config));
    expect(h.socket().protocols).toEqual(realtimeProtocols(KEY));
    expect(h.socket().binaryType).toBe('arraybuffer');
    h.socket().open('realtime');
    expect(h.sent()).toEqual([]);
    expect(h.frames('session.opened')).toEqual([{ model: 'gpt-realtime-2.1-mini', modalities: ['audio'], voice: 'alloy', turnDetection: 'server_vad', manual: false }]);
  });

  it("configures the session once the server's session exists, framing what the server started with and what it was sent", () => {
    const h = startRealtime({ patch: { noiseReduction: 'Far field' } });
    h.socket().open('realtime');
    h.receive(SERVER.created());
    expect(h.sent()).toEqual([sessionUpdate(h.config)]);
    expect(h.frames('session.created')).toEqual([{ id: 'sess_1', model: 'gpt-realtime-2.1-mini', expiresAt: 1_790_000_000 }]);
    expect(h.frames('session.update')).toEqual([JSON.parse(JSON.stringify(sessionUpdate(h.config).session))]);
  });

  it('resolves only once the server confirms the configuration, over a websocket, emitting nothing but frames, with no timer left — and sends the first anchor (ruling 22; ruling 2)', async () => {
    const h = startRealtime();
    let resolved = false;
    void h.starting.then(() => { resolved = true; });
    h.socket().open('realtime');
    h.receive(SERVER.created());
    await flush();
    expect(resolved).toBe(false);
    h.receive(SERVER.updated());
    const session = await h.starting;
    expect(session.info).toEqual({ transport: 'websocket' });
    expect(h.frames('session.updated')).toEqual([{
      outputModalities: ['audio'], reasoning: { effort: 'low' }, maxOutputTokens: null,
      audio: { input: { noise_reduction: null, transcription: { model: 'gpt-4o-mini-transcribe', language: 'ja' }, turn_detection: { type: 'server_vad', threshold: 0.5 } }, output: { voice: 'alloy' } },
    }]);
    expect(h.sent()[1]).toEqual(anchorResponse('sokuji_1', h.config.instructions));
    expect(h.frames('response.anchor')).toEqual([{ eventId: 'sokuji_1', translations: 0 }]);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it.each([
    ['invalid_api_key', 'invalid_request_error', 'auth'],
    ['rate_limit_exceeded', 'invalid_request_error', 'rate_limit'],
    ['invalid_value', 'invalid_request_error', 'client'],
    [null, 'server_error', 'server'],
  ] as const)("an error (%s) before the configuration is confirmed rejects the start in OpenAI's words, as %s", async (code, type, expected) => {
    const h = startRealtime();
    h.socket().open('realtime');
    h.receive(SERVER.created(), SERVER.error({ type, code, message: 'The request was refused.' }));
    const error = await h.starting.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect(error).toMatchObject({ code: expected, message: `[OpenAI ${code ?? type}] The request was refused.` });
    expect(h.frames('session.error')).toEqual([{ type, code, message: 'The request was refused.', param: null, eventId: null }]);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a socket that fails before it opens rejects as the network, in words naming the network and the key — never the key itself (choice 6)', async () => {
    const h = startRealtime();
    h.socket().drop();
    await expect(h.starting).rejects.toMatchObject({ code: 'network', message: NEVER_OPENED });
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a close after the socket opened, before the start, rejects as the service\'s at once', async () => {
    const h = startRealtime();
    h.socket().open('realtime');
    h.socket().serverClose(1008, 'policy');
    await expect(h.starting).rejects.toMatchObject({ code: 'server', message: 'OpenAI closed the connection before the session started (1008 policy).' });
    expect(h.frames('session.connection_lost')).toEqual([{ code: 1008, reason: 'policy' }]);
  });

  it('bounds the start: no confirmation within 30 s rejects — network when the socket never opened, server when it did — and closes the socket (ruling 22)', async () => {
    const never = startRealtime();
    never.clock.advance(START_TIMEOUT_MS);
    await expect(never.starting).rejects.toMatchObject({ code: 'network', message: 'OpenAI did not open the connection within 30 s.' });
    expect(never.socket().closedByClient).not.toBeNull();
    expect(never.timers()).toBe(0);

    const silent = startRealtime();
    let settled = false;
    void silent.starting.catch(() => { settled = true; });
    silent.socket().open('realtime');
    silent.receive(SERVER.created());
    silent.clock.advance(START_TIMEOUT_MS - 1);
    await flush();
    expect(settled).toBe(false);
    silent.clock.advance(1);
    await expect(silent.starting).rejects.toMatchObject({ code: 'server', message: 'OpenAI did not start the session within 30 s.' });
    expect(silent.socket().closedByClient).not.toBeNull();
    expect(silent.timers()).toBe(0);
  });

  it('an abort while opening rejects with its reason, closes the socket and emits nothing; a start already aborted opens no socket', async () => {
    const h = startRealtime();
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
    const starting = createRealtimeAdapter({ openSocket: sockets.create }).start(
      { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    );
    await expect(starting).rejects.toBe(reason);
    expect(sockets.all).toEqual([]);
  });

  it('a browser that will not open the socket rejects the start in fixed words, never its own, which quote the key — injected or through the app\'s own seam (choice 7)', async () => {
    const openSocket = (_url: string, protocols: string[]): WebSocket => { throw new DOMException(`Failed to construct 'WebSocket': The subprotocol '${protocols[1]}' is invalid.`, 'SyntaxError'); };
    const run = async (adapter: ReturnType<typeof createRealtimeAdapter>) => {
      const { events, log } = recordEvents();
      const error = await adapter.start(
        { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: new AbortController().signal },
        events,
      ).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(AdapterStartError);
      expect(error).toMatchObject({ code: 'network', message: 'The browser would not open the socket (SyntaxError).' });
      expect((error as AdapterStartError).cause).toBeUndefined();
      for (const secret of SECRETS) expect((error as Error).message).not.toContain(secret);
      expect(log).toEqual([]);
    };
    await run(createRealtimeAdapter({ openSocket }));
    vi.stubGlobal('WebSocket', RefusingWebSocket);
    try {
      await run(createRealtimeAdapter());
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the OpenAI Realtime adapter: audio, turns and typed text going up', () => {
  it('sends each chunk as it came, one append each, and frames none of them (the hot-path rule)', async () => {
    const h = await liveRealtime();
    for (let i = 0; i < 3; i++) h.session.appendAudio(chunk());
    expect(h.appended().map((p) => [p.length, p[0]])).toEqual([[2_048, 1_000], [2_048, 1_000], [2_048, 1_000]]);
    expect(h.of('frame').filter((f) => f.payload.direction === 'out').map((f) => f.payload.type)).toEqual(['session.opened', 'session.update', 'response.anchor']);
  });

  it('under manual turns a release with speech commits the press and asks its response at once; one without speech clears the buffer; a press sends nothing (choice 12)', async () => {
    const h = await liveRealtime({ context: MANUAL_CTX });
    expect(h.sent()[0]).toMatchObject({ session: { audio: { input: { turn_detection: null } } } });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(h.said().slice(2)).toEqual([{ type: 'input_audio_buffer.commit' }, { type: 'response.create', event_id: 'sokuji_2', response: { metadata: { request: 'sokuji_2' } } }]);
    expect(h.frames('response.create')).toEqual([{ eventId: 'sokuji_2', for: 'turn', waitedMs: 0 }]);
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.cancelTurn();
    expect(h.said().slice(4)).toEqual([{ type: 'input_audio_buffer.clear' }]);
    expect(h.frames('input_audio_buffer.commit')).toHaveLength(1);
    expect(h.frames('input_audio_buffer.clear')).toHaveLength(1);
  });

  it('under automatic turns the turn keys send nothing', async () => {
    const h = await liveRealtime();
    h.session.beginTurn();
    h.session.endTurn();
    h.session.cancelTurn();
    expect(h.said().map((m) => m.type)).toEqual(['session.update', 'response.create']);
  });

  it("a release while a translation streams commits at once, and its response waits for that one's end: no request into an active response (ruling 8)", async () => {
    const h = await liveRealtime({ context: MANUAL_CTX });
    h.receive(SERVER.responseCreated('resp_1'));
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(h.said().slice(2).map((m) => m.type)).toEqual(['input_audio_buffer.commit']);
    expect(h.frames('response.queued')).toEqual([{ for: 'turn', waiting: 1 }]);
    h.clock.advance(1_200);
    h.receive(SERVER.responseDone('resp_1'));
    expect(h.said().slice(3)).toEqual([{ type: 'response.create', event_id: 'sokuji_2', response: { metadata: { request: 'sokuji_2' } } }]);
    expect(h.frames('response.create')).toEqual([{ eventId: 'sokuji_2', for: 'turn', waitedMs: 1_200 }]);
  });

  it('shows typed text at once as its own source, sends its item and asks its response; its translation pairs with it (ruling 8; choice 8)', async () => {
    const h = await liveRealtime();
    h.session.appendText('  Hello there  ');
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source', origin: 'sokuji_text_2' }]);
    expect(h.of('segmentText').map((e) => e.payload)).toEqual([{ ref: 1, text: 'Hello there' }]);
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }]);
    expect(h.said().slice(2)).toEqual([
      { type: 'conversation.item.create', item: { id: 'sokuji_text_2', type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello there' }] } },
      { type: 'response.create', event_id: 'sokuji_3', response: { metadata: { request: 'sokuji_3' } } },
    ]);
    expect(h.frames('conversation.item.create')).toEqual([{ itemId: 'sokuji_text_2', length: 11 }]);
    h.receive(SERVER.itemAdded('sokuji_text_2', 'user'), ...answer(1, 'sokuji_3', 'sokuji_text_2', 'こんにちは。'));
    expect(h.of('segmentOpened').map((e) => e.payload)[1]).toEqual({ ref: 2, side: 'translation', origin: 'sokuji_text_2' });
    // Blank text is nothing.
    h.session.appendText('   ');
    expect(h.said()).toHaveLength(4);
  });

  it('holds every typed text made while a response is in progress, each shown at once, and sends them first in first out, one per response: nothing is overwritten (ruling 8)', async () => {
    const h = await liveRealtime();
    h.receive(...exchange(1).slice(0, 5));
    h.session.appendText('first');
    h.session.appendText('second');
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['first', 'second']);
    expect(h.frames('response.queued')).toEqual([{ for: 'text', waiting: 1 }, { for: 'text', waiting: 2 }]);
    expect(h.said().filter((m) => m.type === 'conversation.item.create')).toEqual([]);
    h.receive(...exchange(1).slice(5));
    expect(h.said().filter((m) => m.type === 'conversation.item.create').map((m) => (m.item as { id: string }).id)).toEqual(['sokuji_text_2']);
    h.receive(SERVER.itemAdded('sokuji_text_2', 'user', 'item_out_1'), ...answer(1, 'sokuji_4', 'sokuji_text_2'));
    expect(h.said().filter((m) => m.type === 'conversation.item.create').map((m) => (m.item as { id: string }).id)).toEqual(['sokuji_text_2', 'sokuji_text_3']);
    expect(h.frames('response.create').map((f) => (f as { eventId: string }).eventId)).toEqual(['sokuji_4', 'sokuji_5']);
  });

  it("asks again, when that response ends, a request refused because the server's own response was active (choice 10)", async () => {
    const h = await liveRealtime();
    h.session.appendText('typed');
    // The server's detection answered first: its response is created, and ours refused, naming it.
    h.receive(SERVER.responseCreated('resp_vad'), SERVER.error({ code: 'conversation_already_has_active_response', message: 'Conversation already has an active response.', event_id: 'sokuji_3' }));
    expect(h.of('failed')).toEqual([]);
    expect(h.frames('response.create')).toHaveLength(1);
    h.receive(SERVER.responseDone('resp_vad'));
    expect(h.frames('response.create').map((f) => (f as { eventId: string }).eventId)).toEqual(['sokuji_3', 'sokuji_4']);
    // The item went up once; only its response is asked again.
    expect(h.said().filter((m) => m.type === 'conversation.item.create')).toHaveLength(1);
    // A routine refusal is not the words of a close that follows it (ruling 13): the drop reads as the lost connection.
    h.socket().serverClose(1006, '');
    await flush();
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to OpenAI closed (1006).' }]);
  });
});

describe('the OpenAI Realtime adapter: what comes down', () => {
  it('makes each input a source under its item id, streaming its transcript, and each translation a segment paired with the input it follows (rulings 11; choice 8)', async () => {
    const h = await liveRealtime();
    h.receive(SERVER.committed('item_in_1'), SERVER.itemAdded('item_in_1', 'user'), SERVER.inputDelta('item_in_1', 'こんにち'), SERVER.inputDelta('item_in_1', 'は'));
    h.receive(SERVER.responseCreated('resp_1'), SERVER.outputItemAdded('resp_1', 'item_out_1'), SERVER.itemAdded('item_out_1', 'assistant', 'item_in_1'));
    h.receive(SERVER.transcriptDelta('resp_1', 'item_out_1', 'Hello'), SERVER.audio('resp_1', 'item_out_1'), SERVER.transcriptDelta('resp_1', 'item_out_1', ' there.'), SERVER.audio('resp_1', 'item_out_1'));
    h.receive(SERVER.inputDone('item_in_1', 'こんにちは。'), SERVER.transcriptDone('resp_1', 'item_out_1', 'Hello there.'), SERVER.outputItemDone('resp_1', 'item_out_1'), SERVER.responseDone('resp_1'));
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source', origin: 'item_in_1' }, { ref: 2, side: 'translation', origin: 'item_in_1' }]);
    expect(h.of('segmentText').map((e) => e.payload)).toEqual([
      { ref: 1, text: 'こんにち' }, { ref: 1, text: 'こんにちは' }, { ref: 2, text: 'Hello' }, { ref: 2, text: 'Hello there.' }, { ref: 1, text: 'こんにちは。' },
    ]);
    expect(h.of('audio').map((e) => [e.payload.ref, e.payload.range, e.payload.pcm.length])).toEqual([[2, [0, 5], 2_400], [2, [5, 12], 2_400]]);
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(h.frames('response.output_audio.delta')).toEqual([{ responseId: 'resp_1', itemId: 'item_out_1', samples: 2_400 }, { responseId: 'resp_1', itemId: 'item_out_1', samples: 2_400 }]);
    expect(h.frames('response.done')).toEqual([{ responseId: 'resp_1', status: 'completed', statusDetails: null, outOfBand: false, usage: expect.objectContaining({ total_tokens: 1_200 }) }]);
  });

  it('pairs each exchange as stated through the projection; an utterance spoken over a playing translation that no response answers stays a row of its own (choice 8)', async () => {
    const h = await liveRealtime();
    const conv = new Conversation({ leg: 'speaker', session: 'realtime', languages: AUTO_CTX.direction, clock: h.clock });
    let folded = 0;
    const fold = () => {
      for (const e of h.log.slice(folded)) if (e.kind !== 'frame') conv.apply(e);
      folded = h.log.length;
    };
    const first = exchange(1, { source: '一つ目。', translation: 'The first.' });
    h.receive(...first.slice(0, 9));
    fold();
    // Spoken while the first translation plays: committed and transcribed, never answered.
    h.receive(SERVER.committed('item_in_x', 'item_out_1'), SERVER.inputDone('item_in_x', '聞き逃し。'));
    fold();
    h.receive(...first.slice(9));
    fold();
    h.clock.advance(1_000);
    h.receive(...exchange(2, { source: '二つ目。', translation: 'The second.', previous: 'item_in_x' }));
    fold();
    const entries = createProjector().project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'off', sentencesPerRow: 0 });
    const exchanges = entries.filter((e) => e.kind === 'exchange');
    const text = (rows: ReadonlyArray<{ text: string }>) => rows.map((r) => r.text).join('');
    const read = exchanges.map((e) => (e.kind === 'exchange' ? [e.pairing, text(e.source), text(e.translation)] : null));
    expect(read).toEqual([
      ['stated', '一つ目。', 'The first.'],
      ['stated', '聞き逃し。', ''],
      ['stated', '二つ目。', 'The second.'],
    ]);
  });

  it("is busy while an in-band response is in progress, and not for the anchor's (choice 10)", async () => {
    const h = await liveRealtime();
    h.receive(SERVER.responseCreated('resp_anchor', { outOfBand: true }), SERVER.responseDone('resp_anchor', { outOfBand: true }));
    expect(h.of('busy')).toEqual([]);
    h.receive(...exchange(1));
    expect(h.of('busy').map((e) => e.payload)).toEqual([true, false]);
  });

  it("re-sends the instructions out of band after every fifth completed translation, once per count — a failed or cancelled response does not count — and its response makes no segment (ruling 2; choice 11)", async () => {
    const h = await liveRealtime();
    expect(ANCHOR_EVERY).toBe(5);
    for (let n = 1; n <= 4; n++) h.receive(...exchange(n));
    h.receive(SERVER.responseCreated('resp_x'), SERVER.responseDone('resp_x', { status: 'cancelled' }));
    expect(h.frames('response.anchor')).toHaveLength(1);
    h.receive(...exchange(5));
    expect(h.frames('response.anchor')).toEqual([{ eventId: 'sokuji_1', translations: 0 }, { eventId: 'sokuji_2', translations: 5 }]);
    const creates = h.said().filter((m) => m.type === 'response.create');
    expect(creates[creates.length - 1]).toEqual(anchorResponse('sokuji_2', h.config.instructions));
    // The anchor's own response: framed with its cost, no segment, no busy; nothing waits for it, even while it runs (ruling 2).
    const before = h.content().length;
    h.receive(
      SERVER.responseCreated('resp_anchor', { outOfBand: true }), SERVER.outputItemAdded('resp_anchor', 'item_anchor'),
      SERVER.textDelta('resp_anchor', 'item_anchor', 'Understood.'), SERVER.textDone('resp_anchor', 'item_anchor', 'Understood.'),
    );
    h.session.appendText('typed');
    expect(h.frames('response.queued')).toEqual([]);
    expect(h.frames('response.create').map((f) => (f as { eventId: string }).eventId)).toEqual(['sokuji_4']);
    h.receive(SERVER.responseDone('resp_anchor', { outOfBand: true }));
    // The typed text's own source is all that was added: the anchor made no segment and said no busy.
    expect(h.content().slice(before).map((e) => e.kind)).toEqual(['segmentOpened', 'segmentText', 'segmentClosed']);
    const dones = h.frames('response.done');
    expect(dones[dones.length - 1]).toMatchObject({ responseId: 'resp_anchor', outOfBand: true, usage: { total_tokens: 1_200 } });
    // Once per count: a response that ends short of completed while the count is five sends no second anchor.
    h.receive(SERVER.responseCreated('resp_y', { request: 'sokuji_4' }), SERVER.responseDone('resp_y', { status: 'cancelled' }));
    expect(h.frames('response.anchor')).toHaveLength(2);
    for (let n = 6; n <= 9; n++) h.receive(...exchange(n));
    expect(h.frames('response.anchor')).toHaveLength(2);
  });

  it('asks text alone of a leg that does not speak, plays no audio it gets anyway, and makes the text its translation', async () => {
    const h = await liveRealtime({ context: { ...AUTO_CTX, speech: false } });
    expect(h.sent()[0]).toMatchObject({ session: { output_modalities: ['text'] } });
    h.receive(SERVER.committed('item_in_1'), SERVER.responseCreated('resp_1'), SERVER.outputItemAdded('resp_1', 'item_out_1'), SERVER.itemAdded('item_out_1', 'assistant', 'item_in_1'));
    h.receive(SERVER.textDelta('resp_1', 'item_out_1', '{"final_text": "Hi.'), SERVER.audio('resp_1', 'item_out_1'), SERVER.textDelta('resp_1', 'item_out_1', '"}'), SERVER.textDone('resp_1', 'item_out_1', '{"final_text": "Hi."}'));
    expect(h.of('audio')).toEqual([]);
    expect(h.of('segmentText').map((e) => e.payload)).toEqual([{ ref: 2, text: '{"final_text": "Hi.' }, { ref: 2, text: '{"final_text": "Hi."}' }, { ref: 2, text: 'Hi.' }]);
  });

  it("settles a translation's final text unwrapped and trimmed, stating its ranges again within it (choice 9)", async () => {
    const h = await liveRealtime();
    h.receive(SERVER.responseCreated('resp_1'), SERVER.outputItemAdded('resp_1', 'item_out_1'), SERVER.itemAdded('item_out_1', 'assistant', null));
    h.receive(SERVER.transcriptDelta('resp_1', 'item_out_1', 'Hello. \n'), SERVER.audio('resp_1', 'item_out_1'), SERVER.transcriptDone('resp_1', 'item_out_1', 'Hello. \n'));
    expect(h.of('speechRanges').map((e) => e.payload)).toEqual([{ ref: 1, ranges: [{ index: 0, range: [0, 6] }] }]);
  });

  it("closes a failed response's translation and frames why; frames what it does not act on under its own name, and anything else as unknown", async () => {
    const h = await liveRealtime();
    h.receive(SERVER.responseCreated('resp_1'), SERVER.transcriptDelta('resp_1', 'item_out_1', 'Half'));
    h.receive(SERVER.responseDone('resp_1', { status: 'failed', statusDetails: { type: 'failed', error: { type: 'server_error', code: 'internal' } } }));
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }]);
    expect(h.frames('response.done')[0]).toMatchObject({ status: 'failed', statusDetails: { type: 'failed', error: { type: 'server_error', code: 'internal' } } });
    expect(h.of('failed')).toEqual([]);
    h.receive(SERVER.bare('response.content_part.added'), SERVER.bare('conversation.item.done'), SERVER.rateLimits(), SERVER.bare('output_audio_buffer.started'));
    expect(h.frames('response.content_part.added')).toHaveLength(1);
    expect(h.frames('conversation.item.done')).toHaveLength(1);
    expect(h.frames('rate_limits.updated')).toEqual([{ rateLimits: [{ name: 'tokens', limit: 40_000, remaining: 39_000, reset_seconds: 1.5 }] }]);
    expect(h.frames('session.unknown')).toEqual([{ type: 'output_audio_buffer.started' }]);
  });
});

describe('the OpenAI Realtime adapter: failures and stop', () => {
  it('frames a mid-session error and runs on (ruling 13); a close soon after it is worded as that error, a later one as the lost connection (choice 14)', async () => {
    const keyed = await liveRealtime();
    keyed.receive(SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
    expect(keyed.frames('session.error')).toEqual([{ type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key provided.', param: null, eventId: null }]);
    expect(keyed.of('failed')).toEqual([]);
    keyed.receive(SERVER.committed('item_in_1'));
    expect(keyed.of('segmentOpened')).toHaveLength(1);
    keyed.socket().serverClose(1008, '');
    await flush();
    expect(keyed.of('failed').map((e) => e.payload)).toEqual([{ code: 'auth', message: '[OpenAI invalid_api_key] Incorrect API key provided.' }]);
    expect(keyed.of('degraded')).toEqual([]);

    const stale = await liveRealtime();
    stale.receive(SERVER.error({ code: 'rate_limit_exceeded', message: 'Rate limit reached.' }));
    stale.clock.advance(ERROR_WORDS_MS + 1);
    stale.socket().serverClose(1006, '');
    await flush();
    expect(stale.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to OpenAI closed (1006).' }]);
  });

  it("ends the run at the 60-minute cap's error itself, in its words, whether or not a close follows (ruling 14; choice 14)", async () => {
    const h = await liveRealtime();
    h.receive(SERVER.error({ code: 'session_expired', message: 'Your session hit the maximum duration of 60 minutes.' }));
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'segment_ended', message: '[OpenAI session_expired] Your session hit the maximum duration of 60 minutes.' }]);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);
    // A close that follows changes nothing: the run has ended.
    h.socket().serverClose(1000, '');
    await flush();
    expect(h.of('failed')).toHaveLength(1);
  });

  it('a wall clock stepped backwards after a mid-session error does not revive its words for a later close (ruling 13)', async () => {
    const h = await liveRealtime();
    h.receive(SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
    const realNow = h.clock.now;
    h.clock.now = () => realNow() - 3_600_000;
    h.socket().serverClose(1006, '');
    await flush();
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to OpenAI closed (1006).' }]);
  });

  it('an unexpected close fails with connection_lost, once, and nothing reconnects; a socket error alone is a Logs line (ruling 14)', async () => {
    const h = await liveRealtime();
    h.socket().onerror?.call(h.socket(), new Event('error'));
    expect(h.frames('session.socket_error')).toHaveLength(1);
    expect(h.of('failed')).toEqual([]);
    h.socket().serverClose(1011, 'Internal error');
    await flush();
    expect(h.frames('session.connection_lost')).toEqual([{ code: 1011, reason: 'Internal error' }]);
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to OpenAI closed (1011 Internal error).' }]);
    expect(h.sockets.all).toHaveLength(1);
    expect(h.timers()).toBe(0);
  });

  it('a frame that will not read is said once per episode, in the Logs and as parse_error; an audio delta that will not decode, or carries no base64, is its own episode (choice 15)', async () => {
    const h = await liveRealtime();
    h.receive('not a frame', '{"no":"type"}', SERVER.committed('item_in_1'), 'again');
    h.receive(JSON.stringify({ type: 'response.output_audio.delta', response_id: 'resp_1', item_id: 'item_out_1', delta: '!!not base64!!' }));
    h.receive(JSON.stringify({ type: 'response.output_audio.delta', response_id: 'resp_1', item_id: 'item_out_1' }));
    expect(h.frames('session.unreadable')).toEqual([{ message: expect.any(String) }, { message: expect.any(String) }, { message: expect.any(String) }]);
    expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['parse_error', 'parse_error', 'parse_error']);
    h.receive(SERVER.audio('resp_1', 'item_out_1'), JSON.stringify({ type: 'response.output_audio.delta', response_id: 'resp_1', item_id: 'item_out_1', delta: 42 }));
    expect(h.frames('session.unreadable')).toHaveLength(4);
  });

  it('never frames, fails or degrades with the key or the subprotocol that carries it', async () => {
    const h = await liveRealtime({ context: MANUAL_CTX });
    h.receive(...exchange(1));
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.session.appendText('typed');
    h.receive('not a frame', SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
    h.socket().onerror?.call(h.socket(), new Event('error'));
    h.socket().serverClose(1008, '');
    await flush();
    const types = new Set(h.of('frame').map((f) => f.payload.type));
    for (const type of ['session.opened', 'session.created', 'session.update', 'session.updated', 'response.anchor', 'input_audio_buffer.committed', 'conversation.item.added',
      'conversation.item.input_audio_transcription.completed', 'response.created', 'response.output_audio_transcript.delta', 'response.output_audio.delta', 'response.done',
      'input_audio_buffer.commit', 'response.create', 'response.queued', 'session.unreadable', 'session.error', 'session.socket_error', 'session.connection_lost']) {
      expect(types).toContain(type);
    }
    expect(h.of('failed')).toHaveLength(1);
    const everything = JSON.stringify(h.log.filter((e) => e.kind !== 'audio'));
    for (const secret of SECRETS) expect(everything).not.toContain(secret);
  });

  it('stop closes the socket before it returns; nothing waits, goes up or follows, and no timer or listener is left', async () => {
    const h = startRealtime({ context: MANUAL_CTX });
    const removed = vi.spyOn(h.controller.signal, 'removeEventListener');
    h.socket().open('realtime');
    h.receive(SERVER.created(), SERVER.updated());
    const session = await h.starting;
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    h.receive(SERVER.responseCreated('resp_1'));
    session.appendText('waiting');
    const n = h.log.length;
    const sentBefore = h.sent().length;
    const socket = h.socket();
    const stopping = session.stop();
    expect(socket.closedByClient).toEqual({ code: 1000, reason: undefined });
    await stopping;
    expect([socket.onopen, socket.onmessage, socket.onerror, socket.onclose]).toEqual([null, null, null, null]);
    h.clock.advance(10_000);
    await flush();
    session.appendAudio(chunk());
    session.appendText('late');
    session.endTurn();
    expect(h.log.length).toBe(n);
    expect(h.sent()).toHaveLength(sentBefore);
    expect(h.timers()).toBe(0);
  });
});
```

- [ ] **Step 3: Pin the session side.** In `src/providers/sessionSide.consistency.test.ts`, inside the case that walks each adapter's value imports:

```diff
--- a/src/providers/sessionSide.consistency.test.ts
+++ b/src/providers/sessionSide.consistency.test.ts
@@ -244,6 +244,15 @@
     for (const file of ['TranslateSettings.tsx', 'check.ts', 'config.ts', 'provider.ts', 'settings.ts', 'testing.ts']) {
       expect(translate).not.toContain(`src/providers/openai_translate/${file}`);
     }
+
+    const realtime = sessionSide(REPO_ROOT, 'src/providers/openai');
+    expect(realtime).toEqual([
+      'src/providers/openai/adapter.ts',
+      'src/providers/openai/items.ts',
+      'src/providers/openai/queue.ts',
+      'src/providers/openai/socket.ts',
+      'src/providers/openai/wire.ts',
+    ]);
   });
 
   it('reads imports the way the compiler does', () => {
```

- [ ] **Step 4: Run them to see them fail.**

Run: `npx vitest run src/providers/openai/adapter.test.ts src/providers/sessionSide.consistency.test.ts`
Expected: FAIL — `adapter.test.ts` at collection, `(0 test)`: `TypeError: createRealtimeAdapter is not a function` at the conformance block's `harness` (the seed exports nothing); and 1 test, the session-side walk: expected the five files, received `['src/providers/openai/adapter.ts']`.

- [ ] **Step 5: Write the adapter.** Replace `src/providers/openai/adapter.ts` in full:

```ts
/**
 * OpenAI Realtime on the new contract (spec: "L0 — the client contract"),
 * ported from `OpenAIGAClient` (`src/services/clients/`, still compiled
 * until the deletion plan) without its items, its segmentation stage or the
 * old MainPanel's orchestration: one leg, one WebSocket to the GA endpoint,
 * the key in a subprotocol (choice 7). The start resolves on
 * `session.updated`, the configuration confirmed, so a refused one rejects
 * in words within a bound (ruling 22; choice 6). Items become segments,
 * paired by the input each translation follows (`items.ts`, choice 8);
 * in-band responses go up one at a time (`queue.ts`, ruling 8); the drift
 * anchor re-sends the instructions out of band (ruling 2). Every timer
 * reads the request's clock, and nothing is said but through events
 * (CLAUDE.md, "Inside an IClient session").
 */
import type {
  ConversationItemAdded,
  ConversationItemInputAudioTranscriptionCompletedEvent,
  ConversationItemInputAudioTranscriptionDeltaEvent,
  ConversationItemInputAudioTranscriptionFailedEvent,
  InputAudioBufferCommittedEvent,
  InputAudioBufferSpeechStartedEvent,
  InputAudioBufferSpeechStoppedEvent,
  RateLimitsUpdatedEvent,
  RealtimeError,
  RealtimeErrorEvent,
  ResponseAudioDeltaEvent,
  ResponseAudioDoneEvent,
  ResponseAudioTranscriptDeltaEvent,
  ResponseAudioTranscriptDoneEvent,
  ResponseCreatedEvent,
  ResponseDoneEvent,
  ResponseOutputItemAddedEvent,
  ResponseOutputItemDoneEvent,
  ResponseTextDeltaEvent,
  ResponseTextDoneEvent,
  SessionCreatedEvent,
  SessionUpdatedEvent,
} from 'openai/resources/realtime/realtime';
import {
  AdapterStartError,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type StartRequest,
} from '../../lib/contract/adapter';
import { framePayload } from '../../lib/contract/framePayload';
import { base64ToPcm } from '../../lib/contract/pcm64';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { RealtimeConfig } from './config';
import { RealtimeItems } from './items';
import { ACTIVE_RESPONSE, ResponseQueue, type Request } from './queue';
import type { RealtimeCredentials } from './settings';
import { nativeSocket, WS_OPEN, type OpenSocket } from './socket';
import {
  anchorResponse,
  appendFrame,
  CLEAR,
  COMMIT,
  decodeServerEvent,
  errorCode,
  errorWords,
  isOutOfBand,
  realtimeProtocols,
  realtimeUrl,
  requestOf,
  responseCreate,
  sessionUpdate,
  textItem,
  unwrapTranslationText,
  type ServerEvent,
} from './wire';

/** The old client's bound on the start (`OpenAIGAClient.ts:185-228`), now on the request's clock, and closing the socket (choice 6). */
export const START_TIMEOUT_MS = 30_000;
/** A socket that failed before it opened: a browser cannot read why (choice 6). */
export const NEVER_OPENED = "OpenAI's socket did not open (check the network, and that the API key is still valid).";
/**
 * How long a mid-session `error` words the close that follows it (ruling
 * 13; choice 14): a close later than this is the connection's own. OpenAI
 * Translate's starting value, which its live test and this one's settle.
 */
export const ERROR_WORDS_MS = 10_000;
/** The drift anchor's interval (ruling 2): at the start, then after every fifth completed translation (`MainPanel.tsx:4245-4325` before `aecaae2b`). */
export const ANCHOR_EVERY = 5;

/** Known events with nothing to act on: a Logs line under their own name (choice 13). */
const QUIET = new Set([
  'conversation.item.done', 'conversation.item.deleted', 'conversation.item.truncated', 'conversation.item.input_audio_transcription.segment',
  'input_audio_buffer.timeout_triggered', 'response.content_part.added', 'response.content_part.done',
]);

export interface RealtimeAdapterDeps {
  /** `new WebSocket(url, protocols)` in the app; a `FakeSocket` factory in tests. */
  openSocket: OpenSocket;
}

const closeWords = (e: CloseEvent) => `${e.code}${e.reason ? ` ${e.reason}` : ''}`;

/** A thrown value's name alone (`SyntaxError`, `SecurityError`), never its message: a browser that refuses a subprotocol quotes it, the key in it. */
function errorName(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name !== '' ? name : 'unknown error';
}

/** A conversation item's id and role, whatever kind of item it is. */
function itemOf(item: unknown): { id: string | undefined; role: string | undefined } {
  const i = (item ?? {}) as { id?: unknown; role?: unknown };
  return { id: typeof i.id === 'string' ? i.id : undefined, role: typeof i.role === 'string' ? i.role : undefined };
}

class RealtimeLeg implements AdapterSession {
  readonly info: { transport: string };
  readonly opening: Promise<AdapterSession>;
  /** `opening` until the server's session exists; `configuring` once `session.update` went out; `live` once the server confirmed it. */
  private phase: 'opening' | 'configuring' | 'live' | 'ended' = 'opening';
  private opened = false;
  private readonly socket: WebSocket;
  private readonly items: RealtimeItems;
  private readonly queue: ResponseQueue;
  /** The client's own ids, one counter: request event ids (`sokuji_<n>`) and typed items' (`sokuji_text_<n>`, under the API's 32 characters). */
  private ids = 0;
  /** Typed items already sent: a request asked again sends its `response.create` alone (choice 10). */
  private readonly itemsSent = new Set<string>();
  /** An in-band response is in progress: `busy` said (choice 10). */
  private producing = false;
  /** In-band responses that ended `completed`: what the anchor counts (ruling 2; choice 11). */
  private completed = 0;
  /** The count the last anchor went up at; -1 before the first. */
  private anchoredAt = -1;
  /** The last frame parsed: `session.unreadable` on the ok → failing transition only (choice 15). */
  private readable = true;
  /** The last output audio decoded: its own episode, since every frame that parses re-arms `readable`. */
  private audioReadable = true;
  /** The last `error` event mid-session, and when: the words of a close that follows it closely (ruling 13; choice 14). */
  private lastError: { code: string; message: string; at: number } | null = null;
  private settle: { resolve(): void; reject(error: unknown): void } | null = null;

  constructor(
    private readonly request: StartRequest<RealtimeConfig, RealtimeCredentials>,
    private readonly events: AdapterEvents,
    openSocket: OpenSocket,
  ) {
    const { config, clock, signal } = request;
    // The WebRTC step's attachment point (choice 18): today every config says `websocket`.
    this.info = { transport: config.transport };
    this.items = new RealtimeItems(events);
    this.queue = new ResponseQueue({
      clock,
      eventId: () => `sokuji_${++this.ids}`,
      sink: {
        send: (asked, eventId, waitedMs) => this.ask(asked, eventId, waitedMs),
        queued: (asked, waiting) => this.frame('out', 'response.queued', { for: asked.kind, waiting }),
      },
    });
    this.socket = openSocket(realtimeUrl(config), realtimeProtocols(request.credentials));
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

  /** One chunk as it came — no pacing, no resampling — and no frame per chunk (the hot-path rule). */
  appendAudio(pcm: Int16Array): void {
    if (this.phase !== 'live') return;
    this.send(appendFrame(pcm));
  }

  /**
   * Typed text (ruling 8): trimmed, shown at once as its own source, and
   * sent — or held first in first out while a response is in progress.
   * Dropped while the session is not live.
   */
  appendText(text: string): void {
    const trimmed = text.trim();
    if (this.phase !== 'live' || !trimmed) return;
    const itemId = `sokuji_text_${++this.ids}`;
    this.items.typed(itemId, trimmed);
    this.queue.push({ kind: 'text', itemId, text: trimmed });
  }

  /** Nothing to send at a press over WebSocket: the buffer takes what is appended. */
  beginTurn(): void {}

  /** A release with speech, under manual turns: what was appended becomes an input item now, and its response goes up when none is in progress (ruling 8; choice 12). */
  endTurn(): void {
    if (this.phase !== 'live' || this.request.context.turns !== 'manual') return;
    this.send(JSON.stringify(COMMIT));
    this.frame('out', 'input_audio_buffer.commit');
    this.queue.push({ kind: 'turn' });
  }

  /** A release without speech: the press's audio is cleared, never left to join the next turn (spec, "Defects removed by construction"; choice 12). */
  cancelTurn(): void {
    if (this.phase !== 'live' || this.request.context.turns !== 'manual') return;
    this.send(JSON.stringify(CLEAR));
    this.frame('out', 'input_audio_buffer.clear');
  }

  /** The close before its first `await`; nothing is sent to end the session first. */
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
      model: config.model, modalities: config.modalities, voice: config.voice ?? null, turnDetection: config.turnDetection?.type ?? null, manual: context.turns === 'manual',
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
      case 'session.created': return this.created(e as unknown as SessionCreatedEvent);
      case 'session.updated': return this.updated(e as unknown as SessionUpdatedEvent);
      case 'error': return this.serverError((e as unknown as Partial<RealtimeErrorEvent>).error ?? {});
      case 'input_audio_buffer.committed': return this.committed(e as unknown as InputAudioBufferCommittedEvent);
      case 'input_audio_buffer.speech_started': {
        const s = e as unknown as InputAudioBufferSpeechStartedEvent;
        return this.frame('in', e.type, { itemId: s.item_id ?? null, audioStartMs: s.audio_start_ms ?? null });
      }
      case 'input_audio_buffer.speech_stopped': {
        const s = e as unknown as InputAudioBufferSpeechStoppedEvent;
        return this.frame('in', e.type, { itemId: s.item_id ?? null, audioEndMs: s.audio_end_ms ?? null });
      }
      case 'input_audio_buffer.cleared': return this.frame('in', e.type);
      case 'conversation.item.added': return this.itemAdded(e as unknown as ConversationItemAdded);
      case 'conversation.item.input_audio_transcription.delta': return this.inputDelta(e as unknown as ConversationItemInputAudioTranscriptionDeltaEvent);
      case 'conversation.item.input_audio_transcription.completed': return this.inputDone(e as unknown as ConversationItemInputAudioTranscriptionCompletedEvent);
      case 'conversation.item.input_audio_transcription.failed': return this.inputFailed(e as unknown as ConversationItemInputAudioTranscriptionFailedEvent);
      case 'response.created': return this.responseCreated(e as unknown as ResponseCreatedEvent);
      case 'response.output_item.added': return this.outputAdded(e as unknown as ResponseOutputItemAddedEvent);
      case 'response.output_audio_transcript.delta':
      case 'response.output_text.delta': return this.outputDelta(e as unknown as ResponseAudioTranscriptDeltaEvent | ResponseTextDeltaEvent);
      case 'response.output_audio_transcript.done': {
        const d = e as unknown as ResponseAudioTranscriptDoneEvent;
        return this.outputDone(d, d.transcript);
      }
      case 'response.output_text.done': {
        const d = e as unknown as ResponseTextDoneEvent;
        return this.outputDone(d, d.text);
      }
      case 'response.output_audio.delta': return this.audioDelta(e as unknown as ResponseAudioDeltaEvent);
      case 'response.output_audio.done': {
        const d = e as unknown as ResponseAudioDoneEvent;
        return this.frame('in', e.type, { responseId: d.response_id ?? null, itemId: d.item_id ?? null });
      }
      case 'response.output_item.done': return this.outputItemDone(e as unknown as ResponseOutputItemDoneEvent);
      case 'response.done': return this.responseDone(e as unknown as ResponseDoneEvent);
      case 'rate_limits.updated': return this.frame('in', e.type, { rateLimits: (e as unknown as RateLimitsUpdatedEvent).rate_limits ?? null });
      default:
        if (QUIET.has(e.type)) this.frame('in', e.type);
        else this.frame('in', 'session.unknown', { type: e.type });
    }
  }

  /** The server's session: framed with its defaults and its expiry, then the configuration goes up (ruling 22). */
  private created(e: SessionCreatedEvent): void {
    const s = (e.session ?? {}) as { id?: unknown; model?: unknown; expires_at?: unknown };
    this.frame('in', 'session.created', { id: s.id ?? null, model: s.model ?? null, expiresAt: s.expires_at ?? null });
    if (this.phase !== 'opening') return;
    const update = sessionUpdate(this.request.config);
    this.send(JSON.stringify(update));
    this.frame('out', 'session.update', update.session);
    this.phase = 'configuring';
  }

  /** The configuration confirmed: the start resolves (ruling 22), and the first anchor goes up (ruling 2). */
  private updated(e: SessionUpdatedEvent): void {
    const s = (e.session ?? {}) as { output_modalities?: unknown; audio?: unknown; reasoning?: unknown; max_output_tokens?: unknown };
    // What the server confirmed, for the live test's reading of the hints (survey §2.16 item 3); never the instructions, which the out frame carries.
    this.frame('in', 'session.updated', { outputModalities: s.output_modalities ?? null, audio: s.audio ?? null, reasoning: s.reasoning ?? null, maxOutputTokens: s.max_output_tokens ?? null });
    if (this.phase !== 'configuring') return;
    this.phase = 'live';
    const settle = this.settle;
    this.settle = null;
    settle?.resolve();
    this.anchor();
  }

  /** Before the start, a refusal in OpenAI's words; mid-session a Logs line, kept for the close that may follow (ruling 13), and perhaps the refusal of a request asked (choice 10) — or, the 60-minute cap, the run's end. */
  private serverError(error: Partial<RealtimeError>): void {
    this.frame('in', 'session.error', { type: error.type ?? null, code: error.code ?? null, message: error.message ?? null, param: error.param ?? null, eventId: error.event_id ?? null });
    const refusal = { code: errorCode(error), message: errorWords(error) };
    if (this.phase !== 'live') {
      this.refuse(new AdapterStartError(refusal.message, refusal.code));
      return;
    }
    // The 60-minute cap ends the run at once, in its words, whether or not the server closes the socket after it (ruling 14; choice 14).
    if (refusal.code === 'segment_ended') {
      this.end({ failed: refusal });
      return;
    }
    // A request refused because a response was active is asked again (choice 10): routine, never the words of a close that follows (ruling 13).
    if (error.code !== ACTIVE_RESPONSE) this.lastError = { ...refusal, at: this.request.clock.now() };
    this.queue.refused(error.event_id, error.code);
  }

  private committed(e: InputAudioBufferCommittedEvent): void {
    this.frame('in', e.type, { itemId: e.item_id ?? null, previousItemId: e.previous_item_id ?? null });
    if (this.phase === 'live' && typeof e.item_id === 'string') this.items.committed(e.item_id);
  }

  private itemAdded(e: ConversationItemAdded): void {
    const { id, role } = itemOf(e.item);
    this.frame('in', e.type, { itemId: id ?? null, role: role ?? null, previousItemId: e.previous_item_id ?? null });
    if (this.phase !== 'live' || id === undefined) return;
    if (role === 'user') this.items.inputAdded(id);
    else if (role === 'assistant') this.items.assistantAdded(id, e.previous_item_id);
  }

  private inputDelta(e: ConversationItemInputAudioTranscriptionDeltaEvent): void {
    this.frame('in', e.type, { itemId: e.item_id ?? null, delta: e.delta ?? null });
    if (this.phase === 'live' && typeof e.item_id === 'string' && typeof e.delta === 'string') this.items.inputDelta(e.item_id, e.delta);
  }

  private inputDone(e: ConversationItemInputAudioTranscriptionCompletedEvent): void {
    this.frame('in', e.type, { itemId: e.item_id ?? null, transcript: e.transcript ?? null });
    if (this.phase === 'live' && typeof e.item_id === 'string') this.items.inputDone(e.item_id, typeof e.transcript === 'string' ? e.transcript : '');
  }

  private inputFailed(e: ConversationItemInputAudioTranscriptionFailedEvent): void {
    const error = e.error ?? {};
    this.frame('in', e.type, { itemId: e.item_id ?? null, error: { type: error.type ?? null, code: error.code ?? null, message: error.message ?? null } });
    if (this.phase === 'live' && typeof e.item_id === 'string') this.items.inputFailed(e.item_id);
  }

  /** A response began: in band it is `busy`, and the queue's; out of band — the anchor's — neither (ruling 2). */
  private responseCreated(e: ResponseCreatedEvent): void {
    const id = e.response?.id;
    const outOfBand = isOutOfBand(e.response);
    this.frame('in', e.type, { responseId: id ?? null, outOfBand });
    if (this.phase !== 'live' || typeof id !== 'string') return;
    this.items.responseCreated(id, outOfBand);
    if (outOfBand) return;
    this.queue.created(id, requestOf(e.response));
    if (!this.producing) {
      this.producing = true;
      this.events.busy(true);
    }
  }

  private outputAdded(e: ResponseOutputItemAddedEvent): void {
    const { id, role } = itemOf(e.item);
    this.frame('in', e.type, { responseId: e.response_id ?? null, itemId: id ?? null, role: role ?? null });
    if (this.phase === 'live' && id !== undefined && typeof e.response_id === 'string') this.items.outputAdded(id, e.response_id);
  }

  private outputDelta(e: ResponseAudioTranscriptDeltaEvent | ResponseTextDeltaEvent): void {
    this.frame('in', e.type, { responseId: e.response_id ?? null, itemId: e.item_id ?? null, delta: e.delta ?? null });
    if (this.phase === 'live' && typeof e.item_id === 'string' && typeof e.response_id === 'string' && typeof e.delta === 'string') {
      this.items.outputDelta(e.item_id, e.response_id, e.delta);
    }
  }

  /** The final text, trimmed and unwrapped (choice 5): it settles the translation. */
  private outputDone(e: ResponseAudioTranscriptDoneEvent | ResponseTextDoneEvent, text: unknown): void {
    this.frame('in', e.type, { responseId: e.response_id ?? null, itemId: e.item_id ?? null, text: text ?? null });
    if (this.phase === 'live' && typeof e.item_id === 'string' && typeof e.response_id === 'string' && typeof text === 'string') {
      this.items.outputDone(e.item_id, e.response_id, unwrapTranslationText(text));
    }
  }

  /** Output audio: framed by its size, never its content; played on a leg that speaks, ranged by arrival (ruling 3). */
  private audioDelta(e: ResponseAudioDeltaEvent): void {
    if (this.phase !== 'live') return;
    // No base64 string where the audio should be: the same episode as audio that will not decode (choice 15), in fixed words that quote nothing of the frame.
    if (typeof e.delta !== 'string') {
      this.unreadable('audio', new Error('an audio delta with no base64 string'));
      return;
    }
    let pcm: Int16Array;
    try {
      pcm = base64ToPcm(e.delta);
    } catch (error) {
      this.unreadable('audio', error);
      return;
    }
    this.audioReadable = true;
    this.frame('in', e.type, { responseId: e.response_id ?? null, itemId: e.item_id ?? null, samples: pcm.length });
    // A leg that does not speak asked for text alone; audio it gets anyway is not played.
    if (this.request.context.speech && typeof e.item_id === 'string' && typeof e.response_id === 'string') this.items.audio(e.item_id, e.response_id, pcm);
  }

  private outputItemDone(e: ResponseOutputItemDoneEvent): void {
    const { id } = itemOf(e.item);
    this.frame('in', e.type, { responseId: e.response_id ?? null, itemId: id ?? null });
    if (this.phase === 'live' && id !== undefined) this.items.itemDone(id);
  }

  /**
   * A response ended, whatever its status: its translations close. In band,
   * `busy` ends, the next request goes up, and a completed one counts
   * toward the anchor (ruling 2). Framed with its usage — the anchor's too,
   * which is its cost (survey §1.13).
   */
  private responseDone(e: ResponseDoneEvent): void {
    const r = e.response;
    const id = r?.id;
    const outOfBand = isOutOfBand(r);
    this.frame('in', e.type, { responseId: id ?? null, status: r?.status ?? null, statusDetails: r?.status_details ?? null, outOfBand, usage: r?.usage ?? null });
    if (this.phase !== 'live' || typeof id !== 'string') return;
    this.items.responseDone(id);
    if (outOfBand) return;
    if (this.producing) {
      this.producing = false;
      this.events.busy(false);
    }
    if (r?.status === 'completed') this.completed += 1;
    this.queue.done(id);
    if (this.completed > 0 && this.completed % ANCHOR_EVERY === 0) this.anchor();
  }

  /**
   * The drift anchor (ruling 2; choice 11): this leg's instructions again,
   * out of band and as text, at the start and after every fifth completed
   * translation — once per count, never on a closed socket. It is no
   * request of the queue's: nothing waits for it, and it waits for nothing.
   */
  private anchor(): void {
    if (this.phase !== 'live' || this.anchoredAt === this.completed) return;
    this.anchoredAt = this.completed;
    const eventId = `sokuji_${++this.ids}`;
    if (!this.send(JSON.stringify(anchorResponse(eventId, this.request.config.instructions)))) return;
    this.frame('out', 'response.anchor', { eventId, translations: this.completed });
  }

  /** A request the queue sends (ruling 8): a typed text's item first — once, however often its response is asked — then its `response.create`. */
  private ask(asked: Request, eventId: string, waitedMs: number): void {
    if (asked.kind === 'text' && !this.itemsSent.has(asked.itemId)) {
      this.itemsSent.add(asked.itemId);
      this.send(JSON.stringify(textItem(asked.itemId, asked.text)));
      this.frame('out', 'conversation.item.create', { itemId: asked.itemId, length: asked.text.length });
    }
    this.send(JSON.stringify(responseCreate(eventId)));
    this.frame('out', 'response.create', { eventId, for: asked.kind, waitedMs });
  }

  /** A frame, or an audio delta, that will not read: a Logs line and `parse_error` on each latch's ok → failing transition only (choice 15). */
  private unreadable(latch: 'frame' | 'audio', error: unknown): void {
    if (latch === 'frame' ? !this.readable : !this.audioReadable) return;
    if (latch === 'frame') this.readable = false;
    else this.audioReadable = false;
    this.frame('in', 'session.unreadable', { message: describeCause(error) });
    if (this.phase === 'live') this.events.degraded({ code: 'parse_error', message: `A message from OpenAI could not be read: ${describeCause(error)}`, cause: error });
  }

  /** The last mid-session error, when the close follows it within `ERROR_WORDS_MS` (ruling 13); a negative age — a wall clock stepped back — is not recent either. */
  private recentError(): { code: string; message: string } | null {
    const last = this.lastError;
    if (!last) return null;
    const age = this.request.clock.now() - last.at;
    if (age < 0 || age > ERROR_WORDS_MS) return null;
    return { code: last.code, message: last.message };
  }

  /** What goes up, when the socket is open; nothing on a closed one. */
  private send(data: string): boolean {
    if (this.socket.readyState !== WS_OPEN) return false;
    this.socket.send(data);
    return true;
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
    // A close right after a mid-session error reads as that error — a key revoked, a quota spent; any other as the lost connection (ruling 14). The 60-minute cap has ended the run already.
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
  private end(how: { failed: { code: string; message: string } }): void {
    if (this.phase !== 'live') return;
    this.shutDown();
    this.events.failed(how.failed);
  }

  /** Every way a leg ends: nothing waits or goes up, the socket is closed and no longer heard. */
  private shutDown(): void {
    this.phase = 'ended';
    this.queue.stop();
    this.items.stop();
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

export function createRealtimeAdapter(deps: Partial<RealtimeAdapterDeps> = {}): Adapter<RealtimeConfig, RealtimeCredentials> {
  const openSocket = deps.openSocket ?? nativeSocket;
  return {
    start(request, events) {
      // An aborted start opens nothing.
      if (request.signal.aborted) return Promise.reject(request.signal.reason ?? new Error('aborted'));
      try {
        return new RealtimeLeg(request, events, openSocket).opening;
      } catch (error) {
        // A start rejects, never throws. In fixed words and with no cause: a browser that refuses the socket quotes the subprotocols, the key among them.
        return Promise.reject(new AdapterStartError(`The browser would not open the socket (${errorName(error)}).`, 'network'));
      }
    },
  };
}
```

- [ ] **Step 6: Run them to see them pass, and the folder with them.**

Run: `npx vitest run src/providers/openai/adapter.test.ts src/providers/sessionSide.consistency.test.ts`
Expected: PASS — 2 files, 50 tests.

Run: `npx vitest run src/providers/openai/`
Expected: PASS — 12 files, 135 tests (every suite that imports `testing.ts` still passes with the harness in it).

- [ ] **Step 7: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 8: Commit.**

```bash
git add src/providers/openai/adapter.ts src/providers/openai/adapter.test.ts src/providers/openai/testing.ts src/providers/sessionSide.consistency.test.ts
```

```bash
git commit -q -F - -- src/providers/openai/adapter.ts src/providers/openai/adapter.test.ts src/providers/openai/testing.ts src/providers/sessionSide.consistency.test.ts <<'EOF'
feat(openai): the OpenAI Realtime adapter over WebSocket

One leg: the start resolves once the server confirms the configuration,
within 30 s (ruling 22); inputs and translations paired by item id
(ruling 23); typed text and a release's response queued (ruling 8); the
drift anchor at the start and after every fifth translation (ruling 2);
a mid-session error in the Logs, a close ending the run in words, no
reconnect (rulings 13, 14).

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Group check A (controller, after Wave 3)

Nothing is registered yet: the adapter, the check and the view are complete and unreachable.

- [ ] The full gates: `npx vitest run src` at 0 failed with no unhandled errors (the scratch copy: 552 files passed and 1 skipped, 7 010 tests passed and 2 skipped); the typecheck gate at exactly the baseline.
- [ ] `npx vitest run src/services` green: the old clients and descriptors are untouched.
- [ ] `npm run build`, then `npm run extension:build`; `npx vitest run extension`.
- [ ] The three D24 greps print nothing.
- [ ] `command grep -rlF 'response.anchor' build extension/dist` prints nothing: the adapter is in no bundle before Task 12 registers it.
- [ ] Record the numbers in the controller's notes for Task 13.

---

### Task 12: The definition, registered (Wave 4)

**Files:**
- Create: `src/providers/openai/provider.ts`
- Test: `src/providers/openai/provider.test.ts`
- Modify: `src/providers/registry.ts`, `src/providers/registry.test.ts`, `src/providers/openai_translate/provider.test.ts`, `src/components/SetupWizard/providerPaths.test.ts`, `src/components/SetupWizard/useApplySetup.test.ts`, `src/components/SetupWizard/SetupWizard.test.tsx`, `src/app/loadStores.test.ts`

**Interfaces:**
- Consumes: every earlier task's exports; `OpenAIIcon` (`src/components/Icons/ProviderIcons`); `readCredentials`, `contextsFor`, `gate`, `selectionFromStored`, `useProviderStore` (the definition's cases).
- Produces: `openaiProvider: Provider<RealtimeSettings, RealtimeCredentials, RealtimeConfig> & { id: 'openai' }` (choice 22), registered after `volcengineAst2Provider` and before `openaiTranslateProvider` (ruling 18).

- [ ] **Step 1: Write the failing test.** Create `src/providers/openai/provider.test.ts` — the definition's shape, its place in the registry, Compatible's fallback through the existing rule (ruling 1), the participant (rulings 4, 15; D20), an old profile loaded as it was (rulings 5, 6, 12), and the readiness kept through a slider or prompt edit (ruling 9), end to end through the store:

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
import { AUTO } from '../../lib/provider/languages';
import { contextsFor, gate } from '../../lib/session/shape';
import { selectionFromStored } from '../../lib/session/storedSettings';
import type { RunShape } from '../../lib/session/types';
import { useProviderStore } from '../../stores/providerStore';
import { presentProviders, PROVIDERS } from '../registry';
import { buildRealtime, describeRealtime, type RealtimeConfig } from './config';
import { openaiProvider } from './provider';
import { RealtimeSettingsView } from './RealtimeSettings';
import { RealtimeTurnDetectionControls, RealtimeTurnDetectionHelp, RealtimeTurnDetectionSummary } from './RealtimeTurnDetection';
import { migrateRealtimeSettings, REALTIME_DEFAULTS, REALTIME_LEGACY_KEYS, realtimeCredentials, realtimeLanguages, type RealtimeSettings } from './settings';
import { AUTO_CTX, configFor, KEY, SHARED } from './testing';

afterEach(() => {
  vi.unstubAllGlobals();
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, readiness: {}, selected: null, selectionLocked: false, legs: ['speaker'], speech: { textOnly: false, participantSpeech: false } });
});

const both = (pair: { source: string; target: string }, patch: Partial<RunShape> = {}) =>
  ({ provider: openaiProvider, settings: REALTIME_DEFAULTS, pair, legs: ['speaker', 'participant'], textOnly: false, participantSpeech: false, turnMode: 'auto', ...patch }) as unknown as RunShape;
const noAuth = { signedIn: false, getToken: async () => null };

describe('the OpenAI Realtime definition', () => {
  it('is OpenAI Realtime with your own key, on every platform, under its old id and slice, linking the OpenAI setup guide (ruling 19)', () => {
    expect(openaiProvider).toMatchObject({
      id: 'openai',
      kind: 'own-key',
      platforms: ['electron', 'extension', 'web'],
      icon: OpenAIIcon,
      guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',
      settings: { key: 'openai', defaults: REALTIME_DEFAULTS, legacyKeys: REALTIME_LEGACY_KEYS, migrate: migrateRealtimeSettings },
      Settings: RealtimeSettingsView,
      TurnDetection: { Summary: RealtimeTurnDetectionSummary, Controls: RealtimeTurnDetectionControls, Help: RealtimeTurnDetectionHelp },
      credentials: realtimeCredentials,
      checkReads: [],
      languages: realtimeLanguages,
      build: buildRealtime,
      describe: describeRealtime,
    });
    for (const absent of ['flagged', 'i18nKey', 'session', 'participantSpeech'] as const) {
      expect(openaiProvider, absent).not.toHaveProperty(absent);
    }
  });

  it('offers Text only and typed text, keeps the server\'s boundaries, and offers both turn modes', () => {
    expect(openaiProvider.speech).toBe('optional');
    expect(openaiProvider.textInput).toBe(true);
    expect(openaiProvider.boundaries(REALTIME_DEFAULTS)).toBe('provider');
    expect(openaiProvider.turns(REALTIME_DEFAULTS)).toEqual(['auto', 'manual']);
  });

  it('sits after Doubao AST 2.0 and before OpenAI Translate, and OpenAI Compatible is registered nowhere (rulings 18, 1)', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids.indexOf('openai')).toBe(ids.indexOf('volcengine_ast2') + 1);
    expect(ids.indexOf('openai')).toBe(ids.indexOf('openai_translate') - 1);
    expect(ids).not.toContain('openai_compatible');
  });

  it('a stored OpenAI Compatible selection falls to the first provider offered, through the existing rule: nothing is written (ruling 1)', () => {
    for (const platform of ['electron', 'extension', 'web'] as const) {
      const offered = presentProviders({ platform, dev: false, enabled: new Set(), kizuna: true, switchOn: () => false }).map((p) => p.id);
      expect(selectionFromStored('openai_compatible', offered, 'kizunaai_soniox'), platform).toEqual({ id: offered[0], fromStorage: false });
    }
  });

  it("lets the participant speak when its switch is on, with Other's prompt and the user's own detection (rulings 4, 15), and refuses Both for Auto-detect (D20)", () => {
    const participant = contextsFor(both({ source: 'ja', target: 'en' }, { participantSpeech: true })).participant!;
    expect(participant).toEqual({ direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' });
    const s: RealtimeSettings = { ...REALTIME_DEFAULTS, useTemplateMode: false, systemInstructions: 'Mine.', participantSystemInstructions: "Other's.", turnDetectionMode: 'Semantic' };
    const shared = { ...SHARED, reversed: (d: { source: string; target: string }) => d.source === 'en' && d.target === 'ja' };
    expect(openaiProvider.build(participant, s, shared)).toMatchObject({ instructions: "Other's.", modalities: ['audio'], turnDetection: { type: 'semantic_vad', eagerness: 'auto' } });
    expect(contextsFor(both({ source: 'ja', target: 'en' })).participant!.speech).toBe(false);
    expect(gate(both({ source: AUTO, target: 'en' }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
    expect(gate(both({ source: 'ja', target: 'en' }), 'electron')).toBeNull();
  });

  it('a start whose signal already aborted opens no socket', async () => {
    const opened = vi.fn();
    vi.stubGlobal('WebSocket', opened);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(openaiProvider.start(
      { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    )).rejects.toBe(reason);
    expect(opened).not.toHaveBeenCalled();
  });

  it("loads an old profile as it was — the key, the pair, the settings, a WebRTC choice run over WebSocket — reading no temperature and converting nothing, and writes nothing (rulings 5, 6, 12)", async () => {
    stored.set('settings.openai.apiKey', 'sk-proj-oldProfileKey0123');
    stored.set('settings.openai.sourceLanguage', 'ko');
    stored.set('settings.openai.targetLanguage', 'ja');
    stored.set('settings.openai.model', 'gpt-realtime-2.1');
    stored.set('settings.openai.voice', 'marin');
    stored.set('settings.openai.turnDetectionMode', 'Semantic');
    stored.set('settings.openai.semanticEagerness', 'High');
    stored.set('settings.openai.transportType', 'webrtc');
    stored.set('settings.openai.temperature', 1.1);
    // Electron reads a number saved over a string default back as the string (Stage 2 Gemini, ruling 10).
    stored.set('settings.openai.maxTokens', '2048');
    stored.set('settings.common.useTemplateMode', false);
    stored.set('settings.common.systemInstructions', 'Translate plainly.');
    await useProviderStore.getState().load(openaiProvider);
    const entry = useProviderStore.getState().entries.openai;
    expect(entry.settings as RealtimeSettings).toMatchObject({
      model: 'gpt-realtime-2.1', voice: 'marin', turnDetectionMode: 'Semantic', semanticEagerness: 'High', transportType: 'webrtc', maxTokens: 2048,
      useTemplateMode: false, systemInstructions: 'Translate plainly.',
    });
    expect(entry.settings).not.toHaveProperty('temperature');
    expect(readCredentials(openaiProvider, entry.settings, entry.credentials, noAuth)).toEqual({ apiKey: 'sk-proj-oldProfileKey0123' });
    expect(entry.pair).toEqual({ source: 'ko', target: 'ja' });
    const config = openaiProvider.build({ direction: entry.pair, speech: true, turns: 'auto' }, entry.settings as RealtimeSettings, { ...SHARED, models: [{ id: 'gpt-realtime-2.1' }] }) as RealtimeConfig;
    expect(config).toMatchObject({ transport: 'websocket', model: 'gpt-realtime-2.1', voice: 'marin', maxTokens: 2048, instructions: 'Translate plainly.' });
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("keeps its readiness through an edit to a slider or the prompt: Start stays on and nothing is listed again; a new key forgets it (ruling 9)", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-realtime-2.1-mini', created: 1 }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const store = useProviderStore.getState();
    await store.load(openaiProvider);
    store.setCredential(openaiProvider, 'apiKey', 'sk-proj-readyKey0123');
    await store.refreshReadiness(openaiProvider, noAuth);
    expect(useProviderStore.getState().readiness.openai).toEqual({ state: 'ready', models: [{ id: 'gpt-realtime-2.1-mini' }] });
    store.updateSettings(openaiProvider, { threshold: 0.7 });
    store.updateSettings(openaiProvider, { systemInstructions: 'A new prompt.' });
    expect(useProviderStore.getState().readiness.openai).toEqual({ state: 'ready', models: [{ id: 'gpt-realtime-2.1-mini' }] });
    const entry = useProviderStore.getState().entries.openai;
    await store.refreshReadiness(openaiProvider, noAuth, { settings: entry.settings, credentials: entry.credentials, pair: entry.pair, legs: ['speaker'] });
    expect(fetch).toHaveBeenCalledTimes(1);
    store.setCredential(openaiProvider, 'apiKey', 'sk-proj-otherKey0123');
    expect(useProviderStore.getState().readiness.openai).toEqual({ state: 'unknown' });
  });
});
```

- [ ] **Step 2: Move the pins registering `openai` changes.** Registering OpenAI Realtime makes nine existing cases false: six used `openai` as "a provider this build does not register" — now `openai_compatible`, which no build registers (ruling 1) — and three pin the order. One expectation is added: OpenAI Realtime fits the subtitles-only scenario. `src/providers/registry.test.ts` (the order, ruling 18):

```diff
--- a/src/providers/registry.test.ts
+++ b/src/providers/registry.test.ts
@@ -297,8 +297,8 @@
     const releaseBuild = await import('./registry');
     // each provider plan adds its id where the owner orders it (spec: "one line in the order test").
     // Kizuna Soniox first, unflagged (Stage 2 Kizuna Soniox, ruling 6): the owner's 2026-09-12
-    // product order put the managed provider first; then LocalInference, Gemini (Stage 2 Gemini, ruling 6), Doubao AST 2.0 (Stage 2 Volcengine AST2, ruling 5), OpenAI Translate (Stage 2 OpenAI Translate, ruling 11), then Soniox with your own key.
-    expect(releaseBuild.PROVIDERS.map((p) => p.id)).toEqual(['kizunaai_soniox', 'localInference', 'gemini', 'volcengine_ast2', 'openai_translate', 'soniox']);
+    // product order put the managed provider first; then LocalInference, Gemini (Stage 2 Gemini, ruling 6), Doubao AST 2.0 (Stage 2 Volcengine AST2, ruling 5), OpenAI Realtime (Stage 2 OpenAI Realtime, ruling 18), OpenAI Translate (Stage 2 OpenAI Translate, ruling 11), then Soniox with your own key.
+    expect(releaseBuild.PROVIDERS.map((p) => p.id)).toEqual(['kizunaai_soniox', 'localInference', 'gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'soniox']);
   });
 
   it('a development build adds exactly the two fakes', () => {
```

`src/providers/openai_translate/provider.test.ts` (Translate no longer follows Doubao directly; its place before Soniox stands):

```diff
--- a/src/providers/openai_translate/provider.test.ts
+++ b/src/providers/openai_translate/provider.test.ts
@@ -67,9 +67,8 @@
     expect(openaiTranslateProvider.turns(TRANSLATE_DEFAULTS)).toEqual(['auto', 'manual']);
   });
 
-  it('sits after Doubao AST 2.0 and before Soniox (ruling 11)', () => {
+  it('sits before Soniox (ruling 11)', () => {
     const ids = PROVIDERS.map((p) => p.id);
-    expect(ids.indexOf('openai_translate')).toBe(ids.indexOf('volcengine_ast2') + 1);
     expect(ids.indexOf('openai_translate')).toBe(ids.indexOf('soniox') - 1);
   });
 
```

`src/components/SetupWizard/providerPaths.test.ts`:

```diff
--- a/src/components/SetupWizard/providerPaths.test.ts
+++ b/src/components/SetupWizard/providerPaths.test.ts
@@ -25,7 +25,7 @@
   });
 
   it("lists the registered own-key providers in registry order, in the old enum's spelling", () => {
-    expect(ownKeyOptions('understand-others').map((o) => o.id)).toEqual(['gemini', 'volcengine_ast2', 'openai_translate', 'soniox', 'fake']);
+    expect(ownKeyOptions('understand-others').map((o) => o.id)).toEqual(['gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'soniox', 'fake']);
   });
 
   it("judges a provider's fit from its speech", () => {
@@ -37,6 +37,8 @@
     expect(text[Provider.SONIOX]).toEqual({ ok: true });
     // OpenAI Translate offers Text only now (Stage 2 OpenAI Translate, ruling 4): the subtitles-only scenario no longer greys it.
     expect(text[Provider.OPENAI_TRANSLATE]).toEqual({ ok: true });
+    // OpenAI Realtime asks for text alone when a leg does not speak (Stage 2 OpenAI Realtime), as the old provider offered.
+    expect(text[Provider.OPENAI]).toEqual({ ok: true });
   });
 
   it("judges the managed card's fit from the definition's speech", () => {
@@ -51,7 +53,8 @@
     expect(providerFits(Provider.SONIOX, 'subtitle-myself')).toBe(true);
     expect(providerFits(Provider.LOCAL_INFERENCE, 'two-way-voice')).toBe(true);
     expect(providerFits(Provider.KIZUNA_AI_SONIOX, 'subtitle-myself')).toBe(true);
-    expect(providerFits(Provider.OPENAI, 'be-heard')).toBe(false);
+    // OpenAI Compatible, retired (Stage 2 OpenAI Realtime, ruling 1): no build registers it.
+    expect(providerFits(Provider.OPENAI_COMPATIBLE, 'be-heard')).toBe(false);
   });
 
   describe('offersRecord', () => {
@@ -76,7 +79,7 @@
     });
 
     it('refuses an own-key record for a provider this build does not register', () => {
-      expect(offersRecord({ scenario: 'be-heard', providerPath: 'own-key', provider: Provider.OPENAI })).toBe(false);
+      expect(offersRecord({ scenario: 'be-heard', providerPath: 'own-key', provider: Provider.OPENAI_COMPATIBLE })).toBe(false);
     });
 
     it('refuses a null providerPath or scenario', () => {
@@ -89,7 +92,8 @@
     expect(wizardProvider('local_inference')?.id).toBe('localInference');
     expect(wizardProvider('soniox')?.id).toBe('soniox');
     expect(wizardProvider('kizunaai_soniox')?.kind).toBe('managed');
-    expect(wizardProvider('openai')).toBeUndefined();
+    expect(wizardProvider('openai')?.id).toBe('openai');
+    expect(wizardProvider('openai_compatible')).toBeUndefined();
     expect(wizardProvider(null)).toBeUndefined();
   });
 });
```

`src/components/SetupWizard/useApplySetup.test.ts`:

```diff
--- a/src/components/SetupWizard/useApplySetup.test.ts
+++ b/src/components/SetupWizard/useApplySetup.test.ts
@@ -118,7 +118,8 @@
   it('throws before any write when the draft names a provider this build does not offer', async () => {
     const { result } = renderHook(() => useApplySetup());
 
-    await expect(result.current(draft({ provider: Provider.OPENAI }))).rejects.toThrow(/This build does not offer/);
+    // OpenAI Compatible, retired (Stage 2 OpenAI Realtime, ruling 1): no build offers it.
+    await expect(result.current(draft({ provider: Provider.OPENAI_COMPATIBLE }))).rejects.toThrow(/This build does not offer/);
 
     expect(useProviderStore.getState().selected).toBeNull();
     expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
```

`src/components/SetupWizard/SetupWizard.test.tsx`:

```diff
--- a/src/components/SetupWizard/SetupWizard.test.tsx
+++ b/src/components/SetupWizard/SetupWizard.test.tsx
@@ -328,7 +328,8 @@
   });
 
   it('starts blank from an own-key record whose provider this build does not register', async () => {
-    setupRecord = { version: 1, scenario: 'be-heard', providerPath: 'own-key', provider: 'openai', completedAt: 'x' };
+    // OpenAI Compatible, retired (Stage 2 OpenAI Realtime, ruling 1): no build registers it.
+    setupRecord = { version: 1, scenario: 'be-heard', providerPath: 'own-key', provider: 'openai_compatible', completedAt: 'x' };
     render(<SetupWizard variant="rerun" onClose={vi.fn()} />);
     next();
     expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);
```

`src/app/loadStores.test.ts` — the loader's fallback case now pins ruling 1 itself:

```diff
--- a/src/app/loadStores.test.ts
+++ b/src/app/loadStores.test.ts
@@ -82,7 +82,8 @@
   });
 
   it('falls back to the first offered provider when the stored one is not offered here, and never overwrites the stored value', async () => {
-    stored.set('settings.common.provider', 'openai');
+    // OpenAI Compatible, retired (Stage 2 OpenAI Realtime, ruling 1): no build registers it.
+    stored.set('settings.common.provider', 'openai_compatible');
     useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });
 
     await loadSessionStores();
```

- [ ] **Step 3: Run them to see them fail.**

Run: `npx vitest run src/providers/openai/provider.test.ts src/providers/registry.test.ts src/providers/openai_translate/provider.test.ts src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/useApplySetup.test.ts src/components/SetupWizard/SetupWizard.test.tsx src/app/loadStores.test.ts`
Expected: FAIL — `provider.test.ts` (`Failed to resolve import "./provider"`) and 4 tests: the registry's order pin, and `providerPaths.test.ts`' own-key list, its fit case (`text[Provider.OPENAI]` is `undefined`) and `wizardProvider('openai')`. The retargeted cases pass either way: no build registers `openai_compatible`.

- [ ] **Step 4: Write the definition.** Create `src/providers/openai/provider.ts`:

```ts
import { OpenAIIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { createRealtimeAdapter } from './adapter';
import { checkRealtime } from './check';
import { buildRealtime, describeRealtime, type RealtimeConfig } from './config';
import { RealtimeSettingsView } from './RealtimeSettings';
import { RealtimeTurnDetectionControls, RealtimeTurnDetectionHelp, RealtimeTurnDetectionSummary } from './RealtimeTurnDetection';
import {
  migrateRealtimeSettings,
  REALTIME_DEFAULTS,
  REALTIME_LEGACY_KEYS,
  realtimeCredentials,
  realtimeLanguages,
  type RealtimeCredentials,
  type RealtimeSettings,
} from './settings';

const adapter = createRealtimeAdapter();

/**
 * OpenAI Realtime with the user's own key (Stage 2 OpenAI Realtime): a
 * GPT Realtime dialogue model made a translator by its instructions, one
 * WebSocket per leg — the WebRTC transport is a later step (ruling 12).
 * The old enum's id and slice (controller ruling 2 of the foundation), so a
 * stored selection, the key, the pair and every setting carry over. The
 * key rides in a subprotocol a browser sets itself, so it runs on every
 * platform, and the extension's manifest already lists its host and CSP
 * origin: no manifest or background change. Released between Doubao AST
 * 2.0 and OpenAI Translate, unflagged (ruling 18). OpenAI Compatible is
 * retired, not ported (ruling 1): a stored selection of it falls to the
 * first provider offered.
 */
export const openaiProvider: Provider<RealtimeSettings, RealtimeCredentials, RealtimeConfig> & { id: 'openai' } = {
  id: 'openai',
  kind: 'own-key',
  platforms: ['electron', 'extension', 'web'],
  icon: OpenAIIcon,
  // The OpenAI setup guide (ruling 19): today's TUTORIAL_URLS value, as a literal (no import from src/services).
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',

  settings: { key: 'openai', defaults: REALTIME_DEFAULTS, legacyKeys: REALTIME_LEGACY_KEYS, migrate: migrateRealtimeSettings },
  Settings: RealtimeSettingsView,
  TurnDetection: { Summary: RealtimeTurnDetectionSummary, Controls: RealtimeTurnDetectionControls, Help: RealtimeTurnDetectionHelp },

  credentials: realtimeCredentials,
  check: (k, s, ctx) => checkRealtime(k, s, ctx),
  // The model list reads no setting (ruling 9): a slider or a prompt edit keeps Start on.
  checkReads: [],

  languages: realtimeLanguages,

  // Text only is the API's own: a leg that does not speak asks for text alone.
  speech: 'optional',
  textInput: true,
  // The server's commits and responses end segments (the old offer: Auto); cutting by sentences is offered too.
  boundaries: () => 'provider',
  // WebSocket only: the WebRTC step makes it depend on the transport (D25).
  turns: () => ['auto', 'manual'],

  build: buildRealtime,
  describe: describeRealtime,
  start: adapter.start,
};
```

- [ ] **Step 5: Register it.** In `src/providers/registry.ts`:

```diff
--- a/src/providers/registry.ts
+++ b/src/providers/registry.ts
@@ -10,13 +10,14 @@
 import { fakeProvider } from './fake/provider';
 import { geminiProvider } from './gemini/provider';
 import { localInferenceProvider } from './localInference/provider';
+import { openaiProvider } from './openai/provider';
 import { openaiTranslateProvider } from './openai_translate/provider';
 import { kizunaSonioxProvider } from './soniox/kizuna';
 import { sonioxProvider } from './soniox/provider';
 import { volcengineAst2Provider } from './volcengine_ast2/provider';
 
-/** Shipped providers, in UI order (Stage 2 Kizuna Soniox, ruling 6; Stage 2 Gemini, ruling 6; Stage 2 Volcengine AST2, ruling 5; Stage 2 OpenAI Translate, ruling 11): the managed Kizuna Soniox, the free LocalInference, then Gemini, Doubao AST 2.0, OpenAI Translate and Soniox with your own key. */
-const RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, openaiTranslateProvider, sonioxProvider] as const;
+/** Shipped providers, in UI order (Stage 2 Kizuna Soniox, ruling 6; Stage 2 Gemini, ruling 6; Stage 2 Volcengine AST2, ruling 5; Stage 2 OpenAI Translate, ruling 11; Stage 2 OpenAI Realtime, ruling 18): the managed Kizuna Soniox, the free LocalInference, then Gemini, Doubao AST 2.0, OpenAI Realtime, OpenAI Translate and Soniox with your own key. */
+const RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, openaiProvider, openaiTranslateProvider, sonioxProvider] as const;
 /** Compiled into development builds only (D24): the fake, and the leased fake that carries the session hooks (Stage 2 foundation, choice 1). */
 const DEV_ONLY = [fakeProvider, fakeLeasedProvider] as const;
 
```

- [ ] **Step 6: Run them to see them pass.**

Run: `npx vitest run src/providers/openai/provider.test.ts src/providers/registry.test.ts src/providers/openai_translate/provider.test.ts src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/useApplySetup.test.ts src/components/SetupWizard/SetupWizard.test.tsx src/app/loadStores.test.ts`
Expected: PASS — 7 files, 94 tests. The registry's invariants (F17 and Task 3's `checkReads` rule) now hold OpenAI Realtime too; `npx vitest run src/providers/openai/` — 13 files, 143 tests.

- [ ] **Step 7: Gates.** The suite at 0 failed with no unhandled errors (the scratch copy: 553 files passed and 1 skipped, 7 018 tests passed and 2 skipped); the typecheck gate prints exactly the baseline.

- [ ] **Step 8: Commit.**

```bash
git add src/providers/openai/provider.ts src/providers/openai/provider.test.ts src/providers/registry.ts src/providers/registry.test.ts src/providers/openai_translate/provider.test.ts src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/useApplySetup.test.ts src/components/SetupWizard/SetupWizard.test.tsx src/app/loadStores.test.ts
```

```bash
git commit -q -F - -- src/providers/openai/provider.ts src/providers/openai/provider.test.ts src/providers/registry.ts src/providers/registry.test.ts src/providers/openai_translate/provider.test.ts src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/useApplySetup.test.ts src/components/SetupWizard/SetupWizard.test.tsx src/app/loadStores.test.ts <<'EOF'
feat(providers): OpenAI Realtime with your own key, before OpenAI Translate

Registered unflagged after Doubao AST 2.0 (ruling 18), under its old id
and slice. OpenAI Compatible is retired, not ported (ruling 1): a stored
selection of it falls to the first provider offered, and the cases that
named `openai` as unregistered now name it.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Group check B (controller, after Wave 4)

- [ ] The full gates: `npx vitest run src` at 0 failed with no unhandled errors; the typecheck gate at exactly the baseline; `npx vitest run src/services` green.
- [ ] `npm run build`, then `npm run extension:build`; `npx vitest run extension`.
- [ ] The three D24 greps print nothing.
- [ ] `command grep -rlF 'response.anchor' build extension/dist` names at least one file under `build/` and one under `extension/dist/`: the adapter ships in both.
- [ ] **Rendered, with no request to OpenAI** (a fresh vite, `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort --force`, driven by `scripts/dev/headless.mjs`; outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/group-b/`). No key is typed into OpenAI Realtime's field and Start is never pressed with it selected (ruling 26):
  - select OpenAI Realtime in the picker: the Provider tab, in the simple and the advanced layout, shows its fields in the old order — system instructions, voice, model (the saved `gpt-realtime-2.1-mini`, nothing listed yet), the transcript model (`gpt-4o-mini-transcribe`, no keywords field), noise reduction, the max tokens with no temperature row, and the reasoning effort (the saved model is a `gpt-realtime-2*` one); choosing `gpt-transcribe` as the transcript model shows its keywords field. Compare each field's markup with Gemini's same field (the match-sibling rule);
  - the Speech section's turn-detection summary reads "Normal · Threshold 0.49 · Silence duration 0.50s"; its controls sit under the VAD heading; choosing Semantic shows the eagerness select and the summary follows;
  - the network log holds no request to `api.openai.com` (no key, so no check);
  - Start is off, and says the key is missing (`credentials_missing`: "Enter your API key in Settings before starting.");
  - the setup wizard's own-key list reads, in order, Google Gemini, Doubao AST 2.0, OpenAI Realtime, OpenAI Translate, Soniox (then the development build's fake);
  - with `localStorage` `settings.common.provider` set to `openai_compatible` and the page reloaded: the first provider offered is selected, and `settings.common.provider` still reads `openai_compatible` (nothing written; ruling 1).
- [ ] Stop the vite; record the numbers and screenshots' paths for Task 13.

---
### Task 13: The spec's amendments and the roadmap's record (controller)

The controller's docs task (ruling 30), after group check B. It edits only the spec and the roadmap, and commits them together.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-client-contract-design.md`, `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`

- [ ] **Step 1: Amend the spec.** Each amendment is marked "(Stage 2 OpenAI Realtime, ruling / choice N)" in the text, as the earlier plans' are. Anchors are by heading and content (lines read at `583df521`):
  1. **"What every adapter must honour", the `frame` bullet:** its "The panel groups by `type` plus the item id it finds in the payload" is corrected (survey §3.7.5) — `logStore` reads `item_id` at the event's top level (`logStore.ts:495-496`), while a frame arrives as `{ type, data: payload }` (`src/app/telemetry.ts:94`), so an adapter's frames group by consecutive type alone. After "OpenAI Translate's need no row: …": "OpenAI Realtime's need none either: its four `.delta` frames group by their own type when consecutive, and none of its other names is anyone's row (choice 13)."
  2. **The same list, the `appendText` bullet:** "OpenAI Realtime shows typed text at once and holds its request, first in first out, while a response is in progress; the adapter owns that queue, so `busy` has no reader (ruling 8)."
  3. **"Turns" → "The design", the paragraph on the automatic mechanism** ("OpenAI's stored `'Normal'` and `'Semantic'` … they become OpenAI's `autoDetection`"): amended — the mechanism stays stored as `turnDetectionMode`, now `'Normal' | 'Semantic'` alone; a stored push mode is no mechanism and reads as `'Normal'`, so no field and no `legacyKeys` entry is needed (ruling 5, choice 4). The global mode's one-time migration is unchanged: OpenAI's stored `'Disabled'` maps to automatic, and a user who held push-to-talk picks it again once — a stated departure (survey §3.7.3).
  4. **The participant paragraph that follows** ("The settings copy 'Other's audio always uses semantic VAD', false today for every provider"): corrected — it was true for OpenAI, whose participant was forced to semantic VAD at high eagerness (`ProviderDescriptor.ts:389-407`), and false for every other provider; OpenAI Realtime's participant now uses the user's own detection, as Gemini's does (ruling 4; survey §3.7.2).
  5. **The design table's OpenAI row:** `endTurn` "commit at once; its `response.create` waits behind a response in progress (ruling 8)"; `cancelTurn` unchanged (`input_audio_buffer.clear`, choice 12). "Defects removed by construction", its first bullet: landed.
  6. **"Coverage"** and **"Stage 2 — open for the plans that meet them", its D25 item:** this port is WebSocket only and offers both modes (ruling 12); D25, `turns(s)` and the participant's transport meet the WebRTC step with OpenAI Translate's, which also decides whether "manual only" includes push-to-translate — the old UI disabled it under WebRTC too (`PSS:589-590`; survey §3.7.7).
  7. **"Provider capability", the table** — its "per audio frame" for `OpenAIGAClient` and `OpenAIClient` was never true: neither client produced ranges, its karaoke was interpolation (D4; survey §3.7.1). The `OpenAIGAClient` row → "per audio frame, **by arrival**, as OpenAI Translate's (ruling 3) — the second stated exception to the honesty rule" | "input item ↔ response — **stated**: the assistant item's `previous_item_id`, else the newest unanswered input when the response began (ruling 23; choice 8)"; the `OpenAIClient (compatible)` row → "retired, not ported (ruling 1)"; the `OpenAIWebRTCClient` row → "the WebRTC step". After the table's notes: "OpenAI Realtime's pairing is stated by the server's own item ids; an utterance no response answers stays a source row of its own."
  8. **"The provider definition" → "The shape":** the member `checkReads?: (keyof S & string)[]` beside `check`, with a one-line comment (ruling 9). **The drift-anchor paragraph** ("What else is provider-specific and sits in MainPanel today"): landed as parity — out of band (`conversation: 'none'`), text only, the leg's instructions when not blank, at `session.updated` and after every fifth completed in-band response, framed with its usage; its output makes no segment and is not `busy` (ruling 2, choice 11). What it steers is unmeasured — the API keeps an out-of-band response out of the conversation (survey §3.7.4) — and live-test item 4 is the evidence. **The transport paragraph:** "OpenAI Realtime's port is WebSocket only too; a stored `webrtc` runs over WebSocket (ruling 12)."
  9. **"Readiness is one check",** a paragraph after the one on when checks run: "**A check says what it reads** (Stage 2 OpenAI Realtime, ruling 9). A provider may list the settings fields its `check` reads in `checkReads`. An edit to any other field keeps the answer — readiness stays ready, so the driver checks nothing and Start stays on — unless the edit moved the run's pair, which every check reads; the kept answer is keyed on the listed fields alone. A refusal, or a check that threw, stands through such an edit too; Validate asks again. Absent, every field counts, as before. OpenAI Realtime's model list reads none (`[]`); the other ported providers are candidates." In the effective-model paragraph: "OpenAI Realtime runs the saved model when listed, else its default model when listed, else the list's newest `created` (`effectiveRealtimeModel`); its old one-time model migration is not ported (ruling 5)."
  10. **"Sockets that need upgrade headers",** after the OpenAI Translate paragraph: "Nor does OpenAI Realtime's: the same subprotocol, read in one function of its wire, through its own seam in fixed words (ruling 25, choice 7; survey §3.7.6)."
  11. **"Persisted settings that move", the table:** the turn-mode row's "and OpenAI's `Normal` / `Semantic` become its `autoDetection`" → "and OpenAI's `Normal` / `Semantic` stay its `turnDetectionMode` (ruling 5)"; the transport row: "OpenAI Realtime's is read and not shown until the WebRTC step (ruling 12)". Below the table: the temperature leaves OpenAI's `S` (ruling 6); its stored value is left in place, unread.
  12. **"What adding a provider then touches", item 4:** "or for OpenAI Realtime, the same host and origins (`manifest.json:38, 116`)".
  13. **"Migration", item 6:** "**OpenAI Realtime** (`openai`) — server boundaries, stated pairing, the drift anchor, the typed-text queue — ported over WebSocket by the Stage 2 OpenAI Realtime plan; its WebRTC transport joins item 7. **OpenAI Compatible** (`openai_compatible`) is retired, not ported (ruling 1): a stored selection falls to the first provider offered." The count: "twelve providers: nine ported in ten steps — OpenAI Translate's WebRTC transport, with OpenAI Realtime's, a step of its own — one retired, and two relay twins, both deleted." The deletion paragraph: "OpenAI Realtime's and Compatible's old code, and the `openai-realtime-api` dependency, wait with OpenAI Translate's T3 for the WebRTC step's live test (ruling 20)."
  14. **"Risks", the karaoke bullet:** "OpenAI Realtime's arrival ranges are the second, by the same kind of ruling (Stage 2 OpenAI Realtime, ruling 3)."
  15. **"The session request", the paragraph on what opacity costs:** OpenAI Realtime's `describe` names its transcript model as the ASR model (choice 20).
- [ ] **Step 2: Write the roadmap's section.** Append `## Scheduled by the Stage 2 OpenAI Realtime plan` after the OpenAI Translate section, in its form:
  - **What landed:** the plan's path and commit, the commit range and its `+/−` lines and files (from `git diff --shortstat`), the waves as run, each task's review rounds, group checks A and B with their numbers; Task 13 is the record.
  - **Departures, stated:** OpenAI Compatible withdrawn from a release (ruling 1); a stored `'Disabled'` turns to automatic once (ruling 5); a stored pre-2.1 model runs as stored while listed, else as the default model when listed, else the newest — an unlisted stored model runs as the default model, so a `gpt-realtime-mini` user may land on the full model only when the default is not listed, and a full `gpt-realtime` user lands on the mini one (choice 4); the temperature gone (ruling 6); the participant's detection now the user's (ruling 4); `response.create` carries `metadata.request`, where the old one was bare (choice 10); the anchor's metadata drops the old `sessionType` (choice 11; ruling 21); `session_expired` ends the run at once as the segment's end (choice 14); the view's new selects carry an `aria-label` (choice 17).
  - **Before any release from the branch:** the registry's order, pinned (ruling 18); the release notes say OpenAI Compatible is retired and what its users see (the first provider offered, their Compatible settings kept on disk); the wizard's own-key description's "OpenAI" is true for two providers now; no new key, so no native-speaker check.
  - **The owner's live test** (own key, real OpenAI; each item names what settles it):
    1. **The key** (ruling 17; choice 16): Validate lists the realtime models newest first; a wrong key reads as the key; a restricted project key's 403 reads as the key — note its message; an unsupported region's words.
    2. **The start** (ruling 22): the Logs show `session.opened`, `session.created`, `session.update`, `session.updated`, then `response.anchor`; the time from Start to live.
    3. **Automatic, Normal** (rulings 3, 11, 23): Japanese to English; the source transcript streams into its row; the translation plays with karaoke by arrival; each translation sits under its source. Note in the Logs whether `response.output_item.added` precedes the assistant's `conversation.item.added` (the SDK leaves the order undocumented; `items.ts` pairs either way, choice 8).
    4. **The drift anchor** (ruling 2; choice 11): the first at the start, the next after five translations — its `response.created` / `response.done` framed `outOfBand: true`, with `usage`; record its tokens and cost per anchor, and the translations' quality and any drift over a 20-minute session with it on (nothing turns it off, ruling 2; whether it earns its cost is the open question).
    5. **Semantic** detection and its eagerness; the thresholds of Normal.
    6. **Push-to-talk** (choice 12; ruling 8): a release commits at once; a release while a translation plays shows `response.queued`, then its answer after that one ends; an empty press sends `input_audio_buffer.clear` and nothing of it joins the next turn.
    7. **Typed text** (ruling 8; choice 24): shown at once and translated; three typed while a response plays are answered in order, one each.
    8. **Speaking over a playing translation** (`interrupt_response: false`; choice 8): does the server answer the utterance? Either way it is its own row, and the next translation pairs with the right source.
    9. **A mid-session error** (ruling 13): a `conversation_already_has_active_response` refusal (item 6 can provoke it) is a red Logs line, not a notice, and the request is asked again.
    10. **Text only:** no audio; the text translation.
    11. **Both** (rulings 4, 15; D20): the participant speaks only with its switch on and uses the user's own detection; an Auto-detect source refuses Both; speaker-only with Auto-detect translates "the spoken language" (ruling 7).
    12. **Expiry and drops** (ruling 14; choice 14): a session past 60 minutes ends in words — which code the server sends (`session_expired` is this plan's hypothesis, and the run ends on it at once), and whether the server closes the socket after it; a network drop ends in `connection_lost`; nothing reconnects.
    13. **Noise reduction** (ruling 16): `session.updated` echoes `null` for None and the type otherwise.
    14. **Reasoning effort** for `gpt-realtime-2*`; an older listed model (`gpt-realtime`) starts with none sent.
    15. **The transcript model and keywords:** `gpt-transcribe` and `gpt-live-transcribe` accept `languages` and `keywords` (the SDK does not type them).
    16. **Max tokens:** `inf` and a number.
    17. **An old profile** (rulings 5, 6, 12): key, pair and settings saved by an earlier build are ready without re-entry; `transportType: 'webrtc'` runs over WebSocket (`translation_session_start.transport` reads `websocket`); a stored temperature changes nothing; a stored `'Disabled'` reads as automatic.
    18. **A stored OpenAI Compatible selection** (ruling 1): the first provider offered is selected; nothing is written.
    19. **Readiness narrowing** (ruling 9): moving a slider or editing the prompt leaves Start on and sends no `/v1/models` request; changing the key re-checks.
    20. **The wizard:** OpenAI Realtime between Doubao AST 2.0 and OpenAI Translate; its key step validates.
    21. **Analytics** (choice 20): `translation_session_start` with `provider: 'openai'`, the translation model and the transcript model as the ASR model; a refused start → `api_error` with its code.
    22. **The Logs panel** (choice 13): consecutive deltas grouped; `session.error` red; no key anywhere, the export included; no `session.unreadable` in a healthy session.
    23. **Two sessions on one key** in Both; the rate-limit words if the account hits one.
    24. **The extension side panel:** Validate and a session under the extension's CSP; no CSP error.
    25. **Each platform:** items 2, 3 and 7 on the web build, the extension and Electron; the Electron subtitle takeover and the extension overlay show the paired rows.
  - **Open questions for the owner:** each of the live test's hypotheses — the expiry code (item 12), `ERROR_WORDS_MS`, whether the server echoes `metadata.request` on `response.created` (the queue works either way; the frame shows which), the anchor's cost against its value (item 4), whether an unanswered utterance should be asked a response of its own (item 8; parity says no), the restricted key (item 1); readiness narrowing for the other ported providers; OpenAI's own words reaching the notices verbatim (Translate's question, the same here).
  - **The deletion inventory, merged with OpenAI Translate's T3** (ruling 20; choice 23), after the WebRTC step's live test — `OpenAIWebRTCClient` imports `openAIRealtimeSession` and `EphemeralTokenService.getToken`, and `OpenAITranslateGAClient` imports `OpenAIClient`'s statics. T3's list as it stands, less its last item's condition — `settings.userTranscriptModel` and `settings.transcriptModelTooltip` are reused by OpenAI Realtime and stay — plus, read at `583df521`:
    - `OpenAIGAClient.ts`, `OpenAIClient.ts`, `OpenAIWebRTCClient.ts`, `openAIRealtimeSession.ts` (each + tests), `OpenAIProviderConfig.ts`, `OpenAICompatibleProviderConfig.ts`, `openaiTranscriptionContext.ts` (+ test), `src/utils/textUtils.ts` (+ test), `EphemeralTokenService.getToken`;
    - `settingsStore.ts`: the `openai` and `openaiCompatible` slices' readers (`:285-287, 415-417, 700-702, 967-969, 1535-1537, 1619-1621`), `migrateDeprecatedOpenAIModel` (`:556-588`, its call at `:1339-1345`), `forceWebrtcTurnDetectionOff` (`:647-653`), the model auto-select (`:1174-1191`), Translate's key prefill from the OpenAI slice (`:753-773`), `useTransportType` (`:1553`) — the storage keys stay;
    - `src/types/Provider.ts:15, 32-42` (Compatible's id, `OPENAI_COMPATIBLE_PROVIDERS`, `isOpenAICompatible`; `Provider.OPENAI` at `:9` stays, the live provider's id) — the three ruling-1 cases that name `Provider.OPENAI_COMPATIBLE` (`providerPaths.test.ts` twice, `useApplySetup.test.ts`) switch to the string `'openai_compatible'` (cast), and stay;
    - `ProviderConfigFactory.ts:3, 5, 62, 75-78`; `src/services/providers/tutorialUrls.ts:18` (Compatible's guide; `:15`, OpenAI's, goes only with the map's last old reader — the new definition carries its own `guideUrl`); the old UI's branches (`ProviderSpecificSettings.tsx:60, 385-387, 414, 424-426, 443-445`; `LanguageSection.tsx:128, 142-148, 237-243`; `ProviderSection.tsx:70-72, 462-468, 647`); and the old tests of the old code naming either id (`command grep -rln "Provider.OPENAI\b\|OPENAI_COMPATIBLE" src`, less the tests of live code: `providerPaths`, `setupDraft`, `lib/setup/providerPath`, `Tour/steps`, `tourContext`, `kizunaProviders`, `useApplySetup`);
    - `providers.openaiCompatible.*` in 30 catalogs; `openai-realtime-api` in `package.json` (`:189`) and the lockfile;
    - **keep:** `LEGACY_SLICE_KEYS` (`src/lib/session/storedSettings.ts`), so a stored selection of either still resolves.
  - **The roadmap's inheritance, item by item,** and **what it leaves:** the two tables below, as landed.
- [ ] **Step 3: Commit.**

```bash
git add docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md
```

```bash
git commit -q -F - -- docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md <<'EOF'
docs(spec, roadmap): OpenAI Realtime's amendments and its live test

Compatible retired, readiness narrowed to what a check reads, stated
pairing by item id, the drift anchor kept, arrival karaoke's second
exception; the owner's live test and the deletion inventory merged with
OpenAI Translate's T3.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

## The roadmap's inheritance, item by item

Taken (and where), deferred (and why), or already done.

From "Scheduled by the Stage 2 foundation plan" (`:1291-1296`) and plan 1d-1 (`:472-473`):

| Item | Disposition |
|---|---|
| F15, the processed WebRTC track | the WebRTC step: this port is WebSocket (ruling 12) |
| The D25 participant-leg fix | the WebRTC step, with `turns(s)` (ruling 12); the spec's open question moves with it (amendment 6) |
| `busy`'s reader | closed by ruling 8: the adapter owns the queue; `busy` is still emitted (Task 11) |
| The drift anchor | built (Tasks 6, 11; ruling 2) |
| OpenAI's model migration | not ported (ruling 5; choice 4): a stated departure |
| `turnDetectionMode` → `autoDetection` through `legacyKeys` | replaced: the field stays, `'Normal' | 'Semantic'` (choice 4); the spec amended (amendments 3, 11) |
| Compatible's `i18nKey: 'openaiCompatible'` | n/a: retired (ruling 1); the type's comment corrected (Task 3) |

From the Soniox plan's "Found here" (`:1740-1747`):

| Item | Disposition |
|---|---|
| Readiness re-probes on every settings edit | met for OpenAI Realtime by `checkReads: []` (Tasks 3, 12; ruling 9); the others may declare theirs |
| `timing` after a 503 resume | n/a: no timing, no resume |
| `audio.range` after fill-in | applies: arrival ranges, restated within the final text through `speechRanges` (choice 9), re-anchored by L1 |
| The side latch | n/a: one leg per socket |
| Two TTS sockets per key in shared Both | its analogue, two sessions on one key, is live-test item 23 |
| `Conversation.afterAudio`'s pending drop | n/a: a translation opens at its assistant item, before its audio |

From "Scheduled by the Stage 2 Gemini plan" (`:3005-3022`, `:3082-3093`):

| Item | Disposition |
|---|---|
| Leading audio: open the translation segment on audio | done here by construction: it opens at its assistant item or its first content (choice 8) |
| Name the leg in `SessionContext` | stays out (ruling 21): the anchor carries no leg name |
| The readiness re-check on each instruction edit | closed for OpenAI Realtime (ruling 9); Gemini's own stays its open question |
| `session.closed` on Stop | the same: nothing after stop |
| The instructions of later ports | taken: Gemini's `InstructionsSettings`, `InstructionsField` and legacy keys (Tasks 5, 10) |

From "Scheduled by the Stage 2 Volcengine AST2 plan" (`:3744-3835`):

| Item | Disposition |
|---|---|
| F14's owner, OpenAI Live | unchanged: `socket.ts` copied, to move with the others (choice 5) |
| Generic frame names grouped under Doubao's Logs keys | met: Task 4 pins it |
| A kit-wide "no ws(s) URL in a frame" rule | n/a: the URL carries no credential, and no frame carries the protocols (Task 11's no-leak case) |
| Each check opens a real session | n/a: a free model list |
| Superseded checks are never aborted | applies, harmlessly; rarer with `checkReads: []` |
| Dialect sources offered where the gate refuses them | n/a: every language is a target |
| `trackedClock`; the seam's fixed words | consumed (Tasks 6, 11) |

From "Scheduled by the Stage 2 OpenAI Translate plan" (`:4321-4340`, `:4357-4367`, `:4428-4441`):

| Item | Disposition |
|---|---|
| `pcmToBase64` / `base64ToPcm` at their third user | done (Task 1; choice 1) |
| A shared `boundedFetch` | done (Task 2; choice 2) |
| The kit-level seeded lifecycle scenario | deferred to the WebRTC step (choice 21); the queue's own seeded test here (Task 8) |
| T3 | merged with this port's deletion (ruling 20; Task 13's inventory) |
| The transcript field | built in the folder (Task 10); T3's orphan keys it reuses stay |
| The transport field | still the WebRTC step's (ruling 12; choice 18) |
| A restricted key's fallback | parity here too (ruling 17) |
| OpenAI's own words in the notices | the same here (`errorWords`); carried as an open question |
| `ERROR_WORDS_MS` and a negative age | consumed (ruling 13) |

## What this plan leaves

- **The merged deletion plan** — OpenAI Translate's T3, OpenAI Realtime's and OpenAI Compatible's old code, `textUtils.ts`, `openaiTranscriptionContext`, the `openai-realtime-api` dependency — after the WebRTC step's live test (ruling 20; Task 13's inventory).
- **The WebRTC step, for both OpenAI providers:** Realtime's transport and its dispatch in `start`, `C.transport` widened from `S.transportType`, D25's `turns(s)` and the participant's transport, the transport control, the ephemeral token, and the kit-level seeded lifecycle scenario (choice 21).
- **Readiness narrowing for the other ported providers:** each declares its `checkReads` in its own change, with a case like Task 12's.
- **The copies to lift:** `socket.ts` with F14; `decodeServerEvent`, `errorCode` and `errorWords` at a third user, or after Translate's live test.
- **The owner's open questions,** each with the live-test item that settles it.
- **Nothing on the old code:** the old descriptors, clients and slices stay compiled and unreachable, as the protocol documentation.

## Self-review

- **Spec coverage.** "L0 — the client contract" and "What every adapter must honour": conformance in Task 11 (every kit scenario but reconnecting), `appendText` answered by the adapter (Tasks 7, 11), `busy` (Tasks 8, 11). "Turns": both modes, `endTurn` / `cancelTurn` (choice 12), the participant automatic with the user's detection (ruling 4). "The session request": D20 for `AUTO` (Task 12's case), `describe` (choice 20). "Provider capability": stated pairing and arrival ranges (Tasks 7, 11). "The provider definition": the anchor (Task 11), `start` owning the transport (choice 18), `checkReads` (Task 3). "Readiness is one check": bounded (Tasks 2, 9), the effective model (Task 5), narrowed (Tasks 3, 12). "Languages are two functions": `AUTO` first (Task 5). "Sockets": the subprotocol and its seam (Task 6). "Segmentation is one fact": `'provider'` (Task 12). "Persisted settings that move": the turn mode, the instructions, the transport (Tasks 5, 12). "Testing": conformance and the queue's seeded test. The spec's corrections: Task 13.
- **Placeholders.** None: every code block is the tested scratch copy's file or diff. The one template is the commit messages' `<implementing model>`, which Global Constraints says to fill in; Task 13's record fills its numbers from the run.
- **Type consistency.** Checked against the scratch copy, where every file compiled at the gate: `RealtimeSettings`, `RealtimeCredentials`, `RealtimeConfig`, `TurnDetection`, `TranscriptionHint`, `buildRealtime`, `describeRealtime`, `effectiveRealtimeModel`, `takesReasoning`, `isRealtimeModelId`, `realtimeUrl`, `realtimeProtocols`, `sessionUpdate`, `responseCreate`, `requestOf`, `anchorResponse`, `isOutOfBand`, `RealtimeItems`, `ResponseQueue`, `Request`, `ACTIVE_RESPONSE`, `createRealtimeCheck`, `checkRealtime`, `createRealtimeAdapter`, `openaiProvider`, `startRealtime`, `liveRealtime`, `boundedFetch`, `pcmToBase64`, `base64ToPcm`, `checkReads` — each spelled the same in every task that names it.
- **Choices made inside the rulings:** 1–24, listed above; each is cited where it lands.
- **Departures, stated in the plan:** OpenAI Compatible withdrawn (ruling 1); a stored `'Disabled'` turns to automatic (ruling 5); the model migration not ported, an unlisted stored model running as the default model — a `gpt-realtime-mini` user may land on the full model (choice 4); the temperature gone (ruling 6); the participant's detection changed (ruling 4); `response.create` with `metadata.request` (choice 10); the anchor without `sessionType` (choice 11); `session_expired` ending the run at once as the segment's end (choice 14); an `aria-label` on the new selects (choice 17).
- **Departures from the survey:** §2.3's `autoDetection` field with a `legacyKeys` entry, and its copied model migration, are replaced by keeping `turnDetectionMode` and converting nothing (the principle of ruling 5; choice 4); the survey's one pairing-and-queue module is two, `items.ts` and `queue.ts` (each pure, each with its own test); its `busy`-reader item is closed by ruling 8 while `busy` is still emitted; its group B is dropped by ruling 1; `buildInputAudioTranscription` becomes `buildTranscriptionHint` with a required model, and the reverse helpers are not copied (choice 5).
- **Departures from the brief:** none in the rulings. The brief's "decide whether the kit-level seeded lifecycle scenario lands here" is decided against (choice 21), with the queue's seeded test in its place. Beyond the order pins, six existing cases across four files named `openai` as an unregistered provider; Task 12 moves them to `openai_compatible` — test edits the brief did not list, needed by registering `openai`. `ModelConfigurationField` (a shared field) gains an optional temperature, needed by ruling 6.
