import { describe, it, expect } from 'vitest';
import { joinSegmentTexts, needsSpace } from './join';

describe('needsSpace', () => {
  it('asks for a space only between two space-delimited scripts', () => {
    expect(needsSpace('Hello.', 'World')).toBe(true);
    expect(needsSpace('今天', '天气')).toBe(false);
    expect(needsSpace('見て', 'OK')).toBe(false);
    expect(needsSpace('OK', 'です')).toBe(false);
  });

  it('reads a character outside the basic plane as one character', () => {
    // 𠮷 is Han, written as a surrogate pair.
    expect(needsSpace('𠮷', 'a')).toBe(false);
    expect(needsSpace('a', '𠮷')).toBe(false);
  });

  it('asks for none beside an empty piece', () => {
    expect(needsSpace('', 'a')).toBe(false);
    expect(needsSpace('a', '')).toBe(false);
  });
});

describe('joinSegmentTexts', () => {
  it('trims each piece, skips empty ones, and spaces only where the scripts need it', () => {
    expect(joinSegmentTexts([' Hello. ', '', 'World.'])).toBe('Hello. World.');
    expect(joinSegmentTexts(['今天天气很好。', ' 我们去公园吧。'])).toBe('今天天气很好。我们去公园吧。');
    expect(joinSegmentTexts(['𠮷', 'a'])).toBe('𠮷a');
  });
});
