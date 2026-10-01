# Client contract — Stage 1e-3c: delete the transitional code

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the code the migration left behind that no longer has a job: the old subtitle cluster the new surfaces replaced, the legacy export adapter, the old session store's dead half and the old start gate, the old MainPanel's orchestration helpers, and the old audio service whose players sit idle beside the new graph (after moving the device enumeration it still does into a small module of its own). About −13,400 lines, no behaviour change.

**What this plan does not delete** — the owner's rulings of 2026-09-26, which narrowed 1e-3c from the roadmap's list:
- **Every old provider stays**, as the source Stage 2 ports each provider from: the clients (`src/services/clients/**`), the descriptors (`src/services/providers/**`, incl. `speechMode.ts`), the old per-provider settings UI (`ProviderSpecificSettings.tsx`, `SonioxVoiceSection.tsx`, the LocalNative sections, …), the old generic settings surfaces that carry provider-specific UI (`ProviderSection.tsx`, `LanguageSection.tsx`, `PoweredBy.tsx`, `EngineStatusLine.tsx` — controller ruling 1), the `settingsStore` provider slices, the Provider enum, the SetupWizard, `ProviderIcons.tsx`, the managed-Soniox MainPanel chips (`SessionCountdown`, `SplitDegradedChip`, `splitDegraded.ts` — controller ruling 4), `extension/background/background.js`'s per-provider header blocks, `WebRTCAudioBridge.ts` and `pcm-audio-worklet-processor.js`. Each provider's old code is deleted by the Stage 2 plan that ports it, after the owner's live test. This reverses the spec's D11 ("old clients are deleted and read from git history"); the Stage 2 foundation plan amends the spec.
- **The fake provider and everything serving it stay** (D24; owner confirmed): `src/providers/fake/**`, `src/components/dev/**`, `ProviderPanel.tsx`, the probes' model-free modes, their tests.
- **Pre-existing orphans are out of scope** (not transitional): `Auth/AuthGuard.*`, `Auth/SignInPage.scss`, `lib/auth/guards.tsx`, `ConnectionStatus/*`, `UpdateSection.*`, `engine/resolutionNotes.ts`, `supertonicSidReconciliation.ts`, `utils/clampToScreen.ts`, `NativeTtsProto`'s static import (controller ruling 5).

**Architecture:** Pure deletion in dependency order, each task leaving the tree typechecking, the suite green and both production builds building. The one behaviour-bearing move is the device enumeration (Task 5): `getDevices` (with its microphone-permission warm-up and permission toast) and `getSystemAudioSources` leave `ModernBrowserAudioService` for plain functions in `src/lib/audio/devices.ts`, which `audioStore.refreshDevices` calls; only then does Task 6 delete the service, its player and its worklet.

**Tech Stack:** TypeScript (strict), React 19, zustand, Vitest + @testing-library/react, Vite (app and extension builds), headless Chromium over the DevTools protocol for the controller's probes.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — "Migration" (the subtitle surfaces rewritten in Stage 1, `sessionPortMirror` gone, the typed wire), "Audio" / "Playback" (one graph; the routing table replaces the old player's volume-as-control), "Testing". The roadmap (`docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`) lists what each plan left for 1e-3c: "Scheduled by plan 1e-3b-1" → **1e-3c**, "Scheduled by plan 1e-3b-2" → **1e-3c**, "Scheduled by plan 1e-4" → **1e-3c**. **The survey this plan is written from**, `1e3c-survey.md` in this plan's SDD workspace (copied from the controller's notes at setup; cited *survey §x / Hn / Tn*), holds the real module graph of all four builds (PROD / DEV / DEAD / TYPEREF per file), the file:line inventories, and the baselines. Where this plan and the survey disagree, this plan wins; where this plan is silent, the survey's file:line lists are the checklist.

## Controller rulings (binding; cited *controller ruling N*)

1. **D1 — the old generic Settings surfaces stay** (`ProviderSection.tsx`, `LanguageSection.tsx`, `PoweredBy.tsx`, `EngineStatusLine.tsx` and their tests). They are unreachable at run time, but their provider-specific markup — the managed sign-in / "authenticated via your account" row, Palabra's credential-mode toggle, the "Recommended" tag, Soniox's region row, the pre-start pair warnings — is what the Stage 2 foundation survey cites as the source for the pieces Stage 2 rebuilds. They go when Stage 2 no longer needs them. Only `ProviderPicker.tsx:13-19`'s now-false "plan 1e-3c deletes ProviderSection" comment is fixed (Task 7).
2. **D2 — `sessionStore` is trimmed, not deleted** (survey H3 option C1): it keeps `lockedMode` and `isInitializing` with their two hooks, the only things the kept old UI reads; nothing writes it. `sessionStartGate.ts` goes.
3. **D3 — device enumeration moves to a new `src/lib/audio/devices.ts`** of plain functions (survey H1 option (i)); `IAudioService`'s forty-method contract is not kept for the two methods still used.
4. **D4 — the managed-Soniox MainPanel chips stay** as old-provider UI for the Kizuna Soniox port.
5. **D5 — pre-existing orphans are out of scope.**
6. **D6 — the release and overlay bundles keep carrying the old clients** (734 KB unminified, preloaded by the extension's overlay page through `SubtitleBar` → `settingsStore` → `ProviderConfigFactory`). Accepted under the keep ruling; recorded in the roadmap (Task 8) for Stage 2, which removes it as providers port. Task 6 takes out the old audio service's 93 KB.

## Global Constraints

- **Read-only** in every task unless the task names the file: `src/services/**` (the one exception: Task 6 edits `src/services/ServiceFactory.ts` and deletes `src/services/interfaces/IAudioService.ts`; Task 4 edits two kept tests — `src/services/clients/SonioxClient.test.ts` and `src/services/providers/voicePrepWiring.test.ts` — only to inline a deleted helper), the old settings UI of controller ruling 1 and the per-provider sections, `src/stores/settingsStore.ts` (read-only; its test `settingsStore.subtitle.test.ts` is edited in Task 3), `src/types/Provider.ts`, `src/components/SetupWizard/**`, `src/providers/**`, `src/components/dev/**` (Task 5 edits `SpinePreview.tsx` and its test), `extension/background/**`, `electron/**`, `src/locales/**` (no key added or removed; the 5 `en` keys Task 3 orphans — `mainPanel.{apiKeyRequired,modelsRequired,modelsLoading,insufficientBalance,localModelsRequired}` — stay, count only).
- **No behaviour change.** Every deleted module is DEAD or TYPEREF-only in the survey's module graph, or loses its last live caller in the same task. Task 5 moves behaviour and keeps it identical (first-run permission warm-up, the permission toast, the device lists, the saved-device restore, per-application sources on Electron only).
- **Diagnostics** (CLAUDE.md "Error Handling"): code that moves into a new file records failures with `reportError` / `reportWarning` from `src/lib/diagnostics/report.ts`, never `console.error` / `console.warn` (a new file starts at 0 in the console ledger); `console.info` stays as it is. A deleted file loses its `consoleLedger.consistency.test.ts` row in the same diff (the "every ledger row names a file that exists" case fails otherwise): `participantTelemetry.ts` (Task 4), `ModernBrowserAudioService.ts` (Task 6).
- **Commits** use a pathspec — `git add <paths>` then `git commit -q -F - -- <paths> <<'EOF' … EOF` — with a conventional message ending in `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Deletions: `git rm <paths>` then commit with the same pathspec.
- **Gates for every task** (the implementer runs them; the controller re-runs them):
  - **Suite:** `npx vitest run src extension electron` — 0 failed, no unhandled errors. Name the directories: a bare `npx vitest run` also collects the gitignored `.superpowers/` scratch tests, which fail by design. The controller records the start totals in the ledger.
  - **Types — no new line:** the full-tree list is compared against the baseline the controller writes at setup (`tsc-baseline.txt` in the SDD workspace; 282 lines at `1868ff80`, most of them in kept old-provider tests):
    ```
    npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | sed -E 's/\([0-9]+,[0-9]+\)//' | sort > "$TMPDIR/tsc-now.txt"
    comm -13 <path-to>/tsc-baseline.txt "$TMPDIR/tsc-now.txt"
    ```
    The `comm` must print nothing. Lines may disappear (a deleted file's errors); none may appear. The shell's `grep` is a ugrep wrapper — use `command grep` exactly as written.
  - **Builds** at the group checks: `npm run build` and `npm run extension:build`, and the D24 check `command grep -rlF 'The fake degraded its speech' build extension/dist` prints nothing.
- **Controller checks** (the controller runs probes, dev servers and builds — implementers never do): named per group below, run against `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort --force` (restart it after edits; a worktree's vite can serve stale transforms).

---

### Task 1: The subtitle-legacy cluster

The old subtitle window (`SubtitleApp`) and its private renderer (`SubtitleStream`) were replaced by `SubtitleView` / `SubtitleTakeover` / `ConnectedOverlay` (plans 1d-2, 1e-3b-2, 1e-4); `sessionPortMirror` and its untyped wire by `src/lib/subtitle/wire.ts` (1e-4). The cluster survives only because `SubtitleSurfaceKind` is imported from `SubtitleApp.tsx` (survey H2).

**Files:**
- Modify: `src/components/Subtitle/SubtitleBar.tsx` (`:35` import `SubtitleSurfaceKind` from `./useSubtitleChrome`; delete `exportProps` and the legacy `ExportButton` default import `:14, :47-48, :264`; delete `requestExit` and its `sokuji:user-exit` window-event fallback `:121-130` — its use at `:337` calls `onExit` directly; `onExit` becomes a required prop), `src/components/Subtitle/useOverlayDragResize.ts:4` (same import repoint), `src/components/Subtitle/subtitleIdleState.ts` (keep the `SubtitleIdleState` type without its `blocked` member `:13`; delete `IdleStateInput` and `deriveSubtitleIdleState` `:18-78` and the imports `:6-7`), `src/components/Subtitle/SubtitleIdle.tsx` (delete the `blocked` branch `:92-117`, the `onFix` prop `:18`, the `sessionStartGate` import `:12`), `src/components/Subtitle/SubtitleView.tsx:156` (drop `onFix={noop}` and `noop` if unused).
- Delete: `src/components/Subtitle/SubtitleApp.tsx`, `src/components/Subtitle/SubtitleStream.tsx`, `src/components/MainPanel/ConversationRow.tsx`, `src/stores/playbackStore.ts`, `src/lib/playback/highlight.ts`, `src/types/subtitleWire.ts`, `src/stores/sessionPortMirror.ts`, `src/components/MainPanel/useSubtitleSessionBridge.ts`.
- **Keep** the stylesheets other code imports: `SubtitleApp.scss` (`SubtitleView.tsx:21`), `SubtitleStream.scss` (`SubtitleBands.tsx:9`), `MainPanel/ConversationRow.scss` (`Conversation/ConversationList.tsx:8`).
- Tests — delete: `SubtitleApp.handleStart.test.tsx`, `SubtitleApp.rootStyle.test.tsx`, `SubtitleStream.test.tsx`, `ConversationRow.test.tsx`, `playbackStore.test.ts`, `playbackStore.usePlaybackHighlight.test.tsx`, `lib/playback/highlight.test.ts`, `sessionPortMirror.test.ts`, `subtitleWire.roundtrip.test.ts`, `useSubtitleSessionBridge.test.tsx`, `subtitleIdleState.test.ts` (it tests only the deleted derive). Move: `SubtitleApp.test.tsx` → `src/components/Subtitle/useSubtitleChrome.test.tsx` (it is `getHighlightOverlayForBg`'s only test; retarget its import to `./useSubtitleChrome`). Edit: `SubtitleBar.test.tsx` (the `exportProps` cases `:61, :119-126`; the user-exit window-event assertion `:262` becomes "✕ calls `onExit`"), `SubtitleIdle.test.tsx` (the `blocked` describe `:60-132` and `:222-246`).
- Comments that name `SubtitleApp` (now stale): `useSubtitleChrome.tsx:2,6,84,214`, `SubtitleTakeover.tsx:25`, `SubtitleView.tsx:67`, `SubtitleBar.tsx:47,54,121,132` (whatever of them survives the edits), `settingsStore.ts:1646` is **not** edited (read-only; Task 7 lists it for the Stage 2 plan that edits the store).

**Interfaces:**
- Consumes: `SubtitleSurfaceKind` from `src/components/Subtitle/useSubtitleChrome.tsx:14` (already exported there).
- Produces: `SubtitleBar`'s props without `exportProps`, with `onExit: () => void` required; `SubtitleIdle`'s props without `onFix`; `SubtitleIdleState` without `blocked`. Every current host already passes `onExit` (`SubtitleView` from `SubtitleTakeover` and `ConnectedOverlay`) — confirm with `command grep -rn '<SubtitleBar' src`.

- [ ] **Step 1: Confirm the cluster's importers.** `command grep -rln -E "SubtitleApp|SubtitleStream|ConversationRow'|playbackStore|playback/highlight|types/subtitleWire|sessionPortMirror|useSubtitleSessionBridge|deriveSubtitleIdleState" src extension scripts` — every hit outside the files this task deletes or edits is a stop-and-report (the survey found none).
- [ ] **Step 2: Repoint and trim** the five modified files above; move the test; adjust `SubtitleBar.test.tsx` and `SubtitleIdle.test.tsx`. Run `npx vitest run src/components/Subtitle` — PASS.
- [ ] **Step 3: Delete** the eight modules and eleven tests with `git rm`. Re-run the grep of Step 1 (now: no hit outside comments), then the full gates.
- [ ] **Step 4: Commit** — `refactor(subtitle): delete the legacy subtitle window and its overlay mirror`.

**Group check A (controller, after Task 1):** `node scripts/dev/spine-subtitle-probe.mjs` in every form it offers, `node scripts/dev/spine-surface-probe.mjs`, `node scripts/dev/app-panel-probe.mjs --app` (the takeover), `npm run extension:build` then `node scripts/dev/extension-overlay-probe.mjs --build-dir <tmp>` and `--no-build --ptt`; the overlay page's preloaded chunk list is unchanged or smaller.

---

### Task 2: The legacy export adapter

Since plan 1d-3 the export menu is `ExportMenuButton` over an `Exporter`; the legacy `ExportButton` default (`ExportButton.tsx:42-72` props, `:415-469` component — "plan 1e deletes it", `:418-420`) was rendered only through `SubtitleBar`'s `exportProps`, which Task 1 removed. Its item-based helpers in `utils/conversationExport.ts`, `autoSaveTranscript` and `shouldShowItem` have no live caller (survey H4). **After Task 1.**

**Files:**
- Modify: `src/components/MainPanel/ExportButton.tsx` (delete the legacy default and its imports `:19, :21, :22-33`; keep what `ExportMenuButton` and the shared menu use), `src/utils/conversationExport.ts` (keep only `formatLocalDateTime`, `formatLocalTime`, `formatTimestampForFilename`, `getAppVersion`, `exportFilename`, `copyToClipboard`, `downloadFile` — the seven names live code imports: `lib/export/exporter.ts:7`, `app/appAutoSave.ts:9`, `useConversationExporter.ts:5`, `ExportMenuButton`; verify with grep), `src/lib/transcript/autoSave.ts` (delete `autoSaveTranscript` `:92-120` and its imports `:5-10`), `src/components/MainPanel/conversationFilter.ts` (delete `shouldShowItem` `:8-33` and its `ConversationItem` import), `src/lib/export/exporter.ts:5` (its comment on the legacy adapter).
- Tests — **port, don't delete** (they are the only coverage of the shared menu's scope boxes, auto-save row and child-window host): `ExportButton.test.tsx` (356 lines) and `ExportButton.childWindow.test.tsx` (43) move onto `ExportMenuButton` with a stub `Exporter` (the existing `ExportMenuButton.test.tsx` shows the stub's shape); every case that asserted menu behaviour keeps an equivalent assertion; cases that asserted only the legacy adapter's item mapping go. `conversationExport.test.ts` (310) keeps the cases of the seven kept functions. `src/lib/transcript/autoSave.test.ts` (137) tests only `autoSaveTranscript`, but its cases (desktop IPC, browser download, IPC throws) are really `saveTranscriptText`'s: re-point them at `saveTranscriptText`. `conversationFilter.test.ts`: delete `:15-110`, keep `:112-141`.

**Interfaces:**
- Consumes: `ExportMenuButton`'s props and the `Exporter` type (`src/lib/export/exporter.ts`); `saveTranscriptText` (`src/lib/transcript/autoSave.ts`).
- Produces: nothing new.

- [ ] **Step 1: Port the two `ExportButton` test files** onto `ExportMenuButton` first, and run them against today's code — PASS (they test the kept menu).
- [ ] **Step 2: Re-point `autoSave.test.ts`** at `saveTranscriptText` — PASS.
- [ ] **Step 3: Delete** the legacy code and the dead test cases listed above; grep `command grep -rn -E "autoSaveTranscript|shouldShowItem|buildExportPayload|buildTxtI18n|normalizeMessages|formatAsJson|formatAsTxt" src` → only comments or nothing.
- [ ] **Step 4: Gates, commit** — `refactor(export): delete the legacy export adapter and its item helpers`.

**Group check B (controller, after Task 2):** `node scripts/dev/spine-export-probe.mjs`; `node scripts/dev/app-panel-probe.mjs --app` (export .txt, and auto-save on Stop with auto-save on).

---

### Task 3: The old session store's dead half and the old start gate

Nothing writes `sessionStore` since the switch; after Task 1 its only readers are kept old UI — `ProviderSpecificSettings.tsx:76,134,260` (`useLockedMode`, `useSessionIsInitializing`) and, graph-only, `ProviderSection.tsx:49,223` and `LanguageSection.tsx:41,80` (`useLockedMode`). `sessionStartGate.ts` (the old MainPanel's `computeStartGate`) is held only by `sessionStore.ts:5`'s `type StartGate` after Task 1 (survey H3, controller ruling 2). **After Task 1.**

**Files:**
- Modify: `src/stores/sessionStore.ts` — trim to `lockedMode` and `isInitializing`, their setters and the two hooks `useLockedMode` / `useSessionIsInitializing` (keep their exact names and types — the kept UI imports them); a header comment saying only kept old-provider UI reads it, nothing writes it, and each Stage 2 port that deletes a reader moves the store toward deletion. Delete `items` / `participantItems` (`ConversationItem`), `startGate` (`StartGate`), the counters, `translationCount` and every other hook.
- Delete: `src/components/MainPanel/sessionStartGate.ts`, `sessionStartGate.test.ts`, `sessionStartGate.imports.test.ts`, `src/stores/sessionStore.startRequests.test.ts`.
- Modify (test): `src/stores/settingsStore.subtitle.test.ts` — the vestigial `sessionStore.isSessionActive` writes at `:46,62,69,76,82,102,128,157` (the gate under test reads `currentRunPhase()`, `settingsStore.ts:907`); remove them without changing what each case asserts.

**Interfaces:**
- Produces: `sessionStore` with exactly `{ lockedMode, isInitializing, setLockedMode, setIsInitializing }` (read the current setter names and keep them) plus `useLockedMode()` and `useSessionIsInitializing()`.

- [ ] **Step 1:** `command grep -rn "sessionStore\|sessionStartGate" src --include='*.ts' --include='*.tsx'` — list every reader; each must be in the kept set above, in a file this task edits, or a test this task deletes.
- [ ] **Step 2: Trim and delete**; the kept tests `LanguageSection.textOnly.test.tsx:66,104` (set `lockedMode`) and `ProviderSpecificSettings.soniox.test.tsx:418,422` (set `isInitializing`) must pass unchanged.
- [ ] **Step 3: Gates, commit** — `refactor(stores): trim the old session store to what kept UI reads; delete the old start gate`.

---

### Task 4: The old MainPanel's orchestration helpers

Imported by the old `MainPanel.tsx` until the switch (`aecaae2b`), dead since (survey §1.4 category b). Independent of Tasks 1–3.

**Files:**
- Delete (with their tests): `src/components/MainPanel/clientOptions.ts` (+`.test.ts`), `conversationMerge.ts` (+`.test.ts`), `participantTelemetry.ts` (+`participantTelemetryWiring.test.ts`), `prepareEnvelope.ts` (+`.test.ts`), `reconnectingChannels.ts` (+`.test.ts`), `segmentationForProvider.ts` (+`.test.ts`), `segmentationTelemetry.ts` (+`.test.ts`), `sessionModelTelemetry.ts` (+`.test.ts`), `useSegmentationRuntime.ts` (+`.test.ts`), `src/lib/apiErrorProps.ts` (+`.test.ts`), `src/utils/audioUtils.ts` (+`.test.ts`), and `src/components/MainPanel/sessionEndAutoSave.test.ts` (a behavioural replay of the old `MainPanel.disconnectConversation`; the runner's auto-save is covered by `src/app/appAutoSave*.test.ts` — confirm before deleting).
- Modify (kept tests, the only judgement in this task):
  - `src/services/clients/SonioxClient.test.ts:10,1763` imports `mergeConversationItems` from `conversationMerge`. Inline the minimal merge the assertion at `:1763` needs into the test file (a few lines, with a comment saying it mirrors the deleted old MainPanel merge), or, if the assertion is only about the merge itself, delete that one assertion and say so in the report. This file carries 66 baseline type errors — compare the tsc list without line numbers.
  - `src/services/providers/voicePrepWiring.test.ts:37` imports `expectationHolds` from `prepareEnvelope` (14 lines): inline it into the test file.
- Modify: `src/lib/diagnostics/consoleLedger.consistency.test.ts` — delete the row `'src/components/MainPanel/participantTelemetry.ts': 2` (`:168`).

- [ ] **Step 1:** grep each module's name across `src extension scripts` — the only non-deleted importers are the two kept tests above.
- [ ] **Step 2: Inline** into the two kept tests; run them — PASS.
- [ ] **Step 3: Delete**, drop the ledger row, gates, commit — `refactor(main-panel): delete the old MainPanel's orchestration helpers`.

---

### Task 5: Device enumeration moves to `src/lib/audio/devices.ts`

The old audio service is built at start-up (`Home.tsx:16,22` → `audioStore.initializeAudioService()` → `ServiceFactory.getAudioService()` = `ModernBrowserAudioService`), and its recorder and players are fed by nothing: the new graph captures and plays. Live code still uses two of its methods, both through `audioStore.refreshDevices` (survey H1): `getDevices()` (`ModernBrowserAudioService.ts:163-251`, with the microphone-permission warm-up `ensureMicrophonePermission` `:253-278` and the permission toast `showPermissionError` / `displayErrorNotification` `:292-360`) and `getSystemAudioSources()` (`:948-976`, IPC `supports-system-audio-capture` / `list-system-audio-sources`, Electron only). `connectMonitoringDevice` and `setMonitorVolume` drive only the idle player — the new graph routes the monitor itself (`src/lib/audio/appAudio.ts:39-64`). Controller ruling 3.

**Files:**
- Create: `src/lib/audio/devices.ts`, `src/lib/audio/devices.test.ts`.
- Modify: `src/stores/audioStore.ts` (uses `devices.ts`; loses `audioService`, `setAudioService`, `connectMonitorDevice`, `initializeAudioService`, `useInitializeAudioService` and the `setMonitorVolume` / `connectMonitoringDevice` calls — survey H1 lists the lines: `:4,7,122,125,173,176,238-252,312-314,355-361,386,396-406,602-653,685,733,748,756`), `src/routes/Home.tsx:16,22` and `src/components/dev/SpinePreview.tsx:350-356` (call `useAudioStore.getState().refreshDevices()` where they called `initializeAudioService()` — keep whatever ordering/`await` they had), `src/stores/audioStore.test.ts` (mock `../lib/audio/devices` instead of `setAudioService`; delete the "monitor volume mode-gating" describe `:299-362` — the rule lives in `appAudio.readRouting`, covered by `appAudio.test.ts`), `src/components/dev/SpinePreview.test.tsx:20` (+ its three assertions on the service), `src/components/EchoNotice/EchoNotice.test.tsx:6` (its mock of the service).

**Interfaces:**
- Produces, in `src/lib/audio/devices.ts` (no store access, no React):
  ```ts
  import type { AudioDevice } from '../../stores/audioStore';
  /** The input and output devices, labelled. Warms the microphone permission up only when the inputs come back unlabelled (the first run), and shows the permission toast when it is refused — both as `getDevices` did. */
  export async function listAudioDevices(): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }>;
  /** Per-application audio sources: Electron only, `[]` elsewhere and on a platform without system-audio capture. */
  export async function listSystemAudioSources(): Promise<AudioDevice[]>;
  ```
  If importing the type from the store would create a cycle the build rejects, move `AudioDevice` into `devices.ts` and re-export it from `audioStore.ts` under the same name.
- `audioStore.refreshDevices` keeps its signature and its result; it calls `listSystemAudioSources()` only where it called `getSystemAudioSources` before (the method existed only on the Electron-capable service — today's `typeof listSources === 'function'` guard becomes "always call; it answers `[]` off Electron").

- [ ] **Step 1: Write the failing tests** in `devices.test.ts` (mock `navigator.mediaDevices` and `window.electron`), porting the matching cases from `ModernBrowserAudioService.test.ts` (read it — it has the enumeration cases): enumerate-first, then warm up only when every input label is empty; the list survives a failed warm-up (still returned, the toast shown, a `reportWarning`/`reportError` recorded — whichever the old `console.*` severity maps to per CLAUDE.md); outputs listed; per-application sources only when `window.electron` exists and `supports-system-audio-capture` answers true; an IPC failure returns `[]` with a `reportWarning`. Run — FAIL (no module).
- [ ] **Step 2: Move the code** — copy the bodies (not rewrite them), turning the class's `console.error` / `console.warn` into `reportError` / `reportWarning` and keeping `console.info`. The permission toast (`displayErrorNotification`) moves too, as a private function. Run the tests — PASS.
- [ ] **Step 3: Rewire `audioStore`, `Home.tsx`, `SpinePreview.tsx`** and their tests; nothing may still call `ServiceFactory.getAudioService` outside `ServiceFactory.ts` and the old service's own test (`command grep -rn getAudioService src`).
- [ ] **Step 4: Gates, commit** — `refactor(audio): enumerate devices without the old audio service`.

---

### Task 6: Delete the old audio service

Mechanical once Task 5 lands. **After Task 5.**

**Files:**
- Delete: `src/lib/modern-audio/ModernBrowserAudioService.ts` (+`.test.ts`), `src/lib/modern-audio/ModernAudioPlayer.js` (+`playedAudioTap.test.ts`), `src/services/worklets/playback-ring-processor.js` (find its path: `command grep -rn playback-ring-processor src extension`), `src/services/interfaces/IAudioService.ts`, `src/lib/modern-audio/index.js`.
- Modify: `src/services/ServiceFactory.ts` (drop the audio half — `:1,3,12,35-46,72`), `extension/vite.config.ts:84-85` (the static copy of `playback-ring-processor.js`; the other three copies stay), `src/lib/diagnostics/consoleLedger.consistency.test.ts` (delete the `ModernBrowserAudioService.ts: 29` row, `:192`).
- **Keep** everything else in `src/lib/modern-audio/` the new capture reuses (`ModernAudioRecorder`, `AppAudioRecorder`, `DeviceCaptureRecorder`, `LoopbackRecorder`, `TabAudioRecorder`, `EchoMonitor`, `echoDetector`, `participantSource.ts`, `BaseAudioRecorder`, gtcrn) and `WebRTCAudioBridge.ts` / `pcm-audio-worklet-processor.js` (old WebRTC/Palabra clients, kept).

- [ ] **Step 1:** grep every deleted name (`ModernBrowserAudioService`, `ModernAudioPlayer`, `playback-ring-processor`, `IAudioService`, `modern-audio/index`, `getAudioService`) across `src extension electron scripts` — only the deleted files and the edits above.
- [ ] **Step 2: Delete and edit**; gates; `npm run extension:build` locally is the controller's (Group check C).
- [ ] **Step 3: Commit** — `refactor(audio): delete the old audio service and its idle player`.

**Group check C (controller, after Task 6):** `npm run build` and `npm run extension:build` build; the extension's `dist/worklets/` no longer has `playback-ring-processor.js`; D24 grep empty; `node scripts/dev/spine-audio-probe.mjs`; `node scripts/dev/app-panel-probe.mjs --app`, `--app --advanced` (capture meters move) and `--app --ptt`; `node scripts/dev/extension-overlay-probe.mjs --build-dir <tmp> --ptt`; the Settings audio page lists devices after a fresh profile's first load (render it). **Owner, on Electron** (recorded in the roadmap, not blocking the plan): device pickers populated; first-run permission prompt; monitor and passthrough heard once; the virtual microphone receiving TTS in a meeting app.

---

### Task 7: Stale text

**Files:** comments only, except where noted.
- Stale under the keep ruling: `src/providers/localInference/provider.ts:24-25` ("`src/services`, which plan 1e-3c deletes"), `src/lib/session/storedSettings.ts:22` ("the old settings store (still loaded until plan 1e-3c)" — it stays loaded until Stage 2 retires it), `src/components/providers/ProviderPicker.tsx:13-19` (controller ruling 1: `ProviderSection` stays until Stage 2 no longer needs it), `src/components/Settings/Settings.highlight.test.tsx:1-10` (its header explains ProviderSection's `openSlot`, which no longer runs), `src/components/Settings/sections/SystemAudioSection.test.tsx:126-127` ("MainPanel rebuilds the capture"), `src/components/MainPanel/MainPanel.tsx:197` (`t` is no longer stable for the panel's life since `bindI18nStore: 'added'`; the behaviour is right).
- `src/lib/analytics.ts:65-66`: delete the `translation_count?` field of the session event type ("still sent by the old session path until plan 1e removes it" — nothing sends it; D9).
- Test names: `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.test.ts:395,407` still say `subtitle:enter` is the message held in flight — it is `subtitle:exit`.
- Any `SubtitleApp` mention Task 1 left in a file it did not otherwise edit.
- **Not in this task:** `settingsStore.ts:1646`'s `SubtitleApp` comment (the store is read-only here — listed in the roadmap for the Stage 2 plan that edits it), the optional hygiene the survey lists (`SpinePreview` publishing from `currentSubtitleFeed()`, one shared `box<T>()`, the duplicated mock block in three MainPanel/Takeover tests) — recorded in the roadmap.

- [ ] **Step 1: Edit**; gates; commit — `docs: correct comments the transitional deletion left stale`.

---

### Task 8 (controller): The record

**Files:** `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` — a "Scheduled by plan 1e-3c" section: what landed (commits, lines deleted), the owner's rulings that narrowed the plan (keep every old provider; keep the fake), controller rulings 1–6, the Group checks' results, what it leaves: the D1 surfaces and `sessionStore`'s remainder (to go when Stage 2 no longer needs them), the old-clients-in-the-bundle cost (D6, incl. the overlay preload), `settingsStore.ts:1646`, the optional hygiene items, the orphaned `en` keys (5), the owner's Electron audio checks from Group check C, and the pre-existing orphans (D5) as a separate hygiene item.

- [ ] **Step 1: Write the section**; commit with pathspec — `docs(roadmap): record plan 1e-3c`.

---

## Self-review

- **Coverage against the survey's required tasks:** T1 → Task 1, T2 → Task 2, T3 (C1) → Task 3, T4 → Task 4, T5a → Task 5, T5b → Task 6, T6 → Task 7; optional T7 (D1) and T8 (D5) are ruled out (controller rulings 1, 5); D4 kept (ruling 4); D6 recorded (Task 8). The roadmap's three 1e-3c lists: 1e-3b-1's mock block → recorded as optional (Task 8); 1e-3b-2's "old clients, descriptors, settings slices, sections" → overruled by the owner (kept), "MainPanel helpers" → Task 4, "old audio service" → Tasks 5–6, the two stale comments → Task 7; 1e-4's list → Task 1 (mirror, wire type, playbackStore, SubtitleApp, SubtitleStream, derive, idle `blocked`/`onFix`, `SubtitleBar`'s legacy export and exit fallback, `useSubtitleSessionBridge`), `isPushGatedMode` → kept (it lives in the kept descriptors), `sessionStore`'s SubtitleApp-only hooks → Task 3, the stale text → Tasks 1 and 7, the duplicated entries adapter and `box<T>()` → recorded (Task 8).
- **Order:** Tasks 2 and 3 need Task 1; Task 6 needs Task 5; Task 4 is independent. Executed in number order, each leaves the gates green.
- **Placeholders:** the file:line lists are the survey's at `1868ff80`; an implementer re-verifies each with the grep in its first step before editing.
