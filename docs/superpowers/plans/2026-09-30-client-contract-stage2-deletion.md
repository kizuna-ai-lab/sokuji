# Client contract — Stage 2: delete the old provider code (Local Native's old path kept whole)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Standing of the rulings below.** Rulings 1–8 are **the owner's decisions** (2026-09-30, in conversation), after his live tests: every other provider's old code goes in this one plan — 「其他的几个Provider可以开始清理计划了」 — with Local Native's old path kept whole (「LocalNative完全保留 因为我们还有后续工作」), LocalInference's leftovers deleted (「删」), `evals/` with `openai-realtime-api` (「删 evals相关的也可以删了，已经用不到了」), the extension's CSP and the release flags cleaned (「清理」), and this repository's `CLAUDE.md` rewritten (「改」). Rulings C1–C7 are **the controller's**, on the survey's questions (`/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-plan-brief.md`). Where a ruling left a sub-decision to this plan, the answer is a numbered *choice*; the self-review lists each.

> **Revision 1** answers the independent review of the first version (`bb39151e`; `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-plan-review.md`: Ready after fixes, 0 Critical, 1 Important, 6 Minor, 5 Nit; it reproduced every number the first version quoted) with the controller's rulings in `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-plan-revision1.md` (rulings C8–C17 below), and takes the owner's rulings 9 and 10, added to the brief on 2026-10-01: `CONTEXT.md` is rewritten with `CLAUDE.md` (「CONTEXT.md 一起改」), and `README.md`, `docs/`, `CHANGELOG.md` and `bug_report.yml` wait for the release that carries Stage 2 (「README 那些等发布再改」). The first version's four open questions are ruled; none is left open but one new question for the owner that blocks nothing. The applier now proves what it removes (a hash on every shortened run; a hunk whose old side occurs twice names its occurrence), a pre-flight runs its self-test and checks the files are `fa301e9a`'s, the typecheck is gated as a set, the import guard is a test in the suite, and Tasks 2, 4, 6, 8, 9, 10 and 11 gain the comment, diagnostics, guard and glossary changes the rulings add. "Found in review" (research notes) lists each with where it lands; the whole plan was replayed again on a fresh copy of `fa301e9a`, and every count below is Revision 1's.

> **Revision 2** takes the scoped re-check of Revision 1 (`/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-plan-recheck.md`: Ready to execute, three new Nits), each ruled in by the controller: **R1**, Task 1 also corrects `sessionStore.ts`' header and deletes its initializing flag and hook, which nothing reads after the shell's reduction; **R2**, the import guard's old set takes `src/services/interfaces/` too (`IClient.ts`), with `ISettingsService` a shared leaf, and the re-check's mutant fails it; **R3**, Task 11 corrects `CLAUDE.md`'s "JavaScript files" for `src/lib/modern-audio/` and its passthrough default. The whole plan was replayed again on a fresh copy of `fa301e9a`; the counts that moved are Tasks 1, 10 and 11's shortstats and the total (the self-review lists them).

> **Revision 3** (this version): the owner approved executing the plan (「开始」) and added ruling 11 — `CONTEXT.md`'s native model resolution entries are rewritten too (「改」). Only Task 11 changes (its `CONTEXT.md` block, its prose and commit message), with this record, the rulings list, the file-structure table's Task 11 row and total, "What this plan leaves" and the open question it answers. Tasks 1–10 and 12 are untouched: their blocks are byte-identical to Revision 2's. Task 11 was replayed on a scratch tree at Task 10's end state; Task 11's shortstat and the total move (the self-review lists them). **Task 12 Step 2's quoted total** (291 files, +1 305 −52 566) is Revision 2's: the file-structure table's (291 files, +1 308 −52 569) supersedes it.

**Goal:** Delete every old provider client, descriptor, store slice and settings branch the new provider structure (`src/providers/<id>/`, the runner, L1 and L2) has replaced, with the dependencies, release flags, extension rules and CSP origins only they used — and change nothing a user can reach. Concretely:
- **Deleted, by provider** (ruling 2): OpenAI Live's old client and descriptor; OpenAI Translate's relay twin; Doubao AST 2.0's client, descriptor, relay twin, language sync and the extension's AST2 header block; Gemini's client, descriptor and model mapping; Soniox's and Kizuna Soniox's clients, descriptors, managed session, split and budget helpers, MainPanel's split chips and the eight re-export stubs; OpenAI Realtime's, OpenAI Translate's and OpenAI Compatible's WebSocket and WebRTC clients, descriptors, session builder, ephemeral-token service, transcription context and `textUtils.ts`; Palabra's LiveKit client, descriptor and `WebRTCAudioBridge` with its worklet; and LocalInference's old client, descriptor and slice (ruling 3). 142 files, 42 724 lines as they stand at `fa301e9a`.
- **Dependencies:** `livekit-client` with its pin, the `openai-realtime-api` fork (root and extension), `uuid` and `@types/uuid`, and `evals/`'s own `ajv` and `ajv-formats`, with the `eval*` scripts and `evals/` itself (rulings 2, 4; choice 8). `@google/genai` stays a development dependency (ruling C2).
- **Shared old code shrinks to Local Native** (ruling 1): `IClient.ts` keeps Local Native's session config; `ProviderConfigFactory` registers Local Native alone; `ProviderDescriptor.ts` loses the managed-session and relay members; `settingsStore.ts` keeps the common settings and the `localNative` slice (1 672 → 857 lines); the old settings shell (`ProviderSection`, `LanguageSection`, `ProviderSpecificSettings`) keeps its Local Native branches only, still unmounted; `PoweredBy` goes (ruling C6); `speechMode.ts` goes (ruling C5).
- **The platform edges:** the extension's CSP drops the relay's three `wss` origins and the two dead OpenAI Compatible presets (ruling 5); the old AST2 and OpenAI Live DNR handlers go, their rule ids swept at start (ruling C3); the per-provider `VITE_ENABLE_*` gates of the deleted providers leave `environment.ts`, `build.yml`, `extension/vite.config.ts` and `.env.example` (ruling 6).
- **The words:** 44 locale keys that only the deleted code read, in all 30 catalogs; the project `CLAUDE.md` and `CONTEXT.md` rewritten for the new structure (rulings 7, 9); comments that still spoke of the old code as present corrected (choice 3; ruling C9).
- **The contract's catalogue:** the four client diagnostic codes no sender uses any more — `cleanup_failed`, `input_pipeline_failed`, `send_dropped`, `lease_notify_failed` — with their notice texts and keys (ruling C17).
- **A guard in the suite:** `src/providers/oldPath.consistency.test.ts` holds every file outside the old path — `src/services/{clients,providers,interfaces}/` — off it: static, side-effect, dynamic and `require` imports alike (ruling C11; widened in Revision 2).
- **Kept, and proven kept:** Local Native's old path whole — its client, descriptor, registrations, shell branches, slice, native UI and tests (ruling 1); every storage key a new provider reads (the table below); the `fake` providers (ruling 8); the `Provider` enum's live ids (ruling C1).

It begins with the controller's pre-flight — the tools' self-test, the named files checked against `fa301e9a`, this plan's gate baseline and the typecheck's starting set — and ends with the controller's group check — both builds, the extension and Electron suites, the D24 greps, the deleted clients' strings absent from both bundles, `livekit` absent, the bundle sizes, Local Native's old tests, a headless render of every provider's Settings compared with `fa301e9a`'s — and the controller's docs task (Task 12).

**Architecture:**
- **One task per group** (ruling C7), in the survey's §5 order but for one move: the old settings shell is reduced to Local Native **first** (choice 1), because every later group's old UI branch sits in it. Then OpenAI Live, OpenAI Translate's relay twin, Doubao AST 2.0 with its twin, Gemini, the two Soniox providers, the merged OpenAI deletion, Palabra, LocalInference's leftovers, the shared old code's last trim, and `CLAUDE.md` (choice 2). Old files import across groups — the OpenAI Translate relay twin extends the own-key descriptor, the managed Soniox session serves the relay twins' `ClientOptions`, `ClientOperations` names the twins — so each task deletes exactly what its group's last importer leaves orphaned, and the tree compiles and every suite passes after each.
- **What survives in `src/services/`:** `clients/{ClientFactory,LocalNativeClient,createNativeVadWorker,punctuateDefinite}.ts`, `providers/{ProviderConfig,ProviderConfigFactory,ProviderDescriptor,LocalNativeProviderConfig,localParticipantConfig,astGuard,tutorialUrls}.ts`, `interfaces/`, `SettingsService.ts`, `ServiceFactory.ts`, `persistSetting.ts`, `worklets/` and their tests — Local Native's old path and the shared types the new code imports (`LanguageOption`, `VoiceOption`, `guardAstCrossStage`, `AI_PROVIDERS_DOCS_URL`).
- **The new structure is read, not changed**, but for: comments that described the old code as present (choice 3); the three LocalInference components' `override` / `settings` / `pair` made required (ruling 3); the managed voice modules' importers re-pointed from the stubs to `src/providers/soniox/` (the B2 re-points); `sttStream.ts`' `onTick`, the old managed session's hook (choice 5); `logStore.ts`' old event names; `redact.ts`', `sanitizeEvent.ts`', `report.ts`', `storedSettings.ts`', `environment.ts`' and `languageName.ts`' comments; `wsHeaderRule.js`' sweep of the old AST2 range (ruling C3); the four diagnostic codes' rows in `clientDiagnostics.ts` and `noticeText.ts` (ruling C17); and one new test, the import guard (ruling C11).
- **No behaviour a user can reach changes.** The old path has had no runtime caller since the switch (the settings shell is unmounted; `ClientFactory` has no caller outside its tests); the one old code path the app still runs — `nativeModelStore`'s revalidation into `settingsStore.validateApiKey`'s Local Native arm — is kept whole. Three things prove it: the builds; the import guard in the suite (`src/providers/oldPath.consistency.test.ts`, from Task 10): no file outside the old path imports it by value, dynamic imports included; and the group check's render of every provider's Settings compared with `fa301e9a`'s. The four diagnostic codes had no sender left, so no notice a user could see goes with them.

**Tech Stack:** TypeScript (strict), React 19, zustand, i18next, Vitest + @testing-library/react (jsdom), the extension's MV3 background (`declarativeNetRequest`), npm lockfiles (v3), Python 3 and Node for this plan's four tools (below), headless Chromium over the DevTools protocol (`scripts/dev/headless.mjs`) at the group check.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — the binding authority, as amended through the Stage 2 OpenAI Live plan's record and the owner's taking Local Native out of Stage 2 (`fa301e9a`). The parts this plan meets: "Decisions" → "Deleted with no behaviour change"; "The provider definition" → "Persisted settings that move" (nothing moves; the old readers go) and "What adding a provider then touches"; "Migration" (the old code "stays until each port is live-tested", its items 1–9 and the relay twins' paragraph); "Risks". Task 12 amends them.

**Research notes:**
- **The survey this plan is written from:** `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-survey.md`, cited as *survey §x*: §1 the old code's import graph, §2 the per-group deletions, §3 the stored keys the new providers read, §4 Local Native's keep set, §5 an order and its hazards, §6 the questions (ruled). Its brief: `…/tmp/deletion-survey-brief.md`. Every line of it this plan relies on was re-read against the code at `fa301e9a`; where it was wrong the plan says so (below).
- **What remains:** `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/stage2-remaining.md`, and the roadmap's last section, "Stage 2 without Local Native: what remains" (`2026-09-23-client-contract-stage1-roadmap.md:8246`).
- **Local Native's issue:** kizuna-ai-lab/sokuji#578 (read only) — the port that will retire the old path this plan keeps.
- **Found while writing** (at `fa301e9a`, in the scratch copy; each is where a rule below comes from):
  1. **The kept shell's default** (ruling C4). `settingsStore`'s default provider and its load's fallback are `Provider.OPENAI` (`settingsStore.ts:204, 1320`). Nothing the app mounts reads `settingsStore.provider` but `nativeModelStore.revalidateNativeProvider` (`nativeModelStore.ts:265`), which runs `validateApiKey()` — the old Local Native readiness arm, with its sidecar calls — only when it is `'local_native'`. A `LOCAL_NATIVE` default would start that arm for every user of a build that registers Local Native. So the shell tolerates an empty old registry instead, and `Provider.OPENAI` stays the inert default: `ProviderSection` pins an unregistered stored value on a disabled placeholder option (it already did, for a flag turned off), `LanguageSection` and `ProviderSpecificSettings` render nothing for it, and `validateApiKey` answers "not valid" for anything but Local Native without a request (choice 4).
  2. **`@google/genai` is already a development dependency** (`package.json:156`, under `devDependencies`), used by `import type` in `src/providers/gemini/{wire,adapter}.ts` and by one value import, `wire.oracle.test.ts`' socket. Ruling C2's move is a no-op; its comment says why it stays.
  3. **The CSP's five origins** (ruling 5): `wss://sokuji.kizuna.ai`, `wss://sokuji-api.kizuna.ai` and `wss://sokuji-api-dev.kizuna.ai` are read only by the relay twins (`getRelayWsUrl`, `environment.ts:144`, and its callers); `api.cometapi.com` and `new.yunai.link` only by OpenAI Compatible's presets, which the extension never offered (Electron only). None is in `host_permissions`. The backend's `https` origins stay: the account and wallet calls use them. All five go in Task 4, where the last relay twin goes (choice 7).
  4. **The old AST2 rules** (ruling C3): `background.js`' AST2 block sets rules 2000–2009 with no `initiatorDomains`, so one a crash left behind would hand the user's credentials to any page opening a socket to `openspeech.bytedance.com`. `wsHeaderRule.js`' `sweepIds` already takes the old Live rule 4000 at `onStartup` / `onInstalled`; it takes the AST2 range too (`OLD_AST2_RULE_ID_MIN` / `_MAX`). `let dnrUpdatePromise` was declared inside the AST2 block (`background.js:262`) and chains the generic pair's updates: it moves above the generic section.
  5. **`uuid` had one user,** the old AST2 client (`VolcengineAST2Client.ts`); `ajv` and `ajv-formats` only `evals/` (choice 8). The lockfiles lose `uuid` and `@types/uuid` (Task 4), `ajv-formats`, the fork and its `nanoid` (Task 7, both lockfiles; `ajv` itself stays, another package's dependency), and `livekit-client` with its eight dependencies (Task 8).
  6. **The old-shell tests that pinned other providers** re-point to Local Native where the behaviour they pin survives — the language section's sentence labels, the text-only capability arms (stubbed onto Local Native's config, since no provider declares `'always'` or `'never'` now), the select's unregistered-value placeholder — and go where it does not (choice 9).
  7. **Keys that look read but are not:** `settings.{low,medium,high}` were read by the old shell's OpenAI branch and are read now by `RealtimeTurnDetection.tsx:13` (`settings.${eagerness.toLowerCase()}`): they stay. `providers.openaiCompatible.{name,description}` match `ProviderPicker`'s dynamic `providers.${key}.name`, but no registry offers OpenAI Compatible: they go (Task 7). 51 keys were unreferenced before this plan (`settings.geminiParticipantTokenWarning` among them); they are not this deletion's — Task 12 records them as a follow-up (ruling C16).
  8. **The Palabra and OpenAI deletions meet at `WebRTCAudioBridge`** (spec "Migration"): the merged OpenAI deletion orphans nothing of it — Palabra's client still imports it — so Palabra's task, the second, deletes the bridge, its test and `pcm-audio-worklet-processor.js`, with the extension build's copy of the worklet.
  9. **The typecheck gate's baseline drops twice.** Task 1 deletes the two `ProviderSpecificSettings.tsx` lines (the template instructions the reduced shell no longer destructures); Task 10 the two `settingsStore.ts` `TS2353` lines (the `cacheTimestamp` the store no longer sets). The gate's regex alternative for `src/services/(clients|providers)/…` names only files Tasks 4 and 6 delete: after Task 6 it matches nothing (the group check trims it).
  10. **The old clients shipped, unreached.** `settingsStore` imports `ProviderConfigFactory`, which registers every old descriptor, each importing its client: at `fa301e9a` every old client is in both bundles (`build/static/audioStore-*.js`, `extension/dist/assets/settingsStore-*.js`), with `livekit-client` and the `openai-realtime-api` fork. Nothing runs them (the shell is unmounted, `ClientFactory` has no caller). The deletion takes 1.36 MB of JavaScript out of the web build and 1.43 MB out of the extension (the group check's table; Revision 1's measure).
  11. **The survey's slips, corrected here:** §2.9 counts `providerOrder.test.ts` among LocalInference's leftovers, but after Task 8 it pins Local Native's position alone and goes in Task 9 with its last old peer; §6 item 10's CLAUDE.md lines were read before the OpenAI Live record grew the file — Task 11 anchors by content; §1.10 lists `providers.openaiCompatible.{name,description}` as orphaned by the merged deletion (right) but `settings.{low,medium,high}` too (wrong, note 7).
- **Found in review** (Revision 1; each the controller's ruling in `deletion-plan-revision1.md`, or the owner's):
  1. **I1, the applier's refusal guarantee was false** (ruling C8): a shortened run was removed unread, so an edit inside it with the line count kept went silently; and a hunk was tried at its header's line first, so a duplicated anchor that moved was edited at the wrong copy. Now each `~ N more removed lines` carries the SHA-256 of the lines it stands for, every hunk's old side is matched against the whole file and must occur once — or name its occurrence (`occurrence K of N`: the fifteen `build.yml` env-block hunks of Tasks 3, 4, 6 and 8, whose blocks are identical) — and the pre-flight runs the tools' self-test, the review's two mutants among its cases, and checks every named file is `fa301e9a`'s.
  2. **M1 and N4, stale comments** (ruling C9): `soniox/config.ts` and `soniox/socket.ts` (Task 6), `environment.ts`' two (Task 8), `languageName.ts` (Task 9), `storedSettings.ts` (Task 10, a comment-only exception to the read-only `src/lib/session`), `report.ts` (Task 11); and, found while writing them, `wsHeaderRule.js`' note on the generic Live rule's priority (Task 2) and `astGuard.ts`' header (Task 9, already in the first version's result).
  3. **M2, three inheritance rows** (ruling C10): the Soniox section's `:1752`, the Volcengine AST2 section's `:3872`, the Kizuna Soniox departure `:2171`.
  4. **M3, the import guard** (ruling C11): the group check's grep missed dynamic and side-effect imports. It is a test now, placed in Task 10 where the old set is final; the review's dynamic-import mutant fails it.
  5. **M4 and N2, `CLAUDE.md`** (ruling C12): the three false passages (`IAudioService`, `ModernBrowserAudioService`, `SimpleConfigPanel`) and step 2's `sessionSide` sentence; found while verifying them, `ModernAudioPlayer`, `OnboardingContext`, `sessionStore`'s description and two "Code Organization" lines, corrected the same way (Task 11).
  6. **M5, the typecheck as a set** (ruling C13): a count could hide a swapped error. Each task's tsc output is kept and compared with the task before it by `tscdiff.py` (file, code, the message's first 60 characters; a multiset); no task adds an error, and the count is the second check.
  7. **M6 and ruling 10:** the released app's descriptions are the release's follow-ups (Task 12 lists them).
  8. **N1, N3, N5** (ruling C15): the sweep's citations name the OpenAI Live plan (Task 4); the key tool refuses a namespace key; Tasks 1 and 10 write this plan's own baseline file, `deletion-gate-baseline.txt`.
  9. **The open questions** (rulings C16, C17, 9, 10): the 51 already-unused keys are a follow-up; `CONTEXT.md` is rewritten in Task 11; the release docs wait; the four diagnostic codes are deleted in Task 10.
  10. **Found while revising:** `MANAGED_LEGACY_IDS` lives in `src/lib/session/storedSettings.ts`, not `loadStores.ts` as the first version's stored-keys note said (corrected there).
  11. **Revision 2, the re-check's nits** (the controller's rulings, called R1–R3 here): `sessionStore.ts`' stale header and unread initializing flag (Task 1); the guard's old set widened to `interfaces/` (Task 10); two false audio statements in `CLAUDE.md` (Task 11).
- **A scratch copy of the tree** at `fa301e9a` (a `git archive`, `node_modules` and `extension/node_modules` linked from the worktree, outside the repository, 2026-09-30, and again for Revision 1 on 2026-10-01) ran every task below before it was written down; every diff and deletion list is generated from its history. Then the plan was replayed task by task, **from this document's own blocks**, on a fresh copy of `fa301e9a`: each task's `git rm` list removed, its diff blocks applied by the plan's applier (every hunk's old side matched once, or at the occurrence it names, every shortened run's hash matching, and every hunk at its header's line: the applier printed only `tNN: N files changed`), its locale keys dropped by the plan's key tool, the result compared file by file with the scratch history's tree (identical after every task), and every gate run after every task, the typecheck's set compared with the task before's — the counts in each task are that replay's.

## Global Constraints

- **Starting point.** HEAD `fa301e9a` on `worktree-client-contract-stage2`, plus this plan's own documents. The diff blocks' hunk headers count the lines at `fa301e9a` as each earlier task of this plan leaves them. **Every file a task names must be `fa301e9a`'s when the plan starts**: the pre-flight checks it, and stops the plan if not (the blocks are then regenerated from a fresh scratch replay).
- **Edits shown as diff blocks, applied by the plan's applier.** Each task's edits are unified diffs (three lines of context) in fenced blocks opened with five backticks and `diff tNN` (`t01` … `t11`), one block per file; the one new file (Task 10) is a diff from `/dev/null`. A run of twelve or more removed lines is printed as its first three and last two, with a line `~ N more removed lines sha256:H` standing for the rest, H the first 12 hex digits of the SHA-256 of those lines joined by newlines. **What the applier guarantees:** every hunk's old side — its context, its removed lines and the hashed runs — is matched byte for byte against the whole file as it stands; it must occur exactly once, or, where the hunk header ends `occurrence K of N` (the fifteen identical `build.yml` env-block hunks), exactly N times, the K-th taken. A shortened run whose lines do not hash to H matches nowhere. Anything else — no match, a second match, a different number of copies, a match above the hunk before, a file to create that exists, a file named twice — refuses the whole task, and nothing is written. The header's line number decides nothing: a hunk that matched elsewhere is reported (`…: hunk at N applied at M`), its content exact. Apply a task's blocks with one command from the worktree root:

  ```
  python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/plan-apply.py docs/superpowers/plans/2026-09-30-client-contract-stage2-deletion.md t06
  ```

  It prints `t06: 35 files changed` (the count each task gives) and nothing else when every hunk sits at its line; a line `…: hunk at N applied at M` says lines above one moved — impossible after the pre-flight's check, so report it. With `--check` it applies nothing. **Never apply a block by hand, and never edit a file a task's blocks do not name.** Binary files: none.
- **Deleted files are removed with `git rm`**, one command per task, its list given in full in the task; `evals/` is removed whole (Task 7).
- **Locale keys are removed by the plan's key tool**, one command per task, from the worktree root (only string leaves: a key naming a namespace refuses):

  ```
  node /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/drop-locale-keys.mjs . <key> …
  ```

  It removes each named dotted key from all 30 `src/locales/*/translation.json`, and any object a removal leaves empty, and writes each catalog back as `JSON.stringify(…, null, 2)` plus a newline — the form every catalog is in (checked: each round-trips byte for byte at `fa301e9a`). It refuses, writing nothing, if a key is missing from any catalog or is not a string leaf. It prints `N keys removed from 30 catalogs`.
- **The plan's four tools** live at `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/` (outside the repository): `plan-apply.py` (the applier), `drop-locale-keys.mjs` (the key tool), `tscdiff.py` (the typecheck's set gate) and `selftest.py` (the first two, tested against the cases that must refuse). If any is missing, write it from the appendix "The plan's four tools" at the end of this document, byte for byte, before the pre-flight.
- **The lockfiles are edited by their diff blocks, never regenerated.** `package-lock.json` (Tasks 4, 7, 8) and `extension/package-lock.json` (Task 7) change only by their blocks — which are exactly what `npm install --package-lock-only --ignore-scripts` produced in a separate copy of the tree. **Never run `npm install`, `npm ci` or `npm uninstall` in the worktree**: its `node_modules` is shared with the main checkout. A removed package left in `node_modules` imports nowhere and is harmless.
- **What this plan touches** (each task's Files list is exact):
  - the old code under `src/services/`, the old settings shell under `src/components/Settings/sections/`, `src/stores/settingsStore.ts` and the old stores' tests — Tasks 1–10;
  - `src/types/Provider.ts`, `src/utils/environment.ts`, `src/stores/logStore.ts`, `src/stores/sanitizeEvent.ts`, `src/lib/diagnostics/{redact,consoleLedger.consistency}`, the MainPanel split chips — as each group goes;
  - the new structure only where the Architecture bullet names it: comments in `src/providers/{openai,openai_translate,openai_live,gemini,soniox,palabraai,volcengine_ast2}/`, the LocalInference components under `src/components/Settings/{engine,sections}/`, the Soniox voice section's imports, `src/lib/tts/previewSample.test.ts`, the wizard's tests;
  - the extension (`background/background.js`, `background/wsHeaderRule.js`, their tests, `manifest.json`, its consistency test, `vite.config.ts`, `package.json`, its lockfile), `electron/ws-header-rules.js` and its test (comments), `.github/workflows/build.yml`, `.env.example`, `.gitignore`, `package.json`, `package-lock.json`, `evals/` — as each group goes;
  - the diagnostics catalogue (`src/lib/diagnostics/clientDiagnostics.ts`, `src/lib/view/noticeText.ts`, `src/lib/conversation/Conversation.test.ts`) and the new import guard (`src/providers/oldPath.consistency.test.ts`) — Task 10;
  - the 30 locale catalogs, by the key tool; `CLAUDE.md`, `CONTEXT.md` and `src/lib/diagnostics/report.ts`' comment — Task 11; the spec and the roadmap — Task 12.
- **Read only.** `src/app/**`, `src/lib/{session,conversation,projection,contract,provider,audio,view,subtitle,transcript,export}/**` but `src/lib/provider/instructions.test.ts` (Task 10 restates its parity pin), `src/lib/session/storedSettings.ts` (Task 10, one comment only), and `src/lib/view/noticeText.ts` with `src/lib/conversation/Conversation.test.ts` (Task 10, the four diagnostic codes), `src/stores/{providerStore,turnModeStore,routingStore,accountStore,nativeModelStore,modelStore}.ts` but where Task 9 names `modelStore.ts`, `src/providers/registry.ts` and every `provider.ts` / `adapter.ts` / `Settings` view but for the comment lines the blocks name; `electron/main.js`; `scripts/**`. **Local Native's own modules are read only in every task** (ruling 1): `src/services/clients/{LocalNativeClient,createNativeVadWorker,punctuateDefinite}.ts`, `src/services/providers/LocalNativeProviderConfig.ts`, `src/lib/local-inference/native/**`, `src/lib/local-inference/workers/native-vad.worker.ts`, `src/stores/nativeModelStore.ts`, `src/stores/licenseConsentStore.ts`, the native UI (`NativeModelManagementSection`, `NativeVoiceSection`, `NativeDeviceControl`, `TierIcon`, `EngineStatusLine`, `EngineSection`, `engine/{useNativeEngineAdapter,SlotDeviceBadge}`, `shared/LicenseConsentModal`) and their tests — not even a comment changes in them. Four files it shares with the deleted code lose only the deleted half: `localNativeGating.test.ts` its other providers' rows (Task 2); `ClientFactory.ts` its `LOCAL_INFERENCE` exemption, `localParticipantConfig.ts` `createParticipantLocalInferenceConfig` and its memory budget, and `nativeModelStore.test.ts` one assertion on the deleted `localInference` slice (Task 9, ruling 3). `ClientFactory.localnative.test.ts` is untouched; the generic `ClientFactory.test.ts`, whose every case named a relay twin, goes in Task 4.
- **Import rules:** nothing new is imported anywhere; a task only removes imports, or re-points one from a deleted re-export stub to the module it re-exported (Task 6). From Task 10 on, `src/providers/oldPath.consistency.test.ts` holds every file outside the old path off it, dynamic imports included; before it, each task's check step and the build keep the deleted modules unreached.
- **No migration code, no stored value touched** (the owner's rule). Deleting a slice removes a reader, never a storage key and never a write: the new providers read the same keys (the table under "Stored keys"). No task adds a load-time conversion, a write-back, or a one-time rename.
- **No new locale key.** Keys go only where their last reader goes, by the key tool.
- **Diagnostics** (CLAUDE.md, "Error Handling"): no `console.error` / `console.warn` is added; `consoleLedger.consistency.test.ts`' rows fall with the files they counted (Tasks 1 and 8); `CLIENT_DIAGNOSTICS` loses the four codes no sender uses (Task 10, ruling C17), and gains none.
- **Gates for every task:**
  - **The suites.** `npx vitest run src` shows 0 failed and no unhandled errors; `npx vitest run electron` and `npx vitest run extension` show 0 failed. Measured at `fa301e9a` on 2026-09-30, in a scratch copy: **`src` 590 test files passed and 1 skipped (591); 7 696 tests passed and 2 skipped (7 698); no unhandled errors. `electron` 34 files, 477 tests. `extension` 9 files, 56 tests.** Each task states its own numbers after it — the replay's; a task that deletes tests lowers them, and that is the gate only through "0 failed". (The `Not implemented: window.open` stderr lines are pre-existing, `ChildWindowPopover`'s.)
  - **The typecheck.** The gate prints exactly the current baseline. The shell's `grep` is a ugrep wrapper that mis-parses this regex, so use `command grep` exactly as written:

    ```
    npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts|diagnostics/(consoleLedger|clientDiagnostics|redact))|lib/modern-audio/BaseAudioRecorder|providers|services/(clients/(SonioxSttStream|SonioxTtsStream|PcmMixer|SonioxSideTracker|SonioxTtsRest|SonioxVoicesClient|SonioxClient|ManagedVoicesClient|managedVoicePolling|VolcengineAST2Client|volcengine-ast2/ast2-proto\.d)|providers/(SonioxProviderConfig|KizunaAISonioxProviderConfig|managedVoicePrep|managedVoicePrep\.test|prepareToStart\.kizunaSoniox\.test))\.ts|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|MainPanel\.|panel/|SessionCountdown)|MainLayout/(MainLayout|useSignInProviderSwitch)|Settings/(Settings\.tsx|ProviderArea|SimpleSettings/SimpleSettings\.tsx|AdvancedSettings/AdvancedSettings\.tsx|sections/((SpeechSection|VoiceLibrarySection)(\.test)?\.tsx|(ParticipantSpeechSwitch(\.test)?|SentenceSegmentationSection|SystemAudioSection|SonioxVoiceSection|ProviderSpecificSettings)\.tsx|voiceLibrarySource(\.test)?\.ts))|SettingsInitializer/|SetupWizard/(SetupWizard(\.test)?\.tsx|(setupDraft|applySetup|useApplySetup)(\.test)?\.ts|providerPaths(\.test|\.managedFit\.test)?\.ts|steps/(StepLanguagePair|StepLanguagePair\.test|StepCredentials|StepCredentials\.test|StepFinish|StepProviderPath|StepScenario)\.tsx)|TitleBar/(AccountButton(\.test)?\.tsx|useBalanceShortfall)|Tour/useStartBasicsTour\.ts|dev/(SpinePreview|SessionControls|OverlayPreview|wireTally|gapCounter))|contexts/UserProfileContext|locales/(index\.ts|showLanguageUncached)|routes/Home\.tsx|stores/(providerStore|turnModeStore|routingStore|accountStore|logStore|settingsStore\.ts)|utils/(environment|conversationExport)|subtitle-overlay-entry|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
    ```

    The same command is `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh`; its output must equal **this plan's own baseline file**, `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` — written by the pre-flight, never the shared `oar-gate-baseline.txt`, which other work reads (ruling C15). **The baseline changes twice, and the task that changes it rewrites that file** (its step says so, with the exact content): **20** lines at `fa301e9a`, **18** after Task 1 (the two `ProviderSpecificSettings.tsx` lines gone), **16** after Task 10 (the two `settingsStore.ts` `TS2353` lines gone). At `fa301e9a` the 20 lines are:

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

    Do not fix any of them; do not add to them.
  - **The full tree, as a set** (ruling C13). The pre-flight keeps `fa301e9a`'s errors in `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t00.txt`; each task writes its own (`npx tsc --noEmit -p tsconfig.json > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/tNN.txt`) and runs `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py <the task before's file> <its own>`, which must print exactly the line the task quotes — `before B after A; new 0; gone G` — and exit 0: no error, by file, code and the message's first 60 characters (positions dropped; counted as a multiset, so a second copy of a known error is new), that the task before did not have. The count `A` is the second check: **259** at `fa301e9a`, then 255, 255, 255, 255, 247, 104, 103, 99, 98, 95, 95 after Tasks 1–11 (the deleted old tests carried most of them). The Electron and extension files lie outside `tsconfig.json`'s `include`; their suites are their gate.
  - **Local Native's old tests** run in every task's `src` suite; after each task this command also shows 0 failed — 80 files and 1 499 tests at `fa301e9a`, each task's own number in its gates step: `npx vitest run src/services src/lib/local-inference/native src/components/Settings/sections/Native src/components/Settings/engine/useNativeEngineAdapter src/stores/nativeModelStore src/stores/settingsStore` (the old path's tests, with the old shell's and the old store's that still run beside them; the filters are vitest's path substrings).
  - **One task at a time.** The tasks run strictly in order (each wave's tasks one after another): every task's blocks are generated on the tree the task before it leaves, and most tasks edit `descriptorRegistry.test.ts`, `settingsStore.ts` or the catalogs.
  - **A task edits only the files in its Files list**, and commits exactly those. If a gate fails, the implementer stops, reports the failure with its output, and changes nothing further: the controller decides.
  - **No task mutates the tree to prove a guard, and no temporary file is written inside the repository.** Checks write under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, each agent in a directory named for its task and role (`t4-impl/`, `t6-review/`).
- **Builds, at the group check only** (the controller's): `npm run build` and `npm run extension:build`, the D24 greps, the deleted clients' strings, the bundle sizes. An implementer never starts a build, a dev server or a probe.
- **Shell forms.** This worktree's guard refuses compound shell forms: brace groups, loops, `;` and `&&` chains, heredocs other than a commit's, `cd … &&`. Every command in this plan is a single command or a plain pipeline, run as its own call from the worktree root. Use `command grep`. The shell is zsh: quote globs.
- **Commits:**
  - Conventional, in English. Every message ends with the implementing model's own `Co-Authored-By:` line, then `Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe`, and nothing after it. The examples below write the first as `Co-Authored-By: <implementing model> <noreply@anthropic.com>`: fill in your own model's name.
  - `git rm` stages the deletions; then `git add -- <the modified paths>`; then `git commit -q -F - -- <every path of the task> <<'EOF' … EOF` — three separate calls, exactly as each task writes them. The `--` pathspec is mandatory: another plan's work may stage into the same index. The catalogs go in as the quoted pathspec `'src/locales/*/translation.json'`, `evals/` as `evals`. Never stage anything else.
  - Production comments cite this plan's rulings and choices as "(Stage 2 deletion, ruling N)" / "(Stage 2 deletion, choice N)" — the controller's as "ruling C1" … "ruling C7" — and the earlier plans' as they already do; never a task number, a review finding or the survey. English only. The blocks already hold every comment this plan writes.
  - Never push.

## Rulings

Cited as *ruling N* (in code, "Stage 2 deletion, ruling N"). Each is restated with where it lands.

**The owner's** (2026-09-30):

1. **Local Native's old path is kept whole,** working but unreachable, until kizuna-ai-lab/sokuji#578 ports it. Kept: `LocalNativeClient`, `LocalNativeProviderConfig` and its registration, `ClientFactory` and `ProviderConfigFactory` reduced to it, the `IClient.ts` members it uses (`ConversationItem`, `BaseSessionConfig`, `LocalNativeSessionConfig` with `isLocalNativeSessionConfig`, `SessionConfig` — now that one type — `ResponseConfig`, `ClientEventHandlers`, `FilteredModel`, `IClient`: 524 → 216 lines; the store's `ApiKeyValidationResult` is `ISettingsService.ts`', and `IClient.ts`' unread copy goes in Task 10), the old settings shell's `Provider.LOCAL_NATIVE` branches and the shell that renders them, the `localNative` slice and its load, `createNativeVadWorker`, `punctuateDefinite`, the native UI and stores, `src/lib/local-inference/native/**`, `VITE_ENABLE_LOCAL_NATIVE` and the `debug:local-native` switch, and their tests — the survey's §4 set, re-checked. Its tests pass after every task (the gate above). Lands in: every task (nothing of it is deleted); Tasks 1, 10 (the shell and the store reduced *to* it).
2. **Every other provider's old code is deleted in this plan:** Soniox and Kizuna Soniox; Gemini; Doubao AST 2.0 and its relay twin; OpenAI Translate and its relay twin; OpenAI Realtime and OpenAI Compatible; Palabra's LiveKit client with `livekit-client` and its version pin; OpenAI Live. Lands in: Tasks 2–8.
3. **LocalInference's old leftovers are deleted too:** the three components that took an optional `override` (`useWasmEngineAdapter`) or optional `settings` / `update` / `pair` (`ModelManagementSection`, `StoragePage`) take them required — every mount already passes them (`LocalInferenceEngine`, from both Settings layouts) — then the old client, descriptor, `validateApiKey` arm, the `localInference` slice and its readers go. Every stored key the new provider reads stays (the table below). Lands in: Task 9.
4. **`openai-realtime-api` goes, and `evals/` with it:** the directory, the `eval`, `eval:validate` and `eval:list` scripts, `.gitignore`'s two `evals/` lines, and the fork in both `package.json`s and lockfiles. Nothing else names them (checked: CI, `tsconfig*.json`, `vite.config.ts`, the docs outside `docs/superpowers/`). Lands in: Task 7.
5. **The extension's CSP is cleaned:** `wss://sokuji.kizuna.ai`, `wss://sokuji-api.kizuna.ai`, `wss://sokuji-api-dev.kizuna.ai`, `https://api.cometapi.com`, `wss://api.cometapi.com`, `https://new.yunai.link`, `wss://new.yunai.link` leave `connect-src`, each checked for a remaining user first (research note 3); `host_permissions` unchanged. `manifest.consistency.test.ts` gains a case that none of the seven comes back and that the backend's `https` origin stays. Lands in: Task 4 (choice 7).
6. **The release flags are cleaned:** `VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE` (Task 3), `VITE_ENABLE_VOLCENGINE_AST2` and `VITE_ENABLE_KIZUNA_VOLCENGINE_AST2` (Task 4), `VITE_ENABLE_KIZUNA_SONIOX` (Task 6), `VITE_ENABLE_PALABRA_AI` (Task 8) leave `src/utils/environment.ts` (their `is…Enabled` readers), `.github/workflows/build.yml` (five env blocks each), `extension/vite.config.ts` (the forwarding), `.env.example`, and every test mock of them; `featureGateForwarding.consistency.test.ts` expects at least three gates, `VITE_ENABLE_KIZUNA_AI` and `VITE_ENABLED_PROVIDERS` among them (Task 8). `src/vite-env.d.ts` declared none of them (checked): it keeps `VITE_ENABLE_KIZUNA_AI` and `VITE_ENABLE_LOCAL_NATIVE`. `VITE_ENABLE_KIZUNA_AI`, `VITE_ENABLE_LOCAL_NATIVE` and `VITE_ENABLED_PROVIDERS` stay. The owner deletes the five repository variables afterwards (Task 12 lists them).
7. **The project `CLAUDE.md` is rewritten** for the new structure: the Project Overview's provider list; "AI Client Architecture" becomes "Provider Architecture"; the `settingsStore` bullet and "Code Organization"; the Zustand example (it used the old `useProvider`); "Error Handling"'s "Inside an `IClient` session" becomes "Inside an adapter session" — with the seven adapters' and the session-side guard's citations of that heading; "Key Libraries" without `openai-realtime-api` and the `livekit-client` pin section; "Adding a New AI Provider" per the spec's "What adding a provider then touches" as the ports landed; the CSP's provider list; the user-managed keys; and "Authentication Flow for Kizuna AI" / "Key Services", which described an `ApiKeyService` that no longer exists. Every other section stays; it says Local Native runs the old path until #578. Lands in: Task 11.
8. **`fake` and `fake_leased` stay:** the development and test providers, registered in development builds only (D24), driving about forty test files and `SpinePreview`. No task touches `src/providers/fake/`; the group check's D24 greps prove neither reaches a release bundle.
9. **`CONTEXT.md` is rewritten too** (the owner, 2026-10-01: 「CONTEXT.md 一起改」): its glossary entries for the old registry, descriptors and `IClient` follow the new structure, in the same task as `CLAUDE.md`, keeping every entry still true and saying Local Native still runs the old path until #578. Lands in: Task 11.
10. **`README.md`, `docs/`, `CHANGELOG.md` and `bug_report.yml`'s OpenAI Compatible block wait for the release that carries Stage 2** (the owner, 2026-10-01: 「README 那些等发布再改」): out of this plan; Task 12's roadmap record lists them for that release (choice 12).
11. **`CONTEXT.md`'s native model resolution entries are rewritten too** (the owner, 2026-10-01: 「改」, on Revision 2's open question): the Model catalog card, Planner / Loader and Plan entries described the ONNX-era sidecar (sherpa-onnx voices, CUDA variant subdirectories); they follow the ggml-only sidecar, verified against `sidecar/sokuji_sidecar/` (`catalog.py`, `planner.py`, `accel.py`, `native.py`, the three backends), `native/` and the renderer's `src/lib/local-inference/native/`, glossary-short with files cited. Lands in: Task 11.

**The controller's:**

- **C1, the `Provider` enum:** only the three dead ids go — `KIZUNA_AI_OPENAI_TRANSLATE` (Task 3), `KIZUNA_AI_VOLCENGINE_AST2` (Task 4), `OPENAI_COMPATIBLE` (Task 7). The nine live ids and `LOCAL_NATIVE` stay; so do `providerPath.test.ts`' `OPENAI_LIVE` row and the three wizard cases that name `'openai_compatible'`, now as a cast string (stored data, not an id).
- **C2, `@google/genai`:** stays; it is already a development dependency used only by type imports and `wire.oracle.test.ts` (research note 2). Its two comments say so (Task 5).
- **C3, the old AST2 DNR rules 2000–2009:** the start-up sweep takes them (`wsHeaderRule.js`: `OLD_AST2_RULE_ID_MIN` / `_MAX`, `isOldRule`), its tests say so; the AST2 block and its two message handlers go; `dnrUpdatePromise` moves (Task 4).
- **C4, the kept shell's default provider:** the shell tolerates an empty old registry; `Provider.OPENAI` stays the inert default (research note 1; choice 4). Lands in: Tasks 1, 10.
- **C5:** `speechMode.ts` and its test are deleted — no importer since 1e-3c; its test iterated every old descriptor (Task 2, the first task that shrinks the old registry).
- **C6:** `PoweredBy` and its two tests leave the kept shell, with `providers.{kizunaai_soniox,kizunaai_openai_translate,kizunaai_volcengine_ast2}.vendor` — nothing else reads them; `providers.poweredBy`, the new picker's credit, stays (Task 1).
- **C7:** one plan, a task per group, the tree compiling and every suite green after each (the order under Architecture).

**The controller's, Revision 1** (on the independent review; `deletion-plan-revision1.md`):

- **C8, the applier proves what it removes** (the review's I1): a hash on every shortened run; a hunk whose old side occurs more than once names its occurrence, and any other ambiguity refuses; a pre-flight checks every named file is `fa301e9a`'s; the tools' self-test — the review's two mutants among its cases — runs before Task 1 and shows they refuse. Lands in: Global Constraints, the pre-flight, the appendix.
- **C9, the stale comments** (M1, N4): each rewritten to what is true after the plan, citing rulings or choices only. Lands in: Tasks 6, 8, 9, 10, 11 (and Task 2's, found while writing them).
- **C10, three more inheritance rows** (M2), marked in Task 12's in-place list.
- **C11, the import guard is a test** (M3), `src/providers/oldPath.consistency.test.ts`, in Task 10, where the old set is final.
- **C12, `CLAUDE.md`'s false passages** (M4, N2), corrected in Task 11 against the result.
- **C13, the typecheck as a set** (M5): `tscdiff.py` against the task before; the count kept as a second check.
- **C14, the release docs** (M6; ruling 10): Task 12 lists them as the release's follow-ups.
- **C15, the nits** (N1, N3, N5): the sweep's citations name the OpenAI Live plan; the key tool refuses a namespace; this plan's own gate baseline file.
- **C16, open question 1:** the 51 locale keys already unused at `fa301e9a` are out of this plan; Task 12 records them as a follow-up, `settings.geminiParticipantTokenWarning` named.
- **C17, open question 4:** the four client diagnostic codes with no sender — `cleanup_failed`, `input_pipeline_failed`, `send_dropped`, `lease_notify_failed` — are deleted from `clientDiagnostics.ts`, `noticeText.ts`, the 30 catalogs and `Conversation.test.ts`. Lands in: Task 10.

## Choices this plan makes inside the rulings

Cited as *choice N* (in code, "Stage 2 deletion, choice N").

1. **The shell first.** Task 1 reduces `ProviderSection`, `LanguageSection` and `ProviderSpecificSettings` to their Local Native branches — the shell every group's old UI branch sits in — so that no later task edits a 2 400-line component group by group. What it removes is unreachable already: the shell is not mounted, and every other provider's settings are its own view. It keeps the shell's generic scaffolding (the select, the unregistered placeholder, the chips, the engine surface) and deletes `PoweredBy` (ruling C6), the old-shell tests of other providers, `KIZUNA_HOSTED_ICONS`, `OPENAI_COMPATIBLE_PROVIDERS` / `isOpenAICompatible` / `kizunaBaseProvider` (the shell was their last reader), the `src/services/clients/index.ts` barrel (no importer) and the shell's now-unused styles.
2. **The order:** the shell; OpenAI Live (its old client imports OpenAI Realtime's and Translate's modules, so it goes before them); OpenAI Translate's relay twin (it extends the own-key descriptor); Doubao AST 2.0 with its twin (the last relay user: the relay's URL, CSP origins and `uuid` go with it); Gemini; the two Soniox providers (with them the managed session's `ClientOptions`, the budget helpers and the old managed store arm); the merged OpenAI deletion (`openai-realtime-api`, `evals/`); Palabra (`livekit-client`, the bridge); LocalInference's leftovers; the shared old code's last trim; `CLAUDE.md`. The survey's §5 order but for choice 1.
3. **Comments about the old code:** a comment citing where new code was ported from keeps its citation and says "deleted since"; a comment claiming the old code is present or compiled is corrected; a comment that described only deleted code goes with it. Local Native's keep set keeps its comments as they are (ruling 1), stale ones included (What this plan leaves).
4. **The kept shell's default** (ruling C4): tolerate, don't switch — research note 1.
5. **A mechanism goes with its last user:** `ProviderDescriptor.ClientOptions.sonioxManaged` and the session-resources hooks (`acquireSessionResources`, `SessionResources`, `BudgetSnapshot`), `settingsStore`'s `neverPersist`, `transformPatch`, the OpenAI key prefill and model auto-select, the `isSignedIn` / `getAuthToken` parameters, `sttStream.ts`' `onTick`, the base descriptor's OpenAI-shaped participant turn-detection override, `cacheTimestamp` / `validationCache` / `loadingModels` / `fetchAvailableModels`, the old instruction fields and `getProcessedSystemInstructions`, and `ClientOperations.ts`. Each is named in its task.
6. **The `sokuji-auth.` redaction rule stays, as a net:** no client sends the relay subprotocol after Task 4, but it carried a Better Auth session token and the rule costs nothing; its comment says so (Task 7).
7. **The CSP's five origins go together with the last relay twin** (Task 4), not spread over the tasks: the manifest test pins all seven entries in one case.
8. **`evals/`' own dependencies go with it:** `ajv` and `ajv-formats` (only `evals/runner/core/{ResultWriter,TestCaseLoader}.ts` imported them). `tsx`, `ws` and `@types/ws` stay (the wire probes use them).
9. **Old tests:** a test of old code that pins behaviour the kept shell or Local Native still has is re-pointed to Local Native (research note 6); one that pins only deleted behaviour goes with it, file or case; a table test keyed by every old provider (`descriptorRegistry.test.ts`, `participantConfig.test.ts`, `settingsStore.sliceRegistry.test.ts`) loses the deleted rows task by task, its tables made `Partial` where the enum keeps ids the old registry no longer registers (ruling C1).
10. **Locale keys go with the task that orphans them** — the key's last reader — and never before; a key a surviving dynamic lookup still reads stays (research note 7). The four diagnostic codes' `notices.*` keys go with the codes (Task 10, ruling C17). The 51 keys unreferenced before this plan are not its (ruling C16).
11. **The gate's regex is trimmed at the group check,** not by a task: `oar-gate.sh` is outside the repository and shared by the controller's other work; after Task 6 its `services/(clients|providers)/…` alternative matches no file, and the trimmed command prints the same lines.
12. **Where the owner's released app is described, not the code,** this plan changes nothing (ruling 10): `README.md`, `docs/*.html`, `docs/tutorials/*`, `CHANGELOG.md` and `.github/ISSUE_TEMPLATE/bug_report.yml` (its OpenAI Compatible block) describe the app users run, which still has OpenAI Compatible and Palabra's LiveKit path until a release carries Stage 2; Task 12 lists them for that release.

## Stored keys: what each new provider reads after the deletion

Ruling 3 and the owner's rule (no one-time migration code) require it: deleting an old slice removes the old store's reader of a key, never the key, and never a key a new provider reads. Every new provider reads through `providerStore.load` (`src/stores/providerStore.ts`, `load`): each field of its `settings.defaults` at `settings.<key>.<field>`, each credential of `credentials.keys` at `settings.<key>.<k>`, its `legacyKeys` (a field under the prefix, or a whole `settings.*` key) with no default, and the pair at `settings.<key>.sourceLanguage` / `targetLanguage`; then `settings.migrate` and `languages.migratePair`, in memory. **It writes nothing on load.** `<key>` is the old slice key (`src/lib/session/storedSettings.ts`, `LEGACY_SLICE_KEYS`, untouched). The global reads stay too: `settings.common.provider` (`src/app/loadStores.ts`, written only by `providerStore.select`), and `settings.common.turnMode` with its one-time read of the stored provider's `settings.<slice>.turnDetectionMode` (`loadStores.ts`, `storedSettings.ts`).

| New provider | Prefix | Keys it reads (defaults + credentials + legacy + pair) | Old reader deleted | Reader after the deletion |
|---|---|---|---|---|
| `kizunaai_soniox` | `settings.kizunaSoniox.*` | region, voice, voiceEu, voiceJp, bothModeSharedSession, vocabularyTerms, vocabularyTranslations, contextText, endpointSensitivity, endpointLatencyAdjustmentLevel, endpointMaxDelayMs, ttsSpeed, the pair; no credentials (`managed`, `keys: []`) | the `kizunaSoniox` slice, its `neverPersist` policy and hooks (Task 6) | `providerStore.load` via `src/providers/soniox/kizuna.ts` |
| `soniox` | `settings.soniox.*` | the same, plus `apiKey`, `apiKeyEu`, `apiKeyJp` | the `soniox` slice (Task 6) | `providerStore.load` via `src/providers/soniox/provider.ts` |
| `localInference` | `settings.localInference.*` | selections, ttsSpeakerId, ttsSpeed, edgeTtsVoice, the five `vad*` fields, useTemplateMode, systemPrompt, participantSystemPrompt, the pair | the `localInference` slice, `updateLocalInference`, the `validateApiKey` arm (Task 9) | `providerStore.load` via `src/providers/localInference/provider.ts` |
| `gemini` | `settings.gemini.*` | the three instruction fields, model, voice, temperature, maxTokens, vadStartSensitivity, vadEndSensitivity, vadSilenceDurationMs, vadPrefixPaddingMs, `apiKey`, the pair; **legacy:** `settings.common.{useTemplateMode,systemInstructions,participantSystemInstructions}` (`src/lib/provider/instructions.ts`) | the `gemini` slice and its model auto-select (Task 5) | `providerStore.load` via `src/providers/gemini/provider.ts` |
| `volcengine_ast2` | `settings.volcengineAST2.*` | authMode, hotWordTableId, replacementTableId, glossaryTableId; `appId`, `accessToken`, `apiKey`; the pair | the `volcengineAST2` and `kizunaVolcengineAst2` slices (Task 4) | `providerStore.load` via `src/providers/volcengine_ast2/provider.ts` |
| `openai` | `settings.openai.*` | the three instruction fields, model, voice, turnDetectionMode, threshold, prefixPadding, silenceDuration, semanticEagerness, maxTokens, transcriptModel, transcriptKeywords, noiseReduction, reasoningEffort; `apiKey`; the pair; legacy as Gemini's | the `openai` and `openaiCompatible` slices, the model migration and auto-select (Task 7) | `providerStore.load` via `src/providers/openai/provider.ts` |
| `openai_translate` | `settings.openaiTranslate.*` | noiseReduction, `apiKey`, the pair | the `openaiTranslate` slice, its key prefill and transcript-model migration (Task 7); its relay twin's slice (Task 3) | `providerStore.load` via `src/providers/openai_translate/provider.ts` |
| `openai_live` | `settings.openaiLive.*` | the three instruction fields, voice, `apiKey`, the pair; legacy as Gemini's | the `openaiLive` slice and its key prefill (Task 2) | `providerStore.load` via `src/providers/openai_live/provider.ts` |
| `palabraai` | `settings.palabraai.*` | authMode, voiceId, segmentConfirmationSilenceThreshold, sentenceSplitterEnabled, translatePartialTranscriptions, desiredQueueLevelMs, maxQueueLevelMs, autoTempo; `apiKey`, `clientId`, `clientSecret`; the pair; no legacy keys | the `palabraai` slice and its two load migrations (Task 8) | `providerStore.load` via `src/providers/palabraai/provider.ts` |
| Local Native (old path, kept) | `settings.localNative.*` | its slice's fields and the pair | — | `settingsStore.loadSettings` (the one slice it still loads) and `nativeModelStore.applyPrunes`' write through `updateLocalNative`, both kept (ruling 1) |
| the common settings | `settings.common.*` | uiLanguage, uiMode, textOnly, keepReplayAudio, autoSaveOnStop, diagnosticLogs, the segmentation and display settings | — | `settingsStore.loadSettings`, unchanged. `settings.common.{useTemplateMode,systemInstructions,participantSystemInstructions}` lose their old reader and writer (Task 10) and stay on disk, read only as the legacy keys above |

What becomes an orphan on disk — stored, never read, never deleted (nothing deletes a stored value): OpenAI's `transportType` and `temperature`; OpenAI Translate's `transcriptModel` and `transportType`; Palabra's `subscriberCount` and `publisherCanSubscribe`; Soniox's `model`; `settings.common.templateSystemInstructions`; all of `settings.openaiCompatible.*`, `settings.kizunaOpenaiTranslate.*` and `settings.kizunaVolcengineAst2.*`. A stored selection of a deleted id (`settings.common.provider` = `openai_compatible`, `kizunaai_openai_translate` or `kizunaai_volcengine_ast2`) keeps resolving as it does at `fa301e9a`: `MANAGED_LEGACY_IDS` and the registry's first offer (`selectionFromStored`, `src/lib/session/storedSettings.ts`; `src/app/loadStores.test.ts` pins both, unchanged).

## File structure

One file is created: the import guard, `src/providers/oldPath.consistency.test.ts` (Task 10). What each task deletes, as files (every line of them) — the rest of its change is edits:

| Task | Group | Files deleted | Their lines, as the task finds them | The task's `git diff --shortstat` |
|---|---|---|---|---|
| 1 | the old settings shell | 10 | 1 156 | 58 files, +542 −5 344 |
| 2 | OpenAI Live | 6 | 3 658 | 48 files, +49 −3 920 |
| 3 | OpenAI Translate's relay twin | 1 | 92 | 58 files, +31 −391 |
| 4 | Doubao AST 2.0 and its relay twin | 10 | 1 961 | 81 files, +105 −2 664 |
| 5 | Gemini | 5 | 3 653 | 21 files, +40 −3 901 |
| 6 | Soniox and Kizuna Soniox | 44 | 12 197 | 109 files, +117 −13 130 |
| 7 | OpenAI Realtime, OpenAI Translate, OpenAI Compatible, `evals/` | 49 | 13 598 | 107 files, +53 −14 613 |
| 8 | Palabra | 10 | 3 159 | 64 files, +21 −3 660 |
| 9 | LocalInference's leftovers | 6 | 3 021 | 61 files, +223 −4 397 |
| 10 | the shared old code, the four diagnostic codes, the import guard | 1 | 36 | 46 files, +181 −628 |
| 11 | `CLAUDE.md`, `CONTEXT.md` | 0 | 0 | 11 files, +146 −121 |
| | **total** | **142** | **42 531** (42 724 as they stand at `fa301e9a`: ten old tests are trimmed by an earlier task before theirs deletes them) | **291 files, +1 308 −52 569** |

After Task 11, `src/services/` holds 27 files (from 115 at `fa301e9a`): the survivors under Architecture and their tests.

## Waves

The tasks run **one at a time, in order** (Global Constraints): the waves are review checkpoints, not parallel groups. Each wave ends with the controller's check — the full gates, and `npx vitest run electron` and `npx vitest run extension`.

- **Wave 1 — the shell and the four small groups:** Tasks 1–5.
- **Wave 2 — the three groups that take dependencies with them:** Tasks 6 (the managed session), 7 (`openai-realtime-api`, `evals/`), 8 (`livekit-client`).
- **Wave 3 — the leftovers and the words:** Tasks 9–11.
- **The group check** (controller), then **Task 12**, the controller's docs task.

## Note for the controller

- **Dispatch one task at a time**, with the Global Constraints and that task's section (its blocks included); review it before the next. The implementer's work is mechanical — `git rm`, the applier, the key tool, the check, the gates, the commit — so the review is of the result: `git show --stat HEAD` lists exactly the task's Files (its deletions, its modified files, and the 30 catalogs when it drops keys), and each gate reads as the task says.
- **The applier refuses rather than guesses** (Global Constraints states exactly what it checks). A refusal after a clean pre-flight means the tree moved under the plan: stop, regenerate the blocks from a fresh scratch replay on the new base, and re-dispatch. A line "hunk at N applied at M" cannot happen after a clean pre-flight; if it does, the content it matched is still exact (every line and hashed run), but report it.
- **Tasks 1 and 10 rewrite this plan's gate baseline file** (`deletion-gate-baseline.txt`), outside the repository; no other task touches it, and the shared `oar-gate-baseline.txt` is never written. The group check may trim the gate's regex (choice 11).
- **The typecheck's files** (`/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t00.txt` … `t11.txt`) are the gate's memory: keep them until Task 12.
- **If the branch has moved before the plan starts,** the pre-flight's second step fails: regenerate the blocks by replaying this plan's history on the new base in a scratch copy (`git archive HEAD | tar -x -C <scratch>`, `node_modules` and `extension/node_modules` linked), and quote the new counts.

## Pre-flight (controller, before Task 1)

Nothing in the repository changes. Each command is its own call, from the worktree root.

- [ ] **Step 1: The tools' self-test.**

  ```
  python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/selftest.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-selftest
  ```

  Expected, exactly (the review's two mutants are `run-edited` and `dup-unnamed`):

  ```
  ok   run-intact: a shortened run whose lines hash as printed is removed
  ok   run-edited: an edited line inside the run, the count kept, refuses and writes nothing (run.txt: the hunk at line 7 matches nowhere (a line, or a shortened run's hash, differs))
  ok   run-grown: a line inserted into the run refuses
  ok   dup-unnamed: a duplicated anchor that moved, with no occurrence named, refuses (dup.txt: the hunk at line 13 matches 2 places, and names no occurrence)
  ok   dup-named: the same hunk naming "occurrence 2 of 2" edits the second copy, and says it moved
  ok   dup-third-copy: a third copy makes "occurrence 2 of 2" refuse
  ok   create: a new file is created from its additions
  ok   create-exists: creating a file that exists refuses
  ok   all-or-nothing: a failing second file leaves the first unwritten
  ok   key-namespace: a namespace key refuses and writes nothing (src/locales/en/translation.json: not a string leaf: x)
  ok   key-leaf: a leaf is removed from every catalog
  selftest: 11 of 11 passed
  ```

- [ ] **Step 2: Every file the plan names is `fa301e9a`'s** (in the index and the working tree alike):

  ```
  git diff --quiet fa301e9a -- evals .env.example .github/workflows/build.yml .gitignore CLAUDE.md CONTEXT.md electron/ws-header-rules.js electron/ws-header-rules.test.js extension/background/background.js extension/background/background.wsHeaders.test.ts extension/background/wsHeaderRule.js extension/background/wsHeaderRule.test.ts extension/manifest.consistency.test.ts extension/manifest.json extension/package-lock.json extension/package.json extension/vite.config.ts package-lock.json package.json src/components/Icons/ProviderIcons.test.tsx src/components/Icons/ProviderIcons.tsx src/components/MainPanel/SplitDegradedChip.scss src/components/MainPanel/SplitDegradedChip.test.tsx src/components/MainPanel/SplitDegradedChip.tsx src/components/MainPanel/participantErrorOrdering.test.ts src/components/MainPanel/splitDegraded.test.ts src/components/MainPanel/splitDegraded.ts src/components/MainPanel/splitDegradedWiring.test.ts src/components/Settings/Settings.scss src/components/Settings/engine/StoragePage.test.tsx src/components/Settings/engine/StoragePage.tsx src/components/Settings/engine/languageName.ts src/components/Settings/engine/useWasmEngineAdapter.test.ts src/components/Settings/engine/useWasmEngineAdapter.ts src/components/Settings/sections/LanguageSection.sentence.test.tsx src/components/Settings/sections/LanguageSection.soniox.test.tsx src/components/Settings/sections/LanguageSection.textOnly.test.tsx src/components/Settings/sections/LanguageSection.tsx src/components/Settings/sections/ModelManagementSection.test.tsx src/components/Settings/sections/ModelManagementSection.tsx src/components/Settings/sections/PoweredBy.test.tsx src/components/Settings/sections/PoweredBy.tsx src/components/Settings/sections/ProviderSection.chips.test.tsx src/components/Settings/sections/ProviderSection.palabraai.test.tsx src/components/Settings/sections/ProviderSection.poweredBy.test.tsx src/components/Settings/sections/ProviderSection.recommended.test.tsx src/components/Settings/sections/ProviderSection.select.test.tsx src/components/Settings/sections/ProviderSection.signIn.test.tsx src/components/Settings/sections/ProviderSection.soniox.test.tsx src/components/Settings/sections/ProviderSection.tsx src/components/Settings/sections/ProviderSpecificSettings.engine.test.tsx src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx src/components/Settings/sections/ProviderSpecificSettings.tsx src/components/Settings/sections/SonioxVoiceSection.test.tsx src/components/Settings/sections/SonioxVoiceSection.tsx src/components/Settings/sections/voiceLibrarySource.test.ts src/components/Settings/sections/voiceLibrarySource.ts src/components/SettingsInitializer/SettingsInitializer.test.tsx src/components/SetupWizard/SetupWizard.test.tsx src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/steps/StepCredentials.test.tsx src/components/SetupWizard/useApplySetup.test.ts src/components/TitleBar/AccountButton.test.tsx src/components/Tour/useStartBasicsTour.test.tsx src/components/providers/ProviderPicker.test.tsx src/lib/conversation/Conversation.test.ts src/lib/diagnostics/clientDiagnostics.ts src/lib/diagnostics/consoleLedger.consistency.test.ts src/lib/diagnostics/redact.test.ts src/lib/diagnostics/redact.ts src/lib/diagnostics/report.ts src/lib/modern-audio/WebRTCAudioBridge.test.ts src/lib/modern-audio/WebRTCAudioBridge.ts src/lib/provider/instructions.test.ts src/lib/session/storedSettings.ts src/lib/setup/providerPath.test.ts src/lib/tts/previewSample.test.ts src/lib/view/noticeText.ts src/locales/locales.consistency.test.ts src/providers/gemini/adapter.ts src/providers/gemini/settings.ts src/providers/gemini/wire.oracle.test.ts src/providers/openai/adapter.ts src/providers/openai/transcription.ts src/providers/openai/wire.oracle.test.ts src/providers/openai/wire.ts src/providers/openai_live/adapter.ts src/providers/openai_translate/adapter.ts src/providers/palabraai/adapter.ts src/providers/palabraai/provider.ts src/providers/palabraai/settings.test.ts src/providers/sessionSide.consistency.test.ts src/providers/soniox/adapter.ts src/providers/soniox/config.ts src/providers/soniox/kizunaBudget.ts src/providers/soniox/lease.ts src/providers/soniox/managedVoicesClient.ts src/providers/soniox/sideTracker.ts src/providers/soniox/socket.ts src/providers/soniox/sttStream.ts src/providers/soniox/ttsStream.ts src/providers/soniox/voiceClaim.ts src/providers/soniox/voicePrep.ts src/providers/volcengine_ast2/adapter.ts src/providers/volcengine_ast2/codec.test.ts src/services/ClientOperations.test.ts src/services/ClientOperations.ts src/services/EphemeralTokenService.test.ts src/services/EphemeralTokenService.ts src/services/SettingsService.ts src/services/clients/ClientFactory.test.ts src/services/clients/ClientFactory.ts src/services/clients/GeminiClient.test.ts src/services/clients/GeminiClient.ts src/services/clients/LocalInferenceClient.test.ts src/services/clients/LocalInferenceClient.ts src/services/clients/ManagedSonioxSession.outcome.test.ts src/services/clients/ManagedSonioxSession.test.ts src/services/clients/ManagedSonioxSession.ts src/services/clients/ManagedVoicesClient.ts src/services/clients/OpenAIClient.test.ts src/services/clients/OpenAIClient.ts src/services/clients/OpenAIGAClient.test.ts src/services/clients/OpenAIGAClient.ts src/services/clients/OpenAILiveClient.test.ts src/services/clients/OpenAILiveClient.ts src/services/clients/OpenAITranslateGAClient.test.ts src/services/clients/OpenAITranslateGAClient.ts src/services/clients/OpenAITranslateWebRTCClient.test.ts src/services/clients/OpenAITranslateWebRTCClient.ts src/services/clients/OpenAIWebRTCClient.test.ts src/services/clients/OpenAIWebRTCClient.ts src/services/clients/PalabraAIClient.test.ts src/services/clients/PalabraAIClient.ts src/services/clients/PcmMixer.ts src/services/clients/SonioxClient.managed.test.ts src/services/clients/SonioxClient.test.ts src/services/clients/SonioxClient.ts src/services/clients/SonioxCostMeter.test.ts src/services/clients/SonioxCostMeter.ts src/services/clients/SonioxSessionOutcome.test.ts src/services/clients/SonioxSessionOutcome.ts src/services/clients/SonioxSideTracker.ts src/services/clients/SonioxSttStream.ts src/services/clients/SonioxTtsRest.ts src/services/clients/SonioxTtsStream.ts src/services/clients/SonioxVoicesClient.ts src/services/clients/VolcengineAST2Client.test.ts src/services/clients/VolcengineAST2Client.ts src/services/clients/index.ts src/services/clients/managedVoicePolling.ts src/services/clients/openAIRealtimeSession.test.ts src/services/clients/openAIRealtimeSession.ts src/services/clients/volcengine-ast2/ast2-proto.d.ts src/services/clients/volcengine-ast2/ast2-proto.js src/services/interfaces/IClient.ts src/services/interfaces/ISettingsService.ts src/services/providers/GeminiProviderConfig.ts src/services/providers/KizunaAIOpenAITranslateProviderConfig.ts src/services/providers/KizunaAISonioxProviderConfig.ts src/services/providers/KizunaAIVolcengineAST2ProviderConfig.ts src/services/providers/LocalInferenceProviderConfig.ts src/services/providers/OpenAICompatibleProviderConfig.ts src/services/providers/OpenAILiveProviderConfig.test.ts src/services/providers/OpenAILiveProviderConfig.ts src/services/providers/OpenAIProviderConfig.ts src/services/providers/OpenAITranslateProviderConfig.ts src/services/providers/PalabraAIProviderConfig.test.ts src/services/providers/PalabraAIProviderConfig.ts src/services/providers/ProviderConfig.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/ProviderDescriptor.ts src/services/providers/SonioxProviderConfig.test.ts src/services/providers/SonioxProviderConfig.ts src/services/providers/VolcengineAST2ProviderConfig.ts src/services/providers/acquireSessionResources.kizunaSoniox.test.ts src/services/providers/astGuard.test.ts src/services/providers/astGuard.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/geminiTranslateModel.test.ts src/services/providers/geminiTranslateModel.ts src/services/providers/kizunaProviderGating.test.ts src/services/providers/localNativeGating.test.ts src/services/providers/localParticipantConfig.ts src/services/providers/managedSonioxSplit.test.ts src/services/providers/managedSonioxSplit.ts src/services/providers/managedVoicePrep.test.ts src/services/providers/managedVoicePrep.ts src/services/providers/openaiTranscriptionContext.test.ts src/services/providers/openaiTranscriptionContext.ts src/services/providers/palabraLanguageCodes.test.ts src/services/providers/participantConfig.test.ts src/services/providers/prepareToStart.kizunaSoniox.test.ts src/services/providers/prepareToStart.local.test.ts src/services/providers/providerOrder.test.ts src/services/providers/sessionResourcesWiring.test.ts src/services/providers/sonioxBothMode.test.ts src/services/providers/sonioxBothMode.ts src/services/providers/sonioxManagedMinBalance.test.ts src/services/providers/sonioxManagedMinBalance.ts src/services/providers/sonioxSharedBothSession.test.ts src/services/providers/speechMode.test.ts src/services/providers/speechMode.ts src/services/providers/tutorialUrls.ts src/services/providers/voicePrepWiring.test.ts src/services/providers/volcengineAST2LanguageSync.test.ts src/services/providers/volcengineAST2LanguageSync.ts src/services/worklets/pcm-audio-worklet-processor.js src/stores/ensureSelectionReady.test.ts src/stores/kizunaProviders.test.ts src/stores/logStore.test.ts src/stores/logStore.ts src/stores/modelStore.test.ts src/stores/modelStore.ts src/stores/nativeModelStore.test.ts src/stores/openaiModelMigration.test.ts src/stores/palabraAuthModeMigration.test.ts src/stores/palabraLanguageMigration.test.ts src/stores/sanitizeEvent.test.ts src/stores/sanitizeEvent.ts src/stores/sessionStore.ts src/stores/settingsStore.kizunaAuth.test.ts src/stores/settingsStore.providerSettings.test.tsx src/stores/settingsStore.selections.test.ts src/stores/settingsStore.sliceRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts src/types/Provider.test.ts src/types/Provider.ts src/utils/environment.test.ts src/utils/environment.ts src/utils/featureGateForwarding.consistency.test.ts src/utils/textUtils.ts 'src/locales/*/translation.json'
  ```

  Expected: exit status 0 and no output. Anything else: stop (the Note for the controller).
- [ ] **Step 3: This plan's gate baseline.** `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh` prints exactly the 20 lines under Global Constraints; write them, and nothing else, to `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` (the Write tool).
- [ ] **Step 4: The typecheck's starting set.** `mkdir -p /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc`, then `npx tsc --noEmit -p tsconfig.json > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t00.txt`, then `command grep -c 'error TS' /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t00.txt` prints **259**.

## What this plan consumes from the earlier plans

Named as landed at `fa301e9a`; none of it changes.

| From | What it is | Why it matters here |
|---|---|---|
| Stage 1 and the foundation plan: `providerStore.load`, `LEGACY_SLICE_KEYS`, `MANAGED_LEGACY_IDS` and the first-offer fallback (`selectionFromStored`; all `src/lib/session/storedSettings.ts`), applied by `src/app/loadStores.ts` | every provider reads its stored keys through them; a stored deleted id resolves through them | the stored keys stay readable with no migration code (the table above) |
| The Stage 2 OpenAI Live plan: `wsHeaderRule.js`' `sweepIds`, `OLD_LIVE_RULE_ID`, the start-up sweep in `background.js`; `electron/ws-header-rules.js`; `background.wsHeaders.test.ts` | the sweep the old AST2 range joins, the listener whose comments lose the old AST2 client | Tasks 2, 4 (ruling C3) |
| The Stage 2 plans' definitions: `src/providers/<id>/provider.ts`, `settings.ts` (`legacyKeys`, `migrate`), `registry.ts` | what replaced each old descriptor and slice | every task's "reader after the deletion" |
| The Kizuna Soniox plan's moves: `src/providers/soniox/{voicesClient,ttsRest,managedVoicesClient,managedVoicePolling,config,settings}.ts` | what the eight stubs re-exported | Task 6's re-points |
| The foundation plan's `featureGateForwarding.consistency.test.ts` and the extension's `manifest.consistency.test.ts` | the release flags' and the CSP's guards | Tasks 3, 4, 6, 8 |
| `consoleLedger.consistency.test.ts` (#441) | the `console.*` rows per file | Tasks 1 and 8 lower it where the counted file loses its calls |

### Task 1: The old settings shell, reduced to Local Native (Wave 1)

The old settings shell — `ProviderSection.tsx`, `LanguageSection.tsx`, `ProviderSpecificSettings.tsx` — is not mounted: every provider's settings are its own view in `src/providers/<id>/`, and the shell survives only as the part of Local Native's old path #578 will port (ruling 1). This task keeps its Local Native branches and generic scaffolding and deletes every other provider's branch, so no later task has to edit it group by group (choice 1).

**What goes, and what changes:**
- `ProviderSpecificSettings.tsx` keeps Local Native's engine surface, TTS speed, speech mode, translation prompt and VAD controls; every other provider's `render…Settings`, its model list, transport and turn-detection controls, and the imports only they used go (−2 217 +77). Its two `TS6133` gate lines go with the unused template-instruction destructuring.
- `ProviderSection.tsx` keeps the select (Local Native, where it is registered), the unregistered-value placeholder, the model chips, the engine status line; the API-key form, the sign-in and relay rows, the recommended badge, `PoweredBy` and every other provider's branch go. `LanguageSection.tsx` keeps Local Native's pair, swap, text-only line and missing-models warning; it renders nothing for any other stored provider (choice 4).
- `PoweredBy.tsx` and its two tests (ruling C6); `ProviderIcons.tsx`' `KIZUNA_HOSTED_ICONS` (its test now builds the three plated shapes itself); `Provider.ts`' `OPENAI_COMPATIBLE_PROVIDERS`, `isOpenAICompatible` and `kizunaBaseProvider`; `tutorialUrls.ts` down to Local Native's guide and the docs index; the barrel `src/services/clients/index.ts` (no importer); the shell's unused styles in `Settings.scss`.
- `sessionStore.ts` (Revision 2): its header named `ProviderSpecificSettings` reading `useSessionIsInitializing`; after the reduction only `useLockedMode` has readers (the three shell files), so `isInitializing`, `setIsInitializing` and `useSessionIsInitializing` go and the header says what still reads the store (choice 5; choice 3).
- The shell's tests of other providers go (`LanguageSection.soniox`, `ProviderSection.{palabraai,poweredBy,recommended,signIn,soniox}`, `ProviderSpecificSettings.soniox`); the ones that pin surviving behaviour re-point to Local Native (`LanguageSection.sentence`, `LanguageSection.textOnly`, `ProviderSection.chips`, `ProviderSection.select`, `ProviderSpecificSettings.engine`; choice 9). `consoleLedger.consistency.test.ts` drops `ProviderSpecificSettings.tsx`' row (its two calls sat in the deleted branches).
- 17 locale keys only the deleted branches read: the three relay `providers.*.vendor` (ruling C6), `providers.openaiCompatible.customEndpointPlaceholder`, the WebRTC and transport words, the model-list words, `settings.languageSettings`, `settings.sonioxAutoParticipantWarning`, `settings.translateSourceParticipantWarning`, `simpleSettings.fetchingApiKey`.

**Files:**
- Delete (10): `src/components/Settings/sections/LanguageSection.soniox.test.tsx`, `src/components/Settings/sections/PoweredBy.test.tsx`, `src/components/Settings/sections/PoweredBy.tsx`, `src/components/Settings/sections/ProviderSection.palabraai.test.tsx`, `src/components/Settings/sections/ProviderSection.poweredBy.test.tsx`, `src/components/Settings/sections/ProviderSection.recommended.test.tsx`, `src/components/Settings/sections/ProviderSection.signIn.test.tsx`, `src/components/Settings/sections/ProviderSection.soniox.test.tsx`, `src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`, `src/services/clients/index.ts`
- Modify (18, by the blocks below): `src/components/Icons/ProviderIcons.test.tsx`, `src/components/Icons/ProviderIcons.tsx`, `src/components/Settings/Settings.scss`, `src/components/Settings/sections/LanguageSection.sentence.test.tsx`, `src/components/Settings/sections/LanguageSection.textOnly.test.tsx`, `src/components/Settings/sections/LanguageSection.tsx`, `src/components/Settings/sections/ProviderSection.chips.test.tsx`, `src/components/Settings/sections/ProviderSection.select.test.tsx`, `src/components/Settings/sections/ProviderSection.tsx`, `src/components/Settings/sections/ProviderSpecificSettings.engine.test.tsx`, `src/components/Settings/sections/ProviderSpecificSettings.tsx`, `src/components/providers/ProviderPicker.test.tsx`, `src/lib/diagnostics/consoleLedger.consistency.test.ts`, `src/locales/locales.consistency.test.ts`, `src/services/providers/tutorialUrls.ts`, `src/stores/sessionStore.ts`, `src/types/Provider.test.ts`, `src/types/Provider.ts`
- The 30 locale catalogs `src/locales/*/translation.json`, by the key tool (17 keys)

**Interfaces:**
- Consumes: nothing of this plan.
- Produces: the shell with Local Native's branches alone; `Provider.ts` without `OPENAI_COMPATIBLE_PROVIDERS`, `isOpenAICompatible`, `kizunaBaseProvider`; `ProviderIcons.tsx` without `KIZUNA_HOSTED_ICONS` (`kizunaHostedIcon` stays); `tutorialUrls.ts` exporting `TUTORIAL_URLS` (Local Native's entry) and `AI_PROVIDERS_DOCS_URL`; `sessionStore.ts` holding `lockedMode` alone (`useLockedMode`, `setLockedMode`). Every later task's blocks are generated on this result.

- [ ] **Step 1: Delete the files.**

  ```
  git rm -q -- src/components/Settings/sections/LanguageSection.soniox.test.tsx src/components/Settings/sections/PoweredBy.test.tsx src/components/Settings/sections/PoweredBy.tsx src/components/Settings/sections/ProviderSection.palabraai.test.tsx src/components/Settings/sections/ProviderSection.poweredBy.test.tsx src/components/Settings/sections/ProviderSection.recommended.test.tsx src/components/Settings/sections/ProviderSection.signIn.test.tsx src/components/Settings/sections/ProviderSection.soniox.test.tsx src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx src/services/clients/index.ts
  ```

- [ ] **Step 2: Apply the task's diff blocks** (Global Constraints: never by hand).

  ```
  python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/plan-apply.py docs/superpowers/plans/2026-09-30-client-contract-stage2-deletion.md t01
  ```

  Expected: `t01: 18 files changed`, and no other line.

- [ ] **Step 3: Remove the locale keys only the deleted code read.**

  ```
  node /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/drop-locale-keys.mjs . providers.kizunaai_openai_translate.vendor providers.kizunaai_soniox.vendor providers.kizunaai_volcengine_ast2.vendor providers.openaiCompatible.customEndpointPlaceholder settings.languageSettings settings.loadingModels settings.pushToTranslateNotAvailableInWebrtc settings.refreshModels settings.sonioxAutoParticipantWarning settings.translateSourceParticipantWarning settings.transportType settings.transportTypeTooltip settings.webrtc settings.webrtcVadDisabledTitle settings.webrtcVadNotice settings.websocket simpleSettings.fetchingApiKey
  ```

  Expected: `17 keys removed from 30 catalogs`.

- [ ] **Step 4: Check that nothing reaches what went.**

  ```
  git grep -nE "PoweredBy|KIZUNA_HOSTED_ICONS|isOpenAICompatible|kizunaBaseProvider|OPENAI_COMPATIBLE_PROVIDERS|services/clients'|services/clients/index|useSessionIsInitializing|setIsInitializing" -- src
  ```

  Expected: nothing (exit status 1).

- [ ] **Step 5: Run the gates.** Each command as its own call; every expected number is the replay's.

  - `npx vitest run src`: **582 files passed and 1 skipped (583); 7 635 tests passed and 2 skipped (7 637)**; 0 failed, no unhandled errors.
  - `npx vitest run electron`: 34 files, 477 tests passed. `npx vitest run extension`: 9 files, 56 tests passed.
  - Local Native's old path: `npx vitest run src/services src/lib/local-inference/native src/components/Settings/sections/Native src/components/Settings/engine/useNativeEngineAdapter src/stores/nativeModelStore src/stores/settingsStore` — 80 files, 1 499 tests passed.
  - The typecheck, as a set: `npx tsc --noEmit -p tsconfig.json > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t01.txt`, then `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t00.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t01.txt` prints exactly `before 259 after 255; new 0; gone 4` and exits 0 — no error the task before did not have; `after 255` is the full tree's count.
  - **The gate's baseline drops to 18 lines.** First check `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh` prints exactly these lines —

    ```
    src/App.tsx: error TS6133: 'React' is declared but its value is never read.
    src/components/MainLayout/MainLayout.tsx: error TS6133: 'useTranslation' is declared but i
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

    — then write them, and nothing else, to `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` (this plan's own baseline file, outside the repository; the Write tool). From here on the gate is that file.

- [ ] **Step 6: Commit.**

```bash
git add -- src/components/Icons/ProviderIcons.test.tsx src/components/Icons/ProviderIcons.tsx src/components/Settings/Settings.scss src/components/Settings/sections/LanguageSection.sentence.test.tsx src/components/Settings/sections/LanguageSection.textOnly.test.tsx src/components/Settings/sections/LanguageSection.tsx src/components/Settings/sections/ProviderSection.chips.test.tsx src/components/Settings/sections/ProviderSection.select.test.tsx src/components/Settings/sections/ProviderSection.tsx src/components/Settings/sections/ProviderSpecificSettings.engine.test.tsx src/components/Settings/sections/ProviderSpecificSettings.tsx src/components/providers/ProviderPicker.test.tsx src/lib/diagnostics/consoleLedger.consistency.test.ts src/locales/locales.consistency.test.ts src/services/providers/tutorialUrls.ts src/stores/sessionStore.ts src/types/Provider.test.ts src/types/Provider.ts 'src/locales/*/translation.json'
```

```bash
git commit -q -F - -- src/components/Settings/sections/LanguageSection.soniox.test.tsx src/components/Settings/sections/PoweredBy.test.tsx src/components/Settings/sections/PoweredBy.tsx src/components/Settings/sections/ProviderSection.palabraai.test.tsx src/components/Settings/sections/ProviderSection.poweredBy.test.tsx src/components/Settings/sections/ProviderSection.recommended.test.tsx src/components/Settings/sections/ProviderSection.signIn.test.tsx src/components/Settings/sections/ProviderSection.soniox.test.tsx src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx src/services/clients/index.ts src/components/Icons/ProviderIcons.test.tsx src/components/Icons/ProviderIcons.tsx src/components/Settings/Settings.scss src/components/Settings/sections/LanguageSection.sentence.test.tsx src/components/Settings/sections/LanguageSection.textOnly.test.tsx src/components/Settings/sections/LanguageSection.tsx src/components/Settings/sections/ProviderSection.chips.test.tsx src/components/Settings/sections/ProviderSection.select.test.tsx src/components/Settings/sections/ProviderSection.tsx src/components/Settings/sections/ProviderSpecificSettings.engine.test.tsx src/components/Settings/sections/ProviderSpecificSettings.tsx src/components/providers/ProviderPicker.test.tsx src/lib/diagnostics/consoleLedger.consistency.test.ts src/locales/locales.consistency.test.ts src/services/providers/tutorialUrls.ts src/stores/sessionStore.ts src/types/Provider.test.ts src/types/Provider.ts 'src/locales/*/translation.json' <<'EOF'
refactor(settings): reduce the old settings shell to Local Native

The old settings shell is unmounted; every provider's settings are its
own view now. Keep Local Native's branches, which #578 will port, and
delete every other provider's, with PoweredBy, the hosted-icon map, the
OpenAI Compatible and relay-twin helpers, the clients barrel, the
unused styles, the session store's unread initializing flag and the 17
locale keys only those branches read. The shell tolerates a stored
provider it does not register.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

**The blocks** (`t01`, one per file, in the order the applier takes them):

`src/components/Icons/ProviderIcons.test.tsx`

`````diff t01
diff --git a/src/components/Icons/ProviderIcons.test.tsx b/src/components/Icons/ProviderIcons.test.tsx
--- a/src/components/Icons/ProviderIcons.test.tsx
+++ b/src/components/Icons/ProviderIcons.test.tsx
@@ -1,14 +1,20 @@
 /**
- * The Kizuna-managed providers are Kizuna AI's own service running on a third
- * party engine, so their mark has to read "Kizuna AI, powered by <vendor>":
+ * A Kizuna-managed provider is Kizuna AI's own service running on a third
+ * party engine, so its mark has to read "Kizuna AI, powered by <vendor>":
  * the Kizuna logo carries the identity and the vendor rides along as a corner
- * badge. Before this, all three rendered the bare Kizuna logo and were
- * indistinguishable from each other in the provider dropdown.
+ * badge. Kizuna Soniox's definition draws its mark this way; the plated
+ * shape is the one a vendor mark with no background of its own takes.
  */
 import { describe, it, expect } from 'vitest';
 import { render } from '@testing-library/react';
-import { Provider, isKizunaManagedProvider } from '../../types/Provider';
-import { KIZUNA_HOSTED_ICONS, HOSTED_BADGE_RATIO } from './ProviderIcons';
+import { kizunaHostedIcon, HOSTED_BADGE_RATIO, SonioxIcon, OpenAIIcon, VolcengineIcon } from './ProviderIcons';
+
+/** Kizuna Soniox's own mark: Soniox's favicon carries its white plate. */
+const SONIOX_HOSTED = kizunaHostedIcon(SonioxIcon);
+/** A transparent `currentColor` glyph, plated and forced to a colour. */
+const PLATED_GLYPH = kizunaHostedIcon(OpenAIIcon, { plate: true, color: '#000' });
+/** Transparent coloured paths, plated. */
+const PLATED_PATHS = kizunaHostedIcon(VolcengineIcon, { plate: true });
 
 const badgeOf = (container: HTMLElement) =>
   container.querySelector('.hosted-provider-icon__badge') as HTMLElement;
@@ -19,16 +25,8 @@
 const cssPx = (value: string) => parseFloat(value.replace(/[^0-9.]/g, ''));
 
 describe('Kizuna-hosted provider icons', () => {
-  it('covers exactly the Kizuna-managed providers', () => {
-    // Adding a fourth managed twin without giving it a badge would silently
-    // fall back to the bare Kizuna logo, which is the bug this whole component
-    // exists to fix — so fail loudly instead.
-    const managed = Object.values(Provider).filter(isKizunaManagedProvider).sort();
-    expect(Object.keys(KIZUNA_HOSTED_ICONS).sort()).toEqual(managed);
-  });
-
   it('renders the Kizuna logo with the vendor mark as a corner badge', () => {
-    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_SONIOX];
+    const Icon = SONIOX_HOSTED;
     const { container } = render(<Icon size={24} />);
 
     const logo = container.querySelector('img');
@@ -38,9 +36,13 @@
     expect(container.querySelectorAll('svg')).toHaveLength(1);
   });
 
-  it.each(Object.entries(KIZUNA_HOSTED_ICONS))(
-    '%s renders both the Kizuna logo and a vendor badge',
-    (_providerId, Icon) => {
+  it.each([
+    ['bare', SONIOX_HOSTED],
+    ['plated glyph', PLATED_GLYPH],
+    ['plated paths', PLATED_PATHS],
+  ] as const)(
+    'a %s mark renders both the Kizuna logo and a vendor badge',
+    (_shape, Icon) => {
       const { container } = render(<Icon size={24} />);
 
       expect(container.querySelector('img')).not.toBeNull();
@@ -54,7 +56,7 @@
     // width/height *attributes*, so relying on those would stretch the badge
     // to full size and bury the Kizuna logo underneath it. Inline styles
     // outrank any stylesheet rule, so the badge must set them.
-    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_SONIOX];
+    const Icon = SONIOX_HOSTED;
     const { container } = render(<Icon size={24} />);
 
     const mark = container.querySelector('svg') as SVGElement;
@@ -68,7 +70,7 @@
     // hands the value straight to the svg's width/height attributes, so `1em`
     // and `100%` work. This composite is the only one that does arithmetic on
     // it — parseFloat turned `1em` into 1, i.e. a one-pixel badge.
-    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_SONIOX];
+    const Icon = SONIOX_HOSTED;
     const { container } = render(<Icon size="1em" />);
 
     const wrapper = container.firstElementChild as HTMLElement;
@@ -92,7 +94,7 @@
   });
 
   it('scales the badge with the icon size', () => {
-    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_SONIOX];
+    const Icon = SONIOX_HOSTED;
     const { container } = render(<Icon size={20} />);
 
     const mark = container.querySelector('svg') as SVGElement;
@@ -100,7 +102,7 @@
   });
 
   it('rings the badge so it separates from the logo art behind it', () => {
-    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_SONIOX];
+    const Icon = SONIOX_HOSTED;
     const { container } = render(<Icon size={24} />);
 
     expect(badgeOf(container).style.boxShadow).not.toBe('');
@@ -111,7 +113,7 @@
     // transparent colored paths; dropped straight onto the Kizuna artwork
     // neither reads. A white plate gives them the same footing as Soniox's
     // own white square.
-    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_OPENAI_TRANSLATE];
+    const Icon = PLATED_GLYPH;
     const { container } = render(<Icon size={24} />);
 
     expect(badgeOf(container).style.background).toBe('rgb(255, 255, 255)');
@@ -120,7 +122,7 @@
   it('forces a colour onto currentColor marks sitting on the plate', () => {
     // `.provider-icon { color: $text-muted }` cascades into the badge, which
     // would paint OpenAI's glyph #888 on a white plate.
-    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_OPENAI_TRANSLATE];
+    const Icon = PLATED_GLYPH;
     const { container } = render(<Icon size={24} />);
 
     const mark = container.querySelector('svg') as SVGElement;
@@ -130,7 +132,7 @@
   it('leaves a vendor mark that carries its own plate unplated', () => {
     // Soniox's official favicon is already a white rounded square; plating it
     // again would just fatten the white border.
-    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_SONIOX];
+    const Icon = SONIOX_HOSTED;
     const { container } = render(<Icon size={24} />);
 
     expect(badgeOf(container).style.background).toBe('');
`````

`src/components/Icons/ProviderIcons.tsx`

`````diff t01
diff --git a/src/components/Icons/ProviderIcons.tsx b/src/components/Icons/ProviderIcons.tsx
--- a/src/components/Icons/ProviderIcons.tsx
+++ b/src/components/Icons/ProviderIcons.tsx
@@ -1,5 +1,4 @@
 import React from 'react';
-import { Provider, KizunaManagedProvider } from '../../types/Provider';
 
 interface IconProps {
   size?: string | number;
@@ -269,13 +268,3 @@
   return HostedIcon;
 }
 
-/**
- * Every Kizuna-managed provider's composite mark. Kept exhaustive by
- * ProviderIcons.test.tsx against isKizunaManagedProvider(), so a fourth twin
- * can't quietly fall back to the bare Kizuna logo.
- */
-export const KIZUNA_HOSTED_ICONS: Record<KizunaManagedProvider, React.FC<IconProps>> = {
-  [Provider.KIZUNA_AI_SONIOX]: kizunaHostedIcon(SonioxIcon),
-  [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: kizunaHostedIcon(OpenAIIcon, { plate: true, color: '#000' }),
-  [Provider.KIZUNA_AI_VOLCENGINE_AST2]: kizunaHostedIcon(VolcengineIcon, { plate: true }),
-};
`````

`src/components/Settings/Settings.scss`

`````diff t01
diff --git a/src/components/Settings/Settings.scss b/src/components/Settings/Settings.scss
--- a/src/components/Settings/Settings.scss
+++ b/src/components/Settings/Settings.scss
@@ -456,48 +456,6 @@
       .select-dropdown {
         flex: 1;
       }
-
-      .refresh-models-button {
-        display: flex;
~ 37 more removed lines sha256:093ccdd466f8
-        }
-      }
     }
 
     // Range slider
@@ -681,16 +639,7 @@
       }
     }
 
-    // Loading and info messages
-    .loading-status {
-      margin-top: 8px;
-      padding: 6px 10px;
-      border-radius: vars.$radius-sm;
-      font-size: vars.$font-caption;
-      background-color: vars.$color-info-bg;
-      color: vars.$color-info;
-    }
-
+    // Info messages
     .models-info {
       margin-top: 8px;
       padding: 6px 10px;
@@ -1756,42 +1705,7 @@
   }
 }
 
-// Endpoint input styles
-.endpoint-input-group {
-  margin-bottom: 12px;
~ 31 more removed lines sha256:48cfcdbcb493
-// credential choice (F4; `CredentialForm`), which reuses it.
-.palabraai-credentials-group,
+// A provider's credential choice (F4; `CredentialForm`).
 .credential-choice-group {
   display: flex;
   flex-direction: column;
`````

`src/components/Settings/sections/LanguageSection.sentence.test.tsx`

`````diff t01
diff --git a/src/components/Settings/sections/LanguageSection.sentence.test.tsx b/src/components/Settings/sections/LanguageSection.sentence.test.tsx
--- a/src/components/Settings/sections/LanguageSection.sentence.test.tsx
+++ b/src/components/Settings/sections/LanguageSection.sentence.test.tsx
@@ -1,6 +1,6 @@
 /**
  * S0 — the language pair reads as a sentence whose verbs follow the current
- * audio mode, for EVERY provider.
+ * audio mode.
  *
  * The two selectors are the SAME two fields in every mode — first is always
  * MY language (sourceLanguage), second is always THEIRS (targetLanguage);
@@ -8,18 +8,15 @@
  * derived plain-text mirror line for the reverse leg, never a third pair of
  * controls.
  *
- * Originally scoped to LOCAL_INFERENCE/LOCAL_NATIVE on the assumption that
- * other providers' mode semantics differ. They do not: `mode` lives in
- * audioStore and is global, and every descriptor's
- * buildParticipantSessionConfig forces textOnly (a registry-wide invariant
- * pinned by descriptorRegistry.test.ts), so "I read ← they speak" is true
- * provider-wide.
- *
  * What DOES vary is whether the speaker leg produces speech, which decides
  * "they hear" vs "they read". That is the provider's textOnlyCapability, not
  * the raw toggle: 'never' providers ignore the (global, cross-provider)
  * toggle and always speak, 'always' providers never do, and only 'optional'
  * providers follow it.
+ *
+ * The old section serves Local Native alone since the Stage 2 deletion
+ * (ruling 1); the two capabilities no provider declares are stubbed onto its
+ * config.
  */
 import { describe, it, expect, beforeEach, vi } from 'vitest';
 import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
@@ -52,9 +49,18 @@
   },
 }));
 
+// Local Native registers in the old registry only on Electron with its gate
+// on — the only provider the old section still serves (Stage 2 deletion,
+// ruling 1).
+vi.mock('../../../utils/environment', async (orig) => ({
+  ...(await orig<any>()),
+  isElectron: () => true,
+  isLocalNativeEnabled: () => true,
+}));
+
 const { default: useSettingsStore } = await import('../../../stores/settingsStore');
 const { default: useAudioStore } = await import('../../../stores/audioStore');
-const { useModelStore } = await import('../../../stores/modelStore');
+const { useNativeModelStore } = await import('../../../stores/nativeModelStore');
 const { Provider } = await import('../../../types/Provider');
 const { ProviderConfigFactory } = await import('../../../services/providers/ProviderConfigFactory');
 const { default: LanguageSection } = await import('./LanguageSection');
@@ -64,12 +70,26 @@
     <LanguageSection isSessionActive={false} showTranslationLanguages={true} />
   );
 
-describe('LanguageSection — mode-verb sentence labels (local providers)', () => {
+const pinPair = () =>
+  useSettingsStore.setState((s: any) => ({
+    provider: Provider.LOCAL_NATIVE,
+    localNative: { ...s.localNative, sourceLanguage: 'ja', targetLanguage: 'en', selections: {} },
+  }));
+
+/** Local Native's own config with its text-only capability swapped, for the
+ *  two values no provider declares any more. */
+const withCapability = (textOnlyCapability: 'always' | 'never') => {
+  const config = ProviderConfigFactory.getConfig(Provider.LOCAL_NATIVE);
+  return vi.spyOn(ProviderConfigFactory, 'getConfig').mockReturnValue({
+    ...config,
+    capabilities: { ...config.capabilities, textOnlyCapability },
+  });
+};
+
+describe('LanguageSection — mode-verb sentence labels', () => {
   beforeEach(() => {
-    useSettingsStore.setState((s: any) => ({
-      provider: Provider.LOCAL_INFERENCE,
-      localInference: { ...s.localInference, sourceLanguage: 'ja', targetLanguage: 'en' },
-    }));
+    pinPair();
+    useSettingsStore.setState({ textOnly: false } as any);
   });
 
   it('speaker mode: I speak → they hear, selectors bound to source/target', () => {
@@ -98,7 +118,7 @@
     expect((selects[1] as HTMLSelectElement).value).toBe('en');
   });
 
-  it('both mode: speaker line plus a plain-text mirror, no third combobox', () => {
+  it('both mode: speaker line plus a plain-text mirror with resolved names, no third combobox', () => {
     useAudioStore.setState({ mode: 'both' } as any);
     renderSection();
     expect(screen.getByText('I speak')).toBeInTheDocument();
@@ -109,6 +129,8 @@
     const mirror = screen.getByTestId('language-mirror-line');
     expect(mirror.textContent).toContain('They speak');
     expect(mirror.textContent).toContain('I read');
+    // Display names, never the raw settings tokens.
+    expect(mirror.textContent).not.toMatch(/\bja\b/);
   });
 
   it('speaker/participant modes render no mirror line', () => {
@@ -118,76 +140,40 @@
   });
 
   it('speaker mode with Text Only on: they READ, not hear', () => {
-    // The verb has to track what the session actually produces. Local
-    // providers are textOnlyCapability 'optional', so the toggle decides.
-    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE, textOnly: true } as any);
+    // The verb has to track what the session actually produces. Local Native
+    // is textOnlyCapability 'optional', so the toggle decides.
+    useSettingsStore.setState({ textOnly: true } as any);
     useAudioStore.setState({ mode: 'speaker' } as any);
     renderSection();
     expect(screen.getByText('I speak')).toBeInTheDocument();
     expect(screen.getByText('they read')).toBeInTheDocument();
     expect(screen.queryByText('they hear')).not.toBeInTheDocument();
   });
-});
-
-describe('LanguageSection — the sentence labels apply to EVERY provider', () => {
~ 20 more removed lines sha256:05f83819ff5d
-    expect(screen.getByText('they speak')).toBeInTheDocument();
-  });
 
-  it('a non-local provider renders the mirror line in both mode', () => {
-    useSettingsStore.setState({ provider: Provider.GEMINI, textOnly: false } as any);
-    useAudioStore.setState({ mode: 'both' } as any);
+  it('a stored provider the old registry does not register renders nothing', () => {
+    // Every provider but Local Native since the Stage 2 deletion (choice 4):
+    // the pre-twin managed id stands for them, as no registry has ever held it.
+    useSettingsStore.setState({ provider: 'kizunaai' } as any);
     renderSection();
-    const mirror = screen.getByTestId('language-mirror-line');
-    expect(mirror.textContent).toContain('They speak');
-    expect(mirror.textContent).toContain('I read');
-    // Still a derived line, never a third control.
-    const pair = within(document.getElementById('languages-section')!);
-    expect(pair.getAllByRole('combobox')).toHaveLength(2);
+    expect(document.getElementById('languages-section')).toBeNull();
   });
+});
 
-  it("an 'optional' provider follows the Text Only toggle", () => {
-    useSettingsStore.setState({ provider: Provider.GEMINI, textOnly: true } as any);
-    useAudioStore.setState({ mode: 'speaker' } as any);
-    renderSection();
-    expect(screen.getByText('they read')).toBeInTheDocument();
-    expect(screen.queryByText('they hear')).not.toBeInTheDocument();
+describe('LanguageSection — the capability decides, not the raw toggle', () => {
+  beforeEach(() => {
+    pinPair();
   });
 
   it("an 'always' text-only provider reads, with the toggle off", () => {
-    // The subject is a provider that never synthesizes audio, so the toggle is
-    // irrelevant to it. Both providers that declared textOnlyCapability
-    // 'always' have now been removed (Zoom AI, then Volcengine ST, on
~ 7 more removed lines sha256:2c38bb5a305c
-      capabilities: { ...gemini.capabilities, textOnlyCapability: 'always' },
-    });
+    // No registered provider declares textOnlyCapability 'always' any more
+    // (Zoom AI, then Volcengine ST, were removed on 2026-09-20), so the
+    // capability is stubbed onto Local Native's own config rather than the
+    // case being dropped: the 'always' arm of `pairSentence` and the
+    // permanently-on Text Only switch are both still the handling for a
+    // three-valued descriptor contract, and nothing else executes them.
+    const spy = withCapability('always');
     try {
-      useSettingsStore.setState({ provider: Provider.GEMINI, textOnly: false } as any);
+      useSettingsStore.setState({ textOnly: false } as any);
       useAudioStore.setState({ mode: 'speaker' } as any);
       renderSection();
       // The sentence ignores the global toggle: the provider cannot speak.
@@ -206,27 +192,33 @@
   });
 
   it("a 'never' text-only provider hears, even with the toggle left on", () => {
-    // textOnly is ONE global preference shared across providers: a user who
-    // turned it on under Gemini and switched to Palabra still gets speech,
-    // because Palabra ignores the toggle. Reading the raw toggle here would
-    // print the opposite of what the session does.
-    useSettingsStore.setState({ provider: Provider.PALABRA_AI, textOnly: true } as any);
-    useAudioStore.setState({ mode: 'speaker' } as any);
-    renderSection();
-    expect(screen.getByText('I speak')).toBeInTheDocument();
-    expect(screen.getByText('they hear')).toBeInTheDocument();
-    expect(screen.queryByText('they read')).not.toBeInTheDocument();
+    // textOnly is ONE global preference shared across providers: a provider
+    // that ignores it still speaks. Reading the raw toggle here would print
+    // the opposite of what the session does.
+    const spy = withCapability('never');
+    try {
+      useSettingsStore.setState({ textOnly: true } as any);
+      useAudioStore.setState({ mode: 'speaker' } as any);
+      renderSection();
+      expect(screen.getByText('I speak')).toBeInTheDocument();
+      expect(screen.getByText('they hear')).toBeInTheDocument();
+      expect(screen.queryByText('they read')).not.toBeInTheDocument();
+    } finally {
+      spy.mockRestore();
+    }
   });
 
   it('participant mode reads regardless of capability — the reverse leg never speaks', () => {
-    // 'never' provider, participant mode: the participant leg is textOnly
-    // for every descriptor, so the verb is "I read" whatever the provider
-    // does on the forward leg.
-    useSettingsStore.setState({ provider: Provider.PALABRA_AI, textOnly: false } as any);
-    useAudioStore.setState({ mode: 'participant' } as any);
-    renderSection();
-    expect(screen.getByText('I read')).toBeInTheDocument();
-    expect(screen.getByText('they speak')).toBeInTheDocument();
+    const spy = withCapability('never');
+    try {
+      useSettingsStore.setState({ textOnly: false } as any);
+      useAudioStore.setState({ mode: 'participant' } as any);
+      renderSection();
+      expect(screen.getByText('I read')).toBeInTheDocument();
+      expect(screen.getByText('they speak')).toBeInTheDocument();
+    } finally {
+      spy.mockRestore();
+    }
   });
 });
 
@@ -235,25 +227,22 @@
     // Pin the pair AND the audio mode: the summary is scoped to the current
     // mode's visible directions (ja→en forward under 'speaker'), and earlier
     // describes leave mode at whatever they last set.
-    useSettingsStore.setState((st: any) => ({
-      provider: Provider.LOCAL_INFERENCE,
-      localInference: { ...st.localInference, sourceLanguage: 'ja', targetLanguage: 'en' },
-    }));
+    pinPair();
     useAudioStore.setState({ mode: 'speaker' } as any);
+    useNativeModelStore.setState({ catalog: {} } as any);
   });
 
   it('collapses fallback notes into ONE summary line with a Review link, not one line per note', () => {
-    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
-    useModelStore.setState({
+    useNativeModelStore.setState({
       lastResolutionNotes: [
         { direction: 'ja→en', stage: 'translation', from: 'opus-mt-en-ja', to: 'qwen-x', reason: 'lang-incompatible' },
-        { direction: 'ja→en', stage: 'tts', from: 'supertonic-3', to: 'edge-tts', reason: 'not-downloaded' },
+        { direction: 'ja→en', stage: 'tts', from: 'supertonic-3', to: 'kokoro', reason: 'not-downloaded' },
       ],
-    });
-    render(<LanguageSection isSessionActive={false} showTranslationLanguages={true} />);
+    } as any);
+    renderSection();
     const notes = screen.getByTestId('language-resolution-notes');
     expect(notes.querySelectorAll('.language-warning')).toHaveLength(1);
-    // Names the failed picks (display name when the manifest knows the id,
+    // Names the failed picks (display name when the catalog knows the id,
     // the raw id otherwise), deduped — never the anonymous count phrase.
     expect(notes.textContent).toContain('opus-mt-en-ja');
     expect(notes.textContent).toContain('unavailable');
@@ -263,42 +252,40 @@
   });
 
   it('no-candidate notes are excluded from the summary — they belong to the missing-models warning', () => {
-    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
-    useModelStore.setState({
+    useNativeModelStore.setState({
       lastResolutionNotes: [
         { direction: 'ja→en', stage: 'asr', from: null, to: null, reason: 'no-candidate' },
       ],
-    });
-    render(<LanguageSection isSessionActive={false} showTranslationLanguages={true} />);
+    } as any);
+    renderSection();
     expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument();
   });
 
   it('Review arms the engine slot target with the first note\'s slot', () => {
-    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE, engineSlotTarget: null } as any);
-    useModelStore.setState({
+    useSettingsStore.setState({ engineSlotTarget: null } as any);
+    useNativeModelStore.setState({
       lastResolutionNotes: [
         { direction: 'ja→en', stage: 'translation', from: 'a', to: 'b', reason: 'not-downloaded' },
       ],
-    });
-    render(<LanguageSection isSessionActive={false} showTranslationLanguages={true} />);
+    } as any);
+    renderSection();
     fireEvent.click(screen.getByTestId('resolution-notes-review'));
     expect(useSettingsStore.getState().engineSlotTarget).toMatchObject({ dir: 'ja→en', stage: 'translation' });
   });
 
   it('renders nothing when there are no notes', () => {
-    useModelStore.setState({ lastResolutionNotes: [] });
-    render(<LanguageSection isSessionActive={false} showTranslationLanguages={true} />);
+    useNativeModelStore.setState({ lastResolutionNotes: [] } as any);
+    renderSection();
     expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument();
   });
 
-  it('Switch to Auto clears every noted (visible) slot and the summary disappears', async () => {
+  it('Switch to Auto clears every noted (visible) slot', async () => {
     // 'both' mode: both directions are visible, so both notes count and both
     // slots get switched.
     useAudioStore.setState({ mode: 'both' } as any);
     useSettingsStore.setState((st: any) => ({
-      provider: Provider.LOCAL_INFERENCE,
-      localInference: {
-        ...st.localInference,
+      localNative: {
+        ...st.localNative,
         sourceLanguage: 'ja', targetLanguage: 'en',
         selections: {
           'ja→en': { asr: { modelId: 'deleted-x' }, translation: { modelId: '' }, tts: { modelId: '' } },
@@ -306,128 +293,68 @@
         },
       },
     }));
-    useModelStore.setState({
-      initialized: true,
-      statuses: {},
+    useNativeModelStore.setState({
       lastResolutionNotes: [
         { direction: 'ja→en', stage: 'asr', from: 'deleted-x', to: 'auto-y', reason: 'not-downloaded' },
         { direction: 'en→ja', stage: 'asr', from: 'deleted-x', to: 'auto-y', reason: 'not-downloaded' },
       ],
     } as any);
-    render(<LanguageSection isSessionActive={false} showTranslationLanguages={true} />);
+    renderSection();
 
     fireEvent.click(screen.getByTestId('resolution-notes-use-auto'));
 
     // The stale pick is GONE from both directions. Assert semantics, not
-    // shape: explicit auto ('') and an absent direction mean the same thing,
-    // and applyPrunes canonicalizes all-empty directions away entirely.
+    // shape: explicit auto ('') and an absent direction mean the same thing.
     await waitFor(() => {
-      const sel = (useSettingsStore.getState() as any).localInference.selections;
+      const sel = (useSettingsStore.getState() as any).localNative.selections;
       expect(sel['ja→en']?.asr?.modelId ?? '').toBe('');
       expect(sel['en→ja']?.asr?.modelId ?? '').toBe('');
     });
-    // ensureSelectionReady re-resolved: the stale-pick notes are gone, so the
-    // summary disappears instead of nagging forever.
-    await waitFor(() =>
-      expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument());
   });
 
   it('a note about a direction the current mode hides is not counted (mode-scoped, 2026-08-23)', () => {
     // speaker mode: only ja→en is visible; the en→ja note must not surface.
-    useModelStore.setState({
+    useNativeModelStore.setState({
       lastResolutionNotes: [
         { direction: 'en→ja', stage: 'asr', from: 'a', to: 'b', reason: 'not-downloaded' },
       ],
     } as any);
-    render(<LanguageSection isSessionActive={false} showTranslationLanguages={true} />);
-    expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument();
-  });
~ 7 more removed lines sha256:12427eabb3ff
-    });
-    render(<LanguageSection isSessionActive={false} showTranslationLanguages={true} />);
+    renderSection();
     expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument();
   });
 });
 
 describe('LanguageSection — the ONE blocking missing-models warning (resolver-backed)', () => {
   beforeEach(() => {
-    useSettingsStore.setState((st: any) => ({
-      provider: Provider.LOCAL_INFERENCE,
-      localInference: { ...st.localInference, sourceLanguage: 'ja', targetLanguage: 'en' },
-    }));
+    pinPair();
     useAudioStore.setState({ mode: 'speaker' } as any);
   });
 
   it('names only the stages the RESOLVER cannot fill, with per-stage engine deep links', () => {
-    // Empty statuses: nothing downloaded. The resolver still fills
-    // translation (Bing Translator, cloud, always ready) and TTS (Edge TTS,
-    // cloud — and outside the session gate anyway), so only ASR is truly
-    // missing. The old hand-rolled scan counted downloaded models only and
-    // would have FALSELY listed Translation here — this pin is the point of
-    // the resolver-backed rewrite.
-    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE, engineSlotTarget: null } as any);
-    useModelStore.setState({ initialized: true, statuses: {}, lastResolutionNotes: [] } as any);
-    render(<LanguageSection isSessionActive={false} showTranslationLanguages={true} />);
+    // A catalog with a voice and nothing else: no ASR and no translation
+    // candidate for ja→en, so both are named; TTS never is.
+    useSettingsStore.setState({ engineSlotTarget: null } as any);
+    useNativeModelStore.setState({
+      statuses: {},
+      catalog: {
+        'voice-en': { id: 'voice-en', name: 'Voice EN', kind: 'tts', languages: ['en'], recommended: false,
+          tiers: [{ tier: 'cpu', backend: 'tts', available: true }], order: 1, repo: 'voice-en' },
+      },
+    } as any);
+    renderSection();
 
     const warning = document.querySelector('.language-model-warning');
     expect(warning).toBeInTheDocument();
-    expect(warning!.textContent).toContain('Missing ASR model(s)');
-    expect(warning!.textContent).not.toContain('Translation');
+    expect(warning!.textContent).toContain('Missing ASR, Translation model(s)');
     expect(warning!.textContent).not.toContain('TTS');
 
     fireEvent.click(screen.getByText('Download ASR'));
     expect(useSettingsStore.getState().engineSlotTarget).toMatchObject({ dir: 'ja→en', stage: 'asr' });
   });
 
-  it('renders no warning while the model store is uninitialized', () => {
-    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
-    useModelStore.setState({ initialized: false, statuses: {} } as any);
-    render(<LanguageSection isSessionActive={false} showTranslationLanguages={true} />);
+  it('renders no warning while the catalog is empty — the sidecar is not up', () => {
+    useNativeModelStore.setState({ catalog: {}, statuses: {} } as any);
+    renderSection();
     expect(document.querySelector('.language-model-warning')).not.toBeInTheDocument();
   });
 });
-
-describe('LanguageSection — the mirror line needs a pinned source language', () => {
-  // Reachable only since the sentence went provider-wide: 'auto' is an option
~ 34 more removed lines sha256:8063e3536c0e
-  });
-});
`````

`src/components/Settings/sections/LanguageSection.textOnly.test.tsx`

`````diff t01
diff --git a/src/components/Settings/sections/LanguageSection.textOnly.test.tsx b/src/components/Settings/sections/LanguageSection.textOnly.test.tsx
--- a/src/components/Settings/sections/LanguageSection.textOnly.test.tsx
+++ b/src/components/Settings/sections/LanguageSection.textOnly.test.tsx
@@ -43,6 +43,15 @@
   },
 }));
 
+// Local Native registers in the old registry only on Electron with its gate
+// on — the only provider the old section still serves (Stage 2 deletion,
+// ruling 1).
+vi.mock('../../../utils/environment', async (orig) => ({
+  ...(await orig<any>()),
+  isElectron: () => true,
+  isLocalNativeEnabled: () => true,
+}));
+
 const { default: useSettingsStore } = await import('../../../stores/settingsStore');
 const { default: useAudioStore } = await import('../../../stores/audioStore');
 const { default: useSessionStore } = await import('../../../stores/sessionStore');
@@ -60,8 +69,8 @@
 
 describe('LanguageSection — Text Only toggle vs the channel matrix', () => {
   beforeEach(() => {
-    // Gemini: textOnlyCapability 'optional', i.e. the switch is interactive at all.
-    useSettingsStore.setState({ provider: Provider.GEMINI, textOnly: false } as any);
+    // Local Native: textOnlyCapability 'optional', i.e. the switch is interactive at all.
+    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE, textOnly: false } as any);
     useAudioStore.setState({ mode: 'speaker' } as any);
     useSessionStore.setState({ lockedMode: null } as any);
   });
`````

`src/components/Settings/sections/LanguageSection.tsx`

`````diff t01
diff --git a/src/components/Settings/sections/LanguageSection.tsx b/src/components/Settings/sections/LanguageSection.tsx
--- a/src/components/Settings/sections/LanguageSection.tsx
+++ b/src/components/Settings/sections/LanguageSection.tsx
@@ -5,24 +5,8 @@
 import ToggleSwitch from '../shared/ToggleSwitch';
 import {
   useProvider,
-  useSettingsStore,
-  useKizunaVolcengineAst2Settings,
-  useLocalInferenceSettings,
   useLocalNativeSettings,
-  useVolcengineAST2Settings,
-  useUpdateOpenAI,
-  useUpdateGemini,
-  useUpdateOpenAICompatible,
-  useUpdatePalabraAI,
-  useUpdateOpenAITranslate,
-  useUpdateOpenAILive,
-  useUpdateKizunaOpenaiTranslate,
-  useUpdateKizunaVolcengineAst2,
-  useUpdateKizunaSoniox,
-  useUpdateLocalInference,
   useUpdateLocalNative,
-  useUpdateVolcengineAST2,
-  useUpdateSoniox,
   useNavigateToSettings,
   useUIMode,
   useSetEngineSlotTarget,
@@ -32,19 +16,16 @@
   useKeepReplayAudio,
   useSetKeepReplayAudio
 } from '../../../stores/settingsStore';
-import type { SettingsStore } from '../../../stores/settingsStore';
-import { Provider, kizunaBaseProvider } from '../../../types/Provider';
+import { Provider } from '../../../types/Provider';
 import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
 import { ProviderConfig } from '../../../services/providers/ProviderConfig';
-import { resolveAST2LanguagePair } from '../../../services/providers/volcengineAST2LanguageSync';
-import { useIsParticipantChannelInScope, useMode, speakerChannelInScope } from '../../../stores/audioStore';
+import { useMode, speakerChannelInScope } from '../../../stores/audioStore';
 import { useLockedMode } from '../../../stores/sessionStore';
 import { effectiveTextOnly } from '../../../utils/effectiveTextOnly';
 import { pairSentence } from '../../SetupWizard/languageSentence';
 import { useAnalytics } from '../../../lib/analytics';
-import { getTranslationTargetLanguages, getManifestEntry } from '../../../lib/local-inference/modelManifest';
+import { getTranslationTargetLanguages } from '../../../lib/local-inference/modelManifest';
 import { shortenModelName } from '../../../lib/local-inference/modelName';
-import { useModelStatuses, useModelInitialized, useLastResolutionNotes, useModelStore } from '../../../stores/modelStore';
 import { useNativeLastResolutionNotes, useNativeCatalog, useNativeModelStore } from '../../../stores/nativeModelStore';
 import { directionKey, emptyDirection, type Stage, type Selections, type ResolutionNote } from '../../../lib/local-inference/selection/types';
 
@@ -66,12 +47,8 @@
 
   // Settings store
   const provider = useProvider();
-  const kizunaVolcengineAst2Settings = useKizunaVolcengineAst2Settings();
-  const localInferenceSettings = useLocalInferenceSettings();
   const localNativeSettings = useLocalNativeSettings();
-  const volcengineAST2Settings = useVolcengineAST2Settings();
 
-  const isParticipantChannelInScope = useIsParticipantChannelInScope();
   // Mode scope for the Text Only lock below. `lockedMode ?? mode` — the same
   // "effective mode" every other mode-scoped lock in Settings reads, so an
   // in-session panel describes the session that is running rather than the
@@ -79,8 +56,6 @@
   const mode = useMode();
   const lockedMode = useLockedMode();
   const speakerChannelInScopeForUi = speakerChannelInScope(lockedMode ?? mode);
-  const modelStatuses = useModelStatuses();
-  const modelInitialized = useModelInitialized();
   const navigateToSettings = useNavigateToSettings();
   const uiMode = useUIMode();
   const setEngineSlotTarget = useSetEngineSlotTarget();
@@ -92,139 +67,34 @@
   const keepReplayAudio = useKeepReplayAudio();
   const setKeepReplayAudio = useSetKeepReplayAudio();
 
-  const updateOpenAISettings = useUpdateOpenAI();
-  const updateGeminiSettings = useUpdateGemini();
-  const updateOpenAICompatibleSettings = useUpdateOpenAICompatible();
-  const updatePalabraAISettings = useUpdatePalabraAI();
-  const updateOpenAITranslateSettings = useUpdateOpenAITranslate();
-  const updateOpenAILiveSettings = useUpdateOpenAILive();
-  const updateKizunaOpenaiTranslateSettings = useUpdateKizunaOpenaiTranslate();
-  const updateKizunaVolcengineAst2Settings = useUpdateKizunaVolcengineAst2();
-  const updateKizunaSonioxSettings = useUpdateKizunaSoniox();
-  const updateVolcengineAST2Settings = useUpdateVolcengineAST2();
-  const updateLocalInferenceSettings = useUpdateLocalInference();
   const updateLocalNativeSettings = useUpdateLocalNative();
-  const updateSonioxSettings = useUpdateSoniox();
-
-  // Kizuna-managed relay twins reuse their base provider's language controls but
~ 19 more removed lines sha256:7a9ef4496bbd
-    }
-  }, [provider]);
 
-  // Get current provider settings via the active descriptor's slice key. The
-  // selector returns the slice object itself — reference-stable under zustand,
-  // so this re-renders only when the slice or the provider changes.
-  const currentProviderSettings = useSettingsStore(
-    (s) => s[ProviderConfigFactory.getDescriptor(s.provider).settingsSliceKey as keyof SettingsStore]
-  ) as Record<string, any>;
+  // The old settings panel's language section, reduced to Local Native: its
+  // path is kept whole, working but unreachable, until
+  // kizuna-ai-lab/sokuji#578 ports it (Stage 2 deletion, ruling 1). The old
+  // registry registers nothing else, so any other stored provider — or Local
+  // Native where it is not registered — renders nothing (Stage 2 deletion,
+  // choice 4).
+  const providerConfig: ProviderConfig | null = useMemo(
+    () => (provider === Provider.LOCAL_NATIVE && ProviderConfigFactory.isProviderSupported(provider)
+      ? ProviderConfigFactory.getConfig(provider)
+      : null),
+    [provider],
+  );
+  const currentProviderSettings = localNativeSettings;
 
   // Update source language
   const updateSourceLanguage = (value: string) => {
-    switch (provider) {
-      case Provider.OPENAI:
-        updateOpenAISettings({ sourceLanguage: value });
~ 81 more removed lines sha256:c29310036bca
-        updateKizunaSonioxSettings({ sourceLanguage: value });
-        break;
+    const availableTargets = getTranslationTargetLanguages(value);
+    const currentTarget = localNativeSettings.targetLanguage;
+    const updates: Record<string, string> = { sourceLanguage: value };
+    if (!availableTargets.some(t => t.value === currentTarget)) {
+      updates.targetLanguage = availableTargets[0]?.value || 'en';
     }
+    // Model reconciliation (compatible ASR, directional translation, stale TTS)
+    // is handled by NativeModelManagementSection's auto-select effect, which
+    // also applies per-direction remembered history.
+    updateLocalNativeSettings(updates);
     trackEvent('language_changed', {
       to_language: value,
       language_type: 'source'
@@ -233,72 +103,9 @@
 
   // Update target language
   const updateTargetLanguage = (value: string) => {
-    switch (provider) {
-      case Provider.OPENAI:
-        updateOpenAISettings({ targetLanguage: value });
~ 61 more removed lines sha256:7f5c419aded2
-        break;
-    }
+    // Stale-TTS reset + directional translation reconciliation is handled by
+    // NativeModelManagementSection's auto-select effect.
+    updateLocalNativeSettings({ targetLanguage: value });
     trackEvent('language_changed', {
       to_language: value,
       language_type: 'target'
@@ -310,94 +117,35 @@
     const src = currentProviderSettings?.sourceLanguage;
     const tgt = currentProviderSettings?.targetLanguage;
     if (!src || !tgt || src === 'auto' || src === 'zhen') return;
-
-    if (provider === Provider.LOCAL_INFERENCE) {
-      const availableTargets = getTranslationTargetLanguages(tgt);
~ 60 more removed lines sha256:9ca246f34da3
-
-  // Simplified interface language list (12 most common languages)
+    updateSourceLanguage(tgt);
+    // Local Native declares no restricted target list, so the swapped source
+    // is always a valid target.
+    updateTargetLanguage(src);
+  }, [currentProviderSettings, updateSourceLanguage, updateTargetLanguage]);
+
+  // The target list follows the source language.
+  const targetLanguages = useMemo(
+    () => getTranslationTargetLanguages(currentProviderSettings.sourceLanguage || 'ja'),
+    [currentProviderSettings.sourceLanguage],
+  );
 
   // The ONE blocking warning (2026-08-23 warning-dedup decision): which
   // mandatory stages have NO candidate at all for the current speaker pair.
   // Reads the resolver - the single source of truth since the selection
   // redesign - instead of a parallel hand-rolled manifest scan, and follows
   // the session gate's own scope: speaker ASR + translation block a session,
-  // TTS never does (subtitles/Edge TTS cover it), so TTS is never "missing".
-  const resolveWasm = useModelStore.getState().resolve;
+  // TTS never does, so TTS is never "missing".
   const resolveNative = useNativeModelStore((state) => state.resolve);
   const nativeStatuses = useNativeModelStore((state) => state.statuses);
   const nativeCatalog = useNativeCatalog();
   const missingStages = useMemo(() => {
-    if (provider === Provider.LOCAL_INFERENCE) {
-      if (!modelInitialized) return [];
-    } else if (provider === Provider.LOCAL_NATIVE) {
-      // No catalog yet = sidecar not up; EngineSection's gate narrates that
-      // state, and "everything is missing" on top of it would be noise.
-      if (Object.keys(nativeCatalog).length === 0) return [];
-    } else {
-      return [];
-    }
-    const settings = provider === Provider.LOCAL_INFERENCE ? localInferenceSettings : localNativeSettings;
-    const resolve = provider === Provider.LOCAL_INFERENCE ? resolveWasm : resolveNative;
+    if (provider !== Provider.LOCAL_NATIVE) return [];
+    // No catalog yet = sidecar not up; EngineSection's gate narrates that
+    // state, and "everything is missing" on top of it would be noise.
+    if (Object.keys(nativeCatalog).length === 0) return [];
+    const settings = localNativeSettings;
+    const resolve = resolveNative;
+
     // Mode-scoped legs (2026-08-23): speaker checks the forward leg,
     // participant the reverse, both checks both — the same table the
     // mode-aware session gate implements (ensureSelectionReady), so this
@@ -421,11 +169,10 @@
     }
     return missing;
   }, [
-    provider, modelInitialized, resolveWasm, resolveNative, nativeCatalog, t,
-    localInferenceSettings, localNativeSettings, lockedMode, mode,
-    // resolve() reads candidate pools from its own store; these two make the
-    // memo recompute when a download/delete changes what is resolvable.
-    modelStatuses, nativeStatuses,
+    provider, resolveNative, nativeCatalog, t, localNativeSettings, lockedMode, mode,
+    // resolve() reads candidate pools from its own store; this makes the memo
+    // recompute when a download/delete changes what is resolvable.
+    nativeStatuses,
   ]);
 
   // S0: the language pair narrates as a sentence whose verbs follow the
@@ -447,12 +194,10 @@
   const sentenceMode = lockedMode ?? mode;
   // Does the forward leg actually SPEAK? That decides "they hear" vs "they
   // read", and the provider's capability decides it — NOT the raw toggle.
-  // `textOnly` is one global preference shared across providers, so a user who
-  // turned it on under Gemini and switched to Palabra ('never') still gets
-  // speech; reading the toggle here would print the opposite of what the
-  // session does. Only 'optional' providers honour it, and they do so through
-  // the same effectiveTextOnly() the Text Only switch below renders.
-  const textOnlyCapability = providerConfig.capabilities.textOnlyCapability;
+  // Only 'optional' providers honour the global `textOnly` toggle, and they do
+  // so through the same effectiveTextOnly() the Text Only switch below
+  // renders.
+  const textOnlyCapability = providerConfig?.capabilities.textOnlyCapability ?? 'optional';
   // The sentence itself is shared with the setup wizard, which prints it over
   // the same two fields on two of its steps. Only the resolution of `textOnly`
   // differs by surface, so it is resolved here and handed in.
@@ -469,31 +214,15 @@
   // "Both" mode runs the speaker leg above plus a mirrored participant leg;
   // the mirror line states that second leg as plain text derived from the
   // same two fields — never a third pair of controls.
-  const sourceLanguageName = providerConfig.languages.find(l => l.value === currentProviderSettings.sourceLanguage)?.name
+  const sourceLanguageName = providerConfig?.languages.find(l => l.value === currentProviderSettings.sourceLanguage)?.name
     ?? currentProviderSettings.sourceLanguage;
   const targetLanguageName = targetLanguages.find(l => l.value === currentProviderSettings.targetLanguage)?.name
     ?? currentProviderSettings.targetLanguage;
-  // ...and only once the source language is pinned — `pairSentence`'s
-  // showMirror withholds the line for 'auto'. That is a hand-written extra
-  // <option> on the source select, absent from every provider's `languages`,
-  // so the lookup above falls through to the raw token; localizing it would
-  // not help, because the mirror's whole job is to name the language I read on
-  // the reverse leg and auto-detect names none. For the providers that reverse
-  // direction THROUGH sourceLanguage (Soniox, Gemini's translate models) the
-  // pair cannot even start — see sessionStartGate's
-  // autoSourceParticipantBlocked, whose warning renders just below — so the
-  // line would describe a session the app refuses to run.
 
   // S0: surface the last resolution notes (auto-substitutions/fallbacks made
   // while picking models for this language pair) right where the pair itself
-  // is edited. WASM and native track their own resolvers/catalogs, so both
-  // notes and the id→display-name lookup are selected per provider.
-  const wasmNotes = useLastResolutionNotes();
-  const nativeNotes = useNativeLastResolutionNotes();
-  const notes =
-    provider === Provider.LOCAL_INFERENCE ? wasmNotes
-    : provider === Provider.LOCAL_NATIVE ? nativeNotes
-    : [];
+  // is edited.
+  const notes = useNativeLastResolutionNotes();
   // no-candidate notes are the BLOCKING condition and belong to the
   // missing-models warning below; everything else is an automatic fallback
   // the session survives, summarized in one line (2026-08-23 dedup decision).
@@ -501,7 +230,7 @@
   // page — a note about a hidden leg would deep-link to a slot that is not
   // rendered, and the leg becomes relevant exactly when the mode does.
   const visibleDirs = (() => {
-    const st = provider === Provider.LOCAL_NATIVE ? localNativeSettings : localInferenceSettings;
+    const st = localNativeSettings;
     const effectiveMode = lockedMode ?? mode;
     const fwdKey = directionKey(st.sourceLanguage, st.targetLanguage);
     const revKey = directionKey(st.targetLanguage, st.sourceLanguage);
@@ -513,13 +242,8 @@
   // Name the picks that failed (deduped: the same deleted model noted in two
   // directions is one name) — a summary that will not say WHICH models it
   // means cannot be acted on.
-  const noteName = (id: string): string => {
-    if (provider === Provider.LOCAL_NATIVE) {
-      return nativeCatalog[id] ? shortenModelName(nativeCatalog[id].name) : id;
-    }
-    const entry = getManifestEntry(id);
-    return entry ? shortenModelName(entry.name, entry.shortName) : id;
-  };
+  const noteName = (id: string): string =>
+    nativeCatalog[id] ? shortenModelName(nativeCatalog[id].name) : id;
   const staleIds: string[] = [];
   for (const n of fallbackNotes) {
     if (n.from && !staleIds.includes(n.from)) staleIds.push(n.from);
@@ -532,16 +256,11 @@
   // pick will not return on re-download, which is what this click means).
   // ensureSelectionReady() then re-resolves so the summary clears at once.
   const switchNotesToAuto = async () => {
-    const settings = provider === Provider.LOCAL_NATIVE ? localNativeSettings : localInferenceSettings;
-    const next: Selections = { ...settings.selections };
+    const next: Selections = { ...localNativeSettings.selections };
     for (const n of fallbackNotes) {
       next[n.direction] = { ...(next[n.direction] ?? emptyDirection()), [n.stage]: { modelId: '' } };
     }
-    if (provider === Provider.LOCAL_NATIVE) {
-      await updateLocalNativeSettings({ selections: next });
-    } else {
-      await updateLocalInferenceSettings({ selections: next });
-    }
+    await updateLocalNativeSettings({ selections: next });
     // Re-runs ensureSelectionReady through the provider's own validation
     // wrapper (native's read-thunk included) so lastResolutionNotes — and
     // with it this summary — refreshes immediately.
@@ -556,6 +275,8 @@
     if (uiMode !== 'basic') navigateToSettings('provider');
   };
 
+  if (!providerConfig) return null;
+
   return (
     <>
       {/* Interface language now lives in HelpSection, at the weight of a link:
@@ -584,9 +305,6 @@
                 disabled={isSessionActive}
                 className="language-select"
               >
-                {provider !== Provider.LOCAL_INFERENCE && provider !== Provider.LOCAL_NATIVE && effectiveProvider !== Provider.OPENAI_TRANSLATE && (
-                  <option value="auto">{t('common.autoDetect')}</option>
-                )}
                 {providerConfig.languages.map((lang) => (
                   <option key={lang.value} value={lang.value}>
                     {lang.name}
@@ -670,20 +388,6 @@
             </div>
           )}
 
-          {showTranslateParticipantWarning && (
-            <div className="language-warning">
-              <AlertTriangle size={12} />
~ 9 more removed lines sha256:3c897945ea20
-          )}
-
           {/* Interactive only while a speaker leg is in scope. A participant-only
               mode is text-only whatever the setting says — the participant channel
               never synthesizes — so the switch shows the truth (on, locked) with a
`````

`src/components/Settings/sections/ProviderSection.chips.test.tsx`

`````diff t01
diff --git a/src/components/Settings/sections/ProviderSection.chips.test.tsx b/src/components/Settings/sections/ProviderSection.chips.test.tsx
--- a/src/components/Settings/sections/ProviderSection.chips.test.tsx
+++ b/src/components/Settings/sections/ProviderSection.chips.test.tsx
@@ -17,10 +17,10 @@
  *
  * Follows ProviderSection.select.test.tsx's mount idiom: the real
  * settingsStore (asserted on directly via setState/getState, not spied),
- * ServiceFactory/analytics/auth/supportsBaseSelect mocked. modelStore and
- * nativeModelStore are also real — LOCAL_INFERENCE needs no extra setup
- * (mirrors ProviderSpecificSettings.engine.test.tsx), LOCAL_NATIVE needs
- * `sidecarStatus: 'ready'` or the chips are replaced by the loading notice.
+ * ServiceFactory/analytics/supportsBaseSelect mocked. nativeModelStore is
+ * also real, with `sidecarStatus: 'ready'` or the chips are replaced by the
+ * loading notice. Local Native is the one provider the old section still
+ * serves (Stage 2 deletion, ruling 1).
  */
 import { describe, it, expect, beforeEach, vi } from 'vitest';
 import { render, fireEvent } from '@testing-library/react';
@@ -29,10 +29,6 @@
   useAnalytics: () => ({ trackEvent: vi.fn() }),
 }));
 
-vi.mock('../../../lib/auth/hooks', () => ({
-  useAuth: () => ({ isSignedIn: true, getToken: async () => 'token' }),
-}));
-
 vi.mock('../../../services/ServiceFactory', () => ({
   ServiceFactory: {
     getSettingsService: () => ({
@@ -65,7 +61,7 @@
 describe('ProviderSection — model chips deep-link to their slot (Task 10)', () => {
   beforeEach(() => {
     useSettingsStore.setState({
-      provider: Provider.LOCAL_INFERENCE,
+      provider: Provider.LOCAL_NATIVE,
       uiMode: 'advanced',
       settingsNavigationTarget: null,
       engineSlotTarget: null,
@@ -112,14 +108,14 @@
     }
   });
 
-  it("mode='speaker' (default): LOCAL_INFERENCE shows exactly the 3 speaker chips, no group label (single, unambiguous group)", () => {
+  it("mode='speaker' (default): shows exactly the 3 speaker chips, no group label (single, unambiguous group)", () => {
     const { container } = render(<ProviderSection isSessionActive={false} />);
 
     expect(chips(container)).toHaveLength(3);
     expect(groupLabels(container)).toHaveLength(0);
   });
 
-  it("mode='participant': LOCAL_INFERENCE shows 2 chips (ASR/MT, no TTS) for the REVERSE direction, and clicking one targets that reverse dir", () => {
+  it("mode='participant': shows 2 chips (ASR/MT, no TTS) for the REVERSE direction, and clicking one targets that reverse dir", () => {
     useAudioStore.setState({ mode: 'participant' } as never);
     const { container } = render(<ProviderSection isSessionActive={false} />);
 
@@ -130,7 +126,7 @@
     expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'en→ja', stage: 'asr' });
   });
 
-  it("mode='both': LOCAL_INFERENCE shows 5 chips across two labeled groups — 'Me' (speaker, 3) then 'Other' (participant, 2)", () => {
+  it("mode='both': shows 5 chips across two labeled groups — 'Me' (speaker, 3) then 'Other' (participant, 2)", () => {
     useAudioStore.setState({ mode: 'both' } as never);
     const { container } = render(<ProviderSection isSessionActive={false} />);
 
@@ -149,8 +145,7 @@
     expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'en→ja', stage: 'translation' });
   });
 
-  it('LOCAL_NATIVE: the shared handler is wired the same way — sets engineSlotTarget, switches tabs, leaves uiMode alone', () => {
-    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE, uiMode: 'advanced' } as never);
+  it('the TTS chip targets the speaker direction\'s tts slot', () => {
     const { container } = render(<ProviderSection isSessionActive={false} />);
 
     fireEvent.click(chips(container)[2]); // TTS
@@ -160,35 +155,15 @@
     expect(useSettingsStore.getState().uiMode).toBe('advanced');
   });
 
-  it("LOCAL_NATIVE gets identical mode treatment: mode='participant' shows 2 chips for the reverse direction", () => {
-    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE, uiMode: 'advanced' } as never);
-    useAudioStore.setState({ mode: 'participant' } as never);
-    const { container } = render(<ProviderSection isSessionActive={false} />);
-
-    expect(chips(container)).toHaveLength(2);
-    fireEvent.click(chips(container)[1]); // MT
-    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'en→ja', stage: 'translation' });
-  });
-
-  it("LOCAL_NATIVE: the tour's engine-chips anchor is there while the sidecar is still starting", () => {
+  it("the tour's engine-chips anchor is there while the sidecar is still starting", () => {
     // The offline tour's `models` step runs seconds after the wizard selected
     // LOCAL_NATIVE, with the sidecar still 'starting' and the chip row replaced
     // by a loading notice. Anchoring on the chip row means the step is skipped
     // for exactly the users the offline path just sent here.
-    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE, uiMode: 'advanced' } as never);
     useNativeModelStore.setState({ sidecarStatus: 'starting' } as never);
     const { container } = render(<ProviderSection isSessionActive={false} />);
 
     expect(chips(container)).toHaveLength(0);            // the loading notice, not the chips
     expect(container.querySelector('[data-tour="engine-chips"]')).not.toBeNull();
   });
-
-  it("LOCAL_NATIVE gets identical mode treatment: mode='both' shows 5 chips across the same two labeled groups", () => {
-    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE, uiMode: 'advanced' } as never);
-    useAudioStore.setState({ mode: 'both' } as never);
-    const { container } = render(<ProviderSection isSessionActive={false} />);
-
-    expect(chips(container)).toHaveLength(5);
-    expect(groupLabels(container)).toEqual(['Me', 'Other']);
-  });
 });
`````

`src/components/Settings/sections/ProviderSection.select.test.tsx`

`````diff t01
diff --git a/src/components/Settings/sections/ProviderSection.select.test.tsx b/src/components/Settings/sections/ProviderSection.select.test.tsx
--- a/src/components/Settings/sections/ProviderSection.select.test.tsx
+++ b/src/components/Settings/sections/ProviderSection.select.test.tsx
@@ -15,10 +15,6 @@
   useAnalytics: () => ({ trackEvent: vi.fn() }),
 }));
 
-vi.mock('../../../lib/auth/hooks', () => ({
-  useAuth: () => ({ isSignedIn: true, getToken: async () => 'token' }),
-}));
-
 vi.mock('../../../services/ServiceFactory', () => ({
   ServiceFactory: {
     getSettingsService: () => ({
@@ -28,6 +24,15 @@
   },
 }));
 
+// Local Native registers in the old registry only on Electron with its gate
+// on — the only provider the old section still offers (Stage 2 deletion,
+// ruling 1).
+vi.mock('../../../utils/environment', async (orig) => ({
+  ...(await orig<any>()),
+  isElectron: () => true,
+  isLocalNativeEnabled: () => true,
+}));
+
 const baseSelectSupported = vi.hoisted(() => ({ value: true }));
 vi.mock('../../../utils/supportsBaseSelect', () => ({
   supportsBaseSelect: () => baseSelectSupported.value,
@@ -37,28 +42,31 @@
 const { Provider } = await import('../../../types/Provider');
 const { default: ProviderSection } = await import('./ProviderSection');
 
+// The pre-twin managed id: a stored value no registry has ever registered.
+const UNREGISTERED = 'kizunaai' as (typeof Provider)[keyof typeof Provider];
+
 const getSelect = () =>
   document.querySelector('.provider-select') as HTMLSelectElement;
 
 describe('ProviderSection — provider <select>', () => {
   beforeEach(() => {
     baseSelectSupported.value = true;
-    useSettingsStore.setState({ provider: Provider.OPENAI } as never);
+    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE } as never);
   });
 
   it('switches provider through the store on change', () => {
+    useSettingsStore.setState({ provider: UNREGISTERED } as never);
     render(<ProviderSection isSessionActive={false} />);
 
-    fireEvent.change(getSelect(), { target: { value: Provider.GEMINI } });
+    fireEvent.change(getSelect(), { target: { value: Provider.LOCAL_NATIVE } });
 
-    expect(useSettingsStore.getState().provider).toBe(Provider.GEMINI);
+    expect(useSettingsStore.getState().provider).toBe(Provider.LOCAL_NATIVE);
   });
 
   it('reflects the current provider as the selected option', () => {
-    useSettingsStore.setState({ provider: Provider.PALABRA_AI } as never);
     render(<ProviderSection isSessionActive={false} />);
 
-    expect(getSelect().value).toBe(Provider.PALABRA_AI);
+    expect(getSelect().value).toBe(Provider.LOCAL_NATIVE);
   });
 
   it('is disabled while a session is active', () => {
@@ -73,35 +81,35 @@
     render(<ProviderSection isSessionActive={false} />);
 
     const option = document.querySelector(
-      `.provider-select option[value="${Provider.OPENAI}"]`,
+      `.provider-select option[value="${Provider.LOCAL_NATIVE}"]`,
     );
-    expect(option?.querySelector('.provider-select__icon svg')).not.toBeNull();
+    expect(option?.querySelector('.provider-select__icon img')).not.toBeNull();
     expect(option?.querySelector('.provider-select__description')?.textContent)
-      .toContain('GPT');
+      .toContain('Speech Recognition');
     // The closed control mirrors the selected option via <selectedcontent>.
     expect(document.querySelector('.provider-select selectedcontent')).not.toBeNull();
   });
 
-  it('survives a persisted provider that is no longer registered and keeps it visible', () => {
-    // e.g. local_native persisted in Electron, then the profile opened in the
-    // extension — or a feature flag turned off since. The registry has no
-    // descriptor for it; before this, the settings-slice selector threw
-    // (getDescriptor) and the whole section crashed. The select must render,
-    // report the stored value, and pin it on a disabled option instead of
-    // silently displaying the first registered provider.
-    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE } as never);
+  it('survives a persisted provider that is not registered and keeps it visible', () => {
+    // Every stored provider but Local Native since the Stage 2 deletion — or a
+    // feature flag turned off since. The registry has no descriptor for it;
+    // the settings-slice selector would throw (getDescriptor) and crash the
+    // whole section. The select must render, report the stored value, and pin
+    // it on a disabled option instead of silently displaying the first
+    // registered provider (Stage 2 deletion, choice 4).
+    useSettingsStore.setState({ provider: UNREGISTERED } as never);
     render(<ProviderSection isSessionActive={false} />);
 
     const select = getSelect();
-    expect(select.value).toBe(Provider.LOCAL_NATIVE);
+    expect(select.value).toBe(UNREGISTERED);
     const opt = document.querySelector(
-      `.provider-select option[value="${Provider.LOCAL_NATIVE}"]`,
+      `.provider-select option[value="${UNREGISTERED}"]`,
     ) as HTMLOptionElement;
     expect(opt).not.toBeNull();
     expect(opt.disabled).toBe(true);
     // Switching AWAY still works.
-    fireEvent.change(select, { target: { value: Provider.GEMINI } });
-    expect(useSettingsStore.getState().provider).toBe(Provider.GEMINI);
+    fireEvent.change(select, { target: { value: Provider.LOCAL_NATIVE } });
+    expect(useSettingsStore.getState().provider).toBe(Provider.LOCAL_NATIVE);
   });
 
   it('falls back to plain text options where base-select is unsupported', () => {
@@ -109,15 +117,16 @@
     render(<ProviderSection isSessionActive={false} />);
 
     const option = document.querySelector(
-      `.provider-select option[value="${Provider.OPENAI}"]`,
+      `.provider-select option[value="${Provider.LOCAL_NATIVE}"]`,
     );
     // A classic select popup renders option text only — element children
     // would be flattened or invisible, so the markup must not emit them.
     expect(option?.querySelector('span')).toBeNull();
-    expect(option?.textContent).toBe('OpenAI Realtime');
+    expect(option?.textContent).toBe('Free (Native)');
     expect(document.querySelector('.provider-select selectedcontent')).toBeNull();
     // Switching still works through the same handler.
-    fireEvent.change(getSelect(), { target: { value: Provider.GEMINI } });
-    expect(useSettingsStore.getState().provider).toBe(Provider.GEMINI);
+    useSettingsStore.setState({ provider: UNREGISTERED } as never);
+    fireEvent.change(getSelect(), { target: { value: Provider.LOCAL_NATIVE } });
+    expect(useSettingsStore.getState().provider).toBe(Provider.LOCAL_NATIVE);
   });
 });
`````

`src/components/Settings/sections/ProviderSection.tsx`

`````diff t01
diff --git a/src/components/Settings/sections/ProviderSection.tsx b/src/components/Settings/sections/ProviderSection.tsx
--- a/src/components/Settings/sections/ProviderSection.tsx
+++ b/src/components/Settings/sections/ProviderSection.tsx
@@ -1,56 +1,28 @@
 import React, { useState, useEffect, useMemo } from 'react';
-import { Cpu, Zap, HelpCircle, CheckCircle, AlertCircle, ExternalLink, X } from 'lucide-react';
+import { Cpu, HelpCircle, ExternalLink, X } from 'lucide-react';
 import { supportsBaseSelect } from '../../../utils/supportsBaseSelect';
-import { OpenAIIcon, GeminiIcon, PalabraAIIcon, KizunaAIIcon, VolcengineIcon, SonioxIcon, KIZUNA_HOSTED_ICONS } from '../../Icons/ProviderIcons';
-import { PoweredBy } from './PoweredBy';
+import { KizunaAIIcon } from '../../Icons/ProviderIcons';
 import { EngineStatusLine } from './EngineStatusLine';
-import { asSonioxRegion } from '../../../lib/soniox/regions';
-import { sonioxKeyField } from '../../../services/providers/SonioxProviderConfig';
 import { directionKey, type Stage, type DirectionResult } from '../../../lib/local-inference/selection/types';
-import { Trans, useTranslation } from 'react-i18next';
+import { useTranslation } from 'react-i18next';
 import Tooltip from '../../Tooltip/Tooltip';
 import {
   useProvider,
-  useOpenAICompatibleSettings,
-  usePalabraAISettings,
-  useVolcengineAST2Settings,
   useIsApiKeyValid,
   useSetProvider,
-  useUpdateOpenAI,
-  useUpdateGemini,
-  useUpdateOpenAICompatible,
-  useUpdatePalabraAI,
-  useUpdateOpenAITranslate,
-  useUpdateOpenAILive,
-  useUpdateVolcengineAST2,
-  useUpdateSoniox,
-  useValidateApiKey,
-  useIsValidating,
   useValidationMessage,
-  useIsKizunaKeyFetching,
-  useKizunaKeyError,
   useUIMode,
   useNavigateToSettings,
   useSetEngineSlotTarget,
-  useSetAccountPopoverRequested,
-  useLocalInferenceSettings,
   useLocalNativeSettings,
-  useSettingsStore,
 } from '../../../stores/settingsStore';
-import type { SettingsStore } from '../../../stores/settingsStore';
-import { Provider, ProviderType, isKizunaManagedProvider } from '../../../types/Provider';
+import { Provider, ProviderType } from '../../../types/Provider';
 import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
 import { TUTORIAL_URLS } from '../../../services/providers/tutorialUrls';
 import { openExternalUrl } from '../../../utils/openExternalUrl';
-import { useAuth } from '../../../lib/auth/hooks';
 import { useAnalytics } from '../../../lib/analytics';
-import { useModelStore } from '../../../stores/modelStore';
-import { useIsParticipantChannelInScope, useMode } from '../../../stores/audioStore';
+import { useMode } from '../../../stores/audioStore';
 import { useLockedMode } from '../../../stores/sessionStore';
-import {
-  getManifestEntry,
-  estimateModelMemoryByDevice,
-} from '../../../lib/local-inference/modelManifest';
 import { shortenModelName } from '../../../lib/local-inference/modelName';
 import { useNativeModelStatuses, useNativeModelSizes, useNativeModelStore, useNativeCatalog, useNativeAsrResolved, useNativeTranslationResolved, useNativeSidecarStatus } from '../../../stores/nativeModelStore';
 import {
@@ -63,28 +35,15 @@
   formatMemMb,
 } from '../../../lib/local-inference/native/nativeCatalog';
 
-// Icons are React components and stay in the UI layer — the descriptor only
-// carries the i18n key (see i18nKey on ProviderDescriptor). Keys omitted here
-// fall back to DefaultProviderIcon.
+// The old settings panel's provider section, reduced to Local Native: its
+// path is kept whole, working but unreachable, until kizuna-ai-lab/sokuji#578
+// ports it (Stage 2 deletion, ruling 1). The old registry registers nothing
+// else, so the select offers Local Native alone, where it is registered.
 const PROVIDER_ICONS: Partial<Record<ProviderType, React.ComponentType<{ size?: string | number }>>> = {
-  [Provider.OPENAI]: OpenAIIcon,
-  [Provider.GEMINI]: GeminiIcon,
-  [Provider.OPENAI_COMPATIBLE]: Zap,
~ 8 more removed lines sha256:91b5f51b2656
-  ...KIZUNA_HOSTED_ICONS,
-  [Provider.LOCAL_INFERENCE]: KizunaAIIcon,
   [Provider.LOCAL_NATIVE]: KizunaAIIcon,
 };
 const DefaultProviderIcon = HelpCircle;
 
-
 const DISMISSED_KEY = 'sokuji-dismissed-tutorials';
 
 interface ProviderSectionProps {
@@ -99,37 +58,18 @@
 }) => {
   const { t } = useTranslation();
   const { trackEvent } = useAnalytics();
-  const { getToken, isSignedIn } = useAuth();
 
   // Settings store
   const provider = useProvider();
-  const openAICompatibleSettings = useOpenAICompatibleSettings();
-  const palabraAISettings = usePalabraAISettings();
-  const volcengineAST2Settings = useVolcengineAST2Settings();
   const isApiKeyValid = useIsApiKeyValid();
 
   const setProvider = useSetProvider();
-  const updateOpenAISettings = useUpdateOpenAI();
-  const updateGeminiSettings = useUpdateGemini();
-  const updateOpenAICompatibleSettings = useUpdateOpenAICompatible();
-  const updatePalabraAISettings = useUpdatePalabraAI();
-  const updateOpenAITranslateSettings = useUpdateOpenAITranslate();
-  const updateOpenAILiveSettings = useUpdateOpenAILive();
-  const updateVolcengineAST2Settings = useUpdateVolcengineAST2();
-  const updateSonioxSettings = useUpdateSoniox();
-  const validateApiKey = useValidateApiKey();
-  const isValidating = useIsValidating();
   const validationMessage = useValidationMessage();
-  const isKizunaKeyFetching = useIsKizunaKeyFetching();
-  const kizunaKeyError = useKizunaKeyError();
   const uiMode = useUIMode();
   const isSimpleMode = uiMode === 'basic';
   const navigateToSettings = useNavigateToSettings();
   const setEngineSlotTarget = useSetEngineSlotTarget();
-  const setAccountPopoverRequested = useSetAccountPopoverRequested();
 
-  // Local inference model info
-  const localInferenceSettings = useLocalInferenceSettings();
   // Local native (sidecar) model info — separate settings slice + model store.
   const localNativeSettings = useLocalNativeSettings();
   const nativeModelStatuses = useNativeModelStatuses();
@@ -150,9 +90,8 @@
     localNativeSettings.selections, nativeModelStatuses, nativeCatalog]);
 
   // The participant (tgt→src) direction is a peer of the speaker direction,
-  // not a reversal of it — resolved against its own `selections` entry, same
-  // as the WASM speakerResolved/participantResolved pair below. Feeds the
-  // participant/both mode chip groups (Finding 1).
+  // not a reversal of it — resolved against its own `selections` entry. Feeds
+  // the participant/both mode chip groups.
   const nativeParticipantResolved = useMemo(() => {
     if (provider !== Provider.LOCAL_NATIVE) return null;
     return useNativeModelStore.getState().resolve(
@@ -182,8 +121,8 @@
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [provider, nativeIdsKey]);
 
-  // Memory estimate for native — same "footprint ≈ on-disk model size" heuristic
-  // as LOCAL_INFERENCE, but split into VRAM vs RAM per stage: a model lands in
+  // Memory estimate for native — the "footprint ≈ on-disk model size"
+  // heuristic, split into VRAM vs RAM per stage: a model lands in
   // VRAM when its device is forced to gpu, or left on auto AND the sidecar
   // reports an available GPU tier for it (so the resolver would run it on the
   // GPU). Each stage (ASR/translation/TTS) carries its own device override.
@@ -213,54 +152,14 @@
     return { ...mem, degraded };
   }, [asrResolved, translationResolved, nativeSpeakerResolved]);
 
-  const isParticipantChannelInScope = useIsParticipantChannelInScope();
-  // Effective audio mode — same `lockedMode ?? mode` idiom LanguageSection
-  // uses for every other mode-scoped display: an in-session panel describes
-  // the session that is actually running, not wherever the mode picker
-  // currently sits. Drives which chip groups the model-info block below
-  // renders (Finding 1: chips must follow the audio mode).
+  // Effective audio mode — the `lockedMode ?? mode` idiom every mode-scoped
+  // display uses: an in-session panel describes the session that is actually
+  // running, not wherever the mode picker currently sits. Drives which chip
+  // groups the model-info block below renders (chips must follow the audio
+  // mode).
   const mode = useMode();
   const lockedMode = useLockedMode();
   const audioMode = lockedMode ?? mode;
-  // Read model download statuses reactively so participant status updates when models are downloaded
-  const modelStatuses = useModelStore(state => state.modelStatuses);
-  // Live, resolved view of the WASM speaker (src→tgt) direction — same
~ 34 more removed lines sha256:630895ef227f
-    return estimateModelMemoryByDevice([...mainIds, ...participantIds], deviceFeatures);
-  }, [provider, deviceFeatures, isParticipantChannelInScope, participantResolved, speakerResolved]);
 
   // Whether the provider select can render rich option markup (icons,
   // descriptions, engine credits). Stable for the life of the page, so a
@@ -285,8 +184,8 @@
 
   const tutorialUrl = TUTORIAL_URLS[provider];
 
-  // Shared by every model chip (both local providers, both speaker/
-  // participant chip groups): deep-link the engine surface straight to this
+  // Shared by every model chip (both the speaker and the participant chip
+  // groups): deep-link the engine surface straight to this
   // slot instead of the old "flip the language pair" workflow. Takes the
   // direction EXPLICITLY rather than deriving it from the provider's stored
   // src/tgt — a participant-group chip targets the reverse direction, a
@@ -301,16 +200,15 @@
     if (!isSimpleMode) navigateToSettings('provider');
   };
 
-  // ── Chip groups: mode-aware, shared by both local providers ─────────────
+  // ── Chip groups: mode-aware ──────────────────────────────────────────────
   //
   // - 'speaker'     → 3 chips (ASR/MT/TTS) for src→tgt.
   // - 'participant' → 2 chips (ASR/MT — no TTS) for the REVERSE tgt→src.
   // - 'both'        → both groups, each under a small-caps label so which
   //   group is whose is never ambiguous.
   //
-  // `renderChips` renders one direction's chip row; it differs per provider
-  // (native looks up catalog cards for display names, WASM reads the
-  // manifest directly), so it's injected rather than hard-coded here.
+  // `renderChips` renders one direction's chip row (Local Native's looks up
+  // the sidecar catalog's cards for display names).
   const renderChipGroups = (
     renderChips: (resolved: DirectionResult | null, src: string, tgt: string, includeTts: boolean) => React.ReactNode,
     speaker: DirectionResult | null,
@@ -386,128 +284,18 @@
     );
   };
 
-  // LOCAL_INFERENCE's chip row: reads the static WASM manifest directly.
-  const renderInferenceChips = (resolved: DirectionResult | null, src: string, tgt: string, includeTts: boolean): React.ReactNode => {
-    const dir = directionKey(src, tgt);
~ 36 more removed lines sha256:5bb6f9be504b
-  };
-
   // Get all available providers
   const availableProviders = useMemo(() => {
     return ProviderConfigFactory.getAllConfigs();
   }, []);
 
-  // The persisted provider can be one the registry no longer carries — a
-  // feature flag turned off since, or a selection made in Electron opened in
-  // the extension (local_native, volcengine_ast2). getDescriptor throws for
-  // those, and this component must survive them: the select renders the
-  // stored value on a disabled placeholder option instead.
+  // The persisted provider can be one the old registry does not carry — any
+  // provider but Local Native, or Local Native itself outside Electron or with
+  // its gate off (Stage 2 deletion, choice 4). getDescriptor throws for those,
+  // and this component must survive them: the select renders the stored value
+  // on a disabled placeholder option instead.
   const providerRegistered = ProviderConfigFactory.isProviderSupported(provider);
 
-  // Get current API key based on provider — delegates to the descriptor's
-  // peekPrimaryCredential so the per-provider credential shape lives in one
-  // place instead of being hand-copied here (see also settingsStore.validateApiKey).
~ 64 more removed lines sha256:2f8cf8cb9d65
-  };
-
   // Handle provider switching
   const handleProviderChange = (newProvider: ProviderType) => {
     const oldProvider = provider;
@@ -543,25 +331,17 @@
     };
   };
 
-  const currentApiKey = getCurrentApiKey();
-
   // One renderer for every provider option — the registered list and the
   // unregistered-placeholder both go through it, so the rich/plain split
   // (see richSelect) lives in exactly one place.
   const renderProviderOption = (id: ProviderType, disabled = false) => {
     const optionInfo = getProviderInfoById(id);
-    // Whatever the wizard's managed card recommends, this list recommends —
-    // same function, so the two surfaces cannot name different providers.
-    const recommended = id === ProviderConfigFactory.getDefaultManagedProvider();
-    const recommendedLabel = t('simpleSettings.recommended', 'Recommended');
     if (!richSelect) {
       // Chrome below 135 renders <option>{text}</option> and drops every child
-      // element, so on the extension's floor (116) the claim has to be text.
+      // element, so on the extension's floor (116) the option is its name.
       return (
         <option key={id} value={id} disabled={disabled}>
-          {recommended
-            ? t('simpleSettings.recommendedOption', '{{name}} ({{label}})', { name: optionInfo.name, label: recommendedLabel })
-            : optionInfo.name}
+          {optionInfo.name}
         </option>
       );
     }
@@ -571,13 +351,8 @@
           {React.createElement(optionInfo.icon, { size: 20 })}
         </span>
         <span className="provider-select__text">
-          {/* Name and engine credit share one line: the managed twins are all
-              named "KizunaAI", so the vendor is what tells them apart, and
-              giving it its own line would make every row a line taller. */}
           <span className="provider-name-line">
             <span className="provider-select__name">{optionInfo.name}</span>
-            <PoweredBy provider={id} />
-            {recommended && <em className="provider-recommended">{recommendedLabel}</em>}
           </span>
           <span className="provider-select__description">{optionInfo.description}</span>
         </span>
@@ -643,22 +418,7 @@
         {provider === Provider.LOCAL_NATIVE && <EngineStatusLine />}
       </div>
 
-      {/* API Endpoint Input - Only for OpenAI Compatible */}
-      {provider === Provider.OPENAI_COMPATIBLE && (
-        <div className="endpoint-input-group">
~ 11 more removed lines sha256:11c16bc20ad3
-      {/* API Key Input or Kizuna AI Status or Local Inference (no key needed) */}
-      {provider === Provider.LOCAL_NATIVE ? (
+      {provider === Provider.LOCAL_NATIVE && (
         // data-tour sits on the wrapper, not the chip row: the tour's `models`
         // step runs while the sidecar may still be 'starting', and only the
         // wrapper is present in every native state.
@@ -694,218 +454,6 @@
             </div>
           )}
         </div>
-      ) : provider === Provider.LOCAL_INFERENCE ? (
-        // Same anchor placement as the native branch above, for the same reason.
-        <div className="local-inference-info" data-tour="engine-chips">
~ 207 more removed lines sha256:361ed144f45b
-          </div>
-        )
       )}
 
       {tutorialUrl && !dismissedTutorials.has(provider) && (
@@ -920,13 +468,13 @@
         </div>
       )}
 
-      {/* Local providers' "models missing" state is narrated ONCE, by
+      {/* Local Native's "models missing" state is narrated ONCE, by
           LanguageSection's resolver-backed warning with per-stage download
           links (2026-08-23 warning-dedup decision) — repeating it here as a
           validation error was the same sentence twice on one screen. The
           validation STATE itself is untouched; only the duplicate copy goes. */}
       {validationMessage
-        && !((provider === Provider.LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE) && !isApiKeyValid) && (
+        && !(provider === Provider.LOCAL_NATIVE && !isApiKeyValid) && (
         <div className={`validation-message ${isApiKeyValid ? 'success' : 'error'}`}>
           {validationMessage}
         </div>
`````

`src/components/Settings/sections/ProviderSpecificSettings.engine.test.tsx`

`````diff t01
diff --git a/src/components/Settings/sections/ProviderSpecificSettings.engine.test.tsx b/src/components/Settings/sections/ProviderSpecificSettings.engine.test.tsx
--- a/src/components/Settings/sections/ProviderSpecificSettings.engine.test.tsx
+++ b/src/components/Settings/sections/ProviderSpecificSettings.engine.test.tsx
@@ -1,19 +1,18 @@
 /**
  * Composition smoke tests mounting the REAL ProviderSpecificSettings ->
- * EngineSurface tree, for both local providers — the Task 7 review's carried
- * finding: every engine piece (adapter, EnginePage, EngineSurface, the
- * per-provider Library section) was unit-tested standalone, but nothing
- * proved ProviderSpecificSettings actually wires them together for either
- * provider. Deliberately smoke-level: render + a couple of structural
- * assertions, not a re-test of EnginePage/EngineSection/adapter behavior —
- * each already has its own dedicated test file.
+ * EngineSurface tree for Local Native, the one provider the old panel still
+ * serves (Stage 2 deletion, ruling 1): every engine piece (adapter,
+ * EnginePage, EngineSurface, the Library section) is unit-tested standalone,
+ * and these prove ProviderSpecificSettings wires them together. Deliberately
+ * smoke-level: render + a couple of structural assertions, not a re-test of
+ * EnginePage/EngineSection/adapter behavior — each already has its own
+ * dedicated test file.
  *
- * Follows ProviderSpecificSettings.soniox.test.tsx's mount idiom (real
- * settingsStore/modelStore/nativeModelStore, ServiceFactory mocked, heavy
- * local-provider sections stubbed) combined with StoragePage.test.tsx's
- * interpolating `t()` mock, needed here to tell the two rendered direction
- * headings apart ("日本語 → English" vs "English → 日本語" — resolved
- * language NAMES, not the raw 'ja'/'en' codes, per the languageName spec).
+ * The real settingsStore/nativeModelStore, ServiceFactory mocked, the heavy
+ * Library section stubbed, and StoragePage.test.tsx's interpolating `t()`
+ * mock, needed here to tell the two rendered direction headings apart
+ * ("日本語 → English" vs "English → 日本語" — resolved language NAMES, not
+ * the raw 'ja'/'en' codes, per the languageName spec).
  */
 import { describe, it, expect, vi, beforeEach } from 'vitest';
 import { render, fireEvent, act, waitFor } from '@testing-library/react';
@@ -62,10 +61,8 @@
   isLocalNativeEnabled: () => true,
 }));
 
-// Heavy Library sections — never rendered by these tests (EngineSurface opens
-// on its overview page, not a pushed Library view), stubbed the way
-// ProviderSpecificSettings.soniox.test.tsx stubs local-provider sections.
-vi.mock('./ModelManagementSection', () => ({ ModelManagementSection: () => null }));
+// The heavy Library section — never rendered by these tests (EngineSurface
+// opens on its overview page, not a pushed Library view).
 vi.mock('./NativeModelManagementSection', () => ({ NativeModelManagementSection: () => null }));
 // EngineSection has its own dedicated test file (EngineSection.test.tsx);
 // stubbed to a marker here so this file only asserts WHERE it renders (moved
@@ -78,47 +75,22 @@
 const { default: useSettingsStore } = await import('../../../stores/settingsStore');
 const { default: useAudioStore } = await import('../../../stores/audioStore');
 const { Provider } = await import('../../../types/Provider');
-const { LocalInferenceProviderConfig } = await import('../../../services/providers/LocalInferenceProviderConfig');
-const { LocalNativeProviderConfig } = await import('../../../services/providers/LocalNativeProviderConfig');
 const { default: ProviderSpecificSettings } = await import('./ProviderSpecificSettings');
 
-const baseProps = {
-  isSessionActive: false,
-  isPreviewExpanded: false,
-  setIsPreviewExpanded: () => {},
-  getProcessedSystemInstructions: () => '',
-  availableModels: [] as any[],
-  loadingModels: false,
-  fetchAvailableModels: async () => {},
-};
-
 function directionHeadings(container: HTMLElement): string[] {
   return Array.from(container.querySelectorAll('.engine-direction__title')).map((el) => el.textContent ?? '');
 }
 
 beforeEach(() => {
-  useSettingsStore.setState({ engineSlotTarget: null });
+  useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE, engineSlotTarget: null });
   // Direction visibility is mode-scoped (2026-08-23): these composition
   // tests assert BOTH legs, so pin 'both' — the store default is 'speaker'.
   useAudioStore.setState({ mode: 'both' } as never);
 });
 
-describe('ProviderSpecificSettings — Engine surface composition (Task 7 review carry-over)', () => {
-  it('LOCAL_INFERENCE: EngineSurface renders with both direction headings, no engine gate', () => {
-    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
-    const { container } = render(
-      <ProviderSpecificSettings {...baseProps} config={new LocalInferenceProviderConfig().getConfig()} />,
-    );
-    expect(directionHeadings(container)).toEqual(['日本語 → English', 'English → 日本語']);
-    // The WASM adapter carries no `gate` — EngineSection is a native-only concern.
-    expect(container.querySelector('[data-testid="engine-section-gate"]')).toBeNull();
-  });
-
+describe('ProviderSpecificSettings — Engine surface composition', () => {
   it('LOCAL_NATIVE: EngineSurface renders with both direction headings and the EngineSection gate, exactly once', () => {
-    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE });
-    const { container } = render(
-      <ProviderSpecificSettings {...baseProps} config={new LocalNativeProviderConfig().getConfig()} />,
-    );
+    const { container } = render(<ProviderSpecificSettings isSessionActive={false} />);
     expect(directionHeadings(container)).toEqual(['日本語 → English', 'English → 日本語']);
     // Moved into the adapter's `gate` (Task 8) — must render, and only once
     // (the branch's old standalone <EngineSection/> is gone).
@@ -126,11 +98,10 @@
   });
 
   it('a set engineSlotTarget in advanced mode flashes that slot row, and clears the signal (Task 10, dropdown form)', () => {
-    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
     useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });
 
     const { container } = render(
-      <ProviderSpecificSettings {...baseProps} config={new LocalInferenceProviderConfig().getConfig()} />,
+      <ProviderSpecificSettings isSessionActive={false} />,
     );
 
     // Dropdown form: nothing expands anymore — the deep link's landing is
@@ -154,11 +125,10 @@
   it('re-firing the same slot target re-flashes the row (same chip tapped twice)', () => {
     vi.useFakeTimers();
     try {
-      useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
       useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });
 
       const { container } = render(
-        <ProviderSpecificSettings {...baseProps} config={new LocalInferenceProviderConfig().getConfig()} />,
+        <ProviderSpecificSettings isSessionActive={false} />,
       );
 
       const slot = container.querySelector('.engine-slot[data-slot="ja→en:asr"]')!;
@@ -180,11 +150,10 @@
   });
 
   it('a pushed Library page pops back to the Engine page when a NEW slot target fires', async () => {
-    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
     useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });
 
     const { container } = render(
-      <ProviderSpecificSettings {...baseProps} config={new LocalInferenceProviderConfig().getConfig()} />,
+      <ProviderSpecificSettings isSessionActive={false} />,
     );
 
     const asrSlot = container.querySelector('.engine-slot[data-slot="ja→en:asr"]')!;
`````

`src/components/Settings/sections/ProviderSpecificSettings.tsx`

`````diff t01
diff --git a/src/components/Settings/sections/ProviderSpecificSettings.tsx b/src/components/Settings/sections/ProviderSpecificSettings.tsx
--- a/src/components/Settings/sections/ProviderSpecificSettings.tsx
+++ b/src/components/Settings/sections/ProviderSpecificSettings.tsx
@@ -1,322 +1,50 @@
-import React, { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
-import { ProviderConfig } from '../../../services/providers/ProviderConfig';
-import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
-import { supportsTranscriptionContext } from '../../../services/providers/openaiTranscriptionContext';
-import { OpenAITranscriptModel } from '../../../services/providers/OpenAIProviderConfig';
-import { resolveAST2LanguagePair } from '../../../services/providers/volcengineAST2LanguageSync';
-import { isGeminiTranslateModel } from '../../../services/providers/geminiTranslateModel';
+import React, { useEffect, useMemo, useState } from 'react';
 import {
   useProvider,
-  useSystemInstructions,
-  useTemplateSystemInstructions,
-  useUseTemplateMode,
~ 11 more removed lines sha256:d219d479f324
-  useKizunaSonioxSettings,
-  useLocalInferenceSettings,
   useLocalNativeSettings,
   useUpdateLocalNative,
   useEngineSlotTarget,
   useSetEngineSlotTarget,
-  useSetSystemInstructions,
-  useSetTemplateSystemInstructions,
-  useSetUseTemplateMode,
~ 16 more removed lines sha256:ae6ca4ee25c8
-  useLocalParticipantSystemPrompt,
-  useLocalUseTemplateMode,
   useGetProcessedLocalPrompt,
-  resolveTranslationWorkerTypeForModelId,
 } from '../../../stores/settingsStore';
-import type { OpenAICompatibleSettingsBase } from '../../../stores/settingsStore';
-import { ClientFactory } from '../../../services/clients';
-import { useTranslation } from 'react-i18next';
-import { ChevronDown, ChevronRight, RotateCw, Info, CircleHelp, ExternalLink } from 'lucide-react';
-import Tooltip from '../../Tooltip/Tooltip';
-import { FilteredModel } from '../../../services/interfaces/IClient';
-import { Provider, isOpenAICompatible, kizunaBaseProvider, isKizunaManagedProvider } from '../../../types/Provider';
-import { sonioxUsesSharedBothSession } from '../../../services/providers/SonioxProviderConfig';
-import { getManifestEntry } from '../../../lib/local-inference/modelManifest';
-import { useModelStatuses, useModelStore } from '../../../stores/modelStore';
+import { Provider } from '../../../types/Provider';
 import { useMode } from '../../../stores/audioStore';
-import { isElectron } from '../../../utils/environment';
-import { ModelManagementSection } from './ModelManagementSection';
 import { NativeModelManagementSection } from './NativeModelManagementSection';
 import { EngineSurface } from '../engine/EngineSurface';
-import { useWasmEngineAdapter } from '../engine/useWasmEngineAdapter';
 import { useNativeEngineAdapter } from '../engine/useNativeEngineAdapter';
 import { StoragePage } from '../engine/StoragePage';
 import type { SlotId } from '../engine/EngineTypes';
-import SonioxVoiceSection from './SonioxVoiceSection';
-import { byokVoiceSource, managedVoiceSource, type VoiceLibrarySource } from './voiceLibrarySource';
-import { SonioxVoicesClient } from '../../../services/clients/SonioxVoicesClient';
-import { useSessionIsInitializing, useLockedMode } from '../../../stores/sessionStore';
-import {
-  SONIOX_REGIONS, SONIOX_REGION_LABELS, asSonioxRegion,
-} from '../../../lib/soniox/regions';
-import { sonioxKeyField, sonioxVoiceField } from '../../../services/providers/SonioxProviderConfig';
-import { ManagedVoicesClient } from '../../../services/clients/ManagedVoicesClient';
-import { TtsSpeedControl, SpeechModeControl, VadControl, TranslationPromptControl, type SpeechMode } from './LocalSettingsControls';  // TranslationPromptControl shared by both local providers
+import { useLockedMode } from '../../../stores/sessionStore';
+import { TtsSpeedControl, SpeechModeControl, VadControl, TranslationPromptControl, type SpeechMode } from './LocalSettingsControls';
 import { hasNativeTts, supportsCustomPrompt } from '../../../lib/local-inference/native/nativeCatalog';
 import { useNativeCatalog, useNativeModelStore } from '../../../stores/nativeModelStore';
 import { useAnalytics } from '../../../lib/analytics';
-import { useAuth } from '../../../lib/auth/hooks';
-
-interface ProviderSpecificSettingsProps {
~ 7 more removed lines sha256:7aed3281ef88
-  fetchAvailableModels: (getAuthToken?: () => Promise<string | null>, isSignedIn?: boolean) => Promise<void>;
-}
 
 /**
- * OpenAI's internal `'Disabled'` mode is surfaced in the UI as "Push-to-Talk"
- * (matches the equivalent button on other providers). For analytics we want
- * the same normalization so cross-provider mode stats are consistent.
+ * The old settings panel's provider-specific part, reduced to Local Native:
+ * its path is kept whole, working but unreachable, until kizuna-ai-lab/sokuji#578
+ * ports it (Stage 2 deletion, ruling 1). Every other provider's settings are
+ * its own view in `src/providers/<id>/`.
  */
-function normalizeSpeechModeForAnalytics(mode: string): string {
-  return mode === 'Disabled' ? 'Push-to-Talk' : mode;
+interface ProviderSpecificSettingsProps {
+  isSessionActive: boolean;
 }
 
 const ProviderSpecificSettings: React.FC<ProviderSpecificSettingsProps> = ({
-  config,
   isSessionActive,
-  isPreviewExpanded,
-  setIsPreviewExpanded,
-  getProcessedSystemInstructions,
-  availableModels,
-  loadingModels,
-  fetchAvailableModels
 }) => {
-  const { getToken, userId } = useAuth();
-  // Settings from store
   const provider = useProvider();
-  const systemInstructions = useSystemInstructions();
-  const templateSystemInstructions = useTemplateSystemInstructions();
-  const useTemplateMode = useUseTemplateMode();
~ 7 more removed lines sha256:26573e526492
-  const volcengineAST2Settings = useVolcengineAST2Settings();
-  const sonioxSettings = useSonioxSettings();
   const mode = useMode();
   const lockedMode = useLockedMode();
-  const kizunaOpenaiTranslateSettings = useKizunaOpenaiTranslateSettings();
-  const kizunaVolcengineAst2Settings = useKizunaVolcengineAst2Settings();
-  const kizunaSonioxSettings = useKizunaSonioxSettings();
-  const localInferenceSettings = useLocalInferenceSettings();
   const localNativeSettings = useLocalNativeSettings();
   const updateLocalNativeSettings = useUpdateLocalNative();
   const nativeCatalog = useNativeCatalog();
-  const modelStatuses = useModelStatuses();
-
-  // Actions from store
~ 18 more removed lines sha256:82addd9a17d2
-  const localParticipantSystemPrompt = useLocalParticipantSystemPrompt();
-  const localUseTemplateMode = useLocalUseTemplateMode();
   const getProcessedLocalPrompt = useGetProcessedLocalPrompt();
-  const { t } = useTranslation();
   const { trackEvent } = useAnalytics();
 
-  // Kizuna-managed relay twins reuse their base provider's controls. The
-  // sections below gate on `effectiveProvider` so the OPENAI_TRANSLATE /
-  // VOLCENGINE_AST2 UI renders for the twins, but read/write the kizuna slices
~ 141 more removed lines sha256:c8710076773f
-  const selectedAsr = speakerResolved.asr?.modelId ?? '';
-
   // LOCAL_NATIVE's resolved direction. The custom-prompt control needs to know
   // which translation model would actually run, because not all of them accept
-  // one (#526) — the twin of speakerResolved above, which serves LOCAL_INFERENCE.
-  // Hoisted here because hooks must run unconditionally, even though only the
-  // LOCAL_NATIVE branch reads it.
+  // one (#526).
   const nativeResolved = useMemo(() => useNativeModelStore.getState().resolve(
     localNativeSettings.sourceLanguage,
     localNativeSettings.targetLanguage,
@@ -328,1965 +56,97 @@
     nativeCatalog,
   ]);
 
-  // LOCAL_INFERENCE's EngineAdapter — hoisted above the return (hooks must
-  // run unconditionally) even though it's only rendered in the
-  // LOCAL_INFERENCE branch below.
-  const wasmAdapter = useWasmEngineAdapter(isSessionActive);
-  // LOCAL_NATIVE's EngineAdapter — same reason, hoisted for the LOCAL_NATIVE
-  // branch below.
+  // LOCAL_NATIVE's EngineAdapter — hoisted above the return (hooks must run
+  // unconditionally) even though it's only rendered in the branch below.
   const nativeAdapter = useNativeEngineAdapter(isSessionActive);
 
-  // One-shot deep-link into the engine surface, fired by an engine chip
-  // (Task 10). Consumed on the render where it's seen: a local provider
-  // opens that slot, and the signal is cleared immediately so it can't be
-  // picked up again by a later switch to a local provider — mirrors
-  // SimpleSettings' consumption of the same signal.
+  // One-shot deep-link into the engine surface, fired by an engine chip.
+  // Consumed on the render where it's seen: Local Native opens that slot, and
+  // the signal is cleared immediately so it can't be picked up again by a
+  // later switch to it — mirrors SimpleSettings' consumption of the same
+  // signal.
   const engineSlotTarget = useEngineSlotTarget();
   const setEngineSlotTarget = useSetEngineSlotTarget();
   const [engineInitialSlot, setEngineInitialSlot] = useState<SlotId | null>(null);
   useEffect(() => {
     if (!engineSlotTarget) return;
-    if (provider === Provider.LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE) {
+    if (provider === Provider.LOCAL_NATIVE) {
       setEngineInitialSlot(engineSlotTarget);
     }
     setEngineSlotTarget(null);
   }, [engineSlotTarget, provider, setEngineSlotTarget]);
 
-  // Custom prompt is supported when EITHER the speaker's or the participant's
-  // translation worker is Qwen-family. The participant direction (tgt→src) is
-  // a peer of the speaker direction, not a reversal of it: its worker type is
~ 79 more removed lines sha256:e9b48ae6d89b
-      return openAILiveSettings;
-    }
+  if (provider !== Provider.LOCAL_NATIVE) {
     return null;
-  };
-
-  const updateOpenAICompatibleSettingsHelper = (updates: any) => {
~ 79 more removed lines sha256:d862f7bd92cf
-    // Check if WebRTC mode is active - server VAD causes audio truncation in WebRTC
-    const isWebRTCMode = compatibleSettings?.transportType === 'webrtc';
+  }
+  // The speed slider is meaningful only when the target language has a native
+  // voice (text-only is the common textOnly toggle, not a per-stage Off option).
+  const ttsActive = hasNativeTts(localNativeSettings.targetLanguage, nativeCatalog);
+  // Not every native translation model accepts a custom prompt: TranslateGemma's
+  // own chat template assembles the whole instruction and refuses a system role,
+  // so the sidecar discards one. Offering the box and dropping what the user
+  // types is worse than not offering it (#526).
+  const promptSupported = supportsCustomPrompt(nativeResolved.translation?.modelId ?? '');
 
-    return (
-      <div className="settings-section turn-detection-section" id="turn-detection-section">
-        <h2>
~ 691 more removed lines sha256:cd51fce0a1b6
-          </>
-          </div>
+  return (
+    <>
+      {/* EngineSurface renders the sidecar-bundle gate (spec S10) at the top of
+          its Engine page via the adapter's `gate` — no standalone <EngineSection/>
+          here, or it would render twice. */}
+      <EngineSurface
+        adapter={nativeAdapter}
+        effectiveMode={lockedMode ?? mode}
+        initialSlot={engineInitialSlot}
+        onInitialSlotConsumed={() => setEngineInitialSlot(null)}
+        renderLibrary={(slot) => (
+          <NativeModelManagementSection isSessionActive={isSessionActive}
+            stageFilter={slot.stage} direction={slot.dir} />
         )}
-      </>
-    );
-  };
~ 579 more removed lines sha256:4fe83ca9caab
-          isSessionActive={isSessionActive}
-        />
+        renderStorage={() => <StoragePage provider="native" isSessionActive={isSessionActive} />}
+      />
 
+      {ttsActive && (
         <TtsSpeedControl
-          value={activeSonioxSettings.ttsSpeed}
-          onChange={(ttsSpeed) => updateActiveSonioxSettings({ ttsSpeed })}
+          value={localNativeSettings.ttsSpeed}
+          onChange={(ttsSpeed) => updateLocalNativeSettings({ ttsSpeed })}
           disabled={isSessionActive}
-          min={0.7}
-          max={1.3}
-          step={0.05}
         />
+      )}
 
-        <div className="settings-section" id="soniox-vocabulary-section">
-          <h2>
-            {t('settings.sonioxVocabulary', 'Custom Vocabulary')}
~ 244 more removed lines sha256:bf1182a01889
-            trackEvent('speech_mode_changed', { provider, from_mode: fromMode, to_mode: turnDetectionMode });
-            updateLocalNativeSettings({ turnDetectionMode });
+      <SpeechModeControl
+        value={localNativeSettings.turnDetectionMode}
+        onChange={(turnDetectionMode: SpeechMode) => {
+          const fromMode = localNativeSettings.turnDetectionMode;
+          trackEvent('speech_mode_changed', { provider, from_mode: fromMode, to_mode: turnDetectionMode });
+          updateLocalNativeSettings({ turnDetectionMode });
+        }}
+        disabled={isSessionActive}
+      />
+
+      <TranslationPromptControl
+        useTemplateMode={localNativeSettings.useTemplateMode}
+        systemPrompt={localNativeSettings.systemPrompt}
+        /* no participantSystemPrompt: native has no participant audio path */
+        preview={getProcessedLocalPrompt(false)}
+        supported={promptSupported}
+        disabled={isSessionActive}
+        previewId="local-native-prompt-preview-content"
+        onChange={(patch) => updateLocalNativeSettings(patch)}
+      />
+
+      {localNativeSettings.turnDetectionMode === 'Auto' && (
+        <VadControl
+          values={{
+            vadThreshold: localNativeSettings.vadThreshold,
+            vadMinSilenceDuration: localNativeSettings.vadMinSilenceDuration,
+            vadMinSpeechDuration: localNativeSettings.vadMinSpeechDuration,
           }}
-          disabled={isSessionActive}
-        />
-
-        <TranslationPromptControl
-          useTemplateMode={localNativeSettings.useTemplateMode}
-          systemPrompt={localNativeSettings.systemPrompt}
-          /* no participantSystemPrompt: native has no participant audio path */
-          preview={getProcessedLocalPrompt(false)}
-          supported={promptSupported}
-          disabled={isSessionActive}
-          previewId="local-native-prompt-preview-content"
           onChange={(patch) => updateLocalNativeSettings(patch)}
-        />
-
-        {localNativeSettings.turnDetectionMode === 'Auto' && (
~ 36 more removed lines sha256:6b901ba63510
-          value={localInferenceSettings.ttsSpeed}
-          onChange={(ttsSpeed) => updateLocalInferenceSettings({ ttsSpeed })}
           disabled={isSessionActive}
         />
-
-        <SpeechModeControl
-          value={localInferenceSettings.turnDetectionMode}
~ 145 more removed lines sha256:a1c26f46d361
-          )}
-        </div>
       )}
-
-      {/* Provider-specific settings */}
-      {renderVoiceSettings()}
~ 12 more removed lines sha256:fba8b456f4b8
-      {renderLocalNativeSettings()}
-    </Fragment>
+    </>
   );
 };
 
-export default ProviderSpecificSettings; 
\ No newline at end of file
+export default ProviderSpecificSettings;
`````

`src/components/providers/ProviderPicker.test.tsx`

`````diff t01
diff --git a/src/components/providers/ProviderPicker.test.tsx b/src/components/providers/ProviderPicker.test.tsx
--- a/src/components/providers/ProviderPicker.test.tsx
+++ b/src/components/providers/ProviderPicker.test.tsx
@@ -42,8 +42,7 @@
 
 // The vendor credit renders through <Trans>, which reads the real i18next
 // singleton directly (context or getI18n()) rather than the useTranslation()
-// hook mocked above — same setup PoweredBy.test.tsx uses to exercise the same
-// i18nKey ('providers.poweredBy').
+// hook mocked above ('providers.poweredBy').
 import '../../locales';
 
 import { fakeProvider } from '../../providers/fake/provider';
`````

`src/lib/diagnostics/consoleLedger.consistency.test.ts`

`````diff t01
diff --git a/src/lib/diagnostics/consoleLedger.consistency.test.ts b/src/lib/diagnostics/consoleLedger.consistency.test.ts
--- a/src/lib/diagnostics/consoleLedger.consistency.test.ts
+++ b/src/lib/diagnostics/consoleLedger.consistency.test.ts
@@ -170,7 +170,9 @@
   'src/components/Auth/ForgotPasswordForm.tsx': 2,
   'src/components/Settings/sections/HelpSection.tsx': 2,
   'src/components/Settings/sections/ModelManagementSection.tsx': 2,
-  'src/components/Settings/sections/ProviderSpecificSettings.tsx': 2,
+  // ProviderSpecificSettings.tsx's row (2) is gone, not lowered to 0: both of
+  // its calls sat in the other providers' branches, which the Stage 2
+  // deletion removed; the Local Native branch it keeps has none.
   'src/components/Auth/SignInForm.tsx': 1,
   'src/components/Auth/SignUpForm.tsx': 1,
   // AdvancedSettings.tsx's row (1) is gone, not lowered to 0: its one call
`````

`src/locales/locales.consistency.test.ts`

`````diff t01
diff --git a/src/locales/locales.consistency.test.ts b/src/locales/locales.consistency.test.ts
--- a/src/locales/locales.consistency.test.ts
+++ b/src/locales/locales.consistency.test.ts
@@ -115,7 +115,7 @@
 });
 
 describe('the powered-by attribution keeps its brand slot', () => {
-  // PoweredBy renders through <Trans components={{ brand: <span/> }}> so the
+  // The credit renders through <Trans components={{ brand: <span/> }}> so the
   // vendor gets its own element and can be typeset a step stronger than the
   // preposition it sits next to. A translation that drops the tag still shows
   // the vendor — it just silently loses the emphasis, which is exactly the kind
`````

`src/services/providers/tutorialUrls.ts`

`````diff t01
diff --git a/src/services/providers/tutorialUrls.ts b/src/services/providers/tutorialUrls.ts
--- a/src/services/providers/tutorialUrls.ts
+++ b/src/services/providers/tutorialUrls.ts
@@ -1,23 +1,17 @@
 // src/services/providers/tutorialUrls.ts
 //
-// Where a user goes to find out how to get a key for a provider. Shared by the
-// Settings provider section and the setup wizard's credential step: the wizard
-// asks for a key before the user has ever seen Settings, so the same link has
-// to be reachable from both, and one map keeps them from drifting apart.
+// Where a user goes to find out how to set up a provider. The setup wizard's
+// provider step links the index page; the old settings panel's provider
+// section, kept for Local Native until kizuna-ai-lab/sokuji#578 (Stage 2
+// deletion, ruling 1), links Local Native's guide. Every ported provider
+// carries its own `guideUrl` in its definition.
 import { Provider } from '../../types/Provider';
 import type { ProviderType } from '../../types/Provider';
 
 /** The index page listing every provider's guide. */
 export const AI_PROVIDERS_DOCS_URL = 'https://sokuji.kizuna.ai/docs/ai-providers';
 
-/** Per-provider guide. Managed providers have none: their key is ours to fetch. */
+/** Per-provider guide, for the one provider the old section still shows. */
 export const TUTORIAL_URLS: Partial<Record<ProviderType, string>> = {
-  [Provider.OPENAI]: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',
-  [Provider.GEMINI]: 'https://sokuji.kizuna.ai/docs/tutorials/gemini-setup',
-  [Provider.PALABRA_AI]: 'https://sokuji.kizuna.ai/docs/tutorials/palabraai-setup',
-  [Provider.OPENAI_COMPATIBLE]: 'https://sokuji.kizuna.ai/docs/tutorials/openai-compatible-setup',
-  [Provider.VOLCENGINE_AST2]: 'https://sokuji.kizuna.ai/docs/tutorials/volcengine-ast2-setup',
-  [Provider.SONIOX]: 'https://sokuji.kizuna.ai/docs/tutorials/soniox-setup',
-  [Provider.LOCAL_INFERENCE]: 'https://sokuji.kizuna.ai/docs/tutorials/local-inference-setup',
   [Provider.LOCAL_NATIVE]: 'https://sokuji.kizuna.ai/docs/tutorials/local-native-setup',
 };
`````

`src/stores/sessionStore.ts`

`````diff t01
diff --git a/src/stores/sessionStore.ts b/src/stores/sessionStore.ts
--- a/src/stores/sessionStore.ts
+++ b/src/stores/sessionStore.ts
@@ -3,12 +3,11 @@
 
 // This store is a leftover of the pre-client-contract session path. Nothing
 // writes it any more — the new session lives under `src/app/`. It survives
-// only because kept old-provider UI still reads it: `ProviderSpecificSettings`
-// (useSessionIsInitializing, useLockedMode) and, through the same imports,
-// `ProviderSection` / `LanguageSection` (useLockedMode), which are unmounted
-// at run time but still type-checked. Each Stage 2 port that removes one of
-// those readers moves this store a step closer to deletion; once the last
-// reader is gone, delete the file.
+// only because the old settings shell, kept for Local Native until
+// kizuna-ai-lab/sokuji#578 (Stage 2 deletion, ruling 1), still reads its
+// locked mode: `ProviderSpecificSettings`, `ProviderSection` and
+// `LanguageSection` (useLockedMode), unmounted at run time but still
+// type-checked. When #578 ports Local Native, delete the file.
 export type LockedFooterMode = 'speaker' | 'participant' | 'both';
 
 interface SessionStore {
@@ -18,29 +17,21 @@
   // Settings panel uses it too to decide which channel sections are
   // editable during the session.
   lockedMode: LockedFooterMode | null;
-  isInitializing: boolean;
 
   // Actions
   setLockedMode: (mode: LockedFooterMode | null) => void;
-  setIsInitializing: (initializing: boolean) => void;
 }
 
 const useSessionStore = create<SessionStore>()(
   subscribeWithSelector((set) => ({
     // Initial state
     lockedMode: null,
-    isInitializing: false,
 
     // Setters
     setLockedMode: (mode) => set({ lockedMode: mode }),
-    setIsInitializing: (isInitializing) => set({ isInitializing }),
   }))
 );
 
 export const useLockedMode = () => useSessionStore((state) => state.lockedMode);
-// Named useSessionIsInitializing to avoid colliding with the old MainPanel's
-// local isInitializing state when both were in scope (that local state was
-// deleted in plan 1e-3c).
-export const useSessionIsInitializing = () => useSessionStore((state) => state.isInitializing);
 
 export default useSessionStore;
`````

`src/types/Provider.test.ts`

`````diff t01
diff --git a/src/types/Provider.test.ts b/src/types/Provider.test.ts
--- a/src/types/Provider.test.ts
+++ b/src/types/Provider.test.ts
@@ -1,5 +1,5 @@
 import { describe, it, expect } from "vitest";
-import { Provider, isKizunaManagedProvider, kizunaBaseProvider } from "./Provider";
+import { Provider, isKizunaManagedProvider } from "./Provider";
 
 describe("kizuna-managed provider helpers", () => {
   it("identifies the two relay-managed providers", () => {
@@ -7,9 +7,4 @@
     expect(isKizunaManagedProvider(Provider.KIZUNA_AI_VOLCENGINE_AST2)).toBe(true);
     expect(isKizunaManagedProvider(Provider.OPENAI_TRANSLATE)).toBe(false);
   });
-  it("maps each to its base provider", () => {
-    expect(kizunaBaseProvider(Provider.KIZUNA_AI_OPENAI_TRANSLATE)).toBe(Provider.OPENAI_TRANSLATE);
-    expect(kizunaBaseProvider(Provider.KIZUNA_AI_VOLCENGINE_AST2)).toBe(Provider.VOLCENGINE_AST2);
-    expect(kizunaBaseProvider(Provider.OPENAI)).toBeUndefined();
-  });
 });
`````

`src/types/Provider.ts`

`````diff t01
diff --git a/src/types/Provider.ts b/src/types/Provider.ts
--- a/src/types/Provider.ts
+++ b/src/types/Provider.ts
@@ -26,24 +26,8 @@
  */
 export type ProviderType = Provider.OPENAI | Provider.GEMINI | Provider.PALABRA_AI | Provider.KIZUNA_AI_OPENAI_TRANSLATE | Provider.KIZUNA_AI_VOLCENGINE_AST2 | Provider.KIZUNA_AI_SONIOX | Provider.OPENAI_COMPATIBLE | Provider.OPENAI_TRANSLATE | Provider.OPENAI_LIVE | Provider.VOLCENGINE_AST2 | Provider.LOCAL_INFERENCE | Provider.LOCAL_NATIVE | Provider.SONIOX;
 
-/**
- * OpenAI-compatible providers (providers that use OpenAI-compatible APIs)
- */
~ 10 more removed lines sha256:67cab5e5520d
-}
-
 /** The backend-managed twins: Kizuna AI's own service running on a third-party
- *  engine. Keep in lockstep with isKizunaManagedProvider below — several UI
- *  maps are keyed by this type and tested for exhaustiveness against it. */
+ *  engine. Keep in lockstep with isKizunaManagedProvider below. */
 export type KizunaManagedProvider =
   | Provider.KIZUNA_AI_OPENAI_TRANSLATE
   | Provider.KIZUNA_AI_VOLCENGINE_AST2
@@ -54,10 +38,3 @@
     || p === Provider.KIZUNA_AI_SONIOX;
 }
 
-/** The user-managed base provider whose behavior/UI a kizuna-managed twin reuses. */
-export function kizunaBaseProvider(p: Provider): Provider | undefined {
-  if (p === Provider.KIZUNA_AI_OPENAI_TRANSLATE) return Provider.OPENAI_TRANSLATE;
-  if (p === Provider.KIZUNA_AI_VOLCENGINE_AST2) return Provider.VOLCENGINE_AST2;
-  if (p === Provider.KIZUNA_AI_SONIOX) return Provider.SONIOX;
-  return undefined;
-}
`````

---

### Task 2: OpenAI Live's old code (Wave 1)

OpenAI Live runs on its own definition and adapter since the Stage 2 OpenAI Live plan, and the owner has run it live. Its old client imports OpenAI Realtime's and Translate's old modules, so it goes first among the providers (choice 2). The roadmap's inventory (`:8006-8027`) is taken whole but for what it keeps.

**What goes, and what changes:**
- `OpenAILiveClient.ts` and `OpenAILiveProviderConfig.ts` with their tests; the registration in `ProviderConfigFactory.ts`; `IClient.ts`' `OpenAILiveSessionConfig` and its guard; the `openaiLive` slice, its hooks and its key prefill in `settingsStore.ts` (the keys stay: the table above).
- `speechMode.ts` and its test (ruling C5): no importer since 1e-3c, and its test iterated every old descriptor.
- The extension's `OPENAI_LIVE_SET_HEADERS` / `OPENAI_LIVE_CLEAR_HEADERS` handlers and `openaiLive{Set,Clear}DNRHeaders` (`background.js`), with the case of `background.wsHeaders.test.ts` that pinned them as left alone. `wsHeaderRule.js`' sweep of the old rule id 4000 stays (Stage 2 OpenAI Live, ruling 11): a profile upgraded from an old build may still hold it; its comment now says the rule's owner is gone.
- `logStore.ts`' old Live event names; `logStore.test.ts`' case for them. The old test tables lose Live's rows (`descriptorRegistry`, `providerOrder`, `localNativeGating`, now Local Native's alone); `providerPath.test.ts`' `OPENAI_LIVE` row stays (ruling C1).
- `mainPanel.openaiLiveConnectionLost`, read only by the old client.
- `src/providers/openai_live/adapter.ts`' header: the old client is "deleted since" (choice 3); `wsHeaderRule.js`' note on the generic Live rule's priority names the client that could leave rule 4000 behind as "the old client, deleted since" (choice 3).

**Files:**
- Delete (6): `src/services/clients/OpenAILiveClient.test.ts`, `src/services/clients/OpenAILiveClient.ts`, `src/services/providers/OpenAILiveProviderConfig.test.ts`, `src/services/providers/OpenAILiveProviderConfig.ts`, `src/services/providers/speechMode.test.ts`, `src/services/providers/speechMode.ts`
- Modify (12, by the blocks below): `extension/background/background.js`, `extension/background/background.wsHeaders.test.ts`, `extension/background/wsHeaderRule.js`, `src/providers/openai_live/adapter.ts`, `src/services/interfaces/IClient.ts`, `src/services/providers/ProviderConfigFactory.ts`, `src/services/providers/descriptorRegistry.test.ts`, `src/services/providers/localNativeGating.test.ts`, `src/services/providers/providerOrder.test.ts`, `src/stores/logStore.test.ts`, `src/stores/logStore.ts`, `src/stores/settingsStore.ts`
- The 30 locale catalogs `src/locales/*/translation.json`, by the key tool (1 keys)

**Interfaces:**
- Consumes: Task 1's shell (it no longer holds a Live branch).
- Produces: no `Provider.OPENAI_LIVE` descriptor in the old registry (the enum value stays, ruling C1); `SessionConfig` without Live's member; `settingsStore` without `openaiLive`, `useOpenAILiveSettings`, `updateOpenAILive`.

- [ ] **Step 1: Delete the files.**

  ```
  git rm -q -- src/services/clients/OpenAILiveClient.test.ts src/services/clients/OpenAILiveClient.ts src/services/providers/OpenAILiveProviderConfig.test.ts src/services/providers/OpenAILiveProviderConfig.ts src/services/providers/speechMode.test.ts src/services/providers/speechMode.ts
  ```

- [ ] **Step 2: Apply the task's diff blocks** (Global Constraints: never by hand).

  ```
  python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/plan-apply.py docs/superpowers/plans/2026-09-30-client-contract-stage2-deletion.md t02
  ```

  Expected: `t02: 12 files changed`, and no other line.

- [ ] **Step 3: Remove the locale keys only the deleted code read.**

  ```
  node /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/drop-locale-keys.mjs . mainPanel.openaiLiveConnectionLost
  ```

  Expected: `1 keys removed from 30 catalogs`.

- [ ] **Step 4: Check that nothing reaches what went.**

  ```
  git grep -nE "from '[^']*/(OpenAILiveClient|OpenAILiveProviderConfig|speechMode)'|OPENAI_LIVE_(SET|CLEAR)_HEADERS|openaiLive(Set|Clear)DNRHeaders|now unreachable" -- src extension electron
  ```

  Expected: nothing (exit status 1).

- [ ] **Step 5: Run the gates.** Each command as its own call; every expected number is the replay's.

  - `npx vitest run src`: **579 files passed and 1 skipped (580); 7 520 tests passed and 2 skipped (7 522)**; 0 failed, no unhandled errors.
  - `npx vitest run electron`: 34 files, 477 tests passed. `npx vitest run extension`: 9 files, 55 tests passed.
  - Local Native's old path: `npx vitest run src/services src/lib/local-inference/native src/components/Settings/sections/Native src/components/Settings/engine/useNativeEngineAdapter src/stores/nativeModelStore src/stores/settingsStore` — 77 files, 1 385 tests passed.
  - The typecheck, as a set: `npx tsc --noEmit -p tsconfig.json > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t02.txt`, then `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t01.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t02.txt` prints exactly `before 255 after 255; new 0; gone 0` and exits 0 — no error the task before did not have; `after 255` is the full tree's count.
  - `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh | diff - /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` prints nothing: the baseline's 18 lines, unchanged.

- [ ] **Step 6: Commit.**

```bash
git add -- extension/background/background.js extension/background/background.wsHeaders.test.ts extension/background/wsHeaderRule.js src/providers/openai_live/adapter.ts src/services/interfaces/IClient.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/localNativeGating.test.ts src/services/providers/providerOrder.test.ts src/stores/logStore.test.ts src/stores/logStore.ts src/stores/settingsStore.ts 'src/locales/*/translation.json'
```

```bash
git commit -q -F - -- src/services/clients/OpenAILiveClient.test.ts src/services/clients/OpenAILiveClient.ts src/services/providers/OpenAILiveProviderConfig.test.ts src/services/providers/OpenAILiveProviderConfig.ts src/services/providers/speechMode.test.ts src/services/providers/speechMode.ts extension/background/background.js extension/background/background.wsHeaders.test.ts extension/background/wsHeaderRule.js src/providers/openai_live/adapter.ts src/services/interfaces/IClient.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/localNativeGating.test.ts src/services/providers/providerOrder.test.ts src/stores/logStore.test.ts src/stores/logStore.ts src/stores/settingsStore.ts 'src/locales/*/translation.json' <<'EOF'
refactor(openai-live): delete the old OpenAI Live code

The owner has run the new OpenAI Live provider live. Delete its old
client, descriptor, slice and key prefill, the extension's old header
pair, the old event names, speechMode.ts (no importer since 1e-3c), and
the one locale key only the old client read. The startup sweep of the
old rule id stays for profiles upgraded from an old build.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

**The blocks** (`t02`, one per file, in the order the applier takes them):

`extension/background/background.js`

`````diff t02
diff --git a/extension/background/background.js b/extension/background/background.js
--- a/extension/background/background.js
+++ b/extension/background/background.js
@@ -384,69 +384,6 @@
   }
 }
 
-// ─── OpenAI Live declarativeNetRequest header injection ────────────────────
-// Like the Volcengine functions, these chain through the shared dnrUpdatePromise
-// to serialize updates. The rule is scoped to the Live path so it never touches
~ 58 more removed lines sha256:34684ea30239
-}
-
 // ─── Generic WebSocket upgrade header rules ─────────────────────────────────
 // One message pair for every provider whose upgrade needs a header a browser
 // cannot set (wsHeaderRule.js): a rule per host and path, scoped to the
@@ -629,27 +566,6 @@
     return true;
   }
 
-  // Handle OpenAI Live DNR header injection
-  if (message.type === 'OPENAI_LIVE_SET_HEADERS') {
-    openaiLiveSetDNRHeaders(message.apiKey)
~ 16 more removed lines sha256:0b0dd49e1aeb
-  }
-
   // Generic WebSocket upgrade header rules: from the extension's own pages alone.
   if (message.type === 'WS_HEADERS_SET' || message.type === 'WS_HEADERS_CLEAR') {
     if (!isExtensionPage(sender, chrome.runtime.id, chrome.runtime.getURL(''))) {
`````

`extension/background/background.wsHeaders.test.ts`

`````diff t02
diff --git a/extension/background/background.wsHeaders.test.ts b/extension/background/background.wsHeaders.test.ts
--- a/extension/background/background.wsHeaders.test.ts
+++ b/extension/background/background.wsHeaders.test.ts
@@ -53,10 +53,4 @@
     expect(background).toContain('chrome.runtime.onStartup.addListener(() => { void wsHeadersSweep(); });');
     expect(background).toContain('chrome.runtime.onInstalled.addListener(() => { void wsHeadersSweep(); });');
   });
-
-  it("leaves the old OpenAI Live pair as it was: it goes with the old client", () => {
-    expect(background).toContain("if (message.type === 'OPENAI_LIVE_SET_HEADERS') {");
-    expect(background).toContain("if (message.type === 'OPENAI_LIVE_CLEAR_HEADERS') {");
-    expect(background).toContain('const OPENAI_LIVE_DNR_RULE_ID = 4000;');
-  });
 });
`````

`extension/background/wsHeaderRule.js`

`````diff t02
diff --git a/extension/background/wsHeaderRule.js b/extension/background/wsHeaderRule.js
--- a/extension/background/wsHeaderRule.js
+++ b/extension/background/wsHeaderRule.js
@@ -39,10 +39,11 @@
 }
 
 /**
- * The old OpenAI Live client's rule (`OPENAI_LIVE_DNR_RULE_ID` in
- * background.js): the same filter, the same initiator. One its client left
- * behind would hold an old key and reach the new upgrade, so the sweep takes it
- * too (Stage 2 OpenAI Live, ruling 11).
+ * The old OpenAI Live client's rule id, gone from background.js with that
+ * client (Stage 2 deletion, ruling 2): the same filter, the same initiator.
+ * One a profile upgraded from an old build still holds would carry an old key
+ * and reach the new upgrade, so the sweep takes it too (Stage 2 OpenAI Live,
+ * ruling 11).
  */
 export const OLD_LIVE_RULE_ID = 4000;
 
@@ -81,8 +82,8 @@
   if (id === undefined) return null;
   return {
     id,
-    // Above the old Live rule (4000) at the same filter (`||api.openai.com/v1/live/`), so a leftover of it — left by a client
-    // now unreachable — never supplies the key; nothing else competes at this filter (Stage 2 OpenAI Live, ruling 11).
+    // Above the old Live rule (4000) at the same filter (`||api.openai.com/v1/live/`), so a leftover of it — left by the old
+    // client, deleted since — never supplies the key; nothing else competes at this filter (Stage 2 OpenAI Live, ruling 11).
     priority: 2,
     action: {
       type: 'modifyHeaders',
`````

`src/providers/openai_live/adapter.ts`

`````diff t02
diff --git a/src/providers/openai_live/adapter.ts b/src/providers/openai_live/adapter.ts
--- a/src/providers/openai_live/adapter.ts
+++ b/src/providers/openai_live/adapter.ts
@@ -1,7 +1,7 @@
 /**
  * OpenAI Live on the new contract (spec: "L0 — the client contract"), ported
- * from `OpenAILiveClient` (`src/services/clients/`, compiled until the
- * deletion after the live test) without its items, ids, karaoke bookkeeping
+ * from `OpenAILiveClient` (`src/services/clients/`, deleted since)
+ * without its items, ids, karaoke bookkeeping
  * or segmentation stage: one leg, one WebSocket to the Live endpoint, opened
  * through the header seam with a Bearer header and no `Origin` (F14; ruling
  * 7). The start resolves on `session.started`, within a bound, and a refused
`````

`src/services/interfaces/IClient.ts`

`````diff t02
diff --git a/src/services/interfaces/IClient.ts b/src/services/interfaces/IClient.ts
--- a/src/services/interfaces/IClient.ts
+++ b/src/services/interfaces/IClient.ts
@@ -138,20 +138,6 @@
   // in a session config.
 }
 
-/**
- * GPT-Live-1 interpreter session (Live API primary WebSocket). Every field is
- * fixed at session.start; `instructions` is the rendered interpreter template
~ 9 more removed lines sha256:bd24fa218e8b
-}
-
 /**
  * Gemini-specific session configuration
  */
@@ -318,7 +304,7 @@
 /**
  * Union type for all possible session configurations
  */
-export type SessionConfig = OpenAISessionConfig | OpenAITranslateSessionConfig | OpenAILiveSessionConfig | GeminiSessionConfig | PalabraAISessionConfig | VolcengineAST2SessionConfig | SonioxSessionConfig | LocalInferenceSessionConfig | LocalNativeSessionConfig;
+export type SessionConfig = OpenAISessionConfig | OpenAITranslateSessionConfig | GeminiSessionConfig | PalabraAISessionConfig | VolcengineAST2SessionConfig | SonioxSessionConfig | LocalInferenceSessionConfig | LocalNativeSessionConfig;
 
 /**
  * Type guards for session configurations
@@ -334,10 +320,6 @@
   return config.provider === 'openai_translate';
 }
 
-export function isOpenAILiveSessionConfig(config: SessionConfig): config is OpenAILiveSessionConfig {
-  return config.provider === 'openai_live';
-}
-
 export function isGeminiSessionConfig(config: SessionConfig): config is GeminiSessionConfig {
   return config.provider === 'gemini';
 }
`````

`src/services/providers/ProviderConfigFactory.ts`

`````diff t02
diff --git a/src/services/providers/ProviderConfigFactory.ts b/src/services/providers/ProviderConfigFactory.ts
--- a/src/services/providers/ProviderConfigFactory.ts
+++ b/src/services/providers/ProviderConfigFactory.ts
@@ -4,7 +4,6 @@
 import { GeminiProviderConfig } from './GeminiProviderConfig';
 import { OpenAICompatibleProviderConfig } from './OpenAICompatibleProviderConfig';
 import { OpenAITranslateProviderConfig } from './OpenAITranslateProviderConfig';
-import { OpenAILiveProviderConfig } from './OpenAILiveProviderConfig';
 import { PalabraAIProviderConfig } from './PalabraAIProviderConfig';
 import { KizunaAIOpenAITranslateProviderConfig } from './KizunaAIOpenAITranslateProviderConfig';
 import { KizunaAIVolcengineAST2ProviderConfig } from './KizunaAIVolcengineAST2ProviderConfig';
@@ -58,16 +57,9 @@
       ProviderConfigFactory.configs.set(Provider.VOLCENGINE_AST2, new VolcengineAST2ProviderConfig());
     }
 
-    // 5. The three OpenAI providers: Realtime, Translate, Live.
+    // 5. The OpenAI providers: Realtime, Translate.
     ProviderConfigFactory.configs.set(Provider.OPENAI, new OpenAIProviderConfig());
     ProviderConfigFactory.configs.set(Provider.OPENAI_TRANSLATE, new OpenAITranslateProviderConfig());
-    // OpenAI Live (gpt-live-1) — the Live WebSocket needs an Authorization
-    // header on the upgrade, which only Electron (webRequest) and the
-    // extension (declarativeNetRequest) can inject. The web build has no way
-    // to, so the provider is not offered there.
-    if (isElectron() || isExtension()) {
-      ProviderConfigFactory.configs.set(Provider.OPENAI_LIVE, new OpenAILiveProviderConfig());
-    }
 
     // 6. Soniox speech-to-speech translation — always available (BYOK).
     ProviderConfigFactory.configs.set(Provider.SONIOX, new SonioxProviderConfig());
`````

`src/services/providers/descriptorRegistry.test.ts`

`````diff t02
diff --git a/src/services/providers/descriptorRegistry.test.ts b/src/services/providers/descriptorRegistry.test.ts
--- a/src/services/providers/descriptorRegistry.test.ts
+++ b/src/services/providers/descriptorRegistry.test.ts
@@ -26,7 +26,6 @@
 import { defaultOpenAISettings } from './OpenAIProviderConfig';
 import { defaultOpenAICompatibleSettings } from './OpenAICompatibleProviderConfig';
 import { defaultOpenAITranslateSettings } from './OpenAITranslateProviderConfig';
-import { defaultOpenAILiveSettings } from './OpenAILiveProviderConfig';
 import { defaultGeminiSettings } from './GeminiProviderConfig';
 import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
 import { defaultVolcengineAST2Settings } from './VolcengineAST2ProviderConfig';
@@ -46,7 +45,6 @@
   openai: defaultOpenAISettings,
   openaiCompatible: defaultOpenAICompatibleSettings,
   openaiTranslate: defaultOpenAITranslateSettings,
-  openaiLive: defaultOpenAILiveSettings,
   gemini: defaultGeminiSettings,
   palabraai: defaultPalabraAISettings,
   volcengineAST2: defaultVolcengineAST2Settings,
@@ -61,7 +59,7 @@
 describe('provider registry descriptors', () => {
   it('returns a descriptor for every available provider', () => {
     const ids = ProviderConfigFactory.getAvailableProviders();
-    expect(ids.length).toBe(13);
+    expect(ids.length).toBe(12);
     for (const id of ids) {
       const d = ProviderConfigFactory.getDescriptor(id);
       expect(d.getConfig().id).toBe(id);
@@ -217,7 +215,6 @@
     // Expected wire tags (kizuna twins reuse their base tag; compatible uses 'openai').
     const wireTag: Record<string, string> = {
       openai: 'openai', openai_compatible: 'openai', openai_translate: 'openai_translate',
-      openai_live: 'openai_live',
       gemini: 'gemini', palabraai: 'palabraai',
       volcengine_ast2: 'volcengine_ast2', local_inference: 'local_inference',
       local_native: 'local_native',
@@ -269,18 +266,19 @@
   // Exact expected settingsSliceKey per provider. A typo'd slice key (e.g. a
   // provider silently falling back to a differently-cased or misspelled key)
   // must fail this table lookup loudly, not just pass a generic typeof check.
-  const EXPECTED_SLICE_KEYS: Record<Provider, string> = {
+  // Partial: the enum keeps ids whose old descriptors are gone (Stage 2
+  // deletion, ruling C1), so every table below names only the providers the
+  // old registry still registers.
+  const EXPECTED_SLICE_KEYS: Partial<Record<Provider, string>> = {
     [Provider.OPENAI]: 'openai',
     [Provider.OPENAI_COMPATIBLE]: 'openaiCompatible',
     [Provider.OPENAI_TRANSLATE]: 'openaiTranslate',
-    [Provider.OPENAI_LIVE]: 'openaiLive',
     [Provider.GEMINI]: 'gemini',
     [Provider.PALABRA_AI]: 'palabraai',
     [Provider.VOLCENGINE_AST2]: 'volcengineAST2',
     [Provider.LOCAL_INFERENCE]: 'localInference',
-    // Registered only under Electron (isElectron() gate), so the availability
-    // loops below never see it in jsdom — the row satisfies Record<Provider,…>
-    // completeness and documents the expected key.
+    // Registered only under Electron with its gate on — both forced on by
+    // this file's environment mock.
     [Provider.LOCAL_NATIVE]: 'localNative',
     [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: 'kizunaOpenaiTranslate',
     [Provider.KIZUNA_AI_VOLCENGINE_AST2]: 'kizunaVolcengineAst2',
@@ -300,11 +298,10 @@
   // the kizuna OpenAI-translate twin extends OpenAITranslateProviderConfig
   // but always routes through the WebSocket relay, so it must report false —
   // see KizunaAIOpenAITranslateProviderConfig for why).
-  const EXPECTED_SUPPORTS_WEBRTC: Record<Provider, boolean> = {
+  const EXPECTED_SUPPORTS_WEBRTC: Partial<Record<Provider, boolean>> = {
     [Provider.OPENAI]: true,
     [Provider.OPENAI_COMPATIBLE]: true,
     [Provider.OPENAI_TRANSLATE]: true,
-    [Provider.OPENAI_LIVE]: false,
     [Provider.GEMINI]: false,
     [Provider.PALABRA_AI]: false,
     [Provider.VOLCENGINE_AST2]: false,
@@ -343,7 +340,7 @@
 });
 
 describe('S1 capability flags', () => {
-  const PUSH_GATED: Record<Provider, string[] | undefined> = {
+  const PUSH_GATED: Partial<Record<Provider, string[] | undefined>> = {
     [Provider.OPENAI]: ['Disabled', 'Push-to-Translate'],
     [Provider.OPENAI_COMPATIBLE]: ['Disabled', 'Push-to-Translate'], // inherited from OpenAI via ...base
     [Provider.GEMINI]: ['Push-to-Talk', 'Push-to-Translate'],
@@ -352,21 +349,19 @@
     [Provider.VOLCENGINE_AST2]: ['Push-to-Talk', 'Push-to-Translate'],
     [Provider.KIZUNA_AI_VOLCENGINE_AST2]: ['Push-to-Talk', 'Push-to-Translate'], // twin spread
     [Provider.OPENAI_TRANSLATE]: undefined,
-    [Provider.OPENAI_LIVE]: undefined,
     [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: undefined,
     [Provider.SONIOX]: undefined,
     [Provider.KIZUNA_AI_SONIOX]: undefined,
     [Provider.PALABRA_AI]: undefined,
   };
 
-  const TEXT_INPUT: Record<Provider, boolean | undefined> = {
+  const TEXT_INPUT: Partial<Record<Provider, boolean | undefined>> = {
     [Provider.OPENAI]: true,
     [Provider.OPENAI_COMPATIBLE]: true, // inherited
     [Provider.GEMINI]: true,
     [Provider.LOCAL_INFERENCE]: true,
     [Provider.LOCAL_NATIVE]: true,
     [Provider.OPENAI_TRANSLATE]: undefined,
-    [Provider.OPENAI_LIVE]: undefined,
     [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: undefined,
     [Provider.SONIOX]: undefined,
     [Provider.KIZUNA_AI_SONIOX]: undefined,
@@ -378,7 +373,7 @@
   const QUEUES_TEXT: Provider[] = [Provider.OPENAI, Provider.OPENAI_COMPATIBLE];
   const LOCAL_PROMPT: Provider[] = [Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE];
 
-  const PTT_FINALIZATION: Record<Provider, { silenceTailFrames?: number; response: string } | undefined> = {
+  const PTT_FINALIZATION: Partial<Record<Provider, { silenceTailFrames?: number; response: string } | undefined>> = {
     [Provider.LOCAL_INFERENCE]: { silenceTailFrames: 7, response: 'always' },
     [Provider.LOCAL_NATIVE]: { silenceTailFrames: 7, response: 'always' },
     [Provider.VOLCENGINE_AST2]: { silenceTailFrames: 5, response: 'server-decides' },
@@ -387,7 +382,6 @@
     [Provider.OPENAI]: undefined,
     [Provider.OPENAI_COMPATIBLE]: undefined,
     [Provider.OPENAI_TRANSLATE]: undefined,
-    [Provider.OPENAI_LIVE]: undefined,
     [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: undefined,
     [Provider.SONIOX]: undefined,
     [Provider.KIZUNA_AI_SONIOX]: undefined,
@@ -396,13 +390,10 @@
 
   // The segmentation offer of every provider, resolved — the default already
   // filled in — because that is the answer the mode resolvers act on. This
-  // table IS the specification (segmentation design, Amendment A2): a
-  // provider added later inherits the default, and the only place that shows
-  // up is the row this Record forces whoever adds it to write.
-  const SEGMENTATION: Record<Provider, SegmentationOffer> = {
+  // table IS the specification (segmentation design, Amendment A2).
+  const SEGMENTATION: Partial<Record<Provider, SegmentationOffer>> = {
     // Their own silence timers cut the bubble, and the user tunes them, so
     // Auto here would be the pause mode wearing another name.
-    [Provider.OPENAI_LIVE]: { pause: true, auto: false, sizes: true },
     [Provider.OPENAI_TRANSLATE]: { pause: true, auto: false, sizes: true },
     [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: { pause: true, auto: false, sizes: true }, // twin spread
     [Provider.GEMINI]: { pause: true, auto: false, sizes: true },
@@ -441,14 +432,13 @@
   // without turn detection it renders nothing and must not claim to. A2 moved
   // the two pause clients' sliders into the segmentation section, which is
   // what emptied it on OpenAI Live and OpenAI Translate.
-  const SILENCE_DURATION: Record<Provider, boolean> = {
+  const SILENCE_DURATION: Partial<Record<Provider, boolean>> = {
     [Provider.OPENAI]: true,
     [Provider.OPENAI_COMPATIBLE]: true, // inherited via ...base
     [Provider.VOLCENGINE_AST2]: false,
     [Provider.KIZUNA_AI_VOLCENGINE_AST2]: false, // twin spread
     [Provider.OPENAI_TRANSLATE]: false,
     [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: false, // twin spread
-    [Provider.OPENAI_LIVE]: false,
     [Provider.GEMINI]: false,
     [Provider.PALABRA_AI]: false,
     [Provider.SONIOX]: false,
@@ -548,12 +538,11 @@
     }
   });
 
-  // The private fields each pause client keeps its two timers in. Four
-  // providers offer By pause and their clients name the pair differently —
-  // this map is the only place that knows, so the invariant below can be a
-  // loop rather than four copies of the same assertion.
+  // The private fields each pause client keeps its two timers in. The
+  // providers that offer By pause name the pair differently — this map is the
+  // only place that knows, so the invariant below can be a loop rather than a
+  // copy of the same assertion per provider.
   const PAUSE_FIELDS: Partial<Record<Provider, [source: string, translation: string]>> = {
-    [Provider.OPENAI_LIVE]: ['userSilenceTimeoutMs', 'assistantSilenceTimeoutMs'],
     [Provider.OPENAI_TRANSLATE]: ['userSilenceTimeoutMs', 'assistantSilenceTimeoutMs'],
     [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: ['userSilenceTimeoutMs', 'assistantSilenceTimeoutMs'],
     [Provider.GEMINI]: ['inputSegmentSilenceMs', 'assistantSegmentSilenceMs'],
@@ -745,15 +734,9 @@
     expect(d.reversesDirectionViaSourceLanguage('')).toBe(false);
   });
 
-  it('true for OpenAI Live regardless of model — it has no language fields, so the swapped template is the whole direction', () => {
-    const d = ProviderConfigFactory.getDescriptor(Provider.OPENAI_LIVE);
-    expect(d.reversesDirectionViaSourceLanguage('gpt-live-1')).toBe(true);
-    expect(d.reversesDirectionViaSourceLanguage(undefined)).toBe(true);
-  });
-
   it('false for every other descriptor, any model', () => {
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
-      if ([Provider.SONIOX, Provider.KIZUNA_AI_SONIOX, Provider.GEMINI, Provider.OPENAI_LIVE].includes(id)) continue;
+      if ([Provider.SONIOX, Provider.KIZUNA_AI_SONIOX, Provider.GEMINI].includes(id)) continue;
       const d = ProviderConfigFactory.getDescriptor(id);
       expect(d.reversesDirectionViaSourceLanguage(TRANSLATE), `${id}`).toBe(false);
       expect(d.reversesDirectionViaSourceLanguage(undefined), `${id}`).toBe(false);
`````

`src/services/providers/localNativeGating.test.ts`

`````diff t02
diff --git a/src/services/providers/localNativeGating.test.ts b/src/services/providers/localNativeGating.test.ts
--- a/src/services/providers/localNativeGating.test.ts
+++ b/src/services/providers/localNativeGating.test.ts
@@ -1,36 +1,21 @@
 import { describe, it, expect, vi } from 'vitest';
-// Disabled-path coverage for the VITE_ENABLE_LOCAL_NATIVE gate: force every other
-// flag on but isLocalNativeEnabled() off, so the registry is built exactly as a
-// production build (flag unset) would build it. Lives in its own file because each
-// test file gets an isolated module registry — the factory's static block runs once
-// under this mock, whereas descriptorRegistry.test.ts pins the enabled path.
+// Disabled-path coverage for the VITE_ENABLE_LOCAL_NATIVE gate: on Electron,
+// with isLocalNativeEnabled() off, as a production build (flag unset) builds
+// the registry. Lives in its own file because each test file gets an isolated
+// module registry — the factory's static block runs once under this mock,
+// whereas descriptorRegistry.test.ts pins the enabled path. Local Native is
+// the one provider the old registry keeps (Stage 2 deletion, ruling 1).
 vi.mock('../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
-  isKizunaAIEnabled: () => true,
-  // Explicit: each managed provider is gated on its own now, and this mock's
-  // promise is that EVERY provider gate is forced on.
-  isKizunaSonioxEnabled: () => true,
-  isKizunaOpenAITranslateEnabled: () => true,
-  isKizunaVolcengineAST2Enabled: () => true,
-  isPalabraAIEnabled: () => true,
-  isVolcengineAST2Enabled: () => true,
   isLocalNativeEnabled: () => false,
   isElectron: () => true,
   isExtension: () => false,
-  getRelayWsUrl: () => 'wss://r.example/v1',
 }));
 import { ProviderConfigFactory } from './ProviderConfigFactory';
 import { Provider } from '../../types/Provider';
 
 describe('LOCAL_NATIVE feature-flag gating (disabled path)', () => {
-  it('omits LOCAL_NATIVE when the flag is off but keeps the other Electron providers', () => {
-    const ids = ProviderConfigFactory.getAvailableProviders();
-    expect(ids).not.toContain(Provider.LOCAL_NATIVE);
-    // OPENAI_COMPATIBLE and VOLCENGINE_AST2 are Electron-gated but not behind the
-    // Local Native flag, so they must remain registered.
-    expect(ids).toContain(Provider.OPENAI_COMPATIBLE);
-    expect(ids).toContain(Provider.VOLCENGINE_AST2);
-    // One fewer than the 13 in descriptorRegistry.test.ts (which forces the flag on).
-    expect(ids.length).toBe(12);
+  it('omits LOCAL_NATIVE when the flag is off, even on Electron', () => {
+    expect(ProviderConfigFactory.getAvailableProviders()).not.toContain(Provider.LOCAL_NATIVE);
   });
 });
`````

`src/services/providers/providerOrder.test.ts`

`````diff t02
diff --git a/src/services/providers/providerOrder.test.ts b/src/services/providers/providerOrder.test.ts
--- a/src/services/providers/providerOrder.test.ts
+++ b/src/services/providers/providerOrder.test.ts
@@ -43,7 +43,6 @@
       Provider.VOLCENGINE_AST2,
       Provider.OPENAI,
       Provider.OPENAI_TRANSLATE,
-      Provider.OPENAI_LIVE,
       Provider.SONIOX,
       Provider.OPENAI_COMPATIBLE,
       Provider.PALABRA_AI,
`````

`src/stores/logStore.test.ts`

`````diff t02
diff --git a/src/stores/logStore.test.ts b/src/stores/logStore.test.ts
--- a/src/stores/logStore.test.ts
+++ b/src/stores/logStore.test.ts
@@ -46,23 +46,6 @@
     expect(speaker[0].groupingKey).toBe('input_audio_buffer');
   });
 
-  // The Live API names the same microphone stream `session.input_audio.append`
-  // (no `_buffer`); one entry per frame drowned the panel in a real session.
-  it('collapses the Live wire name for mic appends under the same key', () => {
~ 12 more removed lines sha256:ca299da4bc6d
-  });
-
   // A session nobody speaks in sends nothing but mic appends, and they all
   // share one groupingKey, so they land in ONE entry for as long as the silence
   // lasts. Uncapped, that entry grew for the whole session and every append
`````

`src/stores/logStore.ts`

`````diff t02
diff --git a/src/stores/logStore.ts b/src/stores/logStore.ts
--- a/src/stores/logStore.ts
+++ b/src/stores/logStore.ts
@@ -74,11 +74,9 @@
     | 'session.input_audio_buffer.append'
     | 'conversation.item.create' | 'conversation.item.truncate' | 'conversation.item.delete'
     | 'response.create' | 'response.cancel'
-    // OpenAI Live (gpt-live-1) client events — the primary WebSocket's
-    // session.start/session.close handshake and its own audio-append name
-    // (distinct from the Realtime API's input_audio_buffer.append)
-    | 'session.start' | 'session.close' | 'session.close_timeout'
-    | 'session.input_audio.append'
+    // OpenAI Live (gpt-live-1) — the primary WebSocket's session.start /
+    // session.close handshake
+    | 'session.start' | 'session.close'
     | 'session.connection_lost'
     // openai-realtime-api custom events (for beta clients)
     | 'conversation.item.appended' | 'conversation.item.completed'
@@ -381,10 +379,9 @@
       let groupingKey: string | undefined;
       
       // OpenAI-specific grouping. The translate API prefixes the same wire
-      // event with `session.`, and the Live API names it without `_buffer`;
-      // all three are the microphone stream, collapsed under one key.
-      if (eventType === 'input_audio_buffer.append' || eventType === 'session.input_audio_buffer.append'
-          || eventType === 'session.input_audio.append') {
+      // event with `session.`; both are the microphone stream, collapsed
+      // under one key.
+      if (eventType === 'input_audio_buffer.append' || eventType === 'session.input_audio_buffer.append') {
         groupingKey = 'input_audio_buffer';
       }
       // For other delta events, group by event type only
`````

`src/stores/settingsStore.ts`

`````diff t02
diff --git a/src/stores/settingsStore.ts b/src/stores/settingsStore.ts
--- a/src/stores/settingsStore.ts
+++ b/src/stores/settingsStore.ts
@@ -41,9 +41,6 @@
   OpenAITranslateSettings, defaultOpenAITranslateSettings,
   LEGACY_TRANSLATE_TRANSCRIPT_MODEL,
 } from '../services/providers/OpenAITranslateProviderConfig';
-import {
-  OpenAILiveSettings, defaultOpenAILiveSettings,
-} from '../services/providers/OpenAILiveProviderConfig';
 import {
   GeminiSettings, defaultGeminiSettings,
 } from '../services/providers/GeminiProviderConfig';
@@ -85,7 +82,7 @@
 
 export type {
   OpenAISettings, OpenAICompatibleSettings, OpenAICompatibleSettingsBase,
-  OpenAITranslateSettings, OpenAILiveSettings, GeminiSettings, PalabraAISettings,
+  OpenAITranslateSettings, GeminiSettings, PalabraAISettings,
   VolcengineAST2Settings, LocalInferenceSettings,
   LocalNativeSettings, SonioxSettings,
 };
@@ -94,7 +91,7 @@
 // getCurrentProviderSettings, resolved dynamically via the active descriptor.
 export type ProviderSettingsUnion =
   | OpenAISettings | GeminiSettings | OpenAICompatibleSettings | PalabraAISettings
-  | OpenAITranslateSettings | OpenAILiveSettings
+  | OpenAITranslateSettings
   | VolcengineAST2Settings | LocalInferenceSettings | LocalNativeSettings | SonioxSettings;
 
 // ==================== Type Definitions ====================
@@ -287,7 +284,6 @@
   openaiCompatible: OpenAICompatibleSettings;
   palabraai: PalabraAISettings;
   openaiTranslate: OpenAITranslateSettings;
-  openaiLive: OpenAILiveSettings;
   volcengineAST2: VolcengineAST2Settings;
   soniox: SonioxSettings;
   kizunaOpenaiTranslate: OpenAITranslateSettings;
@@ -417,7 +413,6 @@
   updateOpenAICompatible: (settings: Partial<OpenAICompatibleSettings>) => void;
   updatePalabraAI: (settings: Partial<PalabraAISettings>) => void;
   updateOpenAITranslate: (settings: Partial<OpenAITranslateSettings>) => Promise<void>;
-  updateOpenAILive: (settings: Partial<OpenAILiveSettings>) => Promise<void>;
   updateVolcengineAST2: (settings: Partial<VolcengineAST2Settings>) => void;
   updateSoniox: (settings: Partial<SonioxSettings>) => void;
   updateKizunaOpenaiTranslate: (settings: Partial<OpenAITranslateSettings>) => Promise<void>;
@@ -653,7 +648,6 @@
   openaiCompatible: { defaults: defaultOpenAICompatibleSettings, transformPatch: forceWebrtcTurnDetectionOff },
   palabraai: { defaults: defaultPalabraAISettings },
   openaiTranslate: { defaults: defaultOpenAITranslateSettings },
-  openaiLive: { defaults: defaultOpenAILiveSettings },
   volcengineAST2: { defaults: defaultVolcengineAST2Settings },
   soniox: { defaults: defaultSonioxSettings },
   // Relay twins authenticate through the relay with a short-lived Better Auth
@@ -702,7 +696,6 @@
     openaiCompatible: defaultOpenAICompatibleSettings,
     palabraai: defaultPalabraAISettings,
     openaiTranslate: defaultOpenAITranslateSettings,
-    openaiLive: defaultOpenAILiveSettings,
     volcengineAST2: defaultVolcengineAST2Settings,
     soniox: defaultSonioxSettings,
     kizunaOpenaiTranslate: defaultKizunaOpenaiTranslateSettings,
@@ -750,13 +743,12 @@
       const service = ServiceFactory.getSettingsService();
       await service.setSetting('settings.common.provider', provider);
 
-      // Silent prefill: when first switching to OPENAI_TRANSLATE or OPENAI_LIVE
-      // and its key is empty while the OpenAI provider already has one, copy it
-      // across so the user doesn't have to re-paste. After the copy the keys are
+      // Silent prefill: when first switching to OPENAI_TRANSLATE and its key
+      // is empty while the OpenAI provider already has one, copy it across so
+      // the user doesn't have to re-paste. After the copy the keys are
       // independent — later edits to either won't propagate to the other.
       const prefillSlice =
         provider === Provider.OPENAI_TRANSLATE ? 'openaiTranslate'
-        : provider === Provider.OPENAI_LIVE ? 'openaiLive'
         : null;
       if (prefillSlice && !prior[prefillSlice].apiKey && prior.openai.apiKey) {
         const openaiKey = prior.openai.apiKey;
@@ -969,7 +961,6 @@
     updateOpenAICompatible: (settings) => updateProviderSlice(set, 'openaiCompatible', settings),
     updatePalabraAI: (settings) => updateProviderSlice(set, 'palabraai', settings),
     updateOpenAITranslate: (settings) => updateProviderSlice(set, 'openaiTranslate', settings),
-    updateOpenAILive: (settings) => updateProviderSlice(set, 'openaiLive', settings),
     updateVolcengineAST2: (settings) => updateProviderSlice(set, 'volcengineAST2', settings),
     updateSoniox: (settings) => updateProviderSlice(set, 'soniox', settings),
     updateKizunaOpenaiTranslate: (settings) => updateProviderSlice(set, 'kizunaOpenaiTranslate', settings),
@@ -1194,10 +1185,6 @@
                   // no `model` field, so the auto-select is intentionally
                   // a no-op here.
                   break;
-                case Provider.OPENAI_LIVE:
-                  // Live runs the fixed gpt-live-1; the slice has no `model`
-                  // field, so there is nothing to auto-select.
-                  break;
               }
               console.info(`[Sokuji] Model "${currentModel || '(empty)'}" not available, auto-selected "${latestModel}"`);
             }
@@ -1537,7 +1524,6 @@
 export const useOpenAICompatibleSettings = () => useSettingsStore((state) => state.openaiCompatible);
 export const usePalabraAISettings = () => useSettingsStore((state) => state.palabraai);
 export const useOpenAITranslateSettings = () => useSettingsStore((state) => state.openaiTranslate);
-export const useOpenAILiveSettings = () => useSettingsStore((state) => state.openaiLive);
 export const useVolcengineAST2Settings = () => useSettingsStore((state) => state.volcengineAST2);
 export const useSonioxSettings = () => useSettingsStore((state) => state.soniox);
 export const useKizunaOpenaiTranslateSettings = () => useSettingsStore((state) => state.kizunaOpenaiTranslate);
@@ -1621,7 +1607,6 @@
 export const useUpdateOpenAICompatible = () => useSettingsStore((state) => state.updateOpenAICompatible);
 export const useUpdatePalabraAI = () => useSettingsStore((state) => state.updatePalabraAI);
 export const useUpdateOpenAITranslate = () => useSettingsStore((state) => state.updateOpenAITranslate);
-export const useUpdateOpenAILive = () => useSettingsStore((state) => state.updateOpenAILive);
 export const useUpdateVolcengineAST2 = () => useSettingsStore((state) => state.updateVolcengineAST2);
 export const useUpdateSoniox = () => useSettingsStore((state) => state.updateSoniox);
 export const useUpdateKizunaOpenaiTranslate = () => useSettingsStore((state) => state.updateKizunaOpenaiTranslate);
`````

---

### Task 3: OpenAI Translate's relay twin (Wave 1)

`kizunaai_openai_translate` was deleted, not ported (the owner's ruling, recorded by the Stage 2 OpenAI Translate plan: user audio must not flow through Kizuna). Its old descriptor extends the own-key one, so it goes before Task 7. The roadmap's T2 inventory (`:4386-4399`) is taken whole.

**What goes, and what changes:**
- `KizunaAIOpenAITranslateProviderConfig.ts`; its registration and `getDefaultManagedProvider`'s entry; `Provider.KIZUNA_AI_OPENAI_TRANSLATE` and the managed helpers' case (ruling C1); the `kizunaOpenaiTranslate` slice (its keys stay on disk, unread: a stored selection of the twin still resolves through `MANAGED_LEGACY_IDS`, untouched).
- `isKizunaOpenAITranslateEnabled` and its forwarding: `environment.ts`, `extension/vite.config.ts`, `build.yml`'s five env blocks, `.env.example` (ruling 6).
- The old test tables' twin rows (`descriptorRegistry`, `kizunaProviderGating`, `providerOrder`, `participantConfig`, `sessionResourcesWiring`, `voicePrepWiring`, `prepareToStart.*`, `ClientFactory`, `ClientOperations`, the `settingsStore` tests, `kizunaProviders`, `Provider.test`) and the wizard tests' flag mocks; `providerPaths.test.ts` names the twin as a cast string.
- `providers.kizunaai_openai_translate.{name,description}` (its `vendor` went in Task 1).

**Files:**
- Delete (1): `src/services/providers/KizunaAIOpenAITranslateProviderConfig.ts`
- Modify (27, by the blocks below): `.env.example`, `.github/workflows/build.yml`, `extension/vite.config.ts`, `src/components/SetupWizard/SetupWizard.test.tsx`, `src/components/SetupWizard/providerPaths.test.ts`, `src/components/SetupWizard/steps/StepCredentials.test.tsx`, `src/lib/setup/providerPath.test.ts`, `src/locales/locales.consistency.test.ts`, `src/services/ClientOperations.test.ts`, `src/services/clients/ClientFactory.test.ts`, `src/services/providers/ProviderConfigFactory.ts`, `src/services/providers/descriptorRegistry.test.ts`, `src/services/providers/kizunaProviderGating.test.ts`, `src/services/providers/participantConfig.test.ts`, `src/services/providers/prepareToStart.kizunaSoniox.test.ts`, `src/services/providers/prepareToStart.local.test.ts`, `src/services/providers/providerOrder.test.ts`, `src/services/providers/sessionResourcesWiring.test.ts`, `src/services/providers/voicePrepWiring.test.ts`, `src/stores/kizunaProviders.test.ts`, `src/stores/settingsStore.kizunaAuth.test.ts`, `src/stores/settingsStore.sliceRegistry.test.ts`, `src/stores/settingsStore.test.ts`, `src/stores/settingsStore.ts`, `src/types/Provider.test.ts`, `src/types/Provider.ts`, `src/utils/environment.ts`
- The 30 locale catalogs `src/locales/*/translation.json`, by the key tool (2 keys)

**Interfaces:**
- Consumes: Task 1 (the shell's twin branches are gone).
- Produces: the relay's last user is Doubao's twin (Task 4); `environment.ts` without `isKizunaOpenAITranslateEnabled`.

- [ ] **Step 1: Delete the files.**

  ```
  git rm -q -- src/services/providers/KizunaAIOpenAITranslateProviderConfig.ts
  ```

- [ ] **Step 2: Apply the task's diff blocks** (Global Constraints: never by hand).

  ```
  python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/plan-apply.py docs/superpowers/plans/2026-09-30-client-contract-stage2-deletion.md t03
  ```

  Expected: `t03: 27 files changed`, and no other line.

- [ ] **Step 3: Remove the locale keys only the deleted code read.**

  ```
  node /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/drop-locale-keys.mjs . providers.kizunaai_openai_translate.description providers.kizunaai_openai_translate.name
  ```

  Expected: `2 keys removed from 30 catalogs`.

- [ ] **Step 4: Check that nothing reaches what went.**

  ```
  git grep -nE "from '[^']*/KizunaAIOpenAITranslateProviderConfig'|isKizunaOpenAITranslateEnabled|KIZUNA_AI_OPENAI_TRANSLATE|VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE" -- src extension electron .github .env.example
  ```

  Expected: nothing (exit status 1).

- [ ] **Step 5: Run the gates.** Each command as its own call; every expected number is the replay's.

  - `npx vitest run src`: **579 files passed and 1 skipped (580); 7 512 tests passed and 2 skipped (7 514)**; 0 failed, no unhandled errors.
  - `npx vitest run electron`: 34 files, 477 tests passed. `npx vitest run extension`: 9 files, 55 tests passed.
  - Local Native's old path: `npx vitest run src/services src/lib/local-inference/native src/components/Settings/sections/Native src/components/Settings/engine/useNativeEngineAdapter src/stores/nativeModelStore src/stores/settingsStore` — 77 files, 1 378 tests passed.
  - The typecheck, as a set: `npx tsc --noEmit -p tsconfig.json > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t03.txt`, then `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t02.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t03.txt` prints exactly `before 255 after 255; new 0; gone 0` and exits 0 — no error the task before did not have; `after 255` is the full tree's count.
  - `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh | diff - /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` prints nothing: the baseline's 18 lines, unchanged.

- [ ] **Step 6: Commit.**

```bash
git add -- .env.example .github/workflows/build.yml extension/vite.config.ts src/components/SetupWizard/SetupWizard.test.tsx src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/steps/StepCredentials.test.tsx src/lib/setup/providerPath.test.ts src/locales/locales.consistency.test.ts src/services/ClientOperations.test.ts src/services/clients/ClientFactory.test.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/kizunaProviderGating.test.ts src/services/providers/participantConfig.test.ts src/services/providers/prepareToStart.kizunaSoniox.test.ts src/services/providers/prepareToStart.local.test.ts src/services/providers/providerOrder.test.ts src/services/providers/sessionResourcesWiring.test.ts src/services/providers/voicePrepWiring.test.ts src/stores/kizunaProviders.test.ts src/stores/settingsStore.kizunaAuth.test.ts src/stores/settingsStore.sliceRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts src/types/Provider.test.ts src/types/Provider.ts src/utils/environment.ts 'src/locales/*/translation.json'
```

```bash
git commit -q -F - -- src/services/providers/KizunaAIOpenAITranslateProviderConfig.ts .env.example .github/workflows/build.yml extension/vite.config.ts src/components/SetupWizard/SetupWizard.test.tsx src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/steps/StepCredentials.test.tsx src/lib/setup/providerPath.test.ts src/locales/locales.consistency.test.ts src/services/ClientOperations.test.ts src/services/clients/ClientFactory.test.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/kizunaProviderGating.test.ts src/services/providers/participantConfig.test.ts src/services/providers/prepareToStart.kizunaSoniox.test.ts src/services/providers/prepareToStart.local.test.ts src/services/providers/providerOrder.test.ts src/services/providers/sessionResourcesWiring.test.ts src/services/providers/voicePrepWiring.test.ts src/stores/kizunaProviders.test.ts src/stores/settingsStore.kizunaAuth.test.ts src/stores/settingsStore.sliceRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts src/types/Provider.test.ts src/types/Provider.ts src/utils/environment.ts 'src/locales/*/translation.json' <<'EOF'
refactor(openai-translate): delete the OpenAI Translate relay twin

The relay twin was deleted, not ported: user audio must not flow
through Kizuna. Delete its descriptor, registration, enum id, slice,
release flag and forwarding, and its locale keys; a stored selection of
it still resolves as before.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

**The blocks** (`t03`, one per file, in the order the applier takes them):

`.env.example`

`````diff t03
diff --git a/.env.example b/.env.example
--- a/.env.example
+++ b/.env.example
@@ -40,7 +40,6 @@
 # offer before tagging it. v0.36.3 shipped with the whole Kizuna family off
 # because the values were set as variables while the workflow read secrets.
 VITE_ENABLE_KIZUNA_SONIOX=false
-VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE=false
 VITE_ENABLE_KIZUNA_VOLCENGINE_AST2=false
 
 # Flagged providers in the new provider registry that a release offers, by id,
`````

`.github/workflows/build.yml`

`````diff t03
diff --git a/.github/workflows/build.yml b/.github/workflows/build.yml
--- a/.github/workflows/build.yml
+++ b/.github/workflows/build.yml
@@ -220,7 +220,6 @@ occurrence 1 of 5
           VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
           VITE_ENABLE_KIZUNA_SONIOX: ${{ vars.VITE_ENABLE_KIZUNA_SONIOX }}
-          VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE: ${{ vars.VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE }}
           VITE_ENABLE_KIZUNA_VOLCENGINE_AST2: ${{ vars.VITE_ENABLE_KIZUNA_VOLCENGINE_AST2 }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
@@ -274,7 +273,6 @@ occurrence 2 of 5
           VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
           VITE_ENABLE_KIZUNA_SONIOX: ${{ vars.VITE_ENABLE_KIZUNA_SONIOX }}
-          VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE: ${{ vars.VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE }}
           VITE_ENABLE_KIZUNA_VOLCENGINE_AST2: ${{ vars.VITE_ENABLE_KIZUNA_VOLCENGINE_AST2 }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
@@ -314,7 +312,6 @@ occurrence 3 of 5
           VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
           VITE_ENABLE_KIZUNA_SONIOX: ${{ vars.VITE_ENABLE_KIZUNA_SONIOX }}
-          VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE: ${{ vars.VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE }}
           VITE_ENABLE_KIZUNA_VOLCENGINE_AST2: ${{ vars.VITE_ENABLE_KIZUNA_VOLCENGINE_AST2 }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
@@ -416,7 +413,6 @@ occurrence 4 of 5
           VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
           VITE_ENABLE_KIZUNA_SONIOX: ${{ vars.VITE_ENABLE_KIZUNA_SONIOX }}
-          VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE: ${{ vars.VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE }}
           VITE_ENABLE_KIZUNA_VOLCENGINE_AST2: ${{ vars.VITE_ENABLE_KIZUNA_VOLCENGINE_AST2 }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
@@ -518,7 +514,6 @@ occurrence 5 of 5
           VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
           VITE_ENABLE_KIZUNA_SONIOX: ${{ vars.VITE_ENABLE_KIZUNA_SONIOX }}
-          VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE: ${{ vars.VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE }}
           VITE_ENABLE_KIZUNA_VOLCENGINE_AST2: ${{ vars.VITE_ENABLE_KIZUNA_VOLCENGINE_AST2 }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
`````

`extension/vite.config.ts`

`````diff t03
diff --git a/extension/vite.config.ts b/extension/vite.config.ts
--- a/extension/vite.config.ts
+++ b/extension/vite.config.ts
@@ -172,9 +172,6 @@
       'import.meta.env.VITE_ENABLE_KIZUNA_SONIOX': JSON.stringify(
         envVal('VITE_ENABLE_KIZUNA_SONIOX', 'false', 'true')
       ),
-      'import.meta.env.VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE': JSON.stringify(
-        envVal('VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE', 'false', 'true')
-      ),
       'import.meta.env.VITE_ENABLE_KIZUNA_VOLCENGINE_AST2': JSON.stringify(
         envVal('VITE_ENABLE_KIZUNA_VOLCENGINE_AST2', 'false', 'true')
       ),
`````

`src/components/SetupWizard/SetupWizard.test.tsx`

`````diff t03
diff --git a/src/components/SetupWizard/SetupWizard.test.tsx b/src/components/SetupWizard/SetupWizard.test.tsx
--- a/src/components/SetupWizard/SetupWizard.test.tsx
+++ b/src/components/SetupWizard/SetupWizard.test.tsx
@@ -4,7 +4,7 @@
 vi.mock('../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true, isKizunaSonioxEnabled: () => true,
-  isKizunaOpenAITranslateEnabled: () => false, isKizunaVolcengineAST2Enabled: () => false,
+  isKizunaVolcengineAST2Enabled: () => false,
   isPalabraAIEnabled: () => true, isLocalNativeEnabled: () => true,
   isElectron: () => true, isExtension: () => false, getRelayWsUrl: () => 'wss://r.example/v1',
 }));
`````

`src/components/SetupWizard/providerPaths.test.ts`

`````diff t03
diff --git a/src/components/SetupWizard/providerPaths.test.ts b/src/components/SetupWizard/providerPaths.test.ts
--- a/src/components/SetupWizard/providerPaths.test.ts
+++ b/src/components/SetupWizard/providerPaths.test.ts
@@ -4,7 +4,6 @@
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
   isKizunaSonioxEnabled: () => true,
-  isKizunaOpenAITranslateEnabled: () => true,
   isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
@@ -73,7 +72,8 @@
     });
 
     it('refuses a managed record naming a provider this build does not register', () => {
-      expect(offersRecord({ scenario: 'be-heard', providerPath: 'managed', provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE })).toBe(false);
+      // The OpenAI Translate relay twin, deleted (Stage 2 deletion, ruling 2).
+      expect(offersRecord({ scenario: 'be-heard', providerPath: 'managed', provider: 'kizunaai_openai_translate' as Provider })).toBe(false);
     });
 
     it('offers an own-key record for Soniox', () => {
`````

`src/components/SetupWizard/steps/StepCredentials.test.tsx`

`````diff t03
diff --git a/src/components/SetupWizard/steps/StepCredentials.test.tsx b/src/components/SetupWizard/steps/StepCredentials.test.tsx
--- a/src/components/SetupWizard/steps/StepCredentials.test.tsx
+++ b/src/components/SetupWizard/steps/StepCredentials.test.tsx
@@ -4,7 +4,7 @@
 vi.mock('../../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true, isKizunaSonioxEnabled: () => true,
-  isKizunaOpenAITranslateEnabled: () => false, isKizunaVolcengineAST2Enabled: () => false,
+  isKizunaVolcengineAST2Enabled: () => false,
   isPalabraAIEnabled: () => true, isLocalNativeEnabled: () => true,
   isElectron: () => true, isExtension: () => false, getRelayWsUrl: () => 'wss://r.example/v1',
 }));
`````

`src/lib/setup/providerPath.test.ts`

`````diff t03
diff --git a/src/lib/setup/providerPath.test.ts b/src/lib/setup/providerPath.test.ts
--- a/src/lib/setup/providerPath.test.ts
+++ b/src/lib/setup/providerPath.test.ts
@@ -16,7 +16,6 @@
  *  a row for a member the enum no longer has. */
 const EXPECTED: Record<Provider, ProviderPath> = {
   // Backend-managed twins: Kizuna AI holds the key, the user signs in.
-  [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: 'managed',
   [Provider.KIZUNA_AI_VOLCENGINE_AST2]: 'managed',
   [Provider.KIZUNA_AI_SONIOX]: 'managed',
   // Local engines: nothing leaves the machine, models download instead.
`````

`src/locales/locales.consistency.test.ts`

`````diff t03
diff --git a/src/locales/locales.consistency.test.ts b/src/locales/locales.consistency.test.ts
--- a/src/locales/locales.consistency.test.ts
+++ b/src/locales/locales.consistency.test.ts
@@ -7,7 +7,6 @@
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaOpenAITranslateEnabled: () => true,
   isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
`````

`src/services/ClientOperations.test.ts`

`````diff t03
diff --git a/src/services/ClientOperations.test.ts b/src/services/ClientOperations.test.ts
--- a/src/services/ClientOperations.test.ts
+++ b/src/services/ClientOperations.test.ts
@@ -3,16 +3,6 @@
 import { Provider } from '../types/Provider';
 
 describe('ClientOperations — kizuna relay twins do not throw', () => {
-  it('validateApiKeyAndFetchModels resolves valid for the translate twin', async () => {
-    const r = await ClientOperations.validateApiKeyAndFetchModels(
-      'sess_TOKEN',
-      Provider.KIZUNA_AI_OPENAI_TRANSLATE
-    );
-    expect(r.validation.valid).toBe(true);
-    expect(r.validation.validating).toBe(false);
-    expect(r.models.length).toBeGreaterThan(0);
-  });
-
   it('validateApiKeyAndFetchModels resolves valid for the doubao (AST2) twin', async () => {
     const r = await ClientOperations.validateApiKeyAndFetchModels(
       'sess_TOKEN',
@@ -23,10 +13,7 @@
     expect(r.models.length).toBeGreaterThan(0);
   });
 
-  it('getLatestRealtimeModel returns a model string for both twins', () => {
-    expect(
-      ClientOperations.getLatestRealtimeModel([], Provider.KIZUNA_AI_OPENAI_TRANSLATE)
-    ).toBe('gpt-realtime-translate');
+  it('getLatestRealtimeModel returns a model string for the twin', () => {
     expect(
       ClientOperations.getLatestRealtimeModel([], Provider.KIZUNA_AI_VOLCENGINE_AST2)
     ).toBe('ast-v2-s2s');
`````

`src/services/clients/ClientFactory.test.ts`

`````diff t03
diff --git a/src/services/clients/ClientFactory.test.ts b/src/services/clients/ClientFactory.test.ts
--- a/src/services/clients/ClientFactory.test.ts
+++ b/src/services/clients/ClientFactory.test.ts
@@ -5,20 +5,14 @@
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaOpenAITranslateEnabled: () => true,
   isKizunaVolcengineAST2Enabled: () => true,
   getRelayWsUrl: () => "wss://r.example/v1",
 }));
 import { ClientFactory } from "./ClientFactory";
 import { Provider } from "../../types/Provider";
-import { OpenAITranslateGAClient } from "./OpenAITranslateGAClient";
 import { VolcengineAST2Client } from "./VolcengineAST2Client";
 
 describe("ClientFactory kizuna relay providers", () => {
-  it("routes the translate twin to OpenAITranslateGAClient", () => {
-    const c = ClientFactory.createClient("gpt-realtime-translate", Provider.KIZUNA_AI_OPENAI_TRANSLATE, "sess_TOKEN");
-    expect(c).toBeInstanceOf(OpenAITranslateGAClient);
-  });
   it("routes the doubao twin to VolcengineAST2Client", () => {
     const c = ClientFactory.createClient("ast-v2-s2s", Provider.KIZUNA_AI_VOLCENGINE_AST2, "sess_TOKEN");
     expect(c).toBeInstanceOf(VolcengineAST2Client);
`````

`src/services/providers/ProviderConfigFactory.ts`

`````diff t03
diff --git a/src/services/providers/ProviderConfigFactory.ts b/src/services/providers/ProviderConfigFactory.ts
--- a/src/services/providers/ProviderConfigFactory.ts
+++ b/src/services/providers/ProviderConfigFactory.ts
@@ -5,7 +5,6 @@
 import { OpenAICompatibleProviderConfig } from './OpenAICompatibleProviderConfig';
 import { OpenAITranslateProviderConfig } from './OpenAITranslateProviderConfig';
 import { PalabraAIProviderConfig } from './PalabraAIProviderConfig';
-import { KizunaAIOpenAITranslateProviderConfig } from './KizunaAIOpenAITranslateProviderConfig';
 import { KizunaAIVolcengineAST2ProviderConfig } from './KizunaAIVolcengineAST2ProviderConfig';
 import { KizunaAISonioxProviderConfig } from './KizunaAISonioxProviderConfig';
 import { VolcengineAST2ProviderConfig } from './VolcengineAST2ProviderConfig';
@@ -13,7 +12,7 @@
 import { LocalNativeProviderConfig } from './LocalNativeProviderConfig';
 import { SonioxProviderConfig } from './SonioxProviderConfig';
 import { Provider, ProviderType } from '../../types/Provider';
-import { isKizunaAIEnabled, isKizunaSonioxEnabled, isKizunaOpenAITranslateEnabled, isKizunaVolcengineAST2Enabled, isPalabraAIEnabled, isLocalNativeEnabled, isElectron, isExtension } from '../../utils/environment';
+import { isKizunaAIEnabled, isKizunaSonioxEnabled, isKizunaVolcengineAST2Enabled, isPalabraAIEnabled, isLocalNativeEnabled, isElectron, isExtension } from '../../utils/environment';
 
 export class ProviderConfigFactory {
   private static configs: Map<ProviderType, ProviderDescriptor> = new Map();
@@ -36,9 +35,6 @@
       if (isKizunaSonioxEnabled()) {
         ProviderConfigFactory.configs.set(Provider.KIZUNA_AI_SONIOX, new KizunaAISonioxProviderConfig());
       }
-      if (isKizunaOpenAITranslateEnabled()) {
-        ProviderConfigFactory.configs.set(Provider.KIZUNA_AI_OPENAI_TRANSLATE, new KizunaAIOpenAITranslateProviderConfig());
-      }
       if (isKizunaVolcengineAST2Enabled()) {
         ProviderConfigFactory.configs.set(Provider.KIZUNA_AI_VOLCENGINE_AST2, new KizunaAIVolcengineAST2ProviderConfig());
       }
@@ -151,7 +147,6 @@
   static getDefaultManagedProvider(): ProviderType | null {
     const preferred = [
       Provider.KIZUNA_AI_SONIOX,
-      Provider.KIZUNA_AI_OPENAI_TRANSLATE,
       Provider.KIZUNA_AI_VOLCENGINE_AST2,
     ];
     return preferred.find((p) => this.configs.has(p)) ?? null;
`````

`src/services/providers/descriptorRegistry.test.ts`

`````diff t03
diff --git a/src/services/providers/descriptorRegistry.test.ts b/src/services/providers/descriptorRegistry.test.ts
--- a/src/services/providers/descriptorRegistry.test.ts
+++ b/src/services/providers/descriptorRegistry.test.ts
@@ -8,7 +8,6 @@
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaOpenAITranslateEnabled: () => true,
   isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
@@ -21,7 +20,6 @@
 import type { SegmentationOffer } from '../../lib/segmentation/segmentationMode';
 import { DEFAULT_CHUNK_SENTENCES, DEFAULT_SEGMENT_PAUSE_MS } from '../../lib/segmentation/segmentationMode';
 import { Provider } from '../../types/Provider';
-import { OpenAITranslateGAClient } from '../clients/OpenAITranslateGAClient';
 import { VolcengineAST2Client } from '../clients/VolcengineAST2Client';
 import { defaultOpenAISettings } from './OpenAIProviderConfig';
 import { defaultOpenAICompatibleSettings } from './OpenAICompatibleProviderConfig';
@@ -31,7 +29,6 @@
 import { defaultVolcengineAST2Settings } from './VolcengineAST2ProviderConfig';
 import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
 import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
-import { defaultKizunaOpenaiTranslateSettings } from './KizunaAIOpenAITranslateProviderConfig';
 import { defaultKizunaVolcengineAst2Settings } from './KizunaAIVolcengineAST2ProviderConfig';
 import { defaultKizunaSonioxSettings } from './KizunaAISonioxProviderConfig';
 import { defaultSonioxSettings } from './SonioxProviderConfig';
@@ -50,7 +47,6 @@
   volcengineAST2: defaultVolcengineAST2Settings,
   localInference: defaultLocalInferenceSettings,
   localNative: defaultLocalNativeSettings,
-  kizunaOpenaiTranslate: defaultKizunaOpenaiTranslateSettings,
   kizunaVolcengineAst2: defaultKizunaVolcengineAst2Settings,
   kizunaSoniox: defaultKizunaSonioxSettings,
   soniox: defaultSonioxSettings,
@@ -59,7 +55,7 @@
 describe('provider registry descriptors', () => {
   it('returns a descriptor for every available provider', () => {
     const ids = ProviderConfigFactory.getAvailableProviders();
-    expect(ids.length).toBe(12);
+    expect(ids.length).toBe(11);
     for (const id of ids) {
       const d = ProviderConfigFactory.getDescriptor(id);
       expect(d.getConfig().id).toBe(id);
@@ -97,20 +93,13 @@
   it('constructs a client for every available provider', () => {
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
       const client = ProviderConfigFactory.getDescriptor(id).createClient(creds, optionsFor(id));
-      expect(client.getProvider()).toBe(id === Provider.KIZUNA_AI_OPENAI_TRANSLATE ? Provider.OPENAI_TRANSLATE
-        : id === Provider.KIZUNA_AI_VOLCENGINE_AST2 ? Provider.VOLCENGINE_AST2
+      expect(client.getProvider()).toBe(id === Provider.KIZUNA_AI_VOLCENGINE_AST2 ? Provider.VOLCENGINE_AST2
         : id === Provider.KIZUNA_AI_SONIOX ? Provider.SONIOX
         : id === Provider.OPENAI_COMPATIBLE ? Provider.OPENAI
         : id);
     }
   });
 
-  it('kizuna translate twin routes to relay OpenAITranslateGAClient', () => {
-    const c = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_OPENAI_TRANSLATE)
-      .createClient({ ok: true, primary: 'sess_TOKEN' }, ws);
-    expect(c).toBeInstanceOf(OpenAITranslateGAClient);
-  });
-
   it('kizuna doubao twin routes to relay VolcengineAST2Client', () => {
     const c = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_VOLCENGINE_AST2)
       .createClient({ ok: true, primary: 'sess_TOKEN' }, ws);
@@ -142,15 +131,6 @@
     expect(r.models).toEqual([]);
   });
 
-  it('kizuna twins validate statically from a non-empty token', async () => {
-    const d = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
-    const ok = await d.validateAndFetchModels({ ok: true, primary: 'sess_TOKEN' });
-    expect(ok.validation.valid).toBe(true);
-    expect(ok.models[0].id).toBe('gpt-realtime-translate');
-    const bad = await d.validateAndFetchModels({ ok: false, missing: 'Sign in is required for Kizuna relay providers' });
-    expect(bad.validation.valid).toBe(false);
-  });
-
   it('kizuna soniox twin validates statically from a non-empty token', async () => {
     const d = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX);
     const ok = await d.validateAndFetchModels({ ok: true, primary: 'sess_TOKEN' });
@@ -188,14 +168,6 @@
     expect(r).toEqual({ ok: false, missing: 'Both Client ID and Client Secret are required for Palabra AI' });
   });
 
-  it('kizuna twin resolves the auth token from ctx', async () => {
-    const d = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
-    expect(await d.extractCredentials({}, { getAuthToken: async () => 'sess_T' }))
-      .toEqual({ ok: true, primary: 'sess_T' });
-    expect((await d.extractCredentials({}, {})).ok).toBe(false);
-    expect((await d.extractCredentials({}, { getAuthToken: async () => null })).ok).toBe(false);
-  });
-
   it('kizuna soniox twin resolves the auth token from ctx', async () => {
     const d = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX);
     expect(await d.extractCredentials({}, { getAuthToken: async () => 'sess_T' }))
@@ -218,7 +190,7 @@
       gemini: 'gemini', palabraai: 'palabraai',
       volcengine_ast2: 'volcengine_ast2', local_inference: 'local_inference',
       local_native: 'local_native',
-      kizunaai_openai_translate: 'openai_translate', kizunaai_volcengine_ast2: 'volcengine_ast2',
+      kizunaai_volcengine_ast2: 'volcengine_ast2',
       soniox: 'soniox', kizunaai_soniox: 'soniox',
     };
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
@@ -280,7 +252,6 @@
     // Registered only under Electron with its gate on — both forced on by
     // this file's environment mock.
     [Provider.LOCAL_NATIVE]: 'localNative',
-    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: 'kizunaOpenaiTranslate',
     [Provider.KIZUNA_AI_VOLCENGINE_AST2]: 'kizunaVolcengineAst2',
     [Provider.KIZUNA_AI_SONIOX]: 'kizunaSoniox',
     [Provider.SONIOX]: 'soniox',
@@ -294,10 +265,7 @@
   });
 
   // Exact expected supportsWebRTC per provider. Relay/twin and non-WebRTC
-  // providers must not silently inherit `true` from a base descriptor (e.g.
-  // the kizuna OpenAI-translate twin extends OpenAITranslateProviderConfig
-  // but always routes through the WebSocket relay, so it must report false —
-  // see KizunaAIOpenAITranslateProviderConfig for why).
+  // providers must not silently inherit `true` from a base descriptor.
   const EXPECTED_SUPPORTS_WEBRTC: Partial<Record<Provider, boolean>> = {
     [Provider.OPENAI]: true,
     [Provider.OPENAI_COMPATIBLE]: true,
@@ -307,7 +275,6 @@
     [Provider.VOLCENGINE_AST2]: false,
     [Provider.LOCAL_INFERENCE]: false,
     [Provider.LOCAL_NATIVE]: false,
-    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: false,
     [Provider.KIZUNA_AI_VOLCENGINE_AST2]: false,
     [Provider.KIZUNA_AI_SONIOX]: false,
     [Provider.SONIOX]: false,
@@ -349,7 +316,6 @@
     [Provider.VOLCENGINE_AST2]: ['Push-to-Talk', 'Push-to-Translate'],
     [Provider.KIZUNA_AI_VOLCENGINE_AST2]: ['Push-to-Talk', 'Push-to-Translate'], // twin spread
     [Provider.OPENAI_TRANSLATE]: undefined,
-    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: undefined,
     [Provider.SONIOX]: undefined,
     [Provider.KIZUNA_AI_SONIOX]: undefined,
     [Provider.PALABRA_AI]: undefined,
@@ -362,7 +328,6 @@
     [Provider.LOCAL_INFERENCE]: true,
     [Provider.LOCAL_NATIVE]: true,
     [Provider.OPENAI_TRANSLATE]: undefined,
-    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: undefined,
     [Provider.SONIOX]: undefined,
     [Provider.KIZUNA_AI_SONIOX]: undefined,
     [Provider.VOLCENGINE_AST2]: undefined,
@@ -382,7 +347,6 @@
     [Provider.OPENAI]: undefined,
     [Provider.OPENAI_COMPATIBLE]: undefined,
     [Provider.OPENAI_TRANSLATE]: undefined,
-    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: undefined,
     [Provider.SONIOX]: undefined,
     [Provider.KIZUNA_AI_SONIOX]: undefined,
     [Provider.PALABRA_AI]: undefined,
@@ -395,7 +359,6 @@
     // Their own silence timers cut the bubble, and the user tunes them, so
     // Auto here would be the pause mode wearing another name.
     [Provider.OPENAI_TRANSLATE]: { pause: true, auto: false, sizes: true },
-    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: { pause: true, auto: false, sizes: true }, // twin spread
     [Provider.GEMINI]: { pause: true, auto: false, sizes: true },
 
     // 1-5 is what slice 3 shipped on the local engines; phase 2 adds Auto,
@@ -438,7 +401,6 @@
     [Provider.VOLCENGINE_AST2]: false,
     [Provider.KIZUNA_AI_VOLCENGINE_AST2]: false, // twin spread
     [Provider.OPENAI_TRANSLATE]: false,
-    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: false, // twin spread
     [Provider.GEMINI]: false,
     [Provider.PALABRA_AI]: false,
     [Provider.SONIOX]: false,
@@ -544,7 +506,6 @@
   // copy of the same assertion per provider.
   const PAUSE_FIELDS: Partial<Record<Provider, [source: string, translation: string]>> = {
     [Provider.OPENAI_TRANSLATE]: ['userSilenceTimeoutMs', 'assistantSilenceTimeoutMs'],
-    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: ['userSilenceTimeoutMs', 'assistantSilenceTimeoutMs'],
     [Provider.GEMINI]: ['inputSegmentSilenceMs', 'assistantSegmentSilenceMs'],
   };
 
`````

`src/services/providers/kizunaProviderGating.test.ts`

`````diff t03
diff --git a/src/services/providers/kizunaProviderGating.test.ts b/src/services/providers/kizunaProviderGating.test.ts
--- a/src/services/providers/kizunaProviderGating.test.ts
+++ b/src/services/providers/kizunaProviderGating.test.ts
@@ -1,5 +1,5 @@
 /**
- * The three Kizuna-managed providers are released independently, so each one
+ * The Kizuna-managed providers are released independently, so each one
  * carries its OWN gate.
  *
  * They used to share one gate, so `VITE_ENABLE_KIZUNA_AI=true` — the switch
@@ -26,13 +26,11 @@
 interface Gates {
   master?: boolean;
   soniox?: boolean;
-  openaiTranslate?: boolean;
   volcengineAst2?: boolean;
 }
 
 const MANAGED = [
   Provider.KIZUNA_AI_SONIOX,
-  Provider.KIZUNA_AI_OPENAI_TRANSLATE,
   Provider.KIZUNA_AI_VOLCENGINE_AST2,
 ] as const;
 
@@ -44,7 +42,6 @@
     ...(await orig<any>()),
     isKizunaAIEnabled: () => gates.master ?? true,
     isKizunaSonioxEnabled: () => gates.soniox ?? false,
-    isKizunaOpenAITranslateEnabled: () => gates.openaiTranslate ?? false,
     isKizunaVolcengineAST2Enabled: () => gates.volcengineAst2 ?? false,
     isPalabraAIEnabled: () => false,
     isLocalNativeEnabled: () => false,
@@ -74,33 +71,21 @@
     const providers = await providersWith({ soniox: true });
 
     expect(providers).toContain(Provider.KIZUNA_AI_SONIOX);
-    expect(providers).not.toContain(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
     expect(providers).not.toContain(Provider.KIZUNA_AI_VOLCENGINE_AST2);
   });
 
   // The case the shared relay gate could not express: holding Soniox back
   // while another managed provider ships.
   it('holds Soniox back while a relay twin ships', async () => {
-    const providers = await providersWith({ openaiTranslate: true });
-
-    expect(providers).not.toContain(Provider.KIZUNA_AI_SONIOX);
-    expect(providers).toContain(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
-    expect(providers).not.toContain(Provider.KIZUNA_AI_VOLCENGINE_AST2);
-  });
-
-  // The other case it could not express: the two twins were welded together.
-  it('separates the two relay twins from each other', async () => {
     const providers = await providersWith({ volcengineAst2: true });
 
     expect(providers).not.toContain(Provider.KIZUNA_AI_SONIOX);
-    expect(providers).not.toContain(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
     expect(providers).toContain(Provider.KIZUNA_AI_VOLCENGINE_AST2);
   });
 
-  it('offers all three when every gate is open', async () => {
+  it('offers both when every gate is open', async () => {
     const providers = await providersWith({
       soniox: true,
-      openaiTranslate: true,
       volcengineAst2: true,
     });
 
@@ -124,7 +109,6 @@
     const providers = await providersWith({
       master: false,
       soniox: true,
-      openaiTranslate: true,
       volcengineAst2: true,
     });
 
@@ -160,10 +144,9 @@
     expect(() => factory.getDescriptor(target!)).not.toThrow();
   });
 
-  it('prefers managed Soniox where it is registered alongside the twins', async () => {
+  it('prefers managed Soniox where it is registered alongside the twin', async () => {
     const factory = await factoryWith({
       soniox: true,
-      openaiTranslate: true,
       volcengineAst2: true,
     });
     const target = factory.getDefaultManagedProvider();
@@ -172,14 +155,6 @@
     expect(() => factory.getDescriptor(target!)).not.toThrow();
   });
 
-  it('falls back to the Translate twin only when Soniox is not registered', async () => {
-    const factory = await factoryWith({ openaiTranslate: true, volcengineAst2: true });
-    const target = factory.getDefaultManagedProvider();
-
-    expect(target).toBe(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
-    expect(() => factory.getDescriptor(target!)).not.toThrow();
-  });
-
   // Per-provider gating makes a build offering only the AST2 twin possible for
   // the first time; the default has to follow what is registered, not the
   // preference order's first entry.
@@ -226,7 +201,6 @@
   it('sends a legacy user to managed Soniox even where the twins are registered', async () => {
     const { migrateLegacyKizunaProvider, ProviderConfigFactory } = await migrateWith({
       soniox: true,
-      openaiTranslate: true,
       volcengineAst2: true,
     });
     const migrated = migrateLegacyKizunaProvider('kizunaai');
@@ -241,20 +215,18 @@
   it('redirects a persisted twin the build no longer registers', async () => {
     const { migrateLegacyKizunaProvider, ProviderConfigFactory } = await migrateWith({ soniox: true });
 
-    for (const twin of [Provider.KIZUNA_AI_OPENAI_TRANSLATE, Provider.KIZUNA_AI_VOLCENGINE_AST2]) {
-      const migrated = migrateLegacyKizunaProvider(twin);
-      expect(migrated).toBe(Provider.KIZUNA_AI_SONIOX);
-      expect(ProviderConfigFactory.isProviderSupported(migrated)).toBe(true);
-    }
+    const migrated = migrateLegacyKizunaProvider(Provider.KIZUNA_AI_VOLCENGINE_AST2);
+    expect(migrated).toBe(Provider.KIZUNA_AI_SONIOX);
+    expect(ProviderConfigFactory.isProviderSupported(migrated)).toBe(true);
   });
 
   // Per-provider gating makes managed Soniox redirectable too, which the
   // shared relay gate never allowed.
   it('redirects persisted managed Soniox when its own gate is closed', async () => {
-    const { migrateLegacyKizunaProvider, ProviderConfigFactory } = await migrateWith({ openaiTranslate: true });
+    const { migrateLegacyKizunaProvider, ProviderConfigFactory } = await migrateWith({ volcengineAst2: true });
     const migrated = migrateLegacyKizunaProvider(Provider.KIZUNA_AI_SONIOX);
 
-    expect(migrated).toBe(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
+    expect(migrated).toBe(Provider.KIZUNA_AI_VOLCENGINE_AST2);
     expect(ProviderConfigFactory.isProviderSupported(migrated)).toBe(true);
   });
 
@@ -263,7 +235,6 @@
   it('leaves a registered provider exactly as the user chose it', async () => {
     const { migrateLegacyKizunaProvider } = await migrateWith({
       soniox: true,
-      openaiTranslate: true,
       volcengineAst2: true,
     });
 
`````

`src/services/providers/participantConfig.test.ts`

`````diff t03
diff --git a/src/services/providers/participantConfig.test.ts b/src/services/providers/participantConfig.test.ts
--- a/src/services/providers/participantConfig.test.ts
+++ b/src/services/providers/participantConfig.test.ts
@@ -6,7 +6,6 @@
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaOpenAITranslateEnabled: () => true,
   isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
@@ -230,8 +229,8 @@
     }
   });
 
-  it('openai_translate swaps targetLanguage to the old sourceLanguage (twin inherits)', () => {
-    for (const id of [Provider.OPENAI_TRANSLATE, Provider.KIZUNA_AI_OPENAI_TRANSLATE]) {
+  it('openai_translate swaps targetLanguage to the old sourceLanguage', () => {
+    for (const id of [Provider.OPENAI_TRANSLATE]) {
       const d = ProviderConfigFactory.getDescriptor(id);
       const slice = { ...defaultOpenAITranslateSettings, sourceLanguage: 'ja', targetLanguage: 'en' };
       const base = d.buildSessionConfig(slice, 'i') as OpenAITranslateSessionConfig;
`````

`src/services/providers/prepareToStart.kizunaSoniox.test.ts`

`````diff t03
diff --git a/src/services/providers/prepareToStart.kizunaSoniox.test.ts b/src/services/providers/prepareToStart.kizunaSoniox.test.ts
--- a/src/services/providers/prepareToStart.kizunaSoniox.test.ts
+++ b/src/services/providers/prepareToStart.kizunaSoniox.test.ts
@@ -6,7 +6,6 @@
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaOpenAITranslateEnabled: () => true,
   isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
`````

`src/services/providers/prepareToStart.local.test.ts`

`````diff t03
diff --git a/src/services/providers/prepareToStart.local.test.ts b/src/services/providers/prepareToStart.local.test.ts
--- a/src/services/providers/prepareToStart.local.test.ts
+++ b/src/services/providers/prepareToStart.local.test.ts
@@ -6,7 +6,6 @@
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaOpenAITranslateEnabled: () => true,
   isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
`````

`src/services/providers/providerOrder.test.ts`

`````diff t03
diff --git a/src/services/providers/providerOrder.test.ts b/src/services/providers/providerOrder.test.ts
--- a/src/services/providers/providerOrder.test.ts
+++ b/src/services/providers/providerOrder.test.ts
@@ -10,7 +10,6 @@
     ...(await orig<any>()),
     isKizunaAIEnabled: () => true,
     isKizunaSonioxEnabled: () => true,
-    isKizunaOpenAITranslateEnabled: () => true,
     isKizunaVolcengineAST2Enabled: () => true,
     isPalabraAIEnabled: () => true,
     isLocalNativeEnabled: () => true,
@@ -36,7 +35,6 @@
 
     expect(ids).toEqual([
       Provider.KIZUNA_AI_SONIOX,
-      Provider.KIZUNA_AI_OPENAI_TRANSLATE,
       Provider.KIZUNA_AI_VOLCENGINE_AST2,
       Provider.LOCAL_INFERENCE,
       Provider.GEMINI,
@@ -59,8 +57,7 @@
       ...(await orig<any>()),
       isKizunaAIEnabled: () => false,
       isKizunaSonioxEnabled: () => false,
-      isKizunaOpenAITranslateEnabled: () => false,
-      isKizunaVolcengineAST2Enabled: () => false,
+        isKizunaVolcengineAST2Enabled: () => false,
       isPalabraAIEnabled: () => false,
       isLocalNativeEnabled: () => false,
       isElectron: () => false,
`````

`src/services/providers/sessionResourcesWiring.test.ts`

`````diff t03
diff --git a/src/services/providers/sessionResourcesWiring.test.ts b/src/services/providers/sessionResourcesWiring.test.ts
--- a/src/services/providers/sessionResourcesWiring.test.ts
+++ b/src/services/providers/sessionResourcesWiring.test.ts
@@ -9,7 +9,6 @@
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaOpenAITranslateEnabled: () => true,
   isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
`````

`src/services/providers/voicePrepWiring.test.ts`

`````diff t03
diff --git a/src/services/providers/voicePrepWiring.test.ts b/src/services/providers/voicePrepWiring.test.ts
--- a/src/services/providers/voicePrepWiring.test.ts
+++ b/src/services/providers/voicePrepWiring.test.ts
@@ -9,7 +9,6 @@
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaOpenAITranslateEnabled: () => true,
   isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
`````

`src/stores/kizunaProviders.test.ts`

`````diff t03
diff --git a/src/stores/kizunaProviders.test.ts b/src/stores/kizunaProviders.test.ts
--- a/src/stores/kizunaProviders.test.ts
+++ b/src/stores/kizunaProviders.test.ts
@@ -3,12 +3,6 @@
 import { Provider } from "../types/Provider";
 
 describe("KizunaAI relay providers — session config", () => {
-  it("translate twin builds an openai_translate config from its own slice", () => {
-    useSettingsStore.setState({ provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE } as any);
-    const cfg: any = useSettingsStore.getState().createSessionConfig("instr");
-    expect(cfg.provider).toBe("openai_translate");
-    expect(cfg.model).toBe("gpt-realtime-translate");
-  });
   it("doubao twin builds a volcengine_ast2 config from its own slice", () => {
     useSettingsStore.setState({ provider: Provider.KIZUNA_AI_VOLCENGINE_AST2 } as any);
     const cfg: any = useSettingsStore.getState().createSessionConfig("instr");
`````

`src/stores/settingsStore.kizunaAuth.test.ts`

`````diff t03
diff --git a/src/stores/settingsStore.kizunaAuth.test.ts b/src/stores/settingsStore.kizunaAuth.test.ts
--- a/src/stores/settingsStore.kizunaAuth.test.ts
+++ b/src/stores/settingsStore.kizunaAuth.test.ts
@@ -20,7 +20,6 @@
   ...(await orig<Record<string, unknown>>()),
   isKizunaAIEnabled: () => true,
   isKizunaSonioxEnabled: () => true,
-  isKizunaOpenAITranslateEnabled: () => true,
   isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isElectron: () => true,
`````

`src/stores/settingsStore.sliceRegistry.test.ts`

`````diff t03
diff --git a/src/stores/settingsStore.sliceRegistry.test.ts b/src/stores/settingsStore.sliceRegistry.test.ts
--- a/src/stores/settingsStore.sliceRegistry.test.ts
+++ b/src/stores/settingsStore.sliceRegistry.test.ts
@@ -83,12 +83,6 @@
   });
 
   it('kizuna twins: credentials update in-memory state but are never persisted', async () => {
-    await useSettingsStore.getState().updateKizunaOpenaiTranslate({ apiKey: 'secret', sourceLanguage: 'ja' } as any);
-    expect((useSettingsStore.getState() as any).kizunaOpenaiTranslate.apiKey).toBe('secret');
-    expect(setSetting).not.toHaveBeenCalledWith('settings.kizunaOpenaiTranslate.apiKey', expect.anything());
-    expect(setSetting).toHaveBeenCalledWith('settings.kizunaOpenaiTranslate.sourceLanguage', 'ja');
-
-    setSetting.mockClear();
     await useSettingsStore.getState().updateKizunaVolcengineAst2({ appId: 'a', accessToken: 't', sourceLanguage: 'zh' } as any);
     // Credentials land in state...
     expect((useSettingsStore.getState() as any).kizunaVolcengineAst2.appId).toBe('a');
@@ -118,7 +112,6 @@
     ['updateOpenAICompatible', 'openaiCompatible', { apiKey: 'x' }],
     ['updatePalabraAI', 'palabraai', { clientId: 'x' }],
     ['updateOpenAITranslate', 'openaiTranslate', { apiKey: 'x' }],
-    ['updateKizunaOpenaiTranslate', 'kizunaOpenaiTranslate', { sourceLanguage: 'ja' }],
     ['updateVolcengineAST2', 'volcengineAST2', { appId: 'x' }],
     ['updateKizunaVolcengineAst2', 'kizunaVolcengineAst2', { sourceLanguage: 'zh' }],
     ['updateLocalInference', 'localInference', { ttsSpeed: 1.5 }],
@@ -173,7 +166,7 @@
     // Spot every slice key is a populated object after load.
     for (const sliceKey of [
       'openai', 'gemini', 'openaiCompatible', 'palabraai', 'openaiTranslate',
-      'volcengineAST2', 'kizunaOpenaiTranslate',
+      'volcengineAST2',
       'kizunaVolcengineAst2', 'localInference', 'localNative',
     ]) {
       expect(s[sliceKey], sliceKey).toBeTypeOf('object');
`````

`src/stores/settingsStore.test.ts`

`````diff t03
diff --git a/src/stores/settingsStore.test.ts b/src/stores/settingsStore.test.ts
--- a/src/stores/settingsStore.test.ts
+++ b/src/stores/settingsStore.test.ts
@@ -16,7 +16,6 @@
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaOpenAITranslateEnabled: () => true,
   isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isElectron: () => true,
@@ -108,14 +107,14 @@
         return { valid: true, message: '', validating: false };
       });
 
-      // Switch to a Kizuna-managed (relay) provider
-      await store.setProvider(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
+      // Switch provider
+      await store.setProvider(Provider.LOCAL_NATIVE);
 
       // validateApiKey should NOT be called from setProvider (handled by SettingsInitializer)
       expect(validateSpy).not.toHaveBeenCalled();
 
       // Provider should be updated
-      expect(useSettingsStore.getState().provider).toBe(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
+      expect(useSettingsStore.getState().provider).toBe(Provider.LOCAL_NATIVE);
     });
 
     it('should clear cache when switching providers', async () => {
`````

`src/stores/settingsStore.ts`

`````diff t03
diff --git a/src/stores/settingsStore.ts b/src/stores/settingsStore.ts
--- a/src/stores/settingsStore.ts
+++ b/src/stores/settingsStore.ts
@@ -56,7 +56,6 @@
 import {
   LocalNativeProviderConfig, LocalNativeSettings, defaultLocalNativeSettings,
 } from '../services/providers/LocalNativeProviderConfig';
-import { defaultKizunaOpenaiTranslateSettings } from '../services/providers/KizunaAIOpenAITranslateProviderConfig';
 import { defaultKizunaVolcengineAst2Settings } from '../services/providers/KizunaAIVolcengineAST2ProviderConfig';
 import { defaultKizunaSonioxSettings } from '../services/providers/KizunaAISonioxProviderConfig';
 import { reportError, reportWarning, describeCause } from '../lib/diagnostics/report';
@@ -286,7 +285,6 @@
   openaiTranslate: OpenAITranslateSettings;
   volcengineAST2: VolcengineAST2Settings;
   soniox: SonioxSettings;
-  kizunaOpenaiTranslate: OpenAITranslateSettings;
   kizunaVolcengineAst2: VolcengineAST2Settings;
   kizunaSoniox: SonioxSettings;
   localInference: LocalInferenceSettings;
@@ -415,7 +413,6 @@
   updateOpenAITranslate: (settings: Partial<OpenAITranslateSettings>) => Promise<void>;
   updateVolcengineAST2: (settings: Partial<VolcengineAST2Settings>) => void;
   updateSoniox: (settings: Partial<SonioxSettings>) => void;
-  updateKizunaOpenaiTranslate: (settings: Partial<OpenAITranslateSettings>) => Promise<void>;
   updateKizunaVolcengineAst2: (settings: Partial<VolcengineAST2Settings>) => void;
   updateKizunaSoniox: (settings: Partial<SonioxSettings>) => void;
   updateLocalInference: (settings: Partial<LocalInferenceSettings>) => void;
@@ -653,7 +650,6 @@
   // Relay twins authenticate through the relay with a short-lived Better Auth
   // session token; the user-managed credential fields must never be persisted
   // (stale/sensitive values). See each descriptor's extractCredentials.
-  kizunaOpenaiTranslate: { defaults: defaultKizunaOpenaiTranslateSettings, neverPersist: ['apiKey'] },
   kizunaVolcengineAst2: { defaults: defaultKizunaVolcengineAst2Settings, neverPersist: ['appId', 'accessToken'] },
   kizunaSoniox: { defaults: defaultKizunaSonioxSettings, neverPersist: ['apiKey', 'apiKeyEu', 'apiKeyJp'] },
   localInference: { defaults: defaultLocalInferenceSettings },
@@ -698,7 +694,6 @@
     openaiTranslate: defaultOpenAITranslateSettings,
     volcengineAST2: defaultVolcengineAST2Settings,
     soniox: defaultSonioxSettings,
-    kizunaOpenaiTranslate: defaultKizunaOpenaiTranslateSettings,
     kizunaVolcengineAst2: defaultKizunaVolcengineAst2Settings,
     kizunaSoniox: defaultKizunaSonioxSettings,
     localInference: defaultLocalInferenceSettings,
@@ -963,7 +958,6 @@
     updateOpenAITranslate: (settings) => updateProviderSlice(set, 'openaiTranslate', settings),
     updateVolcengineAST2: (settings) => updateProviderSlice(set, 'volcengineAST2', settings),
     updateSoniox: (settings) => updateProviderSlice(set, 'soniox', settings),
-    updateKizunaOpenaiTranslate: (settings) => updateProviderSlice(set, 'kizunaOpenaiTranslate', settings),
     updateKizunaVolcengineAst2: (settings) => updateProviderSlice(set, 'kizunaVolcengineAst2', settings),
     updateKizunaSoniox: (settings) => updateProviderSlice(set, 'kizunaSoniox', settings),
     updateLocalInference: (settings) => updateProviderSlice(set, 'localInference', settings),
@@ -1331,12 +1325,9 @@
           openaiSlice.model = migrateDeprecatedOpenAIModel(openaiSlice.model);
         }
 
-        // Retire the legacy translate transcript model on both the direct and
-        // the relay-managed twin — they share the settings shape.
-        for (const key of ['openaiTranslate', 'kizunaOpenaiTranslate'] as const) {
-          const slice = loadedSlices[key] as OpenAITranslateSettings | undefined;
-          if (slice) Object.assign(slice, migrateLegacyTranslateTranscriptModel(slice));
-        }
+        // Retire the legacy translate transcript model.
+        const translateSlice = loadedSlices.openaiTranslate as OpenAITranslateSettings | undefined;
+        if (translateSlice) Object.assign(translateSlice, migrateLegacyTranslateTranscriptModel(translateSlice));
 
         // Drop persisted PalabraAI language codes the API rejects, so an existing
         // user isn't left on a pair whose set_task fails validation.
@@ -1526,7 +1517,6 @@
 export const useOpenAITranslateSettings = () => useSettingsStore((state) => state.openaiTranslate);
 export const useVolcengineAST2Settings = () => useSettingsStore((state) => state.volcengineAST2);
 export const useSonioxSettings = () => useSettingsStore((state) => state.soniox);
-export const useKizunaOpenaiTranslateSettings = () => useSettingsStore((state) => state.kizunaOpenaiTranslate);
 export const useKizunaVolcengineAst2Settings = () => useSettingsStore((state) => state.kizunaVolcengineAst2);
 export const useKizunaSonioxSettings = () => useSettingsStore((state) => state.kizunaSoniox);
 export const useLocalInferenceSettings = () => useSettingsStore((state) => state.localInference);
@@ -1609,7 +1599,6 @@
 export const useUpdateOpenAITranslate = () => useSettingsStore((state) => state.updateOpenAITranslate);
 export const useUpdateVolcengineAST2 = () => useSettingsStore((state) => state.updateVolcengineAST2);
 export const useUpdateSoniox = () => useSettingsStore((state) => state.updateSoniox);
-export const useUpdateKizunaOpenaiTranslate = () => useSettingsStore((state) => state.updateKizunaOpenaiTranslate);
 export const useUpdateKizunaVolcengineAst2 = () => useSettingsStore((state) => state.updateKizunaVolcengineAst2);
 export const useUpdateKizunaSoniox = () => useSettingsStore((state) => state.updateKizunaSoniox);
 export const useUpdateLocalInference = () => useSettingsStore((state) => state.updateLocalInference);
`````

`src/types/Provider.test.ts`

`````diff t03
diff --git a/src/types/Provider.test.ts b/src/types/Provider.test.ts
--- a/src/types/Provider.test.ts
+++ b/src/types/Provider.test.ts
@@ -2,8 +2,7 @@
 import { Provider, isKizunaManagedProvider } from "./Provider";
 
 describe("kizuna-managed provider helpers", () => {
-  it("identifies the two relay-managed providers", () => {
-    expect(isKizunaManagedProvider(Provider.KIZUNA_AI_OPENAI_TRANSLATE)).toBe(true);
+  it("identifies the relay-managed provider", () => {
     expect(isKizunaManagedProvider(Provider.KIZUNA_AI_VOLCENGINE_AST2)).toBe(true);
     expect(isKizunaManagedProvider(Provider.OPENAI_TRANSLATE)).toBe(false);
   });
`````

`src/types/Provider.ts`

`````diff t03
diff --git a/src/types/Provider.ts b/src/types/Provider.ts
--- a/src/types/Provider.ts
+++ b/src/types/Provider.ts
@@ -9,7 +9,6 @@
   OPENAI = 'openai',
   GEMINI = 'gemini',
   PALABRA_AI = 'palabraai',
-  KIZUNA_AI_OPENAI_TRANSLATE = 'kizunaai_openai_translate',
   KIZUNA_AI_VOLCENGINE_AST2 = 'kizunaai_volcengine_ast2',
   KIZUNA_AI_SONIOX = 'kizunaai_soniox',
   OPENAI_COMPATIBLE = 'openai_compatible',
@@ -24,17 +23,16 @@
 /**
  * Provider type definition
  */
-export type ProviderType = Provider.OPENAI | Provider.GEMINI | Provider.PALABRA_AI | Provider.KIZUNA_AI_OPENAI_TRANSLATE | Provider.KIZUNA_AI_VOLCENGINE_AST2 | Provider.KIZUNA_AI_SONIOX | Provider.OPENAI_COMPATIBLE | Provider.OPENAI_TRANSLATE | Provider.OPENAI_LIVE | Provider.VOLCENGINE_AST2 | Provider.LOCAL_INFERENCE | Provider.LOCAL_NATIVE | Provider.SONIOX;
+export type ProviderType = Provider.OPENAI | Provider.GEMINI | Provider.PALABRA_AI | Provider.KIZUNA_AI_VOLCENGINE_AST2 | Provider.KIZUNA_AI_SONIOX | Provider.OPENAI_COMPATIBLE | Provider.OPENAI_TRANSLATE | Provider.OPENAI_LIVE | Provider.VOLCENGINE_AST2 | Provider.LOCAL_INFERENCE | Provider.LOCAL_NATIVE | Provider.SONIOX;
 
 /** The backend-managed twins: Kizuna AI's own service running on a third-party
  *  engine. Keep in lockstep with isKizunaManagedProvider below. */
 export type KizunaManagedProvider =
-  | Provider.KIZUNA_AI_OPENAI_TRANSLATE
   | Provider.KIZUNA_AI_VOLCENGINE_AST2
   | Provider.KIZUNA_AI_SONIOX;
 
 export function isKizunaManagedProvider(p: Provider): p is KizunaManagedProvider {
-  return p === Provider.KIZUNA_AI_OPENAI_TRANSLATE || p === Provider.KIZUNA_AI_VOLCENGINE_AST2
+  return p === Provider.KIZUNA_AI_VOLCENGINE_AST2
     || p === Provider.KIZUNA_AI_SONIOX;
 }
 
`````

`src/utils/environment.ts`

`````diff t03
diff --git a/src/utils/environment.ts b/src/utils/environment.ts
--- a/src/utils/environment.ts
+++ b/src/utils/environment.ts
@@ -219,14 +219,6 @@
   return import.meta.env.VITE_ENABLE_KIZUNA_SONIOX === 'true';
 }
 
-export function isKizunaOpenAITranslateEnabled(): boolean {
-  if (isDevelopmentMode()) {
-    return true;
-  }
-
-  return import.meta.env.VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE === 'true';
-}
-
 export function isKizunaVolcengineAST2Enabled(): boolean {
   if (isDevelopmentMode()) {
     return true;
`````

---

### Task 4: Doubao AST 2.0's old code and its relay twin (Wave 1)

Doubao AST 2.0 runs on its own definition since the Stage 2 Volcengine AST2 plan, live-tested (21 of 21); its relay twin was deleted, not ported. The twin is the relay's last user, so the relay's URL, its CSP origins and `uuid` go here too (choice 7). The roadmap's V2 inventory (`:3800-3814`) is taken whole, with its start-up clear of rules 2000–2009 as ruling C3 shapes it.

**What goes, and what changes:**
- `VolcengineAST2Client.ts` and its test, the codec stubs `volcengine-ast2/ast2-proto.{js,d.ts}`, `VolcengineAST2ProviderConfig.ts`, `KizunaAIVolcengineAST2ProviderConfig.ts`, `volcengineAST2LanguageSync.ts` and its test; the registrations; `IClient.ts`' AST2 config; the `volcengineAST2` and `kizunaVolcengineAst2` slices; `Provider.KIZUNA_AI_VOLCENGINE_AST2` (ruling C1) — `KizunaManagedProvider` is Kizuna Soniox alone now.
- `ClientFactory.test.ts` and `ClientOperations.test.ts`, whose every case named a relay twin; `environment.ts`' `getRelayWsUrl` and its test, `isVolcengineAST2Enabled`, `isKizunaVolcengineAST2Enabled`, their forwarding and `build.yml` / `.env.example` lines (ruling 6); `uuid` and `@types/uuid` (research note 5), with their lockfile entries.
- The extension (ruling C3): `background.js`' AST2 DNR block and its `VOLCENGINE_AST2_*` handlers go; `let dnrUpdatePromise` moves above the generic section; `wsHeaderRule.js`' `sweepIds` takes 2000–2009 (`OLD_AST2_RULE_ID_MIN` / `_MAX`, `isOldRule`), and its tests and `background.wsHeaders.test.ts`' sweep case say so. `electron/ws-header-rules.js` and its test lose the old AST2 client from their comments (it sent host-wide rules); the listener is unchanged.
- The CSP (ruling 5): the seven entries leave `manifest.json`'s `connect-src`; `manifest.consistency.test.ts` gains "allows no origin only a deleted provider connected to".
- `logStore.ts`' old AST2 event names (the adapter's frames keep their grouping); `redact.ts`' comment; `volcengine_ast2/adapter.ts`' and `codec.test.ts`' headers (choice 3); the old test tables' AST2 and twin rows; the wizard tests' mocks.
- `providers.kizunaai_volcengine_ast2.{name,description}`.
- The sweep's citations name their plan (Revision 1): "Stage 2 OpenAI Live, ruling 11; Stage 2 deletion, ruling C3" in `background.js`' sweep comment and in the case titles of `wsHeaderRule.test.ts` and `background.wsHeaders.test.ts`, where a bare "ruling 11" beside this plan's citation read as this plan's.

**Files:**
- Delete (10): `src/services/ClientOperations.test.ts`, `src/services/clients/ClientFactory.test.ts`, `src/services/clients/VolcengineAST2Client.test.ts`, `src/services/clients/VolcengineAST2Client.ts`, `src/services/clients/volcengine-ast2/ast2-proto.d.ts`, `src/services/clients/volcengine-ast2/ast2-proto.js`, `src/services/providers/KizunaAIVolcengineAST2ProviderConfig.ts`, `src/services/providers/VolcengineAST2ProviderConfig.ts`, `src/services/providers/volcengineAST2LanguageSync.test.ts`, `src/services/providers/volcengineAST2LanguageSync.ts`
- Modify (41, by the blocks below): `.env.example`, `.github/workflows/build.yml`, `electron/ws-header-rules.js`, `electron/ws-header-rules.test.js`, `extension/background/background.js`, `extension/background/background.wsHeaders.test.ts`, `extension/background/wsHeaderRule.js`, `extension/background/wsHeaderRule.test.ts`, `extension/manifest.consistency.test.ts`, `extension/manifest.json`, `extension/vite.config.ts`, `package-lock.json`, `package.json`, `src/components/SetupWizard/SetupWizard.test.tsx`, `src/components/SetupWizard/providerPaths.test.ts`, `src/components/SetupWizard/steps/StepCredentials.test.tsx`, `src/lib/diagnostics/redact.ts`, `src/lib/setup/providerPath.test.ts`, `src/locales/locales.consistency.test.ts`, `src/providers/volcengine_ast2/adapter.ts`, `src/providers/volcengine_ast2/codec.test.ts`, `src/services/interfaces/IClient.ts`, `src/services/providers/ProviderConfigFactory.ts`, `src/services/providers/descriptorRegistry.test.ts`, `src/services/providers/kizunaProviderGating.test.ts`, `src/services/providers/participantConfig.test.ts`, `src/services/providers/prepareToStart.kizunaSoniox.test.ts`, `src/services/providers/prepareToStart.local.test.ts`, `src/services/providers/providerOrder.test.ts`, `src/services/providers/sessionResourcesWiring.test.ts`, `src/services/providers/voicePrepWiring.test.ts`, `src/stores/kizunaProviders.test.ts`, `src/stores/logStore.ts`, `src/stores/settingsStore.kizunaAuth.test.ts`, `src/stores/settingsStore.sliceRegistry.test.ts`, `src/stores/settingsStore.test.ts`, `src/stores/settingsStore.ts`, `src/types/Provider.test.ts`, `src/types/Provider.ts`, `src/utils/environment.test.ts`, `src/utils/environment.ts`
- The 30 locale catalogs `src/locales/*/translation.json`, by the key tool (2 keys)

**Interfaces:**
- Consumes: Task 3 (the relay's other user is gone).
- Produces: `wsHeaderRule.js` exporting `OLD_AST2_RULE_ID_MIN = 2000`, `OLD_AST2_RULE_ID_MAX = 2009` beside `OLD_LIVE_RULE_ID`; `sweepIds(rules)` returning every generic id, 4000 and 2000–2009; no relay code anywhere; `KizunaManagedProvider = Provider.KIZUNA_AI_SONIOX`.

- [ ] **Step 1: Delete the files.**

  ```
  git rm -q -- src/services/ClientOperations.test.ts src/services/clients/ClientFactory.test.ts src/services/clients/VolcengineAST2Client.test.ts src/services/clients/VolcengineAST2Client.ts src/services/clients/volcengine-ast2/ast2-proto.d.ts src/services/clients/volcengine-ast2/ast2-proto.js src/services/providers/KizunaAIVolcengineAST2ProviderConfig.ts src/services/providers/VolcengineAST2ProviderConfig.ts src/services/providers/volcengineAST2LanguageSync.test.ts src/services/providers/volcengineAST2LanguageSync.ts
  ```

- [ ] **Step 2: Apply the task's diff blocks** (Global Constraints: never by hand).

  ```
  python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/plan-apply.py docs/superpowers/plans/2026-09-30-client-contract-stage2-deletion.md t04
  ```

  Expected: `t04: 41 files changed`, and no other line.

- [ ] **Step 3: Remove the locale keys only the deleted code read.**

  ```
  node /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/drop-locale-keys.mjs . providers.kizunaai_volcengine_ast2.description providers.kizunaai_volcengine_ast2.name
  ```

  Expected: `2 keys removed from 30 catalogs`.

- [ ] **Step 4: Check that nothing reaches what went.**

  ```
  git grep -nE "from '[^']*/(VolcengineAST2Client|VolcengineAST2ProviderConfig|KizunaAIVolcengineAST2ProviderConfig|volcengineAST2LanguageSync)'|KIZUNA_AI_VOLCENGINE_AST2|is(Kizuna)?VolcengineAST2Enabled|getRelayWsUrl|VOLCENGINE_AST2_(SET|CLEAR)|VITE_ENABLE_(KIZUNA_)?VOLCENGINE_AST2|from 'uuid'|\(ruling 11;" -- src extension electron .github .env.example
  ```

  Expected: exactly this line, a comment that says the flag is gone —

  ```
  src/providers/volcengine_ast2/provider.ts:20: * (ruling 5); the old `VITE_ENABLE_VOLCENGINE_AST2` is dead and not read.
  ```

  ```
  command grep -cE 'wss://sokuji|cometapi|yunai' extension/manifest.json
  ```

  Expected: `0`.

- [ ] **Step 5: Run the gates.** Each command as its own call; every expected number is the replay's.

  - `npx vitest run src`: **575 files passed and 1 skipped (576); 7 467 tests passed and 2 skipped (7 469)**; 0 failed, no unhandled errors.
  - `npx vitest run electron`: 34 files, 477 tests passed. `npx vitest run extension`: 9 files, 56 tests passed.
  - Local Native's old path: `npx vitest run src/services src/lib/local-inference/native src/components/Settings/sections/Native src/components/Settings/engine/useNativeEngineAdapter src/stores/nativeModelStore src/stores/settingsStore` — 73 files, 1 338 tests passed.
  - The typecheck, as a set: `npx tsc --noEmit -p tsconfig.json > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t04.txt`, then `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t03.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t04.txt` prints exactly `before 255 after 255; new 0; gone 0` and exits 0 — no error the task before did not have; `after 255` is the full tree's count.
  - `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh | diff - /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` prints nothing: the baseline's 18 lines, unchanged.

- [ ] **Step 6: Commit.**

```bash
git add -- .env.example .github/workflows/build.yml electron/ws-header-rules.js electron/ws-header-rules.test.js extension/background/background.js extension/background/background.wsHeaders.test.ts extension/background/wsHeaderRule.js extension/background/wsHeaderRule.test.ts extension/manifest.consistency.test.ts extension/manifest.json extension/vite.config.ts package-lock.json package.json src/components/SetupWizard/SetupWizard.test.tsx src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/steps/StepCredentials.test.tsx src/lib/diagnostics/redact.ts src/lib/setup/providerPath.test.ts src/locales/locales.consistency.test.ts src/providers/volcengine_ast2/adapter.ts src/providers/volcengine_ast2/codec.test.ts src/services/interfaces/IClient.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/kizunaProviderGating.test.ts src/services/providers/participantConfig.test.ts src/services/providers/prepareToStart.kizunaSoniox.test.ts src/services/providers/prepareToStart.local.test.ts src/services/providers/providerOrder.test.ts src/services/providers/sessionResourcesWiring.test.ts src/services/providers/voicePrepWiring.test.ts src/stores/kizunaProviders.test.ts src/stores/logStore.ts src/stores/settingsStore.kizunaAuth.test.ts src/stores/settingsStore.sliceRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts src/types/Provider.test.ts src/types/Provider.ts src/utils/environment.test.ts src/utils/environment.ts 'src/locales/*/translation.json'
```

```bash
git commit -q -F - -- src/services/ClientOperations.test.ts src/services/clients/ClientFactory.test.ts src/services/clients/VolcengineAST2Client.test.ts src/services/clients/VolcengineAST2Client.ts src/services/clients/volcengine-ast2/ast2-proto.d.ts src/services/clients/volcengine-ast2/ast2-proto.js src/services/providers/KizunaAIVolcengineAST2ProviderConfig.ts src/services/providers/VolcengineAST2ProviderConfig.ts src/services/providers/volcengineAST2LanguageSync.test.ts src/services/providers/volcengineAST2LanguageSync.ts .env.example .github/workflows/build.yml electron/ws-header-rules.js electron/ws-header-rules.test.js extension/background/background.js extension/background/background.wsHeaders.test.ts extension/background/wsHeaderRule.js extension/background/wsHeaderRule.test.ts extension/manifest.consistency.test.ts extension/manifest.json extension/vite.config.ts package-lock.json package.json src/components/SetupWizard/SetupWizard.test.tsx src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/steps/StepCredentials.test.tsx src/lib/diagnostics/redact.ts src/lib/setup/providerPath.test.ts src/locales/locales.consistency.test.ts src/providers/volcengine_ast2/adapter.ts src/providers/volcengine_ast2/codec.test.ts src/services/interfaces/IClient.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/kizunaProviderGating.test.ts src/services/providers/participantConfig.test.ts src/services/providers/prepareToStart.kizunaSoniox.test.ts src/services/providers/prepareToStart.local.test.ts src/services/providers/providerOrder.test.ts src/services/providers/sessionResourcesWiring.test.ts src/services/providers/voicePrepWiring.test.ts src/stores/kizunaProviders.test.ts src/stores/logStore.ts src/stores/settingsStore.kizunaAuth.test.ts src/stores/settingsStore.sliceRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts src/types/Provider.test.ts src/types/Provider.ts src/utils/environment.test.ts src/utils/environment.ts 'src/locales/*/translation.json' <<'EOF'
refactor(volcengine-ast2): delete the old Doubao AST 2.0 code and its relay twin

Doubao AST 2.0 runs on its own definition and has passed its live test;
its relay twin was deleted, not ported. Delete the old client, codec
stubs, descriptors, language sync, slices and enum id; the relay's URL,
CSP origins and release flags; uuid; and the extension's AST2 header
block, whose rule ids the startup sweep now clears.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

**The blocks** (`t04`, one per file, in the order the applier takes them):

`.env.example`

`````diff t04
diff --git a/.env.example b/.env.example
--- a/.env.example
+++ b/.env.example
@@ -40,7 +40,6 @@
 # offer before tagging it. v0.36.3 shipped with the whole Kizuna family off
 # because the values were set as variables while the workflow read secrets.
 VITE_ENABLE_KIZUNA_SONIOX=false
-VITE_ENABLE_KIZUNA_VOLCENGINE_AST2=false
 
 # Flagged providers in the new provider registry that a release offers, by id,
 # comma-separated (development builds offer all of them). Empty: none.
`````

`.github/workflows/build.yml`

`````diff t04
diff --git a/.github/workflows/build.yml b/.github/workflows/build.yml
--- a/.github/workflows/build.yml
+++ b/.github/workflows/build.yml
@@ -216,11 +216,9 @@
           VITE_BACKEND_URL: ${{ vars.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai' }}
           VITE_ENVIRONMENT: production
           VITE_POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
-          VITE_ENABLE_VOLCENGINE_AST2: ${{ vars.VITE_ENABLE_VOLCENGINE_AST2 }}
           VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
           VITE_ENABLE_KIZUNA_SONIOX: ${{ vars.VITE_ENABLE_KIZUNA_SONIOX }}
-          VITE_ENABLE_KIZUNA_VOLCENGINE_AST2: ${{ vars.VITE_ENABLE_KIZUNA_VOLCENGINE_AST2 }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
           # Additional variables only for releases
@@ -269,11 +267,9 @@ occurrence 1 of 3
           VITE_BACKEND_URL: ${{ vars.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai' }}
           VITE_ENVIRONMENT: production
           VITE_POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
-          VITE_ENABLE_VOLCENGINE_AST2: ${{ vars.VITE_ENABLE_VOLCENGINE_AST2 }}
           VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
           VITE_ENABLE_KIZUNA_SONIOX: ${{ vars.VITE_ENABLE_KIZUNA_SONIOX }}
-          VITE_ENABLE_KIZUNA_VOLCENGINE_AST2: ${{ vars.VITE_ENABLE_KIZUNA_VOLCENGINE_AST2 }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
 
@@ -308,11 +304,9 @@ occurrence 2 of 3
           VITE_BACKEND_URL: ${{ vars.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai' }}
           VITE_ENVIRONMENT: production
           VITE_POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
-          VITE_ENABLE_VOLCENGINE_AST2: ${{ vars.VITE_ENABLE_VOLCENGINE_AST2 }}
           VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
           VITE_ENABLE_KIZUNA_SONIOX: ${{ vars.VITE_ENABLE_KIZUNA_SONIOX }}
-          VITE_ENABLE_KIZUNA_VOLCENGINE_AST2: ${{ vars.VITE_ENABLE_KIZUNA_VOLCENGINE_AST2 }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
 
@@ -409,11 +403,9 @@ occurrence 3 of 3
           VITE_BACKEND_URL: ${{ vars.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai' }}
           VITE_ENVIRONMENT: production
           VITE_POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
-          VITE_ENABLE_VOLCENGINE_AST2: ${{ vars.VITE_ENABLE_VOLCENGINE_AST2 }}
           VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
           VITE_ENABLE_KIZUNA_SONIOX: ${{ vars.VITE_ENABLE_KIZUNA_SONIOX }}
-          VITE_ENABLE_KIZUNA_VOLCENGINE_AST2: ${{ vars.VITE_ENABLE_KIZUNA_VOLCENGINE_AST2 }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
 
@@ -510,11 +502,9 @@
           # Production environment variables for extension
           VITE_BACKEND_URL: ${{ vars.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai' }}
           POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
-          VITE_ENABLE_VOLCENGINE_AST2: ${{ vars.VITE_ENABLE_VOLCENGINE_AST2 }}
           VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
           VITE_ENABLE_KIZUNA_SONIOX: ${{ vars.VITE_ENABLE_KIZUNA_SONIOX }}
-          VITE_ENABLE_KIZUNA_VOLCENGINE_AST2: ${{ vars.VITE_ENABLE_KIZUNA_VOLCENGINE_AST2 }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
 
`````

`electron/ws-header-rules.js`

`````diff t04
diff --git a/electron/ws-header-rules.js b/electron/ws-header-rules.js
--- a/electron/ws-header-rules.js
+++ b/electron/ws-header-rules.js
@@ -3,14 +3,14 @@
 // The WebSocket upgrade header rules the renderer registers over IPC
 // ('ws-headers-set' / 'ws-headers-clear') and main's one onBeforeSendHeaders
 // listener applies to the next upgrade they match. A browser cannot set an
-// upgrade's headers itself: Edge TTS needs a User-Agent, the old Doubao AST 2.0
-// client its credentials, and OpenAI Live a real Authorization and no Origin.
+// upgrade's headers itself: Edge TTS needs a User-Agent, and OpenAI Live a
+// real Authorization and no Origin.
 //
 // A rule is keyed by host and path (Stage 2 OpenAI Live, ruling 7; choice 2):
 // it applies to an upgrade to its host whose path starts with the rule's path,
 // the longest such path winning, and a rule with no path applies to every path
-// on its host, as every rule did before — so Edge TTS and the old AST2 client
-// keep working unchanged. A Live rule under /v1/live/ therefore never reaches
+// on its host, as every rule did before — so Edge TTS keeps working
+// unchanged. A Live rule under /v1/live/ therefore never reaches
 // OpenAI Realtime's /v1/realtime or Translate's /v1/realtime/translations on
 // the same host. A rule is one-shot: the upgrade it applies to consumes it.
 
`````

`electron/ws-header-rules.test.js`

`````diff t04
diff --git a/electron/ws-header-rules.test.js b/electron/ws-header-rules.test.js
--- a/electron/ws-header-rules.test.js
+++ b/electron/ws-header-rules.test.js
@@ -10,7 +10,7 @@
 const LIVE = { host: 'api.openai.com', path: '/v1/live/', headers: { Authorization: 'Bearer sk-live' }, removeHeaders: ['Origin'] };
 
 describe('the WebSocket upgrade header rules (Stage 2 OpenAI Live, ruling 7; choice 2)', () => {
-  it("a host-wide rule — Edge TTS's, the old AST2 client's — applies to any path on its host, once, as every rule did before", () => {
+  it("a host-wide rule — Edge TTS's — applies to any path on its host, once, as every rule did before", () => {
     const rules = createWsHeaderRules();
     expect(rules.set({ host: 'speech.platform.bing.com', headers: { 'User-Agent': 'Edg/143' } })).toEqual({ success: true });
     const h = upgrade();
`````

`extension/background/background.js`

`````diff t04
diff --git a/extension/background/background.js b/extension/background/background.js
--- a/extension/background/background.js
+++ b/extension/background/background.js
@@ -253,71 +253,6 @@
   }
 });
 
-// ─── Volcengine AST2 declarativeNetRequest header injection ───────────────
-// Browser WebSocket API cannot send custom headers. We use declarativeNetRequest
-// dynamic rules to inject auth headers into the WebSocket upgrade request.
~ 60 more removed lines sha256:b78169b3f0f9
-}
-
 // ─── Edge TTS declarativeNetRequest header injection ──────────────────────
 // Edge TTS requires specific headers to connect to Bing's TTS WebSocket endpoint.
 // We use declarativeNetRequest to inject these headers for the extension context.
@@ -388,8 +323,11 @@
 // One message pair for every provider whose upgrade needs a header a browser
 // cannot set (wsHeaderRule.js): a rule per host and path, scoped to the
 // extension's own pages, removed as soon as the upgrade is made (Stage 2
-// OpenAI Live, ruling 7; choice 3). Chained on the shared dnrUpdatePromise and
-// never left rejected. The per-provider pairs above go with their old clients.
+// OpenAI Live, ruling 7; choice 3). Chained on one promise and never left
+// rejected; the old per-provider pairs that shared it went with their clients
+// (Stage 2 deletion, ruling 2).
+let dnrUpdatePromise = Promise.resolve();
+
 async function wsHeadersSet(message) {
   // Validate before touching the shared chain.
   const problem = ruleProblem(message);
@@ -416,7 +354,8 @@
 }
 
 // Dynamic rules outlive a browser restart: one a crash left installed goes when the browser or the extension next starts,
-// and so does the old OpenAI Live client's, which nothing else will clear once that client is gone (ruling 11).
+// and so do the old OpenAI Live and AST2 clients', which nothing else clears now those clients are gone (Stage 2
+// OpenAI Live, ruling 11; Stage 2 deletion, ruling C3).
 function wsHeadersSweep() {
   const run = dnrUpdatePromise.then(async () => {
     const ids = sweepIds(await chrome.declarativeNetRequest.getDynamicRules());
@@ -524,27 +463,6 @@
     return true; // Indicates async response
   }
 
-  // Handle Volcengine AST2 DNR header injection
-  if (message.type === 'VOLCENGINE_AST2_SET_HEADERS') {
-    volcengineSetDNRHeaders(message.credentials)
~ 16 more removed lines sha256:b109cf464d86
-  }
-
   // Handle Edge TTS DNR header injection
   if (message.type === 'EDGE_TTS_SET_HEADERS') {
     edgeTtsSetDNRHeaders()
`````

`extension/background/background.wsHeaders.test.ts`

`````diff t04
diff --git a/extension/background/background.wsHeaders.test.ts b/extension/background/background.wsHeaders.test.ts
--- a/extension/background/background.wsHeaders.test.ts
+++ b/extension/background/background.wsHeaders.test.ts
@@ -49,7 +49,7 @@
     expect(fn('wsHeadersSweep')).toContain('sweepIds(');
   });
 
-  it('sweeps the generic rules and the old Live rule when the browser or the extension starts, since dynamic rules outlive both (ruling 11)', () => {
+  it('sweeps the generic rules and the old Live and AST2 rules when the browser or the extension starts, since dynamic rules outlive both (Stage 2 OpenAI Live, ruling 11; Stage 2 deletion, ruling C3)', () => {
     expect(background).toContain('chrome.runtime.onStartup.addListener(() => { void wsHeadersSweep(); });');
     expect(background).toContain('chrome.runtime.onInstalled.addListener(() => { void wsHeadersSweep(); });');
   });
`````

`extension/background/wsHeaderRule.js`

`````diff t04
diff --git a/extension/background/wsHeaderRule.js b/extension/background/wsHeaderRule.js
--- a/extension/background/wsHeaderRule.js
+++ b/extension/background/wsHeaderRule.js
@@ -7,7 +7,8 @@
 // makes (`initiatorDomains`), in an id range of their own (Stage 2 OpenAI
 // Live, ruling 7; choice 3). OpenAI Live is the first user: a real
 // Authorization and no Origin, which every browser adds and its endpoint
-// answers with 403. The old per-provider pairs stay until their clients go.
+// answers with 403. The old per-provider pairs went with their clients (Stage
+// 2 deletion, ruling 2).
 // No chrome.* here: background.js reads the rules, hands in the extension's id
 // and its pages' base URL, and applies what these return.
 
@@ -47,7 +48,18 @@
  */
 export const OLD_LIVE_RULE_ID = 4000;
 
+/**
+ * The old Doubao AST 2.0 client's rule ids, gone from background.js with that
+ * client (Stage 2 deletion, ruling 2): one `set` rule per credential header at
+ * `||openspeech.bytedance.com`, with no initiator, so one a crash left behind
+ * would hand the user's credentials to any page opening a socket there. The
+ * sweep takes the old range whole (Stage 2 deletion, ruling C3).
+ */
+export const OLD_AST2_RULE_ID_MIN = 2000;
+export const OLD_AST2_RULE_ID_MAX = 2009;
+
 const inRange = (rule) => rule.id >= WS_RULE_ID_MIN && rule.id <= WS_RULE_ID_MAX;
+const isOldRule = (rule) => rule.id === OLD_LIVE_RULE_ID || (rule.id >= OLD_AST2_RULE_ID_MIN && rule.id <= OLD_AST2_RULE_ID_MAX);
 
 /** The generic rules' ids for this host and path: what a clear removes. */
 export function ruleIdsFor(existing, host, path) {
@@ -55,9 +67,9 @@
   return existing.filter((r) => inRange(r) && r.condition?.urlFilter === filter).map((r) => r.id);
 }
 
-/** Every generic rule's id, and the old Live rule's: what the sweep at a start removes. */
+/** Every generic rule's id, and the old Live and AST2 rules': what the sweep at a start removes. */
 export function sweepIds(existing) {
-  return existing.filter((r) => inRange(r) || r.id === OLD_LIVE_RULE_ID).map((r) => r.id);
+  return existing.filter((r) => inRange(r) || isOldRule(r)).map((r) => r.id);
 }
 
 /**
`````

`extension/background/wsHeaderRule.test.ts`

`````diff t04
diff --git a/extension/background/wsHeaderRule.test.ts b/extension/background/wsHeaderRule.test.ts
--- a/extension/background/wsHeaderRule.test.ts
+++ b/extension/background/wsHeaderRule.test.ts
@@ -1,5 +1,5 @@
 import { describe, it, expect } from 'vitest';
-import { buildRule, isExtensionPage, OLD_LIVE_RULE_ID, ruleIdsFor, ruleProblem, sweepIds, urlFilterFor, WS_RULE_ID_MAX, WS_RULE_ID_MIN } from './wsHeaderRule.js';
+import { buildRule, isExtensionPage, OLD_AST2_RULE_ID_MAX, OLD_AST2_RULE_ID_MIN, OLD_LIVE_RULE_ID, ruleIdsFor, ruleProblem, sweepIds, urlFilterFor, WS_RULE_ID_MAX, WS_RULE_ID_MIN } from './wsHeaderRule.js';
 
 const RUNTIME = 'abcdefghijklmnopabcdefghijklmnop';
 /** What `chrome.runtime.getURL('')` answers in Chrome. */
@@ -35,13 +35,15 @@
     expect(buildRule(full, LIVE, RUNTIME)).toBeNull();
   });
 
-  it("finds a host and path's rules to clear, and sweeps every generic rule and the old Live rule — never another provider's (ruling 11)", () => {
+  it("finds a host and path's rules to clear, and sweeps every generic rule and the old Live and AST2 rules — never another provider's (Stage 2 OpenAI Live, ruling 11; Stage 2 deletion, ruling C3)", () => {
     const rules = [...OLD, { id: 5000, condition: { urlFilter: '||api.openai.com/v1/live/' } }, { id: 5001, condition: { urlFilter: '||h.example/' } }];
     expect(ruleIdsFor(rules, 'api.openai.com', '/v1/live/')).toEqual([5000]);
     expect(ruleIdsFor(rules, 'api.openai.com', '/v1/')).toEqual([]);
     expect(OLD_LIVE_RULE_ID).toBe(4000);
-    expect(sweepIds(rules)).toEqual([4000, 5000, 5001]);
-    expect(sweepIds(OLD.filter((r) => r.id !== 4000))).toEqual([]);
+    expect([OLD_AST2_RULE_ID_MIN, OLD_AST2_RULE_ID_MAX]).toEqual([2000, 2009]);
+    expect(sweepIds(rules)).toEqual([2000, 4000, 5000, 5001]);
+    expect(sweepIds([{ id: 1999 }, { id: 2003 }, { id: 2009 }, { id: 2010 }])).toEqual([2003, 2009]);
+    expect(sweepIds(OLD.filter((r) => r.id !== 2000 && r.id !== 4000))).toEqual([]);
   });
 
   it('refuses a message that names no rule it would install', () => {
`````

`extension/manifest.consistency.test.ts`

`````diff t04
diff --git a/extension/manifest.consistency.test.ts b/extension/manifest.consistency.test.ts
--- a/extension/manifest.consistency.test.ts
+++ b/extension/manifest.consistency.test.ts
@@ -25,6 +25,22 @@
     expect(csp).toContain('https://tts-rt.soniox.com');
   });
 
+  // The OpenAI Compatible presets were never reached from the extension (that
+  // provider is Electron only) and the relay's sockets went with the relay
+  // twins (Stage 2 deletion, rulings 2 and 5). The https origins of the
+  // backend stay: the account and wallet calls use them.
+  it('allows no origin only a deleted provider connected to', () => {
+    const origins = manifest.content_security_policy.extension_pages.split(/[ ;]+/);
+    for (const origin of [
+      'https://api.cometapi.com', 'wss://api.cometapi.com',
+      'https://new.yunai.link', 'wss://new.yunai.link',
+      'wss://sokuji.kizuna.ai', 'wss://sokuji-api.kizuna.ai', 'wss://sokuji-api-dev.kizuna.ai',
+    ]) {
+      expect(origins, origin).not.toContain(origin);
+    }
+    expect(origins).toContain('https://sokuji-api.kizuna.ai');
+  });
+
   it('allows every Soniox regional origin', () => {
     const csp = manifest.content_security_policy.extension_pages;
     for (const origin of [
`````

`extension/manifest.json`

`````diff t04
diff --git a/extension/manifest.json b/extension/manifest.json
--- a/extension/manifest.json
+++ b/extension/manifest.json
@@ -113,6 +113,6 @@
     }
   ],
   "content_security_policy": {
-    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'; connect-src 'self' https://us.i.posthog.com https://api.openai.com https://us-assets.i.posthog.com wss://api.openai.com https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com https://*.palabra.ai wss://*.palabra.ai https://api.cometapi.com wss://api.cometapi.com https://new.yunai.link wss://new.yunai.link wss://sokuji-api.kizuna.ai wss://sokuji-api-dev.kizuna.ai https://sokuji-api-dev.kizuna.ai https://sokuji-api.kizuna.ai https://sokuji.kizuna.ai wss://sokuji.kizuna.ai wss://openspeech.bytedance.com wss://speech.platform.bing.com https://speech.platform.bing.com https://www.bing.com https://huggingface.co https://*.huggingface.co https://*.hf.co https://api.soniox.com wss://stt-rt.soniox.com wss://tts-rt.soniox.com https://tts-rt.soniox.com https://api.eu.soniox.com https://api.jp.soniox.com wss://stt-rt.eu.soniox.com wss://stt-rt.jp.soniox.com wss://tts-rt.eu.soniox.com wss://tts-rt.jp.soniox.com https://tts-rt.eu.soniox.com https://tts-rt.jp.soniox.com"
+    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'; connect-src 'self' https://us.i.posthog.com https://api.openai.com https://us-assets.i.posthog.com wss://api.openai.com https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com https://*.palabra.ai wss://*.palabra.ai https://sokuji-api-dev.kizuna.ai https://sokuji-api.kizuna.ai https://sokuji.kizuna.ai wss://openspeech.bytedance.com wss://speech.platform.bing.com https://speech.platform.bing.com https://www.bing.com https://huggingface.co https://*.huggingface.co https://*.hf.co https://api.soniox.com wss://stt-rt.soniox.com wss://tts-rt.soniox.com https://tts-rt.soniox.com https://api.eu.soniox.com https://api.jp.soniox.com wss://stt-rt.eu.soniox.com wss://stt-rt.jp.soniox.com wss://tts-rt.eu.soniox.com wss://tts-rt.jp.soniox.com https://tts-rt.eu.soniox.com https://tts-rt.jp.soniox.com"
   }
 }
`````

`extension/vite.config.ts`

`````diff t04
diff --git a/extension/vite.config.ts b/extension/vite.config.ts
--- a/extension/vite.config.ts
+++ b/extension/vite.config.ts
@@ -172,15 +172,9 @@
       'import.meta.env.VITE_ENABLE_KIZUNA_SONIOX': JSON.stringify(
         envVal('VITE_ENABLE_KIZUNA_SONIOX', 'false', 'true')
       ),
-      'import.meta.env.VITE_ENABLE_KIZUNA_VOLCENGINE_AST2': JSON.stringify(
-        envVal('VITE_ENABLE_KIZUNA_VOLCENGINE_AST2', 'false', 'true')
-      ),
       'import.meta.env.VITE_ENABLE_PALABRA_AI': JSON.stringify(
         envVal('VITE_ENABLE_PALABRA_AI', 'false')
       ),
-      'import.meta.env.VITE_ENABLE_VOLCENGINE_AST2': JSON.stringify(
-        envVal('VITE_ENABLE_VOLCENGINE_AST2', 'false', 'true')
-      ),
       // The flagged providers a release offers (D19), one comma-separated
       // list. Dev builds offer every flagged provider in code, so there is no
       // dev override here.
`````

`package-lock.json`

`````diff t04
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -41,7 +41,6 @@
         "@types/react": "^19.2.17",
         "@types/react-dom": "^19.2.3",
         "@types/react-router-dom": "^5.3.3",
-        "@types/uuid": "^10.0.0",
         "@types/ws": "^8.18.1",
         "@vitejs/plugin-react": "^5.1.4",
         "ajv": "^8.17.1",
@@ -73,7 +72,6 @@
         "sass": "^1.101.6",
         "tsx": "^4.23.1",
         "typescript": "^5.8.3",
-        "uuid": "^11.1.0",
         "vite": "^8.1.5",
         "vite-plugin-electron": "^1.1.0",
         "vite-plugin-electron-renderer": "^1.0.0",
@@ -4267,13 +4265,6 @@
       "dev": true,
       "license": "MIT"
     },
-    "node_modules/@types/uuid": {
-      "version": "10.0.0",
-      "resolved": "https://registry.npmjs.org/@types/uuid/-/uuid-10.0.0.tgz",
-      "integrity": "sha512-7gqG38EyHgyP1S+7+xomFtL+ZNHcKv6DwNaCZmJmo1vgMugyF3TCnXVg4t1uk89mLNwnLtnY3TpOpCOyp1/xHQ==",
-      "dev": true,
-      "license": "MIT"
-    },
     "node_modules/@types/wrap-ansi": {
       "version": "3.0.0",
       "resolved": "https://registry.npmjs.org/@types/wrap-ansi/-/wrap-ansi-3.0.0.tgz",
@@ -13380,20 +13371,6 @@
       "dev": true,
       "license": "MIT"
     },
-    "node_modules/uuid": {
-      "version": "11.1.1",
-      "resolved": "https://registry.npmjs.org/uuid/-/uuid-11.1.1.tgz",
~ 9 more removed lines sha256:73b6e01d0485
-      }
-    },
     "node_modules/validate-npm-package-license": {
       "version": "3.0.4",
       "resolved": "https://registry.npmjs.org/validate-npm-package-license/-/validate-npm-package-license-3.0.4.tgz",
`````

`package.json`

`````diff t04
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -166,7 +166,6 @@
     "@types/react": "^19.2.17",
     "@types/react-dom": "^19.2.3",
     "@types/react-router-dom": "^5.3.3",
-    "@types/uuid": "^10.0.0",
     "@types/ws": "^8.18.1",
     "@vitejs/plugin-react": "^5.1.4",
     "ajv": "^8.17.1",
@@ -198,7 +197,6 @@
     "sass": "^1.101.6",
     "tsx": "^4.23.1",
     "typescript": "^5.8.3",
-    "uuid": "^11.1.0",
     "vite": "^8.1.5",
     "vite-plugin-electron": "^1.1.0",
     "vite-plugin-electron-renderer": "^1.0.0",
`````

`src/components/SetupWizard/SetupWizard.test.tsx`

`````diff t04
diff --git a/src/components/SetupWizard/SetupWizard.test.tsx b/src/components/SetupWizard/SetupWizard.test.tsx
--- a/src/components/SetupWizard/SetupWizard.test.tsx
+++ b/src/components/SetupWizard/SetupWizard.test.tsx
@@ -4,9 +4,8 @@
 vi.mock('../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true, isKizunaSonioxEnabled: () => true,
-  isKizunaVolcengineAST2Enabled: () => false,
   isPalabraAIEnabled: () => true, isLocalNativeEnabled: () => true,
-  isElectron: () => true, isExtension: () => false, getRelayWsUrl: () => 'wss://r.example/v1',
+  isElectron: () => true, isExtension: () => false,
 }));
 // The detected interface language, as i18next reports it. Mutable so a test can
 // render the wizard "in Japanese" the way a first-run user in Japan gets it.
`````

`src/components/SetupWizard/providerPaths.test.ts`

`````diff t04
diff --git a/src/components/SetupWizard/providerPaths.test.ts b/src/components/SetupWizard/providerPaths.test.ts
--- a/src/components/SetupWizard/providerPaths.test.ts
+++ b/src/components/SetupWizard/providerPaths.test.ts
@@ -4,12 +4,10 @@
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
   isKizunaSonioxEnabled: () => true,
-  isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
-  getRelayWsUrl: () => 'wss://r.example/v1',
 }));
 import { Provider } from '../../types/Provider';
 import {
`````

`src/components/SetupWizard/steps/StepCredentials.test.tsx`

`````diff t04
diff --git a/src/components/SetupWizard/steps/StepCredentials.test.tsx b/src/components/SetupWizard/steps/StepCredentials.test.tsx
--- a/src/components/SetupWizard/steps/StepCredentials.test.tsx
+++ b/src/components/SetupWizard/steps/StepCredentials.test.tsx
@@ -4,9 +4,8 @@
 vi.mock('../../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true, isKizunaSonioxEnabled: () => true,
-  isKizunaVolcengineAST2Enabled: () => false,
   isPalabraAIEnabled: () => true, isLocalNativeEnabled: () => true,
-  isElectron: () => true, isExtension: () => false, getRelayWsUrl: () => 'wss://r.example/v1',
+  isElectron: () => true, isExtension: () => false,
 }));
 // Keys, not defaults: the field label's default is the slice key itself, which
 // is the very thing these tests vary.
`````

`src/lib/diagnostics/redact.ts`

`````diff t04
diff --git a/src/lib/diagnostics/redact.ts b/src/lib/diagnostics/redact.ts
--- a/src/lib/diagnostics/redact.ts
+++ b/src/lib/diagnostics/redact.ts
@@ -48,8 +48,8 @@
   ],
   // `Authorization: Bearer <token>` on every provider fetch.
   [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, `$1${REDACTED}`],
-  // `sokuji-auth.${this.apiKey}` WebSocket subprotocol — OpenAITranslateGAClient.ts:707,
-  // VolcengineAST2Client (relay auth).
+  // `sokuji-auth.${this.apiKey}` WebSocket subprotocol — OpenAITranslateGAClient.ts:707
+  // (relay auth).
   [/(\bsokuji-auth\.)[A-Za-z0-9._~+/=-]+/g, `$1${REDACTED}`],
   // `openai-insecure-api-key.${apiKey}` WebSocket subprotocol — OpenAI
   // Translate's own key (`openai_translate/wire.ts` `translateProtocols`,
`````

`src/lib/setup/providerPath.test.ts`

`````diff t04
diff --git a/src/lib/setup/providerPath.test.ts b/src/lib/setup/providerPath.test.ts
--- a/src/lib/setup/providerPath.test.ts
+++ b/src/lib/setup/providerPath.test.ts
@@ -15,8 +15,7 @@
  *  compile with a member missing, and the count check below refuses to run with
  *  a row for a member the enum no longer has. */
 const EXPECTED: Record<Provider, ProviderPath> = {
-  // Backend-managed twins: Kizuna AI holds the key, the user signs in.
-  [Provider.KIZUNA_AI_VOLCENGINE_AST2]: 'managed',
+  // Backend-managed: Kizuna AI holds the key, the user signs in.
   [Provider.KIZUNA_AI_SONIOX]: 'managed',
   // Local engines: nothing leaves the machine, models download instead.
   [Provider.LOCAL_INFERENCE]: 'offline',
`````

`src/locales/locales.consistency.test.ts`

`````diff t04
diff --git a/src/locales/locales.consistency.test.ts b/src/locales/locales.consistency.test.ts
--- a/src/locales/locales.consistency.test.ts
+++ b/src/locales/locales.consistency.test.ts
@@ -7,12 +7,10 @@
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
-  getRelayWsUrl: () => 'wss://r.example/v1',
 }));
 import { ProviderConfigFactory } from '../services/providers/ProviderConfigFactory';
 import en from './en/translation.json';
`````

`src/providers/volcengine_ast2/adapter.ts`

`````diff t04
diff --git a/src/providers/volcengine_ast2/adapter.ts b/src/providers/volcengine_ast2/adapter.ts
--- a/src/providers/volcengine_ast2/adapter.ts
+++ b/src/providers/volcengine_ast2/adapter.ts
@@ -1,7 +1,7 @@
 /**
  * Doubao AST 2.0 on the new contract (spec: "L0 — the client contract"),
- * ported from `VolcengineAST2Client` (`src/services/clients/`, still
- * compiled until the deletion plan) without its display bookkeeping: items,
+ * ported from `VolcengineAST2Client` (`src/services/clients/`, deleted
+ * since: Stage 2 deletion, ruling 2) without its display bookkeeping: items,
  * ids and the punctuation lane are L1's and L2's now. One protobuf socket
  * per leg, its credentials in the URL's query (ruling 2); subtitles become
  * segments (`segments.ts`), spoken sentences audio (`speech.ts`) — each
`````

`src/providers/volcengine_ast2/codec.test.ts`

`````diff t04
diff --git a/src/providers/volcengine_ast2/codec.test.ts b/src/providers/volcengine_ast2/codec.test.ts
--- a/src/providers/volcengine_ast2/codec.test.ts
+++ b/src/providers/volcengine_ast2/codec.test.ts
@@ -1,21 +1,14 @@
 /**
- * The generated protobuf codec in its new home (F18): one module, reached
- * from the old path through a re-export, and the messages this provider
- * speaks round-trip through it. The old path is read here only, as the
- * stub's pin: new code imports nothing from `src/services`.
+ * The generated protobuf codec in its home (F18): the messages this provider
+ * speaks round-trip through it.
  */
 import { describe, it, expect } from 'vitest';
 import { data as moved } from './proto/ast2-proto.js';
-import { data as old } from '../../services/clients/volcengine-ast2/ast2-proto.js';
 
 const { TranslateRequest, TranslateResponse } = moved.speech.ast;
 const Type = moved.speech.event.Type;
 
 describe("Doubao AST 2.0's codec (F18)", () => {
-  it('is one module: the old path re-exports the moved one', () => {
-    expect(old).toBe(moved);
-  });
-
   it('names its events both ways', () => {
     expect(Type.StartSession).toBe(100);
     expect(Type.SessionStarted).toBe(150);
`````

`src/services/interfaces/IClient.ts`

`````diff t04
diff --git a/src/services/interfaces/IClient.ts b/src/services/interfaces/IClient.ts
--- a/src/services/interfaces/IClient.ts
+++ b/src/services/interfaces/IClient.ts
@@ -195,22 +195,6 @@
   autoTempo: boolean;
 }
 
-/**
- * Volcengine AST 2.0 session configuration (s2s mode)
- */
~ 11 more removed lines sha256:054cd75b1424
-}
-
 /**
  * Soniox speech-to-speech translation session configuration.
  * `voice` comes from BaseSessionConfig. When `bidirectional` is true the
@@ -304,7 +288,7 @@
 /**
  * Union type for all possible session configurations
  */
-export type SessionConfig = OpenAISessionConfig | OpenAITranslateSessionConfig | GeminiSessionConfig | PalabraAISessionConfig | VolcengineAST2SessionConfig | SonioxSessionConfig | LocalInferenceSessionConfig | LocalNativeSessionConfig;
+export type SessionConfig = OpenAISessionConfig | OpenAITranslateSessionConfig | GeminiSessionConfig | PalabraAISessionConfig | SonioxSessionConfig | LocalInferenceSessionConfig | LocalNativeSessionConfig;
 
 /**
  * Type guards for session configurations
@@ -328,10 +312,6 @@
   return config.provider === 'palabraai';
 }
 
-export function isVolcengineAST2SessionConfig(config: SessionConfig): config is VolcengineAST2SessionConfig {
-  return config.provider === 'volcengine_ast2';
-}
-
 export function isSonioxSessionConfig(config: SessionConfig): config is SonioxSessionConfig {
   return config.provider === 'soniox';
 }
`````

`src/services/providers/ProviderConfigFactory.ts`

`````diff t04
diff --git a/src/services/providers/ProviderConfigFactory.ts b/src/services/providers/ProviderConfigFactory.ts
--- a/src/services/providers/ProviderConfigFactory.ts
+++ b/src/services/providers/ProviderConfigFactory.ts
@@ -5,14 +5,12 @@
 import { OpenAICompatibleProviderConfig } from './OpenAICompatibleProviderConfig';
 import { OpenAITranslateProviderConfig } from './OpenAITranslateProviderConfig';
 import { PalabraAIProviderConfig } from './PalabraAIProviderConfig';
-import { KizunaAIVolcengineAST2ProviderConfig } from './KizunaAIVolcengineAST2ProviderConfig';
 import { KizunaAISonioxProviderConfig } from './KizunaAISonioxProviderConfig';
-import { VolcengineAST2ProviderConfig } from './VolcengineAST2ProviderConfig';
 import { LocalInferenceProviderConfig } from './LocalInferenceProviderConfig';
 import { LocalNativeProviderConfig } from './LocalNativeProviderConfig';
 import { SonioxProviderConfig } from './SonioxProviderConfig';
 import { Provider, ProviderType } from '../../types/Provider';
-import { isKizunaAIEnabled, isKizunaSonioxEnabled, isKizunaVolcengineAST2Enabled, isPalabraAIEnabled, isLocalNativeEnabled, isElectron, isExtension } from '../../utils/environment';
+import { isKizunaAIEnabled, isKizunaSonioxEnabled, isPalabraAIEnabled, isLocalNativeEnabled, isElectron } from '../../utils/environment';
 
 export class ProviderConfigFactory {
   private static configs: Map<ProviderType, ProviderDescriptor> = new Map();
@@ -35,9 +33,6 @@
       if (isKizunaSonioxEnabled()) {
         ProviderConfigFactory.configs.set(Provider.KIZUNA_AI_SONIOX, new KizunaAISonioxProviderConfig());
       }
-      if (isKizunaVolcengineAST2Enabled()) {
-        ProviderConfigFactory.configs.set(Provider.KIZUNA_AI_VOLCENGINE_AST2, new KizunaAIVolcengineAST2ProviderConfig());
-      }
     }
 
     // 2. Free (local inference) — always available, no API key or flag.
@@ -46,13 +41,6 @@
     // 3. Gemini
     ProviderConfigFactory.configs.set(Provider.GEMINI, new GeminiProviderConfig());
 
-    // 4. Doubao AST 2.0 — always available, but only in Electron (IPC proxy) and
-    //    the extension (declarativeNetRequest header injection), which it
-    //    technically requires.
-    if (isElectron() || isExtension()) {
-      ProviderConfigFactory.configs.set(Provider.VOLCENGINE_AST2, new VolcengineAST2ProviderConfig());
-    }
-
     // 5. The OpenAI providers: Realtime, Translate.
     ProviderConfigFactory.configs.set(Provider.OPENAI, new OpenAIProviderConfig());
     ProviderConfigFactory.configs.set(Provider.OPENAI_TRANSLATE, new OpenAITranslateProviderConfig());
@@ -141,13 +129,11 @@
    * Translate twin would set a provider `getDescriptor` then throws on.
    *
    * Soniox first: it is the only managed provider open in production, and
-   * the wallet page states its rates. The twins stay as fallbacks for
-   * builds that register them alone.
+   * the wallet page states its rates.
    */
   static getDefaultManagedProvider(): ProviderType | null {
     const preferred = [
       Provider.KIZUNA_AI_SONIOX,
-      Provider.KIZUNA_AI_VOLCENGINE_AST2,
     ];
     return preferred.find((p) => this.configs.has(p)) ?? null;
   }
`````

`src/services/providers/descriptorRegistry.test.ts`

`````diff t04
diff --git a/src/services/providers/descriptorRegistry.test.ts b/src/services/providers/descriptorRegistry.test.ts
--- a/src/services/providers/descriptorRegistry.test.ts
+++ b/src/services/providers/descriptorRegistry.test.ts
@@ -1,35 +1,30 @@
 import { describe, it, expect, vi } from 'vitest';
 // Force the remaining provider gates on — Kizuna/Palabra/Local-Native feature
 // flags plus Electron/Extension platform detection — so ALL descriptors register
-// regardless of build env. (Volcengine AST2 is now always-on, no flag.)
+// regardless of build env.
 vi.mock('../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
-  getRelayWsUrl: () => 'wss://r.example/v1',
 }));
 import { ProviderConfigFactory } from './ProviderConfigFactory';
 import { resolveSegmentationOffer } from './ProviderConfig';
 import type { SegmentationOffer } from '../../lib/segmentation/segmentationMode';
 import { DEFAULT_CHUNK_SENTENCES, DEFAULT_SEGMENT_PAUSE_MS } from '../../lib/segmentation/segmentationMode';
 import { Provider } from '../../types/Provider';
-import { VolcengineAST2Client } from '../clients/VolcengineAST2Client';
 import { defaultOpenAISettings } from './OpenAIProviderConfig';
 import { defaultOpenAICompatibleSettings } from './OpenAICompatibleProviderConfig';
 import { defaultOpenAITranslateSettings } from './OpenAITranslateProviderConfig';
 import { defaultGeminiSettings } from './GeminiProviderConfig';
 import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
-import { defaultVolcengineAST2Settings } from './VolcengineAST2ProviderConfig';
 import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
 import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
-import { defaultKizunaVolcengineAst2Settings } from './KizunaAIVolcengineAST2ProviderConfig';
 import { defaultKizunaSonioxSettings } from './KizunaAISonioxProviderConfig';
 import { defaultSonioxSettings } from './SonioxProviderConfig';
 import { ManagedSonioxSession } from '../clients/ManagedSonioxSession';
@@ -44,10 +39,8 @@
   openaiTranslate: defaultOpenAITranslateSettings,
   gemini: defaultGeminiSettings,
   palabraai: defaultPalabraAISettings,
-  volcengineAST2: defaultVolcengineAST2Settings,
   localInference: defaultLocalInferenceSettings,
   localNative: defaultLocalNativeSettings,
-  kizunaVolcengineAst2: defaultKizunaVolcengineAst2Settings,
   kizunaSoniox: defaultKizunaSonioxSettings,
   soniox: defaultSonioxSettings,
 };
@@ -55,7 +48,7 @@
 describe('provider registry descriptors', () => {
   it('returns a descriptor for every available provider', () => {
     const ids = ProviderConfigFactory.getAvailableProviders();
-    expect(ids.length).toBe(11);
+    expect(ids.length).toBe(9);
     for (const id of ids) {
       const d = ProviderConfigFactory.getDescriptor(id);
       expect(d.getConfig().id).toBe(id);
@@ -93,19 +86,12 @@
   it('constructs a client for every available provider', () => {
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
       const client = ProviderConfigFactory.getDescriptor(id).createClient(creds, optionsFor(id));
-      expect(client.getProvider()).toBe(id === Provider.KIZUNA_AI_VOLCENGINE_AST2 ? Provider.VOLCENGINE_AST2
-        : id === Provider.KIZUNA_AI_SONIOX ? Provider.SONIOX
+      expect(client.getProvider()).toBe(id === Provider.KIZUNA_AI_SONIOX ? Provider.SONIOX
         : id === Provider.OPENAI_COMPATIBLE ? Provider.OPENAI
         : id);
     }
   });
 
-  it('kizuna doubao twin routes to relay VolcengineAST2Client', () => {
-    const c = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_VOLCENGINE_AST2)
-      .createClient({ ok: true, primary: 'sess_TOKEN' }, ws);
-    expect(c).toBeInstanceOf(VolcengineAST2Client);
-  });
-
   it('kizuna soniox twin routes to a managed-mode SonioxClient built from the session', async () => {
     const { SonioxClient } = await import('../clients/SonioxClient');
     const c = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX)
@@ -141,20 +127,12 @@
   });
 });
 
-describe('descriptor.latestRealtimeModel', () => {
-  it('fixed-model providers return their identifier', () => {
-    expect(ProviderConfigFactory.getDescriptor(Provider.VOLCENGINE_AST2).latestRealtimeModel([])).toBe('ast-v2-s2s');
-    expect(ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_VOLCENGINE_AST2).latestRealtimeModel([])).toBe('ast-v2-s2s');
-  });
-});
-
 describe('descriptor.extractCredentials', () => {
   it('normalizes each provider credential shape', async () => {
     const cases: Array<[Provider, object, { primary: string; secret?: string; endpoint?: string }]> = [
       [Provider.OPENAI, { apiKey: 'sk-1' }, { primary: 'sk-1' }],
       [Provider.OPENAI_COMPATIBLE, { apiKey: 'k', customEndpoint: 'https://e' }, { primary: 'k', endpoint: 'https://e' }],
       [Provider.PALABRA_AI, { clientId: 'id', clientSecret: 'sec' }, { primary: 'id', secret: 'sec' }],
-      [Provider.VOLCENGINE_AST2, { appId: 123, accessToken: 'tok' }, { primary: '123', secret: 'tok' }],
     ];
     for (const [id, slice, want] of cases) {
       const got = await ProviderConfigFactory.getDescriptor(id).extractCredentials(slice, {});
@@ -188,9 +166,8 @@
     const wireTag: Record<string, string> = {
       openai: 'openai', openai_compatible: 'openai', openai_translate: 'openai_translate',
       gemini: 'gemini', palabraai: 'palabraai',
-      volcengine_ast2: 'volcengine_ast2', local_inference: 'local_inference',
+      local_inference: 'local_inference',
       local_native: 'local_native',
-      kizunaai_volcengine_ast2: 'volcengine_ast2',
       soniox: 'soniox', kizunaai_soniox: 'soniox',
     };
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
@@ -247,12 +224,10 @@
     [Provider.OPENAI_TRANSLATE]: 'openaiTranslate',
     [Provider.GEMINI]: 'gemini',
     [Provider.PALABRA_AI]: 'palabraai',
-    [Provider.VOLCENGINE_AST2]: 'volcengineAST2',
     [Provider.LOCAL_INFERENCE]: 'localInference',
     // Registered only under Electron with its gate on — both forced on by
     // this file's environment mock.
     [Provider.LOCAL_NATIVE]: 'localNative',
-    [Provider.KIZUNA_AI_VOLCENGINE_AST2]: 'kizunaVolcengineAst2',
     [Provider.KIZUNA_AI_SONIOX]: 'kizunaSoniox',
     [Provider.SONIOX]: 'soniox',
   };
@@ -272,10 +247,8 @@
     [Provider.OPENAI_TRANSLATE]: true,
     [Provider.GEMINI]: false,
     [Provider.PALABRA_AI]: false,
-    [Provider.VOLCENGINE_AST2]: false,
     [Provider.LOCAL_INFERENCE]: false,
     [Provider.LOCAL_NATIVE]: false,
-    [Provider.KIZUNA_AI_VOLCENGINE_AST2]: false,
     [Provider.KIZUNA_AI_SONIOX]: false,
     [Provider.SONIOX]: false,
   };
@@ -313,8 +286,6 @@
     [Provider.GEMINI]: ['Push-to-Talk', 'Push-to-Translate'],
     [Provider.LOCAL_INFERENCE]: ['Push-to-Talk', 'Push-to-Translate'],
     [Provider.LOCAL_NATIVE]: ['Push-to-Talk', 'Push-to-Translate'],
-    [Provider.VOLCENGINE_AST2]: ['Push-to-Talk', 'Push-to-Translate'],
-    [Provider.KIZUNA_AI_VOLCENGINE_AST2]: ['Push-to-Talk', 'Push-to-Translate'], // twin spread
     [Provider.OPENAI_TRANSLATE]: undefined,
     [Provider.SONIOX]: undefined,
     [Provider.KIZUNA_AI_SONIOX]: undefined,
@@ -330,8 +301,6 @@
     [Provider.OPENAI_TRANSLATE]: undefined,
     [Provider.SONIOX]: undefined,
     [Provider.KIZUNA_AI_SONIOX]: undefined,
-    [Provider.VOLCENGINE_AST2]: undefined,
-    [Provider.KIZUNA_AI_VOLCENGINE_AST2]: undefined,
     [Provider.PALABRA_AI]: undefined,
   };
 
@@ -341,8 +310,6 @@
   const PTT_FINALIZATION: Partial<Record<Provider, { silenceTailFrames?: number; response: string } | undefined>> = {
     [Provider.LOCAL_INFERENCE]: { silenceTailFrames: 7, response: 'always' },
     [Provider.LOCAL_NATIVE]: { silenceTailFrames: 7, response: 'always' },
-    [Provider.VOLCENGINE_AST2]: { silenceTailFrames: 5, response: 'server-decides' },
-    [Provider.KIZUNA_AI_VOLCENGINE_AST2]: { silenceTailFrames: 5, response: 'server-decides' }, // twin spread
     [Provider.GEMINI]: { response: 'voice-gated-cancel' },
     [Provider.OPENAI]: undefined,
     [Provider.OPENAI_COMPATIBLE]: undefined,
@@ -368,16 +335,13 @@
     [Provider.LOCAL_NATIVE]: { pause: false, auto: true, sizes: true },
 
     // A server decides the outer boundary, and phase 2 can cut inside it.
-    // Two of them DO attach audio to an item — Soniox's `formatted.audio` and
-    // AST2's `decodeTTSAndPlay` target — and the ruling is that it stays on
-    // the FIRST piece: it is the whole segment's audio, there is no
-    // per-sentence timing to cut it on, and the first bubble is where a user
-    // reaches for the replay button. Palabra writes text only. Auto stays
-    // what it always was — keep the server's segment.
+    // Soniox DOES attach audio to an item — its `formatted.audio` — and the
+    // ruling is that it stays on the FIRST piece: it is the whole segment's
+    // audio, there is no per-sentence timing to cut it on, and the first
+    // bubble is where a user reaches for the replay button. Palabra writes
+    // text only. Auto stays what it always was — keep the server's segment.
     [Provider.SONIOX]: { pause: false, auto: true, sizes: true },
     [Provider.KIZUNA_AI_SONIOX]: { pause: false, auto: true, sizes: true }, // twin spread
-    [Provider.VOLCENGINE_AST2]: { pause: false, auto: true, sizes: true },
-    [Provider.KIZUNA_AI_VOLCENGINE_AST2]: { pause: false, auto: true, sizes: true }, // twin spread
     [Provider.PALABRA_AI]: { pause: false, auto: true, sizes: true },
 
     // Also the default, and it stays there: the GA client attaches audio to
@@ -398,8 +362,6 @@
   const SILENCE_DURATION: Partial<Record<Provider, boolean>> = {
     [Provider.OPENAI]: true,
     [Provider.OPENAI_COMPATIBLE]: true, // inherited via ...base
-    [Provider.VOLCENGINE_AST2]: false,
-    [Provider.KIZUNA_AI_VOLCENGINE_AST2]: false, // twin spread
     [Provider.OPENAI_TRANSLATE]: false,
     [Provider.GEMINI]: false,
     [Provider.PALABRA_AI]: false,
@@ -629,19 +591,6 @@
   // façades accept raw positional args — they must keep the old contract of
   // rejecting incomplete credentials instead of reaching provider clients
   // with `secret: undefined`.
-  it('two-field providers reject a filled primary with a missing secret', async () => {
-    const { ClientOperations } = await import('../ClientOperations');
-    const cases: Array<[Provider, RegExp]> = [
~ 8 more removed lines sha256:991a59957df3
-  });
-
   // PalabraAI is no longer a synchronous two-field guard: a missing `secret` is
   // the documented signal for platform-mode (API key) credentials (see
   // PalabraAIProviderConfig.toPalabraCredentials), so a legacy caller passing
`````

`src/services/providers/kizunaProviderGating.test.ts`

`````diff t04
diff --git a/src/services/providers/kizunaProviderGating.test.ts b/src/services/providers/kizunaProviderGating.test.ts
--- a/src/services/providers/kizunaProviderGating.test.ts
+++ b/src/services/providers/kizunaProviderGating.test.ts
@@ -26,12 +26,10 @@
 interface Gates {
   master?: boolean;
   soniox?: boolean;
-  volcengineAst2?: boolean;
 }
 
 const MANAGED = [
   Provider.KIZUNA_AI_SONIOX,
-  Provider.KIZUNA_AI_VOLCENGINE_AST2,
 ] as const;
 
 /** Fresh module graph per case: the config map is static, so a module reused
@@ -42,12 +40,10 @@
     ...(await orig<any>()),
     isKizunaAIEnabled: () => gates.master ?? true,
     isKizunaSonioxEnabled: () => gates.soniox ?? false,
-    isKizunaVolcengineAST2Enabled: () => gates.volcengineAst2 ?? false,
     isPalabraAIEnabled: () => false,
     isLocalNativeEnabled: () => false,
     isElectron: () => true,
     isExtension: () => false,
-    getRelayWsUrl: () => 'wss://r.example/v1',
   }));
 }
 
@@ -71,27 +67,6 @@
     const providers = await providersWith({ soniox: true });
 
     expect(providers).toContain(Provider.KIZUNA_AI_SONIOX);
-    expect(providers).not.toContain(Provider.KIZUNA_AI_VOLCENGINE_AST2);
-  });
-
~ 16 more removed lines sha256:2e6d5d5fb1de
-      expect(providers).toContain(p);
-    }
   });
 
   it('offers none when every gate is closed', async () => {
@@ -109,7 +84,6 @@
     const providers = await providersWith({
       master: false,
       soniox: true,
-      volcengineAst2: true,
     });
 
     for (const p of MANAGED) {
@@ -144,28 +118,6 @@
     expect(() => factory.getDescriptor(target!)).not.toThrow();
   });
 
-  it('prefers managed Soniox where it is registered alongside the twin', async () => {
-    const factory = await factoryWith({
-      soniox: true,
~ 17 more removed lines sha256:007fc9aab94a
-  });
-
   it('returns null rather than an unusable provider when none is registered', async () => {
     const factory = await factoryWith({ master: false });
 
@@ -198,45 +150,10 @@
     expect(ProviderConfigFactory.isProviderSupported(migrated)).toBe(true);
   });
 
-  it('sends a legacy user to managed Soniox even where the twins are registered', async () => {
-    const { migrateLegacyKizunaProvider, ProviderConfigFactory } = await migrateWith({
-      soniox: true,
~ 27 more removed lines sha256:d5542dcc4126
-  });
-
   // Redirecting is only for providers this build cannot offer. A registered
   // one is the user's actual choice and must survive untouched.
   it('leaves a registered provider exactly as the user chose it', async () => {
-    const { migrateLegacyKizunaProvider } = await migrateWith({
-      soniox: true,
-      volcengineAst2: true,
-    });
+    const { migrateLegacyKizunaProvider } = await migrateWith({ soniox: true });
 
     for (const p of MANAGED) {
       expect(migrateLegacyKizunaProvider(p)).toBe(p);
`````

`src/services/providers/participantConfig.test.ts`

`````diff t04
diff --git a/src/services/providers/participantConfig.test.ts b/src/services/providers/participantConfig.test.ts
--- a/src/services/providers/participantConfig.test.ts
+++ b/src/services/providers/participantConfig.test.ts
@@ -6,12 +6,10 @@
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
-  getRelayWsUrl: () => 'wss://r.example/v1',
 }));
 
 vi.mock('./localParticipantConfig', () => ({
@@ -22,7 +20,6 @@
 import { ProviderConfigFactory } from './ProviderConfigFactory';
 import { Provider } from '../../types/Provider';
 import { defaultSonioxSettings } from './SonioxProviderConfig';
-import { defaultVolcengineAST2Settings } from './VolcengineAST2ProviderConfig';
 import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
 import { defaultGeminiSettings } from './GeminiProviderConfig';
 import { defaultOpenAISettings } from './OpenAIProviderConfig';
@@ -94,17 +91,6 @@
     }
   });
 
-  it('volcengine_ast2 swaps sourceLanguage/targetLanguage (twin inherits)', () => {
-    for (const id of [Provider.VOLCENGINE_AST2, Provider.KIZUNA_AI_VOLCENGINE_AST2]) {
-      const d = ProviderConfigFactory.getDescriptor(id);
-      const slice = { ...defaultVolcengineAST2Settings, sourceLanguage: 'ja', targetLanguage: 'ko' };
-      const base = d.buildSessionConfig(slice, 'i') as { sourceLanguage?: string; targetLanguage?: string };
-      const c = d.buildParticipantSessionConfig(slice, 'i', shell).config as { sourceLanguage?: string; targetLanguage?: string };
-      expect(c.sourceLanguage, `swap for ${id}`).toBe(base.targetLanguage);
-      expect(c.targetLanguage, `swap for ${id}`).toBe(base.sourceLanguage);
-    }
-  });
-
   it('palabraai swaps sourceLanguage/targetLanguage', () => {
     const d = ProviderConfigFactory.getDescriptor(Provider.PALABRA_AI);
     const slice = { ...defaultPalabraAISettings, sourceLanguage: 'en', targetLanguage: 'es-mx' };
`````

`src/services/providers/prepareToStart.kizunaSoniox.test.ts`

`````diff t04
diff --git a/src/services/providers/prepareToStart.kizunaSoniox.test.ts b/src/services/providers/prepareToStart.kizunaSoniox.test.ts
--- a/src/services/providers/prepareToStart.kizunaSoniox.test.ts
+++ b/src/services/providers/prepareToStart.kizunaSoniox.test.ts
@@ -6,12 +6,10 @@
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
-  getRelayWsUrl: () => 'wss://r.example/v1',
 }));
 
 // The real module (src/locales/index.ts) preloads en/translation.json and
`````

`src/services/providers/prepareToStart.local.test.ts`

`````diff t04
diff --git a/src/services/providers/prepareToStart.local.test.ts b/src/services/providers/prepareToStart.local.test.ts
--- a/src/services/providers/prepareToStart.local.test.ts
+++ b/src/services/providers/prepareToStart.local.test.ts
@@ -6,12 +6,10 @@
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
-  getRelayWsUrl: () => 'wss://r.example/v1',
 }));
 
 // The real module (src/locales/index.ts) preloads en/translation.json and
`````

`src/services/providers/providerOrder.test.ts`

`````diff t04
diff --git a/src/services/providers/providerOrder.test.ts b/src/services/providers/providerOrder.test.ts
--- a/src/services/providers/providerOrder.test.ts
+++ b/src/services/providers/providerOrder.test.ts
@@ -10,12 +10,10 @@
     ...(await orig<any>()),
     isKizunaAIEnabled: () => true,
     isKizunaSonioxEnabled: () => true,
-    isKizunaVolcengineAST2Enabled: () => true,
     isPalabraAIEnabled: () => true,
     isLocalNativeEnabled: () => true,
     isElectron: () => true,
     isExtension: () => false,
-    getRelayWsUrl: () => 'wss://r.example/v1',
   }));
   const { ProviderConfigFactory } = await import('./ProviderConfigFactory');
   return ProviderConfigFactory.getAvailableProviders();
@@ -35,10 +33,8 @@
 
     expect(ids).toEqual([
       Provider.KIZUNA_AI_SONIOX,
-      Provider.KIZUNA_AI_VOLCENGINE_AST2,
       Provider.LOCAL_INFERENCE,
       Provider.GEMINI,
-      Provider.VOLCENGINE_AST2,
       Provider.OPENAI,
       Provider.OPENAI_TRANSLATE,
       Provider.SONIOX,
@@ -57,12 +53,10 @@
       ...(await orig<any>()),
       isKizunaAIEnabled: () => false,
       isKizunaSonioxEnabled: () => false,
-        isKizunaVolcengineAST2Enabled: () => false,
       isPalabraAIEnabled: () => false,
       isLocalNativeEnabled: () => false,
       isElectron: () => false,
       isExtension: () => false,
-      getRelayWsUrl: () => 'wss://r.example/v1',
     }));
     const { ProviderConfigFactory } = await import('./ProviderConfigFactory');
     const ids = ProviderConfigFactory.getAvailableProviders();
`````

`src/services/providers/sessionResourcesWiring.test.ts`

`````diff t04
diff --git a/src/services/providers/sessionResourcesWiring.test.ts b/src/services/providers/sessionResourcesWiring.test.ts
--- a/src/services/providers/sessionResourcesWiring.test.ts
+++ b/src/services/providers/sessionResourcesWiring.test.ts
@@ -9,12 +9,10 @@
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
-  getRelayWsUrl: () => 'wss://r.example/v1',
 }));
 
 // vi.hoisted: the mock factory below runs before these consts would otherwise
`````

`src/services/providers/voicePrepWiring.test.ts`

`````diff t04
diff --git a/src/services/providers/voicePrepWiring.test.ts b/src/services/providers/voicePrepWiring.test.ts
--- a/src/services/providers/voicePrepWiring.test.ts
+++ b/src/services/providers/voicePrepWiring.test.ts
@@ -9,12 +9,10 @@
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
-  getRelayWsUrl: () => 'wss://r.example/v1',
 }));
 
 // Only the NETWORK CORE is faked: prepareManagedVoice is the function that
`````

`src/stores/kizunaProviders.test.ts`

`````diff t04
diff --git a/src/stores/kizunaProviders.test.ts b/src/stores/kizunaProviders.test.ts
--- a/src/stores/kizunaProviders.test.ts
+++ b/src/stores/kizunaProviders.test.ts
@@ -1,21 +1,13 @@
 import { describe, it, expect } from "vitest";
-import { useSettingsStore, migrateLegacyKizunaProvider } from "./settingsStore";
+import { migrateLegacyKizunaProvider } from "./settingsStore";
 import { Provider } from "../types/Provider";
 
-describe("KizunaAI relay providers — session config", () => {
-  it("doubao twin builds a volcengine_ast2 config from its own slice", () => {
-    useSettingsStore.setState({ provider: Provider.KIZUNA_AI_VOLCENGINE_AST2 } as any);
-    const cfg: any = useSettingsStore.getState().createSessionConfig("instr");
-    expect(cfg.provider).toBe("volcengine_ast2");
-  });
-});
-
 describe("legacy kizunaai provider migration", () => {
   it("migrates a legacy 'kizunaai' provider to managed Soniox", () => {
     expect(migrateLegacyKizunaProvider("kizunaai" as any)).toBe(Provider.KIZUNA_AI_SONIOX);
   });
   it("leaves other providers unchanged", () => {
     expect(migrateLegacyKizunaProvider(Provider.OPENAI)).toBe(Provider.OPENAI);
-    expect(migrateLegacyKizunaProvider(Provider.KIZUNA_AI_VOLCENGINE_AST2)).toBe(Provider.KIZUNA_AI_VOLCENGINE_AST2);
+    expect(migrateLegacyKizunaProvider(Provider.KIZUNA_AI_SONIOX)).toBe(Provider.KIZUNA_AI_SONIOX);
   });
 });
`````

`src/stores/logStore.ts`

`````diff t04
diff --git a/src/stores/logStore.ts b/src/stores/logStore.ts
--- a/src/stores/logStore.ts
+++ b/src/stores/logStore.ts
@@ -96,14 +96,6 @@
     | 'translated_transcription'
     | 'output_audio_data'
     | 'current_task'
-    // Volcengine AST2. One client event, then whatever the server sent: the
-    // name is read out of the proto's `EventType` enum, so the exact set lives
-    // in the generated code rather than here, and an event the enum does not
-    // name arrives as `message.<number>`. The twelve the grouping switch below
-    // treats specially (SourceSubtitle*, TranslationSubtitle*, TTS*,
-    // UsageResponse, Audio{Muted,Unmuted}) are among them.
-    | 'start_session.sent'
-    | `message.${number}`
     // Sentence segmentation stage — diagnostics only, counts and durations,
     // never transcript text. They ride the events stream (which LogsPanel shows
     // and 'copy logs' exports) rather than the plain error/warning entries
@@ -468,25 +460,22 @@
         // Group PalabraAI current task response events together
         groupingKey = 'palabraai_current_task';
       }
-      // Volcengine AST2-specific grouping: the old client's names and the new
-      // adapter's `domain.event` frames (Stage 2 Volcengine AST2, choice 9);
-      // the old names go with the old client.
-      else if (eventType === 'SourceSubtitleResponse' || eventType === 'SourceSubtitleStart' || eventType === 'SourceSubtitleEnd'
-          || eventType === 'subtitle.source') {
+      // Doubao AST 2.0's grouping: the adapter's `domain.event` frames, under
+      // the keys its old client's names had (Stage 2 Volcengine AST2,
+      // choice 9).
+      else if (eventType === 'subtitle.source') {
         groupingKey = 'volcengine_source_subtitle';
       }
-      else if (eventType === 'TranslationSubtitleResponse' || eventType === 'TranslationSubtitleStart' || eventType === 'TranslationSubtitleEnd'
-          || eventType === 'subtitle.translation') {
+      else if (eventType === 'subtitle.translation') {
         groupingKey = 'volcengine_translation_subtitle';
       }
-      else if (eventType === 'TTSResponse' || eventType === 'TTSSentenceStart' || eventType === 'TTSSentenceEnd'
-          || eventType === 'tts.sentence_start' || eventType === 'tts.sentence_end' || eventType === 'tts.ended') {
+      else if (eventType === 'tts.sentence_start' || eventType === 'tts.sentence_end' || eventType === 'tts.ended') {
         groupingKey = 'volcengine_tts';
       }
-      else if (eventType === 'UsageResponse' || eventType === 'session.usage') {
+      else if (eventType === 'session.usage') {
         groupingKey = 'volcengine_usage';
       }
-      else if (eventType === 'AudioMuted' || eventType === 'AudioUnmuted' || eventType === 'session.audio_muted') {
+      else if (eventType === 'session.audio_muted') {
         groupingKey = 'volcengine_audio_mute';
       }
       // For other events, extract item_id if it exists (OpenAI)
`````

`src/stores/settingsStore.kizunaAuth.test.ts`

`````diff t04
diff --git a/src/stores/settingsStore.kizunaAuth.test.ts b/src/stores/settingsStore.kizunaAuth.test.ts
--- a/src/stores/settingsStore.kizunaAuth.test.ts
+++ b/src/stores/settingsStore.kizunaAuth.test.ts
@@ -20,7 +20,6 @@
   ...(await orig<Record<string, unknown>>()),
   isKizunaAIEnabled: () => true,
   isKizunaSonioxEnabled: () => true,
-  isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
`````

`src/stores/settingsStore.sliceRegistry.test.ts`

`````diff t04
diff --git a/src/stores/settingsStore.sliceRegistry.test.ts b/src/stores/settingsStore.sliceRegistry.test.ts
--- a/src/stores/settingsStore.sliceRegistry.test.ts
+++ b/src/stores/settingsStore.sliceRegistry.test.ts
@@ -31,7 +31,6 @@
   ['updateGemini', 'gemini', { apiKey: 'k1' }],
   ['updatePalabraAI', 'palabraai', { clientId: 'c1' }],
   ['updateOpenAITranslate', 'openaiTranslate', { apiKey: 'k2' }],
-  ['updateVolcengineAST2', 'volcengineAST2', { appId: 'p1' }],
   ['updateLocalInference', 'localInference', { ttsSpeed: 1.5 }],
   ['updateLocalNative', 'localNative', { sourceLanguage: 'ja' }],
   ['updateSoniox', 'soniox', { apiKey: 's1' }],
@@ -82,15 +81,15 @@
     }
   });
 
-  it('kizuna twins: credentials update in-memory state but are never persisted', async () => {
-    await useSettingsStore.getState().updateKizunaVolcengineAst2({ appId: 'a', accessToken: 't', sourceLanguage: 'zh' } as any);
+  it('the kizuna twin: credentials update in-memory state but are never persisted', async () => {
+    await useSettingsStore.getState().updateKizunaSoniox({ apiKey: 'a', apiKeyEu: 'e', sourceLanguage: 'zh' } as any);
     // Credentials land in state...
-    expect((useSettingsStore.getState() as any).kizunaVolcengineAst2.appId).toBe('a');
-    expect((useSettingsStore.getState() as any).kizunaVolcengineAst2.accessToken).toBe('t');
+    expect((useSettingsStore.getState() as any).kizunaSoniox.apiKey).toBe('a');
+    expect((useSettingsStore.getState() as any).kizunaSoniox.apiKeyEu).toBe('e');
     // ...but are never persisted.
-    expect(setSetting).not.toHaveBeenCalledWith('settings.kizunaVolcengineAst2.appId', expect.anything());
-    expect(setSetting).not.toHaveBeenCalledWith('settings.kizunaVolcengineAst2.accessToken', expect.anything());
-    expect(setSetting).toHaveBeenCalledWith('settings.kizunaVolcengineAst2.sourceLanguage', 'zh');
+    expect(setSetting).not.toHaveBeenCalledWith('settings.kizunaSoniox.apiKey', expect.anything());
+    expect(setSetting).not.toHaveBeenCalledWith('settings.kizunaSoniox.apiKeyEu', expect.anything());
+    expect(setSetting).toHaveBeenCalledWith('settings.kizunaSoniox.sourceLanguage', 'zh');
   });
 
   // The registry used to carry `persistErrors: 'throw' | 'swallow'`, split 6/6,
@@ -112,8 +111,6 @@
     ['updateOpenAICompatible', 'openaiCompatible', { apiKey: 'x' }],
     ['updatePalabraAI', 'palabraai', { clientId: 'x' }],
     ['updateOpenAITranslate', 'openaiTranslate', { apiKey: 'x' }],
-    ['updateVolcengineAST2', 'volcengineAST2', { appId: 'x' }],
-    ['updateKizunaVolcengineAst2', 'kizunaVolcengineAst2', { sourceLanguage: 'zh' }],
     ['updateLocalInference', 'localInference', { ttsSpeed: 1.5 }],
     ['updateLocalNative', 'localNative', { sourceLanguage: 'ja' }],
   ];
@@ -166,8 +163,7 @@
     // Spot every slice key is a populated object after load.
     for (const sliceKey of [
       'openai', 'gemini', 'openaiCompatible', 'palabraai', 'openaiTranslate',
-      'volcengineAST2',
-      'kizunaVolcengineAst2', 'localInference', 'localNative',
+      'localInference', 'localNative',
     ]) {
       expect(s[sliceKey], sliceKey).toBeTypeOf('object');
       expect(Object.keys(s[sliceKey]).length, sliceKey).toBeGreaterThan(0);
`````

`src/stores/settingsStore.test.ts`

`````diff t04
diff --git a/src/stores/settingsStore.test.ts b/src/stores/settingsStore.test.ts
--- a/src/stores/settingsStore.test.ts
+++ b/src/stores/settingsStore.test.ts
@@ -5,18 +5,16 @@
 import { directionKey } from '../lib/local-inference/selection/types';
 import useLogStore from './logStore';
 
-// Force platform detection so environment-gated providers (notably Volcengine
-// AST 2.0, which requires Electron/Extension) are present in the descriptor
-// registry. createSessionConfig now dispatches through
-// ProviderConfigFactory.getDescriptor, which throws for unregistered providers;
-// these tests exercise VOLCENGINE_AST2 directly. Mirrors descriptorRegistry.test.ts.
+// Force platform detection so environment-gated providers are present in the
+// descriptor registry. createSessionConfig now dispatches through
+// ProviderConfigFactory.getDescriptor, which throws for unregistered
+// providers. Mirrors descriptorRegistry.test.ts.
 vi.mock('../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
   // Explicit: each managed provider is gated on its own now, and this mock's
   // promise is that EVERY provider gate is forced on.
   isKizunaSonioxEnabled: () => true,
-  isKizunaVolcengineAST2Enabled: () => true,
   isPalabraAIEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
@@ -167,85 +165,6 @@
     });
   });
 
-  describe('Volcengine AST 2.0 custom vocabulary', () => {
-    const volcBase = {
-      appId: 'app-id',
~ 74 more removed lines sha256:cdfac4cbb001
-  });
-
   describe('Push-to-Translate persistence', () => {
     it('persists Push-to-Translate for Gemini', async () => {
       const store = useSettingsStore.getState();
@@ -258,17 +177,6 @@
       );
     });
 
-    it('persists Push-to-Translate for Volcengine AST2', async () => {
-      const store = useSettingsStore.getState();
-      await store.updateVolcengineAST2({ turnDetectionMode: 'Push-to-Translate' });
-
-      expect(useSettingsStore.getState().volcengineAST2.turnDetectionMode).toBe('Push-to-Translate');
-      expect(mockSetSetting).toHaveBeenCalledWith(
-        'settings.volcengineAST2.turnDetectionMode',
-        'Push-to-Translate'
-      );
-    });
-
     it('persists Push-to-Translate for Local Inference', async () => {
       const store = useSettingsStore.getState();
       await store.updateLocalInference({ turnDetectionMode: 'Push-to-Translate' });
`````

`src/stores/settingsStore.ts`

`````diff t04
diff --git a/src/stores/settingsStore.ts b/src/stores/settingsStore.ts
--- a/src/stores/settingsStore.ts
+++ b/src/stores/settingsStore.ts
@@ -47,16 +47,12 @@
 import {
   PalabraAISettings, defaultPalabraAISettings,
 } from '../services/providers/PalabraAIProviderConfig';
-import {
-  VolcengineAST2Settings, defaultVolcengineAST2Settings,
-} from '../services/providers/VolcengineAST2ProviderConfig';
 import {
   LocalInferenceSettings, defaultLocalInferenceSettings,
 } from '../services/providers/LocalInferenceProviderConfig';
 import {
   LocalNativeProviderConfig, LocalNativeSettings, defaultLocalNativeSettings,
 } from '../services/providers/LocalNativeProviderConfig';
-import { defaultKizunaVolcengineAst2Settings } from '../services/providers/KizunaAIVolcengineAST2ProviderConfig';
 import { defaultKizunaSonioxSettings } from '../services/providers/KizunaAISonioxProviderConfig';
 import { reportError, reportWarning, describeCause } from '../lib/diagnostics/report';
 import { persistSetting } from '../services/persistSetting';
@@ -82,8 +78,7 @@
 export type {
   OpenAISettings, OpenAICompatibleSettings, OpenAICompatibleSettingsBase,
   OpenAITranslateSettings, GeminiSettings, PalabraAISettings,
-  VolcengineAST2Settings, LocalInferenceSettings,
-  LocalNativeSettings, SonioxSettings,
+  LocalInferenceSettings, LocalNativeSettings, SonioxSettings,
 };
 
 // Union of every provider's settings slice — the return type of
@@ -91,7 +86,7 @@
 export type ProviderSettingsUnion =
   | OpenAISettings | GeminiSettings | OpenAICompatibleSettings | PalabraAISettings
   | OpenAITranslateSettings
-  | VolcengineAST2Settings | LocalInferenceSettings | LocalNativeSettings | SonioxSettings;
+  | LocalInferenceSettings | LocalNativeSettings | SonioxSettings;
 
 // ==================== Type Definitions ====================
 
@@ -283,9 +278,7 @@
   openaiCompatible: OpenAICompatibleSettings;
   palabraai: PalabraAISettings;
   openaiTranslate: OpenAITranslateSettings;
-  volcengineAST2: VolcengineAST2Settings;
   soniox: SonioxSettings;
-  kizunaVolcengineAst2: VolcengineAST2Settings;
   kizunaSoniox: SonioxSettings;
   localInference: LocalInferenceSettings;
   localNative: LocalNativeSettings;
@@ -411,9 +404,7 @@
   updateOpenAICompatible: (settings: Partial<OpenAICompatibleSettings>) => void;
   updatePalabraAI: (settings: Partial<PalabraAISettings>) => void;
   updateOpenAITranslate: (settings: Partial<OpenAITranslateSettings>) => Promise<void>;
-  updateVolcengineAST2: (settings: Partial<VolcengineAST2Settings>) => void;
   updateSoniox: (settings: Partial<SonioxSettings>) => void;
-  updateKizunaVolcengineAst2: (settings: Partial<VolcengineAST2Settings>) => void;
   updateKizunaSoniox: (settings: Partial<SonioxSettings>) => void;
   updateLocalInference: (settings: Partial<LocalInferenceSettings>) => void;
   updateLocalNative: (settings: Partial<LocalNativeSettings>) => void;
@@ -645,12 +636,10 @@
   openaiCompatible: { defaults: defaultOpenAICompatibleSettings, transformPatch: forceWebrtcTurnDetectionOff },
   palabraai: { defaults: defaultPalabraAISettings },
   openaiTranslate: { defaults: defaultOpenAITranslateSettings },
-  volcengineAST2: { defaults: defaultVolcengineAST2Settings },
   soniox: { defaults: defaultSonioxSettings },
   // Relay twins authenticate through the relay with a short-lived Better Auth
   // session token; the user-managed credential fields must never be persisted
   // (stale/sensitive values). See each descriptor's extractCredentials.
-  kizunaVolcengineAst2: { defaults: defaultKizunaVolcengineAst2Settings, neverPersist: ['appId', 'accessToken'] },
   kizunaSoniox: { defaults: defaultKizunaSonioxSettings, neverPersist: ['apiKey', 'apiKeyEu', 'apiKeyJp'] },
   localInference: { defaults: defaultLocalInferenceSettings },
   localNative: { defaults: defaultLocalNativeSettings },
@@ -692,9 +681,7 @@
     openaiCompatible: defaultOpenAICompatibleSettings,
     palabraai: defaultPalabraAISettings,
     openaiTranslate: defaultOpenAITranslateSettings,
-    volcengineAST2: defaultVolcengineAST2Settings,
     soniox: defaultSonioxSettings,
-    kizunaVolcengineAst2: defaultKizunaVolcengineAst2Settings,
     kizunaSoniox: defaultKizunaSonioxSettings,
     localInference: defaultLocalInferenceSettings,
     localNative: defaultLocalNativeSettings,
@@ -956,9 +943,7 @@
     updateOpenAICompatible: (settings) => updateProviderSlice(set, 'openaiCompatible', settings),
     updatePalabraAI: (settings) => updateProviderSlice(set, 'palabraai', settings),
     updateOpenAITranslate: (settings) => updateProviderSlice(set, 'openaiTranslate', settings),
-    updateVolcengineAST2: (settings) => updateProviderSlice(set, 'volcengineAST2', settings),
     updateSoniox: (settings) => updateProviderSlice(set, 'soniox', settings),
-    updateKizunaVolcengineAst2: (settings) => updateProviderSlice(set, 'kizunaVolcengineAst2', settings),
     updateKizunaSoniox: (settings) => updateProviderSlice(set, 'kizunaSoniox', settings),
     updateLocalInference: (settings) => updateProviderSlice(set, 'localInference', settings),
     updateLocalNative: (settings) => updateProviderSlice(set, 'localNative', settings),
@@ -1515,9 +1500,7 @@
 export const useOpenAICompatibleSettings = () => useSettingsStore((state) => state.openaiCompatible);
 export const usePalabraAISettings = () => useSettingsStore((state) => state.palabraai);
 export const useOpenAITranslateSettings = () => useSettingsStore((state) => state.openaiTranslate);
-export const useVolcengineAST2Settings = () => useSettingsStore((state) => state.volcengineAST2);
 export const useSonioxSettings = () => useSettingsStore((state) => state.soniox);
-export const useKizunaVolcengineAst2Settings = () => useSettingsStore((state) => state.kizunaVolcengineAst2);
 export const useKizunaSonioxSettings = () => useSettingsStore((state) => state.kizunaSoniox);
 export const useLocalInferenceSettings = () => useSettingsStore((state) => state.localInference);
 export const useLocalNativeSettings = () => useSettingsStore((state) => state.localNative);
@@ -1597,9 +1580,7 @@
 export const useUpdateOpenAICompatible = () => useSettingsStore((state) => state.updateOpenAICompatible);
 export const useUpdatePalabraAI = () => useSettingsStore((state) => state.updatePalabraAI);
 export const useUpdateOpenAITranslate = () => useSettingsStore((state) => state.updateOpenAITranslate);
-export const useUpdateVolcengineAST2 = () => useSettingsStore((state) => state.updateVolcengineAST2);
 export const useUpdateSoniox = () => useSettingsStore((state) => state.updateSoniox);
-export const useUpdateKizunaVolcengineAst2 = () => useSettingsStore((state) => state.updateKizunaVolcengineAst2);
 export const useUpdateKizunaSoniox = () => useSettingsStore((state) => state.updateKizunaSoniox);
 export const useUpdateLocalInference = () => useSettingsStore((state) => state.updateLocalInference);
 export const useUpdateLocalNative = () => useSettingsStore((state) => state.updateLocalNative);
`````

`src/types/Provider.test.ts`

`````diff t04
diff --git a/src/types/Provider.test.ts b/src/types/Provider.test.ts
--- a/src/types/Provider.test.ts
+++ b/src/types/Provider.test.ts
@@ -2,8 +2,8 @@
 import { Provider, isKizunaManagedProvider } from "./Provider";
 
 describe("kizuna-managed provider helpers", () => {
-  it("identifies the relay-managed provider", () => {
-    expect(isKizunaManagedProvider(Provider.KIZUNA_AI_VOLCENGINE_AST2)).toBe(true);
+  it("identifies the Kizuna-managed provider", () => {
+    expect(isKizunaManagedProvider(Provider.KIZUNA_AI_SONIOX)).toBe(true);
     expect(isKizunaManagedProvider(Provider.OPENAI_TRANSLATE)).toBe(false);
   });
 });
`````

`src/types/Provider.ts`

`````diff t04
diff --git a/src/types/Provider.ts b/src/types/Provider.ts
--- a/src/types/Provider.ts
+++ b/src/types/Provider.ts
@@ -9,7 +9,6 @@
   OPENAI = 'openai',
   GEMINI = 'gemini',
   PALABRA_AI = 'palabraai',
-  KIZUNA_AI_VOLCENGINE_AST2 = 'kizunaai_volcengine_ast2',
   KIZUNA_AI_SONIOX = 'kizunaai_soniox',
   OPENAI_COMPATIBLE = 'openai_compatible',
   OPENAI_TRANSLATE = 'openai_translate',
@@ -23,16 +22,13 @@
 /**
  * Provider type definition
  */
-export type ProviderType = Provider.OPENAI | Provider.GEMINI | Provider.PALABRA_AI | Provider.KIZUNA_AI_VOLCENGINE_AST2 | Provider.KIZUNA_AI_SONIOX | Provider.OPENAI_COMPATIBLE | Provider.OPENAI_TRANSLATE | Provider.OPENAI_LIVE | Provider.VOLCENGINE_AST2 | Provider.LOCAL_INFERENCE | Provider.LOCAL_NATIVE | Provider.SONIOX;
+export type ProviderType = Provider.OPENAI | Provider.GEMINI | Provider.PALABRA_AI | Provider.KIZUNA_AI_SONIOX | Provider.OPENAI_COMPATIBLE | Provider.OPENAI_TRANSLATE | Provider.OPENAI_LIVE | Provider.VOLCENGINE_AST2 | Provider.LOCAL_INFERENCE | Provider.LOCAL_NATIVE | Provider.SONIOX;
 
-/** The backend-managed twins: Kizuna AI's own service running on a third-party
- *  engine. Keep in lockstep with isKizunaManagedProvider below. */
-export type KizunaManagedProvider =
-  | Provider.KIZUNA_AI_VOLCENGINE_AST2
-  | Provider.KIZUNA_AI_SONIOX;
+/** The backend-managed provider: Kizuna AI's own service running on a
+ *  third-party engine. Keep in lockstep with isKizunaManagedProvider below. */
+export type KizunaManagedProvider = Provider.KIZUNA_AI_SONIOX;
 
 export function isKizunaManagedProvider(p: Provider): p is KizunaManagedProvider {
-  return p === Provider.KIZUNA_AI_VOLCENGINE_AST2
-    || p === Provider.KIZUNA_AI_SONIOX;
+  return p === Provider.KIZUNA_AI_SONIOX;
 }
 
`````

`src/utils/environment.test.ts`

`````diff t04
diff --git a/src/utils/environment.test.ts b/src/utils/environment.test.ts
--- a/src/utils/environment.test.ts
+++ b/src/utils/environment.test.ts
@@ -1,5 +1,5 @@
 import { describe, it, expect, vi, afterEach } from "vitest";
-import { debugSwitchOn, enabledProviderIds, getRelayWsUrl, isLocalNativeEnabled, LOCAL_NATIVE_DEBUG_KEY } from "./environment";
+import { debugSwitchOn, enabledProviderIds, isLocalNativeEnabled, LOCAL_NATIVE_DEBUG_KEY } from "./environment";
 
 afterEach(() => { vi.unstubAllEnvs(); });
 
@@ -45,21 +45,6 @@
   });
 });
 
-describe("getRelayWsUrl", () => {
-  it("derives a wss /v1 URL from the default backend", () => {
-    vi.stubEnv("VITE_BACKEND_URL", "");
~ 10 more removed lines sha256:2553cd324399
-});
-
 describe("enabledProviderIds", () => {
   afterEach(() => vi.unstubAllEnvs());
 
`````

`src/utils/environment.ts`

`````diff t04
diff --git a/src/utils/environment.ts b/src/utils/environment.ts
--- a/src/utils/environment.ts
+++ b/src/utils/environment.ts
@@ -135,18 +135,6 @@
   return `${getBackendUrl()}/api`;
 }
 
-/**
- * Get the WebSocket base URL for the KizunaAI relay
- * @returns The WebSocket URL with /v1 suffix (e.g., wss://sokuji.kizuna.ai/v1)
~ 7 more removed lines sha256:17e907d22a7e
-}
-
 /**
  * Check if running in development mode
  * @returns true if in development mode
@@ -219,14 +207,6 @@
   return import.meta.env.VITE_ENABLE_KIZUNA_SONIOX === 'true';
 }
 
-export function isKizunaVolcengineAST2Enabled(): boolean {
-  if (isDevelopmentMode()) {
-    return true;
-  }
-
-  return import.meta.env.VITE_ENABLE_KIZUNA_VOLCENGINE_AST2 === 'true';
-}
-
 /**
  * Check if Palabra AI features should be enabled
  * @returns true if Palabra AI features should be shown
`````

---

### Task 5: Gemini's old code (Wave 1)

Gemini runs on its own definition since the Stage 2 Gemini plan and its two follow-ups. The roadmap's G2 inventory (`:3061-3072`) is taken whole but for its last item, the pre-existing orphan key, a follow-up (ruling C16).

**What goes, and what changes:**
- `GeminiClient.ts` and its test, `GeminiProviderConfig.ts`, `geminiTranslateModel.ts` and its test; the registration; `IClient.ts`' `GeminiSessionConfig`, its guard, `cancelPttTurn` and `IClientStatic`; `ProviderDescriptor.ts`' `reversesDirection` note; the `gemini` slice and its model auto-select case. The common instruction fields stay here: the unported Local Native still reads them until Task 10.
- `logStore.ts`' old Gemini event names (the adapter's `domain.event` frames keep their grouping); `sanitizeEvent.ts`' and `redact.ts`' comments, which cited the old client (choice 3).
- `@google/genai` stays a development dependency (ruling C2; research note 2): `gemini/settings.ts`' and `wire.oracle.test.ts`' headers say why.
- The old test tables' Gemini rows (`descriptorRegistry`, `participantConfig`, `providerOrder`, the `settingsStore` tests).

**Files:**
- Delete (5): `src/services/clients/GeminiClient.test.ts`, `src/services/clients/GeminiClient.ts`, `src/services/providers/GeminiProviderConfig.ts`, `src/services/providers/geminiTranslateModel.test.ts`, `src/services/providers/geminiTranslateModel.ts`
- Modify (16, by the blocks below): `src/lib/diagnostics/redact.test.ts`, `src/lib/diagnostics/redact.ts`, `src/providers/gemini/settings.ts`, `src/providers/gemini/wire.oracle.test.ts`, `src/services/interfaces/IClient.ts`, `src/services/providers/ProviderConfigFactory.ts`, `src/services/providers/ProviderDescriptor.ts`, `src/services/providers/descriptorRegistry.test.ts`, `src/services/providers/participantConfig.test.ts`, `src/services/providers/providerOrder.test.ts`, `src/stores/logStore.ts`, `src/stores/sanitizeEvent.test.ts`, `src/stores/sanitizeEvent.ts`, `src/stores/settingsStore.sliceRegistry.test.ts`, `src/stores/settingsStore.test.ts`, `src/stores/settingsStore.ts`

**Interfaces:**
- Consumes: Task 1 (the shell's Gemini branches are gone).
- Produces: `IClient.ts` without Gemini's members and without `IClientStatic`; `settingsStore` without `gemini`.

- [ ] **Step 1: Delete the files.**

  ```
  git rm -q -- src/services/clients/GeminiClient.test.ts src/services/clients/GeminiClient.ts src/services/providers/GeminiProviderConfig.ts src/services/providers/geminiTranslateModel.test.ts src/services/providers/geminiTranslateModel.ts
  ```

- [ ] **Step 2: Apply the task's diff blocks** (Global Constraints: never by hand).

  ```
  python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/plan-apply.py docs/superpowers/plans/2026-09-30-client-contract-stage2-deletion.md t05
  ```

  Expected: `t05: 16 files changed`, and no other line.

- [ ] **Step 3: Check that nothing reaches what went.**

  ```
  git grep -nE "from '[^']*/(GeminiClient|GeminiProviderConfig|geminiTranslateModel)'|GeminiSessionConfig" -- src
  ```

  Expected: nothing (exit status 1).

- [ ] **Step 4: Run the gates.** Each command as its own call; every expected number is the replay's.

  - `npx vitest run src`: **573 files passed and 1 skipped (574); 7 391 tests passed and 2 skipped (7 393)**; 0 failed, no unhandled errors.
  - `npx vitest run electron`: 34 files, 477 tests passed. `npx vitest run extension`: 9 files, 56 tests passed.
  - Local Native's old path: `npx vitest run src/services src/lib/local-inference/native src/components/Settings/sections/Native src/components/Settings/engine/useNativeEngineAdapter src/stores/nativeModelStore src/stores/settingsStore` — 71 files, 1 262 tests passed.
  - The typecheck, as a set: `npx tsc --noEmit -p tsconfig.json > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t05.txt`, then `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t04.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t05.txt` prints exactly `before 255 after 247; new 0; gone 8` and exits 0 — no error the task before did not have; `after 247` is the full tree's count.
  - `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh | diff - /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` prints nothing: the baseline's 18 lines, unchanged.

- [ ] **Step 5: Commit.**

```bash
git add -- src/lib/diagnostics/redact.test.ts src/lib/diagnostics/redact.ts src/providers/gemini/settings.ts src/providers/gemini/wire.oracle.test.ts src/services/interfaces/IClient.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/ProviderDescriptor.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/participantConfig.test.ts src/services/providers/providerOrder.test.ts src/stores/logStore.ts src/stores/sanitizeEvent.test.ts src/stores/sanitizeEvent.ts src/stores/settingsStore.sliceRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts
```

```bash
git commit -q -F - -- src/services/clients/GeminiClient.test.ts src/services/clients/GeminiClient.ts src/services/providers/GeminiProviderConfig.ts src/services/providers/geminiTranslateModel.test.ts src/services/providers/geminiTranslateModel.ts src/lib/diagnostics/redact.test.ts src/lib/diagnostics/redact.ts src/providers/gemini/settings.ts src/providers/gemini/wire.oracle.test.ts src/services/interfaces/IClient.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/ProviderDescriptor.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/participantConfig.test.ts src/services/providers/providerOrder.test.ts src/stores/logStore.ts src/stores/sanitizeEvent.test.ts src/stores/sanitizeEvent.ts src/stores/settingsStore.sliceRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts <<'EOF'
refactor(gemini): delete the old Gemini code

Gemini runs on its own definition and adapter. Delete its old client,
descriptor, model mapping, IClient members, slice and old event names;
@google/genai stays a development dependency for the wire's types and
its oracle test.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

**The blocks** (`t05`, one per file, in the order the applier takes them):

`src/lib/diagnostics/redact.test.ts`

`````diff t05
diff --git a/src/lib/diagnostics/redact.test.ts b/src/lib/diagnostics/redact.test.ts
--- a/src/lib/diagnostics/redact.test.ts
+++ b/src/lib/diagnostics/redact.test.ts
@@ -27,7 +27,7 @@
     expect(redact('secret ek_a1b2c3d4e5f6g7 expired')).toBe('secret [REDACTED] expired');
   });
 
-  // GeminiClient.ts:138-139 — `${MODELS_ENDPOINT}?key=${apiKey}`. The parameter
+  // gemini/wire.ts `liveUrl` — `?key=${apiKey}`. The parameter
   // name stays so the reader knows which call failed.
   it('redacts credential query parameters but keeps the parameter name', () => {
     expect(redact('GET https://x/v1/models?key=AIzaSyB-example123&pageToken=abc'))
`````

`src/lib/diagnostics/redact.ts`

`````diff t05
diff --git a/src/lib/diagnostics/redact.ts b/src/lib/diagnostics/redact.ts
--- a/src/lib/diagnostics/redact.ts
+++ b/src/lib/diagnostics/redact.ts
@@ -23,7 +23,7 @@
  * collapsing to an anonymous `[REDACTED]`.
  */
 const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
-  // `${MODELS_ENDPOINT}?key=${apiKey}` — GeminiClient.ts:138-139.
+  // `?key=${apiKey}` — Gemini's Live socket (`gemini/wire.ts` `liveUrl`).
   //
   // `X-Credential` and `X-Signature` are the SigV4-style query parameters a
   // Volcengine-shaped signed URL carries, and `X-Credential` carries the
`````

`src/providers/gemini/settings.ts`

`````diff t05
diff --git a/src/providers/gemini/settings.ts b/src/providers/gemini/settings.ts
--- a/src/providers/gemini/settings.ts
+++ b/src/providers/gemini/settings.ts
@@ -5,8 +5,8 @@
  * keys) and `turnDetectionMode` (the global turn mode, migrated once by
  * `storedSettings.ts:56`) — plus the instructions it now owns (ruling 4).
  * Stored under `settings.gemini.*` as before. The Live Translate helpers
- * are copied from `geminiTranslateModel.ts`: nothing here imports
- * `src/services`, whose copy the deletion plan removes.
+ * are copied from `geminiTranslateModel.ts`, deleted since with the old
+ * client (Stage 2 deletion, ruling 2).
  */
 import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS, migrateInstructions, type InstructionsSettings } from '../../lib/provider/instructions';
 import type { CredentialsMissing, LanguageOption, MigrationInputs, ModelOption, Provider } from '../../lib/provider/types';
`````

`src/providers/gemini/wire.oracle.test.ts`

`````diff t05
diff --git a/src/providers/gemini/wire.oracle.test.ts b/src/providers/gemini/wire.oracle.test.ts
--- a/src/providers/gemini/wire.oracle.test.ts
+++ b/src/providers/gemini/wire.oracle.test.ts
@@ -5,8 +5,8 @@
  * old client built (`GeminiClient.ts:490-574`) — equals `setupFrame`, and
  * its URL `liveUrl`. The SDK's browser build opens a global `WebSocket`,
  * stubbed here with `FakeSocket`: it connects nowhere (ruling 14). The one
- * value import of `@google/genai` outside the old client; the deletion
- * plan decides its fate.
+ * value import of `@google/genai`, which stays a development dependency for
+ * it and for the server types (Stage 2 deletion, ruling C2).
  */
 import { afterEach, describe, it, expect, vi } from 'vitest';
 import { ActivityHandling, EndSensitivity, GoogleGenAI, Modality, StartSensitivity, type LiveConnectConfig } from '@google/genai/web';
`````

`src/services/interfaces/IClient.ts`

`````diff t05
diff --git a/src/services/interfaces/IClient.ts b/src/services/interfaces/IClient.ts
--- a/src/services/interfaces/IClient.ts
+++ b/src/services/interfaces/IClient.ts
@@ -138,47 +138,6 @@
   // in a session config.
 }
 
-/**
- * Gemini-specific session configuration
- */
~ 36 more removed lines sha256:6b8ade2c9a63
-}
-
 /**
  * PalabraAI-specific session configuration
  */
@@ -288,7 +247,7 @@
 /**
  * Union type for all possible session configurations
  */
-export type SessionConfig = OpenAISessionConfig | OpenAITranslateSessionConfig | GeminiSessionConfig | PalabraAISessionConfig | SonioxSessionConfig | LocalInferenceSessionConfig | LocalNativeSessionConfig;
+export type SessionConfig = OpenAISessionConfig | OpenAITranslateSessionConfig | PalabraAISessionConfig | SonioxSessionConfig | LocalInferenceSessionConfig | LocalNativeSessionConfig;
 
 /**
  * Type guards for session configurations
@@ -304,10 +263,6 @@
   return config.provider === 'openai_translate';
 }
 
-export function isGeminiSessionConfig(config: SessionConfig): config is GeminiSessionConfig {
-  return config.provider === 'gemini';
-}
-
 export function isPalabraAISessionConfig(config: SessionConfig): config is PalabraAISessionConfig {
   return config.provider === 'palabraai';
 }
@@ -433,10 +388,6 @@
   // Provider-specific information
   getProvider(): ProviderType;
 
-  // Optional PTT control methods
-  /** Cancel current PTT turn without triggering a response (e.g., when no speech detected) */
-  cancelPttTurn?(): void;
-
   // Optional device control methods (WebRTC only)
   switchInputDevice?(deviceId: string): Promise<void>;
   switchOutputDevice?(deviceId: string): Promise<void>;
@@ -465,22 +416,3 @@
    */
   getManagedBudgetInfo?(): { budgetMicroUsd: number; rateUsdPerHour: number; startedAtMs: number } | null;
 }
-
-/**
- * Static methods interface for client classes
~ 14 more removed lines sha256:a34e97fcef84
-  getLatestRealtimeModel(models: FilteredModel[]): string;
-}
`````

`src/services/providers/ProviderConfigFactory.ts`

`````diff t05
diff --git a/src/services/providers/ProviderConfigFactory.ts b/src/services/providers/ProviderConfigFactory.ts
--- a/src/services/providers/ProviderConfigFactory.ts
+++ b/src/services/providers/ProviderConfigFactory.ts
@@ -1,7 +1,6 @@
 import { ProviderConfig } from './ProviderConfig';
 import { ProviderDescriptor } from './ProviderDescriptor';
 import { OpenAIProviderConfig } from './OpenAIProviderConfig';
-import { GeminiProviderConfig } from './GeminiProviderConfig';
 import { OpenAICompatibleProviderConfig } from './OpenAICompatibleProviderConfig';
 import { OpenAITranslateProviderConfig } from './OpenAITranslateProviderConfig';
 import { PalabraAIProviderConfig } from './PalabraAIProviderConfig';
@@ -38,9 +37,6 @@
     // 2. Free (local inference) — always available, no API key or flag.
     ProviderConfigFactory.configs.set(Provider.LOCAL_INFERENCE, new LocalInferenceProviderConfig());
 
-    // 3. Gemini
-    ProviderConfigFactory.configs.set(Provider.GEMINI, new GeminiProviderConfig());
-
     // 5. The OpenAI providers: Realtime, Translate.
     ProviderConfigFactory.configs.set(Provider.OPENAI, new OpenAIProviderConfig());
     ProviderConfigFactory.configs.set(Provider.OPENAI_TRANSLATE, new OpenAITranslateProviderConfig());
`````

`src/services/providers/ProviderDescriptor.ts`

`````diff t05
diff --git a/src/services/providers/ProviderDescriptor.ts b/src/services/providers/ProviderDescriptor.ts
--- a/src/services/providers/ProviderDescriptor.ts
+++ b/src/services/providers/ProviderDescriptor.ts
@@ -323,14 +323,10 @@
    * indifferent to an `auto` source, because nothing has to be swapped.
    * Base: false — most providers carry direction in the system instruction.
    *
-   * The two here are not:
+   * The one here is not:
    * - **Soniox** reverses `sourceLanguage`/`targetLanguage` directly.
-   * - **Gemini Live Translate** reverses `translationConfig.targetLanguageCode`,
-   *   which overrules the instruction, so the instruction swap cannot stand in
-   *   for it. Only the translate models — the dialogue Live models carry
-   *   direction in the instruction like everyone else.
    *
-   * For both, an `auto` source would reverse into the literal `auto` as the
+   * For it, an `auto` source would reverse into the literal `auto` as the
    * participant's translate target, which is not a language. Callers require a
    * concrete source language whenever a participant channel is in scope; see
    * `computeStartGate`'s `autoSourceParticipantBlocked`.
`````

`src/services/providers/descriptorRegistry.test.ts`

`````diff t05
diff --git a/src/services/providers/descriptorRegistry.test.ts b/src/services/providers/descriptorRegistry.test.ts
--- a/src/services/providers/descriptorRegistry.test.ts
+++ b/src/services/providers/descriptorRegistry.test.ts
@@ -21,7 +21,6 @@
 import { defaultOpenAISettings } from './OpenAIProviderConfig';
 import { defaultOpenAICompatibleSettings } from './OpenAICompatibleProviderConfig';
 import { defaultOpenAITranslateSettings } from './OpenAITranslateProviderConfig';
-import { defaultGeminiSettings } from './GeminiProviderConfig';
 import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
 import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
 import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
@@ -37,7 +36,6 @@
   openai: defaultOpenAISettings,
   openaiCompatible: defaultOpenAICompatibleSettings,
   openaiTranslate: defaultOpenAITranslateSettings,
-  gemini: defaultGeminiSettings,
   palabraai: defaultPalabraAISettings,
   localInference: defaultLocalInferenceSettings,
   localNative: defaultLocalNativeSettings,
@@ -48,7 +46,7 @@
 describe('provider registry descriptors', () => {
   it('returns a descriptor for every available provider', () => {
     const ids = ProviderConfigFactory.getAvailableProviders();
-    expect(ids.length).toBe(9);
+    expect(ids.length).toBe(8);
     for (const id of ids) {
       const d = ProviderConfigFactory.getDescriptor(id);
       expect(d.getConfig().id).toBe(id);
@@ -165,7 +163,7 @@
     // Expected wire tags (kizuna twins reuse their base tag; compatible uses 'openai').
     const wireTag: Record<string, string> = {
       openai: 'openai', openai_compatible: 'openai', openai_translate: 'openai_translate',
-      gemini: 'gemini', palabraai: 'palabraai',
+      palabraai: 'palabraai',
       local_inference: 'local_inference',
       local_native: 'local_native',
       soniox: 'soniox', kizunaai_soniox: 'soniox',
@@ -177,11 +175,6 @@
     }
   });
 
-  it('gemini config carries VAD tuning through', () => {
-    const cfg: any = ProviderConfigFactory.getDescriptor(Provider.GEMINI)
-      .buildSessionConfig({ ...defaultGeminiSettings, vadSilenceDurationMs: 900 }, 'sys');
-    expect(cfg.vadSilenceDurationMs).toBe(900);
-  });
 });
 
 describe('descriptor language rules', () => {
@@ -191,8 +184,9 @@
   });
 
   it('default providers pass their config languages through', () => {
-    const d = ProviderConfigFactory.getDescriptor(Provider.GEMINI);
-    expect(d.resolveSourceLanguages()).toBe(d.getConfig().languages);
+    // Local Native builds its config on each call, so the pass-through is by value.
+    const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_NATIVE);
+    expect(d.resolveSourceLanguages()).toEqual(d.getConfig().languages);
   });
 });
 
@@ -222,7 +216,6 @@
     [Provider.OPENAI]: 'openai',
     [Provider.OPENAI_COMPATIBLE]: 'openaiCompatible',
     [Provider.OPENAI_TRANSLATE]: 'openaiTranslate',
-    [Provider.GEMINI]: 'gemini',
     [Provider.PALABRA_AI]: 'palabraai',
     [Provider.LOCAL_INFERENCE]: 'localInference',
     // Registered only under Electron with its gate on — both forced on by
@@ -245,7 +238,6 @@
     [Provider.OPENAI]: true,
     [Provider.OPENAI_COMPATIBLE]: true,
     [Provider.OPENAI_TRANSLATE]: true,
-    [Provider.GEMINI]: false,
     [Provider.PALABRA_AI]: false,
     [Provider.LOCAL_INFERENCE]: false,
     [Provider.LOCAL_NATIVE]: false,
@@ -283,7 +275,6 @@
   const PUSH_GATED: Partial<Record<Provider, string[] | undefined>> = {
     [Provider.OPENAI]: ['Disabled', 'Push-to-Translate'],
     [Provider.OPENAI_COMPATIBLE]: ['Disabled', 'Push-to-Translate'], // inherited from OpenAI via ...base
-    [Provider.GEMINI]: ['Push-to-Talk', 'Push-to-Translate'],
     [Provider.LOCAL_INFERENCE]: ['Push-to-Talk', 'Push-to-Translate'],
     [Provider.LOCAL_NATIVE]: ['Push-to-Talk', 'Push-to-Translate'],
     [Provider.OPENAI_TRANSLATE]: undefined,
@@ -295,7 +286,6 @@
   const TEXT_INPUT: Partial<Record<Provider, boolean | undefined>> = {
     [Provider.OPENAI]: true,
     [Provider.OPENAI_COMPATIBLE]: true, // inherited
-    [Provider.GEMINI]: true,
     [Provider.LOCAL_INFERENCE]: true,
     [Provider.LOCAL_NATIVE]: true,
     [Provider.OPENAI_TRANSLATE]: undefined,
@@ -310,7 +300,6 @@
   const PTT_FINALIZATION: Partial<Record<Provider, { silenceTailFrames?: number; response: string } | undefined>> = {
     [Provider.LOCAL_INFERENCE]: { silenceTailFrames: 7, response: 'always' },
     [Provider.LOCAL_NATIVE]: { silenceTailFrames: 7, response: 'always' },
-    [Provider.GEMINI]: { response: 'voice-gated-cancel' },
     [Provider.OPENAI]: undefined,
     [Provider.OPENAI_COMPATIBLE]: undefined,
     [Provider.OPENAI_TRANSLATE]: undefined,
@@ -326,7 +315,6 @@
     // Their own silence timers cut the bubble, and the user tunes them, so
     // Auto here would be the pause mode wearing another name.
     [Provider.OPENAI_TRANSLATE]: { pause: true, auto: false, sizes: true },
-    [Provider.GEMINI]: { pause: true, auto: false, sizes: true },
 
     // 1-5 is what slice 3 shipped on the local engines; phase 2 adds Auto,
     // where the VAD utterance is the boundary someone else already decided
@@ -363,7 +351,6 @@
     [Provider.OPENAI]: true,
     [Provider.OPENAI_COMPATIBLE]: true, // inherited via ...base
     [Provider.OPENAI_TRANSLATE]: false,
-    [Provider.GEMINI]: false,
     [Provider.PALABRA_AI]: false,
     [Provider.SONIOX]: false,
     [Provider.KIZUNA_AI_SONIOX]: false,
@@ -468,7 +455,6 @@
   // copy of the same assertion per provider.
   const PAUSE_FIELDS: Partial<Record<Provider, [source: string, translation: string]>> = {
     [Provider.OPENAI_TRANSLATE]: ['userSilenceTimeoutMs', 'assistantSilenceTimeoutMs'],
-    [Provider.GEMINI]: ['inputSegmentSilenceMs', 'assistantSegmentSilenceMs'],
   };
 
   // A2: one stored pause pair, in seconds, converted to milliseconds at the
@@ -629,24 +615,15 @@
 
 describe('S3 reversesDirectionViaSourceLanguage', () => {
   const TRANSLATE = 'gemini-3.5-live-translate-preview';
-  const DIALOGUE = 'gemini-3.1-flash-live-preview';
 
   it('true for Soniox and its managed twin regardless of model', () => {
     expect(ProviderConfigFactory.getDescriptor(Provider.SONIOX).reversesDirectionViaSourceLanguage(undefined)).toBe(true);
     expect(ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX).reversesDirectionViaSourceLanguage(undefined)).toBe(true);
   });
 
-  it('gemini: only the live-translate models', () => {
-    const d = ProviderConfigFactory.getDescriptor(Provider.GEMINI);
-    expect(d.reversesDirectionViaSourceLanguage(TRANSLATE)).toBe(true);
-    expect(d.reversesDirectionViaSourceLanguage(DIALOGUE)).toBe(false);
-    expect(d.reversesDirectionViaSourceLanguage(undefined)).toBe(false);
-    expect(d.reversesDirectionViaSourceLanguage('')).toBe(false);
-  });
-
   it('false for every other descriptor, any model', () => {
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
-      if ([Provider.SONIOX, Provider.KIZUNA_AI_SONIOX, Provider.GEMINI].includes(id)) continue;
+      if ([Provider.SONIOX, Provider.KIZUNA_AI_SONIOX].includes(id)) continue;
       const d = ProviderConfigFactory.getDescriptor(id);
       expect(d.reversesDirectionViaSourceLanguage(TRANSLATE), `${id}`).toBe(false);
       expect(d.reversesDirectionViaSourceLanguage(undefined), `${id}`).toBe(false);
`````

`src/services/providers/participantConfig.test.ts`

`````diff t05
diff --git a/src/services/providers/participantConfig.test.ts b/src/services/providers/participantConfig.test.ts
--- a/src/services/providers/participantConfig.test.ts
+++ b/src/services/providers/participantConfig.test.ts
@@ -21,20 +21,17 @@
 import { Provider } from '../../types/Provider';
 import { defaultSonioxSettings } from './SonioxProviderConfig';
 import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
-import { defaultGeminiSettings } from './GeminiProviderConfig';
 import { defaultOpenAISettings } from './OpenAIProviderConfig';
 import { defaultOpenAICompatibleSettings } from './OpenAICompatibleProviderConfig';
 import { defaultOpenAITranslateSettings } from './OpenAITranslateProviderConfig';
 import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
 import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
-import { reverseGeminiTranslationDirection } from './geminiTranslateModel';
 import { reverseTranscriptionDirection } from './openaiTranscriptionContext';
 import { createParticipantLocalInferenceConfig, createParticipantLocalNativeConfig } from './localParticipantConfig';
 import { useNativeModelStore } from '../../stores/nativeModelStore';
 import { directionKey } from '../../lib/local-inference/selection/types';
 import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
 import type {
-  GeminiSessionConfig,
   OpenAISessionConfig,
   OpenAITranslateSessionConfig,
   LocalInferenceSessionConfig,
@@ -140,65 +137,6 @@
 });
 
 describe('participant config: helper-based reversals', () => {
-  it('gemini forces turnDetectionMode Auto and reverses translationConfig when present', () => {
-    const d = ProviderConfigFactory.getDescriptor(Provider.GEMINI);
-    // Non-Auto so the assertion below discriminates the override's forcing
~ 54 more removed lines sha256:e266e70d0cbe
-  });
-
   it('openai and openai_compatible rebuild the transcription hint for the reversed direction', () => {
     for (const id of [Provider.OPENAI, Provider.OPENAI_COMPATIBLE]) {
       const d = ProviderConfigFactory.getDescriptor(id);
`````

`src/services/providers/providerOrder.test.ts`

`````diff t05
diff --git a/src/services/providers/providerOrder.test.ts b/src/services/providers/providerOrder.test.ts
--- a/src/services/providers/providerOrder.test.ts
+++ b/src/services/providers/providerOrder.test.ts
@@ -34,7 +34,6 @@
     expect(ids).toEqual([
       Provider.KIZUNA_AI_SONIOX,
       Provider.LOCAL_INFERENCE,
-      Provider.GEMINI,
       Provider.OPENAI,
       Provider.OPENAI_TRANSLATE,
       Provider.SONIOX,
@@ -63,7 +62,6 @@
 
     expect(ids).toEqual([
       Provider.LOCAL_INFERENCE,
-      Provider.GEMINI,
       Provider.OPENAI,
       Provider.OPENAI_TRANSLATE,
       Provider.SONIOX,
`````

`src/stores/logStore.ts`

`````diff t05
diff --git a/src/stores/logStore.ts b/src/stores/logStore.ts
--- a/src/stores/logStore.ts
+++ b/src/stores/logStore.ts
@@ -27,21 +27,6 @@
     | 'session.notify_failed'
     | 'participant.warning'
     | 'participant.info'
-    // Gemini-specific top-level message types
-    | 'setupComplete'
-    | 'usageMetadata'
~ 10 more removed lines sha256:14b5cf0429b3
-    | 'serverContent.outputTranscription'
-    | 'serverContent.inputTranscription'
     // OpenAI server events (shared between beta and GA)
     | 'session.created' | 'session.updated'
     | 'conversation.created'
@@ -384,38 +369,33 @@
       else if (eventType === 'tts.audio') {
         groupingKey = 'soniox_tts_audio';
       }
-      // Gemini-specific grouping: the old client's names and the new adapter's
-      // domain.event frames (Stage 2 Gemini, ruling 12); the old names go with
-      // the old client. A key groups consecutive frames of one type: the
-      // store merges only events of the same type (the eventType check where
+      // Gemini's grouping: the adapter's domain.event frames (Stage 2 Gemini,
+      // ruling 12). A key groups consecutive frames of one type: the store
+      // merges only events of the same type (the eventType check where
       // entries merge), so a key two types share never merged them.
-      else if (eventType === 'serverContent.modelTurn' || eventType === 'serverContent.outputTranscription') {
-        // (the existing comment and key, unchanged: the deletion plan removes the old names)
-        groupingKey = 'gemini_model_turn';
-      }
       else if (eventType === 'server_content.model_turn') {
         groupingKey = 'gemini_model_turn';
       }
       else if (eventType === 'server_content.output_transcription') {
         groupingKey = 'gemini_output_transcription';
       }
-      else if (eventType === 'serverContent.interrupted' || eventType === 'server_content.interrupted') {
+      else if (eventType === 'server_content.interrupted') {
         // Group Gemini interruption events together
         groupingKey = 'gemini_interrupted';
       }
-      else if (eventType === 'serverContent.turnComplete' || eventType === 'server_content.turn_complete') {
+      else if (eventType === 'server_content.turn_complete') {
         // Group Gemini turn complete events together
         groupingKey = 'gemini_turn_complete';
       }
-      else if (eventType === 'serverContent.generationComplete' || eventType === 'server_content.generation_complete') {
+      else if (eventType === 'server_content.generation_complete') {
         // Group Gemini generation complete events together
         groupingKey = 'gemini_generation_complete';
       }
-      else if (eventType === 'usageMetadata' || eventType === 'server.usage_metadata') {
+      else if (eventType === 'server.usage_metadata') {
         // Group Gemini usage metadata events together
         groupingKey = 'gemini_usage_metadata';
       }
-      else if (eventType === 'serverContent.inputTranscription' || eventType === 'server_content.input_transcription') {
+      else if (eventType === 'server_content.input_transcription') {
         // Group Gemini input transcription events together
         groupingKey = 'gemini_input_transcription';
       }
`````

`src/stores/sanitizeEvent.test.ts`

`````diff t05
diff --git a/src/stores/sanitizeEvent.test.ts b/src/stores/sanitizeEvent.test.ts
--- a/src/stores/sanitizeEvent.test.ts
+++ b/src/stores/sanitizeEvent.test.ts
@@ -201,8 +201,9 @@
 
 describe('sanitizeEvent — credential redaction', () => {
   // The old MainPanel's participantTelemetry.ts (deleted in plan 1e-3c) put
-  // the whole client error event into a `session.error` row this way;
-  // GeminiClient still forwards `filename` and `error.toString()` raw.
+  // the whole client error event into a `session.error` row this way; the
+  // old GeminiClient, since deleted, forwarded `filename` and
+  // `error.toString()` raw.
   // LogsPanel exports events to the clipboard, so a credential landing in one
   // ships with a copy button next to it.
   it('redacts credentials in provider-text fields', () => {
`````

`src/stores/sanitizeEvent.ts`

`````diff t05
diff --git a/src/stores/sanitizeEvent.ts b/src/stores/sanitizeEvent.ts
--- a/src/stores/sanitizeEvent.ts
+++ b/src/stores/sanitizeEvent.ts
@@ -132,9 +132,9 @@
     // Key-scoped and strings only, so per-frame transcript deltas never touch
     // the regexes. These are the fields a failure travels in: the old
     // MainPanel's `participantTelemetry.ts` (deleted in plan 1e-3c) embedded
-    // the whole error event in a `session.error` row this way, and
-    // GeminiClient still forwards `filename` and `error.toString()` into it
-    // raw. Panel events are clipboard-exportable, so a signed URL or Bearer
+    // the whole error event in a `session.error` row this way, and the old
+    // GeminiClient, since deleted, forwarded `filename` and `error.toString()`
+    // into it raw. Panel events are clipboard-exportable, so a signed URL or Bearer
     // header reaching one is a leak with a copy button next to it.
     if (typeof value === 'string' && REDACTED_FIELD_NAMES.has(key)) {
       sanitized[key] = redact(value);
`````

`src/stores/settingsStore.sliceRegistry.test.ts`

`````diff t05
diff --git a/src/stores/settingsStore.sliceRegistry.test.ts b/src/stores/settingsStore.sliceRegistry.test.ts
--- a/src/stores/settingsStore.sliceRegistry.test.ts
+++ b/src/stores/settingsStore.sliceRegistry.test.ts
@@ -28,7 +28,6 @@
 
 /** action name → [sliceKey, sample patch] for the plain (no-special-case) slices */
 const PLAIN: Array<[string, string, Record<string, unknown>]> = [
-  ['updateGemini', 'gemini', { apiKey: 'k1' }],
   ['updatePalabraAI', 'palabraai', { clientId: 'c1' }],
   ['updateOpenAITranslate', 'openaiTranslate', { apiKey: 'k2' }],
   ['updateLocalInference', 'localInference', { ttsSpeed: 1.5 }],
@@ -107,7 +106,6 @@
   // channels are exercised because the service can produce either.
   const ALL_SLICES: Array<[string, string, Record<string, unknown>]> = [
     ['updateOpenAI', 'openai', { apiKey: 'x' }],
-    ['updateGemini', 'gemini', { apiKey: 'x' }],
     ['updateOpenAICompatible', 'openaiCompatible', { apiKey: 'x' }],
     ['updatePalabraAI', 'palabraai', { clientId: 'x' }],
     ['updateOpenAITranslate', 'openaiTranslate', { apiKey: 'x' }],
@@ -143,13 +141,13 @@
     resetReportThrottle();
     setSetting.mockResolvedValue({ success: false, error: 'disk full' } as never);
 
-    await (useSettingsStore.getState() as any).updateGemini({ apiKey: 'x', sourceLanguage: 'ja' });
+    await (useSettingsStore.getState() as any).updateLocalNative({ sourceLanguage: 'ja', targetLanguage: 'en' });
     await settleReports();
 
     const messages = useLogStore.getState().allLogs.map((l) => l.message);
     expect(messages).toEqual([
-      '[Settings] Could not save settings.gemini.apiKey: disk full',
-      '[Settings] Could not save settings.gemini.sourceLanguage: disk full',
+      '[Settings] Could not save settings.localNative.sourceLanguage: disk full',
+      '[Settings] Could not save settings.localNative.targetLanguage: disk full',
     ]);
     useLogStore.getState().clearLogs();
   });
@@ -162,7 +160,7 @@
     const s = useSettingsStore.getState() as any;
     // Spot every slice key is a populated object after load.
     for (const sliceKey of [
-      'openai', 'gemini', 'openaiCompatible', 'palabraai', 'openaiTranslate',
+      'openai', 'openaiCompatible', 'palabraai', 'openaiTranslate',
       'localInference', 'localNative',
     ]) {
       expect(s[sliceKey], sliceKey).toBeTypeOf('object');
`````

`src/stores/settingsStore.test.ts`

`````diff t05
diff --git a/src/stores/settingsStore.test.ts b/src/stores/settingsStore.test.ts
--- a/src/stores/settingsStore.test.ts
+++ b/src/stores/settingsStore.test.ts
@@ -166,17 +166,6 @@
   });
 
   describe('Push-to-Translate persistence', () => {
-    it('persists Push-to-Translate for Gemini', async () => {
-      const store = useSettingsStore.getState();
-      await store.updateGemini({ turnDetectionMode: 'Push-to-Translate' });
-
-      expect(useSettingsStore.getState().gemini.turnDetectionMode).toBe('Push-to-Translate');
-      expect(mockSetSetting).toHaveBeenCalledWith(
-        'settings.gemini.turnDetectionMode',
-        'Push-to-Translate'
-      );
-    });
-
     it('persists Push-to-Translate for Local Inference', async () => {
       const store = useSettingsStore.getState();
       await store.updateLocalInference({ turnDetectionMode: 'Push-to-Translate' });
@@ -198,11 +187,11 @@
       expect(useSettingsStore.getState().openai.turnDetectionMode).toBe('Push-to-Translate');
     });
 
-    it('per-provider isolation: setting Push-to-Translate on Gemini does not change OpenAI', async () => {
+    it('per-provider isolation: setting Push-to-Translate on Local Inference does not change OpenAI', async () => {
       const store = useSettingsStore.getState();
       const openAIBefore = useSettingsStore.getState().openai.turnDetectionMode;
 
-      await store.updateGemini({ turnDetectionMode: 'Push-to-Translate' });
+      await store.updateLocalInference({ turnDetectionMode: 'Push-to-Translate' });
 
       expect(useSettingsStore.getState().openai.turnDetectionMode).toBe(openAIBefore);
     });
@@ -614,7 +603,7 @@
     });
 
     it('defaults to websocket for a provider slice with no transportType field', () => {
-      useSettingsStore.setState({ provider: Provider.GEMINI });
+      useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
 
       const { result } = renderHook(() => useTransportType());
 
@@ -761,10 +750,10 @@
   });
 
   it('does not bleed into other slices or drop unpatched fields', async () => {
-    const geminiBefore = useSettingsStore.getState().gemini;
+    const nativeBefore = useSettingsStore.getState().localNative;
     const sourceBefore = (useSettingsStore.getState().soniox as { sourceLanguage: string }).sourceLanguage;
     await useSettingsStore.getState().updateProviderSlice('soniox', { targetLanguage: 'ko' });
-    expect(useSettingsStore.getState().gemini).toBe(geminiBefore);
+    expect(useSettingsStore.getState().localNative).toBe(nativeBefore);
     expect((useSettingsStore.getState().soniox as { sourceLanguage: string }).sourceLanguage).toBe(sourceBefore);
   });
 
`````

`src/stores/settingsStore.ts`

`````diff t05
diff --git a/src/stores/settingsStore.ts b/src/stores/settingsStore.ts
--- a/src/stores/settingsStore.ts
+++ b/src/stores/settingsStore.ts
@@ -41,9 +41,6 @@
   OpenAITranslateSettings, defaultOpenAITranslateSettings,
   LEGACY_TRANSLATE_TRANSCRIPT_MODEL,
 } from '../services/providers/OpenAITranslateProviderConfig';
-import {
-  GeminiSettings, defaultGeminiSettings,
-} from '../services/providers/GeminiProviderConfig';
 import {
   PalabraAISettings, defaultPalabraAISettings,
 } from '../services/providers/PalabraAIProviderConfig';
@@ -77,14 +74,14 @@
 
 export type {
   OpenAISettings, OpenAICompatibleSettings, OpenAICompatibleSettingsBase,
-  OpenAITranslateSettings, GeminiSettings, PalabraAISettings,
+  OpenAITranslateSettings, PalabraAISettings,
   LocalInferenceSettings, LocalNativeSettings, SonioxSettings,
 };
 
 // Union of every provider's settings slice — the return type of
 // getCurrentProviderSettings, resolved dynamically via the active descriptor.
 export type ProviderSettingsUnion =
-  | OpenAISettings | GeminiSettings | OpenAICompatibleSettings | PalabraAISettings
+  | OpenAISettings | OpenAICompatibleSettings | PalabraAISettings
   | OpenAITranslateSettings
   | LocalInferenceSettings | LocalNativeSettings | SonioxSettings;
 
@@ -274,7 +271,6 @@
 
   // Provider-specific settings
   openai: OpenAISettings;
-  gemini: GeminiSettings;
   openaiCompatible: OpenAICompatibleSettings;
   palabraai: PalabraAISettings;
   openaiTranslate: OpenAITranslateSettings;
@@ -400,7 +396,6 @@
 
   // Provider settings actions
   updateOpenAI: (settings: Partial<OpenAISettings>) => void;
-  updateGemini: (settings: Partial<GeminiSettings>) => void;
   updateOpenAICompatible: (settings: Partial<OpenAICompatibleSettings>) => void;
   updatePalabraAI: (settings: Partial<PalabraAISettings>) => void;
   updateOpenAITranslate: (settings: Partial<OpenAITranslateSettings>) => Promise<void>;
@@ -632,7 +627,6 @@
 
 const PROVIDER_SLICE_REGISTRY = {
   openai: { defaults: defaultOpenAISettings, transformPatch: forceWebrtcTurnDetectionOff },
-  gemini: { defaults: defaultGeminiSettings },
   openaiCompatible: { defaults: defaultOpenAICompatibleSettings, transformPatch: forceWebrtcTurnDetectionOff },
   palabraai: { defaults: defaultPalabraAISettings },
   openaiTranslate: { defaults: defaultOpenAITranslateSettings },
@@ -677,7 +671,6 @@
     // === Initial State ===
     ...defaultCommonSettings,
     openai: defaultOpenAISettings,
-    gemini: defaultGeminiSettings,
     openaiCompatible: defaultOpenAICompatibleSettings,
     palabraai: defaultPalabraAISettings,
     openaiTranslate: defaultOpenAITranslateSettings,
@@ -939,7 +932,6 @@
 
     // === Provider Settings Actions ===
     updateOpenAI: (settings) => updateProviderSlice(set, 'openai', settings),
-    updateGemini: (settings) => updateProviderSlice(set, 'gemini', settings),
     updateOpenAICompatible: (settings) => updateProviderSlice(set, 'openaiCompatible', settings),
     updatePalabraAI: (settings) => updateProviderSlice(set, 'palabraai', settings),
     updateOpenAITranslate: (settings) => updateProviderSlice(set, 'openaiTranslate', settings),
@@ -1153,9 +1145,6 @@
                 case Provider.OPENAI:
                   get().updateOpenAI({ model: latestModel });
                   break;
-                case Provider.GEMINI:
-                  get().updateGemini({ model: latestModel });
-                  break;
                 case Provider.OPENAI_COMPATIBLE:
                   get().updateOpenAICompatible({ model: latestModel });
                   break;
@@ -1496,7 +1485,6 @@
 
 // Provider settings
 export const useOpenAISettings = () => useSettingsStore((state) => state.openai);
-export const useGeminiSettings = () => useSettingsStore((state) => state.gemini);
 export const useOpenAICompatibleSettings = () => useSettingsStore((state) => state.openaiCompatible);
 export const usePalabraAISettings = () => useSettingsStore((state) => state.palabraai);
 export const useOpenAITranslateSettings = () => useSettingsStore((state) => state.openaiTranslate);
@@ -1576,7 +1564,6 @@
 export const useSetParticipantSystemInstructions = () => useSettingsStore((state) => state.setParticipantSystemInstructions);
 
 export const useUpdateOpenAI = () => useSettingsStore((state) => state.updateOpenAI);
-export const useUpdateGemini = () => useSettingsStore((state) => state.updateGemini);
 export const useUpdateOpenAICompatible = () => useSettingsStore((state) => state.updateOpenAICompatible);
 export const useUpdatePalabraAI = () => useSettingsStore((state) => state.updatePalabraAI);
 export const useUpdateOpenAITranslate = () => useSettingsStore((state) => state.updateOpenAITranslate);
`````

---

### Wave 1 check (controller)

After Task 5: the full gates — `npx vitest run src` at 573 + 1 files and 7 391 + 2 tests, 0 failed, no unhandled errors; `npx vitest run electron` 34 / 477; `npx vitest run extension` 9 / 56; the gate equal to `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` (18 lines); `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t00.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t05.txt` reports `new 0` and `after 247`. Then `git log --oneline -5` shows the wave's commits, one per task, and `git status --short` shows nothing of this plan's.

---

### Task 6: Soniox's and Kizuna Soniox's old code (Wave 2)

Soniox and Kizuna Soniox run on their own definitions since the Stage 2 Soniox and Kizuna Soniox plans, both live-tested (18 of 18 each). This is the roadmap's Plan B2 (`:2406-2500`): its re-points first, then the old clients, descriptors, helpers, the MainPanel split chips and the eight re-export stubs. With Kizuna Soniox gone from the old registry, the old store's whole managed arm goes too (choice 5).

**What goes, and what changes:**
- **Re-points** (B2.1), from the stubs to `src/providers/soniox/`: `voiceLibrarySource.ts` and its test (`voicesClient`, `ttsRest`, `managedVoicesClient`, `managedVoicePolling`), `SonioxVoiceSection.tsx` and its test (`voicesClient`, `clampNumber` from `config`, the `ttsRest` mock), `lib/tts/previewSample.test.ts` (`SONIOX_LANGUAGES`).
- **The old code:** `SonioxClient.ts` and its two tests, `ManagedSonioxSession.ts` and its two tests, `SonioxSessionOutcome.ts`, `SonioxCostMeter.ts` (with tests), `SonioxProviderConfig.ts` (and test), `KizunaAISonioxProviderConfig.ts`, `managedSonioxSplit.ts`, `sonioxManagedMinBalance.ts`, `sonioxBothMode.ts` (each with its test), `sonioxSharedBothSession.test.ts`, `managedVoicePrep.ts` (and test); the wiring tests `acquireSessionResources.kizunaSoniox`, `prepareToStart.kizunaSoniox`, `sessionResourcesWiring`, `voicePrepWiring`, `kizunaProviderGating`; `kizunaProviders.test.ts`, `settingsStore.kizunaAuth.test.ts`; MainPanel's `splitDegraded.ts`, `SplitDegradedChip.{tsx,scss}` with their three tests, and `participantErrorOrdering.test.ts`; the eight stubs (`SonioxSttStream`, `SonioxTtsStream`, `PcmMixer`, `SonioxSideTracker`, `SonioxTtsRest`, `SonioxVoicesClient`, `ManagedVoicesClient`, `managedVoicePolling`).
- **The shared old code's managed arm** (choice 5): `ProviderDescriptor.ts`' `ClientOptions.sonioxManaged`, `BudgetSnapshot`, `SessionResources`, `AcquireSessionResourcesContext` and `acquireSessionResources`; `ProviderConfigFactory.ts`' two registrations and `getDefaultManagedProvider`; `IClient.ts`' Soniox config; `settingsStore.ts`' `soniox` and `kizunaSoniox` slices, `neverPersist`, `ensureKizunaApiKey`, `kizunaKeyError`, `migrateLegacyKizunaProvider` and `validateApiKey`'s `isSignedIn` parameter.
- **New code, comments and one hook:** `sttStream.ts`' `onTick` (the old managed session's; the adapter never passed it); the "deleted since" headers of `adapter.ts`, `kizunaBudget.ts`, `lease.ts`, `managedVoicesClient.ts`, `sideTracker.ts`, `ttsStream.ts`, `voiceClaim.ts`, `voicePrep.ts`, and two comments that still spoke of the old code as present: `config.ts`' ("until Plan B deletes it") and `socket.ts`' ("still reaches the old client's streams") (choice 3).
- `isKizunaSonioxEnabled` and `VITE_ENABLE_KIZUNA_SONIOX` (ruling 6): `environment.ts`, `build.yml`, `extension/vite.config.ts` (its forwarding note moves above `VITE_ENABLE_KIZUNA_AI`), `.env.example` (its general paragraphs move under `VITE_ENABLED_PROVIDERS`); the wizard tests' mocks.
- Six keys only the deleted code read: `auth.sessionUnavailable`, `auth.unknown`, `mainPanel.participantChannelFailed`, `mainPanel.splitDegradedLabel`, `mainPanel.splitDegradedTooltip`, `settings.invalidApiKeyFormat`.
- **Kept** (the roadmap's `:1753`, `:2436-2441`): `SonioxVoiceSection.tsx`, `voiceLibrarySource.ts`, `VoiceLibrarySection.tsx`, `VoicePicker.tsx`, `VoiceCreateModal.tsx`, `SonioxCloneReviewStep.tsx`, `VoiceDeleteModal.tsx`, `src/providers/soniox/**`, `src/lib/soniox/**`, `effectiveTextOnly.ts`, `SessionCountdown.tsx`.

**Files:**
- Delete (44): `src/components/MainPanel/SplitDegradedChip.scss`, `src/components/MainPanel/SplitDegradedChip.test.tsx`, `src/components/MainPanel/SplitDegradedChip.tsx`, `src/components/MainPanel/participantErrorOrdering.test.ts`, `src/components/MainPanel/splitDegraded.test.ts`, `src/components/MainPanel/splitDegraded.ts`, `src/components/MainPanel/splitDegradedWiring.test.ts`, `src/services/clients/ManagedSonioxSession.outcome.test.ts`, `src/services/clients/ManagedSonioxSession.test.ts`, `src/services/clients/ManagedSonioxSession.ts`, `src/services/clients/ManagedVoicesClient.ts`, `src/services/clients/PcmMixer.ts`, `src/services/clients/SonioxClient.managed.test.ts`, `src/services/clients/SonioxClient.test.ts`, `src/services/clients/SonioxClient.ts`, `src/services/clients/SonioxCostMeter.test.ts`, `src/services/clients/SonioxCostMeter.ts`, `src/services/clients/SonioxSessionOutcome.test.ts`, `src/services/clients/SonioxSessionOutcome.ts`, `src/services/clients/SonioxSideTracker.ts`, `src/services/clients/SonioxSttStream.ts`, `src/services/clients/SonioxTtsRest.ts`, `src/services/clients/SonioxTtsStream.ts`, `src/services/clients/SonioxVoicesClient.ts`, `src/services/clients/managedVoicePolling.ts`, `src/services/providers/KizunaAISonioxProviderConfig.ts`, `src/services/providers/SonioxProviderConfig.test.ts`, `src/services/providers/SonioxProviderConfig.ts`, `src/services/providers/acquireSessionResources.kizunaSoniox.test.ts`, `src/services/providers/kizunaProviderGating.test.ts`, `src/services/providers/managedSonioxSplit.test.ts`, `src/services/providers/managedSonioxSplit.ts`, `src/services/providers/managedVoicePrep.test.ts`, `src/services/providers/managedVoicePrep.ts`, `src/services/providers/prepareToStart.kizunaSoniox.test.ts`, `src/services/providers/sessionResourcesWiring.test.ts`, `src/services/providers/sonioxBothMode.test.ts`, `src/services/providers/sonioxBothMode.ts`, `src/services/providers/sonioxManagedMinBalance.test.ts`, `src/services/providers/sonioxManagedMinBalance.ts`, `src/services/providers/sonioxSharedBothSession.test.ts`, `src/services/providers/voicePrepWiring.test.ts`, `src/stores/kizunaProviders.test.ts`, `src/stores/settingsStore.kizunaAuth.test.ts`
- Modify (35, by the blocks below): `.env.example`, `.github/workflows/build.yml`, `extension/vite.config.ts`, `src/components/Settings/sections/SonioxVoiceSection.test.tsx`, `src/components/Settings/sections/SonioxVoiceSection.tsx`, `src/components/Settings/sections/voiceLibrarySource.test.ts`, `src/components/Settings/sections/voiceLibrarySource.ts`, `src/components/SetupWizard/SetupWizard.test.tsx`, `src/components/SetupWizard/providerPaths.test.ts`, `src/components/SetupWizard/steps/StepCredentials.test.tsx`, `src/lib/tts/previewSample.test.ts`, `src/locales/locales.consistency.test.ts`, `src/providers/soniox/adapter.ts`, `src/providers/soniox/config.ts`, `src/providers/soniox/kizunaBudget.ts`, `src/providers/soniox/lease.ts`, `src/providers/soniox/managedVoicesClient.ts`, `src/providers/soniox/sideTracker.ts`, `src/providers/soniox/socket.ts`, `src/providers/soniox/sttStream.ts`, `src/providers/soniox/ttsStream.ts`, `src/providers/soniox/voiceClaim.ts`, `src/providers/soniox/voicePrep.ts`, `src/services/interfaces/IClient.ts`, `src/services/providers/ProviderConfig.ts`, `src/services/providers/ProviderConfigFactory.ts`, `src/services/providers/ProviderDescriptor.ts`, `src/services/providers/descriptorRegistry.test.ts`, `src/services/providers/participantConfig.test.ts`, `src/services/providers/prepareToStart.local.test.ts`, `src/services/providers/providerOrder.test.ts`, `src/stores/settingsStore.sliceRegistry.test.ts`, `src/stores/settingsStore.test.ts`, `src/stores/settingsStore.ts`, `src/utils/environment.ts`
- The 30 locale catalogs `src/locales/*/translation.json`, by the key tool (6 keys)

**Interfaces:**
- Consumes: Tasks 3 and 4 (no relay twin needs `ClientOptions` or the managed arm any more).
- Produces: the old registry without a managed provider; `settingsStore.validateApiKey(getAuthToken?)` and `fetchAvailableModels(getAuthToken?)` (the `isSignedIn` parameter gone); no `src/services/clients/Soniox*`, `PcmMixer`, `Managed*`, `managedVoicePolling`.

- [ ] **Step 1: Delete the files.**

  ```
  git rm -q -- src/components/MainPanel/SplitDegradedChip.scss src/components/MainPanel/SplitDegradedChip.test.tsx src/components/MainPanel/SplitDegradedChip.tsx src/components/MainPanel/participantErrorOrdering.test.ts src/components/MainPanel/splitDegraded.test.ts src/components/MainPanel/splitDegraded.ts src/components/MainPanel/splitDegradedWiring.test.ts src/services/clients/ManagedSonioxSession.outcome.test.ts src/services/clients/ManagedSonioxSession.test.ts src/services/clients/ManagedSonioxSession.ts src/services/clients/ManagedVoicesClient.ts src/services/clients/PcmMixer.ts src/services/clients/SonioxClient.managed.test.ts src/services/clients/SonioxClient.test.ts src/services/clients/SonioxClient.ts src/services/clients/SonioxCostMeter.test.ts src/services/clients/SonioxCostMeter.ts src/services/clients/SonioxSessionOutcome.test.ts src/services/clients/SonioxSessionOutcome.ts src/services/clients/SonioxSideTracker.ts src/services/clients/SonioxSttStream.ts src/services/clients/SonioxTtsRest.ts src/services/clients/SonioxTtsStream.ts src/services/clients/SonioxVoicesClient.ts src/services/clients/managedVoicePolling.ts src/services/providers/KizunaAISonioxProviderConfig.ts src/services/providers/SonioxProviderConfig.test.ts src/services/providers/SonioxProviderConfig.ts src/services/providers/acquireSessionResources.kizunaSoniox.test.ts src/services/providers/kizunaProviderGating.test.ts src/services/providers/managedSonioxSplit.test.ts src/services/providers/managedSonioxSplit.ts src/services/providers/managedVoicePrep.test.ts src/services/providers/managedVoicePrep.ts src/services/providers/prepareToStart.kizunaSoniox.test.ts src/services/providers/sessionResourcesWiring.test.ts src/services/providers/sonioxBothMode.test.ts src/services/providers/sonioxBothMode.ts src/services/providers/sonioxManagedMinBalance.test.ts src/services/providers/sonioxManagedMinBalance.ts src/services/providers/sonioxSharedBothSession.test.ts src/services/providers/voicePrepWiring.test.ts src/stores/kizunaProviders.test.ts src/stores/settingsStore.kizunaAuth.test.ts
  ```

- [ ] **Step 2: Apply the task's diff blocks** (Global Constraints: never by hand).

  ```
  python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/plan-apply.py docs/superpowers/plans/2026-09-30-client-contract-stage2-deletion.md t06
  ```

  Expected: `t06: 35 files changed`, and no other line.

- [ ] **Step 3: Remove the locale keys only the deleted code read.**

  ```
  node /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/drop-locale-keys.mjs . auth.sessionUnavailable auth.unknown mainPanel.participantChannelFailed mainPanel.splitDegradedLabel mainPanel.splitDegradedTooltip settings.invalidApiKeyFormat
  ```

  Expected: `6 keys removed from 30 catalogs`.

- [ ] **Step 4: Check that nothing reaches what went.**

  ```
  git grep -nE "from '[^']*/(SonioxClient|ManagedSonioxSession|SonioxSessionOutcome|SonioxCostMeter|SonioxProviderConfig|KizunaAISonioxProviderConfig|managedSonioxSplit|managedVoicePrep|sonioxBothMode|sonioxManagedMinBalance|splitDegraded|SplitDegradedChip)'|services/clients/(SonioxSttStream|SonioxTtsStream|PcmMixer|SonioxSideTracker|SonioxTtsRest|SonioxVoicesClient|ManagedVoicesClient|managedVoicePolling)'|isKizunaSonioxEnabled|VITE_ENABLE_KIZUNA_SONIOX|sonioxManaged[?:]|Plan B deletes it|still reaches the old client" -- src extension .github .env.example
  ```

  Expected: nothing (exit status 1).

- [ ] **Step 5: Run the gates.** Each command as its own call; every expected number is the replay's.

  - `npx vitest run src`: **550 files passed and 1 skipped (551); 6 955 tests passed and 2 skipped (6 957)**; 0 failed, no unhandled errors.
  - `npx vitest run electron`: 34 files, 477 tests passed. `npx vitest run extension`: 9 files, 56 tests passed.
  - Local Native's old path: `npx vitest run src/services src/lib/local-inference/native src/components/Settings/sections/Native src/components/Settings/engine/useNativeEngineAdapter src/stores/nativeModelStore src/stores/settingsStore` — 53 files, 872 tests passed.
  - The typecheck, as a set: `npx tsc --noEmit -p tsconfig.json > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t06.txt`, then `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t05.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t06.txt` prints exactly `before 247 after 104; new 0; gone 143` and exits 0 — no error the task before did not have; `after 104` is the full tree's count.
  - `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh | diff - /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` prints nothing: the baseline's 18 lines, unchanged.

- [ ] **Step 6: Commit.**

```bash
git add -- .env.example .github/workflows/build.yml extension/vite.config.ts src/components/Settings/sections/SonioxVoiceSection.test.tsx src/components/Settings/sections/SonioxVoiceSection.tsx src/components/Settings/sections/voiceLibrarySource.test.ts src/components/Settings/sections/voiceLibrarySource.ts src/components/SetupWizard/SetupWizard.test.tsx src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/steps/StepCredentials.test.tsx src/lib/tts/previewSample.test.ts src/locales/locales.consistency.test.ts src/providers/soniox/adapter.ts src/providers/soniox/config.ts src/providers/soniox/kizunaBudget.ts src/providers/soniox/lease.ts src/providers/soniox/managedVoicesClient.ts src/providers/soniox/sideTracker.ts src/providers/soniox/socket.ts src/providers/soniox/sttStream.ts src/providers/soniox/ttsStream.ts src/providers/soniox/voiceClaim.ts src/providers/soniox/voicePrep.ts src/services/interfaces/IClient.ts src/services/providers/ProviderConfig.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/ProviderDescriptor.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/participantConfig.test.ts src/services/providers/prepareToStart.local.test.ts src/services/providers/providerOrder.test.ts src/stores/settingsStore.sliceRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts src/utils/environment.ts 'src/locales/*/translation.json'
```

```bash
git commit -q -F - -- src/components/MainPanel/SplitDegradedChip.scss src/components/MainPanel/SplitDegradedChip.test.tsx src/components/MainPanel/SplitDegradedChip.tsx src/components/MainPanel/participantErrorOrdering.test.ts src/components/MainPanel/splitDegraded.test.ts src/components/MainPanel/splitDegraded.ts src/components/MainPanel/splitDegradedWiring.test.ts src/services/clients/ManagedSonioxSession.outcome.test.ts src/services/clients/ManagedSonioxSession.test.ts src/services/clients/ManagedSonioxSession.ts src/services/clients/ManagedVoicesClient.ts src/services/clients/PcmMixer.ts src/services/clients/SonioxClient.managed.test.ts src/services/clients/SonioxClient.test.ts src/services/clients/SonioxClient.ts src/services/clients/SonioxCostMeter.test.ts src/services/clients/SonioxCostMeter.ts src/services/clients/SonioxSessionOutcome.test.ts src/services/clients/SonioxSessionOutcome.ts src/services/clients/SonioxSideTracker.ts src/services/clients/SonioxSttStream.ts src/services/clients/SonioxTtsRest.ts src/services/clients/SonioxTtsStream.ts src/services/clients/SonioxVoicesClient.ts src/services/clients/managedVoicePolling.ts src/services/providers/KizunaAISonioxProviderConfig.ts src/services/providers/SonioxProviderConfig.test.ts src/services/providers/SonioxProviderConfig.ts src/services/providers/acquireSessionResources.kizunaSoniox.test.ts src/services/providers/kizunaProviderGating.test.ts src/services/providers/managedSonioxSplit.test.ts src/services/providers/managedSonioxSplit.ts src/services/providers/managedVoicePrep.test.ts src/services/providers/managedVoicePrep.ts src/services/providers/prepareToStart.kizunaSoniox.test.ts src/services/providers/sessionResourcesWiring.test.ts src/services/providers/sonioxBothMode.test.ts src/services/providers/sonioxBothMode.ts src/services/providers/sonioxManagedMinBalance.test.ts src/services/providers/sonioxManagedMinBalance.ts src/services/providers/sonioxSharedBothSession.test.ts src/services/providers/voicePrepWiring.test.ts src/stores/kizunaProviders.test.ts src/stores/settingsStore.kizunaAuth.test.ts .env.example .github/workflows/build.yml extension/vite.config.ts src/components/Settings/sections/SonioxVoiceSection.test.tsx src/components/Settings/sections/SonioxVoiceSection.tsx src/components/Settings/sections/voiceLibrarySource.test.ts src/components/Settings/sections/voiceLibrarySource.ts src/components/SetupWizard/SetupWizard.test.tsx src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/steps/StepCredentials.test.tsx src/lib/tts/previewSample.test.ts src/locales/locales.consistency.test.ts src/providers/soniox/adapter.ts src/providers/soniox/config.ts src/providers/soniox/kizunaBudget.ts src/providers/soniox/lease.ts src/providers/soniox/managedVoicesClient.ts src/providers/soniox/sideTracker.ts src/providers/soniox/socket.ts src/providers/soniox/sttStream.ts src/providers/soniox/ttsStream.ts src/providers/soniox/voiceClaim.ts src/providers/soniox/voicePrep.ts src/services/interfaces/IClient.ts src/services/providers/ProviderConfig.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/ProviderDescriptor.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/participantConfig.test.ts src/services/providers/prepareToStart.local.test.ts src/services/providers/providerOrder.test.ts src/stores/settingsStore.sliceRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts src/utils/environment.ts 'src/locales/*/translation.json' <<'EOF'
refactor(soniox): delete the old Soniox and Kizuna Soniox code

Both run on their own definitions and have passed their live tests.
Re-point the kept voice modules from the re-export stubs to
src/providers/soniox, then delete the old clients, managed session,
descriptors, split and budget helpers, the MainPanel split chips, the
eight stubs, the old store's managed arm, the managed release flag and
the locale keys only this code read.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

**The blocks** (`t06`, one per file, in the order the applier takes them):

`.env.example`

`````diff t06
diff --git a/.env.example b/.env.example
--- a/.env.example
+++ b/.env.example
@@ -14,18 +14,8 @@
 # makes this a non-Kizuna build; it cannot hold back an individual provider.
 VITE_ENABLE_KIZUNA_AI=true
 
-# One gate per Kizuna-managed provider, because they are released
-# independently. Each is ANDed with the master gate above.
-#
~ 7 more removed lines sha256:bb7225256ab7
-# configuration these gates exist to prevent. Development ignores the values
-# anyway: each helper returns true whenever DEV is set.
+# Flagged providers in the new provider registry that a release offers, by id,
+# comma-separated (development builds offer all of them). Empty: none.
 #
 # Adding a gate here is not enough to make it reach a build — it must also be
 # forwarded in extension/vite.config.ts's `define` list and in every build step
@@ -39,10 +29,6 @@
 # values in `gh variable list`, which is how you confirm what a release will
 # offer before tagging it. v0.36.3 shipped with the whole Kizuna family off
 # because the values were set as variables while the workflow read secrets.
-VITE_ENABLE_KIZUNA_SONIOX=false
-
-# Flagged providers in the new provider registry that a release offers, by id,
-# comma-separated (development builds offer all of them). Empty: none.
 VITE_ENABLED_PROVIDERS=
 
 # PostHog Analytics Configuration
`````

`.github/workflows/build.yml`

`````diff t06
diff --git a/.github/workflows/build.yml b/.github/workflows/build.yml
--- a/.github/workflows/build.yml
+++ b/.github/workflows/build.yml
@@ -218,7 +218,6 @@
           VITE_POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
           VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
-          VITE_ENABLE_KIZUNA_SONIOX: ${{ vars.VITE_ENABLE_KIZUNA_SONIOX }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
           # Additional variables only for releases
@@ -269,7 +268,6 @@ occurrence 1 of 3
           VITE_POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
           VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
-          VITE_ENABLE_KIZUNA_SONIOX: ${{ vars.VITE_ENABLE_KIZUNA_SONIOX }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
 
@@ -306,7 +304,6 @@ occurrence 2 of 3
           VITE_POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
           VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
-          VITE_ENABLE_KIZUNA_SONIOX: ${{ vars.VITE_ENABLE_KIZUNA_SONIOX }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
 
@@ -405,7 +402,6 @@ occurrence 3 of 3
           VITE_POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
           VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
-          VITE_ENABLE_KIZUNA_SONIOX: ${{ vars.VITE_ENABLE_KIZUNA_SONIOX }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
 
@@ -504,7 +500,6 @@
           POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
           VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
-          VITE_ENABLE_KIZUNA_SONIOX: ${{ vars.VITE_ENABLE_KIZUNA_SONIOX }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
 
`````

`extension/vite.config.ts`

`````diff t06
diff --git a/extension/vite.config.ts b/extension/vite.config.ts
--- a/extension/vite.config.ts
+++ b/extension/vite.config.ts
@@ -160,18 +160,15 @@
       'import.meta.env.VITE_BACKEND_URL': JSON.stringify(
         envVal('VITE_BACKEND_URL', '')
       ),
+      // Every gate is forwarded explicitly, like every key above: Vite's
+      // automatic loading reads the EXTENSION directory, so a flag documented
+      // in the root .env reaches this build only by appearing in this list.
+      // Omitted, the gate reads false in extension builds no matter how it is
+      // configured — which makes the switch unturnable-on.
+      // `featureGateForwarding.consistency.test.ts` fails when one is missing.
       'import.meta.env.VITE_ENABLE_KIZUNA_AI': JSON.stringify(
         envVal('VITE_ENABLE_KIZUNA_AI', 'false', 'true')
       ),
-      // One gate per managed provider, forwarded explicitly like every key
-      // above: Vite's automatic loading reads the EXTENSION directory, so a
-      // flag documented in the root .env reaches this build only by appearing
-      // in this list. Omitted, the gate reads false in extension builds no
-      // matter how it is configured — which makes the switch unturnable-on.
-      // `featureGateForwarding.consistency.test.ts` fails when one is missing.
-      'import.meta.env.VITE_ENABLE_KIZUNA_SONIOX': JSON.stringify(
-        envVal('VITE_ENABLE_KIZUNA_SONIOX', 'false', 'true')
-      ),
       'import.meta.env.VITE_ENABLE_PALABRA_AI': JSON.stringify(
         envVal('VITE_ENABLE_PALABRA_AI', 'false')
       ),
`````

`src/components/Settings/sections/SonioxVoiceSection.test.tsx`

`````diff t06
diff --git a/src/components/Settings/sections/SonioxVoiceSection.test.tsx b/src/components/Settings/sections/SonioxVoiceSection.test.tsx
--- a/src/components/Settings/sections/SonioxVoiceSection.test.tsx
+++ b/src/components/Settings/sections/SonioxVoiceSection.test.tsx
@@ -5,9 +5,9 @@
 import { compile } from 'sass';
 import type { VoiceLibrarySource } from './voiceLibrarySource';
 import { managedVoiceSource } from './voiceLibrarySource';
-import type { ManagedVoicesClient } from '../../../services/clients/ManagedVoicesClient';
+import type { ManagedVoicesClient } from '../../../providers/soniox/managedVoicesClient';
 import { SONIOX_TTS_MODEL, SONIOX_DEFAULT_VOICE } from '../../../lib/soniox/ttsCatalog';
-import { synthesizeOnce } from '../../../services/clients/SonioxTtsRest';
+import { synthesizeOnce } from '../../../providers/soniox/ttsRest';
 import { clearPreviewCache } from '../../../lib/tts/previewCache';
 
 vi.mock('react-i18next', async (importOriginal) => {
@@ -97,7 +97,7 @@
 // managedVoiceSource's `synthesize` dependency (see the "auditions a preset"
 // test below) without an `as any` at the call site.
 const synthesizeMock = vi.fn<typeof synthesizeOnce>();
-vi.mock('../../../services/clients/SonioxTtsRest', () => ({
+vi.mock('../../../providers/soniox/ttsRest', () => ({
   synthesizeOnce: (...args: Parameters<typeof synthesizeOnce>) => synthesizeMock(...args),
 }));
 
@@ -114,7 +114,7 @@
 });
 
 const { default: SonioxVoiceSection } = await import('./SonioxVoiceSection');
-const { SonioxVoicesError } = await import('../../../services/clients/SonioxVoicesClient');
+const { SonioxVoicesError } = await import('../../../providers/soniox/voicesClient');
 
 const READY = { model: SONIOX_TTS_MODEL, status: 'ready', error_type: null, error_message: null };
 const cloned = (over: object = {}) => ({ id: 'uuid-1', name: 'Me', models: [READY], ...over });
`````

`src/components/Settings/sections/SonioxVoiceSection.tsx`

`````diff t06
diff --git a/src/components/Settings/sections/SonioxVoiceSection.tsx b/src/components/Settings/sections/SonioxVoiceSection.tsx
--- a/src/components/Settings/sections/SonioxVoiceSection.tsx
+++ b/src/components/Settings/sections/SonioxVoiceSection.tsx
@@ -41,10 +41,10 @@
   SonioxVoicesError,
   encodeWavPcm16,
   type SonioxVoice,
-} from '../../../services/clients/SonioxVoicesClient';
+} from '../../../providers/soniox/voicesClient';
 import { resolvePreviewSample } from '../../../lib/tts/previewSample';
 import { previewCacheKey, getCachedPreview, setCachedPreview, clearPreviewCache } from '../../../lib/tts/previewCache';
-import { clampNumber } from '../../../services/providers/SonioxProviderConfig';
+import { clampNumber } from '../../../providers/soniox/config';
 import { SONIOX_TTS_MODEL, SONIOX_DEFAULT_VOICE } from '../../../lib/soniox/ttsCatalog';
 import { SONIOX_VOICE_ROSTER } from '../../../lib/soniox/sonioxVoiceRoster';
 import {
@@ -338,8 +338,8 @@
         return new Error(t('voiceLibrary.previewSessionRunning', 'A session is running. Try again in a moment.'));
       }
       if (e.status === 503) {
-        // Same wording a managed session-key 503 already uses — see
-        // ManagedSonioxSession.describeError's `mainPanel.sonioxServiceBusy`.
+        // Same wording the old managed session-key 503 used
+        // (`mainPanel.sonioxServiceBusy`).
         return new Error(t('mainPanel.sonioxServiceBusy', 'Soniox is at capacity right now. Please try again shortly.'));
       }
       // Gated on `managed` for the same reason the 402/409 arms above are:
@@ -434,8 +434,8 @@
     // Cannot be null for a null `speaks` predicate (see resolvePreviewSample's
     // docstring), but narrowed here rather than asserted.
     if (!sample) return null;
-    // Same choke point the session path uses (SonioxProviderConfig.
-    // buildSessionConfig): the slider already constrains this in practice, so
+    // Same choke point the session path uses (`providers/soniox/config.ts`'s
+    // `buildSoniox`): the slider already constrains this in practice, so
     // clamping here is defensive, but the two paths reading the same setting
     // should agree on its bounds rather than one trusting the raw value.
     const speed = clampNumber(settings.ttsSpeed, 0.7, 1.3, 1.0);
@@ -634,7 +634,7 @@
 
   const onDelete = async (id: string) => {
     if (!source) return;
-    // The live session's SonioxClient captured this voice id at session start
+    // The live session captured this voice id at its start
     // and reuses it for every TTS stream — deleting it server-side would break
     // spoken translation for the rest of the session.
     if (isSessionActive && settings.voice === id) {
`````

`src/components/Settings/sections/voiceLibrarySource.test.ts`

`````diff t06
diff --git a/src/components/Settings/sections/voiceLibrarySource.test.ts b/src/components/Settings/sections/voiceLibrarySource.test.ts
--- a/src/components/Settings/sections/voiceLibrarySource.test.ts
+++ b/src/components/Settings/sections/voiceLibrarySource.test.ts
@@ -1,10 +1,10 @@
 import { describe, it, expect, vi, beforeEach } from 'vitest';
 import 'fake-indexeddb/auto';
 import { byokVoiceSource, managedVoiceSource } from './voiceLibrarySource';
-import { SonioxVoicesError } from '../../../services/clients/SonioxVoicesClient';
+import { SonioxVoicesError } from '../../../providers/soniox/voicesClient';
 import { loadVoiceClip, resetVoiceClipStorageForTesting } from '../../../lib/soniox/voiceClipStorage';
-import type { ManagedVoicesClient } from '../../../services/clients/ManagedVoicesClient';
-import type { SonioxVoicesClient } from '../../../services/clients/SonioxVoicesClient';
+import type { ManagedVoicesClient } from '../../../providers/soniox/managedVoicesClient';
+import type { SonioxVoicesClient } from '../../../providers/soniox/voicesClient';
 import { settleReports, resetReportThrottle } from '../../../lib/diagnostics/report';
 import useLogStore from '../../../stores/logStore';
 
`````

`src/components/Settings/sections/voiceLibrarySource.ts`

`````diff t06
diff --git a/src/components/Settings/sections/voiceLibrarySource.ts b/src/components/Settings/sections/voiceLibrarySource.ts
--- a/src/components/Settings/sections/voiceLibrarySource.ts
+++ b/src/components/Settings/sections/voiceLibrarySource.ts
@@ -12,15 +12,15 @@
  * synthesizing a sample, which needs a Soniox key the managed user does not
  * have. That is a property of the SOURCE, not of the section.
  */
-import type { SonioxVoice, SonioxVoicesClient } from '../../../services/clients/SonioxVoicesClient';
-import type { ManagedVoicesClient, ManagedVoice } from '../../../services/clients/ManagedVoicesClient';
-import { SonioxVoicesError } from '../../../services/clients/SonioxVoicesClient';
-import { synthesizeOnce } from '../../../services/clients/SonioxTtsRest';
+import type { SonioxVoice, SonioxVoicesClient } from '../../../providers/soniox/voicesClient';
+import type { ManagedVoicesClient, ManagedVoice } from '../../../providers/soniox/managedVoicesClient';
+import { SonioxVoicesError } from '../../../providers/soniox/voicesClient';
+import { synthesizeOnce } from '../../../providers/soniox/ttsRest';
 import type { SonioxRegion } from '../../../lib/soniox/regions';
 import { DEFAULT_SONIOX_REGION } from '../../../lib/soniox/regions';
 import { saveVoiceClip, clearVoiceClip } from '../../../lib/soniox/voiceClipStorage';
 import { SONIOX_TTS_MODEL } from '../../../lib/soniox/ttsCatalog';
-import { managedVoicePollDelayMs } from '../../../services/clients/managedVoicePolling';
+import { managedVoicePollDelayMs } from '../../../providers/soniox/managedVoicePolling';
 import { reportWarning, describeCause } from '../../../lib/diagnostics/report';
 
 export interface VoiceLibrarySource {
@@ -338,7 +338,7 @@
           //
           // NOT swallowed silently, though — "never rethrow" and "discard" are
           // different decisions, and the sibling fire-and-forget calls
-          // (ManagedSonioxSession.markStarted/end) already made the second one
+          // (the lease's session-started/end reports) already made the second one
           // for good reason: unread, a systemic failure here (a route typo, a
           // deploy skew) would be invisible — every preview keeps playing, no
           // preview is ever billed, and the account's next Start 409s for up to
`````

`src/components/SetupWizard/SetupWizard.test.tsx`

`````diff t06
diff --git a/src/components/SetupWizard/SetupWizard.test.tsx b/src/components/SetupWizard/SetupWizard.test.tsx
--- a/src/components/SetupWizard/SetupWizard.test.tsx
+++ b/src/components/SetupWizard/SetupWizard.test.tsx
@@ -3,7 +3,7 @@
 
 vi.mock('../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
-  isKizunaAIEnabled: () => true, isKizunaSonioxEnabled: () => true,
+  isKizunaAIEnabled: () => true,
   isPalabraAIEnabled: () => true, isLocalNativeEnabled: () => true,
   isElectron: () => true, isExtension: () => false,
 }));
`````

`src/components/SetupWizard/providerPaths.test.ts`

`````diff t06
diff --git a/src/components/SetupWizard/providerPaths.test.ts b/src/components/SetupWizard/providerPaths.test.ts
--- a/src/components/SetupWizard/providerPaths.test.ts
+++ b/src/components/SetupWizard/providerPaths.test.ts
@@ -3,7 +3,6 @@
 vi.mock('../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
-  isKizunaSonioxEnabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
`````

`src/components/SetupWizard/steps/StepCredentials.test.tsx`

`````diff t06
diff --git a/src/components/SetupWizard/steps/StepCredentials.test.tsx b/src/components/SetupWizard/steps/StepCredentials.test.tsx
--- a/src/components/SetupWizard/steps/StepCredentials.test.tsx
+++ b/src/components/SetupWizard/steps/StepCredentials.test.tsx
@@ -3,7 +3,7 @@
 
 vi.mock('../../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
-  isKizunaAIEnabled: () => true, isKizunaSonioxEnabled: () => true,
+  isKizunaAIEnabled: () => true,
   isPalabraAIEnabled: () => true, isLocalNativeEnabled: () => true,
   isElectron: () => true, isExtension: () => false,
 }));
`````

`src/lib/tts/previewSample.test.ts`

`````diff t06
diff --git a/src/lib/tts/previewSample.test.ts b/src/lib/tts/previewSample.test.ts
--- a/src/lib/tts/previewSample.test.ts
+++ b/src/lib/tts/previewSample.test.ts
@@ -1,10 +1,8 @@
 import { describe, it, expect } from 'vitest';
 import { previewSampleFor, resolvePreviewSample, PREVIEW_SAMPLES } from './previewSample';
-import { SonioxProviderConfig } from '../../services/providers/SonioxProviderConfig';
+import { SONIOX_LANGUAGES } from '../../providers/soniox/settings';
 
-const supported = new Set(
-  new SonioxProviderConfig().getConfig().languages.map((l: { value: string }) => l.value)
-);
+const supported = new Set(SONIOX_LANGUAGES.map((l) => l.value));
 
 describe('previewSampleFor', () => {
   it('only seeds languages Soniox can actually synthesize', () => {
`````

`src/locales/locales.consistency.test.ts`

`````diff t06
diff --git a/src/locales/locales.consistency.test.ts b/src/locales/locales.consistency.test.ts
--- a/src/locales/locales.consistency.test.ts
+++ b/src/locales/locales.consistency.test.ts
@@ -4,9 +4,6 @@
 vi.mock('../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
-  // Explicit: each managed provider is gated on its own now, and this mock's
-  // promise is that EVERY provider gate is forced on.
-  isKizunaSonioxEnabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
`````

`src/providers/soniox/adapter.ts`

`````diff t06
diff --git a/src/providers/soniox/adapter.ts b/src/providers/soniox/adapter.ts
--- a/src/providers/soniox/adapter.ts
+++ b/src/providers/soniox/adapter.ts
@@ -1,7 +1,7 @@
 /**
  * Soniox on the new contract (spec: "L0 — the client contract"), ported
- * from `SonioxClient` (`src/services/clients/SonioxClient.ts`, still
- * compiled for the managed twin) without its display bookkeeping: items,
+ * from `SonioxClient` (`src/services/clients/SonioxClient.ts`, deleted
+ * since) without its display bookkeeping: items,
  * ids, the punctuation lane and the notices are L1's and L2's now.
  * `SonioxCore` runs one STT socket; each speaking leg has its own
  * `LegSpeech`. Both mode (`startBoth`, D23) is two single-leg cores, or one
`````

`src/providers/soniox/config.ts`

`````diff t06
diff --git a/src/providers/soniox/config.ts b/src/providers/soniox/config.ts
--- a/src/providers/soniox/config.ts
+++ b/src/providers/soniox/config.ts
@@ -2,7 +2,8 @@
  * Soniox's `C`, `build` and `describe` (survey §2.7). `build` never
  * refuses: an auto source with the participant leg is the gate's (D20).
  * The vocabulary helpers are copied from `SonioxProviderConfig.ts:73-165`
- * (ruling 1): the old descriptor keeps its own until Plan B deletes it.
+ * (ruling 1), deleted since with the old descriptor (Stage 2 deletion,
+ * ruling 2).
  */
 import type { SessionContext } from '../../lib/contract/adapter';
 import { reportWarning } from '../../lib/diagnostics/report';
`````

`src/providers/soniox/kizunaBudget.ts`

`````diff t06
diff --git a/src/providers/soniox/kizunaBudget.ts b/src/providers/soniox/kizunaBudget.ts
--- a/src/providers/soniox/kizunaBudget.ts
+++ b/src/providers/soniox/kizunaBudget.ts
@@ -2,8 +2,8 @@
  * What Kizuna AI's backend charges a managed Soniox session to start, and
  * how long it grants one — mirrored so the start gate and the grant-end
  * words can be right before the backend says so (Stage 2 Kizuna Soniox,
- * rulings 3 and 6). Ported from `sonioxManagedMinBalance.ts` (read-only
- * until Plan B2). KEEP IN SYNC with sokuji-backend
+ * rulings 3 and 6). Ported from `sonioxManagedMinBalance.ts` (deleted
+ * since). KEEP IN SYNC with sokuji-backend
  * `src/services/soniox-budget.ts` (the conservative rates) and
  * `src/config/soniox.ts` (`MIN_SESSION_S`, `MAX_TRANSCRIPTION_SESSION_S`,
  * `TTS_KEY_MAX_TTL_S`, `MAX_SYNTHESIS_SESSION_S`); `kizunaBudget.test.ts`
`````

`src/providers/soniox/lease.ts`

`````diff t06
diff --git a/src/providers/soniox/lease.ts b/src/providers/soniox/lease.ts
--- a/src/providers/soniox/lease.ts
+++ b/src/providers/soniox/lease.ts
@@ -6,7 +6,7 @@
  * own `SonioxCredentials`; it ends the run when the grant does, and
  * `release` tells the backend the session is over. Ported from
  * `ManagedSonioxSession` (`src/services/clients/ManagedSonioxSession.ts`,
- * read-only until Plan B2), with every timer on the run's clock and every
+ * deleted since), with every timer on the run's clock and every
  * wait abortable. Not Soniox's session side: `adapter.ts` never reaches
  * this module. The participant's speech key is mapped only while the
  * participant-speech flag is on (ruling 2). Each STT role's
`````

`src/providers/soniox/managedVoicesClient.ts`

`````diff t06
diff --git a/src/providers/soniox/managedVoicesClient.ts b/src/providers/soniox/managedVoicesClient.ts
--- a/src/providers/soniox/managedVoicesClient.ts
+++ b/src/providers/soniox/managedVoicesClient.ts
@@ -50,7 +50,7 @@
   ttsApiKey: string;
   /** The region THESE KEYS belong to, echoed back by the backend rather than
    *  assumed to be the request's own `region` — same reasoning as
-   *  `ManagedSonioxSession.fileBundles`'s use of the response's region. A
+   *  `lease.ts` filing a grant's keys under the response's region. A
    *  missing or unrecognised value narrows to THIS CLIENT's own `region`
    *  (see `sessionKey` below), never to the global US default: for a eu/jp
    *  account that default is the one value guaranteed to disagree with both
`````

`src/providers/soniox/sideTracker.ts`

`````diff t06
diff --git a/src/providers/soniox/sideTracker.ts b/src/providers/soniox/sideTracker.ts
--- a/src/providers/soniox/sideTracker.ts
+++ b/src/providers/soniox/sideTracker.ts
@@ -2,7 +2,7 @@
  * Speaker-label → conversation-side attribution for the Both single-session
  * path (see docs/superpowers/specs/2026-07-30-soniox-diarization-attribution-design.md).
  *
- * Pure bookkeeping — no timers, no I/O. SonioxClient records one energy
+ * Pure bookkeeping — no timers, no I/O. The adapter records one energy
  * sample per 100 ms mixer frame ACTUALLY SENT to the STT socket (dropped
  * frames don't advance the server's audio clock), so frame index × frameMs
  * lines up with token start_ms/end_ms. Channel A is the mic ('speaker'
`````

`src/providers/soniox/socket.ts`

`````diff t06
diff --git a/src/providers/soniox/socket.ts b/src/providers/soniox/socket.ts
--- a/src/providers/soniox/socket.ts
+++ b/src/providers/soniox/socket.ts
@@ -8,7 +8,7 @@
 
 export type OpenSocket = (url: string) => WebSocket;
 
-/** Read at call time, so an old test's `vi.stubGlobal('WebSocket')` still reaches the old client's streams. */
+/** Read at call time, so a test's `vi.stubGlobal('WebSocket')` reaches it. */
 export const nativeSocket: OpenSocket = (url) => new WebSocket(url);
 
 /** `WebSocket.OPEN`, read as the constant it is: the socket may be an injected one, whatever the global says. */
`````

`src/providers/soniox/sttStream.ts`

`````diff t06
diff --git a/src/providers/soniox/sttStream.ts b/src/providers/soniox/sttStream.ts
--- a/src/providers/soniox/sttStream.ts
+++ b/src/providers/soniox/sttStream.ts
@@ -2,7 +2,7 @@
  * Soniox real-time STT+translation WebSocket wire component.
  *
  * Protocol-only: this class knows the Soniox STT wire protocol and nothing
- * about IClient or Sokuji conversation semantics (that is SonioxClient's job).
+ * about IClient or Sokuji conversation semantics (that is `adapter.ts`'s job).
  *
  * Live-verified protocol facts (2026-07-18):
  * - The first frame after open MUST be a JSON config message.
@@ -82,11 +82,6 @@
   onFinished?: () => void;
   onError?: (code: string, message: string) => void;
   onClose?: (event: { code?: number; reason?: string }) => void;
-  // Fires on every keepalive-check tick (see KEEPALIVE_CHECK_INTERVAL_MS),
-  // independent of whether a keepalive frame was actually sent. Managed-mode
-  // SonioxClient drives its SonioxCostMeter off this — it is the "existing
-  // interval" the meter is meant to reuse rather than starting a second timer.
-  onTick?: () => void;
   /** A frame that would not parse: the caller decides what an episode of them is worth (choice 7). */
   onUnreadable?: (error: unknown) => void;
 }
@@ -248,9 +243,6 @@
         this.ws!.send(JSON.stringify({ type: 'keepalive' }));
         this.lastAudioAt = this.clock.now();
       }
-      // Runs every tick regardless of whether a keepalive frame was actually
-      // sent — see onTick's docstring.
-      this.handlers.onTick?.();
     });
   }
 
`````

`src/providers/soniox/ttsStream.ts`

`````diff t06
diff --git a/src/providers/soniox/ttsStream.ts b/src/providers/soniox/ttsStream.ts
--- a/src/providers/soniox/ttsStream.ts
+++ b/src/providers/soniox/ttsStream.ts
@@ -104,7 +104,7 @@
   // hadActiveStream: whether a stream carrying utterance text (active or still
   // draining its final audio) existed at the moment of this error/close, as
   // opposed to a socket that was genuinely idle. The caller
-  // (SonioxClient.handleTtsError) uses it to decide whether a drop cost any
+  // (`speech.ts`'s `failure`) uses it to decide whether a drop cost any
   // spoken output at all, and `scope` to say how much.
   onError?: (code: string, message: string, hadActiveStream: boolean, scope: SonioxTtsErrorScope) => void;
   /** A frame that would not parse: the caller decides what an episode of them is worth (choice 7). */
`````

`src/providers/soniox/voiceClaim.ts`

`````diff t06
diff --git a/src/providers/soniox/voiceClaim.ts b/src/providers/soniox/voiceClaim.ts
--- a/src/providers/soniox/voiceClaim.ts
+++ b/src/providers/soniox/voiceClaim.ts
@@ -4,7 +4,7 @@
  * in — the backend runs Soniox's voice quota as an LRU cache, so a voice
  * chosen days ago may be gone — rebuilding it from this device's clip when
  * it must. Ported from `KizunaAISonioxProviderConfig.prepareToStart`
- * (read-only until Plan B2). It never refuses a start: a claim that fails
+ * (deleted since). It never refuses a start: a claim that fails
  * runs this session on the built-in voice, says why once the session is up,
  * and leaves the stored choice alone. The routine's sleeps run on the real
  * clock, injectable for tests (ruling 10).
`````

`src/providers/soniox/voicePrep.ts`

`````diff t06
diff --git a/src/providers/soniox/voicePrep.ts b/src/providers/soniox/voicePrep.ts
--- a/src/providers/soniox/voicePrep.ts
+++ b/src/providers/soniox/voicePrep.ts
@@ -3,7 +3,7 @@
  * starts.
  *
  * Ported from `src/services/providers/managedVoicePrep.ts` (Stage 2 Kizuna
- * Soniox, ruling 1; the old copy stays for the old descriptor until Plan B2):
+ * Soniox, ruling 1; the old copy is deleted since):
  * the routine is unchanged; a failure now answers a notice **code** worded
  * through `NOTICE_ALIASES` (choice 17).
  *
@@ -41,7 +41,7 @@
   sleep?: (ms: number) => Promise<void>;
   now?: () => number;
   /** Caller cancellation — e.g. MainPanel's start-scoped aborter, threaded in
-   *  as `ports.signal` by `KizunaAISonioxProviderConfig.prepareToStart`.
+   *  as `signal` by `voiceClaim.ts`.
    *  Threaded into every `ensure`/`mine` call so a cancel reaches the network
    *  (not just gates the NEXT attempt), and additionally checked at every
    *  loop boundary below the deadline already is. Optional: a caller with no
@@ -68,8 +68,8 @@
    *  own deadline at the catch site — see SonioxTtsRest.synthesizeOnce, the
    *  precedent for that shape), and a cancel observed at a loop boundary
    *  resolves through the same degrade path deadline exhaustion already
-   *  does. `KizunaAISonioxProviderConfig.prepareToStart` always supplies one
-   *  (`ports.signal`), so 135 s is a bound this codebase's only caller no
+   *  does. `voiceClaim.ts` always supplies one (`signal`), so 135 s is a
+   *  bound this codebase's only caller no
    *  longer hits in practice. */
   timeoutMs?: number;
   /** Wait before readiness poll number `attempt` (0-based). Defaults to the
@@ -236,7 +236,7 @@
 
 /**
  * Turn a `prepareManagedVoice()` result into the three decisions
- * `KizunaAISonioxProviderConfig.prepareToStart` actually needs to make: what
+ * `voiceClaim.ts` actually needs to make: what
  * voice this session uses, whether to persist a changed id, and what (if
  * anything) to tell the user afterwards.
  *
`````

`src/services/interfaces/IClient.ts`

`````diff t06
diff --git a/src/services/interfaces/IClient.ts b/src/services/interfaces/IClient.ts
--- a/src/services/interfaces/IClient.ts
+++ b/src/services/interfaces/IClient.ts
@@ -154,36 +154,6 @@
   autoTempo: boolean;
 }
 
-/**
- * Soniox speech-to-speech translation session configuration.
- * `voice` comes from BaseSessionConfig. When `bidirectional` is true the
~ 25 more removed lines sha256:77feb67ed611
-}
-
 /**
  * Local inference session configuration
  */
@@ -247,7 +217,7 @@
 /**
  * Union type for all possible session configurations
  */
-export type SessionConfig = OpenAISessionConfig | OpenAITranslateSessionConfig | PalabraAISessionConfig | SonioxSessionConfig | LocalInferenceSessionConfig | LocalNativeSessionConfig;
+export type SessionConfig = OpenAISessionConfig | OpenAITranslateSessionConfig | PalabraAISessionConfig | LocalInferenceSessionConfig | LocalNativeSessionConfig;
 
 /**
  * Type guards for session configurations
@@ -267,10 +237,6 @@
   return config.provider === 'palabraai';
 }
 
-export function isSonioxSessionConfig(config: SessionConfig): config is SonioxSessionConfig {
-  return config.provider === 'soniox';
-}
-
 export function isLocalInferenceSessionConfig(config: SessionConfig): config is LocalInferenceSessionConfig {
   return config.provider === 'local_inference';
 }
@@ -398,21 +364,4 @@
    * owns its own capture (WebRTC bridge analyser). Absent on clients fed by the
    * shared recorder. */
   getInputFrequencies?(): { values: Float32Array } | null;
-
-  // Optional Both single-session (Soniox) mixer methods
-  /** Feed the second audio channel (Both single-session mixer). SonioxClient only. */
~ 12 more removed lines sha256:0af344713dff
-   */
-  getManagedBudgetInfo?(): { budgetMicroUsd: number; rateUsdPerHour: number; startedAtMs: number } | null;
 }
`````

`src/services/providers/ProviderConfig.ts`

`````diff t06
diff --git a/src/services/providers/ProviderConfig.ts b/src/services/providers/ProviderConfig.ts
--- a/src/services/providers/ProviderConfig.ts
+++ b/src/services/providers/ProviderConfig.ts
@@ -58,7 +58,7 @@
 
   // ── S1 capability flags (spec: 2026-08-13-mainpanel-provider-seams) ──
   // Optional: only descriptors that deviate from the default declare them.
-  // Kizuna twins and OpenAI-Compatible inherit via their `...base` spread.
+  // OpenAI-Compatible inherits via its `...base` spread.
 
   /** Speech-mode names from THIS provider's settings vocabulary that send
    *  audio only while the user holds Space. Encodes that 'Disabled' is
`````

`src/services/providers/ProviderConfigFactory.ts`

`````diff t06
diff --git a/src/services/providers/ProviderConfigFactory.ts b/src/services/providers/ProviderConfigFactory.ts
--- a/src/services/providers/ProviderConfigFactory.ts
+++ b/src/services/providers/ProviderConfigFactory.ts
@@ -4,12 +4,10 @@
 import { OpenAICompatibleProviderConfig } from './OpenAICompatibleProviderConfig';
 import { OpenAITranslateProviderConfig } from './OpenAITranslateProviderConfig';
 import { PalabraAIProviderConfig } from './PalabraAIProviderConfig';
-import { KizunaAISonioxProviderConfig } from './KizunaAISonioxProviderConfig';
 import { LocalInferenceProviderConfig } from './LocalInferenceProviderConfig';
 import { LocalNativeProviderConfig } from './LocalNativeProviderConfig';
-import { SonioxProviderConfig } from './SonioxProviderConfig';
 import { Provider, ProviderType } from '../../types/Provider';
-import { isKizunaAIEnabled, isKizunaSonioxEnabled, isPalabraAIEnabled, isLocalNativeEnabled, isElectron } from '../../utils/environment';
+import { isPalabraAIEnabled, isLocalNativeEnabled, isElectron } from '../../utils/environment';
 
 export class ProviderConfigFactory {
   private static configs: Map<ProviderType, ProviderDescriptor> = new Map();
@@ -22,18 +20,6 @@
     // AST 2.0, the three OpenAI providers, Soniox, OpenAI Compatible, Palabra,
     // then everything else.
 
-    // 1. Kizuna-managed providers — behind the master Kizuna gate plus their
-    //    own gates. Each managed provider carries its OWN gate: they are
-    //    released independently, and they bill on different models whose
~ 7 more removed lines sha256:a030a094d14d
-    }
-
     // 2. Free (local inference) — always available, no API key or flag.
     ProviderConfigFactory.configs.set(Provider.LOCAL_INFERENCE, new LocalInferenceProviderConfig());
 
@@ -41,9 +27,6 @@
     ProviderConfigFactory.configs.set(Provider.OPENAI, new OpenAIProviderConfig());
     ProviderConfigFactory.configs.set(Provider.OPENAI_TRANSLATE, new OpenAITranslateProviderConfig());
 
-    // 6. Soniox speech-to-speech translation — always available (BYOK).
-    ProviderConfigFactory.configs.set(Provider.SONIOX, new SonioxProviderConfig());
-
     // 7. OpenAI Compatible — Electron only.
     if (isElectron()) {
       ProviderConfigFactory.configs.set(Provider.OPENAI_COMPATIBLE, new OpenAICompatibleProviderConfig());
@@ -115,25 +98,6 @@
    * @param providerId - The provider identifier
    * @returns ProviderDescriptor instance
    */
-  /**
-   * The Kizuna-managed provider to put a Basic-mode user on when they sign
-   * in, or null when this build offers none.
~ 14 more removed lines sha256:d2b6b120c4cf
-  }
-
   static getDescriptor(providerId: ProviderType): ProviderDescriptor {
     const d = this.configs.get(providerId);
     if (!d) throw new Error(`Unsupported provider: ${providerId}`);
`````

`src/services/providers/ProviderDescriptor.ts`

`````diff t06
diff --git a/src/services/providers/ProviderDescriptor.ts b/src/services/providers/ProviderDescriptor.ts
--- a/src/services/providers/ProviderDescriptor.ts
+++ b/src/services/providers/ProviderDescriptor.ts
@@ -1,9 +1,6 @@
 import { ProviderConfig, LanguageOption } from './ProviderConfig';
 import { IClient, FilteredModel, SessionConfig } from '../interfaces/IClient';
 import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
-// Type-only, so this adds no runtime edge from the shared descriptor module to
-// SonioxClient's dependency graph (i18n, the wire components).
-import type { ManagedSonioxSession, SonioxCredentialBundle, SonioxSttRole } from '../clients/ManagedSonioxSession';
 import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';
 
 /** Transport for realtime providers. Moved here from settingsStore so the
@@ -36,40 +33,6 @@
 export type ClientOptions = {
   transport: TransportType;
   webrtcOptions?: { inputDeviceId?: string; outputDeviceId?: string };
-  /**
-   * Managed Soniox only. The lease is acquired by MainPanel BEFORE any client
-   * exists (an awaited round trip with a 409 retry), so the keys arrive here
~ 29 more removed lines sha256:93c0886e41c1
-    announcesSessionOutcome?: boolean;
-  };
   /**
    * The sentence segmentation stage, shared by both legs and every provider.
    *
@@ -176,76 +139,6 @@
   | { phase: 'loading-native-asr' }
   | { phase: 'preparing-voice' };
 
-/** Provider-neutral view of a metered session budget. The soniox descriptor
- *  adapts its SonioxBudgetSnapshot behind this; nothing provider-shaped
- *  crosses the seam. */
~ 65 more removed lines sha256:abf31ea9d5a8
-}
-
 /**
  * The deep module for one provider. Everything the app needs to know about a
  * provider is answered here; callers dispatch via
@@ -323,10 +216,9 @@
    * indifferent to an `auto` source, because nothing has to be swapped.
    * Base: false — most providers carry direction in the system instruction.
    *
-   * The one here is not:
-   * - **Soniox** reverses `sourceLanguage`/`targetLanguage` directly.
-   *
-   * For it, an `auto` source would reverse into the literal `auto` as the
+   * No descriptor left overrides it (Stage 2 deletion, ruling 2). One that
+   * reversed `sourceLanguage`/`targetLanguage` directly, as Soniox's did,
+   * would reverse an `auto` source into the literal `auto` as the
    * participant's translate target, which is not a language. Callers require a
    * concrete source language whenever a participant channel is in scope; see
    * `computeStartGate`'s `autoSourceParticipantBlocked`.
@@ -341,23 +233,6 @@
    * logs); once ports.signal fires the result is discarded silently.
    */
   prepareToStart?(slice: unknown, ports: PreparePorts): Promise<PrepareOutcome>;
-
-  /**
-   * Acquire session-scoped resources (a lease, metered credentials) before
~ 12 more removed lines sha256:2c6ea16d6592
-   */
-  acquireSessionResources?(ctx: AcquireSessionResourcesContext): Promise<SessionResources | null>;
 }
 
 /** Shared defaults. Subclasses override only what differs from the common case
`````

`src/services/providers/descriptorRegistry.test.ts`

`````diff t06
diff --git a/src/services/providers/descriptorRegistry.test.ts b/src/services/providers/descriptorRegistry.test.ts
--- a/src/services/providers/descriptorRegistry.test.ts
+++ b/src/services/providers/descriptorRegistry.test.ts
@@ -5,9 +5,6 @@
 vi.mock('../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
-  // Explicit: each managed provider is gated on its own now, and this mock's
-  // promise is that EVERY provider gate is forced on.
-  isKizunaSonioxEnabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
@@ -24,10 +21,6 @@
 import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
 import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
 import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
-import { defaultKizunaSonioxSettings } from './KizunaAISonioxProviderConfig';
-import { defaultSonioxSettings } from './SonioxProviderConfig';
-import { ManagedSonioxSession } from '../clients/ManagedSonioxSession';
-import type { ClientOptions } from './ProviderDescriptor';
 import en from '../../locales/en/translation.json';
 
 // Map each provider's settingsSliceKey to its per-module default settings slice,
@@ -39,14 +32,12 @@
   palabraai: defaultPalabraAISettings,
   localInference: defaultLocalInferenceSettings,
   localNative: defaultLocalNativeSettings,
-  kizunaSoniox: defaultKizunaSonioxSettings,
-  soniox: defaultSonioxSettings,
 };
 
 describe('provider registry descriptors', () => {
   it('returns a descriptor for every available provider', () => {
     const ids = ProviderConfigFactory.getAvailableProviders();
-    expect(ids.length).toBe(8);
+    expect(ids.length).toBe(6);
     for (const id of ids) {
       const d = ProviderConfigFactory.getDescriptor(id);
       expect(d.getConfig().id).toBe(id);
@@ -64,46 +55,13 @@
 describe('descriptor.createClient', () => {
   const creds = { ok: true as const, primary: 'k', secret: 's', endpoint: 'https://e.example' };
   const ws = { transport: 'websocket' as const };
-  // The managed Soniox twin is the one descriptor whose client cannot be built
-  // from credentials alone: its keys come from a ManagedSonioxSession acquired
-  // before any client exists. Supplied unacquired here — createClient only
~ 11 more removed lines sha256:eb3d47aea36d
-  };
-  const optionsFor = (id: unknown) => (id === Provider.KIZUNA_AI_SONIOX ? { ...ws, sonioxManaged } : ws);
 
   it('constructs a client for every available provider', () => {
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
-      const client = ProviderConfigFactory.getDescriptor(id).createClient(creds, optionsFor(id));
-      expect(client.getProvider()).toBe(id === Provider.KIZUNA_AI_SONIOX ? Provider.SONIOX
-        : id === Provider.OPENAI_COMPATIBLE ? Provider.OPENAI
-        : id);
+      const client = ProviderConfigFactory.getDescriptor(id).createClient(creds, ws);
+      expect(client.getProvider()).toBe(id === Provider.OPENAI_COMPATIBLE ? Provider.OPENAI : id);
     }
   });
-
-  it('kizuna soniox twin routes to a managed-mode SonioxClient built from the session', async () => {
-    const { SonioxClient } = await import('../clients/SonioxClient');
~ 10 more removed lines sha256:cd3a224ac7d5
-    ).toThrow(/ManagedSonioxSession/);
-  });
 });
 
 describe('descriptor.validateAndFetchModels', () => {
@@ -115,14 +73,6 @@
     expect(r.models).toEqual([]);
   });
 
-  it('kizuna soniox twin validates statically from a non-empty token', async () => {
-    const d = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX);
-    const ok = await d.validateAndFetchModels({ ok: true, primary: 'sess_TOKEN' });
-    expect(ok.validation.valid).toBe(true);
-    expect(ok.models[0].id).toBe('stt-rt-v5');
-    const bad = await d.validateAndFetchModels({ ok: false, missing: 'Sign in is required for Kizuna providers' });
-    expect(bad.validation.valid).toBe(false);
-  });
 });
 
 describe('descriptor.extractCredentials', () => {
@@ -144,14 +94,6 @@
     expect(r).toEqual({ ok: false, missing: 'Both Client ID and Client Secret are required for Palabra AI' });
   });
 
-  it('kizuna soniox twin resolves the auth token from ctx', async () => {
-    const d = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX);
-    expect(await d.extractCredentials({}, { getAuthToken: async () => 'sess_T' }))
-      .toEqual({ ok: true, primary: 'sess_T' });
-    expect((await d.extractCredentials({}, {})).ok).toBe(false);
-    expect((await d.extractCredentials({}, { getAuthToken: async () => null })).ok).toBe(false);
-  });
-
   it('local inference needs no credentials', async () => {
     expect(await ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE).extractCredentials({}, {}))
       .toEqual({ ok: true, primary: '' });
@@ -166,7 +108,6 @@
       palabraai: 'palabraai',
       local_inference: 'local_inference',
       local_native: 'local_native',
-      soniox: 'soniox', kizunaai_soniox: 'soniox',
     };
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
       const d = ProviderConfigFactory.getDescriptor(id);
@@ -221,8 +162,6 @@
     // Registered only under Electron with its gate on — both forced on by
     // this file's environment mock.
     [Provider.LOCAL_NATIVE]: 'localNative',
-    [Provider.KIZUNA_AI_SONIOX]: 'kizunaSoniox',
-    [Provider.SONIOX]: 'soniox',
   };
 
   it('settingsSliceKey matches the exact expected value per provider', () => {
@@ -241,8 +180,6 @@
     [Provider.PALABRA_AI]: false,
     [Provider.LOCAL_INFERENCE]: false,
     [Provider.LOCAL_NATIVE]: false,
-    [Provider.KIZUNA_AI_SONIOX]: false,
-    [Provider.SONIOX]: false,
   };
 
   it('supportsWebRTC matches the exact expected value per provider', () => {
@@ -278,8 +215,6 @@
     [Provider.LOCAL_INFERENCE]: ['Push-to-Talk', 'Push-to-Translate'],
     [Provider.LOCAL_NATIVE]: ['Push-to-Talk', 'Push-to-Translate'],
     [Provider.OPENAI_TRANSLATE]: undefined,
-    [Provider.SONIOX]: undefined,
-    [Provider.KIZUNA_AI_SONIOX]: undefined,
     [Provider.PALABRA_AI]: undefined,
   };
 
@@ -289,8 +224,6 @@
     [Provider.LOCAL_INFERENCE]: true,
     [Provider.LOCAL_NATIVE]: true,
     [Provider.OPENAI_TRANSLATE]: undefined,
-    [Provider.SONIOX]: undefined,
-    [Provider.KIZUNA_AI_SONIOX]: undefined,
     [Provider.PALABRA_AI]: undefined,
   };
 
@@ -303,8 +236,6 @@
     [Provider.OPENAI]: undefined,
     [Provider.OPENAI_COMPATIBLE]: undefined,
     [Provider.OPENAI_TRANSLATE]: undefined,
-    [Provider.SONIOX]: undefined,
-    [Provider.KIZUNA_AI_SONIOX]: undefined,
     [Provider.PALABRA_AI]: undefined,
   };
 
@@ -323,13 +254,8 @@
     [Provider.LOCAL_NATIVE]: { pause: false, auto: true, sizes: true },
 
     // A server decides the outer boundary, and phase 2 can cut inside it.
-    // Soniox DOES attach audio to an item — its `formatted.audio` — and the
-    // ruling is that it stays on the FIRST piece: it is the whole segment's
-    // audio, there is no per-sentence timing to cut it on, and the first
-    // bubble is where a user reaches for the replay button. Palabra writes
-    // text only. Auto stays what it always was — keep the server's segment.
-    [Provider.SONIOX]: { pause: false, auto: true, sizes: true },
-    [Provider.KIZUNA_AI_SONIOX]: { pause: false, auto: true, sizes: true }, // twin spread
+    // Palabra writes text only. Auto stays what it always was — keep the
+    // server's segment.
     [Provider.PALABRA_AI]: { pause: false, auto: true, sizes: true },
 
     // Also the default, and it stays there: the GA client attaches audio to
@@ -352,8 +278,6 @@
     [Provider.OPENAI_COMPATIBLE]: true, // inherited via ...base
     [Provider.OPENAI_TRANSLATE]: false,
     [Provider.PALABRA_AI]: false,
-    [Provider.SONIOX]: false,
-    [Provider.KIZUNA_AI_SONIOX]: false,
     [Provider.LOCAL_INFERENCE]: false,
     [Provider.LOCAL_NATIVE]: false,
   };
@@ -481,19 +405,10 @@
   // the single exported constant: change it, and any client still on a
   // literal 3 fails here.
   it('a client built with no size runs on the one chunk default', () => {
-    // The managed Soniox twin is the one descriptor that cannot be built from
-    // credentials alone; same fixture as `descriptor.createClient` above.
-    const sonioxManaged: ClientOptions['sonioxManaged'] = {
-      credentials: { stt: 'stt-k', tts: 'tts-k', clientReferenceId: 'sokuji1:acct:lease:mix_stt', region: 'us' },
-      session: new ManagedSonioxSession({ sessionToken: 'sess_TOKEN' }),
-      role: 'mix_stt',
-    };
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
       const client = ProviderConfigFactory.getDescriptor(id).createClient(
         { ok: true, primary: 'k', secret: 's', endpoint: 'https://e.example' },
-        id === Provider.KIZUNA_AI_SONIOX
-          ? { transport: 'websocket', sonioxManaged }
-          : { transport: 'websocket' },
+        { transport: 'websocket' },
       );
       expect((client as any).sentencesPerChunk, `chunk default for ${id}`)
         .toBe(DEFAULT_CHUNK_SENTENCES);
@@ -616,14 +531,8 @@
 describe('S3 reversesDirectionViaSourceLanguage', () => {
   const TRANSLATE = 'gemini-3.5-live-translate-preview';
 
-  it('true for Soniox and its managed twin regardless of model', () => {
-    expect(ProviderConfigFactory.getDescriptor(Provider.SONIOX).reversesDirectionViaSourceLanguage(undefined)).toBe(true);
-    expect(ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX).reversesDirectionViaSourceLanguage(undefined)).toBe(true);
-  });
-
-  it('false for every other descriptor, any model', () => {
+  it('false for every descriptor, any model', () => {
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
-      if ([Provider.SONIOX, Provider.KIZUNA_AI_SONIOX].includes(id)) continue;
       const d = ProviderConfigFactory.getDescriptor(id);
       expect(d.reversesDirectionViaSourceLanguage(TRANSLATE), `${id}`).toBe(false);
       expect(d.reversesDirectionViaSourceLanguage(undefined), `${id}`).toBe(false);
@@ -632,9 +541,8 @@
 });
 
 describe('S3 planBothMode', () => {
-  it('is inert for every non-Soniox descriptor in every mode', () => {
+  it('is inert for every descriptor in every mode', () => {
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
-      if (id === Provider.SONIOX || id === Provider.KIZUNA_AI_SONIOX) continue;
       const d = ProviderConfigFactory.getDescriptor(id);
       for (const mode of ['speaker', 'participant', 'both']) {
         expect(d.planBothMode(DEFAULTS_BY_SLICE[d.settingsSliceKey], mode), `${id}/${mode}`)
@@ -642,62 +550,16 @@
       }
     }
   });
-
-  it('the managed twin answers exactly like BYOK Soniox (the 409 twin bug, pinned at this layer)', () => {
-    // Historically a raw `provider === Provider.SONIOX` dispatch was always
~ 23 more removed lines sha256:c87501498d0b
-    expect(d.planBothMode({ bothModeSharedSession: true, sourceLanguage: 'en' }, 'speaker')).toEqual({ shared: false, split: false });
-  });
 });
 
 describe('S4 prepareToStart', () => {
-  it('is declared only where a provider has pre-start work (locals, kizuna-soniox)', () => {
-    const WITH_HOOK = [Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE, Provider.KIZUNA_AI_SONIOX];
+  it('is declared only where a provider has pre-start work (the locals)', () => {
+    const WITH_HOOK = [Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE];
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
       const d = ProviderConfigFactory.getDescriptor(id);
       expect(typeof d.prepareToStart === 'function', `hook presence for ${id}`)
         .toBe(WITH_HOOK.includes(id));
     }
-    // BYOK Soniox is explicitly hookless: the managed voice-prep flow must
-    // never run for a user's own Soniox key.
-    expect(ProviderConfigFactory.getDescriptor(Provider.SONIOX).prepareToStart).toBeUndefined();
~ 13 more removed lines sha256:40c37127949c
-    // session-end to the managed backend.
-    expect(ProviderConfigFactory.getDescriptor(Provider.SONIOX).acquireSessionResources).toBeUndefined();
   });
 });
 
`````

`src/services/providers/participantConfig.test.ts`

`````diff t06
diff --git a/src/services/providers/participantConfig.test.ts b/src/services/providers/participantConfig.test.ts
--- a/src/services/providers/participantConfig.test.ts
+++ b/src/services/providers/participantConfig.test.ts
@@ -3,9 +3,6 @@
 vi.mock('../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
-  // Explicit: each managed provider is gated on its own now, and this mock's
-  // promise is that EVERY provider gate is forced on.
-  isKizunaSonioxEnabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
@@ -19,7 +16,6 @@
 
 import { ProviderConfigFactory } from './ProviderConfigFactory';
 import { Provider } from '../../types/Provider';
-import { defaultSonioxSettings } from './SonioxProviderConfig';
 import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
 import { defaultOpenAISettings } from './OpenAIProviderConfig';
 import { defaultOpenAICompatibleSettings } from './OpenAICompatibleProviderConfig';
@@ -74,20 +70,6 @@
 } as unknown as LocalNativeSessionConfig;
 
 describe('participant config: direction lives in config fields', () => {
-  it('soniox swaps sourceLanguage/targetLanguage (twin inherits)', () => {
-    for (const id of [Provider.SONIOX, Provider.KIZUNA_AI_SONIOX]) {
-      const d = ProviderConfigFactory.getDescriptor(id);
~ 9 more removed lines sha256:1ce05d90b0d0
-  });
-
   it('palabraai swaps sourceLanguage/targetLanguage', () => {
     const d = ProviderConfigFactory.getDescriptor(Provider.PALABRA_AI);
     const slice = { ...defaultPalabraAISettings, sourceLanguage: 'en', targetLanguage: 'es-mx' };
`````

`src/services/providers/prepareToStart.local.test.ts`

`````diff t06
diff --git a/src/services/providers/prepareToStart.local.test.ts b/src/services/providers/prepareToStart.local.test.ts
--- a/src/services/providers/prepareToStart.local.test.ts
+++ b/src/services/providers/prepareToStart.local.test.ts
@@ -3,9 +3,6 @@
 vi.mock('../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
-  // Explicit: each managed provider is gated on its own now, and this mock's
-  // promise is that EVERY provider gate is forced on.
-  isKizunaSonioxEnabled: () => true,
   isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
`````

`src/services/providers/providerOrder.test.ts`

`````diff t06
diff --git a/src/services/providers/providerOrder.test.ts b/src/services/providers/providerOrder.test.ts
--- a/src/services/providers/providerOrder.test.ts
+++ b/src/services/providers/providerOrder.test.ts
@@ -9,7 +9,6 @@
   vi.doMock('../../utils/environment', async (orig) => ({
     ...(await orig<any>()),
     isKizunaAIEnabled: () => true,
-    isKizunaSonioxEnabled: () => true,
     isPalabraAIEnabled: () => true,
     isLocalNativeEnabled: () => true,
     isElectron: () => true,
@@ -32,11 +31,9 @@
     const ids = await allProviders();
 
     expect(ids).toEqual([
-      Provider.KIZUNA_AI_SONIOX,
       Provider.LOCAL_INFERENCE,
       Provider.OPENAI,
       Provider.OPENAI_TRANSLATE,
-      Provider.SONIOX,
       Provider.OPENAI_COMPATIBLE,
       Provider.PALABRA_AI,
       Provider.LOCAL_NATIVE,
@@ -51,7 +48,6 @@
     vi.doMock('../../utils/environment', async (orig) => ({
       ...(await orig<any>()),
       isKizunaAIEnabled: () => false,
-      isKizunaSonioxEnabled: () => false,
       isPalabraAIEnabled: () => false,
       isLocalNativeEnabled: () => false,
       isElectron: () => false,
@@ -64,7 +60,6 @@
       Provider.LOCAL_INFERENCE,
       Provider.OPENAI,
       Provider.OPENAI_TRANSLATE,
-      Provider.SONIOX,
     ]);
   });
 });
`````

`src/stores/settingsStore.sliceRegistry.test.ts`

`````diff t06
diff --git a/src/stores/settingsStore.sliceRegistry.test.ts b/src/stores/settingsStore.sliceRegistry.test.ts
--- a/src/stores/settingsStore.sliceRegistry.test.ts
+++ b/src/stores/settingsStore.sliceRegistry.test.ts
@@ -32,7 +32,6 @@
   ['updateOpenAITranslate', 'openaiTranslate', { apiKey: 'k2' }],
   ['updateLocalInference', 'localInference', { ttsSpeed: 1.5 }],
   ['updateLocalNative', 'localNative', { sourceLanguage: 'ja' }],
-  ['updateSoniox', 'soniox', { apiKey: 's1' }],
 ];
 
 beforeEach(() => {
@@ -80,17 +79,6 @@
     }
   });
 
-  it('the kizuna twin: credentials update in-memory state but are never persisted', async () => {
-    await useSettingsStore.getState().updateKizunaSoniox({ apiKey: 'a', apiKeyEu: 'e', sourceLanguage: 'zh' } as any);
-    // Credentials land in state...
-    expect((useSettingsStore.getState() as any).kizunaSoniox.apiKey).toBe('a');
-    expect((useSettingsStore.getState() as any).kizunaSoniox.apiKeyEu).toBe('e');
-    // ...but are never persisted.
-    expect(setSetting).not.toHaveBeenCalledWith('settings.kizunaSoniox.apiKey', expect.anything());
-    expect(setSetting).not.toHaveBeenCalledWith('settings.kizunaSoniox.apiKeyEu', expect.anything());
-    expect(setSetting).toHaveBeenCalledWith('settings.kizunaSoniox.sourceLanguage', 'zh');
-  });
-
   // The registry used to carry `persistErrors: 'throw' | 'swallow'`, split 6/6,
   // and this pinned each row. What the split actually did in production: none
   // of the six "throw" actions was awaited or caught by any caller — they are
`````

`src/stores/settingsStore.test.ts`

`````diff t06
diff --git a/src/stores/settingsStore.test.ts b/src/stores/settingsStore.test.ts
--- a/src/stores/settingsStore.test.ts
+++ b/src/stores/settingsStore.test.ts
@@ -12,9 +12,6 @@
 vi.mock('../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
-  // Explicit: each managed provider is gated on its own now, and this mock's
-  // promise is that EVERY provider gate is forced on.
-  isKizunaSonioxEnabled: () => true,
   isPalabraAIEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
@@ -745,16 +742,16 @@
   // module-level ServiceFactory mock already in effect for the whole file.
 
   it('merges a patch into the named slice', async () => {
-    await useSettingsStore.getState().updateProviderSlice('soniox', { targetLanguage: 'ja' });
-    expect((useSettingsStore.getState().soniox as { targetLanguage: string }).targetLanguage).toBe('ja');
+    await useSettingsStore.getState().updateProviderSlice('localNative', { targetLanguage: 'ja' });
+    expect(useSettingsStore.getState().localNative.targetLanguage).toBe('ja');
   });
 
   it('does not bleed into other slices or drop unpatched fields', async () => {
-    const nativeBefore = useSettingsStore.getState().localNative;
-    const sourceBefore = (useSettingsStore.getState().soniox as { sourceLanguage: string }).sourceLanguage;
-    await useSettingsStore.getState().updateProviderSlice('soniox', { targetLanguage: 'ko' });
-    expect(useSettingsStore.getState().localNative).toBe(nativeBefore);
-    expect((useSettingsStore.getState().soniox as { sourceLanguage: string }).sourceLanguage).toBe(sourceBefore);
+    const inferenceBefore = useSettingsStore.getState().localInference;
+    const sourceBefore = useSettingsStore.getState().localNative.sourceLanguage;
+    await useSettingsStore.getState().updateProviderSlice('localNative', { targetLanguage: 'ko' });
+    expect(useSettingsStore.getState().localInference).toBe(inferenceBefore);
+    expect(useSettingsStore.getState().localNative.sourceLanguage).toBe(sourceBefore);
   });
 
   it('applies the same registry transform the named action applies', async () => {
@@ -778,10 +775,10 @@
   });
 
   it('behaves identically to the named per-provider action', async () => {
-    await useSettingsStore.getState().updateProviderSlice('soniox', { voice: 'Daniel' });
-    const viaGeneric = useSettingsStore.getState().soniox;
-    await useSettingsStore.getState().updateSoniox({ voice: 'Daniel' });
-    expect(useSettingsStore.getState().soniox).toEqual(viaGeneric);
+    await useSettingsStore.getState().updateProviderSlice('localNative', { targetLanguage: 'de' });
+    const viaGeneric = useSettingsStore.getState().localNative;
+    await useSettingsStore.getState().updateLocalNative({ targetLanguage: 'de' });
+    expect(useSettingsStore.getState().localNative).toEqual(viaGeneric);
   });
 });
 
`````

`src/stores/settingsStore.ts`

`````diff t06
diff --git a/src/stores/settingsStore.ts b/src/stores/settingsStore.ts
--- a/src/stores/settingsStore.ts
+++ b/src/stores/settingsStore.ts
@@ -28,7 +28,7 @@
 import { canEnterSubtitleMode } from '../components/Subtitle/subtitleEnterGate';
 import { currentRunPhase } from '../app/runPhase';
 import {ApiKeyValidationResult} from '../services/interfaces/ISettingsService';
-import {Provider, ProviderType, isKizunaManagedProvider} from '../types/Provider';
+import {Provider, ProviderType} from '../types/Provider';
 import {ClientOperations} from '../services/ClientOperations';
 import i18n from '../locales';
 import {
@@ -50,12 +50,8 @@
 import {
   LocalNativeProviderConfig, LocalNativeSettings, defaultLocalNativeSettings,
 } from '../services/providers/LocalNativeProviderConfig';
-import { defaultKizunaSonioxSettings } from '../services/providers/KizunaAISonioxProviderConfig';
 import { reportError, reportWarning, describeCause } from '../lib/diagnostics/report';
 import { persistSetting } from '../services/persistSetting';
-import {
-  SonioxSettings, defaultSonioxSettings,
-} from '../services/providers/SonioxProviderConfig';
 
 /** Map a native readiness reason to its user-facing message. Verbatim port of
  * the messages the inline LOCAL_NATIVE gate produced. */
@@ -75,7 +71,7 @@
 export type {
   OpenAISettings, OpenAICompatibleSettings, OpenAICompatibleSettingsBase,
   OpenAITranslateSettings, PalabraAISettings,
-  LocalInferenceSettings, LocalNativeSettings, SonioxSettings,
+  LocalInferenceSettings, LocalNativeSettings,
 };
 
 // Union of every provider's settings slice — the return type of
@@ -83,7 +79,7 @@
 export type ProviderSettingsUnion =
   | OpenAISettings | OpenAICompatibleSettings | PalabraAISettings
   | OpenAITranslateSettings
-  | LocalInferenceSettings | LocalNativeSettings | SonioxSettings;
+  | LocalInferenceSettings | LocalNativeSettings;
 
 // ==================== Type Definitions ====================
 
@@ -274,8 +270,6 @@
   openaiCompatible: OpenAICompatibleSettings;
   palabraai: PalabraAISettings;
   openaiTranslate: OpenAITranslateSettings;
-  soniox: SonioxSettings;
-  kizunaSoniox: SonioxSettings;
   localInference: LocalInferenceSettings;
   localNative: LocalNativeSettings;
 
@@ -289,10 +283,6 @@
   availableModels: FilteredModel[];
   loadingModels: boolean;
 
-  // Kizuna AI state
-  isKizunaKeyFetching: boolean;
-  kizunaKeyError: string | null;
-
   // Navigation state
   settingsNavigationTarget: string | null;
   /** Ephemeral: raised by a surface that wants the title-bar account popover
@@ -399,8 +389,6 @@
   updateOpenAICompatible: (settings: Partial<OpenAICompatibleSettings>) => void;
   updatePalabraAI: (settings: Partial<PalabraAISettings>) => void;
   updateOpenAITranslate: (settings: Partial<OpenAITranslateSettings>) => Promise<void>;
-  updateSoniox: (settings: Partial<SonioxSettings>) => void;
-  updateKizunaSoniox: (settings: Partial<SonioxSettings>) => void;
   updateLocalInference: (settings: Partial<LocalInferenceSettings>) => void;
   updateLocalNative: (settings: Partial<LocalNativeSettings>) => void;
   /** Generic slice update keyed by descriptor.settingsSliceKey — the write
@@ -411,13 +399,8 @@
   updateProviderSlice: (sliceKey: string, patch: Record<string, unknown>) => Promise<void>;
 
   // Async actions
-  /** `isSignedIn` is the caller's real auth state, not a guess. It defaults to
-   *  `true` so the token probe stays the authority for callers that don't know
-   *  (nothing but a signed-in caller hands over a `getAuthToken` today); pass
-   *  it explicitly wherever `useAuth()` is in scope. */
-  validateApiKey: (getAuthToken?: () => Promise<string | null>, isSignedIn?: boolean) => Promise<ApiKeyValidationResult>;
-  fetchAvailableModels: (getAuthToken?: () => Promise<string | null>, isSignedIn?: boolean) => Promise<void>;
-  ensureKizunaApiKey: (getToken: () => Promise<string | null>, isSignedIn: boolean) => Promise<boolean>;
+  validateApiKey: (getAuthToken?: () => Promise<string | null>) => Promise<ApiKeyValidationResult>;
+  fetchAvailableModels: (getAuthToken?: () => Promise<string | null>) => Promise<void>;
   loadSettings: () => Promise<void>;
   clearCache: () => void;
 
@@ -435,46 +418,6 @@
 
 // ==================== Helper Functions ====================
 
-/**
- * Redirect a persisted Kizuna-managed provider this build does not offer.
- *
~ 35 more removed lines sha256:3c42ff0ff86d
-}
-
 /** Migrate persisted PalabraAI language codes that the API rejects.
  *  Palabra validates source_language and target_language against two separate
  *  enums, and a code outside them fails the whole set_task — the session connects
@@ -600,8 +543,8 @@
 // ─── Provider settings slice registry ────────────────────────────────────────
 // One row per persisted provider slice. This table is the single home for the
 // knowledge the twelve hand-written update actions used to re-encode: the
-// slice's defaults (for loading), its patch transform, its never-persist
-// keys, and its persistence-error policy. Persist keys are always
+// slice's defaults (for loading), its patch transform, and its
+// persistence-error policy. Persist keys are always
 // `settings.<sliceKey>.<field>` — the sliceKey doubles as the storage prefix.
 
 type SliceUpdateSpec = {
@@ -614,8 +557,6 @@
   defaults: object;
   /** Transform an incoming patch before it is merged AND persisted. */
   transformPatch?: (patch: Record<string, unknown>) => Record<string, unknown>;
-  /** Fields applied to in-memory state but never written to settings storage. */
-  neverPersist?: readonly string[];
 };
 
 // WebRTC transport: the server truncates audio on user speech (API design),
@@ -630,11 +571,6 @@
   openaiCompatible: { defaults: defaultOpenAICompatibleSettings, transformPatch: forceWebrtcTurnDetectionOff },
   palabraai: { defaults: defaultPalabraAISettings },
   openaiTranslate: { defaults: defaultOpenAITranslateSettings },
-  soniox: { defaults: defaultSonioxSettings },
-  // Relay twins authenticate through the relay with a short-lived Better Auth
-  // session token; the user-managed credential fields must never be persisted
-  // (stale/sensitive values). See each descriptor's extractCredentials.
-  kizunaSoniox: { defaults: defaultKizunaSonioxSettings, neverPersist: ['apiKey', 'apiKeyEu', 'apiKeyJp'] },
   localInference: { defaults: defaultLocalInferenceSettings },
   localNative: { defaults: defaultLocalNativeSettings },
 } satisfies Record<string, SliceUpdateSpec>;
@@ -661,7 +597,6 @@
   // user, and which slice got which was arbitrary. `persistSetting` reports
   // the failure once per key instead.
   for (const [key, value] of Object.entries(effective)) {
-    if (spec.neverPersist?.includes(key)) continue;
     await persistSetting(`settings.${sliceKey}.${key}`, value);
   }
 }
@@ -674,8 +609,6 @@
     openaiCompatible: defaultOpenAICompatibleSettings,
     palabraai: defaultPalabraAISettings,
     openaiTranslate: defaultOpenAITranslateSettings,
-    soniox: defaultSonioxSettings,
-    kizunaSoniox: defaultKizunaSonioxSettings,
     localInference: defaultLocalInferenceSettings,
     localNative: defaultLocalNativeSettings,
 
@@ -687,9 +620,6 @@
     availableModels: [],
     loadingModels: false,
 
-    isKizunaKeyFetching: false,
-    kizunaKeyError: null,
-
     settingsNavigationTarget: null,
     engineSlotTarget: null,
     accountPopoverRequested: false,
@@ -935,8 +865,6 @@
     updateOpenAICompatible: (settings) => updateProviderSlice(set, 'openaiCompatible', settings),
     updatePalabraAI: (settings) => updateProviderSlice(set, 'palabraai', settings),
     updateOpenAITranslate: (settings) => updateProviderSlice(set, 'openaiTranslate', settings),
-    updateSoniox: (settings) => updateProviderSlice(set, 'soniox', settings),
-    updateKizunaSoniox: (settings) => updateProviderSlice(set, 'kizunaSoniox', settings),
     updateLocalInference: (settings) => updateProviderSlice(set, 'localInference', settings),
     updateLocalNative: (settings) => updateProviderSlice(set, 'localNative', settings),
     updateProviderSlice: (sliceKey, patch) => {
@@ -955,7 +883,6 @@
     // added this line for the before/after numbers.
     validateApiKey: async (
       getAuthToken?: () => Promise<string | null>,
-      isSignedIn: boolean = true,
     ): Promise<ApiKeyValidationResult> => {
       const state = get();
       const provider = state.provider;
@@ -1024,50 +951,6 @@
         return { valid: ready, message, validating: false };
       }
 
-      // For KizunaAI, ensure we have an API key first
-      if (isKizunaManagedProvider(provider)) {
-        // Was hardcoded `true`, which made ensureKizunaApiKey's own signed-out
~ 39 more removed lines sha256:3dc337c50527
-      }
-
       // Get normalized credentials from the provider's descriptor — replaces
       // the four hand-copied per-provider extraction chains that used to live
       // here (see git history for the pre-descriptor shape).
@@ -1172,64 +1055,12 @@
       }
     },
 
-    fetchAvailableModels: async (getAuthToken, isSignedIn) => {
+    fetchAvailableModels: async (getAuthToken) => {
       set({loadingModels: true});
-      // Forwarded, not defaulted. validateApiKey's optimistic default exists
-      // for the callers that pass no token at all; a caller that DOES pass one
-      // knows the auth state and has to say so, or a signed-out user's null
-      // token is misread as an expired session.
-      await get().validateApiKey(getAuthToken, isSignedIn);
+      await get().validateApiKey(getAuthToken);
       set({loadingModels: false});
     },
 
-    ensureKizunaApiKey: async (getToken, isSignedIn) => {
-      const state = get();
-
~ 43 more removed lines sha256:8deac7842e62
-    },
-
     loadSettings: async () => {
       try {
         const service = ServiceFactory.getSettingsService();
@@ -1242,10 +1073,7 @@
         useLogStore.getState().setEnabled(diagnosticLogs);
 
         // Load common settings
-        const persistedProvider = await service.getSetting('settings.common.provider', defaultCommonSettings.provider);
-        // Migrate legacy realtime 'kizunaai' to the relay-managed Translate twin
-        // before validation, so stranded users land on a supported provider.
-        const provider = migrateLegacyKizunaProvider(persistedProvider);
+        const provider = await service.getSetting('settings.common.provider', defaultCommonSettings.provider);
         const uiLanguage = await service.getSetting('settings.common.uiLanguage', defaultCommonSettings.uiLanguage);
         const uiMode = await service.getSetting('settings.common.uiMode', defaultCommonSettings.uiMode);
         const systemInstructions = await service.getSetting('settings.common.systemInstructions', defaultCommonSettings.systemInstructions);
@@ -1488,8 +1316,6 @@
 export const useOpenAICompatibleSettings = () => useSettingsStore((state) => state.openaiCompatible);
 export const usePalabraAISettings = () => useSettingsStore((state) => state.palabraai);
 export const useOpenAITranslateSettings = () => useSettingsStore((state) => state.openaiTranslate);
-export const useSonioxSettings = () => useSettingsStore((state) => state.soniox);
-export const useKizunaSonioxSettings = () => useSettingsStore((state) => state.kizunaSoniox);
 export const useLocalInferenceSettings = () => useSettingsStore((state) => state.localInference);
 export const useLocalNativeSettings = () => useSettingsStore((state) => state.localNative);
 
@@ -1512,10 +1338,6 @@
 export const useAvailableModels = () => useSettingsStore((state) => state.availableModels);
 export const useLoadingModels = () => useSettingsStore((state) => state.loadingModels);
 
-// Kizuna state
-export const useIsKizunaKeyFetching = () => useSettingsStore((state) => state.isKizunaKeyFetching);
-export const useKizunaKeyError = () => useSettingsStore((state) => state.kizunaKeyError);
-
 // Navigation
 export const useSettingsNavigationTarget = () => useSettingsStore((state) => state.settingsNavigationTarget);
 export const useEngineSlotTarget = () => useSettingsStore((state: SettingsStore) => state.engineSlotTarget);
@@ -1567,14 +1389,11 @@
 export const useUpdateOpenAICompatible = () => useSettingsStore((state) => state.updateOpenAICompatible);
 export const useUpdatePalabraAI = () => useSettingsStore((state) => state.updatePalabraAI);
 export const useUpdateOpenAITranslate = () => useSettingsStore((state) => state.updateOpenAITranslate);
-export const useUpdateSoniox = () => useSettingsStore((state) => state.updateSoniox);
-export const useUpdateKizunaSoniox = () => useSettingsStore((state) => state.updateKizunaSoniox);
 export const useUpdateLocalInference = () => useSettingsStore((state) => state.updateLocalInference);
 export const useUpdateLocalNative = () => useSettingsStore((state) => state.updateLocalNative);
 
 export const useValidateApiKey = () => useSettingsStore((state) => state.validateApiKey);
 export const useFetchAvailableModels = () => useSettingsStore((state) => state.fetchAvailableModels);
-export const useEnsureKizunaApiKey = () => useSettingsStore((state) => state.ensureKizunaApiKey);
 export const useLoadSettings = () => useSettingsStore((state) => state.loadSettings);
 export const useClearCache = () => useSettingsStore((state) => state.clearCache);
 
`````

`src/utils/environment.ts`

`````diff t06
diff --git a/src/utils/environment.ts b/src/utils/environment.ts
--- a/src/utils/environment.ts
+++ b/src/utils/environment.ts
@@ -178,35 +178,6 @@
   return import.meta.env.VITE_ENABLE_KIZUNA_AI === 'true';
 }
 
-/**
- * Whether each Kizuna-managed provider should be offered.
- *
~ 24 more removed lines sha256:56bb55af6002
-}
-
 /**
  * Check if Palabra AI features should be enabled
  * @returns true if Palabra AI features should be shown
`````

---

### Task 7: OpenAI Realtime, OpenAI Translate and OpenAI Compatible — the merged deletion, with `openai-realtime-api` and `evals/` (Wave 2)

OpenAI Realtime (25 of 25) and OpenAI Translate run on their own definitions over WebSocket; their WebRTC transport was abandoned (the owner, 2026-09-29), and OpenAI Compatible was retired, not ported. The roadmap's merged inventory (`:5259-5279`, OpenAI Translate's T3 with it) is taken whole, and the owner's ruling 4 adds `evals/`, the fork's last user.

**What goes, and what changes:**
- **The clients and descriptors:** `OpenAIClient.ts`, `OpenAIGAClient.ts`, `OpenAIWebRTCClient.ts`, `OpenAITranslateGAClient.ts`, `OpenAITranslateWebRTCClient.ts`, `openAIRealtimeSession.ts` (each with its test), `OpenAIProviderConfig.ts`, `OpenAITranslateProviderConfig.ts`, `OpenAICompatibleProviderConfig.ts`, `openaiTranscriptionContext.ts` (and test), `EphemeralTokenService.ts` (and test), `src/utils/textUtils.ts`, `openaiModelMigration.test.ts`.
- **The shared old code:** `IClient.ts`' OpenAI and Translate configs, their guards and the WebRTC-only optional members; `ProviderConfig.ts`' note; `ProviderConfigFactory.ts`' three registrations; `ProviderDescriptor.ts`' base participant turn-detection override, OpenAI-shaped, whose last reader goes (choice 5); `settingsStore.ts`' `openai`, `openaiCompatible` and `openaiTranslate` slices, `transformPatch`, the Translate key prefill, the model migrations and auto-select, `useTransportType` and the `TransportType` re-export; `Provider.OPENAI_COMPATIBLE` (ruling C1: the three wizard cases keep `'openai_compatible'` as a cast string).
- **`openai-realtime-api` and `evals/`** (ruling 4): `evals/` (28 files); the `eval`, `eval:validate`, `eval:list` scripts; `ajv` and `ajv-formats` (choice 8); the fork in both `package.json`s; `.gitignore`'s `evals/` lines; the lockfile hunks.
- `redact.ts`' `sokuji-auth.` rule stays as a net (choice 6), its comment and test's say so; `logStore.ts`' beta event names; the "deleted since" headers in `src/providers/{openai,openai_translate}/` (choice 3).
- The old test tables' rows for the three (`descriptorRegistry`, `participantConfig`, `providerOrder`, the `settingsStore` tests).
- Seven keys: `settings.apiKeyValidationCompleted`, `settings.realtimeModelAvailable`, `settings.translateModelAvailable`, `setup.credentials.endpoint`, `setup.credentials.endpointPlaceholder`, `providers.openaiCompatible.name`, `providers.openaiCompatible.description` (research note 7). `settings.userTranscriptModel`, `settings.transcriptModelTooltip` and `settings.{low,medium,high}` stay: `src/providers/openai/` reads them.

**Files:**
- Delete (49): `evals/` (28 files), `src/services/EphemeralTokenService.test.ts`, `src/services/EphemeralTokenService.ts`, `src/services/clients/OpenAIClient.test.ts`, `src/services/clients/OpenAIClient.ts`, `src/services/clients/OpenAIGAClient.test.ts`, `src/services/clients/OpenAIGAClient.ts`, `src/services/clients/OpenAITranslateGAClient.test.ts`, `src/services/clients/OpenAITranslateGAClient.ts`, `src/services/clients/OpenAITranslateWebRTCClient.test.ts`, `src/services/clients/OpenAITranslateWebRTCClient.ts`, `src/services/clients/OpenAIWebRTCClient.test.ts`, `src/services/clients/OpenAIWebRTCClient.ts`, `src/services/clients/openAIRealtimeSession.test.ts`, `src/services/clients/openAIRealtimeSession.ts`, `src/services/providers/OpenAICompatibleProviderConfig.ts`, `src/services/providers/OpenAIProviderConfig.ts`, `src/services/providers/OpenAITranslateProviderConfig.ts`, `src/services/providers/openaiTranscriptionContext.test.ts`, `src/services/providers/openaiTranscriptionContext.ts`, `src/stores/openaiModelMigration.test.ts`, `src/utils/textUtils.ts`
- Modify (28, by the blocks below): `.gitignore`, `extension/package-lock.json`, `extension/package.json`, `package-lock.json`, `package.json`, `src/components/SetupWizard/providerPaths.test.ts`, `src/components/SetupWizard/useApplySetup.test.ts`, `src/lib/diagnostics/redact.test.ts`, `src/lib/diagnostics/redact.ts`, `src/lib/setup/providerPath.test.ts`, `src/providers/openai/adapter.ts`, `src/providers/openai/transcription.ts`, `src/providers/openai/wire.oracle.test.ts`, `src/providers/openai/wire.ts`, `src/providers/openai_translate/adapter.ts`, `src/services/interfaces/IClient.ts`, `src/services/providers/ProviderConfig.ts`, `src/services/providers/ProviderConfigFactory.ts`, `src/services/providers/ProviderDescriptor.ts`, `src/services/providers/descriptorRegistry.test.ts`, `src/services/providers/participantConfig.test.ts`, `src/services/providers/providerOrder.test.ts`, `src/stores/logStore.ts`, `src/stores/settingsStore.providerSettings.test.tsx`, `src/stores/settingsStore.sliceRegistry.test.ts`, `src/stores/settingsStore.test.ts`, `src/stores/settingsStore.ts`, `src/types/Provider.ts`
- The 30 locale catalogs `src/locales/*/translation.json`, by the key tool (7 keys)

**Interfaces:**
- Consumes: Task 2 (OpenAI Live's client imported these modules), Task 3 (the relay twin extended the Translate descriptor).
- Produces: `SessionConfig = PalabraAISessionConfig | LocalInferenceSessionConfig | LocalNativeSessionConfig`; no `openai-realtime-api` anywhere; the `Provider` enum without `OPENAI_COMPATIBLE`.

- [ ] **Step 1: Delete the files.**

  ```
  git rm -q -r -- evals src/services/EphemeralTokenService.test.ts src/services/EphemeralTokenService.ts src/services/clients/OpenAIClient.test.ts src/services/clients/OpenAIClient.ts src/services/clients/OpenAIGAClient.test.ts src/services/clients/OpenAIGAClient.ts src/services/clients/OpenAITranslateGAClient.test.ts src/services/clients/OpenAITranslateGAClient.ts src/services/clients/OpenAITranslateWebRTCClient.test.ts src/services/clients/OpenAITranslateWebRTCClient.ts src/services/clients/OpenAIWebRTCClient.test.ts src/services/clients/OpenAIWebRTCClient.ts src/services/clients/openAIRealtimeSession.test.ts src/services/clients/openAIRealtimeSession.ts src/services/providers/OpenAICompatibleProviderConfig.ts src/services/providers/OpenAIProviderConfig.ts src/services/providers/OpenAITranslateProviderConfig.ts src/services/providers/openaiTranscriptionContext.test.ts src/services/providers/openaiTranscriptionContext.ts src/stores/openaiModelMigration.test.ts src/utils/textUtils.ts
  ```

- [ ] **Step 2: Apply the task's diff blocks** (Global Constraints: never by hand).

  ```
  python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/plan-apply.py docs/superpowers/plans/2026-09-30-client-contract-stage2-deletion.md t07
  ```

  Expected: `t07: 28 files changed`, and no other line.

- [ ] **Step 3: Remove the locale keys only the deleted code read.**

  ```
  node /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/drop-locale-keys.mjs . providers.openaiCompatible.description providers.openaiCompatible.name settings.apiKeyValidationCompleted settings.realtimeModelAvailable settings.translateModelAvailable setup.credentials.endpoint setup.credentials.endpointPlaceholder
  ```

  Expected: `7 keys removed from 30 catalogs`.

- [ ] **Step 4: Check that nothing reaches what went.**

  ```
  git grep -nE "from '[^']*/(OpenAIClient|OpenAIGAClient|OpenAIWebRTCClient|OpenAITranslateGAClient|OpenAITranslateWebRTCClient|openAIRealtimeSession|OpenAIProviderConfig|OpenAITranslateProviderConfig|OpenAICompatibleProviderConfig|openaiTranscriptionContext|EphemeralTokenService|textUtils)'|openai-realtime-api|OPENAI_COMPATIBLE|npm run eval|evals/" -- src extension electron package.json extension/package.json .gitignore
  ```

  Expected: nothing (exit status 1).

- [ ] **Step 5: Run the gates.** Each command as its own call; every expected number is the replay's.

  - `npx vitest run src`: **541 files passed and 1 skipped (542); 6 783 tests passed and 2 skipped (6 785)**; 0 failed, no unhandled errors.
  - `npx vitest run electron`: 34 files, 477 tests passed. `npx vitest run extension`: 9 files, 56 tests passed.
  - Local Native's old path: `npx vitest run src/services src/lib/local-inference/native src/components/Settings/sections/Native src/components/Settings/engine/useNativeEngineAdapter src/stores/nativeModelStore src/stores/settingsStore` — 45 files, 710 tests passed.
  - The typecheck, as a set: `npx tsc --noEmit -p tsconfig.json > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t07.txt`, then `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t06.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t07.txt` prints exactly `before 104 after 103; new 0; gone 1` and exits 0 — no error the task before did not have; `after 103` is the full tree's count.
  - `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh | diff - /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` prints nothing: the baseline's 18 lines, unchanged.

- [ ] **Step 6: Commit.**

```bash
git add -- .gitignore extension/package-lock.json extension/package.json package-lock.json package.json src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/useApplySetup.test.ts src/lib/diagnostics/redact.test.ts src/lib/diagnostics/redact.ts src/lib/setup/providerPath.test.ts src/providers/openai/adapter.ts src/providers/openai/transcription.ts src/providers/openai/wire.oracle.test.ts src/providers/openai/wire.ts src/providers/openai_translate/adapter.ts src/services/interfaces/IClient.ts src/services/providers/ProviderConfig.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/ProviderDescriptor.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/participantConfig.test.ts src/services/providers/providerOrder.test.ts src/stores/logStore.ts src/stores/settingsStore.providerSettings.test.tsx src/stores/settingsStore.sliceRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts src/types/Provider.ts 'src/locales/*/translation.json'
```

```bash
git commit -q -F - -- evals src/services/EphemeralTokenService.test.ts src/services/EphemeralTokenService.ts src/services/clients/OpenAIClient.test.ts src/services/clients/OpenAIClient.ts src/services/clients/OpenAIGAClient.test.ts src/services/clients/OpenAIGAClient.ts src/services/clients/OpenAITranslateGAClient.test.ts src/services/clients/OpenAITranslateGAClient.ts src/services/clients/OpenAITranslateWebRTCClient.test.ts src/services/clients/OpenAITranslateWebRTCClient.ts src/services/clients/OpenAIWebRTCClient.test.ts src/services/clients/OpenAIWebRTCClient.ts src/services/clients/openAIRealtimeSession.test.ts src/services/clients/openAIRealtimeSession.ts src/services/providers/OpenAICompatibleProviderConfig.ts src/services/providers/OpenAIProviderConfig.ts src/services/providers/OpenAITranslateProviderConfig.ts src/services/providers/openaiTranscriptionContext.test.ts src/services/providers/openaiTranscriptionContext.ts src/stores/openaiModelMigration.test.ts src/utils/textUtils.ts .gitignore extension/package-lock.json extension/package.json package-lock.json package.json src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/useApplySetup.test.ts src/lib/diagnostics/redact.test.ts src/lib/diagnostics/redact.ts src/lib/setup/providerPath.test.ts src/providers/openai/adapter.ts src/providers/openai/transcription.ts src/providers/openai/wire.oracle.test.ts src/providers/openai/wire.ts src/providers/openai_translate/adapter.ts src/services/interfaces/IClient.ts src/services/providers/ProviderConfig.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/ProviderDescriptor.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/participantConfig.test.ts src/services/providers/providerOrder.test.ts src/stores/logStore.ts src/stores/settingsStore.providerSettings.test.tsx src/stores/settingsStore.sliceRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts src/types/Provider.ts 'src/locales/*/translation.json' <<'EOF'
refactor(openai): delete the old OpenAI Realtime, Translate and Compatible code

Both OpenAI providers run on their own definitions over WebSocket;
their WebRTC transport was abandoned and OpenAI Compatible retired.
Delete the WebSocket and WebRTC clients, the session builder, the
ephemeral-token service, the descriptors, slices and migrations, the
Compatible enum id, the openai-realtime-api fork, and evals/ with its
scripts and its own dependencies. The sokuji-auth redaction rule stays
as a net.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

**The blocks** (`t07`, one per file, in the order the applier takes them):

`.gitignore`

`````diff t07
diff --git a/.gitignore b/.gitignore
--- a/.gitignore
+++ b/.gitignore
@@ -6,10 +6,6 @@
 # testing
 /coverage
 
-# Evaluation results and audio files (not version controlled)
-evals/results/
-evals/audio/
-
 # production
 /build
 /dist
`````

`extension/package-lock.json`

`````diff t07
diff --git a/extension/package-lock.json b/extension/package-lock.json
--- a/extension/package-lock.json
+++ b/extension/package-lock.json
@@ -9,7 +9,6 @@
       "version": "0.41.1",
       "dependencies": {
         "openai": "^6.29.0",
-        "openai-realtime-api": "1.0.8",
         "posthog-js-lite": "^4.1.0"
       },
       "devDependencies": {
@@ -2935,24 +2934,6 @@
       "dev": true,
       "license": "MIT"
     },
-    "node_modules/nanoid": {
-      "version": "5.1.11",
-      "resolved": "https://registry.npmjs.org/nanoid/-/nanoid-5.1.11.tgz",
~ 13 more removed lines sha256:88e621eacbf7
-      }
-    },
     "node_modules/natural-compare": {
       "version": "1.4.0",
       "resolved": "https://registry.npmjs.org/natural-compare/-/natural-compare-1.4.0.tgz",
@@ -3128,19 +3109,6 @@
         }
       }
     },
-    "node_modules/openai-realtime-api": {
-      "version": "1.0.8",
-      "resolved": "https://registry.npmjs.org/openai-realtime-api/-/openai-realtime-api-1.0.8.tgz",
~ 8 more removed lines sha256:7f1750c7ec58
-      }
-    },
     "node_modules/optionator": {
       "version": "0.9.4",
       "resolved": "https://registry.npmjs.org/optionator/-/optionator-0.9.4.tgz",
@@ -4408,6 +4376,8 @@
       "resolved": "https://registry.npmjs.org/ws/-/ws-8.21.0.tgz",
       "integrity": "sha512-Vsp28b7DRcimFQvrqu2Wek3z1iYxDCWqHYB8Qsnk/S4RfaCQzPGPyBNuVjJV3cd6UiKtUtp6sNM77gWvzcCH+g==",
       "license": "MIT",
+      "optional": true,
+      "peer": true,
       "engines": {
         "node": ">=10.0.0"
       },
`````

`extension/package.json`

`````diff t07
diff --git a/extension/package.json b/extension/package.json
--- a/extension/package.json
+++ b/extension/package.json
@@ -10,7 +10,6 @@
   },
   "dependencies": {
     "openai": "^6.29.0",
-    "openai-realtime-api": "1.0.8",
     "posthog-js-lite": "^4.1.0"
   },
   "devDependencies": {
`````

`package-lock.json`

`````diff t07
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -43,8 +43,6 @@
         "@types/react-router-dom": "^5.3.3",
         "@types/ws": "^8.18.1",
         "@vitejs/plugin-react": "^5.1.4",
-        "ajv": "^8.17.1",
-        "ajv-formats": "^3.0.1",
         "better-auth": "^1.6.13",
         "concurrently": "^8.2.2",
         "cross-env": "^7.0.3",
@@ -60,7 +58,6 @@
         "mpg123-decoder": "^1.0.3",
         "onnxruntime-web": "1.26.0-dev.20260416-b7804b056c",
         "openai": "^6.29.0",
-        "openai-realtime-api": "1.0.8",
         "posthog-js-lite": "^4.1.0",
         "protobufjs": "^8.6.5",
         "protobufjs-cli": "^2.6.1",
@@ -4702,24 +4699,6 @@
         "url": "https://github.com/sponsors/epoberezkin"
       }
     },
-    "node_modules/ajv-formats": {
-      "version": "3.0.1",
-      "resolved": "https://registry.npmjs.org/ajv-formats/-/ajv-formats-3.0.1.tgz",
~ 13 more removed lines sha256:88791f7a94b9
-      }
-    },
     "node_modules/ansi-escapes": {
       "version": "4.3.2",
       "resolved": "https://registry.npmjs.org/ansi-escapes/-/ansi-escapes-4.3.2.tgz",
@@ -10314,25 +10293,6 @@
       "license": "MIT",
       "optional": true
     },
-    "node_modules/nanoid": {
-      "version": "5.1.11",
-      "resolved": "https://registry.npmjs.org/nanoid/-/nanoid-5.1.11.tgz",
~ 14 more removed lines sha256:b8713dd831e5
-      }
-    },
     "node_modules/nanostores": {
       "version": "1.3.0",
       "resolved": "https://registry.npmjs.org/nanostores/-/nanostores-1.3.0.tgz",
@@ -10734,20 +10694,6 @@
         }
       }
     },
-    "node_modules/openai-realtime-api": {
-      "version": "1.0.8",
-      "resolved": "https://registry.npmjs.org/openai-realtime-api/-/openai-realtime-api-1.0.8.tgz",
~ 9 more removed lines sha256:2f44ee2927bc
-      }
-    },
     "node_modules/os-tmpdir": {
       "version": "1.0.2",
       "resolved": "https://registry.npmjs.org/os-tmpdir/-/os-tmpdir-1.0.2.tgz",
`````

`package.json`

`````diff t07
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -168,8 +168,6 @@
     "@types/react-router-dom": "^5.3.3",
     "@types/ws": "^8.18.1",
     "@vitejs/plugin-react": "^5.1.4",
-    "ajv": "^8.17.1",
-    "ajv-formats": "^3.0.1",
     "better-auth": "^1.6.13",
     "concurrently": "^8.2.2",
     "cross-env": "^7.0.3",
@@ -185,7 +183,6 @@
     "mpg123-decoder": "^1.0.3",
     "onnxruntime-web": "1.26.0-dev.20260416-b7804b056c",
     "openai": "^6.29.0",
-    "openai-realtime-api": "1.0.8",
     "posthog-js-lite": "^4.1.0",
     "protobufjs": "^8.6.5",
     "protobufjs-cli": "^2.6.1",
@@ -219,9 +216,6 @@
     "make": "npm run build && electron-forge make",
     "make:pkg": "npm run build && electron-builder --mac pkg --publish never -c.directories.output=out/make-mac",
     "postinstall": "electron-rebuild && bash scripts/copy-ort-wasm.sh",
-    "eval": "tsx evals/runner/index.ts",
-    "eval:validate": "tsx evals/runner/index.ts validate",
-    "eval:list": "tsx evals/runner/index.ts list",
     "extension:build": "cd extension && npx vite build",
     "extension:dev": "cd extension && npx vite build --watch --mode development",
     "sidecar:setup": "bash sidecar/setup.sh"
`````

`src/components/SetupWizard/providerPaths.test.ts`

`````diff t07
diff --git a/src/components/SetupWizard/providerPaths.test.ts b/src/components/SetupWizard/providerPaths.test.ts
--- a/src/components/SetupWizard/providerPaths.test.ts
+++ b/src/components/SetupWizard/providerPaths.test.ts
@@ -8,7 +8,7 @@
   isElectron: () => true,
   isExtension: () => false,
 }));
-import { Provider } from '../../types/Provider';
+import { Provider, type ProviderType } from '../../types/Provider';
 import {
   availablePaths, managedProvider, managedOption, ownKeyOptions, offlineOptions, providerFits, offersRecord,
   textOnlyCapabilityOf, wizardProvider,
@@ -51,8 +51,9 @@
     expect(providerFits(Provider.SONIOX, 'subtitle-myself')).toBe(true);
     expect(providerFits(Provider.LOCAL_INFERENCE, 'two-way-voice')).toBe(true);
     expect(providerFits(Provider.KIZUNA_AI_SONIOX, 'subtitle-myself')).toBe(true);
-    // OpenAI Compatible, retired (Stage 2 OpenAI Realtime, ruling 1): no build registers it.
-    expect(providerFits(Provider.OPENAI_COMPATIBLE, 'be-heard')).toBe(false);
+    // OpenAI Compatible, retired (Stage 2 OpenAI Realtime, ruling 1): no build registers it, and its
+    // id is only stored data now (Stage 2 deletion, ruling C1).
+    expect(providerFits('openai_compatible' as ProviderType, 'be-heard')).toBe(false);
   });
 
   describe('offersRecord', () => {
@@ -78,7 +79,7 @@
     });
 
     it('refuses an own-key record for a provider this build does not register', () => {
-      expect(offersRecord({ scenario: 'be-heard', providerPath: 'own-key', provider: Provider.OPENAI_COMPATIBLE })).toBe(false);
+      expect(offersRecord({ scenario: 'be-heard', providerPath: 'own-key', provider: 'openai_compatible' })).toBe(false);
     });
 
     it('refuses a null providerPath or scenario', () => {
`````

`src/components/SetupWizard/useApplySetup.test.ts`

`````diff t07
diff --git a/src/components/SetupWizard/useApplySetup.test.ts b/src/components/SetupWizard/useApplySetup.test.ts
--- a/src/components/SetupWizard/useApplySetup.test.ts
+++ b/src/components/SetupWizard/useApplySetup.test.ts
@@ -24,7 +24,7 @@
   ServiceFactory: { getSettingsService: () => ({ getSetting, setSetting }) },
 }));
 
-import { Provider } from '../../types/Provider';
+import { Provider, type ProviderType } from '../../types/Provider';
 import { readCredentials } from '../../lib/provider/credentials';
 import { volcengineAst2Provider } from '../../providers/volcengine_ast2/provider';
 import { useProviderStore } from '../../stores/providerStore';
@@ -135,8 +135,9 @@
   it('throws before any write when the draft names a provider this build does not offer', async () => {
     const { result } = renderHook(() => useApplySetup());
 
-    // OpenAI Compatible, retired (Stage 2 OpenAI Realtime, ruling 1): no build offers it.
-    await expect(result.current(draft({ provider: Provider.OPENAI_COMPATIBLE }))).rejects.toThrow(/This build does not offer/);
+    // OpenAI Compatible, retired (Stage 2 OpenAI Realtime, ruling 1): no build offers it, and its id is
+    // only stored data now (Stage 2 deletion, ruling C1).
+    await expect(result.current(draft({ provider: 'openai_compatible' as ProviderType }))).rejects.toThrow(/This build does not offer/);
 
     expect(useProviderStore.getState().selected).toBeNull();
     expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
`````

`src/lib/diagnostics/redact.test.ts`

`````diff t07
diff --git a/src/lib/diagnostics/redact.test.ts b/src/lib/diagnostics/redact.test.ts
--- a/src/lib/diagnostics/redact.test.ts
+++ b/src/lib/diagnostics/redact.test.ts
@@ -103,8 +103,8 @@
       .toBe('Authorization: Bearer [REDACTED]');
   });
 
-  // OpenAITranslateGAClient.ts:707 — `sokuji-auth.${this.apiKey}` is the relay
-  // WebSocket subprotocol; the carrier name stays, the token goes.
+  // `sokuji-auth.<token>` was the relay WebSocket subprotocol, kept as a net
+  // (Stage 2 deletion, choice 6); the carrier name stays, the token goes.
   it('redacts the relay auth subprotocol token', () => {
     expect(redact('subprotocols: sokuji-auth.sess_TOKEN_VALUE_1234, json'))
       .toBe('subprotocols: sokuji-auth.[REDACTED], json');
`````

`src/lib/diagnostics/redact.ts`

`````diff t07
diff --git a/src/lib/diagnostics/redact.ts b/src/lib/diagnostics/redact.ts
--- a/src/lib/diagnostics/redact.ts
+++ b/src/lib/diagnostics/redact.ts
@@ -48,8 +48,10 @@
   ],
   // `Authorization: Bearer <token>` on every provider fetch.
   [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, `$1${REDACTED}`],
-  // `sokuji-auth.${this.apiKey}` WebSocket subprotocol — OpenAITranslateGAClient.ts:707
-  // (relay auth).
+  // `sokuji-auth.<session token>` WebSocket subprotocol: the relay twins' auth.
+  // No client sends it since they went (Stage 2 deletion, ruling 2); kept as
+  // a net, since it carried a Better Auth session token and the rule costs
+  // nothing (Stage 2 deletion, choice 6).
   [/(\bsokuji-auth\.)[A-Za-z0-9._~+/=-]+/g, `$1${REDACTED}`],
   // `openai-insecure-api-key.${apiKey}` WebSocket subprotocol — OpenAI
   // Translate's own key (`openai_translate/wire.ts` `translateProtocols`,
`````

`src/lib/setup/providerPath.test.ts`

`````diff t07
diff --git a/src/lib/setup/providerPath.test.ts b/src/lib/setup/providerPath.test.ts
--- a/src/lib/setup/providerPath.test.ts
+++ b/src/lib/setup/providerPath.test.ts
@@ -24,7 +24,6 @@
   [Provider.OPENAI]: 'own-key',
   [Provider.GEMINI]: 'own-key',
   [Provider.PALABRA_AI]: 'own-key',
-  [Provider.OPENAI_COMPATIBLE]: 'own-key',
   [Provider.OPENAI_TRANSLATE]: 'own-key',
   [Provider.OPENAI_LIVE]: 'own-key',
   [Provider.VOLCENGINE_AST2]: 'own-key',
`````

`src/providers/openai/adapter.ts`

`````diff t07
diff --git a/src/providers/openai/adapter.ts b/src/providers/openai/adapter.ts
--- a/src/providers/openai/adapter.ts
+++ b/src/providers/openai/adapter.ts
@@ -1,7 +1,7 @@
 /**
  * OpenAI Realtime on the new contract (spec: "L0 — the client contract"),
- * ported from `OpenAIGAClient` (`src/services/clients/`, still compiled
- * until the deletion plan) without its items, its segmentation stage or the
+ * ported from `OpenAIGAClient` (`src/services/clients/`, deleted since)
+ * without its items, its segmentation stage or the
  * old MainPanel's orchestration: one leg, one WebSocket to the GA endpoint,
  * the key in a subprotocol (choice 7). The start resolves on
  * `session.updated`, the configuration confirmed, so a refused one rejects
`````

`src/providers/openai/transcription.ts`

`````diff t07
diff --git a/src/providers/openai/transcription.ts b/src/providers/openai/transcription.ts
--- a/src/providers/openai/transcription.ts
+++ b/src/providers/openai/transcription.ts
@@ -1,8 +1,8 @@
 /**
  * The source transcript's hints for a Realtime session's
  * `audio.input.transcription` (choice 5): copied, pure, from
- * `src/services/providers/openaiTranscriptionContext.ts` (the deletion plan
- * removes that copy with the old client), less its reverse helpers — the
+ * `src/services/providers/openaiTranscriptionContext.ts` (deleted since
+ * with the old client), less its reverse helpers — the
  * builder takes each leg's own direction, so the participant's hint is
  * built for the language it hears (D17).
  *
`````

`src/providers/openai/wire.oracle.test.ts`

`````diff t07
diff --git a/src/providers/openai/wire.oracle.test.ts b/src/providers/openai/wire.oracle.test.ts
--- a/src/providers/openai/wire.oracle.test.ts
+++ b/src/providers/openai/wire.oracle.test.ts
@@ -4,7 +4,7 @@
  * built it (`OpenAIGAClient.ts:144-150`), dials exactly `realtimeUrl` with
  * exactly `realtimeProtocols`. The SDK opens a global `WebSocket`, stubbed
  * here with `FakeSocket`: it connects nowhere. The one value import of the
- * SDK's realtime socket outside the old client.
+ * SDK's realtime socket.
  */
 import { afterEach, describe, it, expect, vi } from 'vitest';
 import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket';
`````

`src/providers/openai/wire.ts`

`````diff t07
diff --git a/src/providers/openai/wire.ts b/src/providers/openai/wire.ts
--- a/src/providers/openai/wire.ts
+++ b/src/providers/openai/wire.ts
@@ -163,7 +163,7 @@
 /**
  * A translation's final text (choice 5): trimmed, and unwrapped when the
  * model answered in JSON (`{"final_text": …}`) — copied from
- * `src/utils/textUtils.ts`, which only the old clients use. Applied to the
+ * `src/utils/textUtils.ts`, deleted since with the old clients. Applied to the
  * `.done` text alone, as the old client did, so a wrapped answer streams
  * raw and settles unwrapped.
  */
`````

`src/providers/openai_translate/adapter.ts`

`````diff t07
diff --git a/src/providers/openai_translate/adapter.ts b/src/providers/openai_translate/adapter.ts
--- a/src/providers/openai_translate/adapter.ts
+++ b/src/providers/openai_translate/adapter.ts
@@ -1,7 +1,7 @@
 /**
  * OpenAI Translate on the new contract (spec: "L0 — the client contract"),
- * ported from `OpenAITranslateGAClient` (`src/services/clients/`, still
- * compiled until the deletion after the two live tests) without its items,
+ * ported from `OpenAITranslateGAClient` (`src/services/clients/`, deleted
+ * since) without its items,
  * ids, karaoke bookkeeping or segmentation stage: one leg, one WebSocket to
  * the translations endpoint, the key in a subprotocol (choice 3). The start
  * resolves on `session.updated`, the configuration confirmed, so a refused
`````

`src/services/interfaces/IClient.ts`

`````diff t07
diff --git a/src/services/interfaces/IClient.ts b/src/services/interfaces/IClient.ts
--- a/src/services/interfaces/IClient.ts
+++ b/src/services/interfaces/IClient.ts
@@ -73,71 +73,6 @@
   keepReplayAudio?: boolean;
 }
 
-/**
- * OpenAI-specific session configuration
- */
~ 60 more removed lines sha256:3d44f25dd6e0
-}
-
 /**
  * PalabraAI-specific session configuration
  */
@@ -217,22 +152,11 @@
 /**
  * Union type for all possible session configurations
  */
-export type SessionConfig = OpenAISessionConfig | OpenAITranslateSessionConfig | PalabraAISessionConfig | LocalInferenceSessionConfig | LocalNativeSessionConfig;
+export type SessionConfig = PalabraAISessionConfig | LocalInferenceSessionConfig | LocalNativeSessionConfig;
 
 /**
  * Type guards for session configurations
  */
-export function isOpenAISessionConfig(config: unknown): config is OpenAISessionConfig {
-  if (typeof config !== 'object' || config === null) return false;
-
-  const provider = (config as { provider?: unknown }).provider;
-  return provider === 'openai' || provider === 'cometapi';
-}
-
-export function isOpenAITranslateSessionConfig(config: SessionConfig): config is OpenAITranslateSessionConfig {
-  return config.provider === 'openai_translate';
-}
-
 export function isPalabraAISessionConfig(config: SessionConfig): config is PalabraAISessionConfig {
   return config.provider === 'palabraai';
 }
@@ -353,15 +277,4 @@
 
   // Provider-specific information
   getProvider(): ProviderType;
-
-  // Optional device control methods (WebRTC only)
-  switchInputDevice?(deviceId: string): Promise<void>;
-  switchOutputDevice?(deviceId: string): Promise<void>;
-  setOutputMuted?(muted: boolean): void;
-  setOutputVolume?(volume: number): void;
-
-  /** Input-side (local capture) frequency data for visualization, where the client
-   * owns its own capture (WebRTC bridge analyser). Absent on clients fed by the
-   * shared recorder. */
-  getInputFrequencies?(): { values: Float32Array } | null;
 }
`````

`src/services/providers/ProviderConfig.ts`

`````diff t07
diff --git a/src/services/providers/ProviderConfig.ts b/src/services/providers/ProviderConfig.ts
--- a/src/services/providers/ProviderConfig.ts
+++ b/src/services/providers/ProviderConfig.ts
@@ -58,7 +58,6 @@
 
   // ── S1 capability flags (spec: 2026-08-13-mainpanel-provider-seams) ──
   // Optional: only descriptors that deviate from the default declare them.
-  // OpenAI-Compatible inherits via its `...base` spread.
 
   /** Speech-mode names from THIS provider's settings vocabulary that send
    *  audio only while the user holds Space. Encodes that 'Disabled' is
`````

`src/services/providers/ProviderConfigFactory.ts`

`````diff t07
diff --git a/src/services/providers/ProviderConfigFactory.ts b/src/services/providers/ProviderConfigFactory.ts
--- a/src/services/providers/ProviderConfigFactory.ts
+++ b/src/services/providers/ProviderConfigFactory.ts
@@ -1,8 +1,5 @@
 import { ProviderConfig } from './ProviderConfig';
 import { ProviderDescriptor } from './ProviderDescriptor';
-import { OpenAIProviderConfig } from './OpenAIProviderConfig';
-import { OpenAICompatibleProviderConfig } from './OpenAICompatibleProviderConfig';
-import { OpenAITranslateProviderConfig } from './OpenAITranslateProviderConfig';
 import { PalabraAIProviderConfig } from './PalabraAIProviderConfig';
 import { LocalInferenceProviderConfig } from './LocalInferenceProviderConfig';
 import { LocalNativeProviderConfig } from './LocalNativeProviderConfig';
@@ -23,15 +20,6 @@
     // 2. Free (local inference) — always available, no API key or flag.
     ProviderConfigFactory.configs.set(Provider.LOCAL_INFERENCE, new LocalInferenceProviderConfig());
 
-    // 5. The OpenAI providers: Realtime, Translate.
-    ProviderConfigFactory.configs.set(Provider.OPENAI, new OpenAIProviderConfig());
-    ProviderConfigFactory.configs.set(Provider.OPENAI_TRANSLATE, new OpenAITranslateProviderConfig());
-
-    // 7. OpenAI Compatible — Electron only.
-    if (isElectron()) {
-      ProviderConfigFactory.configs.set(Provider.OPENAI_COMPATIBLE, new OpenAICompatibleProviderConfig());
-    }
-
     // 8. Palabra AI — behind its feature flag.
     if (isPalabraAIEnabled()) {
       ProviderConfigFactory.configs.set(Provider.PALABRA_AI, new PalabraAIProviderConfig());
`````

`src/services/providers/ProviderDescriptor.ts`

`````diff t07
diff --git a/src/services/providers/ProviderDescriptor.ts b/src/services/providers/ProviderDescriptor.ts
--- a/src/services/providers/ProviderDescriptor.ts
+++ b/src/services/providers/ProviderDescriptor.ts
@@ -186,11 +186,10 @@
    * Session config for the participant (reverse-direction) channel.
    *
    * Base: buildSessionConfig(slice, swappedInstructions) + the generic
-   * participant overrides — textOnly is forced true (the participant leg
-   * never speaks), turn detection is overridden to OpenAI-shaped semantic
-   * VAD (providers that don't read the field ignore it, exactly as before
-   * the extraction). Providers whose direction lives in config fields
-   * override to also reverse those fields.
+   * participant override — textOnly is forced true (the participant leg
+   * never speaks). The OpenAI-shaped semantic-VAD override went with the
+   * last client that read it (Stage 2 deletion, choice 5). Providers whose
+   * direction lives in config fields override to also reverse those fields.
    */
   buildParticipantSessionConfig(
     slice: unknown,
@@ -266,13 +265,6 @@
       ...this.buildSessionConfig(slice, swappedInstructions),
       keepReplayAudio: shell.keepReplayAudio,
       textOnly: true,
-      // Override turn detection to use semantic VAD for participant audio (OpenAI-compatible)
-      turnDetection: {
-        type: 'semantic_vad' as const,
-        createResponse: true,
-        interruptResponse: false,
-        eagerness: 'high',
-      },
     } as SessionConfig;
     return { config, notices: [] };
   }
`````

`src/services/providers/descriptorRegistry.test.ts`

`````diff t07
diff --git a/src/services/providers/descriptorRegistry.test.ts b/src/services/providers/descriptorRegistry.test.ts
--- a/src/services/providers/descriptorRegistry.test.ts
+++ b/src/services/providers/descriptorRegistry.test.ts
@@ -13,11 +13,8 @@
 import { ProviderConfigFactory } from './ProviderConfigFactory';
 import { resolveSegmentationOffer } from './ProviderConfig';
 import type { SegmentationOffer } from '../../lib/segmentation/segmentationMode';
-import { DEFAULT_CHUNK_SENTENCES, DEFAULT_SEGMENT_PAUSE_MS } from '../../lib/segmentation/segmentationMode';
+import { DEFAULT_CHUNK_SENTENCES } from '../../lib/segmentation/segmentationMode';
 import { Provider } from '../../types/Provider';
-import { defaultOpenAISettings } from './OpenAIProviderConfig';
-import { defaultOpenAICompatibleSettings } from './OpenAICompatibleProviderConfig';
-import { defaultOpenAITranslateSettings } from './OpenAITranslateProviderConfig';
 import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
 import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
 import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
@@ -26,9 +23,6 @@
 // Map each provider's settingsSliceKey to its per-module default settings slice,
 // so buildSessionConfig can be exercised for every registered provider.
 const DEFAULTS_BY_SLICE: Record<string, unknown> = {
-  openai: defaultOpenAISettings,
-  openaiCompatible: defaultOpenAICompatibleSettings,
-  openaiTranslate: defaultOpenAITranslateSettings,
   palabraai: defaultPalabraAISettings,
   localInference: defaultLocalInferenceSettings,
   localNative: defaultLocalNativeSettings,
@@ -37,7 +31,7 @@
 describe('provider registry descriptors', () => {
   it('returns a descriptor for every available provider', () => {
     const ids = ProviderConfigFactory.getAvailableProviders();
-    expect(ids.length).toBe(6);
+    expect(ids.length).toBe(3);
     for (const id of ids) {
       const d = ProviderConfigFactory.getDescriptor(id);
       expect(d.getConfig().id).toBe(id);
@@ -59,7 +53,7 @@
   it('constructs a client for every available provider', () => {
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
       const client = ProviderConfigFactory.getDescriptor(id).createClient(creds, ws);
-      expect(client.getProvider()).toBe(id === Provider.OPENAI_COMPATIBLE ? Provider.OPENAI : id);
+      expect(client.getProvider()).toBe(id);
     }
   });
 });
@@ -78,8 +72,6 @@
 describe('descriptor.extractCredentials', () => {
   it('normalizes each provider credential shape', async () => {
     const cases: Array<[Provider, object, { primary: string; secret?: string; endpoint?: string }]> = [
-      [Provider.OPENAI, { apiKey: 'sk-1' }, { primary: 'sk-1' }],
-      [Provider.OPENAI_COMPATIBLE, { apiKey: 'k', customEndpoint: 'https://e' }, { primary: 'k', endpoint: 'https://e' }],
       [Provider.PALABRA_AI, { clientId: 'id', clientSecret: 'sec' }, { primary: 'id', secret: 'sec' }],
     ];
     for (const [id, slice, want] of cases) {
@@ -102,9 +94,7 @@
 
 describe('descriptor.buildSessionConfig', () => {
   it('builds a config whose provider tag matches, for every provider, from defaults', () => {
-    // Expected wire tags (kizuna twins reuse their base tag; compatible uses 'openai').
     const wireTag: Record<string, string> = {
-      openai: 'openai', openai_compatible: 'openai', openai_translate: 'openai_translate',
       palabraai: 'palabraai',
       local_inference: 'local_inference',
       local_native: 'local_native',
@@ -119,11 +109,6 @@
 });
 
 describe('descriptor language rules', () => {
-  it('openai translate restricts targets to the fixed 13', () => {
-    const d = ProviderConfigFactory.getDescriptor(Provider.OPENAI_TRANSLATE);
-    expect(d.resolveTargetLanguages('any').length).toBe(13);
-  });
-
   it('default providers pass their config languages through', () => {
     // Local Native builds its config on each call, so the pass-through is by value.
     const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_NATIVE);
@@ -154,9 +139,6 @@
   // deletion, ruling C1), so every table below names only the providers the
   // old registry still registers.
   const EXPECTED_SLICE_KEYS: Partial<Record<Provider, string>> = {
-    [Provider.OPENAI]: 'openai',
-    [Provider.OPENAI_COMPATIBLE]: 'openaiCompatible',
-    [Provider.OPENAI_TRANSLATE]: 'openaiTranslate',
     [Provider.PALABRA_AI]: 'palabraai',
     [Provider.LOCAL_INFERENCE]: 'localInference',
     // Registered only under Electron with its gate on — both forced on by
@@ -174,9 +156,6 @@
   // Exact expected supportsWebRTC per provider. Relay/twin and non-WebRTC
   // providers must not silently inherit `true` from a base descriptor.
   const EXPECTED_SUPPORTS_WEBRTC: Partial<Record<Provider, boolean>> = {
-    [Provider.OPENAI]: true,
-    [Provider.OPENAI_COMPATIBLE]: true,
-    [Provider.OPENAI_TRANSLATE]: true,
     [Provider.PALABRA_AI]: false,
     [Provider.LOCAL_INFERENCE]: false,
     [Provider.LOCAL_NATIVE]: false,
@@ -210,32 +189,23 @@
 
 describe('S1 capability flags', () => {
   const PUSH_GATED: Partial<Record<Provider, string[] | undefined>> = {
-    [Provider.OPENAI]: ['Disabled', 'Push-to-Translate'],
-    [Provider.OPENAI_COMPATIBLE]: ['Disabled', 'Push-to-Translate'], // inherited from OpenAI via ...base
     [Provider.LOCAL_INFERENCE]: ['Push-to-Talk', 'Push-to-Translate'],
     [Provider.LOCAL_NATIVE]: ['Push-to-Talk', 'Push-to-Translate'],
-    [Provider.OPENAI_TRANSLATE]: undefined,
     [Provider.PALABRA_AI]: undefined,
   };
 
   const TEXT_INPUT: Partial<Record<Provider, boolean | undefined>> = {
-    [Provider.OPENAI]: true,
-    [Provider.OPENAI_COMPATIBLE]: true, // inherited
     [Provider.LOCAL_INFERENCE]: true,
     [Provider.LOCAL_NATIVE]: true,
-    [Provider.OPENAI_TRANSLATE]: undefined,
     [Provider.PALABRA_AI]: undefined,
   };
 
-  const QUEUES_TEXT: Provider[] = [Provider.OPENAI, Provider.OPENAI_COMPATIBLE];
+  const QUEUES_TEXT: Provider[] = [];
   const LOCAL_PROMPT: Provider[] = [Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE];
 
   const PTT_FINALIZATION: Partial<Record<Provider, { silenceTailFrames?: number; response: string } | undefined>> = {
     [Provider.LOCAL_INFERENCE]: { silenceTailFrames: 7, response: 'always' },
     [Provider.LOCAL_NATIVE]: { silenceTailFrames: 7, response: 'always' },
-    [Provider.OPENAI]: undefined,
-    [Provider.OPENAI_COMPATIBLE]: undefined,
-    [Provider.OPENAI_TRANSLATE]: undefined,
     [Provider.PALABRA_AI]: undefined,
   };
 
@@ -243,10 +213,6 @@
   // filled in — because that is the answer the mode resolvers act on. This
   // table IS the specification (segmentation design, Amendment A2).
   const SEGMENTATION: Partial<Record<Provider, SegmentationOffer>> = {
-    // Their own silence timers cut the bubble, and the user tunes them, so
-    // Auto here would be the pause mode wearing another name.
-    [Provider.OPENAI_TRANSLATE]: { pause: true, auto: false, sizes: true },
-
     // 1-5 is what slice 3 shipped on the local engines; phase 2 adds Auto,
     // where the VAD utterance is the boundary someone else already decided
     // and the stage only fills the punctuation in.
@@ -257,12 +223,6 @@
     // Palabra writes text only. Auto stays what it always was — keep the
     // server's segment.
     [Provider.PALABRA_AI]: { pause: false, auto: true, sizes: true },
-
-    // Also the default, and it stays there: the GA client attaches audio to
-    // conversation items, so splitting one would strand the karaoke timing.
-    // The beta client shares the descriptor.
-    [Provider.OPENAI]: { pause: false, auto: true, sizes: false },
-    [Provider.OPENAI_COMPATIBLE]: { pause: false, auto: true, sizes: false }, // inherited via ...base
   };
 
   const DEFAULT_OFFER: SegmentationOffer = { pause: false, auto: true, sizes: false };
@@ -271,12 +231,8 @@
   // reader — the slider inside `renderTurnDetectionSettings`, which
   // `hasTurnDetection: false` returns before ever reaching — so on a provider
   // without turn detection it renders nothing and must not claim to. A2 moved
-  // the two pause clients' sliders into the segmentation section, which is
-  // what emptied it on OpenAI Live and OpenAI Translate.
+  // the two pause clients' sliders into the segmentation section.
   const SILENCE_DURATION: Partial<Record<Provider, boolean>> = {
-    [Provider.OPENAI]: true,
-    [Provider.OPENAI_COMPATIBLE]: true, // inherited via ...base
-    [Provider.OPENAI_TRANSLATE]: false,
     [Provider.PALABRA_AI]: false,
     [Provider.LOCAL_INFERENCE]: false,
     [Provider.LOCAL_NATIVE]: false,
@@ -373,32 +329,6 @@
     }
   });
 
-  // The private fields each pause client keeps its two timers in. The
-  // providers that offer By pause name the pair differently — this map is the
-  // only place that knows, so the invariant below can be a loop rather than a
~ 21 more removed lines sha256:329bcd5dc934
-  });
-
   // Eleven clients each write `options.sentencesPerChunk ?? 3`, and the
   // number also lives in the store's clamp, in `defaultSize()` and in
   // `segmentationForProvider`. This is what ties every one of those copies to
@@ -415,51 +345,6 @@
     }
   });
 
-  it('a client built with no pause runs on the default the store shares with it', () => {
-    for (const id of ProviderConfigFactory.getAvailableProviders()) {
-      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
~ 40 more removed lines sha256:8eafbe6ad840
-  });
-
   it('forcedTransport only on PalabraAI, and it names a real transport', () => {
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
       const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
@@ -521,7 +406,7 @@
 
   it('ClientFactory.createClient rejects an empty apiKey for credentialed providers', async () => {
     const { ClientFactory } = await import('../clients/ClientFactory');
-    expect(() => ClientFactory.createClient('m', Provider.OPENAI, ''))
+    expect(() => ClientFactory.createClient('m', Provider.PALABRA_AI, ''))
       .toThrow(/API key is required/);
     // LOCAL_INFERENCE never had credentials — must keep working with ''
     expect(ClientFactory.createClient('m', Provider.LOCAL_INFERENCE, '')).toBeTruthy();
`````

`src/services/providers/participantConfig.test.ts`

`````diff t07
diff --git a/src/services/providers/participantConfig.test.ts b/src/services/providers/participantConfig.test.ts
--- a/src/services/providers/participantConfig.test.ts
+++ b/src/services/providers/participantConfig.test.ts
@@ -17,19 +17,13 @@
 import { ProviderConfigFactory } from './ProviderConfigFactory';
 import { Provider } from '../../types/Provider';
 import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
-import { defaultOpenAISettings } from './OpenAIProviderConfig';
-import { defaultOpenAICompatibleSettings } from './OpenAICompatibleProviderConfig';
-import { defaultOpenAITranslateSettings } from './OpenAITranslateProviderConfig';
 import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
 import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
-import { reverseTranscriptionDirection } from './openaiTranscriptionContext';
 import { createParticipantLocalInferenceConfig, createParticipantLocalNativeConfig } from './localParticipantConfig';
 import { useNativeModelStore } from '../../stores/nativeModelStore';
 import { directionKey } from '../../lib/local-inference/selection/types';
 import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
 import type {
-  OpenAISessionConfig,
-  OpenAITranslateSessionConfig,
   LocalInferenceSessionConfig,
   LocalNativeSessionConfig,
 } from '../interfaces/IClient';
@@ -39,14 +33,6 @@
 
 const shell = { keepReplayAudio: false };
 
-// Local mapping from settingsSliceKey to default settings slice, scoped to
-// the two openai-family providers exercised below — mirrors DEFAULTS_BY_SLICE
-// in descriptorRegistry.test.ts.
-const DEFAULTS_BY_SLICE_LOCAL: Record<string, unknown> = {
-  openai: defaultOpenAISettings,
-  openaiCompatible: defaultOpenAICompatibleSettings,
-};
-
 const M = (id: string, kind: NativeModelInfo['kind'], languages: string[], order: number,
            recommended = false): NativeModelInfo =>
   ({ id, name: id, languages, recommended, tiers: [{ tier: 'cpu', backend: 'ct2', available: true }],
@@ -92,17 +78,6 @@
     expect(notices[0].message).toContain('ja');
   });
 
-  it('openai_translate rejects a reversed target outside the 13-entry TARGET_LANGUAGES (th is source-only)', () => {
-    const d = ProviderConfigFactory.getDescriptor(Provider.OPENAI_TRANSLATE);
-    const slice = { ...defaultOpenAITranslateSettings, sourceLanguage: 'th', targetLanguage: 'en' };
-    const { config, notices } = d.buildParticipantSessionConfig(slice, 'i', shell);
-    expect(config).toBeNull();
-    expect(notices).toHaveLength(1);
-    expect(notices[0].channel).toBe('error');
-    expect(notices[0].message).toContain('th');
-    expect(notices[0].message).toContain('en');
-  });
-
   it('palabraai accepts a reversed target that exactly matches a TARGET_LANGUAGES entry (es)', () => {
     // Pins the exact-match arm of the guard (`t.value === newTarget`) — 'es'
     // has its own entry in TARGET_LANGUAGES. The split('-')[0] arm described
@@ -118,35 +93,6 @@
   });
 });
 
-describe('participant config: helper-based reversals', () => {
-  it('openai and openai_compatible rebuild the transcription hint for the reversed direction', () => {
-    for (const id of [Provider.OPENAI, Provider.OPENAI_COMPATIBLE]) {
~ 24 more removed lines sha256:e00b78f1fd57
-});
-
 describe('participant config: local providers (mocked helpers)', () => {
   beforeEach(() => {
     mockedLocalInference.mockReset();
@@ -241,7 +187,7 @@
     expect(notices).toEqual([]);
   });
 
-  it('local_inference and local_native pass the BASE participant config (textOnly + semantic VAD already applied) to their helper', () => {
+  it('local_inference and local_native pass the BASE participant config (textOnly already applied) to their helper', () => {
     const dInf = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE);
     mockedLocalInference.mockReturnValue({
       success: true,
@@ -251,10 +197,9 @@
     dInf.buildParticipantSessionConfig({ ...defaultLocalInferenceSettings }, 'i', shell);
     const infCalls = mockedLocalInference.mock.calls;
     const argInf = infCalls[infCalls.length - 1]?.[0] as unknown as {
-      textOnly?: boolean; turnDetection?: unknown; keepReplayAudio?: boolean;
+      textOnly?: boolean; keepReplayAudio?: boolean;
     };
     expect(argInf.textOnly).toBe(true);
-    expect(argInf.turnDetection).toEqual({ type: 'semantic_vad', createResponse: true, interruptResponse: false, eagerness: 'high' });
     expect(argInf.keepReplayAudio).toBe(false);
 
     const dNat = ProviderConfigFactory.getDescriptor(Provider.LOCAL_NATIVE);
@@ -262,10 +207,9 @@
     dNat.buildParticipantSessionConfig({ ...defaultLocalNativeSettings }, 'i', shell);
     const natCalls = mockedLocalNative.mock.calls;
     const argNat = natCalls[natCalls.length - 1]?.[0] as unknown as {
-      textOnly?: boolean; turnDetection?: unknown; keepReplayAudio?: boolean;
+      textOnly?: boolean; keepReplayAudio?: boolean;
     };
     expect(argNat.textOnly).toBe(true);
-    expect(argNat.turnDetection).toEqual({ type: 'semantic_vad', createResponse: true, interruptResponse: false, eagerness: 'high' });
     expect(argNat.keepReplayAudio).toBe(false);
   });
 });
`````

`src/services/providers/providerOrder.test.ts`

`````diff t07
diff --git a/src/services/providers/providerOrder.test.ts b/src/services/providers/providerOrder.test.ts
--- a/src/services/providers/providerOrder.test.ts
+++ b/src/services/providers/providerOrder.test.ts
@@ -32,9 +32,6 @@
 
     expect(ids).toEqual([
       Provider.LOCAL_INFERENCE,
-      Provider.OPENAI,
-      Provider.OPENAI_TRANSLATE,
-      Provider.OPENAI_COMPATIBLE,
       Provider.PALABRA_AI,
       Provider.LOCAL_NATIVE,
     ]);
@@ -58,8 +55,6 @@
 
     expect(ids).toEqual([
       Provider.LOCAL_INFERENCE,
-      Provider.OPENAI,
-      Provider.OPENAI_TRANSLATE,
     ]);
   });
 });
`````

`src/stores/logStore.ts`

`````diff t07
diff --git a/src/stores/logStore.ts b/src/stores/logStore.ts
--- a/src/stores/logStore.ts
+++ b/src/stores/logStore.ts
@@ -63,10 +63,6 @@
     // session.close handshake
     | 'session.start' | 'session.close'
     | 'session.connection_lost'
-    // openai-realtime-api custom events (for beta clients)
-    | 'conversation.item.appended' | 'conversation.item.completed'
-    | 'conversation.updated' | 'conversation.interrupted'
-    | 'realtime.event'
     // PalabraAI-specific request types (client → server)
     | 'set_task'
     | 'end_task'
`````

`src/stores/settingsStore.providerSettings.test.tsx`

`````diff t07
diff --git a/src/stores/settingsStore.providerSettings.test.tsx b/src/stores/settingsStore.providerSettings.test.tsx
--- a/src/stores/settingsStore.providerSettings.test.tsx
+++ b/src/stores/settingsStore.providerSettings.test.tsx
@@ -62,16 +62,4 @@
 
     expect(getByTestId('src').textContent).toBe('fr');
   });
-
-  it('re-renders when the provider itself switches', () => {
-    const { getByTestId } = render(<Probe />);
~ 7 more removed lines sha256:d474b16efe62
-    expect(getByTestId('src').textContent).toBe('en');
-  });
 });
`````

`src/stores/settingsStore.sliceRegistry.test.ts`

`````diff t07
diff --git a/src/stores/settingsStore.sliceRegistry.test.ts b/src/stores/settingsStore.sliceRegistry.test.ts
--- a/src/stores/settingsStore.sliceRegistry.test.ts
+++ b/src/stores/settingsStore.sliceRegistry.test.ts
@@ -29,7 +29,6 @@
 /** action name → [sliceKey, sample patch] for the plain (no-special-case) slices */
 const PLAIN: Array<[string, string, Record<string, unknown>]> = [
   ['updatePalabraAI', 'palabraai', { clientId: 'c1' }],
-  ['updateOpenAITranslate', 'openaiTranslate', { apiKey: 'k2' }],
   ['updateLocalInference', 'localInference', { ttsSpeed: 1.5 }],
   ['updateLocalNative', 'localNative', { sourceLanguage: 'ja' }],
 ];
@@ -50,35 +49,6 @@
     }
   });
 
-  it('openai/openaiCompatible: switching to webrtc forces turnDetectionMode Disabled in state AND persistence', async () => {
-    for (const [action, sliceKey] of [['updateOpenAI', 'openai'], ['updateOpenAICompatible', 'openaiCompatible']] as const) {
-      setSetting.mockClear();
~ 24 more removed lines sha256:d0a24566553b
-  });
-
   // The registry used to carry `persistErrors: 'throw' | 'swallow'`, split 6/6,
   // and this pinned each row. What the split actually did in production: none
   // of the six "throw" actions was awaited or caught by any caller — they are
@@ -93,10 +63,7 @@
   // resolves, and the failure becomes one panel entry per key. Both failure
   // channels are exercised because the service can produce either.
   const ALL_SLICES: Array<[string, string, Record<string, unknown>]> = [
-    ['updateOpenAI', 'openai', { apiKey: 'x' }],
-    ['updateOpenAICompatible', 'openaiCompatible', { apiKey: 'x' }],
     ['updatePalabraAI', 'palabraai', { clientId: 'x' }],
-    ['updateOpenAITranslate', 'openaiTranslate', { apiKey: 'x' }],
     ['updateLocalInference', 'localInference', { ttsSpeed: 1.5 }],
     ['updateLocalNative', 'localNative', { sourceLanguage: 'ja' }],
   ];
@@ -148,8 +115,7 @@
     const s = useSettingsStore.getState() as any;
     // Spot every slice key is a populated object after load.
     for (const sliceKey of [
-      'openai', 'openaiCompatible', 'palabraai', 'openaiTranslate',
-      'localInference', 'localNative',
+      'palabraai', 'localInference', 'localNative',
     ]) {
       expect(s[sliceKey], sliceKey).toBeTypeOf('object');
       expect(Object.keys(s[sliceKey]).length, sliceKey).toBeGreaterThan(0);
`````

`src/stores/settingsStore.test.ts`

`````diff t07
diff --git a/src/stores/settingsStore.test.ts b/src/stores/settingsStore.test.ts
--- a/src/stores/settingsStore.test.ts
+++ b/src/stores/settingsStore.test.ts
@@ -1,5 +1,4 @@
 import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
-import { renderHook } from '@testing-library/react';
 import { Provider } from '../types/Provider';
 import { buildDefaultLocalPrompt } from '../lib/local-inference/prompts';
 import { directionKey } from '../lib/local-inference/selection/types';
@@ -42,7 +41,6 @@
 // Import after mocking
 const {
   default: useSettingsStore,
-  useTransportType,
   clampChunkSentences,
 } = await import('./settingsStore');
 
@@ -132,12 +130,12 @@
 
     it('should persist provider change to settings service', async () => {
       // Switch provider
-      await useSettingsStore.getState().setProvider(Provider.OPENAI_COMPATIBLE);
+      await useSettingsStore.getState().setProvider(Provider.LOCAL_NATIVE);
 
       // Check that settings service was called
       expect(mockSetSetting).toHaveBeenCalledWith(
         'settings.common.provider',
-        Provider.OPENAI_COMPATIBLE
+        Provider.LOCAL_NATIVE
       );
     });
   });
@@ -173,56 +171,6 @@
         'Push-to-Translate'
       );
     });
-
-    it('persists Push-to-Translate for OpenAI on WebSocket', async () => {
-      const store = useSettingsStore.getState();
~ 45 more removed lines sha256:d9c25c592e8e
-    // was removed in favor of the WS-only relay-managed twins, so its
-    // webrtc-demotion test no longer applies.
   });
 
   describe('keepReplayAudio', () => {
@@ -576,38 +524,6 @@
       expect(useSettingsStore.getState().autoSaveOnStop).toBe(false);
     });
   });
-
-  describe('useTransportType', () => {
-    it('resolves the active provider slice, not a hardcoded openai slice (bug repro: OpenAI Translate reads its own websocket choice, not OpenAI leftover webrtc)', async () => {
~ 27 more removed lines sha256:af54dda46b34
-  });
-
 });
 
 describe('createParticipantLocalInferenceConfig', () => {
@@ -754,14 +670,6 @@
     expect(useSettingsStore.getState().localNative.sourceLanguage).toBe(sourceBefore);
   });
 
-  it('applies the same registry transform the named action applies', async () => {
-    // The openai row's transformPatch forces turnDetectionMode 'Disabled' when
-    // transportType flips to webrtc — the generic path must run it too, or the
-    // two write paths diverge on the same slice.
-    await useSettingsStore.getState().updateProviderSlice('openai', { transportType: 'webrtc' });
-    expect((useSettingsStore.getState().openai as { turnDetectionMode: string }).turnDetectionMode).toBe('Disabled');
-  });
-
   it('rejects an unknown slice key', async () => {
     await expect(
       useSettingsStore.getState().updateProviderSlice('not-a-slice', { x: 1 })
`````

`src/stores/settingsStore.ts`

`````diff t07
diff --git a/src/stores/settingsStore.ts b/src/stores/settingsStore.ts
--- a/src/stores/settingsStore.ts
+++ b/src/stores/settingsStore.ts
@@ -3,7 +3,6 @@
 import {ServiceFactory} from '../services/ServiceFactory';
 import {ProviderConfigFactory} from '../services/providers/ProviderConfigFactory';
 import {ProviderConfig} from '../services/providers/ProviderConfig';
-import type {TransportType} from '../services/providers/ProviderDescriptor';
 import {
   FilteredModel,
   SessionConfig,
@@ -29,18 +28,7 @@
 import { currentRunPhase } from '../app/runPhase';
 import {ApiKeyValidationResult} from '../services/interfaces/ISettingsService';
 import {Provider, ProviderType} from '../types/Provider';
-import {ClientOperations} from '../services/ClientOperations';
 import i18n from '../locales';
-import {
-  OpenAISettings, defaultOpenAISettings, OpenAICompatibleSettingsBase,
-} from '../services/providers/OpenAIProviderConfig';
-import {
-  OpenAICompatibleSettings, defaultOpenAICompatibleSettings,
-} from '../services/providers/OpenAICompatibleProviderConfig';
-import {
-  OpenAITranslateSettings, defaultOpenAITranslateSettings,
-  LEGACY_TRANSLATE_TRANSCRIPT_MODEL,
-} from '../services/providers/OpenAITranslateProviderConfig';
 import {
   PalabraAISettings, defaultPalabraAISettings,
 } from '../services/providers/PalabraAIProviderConfig';
@@ -69,16 +57,14 @@
 }
 
 export type {
-  OpenAISettings, OpenAICompatibleSettings, OpenAICompatibleSettingsBase,
-  OpenAITranslateSettings, PalabraAISettings,
+  PalabraAISettings,
   LocalInferenceSettings, LocalNativeSettings,
 };
 
 // Union of every provider's settings slice — the return type of
 // getCurrentProviderSettings, resolved dynamically via the active descriptor.
 export type ProviderSettingsUnion =
-  | OpenAISettings | OpenAICompatibleSettings | PalabraAISettings
-  | OpenAITranslateSettings
+  | PalabraAISettings
   | LocalInferenceSettings | LocalNativeSettings;
 
 // ==================== Type Definitions ====================
@@ -121,12 +107,9 @@
   participantDisplayMode: DisplayMode;
 }
 
-// Transport type moved to the services layer; re-exported for existing importers.
 /** The authentication forms that can sit over the app. */
 export type AuthOverlayKind = 'sign-in' | 'sign-up' | 'forgot-password' | null;
 
-export type { TransportType } from '../services/providers/ProviderDescriptor';
-
 // Cache Entry
 interface CacheEntry {
   validation: ApiKeyValidationResult;
@@ -266,10 +249,7 @@
   participantSystemInstructions: string;
 
   // Provider-specific settings
-  openai: OpenAISettings;
-  openaiCompatible: OpenAICompatibleSettings;
   palabraai: PalabraAISettings;
-  openaiTranslate: OpenAITranslateSettings;
   localInference: LocalInferenceSettings;
   localNative: LocalNativeSettings;
 
@@ -385,10 +365,7 @@
   setParticipantSystemInstructions: (instructions: string) => void;
 
   // Provider settings actions
-  updateOpenAI: (settings: Partial<OpenAISettings>) => void;
-  updateOpenAICompatible: (settings: Partial<OpenAICompatibleSettings>) => void;
   updatePalabraAI: (settings: Partial<PalabraAISettings>) => void;
-  updateOpenAITranslate: (settings: Partial<OpenAITranslateSettings>) => Promise<void>;
   updateLocalInference: (settings: Partial<LocalInferenceSettings>) => void;
   updateLocalNative: (settings: Partial<LocalNativeSettings>) => void;
   /** Generic slice update keyed by descriptor.settingsSliceKey — the write
@@ -458,56 +435,6 @@
   return { authMode: 'platform' };
 }
 
-/** Move a persisted OpenAI-Translate transcript model off the legacy
- *  `gpt-realtime-whisper`. OpenAI reclassified it as legacy on 2026-07-31 and
- *  names `gpt-live-transcribe` as the replacement: identical $0.017/min, lower
~ 45 more removed lines sha256:bac99dc38135
-}
-
 /**
  * Resolve the worker type for a specific translation model id.
  * Returns 'opus-mt' when the id is missing or not in the manifest.
@@ -543,8 +470,8 @@
 // ─── Provider settings slice registry ────────────────────────────────────────
 // One row per persisted provider slice. This table is the single home for the
 // knowledge the twelve hand-written update actions used to re-encode: the
-// slice's defaults (for loading), its patch transform, and its
-// persistence-error policy. Persist keys are always
+// slice's defaults (for loading) and its persistence-error policy. Persist
+// keys are always
 // `settings.<sliceKey>.<field>` — the sliceKey doubles as the storage prefix.
 
 type SliceUpdateSpec = {
@@ -555,39 +482,25 @@
    * `Object.keys` is read from it.
    */
   defaults: object;
-  /** Transform an incoming patch before it is merged AND persisted. */
-  transformPatch?: (patch: Record<string, unknown>) => Record<string, unknown>;
 };
 
-// WebRTC transport: the server truncates audio on user speech (API design),
-// so server VAD must be off to prevent translation interruption. Forcing the
-// field unconditionally is equivalent to the old merged-state check: after
-// the old code ran, turnDetectionMode was always 'Disabled' under webrtc.
-const forceWebrtcTurnDetectionOff = (patch: Record<string, unknown>): Record<string, unknown> =>
-  patch.transportType === 'webrtc' ? { ...patch, turnDetectionMode: 'Disabled' } : patch;
-
 const PROVIDER_SLICE_REGISTRY = {
-  openai: { defaults: defaultOpenAISettings, transformPatch: forceWebrtcTurnDetectionOff },
-  openaiCompatible: { defaults: defaultOpenAICompatibleSettings, transformPatch: forceWebrtcTurnDetectionOff },
   palabraai: { defaults: defaultPalabraAISettings },
-  openaiTranslate: { defaults: defaultOpenAITranslateSettings },
   localInference: { defaults: defaultLocalInferenceSettings },
   localNative: { defaults: defaultLocalNativeSettings },
 } satisfies Record<string, SliceUpdateSpec>;
 
 export type ProviderSliceKey = keyof typeof PROVIDER_SLICE_REGISTRY;
 
-/** Shared implementation behind every updateXxx action: merge the (possibly
- *  transformed) patch into the slice, then persist each field under
+/** Shared implementation behind every updateXxx action: merge the patch
+ *  into the slice, then persist each field under
  *  `settings.<sliceKey>.<field>` per the slice's error policy. */
 async function updateProviderSlice(
   set: (fn: (state: SettingsStore) => Partial<SettingsStore>) => void,
   sliceKey: ProviderSliceKey,
   patch: Record<string, unknown>,
 ): Promise<void> {
-  const spec: SliceUpdateSpec = PROVIDER_SLICE_REGISTRY[sliceKey];
-  const effective = spec.transformPatch ? spec.transformPatch(patch) : patch;
-  set((state) => ({ [sliceKey]: { ...(state as any)[sliceKey], ...effective } }) as Partial<SettingsStore>);
+  set((state) => ({ [sliceKey]: { ...(state as any)[sliceKey], ...patch } }) as Partial<SettingsStore>);
 
   // One seam for every slice. The registry used to carry
   // `persistErrors: 'throw' | 'swallow'`, split 6/6, but none of the six
@@ -596,7 +509,7 @@
   // routed to PostHog and "swallow" meant a console line. Neither reached the
   // user, and which slice got which was arbitrary. `persistSetting` reports
   // the failure once per key instead.
-  for (const [key, value] of Object.entries(effective)) {
+  for (const [key, value] of Object.entries(patch)) {
     await persistSetting(`settings.${sliceKey}.${key}`, value);
   }
 }
@@ -605,10 +518,7 @@
   subscribeWithSelector((set, get) => ({
     // === Initial State ===
     ...defaultCommonSettings,
-    openai: defaultOpenAISettings,
-    openaiCompatible: defaultOpenAICompatibleSettings,
     palabraai: defaultPalabraAISettings,
-    openaiTranslate: defaultOpenAITranslateSettings,
     localInference: defaultLocalInferenceSettings,
     localNative: defaultLocalNativeSettings,
 
@@ -631,13 +541,8 @@
 
     // === Common Settings Actions ===
     setProvider: async (provider) => {
-      // Snapshot the prior state BEFORE committing the provider switch so the
-      // prefill check sees the previous provider's apiKey value.
-      const prior = get();
-
-      // Commit the provider change first so any subscriber (SettingsInitializer
-      // etc.) sees the new value synchronously. Persistence and the optional
-      // prefill happen afterwards.
+      // Commit the provider change first so any subscriber sees the new value
+      // synchronously. Persistence happens afterwards.
       set({provider});
 
       // Clear cache synchronously before persisting, so SettingsInitializer
@@ -647,27 +552,6 @@
 
       const service = ServiceFactory.getSettingsService();
       await service.setSetting('settings.common.provider', provider);
-
-      // Silent prefill: when first switching to OPENAI_TRANSLATE and its key
-      // is empty while the OpenAI provider already has one, copy it across so
~ 16 more removed lines sha256:c20948a1cc79
-        void get().validateApiKey();
-      }
     },
 
     setUILanguage: async (uiLanguage) => {
@@ -861,10 +745,7 @@
     },
 
     // === Provider Settings Actions ===
-    updateOpenAI: (settings) => updateProviderSlice(set, 'openai', settings),
-    updateOpenAICompatible: (settings) => updateProviderSlice(set, 'openaiCompatible', settings),
     updatePalabraAI: (settings) => updateProviderSlice(set, 'palabraai', settings),
-    updateOpenAITranslate: (settings) => updateProviderSlice(set, 'openaiTranslate', settings),
     updateLocalInference: (settings) => updateProviderSlice(set, 'localInference', settings),
     updateLocalNative: (settings) => updateProviderSlice(set, 'localNative', settings),
     updateProviderSlice: (sliceKey, patch) => {
@@ -1016,32 +897,6 @@
           cacheTimestamp: Date.now()
         });
 
-        // Auto-select model if current selection is empty or not in available list
-        if (result.models.length > 0) {
-          const currentModel = (state.getCurrentProviderSettings() as any)?.model;
~ 21 more removed lines sha256:388e00752a69
-        }
-
         return result.validation;
       } catch (error) {
         const message = error instanceof Error ? error.message : 'Validation failed';
@@ -1119,18 +974,6 @@
           ] as const),
         )) as Partial<SettingsStore>;
 
-        // Migrate a persisted deprecated OpenAI realtime model (pre-2.1 family,
-        // removed from the API 2027-01-20) to its current replacement so
-        // existing users don't reconnect onto a dead model.
~ 7 more removed lines sha256:006d81fa9328
-        if (translateSlice) Object.assign(translateSlice, migrateLegacyTranslateTranscriptModel(translateSlice));
-
         // Drop persisted PalabraAI language codes the API rejects, so an existing
         // user isn't left on a pair whose set_task fails validation.
         const palabraSlice = loadedSlices.palabraai as PalabraAISettings | undefined;
@@ -1312,23 +1155,10 @@
 export const useParticipantSystemInstructions = () => useSettingsStore((state) => state.participantSystemInstructions);
 
 // Provider settings
-export const useOpenAISettings = () => useSettingsStore((state) => state.openai);
-export const useOpenAICompatibleSettings = () => useSettingsStore((state) => state.openaiCompatible);
 export const usePalabraAISettings = () => useSettingsStore((state) => state.palabraai);
-export const useOpenAITranslateSettings = () => useSettingsStore((state) => state.openaiTranslate);
 export const useLocalInferenceSettings = () => useSettingsStore((state) => state.localInference);
 export const useLocalNativeSettings = () => useSettingsStore((state) => state.localNative);
 
-// Transport type selector — resolves the ACTIVE provider's own slice (a
-// selector hardcoded to `state.openai` let OpenAI's WebRTC choice silently
-// govern other providers' sessions while their own pickers wrote an unread
-// field).
-export const useTransportType = (): TransportType => useSettingsStore((state) => {
-  const descriptor = ProviderConfigFactory.getDescriptor(state.provider);
-  const slice = state[descriptor.settingsSliceKey as keyof SettingsStore] as { transportType?: TransportType };
-  return slice?.transportType ?? 'websocket';
-});
-
 // Validation state
 export const useIsApiKeyValid = () => useSettingsStore((state) => state.isApiKeyValid);
 export const useIsValidating = () => useSettingsStore((state) => state.isValidating);
@@ -1385,10 +1215,7 @@
 export const useSetUseTemplateMode = () => useSettingsStore((state) => state.setUseTemplateMode);
 export const useSetParticipantSystemInstructions = () => useSettingsStore((state) => state.setParticipantSystemInstructions);
 
-export const useUpdateOpenAI = () => useSettingsStore((state) => state.updateOpenAI);
-export const useUpdateOpenAICompatible = () => useSettingsStore((state) => state.updateOpenAICompatible);
 export const useUpdatePalabraAI = () => useSettingsStore((state) => state.updatePalabraAI);
-export const useUpdateOpenAITranslate = () => useSettingsStore((state) => state.updateOpenAITranslate);
 export const useUpdateLocalInference = () => useSettingsStore((state) => state.updateLocalInference);
 export const useUpdateLocalNative = () => useSettingsStore((state) => state.updateLocalNative);
 
`````

`src/types/Provider.ts`

`````diff t07
diff --git a/src/types/Provider.ts b/src/types/Provider.ts
--- a/src/types/Provider.ts
+++ b/src/types/Provider.ts
@@ -10,7 +10,6 @@
   GEMINI = 'gemini',
   PALABRA_AI = 'palabraai',
   KIZUNA_AI_SONIOX = 'kizunaai_soniox',
-  OPENAI_COMPATIBLE = 'openai_compatible',
   OPENAI_TRANSLATE = 'openai_translate',
   OPENAI_LIVE = 'openai_live',
   VOLCENGINE_AST2 = 'volcengine_ast2',
@@ -22,7 +21,7 @@
 /**
  * Provider type definition
  */
-export type ProviderType = Provider.OPENAI | Provider.GEMINI | Provider.PALABRA_AI | Provider.KIZUNA_AI_SONIOX | Provider.OPENAI_COMPATIBLE | Provider.OPENAI_TRANSLATE | Provider.OPENAI_LIVE | Provider.VOLCENGINE_AST2 | Provider.LOCAL_INFERENCE | Provider.LOCAL_NATIVE | Provider.SONIOX;
+export type ProviderType = Provider.OPENAI | Provider.GEMINI | Provider.PALABRA_AI | Provider.KIZUNA_AI_SONIOX | Provider.OPENAI_TRANSLATE | Provider.OPENAI_LIVE | Provider.VOLCENGINE_AST2 | Provider.LOCAL_INFERENCE | Provider.LOCAL_NATIVE | Provider.SONIOX;
 
 /** The backend-managed provider: Kizuna AI's own service running on a
  *  third-party engine. Keep in lockstep with isKizunaManagedProvider below. */
`````

---

### Task 8: Palabra's old LiveKit client, with `livekit-client` and the bridge (Wave 2)

Palabra runs on a WebSocket client written from scratch since the Stage 2 Palabra plan, live-tested (18 of 18). The roadmap's inventory (`:6345-6356`) is taken whole: this is the second of the two deletions that meet at `WebRTCAudioBridge`, so it deletes the bridge (research note 8).

**What goes, and what changes:**
- `PalabraAIClient.ts` and `PalabraAIProviderConfig.ts` with their tests, `palabraLanguageCodes.test.ts`, `palabraAuthModeMigration.test.ts`, `palabraLanguageMigration.test.ts`; the registration; `IClient.ts`' Palabra config; the `palabraai` slice, its two load migrations and hooks; `logStore.ts`' old classification and grouping.
- `WebRTCAudioBridge.ts` and its test, `src/services/worklets/pcm-audio-worklet-processor.js`, and the extension build's copy of it.
- `livekit-client` and its exact pin, with LiveKit's lockfile entries (ruling 2); CLAUDE.md's pin text goes in Task 11.
- `isPalabraAIEnabled` and `VITE_ENABLE_PALABRA_AI` (ruling 6): `environment.ts`, `build.yml`, `extension/vite.config.ts`, every test mock; `featureGateForwarding.consistency.test.ts` expects at least three gates now. `consoleLedger.consistency.test.ts` drops the client's row. The new provider's comments (`palabraai/{adapter,provider}.ts`, `settings.test.ts`) say the old code is gone (choice 3).
- Three keys: `settings.apiKeyValidated`, `settings.errorValidatingApiKey`, `settings.realtimeTranslationAvailable`.
- `environment.ts`' two comments that still described the old registry's per-provider gates — `isDevelopmentMode`'s ("vanishes from ProviderConfigFactory's registry") and `enabledProviderIds`' ("the per-provider gates above keep gating `ProviderConfigFactory`"): with Palabra's gone, the old registry's one gate left is Local Native's (choice 3).
- Kept: `Provider.PALABRA_AI`, `LEGACY_SLICE_KEYS.palabraai`, `PalabraAIIcon`, the keys the new definition reads, the credential-choice styles.

**Files:**
- Delete (10): `src/lib/modern-audio/WebRTCAudioBridge.test.ts`, `src/lib/modern-audio/WebRTCAudioBridge.ts`, `src/services/clients/PalabraAIClient.test.ts`, `src/services/clients/PalabraAIClient.ts`, `src/services/providers/PalabraAIProviderConfig.test.ts`, `src/services/providers/PalabraAIProviderConfig.ts`, `src/services/providers/palabraLanguageCodes.test.ts`, `src/services/worklets/pcm-audio-worklet-processor.js`, `src/stores/palabraAuthModeMigration.test.ts`, `src/stores/palabraLanguageMigration.test.ts`
- Modify (24, by the blocks below): `.github/workflows/build.yml`, `extension/vite.config.ts`, `package-lock.json`, `package.json`, `src/components/SetupWizard/SetupWizard.test.tsx`, `src/components/SetupWizard/providerPaths.test.ts`, `src/components/SetupWizard/steps/StepCredentials.test.tsx`, `src/lib/diagnostics/consoleLedger.consistency.test.ts`, `src/locales/locales.consistency.test.ts`, `src/providers/palabraai/adapter.ts`, `src/providers/palabraai/provider.ts`, `src/providers/palabraai/settings.test.ts`, `src/services/interfaces/IClient.ts`, `src/services/providers/ProviderConfigFactory.ts`, `src/services/providers/descriptorRegistry.test.ts`, `src/services/providers/participantConfig.test.ts`, `src/services/providers/prepareToStart.local.test.ts`, `src/services/providers/providerOrder.test.ts`, `src/stores/logStore.ts`, `src/stores/settingsStore.sliceRegistry.test.ts`, `src/stores/settingsStore.test.ts`, `src/stores/settingsStore.ts`, `src/utils/environment.ts`, `src/utils/featureGateForwarding.consistency.test.ts`
- The 30 locale catalogs `src/locales/*/translation.json`, by the key tool (3 keys)

**Interfaces:**
- Consumes: Task 7 (the other bridge user is gone).
- Produces: `SessionConfig = LocalInferenceSessionConfig | LocalNativeSessionConfig`; no `livekit-client` in `package.json` or the lockfile; `environment.ts` gating only Kizuna AI and Local Native.

- [ ] **Step 1: Delete the files.**

  ```
  git rm -q -- src/lib/modern-audio/WebRTCAudioBridge.test.ts src/lib/modern-audio/WebRTCAudioBridge.ts src/services/clients/PalabraAIClient.test.ts src/services/clients/PalabraAIClient.ts src/services/providers/PalabraAIProviderConfig.test.ts src/services/providers/PalabraAIProviderConfig.ts src/services/providers/palabraLanguageCodes.test.ts src/services/worklets/pcm-audio-worklet-processor.js src/stores/palabraAuthModeMigration.test.ts src/stores/palabraLanguageMigration.test.ts
  ```

- [ ] **Step 2: Apply the task's diff blocks** (Global Constraints: never by hand).

  ```
  python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/plan-apply.py docs/superpowers/plans/2026-09-30-client-contract-stage2-deletion.md t08
  ```

  Expected: `t08: 24 files changed`, and no other line.

- [ ] **Step 3: Remove the locale keys only the deleted code read.**

  ```
  node /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/drop-locale-keys.mjs . settings.apiKeyValidated settings.errorValidatingApiKey settings.realtimeTranslationAvailable
  ```

  Expected: `3 keys removed from 30 catalogs`.

- [ ] **Step 4: Check that nothing reaches what went.**

  ```
  git grep -nE "from '[^']*/(PalabraAIClient|PalabraAIProviderConfig|WebRTCAudioBridge)'|isPalabraAIEnabled|VITE_ENABLE_PALABRA_AI|livekit-client|pcm-audio-worklet-processor|until those providers move over|from ProviderConfigFactory's registry" -- src extension electron .github .env.example package.json
  ```

  Expected: exactly this line, a comment that says the flag is gone —

  ```
  src/providers/palabraai/provider.ts:22: * (ruling 14): `VITE_ENABLE_PALABRA_AI` was the old code's, and went with it.
  ```

- [ ] **Step 5: Run the gates.** Each command as its own call; every expected number is the replay's.

  - `npx vitest run src`: **535 files passed and 1 skipped (536); 6 732 tests passed and 2 skipped (6 734)**; 0 failed, no unhandled errors.
  - `npx vitest run electron`: 34 files, 477 tests passed. `npx vitest run extension`: 9 files, 56 tests passed.
  - Local Native's old path: `npx vitest run src/services src/lib/local-inference/native src/components/Settings/sections/Native src/components/Settings/engine/useNativeEngineAdapter src/stores/nativeModelStore src/stores/settingsStore` — 42 files, 674 tests passed.
  - The typecheck, as a set: `npx tsc --noEmit -p tsconfig.json > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t08.txt`, then `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t07.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t08.txt` prints exactly `before 103 after 99; new 0; gone 4` and exits 0 — no error the task before did not have; `after 99` is the full tree's count.
  - `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh | diff - /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` prints nothing: the baseline's 18 lines, unchanged.

- [ ] **Step 6: Commit.**

```bash
git add -- .github/workflows/build.yml extension/vite.config.ts package-lock.json package.json src/components/SetupWizard/SetupWizard.test.tsx src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/steps/StepCredentials.test.tsx src/lib/diagnostics/consoleLedger.consistency.test.ts src/locales/locales.consistency.test.ts src/providers/palabraai/adapter.ts src/providers/palabraai/provider.ts src/providers/palabraai/settings.test.ts src/services/interfaces/IClient.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/participantConfig.test.ts src/services/providers/prepareToStart.local.test.ts src/services/providers/providerOrder.test.ts src/stores/logStore.ts src/stores/settingsStore.sliceRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts src/utils/environment.ts src/utils/featureGateForwarding.consistency.test.ts 'src/locales/*/translation.json'
```

```bash
git commit -q -F - -- src/lib/modern-audio/WebRTCAudioBridge.test.ts src/lib/modern-audio/WebRTCAudioBridge.ts src/services/clients/PalabraAIClient.test.ts src/services/clients/PalabraAIClient.ts src/services/providers/PalabraAIProviderConfig.test.ts src/services/providers/PalabraAIProviderConfig.ts src/services/providers/palabraLanguageCodes.test.ts src/services/worklets/pcm-audio-worklet-processor.js src/stores/palabraAuthModeMigration.test.ts src/stores/palabraLanguageMigration.test.ts .github/workflows/build.yml extension/vite.config.ts package-lock.json package.json src/components/SetupWizard/SetupWizard.test.tsx src/components/SetupWizard/providerPaths.test.ts src/components/SetupWizard/steps/StepCredentials.test.tsx src/lib/diagnostics/consoleLedger.consistency.test.ts src/locales/locales.consistency.test.ts src/providers/palabraai/adapter.ts src/providers/palabraai/provider.ts src/providers/palabraai/settings.test.ts src/services/interfaces/IClient.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/participantConfig.test.ts src/services/providers/prepareToStart.local.test.ts src/services/providers/providerOrder.test.ts src/stores/logStore.ts src/stores/settingsStore.sliceRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts src/utils/environment.ts src/utils/featureGateForwarding.consistency.test.ts 'src/locales/*/translation.json' <<'EOF'
refactor(palabra): delete the old LiveKit client, livekit-client and the bridge

Palabra runs on its WebSocket client and has passed its live test.
Delete the old LiveKit client, descriptor, slice and migrations, the
WebRTC audio bridge and its worklet, the livekit-client dependency and
its pin, the Palabra release flag and the locale keys only the old
client read.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

**The blocks** (`t08`, one per file, in the order the applier takes them):

`.github/workflows/build.yml`

`````diff t08
diff --git a/.github/workflows/build.yml b/.github/workflows/build.yml
--- a/.github/workflows/build.yml
+++ b/.github/workflows/build.yml
@@ -216,7 +216,6 @@ occurrence 1 of 4
           VITE_BACKEND_URL: ${{ vars.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai' }}
           VITE_ENVIRONMENT: production
           VITE_POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
-          VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
@@ -266,7 +265,6 @@ occurrence 2 of 4
           VITE_BACKEND_URL: ${{ vars.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai' }}
           VITE_ENVIRONMENT: production
           VITE_POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
-          VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
@@ -302,7 +300,6 @@ occurrence 3 of 4
           VITE_BACKEND_URL: ${{ vars.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai' }}
           VITE_ENVIRONMENT: production
           VITE_POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
-          VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
@@ -400,7 +397,6 @@ occurrence 4 of 4
           VITE_BACKEND_URL: ${{ vars.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai' }}
           VITE_ENVIRONMENT: production
           VITE_POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
-          VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
@@ -498,7 +494,6 @@
           # Production environment variables for extension
           VITE_BACKEND_URL: ${{ vars.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai' }}
           POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
-          VITE_ENABLE_PALABRA_AI: ${{ vars.VITE_ENABLE_PALABRA_AI }}
           VITE_ENABLE_KIZUNA_AI: ${{ vars.VITE_ENABLE_KIZUNA_AI }}
           VITE_ENABLE_LOCAL_NATIVE: ${{ vars.VITE_ENABLE_LOCAL_NATIVE }}
           VITE_ENABLED_PROVIDERS: ${{ vars.VITE_ENABLED_PROVIDERS }}
`````

`extension/vite.config.ts`

`````diff t08
diff --git a/extension/vite.config.ts b/extension/vite.config.ts
--- a/extension/vite.config.ts
+++ b/extension/vite.config.ts
@@ -74,10 +74,6 @@
           { src: '_locales', dest: '.' },
           { src: 'icons', dest: '.' },
           // Worklets
-          {
-            src: '../src/services/worklets/pcm-audio-worklet-processor.js',
-            dest: 'worklets',
-          },
           {
             src: '../src/services/worklets/audio-recorder-worklet-processor.js',
             dest: 'worklets',
@@ -169,9 +165,6 @@
       'import.meta.env.VITE_ENABLE_KIZUNA_AI': JSON.stringify(
         envVal('VITE_ENABLE_KIZUNA_AI', 'false', 'true')
       ),
-      'import.meta.env.VITE_ENABLE_PALABRA_AI': JSON.stringify(
-        envVal('VITE_ENABLE_PALABRA_AI', 'false')
-      ),
       // The flagged providers a release offers (D19), one comma-separated
       // list. Dev builds offer every flagged provider in code, so there is no
       // dev override here.
`````

`package-lock.json`

`````diff t08
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -53,7 +53,6 @@
         "i18next-browser-languagedetector": "^8.1.0",
         "idb": "^8.0.3",
         "jsdom": "^24.0.0",
-        "livekit-client": "2.18.7",
         "lucide-react": "^0.515.0",
         "mpg123-decoder": "^1.0.3",
         "onnxruntime-web": "1.26.0-dev.20260416-b7804b056c",
@@ -560,13 +559,6 @@
       "dev": true,
       "license": "MIT"
     },
-    "node_modules/@bufbuild/protobuf": {
-      "version": "1.10.1",
-      "resolved": "https://registry.npmjs.org/@bufbuild/protobuf/-/protobuf-1.10.1.tgz",
-      "integrity": "sha512-wJ8ReQbHxsAfXhrf9ixl0aYbZorRuOWpBNzm8pL8ftmSxQx/wnJD5Eg861NwJU/czy2VXFIebCeZnZrI9rktIQ==",
-      "dev": true,
-      "license": "(Apache-2.0 AND BSD-3-Clause)"
-    },
     "node_modules/@csstools/color-helpers": {
       "version": "5.1.0",
       "resolved": "https://registry.npmjs.org/@csstools/color-helpers/-/color-helpers-5.1.0.tgz",
@@ -2860,23 +2852,6 @@
         "node": ">=18"
       }
     },
-    "node_modules/@livekit/mutex": {
-      "version": "1.1.1",
-      "resolved": "https://registry.npmjs.org/@livekit/mutex/-/mutex-1.1.1.tgz",
~ 12 more removed lines sha256:61b2089dbb6d
-      }
-    },
     "node_modules/@malept/cross-spawn-promise": {
       "version": "2.0.0",
       "resolved": "https://registry.npmjs.org/@malept/cross-spawn-promise/-/cross-spawn-promise-2.0.0.tgz",
@@ -9539,27 +9514,6 @@
         "url": "https://github.com/chalk/wrap-ansi?sponsor=1"
       }
     },
-    "node_modules/livekit-client": {
-      "version": "2.18.7",
-      "resolved": "https://registry.npmjs.org/livekit-client/-/livekit-client-2.18.7.tgz",
~ 16 more removed lines sha256:ea3dd2546c90
-      }
-    },
     "node_modules/load-json-file": {
       "version": "2.0.0",
       "resolved": "https://registry.npmjs.org/load-json-file/-/load-json-file-2.0.0.tgz",
@@ -9833,20 +9787,6 @@
         "url": "https://github.com/chalk/wrap-ansi?sponsor=1"
       }
     },
-    "node_modules/loglevel": {
-      "version": "1.9.2",
-      "resolved": "https://registry.npmjs.org/loglevel/-/loglevel-1.9.2.tgz",
~ 9 more removed lines sha256:d531e7dc6c93
-      }
-    },
     "node_modules/long": {
       "version": "5.3.2",
       "resolved": "https://registry.npmjs.org/long/-/long-5.3.2.tgz",
@@ -12171,23 +12111,6 @@
         "ajv": "^8.8.2"
       }
     },
-    "node_modules/sdp": {
-      "version": "3.2.2",
-      "resolved": "https://registry.npmjs.org/sdp/-/sdp-3.2.2.tgz",
~ 12 more removed lines sha256:fef4930ce40d
-      }
-    },
     "node_modules/semver": {
       "version": "7.8.1",
       "resolved": "https://registry.npmjs.org/semver/-/semver-7.8.1.tgz",
@@ -13136,16 +13059,6 @@
         "url": "https://github.com/sponsors/sindresorhus"
       }
     },
-    "node_modules/typed-emitter": {
-      "version": "2.1.0",
-      "resolved": "https://registry.npmjs.org/typed-emitter/-/typed-emitter-2.1.0.tgz",
-      "integrity": "sha512-g/KzbYKbH5C2vPkaXGu8DJlHrGKHLsM25Zg9WuC9pMGfuvT+X25tZQWo5fK1BjBm8+UrVE9LDCvaY0CQk+fXDA==",
-      "dev": true,
-      "license": "MIT",
-      "optionalDependencies": {
-        "rxjs": "*"
-      }
-    },
     "node_modules/typescript": {
       "version": "5.9.3",
       "resolved": "https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz",
@@ -13692,20 +13605,6 @@
         "node": ">= 0.6"
       }
     },
-    "node_modules/webrtc-adapter": {
-      "version": "9.0.5",
-      "resolved": "https://registry.npmjs.org/webrtc-adapter/-/webrtc-adapter-9.0.5.tgz",
~ 9 more removed lines sha256:66f130b0592e
-      }
-    },
     "node_modules/whatwg-encoding": {
       "version": "3.1.1",
       "resolved": "https://registry.npmjs.org/whatwg-encoding/-/whatwg-encoding-3.1.1.tgz",
`````

`package.json`

`````diff t08
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -178,7 +178,6 @@
     "i18next-browser-languagedetector": "^8.1.0",
     "idb": "^8.0.3",
     "jsdom": "^24.0.0",
-    "livekit-client": "2.18.7",
     "lucide-react": "^0.515.0",
     "mpg123-decoder": "^1.0.3",
     "onnxruntime-web": "1.26.0-dev.20260416-b7804b056c",
`````

`src/components/SetupWizard/SetupWizard.test.tsx`

`````diff t08
diff --git a/src/components/SetupWizard/SetupWizard.test.tsx b/src/components/SetupWizard/SetupWizard.test.tsx
--- a/src/components/SetupWizard/SetupWizard.test.tsx
+++ b/src/components/SetupWizard/SetupWizard.test.tsx
@@ -4,7 +4,7 @@
 vi.mock('../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
-  isPalabraAIEnabled: () => true, isLocalNativeEnabled: () => true,
+  isLocalNativeEnabled: () => true,
   isElectron: () => true, isExtension: () => false,
 }));
 // The detected interface language, as i18next reports it. Mutable so a test can
`````

`src/components/SetupWizard/providerPaths.test.ts`

`````diff t08
diff --git a/src/components/SetupWizard/providerPaths.test.ts b/src/components/SetupWizard/providerPaths.test.ts
--- a/src/components/SetupWizard/providerPaths.test.ts
+++ b/src/components/SetupWizard/providerPaths.test.ts
@@ -3,7 +3,6 @@
 vi.mock('../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
-  isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
`````

`src/components/SetupWizard/steps/StepCredentials.test.tsx`

`````diff t08
diff --git a/src/components/SetupWizard/steps/StepCredentials.test.tsx b/src/components/SetupWizard/steps/StepCredentials.test.tsx
--- a/src/components/SetupWizard/steps/StepCredentials.test.tsx
+++ b/src/components/SetupWizard/steps/StepCredentials.test.tsx
@@ -4,7 +4,7 @@
 vi.mock('../../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
-  isPalabraAIEnabled: () => true, isLocalNativeEnabled: () => true,
+  isLocalNativeEnabled: () => true,
   isElectron: () => true, isExtension: () => false,
 }));
 // Keys, not defaults: the field label's default is the slice key itself, which
`````

`src/lib/diagnostics/consoleLedger.consistency.test.ts`

`````diff t08
diff --git a/src/lib/diagnostics/consoleLedger.consistency.test.ts b/src/lib/diagnostics/consoleLedger.consistency.test.ts
--- a/src/lib/diagnostics/consoleLedger.consistency.test.ts
+++ b/src/lib/diagnostics/consoleLedger.consistency.test.ts
@@ -193,7 +193,6 @@
   // rewrote the overlay page over the wire; its one failure (no #root) reports
   // through report.ts.
   // --- Later, under the ledger: src/lib (audio pipeline and helpers) ---
-  'src/lib/modern-audio/WebRTCAudioBridge.ts': 10,
   'src/lib/modern-audio/AppAudioRecorder.ts': 9,
   'src/lib/modern-audio/ModernAudioRecorder.ts': 8,
   'src/lib/analytics.ts': 6,
`````

`src/locales/locales.consistency.test.ts`

`````diff t08
diff --git a/src/locales/locales.consistency.test.ts b/src/locales/locales.consistency.test.ts
--- a/src/locales/locales.consistency.test.ts
+++ b/src/locales/locales.consistency.test.ts
@@ -4,7 +4,6 @@
 vi.mock('../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
-  isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
`````

`src/providers/palabraai/adapter.ts`

`````diff t08
diff --git a/src/providers/palabraai/adapter.ts b/src/providers/palabraai/adapter.ts
--- a/src/providers/palabraai/adapter.ts
+++ b/src/providers/palabraai/adapter.ts
@@ -1,8 +1,8 @@
 /**
  * Palabra AI on the new contract (spec: "L0 — the client contract"),
  * written from scratch over WebSocket — the old LiveKit client
- * (`src/services/clients/PalabraAIClient.ts`, still compiled until the
- * deletion plan) is not ported (the owner, 2026-09-29). One leg, one socket.
+ * (`src/services/clients/PalabraAIClient.ts`, deleted since) is not
+ * ported (the owner, 2026-09-29). One leg, one socket.
  * The platform key dials the streaming endpoint straight; the legacy app
  * pair first creates a REST session and dials its address with the
  * publisher token, and deletes that session — its own, no other — when the
`````

`src/providers/palabraai/provider.ts`

`````diff t08
diff --git a/src/providers/palabraai/provider.ts b/src/providers/palabraai/provider.ts
--- a/src/providers/palabraai/provider.ts
+++ b/src/providers/palabraai/provider.ts
@@ -19,7 +19,7 @@
  * and its socket takes its credential in the query, so it runs on every
  * platform, and the extension's CSP already lists `*.palabra.ai`: no
  * manifest or background change. Released last, after Soniox, unflagged
- * (ruling 14): `VITE_ENABLE_PALABRA_AI` is the old code's, and goes with it.
+ * (ruling 14): `VITE_ENABLE_PALABRA_AI` was the old code's, and went with it.
  */
 export const palabraProvider: Provider<PalabraSettings, PalabraCredentials, PalabraConfig> & { id: 'palabraai' } = {
   id: 'palabraai',
`````

`src/providers/palabraai/settings.test.ts`

`````diff t08
diff --git a/src/providers/palabraai/settings.test.ts b/src/providers/palabraai/settings.test.ts
--- a/src/providers/palabraai/settings.test.ts
+++ b/src/providers/palabraai/settings.test.ts
@@ -24,7 +24,7 @@
 ];
 const DOC_HIDDEN_TARGETS = ['en-au', 'en-ca', 'zh'];
 
-/** The API's own validator enums, captured from a VALIDATION_ERROR's `desc` on 2026-07-30 (`palabraLanguageCodes.test.ts`, which leaves with the old code). */
+/** The API's own validator enums, captured from a VALIDATION_ERROR's `desc` on 2026-07-30 (`palabraLanguageCodes.test.ts`, which left with the old code). */
 const API_SOURCE_LANGUAGES = new Set([
   'af', 'am', 'ar', 'as', 'auto', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'ceb', 'cs', 'cy', 'da', 'de', 'el', 'en', 'es', 'et', 'eu', 'fa', 'fi', 'fil', 'fr', 'ga', 'gl', 'gu',
   'ha', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'ig', 'is', 'it', 'ja', 'jv', 'ka', 'kk', 'km', 'kn', 'ko', 'ku', 'ky', 'lb', 'lg', 'ln', 'lo', 'lt', 'lv', 'mi', 'mk', 'ml',
`````

`src/services/interfaces/IClient.ts`

`````diff t08
diff --git a/src/services/interfaces/IClient.ts b/src/services/interfaces/IClient.ts
--- a/src/services/interfaces/IClient.ts
+++ b/src/services/interfaces/IClient.ts
@@ -73,22 +73,6 @@
   keepReplayAudio?: boolean;
 }
 
-/**
- * PalabraAI-specific session configuration
- */
~ 11 more removed lines sha256:2352f81a1834
-}
-
 /**
  * Local inference session configuration
  */
@@ -152,15 +136,11 @@
 /**
  * Union type for all possible session configurations
  */
-export type SessionConfig = PalabraAISessionConfig | LocalInferenceSessionConfig | LocalNativeSessionConfig;
+export type SessionConfig = LocalInferenceSessionConfig | LocalNativeSessionConfig;
 
 /**
  * Type guards for session configurations
  */
-export function isPalabraAISessionConfig(config: SessionConfig): config is PalabraAISessionConfig {
-  return config.provider === 'palabraai';
-}
-
 export function isLocalInferenceSessionConfig(config: SessionConfig): config is LocalInferenceSessionConfig {
   return config.provider === 'local_inference';
 }
`````

`src/services/providers/ProviderConfigFactory.ts`

`````diff t08
diff --git a/src/services/providers/ProviderConfigFactory.ts b/src/services/providers/ProviderConfigFactory.ts
--- a/src/services/providers/ProviderConfigFactory.ts
+++ b/src/services/providers/ProviderConfigFactory.ts
@@ -1,10 +1,9 @@
 import { ProviderConfig } from './ProviderConfig';
 import { ProviderDescriptor } from './ProviderDescriptor';
-import { PalabraAIProviderConfig } from './PalabraAIProviderConfig';
 import { LocalInferenceProviderConfig } from './LocalInferenceProviderConfig';
 import { LocalNativeProviderConfig } from './LocalNativeProviderConfig';
 import { Provider, ProviderType } from '../../types/Provider';
-import { isPalabraAIEnabled, isLocalNativeEnabled, isElectron } from '../../utils/environment';
+import { isLocalNativeEnabled, isElectron } from '../../utils/environment';
 
 export class ProviderConfigFactory {
   private static configs: Map<ProviderType, ProviderDescriptor> = new Map();
@@ -20,11 +19,6 @@
     // 2. Free (local inference) — always available, no API key or flag.
     ProviderConfigFactory.configs.set(Provider.LOCAL_INFERENCE, new LocalInferenceProviderConfig());
 
-    // 8. Palabra AI — behind its feature flag.
-    if (isPalabraAIEnabled()) {
-      ProviderConfigFactory.configs.set(Provider.PALABRA_AI, new PalabraAIProviderConfig());
-    }
-
     // 9. Everything else.
     // Native (Electron sidecar) local inference — Electron only, behind feature flag.
     if (isElectron() && isLocalNativeEnabled()) {
`````

`src/services/providers/descriptorRegistry.test.ts`

`````diff t08
diff --git a/src/services/providers/descriptorRegistry.test.ts b/src/services/providers/descriptorRegistry.test.ts
--- a/src/services/providers/descriptorRegistry.test.ts
+++ b/src/services/providers/descriptorRegistry.test.ts
@@ -1,11 +1,8 @@
 import { describe, it, expect, vi } from 'vitest';
-// Force the remaining provider gates on — Kizuna/Palabra/Local-Native feature
-// flags plus Electron/Extension platform detection — so ALL descriptors register
-// regardless of build env.
+// Force the Local Native gate on, plus Electron platform detection, so every
+// descriptor registers regardless of build env.
 vi.mock('../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
-  isKizunaAIEnabled: () => true,
-  isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
@@ -15,7 +12,6 @@
 import type { SegmentationOffer } from '../../lib/segmentation/segmentationMode';
 import { DEFAULT_CHUNK_SENTENCES } from '../../lib/segmentation/segmentationMode';
 import { Provider } from '../../types/Provider';
-import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
 import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
 import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
 import en from '../../locales/en/translation.json';
@@ -23,7 +19,6 @@
 // Map each provider's settingsSliceKey to its per-module default settings slice,
 // so buildSessionConfig can be exercised for every registered provider.
 const DEFAULTS_BY_SLICE: Record<string, unknown> = {
-  palabraai: defaultPalabraAISettings,
   localInference: defaultLocalInferenceSettings,
   localNative: defaultLocalNativeSettings,
 };
@@ -31,7 +26,7 @@
 describe('provider registry descriptors', () => {
   it('returns a descriptor for every available provider', () => {
     const ids = ProviderConfigFactory.getAvailableProviders();
-    expect(ids.length).toBe(3);
+    expect(ids.length).toBe(2);
     for (const id of ids) {
       const d = ProviderConfigFactory.getDescriptor(id);
       expect(d.getConfig().id).toBe(id);
@@ -58,34 +53,7 @@
   });
 });
 
-describe('descriptor.validateAndFetchModels', () => {
-  it('rejects incomplete credentials with the provider-specific message', async () => {
-    const d = ProviderConfigFactory.getDescriptor(Provider.PALABRA_AI);
-    const r = await d.validateAndFetchModels({ ok: false, missing: 'Both Client ID and Client Secret are required for Palabra AI' });
-    expect(r.validation.valid).toBe(false);
-    expect(r.validation.message).toMatch(/Client ID and Client Secret/);
-    expect(r.models).toEqual([]);
-  });
-
-});
-
 describe('descriptor.extractCredentials', () => {
-  it('normalizes each provider credential shape', async () => {
-    const cases: Array<[Provider, object, { primary: string; secret?: string; endpoint?: string }]> = [
-      [Provider.PALABRA_AI, { clientId: 'id', clientSecret: 'sec' }, { primary: 'id', secret: 'sec' }],
~ 11 more removed lines sha256:1c0846747eed
-  });
-
   it('local inference needs no credentials', async () => {
     expect(await ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE).extractCredentials({}, {}))
       .toEqual({ ok: true, primary: '' });
@@ -95,7 +63,6 @@
 describe('descriptor.buildSessionConfig', () => {
   it('builds a config whose provider tag matches, for every provider, from defaults', () => {
     const wireTag: Record<string, string> = {
-      palabraai: 'palabraai',
       local_inference: 'local_inference',
       local_native: 'local_native',
     };
@@ -139,7 +106,6 @@
   // deletion, ruling C1), so every table below names only the providers the
   // old registry still registers.
   const EXPECTED_SLICE_KEYS: Partial<Record<Provider, string>> = {
-    [Provider.PALABRA_AI]: 'palabraai',
     [Provider.LOCAL_INFERENCE]: 'localInference',
     // Registered only under Electron with its gate on — both forced on by
     // this file's environment mock.
@@ -156,7 +122,6 @@
   // Exact expected supportsWebRTC per provider. Relay/twin and non-WebRTC
   // providers must not silently inherit `true` from a base descriptor.
   const EXPECTED_SUPPORTS_WEBRTC: Partial<Record<Provider, boolean>> = {
-    [Provider.PALABRA_AI]: false,
     [Provider.LOCAL_INFERENCE]: false,
     [Provider.LOCAL_NATIVE]: false,
   };
@@ -191,13 +156,11 @@
   const PUSH_GATED: Partial<Record<Provider, string[] | undefined>> = {
     [Provider.LOCAL_INFERENCE]: ['Push-to-Talk', 'Push-to-Translate'],
     [Provider.LOCAL_NATIVE]: ['Push-to-Talk', 'Push-to-Translate'],
-    [Provider.PALABRA_AI]: undefined,
   };
 
   const TEXT_INPUT: Partial<Record<Provider, boolean | undefined>> = {
     [Provider.LOCAL_INFERENCE]: true,
     [Provider.LOCAL_NATIVE]: true,
-    [Provider.PALABRA_AI]: undefined,
   };
 
   const QUEUES_TEXT: Provider[] = [];
@@ -206,7 +169,6 @@
   const PTT_FINALIZATION: Partial<Record<Provider, { silenceTailFrames?: number; response: string } | undefined>> = {
     [Provider.LOCAL_INFERENCE]: { silenceTailFrames: 7, response: 'always' },
     [Provider.LOCAL_NATIVE]: { silenceTailFrames: 7, response: 'always' },
-    [Provider.PALABRA_AI]: undefined,
   };
 
   // The segmentation offer of every provider, resolved — the default already
@@ -218,11 +180,6 @@
     // and the stage only fills the punctuation in.
     [Provider.LOCAL_INFERENCE]: { pause: false, auto: true, sizes: true },
     [Provider.LOCAL_NATIVE]: { pause: false, auto: true, sizes: true },
-
-    // A server decides the outer boundary, and phase 2 can cut inside it.
-    // Palabra writes text only. Auto stays what it always was — keep the
-    // server's segment.
-    [Provider.PALABRA_AI]: { pause: false, auto: true, sizes: true },
   };
 
   const DEFAULT_OFFER: SegmentationOffer = { pause: false, auto: true, sizes: false };
@@ -233,7 +190,6 @@
   // without turn detection it renders nothing and must not claim to. A2 moved
   // the two pause clients' sliders into the segmentation section.
   const SILENCE_DURATION: Partial<Record<Provider, boolean>> = {
-    [Provider.PALABRA_AI]: false,
     [Provider.LOCAL_INFERENCE]: false,
     [Provider.LOCAL_NATIVE]: false,
   };
@@ -345,14 +301,10 @@
     }
   });
 
-  it('forcedTransport only on PalabraAI, and it names a real transport', () => {
+  it('declares no forcedTransport: Palabra, the one that did, went with its old code', () => {
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
       const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
-      if (id === Provider.PALABRA_AI) {
-        expect(caps.forcedTransport, `forcedTransport for ${id}`).toBe('webrtc');
-      } else {
-        expect(caps.forcedTransport, `no forcedTransport for ${id}`).toBeUndefined();
-      }
+      expect(caps.forcedTransport, `no forcedTransport for ${id}`).toBeUndefined();
     }
   });
 });
@@ -377,33 +329,6 @@
   // façades accept raw positional args — they must keep the old contract of
   // rejecting incomplete credentials instead of reaching provider clients
   // with `secret: undefined`.
-  // PalabraAI is no longer a synchronous two-field guard: a missing `secret` is
-  // the documented signal for platform-mode (API key) credentials (see
-  // PalabraAIProviderConfig.toPalabraCredentials), so a legacy caller passing
~ 22 more removed lines sha256:7821fa37dd14
-  });
-
   it('ClientFactory.createClient rejects an empty apiKey for credentialed providers', async () => {
     const { ClientFactory } = await import('../clients/ClientFactory');
     expect(() => ClientFactory.createClient('m', Provider.PALABRA_AI, ''))
`````

`src/services/providers/participantConfig.test.ts`

`````diff t08
diff --git a/src/services/providers/participantConfig.test.ts b/src/services/providers/participantConfig.test.ts
--- a/src/services/providers/participantConfig.test.ts
+++ b/src/services/providers/participantConfig.test.ts
@@ -3,7 +3,6 @@
 vi.mock('../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
-  isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
@@ -16,7 +15,6 @@
 
 import { ProviderConfigFactory } from './ProviderConfigFactory';
 import { Provider } from '../../types/Provider';
-import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
 import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
 import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
 import { createParticipantLocalInferenceConfig, createParticipantLocalNativeConfig } from './localParticipantConfig';
@@ -55,44 +53,6 @@
   ttsVariant: 'int8',
 } as unknown as LocalNativeSessionConfig;
 
-describe('participant config: direction lives in config fields', () => {
-  it('palabraai swaps sourceLanguage/targetLanguage', () => {
-    const d = ProviderConfigFactory.getDescriptor(Provider.PALABRA_AI);
~ 33 more removed lines sha256:954d3d496025
-});
-
 describe('participant config: local providers (mocked helpers)', () => {
   beforeEach(() => {
     mockedLocalInference.mockReset();
`````

`src/services/providers/prepareToStart.local.test.ts`

`````diff t08
diff --git a/src/services/providers/prepareToStart.local.test.ts b/src/services/providers/prepareToStart.local.test.ts
--- a/src/services/providers/prepareToStart.local.test.ts
+++ b/src/services/providers/prepareToStart.local.test.ts
@@ -3,7 +3,6 @@
 vi.mock('../../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
-  isPalabraAIEnabled: () => true,
   isLocalNativeEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
`````

`src/services/providers/providerOrder.test.ts`

`````diff t08
diff --git a/src/services/providers/providerOrder.test.ts b/src/services/providers/providerOrder.test.ts
--- a/src/services/providers/providerOrder.test.ts
+++ b/src/services/providers/providerOrder.test.ts
@@ -9,7 +9,6 @@
   vi.doMock('../../utils/environment', async (orig) => ({
     ...(await orig<any>()),
     isKizunaAIEnabled: () => true,
-    isPalabraAIEnabled: () => true,
     isLocalNativeEnabled: () => true,
     isElectron: () => true,
     isExtension: () => false,
@@ -32,7 +31,6 @@
 
     expect(ids).toEqual([
       Provider.LOCAL_INFERENCE,
-      Provider.PALABRA_AI,
       Provider.LOCAL_NATIVE,
     ]);
   });
@@ -45,7 +43,6 @@
     vi.doMock('../../utils/environment', async (orig) => ({
       ...(await orig<any>()),
       isKizunaAIEnabled: () => false,
-      isPalabraAIEnabled: () => false,
       isLocalNativeEnabled: () => false,
       isElectron: () => false,
       isExtension: () => false,
`````

`src/stores/logStore.ts`

`````diff t08
diff --git a/src/stores/logStore.ts b/src/stores/logStore.ts
--- a/src/stores/logStore.ts
+++ b/src/stores/logStore.ts
@@ -63,20 +63,6 @@
     // session.close handshake
     | 'session.start' | 'session.close'
     | 'session.connection_lost'
-    // PalabraAI-specific request types (client → server)
-    | 'set_task'
-    | 'end_task'
~ 9 more removed lines sha256:9173733b86e5
-    | 'output_audio_data'
-    | 'current_task'
     // Sentence segmentation stage — diagnostics only, counts and durations,
     // never transcript text. They ride the events stream (which LogsPanel shows
     // and 'copy logs' exports) rather than the plain error/warning entries
@@ -403,39 +389,6 @@
       else if (eventType === 'transcription.partial' || eventType === 'translation.partial' || eventType === 'audio.output') {
         groupingKey = eventType;
       }
-      // PalabraAI-specific grouping (the old client's names; they go with it)
-      else if (eventType === 'partial_transcription') {
-        // Group PalabraAI partial transcription events together
~ 28 more removed lines sha256:672b4d864c4a
-        groupingKey = 'palabraai_current_task';
-      }
       // Doubao AST 2.0's grouping: the adapter's `domain.event` frames, under
       // the keys its old client's names had (Stage 2 Volcengine AST2,
       // choice 9).
`````

`src/stores/settingsStore.sliceRegistry.test.ts`

`````diff t08
diff --git a/src/stores/settingsStore.sliceRegistry.test.ts b/src/stores/settingsStore.sliceRegistry.test.ts
--- a/src/stores/settingsStore.sliceRegistry.test.ts
+++ b/src/stores/settingsStore.sliceRegistry.test.ts
@@ -28,7 +28,6 @@
 
 /** action name → [sliceKey, sample patch] for the plain (no-special-case) slices */
 const PLAIN: Array<[string, string, Record<string, unknown>]> = [
-  ['updatePalabraAI', 'palabraai', { clientId: 'c1' }],
   ['updateLocalInference', 'localInference', { ttsSpeed: 1.5 }],
   ['updateLocalNative', 'localNative', { sourceLanguage: 'ja' }],
 ];
@@ -63,7 +62,6 @@
   // resolves, and the failure becomes one panel entry per key. Both failure
   // channels are exercised because the service can produce either.
   const ALL_SLICES: Array<[string, string, Record<string, unknown>]> = [
-    ['updatePalabraAI', 'palabraai', { clientId: 'x' }],
     ['updateLocalInference', 'localInference', { ttsSpeed: 1.5 }],
     ['updateLocalNative', 'localNative', { sourceLanguage: 'ja' }],
   ];
@@ -115,7 +113,7 @@
     const s = useSettingsStore.getState() as any;
     // Spot every slice key is a populated object after load.
     for (const sliceKey of [
-      'palabraai', 'localInference', 'localNative',
+      'localInference', 'localNative',
     ]) {
       expect(s[sliceKey], sliceKey).toBeTypeOf('object');
       expect(Object.keys(s[sliceKey]).length, sliceKey).toBeGreaterThan(0);
`````

`src/stores/settingsStore.test.ts`

`````diff t08
diff --git a/src/stores/settingsStore.test.ts b/src/stores/settingsStore.test.ts
--- a/src/stores/settingsStore.test.ts
+++ b/src/stores/settingsStore.test.ts
@@ -11,7 +11,6 @@
 vi.mock('../utils/environment', async (orig) => ({
   ...(await orig<any>()),
   isKizunaAIEnabled: () => true,
-  isPalabraAIEnabled: () => true,
   isElectron: () => true,
   isExtension: () => false,
 }));
`````

`src/stores/settingsStore.ts`

`````diff t08
diff --git a/src/stores/settingsStore.ts b/src/stores/settingsStore.ts
--- a/src/stores/settingsStore.ts
+++ b/src/stores/settingsStore.ts
@@ -29,9 +29,6 @@
 import {ApiKeyValidationResult} from '../services/interfaces/ISettingsService';
 import {Provider, ProviderType} from '../types/Provider';
 import i18n from '../locales';
-import {
-  PalabraAISettings, defaultPalabraAISettings,
-} from '../services/providers/PalabraAIProviderConfig';
 import {
   LocalInferenceSettings, defaultLocalInferenceSettings,
 } from '../services/providers/LocalInferenceProviderConfig';
@@ -57,14 +54,12 @@
 }
 
 export type {
-  PalabraAISettings,
   LocalInferenceSettings, LocalNativeSettings,
 };
 
 // Union of every provider's settings slice — the return type of
 // getCurrentProviderSettings, resolved dynamically via the active descriptor.
 export type ProviderSettingsUnion =
-  | PalabraAISettings
   | LocalInferenceSettings | LocalNativeSettings;
 
 // ==================== Type Definitions ====================
@@ -249,7 +244,6 @@
   participantSystemInstructions: string;
 
   // Provider-specific settings
-  palabraai: PalabraAISettings;
   localInference: LocalInferenceSettings;
   localNative: LocalNativeSettings;
 
@@ -365,7 +359,6 @@
   setParticipantSystemInstructions: (instructions: string) => void;
 
   // Provider settings actions
-  updatePalabraAI: (settings: Partial<PalabraAISettings>) => void;
   updateLocalInference: (settings: Partial<LocalInferenceSettings>) => void;
   updateLocalNative: (settings: Partial<LocalNativeSettings>) => void;
   /** Generic slice update keyed by descriptor.settingsSliceKey — the write
@@ -395,46 +388,6 @@
 
 // ==================== Helper Functions ====================
 
-/** Migrate persisted PalabraAI language codes that the API rejects.
- *  Palabra validates source_language and target_language against two separate
- *  enums, and a code outside them fails the whole set_task — the session connects
~ 35 more removed lines sha256:706d9b620a9e
-}
-
 /**
  * Resolve the worker type for a specific translation model id.
  * Returns 'opus-mt' when the id is missing or not in the manifest.
@@ -485,7 +438,6 @@
 };
 
 const PROVIDER_SLICE_REGISTRY = {
-  palabraai: { defaults: defaultPalabraAISettings },
   localInference: { defaults: defaultLocalInferenceSettings },
   localNative: { defaults: defaultLocalNativeSettings },
 } satisfies Record<string, SliceUpdateSpec>;
@@ -518,7 +470,6 @@
   subscribeWithSelector((set, get) => ({
     // === Initial State ===
     ...defaultCommonSettings,
-    palabraai: defaultPalabraAISettings,
     localInference: defaultLocalInferenceSettings,
     localNative: defaultLocalNativeSettings,
 
@@ -745,7 +696,6 @@
     },
 
     // === Provider Settings Actions ===
-    updatePalabraAI: (settings) => updateProviderSlice(set, 'palabraai', settings),
     updateLocalInference: (settings) => updateProviderSlice(set, 'localInference', settings),
     updateLocalNative: (settings) => updateProviderSlice(set, 'localNative', settings),
     updateProviderSlice: (sliceKey, patch) => {
@@ -974,17 +924,6 @@
           ] as const),
         )) as Partial<SettingsStore>;
 
-        // Drop persisted PalabraAI language codes the API rejects, so an existing
-        // user isn't left on a pair whose set_task fails validation.
-        const palabraSlice = loadedSlices.palabraai as PalabraAISettings | undefined;
-        if (palabraSlice) {
-          Object.assign(palabraSlice, migrateRejectedPalabraLanguages(palabraSlice));
-          // authMode predates some persisted slices; probe the raw stored value so a
-          // default-injected 'platform' isn't mistaken for a user choice.
-          const storedAuthMode = await service.getSetting('settings.palabraai.authMode', '');
-          Object.assign(palabraSlice, migratePalabraAuthMode(storedAuthMode, palabraSlice));
-        }
-
         set({
           provider: validProvider,
           uiLanguage,
@@ -1155,7 +1094,6 @@
 export const useParticipantSystemInstructions = () => useSettingsStore((state) => state.participantSystemInstructions);
 
 // Provider settings
-export const usePalabraAISettings = () => useSettingsStore((state) => state.palabraai);
 export const useLocalInferenceSettings = () => useSettingsStore((state) => state.localInference);
 export const useLocalNativeSettings = () => useSettingsStore((state) => state.localNative);
 
@@ -1215,7 +1153,6 @@
 export const useSetUseTemplateMode = () => useSettingsStore((state) => state.setUseTemplateMode);
 export const useSetParticipantSystemInstructions = () => useSettingsStore((state) => state.setParticipantSystemInstructions);
 
-export const useUpdatePalabraAI = () => useSettingsStore((state) => state.updatePalabraAI);
 export const useUpdateLocalInference = () => useSettingsStore((state) => state.updateLocalInference);
 export const useUpdateLocalNative = () => useSettingsStore((state) => state.updateLocalNative);
 
`````

`src/utils/environment.ts`

`````diff t08
diff --git a/src/utils/environment.ts b/src/utils/environment.ts
--- a/src/utils/environment.ts
+++ b/src/utils/environment.ts
@@ -142,8 +142,9 @@
  * Uses Vite's `DEV` flag (true whenever the build is not a production
  * build/serve) rather than comparing `MODE` to the literal string
  * 'development' — vitest runs with MODE === 'test', which must count as
- * "development" here or every feature-flagged provider silently vanishes
- * from ProviderConfigFactory's registry in any unmocked test.
+ * "development" here or, in any unmocked test, every flagged provider
+ * silently leaves the registry's offer (`isPresent`) and Local Native the
+ * old registry.
  * Extension builds rely on `extension/vite.config.ts` explicitly defining
  * `import.meta.env.DEV` as `mode === 'development'`, so `DEV` stays
  * equivalent to the old MODE check there too.
@@ -178,23 +179,6 @@
   return import.meta.env.VITE_ENABLE_KIZUNA_AI === 'true';
 }
 
-/**
- * Check if Palabra AI features should be enabled
- * @returns true if Palabra AI features should be shown
~ 12 more removed lines sha256:54e98fe8ee83
-}
-
 /**
  * Tester switch for the Local Native provider in packaged builds (temporary, 2026-09).
  *
@@ -239,8 +223,9 @@
 /**
  * The flagged providers a release offers (D19): `VITE_ENABLED_PROVIDERS`, a
  * comma-separated list of provider ids. It gates providers in the new
- * registry (`src/providers/registry.ts`) only; the per-provider gates above
- * keep gating `ProviderConfigFactory` until those providers move over.
+ * registry (`src/providers/registry.ts`) only. The old registry's one gate
+ * left, `isLocalNativeEnabled` above, gates Local Native's old path (Stage 2
+ * deletion, rulings 1 and 6).
  * Development builds offer every flagged provider regardless (see
  * `isPresent`).
  */
`````

`src/utils/featureGateForwarding.consistency.test.ts`

`````diff t08
diff --git a/src/utils/featureGateForwarding.consistency.test.ts b/src/utils/featureGateForwarding.consistency.test.ts
--- a/src/utils/featureGateForwarding.consistency.test.ts
+++ b/src/utils/featureGateForwarding.consistency.test.ts
@@ -42,7 +42,7 @@
   // Guards the derivation itself: if the regex ever stops matching, every
   // assertion below would vacuously pass over an empty set.
   it('finds the gates environment.ts reads', () => {
-    expect(GATES.length).toBeGreaterThanOrEqual(4);
+    expect(GATES.length).toBeGreaterThanOrEqual(3);
     expect(GATES).toContain('VITE_ENABLE_KIZUNA_AI');
     expect(GATES).toContain('VITE_ENABLED_PROVIDERS');
   });
`````

---

### Wave 2 check (controller)

After Task 8: the full gates — `npx vitest run src` at 535 + 1 files and 6 732 + 2 tests, 0 failed, no unhandled errors; `npx vitest run electron` 34 / 477; `npx vitest run extension` 9 / 56; the gate equal to `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` (18 lines); `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t00.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t08.txt` reports `new 0` and `after 99`. Then `git log --oneline -3` shows the wave's commits, one per task, and `git status --short` shows nothing of this plan's.

---

### Task 9: LocalInference's old leftovers (Wave 3)

LocalInference was Stage 1's provider; its old client, descriptor and slice stayed compiled for its three shared components' fallback. Every mount passes the new provider's own `S`, `update` and pair (`LocalInferenceEngine`, from both Settings layouts), so the fallback is dead (ruling 3).

**What goes, and what changes:**
- **The three components take their props required:** `useWasmEngineAdapter(isSessionActive, override)`; `ModelManagementSection`'s `settings`, `update`, `pair`; `StoragePage`'s `wasm` half `{ settings, pair }` (it never wrote selections). Their tests pass them (`useHeldAdapter`, the `WASM` fixture, `slice()`).
- `LocalInferenceClient.ts` and its test, `LocalInferenceProviderConfig.ts`; the registration; `IClient.ts`' LocalInference config; `ClientFactory.ts`' `LOCAL_INFERENCE` exemption; `localParticipantConfig.ts`' `createParticipantLocalInferenceConfig` and its memory budget (Local Native's half stays); `modelStore.ts`' `ensureSelectionReady`, `lastResolutionNotes` and `useLastResolutionNotes`, which only the old arm and the old shell's LocalInference branch used; `settingsStore.ts`' `localInference` slice, `updateLocalInference`, its `validateApiKey` arm and the local prompt's LocalInference branch; `astGuard.ts`' header, which named those callers as present (choice 3).
- Tests of the deleted code: `ensureSelectionReady.test.ts`, `settingsStore.providerSettings.test.tsx`, `providerOrder.test.ts` (Local Native's position alone was left), `modelStore.test.ts`' and `astGuard.test.ts`' old-arm cases, `SettingsInitializer.test.tsx`' single-writer case (ruling 11 of plan 1e-3b-2: the slice it guarded is gone); `nativeModelStore.test.ts` loses one assertion on the deleted slice.
- One key: `mainPanel.speechDetected`.
- `languageName.ts`' comment, which cited `LocalInferenceProviderConfig.ts` and "every provider descriptor" as present (choice 3).

**Files:**
- Delete (6): `src/services/clients/LocalInferenceClient.test.ts`, `src/services/clients/LocalInferenceClient.ts`, `src/services/providers/LocalInferenceProviderConfig.ts`, `src/services/providers/providerOrder.test.ts`, `src/stores/ensureSelectionReady.test.ts`, `src/stores/settingsStore.providerSettings.test.tsx`
- Modify (25, by the blocks below): `src/components/Settings/engine/StoragePage.test.tsx`, `src/components/Settings/engine/StoragePage.tsx`, `src/components/Settings/engine/languageName.ts`, `src/components/Settings/engine/useWasmEngineAdapter.test.ts`, `src/components/Settings/engine/useWasmEngineAdapter.ts`, `src/components/Settings/sections/ModelManagementSection.test.tsx`, `src/components/Settings/sections/ModelManagementSection.tsx`, `src/components/SettingsInitializer/SettingsInitializer.test.tsx`, `src/components/SetupWizard/SetupWizard.test.tsx`, `src/services/clients/ClientFactory.ts`, `src/services/interfaces/IClient.ts`, `src/services/providers/ProviderConfigFactory.ts`, `src/services/providers/astGuard.test.ts`, `src/services/providers/astGuard.ts`, `src/services/providers/descriptorRegistry.test.ts`, `src/services/providers/localParticipantConfig.ts`, `src/services/providers/participantConfig.test.ts`, `src/services/providers/prepareToStart.local.test.ts`, `src/stores/modelStore.test.ts`, `src/stores/modelStore.ts`, `src/stores/nativeModelStore.test.ts`, `src/stores/settingsStore.selections.test.ts`, `src/stores/settingsStore.sliceRegistry.test.ts`, `src/stores/settingsStore.test.ts`, `src/stores/settingsStore.ts`
- The 30 locale catalogs `src/locales/*/translation.json`, by the key tool (1 keys)

**Interfaces:**
- Consumes: Task 8 (the old registry holds LocalInference and Local Native only).
- Produces: `useWasmEngineAdapter(isSessionActive: boolean, override: WasmEngineAdapterOverride): EngineAdapter`; `ModelManagementSection` props `{ isSessionActive; settings: LocalInferenceSettings; update: (patch) => void; pair: LanguagePair; stageFilter?; direction? }`; `StoragePage` props `{ provider: 'wasm'; isSessionActive?; settings: LocalInferenceSettings; pair: LanguagePair } | { provider: 'native'; isSessionActive? }`; `SessionConfig = LocalNativeSessionConfig`; the old registry holds Local Native alone.

- [ ] **Step 1: Delete the files.**

  ```
  git rm -q -- src/services/clients/LocalInferenceClient.test.ts src/services/clients/LocalInferenceClient.ts src/services/providers/LocalInferenceProviderConfig.ts src/services/providers/providerOrder.test.ts src/stores/ensureSelectionReady.test.ts src/stores/settingsStore.providerSettings.test.tsx
  ```

- [ ] **Step 2: Apply the task's diff blocks** (Global Constraints: never by hand).

  ```
  python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/plan-apply.py docs/superpowers/plans/2026-09-30-client-contract-stage2-deletion.md t09
  ```

  Expected: `t09: 25 files changed`, and no other line.

- [ ] **Step 3: Remove the locale keys only the deleted code read.**

  ```
  node /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/drop-locale-keys.mjs . mainPanel.speechDetected
  ```

  Expected: `1 keys removed from 30 catalogs`.

- [ ] **Step 4: Check that nothing reaches what went.**

  ```
  git grep -nE "from '[^']*/(LocalInferenceClient|LocalInferenceProviderConfig)'|isLocalInferenceSessionConfig|createParticipantLocalInferenceConfig\(|state\.localInference|getState\(\)\.localInference|useLocalInferenceSettings|LocalInferenceProviderConfig\.ts /|EVERY provider descriptor|translationModelId ===" -- src
  ```

  Expected: nothing (exit status 1).

- [ ] **Step 5: Run the gates.** Each command as its own call; every expected number is the replay's.

  - `npx vitest run src`: **531 files passed and 1 skipped (532); 6 653 tests passed and 2 skipped (6 655)**; 0 failed, no unhandled errors.
  - `npx vitest run electron`: 34 files, 477 tests passed. `npx vitest run extension`: 9 files, 56 tests passed.
  - Local Native's old path: `npx vitest run src/services src/lib/local-inference/native src/components/Settings/sections/Native src/components/Settings/engine/useNativeEngineAdapter src/stores/nativeModelStore src/stores/settingsStore` — 39 files, 615 tests passed.
  - The typecheck, as a set: `npx tsc --noEmit -p tsconfig.json > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t09.txt`, then `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t08.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t09.txt` prints exactly `before 99 after 98; new 0; gone 1` and exits 0 — no error the task before did not have; `after 98` is the full tree's count.
  - `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh | diff - /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` prints nothing: the baseline's 18 lines, unchanged.

- [ ] **Step 6: Commit.**

```bash
git add -- src/components/Settings/engine/StoragePage.test.tsx src/components/Settings/engine/StoragePage.tsx src/components/Settings/engine/languageName.ts src/components/Settings/engine/useWasmEngineAdapter.test.ts src/components/Settings/engine/useWasmEngineAdapter.ts src/components/Settings/sections/ModelManagementSection.test.tsx src/components/Settings/sections/ModelManagementSection.tsx src/components/SettingsInitializer/SettingsInitializer.test.tsx src/components/SetupWizard/SetupWizard.test.tsx src/services/clients/ClientFactory.ts src/services/interfaces/IClient.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/astGuard.test.ts src/services/providers/astGuard.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/localParticipantConfig.ts src/services/providers/participantConfig.test.ts src/services/providers/prepareToStart.local.test.ts src/stores/modelStore.test.ts src/stores/modelStore.ts src/stores/nativeModelStore.test.ts src/stores/settingsStore.selections.test.ts src/stores/settingsStore.sliceRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts 'src/locales/*/translation.json'
```

```bash
git commit -q -F - -- src/services/clients/LocalInferenceClient.test.ts src/services/clients/LocalInferenceClient.ts src/services/providers/LocalInferenceProviderConfig.ts src/services/providers/providerOrder.test.ts src/stores/ensureSelectionReady.test.ts src/stores/settingsStore.providerSettings.test.tsx src/components/Settings/engine/StoragePage.test.tsx src/components/Settings/engine/StoragePage.tsx src/components/Settings/engine/languageName.ts src/components/Settings/engine/useWasmEngineAdapter.test.ts src/components/Settings/engine/useWasmEngineAdapter.ts src/components/Settings/sections/ModelManagementSection.test.tsx src/components/Settings/sections/ModelManagementSection.tsx src/components/SettingsInitializer/SettingsInitializer.test.tsx src/components/SetupWizard/SetupWizard.test.tsx src/services/clients/ClientFactory.ts src/services/interfaces/IClient.ts src/services/providers/ProviderConfigFactory.ts src/services/providers/astGuard.test.ts src/services/providers/astGuard.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/localParticipantConfig.ts src/services/providers/participantConfig.test.ts src/services/providers/prepareToStart.local.test.ts src/stores/modelStore.test.ts src/stores/modelStore.ts src/stores/nativeModelStore.test.ts src/stores/settingsStore.selections.test.ts src/stores/settingsStore.sliceRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts 'src/locales/*/translation.json' <<'EOF'
refactor(local-inference): delete LocalInference's old leftovers

Every mount passes LocalInference's own settings and pair, so the three
shared components take them as required props, and the old client,
descriptor, slice, validation arm and participant config have no user
left. Local Native's half of the shared files stays.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

**The blocks** (`t09`, one per file, in the order the applier takes them):

`src/components/Settings/engine/StoragePage.test.tsx`

`````diff t09
diff --git a/src/components/Settings/engine/StoragePage.test.tsx b/src/components/Settings/engine/StoragePage.test.tsx
--- a/src/components/Settings/engine/StoragePage.test.tsx
+++ b/src/components/Settings/engine/StoragePage.test.tsx
@@ -22,7 +22,7 @@
 });
 
 // Kept from before the old audio service was deleted: StoragePage statically
-// imports settingsStore (localInference/localNative) and modelStore, which
+// imports settingsStore (localNative) and modelStore, which
 // used to drag in the real ServiceFactory import chain — audioStore ->
 // ServiceFactory, which imported ModernBrowserAudioService ->
 // ModernAudioRecorder -> the @sapphi-red/web-noise-suppressor worklet's
@@ -49,6 +49,10 @@
 const { getManifestByType, isTranslationModelCompatible, getModelSizeMb } =
   await import('../../../lib/local-inference/modelManifest');
 
+/** LocalInference's own settings and pair, which every wasm mount passes
+ *  (Stage 2 deletion, ruling 3). */
+const WASM = { settings: { ...LOCAL_INFERENCE_DEFAULTS, selections: {} }, pair: { source: 'ja', target: 'en' } };
+
 // Real-manifest ids that can serve ja→en, mirroring ensureSelectionReady.test.ts.
 const asrId = () => getManifestByType('asr')
   .find(m => (m.multilingual || m.languages.includes('ja')) && !m.isCloudModel)!.id;
@@ -73,17 +77,11 @@
   .map(m => m.id);
 
 describe('StoragePage (wasm)', () => {
-  beforeEach(async () => {
-    await useSettingsStore.getState().updateLocalInference({
-      sourceLanguage: 'ja', targetLanguage: 'en', selections: {},
-    });
-  });
-
   it('lists downloaded models with an in-use badge on resolved ones', () => {
     useModelStore.setState({
       modelStatuses: { [asrId()]: 'downloaded' }, webgpuAvailable: true,
     });
-    render(<StoragePage provider="wasm" />);
+    render(<StoragePage provider="wasm" {...WASM} />);
     const row = screen.getByTestId(`storage-row-${asrId()}`);
     expect(row).toHaveTextContent('In use'); // resolved ASR for ja→en
   });
@@ -94,7 +92,7 @@
       modelStatuses: { [asrId()]: 'downloaded', [tr1]: 'downloaded', [tr2]: 'downloaded' },
       webgpuAvailable: true,
     });
-    render(<StoragePage provider="wasm" />);
+    render(<StoragePage provider="wasm" {...WASM} />);
     fireEvent.click(screen.getByTestId(`storage-delete-${tr1}`));
     // With a second translation model downloaded, the preview names a fallback,
     // not a dead end.
@@ -113,25 +111,25 @@
     useModelStore.setState({
       modelStatuses: { [id]: 'downloaded' }, webgpuAvailable: true,
     });
-    render(<StoragePage provider="wasm" />);
+    render(<StoragePage provider="wasm" {...WASM} />);
     fireEvent.click(screen.getByTestId(`storage-delete-${id}`));
     expect(screen.getByTestId('storage-confirm').textContent).toMatch(/sessions cannot start/);
   });
 
-  it('Clear all says selections are remembered — and does not touch them', async () => {
-    await useSettingsStore.getState().updateLocalInference({
-      selections: { 'ja→en': { asr: { modelId: asrId() }, translation: { modelId: '' }, tts: { modelId: '' } } },
-    });
+  it('Clear all says selections are remembered — and does not touch them', () => {
+    const selections = { 'ja→en': { asr: { modelId: asrId() }, translation: { modelId: '' }, tts: { modelId: '' } } };
     useModelStore.setState({ modelStatuses: { [asrId()]: 'downloaded' }, webgpuAvailable: true });
-    render(<StoragePage provider="wasm" />);
+    render(<StoragePage provider="wasm" {...WASM} settings={{ ...WASM.settings, selections }} />);
     fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
     expect(screen.getByTestId('storage-confirm').textContent)
       .toMatch(/selections are remembered/i);
-    expect(useSettingsStore.getState().localInference.selections['ja→en'].asr.modelId).toBe(asrId());
+    // StoragePage takes no `update`: it has no write path to the selections,
+    // so they stay as given (Stage 2 deletion, ruling 3).
+    expect(selections['ja→en'].asr.modelId).toBe(asrId());
   });
 
   it('Import is present for wasm and absent for native', () => {
-    const { unmount } = render(<StoragePage provider="wasm" />);
+    const { unmount } = render(<StoragePage provider="wasm" {...WASM} />);
     expect(screen.getByRole('button', { name: /Import/ })).toBeInTheDocument();
     unmount();
     render(<StoragePage provider="native" />);
@@ -147,7 +145,7 @@
     useModelStore.setState({
       modelStatuses: { [asrId()]: 'downloaded' }, webgpuAvailable: true,
     });
-    render(<StoragePage provider="wasm" isSessionActive />);
+    render(<StoragePage provider="wasm" {...WASM} isSessionActive />);
 
     expect(screen.getByTestId(`storage-delete-${asrId()}`)).toBeDisabled();
     expect(screen.getByRole('button', { name: /Clear all/ })).toBeDisabled();
@@ -165,7 +163,7 @@
     useModelStore.setState({
       modelStatuses: { [asrId()]: 'downloaded', [punctId]: 'downloaded' }, webgpuAvailable: true,
     });
-    render(<StoragePage provider="wasm" />);
+    render(<StoragePage provider="wasm" {...WASM} />);
     expect(screen.getByTestId(`storage-row-${asrId()}`)).toBeInTheDocument();
     expect(screen.queryByTestId(`storage-row-${punctId}`)).toBeNull();
   });
@@ -187,7 +185,7 @@
       modelStatuses: { [asrId()]: 'downloaded' }, webgpuAvailable: true, deleteAllModels,
     });
     try {
-      render(<StoragePage provider="wasm" />);
+      render(<StoragePage provider="wasm" {...WASM} />);
       fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
       fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
       await waitFor(() => expect(refresh).toHaveBeenCalled());
@@ -207,7 +205,7 @@
     useModelStore.setState({
       modelStatuses: { 'opus-mt-es-fr': 'downloaded' }, webgpuAvailable: true,
     });
-    render(<StoragePage provider="wasm" />);
+    render(<StoragePage provider="wasm" {...WASM} />);
     const row = screen.getByTestId('storage-row-opus-mt-es-fr');
     expect(row).not.toHaveTextContent('In use');
 
@@ -217,29 +215,6 @@
   });
 });
 
-describe('StoragePage (wasm, prop-driven — LocalInference Engine)', () => {
-  beforeEach(async () => {
-    // The store deliberately disagrees with the props passed below, so a
~ 18 more removed lines sha256:5b71ef2298ae
-});
-
 // Task 7's review carry-over: StoragePage's native half (real hooks, real
 // resolver) was implemented but never exercised by a test — only the "Import
 // is absent for native" case above touched it, and that needs no catalog at
@@ -343,7 +318,7 @@
     expect(screen.queryByTestId('storage-engine-row')).toBeNull();
 
     useNativeModelStore.setState({ bundleStatus: 'ready', bundleVersion: '0.2.0' } as never);
-    rerender(<StoragePage provider="wasm" />);
+    rerender(<StoragePage provider="wasm" {...WASM} />);
     expect(screen.queryByTestId('storage-engine-row')).toBeNull();
   });
 });
`````

`src/components/Settings/engine/StoragePage.tsx`

`````diff t09
diff --git a/src/components/Settings/engine/StoragePage.tsx b/src/components/Settings/engine/StoragePage.tsx
--- a/src/components/Settings/engine/StoragePage.tsx
+++ b/src/components/Settings/engine/StoragePage.tsx
@@ -5,7 +5,7 @@
   useModelStore, useModelStatuses, useStorageUsedMb, useWebGPUAvailable, useDeviceFeatures,
 } from '../../../stores/modelStore';
 import { useNativeModelStore, useNativeCatalog } from '../../../stores/nativeModelStore';
-import { useLocalInferenceSettings, useLocalNativeSettings } from '../../../stores/settingsStore';
+import { useLocalNativeSettings } from '../../../stores/settingsStore';
 import { MODEL_MANIFEST, getManifestEntry, getModelSizeMb } from '../../../lib/local-inference/modelManifest';
 import { useSegmentationStore } from '../../../stores/segmentationStore';
 import { wasmCandidates } from '../../../lib/local-inference/selection/candidates.wasm';
@@ -78,20 +78,18 @@
  *  Clear all (relocated from ModelStorageFooter), and Import (WASM only,
  *  reusing ModelImportModal — StoragePage is the one place a user can import
  *  a model with no direction/compatibility context attached to it yet). */
-export const StoragePage: React.FC<{
-  provider: 'wasm' | 'native';
-  isSessionActive?: boolean;
+export const StoragePage: React.FC<
   /**
-   * LocalInference's own `S`/pair (the new provider contract) — used for the
-   * `wasm` half instead of the legacy `settingsStore` hook when given,
-   * falling back to it otherwise. The `native` half is unaffected here
-   * (plan 1e-3 splits it — see the doc comment above).
+   * The `wasm` half reads LocalInference's own `S`/pair (the new provider
+   * contract); the old slice it once fell back to went with the old
+   * descriptor (Stage 2 deletion, ruling 3). The `native` half reads Local
+   * Native's slice, which the old path keeps (ruling 1).
    */
-  settings?: LocalInferenceSettings;
-  pair?: LanguagePair;
-}> = ({
-  provider, isSessionActive = false, settings: settingsProp, pair,
-}) => {
+  | { provider: 'wasm'; isSessionActive?: boolean; settings: LocalInferenceSettings; pair: LanguagePair }
+  | { provider: 'native'; isSessionActive?: boolean }
+> = (props) => {
+  const { provider, isSessionActive = false } = props;
+  const wasm = props.provider === 'wasm' ? props : null;
   const { t } = useTranslation();
 
   // ── WASM data (always subscribed — hooks must run unconditionally) ──────
@@ -99,10 +97,6 @@
   const wasmStorageMb = useStorageUsedMb();
   const webgpuAvailable = useWebGPUAvailable();
   const deviceFeatures = useDeviceFeatures();
-  const legacyWasmSettings = useLocalInferenceSettings();
-  const wasmSettings: LocalInferenceSettings = settingsProp ?? legacyWasmSettings;
-  const wasmSourceLanguage = pair?.source ?? legacyWasmSettings.sourceLanguage;
-  const wasmTargetLanguage = pair?.target ?? legacyWasmSettings.targetLanguage;
 
   // ── Native data ───────────────────────────────────────────────────────
   const nativeStatuses = useNativeModelStore((s) => s.statuses);
@@ -133,9 +127,9 @@
 
   const isWasm = provider === 'wasm';
 
-  const sourceLanguage = isWasm ? wasmSourceLanguage : nativeSettings.sourceLanguage;
-  const targetLanguage = isWasm ? wasmTargetLanguage : nativeSettings.targetLanguage;
-  const selections: Selections = isWasm ? wasmSettings.selections : nativeSettings.selections;
+  const sourceLanguage = wasm ? wasm.pair.source : nativeSettings.sourceLanguage;
+  const targetLanguage = wasm ? wasm.pair.target : nativeSettings.targetLanguage;
+  const selections: Selections = wasm ? wasm.settings.selections : nativeSettings.selections;
   const speakerDir = directionKey(sourceLanguage, targetLanguage);
   const participantDir = directionKey(targetLanguage, sourceLanguage);
   const directions = [{ dir: speakerDir }, { dir: participantDir }];
`````

`src/components/Settings/engine/languageName.ts`

`````diff t09
diff --git a/src/components/Settings/engine/languageName.ts b/src/components/Settings/engine/languageName.ts
--- a/src/components/Settings/engine/languageName.ts
+++ b/src/components/Settings/engine/languageName.ts
@@ -11,21 +11,19 @@
  * code)?.name`).
  *
  * Deliberately reads utils/languages.ts's LANGUAGE_OPTIONS map directly
- * instead of going through ProviderConfigFactory.getConfig(provider)
- * .languages (LOCAL_INFERENCE/LOCAL_NATIVE — the two callers that would need
- * it). Both providers' `.languages` field is literally
~ 10 more removed lines sha256:022ef3502bc4
- * `vi.mock('react-i18next', ...)` the same way StoragePage.test.tsx's own
- * `initReactI18next` note documents.
+ * instead of going through the two providers' language lists. Both are
+ * literally `getTranslationSourceLanguages()` (LocalInference's
+ * `localInferenceLanguages.sources`, `src/providers/localInference/settings.ts`;
+ * Local Native's `.languages`, `LocalNativeProviderConfig.ts`), which is
+ * itself every LANGUAGE_OPTIONS code (a universal-multilingual translation
+ * model pulls in the whole set) mapped through this same getLanguageOption
+ * lookup — confirmed no code resolves differently — so the result is
+ * identical either way. Going through `ProviderConfigFactory` once pulled
+ * every old provider descriptor into the two model-management sections just
+ * to read one field, and `src/locales`' real i18n singleton with them, which
+ * broke ModelManagementSection.test.tsx's / NativeModelManagementSection.test.tsx's
+ * fully-replaced `vi.mock('react-i18next', ...)` the same way
+ * StoragePage.test.tsx's own `initReactI18next` note documents.
  */
 export function languageNameFor(code: string): string {
   return getLanguageOption(code).name;
`````

`src/components/Settings/engine/useWasmEngineAdapter.test.ts`

`````diff t09
diff --git a/src/components/Settings/engine/useWasmEngineAdapter.test.ts b/src/components/Settings/engine/useWasmEngineAdapter.test.ts
--- a/src/components/Settings/engine/useWasmEngineAdapter.test.ts
+++ b/src/components/Settings/engine/useWasmEngineAdapter.test.ts
@@ -1,52 +1,43 @@
 import { describe, it, expect, beforeEach, vi } from 'vitest';
 import { renderHook, act } from '@testing-library/react';
+import { useCallback, useMemo, useState } from 'react';
+import { useWasmEngineAdapter } from './useWasmEngineAdapter';
+import { useModelStore } from '../../../stores/modelStore';
+import { getManifestByType } from '../../../lib/local-inference/modelManifest';
+import { wasmCandidates } from '../../../lib/local-inference/selection/candidates.wasm';
+import { LOCAL_INFERENCE_DEFAULTS, type LocalInferenceSettings } from '../../../providers/localInference/settings';
+import type { LanguagePair } from '../../../lib/provider/types';
 
-// Kept from before the old audio service was deleted: useWasmEngineAdapter
-// statically imports settingsStore, which used to drag in its real static
-// import graph — including audioStore -> ServiceFactory, which imported
~ 14 more removed lines sha256:2f97d27258bc
-  },
-}));
+const jaAsr = () => getManifestByType('asr').filter(m => m.multilingual || m.languages.includes('ja'));
 
-const { useWasmEngineAdapter } = await import('./useWasmEngineAdapter');
-const { useModelStore } = await import('../../../stores/modelStore');
-const { default: useSettingsStore } = await import('../../../stores/settingsStore');
-const { getManifestByType } = await import('../../../lib/local-inference/modelManifest');
-const { wasmCandidates } = await import('../../../lib/local-inference/selection/candidates.wasm');
+const JA_EN: LanguagePair = { source: 'ja', target: 'en' };
+const ZH_KO: LanguagePair = { source: 'zh', target: 'ko' };
 
-const jaAsr = () => getManifestByType('asr').filter(m => m.multilingual || m.languages.includes('ja'));
+/** The adapter over LocalInference's own settings, held in React state as
+ *  `LocalInferenceEngine` holds them: the override every mount passes
+ *  (Stage 2 deletion, ruling 3). */
+function useHeldAdapter(pair: LanguagePair = JA_EN) {
+  const [settings, setSettings] = useState<LocalInferenceSettings>({ ...LOCAL_INFERENCE_DEFAULTS, selections: {} });
+  const update = useCallback((patch: Partial<LocalInferenceSettings>) => setSettings((s) => ({ ...s, ...patch })), []);
+  const override = useMemo(() => ({ settings, update, pair }), [settings, update, pair]);
+  return { adapter: useWasmEngineAdapter(false, override), settings };
+}
 
 describe('useWasmEngineAdapter', () => {
-  beforeEach(async () => {
-    await useSettingsStore.getState().updateLocalInference({
-      sourceLanguage: 'ja', targetLanguage: 'en', selections: {},
-    });
+  beforeEach(() => {
     useModelStore.setState({ modelStatuses: {}, webgpuAvailable: true });
   });
 
   it('directions are speaker-first ja→en then en→ja', () => {
-    const { result } = renderHook(() => useWasmEngineAdapter());
-    expect(result.current.directions.map(d => d.dir)).toEqual(['ja→en', 'en→ja']);
+    const { result } = renderHook(() => useHeldAdapter());
+    expect(result.current.adapter.directions.map(d => d.dir)).toEqual(['ja→en', 'en→ja']);
   });
 
   it('readyCandidates lists only downloaded/usable implementations', () => {
     const first = jaAsr()[0];
     useModelStore.setState({ modelStatuses: { [first.id]: 'downloaded' } });
-    const { result } = renderHook(() => useWasmEngineAdapter());
-    const ids = result.current.readyCandidates({ dir: 'ja→en', stage: 'asr' }).map(c => c.id);
+    const { result } = renderHook(() => useHeldAdapter());
+    const ids = result.current.adapter.readyCandidates({ dir: 'ja→en', stage: 'asr' }).map(c => c.id);
     expect(ids).toContain(first.id);
     // an un-downloaded ja-capable ASR is absent
     const notDownloaded = jaAsr().find(m => m.id !== first.id && !m.isCloudModel);
@@ -74,50 +65,43 @@
       modelStatuses: { [astCandidate!.id]: 'downloaded', [normalCandidate!.id]: 'downloaded' },
       webgpuAvailable: true,
     });
-    const { result } = renderHook(() => useWasmEngineAdapter());
-    const ids = result.current.readyCandidates({ dir: 'ja→en', stage: 'translation' }).map(c => c.id);
+    const { result } = renderHook(() => useHeldAdapter());
+    const ids = result.current.adapter.readyCandidates({ dir: 'ja→en', stage: 'translation' }).map(c => c.id);
     expect(ids).not.toContain(astCandidate!.id);
     expect(ids).toContain(normalCandidate!.id);
   });
 
   it('select writes an explicit pick preserving sibling stages, and "" restores auto', async () => {
-    const { result } = renderHook(() => useWasmEngineAdapter());
-    await act(() => result.current.select({ dir: 'en→ja', stage: 'translation' }, 'some-model'));
-    const sel = useSettingsStore.getState().localInference.selections['en→ja'];
+    const { result } = renderHook(() => useHeldAdapter());
+    await act(() => result.current.adapter.select({ dir: 'en→ja', stage: 'translation' }, 'some-model'));
+    const sel = result.current.settings.selections['en→ja'];
     expect(sel.translation.modelId).toBe('some-model');
     expect(sel.asr.modelId).toBe('');
-    await act(() => result.current.select({ dir: 'en→ja', stage: 'translation' }, ''));
-    expect(useSettingsStore.getState().localInference.selections['en→ja']).toBeUndefined();
+    await act(() => result.current.adapter.select({ dir: 'en→ja', stage: 'translation' }, ''));
+    expect(result.current.settings.selections['en→ja']).toBeUndefined();
   });
 
   it('participant direction renders asr+translation only', () => {
-    const { result } = renderHook(() => useWasmEngineAdapter());
-    expect(result.current.stagesFor('en→ja', false)).toEqual(['asr', 'translation']);
-    expect(result.current.stagesFor('ja→en', true)).toEqual(['asr', 'translation', 'tts']);
+    const { result } = renderHook(() => useHeldAdapter());
+    expect(result.current.adapter.stagesFor('en→ja', false)).toEqual(['asr', 'translation']);
+    expect(result.current.adapter.stagesFor('ja→en', true)).toEqual(['asr', 'translation', 'tts']);
   });
-});
 
-describe('useWasmEngineAdapter — LocalInference Engine override', () => {
-  it('reads directions from the override, not the store', () => {
-    const { result } = renderHook(() => useWasmEngineAdapter(false, {
-      settings: { selections: {} } as any,
-      update: vi.fn(),
-      pair: { source: 'zh', target: 'ko' },
-    }));
-    expect(result.current.directions.map(d => d.dir)).toEqual(['zh→ko', 'ko→zh']);
+  it('reads its directions from the given pair', () => {
+    const { result } = renderHook(() => useHeldAdapter(ZH_KO));
+    expect(result.current.adapter.directions.map(d => d.dir)).toEqual(['zh→ko', 'ko→zh']);
   });
 
-  it('writes a pick through the override\'s update, and leaves the store untouched', async () => {
+  it("writes a pick through the given update, with the whole selections map", async () => {
     const update = vi.fn();
     const { result } = renderHook(() => useWasmEngineAdapter(false, {
-      settings: { selections: {} } as any,
+      settings: { ...LOCAL_INFERENCE_DEFAULTS, selections: {} },
       update,
-      pair: { source: 'ja', target: 'en' },
+      pair: JA_EN,
     }));
     await act(() => result.current.select({ dir: 'en→ja', stage: 'translation' }, 'some-model'));
     expect(update).toHaveBeenCalledWith({
       selections: { 'en→ja': { asr: { modelId: '' }, translation: { modelId: 'some-model' }, tts: { modelId: '' } } },
     });
-    expect(useSettingsStore.getState().localInference.selections['en→ja']).toBeUndefined();
   });
 });
`````

`src/components/Settings/engine/useWasmEngineAdapter.ts`

`````diff t09
diff --git a/src/components/Settings/engine/useWasmEngineAdapter.ts b/src/components/Settings/engine/useWasmEngineAdapter.ts
--- a/src/components/Settings/engine/useWasmEngineAdapter.ts
+++ b/src/components/Settings/engine/useWasmEngineAdapter.ts
@@ -2,7 +2,6 @@
 import {
   useModelStore, useModelStatuses, useWebGPUAvailable, useDeviceFeatures, useStorageUsedMb,
 } from '../../../stores/modelStore';
-import { useLocalInferenceSettings, useUpdateLocalInference } from '../../../stores/settingsStore';
 import { wasmCandidates } from '../../../lib/local-inference/selection/candidates.wasm';
 import { directionKey, emptyDirection, type Stage } from '../../../lib/local-inference/selection/types';
 import { getManifestEntry, getModelSizeMb } from '../../../lib/local-inference/modelManifest';
@@ -13,13 +12,10 @@
 import type { LocalInferenceSettings } from '../../../providers/localInference/settings';
 
 /**
- * LocalInference's own `S`/`update`/pair (the new provider contract), used
- * instead of the legacy `settingsStore` hooks when given — the fallback
- * `ModelManagementSection`/`StoragePage` still offer for an unmounted caller
- * (`ProviderSpecificSettings`, compiled but never rendered since plan
- * 1e-3b-2's switch). Every mount the switched app reaches
- * (`LocalInferenceEngine`, wired from both `SimpleSettings` and
- * `AdvancedSettings`) passes the override now.
+ * LocalInference's own `S`/`update`/pair (the new provider contract). Every
+ * mount (`LocalInferenceEngine`, wired from both `SimpleSettings` and
+ * `AdvancedSettings`) passes it; the old slice it once fell back to went with
+ * the old descriptor (Stage 2 deletion, ruling 3).
  */
 export interface WasmEngineAdapterOverride {
   settings: LocalInferenceSettings;
@@ -28,17 +24,15 @@
 }
 
 /** LOCAL_INFERENCE's EngineAdapter — resolve() for display, selections for writes. */
-export function useWasmEngineAdapter(isSessionActive = false, override?: WasmEngineAdapterOverride): EngineAdapter {
-  const legacySettings = useLocalInferenceSettings();
-  const legacyUpdate = useUpdateLocalInference();
+export function useWasmEngineAdapter(isSessionActive: boolean, override: WasmEngineAdapterOverride): EngineAdapter {
   const modelStatuses = useModelStatuses();
   const webgpuAvailable = useWebGPUAvailable();
   const deviceFeatures = useDeviceFeatures();
   const storageUsedMb = useStorageUsedMb();
 
-  const sourceLanguage = override?.pair.source ?? legacySettings.sourceLanguage;
-  const targetLanguage = override?.pair.target ?? legacySettings.targetLanguage;
-  const selections = override?.settings.selections ?? legacySettings.selections;
+  const sourceLanguage = override.pair.source;
+  const targetLanguage = override.pair.target;
+  const selections = override.settings.selections;
 
   return useMemo<EngineAdapter>(() => {
     const speaker = directionKey(sourceLanguage, targetLanguage);
@@ -103,12 +97,11 @@
         if (!nextDir.asr.modelId && !nextDir.translation.modelId && !nextDir.tts.modelId) {
           delete next[slot.dir]; // all-auto directions carry no information
         }
-        if (override) await override.update({ selections: next });
-        else await legacyUpdate({ selections: next });
+        await override.update({ selections: next });
       },
       storageSummary: `${storageUsedMb} MB`,
       stagesFor: (_dir, isSpeaker): Stage[] => (isSpeaker ? ['asr', 'translation', 'tts'] : ['asr', 'translation']),
       disabled: isSessionActive,
     };
-  }, [sourceLanguage, targetLanguage, selections, modelStatuses, webgpuAvailable, deviceFeatures, storageUsedMb, override, legacyUpdate, isSessionActive]);
+  }, [sourceLanguage, targetLanguage, selections, modelStatuses, webgpuAvailable, deviceFeatures, storageUsedMb, override, isSessionActive]);
 }
`````

`src/components/Settings/sections/ModelManagementSection.test.tsx`

`````diff t09
diff --git a/src/components/Settings/sections/ModelManagementSection.test.tsx b/src/components/Settings/sections/ModelManagementSection.test.tsx
--- a/src/components/Settings/sections/ModelManagementSection.test.tsx
+++ b/src/components/Settings/sections/ModelManagementSection.test.tsx
@@ -5,7 +5,7 @@
 import { resolveDirection } from '../../../lib/local-inference/selection/resolveStage';
 import { wasmCandidates } from '../../../lib/local-inference/selection/candidates.wasm';
 import { directionKey, type Selections } from '../../../lib/local-inference/selection/types';
-import { LOCAL_INFERENCE_DEFAULTS } from '../../../providers/localInference/settings';
+import { LOCAL_INFERENCE_DEFAULTS, type LocalInferenceSettings } from '../../../providers/localInference/settings';
 
 const defaultSettings = {
   sourceLanguage: 'en', targetLanguage: 'en',
@@ -14,6 +14,13 @@
 };
 const mockSettings = { ...defaultSettings };
 const mockUpdate = vi.fn();
+/** The props every mount passes (Stage 2 deletion, ruling 3), read off this
+ *  file's mutable fixture at render time. */
+const slice = () => ({
+  settings: mockSettings as unknown as LocalInferenceSettings,
+  update: mockUpdate,
+  pair: { source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage },
+});
 
 vi.mock('react-i18next', () => ({
   // Interpolating, mirroring StoragePage.test.tsx — needed so {{lang}} in
@@ -26,10 +33,6 @@
         : _k,
   }),
 }));
-vi.mock('../../../stores/settingsStore', () => ({
-  useLocalInferenceSettings: () => mockSettings,
-  useUpdateLocalInference: () => mockUpdate,
-}));
 
 // Edge TTS voice list — two disjoint locales so the forward/reversed targets
 // disagree about which voice is "valid" (the freeze-bug precondition). The
@@ -105,19 +108,10 @@
   for (const k of Object.keys(mockDownloads)) delete mockDownloads[k];
 });
 
-describe('ModelManagementSection (self-reads store)', () => {
-  it('renders without settings/update props', async () => {
-    render(<ModelManagementSection isSessionActive={false} />);
-    await waitFor(() =>
-      expect(screen.getByText('ASR (Speech Recognition)')).toBeInTheDocument(),
-    );
-  });
-});
-
 describe('ModelManagementSection (prop-driven, LocalInference Engine)', () => {
-  it("writes through the given `update`, not the store, and reads `selections` from the given `settings`, not the store's", () => {
-    // The store's own selections carry an unrelated direction — proof that a
-    // write built from the PROP's settings (empty) never resurrects it.
+  it("writes through the given `update` and reads `selections` from the given `settings`", () => {
+    // This file's shared fixture carries an unrelated direction — proof that a
+    // write is built from the given settings (empty) alone.
     mockSettings.selections = {
       'zh→fr': { asr: { modelId: 'ghost-model' }, translation: { modelId: '' }, tts: { modelId: '' } },
     };
@@ -153,7 +147,7 @@
     mockSettings.sourceLanguage = 'en';
     mockSettings.targetLanguage = 'ja';
 
-    render(<ModelManagementSection isSessionActive={false} />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} />);
     const showAll = await screen.findByText(/Show all ASR models/);
     fireEvent.click(showAll);
 
@@ -169,7 +163,7 @@
       downloadedBytes: 1, totalBytes: 2, currentFile: 'config.json', percent: 50, isImport: true,
     };
 
-    render(<ModelManagementSection isSessionActive={false} />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} />);
 
     const card = await screen.findByTestId('model-card-sensevoice-int8');
     expect(within(card).queryByTitle('Cancel')).toBeNull();
@@ -191,7 +185,7 @@
     };
     mockStatuses['supertonic-3'] = 'downloaded';
 
-    render(<ModelManagementSection isSessionActive={false} />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} />);
 
     const card = await waitFor(() => screen.getByTestId('model-card-supertonic-3'));
     // VoiceLibrarySection (Supertonic dropdown) renders a "Voice" label in the body.
@@ -213,7 +207,7 @@
     };
     mockStatuses['supertonic-3'] = 'downloaded';
 
-    render(<ModelManagementSection isSessionActive={false} />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} />);
 
     const card = await waitFor(() => screen.getByTestId('model-card-supertonic-3'));
     expect(within(card).getByText(/Voice Builder/)).toHaveTextContent(/closed/i);
@@ -227,7 +221,7 @@
   it('marks the resolved model selected without writing it to settings', async () => {
     mockStatuses['sensevoice-int8'] = 'downloaded';
 
-    render(<ModelManagementSection isSessionActive={false} />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} />);
 
     // No role="radio" in this markup — a selected card shows the "Active"
     // status label and carries the --selected modifier class (see ModelCard).
@@ -261,7 +255,7 @@
       mockStatuses[m.id] = 'downloaded';
     }
 
-    render(<ModelManagementSection isSessionActive={false} />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} />);
 
     const selectedLabels = await screen.findAllByText('Active');
     expect(selectedLabels.length).toBeGreaterThan(0);
@@ -286,7 +280,7 @@
     mockSettings.sourceLanguage = 'en';
     mockSettings.targetLanguage = 'ja';
 
-    render(<ModelManagementSection isSessionActive={false} stageFilter="asr" />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="asr" />);
     await screen.findByRole('button', { name: /Show all ASR models \(\d+\)/ });
 
     // Bare mode: the stage's collapsible group header would duplicate the
@@ -319,7 +313,7 @@
     mockSettings.targetLanguage = 'ja';
     mockStatuses['moonshine-tiny-ja-quant'] = 'downloaded';
 
-    render(<ModelManagementSection isSessionActive={false} stageFilter="asr" direction="ja→en" />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="asr" direction="ja→en" />);
 
     const card = screen.getByTestId('model-card-moonshine-tiny-ja-quant');
     // Compatible under the slot's direction: no show-all toggle needed, and
@@ -337,7 +331,7 @@
     mockSettings.sourceLanguage = 'en';
     mockSettings.targetLanguage = 'ja';
 
-    render(<ModelManagementSection isSessionActive={false} stageFilter="asr" />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="asr" />);
     fireEvent.click(await screen.findByRole('button', { name: /Show all ASR models/ }));
 
     const card = await screen.findByTestId('model-card-moonshine-tiny-ja-quant');
@@ -358,7 +352,7 @@
     mockSettings.targetLanguage = 'ja';
     mockStatuses['moonshine-tiny-ja-quant'] = 'downloaded';
 
-    render(<ModelManagementSection isSessionActive={false} stageFilter="asr" />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="asr" />);
     fireEvent.click(await screen.findByRole('button', { name: /Show all ASR models/ }));
     await screen.findByTestId('model-card-moonshine-tiny-ja-quant');
 
@@ -374,14 +368,14 @@
 // this footer's own `disabled` prop is unrelated to that surface).
 describe('ModelManagementSection — ModelStorageFooter only on the standalone render (C1)', () => {
   it('a Library-view (stageFilter set) render has no ModelStorageFooter', async () => {
-    render(<ModelManagementSection isSessionActive={false} stageFilter="asr" />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="asr" />);
     // Bare mode has no stage title — anchor on the rendered list instead.
     await screen.findByRole('button', { name: /Show all ASR models/ });
     expect(document.querySelector('.model-management__storage')).not.toBeInTheDocument();
   });
 
   it('the standalone (prop-less stageFilter) render keeps the footer', async () => {
-    render(<ModelManagementSection isSessionActive={false} />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} />);
     await screen.findByText('ASR (Speech Recognition)');
     expect(document.querySelector('.model-management__storage')).toBeInTheDocument();
   });
@@ -401,7 +395,7 @@
     // Valid for the FORWARD target (ja) — invalid for the reversed leg's (en).
     mockSettings.edgeTtsVoice = 'ja-JP-NanamiNeural';
 
-    render(<ModelManagementSection isSessionActive={false} stageFilter="translation" direction="ja→en" />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="translation" direction="ja→en" />);
 
     await waitFor(() => expect(mockGetEdgeTtsVoices).toHaveBeenCalled());
     // One extra macrotask so the auto-select effect (if it ran) has flushed.
@@ -419,7 +413,7 @@
     mockSettings.sourceLanguage = 'en';
     mockSettings.targetLanguage = 'ja';
 
-    render(<ModelManagementSection isSessionActive={false} stageFilter="tts" direction="ja→en" />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="tts" direction="ja→en" />);
     await screen.findByTestId('model-card-edge-tts');
     expect(screen.queryByText('Voice')).not.toBeInTheDocument();
   });
@@ -428,7 +422,7 @@
     mockSettings.sourceLanguage = 'en';
     mockSettings.targetLanguage = 'ja';
 
-    render(<ModelManagementSection isSessionActive={false} stageFilter="tts" direction="en→ja" />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="tts" direction="en→ja" />);
     await screen.findByTestId('model-card-edge-tts');
     expect(await screen.findByText('Voice')).toBeInTheDocument();
   });
@@ -438,7 +432,7 @@
     mockSettings.targetLanguage = 'ja';
     mockSettings.edgeTtsVoice = 'en-US-AriaNeural'; // wrong language for target ja
 
-    render(<ModelManagementSection isSessionActive={false} />);
+    render(<ModelManagementSection isSessionActive={false} {...slice()} />);
 
     await waitFor(() => {
       const voiceWrites = mockUpdate.mock.calls.filter(([p]) => p && 'edgeTtsVoice' in p);
@@ -459,7 +453,7 @@
     mockSettings.targetLanguage = 'ja';
     mockSettings.edgeTtsVoice = 'en-US-AriaNeural'; // wrong language for target ja
 
-    const { rerender } = render(<ModelManagementSection isSessionActive={false} />);
+    const { rerender } = render(<ModelManagementSection isSessionActive={false} {...slice()} />);
 
     await waitFor(() => {
       const voiceWrites = mockUpdate.mock.calls.filter(([p]) => p && 'edgeTtsVoice' in p);
@@ -468,7 +462,7 @@
 
     // A re-render with unchanged props/inputs (e.g. a parent re-rendering
     // for an unrelated reason) must not re-trigger the effect.
-    rerender(<ModelManagementSection isSessionActive={false} />);
+    rerender(<ModelManagementSection isSessionActive={false} {...slice()} />);
     await new Promise((r) => setTimeout(r, 0));
 
     const voiceWrites = mockUpdate.mock.calls.filter(([p]) => p && 'edgeTtsVoice' in p);
`````

`src/components/Settings/sections/ModelManagementSection.tsx`

`````diff t09
diff --git a/src/components/Settings/sections/ModelManagementSection.tsx b/src/components/Settings/sections/ModelManagementSection.tsx
--- a/src/components/Settings/sections/ModelManagementSection.tsx
+++ b/src/components/Settings/sections/ModelManagementSection.tsx
@@ -26,7 +26,6 @@
   type ModelType,
 } from '../../../lib/local-inference/modelManifest';
 import { directionKey, emptyDirection, splitDirection, type Stage } from '../../../lib/local-inference/selection/types';
-import { useLocalInferenceSettings, useUpdateLocalInference } from '../../../stores/settingsStore';
 import type { LocalInferenceSettings } from '../../../providers/localInference/settings';
 import type { LanguagePair } from '../../../lib/provider/types';
 import { languageNameFor } from '../engine/languageName';
@@ -57,15 +56,14 @@
    *  pair (the standalone render). */
   direction?: string;
   /**
-   * LocalInference's own `S`/`update`/pair (the new provider contract) —
-   * used instead of the legacy `settingsStore` hooks when given, falling
-   * back to them otherwise so every existing caller (`SimpleSettings`,
-   * `ProviderSpecificSettings`) is unchanged. `pair` carries the source/
-   * target languages `S` no longer does (`providerStore` owns the pair now).
+   * LocalInference's own `S`/`update`/pair (the new provider contract); the
+   * old slice it once fell back to went with the old descriptor (Stage 2
+   * deletion, ruling 3). `pair` carries the source/target languages `S` no
+   * longer does (`providerStore` owns the pair now).
    */
-  settings?: LocalInferenceSettings;
-  update?: (patch: Partial<LocalInferenceSettings>) => void;
-  pair?: LanguagePair;
+  settings: LocalInferenceSettings;
+  update: (patch: Partial<LocalInferenceSettings>) => void;
+  pair: LanguagePair;
 }
 
 // ─── ModelCard ─────────────────────────────────────────────────────────────
@@ -337,27 +335,21 @@
   isSessionActive,
   stageFilter,
   direction,
-  settings: settingsProp,
-  update: updateProp,
+  settings,
+  update,
   pair,
 }: ModelManagementSectionProps) {
   const { t } = useTranslation();
-  // Hooks must run unconditionally, even when `settingsProp`/`updateProp`
-  // override them below.
-  const legacySettings = useLocalInferenceSettings();
-  const legacyUpdate = useUpdateLocalInference();
-  const settings: LocalInferenceSettings = settingsProp ?? legacySettings;
   // Stable identity: the edge-TTS voice auto-select effect holds it in its
   // deps, and a fresh function every render would re-run that effect's write
   // (the 2026-08-23 freeze).
   const updateLocalInference = useCallback(
-    (patch: Partial<LocalInferenceSettings>) => (updateProp ? updateProp(patch) : legacyUpdate(patch)),
-    [updateProp, legacyUpdate],
+    (patch: Partial<LocalInferenceSettings>) => update(patch),
+    [update],
   );
-  // The forward pair: `pair` when given (the new contract — `S` no longer
-  // carries it), else the legacy slice's own fields.
-  const forwardSource = pair?.source ?? legacySettings.sourceLanguage;
-  const forwardTarget = pair?.target ?? legacySettings.targetLanguage;
+  // The forward pair (the new contract — `S` no longer carries it).
+  const forwardSource = pair.source;
+  const forwardTarget = pair.target;
   const statuses = useModelStatuses();
   const downloads = useModelDownloads();
   const downloadErrors = useDownloadErrors();
`````

`src/components/SettingsInitializer/SettingsInitializer.test.tsx`

`````diff t09
diff --git a/src/components/SettingsInitializer/SettingsInitializer.test.tsx b/src/components/SettingsInitializer/SettingsInitializer.test.tsx
--- a/src/components/SettingsInitializer/SettingsInitializer.test.tsx
+++ b/src/components/SettingsInitializer/SettingsInitializer.test.tsx
@@ -1,10 +1,9 @@
 /**
  * SettingsInitializer after the switch (plan 1e-3b-2 ruling 10): its two
  * remaining jobs — LocalInference's first model scan, and an Edge TTS voice
- * that matches the target language, written through the provider store —
- * and the single-writer cut (ruling 11): nothing the page wires at startup,
- * nor a change of the audio mode, reaches the old path's gate or the old
- * slice's writer.
+ * that matches the target language, written through the provider store. The
+ * old gate and slice it had to stay clear of (ruling 11) went with the old
+ * descriptor (Stage 2 deletion, ruling 3).
  */
 import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
 import { act, render } from '@testing-library/react';
@@ -30,81 +29,16 @@
   getEdgeTtsVoices: edge.voices,
 }));
 
-// Ruling 11's case 1 mounts the real <AppSessionRoot /> beside
-// SettingsInitializer, so `attach()` genuinely runs (watchLegsFromStores,
-// driveLocalReadiness) — the same mocks AppSessionRoot.test.tsx uses for the
~ 50 more removed lines sha256:297c203f8b69
-vi.mock('../../contexts/UserProfileContext', () => ({ useUserProfile: () => ({ refetchAll: vi.fn(async () => {}) }) }));
-
 import type { DirectionResult } from '../../lib/local-inference/selection/types';
 import { fakeProvider } from '../../providers/fake/provider';
 import { localInferenceProvider } from '../../providers/localInference/provider';
 import { LOCAL_INFERENCE_DEFAULTS } from '../../providers/localInference/settings';
-import { AppSessionRoot } from '../../app/AppSessionRoot';
-import { READINESS_DELAY_MS } from '../../app/readiness';
-import { configureAppSession } from '../../app/session';
-import { createVirtualClock } from '../../lib/contract/clock';
 import useAudioStore from '../../stores/audioStore';
 import { useModelStore } from '../../stores/modelStore';
 import { useProviderStore, type ProviderStore } from '../../stores/providerStore';
 import useSettingsStore from '../../stores/settingsStore';
-import { ToastProvider } from '../Toast';
 import { SettingsInitializer } from './SettingsInitializer';
 
-// The virtual clock attach()'s driveLocalReadiness reads, so its 150ms
-// debounce advances deterministically instead of racing real timers.
-const clock = createVirtualClock(0);
-configureAppSession({ clock, newSessionId: () => 'r1', ipc: null });
-
 const initial = {
   settings: useSettingsStore.getState(),
   model: useModelStore.getState(),
@@ -139,33 +73,6 @@
 });
 
 describe('SettingsInitializer', () => {
-  // Ruling 11. Before the switch, the settings store's mode subscription
-  // re-ran `validateApiKey`, whose LocalInference arm calls
-  // `ensureSelectionReady` (and its prune wrote the old slice). This mounts
~ 22 more removed lines sha256:6a00f4e7776f
-  });
-
   it('scans the downloaded models once while LocalInference is selected and the model store is not initialized', () => {
     const initialize = vi.fn(async () => {});
     useModelStore.setState({ initialized: false, initialize, resolve: () => direction(null) });
`````

`src/components/SetupWizard/SetupWizard.test.tsx`

`````diff t09
diff --git a/src/components/SetupWizard/SetupWizard.test.tsx b/src/components/SetupWizard/SetupWizard.test.tsx
--- a/src/components/SetupWizard/SetupWizard.test.tsx
+++ b/src/components/SetupWizard/SetupWizard.test.tsx
@@ -84,8 +84,7 @@
 vi.mock('../Tour/TourProvider', () => ({ useTour: () => ({ start: startTourSpy }) }));
 
 import SetupWizard from './SetupWizard';
-import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
-import { Provider } from '../../types/Provider';
+import { LOCAL_INFERENCE_DEFAULTS, localInferenceLanguages } from '../../providers/localInference/settings';
 import { matchLanguage } from './languageDefaults';
 import { useProviderStore } from '../../stores/providerStore';
 import { sonioxProvider } from '../../providers/soniox/provider';
@@ -189,7 +188,7 @@
     fireEvent.click(screen.getByRole('radio', { name: /Free, offline/ }));
     next();                                           // credentials: nothing to enter offline
     next();                                           // language pair
-    const jaSource = matchLanguage(ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE).resolveSourceLanguages(), 'ja');
+    const jaSource = matchLanguage([...localInferenceLanguages.sources(LOCAL_INFERENCE_DEFAULTS)], 'ja');
     // If the local engine offered no Japanese source there would be nothing to
     // assert about the pair; the interface-language assertion above still holds.
     // Labelled by the same sentence Settings prints, not "From"/"To": this
@@ -207,8 +206,8 @@
     next();                                           // language pair
     const source = (screen.getByRole('combobox', { name: 'I speak' }) as HTMLSelectElement).value;
     const target = (screen.getByRole('combobox', { name: 'they hear' }) as HTMLSelectElement).value;
-    const sources = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE).resolveSourceLanguages();
-    const targets = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE).resolveTargetLanguages(source);
+    const sources = localInferenceLanguages.sources(LOCAL_INFERENCE_DEFAULTS);
+    const targets = localInferenceLanguages.targets(source, LOCAL_INFERENCE_DEFAULTS);
     const sourceName = sources.find((o) => o.value === source)!.name;
     const targetName = targets.find((o) => o.value === target)!.name;
     // The reverse leg reads the pair the other way round: they speak what the
`````

`src/services/clients/ClientFactory.ts`

`````diff t09
diff --git a/src/services/clients/ClientFactory.ts b/src/services/clients/ClientFactory.ts
--- a/src/services/clients/ClientFactory.ts
+++ b/src/services/clients/ClientFactory.ts
@@ -24,9 +24,8 @@
   ): IClient {
     void model;
     // Legacy callers skip extractCredentials — keep the old façade contract of
-    // rejecting an empty key up front (LOCAL_INFERENCE and LOCAL_NATIVE never
-    // had credentials).
-    if (!apiKey && provider !== Provider.LOCAL_INFERENCE && provider !== Provider.LOCAL_NATIVE) {
+    // rejecting an empty key up front (LOCAL_NATIVE never had credentials).
+    if (!apiKey && provider !== Provider.LOCAL_NATIVE) {
       throw new Error(`API key is required for ${provider} provider`);
     }
     return ProviderConfigFactory.getDescriptor(provider).createClient(
`````

`src/services/interfaces/IClient.ts`

`````diff t09
diff --git a/src/services/interfaces/IClient.ts b/src/services/interfaces/IClient.ts
--- a/src/services/interfaces/IClient.ts
+++ b/src/services/interfaces/IClient.ts
@@ -73,36 +73,6 @@
   keepReplayAudio?: boolean;
 }
 
-/**
- * Local inference session configuration
- */
~ 25 more removed lines sha256:6e7775d300fd
-}
-
 /**
  * Native (Electron sidecar) local inference: ASR → translation (→ optional TTS),
  * served by the Python sidecar over localhost WebSocket. Separate from the WASM
@@ -136,15 +106,11 @@
 /**
  * Union type for all possible session configurations
  */
-export type SessionConfig = LocalInferenceSessionConfig | LocalNativeSessionConfig;
+export type SessionConfig = LocalNativeSessionConfig;
 
 /**
  * Type guards for session configurations
  */
-export function isLocalInferenceSessionConfig(config: SessionConfig): config is LocalInferenceSessionConfig {
-  return config.provider === 'local_inference';
-}
-
 export function isLocalNativeSessionConfig(config: SessionConfig): config is LocalNativeSessionConfig {
   return config.provider === 'local_native';
 }
`````

`src/services/providers/ProviderConfigFactory.ts`

`````diff t09
diff --git a/src/services/providers/ProviderConfigFactory.ts b/src/services/providers/ProviderConfigFactory.ts
--- a/src/services/providers/ProviderConfigFactory.ts
+++ b/src/services/providers/ProviderConfigFactory.ts
@@ -1,6 +1,5 @@
 import { ProviderConfig } from './ProviderConfig';
 import { ProviderDescriptor } from './ProviderDescriptor';
-import { LocalInferenceProviderConfig } from './LocalInferenceProviderConfig';
 import { LocalNativeProviderConfig } from './LocalNativeProviderConfig';
 import { Provider, ProviderType } from '../../types/Provider';
 import { isLocalNativeEnabled, isElectron } from '../../utils/environment';
@@ -9,18 +8,9 @@
   private static configs: Map<ProviderType, ProviderDescriptor> = new Map();
 
   static {
-    // Registration order here defines the order providers appear in the UI
-    // list (the configs Map preserves insertion order). Each provider keeps
-    // its own environment / feature-flag guard. The order is a product
~ 7 more removed lines sha256:ccdef3c8427e
-    // 9. Everything else.
-    // Native (Electron sidecar) local inference — Electron only, behind feature flag.
+    // Local Native, the one provider the old registry still holds (Stage 2
+    // deletion, ruling 1): Electron only, behind its gate. Every other
+    // provider is the new registry's (`src/providers/registry.ts`).
     if (isElectron() && isLocalNativeEnabled()) {
       ProviderConfigFactory.configs.set(Provider.LOCAL_NATIVE, new LocalNativeProviderConfig());
     }
`````

`src/services/providers/astGuard.test.ts`

`````diff t09
diff --git a/src/services/providers/astGuard.test.ts b/src/services/providers/astGuard.test.ts
--- a/src/services/providers/astGuard.test.ts
+++ b/src/services/providers/astGuard.test.ts
@@ -1,20 +1,16 @@
 import { describe, it, expect, beforeEach } from 'vitest';
-import { ProviderConfigFactory } from './ProviderConfigFactory';
-import { Provider } from '../../types/Provider';
-import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
-import { createParticipantLocalInferenceConfig } from './localParticipantConfig';
 import { guardAstCrossStage } from './astGuard';
 import { useModelStore } from '../../stores/modelStore';
 import { directionKey, type Selections } from '../../lib/local-inference/selection/types';
-import type { LocalInferenceSessionConfig } from '../interfaces/IClient';
 
 // Reproduces the AST cross-stage hazard: 'granite-speech' is an AST-capable
 // ASR model (astLanguages covers ja transcribe / en translate — see
 // modelManifest.ts). Explicitly picking it as the TRANSLATION stage for
 // ja→en, while the ASR stage resolves (auto or explicit) to a DIFFERENT
 // model, must not reach the session config as translationModelId — it would
-// fail LocalInferenceClient's `translationModelId === asrModelId` AST check
-// and construct a real TranslationEngine against Granite's AST-only files.
+// fail the AST check (`providers/localInference/config.ts`: the translation
+// id equals the ASR id) and construct a real TranslationEngine against
+// Granite's AST-only files.
 describe('AST cross-stage guard', () => {
   const dir = directionKey('ja', 'en');
 
@@ -93,64 +89,4 @@
       expect(guarded).toEqual(resolved);
     });
   });
-
-  describe('LocalInferenceProviderConfig.buildSessionConfig (speaker direction)', () => {
-    it('reports the auto translation pick, not the AST-capable ASR id, in the built config', () => {
~ 55 more removed lines sha256:17a2574a98f9
-    });
-  });
 });
`````

`src/services/providers/astGuard.ts`

`````diff t09
diff --git a/src/services/providers/astGuard.ts b/src/services/providers/astGuard.ts
--- a/src/services/providers/astGuard.ts
+++ b/src/services/providers/astGuard.ts
@@ -7,10 +7,10 @@
  * doc comment), so a user can explicitly pick an AST-capable ASR model (e.g.
  * Granite Speech) as the TRANSLATION stage while the ASR stage of the same
  * direction resolves — auto or explicit — to a different model.
- * LocalInferenceClient only enters AST mode when `translationModelId ===
- * asrModelId` (LocalInferenceClient.ts); anything else constructs a real
- * TranslationEngine (opus-mt) against AST-only model files, which fails at
- * runtime with no gate and no note.
+ * The LocalInference builder enters AST mode only when the translation id
+ * equals the ASR id (`src/providers/localInference/config.ts`); anything
+ * else constructs a real TranslationEngine (opus-mt) against AST-only model
+ * files, which fails at runtime with no gate and no note.
  *
  * This runs AFTER resolution, at the config-building boundary, rather than
  * teaching the resolver itself about a cross-stage constraint — resolving
@@ -26,12 +26,11 @@
  * selection instead.
  *
  * Pure: the re-resolution is injected as `reResolve` rather than reached via
- * a static `useModelStore` import — a store importing this module back (see
- * modelStore.ts's `ensureSelectionReady`, which applies this guard to the
- * speaker direction before computing readiness) would otherwise cycle.
- * Callers that already hold a resolver in scope (LocalInferenceProviderConfig,
- * localParticipantConfig) pass `useModelStore.getState().resolve` bound to
- * the direction; modelStore.ts passes its own `get().resolve`.
+ * a static `useModelStore` import. Its callers, the LocalInference
+ * provider's `config.ts` and `check.ts`, pass a resolver bound to the
+ * direction; the old descriptor, participant config and
+ * `modelStore.ensureSelectionReady` that called it went with the old code
+ * (Stage 2 deletion, ruling 3).
  */
 export function guardAstCrossStage(
   src: string,
`````

`src/services/providers/descriptorRegistry.test.ts`

`````diff t09
diff --git a/src/services/providers/descriptorRegistry.test.ts b/src/services/providers/descriptorRegistry.test.ts
--- a/src/services/providers/descriptorRegistry.test.ts
+++ b/src/services/providers/descriptorRegistry.test.ts
@@ -13,20 +13,18 @@
 import { DEFAULT_CHUNK_SENTENCES } from '../../lib/segmentation/segmentationMode';
 import { Provider } from '../../types/Provider';
 import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
-import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
 import en from '../../locales/en/translation.json';
 
 // Map each provider's settingsSliceKey to its per-module default settings slice,
 // so buildSessionConfig can be exercised for every registered provider.
 const DEFAULTS_BY_SLICE: Record<string, unknown> = {
-  localInference: defaultLocalInferenceSettings,
   localNative: defaultLocalNativeSettings,
 };
 
 describe('provider registry descriptors', () => {
   it('returns a descriptor for every available provider', () => {
     const ids = ProviderConfigFactory.getAvailableProviders();
-    expect(ids.length).toBe(2);
+    expect(ids.length).toBe(1);
     for (const id of ids) {
       const d = ProviderConfigFactory.getDescriptor(id);
       expect(d.getConfig().id).toBe(id);
@@ -53,17 +51,9 @@
   });
 });
 
-describe('descriptor.extractCredentials', () => {
-  it('local inference needs no credentials', async () => {
-    expect(await ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE).extractCredentials({}, {}))
-      .toEqual({ ok: true, primary: '' });
-  });
-});
-
 describe('descriptor.buildSessionConfig', () => {
   it('builds a config whose provider tag matches, for every provider, from defaults', () => {
     const wireTag: Record<string, string> = {
-      local_inference: 'local_inference',
       local_native: 'local_native',
     };
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
@@ -106,7 +96,6 @@
   // deletion, ruling C1), so every table below names only the providers the
   // old registry still registers.
   const EXPECTED_SLICE_KEYS: Partial<Record<Provider, string>> = {
-    [Provider.LOCAL_INFERENCE]: 'localInference',
     // Registered only under Electron with its gate on — both forced on by
     // this file's environment mock.
     [Provider.LOCAL_NATIVE]: 'localNative',
@@ -122,7 +111,6 @@
   // Exact expected supportsWebRTC per provider. Relay/twin and non-WebRTC
   // providers must not silently inherit `true` from a base descriptor.
   const EXPECTED_SUPPORTS_WEBRTC: Partial<Record<Provider, boolean>> = {
-    [Provider.LOCAL_INFERENCE]: false,
     [Provider.LOCAL_NATIVE]: false,
   };
 
@@ -143,9 +131,9 @@
   });
 
   it('extractCredentials on an empty slice never returns ok (except credential-free providers)', async () => {
-    const credentialFree = new Set([Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE]);
+    const credentialFree = new Set([Provider.LOCAL_NATIVE]);
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
-      if (credentialFree.has(id) || id.startsWith('kizunaai')) continue;
+      if (credentialFree.has(id)) continue;
       const r = await ProviderConfigFactory.getDescriptor(id).extractCredentials({}, {});
       expect(r.ok, id).toBe(false);
     }
@@ -154,20 +142,17 @@
 
 describe('S1 capability flags', () => {
   const PUSH_GATED: Partial<Record<Provider, string[] | undefined>> = {
-    [Provider.LOCAL_INFERENCE]: ['Push-to-Talk', 'Push-to-Translate'],
     [Provider.LOCAL_NATIVE]: ['Push-to-Talk', 'Push-to-Translate'],
   };
 
   const TEXT_INPUT: Partial<Record<Provider, boolean | undefined>> = {
-    [Provider.LOCAL_INFERENCE]: true,
     [Provider.LOCAL_NATIVE]: true,
   };
 
   const QUEUES_TEXT: Provider[] = [];
-  const LOCAL_PROMPT: Provider[] = [Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE];
+  const LOCAL_PROMPT: Provider[] = [Provider.LOCAL_NATIVE];
 
   const PTT_FINALIZATION: Partial<Record<Provider, { silenceTailFrames?: number; response: string } | undefined>> = {
-    [Provider.LOCAL_INFERENCE]: { silenceTailFrames: 7, response: 'always' },
     [Provider.LOCAL_NATIVE]: { silenceTailFrames: 7, response: 'always' },
   };
 
@@ -178,7 +163,6 @@
     // 1-5 is what slice 3 shipped on the local engines; phase 2 adds Auto,
     // where the VAD utterance is the boundary someone else already decided
     // and the stage only fills the punctuation in.
-    [Provider.LOCAL_INFERENCE]: { pause: false, auto: true, sizes: true },
     [Provider.LOCAL_NATIVE]: { pause: false, auto: true, sizes: true },
   };
 
@@ -190,7 +174,6 @@
   // without turn detection it renders nothing and must not claim to. A2 moved
   // the two pause clients' sliders into the segmentation section.
   const SILENCE_DURATION: Partial<Record<Provider, boolean>> = {
-    [Provider.LOCAL_INFERENCE]: false,
     [Provider.LOCAL_NATIVE]: false,
   };
 
@@ -333,8 +316,8 @@
     const { ClientFactory } = await import('../clients/ClientFactory');
     expect(() => ClientFactory.createClient('m', Provider.PALABRA_AI, ''))
       .toThrow(/API key is required/);
-    // LOCAL_INFERENCE never had credentials — must keep working with ''
-    expect(ClientFactory.createClient('m', Provider.LOCAL_INFERENCE, '')).toBeTruthy();
+    // LOCAL_NATIVE has no credentials — must keep working with ''
+    expect(ClientFactory.createClient('m', Provider.LOCAL_NATIVE, '')).toBeTruthy();
   });
 });
 
@@ -363,8 +346,8 @@
 });
 
 describe('S4 prepareToStart', () => {
-  it('is declared only where a provider has pre-start work (the locals)', () => {
-    const WITH_HOOK = [Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE];
+  it('is declared only where a provider has pre-start work (Local Native)', () => {
+    const WITH_HOOK = [Provider.LOCAL_NATIVE];
     for (const id of ProviderConfigFactory.getAvailableProviders()) {
       const d = ProviderConfigFactory.getDescriptor(id);
       expect(typeof d.prepareToStart === 'function', `hook presence for ${id}`)
`````

`src/services/providers/localParticipantConfig.ts`

`````diff t09
diff --git a/src/services/providers/localParticipantConfig.ts b/src/services/providers/localParticipantConfig.ts
--- a/src/services/providers/localParticipantConfig.ts
+++ b/src/services/providers/localParticipantConfig.ts
@@ -1,12 +1,10 @@
-import { LocalInferenceSessionConfig, LocalNativeSessionConfig } from '../interfaces/IClient';
-import { estimateModelMemoryByDevice } from '../../lib/local-inference/modelManifest';
+import { LocalNativeSessionConfig } from '../interfaces/IClient';
 import { useNativeModelStore } from '../../stores/nativeModelStore';
-import { useModelStore } from '../../stores/modelStore';
-import { guardAstCrossStage } from './astGuard';
 import type { Selections } from '../../lib/local-inference/selection/types';
 
 /**
- * Participant-channel model resolution for the two local providers.
+ * Participant-channel model resolution for Local Native, the local provider
+ * the old registry keeps (Stage 2 deletion, ruling 1).
  *
  * Lived in settingsStore.ts by historical accident: these functions read the
  * MODEL stores (modelStore / nativeModelStore) — readiness state — not
@@ -32,111 +30,6 @@
  * a field or borrows the speaker's chosen models.
  */
 
-/** Fraction of navigator.deviceMemory used as the system RAM model budget. */
-const RAM_BUDGET_RATIO = 0.75;
-/** Conservative fallback when navigator.deviceMemory is unavailable (GB). */
~ 100 more removed lines sha256:338955eacd42
-}
-
 export type ParticipantLocalNativeResult =
   | { success: true; config: LocalNativeSessionConfig; translationAvailable: boolean }
   | { success: false; reason: 'no_asr'; detail: string };
`````

`src/services/providers/participantConfig.test.ts`

`````diff t09
diff --git a/src/services/providers/participantConfig.test.ts b/src/services/providers/participantConfig.test.ts
--- a/src/services/providers/participantConfig.test.ts
+++ b/src/services/providers/participantConfig.test.ts
@@ -9,24 +9,18 @@
 }));
 
 vi.mock('./localParticipantConfig', () => ({
-  createParticipantLocalInferenceConfig: vi.fn(),
   createParticipantLocalNativeConfig: vi.fn(),
 }));
 
 import { ProviderConfigFactory } from './ProviderConfigFactory';
 import { Provider } from '../../types/Provider';
-import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
 import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
-import { createParticipantLocalInferenceConfig, createParticipantLocalNativeConfig } from './localParticipantConfig';
+import { createParticipantLocalNativeConfig } from './localParticipantConfig';
 import { useNativeModelStore } from '../../stores/nativeModelStore';
 import { directionKey } from '../../lib/local-inference/selection/types';
 import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
-import type {
-  LocalInferenceSessionConfig,
-  LocalNativeSessionConfig,
-} from '../interfaces/IClient';
+import type { LocalNativeSessionConfig } from '../interfaces/IClient';
 
-const mockedLocalInference = vi.mocked(createParticipantLocalInferenceConfig);
 const mockedLocalNative = vi.mocked(createParticipantLocalNativeConfig);
 
 const shell = { keepReplayAudio: false };
@@ -55,62 +49,9 @@
 
 describe('participant config: local providers (mocked helpers)', () => {
   beforeEach(() => {
-    mockedLocalInference.mockReset();
     mockedLocalNative.mockReset();
   });
 
-  it('local_inference: success with translation available maps to config + no notices', () => {
-    const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE);
-    const slice = { ...defaultLocalInferenceSettings };
~ 47 more removed lines sha256:afd6097fa2b9
-  });
-
   it('local_native: failure returns null config + error notice', () => {
     const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_NATIVE);
     const slice = { ...defaultLocalNativeSettings };
@@ -123,7 +64,7 @@
     expect(notices).toEqual([{ channel: 'error', message: 'No ASR model available for en' }]);
   });
 
-  it('local_native: translationAvailable false emits the exact source → target warning template (direction differs from local_inference)', () => {
+  it('local_native: translationAvailable false emits the exact source → target warning template', () => {
     const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_NATIVE);
     const slice = { ...defaultLocalNativeSettings };
     mockedLocalNative.mockReturnValue({
@@ -147,21 +88,7 @@
     expect(notices).toEqual([]);
   });
 
-  it('local_inference and local_native pass the BASE participant config (textOnly already applied) to their helper', () => {
-    const dInf = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE);
-    mockedLocalInference.mockReturnValue({
~ 10 more removed lines sha256:283d9759b571
-    expect(argInf.keepReplayAudio).toBe(false);
-
+  it('local_native passes the BASE participant config (textOnly already applied) to its helper', () => {
     const dNat = ProviderConfigFactory.getDescriptor(Provider.LOCAL_NATIVE);
     mockedLocalNative.mockReturnValue({ success: true, translationAvailable: true, config: {} as LocalNativeSessionConfig });
     dNat.buildParticipantSessionConfig({ ...defaultLocalNativeSettings }, 'i', shell);
`````

`src/services/providers/prepareToStart.local.test.ts`

`````diff t09
diff --git a/src/services/providers/prepareToStart.local.test.ts b/src/services/providers/prepareToStart.local.test.ts
--- a/src/services/providers/prepareToStart.local.test.ts
+++ b/src/services/providers/prepareToStart.local.test.ts
@@ -30,7 +30,7 @@
     signal: new AbortController().signal,
   });
 
-  for (const id of [Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE]) {
+  for (const id of [Provider.LOCAL_NATIVE]) {
     it(`${id}: valid revalidation → bare ok`, async () => {
       const d = ProviderConfigFactory.getDescriptor(id);
       const p = ports({ valid: true });
`````

`src/stores/modelStore.test.ts`

`````diff t09
diff --git a/src/stores/modelStore.test.ts b/src/stores/modelStore.test.ts
--- a/src/stores/modelStore.test.ts
+++ b/src/stores/modelStore.test.ts
@@ -3,18 +3,6 @@
 import { ModelImportError } from '../lib/local-inference/modelImport';
 import { directionKey } from '../lib/local-inference/selection/types';
 
-// modelStore now statically imports settingsStore (for `resolve`/`applyPrunes`
-// to read and write localInference.selections) — stub the persistence layer
-// settingsStore's updateProviderSlice touches, same as settingsStore.test.ts.
~ 7 more removed lines sha256:76449d1eff98
-}));
-
 // Mock modelManifest functions
 const mockGetManifestEntry = vi.fn();
 const mockGetAsrModelsForLanguage = vi.fn();
@@ -63,206 +51,6 @@
 }));
 
 const { useModelStore } = await import('./modelStore');
-const { default: useSettingsStore } = await import('./settingsStore');
-
-describe('ensureSelectionReady', () => {
~ 195 more removed lines sha256:bd980dd96fea
-  });
-});
 
 describe('importModel', () => {
   const mockImportModelFiles = vi.fn();
@@ -418,12 +206,6 @@
     // mockGetManifestByType wired to their own fixtures, and clearAllMocks
     // doesn't reset implementations.
     mockGetManifestByType.mockReturnValue([]);
-    // applyPrunes reaches the real settingsStore via a dynamic import — reset
-    // it so a leftover selection from another describe block can't leak in.
-    // Awaited: updateLocalInference persists asynchronously (updateProviderSlice),
-    // so an unawaited call here can still be in flight when the next test's
-    // assertions run.
-    await useSettingsStore.getState().updateLocalInference({ selections: {} });
   });
 
   it('resolves a direction from the manifest and current download statuses', () => {
@@ -444,20 +226,4 @@
     useModelStore.getState().resolve('ja', 'en', selections);
     expect(JSON.stringify(selections)).toBe(before);
   });
-
-  it('applyPrunes clears only the named stages and drops an all-auto direction', async () => {
-    const dir = directionKey('ja', 'en');
~ 11 more removed lines sha256:9bf8663e6677
-    expect(useSettingsStore.getState().localInference.selections[dir]).toBeUndefined();
-  });
 });
`````

`src/stores/modelStore.ts`

`````diff t09
diff --git a/src/stores/modelStore.ts b/src/stores/modelStore.ts
--- a/src/stores/modelStore.ts
+++ b/src/stores/modelStore.ts
@@ -2,7 +2,7 @@
  * Model Store — Zustand store for reactive model download/status UI state.
  *
  * Tracks download progress, model readiness, and storage usage.
- * Used by ModelManagementSection for rendering and by settingsStore for provider gating.
+ * Used by ModelManagementSection for rendering and by the LocalInference provider's readiness check.
  */
 
 import { create } from 'zustand';
@@ -17,9 +17,8 @@
 import { checkWebGPU } from '../utils/webgpu';
 import { resolveDirection } from '../lib/local-inference/selection/resolveStage';
 import { wasmCandidates } from '../lib/local-inference/selection/candidates.wasm';
-import { guardAstCrossStage } from '../services/providers/astGuard';
-import { directionKey, emptyDirection, type DirectionResult, type ResolutionNote, type Selections, type Stage } from '../lib/local-inference/selection/types';
-import { reportError, reportWarning, describeCause } from '../lib/diagnostics/report';
+import { directionKey, type DirectionResult, type Selections } from '../lib/local-inference/selection/types';
+import { reportError } from '../lib/diagnostics/report';
 
 // ─── Types ───────────────────────────────────────────────────────────────────
 
@@ -54,13 +53,6 @@
   deviceFeatures: string[];
   /** Downloaded variant key per model (modelId → variant key) */
   modelVariants: Record<string, string>;
-  /** Every note the last {@link ensureSelectionReady} call produced (speaker +
-   *  participant directions), for the UI to render in place of the generic
-   *  `localInferenceModelsRequired` string. Plan 2 owns the rendering; this
-   *  store only stashes the value so it has somewhere to live in the
-   *  meantime. Cleared to `[]` when nothing is amiss. */
-  lastResolutionNotes: ResolutionNote[];
-
   /** Initialize: scan IndexedDB for existing models */
   initialize: () => Promise<void>;
   /** Start downloading a model */
@@ -87,46 +79,6 @@
    * choice from a machine's guess.
    */
   resolve: (src: string, tgt: string, selections: Selections) => DirectionResult;
-  /**
-   * The one write the resolver can cause: an id the manifest no longer knows
-   * can never resolve again, so keeping it only produces a note the user
~ 35 more removed lines sha256:a4a347ddff20
-   */
-  ensureSelectionReady: () => Promise<{ ready: boolean; notes: ResolutionNote[] }>;
 }
 
 // ─── Store ───────────────────────────────────────────────────────────────────
@@ -153,7 +105,6 @@
     webgpuSoftwareOnly: false,
     deviceFeatures: [],
     modelVariants: {},
-    lastResolutionNotes: [],
 
     initialize: async () => {
       if (get().initialized) return;
@@ -404,12 +355,9 @@
     },
 
     /**
-     * Resolve one direction. Pure: takes `selections` as a parameter instead
-     * of reading settingsStore itself — settingsStore already dynamically
-     * imports this module (validateApiKey's LOCAL_INFERENCE arm), so a static
-     * import back would create a circular type dependency. Callers that have
-     * settingsStore in scope pass `useSettingsStore.getState().localInference
-     * .selections` straight through.
+     * Resolve one direction. Pure: takes `selections` as a parameter; the
+     * caller (the LocalInference provider, or the engine surface it renders)
+     * owns them.
      */
     resolve: (src, tgt, selections) => {
       const { modelStatuses, webgpuAvailable, deviceFeatures } = get();
@@ -420,131 +368,6 @@
       );
     },
 
-    /**
-     * The one write the resolver can cause: an id the manifest no longer knows
-     * can never resolve again, so keeping it only produces a note the user
~ 120 more removed lines sha256:f2332aed4536
-      return { ready, notes };
-    },
   })),
 );
 
@@ -560,4 +383,3 @@
 export const useWebGPUSoftwareOnly = () => useModelStore(s => s.webgpuSoftwareOnly);
 export const useDeviceFeatures = () => useModelStore(s => s.deviceFeatures);
 export const useModelVariants = () => useModelStore(s => s.modelVariants);
-export const useLastResolutionNotes = () => useModelStore(s => s.lastResolutionNotes);
`````

`src/stores/nativeModelStore.test.ts`

`````diff t09
diff --git a/src/stores/nativeModelStore.test.ts b/src/stores/nativeModelStore.test.ts
--- a/src/stores/nativeModelStore.test.ts
+++ b/src/stores/nativeModelStore.test.ts
@@ -1207,7 +1207,7 @@
     expect(useNativeModelStore.getState().resolve('ja', 'en', {}).asr).toBeNull();
   });
 
-  it('applyPrunes writes to the localNative slice, not localInference', async () => {
+  it('applyPrunes writes to the localNative slice', async () => {
     const { useSettingsStore } = await import('./settingsStore');
     const dir = directionKey('ja', 'en');
     useSettingsStore.setState({
@@ -1218,6 +1218,5 @@
     });
     await useNativeModelStore.getState().applyPrunes([{ direction: dir, stage: 'asr' }]);
     expect(useSettingsStore.getState().localNative.selections[dir].asr.modelId).toBe('');
-    expect(useSettingsStore.getState().localInference.selections[dir]).toBeUndefined();
   });
 });
`````

`src/stores/settingsStore.selections.test.ts`

`````diff t09
diff --git a/src/stores/settingsStore.selections.test.ts b/src/stores/settingsStore.selections.test.ts
--- a/src/stores/settingsStore.selections.test.ts
+++ b/src/stores/settingsStore.selections.test.ts
@@ -1,36 +1,21 @@
 import { describe, it, expect } from 'vitest';
-import { defaultLocalInferenceSettings } from '../services/providers/LocalInferenceProviderConfig';
 import { defaultLocalNativeSettings } from '../services/providers/LocalNativeProviderConfig';
 
-describe('local provider slices carry a selections map', () => {
-  for (const [name, defaults] of [
-    ['localInference', defaultLocalInferenceSettings as unknown as Record<string, unknown>],
~ 8 more removed lines sha256:9fc5c084df3b
-    expect(defaultLocalInferenceSettings.sourceLanguage).toBe('ja');
-    expect(defaultLocalInferenceSettings.targetLanguage).toBe('en');
+describe('the localNative slice carries a selections map', () => {
+  it('defaults to an empty selections map', () => {
+    expect(defaultLocalNativeSettings.selections).toEqual({});
   });
 });
 
 describe('the flat model fields are gone — selections is the only source', () => {
-  for (const [name, defaults] of [
-    ['localInference', defaultLocalInferenceSettings as unknown as Record<string, unknown>],
-    ['localNative', defaultLocalNativeSettings as unknown as Record<string, unknown>],
~ 7 more removed lines sha256:5504194b7c36
-    });
-  }
+  it('localNative no longer declares the flat model fields', () => {
+    // The loader reads Object.keys(defaults); anything still listed here is
+    // still loaded and still a second source of truth.
+    const defaults = defaultLocalNativeSettings as unknown as Record<string, unknown>;
+    expect(Object.keys(defaults)).not.toContain('asrModel');
+    expect(Object.keys(defaults)).not.toContain('translationModel');
+    expect(Object.keys(defaults)).not.toContain('ttsModel');
+  });
 
   it('localNative no longer declares the misnamed shared quant map', () => {
     expect(Object.keys(defaultLocalNativeSettings as unknown as Record<string, unknown>))
`````

`src/stores/settingsStore.sliceRegistry.test.ts`

`````diff t09
diff --git a/src/stores/settingsStore.sliceRegistry.test.ts b/src/stores/settingsStore.sliceRegistry.test.ts
--- a/src/stores/settingsStore.sliceRegistry.test.ts
+++ b/src/stores/settingsStore.sliceRegistry.test.ts
@@ -28,7 +28,6 @@
 
 /** action name → [sliceKey, sample patch] for the plain (no-special-case) slices */
 const PLAIN: Array<[string, string, Record<string, unknown>]> = [
-  ['updateLocalInference', 'localInference', { ttsSpeed: 1.5 }],
   ['updateLocalNative', 'localNative', { sourceLanguage: 'ja' }],
 ];
 
@@ -62,7 +61,6 @@
   // resolves, and the failure becomes one panel entry per key. Both failure
   // channels are exercised because the service can produce either.
   const ALL_SLICES: Array<[string, string, Record<string, unknown>]> = [
-    ['updateLocalInference', 'localInference', { ttsSpeed: 1.5 }],
     ['updateLocalNative', 'localNative', { sourceLanguage: 'ja' }],
   ];
 
@@ -113,7 +111,7 @@
     const s = useSettingsStore.getState() as any;
     // Spot every slice key is a populated object after load.
     for (const sliceKey of [
-      'localInference', 'localNative',
+      'localNative',
     ]) {
       expect(s[sliceKey], sliceKey).toBeTypeOf('object');
       expect(Object.keys(s[sliceKey]).length, sliceKey).toBeGreaterThan(0);
`````

`src/stores/settingsStore.test.ts`

`````diff t09
diff --git a/src/stores/settingsStore.test.ts b/src/stores/settingsStore.test.ts
--- a/src/stores/settingsStore.test.ts
+++ b/src/stores/settingsStore.test.ts
@@ -1,7 +1,6 @@
 import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
 import { Provider } from '../types/Provider';
 import { buildDefaultLocalPrompt } from '../lib/local-inference/prompts';
-import { directionKey } from '../lib/local-inference/selection/types';
 import useLogStore from './logStore';
 
 // Force platform detection so environment-gated providers are present in the
@@ -27,16 +26,6 @@
   },
 }));
 
-// Mock estimateModelMemoryByDevice so we can control memory budget checks
-const mockEstimateMemory = vi.fn().mockReturnValue({ vramMb: 0, ramMb: 0 });
-vi.mock('../lib/local-inference/modelManifest', async () => {
-  const actual = await vi.importActual('../lib/local-inference/modelManifest');
-  return {
-    ...actual,
-    estimateModelMemoryByDevice: (...args: any[]) => mockEstimateMemory(...args),
-  };
-});
-
 // Import after mocking
 const {
   default: useSettingsStore,
@@ -159,19 +148,6 @@
     });
   });
 
-  describe('Push-to-Translate persistence', () => {
-    it('persists Push-to-Translate for Local Inference', async () => {
-      const store = useSettingsStore.getState();
~ 8 more removed lines sha256:016179736fcc
-  });
-
   describe('keepReplayAudio', () => {
     it('defaults to false when storage has no stored value (loadSettings fallback)', async () => {
       // Mutate state to the OPPOSITE of the expected default first, so that
@@ -525,128 +501,6 @@
   });
 });
 
-describe('createParticipantLocalInferenceConfig', () => {
-  // The participant direction (target→source) is a peer of the speaker
-  // direction, not a reversal of it: it resolves from the real WASM manifest
~ 117 more removed lines sha256:9b09b72fdf1b
-});
-
 describe('updateProviderSlice (public generic action)', () => {
   // No beforeEach reset needed here: unlike the top-level `settingsStore`
   // describe (which resets `provider`/validation fields consumed by
@@ -661,11 +515,9 @@
     expect(useSettingsStore.getState().localNative.targetLanguage).toBe('ja');
   });
 
-  it('does not bleed into other slices or drop unpatched fields', async () => {
-    const inferenceBefore = useSettingsStore.getState().localInference;
+  it('does not drop unpatched fields', async () => {
     const sourceBefore = useSettingsStore.getState().localNative.sourceLanguage;
     await useSettingsStore.getState().updateProviderSlice('localNative', { targetLanguage: 'ko' });
-    expect(useSettingsStore.getState().localInference).toBe(inferenceBefore);
     expect(useSettingsStore.getState().localNative.sourceLanguage).toBe(sourceBefore);
   });
 
@@ -706,14 +558,13 @@
 describe('getProcessedLocalPrompt', () => {
   beforeEach(() => {
     useSettingsStore.setState({
-      provider: Provider.LOCAL_INFERENCE,
-      localInference: {
-        ...useSettingsStore.getState().localInference,
+      provider: Provider.LOCAL_NATIVE,
+      localNative: {
+        ...useSettingsStore.getState().localNative,
         sourceLanguage: 'ja',
         targetLanguage: 'en',
         useTemplateMode: true,
         systemPrompt: '',
-        participantSystemPrompt: '',
       },
     });
   });
@@ -730,8 +581,8 @@
 
   it('Advanced mode: returns the user speaker prompt verbatim', () => {
     useSettingsStore.setState({
-      localInference: {
-        ...useSettingsStore.getState().localInference,
+      localNative: {
+        ...useSettingsStore.getState().localNative,
         useTemplateMode: false,
         systemPrompt: 'My custom speaker prompt',
       },
@@ -742,8 +593,8 @@
 
   it('Advanced mode: empty speaker falls back to default', () => {
     useSettingsStore.setState({
-      localInference: {
-        ...useSettingsStore.getState().localInference,
+      localNative: {
+        ...useSettingsStore.getState().localNative,
         useTemplateMode: false,
         systemPrompt: '',
       },
@@ -752,39 +603,24 @@
     expect(result).toBe(buildDefaultLocalPrompt('ja', 'en'));
   });
 
-  it('Advanced mode: empty participant falls back to resolved speaker', () => {
+  it('Advanced mode: the participant takes the speaker prompt (Local Native has none of its own)', () => {
     useSettingsStore.setState({
-      localInference: {
-        ...useSettingsStore.getState().localInference,
+      localNative: {
+        ...useSettingsStore.getState().localNative,
         useTemplateMode: false,
         systemPrompt: 'Speaker says hi',
-        participantSystemPrompt: '',
       },
     });
     const result = useSettingsStore.getState().getProcessedLocalPrompt(true);
     expect(result).toBe('Speaker says hi');
   });
 
-  it('Advanced mode: participant filled returns participant text', () => {
+  it('Advanced mode: an empty prompt falls back to the default in both directions', () => {
     useSettingsStore.setState({
-      localInference: {
-        ...useSettingsStore.getState().localInference,
-        useTemplateMode: false,
~ 10 more removed lines sha256:64a8bc943ec5
-      localInference: {
-        ...useSettingsStore.getState().localInference,
+      localNative: {
+        ...useSettingsStore.getState().localNative,
         useTemplateMode: false,
         systemPrompt: '',
-        participantSystemPrompt: '',
       },
     });
     const speaker = useSettingsStore.getState().getProcessedLocalPrompt(false);
`````

`src/stores/settingsStore.ts`

`````diff t09
diff --git a/src/stores/settingsStore.ts b/src/stores/settingsStore.ts
--- a/src/stores/settingsStore.ts
+++ b/src/stores/settingsStore.ts
@@ -8,7 +8,6 @@
   SessionConfig,
   LocalNativeSessionConfig,
 } from '../services/interfaces/IClient';
-import { getManifestEntry } from '../lib/local-inference/modelManifest';
 import type { Stage } from '../lib/local-inference/selection/types';
 import { buildDefaultLocalPrompt } from '../lib/local-inference/prompts';
 import { type NativeReadinessReason } from '../lib/local-inference/native/nativeCatalog';
@@ -29,9 +28,6 @@
 import {ApiKeyValidationResult} from '../services/interfaces/ISettingsService';
 import {Provider, ProviderType} from '../types/Provider';
 import i18n from '../locales';
-import {
-  LocalInferenceSettings, defaultLocalInferenceSettings,
-} from '../services/providers/LocalInferenceProviderConfig';
 import {
   LocalNativeProviderConfig, LocalNativeSettings, defaultLocalNativeSettings,
 } from '../services/providers/LocalNativeProviderConfig';
@@ -54,13 +50,12 @@
 }
 
 export type {
-  LocalInferenceSettings, LocalNativeSettings,
+  LocalNativeSettings,
 };
 
 // Union of every provider's settings slice — the return type of
 // getCurrentProviderSettings, resolved dynamically via the active descriptor.
-export type ProviderSettingsUnion =
-  | LocalInferenceSettings | LocalNativeSettings;
+export type ProviderSettingsUnion = LocalNativeSettings;
 
 // ==================== Type Definitions ====================
 
@@ -244,7 +239,6 @@
   participantSystemInstructions: string;
 
   // Provider-specific settings
-  localInference: LocalInferenceSettings;
   localNative: LocalNativeSettings;
 
   // Validation state
@@ -359,7 +353,6 @@
   setParticipantSystemInstructions: (instructions: string) => void;
 
   // Provider settings actions
-  updateLocalInference: (settings: Partial<LocalInferenceSettings>) => void;
   updateLocalNative: (settings: Partial<LocalNativeSettings>) => void;
   /** Generic slice update keyed by descriptor.settingsSliceKey — the write
    *  half of the read path the reactive selectors already use. Same registry
@@ -388,20 +381,9 @@
 
 // ==================== Helper Functions ====================
 
-/**
- * Resolve the worker type for a specific translation model id.
- * Returns 'opus-mt' when the id is missing or not in the manifest.
- */
-export function resolveTranslationWorkerTypeForModelId(modelId: string | null | undefined): string {
-  if (!modelId) return 'opus-mt';
-  const entry = getManifestEntry(modelId);
-  if (!entry) return 'opus-mt';
-  return entry.translationWorkerType || (entry.multilingual ? 'qwen' : 'opus-mt');
-}
-
 // Moved beside the descriptors (their caller since the S2 participant-config
 // seam); re-exported here so existing importers keep working.
-export { createParticipantLocalInferenceConfig, createParticipantLocalNativeConfig } from '../services/providers/localParticipantConfig';
+export { createParticipantLocalNativeConfig } from '../services/providers/localParticipantConfig';
 
 /**
  * Back-compat wrapper: the canonical builder now lives on the descriptor
@@ -438,7 +420,6 @@
 };
 
 const PROVIDER_SLICE_REGISTRY = {
-  localInference: { defaults: defaultLocalInferenceSettings },
   localNative: { defaults: defaultLocalNativeSettings },
 } satisfies Record<string, SliceUpdateSpec>;
 
@@ -470,7 +451,6 @@
   subscribeWithSelector((set, get) => ({
     // === Initial State ===
     ...defaultCommonSettings,
-    localInference: defaultLocalInferenceSettings,
     localNative: defaultLocalNativeSettings,
 
     isApiKeyValid: null,
@@ -696,7 +676,6 @@
     },
 
     // === Provider Settings Actions ===
-    updateLocalInference: (settings) => updateProviderSlice(set, 'localInference', settings),
     updateLocalNative: (settings) => updateProviderSlice(set, 'localNative', settings),
     updateProviderSlice: (sliceKey, patch) => {
       // hasOwnProperty.call, not `in`: 'toString'/'constructor' must reject, not index the prototype (same idiom as previewSample).
@@ -756,32 +735,6 @@
         return { valid: ready, message, validating: false };
       }
 
-      // Local inference: check model readiness instead of API key.
-      // This is the SINGLE authority for LOCAL_INFERENCE session readiness.
-      if (provider === Provider.LOCAL_INFERENCE) {
~ 21 more removed lines sha256:662ff3f6a729
-      }
-
       // Get normalized credentials from the provider's descriptor — replaces
       // the four hand-copied per-provider extraction chains that used to live
       // here (see git history for the pre-descriptor shape).
@@ -1023,10 +976,10 @@
     },
 
     getProcessedLocalPrompt: (forParticipant = false) => {
-      // Both local providers share this path; read the active slice. LOCAL_NATIVE
-      // has no participant prompt, so its participant case falls back to speaker.
-      const st = get();
-      const s = st.provider === Provider.LOCAL_NATIVE ? st.localNative : st.localInference;
+      // Local Native's slice, the one local slice left (Stage 2 deletion,
+      // ruling 3). It has no participant prompt, so the participant case
+      // takes the speaker's, resolved for the reversed pair.
+      const s = get().localNative;
       const [srcLang, tgtLang] = forParticipant
         ? [s.targetLanguage, s.sourceLanguage]
         : [s.sourceLanguage, s.targetLanguage];
@@ -1034,12 +987,8 @@
       if (s.useTemplateMode) {
         return buildDefaultLocalPrompt(srcLang, tgtLang);
       }
-      // Advanced mode: speaker falls back to default if empty
-      const speakerResolved = s.systemPrompt.trim() || buildDefaultLocalPrompt(srcLang, tgtLang);
-      if (!forParticipant) return speakerResolved;
-      // Participant falls back to resolved speaker if empty
-      const participant = 'participantSystemPrompt' in s ? s.participantSystemPrompt.trim() : '';
-      return participant || speakerResolved;
+      // Advanced mode: an empty prompt falls back to the default.
+      return s.systemPrompt.trim() || buildDefaultLocalPrompt(srcLang, tgtLang);
     },
 
     createSessionConfig: (systemInstructions) => {
@@ -1094,7 +1043,6 @@
 export const useParticipantSystemInstructions = () => useSettingsStore((state) => state.participantSystemInstructions);
 
 // Provider settings
-export const useLocalInferenceSettings = () => useSettingsStore((state) => state.localInference);
 export const useLocalNativeSettings = () => useSettingsStore((state) => state.localNative);
 
 // Validation state
@@ -1153,7 +1101,6 @@
 export const useSetUseTemplateMode = () => useSettingsStore((state) => state.setUseTemplateMode);
 export const useSetParticipantSystemInstructions = () => useSettingsStore((state) => state.setParticipantSystemInstructions);
 
-export const useUpdateLocalInference = () => useSettingsStore((state) => state.updateLocalInference);
 export const useUpdateLocalNative = () => useSettingsStore((state) => state.updateLocalNative);
 
 export const useValidateApiKey = () => useSettingsStore((state) => state.validateApiKey);
@@ -1177,11 +1124,6 @@
 export const useCreateSessionConfig = () => useSettingsStore((state) => state.createSessionConfig);
 export const useNavigateToSettings = () => useSettingsStore((state) => state.navigateToSettings);
 
-// Local inference prompt hooks
-export const useLocalSystemPrompt = () => useSettingsStore((state) => state.localInference.systemPrompt);
-export const useLocalParticipantSystemPrompt = () => useSettingsStore((state) => state.localInference.participantSystemPrompt);
-export const useLocalUseTemplateMode = () => useSettingsStore((state) => state.localInference.useTemplateMode);
-
 // Current provider's Speech Mode (turnDetectionMode), or 'Auto' for providers
 // whose settings slice has no turnDetectionMode field (e.g. OpenAI Translate,
 // Palabra). Resolved via the active descriptor's slice key.
`````

---

### Task 10: The shared old code, down to Local Native (Wave 3)

With Local Native the old registry's only provider, what the store and the service layer kept for every provider goes (choice 5), and the kept shell's default is settled (ruling C4; choice 4).

**What goes, and what changes:**
- `validateApiKey`'s generic path — the old descriptors' `validateAndFetchModels` through `SettingsService.validateApiKeyAndFetchModels` and `ClientOperations.ts` — with its last user gone: `ClientOperations.ts`, the service method and its interface; `IClient.ts`' unread copy of `ApiKeyValidationResult` (the store's is `ISettingsService.ts`').
- `settingsStore.ts`: the four common instruction fields and their setters, `getProcessedSystemInstructions`, `validationCache`, `cacheTimestamp` (its two gate lines go), `loadingModels`, `fetchAvailableModels`, `getCurrentProviderSettings`, `getCurrentProviderConfig`, `useCurrentTurnDetectionMode`, `ProviderSettingsUnion`; `validateApiKey()` keeps its Local Native arm and answers "not valid" without a request for anything else; the default provider and the load's fallback say why they stay `Provider.OPENAI` (choice 4).
- `locales.consistency.test.ts`' turn-mode case walks `RealtimeTurnDetection`'s own modes and eagernesses (the old registry's modes left with it); `instructions.test.ts`' parity pin states the values (the old store's copy is gone); two tests' stubs (`AccountButton`, `useStartBasicsTour`) name what they stub.
- One key: `settings.validating`.
- **The four client diagnostic codes no sender uses** (the controller's ruling on open question 4): `cleanup_failed`, `input_pipeline_failed`, `send_dropped`, `lease_notify_failed`. Their last senders were the old OpenAI client (`send_dropped`, Task 7) and the old Palabra client (the first two, Task 8); `lease_notify_failed` had none even at `fa301e9a`; Local Native's old client sends only `tts_degraded` and `voice_fallback`, and no adapter sends any of the four. They leave `CLIENT_DIAGNOSTICS` (`src/lib/diagnostics/clientDiagnostics.ts`), the notice texts (`src/lib/view/noticeText.ts`) and the catalogs (`notices.*`, four keys); `Conversation.test.ts`' severity case degrades with `parse_error`, a warning, instead of `input_pipeline_failed` — no code in the table is an error now.
- `storedSettings.ts`' comment on `storedProviderValue`, which said the old store reads a stored provider "as the provider it is instead of falling back to OpenAI" — false since choice 4 — a comment-only exception to the read-only `src/lib/session`.
- **The import guard** (Revision 1), `src/providers/oldPath.consistency.test.ts`, new, three tests: no file outside the old path's own (`src/services/`, the kept shell's `LanguageSection` and `ProviderSection`, `settingsStore.ts` and two of their tests) imports a module of `src/services/clients/`, `src/services/providers/` or `src/services/interfaces/` by value — a static import or re-export, a side-effect import, a dynamic `import()` with a literal specifier or a `require()`, read with the TypeScript parser as `sessionSide.consistency.test.ts` reads imports — but the four shared leaves the new code takes (`ProviderConfig`, `astGuard`, `tutorialUrls`, and `ISettingsService`, the settings service's interface). Revision 2 widened the old set to `interfaces/` (`IClient.ts`): outside the old path, only type imports reach that folder (`loadStores.ts`', `setupStore.test.ts`' and `settingsStore.participantNative.test.ts`', all `import type`; checked). It lands here, where the old set is final. The review's mutant — `export const mutant = () => import('../../services/clients/ClientFactory');` appended to `src/providers/soniox/adapter.ts` — fails it (`src/providers/soniox/adapter.ts: src/services/clients/ClientFactory`), and so do a side-effect `import '../../services/providers/LocalNativeProviderConfig';` in `src/providers/gemini/wire.ts` and the re-check's `import { isLocalNativeSessionConfig } from '../services/interfaces/IClient';` in `src/app/loadStores.ts` (`src/app/loadStores.ts: src/services/interfaces/IClient`; each measured on the result, then reverted); tsc and the builds pass all three, the modules existing. Not scanned: `import x = require()` and a computed `import()` specifier, neither used anywhere in `src`.

**Files:**
- Delete (1): `src/services/ClientOperations.ts`
- Create (1, by the blocks below): `src/providers/oldPath.consistency.test.ts`
- Modify (14, by the blocks below): `src/components/TitleBar/AccountButton.test.tsx`, `src/components/Tour/useStartBasicsTour.test.tsx`, `src/lib/conversation/Conversation.test.ts`, `src/lib/diagnostics/clientDiagnostics.ts`, `src/lib/provider/instructions.test.ts`, `src/lib/session/storedSettings.ts`, `src/lib/view/noticeText.ts`, `src/locales/locales.consistency.test.ts`, `src/services/SettingsService.ts`, `src/services/interfaces/IClient.ts`, `src/services/interfaces/ISettingsService.ts`, `src/services/providers/descriptorRegistry.test.ts`, `src/stores/settingsStore.test.ts`, `src/stores/settingsStore.ts`
- The 30 locale catalogs `src/locales/*/translation.json`, by the key tool (5 keys)

**Interfaces:**
- Consumes: Task 9.
- Produces: `settingsStore.validateApiKey: () => Promise<ApiKeyValidationResult>`; no instruction fields in the old store (the new providers read the stored keys as legacy keys); `ClientDiagnosticCode` without the four codes; the old set final, and its guard; the gate at 16 lines.

- [ ] **Step 1: Delete the files.**

  ```
  git rm -q -- src/services/ClientOperations.ts
  ```

- [ ] **Step 2: Apply the task's diff blocks** (Global Constraints: never by hand).

  ```
  python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/plan-apply.py docs/superpowers/plans/2026-09-30-client-contract-stage2-deletion.md t10
  ```

  Expected: `t10: 15 files changed`, and no other line.

- [ ] **Step 3: Remove the locale keys only the deleted code read.**

  ```
  node /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/drop-locale-keys.mjs . notices.cleanup_failed notices.input_pipeline_failed notices.lease_notify_failed notices.send_dropped settings.validating
  ```

  Expected: `5 keys removed from 30 catalogs`.

- [ ] **Step 4: Check that nothing reaches what went.**

  ```
  git grep -nE "ClientOperations|getProcessedSystemInstructions|validationCache|fetchAvailableModels|cacheTimestamp|cleanup_failed|input_pipeline_failed|send_dropped|lease_notify_failed|still loaded until Stage 2" -- src/stores src/services src/components src/lib/diagnostics src/lib/view src/lib/conversation src/lib/session src/locales
  ```

  Expected: nothing (exit status 1).

- [ ] **Step 5: Run the gates.** Each command as its own call; every expected number is the replay's.

  - `npx vitest run src`: **532 files passed and 1 skipped (533); 6 656 tests passed and 2 skipped (6 658)**; 0 failed, no unhandled errors.
  - `npx vitest run electron`: 34 files, 477 tests passed. `npx vitest run extension`: 9 files, 56 tests passed.
  - Local Native's old path: `npx vitest run src/services src/lib/local-inference/native src/components/Settings/sections/Native src/components/Settings/engine/useNativeEngineAdapter src/stores/nativeModelStore src/stores/settingsStore` — 39 files, 615 tests passed.
  - The typecheck, as a set: `npx tsc --noEmit -p tsconfig.json > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t10.txt`, then `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t09.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t10.txt` prints exactly `before 98 after 95; new 0; gone 3` and exits 0 — no error the task before did not have; `after 95` is the full tree's count.
  - **The gate's baseline drops to 16 lines.** First check `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh` prints exactly these lines —

    ```
    src/App.tsx: error TS6133: 'React' is declared but its value is never read.
    src/components/MainLayout/MainLayout.tsx: error TS6133: 'useTranslation' is declared but i
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
    src/utils/environment.ts: error TS2717: Subsequent property declarations must have the sam
    src/utils/environment.ts: error TS2339: Property 'create' does not exist on type '{ query(
    ```

    — then write them, and nothing else, to `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` (this plan's own baseline file, outside the repository; the Write tool). From here on the gate is that file.

- [ ] **Step 6: Commit.**

```bash
git add -- src/components/TitleBar/AccountButton.test.tsx src/components/Tour/useStartBasicsTour.test.tsx src/lib/conversation/Conversation.test.ts src/lib/diagnostics/clientDiagnostics.ts src/lib/provider/instructions.test.ts src/lib/session/storedSettings.ts src/lib/view/noticeText.ts src/locales/locales.consistency.test.ts src/providers/oldPath.consistency.test.ts src/services/SettingsService.ts src/services/interfaces/IClient.ts src/services/interfaces/ISettingsService.ts src/services/providers/descriptorRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts 'src/locales/*/translation.json'
```

```bash
git commit -q -F - -- src/services/ClientOperations.ts src/components/TitleBar/AccountButton.test.tsx src/components/Tour/useStartBasicsTour.test.tsx src/lib/conversation/Conversation.test.ts src/lib/diagnostics/clientDiagnostics.ts src/lib/provider/instructions.test.ts src/lib/session/storedSettings.ts src/lib/view/noticeText.ts src/locales/locales.consistency.test.ts src/providers/oldPath.consistency.test.ts src/services/SettingsService.ts src/services/interfaces/IClient.ts src/services/interfaces/ISettingsService.ts src/services/providers/descriptorRegistry.test.ts src/stores/settingsStore.test.ts src/stores/settingsStore.ts 'src/locales/*/translation.json' <<'EOF'
refactor(settings): trim the shared old code to Local Native

Local Native is the old registry's only provider. Delete what the old
store and service layer kept for every provider: ClientOperations, the
key-validation service call, the global instruction fields, the
validation cache and model list, and the generic slice readers. The
kept shell's default stays an id the old registry does not hold.
Delete the four client diagnostic codes no sender uses, and add a test
that no file outside the old path imports it by value.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

**The blocks** (`t10`, one per file, in the order the applier takes them):

`src/components/TitleBar/AccountButton.test.tsx`

`````diff t10
diff --git a/src/components/TitleBar/AccountButton.test.tsx b/src/components/TitleBar/AccountButton.test.tsx
--- a/src/components/TitleBar/AccountButton.test.tsx
+++ b/src/components/TitleBar/AccountButton.test.tsx
@@ -11,10 +11,9 @@
 vi.mock('./useBalanceShortfall', () => ({ useBalanceShortfall: () => shortfall.value }));
 
 // providerStore imports ServiceFactory at module scope, which chains into
-// SettingsService -> ClientOperations -> ProviderConfigFactory (a static
-// initializer that reads isKizunaAIEnabled at import time) and into i18n's
-// own setup. Stubbed, as every other test that pulls in the real
-// providerStore does, so this file stays scoped to AccountButton's wiring.
+// SettingsService and into i18n's own setup. Stubbed, as every other test
+// that pulls in the real providerStore does, so this file stays scoped to
+// AccountButton's wiring.
 vi.mock('../../services/ServiceFactory', () => ({
   ServiceFactory: {
     getSettingsService: () => ({
`````

`src/components/Tour/useStartBasicsTour.test.tsx`

`````diff t10
diff --git a/src/components/Tour/useStartBasicsTour.test.tsx b/src/components/Tour/useStartBasicsTour.test.tsx
--- a/src/components/Tour/useStartBasicsTour.test.tsx
+++ b/src/components/Tour/useStartBasicsTour.test.tsx
@@ -7,10 +7,9 @@
 import { render, screen, fireEvent, cleanup } from '@testing-library/react';
 
 // providerStore imports ServiceFactory at module scope, which chains into
-// SettingsService -> ClientOperations -> ProviderConfigFactory (a static
-// initializer reading isKizunaAIEnabled at import time) and into i18n's own
-// setup. Stubbed, as every other test that pulls in the real providerStore
-// does, so this file stays scoped to the hook's own wiring.
+// SettingsService and into i18n's own setup. Stubbed, as every other test
+// that pulls in the real providerStore does, so this file stays scoped to the
+// hook's own wiring.
 vi.mock('../../services/ServiceFactory', () => ({
   ServiceFactory: {
     getSettingsService: () => ({
`````

`src/lib/conversation/Conversation.test.ts`

`````diff t10
diff --git a/src/lib/conversation/Conversation.test.ts b/src/lib/conversation/Conversation.test.ts
--- a/src/lib/conversation/Conversation.test.ts
+++ b/src/lib/conversation/Conversation.test.ts
@@ -165,11 +165,11 @@
   it('turns failed into an error notice and degraded into a notice with the table\'s severity', () => {
     const { conv, apply } = make();
     apply({ kind: 'failed', payload: { message: 'socket died', code: 'E1' } });
-    apply({ kind: 'degraded', payload: { code: 'input_pipeline_failed', message: 'mic gone' } });
+    apply({ kind: 'degraded', payload: { code: 'parse_error', message: 'bad frame' } });
     apply({ kind: 'degraded', payload: { code: 'tts_degraded', message: 'no voice' } });
     expect(conv.snapshot().notices.map((n) => [n.severity, n.message, n.code])).toEqual([
       ['error', 'socket died', 'E1'],
-      ['error', 'mic gone', 'input_pipeline_failed'],
+      ['warning', 'bad frame', 'parse_error'],
       ['warning', 'no voice', 'tts_degraded'],
     ]);
     expect(conv.snapshot().notices[0].id).toBe('s1:speaker:n1');
`````

`src/lib/diagnostics/clientDiagnostics.ts`

`````diff t10
diff --git a/src/lib/diagnostics/clientDiagnostics.ts b/src/lib/diagnostics/clientDiagnostics.ts
--- a/src/lib/diagnostics/clientDiagnostics.ts
+++ b/src/lib/diagnostics/clientDiagnostics.ts
@@ -26,20 +26,12 @@
 export const CLIENT_DIAGNOSTICS = {
   /** A frame arrived that could not be parsed. The stream continues. */
   parse_error: { severity: 'warning' },
-  /** A teardown step threw. The session is already ending. */
-  cleanup_failed: { severity: 'warning' },
-  /** Audio capture broke mid-session: nothing further will be transcribed. */
-  input_pipeline_failed: { severity: 'error' },
   /** Speech synthesis degraded or dropped; translation text still arrives. */
   tts_degraded: { severity: 'warning' },
   /** An automatic resume attempt failed; further attempts may follow. */
   resume_attempt_failed: { severity: 'warning' },
-  /** Outbound audio or text could not be sent and was dropped. */
-  send_dropped: { severity: 'warning' },
   /** The requested voice was unavailable and a substitute was used. */
   voice_fallback: { severity: 'warning' },
-  /** A managed-session lease notification could not be delivered. */
-  lease_notify_failed: { severity: 'warning' },
   /** One utterance could not be transcribed; the session continues. */
   transcription_failed: { severity: 'warning' },
   /** One translation failed; the session continues. */
`````

`src/lib/provider/instructions.test.ts`

`````diff t10
diff --git a/src/lib/provider/instructions.test.ts b/src/lib/provider/instructions.test.ts
--- a/src/lib/provider/instructions.test.ts
+++ b/src/lib/provider/instructions.test.ts
@@ -1,5 +1,4 @@
 import { describe, it, expect } from 'vitest';
-import { useSettingsStore } from '../../stores/settingsStore';
 import {
   COMMON_INSTRUCTION_KEYS,
   INSTRUCTION_LEGACY_KEYS,
@@ -13,16 +12,13 @@
 const stored = (patch: Partial<InstructionsSettings> = {}): Record<string, unknown> => ({ ...INSTRUCTIONS_DEFAULTS, ...patch });
 
 describe('the instructions a provider owns (Stage 2 Gemini, ruling 4)', () => {
-  it("start from the old app's defaults, word for word: Quick mode, its default prompt, no Other's prompt, its template", () => {
-    // The old store is read here only, as the parity pin (choice 2): new code imports nothing from it.
-    const old = useSettingsStore.getState();
-    expect(INSTRUCTIONS_TEMPLATE).toBe(old.templateSystemInstructions);
-    expect(INSTRUCTIONS_DEFAULTS).toEqual({
-      useTemplateMode: old.useTemplateMode,
-      systemInstructions: old.systemInstructions,
-      participantSystemInstructions: old.participantSystemInstructions,
-    });
+  it("start from the old app's defaults: Quick mode, its default prompt, no Other's prompt, its template", () => {
+    // The old store's copy these were pinned to word for word (choice 2) went
+    // with the old providers (Stage 2 deletion, ruling 2); the values stand on
+    // their own now.
     expect(INSTRUCTIONS_DEFAULTS.useTemplateMode).toBe(true);
+    expect(INSTRUCTIONS_DEFAULTS.participantSystemInstructions).toBe('');
+    expect(INSTRUCTIONS_DEFAULTS.systemInstructions).toContain('Your ONLY function: translate Chinese → Japanese.');
     expect(INSTRUCTIONS_TEMPLATE).toContain('{{SOURCE_LANGUAGE}} → {{TARGET_LANGUAGE}}');
   });
 
`````

`src/lib/session/storedSettings.ts`

`````diff t10
diff --git a/src/lib/session/storedSettings.ts b/src/lib/session/storedSettings.ts
--- a/src/lib/session/storedSettings.ts
+++ b/src/lib/session/storedSettings.ts
@@ -18,9 +18,10 @@
 
 /**
  * What `settings.common.provider` holds for a provider: the old enum's
- * spelling where one exists — the value every install already has, and the
- * one the old settings store (still loaded until Stage 2 retires it) reads as
- * the provider it is instead of falling back to OpenAI.
+ * spelling where one exists — the value every install already has. The old
+ * settings store, kept for Local Native until kizuna-ai-lab/sokuji#578,
+ * reads a value its registry does not hold as its inert default (Stage 2
+ * deletion, choice 4).
  */
 export function storedProviderValue(id: string): string {
   for (const [legacy, current] of Object.entries(LEGACY_PROVIDER_IDS)) if (current === id) return legacy;
`````

`src/lib/view/noticeText.ts`

`````diff t10
diff --git a/src/lib/view/noticeText.ts b/src/lib/view/noticeText.ts
--- a/src/lib/view/noticeText.ts
+++ b/src/lib/view/noticeText.ts
@@ -49,13 +49,9 @@
   local_models_missing: 'Please download the required models in Settings to start.',
   // The adapters' degradations (CLIENT_DIAGNOSTICS).
   parse_error: "A message from the provider couldn't be read; the session continues.",
-  cleanup_failed: 'A step while closing the session failed.',
-  input_pipeline_failed: 'Audio capture stopped working; nothing further will be translated.',
   tts_degraded: 'Speech playback is degraded; the translated text still arrives.',
   resume_attempt_failed: 'Reconnecting failed; trying again.',
-  send_dropped: "Some audio or text couldn't be sent and was dropped.",
   voice_fallback: 'The chosen voice was unavailable, so another voice is used.',
-  lease_notify_failed: "The service couldn't be told about the session's state.",
   // A failed leg's API error type (the adapter's code).
   auth: 'The provider did not accept the credentials: {{detail}}',
   rate_limit: 'The provider is limiting requests; try again shortly: {{detail}}',
`````

`src/locales/locales.consistency.test.ts`

`````diff t10
diff --git a/src/locales/locales.consistency.test.ts b/src/locales/locales.consistency.test.ts
--- a/src/locales/locales.consistency.test.ts
+++ b/src/locales/locales.consistency.test.ts
@@ -1,15 +1,6 @@
-import { describe, it, expect, vi } from 'vitest';
-// Force every provider gate on so ALL descriptors register regardless of build
-// env — same trick as descriptorRegistry.test.ts.
-vi.mock('../utils/environment', async (orig) => ({
-  ...(await orig<any>()),
-  isKizunaAIEnabled: () => true,
-  isLocalNativeEnabled: () => true,
-  isElectron: () => true,
-  isExtension: () => false,
-}));
-import { ProviderConfigFactory } from '../services/providers/ProviderConfigFactory';
+import { describe, it, expect } from 'vitest';
 import en from './en/translation.json';
+import { SEMANTIC_EAGERNESSES } from '../providers/openai/settings';
 import {
   SONIOX_VOICE_ROSTER,
   SONIOX_ACCENTS,
@@ -65,22 +56,15 @@
 });
 
 describe('dynamically-built i18n keys resolve in en', () => {
-  // ProviderSpecificSettings renders one button per capabilities.turnDetection.mode
-  // and derives the label key from the mode string. A mode whose key is absent
-  // renders the raw key as the button text — Volcengine's 'Push-to-Talk' did
~ 11 more removed lines sha256:fdfc8dc715a9
-      }
-    }
+  // RealtimeTurnDetection derives a label key from each mode and eagerness it
+  // offers (`settings.${x.toLowerCase()}`); a value whose key is absent renders
+  // the raw key as the button text. The old registry's turn-detection modes,
+  // which this walked before, left with its providers (Stage 2 deletion,
+  // ruling 2).
+  it('every Realtime turn-detection mode and eagerness maps to a key that exists', () => {
+    const missing = ['Normal', 'Semantic', ...SEMANTIC_EAGERNESSES]
+      .map((value) => `settings.${value.toLowerCase()}`)
+      .filter((key) => EN[key] === undefined);
     expect(missing).toEqual([]);
   });
 
`````

`src/providers/oldPath.consistency.test.ts`

`````diff t10
diff --git a/src/providers/oldPath.consistency.test.ts b/src/providers/oldPath.consistency.test.ts
new file mode 100644
--- /dev/null
+++ b/src/providers/oldPath.consistency.test.ts
@@ -0,0 +1,125 @@
+/**
+ * The new structure never reaches the old provider path (Stage 2 deletion,
+ * rulings 1 and 2). The old path is every module of `src/services/clients/`,
+ * `src/services/providers/` and `src/services/interfaces/`: Local Native's
+ * client, descriptor, factory and `IClient`, kept whole until
+ * kizuna-ai-lab/sokuji#578 ports it. Only the
+ * old path's own files (`OLD_PATH_FILES`) import one of its modules by
+ * value — a static import or re-export, a side-effect import, a dynamic
+ * `import()` or a `require()` — but for the shared leaves the new code takes
+ * (`SHARED`). A type-only import is erased and allowed.
+ *
+ * When #578 ports Local Native, the old path and this list go together.
+ */
+import { describe, it, expect } from 'vitest';
+import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
+import { dirname, join, posix, resolve } from 'node:path';
+import ts from 'typescript';
+
+const REPO_ROOT = resolve(__dirname, '../..');
+
+/** The old path's modules: every file of these three folders. */
+const OLD_PATH = /^src\/services\/(clients|providers|interfaces)\//;
+
+/** Modules of those folders that are not the old path's: shared leaves the new code imports. */
+const SHARED = new Set([
+  'src/services/providers/ProviderConfig', // `LanguageOption`, `VoiceOption`
+  'src/services/providers/astGuard', // `guardAstCrossStage`, LocalInference's AST check
+  'src/services/providers/tutorialUrls', // `AI_PROVIDERS_DOCS_URL`, the wizard's docs link
+  'src/services/interfaces/ISettingsService', // the settings service's interface, which the new session's stores read
+]);
+
+/** Besides `src/services/` itself, the files that may import the old path: the unmounted shell that renders Local Native, and the old store with its Local Native slice, with the tests that pin them. */
+const OLD_PATH_FILES = new Set([
+  'src/components/Settings/sections/LanguageSection.tsx',
+  'src/components/Settings/sections/LanguageSection.sentence.test.tsx',
+  'src/components/Settings/sections/ProviderSection.tsx',
+  'src/stores/settingsStore.ts',
+  'src/stores/settingsStore.selections.test.ts',
+]);
+const isOldPathFile = (file: string) => file.startsWith('src/services/') || OLD_PATH_FILES.has(file);
+
+const parse = (source: string, fileName: string) =>
+  ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
+
+/** Every specifier a file imports by value: `import … from`, `import '…'`, `export … from`, `import('…')`, `require('…')`; not `import type`, nor a named import whose every name is `type`. */
+function valueSpecifiers(source: string, fileName = 'scan.ts'): string[] {
+  const out: string[] = [];
+  const visit = (node: ts.Node): void => {
+    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
+      const clause = node.importClause;
+      const named = clause?.namedBindings;
+      const typeOnly = clause?.isTypeOnly === true
+        || (clause !== undefined && clause.name === undefined && named !== undefined && ts.isNamedImports(named)
+          && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly));
+      if (!typeOnly) out.push(node.moduleSpecifier.text);
+    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
+      out.push(node.moduleSpecifier.text);
+    } else if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
+      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
+      out.push(node.arguments[0].text);
+    }
+    ts.forEachChild(node, visit);
+  };
+  visit(parse(source, fileName));
+  return out;
+}
+
+/** A relative specifier as a repo-relative module, extension dropped; null when it is not relative. */
+function moduleOf(from: string, spec: string): string | null {
+  if (!spec.startsWith('.')) return null;
+  return posix.normalize(posix.join(dirname(from).split('\\').join('/'), spec)).replace(/\.(tsx?|jsx?|mjs)$/, '');
+}
+
+/** Every source file under `src` (no `.d.ts`). */
+function sourceFiles(root: string): string[] {
+  const files: string[] = [];
+  const walk = (dir: string) => {
+    for (const entry of readdirSync(join(root, dir))) {
+      const rel = `${dir}/${entry}`;
+      if (statSync(join(root, rel)).isDirectory()) walk(rel);
+      else if (/\.(tsx?|jsx?|mjs)$/.test(entry) && !entry.endsWith('.d.ts')) files.push(rel);
+    }
+  };
+  walk('src');
+  return files.sort();
+}
+
+/** `file: module` for every value import of the old path from outside it. */
+function offenders(root: string): string[] {
+  return sourceFiles(root).filter((file) => !isOldPathFile(file)).flatMap((file) =>
+    valueSpecifiers(readFileSync(join(root, file), 'utf-8'), file)
+      .map((spec) => moduleOf(file, spec))
+      .filter((target): target is string => target !== null && OLD_PATH.test(target) && !SHARED.has(target))
+      .map((target) => `${file}: ${target}`));
+}
+
+describe('the old provider path', () => {
+  it('is imported by value only by its own files', () => {
+    expect(offenders(REPO_ROOT)).toEqual([]);
+  });
+
+  it('the scan sees every kind of value import, and no type-only one', () => {
+    const source = [
+      "import { ClientFactory } from '../../services/clients/ClientFactory';",
+      "import '../../services/providers/ProviderConfigFactory';",
+      "export { LocalNativeClient } from '../../services/clients/LocalNativeClient';",
+      "const later = () => import('../../services/providers/LocalNativeProviderConfig');",
+      "const old = require('../../services/clients/punctuateDefinite');",
+      "import type { IClient } from '../../services/interfaces/IClient';",
+      "import { type ProviderConfig } from '../../services/providers/ProviderConfig';",
+    ].join('\n');
+    expect(valueSpecifiers(source)).toEqual([
+      '../../services/clients/ClientFactory',
+      '../../services/providers/ProviderConfigFactory',
+      '../../services/clients/LocalNativeClient',
+      '../../services/providers/LocalNativeProviderConfig',
+      '../../services/clients/punctuateDefinite',
+    ]);
+  });
+
+  it('names only files that exist', () => {
+    for (const file of OLD_PATH_FILES) expect(existsSync(join(REPO_ROOT, file)), file).toBe(true);
+    for (const module of SHARED) expect(existsSync(join(REPO_ROOT, `${module}.ts`)), module).toBe(true);
+  });
+});
`````

`src/services/SettingsService.ts`

`````diff t10
diff --git a/src/services/SettingsService.ts b/src/services/SettingsService.ts
--- a/src/services/SettingsService.ts
+++ b/src/services/SettingsService.ts
@@ -1,9 +1,6 @@
-import { ISettingsService, SettingsOperationResult, ApiKeyValidationResult } from './interfaces/ISettingsService';
-import { FilteredModel } from './interfaces/IClient';
-import { ClientOperations } from './ClientOperations';
-import { ProviderType } from '../types/Provider';
+import { ISettingsService, SettingsOperationResult } from './interfaces/ISettingsService';
 import i18n from '../locales';
-import { reportError, reportWarning, describeCause } from '../lib/diagnostics/report';
+import { reportWarning, describeCause } from '../lib/diagnostics/report';
 
 /**
  * Unified Settings Service implementation
@@ -134,36 +131,4 @@
       return { configDir: 'localStorage', configFile: 'Local Storage' };
     }
   }
-  
-  /**
-   * Validate API key and fetch available models in a single request
~ 26 more removed lines sha256:106c91d8a98c
-      };
-    }
   }
-}
`````

`src/services/interfaces/IClient.ts`

`````diff t10
diff --git a/src/services/interfaces/IClient.ts b/src/services/interfaces/IClient.ts
--- a/src/services/interfaces/IClient.ts
+++ b/src/services/interfaces/IClient.ts
@@ -170,16 +170,6 @@
   onReconnected?: () => void;
 }
 
-/**
- * API Key validation result interface
- */
-export interface ApiKeyValidationResult {
-  valid: boolean | null;
-  message: string;
-  validating: boolean;
-  hasRealtimeModel?: boolean;
-}
-
 /**
  * Model information interface
  */
`````

`src/services/interfaces/ISettingsService.ts`

`````diff t10
diff --git a/src/services/interfaces/ISettingsService.ts b/src/services/interfaces/ISettingsService.ts
--- a/src/services/interfaces/ISettingsService.ts
+++ b/src/services/interfaces/ISettingsService.ts
@@ -1,6 +1,3 @@
-import { FilteredModel } from './IClient';
-import { ProviderType } from '../../types/Provider';
-
 // Settings service interface definition
 export interface SettingsOperationResult {
   success: boolean;
@@ -40,21 +37,4 @@
    * Get the path to the settings file (if applicable to the platform)
    */
   getSettingsPath(): Promise<{ configDir: string; configFile: string }>;
-  
-  /**
-   * Validate API key and fetch available models in a single request
~ 13 more removed lines sha256:68dd4aca4110
-  }>;
-}
+  }
`````

`src/services/providers/descriptorRegistry.test.ts`

`````diff t10
diff --git a/src/services/providers/descriptorRegistry.test.ts b/src/services/providers/descriptorRegistry.test.ts
--- a/src/services/providers/descriptorRegistry.test.ts
+++ b/src/services/providers/descriptorRegistry.test.ts
@@ -307,9 +307,9 @@
   });
 });
 
-describe('legacy façade credential guards (deprecated ClientOperations/ClientFactory paths)', () => {
+describe('legacy façade credential guards (the deprecated ClientFactory path)', () => {
   // The production path runs extractCredentials first, but the @deprecated
-  // façades accept raw positional args — they must keep the old contract of
+  // façade accepts raw positional args — it must keep the old contract of
   // rejecting incomplete credentials instead of reaching provider clients
   // with `secret: undefined`.
   it('ClientFactory.createClient rejects an empty apiKey for credentialed providers', async () => {
`````

`src/stores/settingsStore.test.ts`

`````diff t10
diff --git a/src/stores/settingsStore.test.ts b/src/stores/settingsStore.test.ts
--- a/src/stores/settingsStore.test.ts
+++ b/src/stores/settingsStore.test.ts
@@ -38,7 +38,6 @@
     useSettingsStore.setState({
       provider: Provider.OPENAI,
       isValidating: false,
-      cacheTimestamp: null,
     });
     vi.clearAllMocks();
   });
@@ -53,9 +52,8 @@
       // validation is delegated to SettingsInitializer which reacts to provider changes.
       const store = useSettingsStore.getState();
 
-      // Set some cache data first
+      // Set some validation state first
       useSettingsStore.setState({
-        validationCache: new Map([['test', { validation: { valid: true, message: '' }, models: [], timestamp: Date.now() }]]),
         availableModels: [{ id: 'test', type: 'realtime' as const, created: 0 }],
         isApiKeyValid: true,
       });
@@ -66,7 +64,7 @@
       // Provider should be updated
       expect(useSettingsStore.getState().provider).toBe(Provider.GEMINI);
 
-      // Cache should be cleared (availableModels reset, validationCache empty)
+      // The validation state is reset (availableModels empty, isApiKeyValid null)
       const state = useSettingsStore.getState();
       expect(state.availableModels).toEqual([]);
       expect(state.isApiKeyValid).toBeNull();
@@ -99,9 +97,8 @@
     });
 
     it('should clear cache when switching providers', async () => {
-      // Set some cache data
+      // Set some validation state
       useSettingsStore.setState({
-        validationCache: new Map([['test', { validation: { valid: true, message: '' }, models: [], timestamp: Date.now() }]]),
         availableModels: [{ id: 'test', type: 'realtime' as const, created: 0 }],
         isApiKeyValid: true,
       });
@@ -109,9 +106,8 @@
       // Switch provider
       await useSettingsStore.getState().setProvider(Provider.GEMINI);
 
-      // Verify cache was cleared by checking state (not spy)
+      // Verify it was reset by checking state (not spy)
       const state = useSettingsStore.getState();
-      expect(state.validationCache.size).toBe(0);
       expect(state.availableModels).toEqual([]);
       expect(state.isApiKeyValid).toBeNull();
     });
@@ -130,19 +126,17 @@
 
   describe('Cache Management', () => {
     it('should clear cache and reset validation state', () => {
-      // Set initial state with cache
+      // Set initial validation state
       useSettingsStore.setState({
-        validationCache: new Map([['test', { validation: { valid: true, message: '' }, models: [], timestamp: Date.now() }]]),
         availableModels: [{ id: 'test', type: 'realtime' as const, created: 0 }],
         isApiKeyValid: true,
       });
 
-      // Clear cache
+      // Clear it
       useSettingsStore.getState().clearCache();
 
       // Check state was reset
       const state = useSettingsStore.getState();
-      expect(state.validationCache.size).toBe(0);
       expect(state.availableModels).toEqual([]);
       expect(state.isApiKeyValid).toBeNull();
     });
`````

`src/stores/settingsStore.ts`

`````diff t10
diff --git a/src/stores/settingsStore.ts b/src/stores/settingsStore.ts
--- a/src/stores/settingsStore.ts
+++ b/src/stores/settingsStore.ts
@@ -2,7 +2,6 @@
 import {subscribeWithSelector} from 'zustand/middleware';
 import {ServiceFactory} from '../services/ServiceFactory';
 import {ProviderConfigFactory} from '../services/providers/ProviderConfigFactory';
-import {ProviderConfig} from '../services/providers/ProviderConfig';
 import {
   FilteredModel,
   SessionConfig,
@@ -53,10 +52,6 @@
   LocalNativeSettings,
 };
 
-// Union of every provider's settings slice — the return type of
-// getCurrentProviderSettings, resolved dynamically via the active descriptor.
-export type ProviderSettingsUnion = LocalNativeSettings;
-
 // ==================== Type Definitions ====================
 
 // Conversation display mode — which half of a bilingual utterance to show
@@ -69,10 +64,6 @@
   provider: ProviderType;
   uiLanguage: string;
   uiMode: 'basic' | 'advanced';
-  systemInstructions: string;
-  templateSystemInstructions: string;
-  useTemplateMode: boolean;
-  participantSystemInstructions: string;
   textOnly: boolean;
   keepReplayAudio: boolean;
   autoSaveOnStop: boolean;
@@ -100,13 +91,6 @@
 /** The authentication forms that can sit over the app. */
 export type AuthOverlayKind = 'sign-in' | 'sign-up' | 'forgot-password' | null;
 
-// Cache Entry
-interface CacheEntry {
-  validation: ApiKeyValidationResult;
-  models: FilteredModel[];
-  timestamp: number;
-}
-
 // ==================== Default Values ====================
 
 /**
@@ -158,6 +142,9 @@
 }
 
 const defaultCommonSettings: CommonSettings = {
+  // An id the old registry does not hold, so nothing old runs for it. Local
+  // Native here would start its old readiness arm for every user of a build
+  // that registers it (Stage 2 deletion, choice 4).
   provider: Provider.OPENAI,
   uiLanguage: 'en',
   uiMode: 'basic',
@@ -169,58 +156,6 @@
   sentenceSegmentationChunkSentences: DEFAULT_CHUNK_SENTENCES,
   segmentationSourcePause: DEFAULT_SEGMENT_PAUSE_SECONDS,
   segmentationTranslationPause: DEFAULT_SEGMENT_PAUSE_SECONDS,
-  systemInstructions:
-    "# ROLE & OBJECTIVE\n" +
-    "You are a simultaneous interpreter.\n" +
~ 47 more removed lines sha256:262d6bc4a952
-  useTemplateMode: true,
-  participantSystemInstructions: '',
   speakerDisplayMode: 'both',
   participantDisplayMode: 'both',
 };
@@ -233,10 +168,6 @@
   provider: ProviderType;
   uiLanguage: string;
   uiMode: 'basic' | 'advanced';
-  systemInstructions: string;
-  templateSystemInstructions: string;
-  useTemplateMode: boolean;
-  participantSystemInstructions: string;
 
   // Provider-specific settings
   localNative: LocalNativeSettings;
@@ -245,11 +176,9 @@
   isApiKeyValid: boolean | null;
   isValidating: boolean;
   validationMessage: string;
-  validationCache: Map<string, CacheEntry>;
 
   // Models state
   availableModels: FilteredModel[];
-  loadingModels: boolean;
 
   // Navigation state
   settingsNavigationTarget: string | null;
@@ -347,30 +276,22 @@
    * flag only — does NOT re-invoke the surface, which would loop.
    */
   __syncSubtitleFullscreen: (flag: boolean) => void;
-  setSystemInstructions: (instructions: string) => void;
-  setTemplateSystemInstructions: (instructions: string) => void;
-  setUseTemplateMode: (useTemplate: boolean) => void;
-  setParticipantSystemInstructions: (instructions: string) => void;
 
   // Provider settings actions
   updateLocalNative: (settings: Partial<LocalNativeSettings>) => void;
   /** Generic slice update keyed by descriptor.settingsSliceKey — the write
    *  half of the read path the reactive selectors already use. Same registry
-   *  (transforms, persistence policy) as the named actions; throws on an
+   *  (persistence policy) as the named actions; throws on an
    *  unknown key. Consumed by MainPanel when applying a descriptor
    *  prepareToStart settingsPatch (S4/S5 seam). */
   updateProviderSlice: (sliceKey: string, patch: Record<string, unknown>) => Promise<void>;
 
   // Async actions
-  validateApiKey: (getAuthToken?: () => Promise<string | null>) => Promise<ApiKeyValidationResult>;
-  fetchAvailableModels: (getAuthToken?: () => Promise<string | null>) => Promise<void>;
+  validateApiKey: () => Promise<ApiKeyValidationResult>;
   loadSettings: () => Promise<void>;
   clearCache: () => void;
 
   // Helper methods
-  getCurrentProviderSettings: () => ProviderSettingsUnion;
-  getCurrentProviderConfig: () => ProviderConfig;
-  getProcessedSystemInstructions: (forParticipant?: boolean) => string;
   getProcessedLocalPrompt: (forParticipant?: boolean) => string;
   createSessionConfig: (systemInstructions: string) => SessionConfig;
   navigateToSettings: (target: string | null) => void;
@@ -456,10 +377,8 @@
     isApiKeyValid: null,
     isValidating: false,
     validationMessage: '',
-    validationCache: new Map(),
 
     availableModels: [],
-    loadingModels: false,
 
     settingsNavigationTarget: null,
     engineSlotTarget: null,
@@ -476,9 +395,8 @@
       // synchronously. Persistence happens afterwards.
       set({provider});
 
-      // Clear cache synchronously before persisting, so SettingsInitializer
-      // (which reacts to the provider change immediately) won't have its
-      // fresh validation wiped by a late clearCache() after the await.
+      // Reset the validation state synchronously, before persisting, so a
+      // validation the new provider starts is not wiped by a late reset.
       get().clearCache();
 
       const service = ServiceFactory.getSettingsService();
@@ -497,30 +415,6 @@
       await service.setSetting('settings.common.uiMode', uiMode);
     },
 
-    setSystemInstructions: async (systemInstructions) => {
-      set({systemInstructions});
-      const service = ServiceFactory.getSettingsService();
~ 19 more removed lines sha256:bf3382a1ff69
-    },
-
     setTextOnly: async (textOnly) => {
       const previous = get().textOnly;
       set({textOnly});
@@ -691,11 +585,8 @@
     // whole create<SettingsStore>() literal, and roughly a third of the
     // repository's type errors are downstream of that. See the commit that
     // added this line for the before/after numbers.
-    validateApiKey: async (
-      getAuthToken?: () => Promise<string | null>,
-    ): Promise<ApiKeyValidationResult> => {
-      const state = get();
-      const provider = state.provider;
+    validateApiKey: async (): Promise<ApiKeyValidationResult> => {
+      const provider = get().provider;
 
       // Native (Electron sidecar) inference: no API key. Readiness is owned by
       // nativeModelStore's ensureSelectionReady facade — sidecar warmup,
@@ -735,88 +626,11 @@
         return { valid: ready, message, validating: false };
       }
 
-      // Get normalized credentials from the provider's descriptor — replaces
-      // the four hand-copied per-provider extraction chains that used to live
-      // here (see git history for the pre-descriptor shape).
~ 77 more removed lines sha256:dad8d163066b
-      await get().validateApiKey(getAuthToken);
-      set({loadingModels: false});
+      // Every other provider validates in the new registry (its definition's
+      // `check`); the old path holds only Local Native (Stage 2 deletion,
+      // ruling 1), so there is nothing here to validate.
+      set({ isApiKeyValid: null, availableModels: [], validationMessage: '', isValidating: false });
+      return { valid: false, message: '', validating: false };
     },
 
     loadSettings: async () => {
@@ -834,10 +648,6 @@
         const provider = await service.getSetting('settings.common.provider', defaultCommonSettings.provider);
         const uiLanguage = await service.getSetting('settings.common.uiLanguage', defaultCommonSettings.uiLanguage);
         const uiMode = await service.getSetting('settings.common.uiMode', defaultCommonSettings.uiMode);
-        const systemInstructions = await service.getSetting('settings.common.systemInstructions', defaultCommonSettings.systemInstructions);
-        const templateSystemInstructions = await service.getSetting('settings.common.templateSystemInstructions', defaultCommonSettings.templateSystemInstructions);
-        const useTemplateMode = await service.getSetting('settings.common.useTemplateMode', defaultCommonSettings.useTemplateMode);
-        const participantSystemInstructions = await service.getSetting('settings.common.participantSystemInstructions', defaultCommonSettings.participantSystemInstructions);
         const textOnly = await service.getSetting('settings.common.textOnly', defaultCommonSettings.textOnly);
         const keepReplayAudio = await service.getSetting('settings.common.keepReplayAudio', defaultCommonSettings.keepReplayAudio);
         const autoSaveOnStop = await service.getSetting('settings.common.autoSaveOnStop', defaultCommonSettings.autoSaveOnStop);
@@ -857,7 +667,8 @@
         const participantDisplayMode = await service.getSetting<DisplayMode>('settings.common.participantDisplayMode', defaultCommonSettings.participantDisplayMode);
         // Subtitle settings now hydrated by subtitleStore.hydrate(); see stores/subtitleStore.ts.
 
-        // Validate provider availability
+        // A provider the old registry does not hold falls to the inert default
+        // (Stage 2 deletion, choice 4).
         const validProvider = ProviderConfigFactory.isProviderSupported(provider) ? provider : Provider.OPENAI;
 
         // Load provider settings
@@ -881,10 +692,6 @@
           provider: validProvider,
           uiLanguage,
           uiMode,
-          systemInstructions,
-          templateSystemInstructions,
-          useTemplateMode,
-          participantSystemInstructions,
           textOnly,
           keepReplayAudio,
           autoSaveOnStop,
@@ -911,70 +718,12 @@
 
     clearCache: () => {
       set({
-        validationCache: new Map(),
         availableModels: [],
         isApiKeyValid: null
       });
     },
 
     // === Helper Methods ===
-    getCurrentProviderSettings: () => {
-      const state = get();
-      const descriptor = ProviderConfigFactory.getDescriptor(state.provider);
~ 52 more removed lines sha256:ab0a1f90685e
-    },
-
     getProcessedLocalPrompt: (forParticipant = false) => {
       // Local Native's slice, the one local slice left (Stage 2 deletion,
       // ruling 3). It has no participant prompt, so the participant case
@@ -1037,10 +786,6 @@
   useSettingsStore((state) => state.setSubtitleFullscreen);
 export const useNotifySubtitleSurfaceExited = () =>
   useSettingsStore((state) => state.__notifySubtitleSurfaceExited);
-export const useSystemInstructions = () => useSettingsStore((state) => state.systemInstructions);
-export const useTemplateSystemInstructions = () => useSettingsStore((state) => state.templateSystemInstructions);
-export const useUseTemplateMode = () => useSettingsStore((state) => state.useTemplateMode);
-export const useParticipantSystemInstructions = () => useSettingsStore((state) => state.participantSystemInstructions);
 
 // Provider settings
 export const useLocalNativeSettings = () => useSettingsStore((state) => state.localNative);
@@ -1052,7 +797,6 @@
 
 // Models state
 export const useAvailableModels = () => useSettingsStore((state) => state.availableModels);
-export const useLoadingModels = () => useSettingsStore((state) => state.loadingModels);
 
 // Navigation
 export const useSettingsNavigationTarget = () => useSettingsStore((state) => state.settingsNavigationTarget);
@@ -1096,43 +840,17 @@
 export const useSetAutoSaveOnStop = () => useSettingsStore((state) => state.setAutoSaveOnStop);
 export const useSetSpeakerDisplayMode = () => useSettingsStore((state) => state.setSpeakerDisplayMode);
 export const useSetParticipantDisplayMode = () => useSettingsStore((state) => state.setParticipantDisplayMode);
-export const useSetSystemInstructions = () => useSettingsStore((state) => state.setSystemInstructions);
-export const useSetTemplateSystemInstructions = () => useSettingsStore((state) => state.setTemplateSystemInstructions);
-export const useSetUseTemplateMode = () => useSettingsStore((state) => state.setUseTemplateMode);
-export const useSetParticipantSystemInstructions = () => useSettingsStore((state) => state.setParticipantSystemInstructions);
 
 export const useUpdateLocalNative = () => useSettingsStore((state) => state.updateLocalNative);
 
 export const useValidateApiKey = () => useSettingsStore((state) => state.validateApiKey);
-export const useFetchAvailableModels = () => useSettingsStore((state) => state.fetchAvailableModels);
 export const useLoadSettings = () => useSettingsStore((state) => state.loadSettings);
 export const useClearCache = () => useSettingsStore((state) => state.clearCache);
 
-export const useGetCurrentProviderSettings = () => useSettingsStore((state) => state.getCurrentProviderSettings);
-
-// Reactive selector that returns the current provider's settings object,
~ 7 more removed lines sha256:0906872d0c21
-export const useGetCurrentProviderConfig = () => useSettingsStore((state) => state.getCurrentProviderConfig);
-export const useGetProcessedSystemInstructions = () => useSettingsStore((state) => state.getProcessedSystemInstructions);
 export const useGetProcessedLocalPrompt = () => useSettingsStore((state) => state.getProcessedLocalPrompt);
 export const useCreateSessionConfig = () => useSettingsStore((state) => state.createSessionConfig);
 export const useNavigateToSettings = () => useSettingsStore((state) => state.navigateToSettings);
 
-// Current provider's Speech Mode (turnDetectionMode), or 'Auto' for providers
-// whose settings slice has no turnDetectionMode field (e.g. OpenAI Translate,
-// Palabra). Resolved via the active descriptor's slice key.
-export const useCurrentTurnDetectionMode = (): string => useSettingsStore((state) => {
-  const descriptor = ProviderConfigFactory.getDescriptor(state.provider);
-  const slice = state[descriptor.settingsSliceKey as keyof SettingsStore] as { turnDetectionMode?: string };
-  return slice?.turnDetectionMode ?? 'Auto';
-});
-
 export { useSettingsStore };
 export default useSettingsStore;
 
`````

---

### Task 11: `CLAUDE.md` and `CONTEXT.md` for the new structure (Wave 3)

Rulings 7, 9 and 11. Every passage that described the old clients, `ClientFactory`, `IClient`, `ProviderConfigFactory`, `openai-realtime-api`, the `livekit-client` pin or the old way to add a provider is rewritten for the new structure; every other section stays as it is. The seven adapters and the session-side guard cite "Inside an `IClient` session" by name; they follow the heading's new name.

**What goes, and what changes:**
- Project Overview: the providers as the registry offers them; Local Native on the old path until #578.
- "AI Client Architecture" → "Provider Architecture": the folder, the registry and presence, `providerStore`, the runner and L1, Local Native's exception.
- State management's `settingsStore` / `providerStore` bullets; "Code Organization"; the Zustand example (it used the old `useProvider`).
- "Error Handling": "Inside an `IClient` session" → "Inside an adapter session" (`failed`, `degraded`, `frame`, a rejecting `start()`), Local Native's `IClient` keeping the same rule; the seven adapters' citations and `sessionSide.consistency.test.ts`' comment follow.
- "Key Libraries": `openai` and `@google/genai` as the wire-type SDKs behind the oracle tests, `ws` for the wire probes; `openai-realtime-api` and `livekit-client` out, with the pin section.
- "Adding a New AI Provider": the spec's "What adding a provider then touches" as the ports landed.
- The CSP's provider list, the user-managed keys, and "Authentication Flow for Kizuna AI" / "Key Services", which described an `ApiKeyService` that does not exist (the managed provider's lease buys its keys).
- **Revision 1** (the review's M4 and N2, verified against the result): "Service Layer Pattern" without the nonexistent `IAudioService` (`ServiceFactory` hands out the one settings service); "Audio Service Management" and "Dynamic Audio Device Switching" without the nonexistent `ModernBrowserAudioService`, `switchRecordingDevice` and `currentRecordingDeviceId` — the microphone source (`openMic`, `src/lib/audio/capture/mic.ts`) follows its device live; "Simple Mode Components" and "UI Design System" name `SimpleSettings`, not the nonexistent `SimpleConfigPanel`; step 2 of "Adding a New AI Provider" says `sessionSide.consistency.test.ts` holds a new adapter automatically. Found while verifying them and corrected the same way: the nonexistent `ModernAudioPlayer` ("Audio Processing Pipeline", "Audio Handling"), `OnboardingContext` (twice), `sessionStore`'s description, and "Code Organization"'s `src/services/` and `src/lib/modern-audio/` lines, with `src/lib/audio/` added. The Local Native exception names the import guard. **Revision 2** (the re-check's R3): "Modifying Audio Pipeline" no longer calls `src/lib/modern-audio/` "JavaScript files" (every file there is `.ts`), and "Audio Handling"'s passthrough line states what the code has: the microphone's processed voice on its own `passthrough` feed into the meeting (`routes.ts`), off by default, `audioStore`'s `realVoicePassthroughVolume` default 0.2 — the settings show 20% on a 0–60% slider — where it said 30% for monitoring.
- `src/lib/diagnostics/report.ts`' statement of the session rule, in `IClient` / MainPanel terms, follows the heading's new name.
- **`CONTEXT.md`** (ruling 9), per the review's passage list, each checked against the result: **Provider** (the registry's nine, ids and `settings.key`), **Provider definition** (was ProviderDescriptor), **Provider Registry** (`registry.ts` and `isPresent`), **Provider settings** (was Settings slice; `providerStore`), **Credentials** (`credentials.read`), **Managed provider** (was Kizuna twins), **Local Inference vs Local Native** (the shared abstractions no longer `IClient` and `ProviderDescriptor`), **Leg config** (was SessionConfig), **Adapter** (was Client), **Segment** (was ConversationItem); each names what the old path keeps until #578. **SidecarConnection** and the extension's entries are kept as they are.
- **`CONTEXT.md`'s native model resolution entries** (ruling 11, Revision 3), which described the ONNX-era sidecar — sherpa-onnx community voices synthesised as ad-hoc cards, CUDA variant subdirectories, download-ignore globs — rewritten to what the ggml-only sidecar does, each checked against the code: **Model catalog card** (`catalog.py`'s three row types; a `Deployment`'s tier is `gpu-metal`, `gpu-vulkan` or `cpu` and its artifact one pinned GGUF, downloaded by `native_models.py`; `graph_family`, the translation cards' thinking flags and prompt family, the TTS cards' audio.cpp family; an id that is no row is unknown — `resolve_tts_card`; a loaded TTS model's streaming, cloning and sample rate read off the model by `tts_backend.py`; the renderer's `nativeCatalog.ts`), **Planner / Loader** (`planner.py` with `TIER_RANK`, the paravirtual-Metal exclusion and the op-coverage gate; `accel.py` probing through `native.py`; the three backends on one ggml), **Plan / Plan.config** (`PlanConfig`'s fields). Glossary-short, files cited.

**Files:**
- Modify (11, by the blocks below): `CLAUDE.md`, `CONTEXT.md`, `src/lib/diagnostics/report.ts`, `src/providers/gemini/adapter.ts`, `src/providers/openai/adapter.ts`, `src/providers/openai_live/adapter.ts`, `src/providers/openai_translate/adapter.ts`, `src/providers/palabraai/adapter.ts`, `src/providers/sessionSide.consistency.test.ts`, `src/providers/soniox/adapter.ts`, `src/providers/volcengine_ast2/adapter.ts`

**Interfaces:**
- Consumes: Tasks 1–10 (the prose describes their result).
- Produces: `CLAUDE.md`'s heading "Inside an adapter session", which `src/providers/*/adapter.ts` and `report.ts` cite; `CONTEXT.md`'s glossary of the new structure and of the ggml-only sidecar's model resolution.

- [ ] **Step 1: Apply the task's diff blocks** (Global Constraints: never by hand).

  ```
  python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/plan-apply.py docs/superpowers/plans/2026-09-30-client-contract-stage2-deletion.md t11
  ```

  Expected: `t11: 11 files changed`, and no other line.

- [ ] **Step 2: Check that nothing reaches what went.**

  ```
  git grep -nE "Inside an IClient|sets for clients|openai-realtime-api|livekit-client|ApiKeyService|IAudioService|ModernBrowserAudioService|ModernAudioPlayer|SimpleConfigPanel|OnboardingContext|The thirteen|Kizuna twins|11 adapters|only MainPanel knows" -- CLAUDE.md CONTEXT.md 'src/providers/*/adapter.ts' src/providers/sessionSide.consistency.test.ts src/lib/diagnostics/report.ts
  ```

  Expected: nothing (exit status 1).

- [ ] **Step 3: Run the gates.** Each command as its own call; every expected number is the replay's.

  - `npx vitest run src`: **532 files passed and 1 skipped (533); 6 656 tests passed and 2 skipped (6 658)**; 0 failed, no unhandled errors.
  - `npx vitest run electron`: 34 files, 477 tests passed. `npx vitest run extension`: 9 files, 56 tests passed.
  - Local Native's old path: `npx vitest run src/services src/lib/local-inference/native src/components/Settings/sections/Native src/components/Settings/engine/useNativeEngineAdapter src/stores/nativeModelStore src/stores/settingsStore` — 39 files, 615 tests passed.
  - The typecheck, as a set: `npx tsc --noEmit -p tsconfig.json > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t11.txt`, then `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t10.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t11.txt` prints exactly `before 95 after 95; new 0; gone 0` and exits 0 — no error the task before did not have; `after 95` is the full tree's count.
  - `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh | diff - /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` prints nothing: the baseline's 16 lines, unchanged.

- [ ] **Step 4: Commit.**

```bash
git add -- CLAUDE.md CONTEXT.md src/lib/diagnostics/report.ts src/providers/gemini/adapter.ts src/providers/openai/adapter.ts src/providers/openai_live/adapter.ts src/providers/openai_translate/adapter.ts src/providers/palabraai/adapter.ts src/providers/sessionSide.consistency.test.ts src/providers/soniox/adapter.ts src/providers/volcengine_ast2/adapter.ts
```

```bash
git commit -q -F - -- CLAUDE.md CONTEXT.md src/lib/diagnostics/report.ts src/providers/gemini/adapter.ts src/providers/openai/adapter.ts src/providers/openai_live/adapter.ts src/providers/openai_translate/adapter.ts src/providers/palabraai/adapter.ts src/providers/sessionSide.consistency.test.ts src/providers/soniox/adapter.ts src/providers/volcengine_ast2/adapter.ts <<'EOF'
docs(claude, context): describe the new provider structure

Rewrite the passages of CLAUDE.md that described the old clients, their
factory and registry, openai-realtime-api, the livekit-client pin, the
old way to add a provider, and audio services and components that do
not exist; rewrite CONTEXT.md's provider and session glossary the same
way, and its native model resolution entries for the ggml-only sidecar.
Both say Local Native runs the old path until #578. The adapters'
and the reporter's citations follow the error-handling heading's name.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

**The blocks** (`t11`, one per file, in the order the applier takes them):

`CLAUDE.md`

`````diff t11
diff --git a/CLAUDE.md b/CLAUDE.md
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -8,7 +8,7 @@
 
 ## Project Overview
 
-Sokuji is a real-time AI-powered translation application available as both an Electron desktop app and a browser extension. It provides live speech translation using OpenAI, Google Gemini, Palabra.ai, and Kizuna AI APIs with modern audio processing capabilities. It also supports OpenAI-compatible API endpoints for flexibility.
+Sokuji is a real-time AI-powered translation application available as both an Electron desktop app and a browser extension. It provides live speech translation through Kizuna AI (managed Soniox), free on-device inference, Google Gemini, Doubao AST 2.0, OpenAI Realtime, OpenAI Translate, OpenAI Live, Soniox and Palabra AI, with modern audio processing capabilities. Local Native, the Electron sidecar, still runs on the old provider path until kizuna-ai-lab/sokuji#578.
 
 ## Development Commands
 
@@ -80,40 +80,60 @@
 ### Key Architectural Components
 
 1. **Service Layer Pattern**
-   - `ServiceFactory` creates platform-specific implementations with singleton caching
-   - All services implement interfaces (IAudioService, ISettingsService)
+   - `ServiceFactory` hands out the one settings service (`SettingsService`, implementing
+     `ISettingsService`), cached as a singleton; audio has no service object (5. below)
    - Platform detection via `src/utils/environment.ts` utilities
 
-2. **AI Client Architecture**
-   - `ClientFactory` creates provider-specific clients
-   - Providers: OpenAI, Gemini, PalabraAI, KizunaAI, OpenAI Compatible
-   - Each client implements `IClient` interface
-   - Real-time communication via WebSocket or REST APIs
-   - OpenAI Compatible provider allows custom API endpoints (Electron only)
-   - KizunaAI uses OpenAI-compatible API with backend-managed authentication
+2. **Provider Architecture** (spec: `docs/superpowers/specs/2026-09-22-client-contract-design.md`)
+   - One folder per provider, `src/providers/<id>/`: `provider.ts`, the definition
+     (settings, credentials, languages, `check`, `session`, its `Settings` view; typed by
+     `src/lib/provider/types.ts`), and `adapter.ts`, the L0 client of one leg: it speaks
+     the provider's wire and emits segments, audio and lifecycle through `AdapterEvents`
+     (`src/lib/contract/adapter.ts`); every adapter passes `src/lib/contract/conformance.ts`
+   - `src/providers/registry.ts` lists them in UI order; `src/lib/provider/presence.ts`
+     decides what a build and platform offer: flagged providers by `VITE_ENABLED_PROVIDERS`,
+     the managed one by `VITE_ENABLE_KIZUNA_AI`, the `fake` providers in development builds
+     only (D24)
+   - `src/stores/providerStore.ts` holds each provider's settings, credentials and pair,
+     stored under `settings.<key>.*` (older keys through the definition's `legacyKeys` and
+     `migrate`); a load never writes
+   - The runner (`src/lib/session/`, `src/app/`) runs the legs; L1
+     (`src/lib/conversation/Conversation.ts`) folds each leg's events into segments
+   - Local Native is the exception until kizuna-ai-lab/sokuji#578: `LocalNativeClient`
+     implements the old `IClient` (`src/services/interfaces/IClient.ts`), registered as
+     `LocalNativeProviderConfig` in `ProviderConfigFactory`, built through `ClientFactory`,
+     and set up in the old settings shell (`ProviderSection`, `LanguageSection`,
+     `ProviderSpecificSettings`), which nothing mounts;
+     `src/providers/oldPath.consistency.test.ts` keeps every other file off that path
 
 3. **Audio Processing Pipeline**
    ```
-   Input Device → ModernAudioRecorder → AI Provider → ModernAudioPlayer → Output Device
+   Source (microphone, system audio, a tab) → runner → provider's adapter → L1 → playback → outputs
    ```
-   - `ModernAudioRecorder`: Captures input with echo cancellation, supports AudioWorklet with ScriptProcessor fallback
-   - `ModernAudioPlayer`: Queue-based playback with event-driven processing and volume control
-   - Unified audio service across all platforms with virtual device support in Electron (Linux only)
+   - `ModernAudioRecorder` (`src/lib/modern-audio/`): captures the microphone with echo
+     cancellation and noise suppression, AudioWorklet with a ScriptProcessor fallback
+   - Playback (`src/lib/audio/playback.ts`): a clip queue per leg and one for replay, the
+     routes kept live from the routing settings, the passthrough stream
+   - `src/lib/audio/appAudio.ts`: one graph per page, and the virtual output per platform
+     (Electron's virtual speaker, the extension's tabs, nothing on the web)
 
 4. **State Management**
    - **Zustand stores** in `src/stores/` for primary application state:
-     - `settingsStore.ts`: Provider settings, API keys, validation state, UI mode
-     - `sessionStore.ts`: Active session state and conversation items
+     - `settingsStore.ts`: common settings (UI mode, text-only, segmentation, display
+       modes) and Local Native's old slice
+     - `providerStore.ts`: each provider's settings, credentials and language pair
+     - `sessionStore.ts`: the locked mode the kept old settings shell reads; nothing writes it
      - `audioStore.ts`: Audio device selection and playback state
      - `logStore.ts`: Application logs and diagnostics
-   - React Context for specific features: OnboardingContext, UserProfileContext
+   - React Context for specific features: UserProfileContext, PostHogContext
    - Zustand's `subscribeWithSelector` middleware for efficient re-renders
    - Backend-managed API key integration for authenticated providers
 
-5. **Audio Service Management**
-   - `ModernBrowserAudioService` provides unified audio handling
-   - Cross-platform compatibility without virtual devices
-   - Automatic device switching and reconnection, including dynamic switching during active sessions
+5. **Audio** (`src/lib/audio/`)
+   - The runner's sources (`capture/`): the microphone (`mic.ts`, over `ModernAudioRecorder`),
+     system audio, a tab — each following its device during a run
+   - The page's playback (`appAudio.ts`, `playback.ts`), the routing read live from
+     `audioStore`, `routingStore` and `turnModeStore`
 
 6. **Native runtime (`native/`)**
    - One CMake super-project builds three engines on ONE pristine upstream ggml 0.22 behind
@@ -222,12 +242,16 @@
 ### Code Organization
 - `src/components/` - Functional React components with TypeScript
 - `src/stores/` - Zustand state management stores
-- `src/services/` - Service layer with interface contracts
-- `src/services/clients/` - AI provider client implementations
-- `src/services/providers/` - Provider-specific configurations
-- `src/lib/modern-audio/` - Web Audio API modules (JavaScript, not TypeScript)
+- `src/providers/<id>/` - One folder per provider: definition, adapter, `Settings` view
+- `src/lib/contract/`, `src/lib/provider/`, `src/lib/session/` - The client contract, the
+  definition's types, the runner
+- `src/services/` - The settings service; Local Native's old client and descriptor
+  (`clients/`, `providers/`) until kizuna-ai-lab/sokuji#578
+- `src/lib/audio/` - The runner's sources (`capture/`) and the page's playback
+- `src/lib/modern-audio/` - The recorders (`ModernAudioRecorder`, the participant recorders)
+  and the echo monitor
 - `src/utils/` - Shared utilities including environment detection
-- `src/contexts/` - React Context providers (OnboardingContext, UserProfileContext)
+- `src/contexts/` - React Context providers (UserProfileContext, PostHogContext)
 
 ### Error Handling
 
@@ -262,21 +286,26 @@
   diagnostic logs are on (Help, off by default; `logStore` records nothing
   otherwise), so it is never the surface a user relies on.
 - **Don't record the same failure twice.** If it already reaches the panel by
-  another route (`handlers.onError`, `onRealtimeEvent`, a rethrow into MainPanel's
-  session-start catch, `validationMessage`, descriptor `notices`), add nothing.
-- **Inside an `IClient` session**, clients never call `report()` and never
-  `console.*` — only MainPanel knows which channel (speaker/participant) a client
-  is on. Pick by what the failure did to the session:
-  - `handlers.onError` — the session is broken. Raises a conversation bubble and
-    an `api_error`.
-  - `handlers.onDiagnostic({ code, message, cause })` — the session continues,
+  another route (an adapter's `failed` or `degraded` event, a start the runner
+  reports, `validationMessage`, a provider's notices), add nothing.
+- **Inside an adapter session** (`src/lib/contract/adapter.ts`), adapters never
+  call `report()` and never `console.*` — only the runner knows which leg an
+  adapter serves. Pick by what the failure did to the session:
+  - `events.failed({ message, code?, cause? })` — the session is broken. L1 files
+    an error notice on the leg, the run ends, and the runner tracks `api_error`.
+  - `events.degraded({ code, message, cause? })` — the session continues,
     degraded: a frame that would not parse, a cleanup step that threw, TTS falling
     back. `code` comes from `CLIENT_DIAGNOSTICS`
-    (`src/lib/diagnostics/clientDiagnostics.ts`), which also decides the severity,
-    so a client never picks one. No bubble, no `api_error`.
-  - `handlers.onRealtimeEvent` — wire traffic, not a failure.
-  - throw out of `connect()` — the session never started; MainPanel's
-    `onConnectFailed` reports it once, for whichever leg it was.
+    (`src/lib/diagnostics/clientDiagnostics.ts`), which also decides the notice's
+    severity, so an adapter never picks one; L1 files it once per window, and the
+    runner tracks `api_error`.
+  - `events.frame(...)` — wire traffic for the Logs panel, not a failure.
+  - a `start()` that rejects (an `AdapterStartError` carries a notice code) — the
+    session never started; the runner reports it once, for whichever leg it was.
+  `src/providers/sessionSide.consistency.test.ts` holds every adapter to this.
+  Local Native's old `IClient` (until kizuna-ai-lab/sokuji#578) keeps the same
+  rule through `handlers.onError`, `handlers.onDiagnostic` and
+  `handlers.onRealtimeEvent`.
 - **Hot paths** (per-audio-chunk, per-frame, per-poll-tick) never log per
   occurrence: return silently, or report the ok → failing transition. Bursts pass
   `dedupeKey`; the panel throttles per key on a 5s window while the console still
@@ -315,23 +344,23 @@
 ### Zustand Store Patterns
 ```typescript
 // Using optimized selectors (preferred - prevents unnecessary re-renders)
-const provider = useProvider();
-const setProvider = useSetProvider();
+const uiMode = useUIMode();
+const setUIMode = useSetUIMode();
 
 // Direct store access for multiple values
-const { provider, uiLanguage, uiMode } = useSettingsStore();
+const { uiLanguage, uiMode, textOnly } = useSettingsStore();
 
 // Subscribing to changes outside React
 useSettingsStore.subscribe(
-  (state) => state.provider,
-  (provider) => console.log('Provider changed:', provider)
+  (state) => state.uiMode,
+  (uiMode) => console.log('UI mode changed:', uiMode)
 );
 ```
 
 ### Audio Handling
-- Always use ModernAudioPlayer/ModernAudioRecorder classes
+- Capture through the runner's sources (`src/lib/audio/capture/`, the microphone over `ModernAudioRecorder`); play through `src/lib/audio/playback.ts`
 - Audio playback uses queue-based system with event-driven processing
-- Passthrough audio uses dedicated 'passthrough' track ID for real-time monitoring (default volume: 30%)
+- Passthrough: the microphone's processed voice, under the translation, into the meeting (the virtual output) on its own `passthrough` feed (`src/lib/audio/routes.ts`); off by default, its volume `audioStore`'s `realVoicePassthroughVolume`, default 0.2 — the settings show 20%, on a 0–60% slider
 - AudioWorklet preferred for processing, falls back to ScriptProcessor for compatibility
 - Echo cancellation enabled by default with modern browser APIs
 
@@ -385,34 +414,13 @@
 - **zustand**: State management with `subscribeWithSelector` middleware
 - **@floating-ui/react**: Advanced tooltip positioning and floating elements
 - **i18next & react-i18next**: Internationalization framework
-- **openai-realtime-api**: OpenAI real-time API client (strongly-typed fork)
-- **@google/genai**: Google Gemini SDK
-- **livekit-client**: LiveKit SDK for Palabra AI WebRTC integration — **pinned to an exact version, do not upgrade** (see below)
+- **openai** (dev): the OpenAI SDK, for its realtime wire types (`openai`, `openai_translate`)
+  and the socket `src/providers/openai/wire.oracle.test.ts` checks the hand-written wire against
+- **@google/genai** (dev): the Gemini SDK, the same way: its server types, and the socket
+  `src/providers/gemini/wire.oracle.test.ts` checks the wire against
 - **better-auth**: Authentication library for user sessions
 - **lucide-react**: Icon library
-- **ws**: WebSocket client for real-time communication
-
-### livekit-client is version-capped by Palabra's server
~ 18 more removed lines sha256:91097f52ed49
-Before lifting the pin, confirm the server echoes the id — join a room and check that the
-inbound `answer` has a non-zero `SessionDescription.id`.
+- **ws**: WebSocket client for the development wire probes (`scripts/dev/wire-probe/`)
 
 ### Internationalization
 - Complete translations for 35+ languages
@@ -423,16 +431,26 @@
 ## Common Development Tasks
 
 ### Adding a New AI Provider
-1. Create the client class implementing `IClient` in `src/services/clients/`
-2. Create `XProviderConfig` in `src/services/providers/` extending `BaseProviderDescriptor`:
-   settings interface + defaults, `settingsSliceKey`, `createClient`, `validateAndFetchModels`,
-   `extractCredentials`, `buildSessionConfig`, language overrides if restricted;
-   set `supportsWebRTC = true` if the provider runs over WebRTC transport (it defaults
-   to `false`), and `i18nKey` if the locale key differs from the provider id
-3. Register it in `ProviderConfigFactory`'s static block (behind its feature flag)
-4. Add the enum value in `src/types/Provider.ts` and the settings slice + update action in `settingsStore.ts`
-5. Add `providers.<id>.name/.description` to locales
-The registry invariant test (`descriptorRegistry.test.ts`) fails loudly on anything missed.
+What the spec's "What adding a provider then touches" lists
+(`docs/superpowers/specs/2026-09-22-client-contract-design.md`), as the Stage 2 ports landed:
+1. One folder, `src/providers/<id>/`: `provider.ts` (the definition, typed by
+   `src/lib/provider/types.ts`: settings with their defaults — and `legacyKeys`/`migrate`
+   when it reads keys an older build stored — credentials, languages, `check`,
+   `session`), `adapter.ts` (the L0 client, `src/lib/contract/adapter.ts`, passing the
+   conformance suite `src/lib/contract/conformance.ts`), its `Settings` view, and tests.
+2. One line in `src/providers/registry.ts`, whose order is the picker's, and the order
+   tests: `registry.test.ts` pins the whole list, and a neighbour's `provider.test.ts`
+   may pin its place. `src/providers/sessionSide.consistency.test.ts` holds its adapter
+   automatically (it walks every `src/providers/*` folder); pin its session side there, as
+   the ports did.
+3. `providers.<id>.name` and `.description` in the 30 locale catalogs — or under the
+   definition's `i18nKey` where the catalogs already spell it otherwise — only when new.
+4. The extension manifest, when it uses a host the manifest does not list yet: MV3
+   declares hosts statically (`host_permissions`, and the CSP's `connect-src`).
+5. When it is flagged, its id in `VITE_ENABLED_PROVIDERS` at release.
+`registry.test.ts`'s invariants fail loudly on anything missed. Local Native is the
+exception until kizuna-ai-lab/sokuji#578: it still runs the old path (`src/services/`,
+`ProviderConfigFactory`, the old settings shell).
 
 ### Adding a native model or TTS family
 
@@ -579,7 +597,7 @@
 corrected on 2026-09-05.
 
 ### Modifying Audio Pipeline
-1. Audio processing modules in `src/lib/modern-audio/` (JavaScript files)
+1. Audio processing modules in `src/lib/modern-audio/` (the recorders; TypeScript) and `src/lib/audio/` (sources and playback)
 2. Test with both regular and passthrough audio
 3. Ensure echo cancellation is working properly
 4. Handle browser security restrictions and permissions
@@ -596,15 +614,17 @@
 
 ### Dynamic Audio Device Switching
 1. Recording devices can be switched during active sessions without interrupting the session
-2. Implemented via `switchRecordingDevice` method in `ModernBrowserAudioService`
-3. MainPanel detects device changes via useEffect hook
+2. The microphone source (`openMic`, `src/lib/audio/capture/mic.ts`) reads its device and
+   noise suppression live (`MicSettings`, bound to `audioStore` in `src/lib/audio/appCapture.ts`);
+   when the device changes it ends the recorder and begins it again on the new one
+3. A switch in flight finishes before the source stops; a switch that fails ends the source
+   with its reason
 4. Important: Use `selectedInputDevice?.deviceId` string in React dependencies, not the full device object
-5. The service tracks current device with `currentRecordingDeviceId` and handles reconnection automatically
 
 ## UI Components
 
 ### Simple Mode Components
-- **SimpleConfigPanel**: 6-section configuration (account, language, translation, API key, mic, speaker)
+- **SimpleSettings** (`src/components/Settings/SimpleSettings/SimpleSettings.tsx`): the simple layout's settings — the session settings (`SessionSettingsGeneral` in `ProviderArea.tsx`: languages, speech, output switches, sentence segmentation, the provider picker), the microphone and speaker, system audio, help
 - **MainPanel**: Unified conversation panel with `uiMode`-driven layout (basic: bubble messages + status footer, advanced: bubble messages + waveform footer with controls)
 - **Tooltip**: @floating-ui/react powered tooltips with hover/click/focus triggers
 - **ConnectionStatus**: Real-time connection state indicator
@@ -612,7 +632,7 @@
 ### UI Design System
 - Dark theme with consistent styling across components
 - Primary action color: `#10a37f` (green), Error state: `#e74c3c` (red)
-- Component styles defined in colocated SCSS files (e.g., `SimpleConfigPanel.scss`)
+- Component styles defined in colocated SCSS files (e.g., `SimpleSettings.scss`)
 - Lucide React icons with consistent sizing (14-16px)
 
 ## Platform Requirements
@@ -662,7 +682,7 @@
 
 ### Security Policy
 - Strict CSP configuration for extension pages
-- Allowed connections to AI provider APIs (OpenAI, Google, Palabra, Kizuna AI, and OpenAI-compatible endpoints)
+- Allowed connections to AI provider APIs (OpenAI, Google, Doubao, Soniox, Palabra, Kizuna AI)
 - PostHog analytics integration for usage tracking
 
 ## Authentication and API Key Management
@@ -674,16 +694,19 @@
 - **Cross-Platform**: Authentication works across Electron and browser extension
 
 ### API Key Types
-1. **User-Managed Keys**: OpenAI, Gemini, Palabra AI, OpenAI Compatible - users input their own keys
+1. **User-Managed Keys**: OpenAI (Realtime, Translate, Live), Gemini, Doubao AST 2.0, Soniox, Palabra AI - users input their own keys
 2. **Backend-Managed Keys**: Kizuna AI - keys fetched from authenticated backend service
 
 ### Authentication Flow for Kizuna AI
-1. User signs in via Better Auth authentication
-2. `ApiKeyService` fetches API key from backend endpoint (`/api/user/api-key`)
-3. API key is cached for 5 minutes to reduce backend load
-4. Provider becomes available in UI only when authenticated and key is available
+1. User signs in via Better Auth authentication (`src/lib/auth-client.ts`)
+2. The managed provider (`src/providers/soniox/kizuna.ts`) asks for the sign-in in place of
+   a key, and for the balance floor its budget sets
+3. At Start its lease (`src/providers/soniox/lease.ts`) buys the session's keys from the
+   backend, one per stream; the run ends when the grant does, and the lease tells the
+   backend when the session is over
+4. It is offered only in builds with `VITE_ENABLE_KIZUNA_AI`
 
 ### Key Services
-- **ApiKeyService**: Handles fetching API keys from backend with caching
-- **AuthContext**: Manages authentication state and token lifecycle (Better Auth)
-- **Service Integration**: All AI clients check authentication before operations
\ No newline at end of file
+- **Lease** (`src/providers/soniox/lease.ts`): the managed session's keys, per run
+- **Auth client** (`src/lib/auth-client.ts`, `src/lib/auth/`): authentication state and
+  session (Better Auth)
\ No newline at end of file
`````

`CONTEXT.md`

`````diff t11
diff --git a/CONTEXT.md b/CONTEXT.md
--- a/CONTEXT.md
+++ b/CONTEXT.md
@@ -4,26 +4,26 @@
 
 ## Provider domain
 
-- **Provider** — one AI translation backend. The thirteen `ProviderConfigFactory` registers, in its registration order: the three Kizuna-managed ones (Soniox, OpenAI Translate, Volcengine AST2), Local Inference, Gemini, Volcengine AST2, OpenAI, OpenAI Translate, OpenAI Live, Soniox, OpenAI Compatible, Palabra, Local Native. Several are behind a feature flag or a platform gate, so a given build offers a subset. Identified by the `Provider` enum value. The enum value is an identifier only — the canonical persisted-settings location is the descriptor's `settingsSliceKey`, which may differ from it (e.g. `openai_compatible` → `openaiCompatible`; the kizuna twins point at their own dedicated slices).
-- **ProviderDescriptor** — the deep module that answers *every* question about one provider: static config (`getConfig()`), client construction (`createClient`), credential extraction (`extractCredentials`), key validation (`validateAndFetchModels`), latest-model resolution, session-config building (`buildSessionConfig`), language rules (`resolveSourceLanguages` / `resolveTargetLanguages`), i18n name key, and its `settingsSliceKey`. One class per provider (`XProviderConfig`), registered centrally in the Provider Registry. Adding a provider means writing one descriptor and registering it, plus the small set of things that still live outside the descriptor: a `Provider` enum value, the settings slice type + its update action in `settingsStore`, and locale entries for the provider's name/description (see CLAUDE.md's "Adding a New AI Provider" recipe for the full checklist).
-- **Provider Registry** — `ProviderConfigFactory`'s explicit static registration list, the single source of truth for which providers exist and are available on the current platform/build (feature flags and platform gates live only here). No module-side-effect self-registration.
-- **Settings slice** — the persisted zustand slice holding one provider's user settings (e.g. `state.volcengineAST2`). The slice's TypeScript interface and defaults live in that provider's descriptor module; the store imports them. A descriptor names its slice via `settingsSliceKey` (kizuna twins reuse a base descriptor's builders but point at their own slice).
-- **Credentials** — the normalized result of `extractCredentials`: `{ ok: true, primary, secret?, endpoint? } | { ok: false, missing }`. Each provider's raw fields (clientId/clientSecret, accessKeyId/secretAccessKey, appId/accessToken, apiKey/apiSecret, auth token) map into this shape inside its descriptor; callers never name provider-specific fields.
-- **Kizuna twins (relay twins)** — `KIZUNA_AI_OPENAI_TRANSLATE` / `KIZUNA_AI_VOLCENGINE_AST2`: backend-managed variants that subclass a base provider's descriptor, reuse its session-config builder, but authenticate with a Better Auth session token via the relay (`getAuthToken()` — the async case of `extractCredentials`).
-- **Local Inference vs Local Native** — two PEER providers, same rank as OpenAI or Gemini; NOT two adapters of one shared inference seam. Local Inference runs models in the browser (WASM/WebGPU workers, models in IndexedDB) so it works everywhere; Local Native runs the Python sidecar (WS-RPC, models on the filesystem) for better hardware utilization. They may offer similarly-named models built from the same base weights, but the model repos, runtimes, and readiness stores (`modelStore` vs `nativeModelStore`) are deliberately separate. The only abstractions they share are the ones every provider shares: `IClient` and `ProviderDescriptor`. Do not introduce a unifying layer between them.
-- **SessionConfig** — the per-provider wire configuration handed to `IClient.connect()`. Built by the descriptor from its settings slice; cross-provider fields (`textOnly`, `keepReplayAudio`) are applied by the store shell after building.
+- **Provider** — one AI translation backend: a definition in `src/providers/<id>/`. The registry lists nine, in the picker's order: Kizuna AI (the managed Soniox), Local Inference, Gemini, Doubao AST 2.0 (Volcengine AST2), OpenAI Realtime, OpenAI Translate, OpenAI Live, Soniox, Palabra; development builds add the `fake` providers. Several are behind a feature flag, a platform or the Kizuna sign-in, so a given build offers a subset. Identified by the definition's `id`, the old `Provider` enum's spelling (`src/types/Provider.ts`) but for `localInference` (`LEGACY_PROVIDER_IDS`). The id is an identifier only — its settings persist under the definition's `settings.key`, the old slice key, which may differ from it (e.g. `openai_translate` → `openaiTranslate`; `LEGACY_SLICE_KEYS`, `src/lib/session/storedSettings.ts`). Local Native is not in the registry: it still runs the old path until kizuna-ai-lab/sokuji#578.
+- **Provider definition** — the object that answers *every* question about one provider (`Provider<S, K, C, R>`, `src/lib/provider/types.ts`): its settings (`key`, `defaults`, `legacyKeys`, `migrate`) and its `Settings` view, its credentials (`keys`, `fields`, `read`), its readiness `check`, its languages (`sources`, `targets`, `initial`, `reverse`), the capabilities generic code reads (`speech`, `textInput`, `boundaries`, `turns`), `build` / `describe` for one leg's config, `start` (its adapter) and optional session hooks. Adding a provider means one folder, one registry line and its order tests, and locale entries only when new (see CLAUDE.md's "Adding a New AI Provider" recipe for the full checklist). The old path's equivalent, **ProviderDescriptor** (`src/services/providers/ProviderDescriptor.ts`), survives only as `LocalNativeProviderConfig`, until #578.
+- **Provider Registry** — `src/providers/registry.ts`: one list in the picker's order, the single source of truth for which providers exist. `isPresent` (`src/lib/provider/presence.ts`) decides which a build and platform offer, from the definition's `platforms`, `kind`, `flagged` and `testerSwitch`: `VITE_ENABLED_PROVIDERS` names the flagged ones a release offers, `VITE_ENABLE_KIZUNA_AI` gates the managed one. No module-side-effect self-registration. The old registry, `ProviderConfigFactory`, holds Local Native alone until #578.
+- **Provider settings** — one provider's user settings (`S`), held by `providerStore` (`src/stores/providerStore.ts`) and stored under `settings.<key>.*`. A load reads each field of `defaults`, the credentials, the `legacyKeys` and the pair, runs `migrate`, and writes nothing back. `settingsStore` keeps the common settings and the old path's `localNative` slice.
+- **Credentials** — what a definition's `credentials.read(values, auth)` answers: the provider's own record (`R`), or `{ missing }` when a field is empty or the sign-in is absent. The credential form draws `credentials.fields(s)`; each value persists at `settings.<key>.<field>`, and callers never name provider-specific fields. The old path's `extractCredentials` shape is `LocalNativeProviderConfig`'s alone.
+- **Managed provider** — Kizuna AI's own service on a third-party engine: Kizuna Soniox (`kizunaai_soniox`, `src/providers/soniox/kizuna.ts`), `managed(base, …)` (`src/lib/provider/managed.ts`) over Soniox's definition — the sign-in in place of a key, and a lease (`lease.ts`) that buys each stream's key from the backend per run. The relay twins (`kizunaai_openai_translate`, `kizunaai_volcengine_ast2`) are deleted, not ported; a stored selection of one resolves to Kizuna Soniox (`MANAGED_LEGACY_IDS`, `src/lib/session/storedSettings.ts`).
+- **Local Inference vs Local Native** — two PEER providers, same rank as OpenAI or Gemini; NOT two adapters of one shared inference seam. Local Inference runs models in the browser (WASM/WebGPU workers, models in IndexedDB) so it works everywhere; Local Native runs the Python sidecar (WS-RPC, models on the filesystem) for better hardware utilization. They may offer similarly-named models built from the same base weights, but the model repos, runtimes, and readiness stores (`modelStore` vs `nativeModelStore`) are deliberately separate. Local Inference is a provider of the new structure (`src/providers/localInference/`); Local Native still runs the old path (`LocalNativeClient`, `LocalNativeProviderConfig`) until #578 ports it beside it. Do not introduce a unifying layer between them.
+- **Leg config** — what a provider's adapter starts one leg with (`C`): built by the definition's `build(context, s, shared)` from its settings and the run's shared settings, and handed to `start`. The old path's **SessionConfig** (`src/services/interfaces/IClient.ts`) is `LocalNativeSessionConfig` alone, handed to `IClient.connect()`.
 
 ## Native sidecar model resolution
 
-- **Model catalog card** — the declarative row in the sidecar's `catalog.py` describing one native model: its `Deployment`s (backend/tier/quant/artifact) plus per-model facts (download-ignore globs, chat-template thinking behaviour, CUDA variant subdir). The card is the single source of truth for model-specific facts; the sidecar reads them declaratively rather than special-casing by model-id substring. Uncatalogued sherpa-onnx community voices are synthesised as ad-hoc cards by `catalog.resolve_tts_card`, so even the long tail flows through the same card shape. (One deliberate exception stays imperative: a loaded TTS backend's runtime capabilities — `sample_rate`/`STREAMING`/`CLONES` — are read off the backend object, because the synthesised card only guesses them.)
-- **Planner / Loader** — the two halves of native model resolution. The **Planner** (pure, `planner.py`) turns `(card, Machine, bench, downloaded)` into ranked `Plan`s — tier gating and quant selection — with no I/O, so it is table-testable without monkeypatching. The **Loader** (effectful, `accel.py`) probes hardware, downloads weights, loads a backend behind the VRAM fallback gate, and benchmarks. Split around the deep islands (the `load_with_fallback` VRAM gate stays in the Loader), not through them.
-- **Plan / Plan.config** — a `Plan` is one resolved deployment (backend, device, quant, artifact) the Loader can execute. `Plan.config` carries card-derived backend hints (thinking flags, variant subdir) so a backend receives plain config at `load()` and stays decoupled from the catalog card types.
+- **Model catalog card** — one row of the sidecar's `catalog.py` (`AsrModel`, `TranslateModel`, `TtsModel`) describing one native model: its `Deployment`s (backend, tier — `gpu-metal`, `gpu-vulkan` or `cpu` — quant, and the artifact: one pinned GGUF on the Hub, which `native_models.py` downloads) plus per-model facts — `graph_family` (the op-coverage key), the translation cards' chat-template thinking flags and prompt family, the TTS cards' audio.cpp family and voice facts. The card is the single source of truth for model-specific facts; the sidecar reads them declaratively rather than special-casing by model-id substring, and an id that is no row is unknown (`catalog.resolve_tts_card`). One deliberate exception stays imperative: a loaded TTS model's streaming, cloning and sample rate are read off the loaded model (`tts_backend.py`, from `sokuji_native`'s capabilities). The renderer reads the catalog over the sidecar's wire (`src/lib/local-inference/native/nativeCatalog.ts`).
+- **Planner / Loader** — the two halves of native model resolution. The **Planner** (pure, `planner.py`) turns `(card, Machine, bench, downloaded, op coverage)` into ranked `Plan`s — tier gating (`TIER_RANK`; a paravirtual Metal device is no `gpu-metal`), quant selection, and the op-coverage gate (only TTS refuses a rung) — with no I/O, so it is table-testable without monkeypatching. The **Loader** (effectful, `accel.py`) probes the devices through `sokuji_native` (`native.py`, the sidecar's one door to it), downloads weights, loads a backend behind the VRAM fallback gate, and benchmarks. Split around the deep islands (the `load_with_fallback` VRAM gate stays in the Loader), not through them. The backends (`asr_backend.py`, `translate_backend.py`, `tts_backend.py`) run transcribe.cpp, llama.cpp and audio.cpp on one ggml (`native/`; CLAUDE.md's "Native runtime").
+- **Plan / Plan.config** — a `Plan` is one resolved deployment (backend, tier, device, quant, artifact) the Loader can execute. `Plan.config` (`PlanConfig`) carries card-derived backend hints — the thinking flags and prompt family for translation; the TTS family, its load-time language and its extra files — so a backend receives plain config at `load()` and stays decoupled from the catalog card types.
 
 ## Session domain
 
-- **Client** — an `IClient` adapter speaking one provider's realtime protocol (11 adapters behind the `IClient` seam). Constructed only by its provider's descriptor.
+- **Adapter** — one leg's client of a provider's realtime protocol: `adapter.ts` in the provider's folder, implementing L0 (`src/lib/contract/adapter.ts`) — a started session emits segments, audio and lifecycle through `AdapterEvents` — and held to the conformance suite (`src/lib/contract/conformance.ts`). Reached only through its definition's `start`. The old path's **Client** (`IClient`, `src/services/interfaces/IClient.ts`) survives only as `LocalNativeClient`, until #578.
 - **SidecarConnection** — the WS-RPC transport seam behind the Local Native clients (`ISidecarConnection` is the interface the clients depend on and tests substitute). Owns one socket to the Python sidecar and the mechanics every native client shared: connect, id-correlated request/reply, fire-and-forget send, outbound binary, and routing of un-correlated push messages. The *connection* is the unit, not a shared socket — each native stage client (ASR / translate / TTS / model) holds its own, because the sidecar routes binary frames and frees VRAM per-connection. Native-only: the browser (WASM) side of Local Inference talks to workers, not a sidecar, so it has no equivalent — do not generalize this into a cross-provider transport.
-- **ConversationItem** — the unified transcript unit (user/assistant message with text/transcript/audio) that every client reduces provider events into.
+- **Segment** — the transcript unit: a source or translation segment with its text, speech and pairing, which L1 (`src/lib/conversation/Conversation.ts`, one per leg) folds an adapter's events into and L2 projects for the surfaces. The old path's **ConversationItem** (`IClient.ts`) is `LocalNativeClient`'s alone.
 
 ## Extension domain
 
`````

`src/lib/diagnostics/report.ts`

`````diff t11
diff --git a/src/lib/diagnostics/report.ts b/src/lib/diagnostics/report.ts
--- a/src/lib/diagnostics/report.ts
+++ b/src/lib/diagnostics/report.ts
@@ -19,9 +19,11 @@
  *     the owning store and a component renders it. A logger that can pop a
  *     toast is how "which tier is this?" gets re-litigated at every call site.
  *
- * Not a sink for session-scoped client failures: inside an `IClient` session a
- * client uses `handlers.onError` / `onDiagnostic` / `onRealtimeEvent`, because
- * only MainPanel knows which channel (speaker/participant) it is.
+ * Not a sink for session-scoped failures: inside an adapter session an adapter
+ * says what happened through its events (`failed`, `degraded`, `frame`),
+ * because only the runner knows which leg it serves (CLAUDE.md, "Inside an
+ * adapter session"); Local Native's old `IClient` does the same through
+ * `handlers.onError` / `onDiagnostic` / `onRealtimeEvent`.
  */
 import useLogStore, { type ClientId } from '../../stores/logStore';
 // Redaction is applied at the sink (`logStore.addLog`), not here, so it also
`````

`src/providers/gemini/adapter.ts`

`````diff t11
diff --git a/src/providers/gemini/adapter.ts b/src/providers/gemini/adapter.ts
--- a/src/providers/gemini/adapter.ts
+++ b/src/providers/gemini/adapter.ts
@@ -13,7 +13,7 @@
  * model's `turnComplete` (`hold.ts`; Gemini hold, ruling 1), and under
  * automatic turns let go one utterance at a time (ruling 4).
  * Every timer reads the request's clock, and nothing is said but through
- * events (CLAUDE.md, "Inside an IClient session").
+ * events (CLAUDE.md, "Inside an adapter session").
  */
 import type { Part } from '@google/genai';
 import {
`````

`src/providers/openai/adapter.ts`

`````diff t11
diff --git a/src/providers/openai/adapter.ts b/src/providers/openai/adapter.ts
--- a/src/providers/openai/adapter.ts
+++ b/src/providers/openai/adapter.ts
@@ -10,7 +10,7 @@
  * in-band responses go up one at a time (`queue.ts`, ruling 8); the drift
  * anchor re-sends the instructions out of band (ruling 2). Every timer
  * reads the request's clock, and nothing is said but through events
- * (CLAUDE.md, "Inside an IClient session").
+ * (CLAUDE.md, "Inside an adapter session").
  */
 import type {
   ConversationItemAdded,
`````

`src/providers/openai_live/adapter.ts`

`````diff t11
diff --git a/src/providers/openai_live/adapter.ts b/src/providers/openai_live/adapter.ts
--- a/src/providers/openai_live/adapter.ts
+++ b/src/providers/openai_live/adapter.ts
@@ -12,7 +12,7 @@
  * it (ruling 5). A lost connection is tried again once, then the leg fails
  * (ruling 6). Stop sends `session.close` and closes at once (ruling 8).
  * Every timer reads the request's clock, and nothing is said but through
- * events (CLAUDE.md, "Inside an IClient session").
+ * events (CLAUDE.md, "Inside an adapter session").
  */
 import {
   AdapterStartError,
`````

`src/providers/openai_translate/adapter.ts`

`````diff t11
diff --git a/src/providers/openai_translate/adapter.ts b/src/providers/openai_translate/adapter.ts
--- a/src/providers/openai_translate/adapter.ts
+++ b/src/providers/openai_translate/adapter.ts
@@ -10,7 +10,7 @@
  * its origin (Stage 2 translation cuts, rulings 1, 2); a push-to-talk release
  * sends a real-time silence tail
  * (`tail.ts`, ruling 2). Every timer reads the request's clock, and nothing
- * is said but through events (CLAUDE.md, "Inside an IClient session").
+ * is said but through events (CLAUDE.md, "Inside an adapter session").
  */
 import type {
   RealtimeError,
`````

`src/providers/palabraai/adapter.ts`

`````diff t11
diff --git a/src/providers/palabraai/adapter.ts b/src/providers/palabraai/adapter.ts
--- a/src/providers/palabraai/adapter.ts
+++ b/src/providers/palabraai/adapter.ts
@@ -11,7 +11,7 @@
  * a stream with no audio carries real-time silence (ruling 3). Messages
  * become segments paired by their sentence, speech ranged once its burst is
  * whole (`items.ts`; ruling 6). Every timer reads the request's clock, and
- * nothing is said but through events (CLAUDE.md, "Inside an IClient
+ * nothing is said but through events (CLAUDE.md, "Inside an adapter
  * session").
  */
 import {
`````

`src/providers/sessionSide.consistency.test.ts`

`````diff t11
diff --git a/src/providers/sessionSide.consistency.test.ts b/src/providers/sessionSide.consistency.test.ts
--- a/src/providers/sessionSide.consistency.test.ts
+++ b/src/providers/sessionSide.consistency.test.ts
@@ -1,7 +1,7 @@
 /**
  * A provider's session side — its `adapter.ts` and every file of its own
  * folder the adapter reaches by a value import — follows the rules
- * CLAUDE.md sets for clients (F17): it never imports a store or the
+ * CLAUDE.md sets for adapters (F17): it never imports a store or the
  * reporter (an adapter cannot know which leg it serves; it says what
  * happened through its events — `degraded`, `failed`, `closed`, `frame`),
  * and every timer it runs reads the request's clock (the F9 convention),
`````

`src/providers/soniox/adapter.ts`

`````diff t11
diff --git a/src/providers/soniox/adapter.ts b/src/providers/soniox/adapter.ts
--- a/src/providers/soniox/adapter.ts
+++ b/src/providers/soniox/adapter.ts
@@ -7,7 +7,7 @@
  * `LegSpeech`. Both mode (`startBoth`, D23) is two single-leg cores, or one
  * core whose socket carries both legs mixed. Every timer reads the
  * request's clock, and nothing is said but through events (CLAUDE.md,
- * "Inside an IClient session").
+ * "Inside an adapter session").
  */
 import {
   AdapterStartError,
`````

`src/providers/volcengine_ast2/adapter.ts`

`````diff t11
diff --git a/src/providers/volcengine_ast2/adapter.ts b/src/providers/volcengine_ast2/adapter.ts
--- a/src/providers/volcengine_ast2/adapter.ts
+++ b/src/providers/volcengine_ast2/adapter.ts
@@ -9,7 +9,7 @@
  * text is final (Gemini/AST2 follow-up, ruling 1) — and what goes up is
  * resampled and paced (`audioIn.ts`). Every timer reads the request's
  * clock, and nothing is said but through events (CLAUDE.md, "Inside an
- * IClient session").
+ * adapter session").
  */
 import {
   AdapterStartError,
`````

---

### Wave 3 check (controller)

After Task 11: the full gates — `npx vitest run src` at 532 + 1 files and 6 656 + 2 tests, 0 failed, no unhandled errors; `npx vitest run electron` 34 / 477; `npx vitest run extension` 9 / 56; the gate equal to `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` (16 lines); `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t00.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t11.txt` reports `new 0` and `after 95`. Then `git log --oneline -3` shows the wave's commits, one per task, and `git status --short` shows nothing of this plan's.

---


### Group check (controller, after Wave 3)

No step types a key or presses Start. Outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-group/`. The "before" numbers were measured on a scratch copy of `fa301e9a`, the "after" ones on the replay's result; the controller's own builds should match them to within a few kilobytes.

- [ ] **The full gates:** `npx vitest run src` at 0 failed with no unhandled errors (the replay: 532 files passed and 1 skipped, 6 656 tests passed and 2 skipped); the gate equal to this plan's 16-line baseline file; `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t00.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tsc/t11.txt` reports `new 0` and `after 95`. `npx vitest run electron`: 34 files, 477 tests; `npx vitest run extension`: 9 files, 56 tests.
- [ ] **Local Native's old path** (ruling 1): `npx vitest run src/services src/lib/local-inference/native src/components/Settings/sections/Native src/components/Settings/engine/useNativeEngineAdapter src/stores/nativeModelStore src/stores/settingsStore` — 39 files, 615 tests passed (at `fa301e9a`: 80 files, 1 499 tests; the difference is the deleted old code's own tests), 0 failed.
- [ ] **The builds:** `npm run build`, then `npm run extension:build` (if `extension/node_modules` is missing, `npm ci --prefix extension` first); both exit 0.
- [ ] **The D24 greps** print nothing, as at `fa301e9a`:
  - `command grep -rlF 'The fake degraded its speech' build extension/dist`
  - `command grep -rlF 'Lease ended by the leased fake' build extension/dist`
  - `command grep -rlF 'The leased fake refused the lease' build extension/dist`
- [ ] **The deleted clients are gone from both bundles.** At `fa301e9a` every old client shipped — `ProviderConfigFactory` registers every descriptor, and `settingsStore` imports it — in `build/static/audioStore-*.js` and `extension/dist/assets/settingsStore-*.js`, and each of these strings was in both: `OpenAIGAClient`, `SonioxClient`, `PalabraAIClient`, `GeminiClient`, `VolcengineAST2Client`, `OpenAILiveClient`, `LocalInferenceClient`, `ManagedSonioxSession`, `EphemeralTokenService`, `cometapi`; `OPENAI_LIVE_SET_HEADERS` and `VOLCENGINE_AST2_SET_HEADERS` in `extension/dist/background.js` too; `livekit` and `openai-realtime-api` in the dependency chunks (`build/static/package-*.js`, `extension/dist/assets/package-*.js`). Now each command prints nothing:
  - `command grep -rlE --include='*.js' 'OpenAIGAClient|SonioxClient|PalabraAIClient|GeminiClient|VolcengineAST2Client|OpenAILiveClient|LocalInferenceClient|ManagedSonioxSession|EphemeralTokenService|OPENAI_LIVE_SET_HEADERS|VOLCENGINE_AST2_SET_HEADERS|openai-realtime-api|cometapi' build extension/dist`
  - `command grep -rlF --include='*.js' livekit build extension/dist`
- [ ] **What stays shipped still ships:** `command grep -rlF --include='*.js' 'session.headers' build extension/dist` names `build/static/index-*.js` and `extension/dist/fullpage.js`; `command grep -rlF --include='*.js' WS_HEADERS_SET build extension/dist` also names `extension/dist/background.js` and `extension/dist/wsHeaderRule.js` (the header seam, untouched).
- [ ] **The bundle sizes** (bytes; `find build -name '*.js' -printf '%s\n' | awk '{s+=$1} END {print s}'`, the same for `*.map` and for `extension/dist`, and `du -sb build extension/dist`):

  | | `fa301e9a` | after Task 11 | change |
  |---|---|---|---|
  | `build/` JavaScript | 10 842 039 | 9 478 819 | −1 363 220 (−12.6 %) |
  | `build/` source maps | 26 459 933 | 21 309 238 | −5 150 695 |
  | `build/` whole | 147 727 129 | 141 210 110 | −6 517 019 |
  | `extension/dist/` JavaScript | 12 343 872 | 10 912 438 | −1 431 434 (−11.6 %) |
  | `extension/dist/` whole | 114 683 547 | 113 249 088 | −1 434 459 |

  The largest chunks move: the web build's `audioStore-*.js` (1 612 653 bytes, which carried the old clients) is gone and `index-*.js` grows from 1 222 236 to 1 723 384; the extension's `assets/settingsStore-*.js` shrinks from 1 852 148 to 341 813 and `fullpage.js` grows from 881 498 to 1 082 029 (the bundler regroups what stays). The rest (the model runtimes, wasm, fonts) is unchanged.
- [ ] **Nothing new reaches the old path** (ruling C11): the guard runs in every suite from Task 10 on — `npx vitest run src/providers/oldPath.consistency.test.ts`: 1 file, 3 tests passed. Its scan takes static imports and re-exports, side-effect imports, dynamic `import()` and `require()`, with the TypeScript parser; outside the old path's own files, the only value imports of `src/services/{clients,providers,interfaces}/` are the four shared leaves (`ProviderConfig`, `astGuard`, `tutorialUrls`, `ISettingsService`). The shell is still not mounted: `git grep -nE "<(ProviderSection|LanguageSection|ProviderSpecificSettings)\b" -- src ':!*.test.tsx'` prints nothing, as at `fa301e9a`. (It is compiled and evaluated: `src/components/Settings/index.ts:6` re-exports `./sections`, whose `index.ts:1-2` re-export the two sections.)
- [ ] **Every provider's Settings, rendered, as at `fa301e9a`.** Two fresh vites, one on a scratch copy of `fa301e9a` (`git archive fa301e9a | tar -x -C /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-group/before`, `node_modules` and `extension/node_modules` linked from the worktree) on port 5198, one on the worktree on port 5199, each `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port <port> --strictPort --force`, driven by `scripts/dev/headless.mjs` with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required`, each on its own fresh profile. Before the app loads, `Page.addScriptToEvaluateOnNewDocument` injects the tutorial harness's desktop fake, as the Stage 2 OpenAI Live plan's group check did: `window.electronAPI = {}` and a `window.electron` whose `invoke(channel, data)` records the channel and resolves `undefined` — but `get-audio-status` `{}`, `supports-system-audio-capture` `false`, `list-system-audio-sources` `[]` — with `on` / `receive` / `send` / `removeAllListeners` no-ops. `Network.enable` records every request. For each provider the picker offers — Kizuna AI (signed out), Local Inference, Gemini, Doubao AST 2.0, OpenAI Realtime, OpenAI Translate, OpenAI Live, Soniox, Palabra AI — choose it, open Settings (its panel sits in React's `<Activity>`), and record the settings panel's `innerText` in the simple and the advanced layout, and a screenshot. **The texts are identical before and after, provider by provider, layout by layout**; the screenshots differ by nothing but the build's hash; neither run sends a request to a provider's host (no key is typed). Then the same on each without the desktop fake (the web preview): the same providers but OpenAI Live, identical texts. Record the paths for Task 12.
- [ ] **The gate's regex, trimmed** (choice 11), if no other work still runs the gate against a tree that has the old files: after Task 6 its alternative `services/(clients/(…)|providers/(…))\.ts|` names only deleted files. Remove it from `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh` (the new line is `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-plan/tools/oar-gate-new.sh`'s) and check the trimmed command prints the same 16 lines as this plan's baseline file.
- [ ] Stop both vites; record every number, grep and path for Task 12.

---

### Task 12: The spec's amendments and the roadmap's record (controller)

The controller's docs task, after the group check. It edits only the spec and the roadmap, and commits them together. Every anchor below is by heading and content; the line numbers, read at `fa301e9a`, are hints only — re-read each anchor before editing.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-client-contract-design.md`, `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`

- [ ] **Step 1: Amend the spec.** Each amendment is marked "(Stage 2 deletion, ruling / choice N)" in the text, as the earlier plans' are.
  1. **"Decisions" → "Deleted with no behaviour change"** (`:106-118`): append a paragraph — "**Landed** (Stage 2 deletion, rulings 1, 2): every client that carried these is deleted with its provider's old code; `IClient.ts` keeps only what Local Native's old client uses (`ConversationItem`, `BaseSessionConfig`, `LocalNativeSessionConfig`, `ResponseConfig`, `ClientEventHandlers`, `FilteredModel`, `IClient`) until kizuna-ai-lab/sokuji#578 retires it."
  2. **"Persisted settings that move"** (`:1831-1866`): in the table's "system instructions" row, replace "nothing moves, and the global copy stays for the providers not yet ported" with "nothing moves; the global copy is no longer written by anyone since the old store's instruction fields went (Stage 2 deletion, choice 5), and stays on disk as the legacy source". After the table, add: "**The old store's readers are deleted** (Stage 2 deletion, rulings 2, 3): every slice but Local Native's, with their migrations, which ran in memory only. No storage key is removed or rewritten; the keys each provider reads are the Stage 2 deletion plan's table. What only the old slices read stays on disk, unread (OpenAI's `transportType` and `temperature`, OpenAI Translate's `transcriptModel` and `transportType`, Palabra's `subscriberCount` and `publisherCanSubscribe`, Soniox's `model`, `settings.common.templateSystemInstructions`, and the three retired providers' slices)."
  3. **"What adding a provider then touches"** (`:1869-1896`): append — "The old path's five steps (a client implementing `IClient`, an `XProviderConfig`, its registration in `ProviderConfigFactory`, an enum value with a store slice, locale keys) are gone with it (Stage 2 deletion, ruling 7); `CLAUDE.md`'s \"Adding a New AI Provider\" states the list above. Local Native is the exception until #578."
  4. **"Migration", the old-code paragraph** (`:2468-2497`, "The old provider code stays until each port is live-tested"): append — "**Done** by the Stage 2 deletion plan (2026-09-30), after the owner's live tests, in one change rather than one per provider (rulings 2, C7): every provider's old code but Local Native's (ruling 1), the relay twins, OpenAI Compatible, `openai-realtime-api` and `evals/` (ruling 4), `livekit-client` and its pin, `WebRTCAudioBridge` (deleted by the Palabra task, the second to reach it), and LocalInference's old leftovers (ruling 3). The extension's AST2 header block went, its rule ids swept at start (ruling C3); the relay's CSP origins went (ruling 5); the per-provider release flags went (ruling 6)."
  5. **"Migration", item 10** (Local Native, `:2549-2562`): append — "Its old path is what the Stage 2 deletion kept whole (ruling 1): `LocalNativeClient`, `LocalNativeProviderConfig` alone in `ProviderConfigFactory`, the old settings shell reduced to its branches, the `localNative` slice, and the old store's `validateApiKey` arm `nativeModelStore` still runs."
  6. **"Migration", the relay twins' paragraph** (`:2564-2576`): append — "Both twins' old code is **deleted** by the Stage 2 deletion plan (Tasks 3 and 4); a stored selection of either still falls to Kizuna Soniox (`MANAGED_LEGACY_IDS`)."
  7. **"Risks"** (`:2711-2756`): add a bullet — "**The old path kept for Local Native** (Stage 2 deletion, ruling 1): `src/services/`, the unmounted settings shell and the `localNative` slice stay compiled and tested, working but unreachable but for `nativeModelStore`'s revalidation, until #578 ports Local Native; a change to a shared file must keep their tests green. The shell tolerates a stored provider its registry does not hold, and the old store's default stays an id that registry does not hold (Stage 2 deletion, choice 4)."
- [ ] **Step 2: Write the roadmap's section.** Append `## Scheduled by the Stage 2 deletion plan` after "Stage 2 without Local Native: what remains", in the earlier sections' form:
  - **What landed:** the plan's path and commits (the first version `bb39151e`, Revision 1), the commit range and its `+/−` lines and files (`git diff --shortstat` over it: the replay's is 291 files, +1 305 −52 566, 142 files deleted, 1 created), the waves as run, each task's review rounds, the pre-flight's self-test, the group check with its numbers (the suites, the builds, the D24 greps, the absent strings, the bundle sizes, the render comparison's paths).
  - **Departures, stated:** one deletion plan for every provider (ruling 2; ruling C7), where the roadmap scheduled one per provider; Local Native's old path kept whole (ruling 1); the shell reduced first (choice 1); `getRelayWsUrl` deleted and the `sokuji-auth.` redaction kept as a net (choice 6), where T2 left the choice open; the old AST2 rules swept by `sweepIds` rather than a separate start-up clear (ruling C3); `providerPath.test.ts`' `OPENAI_LIVE` row kept (ruling C1), where Live's inventory listed it; `providers.openaiCompatible.{name,description}` deleted (research note 7), `settings.{low,medium,high}` kept; the four client diagnostic codes no sender uses deleted from the contract's catalogue (ruling C17); `CONTEXT.md` rewritten with `CLAUDE.md` (ruling 9).
  - **The owner's follow-ups:**
    - delete the five repository variables (Settings → Secrets and variables → Actions → Variables on `kizuna-ai-lab/sokuji`), which no workflow reads now: `VITE_ENABLE_VOLCENGINE_AST2`, `VITE_ENABLE_PALABRA_AI`, `VITE_ENABLE_KIZUNA_SONIOX`, `VITE_ENABLE_KIZUNA_OPENAI_TRANSLATE`, `VITE_ENABLE_KIZUNA_VOLCENGINE_AST2`. `VITE_ENABLE_KIZUNA_AI`, `VITE_ENABLE_LOCAL_NATIVE` and `VITE_ENABLED_PROVIDERS` stay;
    - the 51 locale keys already unreferenced at `fa301e9a`, `settings.geminiParticipantTokenWarning` among them (the survey's §1.10): a follow-up, out of this plan (ruling C16);
    - the open question below.
  - **For the release that carries Stage 2** (ruling 10): `README.md`'s provider table (and its OpenAI Compatible row), `docs/*.html` and `docs/tutorials/*` (`docs/supported-ai-providers.html`, `docs/tutorials/cometapi-setup.html` and the rest that name the retired or deleted paths), `CHANGELOG.md`'s entry, and `.github/ISSUE_TEMPLATE/bug_report.yml`'s OpenAI Compatible block.
  - **Before any release from the branch:** nothing new — the deletion changes no behaviour a user reaches (the group check's render comparison).
  - **The roadmap's inheritance, item by item,** **what it leaves** and **the open question:** the three lists below, as landed.
- [ ] **Step 3: Mark every earlier section's deletion items in place**, each "**Done** by the Stage 2 deletion plan (Task N)" — or "**Changed** by …" / "**Left** by …" where it landed otherwise, with the reason — as the inheritance table below says: the Soniox section's "Deleting both providers' old code" (`:1752`) and "What that deletion must keep" (`:1753`); the Kizuna Soniox section's stated departure (`:2171`), its release-flag cleanup (`:2354-2357`), "The owner's paid live test … before Plan B2" (`:2358`), "Plan B2's inventory" (`:2406`) and "Plan B2 — deleting both Soniox providers' old code" (`:2500`); the Gemini section's "G2's inventory" (`:3061`) and "G2" (`:3121`); the Volcengine AST2 section's "V2's start-up clear of DNR rules 2000–2009" (`:3749`), "At Stage 2's end" (`:3755`), "V2's inventory" (`:3800`), the flag cleanup (`:3856`), "V2" (`:3864`) and "Generic frame names grouped under Doubao's Logs keys" (`:3872`, **Left**); the OpenAI Translate section's "At Stage 2's end" (`:4325`), "T2's inventory" (`:4386`), "T3's inventory" (`:4401`), the flag cleanup (`:4467`), "T2" and "T3" (`:4475-4476`); the OpenAI Realtime section's "The old code's deletion waits only for the two WebSocket live tests" (`:5103`), "The merged deletion inventory" (`:5259`) and "The merged deletion plan" (`:5357`); the Palabra section's `VITE_ENABLE_PALABRA_AI` item (`:6307`), "The deletion inventory" (`:6345`), its row naming the merged deletion (`:6428`) and "The Palabra deletion plan" (`:6445`); the session-end section's "The old clients' `session.closed`" (`:7584`); the OpenAI Live section's "The deletion inventory" (`:8006`) and "The old `OPENAI_LIVE_*` pair and the old code" (`:8177`); the last section's items 2 and 3 (`:8273-8282`).
- [ ] **Step 4: Commit.**

```bash
git add docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md
```

```bash
git commit -q -F - -- docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md <<'EOF'
docs(spec, roadmap): the old provider code deleted

The old code is gone but Local Native's path, kept whole until #578:
the spec's deleted-with-no-behaviour-change list, the persisted
settings, adding a provider, Migration and Risks say so. The roadmap
records the deletion, the owner's follow-ups (five repository
variables) and every earlier inventory it closes.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

## The roadmap's inheritance, item by item

Every deletion inventory the earlier sections hold, every "What it leaves" item that names the deletion, and the roadmap's last section: taken (and where), or left (and why). Line numbers are the roadmap's at `fa301e9a`.

| Item | Disposition |
|---|---|
| Soniox, "Deleting both providers' old code" after Plan B's paid live test (`:1752`) | **Done**: Task 6 (the clients, descriptors, `sonioxBothMode.ts`, `ManagedSonioxSession`, the slices' readers, the MainPanel chips, the stubs — eight by then), and the shell's Soniox branches in Task 1. |
| Soniox, "What that deletion must keep" (`:1753`) | **Kept**: every file it names is untouched but for the stubs' re-points (Task 6). |
| Kizuna Soniox, stated departure: "its old client, descriptor, helpers, settings UI and store slices stay compiled and unreachable until Plan B2" (`:2171`) | **Done**: Task 6 (the shell's branches in Task 1). |
| Kizuna Soniox, the release-flag cleanup at Stage 2's end (`:2354-2357`) | **Taken**: the five flags leave the code and CI (Tasks 3, 4, 6, 8; ruling 6); the repository variables are the owner's (Task 12). `VITE_ENABLE_KIZUNA_AI` stays. |
| Kizuna Soniox, "The owner's paid live test … before Plan B2" (`:2358`) | **Met**: 18 of 18 (the roadmap's last section). |
| Kizuna Soniox, "Plan B2's inventory" (`:2406-2498`) | **Taken whole**: Task 6 — re-points, then the clients, descriptors, helpers, split chips, stubs, `ClientOptions.sonioxManaged` and `IClient`'s Soniox config; the three shell tests in Task 1. Its typecheck note: the gate's old-client alternatives match nothing after Task 6 and are trimmed at the group check (choice 11). **Left:** `SonioxVoiceSection.test.tsx`'s seven full-tree lines (stale props, an unused `React`), which the re-point did not touch — not this plan's. |
| Kizuna Soniox, "Plan B2 — deleting both Soniox providers' old code" (`:2500`) | **Done**: Task 6; the bundle grep for a string only the old client carried is the group check's (`SonioxClient`, `ManagedSonioxSession`). |
| Gemini, "G2's inventory" (`:3061-3072`) | **Taken**: Task 5 (the shell's branches and `tutorialUrls.ts`' entry in Task 1); `@google/genai` stays (ruling C2); the stale comments go with their files or are corrected (`sanitizeEvent.ts`). **Left:** `settings.geminiParticipantTokenWarning`, unreferenced before this plan — a follow-up (ruling C16). |
| Gemini, "G2" (`:3121`) | **Done**: Task 5. |
| Volcengine AST2, "V2's start-up clear of DNR rules 2000–2009" (`:3749-3754`) | **Taken**, shaped by ruling C3: `sweepIds` takes the range at `onStartup` / `onInstalled` (Task 4). |
| Volcengine AST2, "At Stage 2's end" (`:3755-3757`) and the flag cleanup (`:3856`) | **Taken**: Task 4. |
| Volcengine AST2, "V2's inventory" (`:3800-3814`) | **Taken whole**: Task 4 (the shell's branches, `KIZUNA_HOSTED_ICONS` and `TUTORIAL_URLS`' entry in Task 1). Its "keep" list: `LEGACY_SLICE_KEYS` and `MANAGED_LEGACY_IDS` kept; `getRelayWsUrl` kept only while the OpenAI Translate twin used it — Task 3 deleted that twin first, so it goes here; the `sokuji-auth.` rule kept as a net (choice 6); `electron/main.js`' `ws-headers-set` / `ws-headers-clear` kept. |
| Volcengine AST2, "V2" (`:3864`) | **Done**: Task 4. |
| Volcengine AST2, "Generic frame names grouped under Doubao's Logs keys" (`:3872`), which names V2 as a natural moment to narrow Doubao's rows | **Left**: the grouping stays. The new adapter (`volcengine_ast2/adapter.ts`) is the only emitter of those names today (checked), so the rows are Doubao's alone; narrowing them is a Logs change, not this deletion's. Task 4 removes only the old client's names. |
| OpenAI Translate, "At Stage 2's end" (`:4325`) and the flag cleanup (`:4467`) | **Taken**: Task 3. |
| OpenAI Translate, "T2's inventory" (`:4386-4399`) | **Taken whole**: Task 3 (`KIZUNA_HOSTED_ICONS`' entry and the shell's twin branches in Task 1). "Once both twins are gone: `getRelayWsUrl` … delete, or keep the rule as a net": `getRelayWsUrl` deleted (Task 4), the rule kept (choice 6). |
| OpenAI Translate, "T3's inventory" (`:4401-4413`) | **Taken** in the merged deletion, Task 7; its orphan keys: `settings.translateModelAvailable` (Task 7), `settings.translateSourceParticipantWarning` (Task 1); `settings.userTranscriptModel` / `settings.transcriptModelTooltip` kept (OpenAI Realtime reads them). |
| OpenAI Translate, "T2" and "T3" (`:4475-4476`) | **Done**: Tasks 3 and 7. |
| OpenAI Realtime, "The old code's deletion waits only for the two WebSocket live tests" (`:5103-5107`) and "The owner's live test below, before the merged deletion" (`:5189`) | **Met** by the owner's ruling 2, given after his live tests (2026-09-30): OpenAI Realtime 25 of 25; the checklist snapshot the last section quotes (`:8264-8271`) was taken earlier that day. |
| OpenAI Realtime, "The merged deletion inventory" (`:5259-5279`) | **Taken whole**: Task 7 (the shell's branches and `tutorialUrls.ts`' Compatible entry in Task 1; `providers.openaiCompatible.customEndpointPlaceholder` in Task 1, its name and description in Task 7). The diagnostics' comments that cite `EphemeralTokenService.ts` lines as their example (`describeCause.ts:24`, `report.ts:45`, `redact.ts:67` and three tests) **keep** the citation: it names where the rule came from (choice 3). |
| OpenAI Realtime, "The merged deletion plan" (`:5357`) | **Done**: Task 7. |
| Palabra, "`VITE_ENABLE_PALABRA_AI` … goes with the old code" (`:6307`) | **Taken**: Task 8. |
| Palabra, "The deletion inventory" (`:6345-6356`) | **Taken whole**: Task 8 (the shell's branches, the credentials block and its styles, and `tutorialUrls.ts`' entry in Task 1); `WebRTCAudioBridge` and the worklet copy here, the second deletion to reach them (research note 8); its "keep" list kept. |
| Palabra, the merged OpenAI deletion's coordination (`:6428`) and "The Palabra deletion plan" (`:6445`) | **Done**: Tasks 7 and 8, in that order. |
| Session end, "The old clients' `session.closed` no longer draws a separator … go with the deletion plan" (`:7584-7586`) | **Done**: the clients are deleted (Tasks 2–9). |
| OpenAI Live, "The deletion inventory" (`:8006-8027`) | **Taken**: Task 2 (the shell's branches in Task 1), with one **departure**: `providerPath.test.ts`' `OPENAI_LIVE` row stays (ruling C1) — it pins the live id's path, not the old code. Its "Kept" list kept: `main.js`' pair, the sweep of 4000, `live.mts`, the enum value. |
| OpenAI Live, "The old `OPENAI_LIVE_*` pair and the old code stay until the deletion plan" (`:8177`) | **Done**: Task 2. |
| "Stage 2 without Local Native", what it means for Local Native until #578 (`:8257-8261`) | **Kept**: ruling 1; every task's gate runs its tests. |
| "Stage 2 without Local Native", item 1, the owner's live tests (`:8263-8271`) | Not this plan's: the owner released the deletion after his tests (ruling 2). |
| "Stage 2 without Local Native", item 2, one deletion plan per provider (`:8273-8278`) | **Changed**: one plan, a task per group (ruling 2; ruling C7). Each task re-checked that nothing of Local Native's goes. |
| "Stage 2 without Local Native", item 3, the release flags (`:8279-8282`) | **Taken**: Tasks 3, 4, 6, 8; the variables are the owner's. |
| "Left for after the merge" (`:8284-8285`) | Not this plan's. |

## What this plan leaves

- **Local Native's old path**, compiled, tested and unreachable but for `nativeModelStore`'s revalidation, until kizuna-ai-lab/sokuji#578 ports it (ruling 1): `src/services/{clients,providers,interfaces}/`' survivors, the unmounted shell, the `localNative` slice, `settingsStore.validateApiKey`'s arm. #578 deletes them; its port also makes `descriptorRegistry.test.ts` (whose tables now hold Local Native alone), `participantConfig.test.ts` and `prepareToStart.local.test.ts` go.
- **Comments in the keep set** that name the deleted code (choice 3; ruling 1 keeps those files unedited): e.g. `punctuateDefinite.ts`' header and `LocalNativeProviderConfig.ts`' notes on the other descriptors. And provenance citations in new code — `volcengine_ast2/settings.ts` citing `VolcengineAST2ProviderConfig.ts:8-31` — which name history at `fa301e9a`.
- **Readers of old state that is now always its reset value**, harmless: `useStartBasicsTour` reads `settingsStore.isApiKeyValid`, which only Local Native's arm sets (as at `fa301e9a`, where only the unmounted shell called the others); `useCreateSessionConfig` has no caller.
- **The released app's descriptions, for the release that carries Stage 2** (ruling 10; choice 12): `README.md`, `docs/*.html`, `docs/tutorials/*`, `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/bug_report.yml`' OpenAI Compatible block — Task 12 lists them; and `.gitignore`'s `/palabra-probe/` entry (the owner's local harness for the deleted LiveKit client, never committed).
- **`CLAUDE.md` outside the passages Task 11 rewrites:** its "Audio Handling" and "Modifying Audio Pipeline" guidance beyond the class names, the passthrough line and the `modern-audio` line (Revision 2 corrected those), and the "virtual audio device management (Linux only)" statements under "Dual Platform Architecture" and "Platform Requirements", were not audited here.
- **The diagnostics design's table** (`docs/superpowers/specs/2026-08-25-diagnostics-reporting-design.md:109-115`) still lists the four deleted codes: a record of #441 as designed, not a statement of the code.
- **Values on disk** no reader reads (the table under "Stored keys"): nothing deletes a stored value (the owner's rule).
- **51 locale keys unreferenced before this plan**, `settings.geminiParticipantTokenWarning` among them — a follow-up (ruling C16).
- **`SonioxVoiceSection.test.tsx`' seven full-tree lines**, untouched (the inheritance table).

## Open questions for the owner

None. The first version's four are ruled (Revision 1: rulings C16, 9, 10, C17), and Revision 2's one — `CONTEXT.md`'s native model resolution entries — by the owner's ruling 11 (Revision 3, Task 11).

## Self-review

- **The brief, item by item.** Rulings 1–10: 1 in every task (keep set read only, its gate), 2 in Tasks 2–8, 3 in Task 9, 4 in Task 7, 5 in Task 4, 6 in Tasks 3, 4, 6, 8 (and Task 12's variables), 7 in Task 11, 8 by no task touching `src/providers/fake/` and the D24 greps, 9 in Task 11, 10 in Task 12's release list. C1 in Tasks 3, 4, 7 (the `OPENAI_LIVE` row and the cast strings kept); C2 in Task 5 (a no-op move, research note 2); C3 in Task 4; C4 in Tasks 1 and 10 (choice 4, research note 1); C5 in Task 2; C6 in Task 1; C7 is the task list. The constraints: no migration code (Global Constraints; the stored-keys table); nothing reachable changes (the import guard in the suite, the builds, the absent strings and the render comparison); comments cite rulings and choices only (the blocks were checked: every "(Stage 2 deletion, …)" citation names a ruling or a choice, and none a task, a review or the survey); every count measured by the replay (below); the group check's items and Task 12's are each a step.
- **The inheritance:** every deletion inventory and "What it leaves" item naming the deletion has a row — Revision 1 adds `:1752`, `:2171` and `:3872` — and the last section's four items too.
- **The replay.** A fresh `git archive fa301e9a` with `node_modules` and `extension/node_modules` linked; for each task, its `git rm` list, `plan-apply.py` on this document's blocks for it, and its key command — then the tree compared file by file with the scratch history's (identical after all eleven tasks, every hunk at its header's line), then every gate, and `tscdiff.py` against the task before (`new 0` after every task). The counts in each task are that replay's. The builds and the bundle numbers were measured on a copy of `fa301e9a` and on the replay's result.
- **Revision 1, finding by finding** (the review's, and the controller's rulings on them): I1 → ruling C8: the applier's hashes and occurrences, the pre-flight's file check, and the self-test (11 of 11 cases, the review's two mutants refusing: `run-edited`, `dup-unnamed`); M1, N4 → ruling C9, Tasks 2, 6, 8, 9, 10, 11, each task's check step grepping the old words; M2 → ruling C10, three rows and Task 12's list; M3 → ruling C11, Task 10's guard, which fails on the review's dynamic-import mutant and on a side-effect import (measured, then reverted); M4, N2 → ruling C12, Task 11 (with the false statements found beside them); M5 → ruling C13, the set gate in every task; M6 → rulings 10, C14, Task 12; N1, N3, N5 → ruling C15, Task 4, the key tool (its self-test cases `key-namespace`, `key-leaf`), the plan's own baseline file; open questions → rulings C16, 9, 10, C17 (Tasks 12, 11, 12, 10).
- **Counts Revision 1 changed:** Task 2's shortstat (+49 −3 920), Task 6's (109 files, +117 −13 130), Task 8's (+21 −3 660), Task 9's (61 files, +223 −4 397), Task 10's (46 files, +179 −628, one file created, 5 keys) and Task 11's (11 files, +141 −116); the total (290 files, +1 296 −52 550; 44 keys); Task 10's and Task 11's suites (532 + 1 files and 6 656 + 2 tests: the guard's file and its three tests); the applier's per-task file counts (`t06` 35, `t09` 25, `t10` 15, `t11` 11). Unchanged: every other suite count, Local Native's, the gate's lines, and the full tree's count (95 at the end) — no task adds a tsc error, by the set gate.
- **Placeholders:** none; every edit is in a block, every deletion in a `git rm` list, every key in a command.
- **Names across tasks:** `OLD_AST2_RULE_ID_MIN` / `_MAX` (Task 4) are what `wsHeaderRule.test.ts` imports; `useWasmEngineAdapter(isSessionActive, override)` and the two components' props (Task 9) are what their tests and mounts pass; `validateApiKey()`'s signature narrows in Task 6 (`isSignedIn` gone) and Task 10 (`getAuthToken` gone), and each task's blocks update its callers; the gate baseline file changes in Tasks 1 and 10 only.
- **Revision 2, nit by nit** (the re-check's, ruled in by the controller): R1 → Task 1's `sessionStore.ts` hunk (the header, and `isInitializing` / `setIsInitializing` / `useSessionIsInitializing`, unread after Task 1 — checked: the only `isInitializing` left is `SubtitleBar`'s own `sessionControl` field, another thing), its check step grepping the removed names; R2 → Task 10's guard, `OLD_PATH` `src/services/(clients|providers|interfaces)/` with `ISettingsService` shared, failing on the re-check's `isLocalNativeSessionConfig` import into `loadStores.ts` (measured, reverted); R3 → Task 11's two `CLAUDE.md` lines. The tools are unchanged; their self-test still passes 11 of 11.
- **Counts Revision 2 changed:** Task 1's shortstat (58 files, +542 −5 344; `t01` 18 files changed), Task 10's (46 files, +181 −628) and Task 11's (11 files, +143 −118); the total (291 files, +1 305 −52 566). Every suite count, Local Native's, the gate's lines, the typecheck sets (`new 0` after every task) and the full tree's count are unchanged.
- **Revision 3** (ruling 11): Task 11's `CONTEXT.md` block gains the three native model resolution entries; nothing else in Tasks 1–12 moves (Tasks 1–10's blocks byte-identical to Revision 2's). Replayed: a fresh `fa301e9a` copy taken through Tasks 1–10 by their blocks (each tree identical to the scratch history's), then Task 11 applied from this document (`t11: 11 files changed`, the tree identical), its gates run and its typecheck set compared with Task 10's. The tools are unchanged; the self-test still passes 11 of 11.
- **Counts Revision 3 changed:** Task 11's shortstat (11 files, +146 −121) and the total (291 files, +1 308 −52 569). Task 11's suites, Local Native's, the gate's 16 lines, the typecheck set (`new 0`) and the full tree's count are unchanged.
- **Choices,** each with where it lands: 1 (Task 1), 2 (the order), 3 (every task's comment hunks), 4 (Tasks 1, 10), 5 (Tasks 6, 7, 10), 6 (Task 7), 7 (Task 4), 8 (Task 7), 9 (every task's test hunks), 10 (every key command), 11 (the group check), 12 (What this plan leaves; Task 12's release list).

## Appendix: the plan's four tools

Write each to `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/` if it is missing (Global Constraints). All four are outside the repository.

`plan-apply.py`:

```python
#!/usr/bin/env python3
"""Apply one task's diffs from the Stage 2 deletion plan.

Usage: python3 plan-apply.py <plan.md> <tag> [--check]

Takes every block fenced as `````diff <tag> (five backticks) from the plan,
in order, and applies it to the working tree (the current directory). A
block is a unified diff, one or more files: `diff --git a/P b/P`, then
`--- a/P` (or `--- /dev/null` with `new file mode`, for a file to create),
`+++ b/P` and the hunks. Two additions to the format:

- `~ N more removed lines sha256:H` stands for N removed lines the plan does
  not print; H is the first 12 hex digits of the SHA-256 of those lines
  joined by newlines. They are removed only if they hash to H.
- A hunk header may end `occurrence K of N`: the hunk's old side (context,
  removed lines, hashed runs) occurs N times in the file as it stands, and
  the hunk applies to the K-th. Without it, the old side must occur exactly
  once.

Every hunk's old side is matched against the whole file, byte for byte, the
hashed runs included; the header's line number is only reported against.
Nothing is written unless every hunk of every file matches; a file to create
must not exist. --check applies nothing and reports what would change.
"""
import hashlib
import os
import re
import sys

FENCE_OPEN = re.compile(r'^`````diff (\S+)\s*$')
FENCE_CLOSE = '`````'
HUNK = re.compile(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: occurrence (\d+) of (\d+))?$')
SKIP = re.compile(r'^~ (\d+) more removed lines sha256:([0-9a-f]{12})$')


def run_hash(lines):
    return hashlib.sha256('\n'.join(lines).encode('utf-8')).hexdigest()[:12]


def blocks(plan, tag):
    out, cur = [], None
    for line in open(plan, encoding='utf-8').read().split('\n'):
        if cur is None:
            m = FENCE_OPEN.match(line)
            if m and m.group(1) == tag:
                cur = []
        elif line == FENCE_CLOSE:
            out.append(cur)
            cur = None
        else:
            cur.append(line)
    if cur is not None:
        sys.exit(f'{plan}: an unclosed diff block for {tag}')
    return out


def parse(lines):
    files, f, h = [], None, None
    for line in lines:
        if line.startswith('diff --git '):
            m = re.match(r'^diff --git a/(.*) b/(.*)$', line)
            f = {'path': m.group(2), 'hunks': [], 'eol': None, 'new': False}
            files.append(f)
            h = None
        elif h is None and line.startswith('new file mode'):
            f['new'] = True
        elif h is None and line == '--- /dev/null':
            f['new'] = True
        elif h is None and (line.startswith('--- ') or line.startswith('+++ ')):
            continue
        elif line.startswith('@@'):
            m = HUNK.match(line)
            if not m:
                sys.exit(f'unreadable hunk header: {line!r}')
            occ = (int(m.group(5)), int(m.group(6))) if m.group(5) else None
            h = {'at': int(m.group(1)), 'occ': occ, 'items': []}
            f['hunks'].append(h)
        elif line == '\\ No newline at end of file':
            last = h['items'][-1][0]
            if last in ('+', ' '):
                f['eol'] = False
            elif f['eol'] is None:
                f['eol'] = True
        elif SKIP.match(line):
            m = SKIP.match(line)
            h['items'].append(('~', (int(m.group(1)), m.group(2))))
        elif line[:1] in (' ', '-', '+'):
            h['items'].append((line[0], line[1:]))
        elif line == '':
            h['items'].append((' ', ''))
        else:
            sys.exit(f'unreadable diff line: {line!r}')
    return files


def matches(old, pos, items):
    """The old side of `items` read at `pos`, hashed runs included: its length, or None."""
    i = pos
    for kind, val in items:
        if kind == '+':
            continue
        if kind == '~':
            n, digest = val
            if i + n > len(old) or run_hash(old[i:i + n]) != digest:
                return None
            i += n
            continue
        if i >= len(old) or old[i] != val:
            return None
        i += 1
    return i - pos


def apply_file(text, f):
    old = text.split('\n')
    had_eol = text.endswith('\n')
    if had_eol:
        old.pop()
    out, pos, notes = [], 0, []
    for h in f['hunks']:
        found = [p for p in range(0, len(old) + 1) if matches(old, p, h['items']) is not None]
        if not found:
            sys.exit(f"{f['path']}: the hunk at line {h['at']} matches nowhere (a line, or a shortened run's hash, differs)")
        if h['occ'] is None:
            if len(found) != 1:
                sys.exit(f"{f['path']}: the hunk at line {h['at']} matches {len(found)} places, and names no occurrence")
            at = found[0]
        else:
            k, n = h['occ']
            if len(found) != n:
                sys.exit(f"{f['path']}: the hunk at line {h['at']} is occurrence {k} of {n}, but matches {len(found)} places")
            at = found[k - 1]
        if at < pos:
            sys.exit(f"{f['path']}: the hunk at line {h['at']} matches before the hunk above it")
        if at != h['at'] - 1:
            notes.append(f"{f['path']}: hunk at {h['at']} applied at {at + 1}")
        out.extend(old[pos:at])
        i = at
        for kind, val in h['items']:
            if kind == ' ':
                out.append(old[i]); i += 1
            elif kind == '-':
                i += 1
            elif kind == '~':
                i += val[0]
            else:
                out.append(val)
        pos = i
    out.extend(old[pos:])
    new = '\n'.join(out)
    eol = had_eol if f['eol'] is None else f['eol']
    if out and eol:
        new += '\n'
    return new, notes


def create_file(f):
    lines = []
    for h in f['hunks']:
        for kind, val in h['items']:
            if kind != '+':
                sys.exit(f"{f['path']}: a file to create has a line that is not an addition")
            lines.append(val)
    text = '\n'.join(lines)
    if lines and f['eol'] is not False:
        text += '\n'
    return text


def main():
    args = [a for a in sys.argv[1:] if a != '--check']
    check = '--check' in sys.argv[1:]
    if len(args) != 2:
        sys.exit(__doc__)
    plan, tag = args
    found = blocks(plan, tag)
    if not found:
        sys.exit(f'no diff block tagged {tag}')
    files = parse([l for b in found for l in b])
    paths = [f['path'] for f in files]
    if len(set(paths)) != len(paths):
        sys.exit(f'{tag}: a file is named twice')
    results = []
    for f in files:
        if f['new']:
            if os.path.exists(f['path']):
                sys.exit(f"{f['path']}: a file to create already exists")
            results.append((f['path'], create_file(f), []))
            continue
        try:
            text = open(f['path'], encoding='utf-8').read()
        except FileNotFoundError:
            sys.exit(f"{f['path']}: no such file")
        new, notes = apply_file(text, f)
        results.append((f['path'], new, notes))
    for path, new, notes in results:
        for n in notes:
            print(n)
        if not check:
            d = os.path.dirname(path)
            if d:
                os.makedirs(d, exist_ok=True)
            open(path, 'w', encoding='utf-8').write(new)
    print(f"{tag}: {len(results)} files {'would change' if check else 'changed'}")


main()
```

`drop-locale-keys.mjs`:

```javascript
// Removes the named dotted keys from every catalog under src/locales/*/translation.json,
// and any object a removal leaves empty. Each catalog is written back as
// JSON.stringify(…, null, 2) plus a newline, the form every catalog is in.
// Refuses (exit 1, nothing written) if a key is missing from any catalog, or
// names a namespace rather than a string: only leaves are removed.
// Usage: node drop-locale-keys.mjs <repo root> <key> [<key> …]
import fs from 'node:fs';
import path from 'node:path';

const [root, ...keys] = process.argv.slice(2);
const dir = path.join(root, 'src/locales');
const catalogs = fs.readdirSync(dir)
  .map((loc) => path.join(dir, loc, 'translation.json'))
  .filter((f) => fs.existsSync(f))
  .sort();

// 'ok', 'missing' or 'not-a-leaf'.
const drop = (obj, parts) => {
  const [head, ...rest] = parts;
  if (obj === null || typeof obj !== 'object' || !(head in obj)) return 'missing';
  if (rest.length === 0) {
    if (typeof obj[head] !== 'string') return 'not-a-leaf';
    delete obj[head];
    return 'ok';
  }
  const child = obj[head];
  const result = drop(child, rest);
  if (result === 'ok' && Object.keys(child).length === 0) delete obj[head];
  return result;
};

const out = [];
for (const file of catalogs) {
  const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of keys) {
    const result = drop(cat, key.split('.'));
    if (result !== 'ok') {
      console.error(`${path.relative(root, file)}: ${result === 'missing' ? 'no key' : 'not a string leaf:'} ${key}`);
      process.exit(1);
    }
  }
  out.push([file, JSON.stringify(cat, null, 2) + '\n']);
}
for (const [file, text] of out) fs.writeFileSync(file, text);
console.log(`${keys.length} keys removed from ${out.length} catalogs`);
```

`tscdiff.py`:

```python
#!/usr/bin/env python3
"""The tsc errors in <after> that <before> does not have.

Usage: python3 tscdiff.py <before.txt> <after.txt>

Each file is `npx tsc --noEmit -p tsconfig.json` output. An error is its file,
its code and the first 60 characters of its message, the position dropped (a
deletion moves lines, and a message's tail can name a type the deletion
narrowed); errors are counted as a multiset, so a second instance of a known
error is new. Prints `before B after A; new N; gone G`, then one `NEW` line
per new error. Exit status 1 when N > 0.
"""
import collections
import re
import sys

LINE = re.compile(r'^(\S+?)\(\d+,\d+\): error (TS\d+): (.*)$')


def load(path):
    errors = collections.Counter()
    for line in open(path, encoding='utf-8', errors='replace'):
        m = LINE.match(line.rstrip('\n'))
        if m:
            errors[(m.group(1), m.group(2), m.group(3)[:60])] += 1
    return errors


if len(sys.argv) != 3:
    sys.exit(__doc__)
before, after = load(sys.argv[1]), load(sys.argv[2])
new, gone = after - before, before - after
print(f'before {sum(before.values())} after {sum(after.values())}; new {sum(new.values())}; gone {sum(gone.values())}')
for (file, code, message), n in sorted(new.items()):
    print('NEW', n, file, code, message)
sys.exit(1 if new else 0)
```

`selftest.py`:

```python
#!/usr/bin/env python3
"""The plan's tools, tested against the cases that must refuse.

Usage: python3 selftest.py <scratch dir>

Builds throwaway files in <scratch dir> (created, emptied first; never the
repository), runs plan-apply.py and drop-locale-keys.mjs on them, and prints
one line per case. Exit status 1 if any case does not behave as stated. The
first two refusal cases are the review's mutants: an edit inside a shortened
run, and a duplicated anchor that moved.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
root = os.path.abspath(sys.argv[1])
shutil.rmtree(root, ignore_errors=True)
os.makedirs(root)
results = []


def h(lines):
    return hashlib.sha256('\n'.join(lines).encode()).hexdigest()[:12]


def write(rel, text):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w').write(text)


def read(rel):
    return open(os.path.join(root, rel)).read()


def plan(name, body):
    write(f'{name}.md', f'`````diff {name}\n{body}\n`````\n')
    return os.path.join(root, f'{name}.md')


def apply(name, body):
    p = plan(name, body)
    r = subprocess.run([sys.executable, os.path.join(TOOLS, 'plan-apply.py'), p, name], cwd=root, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


def case(name, ok, detail):
    results.append(ok)
    print(f"{'ok  ' if ok else 'FAIL'} {name}: {detail}")


# A 40-line file; the block removes lines 10-25, printed as three, a hashed run of eleven, two.
lines = [f'line {i}' for i in range(1, 41)]
text = '\n'.join(lines) + '\n'
run = lines[12:23]
m1 = '\n'.join([
    'diff --git a/run.txt b/run.txt', '--- a/run.txt', '+++ b/run.txt',
    '@@ -7,22 +7,6 @@',
    ' line 7', ' line 8', ' line 9',
    '-line 10', '-line 11', '-line 12',
    f'~ 11 more removed lines sha256:{h(run)}',
    '-line 24', '-line 25',
    ' line 26', ' line 27', ' line 28',
])

write('run.txt', text)
rc, out = apply('m1', m1)
after = read('run.txt')
case('run-intact', rc == 0 and 'line 15\n' not in after and 'line 9\nline 26\n' in after, 'a shortened run whose lines hash as printed is removed')

write('run.txt', text.replace('line 15\n', 'line 15 IMPORTANT EDIT\n'))
rc, out = apply('m1', m1)
case('run-edited', rc != 0 and 'IMPORTANT EDIT' in read('run.txt') and 'matches nowhere' in out,
     f'an edited line inside the run, the count kept, refuses and writes nothing ({out.splitlines()[-1]})')

write('run.txt', text.replace('line 15\n', 'line 15\nline 15b\n'))
rc, out = apply('m1', m1)
case('run-grown', rc != 0 and 'line 15b' in read('run.txt'), 'a line inserted into the run refuses')

# A four-line snippet twice; the hunk is written for the second copy.
snippet = ['function f() {', '  return 1;', '}', '']
dup = ['// head'] * 3 + snippet + ['// middle'] * 5 + snippet + ['// tail'] * 3
dup_text = '\n'.join(dup) + '\n'
second = 3 + len(snippet) + 5 + 1  # 1-based line of the second copy
m2_body = [
    'diff --git a/dup.txt b/dup.txt', '--- a/dup.txt', '+++ b/dup.txt',
    '{header}',
    ' function f() {', '-  return 1;', '+  return 2;', ' }', ' ',
]
unnamed = '\n'.join(m2_body).replace('{header}', f'@@ -{second},4 +{second},4 @@')
named = '\n'.join(m2_body).replace('{header}', f'@@ -{second},4 +{second},4 @@ occurrence 2 of 2')
moved = '\n'.join(['// inserted'] * 15 + dup) + '\n'

write('dup.txt', moved)
rc, out = apply('m2', unnamed)
case('dup-unnamed', rc != 0 and read('dup.txt') == moved and 'names no occurrence' in out,
     f'a duplicated anchor that moved, with no occurrence named, refuses ({out.splitlines()[-1]})')

write('dup.txt', moved)
rc, out = apply('m2', named)
got = read('dup.txt').split('\n')
first_at = got.index('function f() {')
second_at = got.index('function f() {', first_at + 1)
case('dup-named', rc == 0 and got[first_at + 1] == '  return 1;' and got[second_at + 1] == '  return 2;' and 'applied at' in out,
     'the same hunk naming "occurrence 2 of 2" edits the second copy, and says it moved')

write('dup.txt', moved + '\n'.join(snippet) + '\n')
rc, out = apply('m2', named)
case('dup-third-copy', rc != 0 and 'return 2' not in read('dup.txt'), 'a third copy makes "occurrence 2 of 2" refuse')

# A file to create must not exist.
create = '\n'.join(['diff --git a/new.txt b/new.txt', 'new file mode 100644', '--- /dev/null', '+++ b/new.txt', '@@ -0,0 +1,2 @@', '+one', '+two'])
rc, out = apply('m3', create)
case('create', rc == 0 and read('new.txt') == 'one\ntwo\n', 'a new file is created from its additions')
rc, out = apply('m3', create)
case('create-exists', rc != 0, 'creating a file that exists refuses')

# All or nothing: the second file fails, the first is not written.
write('a.txt', 'alpha\nbeta\ngamma\n')
write('b.txt', 'one\ntwo\nthree\n')
both = '\n'.join([
    'diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1,3 +1,3 @@', ' alpha', '-beta', '+BETA', ' gamma',
    'diff --git a/b.txt b/b.txt', '--- a/b.txt', '+++ b/b.txt', '@@ -1,3 +1,3 @@', ' one', '-TWO', '+2', ' three',
])
rc, out = apply('m4', both)
case('all-or-nothing', rc != 0 and read('a.txt') == 'alpha\nbeta\ngamma\n', 'a failing second file leaves the first unwritten')

# The key tool: a namespace is refused, a leaf is removed.
catalog = {'x': {'a': 'A', 'b': 'B'}, 'y': 'Y'}
for loc in ('en', 'ja'):
    write(f'src/locales/{loc}/translation.json', json.dumps(catalog, indent=2) + '\n')
r = subprocess.run(['node', os.path.join(TOOLS, 'drop-locale-keys.mjs'), root, 'x'], capture_output=True, text=True)
case('key-namespace', r.returncode != 0 and json.loads(read('src/locales/en/translation.json')) == catalog,
     f'a namespace key refuses and writes nothing ({r.stderr.strip()})')
r = subprocess.run(['node', os.path.join(TOOLS, 'drop-locale-keys.mjs'), root, 'x.a'], capture_output=True, text=True)
case('key-leaf', r.returncode == 0 and json.loads(read('src/locales/ja/translation.json')) == {'x': {'b': 'B'}, 'y': 'Y'},
     'a leaf is removed from every catalog')

print(f'selftest: {sum(results)} of {len(results)} passed')
sys.exit(0 if all(results) else 1)
```
