import { describe, expect, it } from 'vitest';
import en from '@shared/locales/en/translation.json';
import { PREVIEW_ESTIMATE_USD, previewFailureKey } from './previewText';
import type { PreviewFailure } from '../session/preview';

const has = (key: string) => key.split('.').reduce<unknown>((n, p) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[p] : undefined), en) !== undefined;

describe('what a failed preview says', () => {
  const reasons: PreviewFailure[] = ['balance', 'busy', 'capacity', 'rate', 'sign_in', 'timeout', 'failed'];

  it('has words for every reason, in the catalogs the app ships', () => {
    for (const r of reasons) expect(has(previewFailureKey(r)), r).toBe(true);
  });

  it('uses the desktop preview messages where it has them', () => {
    expect(previewFailureKey('balance')).toBe('voiceLibrary.previewNeedsBalance');
    expect(previewFailureKey('busy')).toBe('voiceLibrary.previewSessionRunning');
  });
});

describe('the estimate shown before a first preview', () => {
  it('is about what the backend charges (cost × 2, about 1,356 µUSD)', () => {
    expect(PREVIEW_ESTIMATE_USD).toBeCloseTo(0.0014, 4);
  });
});
