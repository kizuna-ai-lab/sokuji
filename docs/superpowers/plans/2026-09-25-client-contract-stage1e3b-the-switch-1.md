# Client contract — Stage 1e-3b-1: the panel on the root

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything the switch needs that can land while the running app still runs the old path. The audio layer's last debts: the #246 wedged-context recovery, level meters for the footer's waveforms, a tap on a bus for the audio probe, and a microphone that stops capturing first. Notices worded and redacted: language names in `no_asr`, four new sentences, and a Settings deep link by notice code. The root's remaining page wiring: the close handshake answered on `settled()`, the run phase for code outside React, the provider locked during a run, the stored selection and turn mode applied. The Electron takeover as an app component. And the new MainPanel — built beside the old one from the root's runner, view, karaoke and subtitle session, mounted in the development preview, and checked there by a new headless probe. Plan 1e-3b-2 builds the Settings pieces and switches the app over in one commit.

**After 1e-3b-2 the branch offers LocalInference only** (and the fake in development builds) until Stage 2 restores each provider (1e-3 ruling 1, spec D11/D12). No build from the branch ships before Stage 2's Soniox step.

**Why two plans.** MainPanel and the Settings provider area must switch in the same commit: the runner reads `providerStore`, the old sections write `settingsStore` slices, and the two copies of the same stored keys do not sync (`1e3-shell.md` §2, "Dual writers"). Everything else can land first. This plan builds what the switch mounts — the panel, the takeover, the root's wiring, the audio debts — and proves it in the preview, so the running app changes in only two invisible ways (Global Constraints). Plan 1e-3b-2 builds the Settings pieces the same way, then flips the panel, the takeover, Settings, the writers and the stored settings in one commit, and ends with the Electron acceptance. The cut puts the panel — the largest behaviour surface and the riskiest — under review on its own.

**Architecture:** The new panel lives beside the old one: `src/components/MainPanel/SessionPanel.tsx` composes pieces under `src/components/MainPanel/panel/` (a push-to-talk hook, the session clock, the start label, the replay gate, the permission warnings, the toolbar, typed text, the footers, the waveforms), all reading `getAppSession()` and the stores; plan 1e-3b-2's switch moves it over `MainPanel.tsx`. `SubtitleTakeover.tsx` is the Electron takeover over the root, mounted by the preview now and by `MainLayout` at the switch. `src/app/` gains `runPhase.ts` (a leaf accessor), `useRun.ts` (the run hooks), `AppSessionRoot.tsx` (the one owner of `attach()` and the bridges, mounted by the switch); `session.ts`'s `attach()` answers the close request, keeps the provider locked during a run and reports a source's end. The audio graph rebuilds a wedged context itself and exposes a meter per bus; the app capture keeps a level meter per leg. The preview mounts the panel at `&panel=1` and the takeover at `&subtitle=1`; `scripts/dev/app-panel-probe.mjs` drives the panel headlessly.

**Tech Stack:** TypeScript (strict), React 18, zustand, i18next, Vitest + @testing-library/react, Web Audio, Vite, headless Chromium over the DevTools protocol.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — "Stopping, and closing the window", "State", "What may change during a run", "Sources, in full", "Notices reach the user localized", "Analytics", "Playback" → "Routing", "The two subtitle surfaces are not the same thing", "Testing" (rendering), "Migration". The roadmap's items for 1e-3 (`docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`: "Decided for 1e", "Scheduled by plan 1e-1 / 1e-2 / 1e-2b / 1e-3a") and the sixteen **1e-3 rulings** (2026-09-25, `1e3-decisions.md` in this plan's workspace, cited as *1e-3 ruling N*) bind this plan. The research notes — MainPanel by responsibility (`1e3-shell.md` §1 items 1–34, §2, §3's "1e-3b"), the roadmap's items with Electron's IPC and the stored-settings mapping (`1e3-items.md`), the deletion blast radius (`1e3-deletion.md`, context) — are in the same workspace. The model for this plan's form is `docs/superpowers/plans/2026-09-25-client-contract-stage1e3a-composition-root.md`. This plan's own rulings are cited as *ruling N*; plan 1e-3a's as *1e-3a ruling N*.

## Global Constraints

- **The running app runs the old path**, with two invisible exceptions: `loadSessionStores()` (called by `Home.tsx` since 1e-3a) now selects the stored provider in memory and migrates the turn mode — its one write is `settings.common.turnMode`, a key the old path never reads (Task 6); and Electron's close/update wait rises from 5 s to 16 s (Task 5), which only lengthens how long a hung renderer can hold a close. Three changed files are reached by the running app but stay inert there: `SubtitleIdle.tsx` / `SubtitleView.tsx` (Task 7 — the `unready` branch the old `SubtitleApp` never produces), `useEchoNotice.ts` (Task 9 — a widened parameter type the old `IAudioService` still satisfies) and `MainPanel.scss` (Task 8 — a new `.message-action` rule nothing old renders). Read only: `src/components/MainPanel/MainPanel.tsx` and every old MainPanel helper, `src/components/MainLayout/**`, `src/components/Settings/**`, `src/components/SettingsInitializer/**`, `src/components/SetupWizard/**`, `src/components/TitleBar/**`, `src/components/Subtitle/SubtitleApp.tsx`, `src/contexts/**`, `src/services/**`, `src/stores/{settingsStore,sessionStore,audioStore,modelStore,logStore,playbackStore,segmentationStore}.ts`, `src/lib/modern-audio/**`, `extension/**`.
- **Nothing in the running app builds the new panel, mounts the takeover or calls `attach()`.** The preview does (`&panel=1`, `&subtitle=1`, its own `attach()`); `AppSessionRoot` is built here and mounted by plan 1e-3b-2's switch.
- `src/lib/**` never imports React or anything under `src/app/**`. `src/providers/**` imports no store but `modelStore` and `turnModeStore`. Under `src/app/`, React is imported by `useAppSession.ts`, `useRun.ts` and `AppSessionRoot.tsx` only, and `src/lib/analytics.ts` as a value by `useAppSession.ts` only (its module graph mounts the app's React root — type imports are fine). `settingsStore` may import `src/app/runPhase.ts` only (a leaf with type imports alone).
- New locale keys only in Task 4: four keys in all 30 locales. The English is given there; the other 29 are written by the implementing model, reusing each locale's own words for "Other" (`mainPanel.displayMode.participant`), replay (`mainPanel.playItemAudio`), system audio (`audioPanel.participantFellBackToSystemAudio`) and an application source (`audioPanel.screenRecordingHasAlternative`), and listed in the commit body for the native-reader spot-check the roadmap already owes for `notices.*`. Insert lines; never re-serialize a file.
- Record a caught failure with `reportError` / `reportWarning`, never `console.error` / `console.warn`. `src/app/` is at zero already; every new file under `src/components/MainPanel/` is unlisted in the console ledger and so held at zero.
- Gates for every task: `npx vitest run src` shows 0 failed (today: 445 files passed, 1 skipped; the 4 unhandled rejections from `settingsStore.nativeGate.test.ts` are the baseline), and this typecheck gate prints exactly the same **11 lines** it prints at this plan's start (the shell's `grep` is a ugrep wrapper that mis-parses this regex — use `command grep` exactly as written). **The regex widens plan 1e-3a's** by `components/EchoNotice/useEchoNotice\.ts` and `components/MainPanel/(SessionPanel|panel/)` beside `ExportButton` — the files this plan creates or edits outside the old gate; none carries an error today, so the 11 lines are unchanged (checked against this plan's start commit):

  ```
  npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts)|lib/modern-audio/BaseAudioRecorder|providers|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|SessionPanel|panel/)|dev/(SpinePreview|SessionControls|OverlayPreview))|stores/(providerStore|turnModeStore|routingStore)|utils/(environment|conversationExport)|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
  ```

  The 11 lines: App.tsx TS6133 'React'; SubtitleApp.handleStart.test.tsx TS6133 'provider'; 6× SubtitleBar.test.tsx TS2322 'SessionControl'; analytics.ts TS6133; environment.ts TS2717; environment.ts TS2339. Do not fix them; do not add to them.
- Task 5 also runs `npx vitest run electron/close-handshake.test.js electron/closeHandshake.wiring.test.js` (outside `src`, so outside the suite gate).
- Never start a dev server and never run a probe: after a task's commit the controller runs the headless probes the task names against a fresh vite (`SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort`). Two task groups end with a check the controller must pass before the next group starts: after Task 7 and after Task 13.
- Commits: conventional, English; every message ends with the implementing model's `Co-Authored-By` line only. In this worktree the shell refuses compound git commands: run `git add` and `git commit -q -F - <<'EOF' … EOF` as separate calls. Never push.

## Rulings this plan makes

1. **The cut** — as "Why two plans" above. The dual-writer constraint holds at every commit because no commit of this plan mounts a writer of `providerStore` in the running app; plan 1e-3b-2's switch is one commit. The development preview is exempt: it has written the same stored keys as the old slices since plan 1e-2 (LocalInference's own settings through `ProviderPanel`), and its picker's pick persists from here on (ruling 8). So a developer who picks the fake in the preview stores `settings.common.provider = 'fake'`, and the old path on the same origin then quietly falls back to OpenAI in memory (`settingsStore.ts:1318`): pick LocalInference in the preview, or clear that key, before using the running app in the same browser profile. Development only; no build carries the fake.
2. **The graph recovers a wedged context itself (#246).** Only the graph knows which suspends are its own (it rests the context every quiet period since plan 1e-1), so the watch lives in `createAudioGraph`, armed only when its deps give `replaceContext` — which `getAppAudio` does. A 'suspended' state the graph did not ask for: after `WEDGE_GRACE_MS` (250) still suspended → `resume()`; after `RESUME_DEADLINE_MS` (1 500) not running → rebuild on a fresh context. A `resume()` of the graph's own that does not land by the deadline is a wedge too, and never hangs its caller. At most `MAX_REBUILDS` (3) until a context reaches 'running' again. **The order of a rebuild:** a fresh context, its tap module, the build swapped in, the routes re-applied, *then* the reset listeners (so a queue clears against the new clock: anything the playback scheduled while the module loaded sat on the dead context with its frozen, possibly hours-long `currentTime` as the queue's tail, and would otherwise hold every later clip that long and drop every passthrough chunk), then play; the dead context's `close()` is fired and never awaited, since a wedged context may never settle it, as it may never settle `resume()`. A rebuild keeps the graph object, the `<audio>` elements and their devices, the tts tap, the routes and the meters; clips scheduled on the dead context are lost (today's rule, `ModernAudioPlayer.js:855`): the playback clears its queues and passthrough on the graph's `onReset`, but keeps its clip indices, since L1's speech entries go on.
3. **Meters.** The capture keeps a `LevelMeter` per leg — one RMS bar per delivered chunk, 32 bars, flat once no chunk arrived for 300 ms (mute, an ended source, idle) — and the graph an `AnalyserNode` per bus asked for (`meter(bus)`, null where the platform lacks the bus), pulled through its muted path to the destination like the taps. The advanced footer's output strip reads `'virtual'` (what the meeting hears, as today: flat on the web, which has none); the preview's probe reads `'real'` — the tap on a bus the roadmap asked for before the audio probe is trusted for a routing change. **Stated departure:** the microphone strip shows what the microphone captures in every turn mode; today under push-to-talk it moves only while the key is held (`MainPanel.tsx:3885-3891`). Cost if wrong: a strip that moves while nothing is sent — change `Waveforms`' reader, not the meter.
4. **Words.** `noticeText` names a language for the `source` / `target` params (`getLanguageOption(code).name`, the name every language menu shows). A notice's code maps to the Settings section that fixes it (`settingsTargetForCode`, `reasonToSettingsTarget`'s successor, 1e-3a's deferred item). Four new sentences (Task 4) have no existing sentence to copy, so they are translated, not copied (Global Constraints).
5. **The run phase outside React.** `settingsStore.enterSubtitleMode` (plan 1e-3b-2) cannot import the root (the root imports the stores): a leaf, `src/app/runPhase.ts`, holds an accessor `getAppSession()` registers when it builds the page's session (idle before that — no run can exist yet). React reads the phase through `src/app/useRun.ts` (`useRunState`, `useRunPhase`, `useSessionLocked`), which `useAppSession.ts` re-exports so 1e-3a's imports keep working.
6. **The close.** `attach()` answers `app:close-requested` after `runner.stop('window')` and `runner.settled()` — never `abandon()`, which `settled()` would no longer wait for (roadmap 1e-1) — and says `app:close-ready` in a `finally`. The main process waits `DEFAULT_TIMEOUT_MS = 16 000`, the runner's `DEFAULT_CLOSE_TIMEOUT_MS` + 1 s (*1e-3 ruling 12*), pinned by a test that reads both. `session_control_clicked`'s `method` gains `'window'`, so a close is not counted as a Stop button press. The update install rides the same channel (`close-handshake.js:118-131`).
7. **The provider cannot change during a run.** `providerStore` gains `selectionLocked`, which `attach()` keeps equal to "the phase is not idle"; a `select()` while locked is refused with a warning. The Settings picker is disabled then too (plan 1e-3b-2) and the sign-in auto-switch goes (plan 1e-3b-2); this is the store's own guard (spec: "What may change during a run").
8. **`select(id, how)`.** `'pick'` — a person chose — persists the old enum's spelling (`storedProviderValue`) under `settings.common.provider`; `'load'` (the default) never writes, so a fallback never overwrites a stored provider this build lacks (*1e-3 ruling 2*). `loadSessionStores()` selects the stored provider with `'load'`, unless the page already selected one (the preview's fake, `&provider=`).
9. **The turn mode migrates at load, in this plan** (*1e-3 ruling 3*, 1e-3a's `migrateTurnMode`). The old path never reads `settings.common.turnMode`, so writing it early changes nothing it runs; if a developer then edits the old slice's mode before the switch, the migrated value is the earlier one — no build ships in between (ruling 1 of 1e-3).
10. **A source's end is an `audio_error`** (`error_type: 'device_access'`, the redacted message, the leg as `device_info`) — what MainPanel sent for a failed device switch (`MainPanel.tsx:4369-4373`); a device switch now happens inside the source and fails as its end. `audio_device_changed` stays with the Settings sections that already send it on every pick (`AudioDeviceSection.tsx:107,130`); MainPanel's mid-session copy (`MainPanel.tsx:4359`, `:600`) was a duplicate and is not ported.
11. **Start waits for the provider's entry** (roadmap 1e-1: "the stores loaded before the first start"): the subtitle session's `canStart` — the gate both the panel and the takeover read — is also false until the selected provider's entry has loaded, so a click in the first moment is not refused as "choose a provider".
12. **Display-mode buttons follow intent.** The subtitle session's `legs` are the audio mode's legs plus the conversation's (roadmap 1d-2 → 1e), as today's `effectiveMode || items` rule (`MainPanel.tsx:4481-4494`, `SubtitleApp.tsx:195-199`).
13. **Notice actions** (roadmap 1d-3: "give the notice bubble that action"). A notice whose code maps to a Settings section gets a button labelled `settings.title` that opens it; a `loopback_denied` notice gets `audioPanel.openSystemSettings`, which reopens the Screen Recording modal. The subtitle idle's `unready` button deep-links the same way; the takeover leaves subtitle mode first (today's `handleFix`, `SubtitleApp.tsx:97-104`).
14. **Per-row memoization** (roadmap 1d-1 → 1e). `displayItems` reuses the previous item while its row (compared by value with the projection's own `sameRow`), header, end flag, time, leg and languages are unchanged; `RowBubble` and `NoticeBubble` are `React.memo`, with booleans instead of shared state (`replayingThis`, `replayingOther`, `canReplay`) handed only to a row whose replay slot shows (constants otherwise, so a replay starting re-renders the slotted rows alone), one stable replay callback, and a notice's action cached per notice id — so a karaoke tick re-renders the lit row only.
15. **The replay gate** (decided for 1e-3). Replay is disabled, with a tooltip, while a run is live with the participant leg on Electron capturing the whole system: the chosen participant source is not an application (`app:` id), or the participant leg carries an `app_capture_lost_using_system_audio` / `app_capture_monitor_missing` notice this run. Idle, speaker-only, the extension (tab capture never hears the side panel) and the web replay freely.
16. **The panel's own rules.** The push-to-talk "Release" state is the panel's (RunState has no held field; `usePushToTalk` keeps it and releases on blur, key-up and the run ending). The start label: "Loading (n/m)…" from `RunState.starting.loading`, else "Connecting..." (simple) / "Initializing..." (advanced). A run in `stopping` shows a disabled Stop. The countdown is not drawn (Stage 2: `Resources` has no budget) and the split-degraded chip is gone (D21). Typed text shows while the speaker leg is live and the provider takes text. The development test tone toggles: a second click stops the preview (`Playback.stopPreview`).
17. **Permission modals** (*1e-3 ruling 6*). A start that ends refused or failed with `loopback_denied` opens the Screen Recording modal, with today's "pick an application" note when one is on offer (`MainPanel.tsx:4912-4927`). A new `silent_no_permission` notice on the participant leg opens the audio-capture modal only while no tap has ever delivered audio on this machine (today's #492 rule, `silentNoPermissionPresentation`).
18. **The echo notice** reads a narrow `EchoSource` (`onEchoNotice`, `setEchoDiagnostics`), which the old `IAudioService` already satisfies and the panel adapts from the capture's `EchoWatch`; a detection is a `reportWarning` and an `echo_detected` event, not an `addLog` (console ledger).
19. **The new panel is `SessionPanel.tsx`** until the switch moves it over `MainPanel.tsx` (plan 1e-3b-2), which keeps MainLayout's import, the file's name in the tour's source scan, and leaves the old helpers as 1e-3c's "leftovers". The preview mounts it at `&panel=1` (with `&ui=advanced` for the advanced footer), and `scripts/dev/app-panel-probe.mjs` checks it there — and, after the switch, in the app itself. The preview applies its stored-settings parameters (`&script=`, `&cut=`, `&turn=`, `&compact=1`, `&autosave=1`, `&monitor=1`) once its stores have loaded, with or without `&autostart=1` (Task 13), so a probe that starts by clicking runs the script and the switches it asked for.

## File Structure

| File | Change |
|---|---|
| `src/lib/audio/graph.ts` (+ test), `src/lib/audio/fakeWebAudio.ts` | a wedged context rebuilt; `onReset` (Task 1); `meter(bus)` (Task 2) |
| `src/lib/audio/playback.ts` (+ test), `src/lib/audio/appAudio.ts` (+ test) | queues cleared on a reset; `replaceContext` (Task 1); `meter` (Task 2) |
| `src/lib/audio/levelMeter.ts` (+ test), `src/lib/audio/appCapture.ts` (+ test) | new: a leg's level meter; `AppCapture.levels` (Task 2) |
| `src/components/dev/SessionControls.tsx` (+ test), `SpinePreview.tsx` (+ test), `scripts/dev/spine-audio-probe.mjs` | the bus peak, `&monitor=1` (Task 2); the takeover (Task 7); `&panel=1`, `&ui=advanced` (Task 12); the settings parameters applied on load (Task 13) |
| `src/lib/audio/capture/mic.ts` (+ test), `src/lib/conversation/Conversation.ts` (+ test) | stop capturing first; notices redacted (Task 3) |
| `src/lib/view/noticeText.ts` (+ test), `src/lib/view/noticeTargets.ts` (+ test), `src/locales/*/translation.json` | language names; code → Settings section; four sentences (Task 4) |
| `src/app/runPhase.ts`, `src/app/useRun.ts`, `src/app/AppSessionRoot.tsx` (+ tests), `src/app/session.ts` (+ test), `src/app/useAppSession.ts`, `src/lib/session/runner.ts`, `src/lib/analytics.ts`, `src/stores/providerStore.ts` (+ test), `electron/close-handshake.js`, `src/app/closeBound.test.ts` | the run phase, the close, the lock, a source's end, the bound (Task 5) |
| `src/app/loadStores.ts` (+ test) | the stored selection and turn mode applied (Task 6) |
| `src/lib/subtitle/session.ts`, `appSession.ts` (+ tests), `src/components/Subtitle/{SubtitleIdle,subtitleIdleState,SubtitleView}` (+ tests), `src/components/Subtitle/SubtitleTakeover.tsx` (+ test) | legs from intent, Start after load, the deep link, the takeover (Task 7) |
| `src/lib/projection/project.ts`, `src/lib/view/filter.ts` (+ test), `src/components/Conversation/ConversationList.tsx` (+ tests), `src/components/MainPanel/MainPanel.scss` | reused items, memoized rows, the replay gate's tooltip, notice actions (Task 8) |
| `src/components/MainPanel/panel/{usePushToTalk,sessionClock,startLabel,replayGate,usePermissionWarning}.ts` (+ tests), `src/components/EchoNotice/useEchoNotice.ts` | the panel's rules (Task 9) |
| `src/components/MainPanel/panel/{PanelToolbar,TypedText}.tsx` (+ tests) | the toolbar and typed text (Task 10) |
| `src/components/MainPanel/panel/{PanelFooter,Waveforms}.tsx` (+ tests) | the two footers and the waveforms (Task 11) |
| `src/components/MainPanel/SessionPanel.tsx` (+ tests) | the panel, composed (Task 12) |
| `scripts/dev/app-panel-probe.mjs` | the panel's headless probe (Task 13) |

---

### Task 1: The graph rebuilds a wedged context (#246)

**Files:** Modify `src/lib/audio/graph.ts`, `src/lib/audio/graph.test.ts`, `src/lib/audio/fakeWebAudio.ts`, `src/lib/audio/playback.ts`, `src/lib/audio/playback.test.ts`, `src/lib/audio/appAudio.ts`, `src/lib/audio/appAudio.test.ts`.

**Interfaces:**
- Produces (`graph.ts`): `WEDGE_GRACE_MS = 250`, `RESUME_DEADLINE_MS = 1_500`, `MAX_REBUILDS = 3`; `GraphDeps.replaceContext?(): AudioContext`, `GraphDeps.clock?: Pick<Clock, 'setTimeout'>` (default `realClock`); `AudioGraph.onReset(listener: () => void): () => void`.
- Produces (`fakeWebAudio.ts`): `FakeAudioContext.addEventListener('statechange', fn)` / `removeEventListener`, `wedge()`, `recover()`, `stuck: boolean`.
- Consumed by: `createPlayback` (clears on reset), `getAppAudio` (supplies `replaceContext`).

- [ ] **Step 1: The fake.** `FakeAudioContext` gains a `statechange` listener set; `suspend()` and `resume()` fire it after changing `state` (only when it changed); `wedge()` sets `'suspended'` and fires; `recover()` sets `'running'` and fires; `stuck = false` — while true, `resume()` counts the call (`resumed += 1`) and returns a promise that never settles, leaving `state` alone. Existing tests are unaffected (nothing listened before).
- [ ] **Step 2: Write the failing tests** in `graph.test.ts`, a new `describe('createAudioGraph — a wedged context (#246)')` with a `setupRecovering({ replace = true } = {})` helper: the same deps as `setup('device')` plus `clock = createVirtualClock(0)` and, when `replace`, `replaceContext: () => { const next = new FakeAudioContext(); contexts.push(next); return next.asContext(); }` (`contexts` starts `[first]`); the helper returns `first`, `contexts`, `clock`, the graph, the sinks, and `flush = () => new Promise((r) => setTimeout(r, 0))`.
  1. **Rebuilds a context left suspended by something else.** `first.stuck = true; first.wedge(); clock.advance(249)` → `first.resumed === 0`; `clock.advance(1)` → `first.resumed === 1`; `clock.advance(1_500); await flush()` → `first.closed === 1`, `contexts.length === 2`; the real sink's `srcObject` is a stream of `contexts[1].destinations` (not of `first`'s); `graph.timeline('speaker').play(new Int16Array(2400), 0, () => {})` adds a source to `contexts[1].sources`.
  2. **Keeps the routes across a rebuild.** `graph.route([{ from: 'speaker', to: 'real', gain: 1 }])` before the wedge; after the rebuild a speaker clip on `contexts[1]` `reaches` the real sink's destination on `contexts[1]` and not the virtual one.
  3. **Leaves its own rest alone.** `await graph.suspend()` (state `'suspended'`), `clock.advance(10_000)` → `first.resumed === 0`, `contexts.length === 1`.
  4. **A wedge that clears inside the grace is left alone.** `first.wedge(); clock.advance(100); first.recover(); clock.advance(5_000)` → `first.resumed === 0`, no rebuild.
  5. **A resume that lands in time cancels the rebuild.** `first.wedge()` (not stuck), `clock.advance(250)` → resumed once, state `'running'`; `clock.advance(1_500)` → `contexts.length === 1`.
  6. **Tells its listeners once the new context is in, before the old one goes.** `graph.onReset(() => order.push(\`reset:${first.closed}:${contexts.length}:${graph.timeline('speaker').now() === contexts[1].currentTime}\`))` with `first.currentTime = 1_000` and `contexts[1]` still at 0; after a rebuild `order` is `['reset:0:2:true']` — the swap came first, the close after; the returned unsubscribe stops a later call.
  7. **A resume of its own that never lands is a wedge too, and does not hang.** `await graph.suspend(); first.stuck = true; const resumed = graph.resume(); clock.advance(1_500); await resumed; await flush()` → `contexts.length === 2`.
  8. **Gives up after three rebuilds until one runs.** Three times over: set the newest context `stuck`, `wedge()` it, `clock.advance(1_750)`, `await flush()` → `contexts.length === 4`, one `reportWarning` per rebuild with `dedupeKey: 'graph:rebuild'`. A fourth round on `contexts[3]` leaves `contexts.length === 4`. Then `contexts[3].recover()` (state `'running'`) resets the count: one more round rebuilds again (5). (Each wedge comes after the rebuild has settled, so the new context's listener is in place.)
  9. **No `replaceContext`, no watch.** `setupRecovering({ replace: false })` (the same helper, leaving `replaceContext` out of the deps): `first.wedge(); clock.advance(10_000)` → `first.resumed === 0`, `contexts.length === 1`.
  10. `close()` during the grace or the deadline cancels the watch: wedge, `await graph.close()`, `clock.advance(10_000)` → no replacement.
  11. **What was scheduled while the rebuild ran starts on the new clock.** A real `createPlayback(graph, routing)` over the graph (a static `routing` — `{ get: () => ({ meeting: false, monitor: true, participantSpeech: false, passthrough: { on: true, ratio: 1 }, sinks: {} }), subscribe: () => () => {} }` — so speaker clips reach the real bus and passthrough the virtual one; `setup('device')`'s sinks give both). `first.currentTime = 1_000` (the dead context ran a while) and `playback.live(true)` (passthrough plays only during a run); `first.stuck = true; first.wedge(); clock.advance(1_750)` — the rebuild is now awaiting the tap module — then, before `await flush()`: `playback.audio('speaker', 1, pcm)` and `playback.passthrough(pcm)` (both land on `first`). `await flush()`. Then `playback.audio('speaker', 2, pcm)` → the newest source on `contexts[1].sources` has `startedAt < contexts[1].currentTime + LEAD_S + 0.01` (not near 1 000); and `playback.passthrough(pcm)` adds a source to `contexts[1].sources` (not dropped by `MAX_BUFFERED_S`). A wedged context whose `close()` never settles (`first.close = () => new Promise(() => {})`) still lets the rebuild finish: `contexts.length === 2` and a later wedge of `contexts[1]` rebuilds again.
- [ ] **Step 3: Write the failing test** in `playback.test.ts`: `fakeGraph()` gains `const resets = new Set<() => void>()`, `onReset(listener) { resets.add(listener); return () => resets.delete(listener); }` and a `reset()` helper firing the set (Task 2 adds `meter` to the same literal, with the interface member — added here it would be an excess property, TS2353, a twelfth gate line). Case "a context reset drops what was queued but not the clip indices": `playback.audio('speaker', 1, pcm)` → `plays.length === 1`; `reset()` → that play is `done`, `playback.queues.speaker.pending === 0`, `playback.queues.speaker.clears` grew by 1; `playback.audio('speaker', 1, pcm)` → `parseClipKey(queue position key).index === 1` (read through `playback.queues.speaker.position()` after `advance(LEAD_S)`).
- [ ] **Step 4: Run** `npx vitest run src/lib/audio` — the new tests fail.
- [ ] **Step 5: Implement.**
  - `graph.ts`. Move everything built on a context into a local `build(ctx: AudioContext): Built`, called after `await deps.addTapModule(ctx)`:

    ```ts
    interface Built {
      ctx: AudioContext;
      /** Where every tap (and meter) ends so the render graph pulls it; the user never hears it. */
      muted: GainNode;
      feeds: Record<Feed, GainNode>;
      buses: Partial<Record<Bus, GainNode>>;
      /** The stream each output element plays, per bus that has an element. */
      outs: Partial<Record<Bus, MediaStreamAudioDestinationNode>>;
      taps: AudioWorkletNode[];
      analysers: Partial<Record<Bus, AnalyserNode>>;
    }
    ```

    The `<audio>` elements are created once, by the first build (`deps.createSink(out.stream)`); a later build only sets `element.srcObject = out.stream`. `ttsTap` (the `PcmTap`) is created once and every build's tts tap node pushes into it; the `'tabs'` virtual bus's tap sends through the same `virtual.send`. `let current = build(ctx)`; `timeline(feed)`, `playOnce`, `route`, `resume`, `suspend` and `close` read `current` at each call (`now: () => current.ctx.currentTime`), so a queue's timeline follows a rebuild. Today's `route` body becomes a local `applyRoute(next)` over `current`; `route(next)` remembers `lastRoute = next` and calls it, and a rebuild empties the edge map and applies `lastRoute` to the new build. `graph.ts` imports `reportError` beside `reportWarning`, and `realClock` / `Clock` from `../contract/clock`. The watch:

    ```ts
    export const WEDGE_GRACE_MS = 250;
    export const RESUME_DEADLINE_MS = 1_500;
    export const MAX_REBUILDS = 3;

    // Inside createAudioGraph, after the first build:
    const clock = deps.clock ?? realClock;
    const resets = new Set<() => void>();
    /** The graph's own `suspend()` landed and no `resume()` was asked since: this 'suspended' is ours, not a wedge. */
    let resting = false;
    let cancelGrace: (() => void) | null = null;
    let cancelDeadline: (() => void) | null = null;
    let rebuilds = 0;
    let rebuilding: Promise<void> | null = null;

    const clearWatch = () => {
      cancelGrace?.();
      cancelDeadline?.();
      cancelGrace = cancelDeadline = null;
    };
    // #246: a context the renderer wedged — a sink that vanished (Bluetooth,
    // USB) — stays 'suspended'; resume() may never settle and setSinkId can
    // report success on it. The only way back is a new context.
    const armDeadline = () => {
      if (cancelDeadline || !deps.replaceContext) return;
      cancelDeadline = clock.setTimeout(() => {
        cancelDeadline = null;
        if (current.ctx.state !== 'running' && !resting) void rebuild();
      }, RESUME_DEADLINE_MS);
    };
    const onState = () => {
      const { ctx } = current;
      if (ctx.state === 'running') {
        clearWatch();
        rebuilds = 0;
        return;
      }
      if (ctx.state !== 'suspended' || resting || suspending || cancelGrace || cancelDeadline) return;
      cancelGrace = clock.setTimeout(() => {
        cancelGrace = null;
        if (current.ctx.state !== 'suspended' || resting) return;
        current.ctx.resume().catch((error: unknown) => reportWarning('AudioGraph', `The audio context did not resume: ${describeCause(error)}`, { dedupeKey: 'graph:resume' }));
        armDeadline();
      }, WEDGE_GRACE_MS);
    };
    const watch = (ctx: AudioContext) => { if (deps.replaceContext) ctx.addEventListener('statechange', onState); };
    watch(current.ctx);

    const rebuild = (): Promise<void> => {
      rebuilding ??= (async () => {
        if (closing || !deps.replaceContext || rebuilds >= MAX_REBUILDS) return;
        rebuilds += 1;
        clearWatch();
        const old = current;
        old.ctx.removeEventListener('statechange', onState);
        for (const tap of old.taps) tap.port.onmessage = null;
        const ctx = deps.replaceContext();
        try {
          await deps.addTapModule(ctx);
        } catch (error) {
          void ctx.close().catch(() => {});
          reportError('AudioGraph', `The audio output could not be rebuilt: ${describeCause(error)}`, { cause: error });
          return;
        }
        if (closing) {
          // The graph closed while the module loaded.
          void ctx.close().catch(() => {});
          return;
        }
        // Swap first: from here every queue's clock is the new context's.
        current = build(ctx);
        watch(ctx);
        clearWatch(); // a resume() asked while the module loaded armed a deadline on the old context
        edges.clear();
        applyRoute(lastRoute);
        // Then the listeners: the playback clears its queues against the new
        // clock. Whatever it scheduled while the module loaded sat on the dead
        // context — its frozen currentTime became a queue's tail, which would
        // hold every later clip that long and drop every passthrough chunk.
        for (const listener of [...resets]) {
          try { listener(); } catch (error) { reportError('AudioGraph', `A reset listener threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'graph:reset-listener' }); }
        }
        reportWarning('AudioGraph', `The audio output stopped responding and was rebuilt (attempt ${rebuilds} of ${MAX_REBUILDS})`, { dedupeKey: 'graph:rebuild' });
        play('real');
        play('virtual');
        // A wedged context may never settle its close(), as it may never settle
        // resume(): it is abandoned, never awaited, so recovery cannot hang on it.
        void old.ctx.close().catch(() => {});
      })().finally(() => { rebuilding = null; });
      return rebuilding;
    };
    ```

    `suspend()` sets `resting = true` after its `ctx.suspend()` lands; `resume()` sets `resting = false` first and, with `replaceContext`, arms the deadline and races `ctx.resume()` against it so it never hangs its caller:

    ```ts
    async resume() {
      if (suspending) await suspending;
      resting = false;
      const { ctx } = current;
      if (ctx.state === 'suspended') {
        // A resume that never lands is a wedge too (#246); the deadline rebuilds it.
        armDeadline();
        try {
          await (deps.replaceContext
            ? Promise.race([ctx.resume(), new Promise<void>((resolve) => { clock.setTimeout(resolve, RESUME_DEADLINE_MS); })])
            : ctx.resume());
          resumeFailing = false;
        } catch (error) { /* today's once-per-streak warning, unchanged */ }
      }
      play('real');
      play('virtual');
    },
    ```

    `onReset(listener)` adds to `resets` and returns the delete. `close()` also runs `clearWatch()` and removes the listener. `GraphDeps` and `AudioGraph` gain the documented members (JSDoc: "`replaceContext` — builds a fresh context when the current one wedges (#246); absent: no watch", "`onReset` — called once a wedged context has been replaced, before it is closed: whatever was scheduled on it is lost, and the timelines already read the new context's clock").
  - `playback.ts`: after `apply()`, `const unsubscribeReset = graph.onReset(() => { queues.speaker.clear(); queues.participant.clear(); replayQueue.clear(); passthroughStream.clear(); stopPreview(); });` — a comment: "The clips were scheduled on a context that is gone. The indices (`counts`) stay: L1's speech entries go on, so the next clip keeps its place." `dispose()` calls `unsubscribeReset()`.
  - `appAudio.ts` `build()`: `createAudioGraph({ context, replaceContext: () => new AudioContext({ sampleRate: SAMPLE_RATE }), … })`. The test tone: `tone ??= loadTestTone(new OfflineAudioContext(1, 1, SAMPLE_RATE))` in place of `loadTestTone(context)` — the decoded clip is plain samples (`PreviewClip`), but its first decode may come after a rebuild closed `context`, and browsers have differed on decoding on a closed context; an offline context of the same rate decodes to the same samples and is never closed. `appAudio.test.ts` gains a case with `OfflineAudioContext` stubbed (`vi.stubGlobal`, a class recording its constructor arguments whose `decodeAudioData` answers a one-channel buffer) and `fetch` stubbed: `testTone()` decodes on an `OfflineAudioContext` built at `(1, 1, SAMPLE_RATE)`, never on the live context.
- [ ] **Step 6: Run** `npx vitest run src/lib/audio`, then the gates.
- [ ] **Step 7: Commit**

  ```bash
  git add src/lib/audio/graph.ts src/lib/audio/graph.test.ts src/lib/audio/fakeWebAudio.ts src/lib/audio/playback.ts src/lib/audio/playback.test.ts src/lib/audio/appAudio.ts src/lib/audio/appAudio.test.ts
  git commit -m "fix(audio): the graph rebuilds a context that wedged (#246)"
  ```

**Probes:** `spine-audio-probe.mjs` (default) still hears clips and a tap peak; `spine-surface-probe.mjs` (default) still passes (queues play on `current`).

---

### Task 2: Level meters, a meter on each bus, and the probe's tap on a bus

**Files:** Create `src/lib/audio/levelMeter.ts`, `src/lib/audio/levelMeter.test.ts`; Modify `src/lib/audio/graph.ts` (+ test), `src/lib/audio/fakeWebAudio.ts`, `src/lib/audio/playback.ts`, `src/lib/audio/playback.test.ts`, `src/lib/audio/appCapture.ts` (+ test), `src/components/dev/SessionControls.tsx`, `src/components/dev/SessionControls.test.tsx`, `src/components/dev/SpinePreview.tsx`, `src/components/dev/SpinePreview.test.tsx`, `src/app/session.test.ts`, `src/app/useAppSession.test.tsx`, `scripts/dev/spine-audio-probe.mjs`.

**Interfaces:**
- Produces: `LEVEL_BARS = 32`, `LEVEL_STALE_MS = 300`, `LEVEL_GAIN = 4`, `interface LevelMeter { push(pcm: Int16Array): void; read(): Float32Array; reset(): void }`, `createLevelMeter(clock?: Pick<Clock, 'now'>, bars?: number): LevelMeter` (`levelMeter.ts`); `interface BusMeter { read(): Float32Array }`, `AudioGraph.meter(bus: Bus): BusMeter | null`, `Playback.meter(bus: Bus): BusMeter | null`; `AppCapture.levels: Readonly<Record<LegName, LevelMeter>>`.
- Consumed by: Task 11 (`Waveforms`), the preview's probe line.

- [ ] **Step 1: Write the failing tests.**
  - `levelMeter.test.ts` (a virtual clock): a fresh meter reads 32 zeros; one chunk of a full-scale square wave (±32767) makes the newest bar (`read()[31]`) `1` and the others `0`; a chunk of amplitude 4096 (RMS 0.125) reads `0.5` (`LEVEL_GAIN` 4); 33 chunks keep 32 bars, the oldest dropped; `clock.advance(301)` with no chunk → all zeros; a new chunk after that starts again from zeros; `reset()` → zeros. `read()` returns a new array each call (a caller may keep it).
  - `graph.test.ts`: the fake gains `FakeAnalyser extends FakeNode` (`frequencyBinCount = 16`, `fftSize`, `smoothingTimeConstant`, `level = 0`, `getByteFrequencyData(out) { out.fill(Math.round(this.level * 255)); }`) and `FakeAudioContext.createAnalyser()` recording them in `analysers`. Cases: `meter('real')` connects an analyser from the real bus to the destination (the muted path) — a speaker clip routed to real `reaches` the analyser; `meter('virtual')` on `setup('none')` is null; `meter('real')` twice returns the same object and one analyser; `analyser.level = 0.5` → `read()` is 16 values of `128 / 255`; after Task 1's rebuild the same `BusMeter` reads an analyser on the new context (`contexts[1].analysers.length === 1`).
  - `appCapture.test.ts`: `createAppCapture(playback)` has `levels.speaker` and `levels.participant`; a source the capture opened (the test's existing fake open path) delivering a chunk moves `levels.speaker.read()`; after the source's `stop()`, `levels.speaker.read()` is all zeros (reset on cleanup).
- [ ] **Step 2: Run** `npx vitest run src/lib/audio` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `levelMeter.ts` (doc: "One leg's input level for the footer's waveform (plan 1e-3b-1 ruling 3): one bar per delivered chunk, its RMS scaled so speech fills the strip, flat once nothing has arrived for a moment — a muted or ended source delivers nothing."):

    ```ts
    export function createLevelMeter(clock: Pick<Clock, 'now'> = realClock, bars = LEVEL_BARS): LevelMeter {
      let levels = new Float32Array(bars);
      let lastAt = -Infinity;
      return {
        push(pcm) {
          let sum = 0;
          for (let i = 0; i < pcm.length; i++) sum += (pcm[i] / 32768) ** 2;
          const rms = pcm.length > 0 ? Math.sqrt(sum / pcm.length) : 0;
          if (clock.now() - lastAt > LEVEL_STALE_MS) levels = new Float32Array(bars);
          levels.copyWithin(0, 1);
          levels[bars - 1] = Math.min(1, rms * LEVEL_GAIN);
          lastAt = clock.now();
        },
        read: () => (clock.now() - lastAt > LEVEL_STALE_MS ? new Float32Array(bars) : levels.slice()),
        reset() { levels = new Float32Array(bars); lastAt = -Infinity; },
      };
    }
    ```
  - `graph.ts`: `Built.analysers` holds one `AnalyserNode` per bus in a `metered` set; `meter(bus)` returns null when `current.buses[bus]` is absent, else adds `bus` to `metered`, creates the analyser on the current build if missing (`fftSize = 64`, `smoothingTimeConstant = 0.8`, `bus → analyser → muted`), and returns one cached `BusMeter` per bus whose `read()` reads `current.analysers[bus]` (`getByteFrequencyData` into a buffer sized `frequencyBinCount`, divided by 255). `build()` creates analysers for every bus in `metered`, so a rebuild keeps them.
  - `playback.ts`: `meter: (bus) => graph.meter(bus)` (JSDoc: "What a bus carries, for a waveform: the virtual one is what the meeting hears").
  - `appCapture.ts`: `levels = { speaker: createLevelMeter(), participant: createLevelMeter() }`; in `openSource`, `const offLevel = source.onPcm((pcm) => levels[leg].push(pcm));` and the cleanup also runs `offLevel(); levels[leg].reset();`.
  - Mocks that build a graph, a playback or a capture by hand gain the new members so later code can read them: `playback.test.ts`'s `fakeGraph()` (`meter: () => null`, beside Task 1's `onReset`); `session.test.ts` and `useAppSession.test.tsx` (`meter: vi.fn(() => null)` on the playback; `levels` with two `{ push() {}, read: () => new Float32Array(32), reset() {} }` on the capture), and `session.test.ts:140`'s `expect(loaded.capture).toEqual({ openSource, echo })` becomes `toMatchObject({ openSource: expect.any(Function), echo: expect.any(Object), levels: expect.any(Object) })`; `SpinePreview.test.tsx` (the same, on its `getAppAudio` and `createAppCapture` mocks); `SessionControls.test.tsx`'s `fakeAudio()` (`meter: () => null` on its playback, `SessionControls.test.tsx:93-104` — the new interval would call `undefined()` without it).
  - `SessionControls.tsx` `usePlaybackProbe`: also tracks `busPeak` — each interval, the max of `playback.meter('real')?.read()` (0 when null or empty) — and the probe line gains `` ` · bus peak: ${probe.busPeak.toFixed(3)}` `` right after the tap peak, before the capture's part (`SessionControls.tsx:149-150`). `SessionControls.test.tsx`'s three exact strings become `'heard: speaker:2:0 · tap peak: 0.500 · bus peak: 0.000'` (`:151`), `'heard: - · tap peak: 0.000 · bus peak: 0.000 · captured: 3 · mic peak: 0.250'` (`:163`) and `'heard: speaker:2:0 · tap peak: 0.000 · bus peak: 0.000 · captured: 2 · mic peak: 0.100'` (`:181`); add a case whose `meter('real')` reads `Float32Array.of(0.1, 0.4)` → the line reads `bus peak: 0.400`. `SpinePreview.tsx`'s autostart effect: `// &monitor=1: the speaker's translation reaches the real bus (the monitor is off by default), for the probe's tap on a bus.` `if (params.get('monitor') === '1') useAudioStore.getState().setMonitorMuted(false);` (add the import).
  - `spine-audio-probe.mjs`: the default URL becomes `http://localhost:5199/?preview=spine&autostart=1&monitor=1`; it parses `bus peak: ([\d.]+)` and, when the URL has `monitor=1`, also requires it `> 0`; the header comment names the new check ("…and, with `&monitor=1`, a peak on the real bus after the routes — plan 1e-3b-1 ruling 3").
- [ ] **Step 4: Run** `npx vitest run src/lib/audio src/app src/components/dev`, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/audio src/app/session.test.ts src/app/useAppSession.test.tsx src/components/dev scripts/dev/spine-audio-probe.mjs
  git commit -m "feat(audio): level meters per leg, a meter per bus, and the audio probe's tap on a bus"
  ```

**Probes:** `spine-audio-probe.mjs` (the new default, with `&monitor=1`): clips heard, a tap peak, and a bus peak `> 0`; and `'http://localhost:5199/?preview=spine&autostart=1&capture=device&monitor=1'` also captures the fake microphone.

---

### Task 3: The microphone stops capturing first; L1 redacts what a notice says

**Files:** Modify `src/lib/audio/capture/mic.ts`, `src/lib/audio/capture/mic.test.ts`, `src/lib/conversation/Conversation.ts`, `src/lib/conversation/Conversation.test.ts`.

**Interfaces:** none new. `Source.stop()`'s rule ("stops capturing before its first `await`", `source.ts:19`) now holds for the microphone while a device switch is in flight (roadmap 1e-1 → 1e-3); every `Notice.message` L1 records passes `redact()` (roadmap 1e-2 → 1e-3).

- [ ] **Step 1: Write the failing tests.**
  - `mic.test.ts`: the fake's track gains a `stop` that records into the fake's `calls` (`Object.assign(new EventTarget(), { stop: vi.fn(() => calls.push('track.stop')) })`), and the fake stream `getTracks: () => [track]` beside `getAudioTracks`. Case "stops the microphone's track before a switch in flight settles": open, make the next `begin` hang on a deferred, `set({ deviceId: 'mic-2' })` (the switch awaits `close()` then `begin()`), then `const stopping = source.stop()` — synchronously, `track.stop` has been called once; resolve the deferred; `await stopping` → `calls` ends with `quit`. A plain stop with no switch also stops the track first (`'track.stop'` before `'quit'` in `calls`).
  - `Conversation.test.ts`: a `degraded` event whose message is `'upload failed: https://x/y?key=AIzaSyA-secret'` records a notice whose message contains `[REDACTED]` and not `AIzaSyA-secret`; the same for `failed`, for `notice(...)` (the runner's) and for `degraded(code, message)` (a source's). A message with nothing secret is recorded unchanged.
- [ ] **Step 2: Run** `npx vitest run src/lib/audio/capture/mic.test.ts src/lib/conversation` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `mic.ts` `release`, first thing, before `unsubscribe()` and `await chain`:

    ```ts
    // `Source.stop` stops capturing before its first await (roadmap 1e-1): a
    // `pagehide` never awaits this, and a device switch in flight must not keep
    // the microphone open while it settles. `quit()` below still ends the recorder.
    for (const track of recorder.getStream()?.getTracks() ?? []) track.stop();
    ```
  - `Conversation.ts`: `import { redact } from '../diagnostics/redact';` and in the one sink every notice passes through (`addNotice`, `:255`): `this.notices.push({ id: …, at: …, ...input, message: redact(input.message) });` with a comment: "Every notice is shown, exported and auto-saved: worker and provider text is redacted here, once, for every provider (roadmap 1e-2)."
- [ ] **Step 4: Run** the two files, then `npx vitest run src/lib`, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/audio/capture/mic.ts src/lib/audio/capture/mic.test.ts src/lib/conversation/Conversation.ts src/lib/conversation/Conversation.test.ts
  git commit -m "fix(capture): the microphone stops capturing first; L1 redacts what a notice says"
  ```

**Probes:** `spine-audio-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&capture=device&monitor=1'` still captures the fake microphone; `spine-surface-probe.mjs '…&script=notices'` still shows the notice in its words.

---

### Task 4: Words — language names, a Settings section per code, four new sentences

**Files:** Create `src/lib/view/noticeTargets.ts`, `src/lib/view/noticeTargets.test.ts`; Modify `src/lib/view/noticeText.ts`, `src/lib/view/noticeText.test.ts`, the 30 `src/locales/<code>/translation.json`.

**Interfaces:**
- Produces: `NOTICE_TARGETS`, `settingsTargetForCode(code: string | undefined): string | null` (`noticeTargets.ts`); locale keys `mainPanel.replayBlockedWholeSystem`, `audioPanel.participantSpeech`, `audioPanel.participantSpeechDesc`, `audioPanel.participantSpeechBlockedWholeSystem`.
- Consumed by: Task 7 (the subtitle idle), Task 8/12 (the notice action), Task 12 (the replay tooltip), plan 1e-3b-2 (the participant speech switch, and its tooltip while Other's source captures the whole system).

- [ ] **Step 1: Write the failing tests.**
  - `noticeText.test.ts` (its `t` mock interpolates): `noticeText(t, { code: 'no_asr', params: { source: 'en' }, message: 'x' })` → `'No speech recognition model is installed for English.'`; `params: { source: 'ja' }` → `…for 日本語.`; an unknown code `'xx'` stays `xx`; a `params.detail`-style non-language param is passed through unchanged.
  - `noticeTargets.test.ts`: `settingsTargetForCode('no_microphone')` → `'microphone'`; `'local_models_missing'`, `'no_asr'`, `'credentials_missing'`, `'no_provider'`, `'memory_exceeded'`, `'gpu_out_of_memory'` → `'provider'`; `'turn_mode_unsupported'` → `'turn-detection'`; `'participant_unsupported'` → `'languages'`; `'start_failed'`, `'loopback_denied'`, `undefined` → `null`; every key of `NOTICE_TARGETS` has words in `NOTICE_WORDS` (an action never sits beside an unworded notice).
  - The locale lockstep test (`src/locales/locales.consistency.test.ts`) already fails until all 30 catalogs carry the four keys; add to `noticeText.test.ts`: the four keys exist in `en` with the English below, word for word.
- [ ] **Step 2: Run** `npx vitest run src/lib/view src/locales` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `noticeText.ts`:

    ```ts
    import { getLanguageOption } from '../../utils/languages';

    /** Params that carry a language code: shown by the name every language menu uses (`no_asr`'s `{{source}}`, roadmap 1e-2 → 1e-3). */
    const LANGUAGE_PARAMS = new Set(['source', 'target']);

    function named(params: Record<string, string | number> | undefined): Record<string, string | number> | undefined {
      if (!params) return params;
      return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, LANGUAGE_PARAMS.has(key) && typeof value === 'string' ? getLanguageOption(value).name : value]));
    }
    ```

    and `noticeText` spreads `...named(notice.params)`.
  - `noticeTargets.ts` (doc: "The Settings section a notice's code asks the user to visit — `reasonToSettingsTarget`'s successor (spec: \"Notices reach the user localized\"). A target is `navigateToSettings`'s: the section's element id without `-section`."):

    ```ts
    export const NOTICE_TARGETS: Readonly<Record<string, string>> = {
      no_microphone: 'microphone',
      no_provider: 'provider',
      credentials_missing: 'provider',
      local_models_missing: 'provider',
      no_asr: 'provider',
      memory_exceeded: 'provider',
      gpu_out_of_memory: 'provider',
      turn_mode_unsupported: 'turn-detection',
      participant_unsupported: 'languages',
    };

    export function settingsTargetForCode(code: string | undefined): string | null {
      return code === undefined ? null : NOTICE_TARGETS[code] ?? null;
    }
    ```

    (`'provider'` because LocalInference's chips and readiness reason sit in the provider section, `id="provider-section"`; `'turn-detection'` is the global turn mode's section, placed on the General tab by plan 1e-3b-2.)
  - The locales, English: `mainPanel.replayBlockedWholeSystem` = `"Replay is off while Other's audio captures all system sound: it would be translated again."`; `audioPanel.participantSpeech` = `"Speak Other's translation"`; `audioPanel.participantSpeechDesc` = `"Reads what Other says aloud to you, in your language, on your speakers. It follows their voice with a delay."`; `audioPanel.participantSpeechBlockedWholeSystem` = `"Off while Other's audio captures all system sound: their translation would be captured and translated again. Pick an application as Other's source."`. Run once from the worktree root, with `WORDS` filled in for all 30 locales (the implementing model writes the 29 translations, per Global Constraints; en as above):

    ```bash
    node --input-type=module -e '
    import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
    const WORDS = { /* "<code>": { replay: "…", speech: "…", speechDesc: "…", speechBlocked: "…" }, one per locale */ };
    const insertAfter = (lines, anchor, added, file) => {
      const hits = lines.flatMap((line, i) => (line.startsWith(anchor) ? [i] : []));
      if (hits.length !== 1 || !lines[hits[0]].endsWith(",")) throw new Error(`${file}: the anchor ${anchor} moved`);
      lines.splice(hits[0] + 1, 0, ...added.map((l) => `${l},`));
    };
    for (const code of readdirSync("src/locales")) {
      const file = `src/locales/${code}/translation.json`;
      if (!existsSync(file)) continue;
      const w = WORDS[code];
      if (!w) throw new Error(`${file}: no words`);
      const lines = readFileSync(file, "utf8").split("\n");
      insertAfter(lines, "    \"playItemAudio\": ", [`    "replayBlockedWholeSystem": ${JSON.stringify(w.replay)}`], file);
      insertAfter(lines, "    \"participantNoAudioYet\": ", [`    "participantSpeech": ${JSON.stringify(w.speech)}`, `    "participantSpeechDesc": ${JSON.stringify(w.speechDesc)}`, `    "participantSpeechBlockedWholeSystem": ${JSON.stringify(w.speechBlocked)}`], file);
      JSON.parse(lines.join("\n"));
      writeFileSync(file, lines.join("\n"));
    }'
    ```

    Then `git diff --stat src/locales` shows 30 files, each +4. (Both anchors occur once per locale and are never the last key of their object — checked at this plan's start.)
- [ ] **Step 4: Run** `npx vitest run src/lib/view src/locales`, then the gates.
- [ ] **Step 5: Commit** (the body lists the 29 translations of each key, for the spot-check)

  ```bash
  git add src/lib/view/noticeText.ts src/lib/view/noticeText.test.ts src/lib/view/noticeTargets.ts src/lib/view/noticeTargets.test.ts src/locales
  git commit -m "feat(view): languages by name in a notice, a Settings section per code, four new sentences"
  ```

**Probes:** none — nothing the preview draws uses them yet.

---

### Task 5: The root's page wiring — the run phase, the close, the lock, a source's end

**Files:** Create `src/app/runPhase.ts`, `src/app/runPhase.test.ts`, `src/app/useRun.ts`, `src/app/useRun.test.tsx`, `src/app/AppSessionRoot.tsx`, `src/app/AppSessionRoot.test.tsx`, `src/app/closeBound.test.ts`; Modify `src/app/session.ts`, `src/app/session.test.ts`, `src/app/useAppSession.ts`, `src/lib/session/runner.ts`, `src/lib/analytics.ts`, `src/stores/providerStore.ts`, `src/stores/providerStore.test.ts` (its `stored` / `setSetting` fixture), `electron/close-handshake.js`.

**Interfaces:**
- Produces: `registerRunPhase(reader)`, `currentRunPhase()` (`runPhase.ts`); `useRunState()`, `useRunPhase()`, `useSessionLocked(): boolean` (`useRun.ts`; `useAppSession.ts` re-exports the first two); `AppSessionRoot(): null`; `export const DEFAULT_CLOSE_TIMEOUT_MS` (`runner.ts`); `session_control_clicked.method: 'button' | 'keyboard' | 'window'` (`analytics.ts`); `ProviderStore.selectionLocked: boolean`, `setSelectionLocked(locked: boolean): void`; `AppSessionOptions.ipc?: { invoke(channel, data?): Promise<unknown>; receive?(channel: string, fn: (...args: unknown[]) => void): void; removeListener?(channel: string, fn: (...args: unknown[]) => void): void } | null`; Electron `DEFAULT_TIMEOUT_MS = 16000`.
- Consumed by: Task 6 (`select` with `'load'` / `'pick'` — added there), Tasks 7–12 (the hooks), plan 1e-3b-2 (`AppSessionRoot`, `currentRunPhase`, `useSessionLocked`).

- [ ] **Step 1: Write the failing tests.**
  - `runPhase.test.ts`: before anything registers, `currentRunPhase()` is `'idle'`; after `registerRunPhase(() => 'running')` it is `'running'`. And, in `session.test.ts`'s "one per page" case: after `m.getAppSession()` and a start, `currentRunPhase()` (imported from the fresh module graph) is `'running'`.
  - `useRun.test.tsx` (the mocks of `useAppSession.test.tsx`): `useSessionLocked()` is false idle, true while `starting` (a fake start with `startDelayMs`), `running` and `stopping`, false again once idle.
  - `session.test.ts`, the "one per page" case and the `describe('attach')` block gain:
    1. **Every event of a run names its id, and the next run its own** (replaces `sessionIdLifecycle.consistency.test.ts`, spec "Migration"): `newSessionId` answers `'run1'` then `'run2'`; `useTurnModeStore.setState({ turnMode: 'push-to-talk' })`; start; `runner.press()`; `clock.advance(1_000)`; `runner.release()`; `runner.sendText('hi')`; stop; start; stop. The `track` calls carrying a `session_id` are, in order, `translation_session_start`/`run1`, `push_to_talk_used`/`run1`, `text_input_sent`/`run1`, `translation_session_end`/`run1`, `translation_session_start`/`run2`, `translation_session_end`/`run2`.
    2. **Answers a close request after the run's save** (replaces `sessionEndAutoSave.wiring.test.ts`'s close-hold ordering): an `ipc` whose `receive` records handlers by channel and whose `invoke` records calls; `setup({ ipc })`, attach, start; `autoSaveConversation` held on a deferred; call the `app:close-requested` handler; flush → `invoke` has not seen `'app:close-ready'`; resolve the save; await the handler → `invoke` saw `'app:close-ready'` once, after the save resolved (one `order` array), and the phase is `idle`.
    3. **Answers at once when nothing runs**: idle, handler → `'app:close-ready'`.
    4. **A close is not a Stop button press**: during 2, `track` got `session_control_clicked` `{ action: 'stop', method: 'window' }`.
    5. **Detach stops listening**: `removeListener` was called with `'app:close-requested'` and the handler `receive` got.
    6. **A source that ends is an audio error**: `setup({ capture: () => async () => (source = createFakeSource(clock)) })`, attach, start, `source.end('unplugged')`, settle → `track` got `audio_error` `{ error_type: 'device_access', error_message: 'The speaker capture ended: unplugged', device_info: 'speaker' }` (the run's own notice message, `run.ts:355-356`). A stop that ends normally sends none.
    7. **The provider stays put during a run**: attach; start (running) → `useProviderStore.getState().select('localInference')` leaves `selected` `'fake'` and reports one warning (`dedupeKey: 'select:locked'`); stop, settle → `select('localInference')` changes it.
  - `providerStore.test.ts`: `setSelectionLocked(true)` → `select('x')` changes nothing; `setSelectionLocked(false)` → it does.
  - `AppSessionRoot.test.tsx` (mocks as `useAppSession.test.tsx`, plus `vi.mock('../contexts/UserProfileContext', () => ({ useUserProfile: () => ({ refetchAll }) }))`): rendering it calls `getAppSession().attach` once (spy on the session's `attach`); a run's end calls `refetchAll` once; unmounting detaches (a later `pagehide` leaves a new run running).
  - `closeBound.test.ts`:

    ```ts
    import { createRequire } from 'node:module';
    import { describe, expect, it } from 'vitest';
    import { DEFAULT_CLOSE_TIMEOUT_MS } from '../lib/session/runner';

    const { DEFAULT_TIMEOUT_MS } = createRequire(import.meta.url)('../../electron/close-handshake.js');

    describe("Electron's close wait", () => {
      it("outlasts the runner's own ending bound by one second (1e-3 ruling 12)", () => {
        expect(DEFAULT_TIMEOUT_MS).toBe(DEFAULT_CLOSE_TIMEOUT_MS + 1_000);
      });
    });
    ```
- [ ] **Step 2: Run** `npx vitest run src/app src/stores/providerStore*` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `runPhase.ts`:

    ```ts
    /**
     * The page's run phase for code that must not import the session's module
     * graph — `settingsStore.enterSubtitleMode`: the root imports the stores, so
     * a static import back would close a cycle (roadmap 1e-3a). `getAppSession()`
     * registers the reader when it builds the page's session; until then the
     * phase is idle, since no run can exist yet (plan 1e-3b-1 ruling 5).
     */
    import type { RunState } from '../lib/session/types';

    let read: () => RunState['phase'] = () => 'idle';

    export function registerRunPhase(reader: () => RunState['phase']): void {
      read = reader;
    }

    export function currentRunPhase(): RunState['phase'] {
      return read();
    }
    ```

    `getAppSession()`: after `session ??= createAppSession(configured)`, `registerRunPhase(() => session!.runner.state.getState().phase)` on the building call only.
  - `useRun.ts`: `useRunState` and `useRunPhase` move here from `useAppSession.ts` unchanged, plus

    ```ts
    /** The settings "What may change during a run" does not list are locked while the phase is not idle — through starting and stopping too (1e-3 ruling 9). */
    export function useSessionLocked(): boolean {
      return useRunPhase() !== 'idle';
    }
    ```

    `useAppSession.ts`: `export { useRunState, useRunPhase } from './useRun';` in place of its two definitions; its doc names `useRun.ts`.
  - `runner.ts`: `export const DEFAULT_CLOSE_TIMEOUT_MS = 15_000;`. `analytics.ts`: `method: 'button' | 'keyboard' | 'window';` with a comment "`window`: the Electron window closing, or an update installing, ended the run".
  - `providerStore.ts`: `selectionLocked: false`, `setSelectionLocked(locked) { set({ selectionLocked: locked }); }`, and `select` first:

    ```ts
    if (get().selectionLocked) {
      // Spec, "What may change during a run": the provider is fixed while the phase is not idle.
      reportWarning('ProviderStore', `The provider cannot change during a session; "${id}" was not selected.`, { dedupeKey: 'select:locked' });
      return;
    }
    ```
  - `session.ts` `attach()`, beside the existing wiring:

    ```ts
    // The store's own guard on the provider (plan 1e-3b-1 ruling 7).
    const lock = () => useProviderStore.getState().setSelectionLocked(runner.state.getState().phase !== 'idle');
    lock();
    offs.push(runner.state.subscribe(lock), () => useProviderStore.getState().setSelectionLocked(false));
    // A source that ended the run (a device unplugged, a switch that failed): today's `audio_error` (ruling 10).
    offs.push(runner.state.subscribe((now, before) => {
      if (now.phase !== 'idle' || before.phase === 'idle' || now.lastEnd?.reason !== 'source-ended' || !now.lastEnd.notice) return;
      bridges.track('audio_error', { error_type: 'device_access', error_message: redact(now.lastEnd.notice.message), device_info: now.lastEnd.notice.leg });
    }));
    ```

    and, inside `if (ipc)`, after the busy tracker:

    ```ts
    if (ipc.receive) {
      // Electron's window close and update install (one channel): end the run,
      // wait out what outlives its bound, then let the close through. Never
      // `abandon()` here — `settled()` no longer waits for an abandoned unwind
      // (roadmap 1e-1). The main process waits the runner's bound + 1 s.
      const onCloseRequested = async () => {
        try {
          await runner.stop('window');
          await runner.settled();
        } finally {
          void ipc.invoke('app:close-ready').catch((error: unknown) =>
            reportWarning('AppSession', `Answering the close request failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'session:close-ready' }));
        }
      };
      ipc.receive('app:close-requested', onCloseRequested);
      offs.push(() => ipc.removeListener?.('app:close-requested', onCloseRequested));
    }
    ```

    (`redact` from `../lib/diagnostics/redact`.) `AppSessionOptions.ipc`'s type gains the two optional members; the default stays `window.electron` in Electron.
  - `AppSessionRoot.tsx`:

    ```tsx
    /**
     * The one owner of the app session's page wiring (roadmap 1e-3a: one owner
     * each for `attach()` and the bridges): sign-in, analytics, toasts and the
     * balance refetch handed to the root, and `attach()` for the page's
     * lifetime. Mounted once, inside `UserProfileProvider`, by plan 1e-3b-2's
     * switch; the development preview is its own owner.
     */
    import { useEffect } from 'react';
    import { useUserProfile } from '../contexts/UserProfileContext';
    import { getAppSession } from './session';
    import { useAppSessionBridges } from './useAppSession';

    export function AppSessionRoot(): null {
      const { refetchAll } = useUserProfile();
      // Today's MainPanel refetched the whole profile after a session (`refetchAll`).
      useAppSessionBridges(refetchAll);
      useEffect(() => getAppSession().attach(), []);
      return null;
    }
    ```
  - `electron/close-handshake.js`: `const DEFAULT_TIMEOUT_MS = 16000;` with the comment: "The renderer's runner bounds its own ending at 15 s (`DEFAULT_CLOSE_TIMEOUT_MS`, src/lib/session/runner.ts) and answers after it settles; one second more, so a slow auto-save still lands before the close (1e-3 ruling 12, pinned by src/app/closeBound.test.ts)." Its file header's "or after a timeout" sentence stays true.
- [ ] **Step 4: Run** `npx vitest run src/app src/stores src/lib/session` and `npx vitest run electron/close-handshake.test.js electron/closeHandshake.wiring.test.js`, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/app src/lib/session/runner.ts src/lib/analytics.ts src/stores/providerStore.ts src/stores/providerStore*.test.ts electron/close-handshake.js
  git commit -m "feat(app): the run phase outside React, the close answered on settled(), the provider held during a run"
  ```

**Probes:** every `spine-*` probe still passes (the preview attaches, and the lock follows its runs). The controller also opens `http://localhost:5199/` once: the running app loads as before, with no `AppSession` warning.

---

### Task 6: The stored provider and turn mode, applied

**Files:** Modify `src/stores/providerStore.ts` (+ `providerStore.test.ts`), `src/app/loadStores.ts`, `src/app/loadStores.test.ts`, `src/components/providers/ProviderPanel.tsx` (+ test), `src/components/dev/SpinePreview.tsx`.

**Interfaces:**
- Produces: `ProviderStore.select(id: string, how?: 'load' | 'pick'): void` (default `'load'`); `loadSelectedProvider(service: Pick<ISettingsService, 'getSetting'>, offered: readonly AnyProvider[]): Promise<void>`, `loadTurnMode(service): Promise<void>` (`loadStores.ts`).
- Consumed by: plan 1e-3b-2 (the Settings picker picks with `'pick'`; the SetupWizard's offline path).

- [ ] **Step 1: Write the failing tests.**
  - `providerStore.test.ts` (its `stored` / `setSetting` fixture): `select('localInference', 'pick')` writes `settings.common.provider` = `'local_inference'`; `select('fake', 'pick')` writes `'fake'`; `select('localInference')` and `select('localInference', 'load')` write nothing; a locked `select(…, 'pick')` writes nothing.
  - `loadStores.test.ts` (its existing fixture). The first existing case (`loadStores.test.ts:51-65`, "loads … the first offered provider — writing nothing") asserts `selected` stays `null`; it now expects `selected === 'localInference'` (the first offered, selected in memory — a load) and still no `setSetting` call (it stores `settings.common.turnMode`, so no migration write), retitled "loads the turn mode, the routing switches, the punctuation pack, and selects the first offered provider in memory — writing nothing". The per-load warning's label for the provider becomes `selected provider` (was `${provider.id} settings`, unknown before the stored value is read; no case asserts it). The third existing case (a rejecting turn-mode load) stubs `loadTurnMode`'s read instead, per case 8 below. Then the new cases:
    1. Stored `settings.common.provider = 'local_inference'`, nothing selected → after `loadSessionStores()`, `selected === 'localInference'`, its entry loaded, `setSetting` never called with `settings.common.provider`.
    2. Stored `'openai'` (not offered) → `selected === 'localInference'` (the first offered), and `settings.common.provider` is never written — Stage 2 finds `'openai'` (1e-3 ruling 2).
    3. A page that selected first wins: `useProviderStore.setState({ selected: 'fake' })` before the call → `selected` stays `'fake'` and the fake's entry is loaded.
    4. Stored `'fake'` in a development build → `selected === 'fake'`.
    5. Turn mode never migrated: stored provider `'openai'`, `settings.openai.turnDetectionMode = 'Push-to-Talk'`, no `settings.common.turnMode` → the store's `turnMode` is `'push-to-talk'` and `setSetting('settings.common.turnMode', 'push-to-talk')` was called once.
    6. Already migrated: `settings.common.turnMode = 'push-to-translate'`, the slice says `'Push-to-Talk'` → `'push-to-translate'`, nothing written.
    7. A stored provider with no slice (`'fake'`), nothing migrated → `'auto'`, written once.
    8. The existing "a turn-mode load that rejects is reported once and the rest still load" case now stubs `ServiceFactory`'s `getSetting` to reject for `settings.common.turnMode`.
  - `ProviderPanel.test.tsx`: choosing a provider in the select persists it — with two providers (`fakeProvider` and `{ ...fakeProvider, id: 'second' }`), `fireEvent.change(select, { target: { value: 'second' } })` → `setSetting('settings.common.provider', 'second')`; the panel's own mount selection writes nothing.
- [ ] **Step 2: Run** `npx vitest run src/app/loadStores.test.ts src/stores src/components/providers` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `providerStore.ts` `select(id, how = 'load')`: after the lock guard, `set({ selected: id })`, then `const value = selectionToPersist(id, how); if (value !== null) void persistSetting('settings.common.provider', value);`. The `selected` JSDoc: "The provider the panel shows and a run starts. A person's pick persists (old enum spelling, `storedSettings.ts`); a load never writes (1e-3 ruling 2)."
  - `loadStores.ts`: the `'turn mode'` entry becomes `() => loadTurnMode(service)` and the provider entry `['selected provider', () => loadSelectedProvider(service, offered)]`, always pushed (with `const service = ServiceFactory.getSettingsService()`; the old `offered.find(…) ?? offered[0]` line goes, `loadSelectedProvider` decides):

    ```ts
    /** The stored provider, selected in memory — a load never writes, and a value this build does not offer stays stored for Stage 2 (1e-3 ruling 2). A selection the page already made wins. Its entry loads with it. */
    export async function loadSelectedProvider(service: Pick<ISettingsService, 'getSetting'>, offered: readonly AnyProvider[]): Promise<void> {
      const { selected } = useProviderStore.getState();
      const id = selected !== null && offered.some((p) => p.id === selected)
        ? selected
        : selectionFromStored(await service.getSetting('settings.common.provider', ''), offered.map((p) => p.id))?.id;
      const provider = offered.find((p) => p.id === id);
      if (!provider) return;
      if (useProviderStore.getState().selected !== provider.id) useProviderStore.getState().select(provider.id, 'load');
      await useProviderStore.getState().load(provider);
    }

    /** The global turn mode, migrated once from the stored provider's slice (1e-3 ruling 3); written only by that migration. */
    export async function loadTurnMode(service: Pick<ISettingsService, 'getSetting'>): Promise<void> {
      const [common, storedProvider] = await Promise.all([
        service.getSetting('settings.common.turnMode', ''),
        service.getSetting('settings.common.provider', ''),
      ]);
      const key = legacyTurnModeKey(storedProvider);
      const legacy = key ? await service.getSetting(key, '') : undefined;
      const { turnMode, write } = migrateTurnMode(common, legacy);
      if (write) useTurnModeStore.getState().setTurnMode(turnMode);
      else useTurnModeStore.setState({ turnMode });
    }
    ```

    The module doc's last sentence becomes: "The stored selection is applied in memory, and the turn mode migrated once — its one write, a key the old path never reads (plan 1e-3b-1 ruling 9)."
  - `ProviderPanel.tsx`: the select's `onChange` calls `select(e.target.value, 'pick')`; its mount effect stays `select(provider.id)` (a load).
  - `SpinePreview.tsx`: its two `select(…)` calls stay loads (no change needed; add a comment "a load: the preview never writes the app's stored provider").
- [ ] **Step 4: Run** the same set, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/stores/providerStore.ts src/stores/providerStore*.test.ts src/app/loadStores.ts src/app/loadStores.test.ts src/components/providers/ProviderPanel.tsx src/components/providers/ProviderPanel.test.tsx src/components/dev/SpinePreview.tsx
  git commit -m "feat(session): the stored provider and turn mode applied at load; a pick persists"
  ```

**Probes:** every `spine-*` probe still passes (the preview's selections are loads). The controller opens `http://localhost:5199/` once and confirms the app loads as before.

---

### Task 7: The subtitle side — legs from intent, Start after load, a deep link per code, the takeover

**Files:** Create `src/components/Subtitle/SubtitleTakeover.tsx`, `src/components/Subtitle/SubtitleTakeover.test.tsx`; Modify `src/lib/subtitle/session.ts` (+ test), `src/lib/subtitle/appSession.ts` (+ test), `src/components/Subtitle/subtitleIdleState.ts`, `src/components/Subtitle/SubtitleIdle.tsx` (+ test), `src/components/Subtitle/SubtitleView.tsx` (+ test), `src/components/dev/SpinePreview.tsx` (+ test).

**Interfaces:**
- Produces: `SubtitleSessionInput.providerLoaded?: boolean` (default true); the idle state's `unready` gains `target?: string | null`; `SubtitleIdle`'s `onOpenSettings?(target: string): void`; `SubtitleControls.openSettings?(target: string): void`; `SubtitleTakeover(): JSX.Element`.
- Consumed by: plan 1e-3b-2 (`MainLayout` mounts `SubtitleTakeover`), Task 12 (the panel's Start gate reads the same `canStart`).

- [ ] **Step 1: Write the failing tests.**
  - `session.test.ts` (subtitle): `subtitleSession({ …idle…, providerLoaded: false })` → `canStart: false`, `idle` `{ kind: 'ready' }`; absent → the existing cases.
  - `appSession.test.ts`: `providerLoaded` is read on every `read()`, so the file's `setup()` now seeds a loaded provider unless a case says otherwise — `useProviderStore.setState({ selected: 'fake', entries: { fake: { settings: {}, credentials: {}, pair: { source: 'en', target: 'ja' } } } })` before building the session (and a `{ provider: false }` option that skips it). Without it the three microphone-gate cases (`appSession.test.ts:69-77, 80-85`) that expect `canStart: true` fail; the fix is the seed, never a `providerLoaded` default of true in `appSession.ts`. The first case keeps its own `setState` (it sets readiness). New cases: idle, `useAudioStore` mode `'both'`, an empty view → `legs` `['speaker', 'participant']`; mode `'participant'` with a view holding a speaker leg → `['speaker', 'participant']`; mode `'speaker'` with an empty view → `['speaker']`. `setup({ provider: false })` with `selected: 'fake'` and no entry → `canStart: false`; after `useProviderStore.getState().load(fakeProvider)` → the listener fires and `canStart` is true.
  - `SubtitleIdle.test.tsx`: `state={{ kind: 'unready', message: 'Configure devices for this mode to start.', target: 'microphone' }}` with `onOpenSettings` → the fix button is enabled and a click calls it with `'microphone'`; `target: null` (or no handler) → disabled (the existing case).
  - `SubtitleView.test.tsx`: `idle: { kind: 'unready', message: 'm', code: 'no_microphone' }` and `controls.openSettings` spy → clicking `.subtitle-idle__action--fix` calls it with `'microphone'`; `code: 'start_failed'` has no target → disabled.
  - `SubtitleTakeover.test.tsx` — mocks: `ServiceFactory` (as `session.test.ts`), `../../lib/audio/appAudio`, `../../lib/audio/appCapture`, `../../lib/segmentation/PunctuationRuntime` (as `session.test.ts`), `./SubtitleView` → `SubtitleView: (props) => { captured.push(props); return null; }`, `../../stores/settingsStore` partially (`useExitSubtitleMode: () => exit`, `useNavigateToSettings: () => navigate`, spies), `react-i18next` (key-returning `t`). Before render: `configureAppSession({ clock, newSessionId: () => 'r1', capture: () => async () => createFakeSource(clock), microphoneRequired: () => false })`, load and select the fake. Cases: the last props have `surface: 'electron'`, an `exporter`, and `model.session` equal to `getAppSession().subtitle.get()`; `controls.start()` leaves the runner's phase non-idle (await it, then `stop`); `controls.clear()` empties `getAppSession().runner.conversation`; `controls.exit()` calls `exit` once; `controls.openSettings('provider')` calls `exit` and then `navigate('provider')` (order array).
  - `SpinePreview.test.tsx`: its existing "draws the subtitle view on the page with &subtitle=1" case (`.spine-subtitle .subtitle-app`, `SpinePreview.test.tsx:110-120`) keeps passing over `SubtitleTakeover`; add that the takeover's Start (`SubtitleIdle`'s start action) drives `getAppSession().runner` (its phase leaves idle).
- [ ] **Step 2: Run** `npx vitest run src/lib/subtitle src/components/Subtitle src/components/dev` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `subtitle/session.ts`: `SubtitleSessionInput` gains `/** The selected provider's entry has loaded: until then a start would be refused as no provider (plan 1e-3b-1 ruling 11). Default true. */ providerLoaded?: boolean`; `canStart` adds `&& providerLoaded`.
  - `appSession.ts` `read()`: `providerLoaded: !!(id && providers.entries[id])`, and

    ```ts
    // The display-mode buttons follow the audio mode's intent as well as the
    // conversation on screen: before the first run, and after the mode
    // changed (roadmap 1d-2 → 1e; today's `effectiveMode || items` rule).
    const intent = legsFor(audio.mode);
    const shown = view.get().legs.map((leg) => leg.leg);
    // …
    legs: (['speaker', 'participant'] as const).filter((leg) => intent.includes(leg) || shown.includes(leg)),
    ```
  - `subtitleIdleState.ts`: `| { kind: 'unready'; message: string; /** Where Settings fixes it (`settingsTargetForCode`); null or absent: nowhere. */ target?: string | null }`.
  - `SubtitleIdle.tsx`: `Props.onOpenSettings?: (target: string) => void`; the `unready` button: `disabled={!state.target || !onOpenSettings}`, `onClick={() => { if (state.target) onOpenSettings?.(state.target); }}`; its comment says the target comes from the readiness code (plan 1e-3b-1 ruling 13).
  - `SubtitleView.tsx`: `SubtitleControls.openSettings?(target: string): void` ("Leaves subtitle mode and opens a Settings section — the Electron takeover; the overlay has no Settings to open"); `idleState` returns `{ kind: 'unready', message: noticeText(t, idle), target: settingsTargetForCode(idle.code) }`; `<SubtitleIdle … onOpenSettings={controls.openSettings} />`. The comment above `legs` loses "plan 1e will feed that intent…" and says the session's legs already carry it.
  - `SubtitleTakeover.tsx`:

    ```tsx
    /**
     * The Electron subtitle takeover over the app's session (roadmap 1d-2 → 1e):
     * the root's view, karaoke and subtitle session, the runner's controls, and
     * the conversation's export. `MainLayout` mounts it in place of the main
     * layout while subtitle mode is on (plan 1e-3b-2); MainPanel stays mounted
     * behind it, so the Space key keeps working.
     */
    export function SubtitleTakeover() {
      const session = getAppSession();
      const viewState = useReadable(session.view);
      const { lit } = useReadable(session.karaoke);
      const sessionState = useReadable(session.subtitle);
      const exporter = useConversationExporter(viewState);
      const exitSubtitleMode = useExitSubtitleMode();
      const navigateToSettings = useNavigateToSettings();
      const controls = useMemo<SubtitleControls>(() => ({
        start: () => void session.runner.start(),
        stop: () => void session.runner.stop(),
        press: () => session.runner.press(),
        release: () => session.runner.release(),
        clear: () => session.runner.clear(),
        exit: () => void exitSubtitleMode(),
        // Leave subtitle mode first, so the main window is back before Settings scrolls (today's `handleFix`).
        openSettings: (target) => {
          void exitSubtitleMode();
          navigateToSettings(target);
        },
      }), [session, exitSubtitleMode, navigateToSettings]);
      return <SubtitleView surface="electron" model={{ entries: viewState.entries, lit, session: sessionState }} controls={controls} exporter={exporter} />;
    }
    ```
  - `SpinePreview.tsx`: `&subtitle=1` renders `<div className="spine-subtitle"><SubtitleTakeover /></div>`; `PreviewSubtitle` is deleted, and `subtitleControls` stays for the overlay frame only.
- [ ] **Step 4: Run** the same set, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/subtitle src/components/Subtitle src/components/dev/SpinePreview.tsx src/components/dev/SpinePreview.test.tsx
  git commit -m "feat(subtitle): the takeover over the app session, legs from intent, and a deep link per code"
  ```

**Group check (controller, after this commit — the first of two):** against a fresh vite:
- `spine-surface-probe.mjs` (default; `'…&script=cjk&cut=sentences:1'`; `'…&script=notices'`), `spine-export-probe.mjs`, `spine-local-probe.mjs` (default and `--sentences`) pass to their headers' criteria.
- `spine-subtitle-probe.mjs` (default; `…&turn=push-to-talk`; `…&turn=push-to-translate`) passes — the Electron-style surface it reads is now `SubtitleTakeover`, the component `MainLayout` will mount.
- `spine-audio-probe.mjs` (default, which now includes `&monitor=1`) hears clips, a tap peak and a bus peak.
- `http://localhost:5199/` loads the running app as before, without an `AppSession` or `ProviderStore` warning.

---

### Task 8: The list — reused items, memoized rows, the replay gate's tooltip, a notice's action

**Files:** Modify `src/lib/projection/project.ts`, `src/lib/view/filter.ts`, `src/lib/view/filter.test.ts`, `src/components/Conversation/ConversationList.tsx`, `src/components/Conversation/ConversationList.test.tsx`, `src/components/MainPanel/MainPanel.scss`; Create `src/components/Conversation/ConversationList.memo.test.tsx`.

**Interfaces:**
- Produces: `export function sameRow(a: Row, b: Row): boolean` (`project.ts`; `sameRows` uses it); `displayItems(entries, filters, previous?: readonly DisplayItem[])`; `ConversationListProps.replayBlocked?: string | null`, `ConversationListProps.noticeAction?(notice: NoticeEntry): NoticeAction | null`, `interface NoticeAction { label: string; run(): void }`.
- Consumed by: Task 12.

- [ ] **Step 1: Write the failing tests.**
  - `filter.test.ts`: `displayItems(entries, filters, previous)` returns the previous item object for a row whose value, header, end flag, time, leg and languages are unchanged, even when the entry object is new (its segment grew elsewhere); a new object when the row's `text` changed, when `header` flipped (a leg change above), or when `endsSegment` flipped; a notice item is reused while its entry is the same object; `displayItems(entries, filters)` without `previous` behaves as today (the existing cases).
  - `ConversationList.memo.test.tsx`: `vi.mock('react-i18next', () => ({ useTranslation: () => { renders(); return { t: (k: string, d?: string) => d ?? k }; } }))` counts each row's and notice's render (both call `useTranslation`). Forty row items over forty segments and one notice, `canReplay` / `onReplay` as fresh arrow functions each render:
    1. A karaoke tick: re-render with the same `items` and `lit` = `new Map([[seg7, 3]])` → exactly one more render (the row of `seg7`).
    2. A new `onReplay` / `canReplay` identity alone → no row renders.
    3. `replaying` set to `seg3` → the rows whose replay slot shows re-render (`replayingOther` flips), no others: build the items so that only four rows carry a slot (translation rows that end their segment, with `replayLegs` holding the speaker) and assert four renders.
    4. With `noticeAction` (the same function on every render) answering a **fresh** `{ label, run }` object on each call, a karaoke tick re-renders no notice — the list caches a notice's action by its id.
  - `ConversationList.test.tsx`: `replayBlocked="Replay is off…"` → every replay button is disabled with that title; without it the existing enabled/disabled cases hold. `noticeAction={(n) => n.code === 'no_microphone' ? { label: 'Settings', run } : null}` → a notice with that code has a `.message-action` button reading "Settings" whose click calls `run`; another notice has none.
- [ ] **Step 2: Run** `npx vitest run src/lib/view src/lib/projection src/components/Conversation` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `project.ts`: extract the loop body of `sameRows` into `export function sameRow(a: Row, b: Row): boolean` (identity, then the eight fields as today) and call it from `sameRows`.
  - `filter.ts`: `displayItems(entries, filters, previous: readonly DisplayItem[] = [])`, indexing `previous` by row key (`n:<id>` for notices), and pushing `old` in place of the fresh item when `old.kind === 'row' && sameRow(old.row, row) && old.header === header && old.endsSegment === endsSegment && old.t === entry.t && old.leg === entry.leg && old.languages.source === entry.languages.source && old.languages.target === entry.languages.target`; a notice reuses the previous item when `old.notice === entry`. Its doc gains: "`previous`, the last call's output, keeps an unchanged line's object, so a memoized row does not re-render (plan 1e-3b-1 ruling 14)."
  - `ConversationList.tsx`: `RowBubble` and `NoticeBubble` become `memo(function …)`. The list keeps `onReplay` in a ref behind one stable callback (`const replay = useCallback((leg, id) => onReplayRef.current(leg, id), [])`). The slot is decided in the list, as today (`ConversationList.tsx:59`, `replaySlot`), so the replay booleans go only to a row that shows one — a row without a slot gets constants and never re-renders for a replay:

    ```tsx
    const slot = !compact && item.row.side === 'translation' && item.endsSegment && replayLegs.has(item.leg);
    const id = item.row.segmentId;
    <RowBubble
      key={item.row.key}
      item={item}
      upTo={lit.get(id)}
      replaySlot={slot}
      canReplay={slot && canReplay(id)}
      replayingThis={slot && replaying === id}
      replayingOther={slot && replaying !== null && replaying !== id}
      blocked={slot ? replayBlocked ?? null : null}
      onReplay={replay}
      compact={compact}
    />
    ```

    `RowBubbleProps` becomes `{ item; upTo; replaySlot: boolean; canReplay: boolean; replayingThis: boolean; replayingOther: boolean; blocked: string | null; onReplay(leg, segmentId): void; compact }` — the `replaying` id and the `canReplay` function leave it. The button: `disabled={!canReplay || replayingOther || blocked !== null}`, `title={blocked ?? t('mainPanel.playItemAudio', …)}`, `onClick={canReplay && blocked === null ? () => onReplay(leg, segmentId) : undefined}`. `NoticeBubble` takes `action: NoticeAction | null` and renders, after the content, `{action && <button type="button" className="message-action" onClick={action.run}>{action.label}</button>}`. The actions are cached per notice id, so a caller's fresh object per call does not break the memo:

    ```ts
    // A notice's action keeps its identity while `noticeAction` does (plan 1e-3b-1 ruling 14).
    const actions = useRef<{ from: ConversationListProps['noticeAction']; byId: Map<string, NoticeAction | null> }>({ from: undefined, byId: new Map() });
    if (actions.current.from !== noticeAction) actions.current = { from: noticeAction, byId: new Map() };
    const actionFor = (notice: NoticeEntry): NoticeAction | null => {
      const { byId } = actions.current;
      if (!byId.has(notice.id)) byId.set(notice.id, noticeAction?.(notice) ?? null);
      return byId.get(notice.id)!;
    };
    ```

    and renders `<NoticeBubble key={item.notice.id} notice={item.notice} action={actionFor(item.notice)} />`.
  - `MainPanel.scss`: `@use '../Settings/shared/variables' as vars;` beside its `tokens` import (as `Tour.scss` and `SetupWizard.scss` do), and inside `.message-bubble` a `.message-action` rule copied from `.language-model-warning__link` (`Settings.scss:1266-1281`: the button reset, underline, pointer, hover opacity, and `&:focus-visible { @include vars.focus-ring; }` — the mixin, not a hand-written outline), with `color: #ff6b6b` (the error bubble's text) and `display: inline-block; margin-top: 4px;` — the link look of the nearest sibling control (memory: match sibling markup).
- [ ] **Step 4: Run** the same set, then `npx vitest run src/components/dev` (the preview's list), then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/projection/project.ts src/lib/view/filter.ts src/lib/view/filter.test.ts src/components/Conversation src/components/MainPanel/MainPanel.scss
  git commit -m "perf(view): reused display items and memoized rows; a replay tooltip and a notice's action"
  ```

**Probes:** `spine-surface-probe.mjs` (default and `'…&script=cjk&cut=sentences:1'`): rows, header and karaoke as before (the preview's list keeps passing `displayItems` without `previous` until Task 12).

---

### Task 9: The panel's rules — push-to-talk, the clock, the start label, the replay gate, the permission warnings, the echo source

**Files:** Create under `src/components/MainPanel/panel/`: `usePushToTalk.ts` (+ `usePushToTalk.test.tsx`), `sessionClock.ts` (+ `sessionClock.test.tsx`), `startLabel.ts` (+ test), `replayGate.ts` (+ test), `usePermissionWarning.ts` (+ `usePermissionWarning.test.tsx`); Modify `src/components/EchoNotice/useEchoNotice.ts`.

**Interfaces:**
- Produces:
  - `usePushToTalk(input: { enabled: boolean; press(): void; release(): void }): { held: boolean; press(): void; release(): void }`;
  - `formatDuration(ms: number): string`, `useSessionClock(run: RunState, now?: () => number): string | null`;
  - `startLabel(t: TFunction, run: RunState, site: 'basic' | 'advanced'): string | null`;
  - `replayBlocked(input: { run: RunState; platform: Platform; participantSourceId: string | undefined; participantNoticeCodes: readonly string[] }): boolean`;
  - `usePermissionWarning(run: RunState, legs: readonly Leg[]): { warning: WarningType | null; open(type: WarningType): void; close(): void }`;
  - `useEchoNotice(source: EchoSource | null, onDetected?)` with `export interface EchoSource { onEchoNotice(listener: ((state: EchoNoticeState | null) => void) | null): void; setEchoDiagnostics(enabled: boolean): void }` and `export function echoSource(watch: EchoWatch): EchoSource`.
- Consumed by: Tasks 10–12.

- [ ] **Step 1: Write the failing tests.**
  - `usePushToTalk.test.tsx` (`renderHook`, `fireEvent.keyDown(window, { code: 'Space' })`):
    1. Enabled: Space down → `press` once, `held` true; a repeat down (`repeat: true`) → no second press; Space up → `release` once, `held` false.
    2. Focus in an `<input>` (append one, `focus()`) → Space down and up do nothing.
    3. Another key → nothing.
    4. Held, then `window` blur → `release` once.
    5. Held, then `enabled` turns false (rerender) → `release` once, `held` false; keys do nothing while disabled.
    6. The returned `press()` / `release()` (the footer's button) do what the key does, and are no-ops when disabled.
  - `sessionClock.test.tsx`: `formatDuration(0)` → `'00:00'`; `61_000` → `'01:01'`; `3_661_000` → `'01:01:01'`; `useSessionClock({ phase: 'idle' })` → null; `{ phase: 'running', since: 1_000, legs: {} }` with a `now` returning 62_000 → `'01:01'`, and with fake timers it re-renders each second.
  - `startLabel.test.ts` (`t` returns the default with `{{x}}` filled): `phase: 'idle'` → null; `starting`, `step: 'checking'` → `'Connecting...'` (basic) and `'Initializing...'` (advanced); with `loading: { leg: 'speaker', stage: 'asr', done: 1, total: 3 }` → `'Loading (1/3)...'` on both sites (keys `simplePanel.initProgress` / `mainPanel.initProgress`).
  - `replayGate.test.ts`: running with `legs: { participant: 'live' }` on `'electron'` and source `'desktop-audio-loopback'` → true; `undefined` source → true; `'app:42'` → false; `'app:42'` with `participantNoticeCodes: ['app_capture_lost_using_system_audio']` → true, and with `['app_capture_monitor_missing']` → true; idle → false; running with only the speaker leg → false; `'extension'` and `'web'` → false.
  - `usePermissionWarning.test.tsx`: a `run` that becomes `{ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'loopback_denied', message: 'm', leg: 'participant' } } }` → `warning` `'screen-recording-denied'`; re-rendering with the same `lastEnd` object after `close()` → stays null; `refused` with the same code also opens it. A participant `Leg` gaining a notice `{ id: 'p:n1', code: 'silent_no_permission', … }` with `useAudioStore` `participantTapAudioSeen: false` → `'audio-capture-denied'`; with it true → null; the same notice id on a later render → no second open. `open('screen-recording-denied')` opens it by hand (the notice action). `open` and `close` keep their identity across re-renders (`result.current.open` before and after a rerender are the same function).
  - `useEchoNotice` keeps its tests (if any); add to one of the new test files: `echoSource(watch)` forwards `onEchoNotice(l)` to `watch.onNotice(l)` and `setEchoDiagnostics(true)` to `watch.setDiagnostics(true)`.
- [ ] **Step 2: Run** `npx vitest run src/components/MainPanel/panel src/components/EchoNotice` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `usePushToTalk.ts` — today's Space handler (`MainPanel.tsx:4094-4149`: the input-focus skip, `e.repeat`, `preventDefault`, blur releases) over the runner's `press` / `release`, with the held state the panel's own (ruling 16):

    ```ts
    export function usePushToTalk({ enabled, press, release }: { enabled: boolean; press(): void; release(): void }) {
      const [held, setHeld] = useState(false);
      const heldRef = useRef(false);
      const doPress = useCallback(() => {
        if (!enabled || heldRef.current) return;
        heldRef.current = true;
        setHeld(true);
        press();
      }, [enabled, press]);
      const doRelease = useCallback(() => {
        if (!heldRef.current) return;
        heldRef.current = false;
        setHeld(false);
        release();
      }, [release]);
      // The run ended, or the mode changed, while the key was down.
      useEffect(() => { if (!enabled) doRelease(); }, [enabled, doRelease]);
      useEffect(() => {
        if (!enabled) return;
        const typing = () => {
          const el = document.activeElement;
          return el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.getAttribute('contenteditable') === 'true';
        };
        const down = (e: KeyboardEvent) => {
          if (typing() || e.code !== 'Space' || e.repeat) return;
          e.preventDefault(); // no page scroll
          doPress();
        };
        const up = (e: KeyboardEvent) => {
          if (typing() || e.code !== 'Space') return;
          e.preventDefault();
          doRelease();
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', doRelease);
        return () => {
          window.removeEventListener('keydown', down);
          window.removeEventListener('keyup', up);
          window.removeEventListener('blur', doRelease);
        };
      }, [enabled, doPress, doRelease]);
      return { held, press: doPress, release: doRelease };
    }
    ```
  - `sessionClock.ts`: `formatDuration` is today's formatter (`MainPanel.tsx:1428-1436`); `useSessionClock` holds a `now` state ticked by a one-second interval while `run.phase === 'running'`, and returns `formatDuration(now - run.since)` then, else null.
  - `startLabel.ts`: the table in the test; its doc says the labels are today's keys (`initPhaseLabel`, `MainPanel.tsx:256-269`) over `RunState.starting`.
  - `replayGate.ts`:

    ```ts
    /**
     * Replay is off while the participant leg captures the whole system during a
     * run: a replay would be captured and translated again as Other (decided for
     * 1e-3, roadmap "Decided for 1e"). Electron only — the extension captures the
     * meeting's tab, never the side panel; the web has no participant leg. A
     * source is the whole system unless it names one application (`app:…`) or
     * that application's capture fell back to the whole system this run.
     */
    export function replayBlocked({ run, platform, participantSourceId, participantNoticeCodes }: ReplayGateInput): boolean {
      if (run.phase !== 'running' || !run.legs.participant || platform !== 'electron') return false;
      if (!participantSourceId?.startsWith('app:')) return true;
      return participantNoticeCodes.some((code) => code === APP_CAPTURE_LOST || code === APP_MONITOR_MISSING);
    }
    ```

    (A gate the roadmap decided, with four inputs and three platforms: pinned by its own test rather than inlined — the memory's "do not extract small predicates" is about one-line booleans.)
  - `usePermissionWarning.ts`: a `useState<WarningType | null>`; `open` and `close` are `useCallback`s with no dependencies (`setWarning` is stable), so the notice action built on `open` (Task 12) keeps its identity across renders; an effect on `run` that opens `'screen-recording-denied'` when `run.phase === 'idle'`, `run.lastEnd` is a new object (kept in a ref), and `run.lastEnd.notice?.code === LOOPBACK_DENIED`; an effect on `legs` that walks the participant leg's notices, remembers each id it has seen, and for a new `SILENT_NO_PERMISSION` one opens `'audio-capture-denied'` when `silentNoPermissionPresentation({ tapAudioSeen: useAudioStore.getState().participantTapAudioSeen }) === 'modal'` (import from `../participantWarnings`, kept by 1e-3c's list as a helper the new panel uses).
  - `useEchoNotice.ts`: the parameter type becomes `EchoSource | null` (define `EchoSource` here; `IAudioService` still satisfies it, so the old MainPanel compiles unchanged), and `echoSource(watch)` adapts `EchoWatch`.
- [ ] **Step 4: Run** the same set, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/components/MainPanel/panel src/components/EchoNotice/useEchoNotice.ts
  git commit -m "feat(panel): push-to-talk, the clock, the start label, the replay gate and the permission warnings over the runner"
  ```

**Probes:** none — nothing the preview draws uses them yet.

---

### Task 10: The toolbar and typed text

**Files:** Create `src/components/MainPanel/panel/PanelToolbar.tsx` (+ `PanelToolbar.test.tsx`), `src/components/MainPanel/panel/TypedText.tsx` (+ `TypedText.test.tsx`).

**Interfaces:**
- Produces: `PanelToolbar(props: { legs: readonly LegName[]; exporter: Exporter; hasConversation: boolean; onClear(): void })`; `TypedText(props: { onSend(text: string): void })`.
- Consumed by: Task 12.

- [ ] **Step 1: Write the failing tests** (`react-i18next` key-returning `t`; the stores real, reset in `afterEach`; `ExportMenuButton` mocked to a marker that records its props):
  - `PanelToolbar`: `legs={['speaker']}` → one `DisplayModeButton` (the speaker's); `['speaker', 'participant']` → two; the export marker got the `exporter` and today's two display modes (`useSettingsStore`'s `speakerDisplayMode` / `participantDisplayMode`); the clear button (`title="mainPanel.clearConversation"`) is disabled with `hasConversation={false}` and calls `onClear` when enabled; the font-size buttons move `useConversationDisplayStore`'s size by 2 within its bounds; the compact button toggles `compactMode` and `aria-pressed`; the display-settings button opens `DisplaySettingsPopover` (mocked marker) in a portal.
  - `TypedText`: typing `'  hello '` and Enter calls `onSend('hello')` and empties the box; Enter on a blank box does nothing; the send button is disabled while the box is blank, and clicking it sends; a second send within 300 ms is ignored (today's `isAdvancedSending`), and allowed after `vi.advanceTimersByTime(300)`.
- [ ] **Step 2: Run** `npx vitest run src/components/MainPanel/panel` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `PanelToolbar.tsx`: today's toolbar markup, `MainPanel.tsx:4472-4583` (the `conversation-toolbar` div and the display popover's `FloatingPortal`), with the floating-ui wiring of `MainPanel.tsx:831-859`, and these substitutions:

    | Today | Here |
    |---|---|
    | `effectiveMode === 'speaker' \|\| … \|\| items.length > 0` (and the participant twin) | `legs.includes('speaker')` / `legs.includes('participant')` — the subtitle session's legs, which already merge intent and conversation (Task 7) |
    | `<ExportButton combinedItems={…} … />` | `<ExportMenuButton exporter={exporter} speakerMode={speakerDisplayMode} participantMode={participantDisplayMode} />` |
    | `onClick={requestClearConversation}`, `disabled={combinedItems.length === 0}` | `onClick={onClear}`, `disabled={!hasConversation}` |

    The comments that explain each control stay. The outer `(!subtitleTakeover || …)` condition is the composition's (Task 12).
  - `TypedText.tsx`: today's text-input section, `MainPanel.tsx:4646-4670`, with its own `useState` for the text and the 300 ms sending latch (`MainPanel.tsx:3511-3530`), calling `onSend(text.trim())`.
- [ ] **Step 4: Run** the same set, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/components/MainPanel/panel/PanelToolbar.tsx src/components/MainPanel/panel/PanelToolbar.test.tsx src/components/MainPanel/panel/TypedText.tsx src/components/MainPanel/panel/TypedText.test.tsx
  git commit -m "feat(panel): the conversation toolbar with the export menu, and typed text"
  ```

**Probes:** none.

---

### Task 11: The two footers and the waveforms

**Files:** Create `src/components/MainPanel/panel/PanelFooter.tsx` (+ `PanelFooter.test.tsx`), `src/components/MainPanel/panel/Waveforms.tsx` (+ `Waveforms.test.tsx`).

**Interfaces:**
- Produces:

  ```ts
  export interface PanelFooterProps {
    site: 'basic' | 'advanced';
    run: RunState;
    mode: AudioMode;
    /** Today's amber segment: 'speaker' when the speaker's leg has no microphone. */
    missingDevice: 'speaker' | null;
    canStart: boolean;
    /** Why Start is off, in words; undefined when it is not. */
    startBlockMessage?: string;
    /** A run is live under manual turns with the speaker leg live: the hold button shows. */
    holdToTalk: boolean;
    held: boolean;
    micMuted: boolean;
    pair: LanguagePair | null;
    duration: string | null;
    onStart(): void;
    onStop(): void;
    onPress(): void;
    onRelease(): void;
    onModeSegment(target: AudioMode, el: HTMLElement): void;
    onLanguages(): void;
    /** Development builds: the test tone. */
    testTone?: { playing: boolean; toggle(): void };
    /** The advanced footer's input strips and output strip. */
    waveforms?: { input: ReactNode; output: ReactNode };
  }
  export function PanelFooter(props: PanelFooterProps): JSX.Element;
  export function InputWaveforms(props: { mode: AudioMode; levels: Readonly<Record<LegName, LevelMeter>> | null }): JSX.Element | null;
  export function OutputWaveform(props: { meter: BusMeter | null }): JSX.Element;
  ```
- Consumed by: Task 12.

- [ ] **Step 1: Write the failing tests** (`react-i18next` returning the key, always — `t: (key: string) => key` — so every assertion below is a key, whether or not the markup passes a default; `startLabel`'s own words are Task 9's test; `ModePicker` real):
  - `PanelFooter`, both sites (`it.each(['basic', 'advanced'])`):
    1. **The tour's anchor** (replaces `Tour/anchors.test.ts:29-32`'s source count): exactly one `[data-tour="main-action"]` per footer.
    2. Idle, `canStart` → the action shows Start (`simplePanel.start` / `mainPanel.startSession`) and calls `onStart`; `canStart: false` with `startBlockMessage: 'Configure devices for this mode to start.'` → disabled, and the message is its `title` (basic) or its `.tooltip` (advanced).
    3. `starting` with `loading` 1/3 → a spinner and the label `simplePanel.initProgress` (basic) / `mainPanel.initProgress` (advanced), the button enabled, its click calls `onStop` (cancel), title `mainPanel.clickToCancel`.
    4. `running` → the Stop variant (basic: class `stop`, `simplePanel.stop`; advanced: `session-button active`, `mainPanel.endSession`), calls `onStop`; `status-dot active`; the duration shows; `stopping` → the same Stop variant and class, disabled, no `status-dot active` and no duration.
    5. `running` with `legs.speaker: 'reconnecting'` → `status-dot reconnecting` and, basic only, the `connectionStatus.reconnecting` label.
    6. `holdToTalk` → the hold button (basic `push-to-talk-btn`, advanced `push-to-talk-button`); mouse down/up call `onPress` / `onRelease`; `held` shows `simplePanel.release` (basic) / `mainPanel.release` (advanced); advanced with `micMuted` → disabled and `mainPanel.inputDeviceOff`.
    7. `missingDevice: 'speaker'` → the ModePicker's speaker segment has `mode-picker__segment--warn` (`ModePicker.tsx:69-75`); `run` not idle → the picker has `mode-picker--locked`.
    8. The language pair reads `ja → en` and calls `onLanguages`.
    9. Advanced with `testTone` → the debug button toggles and reads `mainPanel.stopDebug` while playing; basic never shows it.
    10. Advanced renders `waveforms.input` and `.output`; basic renders neither.
  - `Waveforms`: with `requestAnimationFrame` stubbed to collect callbacks and `HTMLCanvasElement.prototype.getContext` returning a stub 2D context, `InputWaveforms` in `'both'` renders two strips (`kind` mic and system) and in `'speaker'` one; running one frame calls `levels.speaker.read()` and `levels.participant.read()`; with `levels` null it draws flat and does not throw; `OutputWaveform` reads `meter.read()` each frame and draws flat when `meter` is null; unmounting stops the loop (no frame after).
- [ ] **Step 2: Run** `npx vitest run src/components/MainPanel/panel` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `PanelFooter.tsx`: the basic footer, `MainPanel.tsx:4672-4766`, and the advanced footer, `MainPanel.tsx:4768-4907`, class for class and comment for comment where the comment still holds, with these substitutions:

    | Today | Here |
    |---|---|
    | `isSessionActive` for the status dot and the duration | `run.phase === 'running'` |
    | `isSessionActive` for the action button's variant and class (basic `MainPanel.tsx:4722`, `4736`; advanced `4839`, `4845-4870`) | `run.phase === 'running' \|\| run.phase === 'stopping'` — a stopping run shows the Stop variant, disabled (ruling 16), never a disabled Start |
    | `isReconnecting` | `run.phase === 'running' && Object.values(run.legs).includes('reconnecting')` |
    | `isInitializing` | `run.phase === 'starting'` |
    | `initPhase ? initPhaseLabel(…) : …` | `startLabel(t, run, site)` |
    | `onClick={isSessionActive \|\| isInitializing ? disconnect : connect}` | `onClick={run.phase === 'idle' ? onStart : onStop}`, `disabled={(run.phase === 'idle' && !canStart) \|\| run.phase === 'stopping'}` |
    | `title={isInitializing ? clickToCancel : !isSessionActive ? startBlockMessage : undefined}` | `title={run.phase === 'starting' ? t('mainPanel.clickToCancel', 'Click to cancel') : run.phase === 'idle' ? startBlockMessage : undefined}` (basic); advanced keeps its `.tooltip` span, shown when `startBlockMessage` is set |
    | `ModePicker locked={isSessionActive \|\| isInitializing}`, `missingDeviceForMode`, the segment handler | `locked={run.phase !== 'idle'}`, `missingDeviceForMode={missingDevice}`, `onSegmentClick={onModeSegment}` |
    | `SplitDegradedChip` | removed (D21) |
    | `speakerChannelActive && canHoldToSpeak`, `isRecording`, `startRecording` / `stopRecording` | `holdToTalk`, `held`, `onPress` / `onRelease` (basic keeps its touch handlers) |
    | advanced `trackEvent('session_control_clicked', …)` | removed: the runner sends it for every surface (`runner.ts:193, 259`) |
    | `currentSettings.sourceLanguage → targetLanguage`, `navigateToSettings('languages')` | `pair ? \`${pair.source} → ${pair.target}\` : ''`, `onLanguages` |
    | `sessionDuration` | `duration` |
    | `SessionCountdown` | removed (Stage 2: `Resources` has no budget) |
    | `isDevelopment() && <button … onClick={playTestTone}>` | `testTone && <button … onClick={testTone.toggle}>` |
    | the waveform groups and `WaveformStrip kind="output"` | `waveforms?.input`, `waveforms?.output` |
  - `Waveforms.tsx`: a hook `useWaveform(read: () => Float32Array | null, color: string)` returning a canvas ref and running today's draw (`MainPanel.tsx:3878-3905`: size the canvas from its offset size on first draw, `clearRect`, `WavRenderer.drawBars(canvas, ctx, values ?? FLAT, color, 10, 0, 8)`) on `requestAnimationFrame`, reading `read` through a ref so a new closure never restarts the loop; `InputWaveforms` renders today's `waveform-input-group` (`MainPanel.tsx:4801-4822`) with `levels?.speaker.read()` (mic, `#0099ff`) and `levels?.participant.read()` (system, `#f59e0b`); `OutputWaveform` renders today's output strip (`MainPanel.tsx:4895`) over `meter?.read()` (`#ff9900`). The three titles keep today's keys.
- [ ] **Step 4: Run** the same set, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/components/MainPanel/panel/PanelFooter.tsx src/components/MainPanel/panel/PanelFooter.test.tsx src/components/MainPanel/panel/Waveforms.tsx src/components/MainPanel/panel/Waveforms.test.tsx
  git commit -m "feat(panel): the basic and advanced footers over the run's state, and the waveforms over the meters"
  ```

**Probes:** none.

---

### Task 12: The panel, composed — in the preview

**Files:** Create `src/components/MainPanel/SessionPanel.tsx`, `src/components/MainPanel/SessionPanel.test.tsx`, `src/components/MainPanel/SessionPanel.microphone.test.tsx`; Modify `src/components/dev/SpinePreview.tsx`, `src/components/dev/SpinePreview.scss`, `src/components/dev/SpinePreview.test.tsx`.

**Interfaces:**
- Consumes: everything above; `getAppSession()`; `useReadable`; `useConversationExporter`; `lastEndItem`; `noticeText`; `settingsTargetForCode`; `ConversationList`.
- Produces: `export default function SessionPanel(): JSX.Element` — plan 1e-3b-2's switch moves it over `MainPanel.tsx`; the preview's `&panel=1` and `&ui=advanced`.
- Consumed by: Task 13 (the probe), plan 1e-3b-2 Task 5 (the switch).

- [ ] **Step 1: Write the failing tests** in `SessionPanel.test.tsx` — the mocks of `SubtitleTakeover.test.tsx` (the root real, its audio and capture mocked with `meter` and `levels`), plus `../../lib/analytics` (`useAnalytics: () => ({ trackEvent })`), `react-i18next` returning the key, always (`t: (key: string) => key` — every assertion below is a key), `../../config/analytics` (`isDevelopment: () => true`); before render `configureAppSession({ clock, newSessionId: () => 'r1', capture: () => async () => createFakeSource(clock), microphoneRequired: () => false })` and the fake loaded and selected. Cases:
  1. Idle, nothing yet → the empty state (`simplePanel.startToBegin`) and a Start `[data-tour="main-action"]`.
  2. Start → the runner is running; after `clock.advance` through the fake's `exchange` script and the view's interval, rows appear in the panel's `.conversation-list`, and the toolbar's export button (`.export-btn`) is present.
  3. Stop → idle; the conversation stays; the clear button empties it (`runner.conversation` empty).
  4. Typed text: while running, `.text-input` shows; Enter with `'hi'` → the fake's typed-text row appears (`text_input_sent` tracked through the session's bridge); after Stop it is gone.
  5. Push-to-talk: `useTurnModeStore.setState({ turnMode: 'push-to-talk' })` before start → the hold button shows while running; Space down → the runner's run has an open turn (the hold button reads `simplePanel.release`); Space up → `simplePanel.holdToSpeak` again.
  6. A refused start (`useProviderStore.getState().updateSettings(fakeProvider, { checkFails: true })`) leaves the idle line after the list, in words (`notices.not_ready`), with no `.message-action` — `not_ready` has no Settings target.
  7. **The replay gate's wiring:** `vi.mock('./panel/replayGate', () => ({ replayBlocked: replayBlockedSpy }))` answering true, `keepReplayAudio: true`, a run with rows → every replay button is disabled with `mainPanel.replayBlockedWholeSystem` as its title, and the spy's last argument carries the run, `platform: 'web'` and `participantSourceId` equal to `useAudioStore`'s selected participant source id. (The gate's own rules are Task 9's tests.)
  8. **Permission:** `getAppSession().runner.state.setState({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'loopback_denied', message: 'm', leg: 'participant' } } }, true)` (the runner's store is a plain zustand store; the test sets it as a failed start would) → `WarningModal` (a marker recording `type` and `note`) gets `'screen-recording-denied'`; with two `participantSources` its `note` is `audioPanel.screenRecordingHasAlternative` (today's "pick an application" sentence); the marker's `onClose` clears it; the idle line's action reads `audioPanel.openSystemSettings` and a click reopens it.
  9. Advanced (`useSettingsStore.setState({ uiMode: 'advanced' })`): the advanced footer, two input strips in `'both'`, the output strip, and the debug button.
  10. **A notice's Settings action:** `navigateToSettings` spied through `useSettingsStore.setState({ navigateToSettings: spy })`; the runner's state set as in 8 with `lastEnd: { reason: 'refused', notice: { code: 'no_microphone', message: 'm', leg: 'speaker' } }` → the idle line has one `.message-action` reading `settings.title`, and a click calls the spy with `'microphone'`.
  11. The extension's overlay placeholder: `vi.mock('../../utils/environment', async (orig) => ({ ...(await orig()), isExtension: () => extensionFlag }))` with the flag on and `subtitleModeActive: true` → `mainPanel.subtitleTakeover`'s empty state in place of the list, and no toolbar while idle with no conversation.
  - `SessionPanel.microphone.test.tsx` (the same mocks, configured with `microphoneRequired: () => true` — the page's session is one per module graph — and `useAudioStore` at `{ mode: 'speaker', selectedInputDevice: null }`): Start is disabled with the `no_microphone` words (`notices.no_microphone`) as its title, and the ModePicker's speaker segment has `mode-picker__segment--warn`; choosing a microphone (`useAudioStore.setState({ selectedInputDevice: { deviceId: 'mic-1', label: 'Mic' } })`) enables Start and clears the amber.
- [ ] **Step 2: Run** `npx vitest run src/components/MainPanel/SessionPanel.test.tsx` — fails (no module).
- [ ] **Step 3: Implement `SessionPanel.tsx`.** Doc: "MainPanel on the app session (plan 1e-3b-1): the conversation from the root's view and karaoke, the run's controls, the toolbar with the export menu, the footers over the run's state. Built beside `MainPanel.tsx`; plan 1e-3b-2's switch moves it over that file." The composition, in full:

  ```tsx
  export default function SessionPanel() {
    const { t } = useTranslation();
    const { trackEvent } = useAnalytics();
    const session = getAppSession();
    const { runner } = session;
    const run = useRunState();
    const viewState = useReadable(session.view);
    const { lit, replaying } = useReadable(session.karaoke);
    const subtitle = useReadable(session.subtitle);
    const exporter = useConversationExporter(viewState);
    const audio = useLoadedAudio(session);

    const uiMode = useUIMode();
    const speakerMode = useSpeakerDisplayMode();
    const participantMode = useParticipantDisplayMode();
    const keepReplayAudio = useKeepReplayAudio();
    const navigateToSettings = useNavigateToSettings();
    const subtitleModeActive = useSubtitleModeActive();
    const participantSpeech = useRoutingStore((s) => s.participantSpeech);
    const mode = useMode();
    const setMode = useSetMode();
    const micMuted = useIsMicMuted();
    const participantSources = useParticipantSources();
    const participantSource = useSelectedParticipantSource();
    const provider = useProviderStore((s) => (s.selected ? getProvider(s.selected) : undefined));
    const display = useConversationDisplayStore();

    // The conversation: the view's entries through the display filter, reusing unchanged lines (ruling 14), then why the last start did not happen.
    const previous = useRef<readonly DisplayItem[]>([]);
    const drawn = useMemo(() => {
      const next = displayItems(viewState.entries, { speaker: speakerMode, participant: participantMode }, previous.current);
      previous.current = next;
      return next;
    }, [viewState.entries, speakerMode, participantMode]);
    const lastEnd = useMemo(() => lastEndItem(run), [run]);
    const items = useMemo(() => (lastEnd ? [...drawn, lastEnd] : drawn), [drawn, lastEnd]);
    const segments = useMemo(() => new Map(viewState.legs.flatMap((leg) => leg.segments.map((s) => [s.id, s] as const))), [viewState.legs]);
    const replayLegs = useMemo(() => new Set<LegName>(keepReplayAudio ? (participantSpeech ? ['speaker', 'participant'] : ['speaker']) : []), [keepReplayAudio, participantSpeech]);
    const participantNoticeCodes = useMemo(
      () => viewState.legs.find((leg) => leg.leg === 'participant')?.notices.flatMap((n) => (n.code ? [n.code] : [])) ?? [],
      [viewState.legs],
    );
    const blocked = replayBlocked({ run, platform: getEnvironment(), participantSourceId: participantSource?.deviceId, participantNoticeCodes })
      ? t('mainPanel.replayBlockedWholeSystem', "Replay is off while Other's audio captures all system sound: it would be translated again.")
      : null;

    const permission = usePermissionWarning(run, viewState.legs);
    const openWarning = permission.open;
    // Stable for the panel's life (`t`, the store action and `open` are), so the list's per-notice cache holds (ruling 14).
    const noticeAction = useCallback((notice: NoticeEntry): NoticeAction | null => {
      if (notice.code === LOOPBACK_DENIED) return { label: t('audioPanel.openSystemSettings', 'Open System Settings'), run: () => openWarning('screen-recording-denied') };
      const target = settingsTargetForCode(notice.code);
      return target ? { label: t('settings.title', 'Settings'), run: () => navigateToSettings(target) } : null;
    }, [t, navigateToSettings, openWarning]);

    // The start gate both surfaces read (the subtitle session), in words.
    const idle = subtitle.idle;
    const startBlockMessage = run.phase === 'idle' && !subtitle.canStart && idle.kind === 'unready'
      ? noticeText(t, { code: idle.code, params: idle.params, message: idle.message })
      : undefined;
    const missingDevice = idle.kind === 'unready' && idle.code === NO_MICROPHONE ? 'speaker' as const : null;

    const speakerLive = run.phase === 'running' && run.legs.speaker === 'live';
    const ptt = usePushToTalk({ enabled: speakerLive && subtitle.holdToTalk, press: runner.press, release: runner.release });
    const duration = useSessionClock(run);
    const canSendText = speakerLive && !!provider?.textInput;

    // Mode picker: the active segment toggles its device popover; another segment switches the mode while idle.
    const [popover, setPopover] = useState<HTMLElement | null>(null);
    const onModeSegment = useCallback((target: AudioMode, el: HTMLElement) => {
      if (target === mode) { setPopover((open) => (open ? null : el)); return; }
      if (run.phase === 'idle') setMode(target);
      setPopover(null);
    }, [mode, run.phase, setMode]);

    const { notice: echo, dismiss: dismissEcho } = useEchoNotice(
      useMemo(() => (audio ? echoSource(audio.capture.echo) : null), [audio]),
      (state) => {
        reportWarning('MainPanel', `Echo detected: ${state.cause} (lag ${Math.round(state.lagMs)}ms, rho ${state.rho.toFixed(2)})`, { dedupeKey: 'echo' });
        trackEvent('echo_detected', { cause: state.cause, lag_ms: Math.round(state.lagMs) });
      },
    );
    const testTone = useTestTone(audio);   // dev only: { playing, toggle } | undefined
    useUpdateAndAudioSystemListeners();    // today's two listener inits, MainPanel.tsx:1111-1125

    const takeover = subtitleModeActive && isExtension();
    const hasConversation = viewState.entries.length > 0;
    const footer = (site: 'basic' | 'advanced') => (
      <PanelFooter
        site={site} run={run} mode={mode} missingDevice={missingDevice}
        canStart={subtitle.canStart} startBlockMessage={startBlockMessage}
        holdToTalk={speakerLive && subtitle.holdToTalk} held={ptt.held} micMuted={micMuted}
        pair={subtitle.pair} duration={duration}
        onStart={() => void runner.start('button')} onStop={() => void runner.stop('button')}
        onPress={ptt.press} onRelease={ptt.release}
        onModeSegment={onModeSegment} onLanguages={() => navigateToSettings('languages')}
        testTone={site === 'advanced' ? testTone : undefined}
        waveforms={site === 'advanced' ? { input: <InputWaveforms mode={mode} levels={audio?.capture.levels ?? null} />, output: <OutputWaveform meter={audio?.playback.meter('virtual') ?? null} /> } : undefined}
      />
    );

    return (
      <div className="main-panel-wrapper" style={{ '--conversation-bg-color': display.bgColor, '--conversation-source-color': display.sourceTextColor, '--conversation-translation-color': display.translationTextColor } as CSSProperties}>
        <UpdateBanner />
        <AudioSystemBanner />
        <UpdateDialog />
        <div className="main-panel">
          {(!takeover || run.phase !== 'idle' || hasConversation) && (
            <PanelToolbar legs={subtitle.legs} exporter={exporter} hasConversation={hasConversation} onClear={runner.clear} />
          )}
          {takeover ? (
            <div className="conversation-display">
              <div className="empty-state"><Captions size={32} /><p>{t('mainPanel.subtitleTakeover', 'Translations are showing in the subtitle overlay')}</p></div>
            </div>
          ) : (
            <ConversationList
              items={items} lit={lit} replaying={replaying} replayLegs={replayLegs}
              canReplay={(id) => { const s = segments.get(id); return !!s?.final && s.speech.some((e) => e.pcm.length > 0); }}
              onReplay={(leg, id) => { const s = segments.get(id); if (audio && s) audio.playback.replay(leg, s); }}
              replayBlocked={blocked} noticeAction={noticeAction}
              compact={display.compactMode} fontSize={display.fontSize}
              empty={<><MessageSquare size={32} /><p>{t('simplePanel.startToBegin', 'Click Start to begin real-time translation')}</p></>}
            />
          )}
          {canSendText && <TypedText onSend={(text) => runner.sendText(text)} />}
          {footer(uiMode === 'advanced' ? 'advanced' : 'basic')}
          <EchoNotice state={echo} onDismiss={dismissEcho} />
        </div>
        <WarningModal
          isOpen={permission.warning !== null}
          onClose={permission.close}
          type={permission.warning}
          note={permission.warning === 'screen-recording-denied' && participantSources.length > 1
            ? t('audioPanel.screenRecordingHasAlternative', 'You can avoid this permission entirely: pick a specific application as the participant source instead. Applications only appear in that list while they are playing audio.')
            : null}
        />
        {popover && <ModeDevicePopover mode={mode} open anchorEl={popover} onClose={() => setPopover(null)} />}
      </div>
    );
  }
  ```

  Three local helpers in the same file: `useLoadedAudio(session)` (as the preview's effect: `session.audio()` into state, a failure reported with `reportError('MainPanel', …)`); `useTestTone(audio)` (`isDevelopment()` only; `toggle` plays `audio.testTone()` and, while its promise is pending, a second toggle calls `audio.playback.stopPreview()`; `playing` follows the promise; a failure is a `reportError`); `useUpdateAndAudioSystemListeners()` (today's two effects, verbatim). `ConversationList` renders its own `.conversation-display` and empty state, so today's `conversationContainerRef` and auto-scroll effect (`MainPanel.tsx:4043-4056`) are not ported (the list follows the newest line itself, `ConversationList.tsx:38-42`).
- [ ] **Step 4: The preview.** `SpinePreview.tsx`: `&panel=1` renders, after `SessionControls`, `<div className="spine-panel"><SessionPanel /></div>`; at module level, `if (param('ui') === 'advanced') useSettingsStore.setState({ uiMode: 'advanced' });` — in memory, never persisted — before the first render (a comment says why: the probe's advanced footer). `SpinePreview.scss`: `.spine-panel { height: 640px; display: flex; flex-direction: column; border: 1px solid #333; }` so the panel's flex layout has a height to fill. `SpinePreview.test.tsx`: with `?preview=spine&panel=1`, a `[data-tour="main-action"]` renders inside `.spine-panel`.
- [ ] **Step 5: Run** `npx vitest run src/components/MainPanel src/components/dev`, then the full suite and the gates. Do not start a dev server.
- [ ] **Step 6: Commit**

  ```bash
  git add src/components/MainPanel/SessionPanel.tsx src/components/MainPanel/SessionPanel.test.tsx src/components/MainPanel/SessionPanel.microphone.test.tsx src/components/dev/SpinePreview.tsx src/components/dev/SpinePreview.scss src/components/dev/SpinePreview.test.tsx
  git commit -m "feat(panel): MainPanel on the app session, beside the old one, in the preview"
  ```

**Probes:** every `spine-*` probe still passes (the preview draws the panel only at `&panel=1`). The panel's own probe is Task 13's.

---

### Task 13: The preview's settings at load, and the panel's headless probe

**Files:** Create `scripts/dev/app-panel-probe.mjs`; Modify `src/components/dev/SpinePreview.tsx`, `src/components/dev/SpinePreview.test.tsx`.

**Interfaces:**
- Produces: the preview applies `&script=`, `&cut=`, `&turn=`, `&compact=1`, `&autosave=1` and `&monitor=1` once its stores have loaded, with or without `&autostart=1` (ruling 19); `scripts/dev/app-panel-probe.mjs`.
- Consumed by: this task's group check; plan 1e-3b-2 (Task 3 adds `--settings`; its group checks run `--app`).

- [ ] **Step 1: Write the failing tests** in `SpinePreview.test.tsx` (before the `&punctuation=1` case, which stays last):
  1. **Settings from the URL without autostart:** `?preview=spine&script=cjk&autosave=1&turn=push-to-talk&monitor=1` → `waitFor`: the fake's entry has `settings.script === 'cjk'`, `useSettingsStore.getState().autoSaveOnStop === true`, `useTurnModeStore.getState().turnMode === 'push-to-talk'`, `useAudioStore.getState().isMonitorMuted === false`; and `runnerStart` was never called (no `&autostart=1`). The file's `ServiceFactory` mock answers every stored setting with its default (`'auto'` for the turn mode), so the stores' load runs and would reset the turn mode had the URL been applied before it: the final `'push-to-talk'` proves the order. A `finally` restores the URL and the three stores' previous values (captured before render), so the later cases run on `auto`, no auto-save and a muted monitor, as before.
  2. The existing autostart cases pass unchanged (`&punctuation=1` still downloads before the start, the fake still runs without a microphone).
- [ ] **Step 2: Run** `npx vitest run src/components/dev` — case 1 fails (the settings are applied only under `&autostart=1`).
- [ ] **Step 3: Implement** in `SpinePreview.tsx`. The stores' load reports when it is done, and the stored-settings block of the autostart effect (`&script=`, `&cut=`, `&turn=`, `&compact=1`, `&autosave=1`, and Task 2's `&monitor=1`) moves into an effect of its own, declared before the autostart effect:

  ```tsx
  const [storesLoaded, setStoresLoaded] = useState(false);
  // What a run reads, loaded the way the app loads it (Home.tsx) …(the existing comment)
  useEffect(() => { void loadSessionStores().finally(() => setStoresLoaded(true)); }, []);

  const [urlApplied, setUrlApplied] = useState(false);
  // The page's stored settings from the URL, applied once — with or without
  // `&autostart=1`, since the panel's probe starts by clicking (plan 1e-3b-1
  // Task 13). After the stores' load, so the load cannot overwrite them (the
  // turn mode's migration writes too), and once the selected provider's entry
  // is there (`&script=` is the fake's own setting).
  useEffect(() => {
    if (urlApplied || !storesLoaded || !entry) return;
    const params = new URLSearchParams(window.location.search);
    // …the moved block, unchanged: &script=, &cut=, &turn=, &compact=1, &autosave=1, &monitor=1…
    setUrlApplied(true);
  }, [urlApplied, storesLoaded, entry, providers]);
  ```

  The autostart effect returns early until `urlApplied` (added to its guard and its dependencies) and keeps the rest — `&models=`, `&pair=`, `&punctuation=1`, then `runner.start()`. The page's doc names the rule: "the stored-settings parameters apply on load; `&autostart=1` only starts".
- [ ] **Step 4: The probe**, `scripts/dev/app-panel-probe.mjs`:

  ```js
  #!/usr/bin/env node
  /**
   * Drives the new MainPanel headlessly (plan 1e-3b-1 Task 13): Start, rows with
   * karaoke, typed text, the export menu's .txt, Stop with its auto-save, the
   * advanced footer's waveforms, and a refused start's Settings action. Two
   * targets, the same checks:
   *
   *   --preview (default)  the development preview:
   *                        /?preview=spine&panel=1&script=cjk&autosave=1, plus
   *                        &turn=push-to-talk (--ptt), &script=long (--long),
   *                        &ui=advanced&capture=device (--advanced: the app's own
   *                        capture, whose level meters the mic strip reads — the
   *                        fake source bypasses them), &refuse=1 (--refuse)
   *   --app                the app itself at `/`, seeded as a finished setup on the
   *                        fake provider (plan 1e-3b-2's switch must have landed)
   * Flags: --advanced, --ptt (Space holds a turn), --long (the fake's `long`
   *        script: prints long-task totals, the row memoization's measurement),
   *        --refuse (preview only: a refused start's idle line and its action),
   *        --shot <file.png>.
   *
   *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
   *   node scripts/dev/app-panel-probe.mjs [origin] [flags]
   *
   * Exits 1 on any miss, printing each; 2 on a flag the target cannot serve.
   */
  ```

  Behaviour, in order, every selector scoped to `.main-panel`:
  1. Open the page with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, a download directory (`Browser.setDownloadBehavior`), and, before navigation, `Page.addScriptToEvaluateOnNewDocument` installing a `PerformanceObserver({ type: 'longtask', buffered: true })` that sums into `window.__longTasks = { count, max }`. `--app` also seeds `localStorage` once per profile (guarded by a `sessionStorage` flag in the same script): `settings.setup` = `{"version":1,"scenario":"be-heard","providerPath":"offline","provider":"local_inference","completedAt":"2026-09-25T00:00:00.000Z"}`, `settings.common.provider` = `fake`, `settings.fake.script` = `cjk` (or `long`), `settings.common.autoSaveOnStop` = `true`, `settings.common.uiMode` = `basic` / `advanced`, `settings.common.turnMode` = `auto` / `push-to-talk`. `--preview` builds its URL as the header says (the preview applies those parameters at load, Step 3). `--refuse` with `--app` prints "the app has no refusing stand-in; use --preview" and exits 2.
  2. Wait up to 10 s for `[data-tour="main-action"]` to be enabled; if it stays disabled, print its `title` (the start gate's reason — with `--advanced` in the preview, `no_microphone`'s words mean the fake microphone was not chosen) and fail.
  3. Click it. `--refuse`: within 3 s the list's last item is a notice (`.message-bubble`) holding one `.message-action` that reads `Settings` (`no_provider` → the provider section, `settingsTargetForCode`), and there is no `.status-dot.active`; then skip to step 10. Otherwise: within 5 s `.status-dot.active` and a `.session-duration` matching `/^\d\d:\d\d/`.
  4. Poll every 100 ms for 12 s: rows (`.conversation-row`) — pass once `今天天气很好。我们去公园吧。` (the `cjk` script; `--long`: any 20 rows) is in `.conversation-list`'s text; count polls where `.karaoke-played` exists (must be ≥ 1).
  5. Typed text: `.text-input` must exist; set its value through the native setter and dispatch `input`, then `keydown` Enter; within 5 s a row contains `probe text`.
  6. `--ptt`: `Input.dispatchKeyEvent` Space down → the hold button reads `Release` within 1 s; Space up → it reads `Hold` again.
  7. `--advanced`: at least two `.waveform-strip canvas` (mic, output); read the mic canvas's pixels (`getImageData`, count non-transparent) — `> 0` while the fake microphone plays.
  8. Export: click `.export-btn`, then the `[role="menuitem"]` reading `Download as .txt`; within 5 s a `.txt` lands whose text starts `Sokuji conversation export\n` and contains `\nProvider: fake\n`.
  9. Stop: click the main action; within 8 s `.status-dot` has no `active`, and a second `.txt` (the auto-save) lands with the same header.
  10. Print `long tasks: <count>, longest: <max> ms` (informational; a longest task over 500 ms fails — a hung frame, not a slow one).
  11. `--shot`: a screenshot of the page.

  (Not `&script=notices` for the action: its one notice, `tts_degraded`, has no Settings target and so carries no action; a refused start's `no_provider` does.)
- [ ] **Step 5: Run** `npx vitest run src/components/dev`, then the full suite and the gates. Do not start a dev server or run the probe.
- [ ] **Step 6: Commit**

  ```bash
  git add scripts/dev/app-panel-probe.mjs src/components/dev/SpinePreview.tsx src/components/dev/SpinePreview.test.tsx
  git commit -m "feat(dev): the preview applies its settings on load; the panel's headless probe"
  ```

**Group check (controller, after this commit — the second of two):** against a fresh vite:
- `node scripts/dev/app-panel-probe.mjs` (basic), `node scripts/dev/app-panel-probe.mjs --ptt`, `node scripts/dev/app-panel-probe.mjs --refuse` and `node scripts/dev/app-panel-probe.mjs --advanced --shot /tmp/panel-advanced.png`: every step passes. Look at the screenshot: the advanced footer's strips, the ModePicker, the language pair and the Start button sit as in today's app (settle by rendering: open `http://localhost:5199/` in another tab for today's panel beside it).
- `node scripts/dev/app-panel-probe.mjs --long`: prints the long-task totals (record them in the roadmap entry; the per-row memoization's measurement, roadmap 1d-1 → 1e).
- Every `spine-*` probe of Task 7's group check passes again (the autostart probes now get their settings from the load effect).

---

## Self-review

- **Scope (the roadmap's 1e-3b items, `1e3-shell.md` §3 "1e-3b", the 1e-3 rulings), for this half.**
  - Built here and mounted by the switch: MainPanel on the root — every §1 item: session start/stop, failure, auto-save once (items 1–3, the runner and `onRunEnded` already; the old path goes at the switch), frames into the Logs panel (item 4, 1e-3a), recording and the Space key (items 6–7, Task 9 `usePushToTalk`), typed text (item 8, Tasks 10, 12), replay and its decided gate (item 9, Tasks 8, 9, 12), the test tone (item 10, Task 12), karaoke (item 11) and the list with per-row memoization (item 12, Task 8), clear (item 13), export through `ExportMenuButton` (item 14, Task 10), device switching (item 15, inside the sources; `audio_error` Task 5, ruling 10), passthrough (item 16, 1e-3a), mute (item 17), the echo notice (item 18, Tasks 9, 12), the permission modals off `loopback_denied` and `silent_no_permission` with words (item 19, Tasks 9, 12, 1e-3a), the start gate with its tooltip and the missing-microphone state (item 20, Tasks 7, 12), the init label (item 21, Task 9), status, reconnecting and duration (item 22, Tasks 9, 11), the mode picker and its lock (item 23), the split chip gone (item 24), session analytics (item 25, 1e-3a's decorator; `session_control_clicked` now from every surface), the subtitle bridge replaced (item 27, Task 7), the close handshake on `settled()` (item 28, Task 5), `pagehide` (item 29, 1e-3a), audio init through `getAppAudio` (item 30, Task 12's `useLoadedAudio`), the waveforms (item 31, Tasks 2, 11, 1e-3 ruling 11), the display toolbar (item 32, Task 10), banners and listeners (item 33, Task 12), the footer's language pair (item 34, Tasks 11, 12). Item 26 (anchor responses) is Stage 2's OpenAI adapter. All of it is checked headlessly in the preview by Task 13's probe (Start, rows, karaoke, typed text, push-to-talk, the advanced strips over the app's own capture, export, auto-save, a refused start's Settings action) and, after the switch, in the app by plan 1e-3b-2's group check.
  - The takeover's component (roadmap 1d-2 → 1e, Task 7), `onFix` deep links off readiness codes (1e-3a → 1e-3b, Tasks 4, 7), display-mode buttons before the first run (1d-2 → 1e, Task 7), the #246 recovery in `getAppAudio`'s graph (1e-1 → 1e-3, Task 1), the microphone stopping first (1e-1 → 1e-3, Task 3), notices redacted at L1 (1e-2 → 1e-3, Task 3), `no_asr` as a language name (1e-3a → 1e-3b, Task 4), the audio probe's tap on a bus (1c-2 / 1e-1 → 1e-3, Task 2), the provider locked during a run (1c-1 / 1e-1 → 1e-3, Task 5), the stores loaded before the first start (Task 7's `providerLoaded`), the stored selection and turn-mode migration applied (1e-3a → 1e-3b, Task 6), Electron's bound (1e-3 ruling 12, Task 5), one owner each for `attach()` and the bridges (1e-3a → 1e-3b: `AppSessionRoot`, Task 5), the speaker leg's speech `!textOnly` (decided for 1e-3: `contextsFor`, `shape.ts:21`, unchanged).
  - **The four source-reading tests:** `sessionIdLifecycle.consistency` → Task 5 case 1; `sessionEndAutoSave.wiring` → Task 5 cases 2–5 plus 1e-3a's "one auto-save per run" and `busy.test.ts`; `Tour/anchors.test.ts:29-32` → Task 11 case 1 (`engine-chips` in plan 1e-3b-2). Their deletion, and `consoleLedger`'s MainPanel row, are the switch's (plan 1e-3b-2 Task 5): the old tests pin the old file until it goes.
  - **Left for plan 1e-3b-2:** the Settings provider area (`ProviderPanel` pieces, the global turn mode, the Output toggles, the segmentation offer, the locks, LocalInference's chips and memory estimate, `LocalInferenceEngine` learning the legs), the single-writer cut (`SettingsInitializer`, the settings store's mode subscription, the SetupWizard's offline path), the switch itself (`MainPanel.tsx`, `MainLayout`'s takeover and the Kizuna auto-switch, `AppSessionRoot` in `Home`), `SubtitleEnterButton` / `enterSubtitleMode` / `UserProfileContext` on the phase, the participant-speech switch, and the Electron acceptance.
  - **Moved out, with why:** a notice code for typed text in an AST session (roadmap 1e-2 → 1e-3) → Stage 2 step 1 (LocalInference): an adapter change and a new sentence, unrelated to the switch. `persistIfUnchanged` resetting readiness mid-start (1c-1 / 1e-1) → Stage 2's first provider with `prepare`: LocalInference has none, so nothing on the branch reaches it. `normalizePair` on empty lists (1b) → Stage 2's first catalogue-driven provider: LocalInference's and the fake's lists cannot be empty. The letters-changed growth mark, the karaoke hold after TTS stops, and the mark re-mapping cost (1a / 1d-1) → before the first release: L1 and karaoke behaviours the switch neither causes nor needs. The native-reader spot-check, the release notes and the export's "Narrowed" notes (1d-1 / 1d-3) → before a build leaves the machine (human review). The extension's items stay 1e-4's.
- **Placeholders:** three deliberate instructions instead of code — Task 4's 29 translations of four keys (written by the implementing model, method and anchors given), and the markup copies of Tasks 10 and 11, each named by today's line range with every substitution in a table; Task 13's moved block is the autostart effect's existing lines, moved verbatim. Everything decided is written out.
- **Types across tasks:** `GraphDeps.replaceContext` / `AudioGraph.onReset` (Task 1) are supplied by `getAppAudio` and read by `createPlayback`; `AudioGraph.meter` → `Playback.meter` (Task 2) is read by `OutputWaveform` (Task 11) and the preview's probe line; `AppCapture.levels` (Task 2) by `InputWaveforms`; `settingsTargetForCode` (Task 4) by `SubtitleView` (Task 7) and `SessionPanel` (Task 12); `useRunState` / `useSessionLocked` / `currentRunPhase` (Task 5) by the panel and plan 1e-3b-2; `ProviderStore.select(id, how)` and `selectionLocked` (Tasks 5, 6); `SubtitleSessionInput.providerLoaded` and the idle's `target` (Task 7) by `SubtitleIdle` and the panel's gate; `displayItems(…, previous)` and `sameRow` (Task 8) by `SessionPanel`; `ConversationListProps.replayBlocked` / `noticeAction` (Task 8) by `SessionPanel`; `replayBlocked()` / `usePermissionWarning` / `usePushToTalk` / `useSessionClock` / `startLabel` / `EchoSource` (Task 9) by Tasks 11–12 — `usePermissionWarning`'s `open` is stable, so `SessionPanel`'s `noticeAction` is, so `ConversationList`'s per-id action cache (Task 8) holds across ticks; `RowBubbleProps` (Task 8) carries booleans only, which `SessionPanel` never builds itself; `PanelFooterProps` (Task 11) is filled by `SessionPanel`'s `footer()`; `audioPanel.participantSpeechBlockedWholeSystem` (Task 4) is read by plan 1e-3b-2's `ParticipantSpeechSwitch`. The playback tests that hand-build a graph gain `meter` in Task 2, the task that adds it to `AudioGraph`, never earlier (an excess property is a gate line).
- **Stated departures from today:** the microphone strip moves in every turn mode (ruling 3); the countdown is not drawn and the split chip is gone (ruling 16, D21); a close is `session_control_clicked` with `method: 'window'` (ruling 6); `session_control_clicked` is sent by both footers (the runner's); a source's end is an `audio_error` and MainPanel's duplicate `audio_device_changed` is gone (ruling 10); Electron waits up to 16 s for a close (1e-3 ruling 12); the turn mode migrates at load before the switch (ruling 9); a notice with a Settings target carries a "Settings" action (ruling 13); a stopping run shows a disabled Stop, never a disabled Start (ruling 16, Task 11); the advanced footer's status dot shows `reconnecting` too (Task 11 case 5 runs on both sites; today only the basic one did). In the running app only the migration write and the bound are observable before the switch.
- **Checked again after the independent review (2026-09-25):** the rebuild swaps contexts before its listeners clear the queues and never awaits the dead context's `close()` (Task 1, ruling 2, case 11); the test tone decodes on an offline context (Task 1); `meter` joins the hand-built graph in Task 2 with the interface, and `SessionControls.test.tsx` and `session.test.ts:140` move with it; the close-bound test parses; `loadStores.test.ts`'s first case and `appSession.test.ts`'s `setup()` are named where the new behaviour contradicts them; a row without a replay slot gets constant replay props, and a notice's action is cached per id (Task 8); the footer's button variant follows `running || stopping` (Task 11); the panel's and footer's tests use a key-returning `t` throughout (Tasks 11, 12); the new link button uses the `focus-ring` mixin; the probe is a task of its own (Task 13) whose preview URL can pass — the preview applies its settings on load, and `--advanced` runs on the app's own capture, whose meters the strip reads.
