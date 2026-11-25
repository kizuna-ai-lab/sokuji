/**
 * One leg's turn detection: the core and the segment assembler, composed. Each can raise a `failed`
 * notice of its own (the input backlog, the decode queue, a Silero error mid-leg). The leg posts the
 * first one only. On it the core is stopped (no more input, no more `speech_start`) and the assembler
 * is muted, so nothing more reaches the recognizer either; later failures are ignored.
 */
import { SegmentAssembler } from './segment-assembler';
import { TurnDetectorCore, type TurnDetectorCoreOptions } from './turn-detector-core';
import { INITIAL_EPOCH, type DetectorNotice, type DetectorOutput, type RecognizerTaken } from './turn-detector-protocol';

export interface DetectorLegOptions {
  core: Omit<TurnDetectorCoreOptions, 'trace' | 'notify'>;
  /** The ordered port to the recognizer. */
  post(msg: DetectorOutput, transfer: Transferable[]): void;
  /** `speech_start`, and the leg's one `failed`. */
  notify(notice: DetectorNotice): void;
  epoch?: number;
}

export class DetectorLeg {
  readonly core: TurnDetectorCore;
  private readonly assembler: SegmentAssembler;
  private failed = false;
  /** The epoch the leg is in; a stop that does not raise it changes nothing, on either end (it starts where the recognizer's does). */
  private epoch: number;

  constructor(private readonly o: DetectorLegOptions) {
    this.epoch = o.epoch ?? INITIAL_EPOCH;
    this.assembler = new SegmentAssembler({
      post: (msg, transfer) => { if (!this.failed) o.post(msg, transfer); },
      notify: (notice) => this.notice(notice),
      earliestNeeded: () => this.core.earliestNeeded(),
      epoch: o.epoch,
    });
    this.core = new TurnDetectorCore({
      ...o.core,
      trace: (event) => { if (!this.failed) this.assembler.trace(event); },
      notify: (notice) => this.notice(notice),
    });
  }

  /** Once the leg has failed these reach nothing: the core takes no more input and Silero is not asked again. */
  push(pcm: Int16Array): void { if (!this.failed) this.core.push(pcm); }
  drain(press?: number): void { if (!this.failed) this.core.drain(press); }
  begin(press: number): void { if (!this.failed) this.core.begin(press); }
  cancel(press: number): void { if (!this.failed) this.core.cancel(press); }
  taken(msg: RecognizerTaken): void { this.assembler.taken(msg); }
  stop(epoch: number): void {
    // Not a raise: the turn in hand is not lost (the segment inbox and the assembler ignore it as well).
    if (epoch <= this.epoch) return;
    this.epoch = epoch;
    this.core.stop();
    this.assembler.stop(epoch);
  }

  private notice(notice: DetectorNotice): void {
    if (this.failed) return;
    if (notice.type === 'failed') {
      this.failed = true;
      this.core.stop();
    }
    this.o.notify(notice);
  }
}
