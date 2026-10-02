/**
 * The shape of `voices.json` (#577 catalog spec §1.2), shared by the script
 * that writes it (`scripts/doubao-voices/build.ts`) and the module that reads
 * it (`catalog.ts`). Kept free of the JSON import so the script can use it.
 */

/** The targets a fixed voice speaks in AST 2.0, in the S2S list's order then Korean (spec §1.1 rule 3). */
export const FIXED_LANGUAGES = ['zh', 'en', 'ja', 'id', 'es', 'pt', 'de', 'fr', 'ko'] as const;
export type FixedLanguage = (typeof FIXED_LANGUAGES)[number];

/** ListSpeakers' 儿童 / 少年/少女 / 青年 / 中年 / 老年; the last three are the voice library's existing values. */
export type Age = 'child' | 'teen' | 'young' | 'middle_aged' | 'old';

/**
 * One language of a voice: its persona name, age and sample clip path under
 * `Catalog.prefix`, its one-line description (Volcengine's, in Chinese) and
 * the categories that tell it from the list's other voices; the last two are
 * left out when empty. `{}` reads as the voice's first language.
 */
export interface CatalogLanguage {
  n?: string;
  a?: Age;
  p?: string;
  d?: string;
  c?: string[];
}

export interface CatalogVoice {
  /** The `speaker_id`. */
  id: string;
  /** The `tts_resource_id`: 1 → seed-tts-1.0, 2 → seed-tts-2.0. */
  r: 1 | 2;
  g: 'male' | 'female';
  /** Keyed by app language code, in the order ListSpeakers listed them. */
  l: Record<string, CatalogLanguage>;
}

export interface Catalog {
  v: 1;
  /** The day the ListSpeakers dump was taken. */
  fetched: string;
  prefix: string;
  voices: CatalogVoice[];
}
