/**
 * The segments output, built from the core's trace: a close becomes the audio
 * of its interval, cancels and drains pass through, all in trace order on one
 * port. The audio is cut from what the frames carried, so a segment is exactly
 * the timeline's samples `[start, end)`.
 */
import { FrameLog } from './frame-log';
import { VAD_SAMPLE_RATE } from './max-speech-frames';
import {
  DECODE_QUEUE_SECONDS,
  DECODE_QUEUE_SEGMENTS,
  overloadedNotice,
  type DetectorNotice,
  type DetectorOutput,
  type DetectorSegment,
  type RecognizerTaken,
  type TurnTrace,
} from './turn-detector-protocol';

export interface SegmentAssemblerOptions {
  post(msg: DetectorOutput, transfer: Transferable[]): void;
  notify(notice: DetectorNotice): void;
  /** The earliest position a later segment may start at (`TurnDetectorCore.earliestNeeded`). */
  earliestNeeded(): number;
  epoch?: number;
}

export class SegmentAssembler {
  private readonly log = new FrameLog();
  private epoch: number;
  private seq = 0;
  /** Segments of this epoch posted and not yet `taken`, seq → samples. */
  private waiting = new Map<number, number>();
  /** The leg failed: nothing more is posted. */
  private failed = false;

  constructor(private readonly o: SegmentAssemblerOptions) {
    this.epoch = o.epoch ?? 1;
  }

  /** The recognizer started decoding `seq`; an older epoch's ack is ignored. */
  taken(msg: RecognizerTaken): void {
    if (msg.epoch === this.epoch) this.waiting.delete(msg.seq);
  }

  /** Raises the epoch: what was waiting no longer counts, and what follows is the new epoch's. */
  stop(epoch: number): void {
    this.epoch = epoch;
    this.waiting.clear();
  }

  trace(event: TurnTrace): void {
    if (this.failed) return;
    switch (event.kind) {
      case 'frame':
        this.log.append(event.samples);
        break;
      case 'close': {
        const audio = this.log.slice(event.from, event.to);
        const segment: DetectorSegment = {
          type: 'segment',
          epoch: this.epoch,
          seq: ++this.seq,
          ...(event.press !== undefined ? { press: event.press } : {}),
          audio,
          start: event.from,
          end: event.to,
          endedBy: event.endedBy,
          ...(event.smartTurnProbability !== undefined ? { smartTurnProbability: event.smartTurnProbability } : {}),
        };
        // Counted before the post: a transfer detaches the buffer, and its length reads 0 afterwards.
        const samples = audio.length;
        this.o.post(segment, [audio.buffer]);
        this.waiting.set(segment.seq, samples);
        this.checkDecodeQueue(samples);
        break;
      }
      case 'cancel':
        this.o.post({ type: 'cancel', epoch: this.epoch, seq: ++this.seq, press: event.press }, []);
        break;
      case 'drained':
        this.o.post({ type: 'drained', epoch: this.epoch, seq: ++this.seq }, []);
        break;
      case 'open':
      case 'drop':
        break;
    }
    // After every event, not only a close: through a long silence nothing closes, and the
    // log would otherwise keep all of it.
    this.log.trimBefore(this.o.earliestNeeded());
  }

  /** At most DECODE_QUEUE_SEGMENTS wait, and at most DECODE_QUEUE_SECONDS of audio ahead of the newest one (C3). */
  private checkDecodeQueue(newest: number): void {
    let ahead = 0;
    for (const samples of this.waiting.values()) ahead += samples;
    ahead -= newest;
    if (this.waiting.size > DECODE_QUEUE_SEGMENTS || ahead > DECODE_QUEUE_SECONDS * VAD_SAMPLE_RATE) {
      this.failed = true;
      this.waiting.clear();
      this.o.notify(overloadedNotice());
    }
  }
}
