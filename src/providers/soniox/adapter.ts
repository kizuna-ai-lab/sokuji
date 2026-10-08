/**
 * Soniox on the new contract (spec: "L0 — the client contract"), ported
 * from `SonioxClient` (`src/services/clients/SonioxClient.ts`, deleted
 * since) without its display bookkeeping: items,
 * ids, the punctuation lane and the notices are L1's and L2's now.
 * `SonioxCore` runs one STT socket; each speaking leg has its own
 * `LegSpeech`. Both mode (`startBoth`, D23) is two single-leg cores, or one
 * core whose socket carries both legs mixed. Every timer reads the
 * request's clock, and nothing is said but through events (CLAUDE.md,
 * "Inside an adapter session").
 */
import {
  AdapterStartError,
  LegStartError,
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
import { PcmMixer } from './pcmMixer';
import { SonioxSideTracker } from './sideTracker';
import { nativeSocket, type OpenSocket } from './socket';
import { LegSpeech } from './speech';
import { SonioxSttStream, type SonioxSttConfig, type SonioxSttMessage, type SonioxToken } from './sttStream';
import { tokenFrames, Utterances, type SegmentEvent } from './utterances';
import type { SonioxConfig } from './config';
import { sonioxWire } from './languages';
import type { SonioxCredentials } from './settings';

/** A token as the app reads it: its languages in app codes, a language outside the table dropped (unified language codes). */
function inAppCodes(token: SonioxToken): SonioxToken {
  const language = sonioxWire.fromWire(token.language);
  const sourceLanguage = sonioxWire.fromWire(token.source_language);
  const { language: _l, source_language: _s, ...rest } = token;
  return { ...rest, ...(language ? { language } : {}), ...(sourceLanguage ? { source_language: sourceLanguage } : {}) };
}

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

/** One segment event to its leg, called on its own events object with its payload's own type. */
function emitSegment(events: AdapterEvents, event: SegmentEvent): void {
  switch (event.kind) {
    case 'segmentOpened': events.segmentOpened(event.payload); break;
    case 'segmentText': events.segmentText(event.payload); break;
    case 'segmentClosed': events.segmentClosed(event.payload); break;
    default: {
      // A kind added to `SegmentEvent` must be routed here: unhandled, it would be dropped without a word.
      const unhandled: never = event;
      void unhandled;
    }
  }
}

/** Face-to-face's sides are its two people: a diarization label would only ever name a phantom (spec, slice 3). */
function withoutPerson(event: SegmentEvent): SegmentEvent {
  if (event.kind === 'segmentClosed' || !('person' in event.payload)) return event;
  const { person: _person, ...payload } = event.payload;
  return { ...event, payload } as SegmentEvent;
}

function coreLeg(name: LegName, request: StartRequest<SonioxConfig, SonioxCredentials>, events: AdapterEvents, openSocket: OpenSocket): CoreLeg {
  const tts = request.config.tts;
  const key = request.credentials.tts;
  const speech = tts && key
    ? new LegSpeech({ region: request.credentials.region, key, clientReferenceId: request.credentials.clientReferenceId, voice: name === 'participant' ? tts.participantVoice : tts.voice, speed: tts.speed, events, clock: request.clock, openSocket })
    : null;
  return { name, events, context: request.context, speech, noTtsKey: tts !== undefined && !key };
}

interface CoreOptions {
  /** The request whose socket, key, clock and signal the core runs on. */
  primary: StartRequest<SonioxConfig, SonioxCredentials>;
  /** The legs it serves, the socket's own first. */
  legs: readonly CoreLeg[];
  openSocket: OpenSocket;
  /** Shared Both (D23): both legs' audio mixed onto this one socket, each utterance given to the leg the side tracker names. */
  shared?: true;
  /** Face-to-face (slice 3): one microphone, so the tracker votes by language, and no person label leaves the core. */
  faceToFace?: true;
}

class SonioxCore {
  private ended = false;
  private stt: SonioxSttStream | null = null;
  private readonly utterances: Utterances;
  private readonly cancels = new Set<() => void>();
  private resumeCycles = 0;
  private pendingResume: string | null = null;
  private pendingCutoff = false;
  /** Shared Both only: which side an utterance is (`sideTracker.ts`), fed by the frames actually sent. */
  private readonly tracker: SonioxSideTracker | null;
  /** Shared Both only: the speaker as channel A, the participant as B, 100-ms frames at 0.5 gain (`SonioxClient.ts:400-417`). */
  private readonly mixer: PcmMixer | null;

  constructor(private readonly o: CoreOptions) {
    this.tracker = o.shared ? new SonioxSideTracker({ energy: !o.faceToFace }) : null;
    this.mixer = o.shared
      ? new PcmMixer({
        clock: o.primary.clock,
        frameSamples: SAMPLE_RATE / 10,
        intervalMs: 100,
        maxBacklogSamples: SAMPLE_RATE * 2,
        // Energy only for frames actually sent: the tracker's frame index must match the server's `start_ms`.
        onFrame: (mixed, energyA, energyB) => {
          if (!this.stt?.isOpen()) return;
          this.stt.sendAudio(mixed);
          this.tracker?.recordFrame(energyA, energyB);
        },
      })
      : null;
    this.utterances = new Utterances({
      clock: o.primary.clock,
      sink: {
        segment: (leg, event) => { if (!this.ended) emitSegment(this.leg(leg).events, this.o.faceToFace ? withoutPerson(event) : event); },
        speak: (leg, ref, text, span, language) => { if (!this.ended) this.leg(leg).speech?.speak(ref, text, span, sonioxWire.toWire(language)); },
        endSpeech: (leg) => { if (!this.ended) this.leg(leg).speech?.endUtterance(); },
      },
      legFor: (token) => this.legFor(token),
      targetFor: (leg) => this.leg(leg).context.direction.target,
    });
  }

  /**
   * Opens the STT socket and each speaking leg's TTS socket at once, and
   * resolves when the STT socket is open; rejects, opening nothing, when it
   * cannot open or the signal aborts. The TTS sockets are not awaited: every
   * STT frame — a bad key's error, a 503 — then lands after the start
   * resolved, so a failing start only ever rejects (the kit's rule). Awaiting
   * them would let an STT error that beats a TTS handshake say `failed`
   * while the start is still pending.
   */
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
      const connecting = stt.connect(this.sttConfig());
      // Opened here, before the STT socket can deliver a word, so no `speak()`
      // comes first; never awaited. A speech's open never rejects (a TTS socket
      // that cannot open is retried on the first text: ruling 3), text that
      // arrives first waits for its socket, and `close()` reaches a socket
      // still opening.
      for (const leg of this.o.legs) void leg.speech?.open();
      connecting.then(
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

  /** Closes every socket before returning (the `stop()` rule); idempotent. The one graceful ending: the STT stream's end goes first. */
  stop(): Promise<void> {
    this.shutdown(true);
    return Promise.resolve();
  }

  private leg(name: LegName): CoreLeg {
    return this.o.legs.find((l) => l.name === name) ?? this.o.legs[0];
  }

  /** Which leg an utterance belongs to, from its first token: one leg's core has one answer. */
  private legFor(token: SonioxToken): LegName {
    if (!this.tracker) return this.o.legs[0].name;
    const { source, target } = this.o.primary.context.direction;
    // The language, as a witness (the token is in app codes by now, as the pair is): face-to-face's tracker votes with it; the energy tracker ignores it.
    const language = token.translation_status === 'translation' ? token.source_language : token.language;
    // Face-to-face: a language that is neither side's names nobody and casts no vote.
    const witness = !language ? null
      : language === source ? 'speaker'
      : this.o.faceToFace && language !== target ? null
      : 'participant';
    // An established speaker label, else the channels' energy (or, face-to-face, the language) over the token's window (`SonioxClient.ts:982-998`).
    const evidence = this.tracker.inferSide(token.speaker, token.start_ms, token.end_ms, witness);
    if (evidence) return evidence.side;
    // The language, which never votes in the energy tracker; the speaker's leg when nothing can tell.
    // Latched at this first token: the diarization design's accepted limitation
    // (docs/superpowers/specs/2026-07-30-soniox-diarization-attribution-design.md, "decided once per utterance").
    return witness ?? 'speaker';
  }

  private appendAudio(name: LegName, pcm: Int16Array): void {
    if (this.ended) return;
    if (this.mixer) {
      if (name === 'participant') this.mixer.pushB(pcm);
      else this.mixer.pushA(pcm);
      return;
    }
    this.stt?.sendAudio(pcm);
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
    // Both languages bias recognition, the source first; an auto source hints nothing, since the target alone would pull an unknown speaker toward the other side.
    const hints = source === AUTO ? [] : [...new Set([sonioxWire.toWire(source), sonioxWire.toWire(target)])];
    return {
      apiKey: credentials.stt,
      region: credentials.region,
      model: config.stt.model,
      sampleRate: SAMPLE_RATE,
      translation: this.o.shared ? { type: 'two_way', language_a: sonioxWire.toWire(source), language_b: sonioxWire.toWire(target) } : { type: 'one_way', target_language: sonioxWire.toWire(target) },
      // D20 keeps an auto source out of Both: the gate refuses the participant leg.
      ...(hints.length ? { languageHints: hints } : {}),
      // The shared socket always labels its people; the participant's own one-way socket does too.
      ...(this.o.shared || config.diarize ? { enableSpeakerDiarization: true } : {}),
      ...(config.stt.context ? { context: config.stt.context } : {}),
      endpointSensitivity: config.stt.endpointSensitivity,
      endpointLatencyAdjustmentLevel: config.stt.endpointLatencyAdjustmentLevel,
      endpointMaxDelayMs: config.stt.endpointMaxDelayMs,
      ...(credentials.clientReferenceId ? { clientReferenceId: credentials.clientReferenceId } : {}),
    };
  }

  private opened(): void {
    this.mixer?.start();
    const config = this.sttConfig();
    this.frame('out', 'session.opened', { region: config.region, translation: config.translation, speaking: this.o.legs.filter((l) => l.speech).map((l) => l.name) });
    // Once the start can no longer fail — the STT socket is open and `open()`
    // has settled — so a start that failed owes no notice. It lands just
    // before the caller's `await` resumes; the runner applies an event that
    // comes before the session (`run.ts` `onEvent`).
    queueMicrotask(() => {
      for (const leg of this.o.legs) {
        if (leg.noTtsKey && !this.ended) leg.events.degraded({ code: 'tts_degraded', message: 'No TTS key was issued for this leg: it runs text-only.' });
      }
    });
  }

  private newStt(): SonioxSttStream {
    const stream = new SonioxSttStream({ clock: this.o.primary.clock, openSocket: this.o.openSocket });
    let first = true;
    // Per socket: a resumed socket starts readable, whatever episode the one before it was in.
    let readable = true;
    // A socket this core has moved on from (a resume, a stop) is heard no more: its identity replaces the old generation counter.
    const current = () => !this.ended && stream === this.stt;
    stream.setHandlers({
      onMessage: (message) => {
        if (!current()) return;
        if (first) {
          first = false;
          this.o.primary.credentials.lease?.streamAccepted();
        }
        readable = true;
        this.onMessage(message);
      },
      onError: (code, message) => { if (current()) this.onError(code, message); },
      onClose: (event) => { if (current()) this.onClose(event); },
      onUnreadable: (error) => {
        // The Logs only, on the ok → failing transition (choice 7): never a notice.
        if (!current() || !readable) return;
        readable = false;
        this.frame('in', 'stt.unreadable', { message: describeCause(error) });
      },
    });
    return stream;
  }

  private onMessage(message: SonioxSttMessage): void {
    const raw = message.tokens ?? [];
    for (const f of tokenFrames(raw)) this.frame(f.direction, f.type, f.payload);
    this.utterances.message(raw.map(inAppCodes));
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
      this.lost(code, message, `The Soniox connection was lost (${code}${message ? `: ${message}` : ''}).`);
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
      void this.resume(original, event);
      return;
    }
    // A close with nothing said before it: a network drop, or the server going away.
    this.lost(
      String(event.code ?? 'socket_closed'),
      event.reason || 'The Soniox connection closed unexpectedly',
      event.reason || `The Soniox connection closed unexpectedly (${event.code ?? 'no code'}).`,
    );
  }

  /** The own-key 503 ladder (ruling 3): the utterance in flight closes as it stands; the TTS socket carries on. */
  private async resume(original: string, close: { code?: number; reason?: string }): Promise<void> {
    // The close that started it, as the old row carried it (choice 16; `SonioxClient.ts:604`).
    this.frame('in', 'session.stt_resuming', { code: close.code, reason: close.reason });
    for (const leg of this.o.legs) leg.events.reconnecting();
    this.utterances.abandon();
    // The new socket restarts the server's audio clock and mints its own speaker labels (`SonioxClient.ts:646-647`).
    this.tracker?.reset();
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
    this.lost('503', original, `Soniox 503: ${original}`);
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

  /**
   * The recoverable outage (`surfaceRecoverableOutage`, `SonioxClient.ts:1422`):
   * the Logs row keeps the wire's code and the server's own words, as the old
   * one did (choice 16); the leg fails with `connection_lost` (choice 8).
   */
  private lost(wireCode: string, words: string, message: string): void {
    if (this.ended) return;
    this.frame('in', 'session.connection_lost', { code: wireCode, message: words });
    this.fail('connection_lost', message);
  }

  private fail(code: string, message: string): void {
    if (this.ended) return;
    for (const leg of this.o.legs) {
      if (this.ended) break;
      leg.events.failed({ code, message });
    }
    this.shutdown();
  }

  /** Every way the core ends. `graceful` — a stop — ends the STT stream first; a failure says nothing more to a server that refused the session. */
  private shutdown(graceful = false): void {
    if (this.ended) return;
    this.ended = true;
    for (const cancel of this.cancels) cancel();
    this.cancels.clear();
    this.utterances.stop();
    this.mixer?.stop();
    const stt = this.stt;
    this.stt = null;
    // The empty text frame ends the stream (`SonioxClient.ts:1540-1589`); its
    // trailing tokens are not awaited. Framed as `stt.finalize` is, past the
    // core's own end: the ending's one line (Stage 2 session end, ruling 2 (ii); choice 8).
    if (graceful && stt?.isOpen()) {
      stt.end();
      this.o.legs[0].events.frame({ direction: 'out', type: 'stt.end' });
    }
    stt?.close();
    for (const leg of this.o.legs) leg.speech?.close();
  }

  private frame(direction: 'in' | 'out', type: string, payload?: unknown): void {
    if (!this.ended) this.o.legs[0].events.frame({ direction, type, ...(payload === undefined ? {} : { payload: framePayload(payload) }) });
  }
}

export type SonioxAdapter = Adapter<SonioxConfig, SonioxCredentials> & {
  startBoth(
    requests: Record<LegName, StartRequest<SonioxConfig, SonioxCredentials>>,
    events: Record<LegName, AdapterEvents>,
  ): Promise<Record<LegName, AdapterSession>>;
};

export function createSonioxAdapter(deps: Partial<SonioxAdapterDeps> = {}): SonioxAdapter {
  const openSocket = deps.openSocket ?? nativeSocket;
  /** One leg on its own core, named as the leg it is: what its Logs say (`session.opened`'s `speaking`). */
  const startLeg = async (name: LegName, request: StartRequest<SonioxConfig, SonioxCredentials>, events: AdapterEvents): Promise<AdapterSession> => {
    if (request.signal.aborted) throw request.signal.reason ?? new Error('aborted');
    const core = new SonioxCore({ primary: request, legs: [coreLeg(name, request, events, openSocket)], openSocket });
    await core.open(request.signal);
    return core.session(name);
  };
  // One leg: the core's name for it is its own; the runner knows which leg these events are.
  const start: SonioxAdapter['start'] = (request, events) => startLeg('speaker', request, events);

  /** Split Both: two ordinary sessions; one that fails stops the other and is named (D22). */
  const startSplit: SonioxAdapter['startBoth'] = async (requests, events) => {
    const legs: LegName[] = ['speaker', 'participant'];
    const settled = await Promise.allSettled(legs.map((leg) => startLeg(leg, requests[leg], events[leg])));
    const i = settled.findIndex((r) => r.status === 'rejected');
    if (i >= 0) {
      // Settled, so a stop that fails too never replaces the start's failure.
      await Promise.allSettled(settled.map((r) => (r.status === 'fulfilled' ? r.value.stop() : undefined)));
      const reason = (settled[i] as PromiseRejectedResult).reason;
      if (requests.speaker.signal.aborted) throw reason;
      throw new LegStartError(legs[i], reason);
    }
    const [speaker, participant] = settled.map((r) => (r as PromiseFulfilledResult<AdapterSession>).value);
    return { speaker, participant };
  };

  return {
    start,
    async startBoth(requests, events) {
      const signal = requests.speaker.signal;
      if (signal.aborted) throw signal.reason ?? new Error('aborted');
      if (!requests.speaker.config.sharedBoth) return startSplit(requests, events);
      // Shared Both: one socket on the speaker's key; each leg speaks through its own TTS socket and key (ruling 4).
      const core = new SonioxCore({
        primary: requests.speaker,
        legs: [
          coreLeg('speaker', requests.speaker, events.speaker, openSocket),
          coreLeg('participant', requests.participant, events.participant, openSocket),
        ],
        openSocket,
        shared: true,
        ...(requests.speaker.config.faceToFace ? { faceToFace: true as const } : {}),
      });
      try {
        await core.open(signal);
      } catch (error) {
        if (signal.aborted) throw error;
        // The socket and its key are the speaker's; a participant's TTS that cannot open is only degraded speech.
        throw new LegStartError('speaker', error);
      }
      // Both facades stop the one core: either leg ending ends both (D21).
      return { speaker: core.session('speaker'), participant: core.session('participant') };
    },
  };
}
