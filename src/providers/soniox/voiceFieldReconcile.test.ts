import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

import type { AnyProvider, AuthContext } from '../../lib/provider/types';
import * as report from '../../lib/diagnostics/report';
import { useProviderStore } from '../../stores/providerStore';
import { kizunaSonioxProvider } from './kizuna';
import { sonioxProvider } from './provider';
import type { SonioxSettings } from './settings';
import { reconcileSonioxVoiceField } from './voiceFieldReconcile';

const settings = (p: AnyProvider = kizunaSonioxProvider) => useProviderStore.getState().entries[p.id].settings as SonioxSettings;
const signedIn = (userId = 'u1'): AuthContext => ({ signedIn: true, loaded: true, userId, getToken: async () => 't' });
const noClip = async () => false;

beforeEach(async () => {
  useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false, intent: undefined });
  await useProviderStore.getState().load(kizunaSonioxProvider);
  await useProviderStore.getState().load(sonioxProvider);
});

describe('reconcileSonioxVoiceField', () => {
  it('managed: a stale field selects the account’s voice there; with none and no clip, the default', async () => {
    await useProviderStore.getState().updateSettings(kizunaSonioxProvider, { voiceJp: 'stale' });
    await reconcileSonioxVoiceField(kizunaSonioxProvider, 'jp', () => signedIn(), {
      managedClient: () => ({ mine: async () => ({ voiceId: 'v-jp', status: 'ready', createdAt: 1 }) }), hasDeviceClip: noClip, online: () => true,
    });
    expect(settings().voiceJp).toBe('v-jp');

    await useProviderStore.getState().updateSettings(kizunaSonioxProvider, { voiceJp: 'stale' });
    await reconcileSonioxVoiceField(kizunaSonioxProvider, 'jp', () => signedIn(), {
      managedClient: () => ({ mine: async () => null }), hasDeviceClip: noClip, online: () => true,
    });
    expect(settings().voiceJp).toBe('Adrian');
  });

  it('own key keeps an id still in list() and resets a stale one', async () => {
    await useProviderStore.setState((s) => s);
    await useProviderStore.getState().setCredential(sonioxProvider, 'apiKeyEu', 'k-eu');
    await useProviderStore.getState().updateSettings(sonioxProvider, { voiceEu: 'v1' });
    const deps = { ownKeyClient: () => ({ list: async () => [{ id: 'v1' }] as never }), hasDeviceClip: noClip, online: () => true };
    await reconcileSonioxVoiceField(sonioxProvider, 'eu', () => undefined, deps);
    expect(settings(sonioxProvider).voiceEu).toBe('v1');
    await useProviderStore.getState().updateSettings(sonioxProvider, { voiceEu: 'gone' });
    await reconcileSonioxVoiceField(sonioxProvider, 'eu', () => undefined, deps);
    expect(settings(sonioxProvider).voiceEu).toBe('Adrian');
  });

  it('offline, signed out, a failed lookup or a built-in field change nothing; a built-in field is never looked up', async () => {
    const warn = vi.spyOn(report, 'reportWarning').mockImplementation(() => {});
    await useProviderStore.getState().updateSettings(kizunaSonioxProvider, { voiceJp: 'stale' });
    const mine = vi.fn(async () => null);
    const base = { managedClient: () => ({ mine }), hasDeviceClip: noClip };
    await reconcileSonioxVoiceField(kizunaSonioxProvider, 'jp', () => signedIn(), { ...base, online: () => false });
    await reconcileSonioxVoiceField(kizunaSonioxProvider, 'jp', () => ({ signedIn: false, getToken: async () => null }), { ...base, online: () => true });
    await reconcileSonioxVoiceField(kizunaSonioxProvider, 'jp', () => ({ ...signedIn(), loaded: false }), { ...base, online: () => true });
    expect(mine).not.toHaveBeenCalled();
    await expect(reconcileSonioxVoiceField(kizunaSonioxProvider, 'jp', () => signedIn(), {
      ...base, managedClient: () => ({ mine: async () => { throw new Error('401'); } }), online: () => true,
    })).resolves.toBeUndefined();
    expect(settings().voiceJp).toBe('stale');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][2]).toMatchObject({ dedupeKey: 'voice:reconcile' });
    warn.mockRestore();

    await useProviderStore.getState().updateSettings(kizunaSonioxProvider, { voiceJp: 'Kenji' });
    await reconcileSonioxVoiceField(kizunaSonioxProvider, 'jp', () => signedIn(), { ...base, online: () => true });
    expect(mine).not.toHaveBeenCalled();
  });

  it('never overwrites a choice made during the lookup', async () => {
    await useProviderStore.getState().updateSettings(kizunaSonioxProvider, { voiceJp: 'stale' });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const run = reconcileSonioxVoiceField(kizunaSonioxProvider, 'jp', () => signedIn(), {
      managedClient: () => ({ mine: async () => { await gate; return { voiceId: 'v-jp', status: 'ready', createdAt: 1 }; } }), hasDeviceClip: noClip, online: () => true,
    });
    await useProviderStore.getState().updateSettings(kizunaSonioxProvider, { voiceJp: 'Kenji' });
    release();
    await run;
    expect(settings().voiceJp).toBe('Kenji');
  });

  it('writes nothing when the account changed during the lookup', async () => {
    await useProviderStore.getState().updateSettings(kizunaSonioxProvider, { voiceJp: 'stale' });
    let user = 'u1';
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const run = reconcileSonioxVoiceField(kizunaSonioxProvider, 'jp', () => signedIn(user), {
      managedClient: () => ({ mine: async () => { await gate; return { voiceId: 'v-jp', status: 'ready', createdAt: 1 }; } }), hasDeviceClip: noClip, online: () => true,
    });
    user = 'u2';
    release();
    await run;
    expect(settings().voiceJp).toBe('stale');
  });

  it('own key ignores the managed clip: a stale id resets even when this account has a clip', async () => {
    await useProviderStore.getState().setCredential(sonioxProvider, 'apiKeyEu', 'k-eu');
    await useProviderStore.getState().updateSettings(sonioxProvider, { voiceEu: 'gone' });
    const hasDeviceClip = vi.fn(async () => true);
    await reconcileSonioxVoiceField(sonioxProvider, 'eu', () => signedIn(), {
      ownKeyClient: () => ({ list: async () => [] }), hasDeviceClip, online: () => true,
    });
    expect(settings(sonioxProvider).voiceEu).toBe('Adrian');
    expect(hasDeviceClip).not.toHaveBeenCalled();
  });

  it('own key writes nothing when the region key changed during the lookup', async () => {
    await useProviderStore.getState().setCredential(sonioxProvider, 'apiKeyEu', 'k1');
    await useProviderStore.getState().updateSettings(sonioxProvider, { voiceEu: 'gone' });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const run = reconcileSonioxVoiceField(sonioxProvider, 'eu', () => undefined, {
      ownKeyClient: () => ({ list: async () => { await gate; return []; } }), hasDeviceClip: noClip, online: () => true,
    });
    await useProviderStore.getState().setCredential(sonioxProvider, 'apiKeyEu', 'k2');
    release();
    await run;
    expect(settings(sonioxProvider).voiceEu).toBe('gone');
  });
});
