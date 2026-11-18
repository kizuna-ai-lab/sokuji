// The app's notes service and language, read from the stores.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// The desktop build with the hosted services in it, where a test asks for it (the default notes service depends on it).
const desktop = vi.hoisted(() => ({ hosted: false }));
vi.mock('../../utils/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/environment')>();
  return { ...actual, isElectron: () => desktop.hosted || actual.isElectron() };
});
vi.mock('../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/registry')>();
  return { ...actual, presentProviders: () => (desktop.hosted ? [{ id: 'kizunaai_soniox', kind: 'managed' }] : actual.presentProviders()) as never };
});
import i18n from '../../locales';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import useSettingsStore from '../../stores/settingsStore';
import { notesChatFromStores, notesLanguageOf } from './appNotes';
import { registerAuth } from '../../app/currentAuth';
import { useAccountStore } from '../../stores/accountStore';
import { setUseOwnBalance } from '../session/payerChoice';
import { getBackendUrl } from '../../utils/environment';

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox' };

beforeEach(() => {
  desktop.hosted = false;
  useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'openai' }, stored: true });
  useProviderStore.setState({ entries: { openai: { settings: {}, credentials: { apiKey: ' sk-test ' }, pair: { source: 'en', target: 'ja' } } } as never });
  useSettingsStore.setState({ notesModel: 'gpt-6-luna' } as never);
});

describe('the notes service from the stores', () => {
  it('is OpenAI with the user\'s key and the model named in the settings', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })));
    vi.stubGlobal('fetch', fetch);
    const service = await notesChatFromStores();
    expect(service?.model).toBe('gpt-6-luna');
    await service!.chat({ system: 'S', prompt: 'whole-meeting', promptVersion: 2, user: {}, effort: 'none', maxTokens: 10, signal: new AbortController().signal });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    vi.unstubAllGlobals();
  });

  it('is Kizuna AI\'s relay when chosen and signed in: the sign-in, the meeting and the chosen payer go with each call', async () => {
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'kizunaai_openai' }, stored: true });
    registerAuth(() => ({ signedIn: true, getToken: async () => 'session-token' }));
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 1, frozen: false, organization: { name: 'Org', availableMicroUsd: 1, frozen: false } } });
    setUseOwnBalance(true);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })));
    vi.stubGlobal('fetch', fetch);
    try {
      const service = await notesChatFromStores('rec-1');
      expect(service?.model).toBe('gpt-6-luna');
      await service!.chat({ system: 'S', prompt: 'live-update', promptVersion: 2, user: {}, effort: 'none', maxTokens: 10, signal: new AbortController().signal });
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`${getBackendUrl()}/api/openai/chat/completions`);
      expect(init.headers).toMatchObject({ Authorization: 'Bearer session-token', 'X-Sokuji-Session': 'rec-1', 'X-Sokuji-Payer': 'personal', 'X-Sokuji-Prompt': 'live-update' });
    } finally {
      vi.unstubAllGlobals();
      setUseOwnBalance(false);
      useAccountStore.setState({ account: null });
      registerAuth(() => undefined);
    }
  });

  it('is none for Kizuna AI while signed out', async () => {
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'kizunaai_openai' }, stored: true });
    registerAuth(() => ({ signedIn: false, getToken: async () => null }));
    expect(await notesChatFromStores('rec-1')).toBeNull();
    registerAuth(() => undefined);
    expect(await notesChatFromStores('rec-1')).toBeNull();
  });

  // Review: signed out with an OpenAI key and no service chosen, the notes are written with that key. The key is read
  // before the default is worked out, even when the OpenAI settings have not been loaded yet.
  it('with none named and signed out, writes with OpenAI once its stored key is loaded', async () => {
    desktop.hosted = true;
    registerAuth(() => ({ signedIn: false, loaded: true, userId: null, getToken: async () => null }) as never);
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: null }, stored: true });
    useProviderStore.setState({ entries: {} } as never);
    const load = vi.spyOn(useProviderStore.getState(), 'load').mockImplementation(async () => {
      useProviderStore.setState({ entries: { openai: { settings: {}, credentials: { apiKey: 'sk-stored' }, pair: { source: 'en', target: 'ja' } } } } as never);
    });
    try {
      expect((await notesChatFromStores())?.model).toBe('gpt-6-luna');
    } finally {
      load.mockRestore();
      registerAuth(() => undefined);
    }
  });

  // Review: where Kizuna AI is the default whatever OpenAI's key holds (offered, signed in), OpenAI's settings are not
  // read, so a failure to read them cannot keep the hosted notes from being written.
  it('with none named and signed in where Kizuna AI is offered, writes with Kizuna AI without reading OpenAI', async () => {
    desktop.hosted = true;
    registerAuth(() => ({ signedIn: true, loaded: true, userId: 'u1', getToken: async () => 'token' }) as never);
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: null }, stored: true });
    useProviderStore.setState({ entries: {} } as never);
    const load = vi.spyOn(useProviderStore.getState(), 'load').mockRejectedValue(new Error('settings could not be read'));
    try {
      const service = await notesChatFromStores('rec-1');
      expect(service).not.toBeNull();
      expect(load).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
      registerAuth(() => undefined);
    }
  });

  it('with none named in the line-up, writes with the default service; none when OpenAI has no key', async () => {
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: null }, stored: true });
    // Outside the desktop build no hosted service is offered: the default is OpenAI, with the key set up above.
    expect((await notesChatFromStores())?.model).toBe('gpt-6-luna');
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'openai' }, stored: true });
    useProviderStore.setState({ entries: { openai: { settings: {}, credentials: { apiKey: '' }, pair: { source: 'en', target: 'ja' } } } as never });
    expect(await notesChatFromStores()).toBeNull();
  });
});

describe('the language of the notes', () => {
  it('is the record\'s own language, or the interface language when that was automatic', async () => {
    expect(notesLanguageOf({ myLanguage: 'ja' })).toEqual({ code: 'ja', name: 'Japanese' });
    await i18n.changeLanguage('zh_CN');
    expect(notesLanguageOf({ myLanguage: 'auto' })).toEqual({ code: 'zh-CN', name: expect.stringMatching(/Chinese/) });
    await i18n.changeLanguage('en');
  });
});
