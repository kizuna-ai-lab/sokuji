import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

/**
 * The tag's narrow-width overrides stay nested under the segment, as the base rules
 * are; otherwise the base `display: none` on the glyph wins on specificity. Asserted
 * against the COMPILED CSS, as the other stylesheet invariants are.
 */
const css = compile(resolve(__dirname, 'ModePicker.scss')).css;
const narrow = css.slice(css.indexOf('@container (max-width: 768px)'));

const rule = (selector: string) => {
  const at = narrow.indexOf(`${selector} {`);
  return at < 0 ? '' : narrow.slice(at, narrow.indexOf('}', at));
};

describe('mode picker tag styling', () => {
  it('shows the glyph at narrow widths under the segment', () => {
    expect(rule('.mode-picker__segment .mode-picker__tag-glyph')).toMatch(/display:\s*inline-flex/);
  });

  it('rounds the tag to a ring at narrow widths under the segment', () => {
    expect(rule('.mode-picker__segment .mode-picker__tag')).toMatch(/border-radius:\s*50%/);
  });
});
