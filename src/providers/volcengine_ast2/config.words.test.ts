// Doubao over its limit still builds a session, with the first 1,000 items.
import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildAst2, type Ast2Config } from './config';
import { AST2_DEFAULTS } from './settings';

const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1, translationSeconds: 1 },
  reversed: (d) => d.source === 'en' && d.target === 'zh',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
};
const SPEAKER: SessionContext = { direction: { source: 'zh', target: 'en' }, speech: true, turns: 'auto' };

describe('over-limit and not-used hints (Doubao)', () => {
  it('builds the session with the first 1,000 items when the list is over the limit, refusing nothing', () => {
    const entries = Array.from({ length: 1200 }, (_, i) => ({ written: `w${i}` }));
    const c = buildAst2(SPEAKER, AST2_DEFAULTS, { ...SHARED, words: { entries, background: '' } });
    expect(c).not.toHaveProperty('refused');
    const corpus = (c as Ast2Config).corpus!;
    expect(corpus.hotWordsList).toHaveLength(1000);
    expect(corpus.hotWordsList![999]).toBe('w999');
  });
});
