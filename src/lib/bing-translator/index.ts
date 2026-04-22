export {
  BingTranslatorClient,
  BingTokenFetchError,
  BingUnsupportedLanguageError,
  BingTranslateError,
  parseTranslatorPage,
} from './BingTranslatorClient';
export type { BingTranslateResult, BingTranslatorClientOptions, ParsedTranslatorPage } from './BingTranslatorClient';
export { mapToBingCode, isSupportedByBing, BING_SUPPORTED_LANGUAGES } from './languageMap';
