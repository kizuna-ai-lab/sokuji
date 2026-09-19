import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveMaxSpeechFrames, VAD_FRAME_SAMPLES } from './max-speech-frames';

const PAD_MS = 800; // every worker's default pre-speech pad: 25 frames
const PAD_FRAMES = 25;

describe('resolveMaxSpeechFrames', () => {
  it('turns the requested seconds into 32 ms frames, rounding up', () => {
    expect(resolveMaxSpeechFrames(20, PAD_MS)).toBe(625);
    expect(resolveMaxSpeechFrames(30, PAD_MS)).toBe(938);
    expect(resolveMaxSpeechFrames(60, PAD_MS)).toBe(1875);
  });

  it('falls back to 20 s when the client sends nothing', () => {
    expect(resolveMaxSpeechFrames(undefined, PAD_MS)).toBe(625);
  });

  it('an engine with no limit is handed whatever was requested', () => {
    expect(resolveMaxSpeechFrames(60, PAD_MS, {})).toBe(1875);
  });

  describe('a limit on speech length', () => {
    it('behaves exactly like the slider set to that many seconds', () => {
      expect(resolveMaxSpeechFrames(60, PAD_MS, { maxSpeechSeconds: 35 })).toBe(resolveMaxSpeechFrames(35, PAD_MS));
      expect(resolveMaxSpeechFrames(40, PAD_MS, { maxSpeechSeconds: 35 })).toBe(1094);
    });

    it('leaves a shorter request alone', () => {
      expect(resolveMaxSpeechFrames(10, PAD_MS, { maxSpeechSeconds: 35 })).toBe(313);
      expect(resolveMaxSpeechFrames(35, PAD_MS, { maxSpeechSeconds: 35 })).toBe(1094);
    });
  });

  describe('a limit on the whole segment', () => {
    // vad-web prepends up to the pre-speech pad to the speech it cuts, so the
    // longest segment a worker can emit is pad + cap frames.
    const longestSegmentSamples = (frames: number) => (PAD_FRAMES + frames) * VAD_FRAME_SAMPLES;

    it('keeps pad + speech inside a 30 s window: 912 frames, a 29.984 s segment', () => {
      const frames = resolveMaxSpeechFrames(30, PAD_MS, { maxSegmentSamples: 480000 });
      expect(frames).toBe(912);
      expect(longestSegmentSamples(frames)).toBe(479744);
    });

    it('keeps a 1 s margin under the window when asked to: 881 frames, a 28.992 s segment', () => {
      const frames = resolveMaxSpeechFrames(30, PAD_MS, { maxSegmentSamples: 29 * 16000 });
      expect(frames).toBe(881);
      expect(longestSegmentSamples(frames)).toBe(463872);
    });

    it('holds for every slider stop from 10 to 60 s', () => {
      for (let seconds = 10; seconds <= 60; seconds += 5) {
        const frames = resolveMaxSpeechFrames(seconds, PAD_MS, { maxSegmentSamples: 480000 });
        expect(longestSegmentSamples(frames)).toBeLessThanOrEqual(480000);
        // ...and never cuts a request that already fits.
        const unlimited = resolveMaxSpeechFrames(seconds, PAD_MS);
        if (longestSegmentSamples(unlimited) <= 480000) expect(frames).toBe(unlimited);
      }
    });

    it('reserves a whole frame for a pad that is not a multiple of 32 ms', () => {
      // 810 ms is 25.3 frames: vad-web keeps 25, reserving 26 can only err short.
      expect(resolveMaxSpeechFrames(30, 810, { maxSegmentSamples: 480000 })).toBe(911);
    });

    it('never returns less than one frame', () => {
      expect(resolveMaxSpeechFrames(30, 60000, { maxSegmentSamples: 480000 })).toBe(1);
    });
  });

  it('applies the tighter of two limits', () => {
    expect(resolveMaxSpeechFrames(60, PAD_MS, { maxSpeechSeconds: 20, maxSegmentSamples: 480000 })).toBe(625);
    expect(resolveMaxSpeechFrames(60, PAD_MS, { maxSpeechSeconds: 45, maxSegmentSamples: 480000 })).toBe(912);
  });
});

// Every worker that force-ends a segment must get its frame cap from the
// helper above — a hand-written Math.ceil(ms / VAD_FRAME_MS) is how a worker
// ends up honouring a slider value its engine cannot transcribe.
const CAPPING_WORKERS = [
  'whisper-webgpu.worker.ts',
  'cohere-transcribe-webgpu.worker.ts',
  'voxtral-3b-webgpu.worker.ts',
  'voxtral-webgpu.worker.ts',
  'granite-speech-webgpu.worker.ts',
  'qwen3-asr-webgpu.worker.ts',
  'native-vad.worker.ts',
];

const here = import.meta.url;

describe('max speech duration routing', () => {
  it.each(CAPPING_WORKERS)('%s resolves its frame cap through the shared helper', (name) => {
    const src = readFileSync(fileURLToPath(new URL(`../${name}`, here)), 'utf8');
    expect(src, `${name} does not import resolveMaxSpeechFrames`).toMatch(/from\s+['"]\.\/_shared\/max-speech-frames['"]/);
    expect(src, `${name} does not call resolveMaxSpeechFrames`).toMatch(/maxSpeechFrames\s*=\s*resolveMaxSpeechFrames\(/);
    expect(src, `${name} still converts maxSpeechDuration to frames by hand`).not.toMatch(/maxSpeechDuration\s*\?\?\s*20/);
  });

  // A fixed 256 cut fast Japanese off mid-sentence at 29.5 s — inside the
  // 30 s default — and posted the cut text as an ordinary result.
  it('granite scales its token budget with the segment instead of fixing it', () => {
    const src = readFileSync(fileURLToPath(new URL('../granite-speech-webgpu.worker.ts', here)), 'utf8');
    expect(src).not.toMatch(/max_new_tokens:\s*\d+\s*,\s*\n\s*streamer/);
    expect(src).toMatch(/paddedAudio\.length \/ VAD_SAMPLE_RATE\) \* GRANITE_TOKENS_PER_SECOND/);
  });
});
