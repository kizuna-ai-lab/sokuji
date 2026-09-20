import { describe, it, expect, vi } from 'vitest';
import { punctuateDefinite, createSegmentLane } from './punctuateDefinite';
import type { PunctuationResult, SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';

/** 60 Japanese characters: three sentences' worth at gateChars('ja', 3) = 60. */
const LONG_JA = 'あ'.repeat(60);

function runtimeAnswering(
  answer: (lang: string, text: string) => PunctuationResult | null,
): SegmentationRuntime & { punctuate: ReturnType<typeof vi.fn> } {
  return {
    enabled: true,
    punctuate: vi.fn(async (lang: string, text: string) => answer(lang, text)),
  };
}

/** Marks a sentence end every `every` characters — inserts terminals only, so
 *  the skeleton invariant holds. */
function marking(every: number) {
  return runtimeAnswering((_lang, text) => {
    let out = '';
    const ends: number[] = [];
    for (let i = 0; i < text.length; i += every) {
      out += text.slice(i, i + every);
      if (i + every <= text.length) { out += '。'; ends.push(out.length); }
    }
    return { text: out, sentenceEnds: ends, breakpoints: [...ends], model: 'fireredpunc' };
  });
}

describe('punctuateDefinite', () => {
  it('returns the text unchanged when there is no runtime', async () => {
    expect(await punctuateDefinite(null, 'ja', LONG_JA)).toBe(LONG_JA);
  });

  it('returns the text unchanged, and never calls the model, when the runtime is disabled', async () => {
    const runtime = marking(20);
    (runtime as { enabled: boolean }).enabled = false;
    expect(await punctuateDefinite(runtime, 'ja', LONG_JA)).toBe(LONG_JA);
    expect(runtime.punctuate).not.toHaveBeenCalled();
  });

  it('leaves a segment that already carries a terminal alone, without calling the model', async () => {
    const runtime = marking(20);
    const text = `${'あ'.repeat(30)}。${'い'.repeat(30)}`;
    expect(await punctuateDefinite(runtime, 'ja', text)).toBe(text);
    expect(runtime.punctuate).not.toHaveBeenCalled();
  });

  it('leaves a segment shorter than the gate alone, without calling the model', async () => {
    const runtime = marking(20);
    const short = 'あ'.repeat(59); // gateChars('ja', 3) is 60
    expect(await punctuateDefinite(runtime, 'ja', short)).toBe(short);
    expect(runtime.punctuate).not.toHaveBeenCalled();
  });

  it('returns the text unchanged when the model declines', async () => {
    const runtime = runtimeAnswering(() => null);
    expect(await punctuateDefinite(runtime, 'ja', LONG_JA)).toBe(LONG_JA);
    expect(runtime.punctuate).toHaveBeenCalledTimes(1);
  });

  it('returns the punctuated text when the model answers', async () => {
    const runtime = marking(20);
    const out = await punctuateDefinite(runtime, 'ja', LONG_JA);
    expect(out).toBe(`${'あ'.repeat(20)}。${'あ'.repeat(20)}。${'あ'.repeat(20)}。`);
  });

  it('returns the text unchanged when the answer\'s skeleton differs', async () => {
    const runtime = runtimeAnswering(() => ({
      text: 'a completely different sentence.',
      sentenceEnds: [32],
      breakpoints: [32],
      model: 'fireredpunc',
    }));
    expect(await punctuateDefinite(runtime, 'ja', LONG_JA)).toBe(LONG_JA);
  });

  it('returns the text unchanged when the model rejects', async () => {
    const runtime: SegmentationRuntime = {
      enabled: true,
      punctuate: vi.fn(async () => { throw new Error('worker died'); }),
    };
    expect(await punctuateDefinite(runtime, 'ja', LONG_JA)).toBe(LONG_JA);
  });

  it('measures the gate against sentencesPerChunk', async () => {
    const runtime = marking(20);
    // gateChars('ja', 1) is 20, so 40 characters clear a one-sentence chunk.
    const text = 'あ'.repeat(40);
    expect(await punctuateDefinite(runtime, 'ja', text, 1)).toBe(`${'あ'.repeat(20)}。${'あ'.repeat(20)}。`);
  });
});

describe('createSegmentLane', () => {
  it('runs queued work in the order it was queued, however each piece resolves', async () => {
    const lane = createSegmentLane();
    const order: string[] = [];
    const slow = new Promise<void>((resolve) => setTimeout(resolve, 10));
    lane(async () => { await slow; order.push('first'); });
    lane(async () => { order.push('second'); });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(order).toEqual(['first', 'second']);
  });

  it('keeps running after a piece of work rejects', async () => {
    const lane = createSegmentLane();
    const order: string[] = [];
    lane(async () => { throw new Error('boom'); });
    lane(async () => { order.push('after'); });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(['after']);
  });
});
