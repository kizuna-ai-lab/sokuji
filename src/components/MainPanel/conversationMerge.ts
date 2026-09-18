import type { ConversationItem } from '../../services/interfaces/IClient';

export interface LanguagePair {
  sourceLanguage: string;
  targetLanguage: string;
}

/** A row of the merged conversation: which side it came from and its language pair. */
export type TaggedConversationItem = ConversationItem & {
  source: 'speaker' | 'participant';
  sourceLanguage: string;
  targetLanguage: string;
};

/**
 * Tag each side's rows with their side and language pair, then merge them into
 * one list ordered by createdAt. The conversation view and the session-end
 * auto-save both build their conversation here, so the saved file holds what
 * the screen shows.
 *
 * `languageOf` decides each row's pair. The view records a pair the first time
 * it sees a row, so switching languages later cannot relabel history; the
 * session-end snapshot only reads. That policy stays with the caller.
 */
export function mergeConversationItems(
  speaker: ConversationItem[],
  participant: ConversationItem[],
  languageOf: (id: string) => LanguagePair,
): TaggedConversationItem[] {
  const tag = (item: ConversationItem, fallbackSource: 'speaker' | 'participant'): TaggedConversationItem => {
    const langs = languageOf(item.id);
    return {
      ...item,
      source: item.source ?? fallbackSource,
      sourceLanguage: langs.sourceLanguage,
      targetLanguage: langs.targetLanguage,
    };
  };
  // Array.prototype.sort is stable, so on a createdAt tie the speaker row
  // stays ahead of the participant row, as it always has.
  return [
    ...speaker.map(item => tag(item, 'speaker')),
    ...participant.map(item => tag(item, 'participant')),
  ].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/**
 * A leg's final items at session end: what its client still holds after
 * disconnect(), plus any row it held before and dropped there. Some clients
 * (e.g. PalabraAIClient, the Compatible provider's OpenAIClient) empty their
 * items in disconnect(), so reading only afterwards would save an empty
 * transcript and blank the stopped view. A row present both times
 * keeps its later version, which disconnect() may have finalized.
 *
 * Rows stay in their pre-disconnect order, with rows that only appear
 * afterwards appended: createdAt is optional, so the later sort cannot be
 * relied on to repair an order this gets wrong.
 */
export function keepRowsDroppedOnDisconnect(
  before: ConversationItem[],
  after: ConversationItem[],
): ConversationItem[] {
  const afterById = new Map(after.map(item => [item.id, item]));
  const beforeIds = new Set(before.map(item => item.id));
  return [
    ...before.map(item => afterById.get(item.id) ?? item),
    ...after.filter(item => !beforeIds.has(item.id)),
  ];
}
