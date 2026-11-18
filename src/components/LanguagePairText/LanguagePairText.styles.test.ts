import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// Asserted on the compiled CSS, never by reading SCSS source.
const css = '\n' + compile(resolve(__dirname, 'LanguagePairText.scss'), { silenceDeprecations: ['import', 'global-builtin'] }).css;
const ruleBody = (selector: string): string => {
  const i = css.indexOf(`\n${selector} {`);
  if (i === -1) return '';
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
};

// Owner, 2026-11-19: measured in the app (Ubuntu, the footer's 12 px), an icon 1.2em square set 0.25em below the
// baseline is 9.8 px wide with its middle within 0.25 px of Chinese, Japanese and English names'; the font's arrow was
// 7 px wide and 0.6 px low.
describe("the language pair's arrow", () => {
  it('is a little larger than the text and centred on the names', () => {
    const arrow = ruleBody('.language-pair-text__arrow');
    expect(arrow).toMatch(/width:\s*1\.2em/);
    expect(arrow).toMatch(/height:\s*1\.2em/);
    expect(arrow).toMatch(/vertical-align:\s*-0\.25em/);
  });

  it('keeps the arrow character for a screen reader without showing it', () => {
    // Placed within the pair, so its 1px box adds nothing to a scrolling row or footer around it.
    expect(ruleBody('.language-pair-text')).toMatch(/position:\s*relative/);
    const said = ruleBody('.language-pair-text__said');
    expect(said).toMatch(/margin:\s*-1px/);
    expect(said).toMatch(/position:\s*absolute/);
    expect(said).toMatch(/clip:\s*rect\(0,? 0,? 0,? 0\)/);
    expect(said).toMatch(/width:\s*1px/);
  });
});
