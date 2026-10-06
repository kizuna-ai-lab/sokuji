import { describe, it, expect } from 'vitest';
import { SileroInput, SILERO_CONTEXT_SAMPLES, SILERO_INPUT_SAMPLES } from './silero-input';
import { VAD_FRAME_SAMPLES } from './max-speech-frames';

/** A 512-sample frame whose sample i is `base + i`, so slices are recognisable. */
function frame(base: number): Float32Array {
  return Float32Array.from({ length: VAD_FRAME_SAMPLES }, (_, i) => base + i);
}

describe('SileroInput', () => {
  it('feeds the model 512 samples of audio behind 64 of context', () => {
    expect(SILERO_CONTEXT_SAMPLES).toBe(64);
    expect(SILERO_INPUT_SAMPLES).toBe(VAD_FRAME_SAMPLES + 64);
  });

  it('puts silence in front of the first frame', () => {
    const input = new SileroInput().next(frame(1000));
    expect(input).toHaveLength(SILERO_INPUT_SAMPLES);
    expect(Array.from(input.subarray(0, SILERO_CONTEXT_SAMPLES))).toEqual(new Array(64).fill(0));
    expect(Array.from(input.subarray(SILERO_CONTEXT_SAMPLES))).toEqual(Array.from(frame(1000)));
  });

  it("carries the previous frame's last 64 samples into the next input", () => {
    // This is the whole fix: Silero v5 reads each frame together with the tail of
    // the one before it. Fed bare 512-sample frames it detected 44% of meeting
    // speech frames instead of 90%, and fired on tonal noise.
    const input = new SileroInput();
    input.next(frame(1000));
    const second = input.next(frame(5000));
    expect(Array.from(second.subarray(0, SILERO_CONTEXT_SAMPLES)))
      .toEqual(Array.from(frame(1000).subarray(VAD_FRAME_SAMPLES - SILERO_CONTEXT_SAMPLES)));
    expect(Array.from(second.subarray(SILERO_CONTEXT_SAMPLES))).toEqual(Array.from(frame(5000)));
  });

  it('starts again from silence after a reset', () => {
    // The workers reset the LSTM state when vad-web's FrameProcessor resets;
    // Silero's own reset_states() clears the context with it.
    const input = new SileroInput();
    input.next(frame(1000));
    input.reset();
    const after = input.next(frame(5000));
    expect(Array.from(after.subarray(0, SILERO_CONTEXT_SAMPLES))).toEqual(new Array(64).fill(0));
  });

  it('keeps its own copy of the context', () => {
    // The workers slice frames out of a rolling buffer; a view into the caller's
    // array would change under the next frame.
    const input = new SileroInput();
    const first = frame(1000);
    input.next(first);
    first.fill(-1);
    const second = input.next(frame(5000));
    expect(second[0]).toBe(1000 + VAD_FRAME_SAMPLES - SILERO_CONTEXT_SAMPLES);
  });
});
