# Local Provider Custom Translation Prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-editable translation system prompt on the LOCAL_INFERENCE provider, mirroring cloud's Simple/Advanced UX. Simple stays a read-only preview; Advanced exposes two freeform textareas (speaker + participant) paired with their respective translation models. Qwen-family workers only.

**Architecture:** Extract the prompt-building logic out of the two Qwen workers into a shared `prompts.ts` module. Add three fields to `LocalInferenceSettings` + a `getProcessedLocalPrompt(forParticipant)` selector. Route `LocalInferenceClient` to pass the resolved prompt plus a `wrapTranscript` flag into `TranslationEngine.translate()` on each call. UI is a new section in `ProviderSpecificSettings` mirroring cloud's `system-instructions-section`.

**Tech Stack:** TypeScript, Vitest, Zustand, React, i18next.

**Spec:** `docs/superpowers/specs/2026-04-19-local-provider-custom-prompt-design.md`

---

## Task 1: Shared prompt builder (pure module + tests)

**Files:**
- Create: `src/lib/local-inference/prompts.ts`
- Create: `src/lib/local-inference/prompts.test.ts`

Extracts the `LANG_NAMES` / `NATIVE_NAMES` / `LANG_FILLERS` tables and the English default prompt out of `qwen-translation.worker.ts` (lines 19-43, 171-174) into a shared module so the store selector and the workers can both use it.

- [ ] **Step 1: Write the failing test**

Create `src/lib/local-inference/prompts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildDefaultLocalPrompt } from './prompts';

describe('buildDefaultLocalPrompt', () => {
  it('includes native and english target names plus language-specific fillers', () => {
    const p = buildDefaultLocalPrompt('ja', 'en');
    expect(p).toContain('Japanese');
    expect(p).toContain('English');
    // Filler list is computed from both ends of the language pair
    expect(p).toContain('um');
    expect(p).toContain('えーと');
    // Source-to-target direction stated
    expect(p).toContain('from Japanese to English');
    // Transcript-tag convention retained
    expect(p).toContain('<transcript>');
  });

  it('uses native-name decoration for target when available', () => {
    const p = buildDefaultLocalPrompt('en', 'zh');
    // tgt label like "中文 (Chinese)"
    expect(p).toContain('中文 (Chinese)');
  });

  it('falls back to raw codes and default fillers for unknown languages', () => {
    const p = buildDefaultLocalPrompt('xx', 'yy');
    expect(p).toContain('from xx to yy');
    expect(p).toContain('um');
    expect(p).toContain('uh');
  });

  it('handles same-language pairs without duplicating fillers', () => {
    const p = buildDefaultLocalPrompt('en', 'en');
    const umOccurrences = (p.match(/\bum\b/g) || []).length;
    expect(umOccurrences).toBe(1);
  });

  it('does not include /no_think (that is a worker-side Qwen3 switch)', () => {
    const p = buildDefaultLocalPrompt('ja', 'en');
    expect(p).not.toContain('/no_think');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/local-inference/prompts.test.ts`
Expected: FAIL — module `./prompts` does not exist.

- [ ] **Step 3: Implement the module**

Create `src/lib/local-inference/prompts.ts`:

```typescript
/**
 * Shared prompt builder for local-inference Qwen-family translation workers.
 * Used by the store selector (for UI preview + Simple-mode at runtime) and
 * by the workers as the fallback when the main thread sends an empty system
 * prompt.
 */

export const LANG_NAMES: Record<string, string> = {
  ja: 'Japanese', zh: 'Chinese', en: 'English', ko: 'Korean',
  de: 'German', fr: 'French', es: 'Spanish', ru: 'Russian',
  ar: 'Arabic', pt: 'Portuguese', th: 'Thai', vi: 'Vietnamese',
  id: 'Indonesian', tr: 'Turkish', nl: 'Dutch', pl: 'Polish',
  it: 'Italian', hi: 'Hindi', sv: 'Swedish', da: 'Danish',
  fi: 'Finnish', hu: 'Hungarian', ro: 'Romanian', no: 'Norwegian',
  uk: 'Ukrainian', cs: 'Czech', et: 'Estonian', af: 'Afrikaans',
};

export const NATIVE_NAMES: Record<string, string> = {
  ja: '日本語', zh: '中文', en: 'English', ko: '한국어',
  de: 'Deutsch', fr: 'Français', es: 'Español', ru: 'Русский',
  ar: 'العربية', pt: 'Português', th: 'ไทย', vi: 'Tiếng Việt',
};

export const LANG_FILLERS: Record<string, string[]> = {
  en: ['um', 'uh', 'well', 'like'],
  ja: ['えーと', 'あのー', 'まあ'],
  zh: ['那个', '嗯', '就是'],
  ko: ['음', '그', '저기'],
};

export function buildDefaultLocalPrompt(sourceLang: string, targetLang: string): string {
  const srcName = LANG_NAMES[sourceLang] || sourceLang;
  const tgtName = LANG_NAMES[targetLang] || targetLang;
  const nativeTgt = NATIVE_NAMES[targetLang];
  const tgtLabel = nativeTgt ? `${nativeTgt} (${tgtName})` : tgtName;

  const langs = new Set([sourceLang, targetLang]);
  const fillerSet = new Set<string>();
  for (const l of langs) {
    for (const f of (LANG_FILLERS[l] || [])) fillerSet.add(f);
  }
  if (fillerSet.size === 0) {
    fillerSet.add('um');
    fillerSet.add('uh');
  }
  const fillerList = Array.from(fillerSet).join(', ');

  return (
    `You are a translator. Translate the speech transcript inside <transcript> tags from ${srcName} to ${tgtLabel}.\n` +
    `Drop fillers (${fillerList}). Fix stuttering and repetitions.\n` +
    `Output ONLY the ${tgtLabel} translation. No explanation, no refusal.`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/local-inference/prompts.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/prompts.ts src/lib/local-inference/prompts.test.ts
git commit -m "feat(local-inference): shared prompt builder with language tables"
```

---

## Task 2: Extend `LocalInferenceSettings` with new fields

**Files:**
- Modify: `src/stores/settingsStore.ts`

Adds three fields (`useTemplateMode`, `systemPrompt`, `participantSystemPrompt`) to the local settings. No behavior change yet — this task only expands the data model.

- [ ] **Step 1: Add fields to the interface**

In `src/stores/settingsStore.ts`, locate `interface LocalInferenceSettings` (around line 131). Append:

```typescript
export interface LocalInferenceSettings {
  asrModel: string;
  translationModel: string;
  ttsModel: string;
  ttsSpeakerId: number;
  ttsSpeed: number;
  edgeTtsVoice: string;
  sourceLanguage: string;
  targetLanguage: string;
  turnDetectionMode: 'Auto' | 'Push-to-Talk';
  vadThreshold: number;
  vadMinSilenceDuration: number;
  vadMinSpeechDuration: number;
  // NEW fields for custom translation prompt
  useTemplateMode: boolean;            // true = Simple (default), false = Advanced
  systemPrompt: string;                // Advanced speaker freeform (default '')
  participantSystemPrompt: string;     // Advanced participant freeform (default '')
}
```

- [ ] **Step 2: Add defaults**

Locate `const defaultLocalInferenceSettings` (around line 297). Append the three fields:

```typescript
const defaultLocalInferenceSettings: LocalInferenceSettings = {
  asrModel: 'sensevoice-int8',
  translationModel: '',
  ttsModel: '',
  ttsSpeakerId: 0,
  ttsSpeed: 1.0,
  edgeTtsVoice: '',
  sourceLanguage: 'ja',
  targetLanguage: 'en',
  turnDetectionMode: 'Auto',
  vadThreshold: 0.3,
  vadMinSilenceDuration: 1.4,
  vadMinSpeechDuration: 0.4,
  useTemplateMode: true,
  systemPrompt: '',
  participantSystemPrompt: '',
};
```

- [ ] **Step 3: Typecheck and confirm nothing else broke**

Run: `npm run test -- src/stores/settingsStore.test.ts`
Expected: PASS. (No new tests yet; existing tests should still pass because the old fields are untouched.)

Run: `npx tsc --noEmit`
Expected: no errors. (If errors surface from consumers that destructure `LocalInferenceSettings`, they shouldn't — the new fields are additive.)

- [ ] **Step 4: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(settings): add useTemplateMode + systemPrompt fields to LocalInferenceSettings"
```

---

## Task 3: Add `getProcessedLocalPrompt` selector + tests

**Files:**
- Modify: `src/stores/settingsStore.ts`
- Modify: `src/stores/settingsStore.test.ts`

Adds a new selector that resolves the local-provider prompt based on mode + direction. Written TDD.

- [ ] **Step 1: Write the failing test**

In `src/stores/settingsStore.test.ts`, add a new `describe` block (place it alongside existing tests for provider-specific settings):

```typescript
import { buildDefaultLocalPrompt } from '../lib/local-inference/prompts';

describe('getProcessedLocalPrompt', () => {
  beforeEach(() => {
    // Reset to defaults; adapt to the test file's existing reset pattern if different
    useSettingsStore.setState({
      provider: Provider.LOCAL_INFERENCE,
      localInference: {
        ...useSettingsStore.getState().localInference,
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        useTemplateMode: true,
        systemPrompt: '',
        participantSystemPrompt: '',
      },
    });
  });

  it('Simple mode: returns the dynamic default for speaker direction', () => {
    const result = useSettingsStore.getState().getProcessedLocalPrompt(false);
    expect(result).toBe(buildDefaultLocalPrompt('ja', 'en'));
  });

  it('Simple mode: swaps languages for participant direction', () => {
    const result = useSettingsStore.getState().getProcessedLocalPrompt(true);
    expect(result).toBe(buildDefaultLocalPrompt('en', 'ja'));
  });

  it('Advanced mode: returns the user speaker prompt verbatim', () => {
    useSettingsStore.setState({
      localInference: {
        ...useSettingsStore.getState().localInference,
        useTemplateMode: false,
        systemPrompt: 'My custom speaker prompt',
      },
    });
    const result = useSettingsStore.getState().getProcessedLocalPrompt(false);
    expect(result).toBe('My custom speaker prompt');
  });

  it('Advanced mode: empty speaker falls back to default', () => {
    useSettingsStore.setState({
      localInference: {
        ...useSettingsStore.getState().localInference,
        useTemplateMode: false,
        systemPrompt: '',
      },
    });
    const result = useSettingsStore.getState().getProcessedLocalPrompt(false);
    expect(result).toBe(buildDefaultLocalPrompt('ja', 'en'));
  });

  it('Advanced mode: empty participant falls back to resolved speaker', () => {
    useSettingsStore.setState({
      localInference: {
        ...useSettingsStore.getState().localInference,
        useTemplateMode: false,
        systemPrompt: 'Speaker says hi',
        participantSystemPrompt: '',
      },
    });
    const result = useSettingsStore.getState().getProcessedLocalPrompt(true);
    expect(result).toBe('Speaker says hi');
  });

  it('Advanced mode: participant filled returns participant text', () => {
    useSettingsStore.setState({
      localInference: {
        ...useSettingsStore.getState().localInference,
        useTemplateMode: false,
        systemPrompt: 'Speaker',
        participantSystemPrompt: 'Participant',
      },
    });
    const result = useSettingsStore.getState().getProcessedLocalPrompt(true);
    expect(result).toBe('Participant');
  });

  it('Advanced mode: empty speaker AND empty participant both fall back to default', () => {
    useSettingsStore.setState({
      localInference: {
        ...useSettingsStore.getState().localInference,
        useTemplateMode: false,
        systemPrompt: '',
        participantSystemPrompt: '',
      },
    });
    const speaker = useSettingsStore.getState().getProcessedLocalPrompt(false);
    const participant = useSettingsStore.getState().getProcessedLocalPrompt(true);
    expect(speaker).toBe(buildDefaultLocalPrompt('ja', 'en'));
    expect(participant).toBe(buildDefaultLocalPrompt('en', 'ja'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/stores/settingsStore.test.ts -t "getProcessedLocalPrompt"`
Expected: FAIL — `getProcessedLocalPrompt` is not a function.

- [ ] **Step 3: Add selector to store**

In `src/stores/settingsStore.ts`:

1. Near the top import block, add:
   ```typescript
   import { buildDefaultLocalPrompt } from '../lib/local-inference/prompts';
   ```

2. In the `SettingsStore` interface (around line 403, next to `getProcessedSystemInstructions`), add:
   ```typescript
   getProcessedLocalPrompt: (forParticipant?: boolean) => string;
   ```

3. In the store creator (next to where `getProcessedSystemInstructions` is implemented, around line 1338), add:
   ```typescript
   getProcessedLocalPrompt: (forParticipant = false) => {
     const s = get().localInference;
     const [srcLang, tgtLang] = forParticipant
       ? [s.targetLanguage, s.sourceLanguage]
       : [s.sourceLanguage, s.targetLanguage];

     if (s.useTemplateMode) {
       return buildDefaultLocalPrompt(srcLang, tgtLang);
     }
     // Advanced mode: speaker falls back to default if empty
     const speakerResolved = s.systemPrompt.trim() || buildDefaultLocalPrompt(srcLang, tgtLang);
     if (!forParticipant) return speakerResolved;
     // Participant falls back to resolved speaker if empty
     const participant = s.participantSystemPrompt.trim();
     return participant || speakerResolved;
   },
   ```

4. Near the bottom of the file where selectors are exported (search for `useGetProcessedSystemInstructions`), add:
   ```typescript
   export const useGetProcessedLocalPrompt = () => useSettingsStore((state) => state.getProcessedLocalPrompt);
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/stores/settingsStore.test.ts -t "getProcessedLocalPrompt"`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts src/stores/settingsStore.test.ts
git commit -m "feat(settings): getProcessedLocalPrompt selector with Simple/Advanced fallback"
```

---

## Task 4: Add setters, hooks, and `resolveTranslationWorkerType` helper

**Files:**
- Modify: `src/stores/settingsStore.ts`

Exposes setters for the new fields so the UI can update them, and a helper that resolves the effective worker type (used to gate the UI).

- [ ] **Step 1: Add setter to the store interface**

In `src/stores/settingsStore.ts`, locate the store interface's setter section (search for `updateLocalInference`). The existing `updateLocalInference: (settings: Partial<LocalInferenceSettings>) => void;` already covers the new fields — no new setter signature needed at the interface level.

- [ ] **Step 2: Add the `resolveTranslationWorkerType` helper**

Near `createLocalInferenceSessionConfig` (around line 520), add:

```typescript
import type { TranslationWorkerType } from '../lib/local-inference/modelManifest';  // adjust import if type isn't exported yet; if not, widen to `string`

/**
 * Resolve the effective translation worker type for the current local-inference settings.
 * Considers auto-select fallback (empty translationModel → getTranslationModel lookup).
 * Returns 'opus-mt' when nothing matches.
 */
export function resolveTranslationWorkerType(settings: LocalInferenceSettings): string {
  const modelId = settings.translationModel
    || getTranslationModel(settings.sourceLanguage, settings.targetLanguage)?.id;
  if (!modelId) return 'opus-mt';
  const entry = getManifestEntry(modelId);
  if (!entry) return 'opus-mt';
  return entry.translationWorkerType || (entry.multilingual ? 'qwen' : 'opus-mt');
}
```

If `TranslationWorkerType` isn't exported from `modelManifest`, skip the import and type the return as `string`. The consumer in Task 7 only cares about `['qwen', 'qwen35'].includes(result)`.

- [ ] **Step 3: Add typed convenience hooks near the other selectors**

Near the bottom of `src/stores/settingsStore.ts` where hooks are exported (search for `useLocalInferenceSettings`), add:

```typescript
export const useLocalSystemPrompt = () => useSettingsStore((state) => state.localInference.systemPrompt);
export const useLocalParticipantSystemPrompt = () => useSettingsStore((state) => state.localInference.participantSystemPrompt);
export const useLocalUseTemplateMode = () => useSettingsStore((state) => state.localInference.useTemplateMode);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(settings): resolveTranslationWorkerType helper + local prompt hooks"
```

---

## Task 5: Thread `systemPrompt` + `wrapTranscript` through engine & workers

**Files:**
- Modify: `src/lib/local-inference/engine/TranslationEngine.ts`
- Modify: `src/lib/local-inference/workers/qwen-translation.worker.ts`
- Modify: `src/lib/local-inference/workers/qwen35-translation.worker.ts`
- Modify: `src/services/clients/LocalInferenceClient.ts`

Makes `TranslationEngine.translate()` accept the resolved prompt + wrap flag. Updates the two Qwen workers to use them. Updates `LocalInferenceClient` to supply them on every call.

**Important:** The store selector isn't invoked inside the worker — the main thread resolves the prompt once per session (or per call) and passes it down. This keeps workers pure.

- [ ] **Step 1: Update `TranslationEngine.translate()` signature**

In `src/lib/local-inference/engine/TranslationEngine.ts`, locate the `translate` method (around line 171) and replace with:

```typescript
/**
 * Translate text. Returns a Promise with the result.
 *
 * @param text              The source text to translate.
 * @param systemPrompt      Resolved system prompt. Ignored by non-LLM workers (opus-mt, translategemma).
 * @param wrapTranscript    If true, wrap user message in <transcript> tags. Ignored by non-LLM workers.
 */
async translate(text: string, systemPrompt: string, wrapTranscript: boolean): Promise<TranslationResult> {
  if (!this.worker || !this.isReady) {
    throw new Error('TranslationEngine not initialized. Call init() first.');
  }

  const id = `tr_${++this.requestCounter}`;

  return new Promise((resolve, reject) => {
    this.pendingRequests.set(id, { resolve, reject });
    this.worker!.postMessage({
      type: 'translate',
      id,
      text,
      sourceLang: this.sourceLang,
      targetLang: this.targetLang,
      systemPrompt,
      wrapTranscript,
    });
  });
}
```

- [ ] **Step 2: Update the Qwen worker message type and handler**

In `src/lib/local-inference/workers/qwen-translation.worker.ts`:

1. Remove the local `LANG_NAMES` / `NATIVE_NAMES` / `LANG_FILLERS` constants (lines ~17-43) — they now live in `prompts.ts`. Replace with:
   ```typescript
   import { buildDefaultLocalPrompt } from '../prompts';
   ```

2. Update `TranslateMessage` (around line 57):
   ```typescript
   interface TranslateMessage {
     type: 'translate';
     id: string;
     text: string;
     sourceLang: string;
     targetLang: string;
     systemPrompt: string;
     wrapTranscript: boolean;
   }
   ```

3. Replace the body of `handleTranslate` (lines ~144-215) — keep only the prep that's still needed, then use the passed-in values:

```typescript
async function handleTranslate(msg: TranslateMessage) {
  if (!generator) {
    self.postMessage({ type: 'error', id: msg.id, error: 'Qwen model not loaded' });
    return;
  }

  try {
    const startTime = performance.now();

    // /no_think is Qwen3-specific; Qwen2.5 doesn't understand it
    const isQwen3 = currentModelId.toLowerCase().includes('qwen3');
    const resolvedPrompt = msg.systemPrompt && msg.systemPrompt.trim()
      ? msg.systemPrompt
      : buildDefaultLocalPrompt(msg.sourceLang, msg.targetLang);
    const systemPrompt = isQwen3 ? `${resolvedPrompt} /no_think` : resolvedPrompt;

    const userContent = msg.wrapTranscript
      ? `<transcript>${msg.text}</transcript>`
      : msg.text;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    const result = await generator(messages, {
      max_new_tokens: 256,
      do_sample: false,
      temperature: 0.0,
      tokenizer_encode_kwargs: { enable_thinking: false },
    });

    const elapsed = Math.round(performance.now() - startTime);

    let translatedText = '';
    if (Array.isArray(result) && result.length > 0) {
      const output = result[0] as any;
      if (output.generated_text) {
        if (Array.isArray(output.generated_text)) {
          const lastMsg = output.generated_text[output.generated_text.length - 1];
          translatedText = lastMsg?.content || '';
        } else {
          translatedText = output.generated_text;
        }
      }
    }

    translatedText = translatedText.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

    self.postMessage({
      type: 'result',
      id: msg.id,
      sourceText: msg.text,
      translatedText,
      inferenceTimeMs: elapsed,
      systemPrompt,
    });
  } catch (error: any) {
    self.postMessage({ type: 'error', id: msg.id, error: error.message || String(error) });
  }
}
```

- [ ] **Step 3: Apply the same changes to `qwen35-translation.worker.ts`**

In `src/lib/local-inference/workers/qwen35-translation.worker.ts`:

1. Remove any inline `LANG_NAMES` / `NATIVE_NAMES` / `LANG_FILLERS` constants (if present; structure mirrors `qwen-translation.worker.ts`).
2. Add the import: `import { buildDefaultLocalPrompt } from '../prompts';`
3. Update `TranslateMessage` to include `systemPrompt: string; wrapTranscript: boolean;`.
4. Replace the `handleTranslate` prompt-building block with the same logic as Step 2 above.

The exact existing prompt text lives at `qwen35-translation.worker.ts:180` — after edit, the inline prompt construction (lines ~180-184) is replaced by the `resolvedPrompt`/`userContent` lines shown above. Keep the `/no_think` check using `currentModelId.toLowerCase().includes('qwen3')` (Qwen 3.5 matches).

- [ ] **Step 4: Extend `LocalInferenceSessionConfig` with `wrapTranscript`**

Find the type definition with: `grep -rn "LocalInferenceSessionConfig" src/types src/services src/stores | grep -v ".test."` — it's likely in `src/types/Provider.ts` or a sibling file.

Add an optional field:

```typescript
export interface LocalInferenceSessionConfig {
  // ... existing fields ...
  wrapTranscript?: boolean;  // Simple mode = true (wrap in <transcript>), Advanced = false (bare)
}
```

In `createLocalInferenceSessionConfig` (`src/stores/settingsStore.ts`, around line 520), add `wrapTranscript` to the returned object:

```typescript
return {
  provider: 'local_inference',
  model: 'local-asr-translate',
  instructions: systemInstructions,
  // ... other existing fields ...
  wrapTranscript: settings.useTemplateMode,  // Simple=wrap, Advanced=bare
};
```

- [ ] **Step 5: Update `LocalInferenceClient.processPipelineJob` call site**

In `src/services/clients/LocalInferenceClient.ts`, around line 477 where `this.translationEngine.translate(job.text)` is called, replace with:

```typescript
const resolvedPrompt = this.config?.instructions || '';
const wrapTranscript = this.config?.wrapTranscript ?? true;
const translationResult = await this.translationEngine.translate(
  job.text,
  resolvedPrompt,
  wrapTranscript,
);
```

No new fields or methods on the class — `this.config` already carries the session config (set during `connect()`). Default to `true` when undefined (backward compatibility for any callers that forget to set it).

- [ ] **Step 6: Run all existing tests — nothing should regress**

Run: `npm run test`
Expected: all existing tests PASS. (New tests from Tasks 1 and 3 already pass; this task doesn't add tests — only refactors.)

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-inference/engine/TranslationEngine.ts \
        src/lib/local-inference/workers/qwen-translation.worker.ts \
        src/lib/local-inference/workers/qwen35-translation.worker.ts \
        src/services/clients/LocalInferenceClient.ts \
        src/stores/settingsStore.ts \
        src/types/Provider.ts
git commit -m "feat(local-inference): thread systemPrompt and wrapTranscript through pipeline"
```

Adjust the `git add` list if `wrapTranscript` turned out to live in a different types file.

---

## Task 6: Route MainPanel to use `getProcessedLocalPrompt` for local provider

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Modify: `src/stores/settingsStore.ts` (participant path)

Currently MainPanel unconditionally calls `getProcessedSystemInstructions(forParticipant)` and passes the result into `createSessionConfig`. For local provider, swap the call so the local selector wins.

- [ ] **Step 1: Import the local selector**

In `src/components/MainPanel/MainPanel.tsx`, around the other settings imports (line 32 area), add:

```typescript
import { useGetProcessedLocalPrompt } from '../../stores/settingsStore';
```

- [ ] **Step 2: Use the local selector when provider is LOCAL_INFERENCE**

Locate `getSessionConfig` (line 226) and `createParticipantSessionConfig` (line 333). For each, replace the `getProcessedSystemInstructions(...)` call with a provider-aware resolver:

```typescript
const getProcessedLocalPrompt = useGetProcessedLocalPrompt();

// Inside getSessionConfig:
const systemInstructions = provider === Provider.LOCAL_INFERENCE
  ? getProcessedLocalPrompt(false)
  : getProcessedSystemInstructions();

return createSessionConfig(systemInstructions);
```

And in `createParticipantSessionConfig`:

```typescript
const swappedSystemInstructions = provider === Provider.LOCAL_INFERENCE
  ? getProcessedLocalPrompt(true)
  : getProcessedSystemInstructions(true);
const baseConfig = createSessionConfig(swappedSystemInstructions);
```

Remember to update the `useCallback` dependency arrays — add `getProcessedLocalPrompt` and `provider`.

- [ ] **Step 3: Handle `createParticipantLocalInferenceConfig` participant prompt**

In `src/stores/settingsStore.ts`, locate `createParticipantLocalInferenceConfig` (around line 589). This function receives the already-swapped `baseConfig` from MainPanel, so `baseConfig.instructions` is **already** the participant prompt (MainPanel passed `getProcessedLocalPrompt(true)` into `createSessionConfig` which stored it as `instructions`).

**Verify** that `createParticipantLocalInferenceConfig` does not overwrite `instructions`. If it does, preserve the caller-supplied value. Otherwise no change needed.

Also verify the `wrapTranscript` field on `baseConfig` is preserved through participant wrapping. If `createParticipantLocalInferenceConfig` returns a new object, explicitly carry `wrapTranscript` through:

```typescript
return {
  success: true,
  config: {
    ...baseConfig,
    // ... participant-specific overrides ...
    instructions: baseConfig.instructions,    // preserve participant prompt
    wrapTranscript: baseConfig.wrapTranscript, // preserve wrap setting
  },
  status,
};
```

- [ ] **Step 4: Build + manual quick check**

Run: `npm run build`
Expected: succeeds.

Run: `npx tsc --noEmit`
Expected: no errors.

(There's no automated test for the MainPanel wiring — it's exercised via the manual smoke test in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/stores/settingsStore.ts
git commit -m "feat(mainpanel): route LOCAL_INFERENCE sessions through getProcessedLocalPrompt"
```

---

## Task 7: Translation Prompt UI section in `ProviderSpecificSettings`

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx`

Adds a new section inside the local-inference block. Simple mode shows a collapsible read-only preview; Advanced mode shows two freeform textareas. Section grays out when the resolved translation worker type isn't `qwen` / `qwen35`.

Reuses existing `system-instructions-section` SCSS classes from the cloud section (same look & feel).

- [ ] **Step 1: Import new hooks and helper**

In `src/components/Settings/sections/ProviderSpecificSettings.tsx`, extend the existing imports from `settingsStore`:

```typescript
import {
  // ... existing imports ...
  useLocalSystemPrompt,
  useLocalParticipantSystemPrompt,
  useLocalUseTemplateMode,
  useGetProcessedLocalPrompt,
  resolveTranslationWorkerType,
} from '../../../stores/settingsStore';
```

- [ ] **Step 2: Wire hooks inside the component**

Inside `ProviderSpecificSettings` (near line 74 where other hooks are called), add:

```typescript
const localSystemPrompt = useLocalSystemPrompt();
const localParticipantSystemPrompt = useLocalParticipantSystemPrompt();
const localUseTemplateMode = useLocalUseTemplateMode();
const getProcessedLocalPrompt = useGetProcessedLocalPrompt();

const [isLocalPromptPreviewExpanded, setIsLocalPromptPreviewExpanded] = React.useState(true);

const resolvedWorkerType = React.useMemo(
  () => resolveTranslationWorkerType(localInferenceSettings),
  [localInferenceSettings.translationModel, localInferenceSettings.sourceLanguage, localInferenceSettings.targetLanguage],
);
const localPromptSupported = resolvedWorkerType === 'qwen' || resolvedWorkerType === 'qwen35';
```

- [ ] **Step 3: Add the section JSX**

Locate `renderLocalInferenceSettings()` (search the file for it). Inside, between the Turn Detection section and the VAD section (i.e., high in the local block), insert:

```tsx
<div
  className={`settings-section system-instructions-section ${!localPromptSupported ? 'disabled' : ''}`}
  id="local-translation-prompt-section"
>
  <h2>
    {t('settings.localTranslationPrompt', 'Translation Prompt')}
    <Tooltip
      content={t('settings.localTranslationPromptTooltip', 'Customize how the local translation model is instructed. Only applies to Qwen-family models.')}
      position="top"
    >
      <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
    </Tooltip>
  </h2>

  {!localPromptSupported && (
    <div className="setting-item">
      <span className="setting-description">
        {t('settings.localPromptUnsupported', 'Current translation model does not support custom prompts. Switch to a Qwen-family model in Model Management to enable.')}
      </span>
    </div>
  )}

  <div className="setting-item">
    <div className="turn-detection-options">
      <button
        className={`option-button ${localUseTemplateMode ? 'active' : ''}`}
        onClick={() => updateLocalInferenceSettings({ useTemplateMode: true })}
        disabled={isSessionActive || !localPromptSupported}
      >
        {t('settings.simple')}
      </button>
      <button
        className={`option-button ${!localUseTemplateMode ? 'active' : ''}`}
        onClick={() => updateLocalInferenceSettings({ useTemplateMode: false })}
        disabled={isSessionActive || !localPromptSupported}
      >
        {t('settings.advanced')}
      </button>
    </div>
  </div>

  {localUseTemplateMode ? (
    <div className="setting-item">
      <div className="setting-label">
        <span>{t('settings.preview')}</span>
        <div
          className="preview-toggle"
          onClick={() => setIsLocalPromptPreviewExpanded(!isLocalPromptPreviewExpanded)}
        >
          {isLocalPromptPreviewExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
      </div>
      {isLocalPromptPreviewExpanded && (
        <div className="system-instructions-preview">
          <div className="preview-content">
            {getProcessedLocalPrompt(false)}
          </div>
        </div>
      )}
    </div>
  ) : (
    <>
      <div className="setting-item">
        <textarea
          className="system-instructions"
          placeholder={t('settings.enterCustomInstructions')}
          value={localSystemPrompt}
          onChange={(e) => updateLocalInferenceSettings({ systemPrompt: e.target.value })}
          disabled={isSessionActive || !localPromptSupported}
        />
      </div>
      <div className="setting-item">
        <div className="setting-label">
          <span>
            {t('settings.participantInstructions', 'Participant Instructions')}
            <Tooltip
              content={t('settings.participantInstructionsTooltip', 'System instructions for participant audio translation. Leave empty to use main instructions.')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
            </Tooltip>
          </span>
        </div>
        <textarea
          className="system-instructions"
          placeholder={t('settings.participantInstructionsTooltip')}
          value={localParticipantSystemPrompt}
          onChange={(e) => updateLocalInferenceSettings({ participantSystemPrompt: e.target.value })}
          disabled={isSessionActive || !localPromptSupported}
        />
      </div>
      <div className="setting-item">
        <span className="setting-description">
          {t('settings.localPromptNoThinkHint', 'For Qwen3 models, ` /no_think` will be automatically appended.')}
        </span>
      </div>
    </>
  )}
</div>
```

Ensure the `ChevronDown` / `ChevronRight` / `CircleHelp` / `Tooltip` imports are already present in the file (they are, used by the cloud section).

- [ ] **Step 4: Verify SCSS class `.disabled` provides the expected style**

Check whether `.settings-section.disabled` already exists in `ProviderSpecificSettings.scss` or a parent SCSS. If not, add this rule:

```scss
.settings-section.disabled {
  opacity: 0.5;
  pointer-events: none;

  .setting-description {
    color: var(--color-text-muted, #888);
  }
}
```

Place in `src/components/Settings/sections/ProviderSpecificSettings.scss` if it exists, or whichever SCSS file is already imported for this component.

- [ ] **Step 5: Build + visual check in dev server**

Run: `npm run dev`
Open browser, set provider to Local Inference. Verify:
- Translation Prompt section renders between Turn Detection and VAD
- Simple mode: clicking Simple hides textareas, shows preview of `getProcessedLocalPrompt(false)`
- Advanced mode: two textareas + `/no_think` hint visible
- Change translation model to Opus-MT (if available): section grays out and shows unsupported hint
- Change source/target language: Simple preview updates live

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx \
        src/components/Settings/sections/ProviderSpecificSettings.scss
git commit -m "feat(settings-ui): local translation prompt section with Simple/Advanced toggle"
```

Drop the SCSS path if no edit was needed there.

---

## Task 8: i18n keys (en + zh_CN) + manual smoke test

**Files:**
- Modify: `src/locales/en/translation.json`
- Modify: `src/locales/zh_CN/translation.json`

Adds the new i18n keys. Other locales fall back to English until a future PR backfills them.

- [ ] **Step 1: Add English keys**

In `src/locales/en/translation.json`, under the `settings.*` block (use `grep -n "participantInstructions" src/locales/en/translation.json` to find the right area), add:

```json
"localTranslationPrompt": "Translation Prompt",
"localTranslationPromptTooltip": "Customize how the local translation model is instructed. Only applies to Qwen-family models.",
"localPromptUnsupported": "Current translation model does not support custom prompts. Switch to a Qwen-family model in Model Management to enable.",
"localPromptNoThinkHint": "For Qwen3 models, ` /no_think` will be automatically appended."
```

Preserve JSON structure and trailing commas per the file's existing style.

- [ ] **Step 2: Add Simplified Chinese keys**

In `src/locales/zh_CN/translation.json`, add the same keys with translations:

```json
"localTranslationPrompt": "翻译 Prompt",
"localTranslationPromptTooltip": "自定义本地翻译模型收到的系统指令。仅对 Qwen 系列模型生效。",
"localPromptUnsupported": "当前翻译模型不支持自定义 prompt。在「模型管理」中切换到 Qwen 系列模型后可用。",
"localPromptNoThinkHint": "Qwen3 模型会自动追加 ` /no_think`。"
```

- [ ] **Step 3: Run tests — nothing should regress**

Run: `npm run test`
Expected: all PASS.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`

Execute these checks; each must pass before merging:

1. **Regression for motivating bug:** Provider = Local Inference, translation model = Qwen3 0.6B, src=zh, tgt=en, Simple mode. Start session, speak "我想问一些问题" (or send via text if a text input is available). Expect: output is English translation, not a chat-style reply.
2. **Default fallback on empty Advanced:** Switch to Advanced, clear the Speaker textarea entirely. Behavior matches Simple mode (same output for the same input).
3. **Custom prompt takes effect:** Fill Speaker with "You are a translator. Always translate to ALL CAPS English." — output for "你好" is `HELLO`-ish uppercase.
4. **Unsupported gating:** Switch translation model to an Opus-MT entry (or TranslateGemma). The Translation Prompt section grays out and shows `localPromptUnsupported` text. Toggle buttons and textareas are non-interactive.
5. **Language-swap live preview:** In Simple mode, swap source↔target in LanguageSection. Preview text updates immediately.
6. **Session-active lock:** Start a session; toggles/textareas/preview-toggle all `disabled`.
7. **Participant direction:** Enable system audio capture (participant). Verify participant translations occur in the reverse direction and don't crash.

If all 7 pass, proceed to commit. If any fail, file follow-up tasks — do not force-merge.

- [ ] **Step 5: Commit**

```bash
git add src/locales/en/translation.json src/locales/zh_CN/translation.json
git commit -m "i18n: local translation prompt strings (en, zh_CN)"
```

- [ ] **Step 6: Final verification pass**

Run: `npm run test && npx tsc --noEmit && npm run build`
Expected: all green.

If green, the feature is ready for PR.

---

## Summary of files touched

**New:**
- `src/lib/local-inference/prompts.ts`
- `src/lib/local-inference/prompts.test.ts`

**Modified:**
- `src/stores/settingsStore.ts` (fields, selector, helper, hooks, session config wrapTranscript)
- `src/stores/settingsStore.test.ts` (selector tests)
- `src/lib/local-inference/engine/TranslationEngine.ts` (translate signature)
- `src/lib/local-inference/workers/qwen-translation.worker.ts` (drop inline tables, consume message fields)
- `src/lib/local-inference/workers/qwen35-translation.worker.ts` (same)
- `src/services/clients/LocalInferenceClient.ts` (pass prompt + wrap flag into translate call)
- `src/types/Provider.ts` or equivalent (add `wrapTranscript?: boolean` to `LocalInferenceSessionConfig`)
- `src/components/MainPanel/MainPanel.tsx` (route to local selector when provider is LOCAL_INFERENCE)
- `src/components/Settings/sections/ProviderSpecificSettings.tsx` (new Translation Prompt section)
- `src/components/Settings/sections/ProviderSpecificSettings.scss` *(only if `.disabled` style missing)*
- `src/locales/en/translation.json`
- `src/locales/zh_CN/translation.json`
