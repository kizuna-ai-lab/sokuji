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
  KIZUNA_AI_SONIOX = 'kizunaai_soniox',
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
export type ProviderType = Provider.OPENAI | Provider.GEMINI | Provider.PALABRA_AI | Provider.KIZUNA_AI_OPENAI_TRANSLATE | Provider.KIZUNA_AI_VOLCENGINE_AST2 | Provider.KIZUNA_AI_SONIOX | Provider.OPENAI_COMPATIBLE | Provider.OPENAI_TRANSLATE | Provider.VOLCENGINE_ST | Provider.VOLCENGINE_AST2 | Provider.LOCAL_INFERENCE | Provider.LOCAL_NATIVE | Provider.ZOOM_AI | Provider.SONIOX;

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

/** The backend-managed twins: Kizuna AI's own service running on a third-party
 *  engine. Keep in lockstep with isKizunaManagedProvider below — several UI
 *  maps are keyed by this type and tested for exhaustiveness against it. */
export type KizunaManagedProvider =
  | Provider.KIZUNA_AI_OPENAI_TRANSLATE
  | Provider.KIZUNA_AI_VOLCENGINE_AST2
  | Provider.KIZUNA_AI_SONIOX;

export function isKizunaManagedProvider(p: Provider): p is KizunaManagedProvider {
  return p === Provider.KIZUNA_AI_OPENAI_TRANSLATE || p === Provider.KIZUNA_AI_VOLCENGINE_AST2
    || p === Provider.KIZUNA_AI_SONIOX;
}

/** The user-managed base provider whose behavior/UI a kizuna-managed twin reuses. */
export function kizunaBaseProvider(p: Provider): Provider | undefined {
  if (p === Provider.KIZUNA_AI_OPENAI_TRANSLATE) return Provider.OPENAI_TRANSLATE;
  if (p === Provider.KIZUNA_AI_VOLCENGINE_AST2) return Provider.VOLCENGINE_AST2;
  if (p === Provider.KIZUNA_AI_SONIOX) return Provider.SONIOX;
  return undefined;
}
