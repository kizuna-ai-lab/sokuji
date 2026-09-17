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

const pickerCss = compile(resolve(__dirname, 'VoicePicker.scss')).css;

describe('voice picker styling', () => {
  it.each([
    'voice-picker',
    'voice-picker__trigger',
    'voice-pop',
    'voice-pop__facets',
    'voice-pop__grid',
    'voice-row',
    'voice-row__pick',
    'voice-row__btn',
    'voice-row__add',
    'is-playing',
    'voice-row--add',
  ])('styles .%s where the element lives', (cls) => {
    expect(pickerCss).toMatch(styled(cls));
  });
});

// Task 6 renames these into a shared `voice-modal*` set (shared with
// VoiceDeleteModal) and re-points this describe at that stylesheet instead;
// expected churn, not drift.
const createModalCss = compile(resolve(__dirname, 'VoiceCreateModal.scss')).css;

describe('voice create modal styling', () => {
  it.each([
    'voice-create-modal-overlay',
    'voice-create-modal',
    'voice-create-modal__head',
    'voice-create-modal__x',
    'voice-create-modal__body',
    'voice-create-modal__foot',
    'voice-create-modal__transcript-field',
    'voice-create-modal__transcript-label',
    'voice-create-modal__transcript-input',
    'voice-create-modal__transcript-hint',
    'voice-create-modal__import-btn',
    'voice-create-modal__drop-zone',
    'voice-create-modal__note',
    'voice-create-modal__cancel',
  ])('styles .%s where the element lives', (cls) => {
    expect(createModalCss).toMatch(styled(cls));
  });
});
