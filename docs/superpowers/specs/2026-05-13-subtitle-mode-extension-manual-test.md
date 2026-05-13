# Subtitle Mode — Browser Extension — Manual Test Plan

**Date**: 2026-05-13
**Tracking issue**: #226
**Spec**: [2026-05-13-subtitle-mode-extension-design.md](./2026-05-13-subtitle-mode-extension-design.md)

## Prerequisites

- Chrome ≥ 116 (or Edge stable on Chromium ≥ 116).
- Test on macOS, Windows, Linux X11, and Linux Wayland.
- Sokuji extension built and loaded:
  1. From the worktree: `cd extension && npm install && npm run build`.
  2. Chrome → `chrome://extensions/` → enable Developer mode → "Load unpacked" → select `extension/dist/`.
- A working AI provider configured in Sokuji (any of: OpenAI, Gemini, Kizuna AI, Palabra AI).
- Access to a Google Meet test meeting (create one at meet.google.com/new).

## Smoke test (5 minutes)

| # | Step | Expected |
|---|---|---|
| 1 | Open `https://meet.google.com/`. Join or create a meeting. | Meeting UI loads. |
| 2 | Click the Sokuji extension icon → side panel opens. | Side panel renders the configuration UI. |
| 3 | Configure a provider and click "Start session". | Session is active; conversation toolbar appears. |
| 4 | Click the subtitle button (Captions icon) in the conversation toolbar. | A bilingual subtitle bar appears at the bottom-center of the Meet viewport. |
| 5 | Speak into your microphone or play test audio. | Translation rows scroll into the subtitle bar in real time. |
| 6 | Click the ✕ in the subtitle bar. | Subtitle disappears; side panel session is unaffected. |

If steps 1–6 pass, the integration is fundamentally working.

## Full scenario coverage

### Scenario A: Enter / Exit cycles

- A1. Enter subtitle mode while a session is active → bar appears at default centered-bottom position.
- A2. Exit via ✕ button → bar disappears, session stays active.
- A3. Exit via ESC key (with focus on the iframe) → bar disappears.
- A4. Re-enter after exit → bar at default position again (not the previously dragged position — extension does NOT persist overlay bounds).

### Scenario B: Settings persistence (CSS settings DO persist)

- B1. Open the ⚙ popover inside the bar.
- B2. Change font size (use +/- buttons).
- B3. Change background opacity slider, bg color, source text color, translation text color.
- B4. Toggle compact mode.
- B5. Exit subtitle mode, re-enter → all settings preserved.
- B6. Restart Chrome → all settings still preserved.

### Scenario C: Display modes are subtitle-local

- C1. In the bar, change Speaker display mode to "source only".
- C2. Open the side panel and check MainPanel's Speaker display mode — should still be "both" (unchanged).
- C3. In MainPanel, change Speaker display mode to "translation only".
- C4. Open the subtitle bar — its Speaker display mode should still be "source only" (independent).

### Scenario D: Drag and resize

- D1. With subtitle bar visible, drag the bar's logo/left area → bar moves within viewport.
- D2. Drag toward the edge → bar clamps and doesn't leave the viewport.
- D3. Drag a corner handle → bar resizes (8px hit area at each corner).
- D4. Toggle the 🔒 Lock button in the bar → drag and resize stop working.
- D5. Toggle 🔒 off → drag/resize work again.
- D6. Exit and re-enter → bar back at default position (no persistence).

### Scenario E: Tab switching

- E1. With subtitle bar visible on Meet tab, switch to a non-Meet tab → bar is hidden (it's in the inactive Meet tab).
- E2. (If Meet has auto-PiP enabled) Meet's native PiP appears.
- E3. Switch back to the Meet tab → subtitle bar visible again; Meet's PiP closes.

### Scenario F: Tab close mid-session

- F1. Enter subtitle mode, then close the Meet tab.
- F2. Side panel detects this and resets `subtitleModeActive` to false (the Subtitle button in MainPanel becomes available again — no orphaned state).

### Scenario G: Meet tab reload mid-session

- G1. Enter subtitle mode.
- G2. Reload the Meet tab (Cmd/Ctrl + R).
- G3. After reload completes, the subtitle bar should reappear automatically (the side panel re-sends `subtitle:enter` once the content script reloads).

### Scenario H: Session ends while subtitle visible

- H1. Enter subtitle mode.
- H2. From the side panel, click "Stop session".
- H3. The subtitle bar contents swap to a `<SubtitleSessionEnded>` view with a Return button.
- H4. Click Return → bar exits.

### Scenario I: Clear conversation from the bar

- I1. With items visible in the bar, click the Trash2 (Clear) button.
- I2. Both the subtitle bar and the side panel conversation are cleared.

### Scenario J: Cross-browser, cross-OS

Repeat the Smoke Test (steps 1–6) on:
- Chrome stable (macOS, Windows, Linux X11, Linux Wayland)
- Edge stable (macOS, Windows)

## Site coverage

For each of the 10 supported sites, run the Smoke Test (steps 1–6 with site-appropriate audio source):

| Site | Smoke result | Notes |
|---|---|---|
| Google Meet (meet.google.com) | | |
| Microsoft Teams (teams.live.com) | | |
| Microsoft Teams (teams.microsoft.com) | | |
| Microsoft Teams (teams.cloud.microsoft) | | |
| Zoom (app.zoom.us) | | |
| Gather (app.gather.town) | | |
| Gather v2 (app.v2.gather.town) | | |
| Whereby (whereby.com) | | |
| Discord (discord.com) | | |
| Slack (app.slack.com) | | |

## Known caveats

- Extension overlay position is NOT persisted across exit/re-enter — by design.
- The subtitle UI inside the iframe has its own (sub-component-local) `speakerDisplayMode` / `participantDisplayMode` independent from MainPanel.
- Lock state (🔒 toggle) IS persisted across sessions.

## Sign-off

- [ ] Smoke test passes on the primary dev platform.
- [ ] Full scenarios A–I pass.
- [ ] Site coverage table filled out.
- [ ] Sign-off date, version, tester name recorded.
