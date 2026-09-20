import { describe, it, expect, vi } from 'vitest';
import { punctuateDefinite, createSegmentLane } from './punctuateDefinite';
import type {
  PunctuationResult,
  SegmentationObservation,
  SegmentationRuntime,
} from '../../lib/segmentation/SegmentationRuntime';

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

  describe('observations', () => {
    function observing(runtime: SegmentationRuntime) {
      const events: SegmentationObservation[] = [];
      return { runtime: { ...runtime, observe: (e: SegmentationObservation) => { events.push(e); } }, events };
    }

    it('measures every definite segment it sees, whether or not the model runs', async () => {
      // The one already carrying a terminal never reaches the model, and it is
      // the more interesting of the two: it is the evidence that this provider
      // punctuates on its own.
      const { runtime, events } = observing(marking(20));
      const punctuated = `${'あ'.repeat(30)}。${'あ'.repeat(30)}`;
      await punctuateDefinite(runtime, 'ja', punctuated);
      await punctuateDefinite(runtime, 'ja', LONG_JA);
      expect(events).toEqual([
        { kind: 'definite', lang: 'ja', chars: 61, terminals: 1 },
        { kind: 'definite', lang: 'ja', chars: 60, terminals: 0 },
      ]);
    });

    it('measures the raw segment, not the one the model handed back', async () => {
      const { runtime, events } = observing(marking(20));
      const filled = await punctuateDefinite(runtime, 'ja', LONG_JA);
      expect(filled).not.toBe(LONG_JA);
      expect(events).toEqual([{ kind: 'definite', lang: 'ja', chars: 60, terminals: 0 }]);
    });

    it('measures a segment too short for the gate, which is where absence shows up most', async () => {
      const { runtime, events } = observing(marking(20));
      await punctuateDefinite(runtime, 'ja', 'あ'.repeat(10));
      expect(events).toEqual([{ kind: 'definite', lang: 'ja', chars: 10, terminals: 0 }]);
    });

    it('reports nothing when the stage is off for this session', async () => {
      const { runtime, events } = observing(marking(20));
      (runtime as { enabled: boolean }).enabled = false;
      await punctuateDefinite(runtime, 'ja', LONG_JA);
      expect(events).toEqual([]);
    });
  });
});

describe('createSegmentLane', () => {
  it('runs queued work in the order it was queued, however each piece resolves', async () => {
    const lane = createSegmentLane();
    const order: string[] = [];
    const slow = new Promise<void>((resolve) => setTimeout(resolve, 10));
    lane.queue(async () => { await slow; order.push('first'); }, () => {});
    lane.queue(async () => { order.push('second'); }, () => {});
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(order).toEqual(['first', 'second']);
  });

  it('keeps running after a piece of work rejects', async () => {
    const lane = createSegmentLane();
    const order: string[] = [];
    lane.queue(async () => { throw new Error('boom'); }, () => {});
    lane.queue(async () => { order.push('after'); }, () => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(['after']);
  });

  describe('flush', () => {
    it('writes every unwritten segment raw, synchronously, in arrival order', () => {
      const lane = createSegmentLane();
      const written: string[] = [];
      const never = new Promise<void>(() => {});
      lane.queue(async () => { await never; written.push('punctuated one'); }, () => written.push('raw one'));
      lane.queue(async () => { await never; written.push('punctuated two'); }, () => written.push('raw two'));

      lane.flush();

      // Synchronously: Stop must not wait for the model, and MainPanel reads
      // `getConversationItems()` on the turn after `disconnect()` resolves.
      expect(written).toEqual(['raw one', 'raw two']);
    });

    it('cancels the punctuated counterpart of a piece it wrote raw', async () => {
      const lane = createSegmentLane();
      const written: string[] = [];
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      // Queued behind a piece that is still waiting, so this one has not
      // started when flush() runs.
      lane.queue(async () => { await gate; written.push('punctuated head'); }, () => written.push('raw head'));
      lane.queue(async () => { written.push('punctuated tail'); }, () => written.push('raw tail'));

      lane.flush();
      release!();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(written).toEqual(['raw head', 'raw tail']);
    });

    it('leaves a piece that already wrote alone', async () => {
      const lane = createSegmentLane();
      const written: string[] = [];
      lane.queue(async () => { written.push('punctuated'); }, () => written.push('raw'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      lane.flush();

      expect(written).toEqual(['punctuated']);
    });

    it('tells the work it was cancelled, so a piece already awaiting writes nothing', async () => {
      const lane = createSegmentLane();
      const written: string[] = [];
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      lane.queue(async (cancelled) => {
        await gate;
        if (cancelled()) return;
        written.push('punctuated');
      }, () => written.push('raw'));
      // Let the piece start and reach its await before the flush.
      await new Promise((resolve) => setTimeout(resolve, 0));

      lane.flush();
      release!();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(written).toEqual(['raw']);
    });

    it('keeps the lane usable afterwards, for the session a reconnect opens', async () => {
      const lane = createSegmentLane();
      const written: string[] = [];
      lane.flush();
      lane.queue(async () => { written.push('punctuated'); }, () => written.push('raw'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(written).toEqual(['punctuated']);
    });
  });

  it('keeps the length gate under Auto, which is a size of 0', async () => {
    // Auto means "punctuate, do not split", not "punctuate anything at all":
    // gateChars(lang, 0) is zero, so without this a three-word segment would
    // call the model and wait out the fill-in budget for marks it does not
    // need.
    const called = vi.fn(async () => null);
    const rt: SegmentationRuntime = { enabled: true, punctuate: called };
    expect(await punctuateDefinite(rt, 'en', 'too short to bother', 0)).toBe('too short to bother');
    expect(called).not.toHaveBeenCalled();

    // Long enough for three sentences of English: Auto still asks.
    const long = 'a'.repeat(160);
    expect(await punctuateDefinite(rt, 'en', long, 0)).toBe(long);
    expect(called).toHaveBeenCalledTimes(1);
  });

  it('gives up on a slow model and shows the segment raw', async () => {
    vi.useFakeTimers();
    try {
      const raw = 'a'.repeat(200);
      let resolveLate: ((r: PunctuationResult | null) => void) | undefined;
      const slow: SegmentationRuntime = {
        enabled: true,
        punctuate: () => new Promise<PunctuationResult | null>((resolve) => { resolveLate = resolve; }),
      };
      const pending = punctuateDefinite(slow, 'en', raw);
      await vi.advanceTimersByTimeAsync(1_001);
      expect(await pending).toBe(raw);
      // The answer that arrives after the budget changes nothing: the caller
      // has already been given the raw text and assigned it.
      resolveLate?.({ text: 'Something. Else.', sentenceEnds: [], breakpoints: [], model: 'edge-punct-en' });
    } finally {
      vi.useRealTimers();
    }
  });
});
