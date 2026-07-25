# Subtitle mode before a session starts, with in-window Start/Stop (Design)

**Date**: 2026-07-25
**Issue**: [#324](https://github.com/kizuna-ai-lab/sokuji/issues/324)
**Branch**: `feat/subtitle-pre-session-start` (proposed)
**Status**: Design / proposal — approved, no implementation yet

## Summary

Today the subtitle entry button is disabled until a session is running
(`SubtitleEnterButton.tsx:60`, tooltip "Start a session first"). Users cannot
position the subtitle window, size it, or preview font/colors before the
meeting begins.

That gate exists for a concrete reason. In Electron the subtitle "window" is
**the main window reshaped** — `subtitle:enter` shrinks the BrowserWindow to
80% × 200px and pins it on top (`electron/subtitle-window.js:58`), while
`MainLayout.tsx:204` hides the entire main tree with `display:none` (MainPanel
stays mounted so a live session survives). With no session, entering subtitle
mode would leave the user in a bar with no way to start anything.

This design removes the gate on the Electron surface and gives the subtitle
window its own session controls: a persistent Start/Stop pill in the toolbar,
plus a large primary action in the idle body. Blocked and failed states are
rendered in-window with the reason and a one-click route back to the exact
setting that needs fixing.

## Goals

- Enter subtitle mode at any time on the Electron surface, including with no
  session and with an incomplete configuration.
- Start and stop the session from inside the subtitle window.
- When the session cannot start, say why in-window and offer a single click
  that lands the user on the responsible settings section.
- Reuse the two cross-tree communication patterns the repo already has
  (`lockedMode`-style state mirroring, `requestClearConversation`-style version
  counters). No new architecture.

## Non-goals

- **The extension overlay stays session-gated.** Its situation is different:
  the side panel is always visible and can start the session at any time, so
  the in-window Start buys little while costing new `subtitleWire` messages,
  a mirrored start-gate over the port, and cross-world error propagation.
  `SubtitleEnterButton` keeps `!isSessionActive` when `isExtension()`.
- **No extraction of session control out of MainPanel.** `connectConversation`
  is several hundred lines holding a dozen refs (audio service, speaker and
  participant clients, recorders). Turning it into a shared hook is a large,
  high-risk refactor unrelated to this issue. MainPanel remains the only caller.
- **No new toast plumbing.** See Known limitations.
- No change to subtitle bar auto-hide behavior.

## Background — what already exists

Three findings shape the design; all three mean less new code, not more.

**1. The "no session" render branch already exists.** `SubtitleApp.tsx:307` is
already `isSessionActive ? <SubtitleStream> : <SubtitleSessionEnded>`. This
work generalizes the second branch rather than introducing one.

**2. Cross-tree wiring patterns already exist.** `lockedMode` is mirrored from
MainPanel into `sessionStore` so a sibling tree can read it
(`sessionStore.ts:57`); `requestClearConversation` is a monotonic version
counter that MainPanel watches to run local logic on behalf of a remote caller
(`sessionStore.ts:69`, consumed at `MainPanel.tsx:899`). Start/Stop needs
exactly one of each.

**3. Start failures are already carried in `items`.** On session-init failure
MainPanel appends a `type: 'error'` system item **after**
`await disconnectConversation()` (`MainPanel.tsx:1849`, with a comment
explaining the ordering), and the `items` mirror effect (`MainPanel.tsx:874`)
pushes it into `sessionStore`. The failure text is therefore already readable
from the subtitle window — no `lastStartError` field is needed, and the
subtitle window necessarily shows the *same* error string as the main window.

The one thing that genuinely is not reachable: `canStartSession`
(`MainPanel.tsx:416`) is a local `useMemo` over six conditions, and its
human-readable reason lives in a five-level nested ternary inside the button's
`title` prop (`MainPanel.tsx:3255-3266`). Both `SubtitleEnterButton` (rendered
in `TitleBar`) and `SubtitleApp` are outside that subtree.

## Design

### Start-gate as a tested pure function

New `src/components/MainPanel/sessionStartGate.ts`:

```ts
export type StartBlockReason =
  | 'missing-device'
  | 'wallet-frozen'
  | 'insufficient-balance'
  | 'local-models-missing'
  | 'api-key-invalid'
  | 'no-models'
  | 'loading-models';

export interface StartGate {
  canStart: boolean;
  reason: StartBlockReason | null;
  balance?: number;   // only for 'insufficient-balance'
  deviceScope?: 'speaker' | 'participant' | 'both'; // only for 'missing-device'
}

export function computeStartGate(input: {
  isApiKeyValid: boolean;
  availableModelCount: number;
  loadingModels: boolean;
  isInitializing: boolean;
  provider: ProviderType;
  quota: { balance?: number; frozen?: boolean } | null;
  missingDeviceForMode: 'speaker' | 'participant' | 'both' | null;
}): StartGate;

export function reasonToSettingsTarget(reason: StartBlockReason): string | null;
```

Reason precedence is lifted verbatim from the advanced-mode tooltip chain
(`MainPanel.tsx:3408`), which is the more complete of the two existing chains.
The two surfaces can never disagree:

| reason | condition | settings target |
|---|---|---|
| `missing-device` | `missingDeviceForMode !== null` | `microphone` / `participant` |
| `local-models-missing` | `!isApiKeyValid` and `provider === LOCAL_INFERENCE` | `model-management` |
| `api-key-invalid` | `!isApiKeyValid` otherwise | `provider` |
| `no-models` | model list empty and not loading | `provider` |
| `loading-models` | `loadingModels` | none (transient) |
| `wallet-frozen` | Kizuna-managed provider and `quota.frozen` | `user-account` |
| `insufficient-balance` | Kizuna-managed provider and `balance <= 0` | `user-account` |

`MainPanel`'s own Start button switches its `title` to this function, replacing
the nested ternary.

The targets are the keys `NAVIGATION_TAB_MAP` already accepts
(`Settings.tsx:25`); `navigateToSettings(target)` writes
`settingsStore.settingsNavigationTarget`, which makes `MainLayout` open the
settings panel and scroll/highlight the section (`MainLayout.tsx:126`,
precedent at `ModeDevicePopover.tsx:297`).

### Data flow

```
                    computeStartGate()  (pure, unit-tested)
                       ╱               ╲
      MainPanel Start tooltip      useSubtitleSessionBridge()
                                      mirrors into sessionStore
                                            │
      ┌─────────────────────────────────────┼──────────────────────────┐
 TitleBar subtitle button          SubtitleBar pill          SubtitleApp idle body
 (Electron: never disabled)     Start / Stop / spinner    primary action + reason
                                            │
                              requestSessionStart / Stop()
                                   (version counters)
                                            ▼
                      useSubtitleSessionBridge() in MainPanel →
                      connectConversation() / disconnectConversation()
```

`useSubtitleSessionBridge(...)` is a small hook in `src/components/MainPanel/`
holding the two effects (mirror out, watch version in). It exists so the wiring
is testable — MainPanel itself is 3000+ lines and does not render in a unit
test. It follows `lastClearVersionRef`'s convention of recording the initial
version so mount does not fire a spurious start.

Mirrored payload is primitives only (`canStart`, `reason`, `balance`,
`deviceScope`, `isInitializing`, `initProgress`) — object identities in the
dependency array are the known infinite-loop trap this repo documents in
CLAUDE.md ("use `deviceId` in React dependencies, not device objects").

### The five window states

The toolbar pill is always present on the Electron surface and always occupies
the same slot, so Start and Stop never move. The body carries the large primary
action. Both are gated by the same mirrored state.

| state | toolbar pill | body |
|---|---|---|
| idle, ready | `▶ Start` (green) | `▶ Start translating` + "position and size the window first" |
| idle, blocked | disabled | **`⚠ Select a microphone →`** — the primary action itself becomes the fix action, full-size and clickable; sub-line "you can start once it's configured" |
| starting | spinner | spinner + `Loading (3/5)…` (reuses existing `initProgress` / `nativeAsrLoading` copy) |
| live | `■ Stop` (red) | subtitle stream (unchanged) |
| start failed | `▶ Start` (enabled — retry is meaningful) | `⚠ Failed to start: <error>` on **one truncated line**, `↻ Retry` (green, enabled, identical to Start), `Return to main window for details` |

Two decisions worth recording:

- **Blocked state gives the fix action the biggest target, not a dead button.**
  In a 200px-tall bar, a greyed-out Start plus an 11px clickable reason line
  puts the only meaningful action in the smallest element on screen. Clicking
  the primary action runs `exitSubtitleMode()` then
  `navigateToSettings(target)`.
- **Error text is a single truncated line.** The window is user-resizable to
  arbitrary heights, so the idle body keeps a fixed three-row structure. Full
  error text is one click away in the main window's conversation — literally
  the same `items` entry.

After a session ends normally the window returns to the idle state with the
headline "This session has ended" and an enabled Start, so the user can run
another session without leaving subtitle mode. "Ended" versus "never started"
is tracked with a local ref in `SubtitleApp` that flips when `isSessionActive`
goes true; `translationCount` is not usable for this (it survives `endSession`,
and a session can legitimately end with zero translations).

Auto-hide is unchanged. The body action is unaffected by `--bar-opacity`, and
the toolbar pill fades with its siblings, which is the consistent behavior.

### Files

| file | change |
|---|---|
| `src/components/MainPanel/sessionStartGate.ts` | new — reason enum, `computeStartGate`, `reasonToSettingsTarget` |
| `src/components/MainPanel/useSubtitleSessionBridge.ts` | new — mirror effect + version-watch effect |
| `src/stores/sessionStore.ts` | `startGate` mirror fields, `isInitializing`, `initProgress`, `startSessionVersion` / `stopSessionVersion`, `requestSessionStart()` / `requestSessionStop()` |
| `src/components/MainPanel/MainPanel.tsx` | call the bridge hook; Start tooltip reads `computeStartGate` |
| `src/components/Subtitle/SubtitleEnterButton.tsx` | Electron: no longer disabled; extension: unchanged |
| `src/components/Subtitle/SubtitleSessionEnded.tsx` → `SubtitleIdle.tsx` | five-state idle body |
| `src/components/Subtitle/SubtitleBar.tsx` | persistent Start/Stop pill, `surface === 'electron'` only |
| `src/components/Subtitle/SubtitleApp.scss` | idle body styles |
| `src/locales/*/translation.json` | ~10 new keys under `subtitle.*` |

## Error handling

- **Cannot start** → blocked state; reason and route come from the shared pure
  function, so the subtitle window and the main window always agree.
- **Start throws** → MainPanel's existing catch already disconnects and appends
  the error item; the idle body reads the trailing `type: 'error'` item and
  offers Retry (another `requestSessionStart()`, no need to leave subtitle
  mode).
- **Session cut off externally** (balance exhausted, reconnect failure) →
  `isSessionActive` flips false and the window falls back to the idle state
  with Start enabled. No new code.
- **Double-click / re-entrancy** → the version counter is idempotent per bump,
  and MainPanel's existing `isConnectingRef` guard (`MainPanel.tsx:1276`, which
  deliberately does not test `isSessionActive`) remains the authority. Both
  controls are disabled while `isInitializing`.

## Testing

| test | covers |
|---|---|
| `sessionStartGate.test.ts` | each reason fires; precedence order matches the main-window tooltip |
| `useSubtitleSessionBridge.test.tsx` | version bump calls the injected `onStart`/`onStop`; mount does not fire; mirror writes primitives |
| `SubtitleIdle.test.tsx` (rewritten from `SubtitleSessionEnded.test.tsx`) | five states render; blocked state dispatches exit + navigate; retry dispatches start |
| `SubtitleEnterButton.test.tsx` | enabled with no session under Electron; **still disabled under extension** |
| `SubtitleBar.test.tsx` (extend) | pill renders only for `surface === 'electron'`; reflects start/stop/spinner |

## Internationalization

~10 new keys under `subtitle.idle.*`, `subtitle.blocked.*`, `subtitle.bar.start`
/ `subtitle.bar.stop`. 30 locale directories carry the `subtitle` section;
English lands with this change and the rest fall back to English until a
translation pass, per existing repo practice.

## Known limitations

- `.toast-stack` is `position: fixed; bottom: 24px` portaled to `document.body`
  (`ToastContext.tsx:53`), so in subtitle mode a toast overlays the bottom of
  the subtitle body. Not addressed here: the start-failure path does not raise
  toasts (it appends an error item), and the only subtitle-related toast today
  is the extension's "refresh the meeting tab" hint, which is out of scope.
- Entering subtitle mode with an unconfigured app is now possible, so a
  first-run user can reach a bar whose only useful action is "go fix settings".
  This is accepted: it is strictly better than the current behavior of a
  disabled button with no explanation, and the fix action is one click.
