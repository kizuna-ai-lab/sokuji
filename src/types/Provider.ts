/**
 * Provider types and enums for AI service providers
 */

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
  LOCAL_INFERENCE = 'local_inference',
  LOCAL_NATIVE = 'local_native',
  ZOOM_AI = 'zoom_ai',
  SONIOX = 'soniox'
}

/**
 * Provider type definition
 */
export type ProviderType = Provider.OPENAI | Provider.GEMINI | Provider.PALABRA_AI | Provider.KIZUNA_AI_OPENAI_TRANSLATE | Provider.KIZUNA_AI_VOLCENGINE_AST2 | Provider.OPENAI_COMPATIBLE | Provider.OPENAI_TRANSLATE | Provider.VOLCENGINE_ST | Provider.VOLCENGINE_AST2 | Provider.LOCAL_INFERENCE | Provider.LOCAL_NATIVE | Provider.ZOOM_AI | Provider.SONIOX;

/**
 * OpenAI-compatible providers (providers that use OpenAI-compatible APIs)
 */
export const OPENAI_COMPATIBLE_PROVIDERS: ProviderType[] = [
  Provider.OPENAI,
  Provider.OPENAI_COMPATIBLE,
];

/**
 * Check if a provider is OpenAI-compatible
 */
export function isOpenAICompatible(provider: ProviderType): boolean {
  return OPENAI_COMPATIBLE_PROVIDERS.includes(provider);
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
