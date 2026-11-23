/**
 * Local Native's translation session: the sidecar's translate socket behind the translation contract, one final
 * answer per job (#578 ruling 21), held to the translation rules.
 */
import { describe, expect, it } from 'vitest';
import { AdapterStartError, type SessionContext } from '../../lib/contract/adapter';
import { createVirtualClock, type Clock } from '../../lib/contract/clock';
import { flush } from '../../lib/contract/testing/drive';
import { checkTranslation, recordTranslation, type TranslationLog } from '../../lib/contract/translationConformance';
import { createFakeNativeEngines, createFakeNativeHost } from './fakeEngines';
import { NATIVE_JOB_TIMEOUT_MS, startNativeTranslation, type NativeTranslationConfig } from './translationSession';

const JA_EN: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: false, turns: 'auto' };
const closed = (origin: string, text: string) => ({ origin, text, stableLen: text.length, closed: true });

function config(over: Partial<NativeTranslationConfig> = {}): NativeTranslationConfig {
  return { modelId: 'mt-a', variant: 'q8_0', device: 'gpu', instructions: 'Translate ja to en.', wrapTranscript: true, coLoaded: { asrModel: 'asr-ja' }, host: createFakeNativeHost(), ...over };
}

function create(over: { config?: NativeTranslationConfig; context?: SessionContext; signal?: AbortSignal } = {}) {
  const fakes = createFakeNativeEngines();
  const clock = createVirtualClock(0);
  let made = 0;
  let madeOn: Clock | null = null;
  const c = over.config ?? config();
  const { session, log } = recordTranslation(
    (request, events) => startNativeTranslation((k) => { made++; madeOn = k; return fakes.translation; }, request, events),
    { leg: 'speaker', context: over.context ?? JA_EN, config: c, credentials: {}, clock, signal: over.signal ?? new AbortController().signal },
  );
  const of = <K extends string>(kind: K) => (log as TranslationLog).filter((r) => r.kind === kind).map((r) => (r as { payload: unknown }).payload);
  const frames = () => (log as TranslationLog).filter((r) => r.kind === 'frame').map((r) => (r as { payload: { type: string } }).payload.type);
  return { session, log, engine: fakes.translation, clock, of, frames, made: () => made, madeOn: () => madeOn, config: c };
}

async function opened(over: Parameters<typeof create>[0] = {}) {
  const h = create(over);
  const opening = h.session.open();
  h.engine.ready();
  await opening;
  return h;
}

describe("Local Native's translation session", () => {
  it("inits the sidecar's translation once, with the leg's pair, model, device, variant and co-loaded ids", async () => {
    const h = await opened();
    expect(h.engine.inits).toEqual([{ sourceLang: 'ja', targetLang: 'en', modelId: 'mt-a', device: 'gpu', variant: 'q8_0', asrModel: 'asr-ja' }]);
    expect(h.made()).toBe(1);
    expect(h.madeOn()).toBe(h.clock);
    await h.session.stop();
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it("files the translation's plan where the library's badges read it (#578 ruling 14)", async () => {
    const host = createFakeNativeHost();
    const h = await opened({ config: config({ host }) });
    expect(host.plans).toEqual([{ stage: 'translation', plan: expect.objectContaining({ model: 'mt-a' }) }]);
    await h.session.stop();
  });

  it('each job is one translation segment, whole and final; a partial from the sidecar shows nothing (#578 ruling 21)', async () => {
    const h = await opened();
    h.session.source(closed('a', 'こんにちは。'));
    await flush();
    h.engine.stream('Hel');
    h.engine.answer('Hello.');
    await flush();
    expect(h.of('translationText')).toEqual([{ ref: 1, text: 'Hello.', stableLen: 6, language: 'en' }]);
    expect(h.frames()).toEqual(expect.arrayContaining(['local.native.translation.start', 'local.native.translation.end']));
    await h.session.stop();
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it("asks the sidecar to wait as long as a job may take, so its request never gives up before the job's deadline", async () => {
    const h = await opened();
    h.session.source(closed('a', '一。'));
    await flush();
    expect(h.engine.calls.map((c) => c.timeoutMs)).toEqual([NATIVE_JOB_TIMEOUT_MS]);
    await h.session.stop();
  });

  it('a failed job says translation_failed and the next job runs', async () => {
    const h = await opened();
    h.session.source(closed('a', '一。'));
    h.session.source(closed('b', '二。'));
    await flush();
    h.engine.reject('model exploded');
    await flush();
    expect(h.of('degraded')).toEqual([expect.objectContaining({ code: 'translation_failed' })]);
    h.engine.answer('Two.');
    await flush();
    expect((h.of('translationText') as Array<{ text: string }>).map((t) => t.text)).toEqual(['Two.']);
    await h.session.stop();
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a job past NATIVE_JOB_TIMEOUT_MS says translation_timeout and the next runs', async () => {
    const h = await opened();
    h.session.source(closed('a', '一。'));
    h.session.source(closed('b', '二。'));
    await flush();
    h.clock.advance(NATIVE_JOB_TIMEOUT_MS - 1);
    await flush();
    expect(h.of('degraded')).toEqual([]);
    h.clock.advance(1);
    await flush();
    expect(h.of('degraded')).toEqual([expect.objectContaining({ code: 'translation_failed', reason: 'translation_timeout' })]);
    h.engine.answer('One.');
    h.engine.answer('Two.');
    await flush();
    expect((h.of('translationText') as Array<{ text: string }>).map((t) => t.text)).toEqual(['Two.']);
    await h.session.stop();
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a closed socket fails the session and nothing follows (#578 ruling 10)', async () => {
    const h = await opened();
    h.session.source(closed('a', '一。'));
    await flush();
    h.engine.close('native host disconnected');
    await flush();
    expect(h.of('failed')).toEqual([{ message: 'The local engine stopped: native host disconnected' }]);
    const said = h.log.length;
    h.engine.answer('One.');
    await flush();
    expect(h.log.filter((r, i) => i >= said && r.kind !== 'frame' && r.kind !== 'stop' && r.kind !== 'stopped')).toEqual([]);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('an id-less error is a Logs line, not a failure', async () => {
    const h = await opened();
    h.engine.onError?.('a token decode failed');
    await flush();
    expect(h.of('failed')).toEqual([]);
    expect(h.frames()).toContain('local.native.translation.error');
    await h.session.stop();
  });

  it('an init that fails rejects the open; a cancelled start rejects at once', async () => {
    const h = create();
    const opening = h.session.open();
    h.engine.failInit('no such file');
    await expect(opening).rejects.toThrow('Translation engine init failed: no such file');
    expect(h.engine.disposes).toBe(1);
    const abort = new AbortController();
    abort.abort(new Error('cancelled'));
    const c = create({ signal: abort.signal });
    await expect(c.session.open()).rejects.toThrow('cancelled');
    expect(c.made()).toBe(0);
  });

  it('refuses an auto source before any socket is made', async () => {
    const h = create({ context: { ...JA_EN, direction: { source: 'auto', target: 'en' } } });
    await expect(h.session.open()).rejects.toBeInstanceOf(AdapterStartError);
    await expect(h.session.open()).rejects.toMatchObject({ code: 'build_refused' });
    expect(h.made()).toBe(0);
  });

  it('stop lets the socket go before its first await', async () => {
    const h = await opened();
    const stopping = h.session.stop();
    expect(h.engine.disposes).toBe(1);
    await stopping;
    expect(checkTranslation(h.log)).toEqual([]);
  });
});
