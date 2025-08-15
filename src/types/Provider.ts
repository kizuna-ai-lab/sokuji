/**
 * Provider types and enums for AI service providers
 */

/**
 * Supported AI service providers
 */
export enum Provider {
  OPENAI = 'openai',
  GEMINI = 'gemini',
  COMET_API = 'cometapi',
  PALABRA_AI = 'palabraai',
  KIZUNA_AI = 'kizunaai'
}

/**
 * Provider type definition
 */
export type ProviderType = Provider.OPENAI | Provider.GEMINI | Provider.COMET_API | Provider.PALABRA_AI | Provider.KIZUNA_AI;

/**
 * Array of all supported providers
 */
export const SUPPORTED_PROVIDERS: ProviderType[] = [
  Provider.OPENAI,
  Provider.GEMINI,
  Provider.COMET_API,
  Provider.PALABRA_AI,
  Provider.KIZUNA_AI
];

/**
 * OpenAI-compatible providers (providers that use OpenAI-compatible APIs)
 */
export const OPENAI_COMPATIBLE_PROVIDERS: ProviderType[] = [
  Provider.OPENAI,
  Provider.COMET_API,
  Provider.KIZUNA_AI
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
    case Provider.COMET_API:
      return 'CometAPI';
    case Provider.PALABRA_AI:
      return 'PalabraAI';
    case Provider.KIZUNA_AI:
      return 'KizunaAI';
    default:
      return provider;
  }
} 