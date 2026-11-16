// The line-up's notes service. The line-up always names one (owner, 2026-11-17: no "None"): the one chosen, or, with
// none stored, the default: Kizuna AI where the build offers the hosted services, OpenAI otherwise. Whether notes are
// written at all is the two switches' call (History and notes), not the line-up's.
import type { LineUp } from '../lineup/types';
import { presentProviders } from '../../providers/registry';
import { isElectron } from '../../utils/environment';

/** The line-up's notes service: Kizuna AI's. */
export const KIZUNA_NOTES = 'kizunaai';

/** Whether this build offers Kizuna AI's notes: the desktop app, with the hosted services in it. */
export function hostedNotesOffered(): boolean {
  return isElectron() && presentProviders().some((p) => p.kind === 'managed');
}

/** The notes service of a line-up: its choice, or the default when it names none. */
export function notesServiceOf(lineUp: Pick<LineUp, 'summarisation'> | null | undefined, hostedOffered: boolean = hostedNotesOffered()): string {
  return lineUp?.summarisation ?? (hostedOffered ? KIZUNA_NOTES : 'openai');
}
