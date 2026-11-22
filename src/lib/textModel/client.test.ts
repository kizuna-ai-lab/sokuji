import { describe, it, expect } from 'vitest';
import {
  chatCompletion,
  GEMINI_TEXT_BASE_URL,
  jsonObjectOf,
  listModels,
  OPENAI_TEXT_BASE_URL,
  probeModel,
  PROBE_TOKENS,
  textModelTimeout,
  TextModelTransportError,
  type ChatCompletionOptions,
  type TextModelRequestInit,
  type TextModelTransport,
} from './client';

/** Not a key of any service: the client is never handed a real one in a test. */
const KEY = 'test-key-0000';

type Answer = { status: number; body: unknown } | Error;

/** A service that answers each request with the next of `answers`, and records what it was sent. */
function service(...answers: Answer[]) {
  const sent: Array<{ url: string; init: TextModelRequestInit; body: Record<string, unknown> | undefined }> = [];
  const transport: TextModelTransport = async (url, init) => {
    sent.push({ url, init, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const next = answers.shift();
    if (next === undefined) throw new Error('asked once too often');
    if (next instanceof Error) throw next;
    return { status: next.status, text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)) };
  };
  return { transport, sent };
}

const serviceOf = (...answers: Answer[]) => service(...answers);
const reply = (content: unknown) => ({ status: 200, body: { choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] } });
const refusal = (status: number, error: unknown) => ({ status, body: { error } });
const MESSAGES = [{ role: 'system' as const, content: 'Translate into Japanese.' }, { role: 'user' as const, content: 'Hello.' }];

const ask = (transport: TextModelTransport, over: Partial<ChatCompletionOptions> = {}) => chatCompletion({
  service: 'openai',
  apiKey: KEY,
  model: 'gpt-5-mini',
  messages: MESSAGES,
  maxTokens: 400,
  signal: new AbortController().signal,
  transport,
  ...over,
});

describe('a chat completion: what each service is sent', () => {
  it("OpenAI: its own endpoint, the key as a bearer token, max_completion_tokens, and the lowest reasoning for a reasoning model", async () => {
    const s = service(reply('こんにちは。'));
    await expect(ask(s.transport)).resolves.toEqual({ ok: true, text: 'こんにちは。' });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(OPENAI_TEXT_BASE_URL).toBe('https://api.openai.com/v1');
    expect(s.sent[0].init.method).toBe('POST');
    expect(s.sent[0].init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` });
    expect(s.sent[0].body).toEqual({ model: 'gpt-5-mini', messages: MESSAGES, max_completion_tokens: 400, reasoning_effort: 'minimal' });
  });

  it("OpenAI: no reasoning_effort to a model that does not reason, nor when the service's default is asked for", async () => {
    const plain = service(reply('a'));
    await ask(plain.transport, { model: 'gpt-4.1-mini' });
    expect(plain.sent[0].body).toEqual({ model: 'gpt-4.1-mini', messages: MESSAGES, max_completion_tokens: 400 });
    const asDefault = service(reply('a'));
    await ask(asDefault.transport, { model: 'gpt-5.4', reasoning: 'default' });
    expect(asDefault.sent[0].body).not.toHaveProperty('reasoning_effort');
    const lowest = service(reply('a'));
    await ask(lowest.transport, { model: 'gpt-5.4' });
    expect(lowest.sent[0].body).toMatchObject({ reasoning_effort: 'none' });
  });

  it("Gemini: its OpenAI-compatible endpoint with the key as a bearer token, max_tokens, reasoning 'none'", async () => {
    const s = service(reply('やあ。'));
    await expect(ask(s.transport, { service: 'gemini', model: 'gemini-3.1-flash-lite' })).resolves.toEqual({ ok: true, text: 'やあ。' });
    expect(GEMINI_TEXT_BASE_URL).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(s.sent[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(s.sent[0].init.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
    expect(s.sent[0].body).toEqual({ model: 'gemini-3.1-flash-lite', messages: MESSAGES, max_tokens: 400, reasoning_effort: 'none' });
  });

  it("a compatible service: the user's address as read, no key when none is given, max_tokens", async () => {
    const s = service(reply('hi'));
    await ask(s.transport, { service: 'compatible', baseUrl: 'http://localhost:11434/v1/', apiKey: undefined, model: 'qwen3:8b' });
    expect(s.sent[0].url).toBe('http://localhost:11434/v1/chat/completions');
    expect(s.sent[0].init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(s.sent[0].body).toEqual({ model: 'qwen3:8b', messages: MESSAGES, max_tokens: 400 });
  });

  it('OpenAI and Gemini go to their own endpoints whatever address is given: a key is never sent elsewhere', async () => {
    const s = service(reply('a'), reply('b'));
    await ask(s.transport, { baseUrl: 'https://elsewhere.example/v1' });
    await ask(s.transport, { service: 'gemini', model: 'gemini-3.8-flash', baseUrl: 'https://elsewhere.example/v1' });
    expect(s.sent.map((r) => r.url)).toEqual([`${OPENAI_TEXT_BASE_URL}/chat/completions`, `${GEMINI_TEXT_BASE_URL}/chat/completions`]);
  });

  it('asks for a JSON object, and states the temperature, when told to', async () => {
    const s = service(reply('{"a":1}'));
    await ask(s.transport, { json: true, temperature: 0.2 });
    expect(s.sent[0].body).toMatchObject({ response_format: { type: 'json_object' }, temperature: 0.2 });
  });

  it('says the signal it was given to the transport', async () => {
    const s = service(reply('a'));
    const controller = new AbortController();
    await ask(s.transport, { signal: controller.signal });
    expect(s.sent[0].init.signal).toBe(controller.signal);
  });
});

describe('a chat completion: a member the service refuses is left out and asked again', () => {
  it('a compatible service or Gemini that refuses response_format is asked once more without it', async () => {
    for (const where of [{ service: 'compatible' as const, baseUrl: 'https://api.example.com/v1' }, { service: 'gemini' as const }]) {
      const s = service(refusal(400, { message: "Unknown parameter: 'response_format'." }), reply('{"a":1}'));
      await expect(ask(s.transport, { ...where, model: 'm', json: true })).resolves.toEqual({ ok: true, text: '{"a":1}' });
      expect(s.sent.map((r) => 'response_format' in r.body!)).toEqual([true, false]);
    }
  });

  it('asks without it once only, and OpenAI, which takes it, not at all', async () => {
    const twice = service(refusal(400, { message: 'response_format is not supported' }), refusal(400, { message: 'response_format is not supported' }));
    const result = await ask(twice.transport, { service: 'compatible', baseUrl: 'https://api.example.com/v1', model: 'm', json: true, reasoning: 'default' });
    expect(result).toMatchObject({ ok: false, failure: { code: 'refused', status: 400 } });
    expect(twice.sent).toHaveLength(2);
    const openai = service(refusal(400, { message: "Invalid parameter: 'response_format' of type 'json_object' is not supported with this model." }));
    expect(await ask(openai.transport, { json: true })).toMatchObject({ ok: false, failure: { code: 'refused' } });
    expect(openai.sent).toHaveLength(1);
  });

  it("a refused reasoning_effort is asked again with 'low', then without it", async () => {
    const named = refusal(400, { message: "Unsupported value: 'reasoning_effort' does not support 'none' with this model.", param: 'reasoning_effort' });
    const s = service(named, named, reply('ok'));
    await expect(ask(s.transport, { model: 'gpt-5.4' })).resolves.toEqual({ ok: true, text: 'ok' });
    expect(s.sent.map((r) => r.body!.reasoning_effort)).toEqual(['none', 'low', undefined]);
  });

  it('a compatible service is sent no reasoning_effort: its model is unknown, and the member may fail every request', async () => {
    const s = service(reply('ok'));
    await ask(s.transport, { service: 'compatible', baseUrl: 'https://api.example.com/v1', model: 'm' });
    expect(s.sent[0].body).not.toHaveProperty('reasoning_effort');
  });

  it('a third refusal is the answer: no request is sent a fourth time', async () => {
    const named = refusal(400, { message: 'Unrecognized request argument supplied: reasoning_effort' });
    const s = service(named, named, named);
    expect(await ask(s.transport, { service: 'gemini', model: 'm' })).toMatchObject({ ok: false, failure: { code: 'refused', status: 400 } });
    expect(s.sent).toHaveLength(3);
  });

  it('both refusals in turn: the reasoning first, then the JSON', async () => {
    const s = service(
      refusal(400, { message: 'reasoning_effort: extra inputs are not permitted' }),
      refusal(400, { message: 'reasoning_effort: extra inputs are not permitted' }),
      refusal(400, { message: 'response_format: extra inputs are not permitted' }),
      reply('{}'),
    );
    await expect(ask(s.transport, { service: 'gemini', model: 'm', json: true })).resolves.toEqual({ ok: true, text: '{}' });
    expect(s.sent.map((r) => [r.body!.reasoning_effort, 'response_format' in r.body!])).toEqual([['none', true], ['low', true], [undefined, true], [undefined, false]]);
  });

  it('what was learned is kept in the memo it is handed, and the next call starts from it', async () => {
    const memo = {};
    const first = service(
      refusal(400, { message: 'reasoning_effort is not supported' }),
      refusal(400, { message: 'reasoning_effort is not supported' }),
      refusal(400, { message: 'response_format is not supported' }),
      reply('{}'),
    );
    const where = { service: 'gemini' as const, model: 'm', json: true, memo };
    await ask(first.transport, where);
    expect(memo).toEqual({ reasoningEffort: null, responseFormat: false });
    const next = service(reply('{}'));
    await ask(next.transport, where);
    expect(next.sent).toHaveLength(1);
    expect(next.sent[0].body).not.toHaveProperty('reasoning_effort');
    expect(next.sent[0].body).not.toHaveProperty('response_format');
  });
});

describe("a chat completion: the reasoning the user chose", () => {
  it('is sent exactly, to every service, the compatible one included', async () => {
    for (const [service, extra] of [['openai', {}], ['gemini', {}], ['compatible', { baseUrl: 'https://api.example.com/v1' }]] as const) {
      const sent = serviceOf(reply('ok'));
      await ask(sent.transport, { service, model: 'm', reasoning: { exact: 'medium' }, ...extra });
      expect(sent.sent[0].body!.reasoning_effort, service).toBe('medium');
    }
    // A value no list holds goes as it is typed.
    const typed = serviceOf(reply('ok'));
    await ask(typed.transport, { model: 'gpt-5.4', reasoning: { exact: 'xhigh' } });
    expect(typed.sent[0].body!.reasoning_effort).toBe('xhigh');
  });

  it('a refusal of it is the answer, in the service\'s words: it is never asked again with another value, nor without one', async () => {
    const named = refusal(400, { message: "Unsupported value: 'reasoning_effort' does not support 'minimal' with this model.", param: 'reasoning_effort' });
    const s = serviceOf(named, reply('never asked'));
    expect(await ask(s.transport, { model: 'gpt-5.4', reasoning: { exact: 'minimal' } })).toEqual({
      ok: false, failure: { code: 'refused', status: 400, message: "Unsupported value: 'reasoning_effort' does not support 'minimal' with this model." },
    });
    expect(s.sent).toHaveLength(1);
  });

  it('neither reads nor writes the memo of the lowest', async () => {
    const memo = { reasoningEffort: 'low' };
    const s = serviceOf(reply('ok'));
    await ask(s.transport, { model: 'gpt-5.4', reasoning: { exact: 'none' }, memo });
    expect(s.sent[0].body!.reasoning_effort).toBe('none');
    expect(memo).toEqual({ reasoningEffort: 'low' });
  });
});

// Text models, part C: a stage's default that is not the lowest (the notes' Medium) is sent, and lowered where the
// model refuses it, as the lowest is; what is kept for the session is only that the model takes none.
describe("a chat completion: a stage's default reasoning", () => {
  const named = (value: string) => refusal(400, { message: `Unsupported value: 'reasoning_effort' does not support '${value}' with this model.`, param: 'reasoning_effort' });

  it('is sent as it is', async () => {
    const s = serviceOf(reply('ok'));
    await ask(s.transport, { model: 'gpt-6-luna', reasoning: { preferred: 'medium' } });
    expect(s.sent[0].body!.reasoning_effort).toBe('medium');
  });

  it("refused, is asked again with 'low', then without one, and the answer that came is the answer", async () => {
    const s = serviceOf(named('medium'), named('low'), reply('ok'));
    await expect(ask(s.transport, { model: 'gpt-4.1-mini', reasoning: { preferred: 'medium' } })).resolves.toEqual({ ok: true, text: 'ok' });
    expect(s.sent.map((r) => r.body!.reasoning_effort)).toEqual(['medium', 'low', undefined]);
  });

  // Review: a level lowered was asked again and refused again on every call (live notes call every 20 s).
  it("keeps for the session what a default was lowered to: the next call asks that at once", async () => {
    const memo = {};
    const s = serviceOf(named('medium'), reply('ok'), reply('ok'), reply('ok'));
    await ask(s.transport, { model: 'gemini-3.8-flash', service: 'gemini', reasoning: { preferred: 'medium' }, memo });
    expect(memo).toEqual({ preferredEffort: { medium: 'low' } });
    await ask(s.transport, { model: 'gemini-3.8-flash', service: 'gemini', reasoning: { preferred: 'medium' }, memo });
    // Another default of the session is its own: 'low' was never refused.
    await ask(s.transport, { model: 'gemini-3.8-flash', service: 'gemini', reasoning: { preferred: 'low' }, memo });
    expect(s.sent.map((r) => r.body!.reasoning_effort)).toEqual(['medium', 'low', 'low', 'low']);
  });

  it('keeps that the model takes none: a default lowered to none, or one higher whose lowering meets it, sends none', async () => {
    const memo = {};
    const s = serviceOf(named('low'), reply('ok'), named('medium'), reply('ok'), reply('ok'));
    await ask(s.transport, { model: 'gemma-3-27b-it', service: 'gemini', reasoning: { preferred: 'low' }, memo });
    expect(memo).toEqual({ preferredEffort: { low: null } });
    // Medium refused, lowered: 'low' is known to be refused, so straight to none.
    await ask(s.transport, { model: 'gemma-3-27b-it', service: 'gemini', reasoning: { preferred: 'medium' }, memo });
    expect(memo).toEqual({ preferredEffort: { low: null, medium: null } });
    await ask(s.transport, { model: 'gemma-3-27b-it', service: 'gemini', reasoning: { preferred: 'medium' }, memo });
    expect(s.sent.map((r) => r.body!.reasoning_effort)).toEqual(['low', undefined, 'medium', undefined, undefined]);
  });

  it('learns nothing from a value the model took: another default of the session is sent as it is', async () => {
    const memo = {};
    const s = serviceOf(reply('ok'), reply('ok'));
    await ask(s.transport, { model: 'gpt-6-luna', reasoning: { preferred: 'low' }, memo });
    await ask(s.transport, { model: 'gpt-6-luna', reasoning: { preferred: 'medium' }, memo });
    expect(memo).toEqual({});
    expect(s.sent.map((r) => r.body!.reasoning_effort)).toEqual(['low', 'medium']);
  });

  it("is kept apart from the lowest's memo, both ways", async () => {
    // The lowest found to be none (a model sent nothing, a compatible service): a default is still asked as it is.
    const fromLowest = { reasoningEffort: null };
    const a = serviceOf(reply('ok'));
    await ask(a.transport, { model: 'gpt-6-luna', reasoning: { preferred: 'medium' }, memo: fromLowest });
    expect(a.sent[0].body!.reasoning_effort).toBe('medium');
    expect(fromLowest).toEqual({ reasoningEffort: null });
    // A default lowered to none: the lowest is still the model's own lowest.
    const fromDefault = {};
    const b = serviceOf(named('low'), reply('ok'), reply('ok'));
    await ask(b.transport, { model: 'gpt-6-luna', reasoning: { preferred: 'low' }, memo: fromDefault });
    await ask(b.transport, { model: 'gpt-6-luna', reasoning: 'lowest', memo: fromDefault });
    expect(b.sent[2].body!.reasoning_effort).toBe('none');
    expect(fromDefault).toEqual({ preferredEffort: { low: null }, reasoningEffort: 'none' });
  });
});

describe("a chat completion: the answer's id", () => {
  it("is the service's own id for the completion, where it gives one", async () => {
    const s = serviceOf({ status: 200, body: { id: 'chatcmpl-1', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }] } }, reply('ok'));
    await expect(ask(s.transport)).resolves.toEqual({ ok: true, text: 'ok', id: 'chatcmpl-1' });
    await expect(ask(s.transport)).resolves.toEqual({ ok: true, text: 'ok' });
  });
});

describe("a chat completion: the service's refusals", () => {
  const failureOf = async (answer: Answer, over: Partial<ChatCompletionOptions> = {}) => {
    const s = service(answer);
    const result = await ask(s.transport, { reasoning: 'default', ...over });
    expect(s.sent).toHaveLength(1);
    if (result.ok) throw new Error('answered');
    return result.failure;
  };

  it('a key refused (401, 403) is auth, in the service\'s own words', async () => {
    expect(await failureOf(refusal(401, { message: 'Incorrect API key provided.', type: 'invalid_request_error', code: 'invalid_api_key' })))
      .toEqual({ code: 'auth', status: 401, message: 'Incorrect API key provided.' });
    expect(await failureOf(refusal(403, { message: 'Project does not have access.' }))).toMatchObject({ code: 'auth', status: 403 });
  });

  it("Gemini's refusal of a key that is not valid (a 400, its errors in a list) is auth", async () => {
    expect(await failureOf({ status: 400, body: [{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }] }, { service: 'gemini', model: 'gemini-3.8-flash' }))
      .toEqual({ code: 'auth', status: 400, message: 'API key not valid. Please pass a valid API key.' });
  });

  it('a model the service does not know is model_missing: a 404, or a refusal that names the model as unknown', async () => {
    expect(await failureOf(refusal(404, { message: 'The model `gpt-9` does not exist or you do not have access to it.', code: 'model_not_found' })))
      .toEqual({ code: 'model_missing', status: 404, message: 'The model `gpt-9` does not exist or you do not have access to it.' });
    // Gemini lists models that are refused at use (measured 2026-11-22).
    expect(await failureOf({ status: 404, body: [{ error: { code: 404, message: 'This model models/gemini-2.5-flash is no longer available to new users.', status: 'NOT_FOUND' } }] }, { service: 'gemini', model: 'gemini-2.5-flash' }))
      .toEqual({ code: 'model_missing', status: 404, message: 'This model models/gemini-2.5-flash is no longer available to new users.' });
    expect(await failureOf(refusal(400, { message: 'Model Not Exist' }))).toMatchObject({ code: 'model_missing', status: 400 });
    expect(await failureOf(refusal(400, { message: 'acme/nope is not a valid model ID' }))).toMatchObject({ code: 'model_missing' });
    expect(await failureOf(refusal(400, { message: 'bad', code: 'model_not_found' }))).toMatchObject({ code: 'model_missing' });
    // A refusal that only mentions the model is not one.
    expect(await failureOf(refusal(400, { message: "Invalid value for 'temperature': this model only supports 1." }))).toMatchObject({ code: 'refused' });
  });

  it('a rate limit is rate_limit, at once: nothing is waited out here; out of credit is quota', async () => {
    expect(await failureOf(refusal(429, { message: 'Rate limit reached for requests.', code: 'rate_limit_exceeded' }))).toEqual({ code: 'rate_limit', status: 429, message: 'Rate limit reached for requests.' });
    expect(await failureOf(refusal(429, { message: 'You exceeded your current quota.', type: 'insufficient_quota', code: 'insufficient_quota' }))).toMatchObject({ code: 'quota', status: 429 });
    expect(await failureOf(refusal(402, { message: 'Insufficient credits.' }))).toMatchObject({ code: 'quota', status: 402 });
  });

  it("the service's trouble (5xx) is server; any other refusal is refused, with its status", async () => {
    expect(await failureOf(refusal(500, { message: 'The server had an error.' }))).toEqual({ code: 'server', status: 500, message: 'The server had an error.' });
    expect(await failureOf({ status: 503, body: '<html><body>Service Unavailable</body></html>' })).toEqual({ code: 'server', status: 503, message: 'The service answered 503.' });
    expect(await failureOf(refusal(400, { message: "'messages' must contain at least one message." }))).toEqual({ code: 'refused', status: 400, message: "'messages' must contain at least one message." });
    expect(await failureOf({ status: 422, body: { error: 'messages: field required' } })).toEqual({ code: 'refused', status: 422, message: 'messages: field required' });
    expect(await failureOf({ status: 418, body: '' })).toEqual({ code: 'refused', status: 418, message: 'The service answered 418.' });
  });

  it("trims the service's words, and never repeats the key", async () => {
    const failure = await failureOf(refusal(401, { message: `  Incorrect API key provided: ${KEY}. \n` }));
    expect(failure.message).toBe('Incorrect API key provided: [key].');
    expect(JSON.stringify(failure)).not.toContain(KEY);
    const long = await failureOf(refusal(400, { message: 'x'.repeat(2000) }));
    expect(long.message.length).toBeLessThanOrEqual(500);
  });

  it('an answer that cannot be read is server; a refusal to answer is refused; no content is an empty answer', async () => {
    expect(await failureOf({ status: 200, body: 'not json' })).toMatchObject({ code: 'server' });
    expect(await failureOf({ status: 200, body: { choices: [{ message: { content: null, refusal: "I can't help with that." } }] } })).toEqual({ code: 'refused', message: "I can't help with that." });
    expect(await failureOf({ status: 200, body: { error: { message: 'Upstream failed.', code: 502 } } })).toEqual({ code: 'server', message: 'Upstream failed.' });
    const empty = service(reply(null));
    await expect(ask(empty.transport)).resolves.toEqual({ ok: true, text: '' });
    const parts = service(reply([{ type: 'text', text: 'Hel' }, { type: 'text', text: 'lo' }]));
    await expect(ask(parts.transport)).resolves.toEqual({ ok: true, text: 'Hello' });
  });
});

describe('a chat completion: when nothing answers', () => {
  it('a transport that throws is network, in its words without the key', async () => {
    const s = service(new TypeError(`Failed to fetch ${KEY}`));
    const result = await ask(s.transport);
    expect(result).toEqual({ ok: false, failure: { code: 'network', message: 'The service could not be reached: Failed to fetch [key]' } });
  });

  it("a transport's own failure keeps its code", async () => {
    const s = service(new TextModelTransportError('timeout', 'The service did not answer within 60 seconds.'));
    await expect(ask(s.transport)).resolves.toEqual({ ok: false, failure: { code: 'timeout', message: 'The service did not answer within 60 seconds.' } });
  });

  const hanging: TextModelTransport = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
  });

  it("a caller's abort rejects with the caller's reason, before the request or during it", async () => {
    const before = new AbortController();
    const stopped = new Error('stopped');
    before.abort(stopped);
    const s = service(reply('a'));
    await expect(ask(s.transport, { signal: before.signal })).rejects.toBe(stopped);
    expect(s.sent).toHaveLength(0);

    const during = new AbortController();
    const asking = ask(hanging, { signal: during.signal });
    during.abort(stopped);
    await expect(asking).rejects.toBe(stopped);
  });

  it('an abort the caller marks as a timeout is a timeout failure, not a rejection', async () => {
    const controller = new AbortController();
    const asking = ask(hanging, { signal: controller.signal });
    controller.abort(textModelTimeout());
    await expect(asking).resolves.toEqual({ ok: false, failure: { code: 'timeout', message: 'The service did not answer in time.' } });
    expect(textModelTimeout().name).toBe('TimeoutError');
    // AbortSignal.timeout marks its abort the same way.
    const timed = new AbortController();
    timed.abort(new DOMException('signal timed out', 'TimeoutError'));
    await expect(ask(service(reply('a')).transport, { signal: timed.signal })).resolves.toMatchObject({ ok: false, failure: { code: 'timeout' } });
  });

  it('an answer that lands after the abort is not taken', async () => {
    const controller = new AbortController();
    const stopped = new Error('stopped');
    const late: TextModelTransport = async () => {
      controller.abort(stopped);
      return { status: 200, text: async () => JSON.stringify(reply('late').body) };
    };
    await expect(ask(late, { signal: controller.signal })).rejects.toBe(stopped);
  });
});

describe('a chat completion: a compatible service it cannot reach', () => {
  it('without an address that can be used it sends nothing, and says why', async () => {
    const s = service(reply('a'));
    await expect(ask(s.transport, { service: 'compatible', baseUrl: undefined })).resolves.toMatchObject({ ok: false, failure: { code: 'refused' } });
    await expect(ask(s.transport, { service: 'compatible', baseUrl: 'http://192.168.1.10:11434/v1' })).resolves.toEqual({
      ok: false, failure: { code: 'refused', message: 'The address must start with https:// (http:// only for this computer).' },
    });
    expect(s.sent).toHaveLength(0);
  });

  it('outside the desktop app it is reached by nothing, and says so', async () => {
    const result = await chatCompletion({ service: 'compatible', baseUrl: 'https://api.example.com/v1', model: 'm', messages: MESSAGES, maxTokens: 10, signal: new AbortController().signal });
    expect(result).toEqual({ ok: false, failure: { code: 'refused', message: 'A compatible service can be reached from the desktop app only.' } });
  });
});

describe('the model list', () => {
  const list = (transport: TextModelTransport, over: Partial<Parameters<typeof listModels>[0]> = {}) =>
    listModels({ service: 'openai', apiKey: KEY, signal: new AbortController().signal, transport, ...over });

  it("asks each service's /models with the key, and answers the ids", async () => {
    const s = service({ status: 200, body: { object: 'list', data: [{ id: 'gpt-5-mini', object: 'model' }, { id: 'gpt-4.1-mini' }] } });
    await expect(list(s.transport)).resolves.toEqual({ ok: true, ids: ['gpt-5-mini', 'gpt-4.1-mini'] });
    expect(s.sent[0].url).toBe('https://api.openai.com/v1/models');
    expect(s.sent[0].init).toMatchObject({ method: 'GET', headers: { Authorization: `Bearer ${KEY}` } });
    expect(s.sent[0].init.body).toBeUndefined();
  });

  it("takes Gemini's ids without their models/ prefix", async () => {
    const s = service({ status: 200, body: { data: [{ id: 'models/gemini-3.8-flash' }, { id: 'models/gemini-flash-lite-latest' }] } });
    await expect(list(s.transport, { service: 'gemini' })).resolves.toEqual({ ok: true, ids: ['gemini-3.8-flash', 'gemini-flash-lite-latest'] });
    expect(s.sent[0].url).toBe(`${GEMINI_TEXT_BASE_URL}/models`);
  });

  it('a compatible service with no list (404) lists nothing, and that is no failure: the user types the model', async () => {
    const s = service({ status: 404, body: '404 page not found' });
    await expect(list(s.transport, { service: 'compatible', baseUrl: 'http://localhost:8080/v1', apiKey: undefined })).resolves.toEqual({ ok: true, ids: [] });
    expect(s.sent[0].url).toBe('http://localhost:8080/v1/models');
    expect(s.sent[0].init.headers).toEqual({});
  });

  it('a refusal is mapped as a chat completion\'s; an answer that is no list is server', async () => {
    await expect(list(service(refusal(401, { message: 'Incorrect API key provided.' })).transport)).resolves.toEqual({ ok: false, failure: { code: 'auth', status: 401, message: 'Incorrect API key provided.' } });
    await expect(list(service({ status: 404, body: '' }).transport)).resolves.toMatchObject({ ok: false, failure: { code: 'refused', status: 404 } });
    await expect(list(service({ status: 200, body: '<html></html>' }).transport, { service: 'compatible', baseUrl: 'https://api.example.com' })).resolves.toMatchObject({ ok: false, failure: { code: 'server' } });
  });

  it("rejects with the caller's reason when the caller aborts", async () => {
    const controller = new AbortController();
    const stopped = new Error('stopped');
    controller.abort(stopped);
    await expect(list(service().transport, { signal: controller.signal })).rejects.toBe(stopped);
  });
});

describe('a probe of the chosen model', () => {
  it('asks the model for one token with the lowest reasoning, and answers whether it was had', async () => {
    const s = service(reply('H'));
    await expect(probeModel({ service: 'openai', apiKey: KEY, model: 'gpt-5-nano', signal: new AbortController().signal, transport: s.transport })).resolves.toEqual({ ok: true });
    expect(s.sent[0].body).toEqual({ model: 'gpt-5-nano', messages: [{ role: 'user', content: 'Hi' }], max_completion_tokens: PROBE_TOKENS, reasoning_effort: 'minimal' });
  });

  it('counts a model that ran out of its budget before its first word as answering', async () => {
    const s = service({ status: 400, body: { error: { message: 'Could not finish the message because max_tokens or model output limit was reached. Please try again with higher max_tokens.' } } });
    await expect(probeModel({ service: 'openai', apiKey: KEY, model: 'gpt-5-mini', signal: new AbortController().signal, transport: s.transport })).resolves.toEqual({ ok: true });
  });

  it("reads Gemini's 400 for a refused key as the key's fault", async () => {
    const s = service({ status: 400, body: [{ error: { code: 400, message: 'Please pass a valid API key', status: 'INVALID_ARGUMENT' } }] });
    await expect(probeModel({ service: 'gemini', apiKey: KEY, model: 'gemini-3.1-flash-lite', signal: new AbortController().signal, transport: s.transport }))
      .resolves.toMatchObject({ ok: false, failure: { code: 'auth', status: 400 } });
  });

  it("asks with the reasoning the user chose, so that a value the model refuses is said before a session starts", async () => {
    const s = service(refusal(400, { message: "Unsupported value: 'reasoning_effort' does not support 'ultra'." }));
    await expect(probeModel({ service: 'openai', apiKey: KEY, model: 'gpt-5.4', signal: new AbortController().signal, transport: s.transport, reasoning: { exact: 'ultra' } }))
      .resolves.toEqual({ ok: false, failure: { code: 'refused', status: 400, message: "Unsupported value: 'reasoning_effort' does not support 'ultra'." } });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0].body!.reasoning_effort).toBe('ultra');
  });

  it('says why a listed model cannot be used', async () => {
    const s = service({ status: 404, body: [{ error: { code: 404, message: 'This model models/gemini-2.5-flash is no longer available to new users.' } }] });
    await expect(probeModel({ service: 'gemini', apiKey: KEY, model: 'gemini-2.5-flash', signal: new AbortController().signal, transport: s.transport }))
      .resolves.toEqual({ ok: false, failure: { code: 'model_missing', status: 404, message: 'This model models/gemini-2.5-flash is no longer available to new users.' } });
  });
});

describe('a JSON object read from an answer', () => {
  it('reads an object, one in a fenced block, or one with words around it', () => {
    expect(jsonObjectOf('{"a":1}')).toEqual({ a: 1 });
    expect(jsonObjectOf('```json\n{"a": [1, 2]}\n```')).toEqual({ a: [1, 2] });
    expect(jsonObjectOf('Here are the notes:\n{"title": "x"}\nDone.')).toEqual({ title: 'x' });
  });

  it('is null for anything else', () => {
    expect(jsonObjectOf('[1, 2]')).toBeNull();
    expect(jsonObjectOf('not json')).toBeNull();
    expect(jsonObjectOf('{"a":')).toBeNull();
    expect(jsonObjectOf('')).toBeNull();
  });
});

describe('review points', () => {
  it("keeps a compatible service's model ids as it says them; strips models/ only from Gemini's", async () => {
    const compat = service({ status: 200, body: { data: [{ id: 'models/acme-chat' }, { id: 'plain' }] } });
    await expect(listModels({ service: 'compatible', baseUrl: 'https://api.example.com/v1', signal: new AbortController().signal, transport: compat.transport })).resolves.toEqual({ ok: true, ids: ['models/acme-chat', 'plain'] });
    const gemini = service({ status: 200, body: { data: [{ id: 'models/gemini-3.1-flash-lite' }] } });
    await expect(listModels({ service: 'gemini', apiKey: KEY, signal: new AbortController().signal, transport: gemini.transport })).resolves.toEqual({ ok: true, ids: ['gemini-3.1-flash-lite'] });
  });

  it('reads a 400 naming a dotted model as not found as the model missing', async () => {
    const s = service(refusal(400, { message: 'Model gpt-4.1-mini not found' }));
    expect(await ask(s.transport, { service: 'compatible', baseUrl: 'https://api.example.com/v1', model: 'gpt-4.1-mini' })).toMatchObject({ ok: false, failure: { code: 'model_missing' } });
  });

  it('never shows a key in a message, however short', async () => {
    const s = service(refusal(400, { message: 'bad key abc supplied' }));
    const result = await ask(s.transport, { service: 'compatible', baseUrl: 'https://api.example.com/v1', apiKey: 'abc', model: 'm' });
    expect(result.ok ? '' : result.failure.message).not.toContain('abc');
  });
});

describe('a probe of a model cut short, with a short key', () => {
  it('is read from the service\'s words, not from them with the key taken out', async () => {
    const s = service({ status: 400, body: { error: { message: 'Could not finish the message because max_tokens or model output limit was reached.' } } });
    await expect(probeModel({ service: 'compatible', baseUrl: 'https://api.example.com/v1', apiKey: 'a', model: 'm', signal: new AbortController().signal, transport: s.transport })).resolves.toEqual({ ok: true });
  });
});
