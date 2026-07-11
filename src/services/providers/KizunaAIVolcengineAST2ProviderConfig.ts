import { VolcengineAST2ProviderConfig } from './VolcengineAST2ProviderConfig';
import { ProviderConfig } from './ProviderConfig';
import { Credentials, ClientOptions } from './ProviderDescriptor';
import { IClient } from '../interfaces/IClient';
import { VolcengineAST2Client } from '../clients/VolcengineAST2Client';
import { getRelayWsUrl } from '../../utils/environment';

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
