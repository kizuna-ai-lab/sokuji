import { describe, it, expect, vi } from 'vitest';
// Disabled-path coverage for the VITE_ENABLE_LOCAL_NATIVE gate: on Electron,
// with isLocalNativeEnabled() off, as a production build (flag unset) builds
// the registry. Lives in its own file because each test file gets an isolated
// module registry — the factory's static block runs once under this mock,
// whereas descriptorRegistry.test.ts pins the enabled path. Local Native is
// the one provider the old registry keeps (Stage 2 deletion, ruling 1).
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isLocalNativeEnabled: () => false,
  isElectron: () => true,
  isExtension: () => false,
}));
import { ProviderConfigFactory } from './ProviderConfigFactory';
import { Provider } from '../../types/Provider';

describe('LOCAL_NATIVE feature-flag gating (disabled path)', () => {
  it('omits LOCAL_NATIVE when the flag is off, even on Electron', () => {
    expect(ProviderConfigFactory.getAvailableProviders()).not.toContain(Provider.LOCAL_NATIVE);
  });
});
