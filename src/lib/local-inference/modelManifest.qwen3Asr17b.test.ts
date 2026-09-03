import { describe, expect, it } from 'vitest';
import { getManifestEntry, getModelSizeMb, isVariantEligible, selectVariant } from './modelManifest';

// Sizes are the Hub's files_metadata for jiangzhuo9357/Qwen3-ASR-1.7B-ONNX
// (benchmark/qwen3-asr-webgpu/results/1.7b-hub-files.json).
const Q4_TOTAL = 2_699_714_278;
const Q4F16_TOTAL = 1_960_796_989;

describe('Qwen3-ASR 1.7B (WebGPU) manifest entry', () => {
  const entry = getManifestEntry('qwen3-asr-1.7b-webgpu')!;
  const small = getManifestEntry('qwen3-asr-0.6b-webgpu')!;

  it('runs on the same worker and engine as the 0.6B, from its own Hub repo', () => {
    expect(entry).toBeDefined();
    expect(entry.type).toBe('asr');
    expect(entry.requiredDevice).toBe('webgpu');
    expect(entry.asrEngine).toBe('qwen3-asr');
    expect(entry.asrWorkerType).toBe('qwen3-asr-webgpu');
    expect(entry.hfModelId).toBe('jiangzhuo9357/Qwen3-ASR-1.7B-ONNX');
    expect(entry.cdnPath).toBeUndefined();
  });

  it('covers the same 16 languages as the 0.6B (same tokenizer, same language prefixes)', () => {
    expect(entry.languages).toEqual(small.languages);
    expect(entry.multilingual).toBeFalsy();
  });

  it('is the quality tier, not the default: not recommended (the list splits recommended/others), sortOrder 4 among the others', () => {
    expect(entry.recommended).toBe(false);
    expect(entry.sortOrder).toBe(4);
    expect(small.recommended).toBe(true);
    expect(small.sortOrder).toBe(3);
  });

  it('picks q4f16 with shader-f16 and falls back to q4 without it', () => {
    expect(selectVariant(entry, ['shader-f16'])).toBe('q4f16');
    expect(selectVariant(entry, [])).toBe('q4');
    expect(isVariantEligible(entry, 'q4f16', [])).toBe(false);
    expect(isVariantEligible(entry, 'q4', [])).toBe(true);
    expect(entry.variants.q4.dtype).toBe('q4');
    expect(entry.variants.q4f16.dtype).toBe('q4f16');
  });

  it('has the same file roles as the 0.6B: shared tokenizer/config/embedding, per-variant encoder + decoders', () => {
    const names = (e: typeof entry, k: string) => e.variants[k].files.map(f => f.filename).sort();
    expect(names(entry, 'q4')).toEqual(names(small, 'q4'));
    expect(names(entry, 'q4f16')).toEqual(names(small, 'q4f16'));
  });

  it('sizes match the Hub (q4 ≈ 2.70 GB, q4f16 ≈ 1.96 GB), every byte count positive', () => {
    const total = (k: string) => entry.variants[k].files.reduce((s, f) => s + f.sizeBytes, 0);
    expect(total('q4')).toBe(Q4_TOTAL);
    expect(total('q4f16')).toBe(Q4F16_TOTAL);
    for (const k of ['q4', 'q4f16']) for (const f of entry.variants[k].files) expect(f.sizeBytes).toBeGreaterThan(0);
    expect(getModelSizeMb(entry, ['shader-f16'])).toBe(Math.round(Q4F16_TOTAL / 1_048_576));
    expect(getModelSizeMb(entry, [])).toBe(Math.round(Q4_TOTAL / 1_048_576));
    // The 1.7B is a genuinely bigger download than the 0.6B in both variants.
    expect(getModelSizeMb(entry, [])).toBeGreaterThan(2 * getModelSizeMb(small, []));
  });
});
