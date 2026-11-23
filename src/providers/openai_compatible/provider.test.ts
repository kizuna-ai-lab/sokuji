/**
 * A compatible service as a provider (text models, part B): the desktop app only, its address required and held to
 * the address rules, its key optional, its one unit translating, and a session that never starts whole.
 */
import { describe, it, expect } from 'vitest';
import { isPresent } from '../../lib/provider/presence';
import type { AuthContext } from '../../lib/run/types';
import { chatCompletion } from '../../lib/textModel/client';
import { TEXT_MODEL_DEFAULTS } from '../../lib/textModel/unit';
import { ADDRESS_INVALID, ADDRESS_MISSING, openaiCompatibleProvider as p } from './provider';

const auth: AuthContext = { signedIn: false, getToken: async () => null };
const read = (baseUrl: string, apiKey = '') => p.credentials.read({ baseUrl, apiKey }, auth);

describe('a compatible service', () => {
  it('is offered in the desktop app only: its requests are sent from the main process', () => {
    const env = { dev: false, enabled: new Set<string>(), kizuna: true, switchOn: () => false };
    expect(isPresent(p, { ...env, platform: 'electron' })).toBe(true);
    expect(isPresent(p, { ...env, platform: 'extension' })).toBe(false);
    expect(isPresent(p, { ...env, platform: 'web' })).toBe(false);
  });

  it('outside the desktop app it is reached by nothing, and says so', async () => {
    await expect(chatCompletion({ service: 'compatible', baseUrl: 'https://api.example.com/v1', signal: new AbortController().signal, model: 'm', messages: [], maxTokens: 16 }))
      .resolves.toEqual({ ok: false, failure: { code: 'refused', message: 'A compatible service can be reached from the desktop app only.' } });
  });

  it('needs an address, and one it can use; a key may be left out', () => {
    expect(read('')).toEqual({ missing: 'No address was given for the compatible service.', code: ADDRESS_MISSING });
    expect(read('http://api.example.com/v1')).toEqual({ missing: 'The address must start with https:// (http:// only for this computer).', code: ADDRESS_INVALID });
    expect(read('https://user:pw@api.example.com/v1')).toMatchObject({ code: ADDRESS_INVALID });
    expect(read('  http://localhost:11434/v1  ')).toEqual({ baseUrl: 'http://localhost:11434/v1' });
    expect(read('https://api.example.com/v1', ' test-key-0000 ')).toEqual({ baseUrl: 'https://api.example.com/v1', apiKey: 'test-key-0000' });
  });

  it('shows the address and an optional key, the address first', () => {
    expect(p.credentials.keys).toEqual(['baseUrl', 'apiKey']);
    expect(p.credentials.fields(TEXT_MODEL_DEFAULTS)).toEqual([
      { key: 'baseUrl', labelKey: 'setup.credentials.baseUrl', secret: false, placeholderKey: 'setup.credentials.baseUrlPlaceholder' },
      { key: 'apiKey', labelKey: 'setup.credentials.apiKeyOptional', secret: true, placeholderKey: 'setup.credentials.apiKeyOptional', optional: true },
    ]);
    // Stored apart from the retired OpenAI Compatible's slice, which held another endpoint's key.
    expect(p.settings.key).toBe('compatibleText');
    expect(p.credentials.storedAt).toBeUndefined();
  });

  it('translates through its one unit, and never starts a session whole', () => {
    expect(p.units.map((u) => [u.id, u.start, typeof u.startTranslation])).toEqual([['translation', undefined, 'function']]);
    expect(p.units[0].capabilities(TEXT_MODEL_DEFAULTS).speech).toBe('never');
    expect(p).not.toHaveProperty('start');
    expect(p.checkReads).toEqual(['translationModel', 'translationReasoning']);
  });
});
