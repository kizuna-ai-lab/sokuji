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

// Task 6 made VoiceLibrarySection a composition root: the facet bar and its
// `.voice-facet-*` classes moved to VoicePicker (see the 'voice picker
// styling' describe below, which Task 3 appended and already covers them),
// so this describe now pins only what still renders directly in the section
// itself.
describe('voice library section styling', () => {
  it.each([
    'voice-selected-description',
  ])('styles .%s', (cls) => {
    expect(css).toMatch(styled(cls));
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
    'voice-unstable-tag',
  ])('styles .%s where the element lives', (cls) => {
    expect(pickerCss).toMatch(styled(cls));
  });

  // Not a class, so `styled()` — which anchors on a leading dot — cannot
  // express it. The row's shrinkable floor has to be keyed on the ARIA role
  // attribute because nothing gives the gridcell wrapper a class, and it is
  // that wrapper (not `.voice-row__pick`) which is the row's flex item. A typo
  // in either selector would be entirely silent: the rows still render, they
  // just stop truncating long labels at narrow windows — and no vitest case
  // can measure that, since jsdom has no layout. This asserts only that both
  // rules are EMITTED; whether they have the intended effect is the Task 10
  // geometry harness's question (see the stylesheet's own comment).
  it.each([
    String.raw`\.voice-row\s*>\s*\[role=["']?gridcell["']?\]\s*\{`,
    String.raw`\.voice-row\s*>\s*\[role=["']?gridcell["']?\]:first-child\s*\{`,
  ])('emits the row gridcell rule matching %s', (pattern) => {
    expect(pickerCss).toMatch(new RegExp(pattern));
  });
});

// VoiceCreateModal.scss is also VoiceDeleteModal's stylesheet — the delete
// modal imports it rather than owning its own, sharing the `voice-modal*`
// frame Task 6 renamed these classes into. This describe covers both
// modals' classes for that reason.
const createModalCss = compile(resolve(__dirname, 'VoiceCreateModal.scss')).css;

describe('voice create/delete modal styling', () => {
  it.each([
    // Shared frame (both modals)
    'voice-modal-overlay',
    'voice-modal',
    'voice-modal__head',
    'voice-modal__x',
    'voice-modal__body',
    'voice-modal__foot',
    'voice-modal__btn',
    'voice-modal__btn--danger',
    // VoiceCreateModal's own body content
    'voice-create-modal__transcript-field',
    'voice-create-modal__transcript-label',
    'voice-create-modal__transcript-input',
    'voice-create-modal__transcript-hint',
    'voice-create-modal__import-btn',
    'voice-create-modal__drop-zone',
    'is-dragging',
    'voice-create-modal__note',
  ])('styles .%s where the element lives', (cls) => {
    expect(createModalCss).toMatch(styled(cls));
  });
});
