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

// When the voice cannot stay beside a newly chosen text side, speech follows it and the speech card says so.
describe('the note that speech followed a line-up choice', () => {
  it.each(codes)('%s: names the new voice and the one that could not stay, once each', (code) => {
    const text = lineUpIn(code).voiceFollowed;
    expect(typeof text).toBe('string');
    expect((text as string).match(/\{\{[^}]+\}\}/g)?.sort()).toEqual(['{{previous}}', '{{provider}}']);
  });
  it.each(codes.filter((code) => code !== 'en'))('%s: is translated', (code) => {
    expect(lineUpIn(code).voiceFollowed).not.toBe(lineUpIn('en').voiceFollowed);
  });
});
