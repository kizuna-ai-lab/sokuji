import { describe, it, expect } from 'vitest';
import { resolveDirection } from './resolveStage';
import type { Candidate, CandidateSource, Selections, Stage } from './types';

const C = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id, recommended: false, sortOrder: 0, sizeBytes: 0, ready: true, hardwareOk: true,
  needsKey: false, autoEligible: true, supportsVariant: () => true, ...over,
});

/** Per-stage, per-direction pools — the shape the real adapters have. */
const source = (byStage: Partial<Record<Stage, Record<string, Candidate[]>>>): CandidateSource => ({
  pool: (stage, src, tgt) => byStage[stage]?.[`${src}→${tgt}`] ?? [],
  has: (stage, id) =>
    Object.values(byStage[stage] ?? {}).some((list) => list.some((c) => c.id === id)),
});

const CAT = source({
  asr: { 'ja→en': [C('sensevoice')], 'en→ja': [C('sensevoice')] },
  translation: { 'ja→en': [C('opus-ja-en'), C('qwen')], 'en→ja': [C('qwen')] },
  tts: { 'ja→en': [C('kokoro-en')], 'en→ja': [] },
});

describe('resolveDirection', () => {
  it('resolves all three stages', () => {
    const r = resolveDirection('ja→en', {}, CAT);
    expect(r.asr?.modelId).toBe('sensevoice');
    expect(r.translation?.modelId).toBe('opus-ja-en');
    expect(r.tts?.modelId).toBe('kokoro-en');
  });

  it('returns null for a stage with no usable candidate, without failing the others', () => {
    const r = resolveDirection('en→ja', {}, CAT);
    expect(r.asr?.modelId).toBe('sensevoice');
    expect(r.tts).toBeNull();
    expect(r.notes.filter((n) => n.stage === 'tts' && n.reason === 'no-candidate')).toHaveLength(1);
  });

  it('collects notes and prunes across stages', () => {
    const selections: Selections = {
      'ja→en': { asr: { modelId: 'retired' }, translation: { modelId: '' }, tts: { modelId: 'also-retired' } },
    };
    const r = resolveDirection('ja→en', selections, CAT);
    expect(r.notes.map((n) => n.reason)).toEqual(['not-in-catalog', 'not-in-catalog']);
    expect(r.prunes).toEqual([
      { direction: 'ja→en', stage: 'asr' },
      { direction: 'ja→en', stage: 'tts' },
    ]);
  });

  it('resolves the two directions independently — neither consults the other', () => {
    const selections: Selections = {
      'ja→en': { asr: { modelId: '' }, translation: { modelId: 'opus-ja-en' }, tts: { modelId: '' } },
    };
    const speaker = resolveDirection('ja→en', selections, CAT);
    const participant = resolveDirection('en→ja', selections, CAT);
    expect(speaker.translation?.modelId).toBe('opus-ja-en');
    // The directional Opus model is simply absent from the reverse pool; the
    // reverse direction falls to its own best rather than inheriting anything.
    expect(participant.translation).toEqual({ modelId: 'qwen', variant: undefined, source: 'auto' });
    expect(participant.notes).toHaveLength(1);
    expect(participant.notes[0].stage).toBe('tts');
  });
});
