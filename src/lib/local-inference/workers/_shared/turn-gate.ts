/** Smart Turn's gate in a VAD worker: after a short silence it asks whether the speaker is done. */
import type { VadWebConfig } from '../../types';
import { VAD_FRAME_SAMPLES, VAD_SAMPLE_RATE } from './max-speech-frames';
import { TURN_WINDOW_SAMPLES, type TurnPredictAnswer, type TurnPredictRequest } from './turn-protocol';

const FRAME_MS = (VAD_FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000;

export interface TurnGateOptions {
  /** Consecutive frames under the negative threshold before it asks. */
  triggerFrames: number;
  /** A probability above this ends the segment. */
  threshold: number;
  positiveThreshold: number;
  negativeThreshold: number;
  /** The FrameProcessor's own pre-speech pad, in frames. */
  preSpeechPadFrames: number;
  /** The FrameProcessor's misfire floor: with fewer speech frames it would drop the segment. */
  minSpeechFrames: number;
}

export interface FrameProcessorParams {
  preSpeechPadFrames: number;
  minSpeechFrames: number;
  options: { positiveSpeechThreshold: number; negativeSpeechThreshold: number };
}

export interface TurnRequest {
  id: number;
  window: Float32Array;
}

export class TurnGate {
  private readonly audio = new Float32Array(TURN_WINDOW_SAMPLES);
  private samplesFed = 0;
  private speaking = false;
  /** Frames the FrameProcessor holds as pre-speech pad while it is not speaking. */
  private padFrames = 0;
  private segmentStart = 0;
  /** Frames at or above the positive threshold since the segment started, as the processor counts them. */
  private speechFrames = 0;
  private silentRun = 0;
  private lastId = 0;
  private openId: number | null = null;

  constructor(private readonly opts: TurnGateOptions) {}

  /** One frame, after FrameProcessor.process() returned; `speaking` is the processor's state after it. */
  push(frame: Float32Array, probability: number, speaking: boolean): TurnRequest | null {
    const frameStart = this.samplesFed;
    this.write(frame);
    if (!speaking) {
      this.padFrames = this.speaking ? 0 : Math.min(this.padFrames + 1, this.opts.preSpeechPadFrames);
      this.speaking = false;
      this.silentRun = 0;
      this.openId = null;
      return null;
    }
    if (!this.speaking) {
      this.speaking = true;
      this.segmentStart = frameStart - this.padFrames * frame.length;
      this.speechFrames = 0;
      this.silentRun = 0;
    }
    if (probability >= this.opts.positiveThreshold) {
      this.speechFrames++;
      this.silentRun = 0;
      this.openId = null;
      return null;
    }
    if (probability >= this.opts.negativeThreshold) {
      this.silentRun = 0;
      return null;
    }
    if (++this.silentRun !== this.opts.triggerFrames || this.speechFrames < this.opts.minSpeechFrames) return null;
    this.openId = ++this.lastId;
    return { id: this.openId, window: this.window() };
  }

  shouldEnd(id: number, probability: number): boolean {
    return this.speaking && id === this.openId && probability > this.opts.threshold;
  }

  /** The worker ended the segment with endSegment(): the FrameProcessor holds nothing now. */
  reset(): void {
    this.speaking = false;
    this.padFrames = 0;
    this.speechFrames = 0;
    this.silentRun = 0;
    this.openId = null;
  }

  private write(frame: Float32Array): void {
    for (let i = 0; i < frame.length; i++) this.audio[(this.samplesFed + i) % TURN_WINDOW_SAMPLES] = frame[i];
    this.samplesFed += frame.length;
  }

  private window(): Float32Array {
    const length = Math.min(this.samplesFed - this.segmentStart, TURN_WINDOW_SAMPLES);
    const out = new Float32Array(length);
    const from = this.samplesFed - length;
    for (let i = 0; i < length; i++) out[i] = this.audio[(from + i) % TURN_WINDOW_SAMPLES];
    return out;
  }
}

/** An answer is applied at the frame after it arrives. */
export class TurnLink {
  private answer: { id: number; probability: number } | null = null;

  constructor(private readonly port: MessagePort, private readonly gate: TurnGate) {
    port.onmessage = (event: MessageEvent<TurnPredictAnswer>) => {
      const data = event.data;
      if ('probability' in data) this.answer = { id: data.id, probability: data.probability };
    };
  }

  /** True: end the segment now, fire-and-forget, as the max-speech cap does. */
  afterFrame(frame: Float32Array, probability: number, speaking: boolean): boolean {
    const request = this.gate.push(frame, probability, speaking);
    if (request) {
      const message: TurnPredictRequest = { type: 'predict', id: request.id, window: request.window };
      this.port.postMessage(message, [request.window.buffer]);
    }
    const answer = this.answer;
    this.answer = null;
    if (!answer || !this.gate.shouldEnd(answer.id, answer.probability)) return false;
    this.gate.reset();
    return true;
  }

  /** The worker ended the segment itself (the cap, a flush). */
  reset(): void {
    this.answer = null;
    this.gate.reset();
  }

  close(): void {
    this.port.onmessage = null;
    this.port.close();
  }
}

export function openTurnLink(
  port: MessagePort | undefined,
  vadConfig: VadWebConfig | undefined,
  processor: FrameProcessorParams | null,
): TurnLink | null {
  const smart = vadConfig?.smartTurn;
  if (!port || !smart || !processor) return null;
  return new TurnLink(port, new TurnGate({
    triggerFrames: Math.ceil(Math.round(smart.checkAfter * 1000) / FRAME_MS),
    threshold: smart.threshold,
    positiveThreshold: processor.options.positiveSpeechThreshold,
    negativeThreshold: processor.options.negativeSpeechThreshold,
    preSpeechPadFrames: processor.preSpeechPadFrames,
    minSpeechFrames: processor.minSpeechFrames,
  }));
}
