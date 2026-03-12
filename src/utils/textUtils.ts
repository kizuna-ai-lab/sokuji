/**
 * Clean translation text from model output.
 * - Unwraps JSON-formatted text like {"final_text":"..."}
 * - Trims leading/trailing whitespace (models sometimes prepend \r\n)
 */
export function unwrapTranslationText(text: string): string {
  if (!text) return text;

  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return trimmed;

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) {
      for (const key of ['final_text', 'final', 'text', 'translation', 'result', 'query']) {
        if (typeof parsed[key] === 'string') {
          return parsed[key].trim();
        }
      }
    }
  } catch {
    // Not JSON, return as-is
  }
  return trimmed;
}
