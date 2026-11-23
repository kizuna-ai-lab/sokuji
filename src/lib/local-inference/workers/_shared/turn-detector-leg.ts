/**
 * One leg's turn detection: the core and the segment assembler, composed. Each can raise a `failed`
 * notice of its own (the input backlog, the decode queue, a Silero error mid-leg). The leg posts the
 * first one only. On it the core is stopped (no more input, no more `speech_start`) and the assembler
 * is muted, so nothing more reaches the recognizer either; later failures are ignored.
 */
import { SegmentAssembler } from './segment-assembler';
import { TurnDetectorCore, type TurnDetectorCoreOptions } from './turn-detector-core';
import type { DetectorNotice, DetectorOutput, RecognizerTaken } from './turn-detector-protocol';

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

  constructor(private readonly o: DetectorLegOptions) {
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

  push(pcm: Int16Array): void { this.core.push(pcm); }
  drain(): void { this.core.drain(); }
  begin(press: number): void { this.core.begin(press); }
  cancel(press: number): void { this.core.cancel(press); }
  taken(msg: RecognizerTaken): void { this.assembler.taken(msg); }
  stop(epoch: number): void {
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
