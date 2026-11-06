/**
 * Soniox on the new contract (spec: "L0 — the client contract"), ported
 * from `SonioxClient` (`src/services/clients/SonioxClient.ts`, deleted
 * since) without its display bookkeeping: items,
 * ids, the punctuation lane and the notices are L1's and L2's now.
 * `SonioxCore` runs one STT socket; each speaking leg has its own
 * `LegSpeech`. Both mode (`startBoth`, D23) is two single-leg cores, or one
 * core whose socket carries both legs mixed. A socket that drops while live
 * comes back through the core's reconnector (spec 2026-11-05 reconnect §4),
 * one per core. Every timer reads the request's clock, and nothing is said
 * but through events (CLAUDE.md, "Inside an adapter session").
 */
import {
  AdapterStartError,
  LegStartError,
  SAMPLE_RATE,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type Ref,
  type SessionContext,
  type StartRequest,
} from '../../lib/contract/adapter';
import { every } from '../../lib/contract/clock';
import { framePayload } from '../../lib/contract/framePayload';
import type { LegName } from '../../lib/conversation/types';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { AUTO } from '../../lib/provider/languages';
import { closeCodeAction, createReconnector, refusalResult, reissueFailed, type AttemptResult, type DropInfo, type GiveUp, type Reconnector } from '../../lib/session/reconnect';
import { PcmMixer } from './pcmMixer';
import { SonioxSideTracker } from './sideTracker';
import { nativeSocket, type OpenSocket } from './socket';
import { LegSpeech } from './speech';
import { SonioxSttConnectTimeout, SonioxSttStream, type SonioxSttConfig, type SonioxSttMessage, type SonioxToken } from './sttStream';
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

/**
 * A live socket that sends nothing back for this long while audio goes out is
 * dead (spec 2026-11-05 reconnect §4.2, "about 5 s"). Measured on a real 263 s
 * managed Soniox session: the longest gap between server messages was 1071 ms
 * during speech and 1214 ms during silence (p99 912 and 1213 ms), so 5 s is
 * over four times the longest — plan Task 7, Step 1's max(5000, 2 × the
 * longest gap) keeps it.
 */
export const SONIOX_STALL_MS = 5_000;
/** How often the stall watchdog looks, and how recent our audio must be for the server's silence to count. */
const STALL_CHECK_MS = 1_000;
/** How long a reissued key may open a socket from when it was issued: the backend's start window. */
const REISSUED_KEY_WINDOW_MS = 10_000;
/** A managed key whose socket never opened serves the next attempt until this long before its window ends (§4.2). */
const KEY_EXPIRY_MARGIN_MS = 1_000;
/** Besides any 5xx, the failures the user did not cause and cannot fix in Settings (`SonioxClient.ts:57`): the socket reconnects. */
const RECONNECTS = new Set(['408', 'socket_error']);
/** A 429 whose words read as a used-up quota or balance is the user's to fix in their account, not a moment to wait out. */
const USED_UP = /quota|balance|billing|insufficient|payment|credit/i;
const LOST = 'connection_lost';
/** A give-up's words when no attempt said why (the session's reconnects used up). */
const LOST_WORDS = 'The Soniox connection was lost.';

/**
 * What a live socket's end means (spec 2026-11-05 reconnect §4.1): an error
 * frame by its code, else the close by its code. Soniox overloaded, failing
 * or timed out (any 5xx, a 408) reconnects. A 403 at the grant's end is the
 * managed session's granted time running out, not an error. A 429 reconnects
 * (the measured concurrency limit clears when another stream ends) unless its
 * `message` says a quota or balance is used up.
 */
export function sonioxDropAction(e: { error?: string; message?: string; close?: number; atGrantEnd: boolean }): 'reconnect' | 'cutoff' | 'end' {
  if (e.error === undefined) return closeCodeAction(e.close);
  if (e.error === '403' && e.atGrantEnd) return 'cutoff';
  if (e.error === '429') return USED_UP.test(e.message ?? '') ? 'end' : 'reconnect';
  const n = Number(e.error);
  return RECONNECTS.has(e.error) || (n >= 500 && n < 600) ? 'reconnect' : 'end';
}

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
  /** Its utterances carry their people (`config.diarize`). */
  labels: boolean;
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

/** Face-to-face's sides are its two people, and shared Both's speaker leg is me: a diarization label there would only ever name a phantom (spec, slice 3). A leg whose speaker labels are off carries none either. */
function withoutPerson(event: SegmentEvent): SegmentEvent {
  if (event.kind === 'segmentClosed' || !('person' in event.payload)) return event;
  const { person: _person, ...payload } = event.payload;
  return { ...event, payload } as SegmentEvent;
}

function coreLeg(name: LegName, request: StartRequest<SonioxConfig, SonioxCredentials>, events: AdapterEvents, openSocket: OpenSocket, counts?: Map<Ref, number>): CoreLeg {
  const tts = request.config.tts;
  const key = request.credentials.tts;
  const speech = tts && key
    ? new LegSpeech({ leg: name, region: request.credentials.region, key, clientReferenceId: request.credentials.clientReferenceId, voice: tts.voice, speed: tts.speed, events, clock: request.clock, openSocket, ...(counts ? { counts } : {}) })
    : null;
  return { name, events, context: request.context, speech, noTtsKey: tts !== undefined && !key, labels: request.config.diarize };
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

/** The STT key the next socket opens with: the request's, then each one the lease reissues. */
interface SttKey {
  stt: string;
  clientReferenceId?: string;
  /**
   * A reissued key's last moment to open a socket, on the request's clock: its
   * window counted from when the reissue answered, less the margin. Never the
   * answer's `expiresAt`, which is the server's clock: a client clock behind
   * it would keep a dead key. The request's own key carries none.
   */
  usableUntil?: number;
  /** A socket opened on it: a managed key is single-use. */
  spent: boolean;
}

class SonioxCore {
  private ended = false;
  private stt: SonioxSttStream | null = null;
  /** The socket whose first frame the lease was told of: it hears when that one ends. */
  private accepted: SonioxSttStream | null = null;
  private readonly utterances: Utterances;
  private pendingCutoff = false;
  private key: SttKey;
  private readonly reconnector: Reconnector;
  /** The drop the reconnector took up last: what a give-up reports with. */
  private drop: DropInfo | null = null;
  /** Why this drop's last attempt failed, in words: what the leg's failure says at a give-up. */
  private lastFailure: string | null = null;
  private stopStallWatch: (() => void) | null = null;
  /** When audio last went out on an open socket. */
  private lastAudioAt = -Infinity;
  /** What the server's silence counts from: the socket's open, its last frame, or our audio resuming after a pause. */
  private quietSince = 0;
  /** Shared Both only: which side an utterance is (`sideTracker.ts`), fed by the frames actually sent. */
  private readonly tracker: SonioxSideTracker | null;
  /** Shared Both only: the speaker as channel A, the participant as B, 100-ms frames at 0.5 gain (`SonioxClient.ts:400-417`). */
  private readonly mixer: PcmMixer | null;
  /** Per translation ref, the other legs reading it (shared Both, face-to-face): told when its speech ends. */
  private readonly abroad = new Map<Ref, Set<LegName>>();

  constructor(private readonly o: CoreOptions) {
    const { credentials, clock } = o.primary;
    this.key = { stt: credentials.stt, ...(credentials.clientReferenceId ? { clientReferenceId: credentials.clientReferenceId } : {}), spent: false };
    // Every leg of the core hears its one socket's reconnect: shared Both's two legs, a lone leg its own.
    this.reconnector = createReconnector({
      clock,
      frame: (type, payload) => this.frame('in', type, payload),
      reconnecting: (e) => this.toLegs((leg) => leg.events.reconnecting(e)),
      // Each leg's TTS socket is let go first: the blip that dropped the STT socket likely left it half-open (`LegSpeech.recycle`).
      reconnected: (e) => {
        for (const leg of o.legs) leg.speech?.recycle();
        this.toLegs((leg) => leg.events.reconnected(e));
      },
      gaveUp: (e) => this.gaveUp(e),
      attempt: ({ signal }) => this.attempt(signal),
    });
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
          this.audioSent();
          this.tracker?.recordFrame(energyA, energyB);
        },
      })
      : null;
    this.utterances = new Utterances({
      clock: o.primary.clock,
      sink: {
        // Shared Both's speaker leg is me: a second label there (a misattribution, a reconnect's new epoch) would only number me twice.
        // Only a shared core names its legs truly; a lone leg is always 'speaker' here, the other side's included.
        segment: (leg, event) => {
          if (this.ended) return;
          const core = this.leg(leg);
          emitSegment(core.events, !core.labels || this.o.faceToFace || (this.o.shared && leg === 'speaker') ? withoutPerson(event) : event);
        },
        speak: (leg, ref, text, span, language) => {
          if (this.ended) return;
          const core = this.leg(leg);
          const wire = sonioxWire.toWire(language);
          // A leg speaks into its own target. App codes on both sides.
          if (language === core.context.direction.target) {
            core.speech?.speak(ref, text, span, wire);
            return;
          }
          // Shared Both and face-to-face: a translation into the other leg's target (someone code-switched, a
          // tail of the last utterance that landed on this one) is read by that leg's voice, into its ear —
          // "route by the translation's language" (face-to-face design, D10). The row stays this leg's: the
          // audio and its ranges come back on this leg's events, naming that voice. A lone leg has nobody to hand it to.
          if (!this.o.shared) return;
          const other = this.o.legs.find((l) => l !== core && l.context.direction.target === language);
          if (!other?.speech) return;
          let abroad = this.abroad.get(ref);
          if (!abroad) {
            abroad = new Set();
            this.abroad.set(ref, abroad);
          }
          abroad.add(other.name);
          other.speech.speak(ref, text, span, wire, core.events);
        },
        endSpeech: (leg, ref) => {
          if (this.ended) return;
          this.leg(leg).speech?.endUtterance();
          // The legs that read this translation abroad end its utterance too, so their segments close now.
          const abroad = this.abroad.get(ref);
          if (!abroad) return;
          this.abroad.delete(ref);
          for (const name of abroad) this.leg(name).speech?.endUtterance();
        },
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
      const connect = (retried: boolean): void => {
        const stt = this.newStt();
        this.stt = stt;
        const key = this.key;
        stt.connect(this.sttConfig()).then(
          () => {
            key.spent = true;
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            this.opened();
            resolve();
          },
          (error: unknown) => {
            if (settled) return;
            // A connect with no answer most likely never reached Soniox, so its
            // single-use key is still unspent: one more try, before the start
            // fails and a new Start must buy keys again. If Soniox did take it,
            // the second try is refused and the start fails as it would have.
            if (!retried && error instanceof SonioxSttConnectTimeout) {
              this.frame('in', 'session.stt_connect_retry', { message: describeCause(error) });
              connect(true);
              return;
            }
            fail(new AdapterStartError(
              `Soniox did not open the connection: ${describeCause(error)}`, 'network', { detail: describeCause(error) }, { cause: error },
            ));
          },
        );
      };
      connect(false);
      // Opened here, before the STT socket can deliver a word, so no `speak()`
      // comes first; never awaited. A speech's open never rejects (a TTS socket
      // that cannot open is retried on the first text: ruling 3), text that
      // arrives first waits for its socket, and `close()` reaches a socket
      // still opening.
      for (const leg of this.o.legs) void leg.speech?.open();
    });
  }

  /** A leg's view of the core. Shared Both's two facades say they share the one connection (`info.shared`): the run counts its reconnects once. */
  session(name: LegName): AdapterSession {
    return {
      info: { transport: 'websocket', ...(this.o.shared ? { shared: true } : {}) },
      // Either facade wakes the core's one reconnector: a second wake for the same return only skips one backoff.
      networkRestored: () => this.reconnector.wake(),
      appendAudio: (pcm) => this.appendAudio(name, pcm),
      // Soniox's STT socket takes no text (`textInput: false`).
      appendText: () => {},
      beginTurn: () => {},
      endTurn: () => this.endTurn(name),
      // A press with no voice sent nothing; what the server still decodes closes on its own endpoint.
      cancelTurn: () => {},
      setSpeech: (on) => this.leg(name).speech?.setOn(on),
      stop: () => this.stop(),
      agentText: (text, endOfSegment) => this.agentText(text, endOfSegment),
    };
  }

  /** Agent text on the current STT socket, framed for the Logs when sent. False once ended and while no socket is up (a reconnect's new socket takes the next); the stream itself refuses a socket not opened for it. */
  private agentText(text: string, endOfSegment: boolean): boolean {
    if (this.ended || !this.stt) return false;
    const sent = this.stt.sendAgentText(text, endOfSegment);
    if (sent) this.frame('out', 'stt.agent_text', { text, end_of_segment: endOfSegment });
    return sent;
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
    // During a reconnect's gap no socket is open, and the audio is dropped (§4.3) — before the mixer too, which would
    // otherwise hold what came since its last tick and send it on the new socket. The start hands out no session before
    // its socket is open, so nothing is lost there.
    if (!this.stt?.isOpen()) return;
    if (this.mixer) {
      if (name === 'participant') this.mixer.pushB(pcm);
      else this.mixer.pushA(pcm);
      return;
    }
    this.stt.sendAudio(pcm);
    this.audioSent();
  }

  /** Audio went out on an open socket: the stall watchdog's half of the evidence. */
  private audioSent(): void {
    const now = this.o.primary.clock.now();
    // Audio after a pause: the server's silence counts from here, not from before the pause, when it owed nothing.
    if (now - this.lastAudioAt > STALL_CHECK_MS) this.quietSince = now;
    this.lastAudioAt = now;
  }

  /** Manual turns end with `finalize` (ruling 5); the socket's own leg holds the key. */
  private endTurn(name: LegName): void {
    if (this.ended || name !== this.o.legs[0].name || !this.stt?.isOpen()) return;
    this.stt.finalize();
    this.frame('out', 'stt.finalize');
  }

  /** The STT config frame: a pure function of the request and the current key, so a reconnect on the same key sends it byte for byte again. */
  private sttConfig(): SonioxSttConfig {
    const { context, config, credentials } = this.o.primary;
    const key = this.key;
    const { source, target } = context.direction;
    // Both languages bias recognition, the source first; an auto source hints nothing, since the target alone would pull an unknown speaker toward the other side.
    const hints = source === AUTO ? [] : [...new Set([sonioxWire.toWire(source), sonioxWire.toWire(target)])];
    return {
      apiKey: key.stt,
      region: credentials.region,
      model: config.stt.model,
      sampleRate: SAMPLE_RATE,
      translation: this.o.shared ? { type: 'two_way', language_a: sonioxWire.toWire(source), language_b: sonioxWire.toWire(target) } : { type: 'one_way', target_language: sonioxWire.toWire(target) },
      // D20 keeps an auto source out of Both: the gate refuses the participant leg.
      ...(hints.length ? { languageHints: hints } : {}),
      // The shared socket always labels its people, to tell the sides apart; the participant's own one-way socket does unless speaker labels are off.
      ...(this.o.shared || config.diarize ? { enableSpeakerDiarization: true } : {}),
      ...(config.stt.context ? { context: config.stt.context } : {}),
      endpointSensitivity: config.stt.endpointSensitivity,
      endpointLatencyAdjustmentLevel: config.stt.endpointLatencyAdjustmentLevel,
      endpointMaxDelayMs: config.stt.endpointMaxDelayMs,
      ...(config.stt.agentText ? { enableAgentTextInput: true } : {}),
      ...(key.clientReferenceId ? { clientReferenceId: key.clientReferenceId } : {}),
    };
  }

  private opened(): void {
    this.mixer?.start();
    this.watchStall();
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
    // Per socket: a reconnect's socket starts readable, whatever episode the one before it was in.
    let readable = true;
    // A socket this core has moved on from (a drop, a stop) is heard no more: its identity replaces the old generation counter.
    // So a late frame from a dropped socket still closing reaches neither the utterances nor the lease's report for the new key.
    const current = () => !this.ended && stream === this.stt;
    const heard = () => { this.quietSince = this.o.primary.clock.now(); };
    stream.setHandlers({
      onMessage: (message) => {
        if (!current()) return;
        heard();
        if (first) {
          first = false;
          this.accepted = stream;
          this.o.primary.credentials.lease?.streamAccepted();
        }
        readable = true;
        this.onMessage(message);
      },
      onError: (code, message) => { if (current()) this.onError(code, message); },
      onClose: (event) => { if (current()) this.onClose(event); },
      onUnreadable: (error) => {
        if (!current()) return;
        heard();
        // The Logs only, on the ok → failing transition (choice 7): never a notice.
        if (!readable) return;
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

  /** Whether the managed grant is at its end now; an own key's never is. */
  private atGrantEnd(): boolean {
    return this.o.primary.credentials.lease?.atGrantEnd(this.o.primary.clock.now()) === true;
  }

  private dropInfo(drop: Pick<DropInfo, 'cause' | 'closeCode' | 'errorCode'>, retryable: boolean): DropInfo {
    return { ...drop, retryable, managed: this.o.primary.credentials.lease !== undefined };
  }

  private onError(code: string, message: string): void {
    // The server's own words, which neither a drop nor a failure carries (choice 16); a socket error is the stream's, and has none.
    if (code !== 'socket_error') this.frame('in', 'stt.error', { code, message });
    // The grant already ended (a 403 at its end): whatever ends the socket now ends the session as a lease end (§4.2).
    if (this.pendingCutoff) {
      this.pendingCutoff = false;
      this.cutoff({ errorCode: code });
      return;
    }
    const action = sonioxDropAction({ error: code, message, atGrantEnd: this.atGrantEnd() });
    if (action === 'cutoff') {
      // The granted duration ended (managed): the close that follows ends the leg without an error (Plan B's seam).
      this.pendingCutoff = true;
      return;
    }
    if (action === 'reconnect') {
      this.dropped({ cause: 'error', errorCode: code });
      return;
    }
    this.fail(sttFailureCode(code), `[Soniox ${code}] ${message}`, { drop: this.dropInfo({ cause: 'error', errorCode: code }, false) });
  }

  private onClose(event: { code?: number; reason?: string }): void {
    if (this.pendingCutoff) {
      this.pendingCutoff = false;
      this.cutoff({ code: event.code, reason: event.reason });
      return;
    }
    // A close with nothing said before it: a network drop, or the server going away.
    const close = event.code !== undefined ? { closeCode: event.code } : {};
    if (sonioxDropAction({ close: event.code, atGrantEnd: this.atGrantEnd() }) === 'reconnect') {
      this.dropped({ cause: 'close', ...close });
      return;
    }
    // The Logs row keeps the wire's code and the server's own words, as the old one did (choice 16).
    this.frame('in', 'session.connection_lost', { code: String(event.code ?? 'socket_closed'), message: event.reason || 'The Soniox connection closed unexpectedly' });
    this.fail(LOST, event.reason || `The Soniox connection closed unexpectedly (${event.code ?? 'no code'}).`, { drop: this.dropInfo({ cause: 'close', ...close }, false) });
  }

  /**
   * A live socket ended unasked, and its end is worth retrying. Break before
   * make (§4.2): what it had in flight closes as it stands — L1 keeps the
   * last snapshot, and refs go on — and the socket is detached and closed;
   * only then do the attempts begin, the first inside `dropped()` unless the
   * drop is a flap. The TTS sockets carry on.
   */
  private dropped(drop: Pick<DropInfo, 'cause' | 'closeCode' | 'errorCode'>): void {
    if (this.ended) return;
    this.utterances.abandon();
    // The new socket restarts the server's audio clock and mints its own speaker labels (`SonioxClient.ts:646-647`).
    this.tracker?.reset();
    const stt = this.stt;
    this.stt = null;
    stt?.close();
    this.letGo(stt);
    // An attempt's socket that dropped as it opened is that attempt's: the reconnector fails it, however it answers, and the drop a give-up reports stays the one it took up.
    if (!this.reconnector.active) {
      this.drop = this.dropInfo(drop, true);
      this.lastFailure = null;
    }
    this.reconnector.dropped(this.dropInfo(drop, true));
  }

  /**
   * One reconnect attempt (§4.2). Managed: a fresh key when the current one is
   * spent or its window has closed, so one is fetched per drop and a key whose
   * socket never opened serves the next attempt. An own key: the same key.
   * Then the start path's connect; live once the socket opens. The signal
   * (the reconnector's, for every attempt of this drop) aborts the connect at
   * the budget's end and on a stop; a reissued key's window closing gives it
   * up too, the key left unspent but past use.
   */
  private async attempt(signal: AbortSignal): Promise<AttemptResult> {
    const { clock, credentials } = this.o.primary;
    const lease = credentials.lease;
    let reissued = false;
    let reissueMs = 0;
    const failed = (code: string, message: string): AttemptResult => {
      this.lastFailure = message;
      return { ok: false, final: false, code, message, reissued, reissueMs };
    };
    // An answer nobody reads; it leaves the last failure's words as they were.
    const abandoned: AttemptResult = { ok: false, final: false, code: LOST, message: 'The attempt was abandoned.', reissued: false, reissueMs: 0 };
    const expired = this.key.usableUntil !== undefined && clock.now() >= this.key.usableUntil;
    if (lease && (this.key.spent || expired)) {
      const asked = clock.now();
      const answer = await lease.reissue();
      reissueMs = clock.now() - asked;
      // Abandoned meanwhile (a stop, the budget's end): nobody reads the answer, and nothing more opens.
      if (signal.aborted || this.ended) return abandoned;
      if (!answer.ok) {
        this.lastFailure = answer.message;
        // A refusal stops the attempts (§6); a reissue that could not answer is a failed attempt.
        return answer.retry ? reissueFailed(answer.message, reissueMs) : refusalResult(answer);
      }
      this.key = { stt: answer.stt, clientReferenceId: answer.clientReferenceId, usableUntil: clock.now() + REISSUED_KEY_WINDOW_MS - KEY_EXPIRY_MARGIN_MS, spent: false };
      reissued = true;
    }
    const stream = this.newStt();
    this.stt = stream;
    const key = this.key;
    const abort = () => stream.close();
    signal.addEventListener('abort', abort, { once: true });
    // A socket opening past the key's window would be refused: the connect still going then is given up.
    let lapsed = false;
    const cancelLapse = key.usableUntil !== undefined
      ? clock.setTimeout(() => { lapsed = true; stream.close(); }, key.usableUntil - clock.now())
      : () => {};
    try {
      await stream.connect(this.sttConfig());
    } catch (error) {
      if (this.stt === stream) this.stt = null;
      // Closed by the abort (a stop, the budget's end): not the attempt's own failure.
      if (signal.aborted || this.ended) return abandoned;
      if (lapsed) return failed('key_expired', "The reissued key's start window closed before its connection opened.");
      return failed(error instanceof SonioxSttConnectTimeout ? 'connect_timeout' : 'socket_error', describeCause(error));
    } finally {
      signal.removeEventListener('abort', abort);
      cancelLapse();
    }
    key.spent = true;
    if (signal.aborted || this.ended) return abandoned;
    // It dropped as it opened (`dropped()` detached it): the next attempt goes on.
    if (this.stt !== stream) return failed('socket_error', 'The new connection dropped as it opened.');
    this.quietSince = clock.now();
    return { ok: true, reissued, reissueMs };
  }

  /**
   * The attempts ended without a connection: a lease ended at its grant's end
   * is a lease end; anything else fails the legs with the policy's verdict and
   * the drop it gave up on. The leg's words are the last attempt's, or plain
   * connection-lost words when none was made; the verdict's reason stays in
   * `giveUp` and the frames.
   */
  private gaveUp(e: GiveUp): void {
    const { code, message: _verdict, ...giveUp } = e;
    if (e.reason === 'lease_ended' && this.atGrantEnd()) {
      this.cutoff({ attempts: e.attempts });
      return;
    }
    this.fail(code, this.lastFailure ?? LOST_WORDS, { ...(this.drop ? { drop: this.drop } : {}), giveUp });
  }

  /**
   * The stall watchdog (§4.2): a socket still open that answers nothing for
   * `SONIOX_STALL_MS` while audio goes out is dead, and drops as a stall.
   * Silence on our side owes no answer, so it never trips it.
   */
  private watchStall(): void {
    this.stopStallWatch = every(this.o.primary.clock, STALL_CHECK_MS, () => {
      // A grant-end 403 waits for its close, which ends the leg: no stall to find.
      if (this.ended || this.pendingCutoff || this.reconnector.active || !this.stt?.isOpen()) return;
      const now = this.o.primary.clock.now();
      if (now - this.lastAudioAt <= STALL_CHECK_MS && now - this.quietSince >= SONIOX_STALL_MS) this.dropped({ cause: 'stall' });
    });
  }

  /** The granted time ended (managed): the lease ends the run as a lease end — synchronously, so the `closed` after it finds the run ending — and each leg closes without an error (Plan B's seam). */
  private cutoff(payload: Record<string, unknown>): void {
    this.o.primary.credentials.lease?.cutoff();
    this.frame('in', 'session.duration_cutoff', payload);
    this.toLegs((leg) => leg.events.closed({ reason: 'The granted session time ended.' }));
    this.shutdown();
  }

  /** The failure goes to every leg, the socket's own first (shared Both: the speaker, then the participant). */
  private fail(code: string, message: string, extra: { drop?: DropInfo; giveUp?: Omit<GiveUp, 'code' | 'message'> } = {}): void {
    if (this.ended) return;
    this.toLegs((leg) => leg.events.failed({ code, message, ...extra }));
    this.shutdown();
  }

  /** One event to each leg the core serves, the socket's own first, until one of them ends the core. */
  private toLegs(emit: (leg: CoreLeg) => void): void {
    for (const leg of this.o.legs) {
      if (this.ended) return;
      emit(leg);
    }
  }

  /** Every way the core ends. `graceful` — a stop — ends the STT stream first; a failure says nothing more to a server that refused the session. */
  private shutdown(graceful = false): void {
    if (this.ended) return;
    this.ended = true;
    // Waits, an attempt's connect and a reissue's late answer: all cancelled, and nothing more is said.
    this.reconnector.cancel();
    this.stopStallWatch?.();
    this.stopStallWatch = null;
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
    this.letGo(stt);
    for (const leg of this.o.legs) leg.speech?.close();
  }

  /** The core is done with `stt`: when the lease was told of its first frame, it hears the connection ended, so a report of its key still unacknowledged stops being retried. */
  private letGo(stt: SonioxSttStream | null): void {
    if (!stt || stt !== this.accepted) return;
    this.accepted = null;
    this.o.primary.credentials.lease?.streamEnded();
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
    // Split Both takes no agent text (measured 2026-11-05: no gain with echo cancellation, worse talk-over): the speaker's socket does not ask, so its session refuses each chunk.
    const { agentText: _off, ...stt } = requests.speaker.config.stt;
    const split = { ...requests, speaker: { ...requests.speaker, config: { ...requests.speaker.config, stt } } };
    const settled = await Promise.allSettled(legs.map((leg) => startLeg(leg, split[leg], events[leg])));
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
      // The two voices number a row's audio entries together: either may read it (route by language).
      const counts = new Map<Ref, number>();
      const core = new SonioxCore({
        primary: requests.speaker,
        legs: [
          coreLeg('speaker', requests.speaker, events.speaker, openSocket, counts),
          coreLeg('participant', requests.participant, events.participant, openSocket, counts),
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
