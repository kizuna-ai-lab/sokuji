// Each interface language's names for the Soniox languages, in its alphabetical
// order: the table scripts/language-names.ts generates into languageNames.json
// (rerun it, never edit the JSON). JSON so the desktop's test that keeps
// LANGUAGE_CODES equal to SONIOX_LANGUAGES (src/providers/soniox/languages.mobile.test.ts)
// reads it without this project's TypeScript setup; here it gets its types.
import table from './languageNames.json';

export const LANGUAGE_CODES: readonly string[] = table.codes;

// JSON types a row as string[]; each is a [code, name] pair (languages.test.ts checks every row).
export const LANGUAGE_NAMES: Readonly<Record<string, readonly (readonly [code: string, name: string])[]>> = Object.fromEntries(
  Object.entries(table.names).map(([ui, rows]) => [ui, rows.map(([code, name]) => [code, name] as const)]),
);
