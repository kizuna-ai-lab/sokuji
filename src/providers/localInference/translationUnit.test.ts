/**
 * The local provider's translation as a unit of its own: what it declares,
 * which pairs it translates, which model its config names, its sessions over
 * `FakeTranslation` held to the translation rules, and a leg of three units
 * in which another provider transcribes and a third speaks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionContext, StartRequest } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { checkConformance, recordConformance } from '../../lib/contract/conformance';
import { flush } from '../../lib/contract/testing/drive';
import type { TranslationStartRequest } from '../../lib/contract/translation';
import { checkTranslation, recordTranslation } from '../../lib/contract/translationConformance';
import { AUTO } from '../../lib/language/code';
import type { LocalStages } from '../../lib/lineup/localStages';
import type { StageIds } from '../../lib/lineup/types';
import type { DirectionResult } from '../../lib/local-inference/selection/types';
import { fakeLocalModels } from '../../lib/local-inference/selection/localModels.testing';
import { startComposite } from '../../lib/plan/composite';
import type { PlanConfigs } from '../../lib/plan/types';
import { startCompositeBoth } from '../../lib/plan/compositeBoth';
import { separateStages } from '../../lib/plan/compositeStages';
import { separatePlan, stubProvider } from '../../lib/plan/testing';
import { isSpeechUnit, isTranslationUnit, type PlannedUnit, type RunPlan } from '../../lib/plan/types';
import type { ProviderRefusal, SharedSettings } from '../../lib/run/types';
import { JOB_TIMEOUT_MS } from '../../lib/translation/jobTranslator';

// Prefixed "mock" so Vitest hoists these alongside the vi.mock factories below.
/** What each direction resolves to, keyed `${src}>${tgt}`, as the engine resolves under a line-up's local stages. */
let mockTable: Record<string, { asr?: string; translation?: string }> = {};
let mockStagesSeen: Array<LocalStages | null | undefined> = [];
/** How this device's models resolve a direction: from `mockTable`, recording the stages each resolution is under. */
const resolve = (src: string, tgt: string, _selections: unknown, stages?: LocalStages | null): DirectionResult => {
  mockStagesSeen.push(stages);
  const entry = mockTable[`${src}>${tgt}`];
  const stage = (id: string | undefined) => (id ? { modelId: id, source: 'explicit' as const } : null);
  const noAsr = stages != null && (stages.translation === null || stages.transcription === null);
  return { asr: stage(noAsr ? undefined : entry?.asr), translation: stage(entry?.translation), tts: null, notes: [], prunes: [] };
};

/** Per-model memory in MB; the rest of the manifest is the real one. */
let mockSizes: Record<string, number> = {};
vi.mock('../../lib/local-inference/modelManifest', async (original) => ({
  ...(await original<typeof import('../../lib/local-inference/modelManifest')>()),
  estimateModelMemoryByDevice: (ids: ReadonlyArray<string | undefined | null>) => ({ vramMb: 0, ramMb: ids.reduce((sum: number, id) => sum + ((id && mockSizes[id]) || 0), 0) }),
}));

import { FAKE_TRANSCRIBER_DEFAULTS, fakeTranscriberProvider } from '../fake/transcriber';
import { fakeVoiceProvider } from '../fake/voice';
import { MODEL_MANIFEST, isTranslationModelCompatible } from '../../lib/local-inference/modelManifest';
import { BING_TRANSLATOR } from '../../lib/local-inference/sessions/translationSession';
import { buildLocalInference, type LocalInferenceConfig } from './config';
import { FakeTranslation } from './fakeEngines';
import { LOCAL_INFERENCE_DEFAULTS, type LocalInferenceSettings } from './settings';
import { areLocalSpeechConfigs } from './speechUnit';
import { LOCAL_MODEL_JOB_TIMEOUT_MS } from '../../lib/local-inference/sessions/translationSession';
import {
  admitLocalTranslation, areLocalTranslationConfigs, createLocalTranslationUnit, localTranslates, localTranslationLanguages,
  localTranslationSources, localTranslationTargets, localTranslationUnit, type LocalTranslationConfig,
} from './translationUnit';

const JA_EN = { source: 'ja', target: 'en' };
const EN_JA = { source: 'en', target: 'ja' };
const ctx = (direction: SessionContext['direction'], speech = false): SessionContext => ({ direction, speech, turns: 'auto' });
/** This device's models as a run hands them: resolved by `resolve`, with no GPU feature. */
const models = fakeLocalModels({ resolve, deviceFeatures: () => [] });
const shared = (over: { reversed?: boolean; lineUp?: StageIds; words?: SharedSettings['words'] } = {}): SharedSettings => ({
  pauses: { sourceSeconds: 0, translationSeconds: 0 },
  reversed: () => over.reversed ?? false,
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
  localModels: models,
  ...(over.lineUp ? { lineUp: over.lineUp } : {}),
  ...(over.words ? { words: over.words } : {}),
});
const SETTINGS: LocalInferenceSettings = LOCAL_INFERENCE_DEFAULTS;
/** Another provider transcribes; this device translates with a model of its own. */
const WITH_MODEL: StageIds = { transcription: 'soniox', translation: 'local_inference', speech: 'soniox' };
const MODEL: LocalTranslationConfig = { modelId: 'opus-mt-en-jap', instructions: 'Translate.', wrapTranscript: true };
/** What Bing's unit hands the shared translation session: its tagged errors and its deadline are worded and kept there. */
const BING: LocalTranslationConfig = { modelId: BING_TRANSLATOR, instructions: '', wrapTranscript: false };
const unit = localTranslationUnit;

beforeEach(() => {
  mockTable = { 'ja>en': { asr: 'asr-ja', translation: 'opus-mt-ja-en' }, 'en>ja': { asr: 'asr-en', translation: 'opus-mt-en-jap' } };
  mockStagesSeen = [];
  mockSizes = {};
  localStorage.clear();
});

describe('what the local translation unit declares', () => {
  it('is a unit for translation alone, started through the translation contract', () => {
    expect(unit.id).toBe('translation');
    expect(unit.occupies(SETTINGS, new Set(['translation']))).toEqual(['translation']);
    expect(unit.occupies(SETTINGS, new Set(['transcription', 'translation']))).toBeNull();
    // Translation and speech on this device are two units: this one never covers both.
    expect(unit.occupies(SETTINGS, new Set(['translation', 'speech']))).toBeNull();
    expect(unit.occupies(SETTINGS, new Set(['transcription', 'translation', 'speech']))).toBeNull();
    expect(unit.occupies(SETTINGS, new Set(['speech']))).toBeNull();
    expect(isTranslationUnit(unit)).toBe(true);
    expect(isSpeechUnit(unit)).toBe(false);
    expect(unit.start).toBeUndefined();
  });

  it('never speaks, takes no typed text, and has no face-to-face', () => {
    expect(unit.capabilities(SETTINGS)).toMatchObject({ speech: 'never', textInput: false, faceToFace: false, turns: ['auto', 'manual'], participantSpeech: true });
  });

  it('names the model that translates', () => {
    expect(unit.describe(MODEL)).toEqual({ translationModel: 'opus-mt-en-jap' });
  });
});

describe('the pairs it translates', () => {
  it('the local translation unit translates with local models only', () => {
    // Bing's own pairs are Bing's unit's: this unit takes a pair exactly when some model of this machine does.
    const translates = unit.capabilities(SETTINGS).translates!;
    expect(translates).toBe(localTranslates);
    for (const [source, target] of [['en', 'ja'], ['zh', 'zh-CN'], ['zh-CN', 'zh-TW'], ['no', 'nb'], ['la', 'en']]) {
      expect(translates(source, target), `${source}>${target}`).toBe(
        MODEL_MANIFEST.some((m) => m.type === 'translation' && !m.isCloudModel && isTranslationModelCompatible(m, source, target)),
      );
    }
    // The cloud entry of the manifest is not a model of this machine.
    const cloud = MODEL_MANIFEST.find((m) => m.type === 'translation' && m.isCloudModel)!;
    expect(cloud.id).toBe('bing-translator');
    expect(translates('zh', 'zh-CN')).toBe(MODEL_MANIFEST.some((m) => m.type === 'translation' && !m.isCloudModel && isTranslationModelCompatible(m, 'zh', 'zh-CN')));
  });

  it("this device's models: a pair some model of the catalog takes, downloaded or not", () => {
    expect(localTranslates('ja', 'en')).toBe(true);
    expect(localTranslates('en', 'zh')).toBe(true);
    expect(localTranslates('no', 'en')).toBe(true);
    // A model that takes any language is in the catalog.
    expect(localTranslates('zh-TW', 'la')).toBe(MODEL_MANIFEST.some((m) => m.type === 'translation' && !m.isCloudModel && m.languages[0] === 'multilingual'));
    expect(localTranslates('en', 'en')).toBe(false);
  });

  it('never from a source that is not known yet: every engine here has one fixed pair', () => {
    expect(localTranslates(AUTO, 'en')).toBe(false);
    expect(localTranslates('en', AUTO)).toBe(false);
  });

  it('lists the targets of a source and the sources of a target, among the languages asked about', () => {
    // Asked about another unit's languages, each is answered for.
    expect(localTranslationTargets('en', ['ja', 'en', AUTO])).toEqual(['ja']);
    expect(localTranslationSources('en', [AUTO, 'ja', 'en'])).toEqual(['ja']);

    const local = localTranslationLanguages();
    expect(local).toEqual(expect.arrayContaining(['ja', 'en', 'zh', 'xh']));
    expect(local).not.toContain('multilingual');
    expect(localTranslationTargets('ja')).toContain('en');
    expect(localTranslationTargets('ja')).not.toContain('ja');
    expect(localTranslationSources('en', ['ja', AUTO, 'en'])).toEqual(['ja']);
  });
});

describe('the config it builds', () => {
  it("a line-up that gives translation to this device: the direction's model, resolved with no recognition model, and the whole session's prompt", () => {
    const config = unit.build(ctx(EN_JA), SETTINGS, shared({ lineUp: WITH_MODEL })) as LocalTranslationConfig;
    expect(mockStagesSeen).toEqual([{ translation: 'local', speech: null, transcription: null }]);
    const whole = buildLocalInference(ctx(EN_JA), SETTINGS, shared()) as LocalInferenceConfig;
    if (whole.translation.kind !== 'engine') throw new Error('expected an engine translation');
    expect(config).toEqual({ modelId: 'opus-mt-en-jap', instructions: whole.translation.instructions, wrapTranscript: whole.translation.wrapTranscript });
  });

  it('a local model gets the word list in its prompt, as the whole session writes it', () => {
    const words = { entries: [{ term: 'Sokuji', translation: '' }], background: 'A product meeting.' } as unknown as SharedSettings['words'];
    const config = unit.build(ctx(EN_JA), SETTINGS, shared({ lineUp: WITH_MODEL, words })) as LocalTranslationConfig;
    const whole = buildLocalInference(ctx(EN_JA), SETTINGS, shared({ words })) as LocalInferenceConfig;
    if (whole.translation.kind !== 'engine') throw new Error('expected an engine translation');
    expect(config.instructions).toBe(whole.translation.instructions);
    expect(config.instructions).toContain('A product meeting.');
  });

  it('a model is never swapped for Bing: with none for the direction, the build is refused as models that are missing', () => {
    mockTable = {};
    const refusal = unit.build(ctx(EN_JA), SETTINGS, shared({ lineUp: WITH_MODEL })) as ProviderRefusal;
    expect(refusal).toEqual({ refused: 'No translation model for en → ja.', code: 'local_models_missing' });
  });

  it('a source that is not known yet is refused', () => {
    expect(unit.build(ctx({ source: AUTO, target: 'en' }), SETTINGS, shared({ lineUp: WITH_MODEL }))).toEqual({ refused: 'A translation on this device needs a fixed source language.' });
  });

  it('a recognition model that translates speech itself is no translator of text', () => {
    const ast = MODEL_MANIFEST.find((m) => m.astLanguages)!;
    mockTable = { 'en>ja': { translation: ast.id } };
    expect(unit.build(ctx(EN_JA), SETTINGS, shared({ lineUp: WITH_MODEL }))).toMatchObject({ code: 'local_models_missing' });
  });

  it('handed no line-up, it translates on this machine: its stages are never null, so Bing is no choice to resolve', () => {
    expect(unit.build(ctx(EN_JA), SETTINGS, shared())).toMatchObject({ modelId: 'opus-mt-en-jap' });
    expect(mockStagesSeen).toEqual([{ translation: 'local', speech: null, transcription: null }]);
  });
});

describe('admission', () => {
  it("tells its configs from the whole session's and the voice's by their shape", () => {
    const whole = buildLocalInference(ctx(EN_JA), SETTINGS, shared()) as LocalInferenceConfig;
    expect(areLocalTranslationConfigs({ speaker: MODEL })).toBe(true);
    expect(areLocalTranslationConfigs({ speaker: BING, participant: MODEL })).toBe(true);
    expect(areLocalTranslationConfigs({ speaker: whole })).toBe(false);
    expect(areLocalTranslationConfigs({ speaker: { modelId: 'tts', speakerId: 0, speed: 1 } })).toBe(false);
    expect(areLocalTranslationConfigs({ speaker: { off: true } })).toBe(false);
    expect(areLocalTranslationConfigs({})).toBe(false);
    expect(areLocalSpeechConfigs({ speaker: MODEL })).toBe(false);
    expect(areLocalSpeechConfigs({ speaker: BING })).toBe(false);
  });

  it('counts its translation models', () => {
    localStorage.setItem('debug:device-memory', '1'); // 768 MB of budget
    mockSizes = { 'opus-mt-en-jap': 500, 'opus-mt-ja-en': 500 };
    expect(admitLocalTranslation({ speaker: MODEL }, [])).toBe(true);
    expect(admitLocalTranslation({ speaker: MODEL, participant: { ...MODEL, modelId: 'opus-mt-ja-en' } }, [])).toEqual({ refused: 'The models need more memory than this device has.', code: 'memory_exceeded' });
  });
});

/** A recorded session of the unit over one `FakeTranslation`, not opened yet. */
function create(over: { config?: LocalTranslationConfig; direction?: SessionContext['direction']; signal?: AbortSignal } = {}) {
  const clock = createVirtualClock(0);
  const engine = new FakeTranslation();
  let made = 0;
  const built = createLocalTranslationUnit({ engines: { translation: () => { made++; return engine; } } });
  const request: TranslationStartRequest<LocalTranslationConfig, Record<string, never>> = {
    leg: 'speaker',
    context: ctx(over.direction ?? EN_JA),
    config: over.config ?? MODEL,
    credentials: {},
    clock,
    signal: over.signal ?? new AbortController().signal,
  };
  const { session, log } = recordTranslation(built.startTranslation!, request);
  const of = (kind: string) => log.flatMap((e) => (e.kind === kind && 'payload' in e ? [e.payload as Record<string, unknown>] : []));
  const frames = () => of('frame').map((f) => f.type);
  return { clock, engine, session, log, of, frames, engines: () => made };
}

/** The same, with its model loaded. */
async function setup(over: Parameters<typeof create>[0] = {}) {
  const made = create(over);
  const opening = made.session.open();
  made.engine.ready();
  await opening;
  return made;
}

const closed = (origin: string, text: string) => ({ origin, text, stableLen: text.length, closed: true });

describe('a session of the local translation unit', () => {
  it("opens once its model has loaded for the leg's direction, and says so as loading", async () => {
    const h = create();
    let opened = false;
    const opening = h.session.open().then(() => { opened = true; });
    await flush();
    expect(h.engine.inits).toEqual([{ sourceLang: 'en', targetLang: 'ja', modelId: 'opus-mt-en-jap' }]);
    expect(opened).toBe(false);
    expect(h.of('loading')).toEqual([]);
    h.engine.ready();
    await opening;
    expect(h.of('loading')).toEqual([{ stage: 'translation', done: 1, total: 1 }]);
    expect(h.frames()).toEqual(['local.init.translation.start', 'local.init.translation.ready']);
    expect(h.engines()).toBe(1);
  });

  it('a model that does not load rejects the open, in the words of the whole session, and is let go', async () => {
    const h = create();
    const opening = h.session.open();
    h.engine.failInit('no such file');
    await expect(opening).rejects.toThrow('Translation engine init failed: no such file');
    expect(h.engine.disposes).toBe(1);
    expect(h.of('failed')).toEqual([]);
    await h.session.stop();
    expect(h.engine.disposes).toBe(1);
  });

  it('a model too large for the GPU rejects the open with the code of that notice', async () => {
    const h = create();
    const opening = h.session.open();
    h.engine.failInit('OUT_OF_DEVICE_MEMORY');
    await expect(opening).rejects.toMatchObject({ code: 'gpu_out_of_memory' });
  });

  it('a start cancelled while the model loads rejects with the reason, and the engine is let go', async () => {
    const abort = new AbortController();
    const h = create({ signal: abort.signal });
    const opening = h.session.open();
    abort.abort(new Error('cancelled'));
    await expect(opening).rejects.toThrow('cancelled');
    expect(h.engine.disposes).toBe(1);
    // The model arrives afterwards: unwanted, and nothing is said of it.
    const said = h.log.length;
    h.engine.ready();
    await flush();
    expect(h.log).toHaveLength(said);
  });

  it('a stop while the model loads does not leave the open pending', async () => {
    const h = create();
    const opening = h.session.open();
    await h.session.stop();
    await expect(opening).rejects.toThrow();
    expect(h.engine.disposes).toBe(1);
  });

  it('an open after a stop makes no engine and rejects', async () => {
    const h = create();
    await h.session.stop();
    await expect(h.session.open()).rejects.toThrow();
    expect(h.engines()).toBe(0);
  });

  it('a listener that throws when the model is ready fails the open, and the engine is let go', async () => {
    const engine = new FakeTranslation();
    const built = createLocalTranslationUnit({ engines: { translation: () => engine } });
    const events = {
      translationOpened: () => {}, translationText: () => {}, translationClosed: () => {},
      failed: () => {}, degraded: () => {}, frame: () => {},
      loading: () => { throw new Error('listener broke'); },
    };
    const session = built.startTranslation!({ leg: 'speaker', context: ctx(EN_JA), config: MODEL, credentials: {}, clock: createVirtualClock(0), signal: new AbortController().signal }, events);
    const opening = session.open();
    engine.ready();
    await expect(opening).rejects.toThrow('listener broke');
    expect(engine.disposes).toBe(1);
  });

  it('a listener that stops the session at the ready frame hears no loading after it', async () => {
    const engine = new FakeTranslation();
    const built = createLocalTranslationUnit({ engines: { translation: () => engine } });
    const said: string[] = [];
    let session: ReturnType<NonNullable<typeof built.startTranslation>> | undefined;
    const events = {
      translationOpened: () => {}, translationText: () => {}, translationClosed: () => {},
      failed: () => {}, degraded: () => {},
      loading: () => { said.push('loading'); },
      frame: (f: { type: string }) => { if (f.type === 'local.init.translation.ready') void session?.stop(); },
    };
    session = built.startTranslation!({ leg: 'speaker', context: ctx(EN_JA), config: MODEL, credentials: {}, clock: createVirtualClock(0), signal: new AbortController().signal }, events);
    const opening = session.open();
    opening.catch(() => {});
    engine.ready();
    await flush();
    expect(said).toEqual([]);
    expect(engine.disposes).toBe(1);
  });

  it('a Logs listener that throws at a load failure does not keep the open from failing', async () => {
    const engine = new FakeTranslation();
    const built = createLocalTranslationUnit({ engines: { translation: () => engine } });
    const events = {
      translationOpened: () => {}, translationText: () => {}, translationClosed: () => {},
      failed: () => {}, degraded: () => {}, loading: () => {},
      frame: (f: { type: string }) => { if (f.type === 'local.init.translation.error') throw new Error('listener broke'); },
    };
    const session = built.startTranslation!({ leg: 'speaker', context: ctx(EN_JA), config: MODEL, credentials: {}, clock: createVirtualClock(0), signal: new AbortController().signal }, events);
    const opening = session.open();
    engine.failInit('no such file');
    await expect(opening).rejects.toThrow('Translation engine init failed: no such file');
    expect(engine.disposes).toBe(1);
  });

  it('defensively refuses a pair it cannot translate, before any engine is made', async () => {
    const bing = create({ config: BING, direction: { source: 'la', target: 'en' } });
    await expect(bing.session.open()).rejects.toMatchObject({ message: 'Bing Translator does not support this language pair.', code: 'build_refused' });
    expect(bing.engines()).toBe(0);
    const unknown = create({ direction: { source: AUTO, target: 'en' } });
    await expect(unknown.session.open()).rejects.toMatchObject({ code: 'build_refused' });
    expect(unknown.engines()).toBe(0);
  });

  it('translates each stretch with the prompt of its config, one job at a time, a segment per answer in the target language', async () => {
    const h = await setup();
    h.session.source({ origin: 'a', text: 'Hello. How are', stableLen: 10, closed: false });
    await flush();
    expect(h.engine.calls).toEqual([{ text: 'Hello.', systemPrompt: 'Translate.', wrapTranscript: true }]);
    h.session.source(closed('a', 'Hello. How are you?'));
    await flush();
    // The second job waits for the first.
    expect(h.engine.calls).toHaveLength(1);
    h.engine.answer('こんにちは。');
    await flush();
    expect(h.engine.calls.map((c) => c.text)).toEqual(['Hello.', 'How are you?']);
    h.engine.answer('お元気ですか？');
    await flush();
    expect(h.of('translationOpened')).toEqual([{ ref: 1, origin: 'a' }, { ref: 2, origin: 'a' }]);
    expect(h.of('translationText')).toEqual([
      { ref: 1, text: 'こんにちは。', stableLen: 6, language: 'ja' },
      { ref: 2, text: 'お元気ですか？', stableLen: 7, language: 'ja' },
    ]);
    expect(h.frames().filter((t) => String(t).startsWith('local.translation'))).toEqual(['local.translation.start', 'local.translation.end', 'local.translation.start', 'local.translation.end']);
    await h.session.stop();
    expect(h.engine.disposes).toBe(1);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('Bing is told nothing', async () => {
    const h = await setup({ config: BING });
    expect(h.engine.inits).toEqual([{ sourceLang: 'en', targetLang: 'ja', modelId: 'bing-translator' }]);
    h.session.source(closed('a', 'Hello.'));
    await flush();
    expect(h.engine.calls).toEqual([{ text: 'Hello.', systemPrompt: '', wrapTranscript: false }]);
  });

  it('a job that fails is one notice, in the words the whole session uses, and the next job runs', async () => {
    const h = await setup({ config: BING });
    h.session.source(closed('a', 'One.'));
    h.session.source(closed('b', 'Two.'));
    h.session.source(closed('c', 'Three.'));
    h.session.source(closed('d', 'Four.'));
    await flush();
    h.engine.reject(new Error('[bing:network] HTTP 503'));
    await flush();
    h.engine.reject(new Error('[bing:token] no token'));
    await flush();
    h.engine.reject(new Error('[bing:unknown] odd answer'));
    await flush();
    h.engine.answer('四。');
    await flush();
    expect(h.of('degraded').map((d) => [d.code, d.message])).toEqual([
      ['translation_failed', 'Bing Translator is temporarily unavailable.'],
      ['translation_failed', 'Bing Translator could not connect. Check your network and try again.'],
      ['translation_failed', 'Bing Translator failed: odd answer'],
    ]);
    expect(h.of('translationText').map((t) => t.text)).toEqual(['四。']);
    expect(h.of('translationOpened')).toEqual([{ ref: 1, origin: 'd' }]);
    expect(h.of('failed')).toEqual([]);
    await h.session.stop();
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a blank answer is said: under another provider\'s transcription a row with no translation and no word of why is worse than a notice', async () => {
    const h = await setup();
    h.session.source(closed('a', 'Hello.'));
    await flush();
    h.engine.answer('');
    await flush();
    expect(h.of('degraded')).toEqual([expect.objectContaining({ code: 'translation_failed', reason: 'translation_empty' })]);
    expect(h.of('translationOpened')).toEqual([]);
    await h.session.stop();
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a lost GPU device ends the unit: failed, the engine let go, and nothing more', async () => {
    const h = await setup();
    h.session.source(closed('a', 'One.'));
    h.session.source(closed('b', 'Two.'));
    await flush();
    h.engine.reject(new Error('WebGPU device lost: reason unknown'));
    await flush();
    expect(h.of('failed')).toEqual([expect.objectContaining({ message: 'The GPU device was lost: WebGPU device lost: reason unknown' })]);
    expect(h.of('degraded')).toEqual([]);
    expect(h.engine.calls).toHaveLength(1);
    expect(h.engine.disposes).toBe(1);
    expect(h.log[h.log.length - 1].kind).toBe('failed');
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a worker that dies ends the unit at once, with a job in flight or with none', async () => {
    const busy = await setup();
    busy.session.source(closed('a', 'One.'));
    busy.session.source(closed('b', 'Two.'));
    await flush();
    busy.engine.fatal('RuntimeError: unreachable');
    await flush();
    expect(busy.of('failed')).toEqual([{ message: 'Translation stopped: RuntimeError: unreachable' }]);
    expect(busy.engine.disposes).toBe(1);
    // What the dead worker's request settles with afterwards is unheard.
    busy.engine.answer('一。');
    busy.engine.fatal('again');
    await flush();
    expect(busy.log[busy.log.length - 1].kind).toBe('failed');
    expect(busy.of('failed')).toHaveLength(1);
    expect(busy.clock.pending()).toBe(0);
    expect(checkTranslation(busy.log)).toEqual([]);

    const idle = await setup();
    idle.engine.fatal('gone');
    expect(idle.of('failed')).toEqual([{ message: 'Translation stopped: gone' }]);
    idle.session.source(closed('a', 'One.'));
    await flush();
    expect(idle.engine.calls).toEqual([]);
    expect(checkTranslation(idle.log)).toEqual([]);
  });

  it('a stop in the middle of a job is clean: the engine is let go, no timer stays armed, and the late answer is unheard', async () => {
    const h = await setup();
    h.session.source(closed('a', 'One.'));
    h.session.source(closed('b', 'Two.'));
    await flush();
    await h.session.stop();
    const said = h.log.length;
    h.engine.answer('一。');
    h.engine.fatal('disposed');
    await flush();
    expect(h.log).toHaveLength(said);
    expect(h.engine.calls).toHaveLength(1);
    expect(h.engine.disposes).toBe(1);
    expect(h.clock.pending()).toBe(0);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it("a job no engine can take back is given up at its deadline, a model's later than Bing's, and its late answer is dropped", async () => {
    expect(LOCAL_MODEL_JOB_TIMEOUT_MS).toBeGreaterThan(JOB_TIMEOUT_MS);
    for (const [config, ms] of [[MODEL, LOCAL_MODEL_JOB_TIMEOUT_MS], [BING, JOB_TIMEOUT_MS]] as const) {
      const h = await setup({ config });
      h.session.source(closed('a', 'One.'));
      h.session.source(closed('b', 'Two.'));
      await flush();
      h.clock.advance(ms - 1);
      await flush();
      expect(h.of('degraded')).toEqual([]);
      h.clock.advance(1);
      await flush();
      expect(h.of('degraded')).toEqual([expect.objectContaining({ code: 'translation_failed', reason: 'translation_timeout' })]);
      // The engine was not asked to stop; its answer to the first job comes late and is not shown.
      h.engine.answer('一。');
      await flush();
      expect(h.of('translationText')).toEqual([]);
      h.engine.answer('二。');
      await flush();
      expect(h.of('translationText').map((t) => t.text)).toEqual(['二。']);
      expect(h.of('translationOpened')).toEqual([{ ref: 1, origin: 'b' }]);
      await h.session.stop();
      expect(checkTranslation(h.log)).toEqual([]);
    }
  });
});

describe('a leg of three units: another provider transcribes, this device translates, a third speaks', () => {
  const SPEAKS: SessionContext = { direction: EN_JA, speech: true, turns: 'auto' };
  const [transcriber] = fakeTranscriberProvider.units;
  const [voice] = fakeVoiceProvider.units;
  const local = stubProvider('local_inference');

  function planOver(engines: Record<string, FakeTranslation>): RunPlan {
    // One engine per direction: each leg loads its own.
    const made = createLocalTranslationUnit({ engines: { translation: () => { throw new Error('no direction'); } } });
    const translation: PlannedUnit = {
      provider: local,
      unit: { ...made, startTranslation: (request, events) => createLocalTranslationUnit({ engines: { translation: () => engines[`${request.context.direction.source}>${request.context.direction.target}`] } }).startTranslation!(request, events) },
      stages: ['translation'],
    };
    return separatePlan(
      { provider: fakeTranscriberProvider, unit: transcriber, stages: ['transcription'] },
      translation,
      { provider: fakeVoiceProvider, unit: voice, stages: ['speech'] },
    );
  }

  function requestFor(p: RunPlan, context: SessionContext, clock: ReturnType<typeof createVirtualClock>, lineUp: StageIds | null, signal = new AbortController().signal): StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown> {
    const settings = new Map<PlannedUnit, unknown>([[p.byStage.transcription, FAKE_TRANSCRIBER_DEFAULTS], [p.byStage.translation, SETTINGS], [p.byStage.speech, {}]]);
    const config: PlanConfigs = new Map(p.units.map((u) => [u, u.unit.build({ ...context, speech: context.speech && u.stages.includes('speech') }, settings.get(u), shared({ lineUp: lineUp ?? undefined }))]));
    return { context, config, credentials: () => ({}), clock, signal };
  }

  async function leg(lineUp: StageIds | null = { transcription: 'fake_transcriber', translation: 'local_inference', speech: 'fake_voice' }) {
    const engine = new FakeTranslation();
    const p = planOver({ 'en>ja': engine });
    const clock = createVirtualClock(0);
    const rec = recordConformance();
    const starting = startComposite(p, requestFor(p, SPEAKS, clock, lineUp), rec.events);
    const run = async (ms: number, step = 100) => {
      for (let at = 0; at < ms; at += step) {
        clock.advance(step);
        await flush();
      }
    };
    const of = (kind: string) => rec.log.filter((e) => e.kind === kind).map((e) => e.payload as Record<string, unknown>);
    const answer = async (text: string) => {
      engine.answer(text);
      await flush();
    };
    const stop = async (session: Awaited<typeof starting>) => {
      rec.mark('stop');
      await session.stop();
      rec.mark('stopped');
    };
    return { p, engine, clock, rec, starting, run, of, answer, stop };
  }

  it('is a plan the composite runs with its stages apart', () => {
    expect(separateStages(planOver({}))).not.toBeNull();
  });

  it('the model loads before the transcriber starts, and its loading is the translation stage\'s', async () => {
    const h = await leg();
    let started = false;
    void h.starting.then(() => { started = true; });
    await h.run(2_000);
    expect(h.engine.inits).toEqual([{ sourceLang: 'en', targetLang: 'ja', modelId: 'opus-mt-en-jap' }]);
    // Nothing is heard while the model loads: the unit that transcribes has not been started.
    expect(started).toBe(false);
    expect(h.of('segmentOpened')).toEqual([]);
    h.engine.ready();
    const session = await h.starting;
    expect(h.of('loading')).toEqual([{ stage: 'translation', done: 1, total: 1, runStage: 'translation' }]);
    await h.run(700);
    expect(h.of('segmentOpened')).toEqual([{ ref: 1, side: 'source', origin: 'h1' }]);
    await h.stop(session);
    expect(checkConformance(h.rec.log, SPEAKS)).toEqual([]);
  });

  it('a model that cannot load fails the start, and the transcriber is never started', async () => {
    const h = await leg();
    h.engine.failInit('no such file');
    await expect(h.starting).rejects.toThrow('Translation engine init failed: no such file');
    await h.run(2_000);
    expect(h.of('segmentOpened')).toEqual([]);
    expect(h.engine.disposes).toBe(1);
  });

  it('translates each stable sentence while the source is open and the rest at its close, on the transcriber\'s rows, read in order', async () => {
    const h = await leg();
    h.engine.ready();
    const session = await h.starting;
    await h.run(700);
    expect(h.engine.calls.map((c) => c.text)).toEqual(['Hello.']);
    await h.answer('こんにちは。');
    // The first sentence is translated while its source is still open.
    expect(h.of('segmentOpened')).toEqual([{ ref: 1, side: 'source', origin: 'h1' }, { ref: 2, side: 'translation', origin: 'h1' }]);
    await h.run(2_000);
    expect(h.engine.calls.map((c) => c.text)).toEqual(['Hello.', 'How are you today?']);
    await h.answer('今日はお元気ですか？');
    await h.run(7_000);
    expect(h.engine.calls.map((c) => c.text)).toEqual(['Hello.', 'How are you today?', 'I am fine, thank you.']);
    await h.answer('元気です、ありがとう。');
    // The voice reads on the clock.
    await h.run(1_000);
    expect(h.of('segmentOpened')).toEqual([
      { ref: 1, side: 'source', origin: 'h1' },
      { ref: 2, side: 'translation', origin: 'h1' },
      { ref: 3, side: 'translation', origin: 'h1' },
      { ref: 4, side: 'source', origin: 'h2' },
      { ref: 5, side: 'translation', origin: 'h2' },
    ]);
    const last = new Map(h.of('segmentText').map((e) => [e.ref as number, e.text as string]));
    expect([last.get(2), last.get(3), last.get(5)]).toEqual(['こんにちは。', '今日はお元気ですか？', '元気です、ありがとう。']);
    expect((h.of('audio') as Array<{ ref: number }>).map((a) => a.ref)).toEqual([2, 3, 5]);
    await h.stop(session);
    expect(h.engine.disposes).toBe(1);
    expect(checkConformance(h.rec.log, SPEAKS)).toEqual([]);
  });

  it('a job that fails is one notice of the translation stage, its row keeps its source, and later jobs still run', async () => {
    const h = await leg();
    h.engine.ready();
    const session = await h.starting;
    await h.run(700);
    h.engine.reject(new Error('The model produced no tokens.'));
    await flush();
    await h.run(2_000);
    await h.answer('今日はお元気ですか？');
    await h.run(7_000);
    await h.answer('元気です、ありがとう。');
    expect(h.of('degraded')).toEqual([expect.objectContaining({ code: 'translation_failed', message: 'The model produced no tokens.', runStage: 'translation' })]);
    expect(h.of('segmentOpened').map((e) => [e.side, e.origin])).toEqual([['source', 'h1'], ['translation', 'h1'], ['source', 'h2'], ['translation', 'h2']]);
    expect(h.of('failed')).toEqual([]);
    await h.stop(session);
    expect(checkConformance(h.rec.log, SPEAKS)).toEqual([]);
  });

  it('a worker that dies fails the leg, naming the translation stage, and nothing follows', async () => {
    const h = await leg();
    h.engine.ready();
    await h.starting;
    await h.run(700);
    h.engine.fatal('RuntimeError: unreachable');
    await h.run(10_000);
    expect(h.of('failed')).toEqual([expect.objectContaining({ message: 'Translation stopped: RuntimeError: unreachable', runStage: 'translation' })]);
    expect(h.rec.log[h.rec.log.length - 1].kind).toBe('failed');
    expect(h.engine.disposes).toBe(1);
    expect(h.clock.pending()).toBe(0);
    expect(checkConformance(h.rec.log, SPEAKS)).toEqual([]);
  });

  it('a stop in the middle of a job says nothing after it', async () => {
    const h = await leg();
    h.engine.ready();
    const session = await h.starting;
    await h.run(700);
    expect(h.engine.calls).toHaveLength(1);
    await h.stop(session);
    const said = h.rec.log.length;
    await h.answer('こんにちは。');
    await h.run(10_000);
    expect(h.rec.log).toHaveLength(said);
    expect(h.engine.disposes).toBe(1);
    expect(h.clock.pending()).toBe(0);
    expect(checkConformance(h.rec.log, SPEAKS)).toEqual([]);
  });

  it('both legs: each loads the model of its own direction and translates its own way', async () => {
    const engines = { 'en>ja': new FakeTranslation(), 'ja>en': new FakeTranslation() };
    const p = planOver(engines);
    const clock = createVirtualClock(0);
    const lineUp: StageIds = { transcription: 'fake_transcriber', translation: 'local_inference', speech: 'fake_voice' };
    const contexts = { speaker: SPEAKS, participant: { direction: JA_EN, speech: true, turns: 'auto' } as SessionContext };
    const rec = { speaker: recordConformance(), participant: recordConformance() };
    const starting = startCompositeBoth(
      p,
      { speaker: requestFor(p, contexts.speaker, clock, lineUp), participant: requestFor(p, contexts.participant, clock, lineUp) },
      { speaker: rec.speaker.events, participant: rec.participant.events },
    );
    await flush();
    expect(engines['en>ja'].inits).toEqual([{ sourceLang: 'en', targetLang: 'ja', modelId: 'opus-mt-en-jap' }]);
    expect(engines['ja>en'].inits).toEqual([{ sourceLang: 'ja', targetLang: 'en', modelId: 'opus-mt-ja-en' }]);
    engines['en>ja'].ready();
    engines['ja>en'].ready();
    const sessions = await starting;
    for (let at = 0; at < 700; at += 100) {
      clock.advance(100);
      await flush();
    }
    engines['en>ja'].answer('こんにちは。');
    engines['ja>en'].answer('Hello there.');
    await flush();
    const translations = (name: 'speaker' | 'participant') => rec[name].log.flatMap((e) => (e.kind === 'segmentText' && e.payload.language !== undefined ? [[e.payload.text, e.payload.language]] : []));
    expect(translations('speaker')).toEqual([['こんにちは。', 'ja']]);
    expect(translations('participant')).toEqual([['Hello there.', 'en']]);
    for (const name of ['speaker', 'participant'] as const) {
      rec[name].mark('stop');
      await sessions[name].stop();
      rec[name].mark('stopped');
      expect(checkConformance(rec[name].log, contexts[name])).toEqual([]);
    }
    expect(engines['en>ja'].disposes).toBe(1);
    expect(engines['ja>en'].disposes).toBe(1);
  });
});
