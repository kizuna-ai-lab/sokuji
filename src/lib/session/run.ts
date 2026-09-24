/**
 * One run (spec: "A run"): the shape frozen at start, its resources on a
 * stack, its legs. Everything that opens here is pushed with its release the
 * moment it is acquired, so stop, failure and cancel unwind the same way. The
 * runner owns the phases and ends a run through `close()`.
 */
import type { AnalyticsEvents } from '../analytics';
import type { AdapterEvents, AdapterSession, StartRequest } from '../contract/adapter';
import { eventsFrom, type AdapterEvent } from '../contract/events';
import { Conversation, DEFAULT_RETENTION } from '../conversation/Conversation';
import type { LegName } from '../conversation/types';
import { describeCause, reportError, reportWarning } from '../diagnostics/report';
import { redact } from '../diagnostics/redact';
import { isMissing, readCredentials } from '../provider/credentials';
import type { RunNoticeCode } from './codes';
import type { ConversationInfo } from './conversationSet';
import type { RunnerDeps } from './ports';
import { contextsFor, gate, type Refusal } from './shape';
import type { Source } from './source';
import { ResourceStack } from './stack';
import { Turn } from './turn';
import type { LegState, Prepared, RunEnd, RunNotice, RunShape } from './types';

const DEFAULT_TIMEOUT_MS = 5_000;
const API_ERROR_TYPES = ['auth', 'rate_limit', 'network', 'server', 'client'] as const;
type ApiErrorType = AnalyticsEvents['api_error']['error_type'];

/** The start was refused before anything opened. */
export class RefusedError extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.message);
  }
}

/** Opening one leg threw: its source, or its adapter. */
export class LegOpenError extends Error {
  constructor(readonly leg: LegName, readonly failure: unknown) {
    super(describeCause(failure));
  }
}

/** What a run tells the runner. */
export interface RunHost {
  step(step: 'checking' | 'preparing' | 'opening'): void;
  legState(leg: LegName, state: LegState): void;
  /** The run's legs exist: they become the conversation now, so text shows as it arrives. */
  conversations(legs: ReadonlyMap<LegName, Conversation>, info: ConversationInfo): void;
  /** A leg ended on its own, or a lease did: end the run. */
  end(result: RunEnd): void;
}

export class Run {
  readonly id: string;
  readonly legStates = new Map<LegName, LegState>();
  /** When every leg went live; null until then. */
  liveSince: number | null = null;
  transport: string | undefined;
  models: { asrModel?: string; translationModel?: string; ttsModel?: string } = {};
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

  /** Keeps `task` among the opens `close()` waits for. */
  private opened<T>(task: Promise<T>): Promise<T> {
    this.legOpens.push(task);
    return task;
  }

  /** `host` is a factory because the runner's host closes over the run it serves. */
  constructor(private readonly deps: RunnerDeps, host: (run: Run) => RunHost, readonly shape: RunShape) {
    this.id = deps.newSessionId();
    this.host = host(this);
    this.stack = new ResourceStack(deps.clock, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS, (f) =>
      reportWarning('SessionRunner', `Releasing ${f.name} failed: ${f.message}`, { dedupeKey: `release:${f.name}` }));
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
    if (isMissing(credentials)) throw new RefusedError({ code: 'credentials_missing' satisfies RunNoticeCode, message: credentials.missing });
    const readiness = await deps.ensureReady(p, shape.auth);
    this.throwIfAborted();
    if (readiness.state !== 'ready') {
      throw new RefusedError({ code: 'not_ready' satisfies RunNoticeCode, message: readiness.state === 'not-ready' ? readiness.reason : `readiness is ${readiness.state}` });
    }

    let settings = shape.settings;
    let prepared: Prepared<unknown> = {};
    if (p.session?.prepare) {
      host.step('preparing');
      prepared = await p.session.prepare(shape, settings, this.signal);
      this.throwIfAborted();
      if (prepared.override) settings = { ...(settings as object), ...prepared.override };
      if (prepared.persist) deps.persistIfUnchanged(p, shape.settings, prepared.persist);
    }

    const contexts = contextsFor(shape);
    const configs: Partial<Record<LegName, unknown>> = {};
    for (const leg of shape.legs) {
      const built = p.build(contexts[leg]!, settings, shape.shared);
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
      if (admitted !== true) {
        throw new RefusedError({
          code: admitted.code ?? ('admit_refused' satisfies RunNoticeCode),
          message: admitted.refused,
          ...(admitted.params ? { params: admitted.params } : {}),
        });
      }
    }
    this.models = p.describe(configs.speaker ?? configs.participant);

    let credentialsFor = (_leg: LegName): unknown => credentials;
    if (p.session?.acquire) {
      const resources = await p.session.acquire(shape, settings, {
        signal: this.signal,
        // `close()` sets `ending` before it aborts; an abort listener that
        // reacts by calling this must not re-end a run already ending.
        end: (notice) => {
          if (this.ending) return;
          // The lease covers every leg; each one records why it ended (spec: notices on L1).
          for (const conversation of this.conversations.values()) conversation.notice({ severity: 'error', ...notice });
          host.end({ reason: 'lease-ended', notice });
        },
      });
      this.stack.defer('lease', () => resources.release());
      this.throwIfAborted();
      credentialsFor = (leg) => resources.credentials(leg);
    }

    host.step('opening');
    for (const leg of shape.legs) {
      this.conversations.set(leg, new Conversation({
        leg,
        session: this.id,
        languages: contexts[leg]!.direction,
        clock: deps.clock,
        punctuate: deps.punctuate,
        retention: shape.keepReplayAudio ? DEFAULT_RETENTION : { keepPcm: false, maxPcmBytes: 0 },
        onDiagnostic: (d) => reportWarning('SessionRunner', `${leg}: ${d.message}`, { dedupeKey: `conversation:${d.code}` }),
      }));
    }
    host.conversations(this.conversations, { provider: this.shape.provider.id, models: this.models });
    if (prepared.notice) this.conversations.get(shape.legs[0])!.notice({ severity: 'warning', ...prepared.notice });

    const requests = Object.fromEntries(shape.legs.map((leg) => [leg, {
      context: contexts[leg]!,
      config: configs[leg],
      credentials: credentialsFor(leg),
      clock: deps.clock,
      signal: this.signal,
    }])) as Record<LegName, StartRequest<unknown, unknown>>;

    if (shape.legs.length === 2 && p.session?.startBoth) {
      const sources = await Promise.all(shape.legs.map((leg) => this.opened((async () => {
        try {
          return await this.openSource(leg);
        } catch (error) {
          if (this.signal.aborted) throw error;
          throw new LegOpenError(leg, error);
        }
      })())));
      // Built before the sources opened; a source with a track hands it to the adapter (WebRTC).
      shape.legs.forEach((leg, i) => {
        const track = sources[i].track;
        if (track) requests[leg] = { ...requests[leg], input: track };
      });
      const events = { speaker: this.eventsFor('speaker'), participant: this.eventsFor('participant') };
      let sessions: Record<LegName, AdapterSession>;
      try {
        sessions = await p.session.startBoth(requests, events);
      } catch (error) {
        throw new LegOpenError(shape.legs[0], error);
      }
      for (const leg of shape.legs) this.stack.defer(`${leg} session`, () => sessions[leg].stop());
      this.throwIfAborted();
      shape.legs.forEach((leg, i) => this.connect(leg, sources[i], sessions[leg]));
    } else {
      await Promise.all(shape.legs.map((leg) => this.opened(this.openLeg(leg, requests[leg]))));
    }
    this.throwIfAborted();
    this.liveSince = deps.clock.now();
  }

  /** Ends the run: decide nothing more, close an open turn, abort, wait for a leg still opening, unwind, finalize the legs, wait (bounded) for fill-in. */
  async close(): Promise<void> {
    this.ending = true;
    if (this.turn?.close()) this.hold(false);
    this.controller.abort(new Error('the run ended'));
    // A `start()` / `startBoth` / `openSource` / `acquire` still in flight
    // finishes (and defers its release) before we unwind, so every resource
    // lands on the stack in the right order and is released in the right
    // order — including relative to `stop()` resolving (F3, D22).
    await this.awaitOpening();
    await this.stack.unwind();
    for (const conversation of this.conversations.values()) conversation.finalizeAll();
    // Fill-in lands through `Conversation`'s own jobs, not `onEvent`; nothing
    // legitimate depends on the run still accepting events past this point.
    this.finished = true;
    await this.settled();
  }

  /** `pagehide`: decide nothing more, abort, fire every release now, finalize the legs (spec: "Stopping, and closing the window"). */
  abandon(): void {
    this.ending = true;
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

  /** Typed text for the speaker leg, when the provider takes text. */
  sendText(text: string): void {
    const session = this.sessions.get('speaker');
    if (this.ending || this.liveSince === null || !this.shape.provider.textInput || !session) return;
    session.appendText(text);
    this.deps.analytics.track('text_input_sent', { session_id: this.id, provider: this.shape.provider.id, text_length: text.length });
  }

  /** Push-to-translate closes the original-voice route while the key is held; push-to-talk leaves it alone. */
  private hold(held: boolean): void {
    if (this.shape.turnMode === 'push-to-translate') this.deps.playback.held(held);
  }

  private async openLeg(leg: LegName, request: StartRequest<unknown, unknown>): Promise<void> {
    try {
      const source = await this.openSource(leg);
      this.setLegState(leg, 'opening');
      // Built before the source opened; a source with a track hands it to the adapter (WebRTC).
      const withInput = source.track ? { ...request, input: source.track } : request;
      const session = await this.shape.provider.start(withInput, this.eventsFor(leg));
      this.stack.defer(`${leg} session`, () => session.stop());
      this.throwIfAborted();
      this.connect(leg, source, session);
    } catch (error) {
      if (this.signal.aborted) throw error;
      throw new LegOpenError(leg, error);
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
    this.stack.defer(`${leg} degradation watch`, source.onDegraded(({ code, message }) =>
      conversation.degraded(code, message)));
    return source;
  }

  private connect(leg: LegName, source: Source, session: AdapterSession): void {
    this.sessions.set(leg, session);
    if (leg === 'speaker' || this.transport === undefined) this.transport = session.info.transport;
    this.stack.defer(`${leg} capture`, source.onPcm((pcm) => this.send(leg, session, pcm)));
    this.setLegState(leg, 'live');
    this.deps.analytics.track('connection_status', { status: 'connected', provider: this.shape.provider.id });
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
      case 'audio':
        playback.audio(leg, event.payload.ref, event.payload.pcm);
        return;
      case 'reconnecting':
        this.setLegState(leg, 'reconnecting');
        analytics.track('connection_status', { status: 'reconnecting', provider });
        return;
      case 'reconnected':
        this.setLegState(leg, 'live');
        return;
      case 'failed': {
        const { message, code } = event.payload;
        const errorType: ApiErrorType = API_ERROR_TYPES.find((t) => t === code) ?? 'server';
        analytics.track('api_error', { provider, error_message: redact(message), error_code: code, error_type: errorType, channel: leg });
        // L1 already recorded the failure as an error notice on this leg.
        this.host.end({ reason: 'leg-failed', notice: { code: code ?? ('leg_failed' satisfies RunNoticeCode), message, leg } });
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
    this.host.legState(leg, state);
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
