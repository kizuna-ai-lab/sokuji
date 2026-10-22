// src/viewer/presentStyles.test.ts
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// The projector page's footer: a long Android hint (German runs to two lines)
// must not squeeze the viewer count beside it onto two lines. Asserted on the
// compiled CSS, never by reading SCSS source.
const css = '\n' + compile(resolve(__dirname, 'present.scss'), { silenceDeprecations: ['import', 'global-builtin'] }).css;
const ruleBody = (selector: string): string | null => {
  const i = css.indexOf(`\n${selector} {`);
  if (i === -1) return null;
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
};

describe('projector page footer', () => {
  it('keeps the viewer count on one line beside a long note', () => {
    const count = ruleBody('.present__count');
    expect(count).toMatch(/white-space:\s*nowrap/);
    expect(count).toMatch(/flex-shrink:\s*0/);
  });
});

// Spec 2026-10-22 §5: `tk.$color-primary` is an alias of `--sk-primary`, which
// only theme.scss defines; the projector page's stylesheet emits it first.
describe('present: the app theme tokens come first', () => {
  it('defines the --sk- tokens before its own rules', () => {
    expect(css).toMatch(/\n:root \{[^}]*--sk-primary:/);
    expect(css.indexOf('--sk-primary:')).toBeLessThan(css.indexOf('\n.present {'));
  });
});
