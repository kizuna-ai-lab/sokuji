// The app's notes service and language, read from the stores.
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'kizunaai' }, stored: true });
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
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'kizunaai' }, stored: true });
    registerAuth(() => ({ signedIn: false, getToken: async () => null }));
    expect(await notesChatFromStores('rec-1')).toBeNull();
    registerAuth(() => undefined);
    expect(await notesChatFromStores('rec-1')).toBeNull();
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
