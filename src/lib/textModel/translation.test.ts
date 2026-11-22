/**
 * A text model translating another unit's source (spec §4), over a fake transport: what each job is sent (the
 * system prompt, the earlier stretches as turns, the stretch), the reasoning sent as chosen, what the session keeps
 * learned, a refusal that ends the leg against one that costs a job, and the translation rules held throughout.
 */
import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import { flush } from '../contract/testing/drive';
import type { TranslationStartRequest } from '../contract/translation';
import { checkTranslation, recordTranslation } from '../contract/translationConformance';
import { JOB_TIMEOUT_MS } from '../translation/jobTranslator';
import type { TextModelRequestInit, TextModelService, TextModelTransport } from './client';
import { translationSystemPrompt } from './prompt';
import { FATAL_CODES, startTextModelTranslation, type TextModelCredentials, type TextModelTranslationConfig } from './translation';

/** Not a key of any service. */
const KEY = 'test-key-0000';
const EN_JA: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: false, turns: 'auto' };

interface Sent { url: string; init: TextModelRequestInit; body: Record<string, unknown> }
type Reply = { status: number; body: unknown } | 'hang';

/** A service that answers the requests in the order they come, as the test says, and records them. */
function fakeService() {
  const sent: Sent[] = [];
  const waiting: Array<(reply: Reply) => void> = [];
  const transport: TextModelTransport = (url, init) => new Promise((resolve, reject) => {
    sent.push({ url, init, body: JSON.parse(init.body ?? '{}') });
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    waiting.push((reply) => {
      if (reply === 'hang') return;
      resolve({ status: reply.status, text: async () => JSON.stringify(reply.body) });
    });
  });
  const answer = async (reply: Reply) => {
    const next = waiting.shift();
    if (!next) throw new Error('nothing is waiting for an answer');
    next(reply);
    await flush();
  };
  return { transport, sent, answer, waiting };
}

const says = (content: string) => ({ status: 200, body: { choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] } });
const refuses = (status: number, message: string, code?: string) => ({ status, body: { error: { message, ...(code ? { code } : {}) } } });
const closed = (origin: string, text: string) => ({ origin, text, stableLen: text.length, closed: true });

const CONFIG: TextModelTranslationConfig = { model: 'gpt-5-mini', reasoning: 'lowest', system: translationSystemPrompt(EN_JA.direction), maxTokens: 1024 };

function setup(o: { service?: TextModelService; config?: Partial<TextModelTranslationConfig>; credentials?: TextModelCredentials } = {}) {
  const service = fakeService();
  const clock = createVirtualClock(0);
  const request: TranslationStartRequest<TextModelTranslationConfig, TextModelCredentials> = {
    leg: 'speaker',
    context: EN_JA,
    config: { ...CONFIG, ...o.config },
    credentials: o.credentials ?? { apiKey: KEY },
    clock,
    signal: new AbortController().signal,
  };
  const { session, log } = recordTranslation((r, e) => startTextModelTranslation(o.service ?? 'openai', { transport: service.transport }, r, e), request);
  const of = (kind: string) => log.flatMap((e) => (e.kind === kind && 'payload' in e ? [e.payload as Record<string, unknown>] : []));
  return { ...service, clock, session, log, of };
}

describe('what a job is sent', () => {
  it('the system prompt, then the stretch; each answer one segment in the target language, with the session\'s last stretches as earlier turns', async () => {
    const h = setup();
    await h.session.open();
    h.session.source(closed('a', 'Hello.'));
    await flush();
    expect(h.sent[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(h.sent[0].init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(h.sent[0].body).toEqual({
      model: 'gpt-5-mini',
      messages: [{ role: 'system', content: CONFIG.system }, { role: 'user', content: 'Hello.' }],
      max_completion_tokens: 1024,
      reasoning_effort: 'minimal',
    });
    await h.answer(says('  こんにちは。\n'));
    for (const [origin, text, translation] of [['b', 'How are you?', 'お元気ですか？'], ['c', 'Fine.', '元気です。'], ['d', 'Thanks.', 'ありがとう。']]) {
      h.session.source(closed(origin, text));
      await flush();
      await h.answer(says(translation));
    }
    h.session.source(closed('e', 'Bye.'));
    await flush();
    // The last three stretches and their translations, oldest first.
    expect((h.sent[4].body.messages as unknown[]).slice(1)).toEqual([
      { role: 'user', content: 'How are you?' }, { role: 'assistant', content: 'お元気ですか？' },
      { role: 'user', content: 'Fine.' }, { role: 'assistant', content: '元気です。' },
      { role: 'user', content: 'Thanks.' }, { role: 'assistant', content: 'ありがとう。' },
      { role: 'user', content: 'Bye.' },
    ]);
    await h.answer(says('さようなら。'));
    expect(h.of('translationText').map((t) => [t.text, t.language, t.stableLen])).toEqual([
      ['こんにちは。', 'ja', 6], ['お元気ですか？', 'ja', 7], ['元気です。', 'ja', 5], ['ありがとう。', 'ja', 6], ['さようなら。', 'ja', 6],
    ]);
    expect(h.of('translationOpened').map((o) => o.origin)).toEqual(['a', 'b', 'c', 'd', 'e']);
    await h.session.stop();
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a reasoning the user chose is sent exactly, never lowered; a temperature only when the config says one', async () => {
    const h = setup({ config: { model: 'gpt-5.4', reasoning: { exact: 'medium' }, maxTokens: 4096 } });
    await h.session.open();
    h.session.source(closed('a', 'Hello.'));
    await flush();
    expect(h.sent[0].body).toMatchObject({ reasoning_effort: 'medium', max_completion_tokens: 4096 });
    expect(h.sent[0].body).not.toHaveProperty('temperature');
    await h.answer(refuses(400, "Unsupported value: 'reasoning_effort' does not support 'medium' with this model."));
    // Not asked again with another value: the job failed, in the service's words.
    expect(h.sent).toHaveLength(1);
    expect(h.of('degraded')).toEqual([expect.objectContaining({ code: 'translation_failed', message: "Unsupported value: 'reasoning_effort' does not support 'medium' with this model." })]);
    const steady = setup({ config: { model: 'gpt-4.1-mini', temperature: 0.2 } });
    await steady.session.open();
    steady.session.source(closed('a', 'Hello.'));
    await flush();
    expect(steady.sent[0].body).toMatchObject({ temperature: 0.2 });
    expect(steady.sent[0].body).not.toHaveProperty('reasoning_effort');
    await h.session.stop();
    await steady.session.stop();
  });

  it('what the lowest reasoning met is kept for the session: a refused value is not sent again to the next job', async () => {
    const h = setup({ service: 'gemini', config: { model: 'gemini-3.1-flash-lite' } });
    await h.session.open();
    h.session.source(closed('a', 'One.'));
    await flush();
    expect(h.sent[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(h.sent[0].body).toMatchObject({ reasoning_effort: 'none', max_tokens: 1024 });
    await h.answer(refuses(400, 'reasoning_effort: none is not supported'));
    await h.answer(says('一。'));
    h.session.source(closed('b', 'Two.'));
    await flush();
    expect(h.sent.map((s) => s.body.reasoning_effort)).toEqual(['none', 'low', 'low']);
    await h.answer(says('二。'));
    await h.session.stop();
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it("a compatible service: its address, no key when none was entered, and nothing of reasoning at its lowest", async () => {
    const h = setup({ service: 'compatible', config: { model: 'llama3.3' }, credentials: { baseUrl: 'http://localhost:11434/v1' } });
    await h.session.open();
    h.session.source(closed('a', 'Hello.'));
    await flush();
    expect(h.sent[0].url).toBe('http://localhost:11434/v1/chat/completions');
    expect(h.sent[0].init.headers).not.toHaveProperty('Authorization');
    expect(h.sent[0].body).not.toHaveProperty('reasoning_effort');
    // A local reasoning model writes its thinking first: only the translation is said.
    await h.answer(says('<think>The user wants Japanese.</think>\nこんにちは。'));
    expect(h.of('translationText').map((t) => t.text)).toEqual(['こんにちは。']);
    await h.session.stop();
    expect(checkTranslation(h.log)).toEqual([]);
  });
});

describe('when the service refuses', () => {
  it('a rate limit, the service\'s trouble, a blank answer: that job\'s notice, in the service\'s words, and the next job runs', async () => {
    const h = setup();
    await h.session.open();
    for (const [origin, text] of [['a', 'One.'], ['b', 'Two.'], ['c', 'Three.'], ['d', 'Four.']]) h.session.source(closed(origin, text));
    await flush();
    await h.answer(refuses(429, 'Rate limit reached for gpt-5-mini.', 'rate_limit_exceeded'));
    await h.answer(refuses(503, 'The server is overloaded.'));
    await h.answer(says('   '));
    await h.answer(says('四。'));
    expect(h.of('degraded').map((d) => [d.code, d.message, d.reason])).toEqual([
      ['translation_failed', 'Rate limit reached for gpt-5-mini.', undefined],
      ['translation_failed', 'The server is overloaded.', undefined],
      ['translation_failed', 'The translation came back empty.', 'translation_empty'],
    ]);
    expect(h.of('translationText').map((t) => t.text)).toEqual(['四。']);
    expect(h.of('failed')).toEqual([]);
    // A failed job is no context for the next.
    expect((h.sent[3].body.messages as unknown[])).toHaveLength(2);
    await h.session.stop();
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a job not answered by its deadline is given up, and the next one runs', async () => {
    const h = setup();
    await h.session.open();
    h.session.source(closed('a', 'One.'));
    h.session.source(closed('b', 'Two.'));
    await flush();
    await h.answer('hang');
    h.clock.advance(JOB_TIMEOUT_MS);
    await flush();
    expect(h.of('degraded')).toEqual([expect.objectContaining({ code: 'translation_failed', reason: 'translation_timeout' })]);
    // The request given up was let go.
    expect(h.sent[0].init.signal.aborted).toBe(true);
    expect(h.sent).toHaveLength(2);
    await h.answer(says('二。'));
    expect(h.of('translationText').map((t) => t.text)).toEqual(['二。']);
    await h.session.stop();
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a key refused, a model the service does not know, an account out of credit: the leg ends, naming why, and nothing more is asked', async () => {
    expect([...FATAL_CODES].sort()).toEqual(['auth', 'model_missing', 'quota']);
    for (const [reply, code] of [
      [refuses(401, 'Incorrect API key provided.', 'invalid_api_key'), 'auth'],
      [refuses(404, 'The model `gpt-9` does not exist or you do not have access to it.', 'model_not_found'), 'model_missing'],
      [refuses(429, 'You exceeded your current quota.', 'insufficient_quota'), 'quota'],
    ] as const) {
      const h = setup();
      await h.session.open();
      h.session.source(closed('a', 'One.'));
      h.session.source(closed('b', 'Two.'));
      await flush();
      await h.answer(reply);
      await flush();
      expect(h.of('failed'), code).toEqual([expect.objectContaining({ code, message: (reply.body as { error: { message: string } }).error.message })]);
      expect(h.of('degraded'), code).toEqual([]);
      expect(h.sent, code).toHaveLength(1);
      await h.session.stop();
      expect(checkTranslation(h.log), code).toEqual([]);
    }
  });

  it('a stop in the middle of a job lets the request go, and its late answer is unheard', async () => {
    const h = setup();
    await h.session.open();
    h.session.source(closed('a', 'One.'));
    await flush();
    await h.session.stop();
    expect(h.sent[0].init.signal.aborted).toBe(true);
    const said = h.log.length;
    h.clock.advance(JOB_TIMEOUT_MS * 2);
    await flush();
    expect(h.log).toHaveLength(said);
    expect(checkTranslation(h.log)).toEqual([]);
  });
});
