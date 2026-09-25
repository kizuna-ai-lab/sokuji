import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import { AdapterStartError, type AdapterSession, type Punctuator, type SessionContext } from '../../lib/contract/adapter';
import { checkConformance, recordConformance, type ConformanceLog } from '../../lib/contract/conformance';
import { eventsFrom, type AdapterEvent } from '../../lib/contract/events';
import { gateChars } from '../../lib/segmentation/SentenceStream';
import { DEFAULT_CHUNK_SENTENCES } from '../../lib/segmentation/segmentationMode';
import { createLocalInferenceAdapter } from './adapter';
import { createFakeEngines, type FakeAsr } from './fakeEngines';
import type { LocalInferenceConfig } from './config';

const auto: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: false, turns: 'auto' };

function makeConfig(over: Partial<LocalInferenceConfig> = {}): LocalInferenceConfig {
  return {
    asr: { modelId: 'asr-model', streaming: true },
    vad: { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4, maxSpeechDuration: 30 },
    translation: { kind: 'engine', modelId: 'mt-model', instructions: 'Translate ja to en.', wrapTranscript: true },
    ...over,
  };
}

const TTS = { modelId: 'tts-model', speakerId: 0, speed: 1 };

/** Lets every pending promise continuation run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Starts a session without settling any engine's `init`. */
function begin(
  config = makeConfig(),
  context = auto,
  signal = new AbortController().signal,
  punctuate?: (lang: string, text: string) => Promise<string | null>,
) {
  const fakes = createFakeEngines();
  const recorder = recordConformance();
  const clock = createVirtualClock();
  const starting = createLocalInferenceAdapter(fakes.engines).start(
    { context, config, credentials: {}, clock, signal, punctuate },
    recorder.events,
  );
  return { ...fakes, ...recorder, starting, context, clock };
}

/** Starts a session and settles every engine it created. */
async function open(
  config = makeConfig(),
  context = auto,
  punctuate?: (lang: string, text: string) => Promise<string | null>,
) {
  const t = begin(config, context, undefined, punctuate);
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

/** Each segment of one side as it stands: its origin, its latest text, and whether it has closed. */
function segments(log: ConformanceLog, side: 'source' | 'translation') {
  const bySide = new Map<number, { origin?: string; text: string; closed: boolean }>();
  for (const e of events(log)) {
    if (e.kind === 'segmentOpened' && e.payload.side === side) {
      bySide.set(e.payload.ref, { origin: e.payload.origin, text: '', closed: false });
    } else if (e.kind === 'segmentText') {
      const segment = bySide.get(e.payload.ref);
      if (segment) segment.text = e.payload.text;
    } else if (e.kind === 'segmentClosed') {
      const segment = bySide.get(e.payload.ref);
      if (segment) segment.closed = true;
    }
  }
  return [...bySide.values()];
}

/** The `local.segmentation.seal` frames, whole. */
const sealFrames = (log: ConformanceLog) => ofKind(log, 'frame').filter((f) => f.type === 'local.segmentation.seal');

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

  it('hands the engine a copy of the audio at 24 kHz: the array passed in is still readable', async () => {
    const t = await open();
    const pcm = new Int16Array([1, 2, 3]);
    t.session.appendAudio(pcm);
    expect(Array.from(pcm)).toEqual([1, 2, 3]);
    expect(t.asr.fed.map((a) => Array.from(a))).toEqual([[1, 2, 3]]);
    expect(t.asr.rates).toEqual([24000]);
    expectConformant(t.log, t.context);
  });

  it('sends no second segmentText when the final equals the last partial', async () => {
    const t = await open();
    t.asr.partial('はい');
    t.asr.final(' はい ');
    expect(content(t.log)).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'はい' } },
      { kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } },
    ]);
    expect(t.translation.calls.map((c) => c.text)).toEqual(['はい']);
    expectConformant(t.log, t.context);
  });

  it('reports itself as local', async () => {
    const t = await open();
    expect(t.session.info).toEqual({ transport: 'local' });
    expectConformant(t.log, t.context);
  });
});

describe('the LocalInference adapter — turns', () => {
  it('endTurn feeds seven 2400-sample silences at 24 kHz, then flushes', async () => {
    const t = await open();
    t.session.endTurn();
    expect(t.asr.fed).toHaveLength(7);
    expect(t.asr.fed.every((a) => a.length === 2400 && a.every((v) => v === 0))).toBe(true);
    expect(t.asr.rates).toEqual(new Array(7).fill(24000));
    expect(t.asr.flushes).toBe(1);
    expectConformant(t.log, t.context);
  });

  it('cancelTurn does the same as endTurn: no worker can discard a VAD segment or acknowledge a flush', async () => {
    const t = await open();
    t.session.cancelTurn();
    expect(t.asr.fed).toHaveLength(7);
    expect(t.asr.fed.every((a) => a.length === 2400 && a.every((v) => v === 0))).toBe(true);
    expect(t.asr.rates).toEqual(new Array(7).fill(24000));
    expect(t.asr.flushes).toBe(1);
    expectConformant(t.log, t.context);
  });

  it('beginTurn feeds nothing', async () => {
    const t = await open();
    t.session.beginTurn();
    expect(t.asr.fed).toEqual([]);
    expect(t.asr.flushes).toBe(0);
    expectConformant(t.log, t.context);
  });
});

describe('the LocalInference adapter — typed text', () => {
  it('appendText answers typed text with a source segment holding exactly the typed string, then its translation of the trimmed text', async () => {
    const t = await open();
    t.mark('appendText', '  hi  ');
    t.session.appendText('  hi  ');
    expect(t.translation.calls.map((c) => c.text)).toEqual(['hi']);
    t.translation.answer('Hi.');
    await settle();
    expect(content(t.log)).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 1, text: '  hi  ' } },
      { kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } },
      { kind: 'segmentOpened', payload: { ref: 2, side: 'translation', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 2, text: 'Hi.' } },
      { kind: 'segmentClosed', payload: { ref: 2, origin: 'u1' } },
    ]);
    expectConformant(t.log, t.context);
  });

  it('ignores typed text that is blank once trimmed: no segment, no job', async () => {
    const t = await open();
    // No appendText marker: blank text is not text the contract answers (Run.sendText drops it too).
    t.session.appendText('');
    t.session.appendText('  \n ');
    await settle();
    expect(content(t.log)).toEqual([]);
    expect(t.translation.calls).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('an AST session answers typed text with its source segment only, and says once that typed text is not translated', async () => {
    const t = await open(makeConfig({ asr: { modelId: 'granite', streaming: false }, translation: { kind: 'ast' } }));
    expect(ofKind(t.log, 'degraded')).toEqual([]); // its speech is translated: nothing to say at the start
    t.mark('appendText', 'hi');
    t.session.appendText('hi');
    t.mark('appendText', 'there');
    t.session.appendText('there');
    await settle();
    expect(content(t.log)).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'hi' } },
      { kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } },
      { kind: 'segmentOpened', payload: { ref: 2, side: 'source', origin: 'u2' } },
      { kind: 'segmentText', payload: { ref: 2, text: 'there' } },
      { kind: 'segmentClosed', payload: { ref: 2, origin: 'u2' } },
    ]);
    expect(ofKind(t.log, 'degraded')).toEqual([{
      code: 'translation_unavailable',
      message: 'Typed text cannot be translated in a speech-translation session — shown as typed.',
    }]);
    expect(t.translation.calls).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('a transcription-only session answers appendText with a source segment only, sharing the start notice', async () => {
    const t = begin(makeConfig({ translation: { kind: 'none' } }));
    t.asr.ready();
    const session = await t.starting;
    expect(ofKind(t.log, 'degraded').map((d) => d.code)).toEqual(['translation_unavailable']);
    t.mark('appendText', 'hi');
    session.appendText('hi');
    await settle();
    expect(content(t.log)).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'hi' } },
      { kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } },
    ]);
    expect(ofKind(t.log, 'degraded').map((d) => d.code)).toEqual(['translation_unavailable']);
    t.mark('stop');
    await session.stop();
    expectConformant(t.log, t.context);
  });
});

describe('the LocalInference adapter — punctuated jobs', () => {
  /** Auto's length gate for the session's source language (ja): today's `punctuateDefinite` under Auto. */
  const GATE = gateChars('ja', DEFAULT_CHUNK_SENTENCES);
  /** A job text exactly at the gate, with no sentence end: punctuated. */
  const AT_GATE = 'x'.repeat(GATE);

  it("sends the punctuator's answer to the translation engine when jobSentences is set and it answers", async () => {
    const punctuate = async (lang: string, text: string) => {
      expect(lang).toBe('ja');
      return text === AT_GATE ? `${AT_GATE}.` : null;
    };
    const t = await open(makeConfig({ jobSentences: 0 }), auto, punctuate);
    t.asr.final(AT_GATE);
    await settle();
    expect(t.translation.calls.map((c) => c.text)).toEqual([`${AT_GATE}.`]);
    t.translation.answer('Konnichiwa.');
    await settle();
    expectConformant(t.log, t.context);
  });

  it('sends a text shorter than the gate raw, without asking the punctuator', async () => {
    const asked: string[] = [];
    const punctuate = async (_lang: string, text: string) => { asked.push(text); return `${text}.`; };
    const t = await open(makeConfig({ jobSentences: 0 }), auto, punctuate);
    const short = 'x'.repeat(GATE - 1);
    t.asr.final(short);
    await settle();
    expect(asked).toEqual([]);
    expect(t.translation.calls.map((c) => c.text)).toEqual([short]);
    expectConformant(t.log, t.context);
  });

  it('sends the raw text when jobSentences is set but no punctuator is installed', async () => {
    const t = await open(makeConfig({ jobSentences: 0 }));
    t.asr.final(AT_GATE);
    await settle();
    expect(t.translation.calls.map((c) => c.text)).toEqual([AT_GATE]);
    expectConformant(t.log, t.context);
  });

  it('sends the raw text once jobSentences is absent, even with a punctuator installed', async () => {
    const punctuate = async () => 'should never be used';
    const t = await open(makeConfig(), auto, punctuate);
    t.asr.final(AT_GATE);
    await settle();
    expect(t.translation.calls.map((c) => c.text)).toEqual([AT_GATE]);
    expectConformant(t.log, t.context);
  });

  it('sends the raw text after a 1 s budget on the virtual clock when the punctuator never answers', async () => {
    const neverAnswers = () => new Promise<string | null>(() => {});
    const t = await open(makeConfig({ jobSentences: 0 }), auto, neverAnswers);
    t.asr.final(AT_GATE);
    await settle();
    expect(t.translation.calls).toEqual([]); // still waiting on the budget
    t.clock.advance(1000);
    await settle();
    expect(t.translation.calls.map((c) => c.text)).toEqual([AT_GATE]);
    expectConformant(t.log, t.context);
  });

  it('a punctuation answer that lands after stop() emits nothing', async () => {
    let answer: (text: string | null) => void = () => {};
    const held = () => new Promise<string | null>((resolve) => { answer = resolve; });
    const t = await open(makeConfig({ jobSentences: 0 }), auto, held);
    t.asr.final(AT_GATE);
    await settle();
    t.mark('stop');
    await t.session.stop();
    const before = t.log.length;
    answer(`${AT_GATE}.`);
    await settle();
    expect(t.log.length).toBe(before);
    expect(t.translation.calls).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('fills typed text (appendText) the same way as a final, under jobSentences', async () => {
    const punctuate = async (_lang: string, text: string) => `${text}.`;
    const t = await open(makeConfig({ jobSentences: 0 }), auto, punctuate);
    t.mark('appendText', AT_GATE);
    t.session.appendText(AT_GATE);
    await settle();
    expect(t.translation.calls.map((c) => c.text)).toEqual([`${AT_GATE}.`]);
    t.translation.answer('Konnichiwa.');
    await settle();
    expectConformant(t.log, t.context);
  });
});

describe('the LocalInference adapter — sentence-cut jobs (the stream shape)', () => {
  /** The cut's cases are English: its gates and the casing rule read the source language. */
  const en: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: false, turns: 'auto' };
  /** The rule path: the ASR's own marks seal; the model answers nothing. */
  const noAnswer: Punctuator = async () => null;
  /** The stream shape (ruling 1): an engine translation and a size of 1–5 — with a punctuator. */
  const streamConfig = (over: Partial<LocalInferenceConfig> = {}) => makeConfig({ jobSentences: 1, ...over });

  const P1 = 'Sentence one is done. Sentence two begins';
  const P2 = 'Sentence one is done. Sentence two begins now yes. Sentence three starts';
  const P3 = 'Sentence one is done. Sentence two begins now yes. Sentence three starts and ends well. Tail padding here';

  it('runs the stream shape with the worker\'s own sentence endpoint off: exactly one layer cuts', async () => {
    const t = await open(streamConfig(), en, noAnswer);
    expect(t.asr.inits[0].options.punctuationEndpoint).toBe(false);
    expectConformant(t.log, t.context);
  });

  it.each<[string, LocalInferenceConfig, Punctuator | undefined]>([
    ['Auto (jobSentences 0)', makeConfig({ jobSentences: 0 }), noAnswer],
    ['a display not by sentences (jobSentences absent)', makeConfig(), noAnswer],
    ['no punctuator', streamConfig(), undefined],
    ['transcription-only', streamConfig({ translation: { kind: 'none' } }), noAnswer],
  ])('%s: the endpoint stays on, and partials grow one cumulative source segment per utterance', async (_name, config, punctuate) => {
    const t = await open(config, en, punctuate);
    expect(t.asr.inits[0].options.punctuationEndpoint).toBe(true);
    t.asr.partial(P1);
    t.asr.partial(P2);
    expect(content(t.log)).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 1, text: P1 } },
      { kind: 'segmentText', payload: { ref: 1, text: P2 } },
    ]);
    expect(t.translation.calls).toEqual([]);
    expect(sealFrames(t.log)).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('AST: the endpoint stays on, and partials open nothing', async () => {
    const t = await open(streamConfig({ asr: { modelId: 'granite', streaming: false }, translation: { kind: 'ast' } }), en, noAnswer);
    expect(t.asr.inits[0].options.punctuationEndpoint).toBe(true);
    t.asr.partial(P1);
    t.asr.partial(P2);
    expect(content(t.log)).toEqual([]);
    expect(sealFrames(t.log)).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('one source segment and one origin per job: a seal closes the open segment with its text and queues its job; the tail opens the next', async () => {
    const t = await open(streamConfig(), en, noAnswer);
    t.asr.partial(P1);
    expect(t.translation.calls.map((c) => c.text)).toEqual(['Sentence one is done.']); // queued at the seal, before the next partial
    t.asr.partial(P2);
    t.asr.partial(P3);
    expect(segments(t.log, 'source')).toEqual([
      { origin: 'u1', text: 'Sentence one is done.', closed: true },
      { origin: 'u2', text: 'Sentence two begins now yes.', closed: true },
      { origin: 'u3', text: 'Sentence three starts and ends well.', closed: true },
      { origin: 'u4', text: 'Tail padding here', closed: false },
    ]);
    t.translation.answer('One.');
    await settle();
    t.translation.answer('Two.');
    await settle();
    t.translation.answer('Three.');
    await settle();
    expect(t.translation.calls.map((c) => c.text)).toEqual([
      'Sentence one is done.',
      'Sentence two begins now yes.',
      'Sentence three starts and ends well.',
    ]);
    expect(segments(t.log, 'translation')).toEqual([
      { origin: 'u1', text: 'One.', closed: true },
      { origin: 'u2', text: 'Two.', closed: true },
      { origin: 'u3', text: 'Three.', closed: true },
    ]);

    t.asr.final(`${P3}.`);
    expect(segments(t.log, 'source')).toEqual([
      { origin: 'u1', text: 'Sentence one is done.', closed: true },
      { origin: 'u2', text: 'Sentence two begins now yes.', closed: true },
      { origin: 'u3', text: 'Sentence three starts and ends well.', closed: true },
      { origin: 'u4', text: 'Tail padding here.', closed: true },
    ]);
    expect(last(t.translation.calls)?.text).toBe('Tail padding here.');
    t.translation.answer('Four.');
    await settle();
    expect(last(segments(t.log, 'translation'))).toEqual({ origin: 'u4', text: 'Four.', closed: true });
    expectConformant(t.log, t.context);
  });

  it('an offline final (no partials) at N=3: two source segments and two jobs, distinct origins', async () => {
    const t = await open(streamConfig({ asr: { modelId: 'whisper', streaming: false }, jobSentences: 3 }), en, noAnswer);
    t.asr.final('One is done. Two is done. Three is done. Four is done. Five is done. Six is done and finished well.');
    expect(segments(t.log, 'source')).toEqual([
      { origin: 'u1', text: 'One is done. Two is done. Three is done.', closed: true },
      { origin: 'u2', text: 'Four is done. Five is done. Six is done and finished well.', closed: true },
    ]);
    t.translation.answer('First half.');
    await settle();
    t.translation.answer('Second half.');
    await settle();
    expect(t.translation.calls.map((c) => c.text)).toEqual([
      'One is done. Two is done. Three is done.',
      'Four is done. Five is done. Six is done and finished well.',
    ]);
    expect(segments(t.log, 'translation').map((s) => s.origin)).toEqual(['u1', 'u2']);
    expectConformant(t.log, t.context);
  });

  it('a truncated re-decode of what was sealed queues nothing more: the open segment closes as it stands, untranslated', async () => {
    const t = await open(streamConfig(), en, noAnswer);
    t.asr.partial('First sentence done. Second begins');
    t.asr.final('First sentence done.');
    t.translation.answer('Premier.');
    await settle();
    expect(t.translation.calls.map((c) => c.text)).toEqual(['First sentence done.']);
    expect(segments(t.log, 'source')).toEqual([
      { origin: 'u1', text: 'First sentence done.', closed: true },
      { origin: 'u2', text: 'Second begins', closed: true },
    ]);
    expect(segments(t.log, 'translation').map((s) => s.origin)).toEqual(['u1']);
    expectConformant(t.log, t.context);
  });

  it('never fills a seal in: a sentences chunk and the end tail reach the engine exactly as sealed', async () => {
    // Capitalised, so the period before it ends a sentence; unmarked, and past
    // Auto's length gate, so a fill-in would add a period to it.
    const TAIL = 'And then we walked along the river for a long while talking about nothing in particular until the sun went down behind the hills and the air turned cold around us';
    expect(TAIL.length).toBeGreaterThanOrEqual(160);
    expect(TAIL.length).toBeGreaterThan(gateChars('en', DEFAULT_CHUNK_SENTENCES));
    const endsWithPeriod: Punctuator = async (_lang, text) => (text.endsWith('.') ? text : `${text}.`);
    const t = await open(streamConfig({ asr: { modelId: 'whisper', streaming: false } }), en, endsWithPeriod);
    t.asr.final(`Sentence one is done. ${TAIL}`);
    t.translation.answer('Un.');
    await settle();
    t.translation.answer('Deux.');
    await settle();
    expect(t.translation.calls.map((c) => c.text)).toEqual(['Sentence one is done.', TAIL]);
    expect(sealFrames(t.log).map((f) => (f.payload as { reason: string }).reason)).toEqual(['sentences', 'end']);
    expectConformant(t.log, t.context);
  });

  it('a seal without a letter or digit queues nothing, and closes the segment it was showing', async () => {
    const t = await open(streamConfig(), en, noAnswer);
    t.asr.partial('Sentence one is done. Sentence two begins');
    t.asr.final('Sentence one is done. (');
    t.translation.answer('Un.');
    await settle();
    expect(t.translation.calls.map((c) => c.text)).toEqual(['Sentence one is done.']);
    expect(segments(t.log, 'source').map((s) => s.closed)).toEqual([true, true]);
    expect(segments(t.log, 'translation').map((s) => s.origin)).toEqual(['u1']);
    expectConformant(t.log, t.context);
  });

  it.each<[string, (asr: FakeAsr) => void]>([
    ['an ASR error', (asr) => asr.fail('decode failed')],
    ['an empty final', (asr) => asr.final('')],
  ])('after %s, the next utterance seals from a clean cursor: its first job holds its first sentence whole', async (_name, interrupt) => {
    const t = await open(streamConfig(), en, noAnswer);
    t.asr.partial('Sentence one is done. Sentence two begins');
    interrupt(t.asr);
    t.asr.partial('Brand new words start here. And they keep going');
    t.translation.answer('Un.');
    await settle();
    expect(t.translation.calls.map((c) => c.text)).toEqual(['Sentence one is done.', 'Brand new words start here.']);
    expect(segments(t.log, 'source')).toEqual([
      { origin: 'u1', text: 'Sentence one is done.', closed: true },
      { origin: 'u2', text: 'Sentence two begins', closed: true },
      { origin: 'u3', text: 'Brand new words start here.', closed: true },
      { origin: 'u4', text: 'And they keep going', closed: false },
    ]);
    expectConformant(t.log, t.context);
  });

  it('stop() with a model call in flight: its late answer emits nothing', async () => {
    const UNMARKED = 'the quick brown fox jumps over the lazy dog and then keeps running far away';
    const asked: string[] = [];
    let answer: (text: string | null) => void = () => {};
    const held: Punctuator = (_lang, text) => {
      asked.push(text);
      return new Promise((resolve) => { answer = resolve; });
    };
    const t = await open(streamConfig(), en, held);
    t.asr.partial(UNMARKED);
    expect(asked).toEqual([UNMARKED]); // no mark, past the gate: the model was asked
    t.mark('stop');
    await t.session.stop();
    const before = t.log.length;
    answer(UNMARKED.replace('dog and', 'dog. And')); // an answer that would seal
    await settle();
    expect(t.log.length).toBe(before);
    expect(t.translation.calls).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('typed text stays one job: one source segment with exactly the typed text, one translation', async () => {
    const t = await open(streamConfig(), en, noAnswer);
    const typed = 'Hello there. How are you doing today?';
    t.mark('appendText', typed);
    t.session.appendText(typed);
    await settle();
    expect(t.translation.calls.map((c) => c.text)).toEqual([typed]);
    t.translation.answer('こんにちは。お元気ですか？');
    await settle();
    expect(content(t.log)).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 1, text: typed } },
      { kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } },
      { kind: 'segmentOpened', payload: { ref: 2, side: 'translation', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 2, text: 'こんにちは。お元気ですか？' } },
      { kind: 'segmentClosed', payload: { ref: 2, origin: 'u1' } },
    ]);
    expect(sealFrames(t.log)).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('says each seal in a frame: its reason and its text', async () => {
    const t = await open(streamConfig(), en, noAnswer);
    t.asr.partial(P1);
    t.asr.partial(P2);
    t.asr.partial(P3);
    t.asr.final(`${P3}.`);
    expect(sealFrames(t.log)).toEqual([
      { direction: 'out', type: 'local.segmentation.seal', payload: { reason: 'sentences', text: 'Sentence one is done.' } },
      { direction: 'out', type: 'local.segmentation.seal', payload: { reason: 'sentences', text: 'Sentence two begins now yes.' } },
      { direction: 'out', type: 'local.segmentation.seal', payload: { reason: 'sentences', text: 'Sentence three starts and ends well.' } },
      { direction: 'out', type: 'local.segmentation.seal', payload: { reason: 'end', text: 'Tail padding here.' } },
    ]);
    expectConformant(t.log, t.context);
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
    expectConformant(t.log, t.context);
  });

  it('inits ASR with its VAD config and the source language, and translation with the pair and model', async () => {
    const config = makeConfig();
    const t = await open(config);
    expect(t.asr.config).toEqual(config.asr);
    expect(t.asr.inits).toEqual([{ modelId: 'asr-model', options: { vadConfig: config.vad, language: 'ja', punctuationEndpoint: true } }]);
    expect(t.translation.inits).toEqual([{ sourceLang: 'ja', targetLang: 'en', modelId: 'mt-model' }]);
    expectConformant(t.log, t.context);
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
    expect(t.log).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('an ASR init that runs out of GPU memory rejects with gpu_out_of_memory, after disposing everything', async () => {
    const t = begin(makeConfig({ tts: TTS }), { ...auto, speech: true });
    t.asr.failInit('Error: OrtRun failed: OUT_OF_DEVICE_MEMORY');
    const failure = await t.starting.catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AdapterStartError);
    expect((failure as AdapterStartError).code).toBe('gpu_out_of_memory');
    // The engine's own error rides along: which model or stage failed survives past the sentence.
    expect((failure as AdapterStartError).cause).toEqual(new Error('Error: OrtRun failed: OUT_OF_DEVICE_MEMORY'));
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
    expectConformant(t.log, t.context);
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

  it('the TTS worker dying while other engines still load degrades too: the start resolves, and the notice is said once after it', async () => {
    const t = begin(makeConfig({ tts: TTS }), { ...auto, speech: true });
    t.tts.ready();
    await settle();
    t.tts.die('tts worker crashed');
    expect(ofKind(t.log, 'degraded')).toEqual([]); // held while the start is pending
    t.asr.ready();
    t.translation.ready();
    await t.starting;
    await settle();
    expect(ofKind(t.log, 'degraded')).toEqual([
      expect.objectContaining({ code: 'tts_degraded', message: expect.stringContaining('tts worker crashed') }),
    ]);
    const kinds = events(t.log).map((e) => (e.kind === 'frame' ? e.payload.type : e.kind));
    expect(kinds.indexOf('degraded')).toBeGreaterThan(kinds.indexOf('local.session.opened'));
    expect(ofKind(t.log, 'failed')).toEqual([]);
    expect(t.tts.disposes).toBe(1);
    t.asr.final('一');
    t.translation.answer('One.');
    await settle();
    expect(t.tts.generateCalls).toEqual([]);
    expect(ofKind(t.log, 'audio')).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('a lost GPU device on the TTS worker while opening still rejects the start', async () => {
    const t = begin(makeConfig({ tts: TTS }), { ...auto, speech: true });
    t.tts.ready();
    await settle();
    t.tts.die('WebGPU device lost: the GPU was reset');
    await expect(t.starting).rejects.toThrow('device lost');
    expect([t.asr.disposes, t.translation.disposes, t.tts.disposes]).toEqual([1, 1, 1]);
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
    expectConformant(t.log, t.context);
  });

  it('a speaker id the TTS model did not load says voice_fallback', async () => {
    const t = begin(makeConfig({ tts: { ...TTS, speakerId: 7 } }), { ...auto, speech: true });
    t.asr.ready();
    t.translation.ready();
    t.tts.ready({ sampleRate: 44100, voices: [{ sid: 0 }, { sid: 1 }] });
    await t.starting;
    expect(ofKind(t.log, 'degraded').map((d) => d.code)).toEqual(['voice_fallback']);
    expectConformant(t.log, t.context);
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

  it("an ordinary ASR error first closes the utterance's open segment with its last text, so the next utterance opens its own", async () => {
    const t = await open();
    t.asr.partial('途中');
    t.asr.fail('decode failed');
    t.asr.partial('次');
    t.asr.final('次の話');
    t.translation.answer('Next.');
    await settle();
    expect(content(t.log)).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 1, text: '途中' } },
      { kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } },
      { kind: 'segmentOpened', payload: { ref: 2, side: 'source', origin: 'u2' } },
      { kind: 'segmentText', payload: { ref: 2, text: '次' } },
      { kind: 'segmentText', payload: { ref: 2, text: '次の話' } },
      { kind: 'segmentClosed', payload: { ref: 2, origin: 'u2' } },
      { kind: 'segmentOpened', payload: { ref: 3, side: 'translation', origin: 'u2' } },
      { kind: 'segmentText', payload: { ref: 3, text: 'Next.' } },
      { kind: 'segmentClosed', payload: { ref: 3, origin: 'u2' } },
    ]);
    const kinds = events(t.log).map((e) => e.kind);
    expect(kinds.indexOf('degraded')).toBeGreaterThan(kinds.indexOf('segmentClosed'));
    expect(t.translation.calls.map((c) => c.text)).toEqual(['次の話']); // the abandoned utterance is not translated
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

  it('the TTS worker dying degrades to no speech: one tts_degraded, and later jobs translate without audio', async () => {
    const t = await open(makeConfig({ tts: TTS }), { ...auto, speech: true });
    t.tts.samplesPerSentence = 480;
    t.tts.die('tts worker crashed');
    expect(ofKind(t.log, 'degraded')).toEqual([
      expect.objectContaining({ code: 'tts_degraded', message: 'Speech synthesis stopped: tts worker crashed' }),
    ]);
    expect(t.tts.disposes).toBe(1);
    t.asr.final('一');
    t.translation.answer('One.');
    await settle();
    t.asr.final('二');
    t.translation.answer('Two.');
    await settle();
    expect(ofKind(t.log, 'segmentOpened').map((p) => p.side)).toEqual(['source', 'translation', 'source', 'translation']);
    expect(ofKind(t.log, 'segmentClosed')).toHaveLength(4);
    expect(t.tts.generateCalls).toEqual([]);
    expect(ofKind(t.log, 'audio')).toEqual([]);
    expect(ofKind(t.log, 'degraded').map((d) => d.code)).toEqual(['tts_degraded']);
    expect(ofKind(t.log, 'failed')).toEqual([]);
    t.mark('stop');
    await t.session.stop();
    expect(t.tts.disposes).toBe(1); // not disposed twice
    expectConformant(t.log, t.context);
  });

  it('the TTS worker dying mid-sentence ends that job cleanly: its segment closes, no second notice, the next job runs', async () => {
    const t = await open(makeConfig({ tts: TTS }), { ...auto, speech: true });
    t.tts.holdGenerate = true;
    t.asr.final('一');
    t.translation.answer('One. Two.');
    await settle();
    expect(t.tts.generateCalls.map((c) => c.text)).toEqual(['One.']); // still synthesizing
    t.tts.die('tts worker crashed');
    await settle();
    expect(t.tts.generateCalls.map((c) => c.text)).toEqual(['One.']); // 'Two.' never asked for
    expect(ofKind(t.log, 'segmentClosed').map((p) => p.ref)).toEqual([1, 2]);
    expect(ofKind(t.log, 'degraded').map((d) => d.code)).toEqual(['tts_degraded']);
    t.asr.final('二');
    t.translation.answer('Two.');
    await settle();
    expect(last(ofKind(t.log, 'segmentClosed'))).toEqual({ ref: 4, origin: 'u2' });
    expect(ofKind(t.log, 'audio')).toEqual([]);
    expect(ofKind(t.log, 'failed')).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('a TTS death whose held sentence never settles still ends the job at once, and the late answer emits nothing', async () => {
    const t = await open(makeConfig({ tts: TTS }), { ...auto, speech: true });
    t.tts.samplesPerSentence = 480;
    t.tts.holdGenerate = true;
    t.tts.holdPastDeath = true; // as Edge TTS's decode handshake: nothing rejects it
    t.asr.final('一');
    t.translation.answer('One. Two.');
    await settle();
    expect(t.tts.generateCalls.map((c) => c.text)).toEqual(['One.']);
    t.tts.die('tts worker crashed');
    await settle();
    expect(ofKind(t.log, 'segmentClosed').map((p) => p.ref)).toEqual([1, 2]); // the job ended at once
    t.asr.final('二');
    t.translation.answer('Two.');
    await settle();
    expect(last(ofKind(t.log, 'segmentClosed'))).toEqual({ ref: 4, origin: 'u2' });
    const before = t.log.length;
    t.tts.release(); // the abandoned synthesis answers late
    await settle();
    expect(t.log.length).toBe(before);
    expect(ofKind(t.log, 'audio')).toEqual([]);
    expect(t.tts.generateCalls.map((c) => c.text)).toEqual(['One.']);
    expect(ofKind(t.log, 'degraded').map((d) => d.code)).toEqual(['tts_degraded']);
    expect(ofKind(t.log, 'failed')).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('a lost GPU device on the TTS worker still fails the session', async () => {
    const t = await open(makeConfig({ tts: TTS }), { ...auto, speech: true });
    t.tts.die('WebGPU device lost: the GPU was reset');
    expect(ofKind(t.log, 'failed')).toEqual([expect.objectContaining({ message: expect.stringContaining('device lost') })]);
    expect(ofKind(t.log, 'degraded')).toEqual([]);
    expectConformant(t.log, t.context);
  });
});

describe('the LocalInference adapter — speech', () => {
  it("speaks the translation's sentences before closing its segment, each with its exact range", async () => {
    const t = await open(makeConfig({ tts: TTS }), { ...auto, speech: true });
    t.tts.samplesPerSentence = 480;
    t.asr.final('一');
    t.translation.answer('One. Two.');
    await settle();

    const kinds = events(t.log).map((e) => e.kind);
    const translationClosed = kinds.lastIndexOf('segmentClosed');
    const audioIndices = kinds.reduce<number[]>((acc, k, i) => (k === 'audio' ? [...acc, i] : acc), []);
    expect(audioIndices).toHaveLength(2);
    expect(audioIndices.every((i) => i < translationClosed)).toBe(true);

    const clips = ofKind(t.log, 'audio');
    expect(clips.map((c) => c.range)).toEqual([[0, 4], [5, 9]]);
    expect(clips.every((c) => c.ref === 2)).toBe(true);
    expect(clips.every((c) => c.pcm instanceof Int16Array)).toBe(true);
    expectConformant(t.log, t.context);
  });

  it("reports today's local.tts.* frames for the spoken translation, wired through to the adapter's own frame()", async () => {
    const t = await open(makeConfig({ tts: TTS }), { ...auto, speech: true });
    t.tts.samplesPerSentence = 480;
    t.asr.final('一');
    t.translation.answer('One.');
    await settle();
    const ttsFrames = ofKind(t.log, 'frame').filter((f) => f.type.startsWith('local.tts.'));
    expect(ttsFrames.map((f) => f.type)).toEqual(['local.tts.start', 'local.tts.sentence.start', 'local.tts.sentence.end', 'local.tts.end']);
    expect(ttsFrames.map((f) => f.direction)).toEqual(['out', 'out', 'in', 'in']);
    expectConformant(t.log, t.context);
  });

  it('emits no audio when the leg does not speak, even with TTS configured (the conformance rule)', async () => {
    const t = await open(makeConfig({ tts: TTS }), { ...auto, speech: false });
    t.tts.samplesPerSentence = 480;
    t.asr.final('一');
    t.translation.answer('One.');
    await settle();
    expect(ofKind(t.log, 'audio')).toEqual([]);
    expectConformant(t.log, t.context);
  });

  it('without TTS, the translation segment closes at once', async () => {
    const t = await open();
    t.asr.final('一');
    t.translation.answer('One.');
    await settle();
    expect(ofKind(t.log, 'audio')).toEqual([]);
    expect(ofKind(t.log, 'segmentClosed')).toHaveLength(2);
    expectConformant(t.log, t.context);
  });
});

describe('the LocalInference adapter — the queue never wedges', () => {
  it('an event handler that throws costs its job only: its segment closes, a frame says why, and the next job runs', async () => {
    const fakes = createFakeEngines();
    const log: ConformanceLog = [];
    let thrown = false;
    const events = eventsFrom((e) => {
      log.push(e);
      if (!thrown && e.kind === 'segmentText' && e.payload.ref === 2) {
        thrown = true;
        throw new Error('a consumer threw');
      }
    });
    const starting = createLocalInferenceAdapter(fakes.engines).start(
      { context: auto, config: makeConfig(), credentials: {}, clock: createVirtualClock(), signal: new AbortController().signal },
      events,
    );
    fakes.asr.ready();
    fakes.translation.ready();
    await starting;
    fakes.asr.final('一');
    fakes.translation.answer('One.');
    await settle();
    fakes.asr.final('二');
    expect(fakes.translation.calls.map((c) => c.text)).toEqual(['一', '二']);
    fakes.translation.answer('Two.');
    await settle();
    expect(ofKind(log, 'segmentClosed').map((p) => p.ref)).toEqual([1, 2, 3, 4]);
    expect(ofKind(log, 'frame').filter((f) => f.type === 'local.pipeline.error')).toEqual([
      expect.objectContaining({ direction: 'in', payload: { error: 'a consumer threw' } }),
    ]);
    expect(last(ofKind(log, 'segmentText'))).toEqual({ ref: 4, text: 'Two.' });
    expectConformant(log, auto);
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

  it('endTurn, cancelTurn and appendText after stop() emit nothing and feed nothing', async () => {
    const t = await open();
    t.mark('stop');
    await t.session.stop();
    const before = t.log.length;
    t.session.endTurn();
    t.session.cancelTurn();
    t.session.appendText('late');
    await settle();
    expect(t.log.length).toBe(before);
    expect(t.asr.fed).toEqual([]);
    expect(t.asr.flushes).toBe(0);
    expect(t.translation.calls).toEqual([]);
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
