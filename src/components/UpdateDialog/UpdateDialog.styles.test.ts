// The update dialog's release notes and its Linux note keep to the app's sizes (owner, 2026-11-19): a note's section
// heading ("## Fixes") came out at the browser's 18px over 12px items, and the .deb note at 0.9em of the page's 16px.
import { describe, expect, it } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

const css = compile(resolve(__dirname, 'UpdateDialog.scss')).css;
const rule = (selector: string) =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].split(',').some((s) => s.trim() === selector)).map((m) => m[2]).join(';');
const notes = '.update-dialog .update-dialog-body .changelog';

describe('the update dialog', () => {
  it('sets a release note’s own headings in the notes’ size, under the version heading', () => {
    for (const h of ['h1', 'h2', 'h4']) expect(rule(`${notes} ${h}`)).toMatch(/font-size:\s*inherit/);
    expect(rule(`${notes} h3`)).toMatch(/font-size:\s*13px/);
  });

  it('sets the Linux auto-update note in the caption size', () => {
    expect(rule('.update-dialog .update-dialog-body .auto-update-note')).toMatch(/font-size:\s*12px/);
  });
});
