// The line-up's notes service. The line-up always names one (owner, 2026-11-17: no "None"): the one chosen, or, with
// none stored, the default: Kizuna AI where it can write the notes (offered, and signed in to), otherwise OpenAI once it
// has a key, otherwise Gemini once it has one (text models, part C), otherwise the one to set up (Kizuna AI where
// offered, OpenAI otherwise). A compatible service is never the default: it is chosen. Whether notes are written at all
// is the two switches' call (History and notes), not the line-up's.
import type { LineUp } from '../lineup/types';
import { presentProviders } from '../../providers/registry';
import { isElectron } from '../../utils/environment';
import { currentAuth } from '../../app/currentAuth';
import { useProviderStore } from '../../stores/providerStore';

/** The line-up's notes service: Kizuna AI's, by OpenAI, named like the other hosted services (owner, 2026-11-18). */
export const KIZUNA_NOTES = 'kizunaai_openai';
/** The line-up's notes service with the user's own OpenAI key: stored as it always was, served by OpenAI's text model. */
export const OPENAI_NOTES = 'openai';
/** With the user's own Gemini key: Gemini's text model (text models, part C). */
export const GEMINI_NOTES = 'gemini_text';
/** A compatible service at the address the user entered (text models, part C). */
export const COMPATIBLE_NOTES = 'openai_compatible';
/** The notes services the app knows. */
export const NOTES_SERVICES: readonly string[] = [KIZUNA_NOTES, OPENAI_NOTES, GEMINI_NOTES, COMPATIBLE_NOTES];
/** The services the desktop app alone offers, as their providers are (text models, part B). */
const DESKTOP_TEXT_MODELS: readonly string[] = [GEMINI_NOTES, COMPATIBLE_NOTES];

/** The provider whose key, settings and check serve a notes service with the user's own key; null for Kizuna AI's. */
const PROVIDER_OF: Readonly<Record<string, string>> = { [OPENAI_NOTES]: 'openai_text', [GEMINI_NOTES]: 'gemini_text', [COMPATIBLE_NOTES]: 'openai_compatible' };

/** The provider that serves the notes service `service` with the user's own key, or null (Kizuna AI's, or none known). */
export function notesProviderOf(service: string): string | null {
  return Object.prototype.hasOwnProperty.call(PROVIDER_OF, service) ? PROVIDER_OF[service] : null;
}

/** Whether this build offers Kizuna AI's notes: the desktop app, with the hosted services in it. */
export function hostedNotesOffered(): boolean {
  return isElectron() && presentProviders().some((p) => p.kind === 'managed');
}

/** Whether this build offers the notes by Gemini's text model and a compatible service: where their providers are. */
export function textModelNotesOffered(): boolean {
  return presentProviders().some((p) => p.id === notesProviderOf(GEMINI_NOTES));
}

/** What the default notes service depends on. */
export interface NotesDefaults {
  /** Kizuna AI's notes are in this build. */
  hostedOffered: boolean;
  /** Signed in: Kizuna AI can write them. */
  signedIn: boolean;
  /** OpenAI has a key: it can write them. */
  openAiKeyed: boolean;
  /** Gemini has a key: its text model can write them. */
  geminiKeyed: boolean;
  /** Gemini's text model and a compatible service are in this build (the desktop app). */
  textModelsOffered: boolean;
}

/** Whether any of `ids` (providers sharing one key) holds a key in the store. */
function keyed(ids: readonly string[]): boolean {
  const { entries } = useProviderStore.getState();
  return ids.some((id) => {
    const key = entries[id]?.credentials?.apiKey;
    return typeof key === 'string' && key.trim() !== '';
  });
}

/** The providers that hold the one OpenAI key the notes read, and the one Gemini key. */
export const OPENAI_KEY_HOLDERS = ['openai_text', 'openai'] as const;
export const GEMINI_KEY_HOLDERS = ['gemini_text', 'gemini'] as const;

/** The defaults as the stores have them now (the settings page passes its own, which follow sign-in as it changes). */
export function notesDefaultsNow(): NotesDefaults {
  return {
    hostedOffered: hostedNotesOffered(),
    signedIn: currentAuth()?.signedIn === true,
    openAiKeyed: keyed(OPENAI_KEY_HOLDERS),
    geminiKeyed: keyed(GEMINI_KEY_HOLDERS),
    textModelsOffered: textModelNotesOffered(),
  };
}

/**
 * The notes service of a line-up: its choice, or the default when it names none. A value the app does not know (a name
 * since changed, a service since removed), or one this build does not offer, is no choice: nothing was released under
 * another name, so nothing is migrated.
 */
export function notesServiceOf(lineUp: Pick<LineUp, 'summarisation'> | null | undefined, d: NotesDefaults = notesDefaultsNow()): string {
  const chosen = lineUp?.summarisation;
  if (chosen && NOTES_SERVICES.includes(chosen) && (d.textModelsOffered || !DESKTOP_TEXT_MODELS.includes(chosen))) return chosen;
  if (d.hostedOffered && d.signedIn) return KIZUNA_NOTES;
  if (d.openAiKeyed) return OPENAI_NOTES;
  if (d.geminiKeyed && d.textModelsOffered) return GEMINI_NOTES;
  return d.hostedOffered ? KIZUNA_NOTES : OPENAI_NOTES;
}
