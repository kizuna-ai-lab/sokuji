import { describe, it, expect } from 'vitest';
import type { TextRange } from '../../lib/contract/adapter';
import { speakTranslation } from './speech';
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

/** Runs `speakTranslation` over a fresh `FakeTts` configured per `opts`, recording every clip and degradation. */
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
  let spoken = 0;

  await speakTranslation(
    tts,
    text,
    'en',
    config,
    {
      audio: (pcm, range) => { spoken++; clips.push({ pcm, range }); },
      degraded: () => { spoken++; degraded.push('tts_degraded'); },
    },
    () => (opts.endAfter !== undefined ? spoken >= opts.endAfter : false),
  );

  return { clips, degraded, tts };
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

  it('uses generate, not generateStream, when edgeVoice is unset even for an Edge-engine model id', async () => {
    const tts = new FakeTts();
    tts.samplesPerSentence = 10;
    const config: TtsConfig = { modelId: 'edge-tts', speakerId: 0, speed: 1 };
    const clips: Array<{ pcm: Int16Array; range?: TextRange }> = [];
    await speakTranslation(tts, 'Hi.', 'en', config, { audio: (pcm, range) => clips.push({ pcm, range }), degraded: () => {} }, () => false);
    expect(tts.generateCalls).toHaveLength(1);
    expect(tts.streamCalls).toEqual([]);
  });

  it('stops between sentences once the session has ended', async () => {
    const { clips } = await speakAllWith('One. Two. Three.', { samplesPerSentence: 10, endAfter: 1 });
    expect(clips.map((c) => c.range)).toEqual([[0, 4]]);
  });
});
