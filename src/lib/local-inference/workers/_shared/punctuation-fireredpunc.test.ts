import { describe, it, expect } from 'vitest';
import {
  ruleBasedTxtFix,
  stripMarks,
  parseOutDict,
  countSentenceEnds,
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
