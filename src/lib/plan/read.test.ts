// src/lib/plan/read.test.ts
import { describe, expect, it } from 'vitest';
import { CAPS, hostDefaults } from '../lineup/catalog';
import { oldRunOf } from '../lineup/oldRules.testing';
import { RUN_STAGES } from '../lineup/types';
import type { LineUp, RunStage } from '../lineup/types';
import { providersIn, soleHost, transcriptionProvider, unitFor } from './read';
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
});

const L = (t: string | null, tl: string | null, s: string | null): Pick<LineUp, RunStage> => ({ transcription: t, translation: tl, speech: s });

describe('the sole host of a line-up', () => {
  it('runs a line-up of one family on that family\'s provider', () => {
    expect(soleHost(L('soniox', 'soniox', 'soniox'))).toBe('soniox');
    expect(soleHost(L('local_inference', 'bing', 'edge'))).toBe('local_inference');
  });

  it('refuses a mixed, an incomplete and an unbound line-up', () => {
    expect(soleHost(L('soniox', 'soniox', 'edge'))).toBeNull();
    expect(soleHost(L('local_inference', null, 'edge'))).toBeNull();
    expect(soleHost(L('openai_live', 'openai_live', 'local_inference'))).toBeNull();
  });

  it('every family default runs on its family', () => {
    for (const family of new Set(CAPS.map((c) => c.host))) expect(soleHost(hostDefaults(family))).toBe(family);
  });

  it('equals the old run rule for every triple of ids in the catalog, and an unset stage', () => {
    const ids = [...CAPS.map((c) => c.id), null];
    for (const transcription of ids) for (const translation of ids) for (const speech of ids) {
      const old = oldRunOf({ transcription, translation, speech, summarisation: null });
      const l = JSON.stringify({ transcription, translation, speech });
      expect(soleHost({ transcription, translation, speech }), l).toBe(old.ok ? old.provider : null);
    }
  });
});
