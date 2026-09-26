import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DirectionResult } from '../../lib/local-inference/selection/types';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';

/** One direction's table entry: an id per stage, or absent/null for "does not resolve". */
type TableEntry = { asr?: string | null; translation?: string | null; tts?: string | null };
type Table = Record<string, TableEntry>;

// Prefixed "mock" so Vitest hoists these alongside the vi.mock factories below
// (see check.test.ts for the same convention).
let mockTable: Table = {};
let mockDeviceFeatures: string[] = [];
const mockResolve = vi.fn((src: string, tgt: string, _selections: unknown): DirectionResult => {
  const entry = mockTable[`${src}>${tgt}`];
  const stage = (id: string | null | undefined) => (id ? { modelId: id, source: 'explicit' as const } : null);
  return {
    asr: stage(entry?.asr),
    translation: stage(entry?.translation),
    tts: stage(entry?.tts),
    notes: [],
    prunes: [],
  };
});

vi.mock('../../stores/modelStore', () => ({
  useModelStore: {
    getState: () => ({
      resolve: mockResolve,
      get deviceFeatures() { return mockDeviceFeatures; },
    }),
  },
}));

/** Per-model manifest stub: only the fields `build`/`admit` read. Absent id: a
 *  plain offline ASR entry, no AST capability. */
let mockManifest: Record<string, { type?: string; asrEngine?: string; astLanguages?: unknown }> = {};
/** Per-model memory size in MB, summed by the mocked `estimateModelMemoryByDevice`. */
let mockSizes: Record<string, number> = {};

vi.mock('../../lib/local-inference/modelManifest', () => ({
  getManifestEntry: (id: string) => mockManifest[id] ?? { type: 'asr' },
  estimateModelMemoryByDevice: (ids: ReadonlyArray<string | undefined | null>) => {
    let ramMb = 0;
    for (const id of ids) {
      if (id && mockSizes[id] != null) ramMb += mockSizes[id];
    }
    return { vramMb: 0, ramMb };
  },
}));

import { buildLocalInference, describeLocalInference, admitLocalInference, type LocalInferenceConfig } from './config';
import { LOCAL_INFERENCE_DEFAULTS, type LocalInferenceSettings } from './settings';

/** Sets what `resolve(src, tgt, …)` answers, keyed `${src}>${tgt}`. */
function resolved(table: Table): void {
  mockTable = table;
}

function ctx(direction: { source: string; target: string }, opts: Partial<Pick<SessionContext, 'speech' | 'turns'>> = {}): SessionContext {
  return { direction, speech: opts.speech ?? false, turns: opts.turns ?? 'manual' };
}

function settings(overrides: Partial<LocalInferenceSettings> = {}): LocalInferenceSettings {
  return { ...LOCAL_INFERENCE_DEFAULTS, ...overrides };
}

function shared(overrides: { reversed?: boolean; segmentation?: SharedSettings['segmentation'] } = {}): SharedSettings {
  return {
    instructions: () => '',
    pauses: { sourceSeconds: 0, translationSeconds: 0 },
    reversed: () => overrides.reversed ?? false,
    segmentation: overrides.segmentation ?? { mode: 'off', sentencesPerRow: 0 },
    models: [],
  };
}

/** A `LocalInferenceConfig` built directly from model ids, bypassing `build` — for
 *  `describe`/`admit` tests, which only care about the ids each config carries. */
function cfg(ids: { asr: string; translation?: string; tts?: string }): LocalInferenceConfig {
  return {
    asr: { modelId: ids.asr, streaming: false },
    vad: { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4, maxSpeechDuration: 30 },
    translation: ids.translation ? { kind: 'engine', modelId: ids.translation, instructions: '', wrapTranscript: false } : { kind: 'none' },
    ...(ids.tts ? { tts: { modelId: ids.tts, speakerId: 0, speed: 1, edgeVoice: undefined } } : {}),
  };
}

/** Sets the RAM budget `admit` will read, in MB (mirrors today's
 *  `debug:device-memory` GB override × 0.75 ratio × 1024). */
function budget(mb: number): void {
  localStorage.setItem('debug:device-memory', String(mb / (0.75 * 1024)));
}

/** Sets each model id's memory footprint in MB, read by the mocked `estimateModelMemoryByDevice`. */
function sizes(table: Record<string, number>): void {
  mockSizes = table;
}

beforeEach(() => {
  mockTable = {};
  mockDeviceFeatures = [];
  mockManifest = {};
  mockSizes = {};
  mockResolve.mockClear();
  localStorage.clear();
});

describe('buildLocalInference', () => {
  it("builds the speaker's direction with its own prompt, TTS when speaking, and a job cut sized by the stored Auto sentences-per-row", () => {
    resolved({ 'ja>en': { asr: 'sherpa-ja', translation: 'opus-ja-en', tts: 'piper-en' } });
    const c = buildLocalInference(ctx({ source: 'ja', target: 'en' }, { speech: true }), settings({ useTemplateMode: true }), shared({ segmentation: { mode: 'sentences', sentencesPerRow: 0 } }));
    expect(c).toMatchObject({
      asr: { modelId: 'sherpa-ja' },
      translation: { kind: 'engine', modelId: 'opus-ja-en', wrapTranscript: true },
      tts: { modelId: 'piper-en' },
      jobSentences: 0,
    });
    expect((c as LocalInferenceConfig).translation).toMatchObject({ instructions: buildDefaultLocalPrompt('ja', 'en') });
  });

  it('carries the stored sentences-per-row count into jobSentences', () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' } });
    const c = buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), shared({ segmentation: { mode: 'sentences', sentencesPerRow: 3 } })) as LocalInferenceConfig;
    expect(c.jobSentences).toBe(3);
  });

  it('leaves jobSentences absent when the display is not segmented by sentences (off or pause)', () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' } });
    const off = buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), shared({ segmentation: { mode: 'off', sentencesPerRow: 0 } }));
    expect(off).not.toHaveProperty('jobSentences');
    const paused = buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), shared({ segmentation: { mode: 'pause', sentencesPerRow: 2 } }));
    expect(paused).not.toHaveProperty('jobSentences');
  });

  it('uses the participant prompt for the reversed direction, and no TTS when not speaking', () => {
    resolved({ 'en>ja': { asr: 'a', translation: 't', tts: 'x' } });
    const c = buildLocalInference(ctx({ source: 'en', target: 'ja' }, { speech: false }), settings({ useTemplateMode: false, systemPrompt: 'MINE', participantSystemPrompt: 'THEIRS' }), shared({ reversed: true }));
    expect(c).toMatchObject({ translation: { instructions: 'THEIRS', wrapTranscript: false } });
    expect(c).not.toHaveProperty('tts');
  });

  it('refuses a direction without ASR, and runs one without translation transcription-only', () => {
    resolved({ 'ja>en': { asr: null, translation: 't' }, 'en>ja': { asr: 'a', translation: null } });
    expect(buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), shared())).toMatchObject({ code: 'no_asr', params: { source: 'ja' } });
    expect(buildLocalInference(ctx({ source: 'en', target: 'ja' }), settings(), shared({ reversed: true }))).toMatchObject({ translation: { kind: 'none' } });
  });

  it('builds AST when a Granite Speech ASR model was also picked as the translation stage: no translation engine, the ASR model counted as both', () => {
    mockManifest = { granite: { type: 'asr', asrEngine: 'granite-speech', astLanguages: { en: ['ja'] } } };
    resolved({ 'en>ja': { asr: 'granite', translation: 'granite' } });
    const c = buildLocalInference(ctx({ source: 'en', target: 'ja' }), settings(), shared()) as LocalInferenceConfig;
    expect(c.translation).toEqual({ kind: 'ast' });
    expect(describeLocalInference(c)).toEqual({ asrModel: 'granite', translationModel: 'granite', ttsModel: undefined });
  });

  it('marks an asr-stream model streaming, and any other ASR model not', () => {
    mockManifest = { 'stream-asr': { type: 'asr-stream' } };
    resolved({ 'ja>en': { asr: 'stream-asr', translation: 't' }, 'en>ja': { asr: 'offline-asr', translation: 't' } });
    expect((buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), shared()) as LocalInferenceConfig).asr).toEqual({ modelId: 'stream-asr', streaming: true });
    expect((buildLocalInference(ctx({ source: 'en', target: 'ja' }), settings(), shared()) as LocalInferenceConfig).asr).toEqual({ modelId: 'offline-asr', streaming: false });
  });

  it('carries a set VAD negative threshold into vad.negativeThreshold, and leaves it out when unset', () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' } });
    const withIt = buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings({ vadNegativeThreshold: 0.15 }), shared()) as LocalInferenceConfig;
    expect(withIt.vad).toEqual({ threshold: 0.3, negativeThreshold: 0.15, minSilenceDuration: 1.4, minSpeechDuration: 0.4, maxSpeechDuration: 30 });
    const without = buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), shared()) as LocalInferenceConfig;
    expect(without.vad).not.toHaveProperty('negativeThreshold');
  });

  it("trims the speaker prompt before falling back to the default, matching today's cascade", () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' } });
    const c = buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings({ useTemplateMode: false, systemPrompt: '  MINE  ' }), shared());
    expect((c as LocalInferenceConfig).translation).toMatchObject({ instructions: 'MINE' });
  });

  it('falls back to the trimmed-and-defaulted speaker prompt when the participant prompt is blank', () => {
    resolved({ 'en>ja': { asr: 'a', translation: 't' } });
    const c = buildLocalInference(
      ctx({ source: 'en', target: 'ja' }),
      settings({ useTemplateMode: false, systemPrompt: '  MINE  ', participantSystemPrompt: '   ' }),
      shared({ reversed: true }),
    );
    expect((c as LocalInferenceConfig).translation).toMatchObject({ instructions: 'MINE' });
  });
});

describe('describeLocalInference / admitLocalInference', () => {
  it('describes the models a run used, and admits only what fits the memory budget', () => {
    const c = cfg({ asr: 'a', translation: 't', tts: 'x' });
    expect(describeLocalInference(c)).toEqual({ asrModel: 'a', translationModel: 't', ttsModel: 'x' });
    budget(1_000);
    sizes({ a: 400, t: 300, x: 200 });
    expect(admitLocalInference({ speaker: c })).toBe(true);
    expect(admitLocalInference({ speaker: c, participant: c })).toMatchObject({ code: 'memory_exceeded' });
  });
});
