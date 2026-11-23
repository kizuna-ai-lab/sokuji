// src/lib/textModel/prompt.ts
//
// What a text model is told to translate a session (spec §4): one system prompt for the session, with the two
// languages by their English names, the rule to answer with the translation alone, and the session's word list and
// background; then the session's last few stretches with their translations as earlier turns; then the stretch to
// translate. The user's instructions of the end-to-end providers are not used: they are written for a live
// interpreter that speaks.

import type { SessionContext } from '../contract/adapter';
import { englishLanguageName } from '../language/label';
import type { SessionWords } from '../run/types';
import type { JobContext } from '../translation/jobTranslator';
import { wordsFor } from '../words/forService';
import type { ChatMessage } from './client';

/** The word-list service a text model reads (`WORD_LIMITS`). */
export const TEXT_MODEL_WORDS = 'text_model';

/** The word list and the session background, as the last lines of the system prompt; empty without them. */
function wordsNote(words: SessionWords | undefined): string {
  const w = wordsFor(TEXT_MODEL_WORDS, words?.entries ?? [], words?.background ?? '');
  const given = new Map(w.translations ?? []);
  const terms = (w.terms ?? []).filter((term) => !given.has(term));
  return [
    w.background ? `About this conversation: ${w.background}` : '',
    terms.length > 0 ? `Keep these names and terms as written: ${terms.join(', ')}.` : '',
    given.size > 0 ? `Translate these as given: ${[...given].map(([from, to]) => `${from} → ${to}`).join('; ')}.` : '',
  ].filter(Boolean).join('\n');
}

/** The session's system prompt for one direction. */
export function translationSystemPrompt(direction: SessionContext['direction'], words?: SessionWords): string {
  const source = englishLanguageName(direction.source);
  const target = englishLanguageName(direction.target);
  const rules = [
    `You translate a live conversation from ${source} into ${target}.`,
    `Each message is a stretch of speech in ${source}, transcribed as it was heard. Answer with its translation into ${target} and nothing else: no notes, no explanations, no quotation marks, no transcription of the original.`,
    'The earlier messages and your answers are the conversation so far: use them for names, terms and context, and translate only the last message.',
    'If the text is incomplete or unclear, translate what is there as it stands.',
  ].join('\n');
  const note = wordsNote(words);
  return note ? `${rules}\n\n${note}` : rules;
}

/** One job's messages: the system prompt, the earlier stretches and their translations as turns, then the stretch. */
export function translationMessages(system: string, text: string, context: JobContext): ChatMessage[] {
  return [
    { role: 'system', content: system },
    ...context.previous.flatMap((pair): ChatMessage[] => [{ role: 'user', content: pair.source }, { role: 'assistant', content: pair.translation }]),
    { role: 'user', content: text },
  ];
}

/**
 * The translation in a model's answer: trimmed, without the thinking some models write before it (`<think>…</think>`,
 * as a local reasoning model served by Ollama or LM Studio does).
 */
export function translationOf(answer: string): string {
  // A reasoning model cut short inside its thinking has no translation yet: the job reads it as blank.
  return answer.replace(/^\s*<think>[\s\S]*?(?:<\/think>|$)/i, '').trim();
}
