import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
const dir = join(import.meta.dirname, '..', 'src', 'locales');
const en = JSON.parse(readFileSync(join(dir, 'en/translation.json'), 'utf8'));
const enKeys = Object.keys(en.settings);
const langs = readdirSync(dir).filter(d => d !== 'index.ts' && d !== 'en');
let total = 0;
for (const lang of langs) {
  const data = JSON.parse(readFileSync(join(dir, lang, 'translation.json'), 'utf8'));
  const missing = enKeys.filter(k => !(k in (data.settings || {})));
  if (missing.length > 0) { console.log(`${lang}: missing ${missing.join(', ')}`); total += missing.length; }
}
if (total === 0) console.log('All settings keys present in all languages!');
