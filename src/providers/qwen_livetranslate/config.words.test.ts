// Qwen's old hot words, still in storage from an older version, are not mixed into the word list's phrases.
import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildQwen } from './config';
import { QWEN_DEFAULTS } from './settings';

const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  reversed: (d) => d.source === 'en' && d.target === 'zh',
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'intl' }],
};
const ctx = (source: string, target: string): SessionContext => ({ direction: { source, target }, speech: true, turns: 'auto' });

describe('old hot-word settings no longer appear (Qwen LiveTranslate)', () => {
  it('sends only the word list as phrases when old hot words are still in the settings object', () => {
    const old = { ...QWEN_DEFAULTS, hotwords: '交流=chat\n实时翻译=OldValue' } as typeof QWEN_DEFAULTS;
    const words = { entries: [{ written: '实时翻译', translation: 'LiveTranslate' }], background: '' };
    expect(buildQwen(ctx('zh', 'en'), old, { ...SHARED, words })).toMatchObject({ phrases: { '实时翻译': 'LiveTranslate' } });
    const c = buildQwen(ctx('zh', 'en'), old, { ...SHARED, words }) as { phrases: Record<string, string> };
    expect(Object.keys(c.phrases)).toEqual(['实时翻译']);
  });
});
