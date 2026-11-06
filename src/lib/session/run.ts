/**
 * One run (spec: "A run"): the shape frozen at start, its resources on a
 * stack, its legs. Everything that opens here is pushed with its release the
 * moment it is acquired, so stop, failure and cancel unwind the same way. The
 * runner owns the phases and ends a run through `close()`.
 */
import type { AnalyticsEvents } from '../analytics';
import type { AdapterEvents, AdapterSession, Punctuator, StartRequest } from '../contract/adapter';
import { LegStartError } from '../contract/adapter';
import { eventsFrom, type AdapterEvent } from '../contract/events';
import type { DropInfo, ReconnectedInfo } from '../contract/reconnect';
import { Conversation, DEFAULT_RETENTION, DEGRADED_DEDUPE_MS, type Retention } from '../conversation/Conversation';
import type { Leg, LegName } from '../conversation/types';
import { describeCause, reportError, reportWarning } from '../diagnostics/report';
import { redact } from '../diagnostics/redact';
import { isMissing, readCredentials } from '../provider/credentials';
import type { SharedSettings } from '../provider/types';
import { AgentTextFeed } from './agentText';
import type { RunNoticeCode } from './codes';
import type { ConversationInfo } from './conversationSet';
import type { RunnerDeps } from './ports';
import { FLAP_WINDOW_MS } from './reconnect';
import { reconnectClient } from './reconnectEvents';
import { contextsFor, gate, type Refusal } from './shape';
import type { Source } from './source';
import { ResourceStack } from './stack';
import { Turn } from './turn';
import type { Budget, LegState, LoadingProgress, Prepared, ReconnectProgress, Resources, RunEnd, RunNotice, RunShape } from './types';

const DEFAULT_TIMEOUT_MS = 5_000;
const API_ERROR_TYPES = ['auth', 'rate_limit', 'network', 'server', 'client'] as const;
type ApiErrorType = AnalyticsEvents['api_error']['error_type'];
type ReconnectChannel = AnalyticsEvents['connection_dropped']['channel'];

/** A leg's drop while it reconnects (spec 2026-11-05 reconnect §4.3, §4.5). */
interface Drop {
  /** The first `reconnecting` of the drop, on the run's clock. */
  since: number;
  /** The attempt the adapter last reported; absent from one that reports none (Gemini, OpenAI). */
  attempt?: number;
  /** Set once the drop reached analytics (its first `reconnecting` carried a `drop`): what the events after it repeat. */
  sent?: { index: number; managed: boolean };
}

/** The `api_error` type a code names, else 'server' (the old default, `apiErrorProps.ts` on `main`). Qwen's passing request rate, `throttled`, is a rate limit. */
export function apiErrorType(code?: string): ApiErrorType {
  if (code === 'throttled') return 'rate_limit';
  return API_ERROR_TYPES.find((t) => t === code) ?? 'server';
}

/** The retention a `keepReplayAudio` value means. */
export function retentionFor(keep: boolean): Retention {
  return keep ? DEFAULT_RETENTION : { keepPcm: false, maxPcmBytes: 0 };
}

/** The start was refused before anything opened. */
export class RefusedError extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.message);
  }
}

/** Opening one leg threw: its source, or its adapter (`stage`: a source's failure is the device's, spec 2026-10-13 §4). */
export class LegOpenError extends Error {
  constructor(readonly leg: LegName, readonly failure: unknown, readonly stage: 'source' | 'adapter') {
    super(describeCause(failure));
  }
}

/** What a run tells the runner. */
export interface RunHost {
  step(step: 'checking' | 'preparing' | 'opening' | 'waiting'): void;
  /** `reconnect`: the leg reconnects under an adapter that reports its attempts (the status line's). */
  legState(leg: LegName, state: LegState, reconnect?: ReconnectProgress): void;
  /** A leg is loading its models while it opens: the starting state shows it. */
  loading(leg: LegName, progress: Omit<LoadingProgress, 'leg'>): void;
  /** The run's legs exist: they become the conversation now, so text shows as it arrives. */
  conversations(legs: ReadonlyMap<LegName, Conversation>, info: ConversationInfo): void;
  /** A leg ended on its own, or a lease did: end the run. */
  end(result: RunEnd): void;
}

export class Run {
  readonly id: string;
  /** When the run was created — Start — on the run's clock: what each leg's `session.stopped` counts from. */
  readonly startedAt: number;
  readonly legStates = new Map<LegName, LegState>();
  /** When every leg went live; null until then. */
  liveSince: number | null = null;
  transport: string | undefined;
  models: { asrModel?: string; translationModel?: string; ttsModel?: string } = {};
  /** The lease's granted time, once acquired; the running state carries it (the countdown). */
  budget: Budget | null = null;
  /** When each leg's degradation code last reached analytics: L1's window, applied to `api_error` too (ruling 8). */
  private readonly degradedTrackedAt = new Map<string, number>();
  private readonly controller = new AbortController();
  private readonly host: RunHost;
  private readonly stack: ResourceStack;
  private readonly conversations = new Map<LegName, Conversation>();
  private readonly sessions = new Map<LegName, AdapterSession>();
  /** Ending: events still fold into L1, but decide nothing. */
  private ending = false;
  /** Ended: events are discarded. */
  private finished = false;
  private turn: Turn | null = null;
  private readonly appendFailing = new Set<LegName>();
  /** The promise of `open()`'s own body; `close()` waits for it (bounded) before it unwinds (F3). */
  private opening: Promise<void> | null = null;
  /** Every leg's open still in flight — a source, an adapter's start: `close()` waits for all of them, not just the first to fail. */
  private readonly legOpens: Promise<unknown>[] = [];
  /** The text of the speech this run queues on the user's outlets, to the session that hears the microphone (spec 2026-11-05 §4.1, §4.2). */
  private readonly agentTextFeed: AgentTextFeed;
  /** Each leg reconnecting, from its drop until it is live again, fails, or the run ends. */
  private readonly drops = new Map<LegName, Drop>();
  /** When each leg's connection last came back: a later drop's `since_last_reconnect_ms`. */
  private readonly reconnectedAt = new Map<LegName, number>();
  /** When each leg last came back under the shared reconnector, both legs of a shared connection each: whether its next reconnect is told again. */
  private readonly restoredAt = new Map<LegName, number>();
  /** The drops sent to analytics so far: the next one's `drop_index`. */
  private dropCount = 0;
  private readonly totals = { count: 0, downMs: 0, failed: false };
  /**
   * Both legs share one connection (`AdapterSession.info.shared`): each of its reconnect events arrives on both,
   * so the analytics, the totals and the network's return act on the speaker's alone, as channel `shared`.
   */
  private sharedConnection = false;

  /** Keeps `task` among the opens `close()` waits for. */
  private opened<T>(task: Promise<T>): Promise<T> {
    this.legOpens.push(task);
    return task;
  }

  /** `host` is a factory because the runner's host closes over the run it serves. */
  constructor(private readonly deps: RunnerDeps, host: (run: Run) => RunHost, readonly shape: RunShape) {
    this.id = deps.newSessionId();
    this.startedAt = deps.clock.now();
    this.host = host(this);
    this.stack = new ResourceStack(deps.clock, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS, (f) =>
      reportWarning('SessionRunner', `Releasing ${f.name} failed: ${f.message}`, { dedupeKey: `release:${f.name}` }));
    // The mute port throwing must not escape an adapter's event: it reads as muted ("send nothing"), reported once.
    let muteFailed = false;
    const muted = (): boolean => {
      try {
        return deps.micMuted?.get() ?? false;
      } catch (error) {
        if (!muteFailed) {
          muteFailed = true;
          reportError('SessionRunner', `Reading the microphone mute for agent text failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'agentTextPorts' });
        }
        return true;
      }
    };
    // Whether a socket takes agent text is the provider's, decided at Start (Soniox's own setting, `buildSoniox`): the run
    // sends whenever the gates below allow, and a socket that did not ask refuses silently (spec 2026-11-05 §4.3).
    this.agentTextFeed = new AgentTextFeed({
      legs: shape.legs,
      // The microphone reaches its socket: not while muted (capture delivers nothing), and then always in automatic
      // turns, in a manual mode only while the key is held (`send`).
      micOpen: () => !muted() && (shape.turnMode === 'auto' || this.turn?.isOpen === true),
      session: (leg) => this.sessions.get(leg),
      report: (error) => reportError('SessionRunner', `A session did not take agent text: ${describeCause(error)}`, { cause: error, dedupeKey: 'agentText' }),
    });
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * Steps 1–8 of "A run". Throws a `RefusedError`, a `LegOpenError`, or the
   * abort; the caller ends the run. The promise is kept on `this.opening` so
   * `close()` can wait for it (F3) — `open()` itself stays sync so the field
   * is set before anything else can observe this run as started.
   */
  open(): Promise<void> {
    const opening = this.runOpen();
    this.opening = opening;
    return opening;
  }

  private async runOpen(): Promise<void> {
    const { shape, deps, host } = this;
    const p = shape.provider;

    const refusal = gate(shape, deps.platform);
    if (refusal) throw new RefusedError(refusal);

    host.step('checking');
    const credentials = readCredentials(p, shape.settings, shape.credentials, shape.auth);
    if (isMissing(credentials)) {
      throw new RefusedError({
        code: credentials.code ?? ('credentials_missing' satisfies RunNoticeCode),
        message: credentials.missing,
        ...(credentials.params ? { params: credentials.params } : {}),
      });
    }
    const readiness = await this.untilAborted(deps.ensureReady(shape, this.signal));
    this.throwIfAborted();
    if (readiness.state !== 'ready') {
      throw new RefusedError(readiness.state === 'not-ready'
        // The provider's own code puts its reason into words; `not_ready` wraps an uncoded one.
        ? { code: readiness.code ?? ('not_ready' satisfies RunNoticeCode), message: readiness.reason, ...(readiness.params ? { params: readiness.params } : {}) }
        : { code: 'not_ready' satisfies RunNoticeCode, message: `readiness is ${readiness.state}` });
    }
    // The run's own answer (F2): a model-choosing builder reads the list its settings component was shown.

    let settings = shape.settings;
    let prepared: Prepared<unknown> = {};
    if (p.session?.prepare) {
      host.step('preparing');
      // A `prepare` that ignores its signal no longer holds a stop. It holds
      // nothing to release, and `persist` applies only once it has returned.
      prepared = await this.untilAborted(p.session.prepare(shape, settings, this.signal));
      this.throwIfAborted();
      if (prepared.override) settings = { ...(settings as object), ...prepared.override };
      if (prepared.persist) deps.persistIfUnchanged(p, shape.settings, prepared.persist);
    }

    const contexts = contextsFor(shape);
    // Whether any leg speaks, told to every builder: Soniox asks for agent text on it when its own setting is on (spec 2026-11-05 §4.3).
    const shared: SharedSettings = { ...shape.shared, models: readiness.models, speaks: shape.legs.some((leg) => contexts[leg]!.speech) };
    const configs: Partial<Record<LegName, unknown>> = {};
    for (const leg of shape.legs) {
      // Which leg this is, told outright: a same-language pair (en → en) gives both legs one direction, which no direction test can tell apart.
      const built = p.build(contexts[leg]!, settings, { ...shared, reversed: () => leg === 'participant' });
      // `C` has no `refused` member (the provider type's constraint), so this tells a refusal from a config.
      if (typeof built?.refused === 'string') {
        throw new RefusedError({
          code: built.code ?? ('build_refused' satisfies RunNoticeCode),
          message: built.refused,
          ...(built.params ? { params: built.params } : {}),
          leg,
        });
      }
      configs[leg] = built;
    }
    if (p.session?.admit) {
      const admitted = p.session.admit(configs);
      if (admitted !== true && 'refused' in admitted) {
        throw new RefusedError({
          code: admitted.code ?? ('admit_refused' satisfies RunNoticeCode),
          message: admitted.refused,
          ...(admitted.params ? { params: admitted.params } : {}),
        });
      }
      // The third answer (#619): a leg it names runs that config instead; the legs stay as built.
      if (admitted !== true && 'configs' in admitted) {
        for (const leg of shape.legs) {
          const adjusted = admitted.configs[leg];
          if (adjusted) configs[leg] = adjusted;
        }
      }
    }
    this.models = p.describe(configs.speaker ?? configs.participant);

    host.step('opening');
    // A voice's queue going idle ends its agent text segment. The runner calls `playback.clear()` before
    // `close()`, so a stop still closes an open segment while the sessions are open.
    const offVoiceIdle = deps.playback.onVoiceIdle?.((voice) => this.agentTextFeed.voiceIdle(voice));
    if (offVoiceIdle) this.stack.defer('agent text', offVoiceIdle);
    const punctuate = this.punctuatorForRun();
    for (const leg of shape.legs) {
      this.conversations.set(leg, new Conversation({
        leg,
        session: this.id,
        languages: contexts[leg]!.direction,
        clock: deps.clock,
        punctuate,
        retention: retentionFor(deps.replayAudio?.get() ?? shape.keepReplayAudio),
        onDiagnostic: (d) => reportWarning('SessionRunner', `${leg}: ${d.message}`, { dedupeKey: `conversation:${d.code}` }),
      }));
    }
    if (prepared.notice) this.conversations.get(shape.legs[0])!.notice({ severity: 'warning', ...prepared.notice });

    const together = shape.legs.length === 2 && !!p.session?.startBoth;
    // The lease's release slot, reserved beneath the sources it follows: the
    // stack unwinds last in first out, so the legs' sessions and then their
    // sources — the microphone, the system audio, the tab — close before the
    // lease's release goes out (spec: "released after they have closed"). A
    // lease never acquired releases nothing.
    let lease: Resources<unknown> | undefined;
    let leaseSlotRan = false;
    if (p.session?.acquire) {
      this.stack.defer('lease', () => {
        leaseSlotRan = true;
        return lease?.release();
      });
    }
    // Every leg's source before a lease is minted (Stage 2 Kizuna Soniox,
    // ruling 9): a source that fails after `acquire` would leave a lease no
    // stream ever started, which the backend's sweeps never reach — the next
    // Start 409-locked until its initial expiry (75 s, 195 s with `par_stt`).
    // Opened first, it fails before any key is minted. `startBoth` takes
    // both sources at once, so it opens them first too.
    const sources = p.session?.acquire || together ? await this.openSources() : null;

    let credentialsFor = (_leg: LegName): unknown => credentials;
    if (p.session?.acquire) {
      const resources = await p.session.acquire(shape, settings, {
        signal: this.signal,
        clock: deps.clock,
        // `close()` sets `ending` before it aborts; an abort listener that
        // reacts by calling this must not re-end a run already ending.
        end: (notice, o) => {
          if (this.ending) return;
          // One notice for the lease, on the first leg (Stage 2 Kizuna Soniox,
          // ruling 7): it covers every leg, and the same sentence twice in Both
          // says nothing more.
          this.conversations.get(shape.legs[0])?.notice({ severity: 'error', ...notice });
          // Ruling 8: a lease end is an error to analytics, as the old
          // client's budget exhaustion was (`ManagedSonioxSession.ts:166-173`),
          // unless the lease calls it the normal end of a segment — which the
          // old client deliberately never tracked (`:158-161`).
          if (!o?.expected) {
            deps.analytics.track('api_error', {
              provider: shape.provider.id, error_message: redact(notice.message), error_code: notice.code,
              error_type: apiErrorType(notice.code), channel: shape.legs[0],
            });
          }
          host.end({ reason: 'lease-ended', notice });
        },
        // The lease's wire traffic (`session.*`), in the first leg's Logs — its
        // release's outcome too, while the run unwinds (choice 4).
        frame: (frame) => deps.frames?.frame(shape.legs[0], frame),
        // The lease runs inside `opening`, so that is the step it returns to.
        waiting: (on) => host.step(on ? 'waiting' : 'opening'),
      });
      lease = resources;
      // An `acquire` that outlived `close()`'s bounded wait finds its slot
      // already run: a `defer` on an unwound stack releases it at once.
      if (leaseSlotRan) this.stack.defer('lease', () => resources.release());
      this.throwIfAborted();
      credentialsFor = (leg) => resources.credentials(leg);
      this.budget = resources.budget ?? null;
    }
    // The run's legs become the conversation once nothing before the adapters
    // can refuse the start: a refused lease leaves the last conversation on
    // screen (choice 3). A provider with neither a lease nor `startBoth` hands
    // them over before its legs open, as before.
    host.conversations(this.conversations, { provider: this.shape.provider.id, models: this.models });

    const requests = Object.fromEntries(shape.legs.map((leg) => [leg, {
      context: contexts[leg]!,
      config: configs[leg],
      credentials: credentialsFor(leg),
      clock: deps.clock,
      signal: this.signal,
      punctuate,
      // One source for both legs: in Both either side may refer to the screen (spec 2026-10-22 §3.1).
      ...(shape.frames ? { frames: shape.frames } : {}),
    }])) as Record<LegName, StartRequest<unknown, unknown>>;

    if (together) {
      const events = { speaker: this.eventsFor('speaker'), participant: this.eventsFor('participant') };
      let sessions: Record<LegName, AdapterSession>;
      try {
        sessions = await p.session!.startBoth!(requests, events);
      } catch (error) {
        // A provider that knows which leg failed says so; otherwise the start is the first leg's.
        if (error instanceof LegStartError) throw new LegOpenError(error.leg, error.cause, 'adapter');
        throw new LegOpenError(shape.legs[0], error, 'adapter');
      }
      this.sharedConnection = sessions.speaker.info.shared === true;
      for (const leg of shape.legs) this.stack.defer(`${leg} session`, () => sessions[leg].stop());
      this.throwIfAborted();
      shape.legs.forEach((leg, i) => this.connect(leg, sources![i], sessions[leg]));
    } else {
      await Promise.all(shape.legs.map((leg, i) => this.opened(this.openLeg(leg, requests[leg], sources?.[i]))));
    }
    this.throwIfAborted();
    // The network back (spec 2026-11-05 reconnect §4.2): a session waiting out a reconnect's backoff tries now. Undone as the run unwinds.
    const offOnline = deps.network?.onOnline(() => this.networkRestored());
    if (offOnline) this.stack.defer('network watch', offOnline);
    this.liveSince = deps.clock.now();
  }

  /** Ends the run: decide nothing more, close an open turn, abort, wait for a leg still opening, unwind, finalize the legs, say each leg stopped, wait (bounded) for fill-in. */
  async close(result: RunEnd): Promise<void> {
    const endedAt = this.deps.clock.now();
    this.ending = true;
    this.reconnectsCut(result, endedAt);
    if (this.turn?.close()) this.hold(false);
    this.controller.abort(new Error('the run ended'));
    // A `start()` / `startBoth` / `openSource` / `acquire` still in flight
    // finishes (and defers its release) before we unwind, so every resource
    // lands on the stack in the right order and is released in the right
    // order — including relative to `stop()` resolving (F3, D22).
    await this.awaitOpening();
    await this.stack.unwind();
    for (const conversation of this.conversations.values()) conversation.finalizeAll();
    this.frameStopped(result, endedAt);
    // Fill-in lands through `Conversation`'s own jobs, not `onEvent`; nothing
    // legitimate depends on the run still accepting events past this point.
    this.finished = true;
    await this.settled();
  }

  /**
   * One Logs line per leg once the unwind is done — after whatever its
   * adapter framed of its own ending — as every old client's `disconnect()`
   * logged `session.closed` (Stage 2 session end, ruling 2 (i); choices 1,
   * 2). Only once the run reached its opening step — a refusal, or a stop
   * while it checked, opened no leg — and not after `abandon()`: the page is
   * going away. Why it stopped (the run's reason, and its notice's code and
   * leg), the leg's last state, and the time from Start to the stop; never
   * the notice's words, which may quote a provider.
   */
  private frameStopped(result: RunEnd, endedAt: number): void {
    if (this.finished || this.conversations.size === 0) return;
    const { reason, notice } = result;
    for (const leg of this.shape.legs) {
      this.deps.frames?.frame(leg, {
        direction: 'out',
        type: 'session.stopped',
        payload: {
          reason,
          ...(notice?.code ? { code: notice.code } : {}),
          ...(notice?.leg ? { leg: notice.leg } : {}),
          state: this.legStates.get(leg) ?? null,
          elapsedMs: endedAt - this.startedAt,
        },
      });
    }
  }

  /** `pagehide`: decide nothing more, close an open turn, abort, fire every release now, finalize the legs (spec: "Stopping, and closing the window"). */
  abandon(): void {
    this.ending = true;
    if (this.turn?.close()) this.hold(false);
    this.controller.abort(new Error('the page went away'));
    this.stack.abandon();
    // As `close()` does: a page restored from the back/forward cache must
    // not show a segment still open.
    for (const conversation of this.conversations.values()) conversation.finalizeAll();
    this.finished = true;
  }

  /** A press (D14): opens a turn under manual turns once the run is live. */
  press(): void {
    const session = this.sessions.get('speaker');
    if (this.ending || this.liveSince === null || this.shape.turnMode === 'auto' || !session || this.turn?.isOpen) return;
    this.turn = new Turn(this.deps.clock.now());
    session.beginTurn();
    this.hold(true);
  }

  /** A release: the turn's voice decides between ending and cancelling it. */
  release(): void {
    const turn = this.turn;
    const session = this.sessions.get('speaker');
    if (!turn || !session) return;
    const outcome = turn.close();
    if (!outcome) return;
    this.hold(false);
    if (outcome === 'end') session.endTurn();
    else session.cancelTurn();
    this.deps.analytics.track('push_to_talk_used', {
      session_id: this.id,
      hold_duration_ms: this.deps.clock.now() - turn.startedAt,
      mode: this.shape.turnMode === 'push-to-translate' ? 'push-to-translate' : 'push-to-talk',
    });
  }

  /**
   * The speaker's voice is fed into processing: once live and until ending —
   * push-to-translate sends the original voice out while the key is up — but
   * under push-to-talk only while a turn is held (`send`).
   */
  speakerAudioInUse(): boolean {
    if (this.ending || this.liveSince === null) return false;
    return this.shape.turnMode !== 'push-to-talk' || this.turn?.isOpen === true;
  }

  /** The reconnecting legs whose adapter reports attempts: what the running state carries to the status line. */
  reconnectProgress(): Partial<Record<LegName, ReconnectProgress>> {
    const progress: Partial<Record<LegName, ReconnectProgress>> = {};
    for (const [leg, drop] of this.drops) if (drop.attempt !== undefined) progress[leg] = { attempt: drop.attempt, since: drop.since };
    return progress;
  }

  /** For `translation_session_end`: the reconnects that came back, the time down across them, and whether the run ended because one gave up. */
  reconnectTotals(): { count: number; downMs: number; failed: boolean } {
    return { ...this.totals };
  }

  /** Each leg's conversation as it stands, speaker first (the shape's order): what auto-save reads once this run has ended. */
  legs(): readonly Leg[] {
    return [...this.conversations.values()].map((conversation) => conversation.snapshot());
  }

  /** Translation I hear switched (#595): only a run started speaking the other side's translation follows it — one started without has no speech to switch on. */
  setParticipantSpeech(on: boolean): void {
    if (this.ending || !this.shape.participantSpeech) return;
    // Off drops the participant voice's queued speech (playback clears its queue). Its agent text segment ends
    // first, so a fill-in of the killed TTS segment never sends the dropped words, whichever lands first
    // (spec 2026-11-05 §4.2): playback's own idle then finds nothing open.
    if (!on) this.agentTextFeed.voiceIdle('participant');
    this.sessions.get('participant')?.setSpeech?.(on);
  }

  /** Typed text for the speaker leg, when the provider takes text. Blank once trimmed: nothing to send, for any provider. */
  sendText(text: string): void {
    const session = this.sessions.get('speaker');
    if (this.ending || this.liveSince === null || !this.shape.provider.textInput(this.shape.settings) || !session || !text.trim()) return;
    session.appendText(text);
    this.deps.analytics.track('text_input_sent', { session_id: this.id, provider: this.shape.provider.id, text_length: text.length });
  }

  /** A manual turn's key gates the original-voice route: push-to-translate closes it while held, push-to-talk opens it only while held (the routing's `gate`). */
  private hold(held: boolean): void {
    if (this.shape.turnMode !== 'auto') this.deps.playback.held(held);
  }

  /** The run's punctuator, decided once (`RunnerDeps.punctuationReady`). */
  private punctuatorForRun(): Punctuator | undefined {
    const { deps } = this;
    if (!deps.punctuate || !deps.punctuationReady) return deps.punctuate;
    try {
      return deps.punctuationReady() ? deps.punctuate : undefined;
    } catch (error) {
      reportWarning('SessionRunner', `The punctuationReady port threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'port:punctuationReady' });
      return undefined;
    }
  }

  /** Every leg's source, in parallel; one that fails names its leg (D22). */
  private openSources(): Promise<Source[]> {
    return Promise.all(this.shape.legs.map((leg) => this.opened((async () => {
      try {
        return await this.openSource(leg);
      } catch (error) {
        if (this.signal.aborted) throw error;
        throw new LegOpenError(leg, error, 'source');
      }
    })())));
  }

  private async openLeg(leg: LegName, request: StartRequest<unknown, unknown>, opened?: Source): Promise<void> {
    let stage: LegOpenError['stage'] = 'source';
    try {
      const source = opened ?? await this.openSource(leg);
      stage = 'adapter';
      this.setLegState(leg, 'opening');
      const session = await this.shape.provider.start(request, this.eventsFor(leg));
      this.stack.defer(`${leg} session`, () => session.stop());
      this.throwIfAborted();
      this.connect(leg, source, session);
    } catch (error) {
      if (this.signal.aborted) throw error;
      throw new LegOpenError(leg, error, stage);
    }
  }

  private async openSource(leg: LegName): Promise<Source> {
    const source = await this.deps.openSource(leg, this.signal);
    this.stack.defer(`${leg} source`, () => source.stop());
    this.throwIfAborted();
    // Subscribed as soon as the source resolves (D22): a capture that ends or
    // degrades while its leg is still opening must still be heard, not lost
    // waiting for `connect()`. The conversations already exist — `openSource`
    // runs after `host.step('opening')`.
    const conversation = this.conversations.get(leg)!;
    this.stack.defer(`${leg} end watch`, source.onEnded((reason) =>
      this.legEnded(leg, 'source-ended', { code: 'source_ended' satisfies RunNoticeCode, message: `The ${leg} capture ended: ${reason}` })));
    this.stack.defer(`${leg} degradation watch`, source.onDegraded(({ code, message, params, severity, lifetime }) =>
      conversation.degraded(code, message, { params, severity, lifetime })));
    return source;
  }

  private connect(leg: LegName, source: Source, session: AdapterSession): void {
    this.sessions.set(leg, session);
    // Switched off while the run was starting.
    if (leg === 'participant' && this.shape.participantSpeech && this.deps.participantSpeech?.get() === false) session.setSpeech?.(false);
    if (leg === 'speaker' || this.transport === undefined) this.transport = session.info.transport;
    this.stack.defer(`${leg} capture`, source.onPcm((pcm) => this.send(leg, session, pcm)));
    // A leg that said `reconnecting` before its start settled (split Both: its
    // socket opened before the other leg's did) is not live yet: its own
    // `reconnected` says when it is.
    if (this.legStates.get(leg) !== 'reconnecting') this.setLegState(leg, 'live');
    this.deps.analytics.track('connection_status', { status: 'connected', provider: this.shape.provider.id, channel: leg });
  }

  /** The participant leg and automatic turns stream everything; manual turns send only while the key is held. */
  private send(leg: LegName, session: AdapterSession, pcm: Int16Array): void {
    if (this.ending) return;
    if (leg === 'speaker' && this.shape.turnMode !== 'auto') {
      if (!this.turn?.isOpen) return;
      this.turn.add(pcm);
    }
    // Per chunk: an adapter that throws is reported when it starts failing,
    // and the throw never reaches the source's delivery.
    try {
      session.appendAudio(pcm);
      this.appendFailing.delete(leg);
    } catch (error) {
      if (!this.appendFailing.has(leg)) {
        reportError('SessionRunner', `The ${leg} adapter did not take audio: ${describeCause(error)}`, { cause: error, dedupeKey: `append:${leg}` });
      }
      this.appendFailing.add(leg);
    }
  }

  private eventsFor(leg: LegName): AdapterEvents {
    return eventsFrom((event) => this.onEvent(leg, event));
  }

  private onEvent(leg: LegName, event: AdapterEvent): void {
    if (this.finished) return;
    if (event.kind === 'frame') {
      this.deps.frames?.frame(leg, event.payload);
      return;
    }
    this.conversations.get(leg)?.apply(event);
    if (this.ending) return;
    const { playback, analytics } = this.deps;
    const provider = this.shape.provider.id;
    switch (event.kind) {
      case 'loading':
        this.host.loading(leg, event.payload);
        return;
      case 'segmentText':
        this.agentTextFeed.rowText(leg, event.payload.ref, event.payload.text);
        return;
      case 'audio':
        // The outlets the clip plays on decide whether, and where, its text goes (spec 2026-11-05 §4.1).
        this.agentTextFeed.audio(leg, event.payload, playback.audio(leg, event.payload.ref, event.payload.pcm, event.payload.voice));
        return;
      case 'speechRanges':
        this.agentTextFeed.ranges(leg, event.payload);
        return;
      case 'reconnecting':
        this.agentTextFeed.reconnecting(leg);
        this.reconnecting(leg, event.payload);
        return;
      case 'reconnected':
        this.reconnected(leg, event.payload);
        return;
      case 'failed': {
        const { message, code } = event.payload;
        this.failedReconnect(leg, event.payload);
        analytics.track('api_error', { provider, error_message: redact(message), error_code: code, error_type: apiErrorType(code), channel: leg });
        // L1 already recorded the failure as an error notice on this leg.
        this.host.end({ reason: 'leg-failed', notice: { code: code ?? ('leg_failed' satisfies RunNoticeCode), message, leg } });
        return;
      }
      case 'degraded': {
        // Ruling 8: every adapter degradation but a lost screen reaches `api_error`, as the old
        // Soniox client's TTS failures did (`error_code: tts_<cause>`), counted
        // as the user is told: L1's window per leg and code
        // (`DEGRADED_DEDUPE_MS`). Soniox reports once per failure episode
        // already, so the window changes nothing there; LocalInference's
        // per-sentence and per-utterance failures would otherwise send one
        // event each. A source's degradation is not an adapter's: it tracks
        // nothing, as before.
        const { code, message, reason } = event.payload;
        const key = `${leg}:${code}`;
        const now = this.deps.clock.now();
        const last = this.degradedTrackedAt.get(key);
        if (last !== undefined && now - last < DEGRADED_DEDUPE_MS) return;
        this.degradedTrackedAt.set(key, now);
        // A closed or hidden window is not the provider's error: its own
        // event only (spec 2026-10-22 §3.6), no title, no pixels.
        if (code === 'screen_context_lost') {
          analytics.track('screen_context_lost', { session_id: this.id, provider, channel: leg });
          return;
        }
        analytics.track('api_error', { provider, error_message: redact(message), error_code: reason ?? code, error_type: 'server', channel: leg });
        return;
      }
      case 'closed':
        this.legEnded(leg, 'leg-closed', { code: 'leg_closed' satisfies RunNoticeCode, message: `The ${leg} leg closed: ${event.payload.reason}` });
        return;
      default:
        return;
    }
  }

  /** A leg ended on its own: record why on the leg, and end the run. */
  private legEnded(leg: LegName, reason: RunEnd['reason'], notice: RunNotice): void {
    if (this.ending) return;
    this.conversations.get(leg)?.notice({ severity: 'error', ...notice });
    this.host.end({ reason, notice: { ...notice, leg } });
  }

  private setLegState(leg: LegName, state: LegState): void {
    this.legStates.set(leg, state);
    const drop = this.drops.get(leg);
    this.host.legState(leg, state, drop?.attempt !== undefined ? { attempt: drop.attempt, since: drop.since } : undefined);
  }

  /** The channel a reconnect event names: the leg, or `shared` for the one connection under both. */
  private channel(leg: LegName): ReconnectChannel {
    return this.sharedConnection ? 'shared' : leg;
  }

  /** Whether `leg`'s reconnect events count: a shared connection's arrive on both legs, and count once, from the speaker. */
  private counts(leg: LegName): boolean {
    return !this.sharedConnection || leg === 'speaker';
  }

  /** What every reconnect event carries (spec 2026-11-05 reconnect §4.5). */
  private reconnectEvent(leg: LegName, managed: boolean) {
    return { session_id: this.id, provider: this.shape.provider.id, managed, channel: this.channel(leg), client: reconnectClient(this.deps.platform) };
  }

  /**
   * A drop's first `reconnecting` stamps when it came and tells analytics once (`connection_status` per leg,
   * as today; `connection_dropped` when the adapter said why); each attempt after it updates the attempt.
   */
  private reconnecting(leg: LegName, e: { attempt: number; drop?: DropInfo } | undefined): void {
    const known = this.drops.get(leg);
    if (known) {
      if (e) known.attempt = e.attempt;
      this.setLegState(leg, 'reconnecting');
      return;
    }
    const drop: Drop = { since: this.deps.clock.now(), ...(e ? { attempt: e.attempt } : {}) };
    this.drops.set(leg, drop);
    this.setLegState(leg, 'reconnecting');
    this.deps.analytics.track('connection_status', { status: 'reconnecting', provider: this.shape.provider.id, channel: leg });
    if (e?.drop && this.counts(leg)) drop.sent = this.dropped(leg, e.drop, e.drop.retryable);
  }

  /** Sends `connection_dropped`, counting the drop among the run's: its index and kind, for the events after it. */
  private dropped(leg: LegName, drop: DropInfo, retryable: boolean): { index: number; managed: boolean } {
    const now = this.deps.clock.now();
    const index = ++this.dropCount;
    const last = this.reconnectedAt.get(leg);
    const network = this.deps.network;
    const online = network?.online();
    this.deps.analytics.track('connection_dropped', {
      ...this.reconnectEvent(leg, drop.managed),
      cause: drop.cause,
      ...(drop.closeCode !== undefined ? { close_code: drop.closeCode } : {}),
      ...(drop.errorCode !== undefined ? { error_code: drop.errorCode } : {}),
      retryable,
      // A leg of `startBoth` may drop before every leg is live: nothing has elapsed yet.
      session_elapsed_ms: this.liveSince === null ? 0 : now - this.liveSince,
      drop_index: index,
      ...(last !== undefined ? { since_last_reconnect_ms: now - last } : {}),
      // A port that cannot tell says nothing of it; its type is sent as it answers, `unknown` too.
      ...(online !== undefined ? { online } : {}),
      ...(network ? { network: network.type() } : {}),
    });
    return { index, managed: drop.managed };
  }

  /**
   * The leg is live again; the totals count it. The notice and `connection_reconnected` only when the adapter
   * says how it came back (the shared reconnector's payload): Gemini and OpenAI keep their own reconnects as they are.
   */
  private reconnected(leg: LegName, info: ReconnectedInfo | undefined): void {
    const drop = this.drops.get(leg);
    this.drops.delete(leg);
    this.setLegState(leg, 'live');
    const now = this.deps.clock.now();
    if (info) {
      const last = this.restoredAt.get(leg);
      this.restoredAt.set(leg, now);
      // A flapping connection is told once (spec 2026-11-05 reconnect §4.2): a reconnect within the flap window of the one before adds no notice.
      if (last === undefined || now - last > FLAP_WINDOW_MS) {
        this.conversations.get(leg)?.notice({ severity: 'info', code: 'connection_restored' satisfies RunNoticeCode, message: 'Connection lost and restored' });
      }
    }
    if (!drop || !this.counts(leg)) return;
    const downMs = now - drop.since;
    this.totals.count += 1;
    this.totals.downMs += downMs;
    this.reconnectedAt.set(leg, now);
    if (!info || !drop.sent) return;
    const network = this.deps.network;
    this.deps.analytics.track('connection_reconnected', {
      ...this.reconnectEvent(leg, drop.sent.managed),
      down_ms: downMs,
      attempts: info.attempts,
      credentials_reissued: info.credentialsReissued,
      reissue_ms: info.reissueMs,
      drop_index: drop.sent.index,
      budget_shared: info.budgetShared,
      ...(network ? { network: network.type() } : {}),
    });
  }

  /**
   * The leg failed, before `api_error`: its drop reaches analytics unless an open reconnect already sent it,
   * and a give-up as `connection_reconnect_failed`. A failure while it reconnected ends the run on a give-up —
   * the policy's verdict, or the failure itself from an adapter that reports none. A shared connection's
   * failure arrives on both legs in whichever order the adapter sends them: the first acts for the connection,
   * on the speaker's record (the one its drop was counted on), and the run ending ignores the second.
   */
  private failedReconnect(leg: LegName, e: Parameters<AdapterEvents['failed']>[0]): void {
    const key: LegName = this.sharedConnection ? 'speaker' : leg;
    const drop = this.drops.get(key);
    if (this.sharedConnection) this.drops.clear();
    else this.drops.delete(leg);
    // A give-up on a drop with no reconnect open (the session's reconnects used up) is a drop the policy took
    // up and refused: retryable. A drop that fails the leg outright was not worth retrying.
    const sent = drop?.sent ?? (e.drop ? this.dropped(key, e.drop, e.giveUp !== undefined && e.drop.retryable) : undefined);
    if (e.giveUp && sent) {
      this.deps.analytics.track('connection_reconnect_failed', {
        ...this.reconnectEvent(key, sent.managed),
        // No reconnect was open: down no time.
        down_ms: drop ? this.deps.clock.now() - drop.since : 0,
        attempts: e.giveUp.attempts,
        reason: e.giveUp.reason,
        ...(e.giveUp.errorCode !== undefined ? { error_code: e.giveUp.errorCode } : {}),
        ...(e.giveUp.refusalCode !== undefined ? { refusal_code: e.giveUp.refusalCode } : {}),
        drop_index: sent.index,
      });
    }
    if (e.giveUp || drop) this.totals.failed = true;
  }

  /**
   * The run ends while a leg still reconnects: that reconnect ends with it, a lease end as `lease_ended`, any
   * other end as `stopped` (Review Focus 1, 5). No `failed` follows: the session's stop cancels its reconnector,
   * and an ending run decides nothing on events.
   */
  private reconnectsCut(result: RunEnd, endedAt: number): void {
    const reason = result.reason === 'lease-ended' ? 'lease_ended' : 'stopped';
    for (const [leg, drop] of this.drops) {
      if (!drop.sent || !this.counts(leg)) continue;
      this.deps.analytics.track('connection_reconnect_failed', {
        ...this.reconnectEvent(leg, drop.sent.managed),
        down_ms: endedAt - drop.since,
        attempts: drop.attempt ?? 0,
        reason,
        drop_index: drop.sent.index,
      });
    }
    this.drops.clear();
  }

  /** The network is back: each connection hears it once; a session that throws neither reaches the port nor keeps the others from hearing it. */
  private networkRestored(): void {
    if (this.ending) return;
    for (const [leg, session] of this.sessions) {
      if (!this.counts(leg)) continue;
      try {
        session.networkRestored?.();
      } catch (error) {
        reportError('SessionRunner', `The ${leg} adapter did not take the network's return: ${describeCause(error)}`, { cause: error, dedupeKey: `networkRestored:${leg}` });
      }
    }
  }

  private async settled(): Promise<void> {
    const all = Promise.all([...this.conversations.values()].map((c) => c.settled()));
    await new Promise<void>((resolve) => {
      const cancel = this.deps.clock.setTimeout(resolve, this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      void all.then(() => { cancel(); resolve(); });
    });
  }

  private throwIfAborted(): void {
    if (this.signal.aborted) throw this.signal.reason ?? new Error('aborted');
  }

  /** `task`, or the abort, whichever comes first: a check that cannot be cancelled no longer holds a stop. */
  private untilAborted<T>(task: Promise<T>): Promise<T> {
    // On an abort the answer is dropped: observe it, so a late rejection is never unhandled.
    task.catch(() => {});
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(this.signal.reason ?? new Error('aborted'));
      if (this.signal.aborted) return onAbort();
      this.signal.addEventListener('abort', onAbort, { once: true });
      task.then(
        (value) => { this.signal.removeEventListener('abort', onAbort); resolve(value); },
        (error) => { this.signal.removeEventListener('abort', onAbort); reject(error); },
      );
    });
  }

  /**
   * Waits for `open()`'s own promise to settle, and then for every leg's
   * open still in flight, bounded by one timeout so a hung adapter that
   * ignores the signal cannot hold the stop forever: a leg still opening
   * when another failed is released before the run unwinds. What any of them
   * resolves or rejects to does not matter here — only that whatever it was
   * going to defer has had the chance to.
   */
  private awaitOpening(): Promise<void> {
    const opening = this.opening;
    if (!opening) return Promise.resolve();
    const all = opening.then(() => undefined, () => undefined).then(() => Promise.allSettled(this.legOpens));
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const cancel = this.deps.clock.setTimeout(finish, this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      void all.then(() => { cancel(); finish(); });
    });
  }
}
