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
 */
import { FrameProcessor, Message } from '@ricky0123/vad-web';
import type { FrameProcessorEvent } from '@ricky0123/vad-web/dist/frame-processor';
import type { VadWebConfig } from '../../types';
import { resolveMaxSpeechFrames, VAD_FRAME_SAMPLES, VAD_SAMPLE_RATE, type SegmentLimit } from './max-speech-frames';
import { TimelineResampler } from './timeline-resampler';
import type { DetectorNotice, SegmentEndedBy, TurnTrace } from './turn-detector-protocol';
import type { FrameProcessorParams, TurnLink } from './turn-gate';
import { resolveVadThresholds } from './vad-thresholds';

const VAD_FRAME_MS = (VAD_FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000;

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
}

type Op = { kind: 'push'; pcm: Int16Array } | { kind: 'drain' };

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
  /** Resampled samples not processed yet: under a frame between ops. */
  private pending = new Float32Array(0);
  /** Samples processed; the next frame starts here. */
  private position = 0;
  private open: OpenSegment | null = null;
  private lastCloseTo = 0;
  /** Where the frames the processor holds as pre-speech pad start, oldest first (TurnGate.push's count, as positions). */
  private held: number[] = [];
  /** The processor's buffer was emptied during the frame in hand. */
  private emptied = false;
  /** Frames since the processor's SpeechStart, counted as the workers count them for the cap. */
  private speechFrames = 0;

  constructor(private readonly o: TurnDetectorCoreOptions) {
    this.resampler = new TimelineResampler(o.inputRate);
    this.vad = o.turns === 'auto' ? this.createVad() : null;
  }

  push(pcm: Int16Array): void {
    this.enqueue({ kind: 'push', pcm });
  }

  /** Processes what has arrived, the last partial frame included, closes the open segment (`flush`), then `drained`. */
  drain(): void {
    this.enqueue({ kind: 'drain' });
  }

  /** Drops the queue at once; the frame in hand finishes. */
  stop(): void {
    this.queue = [];
    this.generation++;
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
    if (this.open) return this.open.at;
    return Math.max(this.lastCloseTo, this.held[0] ?? this.position);
  }

  private createVad(): Vad {
    const { infer, vad, limit } = this.o;
    if (!infer) throw new Error('TurnDetectorCore: automatic turns need infer');
    // As the vad-web workers' initVad built it.
    const { positive, negative } = resolveVadThresholds(vad);
    const preSpeechPadMs = (vad.preSpeechPadDuration ?? 0.8) * 1000;
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

  private enqueue(op: Op): void {
    if (this.failed) return;
    this.queue.push(op);
    if (!this.running) this.running = this.run();
  }

  private async run(): Promise<void> {
    for (let op = this.queue.shift(); op; op = this.queue.shift()) {
      try {
        await this.apply(op, this.generation);
      } catch (err) {
        this.failed = true;
        this.queue = [];
        const reason = err instanceof Error ? err.message : String(err);
        this.o.notify({ type: 'failed', code: 'turn_detection_unavailable', message: `Turn detection failed: ${reason}` });
        break;
      }
    }
    this.running = null;
  }

  private async apply(op: Op, generation: number): Promise<void> {
    this.append(op.kind === 'push' ? this.resampler.push(op.pcm) : this.resampler.flush());
    while (this.pending.length >= VAD_FRAME_SAMPLES) {
      if (generation !== this.generation) return;
      const samples = this.pending.slice(0, VAD_FRAME_SAMPLES);
      this.pending = this.pending.subarray(VAD_FRAME_SAMPLES);
      await this.frame(samples);
    }
    if (op.kind === 'push' || generation !== this.generation) return;
    if (this.pending.length > 0) {
      const samples = this.pending.slice();
      this.pending = new Float32Array(0);
      await this.frame(samples);
      if (generation !== this.generation) return;
    }
    if (this.open && this.vad) this.flushOpen(this.vad);
    this.o.trace({ kind: 'drained' });
  }

  private append(samples: Float32Array): void {
    if (samples.length === 0) return;
    const joined = new Float32Array(this.pending.length + samples.length);
    joined.set(this.pending);
    joined.set(samples, this.pending.length);
    this.pending = joined;
  }

  /** One frame of up to 512 real samples: the processor, then the trace, then what the frame decided. */
  private async frame(samples: Float32Array): Promise<void> {
    const from = this.position;
    const to = from + samples.length;
    const vad = this.vad;
    if (!vad) {
      this.o.trace({ kind: 'frame', from, to, samples });
      this.position = to;
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
    this.o.trace({ kind: 'frame', from, to, samples });

    let probability = 0;
    for (const ev of events) if (ev.msg === Message.FrameProcessed) probability = ev.probs.isSpeech;
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

  /** The cap: end the segment here and go on with the turn from the cut. */
  private cut(vad: Vad, to: number): void {
    const kept = this.counts(this.endSegment(vad.processor));
    if (kept) this.close(to, 'cap');
    else this.drop(to);
    vad.smart?.reset();
    if (kept) this.openAt(to, true);
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

  private openAt(at: number, continuation: boolean): void {
    this.open = { at, continuation, heard: false, quiet: 0 };
    this.o.trace({ kind: 'open', at });
  }

  private close(to: number, endedBy: SegmentEndedBy, smartTurnProbability?: number): void {
    const { at } = this.current();
    this.open = null;
    this.lastCloseTo = to;
    this.o.trace({
      kind: 'close',
      from: at,
      to,
      endedBy,
      ...(smartTurnProbability !== undefined ? { smartTurnProbability } : {}),
    });
  }

  private drop(to: number): void {
    const { at } = this.current();
    this.open = null;
    this.o.trace({ kind: 'drop', from: at, to });
  }
}
