import { describe, expect, it } from 'vitest';
import { RELEASED } from '../../providers/registry';
import { allStagesBy, CAPS, caps, hostDefaults, optionFor, soleHost, stageIdsFor } from './catalog';
import { oldRunOf } from './oldRules.testing';
import type { LineUp, RunStage } from './types';

describe('the line-up catalog', () => {
  it('every option names a provider definition as its host', () => {
    for (const c of CAPS) expect(c.host === c.id || (c.host === 'local_inference' && ['bing', 'edge'].includes(c.id))).toBe(true);
  });

  it('a host runs Bing and Edge beside the local provider by default, and itself on every stage elsewhere', () => {
    expect(hostDefaults('local_inference')).toEqual({ transcription: 'local_inference', translation: 'bing', speech: 'edge' });
    expect(hostDefaults('soniox')).toEqual({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' });
  });

  it('covers every released provider, plus Bing and Edge', () => {
    expect(new Set(CAPS.map((c) => c.id))).toEqual(new Set([...RELEASED.map((p) => p.id), 'bing', 'edge']));
  });
});

const L = (t: string | null, tl: string | null, s: string | null): Pick<LineUp, RunStage> => ({ transcription: t, translation: tl, speech: s });

describe('the option a stage names', () => {
  it('is the option when it is known and serves that stage', () => {
    expect(optionFor(L('soniox', 'bing', 'edge'), 'transcription')).toBe(caps('soniox'));
    expect(optionFor(L('soniox', 'bing', 'edge'), 'translation')).toBe(caps('bing'));
  });

  it('is undefined for an unset stage, an unknown id, or an option that does not serve the stage', () => {
    expect(optionFor(L(null, 'bing', 'edge'), 'transcription')).toBeUndefined();
    expect(optionFor(L('nope', 'bing', 'edge'), 'transcription')).toBeUndefined();
    expect(optionFor(L('bing', 'bing', 'edge'), 'transcription')).toBeUndefined();
  });
});

describe('the sole host of a line-up', () => {
  it('runs a line-up whose options share one host on that host', () => {
    expect(soleHost(L('soniox', 'soniox', 'soniox'))).toBe('soniox');
    expect(soleHost(L('local_inference', 'bing', 'edge'))).toBe('local_inference');
  });

  it('refuses a line-up of several hosts, one with a stage unset, and one that splits a joint group', () => {
    expect(soleHost(L('soniox', 'soniox', 'edge'))).toBeNull();
    expect(soleHost(L('local_inference', null, 'edge'))).toBeNull();
    expect(soleHost(L('openai_live', 'openai_live', 'local_inference'))).toBeNull();
  });

  it("runs every host's defaults on that host", () => {
    for (const host of new Set(CAPS.map((c) => c.host))) expect(soleHost(hostDefaults(host))).toBe(host);
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

describe('the ids that served a run', () => {
  it('names one provider on every stage', () => {
    expect(allStagesBy('openai')).toEqual({ transcription: 'openai', translation: 'openai', speech: 'openai' });
  });

  it("are the stored line-up's: a stored line-up is what runs", () => {
    expect(stageIdsFor(L('local_inference', 'bing', 'edge'), true, 'local_inference'))
      .toEqual({ transcription: 'local_inference', translation: 'bing', speech: 'edge' });
    expect(stageIdsFor(L('openai', 'openai', 'openai'), true, 'openai'))
      .toEqual({ transcription: 'openai', translation: 'openai', speech: 'openai' });
  });

  it('are the running provider on every stage while no line-up is stored: one only shown is no guess about the run', () => {
    expect(stageIdsFor(L('local_inference', 'bing', 'edge'), false, 'local_inference')).toEqual(allStagesBy('local_inference'));
    expect(stageIdsFor(null, false, 'soniox')).toEqual(allStagesBy('soniox'));
    expect(stageIdsFor(null, true, 'soniox')).toEqual(allStagesBy('soniox'));
  });

  it("are the stored line-up's on a line-up of two providers, whichever provider is named beside it", () => {
    expect(stageIdsFor(L('soniox', 'soniox', 'edge'), true, 'soniox')).toEqual({ transcription: 'soniox', translation: 'soniox', speech: 'edge' });
    expect(stageIdsFor(L('local_inference', 'bing', 'edge'), true, 'openai')).toEqual({ transcription: 'local_inference', translation: 'bing', speech: 'edge' });
  });

  it('are the named provider on every stage for a stored line-up that leaves a stage out: it does not start', () => {
    expect(stageIdsFor(L('local_inference', null, 'edge'), true, 'local_inference')).toEqual(allStagesBy('local_inference'));
  });
});
