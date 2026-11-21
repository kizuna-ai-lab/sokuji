// src/lib/plan/testing.ts
//
// Fixtures for tests: stub providers, plans built straight from a provider
// definition, a run's shape over one, and stub text and speech units that
// list what they are asked. Imported by tests only.
import type { AdapterEvents, AdapterSession, Ref, StartRequest, TextRange } from '../contract/adapter';
import type { SpeechEvents, SpeechSession, SpeechStartRequest } from '../contract/speech';
import type { LegName } from '../conversation/types';
import { allStagesBy, CAPS } from '../lineup/catalog';
import type { StageIds } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import type { RunShape } from '../session/types';
import type { ComposeInput } from './compose';
import type { PlannedUnit, RunPlan } from './types';
import { wholePlan } from './wholeUnit';

/** A provider definition with only what its whole-provider unit reads, so the real registry stays out of the tests. */
export const stubProvider = (id: string, over: Record<string, unknown> = {}): AnyProvider => ({
  id,
  speech: 'optional',
  turns: () => ['auto'],
  boundaries: () => 'silence',
  textInput: () => false,
  build: () => ({}),
  describe: () => ({}),
  start: () => undefined,
  ...over,
}) as unknown as AnyProvider;

/** A composer input that offers a stub provider for every host in the catalog, so every option is offered; `over` goes to each stub. */
export function stubHosts(over: Record<string, unknown> = {}): ComposeInput {
  return { providers: [...new Set(CAPS.map((c) => c.host))].map((id) => stubProvider(id, over)), settings: () => undefined };
}

/** The plan of a line-up that names `p` on every stage, built without the catalog (a test's stub provider is not in it). */
export { wholePlan as planOf } from './wholeUnit';

/**
 * A run's shape on `p` alone: its plan, its account from `settings` (absent: undefined) and `credentials` (absent:
 * none saved), and its stages' ids from `lineUp` (absent: `p` on every stage), beside the rest of the shape as given.
 */
export function shapeWith(
  p: AnyProvider,
  rest: Omit<RunShape, 'plan' | 'accounts' | 'lineUp'> & { lineUp?: StageIds; settings?: unknown; credentials?: Record<string, string> },
): RunShape {
  const { settings, credentials = {}, lineUp = allStagesBy(p.id), ...shape } = rest;
  return { ...shape, plan: wholePlan(p), accounts: { [p.id]: { settings, credentials } }, lineUp };
}

/** What stub units were asked, in order, across the stubs that share the list: `[what, ...arguments]`. */
export type StubCalls = unknown[][];

/** A stub text session: every call is listed as `text.<call>`, with the leg when one is named. */
export function stubTextSession(calls: StubCalls, o: { leg?: LegName; session?: Partial<AdapterSession> } = {}): AdapterSession {
  const note = (what: string, ...rest: unknown[]) => { calls.push([`text.${what}`, ...(o.leg ? [o.leg] : []), ...rest]); };
  return {
    info: { transport: 'stub' },
    appendAudio: (pcm) => note('appendAudio', pcm),
    appendText: (text) => note('appendText', text),
    beginTurn: () => note('beginTurn'),
    endTurn: () => note('endTurn'),
    cancelTurn: () => note('cancelTurn'),
    stop: async () => note('stop'),
    ...o.session,
  };
}

/** One start of a stub text unit: what it was asked with, the events it emits through, and its session. */
export interface StubTextStart {
  request: StartRequest<unknown, unknown>;
  events: AdapterEvents;
  session: AdapterSession;
  /** A held start resolves. */
  open(): void;
  /** A held start rejects. */
  refuse(error: unknown): void;
}

/**
 * A text unit (transcription and translation) of a stub provider. A test emits its events through `starts[n].events`.
 * `held`: a start stays pending until the test opens or refuses it, and rejects when its signal aborts.
 * `fails`: every start rejects with it. `session`: members that replace the stub session's.
 */
export function stubTextUnit(calls: StubCalls = [], o: { held?: boolean; fails?: unknown; session?: Partial<AdapterSession>; provider?: Record<string, unknown> } = {}) {
  const starts: StubTextStart[] = [];
  const start = (request: StartRequest<unknown, unknown>, events: AdapterEvents): Promise<AdapterSession> => {
    calls.push(['text.start']);
    const session = stubTextSession(calls, { session: o.session });
    return new Promise<AdapterSession>((resolve, reject) => {
      const abort = () => reject(request.signal.reason ?? new Error('aborted'));
      starts.push({ request, events, session, open: () => resolve(session), refuse: reject });
      if (o.fails !== undefined) reject(o.fails);
      else if (request.signal.aborted) abort();
      else if (o.held) request.signal.addEventListener('abort', abort, { once: true });
      else resolve(session);
    });
  };
  const [whole] = wholePlan(stubProvider('stub_text', { start, ...o.provider })).units;
  const planned: PlannedUnit = { ...whole, stages: ['transcription', 'translation'] };
  return { planned, starts };
}

/** One session of a stub speech unit. */
export interface StubVoice {
  request: SpeechStartRequest<unknown, unknown>;
  events: SpeechEvents;
  /** Emits one audio entry for `ref`, counted as a voice must count it. */
  audio(ref: Ref, range?: TextRange, home?: LegName): void;
}

/**
 * A speech unit of a stub provider: every call is listed as `voice.<call>` with its leg.
 * `answers`: each `speak` while speech is on is answered at once with one audio entry over its span.
 * `fails`: `startSpeech` throws it. `recycles`: false leaves `recycle` out. `provider`: members of its stub provider.
 */
export function stubSpeechUnit(calls: StubCalls = [], o: { answers?: boolean; fails?: unknown; recycles?: boolean; provider?: Record<string, unknown> } = {}) {
  const voices: StubVoice[] = [];
  const startSpeech = (request: SpeechStartRequest<unknown, unknown>, events: SpeechEvents): SpeechSession => {
    const note = (what: string, ...rest: unknown[]) => { calls.push([`voice.${what}`, request.leg, ...rest]); };
    note('start');
    if (o.fails !== undefined) throw o.fails;
    let on = true;
    let closed = false;
    const audio: StubVoice['audio'] = (ref, range, home) => {
      request.counts.set(ref, (request.counts.get(ref) ?? 0) + 1);
      events.audio({ pcm: new Int16Array(240), ref, ...(range ? { range } : {}), ...(home ? { home } : {}) });
    };
    voices.push({ request, events, audio });
    return {
      open: async () => note('open'),
      speak: (ref, text, span, language, home) => {
        note('speak', ref, text, span, language, home);
        if (o.answers && on && !closed) audio(ref, span, home);
      },
      endUtterance: (ref) => note('endUtterance', ref),
      setOn: (next) => { on = next; note('setOn', next); },
      ...(o.recycles === false ? {} : { recycle: () => note('recycle') }),
      close: () => { closed = true; note('close'); },
    };
  };
  const [whole] = wholePlan(stubProvider('stub_voice', o.provider)).units;
  const planned: PlannedUnit = { ...whole, unit: { ...whole.unit, start: undefined, startSpeech }, stages: ['speech'] };
  return { planned, voices };
}

/** The plan of a text unit that transcribes and translates and a speech unit that speaks. */
export function textAndSpeechPlan(text: PlannedUnit, speech: PlannedUnit): RunPlan {
  return { units: [text, speech], byStage: { transcription: text, translation: text, speech } };
}

/**
 * A `startBoth` for a stub text provider: one stub session per leg, each listing its calls with its leg, and the
 * events each leg was given. `shared`: the sessions say they share one connection (`info.shared`).
 */
export function stubStartBoth(calls: StubCalls = [], o: { shared?: boolean; fails?: unknown } = {}) {
  const started: Array<{ requests: Record<LegName, StartRequest<unknown, unknown>>; events: Record<LegName, AdapterEvents>; sessions: Record<LegName, AdapterSession> }> = [];
  const startBoth = async (requests: Record<LegName, StartRequest<unknown, unknown>>, events: Record<LegName, AdapterEvents>): Promise<Record<LegName, AdapterSession>> => {
    calls.push(['text.startBoth']);
    if (o.fails !== undefined) throw o.fails;
    const info = { transport: 'stub', ...(o.shared ? { shared: true } : {}) };
    const sessions = { speaker: stubTextSession(calls, { leg: 'speaker', session: { info } }), participant: stubTextSession(calls, { leg: 'participant', session: { info } }) };
    started.push({ requests, events, sessions });
    return sessions;
  };
  return { startBoth, started };
}
