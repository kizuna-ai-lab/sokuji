import { describe, it, expect } from 'vitest';
import { arrowBetween } from './arrowBetween';

const LRM = '\u200E';
const LRI = '\u2066';
const PDI = '\u2069';

// Review, 2026-11-18 (Hebrew, Arabic and Persian): "name → name" with both names in a right-to-left script is laid out
// by the browser as one right-to-left run, the names swapped and the arrow not, so the arrow pointed the wrong way.
describe('two language names with an arrow between them', () => {
  it('marks each side of the arrow left to right, in a left-to-right isolate, so the names keep their places', () => {
    expect(arrowBetween('יפנית', '→', 'סינית')).toBe(`${LRI}יפנית${LRM} → ${LRM}סינית${PDI}`);
    expect(arrowBetween('اليابانية', '←', 'الصينية')).toBe(`${LRI}اليابانية${LRM} ← ${LRM}الصينية${PDI}`);
  });

  it('reads as it did in a left-to-right script: the marks take no room', () => {
    expect(arrowBetween('Japanese', '⇄', 'Chinese').replace(/[\u200E\u2066\u2069]/g, '')).toBe('Japanese ⇄ Chinese');
  });
});
