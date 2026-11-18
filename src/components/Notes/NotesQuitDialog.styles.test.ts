// The quit question while notes are written is set in the app's body size (owner and design review, 2026-11-19):
// it inherited the page's 16px, a size larger than its buttons and everything around it.
import { describe, expect, it } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

const css = compile(resolve(__dirname, 'NotesQuitDialog.scss')).css;
const rule = (selector: string) =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].split(',').some((s) => s.trim() === selector)).map((m) => m[2]).join(';');

describe('the notes quit question', () => {
  it('is set in the body size, its text on a 20px line', () => {
    expect(rule('.notes-quit__box')).toMatch(/font-size:\s*13px/);
    expect(rule('.notes-quit__box p')).toMatch(/line-height:\s*20px/);
  });

  it('sets its buttons in the same type, keeping their 28px height', () => {
    const button = rule('.notes-quit__button');
    expect(button).toMatch(/font:\s*inherit/);
    expect(button).toMatch(/height:\s*28px/);
  });
});
