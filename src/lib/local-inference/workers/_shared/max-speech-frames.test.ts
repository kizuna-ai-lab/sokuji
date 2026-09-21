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
// ends up honouring a slider value its engine cannot transcribe — and must
// pass the limit its engine was measured at. Each `limit` below is matched
// against the resolveMaxSpeechFrames CALL, with comments stripped, so a limit
// that survives only as prose does not count; each `constant` is matched
// against the file. An earlier version of this test asserted the call's
// prefix alone, and dropping whisper's limit (the regression the commit
// exists to prevent) passed it.
const CAPPING_WORKERS: Array<{ name: string; limit: RegExp | null; constant?: RegExp }> = [
  {
    name: 'whisper-webgpu.worker.ts',
    limit: /maxSegmentSamples:\s*WHISPER_MAX_SEGMENT_SAMPLES/,
    constant: /WHISPER_MAX_SEGMENT_SAMPLES\s*=\s*29\s*\*\s*VAD_SAMPLE_RATE/,
  },
  // No limit: it splits a long segment itself, at the quietest point.
  { name: 'cohere-transcribe-webgpu.worker.ts', limit: null },
  {
    name: 'voxtral-3b-webgpu.worker.ts',
    limit: /maxSegmentSamples:\s*VOXTRAL_3B_MAX_SEGMENT_SAMPLES/,
    constant: /VOXTRAL_3B_MAX_SEGMENT_SAMPLES\s*=\s*30\s*\*\s*VAD_SAMPLE_RATE/,
  },
  {
    name: 'voxtral-webgpu.worker.ts',
    limit: /maxSpeechSeconds:\s*VOXTRAL_REALTIME_MAX_SPEECH_SECONDS/,
    constant: /VOXTRAL_REALTIME_MAX_SPEECH_SECONDS\s*=\s*35\b/,
  },
  {
    name: 'granite-speech-webgpu.worker.ts',
    limit: /\{\s*maxSpeechSeconds\s*\}/,
    constant: /GRANITE_MAX_SPEECH_SECONDS\s*=\s*30\b[\s\S]*GRANITE_TRANSLATE_MAX_SPEECH_SECONDS\s*=\s*20\b/,
  },
  {
    name: 'qwen3-asr-webgpu.worker.ts',
    limit: /maxSpeechSeconds:\s*QWEN3_ASR_MAX_SPEECH_SECONDS\[/,
    constant: /QWEN3_ASR_MAX_SPEECH_SECONDS[^=]*=\s*\{\s*hi:\s*15,\s*th:\s*20\s*\}/,
  },
  {
    name: 'native-vad.worker.ts',
    limit: /maxSpeechSeconds:\s*NATIVE_MAX_SPEECH_SECONDS/,
    constant: /NATIVE_MAX_SPEECH_SECONDS\s*=\s*19\b/,
  },
];

const here = import.meta.url;

function read(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../${name}`, here)), 'utf8');
}

/** The resolveMaxSpeechFrames call, from the callee to its closing paren,
 *  with `//` comments removed so prose cannot satisfy an assertion. */
function resolveCall(src: string): string {
  const start = src.indexOf('resolveMaxSpeechFrames(');
  expect(start, 'no resolveMaxSpeechFrames call').toBeGreaterThan(-1);
  let depth = 0;
  let end = start;
  for (let i = src.indexOf('(', start); i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) { end = i + 1; break; }
  }
  return src.slice(start, end).replace(/\/\/[^\n]*/g, '');
}

describe('max speech duration routing', () => {
  it.each(CAPPING_WORKERS)('$name resolves its frame cap through the shared helper', ({ name, limit, constant }) => {
    const src = read(name);
    expect(src, `${name} does not import resolveMaxSpeechFrames`).toMatch(/from\s+['"]\.\/_shared\/max-speech-frames['"]/);
    expect(src, `${name} does not call resolveMaxSpeechFrames`).toMatch(/maxSpeechFrames\s*=\s*resolveMaxSpeechFrames\(/);
    expect(src, `${name} still converts maxSpeechDuration to frames by hand`).not.toMatch(/maxSpeechDuration\s*\?\?\s*20/);

    const call = resolveCall(src);
    if (limit === null) {
      expect(call, `${name} gained a limit this test does not know about`).not.toMatch(/max(SpeechSeconds|SegmentSamples)\s*:/);
    } else {
      expect(call, `${name} no longer passes its engine's limit`).toMatch(limit);
      if (constant) expect(src, `${name}'s limit constant changed`).toMatch(constant);
    }
  });

  // A fixed 256 cut fast Japanese off mid-sentence at 29.5 s — inside the
  // 30 s default — and posted the cut text as an ordinary result.
  it('granite scales its token budget with the segment instead of fixing it', () => {
    const src = readFileSync(fileURLToPath(new URL('../granite-speech-webgpu.worker.ts', here)), 'utf8');
    expect(src).not.toMatch(/max_new_tokens:\s*\d+\s*,\s*\n\s*streamer/);
    expect(src).toMatch(/paddedAudio\.length \/ VAD_SAMPLE_RATE\) \* GRANITE_TOKENS_PER_SECOND/);
  });
});
