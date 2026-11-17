// Soniox's old vocabulary and background, still in storage from an older version, are neither read nor sent.
import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildSoniox } from './config';
import { migrateSonioxSettings, SONIOX_DEFAULTS } from './settings';

const OLD = { vocabularyTerms: 'OldTerm', vocabularyTranslations: 'old=旧', contextText: 'Old agenda' };
const CTX: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1, translationSeconds: 1 },
  reversed: (d) => d.source === 'en',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
};

describe('old hot-word settings no longer appear (Soniox)', () => {
  it('drops the old vocabulary and background fields when an upgraded profile is read', () => {
    const s = migrateSonioxSettings({ ...SONIOX_DEFAULTS, ...OLD });
    for (const key of Object.keys(OLD)) expect(s).not.toHaveProperty(key);
    expect(s).toEqual(SONIOX_DEFAULTS);
  });

  it('sends the word list once and nothing of the old values, even when they are still in the settings object', () => {
    const s = { ...SONIOX_DEFAULTS, ...OLD } as typeof SONIOX_DEFAULTS;
    const words = { entries: [{ written: 'Sokuji' }], background: 'New agenda' };
    const context = buildSoniox(CTX, s, { ...SHARED, words }).stt.context;
    expect(JSON.stringify(context)).not.toMatch(/OldTerm|旧|Old agenda/);
    expect(context?.terms).toEqual(['Sokuji']);
    expect(context?.text).toBe('New agenda');
  });
});
