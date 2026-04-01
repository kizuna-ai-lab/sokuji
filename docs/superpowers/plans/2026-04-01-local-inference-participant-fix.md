# Local Inference Participant Mode Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix local inference participant mode so that ASR and translation work in the correct (reverse) direction, with graceful degradation when models are unavailable, and display model info in the Settings UI.

**Architecture:** Three-layer fix: (1) `modelStore` gets a `getParticipantModelStatus()` validator, (2) `settingsStore` gets a `createParticipantLocalInferenceConfig()` helper that swaps languages and resolves reverse-direction models, (3) `MainPanel` uses these to start participant with correct config or degrade gracefully, and `ProviderSection` displays model info. `LocalInferenceClient` is updated to support ASR-only mode (no translation engine).

**Tech Stack:** TypeScript, React, Zustand, Vitest, i18next

**Spec:** `docs/superpowers/specs/2026-04-01-local-inference-participant-fix-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/stores/modelStore.ts` | New `getParticipantModelStatus()` — checks reverse-direction model availability |
| `src/stores/settingsStore.ts` | New `ParticipantModelStatus` type + `createParticipantLocalInferenceConfig()` helper |
| `src/services/clients/LocalInferenceClient.ts` | Support ASR-only mode when `translationModelId` is undefined |
| `src/components/MainPanel/MainPanel.tsx` | Wire up participant config for local_inference, handle null (skip), log warnings |
| `src/components/Settings/sections/ProviderSection.tsx` | Display current model info for local_inference + participant status |
| `src/locales/*/translation.json` (30 dirs) | Rename `simpleSettings.apiKey` → `simpleSettings.provider`, add model info i18n keys |
| `src/stores/modelStore.test.ts` (new) | Tests for `getParticipantModelStatus()` |
| `src/stores/settingsStore.test.ts` (existing) | Tests for `createParticipantLocalInferenceConfig()` |

---

### Task 1: Add `getParticipantModelStatus()` to modelStore

**Files:**
- Modify: `src/stores/modelStore.ts`
- Create: `src/stores/modelStore.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/stores/modelStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modelManifest functions
const mockGetManifestEntry = vi.fn();
const mockGetAsrModelsForLanguage = vi.fn();
const mockGetTranslationModel = vi.fn();
const mockGetManifestByType = vi.fn();

vi.mock('../lib/local-inference/modelManifest', () => ({
  MODEL_MANIFEST: [],
  getManifestEntry: (...args: any[]) => mockGetManifestEntry(...args),
  getManifestByType: (...args: any[]) => mockGetManifestByType(...args),
  getAsrModelsForLanguage: (...args: any[]) => mockGetAsrModelsForLanguage(...args),
  getTranslationModel: (...args: any[]) => mockGetTranslationModel(...args),
  getTtsModelsForLanguage: vi.fn(() => []),
  isTranslationModelCompatible: vi.fn(() => true),
}));

vi.mock('../lib/local-inference/modelStorage', () => ({
  init: vi.fn(),
  getModelStatus: vi.fn(),
  clearAll: vi.fn(),
}));

vi.mock('../lib/local-inference/ModelManager', () => ({
  ModelManager: { getInstance: vi.fn() },
}));

vi.mock('../utils/webgpu', () => ({
  checkWebGPU: vi.fn().mockResolvedValue(false),
}));

const { default: useModelStore } = await import('./modelStore');

describe('getParticipantModelStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns available status when current ASR supports target lang and translation model exists', () => {
    // User config: ja → en. Participant needs: en → ja.
    // Current ASR (sensevoice) supports 'en', translation opus-mt-en-ja exists and is downloaded.
    useModelStore.setState({
      modelStatuses: {
        'sensevoice-int8': 'downloaded',
        'opus-mt-en-ja': 'downloaded',
      },
    });

    mockGetManifestEntry.mockImplementation((id: string) => {
      if (id === 'sensevoice-int8') return { id: 'sensevoice-int8', type: 'asr', languages: ['ja', 'en', 'zh'], multilingual: true };
      if (id === 'opus-mt-en-ja') return { id: 'opus-mt-en-ja', type: 'translation', languages: ['en', 'ja'], sourceLang: 'en', targetLang: 'ja' };
      return undefined;
    });
    mockGetTranslationModel.mockReturnValue({ id: 'opus-mt-en-ja', type: 'translation', languages: ['en', 'ja'] });

    const status = useModelStore.getState().getParticipantModelStatus('ja', 'en', 'sensevoice-int8');

    expect(status.asrAvailable).toBe(true);
    expect(status.asrModelId).toBe('sensevoice-int8');
    expect(status.asrFallback).toBe(false);
    expect(status.translationAvailable).toBe(true);
    expect(status.translationModelId).toBe('opus-mt-en-ja');
  });

  it('falls back to alternative ASR when current model does not support target lang', () => {
    // User ASR: whisper-en (only supports 'en'). Participant needs ASR for 'ja'.
    useModelStore.setState({
      modelStatuses: {
        'whisper-en': 'downloaded',
        'sensevoice-int8': 'downloaded',
        'opus-mt-ja-en': 'downloaded',
      },
    });

    mockGetManifestEntry.mockImplementation((id: string) => {
      if (id === 'whisper-en') return { id: 'whisper-en', type: 'asr', languages: ['en'], multilingual: false };
      if (id === 'sensevoice-int8') return { id: 'sensevoice-int8', type: 'asr', languages: ['ja', 'en', 'zh'], multilingual: true };
      return undefined;
    });
    // getAsrModelsForLanguage('en') is called with the PARTICIPANT source lang (user's target lang)
    // Wait — participant source is user's target. If user is ja→en, participant is en→ja.
    // So participant source = 'en'. Current ASR is whisper-en which DOES support 'en'.
    // Let me fix this test: user ASR is whisper-en, participant needs to recognize 'ja' (user's source becomes participant target... no)
    // Actually: user source=ja, target=en. Participant REVERSES: participant source=en, target=ja.
    // Participant ASR needs to recognize participant source = 'en'.
    // whisper-en supports 'en', so it would NOT need fallback in this case.
    //
    // Better test: user source=en, target=ja. Participant source=ja. ASR=whisper-en (only en). Needs fallback.
    mockGetAsrModelsForLanguage.mockReturnValue([
      { id: 'sensevoice-int8', type: 'asr', languages: ['ja', 'en', 'zh'], multilingual: true },
    ]);
    mockGetTranslationModel.mockReturnValue({ id: 'opus-mt-ja-en', type: 'translation', languages: ['ja', 'en'] });

    // sourceLang='en', targetLang='ja' → participant source='ja', needs ASR for 'ja'
    const status = useModelStore.getState().getParticipantModelStatus('en', 'ja', 'whisper-en');

    expect(status.asrAvailable).toBe(true);
    expect(status.asrModelId).toBe('sensevoice-int8');
    expect(status.asrFallback).toBe(true);
    expect(status.asrOriginalModelId).toBe('whisper-en');
  });

  it('returns asrAvailable=false when no ASR model supports participant source lang', () => {
    useModelStore.setState({
      modelStatuses: { 'whisper-en': 'downloaded' },
    });

    mockGetManifestEntry.mockReturnValue({ id: 'whisper-en', type: 'asr', languages: ['en'], multilingual: false });
    mockGetAsrModelsForLanguage.mockReturnValue([]); // no models for 'ja'

    // sourceLang='en', targetLang='ja' → participant needs ASR for 'ja'
    const status = useModelStore.getState().getParticipantModelStatus('en', 'ja', 'whisper-en');

    expect(status.asrAvailable).toBe(false);
    expect(status.asrModelId).toBeNull();
  });

  it('returns translationAvailable=false when reverse translation model is missing', () => {
    useModelStore.setState({
      modelStatuses: { 'sensevoice-int8': 'downloaded' },
    });

    mockGetManifestEntry.mockReturnValue({ id: 'sensevoice-int8', type: 'asr', languages: ['ja', 'en'], multilingual: true });
    mockGetTranslationModel.mockReturnValue(undefined); // no reverse model

    const status = useModelStore.getState().getParticipantModelStatus('ja', 'en', 'sensevoice-int8');

    expect(status.asrAvailable).toBe(true);
    expect(status.translationAvailable).toBe(false);
    expect(status.translationModelId).toBeNull();
  });

  it('returns translationAvailable=false when reverse translation model exists but not downloaded', () => {
    useModelStore.setState({
      modelStatuses: {
        'sensevoice-int8': 'downloaded',
        'opus-mt-en-ja': 'not_downloaded',
      },
    });

    mockGetManifestEntry.mockImplementation((id: string) => {
      if (id === 'sensevoice-int8') return { id: 'sensevoice-int8', type: 'asr', languages: ['ja', 'en'], multilingual: true };
      return undefined;
    });
    mockGetTranslationModel.mockReturnValue({ id: 'opus-mt-en-ja', type: 'translation', languages: ['en', 'ja'] });

    const status = useModelStore.getState().getParticipantModelStatus('ja', 'en', 'sensevoice-int8');

    expect(status.asrAvailable).toBe(true);
    expect(status.translationAvailable).toBe(false);
    expect(status.translationModelId).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/stores/modelStore.test.ts`
Expected: FAIL — `getParticipantModelStatus` is not a function

- [ ] **Step 3: Implement `getParticipantModelStatus` in modelStore**

In `src/stores/modelStore.ts`, add the `ParticipantModelStatus` type export near the top types section (after `DownloadState` interface, around line 30):

```typescript
export interface ParticipantModelStatus {
  asrAvailable: boolean;
  asrModelId: string | null;
  asrFallback: boolean;
  asrOriginalModelId: string;
  translationAvailable: boolean;
  translationModelId: string | null;
}
```

Add `getParticipantModelStatus` to the store interface (find `isProviderReady` in the interface definition and add after it):

```typescript
getParticipantModelStatus: (sourceLang: string, targetLang: string, currentAsrModelId: string) => ParticipantModelStatus;
```

Add the implementation right after the `isProviderReady` function body (after line 303):

```typescript
    getParticipantModelStatus: (sourceLang: string, targetLang: string, currentAsrModelId: string): ParticipantModelStatus => {
      const { modelStatuses } = get();

      // Participant reverses direction: participant source = user's target
      const participantSourceLang = targetLang;
      const participantTargetLang = sourceLang;

      // 1. ASR: check if current model supports participant source language
      let asrModelId: string | null = null;
      let asrFallback = false;

      const currentAsrEntry = getManifestEntry(currentAsrModelId);
      const currentAsrSupportsLang = currentAsrEntry
        && (currentAsrEntry.multilingual || currentAsrEntry.languages.includes(participantSourceLang))
        && modelStatuses[currentAsrModelId] === 'downloaded';

      if (currentAsrSupportsLang) {
        asrModelId = currentAsrModelId;
      } else {
        // Find alternative downloaded ASR model for participant source language
        const alternatives = getAsrModelsForLanguage(participantSourceLang);
        const downloaded = alternatives.find(m => modelStatuses[m.id] === 'downloaded');
        if (downloaded) {
          asrModelId = downloaded.id;
          asrFallback = true;
        }
      }

      // 2. Translation: look up reverse-direction model
      let translationModelId: string | null = null;
      const translationEntry = getTranslationModel(participantSourceLang, participantTargetLang);
      if (translationEntry && modelStatuses[translationEntry.id] === 'downloaded') {
        translationModelId = translationEntry.id;
      }

      return {
        asrAvailable: asrModelId !== null,
        asrModelId,
        asrFallback,
        asrOriginalModelId: currentAsrModelId,
        translationAvailable: translationModelId !== null,
        translationModelId,
      };
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/stores/modelStore.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/modelStore.ts src/stores/modelStore.test.ts
git commit -m "feat(local-inference): add getParticipantModelStatus to modelStore"
```

---

### Task 2: Add `createParticipantLocalInferenceConfig()` to settingsStore

**Files:**
- Modify: `src/stores/settingsStore.ts`
- Modify: `src/stores/settingsStore.test.ts`

- [ ] **Step 1: Write the test**

Append to `src/stores/settingsStore.test.ts`:

```typescript
describe('createParticipantLocalInferenceConfig', () => {
  // We need to import the helper. It's a module-level function, not on the store.
  // Import it directly after the dynamic import at the top of the file.

  it('swaps languages and resolves reverse models', async () => {
    const { createParticipantLocalInferenceConfig } = await import('./settingsStore');

    const baseConfig = {
      provider: 'local_inference' as const,
      model: 'local-asr-translate',
      instructions: '',
      sourceLanguage: 'ja',
      targetLanguage: 'en',
      asrModelId: 'sensevoice-int8',
      translationModelId: 'opus-mt-ja-en',
      ttsModelId: 'piper-en',
      ttsSpeakerId: 0,
      ttsSpeed: 1.0,
    };

    // Mock getParticipantModelStatus on the model store
    const { default: useModelStore } = await import('./modelStore');
    const originalGetState = useModelStore.getState;
    vi.spyOn(useModelStore, 'getState').mockReturnValue({
      ...originalGetState(),
      getParticipantModelStatus: () => ({
        asrAvailable: true,
        asrModelId: 'sensevoice-int8',
        asrFallback: false,
        asrOriginalModelId: 'sensevoice-int8',
        translationAvailable: true,
        translationModelId: 'opus-mt-en-ja',
      }),
    });

    const result = createParticipantLocalInferenceConfig(baseConfig);

    expect(result).not.toBeNull();
    expect(result!.config.sourceLanguage).toBe('en');
    expect(result!.config.targetLanguage).toBe('ja');
    expect(result!.config.asrModelId).toBe('sensevoice-int8');
    expect(result!.config.translationModelId).toBe('opus-mt-en-ja');
    expect(result!.config.ttsModelId).toBeUndefined();
    expect(result!.status.translationAvailable).toBe(true);

    vi.restoreAllMocks();
  });

  it('returns null when no ASR model is available', async () => {
    const { createParticipantLocalInferenceConfig } = await import('./settingsStore');

    const baseConfig = {
      provider: 'local_inference' as const,
      model: 'local-asr-translate',
      instructions: '',
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      asrModelId: 'whisper-en',
      translationModelId: 'opus-mt-en-ja',
      ttsModelId: 'piper-ja',
      ttsSpeakerId: 0,
      ttsSpeed: 1.0,
    };

    const { default: useModelStore } = await import('./modelStore');
    vi.spyOn(useModelStore, 'getState').mockReturnValue({
      ...useModelStore.getState(),
      getParticipantModelStatus: () => ({
        asrAvailable: false,
        asrModelId: null,
        asrFallback: false,
        asrOriginalModelId: 'whisper-en',
        translationAvailable: false,
        translationModelId: null,
      }),
    });

    const result = createParticipantLocalInferenceConfig(baseConfig);
    expect(result).toBeNull();

    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/stores/settingsStore.test.ts`
Expected: FAIL — `createParticipantLocalInferenceConfig` is not exported

- [ ] **Step 3: Implement the function**

In `src/stores/settingsStore.ts`, add the import for `ParticipantModelStatus` from modelStore and the model store itself near the existing imports (around line 1-20 area):

```typescript
import useModelStore, { type ParticipantModelStatus } from './modelStore';
```

Then add the exported function after the existing `createLocalInferenceSessionConfig` function (after line 492):

```typescript
/**
 * Create a participant session config for local inference by swapping languages
 * and resolving reverse-direction models. Returns null if ASR is unavailable.
 */
export function createParticipantLocalInferenceConfig(
  baseConfig: LocalInferenceSessionConfig
): { config: LocalInferenceSessionConfig; status: ParticipantModelStatus } | null {
  const status = useModelStore.getState().getParticipantModelStatus(
    baseConfig.sourceLanguage,
    baseConfig.targetLanguage,
    baseConfig.asrModelId,
  );

  if (!status.asrAvailable) {
    return null;
  }

  return {
    config: {
      ...baseConfig,
      sourceLanguage: baseConfig.targetLanguage,
      targetLanguage: baseConfig.sourceLanguage,
      asrModelId: status.asrModelId!,
      translationModelId: status.translationModelId ?? undefined,
      ttsModelId: undefined,
    },
    status,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/stores/settingsStore.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts src/stores/settingsStore.test.ts
git commit -m "feat(local-inference): add createParticipantLocalInferenceConfig helper"
```

---

### Task 3: Support ASR-only mode in LocalInferenceClient

**Files:**
- Modify: `src/services/clients/LocalInferenceClient.ts`

- [ ] **Step 1: Make translation engine conditional in `connect()`**

In `src/services/clients/LocalInferenceClient.ts`, find lines 92-93:

```typescript
    const engines = ['asr', 'translation'];
    if (config.ttsModelId && !config.textOnly) engines.push('tts');
```

Replace with:

```typescript
      const engines = ['asr'];
      if (config.translationModelId) engines.push('translation');
      if (config.ttsModelId && !config.textOnly) engines.push('tts');
```

- [ ] **Step 2: Make translation engine creation conditional**

Find lines 157-159:

```typescript
      // Translation engine
      console.info('[LocalInference] Initializing Translation engine:', config.translationModelId, `(${config.sourceLanguage} → ${config.targetLanguage})`);
      this.translationEngine = new TranslationEngine();
```

Replace with:

```typescript
      // Translation engine (optional — skip when no model available, e.g. participant ASR-only mode)
      if (config.translationModelId) {
        console.info('[LocalInference] Initializing Translation engine:', config.translationModelId, `(${config.sourceLanguage} → ${config.targetLanguage})`);
        this.translationEngine = new TranslationEngine();
      } else {
        console.info('[LocalInference] No translation model — ASR-only mode');
        this.translationEngine = null;
      }
```

- [ ] **Step 3: Make translation init promise conditional**

Find lines 183-184:

```typescript
      const translationPromise = this.trackInit('translation', config.translationModelId, () =>
        this.translationEngine!.init(config.sourceLanguage, config.targetLanguage, config.translationModelId),
      );
```

Replace with:

```typescript
      const translationPromise = this.translationEngine
        ? this.trackInit('translation', config.translationModelId!, () =>
            this.translationEngine!.init(config.sourceLanguage, config.targetLanguage, config.translationModelId),
          )
        : Promise.resolve(null);
```

- [ ] **Step 4: Make translation result check conditional**

Find lines 207-210:

```typescript
      // Check Translation result
      if (results[1].status === 'rejected') {
        throw new Error(`Translation engine init failed: ${results[1].reason instanceof Error ? results[1].reason.message : String(results[1].reason)}`);
      }
      console.info('[LocalInference] Translation engine ready');
```

Replace with:

```typescript
      // Check Translation result (skip if ASR-only mode)
      if (this.translationEngine) {
        if (results[1].status === 'rejected') {
          throw new Error(`Translation engine init failed: ${results[1].reason instanceof Error ? results[1].reason.message : String(results[1].reason)}`);
        }
        console.info('[LocalInference] Translation engine ready');
      }
```

- [ ] **Step 5: Handle ASR-only in `processPipelineJob`**

Find line 399-401 in `processPipelineJob`:

```typescript
      // Translate first — don't push item until we have content
      if (!this.translationEngine || this.disposed) return;
      this.emitEvent('local.translation.start', 'client', { sourceText: job.text, modelId: this.config?.translationModelId });
```

Replace the entire `processPipelineJob` method's translation section. Find from line 398 to line 431 (the section that translates and creates the assistant item):

```typescript
    try {
      // Translate first — don't push item until we have content
      if (!this.translationEngine || this.disposed) return;
      this.emitEvent('local.translation.start', 'client', { sourceText: job.text, modelId: this.config?.translationModelId });
      const translationResult = await this.translationEngine.translate(job.text);
      if (this.disposed) return;

      const translatedText = translationResult.translatedText;
      console.debug('[LocalInference] Translation:', job.text, '→', translatedText, `(${translationResult.inferenceTimeMs}ms)`);

      // Skip empty translations (e.g. thinking-mode leakage stripped to nothing)
      if (!translatedText) {
        console.debug('[LocalInference] Translation empty — skipping:', job.text);
        return;
      }
      this.emitEvent('local.translation.end', 'server', {
        sourceText: job.text,
        translatedText,
        inferenceTimeMs: translationResult.inferenceTimeMs,
        systemPrompt: translationResult.systemPrompt,
        modelId: this.config?.translationModelId,
      });

      // Create assistant item with translation already set
      const assistantItem: ConversationItem = {
        id: itemId,
        role: 'assistant',
        type: 'message',
        status: 'in_progress',
        createdAt: Date.now(),
        formatted: { transcript: translatedText },
      };
      this.conversationItems.push(assistantItem);
      this.handlers.onConversationUpdated?.({ item: assistantItem });
```

Replace with:

```typescript
    try {
      let displayText: string;

      if (this.translationEngine) {
        // Full pipeline: translate then display
        if (this.disposed) return;
        this.emitEvent('local.translation.start', 'client', { sourceText: job.text, modelId: this.config?.translationModelId });
        const translationResult = await this.translationEngine.translate(job.text);
        if (this.disposed) return;

        const translatedText = translationResult.translatedText;
        console.debug('[LocalInference] Translation:', job.text, '→', translatedText, `(${translationResult.inferenceTimeMs}ms)`);

        if (!translatedText) {
          console.debug('[LocalInference] Translation empty — skipping:', job.text);
          return;
        }
        this.emitEvent('local.translation.end', 'server', {
          sourceText: job.text,
          translatedText,
          inferenceTimeMs: translationResult.inferenceTimeMs,
          systemPrompt: translationResult.systemPrompt,
          modelId: this.config?.translationModelId,
        });
        displayText = translatedText;
      } else {
        // ASR-only mode: use source text directly as the assistant item
        console.debug('[LocalInference] ASR-only mode — displaying source text:', job.text);
        displayText = job.text;
      }

      // Create assistant item
      const assistantItem: ConversationItem = {
        id: itemId,
        role: 'assistant',
        type: 'message',
        status: 'in_progress',
        createdAt: Date.now(),
        formatted: { transcript: displayText },
      };
      this.conversationItems.push(assistantItem);
      this.handlers.onConversationUpdated?.({ item: assistantItem });
```

- [ ] **Step 6: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors in `LocalInferenceClient.ts`

- [ ] **Step 7: Commit**

```bash
git add src/services/clients/LocalInferenceClient.ts
git commit -m "feat(local-inference): support ASR-only mode without translation engine"
```

---

### Task 4: Wire up participant config in MainPanel

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Add import for `createParticipantLocalInferenceConfig`**

Find the imports from `settingsStore` at the top of MainPanel.tsx and add:

```typescript
import { createParticipantLocalInferenceConfig } from '../../stores/settingsStore';
```

Also add the import for `LocalInferenceSessionConfig` from the interfaces file (if not already imported). Find the existing import from `IClient.ts`:

```typescript
import type { LocalInferenceSessionConfig } from '../../services/interfaces/IClient';
```

- [ ] **Step 2: Add local_inference branch in `createParticipantSessionConfig`**

Find the `createParticipantSessionConfig` function (around line 296-324). After the existing `volcengine_st` branch (line 320-321 closing `}`), add the `local_inference` branch:

```typescript
    } else if (config.provider === 'local_inference') {
      const localConfig = config as LocalInferenceSessionConfig;
      const result = createParticipantLocalInferenceConfig(localConfig);

      if (!result) {
        addLog(`Participant: no ASR model available for ${localConfig.targetLanguage}`, 'error');
        return null;
      }

      if (!result.status.translationAvailable) {
        addLog(`Participant: no translation model for ${localConfig.targetLanguage} → ${localConfig.sourceLanguage} — transcription only`, 'warning');
      }

      if (result.status.asrFallback) {
        addLog(`Participant: using ${result.status.asrModelId} instead of ${result.status.asrOriginalModelId} for ASR`, 'info');
      }

      return result.config;
    }
```

- [ ] **Step 3: Change return type to allow null**

The `createParticipantSessionConfig` function currently returns `SessionConfig` implicitly. Update the return type annotation. Find:

```typescript
  const createParticipantSessionConfig = useCallback(() => {
```

Change to:

```typescript
  const createParticipantSessionConfig = useCallback((): SessionConfig | null => {
```

- [ ] **Step 4: Add null check at the call site**

Find where `createParticipantSessionConfig()` is called (around line 1181):

```typescript
          const participantSessionConfig = createParticipantSessionConfig();
          await participantClient.connect(participantSessionConfig);
```

Replace with:

```typescript
          const participantSessionConfig = createParticipantSessionConfig();
          if (!participantSessionConfig) {
            console.info('[Sokuji] [MainPanel] Participant skipped — no suitable models');
            systemAudioClientRef.current = null;
          } else {
            await participantClient.connect(participantSessionConfig);
```

And add the corresponding closing brace. Find the end of the participant recording section (around line 1212):

```typescript
          console.info(`[Sokuji] [MainPanel] Participant audio recording started (${captureMode})`);
```

Add a closing `}` after this line to close the `else` block:

```typescript
          console.info(`[Sokuji] [MainPanel] Participant audio recording started (${captureMode})`);
          }
```

- [ ] **Step 5: Add `addLog` to dependencies of `createParticipantSessionConfig`**

Update the dependency array of the `useCallback`. Find:

```typescript
  }, [getProcessedSystemInstructions, createSessionConfig]);
```

Replace with:

```typescript
  }, [getProcessedSystemInstructions, createSessionConfig, addLog]);
```

- [ ] **Step 6: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "fix(local-inference): swap languages for participant session config"
```

---

### Task 5: Display model info in ProviderSection

**Files:**
- Modify: `src/components/Settings/sections/ProviderSection.tsx`

- [ ] **Step 1: Add imports**

At the top of `ProviderSection.tsx`, add imports:

```typescript
import useModelStore from '../../../stores/modelStore';
import { useLocalInferenceSettings } from '../../../stores/settingsStore';
import { useAudioContext } from '../../../stores/audioStore';
import {
  getManifestEntry,
  getTranslationModel,
  getTtsModelsForLanguage,
} from '../../../lib/local-inference/modelManifest';
```

- [ ] **Step 2: Add hooks inside component**

Inside the `ProviderSection` component, after the existing hooks (around line 92), add:

```typescript
  // Local inference model info
  const localInferenceSettings = useLocalInferenceSettings();
  const { isSystemAudioCaptureEnabled } = useAudioContext();
  const participantModelStatus = useModelStore(state =>
    provider === Provider.LOCAL_INFERENCE
      ? state.getParticipantModelStatus(
          localInferenceSettings.sourceLanguage,
          localInferenceSettings.targetLanguage,
          localInferenceSettings.asrModel,
        )
      : null
  );
```

- [ ] **Step 3: Replace the local inference "no key required" block**

Find the local inference block (lines 409-413):

```tsx
      {provider === Provider.LOCAL_INFERENCE ? (
        <div className="api-key-info">
          <CheckCircle size={16} className="success-icon" />
          <span>{t('providers.local_inference.noKeyRequired', 'No API key required — runs entirely on your device')}</span>
        </div>
```

Replace with:

```tsx
      {provider === Provider.LOCAL_INFERENCE ? (
        <div className="local-inference-info">
          <div className="api-key-info">
            <CheckCircle size={16} className="success-icon" />
            <span>{t('providers.local_inference.noKeyRequired', 'No API key required — runs entirely on your device')}</span>
          </div>
          <div className="model-info">
            <div className="model-info-row">
              <span className="model-info-label">{t('providers.local_inference.modelAsr', 'ASR')}:</span>
              <span className="model-info-value">{localInferenceSettings.asrModel || t('common.none', 'None')}</span>
            </div>
            <div className="model-info-row">
              <span className="model-info-label">{t('providers.local_inference.modelTranslation', 'Translation')}:</span>
              <span className="model-info-value">
                {localInferenceSettings.translationModel
                  || getTranslationModel(localInferenceSettings.sourceLanguage, localInferenceSettings.targetLanguage)?.id
                  || t('common.none', 'None')}
              </span>
            </div>
            <div className="model-info-row">
              <span className="model-info-label">{t('providers.local_inference.modelTts', 'TTS')}:</span>
              <span className="model-info-value">
                {localInferenceSettings.ttsModel
                  || getTtsModelsForLanguage(localInferenceSettings.targetLanguage)[0]?.id
                  || t('common.none', 'None')}
              </span>
            </div>
            {isSystemAudioCaptureEnabled && participantModelStatus && (
              <div className="participant-model-info">
                <div className="model-info-row">
                  <span className="model-info-label">
                    {t('providers.local_inference.participant', 'Participant')} ({localInferenceSettings.targetLanguage} → {localInferenceSettings.sourceLanguage}):
                  </span>
                </div>
                <div className="model-info-row model-info-indent">
                  <span className="model-info-label">{t('providers.local_inference.modelAsr', 'ASR')}:</span>
                  {participantModelStatus.asrAvailable ? (
                    <span className="model-info-value model-ok">
                      {participantModelStatus.asrModelId}
                      {participantModelStatus.asrFallback && ` (${t('providers.local_inference.fallback', 'auto-selected')})`}
                    </span>
                  ) : (
                    <span className="model-info-value model-warning">
                      <AlertCircle size={12} />
                      {t('providers.local_inference.noAsrModel', 'No model available')}
                    </span>
                  )}
                </div>
                <div className="model-info-row model-info-indent">
                  <span className="model-info-label">{t('providers.local_inference.modelTranslation', 'Translation')}:</span>
                  {participantModelStatus.translationAvailable ? (
                    <span className="model-info-value model-ok">{participantModelStatus.translationModelId}</span>
                  ) : (
                    <span className="model-info-value model-warning">
                      <AlertCircle size={12} />
                      {t('providers.local_inference.noTranslationModel', 'No model — transcription only')}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
```

- [ ] **Step 4: Add CSS for model info display**

Add the following styles to `src/components/Settings/Settings.scss` (where `.api-key-section` and `.api-key-info` styles already live):

```scss
.local-inference-info {
  .model-info {
    margin-top: 8px;
    font-size: 12px;
    color: #aaa;
  }

  .model-info-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }

  .model-info-indent {
    padding-left: 12px;
  }

  .model-info-label {
    color: #888;
  }

  .model-info-value {
    color: #ccc;
    font-family: monospace;
    font-size: 11px;
  }

  .model-ok {
    color: #10a37f;
  }

  .model-warning {
    color: #e6a700;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .participant-model-info {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid #333;
  }
}
```

- [ ] **Step 5: Run dev server and visually verify**

Run: `npm run dev`
Open browser, select Local (Offline) provider. Verify:
- Model names display correctly under the provider selector
- If system audio capture is enabled, participant model status appears

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/sections/ProviderSection.tsx src/components/Settings/Settings.scss
git commit -m "feat(settings): display local inference model info in provider section"
```

---

### Task 6: Rename section title and update i18n

**Files:**
- Modify: `src/components/Settings/sections/ProviderSection.tsx`
- Modify: `src/locales/*/translation.json` (30 locale directories)

- [ ] **Step 1: Add new i18n key to English locale**

In `src/locales/en/translation.json`, find `"simpleSettings"` section (around line 226). Add the new key next to the existing `"apiKey"`:

```json
    "provider": "Provider",
```

Also add the local inference model keys inside the existing `providers.local_inference` block. Find `"local_inference"` in the providers section and add:

```json
      "modelAsr": "ASR",
      "modelTranslation": "Translation",
      "modelTts": "TTS",
      "participant": "Participant",
      "fallback": "auto-selected",
      "noAsrModel": "No model available",
      "noTranslationModel": "No model — transcription only",
```

- [ ] **Step 2: Update ProviderSection to use new key**

In `src/components/Settings/sections/ProviderSection.tsx`, find line 286:

```tsx
        <span>{t('simpleSettings.apiKey')}</span>
```

Replace with:

```tsx
        <span>{t('simpleSettings.provider', 'Provider')}</span>
```

- [ ] **Step 3: Update remaining locale files**

For each of the 29 non-English locale directories, add the `"provider"` key to the `"simpleSettings"` section. The value should be the localized translation of "Provider". Use this script to add the key with English fallback (i18next will fall back to English if key is missing, but adding it is good practice):

```bash
# Run from project root. This adds "provider": "Provider" to all non-en locales.
# i18next fallback will handle it, but explicit keys are preferred.
for dir in src/locales/*/; do
  lang=$(basename "$dir")
  if [ "$lang" = "en" ] || [ "$lang" = "index.ts" ]; then continue; fi
  file="$dir/translation.json"
  if [ -f "$file" ]; then
    # Add "provider" key after "apiKey" in simpleSettings section
    # Using node for reliable JSON manipulation
    node -e "
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync('$file', 'utf8'));
      if (data.simpleSettings && !data.simpleSettings.provider) {
        data.simpleSettings.provider = data.simpleSettings.apiKey || 'Provider';
      }
      fs.writeFileSync('$file', JSON.stringify(data, null, 2) + '\n');
    "
  fi
done
```

- [ ] **Step 4: Run dev server and verify**

Run: `npm run dev`
Verify the section heading now says "Provider" instead of "API Key" in the simple settings view.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/ProviderSection.tsx
git add src/locales/
git commit -m "feat(i18n): rename API Key section to Provider, add model info keys"
```

---

### Task 7: Integration test — full build verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

```bash
npm run test
```

Expected: All tests pass, including new `modelStore.test.ts` and updated `settingsStore.test.ts`.

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds without errors.

- [ ] **Step 4: Manual smoke test**

1. Start dev server: `npm run dev`
2. Select Local (Offline) provider
3. Verify model info displays in settings
4. Enable system audio capture
5. Verify participant model status appears
6. Start a session — check console logs for correct participant language swap
7. If reverse models are missing, verify graceful degradation message in logs panel

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(local-inference): integration fixes for participant mode"
```
