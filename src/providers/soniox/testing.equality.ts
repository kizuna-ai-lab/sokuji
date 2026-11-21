/**
 * Two ways to run Soniox for all three stages, side by side: the adapter with
 * its voice inside (`old`), and the composite over Soniox's text unit and its
 * voice (`new`). Each side has its own fake sockets, virtual clock and event
 * logs; a test plays one script at both and compares what each side said to
 * its legs and what it sent on each socket (`pictureOf`).
 *
 * What is compared, per leg and in order: the segments (opened, text, closed)
 * exactly as said — both sides run the same utterances, so a translation's
 * text carries the same stable length and the same snapshots on both, and
 * nothing is normalised away; each `audio` by its row, range, voice and
 * sample count; `speechRanges`; `degraded` by its code, reason and words;
 * `failed` without its cause; `closed`, `reconnecting`, `reconnected`; and
 * the frames for the Logs, in their place among the rest, but two: the
 * `session.opened` line, and a frame after the leg failed or closed
 * (`equality.test.ts` pins both).
 *
 * What is compared per socket: everything sent, in order. The STT sockets
 * are compared in the order they were opened; the TTS sockets per leg, in
 * the order that leg opened them. How the sockets interleave is not
 * compared: with both legs, the composite opens the voices right after the
 * text sessions have started, the adapter while they start.
 *
 * Test-only.
 */
import type { OutletName } from '../../lib/audio/outlets';
import type { AdapterEvents, AdapterSession, SessionContext, StartRequest } from '../../lib/contract/adapter';
import { eventsFrom, type AdapterEvent } from '../../lib/contract/events';
import type { VirtualClock } from '../../lib/contract/clock';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { flush } from '../../lib/contract/testing/drive';
import type { LegName } from '../../lib/conversation/types';
import { buildPlan, startComposite, type PlanConfigs } from '../../lib/plan/composite';
import { startCompositeBoth } from '../../lib/plan/compositeBoth';
import type { PlannedUnit } from '../../lib/plan/types';
import { wholePlan } from '../../lib/plan/wholeUnit';
import type { AnyProvider, SharedSettings } from '../../lib/provider/types';
import { AgentTextFeed } from '../../lib/session/agentText';
import { createSonioxAdapter } from './adapter';
import { buildSoniox, type SonioxConfig } from './config';
import { sonioxProvider } from './provider';
import { SONIOX_DEFAULTS, type SonioxCredentials, type SonioxSettings } from './settings';
import { b64, isStt, SHARED, trackedClock, type Json } from './testing';
import { createSonioxTtsUnit } from './ttsUnit';
import { sonioxSttUnitFor } from './units';

export type Path = 'old' | 'new';
export type Mode = 'leg' | 'split' | 'shared' | 'faceToFace';
const LEGS: readonly LegName[] = ['speaker', 'participant'];

/** Each leg's own keys, so a socket says whose it is: the TTS key rides in the handshake. */
export const SPK: SonioxCredentials = { region: 'us', stt: 'k-spk', tts: 'k-spk-tts' };
export const PAR: SonioxCredentials = { region: 'us', stt: 'k-par', tts: 'k-par-tts' };

export interface EqualityOptions {
  mode: Mode;
  /** `leg` only: which one. The speaker by default. */
  leg?: LegName;
  /** The speaker's pair; the participant runs its reverse. English to Japanese by default. */
  pair?: { source: string; target: string };
  settings?: Partial<SonioxSettings>;
  /** Which legs speak; both by default. */
  speaks?: Partial<Record<LegName, boolean>>;
  credentials?: Partial<Record<LegName, SonioxCredentials>>;
  turns?: 'auto' | 'manual';
  /** Runs an agent text feed over each side's events, as the run does, every clip on one of the user's outlets. */
  agentText?: boolean;
  /** A lease behind the speaker's keys, as Kizuna AI's Soniox has: each side's own, listing what it is told. Its grant ends at this time on the clock. */
  leaseEndsAt?: number;
}

/** One `agentText` call a feed made, and whether the session took it. */
export type AgentCall = [leg: LegName, text: string, endOfSegment: boolean, sent: boolean];

export interface Side {
  path: Path;
  legs: readonly LegName[];
  sockets: ReturnType<typeof fakeSockets>;
  clock: VirtualClock;
  /** The clock's live timers. */
  timers(): number;
  controller: AbortController;
  log: Record<LegName, AdapterEvent[]>;
  /** The start, never rejecting here: a failed start is `failure`. */
  started: Promise<void>;
  /** Set once the start resolved. */
  sessions: Partial<Record<LegName, AdapterSession>>;
  /** What the start rejected with. */
  failure?: unknown;
  /** The sockets the server accepted, by `openAll`. */
  opened: Set<FakeSocket>;
  agentCalls: AgentCall[];
  /** What the lease was told and asked, in order. */
  leaseCalls: string[];
  /** Whether the microphone reaches its socket, for the agent text feed. */
  mic: { open: boolean };
  sttSockets(): FakeSocket[];
  /** The STT socket opened last. */
  stt(): FakeSocket;
  ttsSockets(leg: LegName): FakeSocket[];
  /** The TTS socket `leg` opened last. */
  tts(leg?: LegName): FakeSocket;
  /** The server accepts every socket still connecting. */
  openAll(): void;
}

/** A leg's context and the settings every builder reads for it, as the run makes them. */
function legInputs(o: EqualityOptions) {
  const pair = o.pair ?? { source: 'en', target: 'ja' };
  const legs: readonly LegName[] = o.mode === 'leg' ? [o.leg ?? 'speaker'] : LEGS;
  const contexts: Record<LegName, SessionContext> = {
    speaker: { direction: pair, speech: o.speaks?.speaker ?? true, turns: o.turns ?? 'auto' },
    participant: { direction: { source: pair.target, target: pair.source }, speech: o.speaks?.participant ?? true, turns: 'auto' },
  };
  const speaks = legs.some((leg) => contexts[leg].speech);
  const shared = (leg: LegName): SharedSettings => ({ ...SHARED, speaks, reversed: () => leg === 'participant', ...(o.mode === 'faceToFace' ? { faceToFace: true } : {}) });
  const settings: SonioxSettings = { ...SONIOX_DEFAULTS, bothModeSharedSession: o.mode === 'shared', ...o.settings };
  const credentials: Record<LegName, SonioxCredentials> = { speaker: o.credentials?.speaker ?? SPK, participant: o.credentials?.participant ?? PAR };
  return { legs, contexts, shared, settings, credentials };
}

function startSide(path: Path, o: EqualityOptions): Side {
  const { legs, contexts, shared, settings, credentials } = legInputs(o);
  const leaseCalls: string[] = [];
  if (o.leaseEndsAt !== undefined) {
    const endsAt = o.leaseEndsAt;
    let reissued = 0;
    credentials.speaker = {
      ...credentials.speaker,
      clientReferenceId: 'ref-0',
      lease: {
        streamAccepted: () => { leaseCalls.push('streamAccepted'); },
        streamEnded: () => { leaseCalls.push('streamEnded'); },
        atGrantEnd: (now) => now >= endsAt,
        cutoff: () => { leaseCalls.push('cutoff'); },
        reissue: async () => {
          reissued += 1;
          leaseCalls.push('reissue');
          return { ok: true, stt: `k-spk-${reissued}`, clientReferenceId: `ref-${reissued}`, expiresAt: 0 };
        },
      },
    };
  }
  const sockets = fakeSockets();
  const { clock, timers } = trackedClock();
  const controller = new AbortController();
  const signal = controller.signal;
  const log: Record<LegName, AdapterEvent[]> = { speaker: [], participant: [] };
  const sessions: Partial<Record<LegName, AdapterSession>> = {};
  const agentCalls: AgentCall[] = [];
  const mic = { open: true };
  const opened = new Set<FakeSocket>();

  const feed = o.agentText
    ? new AgentTextFeed({
      legs,
      micOpen: () => mic.open,
      session: (leg) => ({
        agentText: (text, endOfSegment) => {
          const sent = sessions[leg]?.agentText?.(text, endOfSegment) === true;
          agentCalls.push([leg, text, endOfSegment, sent]);
          return sent;
        },
      }),
    })
    : null;
  const OUTLETS: readonly OutletName[] = ['other'];
  /** A leg's events: logged, and fed to the agent text feed as the run feeds it. */
  const eventsOf = (leg: LegName): AdapterEvents => eventsFrom((e) => {
    log[leg].push(e);
    if (!feed) return;
    if (e.kind === 'segmentText') feed.rowText(leg, e.payload.ref, e.payload.text);
    else if (e.kind === 'audio') feed.audio(leg, e.payload, OUTLETS);
    else if (e.kind === 'speechRanges') feed.ranges(leg, e.payload);
    else if (e.kind === 'reconnecting') feed.reconnecting(leg);
  });
  const events: Record<LegName, AdapterEvents> = { speaker: eventsOf('speaker'), participant: eventsOf('participant') };

  const adapter = createSonioxAdapter({ openSocket: sockets.create });
  let starting: Promise<Partial<Record<LegName, AdapterSession>>>;
  if (path === 'old') {
    // The provider as one unit: its config carries the voice, and the adapter speaks.
    const request = (leg: LegName): StartRequest<SonioxConfig, SonioxCredentials> =>
      ({ context: contexts[leg], config: buildSoniox(contexts[leg], settings, shared(leg)), credentials: credentials[leg], clock, signal });
    starting = o.mode === 'leg'
      ? adapter.start(request(legs[0]), events[legs[0]]).then((session) => ({ [legs[0]]: session }))
      : adapter.startBoth({ speaker: request('speaker'), participant: request('participant') }, events);
  } else {
    // The definition's own plan, its units on this side's sockets.
    const provider = {
      ...sonioxProvider,
      start: adapter.start,
      units: [sonioxSttUnitFor({ start: adapter.start }), createSonioxTtsUnit({ openSocket: sockets.create })],
      session: { startBoth: adapter.startBoth },
    } as AnyProvider;
    const plan = wholePlan(provider);
    const accounts = { [provider.id]: { settings, credentials: {} } };
    const request = (leg: LegName): StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown> => {
      const configs = buildPlan(plan, contexts[leg], { accounts }, shared(leg));
      if ('refused' in configs) throw new Error(`The plan was refused: ${String(configs.refused)}`);
      return { context: contexts[leg], config: configs, credentials: () => credentials[leg], clock, signal };
    };
    starting = o.mode === 'leg'
      ? startComposite(plan, request(legs[0]), events[legs[0]], legs[0]).then((session) => ({ [legs[0]]: session }))
      : startCompositeBoth(plan, { speaker: request('speaker'), participant: request('participant') }, events);
  }

  const sttSockets = () => sockets.all.filter(isStt);
  const ttsSockets = (leg: LegName) => sockets.all.filter((s) => !isStt(s) && Array.isArray(s.protocols) && s.protocols[1] === credentials[leg].tts);
  const side: Side = {
    path, legs, sockets, clock, timers, controller, log, sessions, opened, agentCalls, leaseCalls, mic,
    started: starting.then((got) => { Object.assign(sessions, got); }, (error: unknown) => { side.failure = error; }),
    sttSockets,
    stt: () => sttSockets().slice(-1)[0],
    ttsSockets,
    tts: (leg = legs[0]) => ttsSockets(leg).slice(-1)[0],
    openAll: () => {
      for (const s of sockets.all) {
        if (s.readyState !== FakeSocket.CONNECTING) continue;
        s.open();
        opened.add(s);
      }
    },
  };
  return side;
}

export interface Pair {
  old: Side;
  new: Side;
  /** Plays one step of the script at each side, the old one first. */
  each(step: (side: Side) => void | Promise<void>): Promise<void>;
}

/** Both sides, starting: nothing is opened yet. */
export function starting(o: EqualityOptions): Pair {
  const sides = { old: startSide('old', o), new: startSide('new', o) };
  return {
    ...sides,
    async each(step) {
      for (const side of [sides.old, sides.new]) {
        await step(side);
        await flush();
      }
    },
  };
}

/** Both sides, live: every socket each side asks for is opened, the voices' included, which the composite opens once both legs have started. */
export async function live(o: EqualityOptions): Promise<Pair> {
  const pair = starting(o);
  await pair.each(async (side) => {
    side.openAll();
    await side.started;
    if (side.failure !== undefined) throw side.failure;
    side.openAll();
  });
  return pair;
}

/** The TTS stream a side opened last on this socket. */
export const lastStream = (socket: FakeSocket) => socket.sentJson<{ stream_id?: string; model?: string }>().filter((m) => m.model !== undefined).map((m) => m.stream_id!).pop();

/** Audio for the stream `leg`'s voice opened last, one chunk per sample count; `end`: then the stream's end. */
export function answer(side: Side, leg: LegName, samples: readonly number[], end = true): void {
  const socket = side.tts(leg);
  const stream = lastStream(socket);
  if (stream === undefined) throw new Error(`${side.path}: the ${leg} voice opened no stream to answer.`);
  for (const n of samples) socket.receive(JSON.stringify({ stream_id: stream, audio: b64(n) }));
  if (end) socket.receive(JSON.stringify({ stream_id: stream, terminated: true }));
}

/** What was sent on a socket, in order: JSON as parsed, the STT stream's empty end frame as it is, audio by its size. */
function sentOn(socket: FakeSocket): unknown[] {
  return socket.sent.map((data) => {
    if (typeof data !== 'string') return { binary: (data as ArrayBufferView | ArrayBufferLike).byteLength };
    return data === '' ? '' : JSON.parse(data) as Json;
  });
}

/** An event as it is compared; null for what is not (the `session.opened` frame, loading, busy). */
function compared(e: AdapterEvent): unknown {
  switch (e.kind) {
    case 'segmentOpened':
    case 'segmentText':
    case 'segmentClosed':
    case 'speechRanges':
    case 'closed':
    case 'reconnecting':
    case 'reconnected':
      return e;
    case 'audio': {
      const { pcm, ...rest } = e.payload;
      return { kind: e.kind, payload: { ...rest, samples: pcm.length } };
    }
    case 'degraded':
      return { kind: e.kind, payload: { code: e.payload.code, reason: e.payload.reason, message: e.payload.message } };
    case 'failed': {
      const { cause: _cause, ...rest } = e.payload;
      return { kind: e.kind, payload: rest };
    }
    case 'frame':
      return e.payload.type === 'session.opened' ? null : e;
    default:
      return null;
  }
}

export interface Picture {
  /** Whether the start resolved, or what it rejected with. */
  start: string;
  events: Record<LegName, unknown[]>;
  /** Per STT socket, in the order they were opened. */
  stt: Array<{ key: string; sent: unknown[]; closedByClient: boolean }>;
  /** Per leg, its TTS sockets in the order it opened them. */
  tts: Record<LegName, Array<{ accepted: boolean; sent: unknown[]; closedByClient: boolean }>>;
  agentText: AgentCall[];
  lease: string[];
  timers: number;
}

/**
 * What a side said and sent. `unopenedVoices: false` leaves out the TTS sockets the server never accepted, for a
 * start that ends before the composite has opened the voices.
 */
export function pictureOf(side: Side, o: { unopenedVoices?: boolean } = {}): Picture {
  const events = (leg: LegName) => {
    const log = side.log[leg];
    const over = log.findIndex((e) => e.kind === 'failed' || e.kind === 'closed');
    // A leg that failed or closed: what the Logs are told after it is not compared.
    return (over < 0 ? log : log.slice(0, over + 1)).map(compared).filter((e) => e !== null);
  };
  const tts = (leg: LegName) => side.ttsSockets(leg)
    .filter((s) => o.unopenedVoices !== false || side.opened.has(s))
    .map((s) => ({ accepted: side.opened.has(s), sent: sentOn(s), closedByClient: s.closedByClient !== null }));
  return {
    start: side.failure === undefined ? 'started' : String(side.failure),
    events: { speaker: events('speaker'), participant: events('participant') },
    stt: side.sttSockets().map((s) => ({ key: Array.isArray(s.protocols) ? s.protocols[1] : '', sent: sentOn(s), closedByClient: s.closedByClient !== null })),
    tts: { speaker: tts('speaker'), participant: tts('participant') },
    agentText: side.agentCalls,
    lease: side.leaseCalls,
    timers: side.timers(),
  };
}

/** The rows' audio as an agent text feed numbers it: per leg and row, each entry's index, range and voice, and the row's filled-in ranges. */
export function audioByRow(side: Side): Record<string, { audio: unknown[]; ranges: unknown[] }> {
  const rows: Record<string, { audio: unknown[]; ranges: unknown[] }> = {};
  for (const leg of side.legs) {
    for (const e of side.log[leg]) {
      if (e.kind !== 'audio' && e.kind !== 'speechRanges') continue;
      const row = rows[`${leg}:${e.payload.ref}`] ??= { audio: [], ranges: [] };
      if (e.kind === 'audio') row.audio.push({ index: row.audio.length, range: e.payload.range, voice: e.payload.voice ?? leg, samples: e.payload.pcm.length });
      else row.ranges.push(...e.payload.ranges);
    }
  }
  return rows;
}

/** The frames of one type a side logged for a leg, for a difference the Logs alone show. */
export function framesOf(side: Side, leg: LegName, type: string): unknown[] {
  return side.log[leg].flatMap((e) => (e.kind === 'frame' && e.payload.type === type ? [e.payload.payload] : []));
}
