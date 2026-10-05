import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// The status line's row is as tall as its tallest item (the action button), so
// its items sit on the row's axis: a one-line text is level with the button,
// with the same space above it and below it. Top alignment left the text 6px
// under the top edge and 12px over the bottom one. Asserted on the compiled CSS.
const css = compile(resolve(__dirname, 'MainPanel.scss')).css;
const rule = (selector: string) => css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

/** The declarations a selector gets inside `@supports (text-box: trim-both cap alphabetic)`. */
const trimmed = (selector: string) =>
  css.match(new RegExp(`@supports \\(text-box: trim-both cap alphabetic\\)\\s*\\{\\s*${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('status line alignment', () => {
  it('centres its items on the row', () => {
    expect(rule('\\.status-line')).toMatch(/\balign-items:\s*center\b/);
  });

  it('does not nudge the icon off that axis', () => {
    expect(rule('\\.status-line > svg')).not.toBe('');
    expect(rule('\\.status-line > svg')).not.toMatch(/margin-top/);
  });
});

// Centred boxes are not centred ink: a line box follows the Latin font's
// metrics, and a CJK glyph's ink sits about 0.8px above its middle at 12px
// (measured on Linux and macOS). Where the browser can, the line is trimmed to
// the cap box and the trimmed height comes back as padding, so the element
// keeps its height and the ink sits on the axis.
describe('status line text centring by the font’s metrics', () => {
  it('trims the text to the cap box and gives the height back', () => {
    expect(trimmed('\\.status-line__text')).toMatch(/text-box:\s*trim-both cap alphabetic/);
    expect(trimmed('\\.status-line__text')).toMatch(/padding-block:\s*calc\(\(1lh - 1cap\) \/ 2\)/);
  });

  it('trims the action’s label too, keeping the button’s own 3px each side', () => {
    expect(trimmed('\\.status-line__action')).toMatch(/text-box:\s*trim-both cap alphabetic/);
    expect(trimmed('\\.status-line__action')).toMatch(/padding-block:\s*calc\(\(1lh - 1cap\) \/ 2 \+ 3px\)/);
  });

  it('leaves the normal box for a browser without text-box', () => {
    expect(rule('\\.status-line__action')).toMatch(/padding:\s*3px 8px/);
    expect(rule('\\.status-line__action')).not.toMatch(/text-box/);
    expect(rule('\\.status-line__text')).not.toMatch(/text-box/);
  });
});
