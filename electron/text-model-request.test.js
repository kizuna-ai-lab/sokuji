// @vitest-environment node
// electron/text-model-request.test.js
//
// A compatible text-model service, asked from the main process: only its /models and /chat/completions, https (http
// on this computer only), with a 60-second and a 2 MB cap, and never a word of the key in what comes back.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const {
  checkTextModelRequest, performTextModelRequest, setupTextModelHandlers, textModelAddressProblem,
  MAX_ANSWER_BYTES, REQUEST_TIMEOUT_MS, TEXT_MODEL_PATHS,
} = nodeRequire('./text-model-request.js');

/** Not a key of any service. */
const KEY = 'test-key-0000';

const request = (over = {}) => ({
  id: 'text-model-1',
  baseUrl: 'https://api.example.com/v1',
  path: '/chat/completions',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
  body: '{"model":"m","messages":[]}',
  ...over,
});

/** A response whose body comes in `chunks`, as fetch's does. */
function answer(status, chunks = [], headers = {}) {
  let next = 0;
  const state = { cancelled: false };
  return {
    state,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body: {
      getReader: () => ({
        read: async () => (next < chunks.length ? { done: false, value: Buffer.from(chunks[next++]) } : { done: true, value: undefined }),
        cancel: async () => { state.cancelled = true; },
      }),
    },
  };
}

describe('the text-model request: what it accepts', () => {
  it('has a 60-second cap, a 2 MB cap and the two endpoints', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(60_000);
    expect(MAX_ANSWER_BYTES).toBe(2 * 1024 * 1024);
    expect(TEXT_MODEL_PATHS).toEqual({ '/models': 'GET', '/chat/completions': 'POST' });
  });

  it('takes a chat completion or a model list under an https base, or an http base on this computer', () => {
    expect(checkTextModelRequest(request())).toEqual({
      ok: true, id: 'text-model-1', url: 'https://api.example.com/v1/chat/completions', method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: '{"model":"m","messages":[]}',
    });
    for (const baseUrl of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:8080', 'https://openrouter.ai/api/v1/']) {
      const checked = checkTextModelRequest(request({ baseUrl, path: '/models', method: 'GET', body: undefined, headers: {} }));
      expect(checked.ok, baseUrl).toBe(true);
      expect(checked.url, baseUrl).toBe(`${baseUrl.replace(/\/$/, '')}/models`);
    }
  });

  it('refuses an address that is not https off this computer, holds a name and password, a query or a fragment', () => {
    for (const [baseUrl, problem] of [
      ['http://example.com/v1', 'not_https'],
      ['http://192.168.1.10:11434/v1', 'not_https'],
      ['http://localhost.example.com/v1', 'not_https'],
      ['file:///etc', 'not_https'],
      ['https://user:secret@example.com/v1', 'has_credentials'],
      ['https://example.com/v1?key=1', 'has_query'],
      ['https://example.com/v1#x', 'has_query'],
      ['not an address', 'not_a_url'],
    ]) {
      expect(textModelAddressProblem(baseUrl), baseUrl).toBe(problem);
      expect(checkTextModelRequest(request({ baseUrl })).ok, baseUrl).toBe(false);
    }
  });

  it('refuses any other endpoint, a method that is not its own, and a body where none belongs', () => {
    expect(checkTextModelRequest(request({ path: '/embeddings' })).ok).toBe(false);
    expect(checkTextModelRequest(request({ path: '/../admin' })).ok).toBe(false);
    expect(checkTextModelRequest(request({ method: 'GET' })).ok).toBe(false);
    expect(checkTextModelRequest(request({ path: '/models', method: 'POST' })).ok).toBe(false);
    expect(checkTextModelRequest(request({ path: '/models', method: 'GET' })).ok).toBe(false);
    expect(checkTextModelRequest(request({ body: undefined })).ok).toBe(false);
    expect(checkTextModelRequest(request({ body: 42 })).ok).toBe(false);
  });

  it('refuses a header it does not send, one that is not text, and one that would split the request', () => {
    expect(checkTextModelRequest(request({ headers: { Cookie: 'a=b' } })).ok).toBe(false);
    expect(checkTextModelRequest(request({ headers: { Host: 'elsewhere.example' } })).ok).toBe(false);
    expect(checkTextModelRequest(request({ headers: { Authorization: 42 } })).ok).toBe(false);
    expect(checkTextModelRequest(request({ headers: { Authorization: 'Bearer a\r\nX-Evil: 1' } })).ok).toBe(false);
    expect(checkTextModelRequest(request({ headers: 'Authorization: x' })).ok).toBe(false);
    expect(checkTextModelRequest(request({ headers: { Accept: 'application/json' } })).ok).toBe(true);
  });

  it('refuses a body over the cap, an id that is no name, and what is not a request at all', () => {
    expect(checkTextModelRequest(request({ body: 'x'.repeat(2 * 1024 * 1024 + 1) })).ok).toBe(false);
    expect(checkTextModelRequest(request({ id: { a: 1 } })).ok).toBe(false);
    expect(checkTextModelRequest(request({ id: 'x'.repeat(200) })).ok).toBe(false);
    expect(checkTextModelRequest(request({ id: undefined })).ok).toBe(true);
    for (const payload of [null, undefined, 'https://api.example.com', [], { baseUrl: 42, path: '/models', method: 'GET' }]) {
      expect(checkTextModelRequest(payload).ok).toBe(false);
    }
  });

  it('never repeats the key in a refusal', () => {
    const refused = checkTextModelRequest(request({ headers: { Authorization: `Bearer ${KEY}`, Cookie: KEY } }));
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).not.toContain(KEY);
  });
});

describe('the text-model request: sending it', () => {
  const checked = (over) => checkTextModelRequest(request(over));

  it('sends what it was given, follows no redirect, and answers the status and the body', async () => {
    const calls = [];
    const fetch = async (url, init) => { calls.push({ url, init }); return answer(200, ['{"choices":', '[]}']); };
    await expect(performTextModelRequest(checked(), { fetch })).resolves.toEqual({ status: 200, body: '{"choices":[]}' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions');
    expect(calls[0].init).toMatchObject({ method: 'POST', headers: { authorization: `Bearer ${KEY}` }, body: '{"model":"m","messages":[]}', redirect: 'manual' });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("answers a refusal's status and body as they came: the page reads them", async () => {
    const fetch = async () => answer(401, ['{"error":{"message":"Incorrect API key provided."}}']);
    await expect(performTextModelRequest(checked(), { fetch })).resolves.toEqual({ status: 401, body: '{"error":{"message":"Incorrect API key provided."}}' });
  });

  it('stops reading an answer past the cap, and says so', async () => {
    const big = answer(200, ['x'.repeat(600), 'x'.repeat(600)]);
    const result = await performTextModelRequest(checked(), { fetch: async () => big, maxBytes: 1000 });
    expect(result).toEqual({ error: 'too_large', message: 'The answer was larger than 1000 bytes.' });
    expect(big.state.cancelled).toBe(true);
    const declared = answer(200, ['x'], { 'content-length': '5000' });
    await expect(performTextModelRequest(checked(), { fetch: async () => declared, maxBytes: 1000 })).resolves.toMatchObject({ error: 'too_large' });
    expect(declared.state.cancelled).toBe(true);
  });

  it('gives up a request past its cap', async () => {
    const fetch = (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })), { once: true });
    });
    await expect(performTextModelRequest(checked(), { fetch, timeoutMs: 10 })).resolves.toEqual({ error: 'timeout', message: 'The service did not answer within 0.01 seconds.' });
  });

  it('says a service it could not reach by the system\'s code, never by the words around it', async () => {
    const fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`connect ECONNREFUSED ${KEY}`), { code: 'ECONNREFUSED' }) }); };
    const result = await performTextModelRequest(checked(), { fetch });
    expect(result).toEqual({ error: 'network', message: 'The service could not be reached (ECONNREFUSED).' });
    const bare = await performTextModelRequest(checked(), { fetch: async () => { throw new Error(`boom ${KEY}`); } });
    expect(bare).toEqual({ error: 'network', message: 'The service could not be reached.' });
  });

  it('refuses a redirect: the address it names is for the user to enter', async () => {
    const moved = answer(301, [], { location: 'http://elsewhere.example/v1/models' });
    const result = await performTextModelRequest(checked(), { fetch: async () => moved });
    expect(result).toMatchObject({ error: 'refused' });
    expect(moved.state.cancelled).toBe(true);
  });

  it('lets a request go when it is cancelled', async () => {
    const cancel = new AbortController();
    const fetch = (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    const sending = performTextModelRequest(checked(), { fetch, signal: cancel.signal });
    cancel.abort();
    await expect(sending).resolves.toEqual({ error: 'cancelled', message: 'The request was cancelled.' });
  });
});

describe('the text-model channels', () => {
  const MAIN = { id: 7 };
  const OTHER = { id: 8 };
  const register = (fetch) => {
    const handlers = new Map();
    setupTextModelHandlers({ ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) }, isTrustedSender: (sender) => sender === MAIN, fetch });
    return handlers;
  };

  it('registers the request and its cancel', () => {
    expect([...register(async () => answer(200)).keys()].sort()).toEqual(['text-model:cancel', 'text-model:request']);
  });

  it('answers the main page, and refuses any other sender without sending', async () => {
    let sent = 0;
    const handlers = register(async () => { sent += 1; return answer(200, ['{}']); });
    await expect(handlers.get('text-model:request')({ sender: MAIN }, request())).resolves.toEqual({ status: 200, body: '{}' });
    await expect(handlers.get('text-model:request')({ sender: OTHER }, request())).resolves.toMatchObject({ error: 'refused' });
    expect(sent).toBe(1);
  });

  it('refuses a request it does not accept without sending it', async () => {
    let sent = 0;
    const handlers = register(async () => { sent += 1; return answer(200); });
    const result = await handlers.get('text-model:request')({ sender: MAIN }, request({ baseUrl: 'http://example.com/v1' }));
    expect(result).toEqual({ error: 'refused', message: 'The address must start with https:// (http:// only for this computer).' });
    expect(sent).toBe(0);
  });

  it("cancels a request by its id, the sender's own only", async () => {
    const handlers = register((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const sending = handlers.get('text-model:request')({ sender: MAIN }, request({ id: 'text-model-9' }));
    await expect(handlers.get('text-model:cancel')({ sender: OTHER }, { id: 'text-model-9' })).resolves.toBe(false);
    await expect(handlers.get('text-model:cancel')({ sender: MAIN }, { id: 'text-model-8' })).resolves.toBe(false);
    await expect(handlers.get('text-model:cancel')({ sender: MAIN }, { id: 'text-model-9' })).resolves.toBe(true);
    await expect(sending).resolves.toMatchObject({ error: 'cancelled' });
    // Done: it is forgotten.
    await expect(handlers.get('text-model:cancel')({ sender: MAIN }, { id: 'text-model-9' })).resolves.toBe(false);
  });
});
