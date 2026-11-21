/**
 * Soniox transcribing alone, its translation another unit's and its words read by a voice: the adapter on its own,
 * then the leg of three units (Soniox with an own key, the fake translator, the fake voice), then a run on Kizuna
 * AI's Soniox with its lease. The plans are built by hand: no line-up reaches this unit yet. Sockets are fake and
 * the service is a stub `fetch`; nothing reaches a network.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SessionContext, StartRequest } from '../../lib/contract/adapter';
import { checkConformance, recordConformance } from '../../lib/contract/conformance';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { flush } from '../../lib/contract/testing/drive';
import type { LegName } from '../../lib/conversation/types';
import { describePlan, startComposite, type PlanConfigs } from '../../lib/plan/composite';
import { startCompositeBoth } from '../../lib/plan/compositeBoth';
import { separateStages } from '../../lib/plan/compositeStages';
import type { PlannedUnit, RunPlan } from '../../lib/plan/types';
import type { AnyProvider, SharedSettings } from '../../lib/provider/types';
import { createRunner } from '../../lib/session/runner';
import type { RunShape } from '../../lib/session/types';
import { createFakeSource } from '../fake/source';
import { FAKE_TRANSLATOR_DEFAULTS, fakeTranslatorProvider } from '../fake/translator';
import { fakeVoiceProvider } from '../fake/voice';
import { createSonioxAdapter } from './adapter';
import { buildSonioxAlone, type SonioxConfig } from './config';
import { kizunaSonioxProvider } from './kizuna';
import { createKizunaLease } from './lease';
import { PARTICIPANT_SPEECH_FIELD, requestedRoles, type LeaseRequest } from './leaseRequest';
import { sonioxProvider } from './provider';
import { SONIOX_DEFAULTS, type SonioxCredentials, type SonioxSettings } from './settings';
import type { SonioxToken } from './sttStream';
import { b64, isStt, KEY, SHARED, trackedClock, type Json } from './testing';
import { createSonioxTtsUnit } from './ttsUnit';
import { sonioxSttUnitFor, sonioxTranscriptionUnitFor } from './units';

const SPEAKER: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const PARTICIPANT: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
const CONTEXTS: Record<LegName, SessionContext> = { speaker: SPEAKER, participant: PARTICIPANT };

/** A token of a socket asked for no translation: it says nothing of one. */
const heard = (text: string, is_final = true, language = 'en'): SonioxToken => ({ text, is_final, language, start_ms: 0, end_ms: 500 });
const END: SonioxToken = { text: '<end>', is_final: true };
const msg = (...tokens: SonioxToken[]) => JSON.stringify({ tokens });
const openAll = (sockets: ReturnType<typeof fakeSockets>) => { for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open(); };
/** The frame a socket was opened with. */
const frameOf = (s: FakeSocket) => s.sentJson<Json>()[0];
const sharedFor = (leg: LegName, more: Partial<SharedSettings> = {}): SharedSettings => ({ ...SHARED, reversed: () => leg === 'participant', ...more });

describe('the Soniox adapter over a config that transcribes alone', () => {
  async function single(leg: LegName, o: { settings?: Partial<SonioxSettings>; shared?: Partial<SharedSettings> } = {}) {
    const sockets = fakeSockets();
    const { clock, timers } = trackedClock();
    const { events, log } = recordEvents();
    const context = CONTEXTS[leg];
    const config = buildSonioxAlone(context, { ...SONIOX_DEFAULTS, ...o.settings }, sharedFor(leg, o.shared));
    const starting = createSonioxAdapter({ openSocket: sockets.create }).start({ context, config, credentials: KEY, clock, signal: new AbortController().signal }, events);
    openAll(sockets);
    const session = await starting;
    const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
    return { sockets, clock, timers, log, session, of, stt: () => sockets.all.filter(isStt).slice(-1)[0] };
  }

  it('the frame names no translation and hints the source alone; the word list is its terms and the background', async () => {
    const words = { entries: [{ written: 'Sokuji' }, { written: 'Kizuna AI', translation: 'キズナAI' }], background: 'Quarterly review.' };
    const h = await single('speaker', { shared: { words } });
    expect(frameOf(h.stt())).toEqual({
      model: 'stt-rt-v6',
      audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
      enable_endpoint_detection: true,
      context: { terms: ['Sokuji', 'Kizuna AI'], text: 'Quarterly review.' },
      enable_language_identification: true,
      language_hints: ['en'],
    });
    // The Logs' line of the opening says nothing of a translation either.
    expect(h.of('frame').filter((e) => e.payload.type === 'session.opened').map((e) => e.payload.payload)).toEqual([{ region: 'us' }]);
    await h.session.stop();
    expect(h.timers()).toBe(0);
  });

  it("the participant's leg started alone: its own socket, its own source as the one hint, its people labelled", async () => {
    const h = await single('participant');
    expect(h.sockets.all).toHaveLength(1);
    expect(frameOf(h.stt())).toMatchObject({ language_hints: ['ja'], enable_speaker_diarization: true });
    expect(frameOf(h.stt())).not.toHaveProperty('translation');
    h.stt().receive(msg({ ...heard('大丈夫。', true, 'ja'), speaker: '1' }, END));
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source', origin: 'u1', person: '1.1' }]);
    expect(h.session.info).toEqual({ transport: 'websocket', region: 'us' });
    await h.session.stop();
  });

  it('says source segments only, each with its stable length, and closes at the endpoint with nothing left waiting', async () => {
    const h = await single('speaker');
    const idle = h.timers();
    h.stt().receive(msg(heard('Hello.'), heard(' How are', false)));
    h.stt().receive(msg(heard(' How are you?'), END));
    // A token marked as a translation, which the socket was not asked for, is dropped.
    h.stt().receive(msg({ text: 'こんにちは。', is_final: true, translation_status: 'translation', language: 'ja', source_language: 'en' }));
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source', origin: 'u1' }]);
    expect(h.of('segmentText').map((e) => [e.payload.text, e.payload.heard?.stableLen])).toEqual([['Hello. How are', 6], ['Hello. How are you?', 19]]);
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1, origin: 'u1' }]);
    // No grace was armed for a translation that will not come.
    expect(h.timers()).toBe(idle);
    await h.session.stop();
    expect(checkConformance(h.log, SPEAKER)).toEqual([]);
  });

  it('a start of both legs over such configs is two sockets, never the mixed one, though the settings ask for it', async () => {
    const sockets = fakeSockets();
    const { clock } = trackedClock();
    const rec = { speaker: recordEvents(), participant: recordEvents() };
    const s: SonioxSettings = { ...SONIOX_DEFAULTS, bothModeSharedSession: true };
    const request = (leg: LegName): StartRequest<SonioxConfig, SonioxCredentials> =>
      ({ context: CONTEXTS[leg], config: buildSonioxAlone(CONTEXTS[leg], s, sharedFor(leg)), credentials: KEY, clock, signal: new AbortController().signal });
    // Even a config that says shared (built by other hands) is split when it transcribes alone.
    const speaker = { ...request('speaker'), config: { ...request('speaker').config, sharedBoth: true } };
    const starting = createSonioxAdapter({ openSocket: sockets.create }).startBoth({ speaker, participant: request('participant') }, { speaker: rec.speaker.events, participant: rec.participant.events });
    openAll(sockets);
    const sessions = await starting;
    expect(sockets.all.map((x) => frameOf(x).language_hints)).toEqual([['en'], ['ja']]);
    expect(sockets.all.some((x) => 'translation' in frameOf(x))).toBe(false);
    expect(sessions.speaker.info.shared).toBeUndefined();
    await Promise.all([sessions.speaker.stop(), sessions.participant.stop()]);
  });
});

/** Soniox with an own key transcribing alone, the fake translator and the fake voice: the plan as the composer will build it. */
function threeUnits(sockets: ReturnType<typeof fakeSockets>): RunPlan {
  const adapter = createSonioxAdapter({ openSocket: sockets.create });
  const transcription: PlannedUnit = { provider: sonioxProvider as AnyProvider, unit: sonioxTranscriptionUnitFor({ start: adapter.start }), stages: ['transcription'] };
  const translation: PlannedUnit = { provider: fakeTranslatorProvider, unit: fakeTranslatorProvider.units![0], stages: ['translation'] };
  const speech: PlannedUnit = { provider: fakeVoiceProvider, unit: fakeVoiceProvider.units![0], stages: ['speech'] };
  return { units: [transcription, translation, speech], byStage: { transcription, translation, speech } };
}

/** One leg's configs, each unit built with its own settings, as a run builds them. */
function configsFor(plan: RunPlan, leg: LegName, settings: SonioxSettings, more: Partial<SharedSettings> = {}): PlanConfigs {
  const context = CONTEXTS[leg];
  const own = new Map<PlannedUnit, unknown>([[plan.byStage.transcription, settings], [plan.byStage.translation, FAKE_TRANSLATOR_DEFAULTS], [plan.byStage.speech, {}]]);
  return new Map(plan.units.map((unit) => [unit, unit.unit.build({ ...context, speech: context.speech && unit.stages.includes('speech') }, own.get(unit), sharedFor(leg, more))]));
}

describe('Soniox transcribing alone in a leg of three units: the fake translator and the fake voice', () => {
  async function leg(o: { settings?: Partial<SonioxSettings>; shared?: Partial<SharedSettings> } = {}) {
    const sockets = fakeSockets();
    const { clock, timers } = trackedClock();
    const plan = threeUnits(sockets);
    const rec = recordConformance();
    const config = configsFor(plan, 'speaker', { ...SONIOX_DEFAULTS, ...o.settings }, o.shared);
    let done = false;
    const starting = startComposite(plan, { context: SPEAKER, config, credentials: (unit) => (unit.provider.id === 'soniox' ? KEY : {}), clock, signal: new AbortController().signal }, rec.events).finally(() => { done = true; });
    while (!done) {
      openAll(sockets);
      await flush();
    }
    const session = await starting;
    const of = (kind: string) => rec.log.filter((e) => e.kind === kind).map((e) => e.payload as Record<string, unknown>);
    /** What the server says, then every answer it sets off: the translator's, and the voice's on the next tick of the clock. */
    const receive = async (...messages: string[]) => {
      for (const m of messages) sockets.all.filter(isStt).slice(-1)[0].receive(m);
      await flush();
      clock.advance(1);
      await flush();
    };
    const stop = async () => {
      rec.mark('stop');
      await session.stop();
      rec.mark('stopped');
    };
    return { sockets, clock, timers, plan, config, rec, session, of, receive, stop, stt: () => sockets.all.filter(isStt) };
  }

  it('is a plan the composite runs with its stages apart, each stage naming its own unit\'s model', async () => {
    const h = await leg();
    expect(separateStages(h.plan)).not.toBeNull();
    expect(describePlan(h.plan, h.config)).toEqual({ asrModel: 'stt-rt-v6', translationModel: 'fake-translator', ttsModel: 'fake-voice' });
    await h.stop();
  });

  it("the socket is asked for no translation; the rows keep Soniox's origins; a stable sentence is translated while the source is open, the rest at its close; the voice reads each", async () => {
    const h = await leg({ shared: { words: { entries: [{ written: 'Sokuji', translation: 'ソクジ' }], background: '' } } });
    // One socket, and it is the transcription's: neither fake opens one.
    expect(h.sockets.all).toHaveLength(1);
    expect(frameOf(h.stt()[0])).toEqual({
      model: 'stt-rt-v6',
      audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
      enable_endpoint_detection: true,
      context: { terms: ['Sokuji'] },
      enable_language_identification: true,
      language_hints: ['en'],
    });

    // The first sentence is final, and nothing final follows it yet: it may still go on, so nothing is translated.
    await h.receive(msg(heard('Hello.'), heard(' How are', false)));
    expect(h.of('segmentOpened')).toEqual([{ ref: 1, side: 'source', origin: 'u1' }]);
    // A final word follows it: the sentence is translated while its source is still open.
    await h.receive(msg(heard(' How are'), heard(' you today?', false)));
    expect(h.of('segmentOpened')).toEqual([{ ref: 1, side: 'source', origin: 'u1' }, { ref: 2, side: 'translation', origin: 'u1' }]);
    expect(h.of('segmentClosed')).toEqual([{ ref: 2, origin: 'u1' }]);
    // The endpoint closes the source, and the rest is translated.
    await h.receive(msg(heard(' you today?'), END));
    // The next utterance is final at once and whole: one translation, at its close.
    await h.receive(msg(heard('I am fine, thank you.'), END));
    expect(h.of('segmentOpened')).toEqual([
      { ref: 1, side: 'source', origin: 'u1' },
      { ref: 2, side: 'translation', origin: 'u1' },
      { ref: 3, side: 'translation', origin: 'u1' },
      { ref: 4, side: 'source', origin: 'u2' },
      { ref: 5, side: 'translation', origin: 'u2' },
    ]);
    const last = new Map(h.of('segmentText').map((e) => [e.ref as number, e.text as string]));
    expect([...last]).toEqual([
      [1, 'Hello. How are you today?'],
      [2, '[ja] Hello.'],
      [3, '[ja] How are you today?'],
      [4, 'I am fine, thank you.'],
      [5, '[ja] I am fine, thank you.'],
    ]);
    // The source's own close comes before the translation of its rest.
    const closed = h.of('segmentClosed').map((e) => e.ref);
    expect(closed).toEqual([2, 1, 3, 4, 5]);
    // The voice read each translation, in order, each clip saying which characters of its row it speaks.
    const audio = h.of('audio') as Array<{ ref: number; range: [number, number] }>;
    expect(audio.map((a) => a.ref)).toEqual([2, 3, 5]);
    for (const { ref, range } of audio) expect(last.get(ref)!.slice(range[0], range[1])).toBe(last.get(ref));
    // Every lifecycle word of the transcription says its stage.
    expect(h.of('frame').filter((f) => f.type === 'session.opened')).toEqual([{ direction: 'out', type: 'session.opened', payload: { region: 'us' }, runStage: 'transcription' }]);

    await h.stop();
    expect(h.sockets.all.every((s) => s.closedByClient !== null)).toBe(true);
    expect(h.timers()).toBe(0);
    expect(checkConformance(h.rec.log, SPEAKER)).toEqual([]);
  });

  it('a reconnect in the middle of an utterance: the open source is handed to the translator once, and the leg goes on on a socket opened with the same frame', async () => {
    const h = await leg();
    await h.receive(msg(heard('Before the drop.'), heard(' And'), heard(' then', false)));
    // The stable sentence was translated already; the rest waits for the close.
    expect(h.of('segmentText').filter((e) => (e.text as string).startsWith('[ja]')).map((e) => e.text)).toEqual(['[ja] Before the drop.']);
    const first = h.stt()[0];
    first.serverClose(1006);
    await flush();
    h.clock.advance(1);
    await flush();
    // The connection is still away: what was open closed as it stood and was translated, once.
    expect(h.rec.log.some((e) => e.kind === 'reconnected')).toBe(false);
    expect(h.of('segmentClosed').filter((e) => e.ref === 1)).toEqual([{ ref: 1, origin: 'u1' }]);
    expect(h.of('segmentText').filter((e) => (e.text as string).startsWith('[ja]')).map((e) => e.text)).toEqual(['[ja] Before the drop.', '[ja] And then']);
    const kinds = () => h.rec.log.map((e) => e.kind);
    // The row closed before the leg said it was reconnecting: nothing was left open to hand over twice.
    expect(kinds().lastIndexOf('segmentClosed')).toBeGreaterThan(-1);
    expect(kinds().indexOf('reconnecting')).toBeGreaterThan(h.rec.log.findIndex((e) => e.kind === 'segmentClosed' && e.payload.ref === 1));

    expect(h.stt()).toHaveLength(2);
    h.stt()[1].open();
    await flush();
    expect(kinds().filter((k) => k === 'reconnecting' || k === 'reconnected')).toEqual(['reconnecting', 'reconnected']);
    expect(frameOf(h.stt()[1])).toEqual(frameOf(first));
    expect(frameOf(h.stt()[1])).not.toHaveProperty('translation');
    await h.receive(msg(heard('Back again.'), END));
    expect(h.of('segmentOpened').map((e) => [e.side, e.origin])).toEqual([
      ['source', 'u1'], ['translation', 'u1'], ['translation', 'u1'], ['source', 'u2'], ['translation', 'u2'],
    ]);
    expect(h.of('segmentText').filter((e) => (e.text as string).startsWith('[ja]')).map((e) => e.text)).toEqual(['[ja] Before the drop.', '[ja] And then', '[ja] Back again.']);
    expect((h.of('audio') as Array<{ ref: number }>).map((a) => a.ref)).toEqual([2, 3, 5]);

    await h.stop();
    // The first was closed by the server, the second by the stop.
    expect(h.sockets.all.map((s) => s.readyState)).toEqual([FakeSocket.CLOSED, FakeSocket.CLOSED]);
    expect(h.timers()).toBe(0);
    expect(checkConformance(h.rec.log, SPEAKER)).toEqual([]);
  });

  it('a stop with a source open says nothing after it, and leaves no socket and no timer', async () => {
    const h = await leg();
    await h.receive(msg(heard('Half a sen', false)));
    await h.stop();
    const said = h.rec.log.length;
    h.clock.advance(60_000);
    await flush();
    expect(h.rec.log).toHaveLength(said);
    expect(h.sockets.all.every((s) => s.closedByClient !== null)).toBe(true);
    expect(h.timers()).toBe(0);
    expect(checkConformance(h.rec.log, SPEAKER)).toEqual([]);
  });

  it('both legs: two sockets, each hinted with its own source and asked for no translation; each leg translated in its own direction and read by its own voice', async () => {
    const sockets = fakeSockets();
    const { clock, timers } = trackedClock();
    const plan = threeUnits(sockets);
    // The settings ask for the shared session and for agent text: neither applies to legs that transcribe alone.
    const settings: SonioxSettings = { ...SONIOX_DEFAULTS, bothModeSharedSession: true, agentText: true };
    const rec = { speaker: recordConformance(), participant: recordConformance() };
    const signal = new AbortController().signal;
    const request = (name: LegName) => ({ context: CONTEXTS[name], config: configsFor(plan, name, settings, { speaks: true, bothLegs: true }), credentials: (unit: PlannedUnit) => (unit.provider.id === 'soniox' ? KEY : {}), clock, signal });
    let done = false;
    const starting = startCompositeBoth(plan, { speaker: request('speaker'), participant: request('participant') }, { speaker: rec.speaker.events, participant: rec.participant.events }).finally(() => { done = true; });
    while (!done) {
      openAll(sockets);
      await flush();
    }
    const sessions = await starting;
    const stt = sockets.all.filter(isStt);
    expect(sockets.all).toHaveLength(2);
    expect(stt.map((s) => frameOf(s).language_hints)).toEqual([['en'], ['ja']]);
    for (const s of stt) {
      expect(frameOf(s)).not.toHaveProperty('translation');
      expect(frameOf(s)).not.toHaveProperty('enable_agent_text_input');
    }
    // The participant's own socket labels its people; the speaker's does not.
    expect(stt.map((s) => frameOf(s).enable_speaker_diarization)).toEqual([undefined, true]);
    expect([sessions.speaker.info.shared, sessions.participant.info.shared]).toEqual([undefined, undefined]);
    // Audio goes to the socket of its own leg.
    sessions.participant.appendAudio(new Int16Array(240));
    expect(stt.map((s) => s.sent.filter((d) => typeof d !== 'string').length)).toEqual([0, 1]);

    stt[0].receive(msg(heard('Hello.'), END));
    stt[1].receive(msg(heard('大丈夫。', true, 'ja'), END));
    await flush();
    clock.advance(1);
    await flush();
    const texts = (name: LegName) => rec[name].log.flatMap((e) => (e.kind === 'segmentText' ? [`${e.payload.ref} ${e.payload.text}`] : []));
    expect(texts('speaker')).toEqual(['1 Hello.', '2 [ja] Hello.']);
    expect(texts('participant')).toEqual(['1 大丈夫。', '2 [en] 大丈夫。']);
    for (const name of ['speaker', 'participant'] as const) {
      expect(rec[name].log.flatMap((e) => (e.kind === 'audio' ? [e.payload.ref] : []))).toEqual([2]);
      rec[name].mark('stop');
      await sessions[name].stop();
      rec[name].mark('stopped');
      expect(checkConformance(rec[name].log, CONTEXTS[name])).toEqual([]);
    }
    expect(sockets.all.every((s) => s.closedByClient !== null)).toBe(true);
    expect(timers()).toBe(0);
  });
});

const API = 'https://api.test';

/** A run on Kizuna AI's Soniox transcribing alone: the fake translator, and the fake voice or Kizuna AI's own. */
function hostedRun(o: { voice: 'fake' | 'hosted'; legs?: LegName[]; textOnly?: boolean; participantSpeech?: boolean; settings?: Partial<SonioxSettings> }) {
  const sockets = fakeSockets();
  const clock = createVirtualClock(0);
  const adapter = createSonioxAdapter({ openSocket: sockets.create });
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  /** The service: a session-key answer with a key for each role the request expands to, and a 200 for everything else. */
  const service = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.slice(API.length);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({ path, body });
    if (path !== '/soniox/session-key') return new Response('{}', { status: 200 });
    // The body names the participant's intent by the wire's field.
    const roles = requestedRoles({ ...body, participantSpeaks: body[PARTICIPANT_SPEECH_FIELD] === true } as unknown as LeaseRequest);
    return new Response(JSON.stringify({
      leaseId: 'lease-1', clientReferenceId: `ref-${roles[0]}`, region: 'us', maxSessionDurationSeconds: 600,
      streams: roles.map((role) => ({ role, apiKey: `k-${role}`, clientReferenceId: `ref-${role}` })),
    }), { status: 200 });
  });
  const units = [sonioxSttUnitFor({ start: adapter.start }), sonioxTranscriptionUnitFor({ start: adapter.start }), createSonioxTtsUnit({ openSocket: sockets.create })];
  const hosted = {
    ...kizunaSonioxProvider,
    units,
    session: { ...kizunaSonioxProvider.session, acquire: createKizunaLease({ participantSpeech: true, fetch: service as unknown as typeof fetch, apiUrl: () => API }) },
  } as AnyProvider;
  const transcription: PlannedUnit = { provider: hosted, unit: units[1], stages: ['transcription'] };
  const translation: PlannedUnit = { provider: fakeTranslatorProvider, unit: fakeTranslatorProvider.units![0], stages: ['translation'] };
  const speech: PlannedUnit = o.voice === 'hosted'
    ? { provider: hosted, unit: units[2], stages: ['speech'] }
    : { provider: fakeVoiceProvider, unit: fakeVoiceProvider.units![0], stages: ['speech'] };
  const plan: RunPlan = { units: [transcription, translation, speech], byStage: { transcription, translation, speech } };
  const lineUp = { transcription: 'kizunaai_soniox', translation: 'fake_translator', speech: o.voice === 'hosted' ? 'kizunaai_soniox' : 'fake_voice' };
  const shape: RunShape = {
    plan,
    accounts: {
      // The settings ask for the shared session in Both: a leg that transcribes alone never has it.
      kizunaai_soniox: { settings: { ...SONIOX_DEFAULTS, bothModeSharedSession: true, ...o.settings }, credentials: {} },
      fake_translator: { settings: FAKE_TRANSLATOR_DEFAULTS, credentials: {} },
      fake_voice: { settings: {}, credentials: {} },
    },
    lineUp,
    lineUpStored: false,
    pair: { source: 'en', target: 'ja' },
    legs: o.legs ?? ['speaker'],
    turnMode: 'auto',
    textOnly: o.textOnly ?? false,
    participantSpeech: o.participantSpeech ?? false,
    keepReplayAudio: true,
    shared: { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
    auth: { signedIn: true, userId: 'u1', getToken: async () => 'tok' },
  };
  const played: Array<{ leg: LegName; ref: number | undefined }> = [];
  const tracked: Array<[string, Record<string, unknown>]> = [];
  const runner = createRunner({
    clock,
    platform: 'electron',
    readShape: () => shape,
    ensureReady: async () => ({ state: 'ready', models: [] }),
    persistIfUnchanged: () => {},
    openSource: async () => createFakeSource(clock),
    playback: { audio: (leg, ref) => { played.push({ leg, ref }); return []; }, held: () => {}, clear: () => {}, live: () => {} },
    analytics: { track: (event, properties) => { tracked.push([event, properties as Record<string, unknown>]); } },
    newSessionId: () => 'run1',
    timeoutMs: 1000,
  });
  const start = async () => {
    let done = false;
    const starting = runner.start().finally(() => { done = true; });
    while (!done) {
      openAll(sockets);
      await flush();
    }
    await starting;
    openAll(sockets);
    await flush();
  };
  const settle = async () => {
    await flush();
    clock.advance(1);
    await flush();
  };
  const stt = () => sockets.all.filter(isStt);
  const tts = () => sockets.all.filter((s) => !isStt(s));
  const keyOf = (s: FakeSocket) => (s.protocols as string[])[1];
  const sent = (path: string) => requests.filter((r) => r.path === path).map((r) => r.body);
  return { sockets, clock, runner, requests, sent, played, tracked, start, settle, stt, tts, keyOf };
}

describe("Kizuna AI's Soniox transcribing alone, through the runner", () => {
  it("others translate and speak: the request is today's text-only one though the run speaks; the socket runs on the lease's key and names no translation; one start is reported", async () => {
    const h = hostedRun({ voice: 'fake' });
    await h.start();
    expect(h.runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'live' }, budget: { totalMs: 600_000 } });
    // The participant's intent rides along while that flag is on, as in any session's request.
    expect(h.sent('/soniox/session-key')).toEqual([{ mode: 'speaker', textOnly: true, bothSplit: false, region: 'us', participantSpeech: false }]);
    expect([h.stt().length, h.tts().length]).toEqual([1, 0]);
    expect(h.keyOf(h.stt()[0])).toBe('k-spk_stt');
    expect(frameOf(h.stt()[0])).toMatchObject({ language_hints: ['en'], client_reference_id: 'ref-spk_stt' });
    expect(frameOf(h.stt()[0])).not.toHaveProperty('translation');

    h.stt()[0].receive(msg(heard('Hello.'), END));
    await h.settle();
    // The translator answered and the voice read it.
    expect(h.runner.conversation.info).toMatchObject({ provider: 'kizunaai_soniox', models: { asrModel: 'stt-rt-v6', translationModel: 'fake-translator' } });
    expect(h.played).toEqual([{ leg: 'speaker', ref: 2 }]);
    expect(h.sent('/soniox/session-started')).toEqual([expect.objectContaining({ leaseId: 'lease-1', role: 'spk_stt' })]);

    await h.runner.stop();
    expect(h.sent('/soniox/session-end')).toEqual([{ leaseId: 'lease-1' }]);
    expect(h.sockets.all.every((s) => s.closedByClient !== null)).toBe(true);
    expect(h.runner.state.getState().phase).toBe('idle');
  });

  it('both legs: the request asks for split Both whatever the settings say; two sockets, each on its own key, neither mixed; one start reported for each', async () => {
    const h = hostedRun({ voice: 'fake', legs: ['speaker', 'participant'], participantSpeech: true });
    await h.start();
    expect(h.runner.state.getState().phase).toBe('running');
    // The participant's speech is another provider's: nothing of it is asked of this one.
    expect(h.sent('/soniox/session-key')).toEqual([{ mode: 'both', textOnly: true, bothSplit: true, region: 'us', participantSpeech: false }]);
    expect(h.stt().map(h.keyOf)).toEqual(['k-spk_stt', 'k-par_stt']);
    expect(h.stt().map((s) => frameOf(s).language_hints)).toEqual([['en'], ['ja']]);
    for (const s of h.stt()) {
      expect(frameOf(s)).not.toHaveProperty('translation');
      expect(frameOf(s)).not.toHaveProperty('enable_agent_text_input');
    }
    h.stt()[0].receive(msg(heard('Hello.'), END));
    h.stt()[1].receive(msg(heard('大丈夫。', true, 'ja'), END));
    await h.settle();
    expect(h.played).toEqual([{ leg: 'speaker', ref: 2 }, { leg: 'participant', ref: 2 }]);
    expect(h.sent('/soniox/session-started').map((b) => b.role).sort()).toEqual(['par_stt', 'spk_stt']);
    await h.runner.stop();
    expect(h.sent('/soniox/session-end')).toEqual([{ leaseId: 'lease-1' }]);
  });

  it("its own voice reading another's translation: a speaking session's request; the voice on the lease's speech key; the start reported once, by the transcription socket", async () => {
    const h = hostedRun({ voice: 'hosted' });
    await h.start();
    expect(h.runner.state.getState().phase).toBe('running');
    expect(h.sent('/soniox/session-key')).toEqual([{ mode: 'speaker', textOnly: false, bothSplit: false, region: 'us', participantSpeech: false }]);
    expect([h.stt().length, h.tts().length]).toEqual([1, 1]);
    expect(h.keyOf(h.stt()[0])).toBe('k-spk_stt');
    expect(h.keyOf(h.tts()[0])).toBe('k-spk_tts');
    expect(frameOf(h.stt()[0])).not.toHaveProperty('translation');
    // The voice's connection opened, and reported nothing: a session's lease hears its start from the transcription socket.
    expect(h.sent('/soniox/session-started')).toEqual([]);

    h.stt()[0].receive(msg(heard('Hello.'), END));
    await h.settle();
    // The fake translator's words are what Kizuna AI's voice is asked to read.
    expect(h.tts()[0].sentJson<Json>().some((m) => m.text === '[ja] Hello.')).toBe(true);
    const streamId = h.tts()[0].sentJson<Json>().filter((m) => m.model !== undefined).map((m) => m.stream_id as string).pop();
    h.tts()[0].receive(JSON.stringify({ stream_id: streamId, audio: b64(2400) }));
    h.tts()[0].receive(JSON.stringify({ stream_id: streamId, terminated: true }));
    expect(h.played).toEqual([{ leg: 'speaker', ref: 2 }]);
    expect(h.sent('/soniox/session-started')).toEqual([expect.objectContaining({ leaseId: 'lease-1', role: 'spk_stt' })]);
    expect(h.runner.conversation.info).toMatchObject({ models: { asrModel: 'stt-rt-v6', translationModel: 'fake-translator', ttsModel: 'tts-rt-v2' } });

    await h.runner.stop();
    expect(h.sent('/soniox/session-started')).toHaveLength(1);
    expect(h.sent('/soniox/session-end')).toEqual([{ leaseId: 'lease-1' }]);
    expect(h.sockets.all.every((s) => s.closedByClient !== null)).toBe(true);
  });

  it('both legs with its own voices: split Both, a transcription and a speech key a leg, and still one start reported for each transcription socket', async () => {
    const h = hostedRun({ voice: 'hosted', legs: ['speaker', 'participant'], participantSpeech: true });
    await h.start();
    expect(h.runner.state.getState().phase).toBe('running');
    expect(h.sent('/soniox/session-key')).toEqual([{ mode: 'both', textOnly: false, bothSplit: true, region: 'us', participantSpeech: true }]);
    expect(h.stt().map(h.keyOf)).toEqual(['k-spk_stt', 'k-par_stt']);
    expect(h.tts().map(h.keyOf).sort()).toEqual(['k-par_tts', 'k-spk_tts']);
    h.stt()[0].receive(msg(heard('Hello.'), END));
    h.stt()[1].receive(msg(heard('大丈夫。', true, 'ja'), END));
    await h.settle();
    const voice = (key: string) => h.tts().find((s) => h.keyOf(s) === key)!;
    expect(voice('k-spk_tts').sentJson<Json>().some((m) => m.text === '[ja] Hello.')).toBe(true);
    expect(voice('k-par_tts').sentJson<Json>().some((m) => m.text === '[en] 大丈夫。')).toBe(true);
    expect(h.sent('/soniox/session-started').map((b) => b.role).sort()).toEqual(['par_stt', 'spk_stt']);
    await h.runner.stop();
    expect(h.sent('/soniox/session-end')).toEqual([{ leaseId: 'lease-1' }]);
  });
});
