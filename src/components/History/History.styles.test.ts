// src/components/History/History.styles.test.ts
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// Asserted on the compiled CSS, never by reading SCSS source.
const css = '\n' + compile(resolve(__dirname, 'History.scss'), { silenceDeprecations: ['import', 'global-builtin'] }).css;
const ruleBody = (selector: string): string | null => {
  const i = css.indexOf(`\n${selector} {`);
  if (i === -1) return null;
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
};

describe("the notes' filter", () => {
  // Chosen on the comparison page: in a narrow pane its choices go on to a second line, none cut off.
  it('wraps its choices, each a pill of its own, when the pane is too narrow for one line', () => {
    expect(ruleBody('.record-notes__filter')).toMatch(/flex-wrap:\s*wrap/);
    expect(ruleBody('.record-notes__filter')).not.toMatch(/overflow:\s*hidden/);
    const button = ruleBody('.record-notes__filter button');
    expect(button).toMatch(/border:\s*1px solid/);
    expect(button).toMatch(/border-radius:\s*12px/);
  });
});
