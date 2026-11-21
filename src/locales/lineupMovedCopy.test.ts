// A choice on the line-up page no longer moves the other stages to make the line-up run, so the line that said
// "… moved to … too" is gone: from all 30 interface languages and from the page.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES = join(__dirname);
const codes = readdirSync(LOCALES).filter((name) => statSync(join(LOCALES, name)).isDirectory()).sort();
const lineUpIn = (code: string): Record<string, unknown> => JSON.parse(readFileSync(join(LOCALES, code, 'translation.json'), 'utf8')).settingsPage.lineup;

describe('the note that another stage moved with a line-up choice', () => {
  it('is checked in every interface language', () => {
    expect(codes).toHaveLength(30);
  });
  it.each(codes)('%s: is gone', (code) => {
    expect(lineUpIn(code)).not.toHaveProperty('moved');
  });
  it('is gone from the page', () => {
    const page = readFileSync(join(LOCALES, '..', 'components', 'SettingsPage', 'LineUpCategory.tsx'), 'utf8');
    expect(page).not.toContain('settingsPage.lineup.moved');
    expect(page).not.toContain('lineup-stage__moved');
  });
});
