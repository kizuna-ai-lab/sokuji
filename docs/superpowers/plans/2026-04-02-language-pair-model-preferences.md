# Language-Pair Model Preferences — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remember model selections per language pair (in-memory) so switching languages restores previous choices, and participant mode uses recalled reverse-direction preferences.

**Architecture:** Add `modelPreferences` map + `rememberModels()`/`recallModels()` to modelStore, integrate into existing `autoSelectModels()` and `getParticipantModelStatus()`, call `rememberModels` from ModelManagementSection on model selection, add participant hint in ProviderSection.

**Tech Stack:** TypeScript, React, Zustand, Vitest, i18next

**Spec:** `docs/superpowers/specs/2026-04-02-language-pair-model-preferences-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/stores/modelStore.ts` | Add `modelPreferences` state, `rememberModels()`, `recallModels()`. Modify `autoSelectModels()` and `getParticipantModelStatus()`. |
| `src/stores/modelStore.test.ts` | Add tests for remember/recall + integration |
| `src/components/Settings/sections/ModelManagementSection.tsx` | Call `rememberModels()` on model selection + after auto-select |
| `src/components/Settings/sections/ProviderSection.tsx` | Add participant hint text |
| `src/locales/en/translation.json` | Add `settings.participantModelHint` key |

---

### Task 1: Add `rememberModels` and `recallModels` to modelStore

**Files:**
- Modify: `src/stores/modelStore.ts`
- Modify: `src/stores/modelStore.test.ts`

- [ ] **Step 1: Write tests for rememberModels + recallModels**

Append to `src/stores/modelStore.test.ts`:

```typescript
describe('rememberModels / recallModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset preferences
    useModelStore.setState({ modelPreferences: {} });
  });

  it('remembers and recalls models for a language pair', () => {
    useModelStore.setState({
      modelStatuses: {
        'sensevoice-int8': 'downloaded',
        'opus-mt-ja-en': 'downloaded',
        'piper-en': 'downloaded',
      },
    });

    useModelStore.getState().rememberModels('ja', 'en', 'sensevoice-int8', 'opus-mt-ja-en', 'piper-en');
    const recalled = useModelStore.getState().recallModels('ja', 'en');

    expect(recalled).toEqual({
      asrModel: 'sensevoice-int8',
      translationModel: 'opus-mt-ja-en',
      ttsModel: 'piper-en',
    });
  });

  it('returns null when no record exists', () => {
    const recalled = useModelStore.getState().recallModels('ja', 'en');
    expect(recalled).toBeNull();
  });

  it('treats different directions as separate keys', () => {
    useModelStore.setState({
      modelStatuses: {
        'sensevoice-int8': 'downloaded',
        'opus-mt-ja-en': 'downloaded',
        'opus-mt-en-ja': 'downloaded',
        'piper-en': 'downloaded',
        'piper-ja': 'downloaded',
      },
    });

    useModelStore.getState().rememberModels('ja', 'en', 'sensevoice-int8', 'opus-mt-ja-en', 'piper-en');
    useModelStore.getState().rememberModels('en', 'ja', 'sensevoice-int8', 'opus-mt-en-ja', 'piper-ja');

    const jaEn = useModelStore.getState().recallModels('ja', 'en');
    const enJa = useModelStore.getState().recallModels('en', 'ja');

    expect(jaEn!.translationModel).toBe('opus-mt-ja-en');
    expect(enJa!.translationModel).toBe('opus-mt-en-ja');
    expect(jaEn!.ttsModel).toBe('piper-en');
    expect(enJa!.ttsModel).toBe('piper-ja');
  });

  it('degrades per-field when a model is deleted', () => {
    useModelStore.setState({
      modelStatuses: {
        'sensevoice-int8': 'downloaded',
        'opus-mt-ja-en': 'downloaded',
        'piper-en': 'downloaded',
      },
    });

    useModelStore.getState().rememberModels('ja', 'en', 'sensevoice-int8', 'opus-mt-ja-en', 'piper-en');

    // Simulate TTS model deleted
    useModelStore.setState({
      modelStatuses: {
        'sensevoice-int8': 'downloaded',
        'opus-mt-ja-en': 'downloaded',
        'piper-en': 'not_downloaded',
      },
    });

    const recalled = useModelStore.getState().recallModels('ja', 'en');

    expect(recalled).not.toBeNull();
    expect(recalled!.asrModel).toBe('sensevoice-int8');
    expect(recalled!.translationModel).toBe('opus-mt-ja-en');
    expect(recalled!.ttsModel).toBe(''); // degraded
  });

  it('degrades all fields when all models deleted', () => {
    useModelStore.setState({
      modelStatuses: {
        'sensevoice-int8': 'downloaded',
        'opus-mt-ja-en': 'downloaded',
        'piper-en': 'downloaded',
      },
    });

    useModelStore.getState().rememberModels('ja', 'en', 'sensevoice-int8', 'opus-mt-ja-en', 'piper-en');

    // All deleted
    useModelStore.setState({
      modelStatuses: {
        'sensevoice-int8': 'not_downloaded',
        'opus-mt-ja-en': 'not_downloaded',
        'piper-en': 'not_downloaded',
      },
    });

    const recalled = useModelStore.getState().recallModels('ja', 'en');
    expect(recalled).not.toBeNull();
    expect(recalled!.asrModel).toBe('');
    expect(recalled!.translationModel).toBe('');
    expect(recalled!.ttsModel).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/stores/modelStore.test.ts`
Expected: FAIL — `rememberModels` / `recallModels` not functions

- [ ] **Step 3: Implement rememberModels and recallModels**

In `src/stores/modelStore.ts`, add to the `ModelStoreState` interface (after `autoSelectModels` declaration, around line 101):

```typescript
  /** In-memory model preferences per language pair (key: "src→tgt") */
  modelPreferences: Record<string, { asrModel: string; translationModel: string; ttsModel: string }>;
  /** Save model selection for a language pair */
  rememberModels: (sourceLang: string, targetLang: string, asrModel: string, translationModel: string, ttsModel: string) => void;
  /** Recall saved model selection — per-field degradation if models deleted */
  recallModels: (sourceLang: string, targetLang: string) => { asrModel: string; translationModel: string; ttsModel: string } | null;
```

Add initial state value (inside `subscribeWithSelector((set, get) => ({`, after `modelVariants: {},`):

```typescript
    modelPreferences: {},
```

Add implementations (after the `autoSelectModels` function body, before `})),`):

```typescript
    rememberModels: (src, tgt, asr, translation, tts) => {
      set(state => ({
        modelPreferences: {
          ...state.modelPreferences,
          [`${src}→${tgt}`]: { asrModel: asr, translationModel: translation, ttsModel: tts },
        },
      }));
    },

    recallModels: (src, tgt) => {
      const { modelPreferences, modelStatuses } = get();
      const key = `${src}→${tgt}`;
      const pref = modelPreferences[key];
      if (!pref) return null;

      return {
        asrModel: pref.asrModel && modelStatuses[pref.asrModel] === 'downloaded' ? pref.asrModel : '',
        translationModel: pref.translationModel && modelStatuses[pref.translationModel] === 'downloaded' ? pref.translationModel : '',
        ttsModel: pref.ttsModel && modelStatuses[pref.ttsModel] === 'downloaded' ? pref.ttsModel : '',
      };
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/stores/modelStore.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/modelStore.ts src/stores/modelStore.test.ts
git commit -m "feat(local-inference): add rememberModels/recallModels for language-pair preferences"
```

---

### Task 2: Integrate recall into autoSelectModels

**Files:**
- Modify: `src/stores/modelStore.ts`

- [ ] **Step 1: Modify autoSelectModels to check recall first**

Find the `autoSelectModels` function (around line 390). At the very beginning, after `const updates = ...`, add recall logic:

```typescript
    autoSelectModels: (sourceLang, targetLang, currentAsrModel, currentTranslationModel, currentTtsModel) => {
      const { modelStatuses, webgpuAvailable } = get();
      const updates: { asrModel?: string; translationModel?: string; ttsModel?: string } = {};

      // Check recalled preferences — override "current" with recalled values if available
      const recalled = get().recallModels(sourceLang, targetLang);
      if (recalled) {
        if (recalled.asrModel && recalled.asrModel !== currentAsrModel) currentAsrModel = recalled.asrModel;
        if (recalled.translationModel && recalled.translationModel !== currentTranslationModel) currentTranslationModel = recalled.translationModel;
        if (recalled.ttsModel && recalled.ttsModel !== currentTtsModel) currentTtsModel = recalled.ttsModel;
      }
```

Note: `currentAsrModel`, `currentTranslationModel`, `currentTtsModel` are function parameters, so reassigning them is safe (shadows the arguments for the rest of the function).

- [ ] **Step 2: Add rememberModels call at the end of autoSelectModels**

Find the `return` statement at the end of `autoSelectModels` (around line 444):

```typescript
      return Object.keys(updates).length > 0 ? updates : null;
```

Add rememberModels call just before the return. The final selection is: for each field, if `updates` has a new value use that, otherwise the current value was already OK:

```typescript
      // Remember the final selection for this language pair
      const finalAsr = updates.asrModel ?? currentAsrModel;
      const finalTranslation = updates.translationModel ?? currentTranslationModel;
      const finalTts = updates.ttsModel ?? currentTtsModel;
      if (finalAsr) {
        get().rememberModels(sourceLang, targetLang, finalAsr, finalTranslation, finalTts);
      }

      return Object.keys(updates).length > 0 ? updates : null;
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit 2>&1 | grep modelStore`
Expected: No new errors in modelStore.ts

- [ ] **Step 4: Run tests**

Run: `npm run test -- src/stores/modelStore.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/modelStore.ts
git commit -m "feat(local-inference): integrate recall into autoSelectModels"
```

---

### Task 3: Integrate recall into getParticipantModelStatus

**Files:**
- Modify: `src/stores/modelStore.ts`

- [ ] **Step 1: Add recall check at the start of getParticipantModelStatus**

Find `getParticipantModelStatus` (around line 325). After the language reversal lines, add recall:

```typescript
    getParticipantModelStatus: (sourceLang: string, targetLang: string, currentAsrModelId: string, currentTranslationModelId?: string): ParticipantModelStatus => {
      const { modelStatuses, webgpuAvailable } = get();

      // Participant reverses direction: participant source = user's target
      const participantSourceLang = targetLang;
      const participantTargetLang = sourceLang;

      // Check recalled preferences for the reverse direction
      const recalled = get().recallModels(participantSourceLang, participantTargetLang);
```

Then modify the ASR section — check recalled ASR first, before checking current model:

Replace the current ASR block (from `let asrModelId` through the closing `}` of the else block) with:

```typescript
      // 1. ASR: prefer recalled > current model > fallback
      let asrModelId: string | null = null;
      let asrFallback = false;

      const allAsrModels = [...getManifestByType('asr'), ...getManifestByType('asr-stream')];

      // Try recalled ASR first
      if (recalled?.asrModel) {
        const recalledAsr = allAsrModels.find(m => m.id === recalled.asrModel);
        if (recalledAsr
          && (recalledAsr.multilingual || recalledAsr.languages.includes(participantSourceLang))
          && modelStatuses[recalled.asrModel] === 'downloaded'
          && !(recalledAsr.requiredDevice === 'webgpu' && !webgpuAvailable)) {
          asrModelId = recalled.asrModel;
          asrFallback = recalled.asrModel !== currentAsrModelId;
        }
      }

      // Try current model
      if (!asrModelId) {
        const currentAsr = allAsrModels.find(m => m.id === currentAsrModelId);
        const currentAsrOk = currentAsr
          && (currentAsr.multilingual || currentAsr.languages.includes(participantSourceLang))
          && modelStatuses[currentAsrModelId] === 'downloaded'
          && !(currentAsr.requiredDevice === 'webgpu' && !webgpuAvailable);

        if (currentAsrOk) {
          asrModelId = currentAsrModelId;
        } else {
          // Fallback: first compatible downloaded model
          const match = allAsrModels.find(m =>
            (m.multilingual || m.languages.includes(participantSourceLang))
            && modelStatuses[m.id] === 'downloaded'
            && !(m.requiredDevice === 'webgpu' && !webgpuAvailable)
          );
          if (match) {
            asrModelId = match.id;
            asrFallback = true;
          }
        }
      }
```

Then modify the translation section — check recalled translation first:

Replace the current translation block with:

```typescript
      // 2. Translation: prefer recalled > current model > fallback
      let translationModelId: string | null = null;

      // Try recalled translation first
      if (recalled?.translationModel) {
        const recalledEntry = getManifestEntry(recalled.translationModel);
        if (recalledEntry
          && isTranslationModelCompatible(recalledEntry, participantSourceLang, participantTargetLang)
          && modelStatuses[recalled.translationModel] === 'downloaded'
          && !(recalledEntry.requiredDevice === 'webgpu' && !webgpuAvailable)) {
          translationModelId = recalled.translationModel;
        }
      }

      // Try current model
      if (!translationModelId && currentTranslationModelId && modelStatuses[currentTranslationModelId] === 'downloaded') {
        const currentEntry = getManifestEntry(currentTranslationModelId);
        if (currentEntry
          && isTranslationModelCompatible(currentEntry, participantSourceLang, participantTargetLang)
          && !(currentEntry.requiredDevice === 'webgpu' && !webgpuAvailable)) {
          translationModelId = currentTranslationModelId;
        }
      }

      // Fallback
      if (!translationModelId) {
        const match = getManifestByType('translation').find(m =>
          isTranslationModelCompatible(m, participantSourceLang, participantTargetLang)
          && modelStatuses[m.id] === 'downloaded'
          && !(m.requiredDevice === 'webgpu' && !webgpuAvailable)
        );
        if (match) {
          translationModelId = match.id;
        }
      }
```

- [ ] **Step 2: Run tests**

Run: `npm run test -- src/stores/modelStore.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit 2>&1 | grep modelStore`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/stores/modelStore.ts
git commit -m "feat(local-inference): integrate recall into getParticipantModelStatus"
```

---

### Task 4: Call rememberModels from ModelManagementSection

**Files:**
- Modify: `src/components/Settings/sections/ModelManagementSection.tsx`

- [ ] **Step 1: Import rememberModels from modelStore**

At the top of ModelManagementSection.tsx, find the existing import from `modelStore` (line with `useModelStatuses`). Add `useModelStore` if not already imported:

```typescript
import { useModelStore } from '../../../stores/modelStore';
```

Check if `useModelStore` is already imported — if so, skip this step.

- [ ] **Step 2: Add rememberModels call after auto-select useEffect**

Find the auto-select useEffect (around line 333-393) that calls `onUpdateSettings(updates)`. After that call, add a rememberModels call. Find:

```typescript
    if (Object.keys(updates).length > 0) {
      onUpdateSettings(updates);
    }
```

Replace with:

```typescript
    if (Object.keys(updates).length > 0) {
      onUpdateSettings(updates);
    }

    // Remember the final model selection for this language pair
    const finalAsr = updates.asrModel ?? asrModel;
    const finalTranslation = updates.translationModel ?? translationModel;
    const finalTts = updates.ttsModel ?? ttsModel;
    if (finalAsr) {
      useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, finalAsr, finalTranslation, finalTts);
    }
```

- [ ] **Step 3: Add rememberModels call on manual model selection**

Find the three `onUpdateSettings` calls for manual model card clicks:

Line ~553: `(id) => onUpdateSettings({ asrModel: id })`
Line ~608: `(id) => onUpdateSettings({ translationModel: id })`
Line ~673: `(id) => onUpdateSettings({ ttsModel: id })`

These are passed as `onSelect` callbacks to `renderSubGroups`. We need to also call `rememberModels` when the user picks a model. The cleanest way is to wrap each callback.

Replace line ~553:
```typescript
            (id) => {
              onUpdateSettings({ asrModel: id });
              useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, id, translationModel, ttsModel);
            },
```

Replace line ~608:
```typescript
            (id) => {
              onUpdateSettings({ translationModel: id });
              useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, asrModel, id, ttsModel);
            },
```

Replace line ~673:
```typescript
            (id) => {
              onUpdateSettings({ ttsModel: id });
              useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, asrModel, translationModel, id);
            },
```

Also check for `onSelect={() => onUpdateSettings({ asrModel: entry.id })}` style inline calls (lines ~587, ~649, ~707) and wrap those similarly:

Line ~587:
```typescript
                onSelect={() => {
                  onUpdateSettings({ asrModel: entry.id });
                  useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, entry.id, translationModel, ttsModel);
                }}
```

Line ~649:
```typescript
                onSelect={() => {
                  onUpdateSettings({ translationModel: entry.id });
                  useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, asrModel, entry.id, ttsModel);
                }}
```

Line ~707:
```typescript
                onSelect={() => {
                  onUpdateSettings({ ttsModel: entry.id });
                  useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, asrModel, translationModel, entry.id);
                }}
```

- [ ] **Step 4: Run build**

Run: `npm run build 2>&1 | grep -i error | head -5`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/ModelManagementSection.tsx
git commit -m "feat(local-inference): call rememberModels on model selection and auto-select"
```

---

### Task 5: Add participant hint in ProviderSection + i18n

**Files:**
- Modify: `src/components/Settings/sections/ProviderSection.tsx`
- Modify: `src/components/Settings/Settings.scss`
- Modify: `src/locales/en/translation.json`

- [ ] **Step 1: Add i18n key**

In `src/locales/en/translation.json`, find the `settings` section where `helpDiscussionsTooltip` was added. Add nearby:

```json
    "participantModelHint": "Switch to {{source}} → {{target}} to change participant models",
```

- [ ] **Step 2: Add hint text to ProviderSection**

In `src/components/Settings/sections/ProviderSection.tsx`, find the participant section closing (after the two model chips, around line 477 where `</div>` closes `.participant-inline`):

```tsx
              </div>
            )}
```

Add the hint text just before the closing `</div>` of `.participant-inline`:

```tsx
                <span className="participant-hint">
                  {t('settings.participantModelHint', 'Switch to {{source}} → {{target}} to change participant models', {
                    source: localInferenceSettings.targetLanguage,
                    target: localInferenceSettings.sourceLanguage,
                  })}
                </span>
              </div>
            )}
```

- [ ] **Step 3: Add CSS for hint text**

In `src/components/Settings/Settings.scss`, find the `.local-inference-info` block. Add inside it:

```scss
  .participant-hint {
    display: block;
    margin-top: 4px;
    font-size: 10px;
    color: vars.$text-muted;
    font-style: italic;
  }
```

- [ ] **Step 4: Run build and verify**

Run: `npm run build 2>&1 | grep -i error | head -5`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/ProviderSection.tsx src/components/Settings/Settings.scss src/locales/en/translation.json
git commit -m "feat(settings): add participant model hint in ProviderSection"
```

---

### Task 6: Integration verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

```bash
npm run test
```

Expected: All tests pass.

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

Expected: No new type errors.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Manual smoke test**

1. `npm run dev` → select Local (Offline) provider
2. Set ja→en, select specific models (e.g. whisper-large, opus-mt-ja-en, piper-en)
3. Switch to en→ja → models auto-select for new pair
4. Switch back to ja→en → previously selected models restored
5. Enable system audio → verify participant shows recalled reverse-direction models
6. Verify participant hint text appears below participant chips
7. Delete a model (e.g. piper-en) → switch away and back → that field auto-selects, others still recalled
