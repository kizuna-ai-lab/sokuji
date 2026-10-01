import { describe, expect, it } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { AdapterSession, SessionContext } from '../../lib/contract/adapter';
import { checkConformance, recordConformance, type ConformanceLog } from '../../lib/contract/conformance';
import type { AdapterEvent } from '../../lib/contract/events';
import { createLocalNativeAdapter, VAD_INIT_TIMEOUT_MS } from './adapter';
import type { LocalNativeConfig } from './config';
import { createFakeNativeEngines, createFakeNativeHost } from './fakeEngines';
import type { NativeHost } from './host';

const silent: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: false, turns: 'auto' };
const speaking: SessionContext = { ...silent, speech: true };

const TTS = { modelId: 'tts-a', device: 'auto' as const, speed: 1, voice: '', capability: { builtin: 'named' as const, custom: 'none' as const } };
function config(over: Partial<LocalNativeConfig> = {}): LocalNativeConfig {
  return {
    asr: { modelId: 'asr-a', device: 'auto' },
    vad: { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 },
    translation: { modelId: 'mt-a', device: 'auto', instructions: 'Translate ja to en.', wrapTranscript: true },
    asrFirst: true,
    ...over,
  };
}

/** Lets every pending promise continuation run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function begin(c = config(), context = silent, host: NativeHost = createFakeNativeHost(), signal = new AbortController().signal) {
  const fakes = createFakeNativeEngines();
  const recorder = recordConformance();
  const clock = createVirtualClock();
  const starting = createLocalNativeAdapter(fakes.engines, host).start({ context, config: c, credentials: {}, clock, signal }, recorder.events);
  return { ...fakes, ...recorder, starting, context, clock, host };
}

/** Starts a session with every seam ready to answer. */
async function open(c = config(), context = silent, host: NativeHost = createFakeNativeHost()) {
  const t = begin(c, context, host);
  t.asr.ready();
  t.translation.ready();
  t.tts.ready();
  t.vad.ready();
  const session: AdapterSession = await t.starting;
  await settle();
  return { ...t, session };
}

const events = (log: ConformanceLog) => log.filter((e): e is AdapterEvent => e.kind !== 'marker');
const ofKind = <K extends AdapterEvent['kind']>(log: ConformanceLog, kind: K) =>
  events(log).filter((e) => e.kind === kind).map((e) => e.payload as Extract<AdapterEvent, { kind: K }>['payload']);
function segments(log: ConformanceLog, side: 'source' | 'translation') {
  const bySide = new Map<number, { origin?: string; text: string; closed: boolean }>();
  for (const e of events(log)) {
    if (e.kind === 'segmentOpened' && e.payload.side === side) bySide.set(e.payload.ref, { origin: e.payload.origin, text: '', closed: false });
    else if (e.kind === 'segmentText') { const s = bySide.get(e.payload.ref); if (s) s.text = e.payload.text; }
    else if (e.kind === 'segmentClosed') { const s = bySide.get(e.payload.ref); if (s) s.closed = true; }
  }
  return [...bySide.values()];
}
const conformant = (log: ConformanceLog, context: SessionContext) => expect(checkConformance(log, context)).toEqual([]);

describe('opening', () => {
  it("loads in the builder's order, ASR and translation first, then TTS, then the VAD (#578 ruling 15)", async () => {
    const a = await open(config({ tts: TTS }), speaking);
    expect(a.calls).toEqual(['asr', 'translation', 'tts', 'vad']);
    const b = await open(config({ tts: TTS, asrFirst: false }), speaking);
    expect(b.calls).toEqual(['translation', 'asr', 'tts', 'vad']);
    expect(b.translation.inits[0]).toEqual({ sourceLang: 'ja', targetLang: 'en', modelId: 'mt-a', device: 'auto', variant: undefined, asrModel: 'asr-a', ttsModel: 'tts-a' });
    expect(a.vad.inits[0]).toEqual({ threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 });
  });

  it('says each model loaded, and hands each plan to the host (#578 ruling 14)', async () => {
    const t = await open(config({ tts: TTS }), speaking);
    expect(ofKind(t.log, 'loading')).toEqual([
      { stage: 'asr', done: 1, total: 3 }, { stage: 'translation', done: 2, total: 3 }, { stage: 'tts', done: 3, total: 3 },
    ]);
    expect((t.host as ReturnType<typeof createFakeNativeHost>).plans.map((p) => [p.stage, p.plan.model, p.plan.device])).toEqual([
      ['asr', 'asr-a', 'cpu'], ['translation', 'mt-a', 'cpu'], ['tts', 'tts-a', 'cpu'],
    ]);
    conformant(t.log, speaking);
  });

  it('an ASR load that fails rejects the start and ends every seam', async () => {
    const t = begin();
    t.asr.failInit('no such model');
    await expect(t.starting).rejects.toThrow('ASR engine init failed: no such model');
    expect([t.asr.disposes, t.translation.disposes, t.vad.disposes]).toEqual([1, 1, 1]);
  });

  it('a cancelled start rejects at once and ends every seam', async () => {
    const ac = new AbortController();
    const t = begin(config(), silent, createFakeNativeHost(), ac.signal);
    ac.abort(new Error('cancelled'));
    await expect(t.starting).rejects.toThrow('cancelled');
    expect(t.asr.disposes).toBe(1);
  });

  it('a VAD that never loads fails the start after its timeout', async () => {
    const t = begin();
    t.asr.ready();
    t.translation.ready();
    await settle();
    t.clock.advance(VAD_INIT_TIMEOUT_MS);
    await expect(t.starting).rejects.toThrow('VAD worker init timeout');
  });

  it('a VAD that fails to load rejects the start and ends every seam', async () => {
    const t = begin();
    t.asr.ready();
    t.translation.ready();
    t.vad.failInit('model missing');
    await expect(t.starting).rejects.toThrow('model missing');
    expect([t.asr.disposes, t.translation.disposes, t.vad.disposes]).toEqual([1, 1, 1]);
  });

  it('a VAD that cannot even be created rejects the start: nothing throws outside the promise', async () => {
    const fakes = createFakeNativeEngines();
    fakes.engines.vad = () => { throw new Error('no worker'); };
    const starting = createLocalNativeAdapter(fakes.engines, createFakeNativeHost()).start(
      { context: silent, config: config(), credentials: {}, clock: createVirtualClock(), signal: new AbortController().signal },
      recordConformance().events,
    );
    await expect(starting).rejects.toThrow('no worker');
    expect(fakes.calls).toEqual([]);
  });

  it('TTS that fails to load leaves the session without speech, and says so (#578 ruling 10)', async () => {
    const t = begin(config({ tts: TTS }), speaking);
    t.asr.ready();
    t.translation.ready();
    t.tts.failInit('out of memory');
    t.vad.ready();
    await t.starting;
    await settle();
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded' })]);
  });

  it('a clone-only model with no clip is not loaded, and says so', async () => {
    const t = await open(config({ tts: { ...TTS, capability: { builtin: 'none', custom: 'clip', required: true } } }), speaking);
    expect(t.calls).not.toContain('tts');
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded' })]);
  });

  it('a transcription-only session says so once', async () => {
    const t = await open(config({ translation: null }));
    expect(t.calls).toEqual(['asr', 'vad']);
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'translation_unavailable' })]);
  });
});

describe('speech in, text out', () => {
  it('a partial opens the source segment, the final closes it, and the translation streams into its own (#578 ruling 8)', async () => {
    const t = await open();
    t.asr.partial('こんにち');
    t.asr.final('こんにちは');
    expect(t.translation.calls).toEqual([{ text: 'こんにちは', systemPrompt: 'Translate ja to en.', wrapTranscript: true }]);
    t.translation.stream('Hel');
    t.translation.stream('Hello');
    t.translation.answer('Hello.');
    await settle();
    expect(segments(t.log, 'source')).toEqual([{ origin: 'u1', text: 'こんにちは', closed: true }]);
    expect(segments(t.log, 'translation')).toEqual([{ origin: 'u1', text: 'Hello.', closed: true }]);
    conformant(t.log, silent);
  });

  it('a failed translation closes what streamed and says translation_failed', async () => {
    const t = await open();
    t.asr.final('こんにちは');
    t.translation.stream('Hel');
    t.translation.reject('timed out');
    await settle();
    expect(segments(t.log, 'translation')).toEqual([{ origin: 'u1', text: 'Hel', closed: true }]);
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'translation_failed' })]);
    conformant(t.log, silent);
  });

  it('typed text: a source segment exactly as typed, and its job', async () => {
    const t = await open();
    t.mark('appendText', '  hi  ');
    t.session.appendText('  hi  ');
    expect(t.translation.calls[0].text).toBe('hi');
    t.translation.answer('やあ');
    await settle();
    expect(segments(t.log, 'source')).toEqual([{ origin: 'u1', text: '  hi  ', closed: true }]);
    conformant(t.log, silent);
  });

  it('an id-less ASR error drops the utterance and says transcription_failed', async () => {
    const t = await open();
    t.asr.partial('こん');
    t.asr.fail('feeder failed');
    expect(segments(t.log, 'source')).toEqual([{ origin: 'u1', text: 'こん', closed: true }]);
    expect(t.translation.calls).toEqual([]);
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'transcription_failed' })]);
  });

  it('VAD edges become sidecar marks, and audio goes to both', async () => {
    const t = await open();
    t.session.appendAudio(new Int16Array([1, 2]));
    t.vad.start();
    t.vad.end();
    t.vad.cancel();
    expect(t.asr.fed).toEqual([new Int16Array([1, 2])]);
    expect(t.vad.fed).toEqual([new Int16Array([1, 2])]);
    expect(t.asr.marks).toEqual(['start', 'end', 'cancel']);
  });

  it("a turn's end feeds a 700 ms silent tail to both, then flushes the VAD and the sidecar; a failed flush is only a frame", async () => {
    const t = await open();
    t.asr.flushResult = Promise.reject(new Error('flush timed out'));
    t.session.endTurn();
    await settle();
    expect(t.asr.fed.map((f) => f.length)).toEqual(Array(7).fill(2400));
    expect(t.vad.fed.length).toBe(7);
    expect([t.vad.flushes, t.asr.flushes]).toEqual([1, 1]);
    expect(ofKind(t.log, 'frame').map((f) => f.type)).toContain('local.native.asr.flush.error');
    expect(ofKind(t.log, 'failed')).toEqual([]);
  });
});

describe('speech out', () => {
  it('a one-shot sentence is one ranged clip', async () => {
    const t = await open(config({ tts: TTS }), speaking);
    t.asr.final('こんにちは');
    t.translation.answer('Hello.');
    await settle();
    t.tts.say();
    await settle();
    expect(ofKind(t.log, 'audio').map((a) => a.range)).toEqual([[0, 6]]);
    conformant(t.log, speaking);
  });

  it('a streaming sentence arrives chunk by chunk, and its range is filled in afterwards (#578 ruling 9)', async () => {
    const t = begin(config({ tts: TTS }), speaking);
    t.asr.ready(); t.translation.ready(); t.tts.ready({ streaming: true }); t.vad.ready();
    await t.starting;
    t.asr.final('こんにちは');
    t.translation.answer('Hello.');
    await settle();
    t.tts.chunk();
    t.tts.chunk();
    t.tts.finish();
    await settle();
    expect(ofKind(t.log, 'audio').map((a) => a.range)).toEqual([undefined, undefined]);
    expect(ofKind(t.log, 'speechRanges')).toEqual([{ ref: expect.any(Number), ranges: [{ index: 0, range: [0, 3] }, { index: 1, range: [3, 6] }] }]);
    conformant(t.log, speaking);
  });

  it('applies the stored built-in voice before the first sentence', async () => {
    const host = createFakeNativeHost({ listVoices: async () => [{ name: 'Bella', language: 'en', curated: true, unstable: false, default: true }] });
    const t = await open(config({ tts: { ...TTS, voice: 'builtin:Bella' } }), speaking, host);
    expect(t.tts.voices).toEqual(['Bella']);
  });

  it('no audio when the leg does not speak', async () => {
    const t = await open(config({ tts: TTS }), silent);
    t.asr.final('こんにちは');
    t.translation.answer('Hello.');
    await settle();
    expect(t.tts.spoken).toEqual([]);
    conformant(t.log, silent);
  });
});

describe('failing and ending', () => {
  it('a closed ASR socket fails the session', async () => {
    const t = await open();
    t.asr.close();
    expect(ofKind(t.log, 'failed')).toEqual([{ message: 'The local engine stopped: native host disconnected' }]);
    t.asr.final('late');
    expect(ofKind(t.log, 'segmentOpened')).toEqual([]);
  });

  it('a closed TTS socket stops speech only', async () => {
    const t = await open(config({ tts: TTS }), speaking);
    t.tts.close();
    expect(ofKind(t.log, 'failed')).toEqual([]);
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded' })]);
    t.asr.final('こんにちは');
    t.translation.answer('Hello.');
    await settle();
    expect(t.tts.spoken).toEqual([]);
    expect(segments(t.log, 'translation')).toEqual([{ origin: 'u1', text: 'Hello.', closed: true }]);
  });

  it('a VAD that fails after it is ready fails the session', async () => {
    const t = await open();
    t.vad.fail('segmenter died');
    expect(ofKind(t.log, 'failed')).toEqual([{ message: 'Voice activity detection stopped: segmenter died' }]);
  });

  it('a VAD that fails again after the session failed says nothing more', async () => {
    const t = await open();
    t.vad.fail('segmenter died');
    t.vad.fail('segmenter died again');
    t.asr.close();
    expect(ofKind(t.log, 'failed')).toEqual([{ message: 'Voice activity detection stopped: segmenter died' }]);
  });

  it('stop ends every seam before its first await', async () => {
    const t = await open(config({ tts: TTS }), speaking);
    t.mark('stop');
    void t.session.stop();
    expect([t.asr.disposes, t.translation.disposes, t.tts.disposes, t.vad.disposes]).toEqual([1, 1, 1, 1]);
  });

  it('stop during a streaming sentence emits nothing after', async () => {
    const t = begin(config({ tts: TTS }), speaking);
    t.asr.ready(); t.translation.ready(); t.tts.ready({ streaming: true }); t.vad.ready();
    const session = await t.starting;
    t.asr.final('こんにちは');
    t.translation.answer('Hello.');
    await settle();
    t.tts.chunk();
    t.mark('stop');
    await session.stop();
    const before = t.log.length;
    t.asr.final('late');
    await settle();
    expect(t.log.length).toBe(before);
    conformant(t.log, speaking);
  });
});
