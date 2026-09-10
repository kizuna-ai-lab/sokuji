import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

/**
 * The facet bar's classes are styled where the elements live.
 *
 * A class name is unchecked by TypeScript, by the component tests (which query
 * by role) and by review alike — the bar renders and behaves correctly whether
 * or not a single rule matches it, so the only thing standing between a typo
 * and an unstyled control is this file. Asserted against the COMPILED CSS
 * rather than by reading SCSS source, so a rule that stops being emitted (a
 * nesting mistake, a lost parent selector) fails here.
 */
const css = compile(resolve(__dirname, 'VoiceLibrarySection.scss')).css;

/** `(?![\w-])` and not `\b`: `\b` would let `.voice-facet-tag` satisfy an
 *  assertion about `.voice-facet-tags`, and vice versa. */
const styled = (cls: string) => new RegExp(String.raw`\.${cls}(?![\w-])`);

describe('facet filter bar styling', () => {
  it.each([
    'voice-facet-bar',
    'voice-facet-fields',
    'voice-facet-field',
    'voice-facet-label',
    'voice-facet-select',
    'voice-facet-status',
    'voice-facet-count',
    'voice-facet-empty',
    'voice-facet-clear',
    'voice-selected-description',
  ])('styles .%s', (cls) => {
    expect(css).toMatch(styled(cls));
  });


  it('keeps the bar clear of the select above it', () => {
    // .voice-library-section sets no gap — the spacing between its children is
    // each child's own margin (see the note at the top of the stylesheet), so a
    // bar without one sits flush against the dropdown.
    expect(css).toMatch(/\.voice-facet-bar\s*\{[^}]*\bmargin/);
  });
});
