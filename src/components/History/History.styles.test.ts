// src/components/History/History.styles.test.ts
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// Asserted on the compiled CSS, never by reading SCSS source.
const css = '\n' + compile(resolve(__dirname, 'History.scss'), { silenceDeprecations: ['import', 'global-builtin'] }).css;
const ruleBody = (selector: string): string | null => {
  const i = css.indexOf(`\n${selector} {`);
  if (i === -1) return null;
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
};

describe("the notes' filter", () => {
  // Chosen on the comparison page: in a narrow pane its choices go on to a second line, none cut off.
  it('wraps its choices, each a pill of its own, when the pane is too narrow for one line', () => {
    expect(ruleBody('.record-notes__filter')).toMatch(/flex-wrap:\s*wrap/);
    expect(ruleBody('.record-notes__filter')).not.toMatch(/overflow:\s*hidden/);
    const button = ruleBody('.record-notes__filter button');
    expect(button).toMatch(/border:\s*1px solid/);
    expect(button).toMatch(/border-radius:\s*12px/);
  });
});

// Review: the notes column lays itself out with flex, which outranks the browser's own [hidden] rule; hidden (the
// Transcript tab on a narrow page, or the notes closed on a wide one) it must still take no room at all.
describe('the record page\'s notes column', () => {
  it('takes no room when hidden', () => {
    expect(ruleBody('.record-page__notes-col') ?? '').toMatch(/display:\s*flex/);
    expect(ruleBody('.record-page__notes-col[hidden]') ?? '').toMatch(/display:\s*none/);
  });
});

// Owner, 2026-11-18: the version dropdown's chevron sits at its right edge, as on every other dropdown. A base-select
// control lays its chevron out after the text (pushed to the end), so the right padding the classic background arrow
// needed would leave an empty strip after the chevron.
describe("the transcript version dropdown", () => {
  it('keeps its chevron at the right edge where the customizable select draws it', () => {
    const block = /@supports \(appearance: base-select\) \{\s*\.history-file__versions \.select-dropdown \{([^}]*)\}/.exec(css);
    expect(block?.[1] ?? '').toMatch(/padding-right:\s*8px/);
  });
});
