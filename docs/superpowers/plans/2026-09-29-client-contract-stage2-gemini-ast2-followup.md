# Client contract — Stage 2 follow-up: Gemini and Doubao AST 2.0 (karaoke, Gemini's default model and languages, push-to-talk tail, turn handling per model)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Standing of the rulings below.** Rulings 1–6 are **the owner's decisions** (2026-09-29, in conversation, on the evidence of his own wire probes): Doubao AST 2.0's whole-sentence karaoke keyed by the server's times (ruling 1); Gemini's karaoke by arrival, the honesty rule's third stated exception (ruling 2); Live Translate as Gemini's default model (ruling 3); a release tail for Live Translate under push-to-talk (ruling 4); Gemini's activity handling per model family (ruling 5); Gemini's language offer rebuilt from Google's documented codes, per model family (ruling 6). Where a ruling left a sub-decision to this plan ("decide", "say why", "say what that does"), the answer is a numbered *choice* below, and the self-review lists each one. This plan runs **before** the Stage 2 Palabra plan.

**Goal:** Karaoke for the two providers that had none, and the four Gemini fixes the owner's probes asked for. Concretely:
- **Doubao AST 2.0** (`volcengine_ast2`): a spoken sentence's clip carries the range of the whole translation subtitle whose server times it carries — matched as the clip is emitted, stated once that subtitle's text is final, through `speechRanges` when the clip came first — and the lock the clip used to be given becomes the fallback for a sentence whose times name no subtitle (ruling 1; choices 2–5). A `Response` subtitle frame is a piece of the text, not the text so far: the pieces are joined (choice 1).
- **L1** (`Conversation`): an `audio` range that arrives after the punctuation fill-in is measured against the adapter's own text and re-anchored onto the filled one, as `speechRanges` already is — without it, Doubao's karaoke would stop short in the display cut by sentences, the one mode that fills in (choice 19). And a held clip keeps its entries when the pcm ceiling drops its pcm, so a range stated later still names them — the Soniox plan's parked item, which Doubao can now reach (choice 6).
- **Gemini** (`gemini`): each played audio chunk carries `[the previous chunk's end, the translation's length at its arrival]` (ruling 2; choice 7); a fresh profile runs the listed Live Translate (ruling 3; choice 8); a push-to-talk release on Live Translate sends real-time silence inside the press's activity until the model has been quiet 1 s, at most 3 s, then `activityEnd` (ruling 4; choices 10–13); a 3.x dialogue model barges in, 2.5 and Live Translate do not (ruling 5; choice 9); the languages are Google's documented codes — the Live API's 99 for a dialogue model, Live Translate's 78 as its targets — and a pair saved in the old regional codes falls to English → Japanese, a side saved as `pt-BR` excepted — nothing is written, so it falls at each load until the user picks (ruling 6; choices 14–18).

It ends with the controller's docs task and the owner's live test (Task 9).

**Architecture:**
- **Doubao AST 2.0** keeps its three pure pieces. `segments.ts` (`Ast2Segments`) now also remembers the last eight translation subtitles' server times; takes a TTS sentence at its start as the lock read then and the times it carries (`sentence`); when the sentence's clip is emitted, names the subtitle those times match, counts each ref's clips and answers the clip's translation and range (`clipFor`); and states a waiting range at the subtitle's close (`speechRanges`). `speech.ts` (`Ast2Speech`) asks for the translation and range after the decode, never at the sentence's start. The adapter passes the times through and frames each clip (`tts.clip`). The view is unchanged: it already lights per segment and slices per row; an end-to-end test pins that in sentence mode, with the punctuation fill-in landing before the clip and after it.
- **Gemini:** `turns.ts` ranges each played chunk; `settings.ts` holds the default rule, the activity-handling rule and the rebuilt language table; `config.ts` carries `activityHandling` in `GeminiConfig`, which `wire.ts`' `setupFrame` writes, and refuses a Live Translate target outside its 78; a new `tail.ts` (a copy of OpenAI Translate's, less its pad) runs the release tail, which `adapter.ts` drives.
- **L1:** `Conversation.audio` measures a range after fill-in against the adapter's own text (`unfilled`), as `Conversation.ranges` does; one loop in `Conversation.afterAudio` keeps entries it used to drop.
- **No contract change,** no new locale key, no store change, no view change.

**Tech Stack:** TypeScript (strict), React 19, Vitest + @testing-library/react (jsdom), the adapter test kit (`FakeSocket`, `fakeSockets`, `runScenario`, `trackedClock`, `flush`), the generated protobuf codec (Doubao's frames), `@google/genai` (the wire oracle only).

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — the binding authority, as amended by the Stage 2 plans through OpenAI Realtime. The parts this plan meets: D4 and "Risks" (karaoke's honesty rule), "Provider capability" (GeminiClient's and VolcengineAST2Client's rows), "L0 — the client contract" (`audio.range`, `speechRanges`: "The segment may already be closed"), "Turns" (Gemini's rows), "Readiness is one check" (the effective model), "Languages are two functions" (`initial`, `migratePair`, the participant rule D20), "Migration" (items 3 and 4). Task 9 amends it.

**Research notes:**
- **The evidence** (the owner's probes, run with the app's own wires; the logs carry no credential):
  - the probe scripts, committed: `scripts/dev/wire-probe/{common,gemini,ast2}.mts`;
  - the raw logs and reports, git-ignored: `.superpowers/wire-probes/ast2/` (`report.md`, two `.jsonl`), `.superpowers/wire-probes/gemini/` (`report.md`, eleven `.jsonl`), and the run logs `.superpowers/wire-probes/{gemini-run,gemini-run2,gemini-overlap,gemini-ptt,ast2-run}.log`;
  - the research on Gemini 3.x input handling: `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/gemini-live-input-drop-research.md`;
  - the language research: `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/gemini-languages.md` (§1 the documented tables, §2 the diff against the old 34, §3 Chinese and the region variants).
- **What the probes show** (the numbers this plan relies on):
  - Doubao (zh → en and ja → zh, two runs of one clip each, 8 sentences): every `TTSSentenceStart` and `TTSSentenceEnd` carries **no text**, and its `startTime` / `endTime` equal its translation subtitle's `Start` and `End` exactly — `20–1460`, `1940–4500`, `392–3272`, … — 8 of 8. A sentence can start before its subtitle ends (ja → zh: S2 started at 8.72 s, T2 ended at 8.86 s). Every source subtitle also carries its translation's times — evidence for stated pairing, which this plan does not take ("What this plan leaves").
  - Gemini, text against audio: Live Translate is a real-time stream (a 250 ms chunk every 250 ms, silence included) with its text 0–0.3 s ahead of its speech; the 2.5 dialogue model sends text and audio together, faster than real time, arrival ranges within about 8 % of an even interpolation; 3.8 sends its text in 2–4 deltas.
  - Gemini under push-to-talk on Live Translate (`gemini-ptt.log`): the model runs about a second behind its input, and with nothing sent between presses the press's last words (「します。」 / " here to help.") arrived only after the next `activityStart`.
  - Gemini, a second utterance 1.5 s after the first, while the model still speaks (`gemini-overlap.log`): `gemini-3.8-live` under `NO_INTERRUPTION` never transcribed or translated the second utterance's first half; under `START_OF_ACTIVITY_INTERRUPTS` both came through whole, turn 1's translation intact (its audio all delivered within about 1 s). `gemini-2.5-flash-native-audio-preview-12-2025` is the opposite: `NO_INTERRUPTION` gave both translations whole, barge-in truncated the first. `turnCoverage` changed nothing useful. One run per setting.
- **Found while writing** (at `4f7c6b83`):
  1. **Doubao's `Response` subtitle frames are pieces, not the text so far.** The probe's zh → en source subtitle arrives as `W`, `ing`, `使用`, `实时`, `翻译`, `，`, then `End` `Wing使用实时翻译，` — the pieces joined equal the `End` (`2026-09-28T19-24-32-s2s-zh-en.jsonl`, lines 5–12). The landed `Ast2Segments` sends each `Response`'s text as the segment's whole text (`segments.ts:36-38, 53`, pinned by `segments.test.ts`' "sends each snapshot whole"), so a live row shows only the newest piece until the `End`. The old client never showed a partial (its list held only completed items), so this is a Stage 2 regression. Task 1 joins the pieces (choice 1).
  2. **The Soniox plan's parked `afterAudio` item can now be reached.** Its "Found here" says `Conversation.afterAudio` drops a whole held (`pending`) list past the pcm ceiling, and "when a provider parks audio before its segment opens and emits `speechRanges`", the fix is to empty the entries' pcm and keep the entries. Doubao now does both in form: a sentence can start before its translation shows any text, and its range comes later. In practice the ceiling (64 MiB) reaches a held list only when no segment holds pcm at all — `afterAudio` drains the segments first — so a live session will hardly meet it. Task 2 closes the item anyway (choice 6); nothing else in this plan depends on it.
  3. **The probe script reads two things these rulings move.** `gemini.mts` picks its dialogue model with `defaultGeminiModel` (which ruling 3 turns to Live Translate), and it builds a `GeminiConfig` literal, which ruling 5's new field would leave without `activityHandling` — the server would then take its own default, barge-in, on every run. Tasks 4, 7 and 8 keep it right.
  4. **Gemini's translation text only grows** (its deltas are appended; the text parts stand in only when no transcript came, and only at the turn's end), so the "restated within the final text if it settles shorter" of ruling 2 has nothing to do here (choice 7).
  5. **A stored pair side the offer does not hold falls to the offer's first entry, not to `initial`** (`providerStore.ts:220-223`: `initial` fills only a side stored as `''`; `normalizePair` takes `sources[0]` / `targets[0]`). Every Gemini user's pair is saved in the old regional codes, so without a `migratePair` each would land on the list's first language twice. Task 8's `migratePair` reads such a side as nothing stored (choice 17).
  6. **With ruling 3, a test config over an unlisted model runs Live Translate.** `configFor(model)` saves `model` and builds over `SHARED.models`; a model the list lacks is replaced by the default. Task 7 lists a 3.x model in `SHARED.models` (`BARGE_IN`) so its cases build that model.
  7. **Live Translate's table has two languages the Live API's 99 lacks** — Javanese (`jv`) and Sundanese (`su`) (78 = 76 shared + 2); the Live API's 99 has 23 Live Translate lacks.
  8. **Barge-in ends a turn twice:** the probe's 3.8 sends `interrupted` and, 5 ms later, `turnComplete`; `GeminiTurns` closes the turn at each, so the turn counter skips a number. Origins only need to differ; nothing to change. **Changed at the final review** (`58ee9e5c`): the second end also consumed a voiceless press's pending drop (the Gemini plan's ruling 8), so `interrupted` and a `turnComplete` with no content between them now count as one end, and the counter no longer skips.
  9. **Every word is an existing key.** The one new refusal (choice 18) rides the runner's `build_refused` ("The provider can't start with these settings: {{detail}}"), as OpenAI Translate's "does not translate into" refusal does (`openai_translate/config.ts:40`). No catalog changes.
  10. **An `audio` range after the fill-in is kept as given** (found in this plan's review). L1 measures a late `speechRanges` against the adapter's own text (`unfilled`) and re-anchors it onto the filled one (`Conversation.ts:267-305`), but keeps an `audio` range as it came (`:238-263`); the Soniox plan parked the gap because no adapter sent such a range (roadmap, "`audio.range` after fill-in"). Doubao now does, on its common path in the display cut by sentences: the fill-in runs only there (`src/app/punctuation.ts:124`), it starts at the subtitle's close, and the clip follows the `End` by 89–690 ms in the probe (the `TTSSentenceEnd`, then the decode), so the fill-in usually lands first. Three of the probe's eight translations closed without a sentence end. On a CJK target the inserted marks move the last letters: `我来帮你翻译` filled to `我来帮你，翻译。` kept its range `[0, 6]`, so `译` (now at 6) never lit and karaoke's hold kept the row lit in the gap until the next clip. (An English text ending in a space happened to absorb the shift.) Task 2 measures the `audio` range as `speechRanges` is measured (choice 19); Task 6's sentence-mode test pins both orders.
- **A scratch copy of the tree** at `4f7c6b83` (outside the repository, 2026-09-29) ran every code and test block below before it was written down; each block is that copy's file, and every diff is generated from it. Each task's red step was run against the code before the task, and each green step after it, with the counts quoted in the steps. Revised after the plan's review, and run again from a fresh copy, task by task, from this document's own blocks. After Wave 1: **556 files passed and 1 skipped, 7 068 tests passed and 2 skipped**; after Wave 2: **557 and 1, 7 094 and 2**; after Wave 3: **557 and 1, 7 097 and 2**, no unhandled errors; the typecheck at 259 lines in the full tree and exactly the gate's 20 after every wave.

## Global Constraints

- **Starting point.** HEAD `4f7c6b83` on `worktree-client-contract-stage2`. Every task anchors its edits by content, not by line: a line number cited here was read at `4f7c6b83`.
- **Edits shown as diffs.** A change to an existing file is a unified diff with its context lines, generated from the scratch copy; its hunk headers count the lines at `4f7c6b83` — or, for a file an earlier task of this plan also edits, at that task's result. Apply a hunk by its content all the same. A new file, or a file replaced whole, is shown in full.
- **What this plan touches:**
  - `src/providers/volcengine_ast2/{segments,segments.test}.ts` — Tasks 1, 6;
  - `src/lib/conversation/{Conversation,Conversation.test}.ts` — Task 2;
  - `src/providers/gemini/{turns,turns.test}.ts`, `src/providers/gemini/karaoke.test.ts` (new) — Task 3 (`turns.ts` again in Task 7, a comment);
  - `src/providers/gemini/{settings,settings.test,config.test,provider.test}.ts`, `src/providers/gemini/GeminiSettings.test.tsx`, `scripts/dev/wire-probe/gemini.mts` — Task 4 (each again in Task 7 or 8);
  - `src/providers/gemini/{tail,tail.test,adapter.tail.test}.ts` (new), `src/providers/gemini/{adapter,adapter.test}.ts` — Task 5 (both again in Task 7);
  - `src/providers/volcengine_ast2/{speech,speech.test,adapter,adapter.test,testing}.ts`, `src/providers/volcengine_ast2/karaoke.test.tsx` (new) — Task 6;
  - `src/providers/gemini/{config,wire,wire.test,wire.oracle.test,testing}.ts` — Task 7 (each but `wire.ts` again in Task 8);
  - `src/providers/gemini/check.test.ts` — Task 8;
  - the spec and the roadmap — Task 9.
- **Read only.** `src/services/**` (the old clients stay as they are); `src/providers/openai_translate/**` (its `tail.ts` is copied, never imported); `src/lib/contract/**`, `src/lib/view/**`, `src/lib/projection/**`, `src/stores/**`, `src/components/**` (the view already lights per segment and slices per row; Task 6's test imports `ConversationList` and `SubtitleBody` and changes neither); `src/utils/**`; the 30 locale catalogs; `electron/**`, `extension/**`; `package.json` and the lockfile. `npx vitest run src/services` stays green.
- **Import rules:**
  - A provider's session side — `adapter.ts` and every file of its folder it reaches by a value import — imports no store and no reporter and runs no global timer: every timer reads the request's clock. Gemini's session side gains `tail.ts` (it reads the clock it is handed, through `every`); `sessionSide.consistency.test.ts` holds both folders to it unchanged.
  - No provider imports another provider's folder: Gemini's `tail.ts` is a copy (choice 10).
  - A test may import components and view modules; production code in `src/providers/**` imports none of them.
- **Diagnostics** (CLAUDE.md, "Error Handling"): the adapters never report and never log; they say what happened through `frame`, `degraded` and `failed`, as they do now. Nothing new is said but frames.
- **Frames** (a Logs line each, never audio, never a credential; the hot-path rule — no frame per chunk or per tail frame):
  - Doubao's `tts.sentence_start` payload becomes `{ ref, startTime, endTime, sequence }` — `ref` the lock's, as landed — and Doubao gains `tts.clip` (`{ ref, matched, range }`, one per clip as it goes to L1, the range `null` when none) (choice 5);
  - Gemini gains `turn.tail` (`{ cancelled: true }` on a cancel, else no payload) and `turn.tail_end` (`{ reason, silenceMs, lastOutputMs, cancelled? }`), OpenAI Translate's names; `realtime_input.activity_end` now follows the tail on Live Translate; `session.opened` gains `activityHandling` (choice 9). No `logStore` row is needed: none of these names is anyone's row.
- **Locales.** No new key (research note 9).
- **No network.** No test, probe or step calls Google or Volcengine. The adapters are tested over `FakeSocket` on a virtual clock. The group check types no key into either provider.
- **Gates for every task:**
  - **The suite.** `npx vitest run src` shows 0 failed and no unhandled errors. Measured at `4f7c6b83` on 2026-09-29: **553 test files passed and 1 skipped (554); 7 035 tests passed and 2 skipped (7 037); no unhandled errors.** The scratch copy's numbers after each wave (research notes) are references, not the gate: the gate is the rule. (The `Not implemented: window.open` stderr lines are pre-existing, `ChildWindowPopover`'s.)
  - **The typecheck.** The gate prints exactly the baseline lines below. The shell's `grep` is a ugrep wrapper that mis-parses this regex, so use `command grep` exactly as written. Every file this plan edits is already inside the regex.

    ```
    npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts|diagnostics/(consoleLedger|clientDiagnostics|redact))|lib/modern-audio/BaseAudioRecorder|providers|services/(clients/(SonioxSttStream|SonioxTtsStream|PcmMixer|SonioxSideTracker|SonioxTtsRest|SonioxVoicesClient|SonioxClient|ManagedVoicesClient|managedVoicePolling|VolcengineAST2Client|volcengine-ast2/ast2-proto\.d)|providers/(SonioxProviderConfig|KizunaAISonioxProviderConfig|managedVoicePrep|managedVoicePrep\.test|prepareToStart\.kizunaSoniox\.test))\.ts|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|MainPanel\.|panel/|SessionCountdown)|MainLayout/(MainLayout|useSignInProviderSwitch)|Settings/(Settings\.tsx|ProviderArea|SimpleSettings/SimpleSettings\.tsx|AdvancedSettings/AdvancedSettings\.tsx|sections/((SpeechSection|VoiceLibrarySection)(\.test)?\.tsx|(ParticipantSpeechSwitch(\.test)?|SentenceSegmentationSection|SystemAudioSection|SonioxVoiceSection|ProviderSpecificSettings)\.tsx|voiceLibrarySource(\.test)?\.ts))|SettingsInitializer/|SetupWizard/(SetupWizard(\.test)?\.tsx|(setupDraft|applySetup|useApplySetup)(\.test)?\.ts|providerPaths(\.test|\.managedFit\.test)?\.ts|steps/(StepLanguagePair|StepLanguagePair\.test|StepCredentials|StepCredentials\.test|StepFinish|StepProviderPath|StepScenario)\.tsx)|TitleBar/(AccountButton(\.test)?\.tsx|useBalanceShortfall)|Tour/useStartBasicsTour\.ts|dev/(SpinePreview|SessionControls|OverlayPreview|wireTally|gapCounter))|contexts/UserProfileContext|locales/(index\.ts|showLanguageUncached)|routes/Home\.tsx|stores/(providerStore|turnModeStore|routingStore|accountStore|logStore|settingsStore\.ts)|utils/(environment|conversationExport)|subtitle-overlay-entry|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
    ```

    The same command is `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh`; its output must equal `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate-baseline.txt` — exactly these **20** lines, re-measured at `4f7c6b83` (**259** lines in the full tree, the ceiling):

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

    Do not fix them; do not add to them. The TS lib is ES2020: no `Array.prototype.at` in a test either. `scripts/dev/wire-probe/*.mts` is outside `tsconfig.json`: a task that edits it checks its syntax with `npx esbuild scripts/dev/wire-probe/gemini.mts --format=esm --log-level=warning --outfile=/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/<task-dir>/probe-check.js`, which prints nothing.
  - **Gates in a parallel wave.** Waves run tasks at once in this one working tree, so each task sees the others' red phases:
    - a test failure, or an extra gate line, in a file another concurrent task is changing is that task's work in progress: the implementer names it in the report and never touches it;
    - the task's own files must be green, and the gate must print the baseline plus only such named lines;
    - after each wave the controller runs the full gates: the suite at 0 failed with no unhandled errors, and the exact baseline.
  - **A task edits only the files in its Files list**, and commits exactly those. Where a step names tests elsewhere its change could reach, it says why each stays green. If one fails anyway, the implementer stops, reports the failure with its output, and leaves the file untouched: the controller decides. No task edits a read-only file or a file another task of the same wave edits.
  - **No task mutates the tree to prove a guard, and no temporary file is written inside `src/`.** A mutant a reviewer wants to try runs in a scratch copy under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`.
- **Builds, at the group check only** (the controller's):
  - `npm run build` and `npm run extension:build`. If `extension/node_modules` is missing, run `npm ci --prefix extension` first.
  - `npx vitest run extension`.
  - The D24 check: each of these prints nothing —
    - `command grep -rlF 'The fake degraded its speech' build extension/dist`
    - `command grep -rlF 'Lease ended by the leased fake' build extension/dist`
    - `command grep -rlF 'The leased fake refused the lease' build extension/dist`
  - The new Gemini code shipped: `command grep -rlF 'Live Translate does not translate into' build extension/dist` names at least one file under `build/` and one under `extension/dist/`. Nothing in the tree holds that phrase at `4f7c6b83` (checked; OpenAI Translate's refusal names "OpenAI Translate").
- **Dev servers, probes and builds** are the controller's; an implementer never starts one. A rendered check runs against a fresh vite: `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort --force`, restarted after edits (a worktree's vite can serve stale transforms).
- **Shell forms.** This worktree's guard refuses compound shell forms: brace groups, loops, `cd … &&` chains. Every command in this plan is a single command or a plain pipeline, run as its own call from the worktree root. Use `command grep`. The shell is zsh: quote globs; `echo ====` is an error. Checks write their outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, never `/tmp`, each agent in a directory named for its task and role (`t6-impl/`, `t3-review/`).
- **Commits:**
  - Conventional, in English. Every message ends with the implementing model's own `Co-Authored-By:` line, then `Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe`, and nothing after it. The examples below write the first as `Co-Authored-By: <implementing model> <noreply@anthropic.com>`: fill in your own model's name.
  - Run `git add <paths>`, then `git commit -q -F - -- <the same paths> <<'EOF' … EOF`, as two separate calls. The `--` pathspec is mandatory: parallel tasks stage into the same index. Never stage a whole directory that is not wholly the task's.
  - Production comments cite this plan's rulings and choices as "(Gemini/AST2 follow-up, ruling N)" / "(Gemini/AST2 follow-up, choice N)" — both folders already cite their own plans' rulings unqualified — and cite D rulings and F items as they are; never a task number, a review finding or a probe's file name. English only.
  - Never push.

## Rulings

Cited as *ruling N* (in code, "Gemini/AST2 follow-up, ruling N"). All six are the owner's (2026-09-29). Each is restated with where it lands.

1. **Doubao AST 2.0: whole-sentence karaoke, keyed by the server's timestamps.** A TTS sentence's `startTime` / `endTime` equal its translation subtitle's (8 of 8 in the probe), so the sentence's clip gets the range of the whole translation subtitle whose times it carries — a stated correspondence, not an exception to D4's honesty rule. A sentence whose times match no subtitle stays rangeless (replay only). The range is stated only once the subtitle's text is final: the clip is emitted rangeless and ranged by `speechRanges` at the subtitle's end, or ranged directly when the end came first. It must line up with the display cut by sentences. Lands in: Task 6 (choices 2–5), Task 2 (choice 19), Task 9.
2. **Gemini: karaoke by arrival** — the honesty rule's third stated exception, after OpenAI Translate's and OpenAI Realtime's, and their construction: each played chunk carries `[the previous chunk's end, the translation text's length when it arrived]`. Audio outside an open translation stays unattributed. Lands in: Task 3 (choice 7), Task 9.
3. **Gemini's default model becomes Live Translate** when the check lists it, else the old rule; no one-time migration code — a stored explicit model stays, an unset one (`''`) now resolves to Live Translate. Lands in: Task 4 (choice 8), Task 8 (choice 16), Task 9.
4. **Live Translate under push-to-talk gets a release tail:** after a release, real-time silence until the translation has been quiet 1 s, at most 3 s, counted in frames. Lands in: Task 5 (choices 10–13), Task 9.
5. **Gemini's `activityHandling` per model family:** 2.5 models `NO_INTERRUPTION` (today's value), 3.x and later dialogue models `START_OF_ACTIVITY_INTERRUPTS`, Live Translate unchanged (`NO_INTERRUPTION`); the choice lives in `GeminiConfig`, built in `buildGemini`, written by `setupFrame`, pinned by `wire.oracle.test.ts`. Lands in: Task 7 (choice 9), Task 9.
6. **Gemini's language offer is rebuilt from Google's documented codes, per model family:** the codes exactly (bare codes; `pt-BR` / `pt-PT`; `zh-Hans` / `zh-Hant`), the old region variants and `cmn-CN` / `ar-XA` dropped; a dialogue model offers the Live API's 99 as sources and targets; Live Translate offers its 78 as targets and what Google recognises as sources; a stored pair that no longer matches falls to the default, with no one-time migration code — a stated departure for the release note. Lands in: Task 8 (choices 14–18), Task 9.

## Choices this plan makes inside the rulings

Cited as *choice N*.

1. **Doubao's `Response` is a piece; the text shown is the pieces joined** (research note 1). `Ast2Segments` keeps each side's pieces since its last `Start` or `End`; a `Response` adds its piece and shows the join when it is not blank; an `End` still replaces the text with its own whole text (the server's final word, which the probe shows equal to the join) and closes. An empty piece sends nothing; a blank piece joins (the join is untrimmed, as the text shown always was). Nothing else changes: the false-start rule, the one-segment-per-`Response`-run rule and the refs stay as landed. Its own task (Task 1), so it can be judged apart from the karaoke: the owner did not rule on it, and it changes what a live Doubao row shows while it streams.
2. **The server times replace the lock as a sentence's translation when they match; the lock stays the fallback.** Why: the lock names the translation started *now*, so a sentence whose `TTSSentenceStart` arrives after the next translation has started lands on the wrong row; the times name the right one whenever they match, and they matched 8 of 8. The lock (`speechRef`, landed) still answers a sentence whose times name none of the recent translations, or that carries none. **When each is read:** the lock at `TTSSentenceStart`, as landed — the old client's race was reading it after the decode — and the times when the clip is emitted, after its decode (`Ast2Segments.sentence`, then `clipFor`): the times name one subtitle whatever opened since, so a sentence that starts before its translation's `Start` (never seen in the probe) still finds it.
3. **The match:** equal `startTime` and `endTime`, with `endTime > 0`, against the last `MATCH_WINDOW` = 8 translation subtitles (a sentence follows its subtitle within about a second; eight subtitles back is far past that, and the list stays small). A translation keeps the times of whichever of its frames carries them (the probe: its `Start` and its `End`; a `Response` carries none). The first clip to carry a subtitle's times is `matched` and ranged; a later one with the same times goes to the same row, unranged — two ranges over one text would overlap, which the contract forbids. A translation never shown (a false start) leaves the list, so no sentence is ranged onto a row that never opens; its sentence takes the lock. Source subtitles' times are not kept.
4. **When the range is stated:** at the clip's emission, after its decode — not at `TTSSentenceStart`, because the subtitle may end (or start, choice 2) during the decode. A subtitle is final when it closes — its `End`, or the next `Start` of its side when the `End` never came — and the range is `[0, the length of the text it closed with]`. A matched clip emitted before that is rangeless, its entry recorded, and ranged at the close by one `speechRanges`, after `segmentClosed` ("The segment may already be closed", L0). `Ast2Segments` counts every clip it is asked about per recent ref, ranged or not, since `speechRanges` names an entry by its place among the ref's `audio` events. So L1 never holds a range over text whose letters later change, and L1's "letters changed → drop the ranges" rewrite cannot meet it; the one later rewrite, the punctuation fill-in, keeps the letters, and L1 re-anchors the range across it whichever lands first (choice 19). `Ast2Speech` takes a `ClipFor` callback (`Ast2Segments.clipFor`, through the adapter) and calls it only for a clip it emits.
5. **The frames and the view.** `tts.sentence_start` frames `{ ref, startTime, endTime, sequence }` — the lock's ref, shown or not, as landed, and the times the sentence carries. `tts.clip` frames `{ ref, matched, range }` as each clip goes to L1: which row it took, whether the times named it, and its range (`null` while its subtitle is open). The live test reads how often the times match from `tts.clip`. No display change is needed for the display cut by sentences: the view lights a segment's characters `[0, upTo)` (`src/lib/view/karaoke.ts`), and each row maps its own slice (`ConversationList.tsx:131-135`, `SubtitleBands.tsx:140`). Task 6 pins that end to end: a two-sentence translation, its clip decoded before its `End`, cut into two rows — nothing lit while the subtitle is open, then the first row whole and the second up to the boundary, in the panel's list and in the subtitle's bands; and a ja → zh translation closing without a sentence end, filled in before its clip and after it, lit to its last character with the hold letting go in the gap (choice 19).
6. **L1 keeps a held clip's entries when the pcm ceiling drops its pcm** (research note 2): `Conversation.afterAudio`'s last loop empties each held entry's pcm (`EMPTY_PCM`) and keeps the entry, as the segments' own loop does, instead of deleting the ref's list — so a `speechRanges` stated later still names its entry and the clip keys stay aligned. A held list already empty is skipped. It closes the Soniox plan's parked item, which Doubao can now reach in form; only with "Keep audio for replay" on (the retention then counts pcm), the ceiling reached, and no segment holding pcm — so no live test reaches it, and its unit tests are its proof. Nothing else in this plan depends on it.
7. **Gemini's arrival ranges** (ruling 2), in `GeminiTurns.audio`: each open translation side keeps `spoken`, where the last played chunk's range ended; a played chunk carries `[spoken, text.length]` and moves `spoken` to its end; `[0, 0]` before any text. Only audio that plays is ranged: a leg that does not speak drops the audio before (landed), and Live Translate's audio outside an open translation stays unattributed (landed choice 8 of the Gemini plan). The text only grows (research note 4), so no range is ever outside it and nothing is restated. **Live Translate's silent chunks** inside an open translation — its stream is real time, silence included — carry `[spoken, spoken]` when no text came since the last chunk: zero-width, so karaoke holds where it is and never advances on silence; the chunk after a new phrase's text takes that phrase whole, so the phrase lights over one 250 ms chunk while its voice may run longer — phrase-level, text 0–0.3 s ahead (the probe). Replay keeps them, as today. A dialogue turn whose transcript never came keeps `[0, 0]` on its chunks: its text parts are shown only at the turn's end.
8. **The default model** (ruling 3): `defaultGeminiModel` answers the newest listed Live Translate (`isGeminiTranslateModel`), else the newest `native-audio` model, else the newest, else `''`. Nothing is migrated: a saved model the check lists stays; an unset one, or one no longer listed, resolves to the default at use (`effectiveGeminiModel`, landed). The settings view shows the effective model — no "Recommended" label exists for models, and the wizard shows none — so a fresh profile's view shows Live Translate and hides the voice and model configuration (landed choice 22 of the Gemini plan). The probe script's dialogue run takes the default among the dialogue models.
9. **Activity handling** (ruling 5): `geminiActivityHandling(model)` in `settings.ts`, by the landed family rule (`familyOf`): Live Translate → `NO_INTERRUPTION`; a dialogue model of family 3.0 or later — `gemini-3.8-live`, `gemini-3.1-flash-live-preview`, `gemini-3-…`, a future `gemini-4.0-live` — → `START_OF_ACTIVITY_INTERRUPTS`; 2.5 and below, and an id with no version (family 0) → `NO_INTERRUPTION`, today's value, since only 2.5 and 3.8 were measured and a future family more likely inherits 3.x's pipeline than 2.5's. `GeminiConfig.activityHandling` (always set), `setupFrame` writes it, `wire.oracle.test.ts` pins both values against the SDK's converter, and `session.opened` frames it. It follows the model alone: both legs, both turn modes.
10. **The tail is copied, not lifted:** `src/providers/gemini/tail.ts` is OpenAI Translate's `tail.ts` less its pad. Why: Gemini is its second user and the house rule lifts at the third; the two differ — Translate pads to its 200 ms engine grid and frames at 200 ms, Gemini has no grid and frames at 100 ms (the probe's pace), Gemini's tail must also end on typed text, and it counts its quiet by transcriptions alone (choice 12); and lifting would edit Translate's tail before its live test. Importing Translate's is ruled out (no provider imports another's folder). The beat counting — ends counted in frames, never read off the clock — is kept verbatim.
11. **`activityEnd` goes after the tail, and the tail runs inside the press's activity.** Why: with automatic detection off, input outside an activity is not documented to reach the model — Live Translate's guide never mentions activity at all — and the probe showed the server consuming audio inside an activity and going silent after `activityEnd`. So a release keeps the activity open, sends the tail, and sends `activityEnd` when the tail ends — by itself (quiet or the cap), or because a press, audio or typed text ended it, in which case `activityEnd` goes first so the marks stay paired (the new press's `activityStart`, or the text's own marks, follow). A stop or a lost connection drops the tail silently: its activity was the old connection's.
12. **The tail's details:** quiet means no transcription of either side, and transcriptions only — OpenAI Translate's tail counts its audio too, but Live Translate's output is a real-time stream with its silence included, so its audio never stops and every tail would run to the cap; and the input transcript of the press's last words lags about a second, and its translation follows it by up to 0.3 s, so counting only the output transcript would end the quiet before the last words when the model runs past a second behind. The ends are a press, audio or typed text; audio cannot end it under push-to-talk — the runner sends speaker audio only while the key is held (`run.ts:454-459`), and that press has ended the tail first — and the reason is kept for any other caller. One 100 ms frame of 24 kHz silence per beat; quiet after 10 beats without a transcription, the cap at 30 — `TAIL_QUIET_MS` = 1 000 and `TAIL_MAX_MS` = 3 000, starting values the live test tunes; a cancelled press (released without voice) runs the same tail, framed `cancelled` — what it appended is the model's input already. Frames: `turn.tail` at the release, `turn.tail_end` with the summary, then `realtime_input.activity_end`.
13. **Dialogue models get no tail:** their `activityEnd` ends a turn the model answers whole, and a tail inside the activity would only delay the answer.
14. **The language codes:** one table, `GEMINI_LANGUAGE_TABLE`, 101 rows — the Live API's 99 and Live Translate's two others (`jv`, `su`) — each with Google's code, its own name, Google's English name and where Google documents it (both tables, the Live API's alone, Live Translate's alone). Norwegian's row names `no, nb`: `no` is offered. The order: English first, as in the old list, then Google's own order, by English name, so every row reads against the documented table. English is also where a side a model switch takes out of the offer falls, by the generic rule (`normalizePair` takes the first entry) — which makes an English source's pair English → English (choice 17). The English names feed the instructions (`geminiLanguageName`), so a dialogue model is told "Chinese (Traditional)" or "Portuguese (Portugal)", where it was told "Mandarin Chinese (China)". `toTranslationLanguageCode` and its `cmn-CN → zh` map go: the codes are Live Translate's own, sent as they are.
15. **The display names are a static table, not `Intl.DisplayNames`.** Why: every provider's list is a static table; ICU's endonyms change with the runtime's ICU data (Node for the suite, Chromium for the app) and would make the tests depend on it; ICU writes many in lower case (`español`, `français`) where the app's lists capitalise (`Español`); and a few read oddly as menu names (`português europeu`, `kurdî (kurmancî)`). The names were drafted from ICU's and the app's existing spellings (`Bahasa Indonesia`, `Norsk`, `Português (Brasil)`) and capitalised where the script has case; Chinese reads `中文 (简体)` / `中文 (繁體)` in the app's `中文 (…)` form. A native-speaker spot check is a before-release item.
16. **The offer follows the saved model's family.** The language functions see `S`, not the check's list, so the family is read from `S.model`: a Live Translate id, or no model chosen (`''` — the default a key that lists Live Translate runs, ruling 3), offers Live Translate's; any other id a dialogue model's. Live Translate's sources are **the 99 and its own two** (`jv`, `su`): its guide calls it translation "between" its languages, so a language it translates into is one it hears, and Both reverses a Javanese pair. A Live Translate source outside its 78 (Assamese, Faroese, …) refuses the participant leg under the generic reverse rule (D20), in the participant notice's words. **A key that lists no Live Translate** with no model chosen runs a dialogue model on the Live Translate offer until the user picks a model in the model field: narrower targets, each one a dialogue model takes too but Javanese and Sundanese, which only the instructions then name.
17. **A stored side the offer does not hold takes `initial`'s:** Gemini declares `migratePair`, which reads such a side as nothing stored (`''`), so `providerStore` fills it from `initial` (`en` → `ja`) instead of the list's first entry (research note 5; without it every old pair would read English → English). It converts nothing — no old code maps to a new one — and holds for any side outside the offer, a language Google drops later included: legitimate normalisation, which runs on every load (`providerStore.ts:220-223`), not a one-time migration. **The departure, exactly:** a Gemini pair saved before this plan falls to English → Japanese, except a side stored as `pt-BR`, the one old code Google still documents (`pt-BR → cmn-CN` loads as `pt-BR → ja`); nothing is written, so it falls again on each load until the user picks a pair. **Known, generic behaviour:** a later model switch that narrows the offer falls to the list's first entry, English, by `normalizePair` — an English source's pair then reads English → English until the user picks.
18. **A Live Translate target outside its 78 is refused at build, in words** — "Live Translate does not translate into Faroese: choose another language, or a dialogue model." — never sent. How it can happen: the offer follows the saved model (choice 16), but a saved dialogue model the check no longer lists runs as the default, Live Translate, whose targets are fewer. OpenAI Translate refuses the same way (research note 9).
19. **An `audio` range after the fill-in is measured as a `speechRanges` range is** (research note 10): in `Conversation.audio`, when the segment's text was filled in (`unfilled` holds the adapter's own text), a range that fits the adapter's text is re-anchored from it onto the filled text (`reanchorRanges`), and one past it is dropped with the `range_out_of_text` diagnostic, keeping the pcm — the rules `Conversation.ranges` already applies. A fill-in landing after the clip re-anchors its range as it re-anchors any (landed). So Doubao's range reaches the filled text's last character in both orders, and karaoke's hold lets go when the clip ends. It closes the Soniox plan's parked "`audio.range` after fill-in" item for every provider; Doubao's matched clips are the only current caller; no range an adapter sends before the fill-in changes. In Task 2, which already edits `Conversation.ts`, rather than in Doubao's adapter (a rangeless clip followed at once by `speechRanges`): the adapter keeps ruling 1's letter, "ranged directly when the end came first", and the hole closes for everyone.

## What this plan consumes from the earlier plans

Named as landed, so a reconciliation is mechanical. Where a landed name or text differs from what is quoted here, the implementer follows the landed one and reports it.

| From | What it is | Consumed by |
|---|---|---|
| The Volcengine AST2 plan: `Ast2Segments` (`segments.ts`: `subtitle(side, phase, text)`, `speechRef()`, `SegmentSink`), `Ast2Speech` (`speech.ts`: `sentenceStart(ref)`, `chunk`, `flush`, `stop`, `OggDecoder`), the adapter's `subtitle()` and `tts()` (`adapter.ts:251-270`), the fixtures (`SERVER`, `liveAst2`, `startAst2`, `configFor`, `AUTO_CTX`, `counterIds`) | the pieces the karaoke extends | Tasks 1, 6 |
| The Gemini plan: `GeminiTurns` (`turns.ts`: `audio`, `output`, `interrupted`, `ensure`), `setupFrame` / `GeminiSetup` (`wire.ts:33-94`), `defaultGeminiModel` / `effectiveGeminiModel` / `familyOf` / `isGeminiTranslateModel` / `geminiLanguages` / `geminiLanguageName` / `toTranslationLanguageCode` (`settings.ts`), `buildGemini` / `GeminiConfig` (`config.ts`), `GeminiSession.beginTurn` / `endTurn` / `appendText` / `reconnect` / `shutdown` (`adapter.ts:320-469`), the fixtures (`configFor`, `SHARED`, `AUTO_CTX`, `liveGemini`, `SERVER`, `DIALOGUE`, `TRANSLATE`) | what the four Gemini changes edit | Tasks 3, 4, 5, 7, 8 |
| The OpenAI Translate plan: `tail.ts` (`ReleaseTail`, the beat counting, `TailSummary`, the frames `turn.tail` / `turn.tail_end`); `segments.ts:62-78` (a played frame's range `[previous end, text length]`) | the tail, copied; arrival karaoke | Tasks 3, 5 |
| The OpenAI Realtime plan: `items.ts:157-190` (ranges restated within a shorter final text); the pcm64 helpers in `src/lib/contract/pcm64.ts` | the construction ruling 2 names; the probe's decoding | Task 3 |
| L1 and the view: `Conversation` (`speechRanges` onto held and closed segments, `pending`, `unfilled`, `audio`, `afterAudio`, `reanchorRanges`, the fill-in's `punctuate`), `litFor` (`src/lib/view/karaoke.ts`), `displayItems`, `createProjector` / `DEFAULT_PROJECTION`, `clipKey`, `ConversationList`, `SubtitleBody` | the range's consumers | Tasks 2, 6 |
| The provider store: `languages.initial`, `languages.migratePair` (F5, `providerStore.ts:220-223`), `normalizePair` | the stored pair's fall | Task 8 |
| The kit: `FakeSocket` (`sent`, `sentJson`, `open`, `receive`, `serverClose`), `runScenario` / `scenarioNames`, `recordEvents`, `flush`, `trackedClock` | every adapter test | Tasks 3, 5, 6, 7, 8 |

## File Structure

| File | Task | Change |
|---|---|---|
| `src/providers/volcengine_ast2/{segments,segments.test}.ts` | 1 | a `Response` is a piece; the pieces joined are the text |
| `src/lib/conversation/{Conversation,Conversation.test}.ts` | 2 | an `audio` range after fill-in re-anchored; a held clip's entries kept when the ceiling drops its pcm |
| `src/providers/gemini/{turns,turns.test}.ts`, `src/providers/gemini/karaoke.test.ts` (new) | 3 | arrival ranges |
| `src/providers/gemini/{settings,settings.test,config.test,provider.test}.ts`, `src/providers/gemini/GeminiSettings.test.tsx`, `scripts/dev/wire-probe/gemini.mts` | 4 | Live Translate the default |
| `src/providers/gemini/{tail,tail.test,adapter.tail.test}.ts` (new), `src/providers/gemini/{adapter,adapter.test}.ts` | 5 | the release tail |
| `src/providers/volcengine_ast2/{segments,segments.test,speech,speech.test,adapter,adapter.test,testing}.ts`, `src/providers/volcengine_ast2/karaoke.test.tsx` (new) | 6 | whole-sentence karaoke by the server's times |
| `src/providers/gemini/{settings,settings.test,config,config.test,wire,wire.test,wire.oracle.test,adapter,adapter.test,turns,testing}.ts`, `scripts/dev/wire-probe/gemini.mts` | 7 | activity handling per family |
| `src/providers/gemini/{settings,settings.test,config,config.test,wire.test,wire.oracle.test,provider.test,check.test,testing}.ts`, `src/providers/gemini/GeminiSettings.test.tsx`, `scripts/dev/wire-probe/gemini.mts` | 8 | Google's language codes, per family |
| the spec, the roadmap | 9 | the controller's amendments and record |

**Order and parallelism.**
- **Wave 1:** Tasks 1, 2, 3, 4, 5. Disjoint files: Task 3 alone edits `turns.ts` and adds `karaoke.test.ts`; Task 4 alone edits `settings.ts` and its tests and the probe; Task 5 alone edits `adapter.ts` and `adapter.test.ts`.
- **Wave 2:** Task 6 (needs Task 1: `segments.ts` and its test; and Task 2: its fill-in test relies on choice 19) and Task 7 (needs Tasks 3, 4, 5: `turns.ts`, `settings.ts`, `settings.test.ts`, `config.test.ts`, the probe, `adapter.ts`, `adapter.test.ts`). Disjoint: one is Doubao's folder, the other Gemini's.
- **Wave 3:** Task 8 (needs Task 7: the same Gemini files).
- **The group check** (controller) after Wave 3.
- **Task 9** (controller) last.

---

### Task 1: Doubao's subtitle pieces, joined (Wave 1)

**Files:**
- Modify: `src/providers/volcengine_ast2/segments.ts`
- Test: `src/providers/volcengine_ast2/segments.test.ts`

**Interfaces:**
- Consumes: `Ast2Segments.subtitle(side, phase, text): Ref | null` as landed.
- Produces: the same signature; `SideState` gains `pieces: string` (private). Task 6 builds on this file.

- [ ] **Step 1: Write the failing tests.** Rewrite the snapshot case and the no-`Start` case with the probe's pieces, and add two cases (choice 1):

```diff
diff --git a/src/providers/volcengine_ast2/segments.test.ts b/src/providers/volcengine_ast2/segments.test.ts
--- a/src/providers/volcengine_ast2/segments.test.ts
+++ b/src/providers/volcengine_ast2/segments.test.ts
@@ -10,22 +10,60 @@ const setup = () => {
 };
 
 describe("Doubao's subtitles as segments", () => {
-  it('opens a side on its first text, sends each snapshot whole, and closes it at End — no origin, no timing (choice 3)', () => {
+  it('opens a side on its first text, sends the pieces joined as the whole text each time, and closes it at End — no origin, no timing (choice 3)', () => {
     const { segments, emitted } = setup();
     expect(segments.subtitle('source', 'start', '')).toBe(1);
     expect(emitted()).toEqual([]);
-    segments.subtitle('source', 'response', '你好');
-    segments.subtitle('source', 'response', '你好，今天');
-    expect(segments.subtitle('source', 'end', '你好，今天怎么样？')).toBe(1);
+    // The owner's probe (2026-09-28, zh → en): each Response a piece, the End the whole (Gemini/AST2 follow-up, choice 1).
+    for (const piece of ['W', 'ing', '使用', '实时', '翻译', '，']) segments.subtitle('source', 'response', piece);
+    expect(segments.subtitle('source', 'end', 'Wing使用实时翻译，')).toBe(1);
     expect(emitted()).toEqual([
       { kind: 'segmentOpened', ref: 1, side: 'source' },
-      { kind: 'segmentText', ref: 1, text: '你好' },
-      { kind: 'segmentText', ref: 1, text: '你好，今天' },
-      { kind: 'segmentText', ref: 1, text: '你好，今天怎么样？' },
+      { kind: 'segmentText', ref: 1, text: 'W' },
+      { kind: 'segmentText', ref: 1, text: 'Wing' },
+      { kind: 'segmentText', ref: 1, text: 'Wing使用' },
+      { kind: 'segmentText', ref: 1, text: 'Wing使用实时' },
+      { kind: 'segmentText', ref: 1, text: 'Wing使用实时翻译' },
+      { kind: 'segmentText', ref: 1, text: 'Wing使用实时翻译，' },
+      // The End equals the pieces joined: nothing new to send.
       { kind: 'segmentClosed', ref: 1 },
     ]);
   });
 
+  it('sends nothing for an empty piece, keeps a blank one in the join, and takes an End that differs from the join as the whole text', () => {
+    const { segments, emitted } = setup();
+    segments.subtitle('translation', 'start', '');
+    // The probe's ja → zh translations carry empty pieces between the characters.
+    for (const piece of ['“', 'リ', '', 'エ', ' ', 'ル']) segments.subtitle('translation', 'response', piece);
+    segments.subtitle('translation', 'end', '“リエル');
+    expect(emitted()).toEqual([
+      { kind: 'segmentOpened', ref: 1, side: 'translation' },
+      { kind: 'segmentText', ref: 1, text: '“' },
+      { kind: 'segmentText', ref: 1, text: '“リ' },
+      { kind: 'segmentText', ref: 1, text: '“リエ' },
+      { kind: 'segmentText', ref: 1, text: '“リエ ' },
+      { kind: 'segmentText', ref: 1, text: '“リエ ル' },
+      // The server's End is the whole text, and wins.
+      { kind: 'segmentText', ref: 1, text: '“リエル' },
+      { kind: 'segmentClosed', ref: 1 },
+    ]);
+  });
+
+  it("starts the next segment's join from nothing: an End, or a Start, clears the pieces before it", () => {
+    const { segments, emitted } = setup();
+    segments.subtitle('translation', 'response', 'One');
+    segments.subtitle('translation', 'end', 'One.');
+    segments.subtitle('translation', 'response', 'Two');
+    segments.subtitle('translation', 'start', '');
+    segments.subtitle('translation', 'response', 'Three');
+    expect(emitted().filter((e) => e.kind === 'segmentText')).toEqual([
+      { kind: 'segmentText', ref: 1, text: 'One' },
+      { kind: 'segmentText', ref: 1, text: 'One.' },
+      { kind: 'segmentText', ref: 2, text: 'Two' },
+      { kind: 'segmentText', ref: 3, text: 'Three' },
+    ]);
+  });
+
   it('keeps the two sides apart, on one counter, and never reuses a ref', () => {
     const { segments, emitted } = setup();
     segments.subtitle('source', 'start', '');
@@ -86,10 +124,11 @@ describe("Doubao's subtitles as segments", () => {
   it('gives Responses with no Start one segment, not one per frame (survey §1.18.3), and an End with no Start its own', () => {
     const { segments, emitted } = setup();
     segments.subtitle('source', 'response', 'a');
-    segments.subtitle('source', 'response', 'ab');
+    segments.subtitle('source', 'response', 'b');
     segments.subtitle('source', 'end', 'abc');
     segments.subtitle('source', 'end', 'lone');
     expect(emitted().filter((e) => e.kind === 'segmentOpened').map((e) => e.ref)).toEqual([1, 2]);
+    expect(emitted().filter((e) => e.kind === 'segmentText').map((e) => e.text)).toEqual(['a', 'ab', 'abc', 'lone']);
     expect(emitted().filter((e) => e.kind === 'segmentClosed').map((e) => e.ref)).toEqual([1, 2]);
   });
 
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/volcengine_ast2/segments.test.ts`
Expected: FAIL — `3 failed | 9 passed (12)`: "opens a side on its first text, sends the pieces joined…", "sends nothing for an empty piece…" and "gives Responses with no Start one segment…" (each shows only the newest piece). The "starts the next segment's join from nothing" case passes already: it guards the reset the next step adds.

- [ ] **Step 3: Join the pieces.**

```diff
diff --git a/src/providers/volcengine_ast2/segments.ts b/src/providers/volcengine_ast2/segments.ts
--- a/src/providers/volcengine_ast2/segments.ts
+++ b/src/providers/volcengine_ast2/segments.ts
@@ -1,9 +1,12 @@
 /**
  * Doubao's subtitles as segments (survey §2.10): each side's
  * `*SubtitleStart` / `Response` / `End` becomes one segment, opened when it
- * first has text, its text a snapshot, closed at `End`. No origin and no
- * timing (choice 3): L2 pairs the two sides by proximity (F16). Pure: the
- * adapter hands it each subtitle and forwards what it emits.
+ * first has text, closed at `End`. A `Response` carries one piece of the
+ * text and an `End` the whole of it (Gemini/AST2 follow-up, choice 1), so
+ * the text shown is the pieces joined until the `End` replaces it. No
+ * origin and no timing (choice 3): L2 pairs the two sides by proximity
+ * (F16). Pure: the adapter hands it each subtitle and forwards what it
+ * emits.
  */
 import type { AdapterEvents, Ref, Side } from '../../lib/contract/adapter';
 
@@ -15,10 +18,13 @@ interface SideState {
   /** Allocated at `Start` (or the first text), released at `End`. */
   ref: Ref | null;
   opened: boolean;
+  /** What was last sent for `ref`. */
   text: string;
+  /** Every `Response` piece since the side's last `Start` or `End`, joined as it came. */
+  pieces: string;
 }
 
-const idle = (): SideState => ({ ref: null, opened: false, text: '' });
+const idle = (): SideState => ({ ref: null, opened: false, text: '', pieces: '' });
 
 export class Ast2Segments {
   private next: Ref = 1;
@@ -33,10 +39,11 @@ export class Ast2Segments {
    * - `start`: the previous segment of the side closes as it stands (its
    *   `End` never came) or, never shown, is dropped; a ref is allocated,
    *   and nothing is emitted until text arrives.
-   * - `response`: the whole text so far. A `Response` with no `Start`
-   *   allocates once, not once per frame (survey §1.18.3); an empty or
-   *   blank one shows nothing.
-   * - `end`: the final text, then the close. An empty or blank `End` of a
+   * - `response`: one piece, added to the pieces before it; their join is
+   *   the text shown (Gemini/AST2 follow-up, choice 1). Pieces with no
+   *   `Start` allocate once, not once per frame (survey §1.18.3); while the
+   *   join is empty or blank, nothing is shown.
+   * - `end`: the whole text, then the close. An empty or blank `End` of a
    *   segment never shown is the server VAD's false start: nothing; of one
    *   shown, it closes with the text it had (survey §1.18.4).
    */
@@ -47,10 +54,12 @@ export class Ast2Segments {
       state.ref = this.next++;
       return state.ref;
     }
+    if (phase === 'response') state.pieces += text;
+    const whole = phase === 'end' ? text : state.pieces;
     // Blank counts as empty, as the old client's false-start test did
     // (`!text.trim()`, `VolcengineAST2Client.ts:738-743, 814-819`); the text
     // shown is still the one sent, untrimmed.
-    if (text.trim()) this.show(side, text);
+    if (whole.trim()) this.show(side, whole);
     const ref = state.ref;
     if (phase === 'end') this.finish(side);
     return ref;
```

- [ ] **Step 4: Run Doubao's suites.**

Run: `npx vitest run src/providers/volcengine_ast2`
Expected: PASS — 13 files, 142 tests. Why the adapter's suites stay green: every `Response` they send is the first of its segment (`'你好'`, `'Hello'`, `'Next'`, `'ours'`), so the join equals it.

- [ ] **Step 5: The gates.** `npx vitest run src` (0 failed, no unhandled errors; in Wave 1 name any other task's file) and the typecheck gate (the baseline).

- [ ] **Step 6: Commit.**

```bash
git add src/providers/volcengine_ast2/segments.ts src/providers/volcengine_ast2/segments.test.ts
```

```bash
git commit -q -F - -- src/providers/volcengine_ast2/segments.ts src/providers/volcengine_ast2/segments.test.ts <<'EOF'
fix(volcengine_ast2): a subtitle Response is a piece; show the pieces joined

Doubao sends each Response as one piece of the text and the End as the
whole of it (the owner's probe, 2026-09-28): the pieces joined are the
text so far. Each Response used to be sent as the whole text, so a live
row showed only the newest piece until the End.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 2: L1 measures an `audio` range after fill-in as it measures `speechRanges`, and keeps a held clip's entries past the ceiling (Wave 1)

**Files:**
- Modify: `src/lib/conversation/Conversation.ts` (the `unfilled` field's comment, `:58`; `audio`, `:238-264`; `afterAudio`'s last loop, `:407-412`)
- Test: `src/lib/conversation/Conversation.test.ts`

**Interfaces:**
- Consumes: `Conversation.apply` with `audio` (a range, a ref not yet opened) and `speechRanges`; the landed `unfilled`, `reanchorRanges`, `punctuate`.
- Produces: no new name. After this task an `audio` range on a segment whose text the fill-in replaced is re-anchored from the adapter's own text onto the filled text, or dropped with `range_out_of_text` when it does not fit the adapter's text (choice 19) — Task 6's fill-in test relies on it. And a held entry's pcm may be `EMPTY_PCM` while the entry stays (choice 6): that closes the Soniox plan's parked item, which Doubao can now reach; nothing else in this plan relies on it.

- [ ] **Step 1: Write the failing tests** (choices 19, 6): two new `audio` cases after a fill-in — a CJK text whose whole range is re-anchored onto its filled text's last character, and a range past the adapter's text dropped and said; the landed ceiling case now expects the entry kept, pcm empty; a new case states a range after the drop.

```diff
diff --git a/src/lib/conversation/Conversation.test.ts b/src/lib/conversation/Conversation.test.ts
--- a/src/lib/conversation/Conversation.test.ts
+++ b/src/lib/conversation/Conversation.test.ts
@@ -128,6 +128,28 @@ describe('Conversation — audio', () => {
     expect(conv.snapshot().segments[0].speech[0].range).toBeUndefined();
     expect(diagnostics.map((d) => d.code)).toEqual(['range_out_of_text']);
   });
+
+  it("after fill-in, re-anchors a range measured against the adapter's own text onto the filled text (Gemini/AST2 follow-up, choice 19)", async () => {
+    const { conv, diagnostics, apply } = make({ languages: { source: 'ja', target: 'zh' }, punctuate: async () => '我来帮你，翻译。' });
+    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: '我来帮你翻译' } });
+    apply({ kind: 'segmentClosed', payload: { ref: 1 } });
+    await conv.settled();
+    expect(conv.snapshot().segments[0].text).toBe('我来帮你，翻译。');
+    // The whole of the adapter's text, [0, 6]: the whole of the filled one.
+    apply({ kind: 'audio', payload: { ref: 1, range: [0, 6], pcm: pcm(240) } });
+    expect(conv.snapshot().segments[0].speech).toEqual([{ range: [0, 8], pcm: pcm(240) }]);
+    expect(diagnostics).toEqual([]);
+  });
+
+  it("after fill-in, drops a range past the adapter's own text with a diagnostic, keeping the pcm", async () => {
+    const { conv, diagnostics, apply } = make({ punctuate: async () => 'Hello, world.' });
+    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
+    apply({ kind: 'segmentClosed', payload: { ref: 1 } });
+    await conv.settled();
+    apply({ kind: 'audio', payload: { ref: 1, range: [0, 12], pcm: pcm(240) } }); // 12 is past 'hello world' (11), not past the filled text (13)
+    expect(conv.snapshot().segments[0].speech).toEqual([{ range: undefined, pcm: pcm(240) }]);
+    expect(diagnostics.map((d) => d.code)).toEqual(['range_out_of_text']);
+  });
 });
 
 describe('Conversation — notices and closing', () => {
@@ -476,12 +498,22 @@ describe('Conversation — retention and clear', () => {
     expect(conv.snapshot().segments[0].text).toBe('still live');
   });
 
-  it('trims pcm held for refs that have not opened when it pushes the leg over the ceiling', () => {
+  it('trims pcm held for refs that have not opened when it pushes the leg over the ceiling, keeping their entries (Gemini/AST2 follow-up, choice 6)', () => {
     const { conv, apply } = make({ retention: { keepPcm: true, maxPcmBytes: 1000 } });
     apply({ kind: 'audio', payload: { ref: 9, pcm: pcm(300) } });   // 600 bytes, pending
-    apply({ kind: 'audio', payload: { ref: 10, pcm: pcm(300) } });  // 1200 total: ref 9 is dropped
+    apply({ kind: 'audio', payload: { ref: 10, pcm: pcm(300) } });  // 1200 total: ref 9's pcm is dropped
     apply({ kind: 'segmentOpened', payload: { ref: 9, side: 'translation' } }, { kind: 'segmentOpened', payload: { ref: 10, side: 'translation' } });
-    expect(conv.snapshot().segments.map((s) => s.speech.length)).toEqual([0, 1]);
+    expect(conv.snapshot().segments.map((s) => s.speech.map((x) => x.pcm.length))).toEqual([[0], [300]]);
+  });
+
+  it('a range stated after the ceiling dropped a held clip\'s pcm still lands on its entry, unsaid', () => {
+    const { conv, apply, diagnostics } = make({ retention: { keepPcm: true, maxPcmBytes: 1000 } });
+    apply({ kind: 'audio', payload: { ref: 9, pcm: pcm(300) } });
+    apply({ kind: 'audio', payload: { ref: 10, pcm: pcm(300) } });
+    apply({ kind: 'segmentOpened', payload: { ref: 9, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 9, text: 'Hello.' } }, { kind: 'segmentClosed', payload: { ref: 9 } });
+    apply({ kind: 'speechRanges', payload: { ref: 9, ranges: [{ index: 0, range: [0, 6] }] } });
+    expect(conv.snapshot().segments[0].speech).toEqual([{ range: [0, 6], pcm: new Int16Array(0) }]);
+    expect(diagnostics).toEqual([]);
   });
 
   it('drops pcm held for a ref that never opened when the leg closes', () => {
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/lib/conversation/Conversation.test.ts`
Expected: FAIL — `4 failed | 58 passed (62)`: the `audio` range is kept as given after the fill-in (`[0, 6]` against `[0, 8]`; `[0, 12]` kept, nothing said), the held list is deleted, so the segment opens with no speech (`[[], [300]]` against `[[0], [300]]`), and the later range names no entry.

- [ ] **Step 3: Measure the range, and keep the entries.**

```diff
diff --git a/src/lib/conversation/Conversation.ts b/src/lib/conversation/Conversation.ts
--- a/src/lib/conversation/Conversation.ts
+++ b/src/lib/conversation/Conversation.ts
@@ -55,7 +55,7 @@ export class Conversation {
   private readonly indexByRef = new Map<number, number>();
   /** Audio that arrived before its segment opened. */
   private readonly pending = new Map<number, Speech[]>();
-  /** A segment whose text fill-in replaced: the adapter's own text, which a late `speechRanges` is measured against. Deleted when the adapter sends text again. */
+  /** A segment whose text fill-in replaced: the adapter's own text, which a late `speechRanges` or `audio` range is measured against. Deleted when the adapter sends text again. */
   private readonly unfilled = new Map<number, string>();
   /** Per ref, the speech entries `clear()` dropped: an adapter counts `speechRanges` indices from its first `audio`, L1 (and the clip keys, `playback.clear()`) from the clear (choice 1). */
   private readonly clearedEntries = new Map<number, number>();
@@ -255,6 +255,18 @@ export class Conversation {
       this.opts.onDiagnostic?.({ code: 'range_out_of_text', message: `range [${range[0]}, ${range[1]}] is not a valid range` });
       kept = undefined;
     }
+    // After fill-in the adapter still measures against the text it sent: the range is re-anchored from that text onto
+    // the filled one, as `ranges` does, and one past that text is dropped, said (a clip ranged after its subtitle
+    // closed, Doubao's: Gemini/AST2 follow-up, choice 19).
+    const own = this.unfilled.get(ref);
+    if (kept && own !== undefined) {
+      if (kept[1] <= own.length) {
+        kept = reanchorRanges(own, seg.text, [kept])[0];
+      } else {
+        this.opts.onDiagnostic?.({ code: 'range_out_of_text', message: `range [${kept[0]}, ${kept[1]}] outside ${seg.id}'s text of length ${own.length}` });
+        kept = undefined;
+      }
+    }
     this.replace(i, { ...seg, speech: [...seg.speech, { range: kept, pcm: this.retain(pcm) }] });
     // Local speech can still arrive after close, so a segment already
     // retired by the trim cursor (final and drained) is not done for good:
@@ -404,11 +416,14 @@ export class Conversation {
       if (seg.final && i === this.trimCursor) this.trimCursor++;
       i++;
     }
-    // Still over: audio held for refs that have not opened yet, oldest first.
+    // Still over: audio held for refs that have not opened yet, oldest first — its pcm dropped and its entries kept, as
+    // a segment's are, so a later `speechRanges` still names them and the clip keys still line up (Doubao states its
+    // ranges after its audio: Gemini/AST2 follow-up, choice 6).
     for (const [ref, list] of this.pending) {
       if (this.pcmBytes <= max) break;
+      if (!list.some((s) => s.pcm.length > 0)) continue;
       for (const s of list) this.pcmBytes -= s.pcm.byteLength;
-      this.pending.delete(ref);
+      this.pending.set(ref, list.map((s) => ({ ...s, pcm: EMPTY_PCM })));
     }
   }
 
```

- [ ] **Step 4: Run L1's suites.**

Run: `npx vitest run src/lib/conversation`
Expected: PASS — 3 files, 73 tests. Why nothing else moves: the change reaches only an `audio` range on a segment the fill-in has already replaced, which the roadmap records no adapter at `4f7c6b83` sends ("`audio.range` after fill-in": LocalInference closes after its last audio), and the ceiling's held loop runs only past 64 MiB.

- [ ] **Step 5: The gates.** The suite and the typecheck gate, as Task 1.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/conversation/Conversation.ts src/lib/conversation/Conversation.test.ts
```

```bash
git commit -q -F - -- src/lib/conversation/Conversation.ts src/lib/conversation/Conversation.test.ts <<'EOF'
fix(conversation): measure an audio range after fill-in; keep held entries past the ceiling

After the punctuation fill-in, a speechRanges range was measured against
the adapter's own text and re-anchored onto the filled one, but an audio
range was kept as given: on a filled-in CJK text its last characters
stayed unlit and karaoke held the row in the gap. An audio range is now
measured the same way, and one past the adapter's text is dropped and
said. Doubao ranges a clip after its subtitle closed, often after the
fill-in.

Past the pcm ceiling, audio held for a ref not yet opened lost its whole
list, so a speechRanges stated later named no entry and the clip keys
went out of line. Its pcm is emptied now and its entries kept, as a
segment's are.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 3: Gemini's karaoke by arrival (Wave 1)

**Files:**
- Modify: `src/providers/gemini/turns.ts` (`OpenSide`, `audio`, `ensure`; `:44-48, 99-110, 223`)
- Test: `src/providers/gemini/turns.test.ts`; Create: `src/providers/gemini/karaoke.test.ts`

**Interfaces:**
- Consumes: `GeminiTurns` as landed; the fixtures `liveGemini`, `SERVER`, `TRANSLATE`, `AUTO_CTX`; `Conversation`.
- Produces: `audio` events with `range: [number, number]` on every played chunk of an open translation (choice 7). No signature changes. Task 7 edits one comment of `turns.ts`.

- [ ] **Step 1: Write the failing tests.** In `turns.test.ts`, the ranges of a dialogue turn and of Live Translate's stream (ruling 2; choice 7):

```diff
diff --git a/src/providers/gemini/turns.test.ts b/src/providers/gemini/turns.test.ts
--- a/src/providers/gemini/turns.test.ts
+++ b/src/providers/gemini/turns.test.ts
@@ -56,6 +56,33 @@ describe('a dialogue model: one turn, one origin, stated', () => {
     expect(silent.log).toEqual([]);
   });
 
+  it("ranges each played chunk by arrival: from the previous chunk's end to the text as it stood, [0, 0] before any text (Gemini/AST2 follow-up, ruling 2)", () => {
+    const { t, of } = turns();
+    t.audio(pcm());
+    t.output('Welcome');
+    t.audio(pcm());
+    t.audio(pcm());
+    t.output(' to real-time translation.');
+    t.audio(pcm());
+    t.turnComplete();
+    // The next turn's translation counts from its own start.
+    t.output('Next');
+    t.audio(pcm());
+    expect(of('audio').map((e) => [e.payload.ref, e.payload.range])).toEqual([
+      [1, [0, 0]], [1, [0, 7]], [1, [7, 7]], [1, [7, 33]], [2, [0, 4]],
+    ]);
+  });
+
+  it('keeps [0, 0] on the chunks of a turn whose transcript never came: its text parts are shown only at the turn\'s end', () => {
+    const { t, of, texts } = turns();
+    t.modelText('Bonjour');
+    t.audio(pcm());
+    t.audio(pcm());
+    t.turnComplete();
+    expect(texts(1)).toEqual(['Bonjour']);
+    expect(of('audio').map((e) => e.payload.range)).toEqual([[0, 0], [0, 0]]);
+  });
+
   it("the model's text parts stand in for a transcript that never came (`GeminiClient.ts:1094-1105`), and only then", () => {
     const bare = turns();
     bare.t.modelText('Bonjour');
@@ -367,6 +394,26 @@ describe('Live Translate: no turns, each side on its own silence timer (ruling 1
     expect(timers()).toBe(0);
   });
 
+  it('ranges the audio inside an open translation by arrival — a chunk with no new text is zero-width — and audio outside one carries neither ref nor range (Gemini/AST2 follow-up, ruling 2; choice 7)', () => {
+    const { t, clock, of } = translate();
+    // The probe's Live Translate stream: a 250 ms chunk every 250 ms, silence included; its text 0–0.3 s ahead.
+    t.audio(pcm());
+    t.output('Real-time Funky');
+    t.audio(pcm());
+    t.audio(pcm());
+    t.output(' it is, so');
+    t.audio(pcm());
+    clock.advance(1500);
+    t.audio(pcm());
+    expect(of('audio').map((e) => e.payload)).toEqual([
+      { pcm: pcm() },
+      { pcm: pcm(), ref: 1, range: [0, 15] },
+      { pcm: pcm(), ref: 1, range: [15, 15] },
+      { pcm: pcm(), ref: 1, range: [15, 25] },
+      { pcm: pcm() },
+    ]);
+  });
+
   it('keeps its open segments across a reconnect, closing them on their own timers (`:914`; choice 14)', () => {
     const { t, clock, timers, closed } = translate();
     t.input('interrupted mid-sentence');
```

And the ranges through the adapter into L1, in a new file:

```ts
/**
 * Gemini's karaoke by arrival, through the adapter into L1 (Gemini/AST2
 * follow-up, ruling 2): each played chunk carries the stretch of the
 * translation that had arrived with it, and L1 holds those ranges against
 * the text it shows. The probe's two shapes: a dialogue model's text and
 * audio together, faster than real time; Live Translate's real-time stream.
 */
import { describe, it, expect } from 'vitest';
import { Conversation } from '../../lib/conversation/Conversation';
import { AUTO_CTX, liveGemini, SERVER, TRANSLATE } from './testing';

async function folded(model?: string) {
  const h = await liveGemini(model ? { model } : undefined);
  const conv = new Conversation({ leg: 'speaker', session: 'gemini', languages: AUTO_CTX.direction, clock: h.clock });
  const translation = () => {
    for (const e of h.content()) conv.apply(e);
    return conv.snapshot().segments.find((s) => s.side === 'translation')!;
  };
  return { h, translation };
}

describe("Gemini's karaoke by arrival (Gemini/AST2 follow-up, ruling 2)", () => {
  it("a dialogue model: each played chunk ranged over the text that came with it", async () => {
    const { h, translation } = await folded();
    h.socket().receive(SERVER.input('リアルタイム翻訳へようこそ。'));
    h.socket().receive(SERVER.output('Welcome to real-time translation.'));
    h.socket().receive(SERVER.audio(1200));
    h.socket().receive(SERVER.audio(1200));
    h.socket().receive(SERVER.output(' I will assist.'));
    h.socket().receive(SERVER.audio(1200));
    h.socket().receive(SERVER.turnComplete());
    const t = translation();
    expect(t.text).toBe('Welcome to real-time translation. I will assist.');
    expect(t.speech.map((s) => s.range)).toEqual([[0, 33], [33, 33], [33, 48]]);
  });

  it('Live Translate: a real-time chunk after each phrase takes it, and the silent ones between hold where they are', async () => {
    const { h, translation } = await folded(TRANSLATE);
    h.socket().receive(SERVER.output('Real-time Funky'));
    h.socket().receive(SERVER.audio(6000));
    h.socket().receive(SERVER.audio(6000));
    h.socket().receive(SERVER.output(' it is, so'));
    h.socket().receive(SERVER.audio(6000));
    const t = translation();
    expect(t.text).toBe('Real-time Funky it is, so');
    expect(t.speech.map((s) => s.range)).toEqual([[0, 15], [15, 15], [15, 25]]);
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/gemini/turns.test.ts src/providers/gemini/karaoke.test.ts`
Expected: FAIL — `2 failed (2)` files, `5 failed | 39 passed (44)` tests: no `audio` event carries a range.

- [ ] **Step 3: Range each played chunk.**

```diff
diff --git a/src/providers/gemini/turns.ts b/src/providers/gemini/turns.ts
--- a/src/providers/gemini/turns.ts
+++ b/src/providers/gemini/turns.ts
@@ -5,7 +5,9 @@
  * `turnComplete`, so its source and translation share the turn's origin,
  * stated (`t<n>`). Live Translate has no turns (`GeminiClient.ts:74-94`):
  * each side is its own segment, closed by its own silence timer, and its
- * origin is L2's to infer (F16).
+ * origin is L2's to infer (F16). The audio a translation plays carries the
+ * stretch of its text that had arrived with it — karaoke by arrival
+ * (Gemini/AST2 follow-up, ruling 2; choice 7).
  */
 import type { AdapterEvents, Ref } from '../../lib/contract/adapter';
 import type { Clock } from '../../lib/contract/clock';
@@ -45,6 +47,8 @@ interface OpenSide {
   ref: Ref;
   /** What the server sent, accumulated; the source's is shown normalized. */
   text: string;
+  /** Translation only: where the last played chunk's range ended (Gemini/AST2 follow-up, ruling 2). */
+  spoken: number;
 }
 
 export class GeminiTurns {
@@ -96,6 +100,14 @@ export class GeminiTurns {
     this.arm('translation');
   }
 
+  /**
+   * The model's audio. Played, it carries its translation's text as it
+   * stood when the chunk arrived — `[the previous played chunk's end, the
+   * text's length]`, `[0, 0]` before any text — an alignment by arrival,
+   * not a known correspondence: the honesty rule's third stated exception
+   * (Gemini/AST2 follow-up, ruling 2; choice 7). The text only grows, so no
+   * range ever needs stating again.
+   */
   audio(pcm: Int16Array): void {
     if (this.stopped || this.suppressing || pcm.length === 0) return;
     // Streaming, whether or not this leg plays it.
@@ -106,7 +118,10 @@ export class GeminiTurns {
       this.o.sink.audio({ pcm });
       return;
     }
-    this.o.sink.audio({ pcm, ref: this.ensure('translation').ref });
+    const side = this.ensure('translation');
+    const end = side.text.length;
+    this.o.sink.audio({ pcm, ref: side.ref, range: [side.spoken, end] });
+    side.spoken = end;
   }
 
   modelText(text: string): void {
@@ -220,7 +235,7 @@ export class GeminiTurns {
     const ref = ++this.refs;
     const origin = this.origin();
     this.o.sink.segmentOpened({ ref, side, ...(origin ? { origin } : {}) });
-    const fresh: OpenSide = { ref, text: '' };
+    const fresh: OpenSide = { ref, text: '', spoken: 0 };
     this.sides[side] = fresh;
     return fresh;
   }
```

- [ ] **Step 4: Run the suites the change reaches.**

Run: `npx vitest run src/providers/gemini/turns.test.ts src/providers/gemini/karaoke.test.ts src/providers/gemini/adapter.test.ts`
Expected: PASS — 3 files, 103 tests. The adapter's conformance runs (dialogue and Live Translate) now carry ranges, and the kit's `range-in-text` and `ranges-order` rules hold them. Why the landed adapter cases stay green: they read each `audio` event's `ref` or `pcm`, never the whole payload. In Wave 1, Task 5 edits `adapter.test.ts`; a failure there that names the release tail is its work in progress.

- [ ] **Step 5: The gates.** The suite and the typecheck gate.

- [ ] **Step 6: Commit.**

```bash
git add src/providers/gemini/turns.ts src/providers/gemini/turns.test.ts src/providers/gemini/karaoke.test.ts
```

```bash
git commit -q -F - -- src/providers/gemini/turns.ts src/providers/gemini/turns.test.ts src/providers/gemini/karaoke.test.ts <<'EOF'
feat(gemini): karaoke by arrival

Each played chunk of an open translation carries the stretch of its text
that arrived with it: from the previous chunk's end to the text's length,
[0, 0] before any text. An alignment by arrival, the honesty rule's third
stated exception, as OpenAI Translate's and OpenAI Realtime's. Audio
outside an open translation stays unattributed; the text only grows, so
nothing is restated.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 4: Live Translate, Gemini's default model (Wave 1)

**Files:**
- Modify: `src/providers/gemini/settings.ts` (`defaultGeminiModel`, `:211-220`), `scripts/dev/wire-probe/gemini.mts` (`:262`)
- Test: `src/providers/gemini/settings.test.ts`, `src/providers/gemini/config.test.ts`, `src/providers/gemini/GeminiSettings.test.tsx`, `src/providers/gemini/provider.test.ts`

**Interfaces:**
- Consumes: `sortGeminiModels`, `isGeminiTranslateModel`, `effectiveGeminiModel` as landed.
- Produces: `defaultGeminiModel(models: readonly ModelOption[]): string` — same signature, the newest listed Live Translate first (choice 8). `config.test.ts`' `build` helper now saves the dialogue model unless a patch saves another (Tasks 7 and 8 add cases to it).

- [ ] **Step 1: Write the failing tests.** Every case that relied on a fresh profile running the dialogue model saves it explicitly now; the fresh profile's own cases expect Live Translate (ruling 3; choice 8):

```diff
diff --git a/src/providers/gemini/GeminiSettings.test.tsx b/src/providers/gemini/GeminiSettings.test.tsx
--- a/src/providers/gemini/GeminiSettings.test.tsx
+++ b/src/providers/gemini/GeminiSettings.test.tsx
@@ -21,7 +21,7 @@ const DIALOGUE = 'gemini-2.5-flash-native-audio-preview-12-2025';
 const TRANSLATE = 'gemini-3.5-live-translate-preview';
 
 const props = (patch: Partial<SettingsProps<GeminiSettings>> = {}): SettingsProps<GeminiSettings> => ({
-  settings: GEMINI_DEFAULTS,
+  settings: { ...GEMINI_DEFAULTS, model: DIALOGUE },
   update: vi.fn(),
   pair: { source: 'en-US', target: 'ja-JP' },
   models: [{ id: TRANSLATE }, { id: DIALOGUE }],
@@ -72,6 +72,12 @@ describe('GeminiSettingsView', () => {
     expect(update).toHaveBeenCalledWith({ maxTokens: 8192 });
   });
 
+  it('a fresh profile, no model saved, shows Live Translate as its model: the default when listed (Gemini/AST2 follow-up, ruling 3)', () => {
+    render(<GeminiSettingsView {...props({ settings: GEMINI_DEFAULTS })} />);
+    expect((screen.getByLabelText('settings.model') as HTMLSelectElement).value).toBe(TRANSLATE);
+    expect(screen.queryByLabelText('settings.voice')).toBeNull();
+  });
+
   it('Live Translate hides the voice and the model configuration, and keeps the model (choice 22)', () => {
     render(<GeminiSettingsView {...props({ settings: { ...GEMINI_DEFAULTS, model: TRANSLATE } })} />);
     expect(screen.queryByLabelText('settings.voice')).toBeNull();
diff --git a/src/providers/gemini/config.test.ts b/src/providers/gemini/config.test.ts
--- a/src/providers/gemini/config.test.ts
+++ b/src/providers/gemini/config.test.ts
@@ -16,10 +16,17 @@ const shared = (patch: Partial<SharedSettings> = {}): SharedSettings => ({
 });
 const SPEAKER: SessionContext = { direction: { source: 'en-US', target: 'ja-JP' }, speech: true, turns: 'auto' };
 const PARTICIPANT: SessionContext = { direction: { source: 'ja-JP', target: 'en-US' }, speech: true, turns: 'auto' };
-const build = (patch: Partial<GeminiSettings> = {}, context = SPEAKER, sh = shared()) => buildGemini(context, { ...GEMINI_DEFAULTS, ...patch }, sh) as GeminiConfig;
+/** A leg's config: Gemini's defaults with the dialogue model saved, unless the patch saves another (or none). */
+const build = (patch: Partial<GeminiSettings> = {}, context = SPEAKER, sh = shared()) => buildGemini(context, { ...GEMINI_DEFAULTS, model: DIALOGUE, ...patch }, sh) as GeminiConfig;
 
 describe("Gemini's builder", () => {
-  it('runs a fresh profile on the newest native-audio model, speaking, with the Quick prompt for its direction (rulings 2, 4)', () => {
+  it('runs a fresh profile — no model saved — on Live Translate when the key lists it (Gemini/AST2 follow-up, ruling 3)', () => {
+    expect(build({ model: '' })).toMatchObject({ model: TRANSLATE, kind: 'translate', translationTargetCode: 'ja' });
+    // Without it, the old rule's dialogue model.
+    expect(build({ model: '' }, SPEAKER, shared({ models: [{ id: DIALOGUE }] }))).toMatchObject({ model: DIALOGUE, kind: 'dialogue' });
+  });
+
+  it('runs a saved dialogue model, speaking, with the Quick prompt for its direction (rulings 2, 4)', () => {
     const c = build();
     expect(c).toMatchObject({ model: DIALOGUE, kind: 'dialogue', voice: 'Aoede', temperature: 0.8 });
     expect(c.instructions).toContain('translate English (United States) → Japanese (Japan).');
diff --git a/src/providers/gemini/provider.test.ts b/src/providers/gemini/provider.test.ts
--- a/src/providers/gemini/provider.test.ts
+++ b/src/providers/gemini/provider.test.ts
@@ -77,7 +77,8 @@ describe('the Gemini definition', () => {
     const participant = contextsFor(shape).participant!;
     expect(participant).toEqual({ direction: { source: 'ja-JP', target: 'en-US' }, speech: true, turns: 'auto' });
     expect(contextsFor({ ...shape, participantSpeech: false }).participant!.speech).toBe(false);
-    expect((geminiProvider.build(participant, GEMINI_DEFAULTS, SHARED) as GeminiConfig).voice).toBe('Aoede');
+    // A dialogue model's voice: Live Translate, the default when listed, speaks in the speaker's own (Gemini/AST2 follow-up, ruling 3).
+    expect((geminiProvider.build(participant, { ...GEMINI_DEFAULTS, model: DIALOGUE }, SHARED) as GeminiConfig).voice).toBe('Aoede');
   });
 
   it('a start whose signal already aborted opens no socket', async () => {
diff --git a/src/providers/gemini/settings.test.ts b/src/providers/gemini/settings.test.ts
--- a/src/providers/gemini/settings.test.ts
+++ b/src/providers/gemini/settings.test.ts
@@ -149,23 +149,26 @@ describe("Gemini's models", () => {
     expect(sortGeminiModels(LIVE_NEWEST_FIRST)).toEqual(LIVE_NEWEST_FIRST);
   });
 
-  it('default a fresh profile to the newest native-audio dialogue model, whatever order the list came in (ruling 2)', () => {
+  it('default a fresh profile to Live Translate when the key lists it, whatever order the list came in (Gemini/AST2 follow-up, ruling 3)', () => {
     const live = LISTED.filter(isGeminiLiveModel);
-    expect(defaultGeminiModel(ids(live))).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
-    expect(defaultGeminiModel(ids([...live].reverse()))).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
-    expect(effectiveGeminiModel(GEMINI_DEFAULTS, ids(live))).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
+    expect(defaultGeminiModel(ids(live))).toBe('gemini-3.5-live-translate-preview');
+    expect(defaultGeminiModel(ids([...live].reverse()))).toBe('gemini-3.5-live-translate-preview');
+    expect(effectiveGeminiModel(GEMINI_DEFAULTS, ids(live))).toBe('gemini-3.5-live-translate-preview');
+    // Two listed: the newest.
+    expect(defaultGeminiModel(ids(['gemini-3.5-live-translate-preview', 'gemini-4.0-live-translate-preview']))).toBe('gemini-4.0-live-translate-preview');
   });
 
-  it('fall back to the newest dialogue model, then the newest model, then nothing', () => {
-    expect(defaultGeminiModel(ids(['gemini-2.0-flash-live-001', 'gemini-3.1-flash-live-preview', 'gemini-3.5-live-translate-preview']))).toBe('gemini-3.1-flash-live-preview');
-    expect(defaultGeminiModel(ids(['gemini-3.5-live-translate-preview']))).toBe('gemini-3.5-live-translate-preview');
+  it('with no Live Translate listed, default by the old rule: the newest native-audio dialogue model, then the newest model, then nothing (ruling 2)', () => {
+    const dialogue = LISTED.filter((id) => isGeminiLiveModel(id) && !isGeminiTranslateModel(id));
+    expect(defaultGeminiModel(ids(dialogue))).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
+    expect(defaultGeminiModel(ids(['gemini-2.0-flash-live-001', 'gemini-3.1-flash-live-preview']))).toBe('gemini-3.1-flash-live-preview');
     expect(defaultGeminiModel([])).toBe('');
   });
 
-  it('keep a saved model the check listed, replace one it no longer lists, and keep it while nothing is listed', () => {
+  it('keep a saved model the check listed — a dialogue model too: nothing is migrated — replace one it no longer lists, and keep it while nothing is listed', () => {
     const live = ids(LISTED.filter(isGeminiLiveModel));
-    expect(effectiveGeminiModel({ model: 'gemini-3.5-live-translate-preview' }, live)).toBe('gemini-3.5-live-translate-preview');
-    expect(effectiveGeminiModel({ model: 'gemini-1.0-retired' }, live)).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
+    expect(effectiveGeminiModel({ model: 'gemini-2.5-flash-native-audio-preview-12-2025' }, live)).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
+    expect(effectiveGeminiModel({ model: 'gemini-1.0-retired' }, live)).toBe('gemini-3.5-live-translate-preview');
     expect(effectiveGeminiModel({ model: 'gemini-3.1-flash-live-preview' }, [])).toBe('gemini-3.1-flash-live-preview');
   });
 });
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/gemini/settings.test.ts src/providers/gemini/config.test.ts src/providers/gemini/GeminiSettings.test.tsx src/providers/gemini/provider.test.ts`
Expected: FAIL — `3 failed | 1 passed (4)` files, `4 failed | 36 passed (40)` tests: the four cases that expect Live Translate get the 2.5 native-audio model.

- [ ] **Step 3: Prefer Live Translate, and keep the probe's dialogue run on a dialogue model.**

```diff
diff --git a/src/providers/gemini/settings.ts b/src/providers/gemini/settings.ts
--- a/src/providers/gemini/settings.ts
+++ b/src/providers/gemini/settings.ts
@@ -209,14 +209,17 @@ export function sortGeminiModels(ids: readonly string[]): string[] {
 }
 
 /**
- * A fresh profile's model (ruling 2): the newest `native-audio` dialogue
- * model; with none, the newest dialogue model; with none, the newest
- * model (Live Translate); with none, ''.
+ * A fresh profile's model: the newest Live Translate the check listed —
+ * simultaneous interpretation, the product's own scenario (Gemini/AST2
+ * follow-up, ruling 3); with none, the old rule (ruling 2): the newest
+ * `native-audio` dialogue model, else the newest model; with none, ''.
+ * Nothing is migrated: a saved model the check lists stays, and an unset
+ * one (''), or one no longer listed, resolves to this at use
+ * (`effectiveGeminiModel`).
  */
 export function defaultGeminiModel(models: readonly ModelOption[]): string {
   const newest = sortGeminiModels(models.map((m) => m.id));
-  const dialogue = newest.filter((id) => !isGeminiTranslateModel(id));
-  return dialogue.find((id) => id.includes('native-audio')) ?? dialogue[0] ?? newest[0] ?? '';
+  return newest.find(isGeminiTranslateModel) ?? newest.find((id) => id.includes('native-audio')) ?? newest[0] ?? '';
 }
 
 /**
```

```diff
diff --git a/scripts/dev/wire-probe/gemini.mts b/scripts/dev/wire-probe/gemini.mts
--- a/scripts/dev/wire-probe/gemini.mts
+++ b/scripts/dev/wire-probe/gemini.mts
@@ -259,7 +259,8 @@ if (step === 'overlap') {
 } else {
   const variant: Variant = { activityHandling: opt('activity-handling'), turnCoverage: opt('turn-coverage') };
   for (const kind of kinds as Array<'dialogue' | 'translate'>) {
-    const model = opt('model') ?? (kind === 'dialogue' ? defaultGeminiModel(listed.models) : ids.find((id) => isGeminiTranslateModel(id)));
+    // The app's default is Live Translate now (Gemini/AST2 follow-up, ruling 3): the dialogue run takes the default among the dialogue models.
+    const model = opt('model') ?? (kind === 'dialogue' ? defaultGeminiModel(listed.models.filter((m) => !isGeminiTranslateModel(m.id))) : ids.find((id) => isGeminiTranslateModel(id)));
     if (!model) { console.log(`No ${kind} model listed; skipped.`); continue; }
     await session(kind, model, variant);
   }
```

- [ ] **Step 4: Run the suites and check the probe's syntax.**

Run: `npx vitest run src/providers/gemini/settings.test.ts src/providers/gemini/config.test.ts src/providers/gemini/GeminiSettings.test.tsx src/providers/gemini/provider.test.ts`
Expected: PASS — 4 files, 40 tests.

Run: `npx esbuild scripts/dev/wire-probe/gemini.mts --format=esm --log-level=warning --outfile=/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/t4-impl/probe-check.js`
Expected: no output.

Why nothing else moves: the adapter, reconnect, wire and oracle suites build with `configFor(model)`, which saves the model it is given, over `SHARED.models`, which lists both; `check.test.ts` never asks for a default; outside `src/providers/gemini/`, `command grep -rln "buildGemini\|defaultGeminiModel\|effectiveGeminiModel" src` names only the old `src/services/` code, which has its own rule.

- [ ] **Step 5: The gates.** The suite and the typecheck gate.

- [ ] **Step 6: Commit.**

```bash
git add src/providers/gemini/settings.ts src/providers/gemini/settings.test.ts src/providers/gemini/config.test.ts src/providers/gemini/GeminiSettings.test.tsx src/providers/gemini/provider.test.ts scripts/dev/wire-probe/gemini.mts
```

```bash
git commit -q -F - -- src/providers/gemini/settings.ts src/providers/gemini/settings.test.ts src/providers/gemini/config.test.ts src/providers/gemini/GeminiSettings.test.tsx src/providers/gemini/provider.test.ts scripts/dev/wire-probe/gemini.mts <<'EOF'
feat(gemini): Live Translate is the default model when the key lists it

A fresh profile, or a saved model the check no longer lists, runs the
newest listed Live Translate, else the old rule's native-audio model.
Nothing is migrated: a saved model the check lists stays. The wire
probe's dialogue run picks among the dialogue models.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 5: Live Translate's release tail (Wave 1)

**Files:**
- Create: `src/providers/gemini/tail.ts`
- Modify: `src/providers/gemini/adapter.ts` (the constructor, `appendAudio`, `onContent`, `beginTurn`, `endTurn`, `appendText`, `reconnect`, `shutdown`; `:95-106, 123, 240-249, 320-364, 377-395, 457-469`)
- Test: `src/providers/gemini/tail.test.ts`, `src/providers/gemini/adapter.tail.test.ts` (both new), `src/providers/gemini/adapter.test.ts` (one case)

**Interfaces:**
- Consumes: `every`, `Clock` (`src/lib/contract/clock`), `SAMPLE_RATE`; the adapter's `live()`, `audioFrame`, `ACTIVITY_END`, `frame`.
- Produces: `src/providers/gemini/tail.ts` — `FRAME_MS` (100), `FRAME_SAMPLES` (2 400), `TAIL_QUIET_MS` (1 000), `TAIL_MAX_MS` (3 000), `type TailEnd = 'quiet' | 'cap' | 'press' | 'audio' | 'text'`, `interface TailSummary { reason: TailEnd; silenceMs: number; lastOutputMs: number | null; cancelled?: true }`, `class ReleaseTail { constructor(o: { clock: Pick<Clock, 'setTimeout' | 'now'>; send(pcm: Int16Array): void; ended(summary: TailSummary): void }); get running(): boolean; start(cancelled: boolean): void; output(): void; stop(reason: 'press' | 'audio' | 'text'): void; cancel(): void }`. Task 7 edits `adapter.ts` and `adapter.test.ts` after this task.

- [ ] **Step 1: Write the tail's failing tests** (ruling 4; choices 10, 12):

```ts
import { describe, it, expect } from 'vitest';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import { FRAME_MS, FRAME_SAMPLES, ReleaseTail, TAIL_MAX_MS, TAIL_QUIET_MS, type TailSummary } from './tail';

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

describe("Live Translate's release tail (Gemini/AST2 follow-up, ruling 4)", () => {
  it('works in 100 ms frames of 24 kHz silence, from one second of quiet capped at three', () => {
    expect([FRAME_MS, FRAME_SAMPLES, TAIL_QUIET_MS, TAIL_MAX_MS]).toEqual([100, 2_400, 1_000, 3_000]);
  });

  it('sends nothing at the release, then 100 ms of silence every 100 ms, and stops once the model has been quiet 1 s from the release', () => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(false);
    expect(shape()).toEqual([]);
    expect(t.running).toBe(true);
    clock.advance(1_000);
    expect(shape()).toEqual(frames(10));
    expect(ended).toEqual([]);
    clock.advance(FRAME_MS);
    expect(shape()).toHaveLength(10);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
    expect(t.running).toBe(false);
    expect(timers()).toBe(0);
  });

  it('keeps going while the model still transcribes, until it has been quiet 1 s — the probe: the last words about a second behind', () => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(false);
    for (const at of [900, 1_300]) {
      clock.advance(at - clock.now());
      t.output();
    }
    clock.advance(2_300 - clock.now());
    expect(ended).toEqual([]);
    clock.advance(FRAME_MS);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 2_300, lastOutputMs: 1_300 }]);
    expect(shape()).toEqual(frames(23));
    expect(timers()).toBe(0);
  });

  it('stops at 3 s after the release however long the model goes on', () => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(false);
    for (let at = 250; at <= 5_000; at += 250) {
      clock.advance(250);
      t.output();
    }
    expect(ended).toEqual([{ reason: 'cap', silenceMs: 3_000, lastOutputMs: 3_000 }]);
    expect(shape()).toEqual(frames(30));
    expect(timers()).toBe(0);
  });

  it.each(['press', 'audio', 'text'] as const)('%s ends it at once and says so; nothing more goes up', (reason) => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(false);
    clock.advance(350);
    t.stop(reason);
    expect(ended).toEqual([{ reason, silenceMs: 300, lastOutputMs: null }]);
    expect(t.running).toBe(false);
    clock.advance(5_000);
    expect(shape()).toEqual(frames(3));
    expect(timers()).toBe(0);
  });

  it("says a cancelled press's tail is one, and runs it the same", () => {
    const { t, clock, ended, shape } = tail();
    t.start(true);
    clock.advance(1_100);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null, cancelled: true }]);
    expect(shape()).toEqual(frames(10));
  });

  it('cancel ends it silently: no summary, no timer, nothing more sent', () => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(false);
    clock.advance(400);
    t.cancel();
    expect(t.running).toBe(false);
    clock.advance(5_000);
    expect(ended).toEqual([]);
    expect(shape()).toEqual(frames(4));
    expect(timers()).toBe(0);
    t.stop('press');
    expect(ended).toEqual([]);
  });

  it("ignores output while no tail runs: a release's quiet counts from the release", () => {
    const { t, clock, ended } = tail();
    t.output();
    clock.advance(500);
    t.start(false);
    clock.advance(1_100);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
  });

  it('a second release restarts the tail: the first ends silently, one timer runs', () => {
    const { t, clock, timers, ended } = tail();
    t.start(false);
    clock.advance(400);
    t.start(false);
    expect(timers()).toBe(1);
    clock.advance(1_100);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
  });

  it('counts beats, not clock.now() deltas: a timer firing late, or a wall clock stepped back, still ends after exactly 10 frames of quiet', () => {
    const { clock: base, timers } = trackedClock();
    let offset = 0;
    const clock = {
      now: () => base.now() - offset,
      advance: (ms: number) => base.advance(ms),
      setTimeout: (fn: () => void, ms: number) => base.setTimeout(fn, ms + 3),
    };
    const sent: Int16Array[] = [];
    const ended: TailSummary[] = [];
    const t = new ReleaseTail({ clock, send: (pcm) => sent.push(pcm), ended: (s) => ended.push(s) });
    t.start(false);
    clock.advance(500);
    offset = 3_600_000;
    clock.advance(60_000);
    expect(sent).toHaveLength(10);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
    expect(timers()).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/gemini/tail.test.ts`
Expected: FAIL — the file does not load: `Failed to resolve import "./tail"`.

- [ ] **Step 3: Write the tail** — OpenAI Translate's, copied, less its pad, its quiet counted by transcriptions alone (choices 10, 12):

```ts
/**
 * A push-to-talk release on Live Translate (Gemini/AST2 follow-up, ruling
 * 4). Live Translate runs about a second behind its input, and its model
 * time advances only with the audio it is sent: a release that just stops
 * sending leaves the press's last words untranslated until the next press
 * (the owner's probe). So a release keeps sending one 100 ms frame of
 * silence every 100 ms, in real time, until the model has been quiet — no
 * transcription of either side — for `TAIL_QUIET_MS`, and never past
 * `TAIL_MAX_MS` after the release. Quiet counts transcriptions only, where
 * Translate's tail counts its audio too: Live Translate's output is a
 * real-time stream, silence included, so its audio never stops and every
 * tail would run to the cap (Gemini/AST2 follow-up, choice 12). A press,
 * audio or typed text ends it at once. Audio cannot, under push-to-talk:
 * the runner sends audio only while the key is held, and that press has
 * ended the tail first; the reason stays for any other caller. The adapter
 * holds the press's `activityEnd` until the tail ends (Gemini/AST2
 * follow-up, choice 11). Pure: a clock and two callbacks — the adapter
 * sends and frames.
 *
 * Copied from OpenAI Translate's `tail.ts`, not lifted (Gemini/AST2
 * follow-up, choice 10): it is the second user, and the house rule lifts
 * at the third; this copy drops the pad to Translate's 200 ms engine grid,
 * which Gemini has none of, frames at 100 ms, and counts quiet by
 * transcriptions alone; and lifting would edit Translate's tail before its
 * live test. The beat counting is the same, for the same reasons.
 */
import { SAMPLE_RATE } from '../../lib/contract/adapter';
import { every, type Clock } from '../../lib/contract/clock';

/** One frame of the tail: the probe's own pace, which the server consumed. */
export const FRAME_MS = 100;
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;
/** How long the model must have been quiet before the tail stops: the ruling's second, which the owner's live test tunes. */
export const TAIL_QUIET_MS = 1_000;
/** The tail's cap, from the release: the ruling's three seconds, which the owner's live test tunes. */
export const TAIL_MAX_MS = 3_000;

export type TailEnd = 'quiet' | 'cap' | 'press' | 'audio' | 'text';

/** What one tail did, for the Logs (`turn.tail_end`): what the live test tunes the two constants by. */
export interface TailSummary {
  reason: TailEnd;
  /** The real-time silence sent. */
  silenceMs: number;
  /** The model's last transcription after the release, from the release; null when none came. */
  lastOutputMs: number | null;
  cancelled?: true;
}

export interface ReleaseTailOptions {
  clock: Pick<Clock, 'setTimeout' | 'now'>;
  /** Sends pcm up. */
  send(pcm: Int16Array): void;
  /** A tail ended by itself, or by a press, audio or typed text — never by `cancel`. */
  ended(summary: TailSummary): void;
}

/** One frame of silence, sent as it is (never written to). */
const SILENT_FRAME = new Int16Array(FRAME_SAMPLES);

interface Run {
  /** Kept only for the summary's `lastOutputMs`; the ends never read it. */
  releasedAt: number;
  lastOutputAt: number | null;
  /** Frames run so far, counted at the top of every tick — never `now() - releasedAt`: an on-time timer can read either side of its beat, and a wall clock stepped back would make it negative forever, as OpenAI Translate's tail found. */
  beats: number;
  /** The beat `output()` last landed on; 0 (the release itself) when none has. */
  lastOutputBeat: number;
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

  /** A release, with or without speech: silence in real time from the next beat. */
  start(cancelled: boolean): void {
    this.cancel();
    const run: Run = { releasedAt: this.o.clock.now(), lastOutputAt: null, beats: 0, lastOutputBeat: 0, frames: 0, cancelled, stop: () => {} };
    this.run = run;
    run.stop = every(this.o.clock, FRAME_MS, () => this.tick());
  }

  /** The model transcribed or translated: its quiet starts again. Ignored while no tail runs. */
  output(): void {
    if (this.run) {
      this.run.lastOutputAt = this.o.clock.now();
      this.run.lastOutputBeat = this.run.beats;
    }
  }

  /** A new press, audio or typed text: the tail ends now, and says so. */
  stop(reason: 'press' | 'audio' | 'text'): void {
    if (this.run) this.finish(reason);
  }

  /** The session ends, or its connection is lost: the tail stops and says nothing. */
  cancel(): void {
    const run = this.run;
    this.run = null;
    run?.stop();
  }

  private tick(): void {
    const run = this.run;
    if (!run) return;
    run.beats += 1;
    // Beats, not `clock.now()` deltas (see `Run.beats`): quiet first, then the cap.
    if (run.beats - run.lastOutputBeat > TAIL_QUIET_MS / FRAME_MS) {
      this.finish('quiet');
      return;
    }
    if (run.beats > TAIL_MAX_MS / FRAME_MS) {
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

- [ ] **Step 4: Run it.**

Run: `npx vitest run src/providers/gemini/tail.test.ts`
Expected: PASS — 1 file, 12 tests.

- [ ] **Step 5: Write the adapter's failing tests** (choices 11–13): a new suite, and the landed Live Translate cancel case, whose `activityEnd` now follows the tail.

```ts
/**
 * Live Translate under push-to-talk (Gemini/AST2 follow-up, ruling 4): a
 * release keeps its press's activity open and sends real-time silence
 * until the model has been quiet, then `activityEnd`. The owner's probe
 * showed why: the model runs about a second behind its input, and with
 * nothing sent between presses the last words of a press waited for the
 * next one. On `FakeSocket` and a virtual clock.
 */
import { describe, it, expect } from 'vitest';
import { flush } from '../../lib/contract/testing/drive';
import { FRAME_SAMPLES } from './tail';
import { AUTO_CTX, DIALOGUE, liveGemini, SERVER, TRANSLATE } from './testing';
import { base64ToPcm } from './wire';

const MANUAL = { ...AUTO_CTX, turns: 'manual' as const };
/** A capture chunk: 2 048 samples of 24 kHz voice. */
const chunk = () => new Int16Array(2_048).fill(1_000);

type Sent = { setup?: unknown; realtimeInput?: { audio?: { data: string }; activityStart?: object; activityEnd?: object; text?: string } };

/** What went up, by kind: `silence` for a tail frame, `audio` for anything else. */
function kinds(sent: Sent[]): string[] {
  return sent.map((f) => {
    if (f.setup) return 'setup';
    const input = f.realtimeInput!;
    if (input.audio) {
      const pcm = base64ToPcm(input.audio.data);
      return pcm.length === FRAME_SAMPLES && pcm.every((s) => s === 0) ? 'silence' : 'audio';
    }
    return Object.keys(input)[0];
  });
}
const times = (n: number, kind: string) => new Array<string>(n).fill(kind);

describe('Live Translate: the release tail (Gemini/AST2 follow-up, ruling 4)', () => {
  it("keeps the press's activity open through real-time silence until the model has been quiet 1 s, then ends it (Gemini/AST2 follow-up, choices 11, 12)", async () => {
    const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(kinds(h.sent() as Sent[])).toEqual(['setup', 'activityStart', 'audio']);
    expect(h.frames('turn.tail')).toEqual([undefined]);
    // The probe: the press's last words, transcribed about a second after the release, then translated.
    h.clock.advance(900);
    h.socket().receive(SERVER.input('します。'));
    h.clock.advance(400);
    h.socket().receive(SERVER.output(' here to help.'));
    h.clock.advance(1_000);
    expect(kinds(h.sent() as Sent[]).slice(-1)).toEqual(['silence']);
    expect(h.frames('turn.tail_end')).toEqual([]);
    h.clock.advance(100);
    expect(kinds(h.sent() as Sent[])).toEqual(['setup', 'activityStart', 'audio', ...times(23, 'silence'), 'activityEnd']);
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'quiet', silenceMs: 2_300, lastOutputMs: 1_300 }]);
    expect(h.frames('realtime_input.activity_end')).toEqual([undefined]);
    // Nothing more goes up; once the segments' own silence timers have run, no timer is left.
    h.clock.advance(5_000);
    expect(h.sent()).toHaveLength(27);
    expect(h.timers()).toBe(0);
  });

  it('stops at 3 s after the release, and ends the activity then', async () => {
    const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
    h.session.beginTurn();
    h.session.endTurn();
    for (let at = 250; at <= 4_000; at += 250) {
      h.clock.advance(250);
      h.socket().receive(SERVER.output(' more'));
    }
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'cap', silenceMs: 3_000, lastOutputMs: 3_000 }]);
    expect(kinds(h.sent() as Sent[]).filter((k) => k === 'activityEnd')).toHaveLength(1);
  });

  it("a press during the tail ends it: the last press's activityEnd, then the new activityStart", async () => {
    const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
    h.session.beginTurn();
    h.session.endTurn();
    h.clock.advance(300);
    h.session.beginTurn();
    expect(kinds(h.sent() as Sent[])).toEqual(['setup', 'activityStart', ...times(3, 'silence'), 'activityEnd', 'activityStart']);
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'press', silenceMs: 300, lastOutputMs: null }]);
    h.clock.advance(5_000);
    expect(kinds(h.sent() as Sent[])).toHaveLength(7);
  });

  it("a cancel runs the same tail, framed cancelled, and its activityEnd says so", async () => {
    const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
    h.session.beginTurn();
    h.session.cancelTurn();
    h.clock.advance(1_100);
    expect(h.frames('turn.tail')).toEqual([{ cancelled: true }]);
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null, cancelled: true }]);
    expect(h.frames('realtime_input.activity_end')).toEqual([{ cancelled: true }]);
  });

  it("typed text during the tail ends it first, so the text's own activity marks never nest in the press's", async () => {
    const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
    h.session.beginTurn();
    h.session.endTurn();
    h.clock.advance(200);
    h.session.appendText('hello');
    expect(kinds(h.sent() as Sent[])).toEqual(['setup', 'activityStart', 'silence', 'silence', 'activityEnd', 'activityStart', 'text', 'activityEnd']);
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'text', silenceMs: 200, lastOutputMs: null }]);
  });

  it('stop during the tail sends nothing more, says nothing, and leaves no timer', async () => {
    const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
    h.session.beginTurn();
    h.session.endTurn();
    h.clock.advance(200);
    const sent = h.sent().length;
    await h.session.stop();
    h.clock.advance(5_000);
    expect(h.socket().sent).toHaveLength(sent);
    expect(h.frames('turn.tail_end')).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a lost connection during the tail drops it silently: the new connection is sent no activityEnd', async () => {
    const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
    h.session.beginTurn();
    h.session.endTurn();
    h.clock.advance(200);
    h.socket().serverClose(1011, 'Internal error');
    await flush();
    h.socket().open();
    h.socket().receive(SERVER.setupComplete());
    await flush();
    h.clock.advance(5_000);
    expect(kinds(h.socket().sentJson<Sent>())).toEqual(['setup']);
    expect(h.frames('turn.tail_end')).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a dialogue model sends its activityEnd at once: its turn is answered whole, no tail (Gemini/AST2 follow-up, choice 13)', async () => {
    const h = await liveGemini({ model: DIALOGUE, context: MANUAL });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(kinds(h.sent() as Sent[])).toEqual(['setup', 'activityStart', 'audio', 'activityEnd']);
    h.clock.advance(5_000);
    expect(h.sent()).toHaveLength(4);
    expect(h.frames('turn.tail')).toEqual([]);
  });

  it('automatic turns never tail: the keys send nothing', async () => {
    const h = await liveGemini({ model: TRANSLATE });
    h.session.beginTurn();
    h.session.endTurn();
    h.clock.advance(5_000);
    expect(kinds(h.sent() as Sent[])).toEqual(['setup']);
    expect(h.timers()).toBe(0);
  });
});
```

```diff
diff --git a/src/providers/gemini/adapter.test.ts b/src/providers/gemini/adapter.test.ts
--- a/src/providers/gemini/adapter.test.ts
+++ b/src/providers/gemini/adapter.test.ts
@@ -481,15 +481,18 @@ describe('the Gemini adapter: turns and typed text', () => {
     expect(h.of('segmentOpened')).toHaveLength(1);
   });
 
-  it('on Live Translate a cancel is activityEnd alone: the streaming translation goes on in its segment (choice 16)', async () => {
+  it('on Live Translate a cancel drops nothing: the streaming translation goes on in its segment (choice 16), and its activityEnd follows the release tail (Gemini/AST2 follow-up, ruling 4)', async () => {
     const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
     h.session.beginTurn();
     h.socket().receive(SERVER.output('streaming'));
     h.session.cancelTurn();
     h.socket().receive(SERVER.output(' on'));
-    expect(h.sent().slice(1)).toEqual([{ realtimeInput: { activityStart: {} } }, { realtimeInput: { activityEnd: {} } }]);
+    expect(h.sent().slice(1)).toEqual([{ realtimeInput: { activityStart: {} } }]);
     expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['streaming', 'streaming on']);
     expect(h.of('segmentClosed')).toEqual([]);
+    h.clock.advance(1_100);
+    const sent = h.sent();
+    expect(sent[sent.length - 1]).toEqual({ realtimeInput: { activityEnd: {} } });
   });
 
   it('typed text: trimmed, its own source segment, sent as realtime text; under manual turns with no press held, wrapped in activity marks (choice 17)', async () => {
```

- [ ] **Step 6: Run them to see them fail.**

Run: `npx vitest run src/providers/gemini/tail.test.ts src/providers/gemini/adapter.tail.test.ts src/providers/gemini/adapter.test.ts`
Expected: FAIL — `2 failed | 1 passed (3)` files, `6 failed | 74 passed (80)` tests: the release sends `activityEnd` at once and no tail. The stop, lost-connection, dialogue and automatic cases pass already: they guard what must not change.

- [ ] **Step 7: Drive the tail from the adapter.**

```diff
diff --git a/src/providers/gemini/adapter.ts b/src/providers/gemini/adapter.ts
--- a/src/providers/gemini/adapter.ts
+++ b/src/providers/gemini/adapter.ts
@@ -7,6 +7,8 @@
  * resumed with the server's handle, or opened fresh when it issued none
  * (ruling 3). A start resolves once the server answers the setup, so a
  * refused key or model rejects it in words and within a bound (choice 12).
+ * A push-to-talk release on Live Translate sends a real-time silence tail
+ * before its `activityEnd` (`tail.ts`; Gemini/AST2 follow-up, ruling 4).
  * Every timer reads the request's clock, and nothing is said but through
  * events (CLAUDE.md, "Inside an IClient session").
  */
@@ -24,6 +26,7 @@ import { describeCause } from '../../lib/diagnostics/describeCause';
 import type { GeminiConfig } from './config';
 import type { GeminiCredentials } from './settings';
 import { nativeSocket, WS_OPEN, type OpenSocket } from './socket';
+import { ReleaseTail, type TailSummary } from './tail';
 import { GeminiTurns } from './turns';
 import {
   ACTIVITY_END,
@@ -95,6 +98,8 @@ class GeminiSession {
   /** Every pending connection attempt and every backoff of the ladder, so a stop ends them at once. */
   private readonly cancels = new Set<() => void>();
   private readonly turns: GeminiTurns;
+  /** Live Translate under manual turns: a release's silence, its press's activity held open until it ends (Gemini/AST2 follow-up, ruling 4; choice 11). */
+  private readonly tail: ReleaseTail;
 
   constructor(private readonly request: GeminiRequest, private readonly events: AdapterEvents, private readonly openSocket: OpenSocket) {
     this.turns = new GeminiTurns({
@@ -104,6 +109,11 @@ class GeminiSession {
       silence: request.config.silence,
       sink: events,
     });
+    this.tail = new ReleaseTail({
+      clock: request.clock,
+      send: (pcm) => this.live()?.send(audioFrame(pcm)),
+      ended: (summary) => this.tailEnded(summary),
+    });
   }
 
   /** Resolves once the server answers the setup; rejects, leaving nothing open, when it refuses, drops, does not answer in time, or the signal aborts. */
@@ -119,8 +129,11 @@ class GeminiSession {
   api(): AdapterSession {
     return {
       info: { transport: 'websocket' },
-      // No frame per chunk (the hot-path rule). Audio while no connection is set up is dropped (parity).
-      appendAudio: (pcm) => this.live()?.send(audioFrame(pcm)),
+      // No frame per chunk (the hot-path rule). Audio while no connection is set up is dropped (parity). Real audio ends a release's tail first.
+      appendAudio: (pcm) => {
+        this.tail.stop('audio');
+        this.live()?.send(audioFrame(pcm));
+      },
       appendText: (text) => this.appendText(text),
       beginTurn: () => this.beginTurn(),
       endTurn: () => this.endTurn(false),
@@ -240,12 +253,19 @@ class GeminiSession {
     const input = c.inputTranscription;
     if (input) {
       this.frame('in', 'server_content.input_transcription', transcriptionFrame(input));
-      if (input.text) this.turns.input(input.text);
+      if (input.text) {
+        this.turns.input(input.text);
+        // Either side's words mean the model is still working through the press (Gemini/AST2 follow-up, choice 12).
+        this.tail.output();
+      }
     }
     const output = c.outputTranscription;
     if (output) {
       this.frame('in', 'server_content.output_transcription', transcriptionFrame(output));
-      if (output.text) this.turns.output(output.text);
+      if (output.text) {
+        this.turns.output(output.text);
+        this.tail.output();
+      }
     }
     if (c.modelTurn?.parts) this.onModelTurn(c.modelTurn.parts);
     if (c.generationComplete) this.frame('in', 'server_content.generation_complete');
@@ -319,6 +339,8 @@ class GeminiSession {
 
   private beginTurn(): void {
     if (this.ended || !this.request.config.activity.manual || this.turnOpen) return;
+    // A release's tail still running ends first, and with it the last press's activity.
+    this.tail.stop('press');
     this.turnOpen = true;
     this.turns.beginTurn();
     const ws = this.live();
@@ -330,7 +352,9 @@ class GeminiSession {
   /**
    * A release: `activityEnd`, and the press's answer is owed from here, before its first output streams. A cancel
    * instead has `GeminiTurns` drop the cancelled press's own answer — never the one owed or still streaming, and
-   * nothing on Live Translate (ruling 8, choice 16).
+   * nothing on Live Translate (ruling 8, choice 16). On Live Translate, a release — a cancel too — first runs the
+   * tail, inside the press's activity, and `activityEnd` goes when it ends (Gemini/AST2 follow-up, ruling 4;
+   * choices 11, 12).
    */
   private endTurn(cancelled: boolean): void {
     if (this.ended || !this.request.config.activity.manual || !this.turnOpen) return;
@@ -340,6 +364,22 @@ class GeminiSession {
     // Owed only once `activityEnd` goes out: a release in a reconnect gap reaches no server, so nothing answers it.
     else if (ws) this.turns.endTurn();
     if (!ws) return;
+    if (this.request.config.kind === 'translate') {
+      this.tail.start(cancelled);
+      this.frame('out', 'turn.tail', cancelled ? { cancelled: true } : undefined);
+      return;
+    }
+    this.activityEnd(ws, cancelled);
+  }
+
+  /** The tail ended by itself, or by a press, audio or typed text: the press's activity ends now (Gemini/AST2 follow-up, choice 11). */
+  private tailEnded(summary: TailSummary): void {
+    this.frame('out', 'turn.tail_end', summary);
+    const ws = this.live();
+    if (ws) this.activityEnd(ws, summary.cancelled === true);
+  }
+
+  private activityEnd(ws: WebSocket, cancelled: boolean): void {
     ws.send(ACTIVITY_END);
     this.frame('out', 'realtime_input.activity_end', cancelled ? { cancelled: true } : undefined);
   }
@@ -349,6 +389,8 @@ class GeminiSession {
     const text = raw.trim();
     const ws = this.live();
     if (!text || !ws) return;
+    // A release's tail ends first, its activity with it, so the text's own marks never nest in it.
+    this.tail.stop('text');
     this.turns.typed(text);
     const wrap = this.request.config.activity.manual && !this.turnOpen;
     if (wrap) {
@@ -383,6 +425,8 @@ class GeminiSession {
       detach(old);
       old.close(1000);
     }
+    // The tail's activity was the old connection's: nothing of it reaches the new one.
+    this.tail.cancel();
     this.frame('in', 'session.reconnecting', {
       cause: why.cause,
       ...(why.code !== undefined ? { code: why.code } : {}),
@@ -459,6 +503,7 @@ class GeminiSession {
     this.ended = true;
     for (const cancel of [...this.cancels]) cancel();
     this.cancels.clear();
+    this.tail.cancel();
     this.turns.stop();
     const ws = this.socket;
     this.socket = null;
```

- [ ] **Step 8: Run the suites the change reaches.**

Run: `npx vitest run src/providers/gemini/tail.test.ts src/providers/gemini/adapter.tail.test.ts src/providers/gemini/adapter.test.ts src/providers/gemini/adapter.reconnect.test.ts src/providers/sessionSide.consistency.test.ts`
Expected: PASS — 5 files, 110 tests. The session-side guard now walks `tail.ts` too: it imports no store, no reporter, and times only through the clock it is handed. In Wave 1, Task 3 adds `karaoke.test.ts` beside these; it is not in this run.

- [ ] **Step 9: The gates.** The suite and the typecheck gate.

- [ ] **Step 10: Commit.**

```bash
git add src/providers/gemini/tail.ts src/providers/gemini/tail.test.ts src/providers/gemini/adapter.ts src/providers/gemini/adapter.tail.test.ts src/providers/gemini/adapter.test.ts
```

```bash
git commit -q -F - -- src/providers/gemini/tail.ts src/providers/gemini/tail.test.ts src/providers/gemini/adapter.ts src/providers/gemini/adapter.tail.test.ts src/providers/gemini/adapter.test.ts <<'EOF'
feat(gemini): a push-to-talk release on Live Translate sends a silence tail

Live Translate runs about a second behind its input and advances only
with the audio it is sent, so a press's last words waited for the next
press. A release now keeps the press's activity open and sends 100 ms of
silence every 100 ms until the model has been quiet 1 s, at most 3 s,
then activityEnd. A press, audio or typed text ends it first; a stop or
a lost connection drops it. OpenAI Translate's tail, copied less its pad;
quiet counts transcriptions only, since Live Translate's audio stream,
silence included, never stops.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 6: Doubao's whole-sentence karaoke, by the server's times (Wave 2)

**Files:**
- Modify: `src/providers/volcengine_ast2/segments.ts` (replaced whole), `src/providers/volcengine_ast2/speech.ts` (replaced whole), `src/providers/volcengine_ast2/adapter.ts` (the header, the import, the constructor, `subtitle`, `tts`, a `clip` method before `frame`; `:1-11, 26, 108, 252-270, 364`)
- Test: `src/providers/volcengine_ast2/segments.test.ts`, `src/providers/volcengine_ast2/speech.test.ts`, `src/providers/volcengine_ast2/adapter.test.ts`, `src/providers/volcengine_ast2/testing.ts`; Create: `src/providers/volcengine_ast2/karaoke.test.tsx`

**Interfaces:**
- Consumes: Task 1's `Ast2Segments` (the pieces); Task 2's L1 (an `audio` range after fill-in re-anchored, choice 19: the fill-in test below needs it); `Conversation` (with `punctuate`), `createProjector`, `DEFAULT_PROJECTION`, `displayItems`, `litFor`, `nextLit`, `clipKey`, `ConversationList`, `SubtitleBody`.
- Produces (all in `segments.ts` unless named): `interface ServerTimes { startTime: number; endTime: number }`; `interface Sentence { lock: Ref | undefined; times: ServerTimes }`; `interface Clip { ref: Ref; matched: boolean; range?: TextRange }`; `MATCH_WINDOW` (8); `SegmentSink` gains `'speechRanges'`; `Ast2Segments.subtitle(side, phase, text, times?: ServerTimes): Ref | null`; `Ast2Segments.sentence(times: ServerTimes): Sentence`; `Ast2Segments.clipFor(sentence: Sentence): Clip | undefined`; `speechRef()` unchanged. In `speech.ts`: `type ClipFor = (sentence: Sentence) => Clip | undefined`; `new Ast2Speech(decode, sink, clipFor?: ClipFor)` (by default the lock's ref, rangeless); `sentenceStart(sentence: Sentence)` (it took a `Ref`). In `adapter.ts`: the frame `tts.clip`. In `testing.ts`: `SERVER.ttsStart` and `SERVER.ttsEnd` take `{ startTime?, endTime? }` beside the meta.

- [ ] **Step 1: Write the failing tests** (ruling 1; choices 2–5). The segments' own cases, with the probe's times — the sentence taken at its start, its clip resolved at emission:

```diff
diff --git a/src/providers/volcengine_ast2/segments.test.ts b/src/providers/volcengine_ast2/segments.test.ts
--- a/src/providers/volcengine_ast2/segments.test.ts
+++ b/src/providers/volcengine_ast2/segments.test.ts
@@ -1,6 +1,6 @@
 import { describe, it, expect } from 'vitest';
 import { recordEvents } from '../../lib/contract/events';
-import { Ast2Segments } from './segments';
+import { Ast2Segments, MATCH_WINDOW } from './segments';
 
 const setup = () => {
   const { events, log } = recordEvents();
@@ -180,3 +180,121 @@ describe("Doubao's subtitles as segments", () => {
     expect(segments.speechRef()).toBe(1);
   });
 });
+
+describe("Doubao's spoken sentences, named by their server times (Gemini/AST2 follow-up, ruling 1)", () => {
+  /** The owner's probe (2026-09-28, zh → en): T2 and S2 both carry 1940–4500 ms. */
+  const T2 = { startTime: 1_940, endTime: 4_500 };
+  const TEXT = 'to help you speak more fluently. ';
+  const NONE = { startTime: 0, endTime: 0 };
+
+  it('names the translation whose times a sentence carries, and ranges its clip over the whole text once the End came first', () => {
+    const { segments, emitted } = setup();
+    segments.subtitle('translation', 'start', '', T2);
+    for (const piece of ['to', ' help', ' you', ' speak', ' more', ' flu', 'ently', '.', ' ']) segments.subtitle('translation', 'response', piece);
+    segments.subtitle('translation', 'end', TEXT, T2);
+    expect(segments.clipFor(segments.sentence(T2))).toEqual({ ref: 1, matched: true, range: [0, TEXT.length] });
+    expect(emitted().filter((e) => e.kind === 'speechRanges')).toEqual([]);
+  });
+
+  it('a clip emitted before its subtitle is final plays rangeless, and takes its range by speechRanges at the close (Gemini/AST2 follow-up, choice 4)', () => {
+    const { segments, emitted } = setup();
+    segments.subtitle('translation', 'start', '', T2);
+    for (const piece of ['to', ' help', ' you', ' speak', ' more', ' flu', 'ently']) segments.subtitle('translation', 'response', piece);
+    // The probe's S2 started at 8.72 s, before T2's End at 8.86 s.
+    expect(segments.clipFor(segments.sentence(T2))).toEqual({ ref: 1, matched: true });
+    segments.subtitle('translation', 'response', '.');
+    segments.subtitle('translation', 'response', ' ');
+    expect(emitted().filter((e) => e.kind === 'speechRanges')).toEqual([]);
+    segments.subtitle('translation', 'end', TEXT, T2);
+    expect(emitted().slice(-2)).toEqual([
+      { kind: 'segmentClosed', ref: 1 },
+      { kind: 'speechRanges', ref: 1, ranges: [{ index: 0, range: [0, TEXT.length] }] },
+    ]);
+  });
+
+  it('a segment whose End never came is final at the next Start, with the text it had', () => {
+    const { segments, emitted } = setup();
+    segments.subtitle('translation', 'start', '', T2);
+    segments.subtitle('translation', 'response', 'to help');
+    expect(segments.clipFor(segments.sentence(T2))).toEqual({ ref: 1, matched: true });
+    segments.subtitle('translation', 'start', '', { startTime: 4_500, endTime: 6_000 });
+    expect(emitted().filter((e) => e.kind === 'speechRanges')).toEqual([{ kind: 'speechRanges', ref: 1, ranges: [{ index: 0, range: [0, 7] }] }]);
+  });
+
+  it('keys by the times, not by which subtitle is open: a sentence arriving after the next translation started still voices its own (Gemini/AST2 follow-up, choice 2)', () => {
+    const { segments } = setup();
+    segments.subtitle('translation', 'start', '', T2);
+    segments.subtitle('translation', 'end', TEXT, T2);
+    segments.subtitle('translation', 'start', '', { startTime: 7_220, endTime: 8_500 });
+    // The lock says ref 2, the translation open now.
+    const sentence = segments.sentence(T2);
+    expect(sentence).toEqual({ lock: 2, times: T2 });
+    expect(segments.clipFor(sentence)).toEqual({ ref: 1, matched: true, range: [0, TEXT.length] });
+  });
+
+  it("matches the times as the clip is emitted: a sentence that started before its translation's Start still voices it (Gemini/AST2 follow-up, choice 2)", () => {
+    const { segments } = setup();
+    segments.subtitle('translation', 'start', '', { startTime: 20, endTime: 1_460 });
+    segments.subtitle('translation', 'end', 'Wing uses real-time translation ', { startTime: 20, endTime: 1_460 });
+    const sentence = segments.sentence(T2);
+    // At its start the times name nothing yet, and the lock is the previous translation.
+    expect(sentence.lock).toBe(1);
+    segments.subtitle('translation', 'start', '', T2);
+    segments.subtitle('translation', 'end', TEXT, T2);
+    expect(segments.clipFor(sentence)).toEqual({ ref: 2, matched: true, range: [0, TEXT.length] });
+  });
+
+  it('falls back to the lock, unmatched and rangeless, when the times name no recent translation or there are none', () => {
+    const { segments, emitted } = setup();
+    expect(segments.clipFor(segments.sentence(T2))).toBeUndefined();
+    segments.subtitle('translation', 'start', '', T2);
+    segments.subtitle('translation', 'response', 'Hi');
+    expect(segments.clipFor(segments.sentence({ startTime: 1, endTime: 2 }))).toEqual({ ref: 1, matched: false });
+    // A sentence with no times at all: the lock too.
+    expect(segments.clipFor(segments.sentence(NONE))).toEqual({ ref: 1, matched: false });
+    segments.subtitle('translation', 'end', 'Hi.', T2);
+    expect(emitted().filter((e) => e.kind === 'speechRanges')).toEqual([]);
+  });
+
+  it("ranges only the first clip to carry a translation's times; a second one, and a locked clip, play rangeless — each counted as its entry (Gemini/AST2 follow-up, choice 3)", () => {
+    const { segments, emitted } = setup();
+    segments.subtitle('translation', 'start', '', T2);
+    segments.subtitle('translation', 'response', 'to help');
+    // A clip the lock gave this ref first: entry 0.
+    expect(segments.clipFor(segments.sentence(NONE))).toEqual({ ref: 1, matched: false });
+    const first = segments.clipFor(segments.sentence(T2));
+    const second = segments.clipFor(segments.sentence(T2));
+    expect([first, second]).toEqual([{ ref: 1, matched: true }, { ref: 1, matched: false }]);
+    segments.subtitle('translation', 'end', 'to help.', T2);
+    // The matched clip was the ref's second audio: entry 1.
+    expect(emitted().filter((e) => e.kind === 'speechRanges')).toEqual([{ kind: 'speechRanges', ref: 1, ranges: [{ index: 1, range: [0, 8] }] }]);
+  });
+
+  it('never names a translation that was never shown: a false start leaves the list, and its sentence takes the lock', () => {
+    const { segments } = setup();
+    segments.subtitle('translation', 'start', '', { startTime: 100, endTime: 900 });
+    segments.subtitle('translation', 'end', 'Shown.', { startTime: 100, endTime: 900 });
+    segments.subtitle('translation', 'start', '', T2);
+    segments.subtitle('translation', 'end', '', T2);
+    expect(segments.clipFor(segments.sentence(T2))).toEqual({ ref: 1, matched: false });
+  });
+
+  it(`matches against the last ${MATCH_WINDOW} translations only`, () => {
+    const { segments } = setup();
+    const times = (k: number) => ({ startTime: k * 1_000, endTime: k * 1_000 + 900 });
+    for (let k = 1; k <= MATCH_WINDOW + 1; k++) {
+      segments.subtitle('translation', 'start', '', times(k));
+      segments.subtitle('translation', 'end', `Sentence ${k}.`, times(k));
+    }
+    // The first has left the list: its times fall to the lock, the last shown.
+    expect(segments.clipFor(segments.sentence(times(1)))).toEqual({ ref: MATCH_WINDOW + 1, matched: false });
+    expect(segments.clipFor(segments.sentence(times(2)))).toEqual({ ref: 2, matched: true, range: [0, 'Sentence 2.'.length] });
+  });
+
+  it('ignores the times of source subtitles', () => {
+    const { segments } = setup();
+    segments.subtitle('source', 'start', '', T2);
+    segments.subtitle('source', 'end', '希望这个声音能让交流变得轻松自然。', T2);
+    expect(segments.clipFor(segments.sentence(T2))).toBeUndefined();
+  });
+});
```

The speech's cases — a sentence is now given as a `Sentence`, and its clip's translation and range are asked for at emission; the fixtures' TTS frames carry times; the adapter's cases (the times matched after the decode among them), the conformance exchange ranged, and the landed frame expectations widened by the times and the new `tts.clip`:

```diff
diff --git a/src/providers/volcengine_ast2/adapter.test.ts b/src/providers/volcengine_ast2/adapter.test.ts
--- a/src/providers/volcengine_ast2/adapter.test.ts
+++ b/src/providers/volcengine_ast2/adapter.test.ts
@@ -42,10 +42,11 @@ function harness(): AdapterHarness<Ast2Config, Ast2Credentials> {
       reply(() => SERVER.subtitle('source', 'start')),
       reply(() => SERVER.subtitle('source', 'response', '你好')),
       reply(() => SERVER.subtitle('source', 'end', '你好。')),
-      reply(() => SERVER.subtitle('translation', 'start')),
+      // The translation's times on its Start and End, and its spoken sentence carrying them: the clip is ranged, so the kit checks the range (Gemini/AST2 follow-up, ruling 1).
+      reply(() => SERVER.subtitle('translation', 'start', '', { startTime: 20, endTime: 1_460 })),
       reply(() => SERVER.subtitle('translation', 'response', 'Hello')),
-      reply(() => SERVER.subtitle('translation', 'end', 'Hello.')),
-      reply(() => SERVER.ttsStart()),
+      reply(() => SERVER.subtitle('translation', 'end', 'Hello.', { startTime: 20, endTime: 1_460 })),
+      reply(() => SERVER.ttsStart({ startTime: 20, endTime: 1_460 })),
       reply(() => SERVER.ttsChunk(96)),
       reply(() => SERVER.ttsEnd()),
     ],
@@ -361,11 +362,13 @@ describe('the Doubao AST 2.0 adapter: what comes down', () => {
     h.socket().receive(SERVER.ttsEnd({ sequence: 5 }));
     await flush();
     expect(h.of('audio').map((e) => e.payload)).toEqual([{ pcm: new Int16Array(64), ref: 1 }]);
-    expect(h.frames('tts.sentence_start')).toEqual([{ ref: 1, sequence: 5 }]);
+    // No times in these frames: the lock gives the ref, and the clip stays rangeless (Gemini/AST2 follow-up, choice 2).
+    expect(h.frames('tts.sentence_start')).toEqual([{ ref: 1, startTime: 0, endTime: 0, sequence: 5 }]);
     expect(h.frames('tts.sentence_end')).toEqual([{ chunks: 2, bytes: 64, sequence: 5 }]);
-    // The hot-path rule: no frame per TTSResponse chunk, and none for a frame with no event.
+    expect(h.frames('tts.clip')).toEqual([{ ref: 1, matched: false, range: null }]);
+    // The hot-path rule: no frame per TTSResponse chunk, and none for a frame with no event; one per clip, as it goes to L1.
     expect(h.of('frame').filter((f) => f.payload.direction === 'in').map((f) => f.payload.type)).toEqual([
-      'session.started', 'subtitle.translation', 'tts.sentence_start', 'subtitle.translation', 'subtitle.translation', 'tts.sentence_end',
+      'session.started', 'subtitle.translation', 'tts.sentence_start', 'subtitle.translation', 'subtitle.translation', 'tts.sentence_end', 'tts.clip',
     ]);
   });
 
@@ -385,7 +388,7 @@ describe('the Doubao AST 2.0 adapter: what comes down', () => {
     h.socket().receive(SERVER.ttsEnd());
     await flush();
     fold();
-    expect(h.frames('tts.sentence_start')).toEqual([{ ref: 2, sequence: 0 }]);
+    expect(h.frames('tts.sentence_start')).toEqual([{ ref: 2, startTime: 0, endTime: 0, sequence: 0 }]);
     expect(h.of('audio').map((e) => e.payload.ref)).toEqual([2]);
     // L1 holds the clip until the segment opens.
     h.socket().receive(SERVER.subtitle('translation', 'response', 'How are you?'));
@@ -396,6 +399,99 @@ describe('the Doubao AST 2.0 adapter: what comes down', () => {
     expect(translations[1].speech[0].pcm).toHaveLength(64);
   });
 
+  it("voices each translation by the server times its sentence carries: the clip spans the whole final subtitle, stated (Gemini/AST2 follow-up, ruling 1)", async () => {
+    const waiting: Array<() => void> = [];
+    const decode: OggDecoder = (ogg) => new Promise((resolve) => { waiting.push(() => resolve(new Int16Array(ogg.length))); });
+    const h = await liveAst2({ decode });
+    const conv = new Conversation({ leg: 'speaker', session: 'ast2', languages: AUTO_CTX.direction, clock: h.clock });
+    let folded = 0;
+    const fold = () => {
+      for (const e of h.log.slice(folded)) if (e.kind !== 'frame') conv.apply(e);
+      folded = h.log.length;
+    };
+    // The owner's probe, zh → en: T1 ends before S1 starts.
+    const T1 = { startTime: 20, endTime: 1_460 };
+    h.socket().receive(SERVER.subtitle('translation', 'start', '', T1));
+    for (const piece of ['W', 'ing', ' uses', ' real', '-time', ' translation', ' ']) h.socket().receive(SERVER.subtitle('translation', 'response', piece));
+    h.socket().receive(SERVER.subtitle('translation', 'end', 'Wing uses real-time translation ', T1));
+    h.socket().receive(SERVER.ttsStart(T1));
+    h.socket().receive(SERVER.ttsChunk(40));
+    h.socket().receive(SERVER.ttsEnd(T1));
+    // S2 starts, and here its clip decodes, before T2 ends (the probe: S2 at 8.72 s, T2's End at 8.86 s).
+    const T2 = { startTime: 1_940, endTime: 4_500 };
+    h.socket().receive(SERVER.subtitle('translation', 'start', '', T2));
+    for (const piece of ['to', ' help', ' you', ' speak', ' more', ' flu', 'ently']) h.socket().receive(SERVER.subtitle('translation', 'response', piece));
+    h.socket().receive(SERVER.ttsStart(T2));
+    h.socket().receive(SERVER.ttsChunk(24));
+    h.socket().receive(SERVER.ttsEnd(T2));
+    await flush();
+    waiting[0]();
+    await flush();
+    waiting[1]();
+    await flush();
+    fold();
+    expect(h.of('audio').map((e) => e.payload)).toEqual([
+      { pcm: new Int16Array(40), ref: 1, range: [0, 32] },
+      // Its text is not final yet: rangeless for now.
+      { pcm: new Int16Array(24), ref: 2 },
+    ]);
+    expect(h.of('speechRanges')).toEqual([]);
+    h.socket().receive(SERVER.subtitle('translation', 'response', '.'));
+    h.socket().receive(SERVER.subtitle('translation', 'response', ' '));
+    h.socket().receive(SERVER.subtitle('translation', 'end', 'to help you speak more fluently. ', T2));
+    fold();
+    expect(h.of('speechRanges').map((e) => e.payload)).toEqual([{ ref: 2, ranges: [{ index: 0, range: [0, 33] }] }]);
+    // The lock at each start, and the times the clip was matched by as it went to L1.
+    expect(h.frames('tts.sentence_start')).toEqual([
+      { ref: 1, ...T1, sequence: 0 },
+      { ref: 2, ...T2, sequence: 0 },
+    ]);
+    expect(h.frames('tts.clip')).toEqual([
+      { ref: 1, matched: true, range: [0, 32] },
+      { ref: 2, matched: true, range: null },
+    ]);
+    // L1 holds both ranges against the texts it shows.
+    const translations = conv.snapshot().segments.filter((s) => s.side === 'translation');
+    expect(translations.map((s) => [s.text, s.speech.map((x) => x.range)])).toEqual([
+      ['Wing uses real-time translation ', [[0, 32]]],
+      ['to help you speak more fluently. ', [[0, 33]]],
+    ]);
+  });
+
+  it('a sentence whose times name no recent translation plays rangeless on the lock, as before', async () => {
+    const h = await liveAst2();
+    h.socket().receive(SERVER.subtitle('translation', 'start', '', { startTime: 20, endTime: 1_460 }));
+    h.socket().receive(SERVER.subtitle('translation', 'end', 'Hello.', { startTime: 20, endTime: 1_460 }));
+    h.socket().receive(SERVER.ttsStart({ startTime: 9_192, endTime: 11_912 }));
+    h.socket().receive(SERVER.ttsChunk(16));
+    h.socket().receive(SERVER.ttsEnd({ startTime: 9_192, endTime: 11_912 }));
+    await flush();
+    expect(h.of('audio').map((e) => e.payload)).toEqual([{ pcm: new Int16Array(16), ref: 1 }]);
+    expect(h.frames('tts.sentence_start')).toEqual([{ ref: 1, startTime: 9_192, endTime: 11_912, sequence: 0 }]);
+    expect(h.frames('tts.clip')).toEqual([{ ref: 1, matched: false, range: null }]);
+    expect(h.of('speechRanges')).toEqual([]);
+  });
+
+  it("matches a sentence's times as its clip goes to L1: a sentence that started before its translation's Start voices that translation, not the lock's (Gemini/AST2 follow-up, choice 2)", async () => {
+    const waiting: Array<() => void> = [];
+    const decode: OggDecoder = (ogg) => new Promise((resolve) => { waiting.push(() => resolve(new Int16Array(ogg.length))); });
+    const h = await liveAst2({ decode });
+    h.socket().receive(SERVER.subtitle('translation', 'start', '', { startTime: 20, endTime: 1_460 }));
+    h.socket().receive(SERVER.subtitle('translation', 'end', 'Hello.', { startTime: 20, endTime: 1_460 }));
+    const T2 = { startTime: 1_940, endTime: 4_500 };
+    h.socket().receive(SERVER.ttsStart(T2));
+    h.socket().receive(SERVER.ttsChunk(24));
+    h.socket().receive(SERVER.ttsEnd(T2));
+    // Its translation starts, and ends, while the clip decodes.
+    h.socket().receive(SERVER.subtitle('translation', 'start', '', T2));
+    h.socket().receive(SERVER.subtitle('translation', 'end', 'How are you?', T2));
+    await flush();
+    waiting[0]();
+    await flush();
+    expect(h.frames('tts.sentence_start')).toEqual([{ ref: 1, ...T2, sequence: 0 }]);
+    expect(h.of('audio').map((e) => e.payload)).toEqual([{ pcm: new Int16Array(24), ref: 2, range: [0, 12] }]);
+  });
+
   it('keeps the order and the refs of two sentences whose decodes overlap, and flushes what TTSEnded leaves', async () => {
     const waiting: Array<() => void> = [];
     const decode: OggDecoder = (ogg) => new Promise((resolve) => { waiting.push(() => resolve(new Int16Array(ogg.length))); });
diff --git a/src/providers/volcengine_ast2/speech.test.ts b/src/providers/volcengine_ast2/speech.test.ts
--- a/src/providers/volcengine_ast2/speech.test.ts
+++ b/src/providers/volcengine_ast2/speech.test.ts
@@ -1,7 +1,9 @@
 import { describe, it, expect, vi } from 'vitest';
 import { flush } from '../../lib/contract/testing/drive';
 import { recordEvents } from '../../lib/contract/events';
-import { Ast2Speech, type OggDecoder } from './speech';
+import type { TextRange } from '../../lib/contract/adapter';
+import type { Clip, Sentence } from './segments';
+import { Ast2Speech, type ClipFor, type OggDecoder } from './speech';
 
 /** A decoder whose answers the test releases one by one: a clip's pcm has one sample per byte. */
 function heldDecoder() {
@@ -12,16 +14,21 @@ function heldDecoder() {
   return { decode, waiting };
 }
 
-const setup = (decode: OggDecoder) => {
+const NO_TIMES = { startTime: 0, endTime: 0 };
+
+/** A sentence whose times name nothing: the lock gives its translation. */
+const lock = (ref: number | undefined): Sentence => ({ lock: ref, times: NO_TIMES });
+
+const setup = (decode: OggDecoder, clipFor?: ClipFor) => {
   const { events, log } = recordEvents();
-  return { speech: new Ast2Speech(decode, events), log, audio: () => log.filter((e) => e.kind === 'audio').map((e) => e.payload as { pcm: Int16Array; ref?: number }) };
+  return { speech: new Ast2Speech(decode, events, clipFor), log, audio: () => log.filter((e) => e.kind === 'audio').map((e) => e.payload as { pcm: Int16Array; ref?: number; range?: TextRange }) };
 };
 
 describe("Doubao's spoken sentences (ruling 10)", () => {
   it('decodes the chunks of one sentence as one clip, emitted rangeless on the ref locked at its start', async () => {
     const decode = vi.fn(async (clip: Uint8Array) => new Int16Array(clip.length));
     const { speech, audio } = setup(decode);
-    speech.sentenceStart(2);
+    speech.sentenceStart(lock(2));
     speech.chunk(new Uint8Array([1, 1]));
     speech.chunk(new Uint8Array([2, 2, 2]));
     expect(speech.flush()).toEqual({ chunks: 2, bytes: 5 });
@@ -35,7 +42,7 @@ describe("Doubao's spoken sentences (ruling 10)", () => {
     const decode = vi.fn(async (clip: Uint8Array) => new Int16Array(clip.length));
     const { speech } = setup(decode);
     const buffer = new Uint8Array([9, 9, 9, 9]);
-    speech.sentenceStart(1);
+    speech.sentenceStart(lock(1));
     speech.chunk(buffer.subarray(0, 2));
     buffer.fill(0);
     speech.flush();
@@ -46,10 +53,10 @@ describe("Doubao's spoken sentences (ruling 10)", () => {
   it('keeps the first sentence on its own ref when the next one starts during its decode, and keeps the order', async () => {
     const { decode, waiting } = heldDecoder();
     const { speech, audio } = setup(decode);
-    speech.sentenceStart(2);
+    speech.sentenceStart(lock(2));
     speech.chunk(new Uint8Array([2]));
     speech.flush();
-    speech.sentenceStart(4);
+    speech.sentenceStart(lock(4));
     speech.chunk(new Uint8Array([4, 4]));
     speech.flush();
     await flush();
@@ -66,9 +73,9 @@ describe("Doubao's spoken sentences (ruling 10)", () => {
   it('flushes a sentence left unended when the next one starts, on its own ref', async () => {
     const decode = vi.fn(async (clip: Uint8Array) => new Int16Array(clip.length));
     const { speech, audio } = setup(decode);
-    speech.sentenceStart(1);
+    speech.sentenceStart(lock(1));
     speech.chunk(new Uint8Array([1]));
-    speech.sentenceStart(3);
+    speech.sentenceStart(lock(3));
     speech.chunk(new Uint8Array([3, 3]));
     speech.flush();
     await flush();
@@ -78,7 +85,7 @@ describe("Doubao's spoken sentences (ruling 10)", () => {
   it('plays a sentence with no translation yet with no ref, and decodes nothing for an empty one', async () => {
     const decode = vi.fn(async (clip: Uint8Array) => new Int16Array(clip.length));
     const { speech, audio } = setup(decode);
-    speech.sentenceStart(undefined);
+    speech.sentenceStart(lock(undefined));
     speech.chunk(new Uint8Array([1]));
     speech.flush();
     expect(speech.flush()).toEqual({ chunks: 0, bytes: 0 });
@@ -90,10 +97,10 @@ describe("Doubao's spoken sentences (ruling 10)", () => {
   it("says tts_degraded when a clip will not decode, and goes on with the next (reason 'tts_decode')", async () => {
     const { decode, waiting } = heldDecoder();
     const { speech, log, audio } = setup(decode);
-    speech.sentenceStart(1);
+    speech.sentenceStart(lock(1));
     speech.chunk(new Uint8Array([1]));
     speech.flush();
-    speech.sentenceStart(3);
+    speech.sentenceStart(lock(3));
     speech.chunk(new Uint8Array([3]));
     speech.flush();
     await flush();
@@ -109,7 +116,7 @@ describe("Doubao's spoken sentences (ruling 10)", () => {
   it('emits nothing after stop, a decode still running included', async () => {
     const { decode, waiting } = heldDecoder();
     const { speech, log } = setup(decode);
-    speech.sentenceStart(1);
+    speech.sentenceStart(lock(1));
     speech.chunk(new Uint8Array([1]));
     speech.flush();
     await flush();
@@ -126,7 +133,7 @@ describe("Doubao's spoken sentences (ruling 10)", () => {
   it('says nothing after stop when a decode still running fails', async () => {
     const { decode, waiting } = heldDecoder();
     const { speech, log } = setup(decode);
-    speech.sentenceStart(1);
+    speech.sentenceStart(lock(1));
     speech.chunk(new Uint8Array([1]));
     speech.flush();
     await flush();
@@ -137,20 +144,71 @@ describe("Doubao's spoken sentences (ruling 10)", () => {
     expect(log).toEqual([]);
   });
 
+  it("asks for the clip's translation and range as it is emitted, after its decode, never at the sentence start (Gemini/AST2 follow-up, choices 2, 4)", async () => {
+    const { decode, waiting } = heldDecoder();
+    let final = false;
+    const clipFor = vi.fn((): Clip => (final ? { ref: 2, matched: true, range: [0, 12] } : { ref: 2, matched: true }));
+    const { speech, audio } = setup(decode, clipFor);
+    const sentence: Sentence = { lock: 1, times: { startTime: 1_940, endTime: 4_500 } };
+    speech.sentenceStart(sentence);
+    speech.chunk(new Uint8Array([2]));
+    speech.flush();
+    await flush();
+    expect(clipFor).not.toHaveBeenCalled();
+    // The subtitle the times name became final while the clip was decoding.
+    final = true;
+    waiting[0].release();
+    await flush();
+    expect(clipFor).toHaveBeenCalledWith(sentence);
+    expect(audio()).toEqual([{ pcm: new Int16Array(1).fill(2), ref: 2, range: [0, 12] }]);
+  });
+
+  it('emits a clip with no sentence, or none given a translation, without a ref, and one given no range with its ref alone', async () => {
+    const decode = vi.fn(async (clip: Uint8Array) => new Int16Array(clip.length));
+    const clipFor = vi.fn((sentence: Sentence): Clip | undefined => (sentence.lock === undefined ? undefined : { ref: sentence.lock, matched: false }));
+    const { speech, audio } = setup(decode, clipFor);
+    // Chunks before any sentence started: no question to ask.
+    speech.chunk(new Uint8Array([1]));
+    speech.sentenceStart(lock(3));
+    speech.chunk(new Uint8Array([3]));
+    speech.sentenceStart(lock(undefined));
+    speech.chunk(new Uint8Array([5]));
+    speech.flush();
+    await flush();
+    expect(clipFor).toHaveBeenCalledTimes(2);
+    expect(audio()).toEqual([{ pcm: new Int16Array(1) }, { pcm: new Int16Array(1), ref: 3 }, { pcm: new Int16Array(1) }]);
+    expect(audio()[1]).not.toHaveProperty('range');
+  });
+
+  it('asks nothing for a clip the stop dropped', async () => {
+    const { decode, waiting } = heldDecoder();
+    const clipFor = vi.fn((): Clip => ({ ref: 1, matched: true, range: [0, 1] }));
+    const { speech, log } = setup(decode, clipFor);
+    speech.sentenceStart({ lock: 1, times: { startTime: 20, endTime: 1_460 } });
+    speech.chunk(new Uint8Array([1]));
+    speech.flush();
+    await flush();
+    speech.stop();
+    waiting[0].release();
+    await flush();
+    expect(clipFor).not.toHaveBeenCalled();
+    expect(log).toEqual([]);
+  });
+
   it('decodes no clip once stopped: neither one still waiting nor one fed after', async () => {
     const { decode, waiting } = heldDecoder();
     const { speech, log } = setup(decode);
-    speech.sentenceStart(1);
+    speech.sentenceStart(lock(1));
     speech.chunk(new Uint8Array([1]));
     speech.flush();
-    speech.sentenceStart(3);
+    speech.sentenceStart(lock(3));
     speech.chunk(new Uint8Array([3]));
     speech.flush();
     await flush();
     // The first is decoding; the second waits behind it.
     expect(waiting).toHaveLength(1);
     speech.stop();
-    speech.sentenceStart(5);
+    speech.sentenceStart(lock(5));
     speech.chunk(new Uint8Array([5]));
     expect(speech.flush()).toEqual({ chunks: 0, bytes: 0 });
     waiting[0].release();
diff --git a/src/providers/volcengine_ast2/testing.ts b/src/providers/volcengine_ast2/testing.ts
--- a/src/providers/volcengine_ast2/testing.ts
+++ b/src/providers/volcengine_ast2/testing.ts
@@ -58,6 +58,8 @@ export function serverFrame(r: proto.speech.ast.ITranslateResponse): ArrayBuffer
 }
 
 type Meta = { session?: string; sequence?: number; status?: number; message?: string };
+/** A frame's server times, as a subtitle's `Start` and `End` and a TTS sentence's `Start` and `End` carry them (the owner's probe, 2026-09-28). */
+type Times = { startTime?: number; endTime?: number };
 const meta = (m: Meta = {}) => ({ SessionID: m.session ?? SESSION_ID, Sequence: m.sequence ?? 0, StatusCode: m.status ?? OK_STATUS, ...(m.message ? { Message: m.message } : {}) });
 const SUBTITLE = {
   source: { start: EventType.SourceSubtitleStart, response: EventType.SourceSubtitleResponse, end: EventType.SourceSubtitleEnd },
@@ -67,11 +69,11 @@ const SUBTITLE = {
 /** The server frames the suites send, by name. */
 export const SERVER = {
   started: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.SessionStarted }),
-  subtitle: (side: 'source' | 'translation', phase: 'start' | 'response' | 'end', text = '', m?: Meta & { startTime?: number; endTime?: number }) =>
+  subtitle: (side: 'source' | 'translation', phase: 'start' | 'response' | 'end', text = '', m?: Meta & Times) =>
     serverFrame({ responseMeta: meta(m), event: SUBTITLE[side][phase], text, startTime: m?.startTime ?? 0, endTime: m?.endTime ?? 0 }),
-  ttsStart: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSSentenceStart }),
+  ttsStart: (m?: Meta & Times) => serverFrame({ responseMeta: meta(m), event: EventType.TTSSentenceStart, startTime: m?.startTime ?? 0, endTime: m?.endTime ?? 0 }),
   ttsChunk: (bytes = 64, fill = 7, m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSResponse, data: new Uint8Array(bytes).fill(fill) }),
-  ttsEnd: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSSentenceEnd }),
+  ttsEnd: (m?: Meta & Times) => serverFrame({ responseMeta: meta(m), event: EventType.TTSSentenceEnd, startTime: m?.startTime ?? 0, endTime: m?.endTime ?? 0 }),
   ttsEnded: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSEnded }),
   /** A refusal: a status other than OK, on any event. */
   status: (status: number, message: string, event = EventType.None) => serverFrame({ responseMeta: meta({ status, message }), event }),
```

And the display cut by sentences, end to end (choice 5), with the punctuation fill-in landing before the clip and after it (choice 19):

```tsx
/**
 * Doubao's karaoke, end to end, with the display cut by sentences
 * (Gemini/AST2 follow-up, ruling 1): the adapter ranges a spoken
 * sentence's clip over its whole translation once that text is final; L1
 * holds the range; the view lights the segment's characters `[0, upTo)`;
 * and each row the sentence cut draws lights its own slice of them — in
 * the panel's list and in the subtitle's bands alike. The cut by sentences
 * is also when L1's punctuation fill-in runs: a translation that closes
 * without a sentence end is filled in, before its clip arrives or after,
 * and the range still reaches its last character (choice 19).
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
  }),
}));

import { ConversationList } from '../../components/Conversation/ConversationList';
import { SubtitleBody } from '../../components/Subtitle/SubtitleBands';
import { clipKey } from '../../lib/audio/playback';
import { flush } from '../../lib/contract/testing/drive';
import { Conversation } from '../../lib/conversation/Conversation';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import { displayItems, type LegFilters } from '../../lib/view/filter';
import { litFor, nextLit } from '../../lib/view/karaoke';
import { AUTO_CTX, liveAst2, SERVER } from './testing';

const TIMES = { startTime: 20, endTime: 3_460 };
const TEXT = 'Welcome to real-time translation. I will help.';
const PIECES = ['Welcome', ' to', ' real', '-time', ' translation', '.', ' I', ' will', ' help', '.'];
const TRANSLATION_ONLY: LegFilters = { speaker: 'translation', participant: 'none' };
/** The clip's duration as the queue would schedule it, and the moment karaoke is sampled: 80 % in. */
const CLIP_MS = 2_000;
const AT_MS = 1_600;

async function spokenTranslation() {
  const h = await liveAst2();
  const conv = new Conversation({ leg: 'speaker', session: 'ast2', languages: AUTO_CTX.direction, clock: h.clock });
  let folded = 0;
  const fold = () => {
    for (const e of h.log.slice(folded)) if (e.kind !== 'frame') conv.apply(e);
    folded = h.log.length;
  };
  h.socket().receive(SERVER.subtitle('translation', 'start', '', TIMES));
  for (const piece of PIECES.slice(0, 5)) h.socket().receive(SERVER.subtitle('translation', 'response', piece));
  // The sentence starts, and its clip decodes, before the subtitle's End: its text may still change.
  h.socket().receive(SERVER.ttsStart(TIMES));
  h.socket().receive(SERVER.ttsChunk(48));
  h.socket().receive(SERVER.ttsEnd(TIMES));
  await flush();
  fold();
  const playing = { key: clipKey('speaker', 1, 0), t: AT_MS, ms: CLIP_MS };
  const before = litFor(playing, [conv.snapshot()]);
  for (const piece of PIECES.slice(5)) h.socket().receive(SERVER.subtitle('translation', 'response', piece));
  h.socket().receive(SERVER.subtitle('translation', 'end', TEXT, TIMES));
  fold();
  return { conv, before, lit: litFor(playing, [conv.snapshot()]) };
}

describe("Doubao's karaoke with the display cut by sentences (Gemini/AST2 follow-up, ruling 1)", () => {
  it('lights nothing while the subtitle is open, then the whole segment by the clip\'s progress once it is final', async () => {
    const { conv, before, lit } = await spokenTranslation();
    expect(before).toBeNull();
    const [segment] = conv.snapshot().segments;
    expect(segment.speech.map((s) => s.range)).toEqual([[0, TEXT.length]]);
    // 80 % of a clip spanning 46 characters: [0, 37).
    expect(lit).toEqual({ segmentId: segment.id, leg: 'speaker', upTo: 37 });
  });

  it("cuts the segment into one row per sentence, each lighting its own slice: the first passed, the second up to the boundary", async () => {
    const { conv, lit } = await spokenTranslation();
    const entries = createProjector().project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 });
    const items = displayItems(entries, TRANSLATION_ONLY);
    const rows = items.flatMap((item) => (item.kind === 'row' ? [item.row] : []));
    expect(rows.map((r) => [r.start, r.end, r.text])).toEqual([
      [0, 33, 'Welcome to real-time translation.'],
      [33, 46, ' I will help.'],
    ]);

    const litMap = new Map([[lit!.segmentId, lit!.upTo]]);
    const list = render(
      <ConversationList items={items} lit={litMap} replaying={null} replayLegs={new Set()} canReplay={() => false} onReplay={() => {}} compact={false} fontSize={14} empty={null} />,
    );
    const bodies = [...list.container.querySelectorAll('.row-body')];
    expect(bodies.map((b) => b.querySelector('.karaoke-played')?.textContent)).toEqual(['Welcome to real-time translation.', 'I w']);
    expect(bodies.map((b) => b.classList.contains('playing'))).toEqual([false, true]);
    list.unmount();

    const bands = render(<SubtitleBody entries={entries} lit={litMap} compact fontSize={14} filters={TRANSLATION_ONLY} newItemHighlightEnabled={false} />);
    expect([...bands.container.querySelectorAll('.karaoke-played')].map((e) => e.textContent)).toEqual(['Welcome to real-time translation.', ' I w']);
  });
});

describe("Doubao's karaoke with the punctuation fill-in, in the display cut by sentences (Gemini/AST2 follow-up, choice 19)", () => {
  /** ja → zh: a translation that closes without a sentence end, as three of the probe's eight did; the fill-in adds a comma and a full stop. */
  const CJK_TIMES = { startTime: 3_272, endTime: 6_312 };
  const SUBTITLE = '我来帮你翻译';
  const FILLED = '我来帮你，翻译。';
  const JA_ZH = { source: 'ja', target: 'zh' };

  /** The fill-in lands before the clip is emitted, or after it: the clip is ranged at its emission either way, its subtitle having closed first. */
  async function filledIn(order: 'before' | 'after') {
    const h = await liveAst2({ context: { ...AUTO_CTX, direction: JA_ZH } });
    let land = () => {};
    const punctuate = vi.fn((_lang: string, text: string) => new Promise<string | null>((resolve) => { land = () => resolve(text === SUBTITLE ? FILLED : null); }));
    const conv = new Conversation({ leg: 'speaker', session: 'ast2', languages: JA_ZH, clock: h.clock, punctuate });
    let folded = 0;
    const fold = () => {
      for (const e of h.log.slice(folded)) if (e.kind !== 'frame') conv.apply(e);
      folded = h.log.length;
    };
    h.socket().receive(SERVER.subtitle('translation', 'start', '', CJK_TIMES));
    for (const piece of ['我', '来', '帮', '你', '翻译']) h.socket().receive(SERVER.subtitle('translation', 'response', piece));
    h.socket().receive(SERVER.subtitle('translation', 'end', SUBTITLE, CJK_TIMES));
    fold();
    if (order === 'before') {
      land();
      await conv.settled();
    }
    h.socket().receive(SERVER.ttsStart(CJK_TIMES));
    h.socket().receive(SERVER.ttsChunk(48));
    h.socket().receive(SERVER.ttsEnd(CJK_TIMES));
    await flush();
    fold();
    // The adapter measures against the text it sent.
    expect(h.of('audio').map((e) => e.payload.range)).toEqual([[0, SUBTITLE.length]]);
    if (order === 'after') {
      land();
      await conv.settled();
    }
    return { conv, punctuate };
  }

  it.each(['before', 'after'] as const)('the fill-in landing %s the clip: the range spans the filled text, the row lights to its last character, and the hold lets go', async (order) => {
    const { conv, punctuate } = await filledIn(order);
    expect(punctuate).toHaveBeenCalledWith('zh', SUBTITLE);
    const legs = [conv.snapshot()];
    const [segment] = legs[0].segments;
    expect(segment.text).toBe(FILLED);
    expect(segment.speech.map((s) => s.range)).toEqual([[0, FILLED.length]]);

    const key = clipKey('speaker', segment.ref, 0);
    const lit = litFor({ key, t: AT_MS, ms: CLIP_MS }, legs);
    // 80 % of a clip spanning 8 characters: [0, 6).
    expect(lit).toEqual({ segmentId: segment.id, leg: 'speaker', upTo: 6 });
    const entries = createProjector().project(legs, { ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 });
    const items = displayItems(entries, TRANSLATION_ONLY);
    expect(items.flatMap((item) => (item.kind === 'row' ? [[item.row.start, item.row.end, item.row.text]] : []))).toEqual([[0, 8, FILLED]]);
    const litMap = new Map([[lit!.segmentId, lit!.upTo]]);
    const list = render(
      <ConversationList items={items} lit={litMap} replaying={null} replayLegs={new Set()} canReplay={() => false} onReplay={() => {}} compact={false} fontSize={14} empty={null} />,
    );
    expect([...list.container.querySelectorAll('.row-body')].map((b) => [b.querySelector('.karaoke-played')?.textContent, b.classList.contains('playing')])).toEqual([['我来帮你，翻', true]]);
    list.unmount();
    const bands = render(<SubtitleBody entries={entries} lit={litMap} compact fontSize={14} filters={TRANSLATION_ONLY} newItemHighlightEnabled={false} />);
    expect([...bands.container.querySelectorAll('.karaoke-played')].map((e) => e.textContent)).toEqual(['我来帮你，翻']);
    bands.unmount();

    // At the clip's end every character is lit; in the gap after it nothing is left to speak, so the hold lets go.
    const atEnd = litFor({ key, t: CLIP_MS, ms: CLIP_MS }, legs);
    expect(atEnd?.upTo).toBe(FILLED.length);
    expect(nextLit(atEnd, null, legs)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/volcengine_ast2`
Expected: FAIL — `4 failed | 10 passed (14)` files, `26 failed | 136 passed (162)` tests: `sentence`, `clipFor` and `MATCH_WINDOW` do not exist, `sentenceStart` takes a ref (a `Sentence` given it becomes the clip's ref), no clip carries a range, and no `tts.clip` is framed.

- [ ] **Step 3: Replace `segments.ts`** — the times kept per recent translation; the sentence taken at its start; the match, the count and the range at the clip's emission, or the range at the close:

```ts
/**
 * Doubao's subtitles as segments (survey §2.10): each side's
 * `*SubtitleStart` / `Response` / `End` becomes one segment, opened when it
 * first has text, closed at `End`. A `Response` carries one piece of the
 * text and an `End` the whole of it (Gemini/AST2 follow-up, choice 1), so
 * the text shown is the pieces joined until the `End` replaces it. No
 * origin and no timing (choice 3): L2 pairs the two sides by proximity
 * (F16). Pure: the adapter hands it each subtitle and forwards what it
 * emits.
 *
 * It also says which translation a spoken sentence voices, and when that
 * sentence's clip may carry a range (Gemini/AST2 follow-up, ruling 1): a
 * TTS sentence carries the server times of the translation subtitle it
 * speaks, so its clip gets that whole subtitle's range, stated once the
 * subtitle's text is final. The times are matched as the clip goes to L1,
 * after its decode, so a subtitle that started meanwhile is still named.
 */
import type { AdapterEvents, Ref, Side, TextRange } from '../../lib/contract/adapter';

export type SubtitlePhase = 'start' | 'response' | 'end';

export type SegmentSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'speechRanges'>;

/** A frame's server times, in ms; 0 when the frame carries none (a `Response`'s). */
export interface ServerTimes {
  startTime: number;
  endTime: number;
}

/** A spoken sentence as it started (Gemini/AST2 follow-up, choice 2): the lock's translation, read then, and the server times it carries, matched when its clip is emitted. */
export interface Sentence {
  lock: Ref | undefined;
  times: ServerTimes;
}

/** Where a sentence's clip goes (Gemini/AST2 follow-up, choices 2, 4): the translation its times name, else the lock's; whether the times named it; its range, when it may carry one now. */
export interface Clip {
  ref: Ref;
  matched: boolean;
  range?: TextRange;
}

/**
 * How many recent translation subtitles a spoken sentence's times are
 * matched against. A clip follows its subtitle within about a second (the
 * owner's probe): eight subtitles back is far past any such lag, and the
 * list stays small (Gemini/AST2 follow-up, choice 3).
 */
export const MATCH_WINDOW = 8;

interface SideState {
  /** Allocated at `Start` (or the first text), released at `End`. */
  ref: Ref | null;
  opened: boolean;
  /** What was last sent for `ref`. */
  text: string;
  /** Every `Response` piece since the side's last `Start` or `End`, joined as it came. */
  pieces: string;
}

/** A recent translation subtitle, for the spoken sentences that may voice it (Gemini/AST2 follow-up, choices 3, 4). */
interface Voiced {
  times: ServerTimes;
  /** A clip carried these times: the first one takes the range, any later one plays rangeless. */
  claimed: boolean;
  /** The length of the text it closed with; null while open. */
  length: number | null;
  /** Audio entries emitted for this ref so far: `speechRanges` names an entry by its place among them. */
  clips: number;
  /** The matched clip's entry, emitted before the text was final: ranged when the subtitle closes. */
  waiting: number[];
}

const NO_TIMES: ServerTimes = { startTime: 0, endTime: 0 };

const idle = (): SideState => ({ ref: null, opened: false, text: '', pieces: '' });

export class Ast2Segments {
  private next: Ref = 1;
  private readonly sides: Record<Side, SideState> = { source: idle(), translation: idle() };
  private lastTranslation: Ref | undefined;
  /** The last `MATCH_WINDOW` translation subtitles, oldest first. */
  private readonly voiced = new Map<Ref, Voiced>();

  constructor(private readonly sink: SegmentSink) {}

  /**
   * One subtitle message; answers the ref the message belongs to — null
   * when it has none — for the adapter's frame.
   * - `start`: the previous segment of the side closes as it stands (its
   *   `End` never came) or, never shown, is dropped; a ref is allocated,
   *   and nothing is emitted until text arrives.
   * - `response`: one piece, added to the pieces before it; their join is
   *   the text shown (Gemini/AST2 follow-up, choice 1). Pieces with no
   *   `Start` allocate once, not once per frame (survey §1.18.3); while the
   *   join is empty or blank, nothing is shown.
   * - `end`: the whole text, then the close. An empty or blank `End` of a
   *   segment never shown is the server VAD's false start: nothing; of one
   *   shown, it closes with the text it had (survey §1.18.4).
   * A translation keeps the server times of whichever of its frames
   * carries them (the probe: its `Start` and its `End`).
   */
  subtitle(side: Side, phase: SubtitlePhase, text: string, times: ServerTimes = NO_TIMES): Ref | null {
    const state = this.sides[side];
    if (phase === 'start') {
      this.finish(side);
      state.ref = this.next++;
      this.time(side, state.ref, times);
      return state.ref;
    }
    if (phase === 'response') state.pieces += text;
    const whole = phase === 'end' ? text : state.pieces;
    // Blank counts as empty, as the old client's false-start test did
    // (`!text.trim()`, `VolcengineAST2Client.ts:738-743, 814-819`); the text
    // shown is still the one sent, untrimmed.
    if (whole.trim()) this.show(side, whole);
    const ref = state.ref;
    if (ref !== null) this.time(side, ref, times);
    if (phase === 'end') this.finish(side);
    return ref;
  }

  /**
   * The translation a spoken sentence belongs to (ruling 10): the one
   * started now — shown or not, as the old client locked it to the item it
   * minted at `Start` (`VolcengineAST2Client.ts:646-652, 810-812`) — else the
   * last one shown; none before any. A ref not yet opened is fine: L1 holds
   * its audio until the segment opens (`Conversation.ts`, `pending`). Now
   * `clipFor`'s fallback (Gemini/AST2 follow-up, choice 2).
   */
  speechRef(): Ref | undefined {
    return this.sides.translation.ref ?? this.lastTranslation;
  }

  /** `TTSSentenceStart` (Gemini/AST2 follow-up, choice 2): the lock is read now, as it always was; the times wait for the clip. */
  sentence(times: ServerTimes): Sentence {
    return { lock: this.speechRef(), times };
  }

  /**
   * A sentence's clip goes to L1 now, after its decode (Gemini/AST2
   * follow-up, ruling 1; choices 2–4): to the recent translation subtitle
   * whose server times the sentence carries — `matched` for the first clip
   * to carry them — else to the lock's, unmatched; nowhere before any. Its
   * range, the whole text its subtitle closed with, only when matched and
   * the subtitle has closed; a matched clip whose subtitle is still open is
   * ranged by `speechRanges` when it closes. Every clip on a recent ref is
   * counted here, ranged or not, so an entry is named by its place among
   * that ref's audio.
   */
  clipFor(sentence: Sentence): Clip | undefined {
    const named = this.named(sentence.times);
    const ref = named?.ref ?? sentence.lock;
    if (ref === undefined) return undefined;
    const matched = named !== undefined && !named.voiced.claimed;
    if (matched) named.voiced.claimed = true;
    const v = this.voiced.get(ref);
    if (!v) return { ref, matched };
    const index = v.clips++;
    if (!matched) return { ref, matched };
    if (v.length === null) {
      v.waiting.push(index);
      return { ref, matched };
    }
    return v.length > 0 ? { ref, matched, range: [0, v.length] } : { ref, matched };
  }

  /** The recent translation subtitle these server times are, by equal start and end; none for a frame that carries none. */
  private named(times: ServerTimes): { ref: Ref; voiced: Voiced } | undefined {
    if (times.endTime <= 0) return undefined;
    for (const [ref, voiced] of this.voiced) {
      if (voiced.times.startTime === times.startTime && voiced.times.endTime === times.endTime) return { ref, voiced };
    }
    return undefined;
  }

  /** A translation's times, from whichever of its frames carries them; a new translation ref joins the recent list, the oldest leaving past `MATCH_WINDOW`. */
  private time(side: Side, ref: Ref, times: ServerTimes): void {
    if (side !== 'translation') return;
    let v = this.voiced.get(ref);
    if (!v) {
      v = { times: NO_TIMES, claimed: false, length: null, clips: 0, waiting: [] };
      this.voiced.set(ref, v);
      while (this.voiced.size > MATCH_WINDOW) this.voiced.delete(this.voiced.keys().next().value as Ref);
    }
    if (times.endTime > 0) v.times = { startTime: times.startTime, endTime: times.endTime };
  }

  private show(side: Side, text: string): void {
    const state = this.sides[side];
    if (state.ref === null) {
      state.ref = this.next++;
      this.time(side, state.ref, NO_TIMES);
    }
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
    if (side === 'translation' && state.ref !== null) this.settle(state.ref, state.opened ? state.text : null);
    // In place: `subtitle` still holds this state object.
    Object.assign(state, idle());
  }

  /**
   * A translation closed with `text` (Gemini/AST2 follow-up, choice 4): its
   * length is final, and a matched clip already emitted gets its range now,
   * after the close. One never shown leaves the list: no sentence voices a
   * row that never opened.
   */
  private settle(ref: Ref, text: string | null): void {
    const v = this.voiced.get(ref);
    if (!v) return;
    if (text === null) {
      this.voiced.delete(ref);
      return;
    }
    v.length = text.length;
    const waiting = v.waiting;
    v.waiting = [];
    if (waiting.length > 0 && text.length > 0) {
      const range: TextRange = [0, text.length];
      this.sink.speechRanges({ ref, ranges: waiting.map((index) => ({ index, range })) });
    }
  }
}
```

- [ ] **Step 4: Replace `speech.ts`** — the sentence taken at its start, its clip's translation and range asked for at emission:

```ts
/**
 * Doubao's spoken sentences (ruling 10; survey §1.8): the `TTSResponse`
 * chunks between `TTSSentenceStart` and `TTSSentenceEnd` are one Ogg Opus
 * clip, decoded whole and emitted as one `audio`. The sentence is taken
 * when it starts — the lock read then, and its server times; its
 * translation and range are asked for when the clip is emitted, after its
 * decode (Gemini/AST2 follow-up, choices 2, 4): the translation its times
 * name, else the lock's; the whole translation's range when the times named
 * it and its text is final, else none — replay only. Decodes run one after
 * another, so clips arrive in order; the old client's two races are not
 * ported: it read its lock after the decode's `await`, and let decodes
 * overtake (survey §1.18.2). The lock is read at the start here; only the
 * times, which name one subtitle whatever opened since, wait for the
 * decode. Pure: the decoder and the resolution are injected.
 */
import type { AdapterEvents } from '../../lib/contract/adapter';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { Clip, Sentence } from './segments';

/** A clip's Ogg Opus as the contract's 24 kHz mono Int16. */
export type OggDecoder = (ogg: Uint8Array) => Promise<Int16Array>;

export type SpeechSink = Pick<AdapterEvents, 'audio' | 'degraded'>;

/** A clip's translation and range, asked for as the clip is emitted (`Ast2Segments.clipFor`). */
export type ClipFor = (sentence: Sentence) => Clip | undefined;

/** With nothing to match against: the lock's translation, rangeless. */
const toLock: ClipFor = (sentence) => (sentence.lock === undefined ? undefined : { ref: sentence.lock, matched: false });

export class Ast2Speech {
  private chunks: Uint8Array[] = [];
  private sentence: Sentence | undefined;
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly decode: OggDecoder, private readonly sink: SpeechSink, private readonly clipFor: ClipFor = toLock) {}

  /** `TTSSentenceStart`: the sentence as it starts (`Ast2Segments.sentence`), taken now. A sentence left unended is flushed first. */
  sentenceStart(sentence: Sentence): void {
    this.flush();
    this.sentence = sentence;
  }

  /** `TTSResponse`: a copy — the codec's `data` is a view into its decode buffer (`VolcengineAST2Client.ts:877-885`). */
  chunk(data: Uint8Array): void {
    // `new Uint8Array(view)` copies; a Node `Buffer` view's own `slice` would not.
    if (data.length > 0) this.chunks.push(new Uint8Array(data));
  }

  /** `TTSSentenceEnd`, or `TTSEnded` for what is left: the clip goes to the decoder; answers what it held, for the adapter's frame — nothing once stopped. */
  flush(): { chunks: number; bytes: number } {
    const held = this.chunks;
    this.chunks = [];
    if (this.stopped) return { chunks: 0, bytes: 0 };
    const bytes = held.reduce((n, c) => n + c.length, 0);
    if (bytes === 0) return { chunks: 0, bytes: 0 };
    const clip = new Uint8Array(bytes);
    let at = 0;
    for (const c of held) { clip.set(c, at); at += c.length; }
    const sentence = this.sentence;
    this.chain = this.chain
      // A clip still waiting when the session stops is never decoded: the empty pcm is dropped below.
      .then(() => (this.stopped ? new Int16Array(0) : this.decode(clip)))
      .then(
        (pcm) => { if (!this.stopped && pcm.length > 0) this.emit(pcm, sentence); },
        (error: unknown) => {
          if (!this.stopped) this.sink.degraded({ code: 'tts_degraded', message: `A spoken sentence from Doubao could not be decoded: ${describeCause(error)}`, cause: error, reason: 'tts_decode' });
        },
      );
    return { chunks: held.length, bytes };
  }

  /** Stop, a failure or a close: nothing more is decoded or emitted — a decode already running finishes, and its result is dropped. */
  stop(): void {
    this.stopped = true;
    this.chunks = [];
  }

  /** The translation and range are asked for here, as the clip reaches L1, never before: during the decode its subtitle may have started, or become final. A clip with no sentence — chunks before any start — goes nowhere. */
  private emit(pcm: Int16Array, sentence: Sentence | undefined): void {
    const clip = sentence === undefined ? undefined : this.clipFor(sentence);
    if (clip === undefined) {
      this.sink.audio({ pcm });
      return;
    }
    this.sink.audio(clip.range ? { pcm, ref: clip.ref, range: clip.range } : { pcm, ref: clip.ref });
  }
}
```

- [ ] **Step 5: Pass the times through the adapter, and frame each clip.**

```diff
diff --git a/src/providers/volcengine_ast2/adapter.ts b/src/providers/volcengine_ast2/adapter.ts
--- a/src/providers/volcengine_ast2/adapter.ts
+++ b/src/providers/volcengine_ast2/adapter.ts
@@ -4,10 +4,12 @@
  * compiled until the deletion plan) without its display bookkeeping: items,
  * ids and the punctuation lane are L1's and L2's now. One protobuf socket
  * per leg, its credentials in the URL's query (ruling 2); subtitles become
- * segments (`segments.ts`), spoken sentences rangeless audio (`speech.ts`),
- * and what goes up is resampled and paced (`audioIn.ts`). Every timer reads
- * the request's clock, and nothing is said but through events (CLAUDE.md,
- * "Inside an IClient session").
+ * segments (`segments.ts`), spoken sentences audio (`speech.ts`) — each
+ * clip ranged over the whole translation its server times name, once that
+ * text is final (Gemini/AST2 follow-up, ruling 1) — and what goes up is
+ * resampled and paced (`audioIn.ts`). Every timer reads the request's
+ * clock, and nothing is said but through events (CLAUDE.md, "Inside an
+ * IClient session").
  */
 import {
   AdapterStartError,
@@ -23,7 +25,7 @@ import { describeCause } from '../../lib/diagnostics/describeCause';
 import { IDLE_MS, InputPacer, KEEPALIVE_MS, PACKET_SAMPLES, TAIL_MS } from './audioIn';
 import type { Ast2Config } from './config';
 import { decodeOggOpus } from './decode';
-import { Ast2Segments, type SubtitlePhase } from './segments';
+import { Ast2Segments, type Clip, type Sentence, type SubtitlePhase } from './segments';
 import type { Ast2Credentials } from './settings';
 import { nativeSocket, WS_OPEN, type OpenSocket } from './socket';
 import { Ast2Speech, type OggDecoder } from './speech';
@@ -105,7 +107,7 @@ class Ast2Leg implements AdapterSession {
   ) {
     this.ids = { session: deps.newId(), connection: deps.newId() };
     this.segments = new Ast2Segments(events);
-    this.speech = request.config.mode === 's2s' ? new Ast2Speech(deps.decode, events) : null;
+    this.speech = request.config.mode === 's2s' ? new Ast2Speech(deps.decode, events, (sentence) => this.clip(sentence)) : null;
     this.socket = deps.openSocket(ast2Url(request.credentials));
     this.socket.binaryType = 'arraybuffer';
     this.opening = new Promise<AdapterSession>((resolve, reject) => {
@@ -250,7 +252,7 @@ class Ast2Leg implements AdapterSession {
 
   /** One subtitle, with what pairing may need later framed beside it (ruling 11): the Sequence and both times. */
   private subtitle(side: Side, phase: SubtitlePhase, r: Ast2Response, sequence: number): void {
-    const ref = this.phase === 'live' ? this.segments.subtitle(side, phase, r.text) : null;
+    const ref = this.phase === 'live' ? this.segments.subtitle(side, phase, r.text, { startTime: r.startTime, endTime: r.endTime }) : null;
     this.frame('in', `subtitle.${side}`, { phase, ref, text: r.text, startTime: r.startTime, endTime: r.endTime, sequence, spkChg: r.spkChg });
   }
 
@@ -260,10 +262,11 @@ class Ast2Leg implements AdapterSession {
     if (r.event === EventType.TTSResponse) {
       speech.chunk(r.data);
     } else if (r.event === EventType.TTSSentenceStart) {
-      const ref = this.segments.speechRef();
-      speech.sentenceStart(ref);
-      // The locked ref, shown or not: the live test reads here whether the sentence's translation was ever shown.
-      this.frame('in', 'tts.sentence_start', { ref: ref ?? null, sequence });
+      const sentence = this.segments.sentence({ startTime: r.startTime, endTime: r.endTime });
+      speech.sentenceStart(sentence);
+      // The locked ref, shown or not, and the sentence's times: the live test reads here whether the sentence's
+      // translation was ever shown, and which translation's times it carries (Gemini/AST2 follow-up, choice 5).
+      this.frame('in', 'tts.sentence_start', { ref: sentence.lock ?? null, startTime: r.startTime, endTime: r.endTime, sequence });
     } else {
       this.frame('in', r.event === EventType.TTSSentenceEnd ? 'tts.sentence_end' : 'tts.ended', { ...speech.flush(), sequence });
     }
@@ -361,6 +364,13 @@ class Ast2Leg implements AdapterSession {
     if (socket.readyState <= WS_OPEN) socket.close(1000);
   }
 
+  /** A decoded clip's translation and range, resolved as it goes to L1, and framed: the live test reads how often the times named the translation, and which row each clip took (Gemini/AST2 follow-up, choices 2, 5). */
+  private clip(sentence: Sentence): Clip | undefined {
+    const clip = this.segments.clipFor(sentence);
+    this.frame('in', 'tts.clip', { ref: clip?.ref ?? null, matched: clip?.matched ?? false, range: clip?.range ?? null });
+    return clip;
+  }
+
   private frame(direction: 'in' | 'out', type: string, payload?: Record<string, unknown>): void {
     this.events.frame(payload === undefined ? { direction, type } : { direction, type, payload: framePayload(payload) });
   }
```

- [ ] **Step 6: Run Doubao's suites and L1's.**

Run: `npx vitest run src/providers/volcengine_ast2 src/lib/conversation src/providers/sessionSide.consistency.test.ts`
Expected: PASS — Doubao's 14 files, 160 tests; L1's 3 files, 73 tests; the guard's file. The conformance scenarios now carry a ranged clip, held to the kit's `range-in-text`, `ranges-entry` and `ranges-order` rules.

- [ ] **Step 7: The gates.** The suite and the typecheck gate (in Wave 2, a failure in `src/providers/gemini/**` is Task 7's).

- [ ] **Step 8: Commit.**

```bash
git add src/providers/volcengine_ast2/segments.ts src/providers/volcengine_ast2/segments.test.ts src/providers/volcengine_ast2/speech.ts src/providers/volcengine_ast2/speech.test.ts src/providers/volcengine_ast2/adapter.ts src/providers/volcengine_ast2/adapter.test.ts src/providers/volcengine_ast2/testing.ts src/providers/volcengine_ast2/karaoke.test.tsx
```

```bash
git commit -q -F - -- src/providers/volcengine_ast2/segments.ts src/providers/volcengine_ast2/segments.test.ts src/providers/volcengine_ast2/speech.ts src/providers/volcengine_ast2/speech.test.ts src/providers/volcengine_ast2/adapter.ts src/providers/volcengine_ast2/adapter.test.ts src/providers/volcengine_ast2/testing.ts src/providers/volcengine_ast2/karaoke.test.tsx <<'EOF'
feat(volcengine_ast2): whole-sentence karaoke, keyed by the server's times

A TTS sentence carries the server times of the translation subtitle it
speaks, so its clip spans that whole subtitle: ranged at emission when
the subtitle has closed, else by speechRanges at its close, never over
text that may still change. The lock is read as the sentence starts and
the times are matched as its clip is emitted; they replace the lock when
they match one of the last eight translations. A second clip on one
subtitle plays rangeless; each clip is framed as tts.clip. Pinned end
to end with the display cut by sentences, in the panel and the bands,
with the punctuation fill-in landing before the clip and after it.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 7: Gemini's activity handling per model family (Wave 2)

**Files:**
- Modify: `src/providers/gemini/settings.ts` (a type and a function after `familyOf`, `:191-194`), `src/providers/gemini/config.ts` (the import, `GeminiConfig`, `buildGemini`'s return), `src/providers/gemini/wire.ts` (`GeminiSetup`, `setupFrame`; `:47-48, 76-78`), `src/providers/gemini/adapter.ts` (the `session.opened` frame, `:176`), `src/providers/gemini/turns.ts` (a comment in `cancelTurn`, `:173-174`), `scripts/dev/wire-probe/gemini.mts` (the config literal, `:114-122`)
- Test: `src/providers/gemini/settings.test.ts`, `src/providers/gemini/config.test.ts`, `src/providers/gemini/wire.test.ts`, `src/providers/gemini/wire.oracle.test.ts`, `src/providers/gemini/adapter.test.ts`, `src/providers/gemini/testing.ts`

**Interfaces:**
- Consumes: Task 4's `settings.ts` and `config.test.ts`; Task 5's `adapter.ts` and `adapter.test.ts`; Task 3's `turns.ts`; the landed `familyOf`, `isGeminiTranslateModel`.
- Produces: `type GeminiActivityHandling = 'NO_INTERRUPTION' | 'START_OF_ACTIVITY_INTERRUPTS'` and `geminiActivityHandling(model: string): GeminiActivityHandling` (`settings.ts`); `GeminiConfig.activityHandling: GeminiActivityHandling` (always set); `GeminiSetup.setup.realtimeInputConfig.activityHandling: GeminiConfig['activityHandling']`; the fixture `BARGE_IN = 'gemini-3.8-live'`, listed first in `SHARED.models` (research note 6). Task 8 edits the same files after this task.

- [ ] **Step 1: Write the failing tests** (ruling 5; choice 9): the rule, the builder, the setup frame, the SDK's converter over both values, the opened frame, and the probe's overlap run on 3.8:

```diff
diff --git a/src/providers/gemini/config.test.ts b/src/providers/gemini/config.test.ts
--- a/src/providers/gemini/config.test.ts
+++ b/src/providers/gemini/config.test.ts
@@ -58,6 +58,15 @@ describe("Gemini's builder", () => {
     expect(build({ voice: '' }).voice).toBe('Aoede');
   });
 
+  it("sets each model family's activity handling: 2.5 no interruption, 3.x barge-in, Live Translate no interruption (Gemini/AST2 follow-up, ruling 5)", () => {
+    expect(build().activityHandling).toBe('NO_INTERRUPTION');
+    expect(build({ model: 'gemini-3.8-live' }, SPEAKER, shared({ models: [{ id: 'gemini-3.8-live' }] })).activityHandling).toBe('START_OF_ACTIVITY_INTERRUPTS');
+    expect(build({ model: TRANSLATE }).activityHandling).toBe('NO_INTERRUPTION');
+    // The participant and manual turns alike: it follows the model alone.
+    expect(build({ model: 'gemini-3.8-live' }, { ...PARTICIPANT, turns: 'auto' }, shared({ models: [{ id: 'gemini-3.8-live' }] })).activityHandling).toBe('START_OF_ACTIVITY_INTERRUPTS');
+    expect(build({}, { ...SPEAKER, turns: 'manual' }).activityHandling).toBe('NO_INTERRUPTION');
+  });
+
   it('marks activity itself under manual turns', () => {
     expect(build({}, { ...SPEAKER, turns: 'manual' }).activity).toEqual({ manual: true });
   });
diff --git a/src/providers/gemini/settings.test.ts b/src/providers/gemini/settings.test.ts
--- a/src/providers/gemini/settings.test.ts
+++ b/src/providers/gemini/settings.test.ts
@@ -3,7 +3,7 @@ import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS } from '../../lib/provid
 import { AUTO, reverseSupported } from '../../lib/provider/languages';
 import type { AuthContext } from '../../lib/provider/types';
 import {
-  compareGeminiModels, defaultGeminiModel, effectiveGeminiModel, GEMINI_DEFAULTS, GEMINI_LANGUAGES, GEMINI_LEGACY_KEYS, GEMINI_VOICES,
+  compareGeminiModels, defaultGeminiModel, effectiveGeminiModel, geminiActivityHandling, GEMINI_DEFAULTS, GEMINI_LANGUAGES, GEMINI_LEGACY_KEYS, GEMINI_VOICES,
   geminiCredentials, geminiLanguageName, geminiLanguages, isGeminiLiveModel, isGeminiTranslateModel, migrateGeminiSettings,
   sortGeminiModels, toTranslationLanguageCode,
 } from './settings';
@@ -165,6 +165,18 @@ describe("Gemini's models", () => {
     expect(defaultGeminiModel([])).toBe('');
   });
 
+  it('barge in on a dialogue model of family 3.0 or later; keep NO_INTERRUPTION on 2.5 and below, an unversioned id and Live Translate (Gemini/AST2 follow-up, ruling 5)', () => {
+    for (const id of ['gemini-3.8-live', 'gemini-3.8-live-extended-thinking', 'gemini-3.1-flash-live-preview', 'gemini-3-flash-native-audio-preview-01-2026', 'gemini-4.0-live']) {
+      expect(geminiActivityHandling(id), id).toBe('START_OF_ACTIVITY_INTERRUPTS');
+    }
+    for (const id of [
+      'gemini-2.5-flash-native-audio-preview-12-2025', 'gemini-2.5-flash-native-audio-latest', 'gemini-live-2.5-flash-preview', 'gemini-2.0-flash-live-001',
+      'gemini-live-latest', 'gemini-3.5-live-translate-preview',
+    ]) {
+      expect(geminiActivityHandling(id), id).toBe('NO_INTERRUPTION');
+    }
+  });
+
   it('keep a saved model the check listed — a dialogue model too: nothing is migrated — replace one it no longer lists, and keep it while nothing is listed', () => {
     const live = ids(LISTED.filter(isGeminiLiveModel));
     expect(effectiveGeminiModel({ model: 'gemini-2.5-flash-native-audio-preview-12-2025' }, live)).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
diff --git a/src/providers/gemini/testing.ts b/src/providers/gemini/testing.ts
--- a/src/providers/gemini/testing.ts
+++ b/src/providers/gemini/testing.ts
@@ -18,6 +18,8 @@ import { GEMINI_DEFAULTS, type GeminiCredentials, type GeminiSettings } from './
 
 export const DIALOGUE = 'gemini-2.5-flash-native-audio-preview-12-2025';
 export const TRANSLATE = 'gemini-3.5-live-translate-preview';
+/** A 3.x dialogue model: it barges in (Gemini/AST2 follow-up, ruling 5). */
+export const BARGE_IN = 'gemini-3.8-live';
 /** Shaped as a real key (`AIza…`), which `redact()` masks: a frame that carried it fails the kit's `frame-secret` rule. */
 export const KEY: GeminiCredentials = { apiKey: 'AIzaTestKey0123456789' };
 
@@ -32,7 +34,7 @@ export const SHARED: SharedSettings = {
   pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
   reversed: (d) => d.source === 'ja-JP' && d.target === 'en-US',
   segmentation: { mode: 'pause', sentencesPerRow: 0 },
-  models: [{ id: TRANSLATE }, { id: DIALOGUE }],
+  models: [{ id: BARGE_IN }, { id: TRANSLATE }, { id: DIALOGUE }],
 };
 export const AUTO_CTX: SessionContext = { direction: { source: 'en-US', target: 'ja-JP' }, speech: true, turns: 'auto' };
 
diff --git a/src/providers/gemini/wire.oracle.test.ts b/src/providers/gemini/wire.oracle.test.ts
--- a/src/providers/gemini/wire.oracle.test.ts
+++ b/src/providers/gemini/wire.oracle.test.ts
@@ -13,10 +13,10 @@ import { ActivityHandling, EndSensitivity, GoogleGenAI, Modality, StartSensitivi
 import { flush } from '../../lib/contract/testing/drive';
 import { FakeSocket } from '../../lib/contract/testing/fakeSocket';
 import type { GeminiConfig } from './config';
-import { AUTO_CTX, configFor, DIALOGUE, KEY, TRANSLATE } from './testing';
+import { AUTO_CTX, BARGE_IN, configFor, DIALOGUE, KEY, TRANSLATE } from './testing';
 import { ACTIVITY_END, ACTIVITY_START, audioFrame, INPUT_MIME, liveUrl, pcmToBase64, setupFrame, textFrame } from './wire';
 
-/** The old client's `LiveConnectConfig` for this `C`, enums and all (`GeminiClient.ts:490-574`). */
+/** The old client's `LiveConnectConfig` for this `C`, enums and all (`GeminiClient.ts:490-574`), its activity handling now the config's (Gemini/AST2 follow-up, ruling 5). */
 function oldLiveConfig(c: GeminiConfig, handle: string | null): LiveConnectConfig {
   const a = c.activity;
   return {
@@ -29,7 +29,7 @@ function oldLiveConfig(c: GeminiConfig, handle: string | null): LiveConnectConfi
     inputAudioTranscription: {},
     outputAudioTranscription: {},
     realtimeInputConfig: {
-      activityHandling: ActivityHandling.NO_INTERRUPTION,
+      activityHandling: c.activityHandling === 'START_OF_ACTIVITY_INTERRUPTS' ? ActivityHandling.START_OF_ACTIVITY_INTERRUPTS : ActivityHandling.NO_INTERRUPTION,
       automaticActivityDetection: a.manual
         ? { disabled: true }
         : {
@@ -74,6 +74,8 @@ describe("the wire against the SDK's own converter", () => {
     ['a dialogue model with max tokens, resuming', () => configFor(DIALOGUE, AUTO_CTX, { maxTokens: 2048 }), 'handle-1'],
     ['a dialogue model, manual, silent, high sensitivities', () => configFor(DIALOGUE, { ...AUTO_CTX, speech: false, turns: 'manual' }, { vadStartSensitivity: 'high' }), null],
     ['a dialogue model, auto, high sensitivities', () => configFor(DIALOGUE, AUTO_CTX, { vadStartSensitivity: 'high', vadEndSensitivity: 'low', vadSilenceDurationMs: 900 }), null],
+    ['a 3.x dialogue model, barging in', () => configFor(BARGE_IN), null],
+    ['a 3.x dialogue model, manual, barging in', () => configFor(BARGE_IN, { ...AUTO_CTX, turns: 'manual' }), null],
     ['Live Translate', () => configFor(TRANSLATE), null],
     ["Live Translate for the participant, with no prompt", () => configFor(TRANSLATE, { direction: { source: 'ja-JP', target: 'en-US' }, speech: true, turns: 'auto' }, { useTemplateMode: false, systemInstructions: ' ' }), null],
   ];
diff --git a/src/providers/gemini/wire.test.ts b/src/providers/gemini/wire.test.ts
--- a/src/providers/gemini/wire.test.ts
+++ b/src/providers/gemini/wire.test.ts
@@ -1,5 +1,5 @@
 import { describe, it, expect } from 'vitest';
-import { AUTO_CTX, configFor, DIALOGUE, KEY, serverFrame, TRANSLATE } from './testing';
+import { AUTO_CTX, BARGE_IN, configFor, DIALOGUE, KEY, serverFrame, TRANSLATE } from './testing';
 import {
   ACTIVITY_END, ACTIVITY_START, audioFrame, base64ToPcm, closeFailureCode, decodeServerMessage, INPUT_MIME, liveUrl, pcmRate, pcmToBase64, setupFrame, textFrame,
 } from './wire';
@@ -30,6 +30,11 @@ describe("Gemini's wire", () => {
     });
   });
 
+  it("writes the config's activity handling: barge-in for a 3.x dialogue model, none for Live Translate (Gemini/AST2 follow-up, ruling 5)", () => {
+    expect(setupFrame(configFor(BARGE_IN), null).setup.realtimeInputConfig.activityHandling).toBe('START_OF_ACTIVITY_INTERRUPTS');
+    expect(setupFrame(configFor(TRANSLATE), null).setup.realtimeInputConfig.activityHandling).toBe('NO_INTERRUPTION');
+  });
+
   it('sets up Live Translate: its target under generationConfig, echo off, the prompt kept, no sampling, no voice', () => {
     const setup = setupFrame(configFor(TRANSLATE), null).setup;
     expect(setup.generationConfig).toEqual({ responseModalities: ['AUDIO'], translationConfig: { targetLanguageCode: 'ja', echoTargetLanguage: false } });
```

```diff
diff --git a/src/providers/gemini/adapter.test.ts b/src/providers/gemini/adapter.test.ts
--- a/src/providers/gemini/adapter.test.ts
+++ b/src/providers/gemini/adapter.test.ts
@@ -17,7 +17,7 @@ import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/projec
 import { createGeminiAdapter, SETUP_TIMEOUT_MS } from './adapter';
 import type { GeminiConfig } from './config';
 import type { GeminiCredentials } from './settings';
-import { AUTO_CTX, b64, configFor, DIALOGUE, KEY, liveGemini, RefusingWebSocket, SERVER, serverFrame, startGemini, trackedClock, TRANSLATE } from './testing';
+import { AUTO_CTX, b64, BARGE_IN, configFor, DIALOGUE, KEY, liveGemini, RefusingWebSocket, SERVER, serverFrame, startGemini, trackedClock, TRANSLATE } from './testing';
 import { base64ToPcm, liveUrl, setupFrame } from './wire';
 
 const MANUAL = { ...AUTO_CTX, turns: 'manual' as const };
@@ -82,7 +82,7 @@ describe('the Gemini adapter: opening', () => {
     expect(h.socket().binaryType).toBe('arraybuffer');
     h.socket().open();
     expect(h.sent()).toEqual([setupFrame(h.config, null)]);
-    expect(h.frames('session.opened')).toEqual([{ model: DIALOGUE, kind: 'dialogue', speaking: true, manual: false, resumed: false }]);
+    expect(h.frames('session.opened')).toEqual([{ model: DIALOGUE, kind: 'dialogue', speaking: true, manual: false, activityHandling: 'NO_INTERRUPTION', resumed: false }]);
   });
 
   it('resolves only once the server answers the setup, emitting nothing but its frames, over a websocket', async () => {
@@ -223,6 +223,32 @@ describe('the Gemini adapter: one session', () => {
     expect(h.of('audio')[0].payload.pcm).toHaveLength(2400);
   });
 
+  it("a 3.x model barges in: the setup says so, and the server's interrupted then turnComplete end the answer with every chunk it played kept (Gemini/AST2 follow-up, ruling 5)", async () => {
+    const h = await liveGemini({ model: BARGE_IN });
+    expect((h.sent()[0] as { setup: { realtimeInputConfig: { activityHandling: string } } }).setup.realtimeInputConfig.activityHandling).toBe('START_OF_ACTIVITY_INTERRUPTS');
+    expect(h.frames('session.opened')).toEqual([{ model: BARGE_IN, kind: 'dialogue', speaking: true, manual: false, activityHandling: 'START_OF_ACTIVITY_INTERRUPTS', resumed: false }]);
+    // The owner's overlap probe on gemini-3.8-live: the second utterance starts while the first's answer still plays.
+    h.socket().receive(SERVER.input('Lyrical Time の番組へようこそ。自然な会話をお手伝いします。'));
+    h.socket().receive(SERVER.output('Welcome to the '));
+    h.socket().receive(SERVER.audio(2400));
+    h.socket().receive(SERVER.output('Lyrical Time show.'));
+    h.socket().receive(SERVER.audio(2400));
+    h.socket().receive(serverFrame({ serverContent: { generationComplete: true } }));
+    h.socket().receive(SERVER.interrupted());
+    h.socket().receive(SERVER.turnComplete());
+    h.socket().receive(SERVER.input('Real Time翻訳機へようこそ。'));
+    h.socket().receive(SERVER.output('Welcome to the Real Time translator.'));
+    h.socket().receive(SERVER.turnComplete());
+    // Each utterance pairs with its own answer: interrupted and turnComplete each end a turn, so the origins differ, whatever their numbers.
+    const [source1, translation1, source2, translation2] = h.of('segmentOpened').map((e) => e.payload);
+    expect([source1.side, translation1.side, source2.side, translation2.side]).toEqual(['source', 'translation', 'source', 'translation']);
+    expect(translation1.origin).toBe(source1.origin);
+    expect(translation2.origin).toBe(source2.origin);
+    expect(source2.origin).not.toBe(source1.origin);
+    expect(h.of('audio').map((e) => [e.payload.ref, e.payload.pcm.length])).toEqual([[2, 2400], [2, 2400]]);
+    expect(h.of('segmentClosed').map((e) => e.payload.ref)).toEqual([1, 2, 3, 4]);
+  });
+
   it("folds a message's content before its turnComplete (choice 15)", async () => {
     const h = await liveGemini();
     h.socket().receive(serverFrame({ serverContent: {
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/gemini/settings.test.ts src/providers/gemini/config.test.ts src/providers/gemini/wire.test.ts src/providers/gemini/wire.oracle.test.ts src/providers/gemini/adapter.test.ts`
Expected: FAIL — `4 failed | 1 passed (5)` files, `5 failed | 105 passed (110)` tests: `geminiActivityHandling` does not exist, the config has no `activityHandling`, the setup writes `NO_INTERRUPTION` for 3.8, and `session.opened` has no `activityHandling`. The oracle's two new cases pass already — both sides still say `NO_INTERRUPTION` — and pin the SDK's shape once the value moves.

- [ ] **Step 3: The rule, the config, the wire, the frame, the comment and the probe.**

```diff
diff --git a/src/providers/gemini/settings.ts b/src/providers/gemini/settings.ts
--- a/src/providers/gemini/settings.ts
+++ b/src/providers/gemini/settings.ts
@@ -193,6 +193,24 @@ function familyOf(id: string): number {
   return m ? Number(m[1]) * 1000 + Number(m[2] ?? 0) : 0;
 }
 
+/** What the user's speech does to a response still playing: nothing, or cut it off (barge-in). The Live API's own two values. */
+export type GeminiActivityHandling = 'NO_INTERRUPTION' | 'START_OF_ACTIVITY_INTERRUPTS';
+
+/**
+ * A model's activity handling, by its family (Gemini/AST2 follow-up, ruling
+ * 5; choice 9). The owner's overlap probe: `gemini-3.8-live` under
+ * `NO_INTERRUPTION` dropped the input that arrived while it answered, and
+ * barge-in kept both utterances whole; the 2.5 native-audio models are the
+ * opposite, barge-in truncating the answer they were still speaking. So a
+ * dialogue model of family 3.0 or later barges in; 2.5 and below, and an id
+ * with no version, keep today's `NO_INTERRUPTION`; Live Translate keeps it
+ * too — its guide never mentions activity handling.
+ */
+export function geminiActivityHandling(model: string): GeminiActivityHandling {
+  if (isGeminiTranslateModel(model)) return 'NO_INTERRUPTION';
+  return familyOf(model) >= 3000 ? 'START_OF_ACTIVITY_INTERRUPTS' : 'NO_INTERRUPTION';
+}
+
 /** The release date an id ends with, `-MM-YYYY` (`…-preview-12-2025`), as YYYYMM; an undated id reads 0. */
 function dateOf(id: string): number {
   const m = /-(\d{2})-(\d{4})$/.exec(id);
```

```diff
diff --git a/src/providers/gemini/config.ts b/src/providers/gemini/config.ts
--- a/src/providers/gemini/config.ts
+++ b/src/providers/gemini/config.ts
@@ -11,8 +11,9 @@ import { resolveInstructions } from '../../lib/provider/instructions';
 import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
 import { clampSegmentPauseMs, segmentPauseMs } from '../../lib/segmentation/segmentationMode';
 import {
-  effectiveGeminiModel, geminiLanguageName, GEMINI_DEFAULTS, GEMINI_DEFAULT_VOICE, GEMINI_MAX_TOKENS_RANGE, GEMINI_TEMPERATURE_RANGE,
-  GEMINI_VAD_PREFIX_RANGE, GEMINI_VAD_SILENCE_RANGE, isGeminiTranslateModel, toTranslationLanguageCode, type GeminiSettings,
+  effectiveGeminiModel, geminiActivityHandling, geminiLanguageName, GEMINI_DEFAULTS, GEMINI_DEFAULT_VOICE, GEMINI_MAX_TOKENS_RANGE,
+  GEMINI_TEMPERATURE_RANGE, GEMINI_VAD_PREFIX_RANGE, GEMINI_VAD_SILENCE_RANGE, isGeminiTranslateModel, toTranslationLanguageCode,
+  type GeminiActivityHandling, type GeminiSettings,
 } from './settings';
 
 export interface GeminiConfig {
@@ -34,6 +35,8 @@ export interface GeminiConfig {
   activity:
     | { manual: true }
     | { manual: false; start: 'high' | 'low'; end: 'high' | 'low'; silenceMs: number; prefixMs: number };
+  /** What speech does to a response still playing, by the model's family (Gemini/AST2 follow-up, ruling 5; choice 9). */
+  activityHandling: GeminiActivityHandling;
   /** Live Translate only: each side's silence timer (the old continuous segmentation) and the mid-sentence deferral (choice 7). */
   silence?: { sourceMs: number; translationMs: number; deferMidSentence: boolean };
 }
@@ -80,6 +83,7 @@ export function buildGemini(context: SessionContext, s: GeminiSettings, shared:
       },
     }),
     activity,
+    activityHandling: geminiActivityHandling(model),
   };
 }
 
diff --git a/src/providers/gemini/wire.ts b/src/providers/gemini/wire.ts
--- a/src/providers/gemini/wire.ts
+++ b/src/providers/gemini/wire.ts
@@ -45,7 +45,7 @@ export interface GeminiSetup {
     inputAudioTranscription: Record<string, never>;
     outputAudioTranscription: Record<string, never>;
     realtimeInputConfig: {
-      activityHandling: 'NO_INTERRUPTION';
+      activityHandling: GeminiConfig['activityHandling'];
       automaticActivityDetection:
         | { disabled: true }
         | { disabled: false; startOfSpeechSensitivity: Sensitivity<'START'>; endOfSpeechSensitivity: Sensitivity<'END'>; silenceDurationMs: number; prefixPaddingMs: number };
@@ -74,8 +74,8 @@ export function setupFrame(c: GeminiConfig, handle: string | null): GeminiSetup
       inputAudioTranscription: {},
       outputAudioTranscription: {},
       realtimeInputConfig: {
-        // Hard-coded, as the old client did (`GeminiClient.ts:496`): speaking again does not cut the model off.
-        activityHandling: 'NO_INTERRUPTION',
+        // Per model family (Gemini/AST2 follow-up, ruling 5), where the old client hard-coded `NO_INTERRUPTION` (`GeminiClient.ts:496`).
+        activityHandling: c.activityHandling,
         automaticActivityDetection: a.manual
           ? { disabled: true }
           : {
```

```diff
diff --git a/src/providers/gemini/adapter.ts b/src/providers/gemini/adapter.ts
--- a/src/providers/gemini/adapter.ts
+++ b/src/providers/gemini/adapter.ts
@@ -186,7 +186,9 @@ class GeminiSession {
 
       ws.onopen = () => {
         opened = true;
-        this.frame('out', 'session.opened', { model: config.model, kind: config.kind, speaking: context.speech, manual: config.activity.manual, resumed: handle !== null });
+        this.frame('out', 'session.opened', {
+          model: config.model, kind: config.kind, speaking: context.speech, manual: config.activity.manual, activityHandling: config.activityHandling, resumed: handle !== null,
+        });
         ws.send(JSON.stringify(setupFrame(config, handle)));
       };
       ws.onmessage = (event: MessageEvent) => {
```

```diff
diff --git a/src/providers/gemini/turns.ts b/src/providers/gemini/turns.ts
--- a/src/providers/gemini/turns.ts
+++ b/src/providers/gemini/turns.ts
@@ -186,7 +186,8 @@ export class GeminiTurns {
     // Live Translate: its output belongs to no press, so the cancel is `activityEnd` alone.
     if (this.stopped || !this.dialogue) return;
     // An answer is owed from the release that asked for it, before its first output; once streaming it keeps going
-    // (`NO_INTERRUPTION`). Either way it finishes in its own segments, and the drop waits for its end.
+    // under `NO_INTERRUPTION`, or, on a model that barges in, ends at the server's `interrupted` (Gemini/AST2
+    // follow-up, ruling 5). Either way it finishes in its own segments, and the drop waits for its end.
     if (this.answering || this.owed) {
       this.suppressAfterAnswer = true;
       return;
```

```diff
diff --git a/scripts/dev/wire-probe/gemini.mts b/scripts/dev/wire-probe/gemini.mts
--- a/scripts/dev/wire-probe/gemini.mts
+++ b/scripts/dev/wire-probe/gemini.mts
@@ -22,7 +22,7 @@ import WebSocket from 'ws';
 import { checkGemini } from '../../../src/providers/gemini/check';
 import type { GeminiConfig } from '../../../src/providers/gemini/config';
 import {
-  GEMINI_DEFAULT_VOICE, GEMINI_DEFAULTS, defaultGeminiModel, geminiLanguageName, isGeminiTranslateModel, toTranslationLanguageCode,
+  GEMINI_DEFAULT_VOICE, GEMINI_DEFAULTS, defaultGeminiModel, geminiActivityHandling, geminiLanguageName, isGeminiTranslateModel, toTranslationLanguageCode,
 } from '../../../src/providers/gemini/settings';
 import { ACTIVITY_END, ACTIVITY_START, audioFrame, base64ToPcm, decodeServerMessage, liveUrl, pcmRate, setupFrame } from '../../../src/providers/gemini/wire';
 import { resolveInstructions } from '../../../src/lib/provider/instructions';
@@ -119,6 +119,8 @@ async function session(kind: 'dialogue' | 'translate', model: string, variant: V
     activity: manual
       ? { manual: true }
       : { manual: false, start: GEMINI_DEFAULTS.vadStartSensitivity, end: GEMINI_DEFAULTS.vadEndSensitivity, silenceMs: GEMINI_DEFAULTS.vadSilenceDurationMs, prefixMs: GEMINI_DEFAULTS.vadPrefixPaddingMs },
+    // The app's own rule; `--activity-handling` still overrides it below.
+    activityHandling: geminiActivityHandling(model),
   };
   const setup = setupFrame(config, null);
   const ric = setup.setup.realtimeInputConfig as Record<string, unknown>;
```

- [ ] **Step 4: Run Gemini's suites and check the probe's syntax.**

Run: `npx vitest run src/providers/gemini`
Expected: PASS — 15 files, 224 tests.

Run: `npx esbuild scripts/dev/wire-probe/gemini.mts --format=esm --log-level=warning --outfile=/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/t7-impl/probe-check.js`
Expected: no output.

- [ ] **Step 5: The gates.** The suite and the typecheck gate (in Wave 2, a failure in `src/providers/volcengine_ast2/**` is Task 6's).

- [ ] **Step 6: Commit.**

```bash
git add src/providers/gemini/settings.ts src/providers/gemini/settings.test.ts src/providers/gemini/config.ts src/providers/gemini/config.test.ts src/providers/gemini/wire.ts src/providers/gemini/wire.test.ts src/providers/gemini/wire.oracle.test.ts src/providers/gemini/adapter.ts src/providers/gemini/adapter.test.ts src/providers/gemini/turns.ts src/providers/gemini/testing.ts scripts/dev/wire-probe/gemini.mts
```

```bash
git commit -q -F - -- src/providers/gemini/settings.ts src/providers/gemini/settings.test.ts src/providers/gemini/config.ts src/providers/gemini/config.test.ts src/providers/gemini/wire.ts src/providers/gemini/wire.test.ts src/providers/gemini/wire.oracle.test.ts src/providers/gemini/adapter.ts src/providers/gemini/adapter.test.ts src/providers/gemini/turns.ts src/providers/gemini/testing.ts scripts/dev/wire-probe/gemini.mts <<'EOF'
feat(gemini): a 3.x dialogue model barges in; 2.5 and Live Translate do not

Under NO_INTERRUPTION gemini-3.8-live dropped the speech that arrived
while it answered, and barge-in kept both utterances whole; the 2.5
native-audio models are the opposite. The activity handling now follows
the model's family: 3.0 and later barge in, 2.5, an unversioned id and
Live Translate keep NO_INTERRUPTION. It rides GeminiConfig into the
setup frame and the session.opened frame; the wire probe uses the rule.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 8: Gemini's languages, Google's codes, per model family (Wave 3)

**Files:**
- Modify: `src/providers/gemini/settings.ts` (the language block `:98-146` replaced; `EXPLICIT_TRANSLATION_CODES` and `toTranslationLanguageCode`, `:169-176`, removed), `src/providers/gemini/config.ts` (the import, `translationTargetCode`'s doc, the refusal, the target sent), `scripts/dev/wire-probe/gemini.mts` (the codes)
- Test: `src/providers/gemini/settings.test.ts`, `src/providers/gemini/config.test.ts`, `src/providers/gemini/wire.test.ts`, `src/providers/gemini/wire.oracle.test.ts`, `src/providers/gemini/GeminiSettings.test.tsx`, `src/providers/gemini/provider.test.ts`, `src/providers/gemini/check.test.ts`, `src/providers/gemini/testing.ts`

**Interfaces:**
- Consumes: Task 7's files; `providerStore`'s `migratePair` and `initial` (landed); `reverseSupported` (landed).
- Produces (`settings.ts`): `GEMINI_DIALOGUE_LANGUAGES` (99), `GEMINI_TRANSLATE_TARGETS` (78), `GEMINI_TRANSLATE_SOURCES` (101), all `readonly LanguageOption[]`; `geminiLanguages` with `sources(s)`, `targets(source, s)` by `s.model`'s family, `initial()` = `{ source: 'en', target: 'ja' }`, `migratePair(stored, s)`; `geminiLanguageName(code)` over the 101. Removed: `GEMINI_LANGUAGES`, `toTranslationLanguageCode`. `buildGemini` may now return `{ refused }` for a Live Translate target outside the 78. The fixtures' `AUTO_CTX` is `en` → `ja`.

- [ ] **Step 1: Write the failing tests** (ruling 6; choices 14–18): the documented codes, the offers per family, the stored pair's fall, the English names, the builder's target and refusal, the stored profile's load, and every fixture and expectation that named an old code:

```diff
diff --git a/src/providers/gemini/GeminiSettings.test.tsx b/src/providers/gemini/GeminiSettings.test.tsx
--- a/src/providers/gemini/GeminiSettings.test.tsx
+++ b/src/providers/gemini/GeminiSettings.test.tsx
@@ -23,7 +23,7 @@ const TRANSLATE = 'gemini-3.5-live-translate-preview';
 const props = (patch: Partial<SettingsProps<GeminiSettings>> = {}): SettingsProps<GeminiSettings> => ({
   settings: { ...GEMINI_DEFAULTS, model: DIALOGUE },
   update: vi.fn(),
-  pair: { source: 'en-US', target: 'ja-JP' },
+  pair: { source: 'en', target: 'ja' },
   models: [{ id: TRANSLATE }, { id: DIALOGUE }],
   ...patch,
 });
@@ -35,7 +35,7 @@ describe('GeminiSettingsView', () => {
 
     fireEvent.click(screen.getByRole('button', { name: 'settings.preview' }));
     expect(container.querySelector('.preview-content')?.textContent).toContain(
-      'translate English (United States) → Japanese (Japan).'
+      'translate English → Japanese.'
     );
 
     fireEvent.click(screen.getByRole('button', { name: 'settings.advanced' }));
diff --git a/src/providers/gemini/check.test.ts b/src/providers/gemini/check.test.ts
--- a/src/providers/gemini/check.test.ts
+++ b/src/providers/gemini/check.test.ts
@@ -5,7 +5,7 @@ import { CHECK_TIMEOUT_MS, createGeminiCheck, GEMINI_MODELS_URL, MAX_MODEL_PAGES
 import { GEMINI_DEFAULTS } from './settings';
 
 const K = { apiKey: 'AIzaTestKey0123456789' };
-const ctx = (signal?: AbortSignal): CheckContext => ({ pair: { source: 'en-US', target: 'ja-JP' }, legs: ['speaker'], signal });
+const ctx = (signal?: AbortSignal): CheckContext => ({ pair: { source: 'en', target: 'ja' }, legs: ['speaker'], signal });
 const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
 const named = (...names: string[]) => names.map((name) => ({ name: `models/${name}` }));
 
diff --git a/src/providers/gemini/config.test.ts b/src/providers/gemini/config.test.ts
--- a/src/providers/gemini/config.test.ts
+++ b/src/providers/gemini/config.test.ts
@@ -6,7 +6,7 @@ import { GEMINI_DEFAULTS, type GeminiSettings } from './settings';
 
 const DIALOGUE = 'gemini-2.5-flash-native-audio-preview-12-2025';
 const TRANSLATE = 'gemini-3.5-live-translate-preview';
-const PAIR = { source: 'en-US', target: 'ja-JP' };
+const PAIR = { source: 'en', target: 'ja' };
 const shared = (patch: Partial<SharedSettings> = {}): SharedSettings => ({
   pauses: { sourceSeconds: 1.5, translationSeconds: 2 },
   reversed: (d) => d.source === PAIR.target && d.target === PAIR.source,
@@ -14,8 +14,8 @@ const shared = (patch: Partial<SharedSettings> = {}): SharedSettings => ({
   models: [{ id: TRANSLATE }, { id: DIALOGUE }],
   ...patch,
 });
-const SPEAKER: SessionContext = { direction: { source: 'en-US', target: 'ja-JP' }, speech: true, turns: 'auto' };
-const PARTICIPANT: SessionContext = { direction: { source: 'ja-JP', target: 'en-US' }, speech: true, turns: 'auto' };
+const SPEAKER: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
+const PARTICIPANT: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
 /** A leg's config: Gemini's defaults with the dialogue model saved, unless the patch saves another (or none). */
 const build = (patch: Partial<GeminiSettings> = {}, context = SPEAKER, sh = shared()) => buildGemini(context, { ...GEMINI_DEFAULTS, model: DIALOGUE, ...patch }, sh) as GeminiConfig;
 
@@ -29,18 +29,19 @@ describe("Gemini's builder", () => {
   it('runs a saved dialogue model, speaking, with the Quick prompt for its direction (rulings 2, 4)', () => {
     const c = build();
     expect(c).toMatchObject({ model: DIALOGUE, kind: 'dialogue', voice: 'Aoede', temperature: 0.8 });
-    expect(c.instructions).toContain('translate English (United States) → Japanese (Japan).');
+    expect(c.instructions).toContain('translate English → Japanese.');
     expect(c.activity).toEqual({ manual: false, start: 'low', end: 'high', silenceMs: 500, prefixMs: 300 });
     for (const absent of ['maxOutputTokens', 'translationTargetCode', 'silence'] as const) expect(c, absent).not.toHaveProperty(absent);
   });
 
-  it("builds Live Translate: its target's short code, no voice or sampling, its silence timers from the pauses (ruling 1)", () => {
+  it("builds Live Translate: its target as the pair holds it — one of its own codes (Gemini/AST2 follow-up, ruling 6) — no voice or sampling, its silence timers from the pauses (ruling 1)", () => {
     const c = build({ model: TRANSLATE, maxTokens: 2048 });
     expect(c).toMatchObject({ model: TRANSLATE, kind: 'translate', translationTargetCode: 'ja', silence: { sourceMs: 1500, translationMs: 2000, deferMidSentence: false } });
     for (const absent of ['voice', 'temperature', 'maxOutputTokens'] as const) expect(c, absent).not.toHaveProperty(absent);
     // The instruction is still sent: it corrects terminology (`geminiTranslateModel.ts:19-24`).
     expect(c.instructions).toBeTruthy();
-    expect(build({ model: TRANSLATE }, { ...SPEAKER, direction: { source: 'en-US', target: 'cmn-CN' } }).translationTargetCode).toBe('zh');
+    expect(build({ model: TRANSLATE }, { ...SPEAKER, direction: { source: 'en', target: 'zh-Hant' } }).translationTargetCode).toBe('zh-Hant');
+    expect(build({ model: TRANSLATE }, { ...SPEAKER, direction: { source: 'en', target: 'pt-PT' } }).translationTargetCode).toBe('pt-PT');
   });
 
   it("builds the participant as the same call on the reversed direction: Other's prompt, the reversed names, the reversed target", () => {
@@ -48,7 +49,7 @@ describe("Gemini's builder", () => {
     expect(build(advanced).instructions).toBe('mine');
     expect(build(advanced, PARTICIPANT).instructions).toBe('theirs');
     expect(build({ ...advanced, participantSystemInstructions: '  ' }, PARTICIPANT).instructions).toBe('mine');
-    expect(build({}, PARTICIPANT).instructions).toContain('translate Japanese (Japan) → English (United States).');
+    expect(build({}, PARTICIPANT).instructions).toContain('translate Japanese → English.');
     expect(build({ model: TRANSLATE }, PARTICIPANT).translationTargetCode).toBe('en');
   });
 
@@ -67,6 +68,13 @@ describe("Gemini's builder", () => {
     expect(build({}, { ...SPEAKER, turns: 'manual' }).activityHandling).toBe('NO_INTERRUPTION');
   });
 
+  it("refuses in words a Live Translate target outside its 78 — a saved dialogue model no longer listed runs as Live Translate — and sends nothing (Gemini/AST2 follow-up, choice 18)", () => {
+    const retired = build({ model: 'gemini-2.0-flash-live-001' }, { ...SPEAKER, direction: { source: 'en', target: 'fo' } });
+    expect(retired).toEqual({ refused: 'Live Translate does not translate into Faroese: choose another language, or a dialogue model.' });
+    // A dialogue model takes Faroese.
+    expect(build({}, { ...SPEAKER, direction: { source: 'en', target: 'fo' } })).toMatchObject({ kind: 'dialogue', model: DIALOGUE });
+  });
+
   it('marks activity itself under manual turns', () => {
     expect(build({}, { ...SPEAKER, turns: 'manual' }).activity).toEqual({ manual: true });
   });
diff --git a/src/providers/gemini/provider.test.ts b/src/providers/gemini/provider.test.ts
--- a/src/providers/gemini/provider.test.ts
+++ b/src/providers/gemini/provider.test.ts
@@ -73,9 +73,9 @@ describe('the Gemini definition', () => {
 
   it("lets the participant speak when its switch is on, voiced with Gemini's own voice (ruling 5)", () => {
     expect(geminiProvider.participantSpeech).toBeUndefined();
-    const shape = { provider: geminiProvider, pair: { source: 'en-US', target: 'ja-JP' }, legs: ['speaker', 'participant'], textOnly: false, participantSpeech: true, turnMode: 'auto' } as unknown as RunShape;
+    const shape = { provider: geminiProvider, pair: { source: 'en', target: 'ja' }, legs: ['speaker', 'participant'], textOnly: false, participantSpeech: true, turnMode: 'auto' } as unknown as RunShape;
     const participant = contextsFor(shape).participant!;
-    expect(participant).toEqual({ direction: { source: 'ja-JP', target: 'en-US' }, speech: true, turns: 'auto' });
+    expect(participant).toEqual({ direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' });
     expect(contextsFor({ ...shape, participantSpeech: false }).participant!.speech).toBe(false);
     // A dialogue model's voice: Live Translate, the default when listed, speaks in the speaker's own (Gemini/AST2 follow-up, ruling 3).
     expect((geminiProvider.build(participant, { ...GEMINI_DEFAULTS, model: DIALOGUE }, SHARED) as GeminiConfig).voice).toBe('Aoede');
@@ -110,4 +110,17 @@ describe('the Gemini definition', () => {
     await useProviderStore.getState().load(geminiProvider);
     expect((useProviderStore.getState().entries.gemini.settings as GeminiSettings).systemInstructions).toBe('Mine.');
   });
+
+  it("loads an old profile's pair, saved in the old regional codes, as the default pair — English → Japanese — writing nothing (Gemini/AST2 follow-up, ruling 6; choice 17)", async () => {
+    stored.set('settings.gemini.sourceLanguage', 'en-US');
+    stored.set('settings.gemini.targetLanguage', 'cmn-CN');
+    await useProviderStore.getState().load(geminiProvider);
+    expect(useProviderStore.getState().entries.gemini.pair).toEqual({ source: 'en', target: 'ja' });
+    expect(setSetting).not.toHaveBeenCalled();
+    // One side still offered stays.
+    stored.set('settings.gemini.sourceLanguage', 'pt-BR');
+    useProviderStore.setState({ entries: {} });
+    await useProviderStore.getState().load(geminiProvider);
+    expect(useProviderStore.getState().entries.gemini.pair).toEqual({ source: 'pt-BR', target: 'ja' });
+  });
 });
diff --git a/src/providers/gemini/settings.test.ts b/src/providers/gemini/settings.test.ts
--- a/src/providers/gemini/settings.test.ts
+++ b/src/providers/gemini/settings.test.ts
@@ -3,14 +3,34 @@ import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS } from '../../lib/provid
 import { AUTO, reverseSupported } from '../../lib/provider/languages';
 import type { AuthContext } from '../../lib/provider/types';
 import {
-  compareGeminiModels, defaultGeminiModel, effectiveGeminiModel, geminiActivityHandling, GEMINI_DEFAULTS, GEMINI_LANGUAGES, GEMINI_LEGACY_KEYS, GEMINI_VOICES,
-  geminiCredentials, geminiLanguageName, geminiLanguages, isGeminiLiveModel, isGeminiTranslateModel, migrateGeminiSettings,
-  sortGeminiModels, toTranslationLanguageCode,
+  compareGeminiModels, defaultGeminiModel, effectiveGeminiModel, geminiActivityHandling, GEMINI_DEFAULTS, GEMINI_DIALOGUE_LANGUAGES, GEMINI_LEGACY_KEYS,
+  GEMINI_TRANSLATE_SOURCES, GEMINI_TRANSLATE_TARGETS, GEMINI_VOICES, geminiCredentials, geminiLanguageName, geminiLanguages, isGeminiLiveModel,
+  isGeminiTranslateModel, migrateGeminiSettings, sortGeminiModels,
 } from './settings';
 
 const signedOut: AuthContext = { signedIn: false, getToken: async () => null };
 const migrate = (stored: Record<string, unknown>, legacy: Record<string, unknown> = {}) => migrateGeminiSettings(stored, { legacy, credentials: { apiKey: '' } });
 const ids = (list: readonly string[]) => list.map((id) => ({ id }));
+const values = (options: readonly { value: string }[]) => options.map((o) => o.value);
+const sorted = (codes: readonly string[]) => [...codes].sort();
+
+/** The Live API capabilities guide's 99 languages, as Google documented them on 2026-09-29 (Norwegian's row names `no, nb`; `no` is offered). */
+const DOCUMENTED_LIVE = [
+  'af', 'ak', 'sq', 'am', 'ar', 'hy', 'as', 'az', 'eu', 'be', 'bn', 'bs', 'bg', 'my', 'ca', 'ceb', 'zh-Hans', 'zh-Hant', 'hr', 'cs', 'da', 'nl',
+  'en', 'et', 'fo', 'fil', 'fi', 'fr', 'gl', 'ka', 'de', 'el', 'gu', 'ha', 'he', 'hi', 'hu', 'is', 'id', 'ga', 'it', 'ja', 'kn', 'kk', 'km', 'rw',
+  'ko', 'ku', 'ky', 'lo', 'lv', 'lt', 'mk', 'ms', 'ml', 'mt', 'mi', 'mr', 'mn', 'ne', 'no', 'or', 'om', 'ps', 'fa', 'pl', 'pt-BR', 'pt-PT', 'pa',
+  'qu', 'ro', 'rm', 'ru', 'sr', 'sd', 'si', 'sk', 'sl', 'so', 'st', 'es', 'sw', 'sv', 'tg', 'ta', 'te', 'th', 'tn', 'tr', 'tk', 'uk', 'ur', 'uz',
+  'vi', 'cy', 'fy', 'wo', 'yo', 'zu',
+];
+/** Live Translate's 78 `targetLanguageCode` values, as documented on 2026-09-29. */
+const DOCUMENTED_TRANSLATE = [
+  'af', 'ak', 'sq', 'am', 'ar', 'hy', 'az', 'eu', 'be', 'bn', 'bg', 'my', 'ca', 'zh-Hans', 'zh-Hant', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fil',
+  'fi', 'fr', 'gl', 'ka', 'de', 'el', 'gu', 'ha', 'he', 'hi', 'hu', 'is', 'id', 'it', 'ja', 'jv', 'kn', 'kk', 'km', 'rw', 'ko', 'lo', 'lv', 'lt',
+  'mk', 'ms', 'ml', 'mr', 'mn', 'ne', 'no', 'fa', 'pl', 'pt-BR', 'pt-PT', 'pa', 'ro', 'ru', 'sr', 'sd', 'si', 'sk', 'sl', 'es', 'su', 'sw', 'sv',
+  'ta', 'te', 'th', 'tr', 'uk', 'ur', 'uz', 'vi', 'zu',
+];
+const DIALOGUE_MODEL = { ...GEMINI_DEFAULTS, model: 'gemini-2.5-flash-native-audio-preview-12-2025' };
+const TRANSLATE_MODEL = { ...GEMINI_DEFAULTS, model: 'gemini-3.5-live-translate-preview' };
 
 /** A realistic Developer API listing (2026-09): the Live ids the repo's tests and benchmark docs name, the dated native-audio previews, and the ids the Live filter drops. */
 const LISTED = [
@@ -87,20 +107,63 @@ describe("Gemini's credentials and languages", () => {
     expect(geminiCredentials.read({ apiKey: 'k' }, signedOut)).toEqual({ apiKey: 'k' });
   });
 
-  it("offer the old 34 regional values as sources and as every source's targets, never auto, and start en-US → ja-JP", () => {
-    expect(GEMINI_LANGUAGES).toHaveLength(34);
-    expect(geminiLanguages.sources(GEMINI_DEFAULTS)).toBe(GEMINI_LANGUAGES);
-    expect(geminiLanguages.targets('ja-JP', GEMINI_DEFAULTS)).toBe(GEMINI_LANGUAGES);
-    expect(GEMINI_LANGUAGES.map((o) => o.value)).not.toContain(AUTO);
-    expect(GEMINI_LANGUAGES.map((o) => o.value)).toEqual(expect.arrayContaining(['en-US', 'ja-JP', 'cmn-CN', 'ar-XA', 'uk-UA']));
-    expect(geminiLanguages.initial?.(GEMINI_DEFAULTS)).toEqual({ source: 'en-US', target: 'ja-JP' });
-    expect(reverseSupported({ languages: geminiLanguages }, GEMINI_DEFAULTS, { source: 'en-US', target: 'ja-JP' })).toBe(true);
+  it("hold Google's documented codes exactly: the Live API's 99 for a dialogue model, Live Translate's 78 as its targets, their union as its sources (Gemini/AST2 follow-up, ruling 6)", () => {
+    expect(sorted(values(GEMINI_DIALOGUE_LANGUAGES))).toEqual(sorted(DOCUMENTED_LIVE));
+    expect(sorted(values(GEMINI_TRANSLATE_TARGETS))).toEqual(sorted(DOCUMENTED_TRANSLATE));
+    expect(sorted(values(GEMINI_TRANSLATE_SOURCES))).toEqual(sorted([...new Set([...DOCUMENTED_LIVE, ...DOCUMENTED_TRANSLATE])]));
+    expect([GEMINI_DIALOGUE_LANGUAGES.length, GEMINI_TRANSLATE_TARGETS.length, GEMINI_TRANSLATE_SOURCES.length]).toEqual([99, 78, 101]);
+    // Live Translate translates into two languages the Live API's table lacks.
+    expect(DOCUMENTED_TRANSLATE.filter((code) => !DOCUMENTED_LIVE.includes(code))).toEqual(['jv', 'su']);
+    for (const list of [GEMINI_DIALOGUE_LANGUAGES, GEMINI_TRANSLATE_TARGETS, GEMINI_TRANSLATE_SOURCES]) {
+      expect(values(list)).not.toContain(AUTO);
+      expect(new Set(values(list)).size).toBe(list.length);
+      // English first, then Google's order, by English name (Gemini/AST2 follow-up, choice 14).
+      expect(list[0].value).toBe('en');
+      const rest = list.slice(1).map((o) => o.englishName);
+      expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'en')));
+      for (const o of list) expect(o.name.trim(), o.value).not.toBe('');
+    }
+    // No region variant but the two Google documents; none of the old codes.
+    expect(values(GEMINI_TRANSLATE_SOURCES).filter((code) => code.includes('-'))).toEqual(['zh-Hans', 'zh-Hant', 'pt-BR', 'pt-PT']);
+    for (const old of ['en-US', 'ja-JP', 'cmn-CN', 'ar-XA', 'nl-BE']) expect(values(GEMINI_TRANSLATE_SOURCES)).not.toContain(old);
   });
 
-  it("name a code in English for the instructions' template, and fall back to the code", () => {
-    expect(geminiLanguageName('ja-JP')).toBe('Japanese (Japan)');
-    expect(geminiLanguageName('cmn-CN')).toBe('Mandarin Chinese (China)');
-    expect(geminiLanguageName('xx-YY')).toBe('xx-YY');
+  it("offer by the saved model's family: a dialogue model the 99 both ways; Live Translate — and no model chosen, its default — its sources and its 78 targets (Gemini/AST2 follow-up, choice 16)", () => {
+    expect(geminiLanguages.sources(DIALOGUE_MODEL)).toBe(GEMINI_DIALOGUE_LANGUAGES);
+    expect(geminiLanguages.targets('en', DIALOGUE_MODEL)).toBe(GEMINI_DIALOGUE_LANGUAGES);
+    for (const s of [TRANSLATE_MODEL, GEMINI_DEFAULTS]) {
+      expect(geminiLanguages.sources(s)).toBe(GEMINI_TRANSLATE_SOURCES);
+      expect(geminiLanguages.targets('en', s)).toBe(GEMINI_TRANSLATE_TARGETS);
+    }
+    expect(geminiLanguages.initial?.(GEMINI_DEFAULTS)).toEqual({ source: 'en', target: 'ja' });
+    const reverses = (s: typeof GEMINI_DEFAULTS, source: string, target: string) => reverseSupported({ languages: geminiLanguages }, s, { source, target });
+    expect(reverses(DIALOGUE_MODEL, 'en', 'ja')).toBe(true);
+    expect(reverses(TRANSLATE_MODEL, 'en', 'ja')).toBe(true);
+    // Live Translate: a source outside its 78 cannot be the participant's target, so Both is refused (D20).
+    expect(reverses(TRANSLATE_MODEL, 'as', 'en')).toBe(false);
+    expect(reverses(DIALOGUE_MODEL, 'as', 'en')).toBe(true);
+    // Javanese, Live Translate's own: a source and a target of it, none of a dialogue model.
+    expect(reverses(TRANSLATE_MODEL, 'en', 'jv')).toBe(true);
+    expect(values(GEMINI_DIALOGUE_LANGUAGES)).not.toContain('jv');
+  });
+
+  it("let a stored side the offer does not hold take initial's — any pair saved before the rebuild — and keep one it holds; nothing converted (Gemini/AST2 follow-up, choice 17)", () => {
+    const migrate = (s: typeof GEMINI_DEFAULTS, source: string, target: string) => geminiLanguages.migratePair!({ source, target }, s);
+    expect(migrate(GEMINI_DEFAULTS, 'en-US', 'ja-JP')).toEqual({ source: '', target: '' });
+    expect(migrate(GEMINI_DEFAULTS, 'pt-BR', 'cmn-CN')).toEqual({ source: 'pt-BR', target: '' });
+    expect(migrate(GEMINI_DEFAULTS, 'zh-Hant', 'pt-PT')).toEqual({ source: 'zh-Hant', target: 'pt-PT' });
+    // Faroese: a dialogue model's target, not Live Translate's.
+    expect(migrate(DIALOGUE_MODEL, 'en', 'fo')).toEqual({ source: 'en', target: 'fo' });
+    expect(migrate(TRANSLATE_MODEL, 'en', 'fo')).toEqual({ source: 'en', target: '' });
+    expect(migrate(GEMINI_DEFAULTS, '', '')).toEqual({ source: '', target: '' });
+  });
+
+  it("name a code in English — Google's name — for the instructions' template, and fall back to the code", () => {
+    expect(geminiLanguageName('ja')).toBe('Japanese');
+    expect(geminiLanguageName('zh-Hant')).toBe('Chinese (Traditional)');
+    expect(geminiLanguageName('pt-PT')).toBe('Portuguese (Portugal)');
+    expect(geminiLanguageName('jv')).toBe('Javanese');
+    expect(geminiLanguageName('xx')).toBe('xx');
   });
 
   it('offer the old 30 prebuilt voices, Aoede first', () => {
@@ -119,14 +182,6 @@ describe("Gemini's models", () => {
     expect(isGeminiTranslateModel('')).toBe(false);
   });
 
-  it("reduce a target to Live Translate's short code, Mandarin to zh (`geminiTranslateModel.test.ts:47-70`)", () => {
-    expect(toTranslationLanguageCode('ja-JP')).toBe('ja');
-    expect(toTranslationLanguageCode('en-US')).toBe('en');
-    expect(toTranslationLanguageCode('pt-BR')).toBe('pt');
-    expect(toTranslationLanguageCode('ar-XA')).toBe('ar');
-    expect(toTranslationLanguageCode('cmn-CN')).toBe('zh');
-  });
-
   it('keep the Live models by the old rule: audio or live in the id, never transcribe (`GeminiClient.test.ts:963-993`)', () => {
     expect(LISTED.filter(isGeminiLiveModel).sort()).toEqual([...LIVE_NEWEST_FIRST].sort());
     expect(isGeminiLiveModel('gemini-3.5-transcribe-live')).toBe(false);
diff --git a/src/providers/gemini/testing.ts b/src/providers/gemini/testing.ts
--- a/src/providers/gemini/testing.ts
+++ b/src/providers/gemini/testing.ts
@@ -32,11 +32,11 @@ export class RefusingWebSocket {
 
 export const SHARED: SharedSettings = {
   pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
-  reversed: (d) => d.source === 'ja-JP' && d.target === 'en-US',
+  reversed: (d) => d.source === 'ja' && d.target === 'en',
   segmentation: { mode: 'pause', sentencesPerRow: 0 },
   models: [{ id: BARGE_IN }, { id: TRANSLATE }, { id: DIALOGUE }],
 };
-export const AUTO_CTX: SessionContext = { direction: { source: 'en-US', target: 'ja-JP' }, speech: true, turns: 'auto' };
+export const AUTO_CTX: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
 
 /** A leg's config: Gemini's defaults with `model` saved. */
 export function configFor(model: string, context: SessionContext = AUTO_CTX, patch: Partial<GeminiSettings> = {}): GeminiConfig {
diff --git a/src/providers/gemini/wire.oracle.test.ts b/src/providers/gemini/wire.oracle.test.ts
--- a/src/providers/gemini/wire.oracle.test.ts
+++ b/src/providers/gemini/wire.oracle.test.ts
@@ -77,7 +77,7 @@ describe("the wire against the SDK's own converter", () => {
     ['a 3.x dialogue model, barging in', () => configFor(BARGE_IN), null],
     ['a 3.x dialogue model, manual, barging in', () => configFor(BARGE_IN, { ...AUTO_CTX, turns: 'manual' }), null],
     ['Live Translate', () => configFor(TRANSLATE), null],
-    ["Live Translate for the participant, with no prompt", () => configFor(TRANSLATE, { direction: { source: 'ja-JP', target: 'en-US' }, speech: true, turns: 'auto' }, { useTemplateMode: false, systemInstructions: ' ' }), null],
+    ["Live Translate for the participant, with no prompt", () => configFor(TRANSLATE, { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' }, { useTemplateMode: false, systemInstructions: ' ' }), null],
   ];
 
   it.each(cases)('%s', async (_name, make, handle) => {
diff --git a/src/providers/gemini/wire.test.ts b/src/providers/gemini/wire.test.ts
--- a/src/providers/gemini/wire.test.ts
+++ b/src/providers/gemini/wire.test.ts
@@ -4,7 +4,7 @@ import {
   ACTIVITY_END, ACTIVITY_START, audioFrame, base64ToPcm, closeFailureCode, decodeServerMessage, INPUT_MIME, liveUrl, pcmRate, pcmToBase64, setupFrame, textFrame,
 } from './wire';
 
-const PARTICIPANT = { direction: { source: 'ja-JP', target: 'en-US' }, speech: true, turns: 'auto' as const };
+const PARTICIPANT = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' as const };
 
 describe("Gemini's wire", () => {
   it('dials the documented Live endpoint, v1beta, the key in the query (choice 11)', () => {
@@ -17,7 +17,7 @@ describe("Gemini's wire", () => {
       setup: {
         model: `models/${DIALOGUE}`,
         generationConfig: { responseModalities: ['AUDIO'], temperature: 0.8, speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } } },
-        systemInstruction: { parts: [{ text: expect.stringContaining('translate English (United States) → Japanese (Japan).') }] },
+        systemInstruction: { parts: [{ text: expect.stringContaining('translate English → Japanese.') }] },
         inputAudioTranscription: {},
         outputAudioTranscription: {},
         realtimeInputConfig: {
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/gemini`
Expected: FAIL — `5 failed | 10 passed (15)` files, `11 failed | 216 passed (227)` tests: the old 34 codes and their regional English names ("English (United States)"), no per-family offer, no `migratePair`, no refusal.

- [ ] **Step 3: The table, the offers, the fall, the refusal, the probe.**

```diff
diff --git a/scripts/dev/wire-probe/gemini.mts b/scripts/dev/wire-probe/gemini.mts
--- a/scripts/dev/wire-probe/gemini.mts
+++ b/scripts/dev/wire-probe/gemini.mts
@@ -8,7 +8,7 @@
  * audio's, and how far would an arrival alignment (OpenAI's) or an even
  * interpolation be from each other.
  *
- *   GEMINI_API_KEY=… npx tsx scripts/dev/wire-probe/gemini.mts [dialogue|translate|both] [--model <id>] [--src ja-JP --dst en-US] [--gap <ms>]
+ *   GEMINI_API_KEY=… npx tsx scripts/dev/wire-probe/gemini.mts [dialogue|translate|both] [--model <id>] [--src ja --dst en] [--gap <ms>]
  *     [--activity-handling NO_INTERRUPTION|START_OF_ACTIVITY_INTERRUPTS] [--turn-coverage TURN_INCLUDES_ONLY_ACTIVITY|TURN_INCLUDES_ALL_INPUT]
  *   GEMINI_API_KEY=… npx tsx scripts/dev/wire-probe/gemini.mts translate --manual
  *     Push-to-talk, as the app sends it: detection off, activityStart / the utterance / activityEnd,
@@ -22,7 +22,7 @@ import WebSocket from 'ws';
 import { checkGemini } from '../../../src/providers/gemini/check';
 import type { GeminiConfig } from '../../../src/providers/gemini/config';
 import {
-  GEMINI_DEFAULT_VOICE, GEMINI_DEFAULTS, defaultGeminiModel, geminiActivityHandling, geminiLanguageName, isGeminiTranslateModel, toTranslationLanguageCode,
+  GEMINI_DEFAULT_VOICE, GEMINI_DEFAULTS, defaultGeminiModel, geminiActivityHandling, geminiLanguageName, isGeminiTranslateModel,
 } from '../../../src/providers/gemini/settings';
 import { ACTIVITY_END, ACTIVITY_START, audioFrame, base64ToPcm, decodeServerMessage, liveUrl, pcmRate, setupFrame } from '../../../src/providers/gemini/wire';
 import { resolveInstructions } from '../../../src/lib/provider/instructions';
@@ -42,8 +42,9 @@ const { step, opt } = args();
 const kinds = step === 'dialogue' || step === 'translate' ? [step] : ['dialogue', 'translate'];
 const gapMs = Number(opt('gap') ?? (step === 'overlap' ? 1500 : 2500));
 const manual = process.argv.includes('--manual');
-const src = opt('src') ?? 'ja-JP';
-const dst = opt('dst') ?? 'en-US';
+// The app's own codes (Gemini/AST2 follow-up, ruling 6): Google's, which Live Translate takes as they are.
+const src = opt('src') ?? 'ja';
+const dst = opt('dst') ?? 'en';
 
 interface Arrival { t: number; kind: 'audio' | 'text'; samples?: number; rate?: number; chars?: number }
 interface Turn { index: number; events: Arrival[]; text: string; input: string; audio: Int16Array[]; rate: number; end?: string }
@@ -115,7 +116,7 @@ async function session(kind: 'dialogue' | 'translate', model: string, variant: V
     model,
     kind,
     instructions: resolveInstructions(GEMINI_DEFAULTS, { participant: false, source: geminiLanguageName(src), target: geminiLanguageName(dst) }),
-    ...(dialogue ? { voice: GEMINI_DEFAULT_VOICE, temperature: GEMINI_DEFAULTS.temperature } : { translationTargetCode: toTranslationLanguageCode(dst) }),
+    ...(dialogue ? { voice: GEMINI_DEFAULT_VOICE, temperature: GEMINI_DEFAULTS.temperature } : { translationTargetCode: dst }),
     activity: manual
       ? { manual: true }
       : { manual: false, start: GEMINI_DEFAULTS.vadStartSensitivity, end: GEMINI_DEFAULTS.vadEndSensitivity, silenceMs: GEMINI_DEFAULTS.vadSilenceDurationMs, prefixMs: GEMINI_DEFAULTS.vadPrefixPaddingMs },
diff --git a/src/providers/gemini/config.ts b/src/providers/gemini/config.ts
--- a/src/providers/gemini/config.ts
+++ b/src/providers/gemini/config.ts
@@ -12,7 +12,7 @@ import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
 import { clampSegmentPauseMs, segmentPauseMs } from '../../lib/segmentation/segmentationMode';
 import {
   effectiveGeminiModel, geminiActivityHandling, geminiLanguageName, GEMINI_DEFAULTS, GEMINI_DEFAULT_VOICE, GEMINI_MAX_TOKENS_RANGE,
-  GEMINI_TEMPERATURE_RANGE, GEMINI_VAD_PREFIX_RANGE, GEMINI_VAD_SILENCE_RANGE, isGeminiTranslateModel, toTranslationLanguageCode,
+  GEMINI_TEMPERATURE_RANGE, GEMINI_TRANSLATE_TARGETS, GEMINI_VAD_PREFIX_RANGE, GEMINI_VAD_SILENCE_RANGE, isGeminiTranslateModel,
   type GeminiActivityHandling, type GeminiSettings,
 } from './settings';
 
@@ -29,7 +29,7 @@ export interface GeminiConfig {
   temperature?: number;
   /** Dialogue only, when not unlimited: 1..8192. */
   maxOutputTokens?: number;
-  /** Live Translate only: the target's short code, which pins its output language (`geminiTranslateModel.ts:12-18`). */
+  /** Live Translate only: the target, one of its own 78 codes as the pair holds it, which pins its output language (Gemini/AST2 follow-up, ruling 6). */
   translationTargetCode?: string;
   /** Manual turns: the client marks activity. Auto: the server detects it, with the user's knobs — the participant too (survey §1.9). */
   activity:
@@ -50,6 +50,11 @@ export function buildGemini(context: SessionContext, s: GeminiSettings, shared:
   const kind = isGeminiTranslateModel(model) ? 'translate' : 'dialogue';
   const dialogue = kind === 'dialogue';
   const { source, target } = context.direction;
+  // The offer follows the saved model; a saved dialogue model the check no longer lists runs as the default, Live Translate,
+  // whose targets are fewer: such a target is refused in words, never sent (Gemini/AST2 follow-up, choice 18).
+  if (!dialogue && !GEMINI_TRANSLATE_TARGETS.some((o) => o.value === target)) {
+    return { refused: `Live Translate does not translate into ${geminiLanguageName(target)}: choose another language, or a dialogue model.` };
+  }
   // The participant's direction reads Other's prompt, as LocalInference's builder does (`localInference/config.ts:47-56`).
   const instructions = resolveInstructions(s, { participant: shared.reversed(context.direction), source: geminiLanguageName(source), target: geminiLanguageName(target) });
   const activity: GeminiConfig['activity'] = context.turns === 'manual'
@@ -75,7 +80,7 @@ export function buildGemini(context: SessionContext, s: GeminiSettings, shared:
       ? { maxOutputTokens: Math.round(clamp(s.maxTokens, GEMINI_MAX_TOKENS_RANGE.min, GEMINI_MAX_TOKENS_RANGE.max, GEMINI_MAX_TOKENS_RANGE.max)) }
       : {}),
     ...(dialogue ? {} : {
-      translationTargetCode: toTranslationLanguageCode(target),
+      translationTargetCode: target,
       silence: {
         sourceMs: clampSegmentPauseMs(segmentPauseMs(shared.pauses.sourceSeconds)),
         translationMs: clampSegmentPauseMs(segmentPauseMs(shared.pauses.translationSeconds)),
diff --git a/src/providers/gemini/settings.ts b/src/providers/gemini/settings.ts
--- a/src/providers/gemini/settings.ts
+++ b/src/providers/gemini/settings.ts
@@ -95,54 +95,171 @@ export const GEMINI_VOICES: readonly { value: string; name: string }[] = [
   'Pulcherrima', 'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel', 'Vindemiatrix', 'Zubenelgenubi', 'Achernar',
 ].map((voice) => ({ value: voice, name: voice }));
 
-/** The 34 regional values the Live API takes (`GeminiProviderConfig.ts:139-174`). */
-export const GEMINI_LANGUAGES: readonly LanguageOption[] = [
-  { name: 'English (United States)', value: 'en-US', englishName: 'English (United States)' },
-  { name: 'English (Australia)', value: 'en-AU', englishName: 'English (Australia)' },
-  { name: 'English (United Kingdom)', value: 'en-GB', englishName: 'English (United Kingdom)' },
-  { name: 'English (India)', value: 'en-IN', englishName: 'English (India)' },
-  { name: 'Español (Estados Unidos)', value: 'es-US', englishName: 'Spanish (United States)' },
-  { name: 'Deutsch (Deutschland)', value: 'de-DE', englishName: 'German (Germany)' },
-  { name: 'Français (France)', value: 'fr-FR', englishName: 'French (France)' },
-  { name: 'हिन्दी (भारत)', value: 'hi-IN', englishName: 'Hindi (India)' },
-  { name: 'Português (Brasil)', value: 'pt-BR', englishName: 'Portuguese (Brazil)' },
-  { name: 'العربية (عام)', value: 'ar-XA', englishName: 'Arabic (Standard)' },
-  { name: 'Español (España)', value: 'es-ES', englishName: 'Spanish (Spain)' },
-  { name: 'Français (Canada)', value: 'fr-CA', englishName: 'French (Canada)' },
-  { name: 'Bahasa Indonesia (Indonesia)', value: 'id-ID', englishName: 'Indonesian (Indonesia)' },
-  { name: 'Italiano (Italia)', value: 'it-IT', englishName: 'Italian (Italy)' },
-  { name: '日本語 (日本)', value: 'ja-JP', englishName: 'Japanese (Japan)' },
-  { name: 'Türkçe (Türkiye)', value: 'tr-TR', englishName: 'Turkish (Turkey)' },
-  { name: 'Tiếng Việt (Việt Nam)', value: 'vi-VN', englishName: 'Vietnamese (Vietnam)' },
-  { name: 'বাংলা (ভারত)', value: 'bn-IN', englishName: 'Bengali (India)' },
-  { name: 'ગુજરાતી (ભારત)', value: 'gu-IN', englishName: 'Gujarati (India)' },
-  { name: 'ಕನ್ನಡ (ಭಾರತ)', value: 'kn-IN', englishName: 'Kannada (India)' },
-  { name: 'മലയാളം (ഇന്ത്യ)', value: 'ml-IN', englishName: 'Malayalam (India)' },
-  { name: 'मराठी (भारत)', value: 'mr-IN', englishName: 'Marathi (India)' },
-  { name: 'தமிழ் (இந்தியா)', value: 'ta-IN', englishName: 'Tamil (India)' },
-  { name: 'తెలుగు (భారతదేశం)', value: 'te-IN', englishName: 'Telugu (India)' },
-  { name: 'Nederlands (België)', value: 'nl-BE', englishName: 'Dutch (Belgium)' },
-  { name: 'Nederlands (Nederland)', value: 'nl-NL', englishName: 'Dutch (Netherlands)' },
-  { name: '한국어 (대한민국)', value: 'ko-KR', englishName: 'Korean (South Korea)' },
-  { name: '普通话 (中国)', value: 'cmn-CN', englishName: 'Mandarin Chinese (China)' },
-  { name: 'Polski (Polska)', value: 'pl-PL', englishName: 'Polish (Poland)' },
-  { name: 'Русский (Россия)', value: 'ru-RU', englishName: 'Russian (Russia)' },
-  { name: 'Kiswahili (Kenya)', value: 'sw-KE', englishName: 'Swahili (Kenya)' },
-  { name: 'ไทย (ประเทศไทย)', value: 'th-TH', englishName: 'Thai (Thailand)' },
-  { name: 'اردو (ہندوستان)', value: 'ur-IN', englishName: 'Urdu (India)' },
-  { name: 'Українська (Україна)', value: 'uk-UA', englishName: 'Ukrainian (Ukraine)' },
+/** Where Google documents a language (Gemini/AST2 follow-up, ruling 6): in both tables below, the Live API's alone, or Live Translate's alone. */
+type Documented = 'both' | 'dialogue' | 'translate';
+
+/**
+ * Google's two language tables, as documented on 2026-09-29, in one list:
+ * English first, then Google's own order, by English name (Gemini/AST2
+ * follow-up, ruling 6; choice 14):
+ * - the Live API capabilities guide's 99: what the dialogue models hear and
+ *   speak, with no language code on the wire — only the instructions name the
+ *   pair, by the English names here;
+ * - Live Translate's 78, its `targetLanguageCode` values. It takes no source
+ *   language: it detects it.
+ * Each code is Google's own — bare but for Portuguese's and Chinese's two
+ * variants each; Norwegian's row names `no` and `nb`, and `no` is offered.
+ * The names are each language's own, written here (Gemini/AST2 follow-up,
+ * choice 15).
+ */
+const GEMINI_LANGUAGE_TABLE: ReadonlyArray<readonly [value: string, name: string, englishName: string, documented: Documented]> = [
+  // First, as in the old list. A side a model switch takes out of the offer falls here by the generic rule (`normalizePair`
+  // takes the first entry), English → English included; a stored one takes `initial`'s (Gemini/AST2 follow-up, choice 17).
+  ['en', 'English', 'English', 'both'],
+  ['af', 'Afrikaans', 'Afrikaans', 'both'],
+  ['ak', 'Akan', 'Akan', 'both'],
+  ['sq', 'Shqip', 'Albanian', 'both'],
+  ['am', 'አማርኛ', 'Amharic', 'both'],
+  ['ar', 'العربية', 'Arabic', 'both'],
+  ['hy', 'Հայերեն', 'Armenian', 'both'],
+  ['as', 'অসমীয়া', 'Assamese', 'dialogue'],
+  ['az', 'Azərbaycan', 'Azerbaijani', 'both'],
+  ['eu', 'Euskara', 'Basque', 'both'],
+  ['be', 'Беларуская', 'Belarusian', 'both'],
+  ['bn', 'বাংলা', 'Bengali', 'both'],
+  ['bs', 'Bosanski', 'Bosnian', 'dialogue'],
+  ['bg', 'Български', 'Bulgarian', 'both'],
+  ['my', 'မြန်မာ', 'Burmese', 'both'],
+  ['ca', 'Català', 'Catalan', 'both'],
+  ['ceb', 'Cebuano', 'Cebuano', 'dialogue'],
+  ['zh-Hans', '中文 (简体)', 'Chinese (Simplified)', 'both'],
+  ['zh-Hant', '中文 (繁體)', 'Chinese (Traditional)', 'both'],
+  ['hr', 'Hrvatski', 'Croatian', 'both'],
+  ['cs', 'Čeština', 'Czech', 'both'],
+  ['da', 'Dansk', 'Danish', 'both'],
+  ['nl', 'Nederlands', 'Dutch', 'both'],
+  ['et', 'Eesti', 'Estonian', 'both'],
+  ['fo', 'Føroyskt', 'Faroese', 'dialogue'],
+  ['fil', 'Filipino', 'Filipino', 'both'],
+  ['fi', 'Suomi', 'Finnish', 'both'],
+  ['fr', 'Français', 'French', 'both'],
+  ['gl', 'Galego', 'Galician', 'both'],
+  ['ka', 'ქართული', 'Georgian', 'both'],
+  ['de', 'Deutsch', 'German', 'both'],
+  ['el', 'Ελληνικά', 'Greek', 'both'],
+  ['gu', 'ગુજરાતી', 'Gujarati', 'both'],
+  ['ha', 'Hausa', 'Hausa', 'both'],
+  ['he', 'עברית', 'Hebrew', 'both'],
+  ['hi', 'हिन्दी', 'Hindi', 'both'],
+  ['hu', 'Magyar', 'Hungarian', 'both'],
+  ['is', 'Íslenska', 'Icelandic', 'both'],
+  ['id', 'Bahasa Indonesia', 'Indonesian', 'both'],
+  ['ga', 'Gaeilge', 'Irish', 'dialogue'],
+  ['it', 'Italiano', 'Italian', 'both'],
+  ['ja', '日本語', 'Japanese', 'both'],
+  ['jv', 'Basa Jawa', 'Javanese', 'translate'],
+  ['kn', 'ಕನ್ನಡ', 'Kannada', 'both'],
+  ['kk', 'Қазақ тілі', 'Kazakh', 'both'],
+  ['km', 'ខ្មែរ', 'Khmer', 'both'],
+  ['rw', 'Ikinyarwanda', 'Kinyarwanda', 'both'],
+  ['ko', '한국어', 'Korean', 'both'],
+  ['ku', 'Kurdî', 'Kurdish', 'dialogue'],
+  ['ky', 'Кыргызча', 'Kyrgyz', 'dialogue'],
+  ['lo', 'ລາວ', 'Lao', 'both'],
+  ['lv', 'Latviešu', 'Latvian', 'both'],
+  ['lt', 'Lietuvių', 'Lithuanian', 'both'],
+  ['mk', 'Македонски', 'Macedonian', 'both'],
+  ['ms', 'Bahasa Melayu', 'Malay', 'both'],
+  ['ml', 'മലയാളം', 'Malayalam', 'both'],
+  ['mt', 'Malti', 'Maltese', 'dialogue'],
+  ['mi', 'Māori', 'Maori', 'dialogue'],
+  ['mr', 'मराठी', 'Marathi', 'both'],
+  ['mn', 'Монгол', 'Mongolian', 'both'],
+  ['ne', 'नेपाली', 'Nepali', 'both'],
+  ['no', 'Norsk', 'Norwegian', 'both'],
+  ['or', 'ଓଡ଼ିଆ', 'Odia', 'dialogue'],
+  ['om', 'Oromoo', 'Oromo', 'dialogue'],
+  ['ps', 'پښتو', 'Pashto', 'dialogue'],
+  ['fa', 'فارسی', 'Persian', 'both'],
+  ['pl', 'Polski', 'Polish', 'both'],
+  ['pt-BR', 'Português (Brasil)', 'Portuguese (Brazil)', 'both'],
+  ['pt-PT', 'Português (Portugal)', 'Portuguese (Portugal)', 'both'],
+  ['pa', 'ਪੰਜਾਬੀ', 'Punjabi', 'both'],
+  ['qu', 'Runasimi', 'Quechua', 'dialogue'],
+  ['ro', 'Română', 'Romanian', 'both'],
+  ['rm', 'Rumantsch', 'Romansh', 'dialogue'],
+  ['ru', 'Русский', 'Russian', 'both'],
+  ['sr', 'Српски', 'Serbian', 'both'],
+  ['sd', 'سنڌي', 'Sindhi', 'both'],
+  ['si', 'සිංහල', 'Sinhala', 'both'],
+  ['sk', 'Slovenčina', 'Slovak', 'both'],
+  ['sl', 'Slovenščina', 'Slovenian', 'both'],
+  ['so', 'Soomaali', 'Somali', 'dialogue'],
+  ['st', 'Sesotho', 'Southern Sotho', 'dialogue'],
+  ['es', 'Español', 'Spanish', 'both'],
+  ['su', 'Basa Sunda', 'Sundanese', 'translate'],
+  ['sw', 'Kiswahili', 'Swahili', 'both'],
+  ['sv', 'Svenska', 'Swedish', 'both'],
+  ['tg', 'Тоҷикӣ', 'Tajik', 'dialogue'],
+  ['ta', 'தமிழ்', 'Tamil', 'both'],
+  ['te', 'తెలుగు', 'Telugu', 'both'],
+  ['th', 'ไทย', 'Thai', 'both'],
+  ['tn', 'Setswana', 'Tswana', 'dialogue'],
+  ['tr', 'Türkçe', 'Turkish', 'both'],
+  ['tk', 'Türkmen dili', 'Turkmen', 'dialogue'],
+  ['uk', 'Українська', 'Ukrainian', 'both'],
+  ['ur', 'اردو', 'Urdu', 'both'],
+  ['uz', 'Oʻzbek', 'Uzbek', 'both'],
+  ['vi', 'Tiếng Việt', 'Vietnamese', 'both'],
+  ['cy', 'Cymraeg', 'Welsh', 'dialogue'],
+  ['fy', 'Frysk', 'Western Frisian', 'dialogue'],
+  ['wo', 'Wolof', 'Wolof', 'dialogue'],
+  ['yo', 'Èdè Yorùbá', 'Yoruba', 'dialogue'],
+  ['zu', 'isiZulu', 'Zulu', 'both'],
 ];
 
-/** Every value is a source and a target (the old `resolveTargetLanguages` returned the same list); no `auto`, so the participant leg always reverses (D20). */
+const offered = (documented: readonly Documented[]): readonly LanguageOption[] =>
+  GEMINI_LANGUAGE_TABLE.filter((row) => documented.includes(row[3])).map(([value, name, englishName]) => ({ value, name, englishName }));
+
+/** A dialogue model's sources and targets alike: the Live API's 99. */
+export const GEMINI_DIALOGUE_LANGUAGES = offered(['both', 'dialogue']);
+/** Live Translate's targets: its 78. */
+export const GEMINI_TRANSLATE_TARGETS = offered(['both', 'translate']);
+/** Live Translate's sources: every language Google documents either model hearing — the 99, and its own two besides (Gemini/AST2 follow-up, choice 16). */
+export const GEMINI_TRANSLATE_SOURCES = offered(['both', 'dialogue', 'translate']);
+
+/**
+ * The saved model's family decides the offer (Gemini/AST2 follow-up, choice
+ * 16): Live Translate's, or a dialogue model's. No model chosen ('') reads as
+ * Live Translate, the default a key that lists it runs (Gemini/AST2
+ * follow-up, ruling 3). A key that lists none runs a dialogue model on the
+ * Live Translate offer until a model is picked: narrower targets, each one a
+ * dialogue model takes too but Javanese and Sundanese, which only its
+ * instructions name.
+ */
+function offersTranslate(s: Pick<GeminiSettings, 'model'>): boolean {
+  return s.model === '' || isGeminiTranslateModel(s.model);
+}
+
+const lists = (options: readonly LanguageOption[], value: string) => options.some((o) => o.value === value);
+
+/** No `auto`: Live Translate detects the source, but the source still decides Both's reversal and the rows' labels (D20). */
 export const geminiLanguages: Provider<GeminiSettings, never, never>['languages'] = {
-  sources: () => GEMINI_LANGUAGES,
-  targets: () => GEMINI_LANGUAGES,
-  initial: () => ({ source: 'en-US', target: 'ja-JP' }),
+  sources: (s) => (offersTranslate(s) ? GEMINI_TRANSLATE_SOURCES : GEMINI_DIALOGUE_LANGUAGES),
+  targets: (_source, s) => (offersTranslate(s) ? GEMINI_TRANSLATE_TARGETS : GEMINI_DIALOGUE_LANGUAGES),
+  initial: () => ({ source: 'en', target: 'ja' }),
+  // A stored side the offer does not hold — every code saved before the rebuild but `pt-BR` (`en-US`, `cmn-CN`), or a language Google
+  // drops later — reads as nothing stored, so it takes `initial`'s, not the list's first. Nothing is converted and nothing written:
+  // it falls again at each load until the user picks (Gemini/AST2 follow-up, choice 17).
+  migratePair: (stored, s) => ({
+    source: lists(geminiLanguages.sources(s), stored.source) ? stored.source : '',
+    target: lists(geminiLanguages.targets(stored.source, s), stored.target) ? stored.target : '',
+  }),
 };
 
-/** A code's English name, for the instructions' template (the old rule: the code when unnamed, `settingsStore.ts:1443-1444`). */
+/** A code's English name — Google's — for the instructions' template (the old rule: the code when unnamed, `settingsStore.ts:1443-1444`). */
 export function geminiLanguageName(code: string): string {
-  return GEMINI_LANGUAGES.find((o) => o.value === code)?.englishName || code;
+  return GEMINI_TRANSLATE_SOURCES.find((o) => o.value === code)?.englishName || code;
 }
 
 export interface GeminiCredentials {
@@ -166,15 +283,6 @@ export function isGeminiTranslateModel(id: string | null | undefined): boolean {
   return typeof id === 'string' && id.includes(TRANSLATE_MODEL_MARKER);
 }
 
-/** `zh` came back Simplified, `cmn` Traditional (measured 2026-08-10, `geminiTranslateModel.ts:39-50`). */
-const EXPLICIT_TRANSLATION_CODES: Readonly<Record<string, string>> = { 'cmn-CN': 'zh' };
-
-/** A regional value as Live Translate's `targetLanguageCode` takes it (`ja-JP` → `ja`, `cmn-CN` → `zh`). */
-export function toTranslationLanguageCode(code: string): string {
-  if (!code) return '';
-  return EXPLICIT_TRANSLATION_CODES[code] ?? code.split('-')[0];
-}
-
 /** A Live (bidirectional) model by the old rule (`GeminiClient.ts:238-251`): the id names `audio` or `live`, and not `transcribe` — the STT-only Live models translate nothing. */
 export function isGeminiLiveModel(id: string): boolean {
   const lower = id.toLowerCase();
```

- [ ] **Step 4: Run every suite that reads a provider's languages.**

Run: `npx vitest run src/providers src/stores src/components/SetupWizard src/components/providers`
Expected: PASS — 164 files, 2 169 tests. The registry's language invariants (`registry.test.ts`: every provider offers a source and a target for each, in every context; the speaking offer within the text one) hold for both families: Gemini's functions ignore the context. `src/providers/gemini` alone: 15 files, 227 tests.

Run: `npx esbuild scripts/dev/wire-probe/gemini.mts --format=esm --log-level=warning --outfile=/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/t8-impl/probe-check.js`
Expected: no output.

- [ ] **Step 5: The gates.** The suite and the typecheck gate.

- [ ] **Step 6: Commit.**

```bash
git add src/providers/gemini/settings.ts src/providers/gemini/settings.test.ts src/providers/gemini/config.ts src/providers/gemini/config.test.ts src/providers/gemini/wire.test.ts src/providers/gemini/wire.oracle.test.ts src/providers/gemini/GeminiSettings.test.tsx src/providers/gemini/provider.test.ts src/providers/gemini/check.test.ts src/providers/gemini/testing.ts scripts/dev/wire-probe/gemini.mts
```

```bash
git commit -q -F - -- src/providers/gemini/settings.ts src/providers/gemini/settings.test.ts src/providers/gemini/config.ts src/providers/gemini/config.test.ts src/providers/gemini/wire.test.ts src/providers/gemini/wire.oracle.test.ts src/providers/gemini/GeminiSettings.test.tsx src/providers/gemini/provider.test.ts src/providers/gemini/check.test.ts src/providers/gemini/testing.ts scripts/dev/wire-probe/gemini.mts <<'EOF'
feat(gemini): Google's documented language codes, per model family

The 34 regional values were an old speech-config list: most of what the
models take was missing, cmn-CN and ar-XA are in no Google table, and
there was no Traditional Chinese. A dialogue model now offers the Live
API's 99 both ways; Live Translate its 78 as targets and those plus the
99 as sources. The codes are Google's own, sent to Live Translate as
they are. A stored side no longer offered takes the default pair's
(English to Japanese); nothing is converted. A Live Translate target
outside its 78 is refused in words.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Group check (controller, after Wave 3)

- [ ] The full gates: `npx vitest run src` at 0 failed with no unhandled errors (the scratch copy: 557 files passed and 1 skipped, 7 097 tests passed and 2 skipped); the typecheck gate at exactly the baseline, 259 lines in the full tree.
- [ ] `npx vitest run src/services` green: the old clients are untouched.
- [ ] `npm run build`, then `npm run extension:build`; `npx vitest run extension`.
- [ ] The three D24 greps print nothing.
- [ ] `command grep -rlF 'Live Translate does not translate into' build extension/dist` names at least one file under `build/` and one under `extension/dist/`.
- [ ] **Rendered, with no request to Google or Volcengine** (a fresh vite, `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort --force`, driven by `scripts/dev/headless.mjs`; outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/group-check/`). No key is typed and Start is never pressed:
  - select Google Gemini on a fresh profile: the pair reads English → Japanese; the source list holds 101 languages and the target list 78, English first (no model is saved: Live Translate's offer, choice 16); `中文 (繁體)` and `Português (Portugal)` are among the targets, `Basa Jawa` among both;
  - set `localStorage` `settings.gemini.model` to `gemini-2.5-flash-native-audio-preview-12-2025` and reload: 99 sources, 99 targets, no `Basa Jawa`;
  - clear that key, set `settings.gemini.sourceLanguage` to `en-US` and `settings.gemini.targetLanguage` to `cmn-CN`, and reload: the pair reads English → Japanese, and both keys still read `en-US` / `cmn-CN` (nothing written; choice 17);
  - the network log holds no request to `googleapis.com` or `bytedance.com`.
- [ ] Stop the vite; record the numbers and screenshots' paths for Task 9.

---

### Task 9: The spec's amendments and the roadmap's record (controller)

The controller's docs task, after the group check. It edits only the spec and the roadmap, and commits them together.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-client-contract-design.md`, `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`

- [ ] **Step 1: Amend the spec.** Each amendment is marked "(Stage 2 Gemini/AST2 follow-up, ruling / choice N)" in the text, as the earlier plans' are. Anchors are by heading and content (lines read at `4f7c6b83`):
  1. **D4** (the Decisions table, `:82`): append "**Amended by the Stage 2 Gemini/AST2 follow-up:** a range by arrival is a stated exception, not a real range — OpenAI Translate's, OpenAI Realtime's and Gemini's, each by the owner's ruling ("Risks"). Doubao AST 2.0's whole-sentence range is a real one: the TTS sentence carries its translation subtitle's server times (ruling 1)."
  2. **"L0 — the client contract" → "What every adapter must honour", the `frame` bullet** (`:321-330`): after "OpenAI Realtime's need none either: …", add "Gemini's `turn.tail` and `turn.tail_end`, OpenAI Translate's names, need none; Doubao's `tts.sentence_start` keeps its row with the sentence's times added (`ref` — the lock's —, `startTime`, `endTime`, `sequence`), and its new `tts.clip` (`ref`, `matched`, `range`, one per clip as it goes to L1) needs none (choice 5)."
  3. **"Turns" → "What each provider can do", the Gemini row** (`:450`): Automatic turns → "server activity detection, configurable; a dialogue model of family 3.0 or later barges in (`START_OF_ACTIVITY_INTERRUPTS`), 2.5, an unversioned id and Live Translate do not (ruling 5; choice 9)"; Ending on release → "`activityEnd`; on Live Translate first real-time silence inside the press's activity — 100 ms frames until no transcription for 1 s, at most 3 s, counted in beats — then `activityEnd` (ruling 4; choices 11, 12)"; Precision → "immediate; Live Translate after silence".
  4. **"Turns" → "The design", the Gemini row** (`:481`): `beginTurn` → "`activityStart`; on Live Translate a press ends a tail still running, its `activityEnd` first" (choice 11); `endTurn` → "`activityEnd`; on Live Translate the release tail, then `activityEnd`"; `cancelTurn`'s Live Translate clause → "on Live Translate the same tail, framed `cancelled`, then `activityEnd` (ruling 4)". After the table: "A Gemini dialogue model gets no tail: its `activityEnd` ends a turn it answers whole (choice 13)."
  5. **"Provider capability", the table** (`:1037-1038`): the `GeminiClient` row → Karaoke "per audio chunk, **by arrival**, as OpenAI Translate's and OpenAI Realtime's: each played chunk of an open translation carries its text from the previous chunk's end to its length when the chunk arrived, `[0, 0]` before any text; the text only grows, so nothing is restated. Live Translate's stream is real time with its text 0–0.3 s ahead, so its karaoke is phrase-level and holds through its silent chunks. The third stated exception to the honesty rule (Stage 2 Gemini/AST2 follow-up, ruling 2; choice 7)"; the `VolcengineAST2Client` row → Karaoke "per TTS sentence — the whole translation subtitle whose server times the sentence carries (8 of 8 in the owner's probe), matched as its clip is emitted and stated once the subtitle closes: at the clip's emission, or by `speechRanges` at the close; a sentence whose times name no recent translation plays rangeless on the old lock, read at the sentence's start (ruling 1; choices 2–4)". Its old wording that the server's TTS sentence boundaries need not align with the subtitles goes: the probe shows them equal. Its pairing column keeps "inferred by proximity" and adds: "every source subtitle carries its translation's times in the owner's probe — evidence for stated pairing, not taken yet".
  6. **"Risks", the karaoke bullet** (`:2314-2322`): "Gemini's arrival ranges are the third, by the same kind of ruling (Stage 2 Gemini/AST2 follow-up, ruling 2). Doubao's whole-sentence ranges are no exception: the TTS sentence states which subtitle it speaks by carrying its server times (ruling 1)."
  7. **"Readiness is one check", the effective-model paragraph** (`:1383-1387`): "Gemini's newest is the newest native-audio dialogue model — …" → "Gemini's default is the newest listed Live Translate (Stage 2 Gemini/AST2 follow-up, ruling 3; choice 8), else the newest native-audio dialogue model — by family …"; append "Nothing is migrated: a saved model the check lists stays."
  8. **"Languages are two functions"**:
     - after the paragraph on the language context (`:1407-1418`), add: "**The offer may depend on the settings too** (Stage 2 Gemini/AST2 follow-up, ruling 6; choice 16). Gemini's follows the saved model's family: a dialogue model offers the Live API's 99 languages both ways; Live Translate its 78 as targets and those and the 99 as sources — it detects the source, which still decides Both's reversal and the rows' labels. No model saved reads as Live Translate, the default. A Live Translate source outside its 78 refuses the participant leg by D20's generic rule. A Live Translate target outside its 78 — possible when a saved dialogue model the check no longer lists runs as the default — is refused at build in words (choice 18)."
     - the codes paragraph (`:1428-1432`): "Gemini's `en-US` and `cmn-CN` (shown as regional badges ("JA-JP", "CMN-CN"); the subtitle bar's two-letter code reads the base language ("ZH"))" → "Gemini's Google-documented `en`, `zh-Hans`, `pt-PT` (badges "JA", "ZH-HANS"; the subtitle bar reads "ZH"; Stage 2 Gemini/AST2 follow-up, ruling 6)"; and after "survive the move": "A stored side the offer no longer holds takes `initial`'s through Gemini's `migratePair`, which converts nothing and runs on every load (choice 17): a Gemini pair saved before the rebuild falls to English → Japanese, except a side stored as `pt-BR`, the one old code Google still documents; nothing is written, so it falls on each load until re-picked — a stated departure for the release note. A model switch that narrows the offer falls to the list's first entry by the generic rule, English, even to English → English."
  9. **"L0 — the client contract", the `speechRanges` paragraph** (`:263-266`, "The segment may already be closed: L1 measures the ranges against the text the adapter last sent …"): append "An `audio` range that arrives after the fill-in is measured the same way: against the adapter's own text, re-anchored onto the filled one, dropped with a diagnostic when it does not fit (Stage 2 Gemini/AST2 follow-up, choice 19)." And **"Re-anchoring on every text replacement"** (`:682-699`), after the table: "A range produced before the fill-in is re-anchored with it; one produced after it is measured against the text the adapter sent and re-anchored the same way (choice 19)."
  10. **"Migration"**, item 3 (`:2124-2126`): "no ranges" → "ranges by arrival, Live Translate the default, a push-to-talk release tail on Live Translate, activity handling per model family, Google's language codes per family — the last five by the Stage 2 Gemini/AST2 follow-up"; item 4 (`:2127-2130`): add "whole-sentence ranges keyed by the server's times (the Stage 2 Gemini/AST2 follow-up)".
- [ ] **Step 2: Write the roadmap's section.** Append `## Scheduled by the Stage 2 Gemini/AST2 follow-up plan` after the OpenAI Realtime section, in its form:
  - **What landed:** the plan's path and commit, the commit range and its `+/−` lines and files (from `git diff --shortstat`), the waves as run, each task's review rounds, the group check with its numbers; Task 9 is the record.
  - **Departures, stated:** a live Doubao row now grows piece by piece where it showed only the newest piece (choice 1; research note 1); a Doubao clip's ref comes from the server's times when they match, the lock only when they do not (choice 2); Gemini's default model is Live Translate — a fresh profile, and a saved model no longer listed, run it (ruling 3); a Live Translate release keeps its activity open up to 3 s (ruling 4); a 3.x dialogue model barges in (ruling 5); **a Gemini pair saved before this plan falls to English → Japanese, except a side stored as `pt-BR`, the one old code Google still documents; nothing is written, so it falls on each load until re-picked; the other 33 old codes are gone** (ruling 6; choice 17) — for the release note; known generic behaviour, not new: a model switch that narrows the offer falls to the list's first entry, English, even to English → English; the instructions name Google's English names ("Chinese (Traditional)"; Chinese and Portuguese keep their variant in parentheses).
  - **Before any release from the branch:** the release note's line on Gemini's pairs; a native-speaker spot check of the 101 display names (choice 15), `中文 (简体)` / `中文 (繁體)` above all; no locale key added.
  - **The owner's live test** (own credentials; each item names what settles it):
    1. **Doubao karaoke, pause and sentence modes** (ruling 1; choices 2–5): zh → en and ja → zh; each translation lights over its clip, in the display cut off, by pause and by sentences (1 per row), in the panel and the subtitle; the Logs' `tts.sentence_start` frames carry times equal to the translation's `subtitle.translation` `end` frame, and each `tts.clip` reads `matched: true` with the row's ref — record how many read `matched: false`.
    2. **A subtitle that changes before its `End`** (research note 1; choice 4): the row grows piece by piece while it streams; where the `End`'s text differs from the pieces, the karaoke still spans the final text; a sentence that starts before its translation's `End` (watch `tts.sentence_start` before `subtitle.translation` `end`) lights only once the row is final.
    3. **Doubao with "Keep audio for replay" on** (ruling 1): replay per sentence plays each translation's clip, and a replayed clip lights as it did live. (Choice 6's ceiling path is not reached live — `afterAudio` drains every segment's pcm before a held list — so its unit tests are its proof.)
    4. **Gemini karaoke on Live Translate and on a dialogue model** (ruling 2; choice 7): Live Translate lights phrase by phrase and holds through silence; the 2.5 and 3.8 dialogue models light across each answer; audio before a translation's first text lights nothing until its text arrives.
    5. **Live Translate the default** (ruling 3): a new profile runs `gemini-3.5-live-translate-preview` (the Logs' `session.opened`); a stored profile with a saved dialogue model keeps it; a stored profile that never picked a model now runs Live Translate; a key that lists no Live Translate runs the newest native-audio model.
    6. **Push-to-talk on Live Translate** (ruling 4; choices 11, 12): a press's last words arrive before the next press — the Logs read `turn.tail`, then `turn.tail_end` (`reason`, `silenceMs`, `lastOutputMs`), then `realtime_input.activity_end`; a press during the tail ends it (`reason: 'press'`); tune `TAIL_QUIET_MS` and `TAIL_MAX_MS` from `lastOutputMs`.
    7. **3.8 overlap with barge-in** (ruling 5; choice 9): a second utterance while the first's translation still plays — both transcribed and translated, the first's translation whole (`session.opened` reads `activityHandling: 'START_OF_ACTIVITY_INTERRUPTS'`). Known risks, one probe run per setting: speaking again within about a second of the first utterance's end cuts a 3.8 translation still generating; 3.8's mandatory proactive audio may still skip input; `gemini-3.1-flash-live-preview` (family 3.1, now barge-in) was not measured.
    8. **2.5 unchanged** (ruling 5): `NO_INTERRUPTION`; both translations whole in the same overlap.
    9. **Languages** (ruling 6; choices 14–18): a stored Gemini pair from before falls to English → Japanese (a side stored as `pt-BR` stays), and again after a reload until a pair is picked; the 99 / 78 offers follow the model picked; Traditional Chinese (`zh-Hant`) and `pt-PT` translate on Live Translate; a Live Translate pair with an Assamese source refuses Both in the participant notice's words; a dialogue model translates into Faroese; the row badges read "JA", "ZH-HANS".
    10. **Doubao in `s2t` mode** (choice 1; a text-only leg, or the participant leg): are `Response` frames pieces there too? Both probe runs were `s2s`. A row whose text doubles until its `End` means `s2t` sends snapshots, and choice 1 must split by mode.
    11. **Doubao karaoke in the display cut by sentences with the punctuation pack installed** (choice 19): ja → zh, a translation that ends without a sentence end (the probe had three in eight): the fill-in adds its marks, the karaoke reaches the last character, and the row stops being tinted as playing once its clip ends.
    12. **Live Translate into `zh-Hans`** (ruling 6): Simplified Chinese, the likeliest target — the old code sent `zh`, measured to come back Simplified (`settings.ts:169-170` at `4f7c6b83`); the new one sends Google's `zh-Hans`, never measured.
    13. **3.8 under push-to-talk** (ruling 5; choice 9): a press while the previous translation still generates — record whether barge-in cuts it, and how often.
    14. **A voiceless press on Live Translate** (choice 12): the tail runs, framed `turn.tail` `{ cancelled: true }`, and `turn.tail_end` follows.
    15. **3.x barge-in with the model's own voice in the room** (ruling 5; choice 9): on the participant leg, or under automatic turns with speakers, the model's output echoed into capture must not cut its own response.
  - **Open questions for the owner:** stated pairing for Doubao from the subtitles' times (the probe's evidence); whether a sentence whose times match nothing should still be ranged on the lock's row (parity says no); Live Translate's sources as the 99 plus its own two (choice 16) against "the 99"; the tail's constants; barge-in's cost on 3.8 under push-to-talk; the 2.5 dialogue model's Japanese input transcription, which came back as " ." (server behaviour, not fixed here).
  - **Amend in place** (mark each "**Changed by the Stage 2 Gemini/AST2 follow-up plan** (…)"):
    - the Gemini section's live-test items 2 (the default), 3 ("no karaoke"), 4b (speech during an answer on 3.x: now barge-in by family), 5 (push-to-talk on Live Translate: the tail); its open question on 3.1 dropping speech during its answer (ruling 5; the live test settles it); its stated departure "the default model is the newest native-audio dialogue model" (ruling 3); its inheritance row "`audio.range` after fill-in — n/a: Gemini emits no ranges" (it applies now: arrival ranges, re-anchored by L1 whichever lands first, choice 19);
    - the Volcengine AST2 section's live-test items 3 ("no karaoke") and 13 (the `tts.sentence_start` frame, now with the sentence's times, beside the new `tts.clip` with `matched`); its "What it leaves" item "Stated origins for Doubao …" (the probe's times are the evidence; still not taken); its accepted item "Task 8, M4" (a clip on a ref that never opens: now only on the lock's fallback — a matched sentence never names a translation never shown); its inheritance rows "`audio.range` after fill-in — n/a: Doubao's clips are rangeless" and "`Conversation.afterAudio`'s pending drop — n/a: Doubao emits no `speechRanges`" (both apply now, both closed by Task 2: choices 19 and 6);
    - the Soniox section's "Found here" items on `audio.range` after fill-in (`:1743`) and on `Conversation.afterAudio`'s pending drop (`:1747`): **done** (Task 2; choices 19 and 6) — the first for every provider; Doubao's matched clips are the only current caller.
  - **The roadmap's inheritance, item by item,** and **what it leaves:** the two lists below, as landed.
- [ ] **Step 3: Commit.**

```bash
git add docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md
```

```bash
git commit -q -F - -- docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md <<'EOF'
docs(spec, roadmap): the Gemini/AST2 follow-up's amendments and live test

Doubao's whole-sentence karaoke by the server's times, Gemini's karaoke
by arrival (the third stated exception), Live Translate the default, its
push-to-talk tail, activity handling per model family, and Google's
language codes per family; the owner's live test and the open items
this closes.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

## The roadmap's inheritance, item by item

Taken (and where), or left (and why).

| Item | Disposition |
|---|---|
| The Gemini section: live-test item 2 (the default model) | changed: Live Translate (Task 4; ruling 3) |
| The Gemini section: live-test item 3, "no karaoke" | changed: by arrival (Task 3; ruling 2) |
| The Gemini section: item 4b and the open question on 3.x dropping speech during an answer | met by barge-in for family 3.0 and later (Task 7; ruling 5); the live test settles it |
| The Gemini section: item 5, push-to-talk on Live Translate | met by the release tail (Task 5; ruling 4) |
| The Gemini section: its open question "Live Translate's leading audio" | left: audio outside an open translation stays unattributed (ruling 2) |
| The Volcengine AST2 section: live-test item 3, "no karaoke", and item 13, the lock | changed: whole-sentence karaoke by the times, the lock the fallback (Task 6; ruling 1) |
| The Volcengine AST2 section: "Stated origins for Doubao" | left: the probe's times are the evidence; not ruled (What this plan leaves) |
| The Soniox section's "Found here": `Conversation.afterAudio`'s pending drop | done (Task 2; choice 6): Doubao can now reach it in form; no live session is likely to |
| The Soniox section's "Found here": `audio.range` after fill-in | done (Task 2; choice 19): an `audio` range on a segment the fill-in replaced is measured against the adapter's own text and re-anchored, as `speechRanges` is — for every provider; Doubao's matched clips (on their common path in sentence mode, research note 10) are the only current caller |
| OpenAI Translate's tail | copied, not lifted (choice 10); the lift waits for a third user or Translate's live test |

## What this plan leaves

- **Stated pairing for Doubao:** every source subtitle carries the same server times as its translation in the probe; a later change could state origins from them (the AST2 plan's choice 3 left the question open).
- **The release tail's lift** to `src/lib/contract/` at its third user, or after OpenAI Translate's live test.
- **The pair's fall on a model switch:** a switch that narrows the offer falls to the list's first entry, English, by the generic rule (`normalizePair`) — an English source's pair then reads English → English (choice 17). Generic behaviour for every provider whose offer depends on its settings; not changed here.
- **The 2.5 dialogue model's Japanese input transcription** came back as " ." in the probe: server behaviour, not fixed; the source row stays empty for it.
- **Live Translate's sources:** the 99 plus its own two (choice 16) is inference from its guide ("between 70+ languages"); the live test may narrow it.
- **The wizard's tolerant language match** picks `zh-Hans` for a Traditional Chinese UI (it matches on the primary subtag, `languageDefaults.ts`), for Gemini as for every provider with script variants: unchanged.
- **Readiness narrowing** (`checkReads`) for Gemini and Doubao: still their own later change.
- **The owner's open questions** in Task 9's record, each with the live-test item that settles it.

## Self-review

- **Brief coverage.** Ruling 1: Tasks 6 (the times matched at the clip's emission, the range at emission or at the close, the fallback, the sentence-mode pin in the panel and the bands, with the fill-in before and after the clip) and 2 (an `audio` range after fill-in re-anchored, without which sentence mode falls short). Ruling 2: Task 3 (the construction, Live Translate's silent chunks, audio outside an open translation). Ruling 3: Task 4 (the rule, every pinned default: `settings.test.ts`, `config.test.ts`, `GeminiSettings.test.tsx`, `provider.test.ts`, the probe; no "Recommended" exists for models). Ruling 4: Task 5 (copied not lifted, `activityEnd` after the tail, beats). Ruling 5: Task 7 (the family rule, `GeminiConfig`, `setupFrame`, the oracle, the frame). Ruling 6: Task 8 (the codes, the per-family offer from `S.model`, `''` as Live Translate, a key without Live Translate, `initial`, `toTranslationLanguageCode` removed, the display names, every fixture and test naming an old code). The spec's amendments and the roadmap's record: Task 9.
- **Placeholders.** None: every code block is the tested scratch copy's file or diff. The one template is the commit messages' `<implementing model>`, which Global Constraints says to fill in; Task 9 fills its numbers from the run.
- **Type consistency.** Checked in the scratch copy, where every file compiled at the gate after every wave: `ServerTimes`, `Sentence`, `Clip`, `MATCH_WINDOW`, `sentence`, `clipFor`, `ClipFor`, `sentenceStart(sentence)`, `ReleaseTail`, `TailSummary`, `TailEnd`, `FRAME_MS`, `FRAME_SAMPLES`, `TAIL_QUIET_MS`, `TAIL_MAX_MS`, `GeminiActivityHandling`, `geminiActivityHandling`, `GeminiConfig.activityHandling`, `BARGE_IN`, `GEMINI_DIALOGUE_LANGUAGES`, `GEMINI_TRANSLATE_TARGETS`, `GEMINI_TRANSLATE_SOURCES`, `migratePair` — each spelled the same in every task that names it.
- **Choices made inside the rulings:** 1–19, listed above; each is cited where it lands.
- **Departures, stated in the plan:** a Doubao row grows piece by piece (choice 1); the lock only a fallback (choice 2); Live Translate the default (ruling 3); the tail holds the activity open (ruling 4); 3.x barges in (ruling 5); a stored Gemini pair falls to English → Japanese but for a `pt-BR` side, at each load until re-picked (ruling 6; choice 17).
- **Departures from the brief:** Task 1 (the pieces) and Task 2 were not asked for; both were found while writing or in review (research notes 1, 2 and 10), and each is its own task so the owner can refuse it apart — though Task 2's re-anchoring (choice 19) is what lets ruling 1's karaoke line up in the display cut by sentences with the fill-in on, and Task 6's test pins it. Live Translate's sources are the 99 **and its own two** (choice 16), where the recommendation read "the 99". The stored pair's fall uses `migratePair` (choice 17), which converts nothing and runs on every load: normalisation the owner's rule allows ("a definition's `migrate` may still validate stored fields field by field"), as the plan's review found; the owner has been told.
