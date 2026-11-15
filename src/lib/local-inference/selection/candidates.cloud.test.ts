import { describe, expect, it } from 'vitest';
import { wasmCandidates } from './candidates.wasm';
import { resolveStage } from './resolveStage';

const base = { modelStatuses: {}, webgpuAvailable: true, deviceFeatures: ['shader-f16'] };

describe('Bing and Edge in the local list', () => {
  it('without withCloud, Bing and Edge are not local models', () => {
    const src = wasmCandidates({ ...base, withCloud: false });
    expect(src.has('translation', 'bing-translator')).toBe(false);
    expect(src.has('tts', 'edge-tts')).toBe(false);
    expect(src.pool('tts', 'ja', 'zh').some((c) => c.id === 'edge-tts')).toBe(false);
    expect(src.pool('translation', 'ja', 'zh').some((c) => c.id === 'bing-translator')).toBe(false);
  });

  it('by default the list is today\'s, Bing and Edge included', () => {
    const src = wasmCandidates(base);
    expect(src.has('translation', 'bing-translator')).toBe(true);
    expect(src.pool('tts', 'ja', 'zh').some((c) => c.id === 'edge-tts')).toBe(true);
  });

  it('a stored Bing choice under a local stage is a deleted model', () => {
    const selections = { 'ja→zh': { asr: { modelId: '' }, translation: { modelId: 'bing-translator' }, tts: { modelId: '' } } };
    const src = wasmCandidates({ ...base, modelStatuses: { 'hy-mt15-1.8b-translation': 'downloaded' }, withCloud: false });
    const r = resolveStage('ja→zh', 'translation', selections, src);
    expect(r.note).toMatchObject({ reason: 'not-in-catalog', to: 'hy-mt15-1.8b-translation' });
  });
});
