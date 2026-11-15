import { describe, it, expect, beforeEach, vi } from 'vitest';

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
import { openaiProvider } from '../providers/openai/provider';
import { openaiTranslateProvider } from '../providers/openai_translate/provider';
import { openaiLiveProvider } from '../providers/openai_live/provider';

const entry = (id: string) => useProviderStore.getState().entries[id];

beforeEach(() => {
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  // A case may hold a read or fail a write: every case starts with storage that answers at once.
  getSetting.mockImplementation(async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def));
  setSetting.mockImplementation(async (key: string, value: unknown) => {
    stored.set(key, value);
    return { success: true };
  });
  useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false, intent: undefined });
});

describe('one OpenAI key', () => {
  it('the three OpenAI providers keep their key in one place', () => {
    for (const p of [openaiProvider, openaiTranslateProvider, openaiLiveProvider]) {
      expect(p.credentials.storedAt).toEqual({ key: 'openai', fallbacks: ['openaiTranslate', 'openaiLive'] });
    }
  });

  it('all three OpenAI providers read the one key', async () => {
    stored.set('settings.openai.apiKey', 'sk-o'); stored.set('settings.openaiLive.apiKey', 'sk-l');
    await useProviderStore.getState().load(openaiLiveProvider);
    expect(entry('openai_live').credentials.apiKey).toBe('sk-o');
  });

  it('a key stored only under OpenAI Live is still found', async () => {
    stored.set('settings.openaiLive.apiKey', 'sk-l');
    await useProviderStore.getState().load(openaiTranslateProvider);
    expect(entry('openai_translate').credentials.apiKey).toBe('sk-l');
  });

  it('saving writes the one key and every OpenAI provider uses it', async () => {
    stored.set('settings.openai.apiKey', 'sk-o'); stored.set('settings.openaiLive.apiKey', 'sk-l');
    await useProviderStore.getState().load(openaiProvider);
    await useProviderStore.getState().load(openaiLiveProvider);
    useProviderStore.getState().setCredential(openaiLiveProvider, 'apiKey', 'sk-new');
    expect(await useProviderStore.getState().flush(openaiLiveProvider, ['apiKey'])).toBe(true);
    expect(stored.get('settings.openai.apiKey')).toBe('sk-new');
    expect(stored.get('settings.openaiLive.apiKey')).toBe('sk-l');
    expect(entry('openai').credentials.apiKey).toBe('sk-new');
    expect(entry('openai_live').credentials.apiKey).toBe('sk-new');
  });

  it('a cleared key stays cleared: the old keys are read only while the one key was never stored', async () => {
    stored.set('settings.openaiLive.apiKey', 'sk-l');
    stored.set('settings.openai.apiKey', '');
    await useProviderStore.getState().load(openaiTranslateProvider);
    expect(entry('openai_translate').credentials.apiKey).toBe('');
  });
});

// PR review: the one key stays one key across a load in flight, and a flush answers for it.
describe('one OpenAI key — loads and saves in flight', () => {
  it('a key changed while another OpenAI provider is still loading reaches that provider', async () => {
    stored.set('settings.openai.apiKey', 'sk-old');
    await useProviderStore.getState().load(openaiProvider);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    getSetting.mockImplementation(async (key: string, def: unknown) => {
      const value = stored.has(key) ? stored.get(key) : def;
      if (key === 'settings.openai.apiKey') await held;
      return value;
    });
    const loading = useProviderStore.getState().load(openaiLiveProvider);
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    useProviderStore.getState().setCredential(openaiProvider, 'apiKey', 'sk-new');
    release();
    await loading;
    expect(entry('openai_live').credentials.apiKey).toBe('sk-new');
  });

  it('a flush of one OpenAI provider retries the one key and says when it did not land', async () => {
    await useProviderStore.getState().load(openaiLiveProvider);
    setSetting.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'settings.openai.apiKey') return { success: false };
      stored.set(key, value);
      return { success: true };
    });
    useProviderStore.getState().setCredential(openaiLiveProvider, 'apiKey', 'sk-x');
    expect(await useProviderStore.getState().flush(openaiLiveProvider)).toBe(false);
    setSetting.mockImplementation(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    });
    expect(await useProviderStore.getState().flush(openaiLiveProvider)).toBe(true);
    expect(stored.get('settings.openai.apiKey')).toBe('sk-x');
  });
});
