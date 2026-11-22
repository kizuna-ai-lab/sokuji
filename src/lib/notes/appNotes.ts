// src/lib/notes/appNotes.ts
//
// The app's one notes runner (desktop): the session starts a version when a record closes, the record page starts and
// cancels them. The notes service is the line-up's notes stage: Kizuna AI, through our relay with the user's sign-in,
// paid by the payer the app has chosen, with the one model the relay writes notes with; or a text model with the
// user's own key (text models, part C): OpenAI's, Gemini's or a compatible service's, called with the notes model and
// reasoning chosen on the line-up's Notes card (the provider's `notesModel` and `notesReasoning`).
import {
  COMPATIBLE_NOTES, GEMINI_KEY_HOLDERS, GEMINI_NOTES, KIZUNA_NOTES, notesDefaultsNow, notesProviderOf, notesServiceOf, OPENAI_KEY_HOLDERS, OPENAI_NOTES,
} from './notesService';
import { useWordList } from '../words/list';
import i18n from '../../locales';
import { reportError } from '../diagnostics/report';
import { historyPort } from '../history/port';
import type { HistoryRecord } from '../history/types';
import { englishLanguageName, uiLocale } from '../language/label';
import { isMissing, readCredentials } from '../provider/credentials';
import type { AnyProvider, CredentialsMissing } from '../provider/types';
import type { AuthContext } from '../run/types';
import { automaticModel, type ModelChoice } from '../textModel/choice';
import type { TextModelService } from '../textModel/client';
import { textModelList } from '../textModel/modelList';
import { NOTES_MODEL_PREFERENCES } from '../textModel/models';
import type { TextModelCredentials } from '../textModel/translation';
import type { TextModelSettings } from '../textModel/unit';
import { geminiTextProvider } from '../../providers/gemini_text/provider';
import { openaiCompatibleProvider } from '../../providers/openai_compatible/provider';
import { openaiTextProvider } from '../../providers/openai_text/provider';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import { currentAuth } from '../../app/currentAuth';
import { useAccountStore } from '../../stores/accountStore';
import { getBackendUrl } from '../../utils/environment';
import { accountPayer } from '../session/payerChoice';
import { ChatError, type ChatPort } from './chat';
import { relayChat, RELAY_NOTES_MODEL } from './relayChat';
import { createNotesRunner, type NotesLanguage, type NotesRunner } from './runner';
import { textModelNotesChat } from './textModelChat';

export { KIZUNA_NOTES } from './notesService';

/** The notes service a run writes with: its chat port, the model it writes with, and the service's line-up id. */
export interface NotesChat {
  chat: ChatPort;
  model: string;
  /** The line-up's notes service (`kizunaai_openai`, `openai`, `gemini_text`, `openai_compatible`): who wrote them. */
  service: string;
}

/** The text-model providers that write the notes with the user's own key, by notes service, and the service each asks. */
const OWN_KEY: Readonly<Record<string, { provider: AnyProvider; service: TextModelService }>> = {
  [OPENAI_NOTES]: { provider: openaiTextProvider as AnyProvider, service: 'openai' },
  [GEMINI_NOTES]: { provider: geminiTextProvider as AnyProvider, service: 'gemini' },
  [COMPATIBLE_NOTES]: { provider: openaiCompatibleProvider as AnyProvider, service: 'compatible' },
};

const SIGNED_OUT: AuthContext = { signedIn: false, getToken: async () => null };

/** Loads a provider's entry when the store has none yet. */
async function loaded(p: AnyProvider) {
  if (!useProviderStore.getState().entries[p.id]) await useProviderStore.getState().load(p);
  return useProviderStore.getState().entries[p.id];
}

/**
 * The model the notes ask: the name typed, the one chosen, else Automatic: the service's notes preference its key
 * lists (the page's list, asked once per key), else its first text model. With no list to read (the service out of
 * reach, or refusing the key), the first preference: the request then says what is wrong. A compatible service has
 * no Automatic: null.
 */
async function notesModelOf(service: TextModelService, choice: ModelChoice, k: TextModelCredentials): Promise<string | null> {
  const typed = choice.typed.trim();
  if (typed !== '') return typed;
  if (choice.listed !== '') return choice.listed;
  if (service === 'compatible') return null;
  const listed = await textModelList({ service, ...(k.apiKey ? { apiKey: k.apiKey } : {}) }).catch(() => null);
  return (listed?.ok ? automaticModel(service, listed.ids, 'notes') : null) ?? NOTES_MODEL_PREFERENCES[service][0];
}

/** A port that says no notes model is chosen: a compatible service has no Automatic. */
const unsetChat: ChatPort = async () => {
  throw new ChatError('No notes model is chosen for the compatible service', { code: 'no-model', retryable: false });
};

/**
 * The notes service the line-up chose, for the meeting `sessionRef` (a record id); null when it chose none, its key
 * (or a compatible service's address) is missing, or Kizuna AI was chosen while signed out.
 */
export async function notesChatFromStores(
  sessionRef?: string,
  o: { onBalance?(microUsd: number): void } = {},
): Promise<NotesChat | null> {
  const lineUp = useLineUpStore.getState().lineUp;
  // With no service chosen the default may depend on whether OpenAI or Gemini has a key: their keys are read first,
  // loaded if they are not yet, but only then (review): where Kizuna AI can write the notes it is the default whatever
  // the keys hold, and a failed read of their settings must not keep its notes from being written.
  const defaults = notesDefaultsNow();
  const keyMatters = !lineUp?.summarisation && !(defaults.hostedOffered && defaults.signedIn);
  if (keyMatters) {
    if (!OPENAI_KEY_HOLDERS.some((id) => useProviderStore.getState().entries[id])) await loaded(openaiTextProvider as AnyProvider);
    if (defaults.textModelsOffered && !GEMINI_KEY_HOLDERS.some((id) => useProviderStore.getState().entries[id])) await loaded(geminiTextProvider as AnyProvider);
  }
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
    return { chat, model: RELAY_NOTES_MODEL, service };
  }
  const own = notesProviderOf(service) ? OWN_KEY[service] : undefined;
  if (!own) return null;
  const entry = await loaded(own.provider);
  if (!entry) return null;
  const settings = entry.settings as TextModelSettings;
  const credentials = readCredentials(own.provider, settings, entry.credentials, currentAuth() ?? SIGNED_OUT) as TextModelCredentials | CredentialsMissing;
  if (isMissing(credentials)) return null;
  const apiKey = credentials.apiKey?.trim() || undefined;
  const k: TextModelCredentials = { ...(credentials.baseUrl ? { baseUrl: credentials.baseUrl } : {}), ...(apiKey ? { apiKey } : {}) };
  const model = await notesModelOf(own.service, settings.notesModel, k);
  if (model === null) return { chat: unsetChat, model: '', service };
  return { chat: textModelNotesChat({ service: own.service, ...k, model, reasoning: settings.notesReasoning }), model, service };
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
