import { describe, it, expect, vi } from 'vitest';
import type { ConversationItem } from '../../services/interfaces/IClient';
import { keepRowsDroppedOnDisconnect, mergeConversationItems, type LanguagePair } from './conversationMerge';

const item = (id: string, createdAt?: number, source?: 'speaker' | 'participant'): ConversationItem => ({
  id,
  role: 'user',
  type: 'message',
  status: 'completed',
  formatted: { text: id },
  createdAt,
  source,
} as ConversationItem);

const EN_JA: LanguagePair = { sourceLanguage: 'EN', targetLanguage: 'JA' };

describe('mergeConversationItems', () => {
  it('tags untagged rows with the side they came from', () => {
    const out = mergeConversationItems([item('a', 1)], [item('b', 2)], () => EN_JA);
    expect(out.map(i => [i.id, i.source])).toEqual([['a', 'speaker'], ['b', 'participant']]);
  });

  it("keeps a row's own source tag", () => {
    const out = mergeConversationItems([item('a', 1, 'participant')], [], () => EN_JA);
    expect(out[0].source).toBe('participant');
  });

  it('orders both sides together by createdAt; a missing createdAt sorts first', () => {
    const out = mergeConversationItems([item('s2', 20), item('s0')], [item('p1', 10), item('p3', 30)], () => EN_JA);
    expect(out.map(i => i.id)).toEqual(['s0', 'p1', 's2', 'p3']);
  });

  it('keeps speaker before participant when their createdAt ties', () => {
    const out = mergeConversationItems([item('s', 5)], [item('p', 5)], () => EN_JA);
    expect(out.map(i => i.id)).toEqual(['s', 'p']);
  });

  it("takes each row's language pair from languageOf", () => {
    const languageOf = vi.fn((id: string) => (id === 'a' ? EN_JA : { sourceLanguage: 'ZH', targetLanguage: 'KO' }));
    const out = mergeConversationItems([item('a', 1)], [item('b', 2)], languageOf);
    expect(out.map(i => [i.sourceLanguage, i.targetLanguage])).toEqual([['EN', 'JA'], ['ZH', 'KO']]);
    expect(languageOf).toHaveBeenCalledTimes(2);
  });

  it('does not mutate its inputs', () => {
    const speaker = [item('a', 1)];
    mergeConversationItems(speaker, [], () => EN_JA);
    expect(speaker[0]).not.toHaveProperty('sourceLanguage');
  });
});

describe('keepRowsDroppedOnDisconnect', () => {
  const texts = (items: ConversationItem[]) => items.map(i => i.formatted?.text);

  it('keeps every row of a client that empties its items on disconnect (PalabraAI, Compatible OpenAI)', () => {
    const before = [item('a', 1), item('b', 2)];
    expect(texts(keepRowsDroppedOnDisconnect(before, []))).toEqual(['a', 'b']);
  });

  it('takes the version the client still holds, once, when disconnect() finalized a row', () => {
    const partial = { ...item('a', 1), status: 'in_progress', formatted: { text: 'hal' } } as ConversationItem;
    const final = { ...item('a', 1), formatted: { text: 'half done' } } as ConversationItem;
    const out = keepRowsDroppedOnDisconnect([partial], [final]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(final);
  });

  it('appends a row that only appears after disconnect()', () => {
    const out = keepRowsDroppedOnDisconnect([item('a', 1)], [item('a', 1), item('b', 2)]);
    expect(out.map(i => i.id)).toEqual(['a', 'b']);
  });

  it('does not mutate its inputs', () => {
    const before = [item('a', 1)];
    const after = [item('b', 2)];
    keepRowsDroppedOnDisconnect(before, after);
    expect(before.map(i => i.id)).toEqual(['a']);
    expect(after.map(i => i.id)).toEqual(['b']);
  });
});
