// src/services/providers/tutorialUrls.ts
//
// Where a user goes to find out how to set up a provider. The setup wizard's
// provider step links the index page; the old settings panel's provider
// section, kept for Local Native until kizuna-ai-lab/sokuji#578 (Stage 2
// deletion, ruling 1), links Local Native's guide. Every ported provider
// carries its own `guideUrl` in its definition.
import { Provider } from '../../types/Provider';
import type { ProviderType } from '../../types/Provider';

/** The index page listing every provider's guide. */
export const AI_PROVIDERS_DOCS_URL = 'https://sokuji.kizuna.ai/docs/ai-providers';

/** Per-provider guide, for the one provider the old section still shows. */
export const TUTORIAL_URLS: Partial<Record<ProviderType, string>> = {
  [Provider.LOCAL_NATIVE]: 'https://sokuji.kizuna.ai/docs/tutorials/local-native-setup',
};
