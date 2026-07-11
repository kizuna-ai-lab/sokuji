import { OpenAITranslateProviderConfig } from './OpenAITranslateProviderConfig';
import { ProviderConfig } from './ProviderConfig';

/**
 * KizunaAI Translate — the relay-managed twin of OpenAI Translate. Same
 * protocol/UI, but authenticated by the backend-managed session token and
 * routed through the Kizuna relay (handled in ClientFactory).
 */
export class KizunaAIOpenAITranslateProviderConfig extends OpenAITranslateProviderConfig {
  readonly settingsSliceKey: string = 'kizunaOpenaiTranslate';

  getConfig(): ProviderConfig {
    const base = super.getConfig();
    return {
      ...base,
      id: 'kizunaai_openai_translate',
      displayName: 'KizunaAI Translate',
      requiresAuth: true,
      apiKeyLabel: 'Kizuna AI Access',
      apiKeyPlaceholder: 'Authentication managed automatically',
    };
  }
}
