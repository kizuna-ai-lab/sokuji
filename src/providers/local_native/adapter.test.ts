import { describe, expect, it } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { AdapterSession, SessionContext } from '../../lib/contract/adapter';
import { checkConformance, recordConformance, type ConformanceLog } from '../../lib/contract/conformance';
import type { AdapterEvent } from '../../lib/contract/events';
import { createLocalNativeAdapter, VAD_INIT_TIMEOUT_MS } from './adapter';
import type { LocalNativeConfig } from './config';
import { createFakeNativeEngines, createFakeNativeHost } from './fakeEngines';
import type { LocalNativeEngines } from './engines';
import type { NativeHost } from '../../lib/local-inference/native/nativeModels';

const silent: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: false, turns: 'auto' };
const speaking: SessionContext = { ...silent, speech: true };

const TTS = { modelId: 'tts-a', device: 'auto' as const, speed: 1, voice: '', capability: { builtin: 'named' as const, custom: 'none' as const } };
function config(over: Partial<LocalNativeConfig> = {}): LocalNativeConfig {
  return {
    asr: { modelId: 'asr-a', device: 'auto' },
    vad: { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 },
    limit: { maxSpeechSeconds: 19 },
    translation: { modelId: 'mt-a', device: 'auto', instructions: 'Translate ja to en.', wrapTranscript: true },
    asrFirst: true,
    host: createFakeNativeHost(),
    ...over,
  };
}

/** Lets every pending promise continuation run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** `host`, when given, replaces the config's: the session reads its host from its config (#578 ruling 18). */
function begin(c = config(), context = silent, host?: NativeHost, signal = new AbortController().signal) {
  const fakes = createFakeNativeEngines();
  const recorder = recordConformance();
  const clock = createVirtualClock();
  const withHost = host ? { ...c, host } : c;
  const starting = createLocalNativeAdapter(fakes.engines).start({ context, config: withHost, credentials: {}, clock, signal }, recorder.events);
  return { ...fakes, ...recorder, starting, context, clock, host: withHost.host };
}

/** Starts a session with every seam ready to answer. */
async function open(c = config(), context = silent, host?: NativeHost) {
  const t = begin(c, context, host);
  t.asr.ready();
  t.translation.ready();
  t.tts.ready();
  t.turns.ready();
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
  it("every seam is made on the request's clock (#578 ruling 23)", async () => {
    const t = await open(config({ tts: TTS }), speaking);
    expect(t.clocks).toEqual({ asr: t.clock, translation: t.clock, tts: t.clock });
    conformant(t.log, speaking);
  });

  it('the host it reports plans to is the one its config carries (#578 ruling 18)', async () => {
    const host = createFakeNativeHost();
    const t = await open(config({ host }));
    expect(host.plans.map((p) => p.stage)).toEqual(['asr', 'translation']);
    conformant(t.log, silent);
  });

  it("loads in the builder's order, ASR and translation first, then TTS, then the turn detector (#578 ruling 15)", async () => {
    const a = await open(config({ tts: TTS }), speaking);
    expect(a.calls).toEqual(['asr', 'translation', 'tts', 'turns']);
    const b = await open(config({ tts: TTS, asrFirst: false }), speaking);
    expect(b.calls).toEqual(['translation', 'asr', 'tts', 'turns']);
    expect(b.translation.inits[0]).toEqual({ sourceLang: 'ja', targetLang: 'en', modelId: 'mt-a', device: 'auto', variant: undefined, asrModel: 'asr-a', ttsModel: 'tts-a' });
    expect(a.turns.inits[0]).toEqual({ turns: 'auto', vad: { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 }, limit: { maxSpeechSeconds: 19 } });
    conformant(a.log, speaking);
    conformant(b.log, speaking);
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
    expect([t.asr.disposes, t.translation.disposes, t.turns.disposes]).toEqual([1, 1, 1]);
    conformant(t.log, silent);
  });

  it('a cancelled start rejects at once and ends every seam', async () => {
    const ac = new AbortController();
    const t = begin(config(), silent, createFakeNativeHost(), ac.signal);
    ac.abort(new Error('cancelled'));
    await expect(t.starting).rejects.toThrow('cancelled');
    expect(t.asr.disposes).toBe(1);
    conformant(t.log, silent);
  });

  it('a turn detector that never loads fails the start after its timeout', async () => {
    const t = begin();
    t.asr.ready();
    t.translation.ready();
    await settle();
    t.clock.advance(VAD_INIT_TIMEOUT_MS);
    await expect(t.starting).rejects.toThrow('Turn detector init timeout');
    conformant(t.log, silent);
  });

  it('a turn detector that fails to load rejects the start and ends every seam', async () => {
    const t = begin();
    t.asr.ready();
    t.translation.ready();
    t.turns.failInit('model missing');
    await expect(t.starting).rejects.toThrow('model missing');
    expect([t.asr.disposes, t.translation.disposes, t.turns.disposes]).toEqual([1, 1, 1]);
    conformant(t.log, silent);
  });

  it('a turn detector that cannot even be created rejects the start before any other seam is made (nothing throws outside the promise)', async () => {
    const fakes = createFakeNativeEngines();
    const made: string[] = [];
    const engines: LocalNativeEngines = {
      asr: () => { made.push('asr'); return fakes.asr; },
      translation: () => { made.push('translation'); return fakes.translation; },
      tts: () => { made.push('tts'); return fakes.tts; },
      turns: () => { throw new Error('no worker'); },
    };
    const recorder = recordConformance();
    const starting = createLocalNativeAdapter(engines).start(
      { context: speaking, config: config({ tts: TTS }), credentials: {}, clock: createVirtualClock(), signal: new AbortController().signal },
      recorder.events,
    );
    await expect(starting).rejects.toThrow('no worker');
    expect(made).toEqual([]);
    conformant(recorder.log, speaking);
  });

  it('TTS that fails to load leaves the session without speech, and says so (#578 ruling 10)', async () => {
    const t = begin(config({ tts: TTS }), speaking);
    t.asr.ready();
    t.translation.ready();
    t.tts.failInit('out of memory');
    t.turns.ready();
    await t.starting;
    await settle();
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded' })]);
    conformant(t.log, speaking);
  });

  it('a clone-only model with no clip is not loaded, and says so', async () => {
    const t = await open(config({ tts: { ...TTS, capability: { builtin: 'none', custom: 'clip', required: true } } }), speaking);
    expect(t.calls).not.toContain('tts');
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded' })]);
    conformant(t.log, speaking);
  });

  it('a voice-clip lookup that throws leaves the session without speech, and the text goes on (#578 ruling 10)', async () => {
    const host = createFakeNativeHost({ voiceStore: () => { throw new Error('lookup broke'); } });
    const t = await open(config({ tts: { ...TTS, capability: { builtin: 'none', custom: 'clip', required: true } } }), speaking, host);
    expect(t.tts.disposes).toBe(1);
    expect(t.calls).not.toContain('tts');
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded', message: expect.stringContaining('lookup broke') })]);
    t.asr.final('こんにちは');
    t.translation.answer('Hello.');
    await settle();
    expect(segments(t.log, 'translation')).toEqual([{ origin: 'u1', text: 'Hello.', closed: true }]);
    expect(t.tts.spoken).toEqual([]);
    conformant(t.log, speaking);
  });

  it('a leg that speaks with no voice for its target says so once, naming the language (#619)', async () => {
    const t = await open(config({ ttsUnavailable: 'speaker_tts_missing' }), speaking);
    expect(t.calls).not.toContain('tts');
    expect(ofKind(t.log, 'degraded')).toEqual([{ code: 'speaker_tts_missing', message: 'Translation the other side hears is text only: no speech model speaks en.', params: { target: 'en' } }]);
    conformant(t.log, speaking);
    const quiet = await open(config({ ttsUnavailable: 'speaker_tts_missing' }), silent);
    expect(ofKind(quiet.log, 'degraded')).toEqual([]);
  });

  it('a transcription-only session says so once', async () => {
    const t = await open(config({ translation: null }));
    expect(t.calls).toEqual(['asr', 'turns']);
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'translation_unavailable' })]);
    conformant(t.log, silent);
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

  it("a translation's answer states all of it stable; a partial states none (#578 ruling 8)", async () => {
    const t = await open();
    t.asr.final('こんにちは');
    t.translation.stream('Hello.');
    t.translation.answer('Hello.');
    await settle();
    const translationRefs = new Set(ofKind(t.log, 'segmentOpened').filter((o) => o.side === 'translation').map((o) => o.ref));
    const texts = ofKind(t.log, 'segmentText').filter((e) => translationRefs.has(e.ref));
    expect(texts).toEqual([{ ref: expect.any(Number), text: 'Hello.' }, { ref: expect.any(Number), text: 'Hello.', stableLen: 6 }]);
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
    conformant(t.log, silent);
  });

  it('the leg\'s audio goes to the turn detector alone, and what comes back goes to the sidecar in order, marks between the samples', async () => {
    const t = await open();
    const input = new Int16Array([1, 2]);
    t.session.appendAudio(input);
    // The detector takes a copy: the runner reuses its array.
    expect(t.turns.fed).toEqual([new Int16Array([1, 2])]);
    expect(t.asr.fed).toEqual([]);
    t.turns.audio(new Int16Array([1]));
    t.turns.mark('start');
    t.turns.audio(new Int16Array([2]));
    t.turns.mark('end');
    t.turns.mark('cancel');
    expect(t.asr.fed).toEqual([new Int16Array([1]), new Int16Array([2])]);
    expect(t.asr.marks).toEqual(['start', 'end', 'cancel']);
    expect(t.asr.order).toEqual(['audio', 'start', 'audio', 'end', 'cancel']);
    conformant(t.log, silent);
  });

  it('a start mark is a Logs line; audio and marks after stop reach nothing', async () => {
    const t = await open();
    t.turns.mark('start');
    expect(ofKind(t.log, 'frame').map((f) => f.type)).toContain('local.native.speech_start');
    void t.session.stop();
    t.turns.audio(new Int16Array([3]));
    t.turns.mark('end');
    expect(t.asr.fed).toEqual([]);
    expect(t.asr.marks).toEqual(['start']);
  });

  it('a manual turn: the key down begins a press, the release drains the detector and flushes the sidecar only on its answer; a failed flush is only a frame', async () => {
    const t = await open(config(), { ...silent, turns: 'manual' });
    t.asr.flushResult = Promise.reject(new Error('flush timed out'));
    t.session.beginTurn();
    t.session.endTurn();
    expect(t.turns.begins).toEqual([1]);
    expect(t.turns.drains).toEqual([1]);
    // No 700 ms silent tail, and no flush yet: the detector has not delivered the end of the press.
    expect(t.asr.fed).toEqual([]);
    expect(t.asr.flushes).toBe(0);
    t.turns.mark('end');
    t.turns.drained();
    await settle();
    expect(t.asr.flushes).toBe(1);
    expect(ofKind(t.log, 'frame').map((f) => f.type)).toContain('local.native.asr.flush.error');
    expect(ofKind(t.log, 'failed')).toEqual([]);
    conformant(t.log, silent);
  });

  it('a drained answer with no release owing it flushes nothing, and two releases are two flushes', async () => {
    const t = await open(config(), { ...silent, turns: 'manual' });
    t.turns.drained();
    expect(t.asr.flushes).toBe(0);
    t.session.beginTurn(); t.session.endTurn();
    t.session.beginTurn(); t.session.endTurn();
    expect(t.turns.drains).toEqual([1, 2]);
    t.turns.drained();
    t.turns.drained();
    t.turns.drained();
    expect(t.asr.flushes).toBe(2);
  });

  it('a release with no press begun flushes the sidecar at once, with no drain', async () => {
    const t = await open(config(), { ...silent, turns: 'manual' });
    t.session.endTurn();
    expect(t.turns.drains).toEqual([]);
    expect(t.asr.flushes).toBe(1);
  });

  it('a Smart Turn connection that never answers starts the leg on Normal after the detector\'s wait', async () => {
    const fakes = createFakeNativeEngines();
    const engines: LocalNativeEngines = { ...fakes.engines, turn: () => new Promise(() => {}) };
    const smart = config({ vad: { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4, smartTurn: { checkAfter: 0.3, threshold: 0.5 } } });
    const clock = createVirtualClock();
    const starting = createLocalNativeAdapter(engines).start({ context: silent, config: smart, credentials: {}, clock, signal: new AbortController().signal }, recordConformance().events);
    fakes.asr.ready(); fakes.translation.ready();
    await settle();
    clock.advance(VAD_INIT_TIMEOUT_MS);
    await settle();
    fakes.turns.ready();
    await starting;
    expect(fakes.turns.inits[0].turnPort).toBeUndefined();
  });

  it('a cancelled press is a cancel for the detector, which ends in a cancel mark; the sidecar is not flushed', async () => {
    const t = await open(config(), { ...silent, turns: 'manual' });
    t.session.beginTurn();
    t.session.cancelTurn();
    expect(t.turns.cancels).toEqual([1]);
    expect(t.asr.flushes).toBe(0);
    expect(t.turns.drains).toEqual([]);
  });

  it('Smart Turn: a port is opened for an automatic leg that asked for it, and released at stop; manual turns open none', async () => {
    const fakes = createFakeNativeEngines();
    const released: string[] = [];
    const port = new MessageChannel().port1;
    const engines: LocalNativeEngines = { ...fakes.engines, turn: async () => ({ port, release: () => { released.push('released'); } }) as never };
    const smart = config({ vad: { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4, smartTurn: { checkAfter: 0.3, threshold: 0.5 } } });
    const recorder = recordConformance();
    const clock = createVirtualClock();
    const starting = createLocalNativeAdapter(engines).start({ context: silent, config: smart, credentials: {}, clock, signal: new AbortController().signal }, recorder.events);
    fakes.asr.ready(); fakes.translation.ready();
    await settle();
    fakes.turns.ready();
    const session = await starting;
    expect(fakes.turns.inits[0].turnPort).toBe(port);
    void session.stop();
    expect(released).toEqual(['released']);
    port.close();

    const manual = createFakeNativeEngines();
    const open2 = createLocalNativeAdapter({ ...manual.engines, turn: async () => ({ port, release: () => {} }) as never }).start(
      { context: { ...silent, turns: 'manual' }, config: smart, credentials: {}, clock: createVirtualClock(), signal: new AbortController().signal }, recordConformance().events);
    manual.asr.ready(); manual.translation.ready(); manual.turns.ready();
    await open2;
    expect(manual.turns.inits[0].turnPort).toBeUndefined();
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
    t.asr.ready(); t.translation.ready(); t.tts.ready({ streaming: true }); t.turns.ready();
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
    conformant(t.log, speaking);
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
    conformant(t.log, silent);
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
    conformant(t.log, speaking);
  });

  it('a TTS socket that closes while the voice is applied stops speech only, said once', async () => {
    let listed: (v: never[]) => void = () => {};
    const host = createFakeNativeHost({ listVoices: () => new Promise<never[]>((resolve) => { listed = resolve; }) });
    const t = begin(config({ tts: { ...TTS, voice: 'builtin:Bella' } }), speaking, host);
    t.asr.ready();
    t.translation.ready();
    t.tts.ready();
    t.turns.ready();
    await settle();
    t.tts.close('native host disconnected');
    listed([]);
    await t.starting;
    await settle();
    expect(ofKind(t.log, 'failed')).toEqual([]);
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded', message: 'Speech synthesis stopped: native host disconnected' })]);
    t.asr.final('こんにちは');
    t.translation.answer('Hello.');
    await settle();
    expect(t.tts.spoken).toEqual([]);
    expect(segments(t.log, 'translation')).toEqual([{ origin: 'u1', text: 'Hello.', closed: true }]);
    conformant(t.log, speaking);
  });

  it('a TTS that dies while a sentence is speaking ends that speech at once, and the next job still runs (#578 ruling 10)', async () => {
    const t = await open(config({ tts: TTS }), speaking);
    // The synthesis stays pending on close: only the session's own race can end the job.
    t.tts.rejectsOnDispose = false;
    t.asr.final('こんにちは');
    t.translation.answer('Hello.');
    await settle();
    expect(t.tts.spoken).toEqual(['Hello.']);
    t.asr.final('さようなら');
    t.tts.close();
    await settle();
    expect(t.translation.calls.map((c) => c.text)).toEqual(['こんにちは', 'さようなら']);
    t.translation.answer('Goodbye.');
    await settle();
    expect(segments(t.log, 'translation')).toEqual([
      { origin: 'u1', text: 'Hello.', closed: true },
      { origin: 'u2', text: 'Goodbye.', closed: true },
    ]);
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded' })]);
    expect(ofKind(t.log, 'audio')).toEqual([]);
    expect(t.tts.spoken).toEqual(['Hello.']);
    conformant(t.log, speaking);
  });

  it('a turn detector that fails after it is ready fails the session', async () => {
    const t = await open();
    t.turns.fail('segmenter died');
    expect(ofKind(t.log, 'failed')).toEqual([{ message: 'Turn detection stopped: segmenter died' }]);
    conformant(t.log, silent);
  });

  it('a turn detector that fails again after the session failed says nothing more', async () => {
    const t = await open();
    t.turns.fail('segmenter died');
    t.turns.fail('segmenter died again');
    t.asr.close();
    expect(ofKind(t.log, 'failed')).toEqual([{ message: 'Turn detection stopped: segmenter died' }]);
    conformant(t.log, silent);
  });

  it('stop ends every seam before its first await', async () => {
    const t = await open(config({ tts: TTS }), speaking);
    t.mark('stop');
    void t.session.stop();
    expect([t.asr.disposes, t.translation.disposes, t.tts.disposes, t.turns.disposes]).toEqual([1, 1, 1, 1]);
    conformant(t.log, speaking);
  });

  it('stop during a streaming sentence emits nothing after', async () => {
    const t = begin(config({ tts: TTS }), speaking);
    t.asr.ready(); t.translation.ready(); t.tts.ready({ streaming: true }); t.turns.ready();
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
