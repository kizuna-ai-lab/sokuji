# Client contract — Stage 1e-4: the extension overlay on the new session

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The meeting page's subtitle overlay runs on the app session again. Since plan 1e-3b-2's switch the side panel runs the new session, but its surface class still publishes the old `sessionStore`, which nothing writes, so the overlay always shows "Session ended" and its Clear does nothing. This plan makes the side panel's surface class publish the typed wire of `src/lib/subtitle/wire.ts` from the app session to its own tab's overlay only, and makes the overlay page draw `SubtitleView` from that wire through a shared `ConnectedOverlay`. It also closes the loose ends the survey found:
- the side panel's interface language travels on the wire;
- hold-to-talk needs the speaker leg;
- the hold button works from the keyboard and gives the keyboard back;
- the preview's overlay renders at the real 140 px;
- every wire message is pinned JSON-safe;
- the wire's cost is measured.

A spike tries to prove the overlay in a meeting page with a headless `--load-extension` run. It becomes a probe, or it records why it cannot. The plan ends with the controller's acceptance record and the list of what plan 1e-3c deletes.

**Architecture:**
- **The wire** (`src/lib/subtitle/wire.ts`) gains a fourth side-panel message, `subtitle:language`, an optional `language` source, the port's name `SUBTITLE_PORT`, and the named `OverlayReceiver` type.
- **The root** (`src/app/session.ts`) registers a `SubtitleFeed` into a new leaf, `src/app/subtitleFeed.ts`, while the page is attached. The feed holds the entries, subtitle session and karaoke sources and the runner's clear/press/release.
- **The side panel's surface class** (`ExtensionContentScriptSubtitleSurface`):
  - reads the session only through that leaf, since `settingsStore` imports the class;
  - targets the side panel's own `?tabId=`;
  - accepts a `sokuji-subtitle` port only from that tab and disconnects every other one;
  - on each accepted port, runs `publishSubtitles(chromePortWire(port), …)` with the side panel's i18next language (`uiLanguage`);
  - on teardown, stops the publisher before it closes the port.
- **The overlay page** (`src/subtitle-overlay-entry.tsx`):
  - hydrates its own display settings;
  - opens the port and its receiver in one synchronous step (`connectOverlay`, `src/lib/subtitle/overlayPort.ts`);
  - disposes the receiver and asks the content script to unmount when the side panel goes;
  - renders `ConnectedOverlay`, which maps the four controls back and switches the page's i18next to the side panel's language. The development preview's iframe mounts the same `ConnectedOverlay`.
- **What does not change:** the content scripts, the manifest and the vite config.

**Tech Stack:** TypeScript (strict), React 19, zustand, i18next, Vitest + @testing-library/react, Vite, Chrome extension messaging (`chrome.runtime` ports, `chrome.tabs`), headless Chromium over the DevTools protocol.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md`. The binding parts:
- **Sections:** "The two subtitle surfaces are not the same thing" (the extension overlay's row: "over a `chrome.runtime` port … subscribe, slice, strip, throttle, post"), "Surfaces emit press and release", D16, "The runner" (every surface calls the same methods), "Stopping, and closing the window" (`pagehide`), "What may change during a run" (the subtitle window's display settings are its own), "Invariants" (the tail sliced after the merge), "Testing" (the overlay in a meeting page, judged by rendering) and "Migration".
- **Roadmap items** (`docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`): "Scheduled by plan 1d-2" → 1e (the extension, the wire measured, keyboard hold), "Deferred by plan 1c-2" (the virtual microphone in a real Meet tab), and "Scheduled by plan 1e-3b-2" (the 1e-4 item, audio in the side panel by hand).
- **Research notes**, all in this plan's workspace: the survey `1e4-survey.md` (today's code by `file:line`, gaps G1–G13, cited as *survey Gn*); the controller's twelve rulings on its open questions, `1e4-rulings.md` (binding, cited as *ruling N*); and `1e3-notes/` (`1e3-items.md`, `1e3-deletion.md`, context).
- **Other plans' rulings** are cited as *1d-2 ruling N*, *1e-3 ruling N*, *1e-3b-1 ruling N*.
- **Form:** the model for this plan's form is `docs/superpowers/plans/2026-09-25-client-contract-stage1e3b-the-switch-1.md`.

## Global Constraints

- **The running app is switched.** The side panel runs the app session (plan 1e-3b-2). Its subtitle overlay is dead until Tasks 6 and 7 both land, and every commit in between leaves it no worse:
  - **After Task 6 alone**, the side panel publishes the new wire to an overlay page still running the old mirror. The mirror ignores the unknown message types and still shows "Session ended". Its `subtitle:request-clear` and `subtitle:user-exit` are also new `ToPanel` types, so its Clear and ✕ start working.
  - **After Task 7 alone**, the new overlay page connects to the old surface class. The receiver ignores `state-init` and the other old messages and shows "Session ended". The old class still handles ✕; its Clear stays dead, since it bumps a counter nothing reads.

  No extension build leaves the machine (1e-3 ruling 14; and no build from the branch ships before Stage 2's Soniox step).
- **What this plan touches:**
  - `src/lib/subtitle/**`
  - `src/app/subtitleFeed.ts` (new), and in `src/app/session.ts` the one registration in `attach()`
  - in `src/components/Subtitle/`: `HoldToTalk`, `ConnectedOverlay` (new), `uiLanguage` (new) and `subtitleEnterGate.ts` (its comment)
  - `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts` and its test
  - `src/subtitle-overlay-entry.tsx`
  - `src/components/dev/{OverlayPreview,SpinePreview,wireTally}*` and `SpinePreview.scss`
  - `scripts/dev/spine-subtitle-probe.mjs`, and `scripts/dev/extension-overlay-probe.mjs` (new, Task 9)
  - one row of `src/lib/diagnostics/consoleLedger.consistency.test.ts`
  - in `src/locales/index.ts`, one exported function, `showLanguageUncached` (Task 5, controller ruling M11), and its test `src/locales/showLanguageUncached.test.ts`. No new keys.
  - the roadmap (Task 10)
- **Read only:**
  - `extension/**`: the content scripts, `manifest.json`, `vite.config.ts`, `background.js` and `platforms.ts`. Survey G9: nothing there needs to change, and the port name, the resources and the hosts stay.
  - `src/stores/**`, including `sessionPortMirror.ts`, `playbackStore.ts` and `settingsStore.ts`, whose `enterSubtitleMode` / `exitSubtitleMode` stay as they are.
  - `src/types/subtitleWire.ts`
  - in `src/components/Subtitle/`: `SubtitleApp.tsx`, `SubtitleStream.tsx`, `SubtitleBar.tsx`, `SubtitleIdle.tsx`, `SubtitleView.tsx` and `useSubtitleChrome.tsx`
  - `src/components/MainPanel/**`, `src/components/Settings/**`, `src/locales/**` other than `showLanguageUncached` (no new keys, no catalog touched) and `electron/**`
- **Import rules:**
  - `src/lib/**` never imports React or anything under `src/app/**`.
  - `src/app/subtitleFeed.ts` is a leaf with type imports only.
  - The surface class imports `src/app/subtitleFeed.ts` and never `src/app/session.ts` (ruling 1). That is the same rule that lets `settingsStore` import `src/app/runPhase.ts`.
  - Nothing the overlay page imports may reach `src/app/session.ts` or `src/providers/registry.ts`: the fake must not ship (D24), and the runner has no business on a meeting page. Group check A checks the built bundle for both, with one sentinel string for each and a positive control in the side panel's chunks (controller ruling M5).
- **Diagnostics** (CLAUDE.md "Error Handling"):
  - Record a caught failure with `reportError` / `reportWarning` from `src/lib/diagnostics/report.ts`, never with `console.error` / `console.warn`.
  - The side panel's surface class reports through `report()` like the rest of the side panel.
  - The overlay page is a separate document. There `report()` reaches only its own console, and its `logStore` has no panel. Its own failures (a missing `#root`, a port that will not open) are `reportError`: the console line is the only record, as today's `console.error` was. Whatever the side panel or the content script must know crosses the existing channels: the port (the controls) and the window message to the content script (`sokuji-subtitle:sidepanel-gone`, drag-start).
  - The content scripts under `extension/` keep their channels and are not touched.
  - The entry's ledger row goes with its one `console.error` (Task 7). It is removed, not lowered to 0: an unlisted file is held at 0.
- **Gates for every task:**
  - `npx vitest run src` shows 0 failed and no unhandled errors. Today: 471 test files passed and 1 skipped (472); 5 993 tests passed and 2 skipped; no unhandled rejections.
  - This typecheck gate prints exactly the same **17 lines** it prints at this plan's start commit `f7085ddd`. The shell's `grep` is a ugrep wrapper that mis-parses this regex, so use `command grep` exactly as written. The regex is **plan 1e-3b-2's final gate, widened** by the files this plan creates or changes outside it:
    - `lib/diagnostics/consoleLedger` (Task 7's row)
    - `dev/…|wireTally` (Task 8)
    - `subtitle-overlay-entry`, which also matches its new test
    - `locales/(index\.ts|showLanguageUncached)` (Task 5's function and its test)

    `components/Subtitle`, `lib/subtitle` and `app/` already cover everything else. None of the added files carries an error today, so the 17 lines are unchanged (checked at `f7085ddd`):

  ```
  npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts|diagnostics/consoleLedger)|lib/modern-audio/BaseAudioRecorder|providers|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|MainPanel\.|panel/)|MainLayout/MainLayout\.tsx|Settings/(Settings\.tsx|ProviderArea|SimpleSettings/SimpleSettings\.tsx|AdvancedSettings/AdvancedSettings\.tsx|sections/(SpeechSection|ParticipantSpeechSwitch|SentenceSegmentationSection|SystemAudioSection)\.tsx)|SettingsInitializer/|SetupWizard/(SetupWizard\.tsx|applySetup\.ts|useApplySetup\.ts|providerPaths\.ts|steps/StepLanguagePair\.tsx)|TitleBar/AccountButton\.tsx|Tour/useStartBasicsTour\.ts|dev/(SpinePreview|SessionControls|OverlayPreview|wireTally))|contexts/UserProfileContext\.tsx|locales/(index\.ts|showLanguageUncached)|routes/Home\.tsx|stores/(providerStore|turnModeStore|routingStore|settingsStore\.ts)|utils/(environment|conversationExport)|subtitle-overlay-entry|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
  ```

  The 17 lines:

  ```
  src/App.tsx: error TS6133: 'React' is declared but its value is never read.
  src/components/MainLayout/MainLayout.tsx: error TS6133: 'useTranslation' is declared but i
  src/components/Settings/Settings.tsx: error TS2345: Argument of type '"settings_mode_switc
  src/components/Settings/sections/SystemAudioSection.tsx: error TS2345: Argument of type '"
  src/components/Subtitle/SubtitleApp.handleStart.test.tsx: error TS6133: 'provider' is decl
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

  Do not fix them; do not add to them.
- **Gates in a parallel wave** (controller ruling I1). Waves 1 and 2 run tasks at once in this one working tree, so each task sees the others' red phases: a test that references what another task has not written yet, a module another task has not created, a gate line in a file another task is editing.
  - A test failure, or an extra typecheck-gate line, in a file another concurrent task is changing is that task's work in progress. The implementer names it in the report and never touches it.
  - Its own files must be green, and the gate must print the 17 lines plus only such named lines.
  - The controller runs the full gates — `npx vitest run src` at 0 failed with no unhandled errors, and the exact 17 lines — after each wave has landed, before the next wave starts.
- **The extension has no typecheck of its own.** `extension/` has no `tsconfig.json`, and `vite build` does not typecheck. The root `tsconfig.json` includes only `src`, and reaches `extension/platforms.ts` only through the surface class's import. This plan changes no file under `extension/`, so the extension's gate is its build, `npm run extension:build`, plus `npx vitest run extension` (the manifest and platform consistency tests). Both are the controller's, in group check A. If `extension/node_modules` is missing, run `npm ci --prefix extension` first.
- **Dev servers, probes and builds:** never start a dev server, never run a probe, never build the extension. After a task's commit the controller runs the checks the task names, against a fresh vite (`SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort`). **The one exception is Task 9 (the spike)**: it may build a development copy of the extension into a temporary directory and launch headless Chromium — never a dev server.
- **Before Task 1, the controller records the overlay page's chunk list at `f7085ddd`:** `npm run extension:build`, then, as its own call, `command grep -o 'assets/[^"]*\.js' extension/dist/subtitle-overlay.html > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1e4-overlay-chunks-before.txt`. The page's own entry, `subtitle-overlay.js`, is constant and not listed. On 2026-09-26 at 00:06, the dist on disk preloaded `settingsStore`, `audioStore` (1.76 MB), `AppProviders`, `sessionStore` and `playbackStore`, among others. Survey G9: 1e-4 alone does not shrink this; 1e-3c's deletion does.
- **Shell forms** (controller ruling M6). This worktree's guard refuses compound shell forms: brace groups, loops, `cd … &&` chains. Every command in this plan's checks is a single command or a plain pipeline, each run as its own call, from the worktree root. Checks write their outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, never `/tmp`.
- **Commits:**
  - Conventional, in English. Every message ends with the implementing model's own `Co-Authored-By:` line and nothing else after it.
  - Run `git add <paths>` and then `git commit -q -F - -- <the same paths> <<'EOF' … EOF` as two separate calls: the shell refuses compound git commands. The `-- <paths>` pathspec on the commit is mandatory, because parallel tasks stage into the same index. Never stage a whole directory another task may share.
  - Never push.

## Rulings

The controller's twelve rulings (`1e4-rulings.md`) bind this plan. Each is restated with where it lands. So do the controller's later rulings: (a) and (b), made after the plan was first written, and its rulings on the pre-flight review (`1e4-preflight.md`), cited by the review's labels as *controller ruling I1…I7, M1…M15*.

1. **The publisher lives in the side panel's surface class** and reaches the session through a registration seam shaped like `src/app/runPhase.ts`: a leaf the root registers into at `attach()`, not a dynamic import. That breaks the `settingsStore → surfaces → app/session → appShape → settingsStore` cycle, and keeps `app/session` out of every graph that imports the surface class — the overlay page's included (Tasks 4, 6).
2. **The overlay stays read-only for start and stop** (1d-2 ruling 5). It sends press, release, Clear and exit.
   - **Correction:** the ruling also names "the settings navigation it sends today". The overlay sends none today, and none after this plan:
     - Its idle body is always "Session ended" + Return (`SubtitleIdle.tsx:41-50`, `allowSessionControl={false}`).
     - The bar's Settings button opens the overlay's own display popover (`SubtitleBar.tsx:273-284, 341-354`).
     - `SubtitleControls.openSettings` stays absent on the overlay, as `SubtitleView.tsx:40` already documents.

   There is nothing to carry (Task 5).
3. **The subtitle button's gate stays `running`.** Only the gate's stale comment changes; it cited the old mirror (Task 6).
4. **One overlay per tab** (Task 6):
   - The side panel's connect handler accepts a port only from its own tab: the `?tabId=` the side panel is opened with, else the active tab at `enter()`.
   - `enter()` targets that tab.
5. **The overlay's UI language travels on the wire**, and the overlay switches its i18next to it on receipt (Tasks 1, 5, 6). The shape: a fourth `ToOverlay` message, `subtitle:language`, rather than a field of `SubtitleSession`, because:
   - the session is built in `src/lib/subtitle/appSession.ts` from stores, and the UI language lives in no store — the picker changes i18next directly (`HelpSection.tsx:120-150`);
   - `src/lib/**` cannot import `src/locales`' React-bound instance;
   - the Electron takeover reads the same session and has no use for the language.

   The message is sent first on connect and again on every change. That fixes, as a side effect, a language changed mid-overlay never reaching it (survey G8).

   **The overlay shows the language; it never stores it** (controller ruling M11). i18next's detector caches every `changeLanguage` into the document's `localStorage` (`i18nextLng`, `src/locales/index.ts:112-115`), and the overlay's storage may be the side panel's own, so an ordinary switch would make the overlay a second writer of the side panel's choice. The overlay switches through `showLanguageUncached` (Task 5), which turns the detector's caches off for that document first. A test pins that the switch writes nothing to storage.
6. **The wire budget** is measured in the preview with the fake's `long` script: bytes per message and per second, per type (Task 8, group check A). The threshold for the roadmap's entries-delta fallback is **a steady `subtitle:entries` message over 64 KB**; below it, no delta. "Steady" means sent after the tail has reached its cap: a message carrying `OVERLAY_ENTRIES` entries or more. The check fails on the largest such message, not on the largest ever (controller ruling M2).
7. **Acceptance** (Task 9):
   - a spike of a headless `--load-extension` run with the Playwright Chromium: the side panel page, a stand-in meeting page, CDP attached to the overlay frame;
   - if it works, it becomes `scripts/dev/extension-overlay-probe.mjs`;
   - if it cannot work, the spike records why, and the acceptance becomes the owner's manual check in a real Meet tab, listed in the roadmap (Task 10).

   Either way `spine-subtitle-probe.mjs` covers the renderer.
8. **`holdToTalk` honours the speaker leg**, in `subtitleSession` (Task 2). That also corrects the Electron takeover's Space hint.
9. **Keyboard hold.** The overlay's hold button holds on pointer down/up and, while focused, on Space/Enter keydown/keyup. After a keyboard release the button blurs, so the button itself does not capture the meeting page's Space afterwards. No Space hint (D16) (Task 3).

   **Focus after a hold is decided** (controller ruling a): after a hold's release the button blurs, and focus stays in the overlay's iframe until the user clicks the page. Handing focus back to the page — a content-script change — is a follow-up only if the owner asks for it.

   **Escape after a hold is accepted** (controller ruling I7): with focus left in the overlay, an Escape meant for the meeting page exits subtitle mode (`useSubtitleChrome.tsx:102-114` listens on the overlay's document). The same focus hand-back follow-up would cover it. Task 9 records where Space and Escape go after a hold.
10. **The preview's overlay renders at the real iframe's default 140 px.** The controller settles the hold button's and the in-band notice's placement by rendering the new overlay, and compares it with the old overlay's markup and CSS by reading them (controller ruling b: the old overlay cannot be rendered from this branch). The new overlay's screenshot goes in the owner's report (Task 8, group check A; Task 10).
11. **A JSON round-trip test covers every wire message type** (Task 1).
12. **Two holds over one runner are accepted:** the panel's Space and the overlay's button share one turn, and either one's release closes it. One user; cost if wrong: a reference-counted press, later.

Already decided and not reopened (survey §5, ruling "already decided"):
- the tail is sliced after the merge;
- no audio crosses the wire;
- hold-to-talk is on the overlay, with no Space hint;
- the overlay's display settings are its own;
- `pagehide` → abandon, with no auto-save when the side panel closes;
- export stays Electron-only;
- no extension build ships before 1e-4, and 1e-4 lands before 1e-3c.

### Choices this plan makes inside the rulings

1. **Stop, then close.** A teardown and a replaced publisher always call the publisher's `stop()` before `wire.close()`. In Chrome, the end that calls `port.disconnect()` gets no `onDisconnect` of its own. So a publisher not stopped first would keep its store subscriptions and any outstanding press (survey G1) (Task 6).
2. **A port the surface refuses is disconnected, not ignored.** An overlay's port stays open while any receiving end holds it. A second side panel that ignored this tab's overlay would keep it alive after its own side panel let it go, and would stop its `sidepanel-gone` from ever firing (Task 6).
3. **`exit` stays the surface's own control**, not the feed's: `exitSubtitleMode()` is the surface's lifecycle (enter → exit → teardown), and the feed carries only the runner's controls (Tasks 4, 6).
4. **Ruling 9 is extended to every release, the pointer's included, and a key hold also ends when the button loses focus.**
   - A pointer down focuses the button (Chrome). Once the button handles Space, a focused button would take the next Space meant for Meet as a hold. The blur is what prevents that, whichever way the hold ended.
   - A key hold whose keyup never arrives — focus moved away — would strand a turn. The panel's `usePushToTalk` releases on blur for the same reason (1e-3b-1 ruling 16).
   - **Accepted, per controller ruling a:** a blurred button leaves the iframe as the focused frame, so keys go to the overlay's document rather than the meeting page until the user clicks the page. A stray Space there does nothing. An Escape exits subtitle mode, which is accepted too (controller ruling I7). Handing focus back to the page (the content script blurring the iframe) is a follow-up only if the owner asks. Task 9's probe records where Space and Escape go after a hold (Task 3).
5. **The side panel refuses a connection it cannot serve.** A connecting overlay with no session attached (`currentSubtitleFeed()` null) is disconnected, with one warning. The overlay then unmounts through its own `sidepanel-gone` (Task 6).
6. **The overlay graph is checked on the built bundle**, not by a source walker. Type-only imports and bundler elision make a static walk of `src/` either miss or invent edges, while the built chunks are exactly what the meeting page loads (group check A).

## File Structure

| File | Change |
|---|---|
| `src/lib/subtitle/wire.ts` (+ `wire.test.ts`), `src/lib/subtitle/wire.json.test.ts`, `src/components/Subtitle/uiLanguage.ts` (+ test) | `subtitle:language`, `PanelSources.language`, `OverlayModel.language`, `OverlayReceiver`, `SUBTITLE_PORT`; the JSON round trip; the side panel's language as a readable (Task 1) |
| `src/lib/subtitle/session.ts` (+ test) | hold-to-talk needs the speaker leg (Task 2) |
| `src/components/Subtitle/HoldToTalk.tsx` (+ test) | Space/Enter hold, release on blur, focus given back (Task 3) |
| `src/app/subtitleFeed.ts` (+ test), `src/app/session.ts`, `src/app/session.test.ts` | the feed leaf, registered by `attach()` (Task 4) |
| `src/components/Subtitle/ConnectedOverlay.tsx` (+ test), `src/components/dev/OverlayPreview.tsx`, `src/locales/index.ts` (+ `src/locales/showLanguageUncached.test.ts`) | the overlay drawn from its wire, in the side panel's language, never stored; the preview mounts it (Task 5) |
| `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts` (+ test), `src/components/Subtitle/subtitleEnterGate.ts` | the publisher, tab-scoped ports, stop-then-close, `?tabId=`, the gate's comment (Task 6) |
| `src/lib/subtitle/overlayPort.ts` (+ test), `src/subtitle-overlay-entry.tsx` (+ `src/subtitle-overlay-entry.test.tsx`), `src/lib/diagnostics/consoleLedger.consistency.test.ts` | the overlay page on the wire; the ledger row gone (Task 7) |
| `src/components/dev/wireTally.ts` (+ test), `src/components/dev/SpinePreview.tsx`, `src/components/dev/SpinePreview.scss`, `scripts/dev/spine-subtitle-probe.mjs` | the overlay frame at 140 px, the language on the preview's wire, the wire measured (Task 8) |
| `scripts/dev/extension-overlay-probe.mjs` | the spike's probe, if it works (Task 9) |
| `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` | the controller's record (Task 10) |

**Order and parallelism.**
- **Wave 1:** Tasks 1, 2, 3 and 4 touch disjoint files and may run in parallel.
- **Wave 2:**
  - Task 5 needs Task 1.
  - Task 6 needs Tasks 1 and 4.
  - Task 8 needs Task 1.
  - Tasks 5, 6 and 8 touch disjoint files and may run in parallel once their dependencies have landed.
- **Task 7** needs Tasks 1 and 5; it runs beside Task 6 or 8 if they are still going (disjoint files).
- **Within a wave**, the gates follow the parallel-wave rule in Global Constraints (controller ruling I1). The controller runs the full gates after Wave 1, after Wave 2, and after Task 7.
- **Group check A** (controller) comes after Tasks 5–8.
- **Task 9** (the spike) needs everything before it and then **group check B**.
- **Task 10** comes last.

---

### Task 1: The wire carries the side panel's language; every message is pinned JSON-safe

**Files:** Modify `src/lib/subtitle/wire.ts`, `src/lib/subtitle/wire.test.ts`; Create `src/lib/subtitle/wire.json.test.ts`, `src/components/Subtitle/uiLanguage.ts`, `src/components/Subtitle/uiLanguage.test.ts`.

**Interfaces:**
- **Produces** (`wire.ts`):
  - `SUBTITLE_PORT = 'sokuji-subtitle'`;
  - `ToOverlay` gains `{ type: 'subtitle:language'; language: string }`;
  - `PanelSources.language?: Readable<string>`;
  - `OverlayModel.language: string | null`;
  - `export type OverlayReceiver = Readable<OverlayModel> & { send(message: ToPanel): void; dispose(): void }`, now `receiveSubtitles`'s return type.
- **Produces** (`uiLanguage.ts`): `languageOf(instance: Pick<I18n, 'language' | 'on' | 'off'>): Readable<string>` and `uiLanguage: Readable<string>` (over `src/locales`' instance).
- **Consumed by:** Task 5 (`OverlayReceiver`, `OverlayModel.language`), Task 6 (`SUBTITLE_PORT`, `language`, `uiLanguage`), Task 7 (`SUBTITLE_PORT`, `OverlayReceiver`) and Task 8 (`uiLanguage`, the preview's wire).

- [ ] **Step 1: Write the failing tests.**
  - `wire.test.ts`: new cases in the file's `describe('the subtitle wire')`, after "sends session before entries before karaoke on connect".
    1. **Language first, when the side panel has one.**
       - The case "sends session before entries before karaoke on connect", with `language: box('ja')` added to its sources: `order` is `['subtitle:language', 'subtitle:session', 'subtitle:entries', 'subtitle:karaoke']`.
       - Without `language` (the existing case) the order is unchanged.
    2. **A language change is sent once; the same language again sends nothing.**
       - A recording port (`post` pushes into `sent`); sources as in case 1 with `language = box('en')`; publish. `sent` now holds 4 messages.
       - `language.set('ja')` → `sent` has 5, the last `{ type: 'subtitle:language', language: 'ja' }`.
       - `language.set('ja')` again (the box notifies) → still 5.
    3. **The overlay holds the language it heard, null before.**
       - `setup()` publishes no language, so `received.get().language === null`.
       - `panel.post({ type: 'subtitle:language', language: 'ja' })` → `'ja'`, and a subscribed listener is called once.
    4. **The overlay ignores a language that is not a non-empty string.**
       - After case 3's `'ja'`, `panel.post({ type: 'subtitle:language' })`, `{ …, language: 3 }` and `{ …, language: '' }` each leave `received.get().language` at `'ja'`.
    5. **A stopped publisher sends no language.**
       - `const [panel, overlay] = portPair(); const received = receiveSubtitles(overlay); const language = box('ja');`
       - `publishSubtitles(panel, { entries: box<readonly Entry[]>([notice(1)]), session: box(session), karaoke: box<KaraokeState>({ lit: new Map(), replaying: null }), language }, controls())` → `received.get().language === 'ja'`.
       - `overlay.disconnect()`, then `language.set('fr')` → `received.get().language` stays `'ja'`.
  - `wire.json.test.ts` (new). Its header:

    ```ts
    /**
     * Chrome's extension messaging carries JSON (plan 1e-4 ruling 11): every
     * message the wire sends must survive `JSON.stringify` → `JSON.parse`
     * unchanged. The preview's `MessageChannel` clones structurally, which would
     * pass a `Map` or a typed array silently. `wire.test.ts`'s port pair clones
     * through JSON as well, but asserts only what each case needs, over notice
     * fixtures. Here every message type is sent with every optional field filled,
     * and equality is asserted.
     */
    ```

    Fixtures:

    ```ts
    const exchange: Entry = {
      kind: 'exchange', id: 'e1', leg: 'speaker', languages: { source: 'ja', target: 'en' }, pairing: 'inferred', t: 1_000,
      source: [
        { key: 'r:speaker:1:0', segmentId: 'r:speaker:1', side: 'source', start: 0, end: 6, text: '今日は天気が', final: true, language: 'ja' },
        { key: 'r:speaker:1:1', segmentId: 'r:speaker:1', side: 'source', start: 6, end: 12, text: 'いいですね。', final: false },
      ],
      translation: [{ key: 'r:speaker:2:0', segmentId: 'r:speaker:2', side: 'translation', start: 0, end: 26, text: 'The weather is nice today.', final: true }],
    };
    const notice: Entry = { kind: 'notice', id: 'n1', leg: 'participant', severity: 'error', message: 'No speech model for en.', code: 'no_asr', params: { source: 'en', count: 2 }, at: 2_000 };
    const sessions: SubtitleSession[] = [
      { phase: 'running', since: 1_758_000_000_000, legs: ['speaker', 'participant'], pair: { source: 'ja', target: 'en' }, holdToTalk: true, canStart: false, idle: { kind: 'ended' } },
      { phase: 'idle', since: null, legs: ['speaker'], pair: null, holdToTalk: false, canStart: true, idle: { kind: 'failed', notice: { code: 'start_failed', message: 'boom', params: { attempt: 1 } } } },
      { phase: 'idle', since: null, legs: [], pair: { source: 'en', target: 'ja' }, holdToTalk: false, canStart: false, idle: { kind: 'unready', message: 'r', code: 'no_asr', params: { source: 'en' } } },
      { phase: 'starting', since: null, legs: ['speaker'], pair: null, holdToTalk: false, canStart: false, idle: { kind: 'starting' } },
    ];
    const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
    ```

    Also `box<T>()`, copied from `wire.test.ts:36-44`, and a compile-time helper:

    ```ts
    /** What JSON can carry of `T`: a `Map`, a `Set`, a `Date`, a typed array or a function anywhere in it turns its place into `never`. */
    type JsonShaped<T> = T extends string | number | boolean | null | undefined
      ? T
      : T extends (...args: never[]) => unknown
        ? never
        : T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown> | Date | ArrayBufferView
          ? never
          : T extends readonly (infer U)[]
            ? readonly JsonShaped<U>[]
            : { [K in keyof T]: JsonShaped<T[K]> };
    ```

    This helper was checked against today's `ToOverlay` / `ToPanel`: both read `true`. A message type with an optional `ReadonlyMap` inside an interface inside an array reads `false`, and the assignment below then fails the typecheck gate.

    Cases:
    1. **The wire's message types are JSON-shaped, as the typecheck gate sees them.**

       ```ts
       // Fails to compile, not to run, when a message type grows a Map, Set, Date, typed array or function.
       const toOverlay: ToOverlay extends JsonShaped<ToOverlay> ? true : false = true;
       const toPanel: ToPanel extends JsonShaped<ToPanel> ? true : false = true;
       expect([toOverlay, toPanel]).toEqual([true, true]);
       ```

    2. **Every message the side panel sends survives a round trip unchanged.**
       - Setup:
         - a recording port: `post` pushes into `sent`, the other three members are no-ops;
         - `clock = createVirtualClock()`;
         - sources `entries = box<readonly Entry[]>([exchange])`, `session = box(sessions[0])`, `karaoke = box<KaraokeState>({ lit: new Map([['r:speaker:1', 7]]), replaying: null })` and `language = box('ja')`;
         - `publishSubtitles(port, { entries, session, karaoke, language }, { clear: vi.fn(), exit: vi.fn(), press: vi.fn(), release: vi.fn() }, clock)`.
       - Then:
         - `sessions.slice(1).forEach((s) => session.set(s))`;
         - `entries.set([exchange, notice])` and `clock.advance(ENTRIES_INTERVAL_MS)`;
         - `karaoke.set({ lit: new Map([['r:speaker:1', 12], ['r:speaker:2', 26]]), replaying: 'r:speaker:1' })`;
         - `language.set('zh_CN')`.
       - Assertions:
         - `sent` has length 10: 4 first sends, 3 sessions, 1 entries, 1 karaoke, 1 language;
         - the set of their `type`s is exactly the four `ToOverlay` types;
         - `for (const m of sent) expect(roundTrip(m)).toEqual(m)`.
    3. **The overlay, fed the round-tripped messages, holds what the side panel sent.**
       - A receiver over a port whose `onMessage` keeps its listeners.
       - A panel port whose `post(m)` hands every listener `roundTrip(m)`.
       - Publish `{ entries: box([exchange, notice]), session: box(sessions[1]), karaoke: box({ lit: new Map([['r:speaker:1', 7]]), replaying: null }), language: box('ja') }`.
       - Then `received.get()` `toEqual({ entries: [exchange, notice], session: sessions[1], lit: new Map([['r:speaker:1', 7]]), language: 'ja' })`.
    4. **Every control the overlay sends survives a round trip.**
       - `receiveSubtitles` over a recording port; `send` each of the four `ToPanel` messages.
       - The recorded posts `toEqual` those four in order, and each `roundTrip(m)` `toEqual(m)`.
    5. **The check catches what JSON loses**, pinning that `toEqual` is strict enough:
       - `roundTrip({ lit: new Map([['a', 1]]) })` is `not.toEqual` the original;
       - so are `{ pcm: Int16Array.of(1, 2) }`, `{ at: new Date(0) }` and `{ n: Number.NaN }`.
  - `uiLanguage.test.ts` (new). The fake:

    ```ts
    function fakeI18n(language: string) {
      const handlers = new Set<() => void>();
      const fake = {
        language,
        on: (_event: string, handler: () => void) => { handlers.add(handler); },
        off: (_event: string, handler: () => void) => { handlers.delete(handler); },
      };
      return { fake: fake as unknown as Pick<I18n, 'language' | 'on' | 'off'>, handlers, change(next: string) { fake.language = next; handlers.forEach((h) => h()); } };
    }
    ```

    Cases:
    1. `languageOf(fakeI18n('ja').fake).get()` is `'ja'`.
    2. A subscribed listener is called once by `change('fr')`, and `get()` is then `'fr'`.
    3. After the unsubscribe, `handlers.size === 0`, and `change('de')` calls the listener no more.
    4. `uiLanguage.get()` equals `i18n.language` (`import i18n from '../../locales'`).
- [ ] **Step 2: Run** `npx vitest run src/lib/subtitle src/components/Subtitle/uiLanguage.test.ts`. What fails and why:
  - `wire.test.ts` cases 1–5 fail: there is no `language` source and no `subtitle:language`.
  - `wire.json.test.ts` cases 2–3 fail: the `language` source is ignored, so there are fewer sends and no `language` in the model.
  - `uiLanguage.test.ts` fails to load: there is no module.

  **Already passing before the implementation** (controller ruling M3): `wire.json.test.ts` cases 1, 4 and 5 pin what today's wire already guarantees — the message types are JSON-shaped, the controls survive a round trip, and `toEqual` sees what JSON loses. They guard the new message and every later change; they are not proof of this task.
- [ ] **Step 3: Implement.**
  - `wire.ts`:

    ```ts
    /** The `chrome.runtime` port's name, on both ends: the overlay connects with it, the side panel accepts only it (plan 1e-4). */
    export const SUBTITLE_PORT = 'sokuji-subtitle';

    /** Side panel → overlay. */
    export type ToOverlay =
      | { type: 'subtitle:language'; language: string }
      | { type: 'subtitle:entries'; entries: readonly Entry[] }
      | { type: 'subtitle:session'; session: SubtitleSession }
      | { type: 'subtitle:karaoke'; lit: ReadonlyArray<readonly [SegmentId, number]> };
    ```

    `PanelSources` gains:

    ```ts
      /**
       * The side panel's interface language (plan 1e-4 ruling 5): the overlay's
       * own detection reads storage that sits inside the meeting page, which is
       * untested. Absent: nothing is sent, and the overlay keeps its own.
       */
      language?: Readable<string>;
    ```

    In `publishSubtitles`:
    - add `let language: string | null = null;` beside `entries` / `session` / `karaoke`, and

      ```ts
      const sendLanguage = () => {
        if (!sources.language) return;
        const next = sources.language.get();
        if (next === language) return;
        language = next;
        post({ type: 'subtitle:language', language: next });
      };
      ```

    - after the existing `offs.push(…)`, add `if (sources.language) offs.push(sources.language.subscribe(sendLanguage));`, so everything is subscribed before the first send, as the comment above says;
    - the first sends become `sendLanguage(); sendSession(); sendEntries(); sendKaraoke();`, and their comment: "First sends go language → session → entries → karaoke: the overlay picks its words before it draws, and a connect mid-run never draws one frame of "Session ended" before the session lands."

    The function's doc gains "…the side panel's language when it has one, then session, …".

    `OverlayModel` gains `/** The side panel's interface language; null until it has sent one. */ language: string | null;`, and `NOTHING` gains `language: null`.

    ```ts
    /** The overlay's end: the model as last heard, and the way back. */
    export type OverlayReceiver = Readable<OverlayModel> & { send(message: ToPanel): void; dispose(): void };
    ```

    `receiveSubtitles(port: WirePort): OverlayReceiver`, with a case in its switch:

    ```ts
      case 'subtitle:language': {
        const language = (m as { language?: unknown }).language;
        if (typeof language === 'string' && language !== '') set({ ...model, language });
        return;
      }
    ```

    `chromePortWire`'s doc: "(plan 1e-4 wires them)" in place of "(plan 1e wires them)".
  - `uiLanguage.ts`:

    ```ts
    /**
     * The side panel's interface language, for the overlay's wire (plan 1e-4
     * ruling 5). The picker changes i18next directly (`HelpSection`), so no
     * store holds it; and the overlay cannot read it for itself — its
     * `localStorage` sits inside the meeting page.
     */
    import type { i18n as I18n } from 'i18next';
    import i18n from '../../locales';
    import type { Readable } from '../../lib/view/conversationView';

    /** An i18next instance's language as a `Readable`: its `language`, and its `languageChanged` event. */
    export function languageOf(instance: Pick<I18n, 'language' | 'on' | 'off'>): Readable<string> {
      return {
        get: () => instance.language,
        subscribe(listener) {
          const handler = () => listener();
          instance.on('languageChanged', handler);
          return () => instance.off('languageChanged', handler);
        },
      };
    }

    /** The app's own interface language. */
    export const uiLanguage: Readable<string> = languageOf(i18n);
    ```

    (`settingsStore` already imports `src/locales`, `settingsStore.ts:33`, so this adds no module to any graph that imports the store.)
- [ ] **Step 4: Run** the same two paths, then `npx vitest run src` and the typecheck gate (17 lines).
- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/subtitle/wire.ts src/lib/subtitle/wire.test.ts src/lib/subtitle/wire.json.test.ts src/components/Subtitle/uiLanguage.ts src/components/Subtitle/uiLanguage.test.ts
  ```

  ```bash
  git commit -q -F - -- src/lib/subtitle/wire.ts src/lib/subtitle/wire.test.ts src/lib/subtitle/wire.json.test.ts src/components/Subtitle/uiLanguage.ts src/components/Subtitle/uiLanguage.test.ts <<'EOF'
  feat(subtitle): the overlay's wire carries the side panel's language; its messages pinned JSON-safe

  <body: the new message and source, the receiver's model, OverlayReceiver,
  SUBTITLE_PORT, the round-trip test and its compile-time half>

  Co-Authored-By: <implementing model>
  EOF
  ```

**Probes:** none. Nothing publishes a language until Tasks 6 and 8.

---

### Task 2: Hold-to-talk needs the speaker leg

**Files:** Modify `src/lib/subtitle/session.ts`, `src/lib/subtitle/session.test.ts`.

**Interfaces:**
- **Produces:** `SubtitleSession.holdToTalk` is true only while running, under manual turns, with a speaker leg in the run.
- **Consumed by:** `SubtitleView`: the overlay's `HoldToTalk` and the takeover's Space hint. Both follow with no change of their own. MainPanel's own gate (`speakerLive && subtitle.holdToTalk`, `MainPanel.tsx:215,251`) was already stricter and is unchanged.

- [ ] **Step 1: Write the failing test** in `session.test.ts`'s `describe('subtitleSession')`: **"offers hold-to-talk only when the run has a speaker leg (plan 1e-4 ruling 8)"**.
  - `run: { phase: 'running', since: 1000, legs: { participant: 'live' } }` with `turnMode: 'push-to-talk'` → `holdToTalk === false`.
  - `legs: { speaker: 'live', participant: 'live' }` with `turnMode: 'push-to-translate'` → `true`.
  - `legs: { speaker: 'reconnecting' }` with `turnMode: 'push-to-talk'` → `true`: the leg is in the run, and a press during a reconnect is the runner's to ignore.

  The existing case at `session.test.ts:41-46` (speaker only) is unchanged.
- [ ] **Step 2: Run** `npx vitest run src/lib/subtitle/session.test.ts`. The new case fails on its participant-only expectation. Its other two expectations (a run with a speaker leg) already hold today; they pin that the fix keeps them.
- [ ] **Step 3: Implement.**
  - The `holdToTalk` doc: `/** A run is live under manual turns with a speaker leg to hold (plan 1e-4 ruling 8): the surface offers its hold control. */`
  - In `subtitleSession`:

    ```ts
        // A press opens a turn on the speaker leg only (`Run.press`, run.ts:275-281):
        // a participant-only run offers no hold — it would do nothing.
        holdToTalk: run.phase === 'running' && turnMode !== 'auto' && run.legs.speaker !== undefined,
    ```

- [ ] **Step 4: Run** `npx vitest run src/lib/subtitle src/components/Subtitle src/components/MainPanel`, then the full suite and the gate.
- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/subtitle/session.ts src/lib/subtitle/session.test.ts
  ```

  ```bash
  git commit -q -F - -- src/lib/subtitle/session.ts src/lib/subtitle/session.test.ts <<'EOF'
  fix(subtitle): hold-to-talk only when the run has a speaker leg

  <body>

  Co-Authored-By: <implementing model>
  EOF
  ```

**Probes:** `spine-subtitle-probe.mjs '…&turn=push-to-talk'` (group check A) still shows the hold button: its run has a speaker leg.

---

### Task 3: The overlay's hold button holds on Space and Enter, and gives the keyboard back

**Files:** Modify `src/components/Subtitle/HoldToTalk.tsx`, `src/components/Subtitle/HoldToTalk.test.tsx`.

**Interfaces:**
- **Produces:** `HoldToTalk`'s props are unchanged. Behaviour:
  - Space/Enter keydown and keyup hold while focused, with their default prevented;
  - a blur releases;
  - every release blurs the button.
- **Consumed by:** `SubtitleView` on `extension-overlay`.

- [ ] **Step 1: Write the failing tests** in `HoldToTalk.test.tsx` (the file's `react-i18next` mock returns the fallback):
  1. **Holds on Space while focused.**
     - `button.focus()`, then `fireEvent.keyDown(button, { key: ' ' })` three times (auto-repeat) → `onPress` called once, text `Release`.
     - `fireEvent.keyUp(button, { key: ' ' })` → `onRelease` once, text `Hold`.
  2. **Holds on Enter the same way**, one press and one release.
  3. **Takes the key from the button.** `expect(fireEvent.keyDown(button, { key: ' ' })).toBe(false)` and `expect(fireEvent.keyUp(button, { key: ' ' })).toBe(false)`: the default is prevented, so the button never also activates and nothing scrolls.
  4. **Leaves every other key alone.** `fireEvent.keyDown(button, { key: 'a' })` and `{ key: 'Escape' }` each return `true` (not prevented), and `onPress` is never called. Escape stays `useSubtitleChrome`'s.
  5. **Gives focus back after a keyboard release, and after a pointer release.**
     - `button.focus()`, key hold, key release → `document.activeElement !== button`.
     - `button.focus()`, `fireEvent.pointerDown(button)`, `fireEvent.pointerUp(button)` → `document.activeElement !== button`.
  6. **A key hold ends when the button loses focus.** `button.focus()`, `keyDown ' '`, `fireEvent.blur(button)` → `onRelease` once; a later `keyUp ' '` releases nothing more (still once).
  7. **A key does not press again while the pointer holds.** `fireEvent.pointerDown(button)` → `onPress` once; `keyDown ' '` → still once; `keyUp ' '` → `onRelease` once: either release ends the hold (choice 4).

  The four existing cases stay unchanged.
- [ ] **Step 2: Run** `npx vitest run src/components/Subtitle/HoldToTalk.test.tsx`. Cases 1–3 and 5–7 fail.
- [ ] **Step 3: Implement.**

  ```tsx
  import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
  import { useTranslation } from 'react-i18next';
  import { Mic } from 'lucide-react';

  /** The keys that hold the button while it has focus (plan 1e-4 ruling 9). */
  const HOLD_KEYS = new Set([' ', 'Enter']);

  /**
   * Hold to talk, on the extension overlay: pointer down presses; up, leave and
   * cancel release — dragging off the button must release, which today's panel
   * button does not do. While it has focus, Space or Enter held down holds it
   * too (plan 1e-4 ruling 9). A held button that goes away, or loses focus,
   * releases. After every release the button gives up focus: the overlay sits
   * inside a meeting page, and a focused button would take the page's own
   * Space — Google Meet's push-to-unmute — as a hold of Sokuji's.
   */
  export function HoldToTalk({ onPress, onRelease }: { onPress: () => void; onRelease: () => void }) {
    const { t } = useTranslation();
    const [held, setHeld] = useState(false);
    const heldRef = useRef(false);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const releaseRef = useRef(onRelease);
    releaseRef.current = onRelease;
    const begin = () => {
      if (heldRef.current) return;
      heldRef.current = true;
      setHeld(true);
      onPress();
    };
    const end = () => {
      if (!heldRef.current) return;
      heldRef.current = false;
      setHeld(false);
      onRelease();
      // Hand the keyboard back (choice 4). The blur fires `onBlur`, which finds nothing held.
      buttonRef.current?.blur();
    };
    const press = (event: ReactPointerEvent<HTMLButtonElement>) => {
      // (the existing comment on primary-button-only presses, unchanged)
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      begin();
    };
    const keyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (!HOLD_KEYS.has(event.key)) return;
      // The key holds; it does not also activate the button or scroll.
      event.preventDefault();
      // A held key's auto-repeat finds the button held already.
      begin();
    };
    const keyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (!HOLD_KEYS.has(event.key)) return;
      event.preventDefault();
      end();
    };
    useEffect(() => () => {
      if (heldRef.current) releaseRef.current();
    }, []);
    return (
      <div className="subtitle-hold">
        <button
          ref={buttonRef}
          type="button"
          className={`subtitle-idle__action subtitle-hold__button${held ? ' is-held' : ''}`}
          onPointerDown={press}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
          onKeyDown={keyDown}
          onKeyUp={keyUp}
          // A key hold whose keyup went elsewhere would strand the turn (choice 4; the panel's usePushToTalk does the same).
          onBlur={end}
        >
          <Mic size={15} />
          <span>{held ? t('simplePanel.release', 'Release') : t('simplePanel.holdToSpeak', 'Hold')}</span>
        </button>
      </div>
    );
  }
  ```

- [ ] **Step 4: Run** `npx vitest run src/components/Subtitle`, then the full suite and the gate.
- [ ] **Step 5: Commit**

  ```bash
  git add src/components/Subtitle/HoldToTalk.tsx src/components/Subtitle/HoldToTalk.test.tsx
  ```

  ```bash
  git commit -q -F - -- src/components/Subtitle/HoldToTalk.tsx src/components/Subtitle/HoldToTalk.test.tsx <<'EOF'
  feat(subtitle): the overlay's hold button holds on Space and Enter, and gives the keyboard back

  <body: ruling 9, extended to pointer releases and a blur (choice 4); focus
  after a hold stays in the overlay's iframe until a click on the page —
  decided (controller rulings a, I7)>

  Co-Authored-By: <implementing model>
  EOF
  ```

**Probes:** `spine-subtitle-probe.mjs '…&turn=push-to-talk'` (group check A) still holds with synthetic pointer events.

---

### Task 4: The subtitle feed — the session for code that must not import the root

**Files:** Create `src/app/subtitleFeed.ts`, `src/app/subtitleFeed.test.ts`; Modify `src/app/session.ts`, `src/app/session.test.ts`.

**Interfaces:**
- **Produces:**
  - `interface SubtitleFeed { sources: Pick<PanelSources, 'entries' | 'session' | 'karaoke'>; clear(): void; press(): void; release(): void }`;
  - `registerSubtitleFeed(feed: SubtitleFeed): () => void`;
  - `currentSubtitleFeed(): SubtitleFeed | null`.
  - `AppSession.attach()` registers the page's feed for as long as it is attached.
- **Consumed by:** Task 6 (the surface class).

- [ ] **Step 1: Write the failing tests.**
  - `subtitleFeed.test.ts` (new). A stub feed: `sources` of three `{ get: () => null, subscribe: () => () => {} }` cast `as unknown as SubtitleFeed['sources']`, and no-op controls.
    1. `currentSubtitleFeed()` is `null` before any registration.
    2. `const off = registerSubtitleFeed(a)` → `currentSubtitleFeed()` is `a`; `off()` → `null`.
    3. **An older unregister leaves a newer registration alone.** `offA = register(a)`, `offB = register(b)`, `offA()` → still `b`; `offB()` → `null`.
  - `session.test.ts`, in `describe('attach')`: **"registers the subtitle feed the extension overlay's publisher reads, only while attached (plan 1e-4 ruling 1)"**.
    - `setup()`; `expect(currentSubtitleFeed()).toBeNull()`; `const detach = session.attach()`.
    - `feed.sources.session` is `session.subtitle`, `feed.sources.karaoke` is `session.karaoke`, and `feed.sources.entries.get()` is `session.view.get().entries`.
    - `vi.spyOn(session.runner, 'press')`, and likewise `'release'` and `'clear'`; `feed.press()`, `feed.release()`, `feed.clear()` → each spy called once.
    - `detach()` → `currentSubtitleFeed()` is `null`.

    (`import { currentSubtitleFeed } from './subtitleFeed';` at the top.)
- [ ] **Step 2: Run** `npx vitest run src/app/subtitleFeed.test.ts src/app/session.test.ts`. Both files fail to load, because `./subtitleFeed` does not exist yet, so every case in `session.test.ts` fails with them. That file's existing cases pass again once the module exists. The new `attach` case then fails only while `attach()` registers nothing.
- [ ] **Step 3: Implement.**
  - `subtitleFeed.ts`:

    ```ts
    /**
     * What the extension overlay's publisher reads, for code that must not
     * import the session's module graph — the side panel's surface class
     * (`ExtensionContentScriptSubtitleSurface`). `settingsStore` imports that
     * class and the root imports the stores, so a static import of the root
     * from there would close a cycle and pull the runner into every page that
     * imports the store — the meeting page's overlay among them (plan 1e-4
     * ruling 1). `attach()` registers the page's session for as long as it is
     * attached; before that, and after its detach, there is none.
     */
    import type { PanelSources } from '../lib/subtitle/wire';

    export interface SubtitleFeed {
      /** The conversation's entries, the subtitle session and karaoke. */
      sources: Pick<PanelSources, 'entries' | 'session' | 'karaoke'>;
      /** The runner's: what the overlay's Clear and hold button reach. */
      clear(): void;
      press(): void;
      release(): void;
    }

    let feed: SubtitleFeed | null = null;

    /** Registers the page's feed. The returned call unregisters it — unless a later registration replaced it. */
    export function registerSubtitleFeed(next: SubtitleFeed): () => void {
      feed = next;
      return () => {
        if (feed === next) feed = null;
      };
    }

    export function currentSubtitleFeed(): SubtitleFeed | null {
      return feed;
    }
    ```

  - `session.ts`: `import { registerSubtitleFeed } from './subtitleFeed';`. In `attach()`, right after the provider lock's `offs.push(…)`:

    ```ts
          // The extension overlay's publisher reaches the session through this
          // leaf, for as long as the page is attached: the side panel's surface
          // class cannot import the root (plan 1e-4 ruling 1).
          offs.push(registerSubtitleFeed({
            sources: { entries: { get: () => view.get().entries, subscribe: view.subscribe }, session: subtitle, karaoke },
            clear: () => runner.clear(),
            press: () => runner.press(),
            release: () => runner.release(),
          }));
    ```

    `AppSession.attach`'s doc gains "the subtitle feed the extension overlay's publisher reads" in its list.
- [ ] **Step 4: Run** `npx vitest run src/app`, then the full suite and the gate.
- [ ] **Step 5: Commit**

  ```bash
  git add src/app/subtitleFeed.ts src/app/subtitleFeed.test.ts src/app/session.ts src/app/session.test.ts
  ```

  ```bash
  git commit -q -F - -- src/app/subtitleFeed.ts src/app/subtitleFeed.test.ts src/app/session.ts src/app/session.test.ts <<'EOF'
  feat(app): the subtitle feed, registered while the page is attached

  <body>

  Co-Authored-By: <implementing model>
  EOF
  ```

**Probes:** every `spine-*` probe still passes: the preview attaches too, and its feed is unused (group check A).

---

### Task 5: The overlay drawn from its wire, in the side panel's language

**Files:** Create `src/components/Subtitle/ConnectedOverlay.tsx`, `src/components/Subtitle/ConnectedOverlay.test.tsx`, `src/locales/showLanguageUncached.test.ts`; Modify `src/components/dev/OverlayPreview.tsx`, `src/locales/index.ts`.

**Interfaces:**
- **Produces:**
  - `ConnectedOverlay({ receiver }: { receiver: OverlayReceiver }): JSX.Element`;
  - `showLanguageUncached(lng: string): Promise<string>` (`src/locales/index.ts`, controller ruling M11).
- **Consumed by:** Task 7 (the overlay page) and `OverlayPreview` (the preview's iframe). Nothing else calls `showLanguageUncached`: it is the overlay's own path.

- [ ] **Step 1: Write the failing tests.**
  - `src/locales/showLanguageUncached.test.ts` (new). The real i18n instance, no mocks. Vitest isolates modules per file, so turning the cache off here touches no other test file. **"shows a language without writing it to this document's storage (controller ruling M11)"**:
    1. `await changeLanguageWithLoad('de')` → `localStorage.getItem('i18nextLng') === 'de'`. This is the control: the ordinary path does cache, so the assertions below mean something.
    2. `setItem = vi.spyOn(Storage.prototype, 'setItem')` (a file-level `let setItem: MockInstance`); `await showLanguageUncached('ja')` → `i18n.language === 'ja'`, `localStorage.getItem('i18nextLng') === 'de'`, and `setItem.mock.calls.filter(([key]) => key === 'i18nextLng')` equals `[]`.
    3. `await changeLanguageWithLoad('fr')` → `i18n.language === 'fr'`, and `localStorage.getItem('i18nextLng')` is still `'de'`: the cache stays off for the rest of the document's life.
    4. `afterAll`: `setItem.mockRestore()`, `localStorage.removeItem('i18nextLng')`.
  - `ConnectedOverlay.test.tsx`. The mocks, all hoisted:
  - `vi.mock('../../locales', () => ({ showLanguageUncached }))`, with `showLanguageUncached = vi.fn(async (lng: string) => lng)`;
  - `vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, d?: string) => d ?? k, i18n: i18nStub }) }))`, with `i18nStub = { language: 'en' }`;
  - `vi.mock('../../lib/diagnostics/report', async (orig) => ({ ...(await orig()), reportWarning }))`;
  - `vi.mock('./SubtitleView', () => ({ SubtitleView: (props) => { captured.push(props); return null; } }))`.

  The receiver is a real `receiveSubtitles` over a test port:

  ```ts
  function overlayPort() {
    const listeners = new Set<(m: unknown) => void>();
    const posted: unknown[] = [];
    const port: WirePort = { post: (m) => { posted.push(m); }, onMessage: (l) => { listeners.add(l); return () => { listeners.delete(l); }; }, onDisconnect: () => () => {}, close: () => {} };
    return { port, posted, deliver: (m: unknown) => act(() => { listeners.forEach((l) => l(m)); }) };
  }
  ```

  Each case resets `captured`, `i18nStub.language = 'en'` and the spies.
  1. **Draws `SubtitleView` as the extension overlay, from what arrived.**
     - Render; `deliver({ type: 'subtitle:session', session })` with a running session, then `deliver({ type: 'subtitle:entries', entries: [notice] })`.
     - The last props have `surface: 'extension-overlay'`, `model.session` equal to that session, and `model.entries` of length 1.
  2. **Sends the four controls back and offers no start, stop or Settings.**
     - From the last props' `controls`: `exit()`, `clear()`, `press()`, `release()` → `posted` equals `[{ type: 'subtitle:user-exit' }, { type: 'subtitle:request-clear' }, { type: 'subtitle:turn-press' }, { type: 'subtitle:turn-release' }]`.
     - `controls.start`, `controls.stop` and `controls.openSettings` are `undefined` (ruling 2).
  3. **Switches this document to the side panel's language once it arrives, and only when it differs** (controller ruling M4: this exercises the guard itself, not only the effect's dependencies).
     - Render → `showLanguageUncached` not called: the model's language is null.
     - **The guard, on arrival.** `i18nStub.language = 'ja'`; `deliver({ type: 'subtitle:language', language: 'ja' })` → still not called: the document already shows it.
     - `deliver({ type: 'subtitle:language', language: 'fr' })` → called once, with `'fr'`. Then `i18nStub.language = 'fr'`, as the real switch would leave it.
     - **The same language twice → one call.** Unmount, then render a fresh `ConnectedOverlay` over the same receiver, whose model still holds `'fr'`. The new component's effect runs on mount and the guard stops it: `showLanguageUncached` stays at one call. Delivering `'fr'` again leaves it at one as well.
  4. **Reports a switch that failed, once.** `showLanguageUncached.mockRejectedValueOnce(new Error('offline'))`; deliver `'ko'` → `await vi.waitFor` → `reportWarning` called once with `('SubtitleOverlay', expect.stringContaining('ko'), expect.objectContaining({ dedupeKey: 'overlay:language' }))`. In the real module a failed catalogue load never rejects — `loadTranslation` swallows it (`src/locales/index.ts:81-83`) — so this path is reached only if i18next's `changeLanguage` itself rejects. The `.catch` stays: without it that would be an unhandled rejection.
  5. **Keeps its controls' identity across renders.** `captured[0].controls` is `captured.at(-1).controls` after two deliveries.

  `OverlayPreview.test.tsx` stays as it is and must still pass: its `vi.mock('../Subtitle/SubtitleView', …)` resolves to the same module `ConnectedOverlay` imports.
- [ ] **Step 2: Run** `npx vitest run src/components/Subtitle/ConnectedOverlay.test.tsx src/components/dev/OverlayPreview.test.tsx src/locales/showLanguageUncached.test.ts`.
  - `ConnectedOverlay.test.tsx` fails to load: there is no module.
  - `showLanguageUncached.test.ts` fails: the export is missing. Its control step 1 would pass today on its own.
  - `OverlayPreview.test.tsx` passes before and after: it pins that the preview is unchanged.
- [ ] **Step 3: Implement.**
  - `src/locales/index.ts`, after `changeLanguageWithLoad`:

    ```ts
    let cachingLanguage = true;

    /**
     * Shows `lng` in this document without storing it as the document's own
     * choice. The extension overlay follows the side panel's language (plan 1e-4
     * ruling 5), and its storage may be the side panel's: an ordinary switch
     * would cache `i18nextLng` there, a second writer of the side panel's choice
     * (controller ruling M11). The first call turns the language detector's
     * caches off for the rest of this document's life — through `init`, the
     * detector module's own API. Only the overlay's page calls this.
     */
    export async function showLanguageUncached(lng: string): Promise<string> {
      if (cachingLanguage) {
        cachingLanguage = false;
        i18n.services.languageDetector?.init?.(i18n.services, { ...i18n.options.detection, caches: [] }, i18n.options);
      }
      return changeLanguageWithLoad(lng);
    }
    ```

    (i18next 25.10: `changeLanguage` → `languageDetector.cacheUserLanguage(l)`, whose default `caches` is the detector's `options.caches`. `init` rebuilds those options with `defaults(options, this.options, getDefaults())`, so an explicit `caches: []` wins, and `cacheUserLanguage` then writes nothing. `i18n.services.languageDetector` is typed `any`.)
  - `ConnectedOverlay.tsx`:

    ```tsx
    import { useEffect, useMemo } from 'react';
    import { useTranslation } from 'react-i18next';
    import { describeCause, reportWarning } from '../../lib/diagnostics/report';
    import type { OverlayReceiver } from '../../lib/subtitle/wire';
    import { showLanguageUncached } from '../../locales';
    import { useReadable } from '../Conversation/useReadable';
    import { SubtitleView, type SubtitleControls } from './SubtitleView';

    /**
     * The extension overlay, drawn from its wire (plan 1e-4): the model the side
     * panel last sent; the four controls it takes back — press, release, Clear,
     * exit; and the side panel's interface language, applied to this document's
     * own i18next without storing it (ruling 5; controller ruling M11). No
     * start, stop or Settings: the overlay is read-only for the run (plan 1d-2
     * ruling 5; plan 1e-4 ruling 2). The extension's overlay page and the
     * development preview's iframe both mount it.
     */
    export function ConnectedOverlay({ receiver }: { receiver: OverlayReceiver }) {
      const model = useReadable(receiver);
      const { i18n } = useTranslation();
      const language = model.language;
      useEffect(() => {
        // Only when it differs: a remount over a receiver whose language this document already shows switches nothing.
        if (!language || language === i18n.language) return;
        showLanguageUncached(language).catch((error: unknown) =>
          reportWarning('SubtitleOverlay', `The overlay could not switch to the side panel's language (${language}): ${describeCause(error)}`, { cause: error, dedupeKey: 'overlay:language' }));
      }, [language, i18n]);
      const controls = useMemo<SubtitleControls>(() => ({
        exit: () => receiver.send({ type: 'subtitle:user-exit' }),
        clear: () => receiver.send({ type: 'subtitle:request-clear' }),
        press: () => receiver.send({ type: 'subtitle:turn-press' }),
        release: () => receiver.send({ type: 'subtitle:turn-release' }),
      }), [receiver]);
      return <SubtitleView surface="extension-overlay" model={model} controls={controls} />;
    }
    ```

  - `OverlayPreview.tsx`:
    - its local `ConnectedOverlay` goes, and it imports the new one;
    - `type Receiver = ReturnType<typeof receiveSubtitles>` becomes `OverlayReceiver`, imported from `../../lib/subtitle/wire` beside `messagePortWire` and `receiveSubtitles`;
    - the `useMemo`, `OverlayModel`, `useReadable`, `SubtitleView` and `SubtitleControls` imports go;
    - its doc says "(plan 1e-4)" in place of "(plan 1e)".
- [ ] **Step 4: Run** `npx vitest run src/components/Subtitle src/components/dev src/locales`, then the full suite and the gate.
- [ ] **Step 5: Commit**

  ```bash
  git add src/components/Subtitle/ConnectedOverlay.tsx src/components/Subtitle/ConnectedOverlay.test.tsx src/components/dev/OverlayPreview.tsx src/locales/index.ts src/locales/showLanguageUncached.test.ts
  ```

  ```bash
  git commit -q -F - -- src/components/Subtitle/ConnectedOverlay.tsx src/components/Subtitle/ConnectedOverlay.test.tsx src/components/dev/OverlayPreview.tsx src/locales/index.ts src/locales/showLanguageUncached.test.ts <<'EOF'
  feat(subtitle): ConnectedOverlay — the overlay drawn from its wire, in the side panel's language, never stored

  <body>

  Co-Authored-By: <implementing model>
  EOF
  ```

**Probes:** `spine-subtitle-probe.mjs` (default) draws the same bands on both surfaces, with the preview's iframe now mounting `ConnectedOverlay` (group check A).

---

### Task 6: The side panel publishes the app session to its own tab's overlay

**Files:** Modify `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts`, `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.test.ts`, `src/components/Subtitle/subtitleEnterGate.ts`.

**Interfaces:**
- **Produces:** the class's public surface is unchanged (`enter`, `exit`, `setFullscreen`, `setAlwaysOnTop`, `CONTENT_SCRIPT_UNAVAILABLE`).
- **Behaviour:**
  - `enter()` targets `?tabId=` (else the active tab) and knows its tab before `subtitle:enter` is sent;
  - a `sokuji-subtitle` port is accepted from that tab only; every other one is disconnected;
  - each accepted port gets `publishSubtitles` over the feed plus `uiLanguage`;
  - teardown stops, then closes.
- **Consumed by:** `settingsStore.enterSubtitleMode` / `exitSubtitleMode` (unchanged) and the overlay (Task 7).

- [ ] **Step 1: Rewrite the test file's data-path half; write the new cases.**
  - **Deleted, because the code they test is rewritten in this task (not left for 1e-3c):**
    - the case "port reconnect unsubscribes the prior generation of store subscriptions" (`:102-160`);
    - the four `describe`s "strips heavy replay fields…" (`:162-245`), "windows forwarded items…" (`:246-328`), "throttles items forwarding…" (`:329-398`) and "playback forwarding" (`:399-494`);
    - the `usePlaybackStore` import and `waitThrottle`.
  - **Kept, with the harness below:** the first six cases (`:43-100`).
  - **The harness.**
    - `beforeEach`'s chrome mock gains `tabs.get: vi.fn(async (id: number) => ({ id, url: 'https://meet.google.com/abc' }))`.
    - A feed is registered in `beforeEach` (`off = registerSubtitleFeed(feed)`) and unregistered in `afterEach`.
    - `useSettingsStore`'s state is saved in `beforeAll` and restored in `afterEach`.
    - `vi.mock('../uiLanguage', () => ({ uiLanguage: { get: () => 'ja', subscribe: () => () => {} } }))`.
    - `vi.mock('../../../lib/diagnostics/report', async (orig) => ({ ...(await orig()), reportWarning: reportWarningSpy }))`.

    ```ts
    function box<T>(initial: T): Readable<T> & { set(next: T): void } { /* as wire.test.ts:36-44 */ }
    const running: SubtitleSession = { phase: 'running', since: 5, legs: ['speaker'], pair: { source: 'en', target: 'ja' }, holdToTalk: true, canStart: false, idle: { kind: 'ended' } };
    function stubFeed() {
      const session = box<SubtitleSession>(running);
      const feed = {
        sources: { entries: box<readonly Entry[]>([]), session, karaoke: box<KaraokeState>({ lit: new Map(), replaying: null }) },
        clear: vi.fn(), press: vi.fn(), release: vi.fn(),
      };
      return { feed, session };
    }
    /** An overlay's port as `onConnect` hands it over. `drop()` is Chrome firing this end's `onDisconnect`. */
    function makePort(tabId: number | undefined = 7, name = 'sokuji-subtitle') {
      const messages = new Set<(m: unknown) => void>();
      const gone = new Set<() => void>();
      return {
        name,
        sender: tabId === undefined ? {} : { tab: { id: tabId } },
        postMessage: vi.fn(),
        onMessage: { addListener: (fn: (m: unknown) => void) => { messages.add(fn); }, removeListener: (fn: (m: unknown) => void) => { messages.delete(fn); } },
        onDisconnect: { addListener: (fn: () => void) => { gone.add(fn); }, removeListener: (fn: () => void) => { gone.delete(fn); } },
        disconnect: vi.fn(),
        deliver: (m: unknown) => { [...messages].forEach((fn) => fn(m)); },
        drop: () => { [...gone].forEach((fn) => fn()); },
      };
    }
    const sentTypes = (port: ReturnType<typeof makePort>) => port.postMessage.mock.calls.map(([m]) => (m as { type: string }).type);
    const flush = () => new Promise((r) => setTimeout(r, 0));
    ```

    `connect(port)` is `listeners.onConnect[0](port)` after `await surface.enter()`.
  - **New cases:**
    1. **Publishes the app session to its own tab's overlay: language, session, entries, karaoke, in that order.**
       - Enter; connect `makePort(7)` → `sentTypes(p)` is `['subtitle:language', 'subtitle:session', 'subtitle:entries', 'subtitle:karaoke']`.
       - The first message is `{ type: 'subtitle:language', language: 'ja' }`, and the second's `session` equals `running`.
    2. **Disconnects a port from another tab, or from no tab, and never posts to it.**
       - `makePort(8)` → `disconnect` called once, `postMessage` never.
       - `makePort(undefined)` → the same.
       - A later `makePort(7)` is still published to.
    3. **Leaves a port of another name alone.** `makePort(7, 'other')` → neither `disconnect` nor `postMessage` called.
    4. **Closes the port, with one warning, when no session is attached.**
       - `off()` first, so no feed is registered; `makePort(7)` → `disconnect` once, `postMessage` never.
       - `reportWarningSpy` is called once with `('SubtitleSurface', expect.any(String), expect.objectContaining({ dedupeKey: 'subtitle-surface:no-feed' }))`.
    5. **A tab reload's new overlay gets a fresh publisher.**
       - Connect `p1`; `p1.drop()`; connect `p2` → `p2` got the four first sends.
       - `session.set({ ...running, since: 9 })` → `p2` got one more `subtitle:session`, and `p1`'s post count is unchanged since the drop.
       - `p1.disconnect` was never called: it had gone by itself.
    6. **A second overlay while the first is still connected replaces it: the first is stopped, then disconnected.** Connect `p1`, then `p2` with no drop → `p1.disconnect` once; after `session.set(…)`, `p1` got nothing new and `p2` did.
    7. **The overlay's controls reach the runner's, and its exit leaves subtitle mode.**
       - `useSettingsStore.setState({ exitSubtitleMode: exitSpy })`.
       - On `p1`, deliver `subtitle:request-clear`, `subtitle:turn-press`, `subtitle:turn-release` and `subtitle:user-exit` → `feed.clear`, `feed.press`, `feed.release` and `exitSpy` each called once.
    8. **`exit()` stops the publisher before disconnecting its port, releasing a held press.**
       - Connect `p1`; deliver `subtitle:turn-press`.
       - An `order` array: `feed.release.mockImplementation(() => order.push('release'))` and `p1.disconnect.mockImplementation(() => order.push('disconnect'))`.
       - `await surface.exit()` → `sendMessage` last called with `(7, { type: 'subtitle:exit' })`, and `order` is `['release', 'disconnect']`.
       - A later `session.set(…)` posts nothing to `p1`.
    9. **The tab closing tears the publisher down too.** Connect `p1`; `listeners.onRemoved[0](7)` → `p1.disconnect` once, and a later `session.set(…)` posts nothing.
    10. **A held press is released when the overlay goes away.** Connect `p1`; deliver `subtitle:turn-press`; `p1.drop()` → `feed.release` once.
    11. **`enter()` targets the tab the side panel was opened for, not the active tab (ruling 4).**
        - `window.history.replaceState(null, '', '/?tabId=42')`; enter.
        - `chrome.tabs.get` called with `42`; `sendMessage` called with `(42, { type: 'subtitle:enter' })`; `chrome.tabs.query` never called.
        - A port from tab 42 is published to, and one from tab 7 is disconnected.
        - A `finally` restores the URL with `replaceState(null, '', '/')`.
    12. **`enter()` refuses its tab when the tab has left the meeting, or is gone.** With `?tabId=42`:
        - `tabs.get` answers `{ id: 42, url: 'https://example.com/' }` → `enter()` rejects `/not on supported site/`;
        - `tabs.get` rejects → the same.
    13. **Accepts its tab's overlay while `subtitle:enter` is still in flight.**
        - `sendMessage` held on a deferred; `const entering = surface.enter()`; `await vi.waitFor(() => expect(listeners.onConnect).toHaveLength(1))`.
        - Connect `makePort(7)` → its four first sends went out.
        - Resolve the deferred; `await entering`.
    14. **A failed enter forgets its tab.** Extend the existing CONTENT_SCRIPT_UNAVAILABLE case (`:61-83`):
        - after the rejection, `listeners.onConnect[0](makePort(7))` → that port is disconnected (no target);
        - `sendMessage.mockClear()`; `await surface.enter()` → `sendMessage` called once with `(7, { type: 'subtitle:enter' })`.
- [ ] **Step 2: Run** `npx vitest run src/components/Subtitle/surfaces`. New cases 1, 2, 4–8 and 10–14 fail against today's class: it checks only the port's name, publishes the old messages, ignores the feed and targets the active tab.

  **Already passing before the implementation** (controller ruling M3). These pin the rewrite:
  - **case 3:** today's `handleConnect` already returns on another name (`:103`);
  - **case 9:** today's `tearDown` already disconnects the stored port (`:212`), and nothing subscribes to the stub feed.

  The six kept cases pass before and after.
- [ ] **Step 3: Implement.** `ExtensionContentScriptSubtitleSurface.ts` in full:

  ```ts
  import type { SubtitleSurface } from './SubtitleSurface';
  import useSettingsStore from '../../../stores/settingsStore';
  import { PLATFORM_HOSTNAMES } from '../../../../extension/platforms';
  import { currentSubtitleFeed } from '../../../app/subtitleFeed';
  import { targetTabIdFromSearch } from '../../../lib/audio/tabMicrophone';
  import { reportWarning } from '../../../lib/diagnostics/report';
  import { chromePortWire, publishSubtitles, SUBTITLE_PORT, type ChromePortLike, type WirePort } from '../../../lib/subtitle/wire';
  import { uiLanguage } from '../uiLanguage';

  declare const chrome: any;

  const SUPPORTED_HOSTS = new Set<string>(PLATFORM_HOSTNAMES);

  function isSupportedUrl(url: string | undefined): boolean {
    if (!url) return false;
    try { return SUPPORTED_HOSTS.has(new URL(url).hostname); } catch { return false; }
  }

  /** A `chrome.runtime.Port` as `onConnect` hands it over: the wire's part, its name, and who opened it. */
  interface IncomingPort extends ChromePortLike {
    name: string;
    sender?: { tab?: { id?: number } };
  }

  /** (the existing CONTENT_SCRIPT_UNAVAILABLE doc, unchanged) */
  export const CONTENT_SCRIPT_UNAVAILABLE = 'CONTENT_SCRIPT_UNAVAILABLE';

  /**
   * The extension's subtitle surface, in the side panel (plan 1e-4): it mounts
   * the overlay in its meeting tab through the content script, and publishes
   * the app session to that overlay over a `chrome.runtime` port — the wire of
   * `src/lib/subtitle/wire.ts`, with the side panel's interface language. It
   * reaches the session through `src/app/subtitleFeed.ts`, never the root
   * itself: `settingsStore` imports this class (ruling 1).
   */
  export class ExtensionContentScriptSubtitleSurface implements SubtitleSurface {
    private targetTabId: number | null = null;
    private publisher: { wire: WirePort; stop(): void } | null = null;

    private handleConnect = (port: IncomingPort) => {
      // Another extension port is not this surface's to judge.
      if (port.name !== SUBTITLE_PORT) return;
      // One overlay per tab (ruling 4): `runtime.connect` reaches every
      // extension page that listens, so a side panel in subtitle mode for
      // another meeting tab hears this overlay too. Refuse it by disconnecting —
      // an overlay's port stays open while any receiving end holds it, so an end
      // left open here would keep the overlay alive after its own side panel
      // let it go (choice 2).
      if (this.targetTabId === null || port.sender?.tab?.id !== this.targetTabId) {
        port.disconnect();
        return;
      }
      const feed = currentSubtitleFeed();
      if (!feed) {
        // Nothing to show: closing the port unmounts the overlay (its sidepanel-gone; choice 5).
        reportWarning('SubtitleSurface', 'The subtitle overlay connected while the side panel had no session attached; it was closed.', { dedupeKey: 'subtitle-surface:no-feed' });
        port.disconnect();
        return;
      }
      // A reload of the meeting tab connects a new overlay; the old port has
      // usually gone already (its publisher stopped itself), but not necessarily.
      this.closePublisher();
      const wire = chromePortWire(port);
      const stop = publishSubtitles(wire, { ...feed.sources, language: uiLanguage }, {
        clear: feed.clear,
        press: feed.press,
        release: feed.release,
        exit: () => void useSettingsStore.getState().exitSubtitleMode(),
      });
      const current = { wire, stop };
      this.publisher = current;
      // The publisher stops itself when the overlay goes (a tab reload, the tab
      // closing); forget it then, so a teardown does not close it a second time.
      wire.onDisconnect(() => {
        if (this.publisher === current) this.publisher = null;
      });
    };

    private handleTabRemoved = (tabId: number) => {
      if (tabId === this.targetTabId) this.tearDown();
    };

    // handleTabUpdated: unchanged.

    async enter(): Promise<void> {
      if (this.targetTabId != null) return;
      const tab = await this.targetTab();
      if (!tab?.id || !isSupportedUrl(tab.url)) {
        throw new Error('not on supported site');
      }
      const tabId = tab.id;
      // Known before the overlay can connect: `handleConnect` accepts this tab's port only (ruling 4).
      this.targetTabId = tabId;
      chrome.runtime.onConnect.addListener(this.handleConnect);
      chrome.tabs.onRemoved.addListener(this.handleTabRemoved);
      chrome.tabs.onUpdated.addListener(this.handleTabUpdated);
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'subtitle:enter' });
      } catch (rawError) {
        // (the existing comment, unchanged)
        chrome.runtime.onConnect.removeListener(this.handleConnect);
        chrome.tabs.onRemoved.removeListener(this.handleTabRemoved);
        chrome.tabs.onUpdated.removeListener(this.handleTabUpdated);
        this.targetTabId = null;
        const err = new Error(
          rawError instanceof Error ? rawError.message : String(rawError),
        ) as Error & { code: string };
        err.code = CONTENT_SCRIPT_UNAVAILABLE;
        throw err;
      }
    }

    // exit(), setFullscreen(), setAlwaysOnTop(): unchanged.

    /**
     * The meeting tab: the one this side panel was opened for (its `?tabId=`,
     * `extension/background/background.js:145-149`), else — the default side
     * panel carries none — the active tab of the current window (ruling 4).
     */
    private async targetTab(): Promise<{ id?: number; url?: string } | undefined> {
      const own = targetTabIdFromSearch(window.location.search);
      if (own === null) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
      }
      try {
        return await chrome.tabs.get(own);
      } catch {
        // The tab it was opened for is gone; `enter()` refuses as for any unsupported tab.
        return undefined;
      }
    }

    /**
     * Stops the publisher, then closes its port — in that order (choice 1):
     * `disconnect()` fires no `onDisconnect` on the end that calls it, so a
     * publisher not stopped first would keep its subscriptions and an
     * outstanding press.
     */
    private closePublisher(): void {
      const current = this.publisher;
      if (!current) return;
      this.publisher = null;
      current.stop();
      current.wire.close();
    }

    private tearDown() {
      chrome.runtime.onConnect.removeListener(this.handleConnect);
      chrome.tabs.onRemoved.removeListener(this.handleTabRemoved);
      chrome.tabs.onUpdated.removeListener(this.handleTabUpdated);
      this.closePublisher();
      this.targetTabId = null;
      useSettingsStore.getState().__notifySubtitleSurfaceExited();
    }
  }
  ```

  **What goes from the file:** `MAX_FORWARDED_ITEMS`, `ITEMS_THROTTLE_MS`, `recentItems`, `stripHeavyItemFields`, `postWire`, `handlePortMessage`, `installStoreSubscriptions`, the throttle fields, `useSessionStoreForClear`, and the `subtitleWire` / `playbackStore` references.

  `subtitleEnterGate.ts`: the doc's middle paragraph becomes

  ```ts
   * The Electron subtitle window carries its own Start/Stop control, so it can
   * be opened at any time — users position and size it before the meeting
   * (issue #324). The extension overlay is read-only for the run: it sends its
   * hold, Clear and exit back over its wire but cannot start or stop one (plan
   * 1d-2 ruling 5; plan 1e-4 rulings 2–3). So it opens only while a run is
   * live — an overlay opened idle would be a window with nothing to do.
  ```

  The function is unchanged.
- [ ] **Step 4: Run** `npx vitest run src/components/Subtitle src/stores`, then the full suite and the gate.
- [ ] **Step 5: Commit**

  ```bash
  git add src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.test.ts src/components/Subtitle/subtitleEnterGate.ts
  ```

  ```bash
  git commit -q -F - -- src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.test.ts src/components/Subtitle/subtitleEnterGate.ts <<'EOF'
  feat(extension): the side panel publishes the app session to its own tab's overlay

  <body: the feed, tab-scoped ports disconnected when foreign, stop-then-close,
  ?tabId=, the language; the old data path and its tests removed with the
  rewrite>

  Co-Authored-By: <implementing model>
  EOF
  ```

**Probes:** none in the preview: the surface class runs only in the extension. It is covered by Task 9's probe, or by the owner's check in a real Meet tab.

---

### Task 7: The overlay page on the wire

**Files:** Create `src/lib/subtitle/overlayPort.ts`, `src/lib/subtitle/overlayPort.test.ts`, `src/subtitle-overlay-entry.test.tsx`; Modify `src/subtitle-overlay-entry.tsx`, `src/lib/diagnostics/consoleLedger.consistency.test.ts`.

**Interfaces:**
- **Produces:** `SIDEPANEL_GONE`, `interface OverlayParent { postMessage(message: unknown, targetOrigin: string): void }`, and `connectOverlay(connect: (info: { name: string }) => ChromePortLike, parent: OverlayParent): OverlayReceiver | null` (`overlayPort.ts`).
- **Consumed by:** the overlay page. The content script's `sokuji-subtitle:sidepanel-gone` handler (`subtitle-overlay-content.js:61-65`) is unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `overlayPort.test.ts`:
    - `reportError` is spied through a partial `vi.mock('../diagnostics/report', …)`.
    - A `chromePort()` fake: `onMessage` / `onDisconnect` with `vi.fn` `addListener` / `removeListener` over sets, `postMessage: vi.fn()`, `disconnect: vi.fn()`, plus `deliver(m)` and `drop()`.
    - `parent = { postMessage: vi.fn() }`.

    Cases:
    1. **Opens one port named `sokuji-subtitle` and listens on it before returning.**
       - `connect = vi.fn(() => port)`; `const receiver = connectOverlay(connect, parent)!`.
       - `connect` was called once with `{ name: 'sokuji-subtitle' }`, and `port.onMessage.addListener` once.
       - `port.deliver({ type: 'subtitle:language', language: 'ja' })` → `receiver.get().language === 'ja'`.
    2. **Sends the overlay's controls down the port.** `receiver.send({ type: 'subtitle:turn-press' })` → `port.postMessage` called with it.
    3. **When the side panel goes, disposes the receiver and asks the content script to unmount it.**
       - Deliver `'ja'`, then subscribe a `listener`; `port.drop()`.
       - `parent.postMessage` called once with `({ type: 'sokuji-subtitle:sidepanel-gone' }, '*')`.
       - `port.deliver({ type: 'subtitle:language', language: 'fr' })` → the listener is not called, and `receiver.get().language` is still `'ja'`.
    4. **A parent that is gone does not throw out of the disconnect.** `parent.postMessage` throws → `expect(() => port.drop()).not.toThrow()`.
    5. **A port that will not open is reported, and the overlay asks to be unmounted.** `connect` throws → `null`, `reportError` once with `('SubtitleOverlay', expect.any(String), expect.objectContaining({ cause: expect.any(Error) }))`, and `parent.postMessage` called with the sidepanel-gone message.
  - `src/subtitle-overlay-entry.test.tsx`. The hoisted spies are `render`, `order: string[]`, `hydrate = vi.fn(async () => { order.push('hydrate'); })` and `reportErrorSpy`. The mocks:
    - `vi.mock('react-dom/client', () => ({ createRoot: () => ({ render }) }))`;
    - `vi.mock('./stores/subtitleStore', () => ({ useSubtitleStore: { getState: () => ({ hydrate }) } }))`;
    - `vi.mock('./components/AppProviders', () => ({ AppProviders: ({ children }: { children: unknown }) => children }))`;
    - `vi.mock('./components/Subtitle/ConnectedOverlay', () => ({ ConnectedOverlay: () => null }))`;
    - `vi.mock('./lib/diagnostics/report', async (orig) => ({ ...(await orig()), reportError: reportErrorSpy }))`.

    `beforeEach`:
    - `vi.resetModules()` and reset the spies (`order.length = 0`);
    - `document.body.innerHTML = '<div id="root"></div>'`;
    - `connect = vi.fn((info: { name: string }) => { order.push('connect:' + info.name); return chromePortFake(); })`, where `chromePortFake()` returns `{ postMessage: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() }, onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() }, disconnect: vi.fn() }`;
    - `vi.stubGlobal('chrome', { runtime: { connect } })`.

    `afterEach`: `vi.unstubAllGlobals()`. Each case imports `./subtitle-overlay-entry` after its setup.
    1. **Hydrates the overlay's own settings, then opens one port, then draws `ConnectedOverlay` over its receiver.**
       - `await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))`; `order` equals `['hydrate', 'connect:sokuji-subtitle']`.
       - `render.mock.calls[0][0].props.children.type` is the (mocked) `ConnectedOverlay` from `await import('./components/Subtitle/ConnectedOverlay')`, and its `props.receiver.send` is a function.
    2. **Draws nothing, and reports, with no `#root`.** `document.body.innerHTML = ''` → `await vi.waitFor(() => expect(reportErrorSpy).toHaveBeenCalledTimes(1))`; its first argument is `'SubtitleOverlay'`; `connect` and `render` never called.
    3. **Draws nothing when the port will not open.** `connect` throws → `await vi.waitFor(() => expect(reportErrorSpy).toHaveBeenCalledTimes(1))`, and `render` never called.
- [ ] **Step 2: Run** `npx vitest run src/lib/subtitle/overlayPort.test.ts src/subtitle-overlay-entry.test.tsx`. What fails and why:
  - `overlayPort.test.ts` fails to load: there is no module.
  - Entry case 1 fails on the rendered component, which is today's `SubtitleApp`. Its `order` assertion (hydrate, then one `sokuji-subtitle` connect) already holds against today's mirror.
  - Entry case 2 fails: today's `#root` failure is a `console.error`.
  - Entry case 3 fails: today the throw escapes `bootstrap` as an unhandled rejection, which vitest reports in this RED run only.
- [ ] **Step 3: Implement.**
  - `overlayPort.ts`:

    ```ts
    /**
     * The overlay's end of the extension wire (plan 1e-4). The port opens and
     * its receiver listens in one synchronous step, so nothing the side panel
     * sends first can arrive before it. When the side panel goes — closed,
     * reloaded, the extension reloaded, or never listening (Chrome disconnects a
     * port no page accepts) — the receiver keeps its last model, which would
     * freeze a running bar on the meeting page (roadmap 1d-2 → 1e): so the
     * receiver is disposed and the content script asked to unmount the overlay.
     */
    import { describeCause, reportError } from '../diagnostics/report';
    import { chromePortWire, receiveSubtitles, SUBTITLE_PORT, type ChromePortLike, type OverlayReceiver } from './wire';

    /** What the overlay asks of the content script when its side panel has gone (`extension/content/subtitle-overlay-content.js:61-65`). */
    export const SIDEPANEL_GONE = { type: 'sokuji-subtitle:sidepanel-gone' } as const;

    /** The meeting page's window, from the overlay's iframe: `window.parent`. */
    export interface OverlayParent {
      postMessage(message: unknown, targetOrigin: string): void;
    }

    function tellGone(parent: OverlayParent): void {
      try {
        parent.postMessage(SIDEPANEL_GONE, '*');
      } catch {
        // The iframe may already be detached from the meeting page: nothing is left to unmount.
      }
    }

    export function connectOverlay(connect: (info: { name: string }) => ChromePortLike, parent: OverlayParent): OverlayReceiver | null {
      let port: ChromePortLike;
      try {
        port = connect({ name: SUBTITLE_PORT });
      } catch (error) {
        reportError('SubtitleOverlay', `The overlay could not open its port to the side panel: ${describeCause(error)}`, { cause: error });
        tellGone(parent);
        return null;
      }
      const wire = chromePortWire(port);
      const receiver = receiveSubtitles(wire);
      wire.onDisconnect(() => {
        receiver.dispose();
        tellGone(parent);
      });
      return receiver;
    }
    ```

  - `src/subtitle-overlay-entry.tsx`, in full:

    ```tsx
    /**
     * The extension overlay's page (plan 1e-4): the iframe the content script
     * mounts in the meeting page draws `SubtitleView` from the side panel's wire.
     * Its display settings are its own (`subtitleStore`, hydrated from
     * `chrome.storage` first); everything about the run arrives on the port.
     */
    import { createRoot } from 'react-dom/client';
    import { AppProviders } from './components/AppProviders';
    import { ConnectedOverlay } from './components/Subtitle/ConnectedOverlay';
    import { reportError } from './lib/diagnostics/report';
    import { connectOverlay } from './lib/subtitle/overlayPort';
    import type { ChromePortLike } from './lib/subtitle/wire';
    import { useSubtitleStore } from './stores/subtitleStore';

    /** The part of the extension API this page uses: the repo's global `chrome` typing has no `connect`. */
    declare const chrome: { runtime: { connect(info: { name: string }): ChromePortLike } };

    async function bootstrap(): Promise<void> {
      await useSubtitleStore.getState().hydrate();
      const rootEl = document.getElementById('root');
      if (!rootEl) {
        reportError('SubtitleOverlay', 'The overlay page has no #root to draw into.');
        return;
      }
      const receiver = connectOverlay((info) => chrome.runtime.connect(info), window.parent);
      if (!receiver) return;
      createRoot(rootEl).render(
        <AppProviders posthogClient={null}>
          <ConnectedOverlay receiver={receiver} />
        </AppProviders>,
      );
    }

    void bootstrap();
    ```

    The mirror, `postUserExit` and the `sokuji:user-exit` window listener are gone from the page. `SubtitleView` hands the bar `onExit={controls.exit}` (`SubtitleView.tsx:116`), so the window event has no listener left. `SubtitleBar`'s fallback that dispatches it is 1e-3c's.
  - `consoleLedger.consistency.test.ts`: the row `'src/subtitle-overlay-entry.tsx': 1,` is removed, and in its place:

    ```ts
      // subtitle-overlay-entry.tsx's row (1) is gone, not lowered to 0: plan 1e-4
      // rewrote the overlay page over the wire; its one failure (no #root) reports
      // through report.ts.
    ```

- [ ] **Step 4: Run** `npx vitest run src/lib/subtitle src/subtitle-overlay-entry.test.tsx src/lib/diagnostics`, then the full suite and the gate.
- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/subtitle/overlayPort.ts src/lib/subtitle/overlayPort.test.ts src/subtitle-overlay-entry.tsx src/subtitle-overlay-entry.test.tsx src/lib/diagnostics/consoleLedger.consistency.test.ts
  ```

  ```bash
  git commit -q -F - -- src/lib/subtitle/overlayPort.ts src/lib/subtitle/overlayPort.test.ts src/subtitle-overlay-entry.tsx src/subtitle-overlay-entry.test.tsx src/lib/diagnostics/consoleLedger.consistency.test.ts <<'EOF'
  feat(extension): the overlay page renders SubtitleView over the wire

  <body>

  Co-Authored-By: <implementing model>
  EOF
  ```

**Probes:** group check A builds the extension and checks the overlay page's graph.

---

### Task 8: The preview at the real size, and the wire measured

**Files:** Create `src/components/dev/wireTally.ts`, `src/components/dev/wireTally.test.ts`; Modify `src/components/dev/SpinePreview.tsx`, `src/components/dev/SpinePreview.scss`, `scripts/dev/spine-subtitle-probe.mjs`.

**Interfaces:**
- **Produces:**
  - `interface WireCount { count: number; bytes: number; max: number; steadyMax?: number }`, `type WireTally = Record<string, WireCount>` and `tallied(wire: WirePort, tally: WireTally): WirePort` (`wireTally.ts`). `steadyMax` is the largest `subtitle:entries` message that carried the full tail (controller ruling M2);
  - the preview's `&wire=1`, which exposes the overlay wire's tally at `window.__sokujiWire`;
  - the preview's overlay frame at 140 px, publishing the side panel's language;
  - `spine-subtitle-probe.mjs`'s `wire=1` read.
- **Consumed by:** group check A.

- [ ] **Step 1: Write the failing tests** in `wireTally.test.ts`, with `bytes = (m: unknown) => new TextEncoder().encode(JSON.stringify(m)).length`:
  1. **Counts each message type in the JSON bytes the extension would carry, and passes every message on.**
     - `a = { type: 'subtitle:language', language: 'ja' }`, `b = { type: 'subtitle:entries', entries: [{ text: 'é' }] }`; `counted.post(a); counted.post(b); counted.post(a)`.
     - The wrapped `post` received `a`, `b`, `a`: the same objects (`toBe` per call).
     - `tally['subtitle:language']` equals `{ count: 2, bytes: 2 * bytes(a), max: bytes(a) }`.
     - `tally['subtitle:entries']` equals `{ count: 1, bytes: bytes(b), max: bytes(b) }`.
     - `bytes(b) === JSON.stringify(b).length + 1`: `é` is two bytes in UTF-8.
  2. **Counts a message with no `type` under `'?'`.** `counted.post({ x: 1 })` → `tally['?'].count === 1`.
  3. **Passes the rest of the wire through untouched.** `counted.onMessage`, `onDisconnect` and `close` are the wrapped wire's own functions (`toBe`).
  4. **Keeps the steady maximum apart: entries messages that carried the full tail** (controller ruling M2). Uses `OVERLAY_ENTRIES` from `../../lib/subtitle/wire` and `const full = (n: number) => ({ type: 'subtitle:entries', entries: Array.from({ length: n }, (_, i) => ({ id: 'e' + i })) })`.
     - `counted.post(full(OVERLAY_ENTRIES - 1))` → `tally['subtitle:entries'].steadyMax` is `undefined`: the tail is still filling.
     - Post a filling message padded to be the largest yet: `{ ...full(OVERLAY_ENTRIES - 1), pad: 'x'.repeat(5_000) }`. Then post `full(OVERLAY_ENTRIES)` and `full(OVERLAY_ENTRIES + 3)`.
     - `steadyMax === bytes(full(OVERLAY_ENTRIES + 3))`, and `max` is the padded filling message's size, which is larger: a spike while the tail fills is not the steady state.
     - `counted.post({ type: 'subtitle:session', entries: full(40).entries })` leaves the session count with no `steadyMax`: only `subtitle:entries` has one.
- [ ] **Step 2: Run** `npx vitest run src/components/dev/wireTally.test.ts`. It fails: there is no module.
- [ ] **Step 3: Implement.**
  - `wireTally.ts`:

    ```ts
    /**
     * Development builds only: what the overlay's wire carries, per message
     * type, in the bytes Chrome's extension messaging would — the message as
     * JSON, UTF-8 (plan 1e-4 ruling 6). The preview's `MessageChannel` clones
     * structurally, so its own cost says nothing about the extension's port.
     */
    import { OVERLAY_ENTRIES, type WirePort } from '../../lib/subtitle/wire';

    export interface WireCount {
      count: number;
      bytes: number;
      max: number;
      /**
       * `subtitle:entries` only: the largest message that carried the full tail
       * (`OVERLAY_ENTRIES` entries or more), the steady state plan 1e-4 ruling 6
       * budgets. Absent until the tail has reached its cap.
       */
      steadyMax?: number;
    }
    export type WireTally = Record<string, WireCount>;

    const encoder = new TextEncoder();

    export function tallied(wire: WirePort, tally: WireTally): WirePort {
      return {
        ...wire,
        post(message) {
          const type = typeof message === 'object' && message !== null && typeof (message as { type?: unknown }).type === 'string'
            ? (message as { type: string }).type
            : '?';
          const bytes = encoder.encode(JSON.stringify(message)).length;
          const count = (tally[type] ??= { count: 0, bytes: 0, max: 0 });
          count.count += 1;
          count.bytes += bytes;
          count.max = Math.max(count.max, bytes);
          const entries = (message as { entries?: unknown }).entries;
          if (type === 'subtitle:entries' && Array.isArray(entries) && entries.length >= OVERLAY_ENTRIES) {
            count.steadyMax = Math.max(count.steadyMax ?? 0, bytes);
          }
          wire.post(message);
        },
      };
    }
    ```

  - `SpinePreview.tsx`:
    - Import `uiLanguage` from `../Subtitle/uiLanguage` and `tallied` / `type WireTally` from `./wireTally`.
    - At module level, beside `sealCounts`:

      ```ts
      /** `&wire=1` (plan 1e-4 ruling 6): the overlay wire's traffic, read by `spine-subtitle-probe.mjs` from `window.__sokujiWire`. Page-lifetime, like `sealCounts`. */
      const wireTally: WireTally = {};
      ```

    - `previewParams` gains `wire: params.get('wire') === '1'`. The page's doc comment gains: "`&wire=1` (with `&overlay=1`) tallies the overlay's wire per message type as the JSON bytes the extension's port would carry, on `window.__sokujiWire` (plan 1e-4)."
    - `PreviewOverlayFrame` takes `measure: boolean`, and its publishing effect becomes:

      ```tsx
        useEffect(() => {
          if (!port) return;
          const entries: Readable<readonly Entry[]> = { get: () => view.get().entries, subscribe: view.subscribe };
          const wire = messagePortWire(port);
          if (measure) (window as unknown as { __sokujiWire?: WireTally }).__sokujiWire = wireTally;
          // The side panel's language rides too, as in the extension (plan 1e-4
          // ruling 5): the preview's wire carries the extension's four messages.
          return publishSubtitles(measure ? tallied(wire, wireTally) : wire, { entries, session, karaoke, language: uiLanguage }, {
            clear: controls.clear,
            exit: controls.exit,
            press: controls.press,
            release: controls.release,
          });
        }, [port, view, karaoke, session, controls, measure]);
      ```

    - The mount passes `measure={previewParams.wire}`, and the frame's doc says "(`&overlay=1`, plan 1d-2; at the real 140 px and with the language, plan 1e-4)".
  - `SpinePreview.scss`: `.spine-overlay-frame` leaves the shared 240 px rule:

    ```scss
    .spine-subtitle,
    .spine-overlay-frame {
      display: block;
      width: 900px;
      margin-top: 12px;
      border: 1px solid #444;
    }

    // The real overlay's iframe opens 140 px high (extension/content/
    // subtitle-overlay-content.js:94), so its stand-in does too (plan 1e-4
    // ruling 10): the hold button and a notice in a band are judged at the size
    // a meeting page shows them. 900 px is about 70vw of a 1280-px window.
    .spine-overlay-frame {
      height: 140px;
    }
    ```

    `height: 240px;` moves into the existing `.spine-subtitle { position: relative; overflow: hidden; … }` block, and that block's comment keeps saying 900×240.
  - `spine-subtitle-probe.mjs`:
    - The header gains:

      ```
       * Add `&script=long&wire=1` and about 150 seconds to measure the overlay's
       * wire (plan 1e-4 ruling 6): the page tallies every message the overlay's
       * port carries, as the bytes Chrome's messaging would (JSON, UTF-8); the
       * probe prints each type's count, total and largest message and its rate
       * over the last 30 s. It exits 1 if a `subtitle:entries` message sent
       * after the tail reached its cap (`OVERLAY_ENTRIES` entries: the steady
       * state) exceeds 64 KB — the roadmap's entries delta is owed then — or if
       * the tail never reached its cap (run longer: the `long` script adds one
       * entry every 3 s). The overlay frame is the real 140 px high.
      ```

    - The code:

      ```js
      const measureWire = url.includes('wire=1');
      const WIRE = 'JSON.stringify(window.__sokujiWire ?? null)';
      const WIRE_WINDOW_S = 30;
      const ENTRIES_BUDGET = 64 * 1024;
      const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
      ```

    - Inside the polling loop, after each `READ`:

      ```js
          if (measureWire && !wireFrom && waited >= Math.max(0, seconds - WIRE_WINDOW_S) * 1000) {
            wireFrom = { at: waited, tally: JSON.parse((await evaluate(send, WIRE)) ?? 'null') };
          }
      ```

      (`let wireFrom = null;` beside `let last = null;`.)
    - After the loop, before the failures are printed:

      ```js
        if (measureWire) {
          const tally = JSON.parse((await evaluate(send, WIRE)) ?? 'null');
          if (!tally) {
            failures.push('no wire tally on the page — the URL needs &overlay=1 as well as &wire=1');
          } else {
            const span = Math.max(1, (seconds * 1000 - (wireFrom?.at ?? 0)) / 1000);
            for (const [type, t] of Object.entries(tally).sort(([a], [b]) => a.localeCompare(b))) {
              const before = wireFrom?.tally?.[type] ?? { count: 0, bytes: 0 };
              console.log(`wire ${type}: ${t.count} messages, ${kb(t.bytes)} in all, largest ${kb(t.max)}; last ${span.toFixed(0)} s: ${((t.count - before.count) / span).toFixed(1)}/s, ${kb((t.bytes - before.bytes) / span)}/s`);
            }
            // The steady state only (controller ruling M2): a message sent while the tail was still filling is not what the budget is about.
            const steady = tally['subtitle:entries']?.steadyMax;
            if (steady === undefined) failures.push(`the tail never reached its cap in ${seconds} s — run longer`);
            else {
              console.log(`wire subtitle:entries at the cap: largest ${kb(steady)} (budget 64 KB)`);
              if (steady > ENTRIES_BUDGET) failures.push(`a steady subtitle:entries message reached ${kb(steady)}, over the 64 KB budget: the entries delta is owed (roadmap 1d-2 → 1e; plan 1e-4 ruling 6)`);
            }
          }
        }
      ```

- [ ] **Step 4: Run** `npx vitest run src/components/dev`, then the full suite and the gate. Do not start a dev server or run the probe.
- [ ] **Step 5: Commit**

  ```bash
  git add src/components/dev/wireTally.ts src/components/dev/wireTally.test.ts src/components/dev/SpinePreview.tsx src/components/dev/SpinePreview.scss scripts/dev/spine-subtitle-probe.mjs
  ```

  ```bash
  git commit -q -F - -- src/components/dev/wireTally.ts src/components/dev/wireTally.test.ts src/components/dev/SpinePreview.tsx src/components/dev/SpinePreview.scss scripts/dev/spine-subtitle-probe.mjs <<'EOF'
  feat(dev): the preview's overlay at the real 140 px, and the wire measured

  <body>

  Co-Authored-By: <implementing model>
  EOF
  ```

**Group check A (controller, after Tasks 5–8 have all landed).** Against a fresh vite:

1. **The renderer at the real size.** `node scripts/dev/spine-subtitle-probe.mjs` passes to its header's criteria in each of these forms:
   - the default;
   - `'…&turn=push-to-talk'` and `'…&turn=push-to-translate'`;
   - `'…&script=cjk&cut=sentences:1'`;
   - without `&compact=1` (`'http://localhost:5199/?preview=spine&autostart=1&subtitle=1&overlay=1'`, the expanded rows).
2. **The layout decision** (ruling 10, controller ruling b). The old overlay cannot be rendered from this branch. So the 140 px layout is settled by rendering the new overlay, and by comparing it with the old overlay's markup and CSS by reading.
   - **Render the new one.** `node scripts/dev/spine-subtitle-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&subtitle=1&overlay=1&compact=1&turn=push-to-talk' 12 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1e4-overlay-140-ptt.png`, and the same with `&script=notices` in place of `&turn=…` → `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1e4-overlay-140-notice.png`. Look at the 140-px frame:
     - Does the hold button sit inside the frame without covering the bands' text?
     - Is the notice in its band readable?
   - **Read the old one:** `SubtitleApp.tsx`'s body and bar markup, `SubtitleStream.tsx`'s compact bands, and the rules in `SubtitleApp.scss` / `SubtitleStream.scss` / `SubtitleBar.scss` that size them. Compare what the old overlay put in 140 px: bar height, band count and line height, where its "Press Space to speak" hint sat. The new overlay's bands and bar are the same classes (`SubtitleView.tsx:22`, `SubtitleBands.tsx:9`); the hold button (`.subtitle-hold`) is the one new element.
   - Record the decision for the roadmap. The new screenshots go in the owner's report. A placement change is a follow-up the controller dispatches (SCSS only), not part of this plan.
3. **The wire** (ruling 6, controller ruling M2). `node scripts/dev/spine-subtitle-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&subtitle=1&overlay=1&compact=1&script=long&wire=1' 150` passes. Record every printed `wire …` line for the roadmap. The largest `subtitle:entries` message sent at the cap (the steady state) must be at most 64 KB. The `long` script adds one entry every 3 s, so the 30-entry tail is full after about 90 s.
4. **The other probes.** `spine-surface-probe.mjs` (default), `spine-audio-probe.mjs` (default) and `app-panel-probe.mjs --app` pass. Every page now registers a feed on `attach()`.
5. **The extension build.** `npm run extension:build` succeeds. Then run each of the following as its own call, from the worktree root (controller ruling M6).
   - **The two chunk lists:**
     - `command grep -o 'assets/[^"]*\.js' extension/dist/subtitle-overlay.html > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1e4-overlay-chunks-after.txt`
     - `command grep -o 'assets/[^"]*\.js' extension/dist/fullpage.html > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1e4-fullpage-chunks.txt`
   - **Two sentinels** (ruling 1, D24, controller ruling M5):
     - **the root:** `A second attach() while one is already live did nothing` — `src/app/session.ts`'s own warning (`:227`);
     - **the registry:** `Required models are not available for the reverse language pair` (`src/providers/localInference/check.ts:68`). `src/providers/registry.ts` has no string literal of its own. This one sits in the LocalInference definition, the registry's one released entry. It is reached only through `localInference/provider.ts`, which only the registry and `SettingsInitializer` import, and the overlay may reach neither.
   - **The overlay page's graph holds neither.** Its entry is `subtitle-overlay.js`; its static chunks are the list. Each of these prints nothing (`xargs` then exits 123):
     - `sed 's#^#extension/dist/#' /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1e4-overlay-chunks-after.txt | xargs grep -lF 'A second attach() while one is already live did nothing' extension/dist/subtitle-overlay.js`
     - the same with the registry sentinel.
   - **The positive control: the side panel's graph holds both.** Each of these names at least one file (on 2026-09-26's dist, `extension/dist/assets/shared-CBSQUG0Q.js`):
     - `sed 's#^#extension/dist/#' /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1e4-fullpage-chunks.txt | xargs grep -lF 'A second attach() while one is already live did nothing'`
     - the same with the registry sentinel.

     A sentinel the side panel's chunks do not show means a minifier changed the string, and the empty overlay results prove nothing until a new sentinel is chosen.
   - **The limit:** these read what each page loads at boot, its entry and the chunks its HTML preloads. A chunk only a dynamic `import()` reaches loads on demand and is not in the list.
   - **No fake-provider code ships:** `command grep -rlF 'The fake degraded its speech' extension/dist` prints nothing.
   - **The chunk list after:** record `diff /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1e4-overlay-chunks-before.txt /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1e4-overlay-chunks-after.txt` for the roadmap. Chunk hashes differ; module names are what to compare.

   (Checked against the dist on disk on 2026-09-26: both overlay commands print nothing, and both positive controls name `shared-CBSQUG0Q.js`.)
6. **The extension's own tests.** `npx vitest run extension` passes. No file there changed.
7. **The app loads.** `http://localhost:5199/` loads, with no `SubtitleSurface` or `AppSession` warning.

---

### Task 9: The spike — the overlay in a meeting page, headless

**Files:** Create `scripts/dev/extension-overlay-probe.mjs`, only if the spike works.

**Interfaces:**
- **Produces:** either `scripts/dev/extension-overlay-probe.mjs` (flags `--ptt`, `--shot <file.png>`, `--no-build`, `--build-dir <dir>`), or a report of the link that cannot work and why (ruling 7).
- **Consumed by:** group check B, and Task 10.

This task alone may build the extension (into a directory outside the repo) and launch headless Chromium; it never starts a dev server. It changes no product code. A product defect the probe finds is reported with its evidence, not fixed here; the controller dispatches the fix.

**Known limits, stated up front:**
- **`port.sender.tab` is assumed** to be present on a `runtime.connect` from an extension iframe inside a tab (controller ruling M13). If Chrome leaves it out, Task 6 refuses every overlay. No unit test can see this; check 1 here, or the owner's check in a real Meet tab, is what catches it.
- **A seed race is accepted** (controller ruling M14). The first boot of `fullpage.html`, before the seed, may write defaults that race it. The page is navigated again after seeding, which covers this in practice.

- [ ] **Step 1: The chain, one link at a time.** Each link is a go/no-go. On a no-go, try the fallback it names, then stop and report the link, the evidence (the CDP reply, the target list) and why.
  1. **A development build.**
     - `npx vite build --mode development --outDir <build dir> --emptyOutDir`, spawned by the probe with `cwd` set to the repo's `extension/`, resolved from the script's own path.
     - `<build dir>` is `--build-dir`, default `join(tmpdir(), 'sokuji-extension-probe')`; `--no-build` reuses it.
     - `--mode development` registers the fake: the extension's vite config defines `import.meta.env.DEV` from the mode, `extension/vite.config.ts:201`.
  2. **Chromium with the extension.**
     - Launch Playwright's `chromium-*/chrome-linux/chrome` (Chromium 151 here, unbranded, so `--load-extension` is honoured), found as `scripts/dev/headless.mjs` finds it.
     - Flags: `--headless --no-sandbox --disable-gpu --autoplay-policy=no-user-gesture-required --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --load-extension=<build dir> --disable-extensions-except=<build dir> --remote-debugging-port=9334 --user-data-dir=<a fresh mkdtemp>`.
       - The three `--disable-background…` flags keep a window that is not in front from throttling its timers or its renderer (controller ruling I6).
     - **Under `--ptt`, also `--use-file-for-fake-audio-capture=<repo>/benchmark/test-speech-silence-speech.wav`** (controller ruling I4).
       - Resolve it from the script's own path: `fileURLToPath(new URL('../../benchmark/test-speech-silence-speech.wav', import.meta.url))`, as `app-panel-probe.mjs` does.
       - Why: the extension runs the app's own capture, and Chrome's fake microphone is a beep. That is too little voice for `MIN_VOICED_MS` (`src/lib/session/turn.ts`), so a held turn would be cancelled and nothing released.
     - Connect to the **browser** target (`/json/version` → `webSocketDebuggerUrl`) with flat sessions: `Target.attachToTarget({ flatten: true })`, and every command carries its `sessionId`. `headless.mjs`'s page-only `withPage` cannot do this.
     - **Every target stays in the default browser context** (controller ruling I6): never `Target.createBrowserContext`, never a `browserContextId`. Extensions are off in any other context.
     - The extension id: poll `Target.getTargets` for a `service_worker` target at `chrome-extension://<id>/background.js`.
     - No-go: no such target within 10 s.
       - Fallback (controller ruling M15): `Extensions.loadUnpacked({ path: <build dir> })`, which returns the id, over `--remote-debugging-pipe --enable-unsafe-extension-debugging`.
       - It needs the pipe transport (file descriptors 3 and 4) in place of the port.
  3. **A stand-in meeting page, in a window of its own** (controller ruling I6).
     - `Target.createTarget({ url: 'about:blank', newWindow: true })`, and attach.
     - On that session, `Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: false, flatten: true })`, so the overlay's frame will be announced.
     - `Fetch.enable({ patterns: [{ urlPattern: 'https://meet.google.com/*' }] })`, answering every `Fetch.requestPaused` with `Fetch.fulfillRequest`: the document gets a stub HTML (status 200, `Content-Type: text/html`), anything else a 404.
     - `Page.navigate('https://meet.google.com/sokuji-probe')`.
       - Content scripts match only real hosts over HTTPS (`manifest.json:49`), and `meet.google.com` has no site plugin (`platforms.ts:32`).
       - The page is served by the browser itself: no DNS, no TLS, no server.
     - The stub:

       ```html
       <!doctype html><html><head><title>Meeting stand-in</title></head><body>
       <p>Sokuji extension overlay probe — a stand-in for a meeting page.</p>
       <script>
         window.__keys = [];
         window.__pcm = 0;
         window.addEventListener('keydown', (e) => window.__keys.push(e.key), true);
         window.addEventListener('message', (e) => { if (e.data && e.data.type === 'PCM_DATA') window.__pcm += 1; });
       </script>
       </body></html>
       ```

     - No-go: the page never commits at that URL.
  4. **The side panel's stand-in, in another window.**
     - `Target.createTarget({ url: 'chrome-extension://<id>/fullpage.html', newWindow: true })`, and attach.
     - Evaluate `chrome.tabs.query({ url: 'https://meet.google.com/*' })` → the meeting tab's id.
     - Seed the settings with `chrome.storage.sync.set({ 'settings.setup': {version: 1, scenario: 'be-heard', providerPath: 'offline', provider: 'local_inference', completedAt: '2026-09-25T00:00:00.000Z'}, 'settings.common.provider': 'fake', 'settings.fake.script': 'long', 'settings.common.uiMode': 'basic', 'settings.common.turnMode': 'auto' | 'push-to-talk' (--ptt) })`.
       - These are `app-panel-probe.mjs:132-148`'s keys, as the values the extension's settings service stores: the record is an object, not a JSON string.
     - Seed the language: `localStorage.setItem('i18nextLng', 'ja')`.
     - **Seed the storage sentinel in this document only** (controller ruling I5): `localStorage.setItem('sokuji-probe-shared', '1')`.
     - `Page.navigate` to `chrome-extension://<id>/fullpage.html?tabId=<meeting tab id>`.

     A side panel cannot be opened headlessly: `sidePanel.open` needs a user gesture. The same page in a tab is the same app, and `?tabId=` makes `enter()` target the meeting tab (ruling 4).
     - No-go: `[data-tour="main-action"]` is not enabled within 15 s; print its `title`.
  5. **The run and the overlay.**
     - **Bring the window to the front before every interaction** (controller ruling I6): `Page.bringToFront` on the side panel's session before each click there, and on the meeting page's session before each input or screenshot there.
     - Click `[data-tour="main-action"]` (`.click()`) and wait for `.status-dot.active`.
     - Click `[data-tour="subtitle-enter"]`.
     - Within 5 s the meeting page has `#sokuji-subtitle-host`, and a `Target.attachedToTarget` with `targetInfo.type === 'iframe'` and url `chrome-extension://<id>/subtitle-overlay.html` gives the overlay's session.
     - Fallback if there is no frame target: `Page.getFrameTree` on the meeting page's session, the frame whose url is the overlay's, `Page.createIsolatedWorld({ frameId })`, and `Runtime.evaluate({ contextId })`. The DOM is shared, so the checks read the same.
- [ ] **Step 2: The probe's checks**, once the chain holds, in this order. Each miss is printed; the probe exits 1 on any miss and 2 on a flag it cannot serve.
  0. **`--ptt`: a trusted hold, first** (controller ruling I3).
     - Why first: under push-to-talk the fake holds every block until a held turn ends (`src/providers/fake/adapter.ts:120-127`), so nothing reaches the overlay before a hold. `app-panel-probe.mjs` and `spine-subtitle-probe.mjs` hold before they read, for the same reason.
     - **The iframe's box** (controller ruling M15): `DOM.getFrameOwner({ frameId: <the overlay's targetId> })` on the meeting page's session gives the IFRAME's backend node inside the closed shadow root. `DOM.getBoxModel({ backendNodeId })` gives its quad, which already includes its `translateX(-50%)`.
     - **The button's rect** comes from the overlay session: `.subtitle-hold__button`'s `getBoundingClientRect()`.
     - `Page.bringToFront` on the meeting page. Then `Input.dispatchMouseEvent` `mousePressed` at the button's centre in page coordinates, wait 1 500 ms, `mouseReleased`.
     - While held, the overlay's button carries `.is-held`.
  1. **The overlay draws the run.**
     - Within 15 s (under `--ptt`, within 8 s of the release), `.subtitle-app`'s text in the overlay contains one of the `long` script's texts: `今日は天気がいいですね。` or `The weather is nice today.` (`src/providers/fake/generate.ts:5-6`).
     - `.karaoke-played` is seen at least once while polling every 100 ms for 10 s.
  2. **The virtual microphone reaches the meeting tab.**
     - The stub's `window.__pcm > 0` within 10 s of the first text. The tab route is `tabMicrophone.ts` → `content.js:194-208` → the page.
     - This is not Meet's consumption, which stays the owner's check.
  3. **`--ptt`: where the keyboard goes after a hold — recorded, not failed** (controller rulings a, I7).
     - **Space.** `Page.bringToFront` on the meeting page, then `Input.dispatchKeyEvent` Space down and up on its session.
       - Print `after a hold, Space reached the page: yes|no`, from `window.__keys.includes(' ')`.
       - Print whether the overlay's hold button showed `.is-held` meanwhile. It must not: the button gave up focus.
     - **Escape**, the same way.
       - Print `after a hold, Escape reached the page: yes|no; subtitle mode exited: yes|no`. The second part is whether `#sokuji-subtitle-host` is gone within 2 s.
       - If subtitle mode exited, click the side panel's `[data-tour="subtitle-enter"]` again, and wait for a new overlay target before check 4.
  4. **Whether storage is shared, and the language** (ruling 5; controller rulings I5, M11).
     - **Storage.** Print `extension storage shared with the overlay: yes|no`, from `localStorage.getItem('sokuji-probe-shared') === '1'` in the overlay's document.
       - The sentinel was written in the side panel only, and the overlay never writes `i18nextLng` (controller ruling M11). So this answers survey G8's open question about partitioning, where a read of `i18nextLng` could not.
     - **Language.** Click the side panel's main action to Stop. Within 5 s the overlay's `.subtitle-idle__message` reads `subtitle.sessionEnded` from `src/locales/ja/translation.json`, which the probe reads from the file.
       - If storage is partitioned, the Japanese words came over the wire.
       - If storage is shared, print that this check cannot tell the wire from the overlay's own detection, which reads the same `i18nextLng`. The unit tests of Tasks 1 and 5 carry the wire's proof.
  5. **Exit from the overlay.**
     - Start again and wait for running. In the overlay session, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))` → `useSubtitleChrome`'s exit.
     - Within 3 s the meeting page has no `#sokuji-subtitle-host`, and the side panel's `[data-tour="subtitle-enter"]` no longer has `is-active`.
  6. **The side panel going away.**
     - Click `[data-tour="subtitle-enter"]` again, and wait for the host.
     - `Target.closeTarget` on the side panel's target. Within 3 s the meeting page has no `#sokuji-subtitle-host`: the overlay's `sidepanel-gone`.
  7. **`--shot <file>`:** `Page.bringToFront` on the meeting page, then `Page.captureScreenshot` of it with the overlay up, taken right after check 1. That is the overlay at 140 px in a page, for ruling 10 and the owner's report.

  The header, in the form of the other probes: what it drives, the flags, and "exits 1 on any miss, 2 on a flag it cannot serve". The usage line is `node scripts/dev/extension-overlay-probe.mjs [--ptt] [--shot file.png] [--no-build] [--build-dir dir]`.
- [ ] **Step 3: Run** it until it passes, or until a link fails for a reason outside this repo: headless Chromium, CDP, extension loading. Run `npx vitest run src` and the gate too; nothing under `src` changed.
- [ ] **Step 4: Commit, only if the probe works**

  ```bash
  git add scripts/dev/extension-overlay-probe.mjs
  ```

  ```bash
  git commit -q -F - -- scripts/dev/extension-overlay-probe.mjs <<'EOF'
  feat(dev): a headless probe of the extension overlay in a meeting page

  <body: the chain (dev build → --load-extension → Fetch-served meeting stand-in
  in its own window → fullpage.html?tabId= in another → frame auto-attach), the
  checks, and the recorded focus and storage facts>

  Co-Authored-By: <implementing model>
  EOF
  ```

  If it cannot work, commit nothing. The report names the link that failed, with its evidence.

**Group check B (controller, after this task).** If the probe exists, these two pass:
- `node scripts/dev/extension-overlay-probe.mjs --build-dir /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/sokuji-extension-probe`
- `node scripts/dev/extension-overlay-probe.mjs --no-build --build-dir /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/sokuji-extension-probe --ptt --shot /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/1e4-overlay-meet.png`

Record their printed facts:
- where Space and Escape went after a hold;
- whether storage is shared with the overlay.

Look at the screenshot beside group check A's; it goes in the owner's report too.

---

### Task 10: Acceptance, and the roadmap entry (controller)

**Files:** Modify `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`.

- [ ] **Step 1:** Append `## Scheduled by plan 1e-4`, in the form of the entries before it. It records:
  - **What landed:** the commits and the tasks.
  - **What was checked:**
    - group check A's probes;
    - the wire's printed numbers (ruling 6), with the 64-KB steady-state threshold and whether it held;
    - the layout decision at 140 px: the new overlay rendered, the old overlay's markup and CSS read (ruling 10, controller ruling b);
    - the overlay chunk list before and after;
    - the release build's absence of the root and the registry from the overlay's graph (with the positive control), and of the fake;
    - group check B's outcome, or the spike's failed link and why (ruling 7), including where Space and Escape went after a hold, and whether storage is shared with the overlay.
  - **Stated departures:** the list in this plan's self-review.
  - **What it leaves:**
    - **The owner's extension acceptance, owed before 1e-3c:**
      - the virtual microphone in a real Google Meet tab, with passthrough on at a low ratio, checked for gaps (roadmap, "Deferred by plan 1c-2");
      - audio in the extension side panel by hand (roadmap, "Scheduled by plan 1e-3b-2");
      - a live local session in the extension: LocalInference with models, in the side panel (roadmap row 1e-4);
      - the overlay in a real Meet tab: the run drawn, karaoke, the hold button, Clear, ✕ / Escape, the side panel closing, a tab reload, and the language after a change in Help. If Task 9 produced no probe, its checks 1–6 by hand;
      - **two meeting tabs, each with its side panel in subtitle mode** (controller ruling M12). Each overlay shows its own tab's run, and a hold, Clear or ✕ in one reaches only its own side panel. Nothing else verifies ruling 4's reason: the unit tests use fakes and Task 9 has one panel. The same run shows whether a background tab's side panel stays alive (survey G2's open question);
      - the new overlay's screenshots from group checks A and B, for the 140-px layout (controller ruling b).
    - **Decided, not owed** (controller rulings a, I7): after a hold's release, focus stays in the overlay's iframe until the user clicks the page, and an Escape meant for the meeting then exits subtitle mode. Handing focus back to the page — the content script blurring the iframe on a new window message — is a follow-up only if the owner asks. Task 9's recorded facts go here.
    - **1e-3c:** the list under "What becomes dead" below, verbatim.
    - **Before the first release:** the entries delta, only if a steady entries message exceeded 64 KB.
    - **Development only:** the probe's notes (`--build-dir`, `--no-build`).
- [ ] **Step 2: Commit**

  ```bash
  git add docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md
  ```

  ```bash
  git commit -q -F - -- docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md <<'EOF'
  docs(roadmap): what plan 1e-4 built — the extension overlay — and what it leaves

  Co-Authored-By: <the controller's model>
  EOF
  ```

---

## The controls path back (survey G4, as built)

| Overlay action | Crosses as | Side panel does |
|---|---|---|
| Hold press / release (pointer; Space / Enter while focused) | `subtitle:turn-press` / `subtitle:turn-release` | `runner.press()` / `runner.release()` through the feed. The publisher releases an outstanding press when the overlay goes, and when the surface stops it (Tasks 3, 6) |
| Clear (`SubtitleBar.tsx:250-258`) | `subtitle:request-clear` | `runner.clear()`, as the takeover does. It does not hide a failed start's line, which the panel's own Clear does (roadmap 1e-3b-1 → 1e-3b-2) |
| ✕, Escape, "Return to main window" | `subtitle:user-exit` | `exitSubtitleMode()` → `subtitle:exit` → teardown (stop, then close) |
| Display modes, font, colours, compact, lock | — (the overlay's own `subtitleStore`, persisted to `chrome.storage`) | nothing: independent by design (spec "What may change during a run") |
| Drag / resize | window `postMessage` to the content script | nothing |
| Start, stop, Settings | none: read-only (ruling 2), and there was no Settings navigation to carry | — |

The panel's Space and the overlay's hold are two held states over one runner. Either one's release closes the turn (ruling 12).

## What becomes dead — for plan 1e-3c

This plan deletes only what it rewrites:
- the surface class's old data path (`MAX_FORWARDED_ITEMS`, `ITEMS_THROTTLE_MS`, `recentItems`, `stripHeavyItemFields`, `postWire`, `handlePortMessage`, `installStoreSubscriptions`, the throttle fields, `useSessionStoreForClear`) and the tests of it (Task 6);
- the overlay entry's old body and its ledger row (Task 7).

Keeping the rest compiled but unreachable costs nothing, and the files below hang together: `sessionPortMirror.ts` imports `subtitleWire.ts`, which `playbackStore.ts` also imports, which `SubtitleStream.tsx` reads, which `SubtitleApp.tsx` renders. Deleting any link here would drag the chain into this plan.

After this plan, plan 1e-3c deletes:
- **`src/stores/sessionPortMirror.ts`**, `sessionPortMirror.test.ts` and `src/stores/subtitleWire.roundtrip.test.ts`. No importer is left once Task 7 lands.
- **`src/types/subtitleWire.ts`**: `PlaybackWire`, the five old message shapes and the old `SubtitleControlMessage`. The `state-init`, `items`, `session`, `config` and `playback` messages die with it.
- **`src/stores/playbackStore.ts`**, `playbackStore.test.ts` and `playbackStore.usePlaybackHighlight.test.tsx`. Its only non-test importers are then `SubtitleStream.tsx:5` and the mirror.
- **`src/components/Subtitle/SubtitleApp.tsx`**, `SubtitleApp.handleStart.test.tsx` and `SubtitleApp.rootStyle.test.tsx`.
  - First move `SubtitleSurfaceKind`'s imports (`SubtitleBar.tsx:34`, `useOverlayDragResize.ts:4`) to `./useSubtitleChrome`.
  - Re-home `SubtitleApp.test.tsx`'s `getHighlightOverlayForBg` test next to `useSubtitleChrome.tsx:40`.
  - **Keep `SubtitleApp.scss`**: `SubtitleView.tsx:22` imports it.
- **`src/components/Subtitle/SubtitleStream.tsx`** and its test. **Keep `SubtitleStream.scss`**: `SubtitleBands.tsx:9` imports it.
- **`subtitleIdleState.ts`'s `deriveSubtitleIdleState` / `IdleStateInput`** and `subtitleIdleState.test.ts`. Keep the `SubtitleIdleState` type, which `SubtitleIdle.tsx:13` and `SubtitleView.tsx:20` import, without its `blocked` variant.
- **`SubtitleIdle.tsx`'s `blocked` branch**, its `onFix` prop, and its `MainPanel/sessionStartGate` import (`:12`). `SubtitleView` never produces `blocked`.
- **In `SubtitleBar.tsx`:**
  - `exportProps` and the legacy `ExportButton` default import (`:14,47,85,248`);
  - the `requestExit` fallback that dispatches `sokuji:user-exit` (`:108-117`) — `onExit` becomes required, and with it the `sokuji:user-exit` window event dies;
  - its `useExitSubtitleMode`, which only that fallback uses.
- **`services/providers/speechMode.ts`'s `isPushGatedMode`**: its only non-test importer is `SubtitleApp.tsx:40`. That dissolves `1e3-deletion.md` §5 step 3's blocker.
- **`sessionStore`'s hooks that only `SubtitleApp` reads:** `useItems`, `useParticipantItems`, `useIsSessionActive`, `useSessionStartTime`, `useRequestClearConversation`, `useStartGate`, `useInitProgress`, `useRequestSessionStart` / `Stop`.
- **`MainPanel/useSubtitleSessionBridge.ts`**, already on 1e-3c's list.
- **The duplicated entries adapter** (controller ruling M10, accepted here). `{ get: () => view.get().entries, subscribe: view.subscribe }` now exists twice: in `src/app/session.ts`'s feed (Task 4), and in `SpinePreview.tsx`'s `PreviewOverlayFrame`. Plan 1e-3c makes the preview publish from `currentSubtitleFeed()` instead, which also puts the feed wiring the extension uses under `spine-subtitle-probe`. The third copy of the tests' `box<T>()` can move to a shared test helper then too.
- **Comments that name the dead code:**
  - `SubtitleBar.tsx:243-247`: the export note cites `MAX_FORWARDED_ITEMS`, which Task 6 deletes (controller ruling M9; `SubtitleBar.tsx` is read-only here);
  - `src/types/subtitleWire.ts:12`: cites `stripHeavyItemFields()`, which Task 6 deletes (controller ruling M9; the file goes with 1e-3c anyway);
  - `SubtitleIdle.tsx:3-8, 20-24` (the mirror);
  - `platforms.ts:4` (still true);
  - `geminiTranslateModel.ts:58`;
  - `IClient.ts:19` and `LocalNativeClient.ts:485` (deleted with the clients);
  - `settingsStore.ts:1646`;
  - `settingsStore.providerSettings.test.tsx:1`;
  - `ExportButton.tsx:420`.

**What stays on the wire:**
- the port name `sokuji-subtitle` (`SUBTITLE_PORT`);
- `subtitle:enter` / `subtitle:exit` (tab messages);
- `sokuji-subtitle:drag-start` and `sokuji-subtitle:sidepanel-gone` (window messages);
- the four `ToPanel` controls;
- the four `ToOverlay` messages.

---

## Self-review

**Coverage of the survey's gaps, as ruled:**

| Gap | Where it is covered |
|---|---|
| G1, the publisher | in the surface class, through the feed leaf registered at `attach()`: Tasks 4, 6, ruling 1. What goes from the class: Task 6's list |
| G2, the transport | the sender filter, with foreign ports disconnected (Task 6, ruling 4, choice 2); the target known before the send, and `?tabId=` (Task 6); stop before close, and on reconnect (Task 6, choice 1); the overlay's own disconnect → dispose + `sidepanel-gone` (Task 7); the JSON round trip (Task 1, ruling 11) |
| G3, the entry | rewritten over `connectOverlay` + `ConnectedOverlay`, with the mirror, `postUserExit` and the window event dropped, the ledger row gone, and neither the root nor the registry in its graph (Tasks 5, 7; group check A's built-bundle grep) |
| G4, the controls | the table above (Tasks 3, 5, 6; rulings 2, 12). Ruling 2's "settings navigation" is corrected (there is none) |
| G5, the gate | kept on `running`, comment rewritten (Task 6, ruling 3) |
| G6, karaoke timing | nothing to build: `lit` comes from the side panel's queues, as the wire already did in the preview |
| G7, the wire's cost | measured in the preview; the 64-KB threshold applies to the steady state, messages sent once the tail has reached its cap (Task 8, group check A, ruling 6, controller ruling M2) |
| G8, localisation | on the wire (Tasks 1, 5, 6, ruling 5), shown by the overlay and never stored by it (Task 5, controller ruling M11). Partitioning is recorded by Task 9's storage sentinel if the probe works (controller ruling I5) |
| G9, the build | no `extension/` change; the build, the graph check, the fake check and the chunk list before and after (group check A) |
| G10, tests | each task's. The surface class's old data-path tests are deleted with the code they test (Task 6) |
| G11, a headless probe | Task 9, ruling 7 |
| G12, small correctness items | G12.1 (Task 2, ruling 8); G12.2 (Task 3, ruling 9, choice 4 — focus and Escape after a hold decided and accepted, controller rulings a and I7, recorded by Task 9); G12.3 (Task 8, group check A, ruling 10, controller ruling b) |
| G13, acceptance | Task 10's owner list (the virtual microphone in Meet, audio in the side panel, a live local session, the overlay in Meet, two tabs with two side panels) |

**Placeholders.** Three are deliberate:
- Task 9's probe is described link by link, with its CDP calls, fallbacks and pass criteria, but not written out as code: it is a spike, and whether each link holds decides its shape.
- Task 10's roadmap prose is the controller's, with its required contents listed.
- The commit bodies are the implementer's, with each subject given.

Everything decided is written out:
- every test case with its assertions;
- the wire's additions;
- `holdToTalk`;
- `HoldToTalk`;
- the feed and its registration;
- `ConnectedOverlay` and `showLanguageUncached`;
- the surface class in full;
- `connectOverlay` and the entry;
- the ledger row;
- `tallied` with its `steadyMax`, the preview's changes, the SCSS and the probe's additions;
- group check A's sentinel commands.

**Types across tasks:**

| Produced | Consumed by |
|---|---|
| `OverlayReceiver` (Task 1) | `ConnectedOverlay` (Task 5), `OverlayPreview` (Task 5), `connectOverlay` (Task 7) |
| `OverlayModel.language` (Task 1) | `ConnectedOverlay`'s effect (Task 5) |
| `SUBTITLE_PORT` (Task 1) | `handleConnect` (Task 6), `connectOverlay` (Task 7) |
| `PanelSources.language` (Task 1) | the surface (Task 6), the preview (Task 8) |
| `uiLanguage` (Task 1) | the surface (Task 6), the preview (Task 8); both mock or pass it as a `Readable<string>` |
| `SubtitleFeed` / `registerSubtitleFeed` / `currentSubtitleFeed` (Task 4) | `attach()` (Task 4) and the surface (Task 6) |
| `ChromePortLike` (existing) | `IncomingPort` (Task 6), the entry's `chrome` declaration (Task 7) |
| `showLanguageUncached` (Task 5, `src/locales/index.ts`) | `ConnectedOverlay` only (Task 5) |
| `WireTally` / `tallied`, `WireCount.steadyMax` (Task 8) | `SpinePreview`, and `spine-subtitle-probe.mjs` through `window.__sokujiWire` |

The surface's `SubtitleFeed.sources` is a `Pick` of `PanelSources` spread with `language`, which yields a full `PanelSources`. `publishSubtitles`'s signature is unchanged apart from the optional source, so the preview's existing call compiles with or without it. The compile-time JSON check (Task 1) was run against today's `ToOverlay` / `ToPanel`: both `true`. A negative control (an optional `ReadonlyMap` in an interface in an array) fails to compile.

**Stated departures from today:**
- The overlay draws the live run again, dead since the switch, on the new renderer:
  - bands joined by script;
  - karaoke lit by the side panel;
  - a hold button under manual turns;
  - no "Press Space to speak" (D16);
  - Clear clears the conversation, but not a failed start's line.
- Only the side panel's own tab's overlay is served; any other tab's port is disconnected (ruling 4).
- `enter()` targets the side panel's `?tabId=`, not the active tab (ruling 4).
- The overlay's words follow the side panel's language, live (ruling 5). The overlay never stores it: its document's language detector stops caching `i18nextLng` (controller ruling M11).
- No hold button on the overlay, and no Space hint on the Electron takeover, in a participant-only run (ruling 8).
- The hold button holds on Space/Enter while focused, releases on blur, and gives up focus after every release (ruling 9, choice 4). After a hold, focus stays in the overlay's iframe until the user clicks the page, and an Escape meant for the meeting then exits subtitle mode. Both are decided and accepted (controller rulings a, I7).
- An overlay that connects with no session attached is closed, with a warning (choice 5).
- The preview's overlay is 140 px high (ruling 10).

Unchanged:
- the subtitle button's gate;
- what the content script does;
- the manifest;
- the overlay's own display settings;
- a Stop → Start from the panel shows the overlay "Session ended" during `starting`, as the old overlay did.

**Checked against the code at `f7085ddd` while writing:**
- The typecheck gate prints the 17 lines above.
- `npx vitest run src`: 471 files passed, 1 skipped; 5 993 tests passed, 2 skipped; no unhandled errors.
- `settingsStore` already imports `src/locales` (`:33`).
- `extension/vite.config.ts:201` defines `import.meta.env.DEV` from the mode.
- The Playwright Chromium here is Chromium 151, unbranded.
- `wire.test.ts`'s port pair already clones through JSON (`:16-33`), but asserts no equality: this corrects the survey's "nothing tests a JSON round trip".

**Amended after the pre-flight review** (`1e4-preflight.md`) and the controller's rulings on it:
- **Global Constraints:** I1, the parallel-wave rule; M6, the shell forms and the job's tmp directory.
- **Ruling 5:** M11, the overlay never stores the language, through `showLanguageUncached` and its storage test.
- **Ruling 6, Task 8 and group check A:** M2, the budget on the steady state, via `steadyMax` and a 150-s run.
- **Ruling 9 and choice 4:** ruling (a) and I7, focus and Escape after a hold decided (M1).
- **Ruling 10 and group check A:** ruling (b) and I2, render the new overlay, read the old one's markup and CSS.
- **Task 9:** I3, the hold before check 1; I4, the speech fixture; I5, the storage sentinel; I6, windows, flags and the default context; I7, Space and Escape recorded; M13 and M14 in the limits; M15, `DOM.getFrameOwner` and the link-2 fallback.
- **Test claims:** M3, the cases that pass before their implementation are named in Tasks 1, 2, 4, 5, 6 and 7; M4, Task 5 case 3 exercises the guard; M7, the `box` line numbers.
- **Group check A:** M5, two sentinels with a positive control. Checked on 2026-09-26's dist: the overlay commands print nothing, and the side panel's chunks show both sentinels.
- **Housekeeping:** M8, React 19.
- **Lists:** M9 and M10 on 1e-3c's list; M12 on the owner's Meet list.
- **Re-checked:** the gate widened by `locales/(index\.ts|showLanguageUncached)` still prints the same 17 lines at `f7085ddd`. i18next 25.10.10's `changeLanguage` caches through the detector's `cacheUserLanguage`, and detector 8.2.1's `init` lets an explicit `caches: []` win.
