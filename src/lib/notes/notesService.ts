// The line-up's notes service. The line-up always names one (owner, 2026-11-17: no "None"): the one chosen, or, with
// none stored, the default: Kizuna AI where it can write the notes (offered, and signed in to), otherwise OpenAI once it
// has a key, otherwise the one to set up (Kizuna AI where offered, OpenAI otherwise). Whether notes are written at all
// is the two switches' call (History and notes), not the line-up's.
import type { LineUp } from '../lineup/types';
import { presentProviders } from '../../providers/registry';
import { isElectron } from '../../utils/environment';
import { currentAuth } from '../../app/currentAuth';
import { useProviderStore } from '../../stores/providerStore';

/** The line-up's notes service: Kizuna AI's. */
export const KIZUNA_NOTES = 'kizunaai';

/** Whether this build offers Kizuna AI's notes: the desktop app, with the hosted services in it. */
export function hostedNotesOffered(): boolean {
  return isElectron() && presentProviders().some((p) => p.kind === 'managed');
}

/** What the default notes service depends on. */
export interface NotesDefaults {
  /** Kizuna AI's notes are in this build. */
  hostedOffered: boolean;
  /** Signed in: Kizuna AI can write them. */
  signedIn: boolean;
  /** OpenAI has a key: it can write them. */
  openAiKeyed: boolean;
}

/** The defaults as the stores have them now (the settings page passes its own, which follow sign-in as it changes). */
export function notesDefaultsNow(): NotesDefaults {
  const key = useProviderStore.getState().entries.openai?.credentials?.apiKey;
  return {
    hostedOffered: hostedNotesOffered(),
    signedIn: currentAuth()?.signedIn === true,
    openAiKeyed: typeof key === 'string' && key.trim() !== '',
  };
}

/** The notes service of a line-up: its choice, or the default when it names none. */
export function notesServiceOf(lineUp: Pick<LineUp, 'summarisation'> | null | undefined, d: NotesDefaults = notesDefaultsNow()): string {
  if (lineUp?.summarisation) return lineUp.summarisation;
  if (d.hostedOffered && d.signedIn) return KIZUNA_NOTES;
  if (d.openAiKeyed) return 'openai';
  return d.hostedOffered ? KIZUNA_NOTES : 'openai';
}
