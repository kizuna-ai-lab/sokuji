// src/components/providers/receiveWords.ts
//
// The line-up sentence's hear-or-read words: only the verb is the choice (owner, 2026-11-19), set in its sentence as
// the language orders it (LanguagePairSection).

/** Where a sentence template's `{{verb}}` goes, once `t` has put this mark there. */
export const VERB_MARK = '\u0001';

/**
 * The text before and after the verb in a word's sentence, as `t` gives it with `VERB_MARK` for `{{verb}}`: "they "
 * and "" for "they {{verb}}", "相手が" and "言語" for "相手が{{verb}}言語", nothing either side where the verb carries its
 * subject (Arabic's "{{verb}}"). A sentence with no verb in it is a translation that lost its placeholder: it is left
 * out rather than shown beside a verb it does not hold.
 */
export function aroundVerb(sentence: string): [string, string] {
  const at = sentence.indexOf(VERB_MARK);
  return at < 0 ? ['', ''] : [sentence.slice(0, at), sentence.slice(at + VERB_MARK.length)];
}
