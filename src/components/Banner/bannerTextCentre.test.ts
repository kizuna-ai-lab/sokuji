import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// The banner's words and its button's label are centred by the font's metrics
// where the browser can trim a line to its cap box (see the status line's
// test for why): without it a CJK label sat about 1px low here, and the
// button's height changed with the interface language. Asserted on the
// compiled CSS.
const css = compile(resolve(__dirname, 'Banner.scss')).css;
const rule = (selector: string) => css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
const trimmed = (selector: string) =>
  css.match(new RegExp(`@supports \\(text-box: trim-both cap alphabetic\\)\\s*\\{\\s*${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('banner text centring by the font’s metrics', () => {
  it('trims the button’s label to the cap box and gives the height back', () => {
    expect(trimmed('\\.banner__btn-label')).toMatch(/text-box:\s*trim-both cap alphabetic/);
    expect(trimmed('\\.banner__btn-label')).toMatch(/padding-block:\s*calc\(\(1lh - 1cap\) \/ 2\)/);
  });

  it('trims each line of words the same way', () => {
    expect(trimmed('\\.banner__text > span')).toMatch(/text-box:\s*trim-both cap alphabetic/);
    expect(trimmed('\\.banner__text > span')).toMatch(/padding-block:\s*calc\(\(1lh - 1cap\) \/ 2\)/);
  });

  it('leaves the button’s normal box for a browser without text-box', () => {
    expect(rule('\\.banner__btn')).toMatch(/padding:\s*3px 8px/);
    expect(rule('\\.banner__btn')).not.toMatch(/text-box/);
  });
});
