import { describe, it, expect, vi, beforeEach } from 'vitest';
import { directionKey, type DirectionResult, type Selections } from '../../lib/local-inference/selection/types';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/run/types';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';

/** One direction's table entry: an id per stage, or absent/null for "does not
 *  resolve". `autoTranslation` is what the translation stage resolves to once
 *  that direction's stored translation selection is auto (`''`) — what the AST
 *  cross-stage guard's re-resolution asks for. */
type TableEntry = { asr?: string | null; translation?: string | null; tts?: string | null; autoTranslation?: string | null };
type Table = Record<string, TableEntry>;

// Prefixed "mock" so Vitest hoists these alongside the vi.mock factories below
// (for `mockSizes`/`mockManifest`, which the factories read).
let mockTable: Table = {};
const mockResolve = vi.fn((src: string, tgt: string, selections: Selections): DirectionResult => {
  const entry = mockTable[`${src}>${tgt}`];
  const stage = (id: string | null | undefined) => (id ? { modelId: id, source: 'explicit' as const } : null);
  const translationAuto = selections[directionKey(src, tgt)]?.translation.modelId === '';
  return {
    asr: stage(entry?.asr),
    translation: stage(translationAuto ? entry?.autoTranslation : entry?.translation),
    tts: stage(entry?.tts),
    notes: [],
    prunes: [],
  };
});

/** Per-model manifest stub: only the fields `build`/`admit` read. Absent id: a
 *  plain offline ASR entry, no AST capability. */
let mockManifest: Record<string, { type?: string; asrEngine?: string; astLanguages?: unknown; asrWorkerType?: string; ttsConfig?: { defaultSid?: number } }> = {};
/** Per-model memory size in MB, summed by the mocked `estimateModelMemoryByDevice`. */
let mockSizes: Record<string, number> = {};

/** The mocked `estimateModelMemoryByDevice`: sums each id's size from `mockSizes`, whatever the GPU's features. */
const estimate = vi.hoisted(() => vi.fn((ids: ReadonlyArray<string | undefined | null>, _deviceFeatures?: string[]) => {
  let ramMb = 0;
  for (const id of ids) {
    if (id && mockSizes[id] != null) ramMb += mockSizes[id];
  }
  return { vramMb: 0, ramMb };
}));

vi.mock('../../lib/local-inference/modelManifest', () => ({
  getManifestEntry: (id: string) => mockManifest[id] ?? { type: 'asr' },
  estimateModelMemoryByDevice: estimate,
}));

import { ALL_LOCAL_STAGES } from '../../lib/lineup/localStages';
import { fakeLocalModels } from '../../lib/local-inference/selection/localModels.testing';
import { buildLocalInference, describeLocalInference, admitLocalInference, type LocalInferenceConfig } from './config';
import { LOCAL_INFERENCE_DEFAULTS, type LocalInferenceSettings } from './settings';

/** The GPU's features this device's models report: none. */
const FEATURES: readonly string[] = [];
/** This device's models as a run hands them: resolved by `mockResolve`. */
const models = fakeLocalModels({ resolve: mockResolve, deviceFeatures: () => FEATURES });

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

function shared(overrides: { reversed?: boolean; segmentation?: SharedSettings['segmentation']; words?: SharedSettings['words']; lineUp?: SharedSettings['lineUp'] } = {}): SharedSettings {
  return {
    pauses: { sourceSeconds: 0, translationSeconds: 0 },
    reversed: () => overrides.reversed ?? false,
    segmentation: overrides.segmentation ?? { mode: 'off', sentencesPerRow: 0 },
    models: [],
    localModels: models,
    ...(overrides.words ? { words: overrides.words } : {}),
    ...(overrides.lineUp ? { lineUp: overrides.lineUp } : {}),
  };
}

/** A `LocalInferenceConfig` built directly from model ids, bypassing `build` — for
 *  `describe`/`admit` tests, which only care about the ids each config carries. */
function cfg(ids: { asr: string; translation?: string; tts?: string }): LocalInferenceConfig {
  return {
    asr: { modelId: ids.asr, streaming: false },
    vad: { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4, maxSpeechDuration: 30, preSpeechPadDuration: 0.8 },
    translation: ids.translation ? { kind: 'engine', modelId: ids.translation, instructions: '', wrapTranscript: false } : { kind: 'none' },
    ...(ids.tts ? { tts: { modelId: ids.tts, speakerId: 0, speed: 1 } } : {}),
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
  mockManifest = {};
  mockSizes = {};
  mockResolve.mockClear();
  localStorage.clear();
});

describe('buildLocalInference', () => {
  it("resolves a direction through this device's models as the run hands them", () => {
    // A spy of its own that answers as `mockResolve` does: `vi.fn(mockResolve)` would be `mockResolve` itself.
    const resolve = vi.fn((...args: Parameters<typeof mockResolve>) => mockResolve(...args));
    buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), { ...shared(), localModels: fakeLocalModels({ resolve }) });
    expect(resolve).toHaveBeenCalledWith('ja', 'en', LOCAL_INFERENCE_DEFAULTS.selections, ALL_LOCAL_STAGES);
  });

  it("throws when no run handed it this device's models", () => {
    expect(() => buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), { ...shared(), localModels: undefined })).toThrow(/SharedSettings\.localModels/);
  });

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

  it("adds the word list and the session background to the translator's prompt, leaving how the transcript is wrapped as it was", () => {
    resolved({ 'ja>en': { asr: 'sherpa-ja', translation: 'opus-ja-en', tts: 'piper-en' } });
    const words = { entries: [{ written: 'キズナAI', translation: 'Kizuna AI' }, { written: 'Sokuji' }], background: 'A weekly sync.' };
    const c = buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings({ useTemplateMode: true }), shared({ words })) as LocalInferenceConfig;
    const t = c.translation as { instructions: string; wrapTranscript: boolean };
    expect(t.wrapTranscript).toBe(true);
    expect(t.instructions.startsWith(buildDefaultLocalPrompt('ja', 'en'))).toBe(true);
    expect(t.instructions).toContain('Keep these names and terms as written: キズナAI, Sokuji.');
    expect(t.instructions).toContain('Translate these as given: キズナAI → Kizuna AI.');
    expect(t.instructions).toContain('About this session: A weekly sync.');
    const plain = buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings({ useTemplateMode: true }), shared()) as LocalInferenceConfig;
    expect(plain.translation).toMatchObject({ instructions: buildDefaultLocalPrompt('ja', 'en') });
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

  // The AST cross-stage guard (astGuard.ts): an AST-capable model picked
  // explicitly as the translation stage while the ASR stage resolves to a
  // different model would load as a translation engine against AST-only
  // files. `build` masks that pick back to auto instead.
  it('builds the auto pick as the translation engine when Granite Speech was picked for translation but the ASR resolves to another model', () => {
    mockManifest = { granite: { type: 'asr', asrEngine: 'granite-speech', astLanguages: { en: ['ja'] } } };
    resolved({ 'ja>en': { asr: 'sherpa-ja', translation: 'granite', autoTranslation: 'opus-ja-en' } });
    const selections: Selections = {
      [directionKey('ja', 'en')]: { asr: { modelId: '' }, translation: { modelId: 'granite' }, tts: { modelId: '' } },
    };
    const c = buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings({ selections }), shared()) as LocalInferenceConfig;
    expect(c.asr.modelId).toBe('sherpa-ja');
    expect(c.translation).toMatchObject({ kind: 'engine', modelId: 'opus-ja-en' });
  });

  it('applies the same guard to the reversed (participant) direction', () => {
    mockManifest = { granite: { type: 'asr', asrEngine: 'granite-speech', astLanguages: { en: ['ja'] } } };
    resolved({ 'en>ja': { asr: 'sherpa-en', translation: 'granite', autoTranslation: 'opus-en-ja' } });
    const selections: Selections = {
      [directionKey('en', 'ja')]: { asr: { modelId: '' }, translation: { modelId: 'granite' }, tts: { modelId: '' } },
    };
    const c = buildLocalInference(ctx({ source: 'en', target: 'ja' }), settings({ selections }), shared({ reversed: true })) as LocalInferenceConfig;
    expect(c.asr.modelId).toBe('sherpa-en');
    expect(c.translation).toMatchObject({ kind: 'engine', modelId: 'opus-en-ja' });
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
    expect(withIt.vad).toEqual({ threshold: 0.3, negativeThreshold: 0.15, minSilenceDuration: 1.4, minSpeechDuration: 0.4, maxSpeechDuration: 30, preSpeechPadDuration: 0.8 });
    const without = buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), shared()) as LocalInferenceConfig;
    expect(without.vad).not.toHaveProperty('negativeThreshold');
  });

  it('carries the pre-speech padding into vad.preSpeechPadDuration', () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' } });
    const set = buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings({ vadPreSpeechPadDuration: 0.3 }), shared()) as LocalInferenceConfig;
    expect(set.vad.preSpeechPadDuration).toBe(0.3);
    const byDefault = buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), shared()) as LocalInferenceConfig;
    expect(byDefault.vad.preSpeechPadDuration).toBe(0.8);
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

  it("speaks each leg in its own direction's voice", () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't', tts: 'piper-en' }, 'en>ja': { asr: 'a', translation: 't', tts: 'piper-ja' } });
    const s = settings({ voices: { 'ja→en': { edge: 'en-US-AvaNeural', speaker: 3 }, 'en→ja': { speaker: 5 } } as never });
    const mine = buildLocalInference(ctx({ source: 'ja', target: 'en' }, { speech: true }), s, shared()) as LocalInferenceConfig;
    const theirs = buildLocalInference(ctx({ source: 'en', target: 'ja' }, { speech: true }), s, shared({ reversed: true })) as LocalInferenceConfig;
    expect(mine.tts).toEqual({ modelId: 'piper-en', speakerId: 3, speed: 1 });
    expect(theirs.tts).toEqual({ modelId: 'piper-ja', speakerId: 5, speed: 1 });
  });

  it("speaks in the model's default speaker when the direction has none", () => {
    mockManifest = { 'supertonic-3': { type: 'tts', ttsConfig: { defaultSid: 7 } } };
    resolved({ 'ja>en': { asr: 'a', translation: 't', tts: 'supertonic-3' }, 'en>ja': { asr: 'a', translation: 't', tts: 'piper-ja' } });
    expect((buildLocalInference(ctx({ source: 'ja', target: 'en' }, { speech: true }), settings(), shared()) as LocalInferenceConfig).tts?.speakerId).toBe(7);
    expect((buildLocalInference(ctx({ source: 'en', target: 'ja' }, { speech: true }), settings(), shared({ reversed: true })) as LocalInferenceConfig).tts?.speakerId).toBe(0);
  });

  it('records which leg cannot speak when no TTS model resolves, and nothing for a leg that does not speak', () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't', tts: null }, 'en>ja': { asr: 'a', translation: 't', tts: null } });
    expect(buildLocalInference(ctx({ source: 'ja', target: 'en' }, { speech: true }), settings(), shared())).toMatchObject({ ttsUnavailable: 'speaker_tts_missing' });
    expect(buildLocalInference(ctx({ source: 'en', target: 'ja' }, { speech: true }), settings(), shared({ reversed: true }))).toMatchObject({ ttsUnavailable: 'participant_tts_missing' });
    expect(buildLocalInference(ctx({ source: 'ja', target: 'en' }, { speech: false }), settings(), shared())).not.toHaveProperty('ttsUnavailable');
  });

  describe('Smart Turn', () => {
    beforeEach(() => {
      mockManifest = { a: { type: 'asr', asrWorkerType: 'whisper-webgpu' } };
      resolved({ 'ja>en': { asr: 'a', translation: 't' } });
    });

    const build = (over: Partial<LocalInferenceSettings>) =>
      buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(over), shared()) as LocalInferenceConfig;

    it('carries Smart Turn into vad.smartTurn', () => {
      expect(build({ vadEndOfTurn: 'smart' }).vad.smartTurn).toEqual({ checkAfter: 0.3, threshold: 0.5 });
    });

    it('leaves it out under Normal', () => {
      expect(build({}).vad).not.toHaveProperty('smartTurn');
    });

    it.each(['sherpa-onnx', 'voxtral-webgpu', undefined])('leaves it out for an ASR whose worker is %s', (asrWorkerType) => {
      mockManifest = { a: { type: 'asr', asrWorkerType } };
      expect(build({ vadEndOfTurn: 'smart' }).vad).not.toHaveProperty('smartTurn');
    });

    it('holds Turn Check After 0.2 s under Max Wait', () => {
      expect(build({ vadEndOfTurn: 'smart', vadMinSilenceDuration: 0.4, smartTurnCheckAfter: 0.5 }).vad.smartTurn)
        .toEqual({ checkAfter: 0.2, threshold: 0.5 });
    });

    it('drops Smart when Max Wait leaves under 0.10 s for it', () => {
      expect(build({ vadEndOfTurn: 'smart', vadMinSilenceDuration: 0.25 }).vad).not.toHaveProperty('smartTurn');
      expect(build({ vadEndOfTurn: 'smart', vadMinSilenceDuration: 0.3 }).vad.smartTurn).toEqual({ checkAfter: 0.1, threshold: 0.5 });
    });
  });
});

describe('describeLocalInference / admitLocalInference', () => {
  it('describes the models a run used, and admits only what fits the memory budget', () => {
    const c = cfg({ asr: 'a', translation: 't', tts: 'x' });
    expect(describeLocalInference(c)).toEqual({ asrModel: 'a', translationModel: 't', ttsModel: 'x' });
    budget(1_000);
    sizes({ a: 400, t: 300, x: 200 });
    expect(admitLocalInference({ speaker: c }, FEATURES)).toBe(true);
    expect(admitLocalInference({ speaker: c, participant: c }, FEATURES)).toMatchObject({ code: 'memory_exceeded' });
  });

  it('budgets by the GPU features it is handed', () => {
    admitLocalInference({ speaker: cfg({ asr: 'a' }) }, ['shader-f16']);
    expect(estimate).toHaveBeenLastCalledWith(['a'], ['shader-f16']);
  });

  it("runs the other side's leg text only when its speech model alone tips the budget, saying why", () => {
    budget(1_000);
    sizes({ a: 200, t: 150, x: 200 });
    const speaker = cfg({ asr: 'a', translation: 't', tts: 'x' });
    const participant = cfg({ asr: 'a', translation: 't', tts: 'x' });
    const answer = admitLocalInference({ speaker, participant }, FEATURES);
    expect(answer).toEqual({ configs: { participant: expect.objectContaining({ ttsUnavailable: 'participant_tts_over_budget' }) } });
    const adjusted = (answer as { configs: { participant: LocalInferenceConfig } }).configs.participant;
    expect(adjusted).not.toHaveProperty('tts');
    expect(adjusted.asr).toEqual(participant.asr);
    // The config built is left as built.
    expect(participant.tts).toBeDefined();
  });

  it("refuses when dropping the other side's speech model is not enough", () => {
    budget(1_000);
    sizes({ a: 400, t: 300, x: 200 });
    expect(admitLocalInference({ speaker: cfg({ asr: 'a', translation: 't', tts: 'x' }), participant: cfg({ asr: 'a', translation: 't', tts: 'x' }) }, FEATURES)).toMatchObject({ code: 'memory_exceeded' });
  });

  it("refuses when the other side's speech model takes no memory: a cloud voice frees nothing", () => {
    budget(1_000);
    sizes({ a: 400, t: 300 });
    expect(admitLocalInference({ speaker: cfg({ asr: 'a', translation: 't' }), participant: cfg({ asr: 'a', translation: 't', tts: 'edge-tts' }) }, FEATURES)).toMatchObject({ code: 'memory_exceeded' });
  });

  it('never drops my own speech model: a speaker-only run over budget refuses', () => {
    budget(1_000);
    sizes({ a: 500, t: 300, x: 300 });
    expect(admitLocalInference({ speaker: cfg({ asr: 'a', translation: 't', tts: 'x' }) }, FEATURES)).toMatchObject({ code: 'memory_exceeded' });
  });
});

describe("the line-up a run froze at its start", () => {
  const stagesSeen = () => mockResolve.mock.calls.map((call) => (call as unknown[])[3]);
  // Bing and Edge are providers of their own: a stage the line-up gives them is not this provider's (null).
  const lineUps: Array<[NonNullable<SharedSettings['lineUp']>, { translation: 'local' | null; speech: 'local' | null; transcription?: 'local' }]> = [
    [{ transcription: 'local_inference', translation: 'bing', speech: 'edge' }, { translation: null, speech: null, transcription: 'local' }],
    [{ transcription: 'local_inference', translation: 'bing', speech: 'local_inference' }, { translation: null, speech: 'local', transcription: 'local' }],
    [{ transcription: 'local_inference', translation: 'local_inference', speech: 'edge' }, { translation: 'local', speech: null }],
    [{ transcription: 'local_inference', translation: 'local_inference', speech: 'local_inference' }, { translation: 'local', speech: 'local' }],
  ];

  beforeEach(() => { mockResolve.mockClear(); });

  it.each(lineUps)('is what the stages are read from: %j resolves with %j', (lineUp, stages) => {
    resolved({ 'ja>en': { asr: 'a', translation: 't', tts: 'v' } });
    buildLocalInference(ctx({ source: 'ja', target: 'en' }, { speech: true }), settings(), shared({ lineUp }));
    expect(stagesSeen()).toEqual([stages]);
  });

  // Never null: a null reaches model resolution with Bing and Edge among the choices, and this provider runs only
  // this machine's models.
  it('with none handed over, every stage is on this machine: the store is not asked, and no online model can be resolved', () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' } });
    buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), shared());
    expect(stagesSeen()).toEqual([{ translation: 'local', speech: 'local' }]);
  });

  it("a line-up whose text is another provider's answers for the stage this provider serves, and one that gives it no stage reads as every stage on this machine", () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' } });
    buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), shared({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'local_inference' } }));
    expect(stagesSeen()).toEqual([{ translation: null, speech: 'local' }]);
    mockResolve.mockClear();
    buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), shared({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'soniox' } }));
    expect(stagesSeen()).toEqual([{ translation: 'local', speech: 'local' }]);
  });
});
