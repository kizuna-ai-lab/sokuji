/**
 * One leg's spoken translation over Soniox's TTS socket (survey §1.7–1.8,
 * §2.9; rulings 2 and 3). Final translation chunks arrive tagged with
 * their ref and span; audio streams back as it arrives, one rangeless
 * `audio` per chunk, so the first audio comes as early as the old
 * client's. When a TTS segment ends cleanly the chunks' ranges are filled
 * in (`speechRanges`): the segment's span divided by their sample counts.
 * A killed segment gets none: replay only. Failures are the old client's
 * episodes (`SonioxClient.ts:1436-1492`): a lost segment once per episode,
 * "speech stopped" even after one; an idle drop is silent, and the next
 * text reconnects, flushing what waited in order (`ensureTts`, `:1059-1094`).
 */
import { SAMPLE_RATE, type AdapterEvents, type Ref, type TextRange } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import { framePayload } from '../../lib/contract/framePayload';
import { tileSpan } from '../../lib/contract/ranges';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { SonioxRegion } from '../../lib/soniox/regions';
import { SONIOX_TTS_MODEL } from '../../lib/soniox/ttsCatalog';
import type { OpenSocket } from './socket';
import { SonioxTtsStream, type SonioxTtsErrorScope, type SonioxTtsSegmentEnd, type TextTag } from './ttsStream';

export interface LegSpeechOptions {
  region: SonioxRegion;
  /** The TTS socket's key (an own key: the STT key). */
  key: string;
  clientReferenceId?: string;
  voice: string;
  speed: number;
  events: AdapterEvents;
  clock: Clock;
  openSocket: OpenSocket;
}

type Pending = { kind: 'text'; text: string; language: string; tag: TextTag } | { kind: 'end' };

/** Lifted to the contract at its second user (Stage 2 Palabra, choice 2); re-exported, so this module's importers are unchanged. */
export { tileSpan } from '../../lib/contract/ranges';

export class LegSpeech {
  private stream: SonioxTtsStream | null = null;
  private connecting = false;
  /** The socket `ensure()` is opening — at start or on demand — so `close()` reaches it before it opens (the `stop()` rule): a stop during a connect must not leave a socket to open after it. */
  private opening: SonioxTtsStream | null = null;
  private closed = false;
  private pending: Pending[] = [];
  /** Per ref, the speech entries so far: the next audio's index (L1 appends one per `audio`). */
  private readonly counts = new Map<Ref, number>();
  /** Per live stream of the current socket: its chunks' entry indices and sample counts. A new socket restarts the ids. */
  private segments = new Map<string, Array<{ index: number; samples: number }>>();
  /**
   * Per ref, the chunks fed whose TTS segment has not ended yet: what a
   * segment's span indexes when its ranges are filled in (`tileSpan`'s
   * surrogate snap). A chunk is let go once its segment's ranges are filled
   * in or the segment is lost, so a session's translations do not pile up.
   */
  private texts = new Map<Ref, Array<{ span: TextRange; text: string }>>();
  /** What this utterance handed to speech, for the Logs' `tts.speak`. */
  private spoken = '';
  /** The failure episode already reported: cleared when audio flows again or a reconnect succeeds. */
  private reported: SonioxTtsErrorScope | null = null;
  private readable = true;

  constructor(private readonly o: LegSpeechOptions) {}

  /** Opens the socket at start; never rejects: a failure is said only in the Logs, and the first text reconnects (ruling 3, choice 6). */
  open(): Promise<void> {
    return this.ensure(true);
  }

  speak(ref: Ref, text: string, span: TextRange, language: string): void {
    if (this.closed) return;
    const tag: TextTag = { ref, span };
    this.hold(tag, text);
    this.spoken += text;
    if (this.stream?.isOpen()) {
      this.stream.sendText(text, language, tag);
    } else {
      this.pending.push({ kind: 'text', text, language, tag });
      void this.ensure();
    }
  }

  endUtterance(): void {
    if (this.closed) return;
    if (this.spoken) {
      this.frame('out', 'tts.speak', { text: this.spoken });
      this.spoken = '';
    }
    if (this.connecting) this.pending.push({ kind: 'end' });
    else this.stream?.endUtterance();
  }

  /**
   * Before the caller's first await (the `stop()` rule): every socket it
   * holds or is opening is closed, and nothing is emitted after it but the
   * line for the stream it ended with `text_end` (Stage 2 session end,
   * ruling 2 (ii)).
   */
  close(): void {
    const stream = this.stream;
    this.stream = null;
    const ended = stream?.close() ?? null;
    if (ended !== null) this.frame('out', 'tts.end', { streamId: ended });
    this.closed = true;
    this.pending = [];
    this.segments.clear();
    this.texts.clear();
    // A close while CONNECTING rejects its connect(); ensure()'s catch sees `closed` and says nothing.
    this.opening?.close();
    this.opening = null;
  }

  private newStream(): SonioxTtsStream {
    const stream = new SonioxTtsStream(
      { apiKey: this.o.key, region: this.o.region, voice: this.o.voice, model: SONIOX_TTS_MODEL, sampleRate: SAMPLE_RATE, speed: this.o.speed, clientReferenceId: this.o.clientReferenceId },
      { clock: this.o.clock, openSocket: this.o.openSocket },
    );
    stream.setHandlers({
      onAudio: (pcm, info) => { if (stream === this.stream) this.onAudio(pcm, info.streamId, info.ref); },
      onSegmentEnd: (end) => { if (stream === this.stream) this.onSegmentEnd(end); },
      onError: (code, message, hadActiveStream, scope) => { if (stream === this.stream) this.failure(code, message, hadActiveStream, scope); },
      onUnreadable: (error) => { if (stream === this.stream) this.unreadable(error); },
    });
    return stream;
  }

  /**
   * Opens a socket — at start, or because text needs one and it is down —
   * then sends what waited, in order. One at a time: text that arrives
   * while a socket opens, the start's included, waits for that socket.
   */
  private async ensure(atStart = false): Promise<void> {
    if (this.connecting || this.closed) return;
    this.connecting = true;
    this.stream?.close();
    this.stream = null;
    this.segments = new Map();
    this.holdOnlyPending();
    const stream = this.newStream();
    this.opening = stream;
    let retry = false;
    try {
      await stream.connect();
      if (this.closed) {
        stream.close();
        return;
      }
      this.opening = null;
      this.stream = stream;
      this.reported = null;
      // A new socket, a new unreadable-frame episode (choice 7).
      this.readable = true;
      const pending = this.pending;
      this.pending = [];
      for (const op of pending) {
        if (op.kind === 'end') stream.endUtterance();
        else stream.sendText(op.text, op.language, op.tag);
      }
    } catch (error) {
      if (this.closed) return;
      if (atStart) {
        // Silent until the first translation (choice 6): the Logs only. Text
        // that already waited on this socket is that translation: it retries.
        // An utterance end alone needs no socket.
        this.frame('in', 'tts.connect_failed', { message: describeCause(error) });
        retry = this.pending.some((op) => op.kind === 'text');
        if (!retry) this.pending = [];
      } else {
        this.pending = [];
        // Trying to resume speech and failing is speech lost, whatever was active (the old client passed true).
        this.failure('connect_failed', describeCause(error), true, 'all');
      }
      // What waited and was dropped here will never be spoken: its text goes too.
      this.holdOnlyPending();
    } finally {
      this.connecting = false;
      if (this.opening === stream) this.opening = null;
    }
    if (retry) void this.ensure();
  }

  private onAudio(pcm: Int16Array, streamId: string, ref: Ref | undefined): void {
    if (this.closed || ref === undefined || pcm.length === 0) return;
    const index = this.counts.get(ref) ?? 0;
    this.counts.set(ref, index + 1);
    const entries = this.segments.get(streamId) ?? [];
    entries.push({ index, samples: pcm.length });
    this.segments.set(streamId, entries);
    // Speech flows again: a later failure is a new episode.
    this.reported = null;
    this.readable = true;
    this.frame('in', 'tts.audio', { bytes: pcm.byteLength });
    this.o.events.audio({ ref, pcm });
  }

  private onSegmentEnd(end: SonioxTtsSegmentEnd): void {
    const entries = this.segments.get(end.streamId);
    this.segments.delete(end.streamId);
    // Filled in or lost, the segment's text is done with either way.
    const text = end.ref !== undefined && end.span ? this.release(end.ref, end.span) : '';
    if (this.closed || !end.clean || !end.span || end.ref === undefined || !entries || entries.length === 0) return;
    const [a, b] = end.span;
    const ranges = tileSpan([0, b - a], entries.map((e) => e.samples), text).map(([s, e]): TextRange => [a + s, a + e]);
    this.o.events.speechRanges({ ref: end.ref, ranges: entries.map((e, k) => ({ index: e.index, range: ranges[k] })) });
  }

  private hold({ ref, span }: TextTag, text: string): void {
    const chunks = this.texts.get(ref) ?? [];
    chunks.push({ span, text });
    this.texts.set(ref, chunks);
  }

  /** The text of `ref`'s segment spanning `span`, and every chunk of `ref` up to its end let go: those segments are over. */
  private release(ref: Ref, [a, b]: TextRange): string {
    const chunks = this.texts.get(ref) ?? [];
    const text = chunks.filter((c) => c.span[0] >= a && c.span[1] <= b).map((c) => c.text).join('');
    const left = chunks.filter((c) => c.span[1] > b);
    if (left.length > 0) this.texts.set(ref, left);
    else this.texts.delete(ref);
    return text;
  }

  /** Only the text still waiting to be sent can end in a segment now: a socket that was let go took its live segments with it, unreported. */
  private holdOnlyPending(): void {
    this.texts = new Map();
    for (const op of this.pending) if (op.kind === 'text') this.hold(op.tag, op.text);
  }

  private failure(code: string, message: string, hadActiveStream: boolean, scope: SonioxTtsErrorScope): void {
    // A drop that cost no speech is recovered silently the next time text needs the socket.
    if (this.closed || !hadActiveStream) return;
    const reported = this.reported;
    if (reported === 'all' || (reported === 'segment' && scope === 'segment')) return;
    this.reported = scope;
    // The client's own verdict on what it heard, not a server frame: out, as the old client logged it (`SonioxClient.ts:1472`).
    this.frame('out', 'tts.degraded', { code, message, scope });
    this.o.events.degraded({ code: scope === 'segment' ? 'tts_segment_lost' : 'tts_stopped', message: `Soniox TTS ${code}: ${message}`, reason: `tts_${code}` });
  }

  /** The Logs only, on the ok → failing transition (choice 7): the old client dropped such a frame silently, and it costs the user nothing to act on. */
  private unreadable(error: unknown): void {
    if (this.closed || !this.readable) return;
    this.readable = false;
    this.frame('in', 'tts.unreadable', { message: describeCause(error) });
  }

  private frame(direction: 'in' | 'out', type: string, payload?: unknown): void {
    if (!this.closed) this.o.events.frame({ direction, type, ...(payload === undefined ? {} : { payload: framePayload(payload) }) });
  }
}
