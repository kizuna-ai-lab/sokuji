/**
 * Gemini's text models as a provider (text models, part B): the desktop app only, the Gemini key Gemini Live uses,
 * one unit that translates, its check over Gemini's OpenAI-compatible endpoint.
 */
import { describe, it, expect } from 'vitest';
import { isPresent } from '../../lib/provider/presence';
import type { AuthContext } from '../../lib/run/types';
import type { TextModelTransport } from '../../lib/textModel/client';
import { TEXT_MODEL_DEFAULTS } from '../../lib/textModel/unit';
import { GEMINI_KEY_STORED_AT } from '../geminiKey';
import { createGeminiTextCheck, geminiTextProvider as p } from './provider';

const auth: AuthContext = { signedIn: false, getToken: async () => null };

describe("Gemini's text models", () => {
  it('are offered in the desktop app only (spec §1)', () => {
    const env = { dev: false, enabled: new Set<string>(), kizuna: true, switchOn: () => false };
    expect(isPresent(p, { ...env, platform: 'electron' })).toBe(true);
    expect(isPresent(p, { ...env, platform: 'web' })).toBe(false);
  });

  it("use Gemini's key, where Gemini keeps it, trimmed", () => {
    expect(p.credentials.storedAt).toBe(GEMINI_KEY_STORED_AT);
    expect(GEMINI_KEY_STORED_AT).toEqual({ key: 'gemini', fallbacks: [] });
    expect(p.credentials.read({ apiKey: ' test-key-0000 ' }, auth)).toEqual({ apiKey: 'test-key-0000' });
    expect(p.credentials.read({ apiKey: '' }, auth)).toEqual({ missing: 'Enter your Gemini API key.' });
  });

  it("check Gemini's OpenAI-compatible endpoint: its text models, then the automatic one", async () => {
    const sent: Array<{ url: string; model?: unknown }> = [];
    const transport: TextModelTransport = async (url, init) => {
      sent.push({ url, model: init.body ? JSON.parse(init.body).model : undefined });
      return url.endsWith('/models')
        ? { status: 200, text: async () => JSON.stringify({ data: [{ id: 'models/gemini-3.8-flash' }, { id: 'models/gemini-3.1-flash-lite' }, { id: 'models/text-embedding-004' }] }) }
        : { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'H' } }] }) };
    };
    await expect(createGeminiTextCheck({ transport })({ apiKey: 'test-key-0000' }, TEXT_MODEL_DEFAULTS, { pair: { source: 'en', target: 'ja' }, legs: ['speaker'] }))
      .resolves.toEqual({ ok: true, models: [{ id: 'gemini-3.8-flash' }, { id: 'gemini-3.1-flash-lite' }] });
    expect(sent).toEqual([
      { url: 'https://generativelanguage.googleapis.com/v1beta/openai/models', model: undefined },
      { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-3.1-flash-lite' },
    ]);
  });

  it('translate through their one unit', () => {
    expect(p.units.map((u) => [u.id, u.start, typeof u.startTranslation])).toEqual([['translation', undefined, 'function']]);
    expect(p.settings.key).toBe('geminiText');
  });
});
