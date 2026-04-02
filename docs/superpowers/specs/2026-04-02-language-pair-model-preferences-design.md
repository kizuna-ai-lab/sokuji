# Language-Pair Model Preferences

## Problem

When users switch language pairs (e.g., ja→en to en→ja), the auto-select logic picks the "best" available model, discarding the user's previous manual selection. Users who have specific model preferences per language pair lose them on every switch. This also affects participant mode — users have no way to control which models are used for the reverse direction.

## Design Decisions

- **In-memory only**: Preferences stored in Zustand modelStore state, not persisted to storage. Lost on refresh/restart.
- **Directional key**: `"ja→en"` and `"en→ja"` are separate entries (translation models are directional).
- **All three models**: ASR, Translation, TTS are all remembered per pair.
- **User hint in UI**: Participant area shows a text hint explaining how to control participant models.

## Architecture

### Data Structure (modelStore.ts)

```typescript
// New state field
modelPreferences: Record<string, { asrModel: string; translationModel: string; ttsModel: string }>;

// New methods
rememberModels: (sourceLang: string, targetLang: string, asrModel: string, translationModel: string, ttsModel: string) => void;
recallModels: (sourceLang: string, targetLang: string) => { asrModel: string; translationModel: string; ttsModel: string } | null;
```

Key format: `"${sourceLang}→${targetLang}"` (e.g., `"ja→en"`)

### rememberModels

Saves the current model selection for a language pair. Called:

1. **User manually selects a model** in ModelManagementSection (model card click handlers for ASR, Translation, TTS)
2. **autoSelectModels completes** — after auto-correction, save the result so recall can use it next time

Implementation: simple map set.

```typescript
rememberModels: (src, tgt, asr, translation, tts) => {
  set(state => ({
    modelPreferences: {
      ...state.modelPreferences,
      [`${src}→${tgt}`]: { asrModel: asr, translationModel: translation, ttsModel: tts },
    },
  }));
},
```

### recallModels

Returns saved preferences for a language pair. Each field is independently validated against download status — fields where the model was deleted fall back to empty string (auto-select will fill them). Returns null only if no record exists at all.

```typescript
recallModels: (src, tgt) => {
  const { modelPreferences, modelStatuses } = get();
  const key = `${src}→${tgt}`;
  const pref = modelPreferences[key];
  if (!pref) return null;

  // Per-field degradation: each model independently checked
  return {
    asrModel: pref.asrModel && modelStatuses[pref.asrModel] === 'downloaded' ? pref.asrModel : '',
    translationModel: pref.translationModel && modelStatuses[pref.translationModel] === 'downloaded' ? pref.translationModel : '',
    ttsModel: pref.ttsModel && modelStatuses[pref.ttsModel] === 'downloaded' ? pref.ttsModel : '',
  };
},
```

This means:
- Model still downloaded → use remembered value
- Model deleted → field returns `''`, autoSelectModels fills it with next best option
- Model re-downloaded later + user switches back → a new autoSelect run will pick it up and remember the new selection

### Integration: autoSelectModels

Modify the existing `autoSelectModels()` in modelStore to check recall first:

```
Before (current):
  1. Check if current model is compatible + downloaded
  2. If not, pick best available model

After:
  1. Check recallModels(src, tgt)
  2. If recall returns a result → use non-empty recalled fields as the "current" model
     (empty fields from recall mean that model was deleted, treat as needing auto-select)
  3. For each field: if recalled value is non-empty and valid → use it, else → auto-select
  4. After selection is finalized, call rememberModels with the final result
```

### Integration: getParticipantModelStatus

Modify existing function to check recall for reverse direction:

```
Before (current):
  1. Check if current model supports reverse direction
  2. If not, find first compatible downloaded model

After:
  1. Check recallModels(targetLang, sourceLang) for reverse pair
  2. If recall has ASR/translation → use those (validate compatibility)
  3. If no recall → fall through to current fallback logic
```

### Integration: ModelManagementSection

When user manually selects a model (clicks a model card), call `rememberModels` with current language pair + all three current model selections. This captures the user's explicit choice.

### UI: Participant hint in ProviderSection

In the participant model status area (below the participant divider), add a small hint text:

```
Participant (en → ja)
[ASR whisper-tiny-webgpu] [Translation qwen2.5-0.5b] 
Switch to en → ja to change participant models
```

The hint text uses `settings.participantModelHint` i18n key with `{source}` and `{target}` interpolation variables (the participant's direction, i.e., user's target → user's source).

## Files to Modify

| File | Changes |
|------|---------|
| `src/stores/modelStore.ts` | Add `modelPreferences` state, `rememberModels()`, `recallModels()`. Modify `autoSelectModels()` and `getParticipantModelStatus()` to use recall. |
| `src/components/Settings/sections/ModelManagementSection.tsx` | Call `rememberModels()` when user selects a model |
| `src/components/Settings/sections/ProviderSection.tsx` | Add participant hint text |
| `src/locales/en/translation.json` | Add `settings.participantModelHint` key |

## Files NOT Modified

- `settingsStore.ts` — no interface changes, no persistence changes
- `LocalInferenceClient.ts` — receives config as before, unaware of preferences
- `MainPanel.tsx` — unchanged, participant config flows through existing functions

## Testing

- Unit test: `rememberModels` + `recallModels` — save and retrieve
- Unit test: `recallModels` per-field degradation — delete one model, other fields still recalled
- Unit test: `recallModels` returns null when no record exists
- Unit test: `autoSelectModels` uses recalled models when available, auto-selects for empty fields
- Manual test: Select models for ja→en, switch to en→ja, switch back → ja→en models restored
- Manual test: Delete one remembered model (e.g. TTS) → that field auto-selects, others stay remembered
- Manual test: Participant area shows recalled reverse-direction models + hint text
