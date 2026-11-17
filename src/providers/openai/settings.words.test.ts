// OpenAI's old transcription keywords, still in storage from an older version, are neither read nor sent.
import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildRealtime, type RealtimeConfig } from './config';
import { migrateRealtimeSettings, REALTIME_DEFAULTS, type RealtimeSettings } from './settings';

const PAIR = { source: 'en', target: 'ja' };
const SPEAKER: SessionContext = { direction: PAIR, speech: true, turns: 'auto' };
const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  reversed: (d) => d.source === PAIR.target && d.target === PAIR.source,
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'gpt-realtime-2.1-mini' }],
};

describe('old hot-word settings no longer appear (OpenAI)', () => {
  it('drops the old transcription keywords when an upgraded profile is read', () => {
    const s = migrateRealtimeSettings({ transcriptModel: 'gpt-live-transcribe', transcriptKeywords: 'OldKeyword' }, { legacy: {}, credentials: { apiKey: '' } });
    expect(s).not.toHaveProperty('transcriptKeywords');
    expect(s.transcriptModel).toBe('gpt-live-transcribe');
  });

  it('sends the word list as the keywords once, and never the old keywords', () => {
    const s = { ...REALTIME_DEFAULTS, transcriptModel: 'gpt-live-transcribe', transcriptKeywords: 'OldKeyword' } as RealtimeSettings;
    const without = buildRealtime(SPEAKER, s, SHARED) as RealtimeConfig;
    expect(without.transcription).not.toHaveProperty('keywords');
    const withWords = buildRealtime(SPEAKER, s, { ...SHARED, words: { entries: [{ written: 'Sokuji' }, { written: 'Sokuji' }], background: '' } }) as RealtimeConfig;
    expect(withWords.transcription.keywords).toEqual(['Sokuji']);
    expect(JSON.stringify(withWords)).not.toContain('OldKeyword');
  });
});
