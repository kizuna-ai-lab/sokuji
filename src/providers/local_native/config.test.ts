import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import { directionKey, emptyDirection } from '../../lib/local-inference/selection/types';
import type { SharedSettings } from '../../lib/provider/types';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { admitLocalNative, asrLoadsFirst, buildLocalNative, describeLocalNative, ONE_SIDE_AT_A_TIME, type LocalNativeConfig } from './config';
import { LOCAL_NATIVE_DEFAULTS, type LocalNativeSettings } from './settings';

const cpu = [{ tier: 'cpu', backend: 'ct2', available: true }];
const CATALOG = {
  // `variants` lists the quant an explicit pick pins: the resolver drops a pin the card does not list.
  'asr-a': {
    id: 'asr-a', name: 'ASR A', kind: 'asr', languages: ['ja', 'en'], recommended: true, tiers: cpu, order: 1, repo: 'r-asr',
    variants: [{ id: 'q8_0', repo: 'r-asr-q8', recommended: true, supported: true, downloaded: true }],
  },
  'mt-a': { id: 'mt-a', name: 'MT A', kind: 'translate', languages: ['multi'], recommended: true, tiers: cpu, order: 1, repo: 'r-mt' },
  'tts-a': { id: 'tts-a', name: 'TTS A', kind: 'tts', languages: ['ja', 'en'], recommended: true, tiers: cpu, order: 1, repo: 'r-tts', voice: { builtin: 'named', custom: 'clip' } },
} as unknown as Record<string, NativeModelInfo>;
const READY = { 'asr-a': 'ready', 'mt-a': 'ready', 'tts-a': 'ready' } as const;

const forward: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
const reverse: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: false, turns: 'auto' };
const shared = (over: Partial<SharedSettings> = {}): SharedSettings => ({
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  reversed: (d) => d.source === 'en',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
  ...over,
});
const s = (over: Partial<LocalNativeSettings> = {}): LocalNativeSettings => ({ ...LOCAL_NATIVE_DEFAULTS, ...over });
const built = (r: ReturnType<typeof buildLocalNative>): LocalNativeConfig => {
  if ('refused' in r && typeof r.refused === 'string') throw new Error(`refused: ${r.refused}`);
  return r as LocalNativeConfig;
};

beforeEach(() => {
  useNativeModelStore.setState({ catalog: CATALOG, statuses: { ...READY }, sizes: { 'asr-a': 100, 'mt-a': 50, 'tts-a': 10 } });
});

describe('buildLocalNative', () => {
  it('resolves the three stages for the leg, with the devices the settings pin', () => {
    const c = built(buildLocalNative(forward, s({ asrDevice: 'gpu', translationDevice: 'cpu', ttsDevice: 'auto', ttsSpeed: 1.2, ttsVoice: 'builtin:Bella' }), shared()));
    expect(c.asr).toEqual({ modelId: 'asr-a', device: 'gpu' });
    expect(c.translation).toMatchObject({ modelId: 'mt-a', device: 'cpu' });
    expect(c.tts).toEqual({ modelId: 'tts-a', device: 'auto', speed: 1.2, voice: 'builtin:Bella', capability: { builtin: 'named', custom: 'clip' } });
    expect(c.vad).toEqual({ threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 });
  });

  it("carries an explicit pick's variant pin", () => {
    const selections = { [directionKey('ja', 'en')]: { ...emptyDirection(), asr: { modelId: 'asr-a', variant: 'q8_0' } } };
    expect(built(buildLocalNative(forward, s({ selections }), shared())).asr).toEqual({ modelId: 'asr-a', variant: 'q8_0', device: 'auto' });
  });

  it('refuses a leg with no speech recognition model', () => {
    useNativeModelStore.setState({ statuses: { ...READY, 'asr-a': 'absent' } });
    expect(buildLocalNative(forward, s(), shared())).toEqual({ refused: 'No speech recognition model for ja.', code: 'no_asr', params: { source: 'ja' } });
  });

  it('runs transcription only when no translation model resolves', () => {
    useNativeModelStore.setState({ statuses: { ...READY, 'mt-a': 'absent' } });
    expect(built(buildLocalNative(forward, s(), shared())).translation).toBeNull();
  });

  it('loads TTS only where the leg speaks', () => {
    expect(built(buildLocalNative({ ...forward, speech: false }, s(), shared())).tts).toBeUndefined();
  });

  it('template mode: the default prompt, wrapped', () => {
    expect(built(buildLocalNative(forward, s(), shared())).translation).toMatchObject({
      instructions: buildDefaultLocalPrompt('ja', 'en'), wrapTranscript: true,
    });
  });

  it("advanced mode: the speaker's prompt, and the reverse direction's own prompt, falling back to the speaker's", () => {
    const adv = s({ useTemplateMode: false, systemPrompt: '  Speaker rules  ', participantSystemPrompt: '' });
    expect(built(buildLocalNative(forward, adv, shared())).translation).toMatchObject({ instructions: 'Speaker rules', wrapTranscript: false });
    expect(built(buildLocalNative(reverse, adv, shared())).translation).toMatchObject({ instructions: 'Speaker rules' });
    expect(built(buildLocalNative(reverse, { ...adv, participantSystemPrompt: 'Other rules' }, shared())).translation).toMatchObject({ instructions: 'Other rules' });
  });

  it('cuts jobs by sentences only under a sentences display', () => {
    expect(built(buildLocalNative(forward, s(), shared())).jobSentences).toBeUndefined();
    expect(built(buildLocalNative(forward, s(), shared({ segmentation: { mode: 'sentences', sentencesPerRow: 2 } }))).jobSentences).toBe(2);
  });

  it('decides the load order from the catalog (#578 ruling 15)', () => {
    expect(built(buildLocalNative(forward, s(), shared())).asrFirst).toBe(true);
  });
});

describe('asrLoadsFirst', () => {
  const gpuOnly = { ...CATALOG['mt-a'], tiers: [{ tier: 'vulkan', backend: 'llama', available: true }] } as NativeModelInfo;
  it('a GPU-only stage loads first', () => {
    expect(asrLoadsFirst('asr-a', 'mt-a', { ...CATALOG, 'mt-a': gpuOnly }, {})).toBe(false);
  });
  it('else the larger loads first', () => {
    expect(asrLoadsFirst('asr-a', 'mt-a', CATALOG, { 'asr-a': 10, 'mt-a': 50 })).toBe(false);
    expect(asrLoadsFirst('asr-a', 'mt-a', CATALOG, { 'asr-a': 50, 'mt-a': 10 })).toBe(true);
  });
  it('with no translation, or no catalog, ASR first', () => {
    expect(asrLoadsFirst('asr-a', undefined, CATALOG, {})).toBe(true);
    expect(asrLoadsFirst('asr-a', 'mt-a', {}, {})).toBe(true);
  });
});

describe('describeLocalNative and admitLocalNative', () => {
  // Built after the outer `beforeEach` fills the store: at collection time the catalog is empty.
  let one: LocalNativeConfig;
  beforeEach(() => {
    one = built(buildLocalNative(forward, s(), shared()));
  });
  it('names the models a config uses', () => {
    expect(describeLocalNative(one)).toEqual({ asrModel: 'asr-a', translationModel: 'mt-a', ttsModel: 'tts-a' });
  });
  it('admit refuses two legs and admits one (#578 ruling 4)', () => {
    expect(admitLocalNative({ speaker: one })).toBe(true);
    expect(admitLocalNative({ participant: one })).toBe(true);
    expect(admitLocalNative({ speaker: one, participant: one })).toEqual({ refused: ONE_SIDE_AT_A_TIME });
  });
});
