/**
 * Soniox for all three stages as a session runs it: the composite over its
 * text unit (the adapter, which transcribes and translates) and its voice,
 * on fake sockets and a virtual clock. A test plays STT frames, TTS answers,
 * clock advances and calls at it, then reads what was said to each leg
 * (`said`, `logged`), what was sent on each socket (`pictureOf`, `spoken`)
 * and what an agent text feed made of it (`audioByRow`).
 *
 * `said` leaves out what belongs to the text side alone and is pinned in the
 * adapter's own tests: a source's timing and its heard words. A source's
 * line may so repeat, where only those changed.
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
import { buildPlan, startComposite } from '../../lib/plan/composite';
import { startCompositeBoth } from '../../lib/plan/compositeBoth';
import type { PlanConfigs, PlannedUnit, RunPlan } from '../../lib/plan/types';
import { wholePlan } from '../../lib/plan/wholeUnit';
import type { AnyProvider } from '../../lib/provider/types';
import type { SharedSettings } from '../../lib/run/types';
import { AgentTextFeed } from '../../lib/session/agentText';
import { createSonioxAdapter } from './adapter';
import { sonioxProvider } from './provider';
import { SONIOX_DEFAULTS, type SonioxCredentials, type SonioxSettings } from './settings';
import { b64, isStt, SHARED, trackedClock, type Json } from './testing';
import type { OpenSocket } from './socket';
import { createSonioxTtsUnit, type SonioxTtsUnit } from './ttsUnit';
import { sonioxSttUnitFor } from './units';

export type Mode = 'leg' | 'split' | 'shared' | 'faceToFace';
const LEGS: readonly LegName[] = ['speaker', 'participant'];

/** Each leg's own keys: the TTS key rides in the handshake, so a leg's socket is seen to carry the leg's own. */
export const SPK: SonioxCredentials = { region: 'us', stt: 'k-spk', tts: 'k-spk-tts' };
export const PAR: SonioxCredentials = { region: 'us', stt: 'k-par', tts: 'k-par-tts' };

export interface CompositeOptions {
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
  /** Runs an agent text feed over the events, as the run does, every clip on one of the user's outlets. */
  agentText?: boolean;
  /** A lease behind the speaker's keys, as Kizuna AI's Soniox has, listing what it is told. Its grant ends at this time on the clock. */
  leaseEndsAt?: number;
}

/** One `agentText` call a feed made, and whether the session took it. */
export type AgentCall = [leg: LegName, text: string, endOfSegment: boolean, sent: boolean];

export interface Run {
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

/**
 * A Soniox definition with its adapter and its two units on these sockets, and its own plan: the text unit beside
 * the voice. `of`: the definition, Soniox with an own key by default. `participantSpeech`: the definition's flag.
 * `voiceSocket`: what a leg's voice opens its sockets through, so a test knows whose each is; `sockets.create` for
 * every leg by default.
 */
export function sonioxOnSockets(
  sockets: ReturnType<typeof fakeSockets>,
  o: { of?: AnyProvider; participantSpeech?: boolean; voiceSocket?: (leg: LegName) => OpenSocket } = {},
): { provider: AnyProvider; plan: RunPlan } {
  const adapter = createSonioxAdapter({ openSocket: sockets.create });
  const of = o.of ?? (sonioxProvider as AnyProvider);
  const flag = o.participantSpeech === undefined ? {} : { participantSpeech: o.participantSpeech };
  const voiceOn = (openSocket: OpenSocket): SonioxTtsUnit => createSonioxTtsUnit({ openSocket, ...flag });
  let voice = voiceOn(sockets.create);
  if (o.voiceSocket) {
    // One unit per leg, each on that leg's sockets, behind the one unit the plan holds.
    const byLeg: Record<LegName, SonioxTtsUnit> = { speaker: voiceOn(o.voiceSocket('speaker')), participant: voiceOn(o.voiceSocket('participant')) };
    voice = { ...voice, startSpeech: (request, events) => byLeg[request.leg].startSpeech!(request, events) };
  }
  const provider = {
    ...of,
    units: [sonioxSttUnitFor({ start: adapter.start, ...flag }), voice],
    session: { ...of.session, startBoth: adapter.startBoth },
  } as AnyProvider;
  return { provider, plan: wholePlan(provider) };
}

/** One leg's request over Soniox's plan, as the run makes it: each unit's config built for the leg, one set of keys for both units. */
export function planRequest(
  plan: RunPlan,
  o: { context: SessionContext; settings: SonioxSettings; shared: SharedSettings; credentials: SonioxCredentials; clock: StartRequest<unknown, unknown>['clock']; signal: AbortSignal },
): StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown> {
  return { context: o.context, config: planConfigs(plan, o.context, o.settings, o.shared), credentials: () => o.credentials, clock: o.clock, signal: o.signal };
}

/** Each unit's config for one leg, built as the run builds it. */
export function planConfigs(plan: RunPlan, context: SessionContext, settings: SonioxSettings, shared: SharedSettings): PlanConfigs {
  const accounts = { [plan.units[0].provider.id]: { settings, credentials: {} } };
  const configs = buildPlan(plan, context, { accounts }, shared);
  if ('refused' in configs) throw new Error(`The plan was refused: ${String(configs.refused)}`);
  return configs;
}

/** The composite, starting: nothing is opened yet. */
export function starting(o: CompositeOptions): Run {
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

  /** Each TTS socket's leg: the one whose voice opened it. Legs may hold one key, so the key does not say. */
  const voiceLeg = new Map<FakeSocket, LegName>();
  const voiceSocket = (leg: LegName): OpenSocket => (url, protocols) => {
    const socket = sockets.create(url, protocols);
    voiceLeg.set(socket as unknown as FakeSocket, leg);
    return socket;
  };
  const { plan } = sonioxOnSockets(sockets, { voiceSocket });
  const request = (leg: LegName) => planRequest(plan, { context: contexts[leg], settings, shared: shared(leg), credentials: credentials[leg], clock, signal });
  const start: Promise<Partial<Record<LegName, AdapterSession>>> = o.mode === 'leg'
    ? startComposite(plan, request(legs[0]), events[legs[0]], legs[0]).then((session) => ({ [legs[0]]: session }))
    : startCompositeBoth(plan, { speaker: request('speaker'), participant: request('participant') }, events);

  const sttSockets = () => sockets.all.filter(isStt);
  /** The sockets `leg`'s voice opened, each on the leg's own speech key. */
  const ttsSockets = (leg: LegName) => {
    const own = sockets.all.filter((s) => voiceLeg.get(s) === leg);
    for (const s of own) {
      const key = Array.isArray(s.protocols) ? s.protocols[1] : undefined;
      if (key !== credentials[leg].tts) throw new Error(`A TTS socket of the ${leg} leg carries the key ${String(key)}, not the leg's own.`);
    }
    return own;
  };
  const run: Run = {
    legs, sockets, clock, timers, controller, log, sessions, opened, agentCalls, leaseCalls, mic,
    started: start.then((got) => { Object.assign(sessions, got); }, (error: unknown) => { run.failure = error; }),
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
  return run;
}

/** The composite, live: every socket it asks for is opened, the voices' included, which it opens once both legs have started. */
export async function live(o: CompositeOptions): Promise<Run> {
  const run = starting(o);
  run.openAll();
  await run.started;
  if (run.failure !== undefined) throw run.failure;
  run.openAll();
  await flush();
  return run;
}

/** The TTS stream opened last on this socket. */
export const lastStream = (socket: FakeSocket) => socket.sentJson<{ stream_id?: string; model?: string }>().filter((m) => m.model !== undefined).map((m) => m.stream_id!).pop();

/** Audio for the stream `leg`'s voice opened last, one chunk per sample count; `end`: then the stream's end. */
export function answer(run: Run, leg: LegName, samples: readonly number[], end = true): void {
  const socket = run.tts(leg);
  const stream = lastStream(socket);
  if (stream === undefined) throw new Error(`The ${leg} voice opened no stream to answer.`);
  for (const n of samples) socket.receive(JSON.stringify({ stream_id: stream, audio: b64(n) }));
  if (end) socket.receive(JSON.stringify({ stream_id: stream, terminated: true }));
}

/** What was sent on a socket, in order: JSON as parsed, the STT stream's empty end frame as it is, audio by its size. */
export function sentOn(socket: FakeSocket): unknown[] {
  return socket.sent.map((data) => {
    if (typeof data !== 'string') return { binary: (data as ArrayBufferView | ArrayBufferLike).byteLength };
    return data === '' ? '' : JSON.parse(data) as Json;
  });
}

const person = (e: { person?: string }) => (e.person === undefined ? '' : ` person=${e.person}`);

/** One event as a line; null for the Logs' frames (`logged`), loading and busy. */
function line(e: AdapterEvent): string | null {
  switch (e.kind) {
    case 'segmentOpened':
      return `open ${e.payload.ref} ${e.payload.side} ${e.payload.origin ?? '-'}${person(e.payload)}`;
    case 'segmentText': {
      const { ref, text, language, stableLen } = e.payload;
      return `text ${ref} <${text}>${stableLen === undefined ? '' : ` stable=${stableLen}`}${language ? ` ${language}` : ''}${person(e.payload)}`;
    }
    case 'segmentClosed':
      return `close ${e.payload.ref} ${e.payload.origin ?? '-'}`;
    case 'audio': {
      const { ref, range, voice, pcm } = e.payload;
      return `audio ${ref ?? '-'} ${range ? `[${range[0]},${range[1]}]` : '[]'} ${pcm.length}${voice ? ` voice=${voice}` : ''}`;
    }
    case 'speechRanges':
      return `ranges ${e.payload.ref} ${e.payload.ranges.map((r) => `${r.index}:[${r.range[0]},${r.range[1]}]`).join(' ')}`;
    case 'degraded':
      return `degraded ${e.payload.code}${e.payload.reason ? ` ${e.payload.reason}` : ''}`;
    case 'failed':
      return `failed ${e.payload.code} <${e.payload.message}>`;
    case 'closed':
      return `ended <${e.payload.reason ?? ''}>`;
    case 'reconnecting':
      return `reconnecting ${e.payload?.attempt ?? '-'}`;
    case 'reconnected':
      return 'reconnected';
    default:
      return null;
  }
}

/**
 * What a leg was told, in order, one line an event, a text between angle brackets:
 *   open 2 translation u1 person=1.2      close 2 u1
 *   text 2 <こんにちは。> stable=6 ja        (a source's text states no stable length)
 *   audio 2 [0,4] 2400 voice=participant  (its row, its range or `[]`, its samples, the leg that read it when not this one)
 *   ranges 2 0:[0,4] 1:[4,6]              (its row, then each entry's filled-in range)
 *   degraded tts_segment_lost tts_408     (its code, then its reason)
 *   failed auth <the words>               ended <the reason>   (the leg closed)
 *   reconnecting 1                        reconnected
 * The Logs' frames are `logged`.
 */
export function said(run: Run, leg: LegName): string[] {
  return run.log[leg].map(line).filter((l): l is string => l !== null);
}

/** The frames a leg was handed for the Logs, in order: `out <type>` or `in <type>`. */
export function logged(run: Run, leg: LegName): string[] {
  return run.log[leg].flatMap((e) => (e.kind === 'frame' ? [`${e.payload.direction} ${e.payload.type}`] : []));
}

/** The payloads of the frames of one type a leg was handed. */
export function framesOf(run: Run, leg: LegName, type: string): unknown[] {
  return run.log[leg].flatMap((e) => (e.kind === 'frame' && e.payload.type === type ? [e.payload.payload] : []));
}

/** The text sent to synthesis on a leg's TTS sockets, in order. */
export function spoken(run: Run, leg: LegName): string[] {
  return run.ttsSockets(leg).flatMap((s) => sentOn(s) as Json[]).filter((m) => typeof m.text === 'string' && m.text !== '').map((m) => m.text as string);
}

export interface Picture {
  /** Whether the start resolved, or what it rejected with. */
  start: string;
  /** Per STT socket, in the order they were opened. */
  stt: Array<{ key: string; sent: unknown[]; closedByClient: boolean }>;
  /** Per leg, its TTS sockets in the order it opened them. */
  tts: Record<LegName, Array<{ accepted: boolean; sent: unknown[]; closedByClient: boolean }>>;
  agentText: AgentCall[];
  lease: string[];
  timers: number;
}

/** How the start ended, what was sent on each socket, the agent text calls, the lease's calls and the timers left. */
export function pictureOf(run: Run): Picture {
  const tts = (leg: LegName) => run.ttsSockets(leg).map((s) => ({ accepted: run.opened.has(s), sent: sentOn(s), closedByClient: s.closedByClient !== null }));
  return {
    start: run.failure === undefined ? 'started' : String(run.failure),
    stt: run.sttSockets().map((s) => ({ key: Array.isArray(s.protocols) ? s.protocols[1] : '', sent: sentOn(s), closedByClient: s.closedByClient !== null })),
    tts: { speaker: tts('speaker'), participant: tts('participant') },
    agentText: run.agentCalls,
    lease: run.leaseCalls,
    timers: run.timers(),
  };
}

/** The rows' audio as an agent text feed numbers it: per leg and row, each entry's index, range and voice, and the row's filled-in ranges. */
export function audioByRow(run: Run): Record<string, { audio: Array<{ index: number; range?: readonly [number, number]; voice: LegName; samples: number }>; ranges: Array<{ index: number; range: readonly [number, number] }> }> {
  const rows: ReturnType<typeof audioByRow> = {};
  for (const leg of run.legs) {
    for (const e of run.log[leg]) {
      if (e.kind !== 'audio' && e.kind !== 'speechRanges') continue;
      const row = rows[`${leg}:${e.payload.ref}`] ??= { audio: [], ranges: [] };
      if (e.kind === 'audio') row.audio.push({ index: row.audio.length, ...(e.payload.range ? { range: e.payload.range } : {}), voice: e.payload.voice ?? leg, samples: e.payload.pcm.length });
      else row.ranges.push(...e.payload.ranges);
    }
  }
  return rows;
}
