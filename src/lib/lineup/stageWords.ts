// src/lib/lineup/stageWords.ts
/**
 * A stage's name inside a sentence ("Goes with translation…"): lower-cased in the reader's language, except where
 * that language writes it capitalised (German nouns).
 */
export function stageInSentence(name: string, language: string): string {
  const tag = language.replace('_', '-');
  return tag.toLowerCase().startsWith('de') ? name : name.toLocaleLowerCase(tag);
}
