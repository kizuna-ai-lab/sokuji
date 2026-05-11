# Subtitle Mode — Manual Test Plan

Run on each target platform: macOS, Windows, Linux X11, Linux Wayland.

Companion to `2026-05-10-subtitle-mode-design.md`.

## A. Entering subtitle mode

- [ ] 1. Subtitle button (Captions icon) is disabled before a session starts.
- [ ] 2. After session start, button is clickable.
- [ ] 3. Click → window transforms in place to a frameless translucent bar at the bottom-center of the screen on first use (~80% width × 200 px high).
- [ ] 4. Custom title bar disappears in subtitle mode; subtitle bar appears.
- [ ] 5. Background is translucent; desktop is visible behind it.
- [ ] 6. Live conversation rows scroll into the subtitle area.

## B. Floating bar interaction

- [ ] 7. Drag the bar — window moves.
- [ ] 8. Drag a window edge — window resizes (no visual handle, but cursor + drag work).
- [ ] 9. Cursor leaves window for 1.5 s → bar fades out (opacity 0). Subtitle area stays.
- [ ] 10. Cursor re-enters → bar fades back in.

## C. Lock + always-on-top

- [ ] 11. Click 🔒 (lock). Cursor on bar shows it's no longer draggable; window edges no longer resize.
- [ ] 12. Click 🔒 again — both restored.
- [ ] 13. With 📌 (pin) active, click on another app's window. Subtitle stays in front.
- [ ] 14. Toggle 📌 off. Click another app — subtitle goes behind. (Linux Wayland may behave differently per compositor.)

## D. Settings popover

- [ ] 15. Click ⚙ — popover opens; click outside or press Escape — popover closes.
- [ ] 16. Drag opacity slider — background opacity changes live.
- [ ] 17. Click each background color preset — applies live.
- [ ] 18. Source text color preset — speaker source-text rows update.
- [ ] 19. Translation color preset — translation rows update.

## E. Toolbar buttons

- [ ] 20. Speaker DisplayMode cycles `Both → Src → Trans → Both`; subtitle stream filters accordingly.
- [ ] 21. Participant DisplayMode appears only when system audio is connected; same cycle.
- [ ] 22. Font − / Font + change subtitle font size; main panel font does NOT change.
- [ ] 23. Compact toggle changes subtitle row layout; main panel layout unchanged.
- [ ] 24. Export downloads a transcript file.
- [ ] 25. Clear empties the subtitle stream. Exit subtitle mode and confirm the main panel conversation is also empty (same action goes through `sessionStore.requestClearConversation` so both surfaces stay in sync).

## F. Exit and error paths

- [ ] 26. Click ✕ → window restores to prior size and position; main UI returns.
- [ ] 27. Press ESC → same as ✕.
- [ ] 28. While in subtitle mode, manually stop the session (kill network or wait for provider error) → "Session ended" placeholder appears with "Return to main window" button.
- [ ] 29. Click "Return to main window" → exits subtitle mode.
- [ ] 30. Quit the app, relaunch, start a session, enter subtitle mode → bounds + opacity match the last session.
- [ ] 31. Enter subtitle mode on an external monitor, save bounds, disconnect the monitor, relaunch → bounds clamp to the primary display.

## G. Custom TitleBar (normal mode)

- [ ] 32. macOS traffic-light buttons render and work (close / minimize / zoom).
- [ ] 33. Win/Linux: min, max, close buttons work; clicking close exits the app.
- [ ] 34. Drag region works for moving the window in normal mode.

## Known platform caveats

- Linux Wayland: alwaysOnTop behavior depends on the compositor (KWin / Mutter / Sway). If the subtitle bar doesn't stay in front of other apps when 📌 is active, that's a Wayland-level limitation — not a sokuji bug.
- Linux X11: transparency may not work on legacy desktop environments without compositing enabled.
- macOS Stage Manager / Mission Control may treat the always-on-top window inconsistently across spaces.

## Verifying the architectural invariant

These checks confirm the items mirror chain (T16.5) is intact:

- [ ] 35. Start a session, send a few translations, enter subtitle mode → subtitle area shows the same conversation rows that were in the main panel.
- [ ] 36. While in subtitle mode, send more translations → subtitle area updates live.
- [ ] 37. Exit subtitle mode → main panel shows all the rows that accumulated during subtitle mode.
