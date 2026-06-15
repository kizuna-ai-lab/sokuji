import { VolcengineAST2ProviderConfig } from './VolcengineAST2ProviderConfig';
import { ProviderConfig } from './ProviderConfig';

/**
 * KizunaAI Doubao — the relay-managed twin of Volcengine AST 2.0. Same
 * protocol/UI, but authenticated by the backend-managed session token and
 * routed through the Kizuna relay (handled in ClientFactory).
 */
export class KizunaAIVolcengineAST2ProviderConfig extends VolcengineAST2ProviderConfig {
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
