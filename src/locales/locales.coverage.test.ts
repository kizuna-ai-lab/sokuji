// The 30 language packs agree. locales.consistency.test.ts already holds every locale to en's exact key
// set, en's placeholders and no empty string; this adds what it does not check.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import en from './en/translation.json';
import i18n, { loadTranslation } from './index';
import { INTERFACE_LANGUAGES } from '../components/Settings/sections/interfaceLanguages';

const DIR = join(process.cwd(), 'src/locales');
const LANGS = readdirSync(DIR).filter((d) => existsSync(join(DIR, d, 'translation.json'))).sort();

const flatten = (o: unknown, prefix = ''): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatten(v, key));
    else out[key] = v as string;
  }
  return out;
};
const EN = flatten(en);
const catalog = (lang: string) => flatten(JSON.parse(readFileSync(join(DIR, lang, 'translation.json'), 'utf8')));

/** Keys written twice in one object of a JSON file (JSON.parse keeps the last one silently). */
function duplicateKeys(text: string): string[] {
  const dups: string[] = [];
  const stack: Set<string>[] = [];
  let expectKey = false;
  const re = /"((?:[^"\\]|\\.)*)"\s*(:)?|[{}[\],]/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const tok = m[0];
    if (tok === '{') { stack.push(new Set()); expectKey = true; } else if (tok === '}') stack.pop();
    else if (tok === ',') expectKey = true;
    else if (tok === '[' || tok === ']') expectKey = false;
    else if (m[2] === ':' && expectKey) {
      const seen = stack[stack.length - 1];
      if (seen.has(m[1])) dups.push(m[1]);
      seen.add(m[1]);
      expectKey = false;
    }
  }
  return dups;
}

describe('the 30 language packs are all there and all reachable', () => {
  it('there are 30 packs, en among them', () => {
    expect(LANGS).toHaveLength(30);
    expect(LANGS).toContain('en');
  });

  it('the interface language list offers exactly the 30 packs, each once', () => {
    const offered = INTERFACE_LANGUAGES.map((l) => l.value);
    expect(new Set(offered).size).toBe(offered.length);
    expect([...offered].sort()).toEqual(LANGS);
  });

  it('i18next supports exactly the 30 packs', () => {
    const supported = (i18n.options.supportedLngs || []).filter((l) => l !== 'cimode');
    expect([...supported].sort()).toEqual(LANGS);
  });

  it.each(LANGS.filter((l) => l !== 'en'))('%s loads on demand', async (lang) => {
    await loadTranslation(lang);
    expect(i18n.getResource(lang, 'translation', 'settingsPage.categories.history')).toBe(catalog(lang)['settingsPage.categories.history']);
  });
});

describe('no pack writes a key twice', () => {
  it('the duplicate finder finds one', () => {
    expect(duplicateKeys('{"a": {"b": "x", "c": "y", "b": "z"}, "d": ["e"], "c": "w"}')).toEqual(['b']);
  });

  it.each(LANGS)('%s has no key written twice in the same object', (lang) => {
    expect(duplicateKeys(readFileSync(join(DIR, lang, 'translation.json'), 'utf8'))).toEqual([]);
  });
});

describe('plural forms', () => {
  // The catalogs pair `x_one` with a bare `x` that i18next falls back to for every other count (and for the forms a
  // language has beyond one/other, e.g. ru "few"). An `_one` without its bare key would show the raw key for 2.
  it('every "_one" key has its bare key for the other counts, in every pack', () => {
    const offenders: string[] = [];
    for (const lang of LANGS) {
      const cat = catalog(lang);
      for (const key of Object.keys(cat).filter((k) => k.endsWith('_one'))) {
        if (typeof cat[key.slice(0, -4)] !== 'string') offenders.push(`${lang}: ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a plural pair carries {{count}} in both forms, in every pack', () => {
    const offenders: string[] = [];
    for (const lang of LANGS) {
      const cat = catalog(lang);
      for (const key of Object.keys(cat).filter((k) => k.endsWith('_one'))) {
        for (const k of [key, key.slice(0, -4)]) if (!cat[k]?.includes('{{count}}')) offenders.push(`${lang}: ${k}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('counts other than one pick the plural sentence (ru, 3 records)', async () => {
    await loadTranslation('ru');
    const t = i18n.getFixedT('ru');
    expect(t('history.space', { size: '1 MB', count: 3 })).toBe(catalog('ru')['history.space'].replace('{{size}}', '1 MB').replace('{{count}}', '3'));
    expect(t('history.space', { size: '1 MB', count: 1 })).toBe(catalog('ru')['history.space_one'].replace('{{size}}', '1 MB').replace('{{count}}', '1'));
  });
});

describe('the new settings are translated in every pack', () => {
  // The new Settings page, History and notes (since v0.50.4). A sentence left in English is a missed translation in
  // any pack; in a pack that does not write in Latin letters, so is any word left as en has it.
  const NEW = /^(settingsPage|history|liveNotes|notesQuit)\./;
  // Names that stay as they are, and the label of the space bar key (th keeps it as printed on the key).
  const KEPT: Record<string, string[]> = { 'settingsPage.lineup.uses.space': ['th'] };
  const NON_LATIN = ['ar', 'bn', 'fa', 'he', 'hi', 'ja', 'ko', 'ru', 'ta', 'te', 'th', 'uk', 'zh_CN', 'zh_TW'];
  const words = (s: string) => s.replace(/\{\{[^}]+\}\}|\{[^}]+\}|<\/?[a-z]+>/g, '').match(/\p{L}{2,}/gu) ?? [];

  it('the keys checked are many and include History and notes', () => {
    const keys = Object.keys(EN).filter((k) => NEW.test(k));
    expect(keys.length).toBeGreaterThan(300);
    expect(keys).toEqual(expect.arrayContaining(['history.folder', 'history.openFolder', 'history.notesAfterSession', 'history.liveNotes']));
  });

  it.each(LANGS.filter((l) => l !== 'en'))('%s leaves no new sentence in English', (lang) => {
    const cat = catalog(lang);
    const untranslated = Object.keys(EN).filter((k) => NEW.test(k) && cat[k] === EN[k] && words(EN[k]).length >= 3);
    expect(untranslated).toEqual([]);
  });

  it.each(NON_LATIN)('%s leaves no new label in English', (lang) => {
    const cat = catalog(lang);
    const untranslated = Object.keys(EN)
      .filter((k) => NEW.test(k) && cat[k] === EN[k] && words(EN[k]).length > 0 && !KEPT[k]?.includes(lang));
    expect(untranslated).toEqual([]);
  });
});
