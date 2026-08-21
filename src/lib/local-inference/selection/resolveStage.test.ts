import { describe, it, expect } from 'vitest';
import { resolveStage } from './resolveStage';
import type { Candidate, CandidateSource, Selections, Stage } from './types';

/** Fixture candidate. Defaults are "usable and auto-pickable" so each test
 *  only states the property it is about. */
export const C = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  recommended: false,
  sortOrder: 0,
  sizeBytes: 0,
  ready: true,
  hardwareOk: true,
  needsKey: false,
  autoEligible: true,
  supportsVariant: () => true,
  ...over,
});

/** A CandidateSource over a fixed pool. `has` defaults to pool membership plus
 *  any extra ids, which is how a language-incompatible-but-existing model is
 *  expressed: present in `extraKnown`, absent from `pool`. */
export const src = (pool: Candidate[], extraKnown: string[] = []): CandidateSource => ({
  pool: () => pool,
  has: (_stage: Stage, id: string) => pool.some((c) => c.id === id) || extraKnown.includes(id),
});

const sel = (modelId: string, variant?: string): Selections => ({
  'ja→en': {
    asr: { modelId, ...(variant ? { variant } : {}) },
    translation: { modelId: '' },
    tts: { modelId: '' },
  },
});

describe('resolveStage — explicit selection', () => {
  it('uses the stored model when it is in the pool, ready and runnable', () => {
    const r = resolveStage('ja→en', 'asr', sel('whisper-base'), src([C('sensevoice'), C('whisper-base')]));
    expect(r.resolved).toEqual({ modelId: 'whisper-base', variant: undefined, source: 'explicit' });
    expect(r.note).toBeUndefined();
    expect(r.prune).toBeUndefined();
  });

  it('carries the pinned variant through', () => {
    const r = resolveStage('ja→en', 'asr', sel('whisper-base', 'int8'), src([C('whisper-base')]));
    expect(r.resolved).toEqual({ modelId: 'whisper-base', variant: 'int8', source: 'explicit' });
  });

  it('ignores a pin the candidate no longer supports, without touching selections', () => {
    const selections = sel('whisper-base', 'bf16');
    const r = resolveStage('ja→en', 'asr', selections,
      src([C('whisper-base', { supportsVariant: (v) => v === undefined })]));
    expect(r.resolved).toEqual({ modelId: 'whisper-base', variant: undefined, source: 'explicit' });
    expect(selections['ja→en'].asr.variant).toBe('bf16');
  });

  it('prefers the explicit model over a better-ranked one', () => {
    const r = resolveStage('ja→en', 'asr', sel('whisper-base'),
      src([C('sensevoice', { recommended: true }), C('whisper-base')]));
    expect(r.resolved?.modelId).toBe('whisper-base');
  });
});
