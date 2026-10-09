import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// The Electron bar's "Return to main window" button, and the rule that keeps
// it on screen when the window is narrower than the bar's controls. Asserted
// on the compiled CSS, never by reading SCSS source.
const css = compile(resolve(__dirname, 'SubtitleBar.scss')).css;

/** The declarations of every rule (at top level, or inside `media`) whose selector list holds `selector` exactly. */
function declarations(selector: string, media?: string): string {
  let scope = css;
  if (media) {
    const at = css.indexOf(`@media ${media}`);
    if (at < 0) return '';
    const open = css.indexOf('{', at);
    let depth = 1;
    let i = open + 1;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth += 1;
      if (css[i] === '}') depth -= 1;
      i += 1;
    }
    scope = css.slice(open + 1, i - 1);
  }
  const out: string[] = [];
  for (const m of scope.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim());
    if (selectors.includes(selector)) out.push(m[2]);
  }
  return out.join('\n');
}

describe('subtitle bar exit button styles', () => {
  it('styles the labelled exit as a bordered icon-and-label button', () => {
    const exit = declarations('.subtitle-bar .subtitle-bar__exit');
    expect(exit).toMatch(/display:\s*inline-flex/);
    expect(exit).toMatch(/border:\s*1px solid/);
  });

  // The bar is the window's drag region; a button left in it drags the
  // window instead of taking the click.
  it('takes the exit out of the window drag region', () => {
    expect(declarations('.subtitle-bar .subtitle-bar__exit')).toMatch(/-webkit-app-region:\s*no-drag/);
  });

  // Wider than every locale's bar with the label shown (713-898px measured,
  // Tamil widest), so below it the label goes before anything else squeezes.
  it('drops the exit label, keeping its icon, below 900px', () => {
    expect(declarations('.subtitle-bar .subtitle-bar__exit-label', '(max-width: 900px)')).toMatch(/display:\s*none/);
  });

  it('cuts the tools from their start edge, so the exit at the end is the last control a narrow window loses', () => {
    const right = declarations('.subtitle-bar .subtitle-bar__right');
    expect(right).toMatch(/min-width:\s*0/);
    expect(right).toMatch(/overflow:\s*clip/);
    expect(right).toMatch(/justify-content:\s*flex-end/);
    expect(declarations('.subtitle-bar .subtitle-bar__right > *')).toMatch(/flex-shrink:\s*0/);
  });

  // The cut edge must not show a sliver of the cut tool, nor touch the text
  // beside it: room for the end button's focus ring on the end side only,
  // and a minimum gap between the segments.
  it('cuts cleanly at the start edge, a gap clear of the centre text', () => {
    const right = declarations('.subtitle-bar .subtitle-bar__right');
    expect(right).not.toMatch(/overflow-clip-margin/);
    expect(right).toMatch(/padding-inline-end:\s*3px/);
    expect(right).not.toMatch(/padding-inline-start|padding-left|padding:/);
    expect(declarations('.subtitle-bar')).toMatch(/column-gap:\s*12px/);
  });

  it('keeps the left and centre segments whole, so the tools give way instead of the text wrapping', () => {
    for (const seg of ['.subtitle-bar .subtitle-bar__left', '.subtitle-bar .subtitle-bar__center']) {
      const d = declarations(seg);
      expect(d).toMatch(/flex-shrink:\s*0/);
      expect(d).toMatch(/white-space:\s*nowrap/);
    }
  });
});
