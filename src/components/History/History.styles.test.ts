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

// Owner, 2026-11-19: the record page has two columns down to 641 px, on a window MainLayout already counts as narrow
// (768 px and below), where it hides .panel-resizer because its own panels stack. The record page's columns still stand
// side by side there, so their dividers are kept.
describe("the record page's dividers", () => {
  it('stay on a window too narrow for the main layout\'s dividers', () => {
    // Three classes: it outranks both rules that hide the divider there, PanelResizer's own (.panel-resizer) and
    // MainLayout's (.main-layout .panel-resizer).
    expect(ruleBody('.record-page .record-page__columns > .panel-resizer') ?? '').toMatch(/display:\s*block/);
  });
});

// Review: a window under 768 px scrolls the record page's columns as one, the transcript growing in them; with two
// columns side by side there (641 px and up) that moved the notes or the edit panel off with the transcript. Only the
// tabs, one part at a time, scroll so.
describe("the record page's scrolling on a narrow window", () => {
  const narrow = (() => {
    const at = css.indexOf('@media (max-width: 767px)');
    const open = css.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
    }
    return '';
  })();
  const rules = [...narrow.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));

  it('scrolls the columns as one only in the tabs, leaving side-by-side columns to scroll each on its own', () => {
    const scrolling = rules.filter((r) => /overflow-y/.test(r.body) && r.selector.includes('record-page'));
    expect(scrolling.map((r) => r.selector).sort()).toEqual([
      '.record-page__columns:not(.has-columns)',
      '.record-page__columns:not(.has-columns) .record-page__transcript',
    ]);
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
