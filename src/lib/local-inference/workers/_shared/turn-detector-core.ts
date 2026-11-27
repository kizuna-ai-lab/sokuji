/**
 * The turn detector's core: it takes the leg's audio, resamples it once onto
 * the leg's 16 kHz timeline, runs vad-web's FrameProcessor and the Smart Turn
 * gate on each 512-sample frame as the vad-web workers did, and writes what it
 * decides as a trace (frames, opens, closes, drops, drains). It keeps no
 * segment audio of its own: the outputs cut theirs from the trace. Under
 * manual turns it asks Silero nothing; the frames still go to the trace.
 *
 * A segment is what the FrameProcessor would have handed a worker: the
 * pre-speech pad it held, the speech, and the silence that ended it. What the
 * core adds to the workers' loop:
 * - After a cap cut, the turn goes on (plan, Decision 3): what follows is a
 *   continuation, opened at the cut, with no pad and no minSpeech check, until
 *   the processor ends a segment it started meanwhile, Normal's silence rule,
 *   Smart, a drain or the next cap. Nothing is emitted if every frame of it
 *   was under the negative threshold.
 * - No segment outgrows the longest one the processor can cut, its pad plus
 *   the cap's frames (C4). The processor's own count keeps its segments there;
 *   a continuation starts at the cut, so it is held to it from there.
 * - A drain processes the last partial frame at once, zero-padded for the VAD,
 *   and closes the open segment with its real samples.
 * - With `capAtPause`, a cap does not cut where it falls but after the last
 *   frame of its last quarter (at most CAP_LOOKBACK_MS) that Silero calls
 *   silence, or else after the quietest one: a cut inside a word
 *   leaves the next piece starting on half of it, and Whisper can take that
 *   fragment for the whole piece and end its text there. The frames between
 *   the cut and the cap open the continuation; none is lost.
 */
import { FrameProcessor, Message } from '@ricky0123/vad-web';
import type { FrameProcessorEvent } from '@ricky0123/vad-web/dist/frame-processor';
import type { VadWebConfig } from '../../types';
import { resolveMaxSpeechFrames, VAD_FRAME_SAMPLES, VAD_SAMPLE_RATE, type SegmentLimit } from './max-speech-frames';
import { TimelineResampler } from './timeline-resampler';
import { INPUT_BACKLOG_SECONDS, overloadedNotice, type DetectorNotice, type SegmentEndedBy, type TurnTrace } from './turn-detector-protocol';
import type { FrameProcessorParams, TurnLink } from './turn-gate';
import { resolveVadThresholds } from './vad-thresholds';

const VAD_FRAME_MS = (VAD_FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000;
/** The furthest back a cap looks for a pause to cut at. */
export const CAP_LOOKBACK_MS = 3000;
/** Under manual turns (no Silero), a frame is a pause to cut at when it is under this share of the window's median loudness. */
const PRESS_PAUSE_LOUDNESS = 0.5;

export type SmartLink = Pick<TurnLink, 'afterFrame' | 'rescue' | 'reset' | 'close'>;

export interface TurnDetectorCoreOptions {
  turns: 'auto' | 'manual';
  vad: VadWebConfig;
  limit: SegmentLimit;
  /** The input's sample rate (24 kHz by default). */
  inputRate?: number;
  /** Silero's speech probability for one 512-sample frame; required for 'auto'. */
  infer?: (frame: Float32Array) => Promise<number>;
  /** Silero back to silence; the FrameProcessor calls it whenever it resets. */
  resetModel?: () => void;
  /** Smart Turn's link for this processor, or null without Smart Turn. */
  smart?: (processor: FrameProcessorParams) => SmartLink | null;
  trace: (event: TurnTrace) => void;
  notify: (notice: DetectorNotice) => void;
  /**
   * A cap cuts after the quietest frame of its last quarter instead of where it falls. Only for segment delivery: the
   * marks relay has already sent the audio before a cap, so it cannot place an `end` back there.
   */
  capAtPause?: boolean;
}

type Op =
  | { kind: 'push'; pcm: Int16Array }
  | { kind: 'drain'; press?: number }
  | { kind: 'begin'; press: number }
  | { kind: 'cancel'; press: number };

interface Vad {
  processor: FrameProcessor;
  smart: SmartLink | null;
  /** The workers' cap: frames the processor has been speaking. */
  maxSpeechFrames: number;
  /** The longest segment the processor can cut: its pad and the cap's frames. */
  maxSegmentSamples: number;
}

interface OpenSegment {
  at: number;
  /** Manual turns: the press this segment belongs to. */
  press?: number;
  /** Opened at a cap's cut. */
  continuation: boolean;
  /** Continuation: a frame at or above the negative threshold since the cut. */
  heard: boolean;
  /** Continuation: frames under the negative threshold while the processor is not speaking, counted as it counts them. */
  quiet: number;
}

export class TurnDetectorCore {
  private readonly resampler: TimelineResampler;
  private readonly vad: Vad | null;
  private queue: Op[] = [];
  private running: Promise<void> | null = null;
  /** Raised by stop(): an op in flight stops at its next frame. */
  private generation = 0;
  private failed = false;
  private readonly inputRate: number;
  /** Samples of the frame in hand, which has left `pending` but is not yet processed. */
  private inFlight = 0;
  /** Resampled samples not processed yet: under a frame between ops. */
  private pending = new Float32Array(0);
  /** Samples processed; the next frame starts here. */
  private position = 0;
  /** Input samples received and not yet handed to a frame's `raw`. */
  private rawBuf = new Int16Array(0);
  /** The input-grid index of rawBuf[0]: round(position · inputRate / 16000), or the flush's end. */
  private rawBase = 0;
  private open: OpenSegment | null = null;
  private lastCloseTo = 0;
  /** Where the frames the processor holds as pre-speech pad start, oldest first (TurnGate.push's count, as positions). */
  private held: number[] = [];
  /** The processor's buffer was emptied during the frame in hand. */
  private emptied = false;
  /** Manual turns: the engine's limit in samples (none: Infinity), computed with no pad; a press is cut here and nowhere else. */
  private readonly pressCapSamples: number;
  /** Frames since the processor's SpeechStart, counted as the workers count them for the cap. */
  private speechFrames = 0;
  /** capAtPause: the latest frames' ends and how quiet each was (Silero's probability, or loudness under manual turns), oldest first. */
  private recent: Array<{ end: number; score: number }> = [];
  /** capAtPause: how many of the latest frames a cap looks back over (0: it cuts where it falls). */
  private readonly lookbackFrames: number;
  /** A cap cut here and the continuation is not open yet: the audio from here on is still needed. */
  private reopening: number | null = null;

  constructor(private readonly o: TurnDetectorCoreOptions) {
    this.resampler = new TimelineResampler(o.inputRate);
    this.inputRate = o.inputRate ?? 24000;
    this.vad = o.turns === 'auto' ? this.createVad() : null;
    // A press runs to the engine's limit and no sooner: the automatic Max speech setting does not shorten a held key.
    this.pressCapSamples = resolveMaxSpeechFrames(Number.POSITIVE_INFINITY, 0, o.limit) * VAD_FRAME_SAMPLES;
    const capFrames = this.vad ? this.vad.maxSpeechFrames : this.pressCapSamples / VAD_FRAME_SAMPLES;
    this.lookbackFrames = o.capAtPause && Number.isFinite(capFrames)
      ? Math.min(Math.floor(CAP_LOOKBACK_MS / VAD_FRAME_MS), Math.floor(capFrames / 4))
      : 0;
  }

  /**
   * Never drops a chunk. If the input not yet processed (queued chunks, plus what is resampled and
   * waiting, plus the frame in hand) would pass INPUT_BACKLOG_SECONDS, the leg fails instead (C3).
   */
  push(pcm: Int16Array): void {
    if (this.failed) return;
    if (this.unprocessedInput() + pcm.length > INPUT_BACKLOG_SECONDS * this.inputRate) {
      this.fail(overloadedNotice());
      return;
    }
    this.enqueue({ kind: 'push', pcm });
  }

  /**
   * Processes what has arrived, the last partial frame included, closes the open segment (`flush`), then `drained`.
   * Under manual turns a release that names a press which is no longer the open one (released, cancelled, or
   * replaced by the next press) ends nothing: it only settles the timeline and answers.
   */
  drain(press?: number): void {
    this.enqueue({ kind: 'drain', press });
  }

  /**
   * Manual turns: a press starts at the next sample. The timeline is settled first (the partial frame traced), and a
   * press still open ends as a release, so nothing of an earlier press or the gap reaches the new one.
   */
  begin(press: number): void {
    this.enqueue({ kind: 'begin', press });
  }

  /** Manual turns: drops the press's open audio and says so (`cancel`); a press released earlier is voided downstream. */
  cancel(press: number): void {
    this.enqueue({ kind: 'cancel', press });
  }

  /**
   * Drops what is queued and what is resampled but unprocessed, at once, and starts the turn afresh
   * (C3: stop never waits for a backlog). The frame in hand is discarded when it returns, with all its
   * events, so nothing it decided reaches the trace. Positions stay those of the samples processed: the
   * dropped input never enters the timeline, so the trace stays contiguous, and counting goes on from
   * where it stopped.
   */
  stop(): void {
    this.queue = [];
    this.pending = new Float32Array(0);
    this.dropRaw();
    this.generation++;
    if (this.inFlight === 0) this.resetTurn();
  }

  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  /**
   * Where a later segment may start: the open segment's start, else the pad the processor holds, never
   * before the last close. Asked while a frame is in hand, it answers as of that frame's start, which is
   * never past where the frame's own events open a segment.
   */
  earliestNeeded(): number {
    if (this.reopening !== null) return this.reopening;
    if (this.open) return this.open.at;
    return Math.max(this.lastCloseTo, this.held[0] ?? this.position);
  }

  private createVad(): Vad {
    const { infer, vad, limit } = this.o;
    if (!infer) throw new Error('TurnDetectorCore: automatic turns need infer');
    // As the vad-web workers' initVad built it.
    const { positive, negative } = resolveVadThresholds(vad);
    let preSpeechPadMs = (vad.preSpeechPadDuration ?? 0.8) * 1000;
    // The pad counts against an engine's whole-segment limit: a pad that leaves no room for one frame of speech is
    // shortened to what fits, and a configuration that already fits keeps its pad.
    if (limit.maxSegmentSamples !== undefined) {
      const fitFrames = Math.max(0, Math.floor(limit.maxSegmentSamples / VAD_FRAME_SAMPLES) - 1);
      preSpeechPadMs = Math.min(preSpeechPadMs, fitFrames * VAD_FRAME_MS);
    }
    const processor = new FrameProcessor(
      async (frame) => {
        const isSpeech = await infer(frame);
        return { isSpeech, notSpeech: 1 - isSpeech };
      },
      () => this.o.resetModel?.(),
      {
        positiveSpeechThreshold: positive,
        negativeSpeechThreshold: negative,
        redemptionMs: (vad.minSilenceDuration ?? 1.4) * 1000,
        minSpeechMs: (vad.minSpeechDuration ?? 0.4) * 1000,
        preSpeechPadMs,
        submitUserSpeechOnPause: false,
      },
      VAD_FRAME_MS,
    );
    processor.resume();
    const maxSpeechFrames = resolveMaxSpeechFrames(vad.maxSpeechDuration, preSpeechPadMs, limit);
    return {
      processor,
      smart: this.o.smart?.(processor) ?? null,
      maxSpeechFrames,
      maxSegmentSamples: (processor.preSpeechPadFrames + maxSpeechFrames) * VAD_FRAME_SAMPLES,
    };
  }

  /** Input-rate samples that arrived and are not processed yet: queued chunks, and the input held for frames not yet traced. */
  private unprocessedInput(): number {
    let n = this.rawBuf.length;
    for (const op of this.queue) if (op.kind === 'push') n += op.pcm.length;
    return n;
  }

  /** The leg fails: nothing more is accepted or processed, and the frame in hand is discarded. */
  private fail(notice: DetectorNotice): void {
    this.failed = true;
    this.queue = [];
    this.pending = new Float32Array(0);
    this.dropRaw();
    this.generation++;
    if (this.inFlight === 0) this.resetTurn();
    this.o.notify(notice);
  }

  /** No open segment, no pad held, the processor and the Smart Turn gate back to silence. */
  private resetTurn(): void {
    this.open = null;
    this.reopening = null;
    this.recent = [];
    this.held = [];
    this.emptied = false;
    this.speechFrames = 0;
    this.vad?.processor.reset();
    this.vad?.smart?.reset();
  }

  private enqueue(op: Op): void {
    if (this.failed) return;
    this.queue.push(op);
    if (!this.running) this.running = this.run();
  }

  private async run(): Promise<void> {
    for (let op = this.queue.shift(); op; op = this.queue.shift()) {
      const generation = this.generation;
      try {
        await this.apply(op, generation);
      } catch (err) {
        if (this.failed) break;
        // The op belonged to a turn that stop() ended while it was awaiting Silero: its rejection is not the new
        // turn's failure. The turn state is reset, and what queued behind it goes on.
        if (generation !== this.generation) {
          this.resetTurn();
          continue;
        }
        const reason = err instanceof Error ? err.message : String(err);
        this.fail({ type: 'failed', code: 'turn_detection_unavailable', message: `Turn detection failed: ${reason}` });
        break;
      }
    }
    this.running = null;
  }

  private async apply(op: Op, generation: number): Promise<void> {
    switch (op.kind) {
      case 'push':
        this.appendRaw(op.pcm);
        this.append(this.resampler.push(op.pcm));
        await this.frames(generation);
        return;
      case 'cancel':
        if (this.open?.press === op.press) this.open = null;
        this.o.trace({ kind: 'cancel', press: op.press });
        return;
      case 'begin':
        // Always settled first, a press open or not: what a cancelled press or the gap left (the partial frame) is
        // traced, and relayed, before this press starts, so none of it seeds the new one.
        await this.settle(generation);
        if (generation !== this.generation) return;
        if (this.open) this.releasePress();
        this.openAt(this.position, false, op.press);
        return;
      case 'drain':
        await this.settle(generation);
        if (generation !== this.generation) return;
        if (this.open && !(!this.vad && op.press !== undefined && this.open.press !== op.press)) {
          if (this.vad) this.flushOpen(this.vad);
          else this.releasePress();
        }
        this.o.trace({ kind: 'drained' });
        return;
    }
  }

  /** Whole frames of what has arrived. */
  private async frames(generation: number): Promise<void> {
    while (this.pending.length >= VAD_FRAME_SAMPLES) {
      if (generation !== this.generation) return;
      const samples = this.pending.slice(0, VAD_FRAME_SAMPLES);
      this.pending = this.pending.subarray(VAD_FRAME_SAMPLES);
      await this.runFrame(samples, generation);
    }
  }

  /** Everything that has arrived, at once: the resampler flushed, the last partial frame delivered. */
  private async settle(generation: number): Promise<void> {
    this.append(this.resampler.flush());
    await this.frames(generation);
    if (generation !== this.generation || this.pending.length === 0) return;
    const samples = this.pending.slice();
    this.pending = new Float32Array(0);
    await this.runFrame(samples, generation);
  }

  private appendRaw(pcm: Int16Array): void {
    const joined = new Int16Array(this.rawBuf.length + pcm.length);
    joined.set(this.rawBuf);
    joined.set(pcm, this.rawBuf.length);
    this.rawBuf = joined;
  }

  /** Input that never enters the timeline leaves no raw behind: the next frame's raw starts at the grid of the samples processed. */
  private dropRaw(): void {
    this.rawBuf = new Int16Array(0);
    this.rawBase = Math.round((this.position * this.inputRate) / VAD_SAMPLE_RATE);
  }

  /**
   * The input samples that produced the frame ending at `to`: split on the input grid at round(to · rate / 16000),
   * so 512 frames at 16 kHz are 768 samples at 24 kHz; a partial frame (a flush) takes everything received.
   */
  private takeRaw(to: number, partial: boolean): Int16Array {
    const end = partial ? this.rawBuf.length : Math.min(this.rawBuf.length, Math.max(0, Math.round((to * this.inputRate) / VAD_SAMPLE_RATE) - this.rawBase));
    const raw = this.rawBuf.slice(0, end);
    this.rawBuf = this.rawBuf.subarray(end);
    this.rawBase += end;
    return raw;
  }

  private append(samples: Float32Array): void {
    if (samples.length === 0) return;
    const joined = new Float32Array(this.pending.length + samples.length);
    joined.set(this.pending);
    joined.set(samples, this.pending.length);
    this.pending = joined;
  }

  private async runFrame(samples: Float32Array, generation: number): Promise<void> {
    this.inFlight = samples.length;
    try {
      await this.frame(samples, generation);
    } finally {
      this.inFlight = 0;
    }
  }

  /** One frame of up to 512 real samples: the processor, then the trace, then what the frame decided. */
  private async frame(samples: Float32Array, generation: number): Promise<void> {
    const from = this.position;
    const to = from + samples.length;
    const vad = this.vad;
    if (!vad) {
      this.o.trace({ kind: 'frame', from, to, samples, raw: this.takeRaw(to, samples.length < VAD_FRAME_SAMPLES) });
      this.note(to, loudness(samples));
      this.position = to;
      this.capPress();
      return;
    }
    const { processor, smart } = vad;
    let input = samples;
    if (samples.length < VAD_FRAME_SAMPLES) {
      input = new Float32Array(VAD_FRAME_SAMPLES);
      input.set(samples);
    }
    const wasSpeaking = processor.speaking;
    this.emptied = false;
    const events: FrameProcessorEvent[] = [];
    await processor.process(input, (ev) => events.push(ev));
    // stop() or a failure came while the processor was working: the frame belongs to a turn that is over.
    if (generation !== this.generation) {
      this.resetTurn();
      return;
    }
    this.o.trace({ kind: 'frame', from, to, samples, raw: this.takeRaw(to, samples.length < VAD_FRAME_SAMPLES) });

    let probability = 0;
    for (const ev of events) if (ev.msg === Message.FrameProcessed) probability = ev.probs.isSpeech;
    this.note(to, probability);
    if (this.open?.continuation && probability >= processor.options.negativeSpeechThreshold) this.open.heard = true;

    for (const ev of events) {
      switch (ev.msg) {
        case Message.SpeechStart:
          this.speechFrames = 0;
          this.o.notify({ type: 'speech_start' });
          // Inside a continuation the turn is already open.
          if (!this.open) this.openAt(Math.max(this.held[0] ?? from, this.lastCloseTo), false);
          break;
        case Message.SpeechEnd:
          this.speechFrames = 0;
          this.close(to, 'silence');
          break;
        case Message.VADMisfire:
          this.speechFrames = 0;
          if (this.current().continuation) this.close(to, 'silence');
          // The gate hands back a short reply after a Smart end that Normal would have kept.
          else if (smart?.rescue()) this.close(to, 'kept');
          else this.drop(to);
          break;
      }
    }

    const smartTurnProbability = smart?.afterFrame(input, probability, processor.speaking) ?? null;
    // The gate answers only while the processor is speaking, so a segment is open.
    if (smartTurnProbability !== null && this.open) {
      // No smart.reset(): the gate reset itself, keeping the wait Normal still owed (TurnGate.endedBySmart).
      if (this.counts(this.endSegment(processor))) this.close(to, 'smart', smartTurnProbability);
      else this.drop(to);
    }

    let cap = false;
    if (processor.speaking) cap = ++this.speechFrames >= vad.maxSpeechFrames;
    else this.speechFrames = 0;
    if (this.open && to - this.open.at >= vad.maxSegmentSamples) cap = true;
    if (cap) this.cut(vad, to);

    // Normal's silence rule for a continuation the processor is not speaking in.
    const open = this.open;
    if (open?.continuation && open.at < to && !processor.speaking) {
      if (probability >= processor.options.positiveSpeechThreshold) open.quiet = 0;
      else if (probability < processor.options.negativeSpeechThreshold && ++open.quiet >= processor.redemptionFrames) {
        if (open.heard) this.close(to, 'silence');
        else this.drop(to);
      }
    }

    // The processor keeps up to its pad of frames while it is not speaking, and none just after a segment ended.
    if (processor.speaking || wasSpeaking || this.emptied) {
      this.held = [];
    } else {
      this.held.push(from);
      if (this.held.length > processor.preSpeechPadFrames) this.held.shift();
    }
    this.position = to;
  }

  /**
   * The cap: end the segment and go on with the turn from the cut. With capAtPause the cut is after the last frame of
   * the cap's last quarter that Silero calls silence (else the quietest one), and what was heard between it and the cap
   * belongs to the continuation.
   */
  private cut(vad: Vad, to: number): void {
    const kept = this.counts(this.endSegment(vad.processor));
    if (!kept) {
      this.drop(to);
      vad.smart?.reset();
      return;
    }
    // Of the frames Silero calls silence, the latest: what lies between two pauses (a half-heard word, say) stays at
    // the end of this piece rather than opening the next. With none, the quietest frame.
    const silence = vad.processor.options.negativeSpeechThreshold;
    const at = this.pauseBefore(this.current().at, to, (scores) => {
      for (let i = scores.length - 1; i >= 0; i--) if (scores[i] < silence) return i;
      return quietest(scores);
    });
    this.reopening = at;
    this.close(at, 'cap');
    vad.smart?.reset();
    this.openAt(at, true);
    const after = this.recent.filter((frame) => frame.end > at);
    if (after.some((frame) => frame.score >= vad.processor.options.negativeSpeechThreshold)) this.open!.heard = true;
  }

  /**
   * A press runs to the engine's limit, then goes on from the cut as the same press. No VAD, no minSpeech, no Smart.
   * With capAtPause the cut is after the quietest frame of the last quarter, if it is clearly quieter than the rest.
   */
  private capPress(): void {
    for (let open = this.open; open && this.position - open.at >= this.pressCapSamples; open = this.open) {
      const cap = open.at + this.pressCapSamples;
      const cut = this.pauseBefore(open.at, cap, (scores) => {
        const best = quietest(scores);
        const median = [...scores].sort((a, b) => a - b)[Math.floor(scores.length / 2)];
        return scores[best] < PRESS_PAUSE_LOUDNESS * median ? best : null;
      });
      this.reopening = cut;
      this.close(cut, 'cap');
      this.openAt(cut, false, open.press);
    }
  }

  /**
   * Where a cap at `cap` cuts: the end of the frame `pick` chooses among the frames that end in its last quarter, after
   * `from`, oldest first; `cap` itself without capAtPause, with no such frame, or when `pick` finds no pause. A press
   * whose frames no longer meet its cap (a partial frame settled inside it) still has frames that end before it.
   */
  private pauseBefore(from: number, cap: number, pick: (scores: number[]) => number | null): number {
    if (this.lookbackFrames === 0) return cap;
    const reach = cap - this.lookbackFrames * VAD_FRAME_SAMPLES;
    const window = this.recent.filter((frame) => frame.end > Math.max(from, reach) && frame.end <= cap);
    if (window.length === 0) return cap;
    const chosen = pick(window.map((frame) => frame.score));
    return chosen === null ? cap : window[chosen].end;
  }

  /** capAtPause: remembers how quiet the frame ending at `end` was, for the latest `lookbackFrames` frames. */
  private note(end: number, score: number): void {
    if (this.lookbackFrames === 0) return;
    this.recent.push({ end, score });
    if (this.recent.length > this.lookbackFrames) this.recent.shift();
  }

  /** A release: the press ends with the samples it has; with none, the empty segment is dropped (in the trace only, so every open ends). */
  private releasePress(): void {
    if (this.position > this.current().at) this.close(this.position, 'release');
    else this.drop(this.position);
  }

  /** A drain: the open segment ends with what has arrived. */
  private flushOpen(vad: Vad): void {
    const to = this.position;
    if (this.counts(this.endSegment(vad.processor))) this.close(to, 'flush');
    else if (!this.current().continuation && vad.smart?.rescue()) this.close(to, 'kept');
    else this.drop(to);
    vad.smart?.reset();
  }

  /** The processor's endSegment(): SpeechEnd, VADMisfire, or nothing when it was not speaking. */
  private endSegment(processor: FrameProcessor): Message | null {
    let ended: Message | null = null;
    processor.endSegment((ev) => {
      if (ev.msg === Message.SpeechEnd || ev.msg === Message.VADMisfire) ended = ev.msg;
    });
    this.held = [];
    this.emptied = true;
    this.speechFrames = 0;
    return ended;
  }

  /**
   * Whether the open segment, ended by the core, is a segment: a continuation when anything was heard
   * since the cut (it has no minSpeech check), otherwise when the processor did not call it a misfire.
   */
  private counts(ended: Message | null): boolean {
    const open = this.current();
    return open.continuation ? open.heard : ended === Message.SpeechEnd;
  }

  private current(): OpenSegment {
    if (!this.open) throw new Error('TurnDetectorCore: the processor ended a segment the core did not open');
    return this.open;
  }

  private openAt(at: number, continuation: boolean, press?: number): void {
    this.reopening = null;
    this.open = { at, press, continuation, heard: false, quiet: 0 };
    this.o.trace({ kind: 'open', at, ...(press !== undefined ? { press } : {}) });
  }

  private close(to: number, endedBy: SegmentEndedBy, smartTurnProbability?: number): void {
    const { at, press } = this.current();
    this.open = null;
    this.lastCloseTo = to;
    this.o.trace({
      kind: 'close',
      from: at,
      to,
      endedBy,
      ...(press !== undefined ? { press } : {}),
      ...(smartTurnProbability !== undefined ? { smartTurnProbability } : {}),
    });
  }

  private drop(to: number): void {
    const { at } = this.current();
    this.open = null;
    this.o.trace({ kind: 'drop', from: at, to });
  }
}

/** The index of the lowest score, the latest of equals: the cut keeps as much of the piece as it can. */
function quietest(scores: number[]): number {
  let best = scores.length - 1;
  for (let i = scores.length - 2; i >= 0; i--) if (scores[i] < scores[best]) best = i;
  return best;
}

/** A frame's loudness: the root mean square of its samples. */
function loudness(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
}
