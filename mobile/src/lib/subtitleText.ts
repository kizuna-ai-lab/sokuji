// The subtitle text sizes, shared by the live subtitles and the session reader.

/** Per the subtitle-size setting: the translation is what is read, the source sits above or below it smaller and quieter (design: direction C). */
export const SIZES = {
  small: { source: 13, translation: 18 },
  medium: { source: 15, translation: 22 },
  large: { source: 17, translation: 28 },
} as const;

// How far each line follows the system's text size. The translation grows the
// most; the source and the notices less, so at the largest sizes they do not
// crowd the current translation off the screen (design scope: Subtitles).
export const SOURCE_MAX_SCALE = 1.5;
export const TRANSLATION_MAX_SCALE = 2.5;

// A size set inline replaces the class's font size but not its 24-unit line
// height, which a 28-unit line overlaps: each line carries its own.
export const lineHeight = (fontSize: number) => Math.round(fontSize * 1.35);
