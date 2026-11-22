// The app's notes service and language, read from the stores.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The desktop build with the hosted services in it, or with the text models (Gemini's, a compatible service), where a
// test asks for it (the default notes service depends on them).
const desktop = vi.hoisted(() => ({ hosted: false, text: false }));
vi.mock('../../utils/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/environment')>();
  return { ...actual, isElectron: () => desktop.hosted || desktop.text || actual.isElectron() };
});
vi.mock('../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/registry')>();
  const present = () => [
    ...(desktop.hosted ? [{ id: 'kizunaai_soniox', kind: 'managed' }] : []),
    ...(desktop.text ? [{ id: 'gemini_text', kind: 'own-key' }, { id: 'openai_compatible', kind: 'own-key' }] : []),
  ];
  return { ...actual, presentProviders: () => (desktop.hosted || desktop.text ? present() : actual.presentProviders()) as never };
});
import i18n from '../../locales';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import { forgetTextModelLists } from '../textModel/modelList';
import { TEXT_MODEL_DEFAULTS, type TextModelSettings } from '../textModel/unit';
import { notesChatFromStores, notesLanguageOf } from './appNotes';
import type { ChatRequest } from './chat';
import { registerAuth } from '../../app/currentAuth';
import { useAccountStore } from '../../stores/accountStore';
import { setUseOwnBalance } from '../session/payerChoice';
import { getBackendUrl } from '../../utils/environment';

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox' };
const PAIR = { source: 'en', target: 'ja' };
/** A text-model provider's entry: its settings, with the notes' as given, and its credentials. */
const textEntry = (credentials: Record<string, string>, notes: Partial<TextModelSettings> = {}) => ({ settings: { ...TEXT_MODEL_DEFAULTS, ...notes }, credentials, pair: PAIR });
const REQUEST: ChatRequest = { system: 'S', prompt: 'whole-meeting', promptVersion: 2, user: {}, effort: 'low', maxTokens: 32_000, signal: new AbortController().signal };

/** A fake OpenAI and Gemini at the page's fetch: the model list `ids`, and a notes answer to every chat. */
function fakeServices(ids: string[] = ['gpt-5-mini', 'gpt-6-luna']) {
  const fetch = vi.fn(async (url: string) => (String(url).endsWith('/models')
    ? new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }))
    : new Response(JSON.stringify({ id: 'chatcmpl-1', choices: [{ message: { content: '{}' } }] }))));
  vi.stubGlobal('fetch', fetch);
  const calls = () => fetch.mock.calls as unknown as Array<[string, RequestInit]>;
  const chats = () => calls().filter(([url]) => url.endsWith('/chat/completions'));
  return { fetch, calls, chats, body: (i = 0) => JSON.parse(String(chats()[i][1].body)) as Record<string, unknown> };
}

beforeEach(() => {
  desktop.hosted = false;
  desktop.text = false;
  forgetTextModelLists();
  useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'openai' }, stored: true });
  useProviderStore.setState({ entries: { openai_text: textEntry({ apiKey: ' sk-test ' }) } } as never);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('the notes service from the stores', () => {
  // Text models, part C: the notes with the user's own OpenAI key are OpenAI's text model's: its key, and the notes
  // model and reasoning chosen on the Notes card.
  it("is OpenAI's text model with the user's key, the notes model and the reasoning chosen for it", async () => {
    const s = fakeServices();
    useProviderStore.setState({ entries: { openai_text: textEntry({ apiKey: ' sk-test ' }, { notesModel: { listed: 'gpt-6-sol', typed: '' }, notesReasoning: { level: 'high', typed: '' } }) } } as never);
    const service = await notesChatFromStores();
    expect(service).toMatchObject({ model: 'gpt-6-sol', service: 'openai' });
    await expect(service!.chat(REQUEST)).resolves.toEqual({});
    const [url, init] = s.chats()[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(s.body()).toMatchObject({ model: 'gpt-6-sol', reasoning_effort: 'high', response_format: { type: 'json_object' } });
    // A model chosen needs no list.
    expect(s.calls()).toHaveLength(1);
  });

  it("Automatic: the notes' preference the key lists, whose first is the model the notes were written with before", async () => {
    const s = fakeServices(['gpt-5-mini', 'gpt-6-luna']);
    expect(await notesChatFromStores()).toMatchObject({ model: 'gpt-6-luna', service: 'openai' });
    expect(s.calls().map(([url]) => url)).toEqual(['https://api.openai.com/v1/models']);
    forgetTextModelLists();
    fakeServices(['gpt-4o', 'gpt-5-mini']);
    expect((await notesChatFromStores())?.model).toBe('gpt-5-mini');
  });

  it('Automatic with no list to read: the first preference, and the request says what is wrong', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect((await notesChatFromStores())?.model).toBe('gpt-6-luna');
  });

  it("is Gemini's text model with the user's Gemini key, at Gemini's endpoint", async () => {
    desktop.text = true;
    const s = fakeServices();
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'gemini_text' }, stored: true });
    useProviderStore.setState({ entries: { gemini_text: textEntry({ apiKey: 'gm-test' }, { notesModel: { listed: '', typed: 'gemini-3.8-flash' } }) } } as never);
    const service = await notesChatFromStores();
    expect(service).toMatchObject({ model: 'gemini-3.8-flash', service: 'gemini_text' });
    await service!.chat(REQUEST);
    expect(s.chats()[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(s.body()).toMatchObject({ model: 'gemini-3.8-flash', max_tokens: 32_000, reasoning_effort: 'low' });
  });

  it('is a compatible service at its address, with the model chosen for it; with none chosen, the notes say so', async () => {
    desktop.text = true;
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'openai_compatible' }, stored: true });
    useProviderStore.setState({ entries: { openai_compatible: textEntry({ baseUrl: 'http://localhost:11434/v1', apiKey: '' }, { notesModel: { listed: '', typed: 'qwen3:8b' } }) } } as never);
    const service = await notesChatFromStores();
    expect(service).toMatchObject({ model: 'qwen3:8b', service: 'openai_compatible' });
    // Outside the desktop app the main process that asks it is not there: refused, without a request.
    await expect(service!.chat(REQUEST)).rejects.toMatchObject({ serviceMessage: 'A compatible service can be reached from the desktop app only.', retryable: false });
    useProviderStore.setState({ entries: { openai_compatible: textEntry({ baseUrl: 'http://localhost:11434/v1', apiKey: '' }) } } as never);
    const unset = await notesChatFromStores();
    expect(unset).toMatchObject({ model: '', service: 'openai_compatible' });
    await expect(unset!.chat(REQUEST)).rejects.toMatchObject({ code: 'no-model', retryable: false });
  });

  it('is none where the chosen service has no key, or a compatible service no address', async () => {
    useProviderStore.setState({ entries: { openai_text: textEntry({ apiKey: '' }) } } as never);
    expect(await notesChatFromStores()).toBeNull();
    desktop.text = true;
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'openai_compatible' }, stored: true });
    useProviderStore.setState({ entries: { openai_compatible: textEntry({ baseUrl: '', apiKey: '' }, { notesModel: { listed: '', typed: 'm' } }) } } as never);
    expect(await notesChatFromStores()).toBeNull();
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
      expect(service).toMatchObject({ model: 'gpt-6-luna', service: 'kizunaai_openai' });
      await service!.chat({ system: 'S', prompt: 'live-update', promptVersion: 2, user: {}, effort: 'none', maxTokens: 10, signal: new AbortController().signal });
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`${getBackendUrl()}/api/openai/chat/completions`);
      expect(init.headers).toMatchObject({ Authorization: 'Bearer session-token', 'X-Sokuji-Session': 'rec-1', 'X-Sokuji-Payer': 'personal', 'X-Sokuji-Prompt': 'live-update' });
    } finally {
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
    fakeServices();
    registerAuth(() => ({ signedIn: false, loaded: true, userId: null, getToken: async () => null }) as never);
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: null }, stored: true });
    useProviderStore.setState({ entries: {} } as never);
    const load = vi.spyOn(useProviderStore.getState(), 'load').mockImplementation(async (p) => {
      if (p.id === 'openai_text') useProviderStore.setState({ entries: { ...useProviderStore.getState().entries, openai_text: textEntry({ apiKey: 'sk-stored' }) } } as never);
    });
    try {
      expect(await notesChatFromStores()).toMatchObject({ model: 'gpt-6-luna', service: 'openai' });
      expect(load.mock.calls.map(([p]) => p.id)).toEqual(['openai_text']);
    } finally {
      load.mockRestore();
      registerAuth(() => undefined);
    }
  });

  // Text models, part C: with no OpenAI key, a Gemini key writes them by default.
  it('with none named, signed out and only a Gemini key, writes with Gemini', async () => {
    desktop.text = true;
    fakeServices(['gemini-3.1-flash-lite', 'gemini-3.8-flash']);
    registerAuth(() => ({ signedIn: false, loaded: true, userId: null, getToken: async () => null }) as never);
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: null }, stored: true });
    useProviderStore.setState({ entries: {} } as never);
    const load = vi.spyOn(useProviderStore.getState(), 'load').mockImplementation(async (p) => {
      const entry = p.id === 'gemini_text' ? textEntry({ apiKey: 'gm-stored' }) : textEntry({ apiKey: '' });
      useProviderStore.setState({ entries: { ...useProviderStore.getState().entries, [p.id]: entry } } as never);
    });
    try {
      expect(await notesChatFromStores()).toMatchObject({ model: 'gemini-3.8-flash', service: 'gemini_text' });
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
    fakeServices();
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: null }, stored: true });
    // Outside the desktop build no hosted service is offered: the default is OpenAI, with the key set up above.
    expect((await notesChatFromStores())?.service).toBe('openai');
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'openai' }, stored: true });
    useProviderStore.setState({ entries: { openai_text: textEntry({ apiKey: '' }) } } as never);
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
