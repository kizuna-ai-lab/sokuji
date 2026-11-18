// The notes model, called with the user's own key on an OpenAI-compatible chat interface.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ChatError, NOTES_MODELS, openAiChat } from './chat';

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const content = (obj: unknown) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });
const base = { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-6-luna' };
const ask = (chat: ReturnType<typeof openAiChat>, signal = new AbortController().signal) =>
  chat({ system: 'S', prompt: 'whole-meeting', promptVersion: 2, user: { sentences: [{ sid: 1, speaker: 'Me', text: '你好' }] }, effort: 'none', maxTokens: 32000, signal });

describe('the notes chat', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('sends one chat request for a JSON object and returns the object', async () => {
    const fetch = vi.fn(async () => answer(200, content({ title: 'T' })));
    await expect(ask(openAiChat({ ...base, fetch }))).resolves.toEqual({ title: 'T' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'gpt-6-luna',
      messages: [{ role: 'system', content: 'S' }, { role: 'user', content: '{"sentences":[{"sid":1,"speaker":"Me","text":"你好"}]}' }],
      response_format: { type: 'json_object' },
      max_completion_tokens: 32000,
      reasoning_effort: 'none',
    });
  });

  // Review: a model that does not take `reasoning_effort: 'none'` refuses every request with it (400, not retried).
  it('sends the reasoning effort only to the models known to take it, so any model the user names still answers', async () => {
    for (const [model, sent] of [['gpt-6-luna', true], ['gpt-5.1', true], ['gpt-5.2-mini', true], ['o3', false], ['gpt-5', false], ['gpt-4.1', false], ['gpt-4o-mini', false]] as const) {
      const fetch = vi.fn(async () => answer(200, content({ title: 'T' })));
      await ask(openAiChat({ ...base, model, fetch }));
      const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
      expect('reasoning_effort' in body, model).toBe(sent);
    }
  });

  // Measured on the service: these two refuse 'none' and take 'low' at the least.
  it("sends 'low' for 'none' to the listed models that refuse 'none', and 'low' and 'medium' as they are", async () => {
    for (const [model, none] of [['gpt-6-astra', 'low'], ['gpt-6.1-sol', 'low'], ['gpt-6-luna', 'none'], ['gpt-6-sol', 'none'], ['gpt-6.1-terra', 'none']] as const) {
      for (const [effort, sent] of [['none', none], ['low', 'low'], ['medium', 'medium']] as const) {
        const fetch = vi.fn(async () => answer(200, content({ title: 'T' })));
        await openAiChat({ ...base, model, fetch })({ system: 'S', prompt: 'whole-meeting', promptVersion: 2, user: {}, effort, maxTokens: 10, signal: new AbortController().signal });
        const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
        expect(body.reasoning_effort, `${model} ${effort}`).toBe(sent);
      }
    }
  });

  it('offers the newest series, Luna first', () => {
    expect(NOTES_MODELS).toEqual(['gpt-6-luna', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6.1-terra']);
  });

  it('keeps the service\'s own message when it refuses', async () => {
    const fetch = vi.fn(async () => answer(401, { error: { message: 'Incorrect API key provided.' } }));
    await expect(ask(openAiChat({ ...base, fetch }))).rejects.toMatchObject({ name: 'ChatError', status: 401, serviceMessage: 'Incorrect API key provided.' });
  });

  it('refuses an answer that is not a JSON object', async () => {
    const fetch = vi.fn(async () => answer(200, { choices: [{ message: { content: 'not json' } }] }));
    await expect(ask(openAiChat({ ...base, fetch }))).rejects.toBeInstanceOf(ChatError);
  });

  it('waits out a rate limit, fifteen seconds longer each time', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(answer(429, { error: { message: 'Rate limit' } }))
      .mockResolvedValueOnce(answer(429, { error: { message: 'Rate limit' } }))
      .mockResolvedValueOnce(answer(200, content({ ok: true })));
    const pending = ask(openAiChat({ ...base, fetch }));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('gives up after four rate limits', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => answer(429, { error: { message: 'Rate limit' } }));
    const result = expect(ask(openAiChat({ ...base, fetch }))).rejects.toMatchObject({ name: 'ChatError', status: 429, serviceMessage: 'Rate limit' });
    await vi.advanceTimersByTimeAsync(15_000 + 30_000 + 45_000 + 60_000);
    await result;
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('stops waiting out a rate limit when it is cancelled', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetch = vi.fn(async () => answer(429, { error: { message: 'Rate limit' } }));
    const result = expect(ask(openAiChat({ ...base, fetch }), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stops when it is cancelled', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (_u: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = ask(openAiChat({ ...base, fetch: fetch as unknown as typeof globalThis.fetch }), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('fails at once when the account is out of credit, without waiting it out', async () => {
    const fetch = vi.fn(async () => answer(429, { error: { message: 'You exceeded your current quota.', type: 'insufficient_quota', code: 'insufficient_quota' } }));
    await expect(ask(openAiChat({ ...base, fetch }))).rejects.toMatchObject({ status: 429, serviceMessage: 'You exceeded your current quota.', retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('says which refusals another try cannot fix', async () => {
    for (const [status, retryable] of [[400, false], [401, false], [403, false], [404, false], [500, true], [503, true]] as const) {
      const fetch = vi.fn(async () => answer(status, { error: { message: 'x' } }));
      await expect(ask(openAiChat({ ...base, fetch }))).rejects.toMatchObject({ status, retryable });
    }
  });

  it("passes on the service's request id", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(content({ ok: 1 })), { status: 200, headers: { 'x-request-id': 'req_123' } }));
    const seen: unknown[] = [];
    await openAiChat({ ...base, fetch })({ system: 'S', prompt: 'whole-meeting', promptVersion: 2, user: {}, effort: 'none', maxTokens: 1, signal: new AbortController().signal, onAnswered: (info) => seen.push(info) });
    expect(seen).toEqual([{ requestId: 'req_123' }]);
  });
});
