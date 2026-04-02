# Local Inference Participant Mode Fix

## Problem

When the local inference provider is used with participant mode (system audio capture), participant transcription and translation are broken due to several P0 bugs:

1. **Missing language swap**: `createParticipantSessionConfig()` in MainPanel.tsx does not swap `sourceLanguage`/`targetLanguage` for `local_inference`, so ASR recognizes the wrong language and translation goes in the wrong direction.
2. **Translation model not re-resolved**: Even after swapping languages, the `translationModelId` from the base config still points to the forward-direction model (e.g., `opus-mt-ja-en` instead of `opus-mt-en-ja`).
3. **No pre-start validation**: `isProviderReady()` only checks forward-direction models. Participant session can fail silently at runtime when reverse-direction models are missing.
4. **Silent failure**: Participant init errors are caught and logged to console only. Users see no indication that participant is not working.

## Design Decisions

- **Graceful degradation (not blocking)**: If ASR is available but translation model is missing, participant runs ASR-only (transcription without translation). If ASR is also unavailable, participant is skipped entirely.
- **Auto-select with fallback**: If the user's chosen ASR model doesn't support the participant language, auto-select an alternative from downloaded models. If none found, skip participant.
- **UI display in settings**: Show current model selections in the ProviderSection when local_inference is selected. Show participant model status when system audio is enabled. No toast — information lives in the settings panel.
- **No new user-configurable fields**: Participant models are auto-selected for now. Users see what was selected but don't configure it separately.

## Architecture

Three layers, matching existing codebase patterns:

### Layer 1: Config (`settingsStore.ts`)

New helper function alongside existing `createLocalInferenceSessionConfig()`:

```typescript
function createParticipantLocalInferenceConfig(
  baseConfig: LocalInferenceSessionConfig,
  settings: LocalInferenceSettings
): LocalInferenceSessionConfig & { participantStatus: ParticipantModelStatus }
```

Steps:
1. Swap `sourceLanguage` and `targetLanguage`
2. Check if `baseConfig.asrModelId` supports the new source language (via manifest `languages` array)
   - Yes: keep it
   - No: call `getAsrModelsForLanguage(newSourceLang)`, find first downloaded model → use it, set `asrFallback: true`
   - None found: return `null` (participant will be skipped entirely)
3. Call `getTranslationModel(newSrc, newTgt)` for reverse-direction translation model
   - Found + downloaded: use it
   - Not found or not downloaded: set `translationModelId` to `undefined`
4. Set `ttsModelId` to `undefined` (participant is text-only)
5. Return config + `participantStatus` metadata

```typescript
interface ParticipantModelStatus {
  asrAvailable: boolean;
  asrModelId: string | null;
  asrFallback: boolean;         // true if auto-selected a different model
  asrOriginalModelId: string;   // what user had configured
  translationAvailable: boolean;
  translationModelId: string | null;
}
```

### Layer 2: Validation (`modelStore.ts`)

New function on the model store:

```typescript
getParticipantModelStatus: (
  sourceLang: string,       // user's source language (becomes participant's target)
  targetLang: string,       // user's target language (becomes participant's source)
  currentAsrModelId: string
) => ParticipantModelStatus
```

This function is used by:
- Config layer (to build participant config)
- UI layer (to display model status in settings)

It checks:
1. Whether `currentAsrModelId` supports `targetLang` and is downloaded
2. If not, whether any downloaded ASR model supports `targetLang`
3. Whether a translation model exists and is downloaded for `targetLang → sourceLang`

### Layer 3: MainPanel + UI

#### MainPanel.tsx — `createParticipantSessionConfig()`

Add `local_inference` branch:

```typescript
} else if (config.provider === 'local_inference') {
  const localConfig = config as LocalInferenceSessionConfig;
  const participantResult = createParticipantLocalInferenceConfig(localConfig, settings);

  if (!participantResult.participantStatus.asrAvailable) {
    // Log error, skip participant entirely
    addLog('error', 'Participant: No ASR model available for [targetLang]');
    return null;  // caller checks for null and skips participant
  }

  if (!participantResult.participantStatus.translationAvailable) {
    // Log warning, will run ASR-only
    addLog('warn', 'Participant: No translation model for [targetLang→sourceLang], transcription only');
  }

  if (participantResult.participantStatus.asrFallback) {
    addLog('info', 'Participant: Using [fallbackModel] instead of [originalModel] for ASR');
  }

  return participantResult;
}
```

The caller in `startSession()` must handle `null` return (skip participant setup). Currently `createParticipantSessionConfig()` always returns a config object. Change its return type to `SessionConfig | null` and add a null check before `participantClient.connect()`. When null, log the reason and continue the main session without participant.

#### LocalInferenceClient.ts — handle missing translation

When `translationModelId` is `undefined`:
- Skip translation engine initialization
- In the ASR result handler, emit conversation items with transcription text only (no translation)
- The existing `onConversationItemCreated` handler already supports items without translation

#### ProviderSection.tsx — model info display

When `provider === 'local_inference'`, replace the current "No API key required" message with:

```
Provider: Local (Offline)
No API key required

Models:
  ASR: sensevoice-int8
  Translation: opus-mt-ja-en
  TTS: piper-en

Participant (en → ja):     ← only shown when system audio capture is enabled
  ASR: sensevoice-int8 ✓
  Translation: opus-mt-en-ja ✓
  // or: ⚠ No translation model for en → ja
  // or: ⚠ No ASR model available for en
```

The component reads from `modelStore.getParticipantModelStatus()` and `useAudioContext().isSystemAudioCaptureEnabled` to decide what to show.

#### Section title rename

Change the ProviderSection heading from `simpleSettings.apiKey` ("API Key") to a new i18n key `simpleSettings.provider` ("Provider"). Update all 35+ translation files.

## Files to Modify

| File | Changes |
|------|---------|
| `src/stores/settingsStore.ts` | Add `createParticipantLocalInferenceConfig()`, export `ParticipantModelStatus` type |
| `src/stores/modelStore.ts` | Add `getParticipantModelStatus()` |
| `src/components/MainPanel/MainPanel.tsx` | Add `local_inference` branch in `createParticipantSessionConfig()`, handle null return |
| `src/services/clients/LocalInferenceClient.ts` | Handle `undefined` translationModelId (skip translation init, ASR-only mode) |
| `src/components/Settings/sections/ProviderSection.tsx` | Show model info for local_inference, show participant model status |
| `src/locales/*/translation.json` (35+ files) | Rename `simpleSettings.apiKey` → `simpleSettings.provider`, add model info strings |

## Files NOT Modified

- `LocalInferenceSessionConfig` interface — `translationModelId` is already optional (`string | undefined`)
- `AsrEngine`, `TranslationEngine` — no changes needed, they already handle init parameters correctly
- `SimpleSettings.tsx`, `AdvancedSettings.tsx` — ProviderSection is already rendered in both; no structural changes needed

## Testing

- Unit test: `createParticipantLocalInferenceConfig()` with various model availability scenarios
- Unit test: `getParticipantModelStatus()` with downloaded/not-downloaded/language-incompatible models
- Manual test: Start session with local_inference + system audio capture with:
  - Both reverse models available → participant works with transcription + translation
  - Only reverse ASR available → participant shows transcription only
  - No reverse ASR available → participant skipped, log shows error
- Manual test: Settings UI shows correct model info and participant status
