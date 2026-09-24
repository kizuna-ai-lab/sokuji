import { describe, it, expect } from 'vitest';
import type { TextRange } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { locateSentence, speakTranslation } from './speech';
import { FakeTts } from './fakeEngines';
import type { LocalInferenceConfig } from './config';

type TtsConfig = NonNullable<LocalInferenceConfig['tts']>;

interface RunOptions {
  rate?: number;
  samplesPerSentence?: number;
  edge?: boolean;
  chunksPerSentence?: number;
  samplesPerChunk?: number;
  failSentence?: number;
  /** Ends the session after this many sentences have been spoken. */
  endAfter?: number;
}

interface Frame { direction: 'in' | 'out'; type: string; payload: Record<string, unknown> }

/** Runs `speakTranslation` over a fresh `FakeTts` configured per `opts`, recording every clip, degradation and frame. */
async function run(text: string, opts: RunOptions = {}) {
  const tts = new FakeTts();
  tts.rate = opts.rate ?? 24000;
  tts.samplesPerSentence = opts.samplesPerSentence ?? 0;
  tts.chunksPerSentence = opts.chunksPerSentence ?? 0;
  tts.samplesPerChunk = opts.samplesPerChunk ?? 0;
  if (opts.failSentence !== undefined) tts.failOn.add(opts.failSentence);

  const config: TtsConfig = {
    modelId: opts.edge ? 'edge-tts' : 'fake-tts-model',
    speakerId: 0,
    speed: 1,
    edgeVoice: opts.edge ? 'en-US-AriaNeural' : undefined,
  };

  const clips: Array<{ pcm: Int16Array; range?: TextRange }> = [];
  const degraded: string[] = [];
  const frames: Frame[] = [];
  let spoken = 0;

  await speakTranslation(
    tts,
    text,
    'en',
    config,
    {
      audio: (pcm, range) => { spoken++; clips.push({ pcm, range }); },
      degraded: () => { spoken++; degraded.push('tts_degraded'); },
      frame: (direction, type, payload) => frames.push({ direction, type, payload }),
    },
    () => (opts.endAfter !== undefined ? spoken >= opts.endAfter : false),
    createVirtualClock(),
  );

  return { clips, degraded, frames, tts };
}

const speakAll = async (text: string, opts?: RunOptions) => (await run(text, opts)).clips;
const speakAllWith = (text: string, opts?: RunOptions) => run(text, opts);

describe('speakTranslation', () => {
  it('speaks each sentence as one clip with its exact range, resampled to 24 kHz', async () => {
    const clips = await speakAll('Hello there. How are you?', { rate: 44_100, samplesPerSentence: 44_100 });
    expect(clips.map((c) => c.range)).toEqual([[0, 12], [13, 25]]);
    expect(clips[0].pcm).toBeInstanceOf(Int16Array);
    expect(clips[0].pcm.length).toBe(24_000);
  });

  it("gathers an Edge sentence's chunks into one clip", async () => {
    const clips = await speakAll('One. Two.', { edge: true, chunksPerSentence: 3, rate: 24_000, samplesPerChunk: 1_000 });
    expect(clips).toHaveLength(2);
    expect(clips[0].pcm.length).toBe(3_000);
  });

  it('skips a sentence that fails to synthesize, reporting it', async () => {
    const { clips, degraded } = await speakAllWith('One. Two.', { failSentence: 0 });
    expect(clips.map((c) => c.range)).toEqual([[5, 9]]);
    expect(degraded).toEqual(['tts_degraded']);
  });

  it('calls generate (not generateStream) for a non-Edge model, with its speaker id and speed', async () => {
    const { tts } = await speakAllWith('Hi.', { samplesPerSentence: 100 });
    expect(tts.generateCalls).toEqual([{ text: 'Hi.', sid: 0, speed: 1, lang: 'en' }]);
    expect(tts.streamCalls).toEqual([]);
  });

  it("calls generateStream with the configured Edge voice when the model is an Edge one", async () => {
    const { tts } = await speakAllWith('Hi.', { edge: true, chunksPerSentence: 1, samplesPerChunk: 10 });
    expect(tts.streamCalls).toEqual([{ text: 'Hi.', sid: 0, speed: 1, lang: 'en', voice: 'en-US-AriaNeural' }]);
    expect(tts.generateCalls).toEqual([]);
  });

  it("uses generateStream for an Edge-engine model id even when edgeVoice is unset — today's client detects the model alone", async () => {
    const tts = new FakeTts();
    tts.chunksPerSentence = 1;
    tts.samplesPerChunk = 10;
    const config: TtsConfig = { modelId: 'edge-tts', speakerId: 0, speed: 1 }; // no edgeVoice
    const clips: Array<{ pcm: Int16Array; range?: TextRange }> = [];
    await speakTranslation(tts, 'Hi.', 'en', config, { audio: (pcm, range) => clips.push({ pcm, range }), degraded: () => {} }, () => false, createVirtualClock());
    expect(tts.streamCalls).toHaveLength(1);
    expect(tts.streamCalls[0].voice).toBeUndefined();
    expect(tts.generateCalls).toEqual([]);
  });

  it('stops between sentences once the session has ended', async () => {
    const { clips } = await speakAllWith('One. Two. Three.', { samplesPerSentence: 10, endAfter: 1 });
    expect(clips.map((c) => c.range)).toEqual([[0, 4]]);
  });

  it('reports local.tts.* frames around a spoken translation, in order and direction, with today\'s payload fields', async () => {
    const { frames } = await speakAllWith('One. Two.', { samplesPerSentence: 10 });
    expect(frames.map((f) => f.type)).toEqual([
      'local.tts.start',
      'local.tts.sentence.start',
      'local.tts.sentence.end',
      'local.tts.sentence.start',
      'local.tts.sentence.end',
      'local.tts.end',
    ]);
    expect(frames.map((f) => f.direction)).toEqual(['out', 'out', 'in', 'out', 'in', 'in']);
    expect(frames[0].payload).toEqual({ text: 'One. Two.', sentenceCount: 2, modelId: 'fake-tts-model', voice: 'speaker:0', speed: 1 });
    expect(frames[1].payload).toEqual({ sentenceIndex: 0, sentenceCount: 2, text: 'One.' });
    expect(frames[2].payload).toEqual({ sentenceIndex: 0, sentenceCount: 2, text: 'One.', generateMs: 0, audioDurationMs: 0 });
    expect(frames[5].payload).toEqual({ sentenceCount: 2, durationMs: 0 });
  });

  it('reports local.tts.error, not sentence.end, for a sentence that fails — and local.tts.end still closes the run', async () => {
    const { frames } = await speakAllWith('One. Two.', { failSentence: 0 });
    expect(frames.map((f) => f.type)).toEqual([
      'local.tts.start',
      'local.tts.sentence.start',
      'local.tts.error',
      'local.tts.sentence.start',
      'local.tts.sentence.end',
      'local.tts.end',
    ]);
    expect(frames[2].payload).toEqual({ error: 'fake synthesis failed for "One."', sentenceIndex: 0 });
  });

  it('emits the clip after a throwing audio handler propagates, without reporting it as tts_degraded', async () => {
    const tts = new FakeTts();
    tts.samplesPerSentence = 10;
    const config: TtsConfig = { modelId: 'fake-tts-model', speakerId: 0, speed: 1 };
    const degraded: string[] = [];
    const failing = speakTranslation(
      tts,
      'One.',
      'en',
      config,
      {
        audio: () => { throw new Error('a consumer threw'); },
        degraded: (message) => degraded.push(message),
      },
      () => false,
      createVirtualClock(),
    );
    await expect(failing).rejects.toThrow('a consumer threw');
    expect(degraded).toEqual([]);
  });
});

describe('locateSentence', () => {
  it('finds the exact range and advances the search past it', () => {
    expect(locateSentence('Hello world. Goodbye.', 'Goodbye.', 0)).toEqual({ range: [13, 21], nextSearchFrom: 21 });
  });

  it('on a miss, advances the search by the sentence length anyway, so a later hit is still found', () => {
    const text = 'Hello world. Goodbye.';
    const miss = locateSentence(text, 'Bonjour', 0); // 7 chars, not present
    expect(miss).toEqual({ range: undefined, nextSearchFrom: 7 });
    expect(locateSentence(text, 'Goodbye.', miss.nextSearchFrom)).toEqual({ range: [13, 21], nextSearchFrom: 21 });
  });
});
