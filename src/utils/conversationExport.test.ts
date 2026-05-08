import { describe, it, expect } from 'vitest';
import type { ConversationItem } from '../services/interfaces/IClient';
import {
  buildSessionMetadata,
  collectLanguagePairs,
  deriveSessionLanguagePair,
  formatAsJson,
  formatAsTxt,
  normalizeMessages,
  type TxtI18n,
  type NormalizedMessage,
} from './conversationExport';

type Item = ConversationItem & {
  source?: 'speaker' | 'participant';
  sourceLanguage?: string;
  targetLanguage?: string;
};

function makeItem(over: Partial<Item>): Item {
  return {
    id: over.id ?? 'i1',
    role: over.role ?? 'user',
    type: over.type ?? 'message',
    status: over.status ?? 'completed',
    formatted: over.formatted ?? { text: 'hello' },
    source: over.source ?? 'speaker',
    createdAt: over.createdAt ?? 1700000000000,
    sourceLanguage: over.sourceLanguage,
    targetLanguage: over.targetLanguage,
  };
}

const i18n: TxtI18n = {
  speakerYou: 'You',
  speakerOther: 'Other',
  translationSuffix: '(trans)',
  headerTitle: 'Sokuji conversation export',
  headerGenerated: 'Generated',
  headerProvider: 'Provider',
  headerModels: 'Models',
  headerSource: 'Source',
  headerTarget: 'Target',
  headerNote: 'Note: ...',
};

describe('normalizeMessages — language snapshot propagation', () => {
  it('carries per-item sourceLanguage/targetLanguage onto the message', () => {
    const items: Item[] = [
      makeItem({ id: 'a', sourceLanguage: 'ja', targetLanguage: 'en', formatted: { text: 'こんにちは' } }),
    ];
    const msgs = normalizeMessages(items);
    expect(msgs[0].sourceLanguage).toBe('ja');
    expect(msgs[0].targetLanguage).toBe('en');
  });

  it('leaves snapshot fields undefined when the item has no snapshot', () => {
    const items: Item[] = [
      makeItem({ id: 'a', formatted: { text: 'hi' } }),
    ];
    const msgs = normalizeMessages(items);
    expect(msgs[0].sourceLanguage).toBeUndefined();
    expect(msgs[0].targetLanguage).toBeUndefined();
  });
});

describe('deriveSessionLanguagePair', () => {
  const fallback = { sourceLanguage: 'EN', targetLanguage: 'EN' };

  it('returns the most recent snapshotted pair', () => {
    const msgs: NormalizedMessage[] = [
      { id: '1', createdAt: 1, source: 'speaker', kind: 'original', text: 'a', sourceLanguage: 'ja', targetLanguage: 'en' },
      { id: '2', createdAt: 2, source: 'speaker', kind: 'original', text: 'b', sourceLanguage: 'zh', targetLanguage: 'ko' },
    ];
    expect(deriveSessionLanguagePair(msgs, fallback)).toEqual({ sourceLanguage: 'zh', targetLanguage: 'ko' });
  });

  it('falls back when no message has a snapshot', () => {
    const msgs: NormalizedMessage[] = [
      { id: '1', createdAt: 1, source: 'speaker', kind: 'original', text: 'a' },
    ];
    expect(deriveSessionLanguagePair(msgs, fallback)).toEqual(fallback);
  });

  it('falls back when messages array is empty', () => {
    expect(deriveSessionLanguagePair([], fallback)).toEqual(fallback);
  });

  it('skips trailing messages with missing snapshots and uses the latest snapshotted one', () => {
    const msgs: NormalizedMessage[] = [
      { id: '1', createdAt: 1, source: 'speaker', kind: 'original', text: 'a', sourceLanguage: 'ja', targetLanguage: 'en' },
      { id: '2', createdAt: 2, source: 'speaker', kind: 'original', text: 'b' },
    ];
    expect(deriveSessionLanguagePair(msgs, fallback)).toEqual({ sourceLanguage: 'ja', targetLanguage: 'en' });
  });
});

describe('collectLanguagePairs', () => {
  it('returns distinct pairs in first-seen order', () => {
    const msgs: NormalizedMessage[] = [
      { id: '1', createdAt: 1, source: 'speaker', kind: 'original', text: 'a', sourceLanguage: 'ja', targetLanguage: 'en' },
      { id: '2', createdAt: 2, source: 'speaker', kind: 'translation', text: 'b', sourceLanguage: 'ja', targetLanguage: 'en' },
      { id: '3', createdAt: 3, source: 'speaker', kind: 'original', text: 'c', sourceLanguage: 'zh', targetLanguage: 'ko' },
    ];
    expect(collectLanguagePairs(msgs)).toEqual([
      { sourceLanguage: 'ja', targetLanguage: 'en' },
      { sourceLanguage: 'zh', targetLanguage: 'ko' },
    ]);
  });

  it('returns empty when no message has a snapshot', () => {
    const msgs: NormalizedMessage[] = [
      { id: '1', createdAt: 1, source: 'speaker', kind: 'original', text: 'a' },
    ];
    expect(collectLanguagePairs(msgs)).toEqual([]);
  });
});

describe('formatAsTxt — language pair header', () => {
  function metadata(pairs: Array<{ sourceLanguage: string; targetLanguage: string }>) {
    return buildSessionMetadata({
      provider: 'openai',
      models: {},
      sourceLanguage: pairs[0]?.sourceLanguage ?? 'EN',
      targetLanguage: pairs[0]?.targetLanguage ?? 'EN',
      languagePairs: pairs,
    });
  }

  it('renders single-pair header in the labeled "Source: X → Target: Y" form', () => {
    const meta = metadata([{ sourceLanguage: 'ja', targetLanguage: 'en' }]);
    const out = formatAsTxt([], meta, i18n, { includeHeader: true });
    expect(out).toContain('Source: ja → Target: en');
  });

  it('renders multi-pair header by listing all pairs comma-separated', () => {
    const meta = metadata([
      { sourceLanguage: 'ja', targetLanguage: 'en' },
      { sourceLanguage: 'zh', targetLanguage: 'ko' },
    ]);
    const out = formatAsTxt([], meta, i18n, { includeHeader: true });
    expect(out).toContain('Source → Target: ja → en, zh → ko');
  });

  it('falls back to single sourceLanguage/targetLanguage when languagePairs is empty', () => {
    const meta = buildSessionMetadata({
      provider: 'openai',
      models: {},
      sourceLanguage: 'EN',
      targetLanguage: 'JA',
      languagePairs: [],
    });
    const out = formatAsTxt([], meta, i18n, { includeHeader: true });
    expect(out).toContain('Source: EN → Target: JA');
  });
});

describe('formatAsJson — per-message language and pairs', () => {
  function metadata(pairs: Array<{ sourceLanguage: string; targetLanguage: string }>) {
    return buildSessionMetadata({
      provider: 'openai',
      models: {},
      sourceLanguage: pairs[0]?.sourceLanguage ?? 'EN',
      targetLanguage: pairs[0]?.targetLanguage ?? 'EN',
      languagePairs: pairs,
    });
  }

  it('includes per-message sourceLanguage/targetLanguage when present', () => {
    const msgs: NormalizedMessage[] = [
      { id: '1', createdAt: 1, source: 'speaker', kind: 'original', text: 'hi', sourceLanguage: 'ja', targetLanguage: 'en' },
    ];
    const out = JSON.parse(formatAsJson(msgs, metadata([{ sourceLanguage: 'ja', targetLanguage: 'en' }])));
    expect(out.messages[0].sourceLanguage).toBe('ja');
    expect(out.messages[0].targetLanguage).toBe('en');
  });

  it('omits per-message language fields when not present', () => {
    const msgs: NormalizedMessage[] = [
      { id: '1', createdAt: 1, source: 'speaker', kind: 'original', text: 'hi' },
    ];
    const out = JSON.parse(formatAsJson(msgs, metadata([])));
    expect('sourceLanguage' in out.messages[0]).toBe(false);
    expect('targetLanguage' in out.messages[0]).toBe(false);
  });

  it('includes session.languagePairs when at least one message has a snapshot', () => {
    const msgs: NormalizedMessage[] = [
      { id: '1', createdAt: 1, source: 'speaker', kind: 'original', text: 'a', sourceLanguage: 'ja', targetLanguage: 'en' },
    ];
    const out = JSON.parse(formatAsJson(msgs, metadata([{ sourceLanguage: 'ja', targetLanguage: 'en' }])));
    expect(out.session.languagePairs).toEqual([{ sourceLanguage: 'ja', targetLanguage: 'en' }]);
  });

  it('omits session.languagePairs when empty', () => {
    const out = JSON.parse(formatAsJson([], metadata([])));
    expect('languagePairs' in out.session).toBe(false);
  });

  it('does not emit the legacy "settings reflect current state" note', () => {
    const out = JSON.parse(formatAsJson([], metadata([])));
    expect(out.session.note).toBeUndefined();
  });
});
