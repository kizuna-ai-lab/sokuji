import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// At the extension side panel's 360px the basic footer holds the mode picker,
// the screen-context chip, Start and the language pair. The pair is what gives
// way: its box may shrink and its text ends in an ellipsis, so Start and the
// chip stay inside the footer. Asserted on the compiled CSS.
const css = compile(resolve(__dirname, 'MainPanel.scss')).css;
const rule = (selector: string) => css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('the basic footer at a narrow width', () => {
  it('lets the metadata box shrink below its content', () => {
    const metadata = rule('\\.control-footer\\.basic \\.footer-metadata');
    expect(metadata).toMatch(/\bmin-width:\s*0\b/);
    expect(metadata).not.toMatch(/flex-shrink:\s*0\b/);
  });

  it('cuts the language pair with an ellipsis on one line', () => {
    const pair = rule('\\.control-footer\\.basic \\.footer-metadata \\.language-pair');
    expect(pair).toMatch(/\bmin-width:\s*0\b/);
    expect(pair).toMatch(/\boverflow:\s*hidden\b/);
    expect(pair).toMatch(/\btext-overflow:\s*ellipsis\b/);
    expect(pair).toMatch(/\bwhite-space:\s*nowrap\b/);
  });

  it('keeps Start from shrinking (the chip keeps its own size, ScreenContextChip.scss)', () => {
    expect(rule('\\.control-footer\\.basic \\.action-cluster')).toMatch(/flex-shrink:\s*0\b/);
  });
});
