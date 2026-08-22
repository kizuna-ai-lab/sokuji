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

const auto: Selections = {};

describe('resolveStage — auto', () => {
  it("resolves '' by ranking the pool", () => {
    const r = resolveStage('ja→en', 'asr', auto, src([C('a'), C('b', { recommended: true })]));
    expect(r.resolved).toEqual({ modelId: 'b', variant: undefined, source: 'auto' });
  });

  it('treats an absent direction the same as an all-auto one', () => {
    const explicitlyEmpty: Selections = {
      'ja→en': { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: '' } },
    };
    const pool = [C('a'), C('b', { recommended: true })];
    expect(resolveStage('ja→en', 'asr', auto, src(pool)).resolved)
      .toEqual(resolveStage('ja→en', 'asr', explicitlyEmpty, src(pool)).resolved);
  });

  it('ranks recommended first', () => {
    const r = resolveStage('ja→en', 'asr', auto,
      src([C('plain', { sortOrder: 0 }), C('star', { recommended: true, sortOrder: 9 })]));
    expect(r.resolved?.modelId).toBe('star');
  });

  it('breaks a recommended tie by sortOrder', () => {
    const r = resolveStage('ja→en', 'asr', auto,
      src([C('late', { recommended: true, sortOrder: 5 }), C('early', { recommended: true, sortOrder: 1 })]));
    expect(r.resolved?.modelId).toBe('early');
  });

  it('breaks a sortOrder tie by smaller size', () => {
    const r = resolveStage('ja→en', 'asr', auto,
      src([C('big', { sizeBytes: 900 }), C('small', { sizeBytes: 100 })]));
    expect(r.resolved?.modelId).toBe('small');
  });

  it('sorts unknown size (0) last among ties rather than first', () => {
    const r = resolveStage('ja→en', 'asr', auto,
      src([C('unknown', { sizeBytes: 0 }), C('known', { sizeBytes: 900 })]));
    expect(r.resolved?.modelId).toBe('known');
  });

  it('never auto-picks an un-ready candidate', () => {
    const r = resolveStage('ja→en', 'asr', auto,
      src([C('down', { ready: false, recommended: true }), C('up')]));
    expect(r.resolved?.modelId).toBe('up');
  });

  it('never auto-picks a hardware-gated candidate', () => {
    const r = resolveStage('ja→en', 'asr', auto,
      src([C('gpu', { hardwareOk: false, recommended: true }), C('cpu')]));
    expect(r.resolved?.modelId).toBe('cpu');
  });

  it('never auto-picks a candidate marked explicit-only', () => {
    const r = resolveStage('ja→en', 'translation', auto,
      src([C('ast-model', { autoEligible: false, recommended: true }), C('mt')]));
    expect(r.resolved?.modelId).toBe('mt');
  });

  it('still lets an explicit selection reach an explicit-only candidate', () => {
    const selections: Selections = {
      'ja→en': { asr: { modelId: '' }, translation: { modelId: 'ast-model' }, tts: { modelId: '' } },
    };
    const r = resolveStage('ja→en', 'translation', selections,
      src([C('ast-model', { autoEligible: false }), C('mt')]));
    expect(r.resolved).toEqual({ modelId: 'ast-model', variant: undefined, source: 'explicit' });
  });

  it('returns null when nothing is usable', () => {
    const r = resolveStage('ja→en', 'asr', auto, src([C('down', { ready: false })]));
    expect(r.resolved).toBeNull();
  });
});

describe('resolveStage — why the explicit pick was not used', () => {
  const pick = (id: string): Selections => ({
    'ja→en': { asr: { modelId: id }, translation: { modelId: '' }, tts: { modelId: '' } },
  });

  it('deleted model -> not-downloaded, falls back, keeps the selection', () => {
    const selections = pick('whisper-base');
    const r = resolveStage('ja→en', 'asr', selections,
      src([C('whisper-base', { ready: false }), C('sensevoice')]));
    expect(r.note).toEqual({
      direction: 'ja→en', stage: 'asr',
      from: 'whisper-base', to: 'sensevoice', reason: 'not-downloaded',
    });
    expect(r.resolved).toEqual({ modelId: 'sensevoice', variant: undefined, source: 'auto' });
    expect(r.prune).toBeUndefined();
    expect(selections['ja→en'].asr.modelId).toBe('whisper-base');
  });

  it('wrong direction -> lang-incompatible when the model still exists elsewhere', () => {
    const selections: Selections = {
      'ja→en': { asr: { modelId: '' }, translation: { modelId: 'opus-mt-en-ja' }, tts: { modelId: '' } },
    };
    const r = resolveStage('ja→en', 'translation', selections,
      src([C('qwen')], ['opus-mt-en-ja']));
    expect(r.note?.reason).toBe('lang-incompatible');
    expect(r.prune).toBeUndefined();
  });

  it('model gone from the catalog -> not-in-catalog AND prune', () => {
    const r = resolveStage('ja→en', 'asr', pick('retired-model'), src([C('sensevoice')]));
    expect(r.note?.reason).toBe('not-in-catalog');
    expect(r.prune).toBe(true);
  });

  it('lost the GPU -> hardware-gated', () => {
    const r = resolveStage('ja→en', 'asr', pick('gpu-only'),
      src([C('gpu-only', { hardwareOk: false }), C('cpu')]));
    expect(r.note?.reason).toBe('hardware-gated');
  });

  it('cloud implementation without a key -> needs-key, not not-downloaded', () => {
    const r = resolveStage('ja→en', 'asr', pick('cloud'),
      src([C('cloud', { ready: false, needsKey: true }), C('local')]));
    expect(r.note?.reason).toBe('needs-key');
  });

  it('nothing usable and nothing chosen -> a single no-candidate note', () => {
    const r = resolveStage('ja→en', 'asr', {}, src([C('down', { ready: false })]));
    expect(r.resolved).toBeNull();
    expect(r.note).toEqual({
      direction: 'ja→en', stage: 'asr', from: null, to: null, reason: 'no-candidate',
    });
  });

  it('nothing usable but something was chosen -> keeps the specific reason, to: null', () => {
    const r = resolveStage('ja→en', 'asr', pick('whisper-base'),
      src([C('whisper-base', { ready: false })]));
    expect(r.resolved).toBeNull();
    expect(r.note).toEqual({
      direction: 'ja→en', stage: 'asr', from: 'whisper-base', to: null, reason: 'not-downloaded',
    });
  });

  it('prunes even when the fallback also fails', () => {
    const r = resolveStage('ja→en', 'asr', pick('retired-model'), src([]));
    expect(r.prune).toBe(true);
    expect(r.note?.reason).toBe('not-in-catalog');
  });
});
