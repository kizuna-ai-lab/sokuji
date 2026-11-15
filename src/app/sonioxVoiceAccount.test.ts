import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../lib/provider/types';
import { kizunaSonioxProvider } from '../providers/soniox/kizuna';
import { fakeProvider } from '../providers/fake/provider';
import { watchSonioxVoiceAccount } from './sonioxVoiceAccount';

vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

describe('watchSonioxVoiceAccount', () => {
  it('an account change reconciles the managed field once per new user', async () => {
    let auth: AuthContext = { signedIn: true, loaded: true, userId: 'a', getToken: async () => 't' };
    const watchers = new Set<() => void>();
    const reconcile = vi.fn(async (..._a: unknown[]) => {});
    const off = watchSonioxVoiceAccount({
      auth: () => auth,
      watchSignIn: (fn) => { watchers.add(fn); return () => { watchers.delete(fn); }; },
      providers: () => [fakeProvider, kizunaSonioxProvider],
      reconcile: reconcile as never,
    });
    const fire = async (next: Partial<AuthContext>) => { auth = { ...auth, ...next }; for (const w of [...watchers]) w(); await new Promise((r) => setTimeout(r, 0)); };
    await new Promise((r) => setTimeout(r, 0));
    expect(reconcile).toHaveBeenCalledTimes(1);
    await fire({});
    expect(reconcile).toHaveBeenCalledTimes(1);
    await fire({ userId: 'b' });
    expect(reconcile).toHaveBeenCalledTimes(2);
    await fire({ signedIn: false, userId: null });
    expect(reconcile).toHaveBeenCalledTimes(2);
    await fire({ signedIn: true, userId: 'a' });
    expect(reconcile).toHaveBeenCalledTimes(3);
    await fire({ loaded: false, userId: 'c' });
    expect(reconcile).toHaveBeenCalledTimes(3);
    expect(reconcile.mock.calls[0][0]).toBe(kizunaSonioxProvider);
    off();
    expect(watchers.size).toBe(0);
  });

  it('does nothing when the managed provider is absent', async () => {
    const reconcile = vi.fn(async (..._a: unknown[]) => {});
    watchSonioxVoiceAccount({
      auth: () => ({ signedIn: true, loaded: true, userId: 'a', getToken: async () => 't' }),
      watchSignIn: () => () => {},
      providers: () => [fakeProvider],
      reconcile: reconcile as never,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(reconcile).not.toHaveBeenCalled();
  });
});
