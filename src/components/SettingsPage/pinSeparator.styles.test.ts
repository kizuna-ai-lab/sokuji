// Owner, 2026-11-18: in an open language list the line between the pinned languages and the rest is a thin rule
// (Settings.scss), not a row. The settings page sizes its dropdowns' options as 30px rows with a selector just as
// specific and loaded later, so that sizing must leave the separator out, or it turns into a lit-up empty row.
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

const css = compile(resolve(__dirname, 'SettingsPage.scss'), { silenceDeprecations: ['import', 'global-builtin'] }).css;

/**
 * Whether a selector can match the separator: its subject (the last compound, the element the rule styles) is an
 * option or names no element, carries no class or id (the separator has neither), and does not leave the separator out
 * with `:not([value='__pin-separator__'])`. `[value='__pin-separator__']` on its own matches it.
 */
const canMatchSeparator = (selector: string): boolean => {
  const subject = selector.trim().split(/\s*[\s>+~]\s*/).pop() ?? '';
  const type = /^[a-z*]+/i.exec(subject)?.[0];
  if (type && type !== 'option' && type !== '*') return false;
  if (/[.#]/.test(subject.replace(/\[[^\]]*\]/g, ''))) return false;
  return !/:not\(\[value=["']?__pin-separator__["']?\]\)/.test(subject);
};

/** The rules that give an element the 30px row height, as their selectors' comma-separated parts. */
const sizedSelectors = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => /min-height:\s*30px/.test(m[2]))
  .flatMap((m) => m[1].split(','));

describe("the settings page's dropdown options", () => {
  it('tells a rule that can size the separator from one that cannot', () => {
    expect(canMatchSeparator(".settings-page .language-select option:not([value='__pin-separator__'])")).toBe(false);
    expect(canMatchSeparator(".settings-page .language-select option:not([value='__pin-separator__']):checked")).toBe(false);
    expect(canMatchSeparator('.settings-page .language-select')).toBe(false);
    expect(canMatchSeparator(".settings-page .language-select option:not([value='__pin-separator__']) + option")).toBe(true);
    expect(canMatchSeparator('.settings-page .language-select option')).toBe(true);
    expect(canMatchSeparator(".settings-page .language-select [value='__pin-separator__']")).toBe(true);
  });

  it('are sized as rows, all but the pinned-languages separator', () => {
    expect(sizedSelectors.some((selector) => /\boption\b/.test(selector))).toBe(true);
    expect(sizedSelectors.filter(canMatchSeparator)).toEqual([]);
  });
});
