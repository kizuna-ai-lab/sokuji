// Owner, 2026-11-18: in an open language list the line between the pinned languages and the rest is a thin rule
// (Settings.scss), not a row. The settings page sizes its dropdowns' options as 30px rows with a selector just as
// specific and loaded later, so that sizing must leave the separator out, or it turns into a lit-up empty row.
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

const css = compile(resolve(__dirname, 'SettingsPage.scss'), { silenceDeprecations: ['import', 'global-builtin'] }).css;

/** `text` split at each `separator` that is outside brackets and parentheses (a selector's own nesting). */
const splitTopLevel = (text: string, separator: RegExp): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && separator.test(c)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
};

/**
 * Whether a selector can match the separator: its subject (the last compound, the element the rule styles) is an
 * option or names no element, carries no class or id of its own (the separator has neither; one inside `:not(…)` or
 * `:is(…)` does not count), and does not leave the separator out with `:not([value='__pin-separator__'])`.
 * `[value='__pin-separator__']` on its own matches it.
 */
const canMatchSeparator = (selector: string): boolean => {
  const subject = splitTopLevel(selector, /[\s>+~]/).pop() ?? '';
  const type = /^[a-z*]+/i.exec(subject)?.[0];
  if (type && type !== 'option' && type !== '*') return false;
  const own = subject.replace(/\[[^\]]*\]/g, '').replace(/\([^()]*\)/g, '');
  if (/[.#]/.test(own)) return false;
  return !/:not\(\[value=["']?__pin-separator__["']?\]\)/.test(subject);
};

/** The rules that give an element the 30px row height, as their selectors' comma-separated parts. */
const sizedSelectors = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => /min-height:\s*30px/.test(m[2]))
  .flatMap((m) => splitTopLevel(m[1], /,/));

describe("the settings page's dropdown options", () => {
  it('tells a rule that can size the separator from one that cannot', () => {
    expect(canMatchSeparator(".settings-page .language-select option:not([value='__pin-separator__'])")).toBe(false);
    expect(canMatchSeparator(".settings-page .language-select option:not([value='__pin-separator__']):checked")).toBe(false);
    expect(canMatchSeparator('.settings-page .language-select')).toBe(false);
    expect(canMatchSeparator(".settings-page .language-select option:not([value='__pin-separator__']) + option")).toBe(true);
    expect(canMatchSeparator('.settings-page .language-select option')).toBe(true);
    expect(canMatchSeparator(".settings-page .language-select [value='__pin-separator__']")).toBe(true);
    expect(canMatchSeparator('.settings-page .language-select option:not(.pinned)')).toBe(true);
    expect(canMatchSeparator(".settings-page .language-select option[value~='x']")).toBe(true);
    expect(splitTopLevel('.a option:is(.b, .c), .d', /,/)).toEqual(['.a option:is(.b, .c)', '.d']);
  });

  it('are sized as rows, all but the pinned-languages separator', () => {
    expect(sizedSelectors.some((selector) => /\boption\b/.test(selector))).toBe(true);
    expect(sizedSelectors.filter(canMatchSeparator)).toEqual([]);
  });
});
