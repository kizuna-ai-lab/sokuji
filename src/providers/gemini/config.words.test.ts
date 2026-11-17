// A Gemini Live model that cannot use the word list still starts its session, just without it.
import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildGemini } from './config';
import { GEMINI_DEFAULTS } from './settings';

const DIALOGUE = 'gemini-2.5-flash-native-audio-preview-12-2025';
const TRANSLATE = 'gemini-3.5-live-translate-preview';
const SPEAKER: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1.5, translationSeconds: 2 },
  reversed: (d) => d.source === 'ja' && d.target === 'en',
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: TRANSLATE }, { id: DIALOGUE }],
  words: { entries: [{ written: 'Sokuji' }, { written: 'Kizuna AI' }], background: 'Weekly.' },
};

describe('over-limit and not-used hints (Gemini)', () => {
  it('builds a non-3.8 model with a word list as a session, not a refusal, and without the vocabulary', () => {
    for (const model of [DIALOGUE, TRANSLATE]) {
      const c = buildGemini(SPEAKER, { ...GEMINI_DEFAULTS, model }, SHARED);
      expect(c, model).not.toHaveProperty('refused');
      expect(c, model).not.toHaveProperty('vocabulary');
      expect(c, model).toMatchObject({ model });
    }
  });
});
