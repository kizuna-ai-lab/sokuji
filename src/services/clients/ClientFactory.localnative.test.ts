import { describe, it, expect } from 'vitest';
import { Provider } from '../../types/Provider';
import { LocalNativeProviderConfig } from '../providers/LocalNativeProviderConfig';
import { LocalNativeClient } from './LocalNativeClient';

// The registry registers LOCAL_NATIVE only under Electron (isElectron() gate),
// so in jsdom the descriptor is exercised directly rather than through
// ProviderConfigFactory/ClientFactory lookups.
describe('LocalNativeProviderConfig descriptor', () => {
  it('is credential-free and creates a LocalNativeClient', async () => {
    const d = new LocalNativeProviderConfig();
    expect(await d.extractCredentials({}, {})).toEqual({ ok: true, primary: '' });
    const c = d.createClient({ ok: true, primary: '' }, { transport: 'websocket' });
    expect(c).toBeInstanceOf(LocalNativeClient);
    expect(c.getProvider()).toBe(Provider.LOCAL_NATIVE);
  });

  it('exposes the localNative settings slice key', () => {
    expect(new LocalNativeProviderConfig().settingsSliceKey).toBe('localNative');
  });
});
