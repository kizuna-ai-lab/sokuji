import { describe, it, expect } from 'vitest';
import { isMissing, readCredentials } from './credentials';
import type { CredentialField } from './types';

const auth = { signedIn: false, getToken: async () => null };
const field = (key: string): CredentialField => ({ key, labelKey: key, secret: true });

describe('readCredentials', () => {
  it('hands read exactly the fields the settings show, a missing one as empty', () => {
    const seen: unknown[] = [];
    const p = {
      credentials: {
        keys: ['apiKey', 'apiKeyEu'],
        fields: (s: { region: string }) => [field(s.region === 'eu' ? 'apiKeyEu' : 'apiKey')],
        read: (values: Record<string, string>) => { seen.push(values); return { key: values.apiKeyEu }; },
      },
    };
    expect(readCredentials(p, { region: 'eu' }, { apiKey: 'us-1' }, auth)).toEqual({ key: '' });
    expect(seen).toEqual([{ apiKeyEu: '' }]);
  });

  it('answers a read that throws as missing, instead of throwing', () => {
    const p = { credentials: { keys: [], fields: () => [], read: () => { throw new Error('bad shape'); } } };
    const answer = readCredentials(p, {}, {}, auth);
    expect(isMissing(answer) && answer.missing).toBe('Could not read the credentials: bad shape');
  });

  it('tells a missing answer from credentials', () => {
    expect(isMissing({ missing: 'no key' })).toBe(true);
    expect(isMissing({ key: 'k' })).toBe(false);
    expect(isMissing({})).toBe(false);
  });

  it("passes a missing answer's code and params through", () => {
    const p = {
      credentials: {
        keys: [],
        fields: () => [],
        read: () => ({ missing: 'Sign in first.', code: 'sign_in_required', params: { who: 'you' } }),
      },
    };
    const answer = readCredentials(p, {}, {}, auth);
    expect(answer).toEqual({ missing: 'Sign in first.', code: 'sign_in_required', params: { who: 'you' } });
    expect(isMissing(answer)).toBe(true);
  });
});
