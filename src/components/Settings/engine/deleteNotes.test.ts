import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import type { DirectionResult } from '../../../lib/local-inference/selection/types';
import { computeDeleteNotes } from './deleteNotes';

// Interpolates `{{name}}`-style values into the English default, so the sentences can be read in the assertions.
const t = ((_key: string, fallback: string, vars?: Record<string, string>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars?.[k] ?? '')) as unknown as TFunction;

const resolved = (modelId: string) => ({ modelId }) as unknown as DirectionResult['asr'];
const result = (o: Partial<Record<'asr' | 'translation' | 'tts', string | null>>): DirectionResult =>
  ({
    asr: o.asr ? resolved(o.asr) : null,
    translation: o.translation ? resolved(o.translation) : null,
    tts: o.tts ? resolved(o.tts) : null,
    notes: [],
    prunes: [],
  });
const name = (id: string) => id.toUpperCase();

describe('computeDeleteNotes', () => {
  it('says which stage falls back to which model, per direction the model is used in', () => {
    const notes = computeDeleteNotes('a', name, [{ dir: 'en→ja' }, { dir: 'ja→en' }],
      (dir) => (dir === 'en→ja' ? result({ asr: 'a' }) : result({ asr: 'c' })),
      () => result({ asr: 'b' }), t);
    expect(notes).toEqual(['Deleting A: speech recognition falls back to B.']);
  });

  it('warns that sessions cannot start when no model is left for a required stage, but not for speech output', () => {
    const notes = computeDeleteNotes('a', name, [{ dir: 'en→ja' }],
      () => result({ translation: 'a', tts: 'a' }),
      () => result({}), t);
    expect(notes).toEqual(['Deleting A: no translation model remains — sessions cannot start.']);
  });

  it('says nothing for a model no stage uses', () => {
    expect(computeDeleteNotes('a', name, [{ dir: 'en→ja' }], () => result({ asr: 'b' }), () => result({ asr: 'b' }), t)).toEqual([]);
  });
});
