/**
 * This device's recognition transcribing alone, another unit translating what it heard and a third reading the
 * translations: the leg of three units (this device, the fake translator, the fake voice), both legs, and a run of
 * the same line-up through the runner. No offered line-up reaches this unit yet (the text models that translate
 * another provider's transcription come later), so the plans are composed under a test catalog or built by hand.
 * Every engine is a fake: no model loads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdapterSession, SessionContext, StartRequest } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { checkConformance, recordConformance } from '../../lib/contract/conformance';
import { flush } from '../../lib/contract/testing/drive';
import type { LegName } from '../../lib/conversation/types';
import type { LocalStages } from '../../lib/lineup/localStages';
import { allCaps } from '../../lib/lineup/catalog';
import type { ProviderCaps, StageIds } from '../../lib/lineup/types';
import type { DirectionResult } from '../../lib/local-inference/selection/types';
import { fakeLocalModels } from '../../lib/local-inference/selection/localModels.testing';
import { compose } from '../../lib/plan/compose';
import { describePlan, startComposite } from '../../lib/plan/composite';
import type { PlanConfigs } from '../../lib/plan/types';
import { startCompositeBoth } from '../../lib/plan/compositeBoth';
import { separateStages } from '../../lib/plan/compositeStages';
import { isRefusal, type PlannedUnit, type RunPlan } from '../../lib/plan/types';
import type { AnyProvider } from '../../lib/provider/types';
import type { SharedSettings } from '../../lib/run/types';
import { createRunner } from '../../lib/session/runner';
import { planLanguages } from '../../lib/session/shape';
import type { RunShape } from '../../lib/session/types';
import { getLocalInferenceLanguages } from '../../lib/local-inference/modelManifest';

// Prefixed "mock" so Vitest hoists these alongside the vi.mock factories below.
/**
 * Each direction's recognition model: the leg's own source decides it. English streams (a catalog model whose words
 * are not placed in time), Japanese is an offline model the catalog does not know (its utterance is placed).
 */
const mockAsr: Record<string, string> = { 'en>ja': 'stream-en-kroko', 'ja>en': 'asr-ja' };
let mockStagesSeen: Array<LocalStages | null | undefined> = [];
/** How this device's models resolve a direction: its recognition model from `mockAsr`, recording the stages each resolution is under. */
const resolve = (src: string, tgt: string, _selections: unknown, stages?: LocalStages | null): DirectionResult => {
  mockStagesSeen.push(stages);
  const asr = mockAsr[`${src}>${tgt}`];
  return { asr: asr ? { modelId: asr, source: 'explicit' } : null, translation: null, tts: null, notes: [], prunes: [] };
};
vi.mock('../../stores/lineUpStore', () => ({ storedLocalStages: () => null }));

import { createFakeSource } from '../fake/source';
import { FAKE_TRANSLATOR_DEFAULTS, fakeTranslatorProvider } from '../fake/translator';
import { fakeVoiceProvider } from '../fake/voice';
import type { LocalEngines } from './engines';
import { FakeAsr, FakeTurn } from './fakeEngines';
import { localInferenceProvider } from './provider';
import { LOCAL_INFERENCE_DEFAULTS } from './settings';
import { createLocalTranscriptionUnit } from './transcriptionUnit';
import { registerReleasedCatalog } from '../../lib/lineup/catalog.testing';

registerReleasedCatalog();

const SPEAKER: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const PARTICIPANT: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
const CONTEXTS: Record<LegName, SessionContext> = { speaker: SPEAKER, participant: PARTICIPANT };
const LINE_UP: StageIds = { transcription: 'local_inference', translation: 'fake_translator', speech: 'fake_voice' };
/** This device's models as a run hands them: resolved by `resolve`, with no GPU feature. */
const models = fakeLocalModels({ resolve, deviceFeatures: () => [] });
const sharedFor = (leg: LegName): SharedSettings => ({
  pauses: { sourceSeconds: 0, translationSeconds: 0 },
  reversed: () => leg === 'participant',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
  lineUp: LINE_UP,
  localModels: models,
});

/** Engines that make one recognizer per model (one per leg's direction), and refuse to make anything else. */
function fakeEngines() {
  const asrs = new Map<string, FakeAsr>();
  const turn = new FakeTurn();
  const engines: LocalEngines = {
    asr: (config) => {
      const asr = new FakeAsr();
      asr.config = config;
      asrs.set(config.modelId, asr);
      return asr;
    },
    translation: () => { throw new Error('the unit that transcribes alone loads no translation engine'); },
    tts: () => { throw new Error('the unit that transcribes alone loads no voice'); },
    turn: () => turn.connect(),
  };
  return { engines, asrs, turn };
}

/** The test catalog: the released options and the fake translator and voice, each a host of its one stage. */
const CATALOG: ProviderCaps[] = [
  ...allCaps(),
  { id: 'fake_translator', stages: ['translation'], host: 'fake_translator', account: 'none', voiceAlone: false, takesVoice: true },
  { id: 'fake_voice', stages: ['speech'], host: 'fake_voice', account: 'none', voiceAlone: true, takesVoice: false },
];

/** The local provider whose recognition alone runs over `engines`; everything else is the provider's own. */
function localOver(engines: LocalEngines): AnyProvider {
  const [whole, , translation, speech] = localInferenceProvider.units;
  return { ...localInferenceProvider, units: [whole, createLocalTranscriptionUnit({ engines }), translation, speech] } as AnyProvider;
}

/** The plan of the line-up, as the composer makes it. */
function planOver(engines: LocalEngines): RunPlan {
  const plan = compose(LINE_UP, {
    providers: [localOver(engines), fakeTranslatorProvider as AnyProvider, fakeVoiceProvider as AnyProvider],
    settings: (id) => (id === 'local_inference' ? LOCAL_INFERENCE_DEFAULTS : undefined),
    catalog: CATALOG,
  });
  if (isRefusal(plan)) throw new Error(`refused: ${plan.refused}`);
  return plan;
}

/** One leg's configs, each unit built with its own settings, as a run builds them. */
function configsFor(plan: RunPlan, leg: LegName): PlanConfigs {
  const context = CONTEXTS[leg];
  const own = new Map<PlannedUnit, unknown>([[plan.byStage.transcription, LOCAL_INFERENCE_DEFAULTS], [plan.byStage.translation, FAKE_TRANSLATOR_DEFAULTS], [plan.byStage.speech, {}]]);
  return new Map(plan.units.map((unit) => [unit, unit.unit.build({ ...context, speech: context.speech && unit.stages.includes('speech') }, own.get(unit), sharedFor(leg))]));
}

beforeEach(() => {
  mockStagesSeen = [];
});

describe('this device transcribing alone in a leg of three units: the fake translator and the fake voice', () => {
  async function leg(context: SessionContext = SPEAKER) {
    const { engines, asrs } = fakeEngines();
    const plan = planOver(engines);
    const clock = createVirtualClock(0);
    const rec = recordConformance();
    const config = configsFor(plan, 'speaker');
    const request: StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown> = { context, config, credentials: () => ({}), clock, signal: new AbortController().signal };
    const starting = startComposite(plan, request, rec.events);
    await flush();
    const asr = () => asrs.get('stream-en-kroko')!;
    const of = (kind: string) => rec.log.filter((e) => e.kind === kind).map((e) => e.payload as Record<string, unknown>);
    /** What the recognizer says, then every answer it sets off: the translator's, and the voice's on the next tick of the clock. */
    const hear = async (say: () => void) => {
      say();
      await flush();
      clock.advance(1);
      await flush();
    };
    const stop = async (session: AdapterSession) => {
      rec.mark('stop');
      await session.stop();
      rec.mark('stopped');
    };
    return { plan, config, clock, rec, asrs, asr, starting, of, hear, stop };
  }

  async function opened(context: SessionContext = SPEAKER) {
    const h = await leg(context);
    h.asr().ready();
    const session = await h.starting;
    await flush();
    return { ...h, session };
  }

  it('is a plan the composite runs with its stages apart, each stage naming its own unit\'s model', async () => {
    const h = await leg();
    expect(separateStages(h.plan)).not.toBeNull();
    expect(h.plan.units.map((u) => [u.provider.id, u.unit.id])).toEqual([['local_inference', 'transcription'], ['fake_translator', 'translator'], ['fake_voice', 'voice']]);
    expect(describePlan(h.plan, h.config)).toEqual({ asrModel: 'stream-en-kroko', translationModel: 'fake-translator', ttsModel: 'fake-voice' });
    // Resolved as recognition alone: no translation model and no voice of this device.
    expect(mockStagesSeen).toEqual([{ translation: null, speech: null, transcription: 'local' }]);
    h.asr().ready();
    await h.stop(await h.starting);
  });

  it('the translator opens first; then the recognizer loads for the source, and its loading is the transcription stage\'s', async () => {
    const h = await leg();
    expect([...h.asrs.keys()]).toEqual(['stream-en-kroko']);
    expect(h.asr().inits).toEqual([{ modelId: 'stream-en-kroko', options: expect.objectContaining({ language: 'en', translateTo: undefined }) }]);
    h.asr().ready();
    const session = await h.starting;
    expect(h.of('loading')).toEqual([{ stage: 'asr', done: 1, total: 1, runStage: 'transcription' }]);
    expect(h.of('frame').filter((f) => f.type === 'local.session.opened')).toEqual([{ direction: 'out', type: 'local.session.opened', payload: { asrModel: 'stream-en-kroko', language: 'en' }, runStage: 'transcription' }]);
    // Nothing is said of a missing translation: another unit translates.
    expect(h.of('degraded')).toEqual([]);
    await h.stop(session);
    expect(checkConformance(h.rec.log, SPEAKER)).toEqual([]);
  });

  it('partials grow the row; each final closes it, all of it stable, and it is translated at once; the rows keep the unit\'s origins; the voice reads each', async () => {
    const h = await opened();
    await h.hear(() => {
      h.asr().partial('Hello');
      h.asr().partial('Hello, how are');
    });
    // Nothing is stable while the recognizer still guesses: nothing is translated yet.
    expect(h.of('segmentOpened')).toEqual([{ ref: 1, side: 'source', origin: 'u1' }]);
    await h.hear(() => h.asr().final('Hello, how are you?'));
    // A final of two sentences: the first is sent once the second's stable letters follow it, the rest at the close.
    await h.hear(() => {
      h.asr().partial('I am');
      h.asr().final('I am fine. Thank you.');
    });
    expect(h.of('segmentOpened')).toEqual([
      { ref: 1, side: 'source', origin: 'u1' },
      { ref: 2, side: 'translation', origin: 'u1' },
      { ref: 3, side: 'source', origin: 'u2' },
      { ref: 4, side: 'translation', origin: 'u2' },
      { ref: 5, side: 'translation', origin: 'u2' },
    ]);
    const last = new Map(h.of('segmentText').map((e) => [e.ref as number, e.text as string]));
    expect([...last]).toEqual([
      [1, 'Hello, how are you?'],
      [2, '[ja] Hello, how are you?'],
      [3, 'I am fine. Thank you.'],
      [4, '[ja] I am fine.'],
      [5, '[ja] Thank you.'],
    ]);
    // The source's own close comes before its translation's.
    expect(h.of('segmentClosed').map((e) => e.ref)).toEqual([1, 2, 3, 4, 5]);
    const audio = h.of('audio') as Array<{ ref: number; range: [number, number] }>;
    expect(audio.map((a) => a.ref)).toEqual([2, 4, 5]);
    for (const { ref, range } of audio) expect(last.get(ref)!.slice(range[0], range[1])).toBe(last.get(ref));
    await h.stop(h.session);
    expect(checkConformance(h.rec.log, SPEAKER)).toEqual([]);
  });

  it('typed text is this unit\'s: shown as a source, and translated and read as speech is', async () => {
    const h = await opened();
    await h.hear(() => h.session.appendText('Typed words.'));
    expect(h.of('segmentOpened')).toEqual([{ ref: 1, side: 'source', origin: 'u1' }, { ref: 2, side: 'translation', origin: 'u1' }]);
    expect(h.of('segmentText').map((e) => e.text)).toEqual(['Typed words.', '[ja] Typed words.']);
    expect((h.of('audio') as Array<{ ref: number }>).map((a) => a.ref)).toEqual([2]);
    expect(h.of('degraded')).toEqual([]);
    await h.stop(h.session);
    expect(checkConformance(h.rec.log, SPEAKER)).toEqual([]);
  });

  it('a manual turn: the release flushes the recognizer through the leg, and what it then finishes is translated', async () => {
    const h = await opened({ ...SPEAKER, turns: 'manual' });
    h.session.beginTurn();
    h.session.appendAudio(new Int16Array(240));
    h.asr().partial('Held');
    h.session.endTurn();
    expect(h.asr().flushes).toBe(1);
    await h.hear(() => h.asr().final('Held key.'));
    expect(h.of('segmentText').map((e) => e.text)).toEqual(['Held', 'Held key.', '[ja] Held key.']);
    await h.stop(h.session);
    expect(checkConformance(h.rec.log, { ...SPEAKER, turns: 'manual' })).toEqual([]);
  });

  it('a stop in the middle of an utterance says nothing after it, and lets the recognizer go', async () => {
    const h = await opened();
    await h.hear(() => h.asr().partial('Half a sen'));
    await h.stop(h.session);
    const said = h.rec.log.length;
    h.asr().final('Half a sentence.');
    h.clock.advance(60_000);
    await flush();
    expect(h.rec.log).toHaveLength(said);
    expect(h.asr().disposes).toBe(1);
    // The open source was never translated: the leg stopped before it closed.
    expect(h.of('segmentOpened')).toEqual([{ ref: 1, side: 'source', origin: 'u1' }]);
    expect(checkConformance(h.rec.log, SPEAKER)).toEqual([]);
  });

  it('a recognizer that dies fails the leg, naming the transcription stage, and nothing follows', async () => {
    const h = await opened();
    await h.hear(() => h.asr().final('Before.'));
    await h.hear(() => {
      h.asr().partial('After');
      h.asr().die('worker gone');
    });
    expect(h.of('failed')).toEqual([{ message: 'Speech recognition stopped: worker gone', runStage: 'transcription' }]);
    const said = h.rec.log.length;
    await h.hear(() => {
      h.asr().final('Never heard.');
      h.session.appendText('Nor this.');
    });
    expect(h.rec.log).toHaveLength(said);
    const events = h.rec.log.filter((e) => e.kind !== 'marker');
    expect(events[events.length - 1].kind).toBe('failed');
    await h.stop(h.session);
    expect(checkConformance(h.rec.log, SPEAKER)).toEqual([]);
  });

  it('a recognizer that cannot load fails the start, in the whole session\'s words', async () => {
    const h = await leg();
    h.asr().failInit('no such file');
    await expect(h.starting).rejects.toThrow('ASR engine init failed: no such file');
    expect(h.asr().disposes).toBe(1);
    expect(h.of('segmentOpened')).toEqual([]);
  });

  it('an utterance the recognizer gives up on is a notice of the transcription stage; its row closes as it stands, and is translated as it stands', async () => {
    const h = await opened();
    await h.hear(() => {
      h.asr().partial('Broken words');
      h.asr().fail('decode error');
    });
    expect(h.of('degraded')).toEqual([{ code: 'transcription_failed', message: 'decode error', runStage: 'transcription' }]);
    expect(h.of('segmentText').map((e) => e.text)).toEqual(['Broken words', '[ja] Broken words']);
    await h.stop(h.session);
    expect(checkConformance(h.rec.log, SPEAKER)).toEqual([]);
  });
});

describe('both legs, each with its own recognizer, translator and voice', () => {
  it('each leg loads the recognizer of its own source, is translated its own way and read by its own voice', async () => {
    const { engines, asrs } = fakeEngines();
    const plan = planOver(engines);
    const clock = createVirtualClock(0);
    const rec = { speaker: recordConformance(), participant: recordConformance() };
    const signal = new AbortController().signal;
    const request = (name: LegName) => ({ context: CONTEXTS[name], config: configsFor(plan, name), credentials: () => ({}), clock, signal });
    const starting = startCompositeBoth(plan, { speaker: request('speaker'), participant: request('participant') }, { speaker: rec.speaker.events, participant: rec.participant.events });
    await flush();
    expect([...asrs.keys()].sort()).toEqual(['asr-ja', 'stream-en-kroko']);
    expect(asrs.get('stream-en-kroko')!.inits[0].options.language).toBe('en');
    expect(asrs.get('asr-ja')!.inits[0].options.language).toBe('ja');
    for (const asr of asrs.values()) asr.ready();
    const sessions = await starting;
    // Audio goes to the recognizer of its own leg.
    sessions.participant.appendAudio(new Int16Array(240));
    expect([asrs.get('stream-en-kroko')!.fed.length, asrs.get('asr-ja')!.fed.length]).toEqual([0, 1]);

    asrs.get('stream-en-kroko')!.final('Hello.');
    asrs.get('asr-ja')!.final('大丈夫。');
    await flush();
    clock.advance(1);
    await flush();
    const texts = (leg: LegName) => rec[leg].log.filter((e) => e.kind === 'segmentText').map((e) => (e.payload as { text: string }).text);
    expect(texts('speaker')).toEqual(['Hello.', '[ja] Hello.']);
    expect(texts('participant')).toEqual(['大丈夫。', '[en] 大丈夫。']);
    const audio = (leg: LegName) => rec[leg].log.filter((e) => e.kind === 'audio').map((e) => (e.payload as { ref: number }).ref);
    expect([audio('speaker'), audio('participant')]).toEqual([[2], [2]]);

    for (const leg of ['speaker', 'participant'] as const) {
      rec[leg].mark('stop');
      await sessions[leg].stop();
      rec[leg].mark('stopped');
      expect(checkConformance(rec[leg].log, CONTEXTS[leg])).toEqual([]);
    }
    expect([...asrs.values()].map((a) => a.disposes)).toEqual([1, 1]);
  });

  it('a leg whose recognizer cannot load fails the start, named; the other leg is stopped', async () => {
    const { engines, asrs } = fakeEngines();
    const plan = planOver(engines);
    const clock = createVirtualClock(0);
    const signal = new AbortController().signal;
    const request = (name: LegName) => ({ context: CONTEXTS[name], config: configsFor(plan, name), credentials: () => ({}), clock, signal });
    const starting = startCompositeBoth(plan, { speaker: request('speaker'), participant: request('participant') }, { speaker: recordConformance().events, participant: recordConformance().events });
    await flush();
    asrs.get('stream-en-kroko')!.ready();
    asrs.get('asr-ja')!.failInit('no such file');
    await expect(starting).rejects.toMatchObject({ leg: 'participant' });
    await flush();
    expect([...asrs.values()].map((a) => a.disposes)).toEqual([1, 1]);
  });
});

describe('a run of this device transcribing, the fake translator translating and the fake voice reading, through the runner', () => {
  function run(legs: LegName[] = ['speaker']) {
    const { engines, asrs } = fakeEngines();
    const clock = createVirtualClock(0);
    const plan = planOver(engines);
    const shape: RunShape = {
      plan,
      accounts: {
        local_inference: { settings: LOCAL_INFERENCE_DEFAULTS, credentials: {} },
        fake_translator: { settings: FAKE_TRANSLATOR_DEFAULTS, credentials: {} },
        fake_voice: { settings: {}, credentials: {} },
      },
      lineUp: LINE_UP,
      lineUpStored: true,
      pair: { source: 'en', target: 'ja' },
      legs,
      turnMode: 'auto',
      textOnly: false,
      participantSpeech: true,
      keepReplayAudio: true,
      shared: { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
      auth: { signedIn: false, getToken: async () => null },
    };
    const played: Array<{ leg: LegName; ref: number | undefined }> = [];
    const runner = createRunner({
      clock,
      platform: 'electron',
      readShape: () => shape,
      ensureReady: async () => ({ state: 'ready', models: [] }),
      persistIfUnchanged: () => {},
      openSource: async () => createFakeSource(clock),
      playback: { audio: (leg, ref) => { played.push({ leg, ref }); return []; }, held: () => {}, clear: () => {}, live: () => {} },
      analytics: { track: () => {} },
      // What the app's runner hands every builder and every admit: this device's models.
      localModels: models,
      newSessionId: () => 'run1',
      timeoutMs: 1000,
    });
    const start = async () => {
      let done = false;
      const starting = runner.start().finally(() => { done = true; });
      while (!done) {
        for (const asr of asrs.values()) asr.ready();
        await flush();
      }
      await starting;
    };
    const settle = async () => {
      await flush();
      clock.advance(1);
      await flush();
    };
    return { runner, asrs, played, start, settle };
  }

  it('builds, admits and starts the plan: what this device hears is translated by the fake and read by its voice; typed text too; the run names each stage\'s model', async () => {
    const h = run();
    await h.start();
    expect(h.runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'live' } });
    expect(h.runner.conversation.info).toMatchObject({ provider: 'local_inference', models: { asrModel: 'stream-en-kroko', translationModel: 'fake-translator', ttsModel: 'fake-voice' } });
    h.asrs.get('stream-en-kroko')!.final('Hello.');
    await h.settle();
    h.runner.sendText('Typed.');
    await h.settle();
    const rows = h.runner.conversation.snapshot()[0].segments.map((s) => [s.side, s.text]);
    expect(rows).toEqual([['source', 'Hello.'], ['translation', '[ja] Hello.'], ['source', 'Typed.'], ['translation', '[ja] Typed.']]);
    expect(h.played).toEqual([{ leg: 'speaker', ref: 2 }, { leg: 'speaker', ref: 4 }]);
    await h.runner.stop();
    expect(h.runner.state.getState().phase).toBe('idle');
    expect(h.asrs.get('stream-en-kroko')!.disposes).toBe(1);
  });

  it('both legs: a recognizer for each side, each side translated into the other\'s language', async () => {
    const h = run(['speaker', 'participant']);
    await h.start();
    expect(h.runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'live', participant: 'live' } });
    h.asrs.get('stream-en-kroko')!.final('Hello.');
    h.asrs.get('asr-ja')!.final('大丈夫。');
    await h.settle();
    const [speaker, participant] = h.runner.conversation.snapshot();
    expect(speaker.segments.map((s) => s.text)).toEqual(['Hello.', '[ja] Hello.']);
    expect(participant.segments.map((s) => s.text)).toEqual(['大丈夫。', '[en] 大丈夫。']);
    await h.runner.stop();
    expect([...h.asrs.values()].map((a) => a.disposes)).toEqual([1, 1]);
  });
});

describe('the languages such a plan offers', () => {
  it("sources are this device's own list, kept to those the translator takes; targets are its list, kept to the pairs the translator takes", () => {
    const { engines } = fakeEngines();
    const plan = planOver(engines);
    const accounts = { local_inference: { settings: LOCAL_INFERENCE_DEFAULTS, credentials: {} }, fake_translator: { settings: FAKE_TRANSLATOR_DEFAULTS, credentials: {} }, fake_voice: { settings: {}, credentials: {} } };
    const offer = planLanguages({ plan, accounts }).languages;
    const own = getLocalInferenceLanguages().map((o) => o.value);
    // The fake translates between English, Japanese and Chinese; this device's list (recognition and speech both) has all three.
    const sources = offer.sources(undefined as never).map((o) => o.value);
    expect([...sources].sort()).toEqual(['en', 'ja', 'zh']);
    expect(sources.every((code) => own.includes(code))).toBe(true);
    expect(offer.targets('en', undefined as never).map((o) => o.value).sort()).toEqual(['ja', 'zh']);
  });
});
