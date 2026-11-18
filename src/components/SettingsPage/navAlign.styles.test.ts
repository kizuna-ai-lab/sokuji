// The settings and History navs line up with Back and the search box (owner, 2026-11-19, #122), keeping their levels:
// a group heading starts where the Back arrow and the search glass do (the nav's 12px padding plus 12px, measured in
// the built app), its items one step (12px) further in; History's items, under no heading, and its footer start on the
// line itself. An item's highlight keeps the search box's left edge.
import { describe, expect, it } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

const page = compile(resolve(__dirname, 'SettingsPage.scss')).css;
const history = compile(resolve(__dirname, '../History/History.scss')).css;

/** The declarations of every plain rule whose selector list includes exactly `selector`. */
function rule(sheet: string, selector: string): string {
  const flat = sheet.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '');
  return [...flat.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].split(',').some((s) => s.trim() === selector)).map((m) => m[2]).join(';');
}

describe('the settings and History navs line up', () => {
  it('the nav keeps its 12px padding, the edge the search box and an item\'s highlight start at', () => {
    expect(rule(page, '.settings-page__nav')).toMatch(/padding:\s*12px/);
  });

  it('a group heading starts on the Back arrow\'s line', () => {
    expect(rule(page, '.settings-page__group h3')).toMatch(/padding-inline:\s*12px/);
  });

  it('a group\'s items start one step further in, their highlight still at the search box\'s edge', () => {
    expect(rule(page, '.settings-page__item')).toMatch(/padding:\s*6px 12px 6px 24px/);
  });

  it('History\'s items, under no heading, start on the Back arrow\'s line', () => {
    expect(rule(history, '.settings-page__item.history-nav__item')).toMatch(/padding-inline-start:\s*12px/);
  });

  it('History\'s footer (its records and space) starts on the same line', () => {
    expect(rule(history, '.history-nav__space')).toMatch(/padding:\s*8px 12px/);
  });
});
