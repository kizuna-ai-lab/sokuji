import { Rnnoise, DenoiseState } from '@shiguredo/rnnoise-wasm';

/**
 * AI-powered noise suppression using RNNoise WASM.
 * Processes Int16 PCM audio at 48kHz (RNNoise native rate).
 * Handles 480-sample frame buffering internally.
 */
export class NoiseSuppression {
  private rnnoise: Rnnoise | null = null;
  private denoiseState: DenoiseState | null = null;
  private frameSize: number = 480; // RNNoise fixed @ 48kHz = 10ms
  private residualBuffer: Int16Array = new Int16Array(0);
  private enabled: boolean = false;

  async initialize(): Promise<void> {
    if (this.rnnoise) return;

    this.rnnoise = await Rnnoise.load();
    this.frameSize = this.rnnoise.frameSize; // Should be 480
    this.denoiseState = this.rnnoise.createDenoiseState();
    console.info('[Sokuji] [NoiseSuppression] Initialized, frameSize:', this.frameSize);
  }

  destroy(): void {
    if (this.denoiseState) {
      this.denoiseState.destroy();
      this.denoiseState = null;
    }
    this.rnnoise = null;
    this.residualBuffer = new Int16Array(0);
    console.info('[Sokuji] [NoiseSuppression] Destroyed');
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Process Int16 PCM audio at 48kHz through RNNoise.
   * Buffers residual samples across calls for 480-sample frame alignment.
   * Returns denoised audio and average VAD probability.
   */
  processAudio(input: Int16Array): { audio: Int16Array; vad: number } {
    if (!this.denoiseState || !this.enabled) {
      return { audio: input, vad: 0 };
    }

    // Prepend residual from previous call
    let buffer: Int16Array;
    if (this.residualBuffer.length > 0) {
      buffer = new Int16Array(this.residualBuffer.length + input.length);
      buffer.set(this.residualBuffer);
      buffer.set(input, this.residualBuffer.length);
    } else {
      buffer = input;
    }

    const totalFrames = Math.floor(buffer.length / this.frameSize);
    const processedSamples = totalFrames * this.frameSize;

    // Save residual for next call
    if (processedSamples < buffer.length) {
      this.residualBuffer = buffer.slice(processedSamples);
    } else {
      this.residualBuffer = new Int16Array(0);
    }

    if (totalFrames === 0) {
      // Not enough samples for a full frame yet
      return { audio: new Int16Array(0), vad: 0 };
    }

    const output = new Int16Array(processedSamples);
    const frame = new Float32Array(this.frameSize);
    let vadSum = 0;

    for (let i = 0; i < totalFrames; i++) {
      const offset = i * this.frameSize;

      // Convert Int16 → Float32 scaled as 16-bit PCM (RNNoise expects this)
      for (let j = 0; j < this.frameSize; j++) {
        frame[j] = buffer[offset + j];
      }

      // processFrame modifies frame in-place, returns VAD probability
      const vad = this.denoiseState.processFrame(frame);
      vadSum += vad;

      // Convert back to Int16
      for (let j = 0; j < this.frameSize; j++) {
        output[offset + j] = Math.max(-32768, Math.min(32767, Math.round(frame[j])));
      }
    }

    return {
      audio: output,
      vad: vadSum / totalFrames,
    };
  }
}
