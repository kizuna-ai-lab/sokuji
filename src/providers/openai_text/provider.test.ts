/**
 * OpenAI's text models as a provider (text models, part B): the desktop app only, the one OpenAI key, one unit that
 * translates, its check over OpenAI's endpoints, and a session that never starts whole.
 */
import { describe, it, expect } from 'vitest';
import { isPresent } from '../../lib/provider/presence';
import type { AuthContext } from '../../lib/run/types';
import type { TextModelTransport } from '../../lib/textModel/client';
import { TEXT_MODEL_DEFAULTS } from '../../lib/textModel/unit';
import { OPENAI_KEY_STORED_AT } from '../openaiKey';
import { createOpenAITextCheck, openaiTextProvider as p } from './provider';

const auth: AuthContext = { signedIn: false, getToken: async () => null };

describe("OpenAI's text models", () => {
  it('are offered in the desktop app only (spec §1)', () => {
    const env = { dev: false, enabled: new Set<string>(), kizuna: true, switchOn: () => false };
    expect(isPresent(p, { ...env, platform: 'electron' })).toBe(true);
    expect(isPresent(p, { ...env, platform: 'extension' })).toBe(false);
  });

  it('use the one OpenAI key, trimmed', () => {
    expect(p.credentials.storedAt).toBe(OPENAI_KEY_STORED_AT);
    expect(p.credentials.read({ apiKey: ' test-key-0000\n' }, auth)).toEqual({ apiKey: 'test-key-0000' });
    expect(p.credentials.read({ apiKey: '' }, auth)).toEqual({ missing: 'Enter your OpenAI API key.' });
  });

  it("check OpenAI's own endpoints: the model list, then the model chosen", async () => {
    const urls: string[] = [];
    const transport: TextModelTransport = async (url) => {
      urls.push(url);
      return url.endsWith('/models')
        ? { status: 200, text: async () => JSON.stringify({ data: [{ id: 'gpt-5-mini' }] }) }
        : { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'H' } }] }) };
    };
    await expect(createOpenAITextCheck({ transport })({ apiKey: 'test-key-0000' }, TEXT_MODEL_DEFAULTS, { pair: { source: 'en', target: 'ja' }, legs: ['speaker'] }))
      .resolves.toEqual({ ok: true, models: [{ id: 'gpt-5-mini' }] });
    expect(urls).toEqual(['https://api.openai.com/v1/models', 'https://api.openai.com/v1/chat/completions']);
  });

  it('translate through their one unit, and never start a session whole', () => {
    expect(p.units.map((u) => [u.id, u.start, typeof u.startTranslation])).toEqual([['translation', undefined, 'function']]);
    expect([p.units[0].capabilities(TEXT_MODEL_DEFAULTS).speech, p.units[0].capabilities(TEXT_MODEL_DEFAULTS).textInput]).toEqual(['never', false]);
    expect(p.settingsStages).toEqual([['translation']]);
    expect(p).not.toHaveProperty('start');
  });
});

// Text models, part C: the notes with the user's own OpenAI key are this provider's, and its settings read the old
// global notes model once, while they hold no notes model of their own.
describe("OpenAI's text models: the notes model kept from before", () => {
  const migrate = (stored: Record<string, unknown>, legacy: Record<string, unknown>) => p.settings.migrate!({ ...TEXT_MODEL_DEFAULTS, ...stored }, { legacy, credentials: {} });

  it('read the old setting, and their own notes model where they hold one', () => {
    expect(p.settings.legacyKeys).toEqual(['settings.notes.model', 'notesModel']);
  });

  it('never stored a notes model of their own: the old one, where the user changed it', () => {
    expect(migrate({}, { 'settings.notes.model': 'gpt-6-sol', notesModel: undefined }).notesModel).toEqual({ listed: 'gpt-6-sol', typed: '' });
    expect(migrate({}, { 'settings.notes.model': 'o3', notesModel: undefined }).notesModel).toEqual({ listed: '', typed: 'o3' });
    // Never changed: Automatic, whose first choice is the old default.
    expect(migrate({}, { 'settings.notes.model': 'gpt-6-luna', notesModel: undefined }).notesModel).toEqual({ listed: '', typed: '' });
    expect(migrate({}, { 'settings.notes.model': undefined, notesModel: undefined }).notesModel).toEqual({ listed: '', typed: '' });
  });

  it('once their own is stored, Automatic included, the old one is read no more', () => {
    const own = { notesModel: { listed: '', typed: '' } };
    expect(migrate(own, { 'settings.notes.model': 'gpt-6-sol', notesModel: own.notesModel }).notesModel).toEqual({ listed: '', typed: '' });
  });

  it('keep the rest as every text model does', () => {
    expect(migrate({ translationReasoning: { level: 'high', typed: '' } }, {})).toEqual({ ...TEXT_MODEL_DEFAULTS, translationReasoning: { level: 'high', typed: '' } });
  });
});
