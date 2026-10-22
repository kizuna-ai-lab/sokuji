import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// #510 §3: one rest colour for the whole conversation toolbar. Asserted on the
// compiled CSS, never by reading SCSS source — a token that resolves to the
// wrong value, or a rule that stops reading it, both surface here.
const css = ['DisplayModeButton.scss', 'ExportButton.scss', 'MainPanel.scss']
  .map((f) => compile(resolve(__dirname, f)).css)
  .join('\n');

const TOOLBAR_RULES = ['.display-mode-btn', '.export-btn', '.font-size-btn', '.clear-conversation-btn'];

describe('conversation toolbar rest colour', () => {
  for (const sel of TOOLBAR_RULES) {
    // The one value is the toolbar-icon token (#8a8a8a in dark, spec 2026-10-22 §2).
    it(`${sel} rests at the toolbar-icon token`, () => {
      const esc = sel.replace(/\./g, '\\.');
      expect(css).toMatch(new RegExp(String.raw`(?:^|\n)${esc}\s*\{[^}]*\bcolor:\s*var\(--sk-toolbar-icon\)`));
    });
  }

  // Catches a fifth toolbar rule left behind at the old value. Both spellings:
  // sass emits whatever the source wrote, so #555 and #555555 both have to be
  // covered — a mutation check that only wrote the 6-digit form slipped past
  // the 3-digit-only pattern this started as.
  it('no toolbar rule still rests at the old #555', () => {
    expect(css).not.toMatch(/\bcolor:\s*#555(?:555)?\b/i);
  });
});
