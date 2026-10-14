/** A language Sokuji shows readings for (spec 2026-10-15 §1). */
export type ReadingLanguage = 'zh' | 'ja' | 'ko' | 'ru' | 'uk';

/** How a reading is written. */
export type ReadingScheme = 'pinyin' | 'kana' | 'rr' | 'latin';

/** A run of text and, when it has one, its reading. A row's pieces concatenate to its text exactly. */
export interface RubyPiece {
  text: string;
  reading?: string;
}

export const READING_SCHEME: Record<ReadingLanguage, ReadingScheme> = {
  zh: 'pinyin',
  ja: 'kana',
  ko: 'rr',
  ru: 'latin',
  uk: 'latin',
};
