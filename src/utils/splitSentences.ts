/**
 * Split text into sentences for per-sentence TTS generation.
 * Uses Intl.Segmenter for robust multilingual sentence boundary detection
 * (handles abbreviations, version numbers, decimals automatically).
 */
export function splitSentences(text: string, locale = 'en'): string[] {
  if (!text || !text.trim()) return [];

  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  const sentences = Array.from(segmenter.segment(text))
    .map(s => s.segment.trim())
    .filter(s => s.length > 0);

  return sentences.length > 0 ? sentences : [text.trim()];
}
