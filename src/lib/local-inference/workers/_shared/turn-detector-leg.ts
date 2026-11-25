/**
 * One leg's turn detection: the core and what the recognizer takes, composed: the segment assembler (`segments`)
 * or the marks relay (`marks`). Each can raise a `failed` notice of its own (the input backlog, the decode
 * queue, a Silero error mid-leg). The leg posts the first one only. On it the core is stopped (no more input,
 * no more `speech_start`) and the output is muted, so nothing more reaches the recognizer either; later
 * failures are ignored.
 */
import { MarksRelay } from './marks-relay';
import { SegmentAssembler } from './segment-assembler';
import { TurnDetectorCore, type TurnDetectorCoreOptions } from './turn-detector-core';
import { INITIAL_EPOCH, type DetectorDelivery, type DetectorNotice, type DetectorOutput, type MarksOutput, type RecognizerTaken } from './turn-detector-protocol';

export interface DetectorLegOptions {
  core: Omit<TurnDetectorCoreOptions, 'trace' | 'notify'>;
  /** The ordered port to the recognizer. */
  post(msg: DetectorOutput | MarksOutput, transfer: Transferable[]): void;
  /** What the recognizer takes; segments when absent. */
  delivery?: DetectorDelivery;
  /** `speech_start`, and the leg's one `failed`. */
  notify(notice: DetectorNotice): void;
  epoch?: number;
}

export class DetectorLeg {
  readonly core: TurnDetectorCore;
  private readonly assembler: SegmentAssembler | null;
  private readonly relay: MarksRelay | null;
  private failed = false;
  /** The epoch the leg is in; a stop that does not raise it changes nothing, on either end (it starts where the recognizer's does). */
  private epoch: number;

  constructor(private readonly o: DetectorLegOptions) {
    this.epoch = o.epoch ?? INITIAL_EPOCH;
    const marks = o.delivery === 'marks';
    this.assembler = marks ? null : new SegmentAssembler({
      post: (msg, transfer) => { if (!this.failed) o.post(msg, transfer); },
      notify: (notice) => this.notice(notice),
      earliestNeeded: () => this.core.earliestNeeded(),
      epoch: o.epoch,
    });
    this.relay = marks ? new MarksRelay((out) => {
      if (this.failed) return;
      if (out.type === 'mark') { o.post(out, []); return; }
      // The relay hands out views into the frame it holds (a split frame is two views of one buffer): a copy is what goes over.
      const pcm = out.pcm.slice();
      o.post({ type: 'audio', pcm }, [pcm.buffer]);
    }) : null;
    this.core = new TurnDetectorCore({
      ...o.core,
      trace: (event) => {
        if (this.failed) return;
        this.assembler?.trace(event);
        this.relay?.trace(event);
      },
      notify: (notice) => this.notice(notice),
    });
  }

  /** Once the leg has failed these reach nothing: the core takes no more input and Silero is not asked again. */
  push(pcm: Int16Array): void { if (!this.failed) this.core.push(pcm); }
  drain(press?: number): void { if (!this.failed) this.core.drain(press); }
  begin(press: number): void { if (!this.failed) this.core.begin(press); }
  cancel(press: number): void { if (!this.failed) this.core.cancel(press); }
  taken(msg: RecognizerTaken): void { this.assembler?.taken(msg); }
  stop(epoch: number): void {
    // Not a raise: the turn in hand is not lost (the segment inbox and the assembler ignore it as well).
    if (epoch <= this.epoch) return;
    this.epoch = epoch;
    this.core.stop();
    this.assembler?.stop(epoch);
    this.relay?.stop();
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
