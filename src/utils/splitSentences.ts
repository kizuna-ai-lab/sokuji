/**
 * Split text into sentences for per-sentence TTS generation.
 * Uses Intl.Segmenter for robust multilingual sentence boundary detection
 * (handles abbreviations, version numbers, decimals automatically).
 */

// App codes are BCP-47; an underscore form is still accepted from callers
// outside the app vocabulary.
function toBcp47(locale: string): string {
  return locale.replace(/_/g, '-');
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
