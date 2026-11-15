// The app's notes service and language, read from the stores.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import i18n from '../../locales';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import useSettingsStore from '../../stores/settingsStore';
import { notesChatFromStores, notesLanguageOf } from './appNotes';

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
    await service!.chat({ system: 'S', user: {}, effort: 'none', maxTokens: 10, signal: new AbortController().signal });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    vi.unstubAllGlobals();
  });

  it('is none when the line-up names no notes service, or OpenAI has no key', async () => {
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: null }, stored: true });
    expect(await notesChatFromStores()).toBeNull();
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
