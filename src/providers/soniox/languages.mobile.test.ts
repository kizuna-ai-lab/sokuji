// The mobile app names Soniox's languages from a table generated ahead of time
// (Hermes has no Intl.DisplayNames). The mobile project cannot import this
// module itself: its types reach desktop-only modules. So the two lists are
// kept equal here. Regenerate with `npx tsx scripts/language-names.ts` (from
// mobile/) when this fails. The table is read as JSON: a TypeScript file under
// mobile/ takes mobile/tsconfig.json, which extends Expo's, and this CI does not
// install mobile/'s dependencies.
import { describe, expect, it } from 'vitest';
import { SONIOX_LANGUAGES } from './languages';
import table from '../../../mobile/src/i18n/languageNames.json';

describe("the mobile app's language names", () => {
  it('cover exactly the languages Soniox is offered for', () => {
    const soniox = SONIOX_LANGUAGES.map((o) => o.value).sort();
    expect([...table.codes].sort()).toEqual(soniox);
    for (const [ui, rows] of Object.entries(table.names)) {
      expect(rows.map(([code]) => code).sort(), ui).toEqual(soniox);
    }
  });
});
