import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// The scope checkboxes carry their state only in aria-checked; if the rules
// keyed on it are lost, all four render identically and the user cannot see
// what the export will contain. Asserted on the compiled CSS, never by reading
// SCSS source, so a rule that stops being emitted surfaces here.
const css = compile(resolve(__dirname, 'ExportButton.scss')).css;

describe('export scope checkbox states are visually distinct', () => {
  it('gives the checked box its own colour', () => {
    expect(css).toMatch(
      /\.export-scope-box\[aria-checked=["']?true["']?\]\s*\{[^}]*\bcolor:/,
    );
  });

  it('gives the checked box its own border colour', () => {
    expect(css).toMatch(
      /\.export-scope-box\[aria-checked=["']?true["']?\]\s*\{[^}]*\bborder-color:/,
    );
  });

  it('fills the checked box, so the state is not carried by hue alone', () => {
    expect(css).toMatch(
      /\.export-scope-box\[aria-checked=["']?true["']?\]\s*\{[^}]*\bbackground:/,
    );
  });

  it('gives the two line columns equal width', () => {
    // 1fr 1fr, not auto auto: the columns must not size to their own label, or
    // "Src" renders narrower than "Trans" and the two rows look ragged.
    expect(css).toMatch(
      /\.export-scope\s*\{[^}]*\bgrid-template-columns:\s*max-content\s+1fr\s+1fr\b/,
    );
  });

  it('keeps the disabled export actions visibly disabled', () => {
    expect(css).toMatch(/\.export-menu-item:disabled\s*\{[^}]*\bopacity:/);
  });
});

// Every stop in the menu's roving-tabindex ring is reachable by keyboard, so
// each one has to show where the focus is. A border colour change is not
// enough: #666 on the #2a2a2a menu measures 2.5:1, under the 3:1 floor for a
// non-text indicator.
describe('menu keyboard focus is visible', () => {
  for (const sel of ['.export-scope-box', '.export-menu-item']) {
    const esc = sel.replace(/\./g, '\\.');

    it(`${sel} draws an outline on :focus-visible`, () => {
      expect(css).toMatch(new RegExp(String.raw`${esc}:focus-visible\s*\{[^}]*\boutline:\s*\S`));
    });

    it(`${sel} never suppresses the outline`, () => {
      expect(css).not.toMatch(new RegExp(String.raw`${esc}[^{]*\{[^}]*\boutline:\s*none`));
    });
  }
});
