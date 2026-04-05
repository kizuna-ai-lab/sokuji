# Gemini VAD Configuration Design

**Issue**: [#171 — Long continuous speech causes delayed translation with Gemini provider](https://github.com/kizuna-ai-lab/sokuji/issues/171)

**Problem**: `GeminiClient` hardcodes `ActivityHandling.NO_INTERRUPTION` with no `automaticActivityDetection` config, so Gemini treats all continuous speech as a single turn. Translation only fires on `turnComplete`, causing long delays.

**Solution**: Expose all `AutomaticActivityDetection` parameters as user-configurable Gemini settings, with defaults tuned for faster turn splitting.

## Changes

### 1. Data Layer — `settingsStore.ts`

Add fields to `GeminiSettings` interface:

```typescript
export interface GeminiSettings {
  // ... existing fields (apiKey, model, voice, sourceLanguage, targetLanguage, temperature, maxTokens) ...
  vadEnabled: boolean;
  vadStartSensitivity: 'high' | 'low';
  vadEndSensitivity: 'high' | 'low';
  vadSilenceDurationMs: number;
  vadPrefixPaddingMs: number;
}
```

Default values in `defaultGeminiSettings`:

```typescript
vadEnabled: true,
vadStartSensitivity: 'low',    // SDK default
vadEndSensitivity: 'high',     // more aggressive end-of-speech detection (SDK default is low)
vadSilenceDurationMs: 500,     // 500ms silence triggers turn split
vadPrefixPaddingMs: 300,       // 300ms padding before detected speech
```

The key change from current behavior: `vadEndSensitivity: 'high'` + `vadSilenceDurationMs: 500` means natural pauses will trigger turn completion much sooner than the current `NO_INTERRUPTION` setup.

### 2. Session Config — `IClient.ts` + `settingsStore.ts`

Extend `GeminiSessionConfig`:

```typescript
export interface GeminiSessionConfig extends BaseSessionConfig {
  provider: 'gemini';
  vadEnabled: boolean;
  vadStartSensitivity: 'high' | 'low';
  vadEndSensitivity: 'high' | 'low';
  vadSilenceDurationMs: number;
  vadPrefixPaddingMs: number;
}
```

Update `createGeminiSessionConfig` to pass through VAD fields from settings.

### 3. Client Layer — `GeminiClient.ts`

In `connect()`, build `automaticActivityDetection` from config:

```typescript
import { StartSensitivity, EndSensitivity } from '@google/genai';

realtimeInputConfig: {
  activityHandling: ActivityHandling.NO_INTERRUPTION,  // keep hardcoded
  automaticActivityDetection: config.vadEnabled ? {
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
  },
}
```

`activityHandling` stays `NO_INTERRUPTION` — not exposed to users. VAD controls when turns split, not whether the model response gets interrupted.

### 4. UI Layer — `ProviderSpecificSettings.tsx`

Add a Gemini-specific VAD section, rendered when `provider === Provider.GEMINI`. Follows the same visual pattern as LocalInference VAD controls:

- **VAD Enabled** — toggle (disabled during active session)
- **Start of Speech Sensitivity** — two buttons: High / Low
- **End of Speech Sensitivity** — two buttons: High / Low
- **Silence Duration** — slider, range 100-3000ms, step 50ms, display in ms
- **Prefix Padding** — slider, range 0-2000ms, step 50ms, display in ms

All VAD sub-controls are hidden when VAD is disabled. All controls are disabled during active session.

### 5. i18n

Add translation keys to `en/translation.json` (other languages use English fallback):

- `settings.geminiVad` — "Voice Activity Detection"
- `settings.geminiVadTooltip` — tooltip explaining what VAD does for Gemini
- `settings.geminiVadEnabled` — "Enabled"
- `settings.geminiVadDisabled` — "Disabled"
- `settings.startOfSpeechSensitivity` — "Start of Speech Sensitivity"
- `settings.startOfSpeechSensitivityTooltip` — tooltip
- `settings.endOfSpeechSensitivity` — "End of Speech Sensitivity"
- `settings.endOfSpeechSensitivityTooltip` — tooltip
- `settings.vadSilenceDuration` — "Silence Duration"
- `settings.vadSilenceDurationTooltip` — tooltip
- `settings.vadPrefixPadding` — "Prefix Padding"
- `settings.vadPrefixPaddingTooltip` — tooltip
- `settings.sensitivityHigh` — "High"
- `settings.sensitivityLow` — "Low"

### Files to Modify

1. `src/stores/settingsStore.ts` — GeminiSettings interface, defaults, createGeminiSessionConfig
2. `src/services/interfaces/IClient.ts` — GeminiSessionConfig interface
3. `src/services/clients/GeminiClient.ts` — connect() method, import enums
4. `src/components/Settings/sections/ProviderSpecificSettings.tsx` — Gemini VAD UI section
5. `src/locales/en/translation.json` — i18n keys

### No Changes Needed

- `activityHandling` — stays hardcoded as `NO_INTERRUPTION`
- `MainPanel.tsx` — Gemini doesn't use client-side turn detection; no push-to-talk logic needed
- Other providers — no cross-provider impact
