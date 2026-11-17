// src/lib/notes/appNotes.ts
//
// The app's one notes runner (desktop): the session starts a version when a record closes, the record page starts and
// cancels them. The notes service is the line-up's notes stage: OpenAI with the user's own key, called from the page
// with the model named in History and notes; or Kizuna AI, through our relay with the user's sign-in, paid by the
// payer the app has chosen, with the one model the relay writes notes with.
import { KIZUNA_NOTES, notesDefaultsNow, notesServiceOf } from './notesService';
import { useWordList } from '../words/list';
import i18n from '../../locales';
import { reportError } from '../diagnostics/report';
import { historyPort } from '../history/port';
import type { HistoryRecord } from '../history/types';
import { englishLanguageName, uiLocale } from '../language/label';
import { openaiProvider } from '../../providers/openai/provider';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import useSettingsStore from '../../stores/settingsStore';
import { currentAuth } from '../../app/currentAuth';
import { useAccountStore } from '../../stores/accountStore';
import { getBackendUrl } from '../../utils/environment';
import { accountPayer } from '../session/payerChoice';
import { openAiChat, type ChatPort } from './chat';
import { relayChat, RELAY_NOTES_MODEL } from './relayChat';
import { createNotesRunner, type NotesLanguage, type NotesRunner } from './runner';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export { KIZUNA_NOTES } from './notesService';

/**
 * The notes service the line-up chose, for the meeting `sessionRef` (a record id); null when it chose none, the key is
 * missing, or Kizuna AI was chosen while signed out.
 */
export async function notesChatFromStores(
  sessionRef?: string,
  o: { onBalance?(microUsd: number): void } = {},
): Promise<{ chat: ChatPort; model: string } | null> {
  const lineUp = useLineUpStore.getState().lineUp;
  // With no service chosen the default may depend on whether OpenAI has a key: read it first, loaded if it is not yet,
  // but only then (review): where Kizuna AI can write the notes it is the default whatever the key holds, and a failed
  // read of OpenAI's settings must not keep its notes from being written.
  const defaults = notesDefaultsNow();
  const keyMatters = !lineUp?.summarisation && !(defaults.hostedOffered && defaults.signedIn);
  if (keyMatters && !useProviderStore.getState().entries.openai) await useProviderStore.getState().load(openaiProvider);
  const service = notesServiceOf(lineUp);
  if (service === KIZUNA_NOTES) {
    if (currentAuth()?.signedIn !== true) return null;
    const chat = relayChat({
      baseUrl: getBackendUrl(),
      // Read at each call: a sign-in that changed since is the one used.
      token: async () => (await currentAuth()?.getToken()) ?? null,
      ...(sessionRef ? { sessionRef } : {}),
      payer: accountPayer(useAccountStore.getState().account),
      ...(o.onBalance ? { onBalance: o.onBalance } : {}),
    });
    return { chat, model: RELAY_NOTES_MODEL };
  }
  if (service !== 'openai') return null;
  if (!useProviderStore.getState().entries.openai) await useProviderStore.getState().load(openaiProvider);
  const apiKey = String(useProviderStore.getState().entries.openai?.credentials.apiKey ?? '').trim();
  if (!apiKey) return null;
  const model = useSettingsStore.getState().notesModel;
  return { chat: openAiChat({ baseUrl: OPENAI_BASE_URL, apiKey, model }), model };
}

/** "My language" of the record when it is one language; the interface language when it was automatic. */
export function notesLanguageOf(record: Pick<HistoryRecord, 'myLanguage'> | null): NotesLanguage {
  const mine = record?.myLanguage ?? '';
  const code = mine && mine !== 'auto' && !mine.includes('+') ? mine : uiLocale(i18n.language);
  return { code, name: englishLanguageName(code) };
}

let runner: NotesRunner | null = null;

export function appNotesRunner(): NotesRunner {
  runner ??= createNotesRunner({
    port: historyPort(),
    chatFor: notesChatFromStores,
    language: notesLanguageOf,
    names: () => useWordList.getState().entries,
    report: (message, cause) => reportError('Notes', message, { cause }),
  });
  return runner;
}
