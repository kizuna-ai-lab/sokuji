// src/components/History/notesExplain.ts
//
// The once-only explanation before notes are first written, as the line-up's notes service makes it true: with the
// user's own key the text goes to that service; with Kizuna AI it goes through our server to OpenAI, and the balance
// that pays for the sessions pays for it. And the notes services by name, wherever a sentence names who writes them.
import type { TFunction } from 'i18next';
import { COMPATIBLE_NOTES, GEMINI_NOTES, KIZUNA_NOTES, OPENAI_NOTES } from '../../lib/notes/notesService';

/** The notes services the line-up offers whose name is a brand, the same in every language. */
export const NOTES_SERVICE_NAMES: Readonly<Record<string, string>> = { [KIZUNA_NOTES]: 'Kizuna AI', [OPENAI_NOTES]: 'OpenAI', [GEMINI_NOTES]: 'Gemini' };

/** A notes service by name: a brand as it is; a compatible service by its provider's name, in the interface's words. */
export function notesServiceName(t: TFunction, service: string): string {
  if (service === COMPATIBLE_NOTES) return t('providers.openai_compatible.name', 'OpenAI-compatible service');
  return NOTES_SERVICE_NAMES[service] ?? service;
}

/** What is sent where, after the session (`after`) or every 20 seconds during it (`live`), for the service `service`. */
export function notesExplanation(t: TFunction, service: string, which: 'after' | 'live'): string {
  if (service === KIZUNA_NOTES) {
    return which === 'live'
      ? t('history.liveExplainKizuna', 'During a session, every 20 seconds the new sentences (their text, numbers, and which side and speaker said them), the notes so far and the spellings in your word list go through Kizuna AI’s server to OpenAI, which writes the notes. Kizuna AI keeps none of it. It is paid from the balance that pays for your sessions. Never the audio or the translation.')
      : t('history.notesExplainKizuna', 'For each session, the text of its sentences, their numbers, which side and speaker said them, and the spellings in your word list go through Kizuna AI’s server to OpenAI, which writes the notes. Kizuna AI keeps none of it. It is paid from the balance that pays for your sessions. Never the audio or the translation.');
  }
  const name = notesServiceName(t, service);
  return which === 'live'
    ? t('history.liveExplain', 'During a session, every 20 seconds the new sentences (their text, numbers, and which side and speaker said them), the notes so far and the spellings in your word list are sent to {{service}} with your own key. Never the audio, the translation or your account.', { service: name })
    : t('history.notesExplain', 'For each session, the text of its sentences, their numbers, which side and speaker said them, and the spellings in your word list are sent to {{service}} with your own key. Never the audio, the translation or your account.', { service: name });
}
