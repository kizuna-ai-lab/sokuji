/**
 * Local Native's split units, each in a leg of three with the fakes: (a) its recognition, the fake translator and the
 * fake voice, as one leg and as a run through the runner; (b) the fake transcriber, its translation and the fake
 * voice; (c) the fake transcriber, the fake translator and its voice; (d) both legs of (a) through the runner,
 * refused by its admit (#578 rulings 4, 17, 25). The plans are composed under the released catalog with the fakes
 * added. Every engine is a fake: nothing loads.
 */
import { describe, expect, it } from 'vitest';
import type { AdapterSession, SessionContext, StartRequest } from '../../lib/contract/adapter';
import { createVirtualClock, type VirtualClock } from '../../lib/contract/clock';
import { checkConformance, recordConformance } from '../../lib/contract/conformance';
import { flush } from '../../lib/contract/testing/drive';
import type { LegName } from '../../lib/conversation/types';
import { allCaps } from '../../lib/lineup/catalog';
import { registerReleasedCatalog } from '../../lib/lineup/catalog.testing';
import type { ProviderCaps, StageIds } from '../../lib/lineup/types';
import { fakeNativeModels } from '../../lib/local-inference/native/nativeModels.testing';
import { compose } from '../../lib/plan/compose';
import { describePlan, startComposite } from '../../lib/plan/composite';
import { separateStages } from '../../lib/plan/compositeStages';
import { isRefusal, type PlanConfigs, type PlannedUnit, type RunPlan } from '../../lib/plan/types';
import type { AnyProvider } from '../../lib/provider/types';
import type { SharedSettings } from '../../lib/run/types';
import { createRunner } from '../../lib/session/runner';
import type { RunShape } from '../../lib/session/types';
import { createFakeSource } from '../fake/source';
import { FAKE_TRANSCRIBER_DEFAULTS, fakeTranscriberProvider } from '../fake/transcriber';
import { FAKE_TRANSLATOR_DEFAULTS, fakeTranslatorProvider } from '../fake/translator';
import { fakeVoiceProvider } from '../fake/voice';
import { createFakeNativeEngines } from './fakeEngines';
import { localNativeProvider } from './provider';
import { LOCAL_NATIVE_DEFAULTS } from './settings';
import { createNativeSpeechUnit } from './speechUnit';
import { createNativeTranscriptionUnit } from './transcriptionUnit';
import { createNativeTranslationUnit } from './translationUnit';

registerReleasedCatalog();

const SPEAKER: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const PARTICIPANT: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
const CONTEXTS: Record<LegName, SessionContext> = { speaker: SPEAKER, participant: PARTICIPANT };

/** The released options and the fakes, each a host of its one stage. */
const CATALOG: ProviderCaps[] = [
  ...allCaps(),
  { id: 'fake_transcriber', stages: ['transcription'], host: 'fake_transcriber', account: 'none', voiceAlone: false, takesVoice: true },
  { id: 'fake_translator', stages: ['translation'], host: 'fake_translator', account: 'none', voiceAlone: false, takesVoice: true },
  { id: 'fake_voice', stages: ['speech'], host: 'fake_voice', account: 'none', voiceAlone: true, takesVoice: false },
];
const SETTINGS: Record<string, unknown> = {
  local_native: LOCAL_NATIVE_DEFAULTS,
  fake_transcriber: FAKE_TRANSCRIBER_DEFAULTS,
  fake_translator: FAKE_TRANSLATOR_DEFAULTS,
  fake_voice: {},
};

/** This device's native facts: each direction's recognition, translation and voice. */
const facts = fakeNativeModels({
  resolve: (source, target) => ({
    asr: { modelId: `asr-${source}`, source: 'explicit' },
    translation: { modelId: `mt-${source}-${target}`, source: 'explicit' },
    tts: { modelId: `tts-${target}`, source: 'explicit' },
    notes: [],
    prunes: [],
  }),
});

/** Local Native with its three split units over `fakes`; its whole session is its own. */
function nativeOver(fakes: ReturnType<typeof createFakeNativeEngines>): AnyProvider {
  const [whole] = localNativeProvider.units;
  return {
    ...localNativeProvider,
    units: [whole, createNativeTranscriptionUnit({ engines: fakes.engines }), createNativeTranslationUnit({ engines: fakes.engines }), createNativeSpeechUnit({ engines: fakes.engines })],
  } as AnyProvider;
}

function planOf(lineUp: StageIds, fakes: ReturnType<typeof createFakeNativeEngines>): RunPlan {
  const plan = compose(lineUp, {
    providers: [nativeOver(fakes), fakeTranscriberProvider as AnyProvider, fakeTranslatorProvider as AnyProvider, fakeVoiceProvider as AnyProvider],
    settings: (id) => SETTINGS[id],
    catalog: CATALOG,
  });
  if (isRefusal(plan)) throw new Error(`refused: ${plan.refused}`);
  return plan;
}

const sharedFor = (leg: LegName, lineUp: StageIds): SharedSettings => ({
  pauses: { sourceSeconds: 0, translationSeconds: 0 },
  reversed: () => leg === 'participant',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
  speaks: true,
  lineUp,
  nativeModels: facts,
});

/** One leg's configs, each unit built with its own provider's settings, as a run builds them. */
function configsFor(plan: RunPlan, leg: LegName, lineUp: StageIds): PlanConfigs {
  const context = CONTEXTS[leg];
  return new Map(plan.units.map((unit) => [unit, unit.unit.build({ ...context, speech: context.speech && unit.stages.includes('speech') }, SETTINGS[unit.provider.id], sharedFor(leg, lineUp))]));
}

/** One leg of `lineUp` started through the composite, its log recorded. */
function leg(lineUp: StageIds) {
  const fakes = createFakeNativeEngines();
  const plan = planOf(lineUp, fakes);
  const clock = createVirtualClock(0);
  const rec = recordConformance();
  const config = configsFor(plan, 'speaker', lineUp);
  const request: StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown> = { context: SPEAKER, config, credentials: () => ({}), clock, signal: new AbortController().signal };
  const starting = startComposite(plan, request, rec.events);
  const of = (kind: string) => rec.log.filter((e) => e.kind === kind).map((e) => e.payload as Record<string, unknown>);
  const texts = () => new Map(of('segmentText').map((e) => [e.ref as number, e.text as string]));
  const run = async (ms: number, step = 100) => {
    for (let at = 0; at < ms; at += step) {
      clock.advance(step);
      await flush();
    }
  };
  const stop = async (session: AdapterSession) => {
    rec.mark('stop');
    await session.stop();
    rec.mark('stopped');
  };
  return { fakes, plan, config, clock, rec, starting, of, texts, run, stop };
}

const rowsOf = (of: (kind: string) => Array<Record<string, unknown>>) => of('segmentOpened').map((e) => [e.ref, e.side]);

describe('(a) Local Native transcribes, the fake translator translates, the fake voice reads', () => {
  const LINE_UP: StageIds = { transcription: 'local_native', translation: 'fake_translator', speech: 'fake_voice' };

  it('is a plan of three units the composite runs with its stages apart, each naming its own model', () => {
    const h = leg(LINE_UP);
    expect(separateStages(h.plan)).not.toBeNull();
    expect(h.plan.units.map((u) => [u.provider.id, u.unit.id])).toEqual([['local_native', 'transcription'], ['fake_translator', 'translator'], ['fake_voice', 'voice']]);
    expect(describePlan(h.plan, h.config)).toEqual({ asrModel: 'asr-en', translationModel: 'fake-translator', ttsModel: 'fake-voice' });
  });

  it('what the engine hears is a source, translated by the fake and read by its voice; typed text too', async () => {
    const h = leg(LINE_UP);
    h.fakes.asr.ready();
    h.fakes.vad.ready();
    const session = await h.starting;
    await flush();
    expect(h.fakes.asr.inits).toEqual([expect.objectContaining({ modelId: 'asr-en', language: 'en' })]);
    // Recognition alone: the engine loads no translation and no voice.
    expect(h.fakes.calls).not.toContain('translation');
    expect(h.fakes.calls).not.toContain('tts');
    h.fakes.asr.partial('Hello');
    h.fakes.asr.final('Hello.');
    await h.run(300);
    session.appendText('Typed.');
    await h.run(300);
    expect(rowsOf(h.of)).toEqual([[1, 'source'], [2, 'translation'], [3, 'source'], [4, 'translation']]);
    expect([...h.texts()]).toEqual([[1, 'Hello.'], [2, '[ja] Hello.'], [3, 'Typed.'], [4, '[ja] Typed.']]);
    expect(h.of('audio').map((a) => a.ref)).toEqual([2, 4]);
    expect(h.of('degraded')).toEqual([]);
    await h.stop(session);
    expect(h.fakes.asr.disposes).toBe(1);
    expect(checkConformance(h.rec.log, SPEAKER)).toEqual([]);
  });
});

describe('(b) the fake transcriber transcribes, Local Native translates, the fake voice reads', () => {
  const LINE_UP: StageIds = { transcription: 'fake_transcriber', translation: 'local_native', speech: 'fake_voice' };

  it('loads the translation for the leg before the transcriber starts, then translates each stretch, one final answer each', async () => {
    const h = leg(LINE_UP);
    expect(h.plan.units.map((u) => [u.provider.id, u.unit.id])).toEqual([['fake_transcriber', 'transcriber'], ['local_native', 'translation'], ['fake_voice', 'voice']]);
    await h.run(1_000);
    expect(h.fakes.translation.inits).toEqual([expect.objectContaining({ sourceLang: 'en', targetLang: 'ja', modelId: 'mt-en-ja' })]);
    // Nothing is heard while the model loads.
    expect(h.of('segmentOpened')).toEqual([]);
    h.fakes.translation.ready();
    const session = await h.starting;
    await h.run(700);
    expect(h.fakes.translation.calls.map((c) => c.text)).toEqual(['Hello.']);
    // A partial from the sidecar shows nothing (#578 ruling 21).
    h.fakes.translation.stream('こん');
    h.fakes.translation.answer('こんにちは。');
    await h.run(2_000);
    expect(h.fakes.translation.calls.map((c) => c.text)).toEqual(['Hello.', 'How are you today?']);
    h.fakes.translation.answer('今日はお元気ですか？');
    await h.run(7_000);
    expect(h.fakes.translation.calls.map((c) => c.text)).toEqual(['Hello.', 'How are you today?', 'I am fine, thank you.']);
    h.fakes.translation.answer('元気です、ありがとう。');
    await h.run(1_000);
    expect(rowsOf(h.of)).toEqual([[1, 'source'], [2, 'translation'], [3, 'translation'], [4, 'source'], [5, 'translation']]);
    const texts = h.texts();
    expect([texts.get(2), texts.get(3), texts.get(5)]).toEqual(['こんにちは。', '今日はお元気ですか？', '元気です、ありがとう。']);
    expect(h.of('segmentText').filter((e) => e.ref === 2).map((e) => e.text)).toEqual(['こんにちは。']);
    expect(h.of('audio').map((a) => a.ref)).toEqual([2, 3, 5]);
    await h.stop(session);
    expect(h.fakes.translation.disposes).toBe(1);
    expect(checkConformance(h.rec.log, SPEAKER)).toEqual([]);
  });
});

describe('(c) the fake transcriber transcribes, the fake translator translates, Local Native reads', () => {
  const LINE_UP: StageIds = { transcription: 'fake_transcriber', translation: 'fake_translator', speech: 'local_native' };

  it("loads the leg's voice, and reads each translation in the target language", async () => {
    const h = leg(LINE_UP);
    expect(h.plan.units.map((u) => [u.provider.id, u.unit.id])).toEqual([['fake_transcriber', 'transcriber'], ['fake_translator', 'translator'], ['local_native', 'speech']]);
    h.fakes.tts.ready();
    const session = await h.starting;
    expect(h.fakes.tts.inits).toEqual([expect.objectContaining({ modelId: 'tts-ja', language: 'ja' })]);
    await h.run(10_000, 100);
    const said = () => h.fakes.tts.spoken.length;
    // Each translation is read once the one before it has been said.
    for (let i = 0; i < 6 && said() > h.of('audio').length; i++) {
      h.fakes.tts.say();
      await h.run(100);
    }
    expect(h.fakes.tts.spoken).toEqual(['[ja] Hello.', '[ja] How are you today?', '[ja] I am fine, thank you.']);
    const texts = h.texts();
    const audio = h.of('audio') as Array<{ ref: number; range: [number, number] }>;
    expect(audio.map((a) => a.ref)).toEqual([2, 3, 5]);
    for (const { ref, range } of audio) expect(texts.get(ref)!.slice(range[0], range[1])).toBe(texts.get(ref));
    expect(h.of('degraded')).toEqual([]);
    await h.stop(session);
    expect(h.fakes.tts.disposes).toBe(1);
    expect(checkConformance(h.rec.log, SPEAKER)).toEqual([]);
  });
});

describe('(a) through the runner', () => {
  const LINE_UP: StageIds = { transcription: 'local_native', translation: 'fake_translator', speech: 'fake_voice' };

  function run(legs: LegName[]) {
    const fakes = createFakeNativeEngines();
    const clock: VirtualClock = createVirtualClock(0);
    const plan = planOf(LINE_UP, fakes);
    const shape: RunShape = {
      plan,
      accounts: {
        local_native: { settings: LOCAL_NATIVE_DEFAULTS, credentials: {} },
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
    let sources = 0;
    const runner = createRunner({
      clock,
      platform: 'electron',
      readShape: () => shape,
      ensureReady: async () => ({ state: 'ready', models: [] }),
      persistIfUnchanged: () => {},
      openSource: async () => { sources++; return createFakeSource(clock); },
      playback: { audio: (leg, ref) => { played.push({ leg, ref }); return []; }, held: () => {}, clear: () => {}, live: () => {} },
      analytics: { track: () => {} },
      // What the app's runner hands every builder and every admit: this device's native facts.
      nativeModels: facts,
      newSessionId: () => 'run1',
      timeoutMs: 1000,
    });
    const start = async () => {
      let done = false;
      const starting = runner.start().finally(() => { done = true; });
      while (!done) {
        fakes.asr.ready();
        fakes.vad.ready();
        await flush();
      }
      await starting;
    };
    const settle = async () => {
      await flush();
      clock.advance(1);
      await flush();
    };
    return { runner, fakes, played, start, settle, sources: () => sources };
  }

  it('builds, admits and starts the plan: what the engine hears is translated by the fake and read by its voice', async () => {
    const h = run(['speaker']);
    await h.start();
    expect(h.runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'live' } });
    expect(h.runner.conversation.info).toMatchObject({ provider: 'local_native', models: { asrModel: 'asr-en', translationModel: 'fake-translator', ttsModel: 'fake-voice' } });
    h.fakes.asr.final('Hello.');
    await h.settle();
    expect(h.runner.conversation.snapshot()[0].segments.map((s) => [s.side, s.text])).toEqual([['source', 'Hello.'], ['translation', '[ja] Hello.']]);
    expect(h.played).toEqual([{ leg: 'speaker', ref: 2 }]);
    await h.runner.stop();
    expect(h.runner.state.getState().phase).toBe('idle');
    expect(h.fakes.asr.disposes).toBe(1);
  });

  it('(d) both legs are refused by its admit with the transcription unit\'s words, and nothing opens (#578 rulings 4, 25)', async () => {
    const h = run(['speaker', 'participant']);
    await h.start();
    expect(h.runner.state.getState()).toMatchObject({
      lastEnd: { reason: 'refused', notice: { code: 'admit_refused', message: 'Local Native transcribes one side at a time: choose Me or Other.' } },
    });
    expect(h.sources()).toBe(0);
    expect(h.fakes.calls).toEqual([]);
  });
});
