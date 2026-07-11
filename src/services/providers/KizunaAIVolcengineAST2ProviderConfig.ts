import { VolcengineAST2ProviderConfig, VolcengineAST2Settings, defaultVolcengineAST2Settings } from './VolcengineAST2ProviderConfig';
import { ProviderConfig } from './ProviderConfig';
import { Credentials, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { VolcengineAST2Client } from '../clients/VolcengineAST2Client';
import { getRelayWsUrl } from '../../utils/environment';

// Relay-managed KizunaAI twin reuses the existing Volcengine-AST2 slice.
export const defaultKizunaVolcengineAst2Settings: VolcengineAST2Settings = { ...defaultVolcengineAST2Settings };

/**
 * KizunaAI Doubao — the relay-managed twin of Volcengine AST 2.0. Same
 * protocol/UI, but authenticated by the backend-managed session token and
 * routed through the Kizuna relay.
 */
export class KizunaAIVolcengineAST2ProviderConfig extends VolcengineAST2ProviderConfig {
  readonly settingsSliceKey: string = 'kizunaVolcengineAst2';

  // Override — routes through the relay using the backend-managed session token.
  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new VolcengineAST2Client('', '', undefined, {
      wsUrl: `${getRelayWsUrl()}/ast/translate`,
      sessionToken: creds.primary,
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
      id: 'kizunaai_volcengine_ast2',
      displayName: 'KizunaAI Doubao',
      requiresAuth: true,
    };
  }
}
