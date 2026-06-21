import { describe, it, expect } from 'vitest';
import { ClientFactory } from './ClientFactory';
import { Provider } from '../../types/Provider';
import { LocalNativeClient } from './LocalNativeClient';

describe('ClientFactory LOCAL_NATIVE', () => {
  it('creates a LocalNativeClient without an API key', () => {
    const c = ClientFactory.createClient('native-asr-translate', Provider.LOCAL_NATIVE, '');
    expect(c).toBeInstanceOf(LocalNativeClient);
    expect(c.getProvider()).toBe(Provider.LOCAL_NATIVE);
  });
});
