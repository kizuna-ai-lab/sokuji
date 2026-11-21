/**
 * The local provider's voice as a speech unit: what it declares, that its
 * config is the voice the whole local session would use, and its sessions
 * over `FakeTts`, held to the speech rules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdapterEvents, Ref, SessionContext } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import type { SpeechStartRequest } from '../../lib/contract/speech';
import { checkSpeech, recordSpeech, type SpeechLog } from '../../lib/contract/speechConformance';
import { flush } from '../../lib/contract/testing/drive';
import type { LegName } from '../../lib/conversation/types';
import type { LocalStages } from '../../lib/lineup/localStages';
import type { StageIds } from '../../lib/lineup/types';
import type { DirectionResult } from '../../lib/local-inference/selection/types';
import { buildPlan, describePlan, startComposite, type PlanConfigs } from '../../lib/plan/composite';
import { stubProvider, stubTextUnit, textAndSpeechPlan } from '../../lib/plan/testing';
import { isSpeechUnit, type PlannedUnit } from '../../lib/plan/types';
import type { SharedSettings } from '../../lib/provider/types';

// Prefixed "mock" so Vitest hoists these alongside the vi.mock factories below.
/** What each direction resolves to, keyed `${src}>${tgt}`; Edge serves speech wherever the stages say so. */
let mockTable: Record<string, { asr?: string; translation?: string; tts?: string }> = {};
let mockStagesSeen: Array<LocalStages | null | undefined> = [];
vi.mock('../../stores/modelStore', () => ({
  useModelStore: {
    getState: () => ({
      resolve: (src: string, tgt: string, _selections: unknown, stages?: LocalStages | null): DirectionResult => {
        mockStagesSeen.push(stages);
        const entry = mockTable[`${src}>${tgt}`];
        const stage = (id: string | undefined) => (id ? { modelId: id, source: 'explicit' as const } : null);
        return { asr: stage(entry?.asr), translation: stage(entry?.translation), tts: stage(stages?.speech === 'edge' ? 'edge-tts' : entry?.tts), notes: [], prunes: [] };
      },
      deviceFeatures: [],
    }),
  },
}));

let mockStored: LocalStages | null = null;
vi.mock('../../stores/lineUpStore', () => ({ storedLocalStages: () => mockStored }));

/** Per-model memory in MB; the rest of the manifest is the real one. */
let mockSizes: Record<string, number> = {};
vi.mock('../../lib/local-inference/modelManifest', async (original) => ({
  ...(await original<typeof import('../../lib/local-inference/modelManifest')>()),
  estimateModelMemoryByDevice: (ids: ReadonlyArray<string | undefined | null>) => ({ vramMb: 0, ramMb: ids.reduce((sum: number, id) => sum + ((id && mockSizes[id]) || 0), 0) }),
}));

import { buildLocalInference, type LocalInferenceConfig, type LocalTtsConfig } from './config';
import { FakeTts } from './fakeEngines';
import { LOCAL_INFERENCE_DEFAULTS, type LocalInferenceSettings } from './settings';
import { EDGE_TTS_LANGUAGES } from '../../lib/local-inference/languageSupport';
import { getTtsModelsForLanguage } from '../../lib/local-inference/modelManifest';
import { admitLocalSpeech, areLocalSpeechConfigs, createLocalSpeechUnit, localSpeechUnit, type LocalSpeechConfig } from './speechUnit';

const JA_EN = { source: 'ja', target: 'en' };
const EN_JA = { source: 'en', target: 'ja' };
const ctx = (direction: SessionContext['direction'], speech = true): SessionContext => ({ direction, speech, turns: 'auto' });
const shared = (over: { reversed?: boolean; lineUp?: StageIds } = {}): SharedSettings => ({
  pauses: { sourceSeconds: 0, translationSeconds: 0 },
  reversed: () => over.reversed ?? false,
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
  ...(over.lineUp ? { lineUp: over.lineUp } : {}),
});
const SETTINGS: LocalInferenceSettings = {
  ...LOCAL_INFERENCE_DEFAULTS,
  ttsSpeed: 1.25,
  voices: { 'ja→en': { edge: 'en-US-AvaNeural', speaker: 3 }, 'en→ja': { edge: 'ja-JP-NanamiNeural', speaker: 5 } },
};
const LOCAL_VOICE: LocalTtsConfig = { modelId: 'fake-tts-model', speakerId: 2, speed: 1 };
const EDGE_VOICE: LocalTtsConfig = { modelId: 'edge-tts', speakerId: 0, speed: 1, edgeVoice: 'en-US-AvaNeural' };

beforeEach(() => {
  mockTable = { 'ja>en': { asr: 'asr-ja', translation: 'mt', tts: 'tts-en' }, 'en>ja': { asr: 'asr-en', translation: 'mt', tts: 'tts-ja' } };
  mockStagesSeen = [];
  mockStored = null;
  mockSizes = {};
  localStorage.clear();
});

/** A recorded session of the unit over one `FakeTts`, not opened yet. */
function create(over: { config?: LocalSpeechConfig; leg?: LegName; counts?: Map<Ref, number>; tts?: FakeTts } = {}) {
  const clock = createVirtualClock(0);
  const tts = over.tts ?? new FakeTts();
  tts.samplesPerSentence = 240;
  let made = 0;
  const unit = createLocalSpeechUnit({ engines: { tts: () => { made++; return tts; } } });
  const counts = over.counts ?? new Map<Ref, number>();
  const request: SpeechStartRequest<LocalSpeechConfig, Record<string, never>> = {
    leg: over.leg ?? 'speaker',
    context: ctx(JA_EN),
    config: over.config ?? LOCAL_VOICE,
    credentials: {},
    clock,
    signal: new AbortController().signal,
    counts,
  };
  const { session, log } = recordSpeech(unit.startSpeech!, request);
  return { clock, tts, session, log, counts, engines: () => made };
}

/** The same, with its model loaded. */
async function setup(over: Parameters<typeof create>[0] = {}) {
  const made = create(over);
  const opening = made.session.open();
  made.tts.ready();
  await opening;
  return made;
}

const audioOf = (log: SpeechLog) => log.flatMap((e) => (e.kind === 'audio' ? [e.payload] : []));
const degradedOf = (log: SpeechLog) => log.flatMap((e) => (e.kind === 'degraded' ? [e.payload] : []));
const framesOf = (log: SpeechLog, type: string) => log.flatMap((e) => (e.kind === 'frame' && e.payload.type === type ? [e.payload] : []));
const eventsOf = (log: SpeechLog) => log.filter((e) => ['audio', 'speechRanges', 'degraded', 'frame'].includes(e.kind));

describe("the local provider's speech unit", () => {
  it('is a speech unit that occupies speech when asked for exactly that', () => {
    expect(localSpeechUnit.id).toBe('speech');
    expect(isSpeechUnit(localSpeechUnit)).toBe(true);
    expect(localSpeechUnit.start).toBeUndefined();
    expect(localSpeechUnit.occupies(SETTINGS, new Set(['speech']))).toEqual(['speech']);
    expect(localSpeechUnit.occupies(SETTINGS, new Set(['translation', 'speech']))).toBeNull();
    expect(localSpeechUnit.occupies(SETTINGS, new Set(['transcription', 'translation', 'speech']))).toBeNull();
    expect(localSpeechUnit.occupies(SETTINGS, new Set(['transcription', 'translation']))).toBeNull();
    expect(localSpeechUnit.occupies(SETTINGS, new Set())).toBeNull();
  });

  it('says what the voice can do', () => {
    expect(localSpeechUnit.capabilities(SETTINGS)).toEqual({
      speech: 'optional', turns: ['auto', 'manual'], turnOwner: 'either', boundaries: 'silence', textInput: false, faceToFace: true, participantSpeech: true,
      speaks: expect.any(Function),
    });
  });

  describe('the languages it speaks', () => {
    const speaks = (language: string) => localSpeechUnit.capabilities(SETTINGS).speaks!(language);
    // Basque: no speech model of the catalog and no Edge voice. Javanese: an Edge voice, and no speech model.
    it("Edge's own list where the line-up gives speech to Edge", () => {
      mockStored = { translation: null, speech: 'edge' };
      expect(['en', 'ja', 'jv', 'pt-BR'].map(speaks)).toEqual([true, true, true, true]);
      expect(['eu', 'xx'].map(speaks)).toEqual([false, false]);
      expect(EDGE_TTS_LANGUAGES).toContain('jv');
      expect(EDGE_TTS_LANGUAGES).not.toContain('eu');
    });
    it('the languages some speech model of the catalog speaks, downloaded or not, where a model on this machine speaks', () => {
      mockStored = { translation: null, speech: 'local' };
      expect(getTtsModelsForLanguage('en').some((m) => !m.isCloudModel)).toBe(true);
      expect(getTtsModelsForLanguage('jv').some((m) => !m.isCloudModel)).toBe(false);
      expect(['en', 'jv', 'eu'].map(speaks)).toEqual([true, false, false]);
    });
    it('either while no line-up is stored: Edge is among the local choices then', () => {
      mockStored = null;
      expect(['en', 'jv', 'eu'].map(speaks)).toEqual([true, true, false]);
    });
  });

  describe('build', () => {
    const whole = (context: SessionContext, sh: SharedSettings) => (buildLocalInference(context, SETTINGS, sh) as LocalInferenceConfig).tts;

    it("is the voice the whole local session builds for the same settings and direction, on the speaker's leg and the participant's", () => {
      for (const stored of [null, { translation: 'bing', speech: 'edge' }, { translation: 'local', speech: 'local' }] as const) {
        mockStored = stored;
        expect(localSpeechUnit.build(ctx(JA_EN), SETTINGS, shared())).toEqual(whole(ctx(JA_EN), shared()));
        expect(localSpeechUnit.build(ctx(EN_JA), SETTINGS, shared({ reversed: true }))).toEqual(whole(ctx(EN_JA), shared({ reversed: true })));
      }
      mockStored = null;
      expect(localSpeechUnit.build(ctx(JA_EN), SETTINGS, shared())).toEqual({ modelId: 'tts-en', speakerId: 3, speed: 1.25, edgeVoice: 'en-US-AvaNeural' });
      expect(localSpeechUnit.build(ctx(EN_JA), SETTINGS, shared({ reversed: true }))).toEqual({ modelId: 'tts-ja', speakerId: 5, speed: 1.25, edgeVoice: 'ja-JP-NanamiNeural' });
    });

    it('is the same again when the run hands over a line-up that is all on this device, whatever the store holds', () => {
      // The store disagrees with the frozen line-up: the frozen one is read.
      mockStored = { translation: null, speech: 'local' };
      const edge = shared({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge' } });
      expect(localSpeechUnit.build(ctx(JA_EN), SETTINGS, edge)).toEqual({ modelId: 'edge-tts', speakerId: 3, speed: 1.25, edgeVoice: 'en-US-AvaNeural' });
      expect(localSpeechUnit.build(ctx(JA_EN), SETTINGS, edge)).toEqual(whole(ctx(JA_EN), edge));
      expect(mockStagesSeen.every((s) => s?.translation === 'bing' && s.speech === 'edge')).toBe(true);

      mockStored = { translation: 'bing', speech: 'edge' };
      const local = shared({ lineUp: { transcription: 'local_inference', translation: 'local_inference', speech: 'local_inference' } });
      expect(localSpeechUnit.build(ctx(JA_EN), SETTINGS, local)).toEqual({ modelId: 'tts-en', speakerId: 3, speed: 1.25, edgeVoice: 'en-US-AvaNeural' });
      expect(localSpeechUnit.build(ctx(JA_EN), SETTINGS, local)).toEqual(whole(ctx(JA_EN), local));
    });

    it("reads Edge, or the direction's local voice model, from a line-up whose text is another provider's", () => {
      const edge = shared({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'edge' } });
      expect(localSpeechUnit.build(ctx(JA_EN), SETTINGS, edge)).toEqual({ modelId: 'edge-tts', speakerId: 3, speed: 1.25, edgeVoice: 'en-US-AvaNeural' });
      const local = shared({ reversed: true, lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'local_inference' } });
      mockStagesSeen = [];
      expect(localSpeechUnit.build(ctx(EN_JA), SETTINGS, local)).toEqual({ modelId: 'tts-ja', speakerId: 5, speed: 1.25, edgeVoice: 'ja-JP-NanamiNeural' });
      // Among this machine's models only: Edge is not one of the local choices under a line-up.
      expect(mockStagesSeen.map((s) => s?.speech)).toEqual(['local']);
    });

    it('is off for a leg that does not speak, and names no model', () => {
      const off = localSpeechUnit.build(ctx(JA_EN, false), SETTINGS, shared());
      expect(off).toEqual({ off: true });
      expect(localSpeechUnit.describe(off as LocalSpeechConfig)).toEqual({});
      expect(localSpeechUnit.describe(LOCAL_VOICE)).toEqual({ ttsModel: 'fake-tts-model' });
    });

    it('is off, with the reason, for a leg that should speak and has no speech model: as the whole local session, which goes on text only', () => {
      mockTable = { 'ja>en': { asr: 'asr-ja', translation: 'mt' }, 'en>ja': { asr: 'asr-en', translation: 'mt' } };
      expect(localSpeechUnit.build(ctx(JA_EN), SETTINGS, shared())).toEqual({ off: true, unavailable: 'speaker_tts_missing' });
      expect(localSpeechUnit.build(ctx(EN_JA), SETTINGS, shared({ reversed: true }))).toEqual({ off: true, unavailable: 'participant_tts_missing' });
      expect((buildLocalInference(ctx(JA_EN), SETTINGS, shared()) as LocalInferenceConfig).ttsUnavailable).toBe('speaker_tts_missing');
      expect((buildLocalInference(ctx(EN_JA), SETTINGS, shared({ reversed: true })) as LocalInferenceConfig).ttsUnavailable).toBe('participant_tts_missing');
      expect(localSpeechUnit.describe({ off: true, unavailable: 'speaker_tts_missing' })).toEqual({});
    });
  });

  describe('a session', () => {
    it('loads its model when it opens, on one engine for the session', async () => {
      const t = create();
      expect(t.engines()).toBe(1);
      expect(t.tts.inits).toEqual([]);
      const opening = t.session.open();
      expect(t.tts.inits).toEqual(['fake-tts-model']);
      t.tts.ready();
      await opening;
      expect(framesOf(t.log, 'local.init.tts.start')).toHaveLength(1);
      expect(framesOf(t.log, 'local.init.tts.ready')).toHaveLength(1);
      expect(degradedOf(t.log)).toEqual([]);
      expect(t.engines()).toBe(1);
    });

    it('reads a stretch of several sentences as one clip each, with each range counted in the whole translation', async () => {
      const t = await setup();
      t.session.speak(4, 'Hello there. How are you?', [0, 25], 'en');
      await flush();
      expect(audioOf(t.log).map((a) => [a.ref, a.range, a.pcm.length])).toEqual([[4, [0, 12], 240], [4, [13, 25], 240]]);
      // A later stretch of the same row, whose span does not start at 0.
      t.session.speak(4, ' Fine. And you?', [25, 40], 'en');
      t.session.endUtterance(4);
      await flush();
      expect(audioOf(t.log).map((a) => a.range)).toEqual([[0, 12], [13, 25], [26, 31], [32, 40]]);
      expect(t.counts.get(4)).toBe(4);
      expect(checkSpeech(t.log)).toEqual([]);
    });

    it('reads stretches in the order they came, one at a time, rows kept apart', async () => {
      const t = await setup();
      t.tts.holdGenerate = true;
      t.session.speak(1, 'One.', [0, 4], 'en');
      t.session.speak(2, 'Two.', [10, 14], 'en');
      await flush();
      // The engine takes one request at a time.
      expect(t.tts.generateCalls.map((c) => c.text)).toEqual(['One.']);
      t.tts.release();
      await flush();
      expect(t.tts.generateCalls.map((c) => c.text)).toEqual(['One.', 'Two.']);
      t.tts.release();
      await flush();
      expect(audioOf(t.log).map((a) => [a.ref, a.range])).toEqual([[1, [0, 4]], [2, [10, 14]]]);
      expect([t.counts.get(1), t.counts.get(2)]).toEqual([1, 1]);
      expect(checkSpeech(t.log)).toEqual([]);
    });

    it('text handed over before the model has loaded is read once it has', async () => {
      const t = create();
      const opening = t.session.open();
      t.session.speak(1, 'Early.', [0, 6], 'en');
      await flush();
      expect(t.tts.generateCalls).toEqual([]);
      t.tts.ready();
      await opening;
      await flush();
      expect(audioOf(t.log).map((a) => a.range)).toEqual([[0, 6]]);
      expect(checkSpeech(t.log)).toEqual([]);
    });

    it('speaks through a local model with its speaker, speed and the language it is told', async () => {
      const t = await setup({ config: { modelId: 'fake-tts-model', speakerId: 7, speed: 1.5 } });
      t.session.speak(1, 'こんにちは。', [0, 6], 'ja');
      await flush();
      expect(t.tts.generateCalls).toEqual([{ text: 'こんにちは。', sid: 7, speed: 1.5, lang: 'ja' }]);
      expect(t.tts.streamCalls).toEqual([]);
      expect(framesOf(t.log, 'local.tts.start')).toHaveLength(1);
      expect(framesOf(t.log, 'local.tts.end')).toHaveLength(1);
      expect(checkSpeech(t.log)).toEqual([]);
    });

    it("speaks through Edge in the direction's voice, a sentence's chunks gathered into one clip", async () => {
      const tts = new FakeTts();
      tts.chunksPerSentence = 3;
      tts.samplesPerChunk = 100;
      const t = await setup({ config: EDGE_VOICE, tts });
      expect(tts.inits).toEqual(['edge-tts']);
      t.session.speak(1, 'One. Two.', [20, 29], 'en');
      await flush();
      expect(tts.streamCalls).toEqual([
        { text: 'One.', sid: 0, speed: 1, lang: 'en', voice: 'en-US-AvaNeural' },
        { text: 'Two.', sid: 0, speed: 1, lang: 'en', voice: 'en-US-AvaNeural' },
      ]);
      expect(tts.generateCalls).toEqual([]);
      expect(audioOf(t.log).map((a) => [a.range, a.pcm.length])).toEqual([[[20, 24], 300], [[25, 29], 300]]);
      expect(checkSpeech(t.log)).toEqual([]);
    });

    it("names the leg a row belongs to on audio it reads for another leg's row", async () => {
      const t = await setup({ leg: 'participant' });
      t.session.speak(1, 'Mine.', [0, 5], 'en');
      t.session.speak(2, 'Theirs.', [0, 7], 'en', 'speaker');
      await flush();
      expect(audioOf(t.log).map((a) => [a.ref, a.home])).toEqual([[1, undefined], [2, 'speaker']]);
      expect('home' in audioOf(t.log)[0]).toBe(false);
      expect(checkSpeech(t.log)).toEqual([]);
    });

    it('a sentence that cannot be spoken is said and left out; the next is read', async () => {
      const t = await setup();
      t.tts.failOn.add(0);
      t.session.speak(1, 'One. Two.', [0, 9], 'en');
      await flush();
      expect(degradedOf(t.log).map((d) => d.code)).toEqual(['tts_degraded']);
      expect(audioOf(t.log).map((a) => a.range)).toEqual([[5, 9]]);
      t.session.speak(1, ' Three.', [9, 16], 'en');
      await flush();
      expect(audioOf(t.log).map((a) => a.range)).toEqual([[5, 9], [10, 16]]);
      expect(checkSpeech(t.log)).toEqual([]);
    });

    it("ending a row's utterance does not cut what is still queued for it", async () => {
      const t = await setup();
      t.tts.holdGenerate = true;
      t.session.speak(1, 'One.', [0, 4], 'en');
      t.session.speak(1, ' Two.', [4, 9], 'en');
      t.session.endUtterance(1);
      await flush();
      t.tts.release();
      await flush();
      t.tts.release();
      await flush();
      expect(audioOf(t.log).map((a) => a.range)).toEqual([[0, 4], [5, 9]]);
      expect(checkSpeech(t.log)).toEqual([]);
    });

    describe('speech switched off and on', () => {
      it('off mid-synthesis: the queue is emptied and the clip that arrives afterwards is not heard, also once the row is read again', async () => {
        const t = await setup();
        t.tts.holdGenerate = true;
        t.session.speak(1, 'One. Two.', [0, 9], 'en');
        t.session.speak(1, ' Three.', [9, 16], 'en');
        await flush();
        expect(t.tts.generateCalls.map((c) => c.text)).toEqual(['One.']);
        t.session.setOn(false);
        // Handed over while off: never read.
        t.session.speak(1, ' Four.', [16, 22], 'en');
        t.session.setOn(true);
        t.session.speak(1, ' Five.', [22, 28], 'en');
        await flush();
        // The sentence being synthesized has not settled: the engine is asked nothing new meanwhile.
        expect(t.tts.generateCalls.map((c) => c.text)).toEqual(['One.']);
        t.tts.release();
        await flush();
        expect(audioOf(t.log)).toEqual([]);
        expect(t.tts.generateCalls.map((c) => c.text)).toEqual(['One.', 'Five.']);
        t.tts.release();
        await flush();
        expect(audioOf(t.log).map((a) => [a.ref, a.range])).toEqual([[1, [23, 28]]]);
        expect(t.counts.get(1)).toBe(1);
        expect(checkSpeech(t.log)).toEqual([]);
      });

      it('off between two sentences of a stretch: the rest of it is not synthesized', async () => {
        const t = await setup();
        t.tts.holdGenerate = true;
        t.session.speak(1, 'One. Two. Three.', [0, 16], 'en');
        await flush();
        t.tts.release();
        await flush();
        expect(audioOf(t.log).map((a) => a.range)).toEqual([[0, 4]]);
        t.session.setOn(false);
        t.tts.release();
        await flush();
        expect(t.tts.generateCalls.map((c) => c.text)).toEqual(['One.', 'Two.']);
        expect(audioOf(t.log).map((a) => a.range)).toEqual([[0, 4]]);
        expect(framesOf(t.log, 'local.tts.end')).toEqual([]);
        expect(checkSpeech(t.log)).toEqual([]);
      });

      it('text handed over while off is not read when speech comes back', async () => {
        const t = await setup();
        t.session.setOn(false);
        t.session.speak(1, 'Unheard.', [0, 8], 'en');
        t.session.setOn(true);
        await flush();
        expect(t.tts.generateCalls).toEqual([]);
        t.session.speak(2, 'Heard.', [0, 6], 'en');
        await flush();
        expect(audioOf(t.log).map((a) => a.ref)).toEqual([2]);
        expect(checkSpeech(t.log)).toEqual([]);
      });
    });

    describe('a voice that cannot open, or dies', () => {
      it('a model that does not load is said once; open resolves, and nothing is read afterwards', async () => {
        const t = create();
        const opening = t.session.open();
        t.session.speak(1, 'Early.', [0, 6], 'en');
        t.tts.failInit('no such model');
        await expect(opening).resolves.toBeUndefined();
        expect(degradedOf(t.log)).toEqual([expect.objectContaining({ code: 'tts_degraded', message: 'TTS unavailable, continuing without it: no such model' })]);
        expect(framesOf(t.log, 'local.init.tts.error')).toHaveLength(1);
        expect(t.tts.disposes).toBe(1);
        t.session.speak(1, ' Late.', [6, 12], 'en');
        t.session.setOn(false);
        t.session.setOn(true);
        t.session.speak(2, 'Later.', [0, 6], 'en');
        await flush();
        expect(t.tts.generateCalls).toEqual([]);
        expect(audioOf(t.log)).toEqual([]);
        expect(degradedOf(t.log)).toHaveLength(1);
        t.session.close();
        expect(t.tts.disposes).toBe(1);
        expect(checkSpeech(t.log)).toEqual([]);
      });

      it('an engine that dies mid-session is said once; what it was reading is dropped and nothing is read afterwards', async () => {
        const t = await setup();
        t.tts.holdGenerate = true;
        t.session.speak(1, 'One. Two.', [0, 9], 'en');
        t.session.speak(2, 'Three.', [0, 6], 'en');
        await flush();
        t.tts.die('RuntimeError: unreachable');
        await flush();
        expect(degradedOf(t.log)).toEqual([{ code: 'tts_degraded', message: 'Speech synthesis stopped: RuntimeError: unreachable' }]);
        expect(t.tts.disposes).toBe(1);
        t.tts.die('again');
        t.tts.holdGenerate = false;
        t.session.speak(3, 'Four.', [0, 5], 'en');
        await flush();
        expect(t.tts.generateCalls.map((c) => c.text)).toEqual(['One.']);
        expect(audioOf(t.log)).toEqual([]);
        expect(degradedOf(t.log)).toHaveLength(1);
        expect(checkSpeech(t.log)).toEqual([]);
      });

      it('an engine that dies and never settles what it was synthesizing still leaves the session quiet', async () => {
        const t = await setup();
        t.tts.holdGenerate = true;
        t.tts.holdPastDeath = true;
        t.session.speak(1, 'One.', [0, 4], 'en');
        await flush();
        t.tts.die();
        t.tts.release();
        await flush();
        expect(audioOf(t.log)).toEqual([]);
        expect(degradedOf(t.log)).toHaveLength(1);
        expect(checkSpeech(t.log)).toEqual([]);
      });

      it('a configured speaker the loaded model does not have is said; speech goes on in the model default', async () => {
        const t = create();
        const opening = t.session.open();
        t.tts.ready({ sampleRate: 24000, voices: [{ sid: 0 }, { sid: 1 }] });
        await opening;
        expect(degradedOf(t.log)).toEqual([{ code: 'voice_fallback', message: 'Configured voice 2 is not loaded; using the model default. Update the selection in settings.' }]);
        t.session.speak(1, 'Still.', [0, 6], 'en');
        await flush();
        expect(audioOf(t.log)).toHaveLength(1);
      });
    });

    describe('a leg with no voice', () => {
      it('one that should speak and has no speech model says so once when it opens, with the language, and starts no engine', async () => {
        const t = create({ config: { off: true, unavailable: 'speaker_tts_missing' } });
        await t.session.open();
        await t.session.open();
        expect(degradedOf(t.log)).toEqual([{
          code: 'speaker_tts_missing',
          message: 'Translation the other side hears is text only: no speech model speaks en.',
          params: { target: 'en' },
        }]);
        t.session.speak(1, 'Nothing.', [0, 8], 'en');
        t.session.setOn(false);
        t.session.setOn(true);
        t.session.endUtterance(1);
        t.session.close();
        await flush();
        expect(t.engines()).toBe(0);
        expect(eventsOf(t.log)).toHaveLength(1);
        expect(checkSpeech(t.log)).toEqual([]);
      });

      it("the participant's leg says it in its own words", async () => {
        const t = create({ leg: 'participant', config: { off: true, unavailable: 'participant_tts_missing' } });
        await t.session.open();
        expect(degradedOf(t.log)).toEqual([{ code: 'participant_tts_missing', message: 'Translation I hear is text only: no speech model speaks en.', params: { target: 'en' } }]);
      });

      it('one that does not speak says nothing', async () => {
        const t = create({ config: { off: true } });
        await t.session.open();
        t.session.speak(1, 'Nothing.', [0, 8], 'en');
        t.session.close();
        expect(eventsOf(t.log)).toEqual([]);
        expect(t.engines()).toBe(0);
      });
    });

    describe('close', () => {
      it('mid-synthesis: the engine is let go and nothing is said afterwards, whatever it still answers', async () => {
        const t = await setup();
        t.tts.holdGenerate = true;
        t.tts.holdPastDeath = true;
        t.session.speak(1, 'One. Two.', [0, 9], 'en');
        t.session.speak(2, 'Three.', [0, 6], 'en');
        await flush();
        const before = t.log.length;
        t.session.close();
        expect(t.tts.disposes).toBe(1);
        t.tts.release();
        t.tts.die('late');
        await flush();
        t.session.speak(3, 'Four.', [0, 5], 'en');
        t.session.close();
        await flush();
        expect(eventsOf(t.log.slice(before))).toEqual([]);
        expect(t.tts.generateCalls.map((c) => c.text)).toEqual(['One.']);
        expect(t.tts.disposes).toBe(1);
        expect(checkSpeech(t.log)).toEqual([]);
      });

      it('mid-synthesis, with an engine that rejects what it was synthesizing: the failure is nobody\'s news', async () => {
        const t = await setup();
        t.tts.holdGenerate = true;
        t.session.speak(1, 'One.', [0, 4], 'en');
        await flush();
        t.session.close();
        await flush();
        expect(degradedOf(t.log)).toEqual([]);
        expect(audioOf(t.log)).toEqual([]);
        expect(checkSpeech(t.log)).toEqual([]);
      });

      it('while the model loads: the engine is let go, and a load that settles afterwards says nothing', async () => {
        const loaded = create();
        const opening = loaded.session.open();
        loaded.session.speak(1, 'Early.', [0, 6], 'en');
        loaded.session.close();
        loaded.tts.ready();
        await opening;
        await flush();
        expect(loaded.tts.disposes).toBe(1);
        expect(loaded.tts.generateCalls).toEqual([]);
        expect(framesOf(loaded.log, 'local.init.tts.ready')).toEqual([]);
        expect(checkSpeech(loaded.log)).toEqual([]);

        const failed = create();
        const failing = failed.session.open();
        failed.session.close();
        failed.tts.failInit('gone');
        await failing;
        expect(degradedOf(failed.log)).toEqual([]);
        expect(checkSpeech(failed.log)).toEqual([]);
      });
    });
  });

  describe("beside another provider's text unit, started as one leg", () => {
    /** A plan of a stub text unit and this unit, built and started through the composite adapter. */
    async function composed(lineUp: StageIds) {
      const tts = new FakeTts();
      tts.samplesPerSentence = 240;
      tts.chunksPerSentence = 2;
      tts.samplesPerChunk = 120;
      const text = stubTextUnit();
      const voice: PlannedUnit = { provider: stubProvider('local_inference'), unit: createLocalSpeechUnit({ engines: { tts: () => tts } }), stages: ['speech'] };
      const plan = textAndSpeechPlan(text.planned, voice);
      const accounts = { stub_text: { settings: {}, credentials: {} }, local_inference: { settings: SETTINGS, credentials: {} } };
      const configs = buildPlan(plan, ctx(JA_EN), { accounts }, shared({ lineUp })) as PlanConfigs;
      const said: Array<[string, unknown]> = [];
      const events = new Proxy({}, { get: (_t, kind: string) => (payload: unknown) => { said.push([kind, payload]); } }) as AdapterEvents;
      const session = await startComposite(plan, { context: ctx(JA_EN), config: configs, credentials: () => ({}), clock: createVirtualClock(0), signal: new AbortController().signal }, events);
      const of = (kind: string) => said.filter(([k]) => k === kind).map(([, payload]) => payload as Record<string, unknown>);
      return { tts, text: text.starts[0], plan, configs, session, of };
    }

    it("a translation of the text unit is read by Edge in the direction's voice, and the models are each unit's own", async () => {
      const h = await composed({ transcription: 'soniox', translation: 'soniox', speech: 'edge' });
      expect(describePlan(h.plan, h.configs)).toEqual({ ttsModel: 'edge-tts' });
      // The text unit is asked for no speech; the voice loads beside it.
      expect(h.text.request.context.speech).toBe(false);
      expect(h.tts.inits).toEqual(['edge-tts']);
      h.tts.ready();
      await flush();
      h.text.events.segmentOpened({ ref: 1, side: 'translation' });
      h.text.events.segmentText({ ref: 1, text: 'Hello there.', stableLen: 12 });
      h.text.events.segmentText({ ref: 1, text: 'Hello there. How are you?', stableLen: 25 });
      h.text.events.segmentClosed({ ref: 1 });
      await flush();
      expect(h.tts.streamCalls.map((c) => [c.text, c.voice, c.speed, c.lang])).toEqual([
        ['Hello there.', 'en-US-AvaNeural', 1.25, 'en'],
        ['How are you?', 'en-US-AvaNeural', 1.25, 'en'],
      ]);
      expect(h.of('audio').map((a) => [a.ref, a.range, (a.pcm as Int16Array).length])).toEqual([[1, [0, 12], 240], [1, [13, 25], 240]]);
      expect(h.of('degraded')).toEqual([]);
      await h.session.stop();
      expect(h.tts.disposes).toBe(1);
    });

    it('a local voice model that does not load: one notice, and the text goes on', async () => {
      const h = await composed({ transcription: 'soniox', translation: 'soniox', speech: 'local_inference' });
      expect(h.tts.inits).toEqual(['tts-en']);
      h.tts.failInit('out of memory');
      await flush();
      h.text.events.segmentOpened({ ref: 1, side: 'translation' });
      h.text.events.segmentText({ ref: 1, text: 'Hello there.', stableLen: 12 });
      h.text.events.segmentClosed({ ref: 1 });
      await flush();
      expect(h.of('degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded', message: 'TTS unavailable, continuing without it: out of memory' })]);
      expect(h.of('audio')).toEqual([]);
      expect(h.of('failed')).toEqual([]);
      expect(h.of('segmentText')).toHaveLength(1);
      expect(h.of('segmentClosed')).toHaveLength(1);
    });

    it("no speech model for the target: the leg says so in the local provider's words, with the language", async () => {
      mockTable = { 'ja>en': {} };
      const h = await composed({ transcription: 'soniox', translation: 'soniox', speech: 'local_inference' });
      await flush();
      expect(h.of('degraded')).toEqual([{ code: 'speaker_tts_missing', message: 'Translation the other side hears is text only: no speech model speaks en.', params: { target: 'en' } }]);
      expect(h.tts.inits).toEqual([]);
      expect(describePlan(h.plan, h.configs)).toEqual({});
    });
  });

  describe('the memory budget of a run in which it only speaks', () => {
    /** Sets the RAM budget in MB (the `debug:device-memory` override × the 0.75 ratio). */
    const budget = (mb: number) => localStorage.setItem('debug:device-memory', String(mb / (0.75 * 1024)));

    it('tells its own configs from the whole local session\'s by their shape', () => {
      const wholeConfig = buildLocalInference(ctx(JA_EN), SETTINGS, shared()) as LocalInferenceConfig;
      expect(areLocalSpeechConfigs({ speaker: LOCAL_VOICE })).toBe(true);
      expect(areLocalSpeechConfigs({ speaker: { off: true }, participant: EDGE_VOICE })).toBe(true);
      expect(areLocalSpeechConfigs({ speaker: wholeConfig })).toBe(false);
      expect(areLocalSpeechConfigs({ speaker: wholeConfig, participant: wholeConfig })).toBe(false);
      expect(areLocalSpeechConfigs({})).toBe(false);
    });

    it('never takes a whole-session config for a voice, with or without a voice in it, nor a voice for a whole session', () => {
      const whole = buildLocalInference(ctx(JA_EN), SETTINGS, shared()) as LocalInferenceConfig;
      const { tts: _tts, ...voiceless } = whole;
      const voiced: LocalInferenceConfig = { ...voiceless, tts: LOCAL_VOICE };
      for (const config of [voiced, voiceless, { ...voiceless, ttsUnavailable: 'speaker_tts_missing' }]) {
        expect(areLocalSpeechConfigs({ speaker: config })).toBe(false);
        expect(areLocalSpeechConfigs({ speaker: config, participant: config })).toBe(false);
        // One leg of each never happens; were it to, the whole-session budget counts it.
        expect(areLocalSpeechConfigs({ speaker: LOCAL_VOICE, participant: config })).toBe(false);
      }
      const voices: LocalSpeechConfig[] = [LOCAL_VOICE, EDGE_VOICE, { off: true }, { off: true, unavailable: 'participant_tts_missing' }];
      for (const config of voices) {
        expect(areLocalSpeechConfigs({ speaker: config })).toBe(true);
        expect(areLocalSpeechConfigs({ participant: config, speaker: undefined })).toBe(true);
      }
      // A voice is known by what it has, not by what it lacks: a config of neither shape is not one.
      expect(areLocalSpeechConfigs({ speaker: {} })).toBe(false);
      expect(areLocalSpeechConfigs({ speaker: { modelId: 'fake-tts-model' } })).toBe(false);
      expect(areLocalSpeechConfigs({ speaker: { ...LOCAL_VOICE, asr: whole.asr } })).toBe(false);
      expect(areLocalSpeechConfigs({ speaker: 'edge-tts' })).toBe(false);
    });

    it('counts the voice models of the legs that speak, and nothing else', () => {
      mockSizes = { 'tts-en': 300, 'tts-ja': 300, 'asr-ja': 5000 };
      const voice = (modelId: string): LocalTtsConfig => ({ modelId, speakerId: 0, speed: 1 });
      budget(600);
      expect(admitLocalSpeech({ speaker: voice('tts-en'), participant: voice('tts-ja') })).toBe(true);
      expect(admitLocalSpeech({ speaker: voice('tts-en'), participant: { off: true } })).toBe(true);
      budget(599);
      expect(admitLocalSpeech({ speaker: voice('tts-en'), participant: voice('tts-ja') })).toEqual({ refused: 'The models need more memory than this device has.', code: 'memory_exceeded' });
      expect(admitLocalSpeech({ speaker: voice('tts-en'), participant: { off: true, unavailable: 'participant_tts_missing' } })).toBe(true);
      // Edge takes no memory.
      budget(0);
      expect(admitLocalSpeech({ speaker: EDGE_VOICE, participant: EDGE_VOICE })).toBe(true);
      expect(admitLocalSpeech({ speaker: { off: true } })).toBe(true);
    });
  });
});
