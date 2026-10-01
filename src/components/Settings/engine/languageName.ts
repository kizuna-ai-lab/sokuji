import i18next from 'i18next';
import { languageLabel } from '../../../lib/language/label';

/**
 * A code's name in the UI language (unified language codes): the CLDR name
 * `languageLabel` gives every surface. Reads the i18next instance's language
 * without importing `src/locales`, whose singleton breaks the suites that
 * mock `react-i18next` (ModelManagementSection.test.tsx).
 */
export function languageNameFor(code: string): string {
  return languageLabel(code, i18next.language);
}
