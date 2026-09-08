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

/** The body of the first rule whose selector is exactly `selector`, or null. */
const ruleBody = (selector: string): string | null => {
  const i = css.indexOf(`\n${selector} {`);
  if (i === -1) return null;
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  return close === -1 ? null : css.slice(open + 1, close);
};

const ABSOLUTE = { thin: 1, medium: 3, thick: 5 } as const;

/**
 * The outline width a declaration block ends up with, in px. `none` and every
 * spelling of zero come back 0 — which is the point: "there is an outline
 * property" is not the same claim as "there is a visible ring", and asserting
 * the former is how this test first shipped with `outline: 0` passing.
 */
const outlineWidthPx = (body: string | null): number => {
  if (body === null) return 0;
  const decl = body.match(/\boutline:\s*([^;]+)/)?.[1];
  if (!decl) return 0;
  if (/\bnone\b/.test(decl)) return 0;
  for (const [word, px] of Object.entries(ABSOLUTE)) {
    if (new RegExp(`\\b${word}\\b`).test(decl)) return px;
  }
  const len = decl.match(/(-?[\d.]+)(px|rem|em)\b/);
  if (len) return parseFloat(len[1]) * (len[2] === 'px' ? 1 : 16);
  // A bare number is only valid as zero-width in this position.
  return 0;
};

// Every stop in the menu's roving-tabindex ring is reachable by keyboard, so
// each one has to show where the focus is. A border colour change is not
// enough: #666 on the #2a2a2a menu measures 2.5:1, under the 3:1 floor for a
// non-text indicator.
describe('menu keyboard focus is visible', () => {
  for (const sel of ['.export-scope-box', '.export-menu-item']) {
    it(`${sel} draws an outline with real width on :focus-visible`, () => {
      expect(outlineWidthPx(ruleBody(`${sel}:focus-visible`))).toBeGreaterThan(0);
    });

    it(`${sel} does not cancel that outline from its other states`, () => {
      // A same-specificity :hover rule written later would win, so no other
      // state on this selector may declare an outline at all.
      for (const state of ['', ':hover', ':focus']) {
        const body = ruleBody(`${sel}${state}`);
        if (body !== null) expect(body).not.toMatch(/\boutline:/);
      }
    });
  }
});
