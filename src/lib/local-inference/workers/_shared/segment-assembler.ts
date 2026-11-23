/**
 * The segments output, built from the core's trace: a close becomes the audio
 * of its interval, cancels and drains pass through, all in trace order on one
 * port. The audio is cut from what the frames carried, so a segment is exactly
 * the timeline's samples `[start, end)`.
 */
import { FrameLog } from './frame-log';
import type { DetectorNotice, DetectorOutput, DetectorSegment, TurnTrace } from './turn-detector-protocol';

export interface SegmentAssemblerOptions {
  post(msg: DetectorOutput, transfer: Transferable[]): void;
  notify(notice: DetectorNotice): void;
  /** The earliest position a later segment may start at (`TurnDetectorCore.earliestNeeded`). */
  earliestNeeded(): number;
  epoch?: number;
}

export class SegmentAssembler {
  private readonly log = new FrameLog();
  private readonly epoch: number;
  private seq = 0;

  constructor(private readonly o: SegmentAssemblerOptions) {
    this.epoch = o.epoch ?? 1;
  }

  trace(event: TurnTrace): void {
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
        this.o.post(segment, [audio.buffer]);
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
}
