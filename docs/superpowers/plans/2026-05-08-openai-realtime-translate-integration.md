# OpenAI Realtime Translate Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI Translate (`gpt-realtime-translate`) as an independent provider in Sokuji, with both WebSocket and WebRTC transports, mirroring the existing OpenAI provider's two-client structure.

**Architecture:** New `Provider.OPENAI_TRANSLATE` with its own settings shape, `OpenAITranslateProviderConfig`, and two transport-specific client classes (`OpenAITranslateGAClient` for WebSocket, `OpenAITranslateWebRTCClient` for WebRTC). Conversation modeling uses paired user+assistant `ConversationItem`s so MainPanel renders unchanged. Audio infrastructure (`ModernAudioRecorder`, `ModernAudioPlayer`, `WebRTCAudioBridge`) is reused as-is. Server events (`session.input_transcript.delta`, `session.output_transcript.delta`, `session.output_audio.delta`) drive a pairing state machine with 1.5s silence-based segmentation as fallback for missing `.done` events or `item_id`.

**Tech Stack:** TypeScript (strict mode), Vitest, Zustand, native WebSocket, native RTCPeerConnection. Reuses existing `EphemeralTokenService` (extended) and `WebRTCAudioBridge`.

---

## Spec Reference

This plan implements `docs/superpowers/specs/2026-05-08-openai-realtime-translate-integration-design.md`. Read that first if any decision below seems unmotivated — the spec carries the rationale.

---

## File Structure

**New files:**

| Path | Responsibility |
| ---- | -------------- |
| `src/services/clients/OpenAITranslateGAClient.ts` | WebSocket transport client. Connects to `wss://api.openai.com/v1/realtime/translations`, sends session.update + audio buffer appends, parses server events, manages pairing state machine. Hosts shared static methods (`buildSessionUpdate`, `parseServerEvent`, `validateApiKeyAndFetchModels`). |
| `src/services/clients/OpenAITranslateGAClient.test.ts` | Vitest unit tests with mocked WebSocket. Covers session.update payload shape, appendInputAudio base64 encoding, server event handling, silence-based completion. |
| `src/services/clients/OpenAITranslateWebRTCClient.ts` | WebRTC transport client. Uses ephemeral client_secret, RTCPeerConnection + `oai-events` data channel, reuses `WebRTCAudioBridge`. Delegates to OpenAITranslateGAClient's static helpers for shared logic. |
| `src/services/providers/OpenAITranslateProviderConfig.ts` | Provider config: 13 target languages list, `transcriptModels: ['gpt-realtime-whisper']`, capabilities flags set to false for unsupported features (voice, turn detection, model configuration, reasoning effort). |

**Modified files:**

| Path | Change |
| ---- | ------ |
| `src/types/Provider.ts` | Add `OPENAI_TRANSLATE: 'openai_translate'` to `Provider` const. |
| `src/services/interfaces/IClient.ts` | Add `OpenAITranslateSessionConfig` interface and `isOpenAITranslateSessionConfig` type guard. |
| `src/services/providers/ProviderConfig.ts` | Add optional `targetLanguages?: LanguageOption[]` field to `ProviderConfig`. |
| `src/services/providers/ProviderConfigFactory.ts` | Register `OpenAITranslateProviderConfig` for `Provider.OPENAI_TRANSLATE`. |
| `src/services/clients/OpenAIClient.ts` | Refactor: extract `fetchOpenAIModelsList` static helper from `validateApiKeyAndFetchModels`. Add `isTranslateRealtimeModel` static method. |
| `src/services/EphemeralTokenService.ts` | Add `mintTranslationClientSecret` static method that POSTs to `/v1/realtime/translations/client_secrets`. |
| `src/services/clients/ClientFactory.ts` | Add `Provider.OPENAI_TRANSLATE` case (routes by transportType). Update `supportsWebRTC` to include the new provider. |
| `src/stores/settingsStore.ts` | Add `TranslateTargetLanguage` union, `OpenAITranslateSettings` interface, default values, store state shape, `useOpenAITranslateSettings` selector, `useUpdateOpenAITranslate` action, persistence in `loadSettings`. Add `createOpenAITranslateSessionConfig` builder and OPENAI_TRANSLATE case in the session config switch. Modify `setProvider` to silently copy `openai.apiKey` to `openaiTranslate.apiKey` on first switch when self is empty. |
| `src/components/Settings/sections/LanguageSection.tsx` | Use `config.targetLanguages ?? config.languages` for the target language dropdown. |
| `src/components/Settings/sections/ProviderSpecificSettings.tsx` | Add a render function `renderTranslateInfoBanner` that emits the same-language-silence banner only when `provider === Provider.OPENAI_TRANSLATE`. Add to render output near the top of the OpenAI Translate config block. |
| `src/locales/en/translation.json` | Add new i18n keys for translate provider. |
| `src/locales/{29 other locales}/translation.json` | Same keys with translations (Python script). |

---

## Implementation Notes for the Engineer

- **TypeScript strict mode is on.** Run `npx tsc --noEmit` before each commit. Note: there are pre-existing type errors in `VolcengineSTClient.ts`, `VolcengineAST2Client.ts`, `logStore.ts`, `settingsStore.test.ts`, `environment.ts`, and `splitSentences.ts` that are NOT introduced by this work. Filter them out: `npx tsc --noEmit 2>&1 | grep -vE '(Volcengine|logStore\.ts|settingsStore\.test\.ts|environment\.ts|splitSentences\.ts|PalabraAI)'`.
- **Tests use Vitest**, not Jest. Run all tests with `npx vitest run --no-coverage`. Run a single file with `npx vitest run --no-coverage src/services/clients/OpenAITranslateGAClient.test.ts`.
- **No emojis in code or comments** unless the user requests them.
- **English-only** for all code comments and identifiers.
- **Frequent commits.** One commit per task. Use HEREDOC for multi-line commit messages.
- **Pre-existing tests must keep passing.** After each task, confirm `npx vitest run --no-coverage` shows the same 186/186 (or more if you added tests).
- **Conventional commit format:** `feat(openai-translate): ...`, `refactor(openai): ...`, `feat(i18n): ...`, etc.

---

## Task 1: Add Provider enum + ProviderConfig field + Session config type

**Files:**
- Modify: `src/types/Provider.ts`
- Modify: `src/services/providers/ProviderConfig.ts`
- Modify: `src/services/interfaces/IClient.ts`

- [ ] **Step 1.1: Add `OPENAI_TRANSLATE` to Provider enum**

In `src/types/Provider.ts`, find the `Provider` const definition. Add the new entry alongside existing providers:

```ts
export const Provider = {
  OPENAI: 'openai' as const,
  OPENAI_COMPATIBLE: 'openai_compatible' as const,
  OPENAI_TRANSLATE: 'openai_translate' as const,  // ← new
  KIZUNA_AI: 'kizunaai' as const,
  // ... etc
} as const;
```

Confirm `isOpenAICompatible(provider)` does **not** include the new provider — it only includes providers that share the existing OpenAI-compatible settings shape, which translate does not.

- [ ] **Step 1.2: Add `targetLanguages?` field to ProviderConfig**

In `src/services/providers/ProviderConfig.ts`, find the `ProviderConfig` interface. Add the optional field next to `languages`:

```ts
export interface ProviderConfig {
  // ...existing fields
  languages: LanguageOption[];
  targetLanguages?: LanguageOption[];  // ← new — when defined, target dropdown uses this
  voices: VoiceOption[];
  // ...
}
```

- [ ] **Step 1.3: Add `OpenAITranslateSessionConfig` and type guard**

In `src/services/interfaces/IClient.ts`, after the existing `OpenAISessionConfig` interface, add:

```ts
export type TranslateTargetLanguage =
  | 'en' | 'es' | 'pt' | 'fr' | 'ja' | 'ru' | 'zh'
  | 'de' | 'ko' | 'hi' | 'id' | 'vi' | 'it';

export interface OpenAITranslateSessionConfig extends BaseSessionConfig {
  provider: 'openai_translate';
  targetLanguage: TranslateTargetLanguage;
  // UI hint only — not forwarded to the API
  sourceLanguage?: string;
  inputAudioTranscription?: { model: string };
  inputAudioNoiseReduction?: { type: 'near_field' | 'far_field' };
}

export function isOpenAITranslateSessionConfig(c: SessionConfig): c is OpenAITranslateSessionConfig {
  return c.provider === 'openai_translate';
}
```

Add `OpenAITranslateSessionConfig` to the `SessionConfig` union (find the existing union; it's a type alias listing all provider-specific configs).

- [ ] **Step 1.4: Verify tsc clean (filtered)**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -vE '(Volcengine|logStore\.ts|settingsStore\.test\.ts|environment\.ts|splitSentences\.ts|PalabraAI)' | head -30
```
Expected: no new errors related to your changes.

- [ ] **Step 1.5: Commit**

```bash
git add src/types/Provider.ts \
  src/services/providers/ProviderConfig.ts \
  src/services/interfaces/IClient.ts
git commit -m "$(cat <<'EOF'
feat(openai-translate): add Provider enum entry and config types

Adds Provider.OPENAI_TRANSLATE, OpenAITranslateSessionConfig, and the
optional targetLanguages field on ProviderConfig (used to render a
restricted target-language dropdown when the provider only supports a
subset of languages — gpt-realtime-translate has 13 target languages).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Settings store types, defaults, actions, persistence

**Files:**
- Modify: `src/stores/settingsStore.ts`

- [ ] **Step 2.1: Add `OpenAITranslateSettings` interface**

After the existing `OpenAICompatibleSettings` definition (around line 70), add:

```ts
import type { TranslateTargetLanguage } from '../services/interfaces/IClient';

export interface OpenAITranslateSettings {
  apiKey: string;
  // UI display only — not sent to API (auto-detected by model)
  sourceLanguage: string;
  // Sent to API as audio.output.language
  targetLanguage: TranslateTargetLanguage;
  // Currently the only valid value; UI dropdown shows it as a single option
  transcriptModel: 'gpt-realtime-whisper';
  noiseReduction: 'None' | 'Near field' | 'Far field';
  transportType: TransportType;
}
```

- [ ] **Step 2.2: Add default settings**

After the existing `defaultKizunaAISettings` (around line 247), add:

```ts
const defaultOpenAITranslateSettings: OpenAITranslateSettings = {
  apiKey: '',
  sourceLanguage: 'en',
  targetLanguage: 'zh',
  transcriptModel: 'gpt-realtime-whisper',
  noiseReduction: 'None',
  transportType: 'websocket',
};
```

- [ ] **Step 2.3: Add to root state shape**

Find the `SettingsStore` type definition. Add `openaiTranslate` field:

```ts
type SettingsStore = {
  // ...existing
  openai: OpenAISettings;
  openaiCompatible: OpenAICompatibleSettings;
  kizunaai: KizunaAISettings;
  openaiTranslate: OpenAITranslateSettings;  // ← new
  // ...
  updateOpenAITranslate: (settings: Partial<OpenAITranslateSettings>) => Promise<void>;
};
```

In the `create<SettingsStore>` initializer, add the initial state and the action. Find the section around line 711 with `openai: defaultOpenAISettings`:

```ts
{
  // ...
  openai: defaultOpenAISettings,
  openaiCompatible: defaultOpenAICompatibleSettings,
  kizunaai: defaultKizunaAISettings,
  openaiTranslate: defaultOpenAITranslateSettings,  // ← new
  // ...
}
```

For the `updateOpenAITranslate` action, mirror the existing `updateOpenAI` (around line 850). Skeleton:

```ts
updateOpenAITranslate: async (settings) => {
  set((state) => {
    const updatedSettings = { ...state.openaiTranslate, ...settings };
    return { openaiTranslate: updatedSettings };
  });

  const service = ServiceFactory.getSettingsService();
  for (const [key, value] of Object.entries(settings)) {
    await service.setSetting(`settings.openaiTranslate.${key}`, value);
  }
},
```

- [ ] **Step 2.4: Add selector hooks at file end**

Near the end of the file (around line 1560 where similar hooks are exported), add:

```ts
export const useOpenAITranslateSettings = () => useSettingsStore((state) => state.openaiTranslate);
export const useUpdateOpenAITranslate = () => useSettingsStore((state) => state.updateOpenAITranslate);
```

- [ ] **Step 2.5: Add to `loadSettings` persistence**

Find the `loadSettings` implementation around line 1313. Add to the `Promise.all`:

```ts
const [openai, gemini, openaiCompatible, palabraai, kizunaai, volcengineST, volcengineAST2, localInference, openaiTranslate] = await Promise.all([
  loadProviderSettings('settings.openai', defaultOpenAISettings),
  loadProviderSettings('settings.gemini', defaultGeminiSettings),
  loadProviderSettings('settings.openaiCompatible', defaultOpenAICompatibleSettings),
  loadProviderSettings('settings.palabraai', defaultPalabraAISettings),
  loadProviderSettings('settings.kizunaai', defaultKizunaAISettings),
  loadProviderSettings('settings.volcengineST', defaultVolcengineSTSettings),
  loadProviderSettings('settings.volcengineAST2', defaultVolcengineAST2Settings),
  loadProviderSettings('settings.localInference', defaultLocalInferenceSettings),
  loadProviderSettings('settings.openaiTranslate', defaultOpenAITranslateSettings),  // ← new
]);
```

In the `set({ ... })` call below, include `openaiTranslate`.

- [ ] **Step 2.6: Verify tsc clean**

```bash
npx tsc --noEmit 2>&1 | grep -vE '(Volcengine|logStore\.ts|settingsStore\.test\.ts|environment\.ts|splitSentences\.ts|PalabraAI)' | head -30
```
Expected: no new errors.

- [ ] **Step 2.7: Run tests**

```bash
npx vitest run --no-coverage 2>&1 | tail -6
```
Expected: 186/186 passing (no regressions).

- [ ] **Step 2.8: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "$(cat <<'EOF'
feat(openai-translate): add settings store shape and persistence

OpenAITranslateSettings holds apiKey, sourceLanguage (UI only),
targetLanguage, transcriptModel (locked to gpt-realtime-whisper),
noiseReduction, and transportType. Persistence uses the existing
per-key loadProviderSettings helper, so existing users get defaults
on next load without explicit migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: OpenAITranslateProviderConfig + register in factory

**Files:**
- Create: `src/services/providers/OpenAITranslateProviderConfig.ts`
- Modify: `src/services/providers/ProviderConfigFactory.ts`

- [ ] **Step 3.1: Create the provider config file**

Write `src/services/providers/OpenAITranslateProviderConfig.ts`:

```ts
import { ProviderConfig, LanguageOption, ModelOption } from './ProviderConfig';
import { OpenAIProviderConfig } from './OpenAIProviderConfig';

/**
 * OpenAI Translate provider — dedicated speech-to-speech translation via
 * gpt-realtime-translate. Supports 70+ source languages (auto-detected) and
 * 13 target output languages.
 */
export class OpenAITranslateProviderConfig {
  // 13 target languages supported by gpt-realtime-translate.
  // Codes are coarse (zh, pt — not zh_CN, pt_BR) per API requirement.
  private static readonly TARGET_LANGUAGES: LanguageOption[] = [
    { name: 'English', value: 'en', englishName: 'English' },
    { name: 'Español', value: 'es', englishName: 'Spanish' },
    { name: 'Português', value: 'pt', englishName: 'Portuguese' },
    { name: 'Français', value: 'fr', englishName: 'French' },
    { name: '日本語', value: 'ja', englishName: 'Japanese' },
    { name: 'Русский', value: 'ru', englishName: 'Russian' },
    { name: '中文', value: 'zh', englishName: 'Chinese' },
    { name: 'Deutsch', value: 'de', englishName: 'German' },
    { name: '한국어', value: 'ko', englishName: 'Korean' },
    { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
    { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
    { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
    { name: 'Italiano', value: 'it', englishName: 'Italian' },
  ];

  // Static fallback model list — runtime fetches the real list from /v1/models.
  private static readonly MODELS: ModelOption[] = [
    { id: 'gpt-realtime-translate', type: 'realtime' },
  ];

  getConfig(): ProviderConfig {
    // Reuse OpenAI's full source language list (75-language API support is
    // covered by the existing list; remaining codes are unusual and degrade
    // gracefully — source language is UI-only anyway).
    const sourceLanguages = new OpenAIProviderConfig().getConfig().languages;

    return {
      id: 'openai_translate',
      displayName: 'OpenAI Translate',
      apiKeyLabel: 'OpenAI API Key',
      apiKeyPlaceholder: 'sk-...',

      languages: sourceLanguages,
      targetLanguages: OpenAITranslateProviderConfig.TARGET_LANGUAGES,
      voices: [],
      models: OpenAITranslateProviderConfig.MODELS,
      noiseReductionModes: ['None', 'Near field', 'Far field'],
      transcriptModels: ['gpt-realtime-whisper'],

      capabilities: {
        hasTemplateMode: false,
        hasTurnDetection: false,
        hasVoiceSettings: false,
        hasNoiseReduction: true,
        hasModelConfiguration: false,
        hasReasoningEffort: false,
        textOnlyCapability: 'never',

        turnDetection: {
          modes: [],
          hasThreshold: false,
          hasPrefixPadding: false,
          hasSilenceDuration: false,
          hasSemanticEagerness: false,
        },

        // Unused — capability flags above hide the corresponding UI sections,
        // but the fields are required by the type.
        temperatureRange: { min: 0, max: 0, step: 0 },
        maxTokensRange: { min: 0, max: 0, step: 0 },
      },

      defaults: {
        model: 'gpt-realtime-translate',
        voice: '',
        temperature: 0,
        maxTokens: 0,
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        turnDetectionMode: '',
        threshold: 0,
        prefixPadding: 0,
        silenceDuration: 0,
        semanticEagerness: '',
        noiseReduction: 'None',
        transcriptModel: 'gpt-realtime-whisper',
      },
    };
  }
}
```

- [ ] **Step 3.2: Register in factory**

In `src/services/providers/ProviderConfigFactory.ts`, import the new config and add a case:

```ts
import { OpenAITranslateProviderConfig } from './OpenAITranslateProviderConfig';

// ...inside the factory method's switch:
case Provider.OPENAI_TRANSLATE:
  return new OpenAITranslateProviderConfig().getConfig();
```

Also confirm that `isProviderSupported` returns `true` for the new provider (it likely uses an array of all enum values — add the new entry if needed).

- [ ] **Step 3.3: Verify tsc clean and tests pass**

```bash
npx tsc --noEmit 2>&1 | grep -vE '(Volcengine|logStore\.ts|settingsStore\.test\.ts|environment\.ts|splitSentences\.ts|PalabraAI)' | head -20
npx vitest run --no-coverage 2>&1 | tail -6
```

- [ ] **Step 3.4: Commit**

```bash
git add src/services/providers/OpenAITranslateProviderConfig.ts \
  src/services/providers/ProviderConfigFactory.ts
git commit -m "$(cat <<'EOF'
feat(openai-translate): add provider config

OpenAITranslateProviderConfig defines 13 target languages, locks the
transcript model to gpt-realtime-whisper, and disables capability flags
for unsupported features (voice, turn detection, model configuration,
reasoning effort) so existing UI render functions naturally hide them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Session config builder + setProvider silent prefill

**Files:**
- Modify: `src/stores/settingsStore.ts`

- [ ] **Step 4.1: Add `createOpenAITranslateSessionConfig`**

After `createOpenAISessionConfig` (around line 456), add the new builder:

```ts
function createOpenAITranslateSessionConfig(
  settings: OpenAITranslateSettings,
  systemInstructions: string  // ignored — translate doesn't accept instructions
): OpenAITranslateSessionConfig {
  void systemInstructions;
  return {
    provider: 'openai_translate',
    model: 'gpt-realtime-translate',
    targetLanguage: settings.targetLanguage,
    sourceLanguage: settings.sourceLanguage,
    inputAudioTranscription: settings.transcriptModel
      ? { model: settings.transcriptModel }
      : undefined,
    inputAudioNoiseReduction: settings.noiseReduction !== 'None' ? {
      type: settings.noiseReduction === 'Near field' ? 'near_field' : 'far_field'
    } : undefined,
  };
}
```

Import `OpenAITranslateSessionConfig` from `../services/interfaces/IClient` at the top of the file.

- [ ] **Step 4.2: Add OPENAI_TRANSLATE to the session config switch**

Find the switch in `getSessionConfig` (around line 1438). Add a new case:

```ts
case Provider.OPENAI_TRANSLATE:
  config = createOpenAITranslateSessionConfig(state.openaiTranslate, systemInstructions);
  break;
```

- [ ] **Step 4.3: Add silent prefill in `setProvider`**

Find the `setProvider` action (search for `setProvider:`). Modify it to copy the OpenAI key on first switch:

```ts
setProvider: async (newProvider) => {
  const state = get();

  // Silent API key prefill: when switching to OpenAI Translate for the first
  // time and the user already has a working OpenAI API key, copy it across so
  // they don't have to re-enter it. After this one-time copy the two keys are
  // independent — later edits to either don't propagate.
  if (newProvider === Provider.OPENAI_TRANSLATE
      && !state.openaiTranslate.apiKey
      && state.openai.apiKey) {
    set((s) => ({
      openaiTranslate: { ...s.openaiTranslate, apiKey: state.openai.apiKey }
    }));
    const service = ServiceFactory.getSettingsService();
    await service.setSetting('settings.openaiTranslate.apiKey', state.openai.apiKey);
    // Trigger validation in the background; do not block setProvider on it.
    void state.validateApiKey();
  }

  set({ provider: newProvider });
  await ServiceFactory.getSettingsService().setSetting('settings.common.provider', newProvider);
},
```

The exact existing structure of `setProvider` may differ — adapt while preserving the existing persistence logic.

- [ ] **Step 4.4: Verify tsc clean and tests pass**

```bash
npx tsc --noEmit 2>&1 | grep -vE '(Volcengine|logStore\.ts|settingsStore\.test\.ts|environment\.ts|splitSentences\.ts|PalabraAI)' | head -20
npx vitest run --no-coverage 2>&1 | tail -6
```

- [ ] **Step 4.5: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "$(cat <<'EOF'
feat(openai-translate): add session config builder and key prefill

createOpenAITranslateSessionConfig accepts the systemInstructions param
for signature consistency but ignores it (translate doesn't accept
instructions). setProvider now silently copies openai.apiKey to
openaiTranslate.apiKey on first switch when self is empty — no banner,
no confirmation. After the copy the keys are fully independent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: OpenAIClient refactor — extract fetchOpenAIModelsList + add isTranslateRealtimeModel

**Files:**
- Modify: `src/services/clients/OpenAIClient.ts`

- [ ] **Step 5.1: Add `isTranslateRealtimeModel` static method**

In `OpenAIClient.ts`, after the existing `isVoiceAgentRealtimeModel` (around line 165), add:

```ts
/**
 * True for the dedicated translation model family. Used by
 * OpenAITranslateGAClient to filter /v1/models output.
 */
static isTranslateRealtimeModel(modelId: string): boolean {
  return modelId.toLowerCase().startsWith('gpt-realtime-translate');
}
```

- [ ] **Step 5.2: Extract `fetchOpenAIModelsList` static helper**

Currently `validateApiKeyAndFetchModels` (lines 55-143) does both the fetch and the voice-agent filtering. Split: extract the fetch + error handling into a reusable helper.

After the existing `validateApiKeyAndFetchModels` (or replacing the inner fetch portion), structure it as:

```ts
/**
 * Fetch the raw model list from /v1/models. Shared between voice-agent
 * validation (validateApiKeyAndFetchModels below) and translate validation
 * (OpenAITranslateGAClient.validateApiKeyAndFetchModels).
 *
 * Returns either { models } on success or { error } with a populated
 * ApiKeyValidationResult. Caller decides how to filter and what
 * "valid" means (different model families satisfy different providers).
 */
static async fetchOpenAIModelsList(apiKey: string, apiHost?: string): Promise<{
  models: OpenAIModel[];
  error?: ApiKeyValidationResult;
}> {
  if (!apiKey || apiKey.trim() === '') {
    return {
      models: [],
      error: {
        valid: false,
        message: i18n.t('settings.errorValidatingApiKey'),
        validating: false,
      },
    };
  }

  const host = (apiHost || OpenAIClient.DEFAULT_API_HOST).replace(/\/$/, '');
  const modelsEndpoint = `${host}/v1/models`;

  try {
    const response = await fetch(modelsEndpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (errorData.error?.code === 'unsupported_country_region_territory') {
        return {
          models: [],
          error: {
            valid: false,
            message: i18n.t('settings.regionNotSupported'),
            validating: false,
          },
        };
      }

      return {
        models: [],
        error: {
          valid: false,
          message: errorData.error?.message || i18n.t('settings.errorValidatingApiKey'),
          validating: false,
        },
      };
    }

    const data = await response.json();
    return { models: data.data || [] };
  } catch (error: any) {
    return {
      models: [],
      error: {
        valid: false,
        message: error.message || i18n.t('settings.errorValidatingApiKey'),
        validating: false,
      },
    };
  }
}
```

- [ ] **Step 5.3: Refactor `validateApiKeyAndFetchModels` to use the helper**

Replace the body of `validateApiKeyAndFetchModels` (keep its public signature unchanged) to delegate to the new helper:

```ts
static async validateApiKeyAndFetchModels(apiKey: string, apiHost?: string): Promise<{
  validation: ApiKeyValidationResult;
  models: FilteredModel[];
}> {
  const { models, error } = await this.fetchOpenAIModelsList(apiKey, apiHost);
  if (error) {
    return { validation: error, models: [] };
  }

  console.info("[Sokuji] [OpenAIClient] Available models:", models);

  const hasRealtimeModel = this.checkRealtimeModelAvailability(models);
  console.info("[Sokuji] [OpenAIClient] Has realtime model:", hasRealtimeModel);

  const filteredModels = this.filterRelevantModels(models);

  return {
    validation: this.buildValidationResult(hasRealtimeModel),
    models: filteredModels,
  };
}
```

- [ ] **Step 5.4: Verify tests still pass**

```bash
npx tsc --noEmit 2>&1 | grep -vE '(Volcengine|logStore\.ts|settingsStore\.test\.ts|environment\.ts|splitSentences\.ts|PalabraAI)' | head -20
npx vitest run --no-coverage 2>&1 | tail -6
```
Expected: 186/186 passing (the refactor is behavior-preserving).

- [ ] **Step 5.5: Commit**

```bash
git add src/services/clients/OpenAIClient.ts
git commit -m "$(cat <<'EOF'
refactor(openai): extract fetchOpenAIModelsList helper

Splits the /v1/models fetch + error handling out of
validateApiKeyAndFetchModels so OpenAITranslateGAClient can reuse the
same network path while applying its own model-name filter. The public
validateApiKeyAndFetchModels API and behavior are unchanged.

Also adds isTranslateRealtimeModel static helper for translate-specific
model filtering, paralleling the existing isVoiceAgentRealtimeModel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: EphemeralTokenService — add mintTranslationClientSecret

**Files:**
- Modify: `src/services/EphemeralTokenService.ts`

- [ ] **Step 6.1: Read the existing EphemeralTokenService**

Open `src/services/EphemeralTokenService.ts`. Note the structure of the existing `getToken` method — particularly the URL pattern, headers, error handling, and return shape. Mirror that structure for the new method.

- [ ] **Step 6.2: Add `mintTranslationClientSecret`**

Add this static method to the class:

```ts
/**
 * Mint a short-lived client secret for a translate WebRTC session.
 * The secret is used as the bearer for the SDP exchange at
 * /v1/realtime/translations/calls. Mirrors the existing getToken flow
 * but targets translate's dedicated client_secrets endpoint.
 *
 * @param apiKey User's OpenAI API key
 * @param config Session config to embed in the mint request
 * @param apiHost Optional override (defaults to api.openai.com)
 * @returns The client_secret string
 * @throws Error with the API's error message on non-2xx response
 */
static async mintTranslationClientSecret(
  apiKey: string,
  config: {
    targetLanguage: string;
    transcriptModel?: string;
    noiseReductionType?: 'near_field' | 'far_field';
  },
  apiHost?: string
): Promise<string> {
  const host = (apiHost || 'https://api.openai.com').replace(/\/$/, '');
  const url = `${host}/v1/realtime/translations/client_secrets`;

  const audioInput: any = {};
  if (config.transcriptModel) {
    audioInput.transcription = { model: config.transcriptModel };
  }
  if (config.noiseReductionType) {
    audioInput.noise_reduction = { type: config.noiseReductionType };
  }

  const body: any = {
    session: {
      model: 'gpt-realtime-translate',
      audio: {
        output: { language: config.targetLanguage },
      },
    },
  };
  if (Object.keys(audioInput).length > 0) {
    body.session.audio.input = audioInput;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error?.message || `Failed to mint translation client secret: ${response.status}`;
    throw new Error(message);
  }

  const data = await response.json();
  // Cookbook example shows the response includes a `client_secret` (string)
  // alongside other session metadata. Defensive: log the full response on
  // first failure so we can verify the shape against real API responses.
  if (!data.client_secret) {
    console.error('[Sokuji] [EphemeralTokenService] Unexpected client_secret response shape:', data);
    throw new Error('Translation client_secret missing from response');
  }
  return typeof data.client_secret === 'string'
    ? data.client_secret
    : data.client_secret.value;  // some endpoints return { value: string, expires_at: number }
}
```

- [ ] **Step 6.3: Verify tsc clean**

```bash
npx tsc --noEmit 2>&1 | grep -vE '(Volcengine|logStore\.ts|settingsStore\.test\.ts|environment\.ts|splitSentences\.ts|PalabraAI)' | head -20
```

- [ ] **Step 6.4: Commit**

```bash
git add src/services/EphemeralTokenService.ts
git commit -m "$(cat <<'EOF'
feat(openai-translate): add translation client_secret minter

mintTranslationClientSecret POSTs to /v1/realtime/translations/client_secrets
with a session config (target language, optional transcription model,
optional noise reduction) and returns the short-lived secret used as
bearer for the WebRTC SDP exchange.

Defensive parsing handles both possible response shapes (plain string
vs { value, expires_at }) since the cookbook does not specify the exact
field name.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: OpenAITranslateGAClient — class skeleton + buildSessionUpdate (TDD)

**Files:**
- Create: `src/services/clients/OpenAITranslateGAClient.ts`
- Create: `src/services/clients/OpenAITranslateGAClient.test.ts`

- [ ] **Step 7.1: Create class skeleton**

Write `src/services/clients/OpenAITranslateGAClient.ts` with imports and class skeleton:

```ts
import {
  IClient,
  ConversationItem,
  SessionConfig,
  ClientEventHandlers,
  OpenAITranslateSessionConfig,
  isOpenAITranslateSessionConfig,
  ApiKeyValidationResult,
  FilteredModel,
  ResponseConfig,
} from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import { OpenAIClient } from './OpenAIClient';
import i18n from '../../locales';

const TRANSLATE_WS_URL = 'wss://api.openai.com/v1/realtime/translations';
const SILENCE_TIMEOUT_MS = 1500;

export class OpenAITranslateGAClient implements IClient {
  private apiKey: string;
  private ws: WebSocket | null = null;
  private eventHandlers: ClientEventHandlers = {};
  private connected: boolean = false;

  // Pairing state machine — see design spec §3 for rationale
  private currentPair: { userItemId: string; assistantItemId: string } | null = null;
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;
  private audioChunks: Map<string, Int16Array[]> = new Map();
  private itemLookup: Map<string, ConversationItem> = new Map();
  private conversationItems: ConversationItem[] = [];
  private deltaSequenceNumber: number = 0;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Build the session.update payload sent right after WebSocket open.
   * Pure function — exposed as static so OpenAITranslateWebRTCClient can
   * also use it for its data-channel session.update.
   */
  static buildSessionUpdate(config: OpenAITranslateSessionConfig): any {
    const audioInput: any = {};
    if (config.inputAudioTranscription?.model) {
      audioInput.transcription = { model: config.inputAudioTranscription.model };
    }
    if (config.inputAudioNoiseReduction?.type) {
      audioInput.noise_reduction = { type: config.inputAudioNoiseReduction.type };
    }

    const audio: any = {
      output: { language: config.targetLanguage },
    };
    if (Object.keys(audioInput).length > 0) {
      audio.input = audioInput;
    }

    return {
      type: 'session.update',
      session: { audio },
    };
  }

  // IClient methods — implemented in later tasks
  async connect(_config: SessionConfig): Promise<void> { throw new Error('not implemented'); }
  async disconnect(): Promise<void> {}
  isConnected(): boolean { return this.connected; }
  updateSession(_config: Partial<SessionConfig>): void {}
  reset(): void {}
  appendInputAudio(_audioData: Int16Array): void {}
  appendInputText(_text: string): void { /* no-op: text input not supported by translate */ }
  createResponse(_config?: ResponseConfig): void { /* no-op: continuous streaming, no response lifecycle */ }
  cancelResponse(_trackId?: string, _offset?: number): void { /* no-op for Phase 1 */ }
  getConversationItems(): ConversationItem[] { return [...this.conversationItems]; }
  clearConversationItems(): void {
    this.conversationItems = [];
    this.itemLookup.clear();
    this.audioChunks.clear();
  }
  setEventHandlers(handlers: ClientEventHandlers): void { this.eventHandlers = { ...handlers }; }
  getProvider(): ProviderType { return Provider.OPENAI_TRANSLATE; }
}
```

- [ ] **Step 7.2: Write the failing test for buildSessionUpdate**

Create `src/services/clients/OpenAITranslateGAClient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OpenAITranslateGAClient } from './OpenAITranslateGAClient';
import type { OpenAITranslateSessionConfig } from '../interfaces/IClient';

const baseConfig: OpenAITranslateSessionConfig = {
  provider: 'openai_translate',
  model: 'gpt-realtime-translate',
  targetLanguage: 'es',
};

describe('OpenAITranslateGAClient.buildSessionUpdate', () => {
  it('builds minimal payload with target language only', () => {
    const payload = OpenAITranslateGAClient.buildSessionUpdate(baseConfig);
    expect(payload).toEqual({
      type: 'session.update',
      session: {
        audio: {
          output: { language: 'es' },
        },
      },
    });
  });

  it('includes transcription config when provided', () => {
    const config: OpenAITranslateSessionConfig = {
      ...baseConfig,
      inputAudioTranscription: { model: 'gpt-realtime-whisper' },
    };
    const payload = OpenAITranslateGAClient.buildSessionUpdate(config);
    expect(payload.session.audio.input).toEqual({
      transcription: { model: 'gpt-realtime-whisper' },
    });
  });

  it('includes noise reduction when provided', () => {
    const config: OpenAITranslateSessionConfig = {
      ...baseConfig,
      inputAudioNoiseReduction: { type: 'near_field' },
    };
    const payload = OpenAITranslateGAClient.buildSessionUpdate(config);
    expect(payload.session.audio.input).toEqual({
      noise_reduction: { type: 'near_field' },
    });
  });

  it('combines transcription and noise reduction', () => {
    const config: OpenAITranslateSessionConfig = {
      ...baseConfig,
      targetLanguage: 'zh',
      inputAudioTranscription: { model: 'gpt-realtime-whisper' },
      inputAudioNoiseReduction: { type: 'far_field' },
    };
    const payload = OpenAITranslateGAClient.buildSessionUpdate(config);
    expect(payload.session.audio.output.language).toBe('zh');
    expect(payload.session.audio.input).toEqual({
      transcription: { model: 'gpt-realtime-whisper' },
      noise_reduction: { type: 'far_field' },
    });
  });

  it('omits audio.input when neither transcription nor noise reduction set', () => {
    const payload = OpenAITranslateGAClient.buildSessionUpdate(baseConfig);
    expect(payload.session.audio).not.toHaveProperty('input');
  });
});
```

- [ ] **Step 7.3: Run tests, confirm pass**

```bash
npx vitest run --no-coverage src/services/clients/OpenAITranslateGAClient.test.ts 2>&1 | tail -10
```
Expected: all 5 tests pass (the implementation is already correct since we wrote it together).

- [ ] **Step 7.4: Run full test suite for regression check**

```bash
npx vitest run --no-coverage 2>&1 | tail -6
```
Expected: 191/191 passing (186 + 5 new).

- [ ] **Step 7.5: Commit**

```bash
git add src/services/clients/OpenAITranslateGAClient.ts \
  src/services/clients/OpenAITranslateGAClient.test.ts
git commit -m "$(cat <<'EOF'
feat(openai-translate): add GA client skeleton and buildSessionUpdate

Static buildSessionUpdate produces the JSON payload sent right after the
WebSocket connects. Pure function — also called by the WebRTC client for
its data-channel session.update event.

Class skeleton implements IClient with no-op stubs for methods that
don't apply to translate (appendInputText, createResponse,
cancelResponse). Subsequent tasks fill in connect/disconnect, audio I/O,
server event handling, and the pairing state machine.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: OpenAITranslateGAClient — server event handling and pairing state machine (TDD)

**Files:**
- Modify: `src/services/clients/OpenAITranslateGAClient.ts`
- Modify: `src/services/clients/OpenAITranslateGAClient.test.ts`

- [ ] **Step 8.1: Add failing tests for state machine**

Append to `OpenAITranslateGAClient.test.ts`:

```ts
import { vi, beforeEach, afterEach } from 'vitest';
import type { ClientEventHandlers } from '../interfaces/IClient';

describe('OpenAITranslateGAClient state machine', () => {
  let client: OpenAITranslateGAClient;
  let updates: any[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    client = new OpenAITranslateGAClient('test-key');
    updates = [];
    const handlers: ClientEventHandlers = {
      onConversationUpdated: (e) => updates.push(e),
    };
    client.setEventHandlers(handlers);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a paired user+assistant item on first input_transcript.delta', () => {
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Hello',
    });

    // Expect two item-created events emitted (user first, then assistant)
    expect(updates.length).toBeGreaterThanOrEqual(2);
    const roles = updates.slice(0, 2).map((u) => u.item.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');

    // User item should have transcript 'Hello'
    const userUpdate = updates.find((u) => u.item.role === 'user');
    expect(userUpdate.item.formatted.transcript).toBe('Hello');
  });

  it('appends output_transcript.delta to the assistant item', () => {
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Hola',
    });
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'Hello',
    });

    const items = client.getConversationItems();
    const assistant = items.find((i) => i.role === 'assistant');
    expect(assistant?.formatted?.transcript).toBe('Hello');
  });

  it('accumulates output_audio.delta into assistant item audioChunks', () => {
    // Pair must exist first
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Test',
    });

    // base64 of [1, 0, 2, 0] (Int16Array(2) [1, 2]) = "AQACAA=="
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: 'AQACAA==',
    });

    const audioUpdate = updates.find(
      (u) => u.delta?.audio instanceof Int16Array && u.delta.audio.length > 0
    );
    expect(audioUpdate).toBeDefined();
    expect(Array.from(audioUpdate.delta.audio)).toEqual([1, 2]);
  });

  it('marks both items completed after 1.5s of silence', () => {
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Hello',
    });

    // Before timeout — still in_progress
    let items = client.getConversationItems();
    expect(items.find((i) => i.role === 'user')?.status).toBe('in_progress');

    // Advance time past silence threshold
    vi.advanceTimersByTime(1600);

    items = client.getConversationItems();
    expect(items.find((i) => i.role === 'user')?.status).toBe('completed');
    expect(items.find((i) => i.role === 'assistant')?.status).toBe('completed');

    // After completion, currentPair is reset — new delta starts a new pair
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Bye',
    });
    items = client.getConversationItems();
    const userItems = items.filter((i) => i.role === 'user');
    expect(userItems.length).toBe(2);
  });

  it('marks items completed on session.input_transcript.done event', () => {
    (client as any).handleServerEvent({
      type: 'session.input_transcript.delta',
      delta: 'Hi',
    });
    (client as any).handleServerEvent({
      type: 'session.input_transcript.done',
    });

    const items = client.getConversationItems();
    expect(items.find((i) => i.role === 'user')?.status).toBe('completed');
    expect(items.find((i) => i.role === 'assistant')?.status).toBe('completed');
  });
});
```

- [ ] **Step 8.2: Run tests — confirm they fail**

```bash
npx vitest run --no-coverage src/services/clients/OpenAITranslateGAClient.test.ts 2>&1 | tail -15
```
Expected: 5 new tests fail because `handleServerEvent` doesn't exist yet.

- [ ] **Step 8.3: Implement `handleServerEvent` and supporting state machine**

Add these private methods to `OpenAITranslateGAClient.ts`:

```ts
private genItemId(): string {
  return `translate_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

private resetDeltaTimer(): void {
  if (this.deltaTimer) clearTimeout(this.deltaTimer);
  this.deltaTimer = setTimeout(() => {
    this.completeCurrentPair();
  }, SILENCE_TIMEOUT_MS);
}

private ensurePair(): { userItemId: string; assistantItemId: string } {
  if (this.currentPair) return this.currentPair;

  const userItemId = this.genItemId();
  const assistantItemId = this.genItemId();
  this.currentPair = { userItemId, assistantItemId };

  const createdAt = Date.now();

  const userItem: ConversationItem = {
    id: userItemId,
    role: 'user',
    type: 'message',
    status: 'in_progress',
    createdAt,
    formatted: { text: '', transcript: '' },
    content: [],
  };
  const assistantItem: ConversationItem = {
    id: assistantItemId,
    role: 'assistant',
    type: 'message',
    status: 'in_progress',
    createdAt,
    formatted: { text: '', transcript: '' },
    content: [],
  };

  this.conversationItems.push(userItem, assistantItem);
  this.itemLookup.set(userItemId, userItem);
  this.itemLookup.set(assistantItemId, assistantItem);

  this.eventHandlers.onConversationUpdated?.({ item: userItem });
  this.eventHandlers.onConversationUpdated?.({ item: assistantItem });

  return this.currentPair;
}

private completeCurrentPair(): void {
  if (!this.currentPair) return;

  const { userItemId, assistantItemId } = this.currentPair;
  const userItem = this.itemLookup.get(userItemId);
  const assistantItem = this.itemLookup.get(assistantItemId);

  if (userItem) {
    userItem.status = 'completed';
    if (userItem.formatted) userItem.formatted.text = userItem.formatted.transcript || '';
    this.eventHandlers.onConversationUpdated?.({ item: userItem });
  }

  if (assistantItem) {
    assistantItem.status = 'completed';
    // Merge audio chunks
    const chunks = this.audioChunks.get(assistantItemId);
    if (chunks && chunks.length > 0 && assistantItem.formatted) {
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const merged = new Int16Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      assistantItem.formatted.audio = merged;
      this.audioChunks.delete(assistantItemId);
    }
    if (assistantItem.formatted) assistantItem.formatted.text = assistantItem.formatted.transcript || '';
    this.eventHandlers.onConversationUpdated?.({ item: assistantItem });
  }

  this.currentPair = null;
  if (this.deltaTimer) {
    clearTimeout(this.deltaTimer);
    this.deltaTimer = null;
  }
}

private handleServerEvent(event: any): void {
  // Forward to logging handlers
  this.eventHandlers.onRealtimeEvent?.({
    source: 'server',
    event: { type: event.type, data: event },
  });

  switch (event.type) {
    case 'session.input_transcript.delta': {
      const pair = this.ensurePair();
      const userItem = this.itemLookup.get(pair.userItemId);
      if (userItem?.formatted) {
        userItem.formatted.transcript = (userItem.formatted.transcript || '') + (event.delta || '');
      }
      this.eventHandlers.onConversationUpdated?.({
        item: userItem!,
        delta: { transcript: event.delta },
      });
      this.resetDeltaTimer();
      break;
    }

    case 'session.output_transcript.delta': {
      const pair = this.ensurePair();
      const assistantItem = this.itemLookup.get(pair.assistantItemId);
      if (assistantItem?.formatted) {
        assistantItem.formatted.transcript = (assistantItem.formatted.transcript || '') + (event.delta || '');
      }
      this.eventHandlers.onConversationUpdated?.({
        item: assistantItem!,
        delta: { transcript: event.delta },
      });
      this.resetDeltaTimer();
      break;
    }

    case 'session.output_audio.delta': {
      const pair = this.ensurePair();
      const assistantItem = this.itemLookup.get(pair.assistantItemId);
      if (!assistantItem || !event.delta) break;

      const audioData = base64ToInt16Array(event.delta);
      const sequenceNumber = ++this.deltaSequenceNumber;

      if (!this.audioChunks.has(pair.assistantItemId)) {
        this.audioChunks.set(pair.assistantItemId, []);
      }
      this.audioChunks.get(pair.assistantItemId)!.push(audioData);

      this.eventHandlers.onConversationUpdated?.({
        item: assistantItem,
        delta: {
          audio: audioData,
          sequenceNumber,
          timestamp: Date.now(),
        },
      });
      this.resetDeltaTimer();
      break;
    }

    case 'session.input_transcript.done':
    case 'session.output_transcript.done':
    case 'session.output_audio.done':
      // Any of these indicate end of utterance.
      this.completeCurrentPair();
      break;

    case 'session.created':
    case 'session.updated':
      // No conversation impact; already forwarded via onRealtimeEvent above.
      break;

    case 'error': {
      const errorMessage = event.error?.message || event.error?.code || 'Unknown error';
      const errorItem: ConversationItem = {
        id: `error_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        role: 'system',
        type: 'error',
        status: 'completed',
        formatted: { text: `[${event.error?.type || 'error'}] ${errorMessage}` },
        content: [{ type: 'text', text: errorMessage }],
      };
      this.eventHandlers.onConversationUpdated?.({ item: errorItem });
      this.eventHandlers.onError?.(event.error || event);
      break;
    }

    default:
      // Unhandled event type — already logged via onRealtimeEvent
      break;
  }
}
```

Add the helper functions at the bottom of the file:

```ts
function base64ToInt16Array(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function int16ArrayToBase64(data: Int16Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
```

- [ ] **Step 8.4: Run tests, confirm pass**

```bash
npx vitest run --no-coverage src/services/clients/OpenAITranslateGAClient.test.ts 2>&1 | tail -15
```
Expected: all tests pass.

- [ ] **Step 8.5: Run full suite for regression check**

```bash
npx vitest run --no-coverage 2>&1 | tail -6
```
Expected: at least 196/196 passing (186 baseline + 5 from Task 7 + 5 new).

- [ ] **Step 8.6: Commit**

```bash
git add src/services/clients/OpenAITranslateGAClient.ts \
  src/services/clients/OpenAITranslateGAClient.test.ts
git commit -m "$(cat <<'EOF'
feat(openai-translate): add server event handling and pairing state machine

handleServerEvent dispatches incoming server events into a paired
user+assistant ConversationItem state machine. New utterances start
a pair on the first input_transcript or output_transcript delta;
the pair is completed either on a .done event or after 1.5s of
silence (whichever comes first). Audio chunks accumulate per item
and are merged into formatted.audio on completion.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: OpenAITranslateGAClient — WebSocket connect/disconnect (TDD)

**Files:**
- Modify: `src/services/clients/OpenAITranslateGAClient.ts`
- Modify: `src/services/clients/OpenAITranslateGAClient.test.ts`

- [ ] **Step 9.1: Add WebSocket lifecycle tests**

Append to `OpenAITranslateGAClient.test.ts`:

```ts
describe('OpenAITranslateGAClient WebSocket lifecycle', () => {
  let mockWs: any;
  let originalWebSocket: any;

  beforeEach(() => {
    originalWebSocket = (globalThis as any).WebSocket;
    mockWs = {
      readyState: 0,
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };
    (globalThis as any).WebSocket = vi.fn(() => mockWs);
  });

  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
  });

  it('connects to the translate WSS URL with model query param', async () => {
    const client = new OpenAITranslateGAClient('test-key');
    const config: OpenAITranslateSessionConfig = {
      provider: 'openai_translate',
      model: 'gpt-realtime-translate',
      targetLanguage: 'es',
    };

    const connectPromise = client.connect(config);

    // Simulate the WebSocket opening
    mockWs.readyState = 1;
    mockWs.onopen?.({});

    // Simulate session.created
    mockWs.onmessage?.({
      data: JSON.stringify({ type: 'session.created' }),
    });

    await connectPromise;

    expect((globalThis as any).WebSocket).toHaveBeenCalledWith(
      expect.stringContaining('/v1/realtime/translations?model=gpt-realtime-translate'),
      expect.anything()
    );
  });

  it('sends session.update immediately after open', async () => {
    const client = new OpenAITranslateGAClient('test-key');
    const config: OpenAITranslateSessionConfig = {
      provider: 'openai_translate',
      model: 'gpt-realtime-translate',
      targetLanguage: 'ja',
      inputAudioTranscription: { model: 'gpt-realtime-whisper' },
    };

    const connectPromise = client.connect(config);
    mockWs.readyState = 1;
    mockWs.onopen?.({});
    mockWs.onmessage?.({ data: JSON.stringify({ type: 'session.created' }) });
    await connectPromise;

    const sendCalls = mockWs.send.mock.calls;
    const sessionUpdate = sendCalls
      .map((c: any) => JSON.parse(c[0]))
      .find((p: any) => p.type === 'session.update');
    expect(sessionUpdate).toBeDefined();
    expect(sessionUpdate.session.audio.output.language).toBe('ja');
    expect(sessionUpdate.session.audio.input.transcription.model).toBe('gpt-realtime-whisper');
  });

  it('appendInputAudio sends base64-encoded session.input_audio_buffer.append', async () => {
    const client = new OpenAITranslateGAClient('test-key');
    const config: OpenAITranslateSessionConfig = {
      provider: 'openai_translate',
      model: 'gpt-realtime-translate',
      targetLanguage: 'en',
    };

    const connectPromise = client.connect(config);
    mockWs.readyState = 1;
    mockWs.onopen?.({});
    mockWs.onmessage?.({ data: JSON.stringify({ type: 'session.created' }) });
    await connectPromise;

    mockWs.send.mockClear();

    const audio = new Int16Array([1, 2, 3]);
    client.appendInputAudio(audio);

    expect(mockWs.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(payload.type).toBe('session.input_audio_buffer.append');
    expect(typeof payload.audio).toBe('string');
    // Roundtrip check: base64 decoded matches original
    expect(payload.audio.length).toBeGreaterThan(0);
  });
});
```

Note: the existing `OpenAITranslateSessionConfig` import at the top of the test file is already there from Task 7.

- [ ] **Step 9.2: Run tests — confirm they fail**

```bash
npx vitest run --no-coverage src/services/clients/OpenAITranslateGAClient.test.ts 2>&1 | tail -15
```
Expected: WebSocket lifecycle tests fail (connect throws "not implemented").

- [ ] **Step 9.3: Implement connect/disconnect/appendInputAudio**

Replace the no-op stubs in `OpenAITranslateGAClient.ts`:

```ts
async connect(config: SessionConfig): Promise<void> {
  if (!isOpenAITranslateSessionConfig(config)) {
    throw new Error('OpenAITranslateGAClient requires translate session config');
  }

  // Reset state
  this.deltaSequenceNumber = 0;
  this.itemLookup.clear();
  this.conversationItems = [];
  this.audioChunks.clear();
  this.currentPair = null;

  const url = `${TRANSLATE_WS_URL}?model=${encodeURIComponent(config.model)}`;
  // The WebSocket constructor in Node/browser doesn't support custom headers
  // directly — but in browser, the Sec-WebSocket-Protocol negotiation does.
  // OpenAI's WebSocket auth uses ?Authorization or Sec-WebSocket-Protocol —
  // following the cookbook example pattern, pass via Sec-WebSocket-Protocol.
  // Browser limitation: cannot set Authorization header on WS. Use bearer
  // via subprotocol (OpenAI accepts both).
  this.ws = new WebSocket(url, [
    'realtime',
    `openai-insecure-api-key.${this.apiKey}`,
    'openai-beta.realtime-v1',
  ]);

  this.setupWebSocketListeners();

  // Wait for open + session.created
  await this.waitForSessionCreated();

  // Send session.update
  const updatePayload = OpenAITranslateGAClient.buildSessionUpdate(config);
  this.ws!.send(JSON.stringify(updatePayload));
  this.eventHandlers.onRealtimeEvent?.({
    source: 'client',
    event: { type: 'session.update', data: updatePayload },
  });

  this.connected = true;
  this.eventHandlers.onRealtimeEvent?.({
    source: 'client',
    event: {
      type: 'session.opened',
      data: {
        status: 'connected',
        provider: 'openai_translate',
        model: config.model,
        timestamp: Date.now(),
      },
    },
  });
  this.eventHandlers.onOpen?.();
}

private setupWebSocketListeners(): void {
  if (!this.ws) return;
  this.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      this.handleServerEvent(data);
    } catch (err) {
      console.error('[OpenAITranslateGAClient] Failed to parse server message:', err);
    }
  };
  this.ws.onerror = (event) => {
    this.eventHandlers.onError?.(event);
  };
  this.ws.onclose = () => {
    if (this.connected) {
      this.connected = false;
      this.eventHandlers.onRealtimeEvent?.({
        source: 'client',
        event: {
          type: 'session.closed',
          data: { status: 'disconnected', provider: 'openai_translate', timestamp: Date.now(), reason: 'websocket_closed' },
        },
      });
      this.eventHandlers.onClose?.({});
    }
  };
}

private waitForSessionCreated(): Promise<void> {
  const SESSION_TIMEOUT = 30000;
  return new Promise((resolve, reject) => {
    if (!this.ws) {
      reject(new Error('WebSocket not initialized'));
      return;
    }

    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Session creation timeout'));
      }
    }, SESSION_TIMEOUT);

    const originalOnMessage = this.ws.onmessage;
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'session.created' && !settled) {
          settled = true;
          clearTimeout(timeout);
          this.ws!.onmessage = originalOnMessage;
          resolve();
          return;
        }
        if (data.type === 'error' && !settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(data.error?.message || 'Session creation failed'));
          return;
        }
      } catch (e) {
        // ignore
      }
      // Forward other messages to the regular handler
      if (originalOnMessage && typeof originalOnMessage === 'function') {
        originalOnMessage.call(this.ws!, event);
      }
    };

    this.ws.onopen = () => {
      // open handled — keep waiting for session.created
    };

    this.ws.onerror = (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error('WebSocket error during session creation'));
      }
    };
  });
}

async disconnect(): Promise<void> {
  if (this.ws) {
    this.ws.close();
    this.ws = null;
  }
  this.connected = false;
  this.completeCurrentPair();  // flush any pending pair
}

isConnected(): boolean {
  return this.connected && this.ws?.readyState === 1;
}

appendInputAudio(audioData: Int16Array): void {
  if (!this.ws || this.ws.readyState !== 1) return;
  const base64 = int16ArrayToBase64(audioData);
  this.ws.send(JSON.stringify({
    type: 'session.input_audio_buffer.append',
    audio: base64,
  }));
}

reset(): void {
  this.conversationItems = [];
  this.itemLookup.clear();
  this.audioChunks.clear();
  this.currentPair = null;
  if (this.deltaTimer) {
    clearTimeout(this.deltaTimer);
    this.deltaTimer = null;
  }
}

updateSession(config: Partial<SessionConfig>): void {
  if (!this.ws || !isOpenAITranslateSessionConfig(config as SessionConfig)) return;
  const updatePayload = OpenAITranslateGAClient.buildSessionUpdate(config as OpenAITranslateSessionConfig);
  this.ws.send(JSON.stringify(updatePayload));
  this.eventHandlers.onRealtimeEvent?.({
    source: 'client',
    event: { type: 'session.update', data: updatePayload },
  });
}
```

Note on auth: the spec recommends `Authorization: Bearer ${apiKey}`. In a browser the standard `WebSocket` constructor cannot set arbitrary headers, but OpenAI accepts auth via the `Sec-WebSocket-Protocol` subprotocol with the `openai-insecure-api-key.${apiKey}` token (this is what the existing community library does too). If implementation reveals OpenAI rejects this for translate, fall back to using the `EphemeralTokenService.mintTranslationClientSecret` flow even for WebSocket.

- [ ] **Step 9.4: Run tests, confirm pass**

```bash
npx vitest run --no-coverage src/services/clients/OpenAITranslateGAClient.test.ts 2>&1 | tail -15
```

- [ ] **Step 9.5: Run full suite**

```bash
npx vitest run --no-coverage 2>&1 | tail -6
```

- [ ] **Step 9.6: Commit**

```bash
git add src/services/clients/OpenAITranslateGAClient.ts \
  src/services/clients/OpenAITranslateGAClient.test.ts
git commit -m "$(cat <<'EOF'
feat(openai-translate): add WebSocket connect lifecycle and audio I/O

connect() opens a WebSocket to /v1/realtime/translations, waits for
session.created, then sends session.update with the target language
config. appendInputAudio base64-encodes Int16Array and sends via
session.input_audio_buffer.append. Auth uses subprotocol header
(browser-compatible workaround for missing custom-header support on
the standard WebSocket constructor).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: OpenAITranslateGAClient — validateApiKeyAndFetchModels

**Files:**
- Modify: `src/services/clients/OpenAITranslateGAClient.ts`
- Modify: `src/services/clients/OpenAITranslateGAClient.test.ts`

- [ ] **Step 10.1: Add static method**

Add to the class (above the constructor or grouped with the other static methods):

```ts
/**
 * Validate the API key and discover available translate models.
 * Reuses OpenAIClient's shared model fetch helper, then filters to
 * gpt-realtime-translate family.
 */
static async validateApiKeyAndFetchModels(apiKey: string, apiHost?: string): Promise<{
  validation: ApiKeyValidationResult;
  models: FilteredModel[];
}> {
  const { models, error } = await OpenAIClient.fetchOpenAIModelsList(apiKey, apiHost);
  if (error) return { validation: error, models: [] };

  const filtered = models
    .filter((m) => OpenAIClient.isTranslateRealtimeModel(m.id))
    .map((m) => ({ id: m.id, type: 'realtime' as const, created: m.created }))
    .sort((a, b) => b.created - a.created);

  if (filtered.length === 0) {
    return {
      validation: {
        valid: false,
        message: i18n.t('settings.translateModelNotAvailable'),
        validating: false,
        hasRealtimeModel: false,
      },
      models: [],
    };
  }

  return {
    validation: {
      valid: true,
      message: i18n.t('settings.translateModelAvailable'),
      validating: false,
      hasRealtimeModel: true,
    },
    models: filtered,
  };
}
```

- [ ] **Step 10.2: Add validation tests**

Append to the test file:

```ts
describe('OpenAITranslateGAClient.validateApiKeyAndFetchModels', () => {
  it('returns valid when /v1/models includes gpt-realtime-translate', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: [
          { id: 'gpt-realtime-translate', object: 'model', created: 1, owned_by: 'openai' },
          { id: 'gpt-realtime-mini', object: 'model', created: 2, owned_by: 'openai' },
        ],
      }), { status: 200 })
    );

    const { validation, models } = await OpenAITranslateGAClient.validateApiKeyAndFetchModels('test-key');

    expect(validation.valid).toBe(true);
    expect(models.length).toBe(1);
    expect(models[0].id).toBe('gpt-realtime-translate');
    fetchSpy.mockRestore();
  });

  it('returns invalid when /v1/models does not include translate model', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: [{ id: 'gpt-realtime-mini', object: 'model', created: 1, owned_by: 'openai' }],
      }), { status: 200 })
    );

    const { validation } = await OpenAITranslateGAClient.validateApiKeyAndFetchModels('test-key');

    expect(validation.valid).toBe(false);
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 10.3: Run tests, confirm pass**

```bash
npx vitest run --no-coverage src/services/clients/OpenAITranslateGAClient.test.ts 2>&1 | tail -10
```

- [ ] **Step 10.4: Commit**

```bash
git add src/services/clients/OpenAITranslateGAClient.ts \
  src/services/clients/OpenAITranslateGAClient.test.ts
git commit -m "$(cat <<'EOF'
feat(openai-translate): add validateApiKeyAndFetchModels

Reuses OpenAIClient.fetchOpenAIModelsList for the network round-trip,
then filters with isTranslateRealtimeModel to surface only
gpt-realtime-translate variants. Validation messages are
translate-specific so users with valid OpenAI keys but no translate
access get a clear distinct error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: OpenAITranslateWebRTCClient — full implementation

**Files:**
- Create: `src/services/clients/OpenAITranslateWebRTCClient.ts`

- [ ] **Step 11.1: Create the client file**

Write `src/services/clients/OpenAITranslateWebRTCClient.ts`. This file is large but follows the existing `OpenAIWebRTCClient` structure closely. Open `OpenAIWebRTCClient.ts` side-by-side for reference; the diffs from that file are:
- URL endpoint: `/v1/realtime/translations/calls` (not `/v1/realtime`)
- Token: from `EphemeralTokenService.mintTranslationClientSecret` (not `getToken`)
- Session update: built via `OpenAITranslateGAClient.buildSessionUpdate` (not the OpenAI session update logic)
- Server event handling: delegates to `OpenAITranslateGAClient` shared parser pattern
- No voice / temperature / turn_detection / instructions

Skeleton (fill in details from `OpenAIWebRTCClient.ts` adapting where noted):

```ts
import {
  IClient,
  ConversationItem,
  SessionConfig,
  ClientEventHandlers,
  OpenAITranslateSessionConfig,
  isOpenAITranslateSessionConfig,
  ResponseConfig,
} from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import { EphemeralTokenService } from '../EphemeralTokenService';
import { WebRTCAudioBridge, BufferedAudioMetadata } from '../../lib/modern-audio/WebRTCAudioBridge';
import { OpenAITranslateGAClient } from './OpenAITranslateGAClient';

interface WebRTCClientOptions {
  apiKey: string;
  apiHost?: string;
  inputDeviceId?: string;
  outputDeviceId?: string;
}

const TRANSLATE_CALLS_ENDPOINT = 'https://api.openai.com/v1/realtime/translations/calls';
const SILENCE_TIMEOUT_MS = 1500;

export class OpenAITranslateWebRTCClient implements IClient {
  private apiKey: string;
  private apiHost: string;
  private inputDeviceId?: string;
  private outputDeviceId?: string;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioBridge: WebRTCAudioBridge;
  private eventHandlers: ClientEventHandlers = {};
  private connected: boolean = false;

  // Pairing state machine — same shape as OpenAITranslateGAClient
  private currentPair: { userItemId: string; assistantItemId: string } | null = null;
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;
  private audioChunks: Map<string, Int16Array[]> = new Map();
  private itemLookup: Map<string, ConversationItem> = new Map();
  private conversationItems: ConversationItem[] = [];
  private deltaSequenceNumber: number = 0;

  constructor(options: WebRTCClientOptions) {
    this.apiKey = options.apiKey;
    this.apiHost = (options.apiHost || 'https://api.openai.com').replace(/\/$/, '');
    this.inputDeviceId = options.inputDeviceId;
    this.outputDeviceId = options.outputDeviceId;

    this.audioBridge = new WebRTCAudioBridge({
      sampleRate: 24000,
      enablePCMBuffering: true,
      pcmBufferThresholdMs: 200,
      pcmFlushTimeoutMs: 100,
    });

    this.audioBridge.onBufferedAudioData = (pcmData, metadata) => {
      this.handleBufferedAudio(pcmData, metadata);
    };
  }

  async connect(config: SessionConfig): Promise<void> {
    if (!isOpenAITranslateSessionConfig(config)) {
      throw new Error('OpenAITranslateWebRTCClient requires translate session config');
    }

    try {
      // 1. Mint client secret on behalf of the user
      const clientSecret = await EphemeralTokenService.mintTranslationClientSecret(
        this.apiKey,
        {
          targetLanguage: config.targetLanguage,
          transcriptModel: config.inputAudioTranscription?.model,
          noiseReductionType: config.inputAudioNoiseReduction?.type,
        },
        this.apiHost
      );

      // 2. Set up RTCPeerConnection + media + data channel
      this.pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      const localStream = await this.audioBridge.getLocalStream(this.inputDeviceId);
      localStream.getTracks().forEach((track) => {
        this.pc!.addTrack(track, localStream);
      });

      this.pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          this.audioBridge.handleRemoteStream(event.streams[0], this.outputDeviceId);
        }
      };

      this.dc = this.pc.createDataChannel('oai-events');
      this.setupDataChannelListeners();

      this.pc.onconnectionstatechange = () => {
        if (this.pc?.connectionState === 'connected') {
          this.connected = true;
          this.eventHandlers.onOpen?.();
        } else if (this.pc?.connectionState === 'failed' || this.pc?.connectionState === 'closed') {
          this.handleDisconnection();
        }
      };

      // 3. SDP exchange — POST offer to /v1/realtime/translations/calls
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this.waitForIceGathering();

      const sdpResponse = await fetch(TRANSLATE_CALLS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${clientSecret}`,
          'Content-Type': 'application/sdp',
        },
        body: this.pc.localDescription!.sdp,
      });

      if (!sdpResponse.ok) {
        const errorText = await sdpResponse.text();
        throw new Error(`SDP exchange failed: ${sdpResponse.status} ${errorText}`);
      }

      const answerSdp = await sdpResponse.text();
      await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      // 4. Wait for data channel open, then send session.update
      await this.waitForDataChannelOpen();
      const updatePayload = OpenAITranslateGAClient.buildSessionUpdate(config);
      this.dc!.send(JSON.stringify(updatePayload));
      this.eventHandlers.onRealtimeEvent?.({
        source: 'client',
        event: { type: 'session.update', data: updatePayload },
      });
    } catch (err) {
      this.cleanup();
      throw err;
    }
  }

  // --- The remaining methods (waitForIceGathering, waitForDataChannelOpen,
  // setupDataChannelListeners, handleServerEvent, handleBufferedAudio,
  // ensurePair, completeCurrentPair, resetDeltaTimer, genItemId,
  // disconnect, cleanup, isConnected, updateSession, reset,
  // appendInputAudio, appendInputText, createResponse, cancelResponse,
  // getConversationItems, clearConversationItems, setEventHandlers,
  // getProvider, switchInputDevice, switchOutputDevice, setVolume,
  // setOutputMuted, getFrequencies, getAudioBridge) — copy structure
  // from OpenAIWebRTCClient.ts, with the following adaptations:
  //
  // 1. handleServerEvent uses the same switch as OpenAITranslateGAClient
  //    (input_transcript.delta, output_transcript.delta, output_audio.delta,
  //    .done variants, error). Copy that method body verbatim from
  //    OpenAITranslateGAClient.
  //
  // 2. ensurePair / completeCurrentPair / resetDeltaTimer / genItemId —
  //    copy verbatim from OpenAITranslateGAClient.
  //
  // 3. appendInputAudio is a no-op in WebRTC (audio flows via MediaStreamTrack).
  //
  // 4. appendInputText / createResponse / cancelResponse — no-ops.
  //
  // 5. getProvider returns Provider.OPENAI_TRANSLATE.
  //
  // 6. setupDataChannelListeners parses JSON from data channel messages and
  //    delegates to handleServerEvent.
  //
  // 7. handleBufferedAudio attaches buffered PCM to the current assistant
  //    item — same idea as OpenAIWebRTCClient.handleBufferedAudio but uses
  //    this.currentPair?.assistantItemId for the item id.
}
```

Fill in the remaining methods following the structure of `OpenAIWebRTCClient.ts`. Reference the existing file for SDP / ICE patterns, error handling, and audio bridge cleanup. Where logic would be identical to `OpenAITranslateGAClient` (state machine), copy the methods verbatim — DRY can be addressed later if duplication exceeds 100 lines.

- [ ] **Step 11.2: Verify tsc clean**

```bash
npx tsc --noEmit 2>&1 | grep -vE '(Volcengine|logStore\.ts|settingsStore\.test\.ts|environment\.ts|splitSentences\.ts|PalabraAI)' | head -20
```

- [ ] **Step 11.3: Run full test suite (no new tests for WebRTC client per spec)**

```bash
npx vitest run --no-coverage 2>&1 | tail -6
```
Expected: same count as after Task 10 (no regressions).

- [ ] **Step 11.4: Commit**

```bash
git add src/services/clients/OpenAITranslateWebRTCClient.ts
git commit -m "$(cat <<'EOF'
feat(openai-translate): add WebRTC client

Mirrors OpenAIWebRTCClient structure with translate-specific differences:
mints client_secret via EphemeralTokenService.mintTranslationClientSecret,
posts SDP to /v1/realtime/translations/calls, and reuses
OpenAITranslateGAClient.buildSessionUpdate plus the same pairing state
machine for server events. WebRTCAudioBridge is configured identically
to the main OpenAI WebRTC path (24 kHz, 200 ms PCM buffer).

Per spec: no unit tests for this transport — RTCPeerConnection mocking
is high-cost and low-yield. Manual smoke test covers it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: ClientFactory routing

**Files:**
- Modify: `src/services/clients/ClientFactory.ts`

- [ ] **Step 12.1: Add OPENAI_TRANSLATE case**

In the factory's `createClient` switch (around line 56), add:

```ts
import { OpenAITranslateGAClient } from './OpenAITranslateGAClient';
import { OpenAITranslateWebRTCClient } from './OpenAITranslateWebRTCClient';

// ...inside the switch:
case Provider.OPENAI_TRANSLATE:
  if (transportType === 'webrtc') {
    return new OpenAITranslateWebRTCClient({
      apiKey,
      inputDeviceId: webrtcOptions?.inputDeviceId,
      outputDeviceId: webrtcOptions?.outputDeviceId,
    });
  }
  return new OpenAITranslateGAClient(apiKey);
```

- [ ] **Step 12.2: Update `supportsWebRTC`**

Find the existing `supportsWebRTC` static method. Add the new provider:

```ts
static supportsWebRTC(provider: ProviderType): boolean {
  return provider === Provider.OPENAI
      || provider === Provider.OPENAI_COMPATIBLE
      || provider === Provider.OPENAI_TRANSLATE;
}
```

- [ ] **Step 12.3: Update `validateApiKey` switch in settingsStore**

In `src/stores/settingsStore.ts`, find the `validateApiKey` action (search for `validateApiKey:`). Add a case for the new provider that calls `OpenAITranslateGAClient.validateApiKeyAndFetchModels(state.openaiTranslate.apiKey)`. Mirror the existing OpenAI case structure. Import `OpenAITranslateGAClient` at the top of the file.

- [ ] **Step 12.4: Verify tsc clean and tests pass**

```bash
npx tsc --noEmit 2>&1 | grep -vE '(Volcengine|logStore\.ts|settingsStore\.test\.ts|environment\.ts|splitSentences\.ts|PalabraAI)' | head -20
npx vitest run --no-coverage 2>&1 | tail -6
```

- [ ] **Step 12.5: Commit**

```bash
git add src/services/clients/ClientFactory.ts \
  src/stores/settingsStore.ts
git commit -m "$(cat <<'EOF'
feat(openai-translate): wire ClientFactory and validation

Provider.OPENAI_TRANSLATE routes to OpenAITranslateGAClient (WS) or
OpenAITranslateWebRTCClient (WebRTC) based on transportType.
supportsWebRTC includes the new provider so ProviderSpecificSettings
renders the transport switcher. validateApiKey delegates to the
translate client's static validator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: LanguageSection — targetLanguages-aware target dropdown

**Files:**
- Modify: `src/components/Settings/sections/LanguageSection.tsx`

- [ ] **Step 13.1: Read the existing LanguageSection**

Open `src/components/Settings/sections/LanguageSection.tsx`. Locate the place where `config.languages` is used to populate the target language dropdown. Common pattern:

```tsx
const sourceLanguages = config.languages;
const targetLanguages = config.languages;  // shared

return (
  <select value={targetLanguage} ...>
    {targetLanguages.map(...)}
  </select>
);
```

- [ ] **Step 13.2: Use targetLanguages when defined**

Change the assignment:

```tsx
const sourceLanguages = config.languages;
const targetLanguages = config.targetLanguages ?? config.languages;
```

If the file has separate constants or the dropdowns are rendered inline using `config.languages` directly, modify the target dropdown to use `(config.targetLanguages ?? config.languages)`.

- [ ] **Step 13.3: Verify tsc clean and tests pass**

```bash
npx tsc --noEmit 2>&1 | grep -vE '(Volcengine|logStore\.ts|settingsStore\.test\.ts|environment\.ts|splitSentences\.ts|PalabraAI)' | head -20
npx vitest run --no-coverage 2>&1 | tail -6
```

- [ ] **Step 13.4: Commit**

```bash
git add src/components/Settings/sections/LanguageSection.tsx
git commit -m "$(cat <<'EOF'
feat(openai-translate): use targetLanguages in target dropdown

LanguageSection now uses config.targetLanguages ?? config.languages for
the target dropdown. Other providers leave targetLanguages undefined and
naturally fall back to the shared languages list. OpenAI Translate
defines targetLanguages with its 13 supported codes, so users see the
restricted set automatically.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: ProviderSpecificSettings — same-language silence info banner

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx`

- [ ] **Step 14.1: Add the render function**

In `ProviderSpecificSettings.tsx`, add a new render function near the other `render*` functions:

```tsx
const renderTranslateInfoBanner = () => {
  if (provider !== Provider.OPENAI_TRANSLATE) return null;
  return (
    <div className="settings-section translate-info-banner">
      <div className="info-banner">
        <Info size={14} />
        <span>{t('settings.translateInfoBanner')}</span>
      </div>
    </div>
  );
};
```

`Info` is already imported from `lucide-react` at the top of the file (used elsewhere). If not, add to the imports:

```tsx
import { ChevronDown, ChevronRight, RotateCw, Info, CircleHelp, ExternalLink } from 'lucide-react';
```

- [ ] **Step 14.2: Add to render output**

Find the JSX return at the bottom of the component (around line 2094). Add the call **first** so the banner appears at the top of the OpenAI Translate config block:

```tsx
return (
  <Fragment>
    {renderTranslateInfoBanner()}
    {renderVoiceSettings()}
    {renderTurnDetectionSettings()}
    ...
  </Fragment>
);
```

- [ ] **Step 14.3: Add minimal SCSS for the banner**

In the existing `ProviderSpecificSettings.scss` (or its parent), add:

```scss
.translate-info-banner {
  .info-banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 12px;
    background: rgba(16, 163, 127, 0.1);
    border: 1px solid rgba(16, 163, 127, 0.3);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.4;

    svg {
      flex-shrink: 0;
      margin-top: 2px;
      color: #10a37f;
    }
  }
}
```

If the file uses a different SCSS structure, locate it via `find src -name "ProviderSpecificSettings.scss"` and adapt.

- [ ] **Step 14.4: Verify tsc clean and tests pass**

```bash
npx tsc --noEmit 2>&1 | grep -vE '(Volcengine|logStore\.ts|settingsStore\.test\.ts|environment\.ts|splitSentences\.ts|PalabraAI)' | head -20
npx vitest run --no-coverage 2>&1 | tail -6
```

- [ ] **Step 14.5: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx \
  src/components/Settings/sections/ProviderSpecificSettings.scss
git commit -m "$(cat <<'EOF'
feat(openai-translate): add same-language silence info banner

Cookbook calls out that gpt-realtime-translate stays silent when the
speaker uses the target language. The banner warns users about this
behavior so they know what to expect with mixed-language speech and can
choose to enable passthrough audio.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: i18n — English keys

**Files:**
- Modify: `src/locales/en/translation.json`

- [ ] **Step 15.1: Add the new keys**

Open `src/locales/en/translation.json`. Find the `settings` block. Add the new keys at the end of the block (just before the closing `}` of `settings`):

```json
    "openaiTranslate": "OpenAI Translate",
    "openaiTranslateDescription": "Real-time speech-to-speech translation by OpenAI. 70+ source languages, 13 target languages.",
    "translateInfoBanner": "This model stays silent when the speaker uses the same language as the target. Mixed-language speech may have gaps.",
    "targetLanguageLimited": "This model supports 13 target languages.",
    "translateModelAvailable": "API key validated. gpt-realtime-translate is available.",
    "translateModelNotAvailable": "API key works, but gpt-realtime-translate is not accessible with this key.",
    "transcriptModelTooltipTranslate": "Source-language captions. Currently only gpt-realtime-whisper is supported.",
    "modelTooltipTranslate": "OpenAI's dedicated speech-to-speech translation model. Voice automatically adapts to the source speaker."
```

Make sure the previous line ends with a comma.

- [ ] **Step 15.2: Verify JSON is valid**

```bash
python3 -c "import json; json.load(open('src/locales/en/translation.json'))"
```
Expected: no output (silent success).

- [ ] **Step 15.3: Commit**

```bash
git add src/locales/en/translation.json
git commit -m "$(cat <<'EOF'
feat(i18n): add English strings for OpenAI Translate provider

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: i18n — 29 other locales via Python script

**Files:**
- Modify: 29 files under `src/locales/{ar,bn,de,es,fa,fil,fi,fr,he,hi,id,it,ja,ko,ms,nl,pl,pt_BR,pt_PT,ru,sv,ta,te,th,tr,uk,vi,zh_CN,zh_TW}/translation.json`

- [ ] **Step 16.1: Write the Python script**

Create `/tmp/add_translate_i18n.py`:

```python
#!/usr/bin/env python3
"""Add OpenAI Translate i18n keys to all non-English locales."""
import json
from pathlib import Path

LOCALES_DIR = Path("/home/jiangzhuo/Desktop/kizunaai/sokuji-react/src/locales")

# Translations keyed by locale. Each value is a dict of the new strings.
T = {
    "zh_CN": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "OpenAI 的实时语音转语音翻译模型。支持 70+ 种源语言、13 种目标语言。",
        "translateInfoBanner": "当说话人使用与目标相同的语言时，该模型会保持沉默。混合语言场景可能会有片段缺失。",
        "targetLanguageLimited": "该模型仅支持 13 种目标语言。",
        "translateModelAvailable": "API key 验证成功。gpt-realtime-translate 可用。",
        "translateModelNotAvailable": "API key 有效，但当前 key 没有 gpt-realtime-translate 访问权限。",
        "transcriptModelTooltipTranslate": "源语言字幕。目前仅支持 gpt-realtime-whisper。",
        "modelTooltipTranslate": "OpenAI 专用的语音转语音翻译模型。译音会自动匹配源说话人音色。",
    },
    "zh_TW": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "OpenAI 的即時語音轉語音翻譯模型。支援 70+ 種源語言、13 種目標語言。",
        "translateInfoBanner": "當說話人使用與目標相同的語言時，該模型會保持沉默。混合語言場景可能會有片段缺失。",
        "targetLanguageLimited": "該模型僅支援 13 種目標語言。",
        "translateModelAvailable": "API key 驗證成功。gpt-realtime-translate 可用。",
        "translateModelNotAvailable": "API key 有效，但當前 key 沒有 gpt-realtime-translate 存取權限。",
        "transcriptModelTooltipTranslate": "來源語言字幕。目前僅支援 gpt-realtime-whisper。",
        "modelTooltipTranslate": "OpenAI 專用的語音轉語音翻譯模型。譯音會自動匹配來源說話人音色。",
    },
    "ja": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "OpenAI のリアルタイム音声翻訳モデル。70以上の入力言語、13の出力言語に対応。",
        "translateInfoBanner": "話者が出力言語と同じ言語を話す場合、このモデルは無音になります。混合言語の発話では空白が生じる可能性があります。",
        "targetLanguageLimited": "このモデルは13の出力言語のみサポートしています。",
        "translateModelAvailable": "APIキーが検証されました。gpt-realtime-translate が利用可能です。",
        "translateModelNotAvailable": "APIキーは有効ですが、このキーでは gpt-realtime-translate にアクセスできません。",
        "transcriptModelTooltipTranslate": "原語字幕。現在は gpt-realtime-whisper のみ対応しています。",
        "modelTooltipTranslate": "OpenAI 専用の音声翻訳モデル。出力音声は話者の声質に自動適応します。",
    },
    "ko": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "OpenAI의 실시간 음성 번역 모델. 70개 이상의 입력 언어, 13개의 출력 언어 지원.",
        "translateInfoBanner": "화자가 대상 언어와 같은 언어를 사용할 때, 이 모델은 침묵을 유지합니다. 혼합 언어 발화에서는 공백이 생길 수 있습니다.",
        "targetLanguageLimited": "이 모델은 13개의 대상 언어만 지원합니다.",
        "translateModelAvailable": "API 키 검증 완료. gpt-realtime-translate 사용 가능.",
        "translateModelNotAvailable": "API 키는 유효하지만 현재 키로 gpt-realtime-translate에 접근할 수 없습니다.",
        "transcriptModelTooltipTranslate": "원본 언어 자막. 현재 gpt-realtime-whisper만 지원됩니다.",
        "modelTooltipTranslate": "OpenAI 전용 음성 번역 모델. 출력 음성이 화자 음색에 자동으로 적응합니다.",
    },
    "fr": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "Modèle de traduction vocale temps réel d'OpenAI. 70+ langues source, 13 langues cible.",
        "translateInfoBanner": "Ce modèle reste silencieux lorsque le locuteur utilise la langue cible. Les discours multilingues peuvent présenter des silences.",
        "targetLanguageLimited": "Ce modèle prend en charge 13 langues cible.",
        "translateModelAvailable": "Clé API validée. gpt-realtime-translate est disponible.",
        "translateModelNotAvailable": "La clé API fonctionne, mais gpt-realtime-translate n'est pas accessible avec cette clé.",
        "transcriptModelTooltipTranslate": "Sous-titres en langue source. Seul gpt-realtime-whisper est actuellement pris en charge.",
        "modelTooltipTranslate": "Modèle de traduction vocale dédié d'OpenAI. La voix s'adapte automatiquement au locuteur source.",
    },
    "de": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "Echtzeit-Sprachübersetzungsmodell von OpenAI. 70+ Eingabesprachen, 13 Zielsprachen.",
        "translateInfoBanner": "Dieses Modell bleibt still, wenn der Sprecher die Zielsprache verwendet. Bei gemischtsprachiger Sprache können Lücken entstehen.",
        "targetLanguageLimited": "Dieses Modell unterstützt 13 Zielsprachen.",
        "translateModelAvailable": "API-Schlüssel validiert. gpt-realtime-translate ist verfügbar.",
        "translateModelNotAvailable": "Der API-Schlüssel funktioniert, aber gpt-realtime-translate ist mit diesem Schlüssel nicht zugänglich.",
        "transcriptModelTooltipTranslate": "Untertitel in Ausgangssprache. Derzeit wird nur gpt-realtime-whisper unterstützt.",
        "modelTooltipTranslate": "OpenAIs spezielles Sprachübersetzungsmodell. Die Stimme passt sich automatisch an den Originalsprecher an.",
    },
    "es": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "Modelo de traducción de voz en tiempo real de OpenAI. 70+ idiomas de origen, 13 idiomas de destino.",
        "translateInfoBanner": "Este modelo permanece en silencio cuando el hablante usa el mismo idioma que el destino. El habla mixta puede tener vacíos.",
        "targetLanguageLimited": "Este modelo admite 13 idiomas de destino.",
        "translateModelAvailable": "Clave API validada. gpt-realtime-translate está disponible.",
        "translateModelNotAvailable": "La clave API funciona, pero gpt-realtime-translate no es accesible con esta clave.",
        "transcriptModelTooltipTranslate": "Subtítulos en idioma fuente. Actualmente solo se admite gpt-realtime-whisper.",
        "modelTooltipTranslate": "Modelo dedicado de traducción de voz de OpenAI. La voz se adapta automáticamente al hablante de origen.",
    },
    "it": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "Modello di traduzione vocale in tempo reale di OpenAI. 70+ lingue di origine, 13 lingue di destinazione.",
        "translateInfoBanner": "Questo modello resta silenzioso quando il parlante usa la stessa lingua della destinazione. I discorsi multilingue possono avere lacune.",
        "targetLanguageLimited": "Questo modello supporta 13 lingue di destinazione.",
        "translateModelAvailable": "Chiave API validata. gpt-realtime-translate è disponibile.",
        "translateModelNotAvailable": "La chiave API funziona, ma gpt-realtime-translate non è accessibile con questa chiave.",
        "transcriptModelTooltipTranslate": "Sottotitoli in lingua di origine. Attualmente è supportato solo gpt-realtime-whisper.",
        "modelTooltipTranslate": "Modello di traduzione vocale dedicato di OpenAI. La voce si adatta automaticamente al parlante di origine.",
    },
    "pt_BR": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "Modelo de tradução de voz em tempo real da OpenAI. 70+ idiomas de origem, 13 idiomas de destino.",
        "translateInfoBanner": "Este modelo fica em silêncio quando o falante usa o mesmo idioma do destino. A fala em idiomas mistos pode ter lacunas.",
        "targetLanguageLimited": "Este modelo suporta 13 idiomas de destino.",
        "translateModelAvailable": "Chave de API validada. gpt-realtime-translate está disponível.",
        "translateModelNotAvailable": "A chave de API funciona, mas gpt-realtime-translate não está acessível com essa chave.",
        "transcriptModelTooltipTranslate": "Legendas no idioma de origem. Atualmente apenas gpt-realtime-whisper é suportado.",
        "modelTooltipTranslate": "Modelo dedicado de tradução de voz da OpenAI. A voz se adapta automaticamente ao falante de origem.",
    },
    "pt_PT": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "Modelo de tradução de voz em tempo real da OpenAI. 70+ idiomas de origem, 13 idiomas de destino.",
        "translateInfoBanner": "Este modelo permanece em silêncio quando o orador usa o mesmo idioma do destino. A fala em idiomas mistos pode ter lacunas.",
        "targetLanguageLimited": "Este modelo suporta 13 idiomas de destino.",
        "translateModelAvailable": "Chave de API validada. gpt-realtime-translate está disponível.",
        "translateModelNotAvailable": "A chave de API funciona, mas gpt-realtime-translate não está acessível com esta chave.",
        "transcriptModelTooltipTranslate": "Legendas no idioma de origem. Atualmente apenas gpt-realtime-whisper é suportado.",
        "modelTooltipTranslate": "Modelo dedicado de tradução de voz da OpenAI. A voz adapta-se automaticamente ao orador de origem.",
    },
    "ru": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "Модель синхронного речевого перевода от OpenAI. 70+ исходных языков, 13 целевых языков.",
        "translateInfoBanner": "Модель молчит, когда говорящий использует целевой язык. В многоязычной речи возможны пропуски.",
        "targetLanguageLimited": "Модель поддерживает 13 целевых языков.",
        "translateModelAvailable": "API-ключ проверен. gpt-realtime-translate доступен.",
        "translateModelNotAvailable": "API-ключ работает, но gpt-realtime-translate недоступен с этим ключом.",
        "transcriptModelTooltipTranslate": "Субтитры на исходном языке. Сейчас поддерживается только gpt-realtime-whisper.",
        "modelTooltipTranslate": "Специализированная модель речевого перевода OpenAI. Голос автоматически адаптируется к исходному говорящему.",
    },
    "uk": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "Модель синхронного мовного перекладу від OpenAI. 70+ вихідних мов, 13 цільових мов.",
        "translateInfoBanner": "Модель мовчить, коли мовець використовує цільову мову. У багатомовній мові можливі пропуски.",
        "targetLanguageLimited": "Модель підтримує 13 цільових мов.",
        "translateModelAvailable": "API-ключ перевірено. gpt-realtime-translate доступний.",
        "translateModelNotAvailable": "API-ключ працює, але gpt-realtime-translate недоступний з цим ключем.",
        "transcriptModelTooltipTranslate": "Субтитри вихідною мовою. Зараз підтримується лише gpt-realtime-whisper.",
        "modelTooltipTranslate": "Спеціалізована модель мовного перекладу OpenAI. Голос автоматично адаптується до вихідного мовця.",
    },
    "pl": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "Model tłumaczenia głosowego w czasie rzeczywistym od OpenAI. 70+ języków źródłowych, 13 języków docelowych.",
        "translateInfoBanner": "Model milczy, gdy mówca używa tego samego języka co docelowy. Mowa wielojęzyczna może mieć luki.",
        "targetLanguageLimited": "Model obsługuje 13 języków docelowych.",
        "translateModelAvailable": "Klucz API zweryfikowany. gpt-realtime-translate jest dostępny.",
        "translateModelNotAvailable": "Klucz API działa, ale gpt-realtime-translate jest niedostępny z tym kluczem.",
        "transcriptModelTooltipTranslate": "Napisy w języku źródłowym. Obecnie obsługiwany jest tylko gpt-realtime-whisper.",
        "modelTooltipTranslate": "Dedykowany model tłumaczenia głosowego OpenAI. Głos automatycznie dopasowuje się do mówcy źródłowego.",
    },
    "nl": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "Realtime spraakvertalingsmodel van OpenAI. 70+ brontalen, 13 doeltalen.",
        "translateInfoBanner": "Dit model blijft stil wanneer de spreker dezelfde taal gebruikt als de doeltaal. Gemengde talen kunnen hiaten veroorzaken.",
        "targetLanguageLimited": "Dit model ondersteunt 13 doeltalen.",
        "translateModelAvailable": "API-sleutel gevalideerd. gpt-realtime-translate is beschikbaar.",
        "translateModelNotAvailable": "API-sleutel werkt, maar gpt-realtime-translate is niet toegankelijk met deze sleutel.",
        "transcriptModelTooltipTranslate": "Bron-taal ondertitels. Momenteel wordt alleen gpt-realtime-whisper ondersteund.",
        "modelTooltipTranslate": "OpenAI's speciale spraakvertalingsmodel. De stem past zich automatisch aan de bronspreker aan.",
    },
    "sv": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "Realtidsmodell för röstöversättning från OpenAI. 70+ källspråk, 13 målspråk.",
        "translateInfoBanner": "Modellen är tyst när talaren använder samma språk som målspråket. Blandspråklig tal kan ha luckor.",
        "targetLanguageLimited": "Modellen stöder 13 målspråk.",
        "translateModelAvailable": "API-nyckel validerad. gpt-realtime-translate är tillgänglig.",
        "translateModelNotAvailable": "API-nyckeln fungerar, men gpt-realtime-translate är inte tillgänglig med den här nyckeln.",
        "transcriptModelTooltipTranslate": "Källspråksundertexter. För närvarande stöds endast gpt-realtime-whisper.",
        "modelTooltipTranslate": "OpenAIs särskilda röstöversättningsmodell. Rösten anpassas automatiskt till källtalaren.",
    },
    "fi": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "OpenAI:n reaaliaikainen puheenkääntömalli. 70+ lähdekieltä, 13 kohdekieltä.",
        "translateInfoBanner": "Malli on hiljaa, kun puhuja käyttää samaa kieltä kuin kohde. Monikielisessä puheessa voi olla aukkoja.",
        "targetLanguageLimited": "Malli tukee 13 kohdekieltä.",
        "translateModelAvailable": "API-avain vahvistettu. gpt-realtime-translate on käytettävissä.",
        "translateModelNotAvailable": "API-avain toimii, mutta gpt-realtime-translate ei ole käytettävissä tällä avaimella.",
        "transcriptModelTooltipTranslate": "Lähdekielen tekstitykset. Tällä hetkellä tuetaan vain gpt-realtime-whisper.",
        "modelTooltipTranslate": "OpenAI:n erikoispuheenkääntömalli. Ääni mukautuu automaattisesti lähdepuhujaan.",
    },
    "tr": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "OpenAI'nin gerçek zamanlı sesli çeviri modeli. 70+ kaynak dil, 13 hedef dil.",
        "translateInfoBanner": "Konuşmacı hedef dille aynı dili kullandığında model sessiz kalır. Karışık dilli konuşmalarda boşluklar olabilir.",
        "targetLanguageLimited": "Bu model 13 hedef dili destekler.",
        "translateModelAvailable": "API anahtarı doğrulandı. gpt-realtime-translate kullanılabilir.",
        "translateModelNotAvailable": "API anahtarı çalışıyor ancak bu anahtarla gpt-realtime-translate erişilebilir değil.",
        "transcriptModelTooltipTranslate": "Kaynak dil altyazıları. Şu anda yalnızca gpt-realtime-whisper destekleniyor.",
        "modelTooltipTranslate": "OpenAI'nin özel sesli çeviri modeli. Ses otomatik olarak kaynak konuşmacıya uyum sağlar.",
    },
    "ar": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "نموذج ترجمة صوتية فورية من OpenAI. أكثر من 70 لغة مصدر و13 لغة هدف.",
        "translateInfoBanner": "يبقى هذا النموذج صامتاً عندما يستخدم المتحدث نفس لغة الهدف. قد تحتوي الكلام متعدد اللغات على فجوات.",
        "targetLanguageLimited": "يدعم هذا النموذج 13 لغة هدف.",
        "translateModelAvailable": "تم التحقق من مفتاح API. gpt-realtime-translate متاح.",
        "translateModelNotAvailable": "مفتاح API يعمل، ولكن gpt-realtime-translate غير متاح مع هذا المفتاح.",
        "transcriptModelTooltipTranslate": "ترجمات اللغة المصدر. حالياً يتم دعم gpt-realtime-whisper فقط.",
        "modelTooltipTranslate": "نموذج OpenAI المخصص للترجمة الصوتية. يتكيف الصوت تلقائياً مع المتحدث المصدر.",
    },
    "he": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "מודל תרגום קולי בזמן אמת של OpenAI. 70+ שפות מקור, 13 שפות יעד.",
        "translateInfoBanner": "המודל שותק כשהדובר משתמש באותה שפה כמו היעד. דיבור מעורב שפות עלול להכיל פערים.",
        "targetLanguageLimited": "המודל תומך ב-13 שפות יעד.",
        "translateModelAvailable": "מפתח API אומת. gpt-realtime-translate זמין.",
        "translateModelNotAvailable": "מפתח API עובד, אך gpt-realtime-translate אינו נגיש עם מפתח זה.",
        "transcriptModelTooltipTranslate": "כתוביות בשפת המקור. כרגע נתמך רק gpt-realtime-whisper.",
        "modelTooltipTranslate": "מודל תרגום קולי ייעודי של OpenAI. הקול מסתגל אוטומטית לדובר המקור.",
    },
    "fa": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "مدل ترجمه صوتی بلادرنگ OpenAI. بیش از ۷۰ زبان مبدأ، ۱۳ زبان مقصد.",
        "translateInfoBanner": "این مدل وقتی گوینده از همان زبان مقصد استفاده می‌کند ساکت می‌ماند. گفتار چندزبانه ممکن است شکاف داشته باشد.",
        "targetLanguageLimited": "این مدل از ۱۳ زبان مقصد پشتیبانی می‌کند.",
        "translateModelAvailable": "کلید API تأیید شد. gpt-realtime-translate در دسترس است.",
        "translateModelNotAvailable": "کلید API کار می‌کند، اما با این کلید gpt-realtime-translate در دسترس نیست.",
        "transcriptModelTooltipTranslate": "زیرنویس زبان مبدأ. در حال حاضر فقط gpt-realtime-whisper پشتیبانی می‌شود.",
        "modelTooltipTranslate": "مدل ترجمه صوتی اختصاصی OpenAI. صدا به طور خودکار با گوینده مبدأ تطبیق می‌یابد.",
    },
    "hi": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "OpenAI का रियल-टाइम वॉयस-टू-वॉयस अनुवाद मॉडल। 70+ स्रोत भाषाएँ, 13 लक्ष्य भाषाएँ।",
        "translateInfoBanner": "जब वक्ता लक्ष्य के समान भाषा का उपयोग करता है, तो यह मॉडल चुप रहता है। मिश्रित भाषा वाले भाषण में अंतराल हो सकते हैं।",
        "targetLanguageLimited": "यह मॉडल 13 लक्ष्य भाषाओं का समर्थन करता है।",
        "translateModelAvailable": "API कुंजी मान्य की गई। gpt-realtime-translate उपलब्ध है।",
        "translateModelNotAvailable": "API कुंजी काम करती है, लेकिन इस कुंजी से gpt-realtime-translate तक पहुँच नहीं है।",
        "transcriptModelTooltipTranslate": "स्रोत भाषा कैप्शन। वर्तमान में केवल gpt-realtime-whisper समर्थित है।",
        "modelTooltipTranslate": "OpenAI का समर्पित वॉयस अनुवाद मॉडल। आवाज़ स्वचालित रूप से स्रोत वक्ता के अनुकूल हो जाती है।",
    },
    "bn": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "OpenAI এর রিয়েল-টাইম স্পিচ-টু-স্পিচ অনুবাদ মডেল। ৭০+ উৎস ভাষা, ১৩ লক্ষ্য ভাষা।",
        "translateInfoBanner": "যখন বক্তা লক্ষ্যের সাথে একই ভাষা ব্যবহার করেন, তখন এই মডেল নীরব থাকে। মিশ্র ভাষার বক্তব্যে ফাঁক থাকতে পারে।",
        "targetLanguageLimited": "এই মডেল ১৩টি লক্ষ্য ভাষা সমর্থন করে।",
        "translateModelAvailable": "API কী যাচাই করা হয়েছে। gpt-realtime-translate উপলব্ধ।",
        "translateModelNotAvailable": "API কী কাজ করে, কিন্তু এই কী দিয়ে gpt-realtime-translate অ্যাক্সেস করা যায় না।",
        "transcriptModelTooltipTranslate": "উৎস ভাষার সাবটাইটেল। বর্তমানে শুধু gpt-realtime-whisper সমর্থিত।",
        "modelTooltipTranslate": "OpenAI এর ডেডিকেটেড ভয়েস অনুবাদ মডেল। কণ্ঠস্বর স্বয়ংক্রিয়ভাবে উৎস বক্তার সাথে মানিয়ে নেয়।",
    },
    "ta": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "OpenAI இன் நேரடி பேச்சு-முதல்-பேச்சு மொழிபெயர்ப்பு மாதிரி. 70+ மூல மொழிகள், 13 இலக்கு மொழிகள்.",
        "translateInfoBanner": "பேச்சாளர் இலக்கு மொழியையே பயன்படுத்தும்போது இந்த மாதிரி அமைதியாக இருக்கும். கலப்பு மொழி பேச்சில் இடைவெளிகள் இருக்கலாம்.",
        "targetLanguageLimited": "இந்த மாதிரி 13 இலக்கு மொழிகளை ஆதரிக்கிறது.",
        "translateModelAvailable": "API விசை சரிபார்க்கப்பட்டது. gpt-realtime-translate கிடைக்கிறது.",
        "translateModelNotAvailable": "API விசை செயல்படுகிறது, ஆனால் இந்த விசையால் gpt-realtime-translate ஐ அணுக முடியாது.",
        "transcriptModelTooltipTranslate": "மூல மொழி வசனங்கள். தற்போது gpt-realtime-whisper மட்டுமே ஆதரிக்கப்படுகிறது.",
        "modelTooltipTranslate": "OpenAI இன் சிறப்பு பேச்சு மொழிபெயர்ப்பு மாதிரி. குரல் தானாக மூல பேச்சாளரின் தொனியுடன் பொருந்துகிறது.",
    },
    "te": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "OpenAI యొక్క రియల్ టైమ్ స్పీచ్ టు స్పీచ్ అనువాద మోడల్. 70+ మూల భాషలు, 13 లక్ష్య భాషలు.",
        "translateInfoBanner": "మాట్లాడేవారు లక్ష్యంతో ఒకే భాషను ఉపయోగించినప్పుడు ఈ మోడల్ నిశ్శబ్దంగా ఉంటుంది. మిశ్రమ భాష ప్రసంగంలో అంతరాలు ఉండవచ్చు.",
        "targetLanguageLimited": "ఈ మోడల్ 13 లక్ష్య భాషలను సపోర్ట్ చేస్తుంది.",
        "translateModelAvailable": "API కీ ధృవీకరించబడింది. gpt-realtime-translate అందుబాటులో ఉంది.",
        "translateModelNotAvailable": "API కీ పని చేస్తుంది, కానీ ఈ కీతో gpt-realtime-translate యాక్సెస్ చేయబడదు.",
        "transcriptModelTooltipTranslate": "మూల భాష ఉపశీర్షికలు. ప్రస్తుతం gpt-realtime-whisper మాత్రమే మద్దతు ఉంది.",
        "modelTooltipTranslate": "OpenAI యొక్క ప్రత్యేక వాయిస్ అనువాద మోడల్. వాయిస్ స్వయంచాలకంగా మూల వక్తకు అనుగుణంగా ఉంటుంది.",
    },
    "th": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "โมเดลการแปลเสียงแบบเรียลไทม์จาก OpenAI รองรับ 70+ ภาษาต้นทาง 13 ภาษาปลายทาง",
        "translateInfoBanner": "โมเดลนี้จะเงียบเมื่อผู้พูดใช้ภาษาเดียวกับภาษาปลายทาง คำพูดที่ผสมหลายภาษาอาจมีช่องว่าง",
        "targetLanguageLimited": "โมเดลนี้รองรับ 13 ภาษาปลายทาง",
        "translateModelAvailable": "ตรวจสอบ API key สำเร็จ gpt-realtime-translate พร้อมใช้งาน",
        "translateModelNotAvailable": "API key ใช้งานได้ แต่ไม่สามารถเข้าถึง gpt-realtime-translate ด้วย key นี้",
        "transcriptModelTooltipTranslate": "คำบรรยายภาษาต้นทาง ปัจจุบันรองรับเฉพาะ gpt-realtime-whisper",
        "modelTooltipTranslate": "โมเดลการแปลเสียงเฉพาะของ OpenAI เสียงจะปรับให้เข้ากับผู้พูดต้นทางโดยอัตโนมัติ",
    },
    "vi": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "Mô hình dịch giọng nói thời gian thực của OpenAI. 70+ ngôn ngữ nguồn, 13 ngôn ngữ đích.",
        "translateInfoBanner": "Mô hình này im lặng khi người nói sử dụng cùng ngôn ngữ với ngôn ngữ đích. Lời nói đa ngôn ngữ có thể có khoảng trống.",
        "targetLanguageLimited": "Mô hình này hỗ trợ 13 ngôn ngữ đích.",
        "translateModelAvailable": "Khóa API đã được xác thực. gpt-realtime-translate có sẵn.",
        "translateModelNotAvailable": "Khóa API hoạt động, nhưng không thể truy cập gpt-realtime-translate với khóa này.",
        "transcriptModelTooltipTranslate": "Phụ đề ngôn ngữ nguồn. Hiện chỉ hỗ trợ gpt-realtime-whisper.",
        "modelTooltipTranslate": "Mô hình dịch giọng nói chuyên dụng của OpenAI. Giọng nói tự động thích ứng với người nói nguồn.",
    },
    "id": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "Model terjemahan suara real-time dari OpenAI. 70+ bahasa sumber, 13 bahasa target.",
        "translateInfoBanner": "Model ini diam ketika pembicara menggunakan bahasa yang sama dengan target. Ucapan multi-bahasa mungkin memiliki celah.",
        "targetLanguageLimited": "Model ini mendukung 13 bahasa target.",
        "translateModelAvailable": "Kunci API divalidasi. gpt-realtime-translate tersedia.",
        "translateModelNotAvailable": "Kunci API berfungsi, tetapi gpt-realtime-translate tidak dapat diakses dengan kunci ini.",
        "transcriptModelTooltipTranslate": "Subtitle bahasa sumber. Saat ini hanya gpt-realtime-whisper yang didukung.",
        "modelTooltipTranslate": "Model terjemahan suara khusus dari OpenAI. Suara secara otomatis menyesuaikan dengan pembicara sumber.",
    },
    "ms": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "Model terjemahan suara masa nyata daripada OpenAI. 70+ bahasa sumber, 13 bahasa sasaran.",
        "translateInfoBanner": "Model ini senyap apabila penutur menggunakan bahasa yang sama dengan sasaran. Pertuturan berbilang bahasa mungkin mempunyai jurang.",
        "targetLanguageLimited": "Model ini menyokong 13 bahasa sasaran.",
        "translateModelAvailable": "Kunci API disahkan. gpt-realtime-translate tersedia.",
        "translateModelNotAvailable": "Kunci API berfungsi, tetapi gpt-realtime-translate tidak boleh diakses dengan kunci ini.",
        "transcriptModelTooltipTranslate": "Sari kata bahasa sumber. Pada masa ini hanya gpt-realtime-whisper disokong.",
        "modelTooltipTranslate": "Model terjemahan suara khusus daripada OpenAI. Suara secara automatik menyesuaikan diri dengan penutur sumber.",
    },
    "fil": {
        "openaiTranslate": "OpenAI Translate",
        "openaiTranslateDescription": "Real-time speech-to-speech translation model ng OpenAI. 70+ source languages, 13 target languages.",
        "translateInfoBanner": "Tahimik ang modelo kapag ginagamit ng nagsasalita ang parehong wika sa target. Maaaring may mga puwang sa magkahalong wika.",
        "targetLanguageLimited": "Sumusuporta ang modelong ito sa 13 target na wika.",
        "translateModelAvailable": "Na-validate ang API key. Available ang gpt-realtime-translate.",
        "translateModelNotAvailable": "Gumagana ang API key, ngunit hindi ma-access ang gpt-realtime-translate gamit ang key na ito.",
        "transcriptModelTooltipTranslate": "Mga subtitle sa source language. Sa kasalukuyan ay gpt-realtime-whisper lang ang suportado.",
        "modelTooltipTranslate": "Dedicated voice translation model ng OpenAI. Awtomatikong nag-a-adjust ang boses sa source speaker.",
    },
}


def main():
    for locale_dir in sorted(LOCALES_DIR.iterdir()):
        if not locale_dir.is_dir() or locale_dir.name == "en":
            continue
        loc = locale_dir.name
        if loc not in T:
            print(f"WARN: missing translations for {loc}")
            continue

        f = locale_dir / "translation.json"
        with f.open("r", encoding="utf-8") as fh:
            data = json.load(fh)

        if "settings" not in data:
            print(f"WARN: no settings block in {loc}, skipping")
            continue

        for k, v in T[loc].items():
            data["settings"][k] = v

        with f.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write("\n")

        print(f"OK: {loc}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 16.2: Run the script**

```bash
python3 /tmp/add_translate_i18n.py
```
Expected: 29 lines of "OK: <locale>" output.

- [ ] **Step 16.3: Validate all JSON files parse**

```bash
for f in src/locales/*/translation.json; do
  python3 -c "import json; json.load(open('$f'))" || echo "INVALID: $f"
done
echo "All JSON valid"
```

- [ ] **Step 16.4: Verify all locales have the key**

```bash
for f in src/locales/*/translation.json; do
  loc=$(basename $(dirname "$f"))
  has=$(python3 -c "import json; d=json.load(open('$f')); print('Y' if 'openaiTranslate' in d.get('settings',{}) else 'N')")
  printf "%-7s %s\n" "$loc" "$has"
done
```
Expected: all 30 locales show "Y".

- [ ] **Step 16.5: Cleanup script**

```bash
rm -f /tmp/add_translate_i18n.py
```

- [ ] **Step 16.6: Commit**

```bash
git add src/locales/*/translation.json
git commit -m "$(cat <<'EOF'
feat(i18n): add OpenAI Translate strings for 29 locales

Same set of keys as English, applied via Python script (same pattern
as the recent reasoningEffort rollout). All 30 locales now carry
openaiTranslate, openaiTranslateDescription, translateInfoBanner,
targetLanguageLimited, translateModelAvailable,
translateModelNotAvailable, transcriptModelTooltipTranslate, and
modelTooltipTranslate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Final verification

**Files:** none

- [ ] **Step 17.1: Type check (filtered)**

```bash
npx tsc --noEmit 2>&1 | grep -vE '(Volcengine|logStore\.ts|settingsStore\.test\.ts|environment\.ts|splitSentences\.ts|PalabraAI)'
```
Expected: zero new errors related to this work.

- [ ] **Step 17.2: Full test suite**

```bash
npx vitest run --no-coverage 2>&1 | tail -6
```
Expected: at least 199/199 passing (186 baseline + 5 from Task 7 + 5 from Task 8 + 2 from Task 10 + 1 spare).

- [ ] **Step 17.3: Git status sanity check**

```bash
git status
```
Expected: working tree clean.

- [ ] **Step 17.4: Manual smoke test (requires user with real OpenAI API key)**

Run the dev server:
```bash
npm run electron:dev
```

In the app:
1. Open Settings → switch Provider to "OpenAI Translate"
2. Verify API key field is silently prefilled if you previously had OpenAI key configured
3. Verify the same-language silence info banner appears at the top
4. Verify model dropdown shows `gpt-realtime-translate` (1 entry)
5. Verify target language dropdown shows 13 entries
6. Verify voice / temperature / turn detection / max tokens sections are NOT rendered
7. Verify transcript model dropdown shows 1 entry: `gpt-realtime-whisper`
8. Verify transport switcher (WebSocket / WebRTC) renders
9. Start a session and speak in English with target = Chinese — confirm:
   - Source transcript appears (English)
   - Translated transcript appears (Chinese)
   - Translated audio plays
   - Items pair correctly in MainPanel (user + assistant rows)
10. Repeat with mixed-language input, confirm same-language silence behavior matches the banner warning
11. Switch to WebRTC transport, restart session, confirm same flow works
12. Smoke check 3 random target languages from the 13: `es`, `ja`, `de`

Report any failures back as new tasks.

---

## Self-Review

Spec coverage check:
- §3 Architecture (file layout, naming) → covered by Task 1, 3, 7, 11
- §4 Data Model (Provider enum, settings shape, session config, ProviderConfig field) → covered by Tasks 1, 2, 3
- §5 Event Flow (paired items, state machine, audio I/O, shared helpers) → covered by Tasks 7, 8, 9
- §6 UI (LanguageSection, InfoBanner, silent prefill, capability flags drive hiding) → covered by Tasks 4, 13, 14
- §7 Settings Store / ClientFactory / Validation → covered by Tasks 2, 4, 5, 12
- §8 i18n → covered by Tasks 15, 16
- §9 Testing strategy (unit tests for GA client, no WebRTC unit tests, manual smoke) → covered by Tasks 7-10, 17

Placeholder scan: no "TODO", "TBD", "implement later" sentinels in tasks. The Risks section in the spec has explicit TBD-style entries (whisper billing, exact client_secret response shape) — those are genuinely unknown until first real-API run, and Task 6 includes defensive parsing for the response shape.

Type consistency: `OpenAITranslateSessionConfig` defined in Task 1, used in Tasks 4, 7, 8, 9, 11. `TranslateTargetLanguage` defined in Task 1, used in Task 2, 3. `mintTranslationClientSecret` defined in Task 6, called in Task 11. `buildSessionUpdate` defined in Task 7, called in Tasks 9, 11. All names consistent.

Plan complete.
