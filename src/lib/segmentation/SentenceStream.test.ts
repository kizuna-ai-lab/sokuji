import { describe, it, expect, vi } from 'vitest';
import { SentenceStream, type SealedChunk } from './SentenceStream';
import type {
  PunctuationResult,
  SegmentationObservation,
  SegmentationRuntime,
} from './SegmentationRuntime';

/** A runtime whose every answer the test writes by hand. */
function fakeRuntime(answers: Record<string, PunctuationResult | null>) {
  const calls: string[] = [];
  const runtime: SegmentationRuntime = {
    enabled: true,
    async punctuate(_lang, text) {
      calls.push(text);
      return answers[text] ?? null;
    },
  };
  return { runtime, calls };
}

/** Build a PunctuationResult from text whose marks are already in place. */
function resultOf(text: string, ends: number[], breaks: number[] = ends): PunctuationResult {
  return { text, sentenceEnds: ends, breakpoints: breaks, model: 'fireredpunc' };
}

/**
 * Yield to the macrotask queue, which drains every pending microtask first.
 *
 * `vi.waitFor` runs its callback synchronously and returns immediately if it
 * already passes, so `await vi.waitFor(() => expect(seals).toEqual([]))` on an
 * array that is already empty proves nothing: it resolves before the model's
 * answer could possibly arrive. Every assertion that something did NOT happen
 * must come after a real yield instead.
 */
const flush = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

describe('SentenceStream gating', () => {
  it('never calls the model for a short tail', async () => {
    const { runtime, calls } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'zh', runtime, sentencesPerChunk: 3, onSeal: () => {}, onPending: () => {},
    });
    stream.update('太短了');
    await flush();
    expect(calls).toEqual([]);
  });

  it('never calls the model when the tail already has a terminal', async () => {
    const { runtime, calls } = fakeRuntime({});
    const seals: SealedChunk[] = [];
    const stream = new SentenceStream({
      lang: 'zh', runtime, sentencesPerChunk: 3, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    // Three sentences, each followed by enough right context.
    stream.update('第一句话。第二句话。第三句话。后面还有很多很多很多字');
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(calls).toEqual([]);
    expect(seals[0].reason).toBe('sentences');
    expect(seals[0].text).toBe('第一句话。第二句话。第三句话。');
  });

  it('calls the model once the unpunctuated tail could hold N sentences', async () => {
    const tail = '这是一段没有任何标点的中文文字总共超过六十个字符所以应当触发模型调用我们继续往下写够长度为止真的够了吗还差一点点现在够了';
    const { runtime, calls } = fakeRuntime({ [tail]: null });
    const stream = new SentenceStream({
      lang: 'zh', runtime, sentencesPerChunk: 3, onSeal: () => {}, onPending: () => {},
    });
    stream.update(tail);
    await vi.waitFor(() => expect(calls).toEqual([tail]));
  });

  it('uses the 50-character-per-sentence gate for non-CJK languages', async () => {
    const { runtime, calls } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3, onSeal: () => {}, onPending: () => {},
    });
    stream.update('a'.repeat(149));
    await flush();
    expect(calls).toEqual([]);
    stream.update('a'.repeat(150));
    await vi.waitFor(() => expect(calls.length).toBe(1));
  });
});

describe('SentenceStream sealing', () => {
  it('seals at the Nth sentence end for N = 1, 3 and 5', async () => {
    for (const n of [1, 3, 5]) {
      const seals: SealedChunk[] = [];
      const { runtime } = fakeRuntime({});
      const stream = new SentenceStream({
        lang: 'en', runtime, sentencesPerChunk: n, onSeal: (c) => seals.push(c), onPending: () => {},
      });
      const text = Array.from({ length: 6 }, (_, i) => `Sentence number ${i + 1}.`).join(' ');
      stream.update(text);
      await vi.waitFor(() => expect(seals.length).toBeGreaterThan(0));
      const sealedSentences = seals[0].text.match(/\./g)?.length ?? 0;
      expect(sealedSentences).toBe(n);
    }
  });

  it('does not trust a mark at the very end of the tail', async () => {
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update('One complete sentence.');
    await flush();
    expect(seals).toEqual([]);
    stream.update('One complete sentence. And more words after it');
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0].text).toBe('One complete sentence.');
  });

  it('seals Chinese at the last comma once the tail is N x 33 characters', async () => {
    const seals: SealedChunk[] = [];
    // 12 comma-separated clauses of 8 characters (96) plus an 18-character
    // tail = 114, past zhFallbackChars(3) = 100, with no sentence-final mark
    // anywhere and a runtime that declines.
    const tail = '第一段内容很长，'.repeat(12) + '第七段内容仍然没有句号而且继续写下去';
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'zh', runtime, sentencesPerChunk: 3, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update(tail);
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0].reason).toBe('length');
    expect(seals[0].text.endsWith('，')).toBe(true);
    expect(seals[0].text.length).toBe(96);
  });

  it('seals Chinese at a comma the MODEL supplied when the raw tail has none', async () => {
    const seals: SealedChunk[] = [];
    const pendings: string[] = [];
    // The case the fallback exists for and the one the test above does NOT
    // cover: an ASR that emits no punctuation at all, so every comma in
    // existence is one the model just inserted. 14 x 8 = 112 raw characters,
    // past zhFallbackChars(3) = 100, and the answer carries commas but no
    // sentence end, exactly FireRedPunc's under-emission.
    const raw = '第一段内容很长的'.repeat(14);
    const marked = '第一段内容很长的，'.repeat(14);
    const breaks = Array.from({ length: 14 }, (_, i) => (i + 1) * 9);
    const { runtime } = fakeRuntime({ [raw]: resultOf(marked, [], breaks) });
    const stream = new SentenceStream({
      lang: 'zh', runtime, sentencesPerChunk: 3,
      onSeal: (c) => seals.push(c), onPending: (t) => pendings.push(t),
    });
    stream.update(raw);

    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0].reason).toBe('length');
    // The last comma with RIGHT_CONTEXT_CHARS of text after it: offset 126 has
    // none, 117 has exactly 8.
    expect(seals[0].text).toBe('第一段内容很长的，'.repeat(13));
    // The remainder is RAW — the cursor advanced by characters consumed, not
    // by the longer sealed text, so no speech is swallowed and no comma the
    // model invented is shown as though the ASR had produced it.
    expect(pendings[pendings.length - 1]).toBe('第一段内容很长的');
  });

  it('does not apply the fallback to a language outside it, however the model marks the text', async () => {
    const seals: SealedChunk[] = [];
    // 160 characters, past gateChars('en', 3) = 150 so the model is called at
    // all, and its answer is all commas and no sentence end.
    const raw = 'this clause runs on and on '.repeat(6);
    const marked = 'this clause runs on and on, '.repeat(6);
    const breaks = Array.from({ length: 6 }, (_, i) => (i + 1) * 28);
    const { runtime } = fakeRuntime({ [raw]: resultOf(marked, [], breaks) });
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update(raw);
    await flush();
    expect(seals).toEqual([]);
  });

  it('does not apply the Chinese length fallback to Japanese', async () => {
    const seals: SealedChunk[] = [];
    // 123 characters, past zhFallbackChars(3) = 100, and still carrying 、 —
    // so if 'ja' were ever added to LENGTH_FALLBACK_LANGS this test would
    // fail. At 74 characters it could not, because the length guard returned
    // before the language was ever consulted.
    const tail = 'これは長い日本語の文章です、'.repeat(8) + '句点がないまま続きます';
    const { runtime } = fakeRuntime({ [tail]: null });
    const stream = new SentenceStream({
      lang: 'ja', runtime, sentencesPerChunk: 3, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update(tail);
    await flush();
    expect(seals).toEqual([]);
  });

  it('reads N when the stream is created, so a setting change never cuts mid-bubble', async () => {
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 5, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update('One. Two. Three. Four. and the tail keeps going here');
    await flush();
    expect(seals).toEqual([]);
  });
});

describe('SentenceStream multi-group finals', () => {
  it('seals every full N-sentence group from a single update(), not just the first', async () => {
    // Simulates an offline ASR worker's final (whisper, qwen3-asr, granite,
    // sherpa offline): already fully punctuated, delivered whole via a single
    // update() immediately followed by end(), never grown delta by delta.
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    const text = Array.from({ length: 9 }, (_, i) => `Sentence number ${i + 1}.`).join(' ');
    stream.update(text);
    await flush();
    // Two full 3-sentence groups must seal from the rule path within this one
    // update() call. Before the fix, evaluate() sealed once and returned,
    // leaving the other 6 sentences pending until end() flushed them as one
    // oversized chunk instead of two more bounded ones.
    expect(seals.length).toBe(2);
    expect(seals[0].reason).toBe('sentences');
    expect(seals[1].reason).toBe('sentences');
    expect(seals[0].text.match(/\./g)?.length).toBe(3);
    expect(seals[1].text.match(/\./g)?.length).toBe(3);

    // The last group's own final mark is at the very end of the tail (no
    // right context), so it only flushes once end() is called -- but it must
    // still be exactly the remaining 3 sentences, not 3 + whatever else.
    stream.end();
    expect(seals.length).toBe(3);
    expect(seals[2].reason).toBe('end');
    expect(seals[2].text.match(/\./g)?.length).toBe(3);
  });
});

describe('SentenceStream model results', () => {
  it('seals with the inserted punctuation and leaves the remainder raw', async () => {
    // 162 characters, so it clears the English gate at N = 3 (3 x 50 = 150).
    const raw = 'first sentence here second sentence here third sentence here and then the tail continues for a good while longer without any punctuation at all and it keeps going';
    const punctuated = 'First sentence here. Second sentence here. Third sentence here. and then the tail continues for a good while longer without any punctuation at all and it keeps going';
    const ends = [20, 42, 63];
    const seals: SealedChunk[] = [];
    const pendings: string[] = [];
    const { runtime } = fakeRuntime({ [raw]: resultOf(punctuated, ends) });
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3,
      onSeal: (c) => seals.push(c), onPending: (t) => pendings.push(t),
    });
    stream.update(raw);
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0].text).toBe('First sentence here. Second sentence here. Third sentence here.');
    expect(seals[0].reason).toBe('sentences');
    // The tail is shown raw, with no provisional marks.
    expect(pendings[pendings.length - 1]).toBe(' and then the tail continues for a good while longer without any punctuation at all and it keeps going');
  });

  it('discards a result whose skeleton differs from the input', async () => {
    const raw = 'a'.repeat(160);
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({ [raw]: resultOf('completely different text.', [26]) });
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update(raw);
    await flush();
    expect(seals).toEqual([]);
  });

  it('accepts a result that only recases and respaces', async () => {
    // Over 100 characters, so it clears the English gate at N = 2 (2 x 50).
    const raw = 'i think so we should go now and then some more text follows here to push this tail past the hundred character gate';
    const punctuated = 'I think so. We should go now. and then some more text follows here to push this tail past the hundred character gate';
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({ [raw]: resultOf(punctuated, [11, 29]) });
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 2, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update(raw);
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0].text).toBe('I think so. We should go now.');
  });

  it('coalesces updates: one call in flight, latest wins', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const calls: string[] = [];
    const runtime: SegmentationRuntime = {
      enabled: true,
      async punctuate(_lang, text) { calls.push(text); await gate; return null; },
    };
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3, onSeal: () => {}, onPending: () => {},
    });
    stream.update('a'.repeat(150));
    stream.update('a'.repeat(160));
    stream.update('a'.repeat(170));
    expect(calls).toEqual(['a'.repeat(150)]);
    release();
    await vi.waitFor(() => expect(calls).toEqual(['a'.repeat(150), 'a'.repeat(170)]));
  });

  it('sends at most MAX_MODEL_CHARS to the model', async () => {
    const calls: string[] = [];
    const runtime: SegmentationRuntime = {
      enabled: true,
      async punctuate(_lang, text) { calls.push(text); return null; },
    };
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3, onSeal: () => {}, onPending: () => {},
    });
    stream.update('a'.repeat(900));
    await vi.waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].length).toBeLessThanOrEqual(300);
  });
});

describe('SentenceStream astral characters (rawOffsetFor)', () => {
  // U+20BB7, a real Chinese character (outside the BMP, so it is a surrogate
  // pair in UTF-16). FireRedPunc's own `isChineseChar` explicitly accepts
  // U+20000-U+2CEAF, so this is an expected input, not an edge case.
  const ASTRAL = '\u{20BB7}';

  it('does not lose text around an astral character mid-window', async () => {
    // 9 characters ("abc" + astral + "def ") plus 60 "x"s clears the English
    // gate (50) without hitting MAX_MODEL_CHARS (300).
    const raw = `abc${ASTRAL}def ` + 'x'.repeat(60);
    const punctuated = `Abc${ASTRAL}def.` + ' ' + 'x'.repeat(60);
    const seals: SealedChunk[] = [];
    const pendings: string[] = [];
    const { runtime } = fakeRuntime({ [raw]: resultOf(punctuated, [9]) });
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1,
      onSeal: (c) => seals.push(c), onPending: (t) => pendings.push(t),
    });
    stream.update(raw);
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0].text).toBe(`Abc${ASTRAL}def.`);
    // The old code counted rawOffsetFor's target in UTF-16 units, where a
    // surrogate half matches \p{Cs}, not \p{L} -- so it undercounted by one
    // for every astral character before the cut and read two units too far,
    // silently swallowing the space and the first "x" (they land in neither
    // the sealed chunk above nor this remainder).
    expect(pendings[pendings.length - 1]).toBe(' ' + 'x'.repeat(60));
  });

  it('does not drop the entire remainder when the cut lands right after a run of astral characters', async () => {
    // 30 astral characters (60 UTF-16 units) clears the English gate (50).
    const raw = ASTRAL.repeat(30);
    const punctuated = ASTRAL.repeat(5) + '.' + ASTRAL.repeat(25);
    const seals: SealedChunk[] = [];
    const pendings: string[] = [];
    const { runtime } = fakeRuntime({ [raw]: resultOf(punctuated, [11]) });
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1,
      onSeal: (c) => seals.push(c), onPending: (t) => pendings.push(t),
    });
    stream.update(raw);
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0].text).toBe(ASTRAL.repeat(5) + '.');
    // The old code never matched a single unit in an all-astral raw string
    // (every unit is a lone surrogate), so it fell through to `raw.length`
    // and the entire 25-character remainder vanished instead of surviving as
    // pending text.
    expect(pendings[pendings.length - 1]).toBe(ASTRAL.repeat(25));
  });
});

describe('SentenceStream rewrites and re-anchoring', () => {
  it('never un-seals when the ASR rewrites the tail after a seal', async () => {
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    // The word after the period is capitalised on purpose: sentenceEnd.ts
    // treats "sentence. and" as a mid-sentence dot ("no. then"), so a
    // lower-case continuation would give the rule nothing to count.
    stream.update('First sentence. And the tail goes on');
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0].text).toBe('First sentence.');
    // update() carries the text SINCE the last seal, so the client now sends
    // the rewritten remainder. The seal already emitted must not move.
    stream.update(' And the tail went on a bit further than that');
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0].text).toBe('First sentence.');
  });

  it('discards a model answer whose input is no longer a prefix of the tail', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const seals: SealedChunk[] = [];
    const runtime: SegmentationRuntime = {
      enabled: true,
      async punctuate(_lang, text) {
        await gate;
        return { text: `${text}.`, sentenceEnds: [text.length + 1], breakpoints: [], model: 'fireredpunc' };
      },
    };
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update('a'.repeat(150));
    // The tail is rewritten from the start while the call is in flight.
    stream.update('b'.repeat(150));
    release();
    // Not named in the fix-round list, but the same anti-pattern Finding 1
    // describes: this checks that nothing happened right after release(),
    // before the model's .then() chain could possibly have run.
    await flush();
    expect(seals).toEqual([]);
  });

  it('confirmedBoundary reports the latest counted end, and -1 when there is none', () => {
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 5, onSeal: () => {}, onPending: () => {},
    });
    expect(stream.confirmedBoundary()).toBe(-1);
    // Capitalised continuations, for the same reason as the test above.
    stream.update('One. Two. And then a good deal more text after it');
    expect(stream.confirmedBoundary()).toBe(9);
    // A mark at the very end of the tail is not confirmed. The one before it
    // is — but only because the closing sentence is long enough to supply the
    // 8 skeleton characters the right-context rule demands. In 'One. Two.
    // Three.' the mark at 9 would fail too, since 'three' is only 5.
    stream.update('One. Two. Three sentences here.');
    expect(stream.confirmedBoundary()).toBe(9);
  });
});

describe('SentenceStream end and disposal', () => {
  it('emits the remainder as a final chunk, ignoring the right-context rule', async () => {
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update('Just one short sentence.');
    stream.end();
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0]).toEqual({ text: 'Just one short sentence.', reason: 'end' });
  });

  it('emits nothing for an empty stream', async () => {
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.end();
    expect(seals).toEqual([]);
  });

  it('never seals with a null runtime, and still reports the pending text', async () => {
    const seals: SealedChunk[] = [];
    const pendings: string[] = [];
    const stream = new SentenceStream({
      lang: 'en', runtime: null, sentencesPerChunk: 1,
      onSeal: (c) => seals.push(c), onPending: (t) => pendings.push(t),
    });
    stream.update('One. Two. Three. Four. Five. Six.');
    await vi.waitFor(() => expect(pendings.length).toBe(1));
    await flush();
    expect(seals).toEqual([]);
    stream.end();
    await flush();
    expect(seals).toEqual([]);
  });

  it('never seals with a disabled runtime', async () => {
    const seals: SealedChunk[] = [];
    const runtime: SegmentationRuntime = { enabled: false, async punctuate() { return null; } };
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update('One. Two. Three. Four. Five. Six.');
    stream.end();
    await flush();
    expect(seals).toEqual([]);
  });

  it('stays inert when a disabled runtime becomes enabled under it', async () => {
    const seals: SealedChunk[] = [];
    const runtime: SegmentationRuntime = { enabled: false, async punctuate() { return null; } };
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    // The pack finished downloading mid-utterance.
    (runtime as { enabled: boolean }).enabled = true;
    stream.update('One. Two. Three.');
    stream.end();
    await flush();
    expect(seals).toEqual([]);
  });

  it('still seals its tail when the runtime goes disabled under it', async () => {
    const seals: SealedChunk[] = [];
    const runtime: SegmentationRuntime = { enabled: true, async punctuate() { return null; } };
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update('the files went away halfway through this sentence');
    // Storage cleared underneath the session: without one answer per stream,
    // end() would decline to seal and this text would be lost entirely.
    (runtime as { enabled: boolean }).enabled = false;
    stream.end();
    await flush();
    expect(seals).toEqual([
      { text: 'the files went away halfway through this sentence', reason: 'end' },
    ]);
  });

  it('emits nothing after dispose', async () => {
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.dispose();
    stream.update('One. Two. Three. and more text');
    stream.end();
    await flush();
    expect(seals).toEqual([]);
  });
});

describe('SentenceStream observations', () => {
  /** A runtime that also collects. */
  function observing(answers: Record<string, PunctuationResult | null> = {}) {
    const { runtime, calls } = fakeRuntime(answers);
    const events: SegmentationObservation[] = [];
    return {
      runtime: { ...runtime, observe: (e: SegmentationObservation) => { events.push(e); } },
      events,
      calls,
    };
  }

  it('reports each seal with its reason and the raw text it consumed', async () => {
    const { runtime, events } = observing();
    const stream = new SentenceStream({
      lang: 'zh', runtime, sentencesPerChunk: 3, onSeal: () => {}, onPending: () => {},
    });
    stream.update('第一句话。第二句话。第三句话。后面还有很多很多很多字');
    await vi.waitFor(() => expect(events.length).toBe(1));
    expect(events[0]).toEqual({
      kind: 'seal',
      reason: 'sentences',
      lang: 'zh',
      chars: '第一句话。第二句话。第三句话。'.length,
      terminals: 3,
    });
  });

  it('measures the RAW characters a model-marked seal consumed, not the marked-up ones', async () => {
    // The tail carries no marks at all, which is the only reason the model ran:
    // a measurement taken on the answer would report the model's own periods as
    // the ASR's, and "how often is punctuation missing" would answer itself.
    const tail = 'a'.repeat(60);
    const marked = `${'a'.repeat(20)}. ${'a'.repeat(20)}. ${'a'.repeat(20)}`;
    const { runtime, events } = observing({ [tail]: resultOf(marked, [21, 44]) });
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1, onSeal: () => {}, onPending: () => {},
    });
    stream.update(tail);
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
    const seal = events.find((e) => e.kind === 'seal') as
      | { kind: 'seal'; reason: string; lang: string; chars: number; terminals: number }
      | undefined;
    expect(seal).toMatchObject({ kind: 'seal', reason: 'sentences', lang: 'en', terminals: 0 });
    expect(seal?.chars).toBe(20);
  });

  it('reports the final flush too, so the tail an utterance ends on is measured', async () => {
    const { runtime, events } = observing();
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3, onSeal: () => {}, onPending: () => {},
    });
    stream.update('Short one. Done');
    stream.end();
    await flush();
    expect(events).toEqual([
      { kind: 'seal', reason: 'end', lang: 'en', chars: 15, terminals: 1 },
    ]);
  });

  it('still seals through an observer that throws', async () => {
    // The observer is a counter MainPanel owns, not part of the seal. Letting
    // it throw out of seal() would unwind into the client's delta handler and
    // lose the item — a chunk of the conversation, for a tally nobody renders.
    const { runtime } = fakeRuntime({});
    const seals: SealedChunk[] = [];
    const stream = new SentenceStream({
      lang: 'zh',
      runtime: { ...runtime, observe: () => { throw new Error('counter blew up'); } },
      sentencesPerChunk: 3,
      onSeal: (c) => seals.push(c),
      onPending: () => {},
    });
    expect(() => stream.update('第一句话。第二句话。第三句话。后面还有很多很多很多字')).not.toThrow();
    await vi.waitFor(() => expect(seals.length).toBe(1));
  });

  it('still seals through a runtime that collects nothing', async () => {
    const { runtime } = fakeRuntime({});
    const seals: SealedChunk[] = [];
    const stream = new SentenceStream({
      lang: 'zh', runtime, sentencesPerChunk: 3, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update('第一句话。第二句话。第三句话。后面还有很多很多很多字');
    await vi.waitFor(() => expect(seals.length).toBe(1));
  });
});
