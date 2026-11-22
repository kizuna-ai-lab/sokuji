// The notes' chat contract (chat.ts): the body Kizuna AI's relay is sent, how an answer is read, which refusals are
// final, and the wait a rate limit is waited out with. The notes with the user's own key are textModelChat.test.ts:
// they send the same members through the shared text-model client (text models, part C).
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { answerOf, ChatError, chatBody, wait } from './chat';

const R = { system: 'S', user: { sentences: [{ sid: 1, speaker: 'Me', text: '你好' }] }, effort: 'none' as const, maxTokens: 32000 };

describe('the body the notes are asked with', () => {
  it('is one chat request for a JSON object: the prompt, the part as compact JSON, the budget, the reasoning', () => {
    expect(JSON.parse(chatBody('gpt-6-luna', R))).toEqual({
      model: 'gpt-6-luna',
      messages: [{ role: 'system', content: 'S' }, { role: 'user', content: '{"sentences":[{"sid":1,"speaker":"Me","text":"你好"}]}' }],
      response_format: { type: 'json_object' },
      max_completion_tokens: 32000,
      reasoning_effort: 'none',
    });
  });

  // Review: a model that does not take `reasoning_effort: 'none'` refuses every request with it (400, not retried).
  it('sends the reasoning effort only to the models known to take it', () => {
    for (const [model, sent] of [['gpt-6-luna', true], ['gpt-5.1', true], ['gpt-5.2-mini', true], ['o3', false], ['gpt-5', false], ['gpt-4.1', false], ['gpt-4o-mini', false]] as const) {
      expect('reasoning_effort' in JSON.parse(chatBody(model, R)), model).toBe(sent);
    }
  });

  // Measured on the service: these two refuse 'none' and take 'low' at the least.
  it("sends 'low' for 'none' to the listed models that refuse 'none', and 'low' and 'medium' as they are", () => {
    for (const [model, none] of [['gpt-6-astra', 'low'], ['gpt-6.1-sol', 'low'], ['gpt-6-luna', 'none'], ['gpt-6-sol', 'none'], ['gpt-6.1-terra', 'none']] as const) {
      for (const [effort, sent] of [['none', none], ['low', 'low'], ['medium', 'medium']] as const) {
        expect(JSON.parse(chatBody(model, { ...R, effort, maxTokens: 10 })).reasoning_effort, `${model} ${effort}`).toBe(sent);
      }
    }
  });
});

describe('an answer, read', () => {
  const answer = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  it("is the model's JSON object", async () => {
    await expect(answerOf(answer({ choices: [{ message: { content: '{"title":"T"}' } }] }))).resolves.toEqual({ title: 'T' });
  });

  it('refuses an answer that is not a JSON object, or none at all, with a reason of its own', async () => {
    await expect(answerOf(answer({ choices: [{ message: { content: 'not json' } }] }))).rejects.toMatchObject({ code: 'not-json' });
    await expect(answerOf(answer({ choices: [{ message: { content: '[1]' } }] }))).rejects.toMatchObject({ code: 'not-json' });
    await expect(answerOf(answer({ choices: [] }))).rejects.toMatchObject({ code: 'no-answer' });
  });
});

describe('a refusal', () => {
  it('says which statuses another try cannot fix', () => {
    for (const [status, retryable] of [[400, false], [401, false], [403, false], [404, false], [429, true], [500, true], [503, true]] as const) {
      expect(new ChatError('x', { status }).retryable, String(status)).toBe(retryable);
    }
    expect(new ChatError('x', { status: 429, retryable: false }).retryable).toBe(false);
    expect(new ChatError('x', { code: 'network' }).retryable).toBe(true);
  });
});

describe('the wait a rate limit is waited out with', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('ends after its time on the clock it is given', async () => {
    const clock = createVirtualClock(0);
    let done = false;
    const waiting = wait(15_000, new AbortController().signal, clock).then(() => { done = true; });
    clock.advance(14_999);
    await Promise.resolve();
    expect(done).toBe(false);
    clock.advance(1);
    await waiting;
    expect(done).toBe(true);
  });

  it('on the real clock by default', async () => {
    vi.useFakeTimers();
    const waiting = wait(1_000, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(waiting).resolves.toBeUndefined();
  });

  it('is cancelled with the request, before or while it waits', async () => {
    const clock = createVirtualClock(0);
    const before = new AbortController();
    before.abort();
    await expect(wait(1_000, before.signal, clock)).rejects.toMatchObject({ name: 'AbortError' });
    const during = new AbortController();
    const waiting = wait(1_000, during.signal, clock);
    during.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });
});
