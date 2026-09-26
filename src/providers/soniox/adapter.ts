/**
 * Soniox on the new contract (spec: "L0 — the client contract"), ported
 * from `SonioxClient` (`src/services/clients/SonioxClient.ts`, still
 * compiled for the managed twin) without its display bookkeeping: items,
 * ids, the punctuation lane and the notices are L1's and L2's now.
 * `SonioxCore` runs one STT socket; each speaking leg has its own
 * `LegSpeech`. Every timer reads the request's clock, and nothing is said
 * but through events (CLAUDE.md, "Inside an IClient session").
 */
import {
  AdapterStartError,
  SAMPLE_RATE,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type SessionContext,
  type StartRequest,
} from '../../lib/contract/adapter';
import { framePayload } from '../../lib/contract/framePayload';
import type { LegName } from '../../lib/conversation/types';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { AUTO } from '../../lib/provider/languages';
import { nativeSocket, type OpenSocket } from './socket';
import { LegSpeech } from './speech';
import { SonioxSttStream, type SonioxSttConfig, type SonioxSttMessage } from './sttStream';
import { tokenFrames, Utterances } from './utterances';
import type { SonioxConfig } from './config';
import type { SonioxCredentials } from './settings';

/** The first resume attempt at once, then after 1 s and after 3 s (`SonioxClient.ts:649`). */
export const RESUME_DELAYS_MS: readonly number[] = [0, 1_000, 3_000];
/** At most this many 503 resumes per session (`SonioxClient.ts:248`): past it a 503 is an outage. */
export const MAX_RESUME_CYCLES = 5;
/** Failures the user did not cause and cannot fix in Settings — start again (`SonioxClient.ts:57`). */
const RECOVERABLE = new Set(['503', '408', 'socket_error']);

/** An STT error as the run's API error type (choice 8): its words are `notices.<type>`, the server's own as the detail. */
export function sttFailureCode(code: string): 'auth' | 'rate_limit' | 'client' | 'server' {
  const n = Number(code);
  if (n === 401 || n === 403) return 'auth';
  if (n === 429) return 'rate_limit';
  if (n >= 400 && n < 500) return 'client';
  return 'server';
}

export interface SonioxAdapterDeps {
  /** `new WebSocket(url)` in the app; a `FakeSocket` factory in tests. */
  openSocket: OpenSocket;
}

/** One leg a core serves: its events, its direction, and its speech when it speaks. */
interface CoreLeg {
  name: LegName;
  events: AdapterEvents;
  context: SessionContext;
  speech: LegSpeech | null;
  /** Asked to speak but issued no TTS key (a managed text-only lease): said once the start resolves. */
  noTtsKey: boolean;
}

function coreLeg(name: LegName, request: StartRequest<SonioxConfig, SonioxCredentials>, events: AdapterEvents, openSocket: OpenSocket): CoreLeg {
  const tts = request.config.tts;
  const key = request.credentials.tts;
  const speech = tts && key
    ? new LegSpeech({ region: request.credentials.region, key, clientReferenceId: request.credentials.clientReferenceId, voice: tts.voice, speed: tts.speed, events, clock: request.clock, openSocket })
    : null;
  return { name, events, context: request.context, speech, noTtsKey: tts !== undefined && !key };
}

interface CoreOptions {
  /** The request whose socket, key, clock and signal the core runs on. */
  primary: StartRequest<SonioxConfig, SonioxCredentials>;
  /** The legs it serves, the socket's own first. */
  legs: readonly CoreLeg[];
  openSocket: OpenSocket;
}

class SonioxCore {
  private ended = false;
  private stt: SonioxSttStream | null = null;
  private readonly utterances: Utterances;
  private readonly cancels = new Set<() => void>();
  private resumeCycles = 0;
  private pendingResume: string | null = null;
  private pendingCutoff = false;
  private readable = true;

  constructor(private readonly o: CoreOptions) {
    this.utterances = new Utterances({
      clock: o.primary.clock,
      sink: {
        segment: (leg, event) => { if (!this.ended) (this.leg(leg).events[event.kind] as (payload: unknown) => void)(event.payload); },
        speak: (leg, ref, text, span, language) => { if (!this.ended) this.leg(leg).speech?.speak(ref, text, span, language); },
        endSpeech: (leg) => { if (!this.ended) this.leg(leg).speech?.endUtterance(); },
      },
      legFor: (token) => this.legFor(token),
      targetFor: (leg) => this.leg(leg).context.direction.target,
    });
  }

  /** Opens the STT socket and each speaking leg's TTS socket at once; rejects, opening nothing, when the STT socket cannot open or the signal aborts. */
  open(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason ?? new Error('aborted'));
        return;
      }
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        this.shutdown();
        reject(error);
      };
      const onAbort = () => fail(signal.reason ?? new Error('aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      const stt = this.newStt();
      this.stt = stt;
      // A speech's open never rejects: a TTS socket that cannot open is retried on the first text (ruling 3).
      Promise.all([stt.connect(this.sttConfig()), ...this.o.legs.map((leg) => leg.speech?.open())]).then(
        () => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          this.opened();
          resolve();
        },
        (error: unknown) => fail(new AdapterStartError(
          `Soniox did not open the connection: ${describeCause(error)}`, 'network', { detail: describeCause(error) }, { cause: error },
        )),
      );
    });
  }

  /** A leg's view of the core. */
  session(name: LegName): AdapterSession {
    return {
      info: { transport: 'websocket' },
      appendAudio: (pcm) => this.appendAudio(name, pcm),
      // Soniox's STT socket takes no text (`textInput: false`).
      appendText: () => {},
      beginTurn: () => {},
      endTurn: () => this.endTurn(name),
      // A press with no voice sent nothing; what the server still decodes closes on its own endpoint.
      cancelTurn: () => {},
      stop: () => this.stop(),
    };
  }

  /** Closes every socket before returning (the `stop()` rule); idempotent. */
  stop(): Promise<void> {
    this.shutdown();
    return Promise.resolve();
  }

  private leg(name: LegName): CoreLeg {
    return this.o.legs.find((l) => l.name === name) ?? this.o.legs[0];
  }

  /** Which leg an utterance belongs to: one leg's core has one answer. */
  private legFor(_token: unknown): LegName {
    return this.o.legs[0].name;
  }

  private appendAudio(_name: LegName, pcm: Int16Array): void {
    if (!this.ended) this.stt?.sendAudio(pcm);
  }

  /** Manual turns end with `finalize` (ruling 5); the socket's own leg holds the key. */
  private endTurn(name: LegName): void {
    if (this.ended || name !== this.o.legs[0].name || !this.stt?.isOpen()) return;
    this.stt.finalize();
    this.frame('out', 'stt.finalize');
  }

  /** The STT config frame: a pure function of the request, so a resume sends it byte for byte again. */
  private sttConfig(): SonioxSttConfig {
    const { context, config, credentials } = this.o.primary;
    const { source, target } = context.direction;
    return {
      apiKey: credentials.stt,
      region: credentials.region,
      model: config.stt.model,
      sampleRate: SAMPLE_RATE,
      translation: { type: 'one_way', target_language: target },
      ...(source !== AUTO ? { languageHints: [source] } : {}),
      ...(config.stt.context ? { context: config.stt.context } : {}),
      endpointSensitivity: config.stt.endpointSensitivity,
      endpointLatencyAdjustmentLevel: config.stt.endpointLatencyAdjustmentLevel,
      endpointMaxDelayMs: config.stt.endpointMaxDelayMs,
      ...(credentials.clientReferenceId ? { clientReferenceId: credentials.clientReferenceId } : {}),
    };
  }

  private opened(): void {
    const config = this.sttConfig();
    this.frame('out', 'session.opened', { region: config.region, translation: config.translation, speaking: this.o.legs.filter((l) => l.speech).map((l) => l.name) });
    // Once the start has resolved: a start that failed owes no notice.
    queueMicrotask(() => {
      for (const leg of this.o.legs) {
        if (leg.noTtsKey && !this.ended) leg.events.degraded({ code: 'tts_degraded', message: 'No TTS key was issued for this leg: it runs text-only.' });
      }
    });
  }

  private newStt(): SonioxSttStream {
    const stream = new SonioxSttStream({ clock: this.o.primary.clock, openSocket: this.o.openSocket });
    let first = true;
    // A socket this core has moved on from (a resume, a stop) is heard no more: its identity replaces the old generation counter.
    const current = () => !this.ended && stream === this.stt;
    stream.setHandlers({
      onMessage: (message) => {
        if (!current()) return;
        if (first) {
          first = false;
          this.o.primary.credentials.lease?.streamAccepted();
        }
        this.readable = true;
        this.onMessage(message);
      },
      onError: (code, message) => { if (current()) this.onError(code, message); },
      onClose: (event) => { if (current()) this.onClose(event); },
      onUnreadable: (error) => {
        // The Logs only, on the ok → failing transition (choice 7): never a notice.
        if (!current() || !this.readable) return;
        this.readable = false;
        this.frame('in', 'stt.unreadable', { message: describeCause(error) });
      },
    });
    return stream;
  }

  private onMessage(message: SonioxSttMessage): void {
    const tokens = message.tokens ?? [];
    for (const f of tokenFrames(tokens)) this.frame(f.direction, f.type, f.payload);
    this.utterances.message(tokens);
  }

  private onError(code: string, message: string): void {
    const lease = this.o.primary.credentials.lease;
    if (lease && code === '403' && lease.atGrantEnd(this.o.primary.clock.now())) {
      // The granted duration ended (managed): the close that follows ends the leg without an error (Plan B's seam).
      this.pendingCutoff = true;
      return;
    }
    if (!lease && code === '503' && this.resumeCycles < MAX_RESUME_CYCLES) {
      // An own key only: a managed key is single-use and a reconnect with it is refused (`SonioxClient.ts:1336-1348`).
      this.resumeCycles += 1;
      this.pendingResume = message;
      this.frame('in', 'session.stt_503', { message, cycle: this.resumeCycles });
      return;
    }
    if (RECOVERABLE.has(code)) {
      this.fail('connection_lost', `The Soniox connection was lost (${code}${message ? `: ${message}` : ''}).`);
      return;
    }
    this.fail(sttFailureCode(code), `[Soniox ${code}] ${message}`);
  }

  private onClose(event: { code?: number; reason?: string }): void {
    if (this.pendingCutoff) {
      this.pendingCutoff = false;
      this.o.primary.credentials.lease?.cutoff();
      this.frame('in', 'session.duration_cutoff', { code: event.code, reason: event.reason });
      for (const leg of this.o.legs) {
        if (this.ended) break;
        leg.events.closed({ reason: 'The granted session time ended.' });
      }
      this.shutdown();
      return;
    }
    if (this.pendingResume !== null) {
      const original = this.pendingResume;
      this.pendingResume = null;
      this.stt = null;
      void this.resume(original);
      return;
    }
    // A close with nothing said before it: a network drop, or the server going away.
    this.fail('connection_lost', event.reason || `The Soniox connection closed unexpectedly (${event.code ?? 'no code'}).`);
  }

  /** The own-key 503 ladder (ruling 3): the utterance in flight closes as it stands; the TTS socket carries on. */
  private async resume(original: string): Promise<void> {
    this.frame('in', 'session.stt_resuming');
    for (const leg of this.o.legs) leg.events.reconnecting();
    this.utterances.abandon();
    for (const delay of RESUME_DELAYS_MS) {
      if (delay > 0) await this.wait(delay);
      if (this.ended) return;
      const stream = this.newStt();
      this.stt = stream;
      try {
        await stream.connect(this.sttConfig());
        if (this.ended) return;
        this.frame('in', 'session.stt_resumed');
        for (const leg of this.o.legs) leg.events.reconnected();
        return;
      } catch (error) {
        if (this.ended) return;
        this.stt = null;
        // The Logs only (choice 6): the leg already shows reconnecting.
        this.frame('in', 'session.stt_resume_attempt_failed', { message: describeCause(error) });
      }
    }
    this.frame('in', 'session.stt_resume_failed', { message: original });
    this.fail('connection_lost', `Soniox 503: ${original}`);
  }

  /** Resolves after `ms` on the clock, or at once when the core stops. */
  private wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const cancelTimer = this.o.primary.clock.setTimeout(() => {
        this.cancels.delete(onStop);
        resolve();
      }, ms);
      const onStop = () => {
        cancelTimer();
        resolve();
      };
      this.cancels.add(onStop);
    });
  }

  private fail(code: string, message: string): void {
    if (this.ended) return;
    if (code === 'connection_lost') this.frame('in', 'session.connection_lost', { message });
    for (const leg of this.o.legs) {
      if (this.ended) break;
      leg.events.failed({ code, message });
    }
    this.shutdown();
  }

  private shutdown(): void {
    if (this.ended) return;
    this.ended = true;
    for (const cancel of this.cancels) cancel();
    this.cancels.clear();
    this.utterances.stop();
    const stt = this.stt;
    this.stt = null;
    // The empty text frame ends the stream (`SonioxClient.ts:1540-1589`); its trailing tokens are not awaited.
    stt?.end();
    stt?.close();
    for (const leg of this.o.legs) leg.speech?.close();
  }

  private frame(direction: 'in' | 'out', type: string, payload?: unknown): void {
    if (!this.ended) this.o.legs[0].events.frame({ direction, type, ...(payload === undefined ? {} : { payload: framePayload(payload) }) });
  }
}

export function createSonioxAdapter(deps: Partial<SonioxAdapterDeps> = {}): Adapter<SonioxConfig, SonioxCredentials> {
  const openSocket = deps.openSocket ?? nativeSocket;
  return {
    async start(request, events) {
      if (request.signal.aborted) throw request.signal.reason ?? new Error('aborted');
      // One leg: the core's name for it is its own; the runner knows which leg these events are.
      const core = new SonioxCore({ primary: request, legs: [coreLeg('speaker', request, events, openSocket)], openSocket });
      await core.open(request.signal);
      return core.session('speaker');
    },
  };
}
