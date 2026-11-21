import { describe, it, expect } from 'vitest';
import { createSourceCutter, type Stretch } from './cutter';

/** Feeds the snapshots of one origin in order, and lists what each yields. */
function feedAll(...snapshots: Array<[text: string, stableLen: number, closed?: boolean]>): Stretch[][] {
  const cutter = createSourceCutter();
  return snapshots.map(([text, stableLen, closed]) => cutter.feed({ text, stableLen, closed: closed === true }));
}
const texts = (yielded: Stretch[][]) => yielded.map((stretches) => stretches.map((s) => s.text));

describe('the source cutter: while the source is open', () => {
  it('yields nothing while nothing is stable', () => {
    expect(texts(feedAll(['Hello. How are', 0], ['Hello. How are you? Fine.', 0]))).toEqual([[], []]);
  });

  it('yields a sentence of the stable start once stable text follows its end', () => {
    expect(texts(feedAll(
      ['Hello. How', 5],
      // The mark is stable, but nothing after it is: the sentence may still go on ("3." before "5").
      ['Hello. How', 6],
      ['Hello. How', 7],
      ['Hello. How', 8],
    ))).toEqual([[], [], [], ['Hello.']]);
  });

  it('says where each stretch sits in the source, without the spaces around it', () => {
    const [first, second] = feedAll(['One.  Two. Three', 16], ['One.  Two. Three.', 17, true]);
    expect(first).toEqual([{ text: 'One.  Two.', span: [0, 10] }]);
    expect(second).toEqual([{ text: 'Three.', span: [11, 17] }]);
  });

  it('never yields a stretch again, however often the same snapshot comes', () => {
    expect(texts(feedAll(['One. Two', 8], ['One. Two', 8], ['One. Two. Th', 12], ['One. Two. Th', 12]))).toEqual([['One.'], [], ['Two.'], []]);
  });

  it('yields the sentences that became stable together as one stretch', () => {
    expect(texts(feedAll(['One. Two. Three. Fo', 19]))).toEqual([['One. Two. Three.']]);
  });

  it('copes with a stable start that grows in the middle of a sentence', () => {
    expect(texts(feedAll(
      ['The weather is', 3],
      ['The weather is nice today. And', 11],
      ['The weather is nice today. And tomorrow', 26],
      ['The weather is nice today. And tomorrow', 30],
    ))).toEqual([[], [], [], ['The weather is nice today.']]);
  });

  it('reads the unstable tail as not there: a mark in it ends nothing', () => {
    expect(texts(feedAll(['Wait. Really? Yes', 4], ['Wait. Really? Yes', 9]))).toEqual([[], ['Wait.']]);
  });

  it('does not end a sentence at a decimal, an abbreviation or an ellipsis', () => {
    expect(texts(feedAll(['It costs 3.5 dollars now', 24]))).toEqual([[]]);
    expect(texts(feedAll(['Dr. Smith is in now', 19]))).toEqual([[]]);
    expect(texts(feedAll(['Well... maybe so', 16]))).toEqual([[]]);
  });

  it('keeps marks that come together, and the quote that closes a sentence, with it', () => {
    expect(texts(feedAll(['Really?! Yes', 12]))).toEqual([['Really?!']]);
    expect(texts(feedAll(['He said "Go." Then', 18]))).toEqual([['He said "Go."']]);
  });

  it('cuts at CJK sentence marks, which no space follows', () => {
    expect(feedAll(['今日は晴れです。明日は', 9], ['今日は晴れです。明日は雨ですか？はい', 18])).toEqual([
      [{ text: '今日は晴れです。', span: [0, 8] }],
      [{ text: '明日は雨ですか？', span: [8, 16] }],
    ]);
  });

  it('holds a stable length to the text it was given: one past the end is the end, and it never goes back', () => {
    expect(texts(feedAll(['One. Two', 99], ['One. Two. Three', 2], ['One. Two. Three', 15]))).toEqual([['One.'], [], ['Two.']]);
  });
});

describe('the source cutter: when the source closes', () => {
  it('yields the rest, whatever was stable', () => {
    expect(texts(feedAll(['One. Two', 8], ['One. Two. Three.', 8, true]))).toEqual([['One.'], ['Two. Three.']]);
  });

  it('yields text with no punctuation whole, at the close', () => {
    expect(texts(feedAll(['so this is', 4], ['so this is what I mean', 22], ['so this is what I mean', 22, true]))).toEqual([[], [], ['so this is what I mean']]);
  });

  it('yields a source that closes in its first snapshot', () => {
    expect(feedAll(['  Hello there.  ', 0, true])).toEqual([[{ text: 'Hello there.', span: [2, 14] }]]);
  });

  it('yields nothing for a rest that holds no letter or digit', () => {
    expect(texts(feedAll(['One. Two', 8], ['One. ', 5, true]))).toEqual([['One.'], []]);
    expect(texts(feedAll(['', 0, true]))).toEqual([[]]);
    expect(texts(feedAll([' … ', 0, true]))).toEqual([[]]);
  });

  it('yields nothing more once it has closed', () => {
    expect(texts(feedAll(['One.', 4, true], ['One. Two.', 9, true], ['One. Two. Three', 15]))).toEqual([['One.'], [], []]);
  });

  it('yields nothing for a final text that is shorter than what was already yielded', () => {
    expect(texts(feedAll(['One. Two. Th', 12], ['One.', 4, true]))).toEqual([['One. Two.'], []]);
  });
});
