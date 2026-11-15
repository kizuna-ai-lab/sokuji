import { describe, expect, it } from 'vitest';
import { RELEASED } from '../../providers/registry';
import { CAPS, familyDefaults, runOf } from './catalog';
import type { LineUp } from './types';

const L = (t: string | null, tl: string | null, s: string | null): LineUp => ({ transcription: t, translation: tl, speech: s, summarisation: null });

describe('the line-up catalog', () => {
  it('runs a line-up of one family on that family\'s provider', () => {
    expect(runOf(L('soniox', 'soniox', 'soniox'))).toEqual({ ok: true, provider: 'soniox' });
    expect(runOf(L('local_inference', 'bing', 'edge'))).toEqual({ ok: true, provider: 'local_inference' });
  });

  it('refuses a mixed, an incomplete and an unbound line-up', () => {
    expect(runOf(L('soniox', 'soniox', 'edge'))).toEqual({ ok: false, reason: 'mixed' });
    expect(runOf(L('local_inference', null, 'edge'))).toEqual({ ok: false, reason: 'incomplete' });
    expect(runOf(L('openai_live', 'openai_live', 'local_inference')).ok).toBe(false);
  });

  it('every family default runs on its family', () => {
    for (const family of new Set(CAPS.map((c) => c.family))) expect(runOf({ ...familyDefaults(family), summarisation: null })).toEqual({ ok: true, provider: family });
  });

  it('covers every released provider, plus Bing and Edge', () => {
    expect(new Set(CAPS.map((c) => c.id))).toEqual(new Set([...RELEASED.map((p) => p.id), 'bing', 'edge']));
  });
});
