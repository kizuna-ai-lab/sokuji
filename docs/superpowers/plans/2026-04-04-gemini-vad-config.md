# Gemini VAD Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Gemini Live API `AutomaticActivityDetection` VAD parameters as user-configurable settings, fixing #171 (long continuous speech causes delayed translation).

**Architecture:** Add 5 VAD fields to `GeminiSettings` → pass them through `GeminiSessionConfig` → consume in `GeminiClient.connect()` to build `automaticActivityDetection` config → render controls in `ProviderSpecificSettings`.

**Tech Stack:** TypeScript, React, Zustand, `@google/genai` SDK (`StartSensitivity`, `EndSensitivity` enums), i18next

**Spec:** `docs/superpowers/specs/2026-04-04-gemini-vad-config-design.md`

---

### Task 1: Add VAD fields to GeminiSettings and GeminiSessionConfig interfaces

**Files:**
- Modify: `src/stores/settingsStore.ts:69-77` (GeminiSettings interface)
- Modify: `src/stores/settingsStore.ts:227-235` (defaultGeminiSettings)
- Modify: `src/services/interfaces/IClient.ts:74-77` (GeminiSessionConfig interface)

- [ ] **Step 1: Add VAD fields to GeminiSettings interface**

In `src/stores/settingsStore.ts`, add 5 fields after `maxTokens` in the `GeminiSettings` interface:

```typescript
// Gemini Settings
export interface GeminiSettings {
  apiKey: string;
  model: string;
  voice: string;
  sourceLanguage: string;
  targetLanguage: string;
  temperature: number;
  maxTokens: number | 'inf';
  vadEnabled: boolean;
  vadStartSensitivity: 'high' | 'low';
  vadEndSensitivity: 'high' | 'low';
  vadSilenceDurationMs: number;
  vadPrefixPaddingMs: number;
}
```

- [ ] **Step 2: Add default values to defaultGeminiSettings**

In `src/stores/settingsStore.ts`, add defaults after `maxTokens: 'inf'`:

```typescript
const defaultGeminiSettings: GeminiSettings = {
  apiKey: '',
  model: '',
  voice: 'Aoede',
  sourceLanguage: 'en-US',
  targetLanguage: 'ja-JP',
  temperature: 0.8,
  maxTokens: 'inf',
  vadEnabled: true,
  vadStartSensitivity: 'low',
  vadEndSensitivity: 'high',
  vadSilenceDurationMs: 500,
  vadPrefixPaddingMs: 300,
};
```

- [ ] **Step 3: Add VAD fields to GeminiSessionConfig interface**

In `src/services/interfaces/IClient.ts`, replace the placeholder comment in `GeminiSessionConfig`:

```typescript
/**
 * Gemini-specific session configuration
 */
export interface GeminiSessionConfig extends BaseSessionConfig {
  provider: 'gemini';
  vadEnabled: boolean;
  vadStartSensitivity: 'high' | 'low';
  vadEndSensitivity: 'high' | 'low';
  vadSilenceDurationMs: number;
  vadPrefixPaddingMs: number;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Errors in `settingsStore.ts` at `createGeminiSessionConfig` (missing new fields) and possibly in `GeminiClient.ts`. These will be fixed in Tasks 2 and 3.

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts src/services/interfaces/IClient.ts
git commit -m "feat(gemini): add VAD fields to GeminiSettings and GeminiSessionConfig interfaces"
```

---

### Task 2: Update createGeminiSessionConfig to pass VAD fields

**Files:**
- Modify: `src/stores/settingsStore.ts:404-416` (createGeminiSessionConfig function)

- [ ] **Step 1: Update createGeminiSessionConfig to include VAD fields**

In `src/stores/settingsStore.ts`, update the function to pass through the new fields:

```typescript
function createGeminiSessionConfig(
  settings: GeminiSettings,
  systemInstructions: string
): GeminiSessionConfig {
  return {
    provider: 'gemini',
    model: settings.model,
    voice: settings.voice,
    instructions: systemInstructions,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    vadEnabled: settings.vadEnabled,
    vadStartSensitivity: settings.vadStartSensitivity,
    vadEndSensitivity: settings.vadEndSensitivity,
    vadSilenceDurationMs: settings.vadSilenceDurationMs,
    vadPrefixPaddingMs: settings.vadPrefixPaddingMs,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors in `settingsStore.ts`. May still have errors in `GeminiClient.ts` (fixed in Task 3).

- [ ] **Step 3: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(gemini): pass VAD settings through createGeminiSessionConfig"
```

---

### Task 3: Update GeminiClient.connect() to use VAD config

**Files:**
- Modify: `src/services/clients/GeminiClient.ts:1` (imports)
- Modify: `src/services/clients/GeminiClient.ts:288-320` (connect method)

- [ ] **Step 1: Add StartSensitivity and EndSensitivity to imports**

In `src/services/clients/GeminiClient.ts` line 1, add the two enums to the import:

```typescript
import { ActivityHandling, EndSensitivity, GoogleGenAI, LiveConnectConfig, LiveServerContent, LiveServerMessage, Modality, Session, StartSensitivity } from '@google/genai';
```

- [ ] **Step 2: Add isGeminiSessionConfig import**

In `src/services/clients/GeminiClient.ts` line 2, add `isGeminiSessionConfig` to the import:

```typescript
import { IClient, ConversationItem, SessionConfig, ClientEventHandlers, ApiKeyValidationResult, FilteredModel, IClientStatic, ResponseConfig, isGeminiSessionConfig } from '../interfaces/IClient';
```

- [ ] **Step 3: Update connect() to build automaticActivityDetection from config**

In `src/services/clients/GeminiClient.ts`, replace the `realtimeInputConfig` block in the `connect()` method (lines 317-319). The config needs to be narrowed to `GeminiSessionConfig` first to access VAD fields:

```typescript
    // Build realtimeInputConfig with VAD settings
    const realtimeInputConfig: LiveConnectConfig['realtimeInputConfig'] = {
      activityHandling: ActivityHandling.NO_INTERRUPTION,
    };

    if (isGeminiSessionConfig(config)) {
      realtimeInputConfig.automaticActivityDetection = config.vadEnabled ? {
        disabled: false,
        startOfSpeechSensitivity: config.vadStartSensitivity === 'high'
          ? StartSensitivity.START_SENSITIVITY_HIGH
          : StartSensitivity.START_SENSITIVITY_LOW,
        endOfSpeechSensitivity: config.vadEndSensitivity === 'high'
          ? EndSensitivity.END_SENSITIVITY_HIGH
          : EndSensitivity.END_SENSITIVITY_LOW,
        silenceDurationMs: config.vadSilenceDurationMs,
        prefixPaddingMs: config.vadPrefixPaddingMs,
      } : {
        disabled: true,
      };
    }
```

Then update the `liveConfig` to use the variable instead of the inline object. Replace lines 317-319:

```typescript
      realtimeInputConfig,
```

The full `liveConfig` block should look like:

```typescript
    // Convert SessionConfig to LiveConnectConfig
    const liveConfig: LiveConnectConfig = {
      responseModalities,
      temperature: config.temperature,
      maxOutputTokens: typeof config.maxTokens === 'number' ? config.maxTokens : undefined,
      systemInstruction: config.instructions ? {
        parts: [{ text: config.instructions }]
      } : undefined,
      speechConfig: config.voice && !config.textOnly ? {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: config.voice
          }
        }
      } : undefined,
      inputAudioTranscription: {},
      outputAudioTranscription: {},  // Always enable for transcript in both normal and textOnly modes
      realtimeInputConfig,
    };
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/GeminiClient.ts
git commit -m "feat(gemini): build automaticActivityDetection from session config VAD fields"
```

---

### Task 4: Add i18n translation keys

**Files:**
- Modify: `src/locales/en/translation.json`

- [ ] **Step 1: Add Gemini VAD translation keys**

In `src/locales/en/translation.json`, add the following keys in the `settings` section. Place them near the existing `vadSettings` key (around line 216):

```json
    "geminiVad": "Voice Activity Detection",
    "geminiVadTooltip": "Controls how Gemini detects speech pauses to split turns. Adjusting these settings can improve translation responsiveness for continuous speech.",
    "geminiVadEnabled": "Enabled",
    "geminiVadDisabled": "Disabled",
    "startOfSpeechSensitivity": "Start of Speech Sensitivity",
    "startOfSpeechSensitivityTooltip": "How sensitive the detection is to speech starting. High sensitivity detects quieter or shorter speech onsets.",
    "endOfSpeechSensitivity": "End of Speech Sensitivity",
    "endOfSpeechSensitivityTooltip": "How sensitive the detection is to speech ending. High sensitivity splits turns at shorter pauses, producing more frequent translations.",
    "vadSilenceDuration": "Silence Duration",
    "vadSilenceDurationTooltip": "How long a silence must last before it triggers a turn split. Lower values produce faster translations but may split mid-sentence.",
    "vadPrefixPadding": "Prefix Padding",
    "vadPrefixPaddingTooltip": "Audio padding added before detected speech. Prevents the beginning of words from being cut off.",
    "sensitivityHigh": "High",
    "sensitivityLow": "Low",
```

- [ ] **Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/en/translation.json', 'utf8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add src/locales/en/translation.json
git commit -m "feat(gemini): add i18n keys for VAD configuration UI"
```

---

### Task 5: Add Gemini VAD settings UI in ProviderSpecificSettings

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx`

- [ ] **Step 1: Add renderGeminiVadSettings function**

In `src/components/Settings/sections/ProviderSpecificSettings.tsx`, add a new render function before `renderPalabraAISettings` (before line 697). This follows the same pattern as the LocalInference VAD section:

```tsx
  const renderGeminiVadSettings = () => {
    if (provider !== Provider.GEMINI) {
      return null;
    }

    return (
      <div className="settings-section" id="gemini-vad-section">
        <h2>
          {t('settings.geminiVad')}
          <Tooltip
            content={t('settings.geminiVadTooltip')}
            position="top"
          >
            <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
          </Tooltip>
        </h2>
        <div className="setting-item">
          <div className="turn-detection-options">
            <button
              className={`option-button ${geminiSettings.vadEnabled ? 'active' : ''}`}
              onClick={() => updateGeminiSettings({ vadEnabled: true })}
              disabled={isSessionActive}
            >
              {t('settings.geminiVadEnabled')}
            </button>
            <button
              className={`option-button ${!geminiSettings.vadEnabled ? 'active' : ''}`}
              onClick={() => updateGeminiSettings({ vadEnabled: false })}
              disabled={isSessionActive}
            >
              {t('settings.geminiVadDisabled')}
            </button>
          </div>
        </div>

        {geminiSettings.vadEnabled && (
          <>
            <div className="setting-item">
              <div className="setting-label">
                <span>
                  {t('settings.startOfSpeechSensitivity')}
                  <Tooltip
                    content={t('settings.startOfSpeechSensitivityTooltip')}
                    position="top"
                  >
                    <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                  </Tooltip>
                </span>
              </div>
              <div className="turn-detection-options">
                <button
                  className={`option-button ${geminiSettings.vadStartSensitivity === 'high' ? 'active' : ''}`}
                  onClick={() => updateGeminiSettings({ vadStartSensitivity: 'high' })}
                  disabled={isSessionActive}
                >
                  {t('settings.sensitivityHigh')}
                </button>
                <button
                  className={`option-button ${geminiSettings.vadStartSensitivity === 'low' ? 'active' : ''}`}
                  onClick={() => updateGeminiSettings({ vadStartSensitivity: 'low' })}
                  disabled={isSessionActive}
                >
                  {t('settings.sensitivityLow')}
                </button>
              </div>
            </div>

            <div className="setting-item">
              <div className="setting-label">
                <span>
                  {t('settings.endOfSpeechSensitivity')}
                  <Tooltip
                    content={t('settings.endOfSpeechSensitivityTooltip')}
                    position="top"
                  >
                    <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                  </Tooltip>
                </span>
              </div>
              <div className="turn-detection-options">
                <button
                  className={`option-button ${geminiSettings.vadEndSensitivity === 'high' ? 'active' : ''}`}
                  onClick={() => updateGeminiSettings({ vadEndSensitivity: 'high' })}
                  disabled={isSessionActive}
                >
                  {t('settings.sensitivityHigh')}
                </button>
                <button
                  className={`option-button ${geminiSettings.vadEndSensitivity === 'low' ? 'active' : ''}`}
                  onClick={() => updateGeminiSettings({ vadEndSensitivity: 'low' })}
                  disabled={isSessionActive}
                >
                  {t('settings.sensitivityLow')}
                </button>
              </div>
            </div>

            <div className="setting-item">
              <div className="setting-label">
                <span>
                  {t('settings.vadSilenceDuration')}
                  <Tooltip
                    content={t('settings.vadSilenceDurationTooltip')}
                    position="top"
                  >
                    <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                  </Tooltip>
                </span>
                <span className="setting-value">{geminiSettings.vadSilenceDurationMs}ms</span>
              </div>
              <input
                type="range"
                min="100"
                max="3000"
                step="50"
                value={geminiSettings.vadSilenceDurationMs}
                onChange={(e) => updateGeminiSettings({ vadSilenceDurationMs: parseInt(e.target.value) })}
                className="slider"
                disabled={isSessionActive}
              />
            </div>

            <div className="setting-item">
              <div className="setting-label">
                <span>
                  {t('settings.vadPrefixPadding')}
                  <Tooltip
                    content={t('settings.vadPrefixPaddingTooltip')}
                    position="top"
                  >
                    <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                  </Tooltip>
                </span>
                <span className="setting-value">{geminiSettings.vadPrefixPaddingMs}ms</span>
              </div>
              <input
                type="range"
                min="0"
                max="2000"
                step="50"
                value={geminiSettings.vadPrefixPaddingMs}
                onChange={(e) => updateGeminiSettings({ vadPrefixPaddingMs: parseInt(e.target.value) })}
                className="slider"
                disabled={isSessionActive}
              />
            </div>
          </>
        )}
      </div>
    );
  };
```

- [ ] **Step 2: Add renderGeminiVadSettings to the component return**

In `src/components/Settings/sections/ProviderSpecificSettings.tsx`, add `{renderGeminiVadSettings()}` in the return block, after `{renderModelConfigurationSettings()}` (line 1445) and before `{renderPalabraAISettings()}` (line 1446):

```tsx
      {renderModelConfigurationSettings()}
      {renderGeminiVadSettings()}
      {renderPalabraAISettings()}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Verify dev server runs**

Run: `npm run dev` (check that it starts without errors, then stop it)
Expected: Vite dev server starts successfully.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx
git commit -m "feat(gemini): add VAD configuration UI in provider settings"
```

---

### Task 6: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run existing tests**

Run: `npm run test -- --run`
Expected: All tests pass. No regressions.

- [ ] **Step 3: Visual check (manual)**

1. Run `npm run dev`
2. Open browser, select Gemini provider
3. Verify VAD section appears with:
   - Enabled/Disabled toggle (default: Enabled)
   - Start of Speech Sensitivity buttons (default: Low)
   - End of Speech Sensitivity buttons (default: High)
   - Silence Duration slider (default: 500ms, range: 100-3000ms)
   - Prefix Padding slider (default: 300ms, range: 0-2000ms)
4. Verify: toggling Disabled hides the sub-controls
5. Verify: all controls are disabled during active session
