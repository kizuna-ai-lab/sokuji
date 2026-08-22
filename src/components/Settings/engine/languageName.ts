import { getLanguageOption } from '../../../utils/languages';

/**
 * Language display name for a code (e.g. 'ja' -> '日本語'), falling back to
 * the raw code when unknown. Shared by both EngineAdapter implementations
 * (useWasmEngineAdapter / useNativeEngineAdapter) and the two Library
 * sections' compatibilitySplit group headers, so every place that turns a
 * language code into a name for the engine UI resolves it identically —
 * mirrors how LanguageSection.tsx derives sourceLanguageName/
 * targetLanguageName (`providerConfig.languages.find(l => l.value ===
 * code)?.name`).
 *
 * Deliberately reads utils/languages.ts's LANGUAGE_OPTIONS map directly
 * instead of going through ProviderConfigFactory.getConfig(provider)
 * .languages (LOCAL_INFERENCE/LOCAL_NATIVE — the two callers that would need
 * it). Both providers' `.languages` field is literally
 * `getTranslationSourceLanguages()` (see LocalInferenceProviderConfig.ts /
 * LocalNativeProviderConfig.ts), which is itself every LANGUAGE_OPTIONS code
 * (a universal-multilingual translation model pulls in the whole set) mapped
 * through this same getLanguageOption lookup — confirmed no code resolves
 * differently — so the result is identical either way. Going through
 * ProviderConfigFactory would statically import EVERY provider descriptor
 * (OpenAI, Gemini, Palabra, Zoom, ...) into the two model-management
 * sections just to read one field — pulling in `src/locales`'s real i18n
 * singleton along the way, which broke ModelManagementSection.test.tsx's /
 * NativeModelManagementSection.test.tsx's fully-replaced
 * `vi.mock('react-i18next', ...)` the same way StoragePage.test.tsx's own
 * `initReactI18next` note documents.
 */
export function languageNameFor(code: string): string {
  return getLanguageOption(code).name;
}
