/**
 * Split text into sentences for per-sentence TTS generation.
 * Uses Intl.Segmenter for robust multilingual sentence boundary detection
 * (handles abbreviations, version numbers, decimals automatically).
 */

// Map app-internal language codes that are not valid BCP-47 tags to
// equivalents Intl.Segmenter will accept. `cantonese` is this app's own
// target-language code (see utils/languages.ts); `yue` is its ISO 639-3 tag.
const LOCALE_ALIASES: Record<string, string> = {
  cantonese: 'yue',
};

function toBcp47(locale: string): string {
  const lower = locale.toLowerCase();
  if (LOCALE_ALIASES[lower]) return LOCALE_ALIASES[lower];
  // Accept underscore-separated variants like "zh_CN" that some provider
  // configs still use.
  return locale.replace('_', '-');
}

export function splitSentences(text: string, locale = 'en'): string[] {
  if (!text || !text.trim()) return [];

  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(toBcp47(locale), { granularity: 'sentence' });
  } catch {
    // Unknown or structurally invalid tag — fall back to English segmentation
    // rather than crashing the whole TTS pipeline.
    segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  }

  const sentences = Array.from(segmenter.segment(text))
    .map(s => s.segment.trim())
    .filter(s => s.length > 0);

  return sentences.length > 0 ? sentences : [text.trim()];
}
