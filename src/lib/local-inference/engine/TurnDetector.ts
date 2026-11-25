/**
 * TurnDetector: the main thread's side of the turn detector worker. It feeds the leg's audio and
 * presses to the worker and hears back `speech_start` and the leg's one failure. The segments go
 * to the recognizer on the `output` port, not through here.
 */
import type { VadWebConfig } from '../types';
import type { SegmentLimit } from '../workers/_shared/max-speech-frames';
import { DETECTOR_INPUT_SAMPLE_RATE, type DetectorDelivery, type DetectorInbound, type DetectorInitMessage, type DetectorOutbound, type TurnFailureCode } from '../workers/_shared/turn-detector-protocol';
import { WorkerSession } from './WorkerSession';

export interface TurnDetectorInit {
  turns: 'auto' | 'manual';
  vad: VadWebConfig;
  limit: SegmentLimit;
  /** What the recognizer takes: segments (default), or the audio with marks. */
  delivery?: DetectorDelivery;
  /** To the recognizer; transferred. */
  output: MessagePort;
  /** Smart Turn's port; transferred. */
  turnPort?: MessagePort;
}

/** `init` failed for a reason the leg reports as its own (C3). */
export class TurnDetectorError extends Error {
  constructor(message: string, readonly code: TurnFailureCode) {
    super(message);
    this.name = 'TurnDetectorError';
  }
}

/** The sample rate the leg's audio arrives at; the worker's resampler takes it as input rate. */
const INPUT_SAMPLE_RATE = DETECTOR_INPUT_SAMPLE_RATE;

export class TurnDetector {
  private session: WorkerSession | null = null;
  private failedOnce = false;

  onSpeechStart: (() => void) | null = null;
  /** The leg's one failure; fires at most once. */
  onFailed: ((failure: { code: TurnFailureCode; message: string }) => void) | null = null;
  /** The worker died after it was ready. */
  onFatal: ((error: string) => void) | null = null;

  async init(o: TurnDetectorInit): Promise<{ loadTimeMs: number }> {
    this.dispose();
    this.failedOnce = false;
    const session = new WorkerSession({
      makeWorker: () => new Worker(new URL('../workers/turn-detector.worker.ts', import.meta.url), { type: 'module' }),
      onFatalError: (message) => {
        // Before ready the rejection of init() reports it.
        if (session.ready) this.onFatal?.(message);
      },
      onMessage: (msg: DetectorOutbound) => {
        switch (msg.type) {
          case 'speech_start':
            this.onSpeechStart?.();
            break;
          case 'failed':
            if (this.failedOnce) break;
            this.failedOnce = true;
            this.onFailed?.({ code: msg.code, message: msg.message });
            break;
          case 'error':
            this.onFatal?.(msg.error);
            break;
        }
      },
    });
    this.session = session;
    const init: DetectorInitMessage = {
      type: 'init',
      turns: o.turns,
      vad: o.vad,
      limit: o.limit,
      ...(o.delivery ? { delivery: o.delivery } : {}),
      output: o.output,
      turnPort: o.turnPort,
      ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
      vadModelUrl: new URL('./wasm/vad/silero_vad_v5.onnx', window.location.href).href,
    };
    try {
      const ready = await session.start(init, o.turnPort ? [o.output, o.turnPort] : [o.output]);
      return { loadTimeMs: ready.loadTimeMs };
    } catch (err) {
      const code = (err as { code?: TurnFailureCode } | null)?.code;
      if (code) throw new TurnDetectorError((err as Error).message, code);
      throw err;
    }
  }

  /** The buffer is transferred: the caller keeps no use of `pcm`. */
  feedAudio(pcm: Int16Array): void {
    this.post({ type: 'audio', pcm, sampleRate: INPUT_SAMPLE_RATE }, [pcm.buffer]);
  }
  begin(press: number): void { this.post({ type: 'begin', press }); }
  drain(press?: number): void { this.post({ type: 'drain', press }); }
  cancel(press: number): void { this.post({ type: 'cancel', press }); }
  stop(epoch: number): void { this.post({ type: 'stop', epoch }); }

  get ready(): boolean {
    return this.session?.ready ?? false;
  }

  dispose(): void {
    this.session?.dispose();
    this.session = null;
  }

  private post(msg: DetectorInbound, transfer?: Transferable[]): void {
    if (!this.session?.ready) return;
    this.session.post(msg, transfer);
  }
}
