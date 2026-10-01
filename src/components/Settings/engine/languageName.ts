import { getLanguageOption } from '../../../utils/languages';

/**
 * Language display name for a code (e.g. 'ja' -> '日本語'), falling back to
 * the raw code when unknown. Shared by both EngineAdapter implementations
 * (useWasmEngineAdapter / useNativeEngineAdapter) and the two Library
 * sections' availableWhenLang lines, so every place that turns a
 * language code into a name for the engine UI resolves it identically —
 * mirrors how LanguageSection.tsx derives sourceLanguageName/
 * targetLanguageName (`providerConfig.languages.find(l => l.value ===
 * code)?.name`).
 *
 * Deliberately reads utils/languages.ts's LANGUAGE_OPTIONS map directly
 * instead of going through the two providers' language lists. Both are
 * literally `getTranslationSourceLanguages()` (LocalInference's
 * `localInferenceLanguages.sources`, `src/providers/localInference/settings.ts`;
 * Local Native's `.languages`, `LocalNativeProviderConfig.ts`), which is
 * itself every LANGUAGE_OPTIONS code (a universal-multilingual translation
 * model pulls in the whole set) mapped through this same getLanguageOption
 * lookup — confirmed no code resolves differently — so the result is
 * identical either way. Going through `ProviderConfigFactory` once pulled
 * every old provider descriptor into the two model-management sections just
 * to read one field, and `src/locales`' real i18n singleton with them, which
 * broke ModelManagementSection.test.tsx's / NativeModelManagementSection.test.tsx's
 * fully-replaced `vi.mock('react-i18next', ...)` the same way
 * StoragePage.test.tsx's own `initReactI18next` note documents.
 */
export function languageNameFor(code: string): string {
  return getLanguageOption(code).name;
}
