// The notes model, called with the user's own key on an OpenAI-compatible chat interface.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ChatError, openAiChat } from './chat';

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const content = (obj: unknown) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });
const base = { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-6-luna' };
const ask = (chat: ReturnType<typeof openAiChat>, signal = new AbortController().signal) =>
  chat({ system: 'S', user: { sentences: [{ sid: 1, speaker: 'Me', text: '你好' }] }, effort: 'none', maxTokens: 32000, signal });

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
});
