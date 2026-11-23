import { beforeEach, describe, expect, it, vi } from 'vitest';
import { presentProviders, RELEASED } from '../../providers/registry';
import { allStagesBy, belongsTo, allCaps, caps, carriedTogether, goesWith, hostDefaults, optionFor, runsByItself, severalHosts, stageIdsFor } from './catalog';
import type { LineUp, RunStage } from './types';

describe('the line-up catalog', () => {
  it('every option is its own host', () => {
    for (const c of allCaps()) expect([c.id, c.host]).toEqual([c.id, c.id]);
  });

  it('the free line-up belongs to this device', () => {
    expect(belongsTo({ transcription: 'local_inference', translation: 'bing', speech: 'edge' }, 'local_inference')).toBe(true);
    expect(belongsTo({ transcription: 'soniox', translation: 'bing', speech: 'edge' }, 'local_inference')).toBe(false);
    expect(belongsTo({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' }, 'soniox')).toBe(true);
    expect(belongsTo({ transcription: 'local_inference', translation: 'bing', speech: 'edge' }, 'soniox')).toBe(false);
    expect(belongsTo({ transcription: 'local_inference', translation: 'soniox', speech: 'edge' }, 'local_inference')).toBe(false);
  });

  it('a host runs Bing and Edge beside the local provider by default, and itself on every stage elsewhere', () => {
    expect(hostDefaults('local_inference')).toEqual({ transcription: 'local_inference', translation: 'bing', speech: 'edge' });
    expect(hostDefaults('soniox')).toEqual({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' });
  });

  it('covers every released provider, plus Bing and Edge', () => {
    expect(new Set(allCaps().map((c) => c.id))).toEqual(new Set([...RELEASED.map((p) => p.id), 'bing', 'edge']));
  });

  // A stored line-up that names an option this platform does not offer (a text model, on the web) stays readable: the
  // catalog is the compiled providers', not the present ones'.
  it('lists every released provider, also one this platform does not offer', () => {
    expect(allCaps().map((c) => c.id)).toEqual(RELEASED.map((p) => p.id));
    const web = presentProviders({ platform: 'web', dev: false, enabled: new Set(), kizuna: true, switchOn: () => false });
    expect(web.some((p) => p.id === 'openai_text')).toBe(false);
    expect(caps('openai_text')).toBeDefined();
  });

  it('a text model translates alone, on a key, for any voice that stands alone: its host is itself, and nothing goes with it', () => {
    for (const id of ['openai_text', 'gemini_text', 'openai_compatible']) {
      expect(caps(id), id).toEqual({ id, stages: ['translation'], host: id, account: 'key', voiceAlone: false, takesVoice: true });
      expect(goesWith(caps(id)!, 'translation'), id).toEqual(['translation']);
      expect(carriedTogether(caps(id)!), id).toBeUndefined();
    }
  });

  it('a host that serves only some stages runs the others as this device does by default: its recognition and Edge', () => {
    for (const id of ['openai_text', 'gemini_text', 'openai_compatible']) expect(hostDefaults(id), id).toEqual({ transcription: 'local_inference', translation: id, speech: 'edge' });
    // Under a catalog of one-stage hosts, each keeps its own stage and takes this device's for the rest.
    const oneStage = [
      ...allCaps(),
      { id: 'only_voice', stages: ['speech' as const], host: 'only_voice', account: 'none' as const, voiceAlone: true, takesVoice: false },
      { id: 'only_ears', stages: ['transcription' as const], host: 'only_ears', account: 'none' as const, voiceAlone: false, takesVoice: true },
    ];
    expect(hostDefaults('only_voice', oneStage)).toEqual({ transcription: 'local_inference', translation: 'bing', speech: 'only_voice' });
    expect(hostDefaults('only_ears', oneStage)).toEqual({ transcription: 'only_ears', translation: 'bing', speech: 'edge' });
    // A host the catalog does not know is as before: itself on every stage.
    expect(hostDefaults('gone')).toEqual(allStagesBy('gone'));
  });

  it('a stored selection may run only a provider that serves every stage by itself, or one the catalog does not know', () => {
    for (const c of allCaps()) if (c.host === c.id) expect(runsByItself(c.id), c.id).toBe(c.stages.length === 3);
    expect(runsByItself('openai_compatible')).toBe(false);
    expect(runsByItself('soniox')).toBe(true);
    expect(runsByItself('fake')).toBe(true);
  });
});

// A fresh module per case: what one case registers is not seen by the next.
describe('the registered catalog', () => {
  let catalog: typeof import('./catalog');
  beforeEach(async () => {
    vi.resetModules();
    catalog = await import('./catalog');
  });

  it('throws while no catalog is registered', () => {
    expect(() => catalog.allCaps()).toThrow(/No line-up catalog is registered/);
    expect(() => catalog.caps('soniox')).toThrow();
  });

  it('reads the registered catalog when none is given', () => {
    const only = [{ id: 'x', stages: ['speech'], host: 'x', account: 'none', voiceAlone: true, takesVoice: false }] as const;
    catalog.registerCatalog(only);
    expect(catalog.caps('x')).toBe(only[0]);
    expect(catalog.caps('soniox')).toBeUndefined();
  });
});

describe('the stages that go together', () => {
  const endToEnd = ['kizunaai_qwen', 'gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'openai_live', 'qwen_livetranslate', 'palabraai'];

  it('an end-to-end provider holds all three jointly; nothing else is joint', () => {
    expect(allCaps().filter((c) => c.joint).map((c) => c.id).sort()).toEqual([...endToEnd].sort());
    for (const id of endToEnd) expect(caps(id)!.joint).toEqual(['transcription', 'translation', 'speech']);
  });

  it('Soniox, with an own key or Kizuna AI\'s, translates only what it transcribes; no other option says so', () => {
    expect(allCaps().filter((c) => c.translatesOwn).map((c) => c.id).sort()).toEqual(['kizunaai_soniox', 'soniox']);
  });

  it('an end-to-end provider chosen for any stage goes with all three', () => {
    for (const stage of ['transcription', 'translation', 'speech'] as const) expect(goesWith(caps('gemini')!, stage)).toEqual(['transcription', 'translation', 'speech']);
    expect(carriedTogether(caps('gemini')!)).toEqual(['transcription', 'translation', 'speech']);
  });

  it("Soniox's translation goes with its transcription, and not the other way round: its transcription and its voice each stand alone", () => {
    for (const id of ['soniox', 'kizunaai_soniox']) {
      expect(goesWith(caps(id)!, 'translation')).toEqual(['transcription', 'translation']);
      expect(goesWith(caps(id)!, 'transcription')).toEqual(['transcription']);
      expect(goesWith(caps(id)!, 'speech')).toEqual(['speech']);
      // Given both, one connection carries them.
      expect(carriedTogether(caps(id)!)).toEqual(['transcription', 'translation']);
    }
  });

  it('on this device every stage stands alone', () => {
    for (const id of ['local_inference', 'bing', 'edge']) {
      for (const stage of caps(id)!.stages) expect(goesWith(caps(id)!, stage)).toEqual([stage]);
      expect(carriedTogether(caps(id)!)).toBeUndefined();
    }
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

describe('the ids that served a run', () => {
  it('are on several hosts only when two services ran: Bing and Edge are services of their own, an unknown id is its own host', () => {
    expect(severalHosts(allStagesBy('soniox'))).toBe(false);
    expect(severalHosts({ transcription: 'local_inference', translation: 'bing', speech: 'edge' })).toBe(true);
    expect(severalHosts(allStagesBy('gone'))).toBe(false);
    expect(severalHosts({ transcription: 'soniox', translation: 'soniox', speech: 'edge' })).toBe(true);
    expect(severalHosts({ transcription: 'local_inference', translation: 'bing', speech: 'soniox' })).toBe(true);
    expect(severalHosts({ transcription: 'gone', translation: 'gone', speech: 'edge' })).toBe(true);
  });

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
