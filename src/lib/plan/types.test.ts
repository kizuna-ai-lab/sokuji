// src/lib/plan/types.test.ts
import { describe, expect, it } from 'vitest';
import { RUN_STAGES } from '../lineup/types';
import type { RunStage } from '../lineup/types';
import { sameStages } from './types';

describe('sameStages', () => {
  const asked = new Set<RunStage>(['transcription', 'speech']);

  it('holds for the same stages in any order', () => {
    expect(sameStages(['transcription', 'speech'], asked)).toBe(true);
    expect(sameStages(['speech', 'transcription'], asked)).toBe(true);
    expect(sameStages([], new Set())).toBe(true);
  });

  it('fails for a stage missing, a stage more, another stage, or a stage repeated', () => {
    expect(sameStages(['transcription'], asked)).toBe(false);
    expect(sameStages(RUN_STAGES, asked)).toBe(false);
    expect(sameStages(['transcription', 'translation'], asked)).toBe(false);
    expect(sameStages(['transcription', 'transcription'], asked)).toBe(false);
  });
});
