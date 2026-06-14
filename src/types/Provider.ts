/**
 * Provider types and enums for AI service providers
 */

import { isKizunaAIEnabled, isPalabraAIEnabled, isVolcengineSTEnabled, isVolcengineAST2Enabled } from '../utils/environment';

/**
 * Supported AI service providers
 */
export enum Provider {
  OPENAI = 'openai',
  GEMINI = 'gemini',
  PALABRA_AI = 'palabraai',
  KIZUNA_AI_OPENAI_TRANSLATE = 'kizunaai_openai_translate',
  KIZUNA_AI_VOLCENGINE_AST2 = 'kizunaai_volcengine_ast2',
  OPENAI_COMPATIBLE = 'openai_compatible',
  OPENAI_TRANSLATE = 'openai_translate',
  VOLCENGINE_ST = 'volcengine_st',
  VOLCENGINE_AST2 = 'volcengine_ast2',
  LOCAL_INFERENCE = 'local_inference'
}

/**
 * Provider type definition
 */
export type ProviderType = Provider.OPENAI | Provider.GEMINI | Provider.PALABRA_AI | Provider.KIZUNA_AI_OPENAI_TRANSLATE | Provider.KIZUNA_AI_VOLCENGINE_AST2 | Provider.OPENAI_COMPATIBLE | Provider.OPENAI_TRANSLATE | Provider.VOLCENGINE_ST | Provider.VOLCENGINE_AST2 | Provider.LOCAL_INFERENCE;

/**
 * Array of all supported providers
 * Note: OPENAI_COMPATIBLE is only available in Electron environment
 * and will be filtered at the UI layer
 */
export const SUPPORTED_PROVIDERS: ProviderType[] = [
  Provider.OPENAI,
  Provider.OPENAI_TRANSLATE,
  Provider.GEMINI,
  Provider.LOCAL_INFERENCE,
  ...(isPalabraAIEnabled() ? [Provider.PALABRA_AI] : []),
  ...(isKizunaAIEnabled() ? [Provider.KIZUNA_AI_OPENAI_TRANSLATE, Provider.KIZUNA_AI_VOLCENGINE_AST2] : []),
  ...(isVolcengineSTEnabled() ? [Provider.VOLCENGINE_ST] : []),
  ...(isVolcengineAST2Enabled() ? [Provider.VOLCENGINE_AST2] : []),
  Provider.OPENAI_COMPATIBLE,
];

/**
 * OpenAI-compatible providers (providers that use OpenAI-compatible APIs)
 */
export const OPENAI_COMPATIBLE_PROVIDERS: ProviderType[] = [
  Provider.OPENAI,
  Provider.OPENAI_COMPATIBLE,
];

/**
 * Check if a string is a valid provider
 */
export function isValidProvider(provider: string): provider is ProviderType {
  return SUPPORTED_PROVIDERS.includes(provider as ProviderType);
}

/**
 * Check if a provider is OpenAI-compatible
 */
export function isOpenAICompatible(provider: ProviderType): boolean {
  return OPENAI_COMPATIBLE_PROVIDERS.includes(provider);
}

/**
 * Get provider display name
 */
export function getProviderDisplayName(provider: ProviderType): string {
  switch (provider) {
    case Provider.OPENAI:
      return 'OpenAI';
    case Provider.OPENAI_TRANSLATE:
      return 'OpenAI Translate';
    case Provider.GEMINI:
      return 'Gemini';
    case Provider.PALABRA_AI:
      return 'PalabraAI';
    case Provider.OPENAI_COMPATIBLE:
      return 'OpenAI Compatible API';
    case Provider.VOLCENGINE_ST:
      return 'Volcengine Speech Translate';
    case Provider.VOLCENGINE_AST2:
      return 'Doubao AST 2.0';
    case Provider.LOCAL_INFERENCE:
      return 'Free';
    default:
      return provider;
  }
}

export function isKizunaManagedProvider(p: Provider): boolean {
  return p === Provider.KIZUNA_AI_OPENAI_TRANSLATE || p === Provider.KIZUNA_AI_VOLCENGINE_AST2;
}

/** The user-managed base provider whose behavior/UI a kizuna-managed twin reuses. */
export function kizunaBaseProvider(p: Provider): Provider | undefined {
  if (p === Provider.KIZUNA_AI_OPENAI_TRANSLATE) return Provider.OPENAI_TRANSLATE;
  if (p === Provider.KIZUNA_AI_VOLCENGINE_AST2) return Provider.VOLCENGINE_AST2;
  return undefined;
}
