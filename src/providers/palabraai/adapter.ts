/**
 * Palabra AI on the new contract (spec: "L0 — the client contract"),
 * written from scratch over WebSocket — the old LiveKit client
 * (`src/services/clients/PalabraAIClient.ts`, still compiled until the
 * deletion plan) is not ported (the owner, 2026-09-29). One leg, one socket.
 * The platform key dials the streaming endpoint straight; the legacy app
 * pair first creates a REST session and dials its address with the
 * publisher token, and deletes that session — its own, no other — when the
 * leg ends (ruling 1). The start resolves once `get_task` finds the task
 * running (ruling 4). What goes up is cut into 320 ms chunks (ruling 5), and
 * a stream with no audio carries real-time silence (ruling 3). Messages
 * become segments paired by their sentence, speech ranged once its burst is
 * whole (`items.ts`; ruling 6). Every timer reads the request's clock, and
 * nothing is said but through events (CLAUDE.md, "Inside an IClient
 * session").
 */
import {
  AdapterStartError,
  SAMPLE_RATE,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type StartRequest,
} from '../../lib/contract/adapter';
import { every } from '../../lib/contract/clock';
import { framePayload } from '../../lib/contract/framePayload';
import { base64ToPcm } from '../../lib/contract/pcm64';
import { nativeSocket, WS_OPEN, type OpenSocket } from '../../lib/contract/socket';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { CHUNK_MS, IDLE_MS, Rechunker, SILENCE } from './audioIn';
import type { PalabraConfig } from './config';
import { PalabraItems } from './items';
import type { PalabraCredentials } from './settings';
import {
  CREATE_SESSION_BODY,
  CREATE_SESSION_URL,
  decodeMessage,
  directUrl,
  END_TASK,
  errorCode,
  errorOf,
  errorWords,
  GET_TASK,
  inputAudio,
  NOT_FOUND,
  outputAudioOf,
  POLICY_VIOLATION,
  readCreated,
  restHeaders,
  restWords,
  sessionDeleteUrl,
  sessionUrl,
  setTask,
  taskStatusOf,
  transcriptionOf,
  VOICE_NOT_FOUND,
  warningOf,
  type PalabraMessage,
} from './wire';

/**
 * The start's bound on the request's clock (ruling 4): twice the sum of
 * each stage's slowest time in the owner's probe — a REST create up to
 * 2.8 s, the upgrade up to 4.0 s, the task running at the first ask 2.1 s
 * later, 8.9 s in all — rounded up (choice 6).
 */
export const START_TIMEOUT_MS = 20_000;
/** Between two asks whether the task runs (ruling 4): the docs allow one `set_task` or `get_task` per 2 s, and the probe asked 2.1 s apart and was always answered (choice 6). */
export const POLL_MS = 2_100;
/** How long a mid-session `error` words the close that follows it (ruling 11): OpenAI's value; the probe's `SERVICE_TIMEOUT` closed 0.26 s after its error. */
export const ERROR_WORDS_MS = 10_000;
/** How long deleting a REST session may take (ruling 1): the spec's bound on a release. */
export const RELEASE_TIMEOUT_MS = 5_000;

/** The platform key's socket, failed before it opened while online: a wrong key is a bare 403 on the upgrade (the owner's probe), which a browser cannot see. */
export const REFUSED_UPGRADE = 'Palabra refused the connection before it opened: check the API key.';
/** A socket or a request that failed while the device is offline: it says nothing about the credentials. */
export const OFFLINE = 'The device is offline: Palabra could not be reached.';
/** The app pair's socket, failed before it opened while online: its token is seconds old, so the network or the service. */
export const NEVER_OPENED = "Palabra's socket did not open (check the network).";
/** A close 1008 with no error before it: past Palabra's connection limit (the docs). */
export const RATE_LIMITED = 'Palabra closed the connection with 1008: its limit is 20 connections a minute per key.';

export interface PalabraAdapterDeps {
  /** `new WebSocket(url)` in the app; a `FakeSocket` factory in tests. */
  openSocket: OpenSocket;
  /** The app pair's REST calls: the session's create and delete. */
  fetch: typeof fetch;
  /** The streaming URL's first segment for the platform key: any URL-safe string. */
  newId: () => string;
  /** False: the device is offline. */
  online: () => boolean;
}

const closeWords = (e: CloseEvent) => `${e.code}${e.reason ? ` ${e.reason}` : ''}`;

/** An idle beat's frame, the same every time: encoded once, not three times a second. */
let silentFrame: string | null = null;
const silence = (): string => (silentFrame ??= inputAudio(SILENCE));

/** A thrown value's name alone (`SyntaxError`, `SecurityError`), never its message: a browser that refuses a socket quotes its URL, a credential in it. */
function errorName(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name !== '' ? name : 'unknown error';
}

/** A REST refusal's notice code. */
function restCode(status: number): string {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  return status >= 500 ? 'server' : 'client';
}

class PalabraLeg implements AdapterSession {
  readonly info = { transport: 'websocket' };
  readonly opening: Promise<AdapterSession>;
  /** `creating` while the app pair's REST session is asked for; `opening` until the task runs; then `live`. */
  private phase: 'creating' | 'opening' | 'live' | 'ended' = 'opening';
  private socket: WebSocket | null = null;
  private opened = false;
  /** The id of the REST session this leg created: deleted when the leg ends, whichever way (ruling 1). */
  private sessionId: string | null = null;
  private releasing: Promise<void> | null = null;
  private readonly items: PalabraItems;
  private readonly chunks = new Rechunker();
  private lastAudioAt = 0;
  private idle = false;
  /** A push-to-talk release came, and no audio since: the leg is idle from the next beat (choice 7). */
  private released = false;
  /** The stream's own clock (choice 7): when it began, the wall clock at the last beat, and how much has gone up — 320 ms a chunk, whatever it holds. */
  private streamFrom = 0;
  private lastBeatAt = 0;
  private streamedMs = 0;
  private stopKeepalive: () => void = () => {};
  private cancelPoll: () => void = () => {};
  /** The last frame parsed: `session.unreadable` on the ok → failing transition only. */
  private readable = true;
  /** The last chunk of speech decoded: its own episode, since every frame that parses re-arms `readable`. */
  private audioReadable = true;
  /** `voice_fallback` said: once per session (ruling 11). */
  private voiceFellBack = false;
  /** The last mid-session `error`, and when: the words of a close that follows it closely (ruling 11). */
  private lastError: { code: string; message: string; at: number } | null = null;
  private settle: { resolve(): void; reject(error: unknown): void } | null = null;

  constructor(
    private readonly request: StartRequest<PalabraConfig, PalabraCredentials>,
    private readonly events: AdapterEvents,
    private readonly deps: PalabraAdapterDeps,
  ) {
    this.items = new PalabraItems(events);
    // The bound and the abort are armed before anything opens, so nothing can leave a socket behind (the OpenAI Realtime review's hardening).
    this.opening = new Promise<AdapterSession>((resolve, reject) => {
      const { clock, signal } = request;
      const cancelTimer = clock.setTimeout(() => this.refuse(this.opened
        ? new AdapterStartError(`Palabra did not start the task within ${START_TIMEOUT_MS / 1000} s.`, 'server')
        : new AdapterStartError(`Palabra did not open the connection within ${START_TIMEOUT_MS / 1000} s.`, 'network')), START_TIMEOUT_MS);
      const onAbort = () => this.refuse(signal.reason ?? new Error('aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      const done = () => { cancelTimer(); signal.removeEventListener('abort', onAbort); };
      this.settle = {
        resolve: () => { done(); resolve(this); },
        reject: (error) => { done(); reject(error); },
      };
    });
    const { credentials } = request;
    if (credentials.kind === 'apiKey') {
      this.connect(directUrl(deps.newId(), credentials), 'key');
    } else {
      this.phase = 'creating';
      void this.create();
    }
  }

  /** Cut into 320 ms chunks as it comes (ruling 5), no frame per chunk (the hot-path rule); an idle ends here. */
  appendAudio(pcm: Int16Array): void {
    if (this.phase !== 'live') return;
    for (const chunk of this.chunks.push(pcm)) this.sendAudio(chunk);
    this.lastAudioAt = this.request.clock.now();
    this.released = false;
    if (this.idle) {
      this.idle = false;
      this.frame('out', 'audio.resumed');
    }
  }

  /** Palabra takes no typed text (`textInput: false`). */
  appendText(): void {}

  /** Nothing to mark: Palabra's own segmentation finds the speech. */
  beginTurn(): void {}

  endTurn(): void {
    this.flushTurn(false);
  }

  cancelTurn(): void {
    this.flushTurn(true);
  }

  /**
   * The close before its first `await`, what is still being translated
   * dropped (ruling 13): `end_task` best-effort, then the close; a REST
   * session's delete goes out now and is the one thing awaited, bounded.
   * Nothing is framed after a stop.
   */
  stop(): Promise<void> {
    if (this.phase === 'live') this.send(JSON.stringify(END_TASK));
    this.shutDown();
    return this.releasing ?? Promise.resolve();
  }

  /**
   * The app pair's REST session (ruling 1): created, then its own address
   * dialled with the publisher token. The create runs on its own signal,
   * bounded by `START_TIMEOUT_MS` from its send on the request's clock — not
   * the leg's: a browser rejects the body of a request aborted after its
   * answer came, so a create the leg abandoned could never be read, and the
   * session it made would outlive the leg (choice 9). A create that lands
   * after the leg ended is read for its id alone — all a delete needs — and
   * its session deleted; nothing opens.
   */
  private async create(): Promise<void> {
    this.frame('out', 'session.create');
    const controller = new AbortController();
    const cancelBound = this.request.clock.setTimeout(() => controller.abort(), START_TIMEOUT_MS);
    let response: Response;
    let body: unknown;
    try {
      response = await this.deps.fetch(CREATE_SESSION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...restHeaders(this.request.credentials) },
        body: CREATE_SESSION_BODY,
        signal: controller.signal,
      });
      body = await response.json().catch(() => null);
    } catch (error) {
      // No answer — its own bound, or the network — after the leg ended: nothing to delete, nothing to say.
      if (this.phase !== 'creating') return;
      this.frame('in', 'session.create_failed', { message: describeCause(error) });
      this.refuse(new AdapterStartError(this.deps.online() ? "Palabra's session service could not be reached." : OFFLINE, 'network', undefined, { cause: error }));
      return;
    } finally {
      cancelBound();
    }
    // The session's id is all a delete needs: an answer that names one made a session, whatever else it lacks; one that names none has nothing to delete (choice 9).
    const named = response.ok ? (body as { data?: { id?: unknown } } | null)?.data?.id : undefined;
    const id = typeof named === 'string' && named !== '' ? named : null;
    if (this.phase !== 'creating') {
      // Made after the leg gave up: still ours to delete, and never dialled.
      if (id) {
        this.sessionId = id;
        this.release();
      }
      return;
    }
    // In time, the whole answer: the socket needs its address and the publisher token.
    const created = response.ok ? readCreated(body) : null;
    if (!response.ok) {
      const message = restWords(response.status, body, 'Palabra refused to create a session.');
      this.frame('in', 'session.create_failed', { status: response.status, message });
      this.refuse(new AdapterStartError(message, restCode(response.status)));
      return;
    }
    if (!created) {
      // Refused, and the session it names deleted by the refusal's shutDown.
      this.sessionId = id;
      this.frame('in', 'session.create_failed', { status: response.status, message: 'no socket to reach' });
      this.refuse(new AdapterStartError('Palabra answered the session request without a socket to reach.', 'server'));
      return;
    }
    // Neither the id nor the publisher is framed: both are shaped as tokens (the owner's probe).
    this.sessionId = created.id;
    this.frame('in', 'session.created', { status: response.status });
    let url: string;
    try {
      url = sessionUrl(created);
    } catch {
      this.refuse(new AdapterStartError('Palabra answered the session request with an address that is no URL.', 'server'));
      return;
    }
    this.phase = 'opening';
    this.connect(url, 'session');
  }

  private connect(url: string, path: 'key' | 'session'): void {
    let socket: WebSocket;
    try {
      socket = this.deps.openSocket(url);
    } catch (error) {
      // In fixed words and with no cause: a browser that refuses the socket quotes its URL, the key or the token in it.
      this.refuse(new AdapterStartError(`The browser would not open the socket (${errorName(error)}).`, 'network'));
      return;
    }
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => this.onOpen(path);
    socket.onmessage = (e: MessageEvent) => this.onMessage(e.data);
    // A Logs line: the close that follows says what it did to the session.
    socket.onerror = () => this.frame('in', 'session.socket_error');
    socket.onclose = (e: CloseEvent) => this.onClose(e, path);
  }

  /** The socket opened: the task goes up, and the first ask whether it runs follows 2.1 s later (ruling 4). */
  private onOpen(path: 'key' | 'session'): void {
    if (this.phase !== 'opening') return;
    this.opened = true;
    this.frame('in', 'session.opened', { path });
    const task = setTask(this.request.config);
    if (!this.send(JSON.stringify(task))) return;
    this.frame('out', 'task.set', task.data);
    this.cancelPoll = this.request.clock.setTimeout(() => this.poll(), POLL_MS);
  }

  /** Asks whether the task runs, every 2.1 s until it does: `set_task` is not acknowledged, and `get_task` answers `NOT_FOUND` until then (ruling 4). */
  private poll(): void {
    if (this.phase !== 'opening') return;
    if (this.send(JSON.stringify(GET_TASK))) this.frame('out', 'task.get');
    this.cancelPoll = this.request.clock.setTimeout(() => this.poll(), POLL_MS);
  }

  private onMessage(data: unknown): void {
    if (this.phase === 'ended') return;
    let m: PalabraMessage;
    try {
      m = decodeMessage(data);
    } catch (error) {
      this.unreadable('frame', error);
      return;
    }
    this.readable = true;
    switch (m.type) {
      case 'current_task': return this.currentTask(m.data);
      case 'error': return this.serverError(m.data);
      case 'warning': return this.warning(m.data);
      case 'partial_transcription': {
        const t = transcriptionOf(m.data);
        this.frame('in', 'transcription.partial', { id: t.id ?? null, text: t.text, start: t.start ?? null, end: t.end ?? null });
        if (this.phase === 'live') this.items.sourcePartial(t);
        return;
      }
      case 'validated_transcription': {
        const t = transcriptionOf(m.data);
        this.frame('in', 'transcription.validated', { id: t.id ?? null, language: t.language ?? null, text: t.text, start: t.start ?? null, end: t.end ?? null });
        if (this.phase === 'live') this.items.sourceFinal(t);
        return;
      }
      case 'partial_translated_transcription': {
        const t = transcriptionOf(m.data);
        this.frame('in', 'translation.partial', { id: t.id ?? null, part: t.part ?? null, text: t.text });
        if (this.phase === 'live') this.items.translationPartial(t);
        return;
      }
      case 'translated_transcription': {
        const t = transcriptionOf(m.data);
        this.frame('in', 'translation.final', { id: t.id ?? null, part: t.part ?? null, language: t.language ?? null, text: t.text });
        if (this.phase === 'live') this.items.translationFinal(t);
        return;
      }
      case 'output_audio_data': return this.outputAudio(m.data);
      case 'end_of_stream': return this.frame('in', 'session.end_of_stream');
      default: return this.frame('in', 'session.unknown', { type: m.type });
    }
  }

  private currentTask(data: Record<string, unknown>): void {
    const status = taskStatusOf(data) ?? null;
    this.frame('in', 'task.current', { status });
    if (this.phase === 'opening' && status === 'running') this.started();
  }

  /** The task runs: the start resolves (ruling 4), and the idle rule's beat starts (ruling 3). */
  private started(): void {
    this.phase = 'live';
    this.cancelPoll();
    const now = this.request.clock.now();
    this.lastAudioAt = now;
    this.streamFrom = now;
    this.lastBeatAt = now;
    this.stopKeepalive = every(this.request.clock, CHUNK_MS, () => this.keepalive());
    const settle = this.settle;
    this.settle = null;
    settle?.resolve();
  }

  /**
   * An `error` is a red Logs line (ruling 11). Before the task runs it
   * refuses the start in Palabra's words — a `set_task` it would not take
   * (ruling 4) — except `NOT_FOUND`, the expected answer to an ask made
   * before the task runs: no failure, so framed `task.not_found`, not red
   * (choice 8). Mid-session it is kept, with its time, for the close that
   * may follow it.
   */
  private serverError(data: Record<string, unknown>): void {
    const e = errorOf(data);
    if (e.code === NOT_FOUND && this.phase === 'opening') {
      this.frame('in', 'task.not_found');
      return;
    }
    this.frame('in', 'session.error', { code: e.code ?? null, desc: e.desc ?? null, msg: e.msg ?? null, param: e.param ?? null });
    if (e.code === NOT_FOUND) return;
    const refusal = { code: errorCode(e), message: errorWords(e) };
    if (this.phase === 'opening') {
      this.refuse(new AdapterStartError(refusal.message, refusal.code));
      return;
    }
    if (this.phase === 'live') this.lastError = { ...refusal, at: this.request.clock.now() };
  }

  /** A `warning` is a Logs line; `VOICE_NOT_FOUND` is also the `voice_fallback` notice, once per session (ruling 11). The stream's pacing warnings (`AUDIO_STREAM_*`) are the Logs' alone. */
  private warning(data: Record<string, unknown>): void {
    const w = warningOf(data);
    this.frame('in', 'session.warning', { code: w.code ?? null, message: w.message ?? null });
    if (this.phase !== 'live' || w.code !== VOICE_NOT_FOUND || this.voiceFellBack) return;
    this.voiceFellBack = true;
    this.events.degraded({ code: 'voice_fallback', message: `Palabra did not have the voice asked for, and speaks in another: ${w.message ?? VOICE_NOT_FOUND}` });
  }

  /** A chunk of speech: framed by its size, never its content; played on a leg that speaks. */
  private outputAudio(data: Record<string, unknown>): void {
    const a = outputAudioOf(data);
    // No base64 string where the audio should be: the same episode as audio that will not decode, in fixed words that quote nothing of the frame.
    if (typeof a.audio !== 'string') {
      this.unreadable('audio', new Error('an audio chunk with no base64 string'));
      return;
    }
    let pcm: Int16Array;
    try {
      pcm = base64ToPcm(a.audio);
    } catch (error) {
      this.unreadable('audio', error);
      return;
    }
    this.audioReadable = true;
    this.frame('in', 'audio.output', { id: a.id ?? null, part: a.part ?? null, last: a.last, samples: pcm.length });
    // A leg that does not speak asked for text alone (`output_stream: null`, ruling 7): audio it gets anyway is not played.
    if (this.phase === 'live' && this.request.context.speech) this.items.audio(a, pcm);
  }

  /**
   * The idle rule (ruling 3). Nothing reaches the server while the
   * microphone is muted or between push-to-talk turns, and Palabra ends a
   * stream that sent no audio for 10 s — `SERVICE_TIMEOUT`, then a close
   * 1008 — and confirms a sentence only by the silence heard after it (the
   * owner's follow-up probe). Once no audio has come for `IDLE_MS`, each
   * beat sends one 320 ms chunk: first what waits, padded with silence, then
   * silence — but silence only while what has gone up since the leg went
   * live (320 ms a chunk, whatever it holds) is not ahead of the time since:
   * silence never takes the stream more than a chunk past real time, however
   * many releases pad a chunk. Audio that resumes between beats starts a
   * chunk of its own (what waited went up when the idle began), so no
   * silence is spliced into speech; the next beat finds the audio recent and
   * sends nothing. A push-to-talk release is idle from the next beat, no
   * `IDLE_MS` wait: no audio follows a release. A beat a throttled page could
   * not keep is skipped, not caught up, and a wall clock stepped back rebases
   * the wait and the stream's own clock, as `every()` rebases its grid
   * (choice 7). Framed on the transitions only.
   */
  private keepalive(): void {
    if (this.phase !== 'live') return;
    const now = this.request.clock.now();
    // A wall clock stepped back (`realClock.now()` is `Date.now()`): the stream's time since it began, and the idle wait, carry on from where they were.
    if (now < this.lastBeatAt) this.streamFrom -= this.lastBeatAt - now;
    this.lastBeatAt = now;
    if (now < this.lastAudioAt) this.lastAudioAt = now;
    const since = now - this.lastAudioAt;
    if (since < IDLE_MS && !this.released) return;
    if (!this.idle) {
      this.idle = true;
      this.frame('out', 'audio.idle', { sinceMs: since });
      const rest = this.chunks.flush();
      if (rest) {
        this.sendAudio(rest.chunk);
        return;
      }
    }
    // Never past real time: a release's padded remainder, or a chunk audio resumed inside, may already cover this beat.
    if (this.streamedMs > now - this.streamFrom) return;
    this.sendChunk(silence());
  }

  /**
   * A release, with or without speech (rulings 3, 5): what waits goes up at
   * once, padded to a chunk, and the idle rule's silence confirms the
   * sentence at the threshold — from the next beat, since the runner sends
   * no audio between presses (choice 7). Nothing on Palabra's wire ends an
   * utterance sooner: `interrupt_task` did not stop the sentence under way,
   * and delayed the next (the owner's probe). What a press sent cannot be
   * taken back.
   */
  private flushTurn(cancelled: boolean): void {
    if (this.phase !== 'live' || this.request.context.turns !== 'manual') return;
    const rest = this.chunks.flush();
    if (rest) this.sendAudio(rest.chunk);
    this.frame('out', 'turn.flush', { ms: rest ? Math.round((rest.samples * 1000) / SAMPLE_RATE) : 0, ...(cancelled ? { cancelled: true } : {}) });
    this.released = true;
  }

  private sendAudio(chunk: Int16Array): void {
    this.sendChunk(inputAudio(chunk));
  }

  /** A chunk up, counted on the stream's own clock when it went. */
  private sendChunk(frame: string): void {
    if (this.send(frame)) this.streamedMs += CHUNK_MS;
  }

  /** A frame, or a chunk of speech, that will not read: a Logs line, and `parse_error` on each latch's ok → failing transition only. */
  private unreadable(latch: 'frame' | 'audio', error: unknown): void {
    if (latch === 'frame' ? !this.readable : !this.audioReadable) return;
    if (latch === 'frame') this.readable = false;
    else this.audioReadable = false;
    this.frame('in', 'session.unreadable', { message: describeCause(error) });
    if (this.phase === 'live') this.events.degraded({ code: 'parse_error', message: `A message from Palabra could not be read: ${describeCause(error)}`, cause: error });
  }

  /** The last mid-session error, when the close follows it within `ERROR_WORDS_MS`; a negative age — a wall clock stepped back — is not recent either. */
  private recentError(): { code: string; message: string } | null {
    const last = this.lastError;
    if (!last) return null;
    const age = this.request.clock.now() - last.at;
    if (age < 0 || age > ERROR_WORDS_MS) return null;
    return { code: last.code, message: last.message };
  }

  /** What goes up, when the socket is open; nothing on a closed one. True when it went up: only what went up is framed. */
  private send(data: string): boolean {
    if (!this.socket || this.socket.readyState !== WS_OPEN) return false;
    this.socket.send(data);
    return true;
  }

  private onClose(e: CloseEvent, path: 'key' | 'session'): void {
    if (this.phase === 'ended') return;
    this.frame('in', 'session.connection_lost', { code: e.code, reason: e.reason });
    if (this.phase !== 'live') {
      // A browser cannot see the upgrade's status: the platform key's refused upgrade is a bare 403 (the owner's probe); the app pair's token is fresh.
      const offline = !this.deps.online();
      this.refuse(this.opened
        ? e.code === POLICY_VIOLATION
          ? new AdapterStartError(RATE_LIMITED, 'rate_limit')
          : new AdapterStartError(`Palabra closed the connection before the task started (${closeWords(e)}).`, 'server')
        : offline
          ? new AdapterStartError(OFFLINE, 'network')
          : path === 'key'
            ? new AdapterStartError(REFUSED_UPGRADE, 'auth')
            : new AdapterStartError(NEVER_OPENED, 'network'));
      return;
    }
    // A close right after an error reads in its words — `SERVICE_TIMEOUT`'s 1008 among them; a bare 1008 is the connection limit; any other close, the lost connection (rulings 11, 12). Nothing reconnects.
    this.end(this.recentError() ?? (e.code === POLICY_VIOLATION
      ? { code: 'rate_limit', message: RATE_LIMITED }
      : { code: 'connection_lost', message: `The connection to Palabra closed (${closeWords(e)}).` }));
  }

  /** A start that will not resolve: rejected once, everything shut, nothing emitted but frames. */
  private refuse(error: unknown): void {
    if (this.phase === 'live' || this.phase === 'ended') return;
    this.shutDown();
    const settle = this.settle;
    this.settle = null;
    settle?.reject(error);
  }

  /** A session that ends by itself: said once, then nothing (the kit's `ended-silence`). */
  private end(failed: { code: string; message: string }): void {
    if (this.phase !== 'live') return;
    this.shutDown();
    this.events.failed(failed);
  }

  /**
   * Every way a leg ends: nothing more emitted, the socket closed and no
   * longer heard, a REST session deleted. A create still in flight is left
   * to land on its own bound, and what it made is deleted then (choice 9):
   * its bound, and the delete's, are the only timers an ending leaves.
   */
  private shutDown(): void {
    this.phase = 'ended';
    this.stopKeepalive();
    this.cancelPoll();
    this.items.stop();
    const socket = this.socket;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState <= WS_OPEN) socket.close(1000);
    }
    this.release();
  }

  /**
   * Deletes the REST session this leg created, once (ruling 1): its own id
   * alone, bounded by `RELEASE_TIMEOUT_MS`, with `keepalive` so a page that is
   * going away still sends it. The request goes out before any `await`. Not
   * framed: it may run after the session has ended.
   */
  private release(): void {
    if (!this.sessionId || this.releasing) return;
    const controller = new AbortController();
    const cancel = this.request.clock.setTimeout(() => controller.abort(), RELEASE_TIMEOUT_MS);
    let sent: Promise<unknown>;
    try {
      sent = this.deps.fetch(sessionDeleteUrl(this.sessionId), { method: 'DELETE', headers: restHeaders(this.request.credentials), keepalive: true, signal: controller.signal });
    } catch (error) {
      sent = Promise.reject(error);
    }
    // A delete that failed leaves the session to expire on its own [inf: the docs say only that `expires_at` is extended every minute while a connection is active].
    this.releasing = sent.then(() => undefined, () => undefined).then(() => cancel());
  }

  private frame(direction: 'in' | 'out', type: string, payload?: unknown): void {
    if (this.phase === 'ended') return;
    this.events.frame(payload === undefined ? { direction, type } : { direction, type, payload: framePayload(payload) });
  }
}

export function createPalabraAdapter(deps: Partial<PalabraAdapterDeps> = {}): Adapter<PalabraConfig, PalabraCredentials> {
  const resolved: PalabraAdapterDeps = {
    openSocket: deps.openSocket ?? nativeSocket,
    // Read at call time, so a test's stubbed global is seen.
    fetch: deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)),
    newId: deps.newId ?? (() => crypto.randomUUID().replace(/-/g, '')),
    online: deps.online ?? (() => navigator.onLine !== false),
  };
  return {
    start(request, events) {
      // An aborted start opens nothing.
      if (request.signal.aborted) return Promise.reject(request.signal.reason ?? new Error('aborted'));
      return new PalabraLeg(request, events, resolved).opening;
    },
  };
}
