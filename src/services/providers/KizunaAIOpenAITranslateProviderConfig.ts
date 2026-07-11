import { OpenAITranslateProviderConfig, OpenAITranslateSettings, defaultOpenAITranslateSettings } from './OpenAITranslateProviderConfig';
import { ProviderConfig } from './ProviderConfig';
import { Credentials, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { OpenAITranslateGAClient } from '../clients/OpenAITranslateGAClient';
import { getRelayWsUrl } from '../../utils/environment';

// Relay-managed KizunaAI twin reuses the existing OpenAI-translate slice.
export const defaultKizunaOpenaiTranslateSettings: OpenAITranslateSettings = { ...defaultOpenAITranslateSettings };

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

  // Backend-managed (relay) twins: the "apiKey" is a Better Auth session token,
  // not a provider key. The relay enforces real auth at connect time, so a
  // signed-in user (non-empty token) validates statically without a network
  // request — sending the session token to the public provider endpoint would
  // fail. Return the twin's static single model.
  // An empty token means the user is signed out: reject so a signed-out state
  // isn't cached as a successful validation (which would only fail later when
  // the relay rejects the WebSocket connection).
  async validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    if (!creds.ok) {
      return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
    }
    return {
      validation: { valid: true, message: '', validating: false },
      models: [{ id: this.latestRealtimeModel([]), type: 'realtime', created: Date.now() / 1000 }],
    };
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
