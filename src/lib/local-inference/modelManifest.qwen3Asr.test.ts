import { describe, expect, it } from 'vitest';
import { getManifestEntry, getModelSizeMb, isVariantEligible, selectVariant } from './modelManifest';

describe('Qwen3-ASR 0.6B (WebGPU) manifest entry', () => {
  const entry = getManifestEntry('qwen3-asr-0.6b-webgpu')!;

  it('is a WebGPU-only ASR model on the qwen3 worker, hosted on the Hub', () => {
    expect(entry).toBeDefined();
    expect(entry.type).toBe('asr');
    expect(entry.requiredDevice).toBe('webgpu');
    expect(entry.asrEngine).toBe('qwen3-asr');
    expect(entry.asrWorkerType).toBe('qwen3-asr-webgpu');
    expect(entry.hfModelId).toBe('jiangzhuo9357/Qwen3-ASR-0.6B-ONNX');
    expect(entry.cdnPath).toBeUndefined();
  });

  it('is recommended and holds the ranking slot Voxtral Mini 3B held; Voxtral 3B moves to the non-recommended slot Qwen3 had (decided 2026-09-02)', () => {
    const voxtral3b = getManifestEntry('voxtral-mini-3b-webgpu')!;
    expect(entry.recommended).toBe(true);
    expect(entry.sortOrder).toBe(3);
    expect(voxtral3b.recommended).toBe(false);
    expect(voxtral3b.sortOrder).toBe(5);
  });

  it("lists the 16 languages the model card names, spelled the way the app's language list spells them ('cantonese', not 'yue')", () => {
    expect(entry.languages).toEqual(['zh', 'en', 'ja', 'ko', 'cantonese', 'ar', 'de', 'es', 'fr', 'it', 'pt', 'ru', 'th', 'vi', 'hi', 'id']);
    expect(entry.multilingual).toBeFalsy();
  });

  it('picks q4f16 with shader-f16 and falls back to q4 without it', () => {
    expect(selectVariant(entry, ['shader-f16'])).toBe('q4f16');
    expect(selectVariant(entry, [])).toBe('q4');
    expect(isVariantEligible(entry, 'q4f16', [])).toBe(false);
    expect(isVariantEligible(entry, 'q4', [])).toBe(true);
  });

  it('shares the tokenizer/config/embedding files between variants and differs only in encoder + decoders', () => {
    const names = (k: string) => entry.variants[k].files.map(f => f.filename).sort();
    const shared = [
      'added_tokens.json', 'config.json', 'embed_scales.f32.bin', 'embed_tokens.int8.bin', 'mel_filters.json',
      'prompt_config.json', 'tokenizer.json', 'tokenizer_config.json', 'vocab.json',
    ];
    expect(names('q4')).toEqual([...shared, 'decoder_init.int4.onnx', 'decoder_step.int4.onnx', 'decoder_weights.int4.data', 'encoder.onnx'].sort());
    expect(names('q4f16')).toEqual([...shared, 'decoder_init.q4f16.onnx', 'decoder_step.q4f16.onnx', 'decoder_weights.q4f16.data', 'encoder.fp16.onnx'].sort());
  });

  it('dtype is the variant key the worker resolves in prompt_config.json', () => {
    expect(entry.variants.q4.dtype).toBe('q4');
    expect(entry.variants.q4f16.dtype).toBe('q4f16');
  });

  it('sizes match the Hub (q4 ≈ 1.30 GB, q4f16 ≈ 0.89 GB) and every entry is a positive byte count', () => {
    const total = (k: string) => entry.variants[k].files.reduce((s, f) => s + f.sizeBytes, 0);
    // Sums of the Hub's files_metadata sizes (benchmark/qwen3-asr-webgpu/results/v2-hub-files.json).
    expect(total('q4')).toBe(1_299_056_983);
    expect(total('q4f16')).toBe(892_177_041);
    for (const k of ['q4', 'q4f16']) for (const f of entry.variants[k].files) expect(f.sizeBytes).toBeGreaterThan(0);
    expect(getModelSizeMb(entry, ['shader-f16'])).toBe(Math.round(892_177_041 / 1_048_576));
    expect(getModelSizeMb(entry, [])).toBe(Math.round(1_299_056_983 / 1_048_576));
  });
});
