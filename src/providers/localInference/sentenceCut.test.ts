import { describe, expect, it } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { Punctuator } from '../../lib/contract/adapter';
import type { SealedChunk } from '../../lib/segmentation/SentenceStream';
import { breakpoints, sentenceEnds } from '../../lib/segmentation/sentenceEnd';
import { PUNCTUATION_BUDGET_MS, SentenceCut, runtimeOver } from './sentenceCut';

function harness({ lang = 'en', sentences = 1, punctuate = (async () => null) as Punctuator } = {}) {
  const clock = createVirtualClock();
  const seals: SealedChunk[] = [];
  const pendings: string[] = [];
  const cut = new SentenceCut({
    lang, sentences, runtime: runtimeOver(punctuate, clock),
    onSeal: (chunk) => seals.push(chunk), onPending: (tail) => pendings.push(tail),
  });
  const texts = () => seals.map((s) => s.text.trim());
  return { cut, clock, seals, pendings, texts };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** A long, unmarked, all-lowercase text built from repeated words: long enough
 *  to cross the model gate and the length-fallback threshold at N=1 en. */
function longUnmarkedText(len: number): string {
  const words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit'];
  let out = '';
  let i = 0;
  while (out.length < len) {
    out += (out ? ' ' : '') + words[i % words.length];
    i++;
  }
  return out.slice(0, len);
}

describe('SentenceCut', () => {
  it('N=1: seals as partials grow', () => {
    const { cut, texts, pendings } = harness({ sentences: 1 });
    cut.partial('Sentence one is done. Sentence two begins');
    expect(texts()).toEqual(['Sentence one is done.']);
    cut.partial('Sentence one is done. Sentence two begins now yes. Sentence three starts');
    expect(texts()).toEqual(['Sentence one is done.', 'Sentence two begins now yes.']);
    cut.partial(
      'Sentence one is done. Sentence two begins now yes. Sentence three starts and ends well. Tail padding here',
    );
    expect(texts()).toEqual([
      'Sentence one is done.',
      'Sentence two begins now yes.',
      'Sentence three starts and ends well.',
    ]);
    expect(pendings[pendings.length - 1].trim()).toBe('Tail padding here');
  });

  it('an offline final at N=3', () => {
    const { cut, texts } = harness({ sentences: 3 });
    const result = cut.final(
      'One is done. Two is done. Three is done. Four is done. Five is done. Six is done and finished well.',
    );
    expect(result).toBe(true);
    expect(texts()).toEqual([
      'One is done. Two is done. Three is done.',
      'Four is done. Five is done. Six is done and finished well.',
    ]);
  });

  it('a short utterance at N=3', () => {
    const { cut, texts } = harness({ sentences: 3 });
    cut.final('Just one short sentence.');
    expect(texts()).toEqual(['Just one short sentence.']);
  });

  it('the cursor advances by what was consumed, not by the sealed text', async () => {
    const RAW = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet';
    const PUNCTUATED = 'alpha bravo charlie delta echo foxtrot golf hotel. india juliet';
    const punctuate: Punctuator = async (_lang, text) => (text === RAW ? PUNCTUATED : null);
    const { cut, texts } = harness({ punctuate });
    cut.partial(RAW);
    await settle();
    expect(texts()).toEqual(['alpha bravo charlie delta echo foxtrot golf hotel.']);
    cut.final(`${RAW} kilo`);
    expect(texts()).toEqual([
      'alpha bravo charlie delta echo foxtrot golf hotel.',
      'india juliet kilo',
    ]);
    const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
    expect(letters(texts().join(''))).toBe(letters(`${RAW} kilo`));
  });

  it("keeps the model's own casing and marks in the seal; the remainder stays raw", async () => {
    const RAW = 'the first sentence runs long enough to pass the gate the second one follows it';
    const PUNCTUATED = 'The first sentence runs long enough to pass the gate. The second one follows it';
    const punctuate: Punctuator = async (_lang, text) => (text === RAW ? PUNCTUATED : null);
    const { cut, texts, pendings } = harness({ punctuate });
    cut.partial(RAW);
    await settle();
    expect(texts()).toEqual(['The first sentence runs long enough to pass the gate.']);
    expect(pendings[pendings.length - 1].trim()).toBe('the second one follows it');
  });

  it('a final shorter than what was sealed', () => {
    const { cut, texts } = harness();
    cut.partial('First sentence done. Second begins');
    expect(texts()).toEqual(['First sentence done.']);
    const result = cut.final('Hi.');
    expect(result).toBe(true);
    expect(texts()).toEqual(['First sentence done.', 'Hi.']);
  });

  it('a truncated re-decode seals nothing more', () => {
    const { cut, texts } = harness();
    cut.partial('First sentence done. Second begins');
    expect(texts()).toEqual(['First sentence done.']);
    const result = cut.final('First sentence done.');
    expect(result).toBe(false);
    expect(texts()).toEqual(['First sentence done.']);
  });

  it('the same with a leading-space partial', () => {
    const { cut, texts } = harness();
    cut.partial(' First sentence done. Second begins');
    expect(texts()).toEqual(['First sentence done.']);
    const result = cut.final('First sentence done.');
    expect(result).toBe(false);
    expect(texts()).toEqual(['First sentence done.']);
  });

  it('a dropped mark', () => {
    const { cut, texts } = harness();
    cut.partial(" Lorena and I have a wonderful family together. I'm pretty sure");
    const result = cut.final(
      "Lorena and I have a wonderful family together I'm pretty sure none of this would have happened.",
    );
    expect(result).toBe(true);
    expect(texts()).toEqual([
      'Lorena and I have a wonderful family together.',
      "I'm pretty sure none of this would have happened.",
    ]);
  });

  it('an added mark', () => {
    const { cut, texts } = harness();
    cut.partial(
      'And so my fellow Americans, ask not what your country can do for you. When I was young',
    );
    const result = cut.final(
      'And so, my fellow Americans, ask not what your country can do for you. When I was young there was an amazing publication.',
    );
    expect(result).toBe(true);
    expect(texts()).toEqual([
      'And so my fellow Americans, ask not what your country can do for you.',
      'When I was young there was an amazing publication.',
    ]);
  });

  it('zh, leading space', () => {
    const { cut, texts } = harness({ lang: 'zh' });
    cut.partial(' 今天天气很好。我们出去走走吧然后去吃饭');
    const result = cut.final('今天天气很好。我们出去走走吧然后去吃饭。');
    expect(result).toBe(true);
    expect(texts()).toEqual(['今天天气很好。', '我们出去走走吧然后去吃饭。']);
  });

  it('zh, seam space', () => {
    const { cut, texts } = harness({ lang: 'zh' });
    cut.partial(' 第一段话说完了。 第二段话也说完了。第三段话正在说而且还没有完');
    expect(texts()).toEqual(['第一段话说完了。', '第二段话也说完了。']);
    const result = cut.final('第一段话说完了。第二段话也说完了。第三段话正在说而且还没有完全结束。');
    expect(result).toBe(true);
    expect(texts()).toEqual([
      '第一段话说完了。',
      '第二段话也说完了。',
      '第三段话正在说而且还没有完全结束。',
    ]);
  });

  it('a hung punctuator is bounded by the budget', async () => {
    const punctuate: Punctuator = () => new Promise(() => {});
    const { cut, clock, seals } = harness({ punctuate });
    cut.partial(longUnmarkedText(120));
    await settle();
    expect(seals).toHaveLength(0);
    clock.advance(PUNCTUATION_BUDGET_MS - 1);
    await settle();
    expect(seals).toHaveLength(0);
    clock.advance(1);
    await settle();
    expect(seals).toHaveLength(1);
    expect(seals[0].reason).toBe('length');
  });

  // A port that breaks its type: anything but a string or null counts as no
  // answer. `undefined` is the one that used to throw inside the shim after it
  // had settled and cancelled its budget, leaving the stream's call in flight.
  it.each([['a number', 42], ['undefined', undefined]])('a malformed answer (%s) does not wedge the stream: the length fallback still seals later', async (_name, answer) => {
    const punctuate = (async () => answer) as unknown as Punctuator;
    const { cut, seals } = harness({ punctuate });
    cut.partial(longUnmarkedText(80)); // past the model gate, short of the length fallback
    await settle();
    expect(seals).toHaveLength(0);
    cut.partial(longUnmarkedText(120)); // asks again — possible only once the first call settled
    await settle();
    expect(seals).toHaveLength(1);
    expect(seals[0].reason).toBe('length');
  });

  it('reset() drops a model call in flight', async () => {
    let resolveHeld: (value: string | null) => void = () => {};
    const punctuate: Punctuator = () => new Promise((resolve) => { resolveHeld = resolve; });
    const { cut, seals, pendings } = harness({ punctuate });
    cut.partial(longUnmarkedText(120));
    cut.reset();
    const pendingCountAfterReset = pendings.length;
    resolveHeld('Lorem ipsum dolor. Sit amet consectetur adipiscing elit sed do eiusmod.');
    await settle();
    expect(seals).toHaveLength(0);
    expect(pendings.length).toBe(pendingCountAfterReset);
  });
});

describe('runtimeOver', () => {
  it("rebuilds sentenceEnds/breakpoints from the punctuator's answer", async () => {
    const clock = createVirtualClock();
    const ANSWER = 'Hello there. General Kenobi';
    const runtime = runtimeOver(async () => ANSWER, clock);
    expect(runtime.enabled).toBe(true);
    const result = await runtime.punctuate('en', 'hello there general kenobi');
    expect(result).not.toBeNull();
    expect(result!.text).toBe(ANSWER);
    expect(result!.sentenceEnds).toEqual(sentenceEnds(ANSWER));
    expect(result!.breakpoints).toEqual(breakpoints(ANSWER));
  });

  it('passes a null answer through as null', async () => {
    const clock = createVirtualClock();
    const runtime = runtimeOver(async () => null, clock);
    const result = await runtime.punctuate('en', 'text');
    expect(result).toBeNull();
  });

  it.each([['a number', 42], ['undefined', undefined]])('treats an answer that is not a string (%s) as null', async (_name, answer) => {
    const clock = createVirtualClock();
    const runtime = runtimeOver((async () => answer) as unknown as Punctuator, clock);
    let result: unknown = 'unsettled';
    void runtime.punctuate('en', 'text').then((r) => { result = r; });
    await settle();
    expect(result).toBeNull();
  });

  it('treats a rejection as null', async () => {
    const clock = createVirtualClock();
    const runtime = runtimeOver(async () => { throw new Error('boom'); }, clock);
    const result = await runtime.punctuate('en', 'text');
    expect(result).toBeNull();
  });
});
