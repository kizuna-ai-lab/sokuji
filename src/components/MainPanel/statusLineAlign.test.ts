import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// The status line's row is as tall as its tallest item (the action button), so
// its items sit on the row's axis: a one-line text is level with the button,
// with the same space above it and below it. Top alignment left the text 6px
// under the top edge and 12px over the bottom one. Asserted on the compiled CSS.
const css = compile(resolve(__dirname, 'MainPanel.scss')).css;
const rule = (selector: string) => css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('status line alignment', () => {
  it('centres its items on the row', () => {
    expect(rule('\\.status-line')).toMatch(/\balign-items:\s*center\b/);
  });

  it('does not nudge the icon off that axis', () => {
    expect(rule('\\.status-line > svg')).not.toBe('');
    expect(rule('\\.status-line > svg')).not.toMatch(/margin-top/);
  });
});
