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
  KIZUNA_AI = 'kizunaai',
  OPENAI_COMPATIBLE = 'openai_compatible',
  VOLCENGINE_ST = 'volcengine_st',
  VOLCENGINE_AST2 = 'volcengine_ast2'
}

/**
 * Provider type definition
 */
export type ProviderType = Provider.OPENAI | Provider.GEMINI | Provider.PALABRA_AI | Provider.KIZUNA_AI | Provider.OPENAI_COMPATIBLE | Provider.VOLCENGINE_ST | Provider.VOLCENGINE_AST2;

/**
 * Array of all supported providers
 * Note: OPENAI_COMPATIBLE is only available in Electron environment
 * and will be filtered at the UI layer
 */
export const SUPPORTED_PROVIDERS: ProviderType[] = [
  Provider.OPENAI,
  Provider.GEMINI,
  ...(isPalabraAIEnabled() ? [Provider.PALABRA_AI] : []),
  ...(isKizunaAIEnabled() ? [Provider.KIZUNA_AI] : []),
  ...(isVolcengineSTEnabled() ? [Provider.VOLCENGINE_ST] : []),
  ...(isVolcengineAST2Enabled() ? [Provider.VOLCENGINE_AST2] : []),
  Provider.OPENAI_COMPATIBLE
];

/**
 * OpenAI-compatible providers (providers that use OpenAI-compatible APIs)
 */
export const OPENAI_COMPATIBLE_PROVIDERS: ProviderType[] = [
  Provider.OPENAI,
  Provider.OPENAI_COMPATIBLE,
  ...(isKizunaAIEnabled() ? [Provider.KIZUNA_AI] : [])
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
    case Provider.GEMINI:
      return 'Gemini';
    case Provider.PALABRA_AI:
      return 'PalabraAI';
    case Provider.KIZUNA_AI:
      return 'KizunaAI';
    case Provider.OPENAI_COMPATIBLE:
      return 'OpenAI Compatible API';
    case Provider.VOLCENGINE_ST:
      return 'Volcengine Speech Translate';
    case Provider.VOLCENGINE_AST2:
      return 'Volcengine AST';
    default:
      return provider;
  }
} 