// src/lib/plan/types.test.ts
import { describe, expect, it } from 'vitest';
import { RUN_STAGES } from '../lineup/types';
import type { RunStage } from '../lineup/types';
import { isSpeechUnit, isTranslationUnit, sameStages } from './types';
import type { UnitDefinition } from './types';

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

const unit = (over: Partial<UnitDefinition>): UnitDefinition => ({ id: 'u', occupies: () => null, capabilities: () => { throw new Error('not read'); }, build: () => ({}), describe: () => ({}), ...over });

describe('isSpeechUnit', () => {
  it('holds for a unit started through startSpeech, and not for one started through start', () => {
    expect(isSpeechUnit(unit({ startSpeech: () => { throw new Error('not started'); } }))).toBe(true);
    expect(isSpeechUnit(unit({ start: async () => { throw new Error('not started'); } }))).toBe(false);
  });
});

describe('isTranslationUnit', () => {
  it('holds for a unit started through startTranslation, and not for one started through start or startSpeech alone', () => {
    const startTranslation = () => { throw new Error('not started'); };
    expect(isTranslationUnit(unit({ startTranslation }))).toBe(true);
    expect(isTranslationUnit(unit({ startTranslation, startSpeech: () => { throw new Error('not started'); } }))).toBe(true);
    expect(isTranslationUnit(unit({ start: async () => { throw new Error('not started'); } }))).toBe(false);
    expect(isTranslationUnit(unit({ startSpeech: () => { throw new Error('not started'); } }))).toBe(false);
  });
});
