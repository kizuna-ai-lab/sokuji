// The mobile app names Soniox's languages from a table generated ahead of time
// (Hermes has no Intl.DisplayNames). The mobile project cannot import this
// module itself: its types reach desktop-only modules. So the two lists are
// kept equal here. Regenerate with `npx tsx mobile/scripts/language-names.ts`
// (from mobile/) when this fails.
import { describe, expect, it } from 'vitest';
import { SONIOX_LANGUAGES } from './languages';
import { LANGUAGE_CODES, LANGUAGE_NAMES } from '../../../mobile/src/i18n/languageNames';

describe("the mobile app's language names", () => {
  it('cover exactly the languages Soniox is offered for', () => {
    const soniox = SONIOX_LANGUAGES.map((o) => o.value).sort();
    expect([...LANGUAGE_CODES].sort()).toEqual(soniox);
    for (const [ui, rows] of Object.entries(LANGUAGE_NAMES)) {
      expect(rows.map(([code]) => code).sort(), ui).toEqual(soniox);
    }
  });
});
