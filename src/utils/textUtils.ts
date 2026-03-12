/**
 * Unwrap JSON-formatted translation text.
 * Models sometimes wrap translations in JSON like {"final_text":"..."}
 * This extracts the plain text value.
 */
export function unwrapTranslationText(text: string): string {
  if (!text || !text.startsWith('{')) return text;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      for (const key of ['final_text', 'final', 'text', 'translation', 'result', 'query']) {
        if (typeof parsed[key] === 'string') {
          return parsed[key];
        }
      }
    }
  } catch {
    // Not JSON, return as-is
  }
  return text;
}
