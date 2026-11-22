// src/lib/notes/oldNotesModel.ts
//
// The notes model as it was stored before the notes could be written by each text-model service (text models,
// part C): one global setting, `settings.notes.model`, chosen in History and notes from the newest OpenAI series or
// typed under Other, with Luna by default. The notes with the user's own OpenAI key are now OpenAI's text model's
// (`openai_text`), whose settings read the old value once, while they hold no notes model of their own
// (`migrateOpenAITextSettings`). Nothing writes the old key any more.
import type { ModelChoice } from '../textModel/choice';

/** Where it was stored. */
export const OLD_NOTES_MODEL_KEY = 'settings.notes.model';

/** The models History and notes offered: the newest OpenAI series, Luna (the one the notes were measured with) first. */
export const OLD_NOTES_MODELS = ['gpt-6-luna', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6.1-terra'] as const;

/**
 * Its default, and so the model of every user who never chose one. A real OpenAI model (the notes were measured with
 * it on OpenAI's own endpoint), and the first of OpenAI's notes preferences: Automatic writes with it where the key
 * lists it, as before.
 */
export const OLD_NOTES_DEFAULT = 'gpt-6-luna';

/**
 * The notes model the old value stands for: Automatic where the user never changed it (nothing stored, a value that
 * was not a name, or the default); the one chosen from the list where it was one of the list's; else the name typed.
 */
export function notesModelFromOld(old: unknown): ModelChoice {
  const name = typeof old === 'string' ? old.trim() : '';
  if (name === '' || name === OLD_NOTES_DEFAULT) return { listed: '', typed: '' };
  return (OLD_NOTES_MODELS as readonly string[]).includes(name) ? { listed: name, typed: '' } : { listed: '', typed: name };
}
