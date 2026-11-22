/**
 * The text models' keys (text models, part B): OpenAI's text models use the one OpenAI key; Gemini's text models
 * use the Gemini key, kept where Gemini always kept it, so a key saved before serves both with nothing moved; a
 * compatible service keeps its address and its optional key apart, under a prefix of its own.
 */
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
import { runsOn } from './lineUpStore.testing';
import { geminiProvider } from '../providers/gemini/provider';
import { geminiTextProvider } from '../providers/gemini_text/provider';
import { openaiProvider } from '../providers/openai/provider';
import { openaiCompatibleProvider } from '../providers/openai_compatible/provider';
import { openaiTextProvider } from '../providers/openai_text/provider';

const entry = (id: string) => useProviderStore.getState().entries[id];

beforeEach(() => {
  stored.clear();
  runsOn(null);
  useProviderStore.setState({ entries: {}, intent: undefined, readiness: {} });
});

describe("the text models' keys", () => {
  it("OpenAI's text models read and write the one OpenAI key", async () => {
    expect(openaiTextProvider.credentials.storedAt).toEqual(openaiProvider.credentials.storedAt);
    stored.set('settings.openai.apiKey', 'sk-test-one');
    await useProviderStore.getState().load(openaiTextProvider);
    await useProviderStore.getState().load(openaiProvider);
    expect(entry('openai_text').credentials.apiKey).toBe('sk-test-one');
    useProviderStore.getState().setCredential(openaiTextProvider, 'apiKey', 'sk-test-two');
    expect(await useProviderStore.getState().flush(openaiTextProvider, ['apiKey'])).toBe(true);
    expect(stored.get('settings.openai.apiKey')).toBe('sk-test-two');
    expect(entry('openai').credentials.apiKey).toBe('sk-test-two');
  });

  it("Gemini's key, saved before there were text models, serves both; saved through either, both read it", async () => {
    expect(geminiProvider.credentials.storedAt).toEqual({ key: 'gemini', fallbacks: [] });
    expect(geminiTextProvider.credentials.storedAt).toEqual({ key: 'gemini', fallbacks: [] });
    stored.set('settings.gemini.apiKey', 'gm-test-old');
    await useProviderStore.getState().load(geminiProvider);
    await useProviderStore.getState().load(geminiTextProvider);
    expect(entry('gemini').credentials.apiKey).toBe('gm-test-old');
    expect(entry('gemini_text').credentials.apiKey).toBe('gm-test-old');
    useProviderStore.setState({ readiness: { gemini: { state: 'ready', models: [] }, gemini_text: { state: 'ready', models: [] } } });
    useProviderStore.getState().setCredential(geminiTextProvider, 'apiKey', 'gm-test-new');
    expect(await useProviderStore.getState().flush(geminiTextProvider, ['apiKey'])).toBe(true);
    // Where it always was: nothing under the text models' own prefix.
    expect(stored.get('settings.gemini.apiKey')).toBe('gm-test-new');
    expect(stored.has('settings.geminiText.apiKey')).toBe(false);
    expect(entry('gemini').credentials.apiKey).toBe('gm-test-new');
    // A new key is checked again by both.
    expect(useProviderStore.getState().readiness.gemini).toEqual({ state: 'unknown' });
    expect(useProviderStore.getState().readiness.gemini_text).toEqual({ state: 'unknown' });
  });

  it('a compatible service keeps its address and its key under its own prefix, never the retired OpenAI Compatible\'s', async () => {
    stored.set('settings.openaiCompatible.apiKey', 'sk-test-retired');
    await useProviderStore.getState().load(openaiCompatibleProvider);
    expect(entry('openai_compatible').credentials).toEqual({ baseUrl: '', apiKey: '' });
    useProviderStore.getState().setCredential(openaiCompatibleProvider, 'baseUrl', 'http://localhost:11434/v1');
    await useProviderStore.getState().flush(openaiCompatibleProvider, ['baseUrl']);
    expect(stored.get('settings.compatibleText.baseUrl')).toBe('http://localhost:11434/v1');
  });

  it('a change of the model or the reasoning forgets the readiness answer, and is stored as chosen', async () => {
    await useProviderStore.getState().load(openaiTextProvider);
    useProviderStore.setState({ readiness: { openai_text: { state: 'ready', models: [] } } });
    useProviderStore.getState().updateSettings(openaiTextProvider, { translationReasoning: { level: 'high', typed: '' } });
    expect(useProviderStore.getState().readiness.openai_text).toEqual({ state: 'unknown' });
    useProviderStore.setState({ readiness: { openai_text: { state: 'ready', models: [] } } });
    useProviderStore.getState().updateSettings(openaiTextProvider, { translationModel: { listed: 'gpt-5.4', typed: '' } });
    expect(useProviderStore.getState().readiness.openai_text).toEqual({ state: 'unknown' });
    // Stored as chosen, under the provider's own prefix.
    await useProviderStore.getState().flush(openaiTextProvider, ['translationModel']);
    expect(stored.get('settings.openaiText.translationModel')).toEqual({ listed: 'gpt-5.4', typed: '' });
  });
});
