# Push-to-translate Speech Mode Design

**Issue**: [#214 — Research: Push-to-translate speech mode for selective bilingual conversation](https://github.com/kizuna-ai-lab/sokuji/issues/214)
**Parent**: [#213 — Add another mode of speaking](https://github.com/kizuna-ai-lab/sokuji/issues/213)
**Date**: 2026-04-28
**Status**: Approved

## Problem

Bilingual users in meetings currently must switch input devices in the meeting app to toggle between speaking the target language directly and using Sokuji's translation. This is disruptive. They want a mode where their raw voice flows to the meeting by default, and translation only kicks in when they explicitly request it.

## Decision

Add a 4th option **Push-to-translate** to the existing per-provider Speech Mode setting. Inverts the idle behavior of Push-to-talk: raw mic flows to the virtual mic by default; holding the trigger key routes the mic to the AI provider instead and triggers a translation on release.

The existing passthrough infrastructure (`audioService.setupPassthrough(enabled, volume)` → virtual speaker on Electron + `sendPcmDataToTabs(data, 'passthrough')` on the extension) already routes raw mic to the virtual sink. The core change is mode-aware control of when that passthrough is on.

## Behavior

### State machine

| State | Trigger | passthrough | mic → AI | virtual mic receives |
|---|---|---|---|---|
| IDLE | (default) | on @ 100% | no | raw user voice |
| HOLDING | space `keydown` | off | yes (PTT recording) | (silence) |
| RESPONDING | space `keyup` → `createResponse()` | on @ 100% | no | raw user voice **+** AI translation playback (mixed) |

`RESPONDING` is not a tracked state. Passthrough resumes immediately on key release; AI translation playback streams into the virtual mic concurrently with raw passthrough.

### Trade-off accepted

In noisy environments, ambient noise (breathing, chair movement, background sound) mixes with the AI translation in the meeting during the brief AI playback window. This is intentional to avoid the complexity of tracking playback completion and to align with existing PTT plumbing that never gated on playback drain. Documented as known behavior; users are expected not to talk during AI playback.

### Eager AI session

Same as current PTT — provider connection is established when entering the mode, not on first key press. No new *connection* lifecycle work is required, but Push-to-Translate does need new *recorder* lifecycle work: the recorder must run continuously (started at session start, not on key hold) with chunk-level gating on `data.isPassthrough` — see "Recorder lifecycle — three patterns" below.

## UI changes

### Section header rename

All four provider-specific section headers rename to **"Speech Mode"**:

| Provider | Current i18n key | New header source |
|---|---|---|
| OpenAI / Compat / Kizuna | `settings.automaticTurnDetection` | `settings.speechMode` |
| Gemini | `settings.geminiVad` | `settings.speechMode` |
| Volcengine AST2 | `settings.volcengineAST2TurnDetection` | `settings.speechMode` |
| Local Inference | `settings.localInferenceTurnDetection` | `settings.speechMode` |

Section-level tooltips (the `?` icon next to each header) are **updated** to describe Push-to-translate alongside existing modes. Per-button tooltips are not introduced — keeping the current "one tooltip explains all buttons" pattern for consistency. Existing tooltip text is preserved verbatim with one extra sentence appended:

| Provider | Tooltip key | Existing text | Appended sentence |
|---|---|---|---|
| OpenAI / Compat / Kizuna | `settings.turnDetectionTooltip` | "How AI knows when you've finished speaking. Normal: Waits for silence. Semantic: AI understands context. Disabled: Manual control." | " Push-to-translate: Manual control with raw mic passthrough to the virtual mic when idle." |
| Volcengine AST2 | `settings.volcengineAST2TurnDetectionTooltip` | "Auto mode uses server-side voice activity detection. Push-to-Talk lets you manually control when to send audio by holding Space or the mic button." | " Push-to-translate works like Push-to-Talk, but routes your raw mic to the virtual mic when idle so you can speak directly without translation." |
| Local Inference | `settings.localInferenceTurnDetectionTooltip` | "Auto mode uses Voice Activity Detection to automatically detect speech. Push-to-Talk lets you manually control when to send audio by holding Space or the mic button." | " Push-to-translate works like Push-to-Talk, but routes your raw mic to the virtual mic when idle so you can speak directly without translation." |
| Gemini | `settings.geminiVadTooltip` | "Controls how Gemini detects speech pauses to split turns. Adjusting these settings can improve translation responsiveness for continuous speech." | " Push-to-Talk: hold a key to send audio. Push-to-translate: like Push-to-Talk, but routes your raw mic to the virtual mic when idle so you can speak directly without translation." |

Section-level tooltip keys are kept (not renamed alongside `settings.speechMode`) to avoid churning four locale files just for a header rename — a future pass can consolidate. The header label key is `settings.speechMode`, the tooltip keys remain as above. Old header label keys (`settings.automaticTurnDetection`, `settings.geminiVad`, `settings.volcengineAST2TurnDetection`, `settings.localInferenceTurnDetection`) become unused — removable in a future cleanup pass.

### New option button

In `ProviderSpecificSettings.tsx`, add a "Push to Translate" option button next to the existing PTT button in each PTT-supporting provider's Speech Mode section. Disabled while `isSessionActive`, matching existing options.

### Hide on unsupported providers

PalabraAI and Volcengine ST do not render the Push-to-translate button (consistent with how those providers do not render the existing Push-to-talk option either).

### Mutual exclusion with VoicePassthroughSection

When the active provider's `turnDetectionMode === 'Push-to-Translate'`:

- `VoicePassthroughSection` (the standalone toggle + 0–60% volume slider) renders **disabled** with a tooltip: "Managed by Push-to-translate while this mode is active. Your previous setting is preserved."
- The user's stored `isRealVoicePassthroughEnabled` and `realVoicePassthroughVolume` are **not modified** — only the live `setupPassthrough()` call is overridden by the unified useEffect (see code wiring below).
- Switching back to any other Speech Mode restores the prior behavior automatically (since the unified useEffect reads stored values when not in Push-to-translate mode).

### Feedback warning compatibility

Existing `feedbackWarningDismissed` logic at `MainPanel.tsx:471` keys off "passthrough enabled + monitor device on". When in Push-to-translate mode with a non-headphone monitor active, the warning still surfaces correctly because it reads the *effective* passthrough state. No new logic.

### UI mode interaction

Speech Mode appears only in `ProviderSpecificSettings` (advanced UI mode). Push-to-translate inherits that placement — no basic-mode surface in this scope.

## Code wiring

### `turnDetectionMode` per provider

Add `'Push-to-Translate'` to the union type for each PTT-supporting provider. OpenAI's existing `'Disabled'` value continues to mean "PTT" (no migration of persisted settings):

| Provider | Existing values | After |
|---|---|---|
| OpenAI / Compat / Kizuna | `'Normal' \| 'Semantic' \| 'Disabled'` | `... \| 'Push-to-Translate'` |
| Gemini | `'Auto' \| 'Push-to-Talk'` | `... \| 'Push-to-Translate'` |
| Volcengine AST2 | `'Auto' \| 'Push-to-Talk'` | `... \| 'Push-to-Translate'` |
| Local Inference | `'Auto' \| 'Push-to-Talk'` | `... \| 'Push-to-Translate'` |
| PalabraAI / Volcengine ST | `'Auto'` | unchanged |

### Unified passthrough useEffect

Replaces the existing useEffect at `MainPanel.tsx:441`:

```ts
useEffect(() => {
  const audioService = audioServiceRef.current;
  if (!audioService) return;

  const isPushToTranslate = currentTurnDetectionMode === 'Push-to-Translate';

  const enabled = isPushToTranslate
    ? !isRecording                    // mute only while user is holding the key
    : isRealVoicePassthroughEnabled;  // legacy: user-controlled toggle

  const volume = isPushToTranslate
    ? 1.0                             // self-contained, ignore 0-60% cap
    : realVoicePassthroughVolume;

  audioService.setupPassthrough(enabled, volume);
}, [
  currentTurnDetectionMode,
  isRecording,
  isRealVoicePassthroughEnabled,
  realVoicePassthroughVolume,
  selectedInputDevice?.deviceId,
  selectedMonitorDevice?.deviceId,
  isMonitorDeviceOn,
]);
```

`currentTurnDetectionMode` is derived from the active provider's settings using the same per-provider lookup pattern as `MainPanel.tsx:1098–1112`. Adding `isRecording` to the dependency array means the toggle fires once on `keydown` (mute) and once on `keyup` (unmute), synchronous with the recording state managed by `startRecording` / `stopRecording`.

### Recorder lifecycle — three patterns

After this change, the audio recorder lifecycle splits into three patterns based on Speech Mode:

| Pattern | Modes | Recorder lifetime | Callback AI forwarding |
|---|---|---|---|
| **Continuous + always-forward** | `Auto`, `Normal`, `Semantic` | starts at session start, runs until session end | unconditional |
| **Paused between holds** (current PTT) | `Push-to-Talk`, `Disabled` | starts on `keydown`, paused on `keyup` | unconditional (only fires while recorder is active) |
| **Continuous + gated-forward** (new) | `Push-to-Translate` | starts at session start, runs until session end | skip when `data.isPassthrough === true` |

The third pattern is required because Push-to-translate needs raw mic audio flowing to the virtual sink during IDLE (which means recorder running) but **must not** send that idle audio to the AI provider (which means callback-level gating).

Implementation:

1. **Session start in Push-to-translate mode**: call `audioService.startRecording(deviceId, callback)` immediately (do not wait for space `keydown`). Update the session-start branch at `MainPanel.tsx:1253` so Push-to-translate is treated like a VAD mode for lifecycle purposes (recorder starts), but with a different callback (gated forwarding).

2. **Gated recording callback**: capture mode at session start; gate AI forwarding on `isPassthrough`:

   ```ts
   const isPushToTranslateMode = currentTurnDetectionMode === 'Push-to-Translate';
   await audioServiceRef.current.startRecording(deviceId, (data) => {
     if (!clientRef.current) return;
     if (isPushToTranslateMode && data.isPassthrough) {
       return;  // IDLE: route to passthrough only, don't send to AI
     }
     clientRef.current.appendInputAudio(data.mono);
   });
   ```

   Mode is captured by closure at session start. Mode cannot change mid-session (option buttons are disabled while `isSessionActive`), so the closure value stays correct.

3. **Space `keydown` / `keyup`**: do **not** call `audioService.startRecording` / `pauseRecording` (the recorder is already running). Instead, just flip `isRecording` state — the unified passthrough useEffect reacts and calls `setupPassthrough(false, …)` on hold and `setupPassthrough(true, 1.0)` on release. The recorder's per-chunk `isPassthrough` flag flips correspondingly, and the callback gate in step 2 lets HOLDING audio through to AI while skipping IDLE audio.

4. **Space `keyup` → `createResponse()`**: still call `client.createResponse()` (and the silence-frames pre-roll for AST2 / Local Inference, mirroring `MainPanel.tsx:1530–1540`) so providers detect end-of-speech.

5. **Empty-turn detection**: the current `pttVoiceChunkCountRef` mechanism (counting non-silent chunks during hold) still applies. In Push-to-translate, count only chunks where `!data.isPassthrough`.

The first two patterns (always-forward and paused-between-holds) are unchanged, so existing PTT + legacy `isRealVoicePassthroughEnabled` interactions (audio mixing self-monitoring during translation) continue to work as today.

### `canHoldToSpeak` derivation

Rename `canPushToTalk` → `canHoldToSpeak`. Set inside the `startSession` callback after provider settings are read (current logic at `MainPanel.tsx:1098–1113`):

```ts
const isPttLike = (mode: string) =>
  mode === 'Push-to-Talk' || mode === 'Push-to-Translate' || mode === 'Disabled';

setCanHoldToSpeak(isPttLike(currentMode));
```

The keyboard handler at `MainPanel.tsx:2243` gates on `canHoldToSpeak` instead of `canPushToTalk`. Function rename only — body unchanged. For Push-to-translate, `startRecording`/`stopRecording` (the local PTT-state functions in MainPanel, not `audioService.startRecording`) only update `isRecording` state and trigger `createResponse()` on stop — they do **not** touch the recorder lifecycle (already handled per the table above).

### Files touched

- `src/components/MainPanel/MainPanel.tsx` — unified passthrough useEffect, `canHoldToSpeak` rename, `currentTurnDetectionMode` derivation
- `src/components/Settings/sections/ProviderSpecificSettings.tsx` — new option button × 4 provider sections, section header rename × 4, pass `disabled`/`disabledReason` props through to `VoicePassthroughSection`
- `src/components/Settings/sections/VoicePassthroughSection.tsx` — accept `disabled` and `disabledReason` props; render greyed-out state with tooltip
- `src/services/providers/{OpenAI,OpenAICompatible,KizunaAI,Gemini,VolcengineAST2,LocalInference}ProviderConfig.ts` — extend `turnDetectionMode` union type
- `src/stores/settingsStore.ts` — extend `turnDetectionMode` union types. (Existing WebRTC auto-correction guards at lines 837/869/901 stay as-is — they correctly demote `'Push-to-Translate'` → `'Disabled'` if the user switches transport to WebRTC, which is the intended behavior since WebRTC + Push-to-translate is not supported.)
- `src/stores/settingsStore.test.ts` — coverage for new value persistence and for the WebRTC auto-correction demoting `'Push-to-Translate'` to `'Disabled'`
- `src/locales/{en,...}/translation.json` — new keys `settings.speechMode`, `settings.pushToTranslate`, `audioPanel.passthroughManagedByPushToTranslate`, plus tooltip text additions to the four existing keys: `settings.turnDetectionTooltip`, `settings.volcengineAST2TurnDetectionTooltip`, `settings.localInferenceTurnDetectionTooltip`, `settings.geminiVadTooltip` (per the table in "Section header rename" above). English updated immediately; other 35+ locales keep their existing tooltip text until translated (graceful — they just won't mention Push-to-translate yet).

### Analytics

- Existing `push_to_talk_used` event gains a `mode` field: `'push-to-talk' | 'push-to-translate'`.
- New event `speech_mode_changed` with `mode` value, fired when user changes Speech Mode in settings.

## Edge cases

| Case | Behavior |
|---|---|
| Input device toggled off (`isInputDeviceOn === false`) while in Push-to-translate | `setupPassthrough(false, 1.0)` — no mic, no passthrough. Space key no-ops via existing `startRecording` early return. |
| Virtual mic device unavailable | Same as today's PTT — passthrough call is harmless (nothing routes); meeting app sees no audio. Surfaced via existing `LogsPanel` warnings. No new error path. |
| User switches Speech Mode mid-session | Already disabled at the UI level (`isSessionActive` check on the option buttons). Mode change requires session restart, same as today. |
| Provider switched away from a PTT-supporting one while user had Push-to-translate selected on the prior provider | No effect — each provider stores its own `turnDetectionMode` independently, so switching providers reads the new provider's stored value. The Push-to-translate selection persists on the original provider for next time. |
| OpenAI / Compat / Kizuna: WebRTC mode + Push-to-translate | **Not supported.** WebRTC uses native `MediaStreamTrack` capture (line 1244 `usesNativeCapture`), so the recorder runs only during space holds (today's PTT pattern). The gated-callback pattern that Push-to-translate depends on requires the recorder to run continuously and route raw mic to the virtual sink during IDLE — incompatible with WebRTC's native capture path. Surface the incompatibility in the UI: render the Push-to-translate button **disabled** when `transportType === 'webrtc'` (mirroring how Normal/Semantic VAD buttons disable in WebRTC at `ProviderSpecificSettings.tsx:368–377`), with a tooltip "Not available in WebRTC mode. Switch to WebSocket to use Push-to-translate." The existing transport-switch auto-correction at `settingsStore.ts:837/869/901` correctly handles the persisted-state case (force-demote to `'Disabled'` when transport flips to WebRTC); no changes there. |
| Window blur during HOLDING | Existing `handleBlur` at `MainPanel.tsx:2277` calls `stopRecording`, flips `isRecording=false`, useEffect re-enables passthrough. No new code. |
| User presses space during AI playback | Recording starts (mic → AI), passthrough mutes. Existing PTT response-overlap behavior applies (provider-dependent — not changed by this design). |
| Existing `realVoicePassthroughVolume` slider cap (60%) | Unchanged for non-Push-to-translate modes. Bypassed in Push-to-translate (1.0 hardcoded). |
| Feedback warning trigger | `MainPanel.tsx:471` already gates on the *effective* passthrough enable + monitor-on combo. Will fire correctly in Push-to-translate when monitor is non-headphone. |

## Out of scope

- "Mute AI playback period" / `RESPONDING` state with playback-drain event detection. Decided against to keep state machine to a single boolean.
- Migrating OpenAI's `'Disabled'` enum to `'Push-to-Talk'`. Keeps backward compat with persisted user settings.
- Basic UI mode (`uiMode === 'basic'`) surface for Speech Mode. Feature lives in advanced settings only.
- Per-provider passthrough volume slider. Push-to-translate is hardcoded at 100%.
- Interrupt-on-second-press semantics (cancelling AI response when user presses space again during playback). Inherits whatever each provider does today.
- Adding PTT support to PalabraAI / Volcengine ST.
- Push-to-translate under OpenAI WebRTC transport. WebRTC's native `MediaStreamTrack` capture is incompatible with the gated-callback pattern. Users on WebRTC must switch to WebSocket to use Push-to-translate.

## Test plan

### Unit

- `settingsStore.test.ts` — round-trip persistence of `'Push-to-Translate'` value for each PTT-supporting provider; verify per-provider isolation (selecting Push-to-translate on one provider does not affect another's stored mode).

### Manual smoke (per supported provider, Electron + extension)

1. Switch to Push-to-translate, start session, verify raw mic audio reaches the virtual sink at full volume (idle).
2. Hold space — verify raw passthrough cuts within ~50ms; verify mic audio reaches AI; release; verify AI translation plays into the virtual sink.
3. Verify `VoicePassthroughSection` renders disabled with tooltip while mode active; verify saved values are restored when switching to a non-Push-to-translate mode.
4. Verify section header reads "Speech Mode" across all 6 PTT-supporting + 2 unsupported provider configs.
5. Verify Push-to-translate option absent on PalabraAI and Volcengine ST.
6. Window blur during hold → passthrough resumes correctly.
7. Provider switch away from a PTT-supporting provider that has `Push-to-Translate` saved, then back → selection persists across the round-trip.
8. OpenAI / Compat / Kizuna: with Push-to-Translate selected on WebSocket, switch transport to WebRTC → button renders disabled with tooltip; stored `turnDetectionMode` demotes to `'Disabled'`. Switch back to WebSocket → button re-enables; user can re-select Push-to-Translate.

### Regression

- Existing PTT mode unchanged on each PTT-supporting provider.
- `isRealVoicePassthroughEnabled` standalone toggle still works in non-Push-to-translate modes.
- Feedback warning still surfaces correctly.
