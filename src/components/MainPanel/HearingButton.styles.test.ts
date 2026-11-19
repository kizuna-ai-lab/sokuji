// The audio-settings link under the hearing popover's rows is set in the popover's own size (owner, 2026-11-19): as a
// button it took the browser's 13.33px for controls, a size larger than the 12px text beside it.
import { describe, expect, it } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

const css = compile(resolve(__dirname, 'HearingButton.scss')).css;
const rule = (selector: string) =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].split(',').some((s) => s.trim() === selector)).map((m) => m[2]).join(';');

describe('the hearing popover', () => {
  it('sets its audio-settings link in the popover’s type', () => {
    expect(rule('.hearing-popover')).toMatch(/font-size:\s*12px/);
    expect(rule('.hearing-popover__link')).toMatch(/font:\s*inherit/);
  });
});
