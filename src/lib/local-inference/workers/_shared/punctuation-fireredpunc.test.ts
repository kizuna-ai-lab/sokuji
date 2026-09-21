import { describe, it, expect } from 'vitest';
import {
  ruleBasedTxtFix,
  stripMarks,
  parseOutDict,
  decode,
  countSentenceEnds,
  countBreakpoints,
} from './punctuation-fireredpunc';

describe('fireredpunc out_dict', () => {
  it('maps <space> to a blank label and keeps the four marks', () => {
    expect(parseOutDict('<space>\n，\n。\n？\n！')).toEqual([' ', '，', '。', '？', '！']);
  });
});

describe('fireredpunc stripMarks', () => {
  it('removes the marks the model predicts', () => {
    expect(stripMarks('你好，世界。')).toBe('你好 世界 ');
  });
  it('keeps a dot that joins two digits', () => {
    expect(stripMarks('version 3.5 here')).toBe('version 3.5 here');
  });
});

describe('fireredpunc ruleBasedTxtFix', () => {
  it('converts a full-width mark between ASCII letters and adds a space', () => {
    expect(ruleBasedTxtFix('hello，world')).toBe('Hello, world');
  });
  it('capitalises a standalone i', () => {
    expect(ruleBasedTxtFix('so i went')).toBe('So I went');
  });
  it('capitalises after a terminal', () => {
    expect(ruleBasedTxtFix('one. two')).toBe('One. Two');
  });
  it('leaves CJK untouched', () => {
    expect(ruleBasedTxtFix('你好，世界。')).toBe('你好，世界。');
  });
});

// The `units` and `preds` below are captured from a real run of the fireredpunc-q8w
// model against the actual ONNX weights at
// ~/.cache/sokuji-punct-bench/fireredpunc-onnx/ (see task-5-report.md for the capture
// script and its raw output). `units` pairs the captured `tokens`/`ids` with { first,
// last } spans recomputed from a verbatim copy of fireredpunc.mjs's own (unexported)
// `tokenize`, not from this port. `built`/`fixed`/`out` below are the real model's
// captured output, not values produced by the code under test.
describe('fireredpunc decode', () => {
  it('reproduces the real model output for a pure-CJK input', () => {
    const units = [
      { raw: '今', id: 791, first: 0, last: 0 },
      { raw: '天', id: 1921, first: 1, last: 1 },
      { raw: '天', id: 1921, first: 2, last: 2 },
      { raw: '气', id: 3698, first: 3, last: 3 },
      { raw: '很', id: 2523, first: 4, last: 4 },
      { raw: '好', id: 1962, first: 5, last: 5 },
      { raw: '我', id: 2769, first: 6, last: 6 },
      { raw: '们', id: 812, first: 7, last: 7 },
      { raw: '一', id: 671, first: 8, last: 8 },
      { raw: '起', id: 6629, first: 9, last: 9 },
      { raw: '出', id: 1139, first: 10, last: 10 },
      { raw: '去', id: 1343, first: 11, last: 11 },
      { raw: '玩', id: 4381, first: 12, last: 12 },
    ];
    const preds = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 2];
    const outDict = [' ', '，', '。', '？', '！'];
    const cps = Array.from('今天天气很好我们一起出去玩');
    const result = decode(cps, units, preds, outDict);
    expect(result.built).toBe('今天天气很好，我们一起出去玩。');
    expect(result.fixed).toBe('今天天气很好，我们一起出去玩。');
    expect(result.out).toBe('今天天气很好，我们一起出去玩。');
  });

  it('reproduces the real model output for an ASCII sentence, exercising the full-width-to-ASCII conversion and the casing projection', () => {
    const units = [
      { raw: 'i', id: 151, first: 0, last: 0 },
      { raw: 'think', id: 12553, first: 2, last: 6 },
      { raw: 'this', id: 8554, first: 8, last: 11 },
      { raw: 'is', id: 8310, first: 13, last: 14 },
      { raw: 'a', id: 143, first: 16, last: 16 },
      { raw: 'great', id: 10512, first: 18, last: 22 },
      { raw: 'idea', id: 11834, first: 24, last: 27 },
      { raw: 'we', id: 8997, first: 29, last: 30 },
      { raw: 'sh', id: 11167, first: 32, last: 33 },
      { raw: '##ould', id: 11734, first: 34, last: 37 },
      { raw: 't', id: 162, first: 39, last: 39 },
      { raw: '##ry', id: 8449, first: 40, last: 41 },
      { raw: 'it', id: 8233, first: 43, last: 44 },
    ];
    const preds = [0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 2];
    const outDict = [' ', '，', '。', '？', '！'];
    const cps = Array.from('i think this is a great idea we should try it');
    const result = decode(cps, units, preds, outDict);
    expect(result.built).toBe('i think this is a great idea。we should try it。');
    expect(result.fixed).toBe('I think this is a great idea. We should try it.');
    expect(result.out).toBe('I think this is a great idea. We should try it.');
  });
});

describe('fireredpunc breakpoints', () => {
  it('counts the commas the model wrote as well as its sentence ends', () => {
    expect(countBreakpoints('第一部分，第二部分。')).toEqual([5, 10]);
  });
  it('does not count marks FireRedPunc never emits', () => {
    expect(countBreakpoints('一、二；三：四')).toEqual([]);
  });
});

describe('fireredpunc sentence counting', () => {
  it('counts the three CJK terminals', () => {
    expect(countSentenceEnds('第一句。第二句！第三句？')).toEqual([4, 8, 12]);
  });
  it('does not count a comma', () => {
    expect(countSentenceEnds('第一部分，第二部分。')).toEqual([10]);
  });
  it('counts an ASCII period only when the shared rule accepts it', () => {
    expect(countSentenceEnds('Dr. Smith spoke. Then left.')).toEqual([16, 27]);
  });
});
