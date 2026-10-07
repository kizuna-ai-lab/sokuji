/**
 * The input Silero VAD v5 expects at 16 kHz: each 512-sample frame behind the
 * last 64 samples of the frame before it.
 *
 * Silero's own wrapper (`OnnxWrapper`) keeps that context and resets it with the
 * LSTM state; audio.cpp's port fixes its input at 512 + 64 samples. Fed a bare
 * 512-sample frame — what every VAD worker did, and what vad-web 0.0.30's own
 * SileroV5 still does — the model still answers but badly: on AMI meeting audio
 * it detected 44% of speech frames instead of 90%, and on ESC-50 it sent 70 of
 * 1000 non-speech clips to ASR instead of 2.
 */

import { VAD_FRAME_SAMPLES } from './max-speech-frames';

export const SILERO_CONTEXT_SAMPLES = 64;
export const SILERO_INPUT_SAMPLES = VAD_FRAME_SAMPLES + SILERO_CONTEXT_SAMPLES;

export class SileroInput {
  private context = new Float32Array(SILERO_CONTEXT_SAMPLES);

  /** The model input for `frame`: the previous frame's tail, then the frame. */
  next(frame: Float32Array): Float32Array {
    const input = new Float32Array(SILERO_CONTEXT_SAMPLES + frame.length);
    input.set(this.context);
    input.set(frame, SILERO_CONTEXT_SAMPLES);
    this.context = frame.slice(frame.length - SILERO_CONTEXT_SAMPLES);
    return input;
  }

  /** Back to silence; call it wherever the LSTM state is reset. */
  reset(): void {
    this.context = new Float32Array(SILERO_CONTEXT_SAMPLES);
  }
}
