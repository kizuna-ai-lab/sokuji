/**
 * One leg's spoken translation over Soniox's TTS socket (survey §1.7–1.8,
 * §2.9; rulings 2 and 3). Final translation chunks arrive tagged with
 * their ref and span; audio streams back as it arrives, one `audio` per
 * chunk, so the first audio comes as early as the old client's. Each chunk
 * carries a provisional range: the span sent to its segment so far,
 * reached at the leg's learned speech rate (karaoke provisional ranges
 * design). When a TTS segment ends the chunks' ranges are filled in
 * (`speechRanges`): the segment's span divided by their sample counts. A
 * clean end also teaches the rate; one that ended uncleanly (a kill, a lost
 * socket, speech switched off) is filled in over the chunks that did
 * arrive, so its row stops being lit, and teaches nothing. Failures are the old client's
 * episodes (`SonioxClient.ts:1436-1492`): a lost segment once per episode,
 * "speech stopped" even after one; an idle drop is silent, and the next
 * text reconnects, flushing what waited in order (`ensureTts`, `:1059-1094`).
 */
import { SAMPLE_RATE, type AdapterEvents, type Ref, type TextRange } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import type { LegName } from '../../lib/conversation/types';
import { framePayload } from '../../lib/contract/framePayload';
import { SpeechPace, tileSpan } from '../../lib/contract/ranges';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { SonioxRegion } from '../../lib/soniox/regions';
import { SONIOX_TTS_MODEL } from '../../lib/soniox/ttsCatalog';
import type { OpenSocket } from './socket';
import { classifyChunkEnd, SonioxTtsStream, type SonioxTtsErrorScope, type SonioxTtsSegmentEnd, type TextTag } from './ttsStream';

export interface LegSpeechOptions {
  /** The leg this voice belongs to: named as `voice` on audio it reads for another leg's row. */
  leg: LegName;
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
   * Per live stream of the current socket: its samples so far, where its
   * provisional ranges reached in its span, and the text they were placed
   * in — what an unclean close-out tiles over once speech switched off has
   * let the held chunks go.
   */
  private sweeps = new Map<string, { cum: number; reached: number; text: string }>();
  /**
   * Per ref, the chunks fed whose TTS segment has not ended yet: what a
   * segment's span indexes when its ranges are filled in (`tileSpan`'s
   * surrogate snap). A chunk is let go once its segment's ranges are filled
   * in or the segment is lost, so a session's translations do not pile up.
   */
  private texts = new Map<Ref, Array<{ span: TextRange; text: string }>>();
  /** What this utterance handed to speech, for the Logs' `tts.speak`. */
  private spoken = '';
  /** Per ref read for another leg's row: that leg's events, where the audio and its ranges go (the row is there). */
  private readonly homes = new Map<Ref, AdapterEvents>();
  /** Translation I hear, live (#595): while off, nothing is sent to synthesis. */
  private on = true;
  /** The ref whose last chunk left a sentence open; null after a sentence or an utterance ended. */
  private openSentence: Ref | null = null;
  /** Back on in the middle of this ref's sentence: the rest of it is not spoken. */
  private skipping: Ref | null = null;
  /** The failure episode already reported: cleared when audio flows again or a reconnect succeeds. */
  private reported: SonioxTtsErrorScope | null = null;
  private readable = true;

  /** The leg's speech rate, learned from its clean fill-ins. */
  private readonly pace: SpeechPace;

  constructor(private readonly o: LegSpeechOptions) {
    this.pace = new SpeechPace(o.speed);
  }

  /** Opens the socket at start; never rejects: a failure is said only in the Logs, and the first text reconnects (ruling 3, choice 6). */
  open(): Promise<void> {
    return this.ensure(true);
  }

  /**
   * `home`: another leg's row, read in this leg's voice (adapter, "route by the translation's language"):
   * spoken as any chunk, but its audio and its ranges go to that leg's events, named with this leg as the
   * `voice`, so the row keeps its karaoke and its replay and the sound reaches this leg's ear.
   */
  speak(ref: Ref, text: string, span: TextRange, language: string, home?: AdapterEvents): void {
    if (this.closed) return;
    if (home) this.homes.set(ref, home);
    const continues = this.openSentence === ref;
    this.openSentence = classifyChunkEnd(text) === 'sentence' ? null : ref;
    if (!this.on) return;
    if (this.skipping !== null) {
      if (continues && this.skipping === ref) return;
      this.skipping = null;
    }
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
    this.openSentence = null;
    if (this.spoken) {
      this.frame('out', 'tts.speak', { text: this.spoken });
      this.spoken = '';
    }
    if (!this.on) return;
    if (this.connecting) this.pending.push({ kind: 'end' });
    else this.stream?.endUtterance();
  }

  /**
   * Translation I hear switched mid-run (#595). Off: what waits is forgotten
   * and the live segment is dropped, on the same socket, and nothing more is
   * sent to synthesis. On: speech resumes at the next sentence.
   */
  setOn(on: boolean): void {
    if (this.closed || on === this.on) return;
    this.on = on;
    this.frame('out', 'tts.speech', { on });
    if (on) {
      this.skipping = this.openSentence;
      return;
    }
    this.pending = [];
    // Every chunk held belongs to the live segment, dropped now, or to text that waited and never will be
    // spoken. The dropped segment is still closed out, over the text its chunks were placed in (its sweep).
    this.texts = new Map();
    this.stream?.drop();
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
    this.sweeps.clear();
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
      onAudio: (pcm, info) => { if (stream === this.stream) this.onAudio(pcm, info.streamId, info.ref, info.span); },
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
    this.sweeps = new Map();
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

  private onAudio(pcm: Int16Array, streamId: string, ref: Ref | undefined, span: TextRange | undefined): void {
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
    const range = span ? this.provisional(streamId, ref, span, pcm.length) : undefined;
    const home = this.homes.get(ref);
    (home ?? this.o.events).audio({ ref, pcm, ...(range ? { range } : {}), ...(home ? { voice: this.o.leg } : {}) });
  }

  /** Where this chunk reaches in the span sent to its segment so far, at the leg's rate; none while the span has no letters. */
  private provisional(streamId: string, ref: Ref, span: TextRange, samples: number): TextRange | undefined {
    const sweep = this.sweeps.get(streamId) ?? { cum: 0, reached: 0, text: '' };
    this.sweeps.set(streamId, sweep);
    sweep.cum += samples;
    sweep.text = this.textOf(ref, span);
    const end = this.pace.reach(sweep.text, sweep.cum, sweep.reached);
    if (end === null) return undefined;
    const range: TextRange = [span[0] + sweep.reached, span[0] + end];
    sweep.reached = end;
    return range;
  }

  private onSegmentEnd(end: SonioxTtsSegmentEnd): void {
    const entries = this.segments.get(end.streamId);
    const sweep = this.sweeps.get(end.streamId);
    this.segments.delete(end.streamId);
    this.sweeps.delete(end.streamId);
    // Filled in or lost, the segment's text is done with either way. Speech switched off let it go
    // already: the text its chunks were placed in stands in, so a boundary still snaps past a surrogate pair.
    const held = end.ref !== undefined && end.span ? this.release(end.ref, end.span) : '';
    const text = held.length > 0 ? held : sweep?.text ?? '';
    if (this.closed || !end.span || end.ref === undefined || !entries || entries.length === 0) return;
    // Clean or not, the chunks that arrived take the span: an unclean end (a kill, a lost socket,
    // speech switched off) would otherwise leave its row lit part way after the voice stopped.
    const [a, b] = end.span;
    const ranges = tileSpan([0, b - a], entries.map((e) => e.samples), text).map(([s, e]): TextRange => [a + s, a + e]);
    (this.homes.get(end.ref) ?? this.o.events).speechRanges({ ref: end.ref, ranges: entries.map((e, k) => ({ index: e.index, range: ranges[k] })) });
    // Only a whole segment says how long its text takes to speak.
    if (end.clean) this.pace.learn(text, entries.reduce((n, e) => n + e.samples, 0));
  }

  private hold({ ref, span }: TextTag, text: string): void {
    const chunks = this.texts.get(ref) ?? [];
    chunks.push({ span, text });
    this.texts.set(ref, chunks);
  }

  /** The text of `ref`'s held chunks inside `span`, in order. */
  private textOf(ref: Ref, [a, b]: TextRange): string {
    return (this.texts.get(ref) ?? []).filter((c) => c.span[0] >= a && c.span[1] <= b).map((c) => c.text).join('');
  }

  /** The text of `ref`'s segment spanning `span`, and every chunk of `ref` up to its end let go: those segments are over. */
  private release(ref: Ref, span: TextRange): string {
    const chunks = this.texts.get(ref) ?? [];
    const text = this.textOf(ref, span);
    const left = chunks.filter((c) => c.span[1] > span[1]);
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
