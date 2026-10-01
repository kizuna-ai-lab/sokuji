import { describe, expect, it, vi } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { TextRange } from '../../lib/contract/adapter';
import type { NativeTtsLike } from './engines';
import { locateSentence, speakNative, type NativeSpeechEmit } from './speech';

type Chunked = (text: string, speed: number, onChunk?: (pcm: Float32Array) => void) => Promise<{ samples: Float32Array; sampleRate: number; generationTimeMs: number }>;
function engine(generate: Chunked): NativeTtsLike {
  return { init: vi.fn(), setVoice: vi.fn(), setReferenceVoice: vi.fn(), generate: vi.fn(generate), dispose: vi.fn(), onError: null, onClosed: null };
}
function recorder() {
  const audio: Array<{ samples: number; range?: TextRange }> = [];
  const ranges: Array<ReadonlyArray<{ index: number; range: TextRange }>> = [];
  const degraded: string[] = [];
  const frames: string[] = [];
  const emit: NativeSpeechEmit = {
    audio: (pcm, range) => audio.push(range ? { samples: pcm.length, range } : { samples: pcm.length }),
    ranges: (entries) => ranges.push(entries),
    degraded: (message) => degraded.push(message),
    frame: (_d, type) => frames.push(type),
  };
  return { emit, audio, ranges, degraded, frames };
}
const opts = (streaming: boolean) => ({ modelId: 'tts-a', voice: 'builtin:Bella', speed: 1, streaming });
const TEXT = 'Hello there. How are you?';

describe('speakNative', () => {
  it('one-shot: one ranged clip per sentence, resampled to 24 kHz', async () => {
    const r = recorder();
    const tts = engine(async () => ({ samples: new Float32Array(1600), sampleRate: 16000, generationTimeMs: 4 }));
    await speakNative(tts, TEXT, 'en', opts(false), r.emit, () => false, createVirtualClock());
    expect(r.audio).toEqual([{ samples: 2400, range: [0, 12] }, { samples: 2400, range: [13, 25] }]);
    expect(r.ranges).toEqual([]);
    expect(r.frames[0]).toBe('local.native.tts.start');
    expect(r.frames[r.frames.length - 1]).toBe('local.native.tts.end');
  });

  it("streaming: each chunk unranged as it arrives, then the sentence's range divided among them (#578 ruling 9)", async () => {
    const r = recorder();
    const tts = engine(async (_t, _s, onChunk) => {
      onChunk?.(new Float32Array(1000));
      onChunk?.(new Float32Array(3000));
      return { samples: new Float32Array(0), sampleRate: 24000, generationTimeMs: 6 };
    });
    await speakNative(tts, TEXT, 'en', opts(true), r.emit, () => false, createVirtualClock());
    expect(r.audio).toEqual([{ samples: 1000 }, { samples: 3000 }, { samples: 1000 }, { samples: 3000 }]);
    expect(r.ranges).toEqual([
      [{ index: 0, range: [0, 3] }, { index: 1, range: [3, 12] }],
      [{ index: 2, range: [13, 16] }, { index: 3, range: [16, 25] }],
    ]);
  });

  it('a sentence that fails is skipped and said; the next still runs', async () => {
    const r = recorder();
    let n = 0;
    const tts = engine(async () => {
      if (n++ === 0) throw new Error('synth crashed');
      return { samples: new Float32Array(2400), sampleRate: 24000, generationTimeMs: 1 };
    });
    await speakNative(tts, TEXT, 'en', opts(false), r.emit, () => false, createVirtualClock());
    expect(r.degraded).toEqual(['a sentence could not be spoken: synth crashed']);
    expect(r.audio).toEqual([{ samples: 2400, range: [13, 25] }]);
  });

  it('ended while synthesizing: the late answer says nothing', async () => {
    const r = recorder();
    let ended = false;
    const tts = engine(async () => { ended = true; return { samples: new Float32Array(2400), sampleRate: 24000, generationTimeMs: 1 }; });
    await speakNative(tts, TEXT, 'en', opts(false), r.emit, () => ended, createVirtualClock());
    expect(r.audio).toEqual([]);
    expect(r.frames).not.toContain('local.native.tts.end');
  });

  it('locates a sentence from where the last one ended, and steps over a miss', () => {
    expect(locateSentence('ab. ab.', 'ab.', 3)).toEqual({ range: [4, 7], nextSearchFrom: 7 });
    expect(locateSentence('ab.', 'zz', 0)).toEqual({ range: undefined, nextSearchFrom: 2 });
  });
});
