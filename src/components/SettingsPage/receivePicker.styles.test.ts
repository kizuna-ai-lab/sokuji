// The sentence's hear-or-read words open the app's own list, as every other select does, not the system's (owner,
// 2026-11-19, #124): where the browser draws customizable selects, the word takes them, keeps its own small chevron
// (the picker's icon is left out), and its list and options take the shared picker look.
import { describe, expect, it } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

const page = compile(resolve(__dirname, 'SettingsPage.scss')).css;
const settings = compile(resolve(__dirname, '../Settings/Settings.scss')).css;

/** The body of the `@supports (appearance: base-select)` blocks, joined. */
const supported = (sheet: string) =>
  [...sheet.matchAll(/@supports \(appearance: base-select\)\s*\{((?:[^{}]*\{[^}]*\})*)\s*\}/g)].map((m) => m[1]).join('\n');
/** The declarations of every rule in `scope` whose selector list includes exactly `selector`. */
const rule = (scope: string, selector: string) =>
  [...scope.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].split(',').some((s) => s.trim() === selector)).map((m) => m[2]).join(';');

describe('the hear-or-read word\'s list', () => {
  it('is the customizable select, on the word itself, which keeps its own chevron', () => {
    const own = supported(page);
    expect(rule(own, '.lineup-category .language-receive')).toMatch(/appearance:\s*base-select/);
    expect(rule(own, '.lineup-category .language-receive::picker(select)')).toMatch(/appearance:\s*base-select/);
    expect(rule(own, '.lineup-category .language-receive::picker-icon')).toMatch(/display:\s*none/);
  });

  it('takes the shared picker and option look, as the language and provider selects do', () => {
    const shared = supported(settings);
    expect(rule(shared, '.language-receive::picker(select)')).toMatch(/border-radius:/);
    expect(rule(shared, '.language-receive::picker(select)')).toMatch(/box-shadow:/);
    expect(rule(shared, '.language-receive option')).toMatch(/padding:\s*8px 10px/);
    expect(rule(shared, '.language-receive option:disabled')).toMatch(/cursor:\s*not-allowed/);
  });
});

describe('the hear-or-read word\'s sentence', () => {
  // Owner, 2026-11-19: only the verb is the choice; the subject is text beside it, its space kept ("they hear").
  it('keeps the spaces either side of the choice', () => {
    expect(rule(page, '.lineup-category .language-receive-label')).toMatch(/white-space:\s*pre/);
  });
});

describe('the hear-or-read word as a label', () => {
  // Owner, 2026-11-19: the subject lost the label look once the verb alone became the choice; the whole word is one
  // label, in its neighbours' size and colour (12px, the tertiary text), only the verb marked as the choice.
  it('is set in the labels\' size and colour, the verb taking them from it', () => {
    const label = rule(page, '.lineup-category .language-receive-label');
    expect(label).toMatch(/font-size:\s*12px/);
    expect(label).toMatch(/color:\s*var\(--sk-text-tertiary\)/);
    expect(rule(page, '.lineup-category .language-pair-row .language-select-group label')).toMatch(/font-size:\s*12px;\s*color:\s*var\(--sk-text-tertiary\)/);
    const verb = rule(page, '.lineup-category .language-receive');
    expect(verb).toMatch(/color:\s*inherit/);
    expect(verb).toMatch(/font:\s*inherit/);
    expect(verb).not.toMatch(/font-size:/);
  });
});
