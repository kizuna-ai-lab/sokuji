// The notes written by a text model with the user's own key (text models, part C): the chat port over the shared
// client, for OpenAI, Gemini and a compatible service, against a fake transport and a virtual clock. Nothing leaves
// the machine.
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { flush } from '../contract/testing/drive';
import { DEFAULT_NOTES_REASONING_CHOICE, type ReasoningChoice } from '../textModel/choice';
import { TextModelTransportError, type TextModelRequestInit, type TextModelService, type TextModelTransport } from '../textModel/client';
import { ChatError, type ChatRequest } from './chat';
import { createLiveNotes, LIVE_INTERVAL_MS, LIVE_TIMEOUT_MS } from './live/loop';
import type { LiveState } from './live/state';
import { textModelNotesChat } from './textModelChat';

/** Not a key of any service. */
const KEY = 'test-key-0000';

type Reply = { status: number; body: unknown } | Error | 'hang';

function service(...replies: Reply[]) {
  const sent: Array<{ url: string; init: TextModelRequestInit; body: Record<string, unknown> }> = [];
  const transport: TextModelTransport = (url, init) => new Promise((resolve, reject) => {
    sent.push({ url, init, body: JSON.parse(init.body ?? '{}') });
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    const next = replies.shift();
    if (next === undefined) { reject(new Error('asked once too often')); return; }
    if (next === 'hang') return;
    if (next instanceof Error) { reject(next); return; }
    resolve({ status: next.status, text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)) });
  });
  return { transport, sent };
}

const answer = (content: string, id?: string) => ({ status: 200, body: { ...(id ? { id } : {}), choices: [{ index: 0, message: { role: 'assistant', content } }] } });
const object = (value: unknown, id?: string) => answer(JSON.stringify(value), id);
const refuses = (status: number, message: string, more: Record<string, unknown> = {}) => ({ status, body: { error: { message, ...more } } });

const PART: Omit<ChatRequest, 'signal'> = { system: 'S', prompt: 'whole-meeting', promptVersion: 2, user: { sentences: [{ sid: 1, speaker: 'Me', text: '你好' }] }, effort: 'low', maxTokens: 32_000 };
const FINISH: Omit<ChatRequest, 'signal'> = { system: 'F', prompt: 'combine-parts', promptVersion: 2, user: {}, effort: 'medium', maxTokens: 12_000 };

function port(svc: TextModelService, s: ReturnType<typeof service>, o: { model?: string; reasoning?: ReasoningChoice; baseUrl?: string; apiKey?: string } = {}) {
  const clock = createVirtualClock(0);
  const chat = textModelNotesChat({
    service: svc, model: o.model ?? 'gpt-6-luna', reasoning: o.reasoning ?? DEFAULT_NOTES_REASONING_CHOICE, transport: s.transport, clock,
    ...('apiKey' in o ? (o.apiKey === undefined ? {} : { apiKey: o.apiKey }) : { apiKey: KEY }),
    ...(o.baseUrl ? { baseUrl: o.baseUrl } : {}),
  });
  return { chat, clock };
}
const ask = (chat: ReturnType<typeof port>['chat'], r: Omit<ChatRequest, 'signal'> = PART, signal = new AbortController().signal, onAnswered?: ChatRequest['onAnswered']) =>
  chat({ ...r, signal, ...(onAnswered ? { onAnswered } : {}) });

describe('the notes by OpenAI with the default reasoning: what the notes sent before', () => {
  it("one chat completion at OpenAI's endpoint, the key as a bearer token, a JSON object asked for and returned", async () => {
    const s = service(object({ title: 'T' }));
    await expect(ask(port('openai', s).chat)).resolves.toEqual({ title: 'T' });
    expect(s.sent[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(s.sent[0].init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` });
    expect(s.sent[0].body).toEqual({
      model: 'gpt-6-luna',
      messages: [{ role: 'system', content: 'S' }, { role: 'user', content: '{"sentences":[{"sid":1,"speaker":"Me","text":"你好"}]}' }],
      response_format: { type: 'json_object' },
      max_completion_tokens: 32_000,
      reasoning_effort: 'low',
    });
  });

  // Review (the notes before): a model that does not take `reasoning_effort` would refuse every request with it.
  it("each call's own level only to the models known to take one; the budget each call's own", async () => {
    for (const [model, sent] of [['gpt-6-luna', 'medium'], ['gpt-5.1', 'medium'], ['o3', undefined], ['gpt-5', undefined], ['gpt-4.1', undefined]] as const) {
      const s = service(object({ ok: 1 }));
      await ask(port('openai', s, { model }).chat, FINISH);
      expect(s.sent[0].body.reasoning_effort, model).toBe(sent);
      expect(s.sent[0].body.max_completion_tokens, model).toBe(12_000);
    }
  });

  it("passes on the completion's id as the request's", async () => {
    const seen: unknown[] = [];
    await ask(port('openai', service(object({ ok: 1 }, 'chatcmpl-7'))).chat, PART, undefined, (info) => seen.push(info));
    expect(seen).toEqual([{ requestId: 'chatcmpl-7' }]);
  });
});

describe('the notes by Gemini and by a compatible service', () => {
  it("Gemini: its OpenAI-compatible endpoint, max_tokens, each call's own level", async () => {
    const s = service(object({ title: 'T' }));
    await expect(ask(port('gemini', s, { model: 'gemini-3.8-flash' }).chat, FINISH)).resolves.toEqual({ title: 'T' });
    expect(s.sent[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(s.sent[0].body).toMatchObject({ model: 'gemini-3.8-flash', max_tokens: 12_000, reasoning_effort: 'medium', response_format: { type: 'json_object' } });
    expect(s.sent[0].body).not.toHaveProperty('max_completion_tokens');
  });

  it("Gemini refusing a default level: asked with 'low', then with none, and what each was lowered to kept for the run", async () => {
    const named = (v: string) => refuses(400, `Unsupported value: 'reasoning_effort' does not support '${v}'.`);
    const s = service(named('medium'), named('low'), object({ ok: 1 }), object({ ok: 2 }));
    const { chat } = port('gemini', s, { model: 'gemma-3-27b-it' });
    await expect(ask(chat, FINISH)).resolves.toEqual({ ok: 1 });
    await expect(ask(chat, PART)).resolves.toEqual({ ok: 2 });
    expect(s.sent.map((r) => r.body.reasoning_effort)).toEqual(['medium', 'low', undefined, undefined]);
  });

  // Review: a level lowered was refused again on every call; live notes call every 20 s.
  it("a model that refuses the default's medium costs one refusal a run: later calls ask 'low' at once", async () => {
    const s = service(refuses(400, "Unsupported value: 'reasoning_effort' does not support 'medium'."), object({ ok: 1 }), object({ ok: 2 }), object({ ok: 3 }));
    const { chat } = port('gemini', s, { model: 'gemini-3.8-flash' });
    await expect(ask(chat, FINISH)).resolves.toEqual({ ok: 1 });
    await expect(ask(chat, FINISH)).resolves.toEqual({ ok: 2 });
    await expect(ask(chat, PART)).resolves.toEqual({ ok: 3 });
    expect(s.sent.map((r) => r.body.reasoning_effort)).toEqual(['medium', 'low', 'low', 'low']);
  });

  it('a service that refuses response_format is asked once without it, and its JSON is read from the text', async () => {
    const s = service(refuses(400, 'response_format is not supported'), answer('Here it is:\n```json\n{"title":"T"}\n```'), answer('{"title":"U"}'));
    const { chat } = port('gemini', s, { model: 'gemma-3-27b-it' });
    await expect(ask(chat)).resolves.toEqual({ title: 'T' });
    await expect(ask(chat)).resolves.toEqual({ title: 'U' });
    expect(s.sent.map((r) => 'response_format' in r.body)).toEqual([true, false, false]);
  });

  it('a compatible service: at its address, sent no reasoning, with room for the reasoning its model does by itself', async () => {
    const s = service(answer('<think>Let me see.</think>{"title":"T"}'));
    await expect(ask(port('compatible', s, { model: 'qwen3:8b', baseUrl: 'http://localhost:11434/v1', apiKey: undefined }).chat)).resolves.toEqual({ title: 'T' });
    expect(s.sent[0].url).toBe('http://localhost:11434/v1/chat/completions');
    expect(s.sent[0].init.headers).not.toHaveProperty('Authorization');
    expect(s.sent[0].body).not.toHaveProperty('reasoning_effort');
    expect(s.sent[0].body.max_tokens).toBe(32_000 + 2_048);
  });
});

describe('the notes with a reasoning the user chose', () => {
  it('is sent exactly to every call, with the room its level needs', async () => {
    const s = service(object({ ok: 1 }), object({ ok: 1 }));
    const { chat } = port('openai', s, { model: 'gpt-5-mini', reasoning: { level: 'high', typed: '' } });
    await ask(chat, PART);
    await ask(chat, FINISH);
    expect(s.sent.map((r) => [r.body.reasoning_effort, r.body.max_completion_tokens])).toEqual([['high', 32_000 + 6_144], ['high', 12_000 + 4_096]]);
  });

  it("a refusal of it is final, in the service's words: never asked with another value", async () => {
    const words = "Unsupported value: 'reasoning_effort' does not support 'xhigh' with this model.";
    const s = service(refuses(400, words));
    await expect(ask(port('openai', s, { reasoning: { level: 'low', typed: 'xhigh' } }).chat)).rejects.toMatchObject({ name: 'ChatError', status: 400, serviceMessage: words, retryable: false });
    expect(s.sent).toHaveLength(1);
  });
});

describe("the notes' refusals and waits", () => {
  it("keeps the service's own words, and says which refusals another try cannot fix", async () => {
    for (const [status, retryable] of [[400, false], [401, false], [403, false], [404, false], [500, true], [503, true]] as const) {
      const s = service(refuses(status, 'x'));
      await expect(ask(port('openai', s).chat), String(status)).rejects.toMatchObject({ name: 'ChatError', status, serviceMessage: 'x', retryable });
    }
  });

  it("a refusal with no words of the service's is said by its status", async () => {
    const s = service({ status: 503, body: '<html>busy</html>' });
    const error = await ask(port('openai', s).chat).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChatError);
    expect(error).toMatchObject({ status: 503, serviceMessage: undefined });
  });

  it("Gemini's refusal of a key, a 400, is final", async () => {
    const s = service(refuses(400, 'API key not valid. Please pass a valid API key.'));
    await expect(ask(port('gemini', s, { model: 'gemini-3.8-flash' }).chat)).rejects.toMatchObject({ status: 400, retryable: false, serviceMessage: 'API key not valid. Please pass a valid API key.' });
  });

  it('fails at once when the account is out of credit, without waiting it out', async () => {
    const s = service(refuses(429, 'You exceeded your current quota.', { type: 'insufficient_quota', code: 'insufficient_quota' }));
    await expect(ask(port('openai', s).chat)).rejects.toMatchObject({ status: 429, serviceMessage: 'You exceeded your current quota.', retryable: false });
    expect(s.sent).toHaveLength(1);
  });

  it('waits out a rate limit on the clock, fifteen seconds longer each time', async () => {
    const s = service(refuses(429, 'Rate limit'), refuses(429, 'Rate limit'), object({ ok: true }));
    const { chat, clock } = port('openai', s);
    const pending = ask(chat);
    await flush();
    clock.advance(14_999);
    await flush();
    expect(s.sent).toHaveLength(1);
    clock.advance(1);
    await flush();
    expect(s.sent).toHaveLength(2);
    clock.advance(29_999);
    await flush();
    expect(s.sent).toHaveLength(2);
    clock.advance(1);
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('gives up after four rate limits, in the service\'s words, for another try to judge', async () => {
    const s = service(...Array.from({ length: 5 }, () => refuses(429, 'Rate limit')));
    const { chat, clock } = port('openai', s);
    const result = expect(ask(chat)).rejects.toMatchObject({ name: 'ChatError', status: 429, serviceMessage: 'Rate limit', retryable: true });
    for (const wait of [15_000, 30_000, 45_000, 60_000]) {
      await flush();
      clock.advance(wait);
    }
    await result;
    expect(s.sent).toHaveLength(5);
  });

  it('stops waiting out a rate limit when it is cancelled', async () => {
    const controller = new AbortController();
    const s = service(refuses(429, 'Rate limit'));
    const { chat, clock } = port('openai', s);
    const result = expect(ask(chat, PART, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    clock.advance(1_000);
    controller.abort();
    await result;
    expect(s.sent).toHaveLength(1);
  });

  it('stops when it is cancelled mid-request', async () => {
    const controller = new AbortController();
    const pending = ask(port('openai', service('hang')).chat, PART, controller.signal);
    await flush();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it("the service not reached is the notes' own network reason; one that took too long, its own", async () => {
    await expect(ask(port('openai', service(new TypeError('Failed to fetch'))).chat)).rejects.toMatchObject({ code: 'network', retryable: true });
    // A compatible service's main process gives a request a minute.
    const timedOut: TextModelTransport = async () => { throw new TextModelTransportError('timeout', 'The service did not answer in 60 s.'); };
    await expect(ask(textModelNotesChat({ service: 'compatible', baseUrl: 'http://localhost:1234/v1', model: 'm', reasoning: DEFAULT_NOTES_REASONING_CHOICE, transport: timedOut })))
      .rejects.toMatchObject({ code: 'timeout', retryable: true });
  });

  it('an answer that is no JSON object, or none at all, is said by its own reason', async () => {
    await expect(ask(port('openai', service(answer('not json'))).chat)).rejects.toMatchObject({ code: 'not-json' });
    await expect(ask(port('openai', service(answer('[1, 2]'))).chat)).rejects.toMatchObject({ code: 'not-json' });
    await expect(ask(port('openai', service(answer('  '))).chat)).rejects.toMatchObject({ code: 'no-answer' });
    await expect(ask(port('openai', service({ status: 200, body: 'garbled' })).chat)).rejects.toMatchObject({ code: 'no-answer' });
  });
});

// The live notes on a text model with the user's own key: the same port, the loop's own 20 s for each update.
describe('the live notes on a text model', () => {
  const sentence = (n: number) => ({ n, side: 'other' as const, sideCertain: true, track: 'other' as const, speaker: '1', startMs: n * 5_000, endMs: n * 5_000 + 4_000, text: `sentence ${n}`, timeKind: 'given' as const, fromOpen: false });

  it("each update is asked with the live call's own level and budget, and its answer shown", async () => {
    const s = service(object({ title: 'T', new_topic: { title: 'A', summary: 'a', points: [{ text: 'p', sid: 1, kinds: [] }] } }));
    const clock = createVirtualClock(0);
    const states: LiveState[] = [];
    const live = createLiveNotes({
      chat: textModelNotesChat({ service: 'gemini', apiKey: KEY, model: 'gemini-3.8-flash', reasoning: DEFAULT_NOTES_REASONING_CHOICE, transport: s.transport, clock }),
      clock, language: { code: 'en', name: 'English' }, speakerLabel: () => 'Other side', onState: (st) => states.push(st), onHint: () => {},
    });
    live.sentences([sentence(1)]);
    clock.advance(LIVE_INTERVAL_MS);
    await flush();
    expect(s.sent[0].body).toMatchObject({ model: 'gemini-3.8-flash', reasoning_effort: 'low', max_tokens: 2_500 });
    expect(states[states.length - 1]?.topics[0].points.map((point) => point.n)).toEqual([1]);
    live.dispose();
  });

  it('an update the service does not answer is given up at 20 s, its request let go', async () => {
    const s = service('hang');
    const clock = createVirtualClock(0);
    const lines: Array<Record<string, unknown>> = [];
    const live = createLiveNotes({
      chat: textModelNotesChat({ service: 'openai', apiKey: KEY, model: 'gpt-6-luna', reasoning: DEFAULT_NOTES_REASONING_CHOICE, transport: s.transport, clock }),
      clock, language: { code: 'en', name: 'English' }, speakerLabel: () => 'Other side', onState: () => {}, onHint: () => {}, log: (l) => lines.push(l),
    });
    live.sentences([sentence(1)]);
    clock.advance(LIVE_INTERVAL_MS);
    await flush();
    expect(s.sent[0].init.signal.aborted).toBe(false);
    clock.advance(LIVE_TIMEOUT_MS);
    await flush();
    expect(s.sent[0].init.signal.aborted).toBe(true);
    expect(lines[0]).toMatchObject({ givenUp: true, accepted: false, latencyMs: LIVE_TIMEOUT_MS });
    live.dispose();
  });
});
