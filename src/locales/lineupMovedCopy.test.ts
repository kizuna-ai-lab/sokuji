// The line under a line-up card whose choice moved another stage with it says, in all 30 interface languages, that
// the two cannot be combined yet and that mixing will be supported later (owner, 2026-11-17: say it will be supported).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES = join(__dirname);
const codes = readdirSync(LOCALES).filter((name) => statSync(join(LOCALES, name)).isDirectory()).sort();
const movedIn = (code: string): string => JSON.parse(readFileSync(join(LOCALES, code, 'translation.json'), 'utf8')).settingsPage.lineup.moved;

// One row per language: the words that say "will be supported later".
const SUPPORTED_LATER: Record<string, string> = {
  ar: 'سيُدعم المزج لاحقًا', bn: 'পরে যোগ করা হবে', de: 'wird später unterstützt', en: 'will be supported later',
  es: 'se admitirá más adelante', fa: 'بعداً پشتیبانی می‌شود', fi: 'tuetaan myöhemmin', fil: 'Susuportahan',
  fr: 'sera pris en charge plus tard', he: 'ייתמך בהמשך', hi: 'बाद में दी जाएगी', id: 'akan didukung nanti',
  it: 'sarà supportato più avanti', ja: '今後対応します', ko: '나중에 지원할 예정입니다', ms: 'akan disokong kemudian',
  nl: 'wordt later ondersteund', pl: 'będzie obsługiwane później', pt_BR: 'será suportada mais adiante',
  pt_PT: 'passará a ser possível mais tarde', ru: 'будет поддерживаться позже', sv: 'kommer att stödjas senare',
  ta: 'பின்னர் ஆதரிக்கப்படும்', te: 'తర్వాత మద్దతు వస్తుంది', th: 'จะรองรับการผสมในภายหลัง', tr: 'daha sonra desteklenecek',
  uk: 'підтримуватиметься пізніше', vi: 'sẽ được hỗ trợ sau', zh_CN: '以后会支持', zh_TW: '以後會支援',
};

describe('the note that another stage moved with a line-up choice', () => {
  it('covers every interface language', () => {
    expect(Object.keys(SUPPORTED_LATER).sort()).toEqual(codes);
  });
  it.each(codes)('%s: names the stages and the service, and says mixing will be supported later', (code) => {
    const text = movedIn(code);
    expect(text).toContain('{{stages}}');
    expect(text).toContain('{{providers}}');
    expect(text).toContain(SUPPORTED_LATER[code]);
  });
  it('reads in English as the default the page falls back to', () => {
    expect(movedIn('en')).toBe('{{stages}} moved to {{providers}} too: they cannot be combined with this choice yet. Mixing will be supported later.');
    expect(readFileSync(join(LOCALES, '..', 'components', 'SettingsPage', 'LineUpCategory.tsx'), 'utf8')).toContain(`'${movedIn('en')}'`);
  });
});
