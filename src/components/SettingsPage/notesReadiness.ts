// src/components/SettingsPage/notesReadiness.ts
//
// Whether the line-up's notes service can write the notes, as the Notes card shows it (text models, part C). The
// notes are no run stage, so their readiness is kept apart from the run's (the provider store's): what the notes lack
// never holds back Start, and a provider that also translates keeps its own answer for that. It is the provider's own
// check, told that it writes the notes and serves no run stage here (`CheckContext.notes`, `stages: []`): the key, then
// the notes' model asked with their reasoning, so a model or a reasoning value the service refuses is said on the card
// in its own words before any notes are asked.
//
// The card asks it while it is shown and not during a session: at once the first time, then after a pause in typing
// whenever what the check reads changes (the notes' model and reasoning, the key, the address). An answer is kept for
// the inputs it was given, but one that could not reach the service (or a check that threw) is asked again the next
// time the card is shown.
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { isMissing, readCredentials } from '../../lib/provider/credentials';
import type { AnyProvider, AuthContext } from '../../lib/provider/types';
import { UNKNOWN, useProviderStore, type ProviderEntry, type Readiness } from '../../stores/providerStore';

/** As long as the readiness driver waits after an edit (`NETWORK_READINESS_DELAY_MS`): a pause in typing. */
export const NOTES_CHECK_DELAY_MS = 800;

const CHECKING: Readiness = { state: 'checking' };

/**
 * A short digest of credential values (53 bits, base 36), enough to tell that they changed and no way back to them:
 * what an answer is kept with holds this, never a key (a second copy of it in memory). Not for anything but change
 * detection.
 */
export function fingerprint(values: readonly string[]): string {
  const text = JSON.stringify(values);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * What the notes' check reads: the provider, the notes' model and reasoning, and the credentials it shows (by their
 * fingerprint). Not the sign-in: this hook is given only the services with the user's own key, whose credentials are
 * read without it, and a text model's check is told none; Kizuna AI's state on the card is the sign-in itself.
 */
function inputsOf(p: AnyProvider, entry: ProviderEntry): string {
  const settings = entry.settings as { notesModel?: unknown; notesReasoning?: unknown };
  const values = p.credentials.fields(entry.settings as never).map((f) => entry.credentials[f.key] ?? '');
  return JSON.stringify([p.id, settings.notesModel ?? null, settings.notesReasoning ?? null, fingerprint(values)]);
}

/** The provider's check, asked about the notes alone. */
export async function checkNotes(p: AnyProvider, entry: ProviderEntry, auth: AuthContext, signal: AbortSignal): Promise<Readiness> {
  const credentials = readCredentials(p, entry.settings, entry.credentials, auth);
  if (isMissing(credentials)) {
    return { state: 'not-ready', reason: credentials.missing, code: credentials.code ?? 'credentials_missing', ...(credentials.params ? { params: credentials.params } : {}) };
  }
  try {
    const result = await p.check(credentials as never, entry.settings as never, {
      pair: entry.pair, legs: useProviderStore.getState().legs, stages: [], notes: true, signal,
    });
    return result.ok
      ? { state: 'ready', models: result.models ?? [] }
      : { state: 'not-ready', reason: result.reason, ...(result.code ? { code: result.code } : {}), ...(result.params ? { params: result.params } : {}) };
  } catch (error) {
    if (signal.aborted) return UNKNOWN;
    return { state: 'not-ready', reason: describeCause(error) };
  }
}

interface NotesAnswers {
  /** Each provider's last answer about the notes, with the inputs it was asked with. */
  byProvider: Readonly<Record<string, { inputs: string; readiness: Readiness }>>;
  put(id: string, inputs: string, readiness: Readiness): void;
  /** Forgets every answer: a test starts from none. */
  reset(): void;
}

export const useNotesAnswers = create<NotesAnswers>()((set) => ({
  byProvider: {},
  put: (id, inputs, readiness) => set((s) => ({ byProvider: { ...s.byProvider, [id]: { inputs, readiness } } })),
  reset: () => set({ byProvider: {} }),
}));

/** Whether an answer stands for its inputs, or is asked again: one that could not find out is asked again. */
const settled = (r: Readiness) => r.state === 'ready' || (r.state === 'not-ready' && r.code !== undefined && r.code !== 'network');

/**
 * The notes' readiness of `provider` (the line-up's notes service's, with the user's own key), asked as the card is
 * shown; unknown while there is none to show (no provider, its entry not loaded, or locked by a session before any
 * answer).
 */
export function useNotesReadiness(provider: AnyProvider | undefined, auth: AuthContext, locked: boolean): Readiness {
  const entry = useProviderStore((s) => (provider ? s.entries[provider.id] : undefined));
  const inputs = provider && entry ? inputsOf(provider, entry) : null;
  const kept = useNotesAnswers((s) => (provider ? s.byProvider[provider.id] : undefined));
  /** Whether this card asked already: the first time at once, then after a pause. */
  const askedBefore = useRef(false);
  useEffect(() => {
    if (!provider || !entry || inputs === null || locked) return undefined;
    const known = useNotesAnswers.getState().byProvider[provider.id];
    if (known?.inputs === inputs && settled(known.readiness)) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      useNotesAnswers.getState().put(provider.id, inputs, CHECKING);
      void checkNotes(provider, entry, auth, controller.signal).then((readiness) => {
        if (!controller.signal.aborted) useNotesAnswers.getState().put(provider.id, inputs, readiness);
      });
    }, askedBefore.current ? NOTES_CHECK_DELAY_MS : 0);
    askedBefore.current = true;
    return () => {
      clearTimeout(timer);
      controller.abort();
      // A check let go of says nothing: not "Checking" for ever.
      const now = useNotesAnswers.getState().byProvider[provider.id];
      if (now?.inputs === inputs && now.readiness.state === 'checking') useNotesAnswers.getState().put(provider.id, inputs, UNKNOWN);
    };
  }, [provider?.id, inputs, locked]); // eslint-disable-line react-hooks/exhaustive-deps
  return kept && kept.inputs === inputs ? kept.readiness : UNKNOWN;
}
