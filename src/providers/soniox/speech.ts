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

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * A segment's span divided among its chunks in proportion to their sample
 * counts (every count positive), so consecutive ranges tile the span; the
 * last ends at the span's end. A boundary inside a surrogate pair moves
 * past it (choice 4). `text` is the ref's text the span indexes.
 */
export function tileSpan(span: TextRange, samples: readonly number[], text: string): TextRange[] {
  const [a, b] = span;
  const total = samples.reduce((sum, n) => sum + n, 0);
  const out: TextRange[] = [];
  let start = a;
  let cum = 0;
  samples.forEach((n, k) => {
    cum += n;
    let end = k === samples.length - 1 ? b : Math.max(start, a + Math.round(((b - a) * cum) / total));
    if (end > start && end < b && isHigh(text.charCodeAt(end - 1)) && isLow(text.charCodeAt(end))) end += 1;
    out.push([start, end]);
    start = end;
  });
  return out;
}

export class LegSpeech {
  private stream: SonioxTtsStream | null = null;
  private connecting = false;
  /** The socket `ensure()` is opening — at start or on demand — so `close()` reaches it before it opens (the `stop()` rule; the review's M8). */
  private opening: SonioxTtsStream | null = null;
  private closed = false;
  private pending: Pending[] = [];
  /** Per ref, the speech entries so far: the next audio's index (L1 appends one per `audio`). */
  private readonly counts = new Map<Ref, number>();
  /** Per live stream of the current socket: its chunks' entry indices and sample counts. A new socket restarts the ids. */
  private segments = new Map<string, Array<{ index: number; samples: number }>>();
  /** Each ref's translation as fed: what a span indexes. */
  private readonly texts = new Map<Ref, string>();
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
    this.texts.set(ref, (this.texts.get(ref) ?? '').slice(0, span[0]) + text);
    this.spoken += text;
    const tag: TextTag = { ref, span };
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

  /** Before the caller's first await (the `stop()` rule): every socket it holds or is opening is closed, and nothing is emitted after it. */
  close(): void {
    this.closed = true;
    this.pending = [];
    this.segments.clear();
    this.stream?.close();
    this.stream = null;
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
    if (this.closed || !end.clean || !end.span || end.ref === undefined || !entries || entries.length === 0) return;
    const ranges = tileSpan(end.span, entries.map((e) => e.samples), this.texts.get(end.ref) ?? '');
    this.o.events.speechRanges({ ref: end.ref, ranges: entries.map((e, k) => ({ index: e.index, range: ranges[k] })) });
  }

  private failure(code: string, message: string, hadActiveStream: boolean, scope: SonioxTtsErrorScope): void {
    // A drop that cost no speech is recovered silently the next time text needs the socket.
    if (this.closed || !hadActiveStream) return;
    const reported = this.reported;
    if (reported === 'all' || (reported === 'segment' && scope === 'segment')) return;
    this.reported = scope;
    this.frame('in', 'tts.degraded', { code, message, scope });
    this.o.events.degraded({ code: scope === 'segment' ? 'tts_segment_lost' : 'tts_stopped', message: `Soniox TTS ${code}: ${message}` });
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
