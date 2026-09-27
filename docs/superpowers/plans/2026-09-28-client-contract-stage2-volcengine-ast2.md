# Client contract — Stage 2, provider 4: Doubao AST 2.0 (`volcengine_ast2`, own key)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Standing of the rulings below.** Rulings 1–5 are **the owner's decisions** (2026-09-28, in conversation): two credential modes, the legacy App ID + Access Token and the new API Key (ruling 1); the credentials in the socket's query, as his probe measured (ruling 2); the languages per mode as Volcengine documents them (ruling 3); the participant speaking when its switch is on (ruling 4); the registry position after Gemini, before Soniox, unflagged (ruling 5). Rulings 6–14 are the controller's technical rulings, from the survey's recommendations. Where a ruling left a sub-decision to this plan ("design it against the contract's language API", "say which sub-mode", "say what becomes of F14"), the answer is a numbered *choice* below, and the self-review lists each one.

**Goal:** Doubao AST 2.0 — Volcengine's simultaneous interpretation — with the user's own credentials (`volcengine_ast2`) on the new contract: its definition, settings, credentials in two modes, languages per mode, a bounded handshake check, builder, adapter and settings view, so the owner can run it live. Concretely:
- the generated protobuf codec moved into the provider's folder (F18), the old client reaching it through a re-export;
- the credentials in the socket's query (ruling 2): a plain `openSocket(url)` as Soniox's and Gemini's, no header seam (F14 is not built), no background or DNR change, and the provider on the web as well; the query's three credential names join the shared redaction list;
- two credential modes (ruling 1) through a credential choice both credential forms draw above the fields — Settings' and the setup wizard's (F4 — AST2 its first user, Palabra's platform/app toggle next);
- a language context in the contract (choice 1): Doubao speaks eight languages and transcribes twenty and two dialects (ruling 3), so `sources` / `targets` take whether the run would speak; the provider store keeps the pair the user left and derives from it the pair a run can start, so a mode switch writes nothing and loses nothing;
- the adapter: a streaming 24→16 kHz resampler in 80 ms packets (ruling 12), a keepalive that sends silence only after a real idle (ruling 7), the 500 ms push-to-talk tail (ruling 6), subtitles to segments, each spoken sentence one rangeless clip on the translation started when the sentence starts, with the decodes in order (ruling 10), a mid-session status ending the run with its code (ruling 8); the check one real handshake (ruling 9);
- pairing inferred by L2 through the Gemini plan's windowed F16, every subtitle frame carrying its `Sequence` and times so a later plan can state origins instead (ruling 11);
- the shared `TextField`, Doubao's own settings view, the fake's `proximity` script (inferred pairing in the preview), `trackedClock` in the kit, and the registration after Gemini (ruling 5).

The plan ends with the controller's docs task (ruling 14) and the owner's live test. **Deleting AST2's old code — together with the relay twin `kizunaai_volcengine_ast2`, which the owner has ruled is deleted, not ported — the AST2 background block and the dead flags is a later plan ("V2")**, written after the live test; this plan records its inventory only.

**Architecture:**
- **One folder,** `src/providers/volcengine_ast2/`:
  - the definition's data — `settings.ts` (`S`, its migration, the credentials `K` with their choice, the languages per context), `config.ts` (`C`, `build`, `describe`), `check.ts` (one bounded handshake);
  - the session side — `socket.ts` (the socket seam), `wire.ts` (the URL, the three client frames, decoding; pure), `audioIn.ts` (resampler and pacer; pure), `segments.ts` (subtitles → segments; pure), `speech.ts` (spoken sentences, decoded in order; pure), `decode.ts` (the default Ogg decoder), `adapter.ts` (one leg), and `proto/` (the generated codec and its schema, moved here);
  - `Ast2Settings.tsx` and `provider.ts`; `testing.ts` holds the suites' fixtures.
- **Shared pieces built here:** the language context (`LanguageContext` in the contract, `languageContext` beside `contextsFor`, the provider store's `speech` and `stored`, `watchSpeechFromStores`); the credential choice (`CredentialChoice`, drawn by `CredentialChoiceControl` in `CredentialForm` and the wizard's credential step, written by `ProviderPicker` and at the wizard's Finish); `TextField`; `trackedClock` in the kit; the fake's `proximity` script.
- **Two contract changes:** `languages.sources` / `targets` take an optional `LanguageContext`; `credentials.choice?`. Nothing in `src/lib/contract/adapter.ts` or the runner changes: AST2 needs no hook, no `startBoth` and no new event.
- **The old AST2 code stays compiled and unreachable** (`VolcengineAST2Client`, its two descriptors, the language sync, the old settings UI's AST2 branches, the two store slices, the extension's DNR block) — V2's.

**Tech Stack:** TypeScript (strict), React 19, zustand, i18next, protobufjs (the generated static codec), Vitest + @testing-library/react (jsdom), `sass` (compiled-stylesheet assertions), the adapter test kit (`FakeSocket`, `driveAdapter`, `runScenario`, the virtual clock), headless Chromium over the DevTools protocol (`scripts/dev/headless.mjs`) at the group checks.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — the binding authority, as amended by the Stage 2 foundation, Soniox, Kizuna Soniox and Gemini plans (above all "Readiness is one check": **`check` bounds its own request**). The parts this plan implements: "L0 — the client contract" and "What every adapter must honour"; "Turns" (AST2's rows); "Provider capability" (AST2's row); "The provider definition" (one own-key provider with two credential modes); "Languages are two functions" (an offer that depends on whether the run speaks); "Sockets that need upgrade headers" (AST2 needs none); "Segmentation is one fact" (`'provider'`); "L2 — the projection" (inferred pairing); "Testing" (conformance). It amends the spec in Task 18.

**Research notes:**
- **The survey this plan is written from:** `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/stage2-volcengine-ast2-survey.md`, cited as *survey §x*: §0 (findings), §1 (the old implementation as protocol documentation), §2 (the mapping), §3 (the outline, the shared files, the risks, the spec statements it refines). It was read at `aa3d7b18`, B1 in flight; every file:line this plan relies on was re-read at `3665711d`. `AST2C` = `src/services/clients/VolcengineAST2Client.ts`, `AST2D` = `src/services/providers/VolcengineAST2ProviderConfig.ts`.
- **The owner's probe** (2026-09-28, real credentials, Node `ws`, `StartSession` s2t zh→en, then `FinishSession`) — what ruling 2 rests on:
  - the legacy headers `X-Api-App-Key` (the old code's name) and `X-Api-App-Id` (the documentation's), `X-Api-Access-Key`, `X-Api-Resource-Id: volc.service_type.10053` → `SessionStarted`;
  - the legacy query `wss://openspeech.bytedance.com/api/v4/ast/v2/translate?api_resource_id=volc.service_type.10053&api_app_key=<APP>&api_access_key=<TOKEN>` → `SessionStarted`; a wrong token → HTTP 401 `{"error":"load grant: requested grant not found in SaaS storage"}`;
  - the API key as header `X-Api-Key` or query `?api_resource_id=…&api_key=<KEY>` → `SessionStarted`; a wrong key → HTTP 401 `{"error":"Invalid X-Api-Key"}`;
  - no credentials → HTTP 400 `{"error":"get resource id empty"}`.
- **Volcengine's language rules** (docs.volcengine.com/docs/DoubaoVoice/SimultaneousInterpretation20APIAccessDocumentation, read 2026-09-28): S2S — zh, en, de, fr, es, id, ja, pt; its designated-voice mode "目标语种必须为中英", its voice-clone mode "源语种或目标语种必须是中英"; `zhen` supported. S2T — those eight and ko, tr, ms, nl, ro, pl, cs, ar, th, vi, ru, it, plus the dialects Cantonese `yue-CN` and Shanghainese `sh-CN`, "方言，仅支持作为源语种"; "源语种或目标语种必须是中英"; `zhen` supported. `zhen` is passed as both `source_language` and `target_language`.
- **Found while writing** (at `3665711d`):
  - **The S2S sub-mode is voice cloning.** The old client sends no `speaker_id` (`ast_service.proto:13` declares it; `AST2C:488-499` fills mode and languages only) and says why: "No voice selection - server auto-clones speaker voice in s2s mode" (`AST2D:129`). Voice cloning's rule — Chinese or English on one side — is S2T's rule too: one rule serves both modes, and only the language sets differ (ruling 3).
  - **The generated declarations type the codec.** `ast2-proto.d.ts` sits beside the `.js`, and a `.js` specifier resolves to it (checked: a wrong field type fails the typecheck). The old client's `@ts-ignore` (`AST2C:40`) is not needed, and the new code has none (survey §1.18.14).
  - **protobufjs hands a `bytes` field as a Node `Buffer` under vitest**, whose `slice` returns a view, not a copy. Every copy in this plan is `new Uint8Array(view)`, which copies everywhere.
  - **`logStore` merges consecutive events of one type only:** the grouping compares `eventType` as well as the key (`logStore.ts:525-531`), so the old AST2 rows never merged a `SourceSubtitleStart` with its `…Response`. This plan's rows keep the rule, and their test says so.
  - **`SharedSettings.reversed` cannot tell a `zhen/zhen` pair's legs apart:** the pair is its own reverse, so both legs read as the participant's. A builder cannot drop the participant's libraries without a leg identity it does not have (choice 6).
  - **The wizard's credential step draws its own fields** from the saved settings (`StepCredentials.tsx:98`), not through `CredentialForm`, and writes nothing until Finish (`applySetup.ts:1-7`), so the credential choice needs its own place there: the draft holds the pick and Finish writes it (Task 17; the controller's ruling on review I2).
  - **Two scratch copies of the tree** (outside the repository, 2026-09-28) ran every code and test block below before it was written down. The first, at `3665711d`: each task's tests passed there, together with the suites its change could reach, and the typecheck added no line but the ones its stand-in for the Gemini plan's `SharedSettings.instructions` removal produced in Gemini Task 4's own files. The second added the Gemini plan's landed Tasks 1 and 3 (`f979db5c`, `75a5c343`) and its Task 4's edits as that plan writes them: every diff below whose file the Gemini plan changes was generated there, and the stores', sessions', views', providers' and wizard's suites passed on it, with no typecheck line in this plan's files. Gemini's later tasks (5–14) exist in neither: a text this plan quotes from a file they create or edit is quoted from the committed plan (`a7810bde`).
- **The roadmap:** `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` — "Scheduled by the Stage 2 foundation plan" → Volcengine AST2 (`:1287`: F14, the socket seam; F16, windowing), OpenAI Translate (`:1289`: F16 if AST2 did not land it), OpenAI Live (`:1304`: F14 reused); the Soniox plan's "Found here" (`:1740-1747`) and "Before any release" (`:1751-1765`); the Kizuna Soniox plan's "Before any release" (`:2318-2343`, the relay twin deleted, not ported, `:2334`) and "Found here" (`:2494`). The section "The roadmap's inheritance, item by item" below carries each.
- **The Gemini plan** (committed as `a7810bde`, executing before this one; its Tasks 1 and 3 have landed as `f979db5c` and `75a5c343`): `docs/superpowers/plans/2026-09-28-client-contract-stage2-gemini.md`. What this plan takes from it is listed, by that plan's names, in "What this plan consumes from the Gemini plan".
- **Form models:** `docs/superpowers/plans/2026-09-26-client-contract-stage2-soniox.md` (Plan A) and `docs/superpowers/plans/2026-09-27-client-contract-stage2-kizuna-soniox.md` (Plan B1).

## Global Constraints

- **Starting point.** `worktree-client-contract-stage2` once the Gemini plan's Tasks 1–14 have landed on `3665711d`. Every task anchors its edits by content, not by line: a line number cited here was read at `3665711d` (or at `f979db5c` where the text is the Gemini plan's landed code), and a text quoted from a file the Gemini plan edits is quoted as that plan writes it — where the landed text differs, the implementer anchors on the landed text and says so in the report.
- **Settled before dispatch** (review M8): the owner's API-key probe did **not** carry `requestMeta.AppKey` — the controller's probe script (`/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/ast2-auth-probe.mjs`) sets `AppKey` only for the legacy cases, and its API-key cases K1 (header) and K2 (query `api_key`) both answered `SessionStarted`. Choice 5 is confirmed: an API-key session starts with no `AppKey`.
- **Edits shown as diffs.** A change to an existing file is shown as a unified diff with its context lines, from the scratch copies (research notes). Its hunk headers count the lines of the file as the Gemini plan leaves it: `f979db5c` for the files its landed Tasks 1 and 3 changed (`types.ts`, `providerStore.ts` and its test, `logStore.ts` and its test), with its Task 4's edits added to `types.ts`, `appShape.ts` and its test, `shape.test.ts` and `soniox/testing.ts`; `3665711d` for every other file. Apply a hunk by its content all the same; where the Gemini plan's later tasks change a context line, the step names the anchor to use.
- **What this plan touches:**
  - `src/services/clients/volcengine-ast2/**` (moved out; two re-export stubs left in its place) and `src/providers/volcengine_ast2/**` (new) — Tasks 1, 6–8, 12–16;
  - `src/lib/diagnostics/redact.ts`, `src/stores/logStore.ts` and their tests — Task 2;
  - `src/lib/provider/types.ts`, `src/lib/provider/languages.ts` (+ test), `src/lib/session/shape.ts` (+ test) — Task 3; `src/providers/registry.test.ts` — Tasks 3, 10, 16;
  - `src/components/providers/fields/TextField.tsx` (+ test) — Task 4;
  - `src/providers/fake/scripts.ts` (+ test) — Task 5;
  - the 30 catalogs `src/locales/*/translation.json` (one key) — Task 6;
  - `src/stores/providerStore.ts`, `src/lib/session/appShape.ts`, `src/app/session.ts` and their tests — Task 9;
  - `src/components/providers/CredentialChoiceControl.tsx` (new), `src/components/providers/{CredentialForm,ProviderPicker}.tsx` (+ tests), `src/components/Settings/Settings.scss` — Task 10;
  - `src/components/providers/{LanguagePairSection,ProviderLanguages}.tsx` (+ tests), `src/components/SetupWizard/steps/StepLanguagePair.tsx` (+ a new test) — Task 11;
  - `src/lib/contract/testing/trackedClock.ts` (+ test), `src/providers/soniox/testing.ts`, `src/providers/gemini/testing.ts` — Task 12;
  - `src/providers/sessionSide.consistency.test.ts` — Task 15;
  - `src/providers/registry.ts`, `src/components/SetupWizard/providerPaths.test.ts`, and the Gemini plan's order case in `src/providers/gemini/provider.test.ts` — Task 16;
  - `src/components/SetupWizard/{setupDraft,applySetup,useApplySetup}.ts` (+ tests), `src/components/SetupWizard/steps/StepCredentials.tsx` (+ test) — Task 17;
  - the spec and the roadmap — Task 18.
- **Read only.** `src/services/**` beyond Task 1's move and stubs (the old client, its descriptors, the language sync, the relay twin — ported by copying, never imported); the old settings UI (`ProviderSpecificSettings.tsx`, `ProviderSection.tsx`, `LanguageSection.tsx`); `src/stores/settingsStore.ts` (the text-only switch is read through `appShape`, as today); `electron/**` and `extension/**` (ruling 2: no header seam, no DNR change, and the manifest already lists `wss://openspeech.bytedance.com/*` and its CSP origin, `extension/manifest.json:37, 116`); `package.json` and the lockfile. `npx vitest run src/services` stays green — the old AST2 client through the stub.
- **Import rules:**
  - `src/lib/**` never imports React or `src/app/**`. `src/lib/contract/testing/**` is test-only; so are `src/providers/volcengine_ast2/testing.ts` and the fixtures it serves.
  - A provider's session side — `adapter.ts` and every file of its folder it reaches by a value import — imports no store and no reporter and runs no global timer: every timer reads the request's clock (`clock.setTimeout`, `every(clock, …)`, `clock.now()`). Doubao's session side is `adapter.ts`, `audioIn.ts`, `decode.ts`, `segments.ts`, `socket.ts`, `speech.ts`, `wire.ts` and `proto/ast2-proto.js`; `adapter.ts` and `wire.ts` import `config.ts` and `settings.ts` **as types only**. `check.ts` is the settings side and keeps its own clock; nothing on the session side imports it (the refusal sentence both use lives in `wire.ts`).
  - New code imports nothing from `src/services/**` or `src/stores/settingsStore` — Task 1's codec test is the one reader of the old path, as the stub's pin; `appShape.ts` already reads the settings store and keeps doing so.
  - Both fakes reach a bundle only through the registry's `import.meta.env.DEV` literal (D24).
- **Diagnostics** (CLAUDE.md, "Error Handling"): the adapter never reports and never logs; it says what happened through `failed`, `closed`, `degraded` (`parse_error`, `tts_degraded`) and `frame`. A socket's `error` event is a Logs-only frame. The check throws when it could not find out; the readiness store reports it.
- **The socket URL carries a credential** (ruling 2). It is never put in a frame, an error, a notice or a log line of ours; `redact()` masks `api_app_key`, `api_access_key` and `api_key` wherever it reaches a sink anyway (Task 2). A browser prints a failed socket's URL in DevTools' own console — not a sink of ours, recorded as an open question.
- **Frames** (choice 9) are `domain.event`, never audio, never a credential, never the URL or `requestMeta`: out — `session.start`, `audio.idle`, `audio.resumed`, `turn.tail`; in — `session.started`, `session.status`, `session.failed`, `session.finished`, `session.canceled`, `session.usage`, `session.audio_muted`, `session.unknown`, `session.unreadable`, `session.foreign`, `session.socket_error`, `session.connection_lost`, `subtitle.source`, `subtitle.translation`, `tts.sentence_start`, `tts.sentence_end`, `tts.ended`. No frame per audio packet or per `TTSResponse` chunk (the hot-path rule).
- **Locales.** One new key, `providers.volcengine_ast2.authModeApp` ("App ID + Access Token"), in all 30 catalogs, its values composed from each catalog's own `setup.credentials.appId` and `.accessToken` (Task 6 lists them); the API key option reads the existing `setup.credentials.apiKey`. Every other word is an existing key: `notices.<code>` for `auth`, `network`, `client`, `server` and `credentials_missing`; the aliases `connection_lost` and `tts_degraded`; the view's `settings.volcengineAST2*` keys, `providers.volcengine_ast2.{name,description,appIdPlaceholder,accessTokenPlaceholder}`, `setup.credentials.{appId,accessToken,apiKey}`, `simpleSettings.apiKeyPlaceholder` (checked present in all 30 catalogs at `3665711d`). Language names are the lists' own strings, not locale keys (choice 17): Cantonese reuses the shared registry's `粵語 (cantonese)` (`utils/languages.ts:62`), and `上海话 (Shanghainese)` is new. Both, and the new key's 30 values, go to the owner's native-speaker spot check; the ja and zh_CN values drop the parenthesised English their catalogs' own labels carry (`アプリ ID（App ID）`, `应用 ID（App ID）`).
- **No network (ruling 13).** No test, probe or step calls Volcengine. The adapter and the check are tested over `FakeSocket` on a virtual clock with an injected decoder; the codec over its own encode and decode. No group check types a credential into Doubao's fields or presses Start with Doubao selected: its readiness check would open a real session 800 ms later.
- **Gates for every task:**
  - **The suite.** `npx vitest run src` shows 0 failed and no unhandled errors. Measured at `3665711d` on 2026-09-28: **494 test files passed and 1 skipped (495); 6 314 tests passed and 2 skipped (6 316); no unhandled errors.** This plan starts after the Gemini plan: the controller records the counts at that commit before Wave 1; the gate is the rule, not the numbers.
  - **The typecheck.** The gate prints exactly the baseline lines below. The shell's `grep` is a ugrep wrapper that mis-parses this regex, so use `command grep` exactly as written. The regex is the Gemini plan's, widened by the files this plan edits outside it — `lib/diagnostics/redact` (Task 2), the old client and the codec stub's declarations (`services/clients/(VolcengineAST2Client|volcengine-ast2/ast2-proto\.d)`, Task 1), `StepLanguagePair.test` (Task 11), and the wizard's draft, its Finish and their tests (`SetupWizard/(setupDraft|applySetup|useApplySetup)(\.test)?\.ts`, Task 17); none of them has an error at `3665711d`. Everything else this plan creates or edits is already inside it (`lib/(provider|session|contract|diagnostics)`, `providers`, `components/(providers|SetupWizard/…)`, `stores/(providerStore|logStore)`, `app/`).

    ```
    npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts|diagnostics/(consoleLedger|clientDiagnostics|redact))|lib/modern-audio/BaseAudioRecorder|providers|services/(clients/(SonioxSttStream|SonioxTtsStream|PcmMixer|SonioxSideTracker|SonioxTtsRest|SonioxVoicesClient|SonioxClient|ManagedVoicesClient|managedVoicePolling|VolcengineAST2Client|volcengine-ast2/ast2-proto\.d)|providers/(SonioxProviderConfig|KizunaAISonioxProviderConfig|managedVoicePrep|managedVoicePrep\.test|prepareToStart\.kizunaSoniox\.test))\.ts|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|MainPanel\.|panel/|SessionCountdown)|MainLayout/(MainLayout|useSignInProviderSwitch)|Settings/(Settings\.tsx|ProviderArea|SimpleSettings/SimpleSettings\.tsx|AdvancedSettings/AdvancedSettings\.tsx|sections/((SpeechSection|VoiceLibrarySection)(\.test)?\.tsx|(ParticipantSpeechSwitch(\.test)?|SentenceSegmentationSection|SystemAudioSection|SonioxVoiceSection|ProviderSpecificSettings)\.tsx|voiceLibrarySource(\.test)?\.ts))|SettingsInitializer/|SetupWizard/(SetupWizard(\.test)?\.tsx|(setupDraft|applySetup|useApplySetup)(\.test)?\.ts|providerPaths(\.test|\.managedFit\.test)?\.ts|steps/(StepLanguagePair|StepLanguagePair\.test|StepCredentials|StepCredentials\.test|StepFinish|StepProviderPath|StepScenario)\.tsx)|TitleBar/(AccountButton(\.test)?\.tsx|useBalanceShortfall)|Tour/useStartBasicsTour\.ts|dev/(SpinePreview|SessionControls|OverlayPreview|wireTally|gapCounter))|contexts/UserProfileContext|locales/(index\.ts|showLanguageUncached)|routes/Home\.tsx|stores/(providerStore|turnModeStore|routingStore|accountStore|logStore|settingsStore\.ts)|utils/(environment|conversationExport)|subtitle-overlay-entry|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
    ```

    **The baseline** — exactly these **20** lines, measured at `3665711d` (the Gemini plan's own 20, which that plan adds none to; 259 lines in the full tree):

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

    Do not fix them; do not add to them. `logStore.ts` (Task 2) keeps its two lines' content untouched.
  - **Gates in a parallel wave** (as Plans A, B1 and the Gemini plan). Waves run tasks at once in this one working tree, so each task sees the others' red phases:
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
  - The AST2 check (group check B): `command grep -rlF 'audio.idle' build extension/dist` names at least one file under `build/` and one under `extension/dist/` — the new adapter shipped in both. Nothing under `src` holds that string at `3665711d` (checked), and this plan's `logStore.ts` rows do not name it.
- **Dev servers, probes and builds** are the controller's; an implementer never starts one. Checks run against a fresh vite: `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort --force`. Restart it after edits: a worktree's vite can serve stale transforms.
- **Shell forms.** This worktree's guard refuses compound shell forms: brace groups, loops, `cd … &&` chains. Every command in this plan is a single command or a plain pipeline, run as its own call from the worktree root. Use `command grep`. The shell is zsh: quote globs; `echo ====` is an error. Checks write their outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, never `/tmp`.
- **Commits:**
  - Conventional, in English. Every message ends with the implementing model's own `Co-Authored-By:` line, then `Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe`, and nothing after it. The examples below write the first as `Co-Authored-By: <implementing model> <noreply@anthropic.com>`: fill in your own model's name.
  - Run `git add <paths>`, then `git commit -q -F - -- <the same paths> <<'EOF' … EOF`, as two separate calls. The `--` pathspec is mandatory: parallel tasks stage into the same index. Never stage a whole directory that is not wholly the task's.
  - Never push.

## Rulings

Cited as *ruling N*. Rulings 1–5 are the owner's decisions (2026-09-28); 6–14 the controller's. Each is restated with where it lands.

1. **Two credential modes**, like the old Palabra settings' two auth modes (`ProviderSection.tsx:757-830`): the legacy **App ID + Access Token**, and the new console's **API Key**. A mode selector in the credential form; each mode's fields; `read` answers the credentials of the selected mode; `check` validates whichever is set. Existing stored App ID / Access Token keep working — the migration moves nothing (choice 2: an old profile, like a fresh one, reads the legacy mode). Lands in: Task 3 (`CredentialChoice`), Task 6 (`authMode`, the credentials, the one new key), Task 10 (the form), Task 16 (an old profile loads), Task 17 (the wizard's credential step and Finish), Task 18 (live-test items 1 and 16).
2. **Credentials ride in the URL query** (the owner's probe): a plain `openSocket(url)` like Soniox's — no header seam (F14 is not built here), no background or DNR change — and `platforms` gains `web`. The URL never appears in an error, a notice, a frame or a log line; `api_app_key`, `api_access_key` and `api_key` join the shared redaction list, additively, with a test. Lands in: Task 2 (redaction), Task 12 (`ast2Url`, `socket.ts`), Tasks 14–15 (errors in words, never the URL; frames checked), Task 16 (`platforms`), Task 18 (F14's fate; live-test item 2).
3. **Languages follow Volcengine's documented constraints per mode.** Speaking (S2S) offers its eight languages under the voice-clone sub-mode's rule — the old client sends no speaker id, so the server clones the voice (research notes) — Chinese or English on one side; text only (S2T) offers the twenty languages and the two dialects, dialects as sources only, under S2T's rule, the same; `zhen` both-or-neither in both. `sources` / `targets` depend on whether the session speaks: designed against the contract's language API as choice 1, a stored pair a mode switch leaves unoffered normalized by the spec's rule (`normalizePair`: keep what is offered, else the first) for what a run starts, and kept as the user left it. New display names: the catalogs' existing names; the two dialects' are new (choice 17). Lands in: Task 3 (the contract and the gate), Task 6 (the lists and rules), Task 9 (the store), Task 11 (the surfaces), Task 18 (live-test items 3–6).
4. **Participant speech** follows the participant-speech switch, as Soniox's and Gemini's — a stated departure: the old participant was text-only (every old descriptor's participant config forced `textOnly: true`, `src/utils/effectiveTextOnly.ts:11-14`). Nothing to build: the definition sets no `participantSpeech`, so `contextsFor` gives the participant `speech = participantSpeech`, and `build` runs a speaking leg `s2s`. Lands in: Task 6 (the builder's case), Task 16 (the participant case), Task 18 (live-test item 10).
5. **The registry position** follows the owner's product order: `RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, sonioxProvider]`, unflagged (D19). The old `VITE_ENABLE_VOLCENGINE_AST2` is dead since `cec1556c` (survey §0.11) and is not read. Lands in: Task 16.
6. **`endTurn` sends the 500 ms silence tail** (parity with the old push-to-talk finalization, `AST2D:174-176`), and so does `cancelTurn` — the old release sent it for a voiced and an empty press alike (survey §1.9). Lands in: Task 7 (`InputPacer.tail`), Task 15.
7. **The keepalive sends silence only after a real idle**, not on the old 60 ms threshold that splices zeros into speech (survey §0.6), pinned on the virtual clock. Lands in: Task 7 (`IDLE_MS`, `KEEPALIVE_MS`), Task 15.
8. **A mid-session status error → `failed` with its code.** Lands in: Task 12 (`statusFailureCode`), Task 15.
9. **`check`: one real handshake** (`StartSession` s2t + `FinishSession`, bounded) per check; a refused upgrade (401) → the auth words. Lands in: Task 14 (choices 8, 20).
10. **TTS per sentence as `ogg_opus`** (parity): one rangeless `audio` per sentence on the translation ref locked at `TTSSentenceStart` (replay yes, karaoke no) — the translation segment started then, shown or not, else the last one shown, as the old client and the survey lock it (the controller's ruling on review I3; L1 holds a clip for a segment not yet opened); decodes serialized through an injected decoder; the two old races (the ref read after the decode's `await`; unserialized decodes) not ported. Lands in: Task 8 (`Ast2Speech`, `decodeOggOpus`), Task 15.
11. **Pairing inferred** through the Gemini plan's F16, every frame logging `Sequence` and the start/end times, so a later plan can switch to a stated origin if the live test shows `Sequence` is per utterance (survey §0.4). Lands in: Task 8 (no origin), Task 15 (the frames; a projection case), Task 5 (the preview's script), Task 18 (live-test item 7).
12. **A streaming 24→16 kHz resampler with 80 ms packets** (survey §0.10). Lands in: Task 7.
13. **No network in tests**; timers on the virtual clock; the adapter over `FakeSocket`. Lands in: Global Constraints; every task.
14. **The last task is the controller's docs task** (Task 18): the spec's amendments (survey §3.6 and the query-auth fact, which removes AST2 as F14's first user — F14 goes to OpenAI Live), and the roadmap section "Scheduled by the Stage 2 Volcengine AST2 plan": what landed; the owner's live test (both credential modes, S2S and S2T with the full list, a dialect source, `zhen`, the push-to-talk tail, the keepalive during silence, Both with participant speech, web / extension / Electron, TTS replay); the stated departures; the open questions; the deletion inventory with the relay twin.

## Choices this plan makes inside the rulings

Cited as *choice N*.

1. **The language context** (ruling 3; Tasks 3, 9, 11). The contract's language functions take an optional last argument, `LanguageContext = { speech: boolean }` — whether the run would speak, any leg it opens producing audio. Without it, a provider answers its **widest** offer, every language any of its modes takes; every provider but Doubao ignores it. `languageContext(p, legs, { textOnly, participantSpeech })` sits in `shape.ts` beside `contextsFor`, over one shared `legSpeaks` rule, so the offer and the run's contexts cannot disagree. **The provider store keeps two pairs:** what the user left (`stored`, persisted, normalized within the widest offer) and what a run starts (`pair`, that pair normalized by `normalizePair` under the store's context); `stored` sits in the entry only while the two differ. A change of legs or speech inputs derives every `pair` again and **writes nothing**, so switching text only on and off never loses a text-only Korean pair; a pick, a settings edit and a load keep their existing writes. The inputs come from the stores through `watchSpeechFromStores` (the text-only switch, the participant switch and its source), started by `attach()` beside `watchLegsFromStores`. Settings' language section lists the offer for the store's context; the wizard lists the scenario's (its legs and text only, the participant switch as the stores hold it). The gate's D20 reads the participant leg's own context. A registry invariant holds every provider's offer under a context within its widest one, so the stored pair is always one the widest offer holds.
2. **The credential choice** (ruling 1; F4; Tasks 3, 6, 10). `credentials.choice?: { setting; options: { value; labelKey }[] }` names a field of `S` that decides which fields show; `CredentialForm` draws the options as the old Palabra group's segmented control above the fields (its markup, `ProviderSection.tsx:761-779`; its rules shared by adding `.credential-choice-group` beside `.palabraai-credentials-group` in `Settings.scss`) and `ProviderPicker` writes a pick through `updateSettings`, so the readiness driver re-checks the other fields. Switching clears no credential. Doubao's `authMode` is `'app' | 'apiKey'`, **`'app'` by default** — the setup guide the picker links describes the App ID and the Access Token, and an old profile, which has no `authMode` stored, reads the mode whose fields it holds with no migration. **The setup wizard draws the same control** (`CredentialChoiceControl`) above its credential fields, so a new user who holds only an API key sets Doubao up on first run: the draft holds the pick, the step shows and checks that mode's fields, and Finish writes it through `updateSettings` before the credentials (Task 17; the controller's ruling on review I2).
3. **Pairing** (ruling 11). Neither side states an origin, and **neither emits `timing`**: the old client never read the times, which timeline the translation's `start_time` / `end_time` count on is unverified, and with timing on both sides L2 would pair by overlap alone and never fall back to proximity (`pair.ts:38-43`) — so L2 pairs by proximity, windowed by the Gemini plan's F16. Every subtitle frame carries `sequence`, `startTime` and `endTime` for the live test to settle both questions.
4. **A status as a notice code** (rulings 8, 9). Volcengine's 8-digit codes put the client's faults in `4xxxxxxx` and the service's in `5xxxxxxx`; a status starting `4` is `client`, any other `server`, with the message `[Doubao <status>] <message>` as the `{{detail}}` of `notices.<code>`. Unverified against this endpoint: the live test collects the codes (item 12).
5. **`requestMeta.AppKey`** is sent in the legacy mode, as the old client did (parity, `AST2C:469-476`), and not in the API key mode, whose credential names no app — confirmed by the owner's probe, whose API-key cases sent none and started (Global Constraints, "Settled before dispatch").
6. **The libraries on both legs** (parity; survey §2.7, §1.18.15): the participant's reversed leg sends the speaker's hot words, replacement and glossary too. Dropping them there needs a leg identity `build` does not have — `shared.reversed()` is true for both legs of `zhen/zhen` (research notes). An open question.
7. **`describe(c)` is `{}`:** the old start reported no model for AST2, and there is none to choose.
8. **A socket that fails before it opens** (ruling 9; survey §2.4): a browser cannot see the upgrade's 401. Online, it is the credentials — the check answers `{ ok: false, code: 'auth', reason: REFUSED_UPGRADE }` and a start rejects with `auth` and the same words; offline (`navigator.onLine === false`), the check throws and a start rejects with `network`. A close **after** the socket opened and before `SessionStarted` is the service's: a start rejects with `server`, the check throws.
9. **Frames and the Logs' rows** (Global Constraints' list; Task 2). Subtitles, spoken sentences, usage and a muted microphone keep the old client's grouping keys; `audio.idle`, `audio.resumed` and `turn.tail` stay ungrouped, so the live test can count them. No `session.closed` on Stop: the kit forbids emissions after it.
10. **The keepalive and the tail** (rulings 6, 7). `every(request.clock, 80, tick)`; a tick sends one 80 ms silent packet only once no audio went out for `IDLE_MS` = 250 ms (three capture periods of 85.3 ms) and does not restamp, so silence flows at real time only while nothing real does; `audio.idle` frames the first silent packet of an idle, `audio.resumed` the first real chunk after it. An idle's first tick first sends what the pacer still holds, as one short packet, and drops the resampler's carry (`InputPacer.drain`), so no speech from before the idle goes up after its silence (review M1). A release under manual turns sends what waits as one short packet, then 500 ms of silence at once (six 80 ms packets and a 20 ms one), frames `turn.tail`, and restamps; under automatic turns the turn keys send nothing.
11. **The resampler** (ruling 12): three input samples give two — the first as it is, the mean of the next two — which is the old code's linear interpolation at steps of 1.5 without its per-chunk phase reset and floor; what does not fill a group waits for the next chunk, and a release drops it (under three samples). No low-pass filter beyond that: the old code had none, and a filter would change what the server hears in a way the live test could not tell from the keepalive fix (an open question).
12. **Timeouts:** the start keeps the old 30 s (`AST2C:438-448`, now `START_TIMEOUT_MS` on the request's clock) — `network` when the socket never opened, `server` when it did; the check waits 15 s, as Soniox's and Gemini's.
13. **Doubao's own `socket.ts`**, three declarations as Soniox's and Gemini's (Gemini choice 20). With the query carrying the credentials, **F14 is not AST2's**: its first user becomes OpenAI Live, whose header need is unchanged, and the three plain `socket.ts` move to `src/lib/contract/` with it.
14. **`trackedClock` moves to the kit** (`src/lib/contract/testing/trackedClock.ts`): Doubao is its third user, which Gemini choice 21 named the moment to promote it. Soniox's fixtures re-export it; Gemini's import it and export the local binding, which their own harness (`startGemini`, Gemini Task 11) calls.
15. **The fake's `proximity` script** (Task 5): Doubao's shape — no origin, no timing, one rangeless clip per spoken sentence after its translation closed — so the preview shows inferred pairing, which the Gemini plan left to "the next provider whose origins L2 infers". The fake's `framed` script already states no origin, but carries timing on both sides and pairs by overlap.
16. **`TextField`** (Task 4): the old library-id rows' markup (a label, its tooltip, a right-aligned external link opened by `openExternalUrl`, a single-line input) as a shared field beside `LinesField` and the Gemini plan's four.
17. **Language names:** the eight spoken languages keep the old list's names (`AST2D:112-121`); the twelve more are the shared registry's (`utils/languages.ts` `LANGUAGE_OPTIONS`), Malay, which it lacks, as Soniox's list has it (`Bahasa Melayu`); `zhen` keeps `中英双语 (zh↔en)`. Cantonese keeps the registry's name too, `粵語 (cantonese)` (review M3); Shanghainese, which it lacks, is named in its own script with an English gloss, `上海话 (Shanghainese)` — the spot check settles the glosses' case. Every source other than Chinese or English targets `[English, 中文]`, English first, so leaving `zhen` lands on English as the old rule R3 did; the old rules R2 and R4 (picking `zhen` from the target side) have no place in two functions (survey §2.5) — a stated departure.
18. **Labels:** a segment carries no `language` — the leg's configured code stands, so a `zhen` session's rows read "ZHEN" and a Cantonese source "YUE-CN", as the old badge did (survey §2.5); guessing `zh` or `en` per row by script is left out.
19. **After the start** (survey §2.10): a text-only leg ignores every TTS event (`s2t` sends none); `SessionFailed` fails the run as the service's (the old client ignored it after the start); `SessionFinished` and `SessionCanceled` from the server close it (`leg_closed`); a frame of another session is dropped and framed; an unreadable frame is framed, and said as `parse_error` once per episode.
20. **The check's request** (ruling 9): text only — no voice is set up, and every spoken pair also runs as text — for **the user's pair**, so a pair Doubao would refuse at start is refused by the check (the old one checked a fixed `zh → en`, survey §1.18.9); no libraries; no audio.
21. **The deletion plan is its own ("V2")**, after the owner's live test, taking the relay twin with the own-key old code (Task 18's inventory).

## What this plan consumes from the Gemini plan

Named as the committed plan (`a7810bde`) names them, so a reconciliation is mechanical. Each is consumed as it lands; where the landed name or text differs, the implementer follows the landed one and reports it.

| From the Gemini plan | What it is | Consumed by |
|---|---|---|
| Task 2: `inferPairs(segments, t)` in `src/lib/projection/pair.ts` — "wherever `openedAt` follows the opening order, the same answer", windowed | L2's proximity pairing for Doubao's origin-less segments | Task 5 (the `proximity` script's projection case), Task 15 (the adapter's projection case) — reached through `createProjector` |
| Task 2: `createPairCache(infer?: typeof inferPairs): (leg: Pick<Leg, 'leg' \| 'session' \| 'segments'>, t: PairingThresholds) => Map<SegmentId, SegmentId>`, used by `project.ts`'s `createProjector` | the cache that re-pairs only when an opening, an origin or a timing changes — a Doubao partial costs one comparison per segment | the same two cases, through `createProjector().project(…)`; nothing in this plan calls either directly |
| Task 4: `SharedSettings` without `instructions`; `buildSharedSettings(pair, pauses, segmentation)`; its edits to `types.ts`, `appShape.ts` (+ test), `shape.test.ts`, `soniox/testing.ts` | the shared settings a builder reads | Task 6 (`config.test.ts`' fixture), Task 12 (`testing.ts`' `SHARED`) — no `instructions` member; the hunk headers of Tasks 3, 9 and 12's diffs of those files count its result |
| Task 6: `InstructionsField`, `VoiceField`, `ModelField`, `ModelConfigurationField` (`NumberRange`) in `src/components/providers/fields/` | the shared fields Gemini built | **none used**: Doubao has no instructions, voice or model choice. `TextField` (Task 4) is new beside them, in their folder and test conventions |
| Task 9: `src/providers/gemini/socket.ts` (choice 20); `src/providers/gemini/testing.ts`' `trackedClock` (choice 21) and the `createVirtualClock` / `VirtualClock` import it uses. Task 11: `startGemini` in the same file, whose body calls `trackedClock()` | Gemini's socket seam, its copy of the tracked clock, and the harness that calls it | Task 12: `trackedClock` becomes the kit's; Gemini's `testing.ts` imports it and exports the local binding, which `startGemini` keeps calling (review B1); `socket.ts` is Doubao's own copy (choice 13) |
| Task 3 (landed, `75a5c343`): `logStore.ts`' Gemini rows; its case "groups each of Gemini's renamed frames…", the last of `describe('logStore — per-client event grouping')` | the grouping block beside Doubao's, and the case Doubao's follows | Task 2 edits the Volcengine block, which Gemini left as it was, and adds its case after Gemini's (review D3) |
| Task 13: `RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, sonioxProvider]`, `import { geminiProvider } from './gemini/provider'`, the order case `['kizunaai_soniox', 'localInference', 'gemini', 'soniox']`, `ownKeyOptions('understand-others')` → `['gemini', 'soniox', 'fake']`, and `gemini/provider.test.ts`' "sits between LocalInference and Soniox" (`PROVIDERS.slice(0, 4)`) | the registry and its three pins | Task 16 inserts `volcengineAst2Provider` after `geminiProvider` in the registry and the first two pins, and narrows Gemini's case to `slice(0, 3)` |
| Task 14: the spec's "Sockets that need upgrade headers" closing sentence ("Gemini's key rides in the socket's query: it needs no header."), "What adding a provider then touches" item 4, the frame bullet's `logStore` sentence, Stage 2's third migration item; its roadmap record's "with AST2's header seam" (choice 20, "What this plan leaves") | the Gemini plan's amendments and record | Task 18 amends after each, and supersedes the record's "with AST2's header seam": F14 is OpenAI Live's (review D5) |
| Task 1 (landed, `f979db5c`): `legacyStorageKey` in `providerStore.load` | the legacy read | Task 9 edits other lines of `load` and leaves it as it landed |

## File Structure

| File | Task | Change |
|---|---|---|
| `src/providers/volcengine_ast2/{adapter,codec.test}.ts`, `proto/**` (moved), `src/services/clients/volcengine-ast2/ast2-proto.{js,d.ts}` (stubs) | 1 | the codec's home (F18), the folder's seed |
| `src/lib/diagnostics/redact.ts` (+ test), `src/stores/logStore.ts` (+ test) | 2 | the query's credentials redacted; Doubao's frames grouped |
| `src/lib/provider/{types,languages}.ts` (+ languages test), `src/lib/session/shape.ts` (+ test), `src/providers/registry.test.ts` | 3 | `LanguageContext`, `CredentialChoice`; the helpers and the gate under a context; the invariant |
| `src/components/providers/fields/TextField.tsx` (+ test) | 4 | the shared single-line field |
| `src/providers/fake/scripts.ts` (+ test) | 5 | the `proximity` script |
| `src/providers/volcengine_ast2/{settings,config}.ts` (+ tests), `src/locales/*/translation.json` | 6 | `S`, credentials and their choice, languages per context, the builder; one key ×30 |
| `src/providers/volcengine_ast2/audioIn.ts` (+ test) | 7 | the resampler and the pacer |
| `src/providers/volcengine_ast2/{segments,speech,decode}.ts` (+ tests) | 8 | subtitles → segments; spoken sentences; the Ogg decoder |
| `src/stores/providerStore.ts`, `src/lib/session/appShape.ts`, `src/app/session.ts` (+ tests) | 9 | the store keeps the user's pair and derives the run's; the speech inputs watched |
| `src/components/providers/CredentialChoiceControl.tsx` (new), `src/components/providers/{CredentialForm,ProviderPicker}.tsx` (+ tests), `src/components/Settings/Settings.scss`, `src/providers/registry.test.ts` | 10 | the credential choice drawn and written; its invariant |
| `src/components/providers/{LanguagePairSection,ProviderLanguages}.tsx` (+ tests), `src/components/SetupWizard/steps/StepLanguagePair.tsx` (+ new test) | 11 | the surfaces offer the context's languages |
| `src/providers/volcengine_ast2/{socket,wire,testing}.ts`, `wire.test.ts`, `src/lib/contract/testing/trackedClock.ts` (+ test), `src/providers/{soniox,gemini}/testing.ts` | 12 | the wire, the seam, the fixtures; `trackedClock` to the kit |
| `src/providers/volcengine_ast2/Ast2Settings.tsx` (+ test) | 13 | Doubao's own settings view |
| `src/providers/volcengine_ast2/check.ts` (+ test) | 14 | the bounded handshake |
| `src/providers/volcengine_ast2/adapter.ts` (replaced), `adapter.test.ts`, `testing.ts` (the harness), `src/providers/sessionSide.consistency.test.ts` | 15 | the adapter |
| `src/providers/volcengine_ast2/provider.ts` (+ test), `src/providers/registry.ts` (+ test), `src/components/SetupWizard/providerPaths.test.ts`, `src/providers/gemini/provider.test.ts` | 16 | the definition, registered fourth; the order pins moved |
| `src/components/SetupWizard/{setupDraft,applySetup,useApplySetup}.ts` (+ tests), `src/components/SetupWizard/steps/StepCredentials.tsx` (+ test) | 17 | the wizard's credential choice |
| the spec, the roadmap | 18 | the controller's amendments and record |

**Order and parallelism.**
- **Wave 1:** Tasks 1 (the codec), 2 (the Logs), 3 (the contract), 4 (`TextField`), 5 (the fake's script). Disjoint files. Task 1 writes its `adapter.ts` seed before any other file of the new folder; a concurrent task that still sees "every provider keeps its adapter in adapter.ts" fail names it as Task 1's work in progress and does not touch the guard.
- **Wave 2:** Task 6 (needs Task 1's folder, Task 3's two types), Task 7 (Task 1's folder), Task 8 (Task 1's folder), Task 9 (Task 3's `languageContext`), Task 10 (Task 3's `CredentialChoice`; after Task 3's `registry.test.ts` edit). Disjoint files.
- **Wave 3:** Task 11 (needs Task 9's store and `participantSpeechSwitchFromStores`), Task 12 (Task 1's codec, Task 6's types and builder), Task 13 (Tasks 4, 6). Disjoint files.
- **Wave 4:** Task 14 (needs Task 12), Task 15 (Tasks 6, 7, 8, 12). Disjoint files: Task 15 appends to `testing.ts`, which Task 14's test only reads — a red moment there is Task 15's work in progress.
- **Group check A** (controller) after Wave 4: the adapter, the check and the settings are complete; nothing is registered.
- **Wave 5:** Task 16 (needs everything but Task 17).
- **Wave 6:** Task 17 (the wizard's credential choice: needs Task 10's `CredentialChoiceControl` and Task 16's registration, which its tests read through `wizardProvider` and `presentProviders`).
- **Group check B** (controller) after Wave 6.
- **Task 18** (controller) last.

---

## Wave 1

### Task 1: The codec moves to its provider (F18), and the folder is seeded

**Files:**
- Move: `src/services/clients/volcengine-ast2/ast2-proto.js` → `src/providers/volcengine_ast2/proto/ast2-proto.js`; `src/services/clients/volcengine-ast2/ast2-proto.d.ts` → `src/providers/volcengine_ast2/proto/ast2-proto.d.ts`; `src/services/clients/volcengine-ast2/protos/` → `src/providers/volcengine_ast2/proto/protos/` (the schema the codec was generated from, kept beside it).
- Create: `src/services/clients/volcengine-ast2/ast2-proto.js`, `src/services/clients/volcengine-ast2/ast2-proto.d.ts` (re-export stubs), `src/providers/volcengine_ast2/adapter.ts` (the seed), `src/providers/volcengine_ast2/codec.test.ts`.

**Interfaces:**
- Consumes: nothing new.
- Produces: `import { data as proto } from './proto/ast2-proto.js'` inside `src/providers/volcengine_ast2/` — `proto.speech.ast.TranslateRequest` / `TranslateResponse` (`encode(…).finish()`, `decode(bytes)`), `proto.speech.event.Type`, typed by the moved `.d.ts`; the folder with its seed `adapter.ts` (the session-side guard requires one in every provider folder).
- Consumed by: Tasks 12 (`wire.ts`, `testing.ts`), 15 (the adapter replaces the seed); the old client (`VolcengineAST2Client.ts:41`, `import { data } from './volcengine-ast2/ast2-proto.js'`) through the stub.

The generated file is moved, never regenerated — no script regenerates it (`package.json` lists `protobufjs-cli` and no script, survey §1.1) — and `git mv` keeps its history and its bytes. It imports only `protobufjs/minimal` (checked), so the move changes nothing inside it. Nothing else in the tree names `ast2-proto` (checked: the old client alone), and no script or config names the `volcengine-ast2` directory.

- [ ] **Step 1: Write the seed, then the failing test.** First the seed, `src/providers/volcengine_ast2/adapter.ts`, before any other file of the new folder: the session-side guard requires an `adapter.ts` in every directory under `src/providers` (`sessionSide.consistency.test.ts:173-175`), and Wave 1's other tasks run it (review I1; the Wave 1 note):

```ts
/**
 * Doubao AST 2.0's session side (plan: Stage 2 Volcengine AST2). The adapter
 * lands in its Task 15; until then this seed is the `adapter.ts` the
 * session-side guard (`sessionSide.consistency.test.ts`) requires of every
 * provider folder.
 */
export {};
```

  Then `src/providers/volcengine_ast2/codec.test.ts`, in full:

```ts
/**
 * The generated protobuf codec in its new home (F18): one module, reached
 * from the old path through a re-export, and the messages this provider
 * speaks round-trip through it. The old path is read here only, as the
 * stub's pin: new code imports nothing from `src/services`.
 */
import { describe, it, expect } from 'vitest';
import { data as moved } from './proto/ast2-proto.js';
import { data as old } from '../../services/clients/volcengine-ast2/ast2-proto.js';

const { TranslateRequest, TranslateResponse } = moved.speech.ast;
const Type = moved.speech.event.Type;

describe("Doubao AST 2.0's codec (F18)", () => {
  it('is one module: the old path re-exports the moved one', () => {
    expect(old).toBe(moved);
  });

  it('names its events both ways', () => {
    expect(Type.StartSession).toBe(100);
    expect(Type.SessionStarted).toBe(150);
    expect(Type.TranslationSubtitleEnd).toBe(655);
    expect((Type as unknown as Record<number, string>)[352]).toBe('TTSResponse');
  });

  it('round-trips a StartSession', () => {
    const bytes = TranslateRequest.encode({
      requestMeta: { Endpoint: 'volc.service_type.10053', SessionID: 's1', ConnectionID: 'c1', Sequence: 0 },
      event: Type.StartSession,
      sourceAudio: { format: 'pcm', rate: 16000, bits: 16, channel: 1 },
      request: { mode: 's2t', sourceLanguage: 'zh', targetLanguage: 'en', corpus: { boostingTableId: 'hot-1' } },
    }).finish();
    const back = TranslateRequest.decode(bytes);
    expect(back.event).toBe(Type.StartSession);
    expect(back.requestMeta).toMatchObject({ Endpoint: 'volc.service_type.10053', SessionID: 's1', ConnectionID: 'c1' });
    expect(back.sourceAudio).toMatchObject({ format: 'pcm', rate: 16000, bits: 16, channel: 1 });
    expect(back.request).toMatchObject({ mode: 's2t', sourceLanguage: 'zh', targetLanguage: 'en', corpus: { boostingTableId: 'hot-1' } });
  });

  it('round-trips a subtitle and a spoken chunk', () => {
    const subtitle = TranslateResponse.decode(TranslateResponse.encode({
      responseMeta: { SessionID: 's1', Sequence: 3, StatusCode: 20000000 },
      event: Type.SourceSubtitleResponse,
      text: '你好',
      startTime: 10,
      endTime: 900,
    }).finish());
    expect(subtitle).toMatchObject({ event: Type.SourceSubtitleResponse, text: '你好', startTime: 10, endTime: 900 });
    expect(subtitle.responseMeta).toMatchObject({ SessionID: 's1', Sequence: 3, StatusCode: 20000000 });

    const chunk = TranslateResponse.decode(TranslateResponse.encode({ event: Type.TTSResponse, data: new Uint8Array([1, 2, 3]) }).finish());
    expect(Array.from(chunk.data)).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/providers/volcengine_ast2/codec.test.ts` — FAIL: `./proto/ast2-proto.js` does not exist.
- [ ] **Step 3: Implement.** Each command is its own call, from the worktree root:
  - `mkdir -p src/providers/volcengine_ast2/proto`
  - `git mv src/services/clients/volcengine-ast2/ast2-proto.js src/providers/volcengine_ast2/proto/ast2-proto.js`
  - `git mv src/services/clients/volcengine-ast2/ast2-proto.d.ts src/providers/volcengine_ast2/proto/ast2-proto.d.ts`
  - `git mv src/services/clients/volcengine-ast2/protos src/providers/volcengine_ast2/proto/protos`

  Then write the two stubs at the old paths. `src/services/clients/volcengine-ast2/ast2-proto.js`:

```js
// The generated codec moved to its provider (Stage 2 Volcengine AST2, Task 1; F18). The old client imports it here until the deletion plan removes both.
export * from '../../../providers/volcengine_ast2/proto/ast2-proto.js';
```

  `src/services/clients/volcengine-ast2/ast2-proto.d.ts`:

```ts
// The generated codec's types, moved with it (Stage 2 Volcengine AST2, Task 1; F18).
export * from '../../../providers/volcengine_ast2/proto/ast2-proto';
```

  (`export *` does not forward the generated file's `default`; the old client imports only `data`.)

- [ ] **Step 4: Run** the Step 2 command — PASS; then `npx vitest run src/services src/providers/sessionSide.consistency.test.ts`, the full suite and the gate. The old client's suites import it as before and reach the codec through the stub. The typecheck cannot prove the stub's types: `tsconfig.json` sets `skipLibCheck`, so no `.d.ts` is checked, and the old client's import sits under `// @ts-ignore` (`AST2C:40`). `codec.test.ts`'s typed import of the old path is the proof — its `old toBe moved` case, and its typecheck under the gate's `providers` alternative, which reads the stub's declarations (review M5). The session-side guard walks the new folder: the seed imports nothing.
- [ ] **Step 5: Commit.**

```bash
git add src/services/clients/volcengine-ast2 src/providers/volcengine_ast2
```

```bash
git commit -q -F - -- src/services/clients/volcengine-ast2 src/providers/volcengine_ast2 <<'EOF'
refactor(volcengine_ast2): move the generated codec to its provider (F18)

The protobuf codec, its declarations and its schema move under
src/providers/volcengine_ast2/proto/, unchanged; the old client reaches
them through a re-export left at the old path until the deletion plan.
The folder gets the adapter seed the session-side guard requires.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

### Task 2: The query's credentials redacted, Doubao's frames grouped in Logs (ruling 2; choice 9)

**Files:**
- Modify: `src/lib/diagnostics/redact.ts`, `src/stores/logStore.ts`
- Test: `src/lib/diagnostics/redact.test.ts`, `src/stores/logStore.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `redact()` masks the values of `api_app_key` and `api_access_key` (and, as before, `api_key`) in a query, keeping each name; the Logs group `subtitle.source` under `volcengine_source_subtitle`, `subtitle.translation` under `volcengine_translation_subtitle`, `tts.sentence_start` / `tts.sentence_end` / `tts.ended` under `volcengine_tts`, `session.usage` under `volcengine_usage`, `session.audio_muted` under `volcengine_audio_mute`.
- Consumed by: Task 12 (`ast2Url`'s parameter names), Task 15 (the frame names; the kit's frame-secret rule runs `redact()`).

The rule's list already names `api_key` — the new console's query name — so two names join it; the test covers all three (ruling 2 asked for the three). The grouping keeps `logStore`'s rule that a group holds one event type (`logStore.ts:525-531` compares `eventType` as well as the key): the old client's `SourceSubtitleStart` never merged with its `…Response` either, and the test pins it.

- [ ] **Step 1: Write the failing tests.** `redact.test.ts`, after the case ending `expect(out).toContain('X-Date=20260827T000000Z');` and before "redacts Bearer tokens but keeps the scheme":

```diff
--- a/src/lib/diagnostics/redact.test.ts
+++ b/src/lib/diagnostics/redact.test.ts
@@ -58,8 +58,20 @@
     expect(out).toContain('X-Algorithm=HMAC-SHA256');
     expect(out).toContain('X-Date=20260827T000000Z');
   });
 
+  // volcengine_ast2/wire.ts `ast2Url` — Doubao AST 2.0's credentials ride in
+  // its socket's query (Stage 2 Volcengine AST2, ruling 2): the legacy App ID
+  // and Access Token, or the new console's API key. The resource id is not a
+  // secret and stays readable.
+  it("redacts Doubao AST 2.0's query credentials, keeping each parameter's name", () => {
+    const legacy = 'wss://openspeech.bytedance.com/api/v4/ast/v2/translate?api_resource_id=volc.service_type.10053&api_app_key=1234567890&api_access_key=Abc-Def_ghi';
+    expect(redact(legacy)).toBe('wss://openspeech.bytedance.com/api/v4/ast/v2/translate?api_resource_id=volc.service_type.10053&api_app_key=[REDACTED]&api_access_key=[REDACTED]');
+    expect(redact('wss://openspeech.bytedance.com/api/v4/ast/v2/translate?api_resource_id=volc.service_type.10053&api_key=0a1b2c3d'))
+      .toBe('wss://openspeech.bytedance.com/api/v4/ast/v2/translate?api_resource_id=volc.service_type.10053&api_key=[REDACTED]');
+    expect(redact('?API_APP_KEY=a1&Api_Access_Key=b2')).toBe('?API_APP_KEY=[REDACTED]&Api_Access_Key=[REDACTED]');
+  });
+
   it('redacts Bearer tokens but keeps the scheme', () => {
     expect(redact('Authorization: Bearer sess_abcdef123456'))
       .toBe('Authorization: Bearer [REDACTED]');
   });
```

  `logStore.test.ts`, after the last case of `describe('logStore — per-client event grouping')` — the Gemini plan's "groups each of Gemini's renamed frames…" (its Task 3, landed as `75a5c343`) — and before that describe's closing `});` (review D3):

```diff
--- a/src/stores/logStore.test.ts
+++ b/src/stores/logStore.test.ts
@@ -158,8 +158,34 @@
       expect(speaker[speaker.length - 1].groupingKey, type).toBe(key);
       expect(speaker[speaker.length - 1].events, type).toHaveLength(2);
     }
   });
+
+  it("groups Doubao AST 2.0's renamed frames under the old client's keys (Stage 2 Volcengine AST2, choice 9)", () => {
+    const add = (type: string) => useLogStore.getState().addRealtimeEvent({ type, data: {} } as any, 'server', type, 'speaker');
+    add('subtitle.source');
+    add('subtitle.source');
+    add('subtitle.source');
+    let speaker = entriesFor('speaker');
+    expect(speaker).toHaveLength(1);
+    expect(speaker[0].groupingKey).toBe('volcengine_source_subtitle');
+    expect(speaker[0].events).toHaveLength(3);
+
+    // A group holds one frame type (the merge compares `eventType` too): each name keeps its old client's key.
+    const keys: Array<[string, string]> = [
+      ['subtitle.translation', 'volcengine_translation_subtitle'],
+      ['tts.sentence_start', 'volcengine_tts'],
+      ['tts.sentence_end', 'volcengine_tts'],
+      ['tts.ended', 'volcengine_tts'],
+      ['session.usage', 'volcengine_usage'],
+      ['session.audio_muted', 'volcengine_audio_mute'],
+    ];
+    for (const [type, key] of keys) {
+      add(type);
+      speaker = entriesFor('speaker');
+      expect(speaker[speaker.length - 1].groupingKey, type).toBe(key);
+    }
+  });
 });
 
 describe('logStore — channel filing', () => {
   beforeEach(() => useLogStore.getState().clearLogs());
```

- [ ] **Step 2: Run** `npx vitest run src/lib/diagnostics/redact.test.ts src/stores/logStore.test.ts` — FAIL: the two names are not redacted; the new frame types group under their own type.
- [ ] **Step 3: Implement.** `redact.ts`, the query rule and its comment:

```diff
--- a/src/lib/diagnostics/redact.ts
+++ b/src/lib/diagnostics/redact.ts
@@ -32,10 +32,15 @@
   // but panel text is clipboard-exportable, so the rule stays as a net for a
   // URL a user pastes into a bug report. They need naming explicitly: the rule is
   // anchored on `[?&]`, so a bare `signature` alternative does NOT match
   // `?X-Signature=` — the `X-` prefix sits between the delimiter and the name.
+  //
+  // `api_app_key`, `api_access_key` and `api_key`: Doubao AST 2.0 takes its
+  // credentials in the socket's query (`volcengine_ast2/wire.ts` `ast2Url`,
+  // Stage 2 Volcengine AST2 ruling 2). The URL is never put in a frame, an
+  // error or a notice; this is the net for one that reaches a sink anyway.
   [
-    /([?&](?:key|api_key|apikey|token|access_token|accessToken|secret|signature|x-credential|x-signature|x-security-token)=)[^&\s"']+/gi,
+    /([?&](?:key|api_key|api_app_key|api_access_key|apikey|token|access_token|accessToken|secret|signature|x-credential|x-signature|x-security-token)=)[^&\s"']+/gi,
     `$1${REDACTED}`,
   ],
   // `Authorization: Bearer <token>` on every provider fetch.
   [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, `$1${REDACTED}`],
```

  `logStore.ts`, the Volcengine block (after the PalabraAI `current_task` branch; the Gemini plan's Task 3 edited the Gemini branches above it and left this block as it was):

```diff
--- a/src/stores/logStore.ts
+++ b/src/stores/logStore.ts
@@ -462,22 +462,27 @@
       else if (eventType === 'current_task') {
         // Group PalabraAI current task response events together
         groupingKey = 'palabraai_current_task';
       }
-      // Volcengine AST2-specific grouping
-      else if (eventType === 'SourceSubtitleResponse' || eventType === 'SourceSubtitleStart' || eventType === 'SourceSubtitleEnd') {
+      // Volcengine AST2-specific grouping: the old client's names and the new
+      // adapter's `domain.event` frames (Stage 2 Volcengine AST2, choice 9);
+      // the old names go with the old client.
+      else if (eventType === 'SourceSubtitleResponse' || eventType === 'SourceSubtitleStart' || eventType === 'SourceSubtitleEnd'
+          || eventType === 'subtitle.source') {
         groupingKey = 'volcengine_source_subtitle';
       }
-      else if (eventType === 'TranslationSubtitleResponse' || eventType === 'TranslationSubtitleStart' || eventType === 'TranslationSubtitleEnd') {
+      else if (eventType === 'TranslationSubtitleResponse' || eventType === 'TranslationSubtitleStart' || eventType === 'TranslationSubtitleEnd'
+          || eventType === 'subtitle.translation') {
         groupingKey = 'volcengine_translation_subtitle';
       }
-      else if (eventType === 'TTSResponse' || eventType === 'TTSSentenceStart' || eventType === 'TTSSentenceEnd') {
+      else if (eventType === 'TTSResponse' || eventType === 'TTSSentenceStart' || eventType === 'TTSSentenceEnd'
+          || eventType === 'tts.sentence_start' || eventType === 'tts.sentence_end' || eventType === 'tts.ended') {
         groupingKey = 'volcengine_tts';
       }
-      else if (eventType === 'UsageResponse') {
+      else if (eventType === 'UsageResponse' || eventType === 'session.usage') {
         groupingKey = 'volcengine_usage';
       }
-      else if (eventType === 'AudioMuted' || eventType === 'AudioUnmuted') {
+      else if (eventType === 'AudioMuted' || eventType === 'AudioUnmuted' || eventType === 'session.audio_muted') {
         groupingKey = 'volcengine_audio_mute';
       }
       // For other events, extract item_id if it exists (OpenAI)
       // Note: Use sanitizedEvent for checking item_id to avoid accessing removed audio data
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then `npx vitest run src/lib/diagnostics src/stores src/app`, the full suite and the gate. `redact` is shared with PostHog error tracking and every sink: the new names only mask more. `logStore.ts` keeps its two baseline gate lines unchanged.
- [ ] **Step 5: Commit.**

```bash
git add src/lib/diagnostics/redact.ts src/lib/diagnostics/redact.test.ts src/stores/logStore.ts src/stores/logStore.test.ts
```

```bash
git commit -q -F - -- src/lib/diagnostics/redact.ts src/lib/diagnostics/redact.test.ts src/stores/logStore.ts src/stores/logStore.test.ts <<'EOF'
feat(diagnostics): redact Doubao's query credentials, group its new frames

Doubao AST 2.0 takes its credentials in the socket's query, so the
shared redaction rule masks api_app_key and api_access_key beside the
api_key it already masked. The Logs group the new adapter's frames
under the old client's keys.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

### Task 3: The language context and the credential choice in the contract (rulings 1, 3; choices 1, 2)

**Files:**
- Modify: `src/lib/provider/types.ts`, `src/lib/provider/languages.ts`, `src/lib/session/shape.ts`
- Test: `src/lib/provider/languages.test.ts`, `src/lib/session/shape.test.ts`, `src/providers/registry.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `types.ts`: `interface LanguageContext { speech: boolean }`; `interface CredentialChoice { setting: string; options: ReadonlyArray<{ value: string; labelKey: string }> }`; `Provider.credentials.choice?: CredentialChoice`; `languages.sources(s: S, context?: LanguageContext)`, `languages.targets(source: string, s: S, context?: LanguageContext)`.
  - `languages.ts`: `reverseSupported(p, s, pair, context?)`, `swapped(p, s, pair, context?)`, `normalizePair(p, s, pair, context?)` — the context passed to both functions; absent, the widest offer, as today.
  - `shape.ts`: `interface SpeechInputs { textOnly: boolean; participantSpeech: boolean }`; `languageContext(p: Pick<AnyProvider, 'speech' | 'participantSpeech'>, legs: readonly LegName[], inputs: SpeechInputs): LanguageContext`; `contextsFor` unchanged in what it answers (it now reads the shared `legSpeaks`); `gate`'s D20 check reads the participant leg's context.
- Consumed by: Task 6 (Doubao's languages, credentials and choice), Task 9 (the store), Task 10 (the form), Task 11 (the surfaces).

A provider whose language functions take fewer parameters still satisfies the wider signature, so no provider file changes: every registered provider ignores the context, and `normalizePair` and the gate answer for it exactly what they answered. The invariant in `registry.test.ts` holds every provider's offer under either context inside its widest one — the stored pair is kept within the widest offer (Task 9), so a context's offer must never hold a language the widest does not. `LegName` is imported as a type into `shape.test.ts`; `AnyProvider` into `shape.ts`.

- [ ] **Step 1: Write the failing tests.** `languages.test.ts`:

```diff
--- a/src/lib/provider/languages.test.ts
+++ b/src/lib/provider/languages.test.ts
@@ -1,7 +1,7 @@
 import { describe, it, expect } from 'vitest';
 import { AUTO, normalizePair, reverseSupported, swapped } from './languages';
-import type { LanguageOption } from './types';
+import type { LanguageContext, LanguageOption } from './types';
 
 const opt = (value: string): LanguageOption => ({ value, name: value, englishName: value });
 
 /** en / ja / fr with detection; fr translates only into en; `zhen` pairs only with itself (AST2's both-or-neither). */
@@ -60,4 +60,33 @@
   it('fills an empty pair with the first source and its first target', () => {
     expect(normalizePair(p, s, {})).toEqual({ source: AUTO, target: 'en' });
   });
 });
+
+/** Speaking offers en and ja; text also offers ko — Doubao AST 2.0's shape: it speaks fewer languages than it transcribes. */
+const spoken = (context?: LanguageContext) => [opt('en'), opt('ja'), ...(context?.speech ? [] : [opt('ko')])];
+const q = {
+  languages: {
+    sources: (_s: unknown, context?: LanguageContext) => spoken(context),
+    targets: (source: string, _s: unknown, context?: LanguageContext) => spoken(context).filter((o) => o.value !== source),
+  },
+};
+
+describe('a language context (Stage 2 Volcengine AST2, choice 1)', () => {
+  it('normalizes into the offer for the context, and into the widest offer without one', () => {
+    expect(normalizePair(q, s, { source: 'ko', target: 'en' }, { speech: true })).toEqual({ source: 'en', target: 'ja' });
+    expect(normalizePair(q, s, { source: 'ko', target: 'en' }, { speech: false })).toEqual({ source: 'ko', target: 'en' });
+    expect(normalizePair(q, s, { source: 'ko', target: 'en' })).toEqual({ source: 'ko', target: 'en' });
+  });
+
+  it('reverses and swaps within the offer for the context', () => {
+    expect(reverseSupported(q, s, { source: 'en', target: 'ko' }, { speech: true })).toBe(false);
+    expect(reverseSupported(q, s, { source: 'en', target: 'ko' }, { speech: false })).toBe(true);
+    expect(swapped(q, s, { source: 'en', target: 'ko' }, { speech: true })).toBeNull();
+    expect(swapped(q, s, { source: 'en', target: 'ko' })).toEqual({ source: 'ko', target: 'en' });
+  });
+
+  it('changes nothing for a provider whose languages ignore it', () => {
+    expect(normalizePair(p, s, { source: 'fr', target: 'ja' }, { speech: true })).toEqual(normalizePair(p, s, { source: 'fr', target: 'ja' }));
+    expect(reverseSupported(p, s, { source: 'en', target: 'ja' }, { speech: false })).toBe(true);
+  });
+});
```

  `shape.test.ts`:

```diff
--- a/src/lib/session/shape.test.ts
+++ b/src/lib/session/shape.test.ts
@@ -2,9 +2,11 @@
 import { AUTO } from '../provider/languages';
 import { fakeProvider } from '../../providers/fake/provider';
 import { FAKE_DEFAULTS } from '../../providers/fake/settings';
 import { formatUsdFloor } from '../../utils/formatters';
-import { balanceRefusal, BALANCE_BELOW_FLOOR, contextsFor, gate, microphoneMissing, QUOTA_PENDING, QUOTA_UNKNOWN } from './shape';
+import type { LegName } from '../conversation/types';
+import type { LanguageContext } from '../provider/types';
+import { balanceRefusal, BALANCE_BELOW_FLOOR, contextsFor, gate, languageContext, microphoneMissing, QUOTA_PENDING, QUOTA_UNKNOWN } from './shape';
 import type { BalanceShape, RunShape } from './types';
 
 const shape = (patch: Partial<RunShape> = {}): RunShape => ({
   provider: fakeProvider,
@@ -55,8 +57,37 @@
     expect(flagOnSwitchOff.participant?.speech).toBe(false);
   });
 });
 
+describe('languageContext (Stage 2 Volcengine AST2, choice 1)', () => {
+  const off = { textOnly: false, participantSpeech: false };
+
+  it("speaks when any leg it opens speaks, by contextsFor's own rule", () => {
+    expect(languageContext(fakeProvider, ['speaker'], off)).toEqual({ speech: true });
+    expect(languageContext(fakeProvider, ['speaker'], { ...off, textOnly: true })).toEqual({ speech: false });
+    expect(languageContext(fakeProvider, ['participant'], off)).toEqual({ speech: false });
+    expect(languageContext(fakeProvider, ['participant'], { ...off, participantSpeech: true })).toEqual({ speech: true });
+    expect(languageContext(fakeProvider, ['speaker', 'participant'], { textOnly: true, participantSpeech: true })).toEqual({ speech: true });
+    expect(languageContext(fakeProvider, [], off)).toEqual({ speech: false });
+  });
+
+  it("follows the provider's speech and its participant flag", () => {
+    expect(languageContext({ speech: 'always' }, ['speaker'], { ...off, textOnly: true })).toEqual({ speech: true });
+    expect(languageContext({ speech: 'never' }, ['speaker'], off)).toEqual({ speech: false });
+    expect(languageContext({ speech: 'optional', participantSpeech: false }, ['participant'], { ...off, participantSpeech: true })).toEqual({ speech: false });
+  });
+
+  it('agrees with contextsFor on every leg', () => {
+    for (const textOnly of [false, true]) {
+      for (const participantSpeech of [false, true]) {
+        const contexts = contextsFor(shape({ legs: ['speaker', 'participant'], textOnly, participantSpeech }));
+        expect(languageContext(fakeProvider, ['speaker'], { textOnly, participantSpeech }).speech).toBe(contexts.speaker?.speech);
+        expect(languageContext(fakeProvider, ['participant'], { textOnly, participantSpeech }).speech).toBe(contexts.participant?.speech);
+      }
+    }
+  });
+});
+
 describe('gate', () => {
   it('lets a supported shape through', () => {
     expect(gate(shape({ legs: ['speaker', 'participant'] }), 'electron')).toBeNull();
   });
@@ -80,8 +111,18 @@
     expect(gate(shape({ provider: manualOnly, turnMode: 'push-to-talk', legs: ['speaker', 'participant'] }), 'electron'))
       .toMatchObject({ code: 'turn_mode_unsupported', leg: 'participant' });
   });
 
+  it("refuses the participant leg a pair whose reverse its own speech does not offer (Stage 2 Volcengine AST2, choice 1)", () => {
+    const opt = (value: string) => ({ value, name: value, englishName: value });
+    // Speaking offers en and ja; text also ko — Doubao AST 2.0's shape.
+    const spoken = (context?: LanguageContext) => [opt('en'), opt('ja'), ...(context?.speech ? [] : [opt('ko')])];
+    const narrow = { ...fakeProvider, languages: { sources: (_s: unknown, context?: LanguageContext) => spoken(context), targets: (source: string, _s: unknown, context?: LanguageContext) => spoken(context).filter((o) => o.value !== source) } };
+    const both = { provider: narrow, legs: ['speaker', 'participant'] as LegName[], pair: { source: 'en', target: 'ko' }, textOnly: true };
+    expect(gate(shape({ ...both, participantSpeech: true }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
+    expect(gate(shape({ ...both, participantSpeech: false }), 'electron')).toBeNull();
+  });
+
   it('gates the narrower input the stores give as well as a run\'s shape', () => {
     expect(gate({ provider: fakeProvider, settings: FAKE_DEFAULTS, pair: { source: 'en', target: 'ja' }, legs: ['participant'], turnMode: 'auto' }, 'web'))
       .toMatchObject({ code: 'participant_source_unavailable', leg: 'participant' });
   });
```

  `registry.test.ts`, before `it("the release offers its providers in the owner's order"`:

```ts
  it('offers, in each language context, a target for every source and only languages of its widest offer (Stage 2 Volcengine AST2, choice 1)', () => {
    /** Where an offer under a context leaves the widest one, or runs dry: the stored pair is kept within the widest (`providerStore`). */
    const outside = (ps: readonly AnyProvider[]) => ps.flatMap((p) => {
      const s = p.settings.defaults;
      const widest = new Set(p.languages.sources(s).map((o) => o.value));
      return [true, false].flatMap((speech) => {
        const sources = p.languages.sources(s, { speech });
        return [
          ...(sources.length > 0 ? [] : [`${p.id}: no source (speech ${speech})`]),
          ...sources.flatMap((source) => {
            const wide = new Set(p.languages.targets(source.value, s).map((o) => o.value));
            const targets = p.languages.targets(source.value, s, { speech });
            return [
              ...(widest.has(source.value) ? [] : [`${p.id}: source ${source.value} (speech ${speech})`]),
              ...(targets.length > 0 ? [] : [`${p.id}: no target for ${source.value} (speech ${speech})`]),
              ...targets.filter((t) => t.value === AUTO || !wide.has(t.value)).map((t) => `${p.id}: ${source.value} → ${t.value} (speech ${speech})`),
            ];
          }),
        ];
      });
    });
    expect(outside(PROVIDERS)).toEqual([]);
    // The control: an offer that grows under a context is caught.
    const opt = (value: string) => ({ value, name: value, englishName: value });
    const growing = { ...fakeProvider, id: 'growing', languages: { sources: (_s: unknown, context?: { speech: boolean }) => [opt('en'), ...(context?.speech ? [opt('xx')] : [])], targets: () => [opt('ja')] } } as unknown as AnyProvider;
    expect(outside([growing])).toEqual(['growing: source xx (speech true)']);
  });
```

- [ ] **Step 2: Run** `npx vitest run src/lib/provider/languages.test.ts src/lib/session/shape.test.ts src/providers/registry.test.ts` — FAIL: `languageContext` is not exported; the helpers ignore a fourth argument, so the narrowed normalization, reverse and swap cases fail; the gate lets the narrow pair through. The registry invariant passes already (every provider ignores the context) — its `growing` control is what bites.
- [ ] **Step 3: Implement.** `types.ts` — three hunks; the Gemini plan's Task 4 has already removed `SharedSettings.instructions` and its Task 1 (landed) edited two doc comments elsewhere in the file, neither of which these touch:

```diff
--- a/src/lib/provider/types.ts
+++ b/src/lib/provider/types.ts
@@ -14,8 +14,31 @@
 export interface LanguageOption { value: string; name: string; englishName: string }
 export interface LanguagePair { source: string; target: string }
 
 /**
+ * What the languages on offer may depend on besides the settings (Stage 2
+ * Volcengine AST2, choice 1): whether the run would speak — any leg it
+ * opens producing translated audio. Doubao AST 2.0 speaks eight languages
+ * and transcribes twenty and two dialects. A language function called
+ * without it answers its widest offer, every language any mode takes: the
+ * offer the stored pair is kept within (`providerStore`).
+ */
+export interface LanguageContext { speech: boolean }
+
+/**
+ * A setting that decides which credential fields show (F4; Stage 2
+ * Volcengine AST2, ruling 1; Palabra's platform/app toggle next): the
+ * credential form draws its options as a segmented control above the
+ * fields and writes the choice as a settings patch. Switching clears no
+ * credential — every key in `credentials.keys` stays stored.
+ */
+export interface CredentialChoice {
+  /** A field of `settings.defaults`, holding one option's `value`. */
+  setting: string;
+  options: ReadonlyArray<{ value: string; labelKey: string }>;
+}
+
+/**
  * One credential input. `key` is the field its value persists under
  * (`settings.<settings.key>.<key>`); `labelKey` and `placeholderKey` are i18n
  * keys.
  */
@@ -255,8 +278,10 @@
      * no `missing` member — the type parameter's constraint enforces it. A
      * missing answer may carry a code (F3).
      */
     read(values: CredentialValues, auth: AuthContext): R | CredentialsMissing;
+    /** A setting that picks which fields show, drawn by the credential form above them (F4). */
+    choice?: CredentialChoice;
   };
   /**
    * Can this provider start now: a network validation, model readiness, or
    * the service's answer for a managed provider (the sign-in itself is
@@ -277,12 +302,12 @@
    */
   watchReadiness?(onChange: () => void): () => void;
 
   languages: {
-    /** Includes `AUTO` when the provider detects the language. */
-    sources(s: S): readonly LanguageOption[];
-    /** Never includes `AUTO`. */
-    targets(source: string, s: S): readonly LanguageOption[];
+    /** Includes `AUTO` when the provider detects the language. Without a `context`: the widest offer. */
+    sources(s: S, context?: LanguageContext): readonly LanguageOption[];
+    /** Never includes `AUTO`. Without a `context`: the widest offer. */
+    targets(source: string, s: S, context?: LanguageContext): readonly LanguageOption[];
     /** The pair to start from when nothing is stored; normalized like any stored pair. Absent: the first source and its first target. */
     initial?(s: S): Partial<LanguagePair>;
     /**
      * Rewrites the stored pair before it is normalized (F5): a code the
```

  `languages.ts`:

```diff
--- a/src/lib/provider/languages.ts
+++ b/src/lib/provider/languages.ts
@@ -1,10 +1,12 @@
 /**
  * The language rules every provider shares (spec: "Languages are two
  * functions"). What differs between providers lives inside its `sources` and
- * `targets`; nothing here names a provider.
+ * `targets`; nothing here names a provider. Each rule takes an optional
+ * language context (Stage 2 Volcengine AST2, choice 1): under one, the offer
+ * for it; without, the provider's widest offer.
  */
-import type { LanguageOption, LanguagePair, Provider } from './types';
+import type { LanguageContext, LanguageOption, LanguagePair, Provider } from './types';
 
 /** The source value that asks the provider to detect the language. Never a target. */
 export const AUTO = 'auto';
 
@@ -20,27 +22,27 @@
  * sources, and the source among that target's targets. It decides both the
  * swap button and whether the participant leg may open (D20). `AUTO` is never
  * a target, so an `AUTO` source never reverses.
  */
-export function reverseSupported<S>(p: Languages<S>, s: S, pair: LanguagePair): boolean {
-  return offers(p.languages.sources(s), pair.target) && offers(p.languages.targets(pair.target, s), pair.source);
+export function reverseSupported<S>(p: Languages<S>, s: S, pair: LanguagePair, context?: LanguageContext): boolean {
+  return offers(p.languages.sources(s, context), pair.target) && offers(p.languages.targets(pair.target, s, context), pair.source);
 }
 
 /** The reversed pair; null when the provider does not support it, or when it is the same pair. */
-export function swapped<S>(p: Languages<S>, s: S, pair: LanguagePair): LanguagePair | null {
-  if (pair.source === pair.target || !reverseSupported(p, s, pair)) return null;
+export function swapped<S>(p: Languages<S>, s: S, pair: LanguagePair, context?: LanguageContext): LanguagePair | null {
+  if (pair.source === pair.target || !reverseSupported(p, s, pair, context)) return null;
   return { source: pair.target, target: pair.source };
 }
 
 /**
  * A pair the provider offers, keeping what it can of `pair`: its source when
  * listed, else the first source; its target when listed for that source, else
  * that source's first target. Every registered provider offers at least one
- * source, and at least one target for each (`registry.test.ts`).
+ * source, and at least one target for each, in every context (`registry.test.ts`).
  */
-export function normalizePair<S>(p: Languages<S>, s: S, pair: Partial<LanguagePair>): LanguagePair {
-  const sources = p.languages.sources(s);
+export function normalizePair<S>(p: Languages<S>, s: S, pair: Partial<LanguagePair>, context?: LanguageContext): LanguagePair {
+  const sources = p.languages.sources(s, context);
   const source = pair.source !== undefined && offers(sources, pair.source) ? pair.source : sources[0].value;
-  const targets = p.languages.targets(source, s);
+  const targets = p.languages.targets(source, s, context);
   const target = pair.target !== undefined && offers(targets, pair.target) ? pair.target : targets[0].value;
   return { source, target };
 }
```

  `shape.ts`:

```diff
--- a/src/lib/session/shape.ts
+++ b/src/lib/session/shape.ts
@@ -1,8 +1,8 @@
 import type { SessionContext } from '../contract/adapter';
 import type { LegName } from '../conversation/types';
 import { reverseSupported } from '../provider/languages';
-import type { Platform } from '../provider/types';
+import type { AnyProvider, LanguageContext, Platform } from '../provider/types';
 import { formatUsdFloor } from '../../utils/formatters';
 import type { RunNoticeCode } from './codes';
 import type { RunNotice, RunShape } from './types';
 
@@ -10,27 +10,49 @@
 export interface Refusal extends RunNotice {
   leg?: LegName;
 }
 
+/**
+ * What decides whether a run would speak besides its legs and its provider:
+ * the text-only switch, and the participant's speech — its switch, and a
+ * source that will not recapture it (`appShape`'s `speechInputsFromStores`).
+ * A run's shape holds both; so does the provider store, for the language
+ * offer (Stage 2 Volcengine AST2, choice 1).
+ */
+export interface SpeechInputs { textOnly: boolean; participantSpeech: boolean }
+
+type Speaking = Pick<AnyProvider, 'speech' | 'participantSpeech'>;
+
+/** Whether a leg speaks: the one rule `contextsFor`, the gate and the language offer read. */
+function legSpeaks(p: Speaking, leg: LegName, inputs: SpeechInputs): boolean {
+  const speaks = (wanted: boolean) => p.speech === 'always' || (p.speech === 'optional' && wanted);
+  if (leg === 'speaker') return speaks(!inputs.textOnly);
+  // While its provider's participant-speech flag is off (Kizuna Soniox
+  // until the backend mints a participant speech key, Stage 2 ruling 2)
+  // the participant stays text-only whatever the switch says.
+  return p.participantSpeech === false ? false : speaks(inputs.participantSpeech);
+}
+
+/** The language context of a run over these legs (Stage 2 Volcengine AST2, choice 1): it speaks when any leg it opens does. */
+export function languageContext(p: Speaking, legs: readonly LegName[], inputs: SpeechInputs): LanguageContext {
+  return { speech: legs.some((leg) => legSpeaks(p, leg, inputs)) };
+}
+
 /** What each leg's adapter is told (spec: "The session request"). The participant leg runs the reverse, always with automatic turns. */
 export function contextsFor(shape: RunShape): Partial<Record<LegName, SessionContext>> {
   const { provider: p, pair } = shape;
-  const speaks = (wanted: boolean) => p.speech === 'always' || (p.speech === 'optional' && wanted);
   const contexts: Partial<Record<LegName, SessionContext>> = {};
   if (shape.legs.includes('speaker')) {
     contexts.speaker = {
       direction: { source: pair.source, target: pair.target },
-      speech: speaks(!shape.textOnly),
+      speech: legSpeaks(p, 'speaker', shape),
       turns: shape.turnMode === 'auto' ? 'auto' : 'manual',
     };
   }
   if (shape.legs.includes('participant')) {
     contexts.participant = {
       direction: { source: pair.target, target: pair.source },
-      // While its provider's participant-speech flag is off (Kizuna Soniox
-      // until the backend mints a participant speech key, Stage 2 ruling 2)
-      // the participant stays text-only whatever the switch says.
-      speech: p.participantSpeech === false ? false : speaks(shape.participantSpeech),
+      speech: legSpeaks(p, 'participant', shape),
       turns: 'auto',
     };
   }
   return contexts;
@@ -95,10 +117,11 @@
     }
     if (platform === 'web') {
       return { code: 'participant_source_unavailable' satisfies RunNoticeCode, message: 'This build has no participant source.', leg: 'participant' };
     }
-    // D20: the participant leg runs the reversed pair; an auto source never reverses.
-    if (!reverseSupported(p, s, shape.pair)) {
+    // D20: the participant leg runs the reversed pair, in the languages its own speech offers (Stage 2 Volcengine AST2, choice 1); an auto source never reverses.
+    const participant = { speech: legSpeaks(p, 'participant', { textOnly: shape.textOnly ?? false, participantSpeech: shape.participantSpeech ?? false }) };
+    if (!reverseSupported(p, s, shape.pair, participant)) {
       return { code: 'participant_unsupported' satisfies RunNoticeCode, message: `${p.id} does not translate ${shape.pair.target} into ${shape.pair.source}.`, leg: 'participant' };
     }
   }
   return balanceRefusal(shape);
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then `npx vitest run src/lib src/providers src/stores src/components/providers src/components/SetupWizard`, the full suite and the gate. What the change reaches, and why each stays green: every caller of the three helpers passes no context and gets the widest offer, as before; `contextsFor` answers the same contexts (its cases pass unchanged, and "agrees with contextsFor on every leg" pins the shared rule); the gate's D20 reads the participant's context, which for every registered provider is the widest offer.
- [ ] **Step 5: Commit.**

```bash
git add src/lib/provider/types.ts src/lib/provider/languages.ts src/lib/provider/languages.test.ts src/lib/session/shape.ts src/lib/session/shape.test.ts src/providers/registry.test.ts
```

```bash
git commit -q -F - -- src/lib/provider/types.ts src/lib/provider/languages.ts src/lib/provider/languages.test.ts src/lib/session/shape.ts src/lib/session/shape.test.ts src/providers/registry.test.ts <<'EOF'
feat(provider): a language offer that depends on whether the run speaks

sources and targets take an optional language context; without one, a
provider answers its widest offer, as every provider does today. The
shared language rules pass it through, languageContext reads it from a
run's legs by contextsFor's own rule, and the gate's reverse check reads
the participant leg's. The contract gains the credential choice (F4).

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

### Task 4: `TextField` — a shared single-line setting (choice 16)

**Files:**
- Create: `src/components/providers/fields/TextField.tsx`
- Test: `src/components/providers/fields/TextField.test.tsx`

**Interfaces:**
- Consumes: `Tooltip` (`src/components/Tooltip/Tooltip`), `openExternalUrl` (`src/utils/openExternalUrl`), lucide's `CircleHelp` and `ExternalLink` — as the old rows (`ProviderSpecificSettings.tsx:1606-1694`).
- Produces: `TextField({ id, label, tooltip?, value, onChange(value: string), disabled?, link?: { href: string; label: string } })` — `.setting-item` holding `.setting-label` (the label, its tooltip icon, a right-aligned `.tutorial-link` that opens `href` externally) and `input.text-input` named by `aria-label={label}`.
- Consumed by: Task 13 (Doubao's three library ids).

The markup is the old Custom Vocabulary rows', class for class (the owner's rule: match the sibling markup; nothing type-checks a class name), with the input named so tests and screen readers find it; the Gemini plan's fields sit beside it and follow the same test conventions.

- [ ] **Step 1: Write the failing test** — `TextField.test.tsx`, in full:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { openExternalUrl } = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));
vi.mock('../../../utils/openExternalUrl', () => ({ openExternalUrl }));

import { TextField } from './TextField';

beforeEach(() => openExternalUrl.mockClear());

describe('TextField', () => {
  it('a labelled single-line input with its tooltip, writing what is typed', () => {
    const onChange = vi.fn();
    const { container } = render(<TextField id="hot" label="Hot Words Library ID" tooltip="Boost terms." value="lib-1" onChange={onChange} />);
    const field = screen.getByLabelText('Hot Words Library ID') as HTMLInputElement;
    expect(field.tagName).toBe('INPUT');
    expect(field.type).toBe('text');
    expect(field.id).toBe('hot');
    expect(field.className).toBe('text-input');
    expect(field.value).toBe('lib-1');
    fireEvent.change(field, { target: { value: 'lib-2' } });
    expect(onChange).toHaveBeenCalledWith('lib-2');

    // The tooltip's trigger sits in the label row, and opens on its text.
    const trigger = container.querySelector('.setting-label .tooltip-trigger') as HTMLElement;
    expect(trigger).not.toBeNull();
    act(() => { fireEvent.focus(trigger); });
    const bodies = document.querySelectorAll('.tooltip-body');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].textContent).toBe('Boost terms.');
  });

  it('a link opens its page outside the app, never in place', () => {
    render(<TextField id="hot" label="L" value="" onChange={() => {}} link={{ href: 'https://console.volcengine.com/speech/hotword', label: 'Manage hot words' }} />);
    const link = screen.getByRole('link', { name: 'Manage hot words' });
    expect(link.getAttribute('href')).toBe('https://console.volcengine.com/speech/hotword');
    expect(link.closest('.setting-label .tutorial-link')).not.toBeNull();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(openExternalUrl).toHaveBeenCalledWith('https://console.volcengine.com/speech/hotword');
  });

  it('draws no tooltip trigger and no link when given none', () => {
    const { container } = render(<TextField id="t" label="L" value="" onChange={() => {}} />);
    expect(container.querySelector('.tooltip-trigger')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('disabled locks it', () => {
    render(<TextField id="t" label="L" value="" onChange={() => {}} disabled />);
    expect(screen.getByLabelText('L')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/components/providers/fields/TextField.test.tsx` — FAIL: no module.
- [ ] **Step 3: Implement** `TextField.tsx`, in full:

```tsx
import { CircleHelp, ExternalLink } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';
import { openExternalUrl } from '../../../utils/openExternalUrl';

export interface TextFieldProps {
  id: string;
  /** The row's label, and the input's accessible name. */
  label: string;
  tooltip?: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  /** A page to manage what the field names (Doubao's console libraries), opened outside the app. */
  link?: { href: string; label: string };
}

/**
 * A single-line text setting (F13; Stage 2 Volcengine AST2): the markup of
 * the old Doubao AST 2.0 library-id rows (`ProviderSpecificSettings.tsx:1606-1686`)
 * — a label, its tooltip, a right-aligned external link, the input —
 * shared so a provider's own settings compose it rather than copy it.
 * `LinesField` is its multi-line sibling.
 */
export function TextField({ id, label, tooltip, value, onChange, disabled = false, link }: TextFieldProps) {
  return (
    <div className="setting-item">
      <div className="setting-label">
        <span>{label}</span>
        {tooltip !== undefined && (
          <Tooltip content={tooltip} position="top">
            <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
          </Tooltip>
        )}
        {link && (
          <div className="tutorial-link" style={{ margin: 0, marginLeft: 'auto' }}>
            <a href={link.href} onClick={(e) => { e.preventDefault(); openExternalUrl(link.href); }}>
              <ExternalLink size={12} />
              {link.label}
            </a>
          </div>
        )}
      </div>
      <input
        id={id}
        type="text"
        className="text-input"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder=""
      />
    </div>
  );
}
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then `npx vitest run src/components/providers`, the full suite and the gate. Nothing renders it yet (Task 13).
- [ ] **Step 5: Commit.**

```bash
git add src/components/providers/fields/TextField.tsx src/components/providers/fields/TextField.test.tsx
```

```bash
git commit -q -F - -- src/components/providers/fields/TextField.tsx src/components/providers/fields/TextField.test.tsx <<'EOF'
feat(providers): a shared single-line text field

The old Custom Vocabulary rows' markup as a field any provider view can
draw: a label with its tooltip, a right-aligned external link, and a
named input.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

### Task 5: The fake's `proximity` script — inferred pairing in the preview (ruling 11; choice 15)

**Files:**
- Modify: `src/providers/fake/scripts.ts`
- Test: `src/providers/fake/scripts.test.ts`

**Interfaces:**
- Consumes: the Gemini plan's F16 (`inferPairs`, `createPairCache`), reached through `createProjector().project(…)` — "What this plan consumes from the Gemini plan".
- Produces: `FakeScriptName` gains `'proximity'`, eleventh in `FAKE_SCRIPT_NAMES`.
- Consumed by: group check B (the preview shows inferred pairing).

Two exchanges in Doubao's shape: segments with no origin and no timing, and each spoken sentence one rangeless clip after its translation closed. The second translation opens 1.5 s after its source, inside L2's 4 s proximity window, so both pair as `'inferred'`. The fake's settings list the scripts by name (dev-only, D24), so no locale key is needed.

- [ ] **Step 1: Write the failing test** — `scripts.test.ts` (the imports it uses are already in the file):

```diff
--- a/src/providers/fake/scripts.test.ts
+++ b/src/providers/fake/scripts.test.ts
@@ -12,10 +12,10 @@
 const auto: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
 const play = (name: FakeScriptName) => driveAdapter(createFakeAdapter(), { context: auto, config: { script: fakeScript(name) }, credentials: {}, steps: [{ advance: 40_000 }] });
 
 describe('the fake\'s scripts', () => {
-  it("offers the ten scripts, and every one plays conformant through the kit's driver", async () => {
-    const ALL = ['exchange', 'cjk', 'rewrite', 'long', 'notices', 'refless-stream', 'framed', 'rangeless', 'reconnect', 'late-ranges'] as const;
+  it("offers the eleven scripts, and every one plays conformant through the kit's driver", async () => {
+    const ALL = ['exchange', 'cjk', 'rewrite', 'long', 'notices', 'refless-stream', 'framed', 'rangeless', 'reconnect', 'late-ranges', 'proximity'] as const;
     expect(FAKE_SCRIPT_NAMES).toEqual(ALL);
     for (const name of ALL) {
       const result = await play(name);
       expect(result.violations).toEqual([]);
@@ -159,8 +159,38 @@
     expect(kinds).not.toContain('speechRanges');
     expect(result.violations).toEqual([]);
   });
 
+  it('proximity: no origin, no timing, one rangeless clip per spoken sentence after its translation closed, and the projection pairs by proximity', async () => {
+    const clock = createVirtualClock();
+    const conv = new Conversation({ leg: 'speaker', session: 'proximity', languages: auto.direction, clock });
+    const log: AdapterEvent[] = [];
+    const events = eventsFrom((e) => { log.push(e); conv.apply(e); });
+    await createFakeAdapter().start(
+      { context: auto, config: { script: fakeScript('proximity') }, credentials: {}, clock, signal: new AbortController().signal },
+      events,
+    );
+    clock.advance(20_000);
+
+    for (const e of log) {
+      if (e.kind === 'segmentOpened' || e.kind === 'segmentClosed') expect(e.payload.origin).toBeUndefined();
+      if (e.kind === 'segmentText') expect(e.payload.timing).toBeUndefined();
+      if (e.kind === 'audio') {
+        expect(e.payload.ref).toBeDefined();
+        expect(e.payload.range).toBeUndefined();
+      }
+    }
+    // Every clip lands after its translation closed.
+    const closedAt = new Map<number, number>();
+    log.forEach((e, i) => { if (e.kind === 'segmentClosed') closedAt.set(e.payload.ref, i); });
+    log.forEach((e, i) => { if (e.kind === 'audio') expect(i).toBeGreaterThan(closedAt.get(e.payload.ref!)!); });
+
+    const entries = createProjector().project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'off', sentencesPerRow: 0 });
+    const exchanges = entries.filter((e) => e.kind === 'exchange');
+    expect(exchanges.length).toBe(2);
+    for (const ex of exchanges) { if (ex.kind === 'exchange') expect(ex.pairing).toBe('inferred'); }
+  });
+
   it('reconnect: drops and comes back between two exchanges, refs never reused', async () => {
     const result = await play('reconnect');
     const kinds = result.log.map((e) => e.kind);
     const at = kinds.indexOf('reconnecting');
```

- [ ] **Step 2: Run** `npx vitest run src/providers/fake/scripts.test.ts` — FAIL: no `proximity` script; the list has ten.
- [ ] **Step 3: Implement** — `scripts.ts`:

```diff
--- a/src/providers/fake/scripts.ts
+++ b/src/providers/fake/scripts.ts
@@ -1,12 +1,12 @@
 import { framedScript, longScript, reflessStreamScript } from './generate';
 import { exchange, type FakeScript } from './script';
 import { msForText } from './synth';
 
-export type FakeScriptName = 'exchange' | 'cjk' | 'rewrite' | 'long' | 'notices' | 'refless-stream' | 'framed' | 'rangeless' | 'reconnect' | 'late-ranges';
+export type FakeScriptName = 'exchange' | 'cjk' | 'rewrite' | 'long' | 'notices' | 'refless-stream' | 'framed' | 'rangeless' | 'reconnect' | 'late-ranges' | 'proximity';
 
 /** In the order the fake's settings list them. */
-export const FAKE_SCRIPT_NAMES: readonly FakeScriptName[] = ['exchange', 'cjk', 'rewrite', 'long', 'notices', 'refless-stream', 'framed', 'rangeless', 'reconnect', 'late-ranges'];
+export const FAKE_SCRIPT_NAMES: readonly FakeScriptName[] = ['exchange', 'cjk', 'rewrite', 'long', 'notices', 'refless-stream', 'framed', 'rangeless', 'reconnect', 'late-ranges', 'proximity'];
 
 /** The scripts the fake can play (spec: "Testing" — script playback and the shape knobs). */
 export function fakeScript(name: FakeScriptName): FakeScript {
   switch (name) {
@@ -85,6 +85,43 @@
             { at: 800, ranges: { ref: 2, ranges: [{ index: 0, range: [0, 6] }, { index: 1, range: [6, 13] }] } },
           ],
         }],
       };
+    case 'proximity':
+      // Doubao AST 2.0's shape (Stage 2 Volcengine AST2): no stated origin
+      // and no timing, so the projection pairs by how soon each translation
+      // opened after its source (F16's proximity window); each spoken
+      // sentence is one rangeless clip after its translation closes —
+      // replay, no karaoke. The second exchange's translation opens 1.5 s
+      // after its source, still inside the 4 s window.
+      return {
+        blocks: [
+          {
+            startAt: 500,
+            steps: [
+              { at: 0, open: { ref: 1, side: 'source' } },
+              { at: 0, text: { ref: 1, text: '你好' } },
+              { at: 300, text: { ref: 1, text: '你好，今天怎么样？' } },
+              { at: 600, close: { ref: 1 } },
+              { at: 700, open: { ref: 2, side: 'translation' } },
+              { at: 700, text: { ref: 2, text: 'Hello, how are you today?' } },
+              { at: 900, close: { ref: 2 } },
+              { at: 1_100, audio: { ref: 2, ms: msForText('Hello, how are you today?') } },
+            ],
+          },
+          {
+            startAt: 5_000,
+            steps: [
+              { at: 0, open: { ref: 3, side: 'source' } },
+              { at: 0, text: { ref: 3, text: '我很好。谢谢。' } },
+              { at: 800, close: { ref: 3 } },
+              { at: 1_500, open: { ref: 4, side: 'translation' } },
+              { at: 1_500, text: { ref: 4, text: 'I am fine. Thank you.' } },
+              { at: 1_700, close: { ref: 4 } },
+              { at: 1_900, audio: { ref: 4, ms: msForText('I am fine.') } },
+              { at: 1_900, audio: { ref: 4, ms: msForText('Thank you.') } },
+            ],
+          },
+        ],
+      };
   }
 }
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then `npx vitest run src/providers/fake src/lib/projection`, the full suite and the gate. "offers the eleven scripts" plays the new one through the kit's conformance rules.
- [ ] **Step 5: Commit.**

```bash
git add src/providers/fake/scripts.ts src/providers/fake/scripts.test.ts
```

```bash
git commit -q -F - -- src/providers/fake/scripts.ts src/providers/fake/scripts.test.ts <<'EOF'
feat(fake): a proximity script, paired by L2's inference

Doubao AST 2.0's shape for the preview: no stated origin, no timing,
one rangeless clip per spoken sentence after its translation closed.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

## Wave 2

### Task 6: Doubao's settings, credentials in two modes, languages per context, and the builder (rulings 1, 3, 4; choices 2, 5, 6, 7, 17)

**Files:**
- Create: `src/providers/volcengine_ast2/settings.ts`, `src/providers/volcengine_ast2/config.ts`
- Modify: the 30 catalogs `src/locales/*/translation.json` (one key, by script)
- Test: `src/providers/volcengine_ast2/settings.test.ts`, `src/providers/volcengine_ast2/config.test.ts`

**Interfaces:**
- Consumes: Task 3 — `LanguageContext`, `CredentialChoice` (through `Provider['credentials']`), `normalizePair` / `reverseSupported` / `swapped` with a context (the tests); the Gemini plan's `SharedSettings` without `instructions` (`config.test.ts`' fixture).
- Produces:
  - `settings.ts`: `type Ast2AuthMode = 'app' | 'apiKey'`; `interface Ast2Settings { authMode: Ast2AuthMode; hotWordTableId: string; replacementTableId: string; glossaryTableId: string }`; `AST2_DEFAULTS` (`authMode: 'app'`, the ids `''`); `migrateAst2Settings(stored)`; `type Ast2Credentials = { kind: 'app'; appKey: string; accessKey: string } | { kind: 'apiKey'; apiKey: string }`; `ast2Credentials` (keys `appId`, `accessToken`, `apiKey`; fields per mode; `read`; `choice` on `authMode`); `ZHEN = 'zhen'`; `ast2Languages` (`sources(s, context?)`, `targets(source, s, context?)`, `initial` zh → en); `ast2Offers(direction, context): boolean`.
  - `config.ts`: `interface Ast2Corpus { boostingTableId?: string; regexCorrectTableId?: string; glossaryTableId?: string }`; `interface Ast2Config { mode: 's2s' | 's2t'; sourceLanguage: string; targetLanguage: string; corpus?: Ast2Corpus }`; `buildCorpus(s)`; `buildAst2(context, s, shared): Ast2Config | ProviderRefusal`; `describeAst2(c): Record<string, never>`.
  - The key `providers.volcengine_ast2.authModeApp` in all 30 catalogs.
- Consumed by: Tasks 12 (`Ast2Corpus`, `Ast2Credentials`), 13 (`Ast2Settings`), 14, 15, 16.

What the definition keeps from the old slice (`AST2D:8-31`, survey §2.2): the three library ids and the credentials under their old keys (`settings.volcengineAST2.appId`, `.accessToken`), so an old profile carries over with nothing written. What it adds: `authMode` and the `apiKey` credential (ruling 1). The pair lives in the provider store under the old `sourceLanguage` / `targetLanguage` keys, as for every provider. `migrateAst2Settings` reads each field as text (an App ID stored as a number by an old build is read as `'123456'` — `read`'s `text()` does the same for credentials). The languages:
- **Speaking** (`context.speech === true`): the eight spoken languages and `zhen`.
- **Not speaking, or no context** (the widest offer): those eight, the twelve more, the two dialects, and `zhen`.
- **Targets:** `zhen` → `[zhen]` only; any source other than Chinese or English → `[English, 中文]`; Chinese or English → every language of the mode but itself, never a dialect, never `zhen`. So a dialect is a source only, and Chinese or English sits on one side of every pair (ruling 3, both modes' rule).
- `ast2Offers(direction, context)` is `build`'s check that a direction is on offer for its own leg's speech — a participant who speaks on a text-only pair is refused in words before a socket opens, the gate having already said so (Task 3's D20).

The new key's values (for the owner's native-speaker spot check), composed from each catalog's own `setup.credentials.appId` and `.accessToken`: `App ID + Access Token` in ar, bn, de, en, es, fa, fi, fil, fr, he, id, it, ko, nl, pl, pt_BR, pt_PT, ru, ta, th, tr, uk, vi, zh_TW; `APP ID + Access Token` in ms and sv; `ऐप ID + एक्सेस टोकन` (hi), `アプリ ID + アクセストークン` (ja), `యాప్ ID + యాక్సెస్ టోకెన్` (te), `应用 ID + 访问令牌` (zh_CN). The ja and zh_CN values drop the parenthesised English their catalogs' own labels carry (`アプリ ID（App ID）` / `アクセストークン（Access Token）`, `应用 ID（App ID）` / `访问令牌（Access Token）`), as the other catalogs' plain labels have none (review M4). The language names in the spot check: `粵語 (cantonese)`, the shared registry's own (`utils/languages.ts:62`; review M3), and `上海话 (Shanghainese)`, new (choice 17); `settings.test.ts` pins the reused names against `LANGUAGE_OPTIONS`.

- [ ] **Step 1: Write the failing tests.** `settings.test.ts`, in full:

```ts
import { describe, it, expect } from 'vitest';
import { normalizePair, reverseSupported, swapped } from '../../lib/provider/languages';
import type { AuthContext, LanguageContext } from '../../lib/provider/types';
import { LANGUAGE_OPTIONS } from '../../utils/languages';
import { AST2_DEFAULTS, ast2Credentials, ast2Languages, ast2Offers, migrateAst2Settings, ZHEN } from './settings';

const signedOut: AuthContext = { signedIn: false, getToken: async () => null };
const SPEAKING: LanguageContext = { speech: true };
const TEXT: LanguageContext = { speech: false };
const p = { languages: ast2Languages };
const values = (list: readonly { value: string }[]) => list.map((o) => o.value);
const SPOKEN = ['zh', 'en', 'ja', 'id', 'es', 'pt', 'de', 'fr'];
const TEXT_ONLY = ['ko', 'tr', 'ms', 'nl', 'ro', 'pl', 'cs', 'ar', 'th', 'vi', 'ru', 'it'];
const DIALECTS = ['yue-CN', 'sh-CN'];

describe("Doubao AST 2.0's settings", () => {
  it('default to the legacy credentials and no library', () => {
    expect(AST2_DEFAULTS).toEqual({ authMode: 'app', hotWordTableId: '', replacementTableId: '', glossaryTableId: '' });
  });

  it('migrate the defaults into the defaults, read an old profile as the legacy mode, and drop what left the slice', () => {
    expect(migrateAst2Settings({ ...AST2_DEFAULTS })).toEqual(AST2_DEFAULTS);
    const old = migrateAst2Settings({ hotWordTableId: 'hot-1', appId: '123', accessToken: 't', sourceLanguage: 'zh', turnDetectionMode: 'Push-to-Talk' });
    expect(old).toEqual({ ...AST2_DEFAULTS, hotWordTableId: 'hot-1' });
  });

  it('read a wrong-typed field as its default, and keep the API key mode once chosen', () => {
    expect(migrateAst2Settings({ ...AST2_DEFAULTS, authMode: 'token', glossaryTableId: 7 })).toEqual(AST2_DEFAULTS);
    expect(migrateAst2Settings({ ...AST2_DEFAULTS, authMode: 'apiKey' }).authMode).toBe('apiKey');
  });
});

describe("Doubao AST 2.0's credentials (ruling 1)", () => {
  it('show the App ID and the Access Token in the legacy mode, the API key in the new one', () => {
    expect(ast2Credentials.keys).toEqual(['appId', 'accessToken', 'apiKey']);
    expect(ast2Credentials.fields(AST2_DEFAULTS)).toEqual([
      { key: 'appId', labelKey: 'setup.credentials.appId', secret: false, placeholderKey: 'providers.volcengine_ast2.appIdPlaceholder' },
      { key: 'accessToken', labelKey: 'setup.credentials.accessToken', secret: true, placeholderKey: 'providers.volcengine_ast2.accessTokenPlaceholder' },
    ]);
    expect(ast2Credentials.fields({ ...AST2_DEFAULTS, authMode: 'apiKey' })).toEqual([
      { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' },
    ]);
  });

  it('offer the two modes as a choice over authMode, legacy first', () => {
    expect(ast2Credentials.choice).toEqual({
      setting: 'authMode',
      options: [{ value: 'app', labelKey: 'providers.volcengine_ast2.authModeApp' }, { value: 'apiKey', labelKey: 'setup.credentials.apiKey' }],
    });
  });

  it("read the selected mode's values, trimmed, an App ID stored as a number as its text (`descriptorRegistry.test.ts:179`)", () => {
    expect(ast2Credentials.read({ appId: ' app-1 ', accessToken: 'tok ' }, signedOut)).toEqual({ kind: 'app', appKey: 'app-1', accessKey: 'tok' });
    expect(ast2Credentials.read({ appId: 123 as unknown as string, accessToken: 't' }, signedOut)).toEqual({ kind: 'app', appKey: '123', accessKey: 't' });
    expect(ast2Credentials.read({ apiKey: ' k-1 ' }, signedOut)).toEqual({ kind: 'apiKey', apiKey: 'k-1' });
  });

  it('read an empty field as missing, in either mode', () => {
    expect(ast2Credentials.read({ appId: 'a', accessToken: '' }, signedOut)).toEqual({ missing: 'Enter the App ID and the Access Token of your Doubao AST 2.0 app.' });
    expect(ast2Credentials.read({ appId: '  ', accessToken: 't' }, signedOut)).toHaveProperty('missing');
    expect(ast2Credentials.read({ apiKey: '' }, signedOut)).toEqual({ missing: 'Enter the API key of your Doubao AST 2.0 app.' });
  });
});

describe("Doubao AST 2.0's languages (ruling 3; choice 1)", () => {
  it('offer the eight spoken languages and zhen when the run speaks, all twenty, two dialects and zhen when it does not', () => {
    expect(values(ast2Languages.sources(AST2_DEFAULTS, SPEAKING))).toEqual([...SPOKEN, ZHEN]);
    expect(values(ast2Languages.sources(AST2_DEFAULTS, TEXT))).toEqual([...SPOKEN, ...TEXT_ONLY, ...DIALECTS, ZHEN]);
    // Without a context: the widest offer, text only's.
    expect(ast2Languages.sources(AST2_DEFAULTS)).toBe(ast2Languages.sources(AST2_DEFAULTS, TEXT));
    expect(ast2Languages.initial?.(AST2_DEFAULTS)).toEqual({ source: 'zh', target: 'en' });
  });

  it("name the twelve more and Cantonese as the shared registry does (choice 17)", () => {
    const named = new Map(ast2Languages.sources(AST2_DEFAULTS, TEXT).map((o) => [o.value, o.name]));
    for (const code of TEXT_ONLY.filter((c) => c !== 'ms')) expect(named.get(code), code).toBe(LANGUAGE_OPTIONS[code].name);
    expect(named.get('yue-CN')).toBe(LANGUAGE_OPTIONS.cantonese.name);
  });

  it('pair zhen only with itself', () => {
    for (const context of [SPEAKING, TEXT]) {
      expect(values(ast2Languages.targets(ZHEN, AST2_DEFAULTS, context))).toEqual([ZHEN]);
      for (const source of values(ast2Languages.sources(AST2_DEFAULTS, context)).filter((v) => v !== ZHEN)) {
        expect(values(ast2Languages.targets(source, AST2_DEFAULTS, context)), source).not.toContain(ZHEN);
      }
    }
  });

  it("put Chinese or English on one side: zh and en reach every other language of the mode, anything else reaches English or Chinese, English first", () => {
    expect(values(ast2Languages.targets('zh', AST2_DEFAULTS, SPEAKING))).toEqual(SPOKEN.filter((v) => v !== 'zh'));
    expect(values(ast2Languages.targets('en', AST2_DEFAULTS, TEXT))).toEqual([...SPOKEN, ...TEXT_ONLY].filter((v) => v !== 'en'));
    for (const source of ['ja', 'fr', 'ko', 'it', 'yue-CN', 'sh-CN']) {
      expect(values(ast2Languages.targets(source, AST2_DEFAULTS, TEXT)), source).toEqual(['en', 'zh']);
    }
    expect(values(ast2Languages.targets('ja', AST2_DEFAULTS, SPEAKING))).toEqual(['en', 'zh']);
  });

  it('never offer a dialect as a target, nor a source as its own target', () => {
    for (const context of [SPEAKING, TEXT]) {
      for (const source of values(ast2Languages.sources(AST2_DEFAULTS, context))) {
        const targets = values(ast2Languages.targets(source, AST2_DEFAULTS, context));
        for (const dialect of DIALECTS) expect(targets, source).not.toContain(dialect);
        if (source !== ZHEN) expect(targets, source).not.toContain(source);
      }
    }
  });

  it('reverse every offered pair in its own mode (D20), except a dialect source, which is never a target', () => {
    for (const context of [SPEAKING, TEXT]) {
      for (const source of values(ast2Languages.sources(AST2_DEFAULTS, context))) {
        for (const target of values(ast2Languages.targets(source, AST2_DEFAULTS, context))) {
          const pair = { source, target };
          expect(reverseSupported(p, AST2_DEFAULTS, pair, context), `${source} → ${target}`).toBe(!DIALECTS.includes(source));
        }
      }
    }
    expect(swapped(p, AST2_DEFAULTS, { source: ZHEN, target: ZHEN }, SPEAKING)).toBeNull();
  });

  it('keep what they can of a pair a mode switch leaves unoffered, by normalizePair (the spec\'s rule)', () => {
    // Text only's Korean → Chinese, once the run speaks: Korean is gone, so the first source; its first target.
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'ko', target: 'zh' }, SPEAKING)).toEqual({ source: 'zh', target: 'en' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'zh', target: 'ko' }, SPEAKING)).toEqual({ source: 'zh', target: 'en' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'yue-CN', target: 'en' }, SPEAKING)).toEqual({ source: 'zh', target: 'en' });
    // Every spoken pair runs as text too: the switch the other way changes nothing.
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'ja', target: 'zh' }, TEXT)).toEqual({ source: 'ja', target: 'zh' });
  });

  it("repair the old UI's pairs: zhen with anything becomes zhen/zhen, a pair with neither Chinese nor English gets English (the old rules R1, R3)", () => {
    expect(normalizePair(p, AST2_DEFAULTS, { source: ZHEN, target: 'en' })).toEqual({ source: ZHEN, target: ZHEN });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'en', target: ZHEN })).toEqual({ source: 'en', target: 'zh' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'ja', target: 'de' })).toEqual({ source: 'ja', target: 'en' });
    // R1: picking zhen as the source; R3: leaving it.
    expect(normalizePair(p, AST2_DEFAULTS, { source: ZHEN, target: 'ja' }, SPEAKING)).toEqual({ source: ZHEN, target: ZHEN });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'fr', target: ZHEN }, SPEAKING)).toEqual({ source: 'fr', target: 'en' });
  });

  it('say whether Doubao runs a direction in a mode: build\'s guard', () => {
    expect(ast2Offers({ source: 'ja', target: 'zh' }, SPEAKING)).toBe(true);
    expect(ast2Offers({ source: 'ko', target: 'zh' }, SPEAKING)).toBe(false);
    expect(ast2Offers({ source: 'ko', target: 'zh' }, TEXT)).toBe(true);
    expect(ast2Offers({ source: 'ja', target: 'de' }, TEXT)).toBe(false);
    expect(ast2Offers({ source: 'en', target: 'yue-CN' }, TEXT)).toBe(false);
  });
});
```

  `config.test.ts`, in full:

```ts
import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildAst2, buildCorpus, describeAst2, type Ast2Config } from './config';
import { AST2_DEFAULTS, type Ast2Settings } from './settings';

const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1, translationSeconds: 1 },
  reversed: (d) => d.source === 'en' && d.target === 'zh',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
};
const SPEAKER: SessionContext = { direction: { source: 'zh', target: 'en' }, speech: true, turns: 'auto' };
const build = (patch: Partial<Ast2Settings> = {}, context = SPEAKER) => buildAst2(context, { ...AST2_DEFAULTS, ...patch }, SHARED) as Ast2Config;

describe('buildCorpus — the old buildCorpusFromConfig cases (`VolcengineAST2Client.test.ts:19-79`)', () => {
  it('is absent when no id is set, or every id is blank', () => {
    expect(buildCorpus(AST2_DEFAULTS)).toBeUndefined();
    expect(buildCorpus({ hotWordTableId: '  ', replacementTableId: '', glossaryTableId: '\t' })).toBeUndefined();
  });

  it('carries only the ids that are set, trimmed, under the protobuf names', () => {
    expect(buildCorpus({ hotWordTableId: ' hot-1 ', replacementTableId: '', glossaryTableId: '' })).toEqual({ boostingTableId: 'hot-1' });
    expect(buildCorpus({ hotWordTableId: '', replacementTableId: 'rep-1', glossaryTableId: 'glo-1' })).toEqual({ regexCorrectTableId: 'rep-1', glossaryTableId: 'glo-1' });
    expect(buildCorpus({ hotWordTableId: 'a', replacementTableId: 'b', glossaryTableId: 'c' })).toEqual({ boostingTableId: 'a', regexCorrectTableId: 'b', glossaryTableId: 'c' });
  });
});

describe("Doubao AST 2.0's builder", () => {
  it('runs a speaking leg speech to speech and a silent one to text, in its direction', () => {
    expect(build()).toEqual({ mode: 's2s', sourceLanguage: 'zh', targetLanguage: 'en' });
    expect(build({}, { ...SPEAKER, speech: false })).toEqual({ mode: 's2t', sourceLanguage: 'zh', targetLanguage: 'en' });
  });

  it('names the libraries on both legs, the participant too (parity; choice 6)', () => {
    const libraries = { hotWordTableId: 'hot-1', glossaryTableId: 'glo-1' };
    expect(build(libraries).corpus).toEqual({ boostingTableId: 'hot-1', glossaryTableId: 'glo-1' });
    const participant: SessionContext = { direction: { source: 'en', target: 'zh' }, speech: true, turns: 'auto' };
    expect(build(libraries, participant)).toEqual({ mode: 's2s', sourceLanguage: 'en', targetLanguage: 'zh', corpus: { boostingTableId: 'hot-1', glossaryTableId: 'glo-1' } });
  });

  it("refuses a direction its mode does not run — Korean speaks nowhere, but translates to text — as a guard", () => {
    const korean: SessionContext = { direction: { source: 'ko', target: 'zh' }, speech: true, turns: 'auto' };
    expect(buildAst2(korean, AST2_DEFAULTS, SHARED)).toEqual({ refused: 'Doubao AST 2.0 does not speak ko → zh.' });
    expect(build({}, { ...korean, speech: false })).toEqual({ mode: 's2t', sourceLanguage: 'ko', targetLanguage: 'zh' });
    expect(build({}, { direction: { source: 'yue-CN', target: 'en' }, speech: false, turns: 'auto' })).toMatchObject({ mode: 's2t', sourceLanguage: 'yue-CN' });
    expect(build({}, { direction: { source: 'zhen', target: 'zhen' }, speech: true, turns: 'manual' })).toMatchObject({ mode: 's2s', sourceLanguage: 'zhen', targetLanguage: 'zhen' });
  });

  it('describes no model (choice 7)', () => {
    expect(describeAst2(build())).toEqual({});
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/providers/volcengine_ast2/settings.test.ts src/providers/volcengine_ast2/config.test.ts` — FAIL: `./settings` and `./config` do not exist.
- [ ] **Step 3: Implement.** `settings.ts`, in full:

```ts
/**
 * Doubao AST 2.0's `S`, credentials and languages (survey §2.2–2.5). `S` is
 * the old slice (`VolcengineAST2ProviderConfig.ts:8-31`) without what
 * leaves it — the two credentials (same keys), the pair (`providerStore`,
 * same keys) and `turnDetectionMode` (the global turn mode, migrated once by
 * `storedSettings.ts`) — plus the credential mode (ruling 1). Stored under
 * `settings.volcengineAST2.*` as before. Nothing here imports `src/services`.
 */
import type { CredentialField, CredentialsMissing, LanguageContext, LanguageOption, Provider } from '../../lib/provider/types';

/** Which credentials a run sends (ruling 1): the legacy console's App ID and Access Token, or the new console's API key. */
export type Ast2AuthMode = 'app' | 'apiKey';

export interface Ast2Settings {
  /** Picked in the credential form (F4); an old profile reads the legacy mode, whose App ID and Access Token it already holds. */
  authMode: Ast2AuthMode;
  /** The console's hot-word library (`corpus.boosting_table_id`); '' for none. */
  hotWordTableId: string;
  /** The console's regex replacement library (`corpus.regex_correct_table_id`). */
  replacementTableId: string;
  /** The console's glossary library (`corpus.glossary_table_id`). */
  glossaryTableId: string;
}

export const AST2_DEFAULTS: Ast2Settings = {
  authMode: 'app',
  hotWordTableId: '',
  replacementTableId: '',
  glossaryTableId: '',
};

const AUTH_MODES: readonly unknown[] = ['app', 'apiKey'];

/** What was stored, made valid field by field; nothing is written back. */
export function migrateAst2Settings(stored: Readonly<Record<string, unknown>>): Ast2Settings {
  const str = (k: 'hotWordTableId' | 'replacementTableId' | 'glossaryTableId') => (typeof stored[k] === 'string' ? (stored[k] as string) : AST2_DEFAULTS[k]);
  return {
    authMode: AUTH_MODES.includes(stored.authMode) ? (stored.authMode as Ast2AuthMode) : AST2_DEFAULTS.authMode,
    hotWordTableId: str('hotWordTableId'),
    replacementTableId: str('replacementTableId'),
    glossaryTableId: str('glossaryTableId'),
  };
}

/** One leg's credentials: the kind decides the socket's query (`wire.ts` `ast2Url`). */
export type Ast2Credentials =
  | { kind: 'app'; appKey: string; accessKey: string }
  | { kind: 'apiKey'; apiKey: string };

const APP_ID: CredentialField = { key: 'appId', labelKey: 'setup.credentials.appId', secret: false, placeholderKey: 'providers.volcengine_ast2.appIdPlaceholder' };
const ACCESS_TOKEN: CredentialField = { key: 'accessToken', labelKey: 'setup.credentials.accessToken', secret: true, placeholderKey: 'providers.volcengine_ast2.accessTokenPlaceholder' };
const API_KEY: CredentialField = { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' };

/** A stored value as text: chrome storage hands an App ID stored as a number back as one (`descriptorRegistry.test.ts:179`). */
const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v)).trim();

export const ast2Credentials: Provider<Ast2Settings, Ast2Credentials, never>['credentials'] = {
  keys: ['appId', 'accessToken', 'apiKey'],
  fields: (s) => (s.authMode === 'apiKey' ? [API_KEY] : [APP_ID, ACCESS_TOKEN]),
  // `values` holds exactly the fields `fields(s)` shows, so its keys name the mode.
  read: (values): Ast2Credentials | CredentialsMissing => {
    if ('apiKey' in values) {
      const apiKey = text(values.apiKey);
      // No code: the runner words it `credentials_missing` ("Enter your API key in Settings before starting.").
      return apiKey ? { kind: 'apiKey', apiKey } : { missing: 'Enter the API key of your Doubao AST 2.0 app.' };
    }
    const appKey = text(values.appId);
    const accessKey = text(values.accessToken);
    return appKey && accessKey ? { kind: 'app', appKey, accessKey } : { missing: 'Enter the App ID and the Access Token of your Doubao AST 2.0 app.' };
  },
  choice: {
    setting: 'authMode',
    options: [
      { value: 'app', labelKey: 'providers.volcengine_ast2.authModeApp' },
      { value: 'apiKey', labelKey: 'setup.credentials.apiKey' },
    ],
  },
};

const lang = (value: string, name: string, englishName: string): LanguageOption => ({ value, name, englishName });

/**
 * The eight languages Doubao speaks (S2S), in the old list's order
 * (`VolcengineAST2ProviderConfig.ts:112-121`) and names.
 */
const SPOKEN: readonly LanguageOption[] = [
  lang('zh', '中文', 'Chinese'),
  lang('en', 'English', 'English'),
  lang('ja', '日本語', 'Japanese'),
  lang('id', 'Bahasa Indonesia', 'Indonesian'),
  lang('es', 'Español', 'Spanish'),
  lang('pt', 'Português', 'Portuguese'),
  lang('de', 'Deutsch', 'German'),
  lang('fr', 'Français', 'French'),
];

/**
 * The twelve more it transcribes and translates into text (S2T), in the
 * documentation's order; names as the shared registry has them
 * (`utils/languages.ts` `LANGUAGE_OPTIONS`; Malay, which it lacks, as
 * Soniox's list does).
 */
const TEXT_ONLY: readonly LanguageOption[] = [
  lang('ko', '한국어', 'Korean'),
  lang('tr', 'Türkçe', 'Turkish'),
  lang('ms', 'Bahasa Melayu', 'Malay'),
  lang('nl', 'Nederlands', 'Dutch'),
  lang('ro', 'Română', 'Romanian'),
  lang('pl', 'Polski', 'Polish'),
  lang('cs', 'Čeština', 'Czech'),
  lang('ar', 'العربية', 'Arabic'),
  lang('th', 'ไทย', 'Thai'),
  lang('vi', 'Tiếng Việt', 'Vietnamese'),
  lang('ru', 'Русский', 'Russian'),
  lang('it', 'Italiano', 'Italian'),
];

/**
 * Two dialects, text only and as a source only ("方言，仅支持作为源语种").
 * Cantonese keeps the shared registry's name (`utils/languages.ts`
 * `cantonese`, its gloss lower-case); Shanghainese, which it lacks, is in
 * its own script with an English gloss.
 */
const DIALECTS: readonly LanguageOption[] = [
  lang('yue-CN', '粵語 (cantonese)', 'Cantonese'),
  lang('sh-CN', '上海话 (Shanghainese)', 'Shanghainese'),
];

/** Chinese↔English in one session: both sides or neither (`zhen/zhen`). */
export const ZHEN = 'zhen';
const BIDIRECTIONAL = lang(ZHEN, '中英双语 (zh↔en)', 'Chinese-English Bidirectional');

const SPOKEN_SOURCES: readonly LanguageOption[] = [...SPOKEN, BIDIRECTIONAL];
const TEXT_SOURCES: readonly LanguageOption[] = [...SPOKEN, ...TEXT_ONLY, ...DIALECTS, BIDIRECTIONAL];
const ZH_OR_EN = new Set(['zh', 'en']);
const ONLY_ZHEN: readonly LanguageOption[] = [BIDIRECTIONAL];
/** English first, so leaving `zhen` on the source lands on English, as the old rule R3 did. */
const TO_EN_OR_ZH: readonly LanguageOption[] = [SPOKEN[1], SPOKEN[0]];

/**
 * The targets of a source (ruling 3). `zhen` pairs only with itself. Every
 * other pair has Chinese or English on one side — the rule of both modes as
 * this client runs them: S2T's ("源语种或目标语种必须是中英"), and S2S's
 * voice-clone mode's, which is the one the old client used (it sends no
 * `speaker_id`: the server clones the speaker's voice,
 * `VolcengineAST2ProviderConfig.ts:129`). A dialect is never a target.
 */
function targetsOf(source: string, speech: boolean): readonly LanguageOption[] {
  if (source === ZHEN) return ONLY_ZHEN;
  if (!ZH_OR_EN.has(source)) return TO_EN_OR_ZH;
  return (speech ? SPOKEN : [...SPOKEN, ...TEXT_ONLY]).filter((o) => o.value !== source);
}

/**
 * Doubao's languages depend on whether the run speaks (ruling 3; choice 1):
 * speaking offers the eight S2S languages, text only the twenty S2T ones and
 * the two dialects; without a context, the widest offer — text only's.
 */
export const ast2Languages: Provider<Ast2Settings, never, never>['languages'] = {
  sources: (_s, context?: LanguageContext) => (context?.speech ? SPOKEN_SOURCES : TEXT_SOURCES),
  targets: (source, _s, context?: LanguageContext) => targetsOf(source, context?.speech === true),
  initial: () => ({ source: 'zh', target: 'en' }),
};

/** Whether Doubao runs this direction in this mode: `build`'s guard, over the same two functions. */
export function ast2Offers(direction: { source: string; target: string }, context: LanguageContext): boolean {
  return ast2Languages.sources(AST2_DEFAULTS, context).some((o) => o.value === direction.source)
    && ast2Languages.targets(direction.source, AST2_DEFAULTS, context).some((o) => o.value === direction.target);
}
```

  `config.ts`, in full:

```ts
/**
 * Doubao AST 2.0's `C`, `build` and `describe` (survey §2.7). One builder for
 * both legs: the participant is the same call on the reversed direction,
 * and it speaks when its switch is on (ruling 4) — `context.speech` says so.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { ast2Offers, type Ast2Settings } from './settings';

/** The console libraries a session names (`ReqParams.corpus`), the protobuf's camelCase names. */
export interface Ast2Corpus {
  boostingTableId?: string;
  regexCorrectTableId?: string;
  glossaryTableId?: string;
}

export interface Ast2Config {
  /** Speech to speech, or to text only (`context.speech`). */
  mode: 's2s' | 's2t';
  sourceLanguage: string;
  targetLanguage: string;
  /** Absent when no library id is set. */
  corpus?: Ast2Corpus;
}

/**
 * The library ids a user set, trimmed; absent when none is (the old
 * `buildCorpusFromConfig`, `VolcengineAST2Client.ts:74-85`). Invalid ids
 * are silently ignored by the server, as the settings' footer says.
 */
export function buildCorpus(s: Pick<Ast2Settings, 'hotWordTableId' | 'replacementTableId' | 'glossaryTableId'>): Ast2Corpus | undefined {
  const corpus: Ast2Corpus = {};
  const hot = s.hotWordTableId?.trim();
  const replacement = s.replacementTableId?.trim();
  const glossary = s.glossaryTableId?.trim();
  if (hot) corpus.boostingTableId = hot;
  if (replacement) corpus.regexCorrectTableId = replacement;
  if (glossary) corpus.glossaryTableId = glossary;
  return Object.keys(corpus).length > 0 ? corpus : undefined;
}

export function buildAst2(context: SessionContext, s: Ast2Settings, _shared: SharedSettings): Ast2Config | ProviderRefusal {
  const { source, target } = context.direction;
  // A guard: the provider store keeps the pair within what the run's context offers (choice 1), so no surface hands one it cannot run.
  if (!ast2Offers(context.direction, { speech: context.speech })) {
    return { refused: `Doubao AST 2.0 does not ${context.speech ? 'speak' : 'translate'} ${source} → ${target}.` };
  }
  const corpus = buildCorpus(s);
  // The same libraries on both legs (parity): the build cannot tell the legs of a `zhen/zhen` pair apart (choice 6).
  return { mode: context.speech ? 's2s' : 's2t', sourceLanguage: source, targetLanguage: target, ...(corpus ? { corpus } : {}) };
}

/** No model to name: the old start reported none for AST2 (choice 7). */
export function describeAst2(_c: Ast2Config): Record<string, never> {
  return {};
}
```

  The locale key: write this script to `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/add_auth_mode_key.py` (outside the repository) and run `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/add_auth_mode_key.py src/locales`. It appends the key after `accessTokenPlaceholder`, the last key of `providers.volcengine_ast2` in every catalog, and refuses to write unless it finds exactly 30 catalogs, each with the anchor exactly once, each still valid JSON; it prints `30 catalogs`.

```python
"""Adds providers.volcengine_ast2.authModeApp to all 30 catalogs (Stage 2 Volcengine AST2, Task 6)."""
import json, pathlib, sys

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'src/locales')
ANCHOR = '      "accessTokenPlaceholder": "Access Token"\n'
DEFAULT = 'App ID + Access Token'
# Each catalog's own setup.credentials.appId and .accessToken, joined; the rest read the default.
VALUES = {
    'hi': 'ऐप ID + एक्सेस टोकन',
    'ja': 'アプリ ID + アクセストークン',
    'ms': 'APP ID + Access Token',
    'sv': 'APP ID + Access Token',
    'te': 'యాప్ ID + యాక్సెస్ టోకెన్',
    'zh_CN': '应用 ID + 访问令牌',
}
catalogs = sorted(p for p in ROOT.glob('*/translation.json'))
assert len(catalogs) == 30, len(catalogs)
for path in catalogs:
    text = path.read_text(encoding='utf-8')
    assert text.count(ANCHOR) == 1, path
    value = VALUES.get(path.parent.name, DEFAULT)
    line = '      "accessTokenPlaceholder": "Access Token",\n      "authModeApp": ' + json.dumps(value, ensure_ascii=False) + '\n'
    text = text.replace(ANCHOR, line)
    parsed = json.loads(text)
    assert parsed['providers']['volcengine_ast2']['authModeApp'] == value, path
    path.write_text(text, encoding='utf-8')
print(len(catalogs), 'catalogs')
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then `npx vitest run src/locales src/providers`, the full suite and the gate. The locale suites' consistency cases (every key in every catalog) see the new key in all 30. Nothing registers the provider yet (Task 16); the session-side guard still walks the seed.
- [ ] **Step 5: Commit.**

```bash
git add src/providers/volcengine_ast2/settings.ts src/providers/volcengine_ast2/settings.test.ts src/providers/volcengine_ast2/config.ts src/providers/volcengine_ast2/config.test.ts src/locales
```

```bash
git commit -q -F - -- src/providers/volcengine_ast2/settings.ts src/providers/volcengine_ast2/settings.test.ts src/providers/volcengine_ast2/config.ts src/providers/volcengine_ast2/config.test.ts src/locales <<'EOF'
feat(volcengine_ast2): settings, two credential modes, languages per mode

Doubao AST 2.0 keeps its libraries and its App ID / Access Token under
the old keys and adds the new console's API key, the mode chosen above
the fields. It speaks eight languages and transcribes twenty and two
dialects, Chinese or English on one side, zhen both or neither. The
builder runs a speaking leg s2s and refuses a direction its leg's speech
does not offer.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

`src/locales` is wholly this task's in Wave 2: no other task of the plan edits a catalog.

### Task 7: The resampler and the pacer — 24→16 kHz in 80 ms packets, the keepalive's idle, the tail (rulings 6, 7, 12; choices 10, 11)

**Files:**
- Create: `src/providers/volcengine_ast2/audioIn.ts`
- Test: `src/providers/volcengine_ast2/audioIn.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `INPUT_RATE = 16_000`, `PACKET_SAMPLES = 1_280` (80 ms at 16 kHz), `TAIL_MS = 500`, `KEEPALIVE_MS = 80`, `IDLE_MS = 250`; `class Resampler { push(pcm24: Int16Array): Int16Array; reset(): void }`; `class InputPacer { push(pcm24: Int16Array): Int16Array[]; drain(): Int16Array[]; tail(): Int16Array[] }` — `push` resamples and returns the whole packets now due; `drain()` what waits as one short packet, the resampler's carry dropped, no silence (an idle's start, review M1); `tail()` the same, then 500 ms of silence (six packets of 1 280 and one of 320).
- Consumed by: Task 15.

The old path resampled per chunk with `Math.floor` indices and no carry (`AST2C:1061-1103`, survey §0.10), so every chunk boundary reset the phase. Three input samples give two — the first as it is, the mean of the next two, rounded — which is the old linear interpolation at steps of 1.5, continuous across chunks; what does not fill a group of three waits for the next chunk.

- [ ] **Step 1: Write the failing test** — `audioIn.test.ts`, in full:

```ts
import { describe, it, expect } from 'vitest';
import { IDLE_MS, InputPacer, KEEPALIVE_MS, PACKET_SAMPLES, Resampler, TAIL_MS } from './audioIn';

const ramp = (n: number, from = 0) => Int16Array.from({ length: n }, (_, i) => from + i);
const concat = (parts: readonly Int16Array[]) => {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

describe('the resampler (ruling 12)', () => {
  it('takes three 24 kHz samples to two 16 kHz ones: the first as it is, the mean of the next two', () => {
    expect(Array.from(new Resampler().push(Int16Array.from([10, 20, 31, 40, 50, 61])))).toEqual([10, 26, 40, 56]);
  });

  it('carries what does not fill a group into the next chunk: the output is the same however the input is cut', () => {
    const whole = new Resampler().push(ramp(6_144));
    for (const cut of [[2_048, 2_048, 2_048], [1, 5, 6_138], [1_000, 1, 1, 5_142], [3, 3, 6_138]]) {
      const r = new Resampler();
      let from = 0;
      const parts = cut.map((n) => { const part = r.push(ramp(n, from)); from += n; return part; });
      expect(concat(parts)).toEqual(whole);
    }
    // Exactly two thirds: nothing lost at the chunk edges (survey §1.18.10).
    expect(whole.length).toBe(4_096);
  });

  it('holds back at most two samples, and a reset drops them', () => {
    const r = new Resampler();
    expect(r.push(ramp(2)).length).toBe(0);
    expect(r.push(ramp(1, 2)).length).toBe(2);
    r.push(ramp(2));
    r.reset();
    expect(Array.from(r.push(Int16Array.from([7, 8, 9])))).toEqual([7, 9]);
  });
});

describe('the input pacer', () => {
  it('cuts the 16 kHz stream into 80 ms packets, the rest waiting', () => {
    const pacer = new InputPacer();
    // Three capture chunks of 2 048 samples (85.3 ms each at 24 kHz) are 4 096 at 16 kHz: three packets and 256 waiting.
    const packets = [pacer.push(ramp(2_048)), pacer.push(ramp(2_048)), pacer.push(ramp(2_048))].flat();
    expect(packets.map((p) => p.length)).toEqual([PACKET_SAMPLES, PACKET_SAMPLES, PACKET_SAMPLES]);
    expect(PACKET_SAMPLES).toBe(1_280);
  });

  it("a release sends what waits, then 500 ms of silence as six 80 ms packets and a 20 ms one (ruling 6)", () => {
    const pacer = new InputPacer();
    pacer.push(ramp(600));
    const tail = pacer.tail();
    expect(tail.map((p) => p.length)).toEqual([400, 1_280, 1_280, 1_280, 1_280, 1_280, 1_280, 320]);
    expect(tail.slice(1).every((p) => p.every((s) => s === 0))).toBe(true);
    expect(tail.slice(1).reduce((n, p) => n + p.length, 0) / 16).toBe(TAIL_MS);
    // Nothing waiting: the silence alone.
    expect(pacer.tail().map((p) => p.length)).toEqual([1_280, 1_280, 1_280, 1_280, 1_280, 1_280, 320]);
  });

  it('drains what waits at an idle as one short packet, with no silence and no carry, so the next packet starts clean (ruling 7)', () => {
    const pacer = new InputPacer();
    // 601 samples: 400 at 16 kHz, and one held by the resampler.
    pacer.push(new Int16Array(601).fill(500));
    expect(pacer.drain().map((p) => [p.length, p.every((s) => s === 500)])).toEqual([[400, true]]);
    expect(pacer.drain()).toEqual([]);
    expect(pacer.push(new Int16Array(1_920).fill(700)).map((p) => [p.length, p.every((s) => s === 700)])).toEqual([[1_280, true]]);
  });

  it('keeps the keepalive off the capture: its idle threshold is well past a chunk period (ruling 7)', () => {
    const chunkPeriodMs = (2_048 / 24_000) * 1000;
    expect(KEEPALIVE_MS).toBe(80);
    expect(IDLE_MS).toBeGreaterThan(2 * chunkPeriodMs);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/providers/volcengine_ast2/audioIn.test.ts` — FAIL: no module.
- [ ] **Step 3: Implement** `audioIn.ts`, in full:

```ts
/**
 * What Doubao hears (survey §1.5, §0.6): the contract's 24 kHz pcm as the
 * 16 kHz its `StartSession` declares, in the 80 ms packets it recommends
 * ("建议80ms 一包"), a push-to-talk release's 500 ms of silence, and the
 * idle rule the keepalive follows. Pure: no socket, no timer — the adapter
 * sends the packets and runs the keepalive on the request's clock.
 */

/** The server takes 16 kHz, 16-bit mono pcm (`StartSession.sourceAudio`). */
export const INPUT_RATE = 16_000;
/** 80 ms at 16 kHz (ruling 12). */
export const PACKET_SAMPLES = 1_280;
/** The old push-to-talk release (`VolcengineAST2ProviderConfig.ts:174-176`): the server's VAD closes the segment without waiting that long in wall time (ruling 6). */
export const TAIL_MS = 500;
const TAIL_SAMPLES = (INPUT_RATE * TAIL_MS) / 1000;
/** The keepalive's beat: one silent packet's length. */
export const KEEPALIVE_MS = 80;
/**
 * How long no audio must have gone out before the keepalive speaks
 * (ruling 7). The capture delivers a chunk every 85.3 ms (2 048 samples at
 * 24 kHz): the old 60 ms threshold fell inside that gap, so about one tick
 * in three spliced 80 ms of zeros between two chunks of speech (survey
 * §0.6). Three chunk periods is a real idle.
 */
export const IDLE_MS = 250;

/**
 * 24 kHz → 16 kHz, streamed (ruling 12): every three input samples give
 * two — the first as it is, the second the mean of the next two, which is
 * linear interpolation at steps of 1.5. The old code did this arithmetic
 * per chunk, resetting the phase and flooring the count, so a 2 048-sample
 * chunk lost a sample every third chunk (survey §1.18.10); here what does
 * not fill a group of three waits for the next chunk.
 */
export class Resampler {
  private carry: number[] = [];

  push(pcm: Int16Array): Int16Array {
    const held = this.carry;
    const total = held.length + pcm.length;
    const at = (i: number) => (i < held.length ? held[i] : pcm[i - held.length]);
    const groups = Math.floor(total / 3);
    const out = new Int16Array(groups * 2);
    for (let g = 0; g < groups; g++) {
      out[2 * g] = at(3 * g);
      out[2 * g + 1] = Math.round((at(3 * g + 1) + at(3 * g + 2)) / 2);
    }
    const rest: number[] = [];
    for (let i = groups * 3; i < total; i++) rest.push(at(i));
    this.carry = rest;
    return out;
  }

  /** Drops what waits for a group (under three input samples, 125 µs): a turn's end. */
  reset(): void {
    this.carry = [];
  }
}

/** The 16 kHz stream cut into 80 ms packets. */
export class InputPacer {
  private readonly resampler = new Resampler();
  private pending = new Int16Array(PACKET_SAMPLES);
  private filled = 0;

  /** The packets this chunk completes, in order; the rest waits. */
  push(pcm24: Int16Array): Int16Array[] {
    const samples = this.resampler.push(pcm24);
    const out: Int16Array[] = [];
    let i = 0;
    while (i < samples.length) {
      const n = Math.min(PACKET_SAMPLES - this.filled, samples.length - i);
      this.pending.set(samples.subarray(i, i + n), this.filled);
      this.filled += n;
      i += n;
      if (this.filled === PACKET_SAMPLES) {
        out.push(this.pending);
        this.pending = new Int16Array(PACKET_SAMPLES);
        this.filled = 0;
      }
    }
    return out;
  }

  /**
   * An idle's start (ruling 7): what waits, as one short packet, and the
   * resampler's carry dropped — so the speech before an idle never goes up
   * after its silence. No silence of its own.
   */
  drain(): Int16Array[] {
    const out: Int16Array[] = [];
    if (this.filled > 0) out.push(this.pending.slice(0, this.filled));
    this.pending = new Int16Array(PACKET_SAMPLES);
    this.filled = 0;
    this.resampler.reset();
    return out;
  }

  /**
   * A push-to-talk release (ruling 6): what waits, as one short packet, then
   * 500 ms of silence at once — six 80 ms packets and a 20 ms one.
   */
  tail(): Int16Array[] {
    const out = this.drain();
    for (let left = TAIL_SAMPLES; left > 0; left -= PACKET_SAMPLES) out.push(new Int16Array(Math.min(PACKET_SAMPLES, left)));
    return out;
  }
}
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then the full suite and the gate.
- [ ] **Step 5: Commit.**

```bash
git add src/providers/volcengine_ast2/audioIn.ts src/providers/volcengine_ast2/audioIn.test.ts
```

```bash
git commit -q -F - -- src/providers/volcengine_ast2/audioIn.ts src/providers/volcengine_ast2/audioIn.test.ts <<'EOF'
feat(volcengine_ast2): a streaming 24 to 16 kHz resampler in 80 ms packets

Three samples in, two out, the phase carried across chunks; the pacer
cuts 80 ms packets, and a released turn's tail is what waits plus
500 ms of silence.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

### Task 8: Subtitles as segments, spoken sentences as rangeless clips, the Ogg decoder (rulings 10, 11; choices 3, 18)

**Files:**
- Create: `src/providers/volcengine_ast2/segments.ts`, `src/providers/volcengine_ast2/speech.ts`, `src/providers/volcengine_ast2/decode.ts`
- Test: `src/providers/volcengine_ast2/segments.test.ts`, `src/providers/volcengine_ast2/speech.test.ts`, `src/providers/volcengine_ast2/decode.test.ts`

**Interfaces:**
- Consumes: `AdapterEvents`, `Ref`, `Side`, `SAMPLE_RATE` (`src/lib/contract/adapter`); `describeCause` (`src/lib/diagnostics/describeCause`); `recordEvents` and `flush` (the kit, tests only).
- Produces:
  - `segments.ts`: `type SubtitlePhase = 'start' | 'response' | 'end'`; `type SegmentSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed'>`; `class Ast2Segments { constructor(sink); subtitle(side: Side, phase: SubtitlePhase, text: string): Ref | null; speechRef(): Ref | undefined }` — `subtitle` answers the ref the frame belongs to (for its frame), `speechRef` the translation a spoken sentence belongs to: the one started now, shown or not, else the last one shown.
  - `speech.ts`: `type OggDecoder = (ogg: Uint8Array) => Promise<Int16Array>`; `type SpeechSink = Pick<AdapterEvents, 'audio' | 'degraded'>`; `class Ast2Speech { constructor(decode, sink); sentenceStart(ref: Ref | undefined): void; chunk(data: Uint8Array): void; flush(): { chunks: number; bytes: number }; stop(): void }`.
  - `decode.ts`: `decodeOggOpus(ogg: Uint8Array): Promise<Int16Array>` — 24 kHz mono pcm through an `OfflineAudioContext`.
- Consumed by: Task 15.

Neither side states an `origin` and no segment carries `timing` (choice 3): L2 pairs them by proximity. A segment opens on its first non-empty text, so the server VAD's false starts (a Start and an empty End) emit nothing (survey §1.18.4); refs come from one counter across both sides and are never reused. A spoken sentence's ref is locked at `TTSSentenceStart` to the translation segment started then — shown or not, as the old client locked it to the item it minted at `Start` (`AST2C:646-652, 810-812`) and the survey keeps it (§1.6, §2.10; the controller's ruling on review I3) — else to the last one shown. A segment started but not yet shown still gets its sentence: L1 holds audio for a ref not yet opened (`Conversation.ts`, `pending`), and Task 15's case plays it on that row once it opens. The old client read the ref after its decode's `await`, when the next translation could already have taken its place (survey §1.10, race 1); here it is read at the start, and the decodes run one after another (race 2), each chunk copied as it arrives (protobufjs hands a view into the frame). A decode that fails says `degraded` with `tts_degraded` and plays nothing; `stop()` drops what is still decoding, so nothing is emitted after a stop.

- [ ] **Step 1: Write the failing tests.** `segments.test.ts`, in full:

```ts
import { describe, it, expect } from 'vitest';
import { recordEvents } from '../../lib/contract/events';
import { Ast2Segments } from './segments';

const setup = () => {
  const { events, log } = recordEvents();
  const segments = new Ast2Segments(events);
  const emitted = (): Array<Record<string, unknown>> => log.map((e) => ({ kind: e.kind, ...(e.payload as Record<string, unknown>) }));
  return { segments, emitted };
};

describe("Doubao's subtitles as segments", () => {
  it('opens a side on its first text, sends each snapshot whole, and closes it at End — no origin, no timing (choice 3)', () => {
    const { segments, emitted } = setup();
    expect(segments.subtitle('source', 'start', '')).toBe(1);
    expect(emitted()).toEqual([]);
    segments.subtitle('source', 'response', '你好');
    segments.subtitle('source', 'response', '你好，今天');
    expect(segments.subtitle('source', 'end', '你好，今天怎么样？')).toBe(1);
    expect(emitted()).toEqual([
      { kind: 'segmentOpened', ref: 1, side: 'source' },
      { kind: 'segmentText', ref: 1, text: '你好' },
      { kind: 'segmentText', ref: 1, text: '你好，今天' },
      { kind: 'segmentText', ref: 1, text: '你好，今天怎么样？' },
      { kind: 'segmentClosed', ref: 1 },
    ]);
  });

  it('keeps the two sides apart, on one counter, and never reuses a ref', () => {
    const { segments, emitted } = setup();
    segments.subtitle('source', 'start', '');
    segments.subtitle('translation', 'start', '');
    segments.subtitle('source', 'end', 'A');
    segments.subtitle('translation', 'end', 'B');
    segments.subtitle('source', 'start', '');
    segments.subtitle('source', 'end', 'C');
    const opened = emitted().filter((e) => e.kind === 'segmentOpened');
    expect(opened).toEqual([
      { kind: 'segmentOpened', ref: 1, side: 'source' },
      { kind: 'segmentOpened', ref: 2, side: 'translation' },
      { kind: 'segmentOpened', ref: 3, side: 'source' },
    ]);
  });

  it("drops the server VAD's false start: a Start and an empty End with nothing shown emit nothing", () => {
    const { segments, emitted } = setup();
    segments.subtitle('source', 'start', '');
    segments.subtitle('source', 'response', '');
    expect(segments.subtitle('source', 'end', '')).toBe(1);
    expect(emitted()).toEqual([]);
  });

  it('closes a shown segment whose End came empty with the text it had (survey §1.18.4)', () => {
    const { segments, emitted } = setup();
    segments.subtitle('translation', 'start', '');
    segments.subtitle('translation', 'response', 'Hello');
    segments.subtitle('translation', 'end', '');
    expect(emitted()).toEqual([
      { kind: 'segmentOpened', ref: 1, side: 'translation' },
      { kind: 'segmentText', ref: 1, text: 'Hello' },
      { kind: 'segmentClosed', ref: 1 },
    ]);
  });

  it('gives Responses with no Start one segment, not one per frame (survey §1.18.3), and an End with no Start its own', () => {
    const { segments, emitted } = setup();
    segments.subtitle('source', 'response', 'a');
    segments.subtitle('source', 'response', 'ab');
    segments.subtitle('source', 'end', 'abc');
    segments.subtitle('source', 'end', 'lone');
    expect(emitted().filter((e) => e.kind === 'segmentOpened').map((e) => e.ref)).toEqual([1, 2]);
    expect(emitted().filter((e) => e.kind === 'segmentClosed').map((e) => e.ref)).toEqual([1, 2]);
  });

  it('closes a segment whose End never came when the next Start arrives, and drops one never shown', () => {
    const { segments, emitted } = setup();
    segments.subtitle('source', 'start', '');
    segments.subtitle('source', 'response', 'cut off');
    segments.subtitle('source', 'start', '');
    segments.subtitle('source', 'start', '');
    segments.subtitle('source', 'end', 'next');
    expect(emitted()).toEqual([
      { kind: 'segmentOpened', ref: 1, side: 'source' },
      { kind: 'segmentText', ref: 1, text: 'cut off' },
      { kind: 'segmentClosed', ref: 1 },
      { kind: 'segmentOpened', ref: 3, side: 'source' },
      { kind: 'segmentText', ref: 3, text: 'next' },
      { kind: 'segmentClosed', ref: 3 },
    ]);
  });

  it('names the translation a spoken sentence belongs to: the one started now, shown or not, else the last one shown (ruling 10)', () => {
    const { segments } = setup();
    expect(segments.speechRef()).toBeUndefined();
    segments.subtitle('translation', 'start', '');
    // Started, no text yet: the sentence is this translation's, as the old client locked it at Start.
    expect(segments.speechRef()).toBe(1);
    segments.subtitle('translation', 'response', 'Hi');
    expect(segments.speechRef()).toBe(1);
    segments.subtitle('translation', 'end', 'Hi.');
    expect(segments.speechRef()).toBe(1);
    segments.subtitle('translation', 'start', '');
    expect(segments.speechRef()).toBe(2);
    // A false start releases its ref: the last one shown again.
    segments.subtitle('translation', 'end', '');
    expect(segments.speechRef()).toBe(1);
    // Source subtitles never move it.
    segments.subtitle('source', 'start', '');
    expect(segments.speechRef()).toBe(1);
  });
});
```

  `speech.test.ts`, in full:

```ts
import { describe, it, expect, vi } from 'vitest';
import { flush } from '../../lib/contract/testing/drive';
import { recordEvents } from '../../lib/contract/events';
import { Ast2Speech, type OggDecoder } from './speech';

/** A decoder whose answers the test releases one by one: a clip's pcm has one sample per byte. */
function heldDecoder() {
  const waiting: Array<{ clip: Uint8Array; release(): void; fail(error: Error): void }> = [];
  const decode: OggDecoder = (clip) => new Promise((resolve, reject) => {
    waiting.push({ clip, release: () => resolve(new Int16Array(clip.length).fill(clip[0])), fail: reject });
  });
  return { decode, waiting };
}

const setup = (decode: OggDecoder) => {
  const { events, log } = recordEvents();
  return { speech: new Ast2Speech(decode, events), log, audio: () => log.filter((e) => e.kind === 'audio').map((e) => e.payload as { pcm: Int16Array; ref?: number }) };
};

describe("Doubao's spoken sentences (ruling 10)", () => {
  it('decodes the chunks of one sentence as one clip, emitted rangeless on the ref locked at its start', async () => {
    const decode = vi.fn(async (clip: Uint8Array) => new Int16Array(clip.length));
    const { speech, audio } = setup(decode);
    speech.sentenceStart(2);
    speech.chunk(new Uint8Array([1, 1]));
    speech.chunk(new Uint8Array([2, 2, 2]));
    expect(speech.flush()).toEqual({ chunks: 2, bytes: 5 });
    await flush();
    expect(Array.from(decode.mock.calls[0][0])).toEqual([1, 1, 2, 2, 2]);
    expect(audio()).toEqual([{ pcm: new Int16Array(5), ref: 2 }]);
    expect(audio()[0]).not.toHaveProperty('range');
  });

  it("copies each chunk: the codec's data is a view into a buffer it reuses", async () => {
    const decode = vi.fn(async (clip: Uint8Array) => new Int16Array(clip.length));
    const { speech } = setup(decode);
    const buffer = new Uint8Array([9, 9, 9, 9]);
    speech.sentenceStart(1);
    speech.chunk(buffer.subarray(0, 2));
    buffer.fill(0);
    speech.flush();
    await flush();
    expect(Array.from(decode.mock.calls[0][0])).toEqual([9, 9]);
  });

  it('keeps the first sentence on its own ref when the next one starts during its decode, and keeps the order', async () => {
    const { decode, waiting } = heldDecoder();
    const { speech, audio } = setup(decode);
    speech.sentenceStart(2);
    speech.chunk(new Uint8Array([2]));
    speech.flush();
    speech.sentenceStart(4);
    speech.chunk(new Uint8Array([4, 4]));
    speech.flush();
    await flush();
    // One decode at a time: the second waits for the first.
    expect(waiting).toHaveLength(1);
    waiting[0].release();
    await flush();
    expect(waiting).toHaveLength(2);
    waiting[1].release();
    await flush();
    expect(audio().map((a) => a.ref)).toEqual([2, 4]);
  });

  it('flushes a sentence left unended when the next one starts, on its own ref', async () => {
    const decode = vi.fn(async (clip: Uint8Array) => new Int16Array(clip.length));
    const { speech, audio } = setup(decode);
    speech.sentenceStart(1);
    speech.chunk(new Uint8Array([1]));
    speech.sentenceStart(3);
    speech.chunk(new Uint8Array([3, 3]));
    speech.flush();
    await flush();
    expect(audio().map((a) => [a.ref, a.pcm.length])).toEqual([[1, 1], [3, 2]]);
  });

  it('plays a sentence with no translation shown yet with no ref, and decodes nothing for an empty one', async () => {
    const decode = vi.fn(async (clip: Uint8Array) => new Int16Array(clip.length));
    const { speech, audio } = setup(decode);
    speech.sentenceStart(undefined);
    speech.chunk(new Uint8Array([1]));
    speech.flush();
    expect(speech.flush()).toEqual({ chunks: 0, bytes: 0 });
    await flush();
    expect(decode).toHaveBeenCalledTimes(1);
    expect(audio()).toEqual([{ pcm: new Int16Array(1) }]);
  });

  it("says tts_degraded when a clip will not decode, and goes on with the next (reason 'tts_decode')", async () => {
    const { decode, waiting } = heldDecoder();
    const { speech, log, audio } = setup(decode);
    speech.sentenceStart(1);
    speech.chunk(new Uint8Array([1]));
    speech.flush();
    speech.sentenceStart(3);
    speech.chunk(new Uint8Array([3]));
    speech.flush();
    await flush();
    waiting[0].fail(new Error('EncodingError'));
    await flush();
    waiting[1].release();
    await flush();
    const degraded = log.filter((e) => e.kind === 'degraded').map((e) => e.payload as { code: string; reason?: string; message: string });
    expect(degraded).toEqual([{ code: 'tts_degraded', reason: 'tts_decode', message: 'A spoken sentence from Doubao could not be decoded: EncodingError', cause: expect.any(Error) }]);
    expect(audio().map((a) => a.ref)).toEqual([3]);
  });

  it('emits nothing after stop, a decode still running included', async () => {
    const { decode, waiting } = heldDecoder();
    const { speech, log } = setup(decode);
    speech.sentenceStart(1);
    speech.chunk(new Uint8Array([1]));
    speech.flush();
    speech.chunk(new Uint8Array([2]));
    speech.stop();
    await flush();
    waiting[0].release();
    await flush();
    expect(log).toEqual([]);
    expect(speech.flush()).toEqual({ chunks: 0, bytes: 0 });
  });
});
```

  `decode.test.ts`, in full:

```ts
import { afterEach, describe, it, expect, vi } from 'vitest';
import { decodeOggOpus } from './decode';

/** An `OfflineAudioContext` stand-in: records what it was built with and handed, and decodes to fixed samples. */
function stubContext(samples: number[]) {
  const made: Array<{ channels: number; length: number; rate: number; bytes: number[] }> = [];
  vi.stubGlobal('OfflineAudioContext', class {
    private readonly entry: (typeof made)[number];
    constructor(channels: number, length: number, rate: number) {
      this.entry = { channels, length, rate, bytes: [] };
      made.push(this.entry);
    }
    async decodeAudioData(buffer: ArrayBuffer) {
      this.entry.bytes = Array.from(new Uint8Array(buffer));
      return { getChannelData: () => Float32Array.from(samples) };
    }
  });
  return made;
}

afterEach(() => vi.unstubAllGlobals());

describe('decodeOggOpus', () => {
  it('decodes through an offline context at the contract rate, mono, handing it exactly the clip', async () => {
    const made = stubContext([0]);
    const backing = new Uint8Array([7, 1, 2, 3, 7]);
    await decodeOggOpus(backing.subarray(1, 4));
    expect(made).toEqual([{ channels: 1, length: 1, rate: 24_000, bytes: [1, 2, 3] }]);
    // The clip passed in is left whole: the decoder took a copy.
    expect(Array.from(backing)).toEqual([7, 1, 2, 3, 7]);
  });

  it('turns the float samples into Int16, clipped to full scale', async () => {
    stubContext([0, 0.5, -0.5, 1, -1, 2, -2]);
    expect(Array.from(await decodeOggOpus(new Uint8Array([1])))).toEqual([0, 16383, -16384, 32767, -32768, 32767, -32768]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/providers/volcengine_ast2/segments.test.ts src/providers/volcengine_ast2/speech.test.ts src/providers/volcengine_ast2/decode.test.ts` — FAIL: no modules.
- [ ] **Step 3: Implement.** `segments.ts`, in full:

```ts
/**
 * Doubao's subtitles as segments (survey §2.10): each side's
 * `*SubtitleStart` / `Response` / `End` becomes one segment, opened when it
 * first has text, its text a snapshot, closed at `End`. No origin and no
 * timing (choice 3): L2 pairs the two sides by proximity (F16). Pure: the
 * adapter hands it each subtitle and forwards what it emits.
 */
import type { AdapterEvents, Ref, Side } from '../../lib/contract/adapter';

export type SubtitlePhase = 'start' | 'response' | 'end';

export type SegmentSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed'>;

interface SideState {
  /** Allocated at `Start` (or the first text), released at `End`. */
  ref: Ref | null;
  opened: boolean;
  text: string;
}

const idle = (): SideState => ({ ref: null, opened: false, text: '' });

export class Ast2Segments {
  private next: Ref = 1;
  private readonly sides: Record<Side, SideState> = { source: idle(), translation: idle() };
  private lastTranslation: Ref | undefined;

  constructor(private readonly sink: SegmentSink) {}

  /**
   * One subtitle message; answers the side's ref after it — null when it
   * has none — for the adapter's frame.
   * - `start`: the previous segment of the side closes as it stands (its
   *   `End` never came) or, never shown, is dropped; a ref is allocated,
   *   and nothing is emitted until text arrives.
   * - `response`: the whole text so far. A `Response` with no `Start`
   *   allocates once, not once per frame (survey §1.18.3); an empty one
   *   shows nothing.
   * - `end`: the final text, then the close. An empty `End` of a segment
   *   never shown is the server VAD's false start: nothing; of one shown, it
   *   closes with the text it had (survey §1.18.4).
   */
  subtitle(side: Side, phase: SubtitlePhase, text: string): Ref | null {
    const state = this.sides[side];
    if (phase === 'start') {
      this.finish(side);
      state.ref = this.next++;
      return state.ref;
    }
    if (text) this.show(side, text);
    const ref = state.ref;
    if (phase === 'end') this.finish(side);
    return ref;
  }

  /**
   * The translation a spoken sentence belongs to (ruling 10): the one
   * started now — shown or not, as the old client locked it to the item it
   * minted at `Start` (`VolcengineAST2Client.ts:646-652, 810-812`) — else the
   * last one shown; none before any. A ref not yet opened is fine: L1 holds
   * its audio until the segment opens (`Conversation.ts`, `pending`).
   */
  speechRef(): Ref | undefined {
    return this.sides.translation.ref ?? this.lastTranslation;
  }

  private show(side: Side, text: string): void {
    const state = this.sides[side];
    if (state.ref === null) state.ref = this.next++;
    if (!state.opened) {
      this.sink.segmentOpened({ ref: state.ref, side });
      state.opened = true;
      if (side === 'translation') this.lastTranslation = state.ref;
    }
    if (text !== state.text) {
      this.sink.segmentText({ ref: state.ref, text });
      state.text = text;
    }
  }

  private finish(side: Side): void {
    const state = this.sides[side];
    if (state.ref !== null && state.opened) this.sink.segmentClosed({ ref: state.ref });
    // In place: `subtitle` still holds this state object.
    Object.assign(state, idle());
  }
}
```

  `speech.ts`, in full:

```ts
/**
 * Doubao's spoken sentences (ruling 10; survey §1.8): the `TTSResponse`
 * chunks between `TTSSentenceStart` and `TTSSentenceEnd` are one Ogg Opus
 * clip, decoded whole and emitted as one rangeless `audio` — replay, no
 * karaoke — on the translation it was locked to when the sentence started.
 * Decodes run one after another, so clips arrive in order; the old client's
 * two races are not ported: it read its target after the decode's `await`,
 * and let decodes overtake (survey §1.18.2). Pure: the decoder is injected.
 */
import type { AdapterEvents, Ref } from '../../lib/contract/adapter';
import { describeCause } from '../../lib/diagnostics/describeCause';

/** A clip's Ogg Opus as the contract's 24 kHz mono Int16. */
export type OggDecoder = (ogg: Uint8Array) => Promise<Int16Array>;

export type SpeechSink = Pick<AdapterEvents, 'audio' | 'degraded'>;

export class Ast2Speech {
  private chunks: Uint8Array[] = [];
  private ref: Ref | undefined;
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly decode: OggDecoder, private readonly sink: SpeechSink) {}

  /** `TTSSentenceStart`: the sentence belongs to `ref` (the translation shown now, or the last one shown), locked now. A sentence left unended is flushed first. */
  sentenceStart(ref: Ref | undefined): void {
    this.flush();
    this.ref = ref;
  }

  /** `TTSResponse`: a copy — the codec's `data` is a view into its decode buffer (`VolcengineAST2Client.ts:877-885`). */
  chunk(data: Uint8Array): void {
    // `new Uint8Array(view)` copies; a Node `Buffer` view's own `slice` would not.
    if (data.length > 0) this.chunks.push(new Uint8Array(data));
  }

  /** `TTSSentenceEnd`, or `TTSEnded` for what is left: the clip goes to the decoder; answers what it held, for the adapter's frame. */
  flush(): { chunks: number; bytes: number } {
    const held = this.chunks;
    this.chunks = [];
    const bytes = held.reduce((n, c) => n + c.length, 0);
    if (bytes === 0) return { chunks: 0, bytes: 0 };
    const clip = new Uint8Array(bytes);
    let at = 0;
    for (const c of held) { clip.set(c, at); at += c.length; }
    const ref = this.ref;
    this.chain = this.chain
      .then(() => this.decode(clip))
      .then(
        (pcm) => { if (!this.stopped && pcm.length > 0) this.sink.audio(ref === undefined ? { pcm } : { pcm, ref }); },
        (error: unknown) => {
          if (!this.stopped) this.sink.degraded({ code: 'tts_degraded', message: `A spoken sentence from Doubao could not be decoded: ${describeCause(error)}`, cause: error, reason: 'tts_decode' });
        },
      );
    return { chunks: held.length, bytes };
  }

  /** Stop, a failure or a close: nothing more is emitted, a decode still running included. */
  stop(): void {
    this.stopped = true;
    this.chunks = [];
  }
}
```

  `decode.ts`, in full:

```ts
/**
 * A spoken sentence's Ogg Opus as the contract's audio (24 kHz mono Int16).
 * An `OfflineAudioContext` decodes it — it resamples to its own rate — so no
 * output device is opened for it (the old client opened an `AudioContext`,
 * survey §1.18.11). The adapter's default decoder; tests inject their own.
 */
import { SAMPLE_RATE } from '../../lib/contract/adapter';

export async function decodeOggOpus(ogg: Uint8Array): Promise<Int16Array> {
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  // `decodeAudioData` takes, and detaches, an ArrayBuffer: exactly this clip's bytes, copied.
  const decoded = await context.decodeAudioData(new Uint8Array(ogg).buffer);
  const float = decoded.getChannelData(0);
  const pcm = new Int16Array(float.length);
  for (let i = 0; i < float.length; i++) {
    const s = Math.max(-1, Math.min(1, float[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm;
}
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then the full suite and the gate.
- [ ] **Step 5: Commit.**

```bash
git add src/providers/volcengine_ast2/segments.ts src/providers/volcengine_ast2/segments.test.ts src/providers/volcengine_ast2/speech.ts src/providers/volcengine_ast2/speech.test.ts src/providers/volcengine_ast2/decode.ts src/providers/volcengine_ast2/decode.test.ts
```

```bash
git commit -q -F - -- src/providers/volcengine_ast2/segments.ts src/providers/volcengine_ast2/segments.test.ts src/providers/volcengine_ast2/speech.ts src/providers/volcengine_ast2/speech.test.ts src/providers/volcengine_ast2/decode.ts src/providers/volcengine_ast2/decode.test.ts <<'EOF'
feat(volcengine_ast2): subtitles as segments, sentences as rangeless clips

Doubao's Start/Response/End subtitles become segments with no stated
origin, L2 pairing them; each spoken sentence is one clip on the
translation locked at its start, its Ogg Opus decoded in order.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

### Task 9: The provider store keeps the user's pair and derives the run's (ruling 3; choice 1)

**Files:**
- Modify: `src/stores/providerStore.ts`, `src/lib/session/appShape.ts`, `src/app/session.ts`
- Test: `src/stores/providerStore.test.ts`, `src/lib/session/appShape.test.ts`, `src/app/session.test.ts`

**Interfaces:**
- Consumes: Task 3 — `languageContext`, `SpeechInputs`, `normalizePair(…, context?)`, `LanguageContext`.
- Produces:
  - `providerStore`: `ProviderEntry.stored?: LanguagePair` (the user's pair while the context narrows it away; absent when it is `pair`); `speech: SpeechInputs` (`{ textOnly: false, participantSpeech: false }` until kept); `setSpeech(inputs: SpeechInputs): void`; `setLegs` now also derives every pair again. `load`, `updateSettings` and `setPair` keep what they write — the user's pair, normalized within the widest offer — and derive `pair` from it.
  - `appShape`: `participantSpeechSwitchFromStores(): boolean` (the switch and a source that will not recapture it, before the provider's flag); `speechInputsFromStores(): SpeechInputs`; `watchSpeechFromStores(): () => void` (applies now and on every settings, routing or audio store change); `participantSpeechFromStores(provider)` unchanged in what it answers.
  - `app/session.ts`: `attach()` starts `watchSpeechFromStores()` beside `watchLegsFromStores()`, and `detach` stops it.
- Consumed by: Task 11 (the surfaces read `legs`, `speech` and `participantSpeechSwitchFromStores`), Task 16 (an old profile's text-only pair).

A derived pair is never written: a context change (Text only switched, a mode with the participant, its speech switch) moves `pair` and back again with no `setSetting`, and forgets the readiness of each provider whose pair moved, since a check reads the pair. `setSpeech` and `setLegs` ignore inputs that did not change, so the whole-store listeners cost nothing. The definition of each loaded entry is kept in a module map, as the store's other per-provider maps are, so a context change can derive pairs without a provider argument. The speech inputs load in parallel with the providers (the settings store's `textOnly` loads on its own), so the derivation holds either way round — a case pins it.

- [ ] **Step 1: Write the failing tests.** `providerStore.test.ts` — the type import gains `LanguageContext`, and a `describe` before `describe('refreshReadiness'` (the Gemini plan's Task 1 added its legacy cases above it, landed as `f979db5c`; `probe`, `ProbeSettings`, `opt` and `entry()` are the file's own):

```diff
--- a/src/stores/providerStore.test.ts
+++ b/src/stores/providerStore.test.ts
@@ -1,6 +1,6 @@
 import { describe, it, expect, beforeEach, vi } from 'vitest';
-import type { AnyProvider, CheckContext, LanguageOption, LanguagePair, MigrationInputs } from '../lib/provider/types';
+import type { AnyProvider, CheckContext, LanguageContext, LanguageOption, LanguagePair, MigrationInputs } from '../lib/provider/types';
 
 const { stored, getSetting, setSetting } = vi.hoisted(() => {
   const stored = new Map<string, unknown>();
   return {
@@ -303,8 +303,106 @@
     off();
   });
 });
 
+describe('the language context (Stage 2 Volcengine AST2, choice 1)', () => {
+  /** Speaking offers en and ja; text also ko — Doubao AST 2.0's shape. */
+  const offered = (context?: LanguageContext) => [opt('en'), opt('ja'), ...(context?.speech ? [] : [opt('ko')])];
+  const moody = {
+    ...probe,
+    id: 'moody',
+    speech: 'optional',
+    settings: { key: 'moody', defaults: probe.settings.defaults },
+    languages: {
+      sources: (_s: ProbeSettings, context?: LanguageContext) => offered(context),
+      targets: (source: string, _s: ProbeSettings, context?: LanguageContext) => offered(context).filter((o) => o.value !== source),
+    },
+  } as unknown as AnyProvider;
+  const moodyEntry = () => useProviderStore.getState().entries.moody;
+  const speaking = { textOnly: false, participantSpeech: false };
+  const textOnly = { textOnly: true, participantSpeech: false };
+  const pairWrites = () => setSetting.mock.calls.filter(([key]) => /Language$/.test(String(key)));
+
+  beforeEach(() => {
+    useProviderStore.setState({ legs: ['speaker'], speech: speaking, readiness: {} });
+    stored.set('settings.moody.sourceLanguage', 'ko');
+    stored.set('settings.moody.targetLanguage', 'en');
+  });
+
+  it("derives the pair a speaking run can start from a text-only one, keeping the user's as stored, writing nothing", async () => {
+    await useProviderStore.getState().load(moody);
+    expect(moodyEntry().pair).toEqual({ source: 'en', target: 'ja' });
+    expect(moodyEntry().stored).toEqual({ source: 'ko', target: 'en' });
+    expect(pairWrites()).toEqual([]);
+  });
+
+  it("brings the stored pair back when the run stops speaking, and drops it from the entry: it is the pair again", async () => {
+    await useProviderStore.getState().load(moody);
+    useProviderStore.getState().setSpeech(textOnly);
+    expect(moodyEntry().pair).toEqual({ source: 'ko', target: 'en' });
+    expect(moodyEntry()).not.toHaveProperty('stored');
+    useProviderStore.getState().setSpeech(speaking);
+    expect(moodyEntry().pair).toEqual({ source: 'en', target: 'ja' });
+    expect(pairWrites()).toEqual([]);
+  });
+
+  it('reads the legs as part of the context: a participant-only run with its switch off does not speak', async () => {
+    await useProviderStore.getState().load(moody);
+    useProviderStore.getState().setLegs(['participant']);
+    expect(moodyEntry().pair).toEqual({ source: 'ko', target: 'en' });
+    useProviderStore.getState().setSpeech({ textOnly: false, participantSpeech: true });
+    expect(moodyEntry().pair).toEqual({ source: 'en', target: 'ja' });
+  });
+
+  it('derives the same pair whichever lands first, the load or the inputs', async () => {
+    useProviderStore.getState().setSpeech(textOnly);
+    await useProviderStore.getState().load(moody);
+    expect(moodyEntry().pair).toEqual({ source: 'ko', target: 'en' });
+    useProviderStore.setState({ entries: {} });
+    useProviderStore.getState().setSpeech(speaking);
+    await useProviderStore.getState().load(moody);
+    useProviderStore.getState().setSpeech(textOnly);
+    expect(moodyEntry().pair).toEqual({ source: 'ko', target: 'en' });
+  });
+
+  it('keeps a pick as picked — one the context cannot run stays stored for the one that can — and persists it', async () => {
+    stored.clear();
+    await useProviderStore.getState().load(moody);
+    useProviderStore.getState().setPair(moody, { source: 'ko', target: 'ja' });
+    expect(moodyEntry().pair).toEqual({ source: 'en', target: 'ja' });
+    expect(moodyEntry().stored).toEqual({ source: 'ko', target: 'ja' });
+    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.moody.sourceLanguage', 'ko'));
+    // A pick the context runs is the pair, and nothing is kept beside it.
+    useProviderStore.getState().setPair(moody, { source: 'ja', target: 'en' });
+    expect(moodyEntry().pair).toEqual({ source: 'ja', target: 'en' });
+    expect(moodyEntry()).not.toHaveProperty('stored');
+  });
+
+  it("keeps the stored pair across a settings edit, writing only the settings", async () => {
+    await useProviderStore.getState().load(moody);
+    useProviderStore.getState().updateSettings(moody, { count: 2 });
+    expect(moodyEntry().stored).toEqual({ source: 'ko', target: 'en' });
+    expect(moodyEntry().pair).toEqual({ source: 'en', target: 'ja' });
+    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.moody.count', 2));
+    expect(pairWrites()).toEqual([]);
+  });
+
+  it("forgets the readiness of a provider whose pair moved, and only that one's; the same inputs change nothing", async () => {
+    await useProviderStore.getState().load(moody);
+    await useProviderStore.getState().load(probe);
+    const ready = { state: 'ready' as const, models: [] };
+    useProviderStore.setState({ readiness: { moody: ready, probe: ready } });
+    const entries = useProviderStore.getState().entries;
+    useProviderStore.getState().setSpeech(speaking);
+    expect(useProviderStore.getState().entries).toBe(entries);
+    useProviderStore.getState().setSpeech(textOnly);
+    expect(useProviderStore.getState().readiness.moody).toEqual({ state: 'unknown' });
+    expect(useProviderStore.getState().readiness.probe).toBe(ready);
+    // A provider whose languages ignore the context never carries a stored pair.
+    expect(entry()).not.toHaveProperty('stored');
+  });
+});
+
 describe('refreshReadiness', () => {
   const auth = { signedIn: false, getToken: async () => null };
 
   it('asks check about the pair, and forgets readiness when the pair changes', async () => {
```

  `appShape.test.ts` — the import, the `beforeEach` store state, and a `describe` before the `liveGate` one:

```diff
--- a/src/lib/session/appShape.test.ts
+++ b/src/lib/session/appShape.test.ts
@@ -27,15 +27,15 @@
 import { useProviderStore } from '../../stores/providerStore';
 import { useSettingsStore } from '../../stores/settingsStore';
 import { useTurnModeStore } from '../../stores/turnModeStore';
 import { useRoutingStore } from '../../stores/routingStore';
-import { ensureReadyFromStores, legsFor, liveGate, participantSpeechFromStores, persistIfUnchanged, readShapeFromStores, watchLegsFromStores } from './appShape';
+import { ensureReadyFromStores, legsFor, liveGate, participantSpeechFromStores, participantSpeechSwitchFromStores, persistIfUnchanged, readShapeFromStores, speechInputsFromStores, watchLegsFromStores, watchSpeechFromStores } from './appShape';
 import type { RunShape } from './types';
 
 const auth = { signedIn: false, getToken: async () => null };
 
 beforeEach(() => {
-  useProviderStore.setState({ entries: {}, readiness: {}, selected: null, legs: ['speaker'] });
+  useProviderStore.setState({ entries: {}, readiness: {}, selected: null, legs: ['speaker'], speech: { textOnly: false, participantSpeech: false } });
   useTurnModeStore.setState({ turnMode: 'auto' });
   useRoutingStore.setState({ participantSpeech: false });
   useAudioStore.setState({ selectedParticipantSource: useAudioStore.getInitialState().selectedParticipantSource });
   useAccountStore.setState({ account: null });
@@ -198,8 +198,34 @@
     expect(useProviderStore.getState().legs).toEqual(['speaker', 'participant']);
   });
 });
 
+describe('speechInputsFromStores and watchSpeechFromStores (Stage 2 Volcengine AST2, choice 1)', () => {
+  it("reads the text-only switch and the participant's speech: its switch, and a source that will not recapture it", () => {
+    expect(speechInputsFromStores()).toEqual({ textOnly: false, participantSpeech: false });
+    expect(participantSpeechSwitchFromStores()).toBe(false);
+    useSettingsStore.setState({ textOnly: true });
+    useRoutingStore.setState({ participantSpeech: true });
+    expect(speechInputsFromStores()).toEqual({ textOnly: true, participantSpeech: true });
+    environment.value = 'electron';
+    useAudioStore.setState({ selectedParticipantSource: { deviceId: 'desktop-audio-loopback', label: 'System' } });
+    expect(speechInputsFromStores().participantSpeech).toBe(false);
+    expect(participantSpeechSwitchFromStores()).toBe(false);
+  });
+
+  it("keeps the provider store's speech inputs on the stores', now and on every change, until unsubscribed", () => {
+    useSettingsStore.setState({ textOnly: true });
+    const unwatch = watchSpeechFromStores();
+    expect(useProviderStore.getState().speech).toEqual({ textOnly: true, participantSpeech: false });
+    useSettingsStore.setState({ textOnly: false });
+    useRoutingStore.setState({ participantSpeech: true });
+    expect(useProviderStore.getState().speech).toEqual({ textOnly: false, participantSpeech: true });
+    unwatch();
+    useSettingsStore.setState({ textOnly: true });
+    expect(useProviderStore.getState().speech).toEqual({ textOnly: false, participantSpeech: true });
+  });
+});
+
 // Stage 2 foundation, F7: the runner's start gate over the stores as they
 // stand, so the surfaces keep Start off and say why before it is pressed.
 describe('liveGate', () => {
   const loadFake = (pair: { source: string; target: string }) => useProviderStore.setState({
```

  `session.test.ts`, before "checks a local provider by itself":

```diff
--- a/src/app/session.test.ts
+++ b/src/app/session.test.ts
@@ -434,8 +434,21 @@
 
     detach();
   });
 
+  it("keeps the provider store's speech inputs on the text-only switch, only while attached (Stage 2 Volcengine AST2, choice 1)", async () => {
+    const { session } = await setup();
+    useSettingsStore.setState({ textOnly: false });
+    const detach = session.attach();
+
+    useSettingsStore.setState({ textOnly: true });
+    expect(useProviderStore.getState().speech.textOnly).toBe(true);
+
+    detach();
+    useSettingsStore.setState({ textOnly: false });
+    expect(useProviderStore.getState().speech.textOnly).toBe(true);
+  });
+
   it('checks a local provider by itself', async () => {
     const { session, clock } = await setup();
     const spy = vi.fn(async () => ({ state: 'unknown' as const }));
     useProviderStore.setState({
```

- [ ] **Step 2: Run** `npx vitest run src/stores/providerStore.test.ts src/lib/session/appShape.test.ts src/app/session.test.ts` — FAIL: no `setSpeech`, no `speech`, no `stored`; the three `appShape` functions are not exported.
- [ ] **Step 3: Implement.** `providerStore.ts` — six hunks; the `load` hunk anchors on `const legacy = Object.fromEntries(…)`, which the Gemini plan's Task 1 left as it was (`f979db5c`; it edited the read two lines above):

```diff
--- a/src/stores/providerStore.ts
+++ b/src/stores/providerStore.ts
@@ -10,8 +10,9 @@
 import { describeCause, reportError, reportWarning } from '../lib/diagnostics/report';
 import { isMissing, readCredentials } from '../lib/provider/credentials';
 import { normalizePair } from '../lib/provider/languages';
 import type { AnyProvider, AuthContext, CredentialValues, LanguagePair, ModelOption, Readiness } from '../lib/provider/types';
+import { languageContext, type SpeechInputs } from '../lib/session/shape';
 import { selectionToPersist } from '../lib/session/storedSettings';
 import { persistSetting } from '../services/persistSetting';
 import { ServiceFactory } from '../services/ServiceFactory';
 
@@ -20,9 +21,18 @@
   /** The provider's `S`; generic code never looks inside. */
   settings: unknown;
   /** Every key in `credentials.keys`; '' where nothing is saved. */
   credentials: CredentialValues;
+  /** The pair the surfaces show and a run starts: the stored pair, within what the store's language context offers. */
   pair: LanguagePair;
+  /**
+   * The pair as the user left it, while the language context narrows it
+   * away (Stage 2 Volcengine AST2, choice 1): Doubao's text-only Korean
+   * while a run would speak. Absent when it is `pair` — for every provider
+   * whose languages ignore the context. It is what persists: a context
+   * change derives `pair` from it again, and writes nothing.
+   */
+  stored?: LanguagePair;
 }
 
 export type { Readiness } from '../lib/provider/types';
 
@@ -61,10 +71,14 @@
   /** Forgets `p`'s readiness — a sign-in flip, for a managed provider: it is unknown, and a check still in flight no longer counts. The last ready answer, kept with its inputs, stays: a check for exactly those inputs is served from it. */
   forgetReadiness(p: Pick<AnyProvider, 'id'>): void;
   /** The legs a start would open now, speaker first (appShape's `watchLegsFromStores` keeps them); the speaker alone until then. */
   legs: readonly LegName[];
-  /** Other legs change what a check answers: every loaded provider's readiness is forgotten. The same legs change nothing. */
+  /** Other legs change what a check answers: every loaded provider's readiness is forgotten, and each pair derived again for the new language context. The same legs change nothing. */
   setLegs(legs: readonly LegName[]): void;
+  /** Whether a run would speak besides its legs (appShape's `watchSpeechFromStores` keeps it): with the legs, each provider's language context (Stage 2 Volcengine AST2, choice 1). Nothing speaks until it is kept. */
+  speech: SpeechInputs;
+  /** Every loaded entry's pair is derived again from its stored pair, nothing written; a provider whose pair moved forgets its readiness. The same inputs change nothing. */
+  setSpeech(inputs: SpeechInputs): void;
   /** The provider the panel shows and a run starts. A person's pick persists (old enum spelling, `storedSettings.ts`); a load never writes (1e-3 ruling 2). */
   selected: string | null;
   /** Refused, with a warning, while `selectionLocked`. */
   select(id: string, how?: 'load' | 'pick'): void;
@@ -89,8 +103,10 @@
 /** The latest check per provider: a check that finishes after a newer one began, or after its inputs changed, stays out of the store (a run's own check still gets its answer back). */
 const checkSeq = new Map<string, number>();
 /** The last answer per network provider, with the inputs it answered. */
 const lastAnswer = new Map<string, { inputs: string; readiness: Readiness }>();
+/** The definition each entry was loaded from: what a language context change derives its pair with. */
+const loadedProviders = new Map<string, AnyProvider>();
 
 export const useProviderStore = create<ProviderStore>()((set, get) => {
   /** Writing to a provider before `load` resolves is a bug in the caller. */
   const loaded = (p: AnyProvider): ProviderEntry => {
@@ -117,8 +133,29 @@
   const forgetReadiness = (p: Pick<AnyProvider, 'id'>) => {
     supersede(p);
     setReadiness(p, UNKNOWN);
   };
+  /**
+   * An entry's pair from the pair the user left: within the languages the
+   * store's context offers (Stage 2 Volcengine AST2, choice 1); `stored`
+   * kept only where the two differ.
+   */
+  const derive = (p: AnyProvider, settings: unknown, stored: LanguagePair): Pick<ProviderEntry, 'pair' | 'stored'> => {
+    const pair = normalizePair(p, settings, stored, languageContext(p, get().legs, get().speech));
+    return pair.source === stored.source && pair.target === stored.target ? { pair } : { pair, stored };
+  };
+  /** The context moved: every loaded entry's pair derived again, nothing written. */
+  const rederive = () => {
+    for (const [id, entry] of Object.entries(get().entries)) {
+      const p = loadedProviders.get(id);
+      if (!p) continue;
+      const next = derive(p, entry.settings, entry.stored ?? entry.pair);
+      if (next.pair.source === entry.pair.source && next.pair.target === entry.pair.target) continue;
+      put(p, { settings: entry.settings, credentials: entry.credentials, ...next });
+      // The check reads the pair: its answer was about the other one.
+      forgetReadiness(p);
+    }
+  };
 
   return {
     entries: {},
     readiness: {},
@@ -146,8 +183,16 @@
       const now = get().legs;
       if (legs.length === now.length && legs.every((leg, i) => leg === now[i])) return;
       set({ legs });
       for (const id of Object.keys(get().entries)) forgetReadiness({ id });
+      rederive();
+    },
+    speech: { textOnly: false, participantSpeech: false },
+    setSpeech(inputs) {
+      const now = get().speech;
+      if (now.textOnly === inputs.textOnly && now.participantSpeech === inputs.participantSpeech) return;
+      set({ speech: { textOnly: inputs.textOnly, participantSpeech: inputs.participantSpeech } });
+      rederive();
     },
 
     async load(p) {
       const service = ServiceFactory.getSettingsService();
@@ -173,23 +218,23 @@
       const legacy = Object.fromEntries(legacyKeys.map((k, i) => [k, legacyValues[i]]));
       const settings = p.settings.migrate ? p.settings.migrate(stored, { legacy, credentials }) : stored;
       const initial = p.languages.initial?.(settings) ?? {};
       const pair = p.languages.migratePair ? p.languages.migratePair({ source, target }, settings) : { source, target };
-      put(p, {
-        settings,
-        credentials,
-        pair: normalizePair(p, settings, { source: pair.source || initial.source, target: pair.target || initial.target }),
-      });
+      // Kept within the widest offer; what a run starts is derived from it for the context (choice 1). Nothing is written.
+      const kept = normalizePair(p, settings, { source: pair.source || initial.source, target: pair.target || initial.target });
+      loadedProviders.set(p.id, p);
+      put(p, { settings, credentials, ...derive(p, settings, kept) });
     },
 
     updateSettings(p, patch) {
       const entry = loaded(p);
       const settings = { ...(entry.settings as Record<string, unknown>), ...patch };
-      // New settings can change the languages on offer; the pair follows.
-      const pair = normalizePair(p, settings, entry.pair);
-      put(p, { ...entry, settings, pair });
+      // New settings can change the languages on offer; the pair the user left follows them, and the run's pair is derived from it.
+      const before = entry.stored ?? entry.pair;
+      const kept = normalizePair(p, settings, before);
+      put(p, { settings, credentials: entry.credentials, ...derive(p, settings, kept) });
       for (const [field, value] of Object.entries(patch)) void persistSetting(storageKey(p, field), value);
-      persistPair(p, entry.pair, pair);
+      persistPair(p, before, kept);
       forgetReadiness(p);
     },
 
     setCredential(p, key, value) {
@@ -201,11 +246,13 @@
     },
 
     setPair(p, pair) {
       const entry = loaded(p);
-      const next = normalizePair(p, entry.settings, pair);
-      put(p, { ...entry, pair: next });
-      persistPair(p, entry.pair, next);
+      const before = entry.stored ?? entry.pair;
+      // A pick is kept as picked, within the widest offer: one the context cannot run stays stored for the context that can (the wizard's text-only pick while a run would speak).
+      const kept = normalizePair(p, entry.settings, pair);
+      put(p, { settings: entry.settings, credentials: entry.credentials, ...derive(p, entry.settings, kept) });
+      persistPair(p, before, kept);
       forgetReadiness(p);
     },
 
     async refreshReadiness(p, auth, from, signal) {
```

  `appShape.ts` (the Gemini plan's Task 4 edits the `buildSharedSettings` call further down, not these lines):

```diff
--- a/src/lib/session/appShape.ts
+++ b/src/lib/session/appShape.ts
@@ -15,9 +15,9 @@
 import { useTurnModeStore } from '../../stores/turnModeStore';
 import { useRoutingStore } from '../../stores/routingStore';
 import { getEnvironment } from '../../utils/environment';
 import { buildSharedSettings } from './shared';
-import { gate, type Refusal } from './shape';
+import { gate, type Refusal, type SpeechInputs } from './shape';
 import type { RunShape } from './types';
 
 export function legsFor(mode: 'speaker' | 'participant' | 'both'): LegName[] {
   return mode === 'both' ? ['speaker', 'participant'] : [mode];
@@ -41,13 +41,36 @@
  * run's shape, the live gate's floor and the account button's floor all
  * read it, so they price the same legs.
  */
 export function participantSpeechFromStores(provider: Pick<AnyProvider, 'participantSpeech'>): boolean {
-  return provider.participantSpeech !== false
-    && useRoutingStore.getState().participantSpeech
+  return provider.participantSpeech !== false && participantSpeechSwitchFromStores();
+}
+
+/** The participant's speech before its provider's flag: its switch on, and a source that will not recapture it. */
+export function participantSpeechSwitchFromStores(): boolean {
+  return useRoutingStore.getState().participantSpeech
     && participantSpeechHeard(getEnvironment(), useAudioStore.getState().selectedParticipantSource?.deviceId);
 }
 
+/**
+ * Whether a run would speak, besides its legs and its provider, as the
+ * stores stand: the text-only switch and the participant's speech (the
+ * provider's own flag is `languageContext`'s to apply). The provider store
+ * keeps it for the language offer (Stage 2 Volcengine AST2, choice 1).
+ */
+export function speechInputsFromStores(): SpeechInputs {
+  return { textOnly: useSettingsStore.getState().textOnly, participantSpeech: participantSpeechSwitchFromStores() };
+}
+
+/** Keeps the provider store's speech inputs on the stores', now and on every change, so each provider's pair is one its run could start. Returns the unsubscribe. */
+export function watchSpeechFromStores(): () => void {
+  const apply = () => useProviderStore.getState().setSpeech(speechInputsFromStores());
+  apply();
+  // Whole-store listeners: `setSpeech` ignores inputs that did not change.
+  const offs = [useSettingsStore.subscribe(apply), useRoutingStore.subscribe(apply), useAudioStore.subscribe(apply)];
+  return () => { for (const off of offs) off(); };
+}
+
 export function readShapeFromStores(auth: AuthContext): RunShape | null {
   const selected = selectedFromStores();
   if (!selected) return null;
   const { provider, entry } = selected;
```

  `session.ts`:

```diff
--- a/src/app/session.ts
+++ b/src/app/session.ts
@@ -12,9 +12,9 @@
 import { redact } from '../lib/diagnostics/redact';
 import { describeCause, reportWarning } from '../lib/diagnostics/report';
 import { autoSaveConversation } from '../lib/export/appAutoSave';
 import type { AuthContext } from '../lib/provider/types';
-import { appReplayAudio, ensureReadyFromStores, persistIfUnchanged, readShapeFromStores, watchLegsFromStores } from '../lib/session/appShape';
+import { appReplayAudio, ensureReadyFromStores, persistIfUnchanged, readShapeFromStores, watchLegsFromStores, watchSpeechFromStores } from '../lib/session/appShape';
 import type { AnalyticsPort, ControlMethod, FramePort } from '../lib/session/ports';
 import { createRunner, type Runner } from '../lib/session/runner';
 import type { OpenSource } from '../lib/session/source';
 import { appSubtitleSession } from '../lib/subtitle/appSession';
@@ -247,8 +247,10 @@
       attached = true;
       const offs: Array<() => void> = [
         // The panel's readiness is about the legs a start would open: the audio mode's.
         watchLegsFromStores(),
+        // The languages on offer follow whether a start would speak (Stage 2 Volcengine AST2, choice 1).
+        watchSpeechFromStores(),
         driveReadiness({
           runner, providers: () => presentProviders(), auth: () => bridges.auth, clock,
           watchSignIn: (fn) => { signInWatchers.add(fn); return () => { signInWatchers.delete(fn); }; },
         }),
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then `npx vitest run src/stores src/lib/session src/app src/components`, the full suite and the gate. What the change reaches, and why each stays green:
  - every registered provider ignores the context, so `derive` answers the pair `normalizePair` answered, `stored` is never set, and every existing store case sees the same entries and the same writes;
  - zustand's `setState` merges, so a case elsewhere that sets `entries`, `readiness`, `selected` or `legs` keeps the store's `speech` — possibly one an earlier case in its file left, which changes no pair of a provider that ignores the context; this task's cases set it explicitly;
  - `app/session.test.ts`' other cases attach and detach as before; the new watcher subscribes to three stores those cases already drive.
- [ ] **Step 5: Commit.**

```bash
git add src/stores/providerStore.ts src/stores/providerStore.test.ts src/lib/session/appShape.ts src/lib/session/appShape.test.ts src/app/session.ts src/app/session.test.ts
```

```bash
git commit -q -F - -- src/stores/providerStore.ts src/stores/providerStore.test.ts src/lib/session/appShape.ts src/lib/session/appShape.test.ts src/app/session.ts src/app/session.test.ts <<'EOF'
feat(providers): keep the pair the user left, derive the one a run starts

The provider store keeps each provider's stored pair within its widest
offer and derives the pair a run can start from it for the language
context its legs and speech inputs give; a context change writes
nothing, so switching text only off and on loses no pair. The app keeps
the store's speech inputs on the settings, routing and audio stores.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

### Task 10: The credential form draws a credential choice (ruling 1; choice 2; F4)

**Files:**
- Create: `src/components/providers/CredentialChoiceControl.tsx`
- Modify: `src/components/providers/CredentialForm.tsx`, `src/components/providers/ProviderPicker.tsx`, `src/components/Settings/Settings.scss`
- Test: `src/components/providers/CredentialForm.test.tsx`, `src/components/providers/ProviderPicker.test.tsx`, `src/providers/registry.test.ts`

**Interfaces:**
- Consumes: Task 3 — `CredentialChoice`, `Provider.credentials.choice`; the store's `updateSettings`.
- Produces: `CredentialChoiceControl({ options: CredentialChoice['options']; value: string; onChange(value: string): void; disabled?: boolean })` — `.segmented-control`, one `button.segmented-option` per option, `.active` and `aria-pressed` on the chosen one, locked while `disabled`, a click on the chosen one ignored; `CredentialForm`'s `choice?: { options: CredentialChoice['options']; value: string; onChange(value: string): void }` — a `.credential-choice-group` holding the control above the fields; `ProviderPicker` passes the selected provider's choice with the setting's current value and writes a pick through `updateSettings`.
- Consumed by: Task 16 (Doubao's form shows it), Task 17 (the wizard's credential step draws the same control); group check B.

The markup is the old Palabra group's (`ProviderSection.tsx:761-779`) and its rules are shared, not copied: `Settings.scss` lists `.credential-choice-group` beside `.palabraai-credentials-group` (`:1791-1853`), so the column, the gap and the segmented control's fill apply to both; the stylesheet test compiles the SCSS and reads the emitted selectors (never the source). Both layouts draw `ProviderPicker`, so the choice shows in the simple and the advanced layout alike. A pick is a settings edit: it persists `settings.<key>.<setting>`, keeps both modes' credentials stored, and forgets the readiness, so the driver re-checks the fields now shown. `ProviderPicker.test.tsx` already imports `fireEvent`, `waitFor`, `setSetting`, `useProviderStore` and `fakeProvider`.

- [ ] **Step 1: Write the failing tests.** `CredentialForm.test.tsx` — two imports and a `describe` at the end (`appId`, `token` and `unknown` are the file's own):

```diff
--- a/src/components/providers/CredentialForm.test.tsx
+++ b/src/components/providers/CredentialForm.test.tsx
@@ -1,6 +1,8 @@
 import { describe, it, expect, vi } from 'vitest';
 import { render, screen, fireEvent } from '@testing-library/react';
+import { resolve } from 'node:path';
+import { compile } from 'sass';
 import type { CredentialField } from '../../lib/provider/types';
 import { CredentialForm } from './CredentialForm';
 
 // Every label resolves to its key, so the inputs are found by the i18n key their field names.
@@ -73,4 +75,48 @@
     render(<CredentialForm fields={[]} values={{}} readiness={{ state: 'not-ready', reason: 'diagnostic', code: 'local_models_missing' }} onChange={vi.fn()} />);
     expect(screen.getByText('notices.local_models_missing')).toHaveClass('validation-message', 'error');
   });
 });
+
+describe('CredentialForm — a credential choice (F4; Stage 2 Volcengine AST2, ruling 1)', () => {
+  const apiKey: CredentialField = { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true };
+  const options = [{ value: 'app', labelKey: 'providers.volcengine_ast2.authModeApp' }, { value: 'apiKey', labelKey: 'setup.credentials.apiKey' }];
+
+  it('draws the options above the fields, the chosen one pressed, and writes another', () => {
+    const onChoose = vi.fn();
+    const { container } = render(
+      <CredentialForm fields={[appId, token]} values={{}} readiness={unknown} onChange={vi.fn()} onCheck={vi.fn()} choice={{ options, value: 'app', onChange: onChoose }} />,
+    );
+    const group = container.querySelector('.credential-choice-group')!;
+    expect(group).not.toBeNull();
+    const buttons = [...group.querySelectorAll('.segmented-control .segmented-option')] as HTMLButtonElement[];
+    expect(buttons.map((b) => b.textContent)).toEqual(['providers.volcengine_ast2.authModeApp', 'setup.credentials.apiKey']);
+    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
+    expect(buttons[0].className).toBe('segmented-option active');
+    // The control comes first, the fields after it, inside the same group.
+    expect(group.firstElementChild?.className).toBe('segmented-control');
+    expect(group.contains(screen.getByLabelText('setup.credentials.appId'))).toBe(true);
+    fireEvent.click(buttons[0]);
+    expect(onChoose).not.toHaveBeenCalled();
+    fireEvent.click(buttons[1]);
+    expect(onChoose).toHaveBeenCalledWith('apiKey');
+  });
+
+  it('shows the fields the chosen option shows, whatever the other one holds', () => {
+    render(<CredentialForm fields={[apiKey]} values={{ appId: 'a1', apiKey: 'k1' }} readiness={unknown} onChange={vi.fn()} choice={{ options, value: 'apiKey', onChange: vi.fn() }} />);
+    expect((screen.getByLabelText('setup.credentials.apiKey') as HTMLInputElement).value).toBe('k1');
+    expect(screen.queryByLabelText('setup.credentials.appId')).toBeNull();
+  });
+
+  it('locks the options while disabled, and draws no group without a choice', () => {
+    const { container, rerender } = render(<CredentialForm fields={[apiKey]} values={{}} readiness={unknown} onChange={vi.fn()} choice={{ options, value: 'apiKey', onChange: vi.fn() }} disabled />);
+    for (const b of container.querySelectorAll('.segmented-option')) expect(b).toBeDisabled();
+    rerender(<CredentialForm fields={[apiKey]} values={{}} readiness={unknown} onChange={vi.fn()} />);
+    expect(container.querySelector('.credential-choice-group')).toBeNull();
+  });
+
+  it("is styled as Palabra's group: a column, and the segmented control's active fill (compiled Settings.scss)", () => {
+    const { css } = compile(resolve(__dirname, '../Settings/Settings.scss'));
+    expect(css).toMatch(/\.credential-choice-group \{[^}]*flex-direction: column;/);
+    expect(css).toMatch(/\.credential-choice-group \.segmented-control \.segmented-option\.active \{[^}]*background:/);
+  });
+});
```

  `ProviderPicker.test.tsx`, before "disables the select and the credential inputs":

```diff
--- a/src/components/providers/ProviderPicker.test.tsx
+++ b/src/components/providers/ProviderPicker.test.tsx
@@ -99,8 +99,32 @@
     render(<ProviderPicker providers={[openaiCompatible]} auth={noAuth} />);
     expect(await screen.findByRole('option', { name: 'providers.openaiCompatible.name' })).toBeTruthy();
   });
 
+  it("draws a provider's credential choice and writes it as a setting: the other option's fields show (F4)", async () => {
+    const choosy = {
+      ...fakeProvider,
+      id: 'choosy',
+      settings: { key: 'choosy', defaults: { ...fakeProvider.settings.defaults, mode: 'key' } },
+      credentials: {
+        keys: ['apiKey', 'appId'],
+        fields: (s: { mode: string }) => (s.mode === 'app' ? [{ key: 'appId', labelKey: 'setup.credentials.appId', secret: false }] : [{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true }]),
+        read: () => ({}),
+        choice: { setting: 'mode', options: [{ value: 'key', labelKey: 'choice.key' }, { value: 'app', labelKey: 'choice.app' }] },
+      },
+    } as unknown as typeof fakeProvider;
+    render(<ProviderPicker providers={[choosy]} auth={noAuth} />);
+    await screen.findByLabelText('setup.credentials.apiKey');
+    expect(screen.getByRole('button', { name: 'choice.key' }).getAttribute('aria-pressed')).toBe('true');
+
+    fireEvent.click(screen.getByRole('button', { name: 'choice.app' }));
+
+    expect((useProviderStore.getState().entries.choosy?.settings as { mode: string }).mode).toBe('app');
+    expect(await screen.findByLabelText('setup.credentials.appId')).toBeInTheDocument();
+    expect(screen.queryByLabelText('setup.credentials.apiKey')).toBeNull();
+    await waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.choosy.mode', 'app'));
+  });
+
   it('disables the select and the credential inputs', async () => {
     stored.set('settings.fake.requireKey', true);
     render(<ProviderPicker providers={[fakeProvider]} auth={noAuth} disabled />);
     expect(screen.getByLabelText('simpleSettings.provider')).toBeDisabled();
```

  `registry.test.ts`, before "a managed provider has no credential field and reads from the sign-in" (`at`, `en` and `AnyProvider` are the file's own):

```ts
  it('a credential choice (F4) names a setting whose default it offers, has two options or more, each worded in en, each showing fields among its keys, labelled in en', () => {
    const offenders = (ps: readonly AnyProvider[]) => ps.flatMap((p) => {
      const choice = p.credentials.choice;
      if (!choice) return [];
      const defaults = p.settings.defaults as Record<string, unknown>;
      const out: string[] = [];
      if (!choice.options.some((o) => o.value === defaults[choice.setting])) out.push(`${p.id}: default ${String(defaults[choice.setting])}`);
      if (choice.options.length < 2) out.push(`${p.id}: one option`);
      for (const o of choice.options) {
        if (typeof at(en, o.labelKey) !== 'string') out.push(`${p.id}: ${o.labelKey}`);
        for (const f of p.credentials.fields({ ...defaults, [choice.setting]: o.value })) {
          if (!p.credentials.keys.includes(f.key)) out.push(`${p.id}: ${o.value} shows ${f.key}`);
          if (typeof at(en, f.labelKey) !== 'string') out.push(`${p.id}: ${f.labelKey}`);
        }
      }
      return out;
    });
    expect(offenders(PROVIDERS)).toEqual([]);
    // The control, so the case bites before a registered provider has a choice.
    const bad = { ...fakeProvider, id: 'bad', credentials: { ...fakeProvider.credentials, choice: { setting: 'script', options: [{ value: 'nope', labelKey: 'no.such.key' }] } } } as AnyProvider;
    expect(offenders([bad])).toEqual(['bad: default exchange', 'bad: one option', 'bad: no.such.key']);
  });
```

- [ ] **Step 2: Run** `npx vitest run src/components/providers/CredentialForm.test.tsx src/components/providers/ProviderPicker.test.tsx src/providers/registry.test.ts` — FAIL: the form draws no choice; the picker passes none; the stylesheet has no `.credential-choice-group`. The registry invariant passes already (no registered provider has a choice) — its `bad` control is what bites.
- [ ] **Step 3: Implement.** `CredentialForm.tsx`:

```diff
--- a/src/components/providers/CredentialForm.tsx
+++ b/src/components/providers/CredentialForm.tsx
@@ -1,9 +1,10 @@
 import { CheckCircle } from 'lucide-react';
 import { useTranslation } from 'react-i18next';
-import type { CredentialField, CredentialValues } from '../../lib/provider/types';
+import type { CredentialChoice, CredentialField, CredentialValues } from '../../lib/provider/types';
 import type { Readiness } from '../../stores/providerStore';
 import { noticeText } from '../../lib/view/noticeText';
+import { CredentialChoiceControl } from './CredentialChoiceControl';
 
 interface CredentialFormProps {
   fields: readonly CredentialField[];
   values: CredentialValues;
@@ -11,16 +12,19 @@
   onChange(key: string, value: string): void;
   /** Absent: no check button — a local provider checks itself. */
   onCheck?(): void;
   disabled?: boolean;
+  /** The provider's credential choice (F4), drawn above the fields: its options, the setting's current value, and how to change it. */
+  choice?: { options: CredentialChoice['options']; value: string; onChange(value: string): void };
 }
 
 /**
  * Any provider's credential inputs, drawn from its `credentials.fields`, with
  * the readiness check beside the last one. The markup is ProviderSection's
- * multi-field credential groups.
+ * multi-field credential groups; a credential choice (F4) is its Palabra
+ * group's segmented control above them (`CredentialChoiceControl`).
  */
-export function CredentialForm({ fields, values, readiness, onChange, onCheck, disabled }: CredentialFormProps) {
+export function CredentialForm({ fields, values, readiness, onChange, onCheck, disabled, choice }: CredentialFormProps) {
   const { t } = useTranslation();
   const checking = readiness.state === 'checking';
   const status = readiness.state === 'ready' ? 'valid' : readiness.state === 'not-ready' ? 'invalid' : '';
   const check = onCheck && (
@@ -34,9 +38,9 @@
       {checking ? <span className="spinner" /> : readiness.state === 'ready' ? <CheckCircle size={16} /> : t('simpleSettings.validate')}
     </button>
   );
 
-  return (
+  const form = (
     <>
       {fields.length === 0 ? (
         check && <div className="api-key-input-group">{check}</div>
       ) : (
@@ -59,5 +63,12 @@
         <div className="validation-message error">{noticeText(t, { code: readiness.code, params: readiness.params, message: readiness.reason })}</div>
       )}
     </>
   );
+  if (!choice) return form;
+  return (
+    <div className="credential-choice-group">
+      <CredentialChoiceControl options={choice.options} value={choice.value} onChange={choice.onChange} disabled={disabled} />
+      {form}
+    </div>
+  );
 }
```

  `CredentialChoiceControl.tsx`, in full — the one control both credential forms draw:

```tsx
import { useTranslation } from 'react-i18next';
import type { CredentialChoice } from '../../lib/provider/types';

export interface CredentialChoiceControlProps {
  options: CredentialChoice['options'];
  /** The chosen option's `value`. */
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
}

/**
 * A provider's credential choice (F4): the old Palabra group's segmented
 * control (`ProviderSection.tsx:761-779`), one button per option, the chosen
 * one pressed. The one control both credential forms draw — Settings'
 * `CredentialForm` and the wizard's credential step — inside a
 * `.credential-choice-group` (`Settings.scss`).
 */
export function CredentialChoiceControl({ options, value, onChange, disabled }: CredentialChoiceControlProps) {
  const { t } = useTranslation();
  return (
    <div className="segmented-control">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`segmented-option ${o.value === value ? 'active' : ''}`.trim()}
          aria-pressed={o.value === value}
          onClick={() => { if (o.value !== value) onChange(o.value); }}
          disabled={disabled}
        >
          {t(o.labelKey)}
        </button>
      ))}
    </div>
  );
}
```

  `ProviderPicker.tsx`:

```diff
--- a/src/components/providers/ProviderPicker.tsx
+++ b/src/components/providers/ProviderPicker.tsx
@@ -70,9 +70,10 @@
   const [richSelect] = useState(() => supportsBaseSelect());
 
   if (!selection) return null;
   const { provider, entry, readiness } = selection;
-  const { setCredential, refreshReadiness, select } = useProviderStore.getState();
+  const { setCredential, refreshReadiness, select, updateSettings } = useProviderStore.getState();
+  const credentialChoice = provider.credentials.choice;
   // The first managed provider offered, as the wizard's managed card recommends it (today's ProviderSection.tsx:553-580).
   const recommendedId = providers.find((p) => p.kind === 'managed')?.id;
   const recommendedLabel = t('simpleSettings.recommended', 'Recommended');
 
@@ -193,8 +194,14 @@
           fields={provider.credentials.fields(entry.settings)}
           values={entry.credentials}
           readiness={readiness}
           onChange={(key, value) => setCredential(provider, key, value)}
+          // F4: which fields show is a setting, written as any settings edit is (the readiness driver re-checks the other fields).
+          choice={credentialChoice && {
+            options: credentialChoice.options,
+            value: String((entry.settings as Record<string, unknown>)[credentialChoice.setting] ?? ''),
+            onChange: (value) => updateSettings(provider, { [credentialChoice.setting]: value }),
+          }}
           // A local provider checks itself, and a managed one follows the sign-in (F1): only an own-key provider offers Validate.
           onCheck={provider.kind === 'own-key' ? () => {
             void refreshReadiness(provider, auth).then((answer) => {
               // Superseded (an edit meanwhile, or a newer check still running): this press found nothing out.
```

  `Settings.scss`:

```diff
--- a/src/components/Settings/Settings.scss
+++ b/src/components/Settings/Settings.scss
@@ -1788,10 +1788,12 @@
     }
   }
 }
 
-// PalabraAI credentials group (Client ID + Client Secret)
-.palabraai-credentials-group {
+// PalabraAI credentials group (Client ID + Client Secret), and any provider's
+// credential choice (F4; `CredentialForm`), which reuses it.
+.palabraai-credentials-group,
+.credential-choice-group {
   display: flex;
   flex-direction: column;
   gap: 8px;
   margin-bottom: 12px;
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then `npx vitest run src/components src/providers`, the full suite and the gate. Every existing form draws no group (no provider has a choice), so the panel's forms render as before. The wizard's credential step draws its own inputs from the saved settings' `credentials.fields` (`StepCredentials.tsx:98`), not `CredentialForm`, and is not touched: it shows the saved mode's fields (choice 2).
- [ ] **Step 5: Commit.**

```bash
git add src/components/providers/CredentialChoiceControl.tsx src/components/providers/CredentialForm.tsx src/components/providers/CredentialForm.test.tsx src/components/providers/ProviderPicker.tsx src/components/providers/ProviderPicker.test.tsx src/components/Settings/Settings.scss src/providers/registry.test.ts
```

```bash
git commit -q -F - -- src/components/providers/CredentialChoiceControl.tsx src/components/providers/CredentialForm.tsx src/components/providers/CredentialForm.test.tsx src/components/providers/ProviderPicker.tsx src/components/providers/ProviderPicker.test.tsx src/components/Settings/Settings.scss src/providers/registry.test.ts <<'EOF'
feat(providers): a credential choice above the credential fields (F4)

A provider's credential choice draws as the old Palabra group's
segmented control above its fields, in both layouts; a pick is a
settings edit, so both modes' credentials stay stored and the other
fields are checked. A registry invariant holds each choice to its
defaults, its keys and its words.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

`registry.test.ts` is also Task 3's (Wave 1) and Task 16's (Wave 5): never two tasks of one wave.

---

## Wave 3

### Task 11: Settings and the wizard offer the context's languages (ruling 3; choice 1)

**Files:**
- Modify: `src/components/providers/LanguagePairSection.tsx`, `src/components/providers/ProviderLanguages.tsx`, `src/components/SetupWizard/steps/StepLanguagePair.tsx`
- Test: `src/components/providers/LanguagePairSection.test.tsx`, `src/components/providers/ProviderLanguages.test.tsx`, `src/components/SetupWizard/steps/StepLanguagePair.test.tsx` (new)

**Interfaces:**
- Consumes: Task 3 — `LanguageContext`, `languageContext`, the helpers with a context; Task 9 — the store's `legs` and `speech`, `participantSpeechSwitchFromStores`; `legsFor` (`appShape`, existing).
- Produces: `LanguagePairSection`'s `context?: LanguageContext` — the lists, the swap and a changed source's normalization all read it; absent, the widest offer, as today. `ProviderLanguages` passes `languageContext(provider, legs, speech)` from the store. The wizard's language step lists the offer for the scenario: its legs (`legsFor(preset.mode)`) and its text-only answer, with the participant's switch as the stores hold it; a draft pair its lists do not hold is normalized into them (`normalizePair` under `{ speech }`, dispatched as `setLanguages`).
- Consumed by: group check B.

The store derives the pair it shows for the same context (Task 9), so the section never draws a pair its lists do not hold. `ProviderLanguages` reads `legs` and `speech` with selectors before its early return (the rules of hooks). The wizard reads `participantSpeechSwitchFromStores()` rather than `speechInputsFromStores()`: `SetupWizard.test.tsx` mocks the settings store without `getState`, and the scenario, not the store, answers text only there. The wizard writes its pair at Finish through `setPair` (`applySetup.ts`), which keeps it as picked (Task 9): a text-only pick survives a scenario that later speaks. The new `StepLanguagePair.test.tsx` mocks `providerPaths` and the two `appShape` functions so the registry's graph stays out; its draft names `Provider.VOLCENGINE_AST2` only because `SetupDraft.provider` is the old enum — `wizardProvider` is the stub. Going Back to another scenario keeps the draft's pair (`setScenario` with `keepProvider`, `setupDraft.ts:100`), so a pair picked under `subtitle-myself` (한국어 → 中文) would stay selected under `be-heard`, whose list does not hold it, and Finish would write it: the step normalizes it into the list, as the store does, and dispatches the result (review M2).

- [ ] **Step 1: Write the failing tests.** `LanguagePairSection.test.tsx` (`values` is the file's own helper):

```diff
--- a/src/components/providers/LanguagePairSection.test.tsx
+++ b/src/components/providers/LanguagePairSection.test.tsx
@@ -1,7 +1,8 @@
 import { describe, it, expect, vi } from 'vitest';
-import { render, screen, fireEvent } from '@testing-library/react';
+import { cleanup, render, screen, fireEvent } from '@testing-library/react';
 import { AUTO } from '../../lib/provider/languages';
+import type { LanguageContext } from '../../lib/provider/types';
 import { fakeProvider } from '../../providers/fake/provider';
 import { FAKE_DEFAULTS } from '../../providers/fake/settings';
 import { LanguagePairSection } from './LanguagePairSection';
 
@@ -97,4 +98,42 @@
       expect(screen.getByText('settings.langSentence.theyRead')).toBeTruthy();
     });
   });
 });
+
+describe('LanguagePairSection — a language context (Stage 2 Volcengine AST2, choice 1)', () => {
+  const opt = (value: string) => ({ value, name: value, englishName: value });
+  /** Speaking offers en and ja; text also ko — Doubao AST 2.0's shape. */
+  const offered = (context?: LanguageContext) => [opt('en'), opt('ja'), ...(context?.speech ? [] : [opt('ko')])];
+  const moody = {
+    ...fakeProvider,
+    languages: {
+      sources: (_s: unknown, context?: LanguageContext) => offered(context),
+      targets: (source: string, _s: unknown, context?: LanguageContext) => offered(context).filter((o) => o.value !== source),
+    },
+  } as unknown as typeof fakeProvider;
+  const drawIn = (context: LanguageContext | undefined, pair: { source: string; target: string }, onChange = vi.fn()) => {
+    render(<LanguagePairSection provider={moody} settings={FAKE_DEFAULTS} pair={pair} onChange={onChange} context={context} />);
+    return onChange;
+  };
+
+  it('lists the offer for the context, and the widest one without', () => {
+    drawIn({ speech: true }, { source: 'en', target: 'ja' });
+    expect(values(screen.getByLabelText('settings.sourceLanguage'))).toEqual(['en', 'ja']);
+    expect(values(screen.getByLabelText('settings.targetLanguage'))).toEqual(['ja']);
+    cleanup();
+    drawIn(undefined, { source: 'en', target: 'ja' });
+    expect(values(screen.getByLabelText('settings.sourceLanguage'))).toEqual(['en', 'ja', 'ko']);
+  });
+
+  it('normalizes a new source within the context, and swaps only within it', () => {
+    const onChange = drawIn({ speech: true }, { source: 'en', target: 'ja' });
+    fireEvent.change(screen.getByLabelText('settings.sourceLanguage'), { target: { value: 'ja' } });
+    expect(onChange).toHaveBeenCalledWith({ source: 'ja', target: 'en' });
+    cleanup();
+    drawIn({ speech: false }, { source: 'en', target: 'ko' });
+    expect(screen.getByTitle('simpleConfig.swapLanguages')).not.toBeDisabled();
+    cleanup();
+    drawIn({ speech: true }, { source: 'en', target: 'ko' });
+    expect(screen.getByTitle('simpleConfig.swapLanguages')).toBeDisabled();
+  });
+});
```

  `ProviderLanguages.test.tsx` (`useProviderStore`, `fakeProvider`, `FAKE_DEFAULTS` and `ProviderLanguages` are the file's own imports):

```diff
--- a/src/components/providers/ProviderLanguages.test.tsx
+++ b/src/components/providers/ProviderLanguages.test.tsx
@@ -1,6 +1,7 @@
 import { describe, it, expect, beforeEach, vi } from 'vitest';
-import { render, screen, fireEvent } from '@testing-library/react';
+import { act, render, screen, fireEvent } from '@testing-library/react';
+import type { LanguageContext } from '../../lib/provider/types';
 
 const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));
 vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));
 vi.mock('react-i18next', async (importOriginal) => {
@@ -54,4 +55,34 @@
     expect(screen.getByLabelText('settings.targetLanguage')).toBeDisabled();
     expect(screen.getByTitle('simpleConfig.swapLanguages')).toBeDisabled();
   });
 });
+
+describe('ProviderLanguages — the language context (Stage 2 Volcengine AST2, choice 1)', () => {
+  const opt = (value: string) => ({ value, name: value, englishName: value });
+  const offered = (context?: LanguageContext) => [opt('en'), opt('ja'), ...(context?.speech ? [] : [opt('ko')])];
+  const moody = {
+    ...fakeProvider,
+    id: 'moody',
+    speech: 'optional',
+    languages: {
+      sources: (_s: unknown, context?: LanguageContext) => offered(context),
+      targets: (source: string, _s: unknown, context?: LanguageContext) => offered(context).filter((o) => o.value !== source),
+    },
+  } as unknown as typeof fakeProvider;
+  const sources = () => [...(screen.getByLabelText('settings.sourceLanguage') as HTMLSelectElement).options].map((o) => o.value);
+
+  it("offers the languages of the store's context: its legs, and whether they speak", () => {
+    useProviderStore.setState({
+      entries: { moody: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
+      selected: 'moody',
+      legs: ['speaker'],
+      speech: { textOnly: false, participantSpeech: false },
+    });
+    render(<ProviderLanguages providers={[moody]} />);
+    expect(sources()).toEqual(['en', 'ja']);
+    act(() => { useProviderStore.setState({ speech: { textOnly: true, participantSpeech: false } }); });
+    expect(sources()).toEqual(['en', 'ja', 'ko']);
+    act(() => { useProviderStore.setState({ legs: ['speaker', 'participant'], speech: { textOnly: true, participantSpeech: true } }); });
+    expect(sources()).toEqual(['en', 'ja']);
+  });
+});
```

  `StepLanguagePair.test.tsx`, in full:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { LanguageContext } from '../../../lib/provider/types';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key), i18n: { language: 'en' } }),
}));

const opt = (value: string) => ({ value, name: value, englishName: value });
/** Speaking offers en and ja; text also ko — Doubao AST 2.0's shape. */
const offered = (context?: LanguageContext) => [opt('en'), opt('ja'), ...(context?.speech ? [] : [opt('ko')])];
const moody = {
  id: 'moody',
  speech: 'optional',
  settings: { key: 'moody', defaults: {} },
  languages: {
    sources: (_s: unknown, context?: LanguageContext) => offered(context),
    targets: (source: string, _s: unknown, context?: LanguageContext) => offered(context).filter((o) => o.value !== source),
  },
};
vi.mock('../providerPaths', () => ({ wizardProvider: () => moody, textOnlyCapabilityOf: () => 'optional' }));
// The registry's import graph stays out: the step reads only these two from the app shape.
const participant = vi.hoisted(() => ({ speech: false }));
vi.mock('../../../lib/session/appShape', () => ({
  legsFor: (mode: string) => (mode === 'both' ? ['speaker', 'participant'] : [mode]),
  participantSpeechSwitchFromStores: () => participant.speech,
}));

import StepLanguagePair from './StepLanguagePair';
import { initialDraft, type SetupDraft } from '../setupDraft';
import type { ScenarioId } from '../../../lib/setup/types';
import { Provider } from '../../../types/Provider';

const draw = (scenario: ScenarioId, pair = { source: 'en', target: 'ja' }, dispatch = vi.fn()) => {
  // Any stored spelling: `wizardProvider` is the stub above.
  const draft: SetupDraft = { ...initialDraft(), provider: Provider.VOLCENGINE_AST2, scenario, sourceLanguage: pair.source, targetLanguage: pair.target };
  render(<StepLanguagePair draft={draft} dispatch={dispatch} />);
  return [...(screen.getAllByRole('combobox')[0] as HTMLSelectElement).options].map((o) => o.value);
};

beforeEach(() => { participant.speech = false; });

describe('StepLanguagePair — the scenario decides whether the run speaks (Stage 2 Volcengine AST2, choice 1)', () => {
  it("offers a speaking scenario the languages it speaks", () => {
    expect(draw('be-heard')).toEqual(['en', 'ja']);
  });

  it('offers every language to a subtitles-only scenario', () => {
    expect(draw('subtitle-myself')).toEqual(['en', 'ja', 'ko']);
  });

  it("reads the participant's own speech switch for a scenario that listens to others", () => {
    expect(draw('understand-others')).toEqual(['en', 'ja', 'ko']);
    participant.speech = true;
    cleanup();
    expect(draw('understand-others')).toEqual(['en', 'ja']);
  });

  it("normalizes a pair kept from another scenario into this one's lists, and leaves an offered pair alone", () => {
    // Picked under subtitle-myself, then Back to a scenario that speaks: ko is not on its list.
    const dispatch = vi.fn();
    draw('be-heard', { source: 'ko', target: 'ja' }, dispatch);
    expect(dispatch).toHaveBeenCalledWith({ type: 'setLanguages', source: 'en', target: 'ja' });
    cleanup();
    const quiet = vi.fn();
    draw('subtitle-myself', { source: 'ko', target: 'ja' }, quiet);
    expect(quiet).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/components/providers/LanguagePairSection.test.tsx src/components/providers/ProviderLanguages.test.tsx src/components/SetupWizard/steps/StepLanguagePair.test.tsx` — FAIL: the lists are the widest offer whatever the context, and the wizard keeps a pair its list does not hold.
- [ ] **Step 3: Implement.** `LanguagePairSection.tsx`:

```diff
--- a/src/components/providers/LanguagePairSection.tsx
+++ b/src/components/providers/LanguagePairSection.tsx
@@ -3,9 +3,9 @@
 import { useTranslation } from 'react-i18next';
 import Tooltip from '../Tooltip/Tooltip';
 import { pairSentence } from '../SetupWizard/languageSentence';
 import { AUTO, normalizePair, swapped } from '../../lib/provider/languages';
-import type { AnyProvider, LanguageOption, LanguagePair } from '../../lib/provider/types';
+import type { AnyProvider, LanguageContext, LanguageOption, LanguagePair } from '../../lib/provider/types';
 import type { AudioMode } from '../../stores/audioStore';
 import { effectiveTextOnly } from '../../utils/effectiveTextOnly';
 
 interface LanguagePairSectionProps {
@@ -19,22 +19,24 @@
    * labels `pairSentence` returns, plus the "both" mirror line. Absent: the
    * plain `settings.sourceLanguage` / `settings.targetLanguage` labels.
    */
   sentence?: { mode: AudioMode; textOnly: boolean };
+  /** Whether a run would speak (Stage 2 Volcengine AST2, choice 1): the lists are the offer for it. Absent: the provider's widest offer. */
+  context?: LanguageContext;
 }
 
 /**
  * Any provider's language pair (spec: "Languages are two functions"): the
  * lists are its `sources` and `targets`, and the swap is the generic one,
  * allowed whenever the provider supports the reversed pair. Markup is
  * LanguageSection's translation-languages block.
  */
-export function LanguagePairSection({ provider, settings, pair, onChange, disabled, sentence }: LanguagePairSectionProps) {
+export function LanguagePairSection({ provider, settings, pair, onChange, disabled, sentence, context }: LanguagePairSectionProps) {
   const { t } = useTranslation();
   const id = useId();
-  const sources = provider.languages.sources(settings);
-  const targets = provider.languages.targets(pair.source, settings);
-  const reversed = swapped(provider, settings, pair);
+  const sources = provider.languages.sources(settings, context);
+  const targets = provider.languages.targets(pair.source, settings, context);
+  const reversed = swapped(provider, settings, pair, context);
   const option = (o: LanguageOption) => (
     <option key={o.value} value={o.value}>{o.value === AUTO ? t('common.autoDetect') : o.name}</option>
   );
 
@@ -70,9 +72,9 @@
           <select
             id={`${id}-source`}
             className="language-select"
             value={pair.source}
-            onChange={(e) => onChange(normalizePair(provider, settings, { source: e.target.value, target: pair.target }))}
+            onChange={(e) => onChange(normalizePair(provider, settings, { source: e.target.value, target: pair.target }, context))}
             disabled={disabled}
           >
             {sources.map(option)}
           </select>
```

  `ProviderLanguages.tsx`:

```diff
--- a/src/components/providers/ProviderLanguages.tsx
+++ b/src/components/providers/ProviderLanguages.tsx
@@ -1,6 +1,7 @@
 import { useAnalytics } from '../../lib/analytics';
 import type { AnyProvider } from '../../lib/provider/types';
+import { languageContext } from '../../lib/session/shape';
 import type { AudioMode } from '../../stores/audioStore';
 import { useProviderStore } from '../../stores/providerStore';
 import { LanguagePairSection } from './LanguagePairSection';
 import { useSelectedProvider } from './useSelectedProvider';
@@ -13,14 +14,18 @@
   sentence?: { mode: AudioMode; textOnly: boolean };
 }
 
 /**
- * The selected provider's language pair. Tracks each side that changed with
- * today's `language_changed` (ruling 14) before persisting the new pair.
+ * The selected provider's language pair, offered for the language context
+ * the store holds — its legs and whether they speak (Stage 2 Volcengine
+ * AST2, choice 1). Tracks each side that changed with today's
+ * `language_changed` (ruling 14) before persisting the new pair.
  */
 export function ProviderLanguages({ providers, disabled, sentence }: ProviderLanguagesProps) {
   const { trackEvent } = useAnalytics();
   const selection = useSelectedProvider(providers);
+  const legs = useProviderStore((st) => st.legs);
+  const speech = useProviderStore((st) => st.speech);
   if (!selection?.entry) return null;
   const { provider, entry } = selection;
   const { setPair } = useProviderStore.getState();
 
@@ -30,8 +35,9 @@
       settings={entry.settings}
       pair={entry.pair}
       disabled={disabled}
       sentence={sentence}
+      context={languageContext(provider, legs, speech)}
       onChange={(pair) => {
         if (pair.source !== entry.pair.source) trackEvent('language_changed', { to_language: pair.source, language_type: 'source' });
         if (pair.target !== entry.pair.target) trackEvent('language_changed', { to_language: pair.target, language_type: 'target' });
         setPair(provider, pair);
```

  `StepLanguagePair.tsx` — `preset` moves up, before the lists that now read it:

```diff
--- a/src/components/SetupWizard/steps/StepLanguagePair.tsx
+++ b/src/components/SetupWizard/steps/StepLanguagePair.tsx
@@ -1,8 +1,10 @@
 import React, { useEffect, useMemo } from 'react';
 import { useTranslation } from 'react-i18next';
 import { useProviderStore } from '../../../stores/providerStore';
-import { AUTO } from '../../../lib/provider/languages';
+import { AUTO, normalizePair } from '../../../lib/provider/languages';
+import { legsFor, participantSpeechSwitchFromStores } from '../../../lib/session/appShape';
+import { languageContext } from '../../../lib/session/shape';
 import { getScenario } from '../../../lib/setup/scenarios';
 import { pairSentence } from '../languageSentence';
 import { defaultLanguagePair } from '../languageDefaults';
 import { textOnlyCapabilityOf, wizardProvider } from '../providerPaths';
@@ -16,10 +18,13 @@
   const { t, i18n } = useTranslation();
   const uiLanguage = i18n.language;
   const p = wizardProvider(draft.provider)!;
   const s = useProviderStore((st) => st.entries[p.id]?.settings) ?? p.settings.defaults;
-  const sources = useMemo(() => [...p.languages.sources(s)], [p, s]);
-  const targetsFor = (src: string) => [...p.languages.targets(src, s)];
+  // The scenario's legs and text-only answer whether the run would speak, so the lists are the offer for it (Stage 2 Volcengine AST2, choice 1); the participant's own switch is the stores'.
+  const preset = getScenario(draft.scenario!);
+  const speech = languageContext(p, legsFor(preset.mode), { textOnly: preset.textOnly, participantSpeech: participantSpeechSwitchFromStores() }).speech;
+  const sources = useMemo(() => [...p.languages.sources(s, { speech })], [p, s, speech]);
+  const targetsFor = (src: string) => [...p.languages.targets(src, s, { speech })];
 
   // Seed once from the provider's lists (spec §1.2 step 4); Back/Next keeps the
   // user's picks because the draft already holds them.
   useEffect(() => {
@@ -36,15 +41,25 @@
     });
     dispatch({ type: 'setLanguages', source: pair.source, target: pair.target });
   }, [p, sources, uiLanguage, draft.sourceLanguage, draft.targetLanguage, dispatch]);
 
+  // A scenario changed on Back keeps the draft's pair (`setScenario` with
+  // `keepProvider`); one its lists do not hold is normalized into them, by
+  // the rule the provider store keeps (Stage 2 Volcengine AST2, choice 1).
+  useEffect(() => {
+    if (draft.sourceLanguage === null || draft.targetLanguage === null) return;
+    const next = normalizePair(p, s, { source: draft.sourceLanguage, target: draft.targetLanguage }, { speech });
+    if (next.source !== draft.sourceLanguage || next.target !== draft.targetLanguage) {
+      dispatch({ type: 'setLanguages', source: next.source, target: next.target });
+    }
+  }, [p, s, speech, draft.sourceLanguage, draft.targetLanguage, dispatch]);
+
   const source = draft.sourceLanguage ?? '';
   const targets = source ? targetsFor(source) : [];
 
   // The same sentence Settings' language pair prints, over the same two fields:
   // whichever way round a provider runs the legs, the user should meet one
   // vocabulary for them.
-  const preset = getScenario(draft.scenario!);
   const sentence = pairSentence({
     mode: preset.mode,
     textOnly: preset.textOnly,
     capability: textOnlyCapabilityOf(p),
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then `npx vitest run src/components/providers src/components/SetupWizard src/components/Settings`, the full suite and the gate. Every registered provider ignores the context, so every existing surface case lists what it listed; `SetupWizard.test.tsx` renders the language step through the real `appShape`, whose `participantSpeechSwitchFromStores` reads the routing and audio stores it does not mock.
- [ ] **Step 5: Commit.**

```bash
git add src/components/providers/LanguagePairSection.tsx src/components/providers/LanguagePairSection.test.tsx src/components/providers/ProviderLanguages.tsx src/components/providers/ProviderLanguages.test.tsx src/components/SetupWizard/steps/StepLanguagePair.tsx src/components/SetupWizard/steps/StepLanguagePair.test.tsx
```

```bash
git commit -q -F - -- src/components/providers/LanguagePairSection.tsx src/components/providers/LanguagePairSection.test.tsx src/components/providers/ProviderLanguages.tsx src/components/providers/ProviderLanguages.test.tsx src/components/SetupWizard/steps/StepLanguagePair.tsx src/components/SetupWizard/steps/StepLanguagePair.test.tsx <<'EOF'
feat(providers): the language pickers offer what the run would speak

Settings' language section lists the offer for the store's language
context, and the wizard's for the chosen scenario, so a provider that
speaks fewer languages than it transcribes shows each list where it
applies.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

### Task 12: The wire, the socket seam and the fixtures; `trackedClock` moves to the kit (rulings 2, 8; choices 4, 5, 13, 14)

**Files:**
- Create: `src/providers/volcengine_ast2/socket.ts`, `src/providers/volcengine_ast2/wire.ts`, `src/providers/volcengine_ast2/testing.ts`, `src/lib/contract/testing/trackedClock.ts`
- Modify: `src/providers/soniox/testing.ts`, `src/providers/gemini/testing.ts`
- Test: `src/providers/volcengine_ast2/wire.test.ts`, `src/lib/contract/testing/trackedClock.test.ts`

**Interfaces:**
- Consumes: Task 1's codec; Task 6's `Ast2Credentials`, `Ast2Corpus`, `buildAst2`, `AST2_DEFAULTS`, `Ast2Settings`; the kit's `FakeSocket` type; `createVirtualClock`, `every` (`src/lib/contract/clock`).
- Produces:
  - `socket.ts`: `type OpenSocket = (url: string) => WebSocket`; `nativeSocket`; `WS_OPEN = 1`.
  - `wire.ts`: `EventType` (= `proto.speech.event.Type`); `type Ast2Response`; `AST2_ENDPOINT = 'wss://openspeech.bytedance.com/api/v4/ast/v2/translate'`; `AST2_RESOURCE_ID = 'volc.service_type.10053'`; `OK_STATUS = 20_000_000`; `ast2Url(k: Ast2Credentials): string`; `REFUSED_UPGRADE` (the words for a socket refused before it opened); `interface SessionIds { session: string; connection: string }`; `interface StartSessionInput { ids; sequence; mode; source; target; corpus?; appKey? }`; `startSessionFrame(o)`, `audioFrame(ids, sequence, pcm: Int16Array)`, `finishSessionFrame(ids, sequence)` → `Uint8Array`; `decodeResponse(data: unknown): Ast2Response`; `eventName(event)`; `isOk(status)`; `statusFailureCode(status): 'client' | 'server'`; `statusText(status, message)`; `toNumber(v)`.
  - `testing.ts` (test-only): `APP_KEY`, `API_KEY`, `counterIds()`, `SESSION_ID`, `SHARED`, `AUTO_CTX`, `configFor(context?, patch?)`, `serverFrame(r)`, `SERVER` (named frames), `sentRequests(socket)`, `pcmOf(request)`.
  - `trackedClock(): { clock: VirtualClock; timers: () => number }` in `src/lib/contract/testing/trackedClock.ts`: Soniox's `testing.ts` re-exports it; Gemini's imports it and exports the local binding, which its harness (`startGemini`, Gemini Task 11) keeps calling.
- Consumed by: Tasks 14 and 15.

The URL carries the credentials in its query, as the owner's probe measured (ruling 2): `api_resource_id`, then `api_app_key` and `api_access_key`, or `api_key` — built by `URLSearchParams`, so a credential is escaped, never concatenated. `requestMeta.AppKey` is sent in the legacy mode only (choice 5). A status starting `4` is the client's, any other the service's (choice 4). Soniox's and Gemini's fixtures keep exporting `trackedClock` under the same name, so none of their suites changes an import (choice 14). Gemini's keeps a local binding too: its `startGemini` calls `trackedClock()` in the module itself (Gemini Task 11), and a re-export (`export { x } from '…'`) creates no binding inside the module (review B1).

- [ ] **Step 1: Write the failing tests.** `trackedClock.test.ts`, in full:

```ts
import { describe, it, expect, vi } from 'vitest';
import { every } from '../clock';
import { trackedClock } from './trackedClock';

describe('trackedClock', () => {
  it('counts a timer while it is pending, and not once it fired or was cancelled', () => {
    const { clock, timers } = trackedClock();
    const fired = vi.fn();
    const cancel = clock.setTimeout(fired, 100);
    clock.setTimeout(fired, 50);
    expect(timers()).toBe(2);
    clock.advance(50);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(timers()).toBe(1);
    cancel();
    expect(timers()).toBe(0);
    clock.advance(100);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("counts an interval's armed tick, and none once it is stopped", () => {
    const { clock, timers } = trackedClock();
    const stop = every(clock, 80, () => {});
    clock.advance(400);
    expect(timers()).toBe(1);
    stop();
    expect(timers()).toBe(0);
    expect(clock.now()).toBe(400);
  });
});
```

  `wire.test.ts`, in full:

```ts
import { describe, it, expect } from 'vitest';
import { data as proto } from './proto/ast2-proto.js';
import { API_KEY, APP_KEY, SERVER, serverFrame } from './testing';
import {
  AST2_ENDPOINT, AST2_RESOURCE_ID, EventType, OK_STATUS, ast2Url, audioFrame, decodeResponse, eventName, finishSessionFrame, isOk,
  startSessionFrame, statusFailureCode, statusText, toNumber,
} from './wire';

const decodeRequest = (bytes: Uint8Array) => proto.speech.ast.TranslateRequest.decode(bytes);
const ids = { session: 's-1', connection: 'c-1' };

describe("Doubao AST 2.0's wire", () => {
  it('puts the legacy App ID and Access Token, or the API key, in the socket query, beside the resource id (ruling 2)', () => {
    expect(AST2_ENDPOINT).toBe('wss://openspeech.bytedance.com/api/v4/ast/v2/translate');
    expect(ast2Url(APP_KEY)).toBe(`${AST2_ENDPOINT}?api_resource_id=volc.service_type.10053&api_app_key=1234567890&api_access_key=sk-ast2token0123456`);
    expect(ast2Url(API_KEY)).toBe(`${AST2_ENDPOINT}?api_resource_id=volc.service_type.10053&api_key=key-ast2api0123456789`);
    expect(ast2Url({ kind: 'apiKey', apiKey: 'a&b=c d' })).toContain('api_key=a%26b%3Dc+d');
  });

  it('starts a speaking session: 16 kHz pcm in, 24 kHz Ogg Opus out, no speaker id (the voice is cloned), the libraries, the App ID in its meta', () => {
    const start = decodeRequest(startSessionFrame({ ids, sequence: 0, mode: 's2s', source: 'zh', target: 'en', corpus: { boostingTableId: 'hot-1' }, appKey: '1234567890' }));
    expect(start.event).toBe(EventType.StartSession);
    expect(start.requestMeta).toMatchObject({ Endpoint: AST2_RESOURCE_ID, AppKey: '1234567890', ResourceID: AST2_RESOURCE_ID, SessionID: 's-1', ConnectionID: 'c-1', Sequence: 0 });
    expect(start.user).toMatchObject({ uid: 'sokuji-user', platform: 'web' });
    expect(start.sourceAudio).toMatchObject({ format: 'pcm', rate: 16000, bits: 16, channel: 1 });
    expect(start.request).toMatchObject({ mode: 's2s', sourceLanguage: 'zh', targetLanguage: 'en', speakerId: '', corpus: { boostingTableId: 'hot-1' } });
    expect(start.targetAudio).toMatchObject({ format: 'ogg_opus', rate: 24000 });
  });

  it('starts a text-only session with no target audio, and the API key mode with no App ID', () => {
    const start = decodeRequest(startSessionFrame({ ids, sequence: 0, mode: 's2t', source: 'ko', target: 'zh' }));
    expect(start.request).toMatchObject({ mode: 's2t', sourceLanguage: 'ko', targetLanguage: 'zh' });
    expect(start.request?.corpus ?? null).toBeNull();
    expect(start.targetAudio ?? null).toBeNull();
    expect(start.requestMeta?.AppKey).toBe('');
  });

  it("sends a packet's own bytes, never its backing buffer's, and finishes the session", () => {
    const packet = new Int16Array([9, 1, -2, 3, 9]).subarray(1, 4);
    const audio = decodeRequest(audioFrame(ids, 5, packet));
    expect(audio.event).toBe(EventType.TaskRequest);
    expect(audio.requestMeta).toMatchObject({ SessionID: 's-1', ConnectionID: 'c-1', Sequence: 5 });
    const bytes = audio.sourceAudio!.binaryData!;
    expect(Array.from(new Int16Array(new Uint8Array(bytes).buffer))).toEqual([1, -2, 3]);
    const finish = decodeRequest(finishSessionFrame(ids, 6));
    expect(finish.event).toBe(EventType.FinishSession);
    expect(finish.requestMeta).toMatchObject({ SessionID: 's-1', Sequence: 6 });
  });

  it('decodes a binary frame, and refuses anything else, or a frame cut short', () => {
    const r = decodeResponse(SERVER.subtitle('source', 'response', '你好', { sequence: 3, startTime: 10, endTime: 900 }));
    expect(r.event).toBe(EventType.SourceSubtitleResponse);
    expect(r).toMatchObject({ text: '你好', startTime: 10, endTime: 900 });
    expect(r.responseMeta).toMatchObject({ Sequence: 3, StatusCode: OK_STATUS });
    expect(() => decodeResponse('text')).toThrow(/unexpected kind/);
    expect(() => decodeResponse(new Blob([]))).toThrow(/unexpected kind/);
    const whole = new Uint8Array(serverFrame({ event: EventType.SourceSubtitleResponse, text: 'a long enough text' }));
    expect(() => decodeResponse(whole.slice(0, whole.length - 4).buffer)).toThrow();
  });

  it("reads 0, none or 20000000 as OK; a 4xxxxxxx status as the client's fault, anything else as the service's (choice 4)", () => {
    expect(isOk(0)).toBe(true);
    expect(isOk(undefined)).toBe(true);
    expect(isOk(OK_STATUS)).toBe(true);
    expect(isOk(45000001)).toBe(false);
    expect(statusFailureCode(45000001)).toBe('client');
    expect(statusFailureCode(55000031)).toBe('server');
    expect(statusFailureCode(11200)).toBe('server');
    expect(statusText(45000001, 'invalid language')).toBe('[Doubao 45000001] invalid language');
    expect(statusText(undefined, '')).toBe('[Doubao no status] no message');
  });

  it('names events for frames, and reads an int64 as a number', () => {
    expect(eventName(EventType.TTSSentenceStart)).toBe('TTSSentenceStart');
    expect(eventName(999)).toBe('event_999');
    expect(toNumber(61000)).toBe(61000);
    expect(toNumber({ toNumber: () => 7 })).toBe(7);
    expect(toNumber(null)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/contract/testing/trackedClock.test.ts src/providers/volcengine_ast2/wire.test.ts` — FAIL: no modules.
- [ ] **Step 3: Implement.** `trackedClock.ts`, in full:

```ts
/**
 * A virtual clock that counts its live timers — what an adapter's stop must
 * leave at zero. Soniox's and Gemini's suites each kept a copy; the third
 * adapter that needed one (Doubao AST 2.0) moved it here (Stage 2 Gemini,
 * choice 21). Test-only, like the rest of the kit.
 */
import { createVirtualClock, type VirtualClock } from '../clock';

export function trackedClock(): { clock: VirtualClock; timers: () => number } {
  const inner = createVirtualClock(0);
  const live = new Set<symbol>();
  const clock: VirtualClock = {
    now: () => inner.now(),
    advance: (ms) => inner.advance(ms),
    setTimeout(fn, ms) {
      const id = Symbol('timer');
      live.add(id);
      const cancel = inner.setTimeout(() => { live.delete(id); fn(); }, ms);
      return () => { live.delete(id); cancel(); };
    },
  };
  return { clock, timers: () => live.size };
}
```

  `soniox/testing.ts` — the clock import goes and the function becomes a re-export:

```diff
--- a/src/providers/soniox/testing.ts
+++ b/src/providers/soniox/testing.ts
@@ -5,9 +5,8 @@
  * consistency test's "only test-only modules import the adapter test kit"
  * holds it to that), and the adapter's session walk never reaches it.
  */
 import type { SessionContext } from '../../lib/contract/adapter';
-import { createVirtualClock, type VirtualClock } from '../../lib/contract/clock';
 import type { FakeSocket } from '../../lib/contract/testing/fakeSocket';
 import type { SharedSettings } from '../../lib/provider/types';
 import type { SonioxCredentials } from './settings';
 import type { SonioxToken } from './sttStream';
@@ -30,20 +29,6 @@
 export const END: SonioxToken = { text: '<end>', is_final: true };
 export const FIN: SonioxToken = { text: '<fin>', is_final: true };
 export const ERROR_503 = JSON.stringify({ error_code: 503, error_message: 'Service unavailable' });
 
-/** A virtual clock that counts its live timers: what a stop must leave at zero. */
-export function trackedClock(): { clock: VirtualClock; timers: () => number } {
-  const inner = createVirtualClock(0);
-  const live = new Set<symbol>();
-  const clock: VirtualClock = {
-    now: () => inner.now(),
-    advance: (ms) => inner.advance(ms),
-    setTimeout(fn, ms) {
-      const id = Symbol('timer');
-      live.add(id);
-      const cancel = inner.setTimeout(() => { live.delete(id); fn(); }, ms);
-      return () => { live.delete(id); cancel(); };
-    },
-  };
-  return { clock, timers: () => live.size };
-}
+/** A virtual clock that counts its live timers: the kit's now (Stage 2 Volcengine AST2, its third user). */
+export { trackedClock } from '../../lib/contract/testing/trackedClock';
```

  `gemini/testing.ts`, on the Gemini plan's file (its Tasks 9 and 11), an import and a local export rather than a re-export — its own `startGemini` calls `trackedClock()` (review B1):
  1. Before editing, run `command grep -n 'trackedClock\|VirtualClock\|createVirtualClock' src/providers/gemini/testing.ts`. Expect the import line `import { createVirtualClock, type VirtualClock } from '../../lib/contract/clock';`, the fifteen-line function and its uses of both names, and `startGemini`'s `const { clock, timers } = trackedClock();`. Any other use of `createVirtualClock` or `VirtualClock` means that import stays.
  2. Among the imports, add `import { trackedClock } from '../../lib/contract/testing/trackedClock';`, and delete the `createVirtualClock` / `VirtualClock` import when step 1 showed no other use.
  3. Replace the doc comment `` /** A virtual clock that counts its live timers — what a stop must leave at zero (a copy of `soniox/testing.ts`'s; choice 21). */ `` and the fifteen-line `export function trackedClock() { … }` under it with

```ts
/** A virtual clock that counts its live timers: the kit's now (Stage 2 Volcengine AST2, its third user; Gemini choice 21). */
export { trackedClock };
```

  4. Run the step 1 grep again: the kit import, the local export, and `startGemini`'s call are what remain.

  `socket.ts`, in full:

```ts
/**
 * The one seam Doubao AST 2.0's session side and its check open sockets
 * through (as Soniox's and Gemini's `socket.ts`): `new WebSocket(url)` in
 * the app, a `FakeSocket` factory in tests. The credentials ride in the
 * URL's query (ruling 2 — measured with real credentials, 2026-09-28), so
 * no upgrade header is needed: F14, the header seam, is not built here.
 * The three move to `src/lib/contract/` with F14.
 */
export type OpenSocket = (url: string) => WebSocket;

/** Read at call time, so a test's `vi.stubGlobal('WebSocket')` is seen. */
export const nativeSocket: OpenSocket = (url) => new WebSocket(url);

/** `WebSocket.OPEN`, read as the constant it is: the socket may be an injected one. */
export const WS_OPEN = 1;
```

  `wire.ts`, in full:

```ts
/**
 * Doubao AST 2.0's wire (survey §1.4–1.6): the socket URL with the
 * credentials in its query (ruling 2), the three client frames, and the
 * server's frames decoded at once. The protobuf codec is the generated one,
 * moved from the old client (F18); its declarations type every frame. Pure:
 * no socket, no timer. The URL carries a credential: it is never framed,
 * logged or put in an error (ruling 2), and `redact()` masks its three
 * credential parameters wherever it might reach a sink anyway.
 */
import { data as proto } from './proto/ast2-proto.js';
import type { Ast2Corpus } from './config';
import type { Ast2Credentials } from './settings';

const { TranslateRequest, TranslateResponse } = proto.speech.ast;

/** The protocol's events, named both ways (`EventType.SessionStarted === 150`). */
export const EventType = proto.speech.event.Type;
export type Ast2Response = proto.speech.ast.TranslateResponse;

export const AST2_ENDPOINT = 'wss://openspeech.bytedance.com/api/v4/ast/v2/translate';
/** Doubao AST 2.0's resource: the query's `api_resource_id`, and `requestMeta`'s endpoint and resource. */
export const AST2_RESOURCE_ID = 'volc.service_type.10053';
/** The success status, as HTTP's 200 (`VolcengineAST2Client.ts:555-557`); 0 or none reads the same. */
export const OK_STATUS = 20_000_000;

/**
 * The socket URL (ruling 2; the owner's probe, 2026-09-28): the legacy App
 * ID and Access Token as `api_app_key` / `api_access_key`, or the new
 * console's key as `api_key`, beside the resource id. A refused credential
 * is an HTTP 401 on the upgrade, which a browser sees only as a failed
 * socket.
 */
export function ast2Url(k: Ast2Credentials): string {
  const query = new URLSearchParams({ api_resource_id: AST2_RESOURCE_ID });
  if (k.kind === 'apiKey') {
    query.set('api_key', k.apiKey);
  } else {
    query.set('api_app_key', k.appKey);
    query.set('api_access_key', k.accessKey);
  }
  return `${AST2_ENDPOINT}?${query.toString()}`;
}

/** A socket that failed before it opened, online: what a wrong App ID, Access Token or API key gets — an HTTP 401 on the upgrade (measured 2026-09-28), which a browser cannot see. The check's and the start's words. */
export const REFUSED_UPGRADE = 'Doubao refused the connection before it opened: check the App ID and the Access Token, or the API key.';

/** One connection's ids: a session's, in every frame (`requestMeta`), and the connection's. */
export interface SessionIds { session: string; connection: string }

export interface StartSessionInput {
  ids: SessionIds;
  sequence: number;
  mode: 's2s' | 's2t';
  source: string;
  target: string;
  corpus?: Ast2Corpus;
  /** The legacy App ID, sent in `requestMeta.AppKey` as the old client did (parity); the API key mode sends none (choice 5). */
  appKey?: string;
}

/**
 * `StartSession` (`VolcengineAST2Client.ts:462-526`): 16 kHz pcm in; in
 * `s2s`, 24 kHz Ogg Opus out, the speaker's own voice cloned (no
 * `speaker_id`); in `s2t`, no target audio.
 */
export function startSessionFrame(o: StartSessionInput): Uint8Array {
  return TranslateRequest.encode({
    requestMeta: {
      Endpoint: AST2_RESOURCE_ID,
      ...(o.appKey ? { AppKey: o.appKey } : {}),
      ResourceID: AST2_RESOURCE_ID,
      ConnectionID: o.ids.connection,
      SessionID: o.ids.session,
      Sequence: o.sequence,
    },
    event: EventType.StartSession,
    user: { uid: 'sokuji-user', platform: 'web' },
    sourceAudio: { format: 'pcm', rate: 16_000, bits: 16, channel: 1 },
    request: { mode: o.mode, sourceLanguage: o.source, targetLanguage: o.target, ...(o.corpus ? { corpus: o.corpus } : {}) },
    ...(o.mode === 's2s' ? { targetAudio: { format: 'ogg_opus', rate: 24_000 } } : {}),
  }).finish();
}

/** One `TaskRequest`: a 16 kHz packet's own bytes (little-endian, as the platforms are). */
export function audioFrame(ids: SessionIds, sequence: number, pcm: Int16Array): Uint8Array {
  return TranslateRequest.encode({
    requestMeta: { SessionID: ids.session, ConnectionID: ids.connection, Sequence: sequence },
    event: EventType.TaskRequest,
    sourceAudio: { binaryData: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength) },
  }).finish();
}

export function finishSessionFrame(ids: SessionIds, sequence: number): Uint8Array {
  return TranslateRequest.encode({
    requestMeta: { SessionID: ids.session, ConnectionID: ids.connection, Sequence: sequence },
    event: EventType.FinishSession,
  }).finish();
}

const isArrayBuffer = (data: unknown): data is ArrayBuffer => Object.prototype.toString.call(data) === '[object ArrayBuffer]';

/** A server frame, decoded at once (`binaryType = 'arraybuffer'`), so frames are handled in the order they came; throws when unreadable. */
export function decodeResponse(data: unknown): Ast2Response {
  if (!isArrayBuffer(data)) throw new Error(`a server frame of an unexpected kind (${Object.prototype.toString.call(data)})`);
  return TranslateResponse.decode(new Uint8Array(data));
}

/** An event's name for a frame: the enum's own, or its number. */
export function eventName(event: number): string {
  return (EventType as unknown as Record<number, string | undefined>)[event] ?? `event_${event}`;
}

export function isOk(status: number | null | undefined): boolean {
  return !status || status === OK_STATUS;
}

/**
 * A refusal's notice code (choice 4): Volcengine's 8-digit codes put the
 * client's faults in `4xxxxxxx` and the service's in `5xxxxxxx`; anything
 * else reads as the service's. Unverified against this endpoint: the live
 * test collects the codes it sends.
 */
export function statusFailureCode(status: number): 'client' | 'server' {
  return String(status).startsWith('4') ? 'client' : 'server';
}

/** A refusal in the words `notices.<code>` shows as its detail: the status and the server's own message. */
export function statusText(status: number | null | undefined, message: string | null | undefined): string {
  return `[Doubao ${status || 'no status'}] ${message || 'no message'}`;
}

/** An int64 as the codec hands it — a number, or a Long when the `long` package is present — as a number. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (v && typeof (v as { toNumber?: unknown }).toNumber === 'function') return (v as { toNumber(): number }).toNumber();
  return undefined;
}
```

  `testing.ts`, in full (Task 15 adds the adapter harness to it):

```ts
/**
 * The Doubao AST 2.0 suites' fixtures: credentials of both kinds, the
 * settings the adapter suites build from, the server's frames as the binary
 * frames it sends, and what the client sent, decoded. Test-only: nothing but
 * a test imports it, and the adapter's session walk never reaches it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import type { FakeSocket } from '../../lib/contract/testing/fakeSocket';
import type { SharedSettings } from '../../lib/provider/types';
import { buildAst2, type Ast2Config } from './config';
import { data as proto } from './proto/ast2-proto.js';
import { AST2_DEFAULTS, type Ast2Credentials, type Ast2Settings } from './settings';
import { EventType, OK_STATUS } from './wire';

/** The legacy mode's. The token is shaped as a key `redact()` masks (`sk-…`): a frame that carried it fails the kit's frame-secret rule. */
export const APP_KEY: Ast2Credentials = { kind: 'app', appKey: '1234567890', accessKey: 'sk-ast2token0123456' };
/** The new console's, shaped as `redact()`'s `key-…`. */
export const API_KEY: Ast2Credentials = { kind: 'apiKey', apiKey: 'key-ast2api0123456789' };

/** Ids in the order a start asks for them: its session's, then its connection's. */
export function counterIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}
/** A start's session id, under `counterIds`. */
export const SESSION_ID = 'id-1';

export const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1, translationSeconds: 1 },
  reversed: (d) => d.source === 'en' && d.target === 'zh',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
};
export const AUTO_CTX: SessionContext = { direction: { source: 'zh', target: 'en' }, speech: true, turns: 'auto' };

/** A leg's config: Doubao's defaults, patched. */
export function configFor(context: SessionContext = AUTO_CTX, patch: Partial<Ast2Settings> = {}): Ast2Config {
  return buildAst2(context, { ...AST2_DEFAULTS, ...patch }, SHARED) as Ast2Config;
}

/** A server frame as Doubao sends it: a binary `TranslateResponse`, read as an ArrayBuffer. */
export function serverFrame(r: proto.speech.ast.ITranslateResponse): ArrayBuffer {
  const bytes = proto.speech.ast.TranslateResponse.encode(r).finish();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

type Meta = { session?: string; sequence?: number; status?: number; message?: string };
const meta = (m: Meta = {}) => ({ SessionID: m.session ?? SESSION_ID, Sequence: m.sequence ?? 0, StatusCode: m.status ?? OK_STATUS, ...(m.message ? { Message: m.message } : {}) });
const SUBTITLE = {
  source: { start: EventType.SourceSubtitleStart, response: EventType.SourceSubtitleResponse, end: EventType.SourceSubtitleEnd },
  translation: { start: EventType.TranslationSubtitleStart, response: EventType.TranslationSubtitleResponse, end: EventType.TranslationSubtitleEnd },
};

/** The server frames the suites send, by name. */
export const SERVER = {
  started: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.SessionStarted }),
  subtitle: (side: 'source' | 'translation', phase: 'start' | 'response' | 'end', text = '', m?: Meta & { startTime?: number; endTime?: number }) =>
    serverFrame({ responseMeta: meta(m), event: SUBTITLE[side][phase], text, startTime: m?.startTime ?? 0, endTime: m?.endTime ?? 0 }),
  ttsStart: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSSentenceStart }),
  ttsChunk: (bytes = 64, fill = 7, m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSResponse, data: new Uint8Array(bytes).fill(fill) }),
  ttsEnd: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSSentenceEnd }),
  ttsEnded: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSEnded }),
  /** A refusal: a status other than OK, on any event. */
  status: (status: number, message: string, event = EventType.None) => serverFrame({ responseMeta: meta({ status, message }), event }),
  failed: (message = 'session failed') => serverFrame({ responseMeta: meta({ message }), event: EventType.SessionFailed }),
  finished: () => serverFrame({ responseMeta: meta(), event: EventType.SessionFinished }),
  usage: () => serverFrame({ responseMeta: { ...meta(), Billing: { DurationMsec: 61_000, WordCount: 12, Items: [{ Unit: 'minute', Quantity: 1.02 }] } }, event: EventType.UsageResponse }),
  muted: (ms = 3_000) => serverFrame({ responseMeta: meta(), event: EventType.AudioMuted, mutedDurationMs: ms }),
};

/** What the client sent on this socket, decoded, in order. */
export function sentRequests(socket: FakeSocket): proto.speech.ast.TranslateRequest[] {
  return socket.sent.map((d) => proto.speech.ast.TranslateRequest.decode(d as Uint8Array));
}

/** A `TaskRequest`'s 16 kHz samples. */
export function pcmOf(request: proto.speech.ast.TranslateRequest): Int16Array {
  const bytes = request.sourceAudio?.binaryData ?? new Uint8Array();
  return new Int16Array(new Uint8Array(bytes).buffer);
}
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then `npx vitest run src/providers src/lib/contract`, the full suite and the gate. Soniox's and Gemini's suites import `trackedClock` from their `./testing` as before, and Gemini's harness keeps calling its local binding — `src/providers/gemini` (its adapter and reconnect suites, through `startGemini` / `liveGemini`) is inside the Step 4 command; the session-side guard's kit rule holds `testing.ts` to test-only importers, and nothing but the suites imports it.
- [ ] **Step 5: Commit.**

```bash
git add src/providers/volcengine_ast2/socket.ts src/providers/volcengine_ast2/wire.ts src/providers/volcengine_ast2/wire.test.ts src/providers/volcengine_ast2/testing.ts src/lib/contract/testing/trackedClock.ts src/lib/contract/testing/trackedClock.test.ts src/providers/soniox/testing.ts src/providers/gemini/testing.ts
```

```bash
git commit -q -F - -- src/providers/volcengine_ast2/socket.ts src/providers/volcengine_ast2/wire.ts src/providers/volcengine_ast2/wire.test.ts src/providers/volcengine_ast2/testing.ts src/lib/contract/testing/trackedClock.ts src/lib/contract/testing/trackedClock.test.ts src/providers/soniox/testing.ts src/providers/gemini/testing.ts <<'EOF'
feat(volcengine_ast2): the wire, credentials in the socket's query

The three client frames, decoding and a status's notice code; the URL
carries the legacy App ID and Access Token or the API key in its query,
as the owner's probe measured, so no header seam is needed. The tracked
virtual clock moves to the kit: Doubao is its third user.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

### Task 13: Doubao's own settings view (D18; choice 16)

**Files:**
- Create: `src/providers/volcengine_ast2/Ast2Settings.tsx`
- Test: `src/providers/volcengine_ast2/Ast2Settings.test.tsx`

**Interfaces:**
- Consumes: Task 4's `TextField`; Task 6's `Ast2Settings`; `SettingsProps<S>` (`src/lib/provider/types`).
- Produces: `Ast2SettingsView({ settings, update, disabled })` — the Custom Vocabulary section (three `TextField`s: ids `volcengine-ast2-hot-words`, `volcengine-ast2-replacement`, `volcengine-ast2-glossary`, each with its console link `https://console.volcengine.com/speech/{hotword,correctword,glossary}`, and the footer) and the info section (`.volcengine-info-notice`), the old view's words and inline styles (`ProviderSpecificSettings.tsx:1603-1716`).
- Consumed by: Task 16.

The pair is the generic section's, the speech the Speech section's, the credentials and their mode the credential form's; the view has no turn-detection knobs. Every word is an existing `settings.volcengineAST2*` key with the old English fallback.

- [ ] **Step 1: Write the failing test** — `Ast2Settings.test.tsx`, in full:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
const tooltips: unknown[] = [];
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: ({ content }: { content: unknown }) => { tooltips.push(content); return null; } }));
const { openExternalUrl } = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));
vi.mock('../../utils/openExternalUrl', () => ({ openExternalUrl }));

import { Ast2SettingsView } from './Ast2Settings';
import { AST2_DEFAULTS } from './settings';

beforeEach(() => {
  tooltips.length = 0;
  openExternalUrl.mockClear();
});

describe("Doubao AST 2.0's settings view", () => {
  it('draws the three library ids, each with its tooltip and its console page, writing its own field', () => {
    const update = vi.fn();
    render(<Ast2SettingsView settings={{ ...AST2_DEFAULTS, hotWordTableId: 'hot-1' }} update={update} />);
    expect(screen.getByRole('heading', { name: 'settings.volcengineAST2CustomVocabulary' })).toBeInTheDocument();
    expect((screen.getByLabelText('settings.volcengineAST2HotWordLibraryId') as HTMLInputElement).value).toBe('hot-1');
    fireEvent.change(screen.getByLabelText('settings.volcengineAST2HotWordLibraryId'), { target: { value: 'hot-2' } });
    fireEvent.change(screen.getByLabelText('settings.volcengineAST2ReplacementLibraryId'), { target: { value: 'rep-1' } });
    fireEvent.change(screen.getByLabelText('settings.volcengineAST2GlossaryLibraryId'), { target: { value: 'glo-1' } });
    expect(update.mock.calls).toEqual([[{ hotWordTableId: 'hot-2' }], [{ replacementTableId: 'rep-1' }], [{ glossaryTableId: 'glo-1' }]]);
    expect(tooltips).toEqual(expect.arrayContaining([
      'settings.volcengineAST2HotWordLibraryTooltip', 'settings.volcengineAST2ReplacementLibraryTooltip', 'settings.volcengineAST2GlossaryLibraryTooltip',
    ]));
    const pages = screen.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')]);
    expect(pages).toEqual([
      ['settings.volcengineAST2HotWordManage', 'https://console.volcengine.com/speech/hotword'],
      ['settings.volcengineAST2ReplacementManage', 'https://console.volcengine.com/speech/correctword'],
      ['settings.volcengineAST2GlossaryManage', 'https://console.volcengine.com/speech/glossary'],
    ]);
    fireEvent.click(screen.getByRole('link', { name: 'settings.volcengineAST2GlossaryManage' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://console.volcengine.com/speech/glossary');
  });

  it('says invalid ids are ignored, and what Doubao AST 2.0 does', () => {
    render(<Ast2SettingsView settings={AST2_DEFAULTS} update={vi.fn()} />);
    expect(screen.getByText('settings.volcengineAST2CustomVocabularyFooter')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'settings.volcengineAST2Info' })).toBeInTheDocument();
    expect(screen.getByText('settings.volcengineAST2InfoText').className).toBe('volcengine-info-notice');
  });

  it('locks the three fields while disabled', () => {
    render(<Ast2SettingsView settings={AST2_DEFAULTS} update={vi.fn()} disabled />);
    for (const label of ['settings.volcengineAST2HotWordLibraryId', 'settings.volcengineAST2ReplacementLibraryId', 'settings.volcengineAST2GlossaryLibraryId']) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/providers/volcengine_ast2/Ast2Settings.test.tsx` — FAIL: no module.
- [ ] **Step 3: Implement** `Ast2Settings.tsx`, in full:

```tsx
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TextField } from '../../components/providers/fields/TextField';
import type { SettingsProps } from '../../lib/provider/types';
import type { Ast2Settings as S } from './settings';

/** The console's library pages (`ProviderSpecificSettings.tsx:1606-1694`). */
const CONSOLE = 'https://console.volcengine.com/speech';

/**
 * Doubao AST 2.0's own settings (D18): the old UI's Custom Vocabulary and
 * info blocks (`ProviderSpecificSettings.tsx:1603-1716`), the library ids in
 * the shared `TextField`. The pair is the generic section's, the speech
 * mode the Speech section's, the credentials and their mode the credential
 * form's; there are no turn-detection knobs.
 */
export function Ast2SettingsView({ settings, update, disabled = false }: SettingsProps<S>) {
  const { t } = useTranslation();
  return (
    <>
      <div className="settings-section">
        <h2>{t('settings.volcengineAST2CustomVocabulary', 'Custom Vocabulary')}</h2>
        <TextField
          id="volcengine-ast2-hot-words"
          label={t('settings.volcengineAST2HotWordLibraryId', 'Hot Words Library ID')}
          tooltip={t('settings.volcengineAST2HotWordLibraryTooltip', 'Boost recognition of specific terms.')}
          link={{ href: `${CONSOLE}/hotword`, label: t('settings.volcengineAST2HotWordManage', 'Manage hot words') }}
          value={settings.hotWordTableId}
          onChange={(hotWordTableId) => update({ hotWordTableId })}
          disabled={disabled}
        />
        <TextField
          id="volcengine-ast2-replacement"
          label={t('settings.volcengineAST2ReplacementLibraryId', 'Replacement Library ID')}
          tooltip={t('settings.volcengineAST2ReplacementLibraryTooltip', 'Post-transcription regex text substitution. The referenced library must be a regex word list, not a standard replacement list.')}
          link={{ href: `${CONSOLE}/correctword`, label: t('settings.volcengineAST2ReplacementManage', 'Manage replacement') }}
          value={settings.replacementTableId}
          onChange={(replacementTableId) => update({ replacementTableId })}
          disabled={disabled}
        />
        <TextField
          id="volcengine-ast2-glossary"
          label={t('settings.volcengineAST2GlossaryLibraryId', 'Glossary Library ID')}
          tooltip={t('settings.volcengineAST2GlossaryLibraryTooltip', 'Source→target bilingual term pairs.')}
          link={{ href: `${CONSOLE}/glossary`, label: t('settings.volcengineAST2GlossaryManage', 'Manage glossary') }}
          value={settings.glossaryTableId}
          onChange={(glossaryTableId) => update({ glossaryTableId })}
          disabled={disabled}
        />
        <div className="setting-item" style={{ fontSize: '12px', color: '#888' }}>
          {t('settings.volcengineAST2CustomVocabularyFooter', "Invalid or empty library IDs are silently ignored — the session runs as if the field weren't set. Library changes made in the Volcengine console can take a few minutes to take effect.")}
        </div>
      </div>
      <div className="settings-section">
        <h2>{t('settings.volcengineAST2Info', 'Doubao AST 2.0 Info')}</h2>
        <div className="setting-item">
          <div
            className="volcengine-info-notice"
            style={{ padding: '12px', backgroundColor: 'rgba(16, 163, 127, 0.1)', border: '1px solid rgba(16, 163, 127, 0.3)', borderRadius: '8px', fontSize: '13px', color: '#aaa' }}
          >
            <Info size={14} style={{ marginRight: '8px', verticalAlign: 'middle', color: '#10a37f' }} />
            {t('settings.volcengineAST2InfoText', "Doubao AST 2.0 provides speech-to-speech translation with automatic voice cloning. The translated audio preserves the original speaker's voice characteristics.")}
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then the full suite and the gate.
- [ ] **Step 5: Commit.**

```bash
git add src/providers/volcengine_ast2/Ast2Settings.tsx src/providers/volcengine_ast2/Ast2Settings.test.tsx
```

```bash
git commit -q -F - -- src/providers/volcengine_ast2/Ast2Settings.tsx src/providers/volcengine_ast2/Ast2Settings.test.tsx <<'EOF'
feat(volcengine_ast2): its own settings view

The old Custom Vocabulary rows in the shared text field, each with its
console link, and the info block, in the old words and markup.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

## Wave 4

### Task 14: The check — one bounded handshake (ruling 9; choices 8, 12, 20)

**Files:**
- Create: `src/providers/volcengine_ast2/check.ts`
- Test: `src/providers/volcengine_ast2/check.test.ts`

**Interfaces:**
- Consumes: Task 12's `socket.ts`, `wire.ts` and fixtures (`APP_KEY`, `API_KEY`, `counterIds`, `SERVER`, `sentRequests`), `trackedClock`; the kit's `fakeSockets`, `flush`; `realClock`, `Clock` (`src/lib/contract/clock`); `CheckContext`, `CheckResult`.
- Produces: `CHECK_TIMEOUT_MS = 15_000`; `interface Ast2CheckDeps { openSocket?; clock?: Pick<Clock, 'setTimeout'>; newId?; online?: () => boolean }`; `createAst2Check(deps?)` → `(k: Ast2Credentials, s: Ast2Settings, ctx: CheckContext) => Promise<CheckResult>`; `checkAst2` (the app's).
- Consumed by: Task 16.

One socket per check: `StartSession` in `s2t` for the user's pair, the App ID in `requestMeta.AppKey` in the legacy mode, no libraries (choice 20). `SessionStarted` → `FinishSession`, close, `{ ok: true }`. A refusal in a frame → `{ ok: false, code, reason }` by the status rule (choice 4); `SessionFailed` → `server`. A socket that closes before it opened: online, the credentials (`auth`, `REFUSED_UPGRADE` — the 401 the browser cannot read); offline, the check throws — it could not find out (choice 8). A socket that closes after it opened, or no answer within 15 s, throws. The context's signal ends the socket and the timer and rejects with its reason; a check leaves no timer behind. The check has no models to list.

- [ ] **Step 1: Write the failing test** — `check.test.ts`, in full:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { CheckContext } from '../../lib/provider/types';
import { flush } from '../../lib/contract/testing/drive';
import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import { CHECK_TIMEOUT_MS, createAst2Check } from './check';
import { AST2_DEFAULTS } from './settings';
import { API_KEY, APP_KEY, counterIds, SERVER, sentRequests } from './testing';
import { ast2Url, EventType, REFUSED_UPGRADE } from './wire';

const ctx = (signal?: AbortSignal): CheckContext => ({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'], signal });

function setup(o: { online?: boolean } = {}) {
  const sockets = fakeSockets();
  const { clock, timers } = trackedClock();
  const check = createAst2Check({ openSocket: sockets.create, clock, newId: counterIds(), online: () => o.online ?? true });
  return { sockets, clock, timers, check, socket: () => sockets.last() };
}

describe("Doubao AST 2.0's check (ruling 9)", () => {
  it("opens the socket with the credentials in its query, starts a text-only session for the user's pair, and on SessionStarted finishes it and closes", async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    expect(h.socket().url).toBe(ast2Url(APP_KEY));
    expect(h.socket().binaryType).toBe('arraybuffer');
    h.socket().open();
    const [start] = sentRequests(h.socket());
    expect(start.event).toBe(EventType.StartSession);
    expect(start.request).toMatchObject({ mode: 's2t', sourceLanguage: 'ja', targetLanguage: 'en' });
    expect(start.targetAudio ?? null).toBeNull();
    expect(start.requestMeta).toMatchObject({ AppKey: '1234567890', SessionID: 'id-1', ConnectionID: 'id-2' });
    h.socket().receive(SERVER.started());
    await expect(answer).resolves.toEqual({ ok: true });
    expect(sentRequests(h.socket()).map((r) => r.event)).toEqual([EventType.StartSession, EventType.FinishSession]);
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    expect(h.timers()).toBe(0);
  });

  it('checks an API key the same way, with no App ID in the session', async () => {
    const h = setup();
    const answer = h.check(API_KEY, AST2_DEFAULTS, ctx());
    expect(h.socket().url).toBe(ast2Url(API_KEY));
    h.socket().open();
    expect(sentRequests(h.socket())[0].requestMeta?.AppKey).toBe('');
    h.socket().receive(SERVER.started());
    await expect(answer).resolves.toEqual({ ok: true });
  });

  it("answers a status refusal not ready, with the server's words and the status's code", async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().open();
    h.socket().receive(SERVER.status(45000001, 'unsupported language pair', EventType.SessionFailed));
    await expect(answer).resolves.toEqual({ ok: false, code: 'client', reason: '[Doubao 45000001] unsupported language pair' });
    expect(h.socket().closedByClient).not.toBeNull();
  });

  it('answers SessionFailed with an OK status not ready, as the service', async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().open();
    h.socket().receive(SERVER.failed('quota exhausted'));
    await expect(answer).resolves.toEqual({ ok: false, code: 'server', reason: '[Doubao 20000000] quota exhausted' });
  });

  it('reads a socket that fails before it opens as refused credentials — the auth words — while online', async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().drop();
    await expect(answer).resolves.toEqual({ ok: false, code: 'auth', reason: REFUSED_UPGRADE });
    expect(h.timers()).toBe(0);
  });

  it('throws when it could not find out: offline, or a close after the socket opened', async () => {
    const offline = setup({ online: false });
    const a = offline.check(APP_KEY, AST2_DEFAULTS, ctx());
    offline.socket().drop();
    await expect(a).rejects.toThrow('The device is offline: Doubao could not be reached.');

    const h = setup();
    const b = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().open();
    h.socket().serverClose(1011, 'busy');
    await expect(b).rejects.toThrow("Doubao closed the check's connection before the session started (1011 busy).");
  });

  it('bounds its handshake: no answer within 15 s throws and closes the socket', async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    const settled = vi.fn();
    answer.then(settled, settled);
    h.socket().open();
    h.clock.advance(CHECK_TIMEOUT_MS - 1);
    await flush();
    expect(settled).not.toHaveBeenCalled();
    h.clock.advance(1);
    await expect(answer).rejects.toThrow('Doubao did not answer the check within 15 s.');
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);
  });

  it("the start's signal aborts the handshake, closing the socket and cancelling the timer; an aborted one opens nothing", async () => {
    const h = setup();
    const c = new AbortController();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx(c.signal));
    c.abort(new Error('cancelled'));
    await expect(answer).rejects.toThrow('cancelled');
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);

    const fresh = setup();
    await expect(fresh.check(APP_KEY, AST2_DEFAULTS, ctx(AbortSignal.abort(new Error('gone'))))).rejects.toThrow('gone');
    expect(fresh.sockets.all).toEqual([]);
  });

  it('ignores a frame it cannot read, and still answers', async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().open();
    h.socket().receive('not a frame');
    h.socket().receive(SERVER.started());
    await expect(answer).resolves.toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/providers/volcengine_ast2/check.test.ts` — FAIL: no module.
- [ ] **Step 3: Implement** `check.ts`, in full:

```ts
/**
 * Doubao AST 2.0's readiness (spec: "Readiness is one check"; ruling 9):
 * one real handshake — the socket with the credentials in its query, a
 * text-only `StartSession` for the pair, and on `SessionStarted` a
 * `FinishSession` and the close. No audio is sent. Bounded by
 * `CHECK_TIMEOUT_MS` and the caller's signal; the socket is closed on every
 * path. A browser cannot see the upgrade's 401: a socket that fails before
 * it opens is read as refused credentials, unless the device is offline
 * (choice 8). The settings side: not reached by the adapter, so its clock
 * and ids may default to the real ones.
 */
import { realClock, type Clock } from '../../lib/contract/clock';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import type { Ast2Credentials, Ast2Settings } from './settings';
import { nativeSocket, WS_OPEN, type OpenSocket } from './socket';
import { ast2Url, decodeResponse, EventType, finishSessionFrame, isOk, REFUSED_UPGRADE, startSessionFrame, statusFailureCode, statusText } from './wire';

/** As long as Soniox's and Gemini's checks wait. */
export const CHECK_TIMEOUT_MS = 15_000;

export interface Ast2CheckDeps {
  openSocket?: OpenSocket;
  clock?: Pick<Clock, 'setTimeout'>;
  newId?: () => string;
  /** False: the device is offline, and a failed socket says nothing about the credentials. */
  online?: () => boolean;
}

export function createAst2Check(deps: Ast2CheckDeps = {}) {
  const clock = deps.clock ?? realClock;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const online = deps.online ?? (() => navigator.onLine !== false);
  return (k: Ast2Credentials, _s: Ast2Settings, ctx: CheckContext): Promise<CheckResult> => {
    if (ctx.signal?.aborted) return Promise.reject(ctx.signal.reason ?? new Error('aborted'));
    // Read at call time, so a test's stubbed global is seen.
    const openSocket = deps.openSocket ?? nativeSocket;
    return new Promise<CheckResult>((resolve, reject) => {
      const ids = { session: newId(), connection: newId() };
      let sequence = 0;
      let opened = false;
      let settled = false;
      const socket = openSocket(ast2Url(k));
      socket.binaryType = 'arraybuffer';
      const finish = (answer: { result: CheckResult } | { error: unknown }) => {
        if (settled) return;
        settled = true;
        cancel();
        ctx.signal?.removeEventListener('abort', onAbort);
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        // CONNECTING or OPEN: close it; CLOSING or CLOSED already is.
        if (socket.readyState <= WS_OPEN) socket.close(1000);
        if ('result' in answer) resolve(answer.result);
        else reject(answer.error);
      };
      const cancel = clock.setTimeout(() => finish({ error: new Error(`Doubao did not answer the check within ${CHECK_TIMEOUT_MS / 1000} s.`) }), CHECK_TIMEOUT_MS);
      const onAbort = () => finish({ error: ctx.signal?.reason ?? new Error('aborted') });
      ctx.signal?.addEventListener('abort', onAbort, { once: true });

      socket.onopen = () => {
        opened = true;
        // Text only: no voice is set up, and every spoken pair also runs as text (ruling 9). The user's pair, so a pair Doubao refuses is refused here.
        socket.send(startSessionFrame({ ids, sequence: sequence++, mode: 's2t', source: ctx.pair.source, target: ctx.pair.target, ...(k.kind === 'app' ? { appKey: k.appKey } : {}) }));
      };
      socket.onmessage = (e: MessageEvent) => {
        let r;
        try {
          r = decodeResponse(e.data);
        } catch {
          return;
        }
        const status = r.responseMeta?.StatusCode ?? 0;
        if (!isOk(status)) {
          finish({ result: { ok: false, code: statusFailureCode(status), reason: statusText(status, r.responseMeta?.Message) } });
        } else if (r.event === EventType.SessionFailed) {
          finish({ result: { ok: false, code: 'server', reason: statusText(status, r.responseMeta?.Message) } });
        } else if (r.event === EventType.SessionStarted) {
          if (socket.readyState === WS_OPEN) socket.send(finishSessionFrame(ids, sequence++));
          finish({ result: { ok: true } });
        }
      };
      socket.onclose = (e: CloseEvent) => {
        if (opened) {
          finish({ error: new Error(`Doubao closed the check's connection before the session started (${e.code}${e.reason ? ` ${e.reason}` : ''}).`) });
        } else if (online()) {
          finish({ result: { ok: false, code: 'auth', reason: REFUSED_UPGRADE } });
        } else {
          finish({ error: new Error('The device is offline: Doubao could not be reached.') });
        }
      };
    });
  };
}

export const checkAst2 = createAst2Check();
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then the full suite and the gate. The session-side guard does not reach `check.ts`: nothing on the session side imports it (the refusal's words live in `wire.ts`).
- [ ] **Step 5: Commit.**

```bash
git add src/providers/volcengine_ast2/check.ts src/providers/volcengine_ast2/check.test.ts
```

```bash
git commit -q -F - -- src/providers/volcengine_ast2/check.ts src/providers/volcengine_ast2/check.test.ts <<'EOF'
feat(volcengine_ast2): check the credentials with one bounded handshake

A text-only StartSession for the user's pair, then FinishSession; a
refused upgrade reads as the credentials while online and as not found
out while offline; fifteen seconds at most.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

### Task 15: The adapter (rulings 6–12; choices 3, 8–12, 18, 19)

**Files:**
- Modify: `src/providers/volcengine_ast2/adapter.ts` (the seed, replaced), `src/providers/volcengine_ast2/testing.ts` (the harness added), `src/providers/sessionSide.consistency.test.ts`
- Test: `src/providers/volcengine_ast2/adapter.test.ts`

**Interfaces:**
- Consumes: Task 7's `InputPacer` (`push`, `drain`, `tail`), `IDLE_MS`, `KEEPALIVE_MS`, `PACKET_SAMPLES`, `TAIL_MS`; Task 8's `Ast2Segments`, `SubtitlePhase`, `Ast2Speech`, `OggDecoder`, `decodeOggOpus`; Task 12's `socket.ts`, `wire.ts`, fixtures and `trackedClock`; the contract (`AdapterStartError`, `Adapter`, `AdapterEvents`, `AdapterSession`, `Side`, `StartRequest`), `every`, `framePayload`, `describeCause`; the kit (`fakeSockets`, `recordEvents`, `runScenario`, `scenarioNames`, `flush`); the Gemini plan's F16 through `createProjector` (the projection case).
- Produces: `START_TIMEOUT_MS = 30_000`; `interface Ast2AdapterDeps { openSocket: OpenSocket; decode: OggDecoder; newId: () => string; online: () => boolean }`; `createAst2Adapter(deps?: Partial<Ast2AdapterDeps>): Adapter<Ast2Config, Ast2Credentials>`; `testing.ts` gains `startAst2(o?)` and `liveAst2(o?)`.
- Consumed by: Task 16.

One leg, one socket (`ast2Url`). The start resolves at `SessionStarted`; before it:
- a status or `SessionFailed` rejects with its code;
- a socket closed before it opened rejects `auth` (online) or `network` (offline), with the refusal's words, never the URL;
- one closed after it opened rejects `server`;
- 30 s with no answer rejects `network` (never opened) or `server` (opened);
- an abort ends the socket and rejects with the signal's reason, and a start whose signal already aborted opens nothing.

Live:
- **Audio up:** every chunk goes through the pacer, one `TaskRequest` per 80 ms packet, `Sequence` counting from 1.
- **Keepalive** (choice 10): `every(clock, 80)`; a tick sends one silent packet only once no audio went out for 250 ms, `audio.idle` framing the first of an idle and `audio.resumed` the first real chunk after; an idle's first tick sends what the pacer holds before its silence (`drain`), so no speech from before the idle follows it (review M1).
- **Turns:** under manual turns, `endTurn` and `cancelTurn` send the tail (`turn.tail`, `{ cancelled: true }` for a cancel) and restamp; under automatic turns they send nothing.
- **Subtitles** → segments with no origin and no timing (choice 3); each `subtitle.*` frame carries phase, ref, text, `startTime`, `endTime`, `sequence` and `spkChg`.
- **Speech** (ruling 10): `TTSSentenceStart` locks the ref — the translation started then, shown or not, else the last shown; a clip for a segment not yet opened waits in L1 until it opens (review I3) — `TTSResponse` chunks collect, `TTSSentenceEnd` / `TTSEnded` flush one decode; a text-only leg ignores every TTS event (choice 19).
- **Ending:** a status error fails the run with its code, `SessionFailed` as `server`; the server's `SessionFinished` / `SessionCanceled` close it (`leg_closed`); a close by the server fails it `connection_lost`; a frame of another session is dropped (`session.foreign`); an unreadable frame is framed and said `parse_error`, once per episode.
- **Stop** sends `FinishSession` when open, closes, clears every timer and emits nothing after.

The conformance harness runs the kit's scenarios (the socket-level ones through `FakeSocket`).

- [ ] **Step 1: Write the failing tests.** `adapter.test.ts`, in full:

```ts
/**
 * Doubao AST 2.0's adapter: the conformance suite, the opening and its
 * refusals in words, the audio going up (resampled, paced, kept alive,
 * tailed), subtitles to segments, spoken sentences, failures and stop. On
 * `FakeSocket` and a virtual clock — no network, no fake timers.
 */
import { describe, it, expect } from 'vitest';
import { AdapterStartError } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { flush, type ScenarioStep } from '../../lib/contract/testing/drive';
import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { runScenario, scenarioNames, type AdapterHarness } from '../../lib/contract/testing/scenarios';
import { Conversation } from '../../lib/conversation/Conversation';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import { createAst2Adapter, START_TIMEOUT_MS } from './adapter';
import { IDLE_MS, KEEPALIVE_MS } from './audioIn';
import type { Ast2Config } from './config';
import type { Ast2Credentials } from './settings';
import type { OggDecoder } from './speech';
import { API_KEY, APP_KEY, AUTO_CTX, configFor, counterIds, liveAst2, pcmOf, SERVER, startAst2 } from './testing';
import { ast2Url, EventType, REFUSED_UPGRADE } from './wire';

const MANUAL = { ...AUTO_CTX, turns: 'manual' as const };
/** A capture chunk: 2 048 samples of 24 kHz voice, 85.3 ms. */
const chunk = () => new Int16Array(2_048).fill(1_000);
const isSilent = (pcm: Int16Array) => pcm.every((s) => s === 0);

function harness(): AdapterHarness<Ast2Config, Ast2Credentials> {
  let sockets = fakeSockets();
  let ids = counterIds();
  const last = () => sockets.last();
  const reply = (frame: () => ArrayBuffer): ScenarioStep => ({ run: () => last().receive(frame()) });
  return {
    adapter: createAst2Adapter({ openSocket: (url) => sockets.create(url), decode: async (ogg) => new Int16Array(ogg.length), newId: () => ids(), online: () => true }),
    config: (context) => { sockets = fakeSockets(); ids = counterIds(); return configFor(context); },
    credentials: APP_KEY,
    opening: () => [{ run: () => last().open() }, reply(() => SERVER.started()), { flush: true }],
    exchange: [
      reply(() => SERVER.subtitle('source', 'start')),
      reply(() => SERVER.subtitle('source', 'response', '你好')),
      reply(() => SERVER.subtitle('source', 'end', '你好。')),
      reply(() => SERVER.subtitle('translation', 'start')),
      reply(() => SERVER.subtitle('translation', 'response', 'Hello')),
      reply(() => SERVER.subtitle('translation', 'end', 'Hello.')),
      reply(() => SERVER.ttsStart()),
      reply(() => SERVER.ttsChunk(96)),
      reply(() => SERVER.ttsEnd()),
    ],
    serverClose: [{ run: () => last().serverClose(1011, 'Internal error') }, { flush: true }],
    refuse: [{ run: () => last().drop() }, { flush: true }],
  };
}

describe('the Doubao AST 2.0 adapter: conformance', () => {
  const h = harness();

  it('runs every scenario but typed text and reconnecting, which Doubao has neither of', () => {
    expect(scenarioNames(h)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'server-close']);
  });

  it.each(scenarioNames(h))('%s', async (name) => {
    const report = await runScenario(h, name);
    expect(report.violations).toEqual([]);
    expect(report.problems).toEqual([]);
  });
});

describe('the Doubao AST 2.0 adapter: opening', () => {
  it('dials the endpoint with the credentials in its query, reads binary frames as ArrayBuffers, and starts its session once the socket opens', () => {
    const h = startAst2({ patch: { hotWordTableId: 'hot-1' } });
    expect(h.socket().url).toBe(ast2Url(APP_KEY));
    expect(h.socket().binaryType).toBe('arraybuffer');
    expect(h.requests()).toEqual([]);
    h.socket().open();
    const [start] = h.requests();
    expect(start.event).toBe(EventType.StartSession);
    expect(start.requestMeta).toMatchObject({ AppKey: '1234567890', SessionID: 'id-1', ConnectionID: 'id-2', Sequence: 0 });
    expect(start.request).toMatchObject({ mode: 's2s', sourceLanguage: 'zh', targetLanguage: 'en', corpus: { boostingTableId: 'hot-1' } });
    expect(start.targetAudio).toMatchObject({ format: 'ogg_opus', rate: 24000 });
    expect(h.frames('session.start')).toEqual([{ sessionId: 'id-1', mode: 's2s', source: 'zh', target: 'en', corpus: { boostingTableId: 'hot-1' } }]);
  });

  it('dials an API key in its query and sends no App ID; a silent leg starts text only, with no target audio', () => {
    const h = startAst2({ credentials: API_KEY, context: { ...AUTO_CTX, speech: false } });
    expect(h.socket().url).toBe(ast2Url(API_KEY));
    h.socket().open();
    const [start] = h.requests();
    expect(start.requestMeta?.AppKey).toBe('');
    expect(start.request).toMatchObject({ mode: 's2t' });
    expect(start.targetAudio ?? null).toBeNull();
  });

  it('resolves only on SessionStarted, emitting nothing but frames, over a websocket, its keepalive armed', async () => {
    const h = startAst2();
    let resolved = false;
    void h.starting.then(() => { resolved = true; });
    h.socket().open();
    await flush();
    expect(resolved).toBe(false);
    h.socket().receive(SERVER.started());
    const session = await h.starting;
    expect(session.info).toEqual({ transport: 'websocket' });
    expect(h.frames('session.started')).toEqual([{ sessionId: 'id-1' }]);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(1);
  });

  it.each([
    [true, 'auth', REFUSED_UPGRADE],
    [false, 'network', 'The device is offline: Doubao could not be reached.'],
  ] as const)('a socket that fails before it opens (online: %s) rejects as %s, in words (choice 8)', async (online, code, message) => {
    const h = startAst2({ online });
    h.socket().drop();
    const error = await h.starting.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect(error).toMatchObject({ code, message });
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it("a refusal before SessionStarted rejects with the status's code and Doubao's words; SessionFailed as the service's; a close after the open as the service's", async () => {
    const status = startAst2();
    status.socket().open();
    status.socket().receive(SERVER.status(45000001, 'unsupported language pair', EventType.SessionFailed));
    await expect(status.starting).rejects.toMatchObject({ code: 'client', message: '[Doubao 45000001] unsupported language pair' });
    expect(status.frames('session.status')).toEqual([{ event: 'SessionFailed', statusCode: 45000001, message: 'unsupported language pair', sequence: 0 }]);
    expect(status.socket().closedByClient).not.toBeNull();

    const failed = startAst2();
    failed.socket().open();
    failed.socket().receive(SERVER.failed('no quota'));
    await expect(failed.starting).rejects.toMatchObject({ code: 'server', message: '[Doubao 20000000] no quota' });

    const closed = startAst2();
    closed.socket().open();
    closed.socket().serverClose(1011, 'busy');
    await expect(closed.starting).rejects.toMatchObject({ code: 'server', message: 'Doubao closed the connection before the session started (1011 busy).' });
    expect(closed.content()).toEqual([]);
  });

  it('bounds the start: no SessionStarted within 30 s rejects — network when the socket never opened, server when it did — and closes the socket', async () => {
    const never = startAst2();
    never.clock.advance(START_TIMEOUT_MS);
    await expect(never.starting).rejects.toMatchObject({ code: 'network', message: 'Doubao did not open the connection within 30 s.' });
    expect(never.socket().closedByClient).not.toBeNull();
    expect(never.timers()).toBe(0);

    const silent = startAst2();
    let settled = false;
    void silent.starting.catch(() => { settled = true; });
    silent.socket().open();
    silent.clock.advance(START_TIMEOUT_MS - 1);
    await flush();
    expect(settled).toBe(false);
    silent.clock.advance(1);
    await expect(silent.starting).rejects.toMatchObject({ code: 'server', message: 'Doubao did not start the session within 30 s.' });
  });

  it('an abort while opening rejects with its reason, closes the socket and emits nothing; a start already aborted opens no socket', async () => {
    const h = startAst2();
    h.socket().open();
    const reason = new Error('cancelled');
    h.controller.abort(reason);
    await expect(h.starting).rejects.toBe(reason);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);

    const sockets = fakeSockets();
    const controller = new AbortController();
    controller.abort(reason);
    const starting = createAst2Adapter({ openSocket: sockets.create }).start(
      { context: AUTO_CTX, config: configFor(), credentials: APP_KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    );
    await expect(starting).rejects.toBe(reason);
    expect(sockets.all).toEqual([]);
  });
});

describe('the Doubao AST 2.0 adapter: audio up', () => {
  it('sends 16 kHz in 80 ms packets, each its own TaskRequest with the ids and the next Sequence, and frames none of them', async () => {
    const h = await liveAst2();
    for (let i = 0; i < 3; i++) h.session.appendAudio(chunk());
    const audio = h.requests().slice(1);
    expect(audio.map((r) => r.event)).toEqual([EventType.TaskRequest, EventType.TaskRequest, EventType.TaskRequest]);
    expect(audio.map((r) => r.requestMeta?.Sequence)).toEqual([1, 2, 3]);
    expect(audio.every((r) => r.requestMeta?.SessionID === 'id-1' && r.requestMeta?.ConnectionID === 'id-2')).toBe(true);
    expect(audio.map((r) => pcmOf(r).length)).toEqual([1_280, 1_280, 1_280]);
    expect(h.of('frame').filter((f) => f.payload.direction === 'out').map((f) => f.payload.type)).toEqual(['session.start']);
  });

  it('never splices silence into speech: none goes up while chunks arrive every 85 ms (ruling 7; survey §0.6)', async () => {
    const h = await liveAst2();
    for (let i = 0; i < 36; i++) {
      h.session.appendAudio(chunk());
      h.clock.advance(85);
    }
    const packets = h.requests().slice(1).map(pcmOf);
    expect(packets.length).toBeGreaterThan(30);
    expect(packets.filter(isSilent)).toEqual([]);
    expect(h.frames('audio.idle')).toEqual([]);
  });

  it('keeps the session alive after a real idle: one 80 ms of silence per 80 ms, framed on the transitions only (ruling 7)', async () => {
    const h = await liveAst2();
    h.session.appendAudio(chunk());
    const sent = () => h.requests().slice(1).map(pcmOf);
    const before = sent().length;
    // Ticks at 80, 160, 240 ms: under the idle threshold.
    h.clock.advance(240);
    expect(sent().length).toBe(before);
    // 320 ms: past it — what the pacer held (the chunk's last 84 samples), the first silent packet, and the one frame for them.
    h.clock.advance(KEEPALIVE_MS);
    expect(sent().slice(before).map((p) => [p.length, isSilent(p)])).toEqual([[84, false], [1_280, true]]);
    expect(h.frames('audio.idle')).toEqual([{ sinceMs: 320 }]);
    h.clock.advance(800);
    expect(sent().length).toBe(before + 12);
    expect(h.frames('audio.idle')).toHaveLength(1);
    // Speech again: resumed once, and no silence until the next real idle.
    h.session.appendAudio(chunk());
    expect(h.frames('audio.resumed')).toEqual([undefined]);
    const resumedAt = sent().length;
    h.clock.advance(IDLE_MS - 10);
    expect(sent().length).toBe(resumedAt);
  });

  it('sends what the pacer holds before the first silence of an idle, so no speech from before it follows the silence (ruling 7)', async () => {
    const h = await liveAst2();
    h.session.appendAudio(new Int16Array(600).fill(500));
    // Ticks at 80, 160, 240 ms, then 320 ms: the first past the idle threshold.
    h.clock.advance(4 * KEEPALIVE_MS);
    expect(h.requests().slice(1).map(pcmOf).map((p) => [p.length, isSilent(p)])).toEqual([[400, false], [1_280, true]]);
    // Speech again: nothing left over from before the idle rides ahead of it.
    h.session.appendAudio(new Int16Array(1_920).fill(700));
    expect(h.requests().slice(3).map(pcmOf).map((p) => [p.length, p.every((s) => s === 700)])).toEqual([[1_280, true]]);
  });

  it('a push-to-talk release or cancel sends what waits and 500 ms of silence at once (ruling 6); automatic turns send none', async () => {
    const h = await liveAst2({ context: MANUAL });
    h.session.beginTurn();
    h.session.appendAudio(new Int16Array(600).fill(500));
    h.session.endTurn();
    const tail = h.requests().slice(1).map(pcmOf);
    expect(tail.map((p) => p.length)).toEqual([400, 1_280, 1_280, 1_280, 1_280, 1_280, 1_280, 320]);
    expect(tail.slice(1).every(isSilent)).toBe(true);
    h.session.cancelTurn();
    expect(h.frames('turn.tail')).toEqual([{ ms: 500 }, { ms: 500, cancelled: true }]);

    const auto = await liveAst2();
    auto.session.beginTurn();
    auto.session.endTurn();
    auto.session.cancelTurn();
    expect(auto.requests()).toHaveLength(1);
  });
});

describe('the Doubao AST 2.0 adapter: what comes down', () => {
  it("makes each side's subtitles a segment with no origin and no timing, framing the Sequence and both times (ruling 11)", async () => {
    const h = await liveAst2();
    h.socket().receive(SERVER.subtitle('source', 'start', '', { sequence: 4 }));
    h.socket().receive(SERVER.subtitle('source', 'response', '你好', { sequence: 4, startTime: 120, endTime: 900 }));
    h.socket().receive(SERVER.subtitle('source', 'end', '你好。', { sequence: 4, startTime: 120, endTime: 1_300 }));
    h.socket().receive(SERVER.subtitle('translation', 'end', 'Hello.', { sequence: 4, startTime: 150, endTime: 1_350 }));
    expect(h.content().map((e) => e.kind)).toEqual(['segmentOpened', 'segmentText', 'segmentText', 'segmentClosed', 'segmentOpened', 'segmentText', 'segmentClosed']);
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source' }, { ref: 2, side: 'translation' }]);
    expect(h.of('segmentText').every((e) => e.payload.timing === undefined && e.payload.language === undefined)).toBe(true);
    expect(h.frames('subtitle.source')).toEqual([
      { phase: 'start', ref: 1, text: '', startTime: 0, endTime: 0, sequence: 4, spkChg: false },
      { phase: 'response', ref: 1, text: '你好', startTime: 120, endTime: 900, sequence: 4, spkChg: false },
      { phase: 'end', ref: 1, text: '你好。', startTime: 120, endTime: 1_300, sequence: 4, spkChg: false },
    ]);
    expect(h.frames('subtitle.translation')).toEqual([{ phase: 'end', ref: 2, text: 'Hello.', startTime: 150, endTime: 1_350, sequence: 4, spkChg: false }]);
  });

  it('plays each spoken sentence as one rangeless clip on the translation locked at its start (ruling 10)', async () => {
    const h = await liveAst2();
    h.socket().receive(SERVER.subtitle('translation', 'response', 'Hello'));
    h.socket().receive(SERVER.ttsStart({ sequence: 5 }));
    h.socket().receive(SERVER.subtitle('translation', 'end', 'Hello.'));
    h.socket().receive(SERVER.subtitle('translation', 'response', 'Next'));
    h.socket().receive(SERVER.ttsChunk(40));
    h.socket().receive(SERVER.ttsChunk(24));
    h.socket().receive(SERVER.ttsEnd({ sequence: 5 }));
    await flush();
    expect(h.of('audio').map((e) => e.payload)).toEqual([{ pcm: new Int16Array(64), ref: 1 }]);
    expect(h.frames('tts.sentence_start')).toEqual([{ ref: 1, sequence: 5 }]);
    expect(h.frames('tts.sentence_end')).toEqual([{ chunks: 2, bytes: 64, sequence: 5 }]);
  });

  it("plays a sentence that starts before its translation's first text on that translation's row, not the previous one (ruling 10)", async () => {
    const h = await liveAst2();
    const conv = new Conversation({ leg: 'speaker', session: 'ast2', languages: AUTO_CTX.direction, clock: h.clock });
    let folded = 0;
    const fold = () => {
      for (const e of h.log.slice(folded)) if (e.kind !== 'frame') conv.apply(e);
      folded = h.log.length;
    };
    h.socket().receive(SERVER.subtitle('translation', 'end', 'Hello.'));
    // The next translation has started, with no text yet, when its sentence does.
    h.socket().receive(SERVER.subtitle('translation', 'start'));
    h.socket().receive(SERVER.ttsStart());
    h.socket().receive(SERVER.ttsChunk(64));
    h.socket().receive(SERVER.ttsEnd());
    await flush();
    fold();
    expect(h.frames('tts.sentence_start')).toEqual([{ ref: 2, sequence: 0 }]);
    expect(h.of('audio').map((e) => e.payload.ref)).toEqual([2]);
    // L1 holds the clip until the segment opens.
    h.socket().receive(SERVER.subtitle('translation', 'response', 'How are you?'));
    h.socket().receive(SERVER.subtitle('translation', 'end', 'How are you?'));
    fold();
    const translations = conv.snapshot().segments.filter((s) => s.side === 'translation');
    expect(translations.map((s) => [s.text, s.speech.length])).toEqual([['Hello.', 0], ['How are you?', 1]]);
    expect(translations[1].speech[0].pcm).toHaveLength(64);
  });

  it('keeps the order and the refs of two sentences whose decodes overlap, and flushes what TTSEnded leaves', async () => {
    const waiting: Array<() => void> = [];
    const decode: OggDecoder = (ogg) => new Promise((resolve) => { waiting.push(() => resolve(new Int16Array(ogg.length))); });
    const h = await liveAst2({ decode });
    h.socket().receive(SERVER.subtitle('translation', 'response', 'One'));
    h.socket().receive(SERVER.ttsStart());
    h.socket().receive(SERVER.ttsChunk(10));
    h.socket().receive(SERVER.ttsEnd());
    h.socket().receive(SERVER.subtitle('translation', 'start'));
    h.socket().receive(SERVER.subtitle('translation', 'response', 'Two'));
    h.socket().receive(SERVER.ttsStart());
    h.socket().receive(SERVER.ttsChunk(20));
    h.socket().receive(SERVER.ttsEnded());
    await flush();
    waiting[0]();
    await flush();
    waiting[1]();
    await flush();
    expect(h.of('audio').map((e) => [e.payload.ref, e.payload.pcm.length])).toEqual([[1, 10], [2, 20]]);
    expect(h.frames('tts.ended')).toEqual([{ chunks: 1, bytes: 20, sequence: 0 }]);
  });

  it('a leg that does not speak ignores every TTS event', async () => {
    const h = await liveAst2({ context: { ...AUTO_CTX, speech: false } });
    h.socket().receive(SERVER.subtitle('translation', 'response', 'Hi'));
    h.socket().receive(SERVER.ttsStart());
    h.socket().receive(SERVER.ttsChunk());
    h.socket().receive(SERVER.ttsEnd());
    await flush();
    expect(h.of('audio')).toEqual([]);
    expect(h.frames('tts.sentence_start')).toEqual([]);
  });

  it('a clip that will not decode says tts_degraded, and the session goes on', async () => {
    const h = await liveAst2({ decode: async () => { throw new Error('EncodingError'); } });
    h.socket().receive(SERVER.ttsStart());
    h.socket().receive(SERVER.ttsChunk());
    h.socket().receive(SERVER.ttsEnd());
    await flush();
    expect(h.of('degraded').map((e) => [e.payload.code, e.payload.reason])).toEqual([['tts_degraded', 'tts_decode']]);
    expect(h.of('failed')).toEqual([]);
  });

  it('frames usage and a muted microphone; drops a foreign session; never frames a credential or the URL', async () => {
    const h = await liveAst2();
    h.socket().receive(SERVER.usage());
    h.socket().receive(SERVER.muted(3_000));
    h.socket().receive(SERVER.subtitle('source', 'response', 'not ours', { session: 'someone-else' }));
    h.socket().receive(SERVER.subtitle('source', 'response', 'ours'));
    expect(h.frames('session.usage')).toEqual([{ durationMsec: 61_000, wordCount: 12, items: [{ unit: 'minute', quantity: expect.closeTo(1.02, 5) }] }]);
    expect(h.frames('session.audio_muted')).toEqual([{ mutedDurationMs: 3_000 }]);
    expect(h.frames('session.foreign')).toEqual([{ event: 'SourceSubtitleResponse' }]);
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['ours']);
    const everything = JSON.stringify(h.of('frame'));
    expect(everything).not.toContain('sk-ast2token0123456');
    expect(everything).not.toContain('1234567890');
    expect(everything).not.toContain('api_access_key');
  });

  it('pairs an exchange by proximity through the projection (F16): no origin stated, inferred', async () => {
    const h = await liveAst2();
    const conv = new Conversation({ leg: 'speaker', session: 'ast2', languages: AUTO_CTX.direction, clock: h.clock });
    let folded = 0;
    /** L1 folds the content as it arrives, so each segment opens at its own time. */
    const fold = () => {
      for (const e of h.log.slice(folded)) if (e.kind !== 'frame') conv.apply(e);
      folded = h.log.length;
    };
    h.socket().receive(SERVER.subtitle('source', 'end', '你好，今天怎么样？'));
    fold();
    h.clock.advance(600);
    h.socket().receive(SERVER.subtitle('translation', 'end', 'Hello, how are you today?'));
    fold();
    const entries = createProjector().project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'off', sentencesPerRow: 0 });
    const exchanges = entries.filter((e) => e.kind === 'exchange');
    expect(exchanges).toHaveLength(1);
    for (const ex of exchanges) { if (ex.kind === 'exchange') expect(ex.pairing).toBe('inferred'); }
  });
});

describe('the Doubao AST 2.0 adapter: failures and stop', () => {
  it("fails the run on a mid-session status with the status's code, once, and then says nothing (ruling 8)", async () => {
    const h = await liveAst2();
    h.socket().receive(SERVER.status(55000031, 'server busy'));
    const n = h.log.length;
    await flush();
    h.clock.advance(10_000);
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'server', message: '[Doubao 55000031] server busy' }]);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);
    expect(h.log.length).toBe(n);
  });

  it("fails on SessionFailed after the start, where the old client ignored it; closes on the server's SessionFinished", async () => {
    const failed = await liveAst2();
    failed.socket().receive(SERVER.failed('killed'));
    expect(failed.of('failed').map((e) => e.payload.code)).toEqual(['server']);

    const finished = await liveAst2();
    finished.socket().receive(SERVER.finished());
    expect(finished.of('closed').map((e) => e.payload)).toEqual([{ reason: 'SessionFinished' }]);
  });

  it('an unexpected close fails with connection_lost; a socket error alone is a Logs line', async () => {
    const h = await liveAst2();
    h.socket().onerror?.call(h.socket(), new Event('error'));
    expect(h.frames('session.socket_error')).toHaveLength(1);
    expect(h.of('failed')).toEqual([]);
    h.socket().serverClose(1006, '');
    await flush();
    expect(h.frames('session.connection_lost')).toEqual([{ code: 1006, reason: '' }]);
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to Doubao closed (1006).' }]);
    expect(h.timers()).toBe(0);
  });

  it('a frame that will not read is degraded once per episode, and the stream goes on', async () => {
    const h = await liveAst2();
    h.socket().receive('not a frame');
    h.socket().receive(new ArrayBuffer(3));
    h.socket().receive(SERVER.subtitle('source', 'response', 'Hi'));
    h.socket().receive('again');
    expect(h.frames('session.unreadable')).toHaveLength(3);
    expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['parse_error', 'parse_error']);
    expect(h.of('segmentOpened')).toHaveLength(1);
  });

  it('stop sends FinishSession and closes the socket before it returns, cancels every timer, and nothing follows — a decode still running included', async () => {
    const waiting: Array<() => void> = [];
    const decode: OggDecoder = (ogg) => new Promise((resolve) => { waiting.push(() => resolve(new Int16Array(ogg.length))); });
    const h = await liveAst2({ decode });
    h.socket().receive(SERVER.subtitle('translation', 'response', 'Hi'));
    h.socket().receive(SERVER.ttsStart());
    h.socket().receive(SERVER.ttsChunk());
    h.socket().receive(SERVER.ttsEnd());
    await flush();
    const n = h.log.length;
    const stopping = h.session.stop();
    expect(h.requests().map((r) => r.event).slice(-1)).toEqual([EventType.FinishSession]);
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    await stopping;
    expect(h.timers()).toBe(0);
    waiting[0]();
    h.clock.advance(10_000);
    await flush();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(h.log.length).toBe(n);
  });
});
```

  `testing.ts`, in full — Task 12's file with the header's second sentence, four imports and the harness added:

```ts
/**
 * The Doubao AST 2.0 suites' fixtures: credentials of both kinds, the
 * settings the adapter suites build from, the server's frames as the binary
 * frames it sends, what the client sent, decoded, and a leg started over
 * `FakeSocket`s. Test-only: nothing but a test imports it (the session-side
 * guard's kit rule holds it to that, since it imports the kit), and the
 * adapter's session walk never reaches it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { fakeSockets, type FakeSocket } from '../../lib/contract/testing/fakeSocket';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import type { SharedSettings } from '../../lib/provider/types';
import { createAst2Adapter } from './adapter';
import { buildAst2, type Ast2Config } from './config';
import { data as proto } from './proto/ast2-proto.js';
import { AST2_DEFAULTS, type Ast2Credentials, type Ast2Settings } from './settings';
import type { OggDecoder } from './speech';
import { EventType, OK_STATUS } from './wire';

/** The legacy mode's. The token is shaped as a key `redact()` masks (`sk-…`): a frame that carried it fails the kit's frame-secret rule. */
export const APP_KEY: Ast2Credentials = { kind: 'app', appKey: '1234567890', accessKey: 'sk-ast2token0123456' };
/** The new console's, shaped as `redact()`'s `key-…`. */
export const API_KEY: Ast2Credentials = { kind: 'apiKey', apiKey: 'key-ast2api0123456789' };

/** Ids in the order a start asks for them: its session's, then its connection's. */
export function counterIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}
/** A start's session id, under `counterIds`. */
export const SESSION_ID = 'id-1';

export const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1, translationSeconds: 1 },
  reversed: (d) => d.source === 'en' && d.target === 'zh',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
};
export const AUTO_CTX: SessionContext = { direction: { source: 'zh', target: 'en' }, speech: true, turns: 'auto' };

/** A leg's config: Doubao's defaults, patched. */
export function configFor(context: SessionContext = AUTO_CTX, patch: Partial<Ast2Settings> = {}): Ast2Config {
  return buildAst2(context, { ...AST2_DEFAULTS, ...patch }, SHARED) as Ast2Config;
}

/** A server frame as Doubao sends it: a binary `TranslateResponse`, read as an ArrayBuffer. */
export function serverFrame(r: proto.speech.ast.ITranslateResponse): ArrayBuffer {
  const bytes = proto.speech.ast.TranslateResponse.encode(r).finish();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

type Meta = { session?: string; sequence?: number; status?: number; message?: string };
const meta = (m: Meta = {}) => ({ SessionID: m.session ?? SESSION_ID, Sequence: m.sequence ?? 0, StatusCode: m.status ?? OK_STATUS, ...(m.message ? { Message: m.message } : {}) });
const SUBTITLE = {
  source: { start: EventType.SourceSubtitleStart, response: EventType.SourceSubtitleResponse, end: EventType.SourceSubtitleEnd },
  translation: { start: EventType.TranslationSubtitleStart, response: EventType.TranslationSubtitleResponse, end: EventType.TranslationSubtitleEnd },
};

/** The server frames the suites send, by name. */
export const SERVER = {
  started: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.SessionStarted }),
  subtitle: (side: 'source' | 'translation', phase: 'start' | 'response' | 'end', text = '', m?: Meta & { startTime?: number; endTime?: number }) =>
    serverFrame({ responseMeta: meta(m), event: SUBTITLE[side][phase], text, startTime: m?.startTime ?? 0, endTime: m?.endTime ?? 0 }),
  ttsStart: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSSentenceStart }),
  ttsChunk: (bytes = 64, fill = 7, m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSResponse, data: new Uint8Array(bytes).fill(fill) }),
  ttsEnd: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSSentenceEnd }),
  ttsEnded: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSEnded }),
  /** A refusal: a status other than OK, on any event. */
  status: (status: number, message: string, event = EventType.None) => serverFrame({ responseMeta: meta({ status, message }), event }),
  failed: (message = 'session failed') => serverFrame({ responseMeta: meta({ message }), event: EventType.SessionFailed }),
  finished: () => serverFrame({ responseMeta: meta(), event: EventType.SessionFinished }),
  usage: () => serverFrame({ responseMeta: { ...meta(), Billing: { DurationMsec: 61_000, WordCount: 12, Items: [{ Unit: 'minute', Quantity: 1.02 }] } }, event: EventType.UsageResponse }),
  muted: (ms = 3_000) => serverFrame({ responseMeta: meta(), event: EventType.AudioMuted, mutedDurationMs: ms }),
};

/** What the client sent on this socket, decoded, in order. */
export function sentRequests(socket: FakeSocket): proto.speech.ast.TranslateRequest[] {
  return socket.sent.map((d) => proto.speech.ast.TranslateRequest.decode(d as Uint8Array));
}

/** A `TaskRequest`'s 16 kHz samples. */
export function pcmOf(request: proto.speech.ast.TranslateRequest): Int16Array {
  const bytes = request.sourceAudio?.binaryData ?? new Uint8Array();
  return new Int16Array(new Uint8Array(bytes).buffer);
}

/** A Doubao leg started over `FakeSocket`s on a tracked virtual clock; its socket not yet opened. The decoder answers one sample per byte, unless given its own. */
export function startAst2(o: { context?: SessionContext; credentials?: Ast2Credentials; patch?: Partial<Ast2Settings>; decode?: OggDecoder; online?: boolean } = {}) {
  const sockets = fakeSockets();
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const controller = new AbortController();
  const context = o.context ?? AUTO_CTX;
  const config = configFor(context, o.patch);
  const decode = o.decode ?? (async (ogg: Uint8Array) => new Int16Array(ogg.length));
  const adapter = createAst2Adapter({ openSocket: sockets.create, decode, newId: counterIds(), online: () => o.online ?? true });
  const starting = adapter.start({ context, config, credentials: o.credentials ?? APP_KEY, clock, signal: controller.signal }, events);
  const socket = () => sockets.last();
  const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  /** The payloads of the frames of one type, in order. */
  const frames = (type: string) => of('frame').filter((e) => e.payload.type === type).map((e) => e.payload.payload);
  /** What the client sent on the leg's socket, decoded. */
  const requests = () => sentRequests(socket());
  /** The log without its frames: what L1 folds. */
  const content = () => log.filter((e) => e.kind !== 'frame');
  return { sockets, clock, timers, log, controller, config, starting, socket, of, frames, requests, content };
}

/** Started, opened and answered: the start resolved. */
export async function liveAst2(o?: Parameters<typeof startAst2>[0]) {
  const h = startAst2(o);
  h.socket().open();
  h.socket().receive(SERVER.started());
  const session = await h.starting;
  return { ...h, session };
}
```

  `sessionSide.consistency.test.ts`, in "every provider keeps its adapter in adapter.ts, and the walk follows its folder", after the Gemini block (its `for` over `['check.ts', 'config.ts', 'settings.ts', 'provider.ts', 'testing.ts']`) and before the case's closing `});`:

```ts
    const ast2 = sessionSide(REPO_ROOT, 'src/providers/volcengine_ast2');
    expect(ast2).toEqual(expect.arrayContaining([
      'src/providers/volcengine_ast2/adapter.ts',
      'src/providers/volcengine_ast2/audioIn.ts',
      'src/providers/volcengine_ast2/decode.ts',
      // The generated codec, reached by its `.js` specifier: scanned like the rest (no timer, no store).
      'src/providers/volcengine_ast2/proto/ast2-proto.js',
      'src/providers/volcengine_ast2/segments.ts',
      'src/providers/volcengine_ast2/socket.ts',
      'src/providers/volcengine_ast2/speech.ts',
      'src/providers/volcengine_ast2/wire.ts',
    ]));
    // The builder, the check, the settings, the view, the definition and the fixtures are not the session's.
    for (const file of ['Ast2Settings.tsx', 'check.ts', 'config.ts', 'provider.ts', 'settings.ts', 'testing.ts']) {
      expect(ast2).not.toContain(`src/providers/volcengine_ast2/${file}`);
    }
```

- [ ] **Step 2: Run** `npx vitest run src/providers/volcengine_ast2/adapter.test.ts src/providers/sessionSide.consistency.test.ts` — FAIL: `createAst2Adapter` is not exported (the seed is `export {};`); the walk finds only `adapter.ts`.
- [ ] **Step 3: Implement** `adapter.ts`, in full, replacing the seed:

```ts
/**
 * Doubao AST 2.0 on the new contract (spec: "L0 — the client contract"),
 * ported from `VolcengineAST2Client` (`src/services/clients/`, still
 * compiled until the deletion plan) without its display bookkeeping: items,
 * ids and the punctuation lane are L1's and L2's now. One protobuf socket
 * per leg, its credentials in the URL's query (ruling 2); subtitles become
 * segments (`segments.ts`), spoken sentences rangeless audio (`speech.ts`),
 * and what goes up is resampled and paced (`audioIn.ts`). Every timer reads
 * the request's clock, and nothing is said but through events (CLAUDE.md,
 * "Inside an IClient session").
 */
import {
  AdapterStartError,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type Side,
  type StartRequest,
} from '../../lib/contract/adapter';
import { every } from '../../lib/contract/clock';
import { framePayload } from '../../lib/contract/framePayload';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { IDLE_MS, InputPacer, KEEPALIVE_MS, PACKET_SAMPLES, TAIL_MS } from './audioIn';
import type { Ast2Config } from './config';
import { decodeOggOpus } from './decode';
import { Ast2Segments, type SubtitlePhase } from './segments';
import type { Ast2Credentials } from './settings';
import { nativeSocket, WS_OPEN, type OpenSocket } from './socket';
import { Ast2Speech, type OggDecoder } from './speech';
import {
  ast2Url,
  audioFrame,
  decodeResponse,
  eventName,
  EventType,
  finishSessionFrame,
  isOk,
  REFUSED_UPGRADE,
  startSessionFrame,
  statusFailureCode,
  statusText,
  toNumber,
  type Ast2Response,
  type SessionIds,
} from './wire';

/** The old client's bound on the start (`VolcengineAST2Client.ts:438-448`), now on the request's clock. */
export const START_TIMEOUT_MS = 30_000;

export interface Ast2AdapterDeps {
  /** `new WebSocket(url)` in the app; a `FakeSocket` factory in tests. */
  openSocket: OpenSocket;
  /** A spoken sentence's Ogg Opus as 24 kHz pcm (`decode.ts` in the app). */
  decode: OggDecoder;
  /** A fresh session or connection id. */
  newId: () => string;
  /** False: the device is offline, and a socket that failed before it opened says nothing about the credentials. */
  online: () => boolean;
}

/** The keepalive's packet: 80 ms of silence. */
const SILENCE = new Int16Array(PACKET_SAMPLES);

const SUBTITLES: Readonly<Record<number, [Side, SubtitlePhase]>> = {
  [EventType.SourceSubtitleStart]: ['source', 'start'],
  [EventType.SourceSubtitleResponse]: ['source', 'response'],
  [EventType.SourceSubtitleEnd]: ['source', 'end'],
  [EventType.TranslationSubtitleStart]: ['translation', 'start'],
  [EventType.TranslationSubtitleResponse]: ['translation', 'response'],
  [EventType.TranslationSubtitleEnd]: ['translation', 'end'],
};

const closeWords = (e: CloseEvent) => `${e.code}${e.reason ? ` ${e.reason}` : ''}`;

class Ast2Leg implements AdapterSession {
  readonly info = { transport: 'websocket' };
  readonly opening: Promise<AdapterSession>;
  private phase: 'opening' | 'live' | 'ended' = 'opening';
  private opened = false;
  private readonly ids: SessionIds;
  private sequence = 0;
  private readonly socket: WebSocket;
  private readonly segments: Ast2Segments;
  /** None on a leg that does not speak: its TTS events are ignored (`s2t` sends none). */
  private readonly speech: Ast2Speech | null;
  private readonly pacer = new InputPacer();
  private lastAudioAt = 0;
  private idle = false;
  private unreadable = false;
  private stopKeepalive: () => void = () => {};
  private settle: { resolve(): void; reject(error: unknown): void } | null = null;

  constructor(
    private readonly request: StartRequest<Ast2Config, Ast2Credentials>,
    private readonly events: AdapterEvents,
    private readonly deps: Ast2AdapterDeps,
  ) {
    this.ids = { session: deps.newId(), connection: deps.newId() };
    this.segments = new Ast2Segments(events);
    this.speech = request.config.mode === 's2s' ? new Ast2Speech(deps.decode, events) : null;
    this.socket = deps.openSocket(ast2Url(request.credentials));
    this.socket.binaryType = 'arraybuffer';
    this.opening = new Promise<AdapterSession>((resolve, reject) => {
      const { clock, signal } = request;
      const cancelTimer = clock.setTimeout(() => this.refuse(this.opened
        ? new AdapterStartError(`Doubao did not start the session within ${START_TIMEOUT_MS / 1000} s.`, 'server')
        : new AdapterStartError(`Doubao did not open the connection within ${START_TIMEOUT_MS / 1000} s.`, 'network')), START_TIMEOUT_MS);
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
    this.socket.onerror = () => { if (this.phase !== 'ended') this.frame('in', 'session.socket_error'); };
    this.socket.onclose = (e: CloseEvent) => this.onClose(e);
  }

  appendAudio(pcm: Int16Array): void {
    if (this.phase !== 'live') return;
    for (const packet of this.pacer.push(pcm)) this.sendAudio(packet);
    this.lastAudioAt = this.request.clock.now();
    if (this.idle) {
      this.idle = false;
      this.frame('out', 'audio.resumed');
    }
  }

  /** Doubao takes no typed text (`textInput: false`). */
  appendText(): void {}

  /** Nothing to mark: Doubao's own VAD finds speech. */
  beginTurn(): void {}

  /** A release, with or without speech (ruling 6): what waits, then 500 ms of silence at once, so the server closes the segment now. */
  endTurn(): void {
    this.tail(false);
  }

  cancelTurn(): void {
    this.tail(true);
  }

  /** `FinishSession` and the close before its first `await`; what the server still sends is not awaited (parity). */
  stop(): Promise<void> {
    if (this.phase === 'live' && this.socket.readyState === WS_OPEN) this.socket.send(finishSessionFrame(this.ids, this.sequence++));
    this.shutDown();
    return Promise.resolve();
  }

  private onOpen(): void {
    if (this.phase !== 'opening') return;
    this.opened = true;
    const { config, credentials } = this.request;
    this.socket.send(startSessionFrame({
      ids: this.ids,
      sequence: this.sequence++,
      mode: config.mode,
      source: config.sourceLanguage,
      target: config.targetLanguage,
      ...(config.corpus ? { corpus: config.corpus } : {}),
      ...(credentials.kind === 'app' ? { appKey: credentials.appKey } : {}),
    }));
    // Never the request's meta: it carries the App ID (`conformance.ts`' credential rule).
    this.frame('out', 'session.start', { sessionId: this.ids.session, mode: config.mode, source: config.sourceLanguage, target: config.targetLanguage, corpus: config.corpus ?? null });
  }

  private onMessage(data: unknown): void {
    if (this.phase === 'ended') return;
    let r: Ast2Response;
    try {
      r = decodeResponse(data);
    } catch (error) {
      this.frame('in', 'session.unreadable', { detail: describeCause(error) });
      // Once per episode: the next frame that reads clears it.
      if (this.phase === 'live' && !this.unreadable) {
        this.unreadable = true;
        this.events.degraded({ code: 'parse_error', message: `A message from Doubao could not be read: ${describeCause(error)}`, cause: error });
      }
      return;
    }
    this.unreadable = false;
    const meta = r.responseMeta;
    const status = meta?.StatusCode ?? 0;
    const sequence = meta?.Sequence ?? 0;
    if (!isOk(status)) {
      this.frame('in', 'session.status', { event: eventName(r.event), statusCode: status, message: meta?.Message ?? '', sequence });
      // Ruling 8: a refusal while opening; mid-session, the run ends with its code.
      this.failWith(statusFailureCode(status), statusText(status, meta?.Message));
      return;
    }
    if (meta?.SessionID && meta.SessionID !== this.ids.session) {
      this.frame('in', 'session.foreign', { event: eventName(r.event) });
      return;
    }
    const subtitle = SUBTITLES[r.event];
    if (subtitle) {
      this.subtitle(subtitle[0], subtitle[1], r, sequence);
      return;
    }
    switch (r.event) {
      case EventType.SessionStarted:
        this.frame('in', 'session.started', { sessionId: this.ids.session });
        if (this.phase === 'opening') this.started();
        return;
      case EventType.SessionFailed:
        this.frame('in', 'session.failed', { statusCode: status, message: meta?.Message ?? '' });
        this.failWith('server', statusText(status, meta?.Message));
        return;
      case EventType.SessionFinished:
      case EventType.SessionCanceled:
        this.frame('in', r.event === EventType.SessionFinished ? 'session.finished' : 'session.canceled');
        if (this.phase === 'opening') this.refuse(new AdapterStartError('Doubao ended the session before it started.', 'server'));
        else this.end({ reason: eventName(r.event) });
        return;
      case EventType.TTSSentenceStart:
      case EventType.TTSResponse:
      case EventType.TTSSentenceEnd:
      case EventType.TTSEnded:
        this.tts(r, sequence);
        return;
      case EventType.UsageResponse: {
        const billing = meta?.Billing;
        this.frame('in', 'session.usage', {
          durationMsec: toNumber(billing?.DurationMsec) ?? null,
          wordCount: toNumber(billing?.WordCount) ?? null,
          items: (billing?.Items ?? []).map((i) => ({ unit: i.Unit ?? '', quantity: i.Quantity ?? 0 })),
        });
        return;
      }
      case EventType.AudioMuted:
        this.frame('in', 'session.audio_muted', { mutedDurationMs: r.mutedDurationMs });
        return;
      default:
        if (r.event !== EventType.None) this.frame('in', 'session.unknown', { event: eventName(r.event) });
    }
  }

  /** One subtitle, with what pairing may need later framed beside it (ruling 11): the Sequence and both times. */
  private subtitle(side: Side, phase: SubtitlePhase, r: Ast2Response, sequence: number): void {
    const ref = this.phase === 'live' ? this.segments.subtitle(side, phase, r.text) : null;
    this.frame('in', `subtitle.${side}`, { phase, ref, text: r.text, startTime: r.startTime, endTime: r.endTime, sequence, spkChg: r.spkChg });
  }

  private tts(r: Ast2Response, sequence: number): void {
    const speech = this.speech;
    if (!speech || this.phase !== 'live') return;
    if (r.event === EventType.TTSResponse) {
      speech.chunk(r.data);
    } else if (r.event === EventType.TTSSentenceStart) {
      const ref = this.segments.speechRef();
      speech.sentenceStart(ref);
      this.frame('in', 'tts.sentence_start', { ref: ref ?? null, sequence });
    } else {
      this.frame('in', r.event === EventType.TTSSentenceEnd ? 'tts.sentence_end' : 'tts.ended', { ...speech.flush(), sequence });
    }
  }

  private started(): void {
    this.phase = 'live';
    this.lastAudioAt = this.request.clock.now();
    this.stopKeepalive = every(this.request.clock, KEEPALIVE_MS, () => this.keepalive());
    const settle = this.settle;
    this.settle = null;
    settle?.resolve();
  }

  /**
   * The keepalive (ruling 7): nothing reaches the server while the
   * microphone is muted or between push-to-talk turns, and it would time the
   * session out. Silence goes up only once no audio has for `IDLE_MS`, one
   * 80 ms packet per 80 ms, so it is never spliced between two chunks of
   * speech (survey §0.6). Framed on the transitions only. An idle's first
   * tick sends what the pacer still holds before any silence, so no speech
   * from before the idle follows it.
   */
  private keepalive(): void {
    if (this.phase !== 'live') return;
    const since = this.request.clock.now() - this.lastAudioAt;
    if (since < IDLE_MS) return;
    if (!this.idle) {
      this.idle = true;
      for (const packet of this.pacer.drain()) this.sendAudio(packet);
      this.frame('out', 'audio.idle', { sinceMs: since });
    }
    this.sendAudio(SILENCE);
  }

  private tail(cancelled: boolean): void {
    if (this.phase !== 'live' || this.request.context.turns !== 'manual') return;
    for (const packet of this.pacer.tail()) this.sendAudio(packet);
    this.lastAudioAt = this.request.clock.now();
    this.frame('out', 'turn.tail', { ms: TAIL_MS, ...(cancelled ? { cancelled: true } : {}) });
  }

  private sendAudio(packet: Int16Array): void {
    if (this.socket.readyState === WS_OPEN) this.socket.send(audioFrame(this.ids, this.sequence++, packet));
  }

  private onClose(e: CloseEvent): void {
    if (this.phase === 'opening') {
      this.frame('in', 'session.connection_lost', { code: e.code, reason: e.reason });
      // A browser cannot see the upgrade's HTTP status (choice 8).
      this.refuse(this.opened
        ? new AdapterStartError(`Doubao closed the connection before the session started (${closeWords(e)}).`, 'server')
        : this.deps.online()
          ? new AdapterStartError(REFUSED_UPGRADE, 'auth')
          : new AdapterStartError('The device is offline: Doubao could not be reached.', 'network'));
      return;
    }
    if (this.phase !== 'live') return;
    this.frame('in', 'session.connection_lost', { code: e.code, reason: e.reason });
    this.end({ failed: { code: 'connection_lost', message: `The connection to Doubao closed (${closeWords(e)}).` } });
  }

  private failWith(code: 'client' | 'server', message: string): void {
    if (this.phase === 'opening') this.refuse(new AdapterStartError(message, code));
    else this.end({ failed: { code, message } });
  }

  /** A start that will not resolve: rejected once, the socket closed, nothing emitted but frames. */
  private refuse(error: unknown): void {
    if (this.phase !== 'opening') return;
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

  private shutDown(): void {
    this.phase = 'ended';
    this.stopKeepalive();
    this.speech?.stop();
    if (this.socket.readyState <= WS_OPEN) this.socket.close(1000);
  }

  private frame(direction: 'in' | 'out', type: string, payload?: Record<string, unknown>): void {
    this.events.frame(payload === undefined ? { direction, type } : { direction, type, payload: framePayload(payload) });
  }
}

export function createAst2Adapter(deps: Partial<Ast2AdapterDeps> = {}): Adapter<Ast2Config, Ast2Credentials> {
  const resolved: Ast2AdapterDeps = {
    openSocket: deps.openSocket ?? nativeSocket,
    decode: deps.decode ?? decodeOggOpus,
    newId: deps.newId ?? (() => crypto.randomUUID()),
    online: deps.online ?? (() => navigator.onLine !== false),
  };
  return {
    start(request, events) {
      // An aborted start opens nothing.
      if (request.signal.aborted) return Promise.reject(request.signal.reason ?? new Error('aborted'));
      return new Ast2Leg(request, events, resolved).opening;
    },
  };
}
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then `npx vitest run src/providers/volcengine_ast2 src/lib/contract`, the full suite and the gate. The walk now reaches the codec by its `.js` specifier and scans it like the rest: no timer, no store.
- [ ] **Step 5: Commit.**

```bash
git add src/providers/volcengine_ast2/adapter.ts src/providers/volcengine_ast2/adapter.test.ts src/providers/volcengine_ast2/testing.ts src/providers/sessionSide.consistency.test.ts
```

```bash
git commit -q -F - -- src/providers/volcengine_ast2/adapter.ts src/providers/volcengine_ast2/adapter.test.ts src/providers/volcengine_ast2/testing.ts src/providers/sessionSide.consistency.test.ts <<'EOF'
feat(volcengine_ast2): the adapter on the new contract

One protobuf socket per leg with its credentials in the query; audio
resampled to 16 kHz in 80 ms packets, silence sent only after a real
idle, the push-to-talk tail on release; subtitles as segments paired by
L2; each spoken sentence one clip on the translation locked at its
start; a status error ends the run with its code.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Group check A (controller)

After Wave 4 (Tasks 1–15). The contract changes, the store, the surfaces, the credential choice, Doubao's settings, check, view and adapter are in; Doubao is not registered.

1. The full gates: `npx vitest run src` (0 failed, no unhandled errors) and the typecheck gate (the 20 baseline lines).
2. The old suites by name: `npx vitest run src/services src/components/Settings` — green: the old AST2 client reaches its codec through the stub, and its descriptors, language sync and settings UI are untouched.
3. Both release builds; `npx vitest run extension`; the three D24 greps print nothing; `command grep -rlF 'audio.idle' build extension/dist` prints nothing — nothing reaches the adapter yet.
4. The full tree's typecheck — `npx tsc --noEmit -p tsconfig.json` written to `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/ast2-groupA-tsc.txt`, counted with `command grep -c 'error TS'` — is at most the count recorded at this plan's starting point (259 at `3665711d`; the Gemini plan adds none).
5. Every probe green on a fresh vite: the spine probes (subtitle, surface, export, audio, gate, local) and `app-panel-probe` (preview; `--settings`). They run the store's derived pair (Task 9) and the language surfaces (Task 11) on providers whose languages ignore the context, where nothing may move.
6. **Inferred pairing in the preview** (Task 5), on `/?preview=spine&panel=1&provider=fake` with the fake's `proximity` script chosen in its settings and keep-audio on: two exchanges, each source row beside its translation, each with its replay button once its clip played, no karaoke highlight. A screenshot under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`.
7. **The credential choice without a provider that has one:** `/?preview=spine&settings=advanced` and `&settings=simple` render every credential form as before — no `.credential-choice-group` in the DOM.

---

## Wave 5

### Task 16: The definition, registered fourth (rulings 1, 2, 4, 5)

**Files:**
- Create: `src/providers/volcengine_ast2/provider.ts`
- Modify: `src/providers/registry.ts`, `src/providers/registry.test.ts`, `src/components/SetupWizard/providerPaths.test.ts`, `src/providers/gemini/provider.test.ts`
- Test: `src/providers/volcengine_ast2/provider.test.ts`

**Interfaces:**
- Consumes: every earlier task's product; `VolcengineIcon` (`src/components/Icons/ProviderIcons.tsx:121`); the Gemini plan's registry (`RELEASED` with `geminiProvider`).
- Produces: `volcengineAst2Provider: Provider<Ast2Settings, Ast2Credentials, Ast2Config> & { id: 'volcengine_ast2' }`; `RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, sonioxProvider]`; `ProviderId` gains `'volcengine_ast2'`.
- Consumed by: Task 17 (its tests reach Doubao through the registry); group check B; the owner's live test.

The old enum's id and slice (`volcengine_ast2`, `volcengineAST2` — `LEGACY_SLICE_KEYS` already maps them, `src/lib/session/storedSettings.ts`), so a stored selection, the credentials and the libraries carry over. `platforms` includes `web` (ruling 2); no `flagged` (ruling 5), no `i18nKey` (the catalogs spell `providers.volcengine_ast2.*`), no `session` hooks, no `TurnDetection`, no `participantSpeech` (ruling 4: the participant speaks when its switch is on). `speech: 'optional'`, `textInput: false`, `boundaries: 'provider'`, `turns: ['auto', 'manual']`; `guideUrl` is today's `TUTORIAL_URLS` value (`src/services/tutorialUrls.ts:19`) as a literal. `check` wraps `checkAst2` in an arrow (the definition's `check` is typed over the provider's own parameters).

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

import { VolcengineIcon } from '../../components/Icons/ProviderIcons';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { readCredentials } from '../../lib/provider/credentials';
import { contextsFor } from '../../lib/session/shape';
import type { RunShape } from '../../lib/session/types';
import { useProviderStore } from '../../stores/providerStore';
import { PROVIDERS } from '../registry';
import { Ast2SettingsView } from './Ast2Settings';
import { buildAst2, describeAst2, type Ast2Config } from './config';
import { volcengineAst2Provider } from './provider';
import { AST2_DEFAULTS, ast2Credentials, ast2Languages, migrateAst2Settings, type Ast2Settings } from './settings';
import { APP_KEY, AUTO_CTX, configFor, SHARED } from './testing';

afterEach(() => {
  vi.unstubAllGlobals();
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false, legs: ['speaker'], speech: { textOnly: false, participantSpeech: false } });
});

describe('the Doubao AST 2.0 definition', () => {
  it('is Doubao AST 2.0 with your own credentials, on every platform (ruling 2), under its old id and slice', () => {
    expect(volcengineAst2Provider).toMatchObject({
      id: 'volcengine_ast2',
      kind: 'own-key',
      platforms: ['electron', 'extension', 'web'],
      icon: VolcengineIcon,
      guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/volcengine-ast2-setup',
      settings: { key: 'volcengineAST2', defaults: AST2_DEFAULTS, migrate: migrateAst2Settings },
      Settings: Ast2SettingsView,
      credentials: ast2Credentials,
      languages: ast2Languages,
      build: buildAst2,
      describe: describeAst2,
    });
    for (const absent of ['flagged', 'i18nKey', 'TurnDetection', 'session', 'participantSpeech'] as const) {
      expect(volcengineAst2Provider, absent).not.toHaveProperty(absent);
    }
  });

  it('speaks optionally, takes no typed text, lets the server end segments, and offers both turn modes', () => {
    expect(volcengineAst2Provider.speech).toBe('optional');
    expect(volcengineAst2Provider.textInput).toBe(false);
    expect(volcengineAst2Provider.boundaries(AST2_DEFAULTS)).toBe('provider');
    expect(volcengineAst2Provider.turns(AST2_DEFAULTS)).toEqual(['auto', 'manual']);
  });

  it('sits after Gemini and before Soniox (ruling 5)', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids.indexOf('volcengine_ast2')).toBe(ids.indexOf('gemini') + 1);
    expect(ids.indexOf('volcengine_ast2')).toBe(ids.indexOf('soniox') - 1);
  });

  it('lets the participant speak when its switch is on, speech to speech on the reversed pair (ruling 4)', () => {
    const shape = { provider: volcengineAst2Provider, pair: { source: 'zh', target: 'en' }, legs: ['speaker', 'participant'], textOnly: false, participantSpeech: true, turnMode: 'auto' } as unknown as RunShape;
    const participant = contextsFor(shape).participant!;
    expect(participant).toEqual({ direction: { source: 'en', target: 'zh' }, speech: true, turns: 'auto' });
    expect((volcengineAst2Provider.build(participant, AST2_DEFAULTS, SHARED) as Ast2Config).mode).toBe('s2s');
    expect(contextsFor({ ...shape, participantSpeech: false }).participant!.speech).toBe(false);
  });

  it('a start whose signal already aborted opens no socket', async () => {
    const opened = vi.fn();
    vi.stubGlobal('WebSocket', opened);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(volcengineAst2Provider.start(
      { context: AUTO_CTX, config: configFor(), credentials: APP_KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    )).rejects.toBe(reason);
    expect(opened).not.toHaveBeenCalled();
  });

  it("loads an old profile as it was: the legacy mode, an App ID stored as a number read as text, the zhen pair repaired, nothing written", async () => {
    stored.set('settings.volcengineAST2.appId', 123456);
    stored.set('settings.volcengineAST2.accessToken', 'tok');
    stored.set('settings.volcengineAST2.hotWordTableId', 'hot-1');
    stored.set('settings.volcengineAST2.sourceLanguage', 'zhen');
    stored.set('settings.volcengineAST2.targetLanguage', 'en');
    await useProviderStore.getState().load(volcengineAst2Provider);
    const entry = useProviderStore.getState().entries.volcengine_ast2;
    expect(entry.settings as Ast2Settings).toEqual({ ...AST2_DEFAULTS, hotWordTableId: 'hot-1' });
    expect(readCredentials(volcengineAst2Provider, entry.settings, entry.credentials, { signedIn: false, getToken: async () => null })).toEqual({ kind: 'app', appKey: '123456', accessKey: 'tok' });
    expect(entry.pair).toEqual({ source: 'zhen', target: 'zhen' });
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("keeps a text-only pair stored while a run would speak, and offers it back once text only is on (choice 1)", async () => {
    stored.set('settings.volcengineAST2.sourceLanguage', 'ko');
    stored.set('settings.volcengineAST2.targetLanguage', 'zh');
    await useProviderStore.getState().load(volcengineAst2Provider);
    expect(useProviderStore.getState().entries.volcengine_ast2.pair).toEqual({ source: 'zh', target: 'en' });
    useProviderStore.getState().setSpeech({ textOnly: true, participantSpeech: false });
    expect(useProviderStore.getState().entries.volcengine_ast2.pair).toEqual({ source: 'ko', target: 'zh' });
    expect(setSetting).not.toHaveBeenCalled();
  });
});
```

  `registry.test.ts`, "the release offers its providers in the owner's order": the comment's last line becomes `// product order put the managed provider first; then LocalInference, Gemini (Stage 2 Gemini, ruling 6), Doubao AST 2.0 (Stage 2 Volcengine AST2, ruling 5), then Soniox with your own key.` and the expectation

```ts
    expect(releaseBuild.PROVIDERS.map((p) => p.id)).toEqual(['kizunaai_soniox', 'localInference', 'gemini', 'volcengine_ast2', 'soniox']);
```

  `providerPaths.test.ts`, "lists the registered own-key providers in registry order, in the old enum's spelling":

```ts
    expect(ownKeyOptions('understand-others').map((o) => o.id)).toEqual(['gemini', 'volcengine_ast2', 'soniox', 'fake']);
```

  `gemini/provider.test.ts`, the Gemini plan's "sits between LocalInference and Soniox (ruling 6)" — Doubao now sits between Gemini and Soniox, so the case pins what is still Gemini's:

```ts
      it('sits after LocalInference (ruling 6)', () => {
        expect(PROVIDERS.slice(0, 3).map((p) => p.id)).toEqual(['kizunaai_soniox', 'localInference', 'gemini']);
      });
```

- [ ] **Step 2: Run** `npx vitest run src/providers/volcengine_ast2/provider.test.ts src/providers/registry.test.ts src/components/SetupWizard/providerPaths.test.ts src/providers/gemini/provider.test.ts` — FAIL: no `./provider`; the registry lists four released providers.
- [ ] **Step 3: Implement.** `provider.ts`, in full:

```ts
import { VolcengineIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { createAst2Adapter } from './adapter';
import { Ast2SettingsView } from './Ast2Settings';
import { checkAst2 } from './check';
import { buildAst2, describeAst2, type Ast2Config } from './config';
import { AST2_DEFAULTS, ast2Credentials, ast2Languages, migrateAst2Settings, type Ast2Credentials, type Ast2Settings } from './settings';

const adapter = createAst2Adapter();

/**
 * Doubao AST 2.0 with the user's own credentials (Stage 2 Volcengine AST2):
 * Volcengine's simultaneous interpretation, one protobuf socket per leg,
 * speech to speech in the speaker's cloned voice or speech to text. The old
 * enum's id and slice (controller ruling 2 of the foundation), so a stored
 * selection, the credentials and the libraries carry over. Its credentials
 * ride in the socket's query (ruling 2), so it runs on the web too, and the
 * extension's manifest already lists its host and CSP origin: no manifest
 * or background change. Released between Gemini and Soniox, unflagged
 * (ruling 5); the old `VITE_ENABLE_VOLCENGINE_AST2` is dead and not read.
 */
export const volcengineAst2Provider: Provider<Ast2Settings, Ast2Credentials, Ast2Config> & { id: 'volcengine_ast2' } = {
  id: 'volcengine_ast2',
  kind: 'own-key',
  platforms: ['electron', 'extension', 'web'],
  icon: VolcengineIcon,
  // Today's TUTORIAL_URLS value, as a literal (no import from src/services).
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/volcengine-ast2-setup',

  settings: { key: 'volcengineAST2', defaults: AST2_DEFAULTS, migrate: migrateAst2Settings },
  Settings: Ast2SettingsView,

  // Two credential modes (ruling 1): the choice sits above the fields, in both layouts.
  credentials: ast2Credentials,
  check: (k, s, ctx) => checkAst2(k, s, ctx),

  // The offer follows whether the run speaks (ruling 3; choice 1).
  languages: ast2Languages,

  speech: 'optional',
  // Doubao's session takes audio only.
  textInput: false,
  // The server's End phase ends a segment (the old offer: pause off, auto and sizes on).
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: buildAst2,
  describe: describeAst2,
  start: adapter.start,
};
```

  `registry.ts`: `import { volcengineAst2Provider } from './volcengine_ast2/provider';` after `import { sonioxProvider } from './soniox/provider';`, and the `RELEASED` line and its comment become

```ts
/** Shipped providers, in UI order (Stage 2 Kizuna Soniox, ruling 6; Stage 2 Gemini, ruling 6; Stage 2 Volcengine AST2, ruling 5): the managed Kizuna Soniox, the free LocalInference, then Gemini, Doubao AST 2.0 and Soniox with your own key. */
const RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, sonioxProvider] as const;
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then the full suite and the gate. What registration reaches, and why each stays green:
  - the registry invariants (`registry.test.ts`): `volcengine_ast2` is the old enum's spelling and slice key; `providers.volcengine_ast2.name` / `.description` and every field's label and placeholder exist in `en`; empty credentials read missing in both modes; `migrate(defaults, …)` gives the defaults; every source has targets, none is `auto`; the initial pair is offered; the credential choice's default (`app`) is an option, each option labelled, each showing fields among `keys` (Task 10's invariant); each context's offer lies within the widest (Task 3's);
  - `localInference/provider.test.ts`' "follows Kizuna Soniox" reads the first two ids, unchanged; `useSignInProviderSwitch.test.tsx` names the first managed provider — still Kizuna Soniox;
  - the wizard's own-key list (`providerPaths.test.ts`) and the picker list Doubao between Gemini and Soniox; `providerPaths.managedFit.test.ts` reads managed providers only;
  - the session-side guard walks Doubao's folder (Task 15's case) with `provider.ts` outside it.
- [ ] **Step 5: Commit.**

```bash
git add src/providers/volcengine_ast2/provider.ts src/providers/volcengine_ast2/provider.test.ts src/providers/registry.ts src/providers/registry.test.ts src/components/SetupWizard/providerPaths.test.ts src/providers/gemini/provider.test.ts
```

```bash
git commit -q -F - -- src/providers/volcengine_ast2/provider.ts src/providers/volcengine_ast2/provider.test.ts src/providers/registry.ts src/providers/registry.test.ts src/components/SetupWizard/providerPaths.test.ts src/providers/gemini/provider.test.ts <<'EOF'
feat(providers): Doubao AST 2.0 with your own credentials, after Gemini

volcengine_ast2 on the new contract, unflagged, on the web as well as
Electron and the extension: two credential modes, languages per mode,
the participant speaking when its switch is on. The old enum's id and
slice keep a stored selection, credentials and libraries.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

## Wave 6

### Task 17: The wizard's credential step offers the credential choice (ruling 1; choice 2)

**Files:**
- Modify: `src/components/SetupWizard/setupDraft.ts`, `src/components/SetupWizard/applySetup.ts`, `src/components/SetupWizard/useApplySetup.ts`, `src/components/SetupWizard/steps/StepCredentials.tsx`
- Test: `src/components/SetupWizard/setupDraft.test.ts`, `src/components/SetupWizard/applySetup.test.ts`, `src/components/SetupWizard/useApplySetup.test.ts`, `src/components/SetupWizard/steps/StepCredentials.test.tsx`

**Interfaces:**
- Consumes: Task 10's `CredentialChoiceControl`; Task 3's `Provider.credentials.choice`; Task 16's registration (`wizardProvider(Provider.VOLCENGINE_AST2)` and `presentProviders()` find Doubao); Task 6's `AST2_DEFAULTS` and `Ast2AuthMode` (the tests); the store's `updateSettings`; `readCredentials`.
- Produces:
  - `SetupDraft.credentialChoice: { setting: string; value: string } | null` — null in `initialDraft()`, cleared with the credentials by `setPath`, `setProvider` and a `setScenario` that drops the provider;
  - the action `{ type: 'setCredentialChoice'; setting: string; value: string }` — keeps what was typed (both modes' values stay, as in Settings), clears `credentialsValidated` and `credentialsPending`;
  - `ApplySetupDeps.applyProvider(provider, pair, credentials, settings: Record<string, string>)` — `settings` is `{ [setting]: value }` on the own-key path once a choice was picked, skipped key or not, else `{}`;
  - `useApplySetup`'s binding writes that setting through `updateSettings` before the credentials, and only the provider's own `credentials.choice.setting`.
- Consumed by: group check B; live-test item 16.

The spec has one credential form serve the setup wizard and the settings panel (spec:1167-1169), and ruling 1 puts the mode selector in the credential form: a new user whose console gives only an API key must be able to set Doubao up on first run (the controller's ruling on review I2). The wizard's step draws its own fields (`StepCredentials.tsx:98`), so it draws the shared control above them, in a `.credential-choice-group` — `Settings.scss` is in the app's bundle wherever the wizard shows (`MainLayout` imports `Settings`, whose module imports the stylesheet). The step shows and checks the chosen mode's fields: `fields`, `readCredentials` and `check` all read the saved settings with the pick laid over them, and nothing is written before Finish (`applySetup.ts:1-7`). A pick aborts a check in flight and clears its message. Finish writes the pick even when the key was skipped, so Settings shows the fields the user chose. The task waits for Wave 6: its tests reach Doubao through the registry.

- [ ] **Step 1: Write the failing tests.** `setupDraft.test.ts`, before "editing a credential invalidates a previous validation and un-skips":

```diff
--- a/src/components/SetupWizard/setupDraft.test.ts
+++ b/src/components/SetupWizard/setupDraft.test.ts
@@ -90,8 +90,18 @@
     const dropped = run(validated, { type: 'skipCredentials', keepExisting: false });
     expect(dropped).toMatchObject({ credentialsValidated: false, credentialsPending: true, credentials: {} });
   });
 
+  it('picking a credential choice keeps it, keeps what was typed, and invalidates a validation (Stage 2 Volcengine AST2, I2)', () => {
+    const validated = run(base, { type: 'credentialsValidated' }, { type: 'setCredential', key: 'appId', value: 'a1' });
+    const picked = run(validated, { type: 'setCredentialChoice', setting: 'authMode', value: 'apiKey' });
+    expect(picked).toMatchObject({ credentialChoice: { setting: 'authMode', value: 'apiKey' }, credentials: { appId: 'a1' }, credentialsValidated: false, credentialsPending: false });
+    // Another path or provider forgets it with the credentials.
+    expect(run(picked, { type: 'setProvider', provider: Provider.GEMINI }).credentialChoice).toBeNull();
+    expect(run(picked, { type: 'setPath', path: 'offline', provider: Provider.LOCAL_INFERENCE }).credentialChoice).toBeNull();
+    expect(initialDraft().credentialChoice).toBeNull();
+  });
+
   it('editing a credential invalidates a previous validation and un-skips', () => {
     const skipped = run(base, { type: 'skipCredentials' });
     expect(skipped).toMatchObject({ credentialsPending: true, credentials: {} });
     const edited = run(base, { type: 'setCredential', key: 'apiKey', value: 'sk-2' });
```

  `applySetup.test.ts` — the three existing expectations gain the fourth argument, and one case:

```diff
--- a/src/components/SetupWizard/applySetup.test.ts
+++ b/src/components/SetupWizard/applySetup.test.ts
@@ -33,9 +33,9 @@
     expect(d.setMode).toHaveBeenCalledWith('speaker');
     expect(d.setTextOnly).toHaveBeenCalledWith(false);
     expect(d.setSpeakerDisplayMode).toHaveBeenCalledWith('both');
     expect(d.setParticipantDisplayMode).not.toHaveBeenCalled();
-    expect(d.applyProvider).toHaveBeenCalledWith(Provider.SONIOX, { source: 'en', target: 'ja' }, { apiKey: 'sk-1' });
+    expect(d.applyProvider).toHaveBeenCalledWith(Provider.SONIOX, { source: 'en', target: 'ja' }, { apiKey: 'sk-1' }, {});
     expect(d.completeSetup).toHaveBeenCalledWith({ scenario: 'be-heard', providerPath: 'own-key', provider: Provider.SONIOX });
 
     const seq = order([d.setMode, d.setTextOnly, d.setSpeakerDisplayMode, d.applyProvider, d.completeSetup] as any);
     expect([...seq].sort((a, b) => a - b)).toEqual(seq);   // strictly increasing
@@ -44,17 +44,32 @@
 
   it('omits credentials when they were skipped, and on the managed and offline paths', async () => {
     const skipped = deps();
     await applySetupDraft(draft({ credentials: {}, credentialsValidated: false, credentialsPending: true }), skipped);
-    expect(skipped.applyProvider).toHaveBeenCalledWith(Provider.SONIOX, { source: 'en', target: 'ja' }, {});
+    expect(skipped.applyProvider).toHaveBeenCalledWith(Provider.SONIOX, { source: 'en', target: 'ja' }, {}, {});
 
     const managed = deps();
     await applySetupDraft(draft({ providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, credentials: {} }), managed);
-    expect(managed.applyProvider).toHaveBeenCalledWith(Provider.KIZUNA_AI_SONIOX, { source: 'en', target: 'ja' }, {});
+    expect(managed.applyProvider).toHaveBeenCalledWith(Provider.KIZUNA_AI_SONIOX, { source: 'en', target: 'ja' }, {}, {});
 
     const offline = deps();
     await applySetupDraft(draft({ providerPath: 'offline', provider: Provider.LOCAL_INFERENCE, credentials: { apiKey: 'sk-1' } }), offline);
-    expect(offline.applyProvider).toHaveBeenCalledWith(Provider.LOCAL_INFERENCE, { source: 'en', target: 'ja' }, {});
+    expect(offline.applyProvider).toHaveBeenCalledWith(Provider.LOCAL_INFERENCE, { source: 'en', target: 'ja' }, {}, {});
+  });
+
+  it('writes the credential choice the step showed, on the own-key path only, skipped key or not (Stage 2 Volcengine AST2, I2)', async () => {
+    const credentialChoice = { setting: 'authMode', value: 'apiKey' };
+    const chosen = deps();
+    await applySetupDraft(draft({ provider: Provider.VOLCENGINE_AST2, credentials: { apiKey: 'key-1' }, credentialChoice }), chosen);
+    expect(chosen.applyProvider).toHaveBeenCalledWith(Provider.VOLCENGINE_AST2, { source: 'en', target: 'ja' }, { apiKey: 'key-1' }, { authMode: 'apiKey' });
+
+    const skipped = deps();
+    await applySetupDraft(draft({ provider: Provider.VOLCENGINE_AST2, credentials: {}, credentialsValidated: false, credentialsPending: true, credentialChoice }), skipped);
+    expect(skipped.applyProvider).toHaveBeenCalledWith(Provider.VOLCENGINE_AST2, { source: 'en', target: 'ja' }, {}, { authMode: 'apiKey' });
+
+    const offline = deps();
+    await applySetupDraft(draft({ providerPath: 'offline', provider: Provider.LOCAL_INFERENCE, credentials: {}, credentialChoice }), offline);
+    expect(offline.applyProvider).toHaveBeenCalledWith(Provider.LOCAL_INFERENCE, { source: 'en', target: 'ja' }, {}, {});
   });
 
   it('sets participant display for the listening scenario and leaves the speaker one alone', async () => {
     const d = deps();
```

  `useApplySetup.test.ts`:

```diff
--- a/src/components/SetupWizard/useApplySetup.test.ts
+++ b/src/components/SetupWizard/useApplySetup.test.ts
@@ -24,8 +24,10 @@
   ServiceFactory: { getSettingsService: () => ({ getSetting, setSetting }) },
 }));
 
 import { Provider } from '../../types/Provider';
+import { readCredentials } from '../../lib/provider/credentials';
+import { volcengineAst2Provider } from '../../providers/volcengine_ast2/provider';
 import { useProviderStore } from '../../stores/providerStore';
 import { useApplySetup } from './useApplySetup';
 import { initialDraft } from './setupDraft';
 import type { SetupDraft } from './setupDraft';
@@ -67,8 +69,32 @@
     expect(useProviderStore.getState().entries.localInference?.credentials).toEqual({});
     expect(setSetting).not.toHaveBeenCalledWith('settings.localInference.apiKey', expect.anything());
   });
 
+  it('Finish on Doubao AST 2.0 with only an API key writes the chosen mode, so the key is the credential read (Stage 2 Volcengine AST2, I2)', async () => {
+    const { result } = renderHook(() => useApplySetup());
+
+    await result.current(draft({
+      providerPath: 'own-key', provider: Provider.VOLCENGINE_AST2,
+      credentials: { apiKey: 'key-1' }, credentialChoice: { setting: 'authMode', value: 'apiKey' },
+    }));
+
+    const entry = useProviderStore.getState().entries.volcengine_ast2!;
+    expect((entry.settings as { authMode: string }).authMode).toBe('apiKey');
+    expect(readCredentials(volcengineAst2Provider, entry.settings, entry.credentials, { signedIn: false, getToken: async () => null }))
+      .toEqual({ kind: 'apiKey', apiKey: 'key-1' });
+    expect(setSetting).toHaveBeenCalledWith('settings.volcengineAST2.authMode', 'apiKey');
+    expect(setSetting).toHaveBeenCalledWith('settings.volcengineAST2.apiKey', 'key-1');
+  });
+
+  it('writes no setting a provider has no credential choice over', async () => {
+    const { result } = renderHook(() => useApplySetup());
+
+    await result.current(draft({ providerPath: 'own-key', credentialChoice: { setting: 'authMode', value: 'apiKey' } }));
+
+    expect(setSetting).not.toHaveBeenCalledWith('settings.localInference.authMode', expect.anything());
+  });
+
   it('throws before any write when the draft names a provider this build does not offer', async () => {
     const { result } = renderHook(() => useApplySetup());
 
     await expect(result.current(draft({ provider: Provider.OPENAI }))).rejects.toThrow(/This build does not offer/);
```

  `StepCredentials.test.tsx` — two imports, and a `describe` before `describe('StepCredentials (managed)'` (`ownKeyDraft` is the file's own):

```diff
--- a/src/components/SetupWizard/steps/StepCredentials.test.tsx
+++ b/src/components/SetupWizard/steps/StepCredentials.test.tsx
@@ -31,8 +31,10 @@
 import { Provider } from '../../../types/Provider';
 import { useProviderStore } from '../../../stores/providerStore';
 import { sonioxProvider } from '../../../providers/soniox/provider';
 import { SONIOX_DEFAULTS } from '../../../providers/soniox/settings';
+import { volcengineAst2Provider } from '../../../providers/volcengine_ast2/provider';
+import { AST2_DEFAULTS, type Ast2AuthMode } from '../../../providers/volcengine_ast2/settings';
 
 const ownKeyDraft = (patch: Partial<SetupDraft> = {}): SetupDraft => ({
   ...initialDraft(), step: 3, providerPath: 'own-key', provider: Provider.SONIOX, scenario: 'be-heard', ...patch,
 });
@@ -232,8 +234,62 @@
     expect(useProviderStore.getState().readiness.soniox).toBeUndefined();
   });
 });
 
+describe('StepCredentials — a credential choice (Stage 2 Volcengine AST2, I2)', () => {
+  const ast2Draft = (patch: Partial<SetupDraft> = {}) => ownKeyDraft({ provider: Provider.VOLCENGINE_AST2, ...patch });
+  const seedAst2 = (authMode: Ast2AuthMode) => useProviderStore.setState({
+    entries: { volcengine_ast2: { settings: { ...AST2_DEFAULTS, authMode }, credentials: { appId: '', accessToken: '', apiKey: '' }, pair: { source: 'zh', target: 'en' } } },
+    readiness: {},
+  });
+
+  it("draws the choice above the saved mode's fields, that mode pressed", () => {
+    seedAst2('app');
+    const { container } = render(<StepCredentials draft={ast2Draft()} dispatch={vi.fn()} />);
+
+    const buttons = [...container.querySelectorAll('.credential-choice-group .segmented-control .segmented-option')];
+    expect(buttons.map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
+      ['providers.volcengine_ast2.authModeApp', 'true'],
+      ['setup.credentials.apiKey', 'false'],
+    ]);
+    expect(screen.getByLabelText('setup.credentials.appId')).toBeInTheDocument();
+    expect(screen.getByLabelText('setup.credentials.accessToken')).toBeInTheDocument();
+    expect(screen.queryByLabelText('setup.credentials.apiKey')).toBeNull();
+  });
+
+  it("switches modes in the draft, and the draft's mode shows its own fields", () => {
+    seedAst2('app');
+    const dispatch = vi.fn();
+    render(<StepCredentials draft={ast2Draft()} dispatch={dispatch} />);
+
+    fireEvent.click(screen.getByRole('button', { name: 'setup.credentials.apiKey' }));
+
+    expect(dispatch).toHaveBeenCalledWith({ type: 'setCredentialChoice', setting: 'authMode', value: 'apiKey' });
+    cleanup();
+    render(<StepCredentials draft={ast2Draft({ credentialChoice: { setting: 'authMode', value: 'apiKey' } })} dispatch={vi.fn()} />);
+    expect(screen.getByRole('button', { name: 'setup.credentials.apiKey' }).getAttribute('aria-pressed')).toBe('true');
+    expect(screen.getByLabelText('setup.credentials.apiKey')).toBeInTheDocument();
+    expect(screen.queryByLabelText('setup.credentials.appId')).toBeNull();
+  });
+
+  it('sets up with an API key only: Validate checks it in the chosen mode, and writes nothing before Finish', async () => {
+    seedAst2('app');
+    const checkSpy = vi.spyOn(volcengineAst2Provider, 'check').mockResolvedValue({ ok: true });
+    const dispatch = vi.fn();
+    render(<StepCredentials draft={ast2Draft({ credentialChoice: { setting: 'authMode', value: 'apiKey' }, credentials: { apiKey: 'key-1' } })} dispatch={dispatch} />);
+
+    fireEvent.click(screen.getByRole('button', { name: 'setup.credentials.validate' }));
+
+    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'credentialsValidated' }));
+    expect(checkSpy).toHaveBeenCalledWith(
+      { kind: 'apiKey', apiKey: 'key-1' },
+      expect.objectContaining({ authMode: 'apiKey' }),
+      expect.objectContaining({ pair: { source: 'zh', target: 'en' }, legs: ['speaker'] }),
+    );
+    expect((useProviderStore.getState().entries.volcengine_ast2.settings as { authMode: string }).authMode).toBe('app');
+  });
+});
+
 describe('StepCredentials (managed)', () => {
   it('tells a signed-in user with an unverified address to finish verification', () => {
     authState = { isSignedIn: true, emailVerified: false };
     render(<StepCredentials draft={managedDraft()} dispatch={vi.fn()} />);
```

- [ ] **Step 2: Run** `npx vitest run src/components/SetupWizard/setupDraft.test.ts src/components/SetupWizard/applySetup.test.ts src/components/SetupWizard/useApplySetup.test.ts src/components/SetupWizard/steps/StepCredentials.test.tsx` — FAIL: the draft has no `credentialChoice` and no `setCredentialChoice`; `applyProvider` is called with three arguments; Finish writes no `authMode`; the step draws no choice.
- [ ] **Step 3: Implement.** `setupDraft.ts`:

```diff
--- a/src/components/SetupWizard/setupDraft.ts
+++ b/src/components/SetupWizard/setupDraft.ts
@@ -17,8 +17,15 @@
   /** Resolved from the path (managed/offline) or picked by the user (own-key). */
   provider: ProviderType | null;
   /** own-key only: slice key → value, cleared when path or provider changes. */
   credentials: Record<string, string>;
+  /**
+   * own-key only: the credential choice the step shows (F4; Stage 2
+   * Volcengine AST2, I2) — the provider's `credentials.choice.setting` and
+   * the option picked. Null until one is picked: the saved setting stands.
+   * Written at Finish, and cleared when path or provider changes.
+   */
+  credentialChoice: { setting: string; value: string } | null;
   credentialsValidated: boolean;
   /** "Skip for now" was taken on step 3 (spec §1.4). */
   credentialsPending: boolean;
   sourceLanguage: string | null;
@@ -29,8 +36,9 @@
   | { type: 'setScenario'; scenario: ScenarioId; keepProvider: boolean }
   | { type: 'setPath'; path: ProviderPath; provider: ProviderType | null }
   | { type: 'setProvider'; provider: ProviderType }
   | { type: 'setCredential'; key: string; value: string }
+  | { type: 'setCredentialChoice'; setting: string; value: string }
   | { type: 'prefillCredentials'; credentials: Record<string, string> }
   | { type: 'credentialsValidated' }
   | { type: 'skipCredentials'; keepExisting?: boolean }
   | { type: 'setLanguages'; source: string; target: string }
@@ -47,8 +55,9 @@
     scenario: null,
     providerPath: null,
     provider: null,
     credentials: {},
+    credentialChoice: null,
     credentialsValidated: false,
     credentialsPending: false,
     sourceLanguage: null,
     targetLanguage: null,
@@ -72,8 +81,9 @@
 }
 
 const cleared = {
   credentials: {} as Record<string, string>,
+  credentialChoice: null,
   credentialsValidated: false,
   credentialsPending: false,
   sourceLanguage: null,
   targetLanguage: null,
@@ -109,8 +119,17 @@
         credentials: { ...d.credentials, [a.key]: a.value },
         credentialsValidated: false,
         credentialsPending: false,
       };
+    // Another set of fields: what was validated was the other set. Typed
+    // values of either set stay, as the settings panel keeps both.
+    case 'setCredentialChoice':
+      return {
+        ...d,
+        credentialChoice: { setting: a.setting, value: a.value },
+        credentialsValidated: false,
+        credentialsPending: false,
+      };
     // The key already in settings, mirrored into the draft so a re-run shows
     // what is saved instead of an empty box. Unlike a keystroke it says nothing
     // new about the key, so it must not disturb the validated/pending flags the
     // record seeded (spec §1.6).
```

  `applySetup.ts`:

```diff
--- a/src/components/SetupWizard/applySetup.ts
+++ b/src/components/SetupWizard/applySetup.ts
@@ -14,12 +14,18 @@
   setMode: (m: 'speaker' | 'participant' | 'both') => void;
   setTextOnly: (v: boolean) => void;
   setSpeakerDisplayMode: (m: 'source' | 'translation' | 'both') => Promise<void> | void;
   setParticipantDisplayMode: (m: 'source' | 'translation' | 'both') => Promise<void> | void;
-  /** The provider, its pair and — on the own-key path — its credentials,
-   *  written where the session reads them; the one write the wizard makes
-   *  besides the presets and the record. */
-  applyProvider: (provider: ProviderType, pair: { source: string; target: string }, credentials: Record<string, string>) => Promise<void>;
+  /** The provider, its pair and — on the own-key path — its credentials and
+   *  the credential choice its step showed (a settings patch; F4), written
+   *  where the session reads them; the one write the wizard makes besides
+   *  the presets and the record. */
+  applyProvider: (
+    provider: ProviderType,
+    pair: { source: string; target: string },
+    credentials: Record<string, string>,
+    settings: Record<string, string>,
+  ) => Promise<void>;
   completeSetup: (r: { scenario: ScenarioId; providerPath: ProviderPath; provider: string }) => Promise<void>;
 }
 
 export async function applySetupDraft(draft: SetupDraft, deps: ApplySetupDeps): Promise<void> {
@@ -34,9 +40,14 @@
   if (preset.speakerDisplayMode) await deps.setSpeakerDisplayMode(preset.speakerDisplayMode);
   if (preset.participantDisplayMode) await deps.setParticipantDisplayMode(preset.participantDisplayMode);
 
   const credentials = providerPath === 'own-key' && !draft.credentialsPending ? draft.credentials : {};
+  // The credential choice the step showed is written even when the key was
+  // skipped: Settings then shows the fields the user chose (Stage 2
+  // Volcengine AST2, I2).
+  const choice = providerPath === 'own-key' ? draft.credentialChoice : null;
+  const settings = choice ? { [choice.setting]: choice.value } : {};
   // Awaited: a rejected write has to reach Finish's error path rather than
   // becoming an unhandled rejection behind a "done" wizard.
-  await deps.applyProvider(provider, { source: sourceLanguage, target: targetLanguage }, credentials);
+  await deps.applyProvider(provider, { source: sourceLanguage, target: targetLanguage }, credentials, settings);
   await deps.completeSetup({ scenario, providerPath, provider });
 }
```

  `useApplySetup.ts`:

```diff
--- a/src/components/SetupWizard/useApplySetup.ts
+++ b/src/components/SetupWizard/useApplySetup.ts
@@ -21,14 +21,19 @@
       setMode: useAudioStore.getState().setMode,
       setTextOnly: s.setTextOnly,
       setSpeakerDisplayMode: s.setSpeakerDisplayMode,
       setParticipantDisplayMode: s.setParticipantDisplayMode,
-      applyProvider: async (provider, pair, credentials) => {
+      applyProvider: async (provider, pair, credentials, settings) => {
         const id = providerIdFromStored(provider);
         const p = presentProviders().find((candidate) => candidate.id === id);
         if (!p) throw new Error(`This build does not offer "${provider}".`);
         const store = useProviderStore.getState();
         await store.load(p);
+        // The credential choice first (F4): the credentials below are the
+        // fields it shows. Only the provider's own choice is a setting the
+        // wizard writes (Stage 2 Volcengine AST2, I2).
+        const choice = p.credentials.choice?.setting;
+        if (choice !== undefined && settings[choice] !== undefined) store.updateSettings(p, { [choice]: settings[choice] });
         for (const [key, value] of Object.entries(credentials)) {
           if (p.credentials.keys.includes(key)) store.setCredential(p, key, value);
         }
         store.setPair(p, pair);
```

  `StepCredentials.tsx`:

```diff
--- a/src/components/SetupWizard/steps/StepCredentials.tsx
+++ b/src/components/SetupWizard/steps/StepCredentials.tsx
@@ -11,8 +11,9 @@
 import { describeCause } from '../../../lib/diagnostics/describeCause';
 import { legsFor } from '../../../lib/session/appShape';
 import { getScenario } from '../../../lib/setup/scenarios';
 import { wizardProvider } from '../providerPaths';
+import { CredentialChoiceControl } from '../../providers/CredentialChoiceControl';
 import Button from '../../Settings/shared/Button';
 import FormInput from '../../Settings/shared/FormInput';
 import StatusMessage from '../../Settings/shared/StatusMessage';
 import type { SetupAction, SetupDraft } from '../setupDraft';
@@ -94,9 +95,17 @@
   useEffect(() => () => inFlight.current?.abort(), []);
   if (!p || !entry) return <section className="setup-step"><h2>{t('setup.steps.credentials.ownKeyTitle', 'Your API key')}</h2></section>;
 
   const saved = entry.credentials;
-  const fields = p.credentials.fields(entry.settings);
+  // The credential choice (F4): the one the user picked here, else the saved
+  // one. Its fields show, and the check reads them, as Settings' form does;
+  // nothing is written before Finish (Stage 2 Volcengine AST2, I2).
+  const choice = p.credentials.choice;
+  const chosen = choice
+    ? (draft.credentialChoice?.setting === choice.setting ? draft.credentialChoice.value : String((entry.settings as Record<string, unknown>)[choice.setting] ?? ''))
+    : undefined;
+  const settings = choice ? { ...(entry.settings as Record<string, unknown>), [choice.setting]: chosen } : entry.settings;
+  const fields = p.credentials.fields(settings);
   // As before, over the saved values instead of the old slice (the re-run's rules, feedback 2026-08-25).
   const keyOnFile = draft.credentialsValidated && fields.some((f) => !draft.credentials[f.key] && !saved[f.key]);
   const keptOnSkip = draft.credentialsValidated && fields.length > 0 && fields.every((f) => !!saved[f.key]);
 
@@ -105,17 +114,17 @@
     const mine = new AbortController();
     inFlight.current = mine;
     setMessage(null);
     // The draft overlays what is saved; nothing is written.
-    const credentials = readCredentials(p, entry.settings, { ...saved, ...draft.credentials }, auth);
+    const credentials = readCredentials(p, settings, { ...saved, ...draft.credentials }, auth);
     if (isMissing(credentials)) {
       setMessage({ ok: false, text: noticeText(t, { code: credentials.code ?? 'credentials_missing', params: credentials.params, message: credentials.missing }) });
       return;
     }
     setValidating(true);
     try {
       const legs = legsFor(getScenario(draft.scenario!).mode);
-      const result = await p.check(credentials, entry.settings, { pair: entry.pair, legs, signal: mine.signal });
+      const result = await p.check(credentials, settings, { pair: entry.pair, legs, signal: mine.signal });
       if (mine.signal.aborted) return;
       if (result.ok) {
         dispatch({ type: 'credentialsValidated' });
         setMessage({ ok: true, text: t('setup.credentials.valid', 'Key accepted.') });
@@ -136,8 +145,23 @@
     <section className="setup-step">
       <h2>{t('setup.steps.credentials.ownKeyTitle', 'Your API key')}</h2>
       <p>{t('setup.credentials.ownKeyDesc', 'This key is stored on this device only, and the app calls the provider straight from here — it never reaches Kizuna AI. You pay the provider for what you use.')}</p>
       <CredentialPrefill draft={draft} dispatch={dispatch} slice={saved} fieldKeys={fields.map((f) => f.key)} />
+      {choice && chosen !== undefined && (
+        <div className="credential-choice-group">
+          <CredentialChoiceControl
+            options={choice.options}
+            value={chosen}
+            onChange={(value) => {
+              // A check in flight was about the other fields.
+              inFlight.current?.abort();
+              setMessage(null);
+              dispatch({ type: 'setCredentialChoice', setting: choice.setting, value });
+            }}
+            disabled={validating}
+          />
+        </div>
+      )}
       {fields.map((f) => (
         <label key={f.key} className="setup-field">
           <span>{t(f.labelKey, f.key)}</span>
           <FormInput
```

- [ ] **Step 4: Run** the Step 2 command — PASS; then `npx vitest run src/components/SetupWizard src/components/providers`, the full suite and the gate. What the change reaches, and why each stays green: every other provider has no credential choice, so the step renders as before for Soniox, Gemini and the fake (the existing `StepCredentials` cases pass unchanged); `SetupWizard.test.tsx` mocks `useApplySetup`; `applySetup.test.ts`' existing cases differ only by the `{}` their expectations now name; the gate's widened `SetupWizard/(setupDraft|applySetup|useApplySetup)(\.test)?\.ts` covers the draft's new member at every literal that builds a `SetupDraft` (`initialDraft()` is the only one outside the tests).
- [ ] **Step 5: Commit.**

```bash
git add src/components/SetupWizard/setupDraft.ts src/components/SetupWizard/setupDraft.test.ts src/components/SetupWizard/applySetup.ts src/components/SetupWizard/applySetup.test.ts src/components/SetupWizard/useApplySetup.ts src/components/SetupWizard/useApplySetup.test.ts src/components/SetupWizard/steps/StepCredentials.tsx src/components/SetupWizard/steps/StepCredentials.test.tsx
```

```bash
git commit -q -F - -- src/components/SetupWizard/setupDraft.ts src/components/SetupWizard/setupDraft.test.ts src/components/SetupWizard/applySetup.ts src/components/SetupWizard/applySetup.test.ts src/components/SetupWizard/useApplySetup.ts src/components/SetupWizard/useApplySetup.test.ts src/components/SetupWizard/steps/StepCredentials.tsx src/components/SetupWizard/steps/StepCredentials.test.tsx <<'EOF'
feat(setup): the wizard's credential step offers the credential choice

A provider with more than one credential shape shows the same choice in
the setup wizard as in Settings, so Doubao AST 2.0 can be set up on
first run with only an API key: the draft holds the pick, the step
checks that mode's fields, and Finish writes it before the key.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Group check B (controller)

After Wave 6 (Tasks 16 and 17). No step types a credential into Doubao's fields or presses Start with Doubao selected (ruling 13): its readiness check would open a real session 800 ms after a credential appeared. Every page below starts on a fresh profile, so both credential modes are empty.

1. The full gates; both release builds; `npx vitest run extension`; the three D24 greps print nothing; `command grep -rlF 'audio.idle' build extension/dist` names at least one file under `build/` and one under `extension/dist/` — the new adapter shipped in both.
2. The full tree's typecheck is at most the starting count (`/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/ast2-groupB-tsc.txt`).
3. Every probe green on a fresh vite: the spine probes (subtitle, surface, export, audio, gate, local), `app-panel-probe` (preview; `--settings`; `--app`, plain and `--settings`), `extension-overlay-probe` (plain and `--ptt`) on fresh builds. The preview still opens on the fake (a fresh store).
4. **Doubao's Provider tab in both credential modes, rendered**, through `scripts/dev/headless.mjs`, screenshots under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, the page's network log (the DevTools `Network` domain) recorded for each:
   - `/?preview=spine&settings=advanced&provider=volcengine_ast2`: the picker shows "Doubao AST 2.0" with its icon and the guide link; above the fields, the segmented control "App ID + Access Token" | "API key", the first pressed; the App ID and Access Token rows with their placeholders; Start off. Click "API key": one row, "API key", with its placeholder; the App ID row gone. Click back: the App ID row returns (empty — nothing typed). The Custom Vocabulary section's three rows, each with its "Manage …" link, the footer, the info block. **No request to `openspeech.bytedance.com`**, in either mode.
   - `&settings=simple&provider=volcengine_ast2`: the same control and rows in the Simple layout.
   - Compare the control with the old Palabra group (`ProviderSection.tsx:761-779`) and the rows with the old AST2 section (`ProviderSpecificSettings.tsx:1603-1716`) — the memory rule: match sibling markup.
5. **The languages per mode**, on the same page's language section: with Text only off, the source list holds exactly the eight spoken languages and `中英双语 (zh↔en)`; turning Text only on (Speech section) lists the twenty, the two dialects and `中英双语 (zh↔en)`. Pick 한국어 → 中文 with Text only on, then turn it off: the pair shows 中文 → English; turn it back on: 한국어 → 中文 again. A dialect source lists English and 中文 as targets, and no dialect is ever a target; `中英双语 (zh↔en)` targets only itself. Screenshots of each.
6. **The gate:** `/?preview=spine&panel=1&provider=volcengine_ast2` — Start off; the idle line reads "Enter your API key in Settings before starting." (`notices.credentials_missing`, in either mode — an open question).
7. **The wizard** on a fresh profile at `/` (first run): the own-key path lists Gemini, Doubao AST 2.0, then Soniox; with Doubao, the credential step shows the choice above the App ID and Access Token fields, "App ID + Access Token" pressed; clicking "API key" shows the API key field alone, and clicking back the two — never filled, never validated; the language step lists the eight spoken languages and `中英双语 (zh↔en)` for the `be-heard` scenario, and the full list for `subtitle-myself`.
8. **The Logs' rows**: `logStore.test.ts`'s grouping case (Task 2) is the evidence for the new names; no live frame exists before the owner's test.

---

### Task 18 (controller): the spec's amendments and the roadmap's record (ruling 14)

**Files:** Modify `docs/superpowers/specs/2026-09-22-client-contract-design.md` and `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`.

Each amendment anchors on its section and sentence as the Gemini plan's Task 14 left them; line numbers here are `3665711d`'s.

- [ ] **Step 1: The spec.**
  1. **"The provider definition"**, the shape (`:1044-1054`): `credentials` gains `choice?: { setting: keyof S; options: { value: string; labelKey: string }[] }   // which fields show (F4)`, and the two language functions become `sources(s: S, context?: LanguageContext)` and `targets(source: string, s: S, context?: LanguageContext)`, with `// context: { speech } — whether the run would speak; absent, the widest offer`. After the shape, beside the earlier plans' notes: "**Amended by the Stage 2 Volcengine AST2 plan:** the language functions take an optional `LanguageContext`; `credentials.choice` names a setting that decides which credential fields show."
  2. **"Credentials are not settings"**, after "…which is how it knows the region's key without reading `S`.": "A provider whose credentials come in more than one shape declares `credentials.choice`: a setting of `S` that both credential forms — the settings panel's and the setup wizard's — draw above the fields as one segmented control (`CredentialChoiceControl`), clearing no credential. The panel writes a pick as any settings edit; the wizard holds it in its draft, shows and checks that shape's fields, and writes it at Finish before the credentials. Doubao AST 2.0's App ID + Access Token or API key (Stage 2 Volcengine AST2, ruling 1) is the first, Palabra's platform or app next."
  3. **"Languages are two functions"**, after "A swap is generic: allowed when the reversed pair is supported.": "The offer may depend on whether the run would speak. Doubao AST 2.0 speaks eight languages and transcribes twenty and two dialects, so its functions take a `LanguageContext` (`{ speech }`), which `languageContext` derives from the legs and the speech inputs by `contextsFor`'s own rule. Without one a provider answers its widest offer. The provider store keeps the pair the user left within the widest offer and derives the pair a run starts for the store's context, writing nothing when the context changes: switching text only off and on loses no pair (Stage 2 Volcengine AST2, choice 1). AST2's second rule, Chinese or English on one side of every pair in both modes, is its `targets`: a source other than Chinese or English targets English and Chinese only, and a dialect is a source only. Picking `zhen` from the target side, which the old sync allowed, has no place in two functions." And in **"The participant rule (D20)"**, "The participant leg opens when the reversed direction is supported" gains "in the participant leg's own language context".
  4. **"Turns"**, the capability table's AST2 row (`:417`): the release column "none on the wire; its keepalive already streams silence and the server closes the segment" becomes "500 ms of silence on release, the old finalization's burst (Stage 2 Volcengine AST2, ruling 6); between turns the keepalive sends silence only after 250 ms with no audio (ruling 7)". The design table's row `| AST2, Palabra | — | — (the server closes on silence) | — |` (`:447`) becomes two: `| AST2 | — | 500 ms of silence | the same tail — the old release sent it for an empty press too |` and `| Palabra | — | — (the server closes on silence) | — |`.
  5. **"Provider capability"**, `VolcengineAST2Client`'s row (`:963`), the pairing column: "inferred (`startTime`/`endTime`, **currently unread**)" becomes "inferred by proximity: neither origin nor timing is emitted; each subtitle frame carries `responseMeta.Sequence` and the times, for the live test to settle whether either states the pair (Stage 2 Volcengine AST2, ruling 11)". After the Gemini plan's sentence below the table ("Gemini, not OpenAI Translate, is the first provider whose origins L2 infers (Live Translate)."): "Doubao AST 2.0 is the second, with no timing at all: proximity alone."
  6. **"The registry is a list (D19)"**, after "…the forwarding consistency test;": "the own-key AST2's `VITE_ENABLE_VOLCENGINE_AST2` is a sixth, dead since `cec1556c` — nothing reads it, though `build.yml` still forwards it — and the new registry ships AST2 unflagged (Stage 2 Volcengine AST2, ruling 5);".
  7. **"Sockets that need upgrade headers"**, after the Gemini plan's closing sentence ("Gemini's key rides in the socket's query: it needs no header."): "Nor does Doubao AST 2.0's. Its endpoint takes the credentials in the query — `api_resource_id` with `api_app_key` and `api_access_key`, or `api_key` — as the owner's probe measured on 2026-09-28; a wrong credential answers HTTP 401 before the upgrade, which a browser cannot read, so the adapter words a socket that never opened as the credentials while online (Stage 2 Volcengine AST2, ruling 2). AST2 is therefore not the seam's first user: OpenAI Live is, and the plain `socket.ts` of Soniox, Gemini and Doubao move to `src/lib/contract/` with it." In the paragraph "**The AST2 rules expose the user's keys.**": "(`background.js`, ids 2000–2009)" becomes "(`background.js`: ids 2000–2003 set, 2000–2009 cleared; dynamic rules outlive a browser restart until cleared, survey §3.6.4)", and the paragraph ends: "The ported provider installs none; the old block goes with the old client (the Stage 2 Volcengine AST2 plan's deletion plan, V2)."
  8. **"What adding a provider then touches"**, item 4, after the Gemini plan's "…or for Gemini, whose origin the manifest's CSP already lists": ", or for Doubao AST 2.0, whose host and CSP origin the manifest already lists (`manifest.json:37, 116`)".
  9. **"What every adapter must honour"**, the `frame` bullet, after the Gemini plan's `logStore` sentence: "Doubao AST 2.0's rows group `subtitle.*`, `tts.*`, `session.usage` and `session.audio_muted` under the old client's keys; a group holds one frame type."
  10. **"Migration"**, Stage 2's fourth item (`:1872-1873`): "**Volcengine AST2** (`volcengine_ast2`) — the socket seam's first user, inferred pairing." becomes "**Volcengine AST2** (`volcengine_ast2`) — the credentials in the socket's query (no seam), two credential modes, a language offer per speech mode, pairing inferred by proximity — ported by the Stage 2 Volcengine AST2 plan. Its relay twin (`kizunaai_volcengine_ast2`) is deleted, not ported."
- [ ] **Step 2: The roadmap.** Append `## Scheduled by the Stage 2 Volcengine AST2 plan`, in the form of the entries before it:
  - **What landed:** the commits and the tasks, and their fix rounds; the rulings as the owner confirmed or overturned them.
  - **What was checked:** group checks A and B — inferred pairing in the preview (the fake's `proximity` script); Doubao's Provider tab in both credential modes and both layouts, with no request to Volcengine; the languages per mode and the pair kept across a text-only switch; the gate's words; the wizard's own-key list, its credential choice and its language step; the adapter in both bundles (`audio.idle`) and neither fake.
  - **Stated departures:** this plan's self-review list.
  - **Before any release from the branch:** the owner's live test below, before V2 deletes the old code and before any release that carries Doubao; the registry order now `['kizunaai_soniox', 'localInference', 'gemini', 'volcengine_ast2', 'soniox']` (ruling 5); the wizard's own-key description (`setup.paths.own-key.desc`) — its "Doubao" is now true, its "OpenAI" still not; the owner's native-speaker spot check of `providers.volcengine_ast2.authModeApp` in 30 catalogs (ja and zh_CN drop their labels' parenthesised English) and of the names `粵語 (cantonese)` (the shared registry's) and `上海话 (Shanghainese)` (Task 6 lists them); **V2's start-up clear of DNR rules 2000–2009 before any release that carries Doubao in the extension** — an extension profile that ran the old client may still hold rules 2000–2003, which set no `initiatorDomains`, outlive a browser restart, and inject its old `X-Api-App-Key` / `X-Api-Access-Key` into every socket to `openspeech.bytedance.com`, the new query-authenticated one included (review M7; live-test item 20); at Stage 2's end, `VITE_ENABLE_VOLCENGINE_AST2` and `VITE_ENABLE_KIZUNA_VOLCENGINE_AST2` join the release-flag cleanup (`build.yml:219,224,273,278,313,318,415,420,517,522`, `extension/vite.config.ts:176-184`).
  - **The owner's live test** (survey §2.13's list, adjusted to the rulings). Each item names what to record in the Logs (diagnostic logs on, Help):
    1. **Both credential modes and the check (rulings 1, 9):** the legacy App ID + Access Token → Validate ✓; a wrong token → "The provider did not accept the credentials: …" with the refusal's words, Start off; the API key → ✓; a wrong key → the same words; empty in either mode → "Enter your API key…". Switching modes keeps the other mode's fields. An old profile (App ID and Access Token saved by an earlier build) opens in the legacy mode, ready without re-entry. **An API-key session starts** (no `requestMeta.AppKey` — choice 5; if it is refused at `StartSession`, that is the first suspect). Each check opens and finishes one real session: record whether the console bills it.
    2. **The query URL from the web page, the extension's side panel and Electron (ruling 2):** the socket opens in each; no credential in the Logs or the Logs' export; record whether DevTools' own console prints a failed socket's URL with its query.
    3. **Speech to speech, auto:** zh → en, en → zh, ja → zh and each of the other spoken languages once, as a source and as a target of zh or en; the speaker's cloned voice heard on the monitor and in the virtual microphone, once each; source and translation rows paired; replay per sentence with keep-audio on; no karaoke.
    4. **Text only, the full list:** a sample of the twelve text-only languages as sources (ko → zh, ru → en, ar → en, th → zh) and as targets (zh → ko, en → vi); no audio.
    5. **A dialect source:** 粵語 → 中文 and 上海话 → English, in text only; the badge reads "YUE-CN" / "SH-CN".
    6. **`zhen`:** mixed Chinese and English speech, speaking and text only; rows labelled "ZHEN".
    7. **Pairing (ruling 11):** record the `subtitle.*` frames' `sequence`, `startTime` and `endTime` over several utterances — is `Sequence` shared by a source and its translation, and do the translation's times count on the source's timeline? Check rows on rapid speech, on a long monologue (a translation opening more than 4 s after its source leaves L2's proximity window) and on sentences that overlap.
    8. **Push-to-talk (ruling 6):** a short press → the utterance finalized soon after release; a press with no speech → nothing shown, the next press not merged; `turn.tail` frames, with `cancelled` for a cancel.
    9. **The keepalive during silence (ruling 7; review M1):** ten minutes silent or muted — the session stays open; `audio.idle` once per idle, `audio.resumed` when speech returns; during continuous speech no `audio.idle` at all (a slow device's capture gaps under 250 ms never trip it); recognition quality against the old build's.
    10. **Both with participant speech (ruling 4):** two sockets; the participant's reverse direction; its switch on → the other party's translation heard on the real device in their cloned voice, off → text; a text-only pair with the participant's speech on → the gate refuses the participant leg in words; either leg ending ends both; participant-only. Record whether two sessions on one credential are allowed, and whether the participant's libraries (sent on both legs, choice 6) do harm.
    11. **Errors mid-session (ruling 8):** a status error → the run ends with its words (`notices.client` / `notices.server` with Doubao's detail); a network drop → the connection-lost words.
    12. **The status codes (choice 4):** every status other than 20000000 and its message, from `session.status` frames; whether `4xxxxxxx` is always the client's fault.
    13. **TTS replay (ruling 10):** each sentence's clip on its own translation row, also when translations follow each other fast, and when a sentence starts before its translation shows text (record the order of `subtitle.translation` phase `start`, its first `response`, and `tts.sentence_start` with their `ref`s); keep-audio off → no replay button.
    14. **The libraries:** hot words, replacement and glossary ids take effect as in the old build.
    15. **Stop mid-sentence:** rows finalized; no audio after Stop; `FinishSession` sent.
    16. **The wizard:** the own-key path lists Doubao after Gemini; the credential step shows the choice above the saved mode's fields; **a first-run setup with an API key only** — pick "API key", validate, finish — leaves Settings in the API key mode with the key saved, and a session starts; the language step's lists follow the scenario, and Back to another scenario normalizes a pair its list does not hold.
    17. **The Logs panel:** the frames grouped (no flood of `subtitle.*` rows), `session.usage` and `session.audio_muted` present, no credential anywhere.
    18. **Analytics:** `translation_session_start` with `provider: 'volcengine_ast2'`; a refused start → `api_error` with its code.
    19. **A long session** (survey §2.13 item 15): 30 minutes or more, speaking and silent — no server timeout, no latency growth.
    20. **Stale header rules from the old client, in the extension** (review M7): on a profile where an old build ran AST2 (`chrome.declarativeNetRequest.getDynamicRules()` in the service worker lists ids 2000–2003), start a session in the API key mode, then in the legacy mode with other credentials than the rules carry: record which credential the server honours, and whether either session is refused.
  - **Open questions for the owner:**
    - Pairing (item 7): state origins from `Sequence`, or emit timing, if the live test shows either holds (choice 3).
    - The idle line's words name an API key in the legacy mode too (`notices.credentials_missing` is generic): a code of its own would need a key in 30 catalogs.
    - The participant leg's libraries (choice 6): dropping them needs a leg identity `build` does not have.
    - The resampler has no low-pass filter beyond its averaging (choice 11).
    - Per-row `zh` / `en` labels in a `zhen` session (choice 18).
    - A failed socket's URL in DevTools' own console (item 2): not a sink of ours; only a header seam would keep the credentials out of the URL.
    - Every failure before the socket opens reads as refused credentials while online: a rate-limited upgrade (the account's QPM 60, survey §2.4, with readiness re-checking after edits) or a proxy that blocks it says "check the App ID and the Access Token, or the API key" too (choice 8; review M7). Telling them apart needs what a browser cannot read — the upgrade's status.
    - Each check opens a real session (item 1), and readiness re-checks 800 ms after every settings edit — a library-id keystroke included (the Soniox plan's "re-probes on every settings edit").
    - Analytics for `degraded` (Plan A's open question, unchanged).
  - **V2's inventory** (the deletion plan, after the live test), the relay twin with it (the owner's ruling: deleted, not ported):
    - `src/services/clients/VolcengineAST2Client.ts` (+ test; its six corpus cases already ported to `config.test.ts`), the two stubs `src/services/clients/volcengine-ast2/ast2-proto.{js,d.ts}`;
    - `src/services/providers/VolcengineAST2ProviderConfig.ts`, `KizunaAIVolcengineAST2ProviderConfig.ts` (the relay twin), `volcengineAST2LanguageSync.ts` (+ test); their `ProviderConfigFactory` registrations (`:10, 12, 43-45, 58, 163`) and the old test tables naming them (`descriptorRegistry`, `kizunaProviderGating`, `providerOrder`, `participantConfig`, `speechMode`, `sessionResourcesWiring`, `voicePrepWiring`, `prepareToStart.*`, `ClientFactory`, `ClientOperations`, `settingsStore.*`, `kizunaProviders`, `AccountButton`, `PoweredBy`, `SetupWizard`, `providerPath(s)`, `Provider.test` — survey §1.19);
    - the old UI's AST2 branches: `ProviderSpecificSettings.tsx:1471-1719` and its active-slice ternaries (`:171-194`), `ProviderSection.tsx:76, 484-485, 719-756`, `LanguageSection.tsx:114-121, 166-180, 259-270, 312, 318-326, 605`;
    - the `volcengineAST2` and `kizunaVolcengineAst2` slices of `settingsStore.ts` (`:291, 294, 421, 424, 657, 663, 706, 709, 973, 976, 1541, 1544, 1625, 1628`) — the storage keys stay, `providerStore` reads them;
    - `Provider.KIZUNA_AI_VOLCENGINE_AST2` with `isKizunaManagedProvider` / `kizunaBaseProvider`'s AST2 case (`Provider.ts:13, 49-60`), `KIZUNA_HOSTED_ICONS`' entry (`ProviderIcons.tsx:280`), `isKizunaVolcengineAST2Enabled` (`environment.ts:230-236`) and its forwarding (`extension/vite.config.ts:176-184`, `build.yml`'s AST2 lines), `TUTORIAL_URLS`' AST2 entry (`tutorialUrls.ts:19`) once nothing reads it;
    - the extension's AST2 DNR block and its two messages (`background.js:254-317, 544-563`), and **in their place a start-up clear of dynamic rules 2000–2009**, so a browser that ran the old client drops what it left installed;
    - `providers.kizunaai_volcengine_ast2.*` in 30 catalogs; `logStore.ts`' old AST2 event names and grouping alternatives, once no old client emits them;
    - **keep:** `LEGACY_SLICE_KEYS.kizunaai_volcengine_ast2` and `MANAGED_LEGACY_IDS` (a stored selection of the twin falls back, the Kizuna Soniox plan's choice 13), `getRelayWsUrl` and the `sokuji-auth.` redaction rule (shared with the Kizuna OpenAI Translate twin), `electron/main.js`' generic `ws-headers-set/clear` (OpenAI Live's seam will use it).
  - **F14's owner:** this record supersedes the Stage 2 Gemini section's "with AST2's header seam" (its choice 20 and "What this plan leaves"): F14 is OpenAI Live's, and the plain `socket.ts` of Soniox, Gemini and Doubao move to `src/lib/contract/` with it (review D5).
  - **The roadmap's inheritance:** this plan's table "The roadmap's inheritance, item by item", as landed.
  - **What it leaves:** "What this plan leaves" below, verbatim.
- [ ] **Step 3: Commit.**

```bash
git add docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md
```

```bash
git commit -q -F - -- docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md <<'EOF'
docs(spec): a language offer per speech mode, credentials in the query

The shape gains a language context and a credential choice; Doubao
AST 2.0's release tail, its keepalive, its proximity pairing and its
query credentials are stated, so it is not the header seam's first
user. The roadmap records the Volcengine AST2 plan, the owner's live
test and V2's inventory with the relay twin.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

## The roadmap's inheritance, item by item

Taken (and where), deferred (and why), or already done.

**Scheduled by the Stage 2 foundation plan** (roadmap `:1287-1289`, `:1298-1302`, `:1304`):

| Item | Disposition |
|---|---|
| Volcengine AST2: F14, the socket seam (`openSocket`; its fake hands out `FakeSocket`s) | not built: the credentials ride in the query (ruling 2). Doubao gets its own plain `socket.ts` (choice 13), tested over `FakeSocket` as Soniox and Gemini are; F14's first user becomes OpenAI Live, superseding the Gemini plan's record ("with AST2's header seam") |
| Volcengine AST2: F16, windowing the pairing inference | done by the Gemini plan (its Task 2); consumed here through `createProjector` (Tasks 5, 15) |
| OpenAI Translate: F16 if AST2 did not land it | done by the Gemini plan |
| Palabra: F4, the credential-adjacent control | built here (Tasks 3, 10), Doubao its first user; Palabra's platform / app toggle becomes a `credentials.choice` on its `authMode` |
| OpenAI Live: F14 (reused) | becomes F14's first user |

**From the Soniox plan's "Found here"** (roadmap `:1740-1747`):

| Item | Disposition |
|---|---|
| Readiness re-probes on every settings edit | applies: a library-id keystroke re-runs Doubao's handshake 800 ms later — a real session opened and finished. Not taken (a generic change); an open question |
| `timing` after a 503 resume | n/a: Doubao emits no timing and does not resume |
| `audio.range` after fill-in | n/a: Doubao's clips are rangeless |
| The side latch | n/a: one leg per socket |
| Two TTS sockets per key in shared Both | its analogue, two sessions per credential in Both, is live-test item 10 |
| `Conversation.afterAudio`'s pending drop | n/a: Doubao emits no `speechRanges` |

**"Before any release from the branch"** (roadmap `:1751-1765`, `:2318-2343`) and **the Kizuna Soniox plan's "Found here"** (`:2494`):
- The registry's order: extended by ruling 5 (Doubao fourth), pinned in `registry.test.ts`.
- The wizard's own-key description: its "Doubao" becomes true with Task 16; "OpenAI" still waits for its port.
- The relay twin: deleted, not ported (`:2334`) — V2's inventory takes it with the own-key code.
- The release-flag cleanup at Stage 2's end: the two AST2 flags join it (Task 18's record).
- The native-speaker checks: one key in 30 catalogs and two language names (Task 6).

**Stage 2 items from the roadmap this plan does not take:** the kit's parked items (`{ flush: true }` after an awaited answer, `FakeSocket`'s close codes, the virtual clock's `pending()` count, manual-end's segment check); the account's compile-time narrowing; `RunnerDeps.replayAudio`'s guard; the notice-code namespace.

---

## What this plan leaves

- **V2**, the deletion of the old AST2 code with the relay twin, the AST2 background block (replaced by a start-up clear of rules 2000–2009) and the dead flags, after the owner's live test (Task 18's inventory).
- **F14**, the header seam, for OpenAI Live; Soniox's, Gemini's and Doubao's plain `socket.ts` move to `src/lib/contract/` with it.
- **Palabra's use of F4:** its toggle as a `credentials.choice`.
- **Stated origins for Doubao,** if the live test shows `Sequence` or the times state the pair (choice 3).
- **The legacy mode's own idle words** — an open question.
- **The start-up clear of DNR rules 2000–2009** — V2's, before any release that carries Doubao in the extension.
- **`session.closed` on Stop** is not emitted (the kit forbids emissions after stop), as for Soniox and Gemini.
- **The owner's open questions** in Task 18's record, each with the live-test item that settles it.

---

## Self-review

**Spec coverage.** "L0 — the client contract" and "What every adapter must honour": Task 15 (the conformance scenarios, frames, stop, no emission after it). "Turns", AST2's rows: Tasks 7, 15 (the tail, the keepalive). "Provider capability", AST2's row: Tasks 8, 15 (no origin, rangeless replay). "The provider definition": Tasks 3, 6, 16 (two credential modes through the choice). "Credentials are not settings" (one credential form for the panel and the wizard): Tasks 6, 10, 17. "Readiness is one check" (bounded): Task 14. "Languages are two functions" and D20: Tasks 3, 6, 9, 11. "Sockets that need upgrade headers": Task 12 (the query; no seam). "Segmentation is one fact" (`'provider'`): Task 16. "L2 — the projection" (inferred pairing): Tasks 5, 15 through the Gemini plan's F16. "Testing" (conformance, virtual clock, no network): Tasks 12, 14, 15. The spec's amendments: Task 18.

**Placeholders.** None: every code step carries its code or its exact edit; the commit trailers' `<implementing model>` is filled by the implementer, as in Plans A and B1.

**Type consistency, checked across tasks:** `LanguageContext`, `CredentialChoice`, `SpeechInputs`, `languageContext(p, legs, inputs)` (Task 3 → Tasks 6, 9, 10, 11); `Ast2Settings`, `AST2_DEFAULTS`, `Ast2Credentials` (`kind: 'app' | 'apiKey'`), `ast2Credentials`, `ast2Languages`, `ast2Offers`, `ZHEN` (Task 6 → Tasks 12–16); `Ast2Corpus`, `Ast2Config { mode, sourceLanguage, targetLanguage, corpus? }`, `buildAst2`, `describeAst2` (Task 6 → Tasks 12, 15, 16); `InputPacer.push` / `.drain` / `.tail`, `Resampler`, `IDLE_MS`, `KEEPALIVE_MS`, `PACKET_SAMPLES`, `TAIL_MS` (Task 7 → Task 15); `Ast2Segments.subtitle(side, phase, text)`, `.speechRef()` (the started translation, else the last shown), `Ast2Speech.sentenceStart(ref)` / `.chunk(data)` / `.flush()` / `.stop()`, `OggDecoder`, `decodeOggOpus` (Task 8 → Task 15); `ProviderEntry.stored`, `setSpeech`, `participantSpeechSwitchFromStores`, `watchSpeechFromStores` (Task 9 → Tasks 11, 16); `OpenSocket`, `nativeSocket`, `WS_OPEN`, `ast2Url`, `REFUSED_UPGRADE`, `startSessionFrame`, `audioFrame`, `finishSessionFrame`, `decodeResponse`, `isOk`, `statusFailureCode`, `statusText`, `EventType`, `OK_STATUS`, `trackedClock` and the fixtures (Task 12 → Tasks 14, 15); `Ast2SettingsView` (Task 13 → 16); `checkAst2`, `CHECK_TIMEOUT_MS` (Task 14 → 16); `createAst2Adapter`, `START_TIMEOUT_MS`, `startAst2` / `liveAst2` (Task 15 → 16); `CredentialChoiceControl({ options, value, onChange, disabled? })` (Task 10 → Tasks 10, 17); `SetupDraft.credentialChoice`, `setCredentialChoice`, `ApplySetupDeps.applyProvider(provider, pair, credentials, settings)` (Task 17, whose tests read Task 16's registration and Task 6's `Ast2AuthMode`). Re-checked after the review's fixes: `drain` is `tail`'s first half, so the tail cases pass unchanged; the keepalive case's first idle now sends the chunk's last 84 samples before its silence (2 048 samples at 24 kHz are 1 364 at 16 kHz: one packet and 84 waiting); `speechRef` answers the side's `ref` before `lastTranslation`, and the existing speech cases lock the same refs as before. Every code block was run in the scratch copies (research notes), except the lines that name the Gemini plan's later code: the registry order (Task 16), `gemini/provider.test.ts`' order case and the Gemini `testing.ts` edit (Task 12) — the last checked for its form (an imported binding exported by name is callable in its own module; a scratch module of that form passed), each stated against the committed plan's text.

**The choices this plan makes inside the rulings** (each numbered above, listed for the owner): 1 the language context, the stored pair and the derived pair; 2 the credential choice, the legacy mode by default, drawn by both credential forms; 3 no origin, no timing, `Sequence` and the times framed; 4 a status as a notice code; 5 `requestMeta.AppKey` in the legacy mode only; 6 the libraries on both legs; 7 `describe` is `{}`; 8 a socket that fails before it opens; 9 the frames and the Logs' rows; 10 the keepalive's idle, its drain, and the tail; 11 the resampler without a low-pass; 12 the timeouts; 13 Doubao's own `socket.ts`, F14 to OpenAI Live; 14 `trackedClock` to the kit; 15 the fake's `proximity` script; 16 `TextField`; 17 the language names — Cantonese the shared registry's — English first among a non-Chinese-or-English source's targets; 18 the `zhen` badge; 19 the handling after the start; 20 the check's request; 21 the deletion plan as V2.

**Stated departures from the old behaviour** (for the roadmap's record):
- the participant leg speaks when its switch is on (ruling 4; the old participant was text-only);
- a second credential mode, the new console's API key (ruling 1); the provider runs on the web and installs no DNR rule (ruling 2);
- the languages follow the mode: speaking offers the eight languages and `zhen`, text only twenty, two dialects and `zhen`; a pair with neither Chinese nor English on one side is no longer offered in either mode (ruling 3); picking `zhen` from the target side is gone (choice 17);
- the keepalive sends silence only after 250 ms with no audio, not after 60 ms, so it no longer splices zeros into speech, and what the pacer held goes up before the silence, not after it (ruling 7; review M1);
- the resampler carries its phase across chunks and sends 80 ms packets (ruling 12);
- a status error, or `SessionFailed`, after the start ends the run in words (ruling 8; the old client ignored `SessionFailed` once started, survey §2.10);
- the check validates the user's pair, bounded to 15 s, and throws while offline instead of blaming the credentials (ruling 9, choices 8, 20); a start rejects in words within 30 s on the request's clock, never with the URL (choice 12);
- a spoken sentence's clip is locked to the translation started at its start, read before the decode, and its decodes run in order (ruling 10; parity with the old lock, the two old races not ported);
- the Logs' frame names change (`subtitle.*`, `tts.*`, `session.*`), grouped under the old keys (choice 9).

**Departures from the survey** (for the reviewer):
- the language context in the contract and the store's stored pair (choice 1): the survey had one offer per provider; ruling 3's per-mode languages need one per context;
- the credential choice (F4) built here, in the settings panel and the setup wizard, with one new locale key in 30 catalogs (ruling 1, choice 2): the survey planned no UI work and no locale key;
- the libraries on both legs (choice 6): the survey proposed dropping them on the participant's, which `reversed()` cannot do for `zhen/zhen`;
- no timing emitted on either side (choice 3): the survey emitted the source's;
- the check runs text only, on the user's pair, with no libraries, for 15 s, and throws offline (choices 8, 12, 20);
- no low-pass filter beyond the resampler's averaging (choice 11): the survey's §2.10 asked for "a light low-pass";
- a start that times out after its socket opened reads `server`, and a socket refused before it opens `auth` while online (choices 8, 12): the survey said `network` throughout (§2.10);
- `trackedClock` promoted to the kit (choice 14), touching Soniox's and Gemini's fixtures;
- F14 not built and moved to OpenAI Live, Doubao keeping its own `socket.ts` (ruling 2, choice 13);
- the fake's `proximity` script added (choice 15);
- the frame names are this plan's own (`session.status`, `session.socket_error`, `audio.idle`, …; choice 9), and the group checks' bundle sentinel is `audio.idle`;
- 17 implementation tasks, not the survey's 11: the contract, the store, the surfaces, the credential form and the wizard's credential choice are their own tasks.
