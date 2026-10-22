import { describe, expect, it } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// #559: the UI font. Asserted on the compiled CSS, never the SCSS source.
const css = compile(resolve(__dirname, 'index.scss')).css;
const app = compile(resolve(__dirname, 'App.scss')).css;

// `marker`: the theme's token block is also a `:root` rule, emitted first
// (src/styles/theme.scss), so the font rule is the `:root` whose body holds it.
function rule(sheet: string, selector: string, marker = ''): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of sheet.matchAll(new RegExp(String.raw`(?:^|\n)${esc}\s*\{([^}]*)\}`, 'g'))) {
    if (m[1].includes(marker)) return m[1];
  }
  throw new Error(`no rule for ${selector}`);
}

const firstCjk = (body: string) => body.match(/--font-cjk:\s*'([^']+)'/)?.[1];

describe('UI font', () => {
  it('reaches a CJK sans font after sans-serif, before any system fallback', () => {
    expect(rule(css, ':root', '--font-sans')).toMatch(/--font-sans:[^;]*\bsans-serif,\s*var\(--font-cjk\)\s*;/);
  });

  it('the page, the app root and form controls all draw in it', () => {
    expect(rule(css, 'body')).toMatch(/font-family:\s*var\(--font-sans\)/);
    expect(rule(app, '.App')).toMatch(/font-family:\s*var\(--font-sans/);
    expect(rule(css, 'button,\ninput,\nselect,\ntextarea')).toMatch(/font-family:\s*inherit/);
  });

  // The first font holding a Han character decides its shape.
  it.each([
    [':root', 'Microsoft YaHei UI'],
    [':root:lang(zh-TW)', 'Microsoft JhengHei UI'],
    [':root:lang(ja)', 'Yu Gothic UI'],
    [':root:lang(ko)', 'Malgun Gothic'],
  ])('%s puts %s first', (selector, font) => {
    expect(firstCjk(rule(css, selector, '--font-cjk'))).toBe(font);
  });

  it('no CJK list falls back to a serif', () => {
    expect(css).not.toMatch(/SimSun|MingLiU|MS Mincho|Batang/i);
  });
});
