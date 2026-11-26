/**
 * The recognizer's end of the detector's port: segments are decoded one at a
 * time in arrival order (the port is ordered), each acknowledged `taken` when
 * its decode starts or when it is dropped, so the detector's decode-queue bound
 * frees it. A stop raises the epoch and drops the older one's queued segments;
 * a cancel drops that press's segments not yet started; a drain mark is
 * answered once everything before it is decoded or dropped (C2, C3).
 *
 * `seq` is monotonic across epochs, so it is only ever compared for identity.
 */
import type { SegmentEnd } from '../../types';
import { INITIAL_EPOCH, type DetectorOutput, type DetectorSegment, type RecognizerTaken } from './turn-detector-protocol';

/** What a decode learns about its segment besides the audio and where it starts; `seq` is the detector's, for logs. */
export interface DecodeTag extends SegmentEnd {
  press?: number;
  epoch: number;
  seq: number;
}

type Item = DetectorSegment | { type: 'drained'; epoch: number; seq: number };

export class SegmentInbox {
  private queue: Item[] = [];
  /** Starts where the detector does, so `stop(INITIAL_EPOCH)` is the no-op it is on that end; any epoch is accepted until a stop raises this. */
  private epoch = INITIAL_EPOCH;
  private pumping: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly port: MessagePort,
    private readonly decode: (audio: Float32Array, startSample: number, tag: DecodeTag) => Promise<void>,
    private readonly toMain: (msg: { type: 'drained'; epoch: number; seq: number }) => void,
    /**
     * A decode threw or rejected (a lost WebGPU device, say). Required: the segment was acked `taken` before
     * it started, so without this a failed decode is invisible to everyone. Called once per failing segment.
     */
    private readonly onDecodeError: (err: unknown, tag: DecodeTag) => void,
  ) {
    port.onmessage = (e: MessageEvent<DetectorOutput>) => this.receive(e.data);
  }

  /** Segments of an older epoch are dropped (and acked); their drained marks stay unanswered. */
  stop(epoch: number): void {
    if (epoch <= this.epoch) return;
    this.epoch = epoch;
    this.queue = this.queue.filter((item) => {
      if (item.epoch >= epoch) return true;
      if (item.type === 'segment') this.ack(item);
      return false;
    });
  }

  /** Stops listening; resolves when the decode in flight has finished. Whatever still waits is dropped. */
  async close(): Promise<void> {
    this.closed = true;
    this.port.onmessage = null;
    this.queue = [];
    this.port.close();
    await this.pumping;
  }

  private receive(msg: DetectorOutput): void {
    if (this.closed) return;
    switch (msg.type) {
      case 'segment':
        if (msg.epoch < this.epoch) {
          this.ack(msg);
          return;
        }
        this.queue.push(msg);
        break;
      case 'drained':
        this.queue.push(msg);
        break;
      case 'cancel':
        if (msg.epoch < this.epoch) return;
        this.queue = this.queue.filter((item) => {
          if (item.type !== 'segment' || item.epoch !== msg.epoch || item.press !== msg.press) return true;
          this.ack(item);
          return false;
        });
        return;
    }
    this.pumping ??= this.pump().finally(() => { this.pumping = null; });
  }

  private ack(seg: { epoch: number; seq: number }): void {
    if (this.closed) return;
    const taken: RecognizerTaken = { type: 'taken', epoch: seg.epoch, seq: seg.seq };
    this.port.postMessage(taken);
  }

  private async pump(): Promise<void> {
    let item: Item | undefined;
    while (!this.closed && (item = this.queue.shift())) {
      if (item.epoch < this.epoch) {
        if (item.type === 'segment') this.ack(item);
        continue;
      }
      if (item.type === 'drained') {
        // A closed main port must not reject the pump: the queue behind this mark still runs.
        try { this.toMain({ type: 'drained', epoch: item.epoch, seq: item.seq }); } catch { /* best-effort */ }
        continue;
      }
      this.ack(item);
      const { audio, start, epoch, seq, press, endedBy, smartTurnProbability } = item;
      const tag: DecodeTag = {
        epoch, seq, endedBy,
        ...(press !== undefined ? { press } : {}),
        ...(smartTurnProbability !== undefined ? { smartTurnProbability } : {}),
      };
      try {
        await this.decode(audio, start, tag);
      } catch (err) {
        // The segment was acked before it started, so the detector is not wedged. Whatever the decode
        // published before failing is its own business; the inbox publishes nothing for a failed one. The
        // segments behind it still run (a transient failure should not eat the rest of a turn), and drained
        // marks are still answered. A reporter that throws must not stop the queue either.
        try { this.onDecodeError(err, tag); } catch { /* reporting is best-effort */ }
      }
    }
  }
}
