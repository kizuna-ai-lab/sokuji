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
