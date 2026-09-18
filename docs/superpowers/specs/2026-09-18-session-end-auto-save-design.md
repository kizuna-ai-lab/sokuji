# Session-End Auto-Save — Design

**Date**: 2026-09-18
**Status**: Approved section by section in brainstorming with jiangzhuo. Reworks
kizuna-ai-lab/sokuji#537 (sivertillia), which will be carried on its own branch.
`file:line` references are verified against branch `worktree-pr537-auto-save-carry` at
`80bc11b9` = PR head `9da935f7` + `origin/main` `63d92f1b`.

## 1. Problem

PR #537 adds an opt-in "save the conversation as .txt when a session stops". The feature is
wanted; the implementation is not the shape we want to keep:

- **MainPanel absorbs the export pipeline.** Ten functions are imported from
  `utils/conversationExport` (`MainPanel.tsx:85-96`), and ExportButton's `txtI18n` block and
  `buildPayload` metadata assembly are copied line for line into a new effect
  (`MainPanel.tsx:4280-4331` vs `ExportButton.tsx:239-280`).
- **The trigger is timing-dependent.** A ref is armed inside the speaker leg of
  `disconnectConversation` (`MainPanel.tsx:1841`) and fired by an effect on the next
  `[items, participantItems]` render. In split Both mode that render can commit while the
  participant leg is still awaiting `disconnect()` (`MainPanel.tsx:1878-1887`), so the other
  party's last lines are missing from the file; the participant leg never captures its final
  items at all. The arm line sits after `if (!client) return` (`MainPanel.tsx:1807`), so a
  participant-only ("Others") session never saves.
- **"Auto" is not automatic on desktop.** Electron has no `will-download` / `setSavePath`
  handler anywhere in `electron/`, so every scripted download opens a Save As dialog.
- **Closing the window mid-session saves nothing.** `electron/main.js` only listens for
  `closed` (`main.js:440`); the renderer's `pagehide` handler (`MainPanel.tsx:1084`) only
  releases the mic. The session is never ended, so nothing is captured.
- **Placement and copy.** The toggle lands in the Languages section beside Text Only / Keep
  replay audio (`LanguageSection.tsx:775`); its tooltip claims "the same file the .txt export
  button produces", which is false (manual export scopes by the toolbar filter). The filename
  embeds the first 40 characters of what the user said (`deriveAutoSaveTitle`,
  `conversationExport.ts:414`), which leaks speech into download history and synced folders.

Main has since fixed one finding the review raised: the speaker ref is now cleared on Stop with
compare-and-clear (`MainPanel.tsx:1874-1876`), so a stale client from a previous session no
longer arms the save on Cancel.

## 2. Decisions

Settled in brainstorming; each was a choice between listed alternatives.

1. **The toggle lives in the Export menu**, as the last row of the toolbar's Export dropdown —
   next to the action it automates. Not in Languages, not in a new settings section.
2. **Desktop saves silently to the Downloads folder** through a new IPC channel; a toast names
   the file and offers "Show in folder". Manual export keeps its Save As dialog. Rejected: a
   global `will-download` handler (would change manual export too, and could only tell auto
   from manual by filename); accepting a Save As per stop.
3. **The file is always the full conversation** — both channels, originals and translations.
   The Export menu's "Include" checkboxes remain manual-export-only. Rejected: following the
   toolbar filter (an archive silently thinned by a viewing preference); persisting the
   checkboxes (breaks their "seeded on open, never written back" design).
4. **It saves whenever a session that actually became active ends** — user Stop, server or
   network close, an error that ends the session. Not on Cancel during Start, a failed
   connect, or an empty conversation. **Closing the desktop window mid-session ends the session
   first**, so window close funnels into the same moment. The extension side panel cannot be
   intercepted; that gap is stated in the toggle's tooltip.
5. **Structure: an explicit call at the end of `disconnectConversation`** (approach A).
   Rejected: B, a "session ended" event with a subscriber registered at startup (event
   machinery and a large snapshot in a store for one consumer); C, a hook watching
   `isSessionActive` go false (it goes false at the *start* of teardown — the PR's timing bug
   again).
6. **No hint line under the toggle** — the menu is 200–240 px wide. The explanation is a
   tooltip; on desktop the first save's toast is where the user learns where the file went.
7. **The conversation toolbar is always shown**, not only while a session is active or items
   exist. The condition dates from #142, when the toolbar held only the Clear button; nothing
   depends on it being hidden. The Export button is always openable; its three actions are
   disabled while the conversation is empty.
8. **The filename is the generic `sokuji-conversation-<YYYYMMDD-HHMMSS>.txt`** — never content.
9. **Landing: carry onto the contributor's branch** (the #497 / #536 precedent). Pushing to
   `sivertillia`'s fork is an outward act and needs jiangzhuo's confirmation at that time.

## 3. Units

| Unit | File | Does | Depends on |
|---|---|---|---|
| `buildTxtI18n(t)` | `src/utils/conversationExport.ts` | The 11 header/speaker strings, once | an i18next `t` |
| `buildTxtExport(input)` | same | Items + provider context + optional scope → `{ content, filename }` | the existing normalize/format functions |
| `mergeConversationItems(...)` | `src/components/MainPanel/conversationMerge.ts` (new) | The speaker+participant tag-and-merge now inline in `combinedItems` (`MainPanel.tsx:1292`) | nothing (pure) |
| `autoSaveTranscript(snapshot, deps)` | `src/lib/transcript/autoSave.ts` (new) | Setting check → empty check → build → platform save → toast; never rejects | the above, `settingsStore`, `i18n`, `report` |
| Export menu toggle row | `src/components/MainPanel/ExportButton.tsx` | Reads/writes `autoSaveOnStop` directly from `settingsStore` | `settingsStore` |
| Toast action | `src/components/Toast/*` | Optional `{ label, onClick }` button on a toast | — |
| `transcript-save.js` | `electron/transcript-save.js` (new) | Name, de-duplicate and write a transcript into a directory | `fs`, injected dir and clock |
| `close-handshake.js` | `electron/close-handshake.js` (new) | idle/waiting/approved state machine for window close and app quit | injected window, app, timers |

`buildTxtExport` input: `{ items, provider, providerSettings, localInferenceSettings,
fallbackLanguages: { sourceLanguage, targetLanguage }, i18n: TxtI18n, scope?, now? }`.
ExportButton's `.txt` download, `.json` download and copy all switch to it (JSON and copy use
its payload half), so the manual file is produced by the same code as the auto file. With no
`scope`, the file is the full conversation and carries no "narrowed" note.

`ExportButton` reads `useAutoSaveOnStop` / `useSetAutoSaveOnStop` itself rather than taking
two more props from MainPanel and SubtitleBar: the preference belongs to the export feature.
The Electron subtitle bar is the main window resized (`subtitle:enter` → `setBounds`), and its
menu is a `createPortal` into a `window.open` child, so both hosts share one store.

MainPanel's net change: two imports (`autoSaveTranscript`, `mergeConversationItems`), the
capture lines in `disconnectConversation`, the close-request listener, and the toolbar
condition. The PR's `pendingAutoSaveRef`, its effect and its ten imports are removed.

The store part of the PR stays as written: `autoSaveOnStop` on `CommonSettings`, its setter
with rollback, `loadSettings`, the two hooks and their three tests. The setting key
`settings.common.autoSaveOnStop` is kept; it never shipped and users never see it.

## 4. Data flow

### 4.1 Session end (`disconnectConversation`)

All three endings — Stop, a client's `onClose`, an error that ends the session — already route
here (`MainPanel.tsx:1693`).

1. Before the first await, next to the existing `speakerToTearDown` capture
   (`MainPanel.tsx:1726`): `const wasActive = useSessionStore.getState().isSessionActive;` —
   read before `setIsSessionActive(false)` (`MainPanel.tsx:1739`). `isSessionActive` becomes
   true only after both legs are up (`MainPanel.tsx:2949`), so Cancel during Start and
   connect-failure cleanup (which also calls this function) read `false`.
2. Inside `teardownSessionLegs` each leg records its final items before `reset()`:
   - speaker: after `disconnect()` and the throttle clear, `speakerFinal =
     client.getConversationItems()`; `setItems(speakerFinal)` as today;
   - participant: after `disconnect()`, `participantFinal =
     participantClient.getConversationItems()`, then `reset()`.
   A leg with no client contributes `[]`. Participant items reach React the same way during the
   session (`setParticipantItems(client.getConversationItems())`), so the snapshot has the same
   source as the screen.
3. After `teardownSessionLegs` resolves, still inside the `try` so it precedes the `finally`
   that resolves `disconnectDoneRef`:
   `if (wasActive) await autoSaveTranscript(snapshot, { showToast })`, where
   `snapshot = mergeConversationItems(speakerFinal, participantFinal, itemLanguagesRef.current,
   liveLanguages)` and provider context is read with `getState()` at that moment, not from the
   render closure. The merge reads the language-snapshot map without mutating it; pruning stays
   in the `useMemo`. `autoSaveTranscript` never rejects, so teardown order is unaffected; the
   save is awaited so that anything awaiting `disconnectDoneRef` (a queued Start, the close
   handshake) also waits for the file.

The two other `teardownSessionLegs` call sites (`MainPanel.tsx:2744`, `:2841`) take down a
half-built session that never became active; they get no save.

### 4.2 Desktop window close and app quit

```
main: mainWindow 'close' / app 'before-quit'
  approved            → pass through
  waiting             → preventDefault (repeat clicks ignored)
  idle, no live page  → pass through (window gone, webContents destroyed or crashed)
  idle                → preventDefault, state = waiting, remember quit vs close,
                        send 'app:close-requested', start 5 s timer
renderer (MainPanel listener):
  if isSessionActive  → await disconnectConversation()
  await disconnectDoneRef.current   (covers a Stop already in flight)
  invoke 'app:close-ready'
main: on 'app:close-ready' or timeout → state = approved,
      then mainWindow.close(), or app.quit() if a quit started it
```

- The in-flight wait reuses the existing `disconnectDoneRef` (`MainPanel.tsx:1715`),
  published before the first await and resolved in `finally`: "Stop, then close at once" waits
  for the same teardown instead of returning through the re-entry guard.
- **The quit path defers cleanup.** `before-quit` currently runs `cleanupAndExit`
  (`main.js:579`), which stops the native host and removes virtual audio devices. Listeners
  after a `preventDefault` still run, so the handshake cannot simply be registered first: the
  `main.js:579` registration becomes one listener that asks the handshake and returns early
  while it is pending, running `cleanupAndExit` only once the quit is approved. The macOS
  per-close registration (`main.js:445`) and `will-quit` (`main.js:610`) are unchanged;
  `cleanupAndExit` must be confirmed safe to run more than once, since those paths can already
  call it twice.
- After 5 s the window closes regardless; a hung teardown can lose that session's file.
- Reload (dev) does not emit `close`, so it is unaffected.

#### Amendment (2026-09-18, final review)

The hold applies only while the renderer reports a session as busy over a new invoke channel,
`app:session-busy`: MainPanel sends `true` when `isSessionActive` turns true and `false` at the
end of `disconnectConversation`'s outer `finally`, after the save — `isSessionActive` itself
turns false as the teardown begins. The idle row above becomes "idle, no live page or no
session busy → pass through", so the setup wizard, a loading page or an error screen (none of
which mounts the listener) close at once instead of waiting out the timeout; a new main window
starts not busy, and both handshake channels ignore any sender but the main window's page. An
update install ends a running session first (`UpdateManager`'s `beforeInstall` →
`closeHandshake.endSessionThen`), then runs its unchanged install path in place of any pending
close or quit, so the updater's own quit is not held while the new instance starts. The
handshake then returns to idle, not approved, so a failed install leaves closing as it was;
after a timeout it also stops treating the hung page as busy.

### 4.3 Extension and web

No handshake. `autoSaveTranscript` uses the existing anchor-click `downloadFile`
(`conversationExport.ts:431`); Chrome saves to its download folder unless the user has "ask
where to save" on. Closing the side panel mid-session does not save.

## 5. What the user sees

### 5.1 Export menu

```
├─────────────────────────────┤
│ ⧉  Copy to clipboard        │
│ 🗎  Download as .txt         │
│ {} Download as .json        │
├─────────────────────────────┤
│ [○━] Auto-save when session ends │
└─────────────────────────────┘
```

- The row copies the Help section's "Diagnostic logs" mini switch track (`help-link__switch`,
  the style chosen for #538) scaled to a menu item. Role `menuitemcheckbox` with
  `aria-checked`; it joins the roving keyboard ring after ".json"; clicking it does not close
  the menu (it is a setting, like the scope boxes).
- Tooltip on the row: the project `Tooltip` in the floating host; a native `title` in the
  Electron child-window host, whose 240 px OS window would clip a floating tooltip.
- The child-window host grows by one row (`ExportButton.tsx:343`, `height={140}`); the exact
  height is settled by rendering every locale.
- The Export button is no longer `disabled={!hasContent}` (`ExportButton.tsx:324`, `:381`).
  "Empty" keeps its current meaning, `normalizeMessages(combinedItems).length === 0`
  (`ExportButton.tsx:126`): the three actions are disabled and "Nothing selected" is not shown
  (it is reserved for a non-empty conversation the scope excludes entirely). The same test is
  `autoSaveTranscript`'s "nothing to save".

### 5.2 Toolbar

- `(isSessionActive || combinedItems.length > 0) &&` (`MainPanel.tsx:4348`) no longer gates
  the toolbar, except while `subtitleTakeover` is on (extension subtitle overlay owns the
  conversation): there the old condition still applies, unchanged.
- Clear conversation (`MainPanel.tsx:4439`) is disabled while `combinedItems.length === 0` —
  the exact test that used to hide the toolbar, so Clear stays available whenever it used to be
  visible (including rows that are notices, not speech).
- The two display-mode buttons keep their per-mode conditions; font size, compact view and
  display settings work before a session and persist as they do now.
- The Electron subtitle bar has its own toolbar and is unchanged apart from the menu row.

### 5.3 Toasts

- Desktop success: "Conversation saved: {{filename}}", action "Show in folder" (existing
  `open-directory` handler, `main.js:872`, on the returned directory), success variant, 6 s.
- Extension/web success: none. Chrome's download bubble is authoritative; the page cannot tell
  whether Chrome's download limiter blocked the file.
- Failure: error toast "Couldn't auto-save the conversation. You can still save it from
  Export → Download as .txt." The conversation stays on screen until the next Start clears it
  (`connectConversation`'s `setItems([])`, `MainPanel.tsx:2118`), so the manual path works.
- During window close: none.

### 5.4 Strings

New keys (English defaults), in all 30 locales:

| Key | Default |
|---|---|
| `mainPanel.export.autoSave.label` | Auto-save when session ends |
| `mainPanel.export.autoSave.tooltipDesktop` | When a session ends, save the whole conversation — both sides, originals and translations — as a .txt file in your Downloads folder. |
| `mainPanel.export.autoSave.tooltipBrowser` | When a session ends, download the whole conversation — both sides, originals and translations — as a .txt file. Closing the side panel during a session does not save it; stop the session first. |
| `mainPanel.export.autoSave.saved` | Conversation saved: {{filename}} |
| `mainPanel.export.autoSave.showInFolder` | Show in folder |
| `mainPanel.export.autoSave.failed` | Couldn't auto-save the conversation. You can still save it from Export → Download as .txt. |

Removed from all 30 locales: the PR's `simpleConfig.autoSaveOnStop` and
`simpleConfig.autoSaveOnStopDesc`.

## 6. Failure handling

- `autoSaveTranscript` wraps its whole body. Any throw (normalize, format, IPC, download) →
  `reportError('AutoSave', 'Failed to auto-save the conversation: ' + describeCause(err),
  { cause: err })` plus the failure toast; it resolves either way. Severity `error`: what the
  user asked for did not happen.
- `transcript:save` takes `{ content }` only. Main names the file itself (clock in main, same
  pattern as the manual export), writes with exclusive-create into
  `app.getPath('downloads')`, and on a clash retries `... (1).txt`, `... (2).txt`. The
  renderer cannot pass a path or a name, so it cannot write outside Downloads. Non-string
  content is rejected. Returns `{ ok: true, path, dir }` or `{ ok: false, error }`.
- A failed write is reported by the renderer (the main process is outside the report policy).
- No `console.error` / `console.warn` is added; `consoleLedger.consistency.test.ts` rows do
  not move.

## 7. IPC

| Channel | Direction | Registered in |
|---|---|---|
| `transcript:save` | renderer → main, invoke | `INVOKE_CHANNELS` (`ipc-channels.js:33`); handler in `main.js` wiring `transcript-save.js` |
| `app:close-ready` | renderer → main, invoke | `INVOKE_CHANNELS`; handler wires `close-handshake.js` |
| `app:close-requested` | main → renderer | `validReceiveChannels` (`preload.js:62`) |

`ipc-channels.test.js` then guards both invoke handlers automatically.

## 8. Testing

There is no React harness that renders MainPanel; ordering properties are tested by replaying
its sequence around the real functions, as `splitDegradedWiring.test.ts` and
`participantErrorOrdering.test.ts` do.

1. **Export refactor.** Before refactoring, pin ExportButton's current `.txt` output as a
   golden test; after moving to `buildTxtExport` it must be byte-identical. Add
   `buildTxtExport` cases for the full scope (no narrowed note) and the generic filename.
2. **`mergeConversationItems`.** A characterization test against the current `useMemo` logic,
   written before the extraction: source fallback, language snapshot vs live fallback, order.
3. **`autoSaveTranscript`.** Toggle off → nothing. Empty conversation → nothing. Electron →
   invokes `transcript:save` with `{ content }` only and toasts with an action. Browser →
   `downloadFile`, no toast. IPC `{ ok: false }`, IPC throws, build throws → `reportError` and
   the failure toast, and the promise resolves.
4. **Session-end ordering** (replayed `disconnectConversation` around the real
   `teardownSessionLegs`, `mergeConversationItems`, `autoSaveTranscript`):
   - Both mode, the participant's final item appears during its `disconnect()` → in the file.
     Pre-fix contrast: the PR's arm-in-speaker-leg + effect sequence loses it.
   - Others mode, no speaker client → saves.
   - `wasActive` false (Cancel during Start, connect failure) → no save.
   - Stop, then a close request while teardown is in flight → the close waits on
     `disconnectDoneRef` and the file is written first.
5. **ExportButton.** Row role `menuitemcheckbox`, `aria-checked` follows the store; click
   writes the store and keeps the menu open; empty conversation → button enabled, actions
   disabled, no "Nothing selected"; keyboard ring includes the row; child-window host renders
   it.
6. **Toast.** The action renders, fires, and the toast still auto-dismisses.
7. **Electron.** `transcript-save.js` with a temp dir: generated name, collision suffix,
   non-string rejected. `close-handshake.js` with fakes, in the style of
   `popover-windows.test.js`: idle → waiting → approved, repeat close ignored, timeout, quit
   re-issued after approval, cleanup deferred until approval, pass-through with no live page.
   The preload receive allowlist gets an assertion in the existing preload tests.
8. **Settings store.** The PR's three tests stay.
9. **Locales.** `t(key, default)` returns the default in the suites, so copy assertions prove
   nothing. Review diffs keys: every new key present in all 30 locales, both removed keys gone
   from all 30.

Checks only a real environment can make:

| Where | Check |
|---|---|
| Desktop, GB10 (Linux) | Stop → file in `~/Downloads`; "Show in folder" opens it |
| same | Close the window mid-session → file written, then the window closes |
| same | Toolbar visible before a session; Clear disabled while empty |
| Mac mini M4 | Cmd+Q mid-session → handshake, then cleanup, then the app quits |
| Chrome extension | Stop → download bubble; a server-close stop (no user gesture) → does the download limiter intervene |
| Headless Chromium, all locales | Menu row and child-window height do not overflow |
| Live Both session | The other party mid-sentence at Stop → their last line is in the file |

## 9. Out of scope and known gaps

- Extension side panel close, OS shutdown, `SIGTERM`, crashes: no save.
- The 5 s handshake timeout can lose the file of a hung teardown.
- Chrome's automatic-download limiter may block or prompt for a download with no user gesture;
  the page cannot detect it.
- No `.json` auto-save, no folder picker, no per-session subfolder.

## 10. Relation to PR #537 (`9da935f7`)

| Part | Fate |
|---|---|
| `settingsStore` field, setter, load, hooks, three tests | Kept |
| `MainPanel` imports, `pendingAutoSaveRef`, auto-save effect | Replaced (§4.1) |
| `LanguageSection` toggle | Removed (toggle moves to the Export menu) |
| `simpleConfig.autoSaveOnStop*` in 30 locales | Removed; new keys per §5.4 |
| `deriveAutoSaveTitle` and its tests | Removed (§2.8) |

Work lands as commits on top of the contributor's branch; main is merged in, never rebased,
and nothing is force-pushed.
