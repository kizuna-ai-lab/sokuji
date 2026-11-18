// Owner, 2026-11-18: in an open language list the line between the pinned languages and the rest is a thin rule
// (Settings.scss), not a row. The settings page sizes its dropdowns' options as 30px rows with a selector just as
// specific and loaded later, so that sizing must leave the separator out, or it turns into a lit-up empty row.
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

const css = compile(resolve(__dirname, 'SettingsPage.scss'), { silenceDeprecations: ['import', 'global-builtin'] }).css;

/** Whether a selector's subject (its last compound, the option the rule sizes) is an option that is not the separator. */
const subjectSkipsSeparator = (selector: string): boolean => {
  const subject = selector.trim().split(/\s*[\s>+~]\s*/).pop() ?? '';
  return /^option:not\(\[value=["']?__pin-separator__["']?\]\)$/.test(subject);
};

describe("the settings page's dropdown options", () => {
  it('tells a rule that sizes every option but the separator from one that only skips it as a neighbour', () => {
    expect(subjectSkipsSeparator(".settings-page .language-select option:not([value='__pin-separator__'])")).toBe(true);
    expect(subjectSkipsSeparator(".settings-page .language-select option:not([value='__pin-separator__']) + option")).toBe(false);
    expect(subjectSkipsSeparator('.settings-page .language-select option')).toBe(false);
  });

  it('are sized as rows, all but the pinned-languages separator', () => {
    const sized = [...css.matchAll(/([^{}]*\boption\b[^{}]*)\{([^}]*min-height:\s*30px[^}]*)\}/g)].map((m) => m[1]);
    expect(sized.length).toBeGreaterThan(0);
    for (const selector of sized) {
      for (const part of selector.split(',')) expect(subjectSkipsSeparator(part)).toBe(true);
    }
  });
});
