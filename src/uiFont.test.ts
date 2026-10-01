import { describe, expect, it } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// #559: the UI font. Asserted on the compiled CSS, never the SCSS source.
const css = compile(resolve(__dirname, 'index.scss')).css;
const app = compile(resolve(__dirname, 'App.scss')).css;

function rule(sheet: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = sheet.match(new RegExp(String.raw`(?:^|\n)${esc}\s*\{([^}]*)\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

const firstCjk = (body: string) => body.match(/--font-cjk:\s*'([^']+)'/)?.[1];

describe('UI font', () => {
  it('reaches a CJK sans font after sans-serif, before any system fallback', () => {
    expect(rule(css, ':root')).toMatch(/--font-sans:[^;]*\bsans-serif,\s*var\(--font-cjk\)\s*;/);
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
    expect(firstCjk(rule(css, selector))).toBe(font);
  });

  it('no CJK list falls back to a serif', () => {
    expect(css).not.toMatch(/SimSun|MingLiU|MS Mincho|Batang/i);
  });
});
