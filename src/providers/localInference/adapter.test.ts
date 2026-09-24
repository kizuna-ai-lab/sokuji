import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import { AdapterStartError, type AdapterSession, type SessionContext } from '../../lib/contract/adapter';
import { checkConformance, recordConformance, type ConformanceLog } from '../../lib/contract/conformance';
import type { AdapterEvent } from '../../lib/contract/events';
import { createLocalInferenceAdapter } from './adapter';
import { createFakeEngines } from './fakeEngines';
import type { LocalInferenceConfig } from './config';

const auto: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: false, turns: 'auto' };

function makeConfig(over: Partial<LocalInferenceConfig> = {}): LocalInferenceConfig {
  return {
    asr: { modelId: 'asr-model', streaming: true },
    vad: { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4, maxSpeechDuration: 30 },
    translation: { kind: 'engine', modelId: 'mt-model', instructions: 'Translate ja to en.', wrapTranscript: true },
    punctuateJobs: false,
    ...over,
  };
}

const TTS = { modelId: 'tts-model', speakerId: 0, speed: 1 };

/** Lets every pending promise continuation run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Starts a session without settling any engine's `init`. */
function begin(config = makeConfig(), context = auto, signal = new AbortController().signal) {
  const fakes = createFakeEngines();
  const recorder = recordConformance();
  const starting = createLocalInferenceAdapter(fakes.engines).start(
    { context, config, credentials: {}, clock: createVirtualClock(), signal },
    recorder.events,
  );
  return { ...fakes, ...recorder, starting, context };
}

/** Starts a session and settles every engine it created. */
async function open(config = makeConfig(), context = auto) {
  const t = begin(config, context);
  if (t.created.includes('asr')) t.asr.ready();
  if (t.created.includes('translation')) t.translation.ready();
  if (t.created.includes('tts')) t.tts.ready();
  const session: AdapterSession = await t.starting;
  return { ...t, session };
}

const last = <T>(items: T[]): T | undefined => items[items.length - 1];
const events = (log: ConformanceLog) => log.filter((e): e is AdapterEvent => e.kind !== 'marker');
const content = (log: ConformanceLog) => events(log).filter((e) => e.kind.startsWith('segment') || e.kind === 'audio');
const ofKind = <K extends AdapterEvent['kind']>(log: ConformanceLog, kind: K) =>
  events(log).filter((e) => e.kind === kind).map((e) => e.payload as Extract<AdapterEvent, { kind: K }>['payload']);

function expectConformant(log: ConformanceLog, context: SessionContext) {
  expect(checkConformance(log, context)).toEqual([]);
}

describe('the LocalInference adapter — segments and jobs', () => {
  it('grows one source segment from partials, closes it at the final, and pairs the translation by origin', async () => {
    const t = await open();
    t.asr.partial('今日');
    t.asr.partial(' 今日は ');
    t.asr.partial('今日は'); // unchanged once trimmed: nothing
    t.asr.final('今日は天気');
    expect(t.translation.calls).toEqual([{ text: '今日は天気', systemPrompt: 'Translate ja to en.', wrapTranscript: true }]);
    t.translation.answer('Nice weather today.');
    await settle();
    t.asr.partial('公園');
    t.asr.final('公園に');
    t.translation.answer('To the park.');
    await settle();

    expect(content(t.log)).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 1, text: '今日' } },
      { kind: 'segmentText', payload: { ref: 1, text: '今日は' } },
      { kind: 'segmentText', payload: { ref: 1, text: '今日は天気' } },
      { kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } },
      { kind: 'segmentOpened', payload: { ref: 2, side: 'translation', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 2, text: 'Nice weather today.' } },
      { kind: 'segmentClosed', payload: { ref: 2, origin: 'u1' } },
      { kind: 'segmentOpened', payload: { ref: 3, side: 'source', origin: 'u2' } },
      { kind: 'segmentText', payload: { ref: 3, text: '公園' } },
      { kind: 'segmentText', payload: { ref: 3, text: '公園に' } },
      { kind: 'segmentClosed', payload: { ref: 3, origin: 'u2' } },
      { kind: 'segmentOpened', payload: { ref: 4, side: 'translation', origin: 'u2' } },
      { kind: 'segmentText', payload: { ref: 4, text: 'To the park.' } },
      { kind: 'segmentClosed', payload: { ref: 4, origin: 'u2' } },
    ]);
    expectConformant(t.log, t.context);
  });

  it('opens and closes the source segment at the final when the engine sends no partials', async () => {
    const t = await open(makeConfig({ asr: { modelId: 'whisper', streaming: false } }));
    t.asr.final('  hello  ');
    t.translation.answer('こんにちは');
    await settle();
    expect(content(t.log)).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'hello' } },
      { kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } },
      { kind: 'segmentOpened', payload: { ref: 2, side: 'translation', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 2, text: 'こんにちは' } },
      { kind: 'segmentClosed', payload: { ref: 2, origin: 'u1' } },
    ]);
    expectConformant(t.log, t.context);
  });

  it('drops an empty final: nothing opens for it, and a segment its partials opened closes with its last text, without a job', async () => {
    const t = await open();
    t.asr.speechStart(); // a VAD start opens nothing
    t.asr.final('   ');
    expect(content(t.log)).toEqual([]);
    t.asr.partial('えっと');
    t.asr.final('');
    expect(content(t.log)).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'えっと' } },
      { kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } },
    ]);
    expect(t.translation.calls).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('opens nothing for an empty translation', async () => {
    const t = await open();
    t.asr.final('あ');
    t.translation.answer('');
    await settle();
    expect(ofKind(t.log, 'segmentOpened').map((p) => p.side)).toEqual(['source']);
    expectConformant(t.log, t.context);
  });

  it('runs jobs one at a time: the next translation starts only when the last one ends', async () => {
    const t = await open();
    t.asr.final('一');
    t.asr.final('二');
    expect(t.translation.calls.map((c) => c.text)).toEqual(['一']);
    t.translation.answer('One.');
    await settle();
    expect(t.translation.calls.map((c) => c.text)).toEqual(['一', '二']);
    t.translation.answer('Two.');
    await settle();
    expect(ofKind(t.log, 'segmentOpened').filter((p) => p.side === 'translation')).toEqual([
      { ref: 3, side: 'translation', origin: 'u1' },
      { ref: 4, side: 'translation', origin: 'u2' },
    ]);
    expectConformant(t.log, t.context);
  });

  it('AST: a final becomes a translation segment with no source segment', async () => {
    const t = await open(makeConfig({ asr: { modelId: 'granite', streaming: false }, translation: { kind: 'ast' } }));
    expect(t.created).toEqual(['asr']);
    expect(t.asr.inits[0].options).toMatchObject({ language: 'ja', translateTo: 'en' });
    t.asr.final('Good morning.');
    await settle();
    expect(content(t.log)).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'translation', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'Good morning.' } },
      { kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } },
    ]);
    expectConformant(t.log, t.context);
  });

  it('transcription-only: source segments only, and translation_unavailable once, after the start', async () => {
    const t = begin(makeConfig({ translation: { kind: 'none' } }));
    expect(t.created).toEqual(['asr']);
    t.asr.ready();
    const session = await t.starting;
    expect(ofKind(t.log, 'degraded').map((d) => d.code)).toEqual(['translation_unavailable']);
    t.asr.final('こんにちは');
    t.asr.final('さようなら');
    await settle();
    expect(ofKind(t.log, 'segmentOpened').map((p) => p.side)).toEqual(['source', 'source']);
    expect(ofKind(t.log, 'degraded').map((d) => d.code)).toEqual(['translation_unavailable']);
    await session.stop();
    expectConformant(t.log, t.context);
  });

  it('hands the engine a copy of the audio: the array passed in is still readable', async () => {
    const t = await open();
    const pcm = new Int16Array([1, 2, 3]);
    t.session.appendAudio(pcm);
    expect(Array.from(pcm)).toEqual([1, 2, 3]);
    expect(t.asr.fed.map((a) => Array.from(a))).toEqual([[1, 2, 3]]);
  });

  it('reports itself as local', async () => {
    const t = await open();
    expect(t.session.info).toEqual({ transport: 'local' });
  });
});

describe('the LocalInference adapter — loading', () => {
  it('reports each engine settling: three engines, total 3, done 1..3', async () => {
    const t = begin(makeConfig({ tts: TTS }), { ...auto, speech: true });
    expect(t.created).toEqual(['asr', 'translation', 'tts']);
    t.translation.ready();
    await settle();
    t.asr.ready();
    await settle();
    t.tts.ready();
    await t.starting;
    expect(ofKind(t.log, 'loading')).toEqual([
      { stage: 'translation', done: 1, total: 3 },
      { stage: 'asr', done: 2, total: 3 },
      { stage: 'tts', done: 3, total: 3 },
    ]);
    expectConformant(t.log, t.context);
  });

  it('counts only the engines it started: no TTS, total 2', async () => {
    const t = await open();
    expect(t.created).toEqual(['asr', 'translation']);
    expect(ofKind(t.log, 'loading').map((l) => [l.done, l.total])).toEqual([[1, 2], [2, 2]]);
  });

  it('inits ASR with its VAD config and the source language, and translation with the pair and model', async () => {
    const config = makeConfig();
    const t = await open(config);
    expect(t.asr.config).toEqual(config.asr);
    expect(t.asr.inits).toEqual([{ modelId: 'asr-model', options: { vadConfig: config.vad, language: 'ja' } }]);
    expect(t.translation.inits).toEqual([{ sourceLang: 'ja', targetLang: 'en', modelId: 'mt-model' }]);
  });

  it('aborted while inits are pending: rejects at once, disposes every engine, and disposes one whose init resolves later', async () => {
    const controller = new AbortController();
    const t = begin(makeConfig({ tts: TTS }), { ...auto, speech: true }, controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(t.starting).rejects.toThrow('cancelled');
    expect([t.asr.disposes, t.translation.disposes, t.tts.disposes]).toEqual([1, 1, 1]);
    const before = t.log.length;
    t.asr.ready();
    t.translation.failInit('disposed');
    t.tts.ready();
    await settle();
    expect([t.asr.disposes, t.translation.disposes, t.tts.disposes]).toEqual([2, 1, 2]);
    expect(t.log.length).toBe(before); // nothing after the rejection
    expect(content(t.log)).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('rejects a start whose signal was aborted before it began, creating nothing', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const t = begin(makeConfig(), auto, controller.signal);
    await expect(t.starting).rejects.toThrow('cancelled');
    expect(t.created).toEqual([]);
  });

  it('an ASR init that runs out of GPU memory rejects with gpu_out_of_memory, after disposing everything', async () => {
    const t = begin(makeConfig({ tts: TTS }), { ...auto, speech: true });
    t.asr.failInit('Error: OrtRun failed: OUT_OF_DEVICE_MEMORY');
    const failure = await t.starting.catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AdapterStartError);
    expect((failure as AdapterStartError).code).toBe('gpu_out_of_memory');
    expect([t.asr.disposes, t.translation.disposes, t.tts.disposes]).toEqual([1, 1, 1]);
    expectConformant(t.log, t.context);
  });

  it('any other ASR or translation init failure rejects with an ordinary error', async () => {
    const t = begin();
    t.asr.ready();
    t.translation.failInit('Translation model "mt-model" is not downloaded.');
    const failure = await t.starting.catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AdapterStartError);
    expect((failure as Error).message).toContain('is not downloaded');
    expect([t.asr.disposes, t.translation.disposes]).toEqual([1, 1]);
    expect(ofKind(t.log, 'loading').map((l) => l.stage)).toEqual(['asr']);
  });

  it('a TTS init failing degrades to no speech: the start resolves and says tts_degraded', async () => {
    const t = begin(makeConfig({ tts: TTS }), { ...auto, speech: true });
    t.asr.ready();
    t.translation.ready();
    t.tts.failInit('tts load failed');
    await t.starting;
    expect(t.tts.disposes).toBe(1);
    expect(ofKind(t.log, 'degraded').map((d) => d.code)).toEqual(['tts_degraded']);
    expect(ofKind(t.log, 'loading').map((l) => l.done)).toEqual([1, 2, 3]);
    expectConformant(t.log, t.context);
  });

  it('a start that fails after TTS degraded says nothing: its notices wait for the start to resolve', async () => {
    const t = begin(makeConfig({ tts: TTS }), { ...auto, speech: true });
    t.tts.failInit('tts load failed');
    await settle();
    t.asr.failInit('asr load failed');
    await expect(t.starting).rejects.toThrow('asr load failed');
    await settle();
    expect(ofKind(t.log, 'degraded')).toEqual([]);
  });

  it('a speaker id the TTS model did not load says voice_fallback', async () => {
    const t = begin(makeConfig({ tts: { ...TTS, speakerId: 7 } }), { ...auto, speech: true });
    t.asr.ready();
    t.translation.ready();
    t.tts.ready({ sampleRate: 44100, voices: [{ sid: 0 }, { sid: 1 }] });
    await t.starting;
    expect(ofKind(t.log, 'degraded').map((d) => d.code)).toEqual(['voice_fallback']);
  });
});

describe('the LocalInference adapter — errors', () => {
  it('a translation that rejects says translation_failed, humanized, and the next utterance is still translated', async () => {
    const t = await open();
    t.asr.final('一');
    t.translation.reject(new Error('[bing:network] fetch failed'));
    await settle();
    expect(ofKind(t.log, 'degraded')).toEqual([
      expect.objectContaining({ code: 'translation_failed', message: 'Bing Translator is temporarily unavailable.' }),
    ]);
    t.asr.final('二');
    t.translation.answer('Two.');
    await settle();
    expect(ofKind(t.log, 'segmentOpened').map((p) => p.side)).toEqual(['source', 'source', 'translation']);
    expect(last(ofKind(t.log, 'segmentText'))).toEqual({ ref: 3, text: 'Two.' });
    expectConformant(t.log, t.context);
  });

  it('an ordinary ASR error says transcription_failed and the session goes on', async () => {
    const t = await open();
    t.asr.fail('decode failed');
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'transcription_failed', message: 'decode failed' })]);
    t.asr.final('まだ');
    t.translation.answer('Still.');
    await settle();
    expect(last(ofKind(t.log, 'segmentText'))).toEqual({ ref: 2, text: 'Still.' });
    expect(ofKind(t.log, 'failed')).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('the ASR worker dying fails the session, and nothing follows', async () => {
    const t = await open();
    t.asr.partial('途中');
    t.asr.die();
    t.asr.partial('途中まで');
    t.asr.final('途中まで');
    t.asr.fail('late');
    await settle();
    expect(last(events(t.log))).toEqual({ kind: 'failed', payload: expect.objectContaining({ message: expect.stringContaining('RuntimeError: unreachable') }) });
    expect(ofKind(t.log, 'segmentText')).toEqual([{ ref: 1, text: '途中' }]);
    expectConformant(t.log, t.context);
  });

  it("the translation worker's fatal error fails the session instead of wedging the queue", async () => {
    const t = await open();
    t.asr.final('一');
    t.translation.fatal('worker crashed');
    t.translation.answer('One.');
    t.asr.final('二');
    await settle();
    expect(last(events(t.log))).toEqual({ kind: 'failed', payload: expect.objectContaining({ message: expect.stringContaining('worker crashed') }) });
    expect(ofKind(t.log, 'segmentOpened').map((p) => p.side)).toEqual(['source']);
    expectConformant(t.log, t.context);
  });

  it('a lost WebGPU device fails the session', async () => {
    const t = await open();
    t.asr.fail('WebGPU device lost: the GPU was reset');
    expect(ofKind(t.log, 'failed')).toHaveLength(1);
    expect(ofKind(t.log, 'degraded')).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('the TTS worker dying fails the session', async () => {
    const t = await open(makeConfig({ tts: TTS }), { ...auto, speech: true });
    t.tts.die('tts worker crashed');
    expect(ofKind(t.log, 'failed')).toEqual([expect.objectContaining({ message: expect.stringContaining('tts worker crashed') })]);
    expectConformant(t.log, t.context);
  });
});

describe('the LocalInference adapter — stop', () => {
  it('disposes every engine before its promise is awaited, and a late final or answer emits nothing', async () => {
    const t = await open(makeConfig({ tts: TTS }), { ...auto, speech: true });
    t.asr.final('一'); // its translation still pending
    t.mark('stop');
    const stopping = t.session.stop();
    expect([t.asr.disposes, t.translation.disposes, t.tts.disposes]).toEqual([1, 1, 1]);
    const before = t.log.length;
    t.translation.answer('One.');
    t.asr.partial('遅い');
    t.asr.final('遅い');
    t.asr.fail('late');
    t.asr.die();
    await stopping;
    await settle();
    expect(t.log.length).toBe(before);
    expect(ofKind(t.log, 'closed')).toEqual([]);
    t.session.appendAudio(new Int16Array(4));
    expect(t.asr.fed).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('a translation rejected by the dispose emits nothing either', async () => {
    const t = await open();
    t.asr.final('一');
    t.mark('stop');
    await t.session.stop();
    t.translation.reject(new Error('TranslationEngine disposed'));
    await settle();
    expect(ofKind(t.log, 'degraded')).toEqual([]);
    expectConformant(t.log, t.context);
  });
});

describe('the LocalInference adapter — frames', () => {
  it("reports today's local.* events as frames, every string cut below 2048 characters", async () => {
    const long = 'x'.repeat(5000);
    const t = await open(makeConfig({ translation: { kind: 'engine', modelId: 'mt-model', instructions: long, wrapTranscript: false } }));
    t.asr.speechStart();
    t.asr.partial('あ');
    t.asr.final('あい');
    t.translation.answer('Ai.');
    await settle();
    const frames = ofKind(t.log, 'frame');
    expect(frames.map((f) => [f.direction, f.type])).toEqual([
      ['out', 'local.init.start'],
      ['out', 'local.init.asr.start'],
      ['out', 'local.init.translation.start'],
      ['out', 'local.init.asr.ready'],
      ['out', 'local.init.translation.ready'],
      ['out', 'local.session.opened'],
      ['in', 'local.asr.start'],
      ['in', 'local.asr.partial'],
      ['in', 'local.asr.end'],
      ['out', 'local.translation.start'],
      ['in', 'local.translation.end'],
    ]);
    const start = frames.find((f) => f.type === 'local.translation.start')!.payload as { systemPrompt: string };
    expect(start.systemPrompt.length).toBeLessThan(2048);
    expect(start.systemPrompt.startsWith('xxx')).toBe(true);
    expectConformant(t.log, t.context);
  });
});
