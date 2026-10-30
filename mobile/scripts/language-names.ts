/**
 * Writes src/i18n/languageNames.json: every Soniox language named in every
 * interface language the app ships, sorted for that language. JSON, not
 * TypeScript, so the desktop's test that keeps it equal to SONIOX_LANGUAGES
 * (src/providers/soniox/languages.mobile.test.ts) can read it without this
 * project's TypeScript setup, which the desktop's CI does not install;
 * src/i18n/languageNames.ts gives it its types.
 *
 * Hermes has no Intl.DisplayNames (checked on iOS and Android, 2026-10-28), so
 * the names the desktop computes from CLDR at run time are computed here, with
 * Node's full ICU and the desktop's own `languageLabel`, and shipped as data.
 * Rerun after SONIOX_LANGUAGES or the catalogs change:
 *
 *   npx tsx scripts/language-names.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { languageLabel, uiLocale } from '@shared/lib/language/label';
import { SONIOX_LANGUAGES } from '@shared/providers/soniox/languages';
import { CATALOGS } from '../src/i18n/catalogs';

const codes = SONIOX_LANGUAGES.map((o) => o.value);
const table: Record<string, [string, string][]> = {};
for (const ui of Object.keys(CATALOGS).sort()) {
  const collator = new Intl.Collator(uiLocale(ui));
  table[ui] = codes
    .map((code) => [code, languageLabel(code, ui)] as [string, string])
    .sort((a, b) => collator.compare(a[1], b[1]));
}

// One row per line, as the table reads in a diff.
const body = Object.entries(table)
  .map(([ui, rows]) => `    ${JSON.stringify(ui)}: [\n${rows.map(([c, n]) => `      [${JSON.stringify(c)}, ${JSON.stringify(n)}]`).join(',\n')}\n    ]`)
  .join(',\n');

writeFileSync(
  join(__dirname, '../src/i18n/languageNames.json'),
  `{\n` +
    `  "generatedBy": ${JSON.stringify(`scripts/language-names.ts (Node ${process.version}, ICU ${process.versions.icu}, CLDR ${process.versions.cldr}). Do not edit.`)},\n` +
    `  "codes": ${JSON.stringify(codes)},\n` +
    `  "names": {\n${body}\n  }\n` +
    `}\n`,
);
console.log(`wrote ${Object.keys(table).length} interface languages × ${codes.length} languages`);
