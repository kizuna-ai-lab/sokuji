// src/lib/notes/appNotes.ts
//
// The app's one notes runner (desktop): the session starts a version when a record closes, the record page starts and
// cancels them. The notes service is the line-up's notes stage; today that is OpenAI with the user's own key, called
// from the page (client side only, owner 2026-11-16). The model is the one named in History and notes.
import i18n from '../../locales';
import { reportError } from '../diagnostics/report';
import { historyPort } from '../history/port';
import type { HistoryRecord } from '../history/types';
import { englishLanguageName, uiLocale } from '../language/label';
import { openaiProvider } from '../../providers/openai/provider';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import useSettingsStore from '../../stores/settingsStore';
import { openAiChat, type ChatPort } from './chat';
import { createNotesRunner, type NotesLanguage, type NotesRunner } from './runner';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** The notes service with the user's key, or null when the line-up chose none or the key is missing. */
export async function notesChatFromStores(): Promise<{ chat: ChatPort; model: string } | null> {
  if (useLineUpStore.getState().lineUp?.summarisation !== 'openai') return null;
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
    report: (message, cause) => reportError('Notes', message, { cause }),
  });
  return runner;
}
