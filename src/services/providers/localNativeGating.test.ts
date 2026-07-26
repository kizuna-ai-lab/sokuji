import { describe, it, expect, vi } from 'vitest';
// Disabled-path coverage for the VITE_ENABLE_LOCAL_NATIVE gate: force every other
// flag on but isLocalNativeEnabled() off, so the registry is built exactly as a
// production build (flag unset) would build it. Lives in its own file because each
// test file gets an isolated module registry — the factory's static block runs once
// under this mock, whereas descriptorRegistry.test.ts pins the enabled path.
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isPalabraAIEnabled: () => true,
  isVolcengineSTEnabled: () => true,
  isVolcengineAST2Enabled: () => true,
  isZoomAIEnabled: () => true,
  isLocalNativeEnabled: () => false,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
}));
import { ProviderConfigFactory } from './ProviderConfigFactory';
import { Provider } from '../../types/Provider';

describe('LOCAL_NATIVE feature-flag gating (disabled path)', () => {
  it('omits LOCAL_NATIVE when the flag is off but keeps the other Electron providers', () => {
    const ids = ProviderConfigFactory.getAvailableProviders();
    expect(ids).not.toContain(Provider.LOCAL_NATIVE);
    // OPENAI_COMPATIBLE and VOLCENGINE_AST2 are Electron-gated but not behind the
    // Local Native flag, so they must remain registered.
    expect(ids).toContain(Provider.OPENAI_COMPATIBLE);
    expect(ids).toContain(Provider.VOLCENGINE_AST2);
    // One fewer than the 13 in descriptorRegistry.test.ts (which forces the flag on).
    expect(ids.length).toBe(12);
  });
});
