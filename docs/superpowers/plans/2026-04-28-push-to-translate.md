# Push-to-translate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th Speech Mode option **Push-to-translate** that routes raw mic audio to the virtual sink during idle, then switches to translation when the user holds Space.

**Architecture:** Reuse existing PTT infrastructure (`audioService.setupPassthrough`, space `keydown`/`keyup` handlers, `client.createResponse()`). Introduce a third recorder lifecycle pattern (continuous + gated callback) by reading `data.isPassthrough` per chunk. UI: rename four "Turn Detection" / "VAD" section headers to "Speech Mode" and add a "Push to Translate" button on each PTT-supporting provider. WebRTC mode + Push-to-translate is unsupported (button disabled with tooltip) because WebRTC's native MediaStreamTrack capture bypasses the recorder callback gate.

**Tech Stack:** TypeScript, React, Zustand (`subscribeWithSelector`), Vitest, i18next, Web Audio API, the project's `ModernBrowserAudioService` audio service.

**Spec:** `docs/superpowers/specs/2026-04-28-push-to-translate-design.md` (commit 507817ee).

---

## Task ordering rationale

1. **Phase A** (Tasks 1–3): Type extensions + locale strings — pure foundation, no behavior change. These let later tasks compile.
2. **Phase B** (Tasks 4–5): Persistence tests — verify the new value round-trips.
3. **Phase C** (Tasks 6–8): Audio routing — unified passthrough useEffect, feedback warning, and the `canPushToTalk → canHoldToSpeak` rename.
4. **Phase D** (Tasks 9–10): Recorder lifecycle changes — continuous recorder + gated callback for Push-to-translate; keyboard handler stays unchanged but no longer calls audio start/pause when in this mode.
5. **Phase E** (Tasks 11–14): UI changes per provider — section header rename + new button.
6. **Phase F** (Task 15–16): VoicePassthroughSection mutual exclusion.
7. **Phase G** (Task 17): Analytics.
8. **Phase H** (Task 18): Manual smoke test + cleanup.

After Phases A–D, the feature is functionally complete but has no UI. Phase E exposes it. Phases F–G are polish. Phase H validates.

---

## Phase A: Foundation — types and locale

### Task 1: Extend `turnDetectionMode` union types in `settingsStore.ts`

**Files:**
- Modify: `src/stores/settingsStore.ts:55` (OpenAICompatibleSettingsBase)
- Modify: `src/stores/settingsStore.ts:84` (GeminiSettings)
- Modify: `src/stores/settingsStore.ts:122` (VolcengineAST2Settings)
- Modify: `src/stores/settingsStore.ts:141` (LocalInferenceSettings)

- [ ] **Step 1: Add `'Push-to-Translate'` to four union types**

In `src/stores/settingsStore.ts`, change line 55 from:

```ts
turnDetectionMode: 'Normal' | 'Semantic' | 'Disabled';
```

to:

```ts
turnDetectionMode: 'Normal' | 'Semantic' | 'Disabled' | 'Push-to-Translate';
```

Then change lines 84, 122, and 141 from:

```ts
turnDetectionMode: 'Auto' | 'Push-to-Talk';
```

to:

```ts
turnDetectionMode: 'Auto' | 'Push-to-Talk' | 'Push-to-Translate';
```

(Three occurrences, identical change.)

Defaults at lines 228, 260, 295, 310 stay unchanged — none of them need to default to Push-to-Translate.

- [ ] **Step 2: TypeScript compile check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). The change is purely additive to union types.

- [ ] **Step 3: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(settings): add Push-to-Translate to turnDetectionMode unions"
```

---

### Task 2: Update `OpenAIProviderConfig` capabilities (informational only)

**Files:**
- Modify: `src/services/providers/OpenAIProviderConfig.ts:103` (turnDetection.modes — leave as-is)
- Verify: `src/services/providers/{Gemini,VolcengineAST2,LocalInference,PalabraAI,VolcengineST,KizunaAI,OpenAICompatible}ProviderConfig.ts`

No code change is required for provider configs.

- [ ] **Step 1: Verify `OpenAIProviderConfig.ts` `turnDetection.modes` stays as `['Normal', 'Semantic', 'Disabled']`**

The Push-to-Translate button for OpenAI/Compat/Kizuna will be rendered as a **separate explicit `<button>`** in `ProviderSpecificSettings.tsx` (Task 11), not added to this `modes` array. Adding it to the array would force the existing loop renderer to derive its label from `t(\`settings.\${mode.toLowerCase()}\`)` → `settings.push-to-translate`, which doesn't fit our camelCase key convention. Keeping the modes array unchanged is the cleanest path.

Run: `grep -n "turnDetection" src/services/providers/OpenAIProviderConfig.ts`
Expected output includes `modes: ['Normal', 'Semantic', 'Disabled']` (unchanged).

- [ ] **Step 2: Commit (no-op verification — skip if no changes made)**

If you made no edits, skip this commit. If you accidentally added Push-to-Translate to the modes array, revert and skip.

---

### Task 3: Add new English locale keys + update tooltip text

**Files:**
- Modify: `src/locales/en/translation.json`

- [ ] **Step 1: Add `settings.speechMode` key**

In `src/locales/en/translation.json`, after the `automaticTurnDetection` line (around line 111), add:

```json
"speechMode": "Speech Mode",
```

- [ ] **Step 2: Add `settings.pushToTranslate` key**

After the existing `pushToTalk` line at line 92, add:

```json
"pushToTranslate": "Push to Translate",
```

- [ ] **Step 3: Add `settings.pushToTranslateNotAvailableInWebrtc` key**

In the same `settings` block, add:

```json
"pushToTranslateNotAvailableInWebrtc": "Not available in WebRTC mode. Switch to WebSocket to use Push-to-translate.",
```

- [ ] **Step 4: Add `audioPanel.passthroughManagedByPushToTranslate` key**

Inside the `audioPanel` block (around line 332, near `realVoicePassthrough`), add:

```json
"passthroughManagedByPushToTranslate": "Managed by Push-to-translate while this mode is active. Your previous setting is preserved.",
```

- [ ] **Step 5: Append Push-to-translate sentence to `settings.turnDetectionTooltip`**

Find the existing key in the `settings` block:

```json
"turnDetectionTooltip": "How AI knows when you've finished speaking. \nNormal: Waits for silence. \nSemantic: AI understands context. \nDisabled: Manual control.",
```

Change to:

```json
"turnDetectionTooltip": "How AI knows when you've finished speaking. \nNormal: Waits for silence. \nSemantic: AI understands context. \nDisabled: Manual control. \nPush-to-translate: Manual control with raw mic passthrough to the virtual mic when idle.",
```

- [ ] **Step 6: Append Push-to-translate sentence to `settings.volcengineAST2TurnDetectionTooltip`**

Find:

```json
"volcengineAST2TurnDetectionTooltip": "Auto mode uses server-side voice activity detection. Push-to-Talk lets you manually control when to send audio by holding Space or the mic button.",
```

Change to:

```json
"volcengineAST2TurnDetectionTooltip": "Auto mode uses server-side voice activity detection. Push-to-Talk lets you manually control when to send audio by holding Space or the mic button. Push-to-translate works like Push-to-Talk, but routes your raw mic to the virtual mic when idle so you can speak directly without translation.",
```

- [ ] **Step 7: Append Push-to-translate sentence to `settings.localInferenceTurnDetectionTooltip`**

Find:

```json
"localInferenceTurnDetectionTooltip": "Auto mode uses Voice Activity Detection to automatically detect speech. Push-to-Talk lets you manually control when to send audio by holding Space or the mic button.",
```

Change to:

```json
"localInferenceTurnDetectionTooltip": "Auto mode uses Voice Activity Detection to automatically detect speech. Push-to-Talk lets you manually control when to send audio by holding Space or the mic button. Push-to-translate works like Push-to-Talk, but routes your raw mic to the virtual mic when idle so you can speak directly without translation.",
```

- [ ] **Step 8: Append Push-to-translate sentence to `settings.geminiVadTooltip`**

Find:

```json
"geminiVadTooltip": "Controls how Gemini detects speech pauses to split turns. Adjusting these settings can improve translation responsiveness for continuous speech.",
```

Change to:

```json
"geminiVadTooltip": "Controls how Gemini detects speech pauses to split turns. Adjusting these settings can improve translation responsiveness for continuous speech. Push-to-Talk: hold a key to send audio. Push-to-translate: like Push-to-Talk, but routes your raw mic to the virtual mic when idle so you can speak directly without translation.",
```

- [ ] **Step 9: Validate the JSON parses**

Run: `python3 -c "import json; json.load(open('src/locales/en/translation.json'))"`
Expected: PASS (no JSON syntax errors).

- [ ] **Step 10: Commit**

```bash
git add src/locales/en/translation.json
git commit -m "feat(i18n): add Push-to-translate strings + extend tooltip text"
```

Other 35+ locales are intentionally left untouched — they will fall back to English for the new keys via i18next's fallback mechanism, and their existing tooltip text simply won't yet mention Push-to-translate. Native-speaker translations follow in a later pass.

---

## Phase B: Persistence tests

### Task 4: Test that `'Push-to-Translate'` round-trips for each PTT-supporting provider

**Files:**
- Modify: `src/stores/settingsStore.test.ts`

- [ ] **Step 1: Add a new `describe` block for Push-to-Translate persistence**

After the existing `Volcengine AST 2.0 custom vocabulary` describe block (around line 222), add inside the outer `describe('settingsStore', () => { ... })`:

```ts
describe('Push-to-Translate persistence', () => {
  it('persists Push-to-Translate for Gemini', async () => {
    const store = useSettingsStore.getState();
    await store.updateGemini({ turnDetectionMode: 'Push-to-Translate' });

    expect(useSettingsStore.getState().gemini.turnDetectionMode).toBe('Push-to-Translate');
    expect(mockSetSetting).toHaveBeenCalledWith(
      'settings.gemini.turnDetectionMode',
      'Push-to-Translate'
    );
  });

  it('persists Push-to-Translate for Volcengine AST2', async () => {
    const store = useSettingsStore.getState();
    await store.updateVolcengineAST2({ turnDetectionMode: 'Push-to-Translate' } as any);

    expect(useSettingsStore.getState().volcengineAST2.turnDetectionMode).toBe('Push-to-Translate');
    expect(mockSetSetting).toHaveBeenCalledWith(
      'settings.volcengineAST2.turnDetectionMode',
      'Push-to-Translate'
    );
  });

  it('persists Push-to-Translate for Local Inference', async () => {
    const store = useSettingsStore.getState();
    await store.updateLocalInference({ turnDetectionMode: 'Push-to-Translate' });

    expect(useSettingsStore.getState().localInference.turnDetectionMode).toBe('Push-to-Translate');
    expect(mockSetSetting).toHaveBeenCalledWith(
      'settings.localInference.turnDetectionMode',
      'Push-to-Translate'
    );
  });

  it('persists Push-to-Translate for OpenAI on WebSocket', async () => {
    const store = useSettingsStore.getState();
    await store.updateOpenAI({
      transportType: 'websocket',
      turnDetectionMode: 'Push-to-Translate',
    });

    expect(useSettingsStore.getState().openai.turnDetectionMode).toBe('Push-to-Translate');
  });

  it('per-provider isolation: setting Push-to-Translate on Gemini does not change OpenAI', async () => {
    const store = useSettingsStore.getState();
    const openAIBefore = useSettingsStore.getState().openai.turnDetectionMode;

    await store.updateGemini({ turnDetectionMode: 'Push-to-Translate' });

    expect(useSettingsStore.getState().openai.turnDetectionMode).toBe(openAIBefore);
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `npx vitest run src/stores/settingsStore.test.ts -t "Push-to-Translate persistence"`
Expected: 5 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/stores/settingsStore.test.ts
git commit -m "test(settings): cover Push-to-Translate persistence per provider"
```

---

### Task 5: Test the WebRTC auto-correction demotes Push-to-Translate → Disabled

**Files:**
- Modify: `src/stores/settingsStore.test.ts`

- [ ] **Step 1: Add WebRTC auto-correction tests**

Inside the `describe('settingsStore', () => { ... })`, after the `Push-to-Translate persistence` block from Task 4, add:

```ts
describe('WebRTC auto-correction for Push-to-Translate', () => {
  it('OpenAI: demotes Push-to-Translate to Disabled when transport switches to webrtc', async () => {
    const store = useSettingsStore.getState();

    // Start on websocket with Push-to-Translate
    await store.updateOpenAI({
      transportType: 'websocket',
      turnDetectionMode: 'Push-to-Translate',
    });
    expect(useSettingsStore.getState().openai.turnDetectionMode).toBe('Push-to-Translate');

    // Switch transport to webrtc
    await store.updateOpenAI({ transportType: 'webrtc' });
    expect(useSettingsStore.getState().openai.turnDetectionMode).toBe('Disabled');
  });

  it('OpenAI Compatible: demotes Push-to-Translate to Disabled when transport switches to webrtc', async () => {
    const store = useSettingsStore.getState();
    await store.updateOpenAICompatible({
      transportType: 'websocket',
      turnDetectionMode: 'Push-to-Translate',
    });
    await store.updateOpenAICompatible({ transportType: 'webrtc' });
    expect(useSettingsStore.getState().openaiCompatible.turnDetectionMode).toBe('Disabled');
  });

  it('Kizuna AI: demotes Push-to-Translate to Disabled when transport switches to webrtc', async () => {
    const store = useSettingsStore.getState();
    await store.updateKizunaAI({
      transportType: 'websocket',
      turnDetectionMode: 'Push-to-Translate',
    });
    await store.updateKizunaAI({ transportType: 'webrtc' });
    expect(useSettingsStore.getState().kizunaai.turnDetectionMode).toBe('Disabled');
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `npx vitest run src/stores/settingsStore.test.ts -t "WebRTC auto-correction"`
Expected: 3 tests PASS.

The reason these pass without modifying the existing auto-correction logic: the existing guards (`settingsStore.ts:837/869/901`) read `if (settings.transportType === 'webrtc' && updatedSettings.turnDetectionMode !== 'Disabled')` — and `'Push-to-Translate' !== 'Disabled'`, so the auto-correction triggers and sets `turnDetectionMode = 'Disabled'`. This is intentional per the spec: WebRTC + Push-to-translate is unsupported.

- [ ] **Step 3: Commit**

```bash
git add src/stores/settingsStore.test.ts
git commit -m "test(settings): cover WebRTC auto-correction demoting Push-to-Translate"
```

---

## Phase C: Audio routing — passthrough + canHoldToSpeak

### Task 6: Replace passthrough useEffect with mode-aware unified version

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx:177` (state)
- Modify: `src/components/MainPanel/MainPanel.tsx:437–452` (useEffect)
- Add: `src/components/MainPanel/MainPanel.tsx` near the top of the component body (derived `currentTurnDetectionMode`)

- [ ] **Step 1: Add `currentTurnDetectionMode` useMemo**

In `MainPanel.tsx`, right after the `supportsTextInput` useMemo (around line 183–189), add:

```ts
// Current provider's Speech Mode (turnDetectionMode), or 'Auto' for providers without one
const currentTurnDetectionMode = useMemo<string>(() => {
  if (provider === Provider.OPENAI) return openAISettings.turnDetectionMode;
  if (provider === Provider.OPENAI_COMPATIBLE) return openAICompatibleSettings.turnDetectionMode;
  if (provider === Provider.KIZUNA_AI) return kizunaAISettings.turnDetectionMode;
  if (provider === Provider.GEMINI) return geminiSettings.turnDetectionMode;
  if (provider === Provider.VOLCENGINE_AST2) return volcengineAST2Settings.turnDetectionMode;
  if (provider === Provider.LOCAL_INFERENCE) return localInferenceSettings.turnDetectionMode;
  return 'Auto'; // PalabraAI, Volcengine ST: no PTT support
}, [
  provider,
  openAISettings.turnDetectionMode,
  openAICompatibleSettings.turnDetectionMode,
  kizunaAISettings.turnDetectionMode,
  geminiSettings.turnDetectionMode,
  volcengineAST2Settings.turnDetectionMode,
  localInferenceSettings.turnDetectionMode,
]);
```

- [ ] **Step 2: Replace the passthrough useEffect**

Find the existing block at `MainPanel.tsx:437–452`:

```ts
/**
 * Update passthrough settings when they change
 */
useEffect(() => {
  const audioService = audioServiceRef.current;
  if (audioService) {
    audioService.setupPassthrough(
      isRealVoicePassthroughEnabled,
      realVoicePassthroughVolume
    );
    
    if (isRealVoicePassthroughEnabled) {
      console.debug('[Sokuji] [MainPanel] Updated passthrough settings: enabled=', isRealVoicePassthroughEnabled, 'volume=', realVoicePassthroughVolume);
    }
  }
}, [isRealVoicePassthroughEnabled, realVoicePassthroughVolume, selectedInputDevice, selectedMonitorDevice, isMonitorDeviceOn]);
```

Replace with:

```ts
/**
 * Update passthrough settings when they change.
 * Push-to-translate mode hijacks passthrough: on @ 100% during idle,
 * off while user holds Space. Other modes use the legacy user setting.
 */
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

  if (enabled) {
    console.debug('[Sokuji] [MainPanel] Updated passthrough settings: enabled=', enabled, 'volume=', volume, 'mode=', currentTurnDetectionMode);
  }
}, [
  currentTurnDetectionMode,
  isRecording,
  isRealVoicePassthroughEnabled,
  realVoicePassthroughVolume,
  selectedInputDevice,
  selectedMonitorDevice,
  isMonitorDeviceOn,
]);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(audio): mode-aware unified passthrough useEffect"
```

---

### Task 7: Update feedback warning useEffect to consider Push-to-translate as effectively enabled

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx:467–493`

The spec assumed the feedback warning already reads the *effective* passthrough state, but in fact it reads `isRealVoicePassthroughEnabled` (the user setting). When Push-to-translate is active, the user setting may be `false` while the effective passthrough is on at 100% — causing the warning to be silent on a real feedback-risk configuration.

- [ ] **Step 1: Compute the effective passthrough flag**

Find the existing block at `MainPanel.tsx:467–493`:

```ts
/**
 * Check for potential audio feedback and show warning
 */
useEffect(() => {
  if (feedbackWarningDismissed || !isRealVoicePassthroughEnabled || !isMonitorDeviceOn) {
    setShowFeedbackWarning(false);
    return;
  }

  const safeConfig = getSafeAudioConfiguration(
    selectedInputDevice,
    selectedMonitorDevice,
    isRealVoicePassthroughEnabled
  );

  if (!safeConfig.safePassthroughEnabled && safeConfig.recommendedAction) {
    setShowFeedbackWarning(true);
  } else {
    setShowFeedbackWarning(false);
  }
}, [
  isRealVoicePassthroughEnabled,
  selectedInputDevice,
  selectedMonitorDevice,
  feedbackWarningDismissed,
  isMonitorDeviceOn
]);
```

Replace with:

```ts
/**
 * Check for potential audio feedback and show warning.
 * Considers Push-to-translate's effective passthrough (always on @ 100% during idle)
 * in addition to the user-controlled isRealVoicePassthroughEnabled.
 */
useEffect(() => {
  const isPushToTranslate = currentTurnDetectionMode === 'Push-to-Translate';
  const effectivePassthroughEnabled = isPushToTranslate || isRealVoicePassthroughEnabled;

  if (feedbackWarningDismissed || !effectivePassthroughEnabled || !isMonitorDeviceOn) {
    setShowFeedbackWarning(false);
    return;
  }

  const safeConfig = getSafeAudioConfiguration(
    selectedInputDevice,
    selectedMonitorDevice,
    effectivePassthroughEnabled
  );

  if (!safeConfig.safePassthroughEnabled && safeConfig.recommendedAction) {
    setShowFeedbackWarning(true);
  } else {
    setShowFeedbackWarning(false);
  }
}, [
  currentTurnDetectionMode,
  isRealVoicePassthroughEnabled,
  selectedInputDevice,
  selectedMonitorDevice,
  feedbackWarningDismissed,
  isMonitorDeviceOn,
]);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "fix(feedback-warning): consider Push-to-translate's effective passthrough"
```

---

### Task 8: Rename `canPushToTalk` → `canHoldToSpeak` and add Push-to-Translate to PTT-like modes

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx:175–177` (state declaration + comment)
- Modify: `src/components/MainPanel/MainPanel.tsx:1097–1113` (assignment in startSession)
- Modify: `src/components/MainPanel/MainPanel.tsx:2243–2294` (keyboard handler)

- [ ] **Step 1: Rename state**

In `MainPanel.tsx`, find at line 175–177:

```ts
// canPushToTalk is true when manual turn detection is used
// (OpenAI-compatible: 'Disabled', Volcengine AST2: 'Push-to-Talk')
const [canPushToTalk, setCanPushToTalk] = useState(false);
```

Replace with:

```ts
// canHoldToSpeak is true when the active mode uses space-hold to send audio:
// OpenAI-compatible 'Disabled', other providers' 'Push-to-Talk', and the new
// 'Push-to-Translate' mode all gate on this.
const [canHoldToSpeak, setCanHoldToSpeak] = useState(false);
```

- [ ] **Step 2: Rename assignment in startSession**

Find at lines 1097–1113:

```ts
// Set canPushToTalk based on current turnDetectionMode
if (isOpenAICompatible(provider)) {
  const settings =
    provider === Provider.OPENAI ? openAISettings :
    provider === Provider.OPENAI_COMPATIBLE ? openAICompatibleSettings :
    provider === Provider.KIZUNA_AI ? kizunaAISettings :
    null;
  setCanPushToTalk(settings ? settings.turnDetectionMode === 'Disabled' : false);
} else if (provider === Provider.VOLCENGINE_AST2) {
  setCanPushToTalk(volcengineAST2Settings.turnDetectionMode === 'Push-to-Talk');
} else if (provider === Provider.LOCAL_INFERENCE) {
  setCanPushToTalk(localInferenceSettings.turnDetectionMode === 'Push-to-Talk');
} else if (provider === Provider.GEMINI) {
  setCanPushToTalk(geminiSettings.turnDetectionMode === 'Push-to-Talk');
} else {
  setCanPushToTalk(false); // Not supported by PalabraAI and Volcengine ST
}
```

Replace with:

```ts
// Set canHoldToSpeak based on current turnDetectionMode (PTT and Push-to-Translate share the same key handler)
const isPttLikeMode = (mode: string): boolean =>
  mode === 'Push-to-Talk' || mode === 'Push-to-Translate' || mode === 'Disabled';

if (isOpenAICompatible(provider)) {
  const settings =
    provider === Provider.OPENAI ? openAISettings :
    provider === Provider.OPENAI_COMPATIBLE ? openAICompatibleSettings :
    provider === Provider.KIZUNA_AI ? kizunaAISettings :
    null;
  setCanHoldToSpeak(settings ? isPttLikeMode(settings.turnDetectionMode) : false);
} else if (provider === Provider.VOLCENGINE_AST2) {
  setCanHoldToSpeak(isPttLikeMode(volcengineAST2Settings.turnDetectionMode));
} else if (provider === Provider.LOCAL_INFERENCE) {
  setCanHoldToSpeak(isPttLikeMode(localInferenceSettings.turnDetectionMode));
} else if (provider === Provider.GEMINI) {
  setCanHoldToSpeak(isPttLikeMode(geminiSettings.turnDetectionMode));
} else {
  setCanHoldToSpeak(false); // Not supported by PalabraAI and Volcengine ST
}
```

- [ ] **Step 3: Update keyboard handler**

Find at lines 2243–2294:

```ts
useEffect(() => {
  // Only enable push-to-talk when session is active and turnDetectionMode is 'Disabled'
  const isPushToTalkEnabled = isSessionActive && canPushToTalk;
  ...
}, [isSessionActive, canPushToTalk, startRecording, stopRecording, isRecording]);
```

Replace `canPushToTalk` with `canHoldToSpeak` and update the comment:

```ts
useEffect(() => {
  // Enable space hold-to-speak when session is active and we're in a PTT-like mode
  // (Push-to-Talk, Push-to-Translate, or OpenAI's Disabled mode)
  const isHoldToSpeakEnabled = isSessionActive && canHoldToSpeak;
  ...
}, [isSessionActive, canHoldToSpeak, startRecording, stopRecording, isRecording]);
```

Inside the `handleKeyDown` and `handleKeyUp` functions, change `if (!isPushToTalkEnabled || ...)` to `if (!isHoldToSpeakEnabled || ...)`. Inside `handleBlur`, change `if (isPushToTalkEnabled && isRecording)` to `if (isHoldToSpeakEnabled && isRecording)`.

- [ ] **Step 4: Search for any remaining references**

Run: `grep -n "canPushToTalk\|isPushToTalkEnabled" src/components/MainPanel/MainPanel.tsx`
Expected: zero matches (all renamed).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(mainpanel): canPushToTalk → canHoldToSpeak; include Push-to-Translate"
```

---

## Phase D: Recorder lifecycle for Push-to-translate

### Task 9: Treat Push-to-translate as continuous-record at session start with gated callback

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx:1223–1264` (session-start recording branch)

- [ ] **Step 1: Replace the session-start recording branch**

Find the block at `MainPanel.tsx:1223–1264` that determines whether to start recording at session start. The current logic computes `turnDetectionDisabled` (true for PTT-style) and only starts recording when false. We need a third pattern: "PTT-like AND Push-to-Translate" → start recording with gated callback.

The current block (lines 1223–1264, in context of the surrounding code):

```ts
// Start recording if using server VAD and input device is turned on
// Note: Skip manual recording for WebRTC mode - audio flows via MediaStreamTrack
let turnDetectionDisabled = false;
if (isOpenAICompatible(provider)) {
  const settings =
    provider === Provider.OPENAI ? openAISettings :
    provider === Provider.OPENAI_COMPATIBLE ? openAICompatibleSettings :
    provider === Provider.KIZUNA_AI ? kizunaAISettings :
    null;
  turnDetectionDisabled = settings ? settings.turnDetectionMode === 'Disabled' : false;
} else if (provider === Provider.VOLCENGINE_AST2) {
  turnDetectionDisabled = volcengineAST2Settings.turnDetectionMode === 'Push-to-Talk';
} else if (provider === Provider.LOCAL_INFERENCE) {
  turnDetectionDisabled = localInferenceSettings.turnDetectionMode === 'Push-to-Talk';
} else if (provider === Provider.GEMINI) {
  turnDetectionDisabled = geminiSettings.turnDetectionMode === 'Push-to-Talk';
}
... (then ~25 lines below) ...
// Check if provider uses native audio capture (OpenAI WebRTC or PalabraAI/LiveKit)
const usesNativeCapture = ClientFactory.usesNativeAudioCapture(provider, useWebRTC ? 'webrtc' : 'websocket');
...
if (!usesNativeCapture && !turnDetectionDisabled && isInputDeviceOn && audioServiceRef.current) {
  let audioCallbackCount = 0;
  await audioServiceRef.current.startRecording(selectedInputDevice?.deviceId, (data) => {
    if (clientRef.current) {
      if (audioCallbackCount % 100 === 0) {
        console.debug(`[Sokuji] [MainPanel] Sending audio to client: chunk ${audioCallbackCount}, PCM length: ${data.mono.length}`);
      }
      audioCallbackCount++;
      clientRef.current.appendInputAudio(data.mono);
    }
  });
}
```

Add a sibling branch for Push-to-translate. Keep `turnDetectionDisabled` calculation the same (it represents "PTT-style — don't auto-start"). Then introduce `isPushToTranslateMode` and a separate branch.

Replace the relevant blocks. First update the `turnDetectionDisabled` block to also derive `isPushToTranslateMode` (snippet to insert right after the existing turnDetectionDisabled assignments):

```ts
// Push-to-translate uses a continuous recorder (like VAD modes) but gates AI forwarding
let isPushToTranslateMode = false;
if (isOpenAICompatible(provider)) {
  const settings =
    provider === Provider.OPENAI ? openAISettings :
    provider === Provider.OPENAI_COMPATIBLE ? openAICompatibleSettings :
    provider === Provider.KIZUNA_AI ? kizunaAISettings :
    null;
  isPushToTranslateMode = settings ? settings.turnDetectionMode === 'Push-to-Translate' : false;
} else if (provider === Provider.VOLCENGINE_AST2) {
  isPushToTranslateMode = volcengineAST2Settings.turnDetectionMode === 'Push-to-Translate';
} else if (provider === Provider.LOCAL_INFERENCE) {
  isPushToTranslateMode = localInferenceSettings.turnDetectionMode === 'Push-to-Translate';
} else if (provider === Provider.GEMINI) {
  isPushToTranslateMode = geminiSettings.turnDetectionMode === 'Push-to-Translate';
}
```

Insert this right after the existing `} else if (provider === Provider.GEMINI) { turnDetectionDisabled = ... }` block ending around line 1239.

- [ ] **Step 2: Update the recording-start condition**

Find the existing `if (!usesNativeCapture && !turnDetectionDisabled && isInputDeviceOn && audioServiceRef.current) { ... }` block (around line 1253–1264). Replace it with two branches:

```ts
// Recorder lifecycle:
//  - VAD modes (turnDetectionDisabled === false): start now, always-forward callback
//  - Push-to-Translate (isPushToTranslateMode === true): start now, gated callback (skip AI forwarding when isPassthrough)
//  - Other PTT-style (turnDetectionDisabled === true && !isPushToTranslateMode): defer to space keydown
// Skip entirely if the provider uses native MediaStreamTrack capture (WebRTC, PalabraAI/LiveKit).
if (!usesNativeCapture && isInputDeviceOn && audioServiceRef.current) {
  if (!turnDetectionDisabled) {
    // VAD: always-forward callback
    let audioCallbackCount = 0;
    await audioServiceRef.current.startRecording(selectedInputDevice?.deviceId, (data) => {
      if (clientRef.current) {
        if (audioCallbackCount % 100 === 0) {
          console.debug(`[Sokuji] [MainPanel] Sending audio to client: chunk ${audioCallbackCount}, PCM length: ${data.mono.length}`);
        }
        audioCallbackCount++;
        clientRef.current.appendInputAudio(data.mono);
      }
    });
  } else if (isPushToTranslateMode) {
    // Push-to-Translate: gated callback. Mode is captured by closure;
    // the option button is disabled while isSessionActive so the captured value stays correct.
    let p2tCallbackCount = 0;
    await audioServiceRef.current.startRecording(selectedInputDevice?.deviceId, (data) => {
      if (!clientRef.current) return;
      if (data.isPassthrough) {
        return;  // IDLE: route to passthrough only, don't send to AI
      }
      if (p2tCallbackCount % 100 === 0) {
        console.debug(`[Sokuji] [MainPanel] P2T: Sending audio to client: chunk ${p2tCallbackCount}, PCM length: ${data.mono.length}`);
      }
      p2tCallbackCount++;
      clientRef.current.appendInputAudio(data.mono);
    });
  }
  // else: pure PTT (Push-to-Talk / Disabled). Recorder stays idle until space keydown.
}
```

- [ ] **Step 3: Mirror the same logic in the input-device toggle useEffect**

Find at `MainPanel.tsx:2143–2195`. The input-device-toggled-on path (line 2156 onwards) currently re-derives `turnDetectionDisabled` and starts the recorder for VAD modes. Update it the same way as Step 2:

After the existing `turnDetectionDisabled` derivation in this useEffect (lines 2158–2172), insert the same `isPushToTranslateMode` derivation block from Step 1.

Then change the conditional recorder start (around line 2173–2188) from:

```ts
if (!turnDetectionDisabled) {
  console.info('[Sokuji] [MainPanel] Input device turned on - starting recording in automatic mode');
  if (!recorder.isRecording()) {
    let autoAudioCallbackCount = 0;
    await audioService.startRecording(selectedInputDevice?.deviceId, (data) => {
      if (client) {
        if (autoAudioCallbackCount % 100 === 0) {
          console.debug(`[Sokuji] [MainPanel] Auto: Sending audio to client: chunk ${autoAudioCallbackCount}, PCM length: ${data.mono.length}`);
        }
        autoAudioCallbackCount++;
        client.appendInputAudio(data.mono);
      }
    });
  }
}
// For push-to-talk mode, we don't automatically resume recording
// The user needs to press the button or Space key
```

to:

```ts
if (!turnDetectionDisabled) {
  console.info('[Sokuji] [MainPanel] Input device turned on - starting recording in automatic mode');
  if (!recorder.isRecording()) {
    let autoAudioCallbackCount = 0;
    await audioService.startRecording(selectedInputDevice?.deviceId, (data) => {
      if (client) {
        if (autoAudioCallbackCount % 100 === 0) {
          console.debug(`[Sokuji] [MainPanel] Auto: Sending audio to client: chunk ${autoAudioCallbackCount}, PCM length: ${data.mono.length}`);
        }
        autoAudioCallbackCount++;
        client.appendInputAudio(data.mono);
      }
    });
  }
} else if (isPushToTranslateMode) {
  console.info('[Sokuji] [MainPanel] Input device turned on - starting recording in Push-to-translate mode');
  if (!recorder.isRecording()) {
    let p2tCallbackCount = 0;
    await audioService.startRecording(selectedInputDevice?.deviceId, (data) => {
      if (!client) return;
      if (data.isPassthrough) return;
      if (p2tCallbackCount % 100 === 0) {
        console.debug(`[Sokuji] [MainPanel] P2T: Sending audio to client: chunk ${p2tCallbackCount}, PCM length: ${data.mono.length}`);
      }
      p2tCallbackCount++;
      client.appendInputAudio(data.mono);
    });
  }
}
// For pure push-to-talk (turnDetectionDisabled && !isPushToTranslateMode), don't resume.
// User needs to press the button or Space key.
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(audio): continuous recorder + gated callback for Push-to-translate"
```

---

### Task 10: Skip recorder start/pause in `startRecording`/`stopRecording` when in Push-to-translate

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx:1432–1497` (startRecording)
- Modify: `src/components/MainPanel/MainPanel.tsx:1498–1605` (stopRecording)

In Push-to-translate, the audio service recorder is already running continuously. The local PTT-state functions `startRecording` / `stopRecording` (which the space keyboard handler calls) must NOT call `audioService.startRecording` / `audioService.pauseRecording` on key events — they should only flip `isRecording` state and trigger `createResponse()` on stop. The unified passthrough useEffect (Task 6) reacts to `isRecording` changes and toggles the passthrough flag accordingly, which the gated recording callback (Task 9) reads via `data.isPassthrough`.

For pure PTT modes (Push-to-Talk / Disabled), the existing start/pause behavior must stay.

- [ ] **Step 1: Branch `startRecording` on mode**

In `MainPanel.tsx`, find `startRecording` (line 1432–1496). Locate the block from line 1461 onwards:

```ts
try {
  // Note: We no longer interrupt playing audio when recording starts
  // This allows for simultaneous recording and playback

  // Check if the recorder is in a valid state
  const recorder = audioService.getRecorder();
  if (recorder.isRecording()) {
    // If somehow we're already recording, pause first
    console.warn('[Sokuji] [MainPanel] ModernAudioRecorder was already recording, pausing first');
    await audioService.pauseRecording();
  }

  // Start recording
  pttVoiceChunkCountRef.current = 0;  // Reset non-silent chunk counter
  let pttAudioCallbackCount = 0;
  await audioService.startRecording(selectedInputDevice?.deviceId, (data) => {
    if (client) {
      // Debug logging for push-to-talk (every 50 chunks)
      if (pttAudioCallbackCount % 50 === 0) {
        console.debug(`[Sokuji] [MainPanel] PTT: Sending audio to client: chunk ${pttAudioCallbackCount}, PCM length: ${data.mono.length}`);
      }
      pttAudioCallbackCount++;

      // Track non-silent audio chunks for empty request detection
      if (!isSilentAudio(data.mono)) {
        pttVoiceChunkCountRef.current++;
      }

      client.appendInputAudio(data.mono);
    }
  });
} catch (error) {
  console.error('[Sokuji] [MainPanel] Error starting recording:', error);
  setIsRecording(false);
}
```

Wrap the recorder-start logic in a mode check. Replace the entire `try { ... } catch { ... }` block with:

```ts
try {
  const isPushToTranslate = currentTurnDetectionMode === 'Push-to-Translate';

  if (isPushToTranslate) {
    // Push-to-translate: recorder is already running continuously.
    // Just reset chunk counter; the unified passthrough useEffect will mute passthrough
    // (because isRecording is now true), and the gated recording callback (set up at
    // session start) will start forwarding audio to the AI client.
    pttVoiceChunkCountRef.current = 0;
    return;
  }

  // Pure PTT modes (Push-to-Talk / Disabled): start the recorder fresh on each hold.
  // Note: We no longer interrupt playing audio when recording starts
  // This allows for simultaneous recording and playback

  // Check if the recorder is in a valid state
  const recorder = audioService.getRecorder();
  if (recorder.isRecording()) {
    // If somehow we're already recording, pause first
    console.warn('[Sokuji] [MainPanel] ModernAudioRecorder was already recording, pausing first');
    await audioService.pauseRecording();
  }

  // Start recording
  pttVoiceChunkCountRef.current = 0;  // Reset non-silent chunk counter
  let pttAudioCallbackCount = 0;
  await audioService.startRecording(selectedInputDevice?.deviceId, (data) => {
    if (client) {
      // Debug logging for push-to-talk (every 50 chunks)
      if (pttAudioCallbackCount % 50 === 0) {
        console.debug(`[Sokuji] [MainPanel] PTT: Sending audio to client: chunk ${pttAudioCallbackCount}, PCM length: ${data.mono.length}`);
      }
      pttAudioCallbackCount++;

      // Track non-silent audio chunks for empty request detection
      if (!isSilentAudio(data.mono)) {
        pttVoiceChunkCountRef.current++;
      }

      client.appendInputAudio(data.mono);
    }
  });
} catch (error) {
  console.error('[Sokuji] [MainPanel] Error starting recording:', error);
  setIsRecording(false);
}
```

Add `currentTurnDetectionMode` to the `useCallback` dependency array at the end of `startRecording`. The existing line is:

```ts
}, [isInputDeviceOn, isRecording, selectedInputDevice]);
```

Change to:

```ts
}, [isInputDeviceOn, isRecording, selectedInputDevice, currentTurnDetectionMode]);
```

- [ ] **Step 2: Branch `stopRecording` on mode**

In `MainPanel.tsx`, find the `try { ... } catch { ... }` block in `stopRecording` at lines 1526–1574. The existing block:

```ts
try {
  // Only try to pause if we're actually recording
  const recorder = audioService.getRecorder();
  if (recorder.isRecording()) {
    // For Volcengine AST2 and LocalOffline PTT: send silence frames before stopping
    // This helps the VAD detect end of speech
    if ((provider === Provider.VOLCENGINE_AST2 || provider === Provider.LOCAL_INFERENCE) && client) {
      const silenceFrameSize = 2400; // 24kHz * 0.1s = 2400 samples per 100ms frame (client downsamples to 16kHz internally)
      const silenceFrames = provider === Provider.LOCAL_INFERENCE ? 7 : 5; // 700ms for Silero VAD (minSilenceDuration=0.5s + margin), 500ms for AST2
      for (let i = 0; i < silenceFrames; i++) {
        // New buffer each iteration — worker postMessage transfers (detaches) the ArrayBuffer
        client.appendInputAudio(new Int16Array(silenceFrameSize));
      }
      console.debug(`[Sokuji] [MainPanel] PTT: Sent ${silenceFrames * 100}ms silence frames for VAD end detection`);
    }

    // Stop recording
    await audioService.pauseRecording();

    // Only create response if we detected enough voice audio (prevents empty requests)
    // Note: AST2 handles response creation server-side via VAD, so skip client.createResponse() for it
    // Note: LOCAL_INFERENCE always calls createResponse() — for streaming ASR it flushes the
    //       pending utterance; for offline ASR (VAD-based) it's harmless (silence frames handle it)
    const MIN_VOICE_CHUNKS = 5; // At least 5 non-silent chunks (~0.5 seconds of speech)
    if (client && provider === Provider.LOCAL_INFERENCE) {
      client.createResponse();
    } else if (client && provider === Provider.GEMINI) {
      if (pttVoiceChunkCountRef.current >= MIN_VOICE_CHUNKS) {
        client.createResponse();
      } else {
        // No meaningful speech detected — reset speaking state without sending
        // activityEnd so Gemini doesn't generate a response for silence
        client.cancelPttTurn?.();
        console.debug(`[Sokuji] [MainPanel] PTT: Gemini turn cancelled - only ${pttVoiceChunkCountRef.current} voice chunks detected (minimum: ${MIN_VOICE_CHUNKS})`);
      }
    } else if (client && provider !== Provider.VOLCENGINE_AST2 && pttVoiceChunkCountRef.current >= MIN_VOICE_CHUNKS) {
      // Model drift prevention is handled by the silent anchor mechanism (useEffect)
      client.createResponse();
    } else if (client && provider !== Provider.VOLCENGINE_AST2) {
      console.debug(`[Sokuji] [MainPanel] PTT: Skipping response - only ${pttVoiceChunkCountRef.current} voice chunks detected (minimum: ${MIN_VOICE_CHUNKS})`);
    }
  }
} catch (error) {
  // If there's an error during pause (e.g., already paused), log it but don't crash
  console.error('[Sokuji] [MainPanel] Error stopping recording:', error);

  // Reset the recording state to ensure UI is consistent
  setIsRecording(false);
}
```

Replace it with this version (single change: gate the `pauseRecording()` call on mode):

```ts
try {
  const recorder = audioService.getRecorder();
  const isPushToTranslate = currentTurnDetectionMode === 'Push-to-Translate';

  // For Push-to-translate, recorder.isRecording() is always true (continuous capture).
  // For pure PTT, only proceed if the recorder was actually started by startRecording.
  if (recorder.isRecording()) {
    // For Volcengine AST2 and LocalOffline PTT: send silence frames before stopping
    // This helps the VAD detect end of speech
    if ((provider === Provider.VOLCENGINE_AST2 || provider === Provider.LOCAL_INFERENCE) && client) {
      const silenceFrameSize = 2400; // 24kHz * 0.1s = 2400 samples per 100ms frame (client downsamples to 16kHz internally)
      const silenceFrames = provider === Provider.LOCAL_INFERENCE ? 7 : 5; // 700ms for Silero VAD (minSilenceDuration=0.5s + margin), 500ms for AST2
      for (let i = 0; i < silenceFrames; i++) {
        // New buffer each iteration — worker postMessage transfers (detaches) the ArrayBuffer
        client.appendInputAudio(new Int16Array(silenceFrameSize));
      }
      console.debug(`[Sokuji] [MainPanel] PTT: Sent ${silenceFrames * 100}ms silence frames for VAD end detection`);
    }

    // Stop recording — but only for pure PTT. Push-to-translate keeps the recorder
    // running; the unified passthrough useEffect will re-enable passthrough now that
    // isRecording is false (because of setIsRecording(false) earlier in stopRecording).
    if (!isPushToTranslate) {
      await audioService.pauseRecording();
    }

    // Only create response if we detected enough voice audio (prevents empty requests)
    // Note: AST2 handles response creation server-side via VAD, so skip client.createResponse() for it
    // Note: LOCAL_INFERENCE always calls createResponse() — for streaming ASR it flushes the
    //       pending utterance; for offline ASR (VAD-based) it's harmless (silence frames handle it)
    const MIN_VOICE_CHUNKS = 5; // At least 5 non-silent chunks (~0.5 seconds of speech)
    if (client && provider === Provider.LOCAL_INFERENCE) {
      client.createResponse();
    } else if (client && provider === Provider.GEMINI) {
      if (pttVoiceChunkCountRef.current >= MIN_VOICE_CHUNKS) {
        client.createResponse();
      } else {
        // No meaningful speech detected — reset speaking state without sending
        // activityEnd so Gemini doesn't generate a response for silence
        client.cancelPttTurn?.();
        console.debug(`[Sokuji] [MainPanel] PTT: Gemini turn cancelled - only ${pttVoiceChunkCountRef.current} voice chunks detected (minimum: ${MIN_VOICE_CHUNKS})`);
      }
    } else if (client && provider !== Provider.VOLCENGINE_AST2 && pttVoiceChunkCountRef.current >= MIN_VOICE_CHUNKS) {
      // Model drift prevention is handled by the silent anchor mechanism (useEffect)
      client.createResponse();
    } else if (client && provider !== Provider.VOLCENGINE_AST2) {
      console.debug(`[Sokuji] [MainPanel] PTT: Skipping response - only ${pttVoiceChunkCountRef.current} voice chunks detected (minimum: ${MIN_VOICE_CHUNKS})`);
    }
  }
} catch (error) {
  // If there's an error during pause (e.g., already paused), log it but don't crash
  console.error('[Sokuji] [MainPanel] Error stopping recording:', error);

  // Reset the recording state to ensure UI is consistent
  setIsRecording(false);
}
```

The only structural change is wrapping `await audioService.pauseRecording();` in `if (!isPushToTranslate) { ... }`. Everything else (silence frames, createResponse decision tree, error handling) is preserved verbatim.

Then update the `useCallback` dependency array at line 1575 from:

```ts
}, [isRecording, provider]);
```

to:

```ts
}, [isRecording, provider, currentTurnDetectionMode]);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(audio): keep recorder running across hold cycles in Push-to-translate"
```

---

## Phase E: UI — section header rename + new option button per provider

### Task 11: OpenAI / Compat / Kizuna section — rename header + add Push-to-Translate button

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx:336–398`

- [ ] **Step 1: Rename the section header**

In `ProviderSpecificSettings.tsx`, find at line 356:

```tsx
{t('settings.automaticTurnDetection')}
```

Replace with:

```tsx
{t('settings.speechMode')}
```

- [ ] **Step 2: Add Push-to-Translate button after the existing modes loop**

Find the closing of the existing modes loop at lines 364–398:

```tsx
<div className="setting-item">
  <div className="turn-detection-options">
    {turnDetection.modes.map((mode) => {
      const isVADMode = mode === 'Normal' || mode === 'Semantic';
      const isDisabled = isSessionActive || (isWebRTCMode && isVADMode);

      return (
        <button
          key={mode}
          className={`option-button ${compatibleSettings?.turnDetectionMode === mode ? 'active' : ''}`}
          onClick={() => updateOpenAICompatibleSettingsHelper({ turnDetectionMode: mode as 'Normal' | 'Semantic' | 'Disabled' })}
          disabled={isDisabled}
          title={isWebRTCMode && isVADMode ? t('settings.webrtcVadDisabledTitle', 'Server VAD is not available in WebRTC mode') : undefined}
        >
          {t(`settings.${mode.toLowerCase()}`)}
        </button>
      );
    })}
  </div>
  ...
</div>
```

Add a new `<button>` for Push-to-Translate immediately after the `{turnDetection.modes.map(...)}` block, still inside the `<div className="turn-detection-options">`:

```tsx
<button
  key="push-to-translate"
  className={`option-button ${compatibleSettings?.turnDetectionMode === 'Push-to-Translate' ? 'active' : ''}`}
  onClick={() => updateOpenAICompatibleSettingsHelper({ turnDetectionMode: 'Push-to-Translate' })}
  disabled={isSessionActive || isWebRTCMode}
  title={isWebRTCMode ? t('settings.pushToTranslateNotAvailableInWebrtc') : undefined}
>
  {t('settings.pushToTranslate')}
</button>
```

The `isWebRTCMode` disable + tooltip implements the WebRTC incompatibility per the spec edge case: "render the Push-to-translate button **disabled** when `transportType === 'webrtc'`".

- [ ] **Step 3: Cast for TypeScript union**

The cast `mode as 'Normal' | 'Semantic' | 'Disabled'` on the `updateOpenAICompatibleSettingsHelper` call inside the existing loop is now slightly out of date (the union also includes `'Push-to-Translate'`). Change it to:

```tsx
onClick={() => updateOpenAICompatibleSettingsHelper({ turnDetectionMode: mode as 'Normal' | 'Semantic' | 'Disabled' | 'Push-to-Translate' })}
```

This keeps the same behavior — the loop still iterates `['Normal', 'Semantic', 'Disabled']` from the provider config — but the cast now matches the wider union.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx
git commit -m "feat(ui): OpenAI/Compat/Kizuna Speech Mode rename + Push-to-Translate button"
```

---

### Task 12: Gemini section — rename header + add Push-to-Translate button

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx:790–823`

- [ ] **Step 1: Rename the section header**

Find at line 798:

```tsx
{t('settings.geminiVad')}
```

Replace with:

```tsx
{t('settings.speechMode')}
```

- [ ] **Step 2: Add Push-to-Translate button**

Find the existing two-button block at lines 807–822:

```tsx
<div className="turn-detection-options">
  <button
    className={`option-button ${geminiSettings.turnDetectionMode === 'Auto' ? 'active' : ''}`}
    onClick={() => updateGeminiSettings({ turnDetectionMode: 'Auto' })}
    disabled={isSessionActive}
  >
    {t('settings.auto')}
  </button>
  <button
    className={`option-button ${geminiSettings.turnDetectionMode === 'Push-to-Talk' ? 'active' : ''}`}
    onClick={() => updateGeminiSettings({ turnDetectionMode: 'Push-to-Talk' })}
    disabled={isSessionActive}
  >
    {t('settings.pushToTalk')}
  </button>
</div>
```

Add a third button immediately before the closing `</div>`:

```tsx
<button
  className={`option-button ${geminiSettings.turnDetectionMode === 'Push-to-Translate' ? 'active' : ''}`}
  onClick={() => updateGeminiSettings({ turnDetectionMode: 'Push-to-Translate' })}
  disabled={isSessionActive}
>
  {t('settings.pushToTranslate')}
</button>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx
git commit -m "feat(ui): Gemini Speech Mode rename + Push-to-Translate button"
```

---

### Task 13: Volcengine AST2 section — rename header + add Push-to-Translate button

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx:1296–1324`

- [ ] **Step 1: Rename the section header**

Find at line 1298:

```tsx
{t('settings.automaticTurnDetection')}
```

Replace with:

```tsx
{t('settings.speechMode')}
```

- [ ] **Step 2: Add Push-to-Translate button**

Find the existing two-button block at lines 1307–1322:

```tsx
<div className="turn-detection-options">
  <button
    className={`option-button ${volcengineAST2Settings.turnDetectionMode === 'Auto' ? 'active' : ''}`}
    onClick={() => updateVolcengineAST2Settings({ turnDetectionMode: 'Auto' })}
    disabled={isSessionActive}
  >
    {t('settings.auto')}
  </button>
  <button
    className={`option-button ${volcengineAST2Settings.turnDetectionMode === 'Push-to-Talk' ? 'active' : ''}`}
    onClick={() => updateVolcengineAST2Settings({ turnDetectionMode: 'Push-to-Talk' })}
    disabled={isSessionActive}
  >
    {t('settings.pushToTalk')}
  </button>
</div>
```

Add a third button immediately before the closing `</div>`:

```tsx
<button
  className={`option-button ${volcengineAST2Settings.turnDetectionMode === 'Push-to-Translate' ? 'active' : ''}`}
  onClick={() => updateVolcengineAST2Settings({ turnDetectionMode: 'Push-to-Translate' })}
  disabled={isSessionActive}
>
  {t('settings.pushToTranslate')}
</button>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx
git commit -m "feat(ui): Volcengine AST2 Speech Mode rename + Push-to-Translate button"
```

---

### Task 14: Local Inference section — rename header + add Push-to-Translate button

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx:1620–1648`

- [ ] **Step 1: Rename the section header**

Find at line 1622:

```tsx
{t('settings.automaticTurnDetection')}
```

Replace with:

```tsx
{t('settings.speechMode')}
```

- [ ] **Step 2: Add Push-to-Translate button**

Find the existing two-button block at lines 1631–1646:

```tsx
<div className="turn-detection-options">
  <button
    className={`option-button ${localInferenceSettings.turnDetectionMode === 'Auto' ? 'active' : ''}`}
    onClick={() => updateLocalInferenceSettings({ turnDetectionMode: 'Auto' })}
    disabled={isSessionActive}
  >
    {t('settings.auto')}
  </button>
  <button
    className={`option-button ${localInferenceSettings.turnDetectionMode === 'Push-to-Talk' ? 'active' : ''}`}
    onClick={() => updateLocalInferenceSettings({ turnDetectionMode: 'Push-to-Talk' })}
    disabled={isSessionActive}
  >
    {t('settings.pushToTalk')}
  </button>
</div>
```

Add a third button immediately before the closing `</div>`:

```tsx
<button
  className={`option-button ${localInferenceSettings.turnDetectionMode === 'Push-to-Translate' ? 'active' : ''}`}
  onClick={() => updateLocalInferenceSettings({ turnDetectionMode: 'Push-to-Translate' })}
  disabled={isSessionActive}
>
  {t('settings.pushToTranslate')}
</button>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx
git commit -m "feat(ui): Local Inference Speech Mode rename + Push-to-Translate button"
```

---

## Phase F: VoicePassthroughSection mutual exclusion

### Task 15: Make `VoicePassthroughSection` accept `disabled` and `disabledReason` props

**Files:**
- Modify: `src/components/Settings/sections/VoicePassthroughSection.tsx`

- [ ] **Step 1: Extend the props interface**

In `src/components/Settings/sections/VoicePassthroughSection.tsx`, change the props interface from:

```tsx
interface VoicePassthroughSectionProps {
  /** Additional class name */
  className?: string;
}
```

to:

```tsx
interface VoicePassthroughSectionProps {
  /** Additional class name */
  className?: string;
  /** When true, the toggle and slider render disabled with a tooltip. */
  disabled?: boolean;
  /** Tooltip text shown when disabled (i18n string). */
  disabledReason?: string;
}
```

- [ ] **Step 2: Wire up the props**

Update the component signature and body. Replace the existing component:

```tsx
const VoicePassthroughSection: React.FC<VoicePassthroughSectionProps> = ({
  className = ''
}) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();

  const {
    isRealVoicePassthroughEnabled,
    realVoicePassthroughVolume,
    toggleRealVoicePassthrough,
    setRealVoicePassthroughVolume
  } = useAudioContext();

  const handleToggle = (enable: boolean) => {
    if (enable !== isRealVoicePassthroughEnabled) {
      toggleRealVoicePassthrough();
      trackEvent('audio_passthrough_toggled', {
        enabled: enable,
        volume_level: realVoicePassthroughVolume
      });
    }
  };

  return (
    <div className={`config-section voice-passthrough-section ${className}`}>
      <h3>
        {t('audioPanel.realVoicePassthrough')}
        <Tooltip
          content={t('audioPanel.realVoicePassthroughDescription')}
          position="top"
          icon="help"
          maxWidth={300}
        />
      </h3>
      <ToggleSwitch
        checked={isRealVoicePassthroughEnabled}
        onChange={() => handleToggle(!isRealVoicePassthroughEnabled)}
        label={isRealVoicePassthroughEnabled ? t('common.on', 'On') : t('common.off', 'Off')}
      />
      ...
```

with:

```tsx
const VoicePassthroughSection: React.FC<VoicePassthroughSectionProps> = ({
  className = '',
  disabled = false,
  disabledReason,
}) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();

  const {
    isRealVoicePassthroughEnabled,
    realVoicePassthroughVolume,
    toggleRealVoicePassthrough,
    setRealVoicePassthroughVolume
  } = useAudioContext();

  const handleToggle = (enable: boolean) => {
    if (disabled) return;
    if (enable !== isRealVoicePassthroughEnabled) {
      toggleRealVoicePassthrough();
      trackEvent('audio_passthrough_toggled', {
        enabled: enable,
        volume_level: realVoicePassthroughVolume
      });
    }
  };

  return (
    <div
      className={`config-section voice-passthrough-section ${className} ${disabled ? 'disabled' : ''}`}
      aria-disabled={disabled}
      title={disabled ? disabledReason : undefined}
    >
      <h3>
        {t('audioPanel.realVoicePassthrough')}
        <Tooltip
          content={disabled && disabledReason ? disabledReason : t('audioPanel.realVoicePassthroughDescription')}
          position="top"
          icon="help"
          maxWidth={300}
        />
      </h3>
      <ToggleSwitch
        checked={isRealVoicePassthroughEnabled}
        onChange={() => handleToggle(!isRealVoicePassthroughEnabled)}
        label={isRealVoicePassthroughEnabled ? t('common.on', 'On') : t('common.off', 'Off')}
        disabled={disabled}
      />
      ...
```

For the volume slider block lower in the file (the `{isRealVoicePassthroughEnabled && (...)}` block), add `disabled={disabled}` to the `<input type="range" ...>` element:

```tsx
<input
  type="range"
  min="0"
  max="0.6"
  step="0.01"
  value={realVoicePassthroughVolume}
  disabled={disabled}
  onChange={(e) => {
    if (disabled) return;
    const newVolume = parseFloat(e.target.value);
    setRealVoicePassthroughVolume(newVolume);
  }}
  ...
/>
```

If `ToggleSwitch` does not currently accept a `disabled` prop, check `src/components/Settings/shared/ToggleSwitch.tsx` and add one (a small additional change — pass the `disabled` attribute through to the underlying checkbox/button).

- [ ] **Step 3: Verify ToggleSwitch supports `disabled`**

Run: `grep -n "disabled" src/components/Settings/shared/ToggleSwitch.tsx`
If `disabled` is not already a prop, add it:

```tsx
interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}
```

Pass `disabled` through to the underlying `<input>` or `<button>` and add a CSS opacity styling. (If the existing component already supports `disabled`, skip this step.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/VoicePassthroughSection.tsx src/components/Settings/shared/ToggleSwitch.tsx
git commit -m "feat(voice-passthrough): accept disabled + disabledReason props"
```

---

### Task 16: Wire up `VoicePassthroughSection` disable when in Push-to-translate

**Files:**
- Modify: callers of `<VoicePassthroughSection ... />` — find them with grep

- [ ] **Step 1: Find all callers**

Run: `grep -rn "VoicePassthroughSection" src/components/`
Expected: includes the import and the `<VoicePassthroughSection />` usage in whichever audio panel hosts it (likely `src/components/Settings/SimpleSettings/SimpleSettings.tsx` or `src/components/AudioPanel/...` — check the grep output).

- [ ] **Step 2: Compute `currentTurnDetectionMode` at the caller**

For each caller, compute `currentTurnDetectionMode` using the same per-provider lookup as in `MainPanel.tsx` (Task 6 step 1). Define a small helper or inline the logic. For example, if `useProvider` and the per-provider settings hooks are available:

```tsx
const provider = useProvider();
const openAISettings = useOpenAISettings();
const openAICompatibleSettings = useOpenAICompatibleSettings();
const kizunaAISettings = useKizunaAISettings();
const geminiSettings = useGeminiSettings();
const volcengineAST2Settings = useVolcengineAST2Settings();
const localInferenceSettings = useLocalInferenceSettings();

const currentTurnDetectionMode = (() => {
  if (provider === Provider.OPENAI) return openAISettings.turnDetectionMode;
  if (provider === Provider.OPENAI_COMPATIBLE) return openAICompatibleSettings.turnDetectionMode;
  if (provider === Provider.KIZUNA_AI) return kizunaAISettings.turnDetectionMode;
  if (provider === Provider.GEMINI) return geminiSettings.turnDetectionMode;
  if (provider === Provider.VOLCENGINE_AST2) return volcengineAST2Settings.turnDetectionMode;
  if (provider === Provider.LOCAL_INFERENCE) return localInferenceSettings.turnDetectionMode;
  return 'Auto';
})();
```

Alternatively, if you want to avoid duplication: extract the lookup into a custom hook (e.g. `src/stores/settingsStore.ts` could export `useCurrentTurnDetectionMode`) and use it from both `MainPanel.tsx` and the new caller.

If you choose the hook approach, define in `src/stores/settingsStore.ts` after the existing selector hooks:

```ts
export const useCurrentTurnDetectionMode = (): string => useSettingsStore((state) => {
  switch (state.provider) {
    case Provider.OPENAI: return state.openai.turnDetectionMode;
    case Provider.OPENAI_COMPATIBLE: return state.openaiCompatible.turnDetectionMode;
    case Provider.KIZUNA_AI: return state.kizunaai.turnDetectionMode;
    case Provider.GEMINI: return state.gemini.turnDetectionMode;
    case Provider.VOLCENGINE_AST2: return state.volcengineAST2.turnDetectionMode;
    case Provider.LOCAL_INFERENCE: return state.localInference.turnDetectionMode;
    default: return 'Auto';
  }
});
```

Then refactor the `useMemo` in `MainPanel.tsx` Task 6 to use this hook for DRY (small follow-up edit).

- [ ] **Step 3: Pass the disabled props to `<VoicePassthroughSection />`**

```tsx
<VoicePassthroughSection
  disabled={currentTurnDetectionMode === 'Push-to-Translate'}
  disabledReason={t('audioPanel.passthroughManagedByPushToTranslate')}
/>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts src/components/MainPanel/MainPanel.tsx src/components/<caller-file>.tsx
git commit -m "feat(voice-passthrough): mutual exclusion with Push-to-translate mode"
```

---

## Phase G: Analytics

### Task 17: Add `mode` field to `push_to_talk_used` + new `speech_mode_changed` event

**Files:**
- Modify: `src/lib/analytics.ts:133–136`
- Modify: `src/components/MainPanel/MainPanel.tsx:1509–1517` (push_to_talk_used emission)
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx` — add tracking on each Speech Mode button click

- [ ] **Step 1: Extend the `push_to_talk_used` event type**

In `src/lib/analytics.ts`, change lines 133–136 from:

```ts
'push_to_talk_used': {
  session_id: string;
  hold_duration_ms: number;
};
```

to:

```ts
'push_to_talk_used': {
  session_id: string;
  hold_duration_ms: number;
  mode: 'push-to-talk' | 'push-to-translate';
};
```

- [ ] **Step 2: Add the new `speech_mode_changed` event type**

After the `push_to_talk_used` block, add:

```ts
'speech_mode_changed': {
  provider: string;
  from_mode: string;
  to_mode: string;
};
```

- [ ] **Step 3: Pass `mode` when emitting `push_to_talk_used` in MainPanel**

In `src/components/MainPanel/MainPanel.tsx`, find the `trackEvent('push_to_talk_used', ...)` call (around line 1512). Update it to:

```ts
trackEvent('push_to_talk_used', {
  session_id: sessionId,
  hold_duration_ms: holdDuration,
  mode: currentTurnDetectionMode === 'Push-to-Translate' ? 'push-to-translate' : 'push-to-talk',
});
```

- [ ] **Step 4: Emit `speech_mode_changed` from each Speech Mode button**

In `ProviderSpecificSettings.tsx`, wrap each of the 4 providers' Speech Mode button onClick handlers to also emit the analytics event. For each provider, the pattern is:

```tsx
onClick={() => {
  const fromMode = <currentSettings>.turnDetectionMode;
  const toMode = '<button mode>';
  if (fromMode !== toMode) {
    trackEvent('speech_mode_changed', {
      provider: provider,
      from_mode: fromMode,
      to_mode: toMode,
    });
    update<Provider>Settings({ turnDetectionMode: toMode });
  }
}}
```

Apply this to:
- OpenAI/Compat/Kizuna: the `.modes.map()` loop button onClick AND the new Push-to-Translate button onClick (Task 11)
- Gemini: all 3 button onClicks (Auto, Push-to-Talk, Push-to-Translate)
- Volcengine AST2: all 3 button onClicks
- Local Inference: all 3 button onClicks

If `useAnalytics` / `trackEvent` is not yet imported in `ProviderSpecificSettings.tsx`, add the import at the top:

```tsx
import { useAnalytics } from '../../../lib/analytics';
```

And call `const { trackEvent } = useAnalytics();` near the top of the component.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/analytics.ts src/components/MainPanel/MainPanel.tsx src/components/Settings/sections/ProviderSpecificSettings.tsx
git commit -m "feat(analytics): mode field on push_to_talk_used + speech_mode_changed event"
```

---

## Phase H: Manual smoke test + cleanup

### Task 18: Manual smoke test

Run the manual checklist from the spec's "Test plan / Manual smoke" section. This is not strictly automatable (audio devices, virtual mic, real provider sessions), so the implementer must walk through it on a developer machine.

- [ ] **Step 1: Run the full lint + test + typecheck suite**

Run: `npm run test`
Expected: all existing tests + the 8 new tests from Tasks 4–5 PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 2: Start Electron in dev mode and run smoke tests**

Run: `npm run electron:dev`

Then walk through each item from the spec test plan (per supported provider):

1. Switch to Push-to-translate, start session, verify raw mic audio reaches the virtual sink at full volume (check via the monitor device or by recording the virtual sink).
2. Hold space — verify raw passthrough cuts within ~50ms; verify mic audio reaches AI; release; verify AI translation plays into the virtual sink.
3. Verify `VoicePassthroughSection` renders disabled with tooltip while mode active; verify saved values are restored when switching to a non-Push-to-translate mode.
4. Verify section header reads "Speech Mode" across all 6 PTT-supporting + 2 unsupported provider configs.
5. Verify Push-to-translate option absent on PalabraAI and Volcengine ST.
6. Window blur during hold → passthrough resumes correctly.
7. Provider switch away from a PTT-supporting provider that has `Push-to-Translate` saved, then back → selection persists across the round-trip.
8. OpenAI / Compat / Kizuna: with Push-to-Translate selected on WebSocket, switch transport to WebRTC → button renders disabled with tooltip; stored `turnDetectionMode` demotes to `'Disabled'`. Switch back to WebSocket → button re-enables; user can re-select Push-to-Translate.

Regression checks:
- Existing PTT mode unchanged on each PTT-supporting provider.
- `isRealVoicePassthroughEnabled` standalone toggle still works in non-Push-to-translate modes.
- Feedback warning still surfaces correctly.

- [ ] **Step 3: Browser extension smoke (Chrome)**

Run: `npm run dev` → load the extension in Chrome from `extension/` per project conventions. Repeat the relevant items from Step 2 (the extension uses `sendPcmDataToTabs(data, 'passthrough')` instead of the Electron virtual speaker, but the user-visible behavior should match).

- [ ] **Step 4: If any test fails, fix and recommit**

Track failures inline; commit fixes with `fix(...)` messages targeting the specific subsystem.

- [ ] **Step 5: Final commit if any cleanup needed**

If you discovered any leftover debug logs / unused imports / typos during smoke testing, clean them up here and commit.

```bash
git add -p
git commit -m "chore(push-to-translate): post-smoke cleanup"
```

---

## Done

The feature is now functionally and visually complete. Open a PR referencing both the spec and issue #214.
