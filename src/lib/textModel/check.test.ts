/**
 * A text-model provider's readiness over a fake transport: the model list, then one short request to the model the
 * translation would run, with the reasoning chosen; each refusal answered with its code and the service's words.
 */
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { flush } from '../contract/testing/drive';
import type { CheckContext } from '../provider/types';
import { DEFAULT_MODEL_CHOICE, DEFAULT_NOTES_REASONING_CHOICE, DEFAULT_REASONING_CHOICE } from './choice';
import { CHECK_TIMEOUT_MS, createTextModelCheck, failureNoticeCode, TEXT_MODEL_UNSET, type TextModelStageSettings } from './check';
import type { TextModelRequestInit, TextModelService, TextModelTransport } from './client';

const KEY = 'test-key-0000';
const CTX: CheckContext = { pair: { source: 'en', target: 'ja' }, legs: ['speaker'], stages: ['translation'] };
const SETTINGS: TextModelStageSettings = {
  translationModel: DEFAULT_MODEL_CHOICE, translationReasoning: DEFAULT_REASONING_CHOICE, notesModel: DEFAULT_MODEL_CHOICE, notesReasoning: DEFAULT_NOTES_REASONING_CHOICE,
};

type Reply = { status: number; body: unknown } | 'hang';

function service(...replies: Reply[]) {
  const sent: Array<{ url: string; init: TextModelRequestInit; body: Record<string, unknown> | undefined }> = [];
  const transport: TextModelTransport = (url, init) => new Promise((resolve, reject) => {
    sent.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    const next = replies.shift();
    if (next === undefined) { reject(new Error('asked once too often')); return; }
    if (next === 'hang') return;
    resolve({ status: next.status, text: async () => JSON.stringify(next.body) });
  });
  return { transport, sent };
}

const list = (...ids: string[]) => ({ status: 200, body: { object: 'list', data: ids.map((id) => ({ id, object: 'model' })) } });
const says = (content: string) => ({ status: 200, body: { choices: [{ index: 0, message: { role: 'assistant', content } }] } });
const refuses = (status: number, message: string, code?: string) => ({ status, body: { error: { message, ...(code ? { code } : {}) } } });

function check(svc: TextModelService, s: ReturnType<typeof service>, settings: Partial<TextModelStageSettings> = {}, k: { apiKey?: string; baseUrl?: string } = { apiKey: KEY }, ctx: CheckContext = CTX) {
  const clock = createVirtualClock(0);
  const run = createTextModelCheck(`${svc}_text`, svc, 'The service', { transport: s.transport, clock });
  return { clock, answer: run(k, { ...SETTINGS, ...settings }, ctx) };
}

describe("a text model's readiness", () => {
  it("ready: the key's text models, in the service's order, once the automatic model answered", async () => {
    const s = service(list('gpt-realtime', 'gpt-5-mini', 'gpt-4o-transcribe', 'gpt-4.1-mini', 'text-embedding-3-small'), says('H'));
    await expect(check('openai', s).answer).resolves.toEqual({ ok: true, models: [{ id: 'gpt-5-mini' }, { id: 'gpt-4.1-mini' }] });
    expect(s.sent.map((r) => r.url)).toEqual(['https://api.openai.com/v1/models', 'https://api.openai.com/v1/chat/completions']);
    expect(s.sent[1].body).toMatchObject({ model: 'gpt-5-mini', reasoning_effort: 'minimal' });
  });

  it('asks the model and the reasoning the user chose: the typed name and the typed value go as they are', async () => {
    const s = service(list('gpt-5-mini', 'gpt-5.4'), says('H'));
    await expect(check('openai', s, { translationModel: { listed: 'gpt-5-mini', typed: 'ft:gpt-5.4:org' }, translationReasoning: { level: 'low', typed: 'xhigh' } }).answer).resolves.toMatchObject({ ok: true });
    expect(s.sent[1].body).toMatchObject({ model: 'ft:gpt-5.4:org', reasoning_effort: 'xhigh' });
  });

  it("a reasoning value the model refuses is said before Start, in the service's own words, as a refused request", async () => {
    const words = "Unsupported value: 'reasoning_effort' does not support 'minimal' with this model.";
    const s = service(list('gpt-5.4'), refuses(400, words));
    await expect(check('openai', s, { translationModel: { listed: 'gpt-5.4', typed: '' }, translationReasoning: { level: 'off', typed: 'minimal' } }).answer)
      .resolves.toEqual({ ok: false, code: 'refused', reason: words });
    expect(s.sent).toHaveLength(2);
    expect(failureNoticeCode('refused')).toBe('refused');
  });

  it("a model the key lists but the service refuses (Gemini's no longer open to new keys) is model_missing, in its words", async () => {
    const s = service(list('models/gemini-2.5-flash', 'models/gemini-3.1-flash-lite'), refuses(404, 'This model models/gemini-2.5-flash is no longer available to new users.'));
    await expect(check('gemini', s, { translationModel: { listed: 'gemini-2.5-flash', typed: '' } }).answer)
      .resolves.toEqual({ ok: false, code: 'model_missing', reason: 'This model models/gemini-2.5-flash is no longer available to new users.' });
  });

  it('a key refused, an account out of credit: their codes, naming the provider so the notice opens its row', async () => {
    const auth = service(refuses(401, 'Incorrect API key provided.', 'invalid_api_key'));
    await expect(check('openai', auth).answer).resolves.toEqual({ ok: false, code: 'auth', reason: 'Incorrect API key provided.', params: { provider: 'openai_text' } });
    const quota = service(list('gpt-5-mini'), refuses(429, 'You exceeded your current quota.', 'insufficient_quota'));
    await expect(check('openai', quota).answer).resolves.toEqual({ ok: false, code: 'quota', reason: 'You exceeded your current quota.', params: { provider: 'openai_text' } });
    const limited = service(list('gpt-5-mini'), refuses(429, 'Rate limit reached.', 'rate_limit_exceeded'));
    await expect(check('openai', limited).answer).resolves.toEqual({ ok: false, code: 'rate_limit', reason: 'Rate limit reached.' });
  });

  it("a key that lists no text model is model_missing; a compatible service with nothing chosen asks for a model", async () => {
    await expect(check('openai', service(list('gpt-realtime', 'whisper-1'))).answer).resolves.toMatchObject({ ok: false, code: 'model_missing' });
    const compatible = service(list('deepseek-chat', 'deepseek-reasoner'));
    await expect(check('compatible', compatible, {}, { baseUrl: 'https://api.example.com/v1', apiKey: KEY }).answer).resolves.toMatchObject({ ok: false, code: TEXT_MODEL_UNSET });
    expect(compatible.sent).toHaveLength(1);
  });

  it('a compatible service with no list: the model typed is asked, and is enough', async () => {
    const s = service({ status: 404, body: '404 page not found' }, says('H'));
    await expect(check('compatible', s, { translationModel: { listed: '', typed: 'qwen3:8b' } }, { baseUrl: 'http://localhost:11434/v1' }).answer).resolves.toEqual({ ok: true, models: [] });
    expect(s.sent.map((r) => r.url)).toEqual(['http://localhost:11434/v1/models', 'http://localhost:11434/v1/chat/completions']);
    expect(s.sent[0].init.headers).not.toHaveProperty('Authorization');
    // Its lowest reasoning is no value at all.
    expect(s.sent[1].body).not.toHaveProperty('reasoning_effort');
  });

  // `Provider.check`: `ok: false` is the service's no; a check that could not find out throws, in its words.
  it("the service not reached, or not answering within its bound, throws in its words; the caller's cancel rejects", async () => {
    const unreachable: TextModelTransport = async () => { throw new TypeError('Failed to fetch'); };
    await expect(createTextModelCheck('openai_text', 'openai', 'OpenAI', { transport: unreachable })({ apiKey: KEY }, SETTINGS, CTX)).rejects.toThrow('The service could not be reached: Failed to fetch');
    const slow = check('openai', service('hang'));
    await flush();
    slow.clock.advance(CHECK_TIMEOUT_MS);
    await expect(slow.answer).rejects.toThrow('The service did not answer within 15 s.');
    // The model's probe the same: the list answered, the model did not in time.
    const slowModel = check('openai', service(list('gpt-5-mini'), 'hang'));
    await flush();
    slowModel.clock.advance(CHECK_TIMEOUT_MS);
    await expect(slowModel.answer).rejects.toThrow('The service did not answer within 15 s.');
    // A service that answered with its own trouble did answer: that is said, not thrown.
    await expect(check('openai', service(list('gpt-5-mini'), refuses(503, 'The engine is currently overloaded.'))).answer)
      .resolves.toEqual({ ok: false, code: 'server', reason: 'The engine is currently overloaded.' });
    const cancel = new AbortController();
    const cancelled = check('openai', service('hang'), {}, { apiKey: KEY }, { ...CTX, signal: cancel.signal });
    await flush();
    cancel.abort(new Error('stopped'));
    await expect(cancelled.answer).rejects.toThrow('stopped');
  });
});

// Text models, part C: the notes are no run stage. The check is told whether the provider writes the line-up's notes
// (`notes`), and which run stages it serves (`stages`); it asks the model of each, so the notes' model and reasoning
// are said on the Notes card before the notes are asked.
describe("a text model's readiness for the notes", () => {
  const NOTES_ONLY: CheckContext = { ...CTX, stages: [], notes: true };

  it("for the notes alone: the notes' model, its automatic one the notes' own preference, asked with the lowest for the default reasoning", async () => {
    const s = service(list('gpt-5-mini', 'gpt-6-luna'), says('H'));
    await expect(check('openai', s, {}, { apiKey: KEY }, NOTES_ONLY).answer).resolves.toEqual({ ok: true, models: [{ id: 'gpt-5-mini' }, { id: 'gpt-6-luna' }] });
    expect(s.sent).toHaveLength(2);
    expect(s.sent[1].body).toMatchObject({ model: 'gpt-6-luna', reasoning_effort: 'none' });
  });

  it('a reasoning the user chose for the notes is asked as it would be sent, and its refusal is the answer, in the service\'s words', async () => {
    const words = "Unsupported value: 'reasoning_effort' does not support 'high' with this model.";
    const s = service(list('gemini-3.8-flash'), refuses(400, words));
    await expect(check('gemini', s, { notesReasoning: { level: 'high', typed: '' } }, { apiKey: KEY }, NOTES_ONLY).answer)
      .resolves.toEqual({ ok: false, code: 'refused', reason: words });
    expect(s.sent[1].body).toMatchObject({ model: 'gemini-3.8-flash', reasoning_effort: 'high' });
  });

  it('for the translation and the notes both: each model asked once, and the same model with the same reasoning once in all', async () => {
    const both = service(list('gpt-5-mini', 'gpt-6-luna'), says('H'), says('H'));
    await expect(check('openai', both, {}, { apiKey: KEY }, { ...CTX, notes: true }).answer).resolves.toMatchObject({ ok: true });
    expect(both.sent.map((r) => r.body?.model)).toEqual([undefined, 'gpt-5-mini', 'gpt-6-luna']);
    const same = service(list('gpt-5-mini'), says('H'));
    await expect(check('openai', same, { notesModel: { listed: 'gpt-5-mini', typed: '' }, notesReasoning: { level: 'lowest', typed: '' } }, { apiKey: KEY }, { ...CTX, notes: true }).answer)
      .resolves.toMatchObject({ ok: true });
    expect(same.sent).toHaveLength(2);
  });

  it("the notes' model refused fails the check told about the notes, and never a run's, which is not", async () => {
    const notesModel = { listed: 'gpt-gone', typed: '' };
    const told = service(list('gpt-5-mini'), says('H'), refuses(404, 'The model `gpt-gone` does not exist.'));
    await expect(check('openai', told, { notesModel }, { apiKey: KEY }, { ...CTX, notes: true }).answer)
      .resolves.toEqual({ ok: false, code: 'model_missing', reason: 'The model `gpt-gone` does not exist.' });
    const run = service(list('gpt-5-mini'), says('H'));
    await expect(check('openai', run, { notesModel }).answer).resolves.toMatchObject({ ok: true });
    expect(run.sent).toHaveLength(2);
  });

  it('a compatible service with no notes model chosen asks for one', async () => {
    const s = service(list('deepseek-chat'));
    await expect(check('compatible', s, {}, { baseUrl: 'https://api.example.com/v1' }, NOTES_ONLY).answer).resolves.toMatchObject({ ok: false, code: TEXT_MODEL_UNSET });
  });

  it('serving neither stage, it checks the key alone', async () => {
    const s = service(list('gpt-5-mini'));
    await expect(check('openai', s, {}, { apiKey: KEY }, { ...CTX, stages: [] }).answer).resolves.toEqual({ ok: true, models: [{ id: 'gpt-5-mini' }] });
    expect(s.sent).toHaveLength(1);
  });
});
