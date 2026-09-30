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
  KIZUNA_AI_SONIOX = 'kizunaai_soniox',
  OPENAI_COMPATIBLE = 'openai_compatible',
  OPENAI_TRANSLATE = 'openai_translate',
  OPENAI_LIVE = 'openai_live',
  VOLCENGINE_AST2 = 'volcengine_ast2',
  LOCAL_INFERENCE = 'local_inference',
  LOCAL_NATIVE = 'local_native',
  SONIOX = 'soniox'
}

/**
 * Provider type definition
 */
export type ProviderType = Provider.OPENAI | Provider.GEMINI | Provider.PALABRA_AI | Provider.KIZUNA_AI_SONIOX | Provider.OPENAI_COMPATIBLE | Provider.OPENAI_TRANSLATE | Provider.OPENAI_LIVE | Provider.VOLCENGINE_AST2 | Provider.LOCAL_INFERENCE | Provider.LOCAL_NATIVE | Provider.SONIOX;

/** The backend-managed provider: Kizuna AI's own service running on a
 *  third-party engine. Keep in lockstep with isKizunaManagedProvider below. */
export type KizunaManagedProvider = Provider.KIZUNA_AI_SONIOX;

export function isKizunaManagedProvider(p: Provider): p is KizunaManagedProvider {
  return p === Provider.KIZUNA_AI_SONIOX;
}

