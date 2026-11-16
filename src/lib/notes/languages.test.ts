// The language names the backend puts in its notes prompts (`languages.json`, copied to the backend as
// `src/notes/languages.json`): a notes call names its language by code, and the server names it from this table.
// Every code the app can send must be in it, under the name the app's own prompts use, or the relay refuses the call
// or writes in another language. A provider, an interface language or a CLDR update that changes a name turns this red:
// regenerate the table and copy it to the backend.
import { describe, it, expect } from 'vitest';
import { PROVIDERS } from '../../providers/registry';
import { INTERFACE_LANGUAGES } from '../../components/Settings/sections/interfaceLanguages';
import { parseCode } from '../language/code';
import { englishLanguageName, uiLocale } from '../language/label';
import table from './languages.json';

/** Every single-language code a notes call can carry: the providers' widest offers and the interface languages. */
function appCodes(): string[] {
  const codes = new Set<string>(['en']);
  for (const p of PROVIDERS) {
    const s = p.settings.defaults as never;
    for (const source of p.languages.sources(s)) {
      codes.add(source.value);
      for (const target of p.languages.targets(source.value, s)) codes.add(target.value);
    }
  }
  for (const l of INTERFACE_LANGUAGES) codes.add(uiLocale(l.value));
  return [...codes].filter((c) => parseCode(c)?.kind === 'tag').sort();
}

describe('the notes language table', () => {
  it('names every code the app can send as the app names it in English', () => {
    const names = table as Record<string, string>;
    const wrong = appCodes().filter((code) => names[code] !== englishLanguageName(code)).map((code) => `${code}: ${names[code]} ≠ ${englishLanguageName(code)}`);
    expect(wrong).toEqual([]);
  });

  it('holds plain names only: no prompt text can come in through a language', () => {
    for (const [code, name] of Object.entries(table as Record<string, string>)) {
      expect(parseCode(code)?.kind, code).toBe('tag');
      expect(name, code).toMatch(/^[\p{L}\p{M} ()'.,-]{2,60}$/u);
    }
  });
});
