/**
 * OpenAI's text model translating what this device heard, read by the fake voice (text models, part B): the line-up
 * composed, the leg of three units under the adapter rules (rows and origins, the earlier stretches told to the
 * model, a job the service refuses, a key it refuses), and a run of the same line-up through the runner (built,
 * started, the record's stages and the analytics' translation model). This device's recognizer is a fake engine and
 * OpenAI a fake transport: nothing loads and nothing leaves the machine.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SessionContext, StartRequest } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { checkConformance, recordConformance } from '../../lib/contract/conformance';
import { flush } from '../../lib/contract/testing/drive';
import type { LegName } from '../../lib/conversation/types';
import { CAPS } from '../../lib/lineup/catalog';
import type { ProviderCaps, StageIds } from '../../lib/lineup/types';
import type { DirectionResult } from '../../lib/local-inference/selection/types';
import { compose } from '../../lib/plan/compose';
import { describePlan, startComposite, type PlanConfigs } from '../../lib/plan/composite';
import { isRefusal, type PlannedUnit, type RunPlan } from '../../lib/plan/types';
import type { AnyProvider, SharedSettings } from '../../lib/provider/types';
import { createRunner } from '../../lib/session/runner';
import type { RunShape } from '../../lib/session/types';
import type { TextModelRequestInit, TextModelTransport } from '../../lib/textModel/client';
import { TEXT_MODEL_DEFAULTS } from '../../lib/textModel/unit';

const mockAsr: Record<string, string> = { 'en>ja': 'stream-en-kroko', 'ja>en': 'asr-ja' };
vi.mock('../../stores/modelStore', () => ({
  useModelStore: {
    getState: () => ({
      resolve: (src: string, tgt: string): DirectionResult => {
        const asr = mockAsr[`${src}>${tgt}`];
        return { asr: asr ? { modelId: asr, source: 'explicit' } : null, translation: null, tts: null, notes: [], prunes: [] };
      },
      deviceFeatures: [],
    }),
  },
}));
vi.mock('../../stores/lineUpStore', () => ({ storedLocalStages: () => null }));

import { createFakeSource } from '../fake/source';
import { fakeVoiceProvider } from '../fake/voice';
import type { LocalEngines } from '../localInference/engines';
import { FakeAsr, FakeTurn } from '../localInference/fakeEngines';
import { localInferenceProvider } from '../localInference/provider';
import { LOCAL_INFERENCE_DEFAULTS } from '../localInference/settings';
import { createLocalTranscriptionUnit } from '../localInference/transcriptionUnit';
import { createOpenAITextUnit, openaiTextProvider } from './provider';

/** Not a key of any service. */
const KEY = 'test-key-0000';
const SPEAKER: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const LINE_UP: StageIds = { transcription: 'local_inference', translation: 'openai_text', speech: 'fake_voice' };
const sharedFor = (leg: LegName): SharedSettings => ({
  pauses: { sourceSeconds: 0, translationSeconds: 0 },
  reversed: () => leg === 'participant',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [{ id: 'gpt-5-mini' }],
  lineUp: LINE_UP,
});

type Reply = { status: number; body: unknown };

/** OpenAI as the test answers it: each chat completion waits for the test's reply, in order. */
function fakeOpenAI() {
  const sent: Array<{ url: string; init: TextModelRequestInit; body: Record<string, unknown> }> = [];
  const waiting: Array<(reply: Reply) => void> = [];
  const transport: TextModelTransport = (url, init) => new Promise((resolve, reject) => {
    sent.push({ url, init, body: JSON.parse(init.body ?? '{}') });
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    waiting.push((reply) => resolve({ status: reply.status, text: async () => JSON.stringify(reply.body) }));
  });
  const answer = async (reply: Reply) => {
    const next = waiting.shift();
    if (!next) throw new Error('no request is waiting');
    next(reply);
    await flush();
  };
  return { transport, sent, answer, pending: () => waiting.length };
}
const says = (content: string): Reply => ({ status: 200, body: { choices: [{ index: 0, message: { role: 'assistant', content } }] } });

function fakeEngines() {
  const asrs = new Map<string, FakeAsr>();
  const turn = new FakeTurn();
  const engines: LocalEngines = {
    asr: (config) => { const asr = new FakeAsr(); asr.config = config; asrs.set(config.modelId, asr); return asr; },
    translation: () => { throw new Error('this device does not translate here'); },
    tts: () => { throw new Error('this device does not speak here'); },
    turn: () => turn.connect(),
  };
  return { engines, asrs };
}

/** The released catalog with the fake voice beside it: a voice of its own host, offered alone. */
const CATALOG: ProviderCaps[] = [...CAPS, { id: 'fake_voice', stages: ['speech'], host: 'fake_voice', account: 'none', voiceAlone: true, takesVoice: false }];

function planOver(engines: LocalEngines, transport: TextModelTransport): RunPlan {
  const [whole, , translation, speech] = localInferenceProvider.units!;
  const local = { ...localInferenceProvider, units: [whole, createLocalTranscriptionUnit({ engines }), translation, speech] } as AnyProvider;
  const openai = { ...openaiTextProvider, units: [createOpenAITextUnit({ transport })] } as AnyProvider;
  const plan = compose(LINE_UP, {
    providers: [local, openai, fakeVoiceProvider as AnyProvider],
    settings: (id) => (id === 'local_inference' ? LOCAL_INFERENCE_DEFAULTS : id === 'openai_text' ? TEXT_MODEL_DEFAULTS : undefined),
    catalog: CATALOG,
  });
  if (isRefusal(plan)) throw new Error(`refused: ${plan.refused}`);
  return plan;
}

function configsFor(plan: RunPlan, leg: LegName): PlanConfigs {
  const own = new Map<PlannedUnit, unknown>([[plan.byStage.transcription, LOCAL_INFERENCE_DEFAULTS], [plan.byStage.translation, TEXT_MODEL_DEFAULTS], [plan.byStage.speech, {}]]);
  return new Map(plan.units.map((unit) => [unit, unit.unit.build({ ...SPEAKER, speech: SPEAKER.speech && unit.stages.includes('speech') }, own.get(unit), sharedFor(leg))]));
}

describe("this device transcribing, OpenAI's text model translating, a voice reading: one leg", () => {
  async function opened() {
    const { engines, asrs } = fakeEngines();
    const openai = fakeOpenAI();
    const plan = planOver(engines, openai.transport);
    const clock = createVirtualClock(0);
    const rec = recordConformance();
    const config = configsFor(plan, 'speaker');
    const credentials = (unit: PlannedUnit) => (unit.provider.id === 'openai_text' ? { apiKey: KEY } : {});
    const request: StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown> = { context: SPEAKER, config, credentials, clock, signal: new AbortController().signal };
    const starting = startComposite(plan, request, rec.events);
    await flush();
    const asr = asrs.get('stream-en-kroko')!;
    asr.ready();
    const session = await starting;
    await flush();
    const of = (kind: string) => rec.log.filter((e) => e.kind === kind).map((e) => e.payload as Record<string, unknown>);
    const hear = async (say: () => void) => { say(); await flush(); clock.advance(1); await flush(); };
    return { plan, config, clock, rec, asr, session, of, hear, openai };
  }

  it('is three units, each stage naming its own model: the text model by the one the check found', async () => {
    const h = await opened();
    expect(h.plan.units.map((u) => [u.provider.id, u.unit.id])).toEqual([['local_inference', 'transcription'], ['openai_text', 'translation'], ['fake_voice', 'voice']]);
    expect(describePlan(h.plan, h.config)).toEqual({ asrModel: 'stream-en-kroko', translationModel: 'gpt-5-mini', ttsModel: 'fake-voice' });
    await h.session.stop();
  });

  it('each final is translated by the model, with the earlier stretches told as turns; the voice reads each translation', async () => {
    const h = await opened();
    await h.hear(() => h.asr.final('Hello there.'));
    expect(h.openai.sent[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(h.openai.sent[0].init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect((h.openai.sent[0].body.messages as Array<{ role: string; content: string }>).map((m) => m.role)).toEqual(['system', 'user']);
    expect((h.openai.sent[0].body.messages as Array<{ content: string }>)[0].content).toContain('from English into Japanese');
    await h.openai.answer(says('こんにちは。'));
    await h.hear(() => {});
    await h.hear(() => h.asr.final('How are you?'));
    expect((h.openai.sent[1].body.messages as unknown[]).slice(1)).toEqual([
      { role: 'user', content: 'Hello there.' }, { role: 'assistant', content: 'こんにちは。' }, { role: 'user', content: 'How are you?' },
    ]);
    await h.openai.answer(says('お元気ですか？'));
    await h.hear(() => {});
    const texts = h.of('segmentText').map((e) => [e.ref, e.text]);
    expect(texts).toEqual([[1, 'Hello there.'], [2, 'こんにちは。'], [3, 'How are you?'], [4, 'お元気ですか？']]);
    expect(h.of('segmentOpened')).toEqual([
      { ref: 1, side: 'source', origin: 'u1' }, { ref: 2, side: 'translation', origin: 'u1' },
      { ref: 3, side: 'source', origin: 'u2' }, { ref: 4, side: 'translation', origin: 'u2' },
    ]);
    expect((h.of('audio') as Array<{ ref: number }>).map((a) => a.ref)).toEqual([2, 4]);
    await h.session.stop();
    expect(checkConformance(h.rec.log, SPEAKER)).toEqual([]);
  });

  it("a sentence the service refuses is that sentence's notice, of the translation stage; the next is translated", async () => {
    const h = await opened();
    await h.hear(() => h.asr.final('One.'));
    await h.openai.answer({ status: 503, body: { error: { message: 'The server is overloaded.' } } });
    await h.hear(() => h.asr.final('Two.'));
    await h.openai.answer(says('二。'));
    await h.hear(() => {});
    expect(h.of('degraded')).toEqual([expect.objectContaining({ code: 'translation_failed', message: 'The server is overloaded.', runStage: 'translation' })]);
    expect(h.of('segmentText').map((e) => e.text)).toEqual(['One.', 'Two.', '二。']);
    await h.session.stop();
    expect(checkConformance(h.rec.log, SPEAKER)).toEqual([]);
  });

  it('a key the service refuses ends the leg, naming its code and the translation stage', async () => {
    const h = await opened();
    await h.hear(() => h.asr.final('One.'));
    await h.openai.answer({ status: 401, body: { error: { message: 'Incorrect API key provided.', code: 'invalid_api_key' } } });
    await h.hear(() => {});
    expect(h.of('failed')).toEqual([expect.objectContaining({ message: 'Incorrect API key provided.', code: 'auth', runStage: 'translation' })]);
    await h.session.stop();
    expect(checkConformance(h.rec.log, SPEAKER)).toEqual([]);
  });
});

describe("a run of this device, OpenAI's text model and a voice, through the runner", () => {
  it("builds and starts the plan with each provider's own config and key; the record names the stages and the run the text model", async () => {
    const { engines, asrs } = fakeEngines();
    const openai = fakeOpenAI();
    const clock = createVirtualClock(0);
    const plan = planOver(engines, openai.transport);
    const shape: RunShape = {
      plan,
      accounts: {
        local_inference: { settings: LOCAL_INFERENCE_DEFAULTS, credentials: {} },
        openai_text: { settings: TEXT_MODEL_DEFAULTS, credentials: { apiKey: KEY } },
        fake_voice: { settings: {}, credentials: {} },
      },
      lineUp: LINE_UP,
      lineUpStored: true,
      pair: { source: 'en', target: 'ja' },
      legs: ['speaker'],
      turnMode: 'auto',
      textOnly: false,
      participantSpeech: true,
      keepReplayAudio: true,
      shared: { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
      auth: { signedIn: false, getToken: async () => null },
    };
    const tracked: Array<[string, Record<string, unknown>]> = [];
    const runner = createRunner({
      clock,
      platform: 'electron',
      readShape: () => shape,
      // The text model's check found its models: the build resolves the automatic one among them.
      ensureReady: async (p) => ({ state: 'ready', models: p.id === 'openai_text' ? [{ id: 'gpt-4.1-mini' }, { id: 'gpt-5-mini' }] : [] }),
      persistIfUnchanged: () => {},
      openSource: async () => createFakeSource(clock),
      playback: { audio: () => [], held: () => {}, clear: () => {}, live: () => {} },
      analytics: { track: (event, properties) => { tracked.push([event, properties as Record<string, unknown>]); } },
      newSessionId: () => 'run1',
      timeoutMs: 1000,
    });
    let done = false;
    const starting = runner.start().finally(() => { done = true; });
    while (!done) {
      for (const asr of asrs.values()) asr.ready();
      await flush();
    }
    await starting;
    expect(runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'live' } });
    expect(runner.conversation.info).toMatchObject({ provider: 'local_inference', stages: LINE_UP, models: { asrModel: 'stream-en-kroko', translationModel: 'gpt-5-mini', ttsModel: 'fake-voice' } });
    expect(tracked.find(([event]) => event === 'translation_session_start')![1]).toMatchObject({ provider: 'local_inference', translation_model: 'gpt-5-mini', stages: LINE_UP });
    asrs.get('stream-en-kroko')!.final('Hello.');
    await flush();
    expect(openai.sent[0].body).toMatchObject({ model: 'gpt-5-mini', reasoning_effort: 'minimal' });
    await openai.answer(says('こんにちは。'));
    clock.advance(1);
    await flush();
    expect(runner.conversation.snapshot()[0].segments.map((s) => [s.side, s.text])).toEqual([['source', 'Hello.'], ['translation', 'こんにちは。']]);
    await runner.stop();
    expect(runner.state.getState().phase).toBe('idle');
  });
});
