/**
 * The page's list of a service's text models: one kept per service and address, for the key it was asked with (by a
 * digest of it, never the key itself); another key at the same address takes its place; asked again on demand, and
 * never twice while one is on its way.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { TextModelAnswer, TextModelTransport } from './client';
import { fingerprint } from './fingerprint';
import { forgetTextModelLists, textModelList } from './modelList';

const KEY = 'test-key-0000';
const OTHER = 'test-key-0001';

/** A compatible service that lists `ids`; `held` keeps each answer until `release()`. */
function service(ids: string[], held = false) {
  const asked: string[] = [];
  const waiting: Array<() => void> = [];
  const transport: TextModelTransport = (url, init) => new Promise<TextModelAnswer>((resolve) => {
    asked.push(`${url} ${init.headers.Authorization ?? ''}`.trim());
    const answer = () => resolve({ status: 200, text: async () => JSON.stringify({ data: ids.map((id) => ({ id })) }) });
    if (held) waiting.push(answer);
    else answer();
  });
  return { transport, asked, release: () => { for (const answer of waiting.splice(0)) answer(); } };
}

const at = (baseUrl: string, apiKey: string, transport: TextModelTransport) => ({ service: 'compatible' as const, baseUrl, apiKey, transport });

beforeEach(() => forgetTextModelLists());
afterEach(() => vi.restoreAllMocks());

describe("the page's model list", () => {
  it('is asked once per service, address and key; asked again on demand', async () => {
    const s = service(['deepseek-chat']);
    await expect(textModelList(at('https://api.example.com/v1', KEY, s.transport))).resolves.toEqual({ ok: true, ids: ['deepseek-chat'] });
    await textModelList(at('https://api.example.com/v1', KEY, s.transport));
    expect(s.asked).toHaveLength(1);
    await textModelList(at('https://api.example.com/v1', KEY, s.transport), true);
    expect(s.asked).toHaveLength(2);
  });

  it('keeps no key: what it is kept by holds a digest of it', async () => {
    const set = vi.spyOn(Map.prototype, 'set');
    await textModelList(at('https://api.example.com/v1', KEY, service(['deepseek-chat']).transport));
    expect(set).toHaveBeenCalled();
    for (const [key, value] of set.mock.calls) {
      expect(JSON.stringify(key)).not.toContain(KEY);
      expect(JSON.stringify(value)).not.toContain(KEY);
    }
  });

  it("another key at the same address takes the first one's place; another address keeps its own", async () => {
    const s = service(['deepseek-chat']);
    await textModelList(at('https://api.example.com/v1', KEY, s.transport));
    await textModelList(at('http://localhost:11434/v1', '', s.transport));
    await textModelList(at('https://api.example.com/v1', OTHER, s.transport));
    expect(s.asked).toHaveLength(3);
    // The first key's list was let go: asked again.
    await textModelList(at('https://api.example.com/v1', KEY, s.transport));
    expect(s.asked).toEqual([
      'https://api.example.com/v1/models Bearer test-key-0000',
      'http://localhost:11434/v1/models',
      'https://api.example.com/v1/models Bearer test-key-0001',
      'https://api.example.com/v1/models Bearer test-key-0000',
    ]);
    // The other address's own list was kept.
    await textModelList(at('http://localhost:11434/v1', '', s.transport));
    expect(s.asked).toHaveLength(4);
  });

  it('a list on its way is shared, even asked again', async () => {
    const s = service(['deepseek-chat'], true);
    const first = textModelList(at('https://api.example.com/v1', KEY, s.transport));
    const again = textModelList(at('https://api.example.com/v1', KEY, s.transport), true);
    expect(again).toBe(first);
    await vi.waitFor(() => expect(s.asked).toHaveLength(1));
    s.release();
    await expect(again).resolves.toEqual({ ok: true, ids: ['deepseek-chat'] });
  });

  it('a failure is not kept', async () => {
    const asked: string[] = [];
    const refusing: TextModelTransport = async (url) => { asked.push(url); return { status: 401, text: async () => JSON.stringify({ error: { message: 'Invalid API key.' } }) }; };
    await expect(textModelList(at('https://api.example.com/v1', KEY, refusing))).resolves.toMatchObject({ ok: false, failure: { code: 'auth' } });
    await textModelList(at('https://api.example.com/v1', KEY, refusing));
    expect(asked).toHaveLength(2);
  });
});

describe('a fingerprint', () => {
  it('is short, the same for the same values, another for others, and holds none of them', () => {
    expect(fingerprint([KEY])).toBe(fingerprint([KEY]));
    expect(fingerprint([KEY])).not.toBe(fingerprint([OTHER]));
    expect(fingerprint(['a', 'bc'])).not.toBe(fingerprint(['ab', 'c']));
    expect(fingerprint([KEY])).not.toContain(KEY);
    expect(fingerprint([KEY]).length).toBeLessThanOrEqual(11);
  });
});
