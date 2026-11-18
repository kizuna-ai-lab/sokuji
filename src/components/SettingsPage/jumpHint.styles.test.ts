// Where a link into the settings landed (SettingsPage adds `.highlight` to its target for a while): one quiet locator
// for every target (owner and design review, 2026-11-19, #121). The theme's green, never the info blue; a faint tint and
// a 1px line on one layer with one 6px corner, 6px clear of the content, under it so no click or focus ring is covered;
// in quickly, three blinks, held, then out, once, with no glow or thick outline; under reduced motion, shown still.
import { describe, expect, it } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

const css = (file: string) => compile(resolve(__dirname, '..', file)).css;
const settings = css('Settings/Settings.scss');
const page = css('SettingsPage/SettingsPage.scss');
const engine = css('Settings/engine/Engine.scss');
const all = settings + page + engine;

/** The sheet without its @media and @keyframes blocks: its plain rules. */
const plain = (sheet: string) => sheet.replace(/@(media|keyframes)[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '');
/** The bodies of the sheet's `@media <query>` blocks, joined. */
const inMedia = (sheet: string, query: string) =>
  [...sheet.matchAll(/@media ([^{]*)\{((?:[^{}]*\{[^}]*\})*)\s*\}/g)].filter((m) => m[1].trim() === query).map((m) => m[2]).join('\n');
/** The declarations of the first rule in `scope` whose selector list includes exactly `selector`. */
function rule(scope: string, selector: string): string {
  for (const m of scope.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1].split(',').some((s) => s.trim() === selector)) return m[2];
  }
  return '';
}

// [selector, compiled sheet]: the selector first, so a test's name says which.
const TARGETS: [string, string][] = [
  ['.config-section.highlight', settings],
  ['.settings-section.highlight', settings],
  ['.turn-detection-tuning-block.highlight', settings],
  ['.engine-slot.highlight', engine],
  ['.models-stage.highlight', page],
  ['.settings-page .setting-row.highlight', page],
  ['.settings-page .accounts-row.highlight', page],
];

describe('the settings page\'s jump locator', () => {
  it.each(TARGETS)('%#: %s draws it on one layer under its content', (selector, sheet) => {
    expect(rule(plain(sheet), selector)).toMatch(/isolation:\s*isolate/);
    const layer = rule(plain(sheet), `${selector}::after`);
    expect(layer).toMatch(/inset:\s*-6px/);
    expect(layer).toMatch(/z-index:\s*-1/);
    expect(layer).toMatch(/border:\s*1px solid color-mix\(in srgb, var\(--sk-primary\) 40%, transparent\)/);
    expect(layer).toMatch(/border-radius:\s*6px/);
    expect(layer).toMatch(/background:\s*color-mix\(in srgb, var\(--sk-primary\) 8%, transparent\)/);
    expect(layer).toMatch(/pointer-events:\s*none/);
    expect(layer).toMatch(/animation:\s*jump-hint \d+ms ease-out/);
  });

  // Owner, 2026-11-19: it blinks to catch the eye; the rhythm from the design review: in over 120ms, then bright → dim
  // → bright three times, half a second each, dimmed to 30% (never gone), held 350ms, out over 500ms: 2470ms in all.
  it.each([['Settings.scss', settings], ['SettingsPage.scss', page], ['Engine.scss', engine]])('blinks three times, then holds and fades, once, in %s', (_name, sheet) => {
    const frames = sheet.match(/@keyframes jump-hint\s*\{((?:[^{}]*\{[^}]*\})*)\s*\}/)?.[1] ?? '';
    const points = [...frames.matchAll(/([\d.]+)%\s*\{\s*opacity:\s*([\d.]+);?\s*\}/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(points).toEqual([
      [0, 0], [4.86, 1],
      [14.98, 0.3], [25.1, 1],
      [35.22, 0.3], [45.34, 1],
      [55.47, 0.3], [65.59, 1],
      [79.76, 1], [100, 0],
    ]);
    expect(sheet).toMatch(/animation:\s*jump-hint 2470ms ease-out/);
  });

  it('leaves no info blue glow and none of the old pulse', () => {
    expect(all).not.toMatch(/pulse-highlight/);
    expect(all).not.toMatch(/@keyframes [a-z-]*highlight/);
  });

  it.each(TARGETS)('%#: %s under reduced motion is shown still, for as long as the target is marked', (selector, sheet) => {
    const still = rule(inMedia(sheet, '(prefers-reduced-motion: reduce)'), `${selector}::after`);
    expect(still).toMatch(/animation:\s*none/);
    expect(still).toMatch(/opacity:\s*1/);
  });
});
