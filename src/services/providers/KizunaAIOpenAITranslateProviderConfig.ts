import { OpenAITranslateProviderConfig } from './OpenAITranslateProviderConfig';
import { ProviderConfig } from './ProviderConfig';
import { Credentials, ClientOptions } from './ProviderDescriptor';
import { IClient } from '../interfaces/IClient';
import { OpenAITranslateGAClient } from '../clients/OpenAITranslateGAClient';
import { getRelayWsUrl } from '../../utils/environment';

/**
 * KizunaAI Translate — the relay-managed twin of OpenAI Translate. Same
 * protocol/UI, but authenticated by the backend-managed session token and
 * routed through the Kizuna relay.
 */
export class KizunaAIOpenAITranslateProviderConfig extends OpenAITranslateProviderConfig {
  readonly settingsSliceKey: string = 'kizunaOpenaiTranslate';

  // Override — routes through the relay using the backend-managed session token.
  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new OpenAITranslateGAClient(creds.primary, {
      wsUrl: `${getRelayWsUrl()}/realtime/translations`,
    });
  }

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
