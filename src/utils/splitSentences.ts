/**
 * Split text into sentences for per-sentence TTS generation.
 * Handles multilingual punctuation (Latin, CJK).
 * Keeps punctuation attached to the preceding sentence.
 */
export function splitSentences(text: string): string[] {
  if (!text || !text.trim()) return [];

  // Split after sentence-ending punctuation (keeping it attached)
  const segments = text
    .split(/(?<=[.!?。！？；])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return segments.length > 0 ? segments : [text.trim()];
}
