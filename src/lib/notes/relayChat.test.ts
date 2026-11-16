// The notes through Kizuna AI: the request an own key would send, to our relay, with the sign-in instead of the key.
import { describe, it, expect, vi } from 'vitest';
import { ChatError, openAiChat, type ChatRequest } from './chat';
import { relayChat, RELAY_NOTES_MODEL } from './relayChat';

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const content = (obj: unknown) => ({ id: 'chatcmpl-9', choices: [{ message: { content: JSON.stringify(obj) } }] });
const request = (o: Partial<ChatRequest> = {}): ChatRequest => ({
  system: 'S', user: { output_language: 'ja', sentences: [{ sid: 1, text: 'こんにちは' }] }, effort: 'none', maxTokens: 2500,
  signal: new AbortController().signal, prompt: 'live-update', promptVersion: 2, ...o,
});
const port = (fetch: ReturnType<typeof vi.fn>, o: Partial<Parameters<typeof relayChat>[0]> = {}) => relayChat({
  baseUrl: 'https://kizuna.example/', token: async () => 'tok', sessionRef: 'run-0001', payer: 'personal', fetch: fetch as never, ...o,
});
const sent = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls[0] as unknown as [string, RequestInit];

describe('the notes through Kizuna AI', () => {
  it('sends the body an own key sends, without the prompt text (the relay puts in its own), with our address, the sign-in and our headers', async () => {
    const relay = vi.fn(async () => answer(200, content({ title: 'T' }), { 'X-Sokuji-Balance-After': '123' }));
    const own = vi.fn(async () => answer(200, content({ title: 'T' })));
    const onBalance = vi.fn();
    await expect(port(relay, { onBalance })(request())).resolves.toEqual({ title: 'T' });
    await openAiChat({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk', model: RELAY_NOTES_MODEL, fetch: own as never })(request());
    const [url, init] = sent(relay);
    expect(url).toBe('https://kizuna.example/api/openai/chat/completions');
    const ownBody = JSON.parse(sent(own)[1].body as string);
    ownBody.messages[0].content = '';
    expect(JSON.parse(init.body as string)).toEqual(ownBody);
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok', 'X-Sokuji-Session': 'run-0001', 'X-Sokuji-Payer': 'personal',
      'X-Sokuji-Prompt': 'live-update', 'X-Sokuji-Prompt-Version': '2',
    });
    expect(onBalance).toHaveBeenCalledWith(123);
  });

  it('tells each answer\'s usage with its request id, for what the live notes have used', async () => {
    const usage = { prompt_tokens: 9000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 8000 } };
    const relay = vi.fn(async () => answer(200, { ...content({ title: 'T' }), usage }));
    const answered: unknown[] = [];
    await port(relay)(request({ onAnswered: (info) => { answered.push(info); } }));
    expect(answered).toEqual([{ requestId: 'chatcmpl-9', usage }]);
  });

  it('reads each refusal by its code: final ones end the call, the rest can be tried again', async () => {
    const cases: Array<[number, string, { code?: string; retryable: boolean }]> = [
      [402, 'no_balance', { code: 'no-balance', retryable: false }],
      [429, 'daily_limit', { code: 'daily-limit', retryable: false }],
      [401, 'not_signed_in', { code: 'sign-in', retryable: false }],
      [403, 'wallet_frozen', { code: 'wallet-frozen', retryable: false }],
      [403, 'not_org_member', { code: 'not-member', retryable: false }],
      [413, 'request_too_large', { code: 'too-large', retryable: false }],
      [400, 'update_required', { code: 'update-required', retryable: false }],
      [400, 'model_not_allowed', { retryable: false }],
      [503, 'upstream_unavailable', { retryable: true }],
      [503, 'balance_unavailable', { retryable: true }],
    ];
    for (const [status, code, expected] of cases) {
      const fetch = vi.fn(async () => answer(status, { error: { message: 'm', type: 'sokuji_error', code } }));
      await expect(port(fetch)(request()), code).rejects.toMatchObject({ name: 'ChatError', status, ...expected });
    }
  });

  it('waits out a rate limit for the time the server names, then goes on', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn()
        .mockResolvedValueOnce(answer(429, { error: { code: 'rate_limited', message: 'm' } }, { 'Retry-After': '7' }))
        .mockResolvedValueOnce(answer(200, content({ title: 'T' })));
      const pending = port(fetch)(request());
      await vi.advanceTimersByTimeAsync(6_999);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ title: 'T' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a rate limit that outlasts its waits as one to try again later', async () => {
    vi.useFakeTimers();
    try {
      const limited = () => answer(429, { error: { code: 'rate_limited', message: 'm' } }, { 'Retry-After': '1' });
      const fetch = vi.fn(async () => limited());
      const pending = port(fetch)(request()).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(60_000);
      const error = await pending;
      expect(error).toBeInstanceOf(ChatError);
      expect((error as ChatError).retryable).toBe(true);
      expect(fetch.mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a backend without the route as unavailable, and no sign-in as a sign-in to do', async () => {
    const missing = vi.fn(async () => new Response('Not found', { status: 404 }));
    await expect(port(missing)(request())).rejects.toMatchObject({ code: 'unavailable', retryable: false });
    const fetch = vi.fn();
    await expect(port(fetch, { token: async () => null })(request())).rejects.toMatchObject({ code: 'sign-in', retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends no payer header when none is chosen', async () => {
    const fetch = vi.fn(async () => answer(200, content({})));
    await port(fetch, { payer: undefined, sessionRef: undefined })(request({ prompt: 'check-names' }));
    const headers = sent(fetch)[1].headers as Record<string, string>;
    expect(headers['X-Sokuji-Payer']).toBeUndefined();
    expect(headers['X-Sokuji-Session']).toBeUndefined();
    expect(headers['X-Sokuji-Prompt']).toBe('check-names');
  });
});
