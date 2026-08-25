// src/services/providers/tutorialUrls.ts
//
// Where a user goes to find out how to get a key for a provider. Shared by the
// Settings provider section and the setup wizard's credential step: the wizard
// asks for a key before the user has ever seen Settings, so the same link has
// to be reachable from both, and one map keeps them from drifting apart.
import { Provider } from '../../types/Provider';
import type { ProviderType } from '../../types/Provider';

/** The index page listing every provider's guide. */
export const AI_PROVIDERS_DOCS_URL = 'https://sokuji.kizuna.ai/docs/ai-providers';

/** Per-provider guide. Managed providers have none: their key is ours to fetch. */
export const TUTORIAL_URLS: Partial<Record<ProviderType, string>> = {
  [Provider.OPENAI]: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',
  [Provider.GEMINI]: 'https://sokuji.kizuna.ai/docs/tutorials/gemini-setup',
  [Provider.PALABRA_AI]: 'https://sokuji.kizuna.ai/docs/tutorials/palabraai-setup',
  [Provider.OPENAI_COMPATIBLE]: 'https://sokuji.kizuna.ai/docs/tutorials/openai-compatible-setup',
  [Provider.VOLCENGINE_AST2]: 'https://sokuji.kizuna.ai/docs/tutorials/volcengine-ast2-setup',
  [Provider.SONIOX]: 'https://sokuji.kizuna.ai/docs/tutorials/soniox-setup',
  [Provider.LOCAL_INFERENCE]: 'https://sokuji.kizuna.ai/docs/tutorials/local-inference-setup',
  [Provider.LOCAL_NATIVE]: 'https://sokuji.kizuna.ai/docs/tutorials/local-native-setup',
};
