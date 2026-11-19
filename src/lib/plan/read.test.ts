// src/lib/plan/read.test.ts
import { describe, expect, it } from 'vitest';
import { RUN_STAGES } from '../lineup/types';
import { accountOf, providersIn, transcriptionProvider, unitFor } from './read';
import { planOf, stubProvider } from './testing';
import type { PlannedUnit, RunPlan } from './types';

describe('reading a plan', () => {
  it('names each provider once, in unit order, the unit of each stage, and the transcribing provider', () => {
    const local = stubProvider('local_inference');
    const soniox = stubProvider('soniox');
    const text: PlannedUnit = { ...planOf(soniox).units[0], stages: ['transcription', 'translation'] };
    const voice: PlannedUnit = { ...planOf(local).units[0], stages: ['speech'] };
    const plan: RunPlan = { units: [text, voice], byStage: { transcription: text, translation: text, speech: voice } };
    expect(providersIn(plan)).toEqual([soniox, local]);
    expect(providersIn(planOf(soniox))).toEqual([soniox]);
    expect(RUN_STAGES.map((stage) => unitFor(plan, stage))).toEqual([text, text, voice]);
    expect(transcriptionProvider(plan)).toBe(soniox);
  });

  it("answers a provider's account as the run froze it, and throws for a provider not in the plan", () => {
    const account = { settings: { region: 'eu' }, credentials: { apiKey: 'k' } };
    const shape = { accounts: { soniox: account } };
    expect(accountOf(shape, stubProvider('soniox'))).toBe(account);
    expect(() => accountOf(shape, stubProvider('openai'))).toThrow(/openai/);
  });
});
