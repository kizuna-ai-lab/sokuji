import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnyProvider, LanguageOption } from '../lib/provider/types';

const { stored, getSetting, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    getSetting: vi.fn(async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
  };
});
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting, setSetting }) },
}));

import { useProviderStore } from './providerStore';

const opt = (value: string): LanguageOption => ({ value, name: value, englishName: value });

interface ProbeSettings { region: 'us' | 'eu'; count: number; on: boolean }
/** Turning `on` stops offering fr, as a model choice can narrow a provider's languages. */
const langs = (s: ProbeSettings) => [opt('en'), opt('ja'), ...(s.on ? [] : [opt('fr')])];

const probe = {
  id: 'probe',
  kind: 'own-key',
  settings: { key: 'probe', defaults: { region: 'us', count: 1, on: false } satisfies ProbeSettings },
  credentials: {
    keys: ['apiKey', 'apiKeyEu'],
    fields: (s: ProbeSettings) => [{ key: s.region === 'eu' ? 'apiKeyEu' : 'apiKey', labelKey: 'k', secret: true }],
    read: () => ({}),
  },
  languages: {
    sources: (s: ProbeSettings) => langs(s),
    targets: (source: string, s: ProbeSettings) => langs(s).filter((o) => o.value !== source),
  },
} as unknown as AnyProvider;

const entry = () => useProviderStore.getState().entries.probe;

beforeEach(() => {
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {} });
});

describe('load', () => {
  it("reads each settings field at settings.<key>.<field>, with that field's default", async () => {
    stored.set('settings.probe.count', 7);
    await useProviderStore.getState().load(probe);
    expect(getSetting).toHaveBeenCalledWith('settings.probe.count', 1);
    expect(getSetting).toHaveBeenCalledWith('settings.probe.on', false);
    expect(entry().settings).toEqual({ region: 'us', count: 7, on: false });
  });

  it('runs migrate over what was stored', async () => {
    const migrating = {
      ...probe,
      settings: { ...probe.settings, migrate: (s: Record<string, unknown>) => ({ ...s, count: Number(s.count) * 10 }) },
    } as AnyProvider;
    stored.set('settings.probe.count', 2);
    await useProviderStore.getState().load(migrating);
    expect(entry().settings).toMatchObject({ count: 20 });
  });

  it('reads credentials as strings under their own keys, apart from the settings', async () => {
    stored.set('settings.probe.apiKey', 'sk-1');
    await useProviderStore.getState().load(probe);
    expect(getSetting).toHaveBeenCalledWith('settings.probe.apiKey', '');
    expect(entry().credentials).toEqual({ apiKey: 'sk-1', apiKeyEu: '' });
    expect(entry().settings).not.toHaveProperty('apiKey');
  });

  it('keeps a stored pair the provider offers', async () => {
    stored.set('settings.probe.sourceLanguage', 'ja');
    stored.set('settings.probe.targetLanguage', 'fr');
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'ja', target: 'fr' });
  });

  it('repairs a stored pair the provider does not offer', async () => {
    stored.set('settings.probe.sourceLanguage', 'xx');
    stored.set('settings.probe.targetLanguage', 'en');
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'en', target: 'ja' });
  });

  it('starts from the first source and its first target when nothing is stored', async () => {
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'en', target: 'ja' });
  });

  it('does not overwrite a provider that is already loaded', async () => {
    await useProviderStore.getState().load(probe);
    useProviderStore.getState().updateSettings(probe, { count: 5 });
    await useProviderStore.getState().load(probe);
    expect(entry().settings).toMatchObject({ count: 5 });
  });
});

describe('writes', () => {
  it('merges a settings patch and persists each patched field', async () => {
    await useProviderStore.getState().load(probe);
    useProviderStore.getState().updateSettings(probe, { count: 3 });
    expect(entry().settings).toEqual({ region: 'us', count: 3, on: false });
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.probe.count', 3));
  });

  it('moves the pair when new settings stop offering it, and persists only what moved', async () => {
    stored.set('settings.probe.targetLanguage', 'fr');
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'en', target: 'fr' });
    useProviderStore.getState().updateSettings(probe, { on: true });
    expect(entry().pair).toEqual({ source: 'en', target: 'ja' });
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.probe.targetLanguage', 'ja'));
    expect(setSetting).not.toHaveBeenCalledWith('settings.probe.sourceLanguage', expect.anything());
  });

  it('saves a credential under its key without touching the settings', async () => {
    await useProviderStore.getState().load(probe);
    useProviderStore.getState().setCredential(probe, 'apiKeyEu', 'eu-1');
    expect(entry().credentials.apiKeyEu).toBe('eu-1');
    expect(entry().settings).toEqual({ region: 'us', count: 1, on: false });
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.probe.apiKeyEu', 'eu-1'));
  });

  it('saves a new pair', async () => {
    await useProviderStore.getState().load(probe);
    useProviderStore.getState().setPair(probe, { source: 'ja', target: 'en' });
    expect(entry().pair).toEqual({ source: 'ja', target: 'en' });
    await vi.waitFor(() => {
      expect(setSetting).toHaveBeenCalledWith('settings.probe.sourceLanguage', 'ja');
      expect(setSetting).toHaveBeenCalledWith('settings.probe.targetLanguage', 'en');
    });
  });

  it('refuses writes to a provider that is not loaded', () => {
    expect(() => useProviderStore.getState().updateSettings(probe, { count: 2 })).toThrow('Provider "probe" is not loaded');
    expect(() => useProviderStore.getState().setCredential(probe, 'apiKey', 'x')).toThrow('Provider "probe" is not loaded');
    expect(() => useProviderStore.getState().setPair(probe, { source: 'en', target: 'ja' })).toThrow('Provider "probe" is not loaded');
  });
});
