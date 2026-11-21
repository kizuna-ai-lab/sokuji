/**
 * The local provider's recognition as a unit of its own: what it declares, which model its config names, how its
 * configs are admitted, and its sessions over `FakeAsr` held to the adapter rules. The leg of three units it runs in
 * (this device transcribing, another unit translating, a third speaking) is `transcriptionUnit.run.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdapterStartError, type AdapterSession, type SessionContext } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { checkConformance, recordConformance } from '../../lib/contract/conformance';
import type { AdapterEvent } from '../../lib/contract/events';
import { flush } from '../../lib/contract/testing/drive';
import type { LocalStages } from '../../lib/lineup/localStages';
import type { StageIds } from '../../lib/lineup/types';
import type { DirectionResult } from '../../lib/local-inference/selection/types';
import type { SharedSettings } from '../../lib/provider/types';

// Prefixed "mock" so Vitest hoists these alongside the vi.mock factories below.
/** What each direction resolves to, keyed `${src}>${tgt}`, as the engine resolves under a line-up's local stages. */
let mockTable: Record<string, { asr?: string; translation?: string; tts?: string }> = {};
let mockStagesSeen: Array<LocalStages | null | undefined> = [];
vi.mock('../../stores/modelStore', () => ({
  useModelStore: {
    getState: () => ({
      resolve: (src: string, tgt: string, _selections: unknown, stages?: LocalStages | null): DirectionResult => {
        mockStagesSeen.push(stages);
        const entry = mockTable[`${src}>${tgt}`];
        const stage = (id: string | undefined) => (id ? { modelId: id, source: 'explicit' as const } : null);
        // As `resolveWasmDirection` does: nothing resolves for a stage another provider serves.
        const translationHere = stages == null || stages.translation !== null;
        const asrHere = stages == null || stages.transcription === 'local' || (stages.translation !== null && stages.transcription !== null);
        return {
          asr: stage(asrHere ? entry?.asr : undefined),
          translation: stage(translationHere ? entry?.translation : undefined),
          tts: stage(stages?.speech === null ? undefined : entry?.tts),
          notes: [],
          prunes: [],
        };
      },
      deviceFeatures: [],
    }),
  },
}));

vi.mock('../../stores/lineUpStore', () => ({ storedLocalStages: () => null }));

/** Per-model memory in MB; the rest of the manifest is the real one. */
let mockSizes: Record<string, number> = {};
vi.mock('../../lib/local-inference/modelManifest', async (original) => ({
  ...(await original<typeof import('../../lib/local-inference/modelManifest')>()),
  estimateModelMemoryByDevice: (ids: ReadonlyArray<string | undefined | null>) => ({ vramMb: 0, ramMb: ids.reduce((sum: number, id) => sum + ((id && mockSizes[id]) || 0), 0) }),
}));

import { buildLocalInference, type LocalInferenceConfig } from './config';
import { createFakeEngines } from './fakeEngines';
import { LOCAL_INFERENCE_DEFAULTS, type LocalInferenceSettings } from './settings';
import { areLocalSpeechConfigs } from './speechUnit';
import { areLocalTranslationConfigs } from './translationUnit';
import {
  admitLocalTranscription, areLocalTranscriptionConfigs, buildLocalTranscription, createLocalTranscriptionUnit, LOCAL_TRANSCRIPTION_UNIT, localTranscriptionUnit,
} from './transcriptionUnit';

const EN_JA = { source: 'en', target: 'ja' };
const JA_EN = { source: 'ja', target: 'en' };
const ctx = (direction: SessionContext['direction'], o: { speech?: boolean; turns?: SessionContext['turns'] } = {}): SessionContext => ({ direction, speech: o.speech ?? false, turns: o.turns ?? 'auto' });
const shared = (over: { reversed?: boolean; lineUp?: StageIds; sentences?: boolean } = {}): SharedSettings => ({
  pauses: { sourceSeconds: 0, translationSeconds: 0 },
  reversed: () => over.reversed ?? false,
  segmentation: over.sentences ? { mode: 'sentences', sentencesPerRow: 1 } : { mode: 'off', sentencesPerRow: 0 },
  models: [],
  ...(over.lineUp ? { lineUp: over.lineUp } : {}),
});
const SETTINGS: LocalInferenceSettings = LOCAL_INFERENCE_DEFAULTS;
/** This device transcribes; another provider translates and a third speaks. */
const APART: StageIds = { transcription: 'local_inference', translation: 'soniox', speech: 'edge' };

/** A config of this unit, as `buildLocalTranscription` makes one, over a recognition model the test names. */
function aloneConfig(over: Partial<LocalInferenceConfig> = {}): LocalInferenceConfig {
  return {
    asr: { modelId: 'asr-model', streaming: true },
    vad: { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4, maxSpeechDuration: 30, preSpeechPadDuration: 0.8 },
    translation: { kind: 'none' },
    transcribesAlone: true,
    ...over,
  };
}

beforeEach(() => {
  mockTable = {};
  mockStagesSeen = [];
  mockSizes = {};
});

describe('what the local transcription unit declares', () => {
  it('is a unit for transcription alone, started through the adapter contract', () => {
    const unit = localTranscriptionUnit;
    expect(unit.id).toBe(LOCAL_TRANSCRIPTION_UNIT);
    expect(LOCAL_TRANSCRIPTION_UNIT).toBe('transcription');
    expect(unit.occupies(SETTINGS, new Set(['transcription']))).toEqual(['transcription']);
    expect(unit.occupies(SETTINGS, new Set(['transcription', 'translation']))).toBeNull();
    expect(unit.occupies(SETTINGS, new Set(['transcription', 'speech']))).toBeNull();
    expect(unit.occupies(SETTINGS, new Set(['transcription', 'translation', 'speech']))).toBeNull();
    expect(unit.occupies(SETTINGS, new Set(['translation']))).toBeNull();
    expect(unit.start).toBeTypeOf('function');
    expect(unit.startTranslation).toBeUndefined();
    expect(unit.startSpeech).toBeUndefined();
  });

  it('never speaks, takes typed text, keeps both turn modes and its own boundaries, and has no face-to-face', () => {
    expect(localTranscriptionUnit.capabilities(SETTINGS)).toEqual({
      speech: 'never', turns: ['auto', 'manual'], turnOwner: 'either', boundaries: 'provider', textInput: true, faceToFace: false, participantSpeech: true,
    });
  });

  it('names the recognition model and nothing else: the translation and the voice are named by their own units', () => {
    expect(localTranscriptionUnit.describe(aloneConfig())).toEqual({ asrModel: 'asr-model' });
  });
});

describe('the config it builds', () => {
  it("the direction's recognition model, resolved with no translation model and no voice, and nothing translated", () => {
    mockTable = { 'en>ja': { asr: 'sensevoice-int8', translation: 'opus-mt-en-jap', tts: 'tts-ja' } };
    const built = buildLocalTranscription(ctx(EN_JA, { speech: true }), SETTINGS, shared({ lineUp: APART }));
    expect(built).toEqual({
      asr: { modelId: 'sensevoice-int8', streaming: false },
      vad: { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4, maxSpeechDuration: 30, preSpeechPadDuration: 0.8 },
      translation: { kind: 'none' },
      transcribesAlone: true,
    });
    expect(mockStagesSeen).toEqual([{ translation: null, speech: 'edge', transcription: 'local' }]);
  });

  it('handed no line-up, or one that does not describe it, it still resolves recognition alone', () => {
    mockTable = { 'en>ja': { asr: 'sensevoice-int8', translation: 'opus-mt-en-jap' } };
    expect(buildLocalTranscription(ctx(EN_JA), SETTINGS, shared())).toMatchObject({ asr: { modelId: 'sensevoice-int8' }, translation: { kind: 'none' } });
    const allHere = { transcription: 'local_inference', translation: 'local_inference', speech: 'local_inference' };
    expect(buildLocalTranscription(ctx(EN_JA), SETTINGS, shared({ lineUp: allHere }))).toMatchObject({ translation: { kind: 'none' }, transcribesAlone: true });
    expect(mockStagesSeen).toEqual([
      { translation: null, speech: null, transcription: 'local' },
      { translation: null, speech: 'local', transcription: 'local' },
    ]);
  });

  it('the recognition and its VAD are what the whole session builds for the same settings, Smart Turn and the streaming flag included', () => {
    const settings: LocalInferenceSettings = { ...SETTINGS, vadEndOfTurn: 'smart', vadNegativeThreshold: 0.2 };
    for (const asr of ['granite-speech', 'stream-en-kroko', 'sensevoice-int8']) {
      mockTable = { 'en>ja': { asr, translation: 'opus-mt-en-jap' } };
      const whole = buildLocalInference(ctx(EN_JA), settings, shared()) as LocalInferenceConfig;
      const alone = buildLocalTranscription(ctx(EN_JA), settings, shared()) as LocalInferenceConfig;
      expect(alone.asr).toEqual(whole.asr);
      expect(alone.vad).toEqual(whole.vad);
    }
    // Granite takes Smart Turn and SenseVoice does not; Kroko streams.
    mockTable = { 'en>ja': { asr: 'granite-speech' } };
    expect((buildLocalTranscription(ctx(EN_JA), settings, shared()) as LocalInferenceConfig).vad.smartTurn).toEqual({ checkAfter: 0.3, threshold: 0.5 });
    mockTable = { 'en>ja': { asr: 'stream-en-kroko' } };
    expect((buildLocalTranscription(ctx(EN_JA), settings, shared()) as LocalInferenceConfig).asr.streaming).toBe(true);
  });

  it('no job cut and no voice, whatever the display and the leg ask for', () => {
    mockTable = { 'en>ja': { asr: 'sensevoice-int8', tts: 'tts-ja' } };
    const built = buildLocalTranscription(ctx(EN_JA, { speech: true }), SETTINGS, shared({ sentences: true })) as LocalInferenceConfig;
    expect(built).not.toHaveProperty('jobSentences');
    expect(built).not.toHaveProperty('tts');
    expect(built).not.toHaveProperty('ttsUnavailable');
  });

  it('no recognition model for the source is refused as the whole session refuses it, naming the language', () => {
    mockTable = { 'en>ja': { translation: 'opus-mt-en-jap' } };
    expect(buildLocalTranscription(ctx(EN_JA), SETTINGS, shared())).toEqual({ refused: 'No speech recognition model for en.', code: 'no_asr', params: { source: 'en' } });
    // The participant's leg is named by its own source.
    expect(buildLocalTranscription(ctx(JA_EN), SETTINGS, shared({ reversed: true }))).toEqual({ refused: 'No speech recognition model for ja.', code: 'no_asr', params: { source: 'ja' } });
  });

  it('a model that can translate speech, chosen for both stages of the direction, only transcribes here: the translation is another unit\'s', () => {
    // As the whole session resolves it, Granite chosen for both is speech translation; here the translation stage is
    // not this device's, so it does not resolve, and Granite is asked to transcribe.
    mockTable = { 'en>ja': { asr: 'granite-speech', translation: 'granite-speech' } };
    expect((buildLocalInference(ctx(EN_JA), SETTINGS, shared()) as LocalInferenceConfig).translation).toEqual({ kind: 'ast' });
    expect(buildLocalTranscription(ctx(EN_JA), SETTINGS, shared({ lineUp: APART }))).toMatchObject({ asr: { modelId: 'granite-speech' }, translation: { kind: 'none' } });
  });
});

describe('admission', () => {
  it("tells its configs from the whole session's, the translation's and the voice's by their shape", () => {
    const alone = aloneConfig();
    const whole: LocalInferenceConfig = { ...aloneConfig(), translation: { kind: 'engine', modelId: 'mt', instructions: '', wrapTranscript: false } };
    delete whole.transcribesAlone;
    expect(areLocalTranscriptionConfigs({ speaker: alone })).toBe(true);
    expect(areLocalTranscriptionConfigs({ speaker: alone, participant: alone })).toBe(true);
    expect(areLocalTranscriptionConfigs({ speaker: whole })).toBe(false);
    expect(areLocalTranscriptionConfigs({ speaker: alone, participant: whole })).toBe(false);
    expect(areLocalTranscriptionConfigs({})).toBe(false);
    expect(areLocalTranscriptionConfigs({ speaker: { modelId: 'tts', speakerId: 0, speed: 1 } })).toBe(false);
    expect(areLocalTranscriptionConfigs({ speaker: { modelId: 'mt', instructions: '', wrapTranscript: false } })).toBe(false);
    // Nor is it taken for another unit's.
    expect(areLocalSpeechConfigs({ speaker: alone })).toBe(false);
    expect(areLocalTranslationConfigs({ speaker: alone })).toBe(false);
  });

  it('counts its recognition models only, one per leg', () => {
    mockSizes = { 'asr-en': 1000, 'asr-ja': 1000 };
    const legs = { speaker: aloneConfig({ asr: { modelId: 'asr-en', streaming: false } }), participant: aloneConfig({ asr: { modelId: 'asr-ja', streaming: false } }) };
    vi.stubGlobal('navigator', { deviceMemory: 4 });
    try {
      expect(admitLocalTranscription(legs)).toBe(true);
      mockSizes = { 'asr-en': 2000, 'asr-ja': 2000 };
      expect(admitLocalTranscription(legs)).toEqual({ refused: 'The models need more memory than this device has.', code: 'memory_exceeded' });
      expect(admitLocalTranscription({ speaker: legs.speaker })).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/** Starts a session of the unit over fake engines without settling the recognition model's load. */
function begin(config = aloneConfig(), context = ctx(EN_JA), signal = new AbortController().signal) {
  const fakes = createFakeEngines();
  const recorder = recordConformance();
  const clock = createVirtualClock();
  const starting = createLocalTranscriptionUnit({ engines: fakes.engines }).start!({ context, config, credentials: {}, clock, signal }, recorder.events);
  return { ...fakes, ...recorder, starting, context, clock };
}

/** Starts a session and loads its recognition model. */
async function open(config = aloneConfig(), context = ctx(EN_JA)) {
  const t = begin(config, context);
  await flush();
  if (t.created.includes('asr')) t.asr.ready();
  const session: AdapterSession = await t.starting;
  await flush();
  const of = <K extends AdapterEvent['kind']>(kind: K) => t.log.filter((e) => e.kind === kind).map((e) => e.payload as Extract<AdapterEvent, { kind: K }>['payload']);
  return { ...t, session, of };
}

describe('a session of the local transcription unit', () => {
  it('loads the recognition model alone, for the source, never asked to translate; its opening names no translation', async () => {
    const t = await open();
    expect(t.created).toEqual(['asr']);
    expect(t.asr.inits).toEqual([{ modelId: 'asr-model', options: expect.objectContaining({ language: 'en', translateTo: undefined, punctuationEndpoint: true }) }]);
    expect(t.of('loading')).toEqual([{ stage: 'asr', done: 1, total: 1 }]);
    expect(t.of('frame').filter((f) => f.type === 'local.session.opened').map((f) => f.payload)).toEqual([{ asrModel: 'asr-model', language: 'en' }]);
    // Another unit translates: nothing is said of a translation that is missing.
    expect(t.of('degraded')).toEqual([]);
    await t.session.stop();
    expect(checkConformance(t.log, t.context)).toEqual([]);
  });

  it('partials grow one source segment; the final closes it, stating all of it stable; nothing is translated', async () => {
    const t = await open();
    t.asr.partial('Hello');
    t.asr.partial('Hello, how');
    t.asr.final('Hello, how are you?');
    t.asr.partial('Fine');
    t.asr.final('Fine.');
    await flush();
    expect(t.of('segmentOpened')).toEqual([{ ref: 1, side: 'source', origin: 'u1' }, { ref: 2, side: 'source', origin: 'u2' }]);
    const texts = t.of('segmentText').map(({ ref, text, heard }) => ({ ref, text, stable: heard?.stableLen }));
    expect(texts).toEqual([
      { ref: 1, text: 'Hello', stable: undefined },
      { ref: 1, text: 'Hello, how', stable: undefined },
      { ref: 1, text: 'Hello, how are you?', stable: 19 },
      { ref: 2, text: 'Fine', stable: undefined },
      { ref: 2, text: 'Fine.', stable: 5 },
    ]);
    expect(t.of('segmentClosed')).toEqual([{ ref: 1, origin: 'u1' }, { ref: 2, origin: 'u2' }]);
    expect(t.created).toEqual(['asr']);
    expect(t.of('degraded')).toEqual([]);
    await t.session.stop();
    expect(checkConformance(t.log, t.context)).toEqual([]);
  });

  it('states the stable length at the final whether or not its words could be placed in time, and a final the partials already showed is said again with it', async () => {
    // A streaming recognizer that gives no start sample: no pieces, the stable length all the same.
    const t = await open();
    t.asr.partial('Same words.');
    t.asr.final('Same words.');
    expect(t.of('segmentText').map((e) => e.heard)).toEqual([undefined, { pieces: [], stableLen: 11 }]);
    await t.session.stop();
    // An offline recognizer that says where the utterance began: its pieces, and all of it stable.
    const o = await open(aloneConfig({ asr: { modelId: 'asr-model', streaming: false } }));
    o.session.appendAudio(new Int16Array(24000));
    o.asr.onResult?.({ text: 'Hi.', durationMs: 500, recognitionTimeMs: 10, startSample: 0 });
    const heard = o.of('segmentText')[0].heard!;
    expect(heard.stableLen).toBe(3);
    expect(heard.pieces.length).toBeGreaterThan(0);
    await o.session.stop();
    expect(checkConformance(o.log, o.context)).toEqual([]);
  });

  it('typed text is a source segment, opened, said and closed at once, for whoever translates; nothing is said of a translation', async () => {
    const t = await open();
    t.session.appendText('Typed words.');
    t.session.appendText('   ');
    expect(t.of('segmentOpened')).toEqual([{ ref: 1, side: 'source', origin: 'u1' }]);
    expect(t.of('segmentText')).toEqual([{ ref: 1, text: 'Typed words.' }]);
    expect(t.of('segmentClosed')).toEqual([{ ref: 1, origin: 'u1' }]);
    expect(t.of('degraded')).toEqual([]);
    await t.session.stop();
    expect(checkConformance(t.log, t.context)).toEqual([]);
  });

  it('a manual turn ends when the key is released: the recognizer is flushed', async () => {
    const t = await open(aloneConfig(), ctx(EN_JA, { turns: 'manual' }));
    t.session.beginTurn();
    t.session.appendAudio(new Int16Array(240));
    t.session.endTurn();
    expect(t.asr.flushes).toBe(1);
    t.session.cancelTurn();
    expect(t.asr.flushes).toBe(2);
    await t.session.stop();
  });

  it('Smart Turn runs under automatic turns where the config asks for it, and not under manual ones', async () => {
    const smart = aloneConfig({ vad: { ...aloneConfig().vad, smartTurn: { checkAfter: 0.3, threshold: 0.5 } } });
    const auto = await open(smart);
    expect(auto.turn.connects).toBe(1);
    expect(auto.asr.inits[0].options.turnPort).toBe(auto.turn.port);
    await auto.session.stop();
    expect(auto.turn.releases).toBe(1);
    const manual = await open(smart, ctx(EN_JA, { turns: 'manual' }));
    expect(manual.turn.connects).toBe(0);
    await manual.session.stop();
  });

  it('a recognizer that gives up on one utterance closes it as it stands and says so; the next is heard', async () => {
    const t = await open();
    t.asr.partial('Half');
    t.asr.fail('decode error');
    t.asr.final('Whole.');
    expect(t.of('degraded')).toEqual([{ code: 'transcription_failed', message: 'decode error' }]);
    expect(t.of('segmentClosed')).toEqual([{ ref: 1, origin: 'u1' }, { ref: 2, origin: 'u2' }]);
    await t.session.stop();
    expect(checkConformance(t.log, t.context)).toEqual([]);
  });

  it('a recognizer that dies fails the session, and nothing follows', async () => {
    const t = await open();
    t.asr.partial('Some');
    t.asr.die('worker gone');
    t.asr.final('Ignored.');
    t.session.appendText('Ignored too.');
    expect(t.of('failed')).toEqual([{ message: 'Speech recognition stopped: worker gone' }]);
    expect(t.log[t.log.length - 1].kind).toBe('failed');
    await t.session.stop();
    expect(checkConformance(t.log, t.context)).toEqual([]);
  });

  it('a model that does not load rejects the start in the whole session\'s words, and is let go', async () => {
    const t = begin();
    await flush();
    t.asr.failInit('no such file');
    await expect(t.starting).rejects.toThrow('ASR engine init failed: no such file');
    expect(t.asr.disposes).toBe(1);
  });

  it('a stop in the middle of an utterance is clean: the engine is let go and nothing is said after it', async () => {
    const t = await open();
    t.asr.partial('Half a sen');
    t.mark('stop');
    await t.session.stop();
    t.mark('stopped');
    t.asr.final('Half a sentence.');
    t.session.appendText('Late.');
    expect(t.asr.disposes).toBe(1);
    expect(t.log[t.log.length - 1]).toEqual({ kind: 'marker', payload: 'stopped' });
    expect(checkConformance(t.log, t.context)).toEqual([]);
  });

  it('refuses, before any engine is made, a config that would translate or speak: the leg\'s translation is another unit\'s', async () => {
    for (const config of [
      aloneConfig({ translation: { kind: 'ast' } }),
      aloneConfig({ translation: { kind: 'engine', modelId: 'mt', instructions: '', wrapTranscript: false } }),
      aloneConfig({ tts: { modelId: 'tts', speakerId: 0, speed: 1 } }),
      { ...aloneConfig(), transcribesAlone: undefined },
    ]) {
      const t = begin(config);
      const error = await t.starting.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AdapterStartError);
      expect(error).toMatchObject({ code: 'build_refused' });
      expect(t.created).toEqual([]);
    }
  });

  it('a start already cancelled makes no engine', async () => {
    const abort = new AbortController();
    abort.abort(new Error('cancelled'));
    const t = begin(aloneConfig(), ctx(EN_JA), abort.signal);
    await expect(t.starting).rejects.toThrow('cancelled');
    expect(t.created).toEqual([]);
  });
});

describe('the whole local session is untouched by it', () => {
  it('a transcription-only whole session still says that it is one, and its typed text still says so once', async () => {
    const fakes = createFakeEngines();
    const recorder = recordConformance();
    const config: LocalInferenceConfig = { ...aloneConfig() };
    delete config.transcribesAlone;
    const { createLocalInferenceAdapter } = await import('./adapter');
    const starting = createLocalInferenceAdapter(fakes.engines).start({ context: ctx(EN_JA), config, credentials: {}, clock: createVirtualClock(), signal: new AbortController().signal }, recorder.events);
    fakes.asr.ready();
    const session = await starting;
    await flush();
    session.appendText('Typed.');
    fakes.asr.partial('Same');
    fakes.asr.final('Same');
    const degraded = recorder.log.filter((e) => e.kind === 'degraded').map((e) => (e.payload as { code: string }).code);
    expect(degraded).toEqual(['translation_unavailable']);
    // Its final states no stable length where its words could not be placed in time, as before.
    const said = recorder.log.filter((e) => e.kind === 'segmentText').map((e) => (e.payload as { heard?: unknown }).heard);
    expect(said).toEqual([undefined, undefined]);
    expect(recorder.log.filter((e) => e.kind === 'frame' && (e.payload as { type: string }).type === 'local.session.opened').map((e) => (e.payload as { payload: unknown }).payload))
      .toEqual([{ asrModel: 'asr-model', translationPair: 'en → ja', ttsModel: null }]);
    await session.stop();
  });
});
