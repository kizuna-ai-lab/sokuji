import { describe, it, expect } from 'vitest';
import { migrateRejectedPalabraLanguages } from './settingsStore';
import { defaultPalabraAISettings } from '../services/providers/PalabraAIProviderConfig';

/**
 * Four codes we used to offer are rejected by Palabra's set_task validation, so a
 * persisted setting holding one of them connects and then translates nothing.
 * Dropping them from the dropdowns doesn't help anyone who already picked one —
 * the stored value survives and the select just renders blank.
 */
describe('rejected PalabraAI language migration', () => {
  it("rewrites the Vietnamese target from 'vn' to the code the API accepts", () => {
    expect(migrateRejectedPalabraLanguages({ sourceLanguage: 'en', targetLanguage: 'vn' }))
      .toEqual({ sourceLanguage: 'en', targetLanguage: 'vi' });
  });

  it('falls back to the default source for languages Palabra never supported', () => {
    for (const code of ['ba', 'eo', 'ia']) {
      expect(migrateRejectedPalabraLanguages({ sourceLanguage: code, targetLanguage: 'es' }))
        .toEqual({ sourceLanguage: defaultPalabraAISettings.sourceLanguage, targetLanguage: 'es' });
    }
  });

  it('leaves a valid pair untouched', () => {
    // es → en is the pair from the original bug report. Plain 'en' is in the API's
    // target enum (verified against the live API), so the migration must not touch
    // it — only 'vn' has no valid equivalent.
    expect(migrateRejectedPalabraLanguages({ sourceLanguage: 'es', targetLanguage: 'en' }))
      .toEqual({ sourceLanguage: 'es', targetLanguage: 'en' });
    expect(migrateRejectedPalabraLanguages({ sourceLanguage: 'vi', targetLanguage: 'vi' }))
      .toEqual({ sourceLanguage: 'vi', targetLanguage: 'vi' });
  });

  it('leaves region-suffixed targets untouched', () => {
    // en-us/pt-br/zh-hant are all valid targets; only 'vn' was wrong.
    expect(migrateRejectedPalabraLanguages({ sourceLanguage: 'ja', targetLanguage: 'en-us' }))
      .toEqual({ sourceLanguage: 'ja', targetLanguage: 'en-us' });
  });
});
