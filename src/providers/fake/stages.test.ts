import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionContext, StartRequest } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { checkConformance, recordConformance } from '../../lib/contract/conformance';
import { recordEvents } from '../../lib/contract/events';
import type { TranslationStartRequest } from '../../lib/contract/translation';
import { checkTranslation, recordTranslation } from '../../lib/contract/translationConformance';
import { Conversation } from '../../lib/conversation/Conversation';
import type { LegName } from '../../lib/conversation/types';
import { startComposite, type PlanConfigs } from '../../lib/plan/composite';
import { startCompositeBoth } from '../../lib/plan/compositeBoth';
import { separateStages } from '../../lib/plan/compositeStages';
import type { PlannedUnit, RunPlan } from '../../lib/plan/types';
import { isTranslationUnit } from '../../lib/plan/types';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import { AUTO } from '../../lib/provider/languages';
import type { SharedSettings } from '../../lib/provider/types';
import {
  FAKE_TRANSCRIBER_DEFAULTS, fakeTranscriberProvider, fakeTranscript, migrateFakeTranscriberSettings, type FakeTranscriberSettings,
} from './transcriber';
import {
  FAKE_TRANSLATOR_DEFAULTS, fakeTranslatorProvider, migrateFakeTranslatorSettings, startFakeTranslator, type FakeTranslatorConfig, type FakeTranslatorSettings,
} from './translator';
import { fakeVoiceProvider } from './voice';

const SPEAKS: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const SHARED: SharedSettings = { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 }, models: [] };
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const [transcriber] = fakeTranscriberProvider.units!;
const [translator] = fakeTranslatorProvider.units!;
const [voice] = fakeVoiceProvider.units!;

/** The plan of the three fakes, built by hand as the composer will build it. */
function plan(): RunPlan {
  const transcription: PlannedUnit = { provider: fakeTranscriberProvider, unit: transcriber, stages: ['transcription'] };
  const translation: PlannedUnit = { provider: fakeTranslatorProvider, unit: translator, stages: ['translation'] };
  const speech: PlannedUnit = { provider: fakeVoiceProvider, unit: voice, stages: ['speech'] };
  return { units: [transcription, translation, speech], byStage: { transcription, translation, speech } };
}

interface Knobs { transcriber?: Partial<FakeTranscriberSettings>; translator?: Partial<FakeTranslatorSettings> }

/** One leg's request over the plan: each unit's config built from its own settings, as a run builds them. */
function requestFor(p: RunPlan, context: SessionContext, clock: ReturnType<typeof createVirtualClock>, signal: AbortSignal, knobs: Knobs = {}): StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown> {
  const settings = new Map<PlannedUnit, unknown>([
    [p.byStage.transcription, { ...FAKE_TRANSCRIBER_DEFAULTS, ...knobs.transcriber }],
    [p.byStage.translation, { ...FAKE_TRANSLATOR_DEFAULTS, ...knobs.translator }],
    [p.byStage.speech, {}],
  ]);
  const config: PlanConfigs = new Map(p.units.map((unit) => [unit, unit.unit.build({ ...context, speech: context.speech && unit.stages.includes('speech') }, settings.get(unit), SHARED)]));
  return { context, config, credentials: () => ({}), clock, signal };
}

/** A leg of the three fakes, started and recorded as the adapter suite reads it. */
async function leg(knobs: Knobs = {}, context: SessionContext = SPEAKS) {
  const p = plan();
  const clock = createVirtualClock(0);
  const rec = recordConformance();
  const session = await startComposite(p, requestFor(p, context, clock, new AbortController().signal, knobs), rec.events);
  /** Runs the clock on, letting each answer land before the next step of the script. */
  const run = async (ms: number, step = 100) => {
    for (let at = 0; at < ms; at += step) {
      clock.advance(step);
      await flush();
    }
  };
  const of = (kind: string) => rec.log.filter((e) => e.kind === kind).map((e) => e.payload as Record<string, unknown>);
  const stop = async () => {
    rec.mark('stop');
    await session.stop();
    rec.mark('stopped');
  };
  return { p, clock, rec, session, run, of, stop, context };
}

describe('the fake that only transcribes', () => {
  it('is a unit for transcription alone, started as an adapter', () => {
    expect(transcriber.occupies(FAKE_TRANSCRIBER_DEFAULTS, new Set(['transcription']))).toEqual(['transcription']);
    expect(transcriber.occupies(FAKE_TRANSCRIBER_DEFAULTS, new Set(['transcription', 'translation']))).toBeNull();
    expect(transcriber.occupies(FAKE_TRANSCRIBER_DEFAULTS, new Set(['transcription', 'translation', 'speech']))).toBeNull();
    expect(transcriber.start).toBeDefined();
    expect(transcriber.startTranslation).toBeUndefined();
    expect(transcriber.startSpeech).toBeUndefined();
    expect(transcriber.describe(transcriber.build(SPEAKS, FAKE_TRANSCRIBER_DEFAULTS, SHARED))).toEqual({ asrModel: 'fake-transcriber' });
  });

  it('plays source segments only: text that grows, a stable start where the script states one, and a close', async () => {
    const clock = createVirtualClock(0);
    const rec = recordEvents();
    const config = transcriber.build(SPEAKS, FAKE_TRANSCRIBER_DEFAULTS, SHARED);
    await transcriber.start!({ context: SPEAKS, config, credentials: {}, clock, signal: new AbortController().signal }, rec.events);
    clock.advance(10_000);
    const opened = rec.log.filter((e) => e.kind === 'segmentOpened').map((e) => e.payload);
    expect(opened).toEqual([{ ref: 1, side: 'source', origin: 'h1' }, { ref: 2, side: 'source', origin: 'h2' }]);
    const texts = rec.log.filter((e) => e.kind === 'segmentText').map((e) => e.payload as { ref: number; text: string; heard?: { stableLen: number } });
    expect(texts.map((t) => [t.ref, t.text, t.heard?.stableLen])).toEqual([
      [1, 'Hello', undefined],
      [1, 'Hello. How are', 10],
      [1, 'Hello. How are you today?', 10],
      [2, 'I am fine', undefined],
      [2, 'I am fine, thank you.', undefined],
    ]);
    expect(rec.log.filter((e) => e.kind === 'segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1, origin: 'h1' }, { ref: 2, origin: 'h2' }]);
    expect(rec.log.some((e) => e.kind === 'audio')).toBe(false);
  });

  it('shows typed text as a source and translates nothing itself', async () => {
    const clock = createVirtualClock(0);
    const rec = recordEvents();
    const session = await transcriber.start!({ context: SPEAKS, config: transcriber.build(SPEAKS, FAKE_TRANSCRIBER_DEFAULTS, SHARED), credentials: {}, clock, signal: new AbortController().signal }, rec.events);
    session.appendText('typed words');
    expect(rec.log.map((e) => e.kind)).toEqual(['segmentOpened', 'segmentText', 'segmentClosed']);
    expect(rec.log[0].payload).toMatchObject({ side: 'source' });
    expect(transcriber.capabilities(FAKE_TRANSCRIBER_DEFAULTS).textInput).toBe(true);
  });

  it('has a script whose connection drops with a source open, and comes back', () => {
    const steps = fakeTranscript('reconnect').blocks.flatMap((b) => b.steps.map((s) => Object.keys(s).find((k) => k !== 'at')));
    expect(steps).toEqual(['open', 'text', 'reconnecting', 'close', 'reconnected', 'open', 'text', 'close']);
  });

  it('makes its settings valid', () => {
    expect(migrateFakeTranscriberSettings({})).toEqual(FAKE_TRANSCRIBER_DEFAULTS);
    expect(migrateFakeTranscriberSettings({ script: 'reconnect' })).toEqual({ script: 'reconnect' });
    expect(migrateFakeTranscriberSettings({ script: 'nope' })).toEqual(FAKE_TRANSCRIBER_DEFAULTS);
  });
});

describe('the fake that only translates', () => {
  function session(settings: Partial<FakeTranslatorSettings> = {}) {
    const clock = createVirtualClock(0);
    const config = translator.build({ ...SPEAKS, speech: false }, { ...FAKE_TRANSLATOR_DEFAULTS, ...settings }, SHARED) as FakeTranslatorConfig;
    const request: TranslationStartRequest<FakeTranslatorConfig, Record<string, never>> = { leg: 'speaker', context: { ...SPEAKS, speech: false }, config, credentials: {}, clock, signal: new AbortController().signal };
    const { session: s, log } = recordTranslation(startFakeTranslator, request);
    const texts = () => log.flatMap((e) => (e.kind === 'translationText' ? [e.payload.text] : []));
    return { clock, session: s, log, texts };
  }

  it('a start whose run was already cancelled rejects its open, and one that was not opens', async () => {
    const config = translator.build({ ...SPEAKS, speech: false }, FAKE_TRANSLATOR_DEFAULTS, SHARED) as FakeTranslatorConfig;
    const cancelled = new AbortController();
    cancelled.abort(new Error('cancelled'));
    const { session: s, log } = recordTranslation(startFakeTranslator, { leg: 'speaker', context: { ...SPEAKS, speech: false }, config, credentials: {}, clock: createVirtualClock(0), signal: cancelled.signal });
    await expect(s.open()).rejects.toThrow('cancelled');
    expect(log.map((e) => e.kind)).toEqual(['start', 'open']);
    await expect(session().session.open()).resolves.toBeUndefined();
  });

  it('is a unit for translation alone, started through the translation contract', () => {
    expect(translator.occupies(FAKE_TRANSLATOR_DEFAULTS, new Set(['translation']))).toEqual(['translation']);
    expect(translator.occupies(FAKE_TRANSLATOR_DEFAULTS, new Set(['transcription', 'translation']))).toBeNull();
    expect(translator.occupies(FAKE_TRANSLATOR_DEFAULTS, new Set(['translation', 'speech']))).toBeNull();
    expect(isTranslationUnit(translator)).toBe(true);
    expect(translator.start).toBeUndefined();
    expect(translator.startSpeech).toBeUndefined();
    expect(translator.describe(translator.build(SPEAKS, FAKE_TRANSLATOR_DEFAULTS, SHARED))).toEqual({ translationModel: 'fake-translator' });
  });

  it('says which pairs it translates: its three languages, never a language into itself, never an unknown source', () => {
    const translates = translator.capabilities(FAKE_TRANSLATOR_DEFAULTS).translates!;
    expect(translates('en', 'ja')).toBe(true);
    expect(translates('zh', 'en')).toBe(true);
    expect(translates('en', 'en')).toBe(false);
    expect(translates(AUTO, 'en')).toBe(false);
    expect(translates('en', 'fr')).toBe(false);
  });

  it('answers each stretch with the text marked by the language it was put into, a sentence at a time and the rest at the close', async () => {
    const h = session();
    await h.session.open();
    h.session.source({ origin: 'h1', text: 'Hello. How are', stableLen: 10, closed: false });
    await flush();
    h.session.source({ origin: 'h1', text: 'Hello. How are you?', stableLen: 19, closed: true });
    await flush();
    expect(h.texts()).toEqual(['[ja] Hello.', '[ja] How are you?']);
    expect(h.log.filter((e) => e.kind === 'translationText').map((e) => (e.kind === 'translationText' ? [e.payload.stableLen, e.payload.language] : []))).toEqual([[11, 'ja'], [17, 'ja']]);
    await h.session.stop();
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('answers after its delay, on the request\'s clock', async () => {
    const h = session({ delayMs: 300 });
    h.session.source({ origin: 'h1', text: 'Hello.', stableLen: 6, closed: true });
    h.clock.advance(299);
    await flush();
    expect(h.texts()).toEqual([]);
    h.clock.advance(1);
    await flush();
    expect(h.texts()).toEqual(['[ja] Hello.']);
  });

  it('fails the job whose text holds the fault word, and translates the next', async () => {
    const h = session({ failOn: 'oops' });
    h.session.source({ origin: 'h1', text: 'This is oops.', stableLen: 13, closed: true });
    h.session.source({ origin: 'h2', text: 'This is fine.', stableLen: 13, closed: true });
    await flush();
    expect(h.log.filter((e) => e.kind === 'degraded')).toEqual([expect.objectContaining({ payload: expect.objectContaining({ code: 'translation_failed', message: 'The fake translator failed this sentence (fault knob).' }) })]);
    expect(h.texts()).toEqual(['[ja] This is fine.']);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('dies on the text that holds the fatal word: failed, and nothing more', async () => {
    const h = session({ dieOn: 'boom' });
    h.session.source({ origin: 'h1', text: 'Then boom.', stableLen: 10, closed: true });
    h.session.source({ origin: 'h2', text: 'Unheard.', stableLen: 8, closed: true });
    await flush();
    expect(h.log.filter((e) => e.kind === 'failed')).toEqual([expect.objectContaining({ payload: expect.objectContaining({ message: 'The fake translator is gone (fault knob).' }) })]);
    expect(h.texts()).toEqual([]);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a stop in the middle of a delayed job leaves no timer armed and says nothing of it', async () => {
    const h = session({ delayMs: 300 });
    h.session.source({ origin: 'h1', text: 'Hello.', stableLen: 6, closed: true });
    h.clock.advance(100);
    await h.session.stop();
    expect(h.clock.pending()).toBe(0);
    h.clock.advance(1000);
    await flush();
    expect(h.texts()).toEqual([]);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('makes its settings valid', () => {
    expect(migrateFakeTranslatorSettings({})).toEqual(FAKE_TRANSLATOR_DEFAULTS);
    expect(migrateFakeTranslatorSettings({ delayMs: 250, failOn: 'x', dieOn: 'y' })).toEqual({ delayMs: 250, failOn: 'x', dieOn: 'y' });
    expect(migrateFakeTranslatorSettings({ delayMs: -1, failOn: 3, dieOn: null })).toEqual(FAKE_TRANSLATOR_DEFAULTS);
  });
});

describe('a leg of the three fakes, end to end', () => {
  it('is a plan the composite runs with its stages apart', () => {
    expect(separateStages(plan())).not.toBeNull();
  });

  it('keeps the transcriber\'s origins on the source rows, translates per sentence of the stable start and at the close, and reads the translations in order', async () => {
    const h = await leg();
    await h.run(700);
    // The first sentence is stable, and stable text follows it: its translation is there while the source is still open.
    expect(h.of('segmentOpened')).toEqual([{ ref: 1, side: 'source', origin: 'h1' }, { ref: 2, side: 'translation', origin: 'h1' }]);
    expect(h.of('segmentClosed')).toEqual([{ ref: 2, origin: 'h1' }]);
    await h.run(9_300);
    expect(h.of('segmentOpened')).toEqual([
      { ref: 1, side: 'source', origin: 'h1' },
      { ref: 2, side: 'translation', origin: 'h1' },
      { ref: 3, side: 'translation', origin: 'h1' },
      { ref: 4, side: 'source', origin: 'h2' },
      // Nothing of the second source was said to be stable: one translation, at its close.
      { ref: 5, side: 'translation', origin: 'h2' },
    ]);
    const last = new Map(h.of('segmentText').map((e) => [e.ref as number, e.text as string]));
    expect([...last]).toEqual([
      [1, 'Hello. How are you today?'],
      [2, '[ja] Hello.'],
      [3, '[ja] How are you today?'],
      [4, 'I am fine, thank you.'],
      [5, '[ja] I am fine, thank you.'],
    ]);
    // Refs are the leg's: each once.
    const refs = h.of('segmentOpened').map((e) => e.ref);
    expect(new Set(refs).size).toBe(refs.length);
    // The voice read each translation, in order, and every clip says which characters of its row it speaks.
    const audio = h.of('audio') as Array<{ ref: number; range: [number, number] }>;
    expect(audio.map((a) => a.ref)).toEqual([2, 3, 5]);
    for (const { ref, range } of audio) expect(last.get(ref)!.slice(range[0], range[1])).toBe(last.get(ref));
    await h.stop();
    expect(checkConformance(h.rec.log, h.context)).toEqual([]);
  });

  it('several translations of one source are one row of the conversation', async () => {
    const h = await leg();
    const conversation = new Conversation({ leg: 'speaker', session: 's1', languages: SPEAKS.direction, clock: h.clock });
    for (const entry of h.rec.log) if (entry.kind !== 'marker') conversation.apply(entry);
    const seen = h.rec.log.length;
    await h.run(10_000);
    for (const entry of h.rec.log.slice(seen)) if (entry.kind !== 'marker') conversation.apply(entry);
    const rows = createProjector().project([conversation.snapshot()], DEFAULT_PROJECTION).filter((e) => e.kind === 'exchange');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => (r.kind === 'exchange' ? [r.pairing, r.source.map((s) => s.text).join('|'), r.translation.map((s) => s.text).join('|')] : []))).toEqual([
      ['stated', 'Hello. How are you today?', '[ja] Hello.|[ja] How are you today?'],
      ['stated', 'I am fine, thank you.', '[ja] I am fine, thank you.'],
    ]);
    await h.stop();
  });

  it('a job that fails leaves its row with its source alone, tells the user, and the next is translated', async () => {
    const h = await leg({ translator: { failOn: 'Hello' } });
    await h.run(10_000);
    expect(h.of('degraded')).toEqual([expect.objectContaining({ code: 'translation_failed', runStage: 'translation' })]);
    expect(h.of('segmentOpened').map((e) => [e.side, e.origin])).toEqual([['source', 'h1'], ['translation', 'h1'], ['source', 'h2'], ['translation', 'h2']]);
    expect(h.of('segmentText').filter((e) => (e.text as string).startsWith('[ja]')).map((e) => e.text)).toEqual(['[ja] How are you today?', '[ja] I am fine, thank you.']);
    await h.stop();
    expect(checkConformance(h.rec.log, h.context)).toEqual([]);
  });

  it('a translator that dies fails the leg, naming its stage, and nothing follows', async () => {
    const h = await leg({ translator: { dieOn: 'fine' } });
    await h.run(10_000);
    const kinds = h.rec.log.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'failed')).toHaveLength(1);
    expect(kinds[kinds.length - 1]).toBe('failed');
    expect(h.of('failed')).toEqual([expect.objectContaining({ message: 'The fake translator is gone (fault knob).', runStage: 'translation' })]);
    expect(h.clock.pending()).toBe(0);
    expect(checkConformance(h.rec.log, h.context)).toEqual([]);
  });

  it('a transcriber that reconnects: what was heard before the drop is translated once, and the leg goes on', async () => {
    const h = await leg({ transcriber: { script: 'reconnect' } });
    await h.run(10_000);
    const kinds = h.rec.log.map((e) => e.kind);
    expect(kinds.indexOf('reconnecting')).toBeGreaterThan(-1);
    expect(kinds.indexOf('reconnected')).toBeGreaterThan(kinds.indexOf('reconnecting'));
    expect(h.of('segmentText').filter((e) => (e.text as string).startsWith('[ja]')).map((e) => e.text)).toEqual(['[ja] Before the drop.', '[ja] And then', '[ja] Back again.']);
    // The translation of what was open at the drop came while the connection was still away.
    const at = (text: string) => h.rec.log.findIndex((e) => e.kind === 'segmentText' && e.payload.text === text);
    expect(at('[ja] And then')).toBeLessThan(kinds.indexOf('reconnected'));
    await h.stop();
    expect(checkConformance(h.rec.log, h.context)).toEqual([]);
  });

  it('a stop in the middle of a job says nothing after it', async () => {
    const h = await leg({ translator: { delayMs: 1_000 } });
    await h.run(1_200);
    await h.stop();
    const said = h.rec.log.length;
    await h.run(10_000);
    expect(h.rec.log).toHaveLength(said);
    expect(h.clock.pending()).toBe(0);
    expect(checkConformance(h.rec.log, h.context)).toEqual([]);
  });

  it('typed text is shown by the transcriber and answered by the translator', async () => {
    const h = await leg();
    h.rec.mark('appendText', 'typed words');
    h.session.appendText('typed words');
    await flush();
    expect(h.of('segmentText').map((e) => e.text)).toEqual(['typed words', '[ja] typed words']);
    await h.stop();
    expect(checkConformance(h.rec.log, h.context)).toEqual([]);
  });

  it('a leg that does not speak is translated and not read', async () => {
    const h = await leg({}, { ...SPEAKS, speech: false });
    await h.run(10_000);
    expect(h.of('segmentOpened')).toHaveLength(5);
    expect(h.of('audio')).toEqual([]);
    await h.stop();
    expect(checkConformance(h.rec.log, h.context)).toEqual([]);
  });

  it('both legs run as two legs, each translated in its own direction and read by its own voice', async () => {
    const p = plan();
    const clock = createVirtualClock(0);
    const signal = new AbortController().signal;
    const contexts: Record<LegName, SessionContext> = { speaker: SPEAKS, participant: { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' } };
    const rec = { speaker: recordConformance(), participant: recordConformance() };
    const sessions = await startCompositeBoth(
      p,
      { speaker: requestFor(p, contexts.speaker, clock, signal), participant: requestFor(p, contexts.participant, clock, signal) },
      { speaker: rec.speaker.events, participant: rec.participant.events },
    );
    for (let at = 0; at < 10_000; at += 100) {
      clock.advance(100);
      await flush();
    }
    const translations = (name: LegName) => rec[name].log.flatMap((e) => (e.kind === 'segmentText' && e.payload.text.startsWith('[') ? [`${e.payload.ref} ${e.payload.text}`] : []));
    expect(translations('speaker')).toEqual(['2 [ja] Hello.', '3 [ja] How are you today?', '5 [ja] I am fine, thank you.']);
    expect(translations('participant')).toEqual(['2 [en] Hello.', '3 [en] How are you today?', '5 [en] I am fine, thank you.']);
    for (const name of ['speaker', 'participant'] as const) {
      expect(rec[name].log.flatMap((e) => (e.kind === 'audio' ? [e.payload.ref] : []))).toEqual([2, 3, 5]);
      rec[name].mark('stop');
      await sessions[name].stop();
      rec[name].mark('stopped');
      expect(checkConformance(rec[name].log, contexts[name])).toEqual([]);
    }
  });
});

describe('the fakes of one stage in the catalog and the registry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function build(mode: string, dev: boolean) {
    vi.stubEnv('MODE', mode);
    vi.stubEnv('DEV', dev);
    vi.resetModules();
    const [catalog, composer, registry] = await Promise.all([import('../../lib/lineup/catalog'), import('../../lib/plan/compose'), import('../registry')]);
    return { catalog, composer, registry };
  }

  it('each serves its one stage and hosts itself, in the build whose line-up may name the fakes', async () => {
    const { catalog } = await build('e2e', false);
    expect(catalog.caps('fake_transcriber')).toEqual({ id: 'fake_transcriber', stages: ['transcription'], host: 'fake_transcriber', account: 'none', voiceAlone: false, takesVoice: true });
    expect(catalog.caps('fake_translator')).toEqual({ id: 'fake_translator', stages: ['translation'], host: 'fake_translator', account: 'none', voiceAlone: false, takesVoice: true });
  });

  it('are in no other catalog, and in no release build', async () => {
    for (const [mode, dev] of [['production', false], ['development', true], ['test', true]] as const) {
      const { catalog, registry } = await build(mode, dev);
      expect(catalog.caps('fake_transcriber')).toBeUndefined();
      expect(catalog.caps('fake_translator')).toBeUndefined();
      const ids = registry.PROVIDERS.map((p) => p.id);
      expect(ids.includes('fake_transcriber')).toBe(dev);
      expect(ids.includes('fake_translator')).toBe(dev);
    }
    const e2e = await build('e2e', false);
    expect(e2e.registry.PROVIDERS.map((p) => p.id)).toEqual(expect.arrayContaining(['fake_transcriber', 'fake_translator']));
  });

  it('the three fakes of one stage each compose to a plan of three units, which the composite runs', async () => {
    const { composer } = await build('e2e', false);
    const composed = composer.compose(
      { transcription: 'fake_transcriber', translation: 'fake_translator', speech: 'fake_voice' },
      { providers: [fakeTranscriberProvider, fakeTranslatorProvider, fakeVoiceProvider], settings: () => ({}) },
    );
    if ('refused' in composed) throw new Error(`refused: ${composed.refused}`);
    expect(composed.units.map((u) => [u.provider.id, u.unit.id, u.stages])).toEqual([
      ['fake_transcriber', 'transcriber', ['transcription']],
      ['fake_translator', 'translator', ['translation']],
      ['fake_voice', 'voice', ['speech']],
    ]);
    expect(separateStages(composed)).not.toBeNull();
  });

  it('neither starts as a provider on its own', async () => {
    const request = { context: SPEAKS, config: {} as never, credentials: {}, clock: createVirtualClock(0), signal: new AbortController().signal };
    await expect(fakeTranslatorProvider.start(request, recordEvents().events)).rejects.toMatchObject({ code: 'plan_unsupported' });
    await expect(fakeTranscriberProvider.start(request, recordEvents().events)).rejects.toMatchObject({ code: 'plan_unsupported' });
  });
});
