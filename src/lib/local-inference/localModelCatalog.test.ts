// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildLocalModelCatalog } from './localModelCatalog';
import { MODEL_MANIFEST } from './modelManifest';

const catalog = buildLocalModelCatalog('9.9.9');
const byId = new Map(catalog.models.map((m) => [m.id, m]));

describe('buildLocalModelCatalog', () => {
  it('stamps the app version it was built from', () => {
    expect(catalog.appVersion).toBe('9.9.9');
  });

  it('lists every manifest entry, in manifest order', () => {
    expect(catalog.models.map((m) => m.id)).toEqual(MODEL_MANIFEST.map((m) => m.id));
  });

  it('carries the provenance of a self-hosted package', () => {
    const canary = byId.get('nemo-canary-int8')!;
    expect(canary).toMatchObject({
      name: 'NeMo Canary (int8)',
      type: 'asr',
      languages: ['en', 'es', 'de', 'fr'],
      runtime: 'wasm',
      streaming: false,
      upstream: 'nvidia/canary-180m-flash',
      license: 'CC-BY-4.0',
      tier: 'open',
    });
    expect(canary.via).toMatch(/^sherpa-onnx-nemo-canary-180m-flash/);
    expect(canary.variants).toEqual([{ dtype: 'default', bytes: 207_813_900 + 300, requiresShaderF16: false }]);
  });

  it('uses the Hugging Face repo as the conversion of a third-party download', () => {
    const voxtral = byId.get('voxtral-mini-4b-webgpu')!;
    expect(voxtral.runtime).toBe('webgpu');
    expect(voxtral.streaming).toBe(true);
    expect(voxtral.via).toBe('onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX');
    expect(voxtral.viaUrl).toBe('https://huggingface.co/onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX');
    expect(voxtral.variants.find((v) => v.dtype === 'q4f16')?.requiresShaderF16).toBe(true);
  });

  it('reports a cloud entry with no download', () => {
    const bing = byId.get('bing-translator')!;
    expect(bing.runtime).toBe('cloud');
    expect(bing.tier).toBe('cloud');
    expect(bing.variants).toEqual([]);
  });

  it('lists the components bundled into packages', () => {
    expect(catalog.bundled.map((b) => b.id)).toContain('silero-vad');
  });
});
